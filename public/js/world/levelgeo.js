// Geometría estática del nivel a partir de shared/map.js: suelos por zona, muros con solo las caras visibles,
// techos interiores, fachadas altas hacia la calle, vallas y suelo de los callejones, huecos de las ventanas,
// terreno exterior y siluetas lejanas en la niebla. Todo se acumula en un StaticBatch (fusión por material).
import * as THREE from 'three';
import {
  W, H, C, WALL_H, FENCE_H, CEIL_H, ZONES, WINDOW_INFO, WALL_KIND, DIRS, DOORS,
  cellWallKind, idx, typeAt, zoneAt,
} from '/shared/map.js';
import { MAT_DEFS, QuadBuilder, matrixFrom, yawForFace } from './kit.js';
import { makeRng } from './textures.js';

export const DOOR_H = 2.6;                              // altura del hueco de las puertas
export const WIN = { sill: 0.55, top: 2.35, side: 0.12 }; // hueco de las ventanas con barricada
export const EXT_H = 4.5;                               // altura exterior de los edificios vista desde los callejones

// Estilo de cada zona (materiales de MaterialLib y tintes de vértice)
export const ZONE_STYLE = {
  0: { floor: 'floor_tiles', floorColor: 0xe4e0d6, low: 'zoc_tile', lowColor: 0xffffff, lowH: 1.1, up: 'wall_plaster', upColor: 0xc9d1d6, ceil: 'ceil_tiles', ceilColor: 0xd6d4cc },
  1: { floor: 'floor_asphalt', floorColor: 0xffffff, low: 'zoc_stone', lowColor: 0xa29c94, lowH: 0.6, up: 'facade_brick', upColor: 0xffffff },
  2: { floor: 'floor_wood', floorColor: 0xd2b090, low: 'zoc_wood', lowColor: 0xffffff, lowH: 1.0, up: 'wall_paper', upColor: 0xf0e6dc, ceil: 'ceil_wood', ceilColor: 0xb89878 },
  3: { floor: 'floor_concrete', floorColor: 0xbab6ae, low: 'zoc_paint', lowColor: 0xb4c4b0, lowH: 1.2, up: 'wall_block', upColor: 0xd0ccc4, ceil: 'ceil_metal', ceilColor: 0x9a9a98 },
  4: { floor: 'floor_metal', floorColor: 0xa4a4a0, low: 'zoc_hazard', lowColor: 0xffffff, lowH: 0.35, up: 'concrete', upColor: 0xa2aca2, ceil: 'ceil_concrete', ceilColor: 0xa6a49e },
};

// Fachadas hacia la calle. side = dónde está el muro visto desde la calle:
//  N: fila z=19 (cara z=20) · S: fila z=32 (cara z=32) · W: columna x=18 (cara x=19) · E: columna x=55 (cara x=55)
// a0..a1 = tramo sobre la línea del muro; top = altura; depth = fondo hacia atrás; alley = hueco bajo sobre un callejón
export const FACADES = [
  { side: 'W', a0: 19, a1: 33, top: 6.4, depth: 3.5, mat: 'facade_stucco', color: 0x9aa6b8, name: 'terminal' },
  { side: 'N', a0: 18, a1: 37, top: 8.2, depth: 3.5, mat: 'facade_brick', color: 0xb09484, name: 'almacen' },
  { side: 'N', a0: 37, a1: 56, top: 10.2, depth: 3.5, mat: 'wall_block', color: 0x9aa098, name: 'planta' },
  { side: 'S', a0: 18, a1: 25, top: 9.4, depth: 3.5, mat: 'facade_brick', color: 0xa27060, name: 'hotel' },
  { side: 'S', a0: 25, a1: 28, top: 4.4, depth: 0.98, mat: 'facade_brick', color: 0x8a7a70, alley: true },
  { side: 'S', a0: 28, a1: 39, top: 7.2, depth: 3.5, mat: 'facade_stucco', color: 0xc2b292, name: 'farmacia' },
  { side: 'S', a0: 39, a1: 42, top: 4.4, depth: 0.98, mat: 'facade_brick', color: 0x8a7a70, alley: true },
  { side: 'S', a0: 42, a1: 49, top: 8.6, depth: 3.5, mat: 'facade_brick', color: 0x927e70, name: 'tienda' },
  { side: 'S', a0: 49, a1: 52, top: 4.4, depth: 0.98, mat: 'facade_brick', color: 0x8a7a70, alley: true },
  { side: 'S', a0: 52, a1: 56, top: 6.6, depth: 3.5, mat: 'facade_stucco', color: 0xa89a84, name: 'esquina' },
  { side: 'E', a0: 19, a1: 24, top: 7.6, depth: 3.5, mat: 'facade_brick', color: 0x9e8072, name: 'este1' },
  { side: 'E', a0: 24, a1: 27, top: 4.4, depth: 0.98, mat: 'facade_brick', color: 0x8a7a70, alley: true },
  { side: 'E', a0: 27, a1: 33, top: 8.0, depth: 3.5, mat: 'facade_stucco', color: 0xaa9e90, name: 'este2' },
];

