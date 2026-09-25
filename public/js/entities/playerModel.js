// Modelo procedural de jugador remoto: soldado con uniforme teñido con el color del jugador, casco con banda de color,
// chaleco táctico y mochila. Sostiene el arma real (createWeaponMesh) con las dos manos mediante IK de dos huesos.
// Poses por banderas PF: de pie, agachado (rodilla en tierra), correr (arma cruzada), apuntar, recargar, beber,
// caído ("última batalla": tendido con la pistola), escudo delante o a la espalda. Piernas animadas según la
// velocidad real, inclinación (pitch) repartida entre torso, brazos y cabeza, y nombre flotante.
// Frente hacia -Z y pies en y = 0 (SPEC 1).
import * as THREE from 'three';
import { PF } from '/shared/protocol.js';
import { weaponDef } from '/shared/weapons.js';
import {
  rng, makeCanvas, canvasTexture, blotches, paintGeo, solidColor, mergeGeos, makeMat, limbGeo, smoothstep, clamp01,
  glowTexture, deform,
} from './procgen.js';

// ------------------------------------------------------------------ Modelos de armas (carga tolerante a fallos)
let MODELS = null;
let modelsFailed = false;
import('../weapons/models.js')
  .then((m) => { MODELS = m && (m.createWeaponMesh ? m : m.default) || null; })
  .catch((err) => { modelsFailed = true; console.warn('[PlayerModel] No se pudieron cargar los modelos de armas; se usa un respaldo simple.', err); });

const TAU = Math.PI * 2;

// Esqueleto (m). Cadera a 0.95, hombros a 1.40, centro de la cabeza a ~1.61.
const D = {
  hipY: 0.95, hipX: 0.1, hipJY: -0.04,
  thigh: 0.45, shin: 0.44,
  neckY: 0.53, headC: 0.13,
  shoulderX: 0.2, shoulderY: 0.45,
  upper: 0.3, fore: 0.32,           // antebrazo medido hasta el centro de la palma
  aimY: 0.4,
};
const LEG = D.thigh + D.shin;

// --------------------------------------------------------------------------------------------
// Recursos compartidos
// --------------------------------------------------------------------------------------------
let ASSETS = null;

function camoCanvas() {
  const c = makeCanvas(128, 128);
  if (!c) return null;
  const g = c.getContext('2d');
  const r = rng(77);
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, 0, 128, 128);
  blotches(g, 128, 128, r, '#8a8a8a', 26, 6, 16, 0.55, 0.8);
  blotches(g, 128, 128, r, '#5c5c5c', 18, 4, 12, 0.5, 0.75);
  blotches(g, 128, 128, r, '#f2f2f2', 14, 3, 9, 0.3, 0.5);
  blotches(g, 128, 128, r, '#000000', 90, 0.5, 1.5, 0.05, 0.15);
  return c;
}

function profile(t, pts) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const a = pts[i - 1], b = pts[i];
      const k = (t - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * (k * k * (3 - 2 * k));
    }
  }
  return pts[pts.length - 1][1];
}

function box(w, h, d, x, y, z, shade = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return solidColor(g, shade, shade, shade);
}

function torsoGeo() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 16, 8, false);
  deform(g, (v) => {
    const t = v.y + 0.5;
    const w = profile(t, [[0, 0.155], [0.35, 0.165], [0.7, 0.2], [0.9, 0.195], [1, 0.075]]);
    const d = profile(t, [[0, 0.1], [0.4, 0.11], [0.75, 0.125], [0.92, 0.11], [1, 0.06]]);
    v.set(v.x * w, -0.02 + t * 0.56, v.z * d);
  });
  // cuello de la chaqueta
  const collar = new THREE.CylinderGeometry(0.068, 0.08, 0.06, 12, 1, true);
  collar.translate(0, 0.53, 0.005);
  paintGeo(g, (x, y, z, c) => { const k = 0.82 + 0.18 * smoothstep(0, 0.3, y); c.setRGB(k, k, k); });
  solidColor(collar, 0.8, 0.8, 0.8);
  return mergeGeos([g, collar]);
}

function pelvisGeo() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 14, 2, false);
  deform(g, (v) => {
    const t = v.y + 0.5;
    const w = profile(t, [[0, 0.14], [0.6, 0.162], [1, 0.158]]);
    const d = profile(t, [[0, 0.095], [0.6, 0.11], [1, 0.105]]);
    v.set(v.x * w, -0.12 + t * 0.18, v.z * d);
  });
  return solidColor(g, 1, 1, 1);
}

function beltGeo() {
  const parts = [];
  const belt = new THREE.CylinderGeometry(0.168, 0.168, 0.05, 16, 1, true);
  belt.scale(1, 1, 0.7);
  belt.translate(0, 0.035, 0);
  parts.push(solidColor(belt, 0.7, 0.7, 0.7));
  parts.push(box(0.05, 0.035, 0.012, 0, 0.035, -0.12, 0.35));                     // hebilla
  parts.push(box(0.07, 0.09, 0.05, -0.15, 0.0, -0.04, 1.0));                      // bolsas laterales
  parts.push(box(0.07, 0.09, 0.05, 0.15, 0.0, -0.04, 1.0));
  parts.push(box(0.06, 0.12, 0.05, 0.17, -0.06, 0.05, 0.85));                     // funda
  return mergeGeos(parts);
}

