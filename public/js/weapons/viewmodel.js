// Arma y brazos en primera persona (se dibujan en una escena aparte, encima del mundo).
// El WeaponSystem decide QUÉ pasa (disparo, recarga, cambio...) y esta clase se encarga de CÓMO se ve:
// respiración, balanceo al caminar, inercia al mirar, correr, apuntar, retroceso, recargas por tipo,
// cambio de arma, cuchillo, granada, escudo, beber ventajas y última batalla.
import * as THREE from 'three';
import {
  createWeaponMesh, createShieldMesh, createKnifeMesh, createMeleeMesh, createGrenadeMesh, createBottleMesh,
  getFlashTexture, getArmMaterials,
} from './models.js';

// Duraciones (segundos) compartidas con WeaponSystem
export const SWITCH_HALF = 0.2;      // bajar el arma / subirla
export const KNIFE_DUR = 0.42;
export const KNIFE_HIT = 0.12;
export const THROW_DUR = 0.62;
export const THROW_RELEASE = 0.38;
export const BASH_DUR = 0.36;
export const BASH_HIT = 0.12;
export const SHIELD_TOGGLE = 0.3;
export const DRINK_DUR = 1.6;

const PI = Math.PI;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);
const seg = (p, a, b) => smooth(clamp01((p - a) / (b - a)));
const bump = (p, a, b, c, d) => seg(p, a, b) * (1 - seg(p, c, d));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// Posición del arma desde la cadera (espacio de cámara) por arquetipo de modelo
const HIP = {
  pistol: [0.125, -0.13, -0.3], revolver: [0.125, -0.135, -0.3], raygun: [0.125, -0.135, -0.3],
  smg: [0.13, -0.155, -0.27], rifle: [0.14, -0.165, -0.25], raygun2: [0.13, -0.155, -0.27],
  lmg: [0.15, -0.185, -0.24], shotgun: [0.14, -0.165, -0.25], doublebarrel: [0.14, -0.165, -0.25],
  sniper: [0.145, -0.175, -0.23], launcher: [0.15, -0.19, -0.25], knife: [0.15, -0.2, -0.3],
};
const ONE_HANDED = new Set(['pistol', 'revolver', 'raygun']);
const RIGHT_ELBOW = V(0.3, -0.42, 0.08);
const LEFT_ELBOW_LONG = V(-0.17, -0.47, -0.05);
const LEFT_ELBOW_SHORT = V(-0.11, -0.45, 0.05);

// Animaciones por fotogramas clave: [{ t, p:[x,y,z], r:[x,y,z] }]
function sampleKeys(keys, u, outP, outR) {
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const f = smooth(clamp01((u - a.t) / (b.t - a.t || 1)));
  outP.set(a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f, a.p[2] + (b.p[2] - a.p[2]) * f);
  outR.set(a.r[0] + (b.r[0] - a.r[0]) * f, a.r[1] + (b.r[1] - a.r[1]) * f, a.r[2] + (b.r[2] - a.r[2]) * f);
}

// Tajo de cuchillo de derecha a izquierda
const KNIFE_KEYS = [
  { t: 0.0, p: [0.3, -0.32, -0.3], r: [0.2, 0.9, -1.2] },
  { t: 0.2, p: [0.25, -0.02, -0.34], r: [0.3, 0.95, -0.7] },
  { t: 0.4, p: [-0.03, -0.1, -0.5], r: [-0.1, -0.05, 0.3] },
  { t: 0.62, p: [-0.22, -0.28, -0.42], r: [-0.3, -0.6, 0.9] },
  { t: 1.0, p: [0.05, -0.55, -0.32], r: [-0.2, -0.2, 0.4] },
];
// Golpe amplio para armas pesadas (bate, machete, hacha): se alza sobre el hombro derecho y cruza en diagonal
const SWING_KEYS = [
  { t: 0.0, p: [0.3, -0.35, -0.25], r: [0.6, -0.2, -0.3] },
  { t: 0.28, p: [0.3, -0.02, -0.18], r: [1.45, -0.35, -0.5] },
  { t: 0.5, p: [0.02, -0.14, -0.42], r: [0.15, 0.85, -1.25] },
  { t: 0.72, p: [-0.24, -0.32, -0.38], r: [-0.55, 1.25, -0.9] },
  { t: 1.0, p: [0.12, -0.62, -0.3], r: [-0.3, 0.3, 0.0] },
];
// Lanzar granada: sube, quita la anilla, echa el brazo atrás y lanza
const THROW_KEYS = [
  { t: 0.0, p: [0.22, -0.42, -0.3], r: [0, 0, 0] },
  { t: 0.22, p: [0.15, -0.15, -0.32], r: [0.2, 0, 0.2] },
  { t: 0.45, p: [0.25, 0.03, -0.17], r: [0.6, 0.2, 0.3] },
  { t: 0.61, p: [0.05, -0.02, -0.62], r: [-0.4, 0, -0.1] },
  { t: 0.8, p: [-0.03, -0.26, -0.55], r: [-0.8, 0, -0.2] },
  { t: 1.0, p: [0.1, -0.56, -0.36], r: [-0.4, 0, 0] },
];
// Beber: sube la botella, la inclina hacia la boca y la baja
const DRINK_KEYS = [
  { t: 0.0, p: [0.18, -0.46, -0.35], r: [0, 0, 0.1] },
  { t: 0.18, p: [0.09, -0.15, -0.32], r: [0.15, 0, 0.12] },
  { t: 0.32, p: [0.03, -0.075, -0.2], r: [0.95, 0, 0.05] },
  { t: 0.76, p: [0.02, -0.035, -0.15], r: [1.4, 0, 0] },
  { t: 0.88, p: [0.12, -0.2, -0.3], r: [0.4, 0, 0.2] },
  { t: 1.0, p: [0.2, -0.52, -0.35], r: [0, 0, 0.1] },
];