const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
const FACE_LINE = { N: 20, S: 32, W: 19, E: 55 };     // coordenada de la cara que da a la calle
const FACE_OUT = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] }; // normal hacia la calle

// Punto de mundo sobre una fachada: a = coordenada a lo largo del muro, out = metros hacia la calle
export function facadePoint(side, a, out) {
  const n = FACE_OUT[side], L = FACE_LINE[side];
  if (side === 'N' || side === 'S') return [a, L + n[1] * out];
  return [L + n[0] * out, a];
}
// Yaw de un plano (+Z) que mira hacia la calle desde la fachada
export function facadePlaneYaw(side) { return yawForFace(side); }
// Yaw de un modelo (frente -Z) que mira hacia la calle
export function facadeModelYaw(side) { return yawForFace(OPP[side]); }

export function facadeAt(side, a) {
  for (const f of FACADES) if (f.side === side && a >= f.a0 && a < f.a1) return f;
  return null;
}

// Marco local de una ventana: origen en la cara interior (a ras del suelo, centro del hueco),
// +Z local hacia el interior, X local a lo largo del muro.
export function windowFrame(w) {
  const d = DIRS[w.dir];
  let x, z;
  if (d.dx !== 0) { x = d.dx > 0 ? w.x : w.x + 1; z = w.z + 0.5; }
  else { z = d.dz > 0 ? w.z : w.z + 1; x = w.x + 0.5; }
  return { x, z, yaw: yawForFace(w.dir), inX: -d.dx, inZ: -d.dz, outX: d.dx, outZ: d.dz };
}

