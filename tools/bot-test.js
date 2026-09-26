// Bots headless para probar el servidor (SPEC.md 5.4).
// Uso: node tools/bot-test.js --bots 2 --seconds 120 --url ws://localhost:3000 [--scenario] [--god] [--verbose]
//   --scenario  (requiere servidor con --dev) el bot 1 recorre el mapa probando compras: puerta, pared, caja,
//               Pack-a-Punch, ventajas, escudo, potenciadores y salto de ronda.
//   --god       los bots usan /god (requiere --dev) para probar rondas altas sin caer.

import WebSocket from 'ws';
import { INTERACTABLE_BY_ID, PLAYER_SPAWNS, WINDOW_INFO, zoneAt } from '../shared/map.js';
import { moveCircle, solidForPlayer, lineOfSight } from '../shared/collision.js';
import { WEAPONS, weaponDef, fireInterval } from '../shared/weapons.js';
import { PLAYER, MELEE, GRENADE, PLAYER_COLORS, yawTo, forwardXZ } from '../shared/constants.js';
import { PF } from '../shared/protocol.js';
import { FlowField, clearPath } from '../server/nav.js';

// ------------------------------------------------------------------ argumentos

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) return true;
  return v;
}
const NBOTS = Math.max(1, Math.min(4, parseInt(arg('bots', 2), 10) || 2));
const SECONDS = Math.max(5, parseFloat(arg('seconds', 120)) || 120);
const URL = String(arg('url', 'ws://localhost:3000'));
const ROOM_CODE = String(arg('room', 'BOTS1')).toUpperCase().slice(0, 8);
const SCENARIO = !!arg('scenario', false);
const GOD = !!arg('god', false);
const VERBOSE = !!arg('verbose', false);

const T0 = Date.now();
const stamp = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const log = (...a) => console.log(stamp(), ...a);
const vlog = (...a) => { if (VERBOSE) log(...a); };

// ------------------------------------------------------------------ estadísticas globales

const stats = {
  maxRound: 0, games: 0, gameovers: [], kills: 0, headshots: 0, downs: 0, revives: 0, bleedouts: 0,
  events: {}, denies: {}, errors: [], kicks: [], snaps: 0, gsMsgs: 0, boards: { torn: 0, repaired: 0 },
  scenario: [],
};
function countEv(e) { stats.events[e] = (stats.events[e] || 0) + 1; }

// ------------------------------------------------------------------ bot

class Bot {
  constructor(index) {
    this.index = index;
    this.name = `Bot${index + 1}`;
    this.id = null;
    this.gs = null;
    this.zombies = new Map();
    this.x = PLAYER_SPAWNS[index % 4].x;
    this.z = PLAYER_SPAWNS[index % 4].z;
    this.yaw = 0;
    this.pitch = 0;
    this.flags = 0;
    this.field = new FlowField();
    this.goal = null;
    this.goalKey = '';
    this.fieldAt = 0;
    this.nextFireAt = 0;
    this.mag = {};              // munición por clave de arma
    this.reserve = {};
    this.reloadUntil = 0;
    this.nextMeleeAt = 0;
    this.nextNadeAt = Date.now() + 20000;
    this.pendingNades = [];
    this.holdId = null;
    this.wander = null;
    this.wanderUntil = 0;
    this.lastPhase = null;
    this.startSent = false;
    this.closed = false;
    this.seen = {};             // eventos recibidos por nombre (para el escenario)
    this.lastGive = null;
    this.connect();
  }

  get self() { return this.gs && this.id != null ? this.gs.players[this.id] : null; }
  get doors() { return (this.gs && this.gs.doors) || {}; }

