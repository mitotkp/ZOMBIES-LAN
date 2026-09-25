// Colisiones y raycast sobre la cuadrícula del mapa (compartido servidor/cliente).
// `doors` es el objeto gs.doors: { A: true, ... } con las puertas ABIERTAS.

import { C, W, H, cellType, cellHeight, cellDoor, cellZone, idx, ZONES, CEIL_H } from './map.js';

// ¿La celda bloquea a un jugador?
export function solidForPlayer(x, z, doors) {
  if (x < 0 || z < 0 || x >= W || z >= H) return true;
  const t = cellType[idx(x, z)];
  if (t === C.FLOOR) return false;
  if (t === C.DOOR) return !(doors && doors[cellDoor[idx(x, z)]]);
  return true; // VOID, WALL, WINDOW, OUTSIDE, PROP
}

// ¿La celda bloquea a un zombi que ya está DENTRO del área de juego? (igual que el jugador)
export const solidForZombieInside = solidForPlayer;

// ¿La celda bloquea a un zombi que está FUERA, en un callejón? (solo puede pisar OUTSIDE)
export function solidForZombieOutside(x, z) {
  if (x < 0 || z < 0 || x >= W || z >= H) return true;
  return cellType[idx(x, z)] !== C.OUTSIDE;
}

// Empuja un círculo fuera de las celdas sólidas. Devuelve [x, z].
export function resolveCircle(px, pz, r, solidFn) {
  for (let iter = 0; iter < 4; iter++) {
    let pushed = false;
    const minX = Math.floor(px - r), maxX = Math.floor(px + r);
    const minZ = Math.floor(pz - r), maxZ = Math.floor(pz + r);
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        if (!solidFn(cx, cz)) continue;
        const qx = px < cx ? cx : px > cx + 1 ? cx + 1 : px;
        const qz = pz < cz ? cz : pz > cz + 1 ? cz + 1 : pz;
        const dx = px - qx, dz = pz - qz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const push = r - d + 1e-4;
          px += (dx / d) * push;
          pz += (dz / d) * push;
        } else {
          // El centro quedó dentro de la celda: salir por el lado más cercano
          const l = px - cx, rr = cx + 1 - px, t = pz - cz, b = cz + 1 - pz;
          const m = Math.min(l, rr, t, b);
          if (m === l) px = cx - r - 1e-4;
          else if (m === rr) px = cx + 1 + r + 1e-4;
          else if (m === t) pz = cz - r - 1e-4;
          else pz = cz + 1 + r + 1e-4;
        }
        pushed = true;
      }
    }
    if (!pushed) break;
  }
  return [px, pz];
}

// Mueve un círculo con deslizamiento contra muros. Sub-pasos para evitar atravesar paredes.
// solidFn(cx, cz) -> boolean. Devuelve { x, z }.
export function moveCircle(x, z, dx, dz, r, solidFn) {
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(len / (r * 0.5)));
  const sx = dx / steps, sz = dz / steps;
  for (let i = 0; i < steps; i++) {
    x += sx; z += sz;
    [x, z] = resolveCircle(x, z, r, solidFn);
  }
  return { x, z };
}

// ¿Hay un círculo de radio r en (x,z) que choca con algo?
export function circleBlocked(x, z, r, solidFn) {
  const minX = Math.floor(x - r), maxX = Math.floor(x + r);
  const minZ = Math.floor(z - r), maxZ = Math.floor(z + r);
  for (let cz = minZ; cz <= maxZ; cz++) {
    for (let cx = minX; cx <= maxX; cx++) {
      if (!solidFn(cx, cz)) continue;
      const qx = Math.max(cx, Math.min(x, cx + 1));
      const qz = Math.max(cz, Math.min(z, cz + 1));
      if ((x - qx) ** 2 + (z - qz) ** 2 < r * r) return true;
    }
  }
  return false;
}

const indoorZone = ZONES.map((zn) => zn.indoor);

