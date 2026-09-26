// Modelo procedural de zombi: humanoide jerárquico con pivotes (hombros, codos, caderas, rodillas, cuello, mandíbula),
// variantes de ropa (obrero, oficinista, policía, civil), animación procedural por código ZA, reacciones a impactos
// y muertes (decapitación, desmembramiento, calcinado, caídas con física simple).
// Las proporciones coinciden con ZOMBIE_HITBOX (cabeza a 1.62 m, torso 0.78–1.45 m, piernas 0–0.78 m).
// Geometrías, texturas y materiales se comparten entre todos los zombis.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ZA, ZF } from '/shared/protocol.js';
import { ZOMBIE_HITBOX } from '/shared/collision.js';
import { hasTypeModel, buildTypeModel, decorateCommon } from './bossModels.js';
import {
  TAU, rng, makeCanvas, canvasTexture, blotches, bloodStain, tearHole, grime, paintGeo, solidColor, remapUV,
  deform, mergeGeos, makeMat, limbGeo, glowTexture, smoothstep, easeInOut, clamp01, fbm, roundedBox, capsule } from './procgen.js';

const HB = ZOMBIE_HITBOX;

// Dimensiones del esqueleto (m). La cadera (grupo hips) está a 0.80 m.
const DIM = {
  hipY: 0.80,
  hipJointX: 0.095, hipJointY: -0.02,
  thigh: 0.40, shin: 0.33, sole: 0.0525,
  neckY: HB.headY - 0.20 - 0.80,     // 0.62: pivote del cuello sobre la columna
  headC: 0.215,                      // centro del cráneo sobre el pivote del cuello
  shoulderX: 0.20, shoulderY: 0.575,
  upperArm: 0.28, forearm: 0.25,
};
const SHIN_FULL = DIM.shin + DIM.sole;

// Índices de la pose (valores con signo "semántico"; se convierten al aplicarlos)
const HIPY = 0, HIPZ = 1, HIPP = 2, HIPYAW = 3, HIPROLL = 4;
const LEAN = 5, TWIST = 6, ROLL = 7, NOD = 8, TURN = 9, TILT = 10, JAW = 11;
const LRAISE = 12, LSPLAY = 13, LTWIST = 14, LELB = 15, RRAISE = 16, RSPLAY = 17, RTWIST = 18, RELB = 19;
const LSWING = 20, LLSPLAY = 21, LKNEE = 22, RSWING = 23, RLSPLAY = 24, RKNEE = 25, LIFT = 26;
const LTOE = 27, RTOE = 28;                 // puntera abajo (+) respecto al pie plano
const NP = 29;
// velocidad de suavizado por canal: brazos y cabeza van algo retrasados respecto al cuerpo (inercia)
const RATE = new Float32Array(NP).fill(11);
for (const i of [LRAISE, LSPLAY, LTWIST, LELB, RRAISE, RSPLAY, RTWIST, RELB]) RATE[i] = 7;
for (const i of [NOD, TILT, TURN]) RATE[i] = 8.5;

// Conjuntos de ropa
const OUTFITS = [
  { key: 'obrero', shirt: 'vest', pants: 'work', hat: 'hardhat', hatChance: 0.6 },
  { key: 'obrero', shirt: 'flannelGreen', pants: 'work', hat: 'hardhatW', hatChance: 0.45 },
  { key: 'oficinista', shirt: 'officeRed', pants: 'slacks' },
  { key: 'oficinista', shirt: 'officeBlue', pants: 'slacks' },
  { key: 'policia', shirt: 'police', pants: 'police', hat: 'police', hatChance: 0.65 },
  { key: 'civil', shirt: 'flannelRed', pants: 'jeans' },
  { key: 'civil', shirt: 'tee', pants: 'jeans' },
  { key: 'civil', shirt: 'dress', pants: 'bare', skirt: true, longHair: true, bareArms: 0.85 },
  { key: 'paciente', shirt: 'gown', pants: 'bare', skirt: true, bareArms: 0.9 },
];
export const ZOMBIE_VARIANTS = OUTFITS.map((o) => o.key);

const SKIN_TINTS = ['#a3ad95', '#b2a98c', '#8e9a86', '#9ba4a9'];
const HAIR_COLORS = [[0.10, 0.08, 0.07], [0.22, 0.15, 0.10], [0.38, 0.36, 0.34], [0.05, 0.05, 0.05]];
const EXPOSED_SKIN = '#8f9784';

// --------------------------------------------------------------------------------------------
// Texturas procedurales
// --------------------------------------------------------------------------------------------
const TW = 256, TH = 256, TORSO_H = 192;

function paintSkin(seed) {
  const c = makeCanvas(TW, TH);
  if (!c) return null;
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = '#d4d6cc';
  g.fillRect(0, 0, TW, TH);
  blotches(g, TW, TH, r, '#8fa276', 70, 6, 30, 0.08, 0.22);   // verdoso
  blotches(g, TW, TH, r, '#6d4d6b', 35, 5, 22, 0.06, 0.18);   // morado
  blotches(g, TW, TH, r, '#6e5c3a', 30, 4, 20, 0.06, 0.18);   // pardo
  blotches(g, TW, TH, r, '#1f2618', 18, 3, 10, 0.1, 0.3);     // podredumbre
  // venas
  g.strokeStyle = 'rgba(55,42,78,0.35)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 22; i++) {
    let x = r() * TW, y = r() * TH;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 22; y += (r() - 0.5) * 22; g.lineTo(x, y); }
    g.stroke();
  }
  // heridas abiertas: pocas, pequeñas e irregulares (en extremidades finas no deben parecer lunares)
  for (let i = 0; i < 3; i++) {
    const x = r() * TW, y = r() * TH, w = 5 + r() * 9, h = 2 + r() * 3;
    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI);
    g.fillStyle = 'rgba(60,8,6,0.75)';
    g.beginPath(); g.ellipse(0, 0, w, h, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(120,26,20,0.6)';
    g.beginPath(); g.ellipse(0, 0, w * 0.55, h * 0.4, 0, 0, TAU); g.fill();
    g.restore();
  }
  // arañazos
  g.strokeStyle = 'rgba(90,20,16,0.45)';
  g.lineWidth = 1;
  for (let i = 0; i < 10; i++) { const x = r() * TW, y = r() * TH; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6 + r() * 10, y + (r() - 0.5) * 6); g.stroke(); }
  // poros / textura fina
  blotches(g, TW, TH, r, '#000000', 260, 0.6, 1.6, 0.05, 0.14);
  return c;
}

function fabricBase(g, x, y, w, h, color, r, noise = 0.12) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  blotches(g, TW, TH, r, '#ffffff', 40, 4, 20, 0.02, noise * 0.4);
  blotches(g, TW, TH, r, '#000000', 60, 4, 24, 0.03, noise);
  g.restore();
}

function plaid(g, x0, y0, w, h, dark, light) {
  g.save();
  g.beginPath(); g.rect(x0, y0, w, h); g.clip();
  g.fillStyle = dark;
  for (let x = x0; x < x0 + w; x += 32) g.fillRect(x, y0, 11, h);
  for (let y = y0; y < y0 + h; y += 32) g.fillRect(x0, y, w, 11);
  g.fillStyle = light;
  for (let x = x0 + 20; x < x0 + w; x += 32) g.fillRect(x, y0, 2, h);
  for (let y = y0 + 20; y < y0 + h; y += 32) g.fillRect(x0, y, w, 2);
  g.restore();
}

function paintShirt(kind, seed) {
  const c = makeCanvas(TW, TH);
  if (!c) return null;
  const g = c.getContext('2d');
  const r = rng(seed);
  const FX = 128; // centro del frente (u = 0.5)
  let base = '#777';
  switch (kind) {
    case 'officeRed':
    case 'officeBlue': {
      base = kind === 'officeRed' ? '#cdc9b8' : '#b3c0cc';
      fabricBase(g, 0, 0, TW, TH, base, r, 0.1);
      g.fillStyle = 'rgba(0,0,0,0.05)';
      for (let x = 0; x < TW; x += 6) g.fillRect(x, 0, 1, TH);
      // bolsillo (pecho izquierdo del modelo)
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1.5;
      g.strokeRect(150, 40, 24, 24);
      // cuello
      g.fillStyle = kind === 'officeRed' ? '#dedace' : '#c6d1db';
      g.beginPath(); g.moveTo(FX - 26, 0); g.lineTo(FX - 4, 22); g.lineTo(FX - 10, 0); g.fill();
      g.beginPath(); g.moveTo(FX + 26, 0); g.lineTo(FX + 4, 22); g.lineTo(FX + 10, 0); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.beginPath(); g.moveTo(FX - 26, 0); g.lineTo(FX - 4, 22); g.moveTo(FX + 26, 0); g.lineTo(FX + 4, 22); g.stroke();
      // corbata (torcida)
      const tie = kind === 'officeRed' ? '#6c181d' : '#1b2745';
      g.save();
      g.translate(FX, 8);
      g.rotate(0.12 - r() * 0.24);
      g.fillStyle = tie;
      g.beginPath(); g.moveTo(-6, 0); g.lineTo(6, 0); g.lineTo(4, 12); g.lineTo(-4, 12); g.fill();
      g.beginPath(); g.moveTo(-4, 12); g.lineTo(4, 12); g.lineTo(11, 118); g.lineTo(0, 132); g.lineTo(-11, 118); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 3;
      for (let y = 20; y < 120; y += 12) { g.beginPath(); g.moveTo(-10, y); g.lineTo(10, y + 8); g.stroke(); }
      g.restore();
      break;
    }
    case 'police': {
      base = '#1e2943';
      fabricBase(g, 0, 0, TW, TH, base, r, 0.14);
      // hombreras
      g.fillStyle = '#34507e';
      g.fillRect(56, 10, 18, 26); g.fillRect(182, 10, 18, 26);
      g.strokeStyle = '#c9a43a'; g.lineWidth = 2;
      g.strokeRect(56, 10, 18, 26); g.strokeRect(182, 10, 18, 26);
      // bolsillos con solapa
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(78, 36, 30, 8); g.fillRect(150, 36, 30, 8);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
      g.strokeRect(78, 36, 30, 30); g.strokeRect(150, 36, 30, 30);
      // placa dorada (pecho izquierdo) y placa de nombre
      g.fillStyle = '#c9a43a';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * TAU, rr = i % 2 ? 5 : 11;
        g.lineTo(165 + Math.cos(a) * rr, 26 + Math.sin(a) * rr);
      }
      g.closePath(); g.fill();
      g.fillStyle = '#8a6d1f'; g.beginPath(); g.arc(165, 26, 3, 0, TAU); g.fill();
      g.fillStyle = '#c9a43a'; g.fillRect(84, 26, 20, 5);
      // botones y corbata oscura
      g.fillStyle = '#0f1424';
      g.beginPath(); g.moveTo(FX - 5, 2); g.lineTo(FX + 5, 2); g.lineTo(FX + 8, 100); g.lineTo(FX, 110); g.lineTo(FX - 8, 100); g.fill();
      g.fillStyle = '#9aa0aa';
      for (let y = 118; y < 185; y += 20) { g.beginPath(); g.arc(FX + 1, y, 2, 0, TAU); g.fill(); }
      break;
    }
    case 'vest': {
      base = '#4a4c49';
      fabricBase(g, 0, 0, TW, TH, base, r, 0.12);
      // chaleco reflectante naranja sobre el torso (sisas libres a los lados)
      g.fillStyle = '#d6621c';
      g.fillRect(0, 0, TW, TORSO_H - 18);
      g.fillStyle = base;
      g.fillRect(48, 0, 30, 64); g.fillRect(178, 0, 30, 64);   // sisas
      g.fillRect(FX - 6, 0, 12, TORSO_H - 18);                   // abertura frontal
      g.save();
      g.beginPath(); g.rect(0, 0, TW, TORSO_H - 18); g.clip();
      blotches(g, TW, TH, r, '#3a1a06', 40, 4, 18, 0.05, 0.2);
      g.restore();
      // cintas reflectantes
      g.fillStyle = '#cfcfc6';
      g.fillRect(0, 110, TW, 10); g.fillRect(0, 146, TW, 10);
      g.fillRect(96, 0, 9, 110); g.fillRect(151, 0, 9, 110);
      g.fillRect(14, 0, 9, 110); g.fillRect(233, 0, 9, 110);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(48, 110, 30, 10); g.fillRect(178, 110, 30, 10);
      break;
    }
    case 'flannelRed':
    case 'flannelGreen': {
      base = kind === 'flannelRed' ? '#86291f' : '#2c5531';
      fabricBase(g, 0, 0, TW, TH, base, r, 0.1);
      plaid(g, 0, 0, TW, TH, 'rgba(0,0,0,0.32)', 'rgba(255,236,200,0.2)');
      // botones y tapeta
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(FX - 5, 0, 10, TORSO_H);
      g.fillStyle = '#d8cfb8';
      for (let y = 20; y < 180; y += 26) { g.beginPath(); g.arc(FX, y, 2.4, 0, TAU); g.fill(); }
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath(); g.moveTo(FX - 24, 0); g.lineTo(FX - 3, 20); g.lineTo(FX - 8, 0); g.fill();
      g.beginPath(); g.moveTo(FX + 24, 0); g.lineTo(FX + 3, 20); g.lineTo(FX + 8, 0); g.fill();
      break;
    }
    case 'dress': {
      // vestido granate con estampado de flores y escote
      base = '#5e1a24';
      fabricBase(g, 0, 0, TW, TH, base, r, 0.12);
      for (let i = 0; i < 90; i++) {
        const x = r() * TW, y = r() * TH;
        g.fillStyle = r() < 0.5 ? 'rgba(220,190,120,0.35)' : 'rgba(240,220,220,0.25)';
        for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; g.beginPath(); g.arc(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 2, 0, TAU); g.fill(); }
      }
      g.fillStyle = EXPOSED_SKIN;
      g.beginPath(); g.moveTo(FX - 30, 0); g.lineTo(FX, 38); g.lineTo(FX + 30, 0); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 118, TW, 6);        // costura de la cintura
      break;
    }
    case 'gown': {
      // bata de hospital celeste con estampado, abierta por detrás
      base = '#8fb2b8';
      fabricBase(g, 0, 0, TW, TH, base, r, 0.1);
      g.fillStyle = 'rgba(40,70,90,0.25)';
      for (let y = 6; y < TH; y += 14) for (let x = (y % 28 ? 7 : 0); x < TW; x += 14) g.fillRect(x, y, 3, 3);
      g.fillStyle = EXPOSED_SKIN;
      g.fillRect(0, 0, 14, TORSO_H); g.fillRect(TW - 14, 0, 14, TORSO_H);   // espalda abierta
      g.fillStyle = '#6a8a90';
      for (const y of [30, 90, 150]) { g.fillRect(8, y, 16, 3); g.fillRect(TW - 24, y, 16, 3); }   // cintas
      break;
    }
    default: { // camiseta gris con estampado desteñido
      base = '#86857f';
      fabricBase(g, 0, 0, TW, TH, base, r, 0.12);
      g.fillStyle = 'rgba(40,40,40,0.4)'; g.fillRect(0, 0, TW, 6);
      g.globalAlpha = 0.45;
      g.fillStyle = '#8c2b25';
      g.beginPath(); g.arc(FX, 62, 20, 0, TAU); g.fill();
      g.fillStyle = '#e8e2d0';
      g.fillRect(FX - 26, 88, 52, 7);
      g.fillRect(FX - 18, 99, 36, 4);
      g.globalAlpha = 1;
      break;
    }
  }
  // Suciedad, desgarros y sangre sobre el torso
  g.save();
  g.beginPath(); g.rect(0, 0, TW, TORSO_H); g.clip();
  grime(g, TW, TORSO_H, r, kind === 'vest' ? 1.3 : 1);
  const tears = 2 + Math.floor(r() * 3);
  for (let i = 0; i < tears; i++) {
    tearHole(g, r() * TW, 60 + r() * 120, 18 + r() * 30, 14 + r() * 26, r, EXPOSED_SKIN);
  }
  bloodStain(g, FX + (r() - 0.5) * 50, 10 + r() * 18, 12 + r() * 10, r);
  bloodStain(g, r() * TW, 50 + r() * 110, 7 + r() * 10, r, true);
  bloodStain(g, r() * TW, 40 + r() * 120, 5 + r() * 8, r, true);
  // dobladillo sucio
  const hem = g.createLinearGradient(0, TORSO_H - 30, 0, TORSO_H);
  hem.addColorStop(0, 'rgba(30,20,12,0)');
  hem.addColorStop(1, 'rgba(30,20,12,0.55)');
  g.fillStyle = hem; g.fillRect(0, TORSO_H - 30, TW, 30);
  g.restore();
  // Franja de mangas (v 0..0.25): mismo tejido, puño deshilachado y manchas
  g.save();
  g.beginPath(); g.rect(0, TORSO_H, TW, TH - TORSO_H); g.clip();
  if (kind === 'vest') { g.fillStyle = base; g.fillRect(0, TORSO_H, TW, TH - TORSO_H); }
  grime(g, TW, TH, r, 0.8);
  g.fillStyle = 'rgba(20,14,10,0.5)'; g.fillRect(0, TH - 10, TW, 10);
  bloodStain(g, r() * TW, TORSO_H + 20, 8, r, true);
  bloodStain(g, r() * TW, TORSO_H + 30, 6, r);
  g.restore();
  return c;
}