function vestGeo() {
  const parts = [];
  parts.push(box(0.34, 0.3, 0.05, 0, 0.29, -0.115, 1));                           // placa frontal
  parts.push(box(0.34, 0.32, 0.05, 0, 0.3, 0.115, 0.95));                         // placa trasera
  parts.push(box(0.06, 0.06, 0.26, -0.13, 0.47, 0, 0.85));                        // hombreras
  parts.push(box(0.06, 0.06, 0.26, 0.13, 0.47, 0, 0.85));
  for (const x of [-0.1, 0, 0.1]) parts.push(box(0.075, 0.1, 0.05, x, 0.2, -0.155, 0.78));   // portacargadores
  parts.push(box(0.06, 0.07, 0.04, -0.1, 0.36, -0.15, 0.7));                      // radio
  // mochila con saco de dormir
  parts.push(box(0.28, 0.3, 0.13, 0, 0.3, 0.2, 0.9));
  const roll = new THREE.CylinderGeometry(0.06, 0.06, 0.3, 10);
  roll.rotateZ(Math.PI / 2);
  roll.translate(0, 0.49, 0.2);
  parts.push(solidColor(roll, 0.6, 0.62, 0.55));
  const ant = new THREE.CylinderGeometry(0.004, 0.006, 0.34, 5);
  ant.translate(0.1, 0.62, 0.24);
  parts.push(solidColor(ant, 0.2, 0.2, 0.2));
  return mergeGeos(parts);
}

function headGeo() {
  const g = new THREE.SphereGeometry(0.1, 16, 12);
  deform(g, (v) => {
    const nz = v.z / 0.1, ny = v.y / 0.1;
    // mandíbula más estrecha, nariz y arco de las cejas
    if (ny < -0.2) v.x *= 1 - 0.18 * clamp01((-ny - 0.2) / 0.8);
    v.z -= 0.012 * Math.exp(-((v.x / 0.02) ** 2 + ((v.y + 0.005) / 0.025) ** 2)) * (nz < -0.6 ? 1 : 0);
    v.set(v.x * 0.92, v.y * 1.08, v.z);
  }, true);
  paintGeo(g, (x, y, z, c) => {
    c.setRGB(1, 1, 1);
    if (z < -0.06) {
      for (const s of [-1, 1]) {
        const e = Math.hypot(x - s * 0.034, y - 0.014);
        if (e < 0.013) c.setRGB(0.12, 0.1, 0.09);                    // ojos
        else if (Math.abs(y - 0.034) < 0.006 && Math.abs(x - s * 0.034) < 0.022) c.setRGB(0.3, 0.22, 0.17); // cejas
      }
      if (Math.abs(y + 0.045) < 0.005 && Math.abs(x) < 0.025) c.setRGB(0.45, 0.28, 0.25);        // boca
    }
    if (y < -0.03) c.multiplyScalar(0.8 + 0.2 * smoothstep(-0.1, -0.03, y));                    // barba de días
  });
  const ears = [-1, 1].map((s) => {
    const e = new THREE.SphereGeometry(0.022, 6, 5);
    e.scale(0.5, 1, 0.8);
    e.translate(s * 0.093, 0.0, 0.005);
    return solidColor(e, 0.92, 0.92, 0.92);
  });
  const neck = new THREE.CylinderGeometry(0.047, 0.055, 0.14, 10);
  neck.translate(0, -0.1, 0.01);
  solidColor(neck, 0.85, 0.85, 0.85);
  const out = mergeGeos([g, ...ears, neck]);
  out.translate(0, D.headC, 0);
  return out;
}

function helmetGeo() {
  const dome = new THREE.SphereGeometry(0.124, 16, 7, 0, TAU, 0, Math.PI / 2);
  dome.scale(1.0, 0.86, 1.1);
  const rim = new THREE.CylinderGeometry(0.128, 0.132, 0.03, 18, 1, true);
  rim.scale(1, 1, 1.1);
  rim.translate(0, -0.012, 0);
  const cover = new THREE.BoxGeometry(0.06, 0.035, 0.03);
  cover.translate(0, 0.07, -0.118);
  const parts = [paintGeo(dome, (x, y, z, c) => { const k = 0.85 + 0.15 * smoothstep(0, 0.1, y); c.setRGB(k, k, k); }),
    solidColor(rim, 0.75, 0.75, 0.75), solidColor(cover, 0.45, 0.45, 0.45)];
  const g = mergeGeos(parts);
  g.translate(0, D.headC + 0.035, 0.004);
  return g;
}

function bandGeo() {
  const g = new THREE.TorusGeometry(0.126, 0.011, 5, 28);
  g.rotateX(Math.PI / 2);
  g.scale(1, 1, 1.1);
  g.translate(0, D.headC + 0.045, 0.004);
  return solidColor(g, 1, 1, 1);
}

function thighGeo() {
  const g = limbGeo(D.thigh, 0.088, 0.066, 10, 3);
  const cap = new THREE.SphereGeometry(0.086, 10, 6);
  cap.scale(1, 0.8, 1);
  return mergeGeos([solidColor(g, 1, 1, 1), solidColor(cap, 1, 1, 1)]);
}

