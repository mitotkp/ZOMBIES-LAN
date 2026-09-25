// Definición de armas (compartida). El servidor calcula el daño con estos datos; el cliente los usa
// para cadencia, cargador, recarga, dispersión, modelos y sonidos.
//
// Campos:
//  key, name       identificador y nombre visible
//  cls             'pistol'|'smg'|'rifle'|'lmg'|'shotgun'|'sniper'|'wonder'|'launcher'
//  mode            'semi' | 'auto' | 'burst' | 'pump' | 'bolt'
//  burst           balas por ráfaga (mode 'burst')
//  dmg             daño por bala/perdigón (a 0 m)
//  head            multiplicador en la cabeza (las piernas usan 0.75, el torso 1.0)
//  rpm             cadencia (disparos por minuto)
//  mag, reserve    cargador y munición de reserva máxima
//  reload          segundos de recarga completa
//  pellets         perdigones por disparo (escopetas)
//  spreadHip/Ads   dispersión en grados desde la cadera / apuntando
//  range           a partir de aquí el daño cae hasta minDmgMult en 'range * 2'
//  minDmgMult      multiplicador mínimo de daño por distancia
//  pen             cuántos zombis puede atravesar una bala
//  projectile      si existe, el arma dispara proyectiles simulados en el cliente:
//                  { speed, gravity, splash, splashDmg, direct(daño directo), color, size }
//  price           precio en pared (null si no está en pared)
//  box             aparece en la caja misteriosa
//  weight          peso en la caja (probabilidad relativa)
//  model           arquetipo del modelo procedural: 'pistol'|'revolver'|'smg'|'rifle'|'lmg'|
//                  'shotgun'|'doublebarrel'|'sniper'|'raygun'|'raygun2'|'launcher'
//  sound           arquetipo de sonido (mismos nombres que model, más 'burst')
//  color           color base del arma (hex)
//  zoom            multiplicador de zoom al apuntar (FOV / zoom)
//  moveMult        multiplicador de velocidad del jugador llevándola en las manos
//  pap             versión Pack-a-Punch: sobrescribe campos (name, dmg, mag, reserve, rpm, projectile, special...)
//  special         'explosive' (M1911 mejorada), 'fire' (Hades: quema), 'shock' etc. (efectos visuales/servidor)

