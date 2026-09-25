// Constantes de juego compartidas entre servidor (Node) y cliente (navegador).
// Unidades: metros, segundos, puntos. Los tiempos absolutos del servidor van en milisegundos.

export const GAME_TITLE = 'ZOMBIES LAN';
export const DEFAULT_PORT = 3000;
export const MAX_PLAYERS = 4;

// Red
export const TICK_RATE = 20;            // simulación del servidor (Hz)
export const SNAPSHOT_RATE = 20;        // snapshots de posiciones (Hz)
export const GS_MAX_RATE = 10;          // máximo de envíos de estado de juego por segundo
export const CLIENT_SEND_RATE = 20;     // envío del estado del jugador local (Hz)
export const INTERP_DELAY_MS = 100;     // retardo de interpolación en el cliente

// Jugador
export const PLAYER = {
  radius: 0.35,
  height: 1.75,
  eyeHeight: 1.62,
  crouchEyeHeight: 1.1,
  downEyeHeight: 0.55,
  walkSpeed: 4.6,
  sprintSpeed: 6.6,
  crouchSpeed: 2.4,
  downSpeed: 0.9,           // arrastrándose en "última batalla"
  adsSpeedMult: 0.6,
  jumpVelocity: 4.8,
  gravity: 14,
  sprintDuration: 4.0,      // segundos de sprint continuo (Stamin-Up lo duplica)
  sprintRecover: 2.0,       // segundos para recuperar el sprint completo
  health: 100,
  jugHealth: 250,
  regenDelay: 2.5,          // segundos sin daño antes de regenerar
  regenRate: 100,           // puntos de salud por segundo
  regenCap: 0.6,            // la regeneración natural solo llega hasta este % de la salud máxima (el resto, con curas)
  startBandages: 1,         // vendas al aparecer
  startPoints: 500,
  startGrenades: 2,
  maxGrenades: 4,
  grenadesPerRound: 2,
  startWeapon: 'm1911',
  maxWeapons: 2,
  muleKickWeapons: 3,
  bleedoutTime: 45,         // segundos antes de desangrarse
  reviveTime: 4.0,          // Quick Revive lo reduce a la mitad
  soloQuickReviveTime: 10,  // auto-reanimación en solitario
  soloQuickReviveUses: 3,
  downPointsLoss: 0.05,     // se pierde el 5% de los puntos al caer
  interactRange: 1.8,       // alcance para interactuar (m)
  reviveRange: 1.8,
};

// Zombis
export const ZOMBIE = {
  radius: 0.35,
  maxAlive: 24,
  attackRange: 1.15,
  attackWindup: 0.45,       // segundos entre el inicio del golpe y el impacto
  attackCooldown: 1.3,
  damage: 25,               // 4 golpes sin Juggernog, 10 con Juggernog
  walkSpeed: 1.35,
  runSpeed: 3.6,
  sprintSpeed: 5.0,
  crawlSpeed: 0.8,
  tearTime: 1.0,            // segundos por tabla arrancada
  climbTime: 1.2,           // segundos para cruzar la ventana
  riseTime: 1.5,
  firstSpawnDelay: 2.0,     // segundos entre apariciones en la ronda 1
  spawnDelayDecay: 0.95,    // multiplicador por ronda
  minSpawnDelay: 0.15,
  stuckRespawnTime: 25,     // si no avanza en este tiempo, reaparece
};