function shinGeo() {
  const shin = limbGeo(D.shin - 0.05, 0.066, 0.052, 10, 2);
  solidColor(shin, 1, 1, 1);
  const knee = new THREE.SphereGeometry(0.06, 8, 6);
  knee.scale(1, 1.1, 0.7);
  knee.translate(0, -0.02, -0.045);
  solidColor(knee, 0.55, 0.57, 0.5);                                              // rodillera
  const boot = new THREE.BoxGeometry(0.105, 0.11, 0.26, 2, 1, 2);
  deform(boot, (v) => { if (v.z < -0.06 && v.y > 0) v.y -= 0.03; }, false);
  boot.translate(0, -D.shin + 0.05, -0.045);
  paintGeo(boot, (x, y, z, c) => { const sole = y < -D.shin + 0.015 ? 0.08 : 0.2; c.setRGB(sole, sole * 0.9, sole * 0.8); });
  const cuff = new THREE.CylinderGeometry(0.06, 0.062, 0.08, 10);
  cuff.translate(0, -D.shin + 0.13, 0);
  solidColor(cuff, 0.22, 0.2, 0.18);
  return mergeGeos([shin, knee, boot, cuff]);
}

function upperArmGeo() {
  const g = limbGeo(D.upper, 0.058, 0.048, 9, 2);
  const cap = new THREE.SphereGeometry(0.066, 9, 6);
  cap.scale(1, 0.9, 1);
  return mergeGeos([solidColor(g, 1, 1, 1), solidColor(cap, 1, 1, 1)]);
}

function forearmGeo() {
  const g = limbGeo(D.fore - 0.07, 0.048, 0.04, 9, 2);
  const elbow = new THREE.SphereGeometry(0.048, 8, 6);
  const cuff = new THREE.CylinderGeometry(0.044, 0.044, 0.04, 9);
  cuff.translate(0, -D.fore + 0.08, 0);
  const hand = new THREE.BoxGeometry(0.058, 0.1, 0.042);
  deform(hand, (v) => { if (v.y < 0) v.z -= 0.01; }, false);
  hand.translate(0, -D.fore + 0.005, -0.005);
  const thumb = new THREE.BoxGeometry(0.02, 0.05, 0.022);
  thumb.rotateZ(0.5);
  thumb.translate(0.03, -D.fore + 0.03, -0.02);
  return mergeGeos([
    solidColor(g, 1, 1, 1), solidColor(elbow, 1, 1, 1), solidColor(cuff, 0.5, 0.5, 0.5),
    solidColor(hand, 0.16, 0.15, 0.14), solidColor(thumb, 0.16, 0.15, 0.14),       // guantes
  ]);
}

export function getPlayerAssets(quality = 'high') {
  if (ASSETS) return ASSETS;
  const q = quality === 'low' ? 'low' : 'high';
  const A = { quality: q, geos: {}, mats: {}, perColor: new Map() };
  A.camo = canvasTexture(camoCanvas());
  A.camo.wrapS = A.camo.wrapT = THREE.RepeatWrapping;
  A.mats.pants = makeMat(q, { map: A.camo, color: 0x5a5e4c, vertexColors: true, roughness: 0.95 });
  A.mats.gear = makeMat(q, { color: 0x3e4133, vertexColors: true, roughness: 0.85 });
  A.mats.skin = makeMat(q, { color: 0xc49a7c, vertexColors: true, roughness: 0.7 });
  A.mats.helmet = makeMat(q, { color: 0x4f5541, vertexColors: true, roughness: 0.7, metalness: 0.1 });
  A.geos.torso = torsoGeo();
  A.geos.pelvis = pelvisGeo();
  A.geos.belt = beltGeo();
  A.geos.vest = vestGeo();
  A.geos.head = headGeo();
  A.geos.helmet = helmetGeo();
  A.geos.band = bandGeo();
  A.geos.thigh = thighGeo();
  A.geos.shin = shinGeo();
  A.geos.upper = upperArmGeo();
  A.geos.fore = forearmGeo();
  A.glow = glowTexture(64, 2.0);
  // arma de respaldo (si models.js no está disponible)
  A.geos.fallbackGun = mergeGeos([
    box(0.05, 0.08, 0.5, 0, 0.05, -0.2, 0.9), box(0.035, 0.12, 0.05, 0, -0.04, 0.0, 0.7),
    box(0.03, 0.03, 0.2, 0, 0.07, -0.52, 0.6), box(0.045, 0.1, 0.18, 0, 0.02, 0.14, 0.8),
  ]);
  A.mats.fallbackGun = makeMat(q, { color: 0x2c2c2e, vertexColors: true, roughness: 0.5, metalness: 0.5 });
  ASSETS = A;
  return A;
}

// Materiales teñidos por color de jugador (compartidos entre modelos del mismo color)
function colorMats(A, color) {
  const key = String(color || '#ffffff').toLowerCase();
  let m = A.perColor.get(key);
  if (m) return m;
  const pc = new THREE.Color();
  try { pc.set(key); } catch { pc.set(0xffffff); }
  const tint = new THREE.Color(0x5b604f).lerp(pc, 0.58);
  m = {
    jacket: makeMat(A.quality, { map: A.camo, color: tint, vertexColors: true, roughness: 0.92 }),
    accent: makeMat(A.quality, { color: pc, emissive: pc, emissiveIntensity: 0.35, vertexColors: true, roughness: 0.5 }),
  };
  A.perColor.set(key, m);
  return m;
}

export function playerMaterials(quality) {
  const A = getPlayerAssets(quality);
  const list = Object.values(A.mats);
  for (const m of A.perColor.values()) list.push(m.jacket, m.accent);
  return list;
}

// --------------------------------------------------------------------------------------------
// IK de dos huesos (en el espacio local del torso)
// --------------------------------------------------------------------------------------------
const DOWN = new THREE.Vector3(0, -1, 0);
const _d = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Vector3();
const _h = new THREE.Vector3();
const _t = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();

