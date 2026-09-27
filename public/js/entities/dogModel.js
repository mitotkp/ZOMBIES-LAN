// Modelo procedural del perro infernal (rondas de perros): cuadrúpedo esquelético de piel quemada con grietas
// de lava que brillan, ojos encendidos, galope, mordisco, reacción a impactos y muerte (cae de lado y se hunde).
// Misma interfaz que ZombieModel para que EntityManager lo trate igual. El frente del perro mira a -Z.

import * as THREE from 'three';
import { ZA } from '/shared/protocol.js';
import {
  TAU, rng, makeCanvas, canvasTexture, blotches, paintGeo, deform, mergeGeos, makeMat, capsule, glowTexture,
  smoothstep, clamp01, fbm, normalTexture, tileFbm,
} from './procgen.js';

const HIP_Y = 0.5;                 // altura del lomo en reposo
const LEG_UP = 0.24, LEG_LO = 0.22; // segmentos de las patas
const LEGS = [                      // [x, z, delantera]
  [-0.1, -0.29, true], [0.1, -0.29, true], [-0.1, 0.3, false], [0.1, 0.3, false],
];
// fase de cada pata en el galope (rotatorio: delanteras juntas, traseras juntas, algo desfasadas)
const GALLOP = [0, 0.18, 0.55, 0.68];
const TROT = [0, 0.5, 0.5, 0];

// --------------------------------------------------------------------------------------------
// Recursos compartidos
// --------------------------------------------------------------------------------------------
let ASSETS = null;

function paintHide(seed) {
  const W = 256, c = makeCanvas(W, W);
  if (!c) return null;
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = '#2b211d';
  g.fillRect(0, 0, W, W);
  blotches(g, W, W, r, '#120d0b', 90, 4, 26, 0.2, 0.5);   // quemaduras
  blotches(g, W, W, r, '#4a2a1c', 50, 3, 16, 0.1, 0.3);   // carne viva
  blotches(g, W, W, r, '#6b6258', 25, 2, 8, 0.05, 0.2);   // ceniza
  return c;
}

// Grietas de lava: el mismo trazado sirve de mapa emisivo
function paintCracks(seed) {
  const W = 256, c = makeCanvas(W, W);
  if (!c) return null;
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, W);
  g.lineCap = 'round';
  for (let i = 0; i < 60; i++) {
    let x = r() * W, y = r() * W;
    g.strokeStyle = r() < 0.6 ? '#c43a08' : '#ff8a28';
    g.lineWidth = 0.6 + r() * 1.3;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 18; y += (r() - 0.5) * 18; g.lineTo(x, y); }
    g.stroke();
  }
  return c;
}

function torsoGeo() {
  // tronco a lo largo de Z (esfera estirada: extremos redondeados). Pecho hondo, cintura hundida,
  // grupa algo más alta y costillas y columna marcadas
  const g = new THREE.SphereGeometry(1, 22, 18);
  deform(g, (v) => {
    const t = (v.z + 1) / 2;                    // 0 = pecho (delante, -Z), 1 = grupa
    const waist = Math.exp(-((t - 0.62) ** 2) / 0.02);
    const w = 0.13 * (1 - 0.38 * waist) * (t > 0.8 ? 1.08 : 1);
    const depthDown = 0.2 * (1 - 0.55 * smoothstep(0.3, 0.68, t)) * (1 - 0.25 * smoothstep(0.8, 1, t));
    const up = 0.1 + 0.02 * smoothstep(0.7, 0.95, t);
    let y = v.y > 0 ? v.y * up : v.y * depthDown;
    const ribs = v.y < 0 && t > 0.18 && t < 0.52 ? 0.012 * Math.max(0, Math.sin(t * 75)) : 0;
    if (v.y > 0.85) y += 0.012 * Math.max(0, Math.sin(t * 95));   // vértebras
    v.set(v.x * (w - ribs), y, (t - 0.5) * 0.86);
  });
  return g;
}