// Tipos especiales de zombi (además de los normales). code = valor en el snapshot.
// Probabilidad de que un zombi de la ronda sea de ese tipo: min(max, base + perRound·(ronda − from)) a partir de 'from'.
export const ZOMBIE_TYPES = {
  normal: { code: 0, name: 'Zombi' },
  runner: {
    code: 1, name: 'Corredor', from: 3, base: 0.06, perRound: 0.02, max: 0.3,
    hpMult: 0.6, speed: 5.7, damage: 20, scale: 0.95,
  },
  bomber: {
    code: 2, name: 'Explosivo', from: 5, base: 0.04, perRound: 0.012, max: 0.15,
    hpMult: 0.8, speed: 1.55, damage: 25, scale: 1,
    trigger: 1.7,          // m: a esta distancia de un jugador enciende la mecha
    fuse: 1.2,             // s de mecha antes de estallar
    radius: 3.6,           // radio de la explosión (al morir o al estallar)
    playerDamage: 55,      // daño máximo a los jugadores (baja con la distancia)
    zombieDamage: 1500,    // daño a otros zombis en el radio
  },
  tank: {
    code: 3, name: 'Tanque', from: 8, chance: 0.4, perRound: 0.06,   // probabilidad de que la ronda traiga un tanque
    hpBase: 3000, hpRoundMult: 12, hpPerExtraPlayer: 0.5,           // vida = (hpBase + vida normal · hpRoundMult) · (1 + 0.5 por jugador extra)
    speed: 4.0, damage: 60, attackRange: 1.8, windup: 0.6, cooldown: 1.8, tearMult: 0.25, scale: 1.5,
    points: 500,           // puntos extra al que lo mata (y deja siempre un potenciador)
    twoFrom: 16,           // desde esta ronda pueden venir dos tanques
  },
};
// Jefes: uno por ronda desde BOSS_RULES.from (dos desde twoFrom), elegidos al azar sin repetir el anterior.
// Vida = (hpBase + vida normal · hpMult) · (1 + hpPerRound·(ronda − from)) · (1 + 0.5 por jugador extra)
// Daño = damage · min(dmgMax, 1 + dmgPerRound·(ronda − from))
export const BOSS_RULES = {
  from: 5, twoFrom: 20, spawnAt: 0.2,        // aparece tras el 20 % de la ronda
  hpPerRound: 0.12, hpPerExtraPlayer: 0.5, dmgPerRound: 0.07, dmgMax: 3,
  killPoints: 1000, teamPoints: 300,         // al que lo mata / al resto del equipo
};
Object.assign(ZOMBIE_TYPES, {
  butcher: {
    code: 4, boss: true, name: 'El Carnicero', desc: 'Carga contra ti desde lejos: ¡apártate de su camino!',
    hpBase: 6000, hpMult: 14, damage: 40, speed: 2.6, scale: 1.7, attackRange: 2.0, windup: 0.55, cooldown: 1.5, tearMult: 0.2,
    charge: { min: 4, max: 15, speed: 10, time: 1.3, every: 7, dmgMult: 1.5 },
  },
  plague: {
    code: 5, boss: true, name: 'La Madre Plaga', desc: 'Su aura tóxica daña e infecta a quien se acerque.',
    hpBase: 5200, hpMult: 12, damage: 30, speed: 1.9, scale: 1.45, attackRange: 1.8, windup: 0.5, cooldown: 1.4, tearMult: 0.3,
    aura: { radius: 4.2, every: 1.0, damage: 4, infect: 0.35 },
  },
  necro: {
    code: 6, boss: true, name: 'El Nigromante', desc: 'Invoca zombis a su alrededor. Acaba con él cuanto antes.',
    hpBase: 4500, hpMult: 10, damage: 30, speed: 1.8, scale: 1.3, attackRange: 1.7, windup: 0.5, cooldown: 1.4, tearMult: 0.4,
    summon: { every: 11, count: 3, maxAlive: 8, radius: 3 },
  },
  armored: {
    code: 7, boss: true, name: 'El Acorazado', desc: 'Su armadura para casi todo: apunta a la cabeza.',
    hpBase: 5200, hpMult: 12, damage: 45, speed: 1.7, scale: 1.6, attackRange: 2.0, windup: 0.6, cooldown: 1.7, tearMult: 0.2,
    armor: { body: 0.25, explosion: 0.5, melee: 0.5 },
    slam: { range: 2.6, radius: 3.4, windup: 0.8, every: 6, dmgMult: 1.2 },
  },
  specter: {
    code: 8, boss: true, name: 'El Espectro', desc: 'A ratos se vuelve casi invisible, más rápido y resistente.',
    hpBase: 4200, hpMult: 10, damage: 35, speed: 3.6, scale: 1.2, attackRange: 1.8, windup: 0.4, cooldown: 1.2, tearMult: 0.4,
    cloak: { visible: 6, hidden: 4, speedMult: 1.6, damageTaken: 0.5 },
  },
});
export const BOSS_KEYS = Object.keys(ZOMBIE_TYPES).filter((k) => ZOMBIE_TYPES[k].boss);

