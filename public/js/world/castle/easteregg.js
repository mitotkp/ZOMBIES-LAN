// Easter egg del Castillo en el mundo: viales de sangre escondidos, el colmillo del Conde, la centrifugadora del
// laboratorio (con su pantalla, que muestra el orden de los braseros) y los cuatro braseros del patio.
// Todo se deriva de gs.ee (server/easteregg.js); aquí solo hay animación.
import * as THREE from 'three';
import { MAP } from '/shared/map.js';
import { makeGlow, makePool, flickerNoise, sfx } from '../kit.js';
import { Flames } from '../props.js';

const TAU = Math.PI * 2;
// Emblemas de los braseros (índice = color del brasero en el mapa)
export const EMBLEMS = [
  { name: 'Sangre', css: '#e0283a', hex: 0xff2a3a },
  { name: 'Luna', css: '#8ab8ff', hex: 0x7ab0ff },
  { name: 'Veneno', css: '#6aff7a', hex: 0x5aff6a },
  { name: 'Sol', css: '#ffc23a', hex: 0xffb02a },
];

function drawEmblem(g, kind, cx, cy, R, color, bg = '#031208') {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = color; g.strokeStyle = color; g.lineWidth = R * 0.12;
  g.shadowColor = color; g.shadowBlur = R * 0.35;
  g.beginPath();
  if (kind === 0) {           // gota de sangre
    g.moveTo(0, -R);
    g.bezierCurveTo(R * 0.2, -R * 0.4, R * 0.75, 0, R * 0.75, R * 0.35);
    g.arc(0, R * 0.35, R * 0.75, 0, Math.PI);
    g.bezierCurveTo(-R * 0.75, 0, -R * 0.2, -R * 0.4, 0, -R);
    g.fill();
  } else if (kind === 1) {    // luna creciente
    g.arc(0, 0, R * 0.85, 0, TAU);
    g.fill();
    g.shadowBlur = 0; g.fillStyle = bg;
    g.beginPath(); g.arc(R * 0.38, -R * 0.18, R * 0.72, 0, TAU); g.fill();
  } else if (kind === 2) {    // calavera
    g.arc(0, -R * 0.15, R * 0.62, 0, TAU); g.fill();
    g.fillRect(-R * 0.36, R * 0.3, R * 0.72, R * 0.42);
    g.shadowBlur = 0; g.fillStyle = bg;
    g.beginPath(); g.arc(-R * 0.24, -R * 0.15, R * 0.16, 0, TAU); g.arc(R * 0.24, -R * 0.15, R * 0.16, 0, TAU); g.fill();
    g.fillRect(-R * 0.04, R * 0.42, R * 0.08, R * 0.3);
  } else {                    // sol
    g.arc(0, 0, R * 0.42, 0, TAU); g.fill();
    for (let k = 0; k < 8; k++) {
      const a = k * TAU / 8;
      g.beginPath();
      g.moveTo(Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55);
      g.lineTo(Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95);
      g.stroke();
    }
  }
  g.restore();
}

function canvasTex(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { c, g: c.getContext('2d'), t };
}

