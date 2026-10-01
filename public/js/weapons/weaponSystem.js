// Sistema de armas del jugador local (SPEC 6.10).
// Munición por arma, disparo (semi/auto/ráfaga/bombeo/cerrojo) con dispersión e impactos predichos, recarga,
// apuntar (con mira telescópica), cambio de arma, cuchillo, granadas, escudo antidisturbios, beber ventajas y
// "última batalla". El arma en primera persona se dibuja con ViewModel en una escena propia (vmScene/vmCamera)
// y los proyectiles/granadas se simulan con Projectiles. También muestra los disparos de los demás jugadores.
import * as THREE from 'three';
import { WEAPONS, weaponDef, fireInterval, meleeStats, LAST_STAND_AMMO } from '/shared/weapons.js';
import { PERKS } from '/shared/perks.js';
import { PLAYER, MELEE, SHIELD, GRENADE, MEDS, MED_KEYS, INTERP_DELAY_MS, clamp, lerp } from '/shared/constants.js';
import { raycastMap } from '/shared/collision.js';
import { r2, r3 } from '/shared/protocol.js';
import { updateCamo } from './models.js';
import { ViewModel, THROW_DUR, THROW_RELEASE, BASH_DUR, BASH_HIT, DRINK_DUR } from './viewmodel.js';
import { Projectiles } from './projectiles.js';
import { coneDir, traceBullet, meleeTargets, blockedBetween, MAX_RANGE } from './ballistics.js';
import { tr } from '../i18n.js';
import { createWeapon } from './weapon.js';

const V3 = THREE.Vector3;
const TRACER_DEFAULT = 0xffe0a0;
const FIRE_BUFFER = 0.25;                          // s que se recuerda un clic de arma semiautomática

// Tiempo para apuntar por arquetipo de modelo (s)
const ADS_TIME = {
  pistol: 0.14, revolver: 0.16, raygun: 0.15, smg: 0.18, raygun2: 0.18, rifle: 0.22,
  shotgun: 0.2, doublebarrel: 0.2, lmg: 0.3, sniper: 0.32, launcher: 0.28,
};

// Retroceso por clase: [pitch (rad), yaw (rad), empuje del arma, crecimiento de la dispersión (grados)]
const RECOIL = {
  pistol: [0.014, 0.004, 1.0, 0.7],
  smg: [0.0065, 0.0045, 0.55, 0.3],
  rifle: [0.009, 0.004, 0.75, 0.35],
  lmg: [0.0085, 0.005, 0.7, 0.28],
  shotgun: [0.04, 0.01, 1.6, 0],
  sniper: [0.055, 0.008, 1.8, 0],
  wonder: [0.012, 0.003, 0.9, 0.2],
  launcher: [0.035, 0.006, 1.5, 0],
};

// Fogonazo por arquetipo: [escala, color]
const FLASH = {
  pistol: [0.9, 0xffc070], revolver: [1.2, 0xffc070], smg: [1.0, 0xffc070], rifle: [1.1, 0xffc070],
  lmg: [1.2, 0xffb060], shotgun: [1.5, 0xffb060], doublebarrel: [1.6, 0xffb060], sniper: [1.6, 0xffc070],
  raygun: [1.2, 0x6dff6d], raygun2: [1.1, 0x6dff6d], launcher: [1.4, 0xffb060],
};

// (la tabla de sonidos de recarga, el momento en que se confirma la munición, y reloadStyle() ahora
// viven en weapon.js -- Weapon.processReload() las usa directamente)

function tracerColor(def, up) {
  if (!def) return TRACER_DEFAULT;
  if (def.model === 'raygun2' || def.model === 'raygun') return up ? 0xff3a3a : 0x46ff5a;
  if (def.special === 'fire') return 0xff8a30;
  return TRACER_DEFAULT;
}

function sameId(a, b) {
  return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
}

