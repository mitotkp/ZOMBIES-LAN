// Núcleo de los mapas: convierte la definición de un mapa (shared/maps/*.js) en la cuadrícula que comparten
// servidor y cliente (colisión, navegación, interactuables). Admite varias plantas:
//
//  - 1 celda = 1 metro. La celda (x, z) ocupa [x, x+1] x [z, z+1]. Norte = -Z, Sur = +Z, Este = +X, Oeste = -X.
//  - Cada planta (level) tiene una altura base `y` y una altura interior `h`. Todas las plantas comparten
//    las mismas coordenadas X/Z: la cuadrícula de cada una está "apilada" sobre la de abajo.
//  - Escaleras (stairs): rampas que pertenecen a la planta de abajo (`lv`) y suben hasta la de arriba en la
//    dirección `dir`. En la planta de arriba sus celdas quedan abiertas (hueco de la escalera).
//  - Huecos (holes): aberturas en el suelo de una planta (p. ej. un vestíbulo de doble altura con galería).
//    No se pueden pisar, pero dejan ver y disparar hacia abajo.
//  - Con una sola planta todo funciona exactamente como el mapa original de una planta.

export const C = {
  VOID: 0,      // fuera del mapa (sólido)
  FLOOR: 1,     // suelo transitable de una zona
  WALL: 2,      // muro
  DOOR: 3,      // puerta/escombros comprables (sólida mientras está cerrada)
  WINDOW: 4,    // ventana con barricada (sólida para jugadores; los zombis la cruzan)
  OUTSIDE: 5,   // callejón exterior donde aparecen los zombis (inaccesible para jugadores)
  PROP: 6,      // obstáculo sólido con altura
  HOLE: 7,      // hueco en el suelo de una planta superior (galería, hueco de escalera): transparente, no se pisa
  STAIR: 8,     // escalera (rampa) en la planta a la que pertenece
  OPEN: 9,      // aire sobre una zona exterior de la planta de abajo: transparente, no se pisa
};

export const WALL_KIND = { BUILDING: 0, FENCE: 1 };

export const DIRS = {
  N: { dx: 0, dz: -1 },
  S: { dx: 0, dz: 1 },
  E: { dx: 1, dz: 0 },
  W: { dx: -1, dz: 0 },
};

const STEP = 0.7;   // desnivel máximo que se sube sin saltar (m)

