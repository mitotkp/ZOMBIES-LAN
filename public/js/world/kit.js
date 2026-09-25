// Utilidades del mundo: materiales compartidos, fusión de geometría estática por material,
// colocación de primitivas en coordenadas locales y pequeños ayudantes (sonido 3D, reloj del servidor).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTex, glowTexture, poolTexture } from './textures.js';

export const TAU = Math.PI * 2;

// Yaw (convención Three.js, frente del modelo hacia -Z) para que un modelo mire hacia 'N'|'S'|'E'|'W'
export const FACE_VEC = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
export function yawForFace(face) {
  const d = FACE_VEC[face] || FACE_VEC.S;
  return Math.atan2(-d[0], -d[1]);
}

// Vector3 que también se puede leer como arreglo [x, y, z] (compatibilidad con otros módulos)
export class PosVec extends THREE.Vector3 {
  get 0() { return this.x; }
  get 1() { return this.y; }
  get 2() { return this.z; }
  get length3() { return 3; }
}

// Reloj del servidor (ms) con respaldo si la red no está lista
export function serverNow(ctx, fallbackOffset = 0) {
  try {
    if (ctx && ctx.net && typeof ctx.net.serverNow === 'function') {
      const v = ctx.net.serverNow();
      if (Number.isFinite(v) && v > 1e11) return v;
    }
  } catch (e) { /* sin red */ }
  return Date.now() + fallbackOffset;
}

// Sonido 3D defensivo
export function sfx(ctx, name, x, y, z, opts = {}) {
  const a = ctx && ctx.audio;
  if (!a || typeof a.play !== 'function') return null;
  try {
    const o = Object.assign({}, opts);
    if (x != null) o.pos = new PosVec(x, y, z);
    return a.play(name, o) || null;
  } catch (e) { return null; }
}
export function music(ctx, name) {
  const a = ctx && ctx.audio;
  if (!a || typeof a.music !== 'function') return;
  try { a.music(name); } catch (e) { /* ignorar */ }
}
export function announce(ctx, text) {
  const a = ctx && ctx.audio;
  if (!a || typeof a.announce !== 'function') return;
  try { a.announce(text); } catch (e) { /* ignorar */ }
}
// Llamada defensiva a Effects
export function fx(ctx, method, ...args) {
  const e = ctx && ctx.effects;
  if (!e || typeof e[method] !== 'function') return;
  try { e[method](...args); } catch (err) { /* ignorar */ }
}

export function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
export function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
export function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

// Ruido de parpadeo determinista (0..1) para luces
export function flickerNoise(t, seed) {
  const s = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  const a = Math.sin(t * 7.3 + seed) * 0.5 + Math.sin(t * 13.7 + seed * 2.1) * 0.3 + Math.sin(t * 31.1 + seed * 3.7) * 0.2;
  return 0.5 + 0.5 * a * 0.9 + (s - Math.floor(s) - 0.5) * 0.05;
}

