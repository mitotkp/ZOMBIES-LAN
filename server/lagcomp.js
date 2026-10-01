// Compensación de lag: historial de las hitboxes de los zombis para validar los disparos en el instante
// que veía el tirador. El cliente dibuja el mundo con INTERP_DELAY_MS de retraso y además hay latencia,
// así que un disparo que en su pantalla acertó llegaría tarde a un zombi que ya se movió. El servidor
// guarda las posiciones que envió en cada snapshot (exactamente las que interpola el cliente) y, al
// recibir un disparo con su marca de tiempo, "rebobina" los zombis a ese instante y traza la bala él mismo.

import { ZOMBIE_TYPES, angleDiff } from '../shared/constants.js';
import { ZF, ZA } from '../shared/protocol.js';
import { rayZombie, raycastMap } from '../shared/collision.js';

export const LAGCOMP_KEEP_MS = 1000;   // historial guardado
export const LAGCOMP_MAX_MS = 800;     // rebobinado máximo aceptado (más atrás = cliente con demasiado lag)
const HITBOX_SLACK = 1.12;             // hitbox algo mayor: la interpolación del cliente no es idéntica al píxel
const DIST_SLACK = 1.5;                // m de diferencia admitida entre la distancia del cliente y la calculada

const lerp = (a, b, t) => a + (b - a) * t;

// Estado de hitbox de un zombi tal como lo usa rayZombie (shared/collision.js)
export function hitboxOf(z) {
  const T = ZOMBIE_TYPES[z.type] || {};
  return {
    x: z.x, z: z.z, rot: z.rot || 0, yOff: z.y || 0,
    crawler: !!((z.flags & ZF.CRAWLER) || z.anim === ZA.CRAWL),
    scale: T.scale || 1, type: z.type,
  };
}

export class HitHistory {
  constructor() { this.frames = []; }   // [{ now, zs: Map<id, hitbox> }] en orden de tiempo

  clear() { this.frames.length = 0; }

  // Guarda el estado de este snapshot (llamar justo cuando se envía, con los mismos valores redondeados)
  record(now, snapshotRows, zombiesById) {
    const zs = new Map();
    for (const row of snapshotRows) {
      const z = zombiesById(row[0]);
      if (!z) continue;
      const hb = hitboxOf(z);
      hb.x = row[1]; hb.z = row[2]; hb.rot = row[3]; hb.yOff = row[6];
      zs.set(row[0], hb);
    }
    this.frames.push({ now, zs });
    while (this.frames.length > 2 && this.frames[0].now < now - LAGCOMP_KEEP_MS) this.frames.shift();
  }

  // Hitbox del zombi `id` en el instante `t` (interpolada entre los dos snapshots que lo rodean)
  at(t, id) {
    const f = this.frames;
    if (!f.length) return null;
    let i = f.length - 1;
    while (i > 0 && f[i].now > t) i--;
    const a = f[i], b = f[i + 1];
    const za = a.zs.get(id);
    if (!b || t <= a.now) return za || (b && b.zs.get(id)) || null;
    const zb = b.zs.get(id);
    if (!za || !zb) return za || zb || null;
    const k = (t - a.now) / Math.max(1, b.now - a.now);
    return {
      ...zb,
      x: lerp(za.x, zb.x, k), z: lerp(za.z, zb.z, k), yOff: lerp(za.yOff, zb.yOff, k),
      rot: za.rot + angleDiff(za.rot, zb.rot) * k,
    };
  }
}

// Valida un impacto de bala contra la hitbox rebobinada. Devuelve { part, dist } o null si no acierta.
// o: origen [x,y,z]; dir: dirección unitaria de ESE perdigón; hb: hitbox (de HitHistory.at o actual);
// claimed: { part, dist } que dice el cliente; doors: puertas abiertas (las cerradas paran la bala).
export function validateHit(o, dir, hb, claimed, doors) {
  // Primero la hitbox exacta; si falla por poco, una algo mayor (solo para aceptar el impacto: agrandarla
  // también sube la cabeza, así que la parte del cuerpo se decide siempre con la exacta)
  const exact = rayZombie(o[0], o[1], o[2], dir[0], dir[1], dir[2], hb);
  const r = exact || rayZombie(o[0], o[1], o[2], dir[0], dir[1], dir[2], { ...hb, scale: (hb.scale || 1) * HITBOX_SLACK });
  if (!r || r.t < 0) return null;
  if (Number.isFinite(claimed.dist) && Math.abs(r.t - claimed.dist) > DIST_SLACK) return null;
  // Un muro o una puerta cerrada entre el cañón y el zombi para la bala
  const wall = raycastMap(o[0], o[1], o[2], dir[0], dir[1], dir[2], r.t, doors);
  if (wall && wall.dist < r.t - 0.25) return null;
  // La parte la dice el cliente, pero un tiro a la cabeza solo cuenta si el servidor también lo ve
  let part = claimed.part;
  if (part === 'h' && !(exact && exact.part === 'h')) part = 'b';
  return { part, dist: r.t };
}