function paintPants(kind, seed) {
  const c = makeCanvas(TW, TH);
  if (!c) return null;
  const g = c.getContext('2d');
  const r = rng(seed);
  const cols = { work: '#33455a', slacks: '#29292d', police: '#1b2236', jeans: '#3b5d84', bare: '#8c937f' };
  fabricBase(g, 0, 0, TW, TH, cols[kind] || '#333', r, 0.14);
  if (kind === 'bare') {
    // piernas desnudas: moratones, venas y arañazos
    blotches(g, TW, TH, r, '#5d4a66', 30, 5, 20, 0.08, 0.25);
    blotches(g, TW, TH, r, '#6e5c3a', 25, 4, 16, 0.06, 0.2);
    g.strokeStyle = 'rgba(55,42,78,0.35)'; g.lineWidth = 1.2;
    for (let i = 0; i < 16; i++) { let x = r() * TW, y = r() * TH; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 18; y += r() * 20; g.lineTo(x, y); } g.stroke(); }
  }
  if (kind === 'jeans') {
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 0; x < TW; x += 3) g.fillRect(x, 0, 1, TH);
    const fade = g.createRadialGradient(128, 110, 5, 128, 110, 60);
    fade.addColorStop(0, 'rgba(200,215,235,0.25)'); fade.addColorStop(1, 'rgba(200,215,235,0)');
    g.fillStyle = fade; g.fillRect(0, 0, TW, TH);
  }
  if (kind === 'slacks') { g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(126, 20, 3, TH); }
  if (kind === 'police') { g.fillStyle = '#5f7fb8'; g.fillRect(61, 20, 5, TH); g.fillRect(190, 20, 5, TH); }
  if (kind === 'work') {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(100, 140, 56, 40);                     // rodilleras
    g.strokeStyle = 'rgba(200,190,160,0.25)'; g.lineWidth = 1;
    g.strokeRect(100, 140, 56, 40);
  }
  grime(g, TW, TH, r, kind === 'work' ? 1.4 : 1);
  // desgarros en rodillas y perneras
  const holes = kind === 'bare' ? 0 : kind === 'jeans' ? 3 : 1 + Math.floor(r() * 2);
  for (let i = 0; i < holes; i++) {
    tearHole(g, 80 + r() * 100, 140 + r() * 70, 16 + r() * 22, 10 + r() * 14, r, EXPOSED_SKIN);
  }
  bloodStain(g, r() * TW, 60 + r() * 60, 8 + r() * 8, r, true);
  bloodStain(g, r() * TW, 120 + r() * 60, 6 + r() * 6, r);
  // cinturón (también sirve de "cuero" para los zapatos)
  const belt = kind === 'slacks' || kind === 'police' ? '#111111' : kind === 'bare' ? '#2a1c16' : '#3b2616';
  g.fillStyle = belt; g.fillRect(0, 0, TW, 20);
  blotches(g, TW, 20, r, '#000000', 20, 2, 8, 0.1, 0.3);
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 2, TW, 1);
  g.fillStyle = '#9c9282'; g.fillRect(120, 3, 16, 14);
  g.fillStyle = belt; g.fillRect(124, 7, 8, 6);
  return c;
}

// --------------------------------------------------------------------------------------------
// Geometrías
// --------------------------------------------------------------------------------------------
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

function torsoGeo(seed) {
  const g = new THREE.CylinderGeometry(1, 1, 1, 28, 18, false);
  const belly = seed === 2 ? 0.035 : 0;                 // variante con barriga
  const thin = seed === 3 ? 0.9 : 1;                    // variante demacrada
  deform(g, (v) => {
    const t = v.y + 0.5;
    const back = v.z > 0 ? v.z : 0, front = v.z < 0 ? -v.z : 0;
    const side = Math.abs(v.x);
    const w = profile(t, [[0, 0.15], [0.3, 0.155 * thin], [0.55, 0.168 * thin], [0.72, 0.186], [0.84, 0.2], [0.92, 0.186], [0.97, 0.13], [1, 0.058]]);
    const d = profile(t, [[0, 0.1], [0.35, 0.104 * thin], [0.62, 0.12], [0.84, 0.114], [0.95, 0.1], [1, 0.05]]);
    let y = -0.03 + t * 0.70;
    let z = v.z * d;
    // hombros caídos: los lados bajan hacia los brazos en vez de acabar en una meseta
    y -= 0.055 * smoothstep(0.78, 1, t) * side * side;
    // joroba en la espalda alta, pecho hundido y clavículas marcadas
    z += back * 0.035 * smoothstep(0.55, 0.8, t) * (1 - smoothstep(0.9, 1, t));
    if (v.z < 0) z *= 1 - 0.08 * smoothstep(0.5, 0.75, t);
    z -= front * 0.012 * Math.exp(-((t - 0.9) ** 2) / 0.002) * side;
    // barriga (variante) y costillas marcadas bajo la tela (demacrado)
    z -= front * belly * Math.exp(-((t - 0.3) ** 2) / 0.02);
    if (thin < 1) z -= front * 0.006 * Math.max(0, Math.sin(t * 60)) * smoothstep(0.45, 0.6, t) * (1 - smoothstep(0.8, 0.85, t));
    // dobladillo rasgado
    if (t < 0.02 && Math.hypot(v.x, v.z) > 0.5) {
      const ang = Math.atan2(v.x, v.z) + Math.PI;
      y -= fbm(ang * 1.6, 3.3, seed, 2) * 0.09;
    }
    v.set(v.x * w, y, z);
  });
  remapUV(g, 0, 1, 0.25, 1);
  paintGeo(g, (x, y, z, c) => {
    // oclusión bajo los hombros / cuello y en los costados
    const k = (0.82 + 0.18 * smoothstep(-0.03, 0.2, y)) * (0.9 + 0.1 * smoothstep(0.1, 0.02, Math.abs(Math.abs(x) - 0.17)));
    c.setRGB(k, k, k);
  });
  return g;
}

function pelvisGeo() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 24, 5, false);
  deform(g, (v) => {
    const t = v.y + 0.5;
    const w = profile(t, [[0, 0.135], [0.5, 0.158], [1, 0.155]]);
    const d = profile(t, [[0, 0.09], [0.5, 0.108], [1, 0.104]]);
    v.set(v.x * w, -0.13 + t * 0.19, v.z * d);
  });
  remapUV(g, 0, 1, 0.72, 1);
  solidColor(g, 1, 1, 1);
  return g;
}

function thighGeo() {
  const g = limbGeo(DIM.thigh, 0.079, 0.058, 9, 3);
  remapUV(g, 0, 1, 0.33, 0.8);
  solidColor(g, 1, 1, 1);
  return g;
}

function shinGeo() {
  const shin = limbGeo(DIM.shin + 0.01, 0.058, 0.044, 9, 2);
  // gemelo marcado
  deform(shin, (v) => { const t = -v.y / DIM.shin; const k = 1 + 0.12 * Math.exp(-((t - 0.3) ** 2) / 0.02) * (v.z > 0 ? 1 : 0.4); v.x *= k; v.z *= k; });
  remapUV(shin, 0, 1, 0.0, 0.4);
  solidColor(shin, 1, 1, 1);
  return shin;
}

// Zapato (cuelga del tobillo, al final de la espinilla): se mantiene plano en el suelo al andar
function footGeo() {
  const foot = roundedBox(0.094, 0.066, 0.215, 0.028, 2);
  deform(foot, (v) => {
    if (v.z < -0.05) v.y -= 0.012 * (v.y > 0 ? 1 : 0);          // puntera más baja
    if (v.z > 0.06 && v.y < 0) v.y -= 0.004;                     // tacón
  }, false);
  foot.translate(0, -0.0195, -0.05);
  remapUV(foot, 0.08, 0.3, 0.935, 0.985); // cuero del cinturón
  paintGeo(foot, (x, y, z, c) => { const k = y < -0.045 ? 0.45 : 0.8; c.setRGB(k, k * 0.94, k * 0.88); });
  return foot;
}

function upperArmSleeveGeo(seed) {
  const arm = limbGeo(DIM.upperArm, 0.056, 0.047, 8, 2, 0.06, seed);
  deform(arm, (v) => { const t = -v.y / DIM.upperArm; const k = 1 + 0.07 * Math.exp(-((t - 0.45) ** 2) / 0.03); v.x *= k; v.z *= k; });
  remapUV(arm, 0, 1, 0.0, 0.25);
  solidColor(arm, 1, 1, 1);
  const cap = new THREE.SphereGeometry(0.06, 16, 12);
  cap.scale(0.95, 1.12, 0.98);
  cap.translate(0, -0.012, 0);
  remapUV(cap, 0, 1, 0.2, 0.25);
  solidColor(cap, 1, 1, 1);
  return mergeGeos([arm, cap]);
}

function upperArmBareGeo() {
  const arm = limbGeo(DIM.upperArm, 0.048, 0.038, 8, 2);
  deform(arm, (v) => { const t = -v.y / DIM.upperArm; const k = 1 + 0.1 * Math.exp(-((t - 0.4) ** 2) / 0.03) * (v.z < 0 ? 1 : 0.5); v.x *= k; v.z *= k; });
  const cap = new THREE.SphereGeometry(0.052, 14, 10);
  cap.scale(0.95, 1.1, 0.98);
  cap.translate(0, -0.01, 0);
  solidColor(arm, 0.92, 0.92, 0.92);
  solidColor(cap, 0.92, 0.92, 0.92);
  return mergeGeos([arm, cap]);
}

function forearmGeo(seed) {
  const r = rng(seed);
  const parts = [];
  const L = DIM.forearm;
  const fore = limbGeo(L, 0.043, 0.031, 8, 3);
  // músculo del antebrazo cerca del codo y muñeca huesuda
  deform(fore, (v) => { const t = -v.y / L; const k = 1 + 0.14 * Math.exp(-((t - 0.25) ** 2) / 0.03) - 0.06 * smoothstep(0.8, 1, t); v.x *= k; v.z *= k * 0.92; });
  paintGeo(fore, (x, y, z, c) => { const k = 0.95 - 0.1 * smoothstep(-0.05, -0.25, y); c.setRGB(k, k, k); });
  parts.push(fore);
  const elbow = new THREE.SphereGeometry(0.045, 12, 9);
  solidColor(elbow, 0.9, 0.9, 0.9);
  parts.push(elbow);
  // mano: palma + dedos huesudos en garra (dos falanges) con uñas negras
  const palm = roundedBox(0.058, 0.095, 0.03, 0.012, 2);
  palm.translate(0, -L - 0.045, -0.004);
  paintGeo(palm, (x, y, z, c) => c.setRGB(0.85, 0.82, 0.8));
  parts.push(palm);
  const bloody = r() < 0.4;
  for (let i = 0; i < 4; i++) {
    const len = (i === 0 || i === 3 ? 0.07 : 0.082) * (0.92 + r() * 0.16);
    const a = capsule(0.0075, len * 0.55, 7);
    a.translate(0, -len * 0.27, 0);
    const b = capsule(0.0068, len * 0.55, 7);
    b.translate(0, -len * 0.27, 0);
    b.rotateX(0.5 + r() * 0.5);
    b.translate(0, -len * 0.5, 0);
    const f = mergeGeos([a, b]);
    f.rotateX(0.35 + r() * 0.45);
    f.translate(-0.021 + i * 0.014, -L - 0.09, -0.006);
    paintGeo(f, (x, y, z, c) => {
      const tip = smoothstep(-L - 0.13, -L - 0.16, y);
      if (bloody) c.setRGB(0.75, 0.35, 0.3); else c.setRGB(0.85, 0.82, 0.8);
      c.multiplyScalar(1 - 0.75 * tip);       // uñas negras
    });
    parts.push(f);
  }
  const thumb = capsule(0.0075, 0.055, 7);
  thumb.translate(0, -0.027, 0);
  thumb.rotateZ(0.6); thumb.rotateX(0.5);
  thumb.translate(0.03, -L - 0.02, -0.01);
  solidColor(thumb, 0.85, 0.82, 0.8);
  parts.push(thumb);
  return mergeGeos(parts);
}

function gauss3(dx, dy, dz, s) { return Math.exp(-(dx * dx + dy * dy + dz * dz) / (s * s)); }

