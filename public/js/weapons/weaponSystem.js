// Sistema de armas del jugador local (SPEC 6.10).
// Munición por arma, disparo (semi/auto/ráfaga/bombeo/cerrojo) con dispersión e impactos predichos, recarga,
// apuntar (con mira telescópica), cambio de arma, cuchillo, granadas, escudo antidisturbios, beber ventajas y
// "última batalla". El arma en primera persona se dibuja con ViewModel en una escena propia (vmScene/vmCamera)
// y los proyectiles/granadas se simulan con Projectiles. También muestra los disparos de los demás jugadores.
import * as THREE from 'three';
import { WEAPONS, weaponDef, fireInterval, meleeStats } from '/shared/weapons.js';
import { PERKS } from '/shared/perks.js';
import { PLAYER, MELEE, SHIELD, GRENADE, MEDS, clamp, lerp } from '/shared/constants.js';
import { raycastMap } from '/shared/collision.js';
import { r2, r3 } from '/shared/protocol.js';
import { updateCamo } from './models.js';
import { ViewModel, KNIFE_DUR, KNIFE_HIT, THROW_DUR, THROW_RELEASE, BASH_DUR, BASH_HIT, DRINK_DUR } from './viewmodel.js';
import { Projectiles } from './projectiles.js';
import { coneDir, traceBullet, meleeTargets, blockedBetween, MAX_RANGE } from './ballistics.js';

const V3 = THREE.Vector3;
const TRACER_DEFAULT = 0xffe0a0;
const LAST_STAND_AMMO = { mag: 8, reserve: 24 };   // M1911 temporal de "última batalla"
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

// Sonidos de la recarga completa: [progreso 0..1, sonido, solo si el cargador estaba vacío]
const RELOAD_SFX = {
  mag: [[0.2, 'reload_out'], [0.58, 'reload_in'], [0.8, 'reload_bolt', true]],
  pistol: [[0.2, 'reload_out'], [0.55, 'reload_in'], [0.8, 'reload_bolt', true]],
  raygun: [[0.2, 'reload_out'], [0.55, 'reload_in'], [0.78, 'reload_bolt']],
  lmg: [[0.1, 'reload_bolt'], [0.28, 'reload_out'], [0.6, 'reload_in'], [0.84, 'reload_bolt']],
  bolt: [[0.2, 'reload_out'], [0.56, 'reload_in'], [0.75, 'reload_bolt']],
  revolver: [[0.14, 'reload_out'], [0.52, 'reload_in'], [0.8, 'reload_bolt']],
  break: [[0.16, 'reload_out'], [0.5, 'reload_in'], [0.78, 'reload_bolt']],
  launcher: [[0.18, 'reload_out'], [0.5, 'reload_in'], [0.8, 'reload_bolt']],
};
// Momento de la recarga en que la munición pasa al cargador (si se cancela después, se conserva)
const RELOAD_COMMIT = { mag: 0.62, pistol: 0.6, raygun: 0.6, lmg: 0.66, bolt: 0.6, revolver: 0.56, break: 0.52, launcher: 0.6 };