// Raycast 3D contra el mapa (muros, puertas cerradas, props con altura, suelo y techos interiores).
// Las ventanas y los callejones NO bloquean balas (se puede disparar a través de las barricadas).
// Devuelve { dist, x, y, z, nx, ny, nz, what } o null si no choca antes de maxDist.
// what: 'wall' | 'door' | 'prop' | 'floor' | 'ceiling'
export function raycastMap(ox, oy, oz, dx, dy, dz, maxDist, doors, opts = {}) {
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;
  const ignoreCeiling = !!opts.ignoreCeiling;

  let best = maxDist;
  let hit = null;

  // Suelo
  if (dy < 0) {
    const t = -oy / dy;
    if (t >= 0 && t < best) { best = t; hit = { what: 'floor', nx: 0, ny: 1, nz: 0 }; }
  }

  // Recorrido DDA en XZ
  let cx = Math.floor(ox), cz = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = Math.abs(dx) > 1e-9 ? Math.abs(1 / dx) : Infinity;
  const tDeltaZ = Math.abs(dz) > 1e-9 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = Math.abs(dx) > 1e-9 ? ((dx > 0 ? cx + 1 - ox : ox - cx) * tDeltaX) : Infinity;
  let tMaxZ = Math.abs(dz) > 1e-9 ? ((dz > 0 ? cz + 1 - oz : oz - cz) * tDeltaZ) : Infinity;
  let tEnter = 0;
  let enterNx = 0, enterNz = 0;

  for (let guard = 0; guard < 512; guard++) {
    if (tEnter > best) break;
    const tExit = Math.min(tMaxX, tMaxZ, best);
    let blocked = false;
    if (cx < 0 || cz < 0 || cx >= W || cz >= H) {
      blocked = true;
    } else {
      const i = idx(cx, cz);
      const t = cellType[i];
      if (t === C.WALL || t === C.VOID) {
        if (tEnter < best) { best = tEnter; hit = { what: 'wall', nx: enterNx, ny: 0, nz: enterNz }; }
        blocked = true;
      } else if (t === C.DOOR && !(doors && doors[cellDoor[i]])) {
        if (tEnter < best) { best = tEnter; hit = { what: 'door', nx: enterNx, ny: 0, nz: enterNz }; }
        blocked = true;
      } else if (t === C.PROP) {
        const h = cellHeight[i];
        const yIn = oy + dy * tEnter;
        const yOut = oy + dy * tExit;
        if (yIn <= h) {
          if (tEnter < best) { best = tEnter; hit = { what: 'prop', nx: enterNx, ny: 0, nz: enterNz }; }
          blocked = true;
        } else if (yOut <= h && dy < 0) {
          const tTop = (h - oy) / dy;
          if (tTop < best) { best = tTop; hit = { what: 'prop', nx: 0, ny: 1, nz: 0 }; }
          blocked = true;
        }
      }
      // Techo de zonas interiores
      if (!blocked && !ignoreCeiling && dy > 0) {
        const zn = cellZone[i];
        const indoor = (t === C.FLOOR || t === C.DOOR || t === C.PROP) && zn >= 0 && indoorZone[zn];
        if (indoor) {
          const tc = (CEIL_H - oy) / dy;
          if (tc >= tEnter - 1e-6 && tc <= tExit && tc < best) {
            best = tc; hit = { what: 'ceiling', nx: 0, ny: -1, nz: 0 };
            blocked = true;
          }
        }
      }
    }
    if (blocked) break;
    // Avanzar a la siguiente celda
    if (tMaxX < tMaxZ) {
      tEnter = tMaxX; cx += stepX; tMaxX += tDeltaX; enterNx = -stepX; enterNz = 0;
    } else {
      tEnter = tMaxZ; cz += stepZ; tMaxZ += tDeltaZ; enterNx = 0; enterNz = -stepZ;
    }
  }

  if (!hit) return null;
  return {
    dist: best,
    x: ox + dx * best, y: oy + dy * best, z: oz + dz * best,
    nx: hit.nx, ny: hit.ny, nz: hit.nz, what: hit.what,
  };
}