// Construye un brazo: el grupo se coloca en la mano y su +Z apunta al codo
function buildArm(mats, left) {
  const root = new THREE.Group();
  const s = left ? -1 : 1;
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    root.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(0.064, 0.07, 0.085), mats.glove, 0, -0.004, 0.018);
  add(new THREE.BoxGeometry(0.066, 0.026, 0.032), mats.glove, 0, 0.014, -0.03);
  add(new THREE.BoxGeometry(0.066, 0.012, 0.03), mats.gloveDetail, 0, 0.03, -0.012);
  add(new THREE.BoxGeometry(0.02, 0.02, 0.052), mats.glove, -s * 0.036, 0.02, -0.004, 0, s * 0.4, 0);
  const wrist = new THREE.CylinderGeometry(0.03, 0.033, 0.07, 10);
  wrist.rotateX(-PI / 2);
  add(wrist, mats.glove, 0, 0, 0.085);
  const cuff = new THREE.CylinderGeometry(0.05, 0.05, 0.025, 12);
  cuff.rotateX(-PI / 2);
  add(cuff, mats.sleeveDark, 0, 0, 0.12);
  // manga que se estira hasta el codo (0..1 en Z, escalada cada frame)
  const sg = new THREE.CylinderGeometry(0.046, 0.056, 1, 12, 1, true);
  sg.rotateX(-PI / 2);
  sg.translate(0, 0, 0.5);
  const sleeve = add(sg, mats.sleeve, 0, 0, 0.11);
  root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  return { root, sleeve };
}

export class ViewModel {
  constructor(ctx, scene, camera) {
    this.ctx = ctx;
    this.scene = scene;
    this.camera = camera;

    // Luces propias de la escena del arma
    this.hemi = new THREE.HemisphereLight(0xc6d4f0, 0x2e2822, 1.2);
    scene.add(this.hemi);
    this.keyLight = new THREE.DirectionalLight(0xffe8cc, 1.7);
    this.keyLight.position.set(-0.5, 1, 0.8);
    scene.add(this.keyLight);
    this.rimLight = new THREE.DirectionalLight(0x8fb0ff, 0.6);
    this.rimLight.position.set(0.8, 0.2, -1);
    scene.add(this.rimLight);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 1.6, 2);
    scene.add(this.flashLight);

    // Jerarquía: root > sway > pose > kick > anim > holder(arma)
    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    scene.add(this.root);
    this.sway = new THREE.Group();
    this.root.add(this.sway);
    this.pose = new THREE.Group();
    this.sway.add(this.pose);
    this.kick = new THREE.Group();
    this.pose.add(this.kick);
    this.anim = new THREE.Group();
    this.kick.add(this.anim);
    this.holder = new THREE.Group();
    this.anim.add(this.holder);

    // Brazos
    const mats = getArmMaterials();
    this.armR = buildArm(mats, false);
    this.armL = buildArm(mats, true);
    this.sway.add(this.armR.root, this.armL.root);

    // Accesorios de las acciones
    this.knifeHolder = new THREE.Group();
    this.knifeCombat = createKnifeMesh(false);
    this.knifeBowie = createKnifeMesh(true);
    this.knifeHolder.add(this.knifeCombat, this.knifeBowie);
    this.meleeMeshes = { knife: this.knifeCombat, bowie: this.knifeBowie };
    for (const k of ['bat', 'machete', 'axe']) {
      const m = createMeleeMesh(k);
      m.visible = false;
      m.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      this.meleeMeshes[k] = m;
      this.knifeHolder.add(m);
    }
    this.knifeHolder.visible = false;
    this.sway.add(this.knifeHolder);

    this.throwHolder = new THREE.Group();
    this.grenade = createGrenadeMesh();
    this.grenade.position.set(0, 0.01, -0.035);
    this.throwHolder.add(this.grenade);
    this.throwHolder.visible = false;
    this.sway.add(this.throwHolder);

    this.bottleHolder = new THREE.Group();
    this.bottleHolder.visible = false;
    this.sway.add(this.bottleHolder);
    this.bottles = new Map();

    this.shieldHolder = new THREE.Group();
    this.shield = createShieldMesh();
    this.shieldHolder.add(this.shield);
    this.shieldHolder.visible = false;
    this.sway.add(this.shieldHolder);