function reloadStyle(def) {
  switch (def.model) {
    case 'pistol': return 'pistol';
    case 'revolver': return 'revolver';
    case 'raygun': return 'raygun';
    case 'doublebarrel': return 'break';
    case 'shotgun': return def.mode === 'pump' ? 'shell' : 'mag';
    case 'lmg': return 'lmg';
    case 'sniper': return def.mode === 'bolt' ? 'bolt' : 'mag';
    case 'launcher': return 'launcher';
    default: return 'mag';
  }
}

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
    return { slot: a.temp ? null : a.slot, key: a.key, up: !!a.up, def, mag: am ? am.mag : 0, reserve: am ? am.reserve : 0 };
  }
  get isReloading() { return !!this.reload; }
  get isShieldOut() { return !!this.shieldOut; }
  get isDrinking() { return this.drinkT >= 0; }

  hudInfo() {
    const self = this.ctx && this.ctx.self;
    const a = this.active;
    const def = a ? weaponDef(a.key, a.up) : null;
    const am = def ? this._ammo() : null;
    const mag = am ? am.mag : null;
    const reserve = am ? am.reserve : null;
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
    this.ammo = new Map();            // k -> { up, mag, reserve }
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
    this.reload = null;
    this.cycle = null;
    this.autoReloadAt = -1;
    this.knifeT = -1; this.knifeHitDone = false; this.meleeCd = 0; this.knifeDur = KNIFE_DUR; this.knifeHitAt = KNIFE_HIT;
    this.throwT = -1; this.throwDone = false;
    this.drinkT = -1; this.drinkDur = DRINK_DUR; this.drinkKind = 'perk'; this.healKey = null;
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
    this.meleeCd = Math.max(0, this.meleeCd - dt);
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
      const am = this.ammo.get(w.k);
      if (!am || am.up !== w.up) this._fillAmmo(w.k, w.up);
    }
    for (const k of [...this.ammo.keys()]) if (!keep.has(k)) this.ammo.delete(k);
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
    const def = weaponDef(k, up);
    const am = { up: !!up, mag: def ? def.mag : 0, reserve: def ? def.reserve : 0 };
    this.ammo.set(k, am);
    return am;
  }

  _ammo() {
    const a = this.active;
    if (!a) return null;
    if (a.temp) {
      if (!this.tempAmmo) this.tempAmmo = { up: false, mag: LAST_STAND_AMMO.mag, reserve: LAST_STAND_AMMO.reserve };
      return this.tempAmmo;
    }
    const am = this.ammo.get(a.key);
    if (am && am.up === a.up) return am;
    return this._fillAmmo(a.key, a.up);
  }

  _refillReserve(k, up) {
    const am = this.ammo.get(k);
    if (!am || am.up !== !!up) { this._fillAmmo(k, up); return; }
    const def = weaponDef(k, up);
    if (def) am.reserve = def.reserve;
  }

  _refillAll() {
    for (const w of this.inv) if (w) this._refillReserve(w.k, w.up);
    if (this.tempAmmo) this.tempAmmo.reserve = LAST_STAND_AMMO.reserve;
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
    this.tempAmmo = { up: false, mag: LAST_STAND_AMMO.mag, reserve: LAST_STAND_AMMO.reserve };
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
    this.reload = null;
    this.cycle = null;
    this.burstLeft = 0;
    this.fireQueued = -1;
    this.autoReloadAt = -1;
  }

  // Corta además cuchillo, granada, bebida y golpe de escudo
  _cancelAll() {
    this._interrupt();
    this.knifeT = -1;
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
    if (input.pressed('shield') && alive) this._toggleShield(self);
    if (!this.lastStand && this.drinkT < 0 && this.throwT < 0) this._handleSwitch(input);
    if (input.pressed('melee') && alive) {
      if (this.shieldOut) this._tryBash();
      else this._tryKnife(self);
    }
    if (input.pressed('grenade') && alive) this._tryThrow();
    if (input.pressed('heal') && alive) this._requestHeal(self);
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
      this.knifeT = -1;
    } else {
      this.bashT = -1;
      this._scheduleAutoReload(0.45);
    }
    this._play('switch', { volume: 0.8, rate: 0.8 });
  }

  // ================================================================== disparo
  _fireBlocked(player) {
    const vm = this.vm;
    return vm.switching || this.knifeT >= 0 || this.throwT >= 0 || this.drinkT >= 0 || this.bashT >= 0 ||
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
    if (this.reload && this.reload.kind === 'shell' && am.mag > 0 && (pressed || held)) this.reload = null;
    if (this.reload || this.cycle || this._fireBlocked(player)) {
      if (this.reload || this._fireBlocked(player)) this.burstLeft = 0;
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
      if (am.mag <= 0) {
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
        if (am.mag <= 0) this.burstLeft = 0;
        if (this.burstLeft === 0) this.fireCd += interval * 1.8;
      }
      if (def.mode === 'pump' || def.mode === 'bolt') {
        if (am.mag > 0) {
          this.cycle = { style: def.mode, t: 0, dur: Math.max(0.3, interval * 0.9), sndAt: def.mode === 'pump' ? 0.3 : 0.22, snd: false };
        }
        break;
      }
      if (def.mode !== 'auto' && this.burstLeft <= 0) break;
    }
  }

  _dryFire(am) {
    this._play('empty', { volume: 0.8 });
    if (am.reserve > 0) this._tryReload();
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
    am.mag = Math.max(0, am.mag - 1);
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

    if (am.mag === 0 && am.reserve > 0) this._scheduleAutoReload(Math.min(0.3, interval));
    const ev = ctx.events;
    if (ev && typeof ev.emit === 'function') ev.emit('weapons:fired', { key, up, o: arr2(o) });
  }

  _shootHitscan(def, key, up, o, d, muzzle, spread, doors) {
    const targets = this._targets();
    const pellets = Math.max(1, def.pellets | 0);
    const pen = Math.max(1, def.pen | 0);
    const hits = [];
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
      for (const h of tr.hits) {
        hits.push([zidOf(h.id), h.part, r2(h.t)]);
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
    return !this.reload && this.knifeT < 0 && this.throwT < 0 && this.drinkT < 0 && this.bashT < 0 &&
      !this.shieldOut && !this.vm.switching;
  }

  _tryReload() {
    const def = this._def(), am = this._ammo();
    if (!def || def.melee || !am) return false;
    if (am.mag >= def.mag || am.reserve <= 0) return false;
    if (!this._reloadAllowed()) return false;
    this._startReload(def, am);
    return true;
  }

  _startReload(def, am) {
    const a = this.active;
    const sc = this._hasPerk('speedcola') ? 0.5 : 1;
    const style = reloadStyle(def);
    this.burstLeft = 0;
    this.cycle = null;
    this.autoReloadAt = -1;
    this.fireQueued = -1;
    if (style === 'shell') {
      const per = clamp((def.reload - 0.6) / Math.max(1, def.mag), 0.22, 0.6) * sc;
      this.reload = {
        kind: 'shell', key: a.key, up: !!a.up, phase: 'in', t: 0, tilt: 0, shell: 0, pump: -1, pumpSnd: false,
        per, inDur: 0.28 * sc, outDur: 0.25 * sc, pumpDur: 0.5 * sc, wasEmpty: am.mag === 0, added: false,
      };
    } else {
      this.reload = {
        kind: 'full', key: a.key, up: !!a.up, style, t: 0, dur: Math.max(0.2, def.reload * sc), wasEmpty: am.mag === 0,
        committed: false, commitAt: RELOAD_COMMIT[style] || 0.62, sfx: RELOAD_SFX[style] || RELOAD_SFX.mag, si: 0,
      };
    }
  }

  _updateReload(dt) {
    const r = this.reload;
    if (!r) return;
    const a = this.active;
    const def = this._def();
    const am = this._ammo();
    if (!a || !def || !am || a.key !== r.key || !!a.up !== r.up) { this.reload = null; return; }
    if (r.kind === 'full') {
      r.t += dt;
      const p = r.t / r.dur;
      while (r.si < r.sfx.length && p >= r.sfx[r.si][0]) {
        const s = r.sfx[r.si++];
        if (!s[2] || r.wasEmpty) this._play(s[1], { volume: 0.85 });
      }
      if (!r.committed && p >= r.commitAt) {
        r.committed = true;
        const take = Math.min(def.mag - am.mag, am.reserve);
        if (take > 0) { am.mag += take; am.reserve -= take; }
      }
      if (r.t >= r.dur) this.reload = null;
      return;
    }
    // cartucho a cartucho (escopetas de bombeo)
    if (r.phase === 'in') {
      r.t += dt;
      r.tilt = Math.min(1, r.t / r.inDur);
      if (r.t >= r.inDur) { r.phase = 'load'; r.t = 0; r.shell = 0; r.added = false; }
    } else if (r.phase === 'load') {
      r.t += dt;
      r.shell = Math.min(1, r.t / r.per);
      if (!r.added && r.shell >= 0.6) {
        r.added = true;
        if (am.mag < def.mag && am.reserve > 0) {
          am.mag++;
          am.reserve--;
          this._play('reload_in', { volume: 0.8, rate: 0.95 + Math.random() * 0.1 });
        }
      }
      if (r.t >= r.per) {
        if (am.mag < def.mag && am.reserve > 0) { r.t = 0; r.shell = 0; r.added = false; }
        else { r.phase = 'out'; r.t = 0; r.shell = 0; r.pump = r.wasEmpty ? 0 : -1; r.pumpSnd = false; }
      }
    } else {
      r.t += dt;
      r.tilt = Math.max(0, 1 - r.t / r.outDur);
      let total = r.outDur;
      if (r.pump >= 0) {
        total = Math.max(r.outDur, r.pumpDur);
        r.pump = Math.min(1, r.t / r.pumpDur);
        if (!r.pumpSnd && r.pump >= 0.3) { r.pumpSnd = true; this._play('pump', { volume: 0.9 }); }
      }
      if (r.t >= total) this.reload = null;
    }
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
    if (am && am.mag === 0 && am.reserve > 0) this.autoReloadAt = this.time + Math.max(0, delay);
  }

  _updateAutoReload() {
    if (this.autoReloadAt < 0 || this.time < this.autoReloadAt) return;
    const def = this._def(), am = this._ammo();
    if (!def || def.melee || !am || am.mag > 0 || am.reserve <= 0 || this.reload) { this.autoReloadAt = -1; return; }
    if (this._reloadAllowed() && !this.cycle) {
      this.autoReloadAt = -1;
      this._startReload(def, am);
    }
  }

  // ================================================================== apuntar, jugador y mira telescópica
  _updateAds(dt, canAct, input, player) {
    const def = this._def();
    const want = !!(canAct && input && input.isDown('ads') && def && !def.melee && !this.reload && !this.shieldOut &&
      this.drinkT < 0 && this.knifeT < 0 && this.throwT < 0 && this.bashT < 0 && !this.vm.switching &&
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
    const want = !!(def && def.cls === 'sniper' && this.adsAmount >= 0.94 && !this.reload);
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
    s.reload = this._reloadAnim();
    if (this.cycle) {
      this._cs.style = this.cycle.style;
      this._cs.p = this.cycle.t / this.cycle.dur;
      s.cycle = this._cs;
    } else s.cycle = null;
    s.slideLocked = !!(def && am && am.mag === 0 && !this.reload && def.model === 'pistol');
    s.shieldOut = !!this.shieldOut;
    return s;
  }

  _reloadAnim() {
    const r = this.reload;
    if (!r) return null;
    if (r.kind === 'shell') {
      const o = this._rs;
      o.tilt = r.tilt;
      o.shell = r.phase === 'load' ? r.shell : 0;
      o.pump = r.phase === 'out' ? r.pump : -1;
      return o;
    }
    const o = this._ra;
    o.style = r.style;
    o.p = r.t / r.dur;
    o.wasEmpty = r.wasEmpty;
    return o;
  }

  // ================================================================== cuchillo, escudo, granadas y ventajas
  _updateActions(dt) {
    if (this.knifeT >= 0) {
      this.knifeT += dt;
      if (!this.knifeHitDone && this.knifeT >= this.knifeHitAt) { this.knifeHitDone = true; this._knifeHit(); }
      if (this.knifeT >= this.knifeDur) this.knifeT = -1;
    }
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

  _tryKnife(self) {
    if (this.knifeT >= 0 || this.throwT >= 0 || this.drinkT >= 0 || this.meleeCd > 0) return;
    this._interrupt();
    const ms = meleeStats(self.melee);
    this.knifeT = 0;
    this.knifeHitDone = false;
    this.knifeDur = ms.dur;
    this.knifeHitAt = ms.hit;
    this.meleeCd = ms.cd;
    this._safe('vm.playKnife', () => this.vm.playKnife(ms.key, ms.dur));
    this._play('knife', { volume: 0.9, rate: ms.dur > 0.5 ? 0.7 : 1 });
  }

  _knifeHit() {
    const self = this.ctx.self, p = this.ctx.player;
    if (!self || self.state !== 'alive' || !p || !p.position) return;
    const eyeY = p.eye ? p.eye.y : p.position.y + PLAYER.eyeHeight;
    const ms = meleeStats(self.melee);
    const list = meleeTargets(this._targets(), p.position.x, p.position.z, eyeY, p.yaw || 0,
      ms.range, ms.arc, ms.targets, this._doors());
    if (!list.length) return;
    this._send({ t: 'melee', hits: list.map((z) => zidOf(z.id)), shield: false });
    const heavy = ms.key !== 'knife';
    for (const z of list) {
      const dir = new V3(z.x - p.position.x, 0, z.z - p.position.z);
      if (dir.lengthSq() > 1e-6) dir.normalize(); else dir.set(0, 0, -1);
      this._fx('blood', new V3(z.x, z.y, z.z), dir, heavy ? 1.6 : 1.1);
      this._ents('hitReact', z.id, 'b');
    }
    this._hud('hitmarker', 'hit');
    this._play(ms.knock ? 'bash' : 'knife_hit', { volume: 0.9 });
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
    if (this.throwT >= 0 || this.knifeT >= 0 || this.drinkT >= 0 || this.bashT >= 0) return;
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

  _requestHeal(self) {
    if (self.healing) { this._send({ t: 'heal', item: null }); return; }   // volver a pulsar H cancela
    if (this.drinkT >= 0 || this.throwT >= 0 || this.knifeT >= 0) return;
    const item = this._pickMed(self);
    if (!item) {
      const meds = self.meds || {};
      const any = (meds.bandage | 0) + (meds.antidote | 0) + (meds.medkit | 0) > 0;
      this._hud('message', !any ? 'No tienes curas' : self.infected ? 'Necesitas un antídoto o un botiquín' : 'Ya tienes la salud al máximo', 1.8);
      this._play('deny', { volume: 0.6 });
      return;
    }
    this._send({ t: 'heal', item });
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