function headGeo() {
  const skull = new THREE.SphereGeometry(1, 16, 12);
  deform(skull, (v) => {
    const brow = v.z < -0.3 && v.y > 0.2 ? 0.1 : 0;
    v.set(v.x * 0.1, v.y * 0.085 + brow * 0.02, v.z * 0.1);
  });
  // hocico alargado (hacia -Z) y algo caído
  const snout = new THREE.CylinderGeometry(0.035, 0.07, 0.19, 12, 3);
  snout.rotateX(-Math.PI / 2 + 0.12);
  snout.scale(1, 0.8, 1);
  snout.translate(0, -0.03, -0.14);
  const nose = new THREE.SphereGeometry(0.03, 8, 6);
  nose.translate(0, -0.012, -0.235);
  paintGeo(nose, (x, y, z, c) => c.setRGB(0.05, 0.03, 0.03));
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.035, 0.11, 6);
    ear.rotateZ(-s * 0.35); ear.rotateX(0.35);
    ear.translate(s * 0.06, 0.1, 0.03);
    ears.push(ear);
  }
  // colmillos superiores
  const teeth = [];
  for (const s of [-1, 1]) for (const k of [0, 1]) {
    const t = new THREE.ConeGeometry(0.009, 0.045 - k * 0.015, 5);
    t.rotateX(Math.PI);
    t.translate(s * (0.03 - k * 0.012), -0.075, -0.2 + k * 0.05);
    paintGeo(t, (x, y, z, c) => c.setRGB(0.85, 0.8, 0.62));
    teeth.push(t);
  }
  for (const gg of [skull, snout, ...ears]) paintGeo(gg, (x, y, z, c) => c.setRGB(1, 1, 1));
  return mergeGeos([skull, snout, nose, ...ears, ...teeth]);
}

function jawGeo() {
  const j = new THREE.CylinderGeometry(0.03, 0.05, 0.17, 10, 2);
  j.rotateX(-Math.PI / 2);
  j.scale(1, 0.5, 1);
  j.translate(0, 0, -0.085);
  paintGeo(j, (x, y, z, c) => c.setRGB(1, 1, 1));
  const teeth = [];
  for (const s of [-1, 1]) {
    const t = new THREE.ConeGeometry(0.008, 0.035, 5);
    t.translate(s * 0.022, 0.025, -0.15);
    paintGeo(t, (x, y, z, c) => c.setRGB(0.85, 0.8, 0.62));
    teeth.push(t);
  }
  return mergeGeos([j, ...teeth]);
}

function legGeo(len, r0, r1) {
  const g = new THREE.CylinderGeometry(r0, r1, len, 9, 3);
  g.translate(0, -len / 2, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.35);
  paintGeo(g, (x, y, z, c) => c.setRGB(1, 1, 1));
  return g;
}

function pawGeo() {
  const p = new THREE.SphereGeometry(1, 10, 7);
  p.scale(0.034, 0.022, 0.05);
  p.translate(0, -0.01, -0.02);
  // garras
  const claws = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.ConeGeometry(0.006, 0.025, 4);
    c.rotateX(-Math.PI / 2 - 0.4);
    c.translate(-0.016 + i * 0.016, -0.02, -0.066);
    paintGeo(c, (x, y, z, col) => col.setRGB(0.1, 0.08, 0.07));
    claws.push(c);
  }
  paintGeo(p, (x, y, z, c) => c.setRGB(0.85, 0.85, 0.85));
  return mergeGeos([p, ...claws]);
}

function tailGeo() {
  const g = new THREE.CylinderGeometry(0.012, 0.028, 0.32, 7, 4);
  g.translate(0, -0.16, 0);
  deform(g, (v) => { v.z += 0.04 * Math.sin((-v.y / 0.32) * Math.PI); });
  paintGeo(g, (x, y, z, c) => c.setRGB(1, 1, 1));
  return g;
}