export const ZOMBIE_TYPE_BY_CODE = Object.fromEntries(Object.entries(ZOMBIE_TYPES).map(([k, v]) => [v.code, k]));

// Vida de los zombis según la ronda (fórmula de Black Ops)
export function zombieHealth(round) {
  if (round < 10) return 150 + 100 * (round - 1);
  return Math.floor(950 * Math.pow(1.1, round - 9));
}

// Cantidad total de zombis de una ronda (fórmula de Black Ops)
export function zombiesForRound(round, players) {
  let max = 24;
  let mult = round / 5;
  if (mult < 1) mult = 1;
  if (round >= 10) mult *= round * 0.15;
  if (players <= 1) max += Math.floor(0.5 * 6 * mult);
  else max += Math.floor((players - 1) * 6 * mult);
  if (round < 2) max = Math.floor(max * 0.25);
  else if (round < 3) max = Math.floor(max * 0.3);
  else if (round < 4) max = Math.floor(max * 0.5);
  else if (round < 5) max = Math.floor(max * 0.7);
  else if (round < 6) max = Math.floor(max * 0.9);
  return Math.max(1, max);
}

// Probabilidades de velocidad de los zombis por ronda
export function zombieSpeedChances(round) {
  const run = Math.min(1, Math.max(0, (round - 2) * 0.18));
  const sprint = Math.min(0.85, Math.max(0, (round - 5) * 0.12));
  return { run, sprint };
}

// Puntos
export const POINTS = {
  hit: 10,
  killBody: 60,
  killNeck: 70,
  killHead: 100,
  killMelee: 130,
  repairBoard: 10,
  repairCapPerRound: 500,
  nuke: 400,
  carpenter: 200,
};

// Barricadas
export const BOARDS_PER_WINDOW = 6;
export const REPAIR_TIME = 0.6;           // segundos por tabla (Speed Cola: la mitad)

// Rondas
export const ROUND = {
  firstDelay: 5,           // segundos antes de la ronda 1
  intermission: 10,        // pausa entre rondas
};

// Caja misteriosa
export const BOX = {
  price: 950,
  fireSalePrice: 10,
  spinTime: 4.5,
  pickupTime: 12,
  teddyMinUses: 4,         // usos mínimos en una ubicación antes de que pueda salir el osito
  teddyChance: 0.18,
  teddyTime: 5,            // el osito aparece y la caja se va volando
  arriveTime: 3,           // la caja cae en su nueva ubicación
};

// Pack-a-Punch
export const PAP = {
  price: 5000,
  workTime: 4.5,
  pickupTime: 15,
  upgradedAmmoPrice: 4500,
};

// Escudo antidisturbios (Zombie Shield)
export const SHIELD = {
  parts: 3,
  buildTime: 3.0,
  hp: 1500,
  frontArcDeg: 120,         // bloquea golpes dentro de este arco frontal cuando está en las manos
  backArcDeg: 120,          // bloquea golpes dentro de este arco trasero cuando está en la espalda
  bashDamage: 400,
  bashRange: 2.0,
  bashArcDeg: 100,
  bashCooldown: 0.9,
  bashSelfDamage: 15,       // desgaste del escudo por cada zombi golpeado
  knockback: 1.6,
};