export const WEAPONS = {
  // ------------------------------------------------------------------ Pistolas
  m1911: {
    key: 'm1911', name: 'M1911', cls: 'pistol', mode: 'semi', dmg: 20, head: 2.0, rpm: 625,
    mag: 8, reserve: 80, reload: 1.6, pellets: 1, spreadHip: 2.5, spreadAds: 0.4, range: 20, minDmgMult: 0.6,
    pen: 1, price: null, box: false, weight: 0, model: 'pistol', sound: 'pistol', color: 0x3a3a3a, zoom: 1.15, moveMult: 1.0,
    pap: {
      name: 'Mustang & Sally', mag: 12, reserve: 60, rpm: 500, special: 'explosive',
      projectile: { speed: 55, gravity: 0, splash: 3.2, splashDmg: 1000, direct: 1000, color: 0xff5a1f, size: 0.09 },
    },
  },
  b23r: {
    key: 'b23r', name: 'B23R', cls: 'pistol', mode: 'burst', burst: 3, dmg: 70, head: 2.5, rpm: 900,
    mag: 15, reserve: 150, reload: 1.7, pellets: 1, spreadHip: 2.5, spreadAds: 0.5, range: 25, minDmgMult: 0.6,
    pen: 1, price: 1000, box: true, weight: 3, model: 'pistol', sound: 'burst', color: 0x2b2b30, zoom: 1.15, moveMult: 1.0,
    pap: { name: 'B34R', dmg: 130, mag: 18, reserve: 222 },
  },
  fiveseven: {
    key: 'fiveseven', name: 'Five-seven', cls: 'pistol', mode: 'semi', dmg: 55, head: 2.5, rpm: 700,
    mag: 20, reserve: 120, reload: 1.5, pellets: 1, spreadHip: 2.5, spreadAds: 0.4, range: 25, minDmgMult: 0.6,
    pen: 1, price: null, box: true, weight: 3, model: 'pistol', sound: 'pistol', color: 0x5a5a4a, zoom: 1.15, moveMult: 1.0,
    pap: { name: 'Ultra', dmg: 110, mag: 20, reserve: 200 },
  },
  python: {
    key: 'python', name: 'Python', cls: 'pistol', mode: 'semi', dmg: 450, head: 2.5, rpm: 200,
    mag: 6, reserve: 36, reload: 2.8, pellets: 1, spreadHip: 2.0, spreadAds: 0.3, range: 30, minDmgMult: 0.7,
    pen: 2, price: null, box: true, weight: 3, model: 'revolver', sound: 'revolver', color: 0x8a8f99, zoom: 1.2, moveMult: 1.0,
    pap: { name: 'Cobra', dmg: 900, mag: 12, reserve: 60 },
  },
  executioner: {
    key: 'executioner', name: 'Executioner', cls: 'pistol', mode: 'semi', dmg: 60, head: 1.5, rpm: 220,
    mag: 5, reserve: 32, reload: 2.8, pellets: 5, spreadHip: 5.5, spreadAds: 4.0, range: 10, minDmgMult: 0.35,
    pen: 1, price: null, box: true, weight: 3, model: 'revolver', sound: 'shotgun', color: 0x4d4035, zoom: 1.1, moveMult: 1.0,
    pap: { name: 'Voice of Justice', dmg: 130, pellets: 7, mag: 5, reserve: 60 },
  },
  // ------------------------------------------------------------------ Subfusiles
  mp5: {
    key: 'mp5', name: 'MP5', cls: 'smg', mode: 'auto', dmg: 60, head: 2.5, rpm: 750,
    mag: 30, reserve: 120, reload: 2.2, pellets: 1, spreadHip: 3.5, spreadAds: 1.0, range: 18, minDmgMult: 0.55,
    pen: 1, price: 1000, box: false, weight: 0, model: 'smg', sound: 'smg', color: 0x252528, zoom: 1.2, moveMult: 1.0,
    pap: { name: 'MP115 Kollider', dmg: 110, mag: 40, reserve: 200 },
  },
  ak74u: {
    key: 'ak74u', name: 'AK74u', cls: 'smg', mode: 'auto', dmg: 70, head: 2.5, rpm: 700,
    mag: 20, reserve: 160, reload: 2.3, pellets: 1, spreadHip: 3.5, spreadAds: 1.0, range: 20, minDmgMult: 0.55,
    pen: 1, price: 1200, box: true, weight: 3, model: 'smg', sound: 'smg', color: 0x6b4a2b, zoom: 1.2, moveMult: 1.0,
    pap: { name: 'AK74fu2', dmg: 130, mag: 40, reserve: 280 },
  },
  pdw: {
    key: 'pdw', name: 'PDW-57', cls: 'smg', mode: 'auto', dmg: 60, head: 2.5, rpm: 780,
    mag: 50, reserve: 250, reload: 3.0, pellets: 1, spreadHip: 3.5, spreadAds: 1.0, range: 18, minDmgMult: 0.55,
    pen: 1, price: null, box: true, weight: 3, model: 'smg', sound: 'smg', color: 0x3d4a3a, zoom: 1.2, moveMult: 1.0,
    pap: { name: 'Predictive Death Wish 57000', dmg: 110, mag: 64, reserve: 384 },
  },
  chicom: {
    key: 'chicom', name: 'Chicom CQB', cls: 'smg', mode: 'burst', burst: 3, dmg: 65, head: 2.5, rpm: 950,
    mag: 36, reserve: 180, reload: 2.4, pellets: 1, spreadHip: 3.0, spreadAds: 0.9, range: 20, minDmgMult: 0.55,
    pen: 1, price: null, box: true, weight: 3, model: 'smg', sound: 'burst', color: 0x2f3530, zoom: 1.2, moveMult: 1.0,
    pap: { name: 'Chicom Cataclysmic Quadruple Burst', dmg: 125, burst: 4, mag: 52, reserve: 260 },
  },
  // ------------------------------------------------------------------ Fusiles
  m14: {
    key: 'm14', name: 'M14', cls: 'rifle', mode: 'semi', dmg: 110, head: 3.0, rpm: 600,
    mag: 8, reserve: 92, reload: 2.0, pellets: 1, spreadHip: 3.0, spreadAds: 0.3, range: 40, minDmgMult: 0.7,
    pen: 2, price: 500, box: false, weight: 0, model: 'rifle', sound: 'rifle', color: 0x7a5230, zoom: 1.35, moveMult: 0.96,
    pap: { name: 'Mnesia', dmg: 260, mag: 20, reserve: 150 },
  },
  m16: {
    key: 'm16', name: 'Colt M16A1', cls: 'rifle', mode: 'burst', burst: 3, dmg: 100, head: 2.5, rpm: 850,
    mag: 30, reserve: 120, reload: 2.2, pellets: 1, spreadHip: 3.0, spreadAds: 0.5, range: 35, minDmgMult: 0.65,
    pen: 2, price: 1200, box: false, weight: 0, model: 'rifle', sound: 'burst', color: 0x2a2a2a, zoom: 1.35, moveMult: 0.96,
    pap: { name: 'Skullcrusher', dmg: 190, mag: 30, reserve: 270 },
  },
  galil: {
    key: 'galil', name: 'Galil', cls: 'rifle', mode: 'auto', dmg: 90, head: 2.5, rpm: 650,
    mag: 35, reserve: 315, reload: 2.8, pellets: 1, spreadHip: 3.2, spreadAds: 0.6, range: 35, minDmgMult: 0.65,
    pen: 2, price: null, box: true, weight: 3, model: 'rifle', sound: 'rifle', color: 0x3b3a33, zoom: 1.35, moveMult: 0.95,
    pap: { name: 'Lamentation', dmg: 170, mag: 35, reserve: 490 },
  },
  an94: {
    key: 'an94', name: 'AN-94', cls: 'rifle', mode: 'auto', dmg: 95, head: 2.5, rpm: 600,
    mag: 30, reserve: 270, reload: 2.6, pellets: 1, spreadHip: 3.2, spreadAds: 0.5, range: 35, minDmgMult: 0.65,
    pen: 2, price: null, box: true, weight: 3, model: 'rifle', sound: 'rifle', color: 0x30332e, zoom: 1.35, moveMult: 0.95,
    pap: { name: 'Actuated Neutralizer 94000', dmg: 175, mag: 45, reserve: 450 },
  },
  mtar: {
    key: 'mtar', name: 'MTAR', cls: 'rifle', mode: 'auto', dmg: 85, head: 2.5, rpm: 750,
    mag: 30, reserve: 270, reload: 2.4, pellets: 1, spreadHip: 3.2, spreadAds: 0.6, range: 30, minDmgMult: 0.65,
    pen: 2, price: null, box: true, weight: 3, model: 'rifle', sound: 'rifle', color: 0x4a4436, zoom: 1.3, moveMult: 0.96,
    pap: { name: 'Malevolent Taxonomic Anodized Redeemer', dmg: 160, mag: 45, reserve: 450 },
  },
  type25: {
    key: 'type25', name: 'Type 25', cls: 'rifle', mode: 'auto', dmg: 85, head: 2.5, rpm: 800,
    mag: 30, reserve: 270, reload: 2.4, pellets: 1, spreadHip: 3.2, spreadAds: 0.6, range: 30, minDmgMult: 0.65,
    pen: 2, price: null, box: true, weight: 3, model: 'rifle', sound: 'rifle', color: 0x28303a, zoom: 1.3, moveMult: 0.96,
    pap: { name: 'Strain 25', dmg: 160, mag: 45, reserve: 450 },
  },
  smr: {
    key: 'smr', name: 'SMR', cls: 'rifle', mode: 'semi', dmg: 160, head: 3.0, rpm: 450,
    mag: 20, reserve: 120, reload: 2.5, pellets: 1, spreadHip: 3.0, spreadAds: 0.3, range: 40, minDmgMult: 0.7,
    pen: 2, price: null, box: true, weight: 3, model: 'rifle', sound: 'rifle', color: 0x55503f, zoom: 1.4, moveMult: 0.95,
    pap: { name: 'SMILE', dmg: 320, mag: 27, reserve: 180 },
  },
  // ------------------------------------------------------------------ Ametralladoras ligeras
  rpd: {
    key: 'rpd', name: 'RPD', cls: 'lmg', mode: 'auto', dmg: 90, head: 2.5, rpm: 750,
    mag: 100, reserve: 400, reload: 5.0, pellets: 1, spreadHip: 4.5, spreadAds: 1.0, range: 35, minDmgMult: 0.65,
    pen: 2, price: null, box: true, weight: 3, model: 'lmg', sound: 'lmg', color: 0x4a3a28, zoom: 1.25, moveMult: 0.88,
    pap: { name: 'Relativistic Punch Device', dmg: 170, mag: 125, reserve: 500 },
  },
  hamr: {
    key: 'hamr', name: 'HAMR', cls: 'lmg', mode: 'auto', dmg: 95, head: 2.5, rpm: 800,
    mag: 75, reserve: 450, reload: 4.5, pellets: 1, spreadHip: 4.5, spreadAds: 1.0, range: 35, minDmgMult: 0.65,
    pen: 2, price: null, box: true, weight: 3, model: 'lmg', sound: 'lmg', color: 0x33363b, zoom: 1.25, moveMult: 0.88,
    pap: { name: 'SLDG HAMR', dmg: 180, mag: 125, reserve: 600 },
  },
  // ------------------------------------------------------------------ Escopetas
  olympia: {
    key: 'olympia', name: 'Olympia', cls: 'shotgun', mode: 'semi', dmg: 60, head: 1.5, rpm: 240,
    mag: 2, reserve: 38, reload: 2.3, pellets: 8, spreadHip: 6.0, spreadAds: 5.0, range: 10, minDmgMult: 0.3,
    pen: 1, price: 500, box: false, weight: 0, model: 'doublebarrel', sound: 'shotgun', color: 0x6b4a2b, zoom: 1.1, moveMult: 0.97,
    pap: { name: 'Hades', dmg: 120, mag: 2, reserve: 60, special: 'fire' },
  },
  r870: {
    key: 'r870', name: 'Remington 870 MCS', cls: 'shotgun', mode: 'pump', dmg: 70, head: 1.5, rpm: 75,
    mag: 6, reserve: 42, reload: 3.2, pellets: 8, spreadHip: 5.5, spreadAds: 4.5, range: 12, minDmgMult: 0.3,
    pen: 1, price: 1500, box: false, weight: 0, model: 'shotgun', sound: 'shotgun', color: 0x2c2c2c, zoom: 1.1, moveMult: 0.96,
    pap: { name: 'Refitted-870 Mechanical Cranium Sequencer', dmg: 140, mag: 10, reserve: 60, rpm: 90 },
  },
  ksg: {
    key: 'ksg', name: 'KSG', cls: 'shotgun', mode: 'pump', dmg: 420, head: 2.0, rpm: 80,
    mag: 14, reserve: 84, reload: 3.4, pellets: 1, spreadHip: 3.0, spreadAds: 0.4, range: 25, minDmgMult: 0.6,
    pen: 3, price: null, box: true, weight: 3, model: 'shotgun', sound: 'shotgun', color: 0x3a3f36, zoom: 1.2, moveMult: 0.96,
    pap: { name: 'Mist Maker', dmg: 850, mag: 20, reserve: 120 },
  },
  m1216: {
    key: 'm1216', name: 'M1216', cls: 'shotgun', mode: 'auto', dmg: 60, head: 1.5, rpm: 350,
    mag: 16, reserve: 96, reload: 3.0, pellets: 6, spreadHip: 5.5, spreadAds: 4.5, range: 12, minDmgMult: 0.3,
    pen: 1, price: null, box: true, weight: 3, model: 'shotgun', sound: 'shotgun', color: 0x2e2a26, zoom: 1.1, moveMult: 0.95,
    pap: { name: 'Mesmerizer', dmg: 115, mag: 24, reserve: 144 },
  },
  // ------------------------------------------------------------------ Francotiradores
  dsr50: {
    key: 'dsr50', name: 'DSR 50', cls: 'sniper', mode: 'bolt', dmg: 1000, head: 5.0, rpm: 45,
    mag: 5, reserve: 50, reload: 3.4, pellets: 1, spreadHip: 6.0, spreadAds: 0.0, range: 80, minDmgMult: 1.0,
    pen: 5, price: null, box: true, weight: 2, model: 'sniper', sound: 'sniper', color: 0x2b2f24, zoom: 4.0, moveMult: 0.9,
    pap: { name: 'Dead Specimen Reactor 5000', dmg: 2200, mag: 8, reserve: 80 },
  },
  barrett: {
    key: 'barrett', name: 'Barrett M82A1', cls: 'sniper', mode: 'semi', dmg: 900, head: 4.0, rpm: 150,
    mag: 10, reserve: 50, reload: 3.6, pellets: 1, spreadHip: 6.0, spreadAds: 0.0, range: 80, minDmgMult: 1.0,
    pen: 5, price: null, box: true, weight: 2, model: 'sniper', sound: 'sniper', color: 0x3a3a36, zoom: 3.5, moveMult: 0.88,
    pap: { name: 'Macro Annihilator', dmg: 2000, mag: 15, reserve: 90 },
  },
  // ------------------------------------------------------------------ Armas maravilla / explosivas
  raygun: {
    key: 'raygun', name: 'Ray Gun', cls: 'wonder', mode: 'semi', dmg: 1000, head: 1.0, rpm: 180,
    mag: 20, reserve: 160, reload: 2.6, pellets: 1, spreadHip: 1.5, spreadAds: 0.3, range: 60, minDmgMult: 1.0,
    pen: 1, price: null, box: true, weight: 1, model: 'raygun', sound: 'raygun', color: 0x8b8f95, zoom: 1.15, moveMult: 1.0,
    projectile: { speed: 42, gravity: 0, splash: 2.4, splashDmg: 300, direct: 1000, color: 0x3dff5a, size: 0.12 },
    pap: {
      name: "Porter's X2 Ray Gun", mag: 40, reserve: 200,
      projectile: { speed: 50, gravity: 0, splash: 2.8, splashDmg: 600, direct: 2000, color: 0xff2d2d, size: 0.13 },
    },
  },
  raygun2: {
    key: 'raygun2', name: 'Ray Gun Mark II', cls: 'wonder', mode: 'burst', burst: 3, dmg: 250, head: 3.0, rpm: 600,
    mag: 21, reserve: 162, reload: 2.4, pellets: 1, spreadHip: 1.2, spreadAds: 0.2, range: 60, minDmgMult: 1.0,
    pen: 3, price: null, box: true, weight: 1, model: 'raygun2', sound: 'raygun2', color: 0x6d6f74, zoom: 1.2, moveMult: 1.0,
    pap: { name: "Porter's Mark II Ray Gun", dmg: 500, mag: 45, reserve: 243 },
  },
  warmachine: {
    key: 'warmachine', name: 'War Machine', cls: 'launcher', mode: 'semi', dmg: 900, head: 1.0, rpm: 110,
    mag: 6, reserve: 24, reload: 3.5, pellets: 1, spreadHip: 1.5, spreadAds: 0.5, range: 60, minDmgMult: 1.0,
    pen: 1, price: null, box: true, weight: 2, model: 'launcher', sound: 'launcher', color: 0x46503a, zoom: 1.15, moveMult: 0.92,
    projectile: { speed: 24, gravity: 9, splash: 4.0, splashDmg: 900, direct: 900, color: 0x999999, size: 0.07, bounce: true, fuse: 1.2 },
    pap: {
      name: 'Dystopic Demolisher', mag: 12, reserve: 60,
      projectile: { speed: 26, gravity: 9, splash: 4.5, splashDmg: 1600, direct: 1600, color: 0x999999, size: 0.07, bounce: true, fuse: 1.2 },
    },
  },
  // ------------------------------------------------------------------ Arma de pared especial (no ocupa espacio)
  bowie: {
    key: 'bowie', name: 'Cuchillo Bowie', cls: 'melee', mode: 'semi', dmg: 0, head: 1, rpm: 60,
    mag: 0, reserve: 0, reload: 0, pellets: 0, spreadHip: 0, spreadAds: 0, range: 0, minDmgMult: 1,
    pen: 0, price: 3000, box: false, weight: 0, model: 'knife', sound: 'knife', color: 0x9a9a9a, zoom: 1, moveMult: 1,
    melee: true,
  },
  // ------------------------------------------------------------------ Armas cuerpo a cuerpo de pared (sustituyen al cuchillo)
  bat: {
    key: 'bat', name: 'Bate con clavos', cls: 'melee', mode: 'semi', dmg: 0, head: 1, rpm: 60,
    mag: 0, reserve: 0, reload: 0, pellets: 0, spreadHip: 0, spreadAds: 0, range: 0, minDmgMult: 1,
    pen: 0, price: 1500, box: false, weight: 0, model: 'bat', sound: 'knife', color: 0x8a6a48, zoom: 1, moveMult: 1,
    melee: true,
  },
  machete: {
    key: 'machete', name: 'Machete', cls: 'melee', mode: 'semi', dmg: 0, head: 1, rpm: 60,
    mag: 0, reserve: 0, reload: 0, pellets: 0, spreadHip: 0, spreadAds: 0, range: 0, minDmgMult: 1,
    pen: 0, price: 2500, box: false, weight: 0, model: 'machete', sound: 'knife', color: 0x9a9a9a, zoom: 1, moveMult: 1,
    melee: true,
  },
  axe: {
    key: 'axe', name: 'Hacha de bombero', cls: 'melee', mode: 'semi', dmg: 0, head: 1, rpm: 60,
    mag: 0, reserve: 0, reload: 0, pellets: 0, spreadHip: 0, spreadAds: 0, range: 0, minDmgMult: 1,
    pen: 0, price: 4000, box: false, weight: 0, model: 'axe', sound: 'knife', color: 0xb02020, zoom: 1, moveMult: 1,
    melee: true,
  },
};

