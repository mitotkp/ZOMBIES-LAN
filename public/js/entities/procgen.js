// Utilidades procedurales compartidas por los modelos de entidades y los efectos:
// números aleatorios con semilla, lienzos (canvas), texturas, pintura de vértices y fusión de geometrías.
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const HAS_DOM = typeof document !== 'undefined' && typeof document.createElement === 'function';

// Generador pseudoaleatorio con semilla (mulberry32)
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
export function smoothstep(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
export function easeInOut(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
export function easeOut(t) { t = clamp01(t); return 1 - (1 - t) * (1 - t); }

// Ruido de valor 2D barato (determinista) para manchas y pelo
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, seed = 0, oct = 3) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += valueNoise(x * f, y * f, seed + i * 17) * amp; f *= 2; amp *= 0.5; }
  return s / (1 - Math.pow(0.5, oct));
}

// --------------------------------------------------------------------------------------------
// Lienzos y texturas
// --------------------------------------------------------------------------------------------
export function makeCanvas(w, h) {
  if (!HAS_DOM) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Textura desde un lienzo. Si no hay DOM (pruebas en Node) devuelve una textura blanca de 1x1.
export function canvasTexture(canvas, srgb = true) {
  let tex;
  if (canvas) {
    tex = new THREE.CanvasTexture(canvas);
  } else {
    tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
  }
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Textura de brillo radial (blanca, alfa decreciente) generada sin lienzo
export function glowTexture(size = 64, power = 2.2) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const core = Math.pow(1 - d, power);
      const a = Math.min(1, core * 1.15 + Math.max(0, 0.35 - d) * 1.5);
      const i = (y * size + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = Math.round(clamp01(a) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Textura de "bocanada" de humo (alfa con ruido) para partículas
export function puffTexture(size = 64, seed = 7) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const n = fbm(x / 9, y / 9, seed, 4);
      const a = clamp01((1 - d) * 1.6) * clamp01(0.25 + n * 1.1);
      const i = (y * size + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Manchas de ruido sobre un lienzo 2D
export function blotches(g, w, h, r, color, count, minR, maxR, alphaMin = 0.05, alphaMax = 0.2) {
  g.save();
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    g.globalAlpha = alphaMin + r() * (alphaMax - alphaMin);
    const rad = minR + r() * (maxR - minR);
    g.beginPath();
    g.ellipse(r() * w, r() * h, rad, rad * (0.5 + r() * 0.8), r() * Math.PI, 0, TAU);
    g.fill();
  }
  g.restore();
}

// Mancha de sangre con gotas y chorreones hacia abajo
export function bloodStain(g, x, y, size, r, dark = false) {
  g.save();
  const base = dark ? 'rgba(45,4,4,' : 'rgba(92,8,8,';
  for (let i = 0; i < 7; i++) {
    g.fillStyle = base + (0.35 + r() * 0.5).toFixed(2) + ')';
    const rr = size * (0.25 + r() * 0.55);
    g.beginPath();
    g.ellipse(x + (r() - 0.5) * size, y + (r() - 0.5) * size * 0.7, rr, rr * (0.5 + r() * 0.6), r() * Math.PI, 0, TAU);
    g.fill();
  }
  // chorreones
  const drips = 2 + Math.floor(r() * 4);
  for (let i = 0; i < drips; i++) {
    const dx = x + (r() - 0.5) * size * 1.2;
    const len = size * (0.6 + r() * 2.2);
    const wdt = 1.5 + r() * size * 0.12;
    g.fillStyle = base + (0.5 + r() * 0.4).toFixed(2) + ')';
    g.fillRect(dx - wdt / 2, y, wdt, len);
    g.beginPath();
    g.arc(dx, y + len, wdt * 0.8, 0, TAU);
    g.fill();
  }
  // salpicaduras
  for (let i = 0; i < 10; i++) {
    g.fillStyle = base + (0.4 + r() * 0.5).toFixed(2) + ')';
    const a = r() * TAU, d = size * (0.7 + r() * 1.1);
    g.beginPath();
    g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, 0.8 + r() * 2.2, 0, TAU);
    g.fill();
  }
  g.restore();
}

// Desgarro irregular en la ropa: rellena con color de piel y borde oscuro/sangriento
export function tearHole(g, x, y, w, h, r, fill) {
  const pts = [];
  const n = 14 + Math.floor(r() * 8);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const jag = 0.55 + r() * 0.6;
    pts.push([x + Math.cos(a) * w * 0.5 * jag, y + Math.sin(a) * h * 0.5 * jag]);
  }
  g.save();
  // borde deshilachado oscuro
  g.strokeStyle = 'rgba(30,18,12,0.85)';
  g.lineWidth = 3;
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.closePath();
  g.stroke();
  g.fillStyle = fill;
  g.fill();
  // arañazos / heridas dentro
  g.strokeStyle = 'rgba(110,12,10,0.8)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    const sx = x + (r() - 0.5) * w * 0.5, sy = y + (r() - 0.5) * h * 0.5;
    g.moveTo(sx, sy);
    g.lineTo(sx + (r() - 0.5) * w * 0.5, sy + (r() - 0.5) * h * 0.4);
    g.stroke();
  }
  // hilos sueltos
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const p = pts[Math.floor(r() * pts.length)];
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.lineTo(p[0] + (r() - 0.5) * 8, p[1] + r() * 8);
    g.stroke();
  }
  g.restore();
}