export function getDogAssets(quality = 'high') {
  if (ASSETS) return ASSETS;
  const q = quality === 'low' ? 'low' : 'high';
  const hide = canvasTexture(paintHide(71));
  const cracks = canvasTexture(paintCracks(93));
  for (const t of [hide, cracks]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const params = { map: hide, vertexColors: true, roughness: 0.8, emissive: 0xffffff, emissiveMap: cracks, emissiveIntensity: 1.4 };
  if (q === 'high') {
    params.normalMap = normalTexture(128, (u, v) => {
      const n = tileFbm(u, v, 5, 17, 3);
      return 0.6 * n + 0.4 * (1 - Math.abs(2 * tileFbm(u, v, 9, 29, 2) - 1));
    }, 2.2, 2);
  }
  ASSETS = {
    q,
    mat: makeMat(q, params),
    eyes: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.35, 0.05), toneMapped: false }),
    glow: new THREE.SpriteMaterial({ map: glowTexture(64, 2.2), color: 0xff5a14, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
    torso: torsoGeo(), head: headGeo(), jaw: jawGeo(),
    legUp: legGeo(LEG_UP, 0.045, 0.03), legLo: legGeo(LEG_LO, 0.028, 0.02), paw: pawGeo(), tail: tailGeo(),
    haunch: (() => { const s = new THREE.SphereGeometry(0.085, 10, 8); s.scale(0.8, 1.35, 1.15); s.translate(0, -0.05, 0); paintGeo(s, (x, y, z, c) => c.setRGB(1, 1, 1)); return s; })(),
    shoulder: (() => { const s = new THREE.SphereGeometry(0.075, 10, 8); s.scale(0.9, 1.3, 1.1); paintGeo(s, (x, y, z, c) => c.setRGB(1, 1, 1)); return s; })(),
    neck: (() => { const n = new THREE.CylinderGeometry(0.05, 0.075, 0.2, 10, 2); n.translate(0, 0.1, 0); paintGeo(n, (x, y, z, c) => c.setRGB(1, 1, 1)); return n; })(),
    eyeGeo: (() => {
      const a = new THREE.SphereGeometry(0.0095, 8, 6), b = a.clone();
      a.translate(-0.045, 0.018, -0.085); b.translate(0.045, 0.018, -0.085);
      return mergeGeos([a, b]);
    })(),
  };
  return ASSETS;
}

export function dogMaterials(quality) {
  const A = getDogAssets(quality);
  return [A.mat, A.eyes];
}

// --------------------------------------------------------------------------------------------
// DogModel
// --------------------------------------------------------------------------------------------
export class DogModel {
  constructor(opts = {}) {
    const A = getDogAssets(opts.quality);
    this.A = A;
    const r = rng((opts.seed >>> 0) || 1);
    const shadows = A.q !== 'low';
    this.meshes = [];
    const mesh = (geo, mat, parent, cast = false) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast && shadows;
      m.userData.cast = m.castShadow;
      parent.add(m);
      this.meshes.push(m);
      return m;
    };
    this.type = 'dog';
    this.group = new THREE.Group();
    this.group.name = 'dog';
    const s = 0.95 + r() * 0.12;
    this.group.scale.setScalar(s);
    this.body = new THREE.Group();                 // pivote en el centro del lomo
    this.body.position.y = HIP_Y;
    this.group.add(this.body);
    mesh(A.torso, A.mat, this.body, true);
    for (const x of [-0.085, 0.085]) { const sh = mesh(A.shoulder, A.mat, this.body); sh.position.set(x, -0.02, -0.26); }