  connect() {
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => {
      const room = this.index === 0
        ? { mode: 'create', code: ROOM_CODE, name: 'Bots' }
        : { mode: 'join', code: ROOM_CODE };
      this.send({ t: 'hello', name: this.name, color: PLAYER_COLORS[this.index % PLAYER_COLORS.length], room });
    });
    this.ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(data.toString()); } catch { stats.errors.push(`${this.name}: JSON inválido del servidor`); return; }
      try { this.onMessage(m); } catch (e) { stats.errors.push(`${this.name}: excepción en el bot: ${e.stack || e}`); }
    });
    this.ws.on('close', (code) => {
      if (!this.closed) stats.errors.push(`${this.name}: conexión cerrada inesperadamente (código ${code})`);
      this.closed = true;
    });
    this.ws.on('error', (e) => stats.errors.push(`${this.name}: error de WebSocket: ${e.message}`));
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() {
    this.closed = true;
    try { this.ws.close(); } catch { /* nada */ }
  }

  onMessage(m) {
    switch (m.t) {
      case 'welcome':
        this.id = m.id;
        this.gs = m.gs;
        log(`${this.name} conectado como #${m.id}${m.host ? ' (anfitrión)' : ''}${m.dev ? ' [dev]' : ''}; LAN: ${(m.lan || []).join(', ') || '-'}`);
        break;
      case 'gs': {
        stats.gsMsgs++;
        const prev = this.gs;
        this.gs = m;
        if (m.phase !== this.lastPhase) {
          if (this.index === 0) log(`fase: ${this.lastPhase} -> ${m.phase}`);
          if (m.phase === 'lobby') { this.startSent = false; this.zombies.clear(); }
          if (m.phase === 'playing' && this.index === 0) stats.games++;
          this.lastPhase = m.phase;
        }
        if (m.round > stats.maxRound) stats.maxRound = m.round;
        this.syncAmmo(prev);
        break;
      }
      case 'snap':
        if (this.index === 0) stats.snaps++;
        this.zombies.clear();
        for (const z of m.z || []) this.zombies.set(z[0], { id: z[0], x: z[1], z: z[2], rot: z[3], anim: z[4], flags: z[5] });
        break;
      case 'ev':
        this.onEvent(m);
        break;
      case 'kick':
        stats.kicks.push(`${this.name}: ${m.reason}`);
        log(`${this.name} expulsado: ${m.reason}`);
        break;
      default: break;
    }
  }

  onEvent(ev) {
    this.seen[ev.e] = (this.seen[ev.e] || 0) + 1;
    const mine = ev.pid === this.id;
    if (this.index === 0) countEv(ev.e);
    switch (ev.e) {
      case 'respawn':
        if (mine) { this.x = ev.x; this.z = ev.z; this.yaw = ev.yaw || 0; this.goal = null; }
        break;
      case 'roundStart':
        if (this.index === 0) log(`=== RONDA ${ev.round} === (zombis: ${this.gs ? this.gs.zLeft : '?'})`);
        break;
      case 'zdie':
        if (mine) { stats.kills++; if (ev.fx === 'head') stats.headshots++; }
        break;
      case 'down':
        if (this.index === 0) { stats.downs++; log(`jugador #${ev.pid} cayó`); }
        break;
      case 'revived':
        if (this.index === 0) { stats.revives++; log(`jugador #${ev.pid} reanimado por ${ev.by == null ? 'sí mismo' : '#' + ev.by}`); }
        break;
      case 'bleedout':
        if (this.index === 0) { stats.bleedouts++; log(`jugador #${ev.pid} se desangró`); }
        break;
      case 'gameover':
        if (this.index === 0) {
          stats.gameovers.push(ev.round);
          log(`FIN DE LA PARTIDA en la ronda ${ev.round}: ${ev.stats.map((s) => `${s.name} ${s.points}p/${s.kills}k`).join(', ')}`);
        }
        break;
      case 'deny':
        stats.denies[ev.reason] = (stats.denies[ev.reason] || 0) + 1;
        vlog(`${this.name} deny: ${ev.reason}`);
        break;
      case 'give':
        this.lastGive = ev;
        setTimeout(() => this.fillSlot(ev.slot), 0);
        break;
      case 'ammo':
        this.fillAll();
        break;
      case 'pu':
        if (ev.type === 'maxammo') this.fillAll();
        if (this.index === 0) log(`potenciador ${ev.type} recogido por #${ev.pid}`);
        break;
      case 'puSpawn':
        if (this.index === 0) vlog(`aparece potenciador ${ev.type} en (${ev.x}, ${ev.z})`);
        break;
      case 'board':
        if (this.index === 0) { if (ev.pid == null) stats.boards.torn++; else stats.boards.repaired++; }
        break;
      case 'msg':
        vlog(`${this.name} msg: ${ev.text}`);
        break;
      case 'chat':
        vlog(`chat ${ev.name}: ${ev.msg}`);
        break;
      default: break;
    }
  }

  // ---- munición llevada en el cliente
  syncAmmo() {
    const s = this.self;
    if (!s) return;
    for (const w of s.weapons || []) {
      const k = w.k + (w.up ? '+' : '');
      if (this.mag[k] === undefined) {
        const def = weaponDef(w.k, w.up);
        if (!def) continue;
        this.mag[k] = def.mag; this.reserve[k] = def.reserve;
      }
    }
  }
  fillSlot(slot) {
    const s = this.self;
    const w = s && s.weapons[slot];
    if (!w) return;
    const def = weaponDef(w.k, w.up);
    if (!def) return;
    const k = w.k + (w.up ? '+' : '');
    this.mag[k] = def.mag; this.reserve[k] = def.reserve;
  }
  fillAll() {
    const s = this.self;
    if (!s) return;
    for (let i = 0; i < s.weapons.length; i++) this.fillSlot(i);
  }

  // ---- navegación
  setGoal(x, z) {
    const key = Math.floor(x) + ',' + Math.floor(z);
    if (!this.goal || this.goalKey !== key) {
      this.goal = { x, z };
      this.goalKey = key;
      this.fieldAt = 0;
    } else {
      this.goal.x = x; this.goal.z = z;
    }
  }

  moveTowardsGoal(dt, speed) {
    if (!this.goal) return false;
    const now = Date.now();
    const solid = (cx, cz) => solidForPlayer(cx, cz, this.doors);
    if (now - this.fieldAt > 500) {
      this.field.compute([this.goal], this.doors);
      this.fieldAt = now;
    }
    let tx = this.goal.x, tz = this.goal.z;
    const dGoal = Math.hypot(tx - this.x, tz - this.z);
    if (dGoal < 0.25) return true;
    if (!clearPath(this.x, this.z, tx, tz, PLAYER.radius, solid)) {
      const path = this.field.follow(Math.floor(this.x), Math.floor(this.z), 4);
      if (path.length) {
        let pick = path[0];
        for (let k = path.length - 1; k >= 1; k--) {
          if (clearPath(this.x, this.z, path[k][0] + 0.5, path[k][1] + 0.5, PLAYER.radius, solid)) { pick = path[k]; break; }
        }
        tx = pick[0] + 0.5; tz = pick[1] + 0.5;
      }
    }
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return dGoal < 0.6;
    const step = Math.min(d, speed * dt);
    const r = moveCircle(this.x, this.z, (dx / d) * step, (dz / d) * step, PLAYER.radius, solid);
    this.x = r.x; this.z = r.z;
    this.moveYaw = yawTo(0, 0, dx, dz);
    return false;
  }

  nearIt(id, extra = 0) {
    const it = INTERACTABLE_BY_ID[id];
    return it && Math.hypot(it.x - this.x, it.z - this.z) <= it.range + extra;
  }

  goTo(id) {
    const it = INTERACTABLE_BY_ID[id];
    if (!it) return false;
    this.setGoal(it.x, it.z);
    return this.nearIt(id, -0.3);
  }

  setHold(id) {
    if (this.holdId === id) return;
    if (this.holdId) this.send({ t: 'hold', id: this.holdId, on: false });
    this.holdId = id;
    if (id) this.send({ t: 'hold', id, on: true });
  }

  // ---- combate
  currentWeapon() {
    const s = this.self;
    if (!s) return null;
    if (s.state === 'down') {
      const w = s.weapons.find((q) => WEAPONS[q.k] && (WEAPONS[q.k].cls === 'pistol' || WEAPONS[q.k].cls === 'wonder'));
      return w || { k: 'm1911', up: false };
    }
    return s.weapons[s.cur] || s.weapons[0] || null;
  }

  combat(now) {
    const s = this.self;
    if (!s || (s.state !== 'alive' && s.state !== 'down')) return;
    const ex = this.x, ey = s.state === 'down' ? PLAYER.downEyeHeight : PLAYER.eyeHeight, ez = this.z;
    let best = null, bd = Infinity;
    for (const z of this.zombies.values()) {
      const d = Math.hypot(z.x - ex, z.z - ez);
      if (d > 15 || d >= bd) continue;
      const hy = (z.flags & 1) ? 0.35 : 1.62;
      if (!lineOfSight(ex, ey, ez, z.x, hy, z.z, this.doors)) continue;
      best = z; bd = d;
    }
    // Granadas cuando hay grupos cerca
    for (const n of this.pendingNades.slice()) {
      if (now >= n.at) {
        this.pendingNades.splice(this.pendingNades.indexOf(n), 1);
        this.send({ t: 'boom', w: 'frag', up: false, p: n.p, direct: null });
      }
    }
    if (s.state === 'alive' && s.grenades > 0 && now >= this.nextNadeAt && best) {
      let close = 0;
      for (const z of this.zombies.values()) if (Math.hypot(z.x - best.x, z.z - best.z) < 3) close++;
      if (close >= 3 && bd > 4) {
        const f = forwardXZ(this.yaw);
        this.send({ t: 'nade', o: [ex, ey, ez], v: [f.x * GRENADE.throwSpeed, GRENADE.upSpeed, f.z * GRENADE.throwSpeed] });
        this.pendingNades.push({ at: now + GRENADE.fuse * 1000, p: [best.x, 0.2, best.z] });
        this.nextNadeAt = now + 15000;
      }
    }
    if (!best) return;
    this.yaw = yawTo(ex, ez, best.x, best.z);
    // Cuchillo si está encima
    if (s.state === 'alive' && bd < MELEE.range && now >= this.nextMeleeAt) {
      this.nextMeleeAt = now + MELEE.cooldown * 1000 + 50;
      const useShield = !!s.shield && Math.random() < 0.5;
      this.send({ t: 'melee', hits: [best.id], shield: useShield });
      return;
    }
    const w = this.currentWeapon();
    if (!w || now < this.nextFireAt || now < this.reloadUntil) return;
    const def = weaponDef(w.k, w.up);
    if (!def || def.melee) return;
    const k = w.k + (w.up ? '+' : '');
    if (this.mag[k] === undefined) { this.mag[k] = def.mag; this.reserve[k] = def.reserve; }
    if (this.mag[k] <= 0) {
      if (this.reserve[k] > 0) {
        const n = Math.min(def.mag, this.reserve[k]);
        this.reserve[k] -= n; this.mag[k] = n;
        this.reloadUntil = now + def.reload * 1000;
      }
      return;
    }
    this.mag[k]--;
    const dt = s.perks && s.perks.includes('doubletap');
    this.nextFireAt = now + Math.max(fireInterval(def, dt) * 1000, def.mode === 'auto' ? 0 : 180);
    const hy = (best.flags & 1) ? 0.35 : 1.62;
    const dx = best.x - ex, dy = hy - ey, dz = best.z - ez;
    const len = Math.hypot(dx, dy, dz) || 1;
    const dir = [dx / len, dy / len, dz / len];
    this.pitch = Math.asin(Math.max(-1, Math.min(1, dir[1])));
    if (def.projectile) {
      this.send({ t: 'proj', w: w.k, up: !!w.up, o: [ex, ey, ez], d: dir });
      const travel = len / (def.projectile.speed || 40);
      setTimeout(() => this.send({ t: 'boom', w: w.k, up: !!w.up, p: [best.x, 1.0, best.z], direct: best.id }), travel * 1000);
      return;
    }
    const part = Math.random() < 0.75 ? 'h' : 'b';
    const hits = [];
    const pellets = def.pellets || 1;
    for (let i = 0; i < pellets; i++) if (i === 0 || Math.random() < 0.6) hits.push([best.id, part, Math.round(len * 100) / 100]);
    this.send({ t: 'fire', w: w.k, up: !!w.up, o: [ex, ey, ez], d: dir, e: [best.x, hy, best.z], hits });
  }

  // ---- comportamiento general
  think(now, dt) {
    const s = this.self;
    const gs = this.gs;
    if (!gs || !s) return;
    if (gs.phase === 'lobby' && s.host && !this.startSent && bots.every((b) => b.self)) {
      this.startSent = true;
      setTimeout(() => { log(`${this.name} inicia la partida`); this.send({ t: 'start' }); }, 800);
      return;
    }
    if (gs.phase !== 'playing') return;
    if (GOD && !this.godSent) { this.godSent = true; this.send({ t: 'chat', msg: '/god' }); }

    if (s.state === 'dead') { this.setHold(null); return; }
    this.combat(now);
    if (s.state === 'down') { this.setHold(null); this.flags = PF.DOWN; this.sendState(); return; }
    this.flags = 0;

    if (SCENARIO && this.index === 0 && scenario.active) {
      scenario.step(this, now, dt);
      this.sendState();
      return;
    }

    // 1) Reanimar a un compañero caído
    const downed = Object.values(gs.players).find((p) => p.id !== this.id && p.state === 'down' && (p.reviver == null || p.reviver === this.id));
    if (downed) {
      const other = bots.find((b) => b.id === downed.id);
      const tx = other ? other.x : this.x, tz = other ? other.z : this.z;
      const d = Math.hypot(tx - this.x, tz - this.z);
      if (d <= PLAYER.reviveRange - 0.3) {
        this.setHold('revive:' + downed.id);
      } else {
        this.setHold(null);
        this.setGoal(tx, tz);
        this.moveTowardsGoal(dt, PLAYER.walkSpeed);
      }
      this.sendState();
      return;
    }
    if (this.holdId && this.holdId.startsWith('revive:')) this.setHold(null);

    // 2) El anfitrión compra la puerta A en cuanto puede; los demás compran la M14 de la pared
    if (this.index === 0 && !gs.doors.A && s.points >= 750) {
      if (this.goTo('door:A') || this.nearIt('door:A', -0.2)) this.send({ t: 'use', id: 'door:A' });
      else this.moveTowardsGoal(dt, PLAYER.walkSpeed);
      this.sendState();
      return;
    }
    if (!s.weapons.some((w) => w.k === 'm14') && s.points >= 1300) {
      if (this.goTo('wall:wb0')) this.send({ t: 'use', id: 'wall:wb0' });
      else this.moveTowardsGoal(dt, PLAYER.walkSpeed);
      this.sendState();
      return;
    }

    // 3) Reconstruir ventanas de la Terminal si no hay zombis cerca
    const nearZ = [...this.zombies.values()].some((z) => Math.hypot(z.x - this.x, z.z - this.z) < 3.5 && !(z.flags & 8));
    let repairing = false;
    if (!nearZ) {
      const myWin = [0, 1, 2][this.index % 3];
      const wins = [myWin, 0, 1, 2];
      for (const wi of wins) {
        if ((gs.windows[wi] | 0) >= 6) continue;
        const id = 'win:' + wi;
        if (this.goTo(id)) { this.setHold(id); repairing = true; }
        else { this.setHold(null); this.moveTowardsGoal(dt, PLAYER.walkSpeed); repairing = true; }
        break;
      }
    }
    if (!repairing) {
      if (this.holdId && this.holdId.startsWith('win:')) this.setHold(null);
      // 4) Deambular por la Terminal
      if (!this.wander || now > this.wanderUntil || Math.hypot(this.wander.x - this.x, this.wander.z - this.z) < 0.4) {
        for (let tries = 0; tries < 20; tries++) {
          const x = 5 + Math.random() * 12, z = 21 + Math.random() * 10;
          if (!solidForPlayer(Math.floor(x), Math.floor(z), this.doors) && zoneAt(Math.floor(x), Math.floor(z)) === 0) {
            this.wander = { x: Math.floor(x) + 0.5, z: Math.floor(z) + 0.5 };
            break;
          }
        }
        this.wanderUntil = now + 5000;
      }
      if (this.wander) { this.setGoal(this.wander.x, this.wander.z); this.moveTowardsGoal(dt, PLAYER.walkSpeed * 0.8); }
    }
    this.sendState();
  }

  sendState() {
    const s = this.self;
    this.send({ t: 'st', p: [this.x, 0, this.z], yaw: this.yaw, pitch: this.pitch, f: this.flags, cur: s ? s.cur : 0 });
  }
}