// Construye el objeto de mapa a partir de su definición
export function buildMap(def) {
  const W = def.W, H = def.H;
  const levels = (def.levels && def.levels.length ? def.levels : [{ y: 0, h: def.ceilH || 4 }]).map((l, i) => ({ id: i, y: l.y, h: l.h, name: l.name || '' }));
  const NL = levels.length;
  const N = W * H;
  const lvOf = (o) => (o && Number.isInteger(o.lv) ? o.lv : 0);

  const cellTypeL = levels.map(() => new Uint8Array(N));
  const cellZoneL = levels.map(() => new Int8Array(N).fill(-1));
  const cellHeightL = levels.map(() => new Float32Array(N));
  const cellWallKindL = levels.map(() => new Uint8Array(N));
  const cellDoorL = levels.map(() => new Array(N).fill(null));
  const cellWindowL = levels.map(() => new Int16Array(N).fill(-1));
  const stairIdx = new Int16Array(N).fill(-1);

  const idx = (x, z) => z * W + x;
  const inBounds = (x, z) => x >= 0 && z >= 0 && x < W && z < H;
  const typeAtL = (l, x, z) => (inBounds(x, z) && l >= 0 && l < NL ? cellTypeL[l][idx(x, z)] : C.VOID);
  const zoneAtL = (l, x, z) => (inBounds(x, z) && l >= 0 && l < NL ? cellZoneL[l][idx(x, z)] : -1);
  const setCell = (l, x, z, t) => { if (inBounds(x, z)) cellTypeL[l][idx(x, z)] = t; };

  const ZONES = def.zones.map((z) => ({ ...z, lv: lvOf(z) }));
  const DOORS = (def.doors || []).map((d) => ({ ...d, lv: lvOf(d) }));
  const WINDOWS = (def.windows || []).map((w) => ({ ...w, lv: lvOf(w) }));
  const PROPS = (def.props || []).map((p) => ({ ...p, lv: lvOf(p) }));
  const STAIRS = (def.stairs || []).map((s, i) => ({ ...s, id: s.id != null ? s.id : i, lv: lvOf(s), n: i }));
  const HOLES = (def.holes || []).map((h) => ({ ...h, lv: lvOf(h) }));
  const OPENINGS = (def.openings || []).map((o) => ({ ...o, lv: lvOf(o) }));

  // Datos derivados de cada ventana
  const WINDOW_INFO = WINDOWS.map((w) => {
    const d = DIRS[w.dir];
    return {
      ...w,
      tear: [w.x + d.dx, w.z + d.dz],       // celda exterior pegada a la ventana
      land: [w.x - d.dx, w.z - d.dz],       // celda interior donde cae el zombi
      spawn: [w.x + d.dx * 3, w.z + d.dz * 3],
      cx: w.x + 0.5,
      cz: w.z + 0.5,
      y: levels[w.lv].y,
      pocket: (() => {
        const cells = [];
        for (let depth = 1; depth <= 3; depth++) {
          for (let side = -1; side <= 1; side++) {
            cells.push([w.x + d.dx * depth + (d.dx === 0 ? side : 0), w.z + d.dz * depth + (d.dz === 0 ? side : 0)]);
          }
        }
        return cells;
      })(),
    };
  });

  // ------------------------------------------------------------------ cuadrícula
  // 1) Suelo de zonas
  for (const zn of ZONES) {
    for (let z = zn.z0; z <= zn.z1; z++) {
      for (let x = zn.x0; x <= zn.x1; x++) {
        setCell(zn.lv, x, z, C.FLOOR);
        cellZoneL[zn.lv][idx(x, z)] = zn.id;
      }
    }
  }
  // 1b) Aberturas libres entre zonas (arcos): suelo que atraviesa un muro
  for (const o of OPENINGS) {
    for (const [x, z] of o.cells) { setCell(o.lv, x, z, C.FLOOR); cellZoneL[o.lv][idx(x, z)] = o.zone; }
  }
  // 1c) Escaleras (planta de abajo) y su hueco (planta de arriba)
  for (const st of STAIRS) {
    for (let z = st.z0; z <= st.z1; z++) {
      for (let x = st.x0; x <= st.x1; x++) {
        setCell(st.lv, x, z, C.STAIR);
        cellZoneL[st.lv][idx(x, z)] = st.zone != null ? st.zone : -1;
        stairIdx[idx(x, z)] = st.n;
        if (st.lv + 1 < NL) setCell(st.lv + 1, x, z, C.HOLE);
      }
    }
  }
  // 1d) Huecos
  for (const h of HOLES) {
    for (let z = h.z0; z <= h.z1; z++) for (let x = h.x0; x <= h.x1; x++) setCell(h.lv, x, z, C.HOLE);
  }
  // 2) Muros automáticos: celda vacía 8-adyacente a suelo de zona, escalera o hueco de su misma planta
  for (let l = 0; l < NL; l++) {
    const T = cellTypeL[l];
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        if (T[idx(x, z)] !== C.VOID) continue;
        let near = false;
        for (let dz = -1; dz <= 1 && !near; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const t = typeAtL(l, x + dx, z + dz);
            if ((t === C.FLOOR && zoneAtL(l, x + dx, z + dz) >= 0) || t === C.STAIR || t === C.HOLE) { near = true; break; }
          }
        }
        if (near) { T[idx(x, z)] = C.WALL; cellWallKindL[l][idx(x, z)] = WALL_KIND.BUILDING; }
      }
    }
  }
  // 3) Puertas
  for (const d of DOORS) {
    for (const [x, z] of d.cells) {
      setCell(d.lv, x, z, C.DOOR);
      cellDoorL[d.lv][idx(x, z)] = d.id;
      cellZoneL[d.lv][idx(x, z)] = d.zones[0];
    }
  }
  // 4) Ventanas y callejones exteriores
  for (const w of WINDOW_INFO) {
    setCell(w.lv, w.x, w.z, C.WINDOW);
    cellWindowL[w.lv][idx(w.x, w.z)] = w.id;
    cellZoneL[w.lv][idx(w.x, w.z)] = w.zone;
    for (const [px, pz] of w.pocket) {
      setCell(w.lv, px, pz, C.OUTSIDE);
      cellWindowL[w.lv][idx(px, pz)] = w.id;
    }
  }
  // 5) Vallas alrededor de los callejones
  for (let l = 0; l < NL; l++) {
    const T = cellTypeL[l];
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        if (T[idx(x, z)] !== C.VOID) continue;
        let near = false;
        for (let dz = -1; dz <= 1 && !near; dz++) {
          for (let dx = -1; dx <= 1; dx++) if (typeAtL(l, x + dx, z + dz) === C.OUTSIDE) { near = true; break; }
        }
        if (near) { T[idx(x, z)] = C.WALL; cellWallKindL[l][idx(x, z)] = WALL_KIND.FENCE; }
      }
    }
  }
  // 5b) Muros explícitos (tabiques interiores, barandillas macizas...)
  for (const wl of def.walls || []) {
    const l = lvOf(wl);
    for (let z = wl.z0; z <= wl.z1; z++) for (let x = wl.x0; x <= wl.x1; x++) setCell(l, x, z, C.WALL);
  }
  // 6) Obstáculos con altura
  const solidRect = (l, x0, z0, x1, z1, h) => {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        setCell(l, x, z, C.PROP);
        cellHeightL[l][idx(x, z)] = Math.max(cellHeightL[l][idx(x, z)], h);
      }
    }
  };
  const PERK_MACHINES = (def.perkMachines || []).map((m) => ({ ...m, lv: lvOf(m) }));
  const PAP_MACHINE = def.pap ? { ...def.pap, lv: lvOf(def.pap) } : null;
  const WORKBENCH = def.workbench ? { ...def.workbench, lv: lvOf(def.workbench) } : null;
  const BOX_LOCATIONS = (def.boxLocations || []).map((b) => ({ ...b, lv: lvOf(b) }));
  for (const p of PROPS) solidRect(p.lv, p.x0, p.z0, p.x1, p.z1, p.h);
  for (const m of PERK_MACHINES) solidRect(m.lv, m.x, m.z, m.x, m.z, 2.3);
  if (PAP_MACHINE) solidRect(PAP_MACHINE.lv, PAP_MACHINE.x0, PAP_MACHINE.z0, PAP_MACHINE.x1, PAP_MACHINE.z1, 1.6);
  if (WORKBENCH) solidRect(WORKBENCH.lv, WORKBENCH.x0, WORKBENCH.z0, WORKBENCH.x1, WORKBENCH.z1, 1.0);
  for (const b of BOX_LOCATIONS) solidRect(b.lv, b.x0, b.z0, b.x1, b.z1, 1.0);
  // 7) Aire sobre zonas exteriores: en las plantas superiores, el vacío encima de un exterior (o de más aire)
  for (let l = 1; l < NL; l++) {
    const T = cellTypeL[l], B = cellTypeL[l - 1];
    for (let i = 0; i < N; i++) {
      if (T[i] !== C.VOID) continue;
      const bz = cellZoneL[l - 1][i];
      const below = B[i];
      if (below === C.OPEN || ((below === C.FLOOR || below === C.PROP || below === C.DOOR || below === C.OUTSIDE || below === C.WINDOW) && !(bz >= 0 && ZONES[bz] && ZONES[bz].indoor))) T[i] = C.OPEN;
    }
  }

  // ------------------------------------------------------------------ alturas y plantas
  const baseY = (l) => levels[Math.max(0, Math.min(NL - 1, l))].y;
  // Planta en la que está alguien a la altura y (la más alta cuya base queda por debajo, con margen)
  const levelOfY = (y) => {
    let l = 0;
    for (let i = 1; i < NL; i++) if (y >= levels[i].y - 0.9) l = i;
    return l;
  };
  // Salidas de cada escalera: la fila de celdas bajo su pie (planta lv) y la de su llegada (planta lv+1).
  // De una escalera solo se sale (y a ella solo se entra) por ahí: los costados tienen barandilla.
  for (const st of STAIRS) {
    const d = DIRS[st.dir];
    st.exitBottom = new Set(); st.exitTop = new Set();
    for (let z = st.z0; z <= st.z1; z++) for (let x = st.x0; x <= st.x1; x++) {
      // la fila del pie y la de la llegada, más una celda a cada lado (el rellano: el cuerpo las roza al salir)
      const firstRow = !inBounds(x - d.dx, z - d.dz) || stairIdx[idx(x - d.dx, z - d.dz)] !== st.n;
      const lastRow = !inBounds(x + d.dx, z + d.dz) || stairIdx[idx(x + d.dx, z + d.dz)] !== st.n;
      for (let k = -1; k <= 1; k++) {
        const ox = d.dx === 0 ? k : 0, oz = d.dz === 0 ? k : 0;
        const bx = x - d.dx + ox, bz = z - d.dz + oz, tx = x + d.dx + ox, tz = z + d.dz + oz;
        if (firstRow && inBounds(bx, bz) && stairIdx[idx(bx, bz)] !== st.n) st.exitBottom.add(idx(bx, bz));
        if (lastRow && inBounds(tx, tz) && stairIdx[idx(tx, tz)] !== st.n) st.exitTop.add(idx(tx, tz));
      }
    }
  }

  // Altura de la rampa de la escalera st en el punto (x, z)
  const rampY = (st, x, z) => {
    const d = DIRS[st.dir];
    let t;
    if (d.dx > 0) t = (x - st.x0) / (st.x1 + 1 - st.x0);
    else if (d.dx < 0) t = (st.x1 + 1 - x) / (st.x1 + 1 - st.x0);
    else if (d.dz > 0) t = (z - st.z0) / (st.z1 + 1 - st.z0);
    else t = (st.z1 + 1 - z) / (st.z1 + 1 - st.z0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return baseY(st.lv) + (baseY(st.lv + 1) - baseY(st.lv)) * t;
  };
  const stairAt = (x, z) => {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (!inBounds(cx, cz)) return null;
    const s = stairIdx[idx(cx, cz)];
    return s >= 0 ? STAIRS[s] : null;
  };
  // Rango de alturas de la rampa dentro de una celda
  const stairCellRange = (st, cx, cz) => {
    const a = rampY(st, cx, cz), b = rampY(st, cx + 1, cz + 1), c = rampY(st, cx + 1, cz), d = rampY(st, cx, cz + 1);
    return [Math.min(a, b, c, d), Math.max(a, b, c, d)];
  };
  // Altura del suelo bajo (x, z) para alguien que está a la altura y
  const groundY = (x, z, y = 0) => {
    const st = stairAt(x, z);
    if (st) {
      const r = rampY(st, x, z);
      if (y >= r - STEP - 0.3 && y <= r + 1.6) return r;
    }
    return baseY(levelOfY(y));
  };

  const indoorZone = (l, i) => {
    const zn = cellZoneL[l][i];
    return zn >= 0 && ZONES[zn] ? !!ZONES[zn].indoor : false;
  };

  const M = {
    id: def.id, def, theme: def.theme || def.id,
    MAP_NAME: def.name, W, H,
    WALL_H: def.wallH || levels[0].h, FENCE_H: def.fenceH || 2.6, CEIL_H: def.ceilH || levels[0].h,
    levels, NL, STEP,
    ZONES, START_ZONE: def.startZone || 0, DOORS, WINDOWS, WINDOW_INFO, PROPS, STAIRS, HOLES,
    WALLBUYS: (def.wallbuys || []).map((w) => ({ ...w, lv: lvOf(w) })),
    MED_CABINETS: (def.medCabinets || []).map((m) => ({ ...m, lv: lvOf(m) })),
    PERK_MACHINES, PAP_MACHINE,
    POWER_SWITCH: def.powerSwitch ? { ...def.powerSwitch, lv: lvOf(def.powerSwitch) } : null,
    WORKBENCH, BOX_LOCATIONS, BOX_START: def.boxStart || 0,
    SHIELD_PARTS: (def.shieldParts || []).map((p) => ({ ...p, lv: lvOf(p) })),
    PLAYER_SPAWNS: (def.playerSpawns || []).map((p) => ({ ...p, lv: lvOf(p), y: baseY(lvOf(p)) })),
    PLAYER_SPAWN_YAW: def.spawnYaw || 0,
    TELEPORTERS: (def.teleporters || []).map((t) => ({ ...t })),
    EE: def.ee || null,
    // plantas
    cellTypeL, cellZoneL, cellHeightL, cellWallKindL, cellDoorL, cellWindowL, stairIdx,
    // compatibilidad con el código de una planta: planta 0
    cellType: cellTypeL[0], cellZone: cellZoneL[0], cellHeight: cellHeightL[0], cellWallKind: cellWallKindL[0],
    cellDoor: cellDoorL[0], cellWindow: cellWindowL[0],
    idx, inBounds,
    typeAt: (x, z) => typeAtL(0, x, z), zoneAt: (x, z) => zoneAtL(0, x, z),
    typeAtL, zoneAtL, baseY, levelOfY, rampY, stairAt, stairCellRange, groundY, indoorZone,
  };

  // ------------------------------------------------------------------ transitabilidad
  // ¿Puede estar en la celda (cx, cz) alguien a la altura y? (jugadores y zombis que ya están dentro)
  // (ex, ez): posición actual de quien se mueve (opcional). Con ella se aplica la regla de las salidas de escalera.
  const onStairAt = (ex, ez, y) => {
    const st = stairAt(ex, ez);
    return st && Math.abs(rampY(st, ex, ez) - y) < 1.0 ? st : null;
  };
  M.walkable = (cx, cz, doors, y = levels[0].y, ex, ez) => {
    if (!inBounds(cx, cz)) return false;
    const i = idx(cx, cz);
    const s = stairIdx[i];
    const cur = ex !== undefined && STAIRS.length ? onStairAt(ex, ez, y) : null;
    if (s >= 0) {
      const st = STAIRS[s];
      if (ex !== undefined && (!cur || cur.n !== st.n)) {
        // se entra a una escalera solo desde su pie o su llegada
        const here = idx(Math.floor(ex), Math.floor(ez));
        const atBottom = st.exitBottom.has(here) && Math.abs(y - baseY(st.lv)) < 1.3;
        const atTop = st.exitTop.has(here) && Math.abs(y - baseY(st.lv + 1)) < 1.3;
        if (!atBottom && !atTop && here !== i) return false;
      }
      const [lo, hi] = stairCellRange(st, cx, cz);
      if (y >= lo - STEP && y <= hi + STEP) return true;
    } else if (cur && !cur.exitBottom.has(i) && !cur.exitTop.has(i)) {
      return false;   // desde una escalera no se sale por el costado
    }
    const l = levelOfY(y);
    // desde una escalera no se "baja" por el costado al suelo: la barandilla lo impide (se admite el salto)
    const dy = y - levels[l].y;
    if (dy > 1.3 || dy < -STEP) return false;
    const t = cellTypeL[l][i];
    if (t === C.FLOOR) return true;
    if (t === C.DOOR) return !!(doors && doors[cellDoorL[l][i]]);
    return false;
  };
  // ¿La celda es callejón exterior en la planta de la altura y?
  M.isOutside = (cx, cz, y = levels[0].y) => inBounds(cx, cz) && cellTypeL[levelOfY(y)][idx(cx, cz)] === C.OUTSIDE;

  // ------------------------------------------------------------------ navegación en 3D (nodos = planta × celda)
  // Un nodo existe si la celda es transitable en esa planta; las escaleras son nodos de su planta de abajo.
  M.nodeWalkable = (l, i, doors) => {
    const t = cellTypeL[l][i];
    if (t === C.FLOOR) return true;
    if (t === C.DOOR) return !!(doors && doors[cellDoorL[l][i]]);
    if (t === C.STAIR) return true;
    return false;
  };
  // Altura del centro del nodo
  M.nodeY = (l, i) => {
    const s = stairIdx[i];
    if (s >= 0 && STAIRS[s].lv === l) return rampY(STAIRS[s], (i % W) + 0.5, ((i / W) | 0) + 0.5);
    return levels[l].y;
  };
  // Planta del nodo en el que está alguien en (x, z, y)
  M.nodeLevel = (x, z, y) => {
    const st = stairAt(x, z);
    if (st) {
      const r = rampY(st, x, z);
      if (Math.abs(y - r) < 1.2) return st.lv;
    }
    return levelOfY(y);
  };

  // ------------------------------------------------------------------ zonas unidas sin puerta
  // Escaleras y arcos unen zonas sin nada que comprar: al abrirse una, se abren las unidas (para las ventanas)
  const links = new Map();
  const link = (a, b) => {
    if (a < 0 || b < 0 || a === b) return;
    if (!links.has(a)) links.set(a, new Set());
    if (!links.has(b)) links.set(b, new Set());
    links.get(a).add(b); links.get(b).add(a);
  };
  for (const st of STAIRS) {
    const zb = new Set(), zt = new Set();
    for (const i of st.exitBottom) { const zn = cellZoneL[st.lv][i]; if (zn >= 0 && cellTypeL[st.lv][i] === C.FLOOR) zb.add(zn); }
    if (st.lv + 1 < NL) for (const i of st.exitTop) { const zn = cellZoneL[st.lv + 1][i]; if (zn >= 0 && cellTypeL[st.lv + 1][i] === C.FLOOR) zt.add(zn); }
    for (const a of zb) for (const b of zt) link(a, b);
  }
  for (const o of OPENINGS) {
    for (const [x, z] of o.cells) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) link(o.zone, zoneAtL(o.lv, x + dx, z + dz));
    }
  }
  // Cierre: zonas que se abren junto con las dadas
  M.expandZones = (zones) => {
    const out = new Set(zones);
    const q = [...out];
    while (q.length) {
      const z = q.pop();
      for (const n of links.get(z) || []) if (!out.has(n)) { out.add(n); q.push(n); }
    }
    return [...out].sort((a, b) => a - b);
  };

  // ------------------------------------------------------------------ interactuables
  M.INTERACTABLES = buildInteractables(M);
  M.INTERACTABLE_BY_ID = Object.fromEntries(M.INTERACTABLES.map((i) => [i.id, i]));

  M.pocketWindowAt = (x, z, l = 0) => {
    if (!inBounds(x, z)) return -1;
    return cellTypeL[l][idx(x, z)] === C.OUTSIDE ? cellWindowL[l][idx(x, z)] : -1;
  };

  M.toAscii = (doorsOpen = {}, l = 0) => {
    const ch = { [C.VOID]: ' ', [C.FLOOR]: '.', [C.WALL]: '#', [C.WINDOW]: 'W', [C.OUTSIDE]: 'o', [C.PROP]: 'x', [C.HOLE]: '~', [C.STAIR]: '/', [C.OPEN]: ',' };
    const rows = [];
    for (let z = 0; z < H; z++) {
      let r = '';
      for (let x = 0; x < W; x++) {
        const i = idx(x, z), t = cellTypeL[l][i];
        if (t === C.DOOR) r += doorsOpen[cellDoorL[l][i]] ? '_' : cellDoorL[l][i];
        else if (t === C.WALL && cellWallKindL[l][i] === WALL_KIND.FENCE) r += '%';
        else if (t === C.FLOOR) r += String(cellZoneL[l][i] % 10);
        else r += ch[t];
      }
      rows.push(r);
    }
    return rows.join('\n');
  };
  return M;
}

