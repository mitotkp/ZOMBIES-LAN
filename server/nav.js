// Navegación de zombis sobre la cuadrícula: campos de flujo (Dijkstra multi-origen, 8 direcciones,
// sin cortar esquinas) y utilidades de línea libre / puntos aleatorios transitables.
// Lo usan server/zombies.js y tools/bot-test.js.

import { MAP } from '../shared/map.js';
import { circleBlocked } from '../shared/collision.js';

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

// Campo de flujo sobre nodos planta × celda (índice n = planta * W * H + celda). Con una sola planta los nodos son
// las celdas. Las escaleras son nodos de su planta de abajo y enlazan con la de arriba por su extremo alto.
// Se crea con el mapa ACTIVO (cada sala del servidor tiene el suyo).
export class FlowField {
  constructor(M = MAP) {
    this.M = M;
    this.W = M.W; this.H = M.H; this.N = M.W * M.H; this.NL = M.NL;
    const total = this.N * this.NL;
    // Float64: con Float32 el redondeo hacía que `d > dist[n]` descartara nodos y el campo se cortaba
    this.dist = new Float64Array(total).fill(Infinity);
    this.walk = new Uint8Array(total);
    this.nodeY = new Float32Array(total);
    this.heap = new MinHeap(total * 4);
    this.walkKey = null;
    this.hasSources = false;
    this.version = 0;
  }

  // Recalcula qué nodos son transitables para un zombi DENTRO del área de juego
  updateWalkable(doors) {
    const key = doorsKey(doors);
    if (key === this.walkKey) return false;
    this.walkKey = key;
    const M = this.M, N = this.N;
    for (let l = 0; l < this.NL; l++) {
      for (let i = 0; i < N; i++) {
        const n = l * N + i;
        this.walk[n] = M.nodeWalkable(l, i, doors) ? 1 : 0;
        this.nodeY[n] = this.walk[n] ? M.nodeY(l, i) : 0;
      }
    }
    return true;
  }

  isWalkable(cx, cz, l = 0) {
    return cx >= 0 && cz >= 0 && cx < this.W && cz < this.H && l >= 0 && l < this.NL && this.walk[l * this.N + cz * this.W + cx] === 1;
  }

  // Nodo destino al pasar desde el nodo (l, cx, cz) a la celda vecina (nx, nz): la misma planta o la de al lado
  // si el desnivel es de una escalera. Devuelve la planta del destino o -1.
  stepLevel(l, cx, cz, nx, nz) {
    if (nx < 0 || nz < 0 || nx >= this.W || nz >= this.H) return -1;
    const N = this.N, j = nz * this.W + nx;
    if (this.NL === 1) return this.walk[j] === 1 ? 0 : -1;
    const i = cz * this.W + cx;
    const h = this.nodeY[l * N + i];
    const M = this.M;
    const si = M.stairIdx[i], sj = M.stairIdx[j];
    const stI = si >= 0 && M.STAIRS[si].lv === l ? M.STAIRS[si] : null;   // el nodo actual es de escalera
    for (const l2 of [l, l + 1, l - 1]) {
      if (l2 < 0 || l2 >= this.NL) continue;
      const m = l2 * N + j;
      if (this.walk[m] !== 1 || Math.abs(this.nodeY[m] - h) > 1.0) continue;
      const stJ = sj >= 0 && M.STAIRS[sj].lv === l2 ? M.STAIRS[sj] : null;
      // entre escalera y suelo solo por el pie (misma planta) o por la llegada (planta de arriba)
      if (stI && !stJ && !((l2 === stI.lv && stI.exitBottom.has(j)) || (l2 === stI.lv + 1 && stI.exitTop.has(j)))) continue;
      if (!stI && stJ && !((l === stJ.lv && stJ.exitBottom.has(i)) || (l === stJ.lv + 1 && stJ.exitTop.has(i)))) continue;
      if (stI && stJ && stI !== stJ) continue;
      return l2;
    }
    return -1;
  }

  // ¿Se puede pasar de (cx,cz) a (cx+dx, cz+dz) en la planta l? Las diagonales no pueden cortar esquinas.
  // Devuelve la planta de destino o -1.
  canStep(cx, cz, dx, dz, l = 0) {
    const l2 = this.stepLevel(l, cx, cz, cx + dx, cz + dz);
    if (l2 < 0) return -1;
    if (dx !== 0 && dz !== 0) {
      if (this.stepLevel(l, cx, cz, cx + dx, cz) < 0 || this.stepLevel(l, cx, cz, cx, cz + dz) < 0) return -1;
      // a una escalera se entra (y se sale) de frente, no en diagonal
      if (this.NL > 1) {
        const M = this.M, W = this.W;
        // solo escaleras de esta planta o de la de abajo (la rejilla de escaleras es 2D, común a todas las plantas)
        const S = (k) => (k >= 0 && (M.STAIRS[k].lv === l || M.STAIRS[k].lv === l - 1) ? k : -1);
        const a = S(M.stairIdx[cz * W + cx]), b = S(M.stairIdx[(cz + dz) * W + cx + dx]);
        const c = S(M.stairIdx[cz * W + cx + dx]), d = S(M.stairIdx[(cz + dz) * W + cx]);
        if ((a !== b || a !== c || a !== d) && (a >= 0 || b >= 0 || c >= 0 || d >= 0)) return -1;
      }
    }
    return l2;
  }

