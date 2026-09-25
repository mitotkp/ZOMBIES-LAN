// Navegación de zombis sobre la cuadrícula: campos de flujo (Dijkstra multi-origen, 8 direcciones,
// sin cortar esquinas) y utilidades de línea libre / puntos aleatorios transitables.
// Lo usan server/zombies.js y tools/bot-test.js.

import { W, H, idx, inBounds } from '../shared/map.js';
import { solidForZombieInside, circleBlocked } from '../shared/collision.js';

const SQRT2 = Math.SQRT2;
// Vecinos: [dx, dz, costo]
export const NEIGHBORS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

// Montículo binario mínimo con arreglos tipados (permite duplicados; borrado perezoso)
class MinHeap {
  constructor(capacity) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
    this.size = 0;
  }
  clear() { this.size = 0; }
  push(key, val) {
    if (this.size >= this.keys.length) this._grow();
    let i = this.size++;
    const keys = this.keys, vals = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p]; vals[i] = vals[p];
      i = p;
    }
    keys[i] = key; vals[i] = val;
  }
  // Devuelve el valor con menor clave; la clave queda en this.lastKey
  pop() {
    const keys = this.keys, vals = this.vals;
    const topVal = vals[0];
    this.lastKey = keys[0];
    const n = --this.size;
    if (n > 0) {
      const k = keys[n], v = vals[n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = (r < n && keys[r] < keys[l]) ? r : l;
        if (keys[c] >= k) break;
        keys[i] = keys[c]; vals[i] = vals[c];
        i = c;
      }
      keys[i] = k; vals[i] = v;
    }
    return topVal;
  }
  _grow() {
    const nk = new Float64Array(this.keys.length * 2);
    const nv = new Int32Array(this.vals.length * 2);
    nk.set(this.keys); nv.set(this.vals);
    this.keys = nk; this.vals = nv;
  }
}

// Clave compacta del estado de puertas (para saber si hay que recalcular la transitabilidad)
export function doorsKey(doors) {
  if (!doors) return '';
  return Object.keys(doors).filter((k) => doors[k]).sort().join(',');
}

export class FlowField {
  constructor() {
    this.dist = new Float32Array(W * H).fill(Infinity);
    this.walk = new Uint8Array(W * H);
    this.heap = new MinHeap(W * H * 4);
    this.walkKey = null;
    this.hasSources = false;
    this.version = 0;
  }