function frontOfRect(x0, z0, x1, z1, face) {
  const d = DIRS[face];
  const cx = (x0 + x1 + 1) / 2;
  const cz = (z0 + z1 + 1) / 2;
  const hx = (x1 - x0 + 1) / 2;
  const hz = (z1 - z0 + 1) / 2;
  return { x: cx + d.dx * (hx + 0.55), z: cz + d.dz * (hz + 0.55), cx, cz };
}

// Lista única de interactuables (servidor: validación; cliente: avisos). `y` es la altura del aviso respecto
// al suelo de su planta y `base` la altura de ese suelo.
// Ids: 'door:A', 'wall:wb0', 'perk:juggernog', 'pap', 'power', 'box:0'.., 'bench', 'part:0'.., 'win:0'..,
//      'med:<item>', 'tp:<id>'
function buildInteractables(M) {
  const list = [];
  const base = (o) => M.baseY(o.lv || 0);
  for (const d of M.DOORS) {
    const xs = d.cells.map((c) => c[0] + 0.5);
    const zs = d.cells.map((c) => c[1] + 0.5);
    const x = xs.reduce((a, b) => a + b, 0) / xs.length;
    const z = zs.reduce((a, b) => a + b, 0) / zs.length;
    list.push({ id: `door:${d.id}`, kind: 'door', door: d.id, x, z, y: 1.2, lv: d.lv, base: base(d), range: 2.6 });
  }
  for (const wb of M.WALLBUYS) {
    const d = DIRS[wb.wall];
    list.push({
      id: `wall:${wb.id}`, kind: 'wallbuy', wallbuy: wb.id, weapon: wb.weapon,
      x: wb.x + 0.5, z: wb.z + 0.5, y: 1.5, lv: wb.lv, base: base(wb),
      wx: wb.x + 0.5 + d.dx * 0.5, wz: wb.z + 0.5 + d.dz * 0.5, wall: wb.wall,
      range: 1.9,
    });
  }
  for (const mc of M.MED_CABINETS) {
    const d = DIRS[mc.wall];
    list.push({
      id: `med:${mc.item}`, kind: 'med', item: mc.item, cabinet: mc.id,
      x: mc.x + 0.5, z: mc.z + 0.5, y: 1.4, lv: mc.lv, base: base(mc),
      wx: mc.x + 0.5 + d.dx * 0.5, wz: mc.z + 0.5 + d.dz * 0.5, wall: mc.wall,
      range: 1.9,
    });
  }
  for (const m of M.PERK_MACHINES) {
    const f = frontOfRect(m.x, m.z, m.x, m.z, m.face);
    list.push({ id: `perk:${m.perk}`, kind: 'perk', perk: m.perk, x: f.x, z: f.z, y: 1.3, lv: m.lv, base: base(m), cx: f.cx, cz: f.cz, face: m.face, range: 1.9 });
  }
  if (M.PAP_MACHINE) {
    const P = M.PAP_MACHINE;
    const f = frontOfRect(P.x0, P.z0, P.x1, P.z1, P.face);
    list.push({ id: 'pap', kind: 'pap', x: f.x, z: f.z, y: 1.2, lv: P.lv, base: base(P), cx: f.cx, cz: f.cz, face: P.face, range: 2.0 });
  }
  if (M.POWER_SWITCH) {
    const P = M.POWER_SWITCH;
    const d = DIRS[P.wall];
    list.push({
      id: 'power', kind: 'power', x: P.x + 0.5, z: P.z + 0.5, y: 1.4, lv: P.lv, base: base(P),
      wx: P.x + 0.5 + d.dx * 0.5, wz: P.z + 0.5 + d.dz * 0.5, wall: P.wall, range: 1.9,
    });
  }
  for (const b of M.BOX_LOCATIONS) {
    const f = frontOfRect(b.x0, b.z0, b.x1, b.z1, b.face);
    list.push({ id: `box:${b.id}`, kind: 'box', box: b.id, x: f.x, z: f.z, y: 1.1, lv: b.lv, base: base(b), cx: f.cx, cz: f.cz, face: b.face, range: 2.0 });
  }
  if (M.WORKBENCH) {
    const Wb = M.WORKBENCH;
    const f = frontOfRect(Wb.x0, Wb.z0, Wb.x1, Wb.z1, Wb.face);
    list.push({ id: 'bench', kind: 'bench', x: f.x, z: f.z, y: 1.0, lv: Wb.lv, base: base(Wb), cx: f.cx, cz: f.cz, face: Wb.face, range: 2.0 });
  }
  for (const p of M.SHIELD_PARTS) {
    list.push({ id: `part:${p.id}`, kind: 'part', part: p.id, x: p.x + 0.5, z: p.z + 0.5, y: 0.4, lv: p.lv, base: base(p), range: 1.7 });
  }
  for (const w of M.WINDOW_INFO) {
    list.push({ id: `win:${w.id}`, kind: 'window', window: w.id, x: w.land[0] + 0.5, z: w.land[1] + 0.5, y: 1.2, lv: w.lv, base: base(w), cx: w.cx, cz: w.cz, range: 1.9 });
  }
  // Easter egg: centrifugadora, braseros y escondites de los viales (el servidor decide cuáles están activos)
  if (M.EE) {
    const E = M.EE;
    const add = (id, o, y, range) => list.push({ id, kind: 'ee', x: o.x + 0.5, z: o.z + 0.5, y, lv: o.lv || 0, base: M.baseY(o.lv || 0), range });
    add('ee:centri', E.centrifuge, 1.1, 2.0);
    E.braziers.forEach((b, i) => add('ee:braz:' + i, b, 1.0, 2.0));
    E.vials.forEach((v, i) => add('ee:vial:' + i, v, 0.9, 1.6));
  }
  for (const t of M.TELEPORTERS) {
    const lv = t.lv || 0;
    list.push({ id: `tp:${t.id}`, kind: 'teleport', tp: t.id, x: t.x + 0.5, z: t.z + 0.5, y: 1.0, lv, base: M.baseY(lv), range: 1.6 });
  }
  return list;
}

// ¿Está un jugador en (x, y, z) en la misma planta que el interactuable (con margen para las escaleras)?
export function sameFloor(it, y) {
  return Math.abs((it.base || 0) - (Number(y) || 0)) < 2.2;
}
