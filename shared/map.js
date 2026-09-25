// Definición del mapa "Pueblo Olvidado" (inspirado en Town/TranZit de BO2, diseño original).
// La cuadrícula se genera a partir de rectángulos para que servidor y cliente compartan
// exactamente la misma geometría de colisión.
//
// Convenciones:
//  - 1 celda = 1 metro. La celda (x, z) ocupa [x, x+1] x [z, z+1] en coordenadas de mundo.
//  - El centro de la celda (x, z) está en (x + 0.5, z + 0.5).
//  - Norte = -Z (fila 0 arriba), Sur = +Z, Este = +X, Oeste = -X.
//  - El suelo está en y = 0.

export const MAP_NAME = 'Pueblo Olvidado';
export const W = 59;           // columnas (x)
export const H = 36;           // filas (z)
export const WALL_H = 4.0;     // altura de muros de edificios
export const FENCE_H = 2.6;    // altura de los muros/vallas de los callejones exteriores
export const CEIL_H = 4.0;     // altura de techo de zonas interiores

// Tipos de celda
export const C = {
  VOID: 0,      // fuera del mapa (sólido, no se dibuja)
  FLOOR: 1,     // suelo transitable de una zona
  WALL: 2,      // muro
  DOOR: 3,      // puerta/escombros comprables (sólida mientras está cerrada)
  WINDOW: 4,    // ventana con barricada (sólida para jugadores; los zombis la cruzan)
  OUTSIDE: 5,   // callejón exterior donde aparecen los zombis (inaccesible para jugadores)
  PROP: 6,      // obstáculo sólido con altura (bancos, autobús, cajas, máquinas...)
};

// Tipo visual de muro
export const WALL_KIND = { BUILDING: 0, FENCE: 1 };

export const ZONES = [
  { id: 0, key: 'terminal', name: 'Terminal', indoor: true,  x0: 4,  z0: 20, x1: 17, z1: 31 },
  { id: 1, key: 'calle',    name: 'Calle',    indoor: false, x0: 19, z0: 20, x1: 54, z1: 31 },
  { id: 2, key: 'bar',      name: 'Bar',      indoor: true,  x0: 4,  z0: 5,  x1: 17, z1: 18 },
  { id: 3, key: 'almacen',  name: 'Almacén',  indoor: true,  x0: 19, z0: 5,  x1: 36, z1: 18 },
  { id: 4, key: 'planta',   name: 'Planta Eléctrica', indoor: true, x0: 38, z0: 5, x1: 54, z1: 18 },
];
export const START_ZONE = 0;

// Puertas: cells = celdas de muro que se abren. kind: 'door' (puerta metálica) | 'debris' (escombros)
export const DOORS = [
  { id: 'A', cost: 750,  zones: [0, 1], kind: 'door',   cells: [[18, 25], [18, 26]] },
  { id: 'B', cost: 750,  zones: [0, 2], kind: 'debris', cells: [[10, 19], [11, 19]] },
  { id: 'C', cost: 1000, zones: [1, 3], kind: 'door',   cells: [[27, 19], [28, 19]] },
  { id: 'D', cost: 1000, zones: [2, 3], kind: 'door',   cells: [[18, 11], [18, 12]] },
  { id: 'E', cost: 1250, zones: [3, 4], kind: 'door',   cells: [[37, 11], [37, 12]] },
  { id: 'F', cost: 1250, zones: [1, 4], kind: 'debris', cells: [[46, 19], [47, 19]] },
];

// Ventanas con barricada. (x, z) = celda del muro; dir = hacia dónde está el exterior.
export const WINDOWS = [
  { id: 0,  x: 3,  z: 23, dir: 'W', zone: 0 },
  { id: 1,  x: 8,  z: 32, dir: 'S', zone: 0 },
  { id: 2,  x: 14, z: 32, dir: 'S', zone: 0 },
  { id: 3,  x: 26, z: 32, dir: 'S', zone: 1 },
  { id: 4,  x: 40, z: 32, dir: 'S', zone: 1 },
  { id: 5,  x: 50, z: 32, dir: 'S', zone: 1 },
  { id: 6,  x: 55, z: 25, dir: 'E', zone: 1 },
  { id: 7,  x: 3,  z: 11, dir: 'W', zone: 2 },
  { id: 8,  x: 10, z: 4,  dir: 'N', zone: 2 },
  { id: 9,  x: 24, z: 4,  dir: 'N', zone: 3 },
  { id: 10, x: 32, z: 4,  dir: 'N', zone: 3 },
  { id: 11, x: 44, z: 4,  dir: 'N', zone: 4 },
  { id: 12, x: 55, z: 11, dir: 'E', zone: 4 },
];