// Suciedad general, más intensa hacia abajo
export function grime(g, w, h, r, strength = 1) {
  blotches(g, w, h, r, '#2a2016', Math.round(60 * strength), 3, 18, 0.04, 0.16);
  blotches(g, w, h, r, '#000000', Math.round(25 * strength), 2, 10, 0.05, 0.15);
  const grd = g.createLinearGradient(0, h * 0.4, 0, h);
  grd.addColorStop(0, 'rgba(40,30,20,0)');
  grd.addColorStop(1, `rgba(40,30,20,${(0.35 * strength).toFixed(2)})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
}

// --------------------------------------------------------------------------------------------
// Geometría
// --------------------------------------------------------------------------------------------
const _c = new THREE.Color();

// Pinta colores de vértice: fn(x, y, z, color, nx, ny, nz) modifica `color` (blanco por defecto)
export function paintGeo(geo, fn) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    _c.setRGB(1, 1, 1);
    if (fn) fn(pos.getX(i), pos.getY(i), pos.getZ(i), _c, nor ? nor.getX(i) : 0, nor ? nor.getY(i) : 1, nor ? nor.getZ(i) : 0);
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export function solidColor(geo, r, g, b) {
  return paintGeo(geo, (x, y, z, c) => c.setRGB(r, g, b));
}

// Reasigna las UV de una geometría a un sub-rectángulo de la textura
export function remapUV(geo, u0, u1, v0, v1) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  uv.needsUpdate = true;
  return geo;
}

// Deforma posiciones con fn(v: Vector3) y recalcula normales
const _v = new THREE.Vector3();
export function deform(geo, fn, recompute = true) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    fn(_v, i);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  pos.needsUpdate = true;
  if (recompute) geo.computeVertexNormals();
  return geo;
}

// Fusiona geometrías (position, normal, uv, color) en una sola indexada. Libera las de entrada.
export function mergeGeos(list) {
  let vCount = 0, iCount = 0;
  for (const g of list) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2), col = new Float32Array(vCount * 3);
  const index = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv, c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      const k = (vo + i) * 3;
      pos[k] = p.getX(i); pos[k + 1] = p.getY(i); pos[k + 2] = p.getZ(i);
      if (n) { nor[k] = n.getX(i); nor[k + 1] = n.getY(i); nor[k + 2] = n.getZ(i); } else { nor[k + 1] = 1; }
      if (t) { uv[(vo + i) * 2] = t.getX(i); uv[(vo + i) * 2 + 1] = t.getY(i); }
      if (c) { col[k] = c.getX(i); col[k + 1] = c.getY(i); col[k + 2] = c.getZ(i); } else { col[k] = col[k + 1] = col[k + 2] = 1; }
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) index[io + i] = g.index.getX(i) + vo;
      io += g.index.count;
    } else {
      for (let i = 0; i < p.count; i++) index[io + i] = vo + i;
      io += p.count;
    }
    vo += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// Material estándar o Lambert según la calidad
export function makeMat(quality, params) {
  const p = { ...params };
  if (quality === 'low') {
    delete p.roughness; delete p.metalness;
    return new THREE.MeshLambertMaterial(p);
  }
  if (p.roughness === undefined) p.roughness = 0.9;
  if (p.metalness === undefined) p.metalness = 0;
  return new THREE.MeshStandardMaterial(p);
}

// Limbo (cilindro que cuelga hacia -Y desde el pivote) con perfil de radio y borde irregular opcional
export function limbGeo(len, r0, r1, radial = 8, rows = 3, raggedEnd = 0, seed = 1, depthScale = 1) {
  const g = new THREE.CylinderGeometry(r0, r1, len, radial, rows, false);
  g.translate(0, -len / 2, 0);
  if (depthScale !== 1) g.scale(1, 1, depthScale);
  if (raggedEnd > 0) {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) + len) < 1e-4) {
        // borde inferior deshilachado: desplazamiento según el ángulo (los vértices duplicados coinciden)
        const x = pos.getX(i), z = pos.getZ(i);
        if (Math.hypot(x, z) > 1e-5) {
          const ang = Math.atan2(x, z) + Math.PI;
          const off = (valueNoise(ang * 2.3, seed * 0.37, seed) - 0.35) * raggedEnd;
          pos.setY(i, -len + off);
        }
      }
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}
