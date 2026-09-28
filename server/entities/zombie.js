// Clase Zombie: paso 1 de su refactorización (ver plan.md). Envuelve el mismo objeto de datos que
// ZombieManager ya construye en _newZombie (misma referencia, no copia) y expone como métodos reales
// las dos acciones más autocontenidas: recibir daño (takeDamage) y morir (die).
//
// El resto de lo que pidió el usuario para esta clase -- update/procesarMovimiento y atacar -- se deja
// para un paso aparte a propósito: esa lógica (server/zombies.js, _updOutside/_updTearing/_updClimbing/
// _updInside/_updAttack y las habilidades de los jefes) depende de recursos que son del MANAGER, no de
// un zombi en particular -- el campo de flujo (una sola malla de pathfinding para los hasta 24 zombis a
// la vez, no una por zombi), la lista de objetivos del tick actual, y las funciones de colisión que
// cambian según la planta que se esté evaluando en ese instante. Migrar bien esa parte (con una
// referencia a `manager` para pedirle esos recursos compartidos) es un paso aparte con su propia
// verificación, igual que la autoridad de movimiento quedó aparte en la clase Player.
//
// Como con Player: quien llama (ZombieManager) sigue siendo el único que toca la COLECCIÓN de zombis
// (sacar de la lista, sincronizar gs.bosses/zLeft, avisar a Game) -- esta clase solo muta sus propios
// datos y devuelve un resumen de lo que pasó.

import { ZOMBIE, ZOMBIE_TYPES } from '../../shared/constants.js';
import { ZF } from '../../shared/protocol.js';

// Únicos, importados también por zombies.js (antes vivían duplicados como constantes sueltas ahí).
export const BURN_TIME = 3;              // s de quemadura (Hades)
export const CRAWL_EDGE = 0.4;           // fracción del radio de una explosión a partir de la que se puede salvar como reptante
export const CRAWL_SAVE_CHANCE = 0.4;    // probabilidad de quedar reptante en vez de morir, en el borde de una explosión
export const CRAWL_SURVIVE_CHANCE = 0.5; // probabilidad de perder las piernas si sobrevive (con daño de explosión) sin estar en el borde
export const INSIDE_STATES = new Set(['inside', 'attacking', 'stunned']);

export class Zombie {
  // data    = el mismo objeto que ZombieManager._newZombie construye (misma referencia, no copia).
  // manager = la ZombieManager dueña; todavía sin usar en este paso, guardada para cuando se migren
  //           movimiento/ataque (así no hace falta volver a tocar cada sitio donde se crea un Zombie).
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
}

export default Zombie;
