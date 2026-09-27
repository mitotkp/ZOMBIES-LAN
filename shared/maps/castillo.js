// Definición del mapa "Castillo Vorkhaus": castillo victoriano de varias plantas. Solo datos: shared/mapcore.js
// construye la cuadrícula y public/js/world/castle/ la geometría.
//
// Plantas: 0 = sótano (laboratorio, criptas, bodega), 1 = planta baja (patio de inicio, vestíbulo, alas),
//          2 = primer piso (galería, dormitorios, estudio, ala norte, sala del Pack-a-Punch, balcón),
//          3 = salón de baile (solo se abre al completar el easter egg).
// Las coordenadas se escriben sin margen y se desplazan O celdas para dejar sitio a los callejones de las ventanas.

const O = 4;

const RAW = {
  id: 'castillo',
  name: 'Castillo Vorkhaus',
  desc: 'Castillo victoriano de tres plantas con laboratorio en el sótano.',
  theme: 'castillo',
  W: 64 + 2 * O,
  H: 64 + 2 * O,
  levels: [
    { y: -4.5, h: 4.5, name: 'Sótano' },
    { y: 0, h: 4.5, name: 'Planta baja' },
    { y: 4.5, h: 4.5, name: 'Primer piso' },
    { y: 9, h: 6.5, name: 'Salón de baile' },
  ],
  zones: [
    // Planta baja
    { id: 0, key: 'patio', name: 'Patio', indoor: false, lv: 1, x0: 12, z0: 42, x1: 51, z1: 58 },
    { id: 1, key: 'vestibulo', name: 'Vestíbulo', indoor: true, lv: 1, x0: 22, z0: 20, x1: 41, z1: 40, ceil: 9 },
    { id: 2, key: 'biblioteca', name: 'Biblioteca', indoor: true, lv: 1, x0: 3, z0: 20, x1: 20, z1: 40 },
    { id: 3, key: 'comedor', name: 'Comedor', indoor: true, lv: 1, x0: 43, z0: 20, x1: 60, z1: 40 },
    { id: 4, key: 'cocina', name: 'Cocina', indoor: true, lv: 1, x0: 3, z0: 3, x1: 20, z1: 18 },
    { id: 5, key: 'musica', name: 'Sala de Música', indoor: true, lv: 1, x0: 22, z0: 3, x1: 41, z1: 18 },
    { id: 6, key: 'invernadero', name: 'Invernadero', indoor: true, lv: 1, x0: 43, z0: 3, x1: 60, z1: 18 },
    // Primer piso
    { id: 7, key: 'galeria', name: 'Galería', indoor: true, lv: 2, x0: 22, z0: 20, x1: 41, z1: 40 },
    { id: 8, key: 'dormitorios', name: 'Dormitorios', indoor: true, lv: 2, x0: 3, z0: 20, x1: 20, z1: 40 },
    { id: 9, key: 'estudio', name: 'Estudio del Conde', indoor: true, lv: 2, x0: 43, z0: 20, x1: 60, z1: 40 },
    { id: 10, key: 'alanorte', name: 'Ala Norte', indoor: true, lv: 2, x0: 22, z0: 3, x1: 41, z1: 18 },
    { id: 11, key: 'cronos', name: 'Cámara del Tiempo', indoor: true, lv: 2, x0: 45, z0: 5, x1: 57, z1: 15 },
    { id: 12, key: 'balcon', name: 'Balcón', indoor: false, lv: 2, x0: 24, z0: 42, x1: 39, z1: 44 },
    // Salón de baile
    { id: 13, key: 'salon', name: 'Salón de Baile', indoor: true, lv: 3, x0: 16, z0: 3, x1: 47, z1: 30 },
    // Sótano
    { id: 14, key: 'laboratorio', name: 'Laboratorio', indoor: true, lv: 0, x0: 18, z0: 3, x1: 45, z1: 21 },
    { id: 15, key: 'criptas', name: 'Criptas', indoor: true, lv: 0, x0: 3, z0: 3, x1: 16, z1: 21 },
    { id: 16, key: 'bodega', name: 'Bodega', indoor: true, lv: 0, x0: 47, z0: 3, x1: 60, z1: 21 },
  ],
  startZone: 0,
  // Escaleras: pertenecen a la planta de abajo (lv) y suben en la dirección dir
  stairs: [
    { id: 'imp_o', lv: 1, x0: 23, z0: 27, x1: 24, z1: 32, dir: 'N', zone: 1, style: 'grand' },   // imperial oeste
    { id: 'imp_e', lv: 1, x0: 39, z0: 27, x1: 40, z1: 32, dir: 'N', zone: 1, style: 'grand' },   // imperial este
    { id: 'lab', lv: 0, x0: 30, z0: 22, x1: 33, z1: 27, dir: 'S', zone: 1, style: 'stone' },    // vestíbulo ↔ laboratorio (reja T al pie)
    { id: 'serv_o', lv: 1, x0: 4, z0: 34, x1: 5, z1: 39, dir: 'N', zone: 2, style: 'wood' },    // servicio oeste
    { id: 'serv_e', lv: 1, x0: 58, z0: 34, x1: 59, z1: 39, dir: 'N', zone: 3, style: 'wood' },  // servicio este
    { id: 'tramp_o', lv: 0, x0: 5, z0: 22, x1: 6, z1: 27, dir: 'S', zone: 15, style: 'stone' }, // criptas ↔ biblioteca
    { id: 'tramp_e', lv: 0, x0: 57, z0: 22, x1: 58, z1: 27, dir: 'S', zone: 16, style: 'stone' }, // bodega ↔ comedor
    { id: 'salon', lv: 2, x0: 30, z0: 5, x1: 33, z1: 10, dir: 'N', zone: 10, style: 'grand' },  // ala norte ↔ salón
  ],
  // Huecos en el suelo (el vestíbulo es de doble altura: la galería lo rodea)
  holes: [
    { lv: 2, x0: 26, z0: 23, x1: 37, z1: 38 },
  ],
  // Arcos sin puerta
  openings: [
    { lv: 2, zone: 12, cells: [[30, 41], [31, 41], [32, 41], [33, 41]] },   // galería → balcón
  ],
  // Tabiques explícitos: laterales de la escalera del salón (impiden subir por el costado)
  walls: [
    // pilares de la reja del laboratorio (prolongan los muros del túnel de la escalera)
    { lv: 0, x0: 29, z0: 21, x1: 29, z1: 21 },
    { lv: 0, x0: 34, z0: 21, x1: 34, z1: 21 },
    { lv: 2, x0: 29, z0: 4, x1: 29, z1: 10 },
    { lv: 2, x0: 34, z0: 4, x1: 34, z1: 10 },
  ],
  doors: [
    { id: 'A', cost: 750, zones: [0, 1], kind: 'gate', lv: 1, cells: [[31, 41], [32, 41]] },
    { id: 'B', cost: 750, zones: [0, 2], kind: 'door', lv: 1, cells: [[15, 41], [16, 41]] },
    { id: 'C', cost: 750, zones: [0, 3], kind: 'door', lv: 1, cells: [[47, 41], [48, 41]] },
    { id: 'D', cost: 1000, zones: [1, 2], kind: 'door', lv: 1, cells: [[21, 33], [21, 34]] },
    { id: 'E', cost: 1000, zones: [1, 3], kind: 'door', lv: 1, cells: [[42, 33], [42, 34]] },
    { id: 'F', cost: 1000, zones: [1, 5], kind: 'door', lv: 1, cells: [[24, 19], [25, 19]] },
    { id: 'G', cost: 1000, zones: [2, 4], kind: 'debris', lv: 1, cells: [[10, 19], [11, 19]] },
    { id: 'H', cost: 1000, zones: [3, 6], kind: 'debris', lv: 1, cells: [[52, 19], [53, 19]] },
    { id: 'I', cost: 1000, zones: [5, 4], kind: 'door', lv: 1, cells: [[21, 10], [21, 11]] },
    { id: 'J', cost: 1000, zones: [5, 6], kind: 'door', lv: 1, cells: [[42, 10], [42, 11]] },
    { id: 'T', cost: 1250, zones: [1, 14], kind: 'gate', lv: 0, cells: [[30, 21], [31, 21], [32, 21], [33, 21]] },   // al pie de la escalera del laboratorio
    { id: 'K', cost: 1250, zones: [14, 15], kind: 'gate', lv: 0, cells: [[17, 11], [17, 12]] },
    { id: 'L', cost: 1250, zones: [14, 16], kind: 'gate', lv: 0, cells: [[46, 11], [46, 12]] },
    { id: 'M', cost: 1250, zones: [7, 8], kind: 'door', lv: 2, cells: [[21, 30], [21, 31]] },
    { id: 'N', cost: 1250, zones: [7, 9], kind: 'door', lv: 2, cells: [[42, 30], [42, 31]] },
    { id: 'P', cost: 1500, zones: [7, 10], kind: 'door', lv: 2, cells: [[24, 19], [25, 19]] },
    // Puerta sellada del salón de baile: solo la abre el easter egg (no se puede comprar)
    { id: 'S', cost: 0, sealed: true, zones: [10, 13], kind: 'sealed', lv: 2, cells: [[30, 11], [31, 11], [32, 11], [33, 11]] },
  ],
  // Ventanas con barricada. (x, z) = celda del muro; dir = hacia dónde está el exterior.
  windows: [
    // Patio (verja de hierro)
    { id: 0, x: 18, z: 59, dir: 'S', zone: 0, lv: 1 },
    { id: 1, x: 31, z: 59, dir: 'S', zone: 0, lv: 1 },
    { id: 2, x: 44, z: 59, dir: 'S', zone: 0, lv: 1 },
    { id: 3, x: 11, z: 48, dir: 'W', zone: 0, lv: 1 },
    { id: 4, x: 11, z: 55, dir: 'W', zone: 0, lv: 1 },
    { id: 5, x: 52, z: 48, dir: 'E', zone: 0, lv: 1 },
    { id: 6, x: 52, z: 55, dir: 'E', zone: 0, lv: 1 },
    // Planta baja
    { id: 7, x: 2, z: 25, dir: 'W', zone: 2, lv: 1 },
    { id: 8, x: 2, z: 30, dir: 'W', zone: 2, lv: 1 },
    { id: 9, x: 61, z: 25, dir: 'E', zone: 3, lv: 1 },
    { id: 10, x: 61, z: 30, dir: 'E', zone: 3, lv: 1 },
    { id: 11, x: 2, z: 10, dir: 'W', zone: 4, lv: 1 },
    { id: 12, x: 12, z: 2, dir: 'N', zone: 4, lv: 1 },
    { id: 13, x: 27, z: 2, dir: 'N', zone: 5, lv: 1 },
    { id: 14, x: 36, z: 2, dir: 'N', zone: 5, lv: 1 },
    { id: 15, x: 61, z: 10, dir: 'E', zone: 6, lv: 1 },
    { id: 16, x: 51, z: 2, dir: 'N', zone: 6, lv: 1 },
    // Primer piso
    { id: 17, x: 2, z: 26, dir: 'W', zone: 8, lv: 2 },
    { id: 18, x: 2, z: 37, dir: 'W', zone: 8, lv: 2 },
    { id: 19, x: 61, z: 26, dir: 'E', zone: 9, lv: 2 },
    { id: 20, x: 61, z: 37, dir: 'E', zone: 9, lv: 2 },
    { id: 21, x: 26, z: 2, dir: 'N', zone: 10, lv: 2 },
    { id: 22, x: 38, z: 2, dir: 'N', zone: 10, lv: 2 },
    // Sótano
    { id: 23, x: 2, z: 8, dir: 'W', zone: 15, lv: 0 },
    { id: 24, x: 2, z: 16, dir: 'W', zone: 15, lv: 0 },
    { id: 25, x: 9, z: 2, dir: 'N', zone: 15, lv: 0 },
    { id: 26, x: 61, z: 8, dir: 'E', zone: 16, lv: 0 },
    { id: 27, x: 61, z: 16, dir: 'E', zone: 16, lv: 0 },
    { id: 28, x: 54, z: 2, dir: 'N', zone: 16, lv: 0 },
    { id: 29, x: 24, z: 2, dir: 'N', zone: 14, lv: 0 },
    { id: 30, x: 39, z: 2, dir: 'N', zone: 14, lv: 0 },
    // Salón de baile (vidrieras: los vampiros y los zombis entran desde los tejados)
    { id: 31, x: 15, z: 12, dir: 'W', zone: 13, lv: 3 },
    { id: 32, x: 15, z: 23, dir: 'W', zone: 13, lv: 3 },
    { id: 33, x: 48, z: 12, dir: 'E', zone: 13, lv: 3 },
    { id: 34, x: 48, z: 23, dir: 'E', zone: 13, lv: 3 },
    { id: 35, x: 23, z: 31, dir: 'S', zone: 13, lv: 3 },
    { id: 36, x: 40, z: 31, dir: 'S', zone: 13, lv: 3 },
  ],
  // Obstáculos sólidos con altura (h, sobre el suelo de su planta)
  props: [
    // Patio: fuente, setos, bancos y estatuas
    { kind: 'fountain', lv: 1, x0: 29, z0: 48, x1: 34, z1: 52, h: 1.1 },
    { kind: 'hedge', lv: 1, x0: 15, z0: 45, x1: 22, z1: 45, h: 1.3 },
    { kind: 'hedge', lv: 1, x0: 41, z0: 45, x1: 48, z1: 45, h: 1.3 },
    { kind: 'hedge', lv: 1, x0: 15, z0: 53, x1: 22, z1: 53, h: 1.3 },
    { kind: 'hedge', lv: 1, x0: 41, z0: 53, x1: 48, z1: 53, h: 1.3 },
    { kind: 'statue', lv: 1, x0: 24, z0: 49, x1: 24, z1: 49, h: 2.6 },
    { kind: 'statue', lv: 1, x0: 39, z0: 49, x1: 39, z1: 49, h: 2.6 },
    { kind: 'bench_iron', lv: 1, x0: 26, z0: 55, x1: 28, z1: 55, h: 0.9 },
    { kind: 'bench_iron', lv: 1, x0: 35, z0: 55, x1: 37, z1: 55, h: 0.9 },
    { kind: 'carriage', lv: 1, x0: 45, z0: 49, x1: 48, z1: 51, h: 2.4 },
    // Vestíbulo: armaduras junto a la entrada
    { kind: 'armor', lv: 1, x0: 28, z0: 39, x1: 28, z1: 39, h: 2.0 },
    { kind: 'armor', lv: 1, x0: 35, z0: 39, x1: 35, z1: 39, h: 2.0 },
    // Biblioteca: estanterías y mesa de lectura
    { kind: 'shelf', lv: 1, x0: 8, z0: 23, x1: 17, z1: 23, h: 2.6 },
    { kind: 'shelf', lv: 1, x0: 8, z0: 29, x1: 17, z1: 29, h: 2.6 },
    { kind: 'shelf', lv: 1, x0: 8, z0: 35, x1: 15, z1: 35, h: 2.6 },
    { kind: 'desk', lv: 1, x0: 11, z0: 32, x1: 13, z1: 32, h: 0.85 },
    // Comedor: mesa larga y aparador
    { kind: 'dining', lv: 1, x0: 47, z0: 28, x1: 56, z1: 30, h: 0.85 },
    { kind: 'sideboard', lv: 1, x0: 47, z0: 20, x1: 51, z1: 20, h: 1.2 },
    // Cocina: fogones y mesas de trabajo
    { kind: 'stove', lv: 1, x0: 6, z0: 3, x1: 10, z1: 3, h: 1.1 },
    { kind: 'worktable', lv: 1, x0: 8, z0: 9, x1: 14, z1: 10, h: 0.95 },
    // Sala de música: piano y arpa
    { kind: 'piano', lv: 1, x0: 25, z0: 7, x1: 27, z1: 8, h: 1.1 },
    { kind: 'harp', lv: 1, x0: 37, z0: 7, x1: 37, z1: 7, h: 1.9 },
    // Invernadero: arriates
    { kind: 'planter', lv: 1, x0: 47, z0: 7, x1: 49, z1: 14, h: 0.8 },
    { kind: 'planter', lv: 1, x0: 54, z0: 7, x1: 56, z1: 14, h: 0.8 },
    // Dormitorios: camas
    { kind: 'bed', lv: 2, x0: 7, z0: 21, x1: 9, z1: 23, h: 0.8 },
    { kind: 'bed', lv: 2, x0: 14, z0: 21, x1: 16, z1: 23, h: 0.8 },
    { kind: 'wardrobe', lv: 2, x0: 17, z0: 38, x1: 19, z1: 38, h: 2.3 },
    // Estudio: escritorio del conde y globo terráqueo
    { kind: 'desk', lv: 2, x0: 50, z0: 30, x1: 53, z1: 31, h: 0.85 },
    { kind: 'globe', lv: 2, x0: 56, z0: 25, x1: 56, z1: 25, h: 1.3 },
    // Ala norte: vitrinas
    { kind: 'cabinet', lv: 2, x0: 23, z0: 3, x1: 24, z1: 3, h: 2.0 },
    { kind: 'cabinet', lv: 2, x0: 39, z0: 3, x1: 40, z1: 3, h: 2.0 },
    // Salón de baile: columnas
    { kind: 'pillar', lv: 3, x0: 21, z0: 8, x1: 21, z1: 8, h: 6.5 },
    { kind: 'pillar', lv: 3, x0: 42, z0: 8, x1: 42, z1: 8, h: 6.5 },
    { kind: 'pillar', lv: 3, x0: 21, z0: 25, x1: 21, z1: 25, h: 6.5 },
    { kind: 'pillar', lv: 3, x0: 42, z0: 25, x1: 42, z1: 25, h: 6.5 },
    // Laboratorio: tubos con los jefes (decorativos), consolas y la centrifugadora del easter egg
    { kind: 'tube', boss: 'butcher', lv: 0, x0: 19, z0: 4, x1: 20, z1: 5, h: 3.4 },
    { kind: 'tube', boss: 'plague', lv: 0, x0: 27, z0: 4, x1: 28, z1: 5, h: 3.4 },
    { kind: 'tube', boss: 'necro', lv: 0, x0: 31, z0: 4, x1: 32, z1: 5, h: 3.4 },
    { kind: 'tube', boss: 'armored', lv: 0, x0: 35, z0: 4, x1: 36, z1: 5, h: 3.4 },
    { kind: 'tube', boss: 'specter', lv: 0, x0: 43, z0: 4, x1: 44, z1: 5, h: 3.4 },
    { kind: 'tube', boss: 'vampire', lv: 0, x0: 43, z0: 16, x1: 44, z1: 17, h: 3.4 },
    { kind: 'console', lv: 0, x0: 22, z0: 12, x1: 27, z1: 12, h: 1.1 },
    { kind: 'console', lv: 0, x0: 36, z0: 12, x1: 41, z1: 12, h: 1.1 },
    { kind: 'centrifuge', lv: 0, x0: 31, z0: 14, x1: 32, z1: 15, h: 1.6 },
    // Criptas y bodega
    { kind: 'sarcophagus', lv: 0, x0: 6, z0: 7, x1: 7, z1: 9, h: 1.0 },
    { kind: 'sarcophagus', lv: 0, x0: 11, z0: 7, x1: 12, z1: 9, h: 1.0 },
    { kind: 'sarcophagus', lv: 0, x0: 6, z0: 14, x1: 7, z1: 16, h: 1.0 },
    { kind: 'barrels', lv: 0, x0: 50, z0: 6, x1: 52, z1: 7, h: 1.4 },
    { kind: 'barrels', lv: 0, x0: 50, z0: 14, x1: 52, z1: 15, h: 1.4 },
    { kind: 'winerack', lv: 0, x0: 60, z0: 4, x1: 60, z1: 7, h: 2.4 },
    // Easter egg: braseros del patio (se encienden en el orden que muestra el laboratorio)
    { kind: 'brazier', color: 0, lv: 1, x0: 13, z0: 43, x1: 13, z1: 43, h: 1.1 },
    { kind: 'brazier', color: 1, lv: 1, x0: 50, z0: 43, x1: 50, z1: 43, h: 1.1 },
    { kind: 'brazier', color: 2, lv: 1, x0: 13, z0: 57, x1: 13, z1: 57, h: 1.1 },
    { kind: 'brazier', color: 3, lv: 1, x0: 50, z0: 57, x1: 50, z1: 57, h: 1.1 },
    // Cámara del tiempo
    { kind: 'clockwork', lv: 2, x0: 45, z0: 14, x1: 46, z1: 15, h: 2.5 },
    { kind: 'clockwork', lv: 2, x0: 56, z0: 14, x1: 57, z1: 15, h: 2.5 },
  ],
  // Armas de pared. (x, z) = celda de suelo frente al muro; wall = lado donde está el muro.
  wallbuys: [
    { id: 'wb0', weapon: 'm14', lv: 1, x: 20, z: 42, wall: 'N' },
    { id: 'wb1', weapon: 'olympia', lv: 1, x: 43, z: 42, wall: 'N' },
    { id: 'wb2', weapon: 'mp5', lv: 1, x: 22, z: 36, wall: 'W' },
    { id: 'wb3', weapon: 'ak74u', lv: 1, x: 3, z: 21, wall: 'W' },
    { id: 'wb4', weapon: 'r870', lv: 1, x: 60, z: 21, wall: 'E' },
    { id: 'wb5', weapon: 'bat', lv: 1, x: 3, z: 6, wall: 'W' },
    { id: 'wb6', weapon: 'b23r', lv: 1, x: 41, z: 15, wall: 'E' },
    { id: 'wb7', weapon: 'machete', lv: 1, x: 60, z: 15, wall: 'E' },
    { id: 'wb8', weapon: 'm16', lv: 2, x: 22, z: 21, wall: 'W' },
    { id: 'wb9', weapon: 'galil', lv: 2, x: 60, z: 21, wall: 'E' },
    { id: 'wb10', weapon: 'bowie', lv: 0, x: 3, z: 19, wall: 'W' },
    { id: 'wb11', weapon: 'axe', lv: 0, x: 45, z: 19, wall: 'E' },
  ],
  medCabinets: [
    { id: 0, item: 'bandage', lv: 1, x: 51, z: 50, wall: 'E' },
    { id: 1, item: 'antidote', lv: 1, x: 20, z: 26, wall: 'E' },
    { id: 2, item: 'medkit', lv: 0, x: 18, z: 8, wall: 'W' },
  ],
  perkMachines: [
    { perk: 'quickrevive', lv: 1, x: 12, z: 50, face: 'E' },
    { perk: 'staminup', lv: 1, x: 3, z: 32, face: 'E' },
    { perk: 'juggernog', lv: 1, x: 60, z: 33, face: 'W' },
    { perk: 'speedcola', lv: 0, x: 18, z: 17, face: 'E' },
    { perk: 'doubletap', lv: 2, x: 3, z: 31, face: 'E' },
    { perk: 'mulekick', lv: 2, x: 60, z: 33, face: 'W' },
  ],
  pap: { lv: 2, x0: 50, z0: 5, x1: 51, z1: 5, face: 'S' },
  powerSwitch: { lv: 0, x: 45, z: 9, wall: 'E' },
  workbench: { lv: 1, x0: 41, z0: 36, x1: 41, z1: 37, face: 'W' },
  boxLocations: [
    { id: 0, lv: 1, x0: 38, z0: 58, x1: 39, z1: 58, face: 'N', zone: 0 },
    { id: 1, lv: 1, x0: 10, z0: 40, x1: 11, z1: 40, face: 'N', zone: 2 },
    { id: 2, lv: 0, x0: 55, z0: 3, x1: 56, z1: 3, face: 'S', zone: 16 },
    { id: 3, lv: 2, x0: 50, z0: 40, x1: 51, z1: 40, face: 'N', zone: 9 },
    { id: 4, lv: 1, x0: 30, z0: 3, x1: 31, z1: 3, face: 'S', zone: 5 },
  ],
  boxStart: 0,
  shieldParts: [
    { id: 0, name: 'Placa de acero', lv: 0, x: 38, z: 19, zone: 14 },
    { id: 1, name: 'Asa de bronce', lv: 2, x: 11, z: 27, zone: 8 },
    { id: 2, name: 'Remaches', lv: 0, x: 55, z: 11, zone: 16 },
  ],
  // Teletransportes: laboratorio → Cámara del Tiempo (Pack-a-Punch) y vuelta. Necesitan la electricidad.
  teleporters: [
    { id: 'lab', lv: 0, x: 23, z: 17, to: { lv: 2, x: 51.5, z: 12.5, yaw: 0 }, power: true },
    { id: 'cronos', lv: 2, x: 51, z: 14, to: { lv: 0, x: 23.5, z: 15.5, yaw: Math.PI }, power: false },
  ],
  // Easter egg (ver server/easteregg.js): centrifugadora, braseros, escondites de los viales y el jefe final
  ee: {
    centrifuge: { lv: 0, x: 31, z: 16 },
    braziers: [{ lv: 1, x: 13, z: 43 }, { lv: 1, x: 50, z: 43 }, { lv: 1, x: 13, z: 57 }, { lv: 1, x: 50, z: 57 }],
    vials: [
      { lv: 1, x: 5, z: 38 }, { lv: 1, x: 18, z: 5 }, { lv: 1, x: 58, z: 38 },
      { lv: 2, x: 18, z: 25 }, { lv: 2, x: 45, z: 24 }, { lv: 0, x: 14, z: 4 },
    ],
    ballroom: 13,
    scientist: { lv: 3, x: 31.5, z: 14.5 },
  },
  // Aparición de los jugadores: patio
  playerSpawns: [
    { x: 27.5, z: 56.5, lv: 1 },
    { x: 29.5, z: 56.5, lv: 1 },
    { x: 34.5, z: 56.5, lv: 1 },
    { x: 36.5, z: 56.5, lv: 1 },
  ],
  spawnYaw: 0,
};

// Desplaza O celdas todas las coordenadas del mapa
function shift(v, key) {
  if (Array.isArray(v)) {
    if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && key === 'cell') return [v[0] + O, v[1] + O];
    return v.map((e) => shift(e, key === 'cells' ? 'cell' : key));
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (['x', 'z', 'x0', 'x1', 'z0', 'z1'].includes(k) && typeof val === 'number') out[k] = val + O;
      else out[k] = shift(val, k);
    }
    return out;
  }
  return v;
}

const DEF = { ...RAW };
for (const k of ['zones', 'stairs', 'holes', 'openings', 'walls', 'doors', 'windows', 'props', 'wallbuys', 'medCabinets',
  'perkMachines', 'pap', 'powerSwitch', 'workbench', 'boxLocations', 'shieldParts', 'teleporters', 'playerSpawns', 'ee']) {
  DEF[k] = shift(RAW[k], k);
}

export default DEF;
