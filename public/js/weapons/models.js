// Modelos procedurales de armas, escudo antidisturbios, osito de la caja, cuchillos, granada y botellas de ventaja.
// Todo se construye con geometría de Three.js y texturas dibujadas en canvas (sin assets externos).
// Convención de armas: metros, cañón hacia -Z, origen en la empuñadura (donde se cierra la mano derecha).
// Geometrías y materiales se cachean: crear muchas copias de un arma es barato.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WEAPONS } from '/shared/weapons.js';

const PI = Math.PI;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ Utilidades
// Aleatorio con semilla para que las texturas sean siempre iguales
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  } catch (e) { /* sin canvas: materiales sin textura */ }
  return null;
}

function canvasTexture(w, h, draw, { repeat = true, srgb = true } = {}) {
  const c = makeCanvas(w, h);
  if (!c) return null;
  const g = c.getContext && c.getContext('2d');
  if (!g) return null;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// Dibuja una forma repetida en los 9 mosaicos vecinos para que la textura sea continua
function wrapDraw(S, fn) {
  for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy);
}

function shade(color, f) {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function isWoody(color) {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  return r - b > 30 && r >= g;
}

// ------------------------------------------------------------------ Caché de geometrías
const geoCache = new Map();
function G(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const k3 = (v) => Math.round(v * 10000);
// Caja
// Caja con cantos redondeados: radio ~30 % del lado menor (máx. 1,2 cm), así las piezas no parecen bloques
function B(w, h, d) {
  return G(`b${k3(w)},${k3(h)},${k3(d)}`, () => {
    const m = Math.min(w, h, d);
    const r = Math.min(0.012, m * 0.3);
    return new RoundedBoxGeometry(w, h, d, m > 0.02 ? 2 : 1, r);
  });
}
// Mínimo de lados para que los cilindros se vean redondos (6 o menos = forma hexagonal intencionada)
const smoothSeg = (seg) => (seg <= 6 ? seg : Math.max(seg, 18));
// Cilindro a lo largo de Z (rf = radio del extremo delantero -Z, rb = radio trasero)
function CZ(rf, rb, len, seg = 20) {
  seg = smoothSeg(seg);
  return G(`cz${k3(rf)},${k3(rb)},${k3(len)},${seg}`, () => {
    const g = new THREE.CylinderGeometry(rf, rb, len, seg);
    g.rotateX(-PI / 2);
    return g;
  });
}
// Cilindro vertical (Y)
function CY(rt, rb, len, seg = 20) {
  seg = smoothSeg(seg);
  return G(`cy${k3(rt)},${k3(rb)},${k3(len)},${seg}`, () => new THREE.CylinderGeometry(rt, rb, len, seg));
}
// Cilindro a lo largo de X
function CX(r, len, seg = 24) {
  seg = smoothSeg(seg);
  return G(`cx${k3(r)},${k3(len)},${seg}`, () => {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.rotateZ(PI / 2);
    return g;
  });
}
function SPH(r, ws = 18, hs = 12) { ws = Math.max(ws, 16); hs = Math.max(hs, 10); return G(`s${k3(r)},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)); }
// Toro alrededor del eje Z (anillos sobre un cañón)
function TOR(R, r, rs = 8, ts = 20, arc = PI * 2) {
  return G(`t${k3(R)},${k3(r)},${rs},${ts},${k3(arc)}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
}
// Cono a lo largo de Z con la punta hacia -Z
function CONEZ(r, len, seg = 14) {
  return G(`cn${k3(r)},${k3(len)},${seg}`, () => {
    const g = new THREE.ConeGeometry(r, len, seg);
    g.rotateX(-PI / 2);
    return g;
  });
}

function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

function group(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (parent) parent.add(g);
  return g;
}

// ------------------------------------------------------------------ Texturas
let _woodTex, _fabricTex, _rustTex, _furTex, _glowTex, _flashTex, _camoTex, _gripTex;

function woodTexture() {
  if (_woodTex !== undefined) return _woodTex;
  _woodTex = canvasTexture(128, 128, (g, w, h) => {
    const r = rng(77);
    g.fillStyle = '#e6e2dc';
    g.fillRect(0, 0, w, h);
    // vetas horizontales onduladas
    for (let i = 0; i < 46; i++) {
      const y0 = r() * h;
      g.strokeStyle = `rgba(60,35,15,${0.12 + r() * 0.3})`;
      g.lineWidth = 0.6 + r() * 2.2;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = y0 + Math.sin((x / w) * PI * 2 * (1 + (i % 3)) + i) * (1.5 + r() * 2);
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    // nudos
    for (let i = 0; i < 3; i++) {
      const x = r() * w, y = r() * h;
      wrapDraw(w, (ox, oy) => {
        g.fillStyle = 'rgba(50,28,10,0.35)';
        g.beginPath(); g.ellipse(x + ox, y + oy, 6 + r() * 4, 2.5, 0, 0, PI * 2); g.fill();
      });
    }
  });
  return _woodTex;
}

function gripTexture() {
  if (_gripTex !== undefined) return _gripTex;
  _gripTex = canvasTexture(64, 64, (g, w, h) => {
    const r = rng(12);
    g.fillStyle = '#d8d8d8';
    g.fillRect(0, 0, w, h);
    // punteado antideslizante
    for (let i = 0; i < 500; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.25)';
      g.fillRect(r() * w, r() * h, 1.2, 1.2);
    }
  });
  return _gripTex;
}

function camoTexture() {
  if (_camoTex !== undefined) return _camoTex;
  _camoTex = canvasTexture(256, 256, (g, S) => {
    const r = rng(1337);
    g.fillStyle = '#12062a';
    g.fillRect(0, 0, S, S);
    const cols = ['#5b1fd6', '#2438c9', '#19b4ff', '#9a2cff', '#3a0f8f', '#27e6ff', '#d23cff'];
    for (let i = 0; i < 70; i++) {
      const x = r() * S, y = r() * S;
      const rad = S * (0.03 + r() * 0.11);
      const rad2 = rad * (0.45 + r() * 0.55);
      const rot = r() * PI;
      const col = cols[i % cols.length];
      const a = 0.45 + r() * 0.5;
      wrapDraw(S, (ox, oy) => {
        g.globalAlpha = a;
        g.fillStyle = col;
        g.beginPath(); g.ellipse(x + ox, y + oy, rad, rad2, rot, 0, PI * 2); g.fill();
      });
    }
    // venas eléctricas brillantes
    g.globalAlpha = 0.9;
    g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      let x = r() * S, y = r() * S;
      const pts = [[x, y]];
      for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; pts.push([x, y]); }
      const w = 0.8 + r() * 1.6;
      wrapDraw(S, (ox, oy) => {
        g.strokeStyle = i % 2 ? '#9ff8ff' : '#e6a8ff';
        g.lineWidth = w;
        g.beginPath();
        pts.forEach(([px, py], j) => (j ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy)));
        g.stroke();
      });
    }
    g.globalAlpha = 1;
  });
  return _camoTex;
}

function fabricTexture() {
  if (_fabricTex !== undefined) return _fabricTex;
  _fabricTex = canvasTexture(128, 128, (g, S) => {
    const r = rng(404);
    g.fillStyle = '#4b5339';
    g.fillRect(0, 0, S, S);
    const cols = ['#2f3524', '#6b6a4a', '#3c2f22', '#59603f'];
    for (let i = 0; i < 34; i++) {
      const x = r() * S, y = r() * S, rad = 6 + r() * 16, rad2 = rad * (0.4 + r() * 0.5), rot = r() * PI;
      const col = cols[i % cols.length];
      wrapDraw(S, (ox, oy) => {
        g.fillStyle = col;
        g.beginPath(); g.ellipse(x + ox, y + oy, rad, rad2, rot, 0, PI * 2); g.fill();
      });
    }
    // trama de la tela
    for (let y = 0; y < S; y += 2) {
      g.fillStyle = `rgba(0,0,0,${y % 4 ? 0.06 : 0.12})`;
      g.fillRect(0, y, S, 1);
    }
  });
  return _fabricTex;
}