// ---------------------------------------------------------------------------
// Materiales compartidos
// ---------------------------------------------------------------------------
// tile: metros por repetición de textura (para UV en coordenadas de mundo)
export const MAT_DEFS = {
  // Suelos
  floor_tiles:    { type: 'lambert', map: 'tiles', tile: 2, cast: false },
  floor_asphalt:  { type: 'lambert', map: 'asphalt', tile: 4, cast: false },
  floor_sidewalk: { type: 'lambert', map: 'sidewalk', tile: 2, cast: false },
  floor_wood:     { type: 'lambert', map: 'wood_floor', tile: 3, cast: false },
  floor_concrete: { type: 'lambert', map: 'concrete', tile: 4, cast: false },
  floor_metal:    { type: 'standard', map: 'metal_plate', tile: 1, metalness: 0.45, roughness: 0.55, cast: false },
  floor_dirt:     { type: 'lambert', map: 'dirt', tile: 3, cast: false },
  terrain:        { type: 'lambert', map: 'grass', tile: 8, cast: false },
  // Muros
  wall_plaster:   { type: 'lambert', map: 'plaster', tile: 2 },
  wall_paper:     { type: 'lambert', map: 'wallpaper', tile: 1.5 },
  wall_brick:     { type: 'lambert', map: 'brick', tile: 2 },
  wall_block:     { type: 'lambert', map: 'block', tile: 1.6 },
  wall_ext:       { type: 'lambert', map: 'brick', tile: 2, color: 0x8a7a72 },
  facade_brick:   { type: 'lambert', map: 'brick', tile: 2, color: 0xb09a90 },
  facade_stucco:  { type: 'lambert', map: 'stucco', tile: 2 },
  zoc_tile:       { type: 'lambert', map: 'wall_tile', tile: 1 },
  zoc_wood:       { type: 'lambert', map: 'wainscot', tile: 1 },
  zoc_paint:      { type: 'lambert', map: 'concrete', tile: 2, color: 0x6a7068 },
  zoc_hazard:     { type: 'lambert', map: 'hazard', tile: 1 },
  zoc_stone:      { type: 'lambert', map: 'stone', tile: 1 },
  fence:          { type: 'lambert', map: 'fence', tile: 2 },
  cap:            { type: 'lambert', map: 'concrete', tile: 2, color: 0x8c8a86 },
  sill:           { type: 'lambert', map: 'wood', tile: 1, color: 0x9a8a78 },
  // Techos
  ceil_tiles:     { type: 'lambert', map: 'ceiling_tiles', tile: 1.2 },
  ceil_wood:      { type: 'lambert', map: 'ceiling_wood', tile: 2 },
  ceil_metal:     { type: 'lambert', map: 'corrugated', tile: 1 },
  ceil_concrete:  { type: 'lambert', map: 'concrete', tile: 3, color: 0x9a9892 },
  roof:           { type: 'lambert', map: 'roof', tile: 3 },
  // Props
  wood:           { type: 'standard', map: 'wood', tile: 1, roughness: 0.85 },
  crate:          { type: 'standard', map: 'crate', roughness: 0.9 },
  metal:          { type: 'standard', map: 'metal', tile: 1, metalness: 0.35, roughness: 0.55 },
  chrome:         { type: 'standard', color: 0xc8ccd2, metalness: 0.8, roughness: 0.28 },
  rust:           { type: 'standard', map: 'rust', tile: 1, metalness: 0.25, roughness: 0.92 },
  corrugated:     { type: 'standard', map: 'corrugated', tile: 1, metalness: 0.3, roughness: 0.6 },
  plastic:        { type: 'standard', roughness: 0.55 },
  rubber:         { type: 'standard', color: 0x161616, roughness: 0.95 },
  glass:          { type: 'standard', color: 0x0b1118, metalness: 0.5, roughness: 0.12 },
  tarp:           { type: 'standard', map: 'tarp', tile: 1.5, roughness: 1 },
  concrete:       { type: 'lambert', map: 'concrete', tile: 2 },
  brickp:         { type: 'lambert', map: 'brick', tile: 2 },
  dark:           { type: 'lambert', color: 0x080808 },
  paint:          { type: 'lambert', map: 'paint', tile: 0.5, cast: false, polygonOffset: -2 },
  // Emisivos (la intensidad la anima World)
  fluo:           { type: 'standard', color: 0x3a3c40, emissive: 0xe4f0ff, emissiveIntensity: 0, roughness: 0.4, cast: false },
  bulb:           { type: 'standard', color: 0x3a2a18, emissive: 0xffb866, emissiveIntensity: 1, roughness: 0.4, cast: false },
  sodium:         { type: 'standard', color: 0x3a2a18, emissive: 0xff9a3a, emissiveIntensity: 1.6, roughness: 0.4, cast: false },
  alarm:          { type: 'standard', color: 0x300808, emissive: 0xff2010, emissiveIntensity: 0, roughness: 0.4, cast: false },
  window_lit:     { type: 'basic', color: 0x7a5a30, cast: false },
  // Calcomanías
  grime:          { type: 'lambert', map: 'grime', transparent: true, depthWrite: false, cast: false, polygonOffset: -3 },
  blood:          { type: 'lambert', map: 'blood', transparent: true, depthWrite: false, cast: false, polygonOffset: -4 },
  manhole:        { type: 'standard', map: 'manhole', transparent: true, alphaTest: 0.5, metalness: 0.4, roughness: 0.6, cast: false, polygonOffset: -2 },
  buildings:      { type: 'lambert', map: 'buildings', emissiveMap: 'buildings_emissive', emissive: 0xffffff, emissiveIntensity: 0.9, tile: 12, cast: false },
  trees:          { type: 'lambert', color: 0x1a1612, cast: false },
};