export const DIRS = {
  N: { dx: 0, dz: -1 },
  S: { dx: 0, dz: 1 },
  E: { dx: 1, dz: 0 },
  W: { dx: -1, dz: 0 },
};

// Obstáculos decorativos sólidos (rectángulos de celdas inclusivos) con altura para balas/granadas.
export const PROPS = [
  // Terminal: filas de asientos
  { kind: 'bench', x0: 7,  z0: 24, x1: 12, z1: 24, h: 0.9 },
  { kind: 'bench', x0: 7,  z0: 27, x1: 12, z1: 27, h: 0.9 },
  // Calle: el autobús de TranZit, autos y barriles
  { kind: 'bus',    x0: 36, z0: 24, x1: 45, z1: 26, h: 3.2 },
  { kind: 'car',    x0: 23, z0: 27, x1: 26, z1: 28, h: 1.5 },
  { kind: 'car',    x0: 49, z0: 22, x1: 52, z1: 23, h: 1.5 },
  { kind: 'barrel', x0: 33, z0: 28, x1: 34, z1: 28, h: 1.1 },
  // Bar: barra y mesas
  { kind: 'counter', x0: 7, z0: 9,  x1: 14, z1: 9,  h: 1.1 },
  { kind: 'table',   x0: 7, z0: 13, x1: 7,  z1: 13, h: 0.8 },
  { kind: 'table',   x0: 11, z0: 13, x1: 11, z1: 13, h: 0.8 },
  { kind: 'table',   x0: 14, z0: 15, x1: 14, z1: 15, h: 0.8 },
  { kind: 'table',   x0: 8,  z0: 16, x1: 8,  z1: 16, h: 0.8 },
  // Almacén: cajas apiladas
  { kind: 'crate', x0: 22, z0: 9,  x1: 23, z1: 10, h: 1.3 },
  { kind: 'crate', x0: 30, z0: 9,  x1: 31, z1: 10, h: 1.3 },
  { kind: 'crate', x0: 25, z0: 14, x1: 26, z1: 15, h: 1.3 },
  { kind: 'crate', x0: 33, z0: 15, x1: 34, z1: 16, h: 1.3 },
  // Planta eléctrica: generadores y transformador
  { kind: 'generator', x0: 44, z0: 10, x1: 46, z1: 12, h: 2.0 },
  { kind: 'generator', x0: 49, z0: 14, x1: 50, z1: 15, h: 2.0 },
];

// Armas de pared (dibujos de tiza). (x, z) = celda de suelo frente al muro; wall = lado donde está el muro.
export const WALLBUYS = [
  { id: 'wb0', weapon: 'm14',     x: 6,  z: 20, wall: 'N' },
  { id: 'wb1', weapon: 'olympia', x: 17, z: 29, wall: 'E' },
  { id: 'wb2', weapon: 'mp5',     x: 35, z: 20, wall: 'N' },
  { id: 'wb3', weapon: 'b23r',    x: 44, z: 31, wall: 'S' },
  { id: 'wb4', weapon: 'r870',    x: 15, z: 5,  wall: 'N' },
  { id: 'wb5', weapon: 'bowie',   x: 4,  z: 16, wall: 'W' },
  { id: 'wb6', weapon: 'ak74u',   x: 21, z: 18, wall: 'S' },
  { id: 'wb7', weapon: 'm16',     x: 40, z: 18, wall: 'S' },
  // armas cuerpo a cuerpo
  { id: 'wb8', weapon: 'bat',     x: 4,  z: 26, wall: 'W' },
  { id: 'wb9', weapon: 'machete', x: 31, z: 18, wall: 'S' },
  { id: 'wb10', weapon: 'axe',    x: 50, z: 5,  wall: 'N' },
];

// Armarios de primeros auxilios (en la pared, no sólidos). (x, z) = celda de suelo frente al muro; item = cura que venden.
export const MED_CABINETS = [
  { id: 0, item: 'bandage',  x: 13, z: 20, wall: 'N' },   // Terminal
  { id: 1, item: 'antidote', x: 17, z: 14, wall: 'E' },   // Bar
  { id: 2, item: 'medkit',   x: 36, z: 7,  wall: 'E' },   // Almacén
];

// Máquinas de ventajas: ocupan una celda (sólida). face = hacia dónde mira el frente (donde se para el jugador).
export const PERK_MACHINES = [
  { perk: 'quickrevive', x: 16, z: 20, face: 'S' },
  { perk: 'speedcola',   x: 4,  z: 7,  face: 'E' },
  { perk: 'doubletap',   x: 19, z: 6,  face: 'E' },
  { perk: 'mulekick',    x: 36, z: 17, face: 'W' },
  { perk: 'staminup',    x: 54, z: 30, face: 'W' },
  { perk: 'juggernog',   x: 54, z: 16, face: 'W' },
];