// Cabeza: cráneo deformado (cuencas, pómulos hundidos, arco superciliar) + cuello. Colores de vértice para rasgos y pelo.
function headGeo(style, hairIdx, seed) {
  const r = rng(seed);
  const hair = HAIR_COLORS[hairIdx % HAIR_COLORS.length];
  const wound = { x: (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.4), y: r() * 0.6 - 0.1, z: r() * 0.8 - 0.4 };
  const rotNose = r() < 0.35;
  const g = new THREE.SphereGeometry(1, 26, 20);
  paintGeo(g, (x, y, z, c) => {
    let k = 1;
    for (const s of [-1, 1]) {
      const e = Math.sqrt((x - s * 0.36) ** 2 + (y - 0.06) ** 2 + (z + 0.93) ** 2);
      k *= 0.12 + 0.88 * smoothstep(0.07, 0.22, e);               // cuencas hundidas y oscuras, sin tapar la cara
      if (e > 0.2 && e < 0.3 && y > 0.1) k *= 0.85;                 // ojeras
    }
    c.setRGB(k, k * 0.97, k * 0.95);
    // boca: cavidad oscura y dientes superiores
    const mx = x / 0.36, my = (y + 0.44) / 0.12;
    if (z < -0.55 && mx * mx + my * my < 1) {
      if (Math.abs(y + 0.36) < 0.045 && Math.abs(x) < 0.3) c.setRGB(0.72, 0.66, 0.45);
      else c.setRGB(0.22, 0.04, 0.03);
    }
    // nariz podrida
    if (rotNose && z < -0.8 && Math.abs(x) < 0.12 && y > -0.22 && y < -0.02) c.setRGB(0.18, 0.05, 0.04);
    // sangre bajo la boca
    if (z < -0.4 && y < -0.5 && Math.abs(x) < 0.18 + 0.08 * fbm(x * 5, y * 5, seed)) c.multiply(new THREE.Color(0.55, 0.12, 0.1));
    // herida lateral
    const w = Math.sqrt((x - wound.x) ** 2 + (y - wound.y) ** 2 + (z - wound.z) ** 2);
    if (w < 0.22) { const t = 1 - w / 0.22; c.lerp(new THREE.Color(0.35, 0.03, 0.03), t * 0.9); }
    // pelo
    const line = 0.42 + (-0.62) * ((z + 1) / 2) - (style === 2 ? 0.2 * clamp01(z) : 0);
    const n = fbm(x * 3 + 5, z * 3 + y * 2, seed, 3);
    let isHair = y > line + (n - 0.5) * 0.25;
    if (style === 0) isHair = isHair && n > 0.52;   // calvo a parches
    if (isHair && !(z < -0.75 && y < 0.35)) {
      const hn = 0.75 + 0.5 * fbm(x * 9, y * 9 + z * 4, seed + 3, 2);
      c.setRGB(hair[0] * hn, hair[1] * hn, hair[2] * hn);
    }
  });
  deform(g, (v) => {
    const x = v.x, y = v.y, z = v.z;
    let d = 1;
    d += 0.07 * gauss3(x * 0.8, (y - 0.2) / 0.5, (z + 0.95) / 1.6, 0.35);
    for (const s of [-1, 1]) {
      d -= 0.13 * gauss3(x - s * 0.36, y - 0.06, z + 0.93, 0.17);
      d -= 0.08 * gauss3(x - s * 0.62, y + 0.28, z + 0.72, 0.24);
    }
    d += (rotNose ? 0.02 : 0.12) * gauss3(x, y + 0.1, z + 1.0, 0.11);
    d -= 0.05 * gauss3(x, y + 0.42, z + 0.9, 0.16);
    v.multiplyScalar(d);
    if (y < -0.2) v.x *= 1 - 0.2 * clamp01((-y - 0.2) / 0.8);
    if (z > 0) v.z *= 1.06;
    v.set(v.x * 0.1, v.y * 0.115 + DIM.headC, v.z * 0.113);
  });
  const neck = new THREE.CylinderGeometry(0.046, 0.056, 0.2, 12, 2);
  neck.translate(0, 0.07, 0.008);
  paintGeo(neck, (x, y, z, c) => { const k = 0.75 + 0.15 * smoothstep(-0.03, 0.12, y); c.setRGB(k, k * 0.96, k * 0.95); });
  const parts = [g, neck];
  // orejas
  for (const s of [-1, 1]) {
    const ear = new THREE.SphereGeometry(1, 10, 8);
    ear.scale(0.011, 0.028, 0.019);
    ear.rotateY(s * 0.35);
    ear.translate(s * 0.099, DIM.headC + 0.002, 0.012);
    paintGeo(ear, (x, y, z, c) => c.setRGB(0.85, 0.8, 0.78));
    parts.push(ear);
  }
  // dientes superiores de verdad (amarillentos, alguno roto o que falta)
  for (let i = 0; i < 8; i++) {
    if (r() < 0.18) continue;
    const a = -0.75 + (i / 7) * 1.5;
    const len = 0.011 + r() * 0.007;
    const t = new THREE.ConeGeometry(0.0045, len, 4, 1);
    t.rotateX(Math.PI);
    t.translate(0, -len / 2, 0);
    t.rotateZ((r() - 0.5) * 0.4);
    t.translate(Math.sin(a) * 0.034, DIM.headC - 0.036, -0.1 + (1 - Math.cos(a)) * 0.03);
    paintGeo(t, (x, y, z, c) => { const k = 0.65 + 0.25 * r(); c.setRGB(k, k * 0.9, k * 0.6); });
    parts.push(t);
  }
  return mergeGeos(parts);
}

function jawGeo(seed) {
  const g = new THREE.SphereGeometry(1, 12, 6, 0, TAU, Math.PI / 2, Math.PI / 2);
  paintGeo(g, (x, y, z, c) => {
    if (y > -0.2 && z < -0.35 && Math.abs(x) < 0.75) c.setRGB(0.7, 0.64, 0.44);       // dientes inferiores
    else if (y > -0.3) c.setRGB(0.3, 0.05, 0.04);                                     // encía / interior
    else c.setRGB(0.9, 0.85, 0.83);
    if (z < -0.3 && y < -0.5 && fbm(x * 4, z * 4, seed) > 0.45) c.multiply(new THREE.Color(0.6, 0.15, 0.12));
  });
  g.scale(0.074, 0.07, 0.092);
  g.translate(0, 0, -0.048);
  const r = rng(seed + 5);
  const parts = [g];
  for (let i = 0; i < 7; i++) {
    if (r() < 0.2) continue;
    const a = -0.7 + (i / 6) * 1.4;
    const len = 0.01 + r() * 0.008;
    const t = new THREE.ConeGeometry(0.0042, len, 4, 1);
    t.translate(0, len / 2, 0);
    t.rotateZ((r() - 0.5) * 0.4);
    t.translate(Math.sin(a) * 0.05, -0.004, -0.048 - Math.cos(a) * 0.075);
    paintGeo(t, (x, y, z, c) => { const k = 0.6 + 0.25 * r(); c.setRGB(k, k * 0.88, k * 0.58); });
    parts.push(t);
  }
  return mergeGeos(parts);
}

function eyesGeo() {
  const a = new THREE.SphereGeometry(0.0125, 8, 6);
  const b = new THREE.SphereGeometry(0.0125, 8, 6);
  a.translate(-0.036, DIM.headC + 0.007, -0.089);
  b.translate(0.036, DIM.headC + 0.007, -0.089);
  return mergeGeos([a, b]);
}

function haloGeo() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.036, DIM.headC + 0.007, -0.1, 0.036, DIM.headC + 0.007, -0.1,
  ]), 3));
  g.computeBoundingSphere();
  return g;
}

function hardHatGeo(color) {
  const dome = new THREE.SphereGeometry(0.126, 16, 6, 0, TAU, 0, Math.PI / 2);
  dome.scale(1, 0.92, 1.1);
  const brim = new THREE.CylinderGeometry(0.15, 0.152, 0.014, 18, 1);
  brim.scale(1, 1, 1.12);
  brim.translate(0, 0.004, -0.012);
  const ridge = new THREE.BoxGeometry(0.03, 0.02, 0.24);
  ridge.translate(0, 0.112, 0);
  const paint = (gg) => paintGeo(gg, (x, y, z, c) => {
    c.setRGB(color[0], color[1], color[2]);
    const n = fbm(x * 30 + 3, z * 30 + y * 20, 11, 2);
    c.multiplyScalar(0.7 + 0.35 * n);
  });
  [dome, brim, ridge].forEach(paint);
  const g = mergeGeos([dome, brim, ridge]);
  g.translate(0, DIM.headC + 0.035, 0);
  return g;
}

function policeCapGeo() {
  const crown = new THREE.CylinderGeometry(0.13, 0.108, 0.085, 16, 2);
  crown.translate(0, 0.04, 0.005);
  paintGeo(crown, (x, y, z, c) => {
    if (y < 0.03) c.setRGB(0.02, 0.02, 0.025);   // cinta negra
    else c.setRGB(0.1, 0.13, 0.22);
  });
  const visor = new THREE.CylinderGeometry(0.1, 0.1, 0.01, 12, 1, false, Math.PI / 2, Math.PI);
  visor.scale(1.05, 1, 0.75);
  visor.rotateX(0.25);
  visor.translate(0, -0.005, -0.075);
  solidColor(visor, 0.02, 0.02, 0.02);
  const badge = new THREE.BoxGeometry(0.03, 0.03, 0.01);
  badge.translate(0, 0.045, -0.118);
  solidColor(badge, 0.85, 0.65, 0.2);
  const g = mergeGeos([crown, visor, badge]);
  g.translate(0, DIM.headC + 0.06, 0);
  return g;
}

function goreGeo() {
  const g = new THREE.SphereGeometry(1, 9, 6);
  paintGeo(g, (x, y, z, c) => {
    const n = fbm(x * 3 + 7, z * 3 + y, 5, 2);
    if (y > 0.6 && n > 0.55) c.setRGB(0.85, 0.8, 0.7);   // hueso
    else c.setRGB(0.45 + n * 0.3, 0.04, 0.04);
  });
  g.scale(1, 0.45, 1);
  return g;
}

// --------------------------------------------------------------------------------------------
// Recursos compartidos
// --------------------------------------------------------------------------------------------
let ASSETS = null;

export function getZombieAssets(quality = 'high') {
  if (ASSETS) return ASSETS;
  const q = quality === 'low' ? 'low' : 'high';
  const A = { quality: q, tex: {}, mats: {}, geos: {}, heads: new Map() };
  A.tex.skin = canvasTexture(paintSkin(101));
  A.mats.skin = SKIN_TINTS.map((tint) => makeMat(q, { map: A.tex.skin, color: tint, vertexColors: true, roughness: 0.72 }));
  const shirtKinds = [...new Set(OUTFITS.map((o) => o.shirt))];
  const pantsKinds = [...new Set(OUTFITS.map((o) => o.pants))];
  shirtKinds.forEach((k, i) => {
    A.tex['shirt:' + k] = canvasTexture(paintShirt(k, 200 + i * 13));
    A.mats['shirt:' + k] = makeMat(q, { map: A.tex['shirt:' + k], vertexColors: true, roughness: 0.95 });
  });
  pantsKinds.forEach((k, i) => {
    A.tex['pants:' + k] = canvasTexture(paintPants(k, 400 + i * 17));
    A.mats['pants:' + k] = makeMat(q, { map: A.tex['pants:' + k], vertexColors: true, roughness: 0.95 });
  });
  A.mats.hat = makeMat(q, { vertexColors: true, roughness: 0.45 });
  A.mats.gore = makeMat(q, { vertexColors: true, roughness: 0.3, color: 0xffffff });
  A.mats.charred = makeMat(q, { color: 0x1c1714, roughness: 1, emissive: 0x160500 });
  A.mats.eyes = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.7, 0.16), toneMapped: false });
  A.tex.glow = glowTexture(64, 2.4);
  A.mats.halo = new THREE.PointsMaterial({
    size: 0.11, map: A.tex.glow, color: 0xff9420, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, toneMapped: false,
  });
  // Geometrías (algunas con variantes)
  A.geos.torso = [torsoGeo(1), torsoGeo(2), torsoGeo(3)];
  A.geos.pelvis = pelvisGeo();
  A.geos.thigh = thighGeo();
  A.geos.shin = shinGeo();
  A.geos.foot = footGeo();
  A.geos.upperSleeve = [upperArmSleeveGeo(5), upperArmSleeveGeo(9)];
  A.geos.upperBare = upperArmBareGeo();
  A.geos.forearm = [forearmGeo(21), forearmGeo(33), forearmGeo(47)];
  A.geos.jaw = [jawGeo(3), jawGeo(8)];
  A.geos.eyes = eyesGeo();
  A.geos.halo = haloGeo();
  A.geos.hardhat = hardHatGeo([0.85, 0.62, 0.08]);
  A.geos.hardhatW = hardHatGeo([0.82, 0.8, 0.76]);
  A.geos.police = policeCapGeo();
  A.geos.gore = goreGeo();
  ASSETS = A;
  return A;
}

function headFor(A, style, hairIdx) {
  const key = style + ':' + hairIdx;
  let g = A.heads.get(key);
  if (!g) { g = headGeo(style, hairIdx, 70 + style * 11 + hairIdx * 5); A.heads.set(key, g); }
  return g;
}

// Materiales compartidos (para precompilar sombreadores)
export function zombieMaterials(quality) {
  const A = getZombieAssets(quality);
  return Object.values(A.mats).flat();
}

// --------------------------------------------------------------------------------------------
// Resortes de reacción a impactos
// --------------------------------------------------------------------------------------------
class Spring {
  constructor() { this.v = 0; this.w = 0; }
  step(dt, k = 170, c = 13) {
    this.w += (-k * this.v - c * this.w) * dt;
    this.v += this.w * dt;
    if (this.v > 0.7) { this.v = 0.7; this.w = 0; }
    if (this.v < -0.7) { this.v = -0.7; this.w = 0; }
  }
}

const _q = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _axis = new THREE.Vector3();

function legH(swing, knee, splay, hipPitch) {
  const a = swing - hipPitch;
  return Math.cos(splay) * (DIM.thigh * Math.cos(a) + SHIN_FULL * Math.cos(a - knee));
}

