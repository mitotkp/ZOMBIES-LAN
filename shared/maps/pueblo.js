// Definición del mapa "Pueblo Olvidado" (inspirado en Town/TranZit de BO2, diseño original).
// Solo datos: shared/mapcore.js construye la cuadrícula. Coordenadas en celdas de 1 m (ver mapcore.js).

export default {
  id: 'pueblo',
  name: 'Pueblo Olvidado',
  theme: 'pueblo',
  W: 59,
  H: 36,
  wallH: 4.0,     // altura de muros de edificios
  fenceH: 2.6,    // altura de los muros/vallas de los callejones exteriores
  ceilH: 4.0,     // altura de techo de zonas interiores
  levels: [{ y: 0, h: 4.0 }],
  zones: [
    { id: 0, key: 'terminal', name: 'Terminal', indoor: true,  x0: 4,  z0: 20, x1: 17, z1: 31 },
    { id: 1, key: 'calle',    name: 'Calle',    indoor: false, x0: 19, z0: 20, x1: 54, z1: 31 },
    { id: 2, key: 'bar',      name: 'Bar',      indoor: true,  x0: 4,  z0: 5,  x1: 17, z1: 18 },
    { id: 3, key: 'almacen',  name: 'Almacén',  indoor: true,  x0: 19, z0: 5,  x1: 36, z1: 18 },
    { id: 4, key: 'planta',   name: 'Planta Eléctrica', indoor: true, x0: 38, z0: 5, x1: 54, z1: 18 },
  ],
  startZone: 0,
  // Puertas: cells = celdas de muro que se abren. kind: 'door' (puerta metálica) | 'debris' (escombros)
  doors: [
    { id: 'A', cost: 750,  zones: [0, 1], kind: 'door',   cells: [[18, 25], [18, 26]] },
    { id: 'B', cost: 750,  zones: [0, 2], kind: 'debris', cells: [[10, 19], [11, 19]] },
    { id: 'C', cost: 1000, zones: [1, 3], kind: 'door',   cells: [[27, 19], [28, 19]] },
    { id: 'D', cost: 1000, zones: [2, 3], kind: 'door',   cells: [[18, 11], [18, 12]] },
    { id: 'E', cost: 1250, zones: [3, 4], kind: 'door',   cells: [[37, 11], [37, 12]] },
    { id: 'F', cost: 1250, zones: [1, 4], kind: 'debris', cells: [[46, 19], [47, 19]] },
  ],
  // Ventanas con barricada. (x, z) = celda del muro; dir = hacia dónde está el exterior.
  windows: [
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
  ],
  // Obstáculos decorativos sólidos (rectángulos de celdas inclusivos) con altura para balas/granadas.
  props: [
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
  ],
  // Armas de pared. (x, z) = celda de suelo frente al muro; wall = lado donde está el muro.
  wallbuys: [
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
  ],
  // Armarios de primeros auxilios. (x, z) = celda de suelo frente al muro; item = cura que venden.
  medCabinets: [
    { id: 0, item: 'bandage',  x: 13, z: 20, wall: 'N' },   // Terminal
    { id: 1, item: 'antidote', x: 17, z: 14, wall: 'E' },   // Bar
    { id: 2, item: 'medkit',   x: 36, z: 7,  wall: 'E' },   // Almacén
  ],
  // Máquinas de ventajas (1 celda sólida). face = hacia dónde mira el frente.
  perkMachines: [
    { perk: 'quickrevive', x: 16, z: 20, face: 'S' },
    { perk: 'speedcola',   x: 4,  z: 7,  face: 'E' },
    { perk: 'doubletap',   x: 19, z: 6,  face: 'E' },
    { perk: 'mulekick',    x: 36, z: 17, face: 'W' },
    { perk: 'staminup',    x: 54, z: 30, face: 'W' },
    { perk: 'juggernog',   x: 54, z: 16, face: 'W' },
  ],
  pap: { x0: 41, z0: 5, x1: 42, z1: 5, face: 'S' },
  powerSwitch: { x: 54, z: 7, wall: 'E' },
  workbench: { x0: 32, z0: 31, x1: 33, z1: 31, face: 'N' },
  // Ubicaciones de la caja misteriosa (2 celdas cada una). La 0 es la inicial.
  boxLocations: [
    { id: 0, x0: 22, z0: 20, x1: 23, z1: 20, face: 'S', zone: 1 },
    { id: 1, x0: 4,  z0: 13, x1: 4,  z1: 14, face: 'E', zone: 2 },
    { id: 2, x0: 27, z0: 5,  x1: 28, z1: 5,  face: 'S', zone: 3 },
    { id: 3, x0: 38, z0: 15, x1: 38, z1: 16, face: 'E', zone: 4 },
  ],
  boxStart: 0,
  shieldParts: [
    { id: 0, name: 'Puerta de auto',  x: 12, z: 6,  zone: 2 },
    { id: 1, name: 'Carretilla',      x: 30, z: 13, zone: 3 },
    { id: 2, name: 'Asa de metal',    x: 51, z: 6,  zone: 4 },
  ],
  // Puntos de aparición de jugadores (coordenadas de mundo), en la Terminal.
  playerSpawns: [
    { x: 6.5, z: 29.5 },
    { x: 9.5, z: 29.5 },
    { x: 12.5, z: 29.5 },
    { x: 15.5, z: 29.5 },
  ],
  spawnYaw: 0,
};