// ------------------------------------------------------------------ escenario de compras (modo dev)

const scenario = {
  active: SCENARIO,
  i: 0,
  t0: 0,
  sub: 0,
  waitUntil: 0,
  results: stats.scenario,
  steps: [],
  step(bot, now, dt) {
    if (!bot.gs || bot.gs.roundState === 'pre') return;
    const st = this.steps[this.i];
    if (!st) { this.active = false; log('ESCENARIO: completado'); return; }
    if (!this.t0) { this.t0 = now; this.sub = 0; this.baseline = { ...bot.seen }; log(`ESCENARIO: ${st.name}`); }
    let res = null;
    try { res = st.run.call(this, bot, now, dt); } catch (e) { res = 'error: ' + (e.stack || e); }
    if (res === undefined || res === null) {
      if (now - this.t0 > (st.timeout || 20000)) res = 'tiempo agotado';
      else return;
    }
    const ok = res === true;
    this.results.push({ name: st.name, ok, detail: ok ? '' : String(res) });
    log(`ESCENARIO: ${st.name} -> ${ok ? 'OK' : 'FALLO (' + res + ')'}`);
    this.i++;
    this.t0 = 0;
  },
  gotSince(bot, e) { return (bot.seen[e] || 0) > (this.baseline[e] || 0); },
};

