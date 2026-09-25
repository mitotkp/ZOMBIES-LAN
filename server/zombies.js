// ZombieManager: rondas, aparición en las ventanas, IA (callejón → barricada → interior → persecución),
// ataques, reptantes, quemaduras, empujones del escudo y detección de atascos.
// API usada por Game (SPEC.md 5.3).

import {
  ZOMBIE, ROUND, ZOMBIE_TYPES, zombieHealth, zombiesForRound, zombieSpeedChances, angleDiff, yawTo,
} from '../shared/constants.js';
import { WINDOW_INFO, DIRS } from '../shared/map.js';
import { moveCircle, resolveCircle, solidForZombieInside, solidForZombieOutside } from '../shared/collision.js';
import { ZA, ZF, r2 } from '../shared/protocol.js';
import { FlowField, clearPath, randomPointNear, doorsKey } from './nav.js';

const FIELD_INTERVAL = 0.25;      // s entre recálculos periódicos del campo de flujo
const SEP_RADIUS = 0.75;          // separación mínima entre zombis
const PLAYER_BODY = 0.62;         // distancia mínima entre el centro de un zombi y un jugador
const WINDOW_REACH = 1.0;         // un zombi en la ventana golpea a quien esté a esta distancia de la celda interior
const BURN_DPS = 150;             // Hades: daño por segundo del fuego
const BURN_TIME = 3;              // s de quemadura
const BURN_TICK = 0.25;           // s entre aplicaciones del daño por fuego
const STUN_TIME = 0.6;            // s de aturdimiento tras un golpe de escudo
const KNOCK_TIME = 0.25;          // s que dura el desplazamiento del empujón
const ATTACK_RECOVER = 0.35;      // s tras el impacto antes de volver a moverse
const DIRECT_RANGE = 4;           // con línea libre y a menos de esto, va directo al jugador
const FAR_DIST = 45;              // m de camino: demasiado lejos de todos los jugadores
const FAR_TIME = 10;              // s demasiado lejos antes de reaparecer
const MAX_PER_POCKET = 5;         // zombis como máximo esperando en un mismo callejón
const TURN_RATE = 10;             // rad/s de giro visual
const NUKE_SPREAD_MS = 900;       // la bomba nuclear mata escalonadamente en este intervalo
const OUTSIDE_STATES = new Set(['outside', 'tearing', 'climbing']);
const INSIDE_STATES = new Set(['inside', 'attacking', 'stunned']);

// Puestos de espera en el callejón (profundidad, lado) dejando libre el carril central hacia la ventana
const WAIT_SPOTS = [[2, -1], [2, 1], [3, -1], [3, 1], [3, 0]];

function baseSpeed(cls) {
  if (cls === 'sprint') return ZOMBIE.sprintSpeed;
  if (cls === 'run') return ZOMBIE.runSpeed;
  return ZOMBIE.walkSpeed;
}
// Probabilidad de que un zombi de la ronda r sea del tipo especial t
function typeChance(t, r) {
  if (!t || r < t.from) return 0;
  return Math.min(t.max, t.base + t.perRound * (r - t.from));
}
function moveAnim(z) {
  if (z.crawler) return ZA.CRAWL;
  if (z.cls === 'sprint') return ZA.SPRINT;
  if (z.cls === 'run') return ZA.RUN;
  return ZA.WALK;
}
function turnTowards(z, yaw, dt) {
  const d = angleDiff(z.rot, yaw);
  const maxStep = TURN_RATE * dt;
  z.rot += Math.abs(d) <= maxStep ? d : Math.sign(d) * maxStep;
  if (z.rot > Math.PI) z.rot -= Math.PI * 2;
  else if (z.rot < -Math.PI) z.rot += Math.PI * 2;
}

export class ZombieManager {
  constructor(game) {
    this.game = game;
    this.zombies = [];
    this.byId = new Map();
    this.nextId = 1;
    this.field = new FlowField();
    this.fieldTimer = 0;
    this.fieldKey = '';
    this.winOcc = new Array(WINDOW_INFO.length).fill(null); // zid que ocupa cada ventana
    this.queue = 0;            // zombis por aparecer en esta ronda
    this.spawnTimer = 0;
    this.spawnDelay = ZOMBIE.firstSpawnDelay;
    this.health = zombieHealth(1);
    this.speedChances = zombieSpeedChances(1);
    this.now = Date.now();
    this._targets = [];
    this._doors = {};
    this._solidIn = (x, z) => solidForZombieInside(x, z, this._doors);
  }

  get gs() { return this.game && this.game.gs; }

  // ------------------------------------------------------------------ API pública