// --------------------------------------------------------------------------------------------
// ZombieModel
// --------------------------------------------------------------------------------------------
// Materiales y geometrías de los tipos especiales (compartidos; los emisivos se animan por modelo en update)
let TYPE_ASSETS = null;
function typeAssets() {
  if (TYPE_ASSETS) return TYPE_ASSETS;
  TYPE_ASSETS = {
    eyesRed: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.12, 0.05), toneMapped: false }),
    bloat: new THREE.MeshStandardMaterial({ color: 0x8a8a5a, roughness: 0.55, metalness: 0 }),
    pustule: new THREE.MeshStandardMaterial({ color: 0x6a5a10, emissive: 0xffa020, emissiveIntensity: 1.2, roughness: 0.4 }),
    tankSkin: new THREE.MeshStandardMaterial({ color: 0x6f7560, roughness: 0.85, metalness: 0 }),
    sphere: new THREE.SphereGeometry(1, 20, 14),
    lump: new THREE.SphereGeometry(1, 10, 8),
    box: new RoundedBoxGeometry(1, 1, 1, 2, 0.18),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
    cone: new THREE.ConeGeometry(1, 1, 12, 1, true),
    // jefes
    eyesPurple: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 0.3, 1.0), toneMapped: false }),
    eyesYellow: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.85, 0.1), toneMapped: false }),
    eyesCyan: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.0, 1.0), toneMapped: false }),
    apron: new THREE.MeshStandardMaterial({ color: 0xc9c2b0, roughness: 0.9 }),
    blood: new THREE.MeshStandardMaterial({ color: 0x5a0808, roughness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x6a7078, roughness: 0.35, metalness: 0.85 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.45, metalness: 0.8 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.8 }),
    plague: new THREE.MeshStandardMaterial({ color: 0x5f7a2a, emissive: 0x2a5a08, emissiveIntensity: 0.5, roughness: 0.5 }),
    plagueSpot: new THREE.MeshStandardMaterial({ color: 0x3a5a10, emissive: 0x7aff3a, emissiveIntensity: 1.4, roughness: 0.4 }),
    robe: new THREE.MeshStandardMaterial({ color: 0x1e1426, roughness: 0.95, side: THREE.DoubleSide }),
    orb: new THREE.MeshBasicMaterial({ color: 0xc070ff, toneMapped: false }),
    glowTex: (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })(),
  };
  return TYPE_ASSETS;
}

export class ZombieModel {
  constructor(opts = {}) {
    const A = getZombieAssets(opts.quality);
    this.A = A;
    const seed = (opts.seed >>> 0) || ((Math.random() * 0xffffffff) >>> 0);
    const r = rng(seed);
    this.r = r;
    const outfit = OUTFITS[Number.isInteger(opts.variant) ? opts.variant % OUTFITS.length : Math.floor(r() * OUTFITS.length)];
    this.outfit = outfit;
    const shadows = A.quality !== 'low';
    this.meshes = [];
    const skin = A.mats.skin[Math.floor(r() * A.mats.skin.length)];
    const shirt = A.mats['shirt:' + outfit.shirt];
    const pants = A.mats['pants:' + outfit.pants];
    const mesh = (geo, mat, parent, shadow = false) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow && shadows;
      m.receiveShadow = false;
      parent.add(m);
      this.meshes.push(m);
      return m;
    };

    // Jerarquía
    this.group = new THREE.Group();
    this.group.name = 'zombie';
    const wscale = 0.95 + r() * 0.1;
    this.group.scale.set(wscale, 1, wscale);
    this.tilt = new THREE.Group();
    this.group.add(this.tilt);
    this.hips = new THREE.Group();
    this.hips.position.y = DIM.hipY;
    this.tilt.add(this.hips);
    mesh(A.geos.pelvis, pants, this.hips, true);

    const leg = (side) => {
      const th = new THREE.Group();
      th.position.set(side * DIM.hipJointX, DIM.hipJointY, 0);
      this.hips.add(th);
      const tm = mesh(A.geos.thigh, pants, th, true);
      const kn = new THREE.Group();
      kn.position.y = -DIM.thigh;
      th.add(kn);
      const sm = mesh(A.geos.shin, pants, kn, true);
      const an = new THREE.Group();                  // tobillo
      an.position.y = -DIM.shin;
      kn.add(an);
      const ft = mesh(A.geos.foot, pants, an, true);
      return { th, kn, tm, sm, an, ft };
    };
    this.legL = leg(-1);
    this.legR = leg(1);

    this.spine = new THREE.Group();
    this.hips.add(this.spine);
    this.torso = mesh(A.geos.torso[Math.floor(r() * A.geos.torso.length)], shirt, this.spine, true);

