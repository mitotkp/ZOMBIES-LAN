// Texturas procedurales dibujadas en canvas (sin recursos externos).
// Todas las texturas repetibles son "tileables" y se cachean por nombre.
import * as THREE from 'three';
import { WEAPONS, weaponName } from '/shared/weapons.js';
import { PERKS } from '/shared/perks.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

// Generador pseudoaleatorio determinista (mulberry32)
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let maxAniso = 4;
export function setAnisotropy(n) { maxAniso = Math.max(1, n | 0); }

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  return { c, g, w, h };
}

const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
export function rgb(r, g, b) { return `rgb(${cl(r)},${cl(g)},${cl(b)})`; }
export function rgba(r, g, b, a) { return `rgba(${cl(r)},${cl(g)},${cl(b)},${a})`; }

function toTex(c, { repeat = true, srgb = true, aniso = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso ? maxAniso : 1;
  t.needsUpdate = true;
  return t;
}

// Ruido por píxel
function grain(cv, amt, rand, mono = true) {
  const { g, w, h } = cv;
  const id = g.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amt;
    if (mono) { d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    else { d[i] += n; d[i + 1] += (rand() - 0.5) * amt; d[i + 2] += (rand() - 0.5) * amt; }
  }
  g.putImageData(id, 0, 0);
}

// Ruido suave repetible: una cuadrícula pequeña con borde envuelto, ampliada con interpolación
function cloud(cv, cells, rand, color, alpha, mode = 'source-over') {
  const n = cells;
  const s = mk(n + 2, n + 2);
  const id = s.g.createImageData(n + 2, n + 2);
  const vals = new Float32Array(n * n);
  for (let i = 0; i < vals.length; i++) vals[i] = rand();
  for (let y = 0; y < n + 2; y++) {
    for (let x = 0; x < n + 2; x++) {
      const v = vals[((y - 1 + n) % n) * n + ((x - 1 + n) % n)];
      const i = (y * (n + 2) + x) * 4;
      id.data[i] = color[0]; id.data[i + 1] = color[1]; id.data[i + 2] = color[2];
      id.data[i + 3] = v * v * 255 * alpha;
    }
  }
  s.g.putImageData(id, 0, 0);
  const { g, w, h } = cv;
  g.save();
  g.imageSmoothingEnabled = true;
  g.globalCompositeOperation = mode;
  const sx = w / n, sy = h / n;
  g.drawImage(s.c, 0, 0, n + 2, n + 2, -sx, -sy, (n + 2) * sx, (n + 2) * sy);
  g.restore();
}

// Mancha radial que se repite en los bordes
function blot(cv, x, y, r, color, a) {
  const { g, w, h } = cv;
  for (const ox of [-w, 0, w]) {
    for (const oy of [-h, 0, h]) {
      const cx = x + ox, cy = y + oy;
      if (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > h) continue;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, rgba(color[0], color[1], color[2], a));
      gr.addColorStop(1, rgba(color[0], color[1], color[2], 0));
      g.fillStyle = gr;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
}

// Grieta: camino aleatorio con ramas
function crack(cv, x, y, len, rand, width = 1, color = 'rgba(15,15,15,0.55)') {
  const { g } = cv;
  g.save();
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
  let a = rand() * TAU;
  const walk = (px, py, ang, n, wd) => {
    g.lineWidth = wd;
    g.beginPath(); g.moveTo(px, py);
    for (let i = 0; i < n; i++) {
      ang += (rand() - 0.5) * 0.9;
      px += Math.cos(ang) * 4; py += Math.sin(ang) * 4;
      g.lineTo(px, py);
      if (rand() < 0.05 && wd > 0.6) { g.stroke(); walk(px, py, ang + (rand() - 0.5) * 2, n - i >> 1, wd * 0.6); g.lineWidth = wd; g.beginPath(); g.moveTo(px, py); }
    }
    g.stroke();
  };
  walk(x, y, a, len, width);
  g.restore();
}

function speckle(cv, n, rand, colors, rMin, rMax, alpha) {
  const { g, w, h } = cv;
  for (let i = 0; i < n; i++) {
    const c = colors[(rand() * colors.length) | 0];
    g.fillStyle = rgba(c[0], c[1], c[2], alpha * (0.4 + rand() * 0.6));
    const r = rMin + rand() * (rMax - rMin);
    g.beginPath(); g.arc(rand() * w, rand() * h, r, 0, TAU); g.fill();
  }
}

// Tablones de madera horizontales
function planks(cv, rand, { y0 = 0, y1 = cv.h, ph = 32, base = [110, 74, 44], vary = 22, gap = 2, grainN = 10, joints = true, nails = true }) {
  const { g, w } = cv;
  for (let y = y0; y < y1; y += ph) {
    const v = (rand() - 0.5) * vary;
    const col = [base[0] + v, base[1] + v * 0.75, base[2] + v * 0.5];
    g.fillStyle = rgb(col[0], col[1], col[2]);
    g.fillRect(0, y, w, ph);
    // vetas
    for (let k = 0; k < grainN; k++) {
      const yy = y + 2 + rand() * (ph - 4);
      g.strokeStyle = rgba(col[0] * 0.6, col[1] * 0.55, col[2] * 0.5, 0.35 + rand() * 0.3);
      g.lineWidth = 0.6 + rand();
      g.beginPath();
      const amp = rand() * 2, fr = 0.01 + rand() * 0.03, ph0 = rand() * 10;
      for (let x = 0; x <= w; x += 8) g.lineTo(x, yy + Math.sin(x * fr + ph0) * amp);
      g.stroke();
    }
    // nudos
    if (rand() < 0.35) {
      const kx = rand() * w, ky = y + ph / 2;
      g.fillStyle = rgba(col[0] * 0.45, col[1] * 0.4, col[2] * 0.35, 0.8);
      g.beginPath(); g.ellipse(kx, ky, 4 + rand() * 5, 2 + rand() * 2, 0, 0, TAU); g.fill();
    }
    // separación entre tablones
    g.fillStyle = 'rgba(12,8,5,0.85)';
    g.fillRect(0, y + ph - gap, w, gap);
    // juntas de testa
    if (joints) {
      const jx = rand() * w;
      g.fillRect(jx, y, 2, ph);
      if (nails) {
        g.fillStyle = 'rgba(40,40,40,0.9)';
        g.fillRect(jx - 5, y + ph * 0.3, 2, 2); g.fillRect(jx - 5, y + ph * 0.65, 2, 2);
        g.fillRect(jx + 5, y + ph * 0.3, 2, 2); g.fillRect(jx + 5, y + ph * 0.65, 2, 2);
        g.fillStyle = 'rgba(12,8,5,0.85)';
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Generadores de texturas repetibles
// ---------------------------------------------------------------------------

const GEN = {
  // Baldosas grandes de la terminal (2 m)
  tiles() {
    const cv = mk(512, 512), { g } = cv, r = makeRng(11);
    g.fillStyle = '#3e3c37'; g.fillRect(0, 0, 512, 512);
    const s = 128;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const light = (i + j) % 2 === 0;
      const b = light ? [176, 170, 152] : [104, 100, 92];
      const v = (r() - 0.5) * 16;
      g.fillStyle = rgb(b[0] + v, b[1] + v, b[2] + v);
      g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
      const gr = g.createLinearGradient(i * s, j * s, i * s + s, j * s + s);
      gr.addColorStop(0, 'rgba(255,255,255,0.06)'); gr.addColorStop(1, 'rgba(0,0,0,0.1)');
      g.fillStyle = gr; g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
      if (r() < 0.35) crack(cv, i * s + 20 + r() * 88, j * s + 20 + r() * 88, 8 + r() * 14, r, 1);
    }
    cloud(cv, 4, r, [40, 34, 28], 0.4);
    cloud(cv, 16, r, [30, 26, 22], 0.25);
    for (let k = 0; k < 12; k++) blot(cv, r() * 512, r() * 512, 20 + r() * 60, [35, 28, 22], 0.25);
    grain(cv, 14, r);
    return toTex(cv.c);
  },

  // Asfalto (4 m)
  asphalt() {
    const cv = mk(512, 512), { g } = cv, r = makeRng(21);
    g.fillStyle = '#2e2f31'; g.fillRect(0, 0, 512, 512);
    cloud(cv, 6, r, [20, 20, 22], 0.6);
    cloud(cv, 24, r, [70, 70, 72], 0.25);
    speckle(cv, 5000, r, [[120, 120, 118], [90, 88, 85], [15, 15, 15]], 0.4, 1.3, 0.45);
    // parches reparados
    for (let k = 0; k < 3; k++) {
      g.fillStyle = `rgba(20,20,22,${0.3 + r() * 0.2})`;
      const x = r() * 400, y = r() * 400;
      g.fillRect(x, y, 40 + r() * 80, 30 + r() * 60);
    }
    for (let k = 0; k < 7; k++) crack(cv, 40 + r() * 432, 40 + r() * 432, 18 + r() * 30, r, 1.3, 'rgba(8,8,8,0.7)');
    for (let k = 0; k < 6; k++) blot(cv, r() * 512, r() * 512, 20 + r() * 50, [10, 10, 12], 0.35);
    grain(cv, 16, r);
    return toTex(cv.c);
  },

  // Acera de losas de hormigón (2 m)
  sidewalk() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(31);
    g.fillStyle = '#2d2c2a'; g.fillRect(0, 0, 256, 256);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const v = (r() - 0.5) * 14;
      g.fillStyle = rgb(120 + v, 118 + v, 112 + v);
      g.fillRect(i * 128 + 1, j * 128 + 1, 126, 126);
      if (r() < 0.5) crack(cv, i * 128 + 20 + r() * 88, j * 128 + 20 + r() * 88, 8 + r() * 10, r, 1);
    }
    cloud(cv, 8, r, [40, 38, 34], 0.45);
    speckle(cv, 900, r, [[150, 148, 140], [60, 58, 54]], 0.4, 1.1, 0.4);
    for (let k = 0; k < 6; k++) blot(cv, r() * 256, r() * 256, 10 + r() * 30, [30, 28, 25], 0.3);
    grain(cv, 16, r);
    return toTex(cv.c);
  },

  // Suelo de madera del bar (3 m)
  wood_floor() {
    const cv = mk(512, 512), r = makeRng(41);
    planks(cv, r, { ph: 32, base: [96, 62, 36], vary: 26, grainN: 9 });
    cloud(cv, 6, r, [20, 12, 6], 0.45);
    for (let k = 0; k < 10; k++) blot(cv, r() * 512, r() * 512, 15 + r() * 45, [18, 10, 5], 0.3);
    grain(cv, 12, r);
    return toTex(cv.c);
  },

  // Hormigón (4 m)
  concrete() {
    const cv = mk(512, 512), { g } = cv, r = makeRng(51);
    g.fillStyle = '#7c7a75'; g.fillRect(0, 0, 512, 512);
    cloud(cv, 4, r, [50, 48, 44], 0.5);
    cloud(cv, 12, r, [140, 138, 132], 0.3);
    cloud(cv, 32, r, [60, 58, 55], 0.25);
    speckle(cv, 2500, r, [[160, 158, 150], [50, 48, 45]], 0.4, 1.2, 0.35);
    for (let k = 0; k < 6; k++) crack(cv, 30 + r() * 450, 30 + r() * 450, 14 + r() * 26, r, 1.2);
    for (let k = 0; k < 5; k++) blot(cv, r() * 512, r() * 512, 25 + r() * 55, [20, 18, 16], 0.35);
    // junta de dilatación en el borde (se repite cada 4 m)
    g.fillStyle = 'rgba(25,24,22,0.8)'; g.fillRect(0, 0, 512, 3); g.fillRect(0, 0, 3, 512);
    grain(cv, 14, r);
    return toTex(cv.c);
  },

  // Chapa estriada (1 m)
  metal_plate() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(61);
    g.fillStyle = '#5c6066'; g.fillRect(0, 0, 256, 256);
    cloud(cv, 6, r, [30, 32, 36], 0.4);
    for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) {
      const off = ((y / 32) % 2) * 16;
      for (const [dx, dy, ang] of [[8, 8, 0.8], [24, 24, -0.8]]) {
        const cx = (x + dx + off) % 256, cy = y + dy;
        g.save(); g.translate(cx, cy); g.rotate(ang);
        g.fillStyle = 'rgba(160,165,172,0.55)'; g.beginPath(); g.ellipse(-1, -1, 9, 2.5, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(20,22,25,0.6)'; g.beginPath(); g.ellipse(1, 1.5, 9, 2, 0, 0, TAU); g.fill();
        g.restore();
      }
    }
    for (let k = 0; k < 25; k++) {
      g.strokeStyle = `rgba(200,200,205,${0.08 + r() * 0.12})`; g.lineWidth = 0.7;
      const x = r() * 256, y = r() * 256, a = r() * TAU, l = 10 + r() * 40;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let k = 0; k < 5; k++) blot(cv, r() * 256, r() * 256, 8 + r() * 20, [90, 50, 25], 0.35);
    grain(cv, 12, r);
    return toTex(cv.c);
  },

  // Tierra de los callejones (3 m)
  dirt() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(71);
    g.fillStyle = '#3a2f24'; g.fillRect(0, 0, 256, 256);
    cloud(cv, 5, r, [22, 16, 11], 0.6);
    cloud(cv, 14, r, [80, 66, 50], 0.35);
    speckle(cv, 700, r, [[100, 90, 78], [60, 52, 44], [25, 20, 15]], 0.6, 2.4, 0.6);
    for (let k = 0; k < 60; k++) {
      g.strokeStyle = `rgba(90,80,50,${0.2 + r() * 0.3})`; g.lineWidth = 0.8;
      const x = r() * 256, y = r() * 256;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 8, y - 3 - r() * 6); g.stroke();
    }
    grain(cv, 22, r, false);
    return toTex(cv.c);
  },

  // Terreno exterior: tierra y hierba muerta (8 m)
  grass() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(81);
    g.fillStyle = '#262a1d'; g.fillRect(0, 0, 256, 256);
    cloud(cv, 4, r, [48, 40, 30], 0.7);
    cloud(cv, 12, r, [16, 20, 12], 0.5);
    for (let k = 0; k < 900; k++) {
      const c = r() < 0.5 ? [92, 84, 52] : [60, 64, 38];
      g.strokeStyle = rgba(c[0], c[1], c[2], 0.25 + r() * 0.35); g.lineWidth = 0.8;
      const x = r() * 256, y = r() * 256;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 6, y - 3 - r() * 7); g.stroke();
    }
    grain(cv, 20, r, false);
    return toTex(cv.c);
  },

  // Ladrillo (2 m)
  brick() {
    const cv = mk(512, 512), { g } = cv, r = makeRng(91);
    g.fillStyle = '#6a635a'; g.fillRect(0, 0, 512, 512);
    const bw = 64, bh = 16;
    for (let row = 0; row < 512 / bh; row++) {
      const off = (row % 2) * (bw / 2);
      for (let col = -1; col < 512 / bw + 1; col++) {
        const x = col * bw + off, y = row * bh;
        const dark = r() < 0.12;
        const v = (r() - 0.5) * 30;
        const b = dark ? [78, 38, 30] : [138, 64, 46];
        g.fillStyle = rgb(b[0] + v, b[1] + v * 0.5, b[2] + v * 0.4);
        g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
        g.fillStyle = 'rgba(255,220,200,0.06)'; g.fillRect(x + 1.5, y + 1.5, bw - 3, 2);
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 1.5, y + bh - 3.5, bw - 3, 2);
        if (r() < 0.15) { g.fillStyle = 'rgba(40,30,25,0.5)'; g.fillRect(x + r() * bw, y + 2, 4 + r() * 6, 3 + r() * 5); }
      }
    }
    cloud(cv, 4, r, [20, 16, 14], 0.55);
    cloud(cv, 10, r, [200, 190, 170], 0.12);
    for (let k = 0; k < 8; k++) blot(cv, r() * 512, r() * 512, 20 + r() * 60, [15, 12, 10], 0.3);
    grain(cv, 14, r);
    return toTex(cv.c);
  },

  // Yeso sucio (2 m)
  plaster() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(101);
    g.fillStyle = '#b3aa98'; g.fillRect(0, 0, 256, 256);
    cloud(cv, 4, r, [110, 96, 70], 0.45);
    cloud(cv, 12, r, [200, 195, 185], 0.25);
    cloud(cv, 24, r, [90, 84, 74], 0.15);
    for (let k = 0; k < 4; k++) crack(cv, 30 + r() * 196, 30 + r() * 196, 12 + r() * 16, r, 1, 'rgba(60,50,40,0.5)');
    // desconchones
    for (let k = 0; k < 4; k++) {
      const x = 20 + r() * 216, y = 20 + r() * 216;
      g.fillStyle = 'rgba(120,108,92,0.7)';
      g.beginPath();
      for (let a = 0; a < TAU; a += 0.5) g.lineTo(x + Math.cos(a) * (6 + r() * 8), y + Math.sin(a) * (4 + r() * 6));
      g.fill();
    }
    // chorretones de humedad
    for (let k = 0; k < 6; k++) {
      const x = r() * 256;
      const gr = g.createLinearGradient(0, 0, 0, 120 + r() * 100);
      gr.addColorStop(0, 'rgba(90,76,50,0.35)'); gr.addColorStop(1, 'rgba(90,76,50,0)');
      g.fillStyle = gr; g.fillRect(x, 0, 4 + r() * 10, 256);
    }
    grain(cv, 10, r);
    return toTex(cv.c);
  },

  // Papel pintado del bar (1.5 m)
  wallpaper() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(111);
    g.fillStyle = '#4c2226'; g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 32) {
      g.fillStyle = 'rgba(40,14,18,0.6)'; g.fillRect(x + 16, 0, 16, 256);
      g.fillStyle = 'rgba(170,130,70,0.35)'; g.fillRect(x, 0, 1.5, 256); g.fillRect(x + 15, 0, 1, 256);
      for (let y = 0; y < 256; y += 32) {
        const cx = x + 8, cy = y + 16 + ((x / 32) % 2) * 16;
        g.fillStyle = 'rgba(170,130,70,0.28)';
        g.beginPath(); g.moveTo(cx, cy - 7); g.lineTo(cx + 5, cy); g.lineTo(cx, cy + 7); g.lineTo(cx - 5, cy); g.closePath(); g.fill();
        g.beginPath(); g.arc(cx, cy - 10, 1.5, 0, TAU); g.fill();
      }
    }
    cloud(cv, 4, r, [30, 20, 12], 0.5);
    for (let k = 0; k < 5; k++) {
      const x = r() * 256;
      const gr = g.createLinearGradient(0, 0, 0, 200);
      gr.addColorStop(0, 'rgba(80,60,30,0.35)'); gr.addColorStop(1, 'rgba(80,60,30,0)');
      g.fillStyle = gr; g.fillRect(x, 0, 6 + r() * 12, 256);
    }
    // jirones rasgados
    for (let k = 0; k < 3; k++) {
      const x = 20 + r() * 200, y = 20 + r() * 200;
      g.fillStyle = 'rgba(150,135,110,0.8)';
      g.beginPath(); g.moveTo(x, y);
      for (let i = 0; i < 6; i++) g.lineTo(x + (r() - 0.3) * 30, y + r() * 30);
      g.fill();
    }
    grain(cv, 12, r);
    return toTex(cv.c);
  },

  // Bloques de hormigón de la planta (1.6 m)
  block() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(121);
    g.fillStyle = '#55554f'; g.fillRect(0, 0, 256, 256);
    const bw = 64, bh = 32;
    for (let row = 0; row < 8; row++) {
      const off = (row % 2) * 32;
      for (let col = -1; col < 5; col++) {
        const v = (r() - 0.5) * 18;
        g.fillStyle = rgb(128 + v, 128 + v, 122 + v);
        g.fillRect(col * bw + off + 1.5, row * bh + 1.5, bw - 3, bh - 3);
      }
    }
    speckle(cv, 1500, r, [[70, 70, 66], [160, 160, 152]], 0.5, 1.3, 0.5);
    cloud(cv, 4, r, [30, 30, 28], 0.5);
    cloud(cv, 8, r, [90, 70, 40], 0.15);
    grain(cv, 14, r);
    return toTex(cv.c);
  },

  // Zócalo de madera (1 m de alto; la parte superior del canvas es la moldura)
  wainscot() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(131);
    g.fillStyle = '#3a2416'; g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 64) {
      const v = (r() - 0.5) * 16;
      g.fillStyle = rgb(78 + v, 50 + v * 0.7, 30 + v * 0.5);
      g.fillRect(x + 6, 40, 52, 200);
      g.strokeStyle = 'rgba(20,10,5,0.6)'; g.lineWidth = 2; g.strokeRect(x + 10, 46, 44, 188);
      for (let k = 0; k < 8; k++) {
        g.strokeStyle = `rgba(30,16,8,${0.2 + r() * 0.3})`; g.lineWidth = 0.8;
        const xx = x + 10 + r() * 44;
        g.beginPath(); g.moveTo(xx, 46); g.lineTo(xx + (r() - 0.5) * 4, 234); g.stroke();
      }
    }
    g.fillStyle = '#2a180c'; g.fillRect(0, 0, 256, 14);
    g.fillStyle = '#5a3a22'; g.fillRect(0, 14, 256, 20);
    g.fillStyle = 'rgba(255,230,200,0.12)'; g.fillRect(0, 14, 256, 4);
    g.fillStyle = '#20120a'; g.fillRect(0, 244, 256, 12);
    cloud(cv, 6, r, [10, 6, 3], 0.4);
    grain(cv, 10, r);
    return toTex(cv.c);
  },

  // Zócalo de azulejos (terminal)
  wall_tile() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(141);
    g.fillStyle = '#4b5550'; g.fillRect(0, 0, 256, 256);
    for (let y = 24; y < 256; y += 32) for (let x = 0; x < 256; x += 32) {
      const v = (r() - 0.5) * 14;
      if (r() < 0.04) { g.fillStyle = '#3a3a36'; g.fillRect(x + 1, y + 1, 30, 30); continue; }
      g.fillStyle = rgb(146 + v, 170 + v, 156 + v);
      g.fillRect(x + 1.5, y + 1.5, 29, 29);
      g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x + 3, y + 3, 10, 3);
    }
    g.fillStyle = '#2e5646'; g.fillRect(0, 0, 256, 24);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 2, 256, 3);
    const gr = g.createLinearGradient(0, 140, 0, 256);
    gr.addColorStop(0, 'rgba(30,24,16,0)'); gr.addColorStop(1, 'rgba(30,24,16,0.65)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    cloud(cv, 6, r, [40, 34, 24], 0.35);
    grain(cv, 10, r);
    return toTex(cv.c);
  },

  // Zócalo de la planta: hormigón con franja de peligro
  hazard() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(151);
    g.fillStyle = '#5d5d58'; g.fillRect(0, 0, 256, 256);
    cloud(cv, 6, r, [30, 30, 28], 0.5);
    g.save();
    g.beginPath(); g.rect(0, 8, 256, 46); g.clip();
    g.fillStyle = '#c9a019'; g.fillRect(0, 8, 256, 46);
    g.fillStyle = '#161616';
    for (let x = -64; x < 320; x += 32) {
      g.beginPath(); g.moveTo(x, 54); g.lineTo(x + 16, 54); g.lineTo(x + 46, 8); g.lineTo(x + 30, 8); g.closePath(); g.fill();
    }
    g.restore();
    cloud(cv, 12, r, [60, 50, 30], 0.35);
    const gr = g.createLinearGradient(0, 150, 0, 256);
    gr.addColorStop(0, 'rgba(20,18,15,0)'); gr.addColorStop(1, 'rgba(20,18,15,0.6)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    grain(cv, 16, r);
    return toTex(cv.c);
  },

  // Zócalo de piedra de las fachadas
  stone() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(161);
    g.fillStyle = '#34322e'; g.fillRect(0, 0, 256, 256);
    let y = 0;
    const rows = [90, 86, 80];
    for (const rh of rows) {
      let x = -r() * 60;
      while (x < 256) {
        const w = 70 + r() * 70;
        const v = (r() - 0.5) * 22;
        g.fillStyle = rgb(104 + v, 98 + v, 88 + v);
        g.fillRect(x + 2, y + 2, w - 4, rh - 4);
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x + 2, y + 2, w - 4, 4);
        x += w;
      }
      y += rh;
    }
    cloud(cv, 6, r, [20, 18, 15], 0.5);
    speckle(cv, 600, r, [[140, 135, 125], [40, 36, 32]], 0.5, 1.5, 0.5);
    grain(cv, 16, r);
    return toTex(cv.c);
  },

  // Placas de falso techo (1.2 m)
  ceiling_tiles() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(171);
    g.fillStyle = '#6d6d68'; g.fillRect(0, 0, 256, 256);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const missing = r() < 0.08;
      const v = (r() - 0.5) * 12;
      g.fillStyle = missing ? '#141414' : rgb(176 + v, 172 + v, 160 + v);
      g.fillRect(i * 128 + 3, j * 128 + 3, 122, 122);
      if (!missing) {
        for (let k = 0; k < 160; k++) {
          g.fillStyle = 'rgba(80,78,70,0.35)';
          g.fillRect(i * 128 + 6 + r() * 116, j * 128 + 6 + r() * 116, 1.2, 1.2);
        }
      }
    }
    for (let k = 0; k < 4; k++) blot(cv, r() * 256, r() * 256, 18 + r() * 34, [110, 80, 40], 0.45);
    cloud(cv, 6, r, [60, 55, 45], 0.3);
    grain(cv, 8, r);
    return toTex(cv.c);
  },

  // Techo de tablas de madera oscura (2 m)
  ceiling_wood() {
    const cv = mk(256, 256), r = makeRng(181);
    planks(cv, r, { ph: 32, base: [62, 42, 28], vary: 16, grainN: 7, nails: false });
    cloud(cv, 5, r, [10, 6, 4], 0.5);
    grain(cv, 10, r);
    return toTex(cv.c);
  },

  // Chapa ondulada (1 m)
  corrugated() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(191);
    for (let x = 0; x < 256; x++) {
      const s = Math.sin((x / 256) * TAU * 8);
      const v = 96 + s * 34;
      g.fillStyle = rgb(v * 0.92, v * 0.97, v);
      g.fillRect(x, 0, 1, 256);
    }
    for (let k = 0; k < 18; k++) {
      const x = r() * 256, y = r() * 200, l = 30 + r() * 140;
      const gr = g.createLinearGradient(0, y, 0, y + l);
      gr.addColorStop(0, 'rgba(120,60,25,0.5)'); gr.addColorStop(1, 'rgba(120,60,25,0)');
      g.fillStyle = gr; g.fillRect(x, y, 2 + r() * 6, l);
    }
    cloud(cv, 6, r, [90, 45, 20], 0.35);
    cloud(cv, 4, r, [20, 20, 22], 0.4);
    grain(cv, 12, r);
    return toTex(cv.c);
  },

  // Techo de alquitrán con grava (3 m)
  roof() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(201);
    g.fillStyle = '#2b2b2c'; g.fillRect(0, 0, 256, 256);
    cloud(cv, 5, r, [15, 15, 16], 0.6);
    speckle(cv, 2500, r, [[110, 108, 100], [70, 68, 64], [20, 20, 20]], 0.5, 1.4, 0.5);
    g.fillStyle = 'rgba(10,10,10,0.5)'; g.fillRect(0, 0, 256, 3);
    for (let k = 0; k < 5; k++) blot(cv, r() * 256, r() * 256, 20 + r() * 40, [40, 44, 48], 0.35);
    grain(cv, 14, r);
    return toTex(cv.c);
  },

  // Revoque claro para fachadas (se tiñe con color de vértice) (2 m)
  stucco() {
    const cv = mk(512, 512), { g } = cv, r = makeRng(211);
    g.fillStyle = '#c8c2b6'; g.fillRect(0, 0, 512, 512);
    cloud(cv, 4, r, [120, 110, 95], 0.4);
    cloud(cv, 16, r, [230, 225, 215], 0.2);
    cloud(cv, 40, r, [100, 95, 88], 0.18);
    for (let k = 0; k < 10; k++) {
      const x = r() * 512, l = 80 + r() * 260;
      const gr = g.createLinearGradient(0, 0, 0, l);
      gr.addColorStop(0, 'rgba(50,45,40,0.35)'); gr.addColorStop(1, 'rgba(50,45,40,0)');
      g.fillStyle = gr; g.fillRect(x, 0, 3 + r() * 14, l);
    }
    for (let k = 0; k < 6; k++) crack(cv, 40 + r() * 432, 40 + r() * 432, 14 + r() * 24, r, 1, 'rgba(40,36,30,0.45)');
    for (let k = 0; k < 5; k++) {
      const x = 30 + r() * 450, y = 30 + r() * 450;
      g.fillStyle = 'rgba(120,70,55,0.75)';
      g.beginPath();
      for (let a = 0; a < TAU; a += 0.4) g.lineTo(x + Math.cos(a) * (10 + r() * 16), y + Math.sin(a) * (7 + r() * 10));
      g.fill();
    }
    grain(cv, 12, r);
    return toTex(cv.c);
  },

  // Valla de tablones verticales (2 m de ancho x 1 alto de valla)
  fence() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(221);
    g.fillStyle = '#0c0b0a'; g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 21.33) {
      const v = (r() - 0.5) * 24;
      g.fillStyle = rgb(92 + v, 84 + v, 72 + v);
      g.fillRect(x + 1, r() * 6, 19, 256);
      for (let k = 0; k < 6; k++) {
        g.strokeStyle = `rgba(40,34,28,${0.3 + r() * 0.3})`; g.lineWidth = 0.8;
        const xx = x + 3 + r() * 15;
        g.beginPath(); g.moveTo(xx, 0); g.lineTo(xx + (r() - 0.5) * 3, 256); g.stroke();
      }
    }
    for (const y of [50, 190]) {
      g.fillStyle = '#4a4238'; g.fillRect(0, y, 256, 18);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y + 15, 256, 3);
      for (let x = 10; x < 256; x += 21.33) { g.fillStyle = '#222'; g.fillRect(x, y + 5, 2, 2); g.fillRect(x, y + 11, 2, 2); }
    }
    cloud(cv, 6, r, [25, 30, 20], 0.45);
    const gr = g.createLinearGradient(0, 180, 0, 256);
    gr.addColorStop(0, 'rgba(30,22,14,0)'); gr.addColorStop(1, 'rgba(30,22,14,0.7)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    grain(cv, 14, r);
    return toTex(cv.c);
  },

  // Tabla de barricada (una tabla con clavos)
  board() {
    const cv = mk(256, 64), { g } = cv, r = makeRng(231);
    planks(cv, r, { ph: 64, base: [134, 98, 62], vary: 10, grainN: 14, gap: 0, joints: false });
    g.fillStyle = 'rgba(30,20,10,0.6)'; g.fillRect(0, 0, 256, 3); g.fillRect(0, 61, 256, 3); g.fillRect(0, 0, 3, 64); g.fillRect(253, 0, 3, 64);
    for (const x of [14, 240]) for (const y of [18, 44]) {
      g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill();
      g.fillStyle = 'rgba(200,200,200,0.4)'; g.beginPath(); g.arc(x - 1, y - 1, 1, 0, TAU); g.fill();
    }
    cloud(cv, 4, r, [40, 25, 12], 0.35);
    grain(cv, 12, r);
    return toTex(cv.c, { repeat: false });
  },

  // Cara de caja de madera (UV 0..1 por cara)
  crate() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(241);
    planks(cv, r, { ph: 42.7, base: [128, 96, 58], vary: 16, grainN: 8, nails: false, joints: false });
    g.fillStyle = '#6e5030';
    g.fillRect(0, 0, 256, 24); g.fillRect(0, 232, 256, 24); g.fillRect(0, 0, 24, 256); g.fillRect(232, 0, 24, 256);
    g.save(); g.translate(128, 128); g.rotate(Math.PI / 4);
    g.fillRect(-170, -12, 340, 24); g.restore();
    g.strokeStyle = 'rgba(20,12,6,0.7)'; g.lineWidth = 2;
    g.strokeRect(1, 1, 254, 254); g.strokeRect(24, 24, 208, 208);
    g.fillStyle = '#2a2a2a';
    for (const [x, y] of [[12, 12], [244, 12], [12, 244], [244, 244], [128, 12], [128, 244], [12, 128], [244, 128]]) { g.beginPath(); g.arc(x, y, 2.5, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(30,20,12,0.55)';
    g.font = 'bold 26px "Arial Black", Arial, sans-serif'; g.textAlign = 'center';
    g.fillText(r() < 0.5 ? 'FRÁGIL' : 'CARGA', 128, 90);
    cloud(cv, 5, r, [30, 20, 10], 0.4);
    grain(cv, 12, r);
    return toTex(cv.c, { repeat: false });
  },

  // Madera genérica para muebles (1 m)
  wood() {
    const cv = mk(256, 256), r = makeRng(251);
    planks(cv, r, { ph: 64, base: [110, 72, 42], vary: 14, grainN: 22, gap: 1, joints: false });
    cloud(cv, 5, r, [30, 18, 8], 0.3);
    grain(cv, 10, r);
    return toTex(cv.c);
  },

  // Metal pintado y rayado (gris, se tiñe con color de vértice) (1 m)
  metal() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(261);
    g.fillStyle = '#b0b0b0'; g.fillRect(0, 0, 256, 256);
    cloud(cv, 5, r, [70, 70, 70], 0.45);
    cloud(cv, 20, r, [200, 200, 200], 0.2);
    for (let k = 0; k < 60; k++) {
      g.strokeStyle = `rgba(230,230,230,${0.1 + r() * 0.2})`; g.lineWidth = 0.6;
      const x = r() * 256, y = r() * 256, a = r() * TAU, l = 5 + r() * 30;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let k = 0; k < 8; k++) blot(cv, r() * 256, r() * 256, 6 + r() * 20, [100, 55, 25], 0.4);
    grain(cv, 10, r);
    return toTex(cv.c);
  },

  // Metal quemado y oxidado (autos) (1 m)
  rust() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(271);
    g.fillStyle = '#3a2a20'; g.fillRect(0, 0, 256, 256);
    cloud(cv, 4, r, [110, 52, 22], 0.7);
    cloud(cv, 10, r, [18, 16, 15], 0.7);
    cloud(cv, 24, r, [140, 80, 40], 0.3);
    speckle(cv, 800, r, [[20, 18, 16], [150, 90, 50]], 0.5, 2, 0.5);
    grain(cv, 22, r, false);
    return toTex(cv.c);
  },

  // Lona sucia
  tarp() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(281);
    g.fillStyle = '#4a4e3a'; g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 3) { g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.05})`; g.fillRect(x, 0, 1, 256); }
    for (let y = 0; y < 256; y += 3) { g.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.03})`; g.fillRect(0, y, 256, 1); }
    cloud(cv, 5, r, [20, 18, 12], 0.5);
    cloud(cv, 12, r, [100, 96, 80], 0.2);
    grain(cv, 12, r);
    return toTex(cv.c);
  },

  // Pintura vial desgastada (blanco; el color lo pone el material)
  paint() {
    const cv = mk(128, 128), { g } = cv, r = makeRng(291);
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, 128, 128);
    cloud(cv, 8, r, [60, 60, 60], 0.9);
    speckle(cv, 400, r, [[40, 40, 40]], 0.5, 2, 0.7);
    grain(cv, 20, r);
    return toTex(cv.c);
  },

  // Fachadas lejanas con ventanas (12 m)
  buildings() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(301);
    g.fillStyle = '#16171b'; g.fillRect(0, 0, 256, 256);
    cloud(cv, 4, r, [8, 8, 10], 0.6);
    for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 8; fx++) {
      const x = fx * 32 + 8, y = fy * 64 + 18;
      g.fillStyle = '#07080b'; g.fillRect(x, y, 16, 26);
    }
    grain(cv, 8, r);
    return toTex(cv.c);
  },
  buildings_emissive() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(301);
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 8; fx++) {
      if (r() > 0.07) continue;
      const x = fx * 32 + 8, y = fy * 64 + 18;
      const warm = r() < 0.75;
      g.fillStyle = warm ? '#ffae55' : '#9ec6ff';
      g.fillRect(x, y, 16, 26);
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x + 7, y, 2, 26);
    }
    return toTex(cv.c);
  },

  // Manchas de suciedad para calcomanías (alpha)
  grime() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(311);
    g.clearRect(0, 0, 256, 256);
    for (let k = 0; k < 14; k++) {
      const x = 128 + (r() - 0.5) * 120, y = 128 + (r() - 0.5) * 120, rr = 20 + r() * 50;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, `rgba(20,16,12,${0.35 + r() * 0.3})`); gr.addColorStop(1, 'rgba(20,16,12,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    }
    const m = g.createRadialGradient(128, 128, 60, 128, 128, 128);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in'; g.fillStyle = m; g.fillRect(0, 0, 256, 256);
    return toTex(cv.c, { repeat: false });
  },

  // Charco de sangre seca (alpha)
  blood() {
    const cv = mk(256, 256), { g } = cv, r = makeRng(321);
    g.clearRect(0, 0, 256, 256);
    const drawBlob = (x, y, rad, a) => {
      g.fillStyle = `rgba(70,6,6,${a})`;
      g.beginPath();
      const n = 18;
      for (let i = 0; i <= n; i++) {
        const ang = (i / n) * TAU;
        const rr = rad * (0.7 + r() * 0.5);
        g.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
      }
      g.fill();
    };
    drawBlob(128, 128, 60, 0.85);
    for (let k = 0; k < 16; k++) {
      const a = r() * TAU, d = 50 + r() * 60;
      drawBlob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 4 + r() * 12, 0.8);
    }
    for (let k = 0; k < 5; k++) {
      const a = r() * TAU;
      g.strokeStyle = 'rgba(60,5,5,0.7)'; g.lineWidth = 5 + r() * 6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * (70 + r() * 40), 128 + Math.sin(a) * (70 + r() * 40)); g.stroke();
    }
    const id = g.getImageData(0, 0, 256, 256);
    for (let i = 0; i < id.data.length; i += 4) {
      if (id.data[i + 3] === 0) continue;
      const n = (r() - 0.5) * 30;
      id.data[i] += n; id.data[i + 3] = Math.max(0, id.data[i + 3] - r() * 40);
    }
    g.putImageData(id, 0, 0);
    return toTex(cv.c, { repeat: false });
  },

  // Tapa de alcantarilla
  manhole() {
    const cv = mk(128, 128), { g } = cv, r = makeRng(331);
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#2a2a2b'; g.beginPath(); g.arc(64, 64, 62, 0, TAU); g.fill();
    g.strokeStyle = '#4a4a4c'; g.lineWidth = 4; g.beginPath(); g.arc(64, 64, 56, 0, TAU); g.stroke();
    g.lineWidth = 2;
    for (let y = 20; y < 110; y += 10) { g.beginPath(); g.moveTo(22, y); g.lineTo(106, y); g.stroke(); }
    speckle(cv, 200, r, [[80, 50, 30]], 0.5, 2, 0.5);
    return toTex(cv.c, { repeat: false });
  },
};