  // Prepara la ronda 1
  startGame() {
    this.reset();
    const gs = this.gs;
    if (!gs) return;
    gs.round = 0;
    gs.roundState = 'pre';
    gs.roundUntil = Date.now() + ROUND.firstDelay * 1000;
    gs.zLeft = 0;
    this._markDirty();
  }

  // Borra zombis y rondas (vuelta al lobby)
  reset() {
    this.zombies = [];
    this.byId.clear();
    this.winOcc.fill(null);
    this.queue = 0;
    this.spawnTimer = 0;
    this.fieldKey = '';
    this.fieldTimer = 0;
    this.field.walkKey = null;
    this.field.hasSources = false;
    this.field.dist.fill(Infinity);
  }

  update(dt) {
    const gs = this.gs;
    if (!gs || gs.phase !== 'playing') return;
    const now = Date.now();
    this.now = now;
    this._doors = gs.doors || {};
    let targets = [];
    try { targets = this.game.targets() || []; } catch { targets = []; }
    this._targets = targets.filter((t) => t && Number.isFinite(t.x) && Number.isFinite(t.z));

    this._updateField(dt);
    this._updateRounds(now, dt);

    const list = this.zombies.slice();
    for (const z of list) {
      if (z.dead) continue;
      this._updateZombie(z, dt, now);
    }
    this._separate();
    for (const z of this.zombies) {
      if (!z.dead) this._trackStuck(z, dt);
    }
  }

