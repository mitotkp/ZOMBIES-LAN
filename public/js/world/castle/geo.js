// Geometría estructural del castillo (mapa de varias plantas): suelos, techos, muros con zócalo y papel pintado,
// ventanas, dinteles de las puertas, escaleras con peldaños, barandillas en huecos y balcones, almenas, tejados,
// torres decorativas y el terreno. Todo va a un StaticBatch (fusión por material).
import * as THREE from 'three';
import { MAP, C, DIRS } from '/shared/map.js';
import { MAT_DEFS, QuadBuilder, matrixFrom } from '../kit.js';
import { DOOR_H, WIN } from '../levelgeo.js';
import { makeRng } from '../textures.js';

// Estilo de cada zona por clave
export const CASTLE_STYLE = {
  patio:       { floor: 'c_gravel', outdoor: true },
  balcon:      { floor: 'c_flagstone', outdoor: true },
  vestibulo:   { floor: 'c_marble', low: 'c_panel', lowH: 1.3, up: 'c_damask_red', ceil: 'c_coffered' },
  biblioteca:  { floor: 'c_parquet', low: 'c_panel', lowH: 1.1, up: 'c_damask', ceil: 'c_coffered' },
  comedor:     { floor: 'c_parquet', low: 'c_panel', lowH: 1.1, up: 'c_damask_red', ceil: 'c_coffered' },
  cocina:      { floor: 'c_flagstone', low: 'c_ashlar', lowH: 1.0, up: 'c_plaster', ceil: 'c_darkwood' },
  musica:      { floor: 'c_parquet', low: 'c_panel', lowH: 1.1, up: 'c_damask', ceil: 'c_coffered' },
  invernadero: { floor: 'c_flagstone', low: 'c_ashlar', lowH: 0.8, up: 'c_plaster', ceil: 'c_plaster' },
  galeria:     { floor: 'c_parquet', low: 'c_panel', lowH: 1.1, up: 'c_damask_red', ceil: 'c_coffered' },
  dormitorios: { floor: 'c_parquet', low: 'c_panel', lowH: 1.0, up: 'c_damask', ceil: 'c_plaster' },
  estudio:     { floor: 'c_parquet', low: 'c_panel', lowH: 1.2, up: 'c_damask_red', ceil: 'c_coffered' },
  alanorte:    { floor: 'c_marble', low: 'c_panel', lowH: 1.2, up: 'c_damask', ceil: 'c_coffered' },
  cronos:      { floor: 'c_marble', low: 'c_ashlar_dark', lowH: 4.5, up: 'c_ashlar_dark', ceil: 'c_ashlar_dark', floorColor: 0x7a7488 },
  salon:       { floor: 'c_parquet', low: 'c_panel', lowH: 1.4, up: 'c_damask_red', ceil: 'c_coffered' },
  laboratorio: { floor: 'c_labtile', low: 'c_labtile', lowH: 2.0, up: 'c_ashlar_dark', ceil: 'c_ashlar_dark' },
  criptas:     { floor: 'c_flagstone', low: 'c_ashlar_dark', lowH: 4.5, up: 'c_ashlar_dark', ceil: 'c_ashlar_dark', floorColor: 0x9a9690 },
  bodega:      { floor: 'c_flagstone', low: 'c_ashlar', lowH: 4.5, up: 'c_ashlar', ceil: 'c_darkwood' },
};
const DEFAULT_STYLE = { floor: 'c_flagstone', low: 'c_ashlar', lowH: 1.0, up: 'c_plaster', ceil: 'c_plaster' };
export const styleOfZone = (zid) => {
  const z = MAP.ZONES[zid];
  return (z && CASTLE_STYLE[z.key]) || DEFAULT_STYLE;
};

const OPEN_T = new Set([C.FLOOR, C.DOOR, C.PROP, C.STAIR, C.HOLE, C.OUTSIDE, C.OPEN, C.VOID]);
const FLOORISH = new Set([C.FLOOR, C.DOOR, C.PROP]);
const GARDEN_H = 2.6;     // altura de la tapia del patio
const SLAB = 0.35;        // grosor visible del forjado en los bordes de los huecos

