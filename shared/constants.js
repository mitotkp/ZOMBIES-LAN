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
  damage: 50,               // 2 golpes sin Juggernog, 5 con Juggernog
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