const cache = new Map();
export function getTex(name) {
  let t = cache.get(name);
  if (!t) {
    const f = GEN[name];
    if (!f) throw new Error('Textura desconocida: ' + name);
    t = f();
    cache.set(name, t);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Sprites y texturas especiales
// ---------------------------------------------------------------------------

// Halo radial blanco (se tiñe con el color del material)
export function glowTexture() {
  return memo('glow', () => {
    const cv = mk(128, 128), { g } = cv;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, 'rgba(255,255,255,0.65)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.18)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return toTex(cv.c, { repeat: false });
  });
}

// Charco de luz en el suelo (caída suave)
export function poolTexture() {
  return memo('pool', () => {
    const cv = mk(128, 128), { g } = cv;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.12)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return toTex(cv.c, { repeat: false });
  });
}

// Degradado vertical para el rayo de luz de la caja
export function beamTexture() {
  return memo('beam', () => {
    const cv = mk(64, 256), { g } = cv;
    for (let x = 0; x < 64; x++) {
      const e = Math.sin((x / 63) * Math.PI);
      const gr = g.createLinearGradient(0, 256, 0, 0);
      gr.addColorStop(0, `rgba(255,255,255,${0.9 * e})`);
      gr.addColorStop(0.25, `rgba(255,255,255,${0.45 * e})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, 0, 1, 256);
    }
    const t = toTex(cv.c, { repeat: false });
    t.wrapS = THREE.RepeatWrapping;
    return t;
  });
}

// Luna con cráteres
export function moonTexture() {
  return memo('moon', () => {
    const cv = mk(256, 256), { g } = cv, r = makeRng(401);
    g.clearRect(0, 0, 256, 256);
    const gr = g.createRadialGradient(118, 118, 10, 128, 128, 120);
    gr.addColorStop(0, '#f4f6fa'); gr.addColorStop(0.8, '#d9dee8'); gr.addColorStop(1, '#aab3c4');
    g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 120, 0, TAU); g.fill();
    g.save(); g.beginPath(); g.arc(128, 128, 120, 0, TAU); g.clip();
    for (let k = 0; k < 7; k++) {
      g.fillStyle = `rgba(140,150,168,${0.25 + r() * 0.25})`;
      g.beginPath(); g.ellipse(50 + r() * 160, 50 + r() * 160, 18 + r() * 34, 14 + r() * 26, r() * 3, 0, TAU); g.fill();
    }
    for (let k = 0; k < 40; k++) {
      const x = 20 + r() * 216, y = 20 + r() * 216, rr = 2 + r() * 9;
      g.fillStyle = 'rgba(120,128,145,0.5)'; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.beginPath(); g.arc(x - 0.8, y - 0.8, rr, Math.PI, Math.PI * 1.8); g.stroke();
    }
    g.restore();
    return toTex(cv.c, { repeat: false });
  });
}

export function starTexture() {
  return memo('star', () => {
    const cv = mk(32, 32), { g } = cv;
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return toTex(cv.c, { repeat: false });
  });
}

// Llama (sprite aditivo)
export function flameTexture() {
  return memo('flame', () => {
    const cv = mk(64, 128), { g } = cv;
    g.clearRect(0, 0, 64, 128);
    const layers = [[1.0, 'rgba(255,70,10,0.55)'], [0.72, 'rgba(255,150,30,0.75)'], [0.45, 'rgba(255,225,120,0.9)'], [0.22, 'rgba(255,255,230,1)']];
    for (const [s, col] of layers) {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(32, 128 - 120 * s - 4);
      g.bezierCurveTo(32 + 30 * s, 128 - 70 * s, 32 + 28 * s, 124, 32, 124);
      g.bezierCurveTo(32 - 28 * s, 124, 32 - 30 * s, 128 - 70 * s, 32, 128 - 120 * s - 4);
      g.fill();
    }
    g.globalCompositeOperation = 'destination-in';
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.3, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 128);
    return toTex(cv.c, { repeat: false });
  });
}

// Chispa / anillo de destello
export function ringTexture() {
  return memo('ring', () => {
    const cv = mk(128, 128), { g } = cv;
    const gr = g.createRadialGradient(64, 64, 30, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return toTex(cv.c, { repeat: false });
  });
}

const memoCache = new Map();
function memo(key, f) {
  let v = memoCache.get(key);
  if (!v) { v = f(); memoCache.set(key, v); }
  return v;
}

// ---------------------------------------------------------------------------
// Carteles con texto
// ---------------------------------------------------------------------------
// lines: [{ text, size, color, font, y (0..1), glow, stroke }]
export function makeSign({ w = 512, h = 128, bg = '#1a1a1a', border = null, lines = [], grime = 0.3, seed = 1, rivets = false, emissive = false, draw = null }) {
  const cv = mk(w, h), { g } = cv, r = makeRng(seed);
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); } else g.clearRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = border; g.lineWidth = Math.max(3, h * 0.05);
    g.strokeRect(g.lineWidth, g.lineWidth, w - g.lineWidth * 2, h - g.lineWidth * 2);
  }
  for (const L of lines) {
    const size = Math.round(L.size * h);
    g.font = `${L.weight || 'bold'} ${size}px ${L.font || '"Arial Black", "Arial", sans-serif'}`;
    g.textAlign = L.align || 'center'; g.textBaseline = 'middle';
    const x = L.x != null ? L.x * w : w / 2;
    const y = (L.y != null ? L.y : 0.5) * h;
    if (L.glow) { g.shadowColor = L.glow; g.shadowBlur = size * 0.4; }
    if (L.stroke) { g.strokeStyle = L.stroke; g.lineWidth = Math.max(2, size * 0.08); g.strokeText(L.text, x, y, w * 0.94); }
    g.fillStyle = L.color || '#fff';
    g.fillText(L.text, x, y, w * 0.94);
    if (L.glow) { g.fillText(L.text, x, y, w * 0.94); g.shadowBlur = 0; }
  }
  if (draw) draw(g, w, h);
  if (rivets) {
    g.fillStyle = 'rgba(200,200,200,0.6)';
    for (const [x, y] of [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]]) { g.beginPath(); g.arc(x, y, 4, 0, TAU); g.fill(); }
  }
  if (grime > 0 && !emissive) {
    cloud(cv, 5, r, [20, 16, 12], grime);
    for (let k = 0; k < 6; k++) blot(cv, r() * w, r() * h, 10 + r() * h * 0.4, [15, 12, 10], grime * 0.8);
    grain(cv, 12, r);
  }
  return toTex(cv.c, { repeat: false });
}

// Placa de precio de las puertas
export function doorPriceTexture(cost, kind) {
  return makeSign({
    w: 256, h: 160, bg: kind === 'debris' ? '#5b4630' : '#8a8f96', border: '#2b2b2b', rivets: kind !== 'debris', seed: cost,
    lines: [
      { text: kind === 'debris' ? 'ESCOMBROS' : 'PUERTA', size: 0.16, y: 0.24, color: '#1b1b1b' },
      { text: String(cost), size: 0.42, y: 0.62, color: '#b01414', stroke: '#1b1b1b' },
    ],
    grime: 0.45,
  });
}

// Tablero de salidas de la terminal (emisivo)
export function departureBoardTexture() {
  return memo('departures', () => {
    const cv = mk(512, 256), { g } = cv;
    g.fillStyle = '#050505'; g.fillRect(0, 0, 512, 256);
    g.font = 'bold 34px "Consolas", "Courier New", monospace'; g.textBaseline = 'middle';
    g.fillStyle = '#ffb000'; g.shadowColor = '#ff8800'; g.shadowBlur = 8;
    g.fillText('SALIDAS', 18, 30);
    g.font = 'bold 20px "Consolas", "Courier New", monospace';
    g.fillStyle = '#c98a00'; g.fillText('DESTINO          HORA   ESTADO', 18, 70);
    const rows = [['VILLA OSCURA', '23:40', 'CANCELADO'], ['LA GRANJA', '00:15', 'CANCELADO'], ['PLANTA NORTE', '01:05', 'RETRASADO'], ['CIUDAD NUEVA', '--:--', 'CANCELADO'], ['EL PUENTE', '02:30', 'SIN SERVICIO']];
    rows.forEach((row, i) => {
      g.fillStyle = i === 2 ? '#ff4020' : '#ffb000';
      g.fillText(row[0].padEnd(17, ' ') + row[1] + '  ' + row[2], 18, 104 + i * 30);
    });
    g.shadowBlur = 0;
    for (let y = 0; y < 256; y += 3) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y, 512, 1); }
    return toTex(cv.c, { repeat: false });
  });
}

// Letrero de neón "BAR"
export function neonBarTexture() {
  return memo('neonbar', () => {
    const cv = mk(512, 256), { g } = cv;
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 256);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const tube = (draw, color) => {
      g.save();
      g.strokeStyle = color; g.shadowColor = color;
      for (const [w, b] of [[16, 30], [8, 14], [3, 0]]) { g.lineWidth = w; g.shadowBlur = b; g.strokeStyle = w === 3 ? '#fff' : color; g.beginPath(); draw(); g.stroke(); }
      g.restore();
    };
    g.font = 'bold 150px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [w, b, col] of [[14, 40, '#ff2fa0'], [7, 18, '#ff5ab8'], [2.5, 0, '#ffe6f4']]) {
      g.lineWidth = w; g.shadowBlur = b; g.shadowColor = '#ff2fa0'; g.strokeStyle = col;
      g.strokeText('BAR', 300, 132);
    }
    // copa de cóctel
    tube(() => { g.moveTo(40, 60); g.lineTo(130, 60); g.lineTo(85, 120); g.closePath(); g.moveTo(85, 120); g.lineTo(85, 190); g.moveTo(58, 195); g.lineTo(112, 195); }, '#3ff0ff');
    return toTex(cv.c, { repeat: false });
  });
}

// ---------------------------------------------------------------------------
// Máquinas de ventajas: textura combinada (letrero superior + panel frontal)
// Canvas 512x1024: [0..256] letrero, [256..1024] panel frontal.
// ---------------------------------------------------------------------------
export function perkTexture(key) {
  return memo('perk:' + key, () => {
    const p = PERKS[key] || { name: key, color: '#888888', icon: '??' };
    const cv = mk(512, 1024), { g } = cv, r = makeRng(key.length * 977 + key.charCodeAt(0));
    const col = p.color;
    // Letrero superior
    g.fillStyle = '#0b0b0d'; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = col; g.lineWidth = 10; g.strokeRect(10, 10, 492, 236);
    g.font = 'bold 86px "Arial Black", "Impact", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = col; g.shadowBlur = 26; g.fillStyle = '#ffffff';
    const title = p.name.replace(' Root Beer', '');
    g.fillText(title, 256, 118, 470); g.fillText(title, 256, 118, 470);
    g.shadowBlur = 0;
    g.font = 'bold 30px "Arial", sans-serif'; g.fillStyle = col;
    g.fillText('PERK-A-COLA', 256, 205);
    // Panel frontal
    const y0 = 256;
    const gr = g.createLinearGradient(0, y0, 0, 1024);
    gr.addColorStop(0, col); gr.addColorStop(1, '#111');
    g.fillStyle = gr; g.fillRect(0, y0, 512, 768);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(28, y0 + 28, 456, 712);
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 6; g.strokeRect(28, y0 + 28, 456, 712);
    // Emblema circular
    g.fillStyle = col; g.beginPath(); g.arc(256, y0 + 250, 150, 0, TAU); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 12; g.beginPath(); g.arc(256, y0 + 250, 150, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 4; g.beginPath(); g.arc(256, y0 + 250, 128, 0, TAU); g.stroke();
    g.font = 'bold 130px "Arial Black", "Impact", Arial, sans-serif'; g.fillStyle = '#fff';
    g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 10;
    g.fillText(p.icon, 256, y0 + 258);
    g.shadowBlur = 0;
    // Nombre vertical en franja
    g.font = 'bold 64px "Arial Black", "Impact", Arial, sans-serif'; g.fillStyle = '#fff';
    g.fillText(title.toUpperCase(), 256, y0 + 480, 430);
    g.font = 'bold 28px Arial, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.8)';
    const words = (p.desc || '').split(' ');
    let line = '', ly = y0 + 555;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (g.measureText(test).width > 400) { g.fillText(line, 256, ly); line = w; ly += 34; if (ly > y0 + 700) break; }
      else line = test;
    }
    if (line && ly <= y0 + 700) g.fillText(line, 256, ly);
    cloud(cv, 6, r, [10, 8, 6], 0.35);
    grain(cv, 10, r);
    return toTex(cv.c, { repeat: false });
  });
}

// ---------------------------------------------------------------------------
// Caja misteriosa
// ---------------------------------------------------------------------------
function drawQuestion(g, x, y, size, color, blur) {
  g.save();
  g.font = `bold ${size}px "Arial Black", "Impact", Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = blur; g.fillStyle = color;
  g.fillText('?', x, y); g.fillText('?', x, y);
  g.shadowBlur = 0; g.fillStyle = '#ffffff'; g.globalAlpha = 0.85; g.fillText('?', x, y);
  g.restore();
}

export function boxTexture() {
  return memo('box', () => {
    const cv = mk(512, 256), { g } = cv, r = makeRng(501);
    planks(cv, r, { ph: 51.2, base: [96, 64, 36], vary: 18, grainN: 10, nails: false, joints: false });
    g.fillStyle = '#4a4c52';
    for (const [x, y] of [[0, 0], [472, 0], [0, 216], [472, 216]]) { g.fillRect(x, y, 40, 40); }
    g.fillStyle = '#9aa0a8';
    for (const [x, y] of [[20, 20], [492, 20], [20, 236], [492, 236]]) { g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(10,20,30,0.55)'; g.beginPath(); g.arc(256, 128, 92, 0, TAU); g.fill();
    drawQuestion(g, 256, 136, 170, '#8fd0ff', 30);
    cloud(cv, 5, r, [20, 12, 6], 0.35);
    return toTex(cv.c, { repeat: false });
  });
}
export function boxEmissiveTexture() {
  return memo('box_em', () => {
    const cv = mk(512, 256), { g } = cv;
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 256);
    drawQuestion(g, 256, 136, 170, '#5fb8ff', 34);
    return toTex(cv.c, { repeat: false });
  });
}

// Logotipo del Pack-a-Punch
export function papLogoTexture() {
  return memo('paplogo', () => {
    const cv = mk(512, 160), { g } = cv, r = makeRng(601);
    g.fillStyle = '#16121e'; g.fillRect(0, 0, 512, 160);
    g.strokeStyle = '#b35cff'; g.lineWidth = 6; g.strokeRect(6, 6, 500, 148);
    g.font = 'bold 64px "Arial Black", "Impact", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#b050ff'; g.shadowBlur = 22; g.fillStyle = '#f2dcff';
    g.fillText('PACK-A-PUNCH', 256, 70, 480); g.fillText('PACK-A-PUNCH', 256, 70, 480);
    g.shadowBlur = 0; g.font = 'bold 22px Arial, sans-serif'; g.fillStyle = '#c9a0ff';
    g.fillText('MEJORA DE ARMAMENTO · 5000', 256, 128);
    grain(cv, 8, r);
    return toTex(cv.c, { repeat: false });
  });
}

// ---------------------------------------------------------------------------
// Dibujos de tiza de las armas de pared (atlas)
// Siluetas en una caja de 100 x 40 unidades, cañón hacia la derecha.
// ---------------------------------------------------------------------------
const SIL = {
  pistol: { outline: [[18, 8], [84, 8], [84, 17], [52, 17], [50, 22], [44, 22], [42, 19], [39, 19], [35, 38], [23, 38], [27, 19], [18, 19]], extra: [[[40, 19], [42, 25], [50, 25], [51, 18]]], lines: [[[22, 10], [22, 17]], [[26, 10], [26, 17]]] },
  revolver: { outline: [[10, 11], [86, 11], [86, 16], [48, 16], [48, 21], [42, 23], [38, 21], [33, 38], [19, 36], [25, 21], [18, 19], [10, 17]], circles: [[36, 15, 6]] },
  smg: { outline: [[4, 12], [20, 10], [26, 8], [74, 8], [78, 11], [92, 11], [92, 14], [74, 15], [70, 17], [58, 17], [57, 31], [51, 32], [50, 17], [42, 17], [40, 28], [34, 28], [35, 18], [26, 18], [20, 22], [4, 24]], lines: [[[60, 8], [60, 17]]] },
  rifle: { outline: [[2, 14], [14, 11], [30, 10], [70, 10], [74, 12], [98, 12], [98, 15], [72, 16], [62, 18], [53, 18], [51, 31], [46, 31], [45, 18], [38, 18], [36, 27], [31, 27], [32, 18], [20, 19], [2, 24]], lines: [[[62, 10], [62, 18]]] },
  lmg: { outline: [[2, 14], [14, 11], [30, 9], [72, 9], [76, 12], [98, 12], [98, 15], [74, 16], [60, 17], [38, 18], [36, 28], [31, 28], [32, 18], [20, 19], [2, 24]], rects: [[42, 17, 14, 13]], lines: [[[84, 16], [80, 30]], [[84, 16], [90, 30]]] },
  shotgun: { outline: [[2, 15], [16, 12], [34, 12], [36, 10], [96, 10], [96, 14], [60, 15], [60, 18], [40, 18], [36, 27], [31, 27], [32, 18], [18, 19], [2, 25]], rects: [[62, 15, 16, 5]] },
  doublebarrel: { outline: [[2, 17], [22, 13], [40, 11], [96, 9], [96, 16], [40, 17], [26, 21], [2, 27]], lines: [[[40, 13], [96, 12.5]]] },
  sniper: { outline: [[2, 15], [14, 12], [30, 11], [72, 11], [76, 13], [99, 13], [99, 15.5], [72, 16], [60, 18], [52, 18], [50, 26], [45, 26], [45, 18], [38, 18], [36, 27], [31, 27], [32, 18], [20, 19], [2, 25]], rects: [[40, 4, 26, 5]], lines: [[[46, 9], [46, 11]], [[60, 9], [60, 11]]] },
  raygun: { outline: [[20, 13], [28, 6], [58, 6], [62, 10], [80, 10], [84, 7], [90, 12], [84, 17], [80, 14], [62, 14], [58, 18], [46, 18], [44, 34], [34, 34], [36, 18], [26, 18]], lines: [[[66, 9], [66, 15]], [[71, 9], [71, 15]], [[76, 9], [76, 15]]] },
  raygun2: { outline: [[14, 12], [24, 7], [70, 7], [74, 10], [92, 10], [92, 15], [74, 15], [70, 18], [48, 18], [46, 34], [36, 34], [38, 18], [24, 18]], circles: [[30, 12, 3.5]] },
  launcher: { outline: [[2, 14], [18, 12], [30, 12], [30, 8], [66, 8], [66, 12], [96, 12], [96, 17], [66, 17], [66, 22], [44, 22], [42, 32], [36, 32], [37, 22], [30, 22], [30, 18], [18, 18], [2, 22]], circles: [[48, 15, 8]] },
  knife: { outline: [[22, 18], [70, 15], [88, 19], [70, 23], [22, 22]], rects: [[18, 13, 4, 14], [0, 17, 18, 6]] },
  bat: { outline: [[4, 18], [40, 17], [70, 14], [94, 13], [98, 20], [94, 27], [70, 26], [40, 23], [4, 22]], rects: [[0, 16, 4, 8]],
    lines: [[[74, 12], [74, 8]], [[82, 11], [83, 7]], [[88, 28], [89, 32]], [[78, 27], [77, 31]]] },
  machete: { outline: [[2, 17], [22, 16], [24, 12], [27, 12], [27, 15], [84, 13], [98, 19], [88, 25], [27, 25], [27, 28], [24, 28], [22, 24], [2, 23]],
    lines: [[[30, 15], [84, 15]]] },
  axe: { outline: [[2, 18], [72, 17], [72, 23], [2, 22]], rects: [[68, 4, 14, 32]], lines: [[[82, 4], [88, 8], [88, 32], [82, 36]]] },
};

function chalkPath(g, pts, closed, r, sx, sy, ox, oy, passes = 3, width = 3) {
  for (let p = 0; p < passes; p++) {
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const px = ox + x * sx + (r() - 0.5) * 2.2, py = oy + y * sy + (r() - 0.5) * 2.2;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    });
    if (closed) g.closePath();
    g.lineWidth = width * (0.6 + r() * 0.6);
    g.strokeStyle = `rgba(245,245,240,${0.35 + r() * 0.3})`;
    g.stroke();
  }
}

function chalkText(g, text, x, y, size, r, maxW) {
  g.font = `bold ${size}px "Segoe Print", "Bradley Hand", "Comic Sans MS", "Arial", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let p = 0; p < 4; p++) {
    g.fillStyle = `rgba(245,245,238,${0.3 + r() * 0.25})`;
    g.fillText(text, x + (r() - 0.5) * 2.5, y + (r() - 0.5) * 2.5, maxW);
  }
}

// Dibuja un arma de tiza en una celda del atlas
function drawChalkCell(g, x0, y0, cw, ch, weaponKey, r) {
  const def = WEAPONS[weaponKey] || {};
  const sil = SIL[def.model] || SIL.rifle;
  const sx = (cw * 0.86) / 100, sy = sx;
  const ox = x0 + cw * 0.07, oy = y0 + ch * 0.08;
  // relleno rayado dentro de la silueta
  g.save();
  g.beginPath();
  sil.outline.forEach(([x, y], i) => { const px = ox + x * sx, py = oy + y * sy; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); });
  g.closePath();
  for (const [x, y, w, h] of (sil.rects || [])) g.rect(ox + x * sx, oy + y * sy, w * sx, h * sy);
  for (const [cx, cy, cr] of (sil.circles || [])) { g.moveTo(ox + (cx + cr) * sx, oy + cy * sy); g.arc(ox + cx * sx, oy + cy * sy, cr * sx, 0, TAU); }
  g.clip('nonzero');
  g.lineWidth = 1.6;
  for (let k = -ch; k < cw + ch; k += 7) {
    g.strokeStyle = `rgba(240,240,235,${0.12 + r() * 0.14})`;
    g.beginPath(); g.moveTo(x0 + k, y0 + ch); g.lineTo(x0 + k + ch * 0.9 + (r() - 0.5) * 6, y0); g.stroke();
  }
  g.restore();
  // contornos
  chalkPath(g, sil.outline, true, r, sx, sy, ox, oy, 3, 3.2);
  for (const [x, y, w, h] of (sil.rects || [])) chalkPath(g, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, r, sx, sy, ox, oy, 2, 2.6);
  for (const [cx, cy, cr] of (sil.circles || [])) {
    const pts = []; for (let a = 0; a <= 16; a++) pts.push([cx + Math.cos(a / 16 * TAU) * cr, cy + Math.sin(a / 16 * TAU) * cr]);
    chalkPath(g, pts, true, r, sx, sy, ox, oy, 2, 2.4);
  }
  for (const ln of (sil.lines || [])) chalkPath(g, ln, false, r, sx, sy, ox, oy, 2, 2);
  for (const ln of (sil.extra || [])) chalkPath(g, ln, false, r, sx, sy, ox, oy, 2, 2.2);
  // nombre y precio
  const name = weaponName(weaponKey, false);
  chalkText(g, name, x0 + cw / 2, y0 + ch * 0.8, Math.round(ch * 0.15), r, cw * 0.92);
  if (def.price) chalkText(g, String(def.price), x0 + cw / 2, y0 + ch * 0.94, Math.round(ch * 0.1), r, cw * 0.5);
}

// Atlas de tiza: devuelve { texture, rects: { [id]: {u0,v0,u1,v1} } }
export function chalkAtlas(entries) {
  const cols = 2, rows = Math.max(1, Math.ceil(entries.length / cols));
  const cw = 512, ch = 256;
  const cv = mk(cw * cols, ch * rows), { g } = cv;
  g.clearRect(0, 0, cv.w, cv.h);
  const rects = {};
  entries.forEach((e, i) => {
    const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch;
    drawChalkCell(g, cx, cy, cw, ch, e.weapon, makeRng(1000 + i * 31));
    // uv con flipY: v = 1 - y/H
    rects[e.id] = { u0: cx / cv.w, u1: (cx + cw) / cv.w, v0: 1 - (cy + ch) / cv.h, v1: 1 - cy / cv.h };
  });
  // borrado aleatorio para el grano de tiza
  const r = makeRng(77);
  g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < cv.w * cv.h / 60; k++) {
    g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.6})`;
    g.fillRect(r() * cv.w, r() * cv.h, 1 + r() * 2, 1 + r() * 2);
  }
  g.globalCompositeOperation = 'source-over';
  return { texture: toTex(cv.c, { repeat: false }), rects };
}

// Póster / cartel genérico pequeño
export function posterTexture(kind) {
  return memo('poster:' + kind, () => {
    switch (kind) {
      case 'voltage':
        return makeSign({ w: 256, h: 256, bg: '#d9b21a', border: '#111', seed: 9, grime: 0.4, lines: [
          { text: 'PELIGRO', size: 0.2, y: 0.18, color: '#111' },
          { text: 'ALTO VOLTAJE', size: 0.13, y: 0.85, color: '#111' }],
          draw: (g) => {
            g.fillStyle = '#111';
            g.beginPath(); g.moveTo(140, 70); g.lineTo(96, 136); g.lineTo(126, 136); g.lineTo(108, 190); g.lineTo(162, 116); g.lineTo(130, 116); g.lineTo(150, 70); g.closePath(); g.fill();
          } });
      case 'exit':
        return makeSign({ w: 256, h: 96, bg: '#0c7a2e', border: '#e8ffe8', seed: 3, grime: 0, emissive: true, lines: [{ text: 'SALIDA', size: 0.6, y: 0.54, color: '#eaffea' }] });
      case 'route':
        return makeSign({ w: 256, h: 256, bg: '#d8d2c0', border: '#333', seed: 5, grime: 0.55, lines: [
          { text: 'RUTAS', size: 0.14, y: 0.12, color: '#123a7a' },
          { text: 'LÍNEA 115 · PUEBLO', size: 0.07, y: 0.3, color: '#222' },
          { text: 'LÍNEA 935 · GRANJA', size: 0.07, y: 0.42, color: '#222' },
          { text: 'LÍNEA 22 · PLANTA', size: 0.07, y: 0.54, color: '#222' },
          { text: 'SERVICIO', size: 0.1, y: 0.74, color: '#9a1010' },
          { text: 'SUSPENDIDO', size: 0.1, y: 0.86, color: '#9a1010' }] });
      case 'nosmoke':
        return makeSign({ w: 256, h: 128, bg: '#e8e2d0', border: '#a01010', seed: 7, grime: 0.5, lines: [{ text: 'PROHIBIDO FUMAR', size: 0.2, y: 0.52, color: '#a01010' }] });
      case 'terminal':
        return makeSign({ w: 1024, h: 160, bg: '#1d2f55', border: '#c9d4e8', seed: 11, grime: 0.45, lines: [{ text: 'TERMINAL DE AUTOBUSES', size: 0.5, y: 0.54, color: '#f2f2f2' }] });
      case 'almacen':
        return makeSign({ w: 512, h: 128, bg: '#6b2a1f', border: '#e0c9a0', seed: 13, grime: 0.5, lines: [{ text: 'ALMACÉN 3', size: 0.55, y: 0.54, color: '#f0e2c0' }] });
      case 'planta':
        return makeSign({ w: 1024, h: 160, bg: '#2b2d2f', border: '#d9b21a', seed: 17, grime: 0.5, lines: [{ text: 'PLANTA ELÉCTRICA', size: 0.5, y: 0.54, color: '#d9b21a' }] });
      case 'tranzit':
        return makeSign({ w: 512, h: 96, bg: '#060606', seed: 19, grime: 0, emissive: true, lines: [{ text: 'FUERA DE SERVICIO', size: 0.55, y: 0.54, color: '#ffae1a', glow: '#ff8800', font: '"Consolas", "Courier New", monospace' }] });
      case 'hotel':
        return makeSign({ w: 512, h: 128, bg: '#3a3f2a', border: '#c8c0a0', seed: 23, grime: 0.55, lines: [{ text: 'HOTEL', size: 0.6, y: 0.54, color: '#efe6c8' }] });
      case 'farmacia':
        return makeSign({ w: 512, h: 128, bg: '#1e4a3a', border: '#cfe', seed: 29, grime: 0.55, lines: [{ text: 'FARMACIA', size: 0.55, y: 0.54, color: '#e8fff0' }] });
      case 'clock':
      default: {
        const cv = mk(128, 128), { g } = cv;
        g.fillStyle = '#e8e2d0'; g.beginPath(); g.arc(64, 64, 60, 0, TAU); g.fill();
        g.strokeStyle = '#222'; g.lineWidth = 5; g.beginPath(); g.arc(64, 64, 58, 0, TAU); g.stroke();
        for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; g.lineWidth = 3; g.beginPath(); g.moveTo(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46); g.lineTo(64 + Math.cos(a) * 54, 64 + Math.sin(a) * 54); g.stroke(); }
        g.lineWidth = 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + 26, 64 - 18); g.stroke();
        g.lineWidth = 3; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 - 8, 64 - 44); g.stroke();
        return toTex(cv.c, { repeat: false });
      }
    }
  });
}
