// Clase Zombie (paso 2 y 7 de la refactorización, ver plan.md). Envuelve el objeto de datos que
// ZombieManager construye/recicla (misma referencia, no copia) y es dueña de TODO lo que hace UN zombi:
// recibir daño, morir, y su máquina de estados de comportamiento (update / procesar movimiento / atacar).
//
// Reparto con ZombieManager (igual que Player con Game): el manager es dueño de lo COMPARTIDO -- la
// colección, el campo de flujo (una sola malla de rutas para los hasta 24 zombis), la lista de objetivos
// del tick, las colisiones (que cambian según la planta del zombi que se mueve), las rondas, la aparición
// y la piscina de objetos -- y este archivo le pide esos recursos a través de `this.manager`. Las
// habilidades de los jefes (carga, murciélagos, descarga, golpe al suelo, invocación) siguen en el manager
// porque invocan zombis nuevos y usan el campo de flujo; aquí solo se las llama.
//
// Máquina de estados (data.state): 'outside' (callejón) -> 'tearing' (arranca tablas) -> 'climbing' ->
// 'inside'; 'attacking' y 'stunned' son sub-estados de 'inside'. Dentro, data.mode decide qué hace:
//   'wander' (merodear, no ha detectado a nadie) -> 'chase' (persecución; ya no vuelve atrás) y el ataque.
// El retroceso por impacto no es un estado: reduce la velocidad un instante (slowUntil/slowMult).

import { ZOMBIE, ZOMBIE_TYPES, angleDiff, yawTo } from '../../shared/constants.js';
import { WINDOW_INFO, DIRS, MAP } from '../../shared/map.js';
import { moveCircle } from '../../shared/collision.js';
import { ZA, ZF } from '../../shared/protocol.js';
import { randomPointNear } from '../nav.js';

export const BURN_TIME = 3;              // s de quemadura (Hades)
export const CRAWL_EDGE = 0.4;           // fracción del radio de una explosión a partir de la que se puede salvar como reptante
export const CRAWL_SAVE_CHANCE = 0.4;    // probabilidad de quedar reptante en vez de morir, en el borde de una explosión
export const CRAWL_SURVIVE_CHANCE = 0.5; // probabilidad de perder las piernas si sobrevive (con daño de explosión) sin estar en el borde
export const INSIDE_STATES = new Set(['inside', 'attacking', 'stunned']);

const BURN_DPS = 150;             // Hades: daño por segundo del fuego
const BURN_TICK = 0.25;           // s entre aplicaciones del daño por fuego
const WINDOW_REACH = 1.0;         // un zombi en la ventana golpea a quien esté a esta distancia de la celda interior
const ATTACK_RECOVER = 0.35;      // s tras el impacto antes de volver a moverse
const DIRECT_RANGE = 4;           // con línea libre y a menos de esto, va directo al jugador
const TURN_RATE = 10;             // rad/s de giro visual
const WANDER_SPEED_MULT = 0.6;    // merodeo: fracción de la velocidad de caminar