export class MaterialLib {
  constructor() {
    this.cache = new Map();
    this.extra = new Set();
  }
  tile(key) { const d = MAT_DEFS[key]; return (d && d.tile) || 1; }
  castShadow(key) { const d = MAT_DEFS[key]; return !d || d.cast !== false; }
  get(key) {
    let m = this.cache.get(key);
    if (m) return m;
    const d = MAT_DEFS[key];
    if (!d) throw new Error('Material desconocido: ' + key);
    const p = { vertexColors: true };
    if (d.map) p.map = getTex(d.map);
    if (d.color != null) p.color = new THREE.Color(d.color);
    if (d.emissive != null) p.emissive = new THREE.Color(d.emissive);
    if (d.emissiveIntensity != null) p.emissiveIntensity = d.emissiveIntensity;
    if (d.emissiveMap) p.emissiveMap = getTex(d.emissiveMap);
    if (d.transparent) p.transparent = true;
    if (d.depthWrite === false) p.depthWrite = false;
    if (d.alphaTest) p.alphaTest = d.alphaTest;
    if (d.polygonOffset) { p.polygonOffset = true; p.polygonOffsetFactor = d.polygonOffset; p.polygonOffsetUnits = d.polygonOffset; }
    if (d.type === 'standard') {
      p.metalness = d.metalness != null ? d.metalness : 0;
      p.roughness = d.roughness != null ? d.roughness : 0.8;
      m = new THREE.MeshStandardMaterial(p);
    } else if (d.type === 'basic') {
      m = new THREE.MeshBasicMaterial(p);
    } else {
      m = new THREE.MeshLambertMaterial(p);
    }
    m.name = key;
    this.cache.set(key, m);
    return m;
  }
  // Registra un material propio (para cambios de calidad)
  track(m) { this.extra.add(m); return m; }
  all() { return [...this.cache.values(), ...this.extra]; }
}

// Materiales aditivos sin niebla para halos y charcos de luz
export function glowMaterial(color, opacity = 1, fog = false) {
  return new THREE.SpriteMaterial({
    map: glowTexture(), color: new THREE.Color(color), transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, fog,
  });
}
export function poolMaterial(color, opacity = 0.5) {
  return new THREE.MeshBasicMaterial({
    map: poolTexture(), color: new THREE.Color(color), transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
  });
}
// Charco de luz en el suelo (plano horizontal)
export function makePool(color, size, opacity = 0.5) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), poolMaterial(color, opacity));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}
export function makeGlow(color, size, opacity = 1) {
  const s = new THREE.Sprite(glowMaterial(color, opacity));
  s.scale.set(size, size, 1);
  s.renderOrder = 5;
  return s;
}

// ---------------------------------------------------------------------------
// Preparación y fusión de geometría
// ---------------------------------------------------------------------------
const KEEP = new Set(['position', 'normal', 'uv']);
const _c = new THREE.Color();

// Proyección de UV en coordenadas (tipo caja): u/v en metros / tile
export function boxProjectUV(g, tile) {
  const pos = g.attributes.position, nor = g.attributes.normal;
  let uv = g.attributes.uv;
  if (!uv) { uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2); g.setAttribute('uv', uv); }
  const inv = 1 / tile;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (ny >= nx && ny >= nz) uv.setXY(i, x * inv, z * inv);
    else if (nx >= nz) uv.setXY(i, z * inv, y * inv);
    else uv.setXY(i, x * inv, y * inv);
  }
  uv.needsUpdate = true;
}

