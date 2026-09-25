// Interacción con el mundo: detecta el interactuable más cercano, muestra el aviso "Pulsa F..."
// y envía 'use' (pulsación) u 'hold' (mantener: ventanas, mesa del escudo, reanimar).

import { INTERACTABLES, DOORS, SHIELD_PARTS } from '/shared/map.js';
import { WEAPONS, weaponName, ammoPrice } from '/shared/weapons.js';
import { PERKS, PERK_LIMIT, perkPrice } from '/shared/perks.js';
import { PLAYER, BOX, PAP, SHIELD, MELEE, MEDS, REPAIR_TIME, BOARDS_PER_WINDOW, clamp } from '/shared/constants.js';

const LOOK_ANGLE = (70 * Math.PI) / 180;   // puertas y armas de pared: hay que mirarlas
const ANGLE_WEIGHT = 0.35;                  // desempate por ángulo entre objetivos casi equidistantes
const PROMPT_REFRESH = 0.5;                 // s: reenvía el aviso aunque no cambie (por si el HUD se reinició)
const USE_REPEAT_MS = 180;

const DOOR_BY_ID = Object.fromEntries(DOORS.map((d) => [d.id, d]));
const PART_NAME = Object.fromEntries(SHIELD_PARTS.map((p) => [p.id, p.name]));

function sameId(a, b) { return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b); }
function nowMs() { return performance.now(); }

export class Interaction {
  constructor(ctx) {
    this.ctx = ctx;
    this.target = null;       // { id, kind, mode: 'use'|'hold'|'info', text, cost, pid? }
    this.holding = null;      // id del 'hold' activo (on:true enviado)
    this._holdStart = 0;
    this._lastPrompt = undefined;
    this._promptAge = 0;
    this._lastProgress = undefined;
    this._lastUse = { id: null, t: 0 };

    const ev = ctx && ctx.events;
    if (ev && typeof ev.on === 'function') {
      // Sincroniza el ciclo local de reconstrucción con cada tabla que coloca el servidor
      ev.on('ev:board', (e) => {
        if (e && this.holding && this.holding === `win:${e.win}` && sameId(e.pid, this.ctx.selfId)) this._holdStart = nowMs();
      });
      // Sin conexión no se puede enviar el 'on:false': solo se olvida
      ev.on('net:close', () => { this.holding = null; });
      ev.on('welcome', () => { this.holding = null; });
    }
  }

  get isHolding() { return !!this.holding; }

  // Suelta el 'hold' activo (si lo hay)
  release() {
    if (this.holding) {
      this._send({ t: 'hold', id: this.holding, on: false });
      this.holding = null;
    }
    this._setProgress(null);
  }

  update(dt) {
    const ctx = this.ctx;
    const gs = ctx.gs;
    const self = ctx.self;
    const player = ctx.player;
    const input = ctx.input;
    const weapons = ctx.weapons;

    const active = !!(gs && gs.phase === 'playing' && self && self.state === 'alive' && player &&
      player.position && !(weapons && weapons.isDrinking) && !(ctx.net && ctx.net.connected === false));

    let target = null;
    if (active) {
      try { target = this._findTarget(gs, self, player); } catch (err) { target = null; }
    }
    this.target = target;

    // Mantener (hold): on al empezar; off al soltar, alejarse o cambiar de objetivo
    const useDown = active && input && input.isDown('use');
    const desired = target && target.mode === 'hold' && useDown ? target.id : null;
    if (desired !== this.holding) {
      if (this.holding) this._send({ t: 'hold', id: this.holding, on: false });
      this.holding = desired;
      if (desired) {
        this._send({ t: 'hold', id: desired, on: true });
        this._holdStart = nowMs();
      }
    }

    // Pulsación (use)
    if (active && target && input && input.pressed('use')) {
      if (target.mode === 'use') this._doUse(target, self);
      else if (target.mode === 'info') this._deny(null);
    }

    // Aviso en pantalla
    this._promptAge += dt;
    this._setPrompt(target ? target.text : null);

    // Barra de progreso
    let prog = null;
    if (this.holding && target && target.id === this.holding) prog = this._progress(target, gs, self);
    this._setProgress(prog);
  }