    // cuello y cabeza (cuelga hacia delante)
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.06, -0.33);
    this.neck.rotation.x = -0.9;
    this.body.add(this.neck);
    mesh(A.neck, A.mat, this.neck, true);
    this.head = new THREE.Group();
    this.head.position.set(0, 0.2, 0);
    this.neck.add(this.head);
    this.headMesh = mesh(A.head, A.mat, this.head, true);
    this.head.rotation.x = 0.95;                 // mira al frente
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.05, -0.04);
    this.head.add(this.jaw);
    mesh(A.jaw, A.mat, this.jaw);
    this.eyes = mesh(A.eyeGeo, A.eyes, this.head);
    this.headPt = new THREE.Object3D();
    this.headPt.position.set(0, 0, -0.08);
    this.head.add(this.headPt);
    this.glow = new THREE.Sprite(A.glow);
    this.glow.scale.setScalar(1.3);
    this.glow.position.y = 0.05;
    this.body.add(this.glow);

    // patas: cadera/hombro → rodilla → pata
    this.legs = LEGS.map(([x, z, front], i) => {
      const hip = new THREE.Group();
      hip.position.set(x, -0.05, z);
      this.body.add(hip);
      mesh(A.legUp, A.mat, hip, true);
      if (!front) mesh(A.haunch, A.mat, hip);
      const knee = new THREE.Group();
      knee.position.y = -LEG_UP;
      hip.add(knee);
      mesh(A.legLo, A.mat, knee);
      const foot = new THREE.Group();
      foot.position.y = -LEG_LO;
      knee.add(foot);
      mesh(A.paw, A.mat, foot);
      return { hip, knee, foot, front, i };
    });
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.07, 0.38);
    this.body.add(this.tail);
    mesh(A.tail, A.mat, this.tail);

    this.phase = r() * TAU;
    this.time = r() * 10;
    this.gaitBlend = 0;           // 0 = quieto, 1 = galope
    this.attackT = -1;
    this.jawBoost = 0;
    this.flinch = 0; this.flinchX = 0;
    this.stepped = false;
    this.crawler = false;
    this.becameCrawler = false;
    this.death = null;
    this._fadeMats = null;
    this._shadowOn = true;
  }

  setShadowLOD(on) {
    if (this._shadowOn === on) return;
    this._shadowOn = on;
    for (const m of this.meshes) if (m.userData.cast) m.castShadow = on;
  }

  update(dt, st = {}) {
    if (this.death) return;
    this.time += dt;
    const anim = st.anim | 0;
    const speed = Math.max(0, Number(st.speed) || 0);
    const moving = anim === ZA.RUN || anim === ZA.SPRINT || anim === ZA.WALK || speed > 0.5;
    this.gaitBlend += ((moving ? 1 : 0) - this.gaitBlend) * (1 - Math.exp(-6 * dt));
    if (anim === ZA.ATTACK && this.attackT < 0) this.onAttack();
    this.group.position.y = st.yOff || 0;

    // ciclo de galope: la zancada crece con la velocidad
    const gallop = speed > 3.2;
    const freq = gallop ? 2.6 + speed * 0.12 : 1.4 + speed * 0.35;
    const prevPh = this.phase;
    this.phase += dt * freq * TAU * Math.max(0.25, this.gaitBlend);
    if (Math.floor(prevPh / Math.PI) !== Math.floor(this.phase / Math.PI) && this.gaitBlend > 0.3) this.stepped = true;
    const ph = this.phase, gb = this.gaitBlend;
    const offs = gallop ? GALLOP : TROT;
    const amp = (gallop ? 0.75 : 0.45) * gb;
    for (const L of this.legs) {
      const p = ph + offs[L.i] * TAU;
      const sw = Math.sin(p);
      // delanteras: rodilla hacia atrás al recoger; traseras (corvejón): al revés
      L.hip.rotation.x = sw * amp + (L.front ? 0.05 : -0.1);
      const lift = Math.max(0, Math.cos(p)) * gb;
      L.knee.rotation.x = L.front ? -(0.1 + lift * 0.9) : 0.35 + lift * 0.8;
      L.foot.rotation.x = -(L.hip.rotation.x + L.knee.rotation.x);   // la pata apoya plana
    }
    // lomo: sube y baja y cabecea con el galope; respiración en reposo
    const bob = gallop ? Math.abs(Math.sin(ph)) * 0.06 : Math.abs(Math.sin(ph * 2)) * 0.02;
    const breath = Math.sin(this.time * 5.5) * 0.008 * (1 - gb);
    this.body.position.y = HIP_Y + bob * gb + breath - 0.04 * gb;
    this.body.rotation.x = (gallop ? Math.sin(ph + 0.8) * 0.12 : 0) * gb + 0.05 * gb;
    // cabeza: baja y adelantada al correr, olfatea en reposo
    const sniff = (1 - gb) * Math.sin(this.time * 0.9) * 0.25;
    this.neck.rotation.x = -0.9 - 0.35 * gb + Math.sin(ph * 2) * 0.05 * gb;
    this.neck.rotation.y = sniff;
    this.tail.rotation.x = 0.9 - 0.5 * gb + Math.sin(this.time * 7) * 0.08;
    this.tail.rotation.z = Math.sin(this.time * (gb > 0.5 ? 12 : 4)) * 0.25;

    // mordisco: embestida corta con la mandíbula abierta
    let jaw = 0.12 + 0.1 * Math.max(0, Math.sin(this.time * 3)) + this.jawBoost * 0.5;
    this.jawBoost = Math.max(0, this.jawBoost - dt * 2.5);
    if (this.attackT >= 0) {
      this.attackT += dt;
      const k = this.attackT / 0.5;
      const lunge = Math.sin(clamp01(k) * Math.PI);
      this.body.position.z = -0.25 * lunge;
      this.body.rotation.x -= 0.25 * lunge;
      this.neck.rotation.x -= 0.4 * lunge;
      jaw = k < 0.55 ? 0.75 * smoothstep(0, 0.4, k) : 0.75 * (1 - smoothstep(0.55, 0.7, k));
      if (k >= 1) { this.attackT = -1; this.body.position.z = 0; }
    }
    this.jaw.rotation.x = jaw;
    // reacción a impactos (resorte simple)
    this.flinch += (0 - this.flinch) * (1 - Math.exp(-9 * dt));
    this.body.rotation.z = this.flinch * this.flinchX;
    this.body.rotation.x += this.flinch * 0.2;
    const flick = 0.85 + 0.3 * fbm(this.time * 3, 1.7, 5, 2);
    this.A.mat.emissiveIntensity = 1.1 + 0.5 * flick;   // compartido: todos laten a la vez, como brasas
    this.glow.material.opacity = 0.28 + 0.12 * flick;
  }

  hitReact(part, dirX = 0, dirZ = 0, strength = 1) {
    this.flinch = Math.min(1, this.flinch + 0.6 * strength);
    this.flinchX = Math.sign(dirX || (Math.random() - 0.5)) * 0.35;
  }

  onAttack() { this.attackT = 0; this.jawBoost = 1; }
  groan() { this.jawBoost = 1; }
  onFire() { /* ya arde */ }
  onAbility() { /* sin habilidades */ }

  getHeadWorld(out) { return this.headPt.getWorldPosition(out); }
  getNeckWorld(out) { this.neck.updateWorldMatrix(true, false); return out.setFromMatrixPosition(this.neck.matrixWorld); }
  getChestWorld(out) { this.body.updateWorldMatrix(true, false); return out.set(0, 0, -0.15).applyMatrix4(this.body.matrixWorld); }

  // ------------------------------------------------------------------ muerte: cae de lado, pataleo y se hunde
  startDeath(fx, pushX = 0, pushZ = 0) {
    if (this.death) return;
    const len = Math.hypot(pushX, pushZ) || 1;
    // hacia qué lado cae (según el empuje, en el espacio del perro)
    const yaw = this.group.rotation.y;
    const lx = (pushX * Math.cos(yaw) - pushZ * Math.sin(yaw)) / len;
    this.death = {
      t: 0, sinkAt: 7, side: lx >= 0 ? 1 : -1,
      vx: (pushX / len) * (fx === 'explode' ? 4 : 1.2), vz: (pushZ / len) * (fx === 'explode' ? 4 : 1.2),
      burn: fx === 'fire' || fx === 'explode',
    };
    this.eyes.visible = false;
    this.glow.visible = false;
  }

  updateDeath(dt) {
    const D = this.death;
    if (!D) return true;
    D.t += dt;
    const k = smoothstep(0, 0.45, D.t);
    this.body.rotation.z = D.side * 1.45 * k;
    this.body.position.y = HIP_Y - 0.3 * k;
    // se desliza con el empujón y frena
    const slide = Math.max(0, 1 - D.t * 2.5);
    this.group.position.x += D.vx * dt * slide;
    this.group.position.z += D.vz * dt * slide;
    // pataleo que se apaga
    const kick = Math.max(0, 1 - D.t / 2.2);
    for (const L of this.legs) {
      L.hip.rotation.x = Math.sin(D.t * 14 + L.i * 1.7) * 0.5 * kick + (L.front ? -0.4 : 0.4) * k;
      L.knee.rotation.x = (L.front ? -0.5 : 0.6) * k;
    }
    this.neck.rotation.x = -0.9 + 0.5 * k;
    this.jaw.rotation.x = 0.5 * k;
    this.tail.rotation.x = 0.4;
    if (D.burn) this.A.mat.emissiveIntensity = 1.5;
    if (D.t > D.sinkAt) this.group.position.y -= dt * 0.25;
    return D.t < D.sinkAt + 2.5;
  }

  // ------------------------------------------------------------------ desvanecer / limpiar
  startFade() {
    if (this._fadeMats) return;
    this._fadeMats = new Map();
    this.fadeT = 0;
    this.group.traverse((o) => {
      if (!o.material) return;
      let clone = this._fadeMats.get(o.material);
      if (!clone) {
        clone = o.material.clone();
        clone.transparent = true;
        clone.userData.baseOpacity = o.material.opacity;
        clone.userData.orig = o.material;
        this._fadeMats.set(o.material, clone);
      }
      o.material = clone;
    });
  }

  cancelFade() {
    if (!this._fadeMats) return;
    this.group.traverse((o) => { if (o.material && o.material.userData && o.material.userData.orig) o.material = o.material.userData.orig; });
    for (const m of this._fadeMats.values()) m.dispose();
    this._fadeMats = null;
  }

  updateFade(dt) {
    if (!this._fadeMats) return false;
    this.fadeT += dt;
    const a = Math.max(0, 1 - this.fadeT / 0.6);
    for (const m of this._fadeMats.values()) m.opacity = (m.userData.baseOpacity ?? 1) * a;
    return a > 0;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this._fadeMats) { for (const m of this._fadeMats.values()) m.dispose(); this._fadeMats = null; }
  }
}

export default DogModel;