// Deja la geometría con position/normal/uv/color, indexada y transformada
export function prepGeo(src, matrix, color, uvTile) {
  const g = src.clone();
  for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
  g.morphAttributes = {};
  g.clearGroups();
  const n = g.attributes.position.count;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.index) {
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (matrix) g.applyMatrix4(matrix);
  if (uvTile) boxProjectUV(g, uvTile);
  _c.set(color == null ? 0xffffff : color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Constructor de quads a mano (muros, suelos) con atributos compatibles
export class QuadBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  // p0..p3 en sentido antihorario visto desde el frente; uvs correspondientes
  quad(p0, p1, p2, p3, nrm, uv0, uv1, uv2, uv3, color) {
    const b = this.n;
    for (const p of [p0, p1, p2, p3]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) this.nor.push(nrm[0], nrm[1], nrm[2]);
    for (const u of [uv0, uv1, uv2, uv3]) this.uv.push(u[0], u[1]);
    _c.set(color == null ? 0xffffff : color);
    for (let i = 0; i < 4; i++) this.col.push(_c.r, _c.g, _c.b);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.n += 4;
  }
  toGeometry() {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    return g;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function matrixFrom(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z); _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

// Lote estático: acumula geometrías por material y las fusiona
export class StaticBatch {
  constructor(mats) {
    this.mats = mats;
    this.lists = new Map();
  }
  addGeometry(matKey, geo) {
    if (!geo) return;
    let l = this.lists.get(matKey);
    if (!l) { l = []; this.lists.set(matKey, l); }
    l.push(geo);
  }
  add(matKey, src, matrix, color, uvTile) {
    this.addGeometry(matKey, prepGeo(src, matrix, color, uvTile));
  }
  at(x = 0, y = 0, z = 0, ry = 0) { return new Placer(this, matrixFrom(x, y, z, 0, ry, 0)); }
  atMatrix(m) { return new Placer(this, m.clone()); }
  isEmpty() { return this.lists.size === 0; }
  // Construye las mallas fusionadas y las añade a parent
  build(parent, { shadows = true, name = 'static' } = {}) {
    const out = [];
    for (const [key, geos] of this.lists) {
      if (!geos.length) continue;
      let merged;
      try { merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false); }
      catch (e) { merged = null; }
      if (!merged) { console.warn('[World] no se pudo fusionar', key); continue; }
      for (const g of geos) if (g !== merged) g.dispose();
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, this.mats.get(key));
      mesh.name = name + ':' + key;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (shadows) {
        mesh.castShadow = this.mats.castShadow(key);
        mesh.receiveShadow = true;
      }
      parent.add(mesh);
      out.push(mesh);
    }
    this.lists.clear();
    return out;
  }
  // Construye un grupo independiente (para objetos dinámicos)
  toGroup({ shadows = false } = {}) {
    const g = new THREE.Group();
    this.build(g, { shadows, name: 'part' });
    for (const c of g.children) c.matrixAutoUpdate = true;
    return g;
  }
}

// Coloca primitivas en coordenadas locales de un padre (frente -Z, pies en y=0)
// o: { rx, ry, rz, color, uv (tile para UV de mundo local), seg, sx, sy, sz }
export class Placer {
  constructor(batch, parent) { this.batch = batch; this.parent = parent; }
  _m(x, y, z, o) {
    return this.parent.clone().multiply(matrixFrom(x, y, z, o.rx || 0, o.ry || 0, o.rz || 0, o.sx || 1, o.sy || 1, o.sz || 1));
  }
  geo(mat, geometry, x, y, z, o = {}) {
    const m = this._m(x, y, z, o);
    const g = prepGeo(geometry, null, o.color, null);
    // UV local escalada: se proyecta antes de transformar al mundo
    if (o.uv) boxProjectUV(g, o.uv);
    g.applyMatrix4(m);
    this.batch.addGeometry(mat, g);
    geometry.dispose();
    return this;
  }
  box(mat, w, h, d, x, y, z, o = {}) {
    return this.geo(mat, new THREE.BoxGeometry(w, h, d), x, y, z, o.uv === undefined && MAT_DEFS[mat] && MAT_DEFS[mat].tile ? Object.assign({ uv: MAT_DEFS[mat].tile }, o) : o);
  }
  // Caja apoyada: y = base inferior
  boxB(mat, w, h, d, x, y, z, o = {}) { return this.box(mat, w, h, d, x, y + h / 2, z, o); }
  cyl(mat, rTop, rBot, h, x, y, z, o = {}) {
    return this.geo(mat, new THREE.CylinderGeometry(rTop, rBot, h, o.seg || 12, 1, !!o.open), x, y, z, o);
  }
  sphere(mat, r, x, y, z, o = {}) {
    return this.geo(mat, new THREE.SphereGeometry(r, o.seg || 12, o.segV || Math.max(6, (o.seg || 12) >> 1)), x, y, z, o);
  }
  torus(mat, r, tube, x, y, z, o = {}) {
    return this.geo(mat, new THREE.TorusGeometry(r, tube, o.segT || 6, o.seg || 16, o.arc || TAU), x, y, z, o);
  }
  plane(mat, w, h, x, y, z, o = {}) {
    return this.geo(mat, new THREE.PlaneGeometry(w, h), x, y, z, o);
  }
  // Tubo entre dos puntos locales (cilindro orientado)
  rod(mat, a, b, r, o = {}) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    if (len < 1e-4) return this;
    const g = new THREE.CylinderGeometry(r, r, len, o.seg || 6, 1, !!o.open);
    const mid = va.clone().add(vb).multiplyScalar(0.5);
    const dir = vb.clone().sub(va).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const local = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
    const m = this.parent.clone().multiply(local);
    const pg = prepGeo(g, null, o.color, null);
    pg.applyMatrix4(m);
    this.batch.addGeometry(mat, pg);
    g.dispose();
    return this;
  }
  sub(x, y, z, ry = 0, rx = 0, rz = 0, s = 1) {
    return new Placer(this.batch, this.parent.clone().multiply(matrixFrom(x, y, z, rx, ry, rz, s, s, s)));
  }
}

// Plano con un rectángulo de UV (para atlas y carteles)
export function uvRectPlane(w, h, u0, v0, u1, v1) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) === 0 ? u0 : u1, uv.getY(i) === 0 ? v0 : v1);
  }
  return g;
}

// Malla suelta con atributo de color blanco (para materiales con vertexColors)
export function vcMesh(geometry, material) {
  const g = prepGeo(geometry, null, 0xffffff, null);
  geometry.dispose();
  return new THREE.Mesh(g, material);
}