scenario.steps = [
  {
    name: 'comandos dev: /points /power /doors /god',
    run(bot, now) {
      if (this.sub === 0) {
        for (const msg of ['/points 90000', '/power', '/doors', '/god']) bot.send({ t: 'chat', msg });
        this.sub = 1;
        return null;
      }
      const g = bot.gs;
      if (g.power && g.doors.A && g.doors.F && bot.self.points >= 90000 && g.openZones.length === 5) return true;
      return null;
    },
  },
  {
    name: 'comprar arma de pared (MP5)',
    run(bot) {
      if (bot.self.weapons.some((w) => w.k === 'mp5')) return this.gotSince(bot, 'give') ? true : 'sin evento give';
      if (bot.goTo('wall:wb2')) { if (this.sub++ % 10 === 0) bot.send({ t: 'use', id: 'wall:wb2' }); } else bot.moveTowardsGoal(1 / 20, 6);
      return null;
    },
    timeout: 25000,
  },
  {
    name: 'comprar munición de la MP5',
    run(bot) {
      if (this.gotSince(bot, 'ammo')) return true;
      if (bot.goTo('wall:wb2')) { if (this.sub++ % 10 === 0) bot.send({ t: 'use', id: 'wall:wb2' }); } else bot.moveTowardsGoal(1 / 20, 6);
      return null;
    },
  },
  {
    name: 'caja misteriosa: abrir, esperar y tomar el arma',
    run(bot, now) {
      const loc = bot.gs.box.loc;
      const id = 'box:' + loc;
      const slot = bot.gs.box.slots[loc];
      if (!bot.goTo(id)) { bot.moveTowardsGoal(1 / 20, 6); return null; }
      if (this.sub === 0) { if (slot.state === 'idle') { bot.send({ t: 'use', id }); this.sub = 1; } return null; }
      if (this.sub === 1) {
        if (slot.state === 'ready' && slot.user === bot.id) {
          this.weapon = slot.weapon;
          bot.send({ t: 'use', id });
          this.sub = 2;
          return null;
        }
        if (slot.state === 'teddy') return true; // salió el osito: también es válido
        return null;
      }
      if (bot.self.weapons.some((w) => w.k === this.weapon) && this.gotSince(bot, 'give')) return true;
      return null;
    },
    timeout: 30000,
  },
  {
    name: 'Pack-a-Punch: mejorar el arma en la mano y recogerla',
    run(bot, now) {
      const pap = bot.gs.pap;
      if (!bot.goTo('pap')) { bot.moveTowardsGoal(1 / 20, 6); return null; }
      if (this.sub === 0) {
        const cw = bot.self.weapons[bot.self.cur];
        if (!cw || cw.up) {
          if (!this.giveAt || now - this.giveAt > 1500) { this.giveAt = now; bot.send({ t: 'chat', msg: '/give mp5' }); }
          return null;
        }
        this.weapon = cw.k;
        bot.send({ t: 'use', id: 'pap' });
        this.sub = 1;
        return null;
      }
      if (this.sub === 1) {
        if (pap.state === 'ready' && pap.user === bot.id) { bot.send({ t: 'use', id: 'pap' }); this.sub = 2; }
        return null;
      }
      if (bot.self.weapons.some((w) => w.k === this.weapon && w.up)) return this.gotSince(bot, 'papStart') && this.gotSince(bot, 'papReady') ? true : 'faltan eventos papStart/papReady';
      return null;
    },
    timeout: 40000,
  },
  {
    name: 'ventaja: comprar Speed Cola en la máquina',
    run(bot) {
      if (bot.self.perks.includes('speedcola')) return this.gotSince(bot, 'perk') ? true : 'sin evento perk';
      if (bot.goTo('perk:speedcola')) { if (this.sub++ % 10 === 0) bot.send({ t: 'use', id: 'perk:speedcola' }); } else bot.moveTowardsGoal(1 / 20, 6);
      return null;
    },
    timeout: 30000,
  },
  {
    name: 'escudo: /parts, construir (mantener) y tomarlo',
    run(bot) {
      if (this.sub === 0) { bot.send({ t: 'chat', msg: '/parts' }); this.sub = 1; return null; }
      if (bot.self.shield) { bot.setHold(null); return this.gotSince(bot, 'built') ? true : 'sin evento built'; }
      if (!bot.goTo('bench')) { bot.moveTowardsGoal(1 / 20, 6); return null; }
      if (!bot.gs.shield.built) bot.setHold('bench');
      else { bot.setHold(null); if (this.sub++ % 10 === 0) bot.send({ t: 'use', id: 'bench' }); }
      return null;
    },
    timeout: 30000,
  },
  {
    name: 'potenciador: /pu doublepoints y recogerlo',
    run(bot, now) {
      if (this.sub === 0) { bot.send({ t: 'chat', msg: '/pu doublepoints' }); this.sub = 1; this.at = now; return null; }
      const pu = bot.gs.powerups.find((p) => p.type === 'doublepoints');
      if (pu) { bot.setGoal(pu.x, pu.z); bot.moveTowardsGoal(1 / 20, 5); }
      if (bot.gs.timers.doublepoints > 0 && this.gotSince(bot, 'pu')) return true;
      return null;
    },
  },
  {
    name: 'ventanas: reconstruir una tabla arrancada',
    run(bot) {
      const g = bot.gs;
      let wi = this.win;
      if (wi == null) {
        const broken = g.windows.findIndex((n, i) => n < 6 && g.openZones.includes(WINDOW_INFO[i].zone));
        if (broken < 0) return null; // esperar a que los zombis arranquen alguna
        this.win = wi = broken;
        this.start = g.windows[wi];
      }
      const id = 'win:' + wi;
      if (!bot.goTo(id)) { bot.setHold(null); bot.moveTowardsGoal(1 / 20, 6); return null; }
      bot.setHold(id);
      if (this.gotSince(bot, 'board') && g.windows[wi] > this.start) { bot.setHold(null); return true; }
      if (g.windows[wi] >= 6) { bot.setHold(null); return true; }
      return null;
    },
    timeout: 45000,
  },
  {
    name: 'salto de ronda: /round 6',
    run(bot) {
      if (this.sub === 0) { bot.send({ t: 'chat', msg: '/round 6' }); this.sub = 1; return null; }
      if (bot.gs.round >= 6 && bot.gs.roundState === 'active') return true;
      return null;
    },
    timeout: 15000,
  },
  {
    name: 'volver a la Terminal',
    run(bot) {
      bot.setGoal(10.5, 29.5);
      if (bot.moveTowardsGoal(1 / 20, 6)) { bot.send({ t: 'chat', msg: '/god' }); return true; }
      return null;
    },
    timeout: 30000,
  },
];