// Pack-a-Punch (2 celdas), requiere electricidad.
export const PAP_MACHINE = { x0: 41, z0: 5, x1: 42, z1: 5, face: 'S' };

// Palanca de la electricidad (en el muro). (x, z) = celda de suelo frente al muro.
export const POWER_SWITCH = { x: 54, z: 7, wall: 'E' };

// Mesa de construcción del escudo (2 celdas).
export const WORKBENCH = { x0: 32, z0: 31, x1: 33, z1: 31, face: 'N' };

// Ubicaciones de la caja misteriosa (2 celdas cada una). La 0 es la inicial.
export const BOX_LOCATIONS = [
  { id: 0, x0: 22, z0: 20, x1: 23, z1: 20, face: 'S', zone: 1 },
  { id: 1, x0: 4,  z0: 13, x1: 4,  z1: 14, face: 'E', zone: 2 },
  { id: 2, x0: 27, z0: 5,  x1: 28, z1: 5,  face: 'S', zone: 3 },
  { id: 3, x0: 38, z0: 15, x1: 38, z1: 16, face: 'E', zone: 4 },
];
export const BOX_START = 0;

// Piezas del escudo (objetos en el suelo, no sólidos).
export const SHIELD_PARTS = [
  { id: 0, name: 'Puerta de auto',  x: 12, z: 6,  zone: 2 },
  { id: 1, name: 'Carretilla',      x: 30, z: 13, zone: 3 },
  { id: 2, name: 'Asa de metal',    x: 51, z: 6,  zone: 4 },
];

// Puntos de aparición de jugadores (coordenadas de mundo), en la Terminal.
export const PLAYER_SPAWNS = [
  { x: 6.5, z: 29.5 },
  { x: 9.5, z: 29.5 },
  { x: 12.5, z: 29.5 },
  { x: 15.5, z: 29.5 },
];
// Yaw inicial de los jugadores (mirando al norte)
export const PLAYER_SPAWN_YAW = 0;

// ---------------------------------------------------------------------------
// Construcción de la cuadrícula
// ---------------------------------------------------------------------------

export const cellType = new Uint8Array(W * H);         // C.*
export const cellZone = new Int8Array(W * H).fill(-1);  // id de zona (-1 si no aplica)
export const cellHeight = new Float32Array(W * H);     // altura de PROP (para balas/granadas)
export const cellWallKind = new Uint8Array(W * H);     // WALL_KIND.* para celdas WALL
export const cellDoor = new Array(W * H).fill(null);   // id de puerta para celdas DOOR
export const cellWindow = new Int16Array(W * H).fill(-1); // id de ventana para celdas WINDOW/OUTSIDE (callejón)

export function idx(x, z) { return z * W + x; }
export function inBounds(x, z) { return x >= 0 && z >= 0 && x < W && z < H; }
export function typeAt(x, z) { return inBounds(x, z) ? cellType[idx(x, z)] : C.VOID; }
export function zoneAt(x, z) { return inBounds(x, z) ? cellZone[idx(x, z)] : -1; }

function setCell(x, z, t) { if (inBounds(x, z)) cellType[idx(x, z)] = t; }

// Datos derivados de cada ventana
export const WINDOW_INFO = WINDOWS.map((w) => {
  const d = DIRS[w.dir];
  return {
    ...w,
    // celda exterior pegada a la ventana (donde el zombi arranca las tablas)
    tear: [w.x + d.dx, w.z + d.dz],
    // celda interior donde cae el zombi al cruzar
    land: [w.x - d.dx, w.z - d.dz],
    // celda del fondo del callejón donde aparece el zombi
    spawn: [w.x + d.dx * 3, w.z + d.dz * 3],
    // centro de la ventana en mundo
    cx: w.x + 0.5,
    cz: w.z + 0.5,
    // celdas del callejón (3x3)
    pocket: (() => {
      const cells = [];
      for (let depth = 1; depth <= 3; depth++) {
        for (let side = -1; side <= 1; side++) {
          const px = w.x + d.dx * depth + (d.dx === 0 ? side : 0);
          const pz = w.z + d.dz * depth + (d.dz === 0 ? side : 0);
          cells.push([px, pz]);
        }
      }
      return cells;
    })(),
  };
});

