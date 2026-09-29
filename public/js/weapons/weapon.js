// Clase Weapon: paso 3 de la refactorización a clases (ver plan.md). Jerarquía real, como pidió el
// usuario -- Weapon como base, y cada arma concreta se instancia como una de sus subclases según su
// tipo (hitscan/proyectil/cuerpo a cuerpo) -- en vez de una tabla plana de datos por un lado y toda la
// lógica de disparo/recarga suelta en WeaponSystem por el otro.
//
// Alcance de este paso (igual criterio que Player/Zombie: lo autocontenido primero): esta clase es el
// ESTADO Y LAS REGLAS de un arma concreta en la mano de un jugador -- munición, recarga, si puede
// disparar ahora mismo. NO sabe nada de red, del mundo 3D, del jugador ni del teclado: eso lo sigue
// orquestando WeaponSystem (SPEC 6.10), que decide CUÁNDO llamar a estos métodos según el input y el
// modo de disparo (semi/auto/ráfaga/bombeo/cerrojo), y es quien de verdad traza la bala o lanza el
// proyectil contra el mundo. Exactamente el mismo reparto que Player (reglas) / Game (red) o Zombie
// (reglas) / ZombieManager (colección y mundo).
//
// Nota sobre "model"/"texture" del enunciado: este juego no usa archivos de modelo/textura (todo es
// procedural, ver SPEC.md y weapons/models.js) -- `model` guarda el arquetipo procedural (p. ej.
// 'raygun', 'shotgun') que createWeaponMesh() usa para construir la geometría; `texture` queda en null
// a propósito, documentado, en vez de simular una ruta de archivo que no existiría de verdad.

import { WEAPONS, weaponDef, fireInterval, falloff } from '/shared/weapons.js';
import { clamp } from '/shared/constants.js';

// Estilo de recarga por arquetipo de modelo (antes vivía como función suelta en weaponSystem.js)
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
// Momento de la recarga (0..1) en que la munición pasa al cargador (si se cancela después, se conserva)
const RELOAD_COMMIT = { mag: 0.62, pistol: 0.6, raygun: 0.6, lmg: 0.66, bolt: 0.6, revolver: 0.56, break: 0.52, launcher: 0.6 };

export class Weapon {
  // key/up: identifican el arma y si está mejorada por Pack-a-Punch (mismo par que usa todo el resto
  // del proyecto: shared/weapons.js, el servidor, la red...). No copia def entero: lo vuelve a pedir
  // a weaponDef() cada vez (es barato, está cacheado) para no quedar desactualizada si cambiara.
  constructor(key, up = false) {
    this.key = key;                 // metadata: id
    this.up = !!up;
    const def = this.def;
    this.name = def.name;           // metadata: name
    this.model = def.model;         // metadata: "model" (arquetipo procedural, ver nota arriba)
    this.texture = null;            // metadata: "texture" (no aplica: todo procedural, ver nota arriba)
    this.type = 'hitscan';          // lo fija cada subclase (hitscan/proyectil/cuerpo a cuerpo)

    // stats (de solo lectura en la práctica: si hace falta un valor distinto, se pide otra instancia)
    this.maxDamage = def.dmg;       // daño a boca de cañón; ver effectiveDamage() para la caída con la distancia
    this.range = def.range || 0;
    this.dispersion = def.spreadHip || 0;
    this.birdShot = def.pellets || 1;         // perdigones (escopetas)
    this.reloadTime = def.reload || 0;
    this.magazineCapacity = def.mag || 0;

    // estado (esto sí cambia mientras la instancia vive)
    this.currentBullets = def.mag || 0;
    this.reserveBullets = def.reserve || 0;
    this.lastShotTime = -Infinity;
    this._reload = null;      // ciclo de recarga en curso (null = no está recargando)
    this._autoReloadAt = -1;  // "timeToStartReload": instante programado para un autorecargado (-1 = ninguno)
  }

  // Definición efectiva de shared/weapons.js (con Pack-a-Punch aplicado si up=true)
  get def() { return weaponDef(this.key, this.up) || WEAPONS[this.key]; }

  get damage() { return this.maxDamage; }             // alias: "damage" tal como lo pidió el enunciado
  get timeToStartReload() { return this._autoReloadAt; }

  // Máquina de estados que pidió el enunciado, calculada (no puede quedar desincronizada)
  get state() {
    if (this._reload) return 'reloading';
    if (this.currentBullets <= 0) return 'empty';
    return 'ready';
  }