export class CastleEE {
  constructor(world) {
    this.world = world;
    this.ctx = world.ctx;
    this.name = 'castleEE';
    this.E = MAP.EE;
    this.t = 0;
    this.root = new THREE.Group();
    world.root.add(this.root);
    const mats = world.mats;
    const track = (m) => (mats.track ? mats.track(m) : m);
    this.mGlass = track(new THREE.MeshLambertMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.mBlood = track(new THREE.MeshLambertMaterial({ color: 0x8a0010, emissive: 0xff1020, emissiveIntensity: 0.7 }));
    this.mBone = track(new THREE.MeshLambertMaterial({ color: 0xf0ead8, emissive: 0xfff0d0, emissiveIntensity: 0.25 }));
    this.mCork = track(new THREE.MeshLambertMaterial({ color: 0x6a4a2a }));

    // Viales (uno por escondite; solo se ven los activos durante el paso 1)
    this.vials = this.E.vials.map((v) => {
      const g = new THREE.Group();
      g.position.set(v.x + 0.5, MAP.baseY(v.lv || 0), v.z + 0.5);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 10), this.mGlass);
      const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 10), this.mBlood);
      liquid.position.y = -0.03;
      const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.06, 8), this.mCork);
      cork.position.y = 0.17;
      const inner = new THREE.Group();
      inner.add(body, liquid, cork);
      inner.position.y = 0.95;
      inner.rotation.z = 0.2;
      const glow = makeGlow(0xff1a2a, 0.9, 0.55);
      glow.position.y = 0.95;
      const pool = makePool(0xff1a2a, 1.4, 0.3);
      pool.position.y = 0.03;
      g.add(inner, glow, pool);
      g.visible = false;
      this.root.add(g);
      return { g, inner, glow, ph: Math.random() * TAU };
    });

    // Colmillo del Conde
    this.fang = new THREE.Group();
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 10), this.mBone);
    tooth.rotation.z = Math.PI;
    tooth.position.y = 0.0;
    const root = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), this.mBone);
    root.position.y = 0.14;
    root.scale.set(1, 0.7, 1);
    this.fangInner = new THREE.Group();
    this.fangInner.add(tooth, root);
    this.fangInner.position.y = 0.8;
    this.fangGlow = makeGlow(0xfff0c0, 1.2, 0.6);
    this.fangGlow.position.y = 0.8;
    const fpool = makePool(0xff2a2a, 1.6, 0.4);
    fpool.position.y = 0.03;
    this.fang.add(this.fangInner, this.fangGlow, fpool);
    this.fang.visible = false;
    this.root.add(this.fang);

    // Braseros: emblema en las cuatro caras del pedestal y fuego del color del emblema
    this.braziers = this.E.braziers.map((b, i) => {
      const prop = MAP.PROPS.find((p) => p.kind === 'brazier' && p.x0 === b.x && p.z0 === b.z);
      const kind = prop && Number.isInteger(prop.color) ? prop.color : i;
      const em = EMBLEMS[kind] || EMBLEMS[0];
      const x = b.x + 0.5, z = b.z + 0.5, y = MAP.baseY(b.lv || 0);
      const { c, g, t } = canvasTex(128, 128);
      g.fillStyle = '#2a2622'; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#6a5a40'; g.lineWidth = 6; g.strokeRect(6, 6, 116, 116);
      drawEmblem(g, kind, 64, 64, 40, em.css, '#2a2622');
      void c;
      const mat = track(new THREE.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35 }));
      for (let k = 0; k < 4; k++) {
        const a = k * TAU / 4;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), mat);
        m.position.set(x + Math.sin(a) * 0.265, y + 0.45, z + Math.cos(a) * 0.265);
        m.rotation.y = a;
        this.root.add(m);
      }
      const fl = new THREE.Group();
      const flames = new Flames(fl);
      flames.add(x, y + 1.1, z, 1.3);
      for (const f of flames.list) {
        for (const s of f.sprites) s.s.material.color.setHex(em.hex).lerp(new THREE.Color(0xffffff), 0.15);
        f.glow.material.color.setHex(em.hex);
      }
      const pool = makePool(em.hex, 4, 0.5);
      pool.position.set(x, y + 0.03, z);
      fl.add(pool);
      fl.visible = false;
      this.root.add(fl);
      return { i, kind, em, fl, flames, mat, lit: false };
    });

    // Centrifugadora: tambor giratorio con los viales cargados
    const cp = MAP.PROPS.find((p) => p.kind === 'centrifuge');
    this.centri = null;
    if (cp) {
      const cx = (cp.x0 + cp.x1 + 1) / 2, cz = (cp.z0 + cp.z1 + 1) / 2, y = MAP.baseY(cp.lv || 0);
      const drum = new THREE.Group();
      drum.position.set(cx, y + 1.0, cz);
      const slots = [];
      for (let k = 0; k < 4; k++) {
        const a = k * TAU / 4;
        const v = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.46, 8), k === 3 ? this.mBone : this.mBlood);
        v.position.set(Math.cos(a) * 0.45, 0.02, Math.sin(a) * 0.45);
        v.visible = false;
        drum.add(v);
        slots.push(v);
      }
      const glow = makeGlow(0x6aff9a, 2.4, 0);
      glow.position.set(cx, y + 1.1, cz);
      this.root.add(drum, glow);
      this.centri = { drum, slots, glow, speed: 0 };

      // Pantalla del laboratorio, colgada del techo sobre la centrifugadora (mira hacia el punto de uso)
      const sp = this.E.centrifuge;
      const face = Math.atan2((sp.x + 0.5) - cx, (sp.z + 0.5) - cz);
      const scr = canvasTex(512, 288);
      this.screen = scr;
      this.screenKey = '';
      const smat = track(new THREE.MeshBasicMaterial({ map: scr.t, toneMapped: false }));
      const mon = new THREE.Group();
      mon.position.set(cx, y + 2.55, cz);
      mon.rotation.y = face;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.95, 1.15, 0.08), world.mats.get('c_iron'));
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.0125), smat);
      panel.position.z = 0.045;
      const top = MAP.levels[cp.lv || 0].h;
      const rodLen = Math.max(0.2, top - 3.1);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, rodLen, 6), world.mats.get('c_iron'));
      rod.position.y = 0.575 + rodLen / 2;
      mon.add(frame, panel, rod);
      this.root.add(mon);
      this._drawScreen(null);
    }
  }

  sync(gs) { this._drawScreen(gs && gs.ee); }

  onEvent(name, e) {
    if (name === 'eeBrazier' && e) {
      const b = this.braziers[e.i];
      const p = this.E.braziers[e.i];
      if (b) sfx(this.ctx, e.ok ? 'power_on' : 'deny', p.x + 0.5, MAP.baseY(p.lv || 0) + 1, p.z + 0.5);
    }
  }

  // Pantalla: estado del experimento y, tras el centrifugado, el orden de los braseros
  _drawScreen(ee) {
    if (!this.screen) return;
    const P = this.world.lighting ? this.world.lighting.powered : false;
    const step = ee ? ee.step : 0;
    const pct = ee ? Math.floor(((ee.centri || 0) / 90) * 100) : 0;
    const key = [P ? 1 : 0, step, ee ? (ee.got || []).length : 0, pct, ee ? (ee.lit || []).join('') : '', ee ? !!ee.fang : 0].join('|');
    if (key === this.screenKey) return;
    this.screenKey = key;
    const { g, t } = this.screen;
    const W = 512, H = 288;
    g.fillStyle = '#031208'; g.fillRect(0, 0, W, H);
    if (!P) {
      g.fillStyle = '#300'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#ff3a2a'; g.font = 'bold 30px monospace'; g.textAlign = 'center';
      g.fillText('SIN ENERGÍA', W / 2, H / 2);
      t.needsUpdate = true;
      return;
    }
    // líneas de barrido
    g.fillStyle = 'rgba(80,255,140,0.05)';
    for (let yy = 0; yy < H; yy += 4) g.fillRect(0, yy, W, 1);
    g.textAlign = 'left';
    g.fillStyle = '#6aff9a'; g.font = 'bold 22px monospace';
    g.fillText('VORKHAUS BIOLAB · CENTRÍFUGA', 18, 34);
    g.fillRect(18, 44, W - 36, 2);
    g.font = '18px monospace';
    if (step < 5) {
      const got = ee ? (ee.got || []).length : 0;
      const lines = [
        `MUESTRAS DE SANGRE ... ${Math.min(3, got)}/3`,
        `COLMILLO DEL CONDE ... ${step >= 4 || (step === 3 && !ee.fang) ? 'OK' : '---'}`,
        `SEPARACIÓN ......... ${step >= 4 ? pct + '%' : 'EN ESPERA'}`,
      ];
      lines.forEach((l, i) => g.fillText(l, 22, 86 + i * 34));
      if (step === 4) {
        g.strokeStyle = '#6aff9a'; g.lineWidth = 2; g.strokeRect(22, 200, W - 44, 26);
        g.fillRect(25, 203, (W - 50) * Math.min(1, pct / 100), 20);
      } else {
        g.fillStyle = '#3a8a5a';
        g.fillText(step <= 1 ? '> Faltan muestras...' : step === 2 ? '> El donante sigue con vida...' : '> Cargue la muestra', 22, 222);
      }
    } else {
      g.fillText('SECUENCIA DE IGNICIÓN:', 22, 80);
      const order = ee.order || [0, 1, 2, 3];
      const lit = ee.lit || [];
      order.forEach((bi, k) => {
        const b = this.braziers[bi];
        const kind = b ? b.kind : bi;
        const em = EMBLEMS[kind] || EMBLEMS[0];
        const cx = 80 + k * 118, cy = 170;
        const done = step >= 6 || k < lit.length;
        g.strokeStyle = done ? em.css : '#2a6a4a'; g.lineWidth = 3;
        g.strokeRect(cx - 48, cy - 56, 96, 112);
        drawEmblem(g, kind, cx, cy - 6, 34, done ? em.css : '#9affb8');
        g.fillStyle = '#6aff9a'; g.textAlign = 'center'; g.font = 'bold 20px monospace';
        g.fillText(String(k + 1), cx, cy + 46);
        g.textAlign = 'left'; g.font = '18px monospace';
      });
      if (step >= 6) { g.fillStyle = '#ffd23f'; g.fillText('> SALÓN DE BAILE: ABIERTO', 22, 270); }
    }
    t.needsUpdate = true;
  }

  update(dt, t, gs) {
    this.t += dt;
    const ee = gs && gs.ee;
    const step = ee ? ee.step : 0;
    // viales
    for (let i = 0; i < this.vials.length; i++) {
      const v = this.vials[i];
      const on = !!ee && step === 1 && ee.vials.includes(i) && !ee.got.includes(i);
      v.g.visible = on;
      if (!on) continue;
      v.inner.position.y = 0.95 + Math.sin(t * 2 + v.ph) * 0.06;
      v.inner.rotation.y = t * 1.2 + v.ph;
      v.glow.material.opacity = 0.4 + 0.2 * Math.sin(t * 3 + v.ph);
    }
    // colmillo
    const f = ee && ee.fang;
    this.fang.visible = !!f;
    if (f) {
      this.fang.position.set(f.x, f.y, f.z);
      this.fangInner.position.y = 0.8 + Math.sin(t * 2.4) * 0.08;
      this.fangInner.rotation.y = t * 1.6;
      this.fangGlow.material.opacity = 0.45 + 0.2 * Math.sin(t * 4);
    }
    // braseros
    for (const b of this.braziers) {
      const lit = !!ee && (step >= 6 || (ee.lit || []).includes(b.i));
      b.fl.visible = lit;
      if (lit) b.flames.update(t);
      b.mat.emissiveIntensity = lit ? 0.9 + 0.2 * flickerNoise(t * 2, b.i) : 0.3;
    }
    // centrifugadora
    if (this.centri) {
      const c = this.centri;
      const loaded = step >= 4;
      for (const s of c.slots) s.visible = loaded;
      const target = step === 4 ? 14 : 0;
      c.speed += (target - c.speed) * Math.min(1, dt * 0.8);
      c.drum.rotation.y += c.speed * dt;
      c.glow.material.opacity = step === 4 ? 0.35 + 0.15 * Math.sin(t * 9) : (step >= 5 ? 0.2 : 0);
      if (step === 4) this._drawScreen(ee);
    }
    if (this.screen && this.world.lighting && (this.world.lighting.powered ? 1 : 0) !== +this.screenKey[0]) this._drawScreen(ee);
  }
}
