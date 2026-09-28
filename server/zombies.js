// ZombieManager: rondas, aparición en las ventanas, IA (callejón → barricada → interior → persecución),
// ataques, reptantes, quemaduras, empujones del escudo y detección de atascos.
// API usada por Game (SPEC.md 5.3).

import {
  ZOMBIE, ROUND, ZOMBIE_TYPES, BOSS_RULES, BOSS_KEYS, zombieHealth, zombiesForRound, zombieSpeedChances, angleDiff, yawTo,
  BALANCE, DOG_ROUND, isDogRound,
} from '../shared/constants.js';
import { WINDOW_INFO, DIRS, MAP } from '../shared/map.js';
import { moveCircle, resolveCircle, solidForZombieInside, solidForZombieOutside } from '../shared/collision.js';
import { ZA, ZF, r2 } from '../shared/protocol.js';
import { FlowField, clearPath, randomPointNear, doorsKey } from './nav.js';
import { Zombie, INSIDE_STATES } from './entities/zombie.js';

const FIELD_INTERVAL = 0.25;      // s entre recálculos periódicos del campo de flujo
const SEP_RADIUS = 0.75;          // separación mínima entre zombis
const PLAYER_BODY = 0.62;         // distancia mínima entre el centro de un zombi y un jugador
const WINDOW_REACH = 1.0;         // un zombi en la ventana golpea a quien esté a esta distancia de la celda interior
const BURN_DPS = 150;             // Hades: daño por segundo del fuego
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
// BURN_TIME/CRAWL_EDGE/CRAWL_SAVE_CHANCE/CRAWL_SURVIVE_CHANCE/INSIDE_STATES: ahora en entities/zombie.js
// (los usa Zombie.takeDamage); INSIDE_STATES se sigue usando bastante acá también, de ahí el import.
const OUTSIDE_STATES = new Set(['outside', 'tearing', 'climbing']);

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
// Distancia horizontal a un objetivo; si está en otra planta cuenta como muy lejos (no se le ataca a través del suelo)
function flatDist(z, t) {
  const d = Math.hypot(t.x - z.x, t.z - z.z);
  return Math.abs((t.y || 0) - (z.y || 0)) > 1.5 ? d + 1000 : d;
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
    this.now = this._clock();
    this._targets = [];
    this._doors = {};
    // Easter egg (Castillo): jefe forzado en la próxima ronda, rondas detenidas (batalla final) y oleada continua
    this.forceBoss = null;
    this.pauseSpawns = false;
    this.rush = false;
    // colisión a la altura del zombi que se está moviendo (_curY): decide la planta y las escaleras
    this._curY = MAP.levels[0].y;
    this._curX = 0; this._curZ = 0;
    this._solidIn = (x, z) => solidForZombieInside(x, z, this._doors, this._curY, this._curX, this._curZ);
    this._solidOut = (x, z) => solidForZombieOutside(x, z, this._curY);
    // clearPath evalúa la regla de las escaleras desde cada punto del trayecto (y luego restaura la posición)
    this._pathSample = (x, z) => { this._curX = x; this._curZ = z; };
  }

  get gs() { return this.game && this.game.gs; }

  // Reloj de juego (se detiene durante la pausa); sin Game, el reloj real
  _clock() { return this.game && typeof this.game.clock === 'function' ? this.game.clock() : Date.now(); }

  // ------------------------------------------------------------------ API pública

  // Prepara la ronda 1
  startGame() {
    this.reset();
    this.nextBossRound = BOSS_RULES.firstRound;
    this.dogsDeferred = false;
    const gs = this.gs;
    if (!gs) return;
    gs.round = 0;
    gs.roundState = 'pre';
    gs.roundUntil = this._clock() + ROUND.firstDelay * 1000;
    gs.zLeft = 0;
    this._markDirty();
  }

  // Borra zombis y rondas (vuelta al lobby)
  reset() {
    this.forceBoss = null;
    this.pauseSpawns = false;
    this.rush = false;
    this.dogRound = false;
    this.dogsDeferred = false;
    this.nextBossRound = null;
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
    const now = this._clock();
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
  // Delegado a Zombie.takeDamage (entities/zombie.js): esa clase decide y muta (daño, jefe/armadura,
  // quemadura, reptante); acá solo se traduce el resultado a lo que sigue siendo de la COLECCIÓN
  // (sincronizar gs.bosses, sacarlo de las listas si murió, avisar a Game).
  damage(zid, amount, pid, info = {}) {
    const z = this.byId.get(zid);
    if (!z) return { killed: false, existed: false };
    const r = new Zombie(z, this).takeDamage(amount, pid, info, this._clock());
    if (!r.existed) return { killed: false, existed: false };
    if (r.appliedDamage && z.boss) this._syncBosses();
    if (r.killed) {
      // Copia, no mutación: info puede venir compartido entre varias llamadas (p. ej. el impacto directo y
      // el bucle de salpicadura de una misma explosión) — escribir amt directamente en él se filtraría a
      // los demás zombis golpeados por la misma explosión.
      this._kill(z, pid || null, { ...(info || {}), amt: r.amt });
      return { killed: true, existed: true };
    }
    return { killed: false, existed: true };
  }

  // Mata a todos los zombis vivos. 'nuke' los mata escalonadamente (<1 s) sin puntos por bajas.
  killAll(kind = 'nuke') {
    const now = this._clock();
    let n = 0;
    for (const z of this.zombies.slice()) {
      if (z.dead || z.dieAt) continue;
      if (kind === 'nuke' && z.final) continue;   // la bomba nuclear no acaba con el jefe final
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
    if (z.type === 'tank' || z.boss || z.fuseAt) return false;
    const now = this._clock();
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
      out[i] = [z.id, r2(z.x), r2(z.z), r2(z.rot), z.anim, z.flags, r2(z.y || 0), z.tcode | 0];
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
    gs.roundUntil = this._clock() + 1500;
    this._syncZLeft();
    this._markDirty();
  }

  // ------------------------------------------------------------------ Rondas y aparición

  _updateRounds(now, dt) {
    const gs = this.gs;
    if (this.pauseSpawns) return;   // batalla final: la ronda queda congelada
    if (gs.roundState === 'pre' || gs.roundState === 'intermission') {
      if (gs.roundUntil && now >= gs.roundUntil) this._beginRound((gs.round | 0) + 1, now);
      return;
    }
    if (gs.roundState !== 'active') return;
    // Oleada (centrifugadora del easter egg): la cola no se vacía y aparecen más deprisa
    if (this.rush && !this.dogRound && this.queue < 4) { this.queue += 6; this.roundTotal = (this.roundTotal || 0) + 6; this._syncZLeft(); }
    if (this.queue > 0) {
      this.spawnTimer -= dt;
      const maxAlive = this.dogRound ? DOG_ROUND.aliveBase + DOG_ROUND.alivePerPlayer * (this.players || 1) : ZOMBIE.maxAlive;
      if (this.spawnTimer <= 0 && this.zombies.length < maxAlive) {
        const type = this._pickType();
        if (this._spawnOne(type)) {
          this.queue--;
          this.spawnTimer = this.rush ? Math.min(this.spawnDelay, 0.7) : this.spawnDelay;
          this._syncZLeft();
        } else {
          if (type === 'tank') this.pendingTanks++;
          else if (ZOMBIE_TYPES[type] && ZOMBIE_TYPES[type].boss) this.pendingBosses++;
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
    // ¿Ronda de jefe? Tiene prioridad: si coincide con una de perros, los perros pasan a la siguiente
    if (this.nextBossRound == null) this.nextBossRound = BOSS_RULES.firstRound;
    const forced = this.forceBoss && ZOMBIE_TYPES[this.forceBoss] ? this.forceBoss : null;
    this.forceBoss = null;
    this.forcedKey = forced;
    const scheduled = r >= this.nextBossRound;
    const bossNow = scheduled || !!forced;
    const deferred = this.dogsDeferred;
    this.dogsDeferred = bossNow && isDogRound(r);
    if (!bossNow && (isDogRound(r) || deferred)) { this._beginDogRound(r, players, now); return; }
    this.dogRound = false;
    gs.dogRound = false;
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
    this.pendingBosses = 0;
    if (scheduled) {
      this.pendingBosses = 1 + (r >= BOSS_RULES.twoFrom ? 1 : 0);
      this.nextBossRound = this._rollBossRound(r);
    } else if (forced) this.pendingBosses = 1;
    this.queue += this.pendingBosses;
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

  // Siguiente ronda de jefe: 8, 9 o 10 rondas después de `after`
  _rollBossRound(after) {
    return after + BOSS_RULES.gapMin + Math.floor(Math.random() * (BOSS_RULES.gapMax - BOSS_RULES.gapMin + 1));
  }

  _beginDogRound(r, players, now) {
    const gs = this.gs;
    const nth = Math.floor(r / DOG_ROUND.every);          // 1.ª, 2.ª... ronda de perros
    this.dogRound = true;
    gs.dogRound = true;
    this.queue = Math.min(DOG_ROUND.max, DOG_ROUND.base + DOG_ROUND.perPlayer * players + DOG_ROUND.perDogRound * (nth - 1));
    this.pendingTanks = 0;
    this.pendingBosses = 0;
    this.roundTotal = this.queue;
    this.spawnedThisRound = 0;
    this.players = players;
    this.health = zombieHealth(r);
    this.speedChances = zombieSpeedChances(r);
    this.spawnDelay = DOG_ROUND.spawnDelay;
    this.spawnTimer = 2.5;                                 // un respiro tras el aviso
    this.lastDogPos = null;
    this._syncZLeft();
    this._markDirty();
    this._call('onRoundStart', r);
    this._call('broadcastEvent', { e: 'dogRound', round: r });
  }

  _endRound(now) {
    const gs = this.gs;
    if (this.dogRound) this._call('onDogRoundEnd', this.lastDogPos);
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
    if (this.dogRound) return 'dog';
    if (this.pendingBosses > 0 && (this.spawnedThisRound >= (this.roundTotal || 0) * BOSS_RULES.spawnAt
        || this.queue <= this.pendingBosses + (this.pendingTanks || 0))) {
      this.pendingBosses--;
      return this._nextBossKey();
    }
    if (this.pendingTanks > 0 && this.spawnedThisRound >= (this.roundTotal || 0) * 0.3) {
      const alive = this.zombies.filter((z) => z.type === 'tank').length;
      if (alive < (r >= ZOMBIE_TYPES.tank.twoFrom ? 2 : 1)) { this.pendingTanks--; return 'tank'; }
    }
    // no dejar que la cola se quede sin sitio para los tanques pendientes
    if (this.pendingTanks > 0 && this.queue <= this.pendingTanks + (this.pendingBosses || 0)) { this.pendingTanks--; return 'tank'; }
    const x = Math.random();
    const pr = typeChance(ZOMBIE_TYPES.runner, r), pb = typeChance(ZOMBIE_TYPES.bomber, r);
    if (x < pb) return 'bomber';
    if (x < pb + pr) return 'runner';
    return 'normal';
  }

  // Jefe al azar, distinto del último
  _nextBossKey() {
    if (this.forcedKey) { const k = this.forcedKey; this.forcedKey = null; this.lastBoss = k; return k; }
    const opts = BOSS_KEYS.filter((k) => k !== this.lastBoss);
    const k = opts[Math.floor(Math.random() * opts.length)] || BOSS_KEYS[0];
    this.lastBoss = k;
    return k;
  }

  // Modo desarrollo: hace aparecer ya un zombi del tipo indicado
  spawnSpecial(type) {
    if (!ZOMBIE_TYPES[type]) return false;
    const ok = this._spawnOne(type);
    if (ok) this._syncZLeft();
    return ok;
  }

  // Hace aparecer un jefe dentro del mapa en (x, z) a la altura y (batalla final del easter egg)
  spawnBossAt(type, x, zz, y) {
    if (!ZOMBIE_TYPES[type]) return null;
    const z = this._newZombie(x, zz, null, 'inside', y);
    this._applyType(z, type);
    const t = this._targets[0];
    if (t) z.rot = yawTo(x, zz, t.x, t.z);
    this.zombies.push(z);
    this.byId.set(z.id, z);
    this._syncZLeft();
    if (z.boss) { this._call('broadcastEvent', { e: 'boss', id: z.id, key: z.type, level: z.level }); this._syncBosses(); }
    return z;
  }

  _spawnOne(type = 'normal') {
    if (type === 'dog') return this._spawnDog();
    const gs = this.gs;
    const open = new Set(Array.isArray(gs.openZones) ? gs.openZones : [0]);
    const counts = new Array(WINDOW_INFO.length).fill(0);
    for (const z of this.zombies) if (OUTSIDE_STATES.has(z.state)) counts[z.win]++;
    let cands = WINDOW_INFO.filter((w) => open.has(w.zone) && counts[w.id] < MAX_PER_POCKET);
    if (!cands.length) return false;
    if (this.field.hasSources) {
      cands = cands
        .map((w) => ({ w, d: this.field.at(w.land[0], w.land[1], w.lv || 0) }))
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

    const z = this._newZombie(x, zz, w, 'outside');
    this._applyType(z, type);
    this.zombies.push(z);
    this.byId.set(z.id, z);
    this.spawnedThisRound = (this.spawnedThisRound || 0) + 1;
    if (z.type === 'tank') this._call('broadcastEvent', { e: 'tank', id: z.id });
    if (z.boss) { this._call('broadcastEvent', { e: 'boss', id: z.id, key: z.type, level: z.level }); this._syncBosses(); }
    return true;
  }

  // Perro: aparece con un rayo en un punto transitable a cierta distancia (de camino) de algún jugador
  _spawnDog() {
    const targets = this._targets;
    if (!targets.length || !this.field.hasSources) return false;
    for (let tries = 0; tries < 24; tries++) {
      const t = targets[Math.floor(Math.random() * targets.length)];
      const a = Math.random() * Math.PI * 2;
      const d = DOG_ROUND.minDist + Math.random() * (DOG_ROUND.maxDist - DOG_ROUND.minDist);
      const cx = Math.floor(t.x + Math.cos(a) * d), cz = Math.floor(t.z + Math.sin(a) * d);
      const lv = MAP.levelOfY(t.y || 0);
      if (!this.field.isWalkable(cx, cz, lv)) continue;
      const pd = this.field.at(cx, cz, lv);
      if (!Number.isFinite(pd) || pd < DOG_ROUND.minDist || pd > DOG_ROUND.maxDist * 1.6) continue;
      const x = cx + 0.5, zz = cz + 0.5;
      if (this.zombies.some((o) => Math.hypot(o.x - x, o.z - zz) < 1)) continue;
      const z = this._newZombie(x, zz, null, 'inside', MAP.nodeY(lv, cz * MAP.W + cx));
      z.rot = yawTo(x, zz, t.x, t.z);
      this._applyType(z, 'dog');
      this.zombies.push(z);
      this.byId.set(z.id, z);
      this.spawnedThisRound = (this.spawnedThisRound || 0) + 1;
      this._call('broadcastEvent', { e: 'dogSpawn', id: z.id, x: r2(x), z: r2(zz) });
      return true;
    }
    return false;
  }

  // Objeto zombi base (normal). state: 'outside' (en un callejón de la ventana w) o 'inside'
  _newZombie(x, zz, w, state, y) {
    const { run, sprint } = this.speedChances;
    const rnd = Math.random();
    const cls = rnd < sprint ? 'sprint' : rnd < run ? 'run' : 'walk';
    const inside = state === 'inside';
    return {
      id: this.nextId++,
      x, z: zz,
      y: w ? (w.y || 0) : (y !== undefined ? y : MAP.levels[0].y),
      rot: w ? yawTo(x, zz, w.cx, w.cz) : Math.random() * Math.PI * 2,
      hp: this.health, maxHp: this.health,
      cls,
      speed: baseSpeed(cls) * (0.92 + Math.random() * 0.16),
      crawler: false,
      state: inside ? 'inside' : 'outside',
      win: w ? w.id : 0,
      waitSpot: WAIT_SPOTS[this.nextId % WAIT_SPOTS.length],
      anim: ZA.WALK,
      flags: inside ? 0 : ZF.OUTSIDE,
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
      boss: null, level: 0,
    };
  }

  _applyType(z, type) {
    const T = ZOMBIE_TYPES[type];
    if (!T || type === 'normal') return;
    z.type = type;
    z.tcode = T.code;
    if (type === 'dog') {
      const r = this.gs.round | 0;
      const extra = Math.max(0, (this.players || 1) - 1);
      z.hp = z.maxHp = Math.round((T.hpBase + T.hpPerRound * r) * (1 + 0.15 * extra));
      z.cls = 'sprint';
      z.speed = T.speed * (0.93 + Math.random() * 0.14);
      z.dmg = T.damage;
      z.range = T.attackRange;
      z.windup = T.windup;
      z.cooldown = T.cooldown;
      z.dog = true;
    } else if (type === 'vampling') {
      z.hp = z.maxHp = Math.max(1, Math.round(this.health * T.hpMult + T.hpAdd));
      z.cls = 'sprint';
      z.speed = T.speed * (0.94 + Math.random() * 0.12);
      z.dmg = T.damage;
    } else if (type === 'runner') {
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
      const solo = (this.players || 1) <= 1 ? BALANCE.soloBossHp : 1;
      z.hp = z.maxHp = Math.round((T.hpBase + this.health * T.hpRoundMult) * (1 + T.hpPerExtraPlayer * extra) * solo);
      z.cls = 'run';
      z.speed = T.speed;
      z.dmg = T.damage;
      z.range = T.attackRange;
      z.windup = T.windup;
      z.cooldown = T.cooldown;
      z.tearMult = T.tearMult;
    } else if (T.boss) {
      const r = Math.max(BOSS_RULES.from, this.gs.round | 0);
      const lv = r - BOSS_RULES.from;
      const extra = Math.max(0, (this.players || 1) - 1);
      z.boss = type;
      z.final = !!T.final;
      z.level = r;
      const solo = (this.players || 1) <= 1 ? BALANCE.soloBossHp : 1;
      z.hp = z.maxHp = Math.round((T.hpBase + this.health * T.hpMult) * (1 + BOSS_RULES.hpPerRound * lv) * (1 + BOSS_RULES.hpPerExtraPlayer * extra) * solo);
      z.dmg = Math.round(T.damage * Math.min(BOSS_RULES.dmgMax, 1 + BOSS_RULES.dmgPerRound * lv));
      z.cls = T.speed >= 3.4 ? 'run' : 'walk';
      z.speed = z.baseSpeed = T.speed;
      z.range = T.attackRange;
      z.windup = T.windup;
      z.cooldown = T.cooldown;
      z.tearMult = T.tearMult;
      const now = this._clock();
      z.nextAbility = now + 4000 + Math.random() * 2000;    // carga / invocación / golpe al suelo
      z.nextAura = now + 1000;
      z.cloakAt = now + (T.cloak ? T.cloak.visible * 1000 : 0);
      z.cloaked = false;
    }
  }

  // (el multiplicador de daño de jefe -antes _bossDamageFactor- ahora es Zombie.bossDamageFactor,
  // en entities/zombie.js; solo lo usaba damage())

  // Estado de los jefes vivos para el HUD (gs.bosses)
  _syncBosses() {
    const gs = this.gs;
    if (!gs) return;
    gs.bosses = this.zombies.filter((z) => z.boss && !z.dead)
      .map((z) => ({ id: z.id, key: z.boss, level: z.level, hp: Math.max(0, Math.round(z.hp)), maxHp: z.maxHp }));
    this._markDirty();
  }

  // Habilidades de los jefes que funcionan en cualquier estado (camuflaje, aura, invocación)
  _bossPassive(z, dt, now) {
    const T = ZOMBIE_TYPES[z.boss];
    if (T.cloak && now >= z.cloakAt) {
      z.cloaked = !z.cloaked;
      z.cloakAt = now + (z.cloaked ? T.cloak.hidden : T.cloak.visible) * 1000;
      z.speed = z.baseSpeed * (z.cloaked ? T.cloak.speedMult : 1);
      if (z.cloaked) z.flags |= ZF.CLOAK; else z.flags &= ~ZF.CLOAK;
      this._call('broadcastEvent', { e: 'bossAbility', id: z.id, a: z.cloaked ? 'cloak' : 'uncloak', x: r2(z.x), z: r2(z.z) });
    }
    if (!INSIDE_STATES.has(z.state)) return;
    if (T.aura && now >= z.nextAura) {
      z.nextAura = now + T.aura.every * 1000;
      for (const t of this._targets) {
        if (flatDist(z, t) > T.aura.radius) continue;
        this._call('damagePlayer', t.pid, Math.round(T.aura.damage * z.dmg / T.damage), z);
        if (Math.random() < T.aura.infect) this._call('infectPlayer', t.pid);
      }
    }
    if (T.summon && now >= z.nextAbility && this._targets.length) {
      z.nextAbility = now + T.summon.every * 1000;
      const alive = this.zombies.filter((o) => o.summonedBy === z.id).length;
      const n = Math.min(T.summon.count, T.summon.maxAlive - alive, ZOMBIE.maxAlive - this.zombies.length);   // tope global: 24 a la vez
      const spots = [];
      for (let i = 0; i < n; i++) {
        this._curY = z.y || 0;
        const p = randomPointNear(this.field, z.x, z.z, T.summon.radius, ZOMBIE.radius, this._solidIn, Math.random, MAP.nodeLevel(z.x, z.z, z.y || 0));
        if (!p) continue;
        const s = this._newZombie(p.x, p.z, null, 'inside', z.y || 0);
        if (T.summon.type) this._applyType(s, T.summon.type);
        s.summoned = true;
        s.summonedBy = z.id;
        this.zombies.push(s);
        this.byId.set(s.id, s);
        spots.push([r2(p.x), r2(p.z)]);
      }
      if (spots.length) {
        this._syncZLeft();
        this._call('broadcastEvent', { e: 'bossAbility', id: z.id, a: 'summon', x: r2(z.x), z: r2(z.z), spots });
      }
    }
  }

  // Habilidades activas al perseguir (carga del Carnicero, golpe al suelo del Acorazado). true = ya actuó
  _bossActive(z, best, bd, dt, now) {
    const T = ZOMBIE_TYPES[z.boss];
    // Conde: se deshace en murciélagos y reaparece a la espalda del jugador
    if (T.bats && now >= z.nextAbility && bd >= T.bats.min && bd < 900) {
      z.mist = { until: now + T.bats.time * 1000, pid: best.pid };
      z.nextAbility = now + T.bats.every * 1000;
      z.flags |= ZF.MIST;
      z.atk = null;
      this._call('broadcastEvent', { e: 'bossAbility', id: z.id, a: 'batsOut', x: r2(z.x), y: r2(z.y || 0), z: r2(z.z) });
      return true;
    }
    // Científico: descarga eléctrica a distancia (se avisa antes) y teletransporte por el salón
    if (T.zap && !z.zap && now >= (z.nextZap || 0)) {
      const t = this._targets.find((o) => flatDist(z, o) <= T.zap.range && this._call('losBetween', z, o));
      z.nextZap = now + T.zap.every * 1000;
      if (t) {
        z.zap = { at: now + T.zap.windup * 1000, pid: t.pid };
        this._call('broadcastEvent', { e: 'bossAbility', id: z.id, a: 'zapStart', pid: t.pid, x: r2(z.x), y: r2(z.y || 0), z: r2(z.z) });
      }
    }
    if (T.blink && now >= (z.nextBlink || 0)) {
      z.nextBlink = now + T.blink.every * 1000 * (0.8 + Math.random() * 0.4);
      this._curY = z.y || 0; this._curX = z.x; this._curZ = z.z;
      const p = randomPointNear(this.field, z.x, z.z, T.blink.radius, ZOMBIE.radius, this._solidIn, Math.random, MAP.nodeLevel(z.x, z.z, z.y || 0));
      if (p) {
        const from = [r2(z.x), r2(z.z)];
        z.x = p.x; z.z = p.z;
        z.atk = null; z.stuckT = 0; z.ax = z.x; z.az = z.z;
        this._call('broadcastEvent', { e: 'bossAbility', id: z.id, a: 'blink', from, x: r2(z.x), y: r2(z.y || 0), z: r2(z.z) });
        return true;
      }
    }
    if (T.charge && now >= z.nextAbility && bd >= T.charge.min && bd <= T.charge.max
        && this._clear(z.x, z.z, best.x, best.z, ZOMBIE.radius)) {
      const dx = best.x - z.x, dz = best.z - z.z, d = Math.hypot(dx, dz) || 1;
      z.charge = { dx: dx / d, dz: dz / d, until: now + T.charge.time * 1000, hit: false };
      z.nextAbility = now + T.charge.every * 1000;
      z.flags |= ZF.CHARGE;
      z.rot = yawTo(0, 0, dx, dz);
      this._call('broadcastEvent', { e: 'bossAbility', id: z.id, a: 'charge', x: r2(z.x), z: r2(z.z) });
      return true;
    }
    if (T.slam && now >= z.nextAbility && bd <= T.slam.range) {
      z.slam = { at: now + T.slam.windup * 1000 };
      z.nextAbility = now + T.slam.every * 1000;
      z.anim = ZA.ATTACK;
      this._call('broadcastEvent', { e: 'bossAbility', id: z.id, a: 'slamStart', x: r2(z.x), z: r2(z.z) });
      return true;
    }
    return false;
  }

  _updCharge(z, dt, now) {
    const T = ZOMBIE_TYPES[z.boss];
    const c = z.charge;
    z.anim = ZA.SPRINT;
    const step = T.charge.speed * dt;
    const r = moveCircle(z.x, z.z, c.dx * step, c.dz * step, ZOMBIE.radius, this._solidIn);
    const moved = Math.hypot(r.x - z.x, r.z - z.z);
    z.x = r.x; z.z = r.z;
    if (!c.hit) {
      for (const t of this._targets) {
        if (flatDist(z, t) > 1.4) continue;
        c.hit = true;
        const res = this._call('damagePlayer', t.pid, Math.round(z.dmg * T.charge.dmgMult), z);
        const hit = res && typeof res === 'object' ? !!res.hit : !!res;
        this._call('broadcastEvent', { e: 'zatk', id: z.id, pid: t.pid, hit, blocked: !!(res && res.blocked) });
      }
    }
    // termina al acabar el tiempo, al golpear o al chocar con una pared (queda aturdido un momento)
    if (now >= c.until || c.hit || moved < step * 0.3) {
      z.charge = null;
      z.flags &= ~ZF.CHARGE;
      if (moved < step * 0.3 || c.hit) { z.state = 'stunned'; z.stunUntil = now + 900; z.knockUntil = 0; z.anim = ZA.STUN; }
    }
  }

  // Forma de murciélagos: quieto e invulnerable; al acabar reaparece a la espalda de su objetivo
  _updMist(z, now) {
    const T = ZOMBIE_TYPES[z.boss];
    z.anim = ZA.IDLE;
    if (now < z.mist.until) return;
    const t = this._targetPos(z.mist.pid) || this._targets[0];
    z.mist = null;
    z.flags &= ~ZF.MIST;
    if (t && Math.abs((t.y || 0) - (z.y || 0)) < 1.5) {
      // detrás del jugador (según hacia dónde mira), o lo más cerca posible
      const fx = -Math.sin(t.yaw || 0), fz = -Math.cos(t.yaw || 0);
      this._curY = t.y || 0; this._curX = t.x; this._curZ = t.z;
      const lv = MAP.nodeLevel(t.x, t.z, t.y || 0);
      let spot = null;
      for (const k of [1, 0.7, 0.4]) {
        const px = t.x - fx * T.bats.behind * k, pz = t.z - fz * T.bats.behind * k;
        if (this.field.isWalkable(Math.floor(px), Math.floor(pz), lv) && this._clear(t.x, t.z, px, pz, ZOMBIE.radius)) { spot = { x: px, z: pz }; break; }
      }
      if (spot) { z.x = spot.x; z.z = spot.z; z.y = MAP.groundY(spot.x, spot.z, t.y || 0); }
    }
    z.rot = t ? yawTo(z.x, z.z, t.x, t.z) : z.rot;
    z.nextAttackAt = Math.min(z.nextAttackAt, now + 250);
    z.stuckT = 0; z.ax = z.x; z.az = z.z;
    this._call('broadcastEvent', { e: 'bossAbility', id: z.id, a: 'batsIn', x: r2(z.x), y: r2(z.y || 0), z: r2(z.z) });
  }

  // Descarga eléctrica del científico: impacta si el objetivo sigue a la vista cuando acaba de cargar
  _updZap(z, now) {
    const T = ZOMBIE_TYPES[z.boss];
    if (now < z.zap.at) return;
    const t = this._targetPos(z.zap.pid);
    z.zap = null;
    let hit = false;
    if (t && flatDist(z, t) <= T.zap.range * 1.2 && this._call('losBetween', z, t)) {
      const res = this._call('damagePlayer', t.pid, Math.round(T.zap.damage * z.dmg / T.damage), z);
      hit = !!(res && (typeof res === 'object' ? res.hit : res));
    }
    this._call('broadcastEvent', { e: 'bossAbility', id: z.id, a: 'zap', pid: t ? t.pid : null, hit, x: r2(z.x), y: r2(z.y || 0), z: r2(z.z),
      tx: t ? r2(t.x) : 0, ty: t ? r2((t.y || 0) + 1.2) : 0, tz: t ? r2(t.z) : 0 });
  }

  _updSlam(z, now) {
    const T = ZOMBIE_TYPES[z.boss];
    z.anim = ZA.ATTACK;
    if (now < z.slam.at) return;
    z.slam = null;
    for (const t of this._targets) {
      const d = flatDist(z, t);
      if (d > T.slam.radius) continue;
      this._call('damagePlayer', t.pid, Math.round(z.dmg * T.slam.dmgMult * (1 - 0.4 * d / T.slam.radius)), z);
    }
    this._call('broadcastEvent', { e: 'bossAbility', id: z.id, a: 'slam', x: r2(z.x), z: r2(z.z), r: T.slam.radius });
    z.nextAttackAt = now + 600;
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

  // Línea libre para el zombi que se está moviendo (respeta escaleras; restaura su posición de referencia)
  _clear(x0, z0, x1, z1, r) {
    const cx = this._curX, cz = this._curZ;
    const ok = clearPath(x0, z0, x1, z1, r, this._solidIn, this._pathSample);
    this._curX = cx; this._curZ = cz;
    return ok;
  }

  _updateZombie(z, dt, now) {
    this._curY = z.y || 0; this._curX = z.x; this._curZ = z.z;
    this._updateZombieInner(z, dt, now);
    // pega los pies al suelo (escaleras incluidas) de los zombis que están dentro
    if (!z.dead && INSIDE_STATES.has(z.state)) z.y = MAP.groundY(z.x, z.z, z.y || 0);
  }

  _updateZombieInner(z, dt, now) {
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

    // Jefes: habilidades
    if (z.boss) {
      this._bossPassive(z, dt, now);
      if (z.dead) return;
      if (z.charge) { this._updCharge(z, dt, now); return; }
      if (z.mist) { this._updMist(z, now); return; }
      if (z.zap) this._updZap(z, now);
      if (z.slam) { this._updSlam(z, now); return; }
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
      const r = moveCircle(z.x, z.z, (dx / dist) * step, (dz / dist) * step, ZOMBIE.radius, this._solidOut);
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
        const d = Math.hypot(t.x - lx, t.z - lz) + (Math.abs((t.y || 0) - (w.y || 0)) > 1.5 ? 1000 : 0);
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
          inRange = Math.hypot(tp.x - (w.land[0] + 0.5), tp.z - (w.land[1] + 0.5)) <= WINDOW_REACH + 0.35 && Math.abs((tp.y || 0) - (w.y || 0)) < 1.5;
        } else {
          inRange = flatDist(z, tp) <= z.range + 0.35;
        }
      }
      let hit = false, blocked = false;
      if (inRange) {
        const res = this._call('damagePlayer', a.pid, z.dmg, z);
        if (res && typeof res === 'object') { hit = !!res.hit; blocked = !!res.blocked; } else hit = !!res;
        // el Conde se cura con cada mordisco
        const TB = z.boss && ZOMBIE_TYPES[z.boss];
        if (hit && TB && TB.drain) { z.hp = Math.min(z.maxHp, z.hp + z.dmg * TB.drain); this._syncBosses(); }
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
      const d = flatDist(z, t);
      if (d < bd) { bd = d; best = t; }
    }
    z.nearD = bd;
    if (z.boss && this._bossActive(z, best, bd, dt, now)) return;
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
    if (bd < DIRECT_RANGE && this._clear(z.x, z.z, best.x, best.z, ZOMBIE.radius * 0.9)) direct = true;
    if (!direct) {
      const cx = Math.floor(z.x), cz = Math.floor(z.z);
      const path = this.field.follow(cx, cz, 4, MAP.nodeLevel(z.x, z.z, z.y || 0));
      if (path.length) {
        // "Tirar de la cuerda": la celda más lejana del camino alcanzable en línea recta
        let pick = path[0];
        for (let k = path.length - 1; k >= 1; k--) {
          const p = path[k];
          if (this._clear(z.x, z.z, p[0] + 0.5, p[1] + 0.5, ZOMBIE.radius)) { pick = p; break; }
        }
        tx = pick[0] + 0.5; tz = pick[1] + 0.5;
        // Si la celda final es la del jugador, ir directamente a él
        if (this.field.at(pick[0], pick[1], pick[2]) === 0 && Math.floor(best.x) === pick[0] && Math.floor(best.z) === pick[1]) {
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
      z.wander = randomPointNear(this.field, z.x, z.z, 6, ZOMBIE.radius, this._solidIn, Math.random, MAP.nodeLevel(z.x, z.z, z.y || 0));
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
        if (Math.abs((a.y || 0) - (b.y || 0)) > 1.5) continue;   // plantas distintas
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
        if (Math.abs((p.y || 0) - (z.y || 0)) > 1.5) continue;
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
    this._curY = z.y || 0; this._curX = z.x; this._curZ = z.z;
    if (inside) {
      const r = resolveCircle(z.x + dx, z.z + dz, ZOMBIE.radius, this._solidIn);
      z.x = r[0]; z.z = r[1];
    } else {
      const r = resolveCircle(z.x + dx, z.z + dz, ZOMBIE.radius, this._solidOut);
      z.x = r[0]; z.z = r[1];
    }
  }

  // Atascos: sin progreso durante mucho tiempo o demasiado lejos de todos → vuelve a la cola
  _trackStuck(z, dt) {
    if (z.dieAt || z.state === 'climbing') return;
    if (!this._targets.length || !this.field.hasSources) { z.stuckT = 0; z.farT = 0; return; }
    let d;
    if (INSIDE_STATES.has(z.state)) {
      const lv = MAP.nodeLevel(z.x, z.z, z.y || 0);
      d = this.field.at(Math.floor(z.x), Math.floor(z.z), lv);
      if (d === Infinity) {
        const c = this.field.nearestWalkable(z.x, z.z, 1, lv);
        d = c ? this.field.at(c[0], c[1], lv) : Infinity;
      }
    } else {
      const w = WINDOW_INFO[z.win];
      d = this.field.at(w.land[0], w.land[1], w.lv || 0) + 2;
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

  _remove(z) {
    new Zombie(z, this).die();
    const i = this.zombies.indexOf(z);
    if (i >= 0) this.zombies.splice(i, 1);
    this.byId.delete(z.id);
    if (this.winOcc[z.win] === z.id) this.winOcc[z.win] = null;
    if (z.boss) this._syncBosses();
  }

  // Elimina al zombi sin contarlo como baja y lo devuelve a la cola de aparición
  _respawn(z) {
    if (z.dead) return;
    this._remove(z);
    if (z.type === 'tank') this.pendingTanks = (this.pendingTanks || 0) + 1;
    if (z.boss && !z.summoned) this.pendingBosses = (this.pendingBosses || 0) + 1;
    if (z.summoned) { this._syncZLeft(); return; }   // los invocados no vuelven a la cola
    this.queue++;
    this._syncZLeft();
  }

  _kill(z, pid, info) {
    if (z.dead) return;
    if (z.dog) this.lastDogPos = { x: z.x, z: z.z, y: z.y || 0 };
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