  // 'full' (cargador de una vez) o 'shell' (cartucho a cartucho, bombeo) según el ciclo en curso; null si no recarga
  get reloadKind() { return this._reload ? this._reload.kind : null; }

  // Daño real a una distancia dada (la caída con la distancia es la misma fórmula que usa el servidor)
  effectiveDamage(dist) { return this.maxDamage * falloff(this.def, dist); }

  fireIntervalSeconds(doubleTap) { return fireInterval(this.def, !!doubleTap); }

  // Recarga completa (cargador de una vez): la mayoría de las armas.
  _startFullReload(speedColaMult) {
    const def = this.def;
    const style = reloadStyle(def);
    this._reload = {
      kind: 'full', style, t: 0, dur: Math.max(0.2, def.reload * speedColaMult),
      wasEmpty: this.currentBullets === 0, committed: false,
      commitAt: RELOAD_COMMIT[style] || 0.62, sfx: RELOAD_SFX[style] || RELOAD_SFX.mag, si: 0,
    };
  }

  // Recarga cartucho a cartucho (escopetas de bombeo): puede cortarse en cualquier momento sin perder
  // los cartuchos ya cargados.
  _startShellReload(speedColaMult) {
    const def = this.def;
    const per = clamp((def.reload - 0.6) / Math.max(1, def.mag), 0.22, 0.6) * speedColaMult;
    this._reload = {
      kind: 'shell', phase: 'in', t: 0, tilt: 0, shell: 0, pump: -1, pumpSnd: false, per,
      inDur: 0.28 * speedColaMult, outDur: 0.25 * speedColaMult, pumpDur: 0.5 * speedColaMult,
      wasEmpty: this.currentBullets === 0, added: false,
    };
  }

  // "recarga": intenta EMPEZAR una recarga. speedColaMult: 0.5 con Speed Cola, 1 sin ella (la ventaja
  // es del jugador, no del arma, así que la pasa quien llama). No hace nada si ya está recargando, si
  // el cargador ya está lleno o si no queda munición de reserva.
  reload(speedColaMult = 1) {
    if (this._reload) return false;
    if (this.currentBullets >= this.magazineCapacity || this.reserveBullets <= 0) return false;
    this._autoReloadAt = -1;
    if (reloadStyle(this.def) === 'shell') this._startShellReload(speedColaMult);
    else this._startFullReload(speedColaMult);
    return true;
  }

  cancelReload() { this._reload = null; }

  // Programa un autorecargado dentro de `delay` segundos si hay munición de reserva (p. ej. al vaciar
  // el cargador, o al cambiar de arma). `now` es el reloj de WeaponSystem (ctx.weapons.time).
  scheduleAutoReload(now, delay) {
    if (this.currentBullets === 0 && this.reserveBullets > 0) this._autoReloadAt = now + Math.max(0, delay);
  }
  cancelAutoReload() { this._autoReloadAt = -1; }

