// Props del mundo. Estáticos (fusionados en el StaticBatch): bancos de la terminal, autobús de TranZit,
// autos quemados, barriles, barra y mesas del bar con botellas, cajas del almacén, generador y transformador,
// decorado de paredes y fachadas, dibujos de tiza de las armas de pared y carteles.
// Interactivos (con estado derivado de gs): se crean desde createInteractives() con los módulos auxiliares.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PROPS, WALLBUYS, INTERACTABLE_BY_ID, CEIL_H, WINDOW_INFO } from '/shared/map.js';
import { matrixFrom, yawForFace, uvRectPlane, TAU, flickerNoise } from './kit.js';
import {
  makeRng, chalkAtlas, posterTexture, departureBoardTexture, neonBarTexture, makeSign, flameTexture, glowTexture,
} from './textures.js';
import { facadePoint, facadePlaneYaw } from './levelgeo.js';
import { Doors, Windows } from './barriers.js';
import { PerkMachines, PackAPunch, PowerSwitch, Workbench } from './machines.js';
import { MysteryBoxes } from './mysterybox.js';
import { MedCabinets } from './medical.js';

// ---------------------------------------------------------------------------------------------
// Carteles con textura propia (se fusionan los que comparten textura)
export class SignSet {
  constructor() { this.map = new Map(); this.meshes = {}; }
  add(key, tex, w, h, x, y, z, yaw, opts = {}) {
    let e = this.map.get(key);
    if (!e) { e = { tex, emissive: !!opts.emissive, transparent: !!opts.transparent, color: opts.color == null ? 0xffffff : opts.color, list: [] }; this.map.set(key, e); }
    const g = new THREE.PlaneGeometry(w, h);
    g.applyMatrix4(matrixFrom(x, y, z, opts.rx || 0, yaw, opts.rz || 0));
    e.list.push(g);
  }
  build(parent) {
    for (const [key, e] of this.map) {
      const geo = e.list.length === 1 ? e.list[0] : mergeGeometries(e.list, false);
      if (e.list.length > 1) for (const g of e.list) g.dispose();
      if (!geo) continue;
      const common = { map: e.tex, color: new THREE.Color(e.color), transparent: e.transparent, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
      const mat = e.emissive ? new THREE.MeshBasicMaterial(common) : new THREE.MeshLambertMaterial(common);
      if (e.transparent) mat.depthWrite = false;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'sign:' + key;
      mesh.receiveShadow = !e.emissive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      this.meshes[key] = mesh;
    }
    this.map.clear();
    return this.meshes;
  }
}

// Fuego con sprites aditivos (barril en llamas, autos que aún arden)
export class Flames {
  constructor(parent) {
    this.parent = parent;
    this.list = [];
    this.tex = flameTexture();
  }
  add(x, y, z, scale = 1) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const sprites = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.SpriteMaterial({ map: this.tex, color: i === 3 ? 0xffe0a0 : 0xffa060, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const s = new THREE.Sprite(m);
      s.center.set(0.5, 0);
      g.add(s);
      sprites.push({ s, ph: i * 1.7 + Math.random(), off: [(Math.random() - 0.5) * 0.18 * scale, (Math.random() - 0.5) * 0.18 * scale] });
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff7a2a, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.y = 0.3 * scale;
    glow.scale.set(2.4 * scale, 2.4 * scale, 1);
    g.add(glow);
    this.parent.add(g);
    this.list.push({ g, sprites, glow, scale });
  }
  update(t) {
    for (const f of this.list) {
      const sc = f.scale;
      for (const it of f.sprites) {
        const k = flickerNoise(t * 2.4, it.ph);
        const h = (0.55 + 0.45 * k) * sc;
        it.s.scale.set(0.42 * sc * (0.8 + 0.3 * Math.sin(t * 7 + it.ph)), h, 1);
        it.s.position.set(it.off[0] + Math.sin(t * 3 + it.ph) * 0.04 * sc, 0, it.off[1]);
        it.s.material.opacity = 0.55 + 0.45 * k;
      }
      f.glow.material.opacity = 0.35 + 0.2 * flickerNoise(t * 1.7, 3.3);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Props estáticos de shared/map.js PROPS
const rectOf = (p) => ({ cx: (p.x0 + p.x1 + 1) / 2, cz: (p.z0 + p.z1 + 1) / 2, lx: p.x1 - p.x0 + 1, lz: p.z1 - p.z0 + 1 });

function bench(B, p, r) {
  const { cx, cz, lx } = rectOf(p);
  const P = B.at(cx, 0, cz, 0);
  const frame = 0x2e3034;
  P.box('metal', lx - 0.1, 0.07, 0.12, 0, 0.36, 0, { color: frame });
  for (let x = -lx / 2 + 0.35; x <= lx / 2 - 0.3; x += 1.35) {
    P.box('metal', 0.07, 0.36, 0.08, x, 0.18, 0, { color: frame });
    P.box('metal', 0.1, 0.03, 0.8, x, 0.015, 0, { color: frame });
  }
  const seatCol = r() < 0.5 ? 0xc0622a : 0x2c5a96;
  for (let i = 0; i < lx; i++) {
    const x = -lx / 2 + 0.5 + i;
    P.box('metal', 0.9, 0.44, 0.04, x, 0.66, 0, { color: 0x3a3c40 });
    for (const s of [-1, 1]) {
      if (r() < 0.1) continue; // asiento arrancado
      const tilt = r() < 0.15 ? 0.25 : 0;
      P.box('plastic', 0.86, 0.05, 0.4, x, 0.44, s * 0.25, { color: seatCol, rx: s * 0.06 + tilt });
      P.box('plastic', 0.86, 0.36, 0.04, x, 0.68, s * 0.045, { color: seatCol, rx: -s * 0.1 });
      P.box('metal', 0.04, 0.2, 0.3, x + 0.45, 0.56, s * 0.24, { color: frame });
    }
  }
  // restos: periódico y un vaso
  P.box('paint', 0.36, 0.005, 0.28, -lx / 2 + 1.5, 0.47, 0.25, { color: 0xcfc9b8, ry: 0.4 });
  P.cyl('plastic', 0.04, 0.035, 0.12, lx / 2 - 1.2, 0.53, -0.26, { color: 0xd8d0c0, seg: 8 });
}

function bus(B, p, r, signs) {
  const { cx, cz } = rectOf(p);
  const P = B.at(cx, 0, cz, 0);      // frente hacia +X
  const L = 9.8, Wd = 2.56;
  const BLUE = 0x1e4c9c, WHITE = 0xd6dad6, DARK = 0x16181a;
  P.box('metal', L - 0.5, 0.3, Wd - 0.3, 0, 0.45, 0, { color: DARK });
  P.box('metal', L, 1.0, Wd, 0, 1.05, 0, { color: BLUE });
  P.box('metal', L, 1.4, Wd, 0, 2.25, 0, { color: WHITE });
  P.box('metal', L - 0.08, 0.14, Wd - 0.06, 0, 3.02, 0, { color: 0xc4c8c4 });
  P.box('metal', 2.6, 0.24, 1.5, -1.8, 3.2, 0, { color: 0xa8aca8 });
  P.box('metal', 0.9, 0.12, 0.8, 2.6, 3.15, 0, { color: 0x8a8e8a });
  P.box('metal', L + 0.02, 0.14, Wd + 0.02, 0, 1.62, 0, { color: 0x3a7ad0 });
  P.box('metal', L + 0.02, 0.06, Wd + 0.02, 0, 0.58, 0, { color: 0x14306a });
  // ventanas laterales con montantes
  for (const s of [-1, 1]) {
    P.box('glass', 7.9, 0.9, 0.02, -0.5, 2.2, s * (Wd / 2 + 0.006), { color: 0xa0b4c4 });
    for (let x = -4.4; x <= 3.5; x += 1.3) P.box('metal', 0.1, 0.92, 0.03, x, 2.2, s * (Wd / 2 + 0.01), { color: WHITE });
    P.box('metal', L - 0.2, 0.04, 0.03, 0, 1.73, s * (Wd / 2 + 0.012), { color: 0x2a2a2a });
    // ruedas
    for (const x of [-3.2, 3.1]) {
      P.box('dark', 1.25, 0.7, 0.04, x, 0.55, s * (Wd / 2 + 0.005));
      P.cyl('rubber', 0.5, 0.5, 0.32, x, 0.5, s * (Wd / 2 - 0.14), { rx: Math.PI / 2, seg: 16 });
      P.cyl('chrome', 0.24, 0.24, 0.04, x, 0.5, s * (Wd / 2 + 0.03), { rx: Math.PI / 2, seg: 12 });
    }
  }
  // puerta delantera (lado derecho = +Z)
  P.box('glass', 0.95, 1.95, 0.02, 3.9, 1.6, Wd / 2 + 0.012, { color: 0x8aa0b0 });
  P.box('metal', 0.04, 1.95, 0.03, 3.9, 1.6, Wd / 2 + 0.018, { color: 0x2a2a2a });
  // parabrisas, trasera, parachoques y faros
  P.box('glass', 0.03, 1.15, Wd - 0.3, L / 2 + 0.01, 2.15, 0, { color: 0xb0c4d4 });
  P.box('metal', 0.03, 0.06, Wd - 0.3, L / 2 + 0.02, 2.1, 0, { color: 0x2a2a2a });
  P.box('glass', 0.03, 0.8, Wd - 0.5, -L / 2 - 0.01, 2.3, 0, { color: 0x708090 });
  P.box('metal', 0.22, 0.28, Wd + 0.06, L / 2 + 0.08, 0.62, 0, { color: 0x2a2a2a });
  P.box('metal', 0.22, 0.28, Wd + 0.06, -L / 2 - 0.08, 0.62, 0, { color: 0x2a2a2a });
  P.box('metal', 0.04, 0.5, 1.2, L / 2 + 0.02, 1.1, 0, { color: 0x3a3a3a });
  for (const s of [-1, 1]) {
    P.cyl('bulb', 0.13, 0.13, 0.04, L / 2 + 0.025, 1.0, s * 0.95, { rz: Math.PI / 2, seg: 12, color: s > 0 ? 0xffffff : 0x404040 });
    P.box('alarm', 0.03, 0.14, 0.2, -L / 2 - 0.02, 1.3, s * 1.0);
    P.box('metal', 0.3, 0.05, 0.05, L / 2 - 0.1, 2.9, s * (Wd / 2 + 0.2), { color: 0x2a2a2a });
    P.box('chrome', 0.04, 0.24, 0.14, L / 2 - 0.25, 2.8, s * (Wd / 2 + 0.26), {});
  }
  // óxido y suciedad
  for (let i = 0; i < 6; i++) {
    const x = -L / 2 + 0.6 + r() * (L - 1.2), s = r() < 0.5 ? -1 : 1;
    P.box('rust', 0.5 + r() * 0.8, 0.2 + r() * 0.4, 0.01, x, 0.8 + r() * 0.5, s * (Wd / 2 + 0.008), {});
  }
  // cartel de destino (emisivo)
  const [wx, , wz] = [cx + L / 2 + 0.035, 0, cz];
  signs.add('tranzit', posterTexture('tranzit'), 1.9, 0.34, wx, 2.86, wz, Math.PI / 2, { emissive: true });
  // letras laterales "TRANZIT" pintadas
  const side = makeSign({ w: 512, h: 96, bg: null, grime: 0, lines: [{ text: 'TRANZIT', size: 0.8, y: 0.55, color: '#ffffff', font: '"Arial Black", Arial, sans-serif' }] });
  signs.add('buslogo', side, 2.6, 0.48, cx - 1.2, 1.08, cz + Wd / 2 + 0.013, 0, { transparent: true });
  signs.add('buslogo', side, 2.6, 0.48, cx - 1.2, 1.08, cz - Wd / 2 - 0.013, Math.PI, { transparent: true });
}

function car(B, p, r, flames) {
  const { cx, cz, lx } = rectOf(p);
  const P = B.at(cx, 0, cz, (r() - 0.5) * 0.08);
  const len = Math.min(4.1, lx), wd = 1.78;
  const BODY = [0x5a4638, 0x4a3c34, 0x3e3632][(r() * 3) | 0];
  P.box('rust', len, 0.6, wd, 0, 0.58, 0, { color: BODY, rz: 0.02 });
  P.box('rust', len * 0.28, 0.12, wd - 0.1, len * 0.33, 0.93, 0, { color: BODY, rz: -0.08 });
  P.box('rust', len * 0.2, 0.1, wd - 0.1, -len * 0.38, 0.92, 0, { color: BODY });
  // cabina calcinada: techo, montantes e interior oscuro
  P.box('rust', 2.0, 0.07, wd - 0.2, -0.25, 1.44, 0, { color: 0x3a302a });
  for (const x of [-1.2, 0.7]) for (const s of [-1, 1]) P.box('rust', 0.08, 0.52, 0.07, x, 1.16, s * (wd / 2 - 0.12), { color: 0x3a302a, rz: x > 0 ? 0.35 : -0.2 });
  P.box('dark', 1.9, 0.5, wd - 0.3, -0.25, 1.12, 0);
  // capó entreabierto y parachoques
  P.box('rust', len * 0.3, 0.05, wd - 0.12, len * 0.3, 1.04, 0, { color: 0x4a3a30, rz: -0.25 });
  P.box('dark', 0.12, 0.2, wd, len / 2 + 0.03, 0.42, 0);
  P.box('dark', 0.12, 0.2, wd, -len / 2 - 0.03, 0.42, 0);
  // llantas sin neumáticos (hundidas)
  for (const x of [-len * 0.32, len * 0.3]) for (const s of [-1, 1]) {
    P.cyl('rust', 0.3, 0.3, 0.18, x, 0.24, s * (wd / 2 - 0.08), { rx: Math.PI / 2, seg: 12, color: 0x2a2420 });
    P.cyl('dark', 0.36, 0.36, 0.2, x, 0.3, s * (wd / 2 - 0.1), { rx: Math.PI / 2, seg: 12 });
  }
  // hollín
  P.box('dark', len * 0.5, 0.01, wd * 0.6, 0.3, 0.885, 0, { ry: 0.3 });
  if (flames) {
    const a = P.parent.elements;
    // punto del motor en mundo
    const v = new THREE.Vector3(len * 0.33, 1.0, 0).applyMatrix4(P.parent);
    flames.add(v.x, v.y, v.z, 0.7);
    void a;
  }
}

function barrels(B, p, r, flames) {
  let first = true;
  for (let z = p.z0; z <= p.z1; z++) for (let x = p.x0; x <= p.x1; x++) {
    const P = B.at(x + 0.5 + (r() - 0.5) * 0.1, 0, z + 0.5 + (r() - 0.5) * 0.1, r() * TAU);
    const col = first ? 0x5a3a28 : [0x2a4a7a, 0x8a2a1a, 0x3a5a3a][(r() * 3) | 0];
    P.cyl('metal', 0.29, 0.28, 0.9, 0, 0.45, 0, { color: col, seg: 16 });
    for (const y of [0.2, 0.45, 0.72]) P.cyl('metal', 0.3, 0.3, 0.03, 0, y, 0, { color: col, seg: 16 });
    P.cyl('rust', 0.24, 0.24, 0.01, 0, 0.3 + r() * 0.3, 0.2, { rx: Math.PI / 2, seg: 10 });
    if (first) {
      P.cyl('dark', 0.26, 0.26, 0.02, 0, 0.86, 0, { seg: 14 });
      P.box('wood', 0.5, 0.06, 0.08, 0.02, 0.9, 0.05, { ry: 0.6, rz: 0.2, color: 0x2a1a10 });
      flames.add(x + 0.5, 0.88, z + 0.5, 1.0);
      first = false;
    } else {
      P.cyl('metal', 0.29, 0.29, 0.02, 0, 0.9, 0, { color: 0x333333, seg: 16 });
    }
  }
}

function bottle(P, x, y, z, r, scale = 1) {
  const cols = [0x2a5a2a, 0x5a3a1a, 0x8a6a2a, 0xa0a8a0, 0x3a1a1a, 0x1a3a5a];
  const c = cols[(r() * cols.length) | 0];
  const h = (0.22 + r() * 0.1) * scale;
  P.cyl('plastic', 0.035 * scale, 0.038 * scale, h, x, y + h / 2, z, { color: c, seg: 7 });
  P.cyl('plastic', 0.012 * scale, 0.03 * scale, 0.07 * scale, x, y + h + 0.035 * scale, z, { color: c, seg: 6 });
  P.cyl('plastic', 0.012 * scale, 0.012 * scale, 0.04 * scale, x, y + h + 0.09 * scale, z, { color: c, seg: 6 });
}

function counter(B, p, r) {
  const { cx, cz, lx } = rectOf(p);
  const P = B.at(cx, 0, cz, 0);    // lado de los clientes = +Z
  P.box('wood', lx - 0.1, 0.95, 0.75, 0, 0.475, -0.05, { color: 0x4a2a18 });
  P.box('wood', lx - 0.1, 0.95, 0.06, 0, 0.475, 0.36, { color: 0x6a3a22 });
  for (let x = -lx / 2 + 0.4; x < lx / 2; x += 0.8) P.box('wood', 0.06, 0.9, 0.04, x, 0.5, 0.4, { color: 0x3a2014 });
  P.box('wood', lx, 0.07, 0.96, 0, 1.03, 0, { color: 0x2a160c });
  P.box('chrome', lx - 0.2, 0.05, 0.05, 0, 0.16, 0.5, { color: 0xc8a860 });
  for (let x = -lx / 2 + 0.3; x < lx / 2; x += 1.6) P.box('chrome', 0.04, 0.14, 0.04, x, 0.09, 0.47, { color: 0xc8a860 });
  // botellas, vasos, grifos y caja registradora
  for (let i = 0; i < 12; i++) bottle(P, -lx / 2 + 0.5 + r() * (lx - 1), 1.065, -0.2 + r() * 0.3, r, 1);
  for (let i = 0; i < 6; i++) P.cyl('glass', 0.035, 0.03, 0.1, -lx / 2 + 0.6 + r() * (lx - 1.2), 1.115, 0.1 + r() * 0.25, { color: 0x9ab0b8, seg: 8 });
  for (let k = 0; k < 3; k++) {
    P.box('chrome', 0.06, 0.28, 0.06, 1.2 + k * 0.22, 1.2, -0.3, { color: 0xc0c4c8 });
    P.box('plastic', 0.04, 0.16, 0.04, 1.2 + k * 0.22, 1.42, -0.28, { color: [0x1a1a1a, 0x8a1a1a, 0x1a3a8a][k] });
  }
  P.box('metal', 0.42, 0.3, 0.36, -lx / 2 + 0.5, 1.22, -0.15, { color: 0x3a3a3c, rx: -0.1 });
  P.box('plastic', 0.34, 0.03, 0.18, -lx / 2 + 0.5, 1.38, -0.05, { color: 0x6a6a60, rx: -0.4 });
}

function table(B, p, r) {
  const { cx, cz } = rectOf(p);
  const P = B.at(cx, 0, cz, r() * TAU);
  P.cyl('wood', 0.42, 0.42, 0.05, 0, 0.765, 0, { color: 0x3a2014, seg: 18 });
  P.cyl('metal', 0.045, 0.045, 0.72, 0, 0.38, 0, { color: 0x222222, seg: 8 });
  P.cyl('metal', 0.24, 0.26, 0.04, 0, 0.02, 0, { color: 0x222222, seg: 14 });
  for (const s of [-1, 1]) {
    if (r() < 0.2) {
      // silla volcada
      P.box('wood', 0.36, 0.36, 0.04, s * 0.3, 0.2, 0.05, { color: 0x4a2a18, rx: 1.3 });
      continue;
    }
    const Q = P.sub(s * 0.3, 0, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2);
    Q.box('wood', 0.36, 0.04, 0.36, 0, 0.46, 0, { color: 0x5a3420 });
    for (const [lx2, lz2] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) Q.box('wood', 0.035, 0.44, 0.035, lx2, 0.22, lz2, { color: 0x3a2014 });
    Q.box('wood', 0.36, 0.4, 0.035, 0, 0.68, 0.16, { color: 0x5a3420 });
  }
  const n = 1 + ((r() * 3) | 0);
  for (let i = 0; i < n; i++) bottle(P, (r() - 0.5) * 0.4, 0.79, (r() - 0.5) * 0.4, r, 0.9);
  P.cyl('glass', 0.035, 0.03, 0.1, 0.12, 0.84, -0.12, { color: 0x9ab0b8, seg: 8 });
  P.cyl('metal', 0.06, 0.06, 0.015, -0.15, 0.8, 0.1, { color: 0x8a8a8a, seg: 10 });
}

function crates(B, p, r) {
  const { cx, cz } = rectOf(p);
  const P = B.at(cx, 0, cz, 0);
  P.box('wood', 1.9, 0.12, 1.9, 0, 0.06, 0, { color: 0x9a8060 });
  const tint = () => [0xffffff, 0xe0d4c0, 0xc8b8a0, 0xf0e0c8][(r() * 4) | 0];
  for (const [x, z] of [[-0.47, -0.47], [0.47, -0.47], [-0.47, 0.47], [0.47, 0.47]]) {
    if (r() < 0.12) continue;
    P.box('crate', 0.88, 0.6, 0.88, x, 0.42, z, { color: tint(), ry: (r() - 0.5) * 0.12 });
  }
  const top = [[-0.45, -0.2], [0.42, 0.3]];
  for (const [x, z] of top) P.box('crate', 0.82, 0.56, 0.82, x, 1.0, z, { color: tint(), ry: (r() - 0.5) * 0.4 });
  if (r() < 0.6) P.box('tarp', 1.0, 0.03, 1.0, -0.4, 1.3, -0.2, { color: 0xffffff, rz: 0.08, ry: 0.3 });
  P.box('rust', 0.05, 1.3, 0.02, 0.92, 0.65, 0.3, { color: 0x3a3a3a });
}

function generator(B, p, r, signs) {
  const { cx, cz, lx } = rectOf(p);
  if (lx >= 3) {
    const P = B.at(cx, 0, cz, 0);
    P.box('metal', 2.9, 0.18, 2.5, 0, 0.09, 0, { color: 0x2a2c2e });
    P.box('zoc_hazard', 2.92, 0.1, 0.02, 0, 0.1, 1.26, {});
    P.box('zoc_hazard', 2.92, 0.1, 0.02, 0, 0.1, -1.26, {});
    P.box('metal', 2.1, 1.3, 1.7, -0.25, 0.83, 0, { color: 0xb8962a });
    for (let x = -1.1; x <= 0.7; x += 0.3) P.box('metal', 0.04, 1.1, 1.74, x, 0.85, 0, { color: 0x8a701e });
    P.box('metal', 0.36, 1.45, 1.9, 1.05, 0.9, 0, { color: 0x2e3032 });
    for (let y = 0.35; y < 1.6; y += 0.12) P.box('dark', 0.04, 0.05, 1.7, 1.24, y, 0);
    P.cyl('metal', 0.36, 0.36, 1.6, -0.35, 0.55, -1.0, { rz: Math.PI / 2, color: 0x8a2a1a, seg: 14 });
    P.cyl('rust', 0.13, 0.13, 2.55, -0.8, 1.48 + 1.27, -0.45, { seg: 10 });
    P.cyl('rust', 0.18, 0.18, 0.3, -0.8, CEIL_H - 0.15, -0.45, { seg: 10 });
    P.box('metal', 0.7, 0.55, 0.16, 0.2, 1.76, 0.78, { color: 0x3a3d40, rx: -0.3 });
    P.sphere('alarm', 0.04, 0.0, 1.82, 0.88, { seg: 8 });
    P.sphere('bulb', 0.04, 0.2, 1.82, 0.88, { seg: 8 });
    P.cyl('chrome', 0.05, 0.05, 0.03, 0.4, 1.78, 0.87, { rx: Math.PI / 2 - 0.3, seg: 10 });
    // mazos de cables hacia la pared
    for (let k = 0; k < 3; k++) P.rod('rubber', [0.8 + k * 0.08, 0.2, 1.1], [1.4 + k * 0.1, 0.03, 2.2 + k * 0.4], 0.035);
    signs.add('voltage', posterTexture('voltage'), 0.5, 0.5, cx - 0.25, 0.9, cz + 0.86, 0);
  } else {
    const P = B.at(cx, 0, cz, 0);
    P.box('concrete', 1.95, 0.15, 1.95, 0, 0.075, 0, { color: 0x8a8a86 });
    P.box('metal', 1.3, 1.4, 1.1, 0, 0.85, 0, { color: 0x5a6a5a });
    for (let i = 0; i < 7; i++) for (const s of [-1, 1]) P.box('metal', 0.04, 1.1, 0.26, -0.54 + i * 0.18, 0.85, s * 0.68, { color: 0x4a5a4a });
    for (let k = -1; k <= 1; k++) {
      for (let d = 0; d < 4; d++) P.cyl('plastic', 0.1, 0.1, 0.05, k * 0.38, 1.62 + d * 0.09, 0, { color: 0x7a4a2a, seg: 10 });
      P.cyl('chrome', 0.02, 0.02, 0.5, k * 0.38, 1.7, 0, { seg: 6 });
    }
    P.box('metal', 1.34, 0.08, 1.14, 0, 1.56, 0, { color: 0x4a5a4a });
    signs.add('voltage', posterTexture('voltage'), 0.5, 0.5, cx + 0.66, 0.95, cz, Math.PI / 2);
  }
}

// ---------------------------------------------------------------------------------------------
// Decorado de paredes, fachadas y callejones (no bloquea el paso: pegado a muros o en zonas inaccesibles)
function buildDecor(B, r, signs) {
  // --- Terminal
  signs.add('departures', departureBoardTexture(), 2.3, 1.15, 14.3, 2.95, 20.03, 0, { emissive: true });
  B.at(14.3, 2.95, 20, 0).box('metal', 2.5, 1.32, 0.1, 0, 0, 0.05, { color: 0x1a1a1a });
  signs.add('route', posterTexture('route'), 1.0, 1.0, 4.02, 1.7, 27.5, Math.PI / 2);
  signs.add('route', posterTexture('route'), 1.0, 1.0, 5.6, 1.8, 31.98, Math.PI);
  signs.add('nosmoke', posterTexture('nosmoke'), 0.9, 0.45, 4.02, 2.1, 30.5, Math.PI / 2);
  signs.add('nosmoke', posterTexture('nosmoke'), 0.9, 0.45, 17.98, 2.1, 22.2, -Math.PI / 2);
  signs.add('clock', posterTexture('clock'), 0.6, 0.6, 11.5, 3.05, 31.97, Math.PI, { transparent: true });
  signs.add('exit', posterTexture('exit'), 0.85, 0.32, 17.97, 3.2, 26, -Math.PI / 2, { emissive: true });
  B.at(11.5, 3.05, 32, Math.PI).cyl('metal', 0.33, 0.33, 0.05, 0, 0, 0.02, { rx: Math.PI / 2, seg: 20, color: 0x2a2a2a });
  // tablón de anuncios y papeles pegados
  for (let i = 0; i < 6; i++) B.at(4, 0, 21.5 + i * 0.3, Math.PI / 2).box('paint', 0.22, 0.3, 0.004, 0, 1.5 + r() * 0.6, 0.004, { color: 0xd8d2c0 });

  // --- Bar
  signs.add('neon', neonBarTexture(), 2.0, 1.0, 14.8, 2.8, 18.97, Math.PI, { emissive: true });
  for (const [x0, x1] of [[5.3, 9.6], [11.4, 14.4]]) {
    const len = x1 - x0, cx = (x0 + x1) / 2;
    const P = B.at(cx, 0, 5, 0);
    for (const y of [1.2, 1.7, 2.2]) {
      P.box('wood', len, 0.04, 0.24, 0, y, 0.12, { color: 0x3a2014 });
      for (let x = -len / 2 + 0.12; x < len / 2 - 0.1; x += 0.13 + r() * 0.1) if (r() < 0.8) bottle(P, x, y + 0.02, 0.1, r, 0.85);
    }
    P.box('wood', 0.05, 1.3, 0.24, -len / 2, 1.7, 0.12, { color: 0x2a160c });
    P.box('wood', 0.05, 1.3, 0.24, len / 2, 1.7, 0.12, { color: 0x2a160c });
  }
  {
    // diana
    const P = B.at(6.5, 1.75, 19, Math.PI);
    P.cyl('plastic', 0.26, 0.26, 0.04, 0, 0, 0.02, { rx: Math.PI / 2, seg: 20, color: 0x1a1a1a });
    P.cyl('plastic', 0.2, 0.2, 0.045, 0, 0, 0.02, { rx: Math.PI / 2, seg: 20, color: 0xd8ccb0 });
    P.cyl('plastic', 0.12, 0.12, 0.05, 0, 0, 0.02, { rx: Math.PI / 2, seg: 16, color: 0x8a1a1a });
    P.cyl('plastic', 0.03, 0.03, 0.055, 0, 0, 0.02, { rx: Math.PI / 2, seg: 10, color: 0x1a6a2a });
  }
  signs.add('nosmoke', posterTexture('nosmoke'), 0.9, 0.45, 17.98, 1.9, 16, -Math.PI / 2);

  // --- Almacén: cerchas del techo y tuberías
  for (const x of [21.5, 25.5, 29.5, 33.5]) {
    B.at(x, CEIL_H - 0.16, 12, 0).box('metal', 0.14, 0.3, 14, 0, 0, 0, { color: 0x3a3e42 });
  }
  B.at(28, 3.45, 5.15, 0).cyl('rust', 0.08, 0.08, 17.6, 0, 0, 0, { rz: Math.PI / 2, seg: 8 });
  B.at(28, 3.7, 18.85, 0).cyl('metal', 0.06, 0.06, 17.6, 0, 0, 0, { rz: Math.PI / 2, seg: 8, color: 0x6a6a60 });
  signs.add('almacen', posterTexture('almacen'), 2.4, 0.6, 32, 3.1, 18.98, Math.PI);
  // --- Planta: tuberías, bandejas de cables, armarios eléctricos y avisos
  B.at(46.5, 3.3, 5.18, 0).cyl('metal', 0.12, 0.12, 16.8, 0, 0, 0, { rz: Math.PI / 2, seg: 10, color: 0x5a6a7a });
  B.at(46.5, 3.62, 5.14, 0).cyl('metal', 0.07, 0.07, 16.8, 0, 0, 0, { rz: Math.PI / 2, seg: 8, color: 0x8a3a2a });
  B.at(46.5, CEIL_H - 0.3, 8.2, 0).box('metal', 16.8, 0.08, 0.45, 0, 0, 0, { color: 0x5a5e62 });
  for (let z = 6; z < 9.5; z += 1.2) {
    const P = B.at(38, 0, z, Math.PI / 2);
    P.box('metal', 1.0, 1.9, 0.2, 0, 1.15, 0.1, { color: 0x6a7068 });
    P.box('metal', 0.02, 1.8, 0.21, 0, 1.15, 0.1, { color: 0x2a2a2a });
    P.sphere(r() < 0.5 ? 'alarm' : 'bulb', 0.025, 0.3, 1.9, 0.21, { seg: 6 });
    P.box('metal', 0.06, 0.2, 0.04, 0.4, 1.2, 0.22, { color: 0x1a1a1a });
  }
  signs.add('voltage', posterTexture('voltage'), 0.6, 0.6, 47.5, 2.0, 5.02, 0);
  signs.add('voltage', posterTexture('voltage'), 0.6, 0.6, 54.98, 2.1, 9.3, -Math.PI / 2);
  signs.add('voltage', posterTexture('voltage'), 0.6, 0.6, 38.02, 1.8, 17.8, Math.PI / 2);
  signs.add('planta', posterTexture('planta'), 3.6, 0.56, 50.5, 3.3, 18.98, Math.PI);

  // --- Calle: carteles de fachada
  const fsign = (key, tex, side, a, y, w, h, out = 0.14, opts = {}) => {
    const [x, z] = facadePoint(side, a, out);
    signs.add(key, tex, w, h, x, y, z, facadePlaneYaw(side), opts);
  };
  fsign('terminal', posterTexture('terminal'), 'W', 26, 4.95, 5.4, 0.85);
  fsign('almacen', posterTexture('almacen'), 'N', 32, 5.1, 4.0, 1.0);
  fsign('planta', posterTexture('planta'), 'N', 46.5, 5.3, 6.6, 1.03);
  fsign('hotel', posterTexture('hotel'), 'S', 21.5, 6.3, 3.2, 0.8);
  fsign('farmacia', posterTexture('farmacia'), 'S', 31.25, 4.85, 3.6, 0.9);
  fsign('route', posterTexture('route'), 'W', 22.2, 2.2, 0.8, 0.8, 0.03);
  const cross = makeSign({ w: 128, h: 128, bg: '#060806', grime: 0, emissive: true, lines: [{ text: '+', size: 1.15, y: 0.52, color: '#8fffae', glow: '#3fff6a' }] });
  fsign('cross', cross, 'S', 35.2, 4.9, 0.8, 0.8, 0.2, { emissive: true });
  {
    const [x, z] = facadePoint('S', 35.2, 0.1);
    B.at(x, 4.9, z, facadePlaneYaw('S')).box('metal', 0.9, 0.9, 0.18, 0, 0, 0, { color: 0x1a1a1a });
  }

  // --- Calle: fachadas a pie de calle (escaparates, puertas, persiana, rejillas, toldos)
  const onF = (side, a, y, out) => { const [x, z] = facadePoint(side, a, out); return B.at(x, y, z, facadePlaneYaw(side)); };
  const shopWindow = (side, a0, a1, y0 = 0.85, y1 = 2.6, lit = false) => {
    const w = a1 - a0, a = (a0 + a1) / 2, h = y1 - y0;
    const P = onF(side, a, 0, 0);
    P.box(lit ? 'window_lit' : 'glass', w, h, 0.02, 0, y0 + h / 2, 0.01, { color: lit ? 0x9ad0b0 : 0xa0b0bc });
    P.box('metal', w + 0.12, 0.08, 0.1, 0, y1 + 0.04, 0.04, { color: 0x2a2a2a });
    P.box('metal', w + 0.16, 0.1, 0.16, 0, y0 - 0.05, 0.07, { color: 0x3a3a3a });
    P.box('metal', 0.07, h, 0.08, -w / 2, y0 + h / 2, 0.03, { color: 0x2a2a2a });
    P.box('metal', 0.07, h, 0.08, w / 2, y0 + h / 2, 0.03, { color: 0x2a2a2a });
    if (w > 1.8) P.box('metal', 0.05, h, 0.06, 0, y0 + h / 2, 0.03, { color: 0x2a2a2a });
    if (r() < 0.6) P.box('wood', w * 0.4, 0.14, 0.03, (r() - 0.5) * w * 0.3, y0 + h * (0.3 + r() * 0.4), 0.05, { color: 0x7a6040, rz: (r() - 0.5) * 0.6 });
  };
  const doorway = (side, a, col) => {
    const P = onF(side, a, 0, 0);
    P.box('wood', 1.2, 2.3, 0.05, 0, 1.15, 0.02, { color: col });
    P.box('glass', 0.7, 0.8, 0.02, 0, 1.75, 0.05, { color: 0x708090 });
    P.box('metal', 1.4, 0.1, 0.12, 0, 2.35, 0.05, { color: 0x2a2a2a });
    P.sphere('chrome', 0.04, 0.42, 1.05, 0.07, { seg: 6 });
  };
  const awning = (side, a0, a1, col) => {
    const P = onF(side, (a0 + a1) / 2, 2.85, 0);
    P.box('tarp', a1 - a0, 0.05, 1.3, 0, 0, 0.6, { color: col, rx: 0.32 });
    P.box('tarp', a1 - a0, 0.25, 0.03, 0, -0.33, 1.22, { color: col });
    for (const s of [-1, 1]) P.rod('metal', [s * (a1 - a0) / 2, 0.1, 0.02], [s * (a1 - a0) / 2, -0.2, 1.2], 0.015, { color: 0x2a2a2a });
  };
  // terminal (lado de la calle)
  shopWindow('W', 20.5, 23.6, 0.9, 2.7);
  shopWindow('W', 28.4, 31.6, 0.9, 2.7);
  // almacén: persiana metálica de carga
  {
    const P = onF('N', 31.9, 0, 0);
    P.box('corrugated', 3.6, 3.0, 0.05, 0, 1.5, 0.025, { color: 0x8a8e88 });
    P.box('metal', 3.9, 0.3, 0.2, 0, 3.12, 0.1, { color: 0x3a3c3a });
    P.box('metal', 0.14, 3.0, 0.14, -1.87, 1.5, 0.07, { color: 0x3a3c3a });
    P.box('metal', 0.14, 3.0, 0.14, 1.87, 1.5, 0.07, { color: 0x3a3c3a });
    P.box('zoc_hazard', 3.6, 0.15, 0.03, 0, 0.12, 0.06, {});
  }
  // planta: rejillas de ventilación y puerta de servicio
  for (const a of [40.2, 52.2]) {
    const P = onF('N', a, 0, 0);
    P.box('metal', 2.2, 1.4, 0.06, 0, 1.9, 0.03, { color: 0x4a4e4a });
    for (let y = 1.3; y < 2.6; y += 0.14) P.box('metal', 2.1, 0.03, 0.08, 0, y, 0.07, { color: 0x2a2c2a, rx: 0.5 });
  }
  {
    const P = onF('N', 43.6, 0, 0);
    P.box('metal', 1.0, 2.2, 0.05, 0, 1.1, 0.025, { color: 0x5a6a5a });
    P.box('zoc_hazard', 1.0, 0.12, 0.02, 0, 2.1, 0.055, {});
  }
  signs.add('voltage', posterTexture('voltage'), 0.5, 0.5, 43.6, 1.5, 20.06, 0);
  // hotel, farmacia, tienda, esquina y edificios del este
  doorway('S', 21.5, 0x4a2a18);
  shopWindow('S', 18.9, 20.6);
  shopWindow('S', 22.4, 24.2);
  awning('S', 19.2, 23.8, 0x7a2420);
  shopWindow('S', 28.8, 31.6, 0.85, 2.6, true);
  shopWindow('S', 35.0, 38.2, 0.85, 2.6, false);
  awning('S', 28.6, 38.4, 0x1f5a3c);
  shopWindow('S', 45.7, 48.5);
  doorway('S', 43.0, 0x2a3a4a);
  shopWindow('S', 52.6, 54.4);
  shopWindow('E', 20.3, 23.2);
  shopWindow('E', 27.7, 29.3);
  // tablero de herramientas sobre la mesa de trabajo
  {
    const P = onF('S', 33, 0, 0);
    P.box('wood', 2.2, 1.0, 0.03, 0, 1.75, 0.015, { color: 0xb8a078 });
    P.box('metal', 0.5, 0.05, 0.02, -0.6, 1.9, 0.04, { color: 0x6a6a6a, rz: 0.4 });
    P.box('metal', 0.04, 0.35, 0.02, -0.1, 1.8, 0.04, { color: 0x8a2a1a });
    P.box('metal', 0.14, 0.06, 0.02, -0.1, 1.98, 0.04, { color: 0x3a3a3a });
    P.box('metal', 0.4, 0.04, 0.02, 0.5, 1.6, 0.04, { color: 0x9a9a9a, rz: -0.8 });
    P.torus('rubber', 0.12, 0.02, 0.8, 2.0, 0.04, { seg: 14 });
  }
  // cables aéreos cruzando la calle
  for (const x of [24.5, 33.5, 43.5, 51]) {
    const a = [x, 7.4, 20.1], b = [x + 1.2, 6.6, 31.9];
    const m = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 0.9, (a[2] + b[2]) / 2];
    B.at(0, 0, 0, 0).rod('dark', a, m, 0.014).rod('dark', m, b, 0.014);
  }
  // callejones: bolsas de basura y un contenedor
  for (const w of WINDOW_INFO) {
    const s = w.pocket[r() < 0.5 ? 6 : 8];
    const P = B.at(s[0] + 0.5, 0, s[1] + 0.5, r() * TAU);
    P.sphere('rubber', 0.32, 0.1, 0.2, 0.05, { color: 0x1a2a1a, seg: 8, sy: 0.7 });
    P.sphere('rubber', 0.26, -0.22, 0.17, -0.1, { color: 0x14141a, seg: 8, sy: 0.7 });
    if (r() < 0.5) P.box('crate', 0.5, 0.4, 0.5, 0.2, 0.2, -0.25, { color: 0x9a8a78, ry: 0.5 });
  }
}

// Dibujos de tiza de las armas de pared (una sola malla con atlas)
function buildChalk(parent) {
  const entries = WALLBUYS.map((wb) => ({ id: wb.id, weapon: wb.weapon }));
  const { texture, rects } = chalkAtlas(entries);
  const geos = [];
  for (const wb of WALLBUYS) {
    const it = INTERACTABLE_BY_ID['wall:' + wb.id];
    if (!it) continue;
    const rc = rects[wb.id];
    const g = uvRectPlane(1.7, 0.85, rc.u0, rc.v0, rc.u1, rc.v1);
    const yaw = yawForFace(wb.wall);
    const nx = -Math.sin(yaw + Math.PI), nz = -Math.cos(yaw + Math.PI); // normal hacia la sala
    g.applyMatrix4(matrixFrom(it.wx + nx * 0.012, 1.55, it.wz + nz * 0.012, 0, yaw, 0));
    geos.push(g);
  }
  if (!geos.length) return null;
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (geos.length > 1) for (const g of geos) g.dispose();
  const mat = new THREE.MeshLambertMaterial({
    map: texture, transparent: true, depthWrite: false, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.28,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'chalk';
  mesh.renderOrder = 1;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  parent.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// Construye todos los props estáticos. Devuelve { signs, chalk }
export function buildStaticProps(B, world) {
  const r = makeRng(4242);
  const signs = world.signs;
  for (const p of PROPS) {
    switch (p.kind) {
      case 'bench': bench(B, p, r); break;
      case 'bus': bus(B, p, r, signs); break;
      case 'car': car(B, p, r, p.x0 > 40 ? world.flames : null); break;
      case 'barrel': barrels(B, p, r, world.flames); break;
      case 'counter': counter(B, p, r); break;
      case 'table': table(B, p, r); break;
      case 'crate': crates(B, p, r); break;
      case 'generator': generator(B, p, r, signs); break;
      default: {
        const { cx, cz, lx, lz } = rectOf(p);
        B.at(cx, 0, cz, 0).box('crate', lx * 0.9, p.h, lz * 0.9, 0, p.h / 2, 0, {});
      }
    }
  }
  buildDecor(B, r, signs);
  const chalk = buildChalk(world.root);
  return { chalk };
}

// Crea los interactuables (cada uno añade su parte estática al lote y sus objetos dinámicos a world.root)
export function createInteractives(world, B) {
  const list = [];
  const make = (name, C) => {
    try { const c = new C(world, B); c.name = name; list.push(c); return c; }
    catch (e) { console.error('[World] No se pudo crear', name, e); return null; }
  };
  make('doors', Doors);
  make('windows', Windows);
  make('perks', PerkMachines);
  make('pap', PackAPunch);
  make('power', PowerSwitch);
  make('bench', Workbench);
  make('box', MysteryBoxes);
  make('medcabinets', MedCabinets);
  return list;
}

export default { buildStaticProps, createInteractives, SignSet, Flames };
