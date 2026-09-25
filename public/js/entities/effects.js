// Clase Effects (SPEC 6.9): partículas y efectos visuales con pools (sangre, vísceras, chispas, polvo,
// marcas de bala, explosiones, trazadores, destellos, luces breves y fuego pegado a objetos).
// Todo se dibuja con pocas llamadas: 3 capas de partículas, 1 de trazadores, 4 de calcomanías y 1 de vísceras.
// Escucha 'ev:boom' para dibujar explosiones (con sonido y sacudida de cámara según la distancia).
import * as THREE from 'three';
import { GRENADE } from '/shared/constants.js';
import { weaponDef } from '/shared/weapons.js';
import { glowTexture, puffTexture } from './procgen.js';
import {
  ParticleLayer, RibbonLayer, DecalLayer, GibLayer, PFX, DECAL_CELL, dotTexture, decalAtlas,
} from './fxLayers.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _r = new THREE.Vector3();
const _p = new THREE.Vector3();
const _ex = new THREE.Vector3();
const _boom = new THREE.Vector3();
const _col = new THREE.Color();

// Convierte Vector3 / [x,y,z] / {x,y,z} en un Vector3 (out). null si no es válido.
function toVec(p, out) {
  if (!p) return null;
  if (p.isVector3) return out.copy(p);
  if (Array.isArray(p)) return out.set(+p[0] || 0, +p[1] || 0, +p[2] || 0);
  if (typeof p === 'object') return out.set(+p.x || 0, +p.y || 0, +p.z || 0);
  return null;
}

// Color (hex, cadena, THREE.Color o [r,g,b] lineal) → [r,g,b] lineal
function colorArr(c, mul = 1) {
  if (Array.isArray(c)) return [c[0] * mul, c[1] * mul, c[2] * mul];
  try { _col.set(c === undefined || c === null ? 0xffffff : c); } catch { _col.setRGB(1, 1, 1); }
  return [_col.r * mul, _col.g * mul, _col.b * mul];
}

function randDir(out) {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(a), u, s * Math.sin(a));
}

function coneDir(n, spread, out) {
  randDir(_r);
  return out.copy(n).addScaledVector(_r, spread).normalize();
}

function isAttached(obj) {
  let o = obj;
  while (o.parent) o = o.parent;
  return !!o.isScene;
}

// Paletas de explosión por tipo
const EXPL = {
  frag: {
    scale: 1, nFire: 1, nSmoke: 1, nEmber: 1, nDebris: 1, dust: true, scorch: 1, lightMul: 1,
    flash: [1, 0.82, 0.52], fire0: [1, 0.62, 0.22], fire1: [0.5, 0.1, 0.02],
    smoke0: [0.14, 0.13, 0.12], smoke1: [0.09, 0.085, 0.08], emb0: [1, 0.85, 0.45], emb1: [1, 0.3, 0.04],
    ring: [1, 0.55, 0.25], light: 0xffa050,
  },
  launcher: {
    scale: 1.15, nFire: 1.3, nSmoke: 1.2, nEmber: 1.2, nDebris: 1.2, dust: true, scorch: 1.1, lightMul: 1.2,
    flash: [1, 0.85, 0.6], fire0: [1, 0.66, 0.25], fire1: [0.5, 0.09, 0.02],
    smoke0: [0.15, 0.14, 0.13], smoke1: [0.08, 0.075, 0.07], emb0: [1, 0.85, 0.45], emb1: [1, 0.3, 0.04],
    ring: [1, 0.6, 0.3], light: 0xffa050,
  },
  ms: {
    scale: 0.8, nFire: 0.85, nSmoke: 0.5, nEmber: 0.9, nDebris: 0.4, dust: false, scorch: 0.7, lightMul: 0.8,
    flash: [1, 0.7, 0.4], fire0: [1, 0.5, 0.14], fire1: [0.55, 0.06, 0.02],
    smoke0: [0.13, 0.12, 0.11], smoke1: [0.08, 0.075, 0.07], emb0: [1, 0.75, 0.35], emb1: [1, 0.2, 0.03],
    ring: [1, 0.45, 0.2], light: 0xff7030,
  },
  raygun: {
    scale: 0.8, nFire: 0.9, nSmoke: 0.15, nEmber: 1.1, nDebris: 0, dust: false, scorch: 0.45, lightMul: 0.9,
    flash: [0.45, 1, 0.5], fire0: [0.35, 1, 0.4], fire1: [0.02, 0.3, 0.05],
    smoke0: [0.05, 0.14, 0.06], smoke1: [0.03, 0.07, 0.04], emb0: [0.7, 1, 0.7], emb1: [0.1, 0.8, 0.2],
    ring: [0.3, 1, 0.4], light: 0x40ff60,
  },
  raygun_up: {
    scale: 0.85, nFire: 1, nSmoke: 0.15, nEmber: 1.2, nDebris: 0, dust: false, scorch: 0.5, lightMul: 1,
    flash: [1, 0.4, 0.35], fire0: [1, 0.25, 0.2], fire1: [0.35, 0.02, 0.02],
    smoke0: [0.14, 0.04, 0.04], smoke1: [0.07, 0.03, 0.03], emb0: [1, 0.65, 0.55], emb1: [1, 0.1, 0.05],
    ring: [1, 0.25, 0.2], light: 0xff3030,
  },
};

