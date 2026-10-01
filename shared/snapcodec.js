// Snapshots de posiciones en binario (el mensaje más frecuente: 20 por segundo a cada jugador).
// Mismo contenido que el antiguo JSON { t:'snap', now, z:[...], p:[...] } pero ~3 veces más pequeño.
// decodeSnap() devuelve exactamente esa forma, así que quien lo recibe no cambia.
//
// Formato (little-endian):
//   u8 tipo (1) · f64 now · u16 nº zombis · u8 nº jugadores
//   zombi (15 B):  u32 id · i16 x·100 · i16 z·100 · i16 rot·10000 · u8 anim · u8 flags · i16 y·100 · u8 tipo
//   jugador (16 B): u16 id · i16 x·100 · i16 y·100 · i16 z·100 · i16 yaw·10000 · i16 pitch·10000
//                   · u16 flags · u8 arma (índice en WEAPONS, 255 = ninguna) · u8 mejorada
// Posiciones al centímetro (hasta ±327 m) y ángulos a 0,0001 rad: igual o más precisión que el JSON.

import { WEAPONS } from './weapons.js';

export const SNAP_BIN = 1;
const HEAD = 1 + 8 + 2 + 1;
const ZSIZE = 15;
const PSIZE = 16;
const WEAPON_KEYS = Object.keys(WEAPONS);
const WEAPON_INDEX = new Map(WEAPON_KEYS.map((k, i) => [k, i]));
const TAU = Math.PI * 2;

const i16 = (v, k) => Math.max(-32768, Math.min(32767, Math.round((Number(v) || 0) * k)));
const wrap = (a) => { const x = (Number(a) || 0) % TAU; return x > Math.PI ? x - TAU : x < -Math.PI ? x + TAU : x; };

// zRows: [[id,x,z,rot,anim,flags,y,tcode]]; pRows: [[id,x,y,z,yaw,pitch,flags,w,up]] (como el JSON)
export function encodeSnap(now, zRows, pRows) {
  const nz = Math.min(zRows.length, 65535), np = Math.min(pRows.length, 255);
  const buf = new ArrayBuffer(HEAD + nz * ZSIZE + np * PSIZE);
  const v = new DataView(buf);
  v.setUint8(0, SNAP_BIN);
  v.setFloat64(1, now, true);
  v.setUint16(9, nz, true);
  v.setUint8(11, np);
  let o = HEAD;
  for (let i = 0; i < nz; i++) {
    const z = zRows[i];
    v.setUint32(o, z[0] >>> 0, true);
    v.setInt16(o + 4, i16(z[1], 100), true);
    v.setInt16(o + 6, i16(z[2], 100), true);
    v.setInt16(o + 8, i16(wrap(z[3]), 10000), true);
    v.setUint8(o + 10, z[4] & 255);
    v.setUint8(o + 11, z[5] & 255);
    v.setInt16(o + 12, i16(z[6], 100), true);
    v.setUint8(o + 14, z[7] & 255);
    o += ZSIZE;
  }
  for (let i = 0; i < np; i++) {
    const p = pRows[i];
    v.setUint16(o, p[0] & 0xffff, true);
    v.setInt16(o + 2, i16(p[1], 100), true);
    v.setInt16(o + 4, i16(p[2], 100), true);
    v.setInt16(o + 6, i16(p[3], 100), true);
    v.setInt16(o + 8, i16(wrap(p[4]), 10000), true);
    v.setInt16(o + 10, i16(p[5], 10000), true);
    v.setUint16(o + 12, p[6] & 0xffff, true);
    const wi = WEAPON_INDEX.get(p[7]);
    v.setUint8(o + 14, wi === undefined ? 255 : wi);
    v.setUint8(o + 15, p[8] ? 1 : 0);
    o += PSIZE;
  }
  return buf;
}

// data: ArrayBuffer (navegador) o Buffer/Uint8Array (Node). Devuelve { t:'snap', now, z, p } o null.
export function decodeSnap(data) {
  let v;
  if (data instanceof ArrayBuffer) v = new DataView(data);
  else if (data && data.buffer instanceof ArrayBuffer) v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  else return null;
  if (v.byteLength < HEAD || v.getUint8(0) !== SNAP_BIN) return null;
  const now = v.getFloat64(1, true);
  const nz = v.getUint16(9, true), np = v.getUint8(11);
  if (v.byteLength < HEAD + nz * ZSIZE + np * PSIZE) return null;
  const z = new Array(nz), p = new Array(np);
  let o = HEAD;
  for (let i = 0; i < nz; i++) {
    z[i] = [
      v.getUint32(o, true), v.getInt16(o + 4, true) / 100, v.getInt16(o + 6, true) / 100, v.getInt16(o + 8, true) / 10000,
      v.getUint8(o + 10), v.getUint8(o + 11), v.getInt16(o + 12, true) / 100, v.getUint8(o + 14),
    ];
    o += ZSIZE;
  }
  for (let i = 0; i < np; i++) {
    const wi = v.getUint8(o + 14);
    p[i] = [
      v.getUint16(o, true), v.getInt16(o + 2, true) / 100, v.getInt16(o + 4, true) / 100, v.getInt16(o + 6, true) / 100,
      v.getInt16(o + 8, true) / 10000, v.getInt16(o + 10, true) / 10000, v.getUint16(o + 12, true),
      wi === 255 ? '' : (WEAPON_KEYS[wi] || ''), v.getUint8(o + 15),
    ];
    o += PSIZE;
  }
  return { t: 'snap', now, z, p };
}