// ------------------------------------------------------------------ mensajes malformados (robustez)

function fuzz() {
  const ws = new WebSocket(URL);
  ws.on('open', () => {
    const junk = [
      'hola', '{', '[]', 'null', '{"t":5}', '{"t":"st","p":"x"}', '{"t":"fire","hits":[[null,"h",1e99]]}',
      JSON.stringify({ t: 'hello', name: { a: 1 }, color: 12 }),
      JSON.stringify({ t: 'st', p: [NaN, 'a', null], yaw: 'x', cur: 99 }),
      JSON.stringify({ t: 'fire', w: 'raygun', up: 1, o: [0, 0], d: null, hits: 'x' }),
      JSON.stringify({ t: 'fire', w: 'm1911', up: false, o: [1, 1, 1], d: [0, 0, -1], hits: [[1, 'h', -5], [2], 'x', [3.5, 'b', 1]] }),
      JSON.stringify({ t: 'boom', w: 'frag', p: [1, 2, 3], direct: 'a' }),
      JSON.stringify({ t: 'melee', hits: [1, 2, 3, 'x', null], shield: true }),
      JSON.stringify({ t: 'use', id: { toString: 1 } }),
      JSON.stringify({ t: 'use', id: 'door:A' }),
      JSON.stringify({ t: 'hold', id: 'revive:abc', on: true }),
      JSON.stringify({ t: 'hold', id: 'win:999', on: true }),
      JSON.stringify({ t: 'chat', msg: 'x'.repeat(5000) }),
      JSON.stringify({ t: 'chat', msg: '/give raygun up' }),
      JSON.stringify({ t: 'ping', c: 'no' }),
      JSON.stringify({ t: '__proto__' }),
      JSON.stringify({ t: 'constructor' }),
    ];
    for (const j of junk) ws.send(j);
    ws.send(Buffer.from([0, 1, 2, 3]));
    setTimeout(() => ws.close(), 500);
  });
  ws.on('error', () => { /* el servidor puede rechazar: no es un fallo del bot */ });
}