// ---------------------------------------------------------------------------------------------
export function buildLevelGeometry(batch) {
  const rng = makeRng(20260925);
  const qbs = new Map();
  const Q = (k) => { let q = qbs.get(k); if (!q) { q = new QuadBuilder(); qbs.set(k, q); } return q; };
  const tileOf = (k) => (MAT_DEFS[k] && MAT_DEFS[k].tile) || 1;

  // Quad vertical sobre el segmento (ax,az)-(bx,bz), normal (nx,0,nz)
  function vquad(key, ax, az, bx, bz, y0, y1, nx, nz, color) {
    if (y1 - y0 < 1e-4) return;
    const rx = nz, rz = -nx;
    if ((bx - ax) * rx + (bz - az) * rz < 0) { let t = ax; ax = bx; bx = t; t = az; az = bz; bz = t; }
    const s = 1 / tileOf(key);
    const ua = (ax * rx + az * rz) * s, ub = (bx * rx + bz * rz) * s;
    Q(key).quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [nx, 0, nz],
      [ua, y0 * s], [ub, y0 * s], [ub, y1 * s], [ua, y1 * s], color);
  }
  // Quad horizontal (suelo hacia arriba o techo hacia abajo)
  function hquad(key, x0, z0, x1, z1, y, up, color) {
    const s = 1 / tileOf(key);
    if (up) {
      Q(key).quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0],
        [x0 * s, -z1 * s], [x1 * s, -z1 * s], [x1 * s, -z0 * s], [x0 * s, -z0 * s], color);
    } else {
      Q(key).quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0],
        [x0 * s, z0 * s], [x1 * s, z0 * s], [x1 * s, z1 * s], [x0 * s, z1 * s], color);
    }
  }
  // Calcomanía en el suelo con UV 0..1 (rotada)
  function decal(key, cx, cz, size, rot, y, color) {
    const c = Math.cos(rot) * size / 2, s = Math.sin(rot) * size / 2;
    const p = (u, v) => [cx + u * c - v * s, y, cz + u * s + v * c];
    Q(key).quad(p(-1, 1), p(1, 1), p(1, -1), p(-1, -1), [0, 1, 0], [0, 0], [1, 0], [1, 1], [0, 1], color);
  }
  // Caja con UV proyectadas en coordenadas de mundo
  function box(key, cx, cy, cz, sx, sy, sz, color, ry = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    batch.add(key, g, matrixFrom(cx, cy, cz, 0, ry, 0), color, MAT_DEFS[key] && MAT_DEFS[key].tile ? tileOf(key) : null);
    g.dispose();
  }
  // Segmento del borde de una celda en la dirección (dx,dz)
  function cellSide(sx, sz, dx, dz) {
    if (dx === 1) return [sx + 1, sz, sx + 1, sz + 1];
    if (dx === -1) return [sx, sz, sx, sz + 1];
    if (dz === 1) return [sx, sz + 1, sx + 1, sz + 1];
    return [sx, sz, sx + 1, sz];
  }
  // Material de la parte alta de un muro que da a la zona (la calle usa el de su fachada)
  function upperOf(zoneId, sx, sz, dx, dz) {
    const st = ZONE_STYLE[zoneId] || ZONE_STYLE[0];
    if (zoneId !== 1) return [st.up, st.upColor];
    let side, a;
    if (dz === 1) { side = 'N'; a = sx + 0.5; } else if (dz === -1) { side = 'S'; a = sx + 0.5; }
    else if (dx === 1) { side = 'W'; a = sz + 0.5; } else { side = 'E'; a = sz + 0.5; }
    const f = facadeAt(side, a);
    return f ? [f.mat, f.color] : [st.up, st.upColor];
  }
  // Cara de muro hacia una zona: zócalo + parte alta
  function zoneFace(sx, sz, dx, dz, zoneId, y0, y1) {
    const st = ZONE_STYLE[zoneId] || ZONE_STYLE[0];
    const [ax, az, bx, bz] = cellSide(sx, sz, dx, dz);
    const lowTop = Math.min(y1, st.lowH);
    if (lowTop > y0) vquad(st.low, ax, az, bx, bz, y0, lowTop, dx, dz, st.lowColor);
    const [uk, uc] = upperOf(zoneId, sx, sz, dx, dz);
    const u0 = Math.max(y0, st.lowH);
    if (y1 > u0) vquad(uk, ax, az, bx, bz, u0, y1, dx, dz, uc);
  }

  const isOpenCell = (t) => t === C.FLOOR || t === C.PROP;
  const DIR4 = [DIRS.N, DIRS.S, DIRS.E, DIRS.W];

  // ------------------------------------------------------------------ muros, callejones y vallas
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const t = typeAt(x, z);
      if (t === C.WALL) {
        const fence = cellWallKind[idx(x, z)] === WALL_KIND.FENCE;
        for (const d of DIR4) {
          const nxc = x + d.dx, nzc = z + d.dz;
          const nt = typeAt(nxc, nzc);
          if (isOpenCell(nt)) {
            zoneFace(x, z, d.dx, d.dz, zoneAt(nxc, nzc), 0, zoneAt(nxc, nzc) === 1 ? WALL_H : CEIL_H);
          } else if (nt === C.DOOR) {
            const [ax, az, bx, bz] = cellSide(x, z, d.dx, d.dz);
            vquad('concrete', ax, az, bx, bz, 0, DOOR_H, d.dx, d.dz, 0x9a968e);
          } else if (nt === C.OUTSIDE) {
            const [ax, az, bx, bz] = cellSide(x, z, d.dx, d.dz);
            if (fence) vquad('fence', ax, az, bx, bz, 0, FENCE_H, d.dx, d.dz, 0xffffff);
            else vquad('wall_ext', ax, az, bx, bz, 0, EXT_H, d.dx, d.dz, 0xffffff);
          }
        }
      } else if (t === C.OUTSIDE) {
        hquad('floor_dirt', x, z, x + 1, z + 1, 0, true, 0xb8b0a4);
        for (const d of DIR4) {
          const nxc = x + d.dx, nzc = z + d.dz;
          if (nxc < 0 || nzc < 0 || nxc >= W || nzc >= H) {
            const [ax, az, bx, bz] = cellSide(x, z, d.dx, d.dz);
            vquad('fence', ax, az, bx, bz, 0, FENCE_H, -d.dx, -d.dz, 0xe0e0e0);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ suelos y techos por zona
  for (const zn of ZONES) {
    const st = ZONE_STYLE[zn.id];
    if (zn.id === 1) buildStreetFloor(zn);
    else hquad(st.floor, zn.x0, zn.z0, zn.x1 + 1, zn.z1 + 1, 0, true, st.floorColor);
    if (zn.indoor) hquad(st.ceil, zn.x0, zn.z0, zn.x1 + 1, zn.z1 + 1, CEIL_H, false, st.ceilColor);
  }

  function buildStreetFloor(zn) {
    const X0 = zn.x0, X1 = zn.x1 + 1, Z0 = zn.z0, Z1 = zn.z1 + 1; // 19..55 x 20..32
    const ax0 = X0 + 2, ax1 = X1 - 2, az0 = Z0 + 2, az1 = Z1 - 2;  // calzada (con bordillos)
    const cb = 0.25;
    // aceras
    hquad('floor_sidewalk', X0, Z0, X1, az0, 0, true, 0xd0ccc4);
    hquad('floor_sidewalk', X0, az1, X1, Z1, 0, true, 0xd0ccc4);
    hquad('floor_sidewalk', X0, az0, ax0, az1, 0, true, 0xd0ccc4);
    hquad('floor_sidewalk', ax1, az0, X1, az1, 0, true, 0xd0ccc4);
    // bordillos
    hquad('cap', ax0, az0, ax1, az0 + cb, 0, true, 0xb8b4ac);
    hquad('cap', ax0, az1 - cb, ax1, az1, 0, true, 0xb8b4ac);
    hquad('cap', ax0, az0 + cb, ax0 + cb, az1 - cb, 0, true, 0xb8b4ac);
    hquad('cap', ax1 - cb, az0 + cb, ax1, az1 - cb, 0, true, 0xb8b4ac);
    // calzada
    hquad('floor_asphalt', ax0 + cb, az0 + cb, ax1 - cb, az1 - cb, 0, true, 0xffffff);
    // marcas viales: línea central discontinua, líneas de borde y paso de peatones
    const mid = (Z0 + Z1) / 2;
    for (let x = ax0 + 1.2; x < ax1 - 2; x += 4) hquad('paint', x, mid - 0.07, x + 2, mid + 0.07, 0.012, true, 0xd8b030);
    hquad('paint', ax0 + 0.6, az0 + 0.45, ax1 - 0.6, az0 + 0.55, 0.012, true, 0xcfcfcf);
    hquad('paint', ax0 + 0.6, az1 - 0.55, ax1 - 0.6, az1 - 0.45, 0.012, true, 0xcfcfcf);
    for (let k = 0; k < 7; k++) {
      const z = az0 + 0.6 + k * 0.95;
      hquad('paint', 29.2, z, 31.6, z + 0.5, 0.012, true, 0xe0e0e0);
    }
    decal('manhole', 31.2, 24.6, 0.9, 0.3, 0.014, 0xffffff);
    decal('manhole', 47.5, 28.2, 0.9, 1.1, 0.014, 0xffffff);
  }

  // Calcomanías de suciedad y sangre repartidas
  const decalZones = [[0, 14], [1, 26], [2, 12], [3, 14], [4, 12]];
  for (const [zid, n] of decalZones) {
    const zn = ZONES[zid];
    for (let i = 0; i < n; i++) {
      const x = zn.x0 + 0.5 + rng() * (zn.x1 - zn.x0);
      const z = zn.z0 + 0.5 + rng() * (zn.z1 - zn.z0);
      const blood = rng() < 0.3;
      decal(blood ? 'blood' : 'grime', x, z, blood ? 0.8 + rng() * 1.2 : 1.5 + rng() * 2.5, rng() * 6.3, 0.02 + i * 0.0003, blood ? 0xffffff : 0xdddddd);
    }
  }
  // Callejones: suciedad y sangre de los zombis
  for (const w of WINDOW_INFO) {
    decal('grime', w.spawn[0] + 0.5, w.spawn[1] + 0.5, 2.6, rng() * 6, 0.02, 0xffffff);
    decal('blood', w.tear[0] + 0.5, w.tear[1] + 0.5, 0.9 + rng() * 0.5, rng() * 6, 0.022, 0xffffff);
  }

  // ------------------------------------------------------------------ puertas (umbral, dintel y caras)
  for (const d of DOORS) {
    for (const [x, z] of d.cells) {
      hquad('floor_concrete', x, z, x + 1, z + 1, 0, true, 0x8e8a84);
      hquad('concrete', x, z, x + 1, z + 1, DOOR_H, false, 0x7a7670);
      for (const dd of DIR4) {
        const nt = typeAt(x + dd.dx, z + dd.dz);
        if (!isOpenCell(nt)) continue;
        const zid = zoneAt(x + dd.dx, z + dd.dz);
        const [uk, uc] = upperOf(zid, x, z, dd.dx, dd.dz);
        const [ax, az, bx, bz] = cellSide(x, z, dd.dx, dd.dz);
        vquad(uk, ax, az, bx, bz, DOOR_H, zid === 1 ? WALL_H : CEIL_H, dd.dx, dd.dz, uc);
      }
    }
  }

  // ------------------------------------------------------------------ ventanas: hueco, caras y marco
  for (const w of WINDOW_INFO) {
    const d = DIRS[w.dir];
    const alongX = d.dz !== 0;           // el muro corre a lo largo de X
    const a0 = alongX ? w.x : w.z;       // inicio del tramo del muro
    const s = WIN.side;
    const st = ZONE_STYLE[w.zone] || ZONE_STYLE[0];
    const inDx = -d.dx, inDz = -d.dz;
    const topIn = w.zone === 1 ? WALL_H : CEIL_H;
    // segmento sobre la cara (interior o exterior) entre a y b
    const seg = (outward, a, b) => {
      const c = outward ? (alongX ? (d.dz > 0 ? w.z + 1 : w.z) : (d.dx > 0 ? w.x + 1 : w.x))
        : (alongX ? (d.dz > 0 ? w.z : w.z + 1) : (d.dx > 0 ? w.x : w.x + 1));
      return alongX ? [a, c, b, c] : [c, a, c, b];
    };
    const [uk, uc] = upperOf(w.zone, w.x, w.z, inDx, inDz);
    // cara interior con hueco
    {
      const [p0x, p0z, p1x, p1z] = seg(false, a0, a0 + 1);
      const low = Math.min(st.lowH, WIN.sill);
      vquad(st.low, p0x, p0z, p1x, p1z, 0, low, inDx, inDz, st.lowColor);
      if (WIN.sill > low) vquad(uk, p0x, p0z, p1x, p1z, low, WIN.sill, inDx, inDz, uc);
      vquad(uk, p0x, p0z, p1x, p1z, WIN.top, topIn, inDx, inDz, uc);
      const [l0x, l0z, l1x, l1z] = seg(false, a0, a0 + s);
      const [r0x, r0z, r1x, r1z] = seg(false, a0 + 1 - s, a0 + 1);
      vquad(uk, l0x, l0z, l1x, l1z, WIN.sill, WIN.top, inDx, inDz, uc);
      vquad(uk, r0x, r0z, r1x, r1z, WIN.sill, WIN.top, inDx, inDz, uc);
    }
    // cara exterior con hueco
    {
      const [p0x, p0z, p1x, p1z] = seg(true, a0, a0 + 1);
      vquad('wall_ext', p0x, p0z, p1x, p1z, 0, WIN.sill, d.dx, d.dz, 0xffffff);
      vquad('wall_ext', p0x, p0z, p1x, p1z, WIN.top, EXT_H, d.dx, d.dz, 0xffffff);
      const [l0x, l0z, l1x, l1z] = seg(true, a0, a0 + s);
      const [r0x, r0z, r1x, r1z] = seg(true, a0 + 1 - s, a0 + 1);
      vquad('wall_ext', l0x, l0z, l1x, l1z, WIN.sill, WIN.top, d.dx, d.dz, 0xffffff);
      vquad('wall_ext', r0x, r0z, r1x, r1z, WIN.sill, WIN.top, d.dx, d.dz, 0xffffff);
    }
    // túnel: alféizar, dintel y jambas
    if (alongX) {
      const x0 = w.x + s, x1 = w.x + 1 - s;
      hquad('sill', x0, w.z, x1, w.z + 1, WIN.sill, true, 0xc0b0a0);
      hquad('concrete', x0, w.z, x1, w.z + 1, WIN.top, false, 0x8a8680);
      vquad('sill', x0, w.z, x0, w.z + 1, WIN.sill, WIN.top, 1, 0, 0xb0a090);
      vquad('sill', x1, w.z, x1, w.z + 1, WIN.sill, WIN.top, -1, 0, 0xb0a090);
    } else {
      const z0 = w.z + s, z1 = w.z + 1 - s;
      hquad('sill', w.x, z0, w.x + 1, z1, WIN.sill, true, 0xc0b0a0);
      hquad('concrete', w.x, z0, w.x + 1, z1, WIN.top, false, 0x8a8680);
      vquad('sill', w.x, z0, w.x + 1, z0, WIN.sill, WIN.top, 0, 1, 0xb0a090);
      vquad('sill', w.x, z1, w.x + 1, z1, WIN.sill, WIN.top, 0, -1, 0xb0a090);
    }
    // marco de madera en la cara interior
    const f = windowFrame(w);
    const P = batch.at(f.x, 0, f.z, f.yaw);
    const ow = 1 - 2 * s;
    P.box('wood', 0.08, WIN.top - WIN.sill + 0.16, 0.06, -ow / 2 - 0.02, (WIN.sill + WIN.top) / 2, 0.02, { color: 0x8a6a4a });
    P.box('wood', 0.08, WIN.top - WIN.sill + 0.16, 0.06, ow / 2 + 0.02, (WIN.sill + WIN.top) / 2, 0.02, { color: 0x8a6a4a });
    P.box('wood', ow + 0.2, 0.08, 0.06, 0, WIN.top + 0.04, 0.02, { color: 0x8a6a4a });
    P.box('wood', ow + 0.24, 0.06, 0.14, 0, WIN.sill - 0.02, 0.05, { color: 0x7a5a3a });
    // clavos y restos de tablas viejas junto a la ventana (decorado)
    P.box('wood', 0.5, 0.12, 0.03, -0.62, 0.08, 0.35, { color: 0x6a5038, ry: 0.4, rz: 0.1 });
  }

  // ------------------------------------------------------------------ fachadas altas de la calle
  for (const f of FACADES) buildFacade(f);

  function buildFacade(f) {
    const len = f.a1 - f.a0, mid = (f.a0 + f.a1) / 2;
    const n = FACE_OUT[f.side];
    const yaw = facadePlaneYaw(f.side);
    const h = f.top - WALL_H;
    // bloque superior (desde la línea de la cara hacia atrás)
    const [cx, cz] = facadePoint(f.side, mid, -f.depth / 2);
    box(f.mat, cx, WALL_H + h / 2, cz, len, h, f.depth, f.color, yaw);
    // relleno inferior detrás de los muros del sur y del este (se ve desde los callejones)
    if (!f.alley && (f.side === 'S' || f.side === 'E')) {
      const back = f.depth - 1;
      const [fx, fz] = facadePoint(f.side, mid, -1 - back / 2);
      box(f.mat, fx, WALL_H / 2, fz, len - 0.04, WALL_H, back, f.color, yaw);
    }
    // imposta a la altura del primer piso y cornisa
    {
      const [ix, iz] = facadePoint(f.side, mid, 0.03);
      box('cap', ix, WALL_H + 0.1, iz, len, 0.2, 0.18, 0xa8a49c, yaw);
      const [kx, kz] = facadePoint(f.side, mid, 0.08);
      box('cap', kx, f.top - 0.15, kz, len + (f.alley ? 0 : 0.1), 0.3, f.alley ? 0.2 : 0.36, 0x9c988f, yaw);
    }
    if (f.alley) return;
    // ventanas de los pisos altos
    for (let y = 5.7; y + 1.4 < f.top - 0.45; y += 2.6) {
      for (let a = f.a0 + 1.3; a < f.a1 - 0.9; a += 2.4) {
        if (f.name && y < 7 && signSpan(f, a)) continue;
        const lit = rng() < 0.12, broken = !lit && rng() < 0.15;
        const [gx, gz] = facadePoint(f.side, a, 0.015);
        const M = matrixFrom(gx, y + 0.7, gz, 0, yaw, 0);
        const g = new THREE.PlaneGeometry(1.0, 1.4);
        batch.add(lit ? 'window_lit' : broken ? 'dark' : 'glass', g, M, lit ? (rng() < 0.7 ? 0xffc890 : 0x9ec0ff) : 0xffffff, null);
        g.dispose();
        const [sx, sz] = facadePoint(f.side, a, 0.06);
        box('cap', sx, y - 0.05, sz, 1.25, 0.1, 0.14, 0xb0aca4, yaw);
        box('cap', sx, y + 1.47, sz, 1.2, 0.12, 0.1, 0xa0a098, yaw);
        // travesaño central
        const [mx, mz] = facadePoint(f.side, a, 0.03);
        box('wood', mx, y + 0.7, mz, 0.05, 1.4, 0.04, 0x3a3028, yaw);
        box('wood', mx, y + 0.95, mz, 1.0, 0.05, 0.04, 0x3a3028, yaw);
      }
    }
    void n;
  }
  // tramos reservados para carteles en las fachadas
  function signSpan(f, a) {
    const c = { terminal: [23, 29], almacen: [30, 34], planta: [43, 50], hotel: [19.5, 23.5], farmacia: [29, 33.5] }[f.name];
    return c ? a > c[0] - 0.8 && a < c[1] + 0.8 : false;
  }

  // ------------------------------------------------------------------ exterior: terreno y siluetas
  hquad('terrain', -150, -150, 210, 190, -0.03, true, 0x6a7466);
  buildOutskirts(batch, box, rng);

  for (const [k, q] of qbs) batch.addGeometry(k, q.toGeometry());
}

// Siluetas del pueblo alrededor del mapa (se ven como sombras en la niebla)
function buildOutskirts(batch, box, rng) {
  // Bloques de edificios lejanos
  const blocks = [
    [70, 8, 12, 24, 12], [72, 30, 12, 18, 10], [84, -6, 14, 30, 12], [80, 46, 12, 22, 14], [66, 58, 10, 14, 10],
    [10, -22, 16, 20, 10], [34, -28, 20, 26, 12], [56, -20, 10, 16, 10], [-6, -30, 12, 28, 12],
    [-20, 6, 12, 22, 14], [-24, 30, 14, 18, 12], [-16, 52, 12, 16, 10],
    [14, 56, 18, 16, 12], [38, 62, 14, 28, 14], [60, 70, 16, 20, 12], [-2, 70, 12, 24, 12],
  ];
  for (const [x, z, w, h, d] of blocks) {
    const tint = 0x9098a0 + ((rng() * 0x10) | 0) * 0x010101;
    box('buildings', x, h / 2, z, w, h, d, tint, (rng() - 0.5) * 0.3);
    box('roof', x, h + 0.4, z, w * 0.9, 0.8, d * 0.9, 0x707070, 0);
    if (rng() < 0.6) box('metal', x + (rng() - 0.5) * w * 0.5, h + 1.6, z + (rng() - 0.5) * d * 0.4, 1.6, 2.4, 1.6, 0x505458, 0);
  }
  // Depósito de agua
  {
    const x = 66, z = 40, r = 3.4, leg = 16;
    for (const [dx, dz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) box('rust', x + dx, leg / 2, z + dz, 0.35, leg, 0.35, 0x6a5040);
    box('rust', x, leg * 0.5, z, 4.6, 0.2, 0.2, 0x5a4034); box('rust', x, leg * 0.5, z, 0.2, 0.2, 4.6, 0x5a4034);
    const tank = new THREE.CylinderGeometry(r, r, 5, 18);
    batch.add('rust', tank, matrixFrom(x, leg + 2.5, z), 0x7a6250, 1); tank.dispose();
    const roof = new THREE.ConeGeometry(r * 1.05, 2.2, 18);
    batch.add('rust', roof, matrixFrom(x, leg + 6.1, z), 0x5a4a40, 1); roof.dispose();
  }
  // Chimenea de fábrica
  {
    const g = new THREE.CylinderGeometry(1.0, 1.5, 34, 14);
    batch.add('brickp', g, matrixFrom(-9, 17, 14), 0x8a5a48, 2); g.dispose();
    box('buildings', -12, 7, 20, 16, 14, 12, 0x8a9098, 0.1);
  }
  // Antena de radio
  {
    const g = new THREE.CylinderGeometry(0.12, 0.5, 44, 6);
    batch.add('metal', g, matrixFrom(30, 22, -34), 0x505458, 1); g.dispose();
    for (let y = 4; y < 42; y += 6) box('metal', 30, y, -34, 3.2 * (1 - y / 50), 0.12, 0.12, 0x505458);
  }
  // Pinos alrededor del pueblo
  const treeSpots = [];
  for (let i = 0; i < 70; i++) {
    const side = i % 4;
    let x, z;
    if (side === 0) { x = -6 + rng() * 72; z = -4 - rng() * 11; }
    else if (side === 1) { x = -6 + rng() * 72; z = 39 + rng() * 9; }
    else if (side === 2) { x = -4 - rng() * 8; z = -4 + rng() * 44; }
    else { x = 60.5 + rng() * 3.5; z = -4 + rng() * 44; }
    treeSpots.push([x, z]);
  }
  for (const [x, z] of treeSpots) {
    const h = 9 + rng() * 9;
    const trunk = new THREE.CylinderGeometry(0.18, 0.28, h * 0.4, 5);
    batch.add('trees', trunk, matrixFrom(x, h * 0.2, z), 0x2a2018, null); trunk.dispose();
    for (let k = 0; k < 3; k++) {
      const r = (1.9 - k * 0.45) * (h / 14);
      const cone = new THREE.ConeGeometry(r * 1.6, h * 0.42, 7);
      batch.add('trees', cone, matrixFrom(x, h * (0.38 + k * 0.2), z, 0, rng() * 3, 0), 0x1c2a20, null); cone.dispose();
    }
  }
}