    this.neck = new THREE.Group();
    this.neck.position.set(0, DIM.neckY, 0.012);
    this.spine.add(this.neck);
    const hairStyle = outfit.key === 'policia' ? 1 : outfit.longHair ? 1 : Math.floor(r() * 3);
    this.hairIdx = Math.floor(r() * HAIR_COLORS.length);
    this.head = mesh(headFor(A, hairStyle, this.hairIdx), skin, this.neck, true);
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, DIM.headC - 0.035, -0.004);
    this.neck.add(this.jaw);
    mesh(A.geos.jaw[Math.floor(r() * A.geos.jaw.length)], skin, this.jaw);
    this.eyes = mesh(A.geos.eyes, A.mats.eyes, this.neck);
    this.halo = new THREE.Points(A.geos.halo, A.mats.halo);
    this.halo.renderOrder = 4;
    this.neck.add(this.halo);
    this.hat = null;
    if (outfit.hat && r() < (outfit.hatChance || 0.5)) this.hat = mesh(A.geos[outfit.hat], A.mats.hat, this.neck);
    this.headPt = new THREE.Object3D();
    this.headPt.position.set(0, DIM.headC - 0.01, -0.01);
    this.neck.add(this.headPt);

    const arm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(side * DIM.shoulderX, DIM.shoulderY, 0.005);
      this.spine.add(sh);
      const bare = r() < (outfit.bareArms != null ? outfit.bareArms : outfit.shirt === 'vest' ? 0.15 : 0.3);
      const um = bare
        ? mesh(A.geos.upperBare, skin, sh)
        : mesh(A.geos.upperSleeve[Math.floor(r() * A.geos.upperSleeve.length)], shirt, sh);
      const el = new THREE.Group();
      el.position.y = -DIM.upperArm;
      sh.add(el);
      const fm = mesh(A.geos.forearm[Math.floor(r() * A.geos.forearm.length)], skin, el);
      const hand = new THREE.Object3D();
      hand.position.y = -DIM.forearm - 0.06;
      el.add(hand);
      return { sh, el, um, fm, hand };
    };
    this.armL = arm(-1);
    this.armR = arm(1);

    // Parámetros de personalidad (fase y estilo distintos por zombi)
    this.p = {
      phase: r() * TAU,
      limpSide: r() < 0.5 ? -1 : 1,
      limp: 0.15 + r() * 0.85,
      armStyle: Math.floor(r() * 4),
      headTilt: (r() - 0.5) * 0.5,
      headTurn: (r() - 0.5) * 0.3,
      hunch: r() * 0.18,
      gait: 0.88 + r() * 0.25,
      sway: 0.7 + r() * 0.6,
      jaw: r() * 0.2,
      sprintStyle: r() < 0.55 ? 0 : 1,
      reach: 0.85 + r() * 0.35,
      tempo: 0.85 + r() * 0.3,
      // 0 = arrastra los pies, 1 = cojo que arrastra una pierna, 2 = acechador encorvado, 3 = rígido que se balancea
      gaitStyle: [0, 0, 1, 2, 3][Math.floor(r() * 5)],
      brokenArm: r() < 0.14 ? (r() < 0.5 ? -1 : 1) : 0,   // un brazo colgando roto
    };
    this.tp = new Float32Array(NP);
    this.cp = new Float32Array(NP);
    this.spr = { lean: new Spring(), roll: new Spring(), twist: new Spring(), nod: new Spring(), tilt: new Spring(), knee: new Spring(), armL: new Spring(), armR: new Spring() };
    this.anim = -1;
    this.animT = 0;
    this.time = r() * 10;
    this.cycle = 0;
    this.swingSide = r() < 0.5 ? -1 : 1;
    this.jawBoost = 0;
    this.stepped = false;
    this.crawler = false;
    this.becameCrawler = false;
    this._crawlBlend = 1;
    this.death = null;
    this.fade = null;
    this.flags = 0;
    this.pieces = [];
    this._goreCaps = [];
    this._fadeMats = null;
    this.type = opts.type || 'normal';
    this._decorateType(this.type, r);
    this.strideScale = this.group.scale.y;
    this._poseIdle(0);
    this.cp.set(this.tp);
    this._apply();
  }

  // Halo luminoso (sprite aditivo) pegado al modelo o a una pieza
  _aura(color, size, opacity, parent = null) {
    const T = typeAssets();
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glowTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.set(size, size, 1);
    if (parent) parent.add(s); else { s.position.y = 1.0; this.group.add(s); }
    this.auraSprite = s;
    this.auraBase = opacity;
  }

  // Aspecto de los tipos especiales: corredor (delgado, ojos rojos), explosivo (hinchado con pústulas brillantes)
  // y tanque (enorme, hombros y antebrazos de gorila, joroba)
  _decorateType(type, r) {
    const T = typeAssets();
    if (type === 'normal' || hasTypeModel(type)) {
      const shadows = this.A.quality !== 'low';
      const K = {
        T, DIM, r,
        P: { HIPY, HIPZ, HIPP, HIPYAW, HIPROLL, LEAN, TWIST, ROLL, NOD, TURN, TILT, JAW, LRAISE, LSPLAY, LTWIST, LELB,
          RRAISE, RSPLAY, RTWIST, RELB, LSWING, LLSPLAY, LKNEE, RSWING, RLSPLAY, RKNEE, LIFT },
        mesh: (geo, mat, parent, shadow = false) => {
          const m = new THREE.Mesh(geo, mat);
          m.castShadow = shadow && shadows;
          m.userData.typePart = true;
          parent.add(m);
          this.meshes.push(m);
          return m;
        },
        // grupo de la mandíbula (se anima con JAW) sin la mandíbula base
        jaw: () => { for (const m of this.jaw.children) if (m.isMesh && !m.userData.typePart) m.visible = false; this.jaw.visible = true; return this.jaw; },
        // oculta partes del zombi base que el tipo sustituye
        hideBase: (o) => {
          if (o.head) { this.head.visible = false; this.jaw.visible = false; if (this.hat) this.hat.visible = false; }
          if (o.torso) this.torso.visible = false;
          if (o.pelvis) for (const m of this.hips.children) if (m.isMesh) m.visible = false;
          if (o.arms) for (const a of [this.armL, this.armR]) { a.um.visible = false; a.fm.visible = false; }
          if (o.legs) for (const l of [this.legL, this.legR]) { l.tm.visible = false; l.sm.visible = false; l.ft.visible = false; }
        },
      };
      K.outfit = this.outfit;
      K.hairColor = HAIR_COLORS[this.hairIdx % HAIR_COLORS.length];
      K.shirtMat = this.torso.material;
      K.pantsMat = this.legL.tm.material;
      this.kit = type === 'normal' ? decorateCommon(this, K) : buildTypeModel(this, type, K);
      return;
    }
    const add = (parent, geo, mat, x, y, z, sx, sy = sx, sz = sx) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = this.A.quality !== 'low';
      parent.add(m);
      this.meshes.push(m);
      return m;
    };
    if (type === 'runner' || type === 'tank') this.eyes.material = T.eyesRed;
    if (type === 'runner') {
      this.group.scale.set(0.9, 0.98, 0.9);
    } else if (type === 'bomber') {
      this.group.scale.set(1.14, 1.0, 1.14);
      add(this.spine, T.sphere, T.bloat, 0, 0.2, -0.09, 0.25, 0.27, 0.22);          // barriga hinchada
      add(this.spine, T.sphere, T.bloat, 0, 0.42, 0.06, 0.2, 0.17, 0.16);           // espalda
      this.pustules = [];
      const spots = [[0.1, 0.24, -0.29], [-0.12, 0.14, -0.28], [0.02, 0.36, -0.24], [-0.16, 0.3, -0.18],
        [0.17, 0.08, -0.2], [0.1, 0.5, 0.18], [-0.09, 0.44, 0.2]];
      for (const [x, y, z] of spots) this.pustules.push(add(this.spine, T.lump, T.pustule, x, y, z, 0.035 + r() * 0.03));
      for (const side of [this.armL, this.armR]) add(side.el, T.lump, T.pustule, 0, -0.1, -0.04, 0.03);
      // material propio para poder hacerlo parpadear con la mecha sin afectar a los demás
      this.pustMat = T.pustule.clone();
      for (const p of this.pustules) p.material = this.pustMat;
    } else if (type === 'butcher') {
      // El Carnicero: enorme, delantal ensangrentado y cuchilla de carnicero
      this.eyes.material = T.eyesRed;
      this.group.scale.set(1.7, 1.7, 1.7);
      add(this.spine, T.box, T.apron, 0, 0.18, -0.16, 0.36, 0.52, 0.03);
      add(this.spine, T.box, T.blood, 0.05, 0.1, -0.178, 0.2, 0.22, 0.01);
      add(this.spine, T.sphere, T.tankSkin, 0, 0.5, 0.08, 0.24, 0.18, 0.2);
      for (const side of [this.armL, this.armR]) add(side.sh, T.sphere, T.tankSkin, 0, -0.05, 0, 0.12, 0.14, 0.12);
      add(this.armR.hand, T.cyl, T.wood, 0, 0, 0, 0.018, 0.12, 0.018);
      add(this.armR.hand, T.box, T.steel, 0, -0.16, -0.07, 0.012, 0.22, 0.16);
    } else if (type === 'plague') {
      // La Madre Plaga: hinchada, verde, con pústulas y un aura tóxica
      this.group.scale.set(1.55, 1.4, 1.55);
      add(this.spine, T.sphere, T.plague, 0, 0.22, -0.06, 0.3, 0.32, 0.27);
      add(this.spine, T.sphere, T.plague, 0, 0.46, 0.08, 0.22, 0.18, 0.18);
      this.pustMat = T.plagueSpot.clone();
      this.pustules = [];
      for (let i = 0; i < 12; i++) {
        const a = r() * Math.PI * 2, y = 0.05 + r() * 0.5;
        this.pustules.push(add(this.spine, T.lump, this.pustMat, Math.cos(a) * 0.27, y, Math.sin(a) * 0.25, 0.03 + r() * 0.03));
      }
      this._aura(0x7aff3a, 3.2, 0.35);
    } else if (type === 'necro') {
      // El Nigromante: alto, túnica y capucha, bastón con un orbe morado
      this.eyes.material = T.eyesPurple;
      this.group.scale.set(1.2, 1.4, 1.2);
      const hood = add(this.neck, T.cone, T.robe, 0, 0.26, 0.02, 0.17, 0.34, 0.17);
      hood.rotation.x = 0.15;
      add(this.hips, T.cone, T.robe, 0, -0.38, 0, 0.3, 0.9, 0.3);
      add(this.spine, T.cyl, T.robe, 0, 0.3, 0, 0.19, 0.6, 0.15);
      add(this.armR.hand, T.cyl, T.wood, 0, 0.1, 0, 0.015, 1.3, 0.015);
      this.orb = add(this.armR.hand, T.sphere, T.orb, 0, 0.78, 0, 0.06);
      this._aura(0xb050ff, 1.3, 0.8, this.orb);
    } else if (type === 'armored') {
      // El Acorazado: placas de acero; la cara queda al descubierto (punto débil)
      this.eyes.material = T.eyesYellow;
      this.group.scale.set(1.6, 1.6, 1.6);
      add(this.spine, T.box, T.steel, 0, 0.28, -0.13, 0.42, 0.48, 0.08);
      add(this.spine, T.box, T.steel, 0, 0.3, 0.12, 0.42, 0.5, 0.08);
      add(this.hips, T.box, T.darkSteel, 0, -0.08, -0.12, 0.36, 0.2, 0.06);
      for (const side of [this.armL, this.armR]) {
        add(side.sh, T.box, T.steel, 0, 0.0, 0, 0.2, 0.1, 0.22);
        add(side.el, T.box, T.darkSteel, 0, -0.12, 0, 0.1, 0.2, 0.1);
      }
      for (const leg of [this.legL, this.legR]) add(leg.kn, T.box, T.darkSteel, 0, -0.14, -0.05, 0.12, 0.26, 0.05);
      add(this.neck, T.sphere, T.darkSteel, 0, 0.25, 0.02, 0.13, 0.09, 0.14);       // casco (sin visera)
    } else if (type === 'specter') {
      // El Espectro: pálido y translúcido; casi invisible cuando se camufla (ZF.CLOAK)
      this.eyes.material = T.eyesCyan;
      this.group.scale.set(1.15, 1.3, 1.15);
      this._ghostMats = new Map();
      this.group.traverse((o) => {
        if (!o.isMesh || o === this.eyes) return;
        let g = this._ghostMats.get(o.material);
        if (!g) {
          g = o.material.clone();
          g.transparent = true;
          g.depthWrite = false;
          if (g.color) g.color.lerp(new THREE.Color(0xcfe8ff), 0.55);
          if (g.emissive) { g.emissive.setHex(0x3a6a8a); g.emissiveIntensity = 0.6; }
          this._ghostMats.set(o.material, g);
        }
        o.material = g;
      });
      this._aura(0x9ad8ff, 2.2, 0.25);
    } else if (type === 'tank') {
      this.group.scale.set(1.5, 1.5, 1.5);
      add(this.spine, T.sphere, T.tankSkin, 0, 0.5, 0.1, 0.28, 0.22, 0.22);         // joroba
      for (const side of [this.armL, this.armR]) {
        add(side.sh, T.sphere, T.tankSkin, 0, -0.03, 0, 0.14, 0.15, 0.13);            // hombro
        add(side.sh, T.sphere, T.tankSkin, 0, -0.14, 0, 0.1, 0.16, 0.1);              // bíceps
        add(side.el, T.sphere, T.tankSkin, 0, -0.12, -0.01, 0.1, 0.17, 0.1);          // antebrazo
        add(side.hand, T.sphere, T.tankSkin, 0, 0.02, -0.01, 0.085, 0.08, 0.09);      // puño
      }
    }
  }

  // ------------------------------------------------------------------ Actualización por frame
  // st: { anim, flags, speed, yOff }
  update(dt, st) {
    this.time += dt;
    if (this.death) return;
    const flags = st.flags | 0;
    this.flags = flags;
    const crawler = !!(flags & ZF.CRAWLER) || st.anim === ZA.CRAWL;
    if (crawler && !this.crawler) this._becomeCrawler();
    const headless = !!(flags & ZF.NOHEAD);
    if (headless && this.neck.visible) this._removeHead(null);
    this._pose(dt, st, crawler);
    if (this.kit && this.kit.update) this.kit.update(dt, flags);
    if (this.auraSprite) this.auraSprite.material.opacity = this.auraBase * (0.75 + 0.25 * Math.sin(this.time * 3));
    if (this._ghostMats) {
      const cloak = !!(flags & ZF.CLOAK);
      this._ghost = (this._ghost == null ? 0.8 : this._ghost) + ((cloak ? 0.08 : 0.8) - (this._ghost == null ? 0.8 : this._ghost)) * Math.min(1, dt * 5);
      const o = this._ghost * (cloak ? 0.7 + 0.3 * Math.sin(this.time * 17) : 1);
      for (const m of this._ghostMats.values()) m.opacity = o;
      this.eyes.visible = !cloak || Math.sin(this.time * 9) > 0.6;
      if (this.auraSprite) this.auraSprite.visible = !cloak;
    }
    if (this.type === 'plague' && this.pustMat) {
      this.pustMat.emissiveIntensity = 1.0 + 0.6 * Math.sin(this.time * 2);
    } else if (this.pustMat) {
      // pústulas: latido lento; con la mecha encendida, parpadeo rápido y más fuerte
      const fuse = !!(flags & ZF.FUSE);
      this.pustMat.emissiveIntensity = fuse ? (Math.sin(this.time * 28) > 0 ? 4 : 0.4) : 0.9 + 0.5 * Math.sin(this.time * 2.5);
      if (fuse) this.pustMat.emissive.setHex(0xff3010); else this.pustMat.emissive.setHex(0xffa020);
    }
    // suavizado hacia la pose objetivo
    const rate = this._crawlBlend < 1 ? 5 : 11;
    this._crawlBlend = Math.min(1, this._crawlBlend + dt * 2);
    const tp = this.tp, cp = this.cp;
    const slow = this._crawlBlend < 1;
    for (let i = 0; i < NP; i++) cp[i] += (tp[i] - cp[i]) * (1 - Math.exp(-(slow ? rate : RATE[i]) * dt));
    // espasmos: cada pocos segundos la cabeza y el cuello dan un tirón brusco
    this._twitchT = (this._twitchT ?? 1 + Math.random() * 4) - dt;
    if (this._twitchT <= 0) {
      this._twitchT = 1.5 + Math.random() * 4.5;
      const S = this.spr, sgn = Math.random() < 0.5 ? -1 : 1;
      S.tilt.w += sgn * (5 + Math.random() * 6);
      S.nod.w += (Math.random() - 0.35) * 7;
      if (Math.random() < 0.4) S.twist.w += (Math.random() - 0.5) * 7;
      this.jawBoost = Math.max(this.jawBoost, 0.5);
    }
    // resortes de impacto
    for (const key in this.spr) this.spr[key].step(dt);
    this.jawBoost = Math.max(0, this.jawBoost - dt * 1.2);
    this._apply();
    this.group.position.y = (st.yOff || 0) + cp[LIFT];
  }

  // ------------------------------------------------------------------ Poses por animación
  _base(tp) {
    tp.fill(0);
    tp[LEAN] = 0.12 + this.p.hunch;
    tp[NOD] = 0.08;
    tp[JAW] = 0.12 + this.p.jaw;
    tp[LRAISE] = tp[RRAISE] = 0.2;
    tp[LELB] = tp[RELB] = 0.25;
    tp[LSPLAY] = tp[RSPLAY] = 0.1;
    tp[LKNEE] = tp[RKNEE] = 0.06;
    tp[LLSPLAY] = tp[RLSPLAY] = 0.04;
    tp[TILT] = this.p.headTilt;
    tp[TURN] = this.p.headTurn;
  }

  // Altura de cadera para que el pie de apoyo toque el suelo. maxDrop limita cuánto baja
  // (así la cabeza no se aleja de la caja de impacto); bob >= 0 levanta el cuerpo (fase de vuelo).
  _ground(tp, bob = 0, maxDrop = 0.08) {
    const hl = legH(tp[LSWING], tp[LKNEE], tp[LLSPLAY], tp[HIPP]);
    const hr = legH(tp[RSWING], tp[RKNEE], tp[RLSPLAY], tp[HIPP]);
    const h = -DIM.hipJointY + Math.max(hl, hr);
    tp[HIPY] = Math.max(h, DIM.hipY - maxDrop) + bob;
  }

  _armsForward(tp, c, amt = 1) {
    const P = this.p;
    const style = P.armStyle;
    const raised = 1.22 * P.reach;
    const L = style === 0 || style === 1, R = style === 0 || style === 2;
    if (L) { tp[LRAISE] = raised + 0.1 * Math.sin(c + Math.PI) * amt; tp[LELB] = 0.35 + 0.12 * Math.sin(c + 1); tp[LSPLAY] = 0.12; }
    else { tp[LRAISE] = 0.15 + 0.3 * Math.sin(c) * amt; tp[LELB] = 0.2; tp[LSPLAY] = 0.08; }
    if (R) { tp[RRAISE] = raised + 0.1 * Math.sin(c) * amt; tp[RELB] = 0.35 + 0.12 * Math.sin(c + 2); tp[RSPLAY] = 0.12; }
    else { tp[RRAISE] = 0.15 - 0.3 * Math.sin(c) * amt; tp[RELB] = 0.2; tp[RSPLAY] = 0.08; }
    if (style === 3) {
      tp[LRAISE] = 0.55 + 0.35 * Math.sin(c + Math.PI); tp[RRAISE] = 0.55 + 0.35 * Math.sin(c);
      tp[LELB] = tp[RELB] = 0.5;
    }
  }

  _pose(dt, st, crawler) {
    const tp = this.tp, P = this.p;
    const anim = st.anim | 0;
    if (anim !== this.anim) {
      this.anim = anim;
      this.animT = 0;
      if (anim === ZA.ATTACK) {
        this.swingSide = -this.swingSide;
        // zarpazo, agarrón con mordisco o martillazo con los dos puños (los jefes usan los suyos)
        const q = Math.random();
        this.atkStyle = this.kit && this.kit.attackStyle != null ? this.kit.attackStyle : this.kit && this.kit.ownAttack ? 0 : this.type !== 'normal' && this.type !== 'runner' ? 0 : q < 0.45 ? 0 : q < 0.8 ? 1 : 2;
      }
    }
    this.animT += dt;
    // ciclo de marcha acorde a la velocidad real de desplazamiento
    const speed = Math.max(0, st.speed || 0);
    let stride = 1.2 * P.gait;
    if (crawler) stride = 0.7;
    else if (anim === ZA.RUN) stride = 1.9;
    else if (anim === ZA.SPRINT) stride = 2.4;
    stride *= this.strideScale || 1;                 // los grandes dan zancadas más largas y lentas
    const locomotion = crawler ? (anim !== ZA.ATTACK && anim !== ZA.TEAR && anim !== ZA.STUN)
      : (anim === ZA.WALK || anim === ZA.RUN || anim === ZA.SPRINT);
    let rate = (speed / stride) * TAU;
    if (locomotion && speed < 0.25) rate = Math.max(rate, 2.0 * P.tempo);
    if (!locomotion) rate = Math.min(rate, 1.5);
    rate = Math.min(rate, 16);
    const prev = this.cycle;
    this.cycle += rate * dt;
    if (Math.floor(this.cycle / Math.PI) !== Math.floor(prev / Math.PI) && locomotion) this.stepped = true;
    const c = this.cycle + P.phase;
    this._base(tp);
    if (crawler) {
      this._poseCrawl(c, anim);
    } else {
      switch (anim) {
        case ZA.WALK: this._poseWalk(c); break;
        case ZA.RUN: this._poseRun(c); break;
        case ZA.SPRINT: this._poseSprint(c); break;
        case ZA.ATTACK: if (this.kit && this.kit.ownAttack) this._poseIdle(this.time); else this._poseAttack(); break;
        case ZA.TEAR: this._poseTear(); break;
        case ZA.CLIMB: this._poseClimb(); break;
        case ZA.RISE: this._poseRise(); break;
        case ZA.STUN: this._poseStun(); break;
        default: this._poseIdle(this.time); break;
      }
      if (this.kit && this.kit.pose) this.kit.pose(tp, anim, c);
      // La cabeza debe quedar sobre (x, z) como en ZOMBIE_HITBOX: la cadera retrocede lo que avanza la cabeza
      const lean = tp[LEAN], nod = tp[NOD];
      tp[HIPZ] += 0.9 * (DIM.neckY * Math.sin(lean) + DIM.headC * Math.sin(lean + nod));
    }
    // mandíbula: gruñidos
    if (this.jawBoost > 0) tp[JAW] += 0.45 * this.jawBoost * (0.65 + 0.35 * Math.sin(this.time * 17));
  }

  _poseIdle(t) {
    const tp = this.tp, P = this.p;
    this._base(tp);
    const s = t * P.tempo + P.phase;
    const shift = Math.sin(s * 0.35);                                // pasa el peso de una pierna a otra
    tp[LEAN] = 0.14 + P.hunch + 0.035 * Math.sin(s * 1.1);          // respiración
    tp[ROLL] = 0.07 * Math.sin(s * 0.8) * P.sway + 0.05 * shift;
    tp[HIPROLL] = 0.035 * Math.sin(s * 0.8) - 0.05 * shift;
    tp[TWIST] = 0.06 * Math.sin(s * 0.45);
    tp[NOD] = 0.12 + 0.06 * Math.sin(s * 0.6);
    tp[TILT] = P.headTilt + 0.12 * Math.sin(s * 0.5);
    // mira a un lado y a otro, olfateando
    tp[TURN] = P.headTurn + 0.45 * Math.sin(s * 0.23) * Math.abs(Math.sin(s * 0.11));
    tp[JAW] = 0.15 + P.jaw + 0.18 * Math.max(0, Math.sin(s * 2.7)) * Math.max(0, Math.sin(s * 0.4));
    this._armsForward(tp, s * 1.3, 0.6);
    tp[LRAISE] *= 0.85; tp[RRAISE] *= 0.85;
    tp[LSWING] = 0.05 * Math.sin(s * 0.8); tp[RSWING] = -0.05 * Math.sin(s * 0.8);
    tp[LKNEE] = 0.08 + 0.1 * Math.max(0, shift); tp[RKNEE] = 0.08 + 0.1 * Math.max(0, -shift);
    this._brokenArm(tp, s * 1.3);
    this._ground(tp);
  }

  // Brazo roto: cuelga sin fuerza, girado, y oscila como un péndulo
  _brokenArm(tp, c) {
    const b = this.p.brokenArm;
    if (!b) return;
    const sw = 0.12 + 0.22 * Math.sin(c + 1.9);
    if (b < 0) { tp[LRAISE] = sw; tp[LELB] = 0.05; tp[LTWIST] = 0.7; tp[LSPLAY] = 0.04; }
    else { tp[RRAISE] = sw; tp[RELB] = 0.05; tp[RTWIST] = 0.7; tp[RSPLAY] = 0.04; }
  }

  _poseWalk(c) {
    const tp = this.tp, P = this.p;
    const s = Math.sin(c), co = Math.cos(c);
    const st = P.gaitStyle;
    const A = st === 2 ? 0.34 : st === 3 ? 0.3 : 0.38;
    let ls = A * s, rs = -A * s;
    const kb = st === 2 ? 0.32 : st === 3 ? 0.04 : 0.12;          // rodillas: flexionadas (acechador) o rígidas
    const ka = st === 3 ? 0.2 : 0.62;
    let lk = kb + ka * Math.max(0, co), rk = kb + ka * Math.max(0, -co);
    // puntera: baja al levantar el pie
    tp[LTOE] = 0.28 * Math.max(0, co); tp[RTOE] = 0.28 * Math.max(0, -co);
    tp[LEAN] = 0.2 + P.hunch + 0.04 * Math.sin(2 * c);
    tp[NOD] = 0.1 + 0.07 * Math.sin(2 * c + 0.8) + 0.05 * Math.abs(s);   // la cabeza cae con cada pisada
    tp[TILT] = P.headTilt + 0.1 * Math.sin(c + 1);
    tp[TURN] = P.headTurn + 0.06 * Math.sin(c * 0.5);
    tp[JAW] = 0.15 + P.jaw + 0.12 * Math.sin(this.time * 3.1 + P.phase);
    tp[HIPYAW] = -0.12 * s;
    tp[HIPROLL] = 0.06 * s * P.sway;
    tp[TWIST] = 0.12 * s;
    tp[ROLL] = 0.1 * s * P.sway + P.limpSide * 0.07 * P.limp;
    this._armsForward(tp, c, 1);
    let maxDrop = 0.06;
    if (st === 0) {
      // cojera ligera: la pierna mala se arrastra (menos rodilla y menos zancada)
      if (P.limpSide < 0) { ls *= 1 - 0.45 * P.limp; lk = 0.08 + (lk - 0.08) * (1 - 0.75 * P.limp); }
      else { rs *= 1 - 0.45 * P.limp; rk = 0.08 + (rk - 0.08) * (1 - 0.75 * P.limp); }
    } else if (st === 1) {
      // arrastra una pierna rígida con la puntera por el suelo; el cuerpo se vence hacia ese lado
      const bad = P.limpSide;
      const sb = bad < 0 ? s : -s;                              // fase de la pierna mala
      if (bad < 0) { ls = 0.16 * s; lk = 0.05; tp[LTOE] = 0.75; tp[LLSPLAY] = 0.1; rs = -0.46 * s; rk = 0.15 + 0.75 * Math.max(0, -co); }
      else { rs = -0.16 * s; rk = 0.05; tp[RTOE] = 0.75; tp[RLSPLAY] = 0.1; ls = 0.46 * s; lk = 0.15 + 0.75 * Math.max(0, co); }
      const lurch = Math.max(0, -sb);                             // cuando apoya la pierna mala
      tp[ROLL] = bad * (0.08 + 0.12 * lurch);
      tp[HIPROLL] = -bad * 0.08 * lurch;
      tp[TILT] = P.headTilt + bad * 0.18 * lurch;
      tp[LEAN] = 0.26 + P.hunch;
      maxDrop = 0.09;
    } else if (st === 2) {
      // acechador: muy encorvado, cabeza levantada mirando al frente, brazos bajos y largos
      tp[LEAN] = 0.45 + P.hunch * 0.5 + 0.03 * Math.sin(2 * c);
      tp[NOD] = -0.22 + 0.04 * Math.abs(s);
      tp[TURN] = P.headTurn * 0.5 + 0.15 * Math.sin(this.time * 1.7 + P.phase);
      tp[JAW] = 0.35 + 0.15 * Math.sin(this.time * 4 + P.phase);
      tp[LRAISE] = 0.6 + 0.2 * Math.sin(c + Math.PI); tp[RRAISE] = 0.6 + 0.2 * s;
      tp[LELB] = tp[RELB] = 0.55; tp[LSPLAY] = tp[RSPLAY] = 0.2;
      maxDrop = 0.13;
    } else {
      // rígido: rodillas bloqueadas, se balancea de lado a lado con la cabeza colgando
      tp[ROLL] = 0.2 * s * P.sway; tp[HIPROLL] = 0.12 * s;
      tp[TWIST] = 0.05 * s;
      tp[NOD] = 0.28 + 0.05 * Math.abs(s);
      tp[TILT] = P.headTilt + 0.3 * Math.sin(c + 0.6);
      tp[LLSPLAY] = tp[RLSPLAY] = 0.07;
    }
    tp[LSWING] = ls; tp[RSWING] = rs; tp[LKNEE] = lk; tp[RKNEE] = rk;
    this._brokenArm(tp, c);
    this._ground(tp, 0, maxDrop);
  }

  _poseRun(c) {
    const tp = this.tp, P = this.p;
    const s = Math.sin(c), co = Math.cos(c);
    tp[LSWING] = 0.62 * s; tp[RSWING] = -0.62 * s;
    tp[LKNEE] = 0.25 + 1.0 * Math.max(0, co); tp[RKNEE] = 0.25 + 1.0 * Math.max(0, -co);
    tp[LTOE] = 0.4 * Math.max(0, co); tp[RTOE] = 0.4 * Math.max(0, -co);
    tp[HIPYAW] = -0.16 * s;
    tp[HIPROLL] = 0.05 * s;
    tp[LEAN] = 0.26 + P.hunch * 0.5;
    tp[TWIST] = 0.2 * s;
    tp[ROLL] = 0.08 * s * P.sway;
    tp[NOD] = -0.02 + 0.05 * Math.sin(2 * c);
    tp[TILT] = P.headTilt * 0.6;
    tp[JAW] = 0.35 + 0.15 * Math.sin(this.time * 5 + P.phase);
    // brazos que se agitan hacia delante
    tp[LRAISE] = 1.15 * P.reach + 0.38 * Math.sin(c + Math.PI); tp[RRAISE] = 1.15 * P.reach + 0.38 * Math.sin(c);
    tp[LELB] = 0.35 + 0.2 * Math.max(0, Math.sin(c)); tp[RELB] = 0.35 + 0.2 * Math.max(0, -Math.sin(c));
    tp[LSPLAY] = tp[RSPLAY] = 0.18;
    this._ground(tp, 0.03 * Math.abs(Math.sin(2 * c)), 0.06);
  }

  _poseSprint(c) {
    const tp = this.tp, P = this.p;
    const s = Math.sin(c), co = Math.cos(c);
    tp[LSWING] = 0.8 * s; tp[RSWING] = -0.8 * s;
    tp[LKNEE] = 0.35 + 1.3 * Math.max(0, co); tp[RKNEE] = 0.35 + 1.3 * Math.max(0, -co);
    tp[LTOE] = 0.5 * Math.max(0, co); tp[RTOE] = 0.5 * Math.max(0, -co);
    tp[HIPYAW] = -0.18 * s;
    tp[LEAN] = 0.32;
    tp[TWIST] = 0.24 * s;
    tp[ROLL] = 0.06 * s;
    tp[NOD] = -0.3;                  // cabeza erguida mirando al objetivo
    tp[JAW] = 0.55 + 0.2 * Math.sin(this.time * 7);
    if (P.sprintStyle === 0) {
      // brazos que bombean como un corredor
      tp[LRAISE] = 0.35 - 1.0 * s; tp[RRAISE] = 0.35 + 1.0 * s;
      tp[LELB] = tp[RELB] = 1.35;
      tp[LSPLAY] = tp[RSPLAY] = 0.12;
    } else {
      // brazos extendidos agitándose
      tp[LRAISE] = 1.45 + 0.45 * Math.sin(c * 2 + 1); tp[RRAISE] = 1.45 + 0.45 * Math.sin(c * 2);
      tp[LELB] = tp[RELB] = 0.2;
      tp[LSPLAY] = tp[RSPLAY] = 0.3;
    }
    this._ground(tp, 0.04 * Math.abs(Math.sin(2 * c)), 0.07);
  }

  _poseAttack() {
    const tp = this.tp, P = this.p;
    const period = 1.1;
    const tt = this.animT % period;
    if (this.atkStyle === 1) { this._poseGrabBite(tt, period); return; }
    if (this.atkStyle === 2) { this._poseHammer(tt, period); return; }
    const sd = this.swingSide; // +1 brazo derecho
    let raise, splay, elbow, twist, lean;
    if (tt < 0.28) {
      const k = easeInOut(tt / 0.28);
      raise = 1.3 + 1.45 * k; splay = 0.15 + 0.3 * k; elbow = 0.3 + 1.0 * k; twist = -0.35 * sd * k; lean = 0.15 - 0.08 * k;
    } else if (tt < 0.46) {
      const k = easeInOut((tt - 0.28) / 0.18);
      raise = 2.75 - 2.2 * k; splay = 0.45 - 0.65 * k; elbow = 1.3 - 1.15 * k; twist = sd * (-0.35 + 0.7 * k); lean = 0.07 + 0.3 * k;
    } else {
      const k = easeInOut((tt - 0.46) / (period - 0.46));
      raise = 0.55 + 0.75 * k; splay = -0.2 + 0.35 * k; elbow = 0.15 + 0.15 * k; twist = sd * 0.35 * (1 - k); lean = 0.37 - 0.2 * k;
    }
    if (sd > 0) { tp[RRAISE] = raise; tp[RSPLAY] = splay; tp[RELB] = elbow; tp[LRAISE] = 1.35 * P.reach; tp[LELB] = 0.45; tp[LSPLAY] = 0.12; }
    else { tp[LRAISE] = raise; tp[LSPLAY] = splay; tp[LELB] = elbow; tp[RRAISE] = 1.35 * P.reach; tp[RELB] = 0.45; tp[RSPLAY] = 0.12; }
    tp[TWIST] = twist;
    tp[LEAN] = lean + P.hunch * 0.5;
    tp[HIPYAW] = -twist * 0.3;
    tp[NOD] = -0.12;
    tp[JAW] = 0.55 + 0.2 * Math.sin(this.time * 9);
    tp[LSWING] = 0.22 * sd; tp[RSWING] = -0.22 * sd;
    tp[LKNEE] = 0.25; tp[RKNEE] = 0.25;
    this._ground(tp);
  }

  // Agarrón con mordisco: abre los brazos, se lanza hacia delante cerrándolos y muerde
  _poseGrabBite(tt, period) {
    const tp = this.tp, P = this.p;
    let raise, splay, elbow, lean, nod, jaw, hz;
    if (tt < 0.3) {
      const k = easeInOut(tt / 0.3);
      raise = 1.2 + 0.35 * k; splay = 0.15 + 0.35 * k; elbow = 0.35 - 0.2 * k; lean = 0.15 - 0.12 * k; nod = 0.05 - 0.25 * k; jaw = 0.3 + 0.7 * k; hz = 0.03 * k;
    } else if (tt < 0.48) {
      const k = easeInOut((tt - 0.3) / 0.18);
      raise = 1.55 - 0.1 * k; splay = 0.5 - 0.65 * k; elbow = 0.15 + 0.9 * k; lean = 0.03 + 0.5 * k; nod = -0.2 + 0.35 * k; jaw = 1.0 - 0.8 * k; hz = 0.03 - 0.09 * k;
    } else {
      const k = easeInOut((tt - 0.48) / (period - 0.48));
      raise = 1.45 - 0.2 * k; splay = -0.15 + 0.27 * k; elbow = 1.05 - 0.7 * k; lean = 0.53 - 0.35 * k; nod = 0.15 - 0.05 * k; jaw = 0.2 + 0.3 * Math.sin(this.time * 12) * (1 - k); hz = -0.06 * (1 - k);
    }
    tp[LRAISE] = tp[RRAISE] = raise; tp[LSPLAY] = tp[RSPLAY] = splay; tp[LELB] = tp[RELB] = elbow;
    tp[LEAN] = lean + P.hunch * 0.5; tp[NOD] = nod; tp[JAW] = jaw; tp[HIPZ] = hz;
    tp[TWIST] = 0.05 * Math.sin(this.time * 9);
    tp[LSWING] = 0.3; tp[RSWING] = -0.1; tp[LKNEE] = 0.35; tp[RKNEE] = 0.2;
    this._ground(tp);
  }

  // Martillazo: levanta los dos puños por encima de la cabeza y los deja caer
  _poseHammer(tt, period) {
    const tp = this.tp, P = this.p;
    let raise, elbow, lean, nod;
    if (tt < 0.3) {
      const k = easeInOut(tt / 0.3);
      raise = 1.3 + 1.5 * k; elbow = 0.3 + 0.8 * k; lean = 0.12 - 0.22 * k; nod = 0.05 - 0.3 * k;
    } else if (tt < 0.46) {
      const k = easeInOut((tt - 0.3) / 0.16);
      raise = 2.8 - 2.0 * k; elbow = 1.1 - 0.9 * k; lean = -0.1 + 0.6 * k; nod = -0.25 + 0.4 * k;
    } else {
      const k = easeInOut((tt - 0.46) / (period - 0.46));
      raise = 0.8 + 0.45 * k; elbow = 0.2 + 0.15 * k; lean = 0.5 - 0.35 * k; nod = 0.15 - 0.05 * k;
    }
    tp[LRAISE] = tp[RRAISE] = raise; tp[LELB] = tp[RELB] = elbow; tp[LSPLAY] = tp[RSPLAY] = 0.08;
    tp[LEAN] = lean + P.hunch * 0.5; tp[NOD] = nod;
    tp[JAW] = 0.5 + 0.3 * Math.sin(this.time * 10);
    tp[LSWING] = 0.2; tp[RSWING] = -0.2; tp[LKNEE] = 0.3; tp[RKNEE] = 0.3;
    if (tt > 0.3 && tt < 0.6) tp[LKNEE] = tp[RKNEE] = 0.45;
    this._ground(tp);
  }

  _poseTear() {
    const tp = this.tp;
    const tt = this.animT % 1.0;
    const side = Math.floor(this.animT) % 2 ? 1 : -1;
    let raise, elbow, lean, hz, splay = 0.1;
    if (tt < 0.35) {
      const k = easeInOut(tt / 0.35);
      raise = 1.3 + 0.45 * k; elbow = 0.5 - 0.3 * k; lean = 0.15 + 0.2 * k; hz = -0.03 * k;
    } else if (tt < 0.6) {
      const k = easeInOut((tt - 0.35) / 0.25);
      raise = 1.75 - 0.8 * k; elbow = 0.2 + 1.25 * k; lean = 0.35 - 0.5 * k; hz = -0.03 + 0.1 * k;
    } else {
      const k = easeInOut((tt - 0.6) / 0.4);
      raise = 0.95 + 0.35 * k; elbow = 1.45 - 0.95 * k; lean = -0.15 + 0.3 * k; hz = 0.07 - 0.07 * k;
      splay = 0.1 + 0.9 * Math.sin(k * Math.PI);
    }
    tp[LRAISE] = raise; tp[RRAISE] = raise; tp[LELB] = elbow; tp[RELB] = elbow;
    // un brazo lanza la tabla hacia un lado
    if (tt >= 0.6) { if (side > 0) tp[RSPLAY] = splay; else tp[LSPLAY] = splay; }
    else { tp[LSPLAY] = tp[RSPLAY] = 0.1; }
    tp[LEAN] = lean;
    tp[HIPZ] = hz;
    tp[NOD] = -0.1 + 0.15 * Math.sin(this.time * 11);
    tp[TILT] = 0.12 * Math.sin(this.time * 6);
    tp[JAW] = 0.5 + 0.2 * Math.sin(this.time * 8);
    tp[LSWING] = 0.18; tp[RSWING] = -0.15; tp[LKNEE] = 0.3; tp[RKNEE] = 0.2;
    this._ground(tp);
  }

  _poseClimb() {
    const tp = this.tp;
    const p = clamp01(this.animT / 1.2);
    const a = Math.sin(Math.PI * p);
    tp[LIFT] = 0.3 * a;
    tp[LEAN] = 0.25 + 0.4 * a;
    tp[NOD] = -0.2;
    const l = Math.sin(Math.PI * clamp01(p / 0.6));
    const rr = Math.sin(Math.PI * clamp01((p - 0.35) / 0.65));
    tp[LSWING] = 1.25 * l; tp[LKNEE] = 0.2 + 1.5 * l;
    tp[RSWING] = 1.1 * rr - 0.2 * l; tp[RKNEE] = 0.2 + 1.4 * rr;
    tp[LRAISE] = tp[RRAISE] = 0.95 + 0.35 * (1 - a);
    tp[LELB] = tp[RELB] = 0.9 * a + 0.2;
    tp[LSPLAY] = tp[RSPLAY] = 0.3;
    tp[JAW] = 0.4;
    tp[HIPY] = DIM.hipY - 0.1 * a;
  }

  _poseRise() {
    const tp = this.tp, t = this.time;
    tp[LRAISE] = 2.6 + 0.3 * Math.sin(t * 5); tp[RRAISE] = 2.6 + 0.3 * Math.sin(t * 5 + 2);
    tp[LELB] = 0.3 + 0.3 * Math.sin(t * 5 + 1); tp[RELB] = 0.3 + 0.3 * Math.sin(t * 5 + 3);
    tp[LSPLAY] = tp[RSPLAY] = 0.35;
    tp[ROLL] = 0.15 * Math.sin(t * 3);
    tp[LEAN] = -0.05;
    tp[NOD] = -0.35;
    tp[JAW] = 0.6;
    this._ground(tp);
  }

  _poseStun() {
    const tp = this.tp, t = this.animT;
    const d = Math.exp(-t * 3);
    tp[LEAN] = -0.4 * d + 0.1 * (1 - d);
    tp[ROLL] = 0.22 * Math.sin(t * 11) * d;
    tp[TWIST] = 0.15 * Math.sin(t * 7);
    tp[NOD] = -0.4 * d + 0.1;
    tp[TILT] = 0.3 * Math.sin(t * 9) * d;
    tp[LRAISE] = 0.5 + 0.6 * Math.sin(t * 9); tp[RRAISE] = 0.5 + 0.6 * Math.sin(t * 9 + 2);
    tp[LSPLAY] = tp[RSPLAY] = 0.85;
    tp[LELB] = tp[RELB] = 0.6;
    tp[JAW] = 0.6;
    tp[LSWING] = -0.3 * Math.sin(t * 8); tp[RSWING] = 0.3 * Math.sin(t * 8);
    tp[LKNEE] = 0.3; tp[RKNEE] = 0.3;
    tp[HIPZ] = 0.06 * d;
    this._ground(tp, 0, 0.08);
  }

  // Reptante: cadera casi horizontal, cabeza a crawlerHeadY y crawlerHeadFwd por delante, avanza tirando con los brazos
  _poseCrawl(c, anim) {
    const tp = this.tp;
    const s = Math.sin(c), co = Math.cos(c);
    tp[HIPY] = 0.15; tp[HIPZ] = 0.24; tp[HIPP] = 1.4;
    tp[LEAN] = 0; tp[ROLL] = 0.12 * s; tp[HIPYAW] = 0.1 * s; tp[TWIST] = -0.12 * s;
    tp[NOD] = -0.24 + 0.08 * Math.sin(c * 2);
    tp[TILT] = this.p.headTilt * 0.5;
    tp[JAW] = 0.35 + 0.2 * Math.sin(this.time * 4);
    tp[LSWING] = -0.1; tp[RSWING] = -0.1; tp[LKNEE] = 0; tp[RKNEE] = 0;
    tp[LLSPLAY] = tp[RLSPLAY] = 0.15;
    // ángulo del brazo respecto a la vertical y flexión del codo: la mano queda a ras de suelo
    const base = 1.4 + 1.0;
    if (anim === ZA.ATTACK) {
      const tt = this.animT % 0.9;
      const k = clamp01(tt < 0.3 ? easeInOut(tt / 0.3) : 1 - easeInOut((tt - 0.3) / 0.25));
      const sw = 1.4 + 0.75 + 0.9 * k;
      const el = 0.9 - 0.5 * k;
      if (this.swingSide > 0) { tp[RRAISE] = sw; tp[RELB] = el; tp[LRAISE] = base; tp[LELB] = 0.5; }
      else { tp[LRAISE] = sw; tp[LELB] = el; tp[RRAISE] = base; tp[RELB] = 0.5; }
      tp[NOD] = -0.4;
      tp[JAW] = 0.6;
    } else if (anim === ZA.STUN) {
      tp[LRAISE] = base + 0.3 * Math.sin(this.animT * 10); tp[RRAISE] = base - 0.3 * Math.sin(this.animT * 10);
      tp[LELB] = tp[RELB] = 0.8;
      tp[ROLL] = 0.25 * Math.sin(this.animT * 12);
    } else {
      const ul = 0.5 + 0.5 * s, ur = 0.5 - 0.5 * s;   // 1 = brazo estirado hacia delante
      tp[LRAISE] = 1.4 + 0.35 + 0.65 * ul; tp[RRAISE] = 1.4 + 0.35 + 0.65 * ur;
      tp[LELB] = 1.3 - 0.9 * ul; tp[RELB] = 1.3 - 0.9 * ur;
      tp[LSPLAY] = tp[RSPLAY] = 0.25;
      if (anim === ZA.CLIMB) tp[LIFT] = 0.25 * Math.sin(Math.PI * clamp01(this.animT / 1.2));
    }
  }

  _becomeCrawler() {
    this.crawler = true;
    this.becameCrawler = true;   // EntityManager lo consume para sangre/trozos
    this._crawlBlend = 0;
    // piernas arrancadas: muñones cortos con carne expuesta
    for (const leg of [this.legL, this.legR]) {
      leg.kn.visible = false;
      leg.tm.scale.y = 0.38;
      const cap = this._goreCap(leg.th, 0, -DIM.thigh * 0.38, 0, 0.07);
      cap.visible = true;
    }
  }

  _goreCap(parent, x, y, z, s) {
    const m = new THREE.Mesh(this.A.geos.gore, this.A.mats.gore);
    m.position.set(x, y, z);
    m.scale.set(s, s, s);
    parent.add(m);
    this.meshes.push(m);
    this._goreCaps.push(m);
    return m;
  }

  _removeHead(env) {
    if (!this.neck.visible) return;
    this.neck.visible = false;
    this._goreCap(this.spine, 0, DIM.neckY + 0.02, 0.012, 0.065);
  }

  // ------------------------------------------------------------------ Aplicar pose a los huesos
  _apply() {
    const c = this.cp, S = this.spr;
    // compensación lateral del balanceo (la cabeza se mantiene sobre la caja de impacto)
    const roll = c[ROLL];
    const hx = this.death || c[HIPP] > 0.5 ? 0 : 0.85 * (DIM.neckY * Math.sin(roll) + DIM.headC * Math.sin(roll + c[TILT]));
    this.hips.position.set(hx, c[HIPY] - 0.1 * S.knee.v, c[HIPZ]);
    this.hips.rotation.set(-c[HIPP], c[HIPYAW], c[HIPROLL]);
    this.spine.rotation.set(-(c[LEAN] + S.lean.v), c[TWIST] + S.twist.v, c[ROLL] + S.roll.v);
    this.neck.rotation.set(-(c[NOD] + S.nod.v), c[TURN], c[TILT] + S.tilt.v);
    this.jaw.rotation.x = -Math.max(0, c[JAW]);
    this.armL.sh.rotation.set(c[LRAISE] + S.armL.v, -c[LTWIST], -c[LSPLAY] - 0.5 * Math.abs(S.armL.v));
    this.armR.sh.rotation.set(c[RRAISE] + S.armR.v, c[RTWIST], c[RSPLAY] + 0.5 * Math.abs(S.armR.v));
    this.armL.el.rotation.x = c[LELB];
    this.armR.el.rotation.x = c[RELB];
    const kb = Math.max(0, S.knee.v);
    this.legL.th.rotation.set(c[LSWING] + kb * 0.3, 0, -c[LLSPLAY]);
    this.legR.th.rotation.set(c[RSWING] + kb * 0.3, 0, c[RLSPLAY]);
    this.legL.kn.rotation.x = -(c[LKNEE] + kb);
    this.legR.kn.rotation.x = -(c[RKNEE] + kb);
    // tobillos: el pie se mantiene paralelo al suelo (menos la puntera que se levanta o se arrastra)
    const lvl = this.death ? 0.4 : 1;
    const hpx = this.hips.rotation.x;
    this.legL.an.rotation.x = -(hpx + this.legL.th.rotation.x + this.legL.kn.rotation.x) * lvl - c[LTOE];
    this.legR.an.rotation.x = -(hpx + this.legR.th.rotation.x + this.legR.kn.rotation.x) * lvl - c[RTOE];
  }

  // ------------------------------------------------------------------ Eventos visuales
  // Sacudida por impacto. dirX/dirZ = dirección de la bala en el mundo.
  hitReact(part, dirX = 0, dirZ = 0, strength = 1) {
    if (this.death) return;
    const rot = this.group.rotation.y;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const len = Math.hypot(dirX, dirZ) || 1;
    const dx = dirX / len, dz = dirZ / len;
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    const k = Math.min(1.6, Math.max(0.3, strength)) * (this.kit && this.kit.stagger != null ? this.kit.stagger : 1);
    const S = this.spr;
    const jit = () => (Math.random() - 0.5);
    if (part === 'h') {
      S.nod.w -= (lz * 7 + 3) * k; S.tilt.w -= lx * 8 * k + jit() * 4; S.lean.w -= lz * 1.5 * k;
    } else if (part === 'l') {
      S.knee.w += 5.5 * k; S.lean.w += 1.5 * k; S.roll.w -= lx * 3 * k;
    } else {
      S.lean.w -= lz * 5 * k; S.roll.w -= lx * 4 * k; S.twist.w += jit() * 6 * k; S.nod.w += 1.5 * k;
    }
    S.armL.w += (jit() * 10 - 3) * k; S.armR.w += (jit() * 10 - 3) * k;
    this.jawBoost = Math.max(this.jawBoost, 0.5);
  }

  onAttack() {
    if (this.death) return;
    // sincroniza el zarpazo con el golpe del servidor
    const hit = this.kit && this.kit.hitTime ? this.kit.hitTime : 0.3;
    const per = this.kit && this.kit.attackPeriod ? this.kit.attackPeriod : 1.1;
    const tt = this.animT % per;
    if (this.anim !== ZA.ATTACK || tt > hit + 0.3 || tt < hit - 0.45) { this.animT = hit; }
    this.jawBoost = 1;
  }

  groan() { this.jawBoost = 1; }

  // Habilidad de jefe (evento ev:bossAbility): la animación la pone el tipo
  onAbility(a) { if (this.kit && this.kit.onAbility && !this.death) this.kit.onAbility(a); }

  getHeadWorld(out) { return this.headPt.getWorldPosition(out); }
  getNeckWorld(out) { this.neck.updateWorldMatrix(true, false); return out.setFromMatrixPosition(this.neck.matrixWorld); }
  getChestWorld(out) { this.spine.updateWorldMatrix(true, false); return out.set(0, 0.38, 0).applyMatrix4(this.spine.matrixWorld); }

  // ------------------------------------------------------------------ Muertes
  // fx: 'normal'|'head'|'explode'|'melee'|'nuke'|'fire'|'shield'. pushX/pushZ: dirección del empuje en el mundo.
  startDeath(fx, pushX = 0, pushZ = 0, env = {}) {
    if (this.death) return;
    const r = Math.random;
    const rot = this.group.rotation.y;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    let plen = Math.hypot(pushX, pushZ);
    if (plen < 1e-4) { const a = r() * TAU; pushX = Math.sin(a); pushZ = Math.cos(a); plen = 1; }
    const px = pushX / plen, pz = pushZ / plen;
    const lx = px * cs - pz * sn, lz = px * sn + pz * cs;   // empuje en espacio local
    const D = {
      fx, t: 0, mode: 'plank', delay: 0, falling: false, theta: 0, omega: 0, thetaMax: 1.5, g: 11,
      axis: new THREE.Vector3(), lieH: 0.11, slideX: 0, slideZ: 0, fountain: 0, landed: false,
      sinkAt: 4.2, removeAt: 5.6, rate: 7, pooled: false, crumpleT: 0, kneeled: false,
    };
    this.death = D;
    const crawler = this.crawler;
    // dirección de caída (local): por defecto, alejándose del atacante
    let fdx = lx, fdz = lz;
    const dp = this.tp;
    // brazos flácidos: pegados a los costados o por encima de la cabeza (nunca clavados en el suelo)
    const armLimp = () => (r() < 0.5 ? 0.05 + r() * 0.35 : 2.6 + r() * 0.5);
    const limp = () => {
      dp[LRAISE] = armLimp(); dp[RRAISE] = armLimp();
      dp[LSPLAY] = 0.3 + r() * 1.1; dp[RSPLAY] = 0.3 + r() * 1.1;
      dp[LELB] = 0.1 + r() * 0.9; dp[RELB] = 0.1 + r() * 0.9;
      dp[LTWIST] = dp[RTWIST] = 0;
      dp[LSWING] = -0.1 + r() * 0.45; dp[RSWING] = -0.1 + r() * 0.45;
      dp[LLSPLAY] = 0.06 + r() * 0.25; dp[RLSPLAY] = 0.06 + r() * 0.25;
      dp[LKNEE] = 0.05 + r() * 0.6; dp[RKNEE] = 0.05 + r() * 0.6;
      dp[LEAN] = (r() - 0.5) * 0.4; dp[TWIST] = (r() - 0.5) * 0.4; dp[ROLL] = (r() - 0.5) * 0.3;
      dp[NOD] = (r() - 0.5) * 0.8; dp[TURN] = (r() - 0.5) * 1.3; dp[TILT] = (r() - 0.5) * 0.8;
      dp[JAW] = 0.3 + r() * 0.5;
      dp[HIPYAW] = dp[HIPROLL] = 0; dp[LIFT] = 0;
    };
    limp();
    if (crawler) {
      // reptante: se desploma en el sitio
      D.mode = 'slump';
      dp[HIPY] = 0.12; dp[HIPZ] = 0.24; dp[HIPP] = 1.48; dp[NOD] = 0.35; dp[LEAN] = 0;
      dp[LRAISE] = 2.5 + r() * 0.6; dp[RRAISE] = 2.5 + r() * 0.6;
      D.rate = 6;
    } else {
      dp[HIPY] = DIM.hipY; dp[HIPZ] = 0; dp[HIPP] = 0;
    }
    switch (fx) {
      case 'head':
        this._removeHead(env);
        this._throwHat(env, px, pz);
        D.fountain = 1.1;
        if (!crawler) {
          D.delay = 0.35 + r() * 0.25;
          if (r() < 0.45) { D.mode = 'crumple'; } else { fdx = lx; fdz = lz; }
          // espasmo antes de caer
          dp[LRAISE] = 1.8; dp[RRAISE] = 2.1; dp[LELB] = 0.9; dp[RELB] = 0.6; dp[LKNEE] = dp[RKNEE] = 0.35;
          this._stagger = true;
        }
        break;
      case 'explode':
      case 'nuke': {
        const charred = fx === 'nuke' || r() < 0.5;
        if (charred) this._char();
        if (fx === 'explode') {
          this._dismember(env, px, pz);
          if (!crawler) { D.omega = 3 + r() * 2; D.slideX = px * 2.4; D.slideZ = pz * 2.4; D.lift = 0.25; }
        } else if (!crawler) {
          D.mode = 'crumple';
          D.crumpleT = 0.25;
        }
        break;
      }
      case 'fire':
        this._burning = 0.9;
        if (!crawler) { D.delay = 0.9; D.mode = 'crumple'; D.crumpleT = 0.25; }
        break;
      case 'shield':
        if (!crawler) { D.omega = 3.2; D.slideX = px * 3.2; D.slideZ = pz * 3.2; D.g = 13; }
        break;
      case 'melee':
        if (!crawler) { D.omega = 1.8; D.slideX = px * 0.8; D.slideZ = pz * 0.8; }
        this.spr.nod.w -= 8;
        break;
      default:
        if (!crawler) {
          if (r() < 0.4) { D.mode = 'crumple'; }
          else { D.omega = 0.8 + r() * 0.8; D.slideX = px * 0.4; D.slideZ = pz * 0.4; }
        }
        break;
    }
    if (D.mode === 'plank' && !crawler) {
      const fl = Math.hypot(fdx, fdz) || 1;
      fdx /= fl; fdz /= fl;
      // un poco de aleatoriedad lateral
      const jitter = (r() - 0.5) * 0.6;
      const cj = Math.cos(jitter), sj = Math.sin(jitter);
      const ax = fdx * cj - fdz * sj, az = fdx * sj + fdz * cj;
      D.fall = { x: ax, z: az };
      D.axis.set(az, 0, -ax).normalize();
      // brazos: si cae de espaldas, por encima de la cabeza; de frente, hacia delante
      if (az > 0.3 && r() < 0.6) { dp[LRAISE] = 2.6 + r() * 0.5; dp[RRAISE] = 2.4 + r() * 0.7; }
      dp[LSWING] = 0.05 + r() * 0.2; dp[RSWING] = 0.05 + r() * 0.25;
      dp[LKNEE] = 0.1 + r() * 0.35; dp[RKNEE] = 0.1 + r() * 0.35;
      dp[HIPY] = DIM.hipY;
    }
    if (D.mode === 'crumple') {
      // arrodillarse primero
      dp[LSWING] = 0.25; dp[RSWING] = 0.3; dp[LKNEE] = 1.55; dp[RKNEE] = 1.5;
      dp[LEAN] = 0.35; dp[NOD] = 0.5; dp[LRAISE] = 0.15; dp[RRAISE] = 0.2; dp[LELB] = 0.3; dp[RELB] = 0.2;
      this._ground(dp);
      D.rate = 7;
    }
  }

  _char() {
    this.eyes.visible = false;
    this.halo.visible = false;
    for (const m of this.meshes) {
      if (m === this.eyes || this._goreCaps.includes(m)) continue;
      m.material = this.A.mats.charred;
    }
    this._charred = true;
  }

  _throwHat(env, px, pz) {
    if (!this.hat || !this.group.parent) return;
    const hat = this.hat;
    this.hat = null;
    this.group.parent.attach(hat);
    this.pieces.push({ obj: hat, vx: px * 2 + (Math.random() - 0.5), vy: 3 + Math.random() * 2, vz: pz * 2 + (Math.random() - 0.5),
      wx: (Math.random() - 0.5) * 12, wy: (Math.random() - 0.5) * 8, wz: (Math.random() - 0.5) * 12, floor: 0.02, rest: false, bleed: 0 });
  }

  // Desmembramiento: cabeza, brazos y piernas salen volando
  _dismember(env, px, pz) {
    const parent = this.group.parent;
    if (!parent) return;
    this.group.updateMatrixWorld(true);
    const r = Math.random;
    const launch = (obj, up, bleed) => {
      parent.attach(obj);
      const sp = 2.5 + r() * 3.5;
      this.pieces.push({
        obj, vx: px * sp + (r() - 0.5) * 3, vy: up + r() * 3, vz: pz * sp + (r() - 0.5) * 3,
        wx: (r() - 0.5) * 16, wy: (r() - 0.5) * 10, wz: (r() - 0.5) * 16, floor: 0.06, rest: false, bleed,
      });
    };
    if (r() < 0.75 && this.neck.visible) {
      this._goreCap(this.spine, 0, DIM.neckY + 0.02, 0.012, 0.065);
      launch(this.neck, 4.5, 1.2);
      this.hat = null;
    }
    for (const armP of [this.armL, this.armR]) {
      if (r() < 0.6) {
        this._goreCap(this.spine, armP.sh.position.x, armP.sh.position.y, 0, 0.055);
        launch(armP.sh, 3.5, 0.8);
      }
    }
    if (!this.crawler) {
      for (const legP of [this.legL, this.legR]) {
        if (r() < 0.55) {
          this._goreCap(this.hips, legP.th.position.x, legP.th.position.y, 0, 0.07);
          launch(legP.th, 2.5, 0.8);
        }
      }
    }
  }

  // Devuelve false cuando el cadáver debe eliminarse
  updateDeath(dt, env = {}) {
    const D = this.death;
    if (!D) return true;
    this.time += dt;
    D.t += dt;
    const fxs = env.effects;
    // los ojos se apagan al morir
    if (D.t > 0.3 && this.eyes.visible) { this.eyes.visible = false; this.halo.visible = false; }
    const tp = this.tp, cp = this.cp;
    // Fases de caída
    if (D.mode === 'plank') {
      if (D.t >= D.delay && !D.landed) {
        if (!D.falling) {
          D.falling = true;
          if (this._stagger) { tp[LRAISE] = 2.6 + Math.random() * 0.4; tp[RRAISE] = 0.2 + Math.random() * 0.3; tp[LKNEE] = tp[RKNEE] = 0.2; }
        }
        D.omega += D.g * Math.sin(D.theta + 0.12) * dt;
        D.theta += D.omega * dt;
        if (D.theta >= D.thetaMax) {
          D.theta = D.thetaMax;
          if (D.omega > 1.2) { D.omega *= -0.22; this._thud(env); }
          else { D.omega = 0; D.landed = true; this._thud(env); }
        }
        if (D.theta < 0) { D.theta = 0; D.omega = Math.abs(D.omega) * 0.3; }
      }
      this.tilt.quaternion.setFromAxisAngle(D.axis, D.theta);
      this.tilt.position.y = D.lieH * Math.sin(D.theta) + (D.lift || 0) * Math.sin(Math.min(1, D.t * 2) * Math.PI);
    } else if (D.mode === 'crumple') {
      if (!D.kneeled && D.t >= D.delay + 0.35 + D.crumpleT) {
        D.kneeled = true;
        D.fallStart = D.t;
        D.from = Float32Array.from(cp);
        // postura final boca abajo
        const r = Math.random;
        D.to = Float32Array.from(cp);
        const to = D.to;
        to[HIPY] = 0.13; to[HIPZ] = -0.35; to[HIPP] = 1.5; to[LEAN] = 0.05; to[NOD] = -0.1 + r() * 0.5;
        to[TURN] = (r() - 0.5) * 1.4; to[TILT] = (r() - 0.5) * 0.6;
        to[LSWING] = -0.15 + r() * 0.2; to[RSWING] = -0.15 + r() * 0.2; to[LKNEE] = 0.2 + r() * 0.8; to[RKNEE] = 0.2 + r() * 0.8;
        to[LRAISE] = 2.5 + r() * 0.6; to[RRAISE] = 2.5 + r() * 0.6;
        to[LSPLAY] = 0.3 + r() * 0.8; to[RSPLAY] = 0.3 + r() * 0.8; to[LELB] = r() * 1.2; to[RELB] = r() * 1.2;
      }
      if (D.kneeled && !D.landed) {
        const f = Math.min(1, (D.t - D.fallStart) / 0.55);
        const e = f * f;
        const from = D.from, to = D.to;
        for (let i = 0; i < NP; i++) cp[i] = from[i] + (to[i] - from[i]) * e;
        if (f >= 1) { D.landed = true; tp.set(to); this._thud(env); }
      }
    } else if (D.mode === 'slump') {
      if (!D.landed && D.t > 0.4) { D.landed = true; this._thud(env); }
    }
    // Deslizamiento por el empuje
    if (D.slideX || D.slideZ) {
      this.group.position.x += D.slideX * dt;
      this.group.position.z += D.slideZ * dt;
      const fr = Math.exp(-dt * 5);
      D.slideX *= fr; D.slideZ *= fr;
      if (Math.abs(D.slideX) + Math.abs(D.slideZ) < 0.02) { D.slideX = 0; D.slideZ = 0; }
    }
    // Pose flácida (salvo durante la interpolación del desplome)
    if (!(D.mode === 'crumple' && D.kneeled && !D.landed)) {
      const k = 1 - Math.exp(-D.rate * dt);
      for (let i = 0; i < NP; i++) cp[i] += (tp[i] - cp[i]) * k;
    }
    for (const key in this.spr) this.spr[key].step(dt);
    // Espasmos del cuerpo decapitado
    if (this._stagger && !D.falling && D.mode === 'plank') {
      this.spr.roll.w += (Math.random() - 0.5) * 30 * dt;
      this.spr.lean.w += (Math.random() - 0.5) * 30 * dt;
    }
    this._apply();
    // Chorro de sangre del cuello
    if (D.fountain > 0 && fxs && typeof fxs.blood === 'function') {
      D.fountain -= dt;
      D.fAcc = (D.fAcc || 0) + dt;
      if (D.fAcc > 0.07) {
        D.fAcc = 0;
        this.spine.updateWorldMatrix(true, false);
        _v1.set(0, DIM.neckY + 0.05, 0.012).applyMatrix4(this.spine.matrixWorld);
        _v2.set(0, 1, 0).transformDirection(this.spine.matrixWorld);
        _v2.x += (Math.random() - 0.5) * 0.5; _v2.z += (Math.random() - 0.5) * 0.5; _v2.y += 0.6;
        _v2.normalize();
        fxs.blood(_v1.clone(), _v2.clone(), 0.6 + D.fountain * 0.4);
      }
    }
    // Fuego que se apaga en la muerte por fuego
    if (this._burning > 0) {
      this._burning -= dt;
      if (this._burning <= 0 && !this._charred) this._char();
    }
    // Trozos que vuelan
    this._updatePieces(dt, fxs);
    // Charco de sangre al quedar tendido
    if (D.landed && !D.pooled && fxs && D.fx !== 'nuke') {
      D.pooled = true;
      if (typeof fxs.bloodPool === 'function') {
        this.getChestWorld(_v1);
        _v1.y = 0;
        fxs.bloodPool(_v1.clone(), 0.55 + Math.random() * 0.4);
      }
    }
    // Hundirse en el suelo
    if (D.t > D.sinkAt) {
      const s = (D.t - D.sinkAt) * 0.26;
      this.group.position.y = -s;
      for (const p of this.pieces) if (p.rest) p.obj.position.y -= 0.26 * dt;
    }
    if (D.t >= D.removeAt) return false;
    return true;
  }

  _thud(env) {
    const fxs = env && env.effects;
    if (fxs && typeof fxs.dust === 'function' && Math.random() < 0.7) {
      this.getChestWorld(_v1);
      _v1.y = 0.05;
      fxs.dust(_v1.clone(), new THREE.Vector3(0, 1, 0));
    }
  }

  _updatePieces(dt, fxs) {
    for (const p of this.pieces) {
      if (p.rest) continue;
      p.vy -= 9.8 * dt;
      const o = p.obj;
      o.position.x += p.vx * dt; o.position.y += p.vy * dt; o.position.z += p.vz * dt;
      o.rotation.x += p.wx * dt; o.rotation.y += p.wy * dt; o.rotation.z += p.wz * dt;
      if (o.position.y < p.floor) {
        o.position.y = p.floor;
        if (p.vy < -1.5) {
          p.vy = -p.vy * 0.3; p.vx *= 0.5; p.vz *= 0.5; p.wx *= 0.5; p.wy *= 0.5; p.wz *= 0.5;
          if (fxs && typeof fxs.bloodPool === 'function' && p.bleed > 0) fxs.bloodPool(o.position.clone().setY(0), 0.25);
        } else {
          p.rest = true; p.vx = p.vy = p.vz = 0;
        }
      }
      if (p.bleed > 0 && fxs && typeof fxs.blood === 'function') {
        p.bleed -= dt;
        p.acc = (p.acc || 0) + dt;
        if (p.acc > 0.06) { p.acc = 0; fxs.blood(o.position.clone(), new THREE.Vector3(-p.vx, 0.5, -p.vz).normalize(), 0.25); }
      }
    }
  }

  // ------------------------------------------------------------------ Desvanecido (desaparece sin morir)
  startFade() {
    if (this._fadeMats) return;
    this._fadeMats = new Map();
    this.fadeT = 0;
    const swap = (o) => {
      if (!o.material) return;
      let clone = this._fadeMats.get(o.material);
      if (!clone) {
        clone = o.material.clone();
        clone.transparent = true;
        clone.depthWrite = o.material.depthWrite;
        clone.userData.baseOpacity = o.material.opacity;
        clone.userData.orig = o.material;
        this._fadeMats.set(o.material, clone);
      }
      o.material = clone;
    };
    this.group.traverse(swap);
  }

  cancelFade() {
    if (!this._fadeMats) return;
    this.group.traverse((o) => {
      if (o.material && o.material.userData && o.material.userData.orig) o.material = o.material.userData.orig;
    });
    for (const m of this._fadeMats.values()) m.dispose();
    this._fadeMats = null;
  }

  // Devuelve false cuando terminó de desvanecerse
  updateFade(dt) {
    if (!this._fadeMats) return false;
    this.fadeT += dt;
    const a = Math.max(0, 1 - this.fadeT / 0.6);
    for (const m of this._fadeMats.values()) m.opacity = (m.userData.baseOpacity ?? 1) * a;
    this.group.position.y -= dt * 0.15;
    return a > 0;
  }

  // ------------------------------------------------------------------ Limpieza
  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const p of this.pieces) if (p.obj.parent) p.obj.parent.remove(p.obj);
    this.pieces.length = 0;
    if (this._fadeMats) { for (const m of this._fadeMats.values()) m.dispose(); this._fadeMats = null; }
    if (this.pustMat) { this.pustMat.dispose(); this.pustMat = null; }
    if (this._ghostMats) { for (const m of this._ghostMats.values()) m.dispose(); this._ghostMats = null; }
    if (this.auraSprite) { this.auraSprite.material.dispose(); this.auraSprite = null; }
  }
}

export function createZombieModel(opts) { return new ZombieModel(opts); }

export default ZombieModel;
