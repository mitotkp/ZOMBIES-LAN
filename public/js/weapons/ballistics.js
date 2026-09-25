// Balística del cliente: dispersión en cono, trazado de balas contra el mapa y los zombis (con penetración)
// y búsqueda de objetivos cuerpo a cuerpo (cuchillo y golpe con escudo).
// Funciones puras sin estado de juego: WeaponSystem les pasa los objetivos y las puertas abiertas.
import * as THREE from 'three';
import { raycastMap, rayZombie, lineOfSight } from '/shared/collision.js';
import { forwardXZ, ZOMBIE } from '/shared/constants.js';

export const MAX_RANGE = 150;   // el servidor ignora impactos más lejanos

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _helper = new THREE.Vector3();

// Dirección aleatoria dentro de un cono de semiángulo `spreadDeg` alrededor de `dir` (unitario).
// u (0..1) controla el radio (distribución uniforme en el disco) y v (0..1) el ángulo alrededor del eje.
export function coneDir(dir, spreadDeg, out, u = Math.random(), v = Math.random()) {
  const a = (Math.max(0, spreadDeg) * Math.PI / 180) * Math.sqrt(Math.min(1, Math.max(0, u)));
  if (a <= 1e-6) return out.copy(dir);
  const phi = v * Math.PI * 2;
  if (Math.abs(dir.y) < 0.99) _helper.set(0, 1, 0); else _helper.set(1, 0, 0);
  _right.crossVectors(dir, _helper).normalize();
  _up.crossVectors(_right, dir).normalize();
  const s = Math.sin(a);
  return out.copy(dir).multiplyScalar(Math.cos(a))
    .addScaledVector(_right, Math.cos(phi) * s)
    .addScaledVector(_up, Math.sin(phi) * s)
    .normalize();
}

// Traza una bala desde (ox,oy,oz) en la dirección unitaria (dx,dy,dz).
// Atraviesa como máximo `pen` zombis antes de detenerse; los muros, puertas cerradas, props, suelo y techo la paran.
// Devuelve { hits:[{ id, t, part, z }], map: impacto en el mapa | null, endT }.
export function traceBullet(ox, oy, oz, dx, dy, dz, pen, targets, doors, maxDist = MAX_RANGE) {
  const map = raycastMap(ox, oy, oz, dx, dy, dz, maxDist, doors);
  const wallT = map ? map.dist : maxDist;
  const found = [];
  if (Array.isArray(targets)) {
    for (let i = 0; i < targets.length; i++) {
      const z = targets[i];
      if (!z || !Number.isFinite(z.x) || !Number.isFinite(z.z) || z.id === undefined || z.id === null) continue;
      // descarte rápido: el zombi debe quedar cerca de la recta en el plano XZ
      const lx = z.x - ox, lz = z.z - oz;
      const along = lx * dx + lz * dz;
      const hLen = Math.hypot(dx, dz);
      if (hLen > 1e-4) {
        const perp = Math.abs(lx * dz - lz * dx) / hLen;
        if (perp > 1.4 || along < -1.2) continue;
      }
      const r = rayZombie(ox, oy, oz, dx, dy, dz, z);
      if (r && r.t >= 0 && r.t < wallT) found.push({ id: z.id, t: r.t, part: r.part, z });
    }
  }
  found.sort((a, b) => a.t - b.t);
  const n = Math.max(1, pen | 0);
  const hits = found.length > n ? found.slice(0, n) : found;
  const stopped = hits.length >= n;
  return { hits, map: stopped ? null : map, endT: stopped ? hits[hits.length - 1].t : wallT };
}

// Zombis alcanzables cuerpo a cuerpo delante del jugador, ordenados por cercanía.
// (px,pz) pies del jugador, eyeY altura de los ojos, yaw hacia donde mira, arcDeg arco total.
export function meleeTargets(targets, px, pz, eyeY, yaw, range, arcDeg, max, doors) {
  const out = [];
  if (!Array.isArray(targets) || !targets.length) return out;
  const f = forwardXZ(yaw);
  const cosHalf = Math.cos((arcDeg * Math.PI / 180) / 2);
  for (let i = 0; i < targets.length; i++) {
    const z = targets[i];
    if (!z || !Number.isFinite(z.x) || !Number.isFinite(z.z) || z.id === undefined || z.id === null) continue;
    const dx = z.x - px, dz = z.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > range + ZOMBIE.radius) continue;
    // muy pegado cuenta aunque esté algo de lado
    if (d > 0.5 && (dx * f.x + dz * f.z) / d < cosHalf) continue;
    const ty = (z.crawler ? 0.35 : 1.15) + (Number(z.yOff) || 0);
    if (!lineOfSight(px, eyeY, pz, z.x, Math.max(0.2, ty), z.z, doors)) continue;
    out.push({ id: z.id, x: z.x, y: ty, z: z.z, d, crawler: !!z.crawler });
  }
  out.sort((a, b) => a.d - b.d);
  return out.length > max ? out.slice(0, max) : out;
}

// ¿Hay pared entre dos puntos? (para no sacar trazadores ni proyectiles desde dentro de un muro)
export function blockedBetween(a, b, doors) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-4) return false;
  const h = raycastMap(a.x, a.y, a.z, dx, dy, dz, d, doors);
  return !!(h && h.dist < d - 1e-3);
}

export default { coneDir, traceBullet, meleeTargets, blockedBetween, MAX_RANGE };
