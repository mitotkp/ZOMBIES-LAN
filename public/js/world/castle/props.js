// Mobiliario y decoración del castillo: cada tipo de obstáculo del mapa (shared/maps/castillo.js, props.kind) tiene
// su modelo, y además lámparas de araña, farolas de gas, chimeneas, retratos, alfombras y tapices.
// Todo lo estático va al StaticBatch; las llamas usan world.flames.
import * as THREE from 'three';
import { MAP, DIRS } from '/shared/map.js';
import { yawForFace, makeGlow } from '../kit.js';
import { makeRng } from '../textures.js';

const TAU = Math.PI * 2;
const rectOf = (p) => ({
  cx: (p.x0 + p.x1 + 1) / 2, cz: (p.z0 + p.z1 + 1) / 2,
  lx: p.x1 - p.x0 + 1, lz: p.z1 - p.z0 + 1, y: MAP.baseY(p.lv || 0),
});

// ------------------------------------------------------------------ texturas propias (retratos, reloj)
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function portraitTexture(seed) {
  const r = makeRng(seed);
  return canvasTex(128, 160, (g, w, h) => {
    const bg = g.createRadialGradient(64, 60, 10, 64, 80, 110);
    bg.addColorStop(0, ['#3a2a1c', '#1c2a24', '#2a1c24'][seed % 3]); bg.addColorStop(1, '#080605');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    // busto: hombros y cabeza de un antepasado de mirada severa
    g.fillStyle = ['#1a1612', '#2a0e10', '#101820'][Math.floor(r() * 3)];
    g.beginPath(); g.ellipse(64, 150, 58, 46, 0, 0, TAU); g.fill();
    g.fillStyle = '#c8b8a0';
    g.beginPath(); g.moveTo(52, 116); g.lineTo(76, 116); g.lineTo(70, 132); g.lineTo(58, 132); g.fill();   // cuello
    g.fillStyle = '#d6c2a4';
    g.beginPath(); g.ellipse(64, 78, 21, 27, 0, 0, TAU); g.fill();
    g.fillStyle = ['#2a1a10', '#8a8478', '#1a1410', '#5a3a1c'][Math.floor(r() * 4)];
    g.beginPath(); g.ellipse(64, 60, 23, 15, 0, Math.PI, TAU); g.fill();                                  // pelo
    if (r() < 0.5) { g.beginPath(); g.ellipse(64, 98, 12, 7, 0, 0, Math.PI); g.fill(); }                  // barba
    g.fillStyle = '#1a0a08';
    for (const s of [-1, 1]) { g.beginPath(); g.arc(64 + s * 8, 76, 2.2, 0, TAU); g.fill(); }
    // barniz agrietado
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.6;
    for (let k = 0; k < 40; k++) { const x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 12, y + (r() - 0.5) * 12); g.stroke(); }
  });
}
function clockTexture() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#d8ccb0'; g.beginPath(); g.arc(128, 128, 124, 0, TAU); g.fill();
    g.strokeStyle = '#2a1c10'; g.lineWidth = 8; g.stroke();
    g.fillStyle = '#1a120a'; g.font = 'bold 26px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const R = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU - Math.PI / 2; g.fillText(R[i], 128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96); }
    g.lineWidth = 7; g.beginPath(); g.moveTo(128, 128); g.lineTo(128, 60); g.stroke();
    g.lineWidth = 4; g.beginPath(); g.moveTo(128, 128); g.lineTo(186, 150); g.stroke();
  });
}