// Distancia horizontal a un objetivo; si está en otra planta cuenta como muy lejos (no se le ataca a través del suelo)
export function flatDist(z, t) {
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
function moveAnim(z) {
  if (z.crawler) return ZA.CRAWL;
  if (z.cls === 'sprint') return ZA.SPRINT;
  if (z.cls === 'run') return ZA.RUN;
  return ZA.WALK;
}

export class Zombie {
  // data    = el objeto de datos del zombi (lo crea/recicla ZombieManager; misma referencia, no copia).
  // manager = la ZombieManager dueña: le pide los recursos compartidos (objetivos, colisión, rutas, Game).
  constructor(data, manager) {
    this.data = data;
    this.manager = manager;
  }

  get id() { return this.data.id; }

  // Multiplicador de daño por armadura/camuflaje de un jefe (0 si está hecho murciélagos: invulnerable
  // a las balas mientras tanto).
  bossDamageFactor(info) {
    const z = this.data;
    const T = ZOMBIE_TYPES[z.boss];
    if (z.mist) return 0;
    let k = 1;
    if (T.armor) {
      if (info.kind === 'explosion') k = T.armor.explosion;
      else if (info.kind === 'melee' || info.kind === 'shield') k = T.armor.melee;
      else if (info.kind === 'bullet' && info.part !== 'h') k = T.armor.body;
    }
    if (T.cloak && z.cloaked) k *= T.cloak.damageTaken;
    return k;
  }

  // Se vuelve reptante: pierde las piernas, más lento.
  makeCrawler() {
    const z = this.data;
    z.crawler = true;
    z.flags |= ZF.CRAWLER;
    z.speed = ZOMBIE.crawlSpeed * (0.9 + Math.random() * 0.2);
  }

  // Retroceso por impacto: frena un instante a los zombis normales (no a jefes, tanques ni perros) sin
  // aturdirlos del todo. Golpe en las piernas frena más y más tiempo.
  _stagger(info, now) {
    const z = this.data;
    if (z.boss || z.dog || z.type === 'tank') return;
    if (info.kind !== 'bullet' && info.kind !== 'melee') return;
    const S = ZOMBIE.stagger;
    const leg = info.part === 'l';
    const until = now + (leg ? S.legTime : S.bodyTime) * 1000;
    if (until > z.slowUntil) { z.slowUntil = until; z.slowMult = leg ? S.legMult : S.bodyMult; }
  }

  // Aplica daño de una bala, una explosión o cuerpo a cuerpo. `info` es el mismo objeto que ya se
  // pasaba a ZombieManager.damage (kind/part/weapon/upgraded/instakill/special/edge...). Devuelve un
  // resumen para que ZombieManager decida qué hacer con la COLECCIÓN (sacarlo de la lista si murió,
  // sincronizar gs.bosses/zLeft, avisar a Game, hacer estallar al explosivo) -- nada de eso es cosa de
  // un zombi en particular. `now` lo pasa el llamador (mismo reloj de partida de siempre).
  takeDamage(amount, pid, info, now) {
    const z = this.data;
    if (z.dead || z.dieAt) return { existed: false, killed: false };
    const inf = info || {};
    let amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) amt = 0;
    if (inf.instakill && !z.boss) amt = Math.max(amt, z.hp);   // Muerte Instantánea no afecta a los jefes
    if (z.boss) amt *= this.bossDamageFactor(inf);
    if (inf.special === 'fire' && inf.kind !== 'fire') {
      z.burnUntil = now + BURN_TIME * 1000;
      z.burnPid = pid || null;
      z.flags |= ZF.BURNING;
    }
    if (amt <= 0) return { existed: true, killed: false };
    const canCrawl = inf.kind === 'explosion' && !z.crawler && !z.dog && z.type !== 'tank' && z.type !== 'bomber' && !z.boss
      && INSIDE_STATES.has(z.state) && !inf.instakill;
    // Como en CoD: en el borde de una explosión, un zombi que iba a morir puede quedar vivo sin piernas
    if (canCrawl && z.hp - amt <= 0 && (inf.edge || 0) >= CRAWL_EDGE && Math.random() < CRAWL_SAVE_CHANCE) {
      z.hp = Math.max(1, Math.round(z.maxHp * 0.3));
      this.makeCrawler();
      return { existed: true, killed: false, becameCrawler: true };
    }
    z.hp -= amt;
    const appliedDamage = true; // llegó hasta acá: sí hubo daño real (a diferencia de amt<=0 arriba)
    if (z.hp <= 0) return { existed: true, killed: true, amt, appliedDamage };
    z.mode = 'chase';           // un zombi herido ya sabe dónde está el jugador
    this._stagger(inf, now);
    // Con daño de explosión que no fue letal, puede perder las piernas de todos modos (no solo "en el borde")
    if (canCrawl && Math.random() < CRAWL_SURVIVE_CHANCE) {
      this.makeCrawler();
      return { existed: true, killed: false, becameCrawler: true, appliedDamage };
    }
    return { existed: true, killed: false, appliedDamage };
  }

  // Marca como muerto. Sacarlo de las listas/colección (this.zombies/this.byId/winOcc/gs.bosses) sigue
  // siendo cosa de ZombieManager, que es quien las tiene.
  die() { this.data.dead = true; }

  // Velocidad efectiva ahora mismo (incluye el retroceso por impacto)
  speedNow(now) {
    const z = this.data;
    return now < z.slowUntil ? z.speed * z.slowMult : z.speed;
  }

  // ================================================================== update (máquina de estados)

  // Un tick de comportamiento. Devuelve sin hacer nada si el zombi murió en este mismo tick.
  update(dt, now) {
    const z = this.data, m = this.manager;
    // Muerte programada por la bomba nuclear
    if (z.dieAt) {
      if (now >= z.dieAt) m._kill(z, null, { kind: 'nuke', part: 'b' });
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
        const pid = z.burnPid && m.gs.players && m.gs.players[z.burnPid] ? z.burnPid : null;
        m.damage(z.id, amount, pid, { kind: 'fire', part: 'b', special: null });
        if (z.dead) return;
      }
    } else if (z.flags & ZF.BURNING) {
      z.flags &= ~ZF.BURNING;
      z.burnAcc = 0;
    }

    // Jefes: habilidades (siguen en el manager: invocan zombis y usan el campo de flujo)
    if (z.boss) {
      m._bossPassive(z, dt, now);
      if (z.dead) return;
      if (z.charge) { m._updCharge(z, dt, now); return; }
      if (z.mist) { m._updMist(z, now); return; }
      if (z.zap) m._updZap(z, now);
      if (z.slam) { m._updSlam(z, now); return; }
    }
    // Explosivo con la mecha encendida: tiembla quieto y estalla
    if (z.fuseAt) {
      z.anim = ZA.STUN;
      z.atk = null;
      if (now >= z.fuseAt) m._kill(z, null, { kind: 'selfdestruct', part: 'b' });
      return;
    }

    switch (z.state) {
      case 'outside': this._updOutside(dt, now); break;
      case 'tearing': this._updTearing(dt, now); break;
      case 'climbing': this._updClimbing(dt, now); break;
      case 'attacking': this._updAttack(dt, now); break;
      case 'stunned': this._updStunned(dt, now); break;
      default: this._updInside(dt, now); break;
    }
  }

  // ================================================================== movimiento

  // "Procesar movimiento": da un paso hacia (tx, tz) a `speed` m/s con colisión y giro visual. Devuelve la
  // distancia que quedaba antes del paso.
  moveToward(tx, tz, dt, speed, solid) {
    const z = this.data;
    const dx = tx - z.x, dz = tz - z.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-3) {
      const step = Math.min(dist, speed * dt);
      const r = moveCircle(z.x, z.z, (dx / dist) * step, (dz / dist) * step, ZOMBIE.radius, solid);
      z.x = r.x; z.z = r.z;
      turnTowards(z, yawTo(0, 0, dx, dz), dt);
    }
    return dist;
  }

  // ================================================================== estados

  // En el callejón: caminar hasta la celda de arranque o esperar turno
  _updOutside(dt, now) {
    const z = this.data, m = this.manager;
    const w = WINDOW_INFO[z.win];
    const occ = m.winOcc[z.win];
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
      m.winOcc[z.win] = z.id;
      z.x = tx; z.z = tz;
      z.rot = yawTo(z.x, z.z, w.cx, w.cz);
      z.tearAcc = 0;
      z.state = (m.gs.windows[z.win] | 0) > 0 ? 'tearing' : 'climbing';
      z.climbT = 0;
      z.anim = z.state === 'tearing' ? ZA.TEAR : ZA.CLIMB;
      return;
    }
    if (dist > 0.12) {
      this.moveToward(tx, tz, dt, this.speedNow(now), m._solidOut);
      z.anim = moveAnim(z);
    } else {
      turnTowards(z, yawTo(z.x, z.z, w.cx, w.cz), dt);
      z.anim = z.crawler ? ZA.CRAWL : ZA.IDLE;
    }
  }

  // Arrancando tablas (y golpeando a través de la ventana si hay alguien pegado)
  _updTearing(dt, now) {
    const z = this.data, m = this.manager;
    const w = WINDOW_INFO[z.win];
    z.x = w.tear[0] + 0.5; z.z = w.tear[1] + 0.5;
    z.rot = yawTo(z.x, z.z, w.cx, w.cz);
    if (z.atk) { this._updAttack(dt, now); return; }
    const boards = m.gs.windows[z.win] | 0;
    if (boards <= 0) {
      z.state = 'climbing';
      z.climbT = 0;
      z.anim = ZA.CLIMB;
      return;
    }
    if (now >= z.nextAttackAt) {
      const lx = w.land[0] + 0.5, lz = w.land[1] + 0.5;
      let victim = null, vd = WINDOW_REACH;
      for (const t of m._targets) {
        const d = Math.hypot(t.x - lx, t.z - lz) + (Math.abs((t.y || 0) - (w.y || 0)) > 1.5 ? 1000 : 0);
        if (d <= vd) { vd = d; victim = t; }
      }
      if (victim) { this.startAttack(victim.pid, now, true); return; }
    }
    z.anim = ZA.TEAR;
    z.tearAcc += dt;
    const tearTime = ZOMBIE.tearTime * (z.tearMult || 1);
    if (z.tearAcc >= tearTime) {
      z.tearAcc -= tearTime;
      m._call('setBoards', z.win, Math.max(0, boards - 1), null);
    }
  }

  // Cruzando la ventana: tear → ventana → land
  _updClimbing(dt, now) {
    const z = this.data, m = this.manager;
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
      if (m.winOcc[z.win] === z.id) m.winOcc[z.win] = null;
      z.state = 'inside';
      z.flags &= ~ZF.OUTSIDE;
      z.x = cx; z.z = cz;
      z.stuckT = 0; z.bestDist = Infinity; z.ax = z.x; z.az = z.z; z.farT = 0;
      z.navUntil = 0;
      if (z.mode === 'wander') z.idleUntil = now + this._idleTime();   // el merodeo empieza al entrar
      z.anim = moveAnim(z);
    }
  }

  // ================================================================== atacar

  startAttack(pid, now, through) {
    const z = this.data;
    z.atk = { pid, t: 0, hit: false, through: !!through, start: now };
    z.anim = ZA.ATTACK;
    if (!through) z.state = 'attacking';
  }

  _updAttack(dt, now) {
    const z = this.data, m = this.manager;
    const a = z.atk;
    if (!a) { z.state = 'inside'; z.navUntil = 0; return; }
    a.t += dt;
    z.anim = ZA.ATTACK;
    const tp = m._targetPos(a.pid);
    if (tp && !a.through) {
      turnTowards(z, yawTo(z.x, z.z, tp.x, tp.z), dt);
      // se arrima un poco al objetivo mientras golpea
      const dx = tp.x - z.x, dz = tp.z - z.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.75) {
        const step = Math.min(d - 0.75, z.speed * 0.2 * dt);
        const r = moveCircle(z.x, z.z, (dx / d) * step, (dz / d) * step, ZOMBIE.radius, m._solidIn);
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
        const res = m._call('damagePlayer', a.pid, z.dmg, z);
        if (res && typeof res === 'object') { hit = !!res.hit; blocked = !!res.blocked; } else hit = !!res;
        // el Conde se cura con cada mordisco
        const TB = z.boss && ZOMBIE_TYPES[z.boss];
        if (hit && TB && TB.drain) { z.hp = Math.min(z.maxHp, z.hp + z.dmg * TB.drain); m._syncBosses(); }
      }
      m._call('broadcastEvent', { e: 'zatk', id: z.id, pid: a.pid, hit, blocked });
    }
    if (a.t >= z.windup + ATTACK_RECOVER) {
      z.atk = null;
      z.nextAttackAt = a.start + z.cooldown * 1000;
      if (z.state === 'attacking') { z.state = 'inside'; z.navUntil = 0; }
    }
  }

  // Aturdido (empujón del escudo o choque de carga): sale despedido un instante y no hace nada más
  _updStunned(dt, now) {
    const z = this.data, m = this.manager;
    z.anim = ZA.STUN;
    if (now < z.knockUntil) {
      const r = moveCircle(z.x, z.z, z.kvx * dt, z.kvz * dt, ZOMBIE.radius, m._solidIn);
      z.x = r.x; z.z = r.z;
    }
    if (now >= z.stunUntil) {
      z.state = 'inside';
      z.navUntil = 0;
      z.anim = moveAnim(z);
    }
  }

  // ================================================================== dentro: merodear / perseguir

  _idleTime() {
    const A = ZOMBIE.aggro;
    return (A.idleMin + Math.random() * (A.idleMax - A.idleMin)) * 1000;
  }

  // ¿Detecta a alguien? (vista, ruido, o se le acabó el tiempo de merodeo). Si sí, pasa a perseguir para siempre.
  _detects(best, bd, now) {
    const z = this.data, m = this.manager;
    const A = ZOMBIE.aggro;
    let seen = bd <= A.vision;
    if (!seen && now >= z.idleUntil) seen = true;
    if (!seen) {
      const ns = m.noises;
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i];
        if (Math.abs((n.y || 0) - (z.y || 0)) > 1.5) continue;
        if (Math.hypot(n.x - z.x, n.z - z.z) <= n.r) { seen = true; break; }
      }
    }
    if (seen) z.mode = 'chase';
    return seen;
  }

  _updInside(dt, now) {
    const z = this.data, m = this.manager;
    const targets = m._targets;
    if (!targets.length) { this._wander(dt, now); return; }
    z.wander = null;
    let best = null, bd = Infinity;
    for (const t of targets) {
      const d = flatDist(z, t);
      if (d < bd) { bd = d; best = t; }
    }
    z.nearD = bd;
    // Merodeando: no ha detectado a nadie todavía
    if (z.mode === 'wander' && !this._detects(best, bd, now)) { this._wander(dt, now); return; }
    if (z.boss && m._bossActive(z, best, bd, dt, now)) return;
    // Explosivo: al acercarse enciende la mecha
    if (z.type === 'bomber' && bd <= ZOMBIE_TYPES.bomber.trigger && !z.crawler) {
      z.fuseAt = now + ZOMBIE_TYPES.bomber.fuse * 1000;
      z.flags |= ZF.FUSE;
      z.anim = ZA.STUN;
      m._call('broadcastEvent', { e: 'fuse', id: z.id });
      return;
    }
    if (bd <= z.range && now >= z.nextAttackAt) {
      this.startAttack(best.pid, now, false);
      return;
    }
    // Ya está pegado al jugador esperando el siguiente golpe
    if (bd <= z.range * 0.8) {
      turnTowards(z, yawTo(z.x, z.z, best.x, best.z), dt);
      z.anim = z.crawler ? ZA.CRAWL : ZA.IDLE;
      return;
    }
    this._steer(best, bd, dt, now);
    z.anim = moveAnim(z);
  }

  // Ruta hacia el objetivo con IA diferida: la elección de a dónde ir (línea directa / "tirar de la cuerda"
  // por el campo de flujo: rayos y búsqueda de camino) se rehace cada ZOMBIE.aiInterval s (con algo de azar
  // por zombi para repartir la carga entre ticks); el paso de movimiento se da todos los ticks hacia lo
  // último decidido, y el cliente interpola entre snapshots.
  _steer(best, bd, dt, now) {
    const z = this.data;
    if (now >= z.navUntil) this._plan(best, bd, now);
    const tx = z.navToPlayer ? best.x : z.navX;
    const tz = z.navToPlayer ? best.z : z.navZ;
    const dist = this.moveToward(tx, tz, dt, this.speedNow(now), this.manager._solidIn);
    if (!z.navToPlayer && dist < 0.3) z.navUntil = 0;     // llegó al punto intermedio: rehacer ya
  }

  _plan(best, bd, now) {
    const z = this.data, m = this.manager;
    z.navUntil = now + ZOMBIE.aiInterval * 1000 * (0.8 + Math.random() * 0.4);
    if (bd < DIRECT_RANGE && m._clear(z.x, z.z, best.x, best.z, ZOMBIE.radius * 0.9)) { z.navToPlayer = true; return; }
    z.navToPlayer = false;
    const cx = Math.floor(z.x), cz = Math.floor(z.z);
    const path = m.field.follow(cx, cz, 4, MAP.nodeLevel(z.x, z.z, z.y || 0));
    if (!path.length) { z.navToPlayer = true; return; }
    // "Tirar de la cuerda": la celda más lejana del camino alcanzable en línea recta
    let pick = path[0];
    for (let k = path.length - 1; k >= 1; k--) {
      const p = path[k];
      if (m._clear(z.x, z.z, p[0] + 0.5, p[1] + 0.5, ZOMBIE.radius)) { pick = p; break; }
    }
    z.navX = pick[0] + 0.5; z.navZ = pick[1] + 0.5;
    // Si la celda final es la del jugador, ir directamente a él
    if (m.field.at(pick[0], pick[1], pick[2]) === 0 && Math.floor(best.x) === pick[0] && Math.floor(best.z) === pick[1]) z.navToPlayer = true;
  }

  // Merodear: puntos al azar cercanos, despacio (también cuando no queda ningún objetivo)
  _wander(dt, now) {
    const z = this.data, m = this.manager;
    if (!m._targets.length) z.nearD = Infinity;
    if (!z.wander || now > z.wanderUntil) {
      z.wander = randomPointNear(m.field, z.x, z.z, 6, ZOMBIE.radius, m._solidIn, Math.random, MAP.nodeLevel(z.x, z.z, z.y || 0));
      z.wanderUntil = now + 4000 + Math.random() * 4000;
      if (!z.wander) { z.anim = z.crawler ? ZA.CRAWL : ZA.IDLE; return; }
    }
    const dist = Math.hypot(z.wander.x - z.x, z.wander.z - z.z);
    if (dist < 0.3) {
      z.anim = z.crawler ? ZA.CRAWL : ZA.IDLE;
      return;
    }
    const speed = z.crawler ? ZOMBIE.crawlSpeed * 0.8 : ZOMBIE.walkSpeed * WANDER_SPEED_MULT;
    this.moveToward(z.wander.x, z.wander.z, dt, speed, m._solidIn);
    z.anim = z.crawler ? ZA.CRAWL : ZA.WALK;
  }
}

export default Zombie;