// Estadísticas del arma cuerpo a cuerpo equipada (campo 'melee' del jugador).
// dmg: daño por zombi; range (m); arc (grados); cd: enfriamiento (s); targets: zombis por golpe;
// knock: empuje (m, 0 = nada); dur/hit: duración de la animación y momento del impacto (s).
export const MELEE_WEAPONS = {
  knife:   { key: 'knife',   name: 'Cuchillo',         dmg: 150,  range: 1.7, arc: 70,  cd: 0.65, targets: 1, knock: 0,   dur: 0.42, hit: 0.12 },
  bowie:   { key: 'bowie',   name: 'Bowie',            dmg: 1000, range: 1.7, arc: 70,  cd: 0.65, targets: 1, knock: 0,   dur: 0.42, hit: 0.12 },
  bat:     { key: 'bat',     name: 'Bate con clavos',  dmg: 550,  range: 2.1, arc: 120, cd: 0.95, targets: 3, knock: 1.3, dur: 0.62, hit: 0.24 },
  machete: { key: 'machete', name: 'Machete',          dmg: 1100, range: 1.9, arc: 95,  cd: 0.7,  targets: 2, knock: 0,   dur: 0.48, hit: 0.16 },
  axe:     { key: 'axe',     name: 'Hacha de bombero', dmg: 2600, range: 1.9, arc: 75,  cd: 1.15, targets: 1, knock: 0.8, dur: 0.72, hit: 0.3 },
};
export function meleeStats(key) { return MELEE_WEAPONS[key] || MELEE_WEAPONS.knife; }