function solveArm(arm, S, T, pole, a, b) {
  _d.subVectors(T, S);
  let dist = _d.length();
  if (dist < 1e-5) { _d.set(0, -1, 0); dist = 1e-3; }
  _u.copy(_d).divideScalar(dist);
  dist = Math.min(Math.max(dist, Math.abs(a - b) + 1e-3), (a + b) * 0.999);
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _w.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_w.lengthSq() < 1e-8) _w.set(0, -1, 0).addScaledVector(_u, -_u.y);
  _w.normalize();
  _e.copy(_u).multiplyScalar(cosA).addScaledVector(_w, sinA);          // dirección del codo
  _h.copy(S).addScaledVector(_u, dist).sub(_t.copy(S).addScaledVector(_e, a)).normalize();   // codo → mano
  _q1.setFromUnitVectors(DOWN, _e);
  arm.sh.quaternion.copy(_q1);
  _q2.setFromUnitVectors(DOWN, _h);
  arm.el.quaternion.copy(_q1.invert().multiply(_q2));
}

// --------------------------------------------------------------------------------------------
// Índices de la pose (se suavizan juntos)
// --------------------------------------------------------------------------------------------
const HY = 0, HRX = 1, HZ = 2, SRX = 3, SRY = 4, SRZ = 5, NRX = 6, NRY = 7;
const LSW = 8, LSP = 9, LKN = 10, RSW = 11, RSP = 12, RKN = 13;
const WPX = 14, WPY = 15, WPZ = 16, WRX = 17, WRY = 18, WRZ = 19, TAGY = 20, NP = 21;

// Posiciones del arma (empuñadura) relativas al pivote de puntería
const HOLD = {
  rifleHip: [0.11, -0.12, -0.21, 0.04, 0.11, 0],
  rifleAds: [0.075, 0.16, -0.19, 0, 0.07, 0],
  pistolHip: [0.07, -0.05, -0.42, 0.02, 0.03, 0],
  pistolAds: [0.025, 0.13, -0.47, 0, 0.01, 0],
  sprint: [0.1, -0.16, -0.22, -0.75, 0.95, 0.25],
  reload: [0.11, -0.1, -0.22, 0.4, 0.14, -0.65],
  drink: [0.2, -0.33, -0.1, -1.15, 0.25, 0],
  shield: [0.02, -0.12, -0.42, 0.04, 0, 0],
};

const POLE_R = new THREE.Vector3(0.9, -1, 0.55);
const POLE_L = new THREE.Vector3(-0.9, -1, 0.35);
const POLE_R_ADS = new THREE.Vector3(1.4, -0.6, 0.3);

function isPistolDef(def) {
  if (!def) return false;
  return def.cls === 'pistol' || def.model === 'pistol' || def.model === 'revolver' || def.model === 'raygun' || def.model === 'raygun2';
}

function flashColor(def) {
  if (!def) return 0xffc27a;
  if (def.model === 'raygun') return def.upgraded ? 0xff4a3a : 0x5aff6a;
  if (def.model === 'raygun2') return def.upgraded ? 0xff4a3a : 0x6affd0;
  if (def.special === 'explosive') return 0xff7a3a;
  return 0xffc27a;
}