// Cuerpo a cuerpo
export const MELEE = {
  knifeDamage: 150,
  bowieDamage: 1000,
  range: 1.7,
  arcDeg: 70,
  cooldown: 0.65,
  bowiePrice: 3000,
};

// Granadas de fragmentación
export const GRENADE = {
  damage: 450,
  radius: 5,
  fuse: 2.5,
  throwSpeed: 13,
  upSpeed: 3.5,
  bounce: 0.35,
  friction: 0.6,
};

// Curas (se usan con la tecla H). heal: salud que recupera (Infinity = toda); cures: quita la infección.
export const MEDS = {
  bandage:  { key: 'bandage',  name: 'Venda',    plural: 'Vendas',    heal: 35,       useTime: 2.0, max: 5, price: 500,  pack: 2, cures: false, color: '#e8e2d0' },
  antidote: { key: 'antidote', name: 'Antídoto', plural: 'Antídotos', heal: 10,       useTime: 1.5, max: 2, price: 900,  pack: 1, cures: true,  color: '#39c46a' },
  medkit:   { key: 'medkit',   name: 'Botiquín', plural: 'Botiquines', heal: Infinity, useTime: 4.0, max: 1, price: 1500, pack: 1, cures: true,  color: '#d8262a' },
};
export const MED_KEYS = Object.keys(MEDS);

// Curas que sueltan los zombis al morir (se recogen pasando por encima si hay hueco)
export const MED_DROPS = {
  chance: 0.05,             // por baja
  maxPerRound: 6,
  lifetime: 45,             // segundos en el suelo
  pickupRadius: 1.2,
  weights: { bandage: 6, antidote: 2.5, medkit: 1.2 },
};

// Infección: un golpe de zombi que conecta puede infectar; se pierde vida poco a poco hasta curarse o caer
export const INFECTION = {
  chance: 0.25,             // probabilidad por golpe recibido
  dps: 1.0,                 // daño por segundo al empezar
  ramp: 0.03,               // el daño por segundo crece esto cada segundo
  dpsMax: 4.0,
};

// Potenciadores
export const POWERUPS = {
  types: ['maxammo', 'instakill', 'doublepoints', 'nuke', 'carpenter', 'firesale'],
  dropChance: 0.03,         // por baja
  maxPerRound: 4,
  lifetime: 30,             // segundos en el suelo
  blinkAt: 8,               // empieza a parpadear cuando quedan estos segundos
  duration: 30,             // insta-kill, doble puntos y liquidación
  pickupRadius: 1.3,
};

export const POWERUP_INFO = {
  maxammo:      { name: 'Munición Máxima', announce: 'Max Ammo!' },
  instakill:    { name: 'Muerte Instantánea', announce: 'Insta-Kill!' },
  doublepoints: { name: 'Doble Puntos', announce: 'Double Points!' },
  nuke:         { name: 'Bomba Nuclear', announce: 'Kaboom!' },
  carpenter:    { name: 'Carpintero', announce: 'Carpenter!' },
  firesale:     { name: 'Liquidación', announce: 'Fire Sale!' },
};

// Colores disponibles para los jugadores (como en BO: blanco, azul, amarillo, verde)
export const PLAYER_COLORS = ['#ffffff', '#4aa3ff', '#ffd23f', '#5ee36a'];

// Utilidades matemáticas pequeñas usadas en ambos lados
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
// Vector "hacia adelante" en el plano XZ para un yaw (convención Three.js: yaw 0 mira hacia -Z)
export function forwardXZ(yaw) { return { x: -Math.sin(yaw), z: -Math.cos(yaw) }; }
// Yaw que mira desde (x0,z0) hacia (x1,z1)
export function yawTo(x0, z0, x1, z1) { return Math.atan2(-(x1 - x0), -(z1 - z0)); }