function build() {
  // 1) Suelo de zonas
  for (const zn of ZONES) {
    for (let z = zn.z0; z <= zn.z1; z++) {
      for (let x = zn.x0; x <= zn.x1; x++) {
        setCell(x, z, C.FLOOR);
        cellZone[idx(x, z)] = zn.id;
      }
    }
  }
  // 2) Muros automáticos: toda celda vacía 8-adyacente a suelo de zona
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      if (cellType[idx(x, z)] !== C.VOID) continue;
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (typeAt(x + dx, z + dz) === C.FLOOR && zoneAt(x + dx, z + dz) >= 0) { near = true; break; }
        }
      }
      if (near) { setCell(x, z, C.WALL); cellWallKind[idx(x, z)] = WALL_KIND.BUILDING; }
    }
  }
  // 3) Puertas
  for (const d of DOORS) {
    for (const [x, z] of d.cells) {
      setCell(x, z, C.DOOR);
      cellDoor[idx(x, z)] = d.id;
      cellZone[idx(x, z)] = d.zones[0];
    }
  }
  // 4) Ventanas y callejones exteriores
  for (const w of WINDOW_INFO) {
    setCell(w.x, w.z, C.WINDOW);
    cellWindow[idx(w.x, w.z)] = w.id;
    cellZone[idx(w.x, w.z)] = w.zone;
    for (const [px, pz] of w.pocket) {
      setCell(px, pz, C.OUTSIDE);
      cellWindow[idx(px, pz)] = w.id;
    }
  }
  // 5) Vallas alrededor de los callejones (celdas vacías adyacentes a OUTSIDE)
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      if (cellType[idx(x, z)] !== C.VOID) continue;
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (typeAt(x + dx, z + dz) === C.OUTSIDE) { near = true; break; }
        }
      }
      if (near) { setCell(x, z, C.WALL); cellWallKind[idx(x, z)] = WALL_KIND.FENCE; }
    }
  }
  // 6) Obstáculos (props decorativos + máquinas + caja + mesa + PaP)
  const solidRect = (x0, z0, x1, z1, h) => {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        setCell(x, z, C.PROP);
        cellHeight[idx(x, z)] = Math.max(cellHeight[idx(x, z)], h);
      }
    }
  };
  for (const p of PROPS) solidRect(p.x0, p.z0, p.x1, p.z1, p.h);
  for (const m of PERK_MACHINES) solidRect(m.x, m.z, m.x, m.z, 2.3);
  solidRect(PAP_MACHINE.x0, PAP_MACHINE.z0, PAP_MACHINE.x1, PAP_MACHINE.z1, 1.6);
  solidRect(WORKBENCH.x0, WORKBENCH.z0, WORKBENCH.x1, WORKBENCH.z1, 1.0);
  for (const b of BOX_LOCATIONS) solidRect(b.x0, b.z0, b.x1, b.z1, 1.0);
}
build();

// ---------------------------------------------------------------------------
// Interactuables: lista única que usan servidor (validación) y cliente (avisos en pantalla)
// ---------------------------------------------------------------------------
// Cada interactuable: { id, kind, x, z (punto de mundo donde se para el jugador / centro de la interacción), y, ...extra }
// kinds: 'door' | 'wallbuy' | 'perk' | 'pap' | 'power' | 'box' | 'bench' | 'part' | 'window'
// Ids: 'door:A', 'wall:wb0', 'perk:juggernog', 'pap', 'power', 'box:0'..'box:3', 'bench', 'part:0'..'part:2', 'win:0'..'win:12',
//      'med:bandage' | 'med:antidote' | 'med:medkit'

function frontOfRect(x0, z0, x1, z1, face) {
  const d = DIRS[face];
  const cx = (x0 + x1 + 1) / 2;
  const cz = (z0 + z1 + 1) / 2;
  const hx = (x1 - x0 + 1) / 2;
  const hz = (z1 - z0 + 1) / 2;
  return { x: cx + d.dx * (hx + 0.55), z: cz + d.dz * (hz + 0.55), cx, cz };
}