    // Cartucho de escopeta en la mano izquierda durante la recarga
    this.shellProp = new THREE.Group();
    const shellBody = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.05, 10),
      new THREE.MeshStandardMaterial({ color: 0xa3221c, roughness: 0.6, metalness: 0.1 }));
    const shellBase = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.014, 10),
      new THREE.MeshStandardMaterial({ color: 0xc9a042, roughness: 0.3, metalness: 0.9 }));
    shellBase.position.y = -0.03;
    this.shellProp.add(shellBody, shellBase);
    this.shellProp.rotation.x = PI / 2;
    this.shellProp.visible = false;
    this.sway.add(this.shellProp);

    // Fogonazo
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getFlashTexture(), color: 0xffffff, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, toneMapped: false,
    }));
    this.flash.visible = false;
    this.flash.renderOrder = 10;

    this.root.traverse((o) => { if (o.isMesh || o.isSprite) o.frustumCulled = false; });

    this.cache = new Map();
    this._tmpP = V(0, 0, 0);
    this._tmpR = V(0, 0, 0);
    this._v1 = V(0, 0, 0);
    this._v2 = V(0, 0, 0);
    this._v3 = V(0, 0, 0);
    this._R = {
      px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, magOff: 0, magVisible: true, leftToMag: 0, leftOff: V(0, 0, 0),
      slideBack: 0, pumpBack: 0, boltLift: 0, boltBack: 0, barrelsOpen: 0, shellsVisible: true, cylOut: 0,
      cylSpin: 0, drumSpin: 0, coverOpen: 0, shellProp: false,
    };
    this.reset();
  }

  // Vuelve al estado inicial (sin arma, sin acciones)
  reset() {
    if (this.mounted) this.holder.remove(this.mounted);
    this.mounted = null;
    this.ud = null;
    this.model = 'none';
    this.mountedSig = null;
    this.targetSig = '';
    this.targetKey = null;
    this.targetUp = false;
    this.switchState = 'lowering';
    this.switchLower = 1;
    this.actionLower = 0;
    this.knifeT = -1; this.knifeBowieOn = false; this.knifeKey = 'knife'; this.knifeDur = KNIFE_DUR;
    this.throwT = -1;
    this.drinkT = -1; this.drinkDur = DRINK_DUR;
    this.bashT = -1;
    this.shieldTarget = false; this.shieldBlend = 0; this.shieldJolt = 0;
    this.kickZ = 0; this.kickRx = 0; this.kickRz = 0; this.kickZt = 0; this.kickRxt = 0; this.kickRzt = 0;
    this.slideShot = 0;
    this.flashT = 0;
    this.flash.visible = false;
    this.flashLight.intensity = 0;
    this.bobPhase = 0; this.bobAmt = 0;
    this.swayX = 0; this.swayY = 0; this.swayRoll = 0;
    this.lastYaw = null; this.lastPitch = null;
    this.velYs = 0; this.landDip = 0; this.prevGround = true;
    this.sprintBlend = 0; this.downBlend = 0; this.crouchBlend = 0; this.adsBlend = 0;
    this._animS = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };
    this.time = 0;
  }

  // true mientras se baja o se sube el arma
  get switching() { return this.switchState !== 'idle'; }
  get hasWeapon() { return !!this.mounted; }

  // Cambia el arma visible (con animación de bajar/subir). key null = manos vacías.
  setWeapon(key, up = false, instant = false) {
    const sig = key ? `${key}${up ? '+' : ''}` : '';
    if (sig === this.targetSig && !instant) return;
    this.targetSig = sig;
    this.targetKey = key || null;
    this.targetUp = !!up;
    if (instant) {
      this._mount();
      this.switchLower = 0;
      this.switchState = 'idle';
      return;
    }
    if (this.mountedSig === null) {
      this.switchLower = 1;
      this.switchState = 'lowering';
    } else if (this.switchState === 'idle' || this.switchState === 'raising') {
      this.switchState = 'lowering';
    }
  }

  _mount() {
    if (this.mounted) this.holder.remove(this.mounted);
    this.mounted = null;
    this.ud = null;
    this.model = 'none';
    if (this.flash.parent) this.flash.parent.remove(this.flash);
    const key = this.targetKey;
    if (key) {
      let g = this.cache.get(this.targetSig);
      if (!g) {
        g = createWeaponMesh(key, this.targetUp);
        g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
        const ud = g.userData;
        // poses base de las piezas animadas
        ud._base = {
          mag: ud.mag ? ud.mag.position.clone() : null,
          slide: ud.slide ? ud.slide.position.clone() : null,
          pump: ud.pump ? ud.pump.position.clone() : null,
          boltP: ud.bolt ? ud.bolt.position.clone() : null,
          boltR: ud.bolt ? ud.bolt.rotation.z : 0,
          barrels: ud.barrels ? ud.barrels.rotation.x : 0,
          cyl: ud.cylinder ? ud.cylinder.rotation.z : 0,
          cylSpin: ud.cylSpin ? ud.cylSpin.rotation.z : 0,
          drum: ud.drum ? ud.drum.rotation.z : 0,
          cover: ud.cover ? ud.cover.rotation.x : 0,
        };
        this.cache.set(this.targetSig, g);
      }
      this.holder.add(g);
      this.mounted = g;
      this.ud = g.userData;
      this.model = this.ud.model || 'rifle';
      g.add(this.flash);
      this.flash.position.copy(this.ud.muzzle);
      this.flash.position.z -= 0.035;
    }
    this.mountedSig = this.targetSig;
  }

  // Efectos visuales de un disparo
  fire({ kick = 1, flash = 1, color = 0xffc070, slide = true, noFlash = false } = {}) {
    const k = kick * (1 - this.adsBlend * 0.45);
    this.kickZt = Math.min(0.09, this.kickZt + 0.028 * k);
    this.kickRxt = Math.min(0.3, this.kickRxt + 0.05 * k);
    this.kickRzt += (Math.random() - 0.5) * 0.05 * k;
    if (slide) this.slideShot = 1;
    if (!noFlash && this.mounted) {
      this.flashT = 0.05;
      this.flash.visible = true;
      const s = (0.1 + Math.random() * 0.05) * flash;
      this.flash.scale.set(s, s, s);
      this.flash.material.rotation = Math.random() * PI * 2;
      this.flash.material.color.setHex(color);
      this.flashLight.color.setHex(color);
      this.flashLight.intensity = 2.2 * flash;
      this.mounted.localToWorld(this.flashLight.position.copy(this.ud.muzzle));
    }
  }

  // key: 'knife' | 'bowie' | 'bat' | 'machete' | 'axe' (un booleano = bowie o no, por compatibilidad)
  playKnife(key = 'knife', dur = KNIFE_DUR) {
    if (key === true) key = 'bowie';
    else if (!key || key === false) key = 'knife';
    this.knifeT = 0;
    this.knifeKey = this.meleeMeshes[key] ? key : 'knife';
    this.knifeBowieOn = this.knifeKey === 'bowie';
    this.knifeDur = dur > 0 ? dur : KNIFE_DUR;
  }
  playThrow() { this.throwT = 0; }
  playBash() { this.bashT = 0; }
  playDrink(color = '#e0282e', dur = DRINK_DUR) {
    const key = String(color);
    let b = this.bottles.get(key);
    if (!b) {
      b = createBottleMesh(color);
      b.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      this.bottles.set(key, b);
    }
    this.bottleHolder.clear();
    this.bottleHolder.add(b);
    this.drinkT = 0;
    this.drinkDur = dur;
  }
  cancelActions() {
    this.knifeT = -1; this.throwT = -1; this.drinkT = -1; this.bashT = -1;
  }
  setShieldOut(on) { this.shieldTarget = !!on; }
  shieldHit() { this.shieldJolt = 1; }
  get knifeActive() { return this.knifeT >= 0; }
  get throwActive() { return this.throwT >= 0; }
  get drinkActive() { return this.drinkT >= 0; }

  // Posición del cañón proyectada a la escena principal (para trazadores y proyectiles)
  getMuzzleWorld(mainCamera, out) {
    if (!this.mounted || !mainCamera) return null;
    const p = this.mounted.localToWorld(this._v1.copy(this.ud.muzzle));
    const dist = p.length();
    this.camera.updateMatrixWorld();
    p.project(this.camera);
    mainCamera.updateMatrixWorld();
    const camPos = this._v2.setFromMatrixPosition(mainCamera.matrixWorld);
    out.set(p.x, p.y, 0.5).unproject(mainCamera).sub(camPos).normalize().multiplyScalar(Math.max(0.2, dist)).add(camPos);
    return out;
  }

  // s: { visible, hide, ads, sprint, speed01, onGround, crouch, down, yaw, pitch, velY,
  //      reload: { style, p, wasEmpty } | { style:'shell', tilt, shell, pump } | null,
  //      cycle: { style:'pump'|'bolt', p } | null, slideLocked, shieldOut }
  update(dt, s = {}) {
    this.time += dt;
    const t = this.time;
    this.root.visible = !!s.visible && !s.hide;

    // ---------------- cambio de arma
    if (this.switchState === 'lowering') {
      this.switchLower = Math.min(1, this.switchLower + dt / SWITCH_HALF);
      if (this.switchLower >= 1) {
        this._mount();
        this.switchState = 'raising';
      }
    } else if (this.switchState === 'raising') {
      if (this.targetSig !== this.mountedSig) this.switchState = 'lowering';
      else {
        this.switchLower = Math.max(0, this.switchLower - dt / SWITCH_HALF);
        if (this.switchLower <= 0) this.switchState = 'idle';
      }
    } else if (this.targetSig !== this.mountedSig) {
      this.switchState = 'lowering';
    }

    // ---------------- acciones temporizadas
    let actLower = 0;
    let knifeU = -1, throwU = -1, drinkU = -1, bashU = -1;
    if (this.knifeT >= 0) {
      this.knifeT += dt;
      knifeU = this.knifeT / this.knifeDur;
      if (knifeU >= 1) { this.knifeT = -1; knifeU = -1; } else actLower = Math.max(actLower, 0.6 * bump(knifeU, 0, 0.15, 0.7, 1));
    }
    if (this.throwT >= 0) {
      this.throwT += dt;
      throwU = this.throwT / THROW_DUR;
      if (throwU >= 1) { this.throwT = -1; throwU = -1; } else actLower = Math.max(actLower, bump(throwU, 0, 0.14, 0.82, 1));
    }
    if (this.drinkT >= 0) {
      this.drinkT += dt;
      drinkU = this.drinkT / this.drinkDur;
      if (drinkU >= 1) { this.drinkT = -1; drinkU = -1; } else actLower = Math.max(actLower, bump(drinkU, 0, 0.1, 0.9, 1));
    }
    if (this.bashT >= 0) {
      this.bashT += dt;
      bashU = this.bashT / BASH_DUR;
      if (bashU >= 1) { this.bashT = -1; bashU = -1; }
    }
    // escudo
    const shieldWanted = !!s.shieldOut && drinkU < 0;
    this.shieldBlend = clamp01(this.shieldBlend + (shieldWanted ? 1 : -1) * dt / SHIELD_TOGGLE);
    if (this.shieldBlend > 0) actLower = Math.max(actLower, clamp01(this.shieldBlend * 1.4));
    this.shieldJolt = Math.max(0, this.shieldJolt - dt * 5);
    this.actionLower = actLower;

    // ---------------- mezclas de estado
    const ads = clamp01(s.ads || 0);
    this.adsBlend = ads;
    this.sprintBlend = damp(this.sprintBlend, s.sprint ? 1 : 0, 10, dt);
    this.downBlend = damp(this.downBlend, s.down ? 1 : 0, 6, dt);
    this.crouchBlend = damp(this.crouchBlend, s.crouch ? 1 : 0, 8, dt);
    const adsE = smooth(ads);
    const model = this.model;
    const oneHand = ONE_HANDED.has(model);

    // ---------------- pose (cadera / apuntar / correr / caído)
    const hip = HIP[model] || HIP.rifle;
    let px = hip[0], py = hip[1], pz = hip[2], rx = 0, ry = 0.035, rz = 0;
    if (this.ud && adsE > 0) {
      const sg = this.ud.sight;
      const ax = -sg.x, ay = -sg.y, az = -this.ud.eyeRelief - sg.z;
      px += (ax - px) * adsE; py += (ay - py) * adsE; pz += (az - pz) * adsE;
      ry *= 1 - adsE;
    }
    const spr = this.sprintBlend * (1 - adsE);
    if (spr > 0.001) {
      if (oneHand) { px += -0.02 * spr; py += -0.06 * spr; pz += 0.02 * spr; rx += -0.7 * spr; ry += 0.25 * spr; rz += 0.1 * spr; } else { px += -0.05 * spr; py += -0.04 * spr; pz += 0.03 * spr; rx += -0.25 * spr; ry += 0.75 * spr; rz += 0.35 * spr; }
    }
    const dn = this.downBlend;
    if (dn > 0.001) { px -= 0.01 * dn; py -= 0.03 * dn; pz += 0.02 * dn; rx += 0.05 * dn; ry += 0.05 * dn; rz += 0.14 * dn; }
    const cr = this.crouchBlend * (1 - adsE);
    py -= 0.008 * cr; rz += 0.03 * cr;
    this.pose.position.set(px, py, pz);
    this.pose.rotation.set(rx, ry, rz);

    // ---------------- balanceo, respiración e inercia
    const speed = clamp01(s.speed01 || 0);
    const moving = s.onGround !== false && speed > 0.06;
    this.bobAmt = damp(this.bobAmt, moving ? speed : 0, 8, dt);
    this.bobPhase += dt * (4 + 8 * speed) * (moving ? 1 : 0.3) * (s.down ? 0.55 : 1);
    const bobScale = (1 - adsE * 0.85) * (1 + this.sprintBlend * 0.9) * (s.down ? 1.6 : 1);
    const bx = Math.sin(this.bobPhase) * 0.011 * this.bobAmt * bobScale;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.009 * this.bobAmt * bobScale;
    const broll = Math.sin(this.bobPhase) * 0.018 * this.bobAmt * bobScale;
    const breath = 1 - adsE * 0.7;
    const brx = Math.sin(t * 0.8) * 0.0012 * breath;
    const bry = Math.sin(t * 1.6) * 0.0022 * breath;
    // inercia al girar la vista
    if (typeof s.yaw === 'number' && typeof s.pitch === 'number' && dt > 0) {
      if (this.lastYaw === null) { this.lastYaw = s.yaw; this.lastPitch = s.pitch; }
      let dyaw = s.yaw - this.lastYaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const dpitch = s.pitch - this.lastPitch;
      this.lastYaw = s.yaw; this.lastPitch = s.pitch;
      const k = (1 - adsE * 0.75) * 0.012;
      const tx = Math.max(-0.045, Math.min(0.045, (dyaw / dt) * k));
      const ty = Math.max(-0.035, Math.min(0.035, -(dpitch / dt) * k));
      this.swayX = damp(this.swayX, tx, 9, dt);
      this.swayY = damp(this.swayY, ty, 9, dt);
      this.swayRoll = damp(this.swayRoll, -tx * 2.2, 8, dt);
    }
    // salto y aterrizaje
    const onG = s.onGround !== false;
    if (onG && !this.prevGround) this.landDip = Math.min(1, Math.abs(this.velYs) / 5 + 0.3);
    this.prevGround = onG;
    this.velYs = damp(this.velYs, s.velY || 0, 12, dt);
    this.landDip = Math.max(0, this.landDip - dt * 4);
    const jumpY = Math.max(-0.03, Math.min(0.03, -this.velYs * 0.005)) - Math.sin(this.landDip * PI) * 0.02 * (1 - adsE * 0.7);
    this.sway.position.set(bx + brx + this.swayX, by + bry + this.swayY + jumpY, 0);
    this.sway.rotation.set(this.swayY * 1.2, -this.swayX * 1.5, broll + this.swayRoll);

    // ---------------- retroceso (muelle rápido)
    const dec = Math.exp(-dt * 9);
    this.kickZt *= dec; this.kickRxt *= dec; this.kickRzt *= dec;
    const fk = 1 - Math.exp(-dt * 38);
    this.kickZ += (this.kickZt - this.kickZ) * fk;
    this.kickRx += (this.kickRxt - this.kickRx) * fk;
    this.kickRz += (this.kickRzt - this.kickRz) * fk;
    this.kick.position.set(0, this.kickRx * 0.04, this.kickZ);
    this.kick.rotation.set(this.kickRx * (1 - adsE * 0.6), 0, this.kickRz);
    this.slideShot = Math.max(0, this.slideShot - dt / 0.07);

    // ---------------- animaciones de recarga, ciclo y bajar el arma
    const R = this._R;
    R.px = R.py = R.pz = R.rx = R.ry = R.rz = 0;
    R.magOff = 0; R.magVisible = true; R.leftToMag = 0; R.leftOff.set(0, 0, 0);
    R.slideBack = 0; R.pumpBack = 0; R.boltLift = 0; R.boltBack = 0; R.barrelsOpen = 0; R.shellsVisible = true;
    R.cylOut = 0; R.cylSpin = 0; R.drumSpin = 0; R.coverOpen = 0; R.shellProp = false;
    if (s.reload && this.ud) this._reloadPose(s.reload, R);
    if (s.cycle && this.ud) this._cyclePose(s.cycle, R);
    const lower = smooth(Math.max(this.switchLower, this.actionLower, s.visible ? 0 : 1));
    // suavizado para que cancelar una recarga no provoque saltos
    const A = this._animS;
    A.px = damp(A.px, R.px, 22, dt); A.py = damp(A.py, R.py, 22, dt); A.pz = damp(A.pz, R.pz, 22, dt);
    A.rx = damp(A.rx, R.rx, 22, dt); A.ry = damp(A.ry, R.ry, 22, dt); A.rz = damp(A.rz, R.rz, 22, dt);
    this.anim.position.set(A.px - 0.03 * lower, A.py - 0.32 * lower, A.pz + 0.05 * lower);
    this.anim.rotation.set(A.rx - 0.7 * lower, A.ry, A.rz - 0.25 * lower);
    this.holder.visible = lower < 0.995;

    // piezas animadas del arma
    const ud = this.ud;
    if (ud && ud._base) {
      const b = ud._base;
      if (ud.mag) {
        ud.mag.position.copy(b.mag).addScaledVector(ud.magDir, R.magOff);
        ud.mag.visible = R.magVisible;
      }
      if (ud.slide) {
        const back = Math.max(R.slideBack, this.slideShot, s.slideLocked ? 1 : 0);
        ud.slide.position.copy(b.slide);
        ud.slide.position.z += ud.slideTravel * back;
      }
      if (ud.pump) { ud.pump.position.copy(b.pump); ud.pump.position.z += ud.pumpTravel * R.pumpBack; }
      if (ud.bolt) {
        ud.bolt.position.copy(b.boltP);
        ud.bolt.position.z += 0.07 * R.boltBack;
        ud.bolt.rotation.z = b.boltR + 1.1 * R.boltLift;
      }
      if (ud.barrels) ud.barrels.rotation.x = b.barrels - 0.55 * R.barrelsOpen;
      if (ud.shells) ud.shells.visible = R.shellsVisible;
      if (ud.cylinder) ud.cylinder.rotation.z = b.cyl + 1.25 * R.cylOut;
      if (ud.cylSpin) ud.cylSpin.rotation.z = b.cylSpin + R.cylSpin;
      if (ud.drum) ud.drum.rotation.z = b.drum + R.drumSpin;
      if (ud.cover) ud.cover.rotation.x = b.cover + 0.9 * R.coverOpen;
    }

    // ---------------- accesorios
    // cuchillo
    this.knifeHolder.visible = knifeU >= 0;
    if (knifeU >= 0) {
      const heavy = this.knifeKey === 'bat' || this.knifeKey === 'machete' || this.knifeKey === 'axe';
      sampleKeys(heavy ? SWING_KEYS : KNIFE_KEYS, knifeU, this._tmpP, this._tmpR);
      this.knifeHolder.position.copy(this._tmpP);
      this.knifeHolder.rotation.set(this._tmpR.x, this._tmpR.y, this._tmpR.z);
      for (const k in this.meleeMeshes) this.meleeMeshes[k].visible = k === this.knifeKey;
    }
    // granada
    this.throwHolder.visible = throwU >= 0;
    if (throwU >= 0) {
      sampleKeys(THROW_KEYS, throwU, this._tmpP, this._tmpR);
      this.throwHolder.position.copy(this._tmpP);
      this.throwHolder.rotation.set(this._tmpR.x, this._tmpR.y, this._tmpR.z);
      this.grenade.visible = throwU < THROW_RELEASE / THROW_DUR;
    }
    // botella
    this.bottleHolder.visible = drinkU >= 0;
    if (drinkU >= 0) {
      sampleKeys(DRINK_KEYS, drinkU, this._tmpP, this._tmpR);
      this.bottleHolder.position.copy(this._tmpP);
      this.bottleHolder.rotation.set(this._tmpR.x, this._tmpR.y, this._tmpR.z);
    }
    // escudo en las manos (y golpe)
    this.shieldHolder.visible = this.shieldBlend > 0.01;
    if (this.shieldHolder.visible) {
      const sb = smooth(this.shieldBlend);
      const thrust = bashU >= 0 ? bump(bashU, 0, 0.3, 0.45, 1) : 0;
      const jolt = this.shieldJolt;
      this.shieldHolder.position.set(
        -0.24 + 0.1 * thrust + bx * 0.6,
        -0.36 - 0.55 * (1 - sb) + by * 0.6 + 0.02 * thrust - 0.015 * jolt,
        -0.44 - 0.22 * thrust + 0.03 * jolt,
      );
      this.shieldHolder.rotation.set(0.05 + 0.12 * thrust + 0.05 * jolt, 0.35 - 0.35 * thrust, -0.08 * thrust);
    }

    // ---------------- manos
    this.root.updateMatrixWorld(true);
    const rightW = this._v1, leftW = this._v2;
    let hasRight = false, hasLeft = false;
    const fistBob = this._v3.set(bx, by - 0.32 * smooth(this.switchLower), 0);
    // mano derecha
    if (knifeU >= 0) { this.knifeHolder.getWorldPosition(rightW); hasRight = true; }
    else if (throwU >= 0) { this.throwHolder.getWorldPosition(rightW); hasRight = true; }
    else if (drinkU >= 0) { this.bottleHolder.getWorldPosition(rightW); hasRight = true; }
    else if (this.shieldBlend > 0.5) { this.shield.localToWorld(rightW.copy(this.shield.userData.handleR)); hasRight = true; }
    else if (this.mounted) { this.mounted.localToWorld(rightW.set(0, 0, 0.012)); hasRight = true; }
    else { this.sway.localToWorld(rightW.set(0.15, -0.2, -0.34).add(fistBob)); hasRight = true; }
    // mano izquierda
    if (this.shieldBlend > 0.5) { this.shield.localToWorld(leftW.copy(this.shield.userData.handleL)); hasLeft = true; }
    else if (this.mounted) {
      const lhp = ud.leftHandParent || this.mounted;
      lhp.localToWorld(leftW.copy(ud.leftHand));
      if (R.leftToMag > 0) {
        const mp = this._tmpP;
        if (ud.mag && !ud.magPoint) ud.mag.localToWorld(mp.set(0, -0.02, 0));
        else if (ud.magPoint) this.mounted.localToWorld(mp.copy(ud.magPoint));
        else this.mounted.localToWorld(mp.set(0, 0.02, -0.12));
        leftW.lerp(mp, R.leftToMag);
      }
      if (R.leftOff.lengthSq() > 0) {
        this.sway.worldToLocal(leftW);
        leftW.add(R.leftOff);
        this.sway.localToWorld(leftW);
      }
      hasLeft = true;
    } else if (knifeU >= 0 && this.meleeMeshes[this.knifeKey] && this.meleeMeshes[this.knifeKey].userData.grip2) {
      // armas a dos manos: la izquierda agarra el mango por detrás de la derecha
      this.meleeMeshes[this.knifeKey].localToWorld(leftW.copy(this.meleeMeshes[this.knifeKey].userData.grip2));
      hasLeft = true;
    } else if (knifeU < 0 && throwU < 0) {
      this.sway.localToWorld(leftW.set(-0.15, -0.21, -0.36).add(fistBob));
      hasLeft = true;
    } else {
      this.sway.localToWorld(leftW.set(-0.2, -0.6, -0.3));
      hasLeft = true;
    }
    const oneH = oneHand && !(this.shieldBlend > 0.5);
    this._placeArm(this.armR, hasRight ? rightW : null, RIGHT_ELBOW);
    this._placeArm(this.armL, hasLeft ? leftW : null, oneH ? LEFT_ELBOW_SHORT : LEFT_ELBOW_LONG);
    // cartucho en la mano izquierda
    this.shellProp.visible = R.shellProp;
    if (R.shellProp) {
      this.shellProp.position.copy(this.sway.worldToLocal(this._tmpR.copy(leftW)));
      this.shellProp.position.y += 0.015;
      this.shellProp.position.z -= 0.035;
    }

    // ---------------- fogonazo
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.flash.visible = false; }
    }
    this.flashLight.intensity *= Math.exp(-dt * 40);
    if (this.flashLight.intensity < 0.01) this.flashLight.intensity = 0;
  }

  _placeArm(arm, handWorld, elbowLocal) {
    if (!handWorld) { arm.root.visible = false; return; }
    arm.root.visible = true;
    const local = this.sway.worldToLocal(this._tmpR.copy(handWorld));
    arm.root.position.copy(local);
    const elbowW = this.sway.localToWorld(this._tmpP.copy(elbowLocal));
    arm.root.lookAt(elbowW);
    const len = handWorld.distanceTo(elbowW) - 0.11;
    arm.sleeve.scale.set(1, 1, Math.max(0.05, len));
  }

  // Poses de recarga según el tipo de arma
  _reloadPose(r, R) {
    const st = r.style;
    if (st === 'shell') {
      const tl = clamp01(r.tilt || 0);
      R.rz = 0.5 * tl; R.rx = 0.1 * tl; R.px = -0.02 * tl; R.py = 0.012 * tl;
      const sp = clamp01(r.shell || 0);
      const dip = sp < 0.5 ? seg(sp, 0, 0.5) : 1 - seg(sp, 0.5, 0.8);
      R.leftToMag = tl;
      R.leftOff.set(0.02 * dip, -0.13 * dip, 0.04 * dip);
      R.shellProp = tl > 0.5 && sp > 0.4 && sp < 0.8;
      R.rx += 0.03 * bump(sp, 0.7, 0.78, 0.8, 0.9);
      if (typeof r.pump === 'number' && r.pump >= 0) {
        R.pumpBack = bump(r.pump, 0.05, 0.35, 0.5, 0.85);
        R.leftToMag *= 1 - seg(r.pump, 0, 0.2);
      }
      return;
    }
    const p = clamp01(r.p || 0);
    const ud = this.ud;
    if (st === 'revolver') {
      const tl = bump(p, 0, 0.12, 0.88, 1);
      R.rz = 0.7 * tl; R.rx = 0.22 * tl; R.px = -0.04 * tl; R.py = 0.02 * tl;
      R.cylOut = bump(p, 0.12, 0.2, 0.74, 0.82);
      R.rx += 0.4 * bump(p, 0.24, 0.3, 0.34, 0.42);
      R.leftToMag = bump(p, 0.08, 0.15, 0.8, 0.88);
      R.leftOff.set(0, -0.18 * bump(p, 0.38, 0.45, 0.52, 0.64), 0.03 * bump(p, 0.38, 0.45, 0.52, 0.64));
      R.cylSpin = seg(p, 0.68, 0.76) * PI * 1.3;
      return;
    }
    if (st === 'break') {
      const tl = bump(p, 0, 0.12, 0.88, 1);
      R.rz = 0.35 * tl; R.rx = 0.12 * tl; R.px = -0.02 * tl;
      R.barrelsOpen = bump(p, 0.12, 0.22, 0.74, 0.8);
      R.rx += 0.3 * bump(p, 0.26, 0.32, 0.34, 0.42);
      R.shellsVisible = p < 0.3 || p > 0.6;
      R.leftToMag = bump(p, 0.4, 0.48, 0.64, 0.72);
      R.leftOff.set(0, -0.16 * bump(p, 0.36, 0.42, 0.5, 0.6), 0);
      return;
    }
    // cargador (pistolas, subfusiles, fusiles, ametralladoras, francotiradores, Ray Gun, lanzagranadas)
    const heavy = st === 'lmg' ? 1.3 : 1;
    const tl = bump(p, 0, 0.15, 0.85, 1);
    R.rz = 0.4 * tl * heavy; R.rx = (st === 'pistol' || st === 'raygun' ? 0.22 : 0.14) * tl; R.ry = 0.1 * tl;
    R.px = -0.03 * tl; R.py = 0.018 * tl;
    if (st === 'launcher' || (!ud.mag && ud.drum)) {
      R.leftToMag = bump(p, 0.1, 0.2, 0.8, 0.9);
      R.drumSpin = seg(p, 0.22, 0.78) * PI * 2;
      R.rz += 0.1 * bump(p, 0.3, 0.35, 0.65, 0.7);
      return;
    }
    if (st === 'lmg') R.coverOpen = bump(p, 0.08, 0.2, 0.76, 0.86);
    const out = seg(p, 0.2, 0.36), inn = seg(p, 0.46, 0.66);
    R.magOff = p < 0.41 ? 0.3 * out : 0.3 * (1 - inn);
    R.magVisible = !(p >= 0.37 && p < 0.45);
    R.leftToMag = seg(p, 0.1, 0.2) * (1 - seg(p, 0.68, 0.8));
    if (st === 'pistol' && r.wasEmpty) R.slideBack = 1 - seg(p, 0.8, 0.85);
    if (st === 'bolt') {
      R.boltLift = bump(p, 0.72, 0.76, 0.88, 0.92);
      R.boltBack = bump(p, 0.76, 0.8, 0.84, 0.88);
    }
    if (r.wasEmpty && st !== 'pistol' && st !== 'bolt') {
      const j = bump(p, 0.76, 0.8, 0.84, 0.9);
      R.rx += 0.05 * j; R.pz += 0.012 * j;
    }
  }

  // Ciclo tras el disparo: corredera de bombeo o cerrojo
  _cyclePose(c, R) {
    const p = clamp01(c.p || 0);
    if (c.style === 'pump') {
      R.pumpBack = Math.max(R.pumpBack, bump(p, 0.1, 0.35, 0.45, 0.75));
      R.rz += 0.05 * bump(p, 0.05, 0.3, 0.5, 0.8);
      R.py -= 0.008 * bump(p, 0.1, 0.35, 0.45, 0.75);
    } else if (c.style === 'bolt') {
      R.boltLift = Math.max(R.boltLift, bump(p, 0.05, 0.18, 0.62, 0.75));
      R.boltBack = Math.max(R.boltBack, bump(p, 0.18, 0.32, 0.42, 0.6));
      R.rz += 0.12 * bump(p, 0.02, 0.15, 0.7, 0.85);
      R.rx += 0.03 * bump(p, 0.02, 0.15, 0.7, 0.85);
    }
  }
}

export default ViewModel;