function rustTexture() {
  if (_rustTex !== undefined) return _rustTex;
  _rustTex = canvasTexture(256, 256, (g, S) => {
    const r = rng(9001);
    g.fillStyle = '#5a7087';
    g.fillRect(0, 0, S, S);
    // pintura desigual
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${70 + r() * 30 | 0},${90 + r() * 30 | 0},${110 + r() * 30 | 0},0.35)`;
      g.beginPath(); g.ellipse(r() * S, r() * S, 10 + r() * 40, 8 + r() * 30, r() * PI, 0, PI * 2); g.fill();
    }
    // óxido
    for (let i = 0; i < 90; i++) {
      const x = r() * S, y = S * (0.3 + r() * 0.7);
      const rad = 3 + r() * (y / S) * 26;
      g.fillStyle = r() < 0.5 ? 'rgba(122,62,28,0.75)' : 'rgba(160,88,40,0.6)';
      g.beginPath(); g.ellipse(x, y, rad, rad * (0.5 + r() * 0.5), r() * PI, 0, PI * 2); g.fill();
    }
    // arañazos
    g.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      const x = r() * S, y = r() * S, a = r() * PI, l = 8 + r() * 30;
      g.strokeStyle = 'rgba(210,215,220,0.35)';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    // suciedad en la parte baja
    const grd = g.createLinearGradient(0, S * 0.55, 0, S);
    grd.addColorStop(0, 'rgba(40,25,10,0)');
    grd.addColorStop(1, 'rgba(40,25,10,0.55)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  }, { repeat: false });
  return _rustTex;
}

function furTexture() {
  if (_furTex !== undefined) return _furTex;
  _furTex = canvasTexture(64, 64, (g, S) => {
    const r = rng(55);
    g.fillStyle = '#d0d0d0';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 700; i++) {
      const v = 120 + r() * 135 | 0;
      g.strokeStyle = `rgba(${v},${v},${v},0.55)`;
      const x = r() * S, y = r() * S, a = r() * PI;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 2.5, y + Math.sin(a) * 2.5); g.stroke();
    }
  });
  return _furTex;
}

// Textura de brillo radial (halos, estelas de proyectiles)
export function getGlowTexture() {
  if (_glowTex !== undefined) return _glowTex;
  _glowTex = canvasTexture(64, 64, (g, S) => {
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.15)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  }, { repeat: false });
  return _glowTex;
}

// Textura de fogonazo (estrella con núcleo caliente)
export function getFlashTexture() {
  if (_flashTex !== undefined) return _flashTex;
  _flashTex = canvasTexture(128, 128, (g, S) => {
    const c = S / 2;
    const r = rng(3);
    g.globalCompositeOperation = 'lighter';
    // puntas
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * PI * 2 + r() * 0.3;
      const len = c * (0.55 + r() * 0.45);
      const wd = 0.1 + r() * 0.08;
      const grd = g.createLinearGradient(c, c, c + Math.cos(a) * len, c + Math.sin(a) * len);
      grd.addColorStop(0, 'rgba(255,230,160,0.95)');
      grd.addColorStop(1, 'rgba(255,120,20,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(c + Math.cos(a - wd) * 6, c + Math.sin(a - wd) * 6);
      g.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
      g.lineTo(c + Math.cos(a + wd) * 6, c + Math.sin(a + wd) * 6);
      g.closePath();
      g.fill();
    }
    // núcleo
    const grd = g.createRadialGradient(c, c, 0, c, c, c * 0.5);
    grd.addColorStop(0, 'rgba(255,255,240,1)');
    grd.addColorStop(0.35, 'rgba(255,210,120,0.85)');
    grd.addColorStop(1, 'rgba(255,110,20,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(c, c, c * 0.5, 0, PI * 2); g.fill();
  }, { repeat: false });
  return _flashTex;
}

// ------------------------------------------------------------------ Materiales (cacheados)
const matCache = new Map();
function MAT(key, make) {
  let m = matCache.get(key);
  if (!m) { m = make(); m.name = key; matCache.set(key, m); }
  return m;
}
function paintMat(color) {
  return MAT(`paint${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35 }));
}
function metalMat(color = 0x2a2c30) {
  return MAT(`metal${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.75 }));
}
function darkMat() {
  return MAT('dark', () => new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.6, metalness: 0.4 }));
}
function chromeMat() {
  return MAT('chrome', () => new THREE.MeshStandardMaterial({ color: 0xc4cad2, roughness: 0.18, metalness: 0.95 }));
}
function brassMat() {
  return MAT('brass', () => new THREE.MeshStandardMaterial({ color: 0xc9a042, roughness: 0.3, metalness: 0.9 }));
}
function woodMat(color) {
  return MAT(`wood${color}`, () => new THREE.MeshStandardMaterial({ color, map: woodTexture(), roughness: 0.72, metalness: 0.04 }));
}
function polyMat(color = 0x1b1c1f) {
  return MAT(`poly${color}`, () => new THREE.MeshStandardMaterial({ color, map: gripTexture(), roughness: 0.85, metalness: 0.05 }));
}
function glowMat(color) {
  return MAT(`glow${color}`, () => new THREE.MeshBasicMaterial({ color, toneMapped: false }));
}
function lensMat() {
  return MAT('lens', () => new THREE.MeshStandardMaterial({
    color: 0x0a1830, roughness: 0.05, metalness: 0.9, emissive: 0x08204a, emissiveIntensity: 0.6,
  }));
}
function tintGlassMat() {
  return MAT('tintglass', () => new THREE.MeshStandardMaterial({
    color: 0x88aacc, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.25, depthWrite: false,
  }));
}
function rubberMat() {
  return MAT('rubber', () => new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.95, metalness: 0 }));
}

// ------------------------------------------------------------------ Camuflaje Pack-a-Punch (material compartido animado)
let _camoMat = null;
let _camoTime = 0;
export function getCamoMaterial() {
  if (_camoMat) return _camoMat;
  const tex = camoTexture();
  _camoMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55,
    metalness: 0.45, roughness: 0.32,
  });
  if (!tex) { _camoMat.color.set(0x6a2cff); _camoMat.emissive.set(0x3a18a0); }
  _camoMat.name = 'pap_camo';
  return _camoMat;
}

// Anima el camuflaje: el patrón se desplaza y el brillo late
export function updateCamo(dt) {
  _camoTime += dt || 0;
  const m = _camoMat;
  if (!m) return;
  if (m.map) {
    m.map.offset.x = (_camoTime * 0.07) % 1;
    m.map.offset.y = (_camoTime * 0.04) % 1;
  }
  m.emissiveIntensity = 0.5 + 0.22 * Math.sin(_camoTime * 3.1) + 0.08 * Math.sin(_camoTime * 11.7);
}

// Paleta de materiales de un arma a partir de su color base
function palette(color, upgraded) {
  const woody = isWoody(color);
  const camo = upgraded ? getCamoMaterial() : null;
  return {
    body: camo || (woody ? metalMat(0x2e3033) : paintMat(color)),
    furn: camo || (woody ? woodMat(color) : paintMat(shade(color, 0.85))),
    grip: woody ? woodMat(shade(color, 0.85)) : polyMat(0x1b1c1f),
    metal: metalMat(0x2a2c30),
    dark: darkMat(),
    chrome: chromeMat(),
    lens: lensMat(),
    woody,
  };
}

// ------------------------------------------------------------------ Piezas comunes
// Empuñadura inclinada (la base va hacia atrás)
// La primera empuñadura que se añade queda como agarre de la mano derecha (userData.grip / gripDir):
// un punto algo por encima del centro (la mano va alta, bajo la corredera) y el eje hacia la base.
let _gripInfo = null;
function addGrip(g, mat, x = 0, y = -0.005, z = 0.018, h = 0.1, tilt = -0.28, w = 0.03, d = 0.046) {
  if (!_gripInfo) {
    const dir = V(0, -Math.cos(tilt), -Math.sin(tilt));
    _gripInfo = { grip: V(x, y, z).addScaledVector(dir, -0.012), gripDir: dir };
  }
  return add(g, B(w, h, d), mat, x, y, z, tilt);
}
function addTriggerGuard(g, P, y, zFront, zBack) {
  const len = zBack - zFront;
  add(g, B(0.006, 0.004, len), P.body, 0, y - 0.03, zFront + len / 2);
  add(g, B(0.006, 0.03, 0.004), P.body, 0, y - 0.015, zFront);
  add(g, B(0.004, 0.018, 0.005), P.metal, 0, y - 0.016, zFront + len * 0.55, 0.3);
}
// Mira de punto rojo; devuelve la altura de la línea de mira
function addRedDot(g, P, y, z) {
  add(g, B(0.024, 0.01, 0.05), P.dark, 0, y + 0.005, z);
  add(g, B(0.004, 0.03, 0.036), P.dark, -0.015, y + 0.024, z);
  add(g, B(0.004, 0.03, 0.036), P.dark, 0.015, y + 0.024, z);
  add(g, B(0.034, 0.005, 0.036), P.dark, 0, y + 0.041, z);
  add(g, B(0.026, 0.026, 0.002), tintGlassMat(), 0, y + 0.024, z - 0.012);
  add(g, SPH(0.0013, 6, 4), glowMat(0xff2020), 0, y + 0.024, z - 0.0135);
  return y + 0.024;
}
// Culata sólida con cantonera
function addStock(g, P, y, z0, len, h = 0.07, drop = 0.06) {
  add(g, B(0.04, h, len), P.furn, 0, y, z0 + len / 2, drop);
  add(g, B(0.042, h + 0.006, 0.016), P.dark, 0, y - Math.sin(drop) * len / 2, z0 + len + 0.006, drop);
}

// ------------------------------------------------------------------ Pistolas (M1911, B23R, Five-seven)
function buildPistol(g, def, P, key) {
  const b23 = key === 'b23r', fn = key === 'fiveseven';
  const slideH = fn ? 0.034 : 0.03;
  const sy = 0.075;
  // armazón
  add(g, B(0.026, 0.024, 0.15), P.body, 0, 0.05, -0.05);
  if (b23 || fn) add(g, B(0.02, 0.01, 0.06), P.dark, 0, 0.035, -0.095);
  // corredera animable
  const slide = group(g, 0, sy, 0);
  add(slide, B(0.03, slideH, 0.2), P.body, 0, 0, -0.05);
  for (let i = 0; i < 6; i++) add(slide, B(0.031, slideH * 0.75, 0.0025), P.dark, 0, -0.001, 0.04 - i * 0.0065);
  add(slide, B(0.01, 0.006, 0.032), P.dark, 0.011, slideH / 2 - 0.002, -0.035);
  add(slide, B(0.005, 0.008, 0.008), P.dark, 0, slideH / 2 + 0.004, -0.142);
  add(slide, B(0.007, 0.008, 0.008), P.dark, -0.0065, slideH / 2 + 0.004, 0.038);
  add(slide, B(0.007, 0.008, 0.008), P.dark, 0.0065, slideH / 2 + 0.004, 0.038);
  if (b23) add(slide, B(0.034, slideH * 0.9, 0.032), P.dark, 0, -0.001, -0.166);
  // boca del cañón
  add(g, CZ(0.0065, 0.0065, 0.014), P.metal, 0, sy - 0.002, b23 ? -0.184 : -0.155);
  // empuñadura con cachas
  addGrip(g, P.grip, 0, -0.006, 0.018, 0.105, -0.26, 0.031, 0.048);
  // cargador animable
  const mag = group(g, 0, -0.006, 0.018);
  mag.rotation.x = -0.26;
  add(mag, B(0.022, 0.1, 0.034), P.metal, 0, -0.004, 0);
  add(mag, B(0.029, 0.008, 0.046), P.dark, 0, -0.058, 0.001);
  if (b23 || fn) add(mag, B(0.027, 0.018, 0.044), P.grip, 0, -0.07, 0.001);
  addTriggerGuard(g, P, 0.056, -0.06, -0.014);
  // martillo y seguro
  add(g, B(0.008, 0.014, 0.01), P.dark, 0, 0.088, 0.052, 0.4);
  add(g, B(0.004, 0.006, 0.02), P.dark, -0.016, 0.062, 0.02);
  return {
    muzzle: V(0, sy, b23 ? -0.19 : -0.163),
    sight: V(0, sy + slideH / 2 + 0.008, 0.038),
    eyeRelief: 0.27,
    leftHand: V(-0.012, -0.034, 0.014),
    mag, magDir: V(0, -0.966, 0.259),
    slide, slideTravel: 0.03,
  };
}

// ------------------------------------------------------------------ Revólveres (Python, Executioner)
function buildRevolver(g, def, P, key) {
  const exe = key === 'executioner';
  const axisY = 0.058;
  const cylR = exe ? 0.027 : 0.022, cylL = exe ? 0.058 : 0.044;
  const zc = -0.035;
  // armazón y puente superior
  add(g, B(0.026, 0.05, 0.075), P.body, 0, 0.052, -0.012);
  add(g, B(0.02, 0.01, cylL + 0.02), P.body, 0, axisY + cylR + 0.004, zc);
  add(g, B(0.02, 0.012, 0.02), P.body, 0, axisY - cylR + 0.002, zc - cylL / 2 - 0.004);
  // tambor sobre un brazo que se abre hacia la izquierda
  const crane = group(g, -0.013, axisY - 0.02, zc);
  const cyl = group(crane, 0.013, 0.02, 0);
  add(cyl, CZ(cylR, cylR, cylL, 14), P.metal);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2 + PI / 6;
    add(cyl, B(0.004, 0.005, cylL * 0.62), P.dark, Math.cos(a) * cylR * 0.97, Math.sin(a) * cylR * 0.97, 0.002, 0, 0, a);
    const b = (i / 6) * PI * 2;
    add(cyl, CZ(cylR * 0.24, cylR * 0.24, 0.003), P.dark, Math.cos(b) * cylR * 0.55, Math.sin(b) * cylR * 0.55, -cylL / 2 - 0.001);
    add(cyl, CZ(cylR * 0.22, cylR * 0.22, 0.003), brassMat(), Math.cos(b) * cylR * 0.55, Math.sin(b) * cylR * 0.55, cylL / 2 + 0.001);
  }
  const by = axisY + cylR * 0.55;
  let muzzleZ;
  if (!exe) {
    // cañón largo ventilado de la Python
    add(g, CZ(0.009, 0.009, 0.16), P.metal, 0, by, zc - cylL / 2 - 0.08);
    add(g, B(0.014, 0.018, 0.15), P.body, 0, by - 0.012, zc - cylL / 2 - 0.08);
    add(g, B(0.007, 0.007, 0.16), P.body, 0, by + 0.011, zc - cylL / 2 - 0.08);
    for (let i = 0; i < 5; i++) add(g, B(0.0075, 0.004, 0.012), P.dark, 0, by + 0.012, zc - cylL / 2 - 0.02 - i * 0.028);
    add(g, B(0.004, 0.012, 0.014), P.dark, 0, by + 0.018, zc - cylL / 2 - 0.15);
    muzzleZ = zc - cylL / 2 - 0.163;
  } else {
    // cañón grueso del Executioner
    add(g, CZ(0.015, 0.015, 0.09), P.metal, 0, by, zc - cylL / 2 - 0.045);
    add(g, CZ(0.009, 0.009, 0.004), P.dark, 0, by, zc - cylL / 2 - 0.091);
    add(g, B(0.016, 0.014, 0.08), P.body, 0, by - 0.018, zc - cylL / 2 - 0.04);
    add(g, B(0.004, 0.01, 0.01), P.dark, 0, by + 0.019, zc - cylL / 2 - 0.08);
    muzzleZ = zc - cylL / 2 - 0.094;
  }
  // empuñadura de madera, martillo, guardamonte
  addGrip(g, woodMat(0x5a3a22), 0, -0.012, 0.022, 0.1, -0.32, 0.03, 0.045);
  add(g, B(0.007, 0.018, 0.012), P.dark, 0, 0.082, 0.012, 0.5);
  addTriggerGuard(g, P, 0.05, -0.035, 0.004);
  add(g, B(0.006, 0.006, 0.006), P.dark, -0.004, axisY + cylR + 0.012, 0.004);
  add(g, B(0.006, 0.006, 0.006), P.dark, 0.004, axisY + cylR + 0.012, 0.004);
  return {
    muzzle: V(0, by, muzzleZ),
    sight: V(0, axisY + cylR + 0.012, 0.004),
    eyeRelief: 0.27,
    leftHand: V(-0.012, -0.036, 0.018),
    cylinder: crane, cylSpin: cyl,
    magPoint: V(-0.03, axisY - 0.01, zc),
  };
}

// ------------------------------------------------------------------ Subfusiles (MP5, AK74u, PDW-57, Chicom CQB)
function buildSMG(g, def, P, key) {
  const ak = key === 'ak74u', pdw = key === 'pdw', chi = key === 'chicom';
  const y = 0.062;
  if (pdw) {
    // PDW-57: cuerpo compacto con cargador superior
    add(g, B(0.05, 0.062, 0.3), P.body, 0, y, -0.06);
    add(g, B(0.052, 0.05, 0.09), P.body, 0, 0.036, -0.2);
    add(g, B(0.03, 0.03, 0.03), P.dark, 0, 0.012, -0.22);
    add(g, B(0.05, 0.08, 0.1), P.furn, 0, 0.045, 0.13);
    const mag = group(g, 0, y + 0.041, -0.06);
    add(mag, B(0.036, 0.02, 0.24), tintGlassMat());
    add(mag, B(0.03, 0.012, 0.22), P.dark, 0, -0.002, 0);
    add(mag, B(0.038, 0.022, 0.02), P.dark, 0, 0, 0.11);
    add(g, B(0.022, 0.03, 0.05), P.dark, 0, y + 0.068, 0.0);
    add(g, TOR(0.009, 0.0025, 6, 16), P.dark, 0, y + 0.086, 0.0);
    add(g, CZ(0.009, 0.009, 0.07), P.metal, 0, y, -0.245);
    addGrip(g, P.grip, 0, -0.008, 0.015, 0.095, -0.2);
    addTriggerGuard(g, P, y - 0.02, -0.05, -0.005);
    return {
      muzzle: V(0, y, -0.285), sight: V(0, y + 0.086, 0.02), eyeRelief: 0.16,
      leftHand: V(0, 0.02, -0.2), mag, magDir: V(0, 0.95, 0.3),
    };
  }
  // cajón de mecanismos
  add(g, B(0.042, 0.052, 0.27), P.body, 0, y, -0.075);
  if (ak) {
    add(g, B(0.036, 0.014, 0.2), P.body, 0, y + 0.031, -0.06);
    add(g, B(0.046, 0.042, 0.13), P.furn, 0, y - 0.004, -0.27);
    add(g, B(0.034, 0.02, 0.1), P.furn, 0, y + 0.028, -0.26);
    add(g, CZ(0.008, 0.008, 0.1), P.metal, 0, y, -0.38);
    add(g, CZ(0.016, 0.014, 0.05), P.metal, 0, y, -0.445);
    add(g, B(0.012, 0.03, 0.02), P.dark, 0, y + 0.024, -0.41);
    add(g, B(0.016, 0.012, 0.02), P.dark, 0, y + 0.038, -0.02);
  } else {
    add(g, CZ(0.011, 0.011, 0.2), P.metal, 0, y + 0.028, -0.2);
    add(g, B(0.048, 0.044, 0.13), P.furn, 0, y - 0.004, -0.27);
    for (let i = 0; i < 4; i++) add(g, B(0.05, 0.004, 0.012), P.dark, 0, y - 0.004, -0.23 - i * 0.025);
    add(g, CZ(0.008, 0.008, 0.08), P.metal, 0, y, -0.375);
    add(g, TOR(0.013, 0.003, 6, 16), P.dark, 0, y + 0.047, -0.31);
    add(g, B(0.003, 0.03, 0.006), P.dark, 0, y + 0.035, -0.31);
    add(g, B(0.02, 0.016, 0.018), P.dark, 0, y + 0.038, 0.03);
  }
  if (chi) addRedDot(g, P, y + 0.026, -0.04);
  // cargador
  const mag = group(g, 0, y - 0.028, -0.115);
  if (chi) {
    add(mag, B(0.022, 0.12, 0.036), P.dark, 0, -0.058, 0, 0.05);
  } else {
    const a = ak ? 1.35 : 1;
    add(mag, B(0.02, 0.05, 0.034), P.dark, 0, -0.025, 0, 0.12 * a);
    add(mag, B(0.02, 0.048, 0.034), P.dark, 0, -0.066, -0.008 * a, 0.3 * a);
    add(mag, B(0.022, 0.044, 0.035), P.dark, 0, -0.104, -0.024 * a, 0.46 * a);
  }
  addGrip(g, P.grip, 0, -0.008, 0.015, 0.095, -0.28);
  addTriggerGuard(g, P, y - 0.026, -0.05, -0.005);
  // culata
  if (ak) {
    add(g, B(0.006, 0.006, 0.21), P.metal, 0.016, y + 0.012, 0.165);
    add(g, B(0.006, 0.006, 0.2), P.metal, 0.016, y - 0.03, 0.16, -0.12);
    add(g, B(0.012, 0.075, 0.03), P.metal, 0.016, y - 0.012, 0.27);
  } else if (chi) {
    add(g, B(0.04, 0.06, 0.18), P.furn, 0, y - 0.004, 0.15);
    add(g, B(0.042, 0.066, 0.014), P.dark, 0, y - 0.004, 0.246);
  } else {
    add(g, B(0.006, 0.006, 0.19), P.metal, -0.016, y + 0.006, 0.155);
    add(g, B(0.006, 0.006, 0.19), P.metal, 0.016, y + 0.006, 0.155);
    add(g, B(0.045, 0.075, 0.014), P.dark, 0, y - 0.01, 0.25);
  }
  return {
    muzzle: V(0, y, ak ? -0.472 : -0.418),
    sight: chi ? V(0, y + 0.05, -0.02) : ak ? V(0, y + 0.047, -0.02) : V(0, y + 0.047, 0.03),
    eyeRelief: chi ? 0.2 : 0.15,
    leftHand: V(0, y - 0.035, -0.27),
    mag, magDir: V(0, -0.99, -0.15),
  };
}

// ------------------------------------------------------------------ Fusiles (M14, M16, Galil, AN-94, MTAR, Type 25, SMR)
function buildRifle(g, def, P, key) {
  const m14 = key === 'm14', m16 = key === 'm16', bull = key === 'mtar' || key === 'type25';
  const y = 0.066;
  let mag;
  if (m14) {
    // culata de madera de una pieza
    add(g, B(0.046, 0.05, 0.5), P.furn, 0, y - 0.02, -0.17);
    add(g, B(0.042, 0.075, 0.25), P.furn, 0, y - 0.035, 0.2, 0.08);
    add(g, B(0.044, 0.08, 0.016), P.dark, 0, y - 0.045, 0.328, 0.08);
    add(g, B(0.034, 0.08, 0.05), P.furn, 0, -0.005, 0.02, -0.45);
    add(g, B(0.034, 0.03, 0.22), P.body, 0, y + 0.017, -0.05);
    add(g, B(0.006, 0.01, 0.16), P.metal, 0.019, y + 0.008, -0.12);
    add(g, CZ(0.009, 0.009, 0.3), P.metal, 0, y + 0.012, -0.57);
    add(g, CZ(0.007, 0.007, 0.14), P.metal, 0, y - 0.01, -0.49);
    add(g, CZ(0.013, 0.011, 0.05), P.metal, 0, y + 0.012, -0.745);
    add(g, B(0.004, 0.022, 0.006), P.dark, 0, y + 0.03, -0.74);
    add(g, B(0.003, 0.02, 0.006), P.dark, -0.007, y + 0.028, -0.74);
    add(g, B(0.003, 0.02, 0.006), P.dark, 0.007, y + 0.028, -0.74);
    add(g, B(0.018, 0.022, 0.012), P.dark, 0, y + 0.04, 0.05);
    mag = group(g, 0, y - 0.03, -0.13);
    add(mag, B(0.026, 0.085, 0.055), P.metal, 0, -0.042, 0, 0.05);
    addTriggerGuard(g, P, y - 0.04, -0.05, -0.005);
    return {
      muzzle: V(0, y + 0.012, -0.77), sight: V(0, y + 0.041, 0.05), eyeRelief: 0.13,
      leftHand: V(0, y - 0.045, -0.33), mag, magDir: V(0, -1, 0.05),
    };
  }
  if (m16) {
    add(g, B(0.042, 0.055, 0.3), P.body, 0, y, -0.07);
    // asa de transporte con mira trasera
    add(g, B(0.014, 0.026, 0.17), P.body, 0, y + 0.046, -0.05);
    add(g, B(0.012, 0.02, 0.012), P.body, 0, y + 0.035, -0.13);
    add(g, B(0.02, 0.012, 0.02), P.dark, 0, y + 0.065, 0.02);
    add(g, CZ(0.024, 0.026, 0.24), P.furn, 0, y, -0.345);
    add(g, CZ(0.028, 0.028, 0.012), P.metal, 0, y, -0.225);
    add(g, CZ(0.008, 0.008, 0.22), P.metal, 0, y, -0.57);
    add(g, CZ(0.011, 0.011, 0.045), P.metal, 0, y, -0.702);
    add(g, B(0.012, 0.05, 0.012), P.dark, 0, y + 0.03, -0.47, -0.2);
    add(g, B(0.003, 0.018, 0.004), P.dark, 0, y + 0.062, -0.475);
    mag = group(g, 0, y - 0.028, -0.12);
    add(mag, B(0.025, 0.06, 0.055), P.dark, 0, -0.03, 0, 0.05);
    add(mag, B(0.025, 0.055, 0.055), P.dark, 0, -0.085, -0.006, 0.16);
    addStock(g, P, y - 0.014, 0.08, 0.26, 0.07, 0.05);
    addGrip(g, P.grip);
    addTriggerGuard(g, P, y - 0.028, -0.05, -0.005);
    return {
      muzzle: V(0, y, -0.725), sight: V(0, y + 0.071, 0.02), eyeRelief: 0.14,
      leftHand: V(0, y - 0.03, -0.34), mag, magDir: V(0, -0.99, -0.1),
    };
  }
  if (bull) {
    // bullpup: cargador detrás de la empuñadura
    add(g, B(0.05, 0.075, 0.5), P.body, 0, y - 0.005, 0.03);
    add(g, B(0.022, 0.01, 0.34), P.dark, 0, y + 0.037, -0.03);
    add(g, B(0.046, 0.05, 0.14), P.furn, 0, y, -0.29);
    add(g, CZ(0.009, 0.009, 0.17), P.metal, 0, y + 0.005, -0.44);
    add(g, CZ(0.013, 0.012, 0.045), P.metal, 0, y + 0.005, -0.54);
    add(g, B(0.044, 0.012, 0.13), P.body, 0, y - 0.05, -0.08);
    add(g, B(0.046, 0.08, 0.016), P.dark, 0, y - 0.005, 0.287);
    mag = group(g, 0, y - 0.04, 0.1);
    add(mag, B(0.025, 0.11, 0.055), P.dark, 0, -0.05, 0, 0.12);
    const sy = addRedDot(g, P, y + 0.042, -0.03);
    addGrip(g, P.grip);
    return {
      muzzle: V(0, y + 0.005, -0.565), sight: V(0, sy, -0.01), eyeRelief: 0.2,
      leftHand: V(0, y - 0.035, -0.29), mag, magDir: V(0, -0.99, 0.12),
    };
  }
  // fusil moderno genérico (Galil, AN-94, SMR)
  const smr = key === 'smr', an = key === 'an94';
  add(g, B(0.044, 0.058, 0.33), P.body, 0, y, -0.075);
  add(g, B(0.022, 0.01, 0.3), P.dark, 0, y + 0.034, -0.08);
  add(g, B(0.05, 0.05, 0.23), P.furn, 0, y - 0.002, -0.355);
  for (let i = 0; i < 4; i++) {
    add(g, B(0.052, 0.012, 0.03), P.dark, 0, y - 0.002, -0.28 - i * 0.05);
  }
  const bl = smr ? 0.26 : 0.18;
  add(g, CZ(0.009, 0.009, bl), P.metal, 0, y, -0.47 - bl / 2);
  add(g, CZ(0.014, 0.014, 0.05), P.dark, 0, y, -0.47 - bl - 0.025);
  add(g, B(0.005, 0.03, 0.008), P.dark, 0, y + 0.04, -0.45);
  mag = group(g, 0, y - 0.03, -0.14);
  if (smr) {
    add(mag, B(0.024, 0.08, 0.05), P.dark, 0, -0.04, 0, 0.08);
  } else if (an) {
    add(mag, B(0.025, 0.06, 0.05), P.dark, 0, -0.03, 0, 0.3);
    add(mag, B(0.025, 0.06, 0.05), P.dark, 0, -0.082, -0.03, 0.45);
  } else {
    add(mag, B(0.025, 0.06, 0.052), P.dark, 0, -0.03, 0, 0.12);
    add(mag, B(0.025, 0.06, 0.052), P.dark, 0, -0.085, -0.012, 0.28);
  }
  if (key === 'galil') {
    add(g, B(0.006, 0.006, 0.22), P.metal, 0.016, y + 0.01, 0.2);
    add(g, B(0.006, 0.006, 0.2), P.metal, 0.016, y - 0.03, 0.19, -0.1);
    add(g, B(0.012, 0.075, 0.03), P.furn, 0.016, y - 0.012, 0.3);
  } else {
    addStock(g, P, y - 0.012, 0.09, 0.24, 0.07, 0.05);
  }
  const sy = addRedDot(g, P, y + 0.039, -0.03);
  addGrip(g, P.grip);
  addTriggerGuard(g, P, y - 0.03, -0.05, -0.005);
  return {
    muzzle: V(0, y, -0.47 - bl - 0.052), sight: V(0, sy, -0.01), eyeRelief: 0.2,
    leftHand: V(0, y - 0.04, -0.35), mag, magDir: V(0, -0.98, an ? -0.3 : -0.12),
  };
}

// ------------------------------------------------------------------ Ametralladoras ligeras (RPD, HAMR)
function buildLMG(g, def, P, key) {
  const rpd = key !== 'hamr';
  const y = 0.07;
  add(g, B(0.056, 0.07, 0.38), P.body, 0, y, -0.09);
  // tapa de alimentación (se abre al recargar)
  const cover = group(g, 0, y + 0.035, 0.08);
  add(cover, B(0.052, 0.014, 0.22), P.body, 0, 0.007, -0.11);
  add(cover, B(0.02, 0.018, 0.016), P.dark, 0, 0.022, -0.01);
  add(g, CZ(0.012, 0.012, 0.52), P.metal, 0, y + 0.005, -0.63);
  add(g, CZ(0.017, 0.015, 0.05), P.dark, 0, y + 0.005, -0.9);
  if (rpd) {
    add(g, B(0.05, 0.05, 0.16), P.furn, 0, y - 0.012, -0.36);
  } else {
    add(g, B(0.062, 0.062, 0.26), P.body, 0, y, -0.4);
    for (let i = 0; i < 5; i++) add(g, CX(0.008, 0.064, 8), P.dark, 0, y + 0.01, -0.3 - i * 0.045);
  }
  add(g, CZ(0.007, 0.007, 0.3), P.metal, 0, y - 0.022, -0.55);
  add(g, CZ(0.005, 0.005, 0.28), P.metal, -0.013, y - 0.032, -0.66);
  add(g, CZ(0.005, 0.005, 0.28), P.metal, 0.013, y - 0.032, -0.66);
  add(g, B(0.012, 0.02, 0.1), P.dark, 0.036, y + 0.03, -0.3);
  add(g, B(0.005, 0.035, 0.01), P.dark, 0, y + 0.04, -0.86);
  add(g, B(0.02, 0.018, 0.014), P.dark, 0, y + 0.046, 0.02);
  const mag = group(g, 0, y - 0.035, -0.12);
  if (rpd) {
    add(mag, CX(0.065, 0.05, 22), P.metal, 0, -0.05, 0);
    add(mag, CX(0.067, 0.012, 22), P.dark, 0, -0.05, 0);
    add(mag, CX(0.012, 0.054, 8), P.dark, 0, -0.05, 0);
  } else {
    add(mag, B(0.07, 0.1, 0.11), P.dark, 0, -0.05, 0);
    add(mag, B(0.072, 0.012, 0.112), P.metal, 0, -0.095, 0);
  }
  addGrip(g, P.grip, 0, -0.006, 0.018, 0.1);
  addTriggerGuard(g, P, y - 0.035, -0.05, -0.005);
  if (rpd) {
    add(g, B(0.042, 0.075, 0.28), P.furn, 0, y - 0.03, 0.23, 0.1);
    add(g, B(0.044, 0.08, 0.016), P.dark, 0, y - 0.045, 0.37, 0.1);
  } else {
    add(g, B(0.008, 0.008, 0.24), P.metal, 0, y + 0.012, 0.2);
    add(g, B(0.008, 0.008, 0.22), P.metal, 0, y - 0.03, 0.19, -0.12);
    add(g, B(0.04, 0.08, 0.02), P.body, 0, y - 0.01, 0.32);
  }
  return {
    muzzle: V(0, y + 0.005, -0.93), sight: V(0, y + 0.055, 0.02), eyeRelief: 0.14,
    leftHand: V(0, y - 0.045, -0.37), mag, magDir: V(0, -1, 0), cover,
  };
}

// ------------------------------------------------------------------ Escopetas (Remington 870, KSG, M1216)
function buildShotgun(g, def, P, key) {
  const ksg = key === 'ksg', m12 = key === 'm1216';
  const y = 0.062;
  if (ksg) {
    add(g, B(0.05, 0.075, 0.46), P.body, 0, y - 0.01, 0.05);
    add(g, B(0.052, 0.08, 0.016), P.dark, 0, y - 0.01, 0.288);
    add(g, CZ(0.012, 0.012, 0.4), P.metal, 0, y + 0.02, -0.38);
    add(g, CZ(0.01, 0.01, 0.26), P.metal, -0.012, y - 0.012, -0.3);
    add(g, CZ(0.01, 0.01, 0.26), P.metal, 0.012, y - 0.012, -0.3);
    const pump = group(g, 0, y - 0.012, -0.3);
    add(pump, B(0.05, 0.04, 0.12), P.furn);
    add(pump, B(0.03, 0.05, 0.03), P.furn, 0, -0.03, -0.035);
    add(g, B(0.022, 0.01, 0.26), P.dark, 0, y + 0.032, -0.05);
    const sy = addRedDot(g, P, y + 0.037, -0.04);
    addGrip(g, P.grip);
    addTriggerGuard(g, P, y - 0.02, -0.06, -0.01);
    return {
      muzzle: V(0, y + 0.02, -0.585), sight: V(0, sy, -0.02), eyeRelief: 0.2,
      leftHand: V(0, -0.032, 0), leftHandParent: pump, pump, pumpTravel: 0.07,
      magPoint: V(0, y - 0.05, 0.08),
    };
  }
  if (m12) {
    add(g, B(0.05, 0.065, 0.3), P.body, 0, y, -0.1);
    add(g, CZ(0.012, 0.012, 0.35), P.metal, 0, y + 0.012, -0.42);
    // tambor giratorio de 4 tubos
    const drum = group(g, 0, y + 0.012, -0.34);
    add(drum, CZ(0.036, 0.036, 0.22, 10), P.body);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI * 2 + PI / 4;
      add(drum, CZ(0.011, 0.011, 0.224, 8), P.dark, Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0);
    }
    addStock(g, P, y - 0.01, 0.05, 0.24, 0.07, 0.04);
    const sy = addRedDot(g, P, y + 0.032, -0.08);
    addGrip(g, P.grip);
    addTriggerGuard(g, P, y - 0.032, -0.05, -0.005);
    return {
      muzzle: V(0, y + 0.012, -0.6), sight: V(0, sy, -0.06), eyeRelief: 0.2,
      leftHand: V(0, y - 0.03, -0.34), drum, magPoint: V(0, y - 0.03, -0.34),
    };
  }
  // Remington 870
  add(g, B(0.044, 0.056, 0.2), P.body, 0, y, -0.06);
  add(g, B(0.012, 0.014, 0.05), P.dark, 0.022, y + 0.004, -0.06);
  add(g, CZ(0.012, 0.012, 0.58), P.metal, 0, y + 0.012, -0.45);
  add(g, B(0.006, 0.004, 0.56), P.metal, 0, y + 0.026, -0.46);
  add(g, SPH(0.003, 6, 4), chromeMat(), 0, y + 0.03, -0.73);
  add(g, CZ(0.011, 0.011, 0.42), P.metal, 0, y - 0.014, -0.38);
  add(g, CZ(0.012, 0.012, 0.02), P.dark, 0, y - 0.014, -0.6);
  const pump = group(g, 0, y - 0.016, -0.3);
  add(pump, B(0.05, 0.042, 0.15), P.furn);
  for (let i = 0; i < 6; i++) add(pump, B(0.052, 0.005, 0.006), P.dark, 0, -0.008, -0.06 + i * 0.024);
  add(g, B(0.042, 0.072, 0.27), P.furn, 0, y - 0.022, 0.19, 0.06);
  add(g, B(0.044, 0.078, 0.02), rubberMat(), 0, y - 0.03, 0.33, 0.06);
  add(g, B(0.032, 0.09, 0.046), P.furn, 0, -0.005, 0.02, -0.3);
  addTriggerGuard(g, P, y - 0.028, -0.05, -0.005);
  return {
    muzzle: V(0, y + 0.012, -0.745), sight: V(0, y + 0.032, 0.02), eyeRelief: 0.15,
    leftHand: V(0, -0.028, 0), leftHandParent: pump, pump, pumpTravel: 0.075,
    magPoint: V(0, y - 0.035, -0.1),
  };
}

// ------------------------------------------------------------------ Escopeta de dos cañones (Olympia)
function buildDoubleBarrel(g, def, P) {
  const y = 0.06;
  add(g, B(0.044, 0.05, 0.08), P.body, 0, y, -0.03);
  add(g, B(0.046, 0.02, 0.05), chromeMat(), 0, y - 0.012, -0.03);
  // cañones abatibles
  const barrels = group(g, 0, y - 0.012, -0.07);
  for (const s of [-1, 1]) {
    add(barrels, CZ(0.0125, 0.0125, 0.62), P.metal, s * 0.0128, 0.02, -0.31);
    add(barrels, CZ(0.009, 0.009, 0.003), P.dark, s * 0.0128, 0.02, -0.621);
  }
  add(barrels, B(0.006, 0.008, 0.6), P.metal, 0, 0.034, -0.31);
  add(barrels, SPH(0.003, 6, 4), chromeMat(), 0, 0.04, -0.6);
  add(barrels, B(0.04, 0.026, 0.2), P.furn, 0, -0.004, -0.15);
  const shells = group(barrels, 0, 0.02, 0.002);
  for (const s of [-1, 1]) add(shells, CZ(0.0115, 0.0115, 0.004), brassMat(), s * 0.0128, 0, 0);
  // culata
  add(g, B(0.034, 0.05, 0.1), P.furn, 0, y - 0.02, 0.05, 0.25);
  add(g, B(0.04, 0.085, 0.24), P.furn, 0, y - 0.045, 0.2, 0.1);
  add(g, B(0.042, 0.09, 0.016), rubberMat(), 0, y - 0.058, 0.325, 0.1);
  add(g, B(0.034, 0.08, 0.05), P.furn, 0, 0, 0.02, -0.45);
  addTriggerGuard(g, P, y - 0.02, -0.05, 0.0);
  add(g, B(0.004, 0.016, 0.005), P.metal, 0, y - 0.035, -0.035, 0.3);
  return {
    muzzle: V(0, y - 0.012 + 0.02, -0.695), sight: V(0, y - 0.012 + 0.04, 0.0), eyeRelief: 0.15,
    leftHand: V(0, -0.024, -0.16), leftHandParent: barrels, barrels, shells,
    magPoint: V(0, y + 0.02, -0.05),
  };
}

// ------------------------------------------------------------------ Francotiradores (DSR 50, Barrett M82A1)
function addScope(g, P, sy, zc) {
  add(g, B(0.02, sy - 0.1 + 0.012, 0.018), P.dark, 0, (sy + 0.1) / 2 - 0.006, zc - 0.07);
  add(g, B(0.02, sy - 0.1 + 0.012, 0.018), P.dark, 0, (sy + 0.1) / 2 - 0.006, zc + 0.07);
  add(g, CZ(0.017, 0.017, 0.26), P.dark, 0, sy, zc);
  add(g, CZ(0.03, 0.018, 0.07), P.dark, 0, sy, zc - 0.165);
  add(g, CZ(0.026, 0.026, 0.002), P.lens, 0, sy, zc - 0.2);
  add(g, CZ(0.019, 0.024, 0.06), P.dark, 0, sy, zc + 0.155);
  add(g, CZ(0.02, 0.02, 0.002), P.lens, 0, sy, zc + 0.186);
  add(g, CY(0.01, 0.01, 0.02), P.dark, 0, sy + 0.024, zc);
  add(g, CX(0.01, 0.02), P.dark, 0.024, sy, zc);
}

function buildSniper(g, def, P, key) {
  const dsr = key !== 'barrett';
  const y = 0.062;
  const sy = y + 0.078;
  let bolt = null, mag, muzzleZ, zc;
  if (dsr) {
    add(g, B(0.052, 0.07, 0.52), P.body, 0, y - 0.01, 0.03);
    add(g, B(0.04, 0.02, 0.14), P.furn, 0, y + 0.035, 0.18);
    add(g, B(0.054, 0.08, 0.018), rubberMat(), 0, y - 0.01, 0.298);
    add(g, B(0.05, 0.05, 0.2), P.furn, 0, y - 0.005, -0.33);
    add(g, CZ(0.011, 0.011, 0.56), P.metal, 0, y + 0.005, -0.51);
    add(g, B(0.03, 0.03, 0.06), P.dark, 0, y + 0.005, -0.8);
    add(g, B(0.032, 0.008, 0.01), P.metal, 0, y + 0.005, -0.79);
    add(g, B(0.032, 0.008, 0.01), P.metal, 0, y + 0.005, -0.81);
    add(g, CZ(0.005, 0.005, 0.2), P.metal, -0.014, y - 0.035, -0.33);
    add(g, CZ(0.005, 0.005, 0.2), P.metal, 0.014, y - 0.035, -0.33);
    mag = group(g, 0, y - 0.045, 0.1);
    add(mag, B(0.03, 0.085, 0.07), P.dark, 0, -0.04, 0);
    // cerrojo
    bolt = group(g, 0.026, y + 0.02, 0.14);
    add(bolt, CZ(0.009, 0.009, 0.06), P.metal, -0.02, 0, 0);
    add(bolt, B(0.03, 0.007, 0.007), P.metal, 0.012, 0, 0);
    add(bolt, SPH(0.009, 8, 6), P.dark, 0.03, 0, 0);
    muzzleZ = -0.835; zc = -0.05;
  } else {
    add(g, B(0.06, 0.085, 0.52), P.body, 0, y, -0.08);
    add(g, B(0.045, 0.08, 0.2), P.furn, 0, y - 0.01, 0.27);
    add(g, B(0.047, 0.086, 0.018), rubberMat(), 0, y - 0.01, 0.378);
    add(g, CZ(0.014, 0.014, 0.6), P.metal, 0, y + 0.012, -0.64);
    add(g, B(0.06, 0.035, 0.09), P.dark, 0, y + 0.012, -0.97);
    for (let i = 0; i < 3; i++) add(g, B(0.062, 0.02, 0.012), P.metal, 0, y + 0.012, -0.945 - i * 0.025);
    add(g, CZ(0.005, 0.005, 0.32), P.metal, -0.016, y - 0.02, -0.55);
    add(g, CZ(0.005, 0.005, 0.32), P.metal, 0.016, y - 0.02, -0.55);
    add(g, B(0.014, 0.012, 0.03), P.dark, 0.032, y + 0.02, 0.0);
    mag = group(g, 0, y - 0.042, -0.12);
    add(mag, B(0.036, 0.1, 0.075), P.dark, 0, -0.05, 0);
    muzzleZ = -1.02; zc = -0.12;
  }
  addScope(g, P, sy, zc);
  addGrip(g, P.grip);
  addTriggerGuard(g, P, y - 0.035, -0.05, -0.005);
  return {
    muzzle: V(0, dsr ? y + 0.005 : y + 0.012, muzzleZ), sight: V(0, sy, zc + 0.19), eyeRelief: 0.1,
    leftHand: V(0, y - 0.042, -0.33), mag, magDir: V(0, -1, 0), bolt, scope: true,
  };
}

// ------------------------------------------------------------------ Ray Gun
function buildRaygun(g, def, P, upgraded) {
  const glow = glowMat(upgraded ? 0xff2d2d : 0x3dff5a);
  const accent = upgraded ? P.body : paintMat(0x8a1f1a);
  const body = upgraded ? P.body : metalMat(0x8b8f95);
  const y = 0.07;
  add(g, CZ(0.032, 0.032, 0.14, 16), body, 0, y, -0.04);
  add(g, CZ(0.02, 0.034, 0.03, 16), accent, 0, y, 0.045);
  add(g, SPH(0.02, 12, 8), body, 0, y, 0.062);
  add(g, CZ(0.02, 0.03, 0.05, 16), body, 0, y, -0.135);
  add(g, CZ(0.055, 0.03, 0.03, 20), accent, 0, y, -0.172);
  add(g, CZ(0.045, 0.045, 0.004, 20), glow, 0, y, -0.188);
  add(g, CZ(0.011, 0.011, 0.03, 10), body, 0, y, -0.2);
  add(g, CZ(0.006, 0.006, 0.002, 8), glowMat(0xffffff), 0, y, -0.216);
  for (let i = 0; i < 3; i++) add(g, TOR(0.036, 0.006, 8, 24), glow, 0, y, -0.02 - i * 0.03);
  // aletas traseras
  for (let i = 0; i < 3; i++) {
    const a = PI / 2 + (i - 1) * (PI / 2);
    add(g, B(0.004, 0.028, 0.05), accent, Math.cos(a) * 0.04, y + Math.sin(a) * 0.04, 0.02, 0, 0, a - PI / 2);
  }
  // tubo de energía superior
  add(g, CZ(0.009, 0.009, 0.1, 10), glow, 0, y + 0.042, -0.05);
  add(g, CZ(0.012, 0.012, 0.012, 10), body, 0, y + 0.042, 0.005);
  add(g, CZ(0.012, 0.012, 0.012, 10), body, 0, y + 0.042, -0.105);
  add(g, B(0.008, 0.012, 0.02), body, 0, y + 0.03, -0.05);
  // empuñadura, gatillo, batería
  addGrip(g, paintMat(0x5b1f15), 0, -0.004, 0.018, 0.1, -0.3, 0.03, 0.045);
  addTriggerGuard(g, P, y - 0.022, -0.05, -0.008);
  const mag = group(g, 0, y - 0.03, -0.1);
  add(mag, CY(0.012, 0.012, 0.04, 10), accent, 0, -0.012, 0);
  add(mag, CY(0.009, 0.009, 0.006, 10), glow, 0, -0.034, 0);
  return {
    muzzle: V(0, y, -0.22), sight: V(0, y + 0.055, 0.005), eyeRelief: 0.27,
    leftHand: V(-0.012, -0.034, 0.014), mag, magDir: V(0, -1, 0),
  };
}

// ------------------------------------------------------------------ Ray Gun Mark II
function buildRaygun2(g, def, P, upgraded) {
  const glow = glowMat(upgraded ? 0xff3a6a : 0x3dff5a);
  const body = upgraded ? P.body : metalMat(0x6d6f74);
  const accent = upgraded ? P.body : paintMat(0x9a2a1e);
  const y = 0.075;
  add(g, B(0.05, 0.06, 0.3), body, 0, y, -0.09);
  add(g, B(0.052, 0.02, 0.2), accent, 0, y - 0.02, -0.1);
  add(g, B(0.012, 0.01, 0.22), glow, 0, y + 0.034, -0.09);
  add(g, B(0.04, 0.05, 0.05), body, 0, y - 0.005, -0.265, 0.25);
  // tres cañones en triángulo
  const offs = [[0, 0.018], [-0.016, -0.01], [0.016, -0.01]];
  for (const [ox, oy] of offs) add(g, CZ(0.009, 0.009, 0.15, 10), metalMat(0x3a3c40), ox, y + oy, -0.34);
  for (let i = 0; i < 2; i++) add(g, TOR(0.034, 0.005, 8, 24), glow, 0, y + 0.002, -0.3 - i * 0.06);
  add(g, CZ(0.03, 0.03, 0.004, 16), glow, 0, y + 0.002, -0.415);
  // miras
  add(g, B(0.02, 0.014, 0.02), body, 0, y + 0.045, 0.02);
  add(g, B(0.004, 0.014, 0.01), body, 0, y + 0.045, -0.23);
  addStock(g, P, y - 0.01, 0.06, 0.16, 0.06, 0.05);
  addGrip(g, P.grip);
  addTriggerGuard(g, P, y - 0.03, -0.05, -0.005);
  const mag = group(g, 0, y - 0.03, -0.13);
  add(mag, B(0.03, 0.06, 0.05), accent, 0, -0.03, 0);
  add(mag, B(0.02, 0.008, 0.03), glow, 0, -0.062, 0);
  return {
    muzzle: V(0, y + 0.002, -0.42), sight: V(0, y + 0.052, 0.02), eyeRelief: 0.18,
    leftHand: V(0, y - 0.04, -0.25), mag, magDir: V(0, -1, 0),
  };
}

// ------------------------------------------------------------------ Lanzagranadas de tambor (War Machine)
function buildLauncher(g, def, P) {
  const y = 0.05;
  // tambor giratorio
  const drum = group(g, 0, y, -0.15);
  add(drum, CZ(0.085, 0.085, 0.14, 18), P.body);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2 + PI / 2;
    add(drum, CZ(0.022, 0.022, 0.004, 10), P.dark, Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.071);
    add(drum, B(0.012, 0.012, 0.142), P.metal, Math.cos(a + PI / 6) * 0.083, Math.sin(a + PI / 6) * 0.083, 0, 0, 0, a + PI / 6);
  }
  add(drum, CZ(0.018, 0.018, 0.16, 10), P.metal);
  const by = y + 0.05;
  add(g, CZ(0.035, 0.035, 0.28, 16), P.body, 0, by, -0.36);
  add(g, CZ(0.028, 0.028, 0.004, 14), P.dark, 0, by, -0.501);
  add(g, B(0.02, 0.012, 0.44), P.metal, 0, y + 0.092, -0.14);
  add(g, B(0.036, 0.05, 0.06), P.body, 0, y + 0.02, -0.04);
  add(g, B(0.018, 0.06, 0.008), P.dark, -0.04, by + 0.03, -0.28);
  add(g, B(0.014, 0.02, 0.014), P.dark, 0, y + 0.108, 0.0);
  // empuñadura delantera y culata esquelética
  add(g, B(0.03, 0.09, 0.035), P.grip, 0, y - 0.03, -0.36);
  add(g, CZ(0.007, 0.007, 0.26), P.metal, 0, y + 0.03, 0.14);
  add(g, CZ(0.007, 0.007, 0.24), P.metal, 0, y - 0.02, 0.14);
  add(g, B(0.04, 0.09, 0.02), rubberMat(), 0, y + 0.005, 0.27);
  addGrip(g, P.grip);
  addTriggerGuard(g, P, y - 0.01, -0.06, -0.01);
  return {
    muzzle: V(0, by, -0.51), sight: V(0, y + 0.118, 0.0), eyeRelief: 0.2,
    leftHand: V(0, y - 0.03, -0.36), leftGripDir: V(0, -1, 0), drum, magPoint: V(-0.06, y, -0.15),
  };
}

// ------------------------------------------------------------------ Cuchillos
function buildKnife(g, bowie) {
  const blade = chromeMat();
  if (bowie) {
    add(g, CZ(0.013, 0.015, 0.11, 10), woodMat(0x6b3a1f), 0, 0, 0.02);
    for (let i = 0; i < 3; i++) add(g, CZ(0.0155, 0.0155, 0.004, 10), brassMat(), 0, 0, 0.0 + i * 0.03);
    add(g, SPH(0.016, 10, 8), brassMat(), 0, 0, 0.08);
    add(g, B(0.014, 0.07, 0.012), brassMat(), 0, 0.004, -0.04);
    add(g, B(0.005, 0.042, 0.2), blade, 0, 0.002, -0.145);
    add(g, B(0.0052, 0.008, 0.18), metalMat(0x6a6e75), 0, 0.02, -0.135);
    add(g, B(0.005, 0.03, 0.05), blade, 0, -0.004, -0.262, 0.55);
    return { muzzle: V(0, 0, -0.29), sight: V(0, 0.04, 0), leftHand: V(0, 0, 0), grip: V(0, 0, 0.03), gripDir: V(0, 0, 1) };
  }
  add(g, CZ(0.012, 0.014, 0.1, 10), rubberMat(), 0, 0, 0.02);
  for (let i = 0; i < 4; i++) add(g, CZ(0.0135, 0.0135, 0.004, 10), darkMat(), 0, 0, -0.01 + i * 0.022);
  add(g, B(0.012, 0.05, 0.01), darkMat(), 0, 0.002, -0.035);
  add(g, B(0.004, 0.028, 0.15), blade, 0, 0.003, -0.115);
  add(g, B(0.0042, 0.006, 0.13), metalMat(0x55595f), 0, 0.015, -0.105);
  add(g, B(0.004, 0.02, 0.035), blade, 0, -0.002, -0.2, 0.5);
  return { muzzle: V(0, 0, -0.22), sight: V(0, 0.04, 0), leftHand: V(0, 0, 0), grip: V(0, 0, 0.025), gripDir: V(0, 0, 1) };
}

// ------------------------------------------------------------------ Armas cuerpo a cuerpo pesadas
// Origen en la empuñadura (mano derecha), la hoja/cabeza hacia -Z. userData.grip2 = punto de la mano izquierda.
function buildBat(g) {
  const wood = woodMat(0x9a7448);
  add(g, CZ(0.017, 0.015, 0.2, 10), MAT('grip_tape', () => new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.9 })), 0, 0, 0.0);
  add(g, CZ(0.022, 0.022, 0.012, 10), wood, 0, 0, 0.1);                      // pomo
  add(g, CZ(0.036, 0.018, 0.34, 12), wood, 0, 0, -0.27);                     // se ensancha
  add(g, CZ(0.038, 0.036, 0.26, 12), wood, 0, 0, -0.57);                     // cabeza
  add(g, SPH(0.038, 12, 8), wood, 0, 0, -0.7);
  // clavos
  const nail = metalMat(0x8a8e94);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.3, z = -0.48 - (i % 3) * 0.07;
    add(g, CY(0.0025, 0.0025, 0.05, 4), nail, Math.cos(a) * 0.045, Math.sin(a) * 0.045, z, 0, 0, a - PI / 2);
  }
  return { muzzle: V(0, 0, -0.72), sight: V(0, 0.05, 0), leftHand: V(0, 0, 0.07), grip2: V(0, 0, 0.065), grip: V(0, 0, -0.01), gripDir: V(0, 0, 1) };
}

function buildMachete(g) {
  add(g, CZ(0.015, 0.016, 0.13, 10), MAT('machete_grip', () => new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.85 })), 0, 0, 0.01);
  add(g, B(0.012, 0.03, 0.02), metalMat(0x3a3c40), 0, 0, -0.06);             // guarda
  const steel = MAT('machete_blade', () => new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.85 }));
  add(g, B(0.004, 0.05, 0.42), steel, 0, 0.006, -0.28);
  add(g, B(0.0042, 0.02, 0.38), metalMat(0x5a5e64), 0, 0.028, -0.27);       // lomo
  add(g, B(0.004, 0.035, 0.08), steel, 0, 0.0, -0.5, 0.35);                  // punta
  return { muzzle: V(0, 0, -0.54), sight: V(0, 0.05, 0), leftHand: V(0, 0, 0), grip: V(0, 0, 0.01), gripDir: V(0, 0, 1) };
}

function buildAxe(g) {
  const handle = woodMat(0xb08a58);
  add(g, CZ(0.018, 0.02, 0.72, 10), handle, 0, 0, -0.26);
  add(g, CZ(0.022, 0.022, 0.03, 10), rubberMat(), 0, 0, 0.08);
  const red = MAT('axe_red', () => new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.4, metalness: 0.5 }));
  add(g, B(0.04, 0.07, 0.09), red, 0, 0, -0.6);                              // ojo
  add(g, B(0.012, 0.16, 0.11), red, 0, 0.08, -0.6);                          // hoja
  add(g, B(0.008, 0.03, 0.115), chromeMat(), 0, 0.165, -0.6);                // filo
  add(g, CONEZ(0.02, 0.1, 6), red, 0, -0.08, -0.6, PI / 2, 0, 0);            // pico
  return { muzzle: V(0, 0, -0.65), sight: V(0, 0.05, 0), leftHand: V(0, 0, 0.05), grip2: V(0, 0, 0.055), grip: V(0, 0, -0.025), gripDir: V(0, 0, 1) };
}

// Modelo del arma cuerpo a cuerpo equipada: 'knife' | 'bowie' | 'bat' | 'machete' | 'axe'
export function createMeleeMesh(key) {
  if (key === 'knife' || key === 'bowie' || !key) return createKnifeMesh(key === 'bowie');
  const g = new THREE.Group();
  g.name = 'melee_' + key;
  let ud;
  if (key === 'bat') ud = buildBat(g);
  else if (key === 'machete') ud = buildMachete(g);
  else if (key === 'axe') ud = buildAxe(g);
  else return createKnifeMesh(false);
  g.userData = Object.assign(DEFAULT_UD(), ud, { key, upgraded: false, model: key });
  return g;
}

// ------------------------------------------------------------------ API: arma
const DEFAULT_UD = () => ({
  muzzle: V(0, 0.06, -0.5), sight: V(0, 0.1, 0), eyeRelief: 0.16,
  leftHand: V(0, 0.03, -0.3), leftHandParent: null,
  // agarres: grip/gripDir = mano derecha (punto y eje de la empuñadura, hacia la base);
  // leftGripDir = eje del puño izquierdo si sujeta una empuñadura vertical (lanzagranadas); si no, guardamanos
  grip: V(0, 0.005, 0.015), gripDir: V(0, -0.9, 0.436), leftGripDir: null,
  mag: null, magDir: V(0, -1, 0), magPoint: null,
  slide: null, slideTravel: 0.03, pump: null, pumpTravel: 0.07, bolt: null,
  barrels: null, shells: null, cylinder: null, cylSpin: null, drum: null, cover: null, scope: false,
});

// Crea el modelo de un arma (grupo nuevo; geometrías y materiales compartidos).
// userData: { key, upgraded, model, muzzle, sight, eyeRelief, leftHand, leftHandParent, mag, magDir, magPoint,
//             slide, pump, bolt, barrels, shells, cylinder, cylSpin, drum, cover, scope }
export function createWeaponMesh(key, upgraded = false) {
  const g = new THREE.Group();
  const def = key ? WEAPONS[key] : null;
  const model = def ? def.model : key === 'knife' ? 'knife' : key ? 'rifle' : 'none';
  const up = !!upgraded && model !== 'knife' && !!(def && def.pap);
  g.name = `weapon_${key || 'none'}${up ? '_pap' : ''}`;
  const P = palette(def ? def.color : 0x3a3b3e, up);
  let ud = {};
  _gripInfo = null;
  switch (model) {
    case 'pistol': ud = buildPistol(g, def, P, key); break;
    case 'revolver': ud = buildRevolver(g, def, P, key); break;
    case 'smg': ud = buildSMG(g, def, P, key); break;
    case 'rifle': ud = buildRifle(g, def, P, key); break;
    case 'lmg': ud = buildLMG(g, def, P, key); break;
    case 'shotgun': ud = buildShotgun(g, def, P, key); break;
    case 'doublebarrel': ud = buildDoubleBarrel(g, def, P); break;
    case 'sniper': ud = buildSniper(g, def, P, key); break;
    case 'raygun': ud = buildRaygun(g, def, P, up); break;
    case 'raygun2': ud = buildRaygun2(g, def, P, up); break;
    case 'launcher': ud = buildLauncher(g, def, P); break;
    case 'knife': ud = buildKnife(g, key === 'bowie'); break;
    case 'bat': ud = buildBat(g); break;
    case 'machete': ud = buildMachete(g); break;
    case 'axe': ud = buildAxe(g); break;
    default: break;
  }
  if (_gripInfo && !ud.grip) Object.assign(ud, _gripInfo);
  g.userData = Object.assign(DEFAULT_UD(), ud, { key: key || null, upgraded: up, model });
  return g;
}

// Cuchillo de combate o Bowie (para la animación de cuchillo)
export function createKnifeMesh(bowie = false) {
  const g = new THREE.Group();
  g.name = bowie ? 'knife_bowie' : 'knife_combat';
  const ud = buildKnife(g, !!bowie);
  g.userData = Object.assign(DEFAULT_UD(), ud, { key: bowie ? 'bowie' : 'knife', upgraded: false, model: 'knife' });
  return g;
}

// ------------------------------------------------------------------ Granada de fragmentación
export function createGrenadeMesh() {
  const g = new THREE.Group();
  g.name = 'grenade';
  const olive = MAT('grenade_olive', () => new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 0.7, metalness: 0.2 }));
  const body = add(g, SPH(0.03, 12, 10), olive, 0, 0, 0);
  body.scale.set(1, 1.2, 1);
  for (let i = 0; i < 3; i++) add(g, TOR(0.0305 * Math.cos((i - 1) * 0.5), 0.0022, 6, 18), darkMat(), 0, (i - 1) * 0.015, 0, PI / 2);
  add(g, CY(0.011, 0.013, 0.02, 10), metalMat(0x6a6d70), 0, 0.042, 0);
  add(g, B(0.008, 0.05, 0.004), metalMat(0x6a6d70), 0.014, 0.022, 0, 0, 0, -0.25);
  add(g, TOR(0.009, 0.0015, 6, 14), chromeMat(), -0.016, 0.046, 0, 0, PI / 2, 0);
  g.userData = { radius: 0.035 };
  return g;
}

// ------------------------------------------------------------------ Botella de Perk-a-Cola
export function createBottleMesh(color = '#e0282e') {
  const c = new THREE.Color(color);
  const hex = c.getHex();
  const g = new THREE.Group();
  g.name = 'perk_bottle';
  const glass = MAT(`bottle${hex}`, () => new THREE.MeshStandardMaterial({
    color: hex, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88,
    emissive: hex, emissiveIntensity: 0.35,
  }));
  const label = MAT(`label${hex}`, () => new THREE.MeshStandardMaterial({ color: 0xf2eee2, roughness: 0.6, metalness: 0 }));
  const stripe = MAT(`stripe${hex}`, () => new THREE.MeshStandardMaterial({ color: shade(hex, 0.7), roughness: 0.5, metalness: 0 }));
  add(g, CY(0.03, 0.028, 0.12, 16), glass, 0, 0, 0);
  add(g, CY(0.0305, 0.0305, 0.05, 16), label, 0, -0.005, 0);
  add(g, CY(0.031, 0.031, 0.012, 16), stripe, 0, -0.005, 0);
  add(g, CY(0.013, 0.03, 0.04, 16), glass, 0, 0.08, 0);
  add(g, CY(0.012, 0.012, 0.035, 12), glass, 0, 0.117, 0);
  add(g, CY(0.014, 0.014, 0.008, 12), metalMat(0xb0b4ba), 0, 0.137, 0);
  g.userData = { material: glass };
  return g;
}

// ------------------------------------------------------------------ Materiales de los brazos (primera persona)
export function getArmMaterials() {
  return {
    sleeve: MAT('arm_sleeve', () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: fabricTexture(), roughness: 0.95, metalness: 0 })),
    sleeveDark: MAT('arm_sleeve_dark', () => new THREE.MeshStandardMaterial({ color: 0x2c3122, roughness: 0.95, metalness: 0 })),
    // guante táctico marrón (se distingue de las armas negras) con refuerzos más oscuros
    glove: MAT('arm_glove', () => new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 0.75, metalness: 0.05 })),
    gloveDetail: MAT('arm_glove_detail', () => new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.6, metalness: 0.1 })),
  };
}

// ------------------------------------------------------------------ Escudo antidisturbios improvisado (Zombie Shield)
// ~0.62 m de ancho x 0.92 m de alto; origen en el centro; frente hacia -Z (las asas quedan en +Z).
export function createShieldMesh() {
  const g = new THREE.Group();
  g.name = 'zombie_shield';
  const tex = rustTexture();
  const paint = MAT('shield_paint', () => new THREE.MeshStandardMaterial({
    color: tex ? 0xffffff : 0x5a7087, map: tex, roughness: 0.75, metalness: 0.45,
  }));
  const inner = MAT('shield_inner', () => new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.8, metalness: 0.5 }));
  const frame = metalMat(0x2f3236);
  const wire = MAT('shield_wire', () => new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.5, metalness: 0.8 }));
  // panel inferior de la puerta
  add(g, B(0.62, 0.48, 0.045), paint, 0, -0.22, 0);
  add(g, B(0.6, 0.46, 0.01), inner, 0, -0.22, 0.026);
  // línea de moldura y manija cromada
  add(g, B(0.62, 0.012, 0.05), frame, 0, -0.08, -0.002);
  add(g, B(0.1, 0.018, 0.018), chromeMat(), 0.17, -0.03, -0.032);
  add(g, B(0.04, 0.03, 0.006), frame, 0.17, -0.03, -0.024);
  // marco de la ventana
  add(g, B(0.05, 0.44, 0.05), paint, -0.285, 0.24, 0);
  add(g, B(0.05, 0.44, 0.05), paint, 0.285, 0.24, 0);
  add(g, B(0.62, 0.05, 0.05), paint, 0, 0.435, 0);
  add(g, B(0.62, 0.035, 0.05), frame, 0, 0.03, 0);
  // rejilla metálica en la ventana
  for (let i = -3; i <= 3; i++) add(g, B(0.006, 0.4, 0.006), wire, i * 0.075, 0.235, 0);
  for (let j = 0; j < 6; j++) add(g, B(0.52, 0.006, 0.006), wire, 0, 0.07 + j * 0.068, 0.004);
  // remaches
  for (const [x, y] of [[-0.27, -0.43], [0.27, -0.43], [-0.27, -0.12], [0.27, -0.12], [-0.27, 0.4], [0.27, 0.4]]) {
    add(g, CZ(0.009, 0.009, 0.01, 8), chromeMat(), x, y, -0.025);
  }
  // carretilla en la parte trasera con ruedas
  add(g, CY(0.012, 0.012, 0.92, 8), frame, -0.2, 0, 0.05);
  add(g, CY(0.012, 0.012, 0.92, 8), frame, 0.2, 0, 0.05);
  add(g, B(0.42, 0.02, 0.02), frame, 0, 0.3, 0.05);
  add(g, B(0.42, 0.02, 0.02), frame, 0, -0.3, 0.05);
  add(g, CX(0.042, 0.03, 14), rubberMat(), -0.22, -0.43, 0.085);
  add(g, CX(0.042, 0.03, 14), rubberMat(), 0.22, -0.43, 0.085);
  add(g, CX(0.008, 0.5, 8), frame, 0, -0.43, 0.085);
  // asas para las manos
  const handleL = V(-0.12, -0.12, 0.1), handleR = V(0.14, 0.06, 0.1);
  add(g, B(0.13, 0.022, 0.022), chromeMat(), handleL.x, handleL.y, handleL.z);
  add(g, B(0.014, 0.014, 0.05), frame, handleL.x - 0.06, handleL.y, 0.07);
  add(g, B(0.014, 0.014, 0.05), frame, handleL.x + 0.06, handleL.y, 0.07);
  add(g, B(0.022, 0.13, 0.022), chromeMat(), handleR.x, handleR.y, handleR.z);
  add(g, B(0.014, 0.014, 0.05), frame, handleR.x, handleR.y - 0.06, 0.07);
  add(g, B(0.014, 0.014, 0.05), frame, handleR.x, handleR.y + 0.06, 0.07);
  g.userData = { handleL, handleR, width: 0.62, height: 0.92 };
  return g;
}

// ------------------------------------------------------------------ Osito de peluche (caja misteriosa)
// Sentado, pies en y=0, mirando a -Z, ~0.45 m de alto.
export function createTeddyMesh() {
  const g = new THREE.Group();
  g.name = 'teddy_bear';
  const tex = furTexture();
  const fur = MAT('teddy_fur', () => new THREE.MeshStandardMaterial({ color: 0x7a4f2a, map: tex, roughness: 1, metalness: 0 }));
  const light = MAT('teddy_light', () => new THREE.MeshStandardMaterial({ color: 0xc9a27a, map: tex, roughness: 1, metalness: 0 }));
  const black = MAT('teddy_black', () => new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.25, metalness: 0.1 }));
  const stitch = MAT('teddy_stitch', () => new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 1, metalness: 0 }));
  const body = add(g, SPH(0.1, 16, 12), fur, 0, 0.15, 0);
  body.scale.set(1, 1.15, 0.9);
  const belly = add(g, SPH(0.07, 14, 10), light, 0, 0.14, -0.045);
  belly.scale.set(1, 1.15, 0.6);
  const head = add(g, SPH(0.085, 16, 12), fur, 0, 0.32, -0.01);
  head.scale.set(1.05, 0.95, 0.95);
  for (const s of [-1, 1]) {
    add(g, SPH(0.032, 10, 8), fur, s * 0.062, 0.39, 0);
    const ie = add(g, SPH(0.02, 8, 6), light, s * 0.062, 0.39, -0.014);
    ie.scale.set(1, 1, 0.5);
    add(g, SPH(0.011, 8, 6), black, s * 0.032, 0.34, -0.078);
    // brazos
    const arm = add(g, SPH(0.035, 10, 8), fur, s * 0.1, 0.19, -0.035, 0.6, 0, s * 0.5);
    arm.scale.set(0.9, 1.8, 0.9);
    // piernas sentadas con almohadillas
    const leg = add(g, SPH(0.042, 10, 8), fur, s * 0.06, 0.045, -0.06, PI / 2, 0, 0);
    leg.scale.set(1, 1.6, 1);
    const pad = add(g, SPH(0.03, 10, 8), light, s * 0.06, 0.045, -0.125);
    pad.scale.set(1, 1, 0.35);
  }
  const muzzle = add(g, SPH(0.036, 12, 10), light, 0, 0.3, -0.075);
  muzzle.scale.set(1.1, 0.85, 0.8);
  add(g, SPH(0.012, 8, 6), black, 0, 0.312, -0.103);
  add(g, B(0.002, 0.018, 0.002), stitch, 0, 0.292, -0.104);
  add(g, B(0.002, 0.14, 0.002), stitch, 0, 0.14, -0.088);
  // lazo rojo en el cuello
  const bow = MAT('teddy_bow', () => new THREE.MeshStandardMaterial({ color: 0x9a1418, roughness: 0.6, metalness: 0 }));
  add(g, CONEZ(0.022, 0.04, 6), bow, -0.022, 0.25, -0.07, 0, -PI / 2, 0);
  add(g, CONEZ(0.022, 0.04, 6), bow, 0.022, 0.25, -0.07, 0, PI / 2, 0);
  add(g, SPH(0.01, 8, 6), bow, 0, 0.25, -0.075);
  return g;
}

// Libera cachés (normalmente no hace falta: los modelos viven toda la sesión)
export function disposeModelCaches() {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
}

export default {
  createWeaponMesh, createShieldMesh, createTeddyMesh, updateCamo, createKnifeMesh, createGrenadeMesh,
  createBottleMesh, getCamoMaterial, getArmMaterials, getGlowTexture, getFlashTexture, disposeModelCaches,
};