export function buildCastleGeometry(batch) {
  const M = MAP;
  const W = M.W, H = M.H, NL = M.NL;
  const rng = makeRng(1897);
  // un constructor de quads por material (y por trozo del mapa si el lote trocea: ver StaticBatch.chunkOf)
  const qbs = new Map();
  const Q = (k, x, y, z) => {
    const ch = batch.chunkOf ? batch.chunkOf(x, y, z) : null;
    const id = ch ? k + '#' + ch.key : k;
    let e = qbs.get(id);
    if (!e) { e = { key: k, ch, q: new QuadBuilder() }; qbs.set(id, e); }
    return e.q;
  };
  const tileOf = (k) => (MAT_DEFS[k] && MAT_DEFS[k].tile) || 1;
  const T = (l, x, z) => M.typeAtL(l, x, z);
  const Z = (l, x, z) => M.zoneAtL(l, x, z);
  const idx = (x, z) => z * W + x;

  function vquad(key, ax, az, bx, bz, y0, y1, nx, nz, color) {
    if (y1 - y0 < 1e-4) return;
    const rx = nz, rz = -nx;
    if ((bx - ax) * rx + (bz - az) * rz < 0) { let t = ax; ax = bx; bx = t; t = az; az = bz; bz = t; }
    const s = 1 / tileOf(key);
    const ua = (ax * rx + az * rz) * s, ub = (bx * rx + bz * rz) * s;
    Q(key, (ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2).quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [nx, 0, nz],
      [ua, y0 * s], [ub, y0 * s], [ub, y1 * s], [ua, y1 * s], color);
  }
  function hquad(key, x0, z0, x1, z1, y, up, color) {
    const s = 1 / tileOf(key);
    if (up) {
      Q(key, (x0 + x1) / 2, y, (z0 + z1) / 2).quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0],
        [x0 * s, -z1 * s], [x1 * s, -z1 * s], [x1 * s, -z0 * s], [x0 * s, -z0 * s], color);
    } else {
      Q(key, (x0 + x1) / 2, y, (z0 + z1) / 2).quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0],
        [x0 * s, z0 * s], [x1 * s, z0 * s], [x1 * s, z1 * s], [x0 * s, z1 * s], color);
    }
  }
  function box(key, cx, cy, cz, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    batch.add(key, g, matrixFrom(cx, cy, cz, rx, ry, rz), color, MAT_DEFS[key] && MAT_DEFS[key].map ? tileOf(key) : null);
    g.dispose();
  }
  function cyl(key, cx, cy, cz, rt, rb, h, seg = 12, color, open = false) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    batch.add(key, g, matrixFrom(cx, cy, cz), color, MAT_DEFS[key] && MAT_DEFS[key].map ? tileOf(key) : null);
    g.dispose();
  }
  function cellSide(sx, sz, dx, dz) {
    if (dx === 1) return [sx + 1, sz, sx + 1, sz + 1];
    if (dx === -1) return [sx, sz, sx, sz + 1];
    if (dz === 1) return [sx, sz + 1, sx + 1, sz + 1];
    return [sx, sz, sx + 1, sz];
  }
  // Zona "de interior" junto a una celda abierta (para el estilo de un hueco o escalera)
  function nearbyZone(l, x, z) {
    for (let r = 0; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const zn = Z(l, x + dx, z + dz);
        if (zn >= 0) return zn;
      }
    }
    // mirar la planta de abajo (huecos de escalera de la planta de arriba)
    return l > 0 ? nearbyZone(l - 1, x, z) : -1;
  }
  const isOutdoorOpen = (l, x, z) => {
    const t = T(l, x, z);
    if (t === C.OUTSIDE || t === C.OPEN) return true;
    if (FLOORISH.has(t)) { const zn = Z(l, x, z); return zn >= 0 && !M.ZONES[zn].indoor; }
    return false;
  };

  // ------------------------------------------------------------------ 1) suelos y techos
  for (let l = 0; l < NL; l++) {
    const Y = M.levels[l].y, h = M.levels[l].h;
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const t = T(l, x, z);
      const zn = Z(l, x, z);
      if (FLOORISH.has(t) && zn >= 0) {
        const st = styleOfZone(zn);
        hquad(st.floor, x, z, x + 1, z + 1, Y, true, st.floorColor);
      } else if (t === C.OUTSIDE) {
        // callejones: tierra en planta baja, piedra en sótano y tejados
        hquad(l === 1 ? 'floor_dirt' : 'c_flagstone', x, z, x + 1, z + 1, Y, true, l === 1 ? 0x8a8070 : 0x6a6660);
      } else if (t === C.WINDOW) {
        hquad('c_flagstone', x, z, x + 1, z + 1, Y, true, 0x8a8680);
      }
      // techo (cara inferior del forjado de arriba o del tejado)
      const above = l + 1 < NL ? T(l + 1, x, z) : C.VOID;
      if (above === C.HOLE || above === C.OPEN) continue;
      let indoorHere = false;
      if (FLOORISH.has(t) || t === C.STAIR) indoorHere = zn >= 0 ? !!M.ZONES[zn].indoor : true;
      else if (t === C.HOLE) indoorHere = true;
      else if (t === C.WINDOW) indoorHere = true;
      const aboveFloor = FLOORISH.has(above) || above === C.WALL || above === C.OUTSIDE || above === C.WINDOW;
      if ((indoorHere || (FLOORISH.has(t) && aboveFloor)) && (FLOORISH.has(t) || t === C.STAIR || t === C.HOLE || t === C.WINDOW)) {
        const zz = zn >= 0 ? zn : nearbyZone(l, x, z);
        const st = zz >= 0 ? styleOfZone(zz) : DEFAULT_STYLE;
        const zone = zz >= 0 ? M.ZONES[zz] : null;
        let ch = zone && zone.ceil && above !== C.HOLE ? Math.min(zone.ceil, h) : h;
        // grosor del forjado: si hay planta encima, el techo queda por debajo de su suelo (no asoman pies ni cuerpos)
        if (l + 1 < NL && ch >= h - 1e-3) ch -= 0.12;
        hquad(st.outdoor ? 'c_flagstone' : st.ceil || 'c_plaster', x, z, x + 1, z + 1, Y + ch, false, st.outdoor ? 0x6a6660 : undefined);
      }
    }
  }

  // ------------------------------------------------------------------ 2) muros
  const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let l = 0; l < NL; l++) {
    const Y = M.levels[l].y, h = M.levels[l].h;
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const t = T(l, x, z);
      if (t !== C.WALL && t !== C.WINDOW && t !== C.DOOR) continue;
      // ¿tapia de jardín? (muro del patio que no pertenece al edificio)
      let garden = false;
      if (t !== C.DOOR) {
        let touchesOutdoorFloor = false, touchesIndoor = false;
        for (const [dx, dz] of DIR4) {
          const nt = T(l, x + dx, z + dz), nz = Z(l, x + dx, z + dz);
          if (FLOORISH.has(nt) && nz >= 0) { if (M.ZONES[nz].indoor) touchesIndoor = true; else touchesOutdoorFloor = true; }
          if (nt === C.STAIR || nt === C.HOLE) touchesIndoor = true;
        }
        // un muro "de jardín": toca un exterior, no toca interiores y no hay nada encima
        const above = l + 1 < NL ? T(l + 1, x, z) : C.VOID;
        garden = touchesOutdoorFloor && !touchesIndoor && above !== C.WALL;
        // vallas de los callejones alrededor de zonas exteriores
        if (!garden && M.cellWallKindL[l][idx(x, z)] === 1 && l === 1) garden = true;
      }
      const topY = garden ? Y + GARDEN_H : Y + h;
      for (const [dx, dz] of DIR4) {
        const nx = x + dx, nz = z + dz;
        const nt = T(l, nx, nz);
        if (!OPEN_T.has(nt) && nt !== C.WINDOW) continue;
        if (nt === C.WINDOW && t === C.WINDOW) continue;
        if (t === C.DOOR && (nt === C.FLOOR || nt === C.DOOR || nt === C.STAIR)) {
          // dintel sobre el hueco de la puerta (desde ambos lados)
          const [ax, az, bx, bz] = cellSide(x, z, dx, dz);
          const zn = Z(l, nx, nz);
          const st = zn >= 0 ? styleOfZone(zn) : DEFAULT_STYLE;
          vquad(st.outdoor ? 'c_ashlar' : st.up, ax, az, bx, bz, Y + DOOR_H, Y + h, dx, dz);
          continue;
        }
        if (t === C.DOOR) continue;
        const [ax, az, bx, bz] = cellSide(x, z, dx, dz);
        const outside = isOutdoorOpen(l, nx, nz) || nt === C.OPEN || nt === C.VOID;
        const zn = FLOORISH.has(nt) ? Z(l, nx, nz) : (nt === C.STAIR || nt === C.HOLE) ? nearbyZone(l, nx, nz) : -1;
        const inner = !outside && zn >= 0;
        const faceTop = outside && !garden ? Y + h : topY;
        const y0 = Y;
        if (t === C.WINDOW) {
          // muro con el hueco de la ventana: antepecho y dintel
          const mk = inner ? styleOfZone(zn).up : 'c_ashlar';
          vquad(inner ? styleOfZone(zn).low : 'c_ashlar', ax, az, bx, bz, y0, Y + WIN.sill, dx, dz);
          vquad(mk, ax, az, bx, bz, Y + WIN.top, faceTop, dx, dz);
          continue;
        }
        if (inner) {
          const st = styleOfZone(zn);
          const lowTop = Math.min(faceTop, Y + st.lowH);
          vquad(st.low, ax, az, bx, bz, y0, lowTop, dx, dz);
          if (faceTop > lowTop) vquad(st.up, ax, az, bx, bz, lowTop, faceTop, dx, dz);
          // moldura entre zócalo y papel
          if (st.low === 'c_panel' && faceTop > lowTop) {
            const mx = (ax + bx) / 2 + dx * 0.02, mz = (az + bz) / 2 + dz * 0.02;
            box('c_darkwood', mx, lowTop, mz, dx !== 0 ? 0.05 : 1.0, 0.07, dz !== 0 ? 0.05 : 1.0, 0x5a3a24);
            // cornisa bajo el techo
            box('c_darkwood', mx, faceTop - 0.08, mz, dx !== 0 ? 0.1 : 1.0, 0.14, dz !== 0 ? 0.1 : 1.0, 0x4a2e1c);
          }
        } else {
          if (nt === C.VOID && l === 0) continue;   // bajo tierra: no se ve
          vquad(garden ? 'c_ashlar_dark' : 'c_ashlar', ax, az, bx, bz, y0, garden ? Y + 0.9 : faceTop, dx, dz);
          // ventanas decorativas iluminadas en las fachadas (plantas sobre el suelo)
          if (!garden && l >= 1 && ((x * 7 + z * 13) % 4 === 0) && faceTop - Y > 3.2) {
            const mx = (ax + bx) / 2 + dx * 0.03, mz = (az + bz) / 2 + dz * 0.03;
            const ry = dx !== 0 ? Math.PI / 2 : 0;
            box('window_lit', mx, Y + 2.2, mz, 0.62, 1.5, 0.02, rng() < 0.35 ? 0x201810 : 0xffb870, ry);
            box('c_ashlar', mx + dx * 0.04, Y + 2.2, mz + dz * 0.04, 0.8, 0.1, 0.06, 0x9a948a, ry);
            box('c_ashlar', mx + dx * 0.05, Y + 3.0, mz + dz * 0.05, 0.84, 0.14, 0.1, 0xa8a296, ry);
            box('c_ashlar', mx + dx * 0.05, Y + 1.42, mz + dz * 0.05, 0.9, 0.1, 0.14, 0xa8a296, ry);
          }
        }
      }
      // tapia: base de piedra + verja de hierro con puntas
      if (garden) {
        box('c_ashlar_dark', x + 0.5, Y + 0.45, z + 0.5, 1.0, 0.9, 1.0);
        box('c_ashlar', x + 0.5, Y + 0.93, z + 0.5, 1.08, 0.08, 1.08, 0x9a948a);
        const alongX = T(l, x - 1, z) === C.WALL || T(l, x + 1, z) === C.WALL;
        for (let k = 0; k < 4; k++) {
          const o = -0.375 + k * 0.25;
          const px = alongX ? x + 0.5 + o : x + 0.5, pz = alongX ? z + 0.5 : z + 0.5 + o;
          box('c_iron', px, Y + 0.97 + (GARDEN_H - 0.97) / 2, pz, 0.035, GARDEN_H - 0.97, 0.035);
          cyl('c_iron', px, Y + GARDEN_H + 0.05, pz, 0, 0.035, 0.12, 4);
        }
        box('c_iron', x + 0.5, Y + GARDEN_H - 0.2, z + 0.5, alongX ? 1.0 : 0.04, 0.04, alongX ? 0.04 : 1.0);
        box('c_iron', x + 0.5, Y + 1.25, z + 0.5, alongX ? 1.0 : 0.04, 0.04, alongX ? 0.04 : 1.0);
        continue;
      }
      // coronación del muro: tapa y almenas si por encima hay aire
      const above = l + 1 < NL ? T(l + 1, x, z) : C.VOID;
      if (above !== C.WALL && above !== C.WINDOW && above !== C.DOOR && t !== C.DOOR) {
        const exterior = DIR4.some(([dx, dz]) => { const nt = T(l, x + dx, z + dz); return nt === C.OUTSIDE || nt === C.OPEN || nt === C.VOID; });
        hquad('c_ashlar_dark', x, z, x + 1, z + 1, Y + h, true);
        if (exterior && above !== C.FLOOR && above !== C.HOLE) {
          // almena cada dos celdas
          if ((x + z) % 2 === 0) box('c_ashlar', x + 0.5, Y + h + 0.45, z + 0.5, 1.0, 0.9, 1.0, 0x8a847a);
        }
      }
      // ventanas: marco de piedra y parteluz con arco
      if (t === C.WINDOW) {
        const w = M.WINDOW_INFO[M.cellWindowL[l][idx(x, z)]];
        if (w) {
          const d = DIRS[w.dir];
          const along = d.dx !== 0 ? 'z' : 'x';
          const cx = x + 0.5, cz = z + 0.5;
          for (const s of [-1, 1]) {
            const ox = along === 'x' ? s * 0.5 : 0, oz = along === 'z' ? s * 0.5 : 0;
            box('c_ashlar', cx + ox * 0.94, Y + (WIN.sill + WIN.top) / 2, cz + oz * 0.94, along === 'x' ? 0.08 : 1.1, WIN.top - WIN.sill, along === 'z' ? 0.08 : 1.1, 0xa29c92);
          }
          box('c_ashlar', cx, Y + WIN.sill - 0.04, cz, along === 'x' ? 1.1 : 1.2, 0.1, along === 'z' ? 1.1 : 1.2, 0xb0aa9e);
          box('c_ashlar', cx, Y + WIN.top + 0.05, cz, along === 'x' ? 1.1 : 1.2, 0.12, along === 'z' ? 1.1 : 1.2, 0xb0aa9e);
        }
      }
    }
  }

  // ------------------------------------------------------------------ 3) bordes de los huecos: canto del forjado y barandillas
  for (let l = 1; l < NL; l++) {
    const Y = M.levels[l].y;
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const t = T(l, x, z);
      if (!FLOORISH.has(t)) continue;
      for (const [dx, dz] of DIR4) {
        const nt = T(l, x + dx, z + dz);
        if (nt !== C.HOLE && nt !== C.OPEN) continue;
        const [ax, az, bx, bz] = cellSide(x, z, dx, dz);
        // canto del forjado visto desde abajo
        vquad('c_darkwood', ax, az, bx, bz, Y - SLAB, Y, dx, dz, 0x4a2e1c);
        // ¿llegada de una escalera? (sin barandilla)
        const s = M.stairIdx[idx(x + dx, z + dz)];
        if (s >= 0) {
          const st = M.STAIRS[s];
          const d = DIRS[st.dir];
          if (st.lv + 1 === l && d.dx === -dx && d.dz === -dz) continue;
        }
        const outdoor = nt === C.OPEN;
        balustrade(ax, az, bx, bz, Y, outdoor);
      }
    }
  }
  function balustrade(ax, az, bx, bz, Y, outdoor) {
    const mat = outdoor ? 'c_ashlar' : 'c_darkwood';
    const col = outdoor ? 0xb0aa9e : 0x5a3a24;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const alongX = Math.abs(bx - ax) > 0.5;
    box(mat, mx, Y + 1.0, mz, alongX ? 1.0 : 0.12, 0.08, alongX ? 0.12 : 1.0, col);   // pasamanos
    box(mat, mx, Y + 0.08, mz, alongX ? 1.0 : 0.14, 0.16, alongX ? 0.14 : 1.0, col);  // zócalo
    for (let k = 0; k < 4; k++) {
      const o = -0.375 + k * 0.25;
      const px = alongX ? mx + o : mx, pz = alongX ? mz : mz + o;
      if (outdoor) box(mat, px, Y + 0.55, pz, 0.1, 0.8, 0.1, col);
      else cyl(mat, px, Y + 0.55, pz, 0.03, 0.045, 0.8, 6, col);
    }
  }

  // ------------------------------------------------------------------ 4) escaleras
  for (const st of M.STAIRS) {
    const d = DIRS[st.dir];
    const y0 = M.baseY(st.lv), y1 = M.baseY(st.lv + 1);
    const len = d.dx !== 0 ? st.x1 - st.x0 + 1 : st.z1 - st.z0 + 1;
    const wid = d.dx !== 0 ? st.z1 - st.z0 + 1 : st.x1 - st.x0 + 1;
    const n = Math.round(len * 4);
    const rise = (y1 - y0) / n, run = len / n;
    const style = st.style || 'stone';
    const stepMat = style === 'grand' ? 'c_marble_w' : style === 'wood' ? 'c_darkwood' : 'c_flagstone';
    // eje: u a lo largo (de abajo arriba), v a lo ancho
    const cx0 = (st.x0 + st.x1 + 1) / 2, cz0 = (st.z0 + st.z1 + 1) / 2;
    const bottom = { x: cx0 - d.dx * len / 2, z: cz0 - d.dz * len / 2 };
    const yaw = Math.atan2(d.dx, d.dz);
    for (let i = 0; i < n; i++) {
      const top = y0 + rise * (i + 1);
      const u = run * (i + 0.5);
      const px = bottom.x + d.dx * u, pz = bottom.z + d.dz * u;
      // cuerpo macizo del peldaño hasta el suelo (madera o piedra) y huella encima
      const hgt = top - y0;
      const bodyMat = style === 'grand' ? 'c_darkwood' : stepMat;
      box(bodyMat, px, y0 + (hgt - 0.04) / 2, pz, wid, hgt - 0.04, run + 0.002, style === 'grand' ? 0x5a3a24 : undefined, yaw);
      box(stepMat, px, top - 0.02, pz, wid + 0.04, 0.04, run + 0.03, style === 'grand' ? 0xcfc8ba : undefined, yaw);
      if (style === 'grand') box('c_velvet', px, top + 0.006, pz, wid * 0.6, 0.012, run, 0x7a1018, yaw);
    }
    // barandillas en los costados abiertos
    const sideDirs = d.dx !== 0 ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
    for (const [sx, sz] of sideDirs) {
      let open = false;
      for (let k = 0; k < len; k++) {
        const cx = d.dx !== 0 ? st.x0 + k : (sx < 0 ? st.x0 - 1 : st.x1 + 1);
        const cz = d.dx !== 0 ? (sz < 0 ? st.z0 - 1 : st.z1 + 1) : st.z0 + k;
        const tt = T(st.lv, cx, cz);
        if (tt !== C.WALL && tt !== C.VOID) open = true;
      }
      if (!open) continue;
      const off = wid / 2 - 0.08;
      const ex = sx * off, ez = sz * off;
      const bx = bottom.x + ex, bz = bottom.z + ez;
      const tx = bottom.x + d.dx * len + ex, tz = bottom.z + d.dz * len + ez;
      const midX = (bx + tx) / 2, midZ = (bz + tz) / 2, midY = (y0 + y1) / 2 + 0.95;
      const L = Math.hypot(len, y1 - y0);
      const pitch = Math.atan2(y1 - y0, len);
      box('c_darkwood', midX, midY, midZ, 0.1, 0.08, L, 0x5a3a24, yaw, -pitch);
      box('c_darkwood', midX, (y0 + y1) / 2 + 0.1, midZ, 0.12, 0.16, L, 0x5a3a24, yaw, -pitch);
      const posts = Math.round(len * 3);
      for (let k = 0; k <= posts; k++) {
        const f = k / posts;
        const py = y0 + (y1 - y0) * f;
        cyl('c_darkwood', bx + (tx - bx) * f, py + 0.5, bz + (tz - bz) * f, 0.028, 0.04, 0.95, 6, 0x5a3a24);
      }
      // pilares de arranque y llegada
      cyl('c_darkwood', bx, y0 + 0.6, bz, 0.09, 0.1, 1.2, 8, 0x4a2e1c);
      cyl('c_brass', bx, y0 + 1.25, bz, 0.08, 0.08, 0.1, 8);
    }
  }

  // ------------------------------------------------------------------ 5) tejados sobre las plantas más altas y terreno
  for (let l = 0; l < NL; l++) {
    const Y = M.levels[l].y, h = M.levels[l].h;
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const t = T(l, x, z);
      if (!(FLOORISH.has(t) || t === C.HOLE || t === C.STAIR)) continue;
      const zn = t === C.HOLE ? nearbyZone(l, x, z) : Z(l, x, z);
      if (zn >= 0 && !M.ZONES[zn].indoor) continue;
      const above = l + 1 < NL ? T(l + 1, x, z) : C.VOID;
      if (above !== C.VOID && above !== C.OPEN) continue;
      // azotea de losas con una pizca de desnivel para que no coincida con las almenas
      hquad('c_roof', x, z, x + 1, z + 1, Y + h + 0.02, true, 0x5a5e66);
    }
  }
  // terreno alrededor del castillo (por debajo de los suelos: no se ve desde dentro)
  {
    const s = 1 / tileOf('terrain');
    Q('terrain').quad([-150, -0.04, 150], [150, -0.04, 150], [150, -0.04, -150], [-150, -0.04, -150], [0, 1, 0],
      [-150 * s, -150 * s], [150 * s, -150 * s], [150 * s, 150 * s], [-150 * s, 150 * s], 0x5a6650);
  }

  // ------------------------------------------------------------------ 6) torres decorativas en las esquinas del edificio
  const towers = [[4.5, 4.5], [W - 4.5, 4.5], [4.5, 46.5], [W - 4.5, 46.5]];
  for (const [tx, tz] of towers) {
    cyl('c_ashlar', tx, 7, tz, 2.4, 2.6, 18, 16, 0x9a948a);
    cyl('c_ashlar_dark', tx, 16.3, tz, 2.7, 2.6, 0.6, 16);
    cyl('c_roof', tx, 19.5, tz, 0, 3.0, 6, 16, 0x3a3e48);
    cyl('c_iron', tx, 23, tz, 0.04, 0.04, 1.4, 4);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + 0.4;
      box('window_lit', tx + Math.cos(a) * 2.45, 11 + rng() * 3, tz + Math.sin(a) * 2.45, 0.5, 1.2, 0.5, 0xffc070);
    }
  }
  // gran torre central sobre el salón de baile
  {
    const cx = W / 2, cz = 12;
    cyl('c_ashlar', cx, 18, cz, 3.2, 3.4, 5, 16, 0x9a948a);
    cyl('c_roof', cx, 23.5, cz, 0, 4.0, 7, 16, 0x3a3e48);
  }

  for (const e of qbs.values()) {
    const g = e.q.toGeometry();
    if (g) batch.addGeometry(e.key, g, e.ch);
  }
}