  // ------------------------------------------------------------------ búsqueda
  _findTarget(gs, self, player) {
    const px = player.position.x, pz = player.position.z;
    const yaw = player.yaw || 0;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);

    // 1) Compañeros caídos cercanos: prioridad sobre todo lo demás
    let bestRevive = null, bestRD = Infinity;
    for (const key of Object.keys(gs.players || {})) {
      const pl = gs.players[key];
      if (!pl || pl.state !== 'down') continue;
      const pid = pl.id !== undefined ? pl.id : key;
      if (sameId(pid, this.ctx.selfId)) continue;
      const pos = this._playerPos(pid);
      if (!pos) continue;
      const d = Math.hypot(pos.x - px, pos.z - pz);
      if (d <= PLAYER.reviveRange && d < bestRD) {
        bestRD = d;
        bestRevive = {
          id: `revive:${pid}`, kind: 'revive', mode: 'hold', pid,
          text: `Mantén F para reanimar a ${pl.name || 'tu compañero'}`,
        };
      }
    }
    if (bestRevive) return bestRevive;

    // 2) Interactuables del mapa
    let best = null, bestScore = Infinity;
    for (let i = 0; i < INTERACTABLES.length; i++) {
      const it = INTERACTABLES[i];
      const d = Math.hypot(it.x - px, it.z - pz);
      if (d > it.range) continue;
      // Ángulo entre la vista y el objetivo
      const ax = (it.wx !== undefined ? it.wx : it.cx !== undefined ? it.cx : it.x) - px;
      const az = (it.wz !== undefined ? it.wz : it.cz !== undefined ? it.cz : it.z) - pz;
      const al = Math.hypot(ax, az);
      let angle = 0;
      if (al > 0.05) angle = Math.acos(clamp((ax * fx + az * fz) / al, -1, 1));
      if ((it.kind === 'door' || it.kind === 'wallbuy' || it.kind === 'med') && al > 0.05 && angle > LOOK_ANGLE) continue;
      const score = d + angle * ANGLE_WEIGHT;
      if (score >= bestScore) continue;
      const info = this._describe(it, gs, self);
      if (!info) continue;
      best = info;
      bestScore = score;
    }
    return best;
  }

  _playerPos(pid) {
    const ctx = this.ctx;
    const ents = ctx.entities;
    if (ents && typeof ents.getPlayerVisual === 'function') {
      try {
        const v = ents.getPlayerVisual(Number(pid));
        if (v && v.position && isFinite(v.position.x)) return v.position;
      } catch { /* usar la red */ }
    }
    const snap = ctx.net && ctx.net.lastSnapshot;
    if (snap && snap.p) {
      const s = snap.p.get(Number(pid)) || snap.p.get(String(pid));
      if (s) return s;
    }
    return null;
  }

  _currentWeapon(self) {
    const w = this.ctx.weapons;
    const cur = w && w.current;
    if (cur && cur.key) return { k: cur.key, up: !!cur.up };
    if (w && !w.__stub && w.current === null) return null;   // sin armas en la mano
    const list = Array.isArray(self.weapons) ? self.weapons : [];
    const i = Number.isInteger(self.cur) ? self.cur : 0;
    const e = list[i];
    return e && e.k ? { k: e.k, up: !!e.up } : null;
  }

  // Texto y tipo de acción de un interactuable (null = nada que hacer ahí)
  _describe(it, gs, self) {
    const base = { id: it.id, kind: it.kind, cost: 0 };
    switch (it.kind) {
      case 'door': {
        if (gs.doors && gs.doors[it.door]) return null;
        const d = DOOR_BY_ID[it.door];
        const cost = d ? d.cost : 0;
        const text = d && d.kind === 'debris'
          ? `Pulsa F para despejar los escombros [Costo: ${cost}]`
          : `Pulsa F para abrir la puerta [Costo: ${cost}]`;
        return { ...base, mode: 'use', text, cost };
      }
      case 'wallbuy': {
        const key = it.weapon;
        const def = WEAPONS[key];
        if (!def) return null;
        if (key === 'bowie' || def.melee) {
          if (self.melee === key) return null;
          const cost = def.price || MELEE.bowiePrice;
          return { ...base, mode: 'use', text: `Pulsa F para comprar el ${def.name} [Costo: ${cost}]`, cost };
        }
        const owned = (Array.isArray(self.weapons) ? self.weapons : []).find((w) => w && w.k === key);
        if (!owned) {
          return { ...base, mode: 'use', text: `Pulsa F para comprar ${def.name} [Costo: ${def.price}]`, cost: def.price || 0 };
        }
        const cost = ammoPrice(key, !!owned.up);
        const text = owned.up
          ? `Pulsa F para comprar munición mejorada [Costo: ${cost}]`
          : `Pulsa F para comprar munición [Costo: ${cost}]`;
        return { ...base, mode: 'use', text, cost };
      }
      case 'perk': {
        const perk = PERKS[it.perk];
        if (!perk) return null;
        const perks = Array.isArray(self.perks) ? self.perks : [];
        if (perks.includes(it.perk)) return null;
        if (!gs.power) return { ...base, mode: 'info', text: 'Se requiere electricidad' };
        const nPlayers = Object.keys(gs.players || {}).length;
        if (it.perk === 'quickrevive' && nPlayers <= 1 && (self.qrUses || 0) >= PLAYER.soloQuickReviveUses) return null;
        if (perks.length >= PERK_LIMIT) return { ...base, mode: 'info', text: `Solo puedes tener ${PERK_LIMIT} ventajas` };
        const cost = perkPrice(it.perk, nPlayers);
        return { ...base, mode: 'use', text: `Pulsa F para comprar ${perk.name} [Costo: ${cost}]`, cost };
      }
      case 'power': {
        if (gs.power) return null;
        return { ...base, mode: 'use', text: 'Pulsa F para activar la electricidad' };
      }
      case 'box': {
        const slots = gs.box && Array.isArray(gs.box.slots) ? gs.box.slots : null;
        const slot = slots ? slots[it.box] : null;
        if (!slot) return null;
        if (slot.state === 'idle') {
          const cost = this._fireSale(gs) ? BOX.fireSalePrice : BOX.price;
          return { ...base, mode: 'use', text: `Pulsa F para abrir la Caja Misteriosa [Costo: ${cost}]`, cost };
        }
        if (slot.state === 'ready' && sameId(slot.user, this.ctx.selfId) && slot.weapon) {
          return { ...base, mode: 'use', text: `Pulsa F para tomar ${weaponName(slot.weapon)}` };
        }
        return null;
      }
      case 'pap': {
        const pap = gs.pap || {};
        if (!gs.power) return { ...base, mode: 'info', text: 'Se requiere electricidad' };
        if (pap.state === 'ready' && sameId(pap.user, this.ctx.selfId) && pap.weapon) {
          return { ...base, mode: 'use', text: `Pulsa F para tomar ${weaponName(pap.weapon, true)}` };
        }
        if (!pap.state || pap.state === 'idle') {
          const cur = this._currentWeapon(self);
          if (!cur || cur.up) return null;
          const def = WEAPONS[cur.k];
          if (!def || !def.pap) return null;
          return { ...base, mode: 'use', text: `Pulsa F para mejorar tu arma [Costo: ${PAP.price}]`, cost: PAP.price };
        }
        return null;
      }
      case 'med': {
        const def = MEDS[it.item];
        if (!def) return null;
        const have = self.meds ? (self.meds[it.item] | 0) : 0;
        if (have >= def.max) return { ...base, mode: 'info', text: `Ya llevas el máximo de ${def.plural.toLowerCase()} (${def.max})` };
        const what = def.pack > 1 ? `${def.plural} x${def.pack}` : def.name;
        return { ...base, mode: 'use', text: `Pulsa F para comprar: ${what} [Costo: ${def.price}]`, cost: def.price };
      }
      case 'part': {
        const parts = gs.shield && Array.isArray(gs.shield.parts) ? gs.shield.parts : null;
        if (!parts || parts[it.part]) return null;
        return { ...base, mode: 'use', text: `Pulsa F para recoger: ${PART_NAME[it.part] || 'pieza del escudo'}` };
      }
      case 'bench': {
        const sh = gs.shield || {};
        const parts = Array.isArray(sh.parts) ? sh.parts : [];
        const n = parts.filter(Boolean).length;
        if (!sh.built) {
          if (n < SHIELD.parts) return { ...base, mode: 'info', text: `Faltan piezas del escudo (${n}/${SHIELD.parts})` };
          return { ...base, mode: 'hold', text: 'Mantén F para construir el Escudo Antidisturbios' };
        }
        if (self.shield) return null;
        return { ...base, mode: 'use', text: 'Pulsa F para tomar el Escudo Antidisturbios' };
      }
      case 'window': {
        const n = Array.isArray(gs.windows) ? gs.windows[it.window] : undefined;
        if (typeof n !== 'number' || n >= BOARDS_PER_WINDOW) return null;
        return { ...base, mode: 'hold', text: 'Mantén F para reconstruir la barricada' };
      }
      default:
        return null;
    }
  }

  _fireSale(gs) {
    const until = gs.timers && gs.timers.firesale;
    if (!until) return false;
    const net = this.ctx.net;
    const now = net && typeof net.serverNow === 'function' ? net.serverNow() : Date.now();
    return until > now;
  }

  // ------------------------------------------------------------------ acciones
  _doUse(target, self) {
    if (target.cost > 0 && (Number(self.points) || 0) < target.cost) {
      this._deny('No tienes suficientes puntos');
      return;
    }
    const t = nowMs();
    if (this._lastUse.id === target.id && t - this._lastUse.t < USE_REPEAT_MS) return;
    this._lastUse = { id: target.id, t };
    this._send({ t: 'use', id: target.id });
  }

  _deny(msg) {
    const a = this.ctx.audio;
    if (a && typeof a.play === 'function') { try { a.play('deny'); } catch { /* nada */ } }
    if (msg) {
      const hud = this.ctx.hud;
      if (hud && typeof hud.message === 'function') { try { hud.message(msg, 2); } catch { /* nada */ } }
    }
  }

  _send(obj) {
    const net = this.ctx.net;
    if (net && typeof net.send === 'function') return net.send(obj);
    return false;
  }

  _progress(target, gs, self) {
    const net = this.ctx.net;
    const now = net && typeof net.serverNow === 'function' ? net.serverNow() : Date.now();
    const held = (nowMs() - this._holdStart) / 1000;
    const perks = Array.isArray(self.perks) ? self.perks : [];
    if (target.kind === 'revive') {
      const total = PLAYER.reviveTime * (perks.includes('quickrevive') ? 0.5 : 1);
      const pl = gs.players && gs.players[target.pid];
      if (pl && sameId(pl.reviver, this.ctx.selfId) && pl.reviveUntil > 0) {
        return clamp(1 - (pl.reviveUntil - now) / (total * 1000), 0, 1);
      }
      return clamp(held / total, 0, 0.98);
    }
    if (target.kind === 'bench') {
      const sh = gs.shield || {};
      const total = SHIELD.buildTime;
      if (sh.buildUntil > 0 && (sh.builder === null || sh.builder === undefined || sameId(sh.builder, this.ctx.selfId))) {
        return clamp(1 - (sh.buildUntil - now) / (total * 1000), 0, 1);
      }
      return clamp(held / total, 0, 0.98);
    }
    if (target.kind === 'window') {
      const rt = REPAIR_TIME * (perks.includes('speedcola') ? 0.5 : 1);
      return rt > 0 ? (held % rt) / rt : null;
    }
    return null;
  }

  // ------------------------------------------------------------------ HUD
  _setPrompt(text) {
    if (text === this._lastPrompt && this._promptAge < PROMPT_REFRESH) return;
    this._lastPrompt = text;
    this._promptAge = 0;
    const hud = this.ctx.hud;
    if (hud && typeof hud.setPrompt === 'function') {
      try { hud.setPrompt(text); } catch { /* nada */ }
    }
  }

  _setProgress(v) {
    if (v === null || v === undefined) {
      if (this._lastProgress === null) return;
      this._lastProgress = null;
    } else {
      if (typeof this._lastProgress === 'number' && Math.abs(this._lastProgress - v) < 0.002) return;
      this._lastProgress = v;
    }
    const hud = this.ctx.hud;
    if (hud && typeof hud.setProgress === 'function') {
      try { hud.setProgress(this._lastProgress); } catch { /* nada */ }
    }
  }
}

export default Interaction;