  // Aplica daño a un zombi. info: { part, kind, weapon, upgraded, instakill, special, knockFrom }
  damage(zid, amount, pid, info = {}) {
    const z = this.byId.get(zid);
    if (!z || z.dead || z.dieAt) return { killed: false, existed: false };
    const inf = info || {};
    let amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) amt = 0;
    if (inf.instakill) amt = Math.max(amt, z.hp);
    const now = Date.now();
    if (inf.special === 'fire' && inf.kind !== 'fire') {
      z.burnUntil = now + BURN_TIME * 1000;
      z.burnPid = pid || null;
      z.flags |= ZF.BURNING;
    }
    if (amt <= 0) return { killed: false, existed: true };
    z.hp -= amt;
    if (z.hp <= 0) {
      this._kill(z, pid || null, inf);
      return { killed: true, existed: true };
    }
    if (inf.kind === 'explosion' && !z.crawler && z.type !== 'tank' && z.type !== 'bomber' && Math.random() < 0.3) this._makeCrawler(z);
    return { killed: false, existed: true };
  }

  // Mata a todos los zombis vivos. 'nuke' los mata escalonadamente (<1 s) sin puntos por bajas.
  killAll(kind = 'nuke') {
    const now = Date.now();
    let n = 0;
    for (const z of this.zombies.slice()) {
      if (z.dead || z.dieAt) continue;
      n++;
      if (kind === 'nuke') {
        z.dieAt = now + 80 + Math.random() * NUKE_SPREAD_MS;
        z.atk = null;
        z.anim = ZA.STUN;
      } else {
        this._kill(z, null, { kind, part: 'b' });
      }
    }
    return n;
  }

  // Empujón del escudo: desplaza al zombi `dist` metros alejándolo de (fromX, fromZ) y lo aturde
  knockback(zid, fromX, fromZ, dist) {
    const z = this.byId.get(zid);
    if (!z || z.dead || z.dieAt) return false;
    if (!INSIDE_STATES.has(z.state)) return false;
    if (z.type === 'tank' || z.fuseAt) return false;
    const now = Date.now();
    let dx = z.x - fromX, dz = z.z - fromZ;
    let len = Math.hypot(dx, dz);
    if (!Number.isFinite(len) || len < 1e-3) {
      dx = Math.sin(z.rot); dz = Math.cos(z.rot); len = 1; // hacia atrás del zombi
    }
    const d = Number.isFinite(dist) ? Math.max(0, Math.min(4, dist)) : ZOMBIE.radius;
    z.kvx = (dx / len) * d / KNOCK_TIME;
    z.kvz = (dz / len) * d / KNOCK_TIME;
    z.knockUntil = now + KNOCK_TIME * 1000;
    z.stunUntil = now + STUN_TIME * 1000;
    z.state = 'stunned';
    z.atk = null;
    z.anim = ZA.STUN;
    z.nextAttackAt = Math.max(z.nextAttackAt, z.stunUntil + 150);
    return true;
  }

  // [[id, x, z, rot, anim, flags, yOff, tipo], ...]
  snapshot() {
    const out = new Array(this.zombies.length);
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      out[i] = [z.id, r2(z.x), r2(z.z), r2(z.rot), z.anim, z.flags, 0, z.tcode | 0];
    }
    return out;
  }

  aliveCount() { return this.zombies.length; }

  list() { return this.zombies; }

  get(zid) { return this.byId.get(zid) || null; }

  // Modo desarrollo: elimina a todos (sin puntos) y salta a la ronda n
  setRound(n) {
    const gs = this.gs;
    if (!gs) return;
    const r = Math.max(1, Math.min(255, Math.floor(n) || 1));
    for (const z of this.zombies.slice()) this._kill(z, null, { kind: 'nuke', part: 'b', silentRound: true });
    this.queue = 0;
    gs.round = r - 1;
    gs.roundState = 'intermission';
    gs.roundUntil = Date.now() + 1500;
    this._syncZLeft();
    this._markDirty();
  }

  // ------------------------------------------------------------------ Rondas y aparición

  _updateRounds(now, dt) {
    const gs = this.gs;
    if (gs.roundState === 'pre' || gs.roundState === 'intermission') {
      if (gs.roundUntil && now >= gs.roundUntil) this._beginRound((gs.round | 0) + 1, now);
      return;
    }
    if (gs.roundState !== 'active') return;
    if (this.queue > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.zombies.length < ZOMBIE.maxAlive) {
        const type = this._pickType();
        if (this._spawnOne(type)) {
          this.queue--;
          this.spawnTimer = this.spawnDelay;
          this._syncZLeft();
        } else {
          if (type === 'tank') this.pendingTanks++;
          this.spawnTimer = 0.4; // no hay ventana disponible ahora mismo: reintentar pronto
        }
      }
    }
    if (this.queue <= 0 && this.zombies.length === 0) this._endRound(now);
  }

  _beginRound(r, now) {
    const gs = this.gs;
    gs.round = r;
    gs.roundState = 'active';
    gs.roundUntil = 0;
    gs.roundStartAt = now;
    let players = 1;
    try { players = Math.max(1, Object.keys(gs.players || {}).length); } catch { players = 1; }
    this.queue = zombiesForRound(r, players);
    // Tanques: a partir de su ronda, con probabilidad creciente (y dos desde 'twoFrom')
    const T = ZOMBIE_TYPES.tank;
    this.pendingTanks = 0;
    if (r >= T.from) {
      const ch = Math.min(1, T.chance + T.perRound * (r - T.from));
      if (Math.random() < ch) this.pendingTanks++;
      if (r >= T.twoFrom && Math.random() < ch * 0.5) this.pendingTanks++;
    }
    this.queue += this.pendingTanks;
    this.roundTotal = this.queue;
    this.spawnedThisRound = 0;
    this.players = players;
    this.health = zombieHealth(r);
    this.speedChances = zombieSpeedChances(r);
    this.spawnDelay = Math.max(ZOMBIE.minSpawnDelay, ZOMBIE.firstSpawnDelay * Math.pow(ZOMBIE.spawnDelayDecay, r - 1));
    this.spawnTimer = 1.0;
    this._syncZLeft();
    this._markDirty();
    this._call('onRoundStart', r);
  }

  _endRound(now) {
    const gs = this.gs;
    gs.roundState = 'intermission';
    gs.roundUntil = now + ROUND.intermission * 1000;
    if (gs.roundStartAt) gs.lastRoundTime = now - gs.roundStartAt;
    this._syncZLeft();
    this._markDirty();
    this._call('onRoundEnd', gs.round);
  }

  // Tipo del siguiente zombi de la cola
  _pickType() {
    const r = this.gs.round | 0;
    if (this.pendingTanks > 0 && this.spawnedThisRound >= (this.roundTotal || 0) * 0.3) {
      const alive = this.zombies.filter((z) => z.type === 'tank').length;
      if (alive < (r >= ZOMBIE_TYPES.tank.twoFrom ? 2 : 1)) { this.pendingTanks--; return 'tank'; }
    }
    // no dejar que la cola se quede sin sitio para los tanques pendientes
    if (this.pendingTanks > 0 && this.queue <= this.pendingTanks) { this.pendingTanks--; return 'tank'; }
    const x = Math.random();
    const pr = typeChance(ZOMBIE_TYPES.runner, r), pb = typeChance(ZOMBIE_TYPES.bomber, r);
    if (x < pb) return 'bomber';
    if (x < pb + pr) return 'runner';
    return 'normal';
  }

  // Modo desarrollo: hace aparecer ya un zombi del tipo indicado
  spawnSpecial(type) {
    if (!ZOMBIE_TYPES[type]) return false;
    const ok = this._spawnOne(type);
    if (ok) this._syncZLeft();
    return ok;
  }

  _spawnOne(type = 'normal') {
    const gs = this.gs;
    const open = new Set(Array.isArray(gs.openZones) ? gs.openZones : [0]);
    const counts = new Array(WINDOW_INFO.length).fill(0);
    for (const z of this.zombies) if (OUTSIDE_STATES.has(z.state)) counts[z.win]++;
    let cands = WINDOW_INFO.filter((w) => open.has(w.zone) && counts[w.id] < MAX_PER_POCKET);
    if (!cands.length) return false;
    if (this.field.hasSources) {
      cands = cands
        .map((w) => ({ w, d: this.field.at(w.land[0], w.land[1]) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 4)
        .map((o) => o.w);
    } else {
      cands = cands.slice().sort(() => Math.random() - 0.5).slice(0, 4);
    }
    const w = cands[Math.floor(Math.random() * cands.length)];
    const d = DIRS[w.dir];
    const side = (Math.random() * 2 - 1) * 0.85;
    const depth = 2.7 + Math.random() * 0.45;
    const x = w.x + 0.5 + d.dx * depth - d.dz * side;
    const zz = w.z + 0.5 + d.dz * depth + d.dx * side;

    const { run, sprint } = this.speedChances;
    const rnd = Math.random();
    const cls = rnd < sprint ? 'sprint' : rnd < run ? 'run' : 'walk';
    const z = {
      id: this.nextId++,
      x, z: zz,
      rot: yawTo(x, zz, w.cx, w.cz),
      hp: this.health, maxHp: this.health,
      cls,
      speed: baseSpeed(cls) * (0.92 + Math.random() * 0.16),
      crawler: false,
      state: 'outside',
      win: w.id,
      waitSpot: WAIT_SPOTS[this.nextId % WAIT_SPOTS.length],
      anim: ZA.WALK,
      flags: ZF.OUTSIDE,
      atk: null,
      nextAttackAt: 0,
      tearAcc: 0,
      climbT: 0,
      burnUntil: 0, burnPid: null, burnAcc: 0,
      stunUntil: 0, knockUntil: 0, kvx: 0, kvz: 0,
      dieAt: 0,
      stuckT: 0, bestDist: Infinity, ax: x, az: zz, farT: 0, nearD: Infinity,
      wander: null, wanderUntil: 0,
      dead: false,
      type: 'normal', tcode: 0, dmg: ZOMBIE.damage, range: ZOMBIE.attackRange,
      windup: ZOMBIE.attackWindup, cooldown: ZOMBIE.attackCooldown, tearMult: 1, fuseAt: 0,
    };
    this._applyType(z, type);
    this.zombies.push(z);
    this.byId.set(z.id, z);
    this.spawnedThisRound = (this.spawnedThisRound || 0) + 1;
    if (z.type === 'tank') this._call('broadcastEvent', { e: 'tank', id: z.id });
    return true;
  }

  _applyType(z, type) {
    const T = ZOMBIE_TYPES[type];
    if (!T || type === 'normal') return;
    z.type = type;
    z.tcode = T.code;
    if (type === 'runner') {
      z.hp = z.maxHp = Math.max(1, Math.round(this.health * T.hpMult));
      z.cls = 'sprint';
      z.speed = T.speed * (0.94 + Math.random() * 0.12);
      z.dmg = T.damage;
    } else if (type === 'bomber') {
      z.hp = z.maxHp = Math.max(1, Math.round(this.health * T.hpMult));
      z.cls = 'walk';
      z.speed = T.speed;
      z.dmg = T.damage;
    } else if (type === 'tank') {
      const extra = Math.max(0, (this.players || 1) - 1);
      z.hp = z.maxHp = Math.round((T.hpBase + this.health * T.hpRoundMult) * (1 + T.hpPerExtraPlayer * extra));
      z.cls = 'run';
      z.speed = T.speed;
      z.dmg = T.damage;
      z.range = T.attackRange;
      z.windup = T.windup;
      z.cooldown = T.cooldown;
      z.tearMult = T.tearMult;
    }
  }

  _syncZLeft() {
    const gs = this.gs;
    if (!gs) return;
    const v = Math.max(0, this.queue) + this.zombies.length;
    if (gs.zLeft !== v) { gs.zLeft = v; this._markDirty(); }
  }

  // ------------------------------------------------------------------ Campo de flujo

  _updateField(dt) {
    const gs = this.gs;
    this.field.updateWalkable(gs.doors || {});
    this.fieldTimer -= dt;
    let key = doorsKey(gs.doors) + '|';
    for (const t of this._targets) key += Math.floor(t.x) + ',' + Math.floor(t.z) + ';';
    if (key === this.fieldKey && this.fieldTimer > 0) return;
    this.fieldKey = key;
    this.fieldTimer = FIELD_INTERVAL;
    if (this._targets.length) {
      this.field.compute(this._targets, gs.doors || {});
    } else {
      this.field.dist.fill(Infinity);
      this.field.hasSources = false;
    }
  }

  // ------------------------------------------------------------------ IA por zombi

  _updateZombie(z, dt, now) {
    // Muerte programada por la bomba nuclear
    if (z.dieAt) {
      if (now >= z.dieAt) this._kill(z, null, { kind: 'nuke', part: 'b' });
      else z.anim = ZA.STUN;
      return;
    }
    // Fuego (Hades)
    if (z.burnUntil > now) {
      z.flags |= ZF.BURNING;
      z.burnAcc += dt;
      if (z.burnAcc >= BURN_TICK) {
        const amount = BURN_DPS * z.burnAcc;
        z.burnAcc = 0;
        const pid = z.burnPid && this.gs.players && this.gs.players[z.burnPid] ? z.burnPid : null;
        this.damage(z.id, amount, pid, { kind: 'fire', part: 'b', special: null });
        if (z.dead) return;
      }
    } else if (z.flags & ZF.BURNING) {
      z.flags &= ~ZF.BURNING;
      z.burnAcc = 0;
    }

    // Explosivo con la mecha encendida: tiembla quieto y estalla
    if (z.fuseAt) {
      z.anim = ZA.STUN;
      z.atk = null;
      if (now >= z.fuseAt) this._kill(z, null, { kind: 'selfdestruct', part: 'b' });
      return;
    }

    switch (z.state) {
      case 'outside': this._updOutside(z, dt, now); break;
      case 'tearing': this._updTearing(z, dt, now); break;
      case 'climbing': this._updClimbing(z, dt); break;
      case 'attacking': this._updAttack(z, dt, now); break;
      case 'stunned': this._updStunned(z, dt, now); break;
      default: this._updInside(z, dt, now); break;
    }
  }

  // En el callejón: caminar hasta la celda de arranque o esperar turno
  _updOutside(z, dt, now) {
    const w = WINDOW_INFO[z.win];
    const occ = this.winOcc[z.win];
    const free = occ === null || occ === z.id;
    let tx, tz;
    if (free) {
      tx = w.tear[0] + 0.5; tz = w.tear[1] + 0.5;
    } else {
      const d = DIRS[w.dir];
      const [depth, side] = z.waitSpot;
      tx = w.x + 0.5 + d.dx * depth - d.dz * side * 0.95;
      tz = w.z + 0.5 + d.dz * depth + d.dx * side * 0.95;
    }
    const dx = tx - z.x, dz = tz - z.z;
    const dist = Math.hypot(dx, dz);
    if (free && dist < 0.2) {
      // Ocupa la ventana
      this.winOcc[z.win] = z.id;
      z.x = tx; z.z = tz;
      z.rot = yawTo(z.x, z.z, w.cx, w.cz);
      z.tearAcc = 0;
      z.state = (this.gs.windows[z.win] | 0) > 0 ? 'tearing' : 'climbing';
      z.climbT = 0;
      z.anim = z.state === 'tearing' ? ZA.TEAR : ZA.CLIMB;
      return;
    }
    if (dist > 0.12) {
      const step = Math.min(dist, z.speed * dt);
      const r = moveCircle(z.x, z.z, (dx / dist) * step, (dz / dist) * step, ZOMBIE.radius, solidForZombieOutside);
      z.x = r.x; z.z = r.z;
      turnTowards(z, yawTo(0, 0, dx, dz), dt);
      z.anim = moveAnim(z);
    } else {
      turnTowards(z, yawTo(z.x, z.z, w.cx, w.cz), dt);
      z.anim = z.crawler ? ZA.CRAWL : ZA.IDLE;
    }
  }

  // Arrancando tablas (y golpeando a través de la ventana si hay alguien pegado)
  _updTearing(z, dt, now) {
    const w = WINDOW_INFO[z.win];
    z.x = w.tear[0] + 0.5; z.z = w.tear[1] + 0.5;
    z.rot = yawTo(z.x, z.z, w.cx, w.cz);
    if (z.atk) { this._updAttack(z, dt, now); return; }
    const boards = this.gs.windows[z.win] | 0;
    if (boards <= 0) {
      z.state = 'climbing';
      z.climbT = 0;
      z.anim = ZA.CLIMB;
      return;
    }
    if (now >= z.nextAttackAt) {
      const lx = w.land[0] + 0.5, lz = w.land[1] + 0.5;
      let victim = null, vd = WINDOW_REACH;
      for (const t of this._targets) {
        const d = Math.hypot(t.x - lx, t.z - lz);
        if (d <= vd) { vd = d; victim = t; }
      }
      if (victim) { this._startAttack(z, victim.pid, now, true); return; }
    }
    z.anim = ZA.TEAR;
    z.tearAcc += dt;
    const tearTime = ZOMBIE.tearTime * (z.tearMult || 1);
    if (z.tearAcc >= tearTime) {
      z.tearAcc -= tearTime;
      this._call('setBoards', z.win, Math.max(0, boards - 1), null);
    }
  }

  // Cruzando la ventana: tear → ventana → land
  _updClimbing(z, dt) {
    const w = WINDOW_INFO[z.win];
    z.climbT += dt;
    const t = Math.min(1, z.climbT / ZOMBIE.climbTime);
    const ax = w.tear[0] + 0.5, az = w.tear[1] + 0.5;
    const bx = w.cx, bz = w.cz;
    const cx = w.land[0] + 0.5, cz = w.land[1] + 0.5;
    if (t < 0.5) {
      const k = t * 2;
      z.x = ax + (bx - ax) * k; z.z = az + (bz - az) * k;
    } else {
      const k = (t - 0.5) * 2;
      z.x = bx + (cx - bx) * k; z.z = bz + (cz - bz) * k;
    }
    z.rot = yawTo(ax, az, cx, cz);
    z.anim = ZA.CLIMB;
    if (t >= 1) {
      if (this.winOcc[z.win] === z.id) this.winOcc[z.win] = null;
      z.state = 'inside';
      z.flags &= ~ZF.OUTSIDE;
      z.x = cx; z.z = cz;
      z.stuckT = 0; z.bestDist = Infinity; z.ax = z.x; z.az = z.z; z.farT = 0;
      z.anim = moveAnim(z);
    }
  }

  _startAttack(z, pid, now, through) {
    z.atk = { pid, t: 0, hit: false, through: !!through, start: now };
    z.anim = ZA.ATTACK;
    if (!through) z.state = 'attacking';
  }

  _updAttack(z, dt, now) {
    const a = z.atk;
    if (!a) { z.state = 'inside'; return; }
    a.t += dt;
    z.anim = ZA.ATTACK;
    const tp = this._targetPos(a.pid);
    if (tp && !a.through) {
      turnTowards(z, yawTo(z.x, z.z, tp.x, tp.z), dt);
      // se arrima un poco al objetivo mientras golpea
      const dx = tp.x - z.x, dz = tp.z - z.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.75) {
        const step = Math.min(d - 0.75, z.speed * 0.2 * dt);
        const r = moveCircle(z.x, z.z, (dx / d) * step, (dz / d) * step, ZOMBIE.radius, this._solidIn);
        z.x = r.x; z.z = r.z;
      }
    }
    if (!a.hit && a.t >= z.windup) {
      a.hit = true;
      let inRange = false;
      if (tp) {
        if (a.through) {
          const w = WINDOW_INFO[z.win];
          inRange = Math.hypot(tp.x - (w.land[0] + 0.5), tp.z - (w.land[1] + 0.5)) <= WINDOW_REACH + 0.35;
        } else {
          inRange = Math.hypot(tp.x - z.x, tp.z - z.z) <= z.range + 0.35;
        }
      }
      let hit = false, blocked = false;
      if (inRange) {
        const res = this._call('damagePlayer', a.pid, z.dmg, z);
        if (res && typeof res === 'object') { hit = !!res.hit; blocked = !!res.blocked; } else hit = !!res;
      }
      this._call('broadcastEvent', { e: 'zatk', id: z.id, pid: a.pid, hit, blocked });
    }
    if (a.t >= z.windup + ATTACK_RECOVER) {
      z.atk = null;
      z.nextAttackAt = a.start + z.cooldown * 1000;
      if (z.state === 'attacking') z.state = 'inside';
    }
  }

  _updStunned(z, dt, now) {
    z.anim = ZA.STUN;
    if (now < z.knockUntil) {
      const r = moveCircle(z.x, z.z, z.kvx * dt, z.kvz * dt, ZOMBIE.radius, this._solidIn);
      z.x = r.x; z.z = r.z;
    }
    if (now >= z.stunUntil) {
      z.state = 'inside';
      z.anim = moveAnim(z);
    }
  }

  // Persecución por el campo de flujo
  _updInside(z, dt, now) {
    const targets = this._targets;
    if (!targets.length) { this._wander(z, dt, now); return; }
    z.wander = null;
    let best = null, bd = Infinity;
    for (const t of targets) {
      const d = Math.hypot(t.x - z.x, t.z - z.z);
      if (d < bd) { bd = d; best = t; }
    }
    z.nearD = bd;
    // Explosivo: al acercarse enciende la mecha
    if (z.type === 'bomber' && bd <= ZOMBIE_TYPES.bomber.trigger && !z.crawler) {
      z.fuseAt = now + ZOMBIE_TYPES.bomber.fuse * 1000;
      z.flags |= ZF.FUSE;
      z.anim = ZA.STUN;
      this._call('broadcastEvent', { e: 'fuse', id: z.id });
      return;
    }
    if (bd <= z.range && now >= z.nextAttackAt) {
      this._startAttack(z, best.pid, now, false);
      return;
    }
    // Ya está pegado al jugador esperando el siguiente golpe
    if (bd <= z.range * 0.8) {
      turnTowards(z, yawTo(z.x, z.z, best.x, best.z), dt);
      z.anim = z.crawler ? ZA.CRAWL : ZA.IDLE;
      return;
    }
    let tx = best.x, tz = best.z;
    let direct = false;
    if (bd < DIRECT_RANGE && clearPath(z.x, z.z, best.x, best.z, ZOMBIE.radius * 0.9, this._solidIn)) direct = true;
    if (!direct) {
      const cx = Math.floor(z.x), cz = Math.floor(z.z);
      const path = this.field.follow(cx, cz, 4);
      if (path.length) {
        // "Tirar de la cuerda": la celda más lejana del camino alcanzable en línea recta
        let pick = path[0];
        for (let k = path.length - 1; k >= 1; k--) {
          const p = path[k];
          if (clearPath(z.x, z.z, p[0] + 0.5, p[1] + 0.5, ZOMBIE.radius, this._solidIn)) { pick = p; break; }
        }
        tx = pick[0] + 0.5; tz = pick[1] + 0.5;
        // Si la celda final es la del jugador, ir directamente a él
        if (this.field.at(pick[0], pick[1]) === 0 && Math.floor(best.x) === pick[0] && Math.floor(best.z) === pick[1]) {
          tx = best.x; tz = best.z;
        }
      }
    }
    const dx = tx - z.x, dz = tz - z.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-3) {
      const step = Math.min(dist, z.speed * dt);
      const r = moveCircle(z.x, z.z, (dx / dist) * step, (dz / dist) * step, ZOMBIE.radius, this._solidIn);
      z.x = r.x; z.z = r.z;
      turnTowards(z, yawTo(0, 0, dx, dz), dt);
    }
    z.anim = moveAnim(z);
  }

  // Sin objetivos (todos caídos): deambular despacio
  _wander(z, dt, now) {
    z.nearD = Infinity;
    if (!z.wander || now > z.wanderUntil) {
      z.wander = randomPointNear(this.field, z.x, z.z, 6, ZOMBIE.radius, this._solidIn);
      z.wanderUntil = now + 4000 + Math.random() * 4000;
      if (!z.wander) { z.anim = z.crawler ? ZA.CRAWL : ZA.IDLE; return; }
    }
    const dx = z.wander.x - z.x, dz = z.wander.z - z.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.3) {
      z.anim = z.crawler ? ZA.CRAWL : ZA.IDLE;
      return;
    }
    const speed = z.crawler ? ZOMBIE.crawlSpeed * 0.8 : ZOMBIE.walkSpeed * 0.6;
    const step = Math.min(dist, speed * dt);
    const r = moveCircle(z.x, z.z, (dx / dist) * step, (dz / dist) * step, ZOMBIE.radius, this._solidIn);
    z.x = r.x; z.z = r.z;
    turnTowards(z, yawTo(0, 0, dx, dz), dt);
    z.anim = z.crawler ? ZA.CRAWL : ZA.WALK;
  }

  // Separación entre zombis y con los jugadores
  _separate() {
    const zs = this.zombies;
    const n = zs.length;
    const S2 = SEP_RADIUS * SEP_RADIUS;
    for (let i = 0; i < n; i++) {
      const a = zs[i];
      if (a.dead) continue;
      const aIn = INSIDE_STATES.has(a.state);
      const aFixed = a.state === 'tearing' || a.state === 'climbing' || !!a.dieAt;
      for (let j = i + 1; j < n; j++) {
        const b = zs[j];
        if (b.dead) continue;
        const bIn = INSIDE_STATES.has(b.state);
        if (aIn !== bIn) continue;
        if (!aIn && a.win !== b.win) continue;
        const bFixed = b.state === 'tearing' || b.state === 'climbing' || !!b.dieAt;
        if (aFixed && bFixed) continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= S2) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-4) { const ang = (a.id * 2.399) % (Math.PI * 2); dx = Math.cos(ang); dz = Math.sin(ang); d = 1; }
        else { dx /= d; dz /= d; }
        const overlap = Math.min(SEP_RADIUS - (d2 < 1e-8 ? 0 : Math.sqrt(d2)), 0.25);
        const pa = aFixed ? 0 : bFixed ? overlap : overlap * 0.5;
        const pb = bFixed ? 0 : aFixed ? overlap : overlap * 0.5;
        if (pa > 0) this._nudge(a, -dx * pa, -dz * pa, aIn);
        if (pb > 0) this._nudge(b, dx * pb, dz * pb, bIn);
      }
    }
    // No atravesar a los jugadores (vivos o caídos)
    let bodies = null;
    try { bodies = typeof this.game.bodies === 'function' ? this.game.bodies() : this._targets; } catch { bodies = this._targets; }
    if (!bodies || !bodies.length) return;
    for (const z of zs) {
      if (z.dead || !INSIDE_STATES.has(z.state)) continue;
      for (const p of bodies) {
        let dx = z.x - p.x, dz = z.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d >= PLAYER_BODY) continue;
        if (d < 1e-4) { dx = Math.sin(z.rot); dz = Math.cos(z.rot); } else { dx /= d; dz /= d; }
        const push = Math.min(PLAYER_BODY - d, 0.3);
        this._nudge(z, dx * push, dz * push, true);
      }
    }
  }

  _nudge(z, dx, dz, inside) {
    if (inside) {
      const r = resolveCircle(z.x + dx, z.z + dz, ZOMBIE.radius, this._solidIn);
      z.x = r[0]; z.z = r[1];
    } else {
      const r = resolveCircle(z.x + dx, z.z + dz, ZOMBIE.radius, solidForZombieOutside);
      z.x = r[0]; z.z = r[1];
    }
  }

  // Atascos: sin progreso durante mucho tiempo o demasiado lejos de todos → vuelve a la cola
  _trackStuck(z, dt) {
    if (z.dieAt || z.state === 'climbing') return;
    if (!this._targets.length || !this.field.hasSources) { z.stuckT = 0; z.farT = 0; return; }
    let d;
    if (INSIDE_STATES.has(z.state)) {
      d = this.field.atPos(z.x, z.z);
      if (d === Infinity) {
        const c = this.field.nearestWalkable(z.x, z.z, 1);
        d = c ? this.field.at(c[0], c[1]) : Infinity;
      }
    } else {
      const w = WINDOW_INFO[z.win];
      d = this.field.at(w.land[0], w.land[1]) + 2;
    }
    if (d > FAR_DIST) z.farT += dt; else z.farT = 0;
    if (z.farT >= FAR_TIME) { this._respawn(z); return; }
    if (!INSIDE_STATES.has(z.state)) { z.stuckT = 0; return; }
    if (z.state === 'attacking' || z.nearD < 3) {
      z.stuckT = 0; z.bestDist = d; z.ax = z.x; z.az = z.z;
      return;
    }
    if (d < z.bestDist - 0.5) { z.bestDist = d; z.stuckT = 0; }
    if (Math.hypot(z.x - z.ax, z.z - z.az) > 2.5) { z.ax = z.x; z.az = z.z; z.bestDist = d; z.stuckT = 0; }
    z.stuckT += dt;
    if (z.stuckT >= ZOMBIE.stuckRespawnTime) this._respawn(z);
  }

  // ------------------------------------------------------------------ Utilidades internas

  _targetPos(pid) {
    for (const t of this._targets) if (t.pid === pid) return t;
    return null;
  }

  _makeCrawler(z) {
    z.crawler = true;
    z.flags |= ZF.CRAWLER;
    z.speed = ZOMBIE.crawlSpeed * (0.9 + Math.random() * 0.2);
  }

  _remove(z) {
    z.dead = true;
    const i = this.zombies.indexOf(z);
    if (i >= 0) this.zombies.splice(i, 1);
    this.byId.delete(z.id);
    if (this.winOcc[z.win] === z.id) this.winOcc[z.win] = null;
  }

  // Elimina al zombi sin contarlo como baja y lo devuelve a la cola de aparición
  _respawn(z) {
    if (z.dead) return;
    this._remove(z);
    if (z.type === 'tank') this.pendingTanks = (this.pendingTanks || 0) + 1;
    this.queue++;
    this._syncZLeft();
  }

  _kill(z, pid, info) {
    if (z.dead) return;
    this._remove(z);
    this._syncZLeft();
    const inf = info || { kind: 'bullet', part: 'b' };
    this._call('onZombieKilled', z, pid, inf);
    // El explosivo estalla al morir (salvo la bomba nuclear o el modo desarrollo)
    if (z.type === 'bomber' && inf.kind !== 'nuke' && inf.kind !== 'dev') this._call('zombieExplosion', z, pid);
  }

  _markDirty() { this._call('markDirty'); }

  // Llama a un método de Game de forma defensiva (un fallo allí no debe romper la IA)
  _call(method, ...args) {
    const g = this.game;
    if (!g || typeof g[method] !== 'function') return undefined;
    try { return g[method](...args); } catch (e) {
      console.error(`[zombies] error en game.${method}:`, e && e.stack ? e.stack : e);
      return undefined;
    }
  }
}

export default ZombieManager;