// Línea de visión libre entre dos puntos 3D
export function lineOfSight(ax, ay, az, bx, by, bz, doors) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return true;
  const h = raycastMap(ax, ay, az, dx, dy, dz, d, doors, { ignoreCeiling: true });
  return !h || h.dist >= d - 1e-3;
}

// Intersección rayo-esfera. Devuelve t o -1.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t >= 0 ? t : -1;
}

// Intersección rayo-cilindro vertical (eje Y) finito. Devuelve t o -1.
export function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1) {
  const lx = ox - cx, lz = oz - cz;
  const a = dx * dx + dz * dz;
  let best = -1;
  if (a > 1e-10) {
    const b = lx * dx + lz * dz;
    const c = lx * lx + lz * lz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-b - s) / a, (-b + s) / a]) {
        if (t < 0) continue;
        const y = oy + dy * t;
        if (y >= y0 && y <= y1) { best = t; break; }
      }
    }
  }
  // Tapas
  if (Math.abs(dy) > 1e-10) {
    for (const yc of [y0, y1]) {
      const t = (yc - oy) / dy;
      if (t < 0 || (best >= 0 && t >= best)) continue;
      const px = ox + dx * t - cx, pz = oz + dz * t - cz;
      if (px * px + pz * pz <= r * r) best = t;
    }
  }
  return best;
}

// Modelo de hitbox de zombi compartido (el cliente dispara contra esto; el renderizado debe coincidir).
// z = { x, z, yOff (desplazamiento vertical, p. ej. al emerger), crawler: bool, rot }
// Devuelve { t, part: 'h'|'b'|'l' } o null.
export const ZOMBIE_HITBOX = {
  headY: 1.62, headR: 0.2,
  torsoR: 0.28, torsoY0: 0.78, torsoY1: 1.45,
  legsR: 0.22, legsY0: 0.0, legsY1: 0.78,
  crawlerHeadY: 0.35, crawlerHeadFwd: 0.55, crawlerBodyR: 0.34, crawlerBodyY1: 0.5,
};

export function rayZombie(ox, oy, oz, dx, dy, dz, zb) {
  const k = zb.scale > 0 ? zb.scale : 1;   // tamaño relativo (tanque = 1.5)
  const B = ZOMBIE_HITBOX;
  const hb = k === 1 ? B : {
    headY: B.headY * k, headR: B.headR * k, torsoR: B.torsoR * k, torsoY0: B.torsoY0 * k, torsoY1: B.torsoY1 * k,
    legsR: B.legsR * k, legsY0: B.legsY0 * k, legsY1: B.legsY1 * k,
    crawlerHeadY: B.crawlerHeadY * k, crawlerHeadFwd: B.crawlerHeadFwd * k, crawlerBodyR: B.crawlerBodyR * k, crawlerBodyY1: B.crawlerBodyY1 * k,
  };
  const yo = zb.yOff || 0;
  let best = null;
  const consider = (t, part) => { if (t >= 0 && (!best || t < best.t)) best = { t, part }; };
  if (zb.crawler) {
    const fx = -Math.sin(zb.rot || 0), fz = -Math.cos(zb.rot || 0);
    consider(raySphere(ox, oy, oz, dx, dy, dz, zb.x + fx * hb.crawlerHeadFwd, hb.crawlerHeadY + yo, zb.z + fz * hb.crawlerHeadFwd, hb.headR), 'h');
    consider(rayCylinder(ox, oy, oz, dx, dy, dz, zb.x, zb.z, hb.crawlerBodyR, yo, hb.crawlerBodyY1 + yo), 'b');
  } else {
    consider(raySphere(ox, oy, oz, dx, dy, dz, zb.x, hb.headY + yo, zb.z, hb.headR), 'h');
    consider(rayCylinder(ox, oy, oz, dx, dy, dz, zb.x, zb.z, hb.torsoR, hb.torsoY0 + yo, hb.torsoY1 + yo), 'b');
    consider(rayCylinder(ox, oy, oz, dx, dy, dz, zb.x, zb.z, hb.legsR, hb.legsY0 + yo, hb.legsY1 + yo), 'l');
  }
  return best;
}