// Devuelve la definición efectiva (con Pack-a-Punch aplicado si upgraded)
const cache = new Map();
export function weaponDef(key, upgraded = false) {
  const base = WEAPONS[key];
  if (!base) return null;
  if (!upgraded || !base.pap) return base;
  const ck = key + '+';
  if (!cache.has(ck)) {
    const merged = { ...base, ...base.pap, upgraded: true };
    delete merged.pap;
    cache.set(ck, merged);
  }
  return cache.get(ck);
}

export function weaponName(key, upgraded = false) {
  const d = weaponDef(key, upgraded);
  return d ? d.name : key;
}

// Armas de la caja misteriosa
export const BOX_POOL = Object.values(WEAPONS).filter((w) => w.box).map((w) => ({ key: w.key, weight: w.weight }));

// Precio de munición en la pared
export function ammoPrice(key, upgraded) {
  const w = WEAPONS[key];
  if (!w || !w.price) return 0;
  return upgraded ? 4500 : Math.round(w.price / 2);
}

// Multiplicador de daño por parte del cuerpo ('h' cabeza, 'b' torso, 'l' piernas)
export function partMult(def, part) {
  if (part === 'h') return def.head;
  if (part === 'l') return 0.75;
  return 1.0;
}

// Caída del daño con la distancia
export function falloff(def, dist) {
  if (dist <= def.range) return 1;
  if (dist >= def.range * 2) return def.minDmgMult;
  const t = (dist - def.range) / def.range;
  return 1 + (def.minDmgMult - 1) * t;
}

// Intervalo entre disparos en segundos (Double Tap = x1.33 cadencia)
export function fireInterval(def, doubleTap) {
  return 60 / (def.rpm * (doubleTap ? 1.33 : 1));
}