export const INTERACTABLES = (() => {
  const list = [];
  for (const d of DOORS) {
    const xs = d.cells.map((c) => c[0] + 0.5);
    const zs = d.cells.map((c) => c[1] + 0.5);
    const x = xs.reduce((a, b) => a + b, 0) / xs.length;
    const z = zs.reduce((a, b) => a + b, 0) / zs.length;
    list.push({ id: `door:${d.id}`, kind: 'door', door: d.id, x, z, y: 1.2, range: 2.6 });
  }
  for (const wb of WALLBUYS) {
    const d = DIRS[wb.wall];
    list.push({
      id: `wall:${wb.id}`, kind: 'wallbuy', wallbuy: wb.id, weapon: wb.weapon,
      x: wb.x + 0.5, z: wb.z + 0.5, y: 1.5,
      // punto sobre la superficie del muro donde va el dibujo de tiza
      wx: wb.x + 0.5 + d.dx * 0.5, wz: wb.z + 0.5 + d.dz * 0.5, wall: wb.wall,
      range: 1.9,
    });
  }
  for (const mc of MED_CABINETS) {
    const d = DIRS[mc.wall];
    list.push({
      id: `med:${mc.item}`, kind: 'med', item: mc.item, cabinet: mc.id,
      x: mc.x + 0.5, z: mc.z + 0.5, y: 1.4,
      wx: mc.x + 0.5 + d.dx * 0.5, wz: mc.z + 0.5 + d.dz * 0.5, wall: mc.wall,
      range: 1.9,
    });
  }
  for (const m of PERK_MACHINES) {
    const f = frontOfRect(m.x, m.z, m.x, m.z, m.face);
    list.push({ id: `perk:${m.perk}`, kind: 'perk', perk: m.perk, x: f.x, z: f.z, y: 1.3, cx: f.cx, cz: f.cz, face: m.face, range: 1.9 });
  }
  {
    const f = frontOfRect(PAP_MACHINE.x0, PAP_MACHINE.z0, PAP_MACHINE.x1, PAP_MACHINE.z1, PAP_MACHINE.face);
    list.push({ id: 'pap', kind: 'pap', x: f.x, z: f.z, y: 1.2, cx: f.cx, cz: f.cz, face: PAP_MACHINE.face, range: 2.0 });
  }
  {
    const d = DIRS[POWER_SWITCH.wall];
    list.push({
      id: 'power', kind: 'power', x: POWER_SWITCH.x + 0.5, z: POWER_SWITCH.z + 0.5, y: 1.4,
      wx: POWER_SWITCH.x + 0.5 + d.dx * 0.5, wz: POWER_SWITCH.z + 0.5 + d.dz * 0.5, wall: POWER_SWITCH.wall, range: 1.9,
    });
  }
  for (const b of BOX_LOCATIONS) {
    const f = frontOfRect(b.x0, b.z0, b.x1, b.z1, b.face);
    list.push({ id: `box:${b.id}`, kind: 'box', box: b.id, x: f.x, z: f.z, y: 1.1, cx: f.cx, cz: f.cz, face: b.face, range: 2.0 });
  }
  {
    const f = frontOfRect(WORKBENCH.x0, WORKBENCH.z0, WORKBENCH.x1, WORKBENCH.z1, WORKBENCH.face);
    list.push({ id: 'bench', kind: 'bench', x: f.x, z: f.z, y: 1.0, cx: f.cx, cz: f.cz, face: WORKBENCH.face, range: 2.0 });
  }
  for (const p of SHIELD_PARTS) {
    list.push({ id: `part:${p.id}`, kind: 'part', part: p.id, x: p.x + 0.5, z: p.z + 0.5, y: 0.4, range: 1.7 });
  }
  for (const w of WINDOW_INFO) {
    list.push({ id: `win:${w.id}`, kind: 'window', window: w.id, x: w.land[0] + 0.5, z: w.land[1] + 0.5, y: 1.2, cx: w.cx, cz: w.cz, range: 1.9 });
  }
  return list;
})();

export const INTERACTABLE_BY_ID = Object.fromEntries(INTERACTABLES.map((i) => [i.id, i]));

// Devuelve la ventana cuyo callejón contiene la celda (o -1)
export function pocketWindowAt(x, z) {
  if (!inBounds(x, z)) return -1;
  return cellType[idx(x, z)] === C.OUTSIDE ? cellWindow[idx(x, z)] : -1;
}

// Representación ASCII (para depurar)
export function toAscii(doorsOpen = {}) {
  const ch = { [C.VOID]: ' ', [C.FLOOR]: '.', [C.WALL]: '#', [C.WINDOW]: 'W', [C.OUTSIDE]: 'o', [C.PROP]: 'x' };
  const rows = [];
  for (let z = 0; z < H; z++) {
    let r = '';
    for (let x = 0; x < W; x++) {
      const t = cellType[idx(x, z)];
      if (t === C.DOOR) r += doorsOpen[cellDoor[idx(x, z)]] ? '_' : cellDoor[idx(x, z)];
      else if (t === C.WALL && cellWallKind[idx(x, z)] === WALL_KIND.FENCE) r += '%';
      else if (t === C.FLOOR) r += String(cellZone[idx(x, z)]);
      else r += ch[t];
    }
    rows.push(r);
  }
  return rows.join('\n');
}