function vecOf(a) {
  if (!Array.isArray(a) || a.length < 3) return null;
  const x = Number(a[0]), y = Number(a[1]), z = Number(a[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return new V3(x, y, z);
}

const arr2 = (v) => [r2(v.x), r2(v.y), r2(v.z)];
// El servidor exige ids de zombi enteros: normaliza por si llegan como texto
const zidOf = (id) => (Number.isInteger(Number(id)) ? Number(id) : id);
const arr3 = (v) => [r3(v.x), r3(v.y), r3(v.z)];
const r4 = (v) => Math.round(v * 10000) / 10000;

export class WeaponSystem {
  constructor(ctx) {
    this.ctx = ctx;

    // Escena y cámara del arma en primera persona (FOV fijo, la cámara no se mueve)
    this.vmScene = new THREE.Scene();
    this.vmScene.name = 'viewmodel_scene';
    const aspect = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 16 / 9;
    this.vmCamera = new THREE.PerspectiveCamera(60, aspect, 0.01, 10);
    this.vmCamera.position.set(0, 0, 0);
    this.vm = new ViewModel(ctx, this.vmScene, this.vmCamera);

    // Proyectiles y granadas (solo el dueño envía 'boom')
    this.projectiles = new Projectiles(ctx);
    this.projectiles.onBoom = (info) => this._sendBoom(info);

    // Destello del fogonazo en la escena principal (siempre presente para no recompilar materiales)
    this.muzzleLight = new THREE.PointLight(0xffc070, 0, 9, 2);
    this.muzzleLight.name = 'muzzle_flash_light';
    if (ctx && ctx.scene && typeof ctx.scene.add === 'function') ctx.scene.add(this.muzzleLight);

    // Temporales reutilizables
    this._o = new V3(); this._d = new V3(); this._pd = new V3(); this._m = new V3();
    this._r = new V3(); this._s = new V3();
    this._vs = {};
    this._ra = { style: 'mag', p: 0, wasEmpty: false };
    this._rs = { style: 'shell', tilt: 0, shell: 0, pump: -1 };
    this._cs = { style: 'pump', p: 0 };
    this._errs = new Set();
    this._frame = 0;
    this._tFrame = -1;
    this._tList = [];
    this.time = 0;
    this.adsAmount = 0;

    this.reset();
    this._subscribe();
  }

  // ================================================================== API pública
  get current() {
    const a = this.active;
    if (!a) return null;
    const def = weaponDef(a.key, a.up);
    if (!def) return null;
    const am = this._ammo();
    return { slot: a.temp ? null : a.slot, key: a.key, up: !!a.up, def, mag: am ? am.currentBullets : 0, reserve: am ? am.reserveBullets : 0 };
  }
  get isReloading() { const am = this._ammo(); return !!am && am.state === 'reloading'; }
  get isShieldOut() { return !!this.shieldOut; }
  get isDrinking() { return this.drinkT >= 0; }

  hudInfo() {
    const self = this.ctx && this.ctx.self;
    const a = this.active;
    const def = a ? weaponDef(a.key, a.up) : null;
    const am = def ? this._ammo() : null;
    const mag = am ? am.currentBullets : null;
    const reserve = am ? am.reserveBullets : null;
    const grenades = this._gsNades === null ? (self ? Number(self.grenades) || 0 : 0) : this.nadesLocal;
    return {
      name: def ? def.name : null,
      key: a ? a.key : null,
      up: a ? !!a.up : false,
      mag,
      reserve,
      grenades,
      shieldHp: self && self.shield ? Number(self.shield.hp) || 0 : null,
      shieldOut: !!this.shieldOut,
      lowAmmo: !!(def && mag !== null && mag <= Math.max(1, Math.ceil(def.mag * 0.25))),
      noAmmo: !!(def && mag === 0 && reserve === 0),
      melee: self && self.melee ? self.melee : 'knife',
    };
  }

  spreadDeg() {
    const def = this._def();
    if (!def || def.melee || this.shieldOut) return 2;
    return this._currentSpread(def);
  }

  // Vuelve al estado inicial (nueva partida / vuelta a la sala)
  reset() {
    this.weapons = new Map();         // k -> instancia de Weapon (ver weapon.js)
    this.inv = [];                    // copia de self.weapons ({ k, up } o null si no es válida)
    this.invSig = null;
    this.active = null;               // { key, up, slot, temp }
    this.tempAmmo = null;
    this.lastStand = false;
    this.preDown = null;
    this.selfState = null;
    this.nadesLocal = 0;
    this._gsNades = null;
    this.pendingGive = null;
    this.adsAmount = 0;
    this.fireCd = 0;
    this.burstLeft = 0;
    this.fireQueued = -1;
    this.bloom = 0;
    this.cycle = null;
    this.meleeW = null;               // MeleeWeapon del arma cuerpo a cuerpo equipada (ver _melee)
    this.throwT = -1; this.throwDone = false;
    this.drinkT = -1; this.drinkDur = DRINK_DUR; this.drinkKind = 'perk'; this.healKey = null;
    this.healMenu = null;             // menú de curas abierto: { sel } (ver _requestHeal)
    this.bashT = -1; this.bashDone = false; this.bashCd = 0;
    this.shieldOut = false;
    this.shotCount = 0;
    if (this.scoped) this._hud('setScope', false);
    this.scoped = false;
    if (this.projectiles) this._safe('projectiles.clear', () => this.projectiles.clear());
    if (this.vm) this._safe('vm.reset', () => this.vm.reset());
    if (this.muzzleLight) this.muzzleLight.intensity = 0;
    const p = this.ctx && this.ctx.player;
    if (p) { p.adsAmount = 0; p.adsZoom = 1; p.moveMult = 1; }
  }

  update(dt) {
    dt = dt > 0 ? Math.min(dt, 0.1) : 0;
    this.time += dt;
    this._frame++;
    this._safe('updateCamo', () => updateCamo(dt));
    this._safe('projectiles.update', () => this.projectiles.update(dt));
    this._updateMuzzleLight(dt);

    const ctx = this.ctx;
    const gs = ctx.gs;
    const self = ctx.self;
    const player = ctx.player;
    const playing = !!(gs && gs.phase === 'playing' && self);
    if (playing) this._syncFromGs();
    if (!playing || self.state === 'dead') { this._idle(dt, player); return; }

    const input = ctx.input;
    const canAct = !!(input && input.enabled) && !this._menuOpen();
    if (!self.shield || self.state !== 'alive') this.shieldOut = false;
    this.bashCd = Math.max(0, this.bashCd - dt);
    this.fireCd -= dt;
    this.bloom *= Math.exp(-dt * 4.5);

    this._updateActions(dt);
    this._updateReload(dt);
    this._updateCycle(dt);
    if (canAct) this._handleInput(self, player, input);
    else { this.burstLeft = 0; this.fireQueued = -1; }
    if (this.fireCd < 0) this.fireCd = 0;
    this._updateAutoReload();
    this._updateAds(dt, canAct, input, player);
    this._applyPlayer(player);
    this._updateScope();
    this._safe('vm.update', () => this.vm.update(dt, this._vmState(self, player)));
  }

  // ================================================================== sincronización con gs
  _syncFromGs() {
    const gs = this.ctx.gs, self = this.ctx.self;
    if (!gs || gs.phase !== 'playing' || !self) return;
    this._syncInventory(self);
    this._checkState(self);
    this._fixActive(self);
    this._syncNades(self);
    this._checkPendingGive(self);
    this._syncHealing(self);
  }

  // Copia el inventario del servidor: armas nuevas con munición llena, las que desaparecen se descartan
  _syncInventory(self) {
    const raw = Array.isArray(self.weapons) ? self.weapons : [];
    const sig = raw.map((w) => (w && w.k ? `${w.k}${w.up ? '+' : ''}` : '_')).join(',');
    if (sig === this.invSig) return false;
    this.invSig = sig;
    this.inv = raw.map((w) => (w && WEAPONS[w.k] && !WEAPONS[w.k].melee ? { k: w.k, up: !!w.up } : null));
    const keep = new Set();
    for (const w of this.inv) {
      if (!w) continue;
      keep.add(w.k);
      const am = this.weapons.get(w.k);
      if (!am || am.up !== w.up) this._fillAmmo(w.k, w.up);
    }
    for (const k of [...this.weapons.keys()]) if (!keep.has(k)) this.weapons.delete(k);
    return true;
  }

  // Transiciones de estado del jugador local: vivo / caído (última batalla) / muerto
  _checkState(self) {
    const st = self.state === 'down' || self.state === 'dead' ? self.state : 'alive';
    const prev = this.selfState;
    if (st === prev) return;
    this.selfState = st;
    if (st === 'down') {
      this._enterLastStand();
    } else if (st === 'alive') {
      if (prev === 'down') this._exitLastStand();
      else {
        // inicio de partida o reaparición
        this._cancelAll();
        this.lastStand = false;
        this.tempAmmo = null;
        this.shieldOut = false;
        this.adsAmount = 0;
        const slot = this._firstSlot(Number.isInteger(self.cur) ? self.cur : 0);
        if (slot >= 0) this._equip(slot, { force: true, fromSpawn: true, silent: true });
        else this._equipNone(true);
      }
    } else {
      // muerto: espectador
      this._cancelAll();
      this.lastStand = false;
      this.tempAmmo = null;
      this.preDown = null;
      this.shieldOut = false;
      this.active = null;
      this.adsAmount = 0;
      this._safe('vm.setWeapon', () => this.vm.setWeapon(null, false, true));
    }
  }

  // Mantiene coherente el arma de la mano con el inventario (PaP, caja, pérdida de la 3.ª arma...)
  _fixActive(self) {
    if (this.selfState === 'dead') return;
    const a = this.active;
    if (a && a.temp) return;
    if (a) {
      const idx = this.inv.findIndex((w) => w && w.k === a.key);
      if (idx >= 0) {
        if (this.inv[idx].up !== a.up) this._equip(idx, { force: true });
        else a.slot = idx;
        return;
      }
    }
    if (!this.inv.some(Boolean)) {
      if (a) this._equipNone();
      return;
    }
    const pref = a && Number.isInteger(a.slot) ? a.slot : (Number.isInteger(self.cur) ? self.cur : 0);
    const slot = this._firstSlot(pref);
    if (slot >= 0) this._equip(slot, { force: true });
  }

  _syncNades(self) {
    const g = Number(self.grenades) || 0;
    if (g !== this._gsNades) { this._gsNades = g; this.nadesLocal = g; }
  }

  _checkPendingGive(self) {
    const pg = this.pendingGive;
    if (!pg) return;
    if (this.time > pg.until) { this.pendingGive = null; return; }
    const w = Array.isArray(self.weapons) ? self.weapons[pg.slot] : null;
    if (w && WEAPONS[w.k]) this._applyGive(self, pg.slot);
  }

  // Hueco válido más cercano a `pref` (o -1 si no hay armas)
  _firstSlot(pref) {
    const n = this.inv.length;
    if (!n) return -1;
    const p = clamp(pref | 0, 0, n - 1);
    if (this.inv[p]) return p;
    for (let i = 0; i < n; i++) if (this.inv[i]) return i;
    return -1;
  }

  // ================================================================== armas en la mano
  _def() {
    const a = this.active;
    return a ? weaponDef(a.key, a.up) : null;
  }

  _fillAmmo(k, up) {
    const w = createWeapon(k, up);
    this.weapons.set(k, w);
    return w;
  }

  // Arma temporal de "última batalla" (M1911 con munición propia, aparte del inventario real)
  _makeTempAmmo() {
    const w = createWeapon('m1911', false);
    w.currentBullets = LAST_STAND_AMMO.mag;
    w.reserveBullets = LAST_STAND_AMMO.reserve;
    this.tempAmmo = w;
  }

  _ammo() {
    const a = this.active;
    if (!a) return null;
    if (a.temp) {
      if (!this.tempAmmo) this._makeTempAmmo();
      return this.tempAmmo;
    }
    const am = this.weapons.get(a.key);
    if (am && am.up === a.up) return am;
    return this._fillAmmo(a.key, a.up);
  }

  _refillReserve(k, up) {
    const am = this.weapons.get(k);
    if (!am || am.up !== !!up) { this._fillAmmo(k, up); return; }
    am.refill({ mag: false, reserve: true });
  }

  _refillAll() {
    for (const w of this.inv) if (w) this._refillReserve(w.k, w.up);
    if (this.tempAmmo) this.tempAmmo.reserveBullets = LAST_STAND_AMMO.reserve;
    this._scheduleAutoReload(0.2);
  }

  _equip(slot, opts = {}) {
    const w = this.inv[slot];
    if (!w) { this._equipNone(); return; }
    const a = this.active;
    if (!opts.force && a && !a.temp && a.key === w.k && a.up === w.up) { a.slot = slot; return; }
    this._interrupt();
    this.shieldOut = false;
    this.active = { key: w.k, up: w.up, slot, temp: false };
    this._ammo();
    this._showWeapon(w.k, w.up, !!opts.fromSpawn);
    if (!opts.silent) this._play('switch', { volume: 0.7 });
    this._scheduleAutoReload(0.45);
  }

  _equipTemp() {
    this._interrupt();
    this.shieldOut = false;
    this._makeTempAmmo();
    this.active = { key: 'm1911', up: false, slot: null, temp: true };
    this._showWeapon('m1911', false, false);
    this._play('switch', { volume: 0.7 });
  }

  _equipNone(fromSpawn = false) {
    this._interrupt();
    this.active = null;
    this._showWeapon(null, false, fromSpawn);
  }

  _showWeapon(key, up, fromSpawn) {
    this._safe('vm.setWeapon', () => {
      this.vm.setWeapon(key, up);
      if (fromSpawn) {
        // aparecer: el arma sube desde abajo sin mostrar antes las manos vacías
        this.vm.switchLower = 1;
        this.vm.switchState = 'lowering';
      }
    });
  }

  _enterLastStand() {
    this._cancelAll();
    this.shieldOut = false;
    const a = this.active;
    this.preDown = a && !a.temp ? { key: a.key, up: a.up } : null;
    this.lastStand = true;
    // la mejor pistola del inventario (primero armas maravilla, igual que el servidor) o una M1911 temporal
    let idx = this.inv.findIndex((w) => w && WEAPONS[w.k] && WEAPONS[w.k].cls === 'wonder');
    if (idx < 0) idx = this.inv.findIndex((w) => w && WEAPONS[w.k] && WEAPONS[w.k].cls === 'pistol');
    if (idx >= 0) this._equip(idx, { force: true });
    else this._equipTemp();
  }

  _exitLastStand() {
    this._cancelAll();
    this.lastStand = false;
    this.tempAmmo = null;
    let idx = this.preDown ? this.inv.findIndex((w) => w && w.k === this.preDown.key) : -1;
    if (idx < 0) idx = this._firstSlot(0);
    this.preDown = null;
    if (idx >= 0) this._equip(idx, { force: true });
    else this._equipNone();
  }

  // Corta disparo/recarga/ciclo en curso
  _interrupt() {
    const am = this._ammo();
    if (am) { am.cancelReload(); am.cancelAutoReload(); }
    this.cycle = null;
    this.burstLeft = 0;
    this.fireQueued = -1;
  }

  // Corta además cuchillo, granada, bebida y golpe de escudo
  _cancelAll() {
    this._interrupt();
    this._melee().cancel();
    this.throwT = -1;
    this.drinkT = -1;
    this.bashT = -1;
    this._safe('vm.cancelActions', () => this.vm.cancelActions());
  }

  _hasPerk(k) {
    const self = this.ctx.self;
    return !!(self && Array.isArray(self.perks) && self.perks.includes(k));
  }

  // ================================================================== entrada
  _handleInput(self, player, input) {
    const alive = self.state === 'alive';
    if (input.pressed('heal') && alive) this._requestHeal(self);
    else if (this._handleHealMenu(self, input)) { this.burstLeft = 0; this.fireQueued = -1; return; }
    if (input.pressed('shield') && alive) this._toggleShield(self);
    if (!this.lastStand && this.drinkT < 0 && this.throwT < 0) this._handleSwitch(input);
    if (input.pressed('melee') && alive) {
      if (this.shieldOut) this._tryBash();
      else this._tryKnife();
    }
    if (input.pressed('grenade') && alive) this._tryThrow();
    if (input.pressed('reload')) this._tryReload();
    if (this.shieldOut) {
      this.burstLeft = 0;
      this.fireQueued = -1;
      if (input.pressed('fire') && alive) this._tryBash();
    } else {
      this._handleFire(input, player);
    }
  }

  _handleSwitch(input) {
    const n = this.inv.length;
    if (!n) return;
    let want = -1;
    if (input.pressed('weapon1')) want = 0;
    else if (input.pressed('weapon2')) want = 1;
    else if (input.pressed('weapon3')) want = 2;
    else {
      const next = input.pressed('nextWeapon'), prev = input.pressed('prevWeapon');
      if (!next && !prev) return;
      const a = this.active;
      const cur = a && !a.temp && Number.isInteger(a.slot) ? a.slot : -1;
      if (cur < 0) want = this._firstSlot(0);
      else {
        const step = next ? 1 : -1;
        for (let k = 1; k < n; k++) {
          const i = (((cur + step * k) % n) + n) % n;
          if (this.inv[i]) { want = i; break; }
        }
        if (want < 0 && this.shieldOut) want = cur;
      }
    }
    if (want < 0 || want >= n || !this.inv[want]) return;
    const a = this.active;
    if (a && !a.temp && a.slot === want) {
      // la misma arma: solo guarda el escudo si estaba en las manos
      if (this.shieldOut) { this.shieldOut = false; this._play('switch', { volume: 0.7 }); }
      return;
    }
    this._equip(want);
  }

  _toggleShield(self) {
    if (!self.shield || this.throwT >= 0 || this.drinkT >= 0) return;
    this.shieldOut = !this.shieldOut;
    if (this.shieldOut) {
      this._interrupt();
      this._melee().cancel();
    } else {
      this.bashT = -1;
      this._scheduleAutoReload(0.45);
    }
    this._play('switch', { volume: 0.8, rate: 0.8 });
  }

  // ================================================================== disparo
  _fireBlocked(player) {
    const vm = this.vm;
    return vm.switching || this._melee().swinging || this.throwT >= 0 || this.drinkT >= 0 || this.bashT >= 0 ||
      this.shieldOut || vm.shieldBlend > 0.1 || !!(player && player.isSprinting) || vm.sprintBlend > 0.45;
  }

  _handleFire(input, player) {
    const pressed = input.pressed('fire');
    const held = input.isDown('fire');
    if (pressed) this.fireQueued = this.time;
    const a = this.active;
    const def = this._def();
    if (!a || !def || def.melee) { this.burstLeft = 0; this.fireQueued = -1; return; }
    const am = this._ammo();
    if (!am) return;
    // la recarga cartucho a cartucho se interrumpe al disparar si queda algo en el cargador
    if (am.reloadKind === 'shell' && am.currentBullets > 0 && (pressed || held)) am.cancelReload();
    if (this.isReloading || this.cycle || this._fireBlocked(player)) {
      if (this.isReloading || this._fireBlocked(player)) this.burstLeft = 0;
      return;
    }
    const interval = fireInterval(def, this._hasPerk('doubletap'));
    let shots = 0;
    while (this.fireCd <= 0 && shots < 3) {
      let want;
      if (this.burstLeft > 0) want = true;
      else if (def.mode === 'auto') want = held;
      else want = this.fireQueued >= 0 && this.time - this.fireQueued <= FIRE_BUFFER;
      if (!want) break;
      this.fireQueued = -1;
      if (am.currentBullets <= 0) {
        this.burstLeft = 0;
        if (pressed || def.mode !== 'auto') this._dryFire(am);
        break;
      }
      if (def.mode === 'burst' && this.burstLeft <= 0) this.burstLeft = Math.max(1, (def.burst | 0) || 3);
      this._shoot(def, am, interval);
      shots++;
      this.fireCd += interval;
      if (this.burstLeft > 0) {
        this.burstLeft--;
        if (am.currentBullets <= 0) this.burstLeft = 0;
        if (this.burstLeft === 0) this.fireCd += interval * 1.8;
      }
      if (def.mode === 'pump' || def.mode === 'bolt') {
        if (am.currentBullets > 0) {
          this.cycle = { style: def.mode, t: 0, dur: Math.max(0.3, interval * 0.9), sndAt: def.mode === 'pump' ? 0.3 : 0.22, snd: false };
        }
        break;
      }
      if (def.mode !== 'auto' && this.burstLeft <= 0) break;
    }
  }

  _dryFire(am) {
    this._play('empty', { volume: 0.8 });
    if (am.reserveBullets > 0) this._tryReload();
  }

  _currentSpread(def) {
    const ads = this.adsAmount;
    const p = this.ctx.player;
    let s = lerp(def.spreadHip, def.spreadAds, ads);
    if (p) {
      const mv = clamp(Number(p.speed01) || 0, 0, 1);
      s += def.spreadHip * 0.55 * mv * (1 - ads * 0.85);
      if (p.onGround === false) s += def.spreadHip * 0.7 * (1 - ads * 0.5);
      if (p.isCrouching && ads < 0.5) s *= 0.8;
    }
    if (this.lastStand) s *= 1.15;
    s += this.bloom * (1 - ads * 0.6);
    return clamp(s, 0, 20);
  }

  // Origen y dirección del disparo: el centro de la pantalla
  _eyeRay(o, d) {
    const cam = this.ctx.camera;
    if (cam && cam.isCamera) {
      cam.getWorldPosition(o);
      cam.getWorldDirection(d);
      return;
    }
    const p = this.ctx.player;
    if (p && p.eye) {
      o.copy(p.eye);
      const cp = Math.cos(p.pitch || 0);
      d.set(-Math.sin(p.yaw || 0) * cp, Math.sin(p.pitch || 0), -Math.cos(p.yaw || 0) * cp);
      return;
    }
    o.set(0, PLAYER.eyeHeight, 0);
    d.set(0, 0, -1);
  }

  // Posición del cañón en el mundo (proyectada desde el arma en primera persona)
  _muzzle(o, d, doors) {
    const m = this._m;
    let ok = false;
    try { ok = !!this.vm.getMuzzleWorld(this.ctx.camera, m); } catch { ok = false; }
    if (!ok || !Number.isFinite(m.x) || !Number.isFinite(m.y) || !Number.isFinite(m.z)) {
      m.copy(o).addScaledVector(d, 0.45);
      m.y -= 0.08;
    }
    if (blockedBetween(o, m, doors)) m.copy(o).addScaledVector(d, 0.1);
    return m;
  }

  _shoot(def, am, interval) {
    const ctx = this.ctx;
    const a = this.active;
    const key = a.key, up = !!a.up;
    am.tryFire(this.time);
    this.shotCount++;
    const o = this._o, d = this._d;
    this._eyeRay(o, d);
    const doors = this._doors();
    const spread = this._currentSpread(def);
    const muzzle = this._muzzle(o, d, doors);

    if (def.projectile) this._shootProjectile(def, key, up, o, d, muzzle, spread, doors);
    else this._shootHitscan(def, key, up, o, d, muzzle, spread, doors);

    // retroceso, fogonazo y sonido
    const rc = RECOIL[def.cls] || RECOIL.rifle;
    const k = (1 - 0.4 * this.adsAmount) * (this.lastStand ? 1.15 : 1);
    const pl = ctx.player;
    if (pl && typeof pl.addRecoil === 'function') {
      this._safe('player.addRecoil', () => pl.addRecoil(rc[0] * k * (0.85 + Math.random() * 0.3), (Math.random() * 2 - 1) * rc[1] * k));
    }
    if (pl && typeof pl.shake === 'function' && (def.cls === 'sniper' || def.cls === 'launcher')) pl.shake(0.14, 0.12);
    this.bloom = Math.min(def.spreadHip * 0.8, this.bloom + rc[3]);
    const fl = FLASH[def.model] || FLASH.rifle;
    let color = fl[1];
    if (def.model === 'raygun' || def.model === 'raygun2') color = up ? 0xff5050 : 0x6dff6d;
    else if (def.special === 'explosive') color = 0xff8a3a;
    else if (def.special === 'fire') color = 0xff7a2a;
    this._safe('vm.fire', () => this.vm.fire({ kick: rc[2], flash: fl[0], color }));
    this._flashMain(o, d, color, fl[0]);
    this._weaponSound(def.sound, { upgraded: up });

    if (am.currentBullets === 0 && am.reserveBullets > 0) this._scheduleAutoReload(Math.min(0.3, interval));
    const ev = ctx.events;
    if (ev && typeof ev.emit === 'function') ev.emit('weapons:fired', { key, up, o: arr2(o) });
  }

  _shootHitscan(def, key, up, o, d, muzzle, spread, doors) {
    const targets = this._targets();
    const pellets = Math.max(1, def.pellets | 0);
    const pen = Math.max(1, def.pen | 0);
    const hits = [];
    const rays = [];                 // dirección de cada perdigón: el servidor traza las balas él mismo
    const hitZ = new Map();          // zid -> { part, n, x, y, z }
    const pd = this._pd;
    const tColor = tracerColor(def, up);
    let first = null;
    let impacts = pellets > 1 ? 3 : 1;
    // trazadores: todos los disparos salvo en automáticas (uno de cada dos); escopetas: 3 perdigones
    let tracers = pellets > 1 ? 3 : (def.mode === 'auto' && this.shotCount % 2 === 1 ? 0 : 1);
    for (let i = 0; i < pellets; i++) {
      if (pellets > 1) coneDir(d, spread, pd, (i + Math.random()) / pellets, Math.random());
      else coneDir(d, spread, pd);
      const tr = traceBullet(o.x, o.y, o.z, pd.x, pd.y, pd.z, pen, targets, doors, MAX_RANGE);
      rays.push([r4(pd.x), r4(pd.y), r4(pd.z)]);
      for (const h of tr.hits) {
        hits.push([zidOf(h.id), h.part, r2(h.t), i]);
        const hx = o.x + pd.x * h.t, hy = o.y + pd.y * h.t, hz = o.z + pd.z * h.t;
        let rec = hitZ.get(h.id);
        if (!rec) { rec = { part: h.part, n: 0, x: hx, y: hy, z: hz }; hitZ.set(h.id, rec); }
        else if (h.part === 'h') rec.part = 'h';
        if (rec.n < 2) this._fx('blood', new V3(hx, hy, hz), pd.clone(), h.part === 'h' ? 1.4 : h.part === 'l' ? 0.8 : 1);
        rec.n++;
      }
      const end = new V3(o.x + pd.x * tr.endT, o.y + pd.y * tr.endT, o.z + pd.z * tr.endT);
      if (!first) first = end;
      if (tr.map && impacts > 0) { impacts--; this._impactFx(tr.map); }
      if (tracers > 0) { tracers--; this._fx('tracer', muzzle.clone(), end.clone(), tColor); }
    }
    if (hitZ.size) {
      let head = false, any = null;
      for (const [id, rec] of hitZ) {
        this._ents('hitReact', id, rec.part);
        if (rec.part === 'h') head = true;
        if (!any) any = rec;
      }
      this._hud('hitmarker', 'hit');
      this._play(head ? 'headshot' : 'hit_flesh', { pos: new V3(any.x, any.y, any.z), volume: 0.8 });
    }
    this._send({
      t: 'fire', w: key, up, o: arr2(o), d: arr3(d),
      e: first ? arr2(first) : arr2(new V3().copy(o).addScaledVector(d, 50)),
      hits,
      // con impactos: dirección de cada perdigón e instante del mundo que se veía (compensación de lag)
      ...(hits.length ? { rays, ts: this._shotTime() } : {}),
    });
  }

  _shootProjectile(def, key, up, o, d, muzzle, spread, doors) {
    const pr = def.projectile;
    const dir = coneDir(d, spread, this._pd).clone();
    let po, pdir;
    if (pr.gravity > 0) {
      // lanzagranadas: sale del cañón siguiendo la mira (trayectoria en arco)
      po = muzzle.clone();
      pdir = dir;
    } else {
      // corrige el paralaje: del cañón hacia el punto que marca la cruz
      const tr = traceBullet(o.x, o.y, o.z, dir.x, dir.y, dir.z, 1, this._targets(), doors, 120);
      const t = tr.hits.length ? tr.hits[0].t : tr.endT;
      if (t < 1.2) {
        po = o.clone().addScaledVector(dir, 0.05);
        pdir = dir;
      } else {
        po = muzzle.clone();
        pdir = o.clone().addScaledVector(dir, t).sub(po);
        if (pdir.lengthSq() < 1e-6) pdir = dir; else pdir.normalize();
      }
    }
    this._safe('projectiles.spawn', () => this.projectiles.spawnProjectile({ w: key, up, o: po, d: pdir, owner: true, def }));
    this._send({ t: 'proj', w: key, up, o: arr2(po), d: arr3(pdir) });
  }

  // Chispas/polvo y marca de bala donde la bala toca el mapa
  _impactFx(hit) {
    const p = new V3(hit.x, hit.y, hit.z);
    const n = new V3(hit.nx, hit.ny, hit.nz);
    if (hit.what === 'wall' || hit.what === 'prop') this._fx('spark', p.clone(), n.clone());
    else this._fx('dust', p.clone(), n.clone());
    this._fx('decal', p, n);
  }

  _flashMain(o, d, color, scale) {
    const L = this.muzzleLight;
    if (!L) return;
    L.position.copy(o).addScaledVector(d, 0.9);
    L.color.setHex(color);
    L.intensity = 5 * scale;
  }

  _updateMuzzleLight(dt) {
    const L = this.muzzleLight;
    if (!L || L.intensity <= 0) return;
    L.intensity *= Math.exp(-dt * 32);
    if (L.intensity < 0.02) L.intensity = 0;
  }

  // ================================================================== recarga y ciclo
  _reloadAllowed() {
    return !this.isReloading && !this._melee().swinging && this.throwT < 0 && this.drinkT < 0 && this.bashT < 0 &&
      !this.shieldOut && !this.vm.switching;
  }

  _tryReload() {
    const def = this._def(), am = this._ammo();
    if (!def || def.melee || !am) return false;
    if (!this._reloadAllowed()) return false;
    return this._startReload(am);
  }

  // Empieza la recarga y avisa al servidor, que lleva la cuenta real de la munición: sin este aviso
  // no aceptaría disparos con un cargador que para él sigue vacío
  _startReload(am) {
    const sc = this._hasPerk('speedcola') ? 0.5 : 1;
    if (!am.reload(sc)) return false;
    const a = this.active;
    if (a) this._send({ t: 'reload', w: a.key, up: !!a.up });
    return true;
  }

  // Avanza dt segundos la recarga en curso del arma activa (si hay una) y reproduce sus sonidos
  _updateReload(dt) {
    const am = this.active ? this._ammo() : null;
    if (!am) return;
    const fx = am.update(dt);
    for (const f of fx) this._play(f.sound, f.opts);
  }

  _updateCycle(dt) {
    const c = this.cycle;
    if (!c) return;
    c.t += dt;
    if (!c.snd && c.t >= c.dur * c.sndAt) {
      c.snd = true;
      this._play(c.style === 'pump' ? 'pump' : 'reload_bolt', { volume: 0.85 });
    }
    if (c.t >= c.dur) this.cycle = null;
  }

  _scheduleAutoReload(delay) {
    const am = this.active ? this._ammo() : null;
    if (am) am.scheduleAutoReload(this.time, delay);
  }

  _updateAutoReload() {
    const am = this.active ? this._ammo() : null;
    if (!am) return;
    const at = am.timeToStartReload;
    if (at < 0 || this.time < at) return;
    const def = this._def();
    if (!def || def.melee || am.currentBullets > 0 || am.reserveBullets <= 0 || this.isReloading) { am.cancelAutoReload(); return; }
    if (this._reloadAllowed() && !this.cycle) {
      am.cancelAutoReload();
      this._startReload(am);
    }
  }

  // ================================================================== apuntar, jugador y mira telescópica
  _updateAds(dt, canAct, input, player) {
    const def = this._def();
    const want = !!(canAct && input && input.isDown('ads') && def && !def.melee && !this.isReloading && !this.shieldOut &&
      this.drinkT < 0 && !this._melee().swinging && this.throwT < 0 && this.bashT < 0 && !this.vm.switching &&
      !(player && player.isSprinting));
    const t = (def && ADS_TIME[def.model]) || 0.2;
    this.adsAmount = clamp(this.adsAmount + (want ? dt / t : -dt / (t * 0.8)), 0, 1);
  }

  _applyPlayer(player) {
    if (!player) return;
    const def = this._def();
    player.adsZoom = def ? Math.max(1, Number(def.zoom) || 1) : 1;
    player.adsAmount = this.adsAmount;
    let mm = def ? Number(def.moveMult) || 1 : 1;
    mm *= lerp(1, PLAYER.adsSpeedMult, this.adsAmount);
    if (this.drinkT >= 0) mm *= 0.8;
    if (this.shieldOut) mm *= 0.92;
    player.moveMult = mm;
  }

  _updateScope() {
    const def = this._def();
    const want = !!(def && def.cls === 'sniper' && this.adsAmount >= 0.94 && !this.isReloading);
    if (want === this.scoped) return;
    this.scoped = want;
    this._hud('setScope', want);
  }

  _idle(dt, player) {
    this.adsAmount = 0;
    this.burstLeft = 0;
    this.fireQueued = -1;
    if (this.scoped) { this.scoped = false; this._hud('setScope', false); }
    if (player) { player.adsAmount = 0; player.adsZoom = 1; player.moveMult = 1; }
    this._safe('vm.update', () => this.vm.update(dt, { visible: false }));
  }

  _vmState(self, player) {
    const s = this._vs;
    const def = this._def();
    const am = def ? this._ammo() : null;
    s.visible = true;
    s.hide = this.scoped;
    s.ads = this.adsAmount;
    s.sprint = !!(player && player.isSprinting);
    s.speed01 = player ? Number(player.speed01) || 0 : 0;
    s.onGround = player ? player.onGround !== false : true;
    s.crouch = !!(player && player.isCrouching);
    s.down = self.state === 'down';
    s.yaw = player && Number.isFinite(player.yaw) ? player.yaw : 0;
    s.pitch = player && Number.isFinite(player.pitch) ? player.pitch : 0;
    s.velY = player && player.velocity ? player.velocity.y : 0;
    // velocidad lateral relativa a la vista (derecha = +)
    if (player && player.velocity) {
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
      s.strafe = (player.velocity.x * cy - player.velocity.z * sy) / 4.6;
    } else s.strafe = 0;
    s.slide = !!(player && player.isSliding);
    s.reload = this._reloadAnim();
    if (this.cycle) {
      this._cs.style = this.cycle.style;
      this._cs.p = this.cycle.t / this.cycle.dur;
      s.cycle = this._cs;
    } else s.cycle = null;
    s.slideLocked = !!(def && am && am.currentBullets === 0 && !this.isReloading && def.model === 'pistol');
    s.shieldOut = !!this.shieldOut;
    return s;
  }

  _reloadAnim() {
    const am = this.active ? this._ammo() : null;
    const r = am ? am.reloadAnimState() : null;
    if (!r) return null;
    if (r.style === 'shell') {
      const o = this._rs;
      o.tilt = r.tilt;
      o.shell = r.shell;
      o.pump = r.pump;
      return o;
    }
    const o = this._ra;
    o.style = r.style;
    o.p = r.p;
    o.wasEmpty = r.wasEmpty;
    return o;
  }

  // ================================================================== cuchillo, escudo, granadas y ventajas
  _updateActions(dt) {
    if (this._melee().update(dt).hit) this._knifeHit();
    if (this.bashT >= 0) {
      this.bashT += dt;
      if (!this.bashDone && this.bashT >= BASH_HIT) { this.bashDone = true; this._bashHit(); }
      if (this.bashT >= BASH_DUR) this.bashT = -1;
    }
    if (this.throwT >= 0) {
      this.throwT += dt;
      if (!this.throwDone && this.throwT >= THROW_RELEASE) { this.throwDone = true; this._releaseGrenade(); }
      if (this.throwT >= THROW_DUR) {
        this.throwT = -1;
        this._scheduleAutoReload(0.1);
      }
    }
    if (this.drinkT >= 0) {
      const prev = this.drinkT;
      this.drinkT += dt;
      if (this.drinkKind === 'perk') {
        if (prev < 0.4 && this.drinkT >= 0.4) this._play('perk_drink');
        if (prev < 1.3 && this.drinkT >= 1.3) this._play('perk_burp', { volume: 0.8 });
      } else if (prev < 0.25 && this.drinkT >= 0.25) this._play('reload_out', { volume: 0.7, rate: 0.8 });
      if (this.drinkT >= this.drinkDur) {
        this.drinkT = -1;
        this._scheduleAutoReload(0.3);
      }
    }
  }

  // MeleeWeapon del arma cuerpo a cuerpo que lleva el jugador (self.melee); se rehace si la cambia
  // (el enfriamiento pendiente se conserva). Sin partida cae al cuchillo básico.
  _melee() {
    const self = this.ctx && this.ctx.self;
    const key = meleeStats(self && self.melee).key;
    const cur = this.meleeW;
    if (!cur || cur.key !== key) {
      const next = createWeapon(key, false);
      if (cur) { next._cd = cur._cd; }
      this.meleeW = next;
    }
    return this.meleeW;
  }

  _tryKnife() {
    if (this.throwT >= 0 || this.drinkT >= 0) return;
    const mw = this._melee();
    if (mw.swinging || mw.cooldownLeft > 0) return;
    this._interrupt();
    mw.tryFire(this.time);
    this._safe('vm.playKnife', () => this.vm.playKnife(mw.key, mw.swingDuration));
    this._play('knife', { volume: 0.9, rate: mw.swingDuration > 0.5 ? 0.7 : 1 });
  }

  _knifeHit() {
    const self = this.ctx.self, p = this.ctx.player;
    if (!self || self.state !== 'alive' || !p || !p.position) return;
    const eyeY = p.eye ? p.eye.y : p.position.y + PLAYER.eyeHeight;
    const mw = this._melee();
    const list = meleeTargets(this._targets(), p.position.x, p.position.z, eyeY, p.yaw || 0,
      mw.range, mw.arc, mw.maxTargets, this._doors());
    if (!list.length) return;
    this._send({ t: 'melee', hits: list.map((z) => zidOf(z.id)), shield: false });
    const heavy = mw.key !== 'knife';
    for (const z of list) {
      const dir = new V3(z.x - p.position.x, 0, z.z - p.position.z);
      if (dir.lengthSq() > 1e-6) dir.normalize(); else dir.set(0, 0, -1);
      this._fx('blood', new V3(z.x, z.y, z.z), dir, heavy ? 1.6 : 1.1);
      this._ents('hitReact', z.id, 'b');
    }
    this._hud('hitmarker', 'hit');
    this._play(mw.knock ? 'bash' : 'knife_hit', { volume: 0.9 });
    if (typeof p.shake === 'function') p.shake(heavy ? 0.2 : 0.12, heavy ? 0.14 : 0.1);
  }

  _tryBash() {
    if (!this.shieldOut || this.bashT >= 0 || this.bashCd > 0 || this.drinkT >= 0 || this.throwT >= 0) return;
    if (this.vm.shieldBlend < 0.7) return;
    this.bashT = 0;
    this.bashDone = false;
    this.bashCd = SHIELD.bashCooldown;
    this._safe('vm.playBash', () => this.vm.playBash());
    this._play('knife', { volume: 0.7, rate: 0.6 });
  }

  _bashHit() {
    const self = this.ctx.self, p = this.ctx.player;
    if (!self || self.state !== 'alive' || !self.shield || !p || !p.position) return;
    const eyeY = p.eye ? p.eye.y : p.position.y + PLAYER.eyeHeight;
    const list = meleeTargets(this._targets(), p.position.x, p.position.z, eyeY, p.yaw || 0,
      SHIELD.bashRange, SHIELD.bashArcDeg, 8, this._doors());
    if (!list.length) return;
    this._send({ t: 'melee', hits: list.map((z) => zidOf(z.id)), shield: true });
    for (const z of list) {
      const dir = new V3(z.x - p.position.x, 0, z.z - p.position.z);
      if (dir.lengthSq() > 1e-6) dir.normalize(); else dir.set(0, 0, -1);
      this._fx('blood', new V3(z.x, z.y, z.z), dir, 0.7);
      this._ents('hitReact', z.id, 'b');
    }
    this._hud('hitmarker', 'hit');
    this._play('bash', { volume: 1 });
    if (typeof p.shake === 'function') p.shake(0.22, 0.15);
    this._safe('vm.shieldHit', () => this.vm.shieldHit());
  }

  _tryThrow() {
    if (this.throwT >= 0 || this._melee().swinging || this.drinkT >= 0 || this.bashT >= 0) return;
    if (this.nadesLocal <= 0) return;
    this._interrupt();
    this.throwT = 0;
    this.throwDone = false;
    this._safe('vm.playThrow', () => this.vm.playThrow());
    this._play('pin', { volume: 0.9 });
  }

  _releaseGrenade() {
    const ctx = this.ctx;
    const self = ctx.self, p = ctx.player;
    if (!self || self.state !== 'alive' || this.nadesLocal <= 0) return;
    const o = this._o, d = this._d;
    this._eyeRay(o, d);
    const doors = this._doors();
    const right = this._r.set(-d.z, 0, d.x);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();
    const start = this._s.copy(o).addScaledVector(d, 0.35).addScaledVector(right, 0.12);
    start.y -= 0.1;
    if (blockedBetween(o, start, doors)) start.copy(o).addScaledVector(d, 0.05);
    // hacia donde miras, con impulso hacia arriba y parte de la inercia del jugador
    const v = new V3().copy(d).multiplyScalar(GRENADE.throwSpeed);
    v.y += GRENADE.upSpeed;
    if (p && p.velocity) { v.x += (Number(p.velocity.x) || 0) * 0.6; v.z += (Number(p.velocity.z) || 0) * 0.6; }
    this._send({ t: 'nade', o: arr2(start), v: arr2(v) });
    this._safe('projectiles.spawnGrenade', () => this.projectiles.spawnGrenade({ o: start.clone(), v, owner: true }));
    this.nadesLocal = Math.max(0, this.nadesLocal - 1);
    this._play('grenade_throw', { volume: 0.9 });
  }

  _startDrink(perk) {
    const info = PERKS[perk];
    this._cancelAll();
    this.shieldOut = false;
    this.drinkT = 0;
    this.drinkDur = DRINK_DUR;
    this.drinkKind = 'perk';
    this._safe('vm.playDrink', () => this.vm.playDrink(info ? info.color : '#e0282e', DRINK_DUR));
  }

  // ================================================================== curas (tecla H)
  // Elige la cura más adecuada: antídoto si hay infección, botiquín con poca vida, si no venda.
  _pickMed(self) {
    const meds = self.meds || {};
    const has = (k) => (meds[k] | 0) > 0;
    const hurt = (+self.hp || 0) < (+self.maxHp || PLAYER.health);
    const low = (+self.hp || 0) <= (+self.maxHp || PLAYER.health) * 0.4;
    if (self.infected) {
      if (has('antidote')) return 'antidote';
      if (has('medkit')) return 'medkit';
    }
    if (!hurt) return null;
    if (low && has('medkit')) return 'medkit';
    if (has('bandage')) return 'bandage';
    if (has('medkit')) return 'medkit';
    return null;
  }

  // ¿Sirve ahora esta cura? (misma regla que el servidor en Game._onHeal)
  _medUseful(self, key) {
    const def = MEDS[key];
    if (!def) return false;
    return (def.cures && !!self.infected) || (def.heal > 0 && (+self.hp || 0) < (+self.maxHp || PLAYER.health));
  }

  // H: si hay una cura en curso la cancela; si no, abre/cierra el menú de curas. Dentro del menú se elige con
  // 1-3 (directo), rueda/cambiar arma (mover la selección) y disparo (usar la seleccionada). La selección
  // inicial es la sugerencia de _pickMed.
  _requestHeal(self) {
    if (self.healing) { this._send({ t: 'heal', item: null }); this.healMenu = null; return; }   // volver a pulsar H cancela
    if (this.healMenu) { this.healMenu = null; return; }
    if (this.drinkT >= 0 || this.throwT >= 0 || this._melee().swinging) return;
    const meds = self.meds || {};
    if (!MED_KEYS.some((k) => (meds[k] | 0) > 0)) {
      this._hud('message', tr('No tienes curas'), 1.8);
      this._play('deny', { volume: 0.6 });
      return;
    }
    const first = MED_KEYS.find((k) => (meds[k] | 0) > 0);
    this.healMenu = { sel: this._pickMed(self) || first };
    this._play('ui_click', { volume: 0.4 });
  }

  _useMed(self, key) {
    const meds = self.meds || {};
    if ((meds[key] | 0) <= 0) {
      this._hud('message', tr('No tienes {0}', tr(MEDS[key].plural).toLowerCase()), 1.6);
      this._play('deny', { volume: 0.6 });
      return;
    }
    if (!this._medUseful(self, key)) {
      this._hud('message', self.infected ? tr('Eso no cura la infección') : tr('Ya tienes la salud al máximo'), 1.8);
      this._play('deny', { volume: 0.6 });
      return;
    }
    this.healMenu = null;
    this._send({ t: 'heal', item: key });
  }

  // Entrada con el menú de curas abierto. Devuelve true si el menú sigue abierto (y se come la entrada de armas).
  _handleHealMenu(self, input) {
    const m = this.healMenu;
    if (!m) return false;
    if (self.state !== 'alive' || self.healing || this.drinkT >= 0 || this.throwT >= 0) { this.healMenu = null; return false; }
    // cualquier otra acción de combate cierra el menú y sigue su curso
    if (input.pressed('melee') || input.pressed('grenade') || input.pressed('reload') || input.pressed('shield')) { this.healMenu = null; return false; }
    const direct = ['weapon1', 'weapon2', 'weapon3'];
    for (let i = 0; i < direct.length && i < MED_KEYS.length; i++) {
      if (input.pressed(direct[i])) { this._useMed(self, MED_KEYS[i]); return !!this.healMenu; }
    }
    const step = input.pressed('nextWeapon') ? 1 : input.pressed('prevWeapon') ? -1 : 0;
    if (step) {
      const i = MED_KEYS.indexOf(m.sel);
      m.sel = MED_KEYS[(i + step + MED_KEYS.length) % MED_KEYS.length];
      this._play('ui_click', { volume: 0.3 });
    }
    if (input.pressed('fire')) this._useMed(self, m.sel);
    return !!this.healMenu;
  }

  // La cura la decide el servidor (self.healing); aquí solo se anima
  _syncHealing(self) {
    const h = self.healing && MEDS[self.healing.item] ? self.healing : null;
    const key = h ? `${h.item}:${h.until}` : null;
    if (key === this.healKey) return;
    this.healKey = key;
    if (h) {
      const def = MEDS[h.item];
      this._cancelAll();
      this.shieldOut = false;
      this.drinkT = 0;
      this.drinkDur = def.useTime;
      this.drinkKind = 'heal';
      if (h.item === 'bandage' || h.item === 'medkit') this._safe('vm.playHeal', () => this.vm.playHeal(h.item, def.useTime));
      else this._safe('vm.playDrink', () => this.vm.playDrink(def.color, def.useTime));
    } else if (this.drinkKind === 'heal' && this.drinkT >= 0) {
      this.drinkT = -1;
      this._safe('vm.cancelActions', () => this.vm.cancelActions());
      this._scheduleAutoReload(0.2);
    }
  }

  // ================================================================== eventos del servidor
  _subscribe() {
    const ev = this.ctx && this.ctx.events;
    if (!ev || typeof ev.on !== 'function') return;
    const on = (name, fn) => ev.on(name, (e) => {
      try { fn(e || {}); } catch (err) { this._err(name, err); }
    });
    on('gs', () => this._syncFromGs());
    on('ev:give', (e) => this._onGive(e));
    on('ev:ammo', (e) => this._onAmmo(e));
    on('ev:ammoSync', (e) => this._onAmmoSync(e));
    on('ev:pu', (e) => { if (e.type === 'maxammo' && this._playingNow()) this._refillAll(); });
    on('ev:perk', (e) => { if (this._isSelf(e.pid) && this._playingNow()) this._startDrink(e.perk); });
    on('ev:zdie', (e) => {
      if (!this._isSelf(e.pid) || e.fx === 'nuke') return;
      this._hud('hitmarker', e.part === 'h' || e.fx === 'head' ? 'head' : 'kill');
    });
    on('ev:fire', (e) => this._onRemoteFire(e));
    on('ev:proj', (e) => this._onRemoteProj(e));
    on('ev:nade', (e) => this._onRemoteNade(e));
    on('ev:boom', (e) => this._onRemoteBoom(e));
    on('ev:shieldHit', (e) => {
      if (!this._isSelf(e.pid)) return;
      this._safe('vm.shieldHit', () => this.vm.shieldHit());
      this._play('shield_hit');
    });
    on('ev:shieldBreak', (e) => {
      if (!this._isSelf(e.pid)) return;
      this.shieldOut = false;
      this.bashT = -1;
      this._play('shield_break');
    });
    on('phase', (e) => {
      if (e.phase === 'playing') return;
      this._cancelAll();
      this.adsAmount = 0;
      if (this.scoped) { this.scoped = false; this._hud('setScope', false); }
    });
  }

  _onGive(e) {
    if (!this._isSelf(e.pid)) return;
    const self = this.ctx.self;
    const slot = Number(e.slot) | 0;
    const w = self && Array.isArray(self.weapons) ? self.weapons[slot] : null;
    if (!w || !WEAPONS[w.k]) { this.pendingGive = { slot, until: this.time + 3 }; return; }
    this._applyGive(self, slot);
  }

  _applyGive(self, slot) {
    this.pendingGive = null;
    this._syncInventory(self);
    const w = this.inv[slot];
    if (!w) return;
    this._fillAmmo(w.k, w.up);
    if (this.lastStand || this.selfState !== 'alive') return;
    this._equip(slot);
  }

  _onAmmo(e) {
    if (!this._isSelf(e.pid)) return;
    if (e.slot === null || e.slot === undefined) { this._refillAll(); return; }
    const self = this.ctx.self;
    const w = self && Array.isArray(self.weapons) ? self.weapons[Number(e.slot) | 0] : null;
    if (!w || !WEAPONS[w.k]) return;
    this._refillReserve(w.k, !!w.up);
    this._scheduleAutoReload(0.2);
  }

  // El servidor rechazó un disparo por falta de munición: su cuenta manda. Se corrige el arma afectada
  // (normalmente no pasa nunca: cliente y servidor cuentan igual; sirve si alguien toca el cliente)
  _onAmmoSync(e) {
    if (!this._isSelf(e.pid)) return;
    const a = this.active;
    const am = a && a.temp && e.temp ? this.tempAmmo
      : [...this.weapons.values()].find((w) => w.key === e.w && w.up === !!e.up) || null;
    if (!am) return;
    am.cancelReload();
    am.currentBullets = Math.max(0, e.m | 0);
    am.reserveBullets = Math.max(0, e.r | 0);
    this.burstLeft = 0;
    if (am.currentBullets === 0 && am.reserveBullets > 0) this._scheduleAutoReload(0.2);
  }

  // Disparo de otro jugador: trazador, destello, impacto y sonido 3D
  _onRemoteFire(e) {
    if (this._isSelf(e.pid) || !this._playingNow()) return;
    const o = vecOf(e.o);
    if (!o) return;
    const def = weaponDef(e.w, !!e.up);
    // el campo 'e' del mensaje es el nombre del evento: el servidor manda el final del trazador en 'end'
    const end = vecOf(e.end) || vecOf(e.e) || (() => {
      const d0 = vecOf(e.d);
      return d0 && d0.lengthSq() > 1e-6 ? o.clone().addScaledVector(d0.normalize(), 50) : null;
    })();
    if (!end) return;
    const dir = end.clone().sub(o);
    const dist = dir.length();
    if (dist < 1e-3) return;
    dir.divideScalar(dist);
    const doors = this._doors();
    const right = new V3(-dir.z, 0, dir.x);
    if (right.lengthSq() > 1e-6) right.normalize();
    const start = o.clone().addScaledVector(dir, 0.6).addScaledVector(right, 0.12);
    start.y -= 0.12;
    if (blockedBetween(o, start, doors)) start.copy(o).addScaledVector(dir, 0.1);
    const color = tracerColor(def, !!e.up);
    this._fx('tracer', start.clone(), end.clone(), color);
    // escopetas: un par de perdigones extra solo visuales
    if (def && (def.pellets | 0) > 1) {
      for (let i = 0; i < 2; i++) {
        const pd = coneDir(dir, def.spreadHip || 5, new V3());
        this._fx('tracer', start.clone(), o.clone().addScaledVector(pd, dist), color);
      }
    }
    this._fx('muzzleLight', start.clone());
    if (def) this._weaponSound(def.sound, { pos: start.clone(), upgraded: !!e.up });
    if (dist < MAX_RANGE) {
      const h = raycastMap(o.x, o.y, o.z, dir.x, dir.y, dir.z, dist + 0.25, doors);
      if (h && Math.abs(h.dist - dist) < 0.35) this._impactFx(h);
    }
  }

  _onRemoteProj(e) {
    if (this._isSelf(e.pid) || !this._playingNow()) return;
    const o = vecOf(e.o), d = vecOf(e.d);
    if (!o || !d || d.lengthSq() < 1e-6) return;
    d.normalize();
    const p = this.projectiles.spawnProjectile({ w: e.w, up: !!e.up, o, d, owner: false });
    if (p) p.pid = e.pid;
    const def = weaponDef(e.w, !!e.up);
    if (def) this._weaponSound(def.sound, { pos: o.clone(), upgraded: !!e.up });
    this._fx('muzzleLight', o.clone().addScaledVector(d, 0.4));
  }

  _onRemoteNade(e) {
    if (this._isSelf(e.pid) || !this._playingNow()) return;
    const o = vecOf(e.o), v = vecOf(e.v);
    if (!o || !v) return;
    const p = this.projectiles.spawnGrenade({ o, v, owner: false });
    if (p) p.pid = e.pid;
    this._play('grenade_throw', { pos: o.clone(), volume: 0.8 });
  }

  // La explosión la dibuja Effects; aquí solo se retira el proyectil visual del otro jugador que la causó
  _onRemoteBoom(e) {
    if (this._isSelf(e.pid) || !Array.isArray(e.p)) return;
    const px = Number(e.p[0]) || 0, py = Number(e.p[1]) || 0, pz = Number(e.p[2]) || 0;
    const isNade = e.w === 'frag';
    let best = null, bd = 100;
    for (const p of this.projectiles.list) {
      if (p.done || p.owner || !sameId(p.pid, e.pid) || (p.kind === 'nade') !== isNade) continue;
      const d2 = (p.pos.x - px) ** 2 + (p.pos.y - py) ** 2 + (p.pos.z - pz) ** 2;
      if (d2 < bd) { bd = d2; best = p; }
    }
    if (best) this._safe('projectiles.finish', () => this.projectiles._finish(best));
  }

  _sendBoom(info) {
    if (!info || !this._playingNow()) return;
    const direct = info.direct !== undefined && info.direct !== null ? zidOf(info.direct) : null;
    this._send({ t: 'boom', w: info.w, up: !!info.up, p: info.p, direct });
  }

  // ================================================================== utilidades
  _isSelf(pid) { return sameId(pid, this.ctx.selfId); }
  _playingNow() { const gs = this.ctx.gs; return !!(gs && gs.phase === 'playing'); }
  _doors() { const gs = this.ctx.gs; return (gs && gs.doors) || {}; }

  _menuOpen() {
    const m = this.ctx.menus;
    if (!m) return false;
    try { return typeof m.isOpen === 'function' ? !!m.isOpen() : !!m.isOpen; } catch { return false; }
  }

  // Objetivos de disparo (posición renderizada de los zombis), una vez por frame
  _targets() {
    if (this._tFrame === this._frame) return this._tList;
    let list = [];
    const ents = this.ctx.entities;
    if (ents && typeof ents.getZombieTargets === 'function') {
      try { list = ents.getZombieTargets() || []; } catch (err) { this._err('entities.getZombieTargets', err); list = []; }
    }
    this._tList = Array.isArray(list) ? list : [];
    this._tFrame = this._frame;
    return this._tList;
  }

  // Instante del mundo que se ve en pantalla (reloj del servidor): los zombis dibujados están interpolados
  // a ese momento, y el servidor los rebobina ahí para validar el disparo
  _shotTime() {
    const ents = this.ctx.entities;
    if (ents && Number.isFinite(ents.sampleTime)) return Math.round(ents.sampleTime);
    const net = this.ctx.net;
    return net && typeof net.serverNow === 'function' ? Math.round(net.serverNow() - INTERP_DELAY_MS) : undefined;
  }

  _send(obj) {
    const net = this.ctx.net;
    if (!net || typeof net.send !== 'function') return;
    try { net.send(obj); } catch (err) { this._err('net.send', err); }
  }

  _fx(method, ...args) {
    const fx = this.ctx.effects;
    if (!fx || typeof fx[method] !== 'function') return;
    try { fx[method](...args); } catch (err) { this._err(`effects.${method}`, err); }
  }

  _hud(method, ...args) {
    const hud = this.ctx.hud;
    if (!hud || typeof hud[method] !== 'function') return;
    try { hud[method](...args); } catch (err) { this._err(`hud.${method}`, err); }
  }

  _ents(method, ...args) {
    const ents = this.ctx.entities;
    if (!ents || typeof ents[method] !== 'function') return;
    try { ents[method](...args); } catch (err) { this._err(`entities.${method}`, err); }
  }

  _play(name, opts) {
    const a = this.ctx.audio;
    if (!a || typeof a.play !== 'function') return;
    try { a.play(name, opts || {}); } catch (err) { this._err(`audio.play(${name})`, err); }
  }

  _weaponSound(sound, opts) {
    const a = this.ctx.audio;
    if (!a || typeof a.weapon !== 'function') return;
    try { a.weapon(sound || 'rifle', opts || {}); } catch (err) { this._err('audio.weapon', err); }
  }

  _safe(tag, fn) {
    try { return fn(); } catch (err) { this._err(tag, err); return undefined; }
  }

  // Registra cada error distinto una sola vez (un fallo de otro módulo no debe inundar la consola)
  _err(tag, err) {
    if (this._errs.has(tag)) return;
    this._errs.add(tag);
    console.error(`[WeaponSystem] Error en ${tag}:`, err);
  }
}

export default WeaponSystem;