// ------------------------------------------------------------------ modelos por tipo
function fountain(B, p) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  const R = Math.min(lx, lz) / 2;
  P.cyl('c_ashlar', R, R + 0.1, 0.6, 0, 0.3, 0, { seg: 24, color: 0xb0aa9e });
  P.cyl('c_liquid', R - 0.15, R - 0.15, 0.04, 0, 0.55, 0, { seg: 24, color: 0x1a3040 });
  P.cyl('c_ashlar', 0.35, 0.5, 1.4, 0, 1.1, 0, { seg: 12, color: 0xb8b2a6 });
  P.cyl('c_ashlar', 1.1, 0.3, 0.3, 0, 1.9, 0, { seg: 16, color: 0xb8b2a6 });
  P.cyl('c_ashlar', 0.15, 0.25, 0.9, 0, 2.5, 0, { seg: 10, color: 0xb8b2a6 });
  P.sphere('c_ashlar', 0.28, 0, 3.05, 0, { seg: 10, color: 0xb8b2a6 });
  for (let k = 0; k < 4; k++) {       // gárgolas en el borde
    const a = k * TAU / 4 + TAU / 8;
    P.box('c_ashlar_dark', 0.35, 0.35, 0.5, Math.cos(a) * (R - 0.1), 0.75, Math.sin(a) * (R - 0.1), { ry: -a });
  }
}
function hedge(B, p) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  P.box('c_hedge', lx - 0.1, p.h, lz - 0.1, 0, p.h / 2, 0, {});
  P.box('c_hedge', lx - 0.3, 0.2, lz - 0.3, 0, p.h + 0.08, 0, { color: 0xc0d0b0 });
}
function statue(B, p, r) {
  const { cx, cz, y } = rectOf(p);
  const P = B.at(cx, y, cz, r() * TAU);
  P.box('c_ashlar', 0.9, 1.0, 0.9, 0, 0.5, 0, { color: 0xa8a296 });
  P.box('c_ashlar', 1.0, 0.1, 1.0, 0, 1.05, 0, { color: 0xb8b2a6 });
  // ángel lloroso con alas
  P.cyl('c_marble_w', 0.18, 0.32, 1.1, 0, 1.65, 0, { seg: 10 });
  P.sphere('c_marble_w', 0.15, 0, 2.35, 0.02, { seg: 10 });
  P.box('c_marble_w', 0.1, 0.5, 0.1, 0.12, 2.0, -0.15, { rx: -0.8 });
  P.box('c_marble_w', 0.1, 0.5, 0.1, -0.12, 2.0, -0.15, { rx: -0.8 });
  for (const s of [-1, 1]) P.box('c_marble_w', 0.06, 0.9, 0.45, s * 0.25, 2.1, 0.2, { rz: s * 0.35, ry: s * 0.4 });
}
function benchIron(B, p) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const along = lx >= lz;
  const P = B.at(cx, y, cz, along ? 0 : Math.PI / 2);
  const L = Math.max(lx, lz) - 0.2;
  for (let k = 0; k < 5; k++) P.box('c_darkwood', L, 0.04, 0.09, 0, 0.45, -0.2 + k * 0.1, { color: 0x6a4a34 });
  for (let k = 0; k < 3; k++) P.box('c_darkwood', L, 0.09, 0.04, 0, 0.62 + k * 0.12, 0.26, { color: 0x6a4a34, rx: -0.2 });
  for (const s of [-1, 1]) {
    P.box('c_iron', 0.05, 0.45, 0.5, s * (L / 2 - 0.1), 0.22, 0, {});
    P.torus('c_iron', 0.18, 0.02, s * (L / 2 - 0.1), 0.75, 0.2, { ry: Math.PI / 2, seg: 10 });
  }
}
function carriage(B, p, r, flames) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0.3);
  P.box('c_iron', lx - 0.6, 1.3, lz - 0.8, 0, 1.2, 0, { color: 0x1a1a22 });
  P.box('c_iron', lx - 0.4, 0.12, lz - 0.6, 0, 1.9, 0, { color: 0x14141a });
  P.box('glass', 0.02, 0.5, 0.6, (lx - 0.6) / 2, 1.35, 0, {});
  P.box('glass', 0.02, 0.5, 0.6, -(lx - 0.6) / 2, 1.35, 0, {});
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    P.torus('c_darkwood', 0.45, 0.05, x * (lx / 2 - 0.7), 0.45, z * (lz / 2 - 0.3), { seg: 16, color: 0x3a2414 });
    P.cyl('c_iron', 0.06, 0.06, 0.1, x * (lx / 2 - 0.7), 0.45, z * (lz / 2 - 0.3), { rx: Math.PI / 2, seg: 8 });
  }
  P.cyl('c_lamp', 0.07, 0.07, 0.18, (lx - 0.6) / 2, 2.0, -0.6, { seg: 8 });
  void flames;
}
function armor(B, p) {
  const { cx, cz, y } = rectOf(p);
  const P = B.at(cx, y, cz, Math.PI);
  P.box('c_darkwood', 0.7, 0.2, 0.6, 0, 0.1, 0, {});
  P.cyl('chrome', 0.1, 0.1, 0.8, -0.12, 0.6, 0, { seg: 8 });
  P.cyl('chrome', 0.1, 0.1, 0.8, 0.12, 0.6, 0, { seg: 8 });
  P.cyl('chrome', 0.26, 0.2, 0.7, 0, 1.35, 0, { seg: 10 });
  P.sphere('chrome', 0.16, 0, 1.85, 0, { seg: 10, sy: 1.2 });
  for (const s of [-1, 1]) P.cyl('chrome', 0.07, 0.07, 0.7, s * 0.33, 1.3, 0, { seg: 8 });
  P.box('chrome', 0.03, 1.8, 0.03, 0.42, 1.1, 0, {});          // alabarda
  P.box('chrome', 0.02, 0.3, 0.22, 0.42, 1.95, 0, {});
}
function shelf(B, p, r) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const along = lx >= lz;
  const P = B.at(cx, y, cz, along ? 0 : Math.PI / 2);
  const L = Math.max(lx, lz), D = Math.min(lx, lz) * 0.8;
  P.box('c_darkwood', L, p.h, D, 0, p.h / 2, 0, { color: 0x4a2e1c });
  for (let sh = 0; sh < 5; sh++) {
    const yy = 0.25 + sh * 0.48;
    for (const side of [-1, 1]) {
      let x = -L / 2 + 0.1;
      while (x < L / 2 - 0.1) {
        const bw = 0.04 + r() * 0.05, bh = 0.26 + r() * 0.14;
        const col = [0x6a1a14, 0x1a3a24, 0x2a2440, 0x5a4a20, 0x3a2410][Math.floor(r() * 5)];
        // solo el lomo (plano): la caja entera eran 12 triángulos por libro y miles de libros
        P.geo('c_leather', new THREE.PlaneGeometry(bw, bh), x + bw / 2, yy + bh / 2, side * (D / 2 + 0.12), { color: col, ry: side < 0 ? Math.PI : 0, rz: r() < 0.08 ? 0.3 : 0 });
        x += bw + 0.005;
      }
    }
  }
}
function table(B, p, r, cloth) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  const top = p.h;
  P.box(cloth ? 'c_linen' : 'c_darkwood', lx - 0.2, 0.06, lz - 0.2, 0, top, 0, { color: cloth ? 0xd8d0bc : 0x5a3a24 });
  if (cloth) P.box('c_linen', lx - 0.1, 0.4, lz - 0.1, 0, top - 0.2, 0, { color: 0xc8c0aa });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.cyl('c_darkwood', 0.05, 0.035, top, sx * (lx / 2 - 0.3), top / 2, sz * (lz / 2 - 0.3), { seg: 6, color: 0x3a2414 });
  return P;
}
function dining(B, p, r, flames) {
  const P = table(B, p, r, true);
  const { cx, cz, lx, lz, y } = rectOf(p);
  // vajilla, candelabros y sillas
  for (let x = -lx / 2 + 1; x <= lx / 2 - 1; x += 1.2) {
    for (const s of [-1, 1]) {
      P.cyl('c_marble_w', 0.14, 0.14, 0.02, x, p.h + 0.04, s * (lz / 2 - 0.55), { seg: 12 });
      P.box('c_darkwood', 0.45, 0.06, 0.45, x, 0.48, s * (lz / 2 + 0.25), { color: 0x4a2e1c });
      P.box('c_darkwood', 0.45, 0.7, 0.05, x, 0.85, s * (lz / 2 + 0.45), { color: 0x4a2e1c });
      P.box('c_velvet', 0.4, 0.05, 0.4, x, 0.53, s * (lz / 2 + 0.25), {});
    }
  }
  for (const x of [-lx / 4, lx / 4]) {
    P.cyl('c_brass', 0.08, 0.12, 0.5, x, p.h + 0.28, 0, { seg: 8 });
    for (const s of [-1, 0, 1]) {
      P.cyl('c_candle', 0.02, 0.02, 0.15, x + s * 0.15, p.h + 0.6, 0, { seg: 6 });
      if (flames && s === 0) flames.add(cx + x, y + p.h + 0.68, cz, 0.18);
    }
  }
}
function sideboard(B, p) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  P.box('c_darkwood', lx - 0.1, p.h, lz * 0.7, 0, p.h / 2, 0, { color: 0x4a2e1c });
  for (let k = 0; k < 4; k++) P.box('c_brass', 0.08, 0.03, 0.03, -lx / 2 + 0.7 + k * (lx - 1.4) / 3, p.h * 0.7, lz * 0.36, {});
  for (let k = 0; k < 3; k++) P.cyl('c_marble_w', 0.08, 0.1, 0.3, -1 + k, p.h + 0.15, 0, { seg: 8 });
}
function stove(B, p, r, flames) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  P.box('c_iron', lx - 0.1, p.h, lz, 0, p.h / 2, 0, { color: 0x1a1a1a });
  for (let k = 0; k < 4; k++) P.cyl('c_iron', 0.2, 0.2, 0.04, -lx / 2 + 0.6 + k * 1.1, p.h + 0.02, 0, { seg: 12, color: 0x333333 });
  P.cyl('c_iron', 0.2, 0.25, 0.4, 1, p.h + 0.2, 0, { seg: 10, color: 0x5a5a5a });   // olla
  P.box('c_ashlar_dark', lx + 0.4, 2.0, 0.6, 0, p.h + 1.6, -0.2, {});                // campana
  if (flames) flames.add(cx - 0.5, y + 0.3, cz + 0.4, 0.35);
}
function worktable(B, p, r) {
  const P = table(B, p, r, false);
  const { lx } = rectOf(p);
  for (let k = 0; k < 5; k++) P.box('c_darkwood', 0.3, 0.05, 0.2, -lx / 2 + 0.6 + k * 0.9, p.h + 0.05, (r() - 0.5) * 0.6, { color: 0x8a6a48, ry: r() });
  P.box('chrome', 0.03, 0.02, 0.35, 0.4, p.h + 0.04, 0, { ry: 0.6 });   // cuchillo de carnicero
}
function piano(B, p) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const P = B.at(cx, y, cz, Math.PI / 2);
  P.box('c_iron', lz - 0.2, 0.3, lx - 0.4, 0, 0.9, 0, { color: 0x080808 });
  P.box('c_iron', lz - 0.2, 0.02, 0.2, 0, 1.06, -(lx - 0.4) / 2 + 0.1, { color: 0xeeeeea });
  P.box('c_iron', lz - 0.4, 0.7, 0.04, 0.1, 1.4, 0.2, { color: 0x080808, rx: -0.6 });   // tapa abierta
  for (const [x, z] of [[-0.7, -0.8], [0.7, -0.8], [0, 0.9]]) P.cyl('c_iron', 0.05, 0.04, 0.75, x, 0.37, z, { seg: 6, color: 0x080808 });
}
function harp(B, p) {
  const { cx, cz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0.7);
  P.box('c_brass', 0.4, 0.15, 0.3, 0, 0.08, 0, {});
  P.box('c_brass', 0.08, 1.8, 0.08, 0.15, 0.95, 0, { rz: 0.1 });
  P.box('c_brass', 0.6, 0.08, 0.08, -0.1, 1.8, 0, { rz: -0.4 });
  for (let k = 0; k < 10; k++) P.box('chrome', 0.005, 1.4 - k * 0.1, 0.005, 0.1 - k * 0.04, 0.95 + k * 0.03, 0, {});
}
function planter(B, p, r) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  P.box('c_ashlar', lx - 0.1, p.h, lz - 0.1, 0, p.h / 2, 0, { color: 0x9a8a78 });
  P.box('floor_dirt', lx - 0.3, 0.05, lz - 0.3, 0, p.h + 0.01, 0, { color: 0x4a3a2a });
  for (let k = 0; k < lx * lz * 2; k++) {
    const x = (r() - 0.5) * (lx - 0.5), z = (r() - 0.5) * (lz - 0.5);
    P.sphere('c_hedge', 0.2 + r() * 0.3, x, p.h + 0.25, z, { seg: 6, color: r() < 0.3 ? 0x6a4a3a : 0xffffff });   // plantas muertas y alguna viva
  }
}
function bed(B, p) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  P.box('c_darkwood', lx - 0.2, 0.35, lz - 0.2, 0, 0.3, 0, { color: 0x3a2414 });
  P.box('c_linen', lx - 0.3, 0.2, lz - 0.3, 0, 0.55, 0, { color: 0xb0a890 });
  P.box('c_velvet', lx - 0.3, 0.05, (lz - 0.3) * 0.6, 0, 0.67, 0.25, {});
  P.box('c_linen', 0.9, 0.12, 0.4, 0, 0.72, -(lz / 2 - 0.45), {});
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.cyl('c_darkwood', 0.05, 0.05, 2.2, sx * (lx / 2 - 0.15), 1.1, sz * (lz / 2 - 0.15), { seg: 6, color: 0x3a2414 });
  P.box('c_velvet', lx - 0.2, 0.3, lz - 0.2, 0, 2.2, 0, { color: 0x4a0a10 });   // dosel
}
function wardrobe(B, p) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  P.box('c_darkwood', lx - 0.1, p.h, lz * 0.7, 0, p.h / 2, 0, { color: 0x3a2414 });
  P.box('c_darkwood', lx, 0.15, lz * 0.8, 0, p.h + 0.05, 0, { color: 0x2a1a0e });
  for (const s of [-1, 1]) P.sphere('c_brass', 0.04, s * 0.1, p.h * 0.5, -lz * 0.36, { seg: 6 });
}
function globe(B, p) {
  const { cx, cz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  P.cyl('c_darkwood', 0.3, 0.35, 0.7, 0, 0.35, 0, { seg: 10, color: 0x4a2e1c });
  P.sphere('c_leather', 0.35, 0, 1.0, 0, { seg: 14, color: 0x8a7a4a });
  P.torus('c_brass', 0.4, 0.015, 0, 1.0, 0, { ry: 0.3, seg: 20 });
}
function cabinet(B, p) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  P.box('c_darkwood', lx - 0.1, p.h, lz * 0.8, 0, p.h / 2, 0, { color: 0x3a2414 });
  P.box('glass', lx - 0.3, p.h - 0.4, 0.02, 0, p.h / 2, lz * 0.41, {});
  for (let k = 0; k < 3; k++) P.sphere('c_marble_w', 0.1, -0.4 + k * 0.4, 0.8 + k * 0.4, 0, { seg: 8 });   // cráneos de colección
}
function pillar(B, p) {
  const { cx, cz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  P.box('c_marble_w', 1.0, 0.4, 1.0, 0, 0.2, 0, {});
  P.cyl('c_marble_w', 0.38, 0.42, p.h - 0.8, 0, (p.h - 0.8) / 2 + 0.4, 0, { seg: 16 });
  P.box('c_marble_w', 1.0, 0.4, 1.0, 0, p.h - 0.2, 0, {});
  P.torus('c_brass', 0.42, 0.03, 0, 0.45, 0, { rx: Math.PI / 2, seg: 20 });
}
function tube(B, p) {
  const { cx, cz, lx, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  const R = lx / 2 - 0.15;
  P.cyl('c_iron', R + 0.15, R + 0.2, 0.4, 0, 0.2, 0, { seg: 16, color: 0x2a2e30 });
  P.cyl('c_iron', R + 0.15, R + 0.1, 0.4, 0, p.h - 0.2, 0, { seg: 16, color: 0x2a2e30 });
  P.cyl('c_liquid', R - 0.02, R - 0.02, p.h - 0.85, 0, p.h / 2, 0, { seg: 16, open: true });
  P.cyl('c_tubeglass', R, R, p.h - 0.8, 0, p.h / 2, 0, { seg: 16, open: true });
  for (let k = 0; k < 4; k++) {
    const a = k * TAU / 4;
    P.box('c_iron', 0.06, p.h - 0.8, 0.06, Math.cos(a) * (R + 0.05), p.h / 2, Math.sin(a) * (R + 0.05), { color: 0x3a3e40 });
  }
  // cables hacia el techo
  P.rod('rubber', [0, p.h, 0], [0.3, 4.4, 0.2], 0.04);
  P.rod('rubber', [0.2, p.h, -0.1], [-0.4, 4.4, -0.3], 0.03);
}
function consoleProp(B, p, r) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const along = lx >= lz;
  const P = B.at(cx, y, cz, along ? 0 : Math.PI / 2);
  const L = Math.max(lx, lz);
  P.box('c_iron', L - 0.1, p.h, 0.8, 0, p.h / 2, 0, { color: 0x3a3e38 });
  P.box('c_iron', L - 0.1, 0.1, 0.9, 0, p.h + 0.02, 0, { color: 0x2a2e28, rx: -0.2 });
  for (let x = -L / 2 + 0.6; x < L / 2 - 0.3; x += 1.1) {
    for (const s of [-1, 1]) {
      P.box('c_iron', 0.75, 0.55, 0.3, x, p.h + 0.4, s * 0.1, { color: 0x4a4e48 });
      P.box('c_screen', 0.6, 0.42, 0.02, x, p.h + 0.4, s * 0.26, { color: r() < 0.3 ? 0x3a0a08 : undefined });
    }
    for (let k = 0; k < 6; k++) P.cyl('c_brass', 0.025, 0.025, 0.04, x - 0.3 + k * 0.12, p.h + 0.09, 0.3, { seg: 6 });
  }
}
function centrifuge(B, p) {
  const { cx, cz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  P.cyl('c_iron', 0.9, 1.0, 0.5, 0, 0.25, 0, { seg: 20, color: 0x3a3e40 });
  P.cyl('c_iron', 0.75, 0.75, 0.9, 0, 0.95, 0, { seg: 20, color: 0x5a5e60 });
  P.cyl('c_tubeglass', 0.72, 0.72, 0.8, 0, 0.98, 0, { seg: 20 });
  P.cyl('c_brass', 0.9, 0.9, 0.08, 0, 1.44, 0, { seg: 20 });
  for (let k = 0; k < 4; k++) {
    const a = k * TAU / 4;
    P.cyl('c_liquid', 0.07, 0.07, 0.5, Math.cos(a) * 0.45, 1.0, Math.sin(a) * 0.45, { seg: 8, color: 0x3a0808 });   // ranuras de los viales
  }
}
function sarcophagus(B, p, r) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  P.box('c_ashlar_dark', lx - 0.2, 0.8, lz - 0.2, 0, 0.4, 0, {});
  P.box('c_ashlar', lx - 0.1, 0.15, lz - 0.1, 0, 0.85, r() * 0.3, { ry: (r() - 0.5) * 0.2, color: 0x8a8478 });
  P.box('c_ashlar', 0.3, 0.2, lz * 0.6, 0, 1.0, 0, { color: 0x8a8478 });   // efigie
  P.sphere('c_ashlar', 0.14, 0, 1.08, -lz * 0.35, { seg: 8, color: 0x8a8478 });
}
function barrels(B, p, r) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  for (let x = -lx / 2 + 0.5; x <= lx / 2 - 0.4; x += 0.95) {
    for (let z = -lz / 2 + 0.5; z <= lz / 2 - 0.4; z += 0.95) {
      P.cyl('c_darkwood', 0.38, 0.38, 1.1, x, 0.55, z, { seg: 12, color: 0x6a4a2a });
      for (const yy of [0.2, 0.9]) P.torus('c_iron', 0.39, 0.02, x, yy, z, { rx: Math.PI / 2, seg: 16 });
    }
  }
  P.cyl('c_darkwood', 0.38, 0.38, 1.1, 0, 1.45, 0, { seg: 12, color: 0x6a4a2a, rz: Math.PI / 2 });
}
function winerack(B, p, r) {
  const { cx, cz, lx, lz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  P.box('c_darkwood', lx * 0.8, p.h, lz - 0.1, 0, p.h / 2, 0, { color: 0x3a2414 });
  for (let k = 0; k < 40; k++) {
    const zz = -lz / 2 + 0.2 + r() * (lz - 0.4), yy = 0.2 + r() * (p.h - 0.4);
    P.cyl('glass', 0.035, 0.035, 0.2, -lx * 0.41, yy, zz, { rz: Math.PI / 2, seg: 6, color: 0x1a3a1a });
  }
}
function clockwork(B, p, r) {
  const { cx, cz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  P.box('c_iron', 1.6, 0.4, 1.6, 0, 0.2, 0, { color: 0x2a2620 });
  for (let k = 0; k < 4; k++) {
    P.torus('c_brass', 0.3 + r() * 0.4, 0.06, (r() - 0.5) * 0.6, 0.8 + k * 0.45, (r() - 0.5) * 0.6, { ry: r() * TAU, seg: 14 });
  }
  P.cyl('c_brass', 0.06, 0.06, 2.3, 0, 1.3, 0, { seg: 6 });
}

// Brasero del easter egg: pedestal de piedra y cuenco de hierro (el emblema de color y el fuego los pone CastleEE)
function brazier(B, p) {
  const { cx, cz, y } = rectOf(p);
  const P = B.at(cx, y, cz, 0);
  P.box('c_ashlar', 0.8, 0.14, 0.8, 0, 0.07, 0, { color: 0x8a8478 });
  P.box('c_ashlar', 0.52, 0.62, 0.52, 0, 0.45, 0, { color: 0x9a948a });
  P.box('c_ashlar', 0.7, 0.1, 0.7, 0, 0.8, 0, { color: 0x8a8478 });
  P.cyl('c_iron', 0.48, 0.2, 0.3, 0, 0.98, 0, { seg: 14, color: 0x2a2622 });
  P.torus('c_iron', 0.48, 0.035, 0, 1.13, 0, { rx: Math.PI / 2, seg: 20, color: 0x3a342c });
  for (let k = 0; k < 4; k++) {
    const a = k * TAU / 4 + TAU / 8;
    P.rod('c_iron', [Math.cos(a) * 0.46, 1.12, Math.sin(a) * 0.46], [Math.cos(a) * 0.3, 0.85, Math.sin(a) * 0.3], 0.025);
  }
  P.cyl('c_iron', 0.4, 0.4, 0.04, 0, 1.08, 0, { seg: 12, color: 0x14100c });   // carbón
}

const BUILDERS = {
  fountain, hedge, statue, bench_iron: benchIron, carriage, armor, shelf, desk: (B, p, r) => table(B, p, r, false),
  dining, sideboard, stove, worktable, piano, harp, planter, bed, wardrobe, globe, cabinet, pillar, tube,
  console: consoleProp, centrifuge, sarcophagus, barrels, winerack, clockwork, brazier,
};

// ------------------------------------------------------------------ decoración suelta
function chandelier(B, flames, x, y, z, rings = 2) {
  const P = B.at(x, y, z, 0);
  P.rod('c_iron', [0, 0, 0], [0, -1.2, 0], 0.02);
  P.sphere('c_brass', 0.12, 0, -1.25, 0, { seg: 8 });
  for (let k = 0; k < rings; k++) {
    const R = 0.55 + k * 0.4, yy = -1.4 - k * 0.2;
    P.torus('c_brass', R, 0.025, 0, yy, 0, { rx: Math.PI / 2, seg: 24 });
    const n = 6 + k * 4;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU;
      P.cyl('c_candle', 0.025, 0.025, 0.14, Math.cos(a) * R, yy + 0.09, Math.sin(a) * R, { seg: 6 });
      if (flames && i % 3 === 0) flames.add(x + Math.cos(a) * R, y + yy + 0.17, z + Math.sin(a) * R, 0.12);
    }
    for (let i = 0; i < 12; i++) {     // cristales colgantes
      const a = i / 12 * TAU + 0.2;
      P.sphere('c_tubeglass', 0.03, Math.cos(a) * (R - 0.05), yy - 0.12, Math.sin(a) * (R - 0.05), { seg: 4, sy: 2 });
    }
  }
}
function gasLamp(B, flames, x, y, z) {
  const P = B.at(x, y, z, 0);
  P.cyl('c_iron', 0.12, 0.16, 0.4, 0, 0.2, 0, { seg: 8 });
  P.cyl('c_iron', 0.05, 0.06, 3.0, 0, 1.9, 0, { seg: 8 });
  P.box('c_iron', 0.36, 0.06, 0.36, 0, 3.4, 0, {});
  P.box('c_lamp', 0.26, 0.4, 0.26, 0, 3.65, 0, {});
  P.cyl('c_iron', 0, 0.26, 0.25, 0, 4.0, 0, { seg: 4, ry: Math.PI / 4 });
  if (flames) flames.add(x, y + 3.55, z, 0.18);
}
function fireplace(B, flames, x, y, z, face) {
  const yaw = yawForFace(face);
  const P = B.at(x, y, z, yaw);
  P.box('c_marble_w', 2.2, 0.15, 0.5, 0, 1.35, -0.25, { color: 0xb8b0a0 });
  P.box('c_marble_w', 0.3, 1.3, 0.45, -0.95, 0.65, -0.22, { color: 0xb8b0a0 });
  P.box('c_marble_w', 0.3, 1.3, 0.45, 0.95, 0.65, -0.22, { color: 0xb8b0a0 });
  P.box('dark', 1.6, 1.1, 0.3, 0, 0.55, -0.12, {});
  for (let k = 0; k < 3; k++) P.cyl('c_darkwood', 0.07, 0.07, 0.7, -0.25 + k * 0.25, 0.15, -0.25, { rz: Math.PI / 2, ry: k * 0.4, seg: 6, color: 0x2a1a10 });
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  if (flames) flames.add(x + dx * 0.25, y + 0.1, z + dz * 0.25, 0.45);
}
function portrait(world, B, x, y, z, face, seed, w = 0.9, h = 1.15) {
  const yaw = yawForFace(face);
  const P = B.at(x, y, z, yaw);
  P.box('c_brass', w + 0.16, h + 0.16, 0.05, 0, 0, -0.03, { color: 0x8a6a2a });
  const tex = portraitTexture(seed);
  const mat = world.mats.track(new THREE.MeshLambertMaterial({ map: tex }));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  m.position.set(x + dx * 0.061, y, z + dz * 0.061);
  m.rotation.y = yaw + Math.PI;
  world.root.add(m);
}
function rug(B, x0, z0, x1, z1, y) {
  const P = B.at((x0 + x1) / 2, y + 0.012, (z0 + z1) / 2, 0);
  P.box('c_carpet', x1 - x0, 0.01, z1 - z0, 0, 0, 0, { uv: Math.max(x1 - x0, z1 - z0) });
}

// Muro (celda) contra el que se puede colgar algo mirando hacia face desde la celda de suelo (x, z) de la planta l
function wallPoint(l, x, z, face) {
  const d = DIRS[face];
  return { x: x + 0.5 - d.dx * 0.5, z: z + 0.5 - d.dz * 0.5, wallFace: face };
}

export function buildCastleProps(B, world) {
  const r = makeRng(1837);
  const flames = world.flames;
  for (const p of MAP.PROPS) {
    const f = BUILDERS[p.kind];
    if (f) f(B, p, r, flames);
    else {
      const { cx, cz, lx, lz, y } = rectOf(p);
      B.at(cx, y, cz, 0).box('c_darkwood', lx * 0.9, p.h, lz * 0.9, 0, p.h / 2, 0, {});
    }
  }
  // Decoración (coordenadas de la definición + margen O = 4)
  const O = 4, zoneBy = (k) => MAP.ZONES.find((z) => z.key === k);
  const L1 = MAP.baseY(1), L2 = MAP.baseY(2), L3 = MAP.baseY(3), L0 = MAP.baseY(0);
  // lámparas de araña
  const vest = zoneBy('vestibulo');
  if (vest) chandelier(B, flames, (vest.x0 + vest.x1 + 1) / 2, L1 + 8.6, (vest.z0 + vest.z1 + 1) / 2 + 2, 3);
  for (const k of ['biblioteca', 'comedor', 'musica', 'estudio', 'alanorte']) {
    const z = zoneBy(k);
    if (z) chandelier(B, flames, (z.x0 + z.x1 + 1) / 2, MAP.baseY(z.lv) + 4.3, (z.z0 + z.z1 + 1) / 2, 2);
  }
  const salon = zoneBy('salon');
  if (salon) for (const fz of [0.3, 0.7]) chandelier(B, flames, (salon.x0 + salon.x1 + 1) / 2, L3 + 6.2, salon.z0 + (salon.z1 - salon.z0) * fz, 3);
  // farolas de gas del patio
  for (const [x, z] of [[14, 43], [49, 43], [14, 57], [49, 57], [27, 47], [36, 47]]) gasLamp(B, flames, x + O + 0.5, L1, z + O + 0.5);
  // chimeneas
  fireplace(B, flames, 12 + O, L1, 20 + O + 0.3, 'S');
  fireplace(B, flames, 52 + O, L1, 40 + O + 0.7, 'N');
  fireplace(B, flames, 51 + O, L2, 20 + O + 0.3, 'S');
  fireplace(B, flames, 31.5 + O, L3, 3 + O + 0.3, 'S');
  // retratos en el vestíbulo, la galería y el salón
  let seed = 11;
  for (const [x, z, face, lv] of [
    [22, 24, 'E', 1], [22, 30, 'E', 1], [41, 24, 'W', 1], [41, 30, 'W', 1],
    [26, 20, 'S', 2], [37, 20, 'S', 2], [22, 34, 'E', 2], [41, 34, 'W', 2],
    [16, 12, 'E', 3], [47, 12, 'W', 3], [16, 20, 'E', 3], [47, 20, 'W', 3],
    [43, 24, 'E', 1], [20, 36, 'W', 2],
  ]) {
    const wp = wallPoint(lv, x + O, z + O, face);
    portrait(world, B, wp.x, MAP.baseY(lv) + 2.3, wp.z, face, seed++);
  }
  // alfombras
  rug(B, 26 + O, 30 + O, 38 + O, 40 + O, L1);
  rug(B, 9 + O, 25 + O, 16 + O, 34 + O, L1);
  rug(B, 47 + O, 25 + O, 57 + O, 36 + O, L2);
  rug(B, 22 + O, 8 + O, 42 + O, 26 + O, L3);
  // candelabros de pie en la galería
  for (const [x, z] of [[23, 21], [40, 21], [23, 39], [40, 39]]) {
    const P = B.at(x + O + 0.5, L2, z + O + 0.5, 0);
    P.cyl('c_brass', 0.05, 0.15, 1.6, 0, 0.8, 0, { seg: 8 });
    for (const s of [-1, 0, 1]) P.cyl('c_candle', 0.02, 0.02, 0.16, s * 0.15, 1.7, 0, { seg: 6 });
    flames.add(x + O + 0.5, L2 + 1.8, z + O + 0.5, 0.14);
  }
  // Laboratorio: tuberías en el techo y bobina de Tesla junto al teletransporte
  const lab = zoneBy('laboratorio');
  if (lab) {
    for (let x = lab.x0; x <= lab.x1; x += 4) {
      B.at(x + 0.5, L0 + 4.1, (lab.z0 + lab.z1) / 2, 0).cyl('rust', 0.12, 0.12, lab.z1 - lab.z0, 0, 0, 0, { rx: Math.PI / 2, seg: 8 });
    }
    const P = B.at(21 + O, L0, 17 + O, 0);
    P.cyl('c_iron', 0.35, 0.45, 0.4, 0, 0.2, 0, { seg: 12 });
    P.cyl('c_brass', 0.12, 0.18, 2.2, 0, 1.5, 0, { seg: 12 });
    P.torus('c_brass', 0.35, 0.12, 0, 2.7, 0, { rx: Math.PI / 2, seg: 20 });
  }
  // Cámara del Tiempo: gran esfera de reloj en la pared norte
  const cron = zoneBy('cronos');
  if (cron) {
    const tex = clockTexture();
    const mat = world.mats.track(new THREE.MeshLambertMaterial({ map: tex, emissive: 0x6a50a0, emissiveMap: tex, emissiveIntensity: 0.25 }));
    const m = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), mat);
    m.position.set((cron.x0 + cron.x1 + 1) / 2 + 3, L2 + 2.6, cron.z0 + 0.03);
    world.root.add(m);
  }
  void makeGlow;
}
