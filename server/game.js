// Clase Game: estado de juego autoritativo (gs), mensajes de los clientes, economía y reglas
// (puertas, armas de pared, caja misteriosa, Pack-a-Punch, ventajas, escudo, potenciadores,
// caer/reanimar/desangrarse, rondas y fin de partida). Ver SPEC.md secciones 2 a 5.

import {
  MAX_PLAYERS, TICK_RATE, GS_MAX_RATE, SNAPSHOT_RATE, PLAYER, POINTS, BOARDS_PER_WINDOW, REPAIR_TIME,
  BOX, PAP, SHIELD, MELEE, GRENADE, POWERUPS, PLAYER_COLORS, clamp, angleDiff, yawTo, forwardXZ,
  MEDS, MED_KEYS, MED_DROPS, INFECTION,
} from '../shared/constants.js';
import {
  W, H, DOORS, WINDOW_INFO, INTERACTABLE_BY_ID, BOX_LOCATIONS, BOX_START, SHIELD_PARTS,
  PLAYER_SPAWNS, PLAYER_SPAWN_YAW, START_ZONE,
} from '../shared/map.js';
import { solidForPlayer, lineOfSight } from '../shared/collision.js';
import { WEAPONS, weaponDef, weaponName, BOX_POOL, ammoPrice, partMult, falloff, meleeStats } from '../shared/weapons.js';
import { PERKS, PERK_LIMIT, perkPrice } from '../shared/perks.js';
import { PF, r2, safeParse } from '../shared/protocol.js';
import { ZombieManager } from './zombies.js';

const DEG = Math.PI / 180;

// Curas con las que aparece un jugador
function freshMeds() { return { bandage: PLAYER.startBandages, antidote: 0, medkit: 0 }; }

// Elige una clave según pesos { clave: peso }
function pickWeighted(weights) {
  const entries = Object.entries(weights);
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = Math.random() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[entries.length - 1][0];
}
const GAMEOVER_TIME = 15000;          // ms en la pantalla final antes de volver al lobby
const TELEPORT_GRACE = 3000;          // ms tras reaparecer en los que se acepta cualquier salto de posición
const MAX_JUMP = 3;                   // m máximos por mensaje 'st'
const RESYNC_AFTER = 30;              // mensajes rechazados seguidos antes de aceptar la posición igualmente
const REVIVE_INVULN = 1500;           // ms de invulnerabilidad tras ser reanimado
const SPAWN_INVULN = 2000;            // ms de invulnerabilidad tras reaparecer
const NADE_WINDOW = 6000;             // ms de validez de una granada lanzada
const MSG_RATE_LIMIT = 250;           // mensajes por segundo por conexión
const PING_INTERVAL = 2000;
const PING_TIMEOUT = 20000;
const PERK_ORDER = Object.keys(PERKS);
const POWERUP_TYPES = POWERUPS.types;
const DENY_REASONS = new Set(['points', 'power', 'limit', 'full', 'busy', 'owned']);

// ------------------------------------------------------------------ utilidades de validación