  // Recalcula qué celdas son transitables para un zombi DENTRO del área de juego
  updateWalkable(doors, solidFn = solidForZombieInside) {
    const key = doorsKey(doors);
    if (key === this.walkKey) return false;
    this.walkKey = key;
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) this.walk[idx(x, z)] = solidFn(x, z, doors) ? 0 : 1;
    }
    return true;
  }

  isWalkable(cx, cz) {
    return inBounds(cx, cz) && this.walk[idx(cx, cz)] === 1;
  }

  // ¿Se puede pasar de (cx,cz) a (cx+dx, cz+dz)? Las diagonales no pueden cortar esquinas.
  canStep(cx, cz, dx, dz) {
    const nx = cx + dx, nz = cz + dz;
    if (!this.isWalkable(nx, nz)) return false;
    if (dx !== 0 && dz !== 0) {
      if (!this.isWalkable(cx + dx, cz) || !this.isWalkable(cx, cz + dz)) return false;
    }
    return true;
  }

  // Dijkstra multi-origen desde las celdas de `sources` ([{x, z}] en coordenadas de mundo)
  compute(sources, doors) {
    this.updateWalkable(doors);
    const dist = this.dist;
    dist.fill(Infinity);
    const heap = this.heap;
    heap.clear();
    this.hasSources = false;
    for (const s of sources) {
      let cx = Math.floor(s.x), cz = Math.floor(s.z);
      if (!this.isWalkable(cx, cz)) {
        // El jugador puede estar rozando un muro: usar la celda transitable vecina más cercana
        const alt = this.nearestWalkable(s.x, s.z, 1);
        if (!alt) continue;
        cx = alt[0]; cz = alt[1];
      }
      const i = idx(cx, cz);
      if (dist[i] > 0) { dist[i] = 0; heap.push(0, i); }
      this.hasSources = true;
    }
    while (heap.size > 0) {
      const i = heap.pop();
      const d = heap.lastKey;
      if (d > dist[i]) continue;
      const cx = i % W, cz = (i / W) | 0;
      for (let k = 0; k < 8; k++) {
        const nb = NEIGHBORS[k];
        if (!this.canStep(cx, cz, nb[0], nb[1])) continue;
        const j = idx(cx + nb[0], cz + nb[1]);
        const nd = d + nb[2];
        if (nd < dist[j]) { dist[j] = nd; heap.push(nd, j); }
      }
    }
    this.version++;
  }

  at(cx, cz) {
    if (!inBounds(cx, cz)) return Infinity;
    return this.dist[idx(cx, cz)];
  }

  atPos(x, z) { return this.at(Math.floor(x), Math.floor(z)); }

  // Celda vecina que más acerca al origen: minimiza dist[vecino] + costo del paso (camino más corto).
  // Si la celda actual no es transitable (zombi empujado contra un muro) acepta cualquier vecino finito.
  // null si no hay mejora.
  nextCell(cx, cz) {
    const here = this.at(cx, cz);
    const inside = this.isWalkable(cx, cz);
    let best = null, bestScore = Infinity;
    for (let k = 0; k < 8; k++) {
      const nb = NEIGHBORS[k];
      if (inside) {
        if (!this.canStep(cx, cz, nb[0], nb[1])) continue;
      } else if (!this.isWalkable(cx + nb[0], cz + nb[1]) || (nb[0] !== 0 && nb[1] !== 0)) continue;
      const v = this.dist[idx(cx + nb[0], cz + nb[1])];
      if (v === Infinity || (inside && v >= here - 1e-6)) continue;
      const score = v + nb[2];
      if (score < bestScore - 1e-6) { bestScore = score; best = [cx + nb[0], cz + nb[1]]; }
    }
    return best;
  }

  // Sigue el campo `steps` celdas desde (cx, cz). Devuelve la lista de celdas (sin incluir la inicial).
  follow(cx, cz, steps) {
    const out = [];
    let x = cx, z = cz;
    for (let s = 0; s < steps; s++) {
      const n = this.nextCell(x, z);
      if (!n) break;
      out.push(n);
      x = n[0]; z = n[1];
      if (this.at(x, z) === 0) break;
    }
    return out;
  }

  // Celda transitable más cercana a (x, z) dentro de `radius` celdas (anillos crecientes)
  nearestWalkable(x, z, radius = 2) {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (this.isWalkable(cx, cz)) return [cx, cz];
    let best = null, bestD = Infinity;
    for (let r = 1; r <= radius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.isWalkable(nx, nz)) continue;
          const d = (nx + 0.5 - x) ** 2 + (nz + 0.5 - z) ** 2;
          if (d < bestD) { bestD = d; best = [nx, nz]; }
        }
      }
      if (best) return best;
    }
    return null;
  }
}

// ¿Un círculo de radio r puede ir en línea recta de (x0,z0) a (x1,z1) sin chocar? (muestreo cada 0.25 m)
export function clearPath(x0, z0, x1, z1, r, solidFn) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(len / 0.25));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (circleBlocked(x0 + dx * t, z0 + dz * t, r, solidFn)) return false;
  }
  return true;
}

// Punto aleatorio transitable cerca de (x, z) alcanzable en línea recta (para deambular)
export function randomPointNear(field, x, z, radius, r, solidFn, rand = Math.random) {
  for (let tries = 0; tries < 12; tries++) {
    const a = rand() * Math.PI * 2;
    const d = 1.5 + rand() * Math.max(0.5, radius - 1.5);
    const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
    const cx = Math.floor(tx), cz = Math.floor(tz);
    if (!field.isWalkable(cx, cz)) continue;
    const px = cx + 0.5, pz = cz + 0.5;
    if (clearPath(x, z, px, pz, r, solidFn)) return { x: px, z: pz };
  }
  return null;
}

export default FlowField;