  // Dijkstra multi-origen desde `sources` ([{x, z, y}] en coordenadas de mundo)
  compute(sources, doors) {
    this.updateWalkable(doors);
    const dist = this.dist, N = this.N, W = this.W;
    dist.fill(Infinity);
    const heap = this.heap;
    heap.clear();
    this.hasSources = false;
    for (const s of sources) {
      let l = this.M.nodeLevel(s.x, s.z, s.y !== undefined ? s.y : this.M.levels[0].y);
      let cx = Math.floor(s.x), cz = Math.floor(s.z);
      if (!this.isWalkable(cx, cz, l)) {
        // El jugador puede estar rozando un muro: usar el nodo transitable vecino más cercano
        const alt = this.nearestWalkable(s.x, s.z, 1, l);
        if (!alt) continue;
        cx = alt[0]; cz = alt[1];
      }
      const n = l * N + cz * W + cx;
      if (dist[n] > 0) { dist[n] = 0; heap.push(0, n); }
      this.hasSources = true;
    }
    while (heap.size > 0) {
      const n = heap.pop();
      const d = heap.lastKey;
      if (d > dist[n]) continue;
      const l = (n / N) | 0, i = n - l * N;
      const cx = i % W, cz = (i / W) | 0;
      for (let k = 0; k < 8; k++) {
        const nb = NEIGHBORS[k];
        const l2 = this.canStep(cx, cz, nb[0], nb[1], l);
        if (l2 < 0) continue;
        const m = l2 * N + (cz + nb[1]) * W + cx + nb[0];
        const nd = d + nb[2];
        if (nd < dist[m]) { dist[m] = nd; heap.push(nd, m); }
      }
    }
    this.version++;
  }

  at(cx, cz, l = 0) {
    if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H || l < 0 || l >= this.NL) return Infinity;
    return this.dist[l * this.N + cz * this.W + cx];
  }

  // Distancia desde un punto de mundo (y = altura, para saber la planta)
  atPos(x, z, y) {
    const l = this.NL === 1 ? 0 : this.M.nodeLevel(x, z, y !== undefined ? y : this.M.levels[0].y);
    return this.at(Math.floor(x), Math.floor(z), l);
  }

  // Nodo vecino que más acerca al origen: minimiza dist[vecino] + costo del paso (camino más corto).
  // Si el nodo actual no es transitable (zombi empujado contra un muro) acepta cualquier vecino finito.
  // Devuelve [x, z, planta] o null si no hay mejora.
  nextCell(cx, cz, l = 0) {
    const here = this.at(cx, cz, l);
    const inside = this.isWalkable(cx, cz, l);
    let best = null, bestScore = Infinity;
    for (let k = 0; k < 8; k++) {
      const nb = NEIGHBORS[k];
      let l2;
      if (inside) {
        l2 = this.canStep(cx, cz, nb[0], nb[1], l);
        if (l2 < 0) continue;
      } else {
        if (nb[0] !== 0 && nb[1] !== 0) continue;
        l2 = this.isWalkable(cx + nb[0], cz + nb[1], l) ? l : -1;
        if (l2 < 0) continue;
      }
      const v = this.at(cx + nb[0], cz + nb[1], l2);
      if (v === Infinity || (inside && v >= here - 1e-6)) continue;
      const score = v + nb[2];
      if (score < bestScore - 1e-6) { bestScore = score; best = [cx + nb[0], cz + nb[1], l2]; }
    }
    return best;
  }

  // Sigue el campo `steps` nodos desde (cx, cz, l). Devuelve la lista [x, z, planta] (sin incluir el inicial).
  follow(cx, cz, steps, l = 0) {
    const out = [];
    let x = cx, z = cz, lv = l;
    for (let s = 0; s < steps; s++) {
      const n = this.nextCell(x, z, lv);
      if (!n) break;
      out.push(n);
      x = n[0]; z = n[1]; lv = n[2];
      if (this.at(x, z, lv) === 0) break;
    }
    return out;
  }

  // Celda transitable más cercana a (x, z) en la planta l dentro de `radius` celdas (anillos crecientes)
  nearestWalkable(x, z, radius = 2, l = 0) {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (this.isWalkable(cx, cz, l)) return [cx, cz];
    let best = null, bestD = Infinity;
    for (let r = 1; r <= radius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.isWalkable(nx, nz, l)) continue;
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
// onSample(px, pz): opcional, se llama antes de comprobar cada punto (para reglas que dependen de la posición,
// como entrar o salir de una escalera solo por sus extremos)
export function clearPath(x0, z0, x1, z1, r, solidFn, onSample) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(len / 0.25));
  let prevX = x0, prevZ = z0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const px = x0 + dx * t, pz = z0 + dz * t;
    if (onSample) onSample(prevX, prevZ);
    if (circleBlocked(px, pz, r, solidFn)) return false;
    prevX = px; prevZ = pz;
  }
  return true;
}

// Punto aleatorio transitable cerca de (x, z) alcanzable en línea recta (para deambular)
export function randomPointNear(field, x, z, radius, r, solidFn, rand = Math.random, l = 0) {
  for (let tries = 0; tries < 12; tries++) {
    const a = rand() * Math.PI * 2;
    const d = 1.5 + rand() * Math.max(0.5, radius - 1.5);
    const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
    const cx = Math.floor(tx), cz = Math.floor(tz);
    if (!field.isWalkable(cx, cz, l)) continue;
    const px = cx + 0.5, pz = cz + 0.5;
    if (clearPath(x, z, px, pz, r, solidFn)) return { x: px, z: pz };
  }
  return null;
}

export default FlowField;