// --------------------------------------------------------------------------------------------
// PlayerModel
// --------------------------------------------------------------------------------------------
// Haz de linterna (PF.FLASHLIGHT): cono aditivo compartido por todos los modelos
let torchAssets = null;
function getTorchAssets() {
  if (torchAssets) return torchAssets;
  const len = 7;
  const cone = new THREE.ConeGeometry(1.5, len, 18, 1, true);
  cone.translate(0, -len / 2, 0);
  cone.rotateX(Math.PI / 2);           // vértice en el origen, abre hacia -Z
  const beam = new THREE.MeshBasicMaterial({
    color: 0xfff1c8, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const lens = new THREE.MeshBasicMaterial({ color: 0xfff8e8 });
  torchAssets = { cone, beam, lens, lensGeo: new THREE.SphereGeometry(0.035, 8, 6) };
  return torchAssets;
}
const _tv = new THREE.Vector3();

export class PlayerModel {
  constructor(opts = {}) {
    const A = getPlayerAssets(opts.quality);
    this.A = A;
    this.id = opts.id;
    this.color = null;
    this.name = null;
    this.meshes = [];
    const shadows = A.quality !== 'low';
    const mesh = (geo, mat, parent, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow && shadows;
      parent.add(m);
      this.meshes.push(m);
      return m;
    };

    this.group = new THREE.Group();
    this.group.name = 'player';
    this.hips = new THREE.Group();
    this.hips.position.y = D.hipY;
    this.group.add(this.hips);
    this.pelvis = mesh(A.geos.pelvis, A.mats.pants, this.hips);
    mesh(A.geos.belt, A.mats.gear, this.hips, false);
    const leg = (side) => {
      const th = new THREE.Group();
      th.position.set(side * D.hipX, D.hipJY, 0);
      this.hips.add(th);
      mesh(A.geos.thigh, A.mats.pants, th);
      const kn = new THREE.Group();
      kn.position.y = -D.thigh;
      th.add(kn);
      mesh(A.geos.shin, A.mats.pants, kn);
      return { th, kn };
    };
    this.legL = leg(-1);
    this.legR = leg(1);

    this.spine = new THREE.Group();
    this.hips.add(this.spine);
    this.torso = mesh(A.geos.torso, null, this.spine);
    mesh(A.geos.vest, A.mats.gear, this.spine);
    this.neck = new THREE.Group();
    this.neck.position.set(0, D.neckY, 0.01);
    this.spine.add(this.neck);
    mesh(A.geos.head, A.mats.skin, this.neck);
    mesh(A.geos.helmet, A.mats.helmet, this.neck);
    this.band = mesh(A.geos.band, null, this.neck, false);
    this.headPt = new THREE.Object3D();
    this.headPt.position.set(0, D.headC, 0);
    this.neck.add(this.headPt);

    const arm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(side * D.shoulderX, D.shoulderY, 0.01);
      this.spine.add(sh);
      const um = mesh(A.geos.upper, null, sh);
      const el = new THREE.Group();
      el.position.y = -D.upper;
      sh.add(el);
      const fm = mesh(A.geos.fore, null, el);
      return { sh, el, um, fm, side };
    };
    this.armL = arm(-1);
    this.armR = arm(1);
    this._tinted = [this.torso, this.armL.um, this.armL.fm, this.armR.um, this.armR.fm];

    // Puntería: el arma y el escudo cuelgan de este pivote (en el pecho)
    this.aim = new THREE.Group();
    this.aim.position.set(0, D.aimY, 0);
    this.spine.add(this.aim);
    this.holder = new THREE.Group();
    this.aim.add(this.holder);
    this.shieldHolder = new THREE.Group();
    this.shieldHolder.position.set(HOLD.shield[0], HOLD.shield[1], HOLD.shield[2]);
    this.aim.add(this.shieldHolder);
    this.backHolder = new THREE.Group();
    this.backHolder.position.set(0, 0.3, 0.29);
    this.backHolder.rotation.set(-0.08, Math.PI, 0);
    this.spine.add(this.backHolder);

    // Arma
    this.weapons = new Map();         // clave → grupo (caché por modelo)
    this.weapon = null;
    this.weaponKey = null;
    this.weaponDef = null;
    this.weaponFallback = false;
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({
      map: A.glow, color: 0xffc27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.muzzle.visible = false;
    this.muzzle.renderOrder = 6;
    this.muzzleT = 0;
    this.recoil = 0;

    // Escudo
    this.shield = null;

    // Nombre flotante
    this.tag = null;
    this.tagCanvas = null;
    this.tagOpacity = 1;

    // Estado de animación
    this.tp = new Float32Array(NP);
    this.cp = new Float32Array(NP);
    this.cycle = Math.random() * TAU;
    this.speed = 0;
    this.vFwd = 0;
    this.vSide = 0;
    this.lastX = null;
    this.lastZ = null;
    this.yaw = 0;
    this.time = Math.random() * 10;
    this.flags = 0;
    this.pitch = 0;
    this._first = true;

    this.setColor(opts.color || '#ffffff');
    this.setName(opts.name || '');
  }

  // ------------------------------------------------------------------ Apariencia
  setColor(color) {
    const c = String(color || '#ffffff');
    if (c === this.color) return;
    this.color = c;
    const m = colorMats(this.A, c);
    for (const mm of this._tinted) mm.material = m.jacket;
    this.band.material = m.accent;
    if (this.name !== null) this._drawTag();
  }

  setName(name) {
    const n = String(name || '').slice(0, 16);
    if (n === this.name) return;
    this.name = n;
    this._drawTag();
  }

  _drawTag() {
    if (!this.tagCanvas) {
      this.tagCanvas = makeCanvas(256, 64);
      if (!this.tagCanvas) return;
      const tex = canvasTexture(this.tagCanvas);
      tex.anisotropy = 1;
      this.tag = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      }));
      this.tag.scale.set(1.0, 0.25, 1);
      this.tag.position.y = 2.05;
      this.tag.renderOrder = 20;
      this.group.add(this.tag);
    }
    const g = this.tagCanvas.getContext('2d');
    g.clearRect(0, 0, 256, 64);
    g.font = 'bold 34px "Segoe UI", Tahoma, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(this.name || '', 128, 34);
    g.fillStyle = this.color || '#ffffff';
    g.fillText(this.name || '', 128, 34);
    this.tag.material.map.needsUpdate = true;
  }

  // Opacidad del nombre (la baja EntityManager si no hay línea de visión)
  setTagVisibility(opacity) { this.tagOpacity = opacity; }

  // ------------------------------------------------------------------ Arma y escudo
  _setWeapon(key, up) {
    const k = key ? `${key}${up ? '+' : ''}` : '';
    const needRetry = this.weaponFallback && MODELS;
    if (k === this.weaponKey && !needRetry) return;
    if (this.weapon) {
      this.holder.remove(this.weapon);
      if (this.muzzle.parent) this.muzzle.parent.remove(this.muzzle);
    }
    if (needRetry && this.weaponKey) this.weapons.delete(this.weaponKey);
    this.weapon = null;
    this.weaponKey = k;
    this.weaponDef = key ? weaponDef(key, !!up) : null;
    this.weaponFallback = false;
    if (!key) return;
    let g = this.weapons.get(k);
    if (!g) {
      if (MODELS && typeof MODELS.createWeaponMesh === 'function') {
        try { g = MODELS.createWeaponMesh(key, !!up); } catch (err) { g = null; console.warn('[PlayerModel] createWeaponMesh falló:', err); }
      }
      if (!g) {
        g = new THREE.Group();
        const m = new THREE.Mesh(this.A.geos.fallbackGun, this.A.mats.fallbackGun);
        g.add(m);
        g.userData = { muzzle: new THREE.Vector3(0, 0.07, -0.62), leftHand: new THREE.Vector3(0, 0.02, -0.28), leftHandParent: null };
        this.weaponFallback = !modelsFailed;
      }
      g.traverse((o) => { if (o.isMesh) o.castShadow = this.A.quality !== 'low'; });
      if (!this.weaponFallback) this.weapons.set(k, g);
    }
    this.weapon = g;
    this.holder.add(g);
    const ud = g.userData || {};
    const mz = ud.muzzle && ud.muzzle.isVector3 ? ud.muzzle : new THREE.Vector3(0, 0.06, -0.5);
    this.muzzle.position.copy(mz);
    g.add(this.muzzle);
    this.muzzle.material.color.set(flashColor(this.weaponDef));
  }

  _ensureShield() {
    if (this.shield) return this.shield;
    let s = null;
    if (MODELS && typeof MODELS.createShieldMesh === 'function') {
      try { s = MODELS.createShieldMesh(); } catch { s = null; }
    }
    if (!s) {
      s = new THREE.Group();
      s.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.92, 0.05), this.A.mats.gear));
      s.userData = { handleL: new THREE.Vector3(-0.12, -0.12, 0.1), handleR: new THREE.Vector3(0.14, 0.06, 0.1) };
    }
    this.shield = s;
    return s;
  }

  // Destello del cañón y retroceso (disparo de este jugador)
  onFire() {
    if (!this.weapon) return;
    this.muzzleT = 0.05;
    this.muzzle.visible = true;
    this.muzzle.material.rotation = Math.random() * TAU;
    const big = this.weaponDef && (this.weaponDef.cls === 'shotgun' || this.weaponDef.cls === 'sniper' || this.weaponDef.cls === 'launcher');
    this.muzzle.scale.setScalar(big ? 0.55 : 0.36);
    this.recoil = Math.min(1, this.recoil + (big ? 1 : 0.55));
  }

  getHeadWorld(out) { return this.headPt.getWorldPosition(out); }

  getMuzzleWorld(out) {
    if (this.weapon && this.muzzle.parent) return this.muzzle.getWorldPosition(out);
    return this.headPt.getWorldPosition(out);
  }

  // ------------------------------------------------------------------ Actualización
  // st: { x, y, z, yaw, pitch, flags, w, up, hasShield }
  _ensureTorch() {
    if (this.torch) return this.torch;
    const T = getTorchAssets();
    this.torch = new THREE.Group();
    this.torch.name = 'torch';
    const cone = new THREE.Mesh(T.cone, T.beam);
    cone.renderOrder = 4;
    cone.frustumCulled = false;
    this.torch.add(cone, new THREE.Mesh(T.lensGeo, T.lens));
    this.group.add(this.torch);
    return this.torch;
  }

  _updateTorch(on) {
    if (!on) { if (this.torch) this.torch.visible = false; return; }
    const t = this._ensureTorch();
    t.visible = true;
    // a la altura de la cabeza, algo adelantada y a la derecha
    this.headPt.getWorldPosition(_tv);
    this.group.worldToLocal(_tv);
    t.position.set(0.14, _tv.y - 0.12, -0.2);
    t.rotation.set(this.pitch, 0, 0);
  }

  update(dt, st) {
    this.time += dt;
    const flags = st.flags | 0;
    this.flags = flags;
    const x = +st.x || 0, y = Math.max(0, +st.y || 0), z = +st.z || 0;
    // velocidad real a partir del desplazamiento renderizado
    if (this.lastX === null || dt <= 0) { this.lastX = x; this.lastZ = z; }
    const vx = dt > 0 ? (x - this.lastX) / dt : 0, vz = dt > 0 ? (z - this.lastZ) / dt : 0;
    this.lastX = x; this.lastZ = z;
    const yaw = +st.yaw || 0;
    const sn = Math.sin(yaw), cs = Math.cos(yaw);
    let fwd = -vx * sn - vz * cs, side = vx * cs - vz * sn;
    if (Math.hypot(vx, vz) > 12) { fwd = 0; side = 0; }                       // teletransporte
    const k = 1 - Math.exp(-10 * dt);
    this.vFwd += (fwd - this.vFwd) * k;
    this.vSide += (side - this.vSide) * k;
    this.speed = Math.hypot(this.vFwd, this.vSide);

    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.yaw = yaw;
    this.pitch = Math.max(-1.2, Math.min(1.2, +st.pitch || 0));

    this._setWeapon(st.w || '', !!st.up);
    this._pose(dt, flags, y, !!st.hasShield);

    // suavizado
    const tp = this.tp, cp = this.cp;
    if (this._first) { cp.set(tp); this._first = false; }
    const kk = 1 - Math.exp(-12 * dt);
    for (let i = 0; i < NP; i++) cp[i] += (tp[i] - cp[i]) * kk;
    this._apply(flags, !!st.hasShield);
    this._updateTorch(!!(flags & PF.FLASHLIGHT));

    // destello y retroceso
    if (this.muzzleT > 0) { this.muzzleT -= dt; if (this.muzzleT <= 0) this.muzzle.visible = false; }
    this.recoil = Math.max(0, this.recoil - dt * 6);

    // nombre
    if (this.tag) {
      this.tag.position.y = cp[TAGY];
      const m = this.tag.material;
      m.opacity += (this.tagOpacity - m.opacity) * (1 - Math.exp(-8 * dt));
    }
  }

  _pose(dt, flags, y, hasShield) {
    const tp = this.tp;
    tp.fill(0);
    const down = !!(flags & PF.DOWN);
    const crouch = !!(flags & PF.CROUCH) && !down;
    const sprint = !!(flags & PF.SPRINT) && !down && !crouch;
    const ads = !!(flags & PF.ADS) && !sprint && !down;
    const jumping = (!!(flags & PF.JUMPING) || y > 0.12) && !down;
    const reloading = !!(flags & PF.RELOADING);
    const drinking = !!(flags & PF.DRINKING);
    const shieldOut = !!(flags & PF.SHIELD_OUT) && hasShield && !down;
    const spd = this.speed;
    const moving = spd > 0.3;
    const fr = spd > 0.01 ? this.vFwd / spd : 1, sr = spd > 0.01 ? this.vSide / spd : 0;

    // ciclo de pasos acorde a la velocidad
    const stride = down ? 0.5 : crouch ? 1.1 : sprint ? 2.5 : 1.75;
    this.cycle += (moving ? spd / stride : 0) * TAU * dt;
    const c = this.cycle, s = Math.sin(c), co = Math.cos(c);
    const amp = Math.min(1, spd / (sprint ? 6.6 : 4.6)) * (sprint ? 0.78 : crouch ? 0.4 : 0.55);

    tp[HY] = D.hipY;
    tp[TAGY] = 2.05;
    tp[SRX] = -0.03 + 0.012 * Math.sin(this.time * 1.8);   // respiración

    if (down) {
      // Última batalla: tendido, apoyado en el codo izquierdo, pistola al frente; se arrastra
      tp[HY] = 0.19; tp[HRX] = 1.22; tp[HZ] = 0.05;
      tp[SRX] = -0.5 + 0.05 * Math.sin(this.time * 2.2);
      tp[SRZ] = 0.08;
      const scoot = moving ? Math.sin(c) : 0;
      tp[LSW] = -0.25 + 0.2 * scoot; tp[LKN] = 0.25 + 0.5 * Math.max(0, scoot);
      tp[RSW] = -0.05 - 0.2 * scoot; tp[RKN] = 0.9 + 0.5 * Math.max(0, -scoot);
      tp[LSP] = 0.12; tp[RSP] = 0.08;
      tp[TAGY] = 1.05;
    } else if (jumping) {
      tp[LSW] = 0.65; tp[LKN] = 1.0; tp[RSW] = 0.25; tp[RKN] = 0.7;
      tp[HY] = D.hipY - 0.05;
      tp[SRX] = -0.08;
    } else if (crouch) {
      if (moving) {
        tp[HY] = 0.66;
        tp[LSW] = 0.75 + amp * s * fr; tp[RSW] = 0.75 - amp * s * fr;
        tp[LSP] = amp * 0.5 * s * sr; tp[RSP] = -amp * 0.5 * s * sr;
        tp[LKN] = 1.35 + 0.4 * Math.max(0, co); tp[RKN] = 1.35 + 0.4 * Math.max(0, -co);
        tp[SRX] = -0.28;
      } else {
        // rodilla derecha en tierra
        tp[HY] = 0.56;
        tp[LSW] = 1.35; tp[LKN] = 1.42;
        tp[RSW] = -0.08; tp[RKN] = 1.55;
        tp[LSP] = 0.08; tp[RSP] = 0.05;
        tp[SRX] = -0.18;
      }
      tp[TAGY] = 1.62;
    } else if (moving) {
      tp[LSW] = amp * s * fr; tp[RSW] = -amp * s * fr;
      tp[LSP] = amp * 0.55 * s * sr; tp[RSP] = -amp * 0.55 * s * sr;
      const kneeAmp = sprint ? 1.35 : 0.85;
      tp[LKN] = 0.12 + kneeAmp * amp * 1.4 * Math.max(0, co); tp[RKN] = 0.12 + kneeAmp * amp * 1.4 * Math.max(0, -co);
      tp[HY] = D.hipY - 0.025 - 0.035 * amp * Math.abs(Math.sin(2 * c));
      tp[SRY] = 0.1 * s * amp;
      tp[SRX] = sprint ? -0.24 : -0.06;
    } else {
      tp[LSW] = 0.03; tp[RSW] = -0.05; tp[LKN] = 0.08; tp[RKN] = 0.1;
      tp[LSP] = 0.05; tp[RSP] = 0.07;
    }
    if (ads && !down) tp[SRX] -= 0.04;

    // Puntería: el pitch se reparte entre torso (poco), cabeza y pivote del arma
    const pitch = this.pitch;
    if (!down) tp[SRX] += pitch * 0.18;
    const net = tp[HRX] + tp[SRX];
    tp[NRX] = pitch * (down ? 0.55 : 0.5) - net * 0.85;
    if (ads) tp[NRY] = 0.12;

    // Arma en las manos
    let hold = null;
    const def = this.weaponDef;
    const pistol = isPistolDef(def);
    if (shieldOut) hold = null;
    else if (drinking) hold = HOLD.drink;
    else if (sprint && this.weapon) hold = HOLD.sprint;
    else if (reloading && this.weapon && !down) hold = HOLD.reload;
    else if (this.weapon) hold = ads ? (pistol ? HOLD.pistolAds : HOLD.rifleAds) : (pistol || down ? HOLD.pistolHip : HOLD.rifleHip);
    if (hold) {
      tp[WPX] = hold[0]; tp[WPY] = hold[1]; tp[WPZ] = hold[2];
      tp[WRX] = hold[3]; tp[WRY] = hold[4]; tp[WRZ] = hold[5];
      if (reloading && hold === HOLD.reload) {
        tp[WRZ] += 0.12 * Math.sin(this.time * 7);
        tp[WPY] += 0.02 * Math.sin(this.time * 9);
      }
      if (moving && !sprint && !ads) { tp[WPY] += 0.012 * Math.sin(2 * c); tp[WPX] += 0.01 * s; }
    }
    this._net = net;
    this._hold = hold;
  }

  _apply(flags, hasShield) {
    const c = this.cp;
    this.hips.position.set(0, c[HY], c[HZ]);
    this.hips.rotation.set(c[HRX], 0, 0);
    this.spine.rotation.set(c[SRX], c[SRY], c[SRZ]);
    this.neck.rotation.set(c[NRX], c[NRY], 0);
    this.legL.th.rotation.set(c[LSW], 0, c[LSP]);
    this.legR.th.rotation.set(c[RSW], 0, c[RSP]);
    this.legL.kn.rotation.x = -c[LKN];
    this.legR.kn.rotation.x = -c[RKN];

    const down = !!(flags & PF.DOWN);
    const net = c[HRX] + c[SRX];
    // pivote de puntería: compensa la inclinación del torso para apuntar con el pitch real
    this.aim.rotation.set(this.pitch - net, 0, 0);
    const rec = this.recoil;
    this.holder.position.set(c[WPX], c[WPY] + rec * 0.015, c[WPZ] + rec * 0.05);
    this.holder.rotation.set(c[WRX] + rec * 0.12, c[WRY], c[WRZ]);

    // Escudo: delante, en la espalda o ninguno
    const shieldOut = !!(flags & PF.SHIELD_OUT) && hasShield && !down;
    if (hasShield) {
      const sh = this._ensureShield();
      const target = shieldOut ? this.shieldHolder : this.backHolder;
      if (sh.parent !== target) target.add(sh);
    } else if (this.shield && this.shield.parent) {
      this.shield.parent.remove(this.shield);
    }
    if (this.weapon) this.weapon.visible = !shieldOut;
    if (this.muzzle.visible && shieldOut) this.muzzle.visible = false;

    // Brazos por IK
    this.group.updateMatrixWorld(true);
    const hold = this._hold;
    const L = this.armL, R = this.armR;
    const SL = L.sh.position, SR = R.sh.position;
    if (shieldOut && this.shield) {
      const ud = this.shield.userData || {};
      this._handTarget(this.shield, ud.handleR, 0.14, 0.06, 0.1, _t2);
      solveArm(R, SR, _t2, POLE_R, D.upper, D.fore);
      this._handTarget(this.shield, ud.handleL, -0.12, -0.12, 0.1, _t2);
      solveArm(L, SL, _t2, POLE_L, D.upper, D.fore);
    } else if (hold && this.weapon && this.weapon.visible) {
      const ud = this.weapon.userData || {};
      // mano derecha en la empuñadura
      _t2.set(0, -0.035, 0.015);
      this.weapon.localToWorld(_t2);
      this.spine.worldToLocal(_t2);
      solveArm(R, SR, _t2, (flags & PF.ADS) ? POLE_R_ADS : POLE_R, D.upper, D.fore);
      // mano izquierda: guardamanos, cargador (recarga), boca (bebiendo) o apoyo en el suelo (caído)
      if (down) {
        this._groundHand(_t2);
      } else if (flags & PF.DRINKING) {
        _t2.set(0.0, D.neckY + 0.06, -0.14);
      } else if ((flags & PF.RELOADING) && hold === HOLD.reload) {
        const mp = ud.magPoint && ud.magPoint.isVector3 ? ud.magPoint : null;
        _t2.set(mp ? mp.x : 0, (mp ? mp.y : -0.1) - 0.05 - 0.04 * Math.abs(Math.sin(this.time * 4)), mp ? mp.z : -0.1);
        this.weapon.localToWorld(_t2);
        this.spine.worldToLocal(_t2);
      } else {
        const lh = ud.leftHand && ud.leftHand.isVector3 ? ud.leftHand : _v.set(0, 0.02, -0.25);
        _t2.copy(lh);
        const lp = ud.leftHandParent && ud.leftHandParent.isObject3D ? ud.leftHandParent : this.weapon;
        lp.localToWorld(_t2);
        this.spine.worldToLocal(_t2);
      }
      solveArm(L, SL, _t2, POLE_L, D.upper, D.fore);
    } else {
      // brazos libres, balanceándose al caminar
      const sw = Math.sin(this.cycle) * Math.min(1, this.speed / 4.6) * 0.18;
      _t2.set(0.25, -0.1, -0.02 - sw);
      solveArm(R, SR, _t2, POLE_R, D.upper, D.fore);
      if (down) this._groundHand(_t2);
      else _t2.set(-0.25, -0.1, -0.02 + sw);
      solveArm(L, SL, _t2, POLE_L, D.upper, D.fore);
    }
  }

  // Objetivo de la mano sobre un objeto (asa del escudo), en el espacio del torso
  _handTarget(obj, p, dx, dy, dz, out) {
    if (p && p.isVector3) out.copy(p); else out.set(dx, dy, dz);
    obj.localToWorld(out);
    return this.spine.worldToLocal(out);
  }

  // Mano izquierda apoyada en el suelo a un lado (caído)
  _groundHand(out) {
    out.set(-0.3, 0, 0.3).applyMatrix4(this.hips.matrixWorld);
    out.y = 0.03;
    return this.spine.worldToLocal(out);
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this.tag) {
      if (this.tag.material.map) this.tag.material.map.dispose();
      this.tag.material.dispose();
    }
    this.muzzle.material.dispose();
    this.weapons.clear();
  }
}

export function createPlayerModel(opts) { return new PlayerModel(opts); }

export default PlayerModel;