  // "procesar recarga": avanza el ciclo de recarga en curso `dt` segundos. Devuelve una lista de
  // efectos para que WeaponSystem los reproduzca (sonidos) -- esta clase no sabe nada de audio.
  // Llamado desde update(), no hace falta llamarlo aparte.
  processReload(dt) {
    const r = this._reload;
    if (!r) return [];
    const fx = [];
    if (r.kind === 'full') {
      r.t += dt;
      const p = r.t / r.dur;
      while (r.si < r.sfx.length && p >= r.sfx[r.si][0]) {
        const s = r.sfx[r.si++];
        if (!s[2] || r.wasEmpty) fx.push({ sound: s[1], opts: { volume: 0.85 } });
      }
      if (!r.committed && p >= r.commitAt) {
        r.committed = true;
        const take = Math.min(this.magazineCapacity - this.currentBullets, this.reserveBullets);
        if (take > 0) { this.currentBullets += take; this.reserveBullets -= take; }
      }
      if (r.t >= r.dur) this._reload = null;
      return fx;
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
        if (this.currentBullets < this.magazineCapacity && this.reserveBullets > 0) {
          this.currentBullets++;
          this.reserveBullets--;
          fx.push({ sound: 'reload_in', opts: { volume: 0.8, rate: 0.95 + Math.random() * 0.1 } });
        }
      }
      if (r.t >= r.per) {
        if (this.currentBullets < this.magazineCapacity && this.reserveBullets > 0) { r.t = 0; r.shell = 0; r.added = false; }
        else { r.phase = 'out'; r.t = 0; r.shell = 0; r.pump = r.wasEmpty ? 0 : -1; r.pumpSnd = false; }
      }
    } else {
      r.t += dt;
      r.tilt = Math.max(0, 1 - r.t / r.outDur);
      let total = r.outDur;
      if (r.pump >= 0) {
        total = Math.max(r.outDur, r.pumpDur);
        r.pump = Math.min(1, r.t / r.pumpDur);
        if (!r.pumpSnd && r.pump >= 0.3) { r.pumpSnd = true; fx.push({ sound: 'pump', opts: { volume: 0.9 } }); }
      }
      if (r.t >= total) this._reload = null;
    }
    return fx;
  }

  // Estado de la recarga en curso, en la forma que espera ViewModel (o null si no hay ninguna).
  reloadAnimState() {
    const r = this._reload;
    if (!r) return null;
    if (r.kind === 'shell') return { style: 'shell', tilt: r.tilt, shell: r.phase === 'load' ? r.shell : 0, pump: r.phase === 'out' ? r.pump : -1 };
    return { style: r.style, p: r.t / r.dur, wasEmpty: r.wasEmpty };
  }

  // Avanza el estado del arma dt segundos (recarga en curso). Devuelve los mismos efectos que
  // processReload(); quien llama (WeaponSystem) los reproduce.
  update(dt) { return this.processReload(dt); }

  // "intentar disparo": un único intento de disparo, ahora mismo. No decide CUÁNDO disparar (eso es
  // del modo de disparo semi/auto/ráfaga y del input -- sigue en WeaponSystem, que llama a esto una
  // vez por cada bala que de verdad sale); solo decide si ESTE intento puntual es válido y, si lo es,
  // consume la munición. No traza la bala ni toca el mundo: eso también lo hace WeaponSystem con el
  // resultado.
  tryFire(now) {
    if (this._reload) return { fired: false, reason: 'reloading' };
    if (this.currentBullets <= 0) return { fired: false, reason: 'empty' };
    this.currentBullets--;
    this.lastShotTime = now;
    return { fired: true };
  }

  // Vuelve a llenar el cargador y/o la reserva al máximo (arma nueva, Max Ammo, munición comprada...).
  refill({ mag = true, reserve = true } = {}) {
    const def = this.def;
    if (mag) this.currentBullets = def.mag;
    if (reserve) this.reserveBullets = def.reserve;
  }
}

// -------------------------------------------------------------------------------------------------
// Subclases por tipo (metadata.type del enunciado). El comportamiento de disparo en sí (trazar la
// bala vs. lanzar un proyectil simulado) lo sigue resolviendo WeaponSystem contra el mundo real
// (necesita el mapa, los objetivos, la red...); estas subclases dejan el tipo declarado y con sitio
// para diferenciarse más adelante sin tocar la base.
export class HitscanWeapon extends Weapon {
  constructor(key, up) { super(key, up); this.type = 'hitscan'; }
}

export class ProjectileWeapon extends Weapon {
  constructor(key, up) {
    super(key, up);
    this.type = 'projectile';
    this.projectile = this.def.projectile || null;   // { speed, gravity, splash, splashDmg, direct, color, size }
  }
}

// Cuerpo a cuerpo (cuchillo/Bowie/bate/machete/hacha): sin cargador ni recarga. El golpe en sí sigue
// resolviéndose aparte en WeaponSystem (_tryKnife/_knifeHit), con sus propios tiempos de animación
// (shared/weapons.js: meleeStats) -- no comparte ni cargador ni munición con las de fuego, así que no
// tendría sentido forzarlas por el mismo ammo/reload de arriba. Se deja la clase para completar la
// jerarquía que pidió el usuario; conectarla a _tryKnife/_knifeHit queda para un paso aparte.
export class MeleeWeapon extends Weapon {
  constructor(key, up) {
    super(key, up);
    this.type = 'melee';
    this.magazineCapacity = 0;
    this.currentBullets = 0;
    this.reserveBullets = 0;
  }
  get state() { return 'ready'; }
  reload() { return false; }
  tryFire(now) { this.lastShotTime = now; return { fired: true }; }
}

// Construye la instancia de la subclase que corresponde según el tipo de arma (metadata.type).
export function createWeapon(key, up = false) {
  const def = weaponDef(key, up) || WEAPONS[key];
  if (!def) return null;
  if (def.melee) return new MeleeWeapon(key, up);
  if (def.projectile) return new ProjectileWeapon(key, up);
  return new HitscanWeapon(key, up);
}

export default Weapon;