const BLOOD_DARK = [[0.42, 0.02, 0.02], [0.33, 0.015, 0.015], [0.5, 0.04, 0.03]];
const GIB_COLORS = [[0.45, 0.04, 0.035], [0.3, 0.02, 0.02], [0.62, 0.1, 0.08], [0.72, 0.66, 0.54], [0.48, 0.22, 0.2]];

export class Effects {
  constructor(ctx) {
    this.ctx = ctx || {};
    this.t = 0;
    this.group = new THREE.Group();
    this.group.name = 'effects';
    if (this.ctx.scene && typeof this.ctx.scene.add === 'function') this.ctx.scene.add(this.group);
    const quality = this._quality();

    const glow = glowTexture(64, 2.2);
    const puff = puffTexture(64, 7);
    const dot = dotTexture(32);
    this.add = new ParticleLayer(this.group, { max: 1000, map: glow, additive: true, renderOrder: 6, name: 'fx_add' });
    this.smoke = new ParticleLayer(this.group, { max: 520, map: puff, renderOrder: 4, name: 'fx_smoke' });
    this.drops = new ParticleLayer(this.group, { max: 900, map: dot, renderOrder: 5, name: 'fx_drops' });
    this.drops.onStain = (x, z, size) => this._dropStain(x, z, size);
    this.tracers = new RibbonLayer(this.group, { max: 48, renderOrder: 7 });
    const atlas = decalAtlas();
    this.decals = new DecalLayer(this.group, { max: 60, map: atlas, renderOrder: 1, name: 'fx_holes', light: 0.9 });
    this.splats = new DecalLayer(this.group, { max: 64, map: atlas, renderOrder: 1, name: 'fx_splats', light: 0.75 });
    this.pools = new DecalLayer(this.group, { max: 28, map: atlas, renderOrder: 1, name: 'fx_pools', light: 0.7 });
    this.scorch = new DecalLayer(this.group, { max: 12, map: atlas, renderOrder: 1, name: 'fx_scorch', light: 1 });
    this.gibs = new GibLayer(this.group, { max: 64, quality, drops: this.drops });

    // Anillos de choque de las explosiones
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.82, 1, 48, 1);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, fog: false, toneMapped: false,
      });
      const m = new THREE.Mesh(ringGeo, mat);
      m.name = 'fx_ring';
      m.renderOrder = 6;
      m.frustumCulled = false;
      m.visible = true;        // visible al inicio para precompilar; se oculta en el primer update
      this.group.add(m);
      this.rings.push({ mesh: m, t: 0, dur: 0, r: 1, active: false });
    }

    // Luces dinámicas: cantidad fija para no recompilar sombreadores (intensidad 0 cuando están libres)
    this.lights = [];
    const nLights = quality === 'low' ? 1 : 3;
    for (let i = 0; i < nLights; i++) {
      const L = new THREE.PointLight(0xffffff, 0, 8, 2);
      L.name = 'fx_light';
      L.castShadow = false;
      this.group.add(L);
      this.lights.push({ L, t: 0, dur: 0, i0: 0, prio: -1, flicker: false });
    }

    this.fires = new Map();          // Object3D → { until, acc, sacc, box, boxAt }
    this._stainTokens = 10;

    const ev = this.ctx.events;
    if (ev && typeof ev.on === 'function') {
      ev.on('ev:boom', (e) => this._onBoom(e));
      ev.on('phase', (p) => { if (p && p.phase === 'lobby') this.clear(); });
    }
  }

  _quality() {
    const s = this.ctx.settings;
    return s && s.quality === 'low' ? 'low' : 'high';
  }

  _q() { return this._quality() === 'low' ? 0.55 : 1; }

  // ------------------------------------------------------------------ API pública (SPEC 6.9)
  blood(pos, dir, amount = 1) {
    const P = toVec(pos, _a);
    if (!P) return;
    amount = clamp(+amount || 1, 0.1, 4);
    const q = this._q();
    let D = dir ? toVec(dir, _b) : null;
    if (!D || D.lengthSq() < 1e-6) D = _b.set(0, 0.7, 0);
    D.normalize();
    const n = Math.max(2, Math.round((5 + 8 * amount) * q));
    for (let i = 0; i < n; i++) {
      coneDir(D, 0.95, _c);
      _c.y += 0.3;
      const sp = rnd(1.2, 3.8) * (0.75 + 0.25 * amount);
      const col = pick(BLOOD_DARK);
      this.drops.spawn({
        x: P.x, y: P.y, z: P.z, vx: _c.x * sp, vy: _c.y * sp, vz: _c.z * sp,
        life: rnd(0.5, 0.95), size: rnd(0.024, 0.052), size1: rnd(0.014, 0.028),
        color: col, alpha: 0.95, fout: 0.75, grav: 9.8, drag: 0.8, stretch: 0.012,
        flags: PFX.COLLIDE | PFX.STAIN,
      });
    }
    const m = Math.max(1, Math.round((1 + amount) * q));
    const big = 0.8 + 0.3 * amount;
    for (let i = 0; i < m; i++) {
      this.smoke.spawn({
        x: P.x + rnd(-0.05, 0.05), y: P.y + rnd(-0.05, 0.05), z: P.z + rnd(-0.05, 0.05),
        vx: D.x * rnd(0.4, 1.2), vy: D.y * rnd(0.4, 1.2) + 0.1, vz: D.z * rnd(0.4, 1.2),
        life: rnd(0.3, 0.55), size: rnd(0.1, 0.18) * big, size1: rnd(0.4, 0.65) * big,
        color: [0.32, 0.015, 0.015], color1: [0.16, 0.01, 0.01], alpha: 0.55, fin: 0.05, fout: 0.3, drag: 5,
      });
    }
  }

  gib(pos, amount = 1) {
    const P = toVec(pos, _ex);
    if (!P) return;
    amount = clamp(+amount || 1, 0.2, 4);
    const n = Math.max(2, Math.round((3 + 4 * amount) * this._q()));
    for (let i = 0; i < n; i++) {
      randDir(_c);
      _c.y = Math.abs(_c.y) * 0.8 + 0.45;
      const sp = rnd(2, 5.2) * (0.8 + 0.2 * amount);
      this.gibs.spawn(
        P.x + _c.x * 0.08, P.y + _c.y * 0.08, P.z + _c.z * 0.08,
        _c.x * sp, _c.y * sp, _c.z * sp,
        rnd(0.03, 0.07) * (0.9 + 0.15 * amount), pick(GIB_COLORS),
      );
    }
    this.blood(P, UP, amount * 1.4);
  }

  spark(pos, normal) {
    const P = toVec(pos, _a);
    if (!P) return;
    let N = normal ? toVec(normal, _b) : null;
    if (!N || N.lengthSq() < 1e-6) N = _b.set(0, 1, 0);
    N.normalize();
    const n = Math.max(3, Math.round(rnd(6, 11) * this._q()));
    for (let i = 0; i < n; i++) {
      coneDir(N, 0.85, _c);
      const sp = rnd(3, 9);
      this.add.spawn({
        x: P.x + N.x * 0.01, y: P.y + N.y * 0.01, z: P.z + N.z * 0.01,
        vx: _c.x * sp, vy: _c.y * sp, vz: _c.z * sp,
        life: rnd(0.12, 0.35), size: rnd(0.012, 0.022), size1: 0.006,
        color: [1, 0.85, 0.5], color1: [1, 0.35, 0.05], alpha: 1, fout: 0.5, grav: 9, drag: 1.5, stretch: 0.025,
        flags: PFX.COLLIDE | PFX.BOUNCE,
      });
    }
    this.add.spawn({
      x: P.x + N.x * 0.03, y: P.y + N.y * 0.03, z: P.z + N.z * 0.03,
      life: 0.06, size: rnd(0.12, 0.2), size1: 0.05, color: [1, 0.8, 0.5], alpha: 0.9, fout: 0,
    });
    this.smoke.spawn({
      x: P.x + N.x * 0.04, y: P.y + N.y * 0.04, z: P.z + N.z * 0.04,
      vx: N.x * 0.4, vy: N.y * 0.4 + 0.2, vz: N.z * 0.4,
      life: rnd(0.5, 0.8), size: 0.05, size1: 0.28, color: [0.35, 0.34, 0.33], alpha: 0.32, fin: 0.1, fout: 0.2, drag: 3,
    });
  }

  dust(pos, normal) {
    const P = toVec(pos, _a);
    if (!P) return;
    let N = normal ? toVec(normal, _b) : null;
    if (!N || N.lengthSq() < 1e-6) N = _b.set(0, 1, 0);
    N.normalize();
    const q = this._q();
    const tint = rnd(0.85, 1.1);
    const np = Math.max(1, Math.round(rnd(2, 3.5) * q));
    for (let i = 0; i < np; i++) {
      randDir(_c);
      const sp = rnd(0.3, 0.9);
      this.smoke.spawn({
        x: P.x + N.x * 0.03, y: P.y + N.y * 0.03, z: P.z + N.z * 0.03,
        vx: N.x * sp + _c.x * 0.2, vy: N.y * sp + _c.y * 0.2 + 0.15, vz: N.z * sp + _c.z * 0.2,
        life: rnd(0.6, 1.1), size: rnd(0.06, 0.1), size1: rnd(0.3, 0.55),
        color: [0.42 * tint, 0.38 * tint, 0.32 * tint], alpha: 0.5, fin: 0.08, fout: 0.25, drag: 3.5, grav: -0.1,
      });
    }
    const nc = Math.max(1, Math.round(rnd(3, 6) * q));
    for (let i = 0; i < nc; i++) {
      coneDir(N, 0.7, _c);
      const sp = rnd(1.5, 4);
      this.drops.spawn({
        x: P.x + N.x * 0.02, y: P.y + N.y * 0.02, z: P.z + N.z * 0.02,
        vx: _c.x * sp, vy: _c.y * sp, vz: _c.z * sp,
        life: rnd(0.4, 0.8), size: rnd(0.015, 0.03), color: [0.22 * tint, 0.19 * tint, 0.15 * tint],
        alpha: 1, fout: 0.7, grav: 9.8, flags: PFX.COLLIDE | PFX.BOUNCE,
      });
    }
  }

  // Marca de bala. kind opcional: 'hole' (por defecto), 'chip', 'blood', 'scorch'
  decal(pos, normal, kind) {
    const P = toVec(pos, _a);
    if (!P) return;
    let N = normal ? toVec(normal, _b) : null;
    if (!N || N.lengthSq() < 1e-6) N = _b.set(0, 1, 0);
    N.normalize();
    _p.copy(P).addScaledVector(N, 0.004);
    if (kind === 'blood') {
      this.splats.add(_p, N, rnd(0.25, 0.45), { cell: DECAL_CELL.BLOOD, alpha: 0.9, bright: 0.85, life: 40 });
    } else if (kind === 'scorch') {
      this.scorch.add(_p, N, rnd(0.5, 0.8), { cell: DECAL_CELL.SCORCH, alpha: 0.85, life: 60 });
    } else {
      const cell = kind === 'chip' ? DECAL_CELL.CHIP : kind === 'hole' ? DECAL_CELL.HOLE
        : (Math.random() < 0.3 ? DECAL_CELL.CHIP : DECAL_CELL.HOLE);
      this.decals.add(_p, N, rnd(0.07, 0.1), { cell, alpha: 0.95, bright: 1 });
    }
  }

  explosion(pos, radius = 4, kind = 'frag') {
    const P = toVec(pos, _ex);
    if (!P) return;
    const K = EXPL[kind] || EXPL.frag;
    const R = clamp(+radius || 4, 0.5, 12);
    const s = clamp(R / 4, 0.45, 1.6) * K.scale;
    const q = this._q();
    const x = P.x, y = P.y, z = P.z;
    // Destello central
    this.add.spawn({ x, y, z, life: 0.16, size: 1.2 * s, size1: 4.2 * s, color: K.flash, alpha: 1, fout: 0 });
    this.add.spawn({ x, y, z, life: 0.08, size: 0.8 * s, size1: 2 * s, color: [1, 1, 1], alpha: 1, fout: 0 });
    // Bolas de fuego / plasma
    const nf = Math.round(K.nFire * 12 * q);
    for (let i = 0; i < nf; i++) {
      randDir(_c);
      _c.y = Math.abs(_c.y) * 0.9 + 0.1;
      const sp = rnd(1.5, 5.5) * s;
      this.add.spawn({
        x: x + _c.x * 0.3 * s, y: y + _c.y * 0.2 * s, z: z + _c.z * 0.3 * s,
        vx: _c.x * sp, vy: _c.y * sp + 0.8, vz: _c.z * sp,
        life: rnd(0.35, 0.75), size: rnd(0.5, 0.9) * s, size1: rnd(1.3, 2.1) * s,
        color: K.fire0, color1: K.fire1, alpha: 0.95, fin: 0.03, fout: 0.35, drag: 4.5, grav: -1.2, spin: rnd(-2, 2),
      });
    }
    // Humo
    const ns = Math.round(K.nSmoke * 12 * q);
    for (let i = 0; i < ns; i++) {
      randDir(_c);
      _c.y = Math.abs(_c.y) * 0.6 + 0.25;
      const sp = rnd(0.8, 2.8) * s;
      this.smoke.spawn({
        x: x + _c.x * 0.5 * s, y: y + _c.y * 0.3 * s, z: z + _c.z * 0.5 * s,
        vx: _c.x * sp, vy: _c.y * sp, vz: _c.z * sp,
        life: rnd(1.6, 3.2), size: rnd(0.6, 1) * s, size1: rnd(2.2, 3.5) * s,
        color: K.smoke0, color1: K.smoke1, alpha: 0.75, fin: 0.12, fout: 0.45, drag: 2.2, grav: -0.35, spin: rnd(-0.6, 0.6),
      });
    }
    // Chispas / brasas
    const ne = Math.round(K.nEmber * 26 * q);
    const se = Math.sqrt(s);
    for (let i = 0; i < ne; i++) {
      randDir(_c);
      _c.y = Math.abs(_c.y) + 0.2;
      _c.normalize();
      const sp = rnd(4, 13) * se;
      this.add.spawn({
        x, y, z, vx: _c.x * sp, vy: _c.y * sp, vz: _c.z * sp,
        life: rnd(0.4, 1.1), size: rnd(0.02, 0.045), size1: 0.01,
        color: K.emb0, color1: K.emb1, alpha: 1, fout: 0.6, grav: 9, drag: 1.2, stretch: 0.03,
        flags: PFX.COLLIDE | PFX.BOUNCE,
      });
    }
    // Escombros
    const nd = Math.round(K.nDebris * 14 * q);
    for (let i = 0; i < nd; i++) {
      randDir(_c);
      _c.y = Math.abs(_c.y) + 0.35;
      _c.normalize();
      const sp = rnd(3, 8) * se;
      const g = rnd(0.08, 0.16);
      this.drops.spawn({
        x, y, z, vx: _c.x * sp, vy: _c.y * sp, vz: _c.z * sp,
        life: rnd(0.8, 1.5), size: rnd(0.03, 0.07), color: [g, g * 0.85, g * 0.7], alpha: 1, fout: 0.8,
        grav: 9.8, spin: rnd(-8, 8), flags: PFX.COLLIDE | PFX.BOUNCE,
      });
    }
    // Polvo a ras de suelo
    if (K.dust && y < 1.5) {
      const nr = Math.round(8 * q);
      for (let k = 0; k < nr; k++) {
        const a = (k / nr) * Math.PI * 2 + rnd(-0.3, 0.3);
        const sp = rnd(3, 5) * s;
        this.smoke.spawn({
          x: x + Math.cos(a) * 0.3, y: 0.15, z: z + Math.sin(a) * 0.3,
          vx: Math.cos(a) * sp, vy: 0.2, vz: Math.sin(a) * sp,
          life: rnd(0.9, 1.5), size: 0.4 * s, size1: 1.6 * s, color: [0.36, 0.33, 0.29], color1: [0.26, 0.24, 0.22],
          alpha: 0.5, fin: 0.05, fout: 0.3, drag: 3.2,
        });
      }
    }
    if (y < 1.8) this._ring(x, z, R, K.ring);
    if (K.scorch > 0 && y < 1.2) {
      this.scorch.add(_p.set(x, 0.013, z), UP, R * 0.55 * K.scorch, { cell: DECAL_CELL.SCORCH, alpha: 0.9, life: 60 });
    }
    this._light(_p.set(x, y + 0.3, z), K.light, 60 * s * K.lightMul, R * 3.2, 0.45, 2);
  }

  tracer(from, to, color = 0xffe0a0) {
    const A = toVec(from, _a), B = toVec(to, _b);
    if (!A || !B) return;
    const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
    const dist = Math.hypot(dx, dy, dz);
    if (!(dist > 0.05) || dist > 400) return;
    const c = colorArr(color, 1.6);
    const base = { ax: A.x, ay: A.y, az: A.z, dx: dx / dist, dy: dy / dist, dz: dz / dist, dist, age: 0 };
    const speed = 380;
    this.tracers.add(Object.assign({}, base, {
      streak: true, speed, len: Math.min(dist, 7), life: dist / speed + 0.25, width: 0.03, color: c, alpha: 0.95,
    }));
    this.tracers.add(Object.assign({}, base, {
      streak: false, life: 0.09, width: 0.012, color: c, alpha: 0.3,
    }));
  }

  muzzleLight(pos) {
    const P = toVec(pos, _a);
    if (!P) return;
    this._light(P, 0xffc27a, 14, 7, 0.07, 1);
  }

  flash(pos, color = 0xffffff, size = 1) {
    const P = toVec(pos, _a);
    if (!P) return;
    const s = clamp(+size || 1, 0.05, 20);
    const c = colorArr(color);
    this.add.spawn({ x: P.x, y: P.y, z: P.z, life: 0.28, size: s * 0.8, size1: s * 1.5, color: c, alpha: 1, fout: 0.1 });
    this.add.spawn({
      x: P.x, y: P.y, z: P.z, life: 0.12, size: s * 0.35, size1: s * 0.5,
      color: [0.6 + c[0] * 0.4, 0.6 + c[1] * 0.4, 0.6 + c[2] * 0.4], alpha: 0.9, fout: 0,
    });
    if (s >= 1.2) this._light(P, color, 20 * s, 4 + 3 * s, 0.3, 0);
  }

  // Llamas pegadas a un objeto durante `seconds` (se renueva si ya ardía)
  fire(object3D, seconds = 2) {
    if (!object3D || !object3D.isObject3D) return;
    const until = this.t + Math.max(0.05, +seconds || 0);
    const f = this.fires.get(object3D);
    if (f) { f.until = Math.max(f.until, until); return; }
    this.fires.set(object3D, { until, acc: 0, sacc: 0, box: new THREE.Box3(), boxAt: -1 });
  }

  // ------------------------------------------------------------------ Extras (usados por los modelos)
  // Charco de sangre en el suelo que crece
  bloodPool(pos, size = 0.6) {
    const P = toVec(pos, _a);
    if (!P) return;
    const s = clamp(+size || 0.6, 0.1, 2.5);
    this.pools.add(_p.set(P.x, 0.011 + Math.random() * 0.002, P.z), UP, s, {
      cell: DECAL_CELL.BLOOD, alpha: 0.92, bright: 0.8, life: 45, grow: 0.9 + s,
    });
  }

  isBurning(object3D) {
    const f = object3D && this.fires.get(object3D);
    return !!(f && f.until > this.t);
  }

  clear() {
    this.add.clear(); this.smoke.clear(); this.drops.clear();
    this.tracers.clear(); this.gibs.clear();
    this.decals.clear(); this.splats.clear(); this.pools.clear(); this.scorch.clear();
    this.fires.clear();
    for (const r of this.rings) { r.active = false; r.mesh.visible = false; }
    for (const l of this.lights) { l.prio = -1; l.L.intensity = 0; }
  }

  reset() { this.clear(); }

  // ------------------------------------------------------------------ Bucle
  update(dt) {
    dt = Math.min(Math.max(+dt || 0, 0), 0.1);
    this.t += dt;
    this._stainTokens = Math.min(12, this._stainTokens + dt * 25);
    this._updateFires(dt);
    this.gibs.update(dt);
    this.add.update(dt);
    this.smoke.update(dt);
    this.drops.update(dt);
    this.tracers.update(dt);
    this.decals.update(dt);
    this.splats.update(dt);
    this.pools.update(dt);
    this.scorch.update(dt);
    this._updateRings(dt);
    this._updateLights(dt);
  }

  // ------------------------------------------------------------------ Internos
  _dropStain(x, z, size) {
    if (this._stainTokens < 1 || Math.random() > 0.45) return;
    this._stainTokens -= 1;
    this.splats.add(_p.set(x, 0.012 + Math.random() * 0.002, z), UP, rnd(0.07, 0.16) + size * 2, {
      cell: DECAL_CELL.BLOOD, alpha: 0.85, bright: 0.8, life: 30, grow: 0.12,
    });
  }

  _ring(x, z, R, color) {
    let slot = this.rings.find((r) => !r.active);
    if (!slot) slot = this.rings.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    slot.active = true;
    slot.t = 0;
    slot.dur = 0.38;
    slot.r = R * 1.1;
    slot.mesh.position.set(x, 0.05, z);
    slot.mesh.material.color.setRGB(color[0], color[1], color[2]);
    slot.mesh.scale.setScalar(0.15 * R);
    slot.mesh.material.opacity = 0.8;
    slot.mesh.visible = true;
  }

  _updateRings(dt) {
    for (const r of this.rings) {
      if (!r.active) { if (r.mesh.visible) r.mesh.visible = false; continue; }
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { r.active = false; r.mesh.visible = false; continue; }
      const e = 1 - (1 - k) * (1 - k);
      r.mesh.scale.setScalar(Math.max(0.01, r.r * (0.15 + 0.85 * e)));
      r.mesh.material.opacity = 0.8 * (1 - k);
    }
  }

  // Pide una luz breve. prio: 0 fuego/destellos, 1 disparos, 2 explosiones
  _light(pos, color, intensity, distance, dur, prio, flicker = false) {
    if (!this.lights.length) return;
    let best = null;
    for (const l of this.lights) {
      if (l.prio < 0) { best = l; break; }
    }
    if (!best) {
      let score = Infinity;
      for (const l of this.lights) {
        if (l.prio > prio) continue;
        const rem = l.i0 * Math.max(0, 1 - l.t / l.dur) + l.prio * 1000;
        if (rem < score) { score = rem; best = l; }
      }
    }
    if (!best) return;
    best.L.position.copy(pos);
    if (Array.isArray(color)) best.L.color.setRGB(+color[0] || 0, +color[1] || 0, +color[2] || 0);
    else { try { best.L.color.set(color); } catch { best.L.color.setRGB(1, 1, 1); } }
    best.L.distance = distance;
    best.i0 = intensity;
    best.t = 0;
    best.dur = dur;
    best.prio = prio;
    best.flicker = flicker;
    best.L.intensity = intensity;
  }

  _updateLights(dt) {
    for (const l of this.lights) {
      if (l.prio < 0) continue;
      l.t += dt;
      const k = 1 - l.t / l.dur;
      if (k <= 0) { l.prio = -1; l.L.intensity = 0; continue; }
      let I = l.i0 * (l.flicker ? 1 : k * (2 - k));
      if (l.flicker) I *= 0.75 + Math.random() * 0.5;
      l.L.intensity = I;
    }
  }

  _updateFires(dt) {
    if (!this.fires.size) return;
    const q = this._q();
    const rateMul = 1 / Math.max(1, this.fires.size / 6);
    const cam = this.ctx.camera;
    let best = null, bestD = Infinity;
    for (const [obj, f] of this.fires) {
      if (this.t > f.until || !isAttached(obj)) { this.fires.delete(obj); continue; }
      if (this.t >= f.boxAt) {
        f.boxAt = this.t + 0.25;
        try { f.box.setFromObject(obj); } catch { f.box.makeEmpty(); }
        if (f.box.isEmpty() || !isFinite(f.box.min.x)) {
          obj.getWorldPosition(_c);
          f.box.min.set(_c.x - 0.25, _c.y, _c.z - 0.25);
          f.box.max.set(_c.x + 0.25, _c.y + 1.6, _c.z + 0.25);
        }
      }
      const b = f.box;
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      const sx = Math.min(1.2, (b.max.x - b.min.x) * 0.35), sz = Math.min(1.2, (b.max.z - b.min.z) * 0.35);
      const h = Math.max(0.15, Math.min(3, b.max.y - Math.max(0, b.min.y)));
      const y0 = Math.max(0, b.min.y);
      let far = false;
      if (cam) {
        const d = Math.hypot(cam.position.x - cx, cam.position.z - cz);
        far = d > 60;
        if (d < bestD) { bestD = d; best = f; }
      }
      if (far) continue;
      const rate = clamp((sx + sz + 0.3) * h * 45, 10, 48) * rateMul * q;
      f.acc += rate * dt;
      while (f.acc >= 1) {
        f.acc -= 1;
        this.add.spawn({
          x: cx + rnd(-sx, sx), y: y0 + rnd(0, h * 0.85), z: cz + rnd(-sz, sz),
          vx: rnd(-0.15, 0.15), vy: rnd(0.7, 1.5), vz: rnd(-0.15, 0.15),
          life: rnd(0.3, 0.6), size: rnd(0.14, 0.26), size1: rnd(0.04, 0.08),
          color: [1, 0.72, 0.3], color1: [0.85, 0.16, 0.02], alpha: 0.9, fin: 0.12, fout: 0.3, drag: 1, grav: -0.8,
          spin: rnd(-3, 3),
        });
      }
      f.sacc += dt;
      if (f.sacc > 0.2) {
        f.sacc = 0;
        this.smoke.spawn({
          x: cx + rnd(-sx, sx) * 0.5, y: y0 + h * 0.9, z: cz + rnd(-sz, sz) * 0.5,
          vx: rnd(-0.1, 0.1), vy: rnd(0.6, 1.1), vz: rnd(-0.1, 0.1),
          life: rnd(1.2, 2), size: 0.2, size1: rnd(0.7, 1.1), color: [0.1, 0.09, 0.085], alpha: 0.45, fin: 0.15, fout: 0.4,
          drag: 0.8, grav: -0.2, spin: rnd(-0.5, 0.5),
        });
      }
    }
    if (best && bestD < 30) {
      const b = best.box;
      _p.set((b.min.x + b.max.x) / 2, Math.max(0.3, (b.min.y + b.max.y) / 2), (b.min.z + b.max.z) / 2);
      // renovar la luz de fuego si la tiene o si hay una libre
      const own = this.lights.find((l) => l.prio === 0 && l.flicker);
      if (own) {
        own.L.position.copy(_p);
        own.t = 0;
      } else {
        this._light(_p, 0xff8a30, 7, 5, 0.25, 0, true);
      }
    }
  }

  _onBoom(e) {
    if (!e || !Array.isArray(e.p)) return;
    const P = _boom.set(+e.p[0] || 0, Math.max(0.05, +e.p[1] || 0), +e.p[2] || 0);
    if (!isFinite(P.x) || !isFinite(P.z)) return;
    let def = null;
    if (e.w && e.w !== 'frag') { try { def = weaponDef(e.w, !!e.up); } catch { def = null; } }
    let kind = 'frag';
    if (def) {
      if (def.model === 'raygun') kind = e.up ? 'raygun_up' : 'raygun';
      else if (def.model === 'launcher') kind = 'launcher';
      else if (def.key === 'm1911' || def.model === 'pistol') kind = 'ms';
    }
    const r = +e.r > 0 ? +e.r : (def && def.projectile ? def.projectile.splash : GRENADE.radius);
    this.explosion(P, r, kind);
    const audio = this.ctx.audio;
    if (audio && typeof audio.play === 'function') {
      const ray = kind === 'raygun' || kind === 'raygun_up';
      try {
        audio.play('explosion', {
          pos: P.clone(),
          volume: ray ? 0.55 : kind === 'ms' ? 0.75 : 1,
          rate: ray ? 1.35 : kind === 'ms' ? 1.15 : kind === 'launcher' ? 0.92 : 1,
        });
      } catch { /* sin sonido */ }
    }
    // Sacudida de cámara según la distancia (PlayerController.shake toma el máximo)
    const pl = this.ctx.player;
    if (pl && typeof pl.shake === 'function' && pl.position) {
      const d = Math.hypot(pl.position.x - P.x, (pl.position.y || 0) + 1 - P.y, pl.position.z - P.z);
      const R = Math.max(4, r * 3);
      if (d < R) {
        const k = 1 - d / R;
        try { pl.shake(k * (kind === 'raygun' || kind === 'raygun_up' ? 0.45 : 1.0), 0.35 + 0.3 * k); } catch { /* nada */ }
      }
    }
  }
}

export default Effects;