// ------------------------------------------------------------------ ejecución

log(`Conectando ${NBOTS} bot(s) a ${URL} durante ${SECONDS} s${SCENARIO ? ' (con escenario de compras)' : ''}${GOD ? ' (modo dios)' : ''}`);
const bots = [];
for (let i = 0; i < NBOTS; i++) bots.push(new Bot(i));
setTimeout(fuzz, 1500);

let last = Date.now();
const loop = setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const b of bots) {
    if (b.closed) continue;
    try { b.think(now, dt); } catch (e) { stats.errors.push(`${b.name}: excepción en think: ${e.stack || e}`); }
  }
}, 50);

const statusTimer = setInterval(() => {
  const b = bots[0];
  if (!b || !b.gs) return;
  const g = b.gs;
  const ps = Object.values(g.players).map((p) => `${p.name}:${p.state}/${p.hp}hp/${p.points}p`).join(' ');
  log(`[estado] fase=${g.phase} ronda=${g.round} (${g.roundState}) quedan=${g.zLeft} vivos=${b.zombies.size} | ${ps}`);
}, 10000);

setTimeout(() => {
  clearInterval(loop);
  clearInterval(statusTimer);
  for (const b of bots) b.close();
  console.log('\n================ RESUMEN ================');
  console.log(`Ronda máxima alcanzada: ${stats.maxRound}`);
  console.log(`Partidas iniciadas: ${stats.games}   Fines de partida: ${stats.gameovers.length ? stats.gameovers.join(', ') : 'ninguno'}`);
  console.log(`Bajas de los bots: ${stats.kills} (a la cabeza: ${stats.headshots})`);
  console.log(`Caídas: ${stats.downs}   Reanimaciones: ${stats.revives}   Desangrados: ${stats.bleedouts}`);
  console.log(`Tablas arrancadas: ${stats.boards.torn}   reparadas: ${stats.boards.repaired}`);
  console.log(`Snapshots recibidos (bot 1): ${stats.snaps}   Mensajes gs: ${stats.gsMsgs}`);
  console.log(`Eventos (bot 1): ${Object.entries(stats.events).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`Denegaciones: ${Object.entries(stats.denies).map(([k, v]) => `${k}=${v}`).join(' ') || 'ninguna'}`);
  if (stats.scenario.length) {
    console.log('Escenario:');
    for (const r of stats.scenario) console.log(`  [${r.ok ? 'OK' : 'FALLO'}] ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  }
  if (stats.kicks.length) console.log(`Expulsiones: ${stats.kicks.join(' | ')}`);
  console.log(`Errores: ${stats.errors.length}`);
  for (const e of stats.errors.slice(0, 20)) console.log('  - ' + e);
  const scenarioFail = stats.scenario.some((r) => !r.ok);
  const ok = stats.errors.length === 0 && stats.maxRound >= 1 && !scenarioFail;
  console.log(ok ? 'RESULTADO: OK' : 'RESULTADO: CON PROBLEMAS');
  setTimeout(() => process.exit(ok ? 0 : 1), 300);
}, SECONDS * 1000);