function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function vec3(a, lim = 2000) {
  if (!Array.isArray(a) || a.length < 3) return null;
  const x = Number(a[0]), y = Number(a[1]), z = Number(a[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [r2(clamp(x, -lim, lim)), r2(clamp(y, -lim, lim)), r2(clamp(z, -lim, lim))];
}
function cleanText(s, max) {
  if (typeof s !== 'string') return '';
  // sin caracteres de control ni < > (el texto se muestra en el HUD)
  return s.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function weightedPick(pool) {
  let total = 0;
  for (const it of pool) total += Math.max(0, it.weight || 0);
  if (total <= 0) return pool.length ? pool[Math.floor(Math.random() * pool.length)].key : null;
  let r = Math.random() * total;
  for (const it of pool) {
    r -= Math.max(0, it.weight || 0);
    if (r <= 0) return it.key;
  }
  return pool[pool.length - 1].key;
}

export class Game {
  constructor(opts = {}) {
    this.dev = !!opts.dev;
    this.lan = Array.isArray(opts.lan) ? opts.lan.slice() : [];
    this.quiet = !!opts.quiet;
    this.conns = new Set();
    this.byPid = new Map();        // pid -> conexión
    this.pd = new Map();           // pid -> datos privados (posición, sostener, temporizadores...)
    this.nextPid = 1;
    this.gs = this._freshState();
    this.dirty = true;
    this.lastGsAt = 0;
    this.lastSnapAt = 0;
    this.lastPingAt = 0;
    this.lastTick = Date.now();
    this.nextPuId = 1;
    this.lastPuType = null;
    this.dropsThisRound = 0;
    this.medDropsThisRound = 0;
    this.nextItemId = 1;
    this.gameOverAt = 0;
    this.boxPriv = BOX_LOCATIONS.map(() => ({ teddy: false, weapon: null, paid: 0 }));
    this.errorCount = 0;
    this.zombies = new ZombieManager(this);
    this.timer = setInterval(() => this._tickSafe(), Math.round(1000 / TICK_RATE));
  }

  // ------------------------------------------------------------------ estado

  _freshState() {
    return {
      phase: 'lobby',
      round: 0,
      roundState: 'pre',
      roundUntil: 0,
      zLeft: 0,
      power: false,
      doors: {},
      openZones: [START_ZONE],
      windows: WINDOW_INFO.map(() => BOARDS_PER_WINDOW),
      box: {
        loc: BOX_START,
        uses: 0,
        slots: BOX_LOCATIONS.map((b) => ({ state: b.id === BOX_START ? 'idle' : 'off', user: null, weapon: null, until: 0 })),
      },
      pap: { state: 'idle', user: null, weapon: null, until: 0 },
      shield: { parts: SHIELD_PARTS.map(() => false), built: false, builder: null, buildUntil: 0 },
      powerups: [],
      items: [],                     // curas en el suelo: { id, type, x, z, until }
      timers: { instakill: 0, doublepoints: 0, firesale: 0 },
      players: {},
    };
  }

  // Reinicia el estado de un jugador para una partida nueva (conserva identidad)
  _resetPlayer(p) {
    Object.assign(p, {
      ready: false,
      points: PLAYER.startPoints, kills: 0, headshots: 0, downs: 0, revives: 0,
      state: 'alive',
      hp: PLAYER.health, maxHp: PLAYER.health,
      perks: [],
      weapons: [{ k: PLAYER.startWeapon, up: false }],
      cur: 0,
      grenades: PLAYER.startGrenades,
      melee: 'knife',
      shield: null,
      bleedUntil: 0, selfReviveAt: 0, reviver: null, reviveUntil: 0, qrUses: 0,
      infected: false, meds: freshMeds(), healing: null,
    });
    return p;
  }

  _newPlayer(pid, name, color, spawn) {
    const p = { id: pid, name, color, host: false, ready: false, spawn, ping: 0 };
    this._resetPlayer(p);
    // orden de campos estable como en SPEC.md
    return {
      id: p.id, name: p.name, color: p.color, host: p.host, ready: p.ready, spawn: p.spawn,
      points: p.points, kills: p.kills, headshots: p.headshots, downs: p.downs, revives: p.revives,
      state: p.state, hp: p.hp, maxHp: p.maxHp, perks: p.perks, weapons: p.weapons, cur: p.cur,
      grenades: p.grenades, melee: p.melee, shield: p.shield, bleedUntil: p.bleedUntil,
      selfReviveAt: p.selfReviveAt, reviver: p.reviver, reviveUntil: p.reviveUntil, qrUses: p.qrUses, ping: p.ping,
      infected: p.infected, meds: p.meds, healing: p.healing,
    };
  }

  _newPriv(spawn) {
    const sp = PLAYER_SPAWNS[spawn % PLAYER_SPAWNS.length];
    return {
      x: sp.x, y: 0, z: sp.z, yaw: PLAYER_SPAWN_YAW, pitch: 0, flags: 0,
      hasPos: false, teleportUntil: 0, badPos: 0,
      lastDamageAt: 0, invulnUntil: 0,
      hold: null, nades: [], lastMeleeAt: 0, boomTimes: [], fireTimes: [],
      repairPts: 0, god: false, chatTimes: [], bleedRemain: 0,
      infT: 0, infAcc: 0,
    };
  }

  markDirty() { this.dirty = true; }

  playerCount() { return Object.keys(this.gs.players).length; }

  _players() { return Object.values(this.gs.players); }

  _timerActive(key, now = Date.now()) { return (this.gs.timers[key] || 0) > now; }

  // ------------------------------------------------------------------ conexiones

  addConnection(ws, req) {
    const conn = {
      ws, pid: null,
      ip: (req && req.socket && req.socket.remoteAddress) || '?',
      lastPong: Date.now(), pingSentAt: 0,
      rateStart: Date.now(), rateCount: 0,
    };
    this.conns.add(conn);
    if (this.playerCount() >= MAX_PLAYERS) {
      this._kick(conn, 'La partida está llena (máximo 4 jugadores).');
      return conn;
    }
    ws.on('message', (data, isBinary) => {
      try {
        this._onMessage(conn, data, isBinary);
      } catch (e) {
        this._logError('mensaje', e);
      }
    });
    ws.on('pong', () => {
      const now = Date.now();
      conn.lastPong = now;
      if (conn.pingSentAt && conn.pid) {
        const p = this.gs.players[conn.pid];
        const rtt = Math.max(0, Math.min(9999, now - conn.pingSentAt));
        if (p && Math.abs((p.ping || 0) - rtt) >= 2) { p.ping = rtt; this.markDirty(); }
      }
    });
    ws.on('close', () => {
      try { this._onClose(conn); } catch (e) { this._logError('desconexión', e); }
    });
    ws.on('error', () => { /* el cierre se gestiona en 'close' */ });
    return conn;
  }

  _kick(conn, reason) {
    try {
      if (conn.ws.readyState === 1) conn.ws.send(JSON.stringify({ t: 'kick', reason }));
      setTimeout(() => { try { conn.ws.close(4000, 'kick'); } catch { /* ya cerrada */ } }, 100);
    } catch { /* nada */ }
  }

  _onClose(conn) {
    this.conns.delete(conn);
    if (conn.pid) {
      const pid = conn.pid;
      conn.pid = null;
      if (this.byPid.get(pid) === conn) this.byPid.delete(pid);
      this._removePlayer(pid);
    }
  }

  _removePlayer(pid) {
    const gs = this.gs;
    const p = gs.players[pid];
    if (!p) return;
    const d = this.pd.get(pid);
    const now = Date.now();
    if (d) this._cancelHold(p, d, now);
    // Otros que lo estaban reanimando
    this._cancelHoldsTargeting(pid, now);
    // Caja: sus giros/armas pendientes se liberan
    gs.box.slots.forEach((s, i) => {
      if (s.user === pid && (s.state === 'spinning' || s.state === 'ready')) this._closeBoxSlot(i);
      else if (s.user === pid) s.user = null;
    });
    // Pack-a-Punch: el arma se pierde
    if (gs.pap.user === pid) Object.assign(gs.pap, { state: 'idle', user: null, weapon: null, until: 0 });
    // Construcción del escudo
    if (gs.shield.builder === pid) { gs.shield.builder = null; gs.shield.buildUntil = 0; }

    const name = p.name;
    const wasHost = p.host;
    delete gs.players[pid];
    this.pd.delete(pid);
    if (wasHost) {
      const next = this._players().sort((a, b) => a.id - b.id)[0];
      if (next) next.host = true;
    }
    this.markDirty();
    this._log(`${name} (#${pid}) se desconectó. Jugadores: ${this.playerCount()}`);
    if (this.playerCount() === 0) {
      if (gs.phase !== 'lobby') this._returnToLobby();
      return;
    }
    this._system(`${name} salió de la partida.`);
    if (gs.phase === 'playing') this._checkGameOver(now);
  }

  // ------------------------------------------------------------------ envío

  _send(pid, obj) {
    const c = this.byPid.get(pid);
    if (!c || c.ws.readyState !== 1) return;
    try { c.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch { /* nada */ }
  }

  _broadcastRaw(str, exceptPid = null, skipIfBusy = false) {
    for (const [pid, c] of this.byPid) {
      if (pid === exceptPid) continue;
      if (c.ws.readyState !== 1) continue;
      if (skipIfBusy && c.ws.bufferedAmount > 1 << 20) continue; // cliente atascado: saltar snapshots
      try { c.ws.send(str); } catch { /* nada */ }
    }
  }

  // Evento { e, ... }. opts: { to: pid } | { except: pid } | {} (todos)
  _ev(obj, opts = {}) {
    const str = JSON.stringify({ t: 'ev', ...obj });
    if (opts.to != null) this._send(opts.to, str);
    else this._broadcastRaw(str, opts.except != null ? opts.except : null);
  }

  // API para ZombieManager
  broadcastEvent(obj) {
    if (!obj || typeof obj.e !== 'string') return;
    this._ev(obj);
  }

  _deny(pid, reason) {
    this._ev({ e: 'deny', pid, reason: DENY_REASONS.has(reason) ? reason : 'busy' }, { to: pid });
  }

  _msg(pid, text) { this._ev({ e: 'msg', pid, text }, { to: pid }); }

  _system(msg) { this._ev({ e: 'chat', pid: 0, name: 'Sistema', msg }); }

  _gsPayload(now = Date.now()) {
    return { t: 'gs', now, ...this.gs };
  }

  _sendGs(now = Date.now()) {
    this.dirty = false;
    this.lastGsAt = now;
    this._broadcastRaw(JSON.stringify(this._gsPayload(now)));
  }

  // Envía el estado ya (antes de eventos que dependen de él: give, respawn, down...)
  flushGs() {
    if (this.dirty) this._sendGs(Date.now());
  }

  _sendSnap(now) {
    const players = [];
    for (const p of this._players()) {
      if (p.state === 'dead') continue;
      const d = this.pd.get(p.id);
      if (!d || !d.hasPos) continue;
      let flags = d.flags & 0x3ff & ~(PF.DOWN | PF.UPGRADED);
      let w = '', up = 0;
      if (p.state === 'down') {
        flags |= PF.DOWN;
        const pistol = this._lastStandWeapon(p);
        w = pistol.k; up = pistol.up ? 1 : 0;
      } else {
        const cw = p.weapons[p.cur];
        if (cw) { w = cw.k; up = cw.up ? 1 : 0; }
      }
      if (up) flags |= PF.UPGRADED;
      players.push([p.id, r2(d.x), r2(d.y), r2(d.z), r2(d.yaw), r2(d.pitch), flags, w, up]);
    }
    const snap = { t: 'snap', now, z: this.zombies.snapshot(), p: players };
    this.lastSnapAt = now;
    this._broadcastRaw(JSON.stringify(snap), null, true);
  }

  _pingAll(now) {
    this.lastPingAt = now;
    for (const c of this.conns) {
      if (c.ws.readyState !== 1) continue;
      if (now - c.lastPong > PING_TIMEOUT) {
        try { c.ws.terminate(); } catch { /* nada */ }
        continue;
      }
      c.pingSentAt = now;
      try { c.ws.ping(); } catch { /* nada */ }
    }
  }

  // ------------------------------------------------------------------ bucle

  _tickSafe() {
    try { this._tick(); } catch (e) { this._logError('tick', e); }
  }

  _tick() {
    const now = Date.now();
    const dt = clamp((now - this.lastTick) / 1000, 0, 0.1);
    this.lastTick = now;
    const gs = this.gs;
    if (gs.phase === 'playing') {
      this._updatePlayers(dt, now);
      this._updateBox(now);
      this._updatePap(now);
      this._updatePowerups(now);
      this._updateItems(now);
      this._updateTimers(now);
      try { this.zombies.update(dt); } catch (e) { this._logError('zombis', e); }
      if (gs.phase === 'playing') this._checkGameOver(now);
    } else if (gs.phase === 'gameover') {
      if (now >= this.gameOverAt) this._returnToLobby();
    }
    if (this.gs.phase !== 'lobby' && now - this.lastSnapAt >= 1000 / SNAPSHOT_RATE - 5) this._sendSnap(now);
    if (this.dirty && now - this.lastGsAt >= 1000 / GS_MAX_RATE - 2) this._sendGs(now);
    if (now - this.lastPingAt >= PING_INTERVAL) this._pingAll(now);
  }

  // ------------------------------------------------------------------ mensajes

  _onMessage(conn, data, isBinary) {
    if (isBinary) return;
    const now = Date.now();
    if (now - conn.rateStart >= 1000) { conn.rateStart = now; conn.rateCount = 0; }
    if (++conn.rateCount > MSG_RATE_LIMIT) return;
    const m = safeParse(data);
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return;

    if (m.t === 'ping') {
      const c = isNum(m.c) ? m.c : 0;
      try { if (conn.ws.readyState === 1) conn.ws.send(JSON.stringify({ t: 'pong', c, now })); } catch { /* nada */ }
      return;
    }
    if (m.t === 'hello') { this._onHello(conn, m); return; }
    if (!conn.pid) return;
    const p = this.gs.players[conn.pid];
    const d = this.pd.get(conn.pid);
    if (!p || !d) return;

    switch (m.t) {
      case 'ready':
        if (this.gs.phase === 'lobby') { p.ready = !!m.v; this.markDirty(); }
        break;
      case 'start':
        if (this.gs.phase === 'lobby' && p.host) this.startGame();
        break;
      case 'st': this._onState(p, d, m, now); break;
      case 'fire': this._onFire(p, d, m, now); break;
      case 'proj': this._onProj(p, d, m); break;
      case 'nade': this._onNade(p, d, m, now); break;
      case 'boom': this._onBoom(p, d, m, now); break;
      case 'melee': this._onMelee(p, d, m, now); break;
      case 'use': this._onUse(p, d, m, now); break;
      case 'hold': this._onHold(p, d, m, now); break;
      case 'chat': this._onChat(p, d, m, now); break;
      case 'heal': this._onHeal(p, d, m, now); break;
      default: break;
    }
  }

  _onHello(conn, m) {
    const gs = this.gs;
    if (conn.pid) {
      // Cambio de nombre/color en el lobby
      const p = gs.players[conn.pid];
      if (p && gs.phase === 'lobby') {
        const name = cleanText(m.name, 16);
        if (name) p.name = name;
        p.color = this._pickColor(m.color, p.id);
        this.markDirty();
      }
      return;
    }
    if (this.playerCount() >= MAX_PLAYERS) {
      this._kick(conn, 'La partida está llena (máximo 4 jugadores).');
      return;
    }
    const pid = this.nextPid++;
    const name = cleanText(m.name, 16) || `Jugador ${pid}`;
    const color = this._pickColor(m.color, pid);
    const used = new Set(this._players().map((q) => q.spawn));
    let spawn = 0;
    while (used.has(spawn) && spawn < PLAYER_SPAWNS.length - 1) spawn++;
    const p = this._newPlayer(pid, name, color, spawn);
    p.host = this.playerCount() === 0;
    if (gs.phase !== 'lobby') {
      // Entra a mitad de partida: espera a la próxima ronda
      Object.assign(p, { state: 'dead', hp: 0, weapons: [], cur: 0, grenades: 0 });
    }
    gs.players[pid] = p;
    this.pd.set(pid, this._newPriv(spawn));
    conn.pid = pid;
    this.byPid.set(pid, conn);
    const now = Date.now();
    try {
      conn.ws.send(JSON.stringify({ t: 'welcome', id: pid, host: p.host, gs: this._gsPayload(now), lan: this.lan, dev: this.dev }));
    } catch { /* nada */ }
    this.markDirty();
    this._log(`${name} (#${pid}) se unió desde ${conn.ip}. Jugadores: ${this.playerCount()}`);
    this._system(`${name} se unió a la partida.`);
    if (gs.phase === 'playing') this._msg(pid, 'Entraste a mitad de partida: aparecerás al comenzar la próxima ronda.');
    if (this.dev) this._msg(pid, 'Modo desarrollo activo: escribe /help en el chat para ver los comandos.');
  }

  _pickColor(req, pid) {
    const taken = new Set(this._players().filter((q) => q.id !== pid).map((q) => q.color));
    const want = typeof req === 'string' ? PLAYER_COLORS.find((c) => c.toLowerCase() === req.toLowerCase()) : null;
    if (want && !taken.has(want)) return want;
    return PLAYER_COLORS.find((c) => !taken.has(c)) || want || PLAYER_COLORS[0];
  }

  _onState(p, d, m, now) {
    if (this.gs.phase !== 'playing') return;
    if (isNum(m.yaw)) d.yaw = r2(m.yaw);
    if (isNum(m.pitch)) d.pitch = r2(clamp(m.pitch, -1.5, 1.5));
    if (isNum(m.f)) d.flags = (m.f | 0) & 0x3ff;
    if (Number.isInteger(m.cur)) {
      const c = clamp(m.cur, 0, Math.max(0, p.weapons.length - 1));
      if (c !== p.cur) { p.cur = c; this.markDirty(); }
    }
    if (p.state === 'dead') return; // espectador: su posición no importa
    const pos = vec3(m.p, 500);
    if (!pos) return;
    const x = clamp(pos[0], 0, W), y = clamp(pos[1], -1, 10), z = clamp(pos[2], 0, H);
    const jump = Math.hypot(x - d.x, z - d.z);
    if (d.hasPos && jump > MAX_JUMP && now > d.teleportUntil) {
      if (++d.badPos < RESYNC_AFTER) return;
    }
    d.badPos = 0;
    d.x = x; d.y = y; d.z = z;
    d.hasPos = true;
  }

  // ---- combate

  _hasWeapon(p, w, up) {
    if (p.weapons.some((x) => x && x.k === w && !!x.up === up)) return true;
    return p.state === 'down' && w === 'm1911' && !up;
  }

  _lastStandWeapon(p) {
    const wonder = p.weapons.find((x) => WEAPONS[x.k] && WEAPONS[x.k].cls === 'wonder');
    if (wonder) return wonder;
    const pistol = p.weapons.find((x) => WEAPONS[x.k] && WEAPONS[x.k].cls === 'pistol');
    return pistol || { k: 'm1911', up: false };
  }

  _rate(list, now, windowMs, max) {
    while (list.length && now - list[0] > windowMs) list.shift();
    if (list.length >= max) return false;
    list.push(now);
    return true;
  }

  _onFire(p, d, m, now) {
    if (this.gs.phase !== 'playing') return;
    if (p.state !== 'alive' && p.state !== 'down') return;
    if (typeof m.w !== 'string') return;
    const w = m.w, up = !!m.up;
    if (!this._hasWeapon(p, w, up)) return;
    const def = weaponDef(w, up);
    if (!def || def.melee) return;
    if (!this._rate(d.fireTimes, now, 1000, 40)) return;
    const o = vec3(m.o), dir = vec3(m.d, 2);
    let e = vec3(m.e);
    if (o && dir) {
      if (!e) e = [r2(o[0] + dir[0] * 50), r2(o[1] + dir[1] * 50), r2(o[2] + dir[2] * 50)];
      // El campo 'e' del mensaje ya es el nombre del evento: el punto final del trazador viaja en 'end'
      this._ev({ e: 'fire', pid: p.id, w, up, o, d: dir, end: e }, { except: p.id });
    }
    if (def.projectile) return; // el daño llega con 'boom'
    const hits = Array.isArray(m.hits) ? m.hits : [];
    if (!hits.length) return;
    const maxHits = Math.max(1, def.pellets || 1) * Math.max(1, def.pen || 1) + 2;
    const instakill = this._timerActive('instakill', now);
    const mult = p.perks.includes('doubletap') ? 2 : 1;
    const survived = new Map();
    const killed = new Set();
    let n = 0;
    for (const h of hits) {
      if (n++ >= maxHits) break;
      if (!Array.isArray(h)) continue;
      const zid = h[0];
      if (!Number.isInteger(zid)) continue;
      if (killed.has(zid)) continue;
      const part = h[1] === 'h' || h[1] === 'l' ? h[1] : 'b';
      let dist = Number(h[2]);
      if (!Number.isFinite(dist) || dist < 0) dist = 0;
      if (dist > 150) continue;
      const zb = this.zombies.get(zid);
      if (!zb) continue;
      // coherencia básica: el zombi debe estar a una distancia plausible del tirador
      if (d.hasPos && Math.hypot(zb.x - d.x, zb.z - d.z) > 160) continue;
      const dmg = def.dmg * partMult(def, part) * falloff(def, dist) * mult;
      const res = this.zombies.damage(zid, dmg, p.id, {
        part, kind: 'bullet', weapon: w, upgraded: up, instakill, special: def.special || null,
      }) || {};
      if (!res.existed) continue;
      if (res.killed) { killed.add(zid); survived.delete(zid); } else if (!survived.has(zid)) survived.set(zid, part);
    }
    for (const [zid, part] of survived) {
      this._addPoints(p, POINTS.hit, true);
      this._ev({ e: 'zhit', id: zid, pid: p.id, part }, { except: p.id });
    }
  }

  _onProj(p, d, m) {
    if (this.gs.phase !== 'playing') return;
    if (p.state !== 'alive' && p.state !== 'down') return;
    if (typeof m.w !== 'string') return;
    const w = m.w, up = !!m.up;
    if (!this._hasWeapon(p, w, up)) return;
    const def = weaponDef(w, up);
    if (!def || !def.projectile) return;
    const o = vec3(m.o), dir = vec3(m.d, 2);
    if (!o || !dir) return;
    this._ev({ e: 'proj', pid: p.id, w, up, o, d: dir }, { except: p.id });
  }

  _onNade(p, d, m, now) {
    if (this.gs.phase !== 'playing' || p.state !== 'alive') return;
    if (p.grenades <= 0) return;
    const o = vec3(m.o), v = vec3(m.v, 60);
    if (!o || !v) return;
    p.grenades--;
    d.nades = d.nades.filter((t) => now - t <= NADE_WINDOW);
    d.nades.push(now);
    this.markDirty();
    this._ev({ e: 'nade', pid: p.id, o, v }, { except: p.id });
  }

  _onBoom(p, d, m, now) {
    if (this.gs.phase !== 'playing') return;
    if (p.state !== 'alive' && p.state !== 'down') return;
    if (typeof m.w !== 'string') return;
    const pos = vec3(m.p, 500);
    if (!pos) return;
    if (d.hasPos && Math.hypot(pos[0] - d.x, pos[2] - d.z) > 160) return;
    const w = m.w, up = !!m.up;
    let radius, splashDmg, directDmg;
    if (w === 'frag') {
      d.nades = d.nades.filter((t) => now - t <= NADE_WINDOW);
      if (!d.nades.length) return;
      d.nades.shift();
      radius = GRENADE.radius; splashDmg = GRENADE.damage; directDmg = 0;
    } else {
      if (!this._hasWeapon(p, w, up)) return;
      const def = weaponDef(w, up);
      if (!def || !def.projectile) return;
      if (!this._rate(d.boomTimes, now, 1000, 12)) return;
      const pr = def.projectile;
      radius = Math.max(0, pr.splash || 0);
      splashDmg = pr.splashDmg || 0;
      directDmg = pr.direct != null ? pr.direct : def.dmg;
    }
    this._ev({ e: 'boom', pid: p.id, w, up, p: pos, r: radius });

    const instakill = this._timerActive('instakill', now);
    const info = { part: 'b', kind: 'explosion', weapon: w, upgraded: up, instakill, special: null };
    const survived = new Set();
    const directId = Number.isInteger(m.direct) ? m.direct : null;
    if (directId !== null && directDmg > 0) {
      const z = this.zombies.get(directId);
      if (z && Math.hypot(z.x - pos[0], z.z - pos[2]) <= 3.5) {
        const res = this.zombies.damage(directId, directDmg, p.id, info) || {};
        if (res.existed && !res.killed) survived.add(directId);
      }
    }
    if (radius > 0 && splashDmg > 0) {
      const doors = this.gs.doors;
      for (const z of this.zombies.list().slice()) {
        if (z.dead || z.id === directId) continue;
        const dx = z.x - pos[0], dz = z.z - pos[2];
        const dy = Math.max(0, Math.abs(pos[1] - 0.9) - 0.9);
        const dist = Math.hypot(dx, dz, dy);
        if (dist > radius) continue;
        // El punto de impacto puede estar sobre la superficie de un muro: retroceder un poco hacia el zombi
        const flat = Math.hypot(dx, dz) || 1;
        const sx = pos[0] + (dx / flat) * Math.min(0.3, flat * 0.5);
        const sz = pos[2] + (dz / flat) * Math.min(0.3, flat * 0.5);
        const sy = clamp(pos[1], 0.2, 3.8);
        if (!lineOfSight(sx, sy, sz, z.x, 1.0, z.z, doors)) continue;
        const amount = splashDmg * (1 - 0.7 * dist / radius);
        const res = this.zombies.damage(z.id, amount, p.id, info) || {};
        if (res.existed && !res.killed) survived.add(z.id);
      }
    }
    for (const zid of survived) {
      if (!this.zombies.get(zid)) continue;
      this._addPoints(p, POINTS.hit, true);
      this._ev({ e: 'zhit', id: zid, pid: p.id, part: 'b' }, { except: p.id });
    }
  }

  _onMelee(p, d, m, now) {
    if (this.gs.phase !== 'playing' || p.state !== 'alive' || !d.hasPos) return;
    const shield = !!m.shield;
    if (shield && !p.shield) return;
    const ms = meleeStats(p.melee);
    const cd = (shield ? SHIELD.bashCooldown : ms.cd) * 1000 * 0.7;
    if (now - d.lastMeleeAt < cd) return;
    d.lastMeleeAt = now;
    const raw = Array.isArray(m.hits) ? m.hits : [];
    const ids = [...new Set(raw.filter((v) => Number.isInteger(v)))].slice(0, shield ? 8 : ms.targets);
    const range = (shield ? Math.max(SHIELD.bashRange, ms.range) : ms.range) + 1;
    const instakill = this._timerActive('instakill', now);
    for (const zid of ids) {
      const z = this.zombies.get(zid);
      if (!z) continue;
      if (Math.hypot(z.x - d.x, z.z - d.z) > range) continue;
      if (shield) {
        if (!p.shield) break;
        const res = this.zombies.damage(zid, SHIELD.bashDamage, p.id, {
          part: 'b', kind: 'shield', weapon: 'shield', upgraded: false, instakill, special: null, knockFrom: { x: d.x, z: d.z },
        }) || {};
        if (!res.existed) continue;
        if (!res.killed) {
          this.zombies.knockback(zid, d.x, d.z, SHIELD.knockback);
          this._addPoints(p, POINTS.hit, true);
          this._ev({ e: 'zhit', id: zid, pid: p.id, part: 'b' }, { except: p.id });
        }
        p.shield.hp -= SHIELD.bashSelfDamage;
        this.markDirty();
        if (p.shield.hp <= 0) this._breakShield(p);
      } else {
        const res = this.zombies.damage(zid, ms.dmg, p.id, {
          part: 'b', kind: 'melee', weapon: p.melee, upgraded: false, instakill, special: null,
          knockFrom: ms.knock ? { x: d.x, z: d.z } : undefined,
        }) || {};
        if (res.existed && !res.killed) {
          if (ms.knock) this.zombies.knockback(zid, d.x, d.z, ms.knock);
          this._addPoints(p, POINTS.hit, true);
          this._ev({ e: 'zhit', id: zid, pid: p.id, part: 'b' }, { except: p.id });
        }
      }
    }
  }

  // ---- curas e infección

  _onHeal(p, d, m, now) {
    if (this.gs.phase !== 'playing' || p.state !== 'alive') return;
    if (m.item == null) { if (p.healing) { p.healing = null; this.markDirty(); } return; }
    const item = typeof m.item === 'string' ? m.item : '';
    const def = MEDS[item];
    if (!def) return;
    if (p.healing) { this._deny(p.id, 'busy'); return; }
    if (!p.meds || (p.meds[item] | 0) <= 0) { this._msg(p.id, `No tienes ${def.plural.toLowerCase()}.`); return; }
    const useful = (def.cures && p.infected) || (def.heal > 0 && p.hp < p.maxHp);
    if (!useful) { this._msg(p.id, p.infected ? 'Eso no cura la infección.' : 'Ya tienes la salud al máximo.'); return; }
    p.healing = { item, until: now + def.useTime * 1000 };
    this.markDirty();
    this.flushGs();
    this._ev({ e: 'healStart', pid: p.id, item });
  }

  _finishHeal(p, d, now) {
    const item = p.healing.item;
    const def = MEDS[item];
    p.healing = null;
    this.markDirty();
    if (!def || !p.meds || (p.meds[item] | 0) <= 0) return;
    p.meds[item]--;
    if (def.heal > 0) p.hp = Math.min(p.maxHp, Math.round(p.hp + (Number.isFinite(def.heal) ? def.heal : p.maxHp)));
    if (def.cures && p.infected) { p.infected = false; d.infT = 0; d.infAcc = 0; }
    this._ev({ e: 'healed', pid: p.id, item });
  }

  _updateInfection(p, d, dt, now) {
    if (d.god && p.hp <= 1) return;   // con /god la infección baja la vida pero no derriba
    d.infT += dt;
    const dps = Math.min(INFECTION.dpsMax, INFECTION.dps + INFECTION.ramp * d.infT);
    d.infAcc += dps * dt;
    if (d.infAcc < 1) return;
    const n = Math.floor(d.infAcc);
    d.infAcc -= n;
    p.hp = Math.max(0, p.hp - n);
    this.markDirty();
    if (p.hp <= 0) this._goDown(p, d, now);
  }

  _useMed(p, item) {
    const def = MEDS[item];
    if (!def) return;
    if (!p.meds) p.meds = freshMeds();
    const have = p.meds[item] | 0;
    if (have >= def.max) { this._deny(p.id, 'full'); return; }
    if (!this._spend(p, def.price)) return;
    p.meds[item] = Math.min(def.max, have + def.pack);
    this.markDirty();
    this._ev({ e: 'buy', pid: p.id, kind: 'med', item });
  }

  // Cura en el suelo (la suelta un zombi); se recoge pasando por encima si hay hueco
  spawnItem(type, x, z, now = Date.now()) {
    if (!MEDS[type]) return null;
    const pt = this._walkablePoint(x, z);
    if (!pt) return null;
    const it = { id: this.nextItemId++, type, x: r2(pt.x), z: r2(pt.z), until: now + MED_DROPS.lifetime * 1000 };
    this.gs.items.push(it);
    this.markDirty();
    this._ev({ e: 'itemSpawn', id: it.id, type, x: it.x, z: it.z });
    return it;
  }

  _updateItems(now) {
    const gs = this.gs;
    if (!gs.items.length) return;
    const keep = [];
    for (const it of gs.items) {
      if (now >= it.until) continue;
      const def = MEDS[it.type];
      let taker = null;
      for (const p of this._players()) {
        if (p.state !== 'alive' || !p.meds || (p.meds[it.type] | 0) >= def.max) continue;
        const d = this.pd.get(p.id);
        if (!d || !d.hasPos) continue;
        if (Math.hypot(d.x - it.x, d.z - it.z) <= MED_DROPS.pickupRadius) { taker = p; break; }
      }
      if (taker) {
        taker.meds[it.type] = (taker.meds[it.type] | 0) + 1;
        this._ev({ e: 'itemPick', id: it.id, type: it.type, pid: taker.id, x: it.x, z: it.z });
      } else keep.push(it);
    }
    if (keep.length !== gs.items.length) { gs.items = keep; this.markDirty(); }
  }

  _breakShield(p) {
    p.shield = null;
    this.markDirty();
    this._ev({ e: 'shieldBreak', pid: p.id });
  }

  // ---- interacción

  _inRange(d, it) {
    return d.hasPos && Math.hypot(d.x - it.x, d.z - it.z) <= (it.range || PLAYER.interactRange) + 0.8;
  }

  _onUse(p, d, m, now) {
    const gs = this.gs;
    if (gs.phase !== 'playing' || p.state !== 'alive') return;
    if (typeof m.id !== 'string') return;
    const id = m.id.slice(0, 40);
    const it = INTERACTABLE_BY_ID[id];
    if (!it) return;
    if (!this._inRange(d, it)) return;
    switch (it.kind) {
      case 'door': this._useDoor(p, it, now); break;
      case 'wallbuy': this._useWallbuy(p, it, now); break;
      case 'perk': this._usePerk(p, it.perk, now); break;
      case 'power': this._usePower(p); break;
      case 'box': this._useBox(p, it.box, now); break;
      case 'pap': this._usePap(p, now); break;
      case 'part': this._usePart(p, it.part); break;
      case 'bench': this._useBench(p); break;
      case 'med': this._useMed(p, it.item); break;
      default: break; // ventanas: solo con 'hold'
    }
  }

  _spend(p, cost) {
    cost = Math.max(0, Math.round(cost));
    if (p.points < cost) { this._deny(p.id, 'points'); return false; }
    if (cost > 0) {
      p.points -= cost;
      this.markDirty();
      this._ev({ e: 'pts', pid: p.id, n: -cost }, { to: p.id });
    }
    return true;
  }

  _addPoints(p, n, scaled) {
    if (!p || !n) return;
    let v = Math.round(n);
    if (scaled && this._timerActive('doublepoints')) v *= 2;
    p.points = Math.max(0, p.points + v);
    this.markDirty();
    this._ev({ e: 'pts', pid: p.id, n: v }, { to: p.id });
  }

  _useDoor(p, it) {
    const gs = this.gs;
    const door = DOORS.find((dd) => dd.id === it.door);
    if (!door || gs.doors[door.id]) return;
    if (!this._spend(p, door.cost)) return;
    this._openDoor(door, p.id);
    this._ev({ e: 'buy', pid: p.id, kind: 'door', item: door.id });
  }

  _openDoor(door, pid) {
    const gs = this.gs;
    if (gs.doors[door.id]) return;
    gs.doors[door.id] = true;
    const zones = new Set(gs.openZones);
    for (const zn of door.zones) zones.add(zn);
    gs.openZones = [...zones].sort((a, b) => a - b);
    this.markDirty();
    this._ev({ e: 'door', id: door.id, pid: pid || null });
  }

  _giveWeapon(p, key, up) {
    const max = p.perks.includes('mulekick') ? PLAYER.muleKickWeapons : PLAYER.maxWeapons;
    let slot = p.weapons.findIndex((x) => x.k === key);
    if (slot >= 0) {
      p.weapons[slot] = { k: key, up: !!up };
    } else if (p.weapons.length < max) {
      p.weapons.push({ k: key, up: !!up });
      slot = p.weapons.length - 1;
    } else {
      slot = clamp(p.cur, 0, p.weapons.length - 1);
      p.weapons[slot] = { k: key, up: !!up };
    }
    p.cur = slot;
    this.markDirty();
    this.flushGs();
    this._ev({ e: 'give', pid: p.id, slot }, { to: p.id });
    return slot;
  }

  _useWallbuy(p, it) {
    const key = it.weapon;
    const base = WEAPONS[key];
    if (!base) return;
    if (key === 'bowie' || base.melee) {
      if (p.melee === key) { this._deny(p.id, 'owned'); return; }
      if (!this._spend(p, base.price || MELEE.bowiePrice)) return;
      p.melee = key;
      this.markDirty();
      this._ev({ e: 'buy', pid: p.id, kind: key === 'bowie' ? 'bowie' : 'melee', item: key });
      return;
    }
    const slot = p.weapons.findIndex((x) => x.k === key);
    if (slot >= 0) {
      const up = !!p.weapons[slot].up;
      const price = ammoPrice(key, up) || (up ? PAP.upgradedAmmoPrice : Math.round((base.price || 0) / 2));
      if (!this._spend(p, price)) return;
      this._ev({ e: 'buy', pid: p.id, kind: 'ammo', item: key });
      this._ev({ e: 'ammo', pid: p.id, slot }, { to: p.id });
      return;
    }
    if (!this._spend(p, base.price || 0)) return;
    this._ev({ e: 'buy', pid: p.id, kind: 'weapon', item: key });
    this._giveWeapon(p, key, false);
  }

  _grantPerk(p, key) {
    if (p.perks.includes(key)) return false;
    p.perks.push(key);
    p.perks.sort((a, b) => PERK_ORDER.indexOf(a) - PERK_ORDER.indexOf(b));
    if (key === 'juggernog') { p.maxHp = PLAYER.jugHealth; p.hp = PLAYER.jugHealth; }
    this.markDirty();
    this.flushGs();
    this._ev({ e: 'perk', pid: p.id, perk: key });
    return true;
  }

  _usePerk(p, key) {
    const perk = PERKS[key];
    if (!perk) return;
    if (!this.gs.power) { this._deny(p.id, 'power'); return; }
    if (p.perks.includes(key)) { this._deny(p.id, 'owned'); return; }
    if (p.perks.length >= PERK_LIMIT) { this._deny(p.id, 'limit'); return; }
    const solo = this.playerCount() <= 1;
    if (key === 'quickrevive' && solo && p.qrUses >= PLAYER.soloQuickReviveUses) { this._deny(p.id, 'limit'); return; }
    if (!this._spend(p, perkPrice(key, this.playerCount()))) return;
    this._ev({ e: 'buy', pid: p.id, kind: 'perk', item: key });
    this._grantPerk(p, key);
  }

  _usePower(p) {
    if (this.gs.power) return;
    this.gs.power = true;
    this.markDirty();
    this._ev({ e: 'power', pid: p.id });
    this._log(`${p.name} activó la electricidad.`);
  }

  _usePart(p, idx) {
    const parts = this.gs.shield.parts;
    if (!Number.isInteger(idx) || idx < 0 || idx >= parts.length || parts[idx]) return;
    parts[idx] = true;
    this.markDirty();
    this._ev({ e: 'part', id: idx, pid: p.id });
  }

  _useBench(p) {
    const sh = this.gs.shield;
    if (!sh.built) {
      const have = sh.parts.filter(Boolean).length;
      if (have < SHIELD.parts) this._msg(p.id, `Faltan piezas del escudo (${have}/${SHIELD.parts})`);
      else this._msg(p.id, 'Mantén F para construir el Escudo Antidisturbios');
      return;
    }
    if (p.shield) { this._deny(p.id, 'owned'); return; }
    p.shield = { hp: SHIELD.hp };
    this.markDirty();
    this._ev({ e: 'shieldTake', pid: p.id });
  }

  // ---- caja misteriosa

  _boxMoving() {
    return this.gs.box.slots.some((s) => s.state === 'teddy' || s.state === 'arriving');
  }

  _pickBoxWeapon(p) {
    const own = new Set(p.weapons.map((x) => x.k));
    if (this.gs.pap.user === p.id && this.gs.pap.weapon) own.add(this.gs.pap.weapon);
    let pool = BOX_POOL.filter((it) => !own.has(it.key) && WEAPONS[it.key]);
    if (!pool.length) pool = BOX_POOL.slice();
    return weightedPick(pool) || 'raygun';
  }

  _useBox(p, i, now) {
    const gs = this.gs;
    const s = gs.box.slots[i];
    if (!s) return;
    const bp = this.boxPriv[i];
    if (s.state === 'idle') {
      const firesale = this._timerActive('firesale', now);
      const price = firesale ? BOX.fireSalePrice : BOX.price;
      if (!this._spend(p, price)) return;
      const main = i === gs.box.loc;
      bp.teddy = !firesale && main && gs.box.uses >= BOX.teddyMinUses && Math.random() < BOX.teddyChance;
      bp.weapon = bp.teddy ? null : this._pickBoxWeapon(p);
      bp.paid = price;
      if (main) gs.box.uses++;
      Object.assign(s, { state: 'spinning', user: p.id, weapon: null, until: now + BOX.spinTime * 1000 });
      this.markDirty();
      this._ev({ e: 'buy', pid: p.id, kind: 'box', item: i });
      this._ev({ e: 'boxOpen', loc: i, pid: p.id });
      return;
    }
    if (s.state === 'ready') {
      if (s.user !== p.id) { this._deny(p.id, 'busy'); return; }
      const key = s.weapon;
      this._closeBoxSlot(i);
      if (key && WEAPONS[key]) this._giveWeapon(p, key, false);
      return;
    }
    if (s.state === 'spinning' || s.state === 'teddy' || s.state === 'arriving') this._deny(p.id, 'busy');
  }

  _closeBoxSlot(i) {
    const gs = this.gs;
    const s = gs.box.slots[i];
    const keepOpen = i === gs.box.loc || this._timerActive('firesale');
    Object.assign(s, { state: keepOpen ? 'idle' : 'off', user: null, weapon: null, until: 0 });
    const bp = this.boxPriv[i];
    bp.teddy = false; bp.weapon = null; bp.paid = 0;
    this.markDirty();
  }

  _updateBox(now) {
    const gs = this.gs;
    const slots = gs.box.slots;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.until || now < s.until) continue;
      const bp = this.boxPriv[i];
      if (s.state === 'spinning') {
        if (bp.teddy) {
          const user = s.user != null ? gs.players[s.user] : null;
          if (user && bp.paid > 0) this._addPoints(user, bp.paid, false); // se devuelve el dinero
          Object.assign(s, { state: 'teddy', weapon: null, until: now + BOX.teddyTime * 1000 });
          bp.teddy = false;
          this.markDirty();
          this._ev({ e: 'boxTeddy', loc: i });
        } else {
          Object.assign(s, { state: 'ready', weapon: bp.weapon || this._pickBoxWeapon(gs.players[s.user] || { weapons: [] }), until: now + BOX.pickupTime * 1000 });
          this.markDirty();
        }
      } else if (s.state === 'ready') {
        this._closeBoxSlot(i);
      } else if (s.state === 'teddy') {
        // La caja se va volando a otra ubicación
        const options = slots.map((_, k) => k).filter((k) => k !== i);
        const free = options.filter((k) => slots[k].state === 'off' || slots[k].state === 'idle');
        const pool = free.length ? free : options;
        const to = pool[Math.floor(Math.random() * pool.length)];
        Object.assign(s, { state: 'off', user: null, weapon: null, until: 0 });
        gs.box.loc = to;
        gs.box.uses = 0;
        const t = slots[to];
        if (t.state === 'off' || t.state === 'idle') Object.assign(t, { state: 'arriving', user: null, weapon: null, until: now + BOX.arriveTime * 1000 });
        this.markDirty();
        this._ev({ e: 'boxMove', from: i, to });
      } else if (s.state === 'arriving') {
        Object.assign(s, { state: 'idle', user: null, weapon: null, until: 0 });
        this.markDirty();
      }
    }
  }

  // ---- Pack-a-Punch

  _usePap(p, now) {
    const gs = this.gs;
    const pap = gs.pap;
    if (!gs.power) { this._deny(p.id, 'power'); return; }
    if (pap.state === 'ready') {
      if (pap.user !== p.id) { this._deny(p.id, 'busy'); return; }
      const key = pap.weapon;
      Object.assign(pap, { state: 'idle', user: null, weapon: null, until: 0 });
      this.markDirty();
      if (key && WEAPONS[key]) this._giveWeapon(p, key, true);
      return;
    }
    if (pap.state !== 'idle') { this._deny(p.id, 'busy'); return; }
    const cw = p.weapons[p.cur];
    if (!cw) { this._msg(p.id, 'No tienes un arma en la mano.'); return; }
    if (cw.up) { this._deny(p.id, 'owned'); return; }
    const base = WEAPONS[cw.k];
    if (!base || !base.pap) { this._msg(p.id, 'Esta arma no se puede mejorar.'); return; }
    if (!this._spend(p, PAP.price)) return;
    p.weapons.splice(p.cur, 1);
    p.cur = clamp(p.cur, 0, Math.max(0, p.weapons.length - 1));
    Object.assign(pap, { state: 'working', user: p.id, weapon: cw.k, until: now + PAP.workTime * 1000 });
    this.markDirty();
    this.flushGs();
    this._ev({ e: 'buy', pid: p.id, kind: 'pap', item: cw.k });
    this._ev({ e: 'papStart', pid: p.id, weapon: cw.k });
  }

  _updatePap(now) {
    const pap = this.gs.pap;
    if (!pap.until || now < pap.until) return;
    if (pap.state === 'working') {
      pap.state = 'ready';
      pap.until = now + PAP.pickupTime * 1000;
      this.markDirty();
      this._ev({ e: 'papReady', pid: pap.user, weapon: pap.weapon });
    } else if (pap.state === 'ready') {
      Object.assign(pap, { state: 'idle', user: null, weapon: null, until: 0 });
      this.markDirty();
    }
  }

  // ---- mantener F (ventanas, mesa, reanimar)

  _onHold(p, d, m, now) {
    const gs = this.gs;
    const id = typeof m.id === 'string' ? m.id.slice(0, 40) : '';
    if (!m.on) {
      if (d.hold && (!id || d.hold.id === id)) this._cancelHold(p, d, now);
      return;
    }
    if (gs.phase !== 'playing' || p.state !== 'alive' || !id) return;
    if (d.hold && d.hold.id === id) return;
    if (d.hold) this._cancelHold(p, d, now);

    if (id.startsWith('win:')) {
      const it = INTERACTABLE_BY_ID[id];
      if (!it || it.kind !== 'window' || !this._inRange(d, it)) return;
      d.hold = { id, kind: 'win', win: it.window, nextAt: now + this._repairMs(p) };
    } else if (id === 'bench') {
      const it = INTERACTABLE_BY_ID.bench;
      if (!it || !this._inRange(d, it)) return;
      const sh = gs.shield;
      if (sh.built) { this._useBench(p); return; }
      const have = sh.parts.filter(Boolean).length;
      if (have < SHIELD.parts) { this._msg(p.id, `Faltan piezas del escudo (${have}/${SHIELD.parts})`); return; }
      if (sh.builder != null && sh.builder !== p.id) { this._deny(p.id, 'busy'); return; }
      sh.builder = p.id;
      sh.buildUntil = now + SHIELD.buildTime * 1000;
      this.markDirty();
      d.hold = { id, kind: 'bench' };
    } else if (id.startsWith('revive:')) {
      const tid = Number(id.slice(7));
      const t = Number.isInteger(tid) ? gs.players[tid] : null;
      const td = t ? this.pd.get(tid) : null;
      if (!t || !td || tid === p.id || t.state !== 'down') return;
      if (Math.hypot(td.x - d.x, td.z - d.z) > PLAYER.reviveRange + 0.8) return;
      if (t.reviver != null && t.reviver !== p.id) { this._deny(p.id, 'busy'); return; }
      td.bleedRemain = Math.max(0, t.bleedUntil - now);
      t.reviver = p.id;
      t.reviveUntil = now + PLAYER.reviveTime * (p.perks.includes('quickrevive') ? 0.5 : 1) * 1000;
      this.markDirty();
      d.hold = { id, kind: 'revive', target: tid };
    }
  }

  _repairMs(p) {
    return REPAIR_TIME * (p.perks.includes('speedcola') ? 0.5 : 1) * 1000;
  }

  _cancelHold(p, d, now = Date.now()) {
    const h = d && d.hold;
    if (!h) return;
    d.hold = null;
    const gs = this.gs;
    if (h.kind === 'bench') {
      if (gs.shield.builder === p.id) { gs.shield.builder = null; gs.shield.buildUntil = 0; this.markDirty(); }
    } else if (h.kind === 'revive') {
      const t = gs.players[h.target];
      const td = this.pd.get(h.target);
      if (t && t.reviver === p.id) {
        t.reviver = null;
        t.reviveUntil = 0;
        if (t.state === 'down' && td) t.bleedUntil = now + td.bleedRemain; // el desangrado estaba en pausa
        this.markDirty();
      }
    }
  }

  _cancelHoldsTargeting(pid, now) {
    for (const [qid, qd] of this.pd) {
      if (qd.hold && qd.hold.kind === 'revive' && qd.hold.target === pid) {
        const q = this.gs.players[qid];
        if (q) this._cancelHold(q, qd, now);
        else qd.hold = null;
      }
    }
  }

  _updateHold(p, d, now) {
    const h = d.hold;
    if (!h) return;
    const gs = this.gs;
    if (h.kind === 'win') {
      const it = INTERACTABLE_BY_ID[h.id];
      if (!it || !this._inRange(d, it)) { this._cancelHold(p, d, now); return; }
      const boards = gs.windows[h.win] | 0;
      if (boards >= BOARDS_PER_WINDOW) { h.nextAt = Math.max(h.nextAt, now + this._repairMs(p) * 0.5); return; }
      if (now >= h.nextAt) {
        h.nextAt = now + this._repairMs(p);
        this.setBoards(h.win, boards + 1, p.id);
        if (d.repairPts < POINTS.repairCapPerRound) {
          d.repairPts += POINTS.repairBoard;
          this._addPoints(p, POINTS.repairBoard, true);
        }
      }
    } else if (h.kind === 'bench') {
      const it = INTERACTABLE_BY_ID.bench;
      const sh = gs.shield;
      if (!it || !this._inRange(d, it) || sh.builder !== p.id || sh.built) { this._cancelHold(p, d, now); return; }
      if (now >= sh.buildUntil) {
        sh.built = true;
        sh.builder = null;
        sh.buildUntil = 0;
        d.hold = null;
        this.markDirty();
        this._ev({ e: 'built', pid: p.id });
        this._log(`${p.name} construyó el escudo antidisturbios.`);
      }
    } else if (h.kind === 'revive') {
      const t = gs.players[h.target];
      const td = this.pd.get(h.target);
      if (!t || !td || t.state !== 'down' || t.reviver !== p.id ||
          Math.hypot(td.x - d.x, td.z - d.z) > PLAYER.reviveRange + 0.8) {
        this._cancelHold(p, d, now);
        return;
      }
      if (now >= t.reviveUntil) {
        d.hold = null;
        this._revive(t, p.id, now);
      }
    }
  }

  // ------------------------------------------------------------------ jugadores: daño, caer, reanimar

  // API para ZombieManager: [{ pid, x, z }] de los jugadores vivos
  targets() {
    const out = [];
    for (const p of this._players()) {
      if (p.state !== 'alive') continue;
      const d = this.pd.get(p.id);
      if (!d) continue;
      out.push({ pid: p.id, x: d.x, z: d.z });
    }
    return out;
  }

  // Cuerpos que los zombis no atraviesan (vivos y caídos)
  bodies() {
    const out = [];
    for (const p of this._players()) {
      if (p.state !== 'alive' && p.state !== 'down') continue;
      const d = this.pd.get(p.id);
      if (d && d.hasPos) out.push({ pid: p.id, x: d.x, z: d.z });
    }
    return out;
  }

  // API para ZombieManager: golpe que conecta. Devuelve { hit, blocked }
  damagePlayer(pid, amount, z) {
    const gs = this.gs;
    const p = gs.players[pid];
    const d = this.pd.get(pid);
    if (!p || !d || p.state !== 'alive' || gs.phase !== 'playing') return { hit: false, blocked: false };
    const now = Date.now();
    if (d.god || now < d.invulnUntil) return { hit: false, blocked: false };
    const amt = Math.max(0, Math.round(Number(amount) || 0));
    if (p.shield && z && isNum(z.x) && isNum(z.z)) {
      const ang = Math.abs(angleDiff(d.yaw, yawTo(d.x, d.z, z.x, z.z)));
      const out = (d.flags & PF.SHIELD_OUT) !== 0;
      const front = ang <= (SHIELD.frontArcDeg / 2) * DEG;
      const back = ang >= Math.PI - (SHIELD.backArcDeg / 2) * DEG;
      if ((out && front) || (!out && back)) {
        p.shield.hp -= amt;
        this.markDirty();
        this._ev({ e: 'shieldHit', pid: p.id });
        if (p.shield.hp <= 0) this._breakShield(p);
        return { hit: false, blocked: true };
      }
    }
    p.hp = Math.max(0, p.hp - amt);
    d.lastDamageAt = now;
    this.markDirty();
    if (p.hp <= 0) { this._goDown(p, d, now); return { hit: true, blocked: false }; }
    if (!p.infected && Math.random() < INFECTION.chance) {
      p.infected = true;
      d.infT = 0; d.infAcc = 0;
      this._ev({ e: 'infected', pid: p.id });
    }
    return { hit: true, blocked: false };
  }

  _goDown(p, d, now) {
    this._cancelHold(p, d, now);
    p.state = 'down';
    p.hp = 0;
    p.infected = false;
    p.healing = null;
    p.downs++;
    const loss = Math.floor(p.points * PLAYER.downPointsLoss);
    if (loss > 0) {
      p.points -= loss;
      this._ev({ e: 'pts', pid: p.id, n: -loss }, { to: p.id });
    }
    const hadQR = p.perks.includes('quickrevive');
    const hadMule = p.perks.includes('mulekick');
    p.perks = [];
    p.maxHp = PLAYER.health;
    if (hadMule && p.weapons.length > PLAYER.maxWeapons) {
      p.weapons.length = PLAYER.maxWeapons;
      p.cur = clamp(p.cur, 0, Math.max(0, p.weapons.length - 1));
    }
    p.bleedUntil = now + PLAYER.bleedoutTime * 1000;
    p.reviver = null;
    p.reviveUntil = 0;
    p.selfReviveAt = 0;
    const solo = this.playerCount() <= 1;
    if (solo && hadQR && p.qrUses < PLAYER.soloQuickReviveUses) {
      p.qrUses++;
      p.selfReviveAt = now + PLAYER.soloQuickReviveTime * 1000;
    }
    this.markDirty();
    this.flushGs();
    this._ev({ e: 'down', pid: p.id });
    this._log(`${p.name} cayó (ronda ${this.gs.round}).`);
  }

  _revive(p, byPid, now) {
    const d = this.pd.get(p.id);
    p.state = 'alive';
    p.hp = p.maxHp;
    p.infected = false;
    p.healing = null;
    p.bleedUntil = 0;
    p.selfReviveAt = 0;
    p.reviver = null;
    p.reviveUntil = 0;
    if (d) { d.lastDamageAt = now; d.invulnUntil = now + REVIVE_INVULN; }
    if (byPid != null) {
      const r = this.gs.players[byPid];
      if (r) r.revives++;
    }
    this.markDirty();
    this.flushGs();
    this._ev({ e: 'revived', pid: p.id, by: byPid != null ? byPid : null });
  }

  _bleedout(p, now) {
    this._cancelHoldsTargeting(p.id, now);
    Object.assign(p, {
      state: 'dead', hp: 0, maxHp: PLAYER.health, perks: [], weapons: [], cur: 0, grenades: 0,
      melee: 'knife', shield: null, bleedUntil: 0, selfReviveAt: 0, reviver: null, reviveUntil: 0,
      infected: false, meds: { bandage: 0, antidote: 0, medkit: 0 }, healing: null,
    });
    this.markDirty();
    this.flushGs();
    this._ev({ e: 'bleedout', pid: p.id });
    this._log(`${p.name} se desangró.`);
  }

  _respawnPlayer(p, now) {
    const d = this.pd.get(p.id) || this._newPriv(p.spawn);
    this.pd.set(p.id, d);
    const sp = PLAYER_SPAWNS[p.spawn % PLAYER_SPAWNS.length];
    Object.assign(p, {
      state: 'alive', hp: PLAYER.health, maxHp: PLAYER.health, perks: [],
      weapons: [{ k: PLAYER.startWeapon, up: false }], cur: 0, grenades: PLAYER.startGrenades,
      melee: 'knife', shield: null, bleedUntil: 0, selfReviveAt: 0, reviver: null, reviveUntil: 0,
      infected: false, meds: freshMeds(), healing: null,
    });
    d.infT = 0; d.infAcc = 0;
    d.x = sp.x; d.y = 0; d.z = sp.z; d.yaw = PLAYER_SPAWN_YAW; d.pitch = 0; d.flags = 0;
    d.hasPos = true; d.teleportUntil = now + TELEPORT_GRACE; d.badPos = 0;
    d.lastDamageAt = 0; d.invulnUntil = now + SPAWN_INVULN; d.hold = null; d.nades = [];
    this.markDirty();
    return { pid: p.id, x: sp.x, z: sp.z, yaw: PLAYER_SPAWN_YAW };
  }

  _updatePlayers(dt, now) {
    for (const p of this._players()) {
      const d = this.pd.get(p.id);
      if (!d) continue;
      if (p.state === 'alive') {
        // Regeneración natural solo hasta regenCap (y nunca infectado)
        const cap = Math.round(p.maxHp * PLAYER.regenCap);
        if (!p.infected && p.hp < cap && now - d.lastDamageAt >= PLAYER.regenDelay * 1000) {
          p.hp = Math.min(cap, Math.round(p.hp + PLAYER.regenRate * dt));
          this.markDirty();
        }
        if (p.hp > p.maxHp) { p.hp = p.maxHp; this.markDirty(); }
        if (p.infected) this._updateInfection(p, d, dt, now);
        if (p.state === 'alive' && p.healing && now >= p.healing.until) this._finishHeal(p, d, now);
        if (p.state === 'alive') this._updateHold(p, d, now);
      } else if (p.state === 'down') {
        if (p.selfReviveAt && now >= p.selfReviveAt) this._revive(p, null, now);
        else if (p.reviver == null && !p.selfReviveAt && p.bleedUntil && now >= p.bleedUntil) this._bleedout(p, now);
      }
    }
  }

  // ------------------------------------------------------------------ potenciadores y temporizadores

  _randomPowerupType(now) {
    let types = POWERUP_TYPES.filter((t) => t !== this.lastPuType);
    if (this._boxMoving() || this._timerActive('firesale', now)) types = types.filter((t) => t !== 'firesale');
    if (!types.length) types = POWERUP_TYPES.filter((t) => t !== 'firesale');
    return types[Math.floor(Math.random() * types.length)];
  }

  // Punto de suelo transitable para un potenciador (el centro de la celda más cercana si hace falta)
  _walkablePoint(x, z) {
    const doors = this.gs.doors;
    const cx = Math.floor(x), cz = Math.floor(z);
    if (!solidForPlayer(cx, cz, doors)) return { x, z };
    let best = null, bd = Infinity;
    for (let r = 1; r <= 3 && !best; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (solidForPlayer(cx + dx, cz + dz, doors)) continue;
          const px = cx + dx + 0.5, pz = cz + dz + 0.5;
          const dd = (px - x) ** 2 + (pz - z) ** 2;
          if (dd < bd) { bd = dd; best = { x: px, z: pz }; }
        }
      }
    }
    return best;
  }

  spawnPowerup(type, x, z, now = Date.now()) {
    if (!POWERUP_TYPES.includes(type)) return null;
    const pt = this._walkablePoint(x, z);
    if (!pt) return null;
    const pu = { id: this.nextPuId++, type, x: r2(pt.x), z: r2(pt.z), until: now + POWERUPS.lifetime * 1000 };
    this.gs.powerups.push(pu);
    this.lastPuType = type;
    this.markDirty();
    this._ev({ e: 'puSpawn', id: pu.id, type, x: pu.x, z: pu.z });
    return pu;
  }

  _updatePowerups(now) {
    const gs = this.gs;
    if (!gs.powerups.length) return;
    const keep = [];
    const taken = [];
    for (const pu of gs.powerups) {
      if (now >= pu.until) continue;
      let taker = null;
      for (const p of this._players()) {
        if (p.state !== 'alive') continue;
        const d = this.pd.get(p.id);
        if (!d || !d.hasPos) continue;
        if (Math.hypot(d.x - pu.x, d.z - pu.z) <= POWERUPS.pickupRadius) { taker = p; break; }
      }
      if (taker) taken.push([pu, taker]);
      else keep.push(pu);
    }
    if (keep.length !== gs.powerups.length) { gs.powerups = keep; this.markDirty(); }
    for (const [pu, p] of taken) this._applyPowerup(pu, p, now);
  }

  _applyPowerup(pu, p, now) {
    const gs = this.gs;
    const players = this._players();
    this._log(`${p.name} recogió ${pu.type}.`);
    switch (pu.type) {
      case 'maxammo':
        for (const q of players) if (q.state !== 'dead') q.grenades = PLAYER.maxGrenades;
        break;
      case 'instakill':
        gs.timers.instakill = now + POWERUPS.duration * 1000;
        break;
      case 'doublepoints':
        gs.timers.doublepoints = now + POWERUPS.duration * 1000;
        break;
      case 'nuke':
        this.zombies.killAll('nuke');
        for (const q of players) this._addPoints(q, POINTS.nuke, false);
        break;
      case 'carpenter':
        gs.windows.forEach((n, i) => { if (n < BOARDS_PER_WINDOW) this.setBoards(i, BOARDS_PER_WINDOW, p.id); });
        for (const q of players) this._addPoints(q, POINTS.carpenter, false);
        break;
      case 'firesale': {
        gs.timers.firesale = now + POWERUPS.duration * 1000;
        gs.box.slots.forEach((s, i) => {
          if (s.state === 'off') Object.assign(s, { state: 'idle', user: null, weapon: null, until: 0 });
          const bp = this.boxPriv[i];
          if (s.state === 'spinning' && bp.teddy) { bp.teddy = false; bp.weapon = this._pickBoxWeapon(gs.players[s.user] || { weapons: [] }); }
        });
        break;
      }
      default: break;
    }
    this.markDirty();
    this._ev({ e: 'pu', type: pu.type, pid: p.id, x: pu.x, z: pu.z });
  }

  _updateTimers(now) {
    const t = this.gs.timers;
    for (const k of ['instakill', 'doublepoints', 'firesale']) {
      if (t[k] && now >= t[k]) {
        t[k] = 0;
        this.markDirty();
        if (k === 'firesale') {
          // Las ubicaciones que no son la principal se cierran cuando estén libres
          this.gs.box.slots.forEach((s, i) => { if (i !== this.gs.box.loc && s.state === 'idle') s.state = 'off'; });
        }
      }
    }
  }

  // ------------------------------------------------------------------ callbacks de ZombieManager

  onZombieKilled(z, pid, info = {}) {
    const gs = this.gs;
    const kind = info.kind || 'bullet';
    const part = info.part === 'h' || info.part === 'l' ? info.part : 'b';
    const p = pid != null ? gs.players[pid] : null;
    let fx = 'normal';
    if (kind === 'nuke') fx = 'nuke';
    else if (kind === 'explosion') fx = 'explode';
    else if (kind === 'melee') fx = 'melee';
    else if (kind === 'shield') fx = 'shield';
    else if (kind === 'fire') fx = 'fire';
    else if (kind === 'bullet' && part === 'h') fx = 'head';
    const scoring = kind !== 'nuke' && kind !== 'dev';
    if (p && scoring) {
      let pts = POINTS.killBody;
      if (kind === 'melee' || kind === 'shield') pts = POINTS.killMelee;
      else if (kind === 'bullet' && part === 'h') pts = POINTS.killHead;
      this._addPoints(p, pts, true);
      p.kills++;
      if (kind === 'bullet' && part === 'h') p.headshots++;
      this.markDirty();
    }
    this._ev({ e: 'zdie', id: z.id, pid: p ? p.id : null, part, fx });
    // Potenciadores
    if (scoring && this.dropsThisRound < POWERUPS.maxPerRound && Math.random() < POWERUPS.dropChance) {
      let x = z.x, zz = z.z;
      if (z.state === 'outside' || z.state === 'tearing' || z.state === 'climbing') {
        const w = WINDOW_INFO[z.win];
        if (w) { x = w.land[0] + 0.5; zz = w.land[1] + 0.5; }
      }
      const type = this._randomPowerupType(Date.now());
      if (type && this.spawnPowerup(type, x, zz)) this.dropsThisRound++;
    }
    // Curas
    if (scoring && this.medDropsThisRound < MED_DROPS.maxPerRound && Math.random() < MED_DROPS.chance) {
      let x = z.x, zz = z.z;
      if (z.state === 'outside' || z.state === 'tearing' || z.state === 'climbing') {
        const w = WINDOW_INFO[z.win];
        if (w) { x = w.land[0] + 0.5; zz = w.land[1] + 0.5; }
      }
      if (this.spawnItem(pickWeighted(MED_DROPS.weights), x, zz)) this.medDropsThisRound++;
    }
  }

  setBoards(win, n, pid) {
    const gs = this.gs;
    if (!Number.isInteger(win) || win < 0 || win >= gs.windows.length) return;
    const v = clamp(Math.round(n), 0, BOARDS_PER_WINDOW);
    if (gs.windows[win] === v) return;
    gs.windows[win] = v;
    this.markDirty();
    this._ev({ e: 'board', win, n: v, pid: pid != null ? pid : null });
  }

  onRoundStart(round) {
    const now = Date.now();
    this.dropsThisRound = 0;
    this.medDropsThisRound = 0;
    for (const d of this.pd.values()) d.repairPts = 0;
    const respawns = [];
    for (const p of this._players()) {
      if (p.state === 'dead') respawns.push(this._respawnPlayer(p, now));
      else if (round > 1) p.grenades = Math.min(PLAYER.maxGrenades, p.grenades + PLAYER.grenadesPerRound);
    }
    this.markDirty();
    this.flushGs();
    this._ev({ e: 'roundStart', round });
    for (const r of respawns) this._ev({ e: 'respawn', ...r });
    this._log(`Ronda ${round} (${this.gs.zLeft} zombis).`);
  }

  onRoundEnd(round) {
    this._ev({ e: 'roundEnd', round });
  }

  // ------------------------------------------------------------------ fases

  startGame() {
    const gs = this.gs;
    if (gs.phase !== 'lobby' || this.playerCount() === 0) return;
    const now = Date.now();
    const players = gs.players;
    const fresh = this._freshState();
    fresh.players = players;
    this.gs = fresh;
    this.gs.phase = 'playing';
    for (const bp of this.boxPriv) { bp.teddy = false; bp.weapon = null; bp.paid = 0; }
    this.nextPuId = 1;
    this.lastPuType = null;
    this.dropsThisRound = 0;
    this.medDropsThisRound = 0;
    this.nextItemId = 1;
    const respawns = [];
    for (const p of this._players()) {
      this._resetPlayer(p);
      const d = this._newPriv(p.spawn);
      this.pd.set(p.id, d);
      respawns.push(this._respawnPlayer(p, now));
    }
    this.zombies.startGame();
    this.markDirty();
    this.flushGs();
    for (const r of respawns) this._ev({ e: 'respawn', ...r });
    this._system('¡Comienza la partida! Sobrevive todo lo que puedas.');
    this._log(`Partida iniciada con ${this.playerCount()} jugador(es).`);
  }

  _checkGameOver(now) {
    const ps = this._players();
    if (!ps.length || this.gs.phase !== 'playing') return;
    if (ps.some((p) => p.state === 'alive')) return;
    if (ps.some((p) => p.state === 'down' && p.selfReviveAt > 0)) return;
    this._gameOver(now);
  }

  _gameOver(now) {
    const gs = this.gs;
    gs.phase = 'gameover';
    this.gameOverAt = now + GAMEOVER_TIME;
    for (const p of this._players()) {
      const d = this.pd.get(p.id);
      if (d) d.hold = null;
    }
    const stats = this._players()
      .sort((a, b) => a.id - b.id)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, points: p.points, kills: p.kills, headshots: p.headshots, downs: p.downs, revives: p.revives }));
    this.markDirty();
    this.flushGs();
    this._ev({ e: 'gameover', round: gs.round, stats });
    this._log(`Fin de la partida en la ronda ${gs.round}.`);
  }

  _returnToLobby() {
    this.zombies.reset();
    const players = this.gs.players;
    const fresh = this._freshState();
    fresh.players = players;
    this.gs = fresh;
    for (const bp of this.boxPriv) { bp.teddy = false; bp.weapon = null; bp.paid = 0; }
    for (const p of this._players()) {
      this._resetPlayer(p);
      this.pd.set(p.id, this._newPriv(p.spawn));
    }
    this.gameOverAt = 0;
    this.markDirty();
    this.flushGs();
    if (this.playerCount()) this._log('De vuelta en el lobby.');
  }

  // ------------------------------------------------------------------ chat y modo desarrollo

  _onChat(p, d, m, now) {
    const msg = cleanText(m.msg, 120);
    if (!msg) return;
    if (!this._rate(d.chatTimes, now, 4000, 6)) { this._msg(p.id, 'Estás enviando mensajes demasiado rápido.'); return; }
    if (msg.startsWith('/')) {
      if (this.dev) { this._devCommand(p, d, msg, now); return; }
      this._msg(p.id, 'Los comandos solo funcionan si el servidor se inicia con --dev.');
      return;
    }
    this._ev({ e: 'chat', pid: p.id, name: p.name, msg });
  }

  _devCommand(p, d, msg, now) {
    const gs = this.gs;
    const [cmdRaw, ...args] = msg.slice(1).split(' ');
    const cmd = (cmdRaw || '').toLowerCase();
    const say = (t) => this._msg(p.id, t);
    const playing = gs.phase === 'playing';
    const needPlay = () => { if (!playing) say('Ese comando solo funciona durante la partida.'); return playing; };
    this._log(`[dev] ${p.name}: ${msg}`);
    switch (cmd) {
      case 'help':
        say('Comandos: /points N, /round N, /power, /give ARMA [up], /god, /killall, /pu TIPO, /parts, /doors, /perk VENTAJA, /meds, /infect, /item TIPO');
        break;
      case 'points': {
        if (!needPlay()) break;
        const n = Math.round(Number(args[0]));
        if (!Number.isFinite(n)) { say('Uso: /points N'); break; }
        this._addPoints(p, clamp(n, -1e7, 1e7), false);
        say(`Puntos: ${p.points}`);
        break;
      }
      case 'round': {
        if (!needPlay()) break;
        const n = Math.floor(Number(args[0]));
        if (!Number.isFinite(n) || n < 1) { say('Uso: /round N'); break; }
        this.zombies.setRound(n);
        say(`Saltando a la ronda ${Math.min(255, n)}.`);
        break;
      }
      case 'power':
        if (!needPlay()) break;
        if (gs.power) say('La electricidad ya está activada.');
        else this._usePower(p);
        break;
      case 'give': {
        if (!needPlay()) break;
        if (p.state !== 'alive') { say('Tienes que estar en pie.'); break; }
        const key = (args[0] || '').toLowerCase();
        const up = /^(up|1|true|pap)$/i.test(args[1] || '');
        if (!WEAPONS[key]) { say(`Arma desconocida. Opciones: ${Object.keys(WEAPONS).join(', ')}`); break; }
        if (key === 'bowie' || WEAPONS[key].melee) { p.melee = key; this.markDirty(); say(`${WEAPONS[key].name} equipado.`); break; }
        this._giveWeapon(p, key, up && !!WEAPONS[key].pap);
        say(`Recibiste ${weaponName(key, up && !!WEAPONS[key].pap)}.`);
        break;
      }
      case 'god':
        d.god = !d.god;
        say(d.god ? 'Modo invulnerable activado.' : 'Modo invulnerable desactivado.');
        break;
      case 'killall': {
        if (!needPlay()) break;
        const n = this.zombies.killAll('dev');
        say(`Zombis eliminados: ${n}.`);
        break;
      }
      case 'pu': {
        if (!needPlay()) break;
        const type = (args[0] || '').toLowerCase();
        if (!POWERUP_TYPES.includes(type)) { say(`Tipos: ${POWERUP_TYPES.join(', ')}`); break; }
        const f = forwardXZ(d.yaw);
        const pu = this.spawnPowerup(type, d.x + f.x * 2, d.z + f.z * 2, now);
        if (!pu) say('No hay espacio para el potenciador.');
        break;
      }
      case 'meds':
        if (!needPlay()) break;
        p.meds = { bandage: MEDS.bandage.max, antidote: MEDS.antidote.max, medkit: MEDS.medkit.max };
        this.markDirty();
        say('Curas al máximo.');
        break;
      case 'infect':
        if (!needPlay() || p.state !== 'alive') break;
        p.infected = true; d.infT = 0; d.infAcc = 0;
        this.markDirty();
        this._ev({ e: 'infected', pid: p.id });
        break;
      case 'item': {
        if (!needPlay()) break;
        const type = (args[0] || 'bandage').toLowerCase();
        if (!MEDS[type]) { say(`Tipos: ${MED_KEYS.join(', ')}`); break; }
        const f = forwardXZ(d.yaw);
        if (!this.spawnItem(type, d.x + f.x * 2, d.z + f.z * 2, now)) say('No hay espacio.');
        break;
      }
      case 'parts':
        if (!needPlay()) break;
        gs.shield.parts.forEach((got, i) => { if (!got) this._usePart(p, i); });
        say('Tienes todas las piezas del escudo.');
        break;
      case 'doors':
        if (!needPlay()) break;
        for (const door of DOORS) this._openDoor(door, p.id);
        say('Todas las puertas abiertas.');
        break;
      case 'perk': {
        if (!needPlay()) break;
        if (p.state !== 'alive') { say('Tienes que estar en pie.'); break; }
        const key = (args[0] || '').toLowerCase();
        if (!PERKS[key]) { say(`Ventajas: ${PERK_ORDER.join(', ')}`); break; }
        if (!this._grantPerk(p, key)) say('Ya tienes esa ventaja.');
        break;
      }
      default:
        say('Comando desconocido. Escribe /help.');
        break;
    }
  }

  // ------------------------------------------------------------------ registro

  _log(text) {
    if (this.quiet) return;
    const t = new Date().toLocaleTimeString('es', { hour12: false });
    console.log(`[${t}] ${text}`);
  }

  _logError(where, e) {
    this.errorCount++;
    if (this.errorCount <= 50 || this.errorCount % 100 === 0) {
      console.error(`[error:${where}]`, e && e.stack ? e.stack : e);
    }
  }

  // Para pruebas y apagado limpio
  close() {
    clearInterval(this.timer);
    for (const c of this.conns) { try { c.ws.close(1001, 'Servidor detenido'); } catch { /* nada */ } }
  }

  // Resumen para las pruebas automáticas
  debugInfo() {
    const gs = this.gs;
    return {
      phase: gs.phase, round: gs.round, roundState: gs.roundState, zLeft: gs.zLeft,
      zombies: this.zombies.aliveCount(), players: this.playerCount(), errors: this.errorCount,
    };
  }
}

export default Game;
