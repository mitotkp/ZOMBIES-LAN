// Máquinas con estado: Perk-a-Colas, Pack-a-Punch, palanca de la electricidad y mesa de trabajo del escudo
// (con las piezas repartidas por el mapa). El aspecto se deriva de gs; los eventos solo animan.
import * as THREE from 'three';
import {
  PERK_MACHINES, PAP_MACHINE, POWER_SWITCH, WORKBENCH, SHIELD_PARTS, INTERACTABLE_BY_ID, DIRS,
} from '/shared/map.js';
import { PERKS } from '/shared/perks.js';
import { PAP } from '/shared/constants.js';
import { StaticBatch, yawForFace, uvRectPlane, makeGlow, sfx, music, fx, easeInOut, flickerNoise, TAU } from './kit.js';
import { perkTexture, papLogoTexture } from './textures.js';
import { L } from './lighting.js';
import { createWeaponMesh, createShieldMesh } from '../weapons/models.js';

const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
const _v = new THREE.Vector3();

function rectCenter(r) {
  return { cx: (r.x0 + r.x1 + 1) / 2, cz: (r.z0 + r.z1 + 1) / 2, lx: r.x1 - r.x0 + 1, lz: r.z1 - r.z0 + 1 };
}

function panelMaterial(tex, intensity = 0.1) {
  return new THREE.MeshStandardMaterial({
    map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: intensity, roughness: 0.5, metalness: 0.1,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

// ---------------------------------------------------------------------------------------------
// Perk-a-Colas
export class PerkMachines {
  constructor(world, B) {
    this.world = world;
    this.ctx = world.ctx;
    this.list = [];
    this.power = 0;
    for (const m of PERK_MACHINES) this.list.push(this._make(m, B));
  }

  _make(m, B) {
    const p = PERKS[m.perk] || { color: '#888888', glow: 0x888888 };
    const col = new THREE.Color(p.color);
    const cx = m.x + 0.5, cz = m.z + 0.5, yaw = yawForFace(m.face);
    const dark = col.clone().multiplyScalar(0.45).getHex();
    // Cuerpo estático (fusionado)
    const P = B.at(cx, 0, cz, yaw);
    P.box('metal', 0.9, 0.12, 0.82, 0, 0.06, 0, { color: 0x1a1a1a });
    P.box('plastic', 0.86, 1.9, 0.78, 0, 1.07, 0.02, { color: col.getHex() });
    P.box('plastic', 0.9, 0.1, 0.82, 0, 2.05, 0.02, { color: dark });
    P.box('metal', 0.92, 0.5, 0.3, 0, 2.3, 0.2, { color: 0x151515 });       // soporte del letrero
    P.box('chrome', 0.05, 1.8, 0.05, -0.44, 1.05, -0.39, {});
    P.box('chrome', 0.05, 1.8, 0.05, 0.44, 1.05, -0.39, {});
    P.box('dark', 0.36, 0.2, 0.06, 0, 0.36, -0.39);                        // hueco de la botella
    P.box('chrome', 0.4, 0.03, 0.1, 0, 0.25, -0.42, {});
    P.box('metal', 0.1, 0.22, 0.05, 0.3, 0.95, -0.41, { color: 0x2a2a2a }); // ranura de monedas
    P.box('rust', 0.3, 0.4, 0.004, -0.28, 0.5, -0.402, {});
    // cables hacia la pared
    P.rod('rubber', [0.2, 0.1, 0.4], [0.35, 0.02, 0.9], 0.03);

    // Paneles con textura (dinámicos: se encienden con la electricidad)
    const tex = perkTexture(m.perk);
    const mat = this.world.mats.track(panelMaterial(tex, 0.05));
    const group = new THREE.Group();
    group.position.set(cx, 0, cz);
    group.rotation.y = yaw;
    const front = new THREE.Mesh(uvRectPlane(0.74, 1.45, 0, 0, 1, 0.75), mat);
    front.position.set(0, 1.18, -0.397);
    front.rotation.y = Math.PI;
    const sign = new THREE.Mesh(uvRectPlane(0.9, 0.45, 0, 0.75, 1, 1), mat);
    sign.position.set(0, 2.3, 0.04);
    sign.rotation.y = Math.PI;
    for (const o of [front, sign]) { o.userData.noShadow = true; group.add(o); }
    const glow = makeGlow(p.glow, 1.8, 0);
    glow.position.set(0, 2.3, -0.3);
    group.add(glow);
    const floorGlow = makeGlow(p.glow, 2.2, 0);
    floorGlow.position.set(0, 0.2, -0.8);
    group.add(floorGlow);
    this.world.root.add(group);
    return { m, mat, glow, floorGlow, cx, cz, seed: Math.random() * 10, jingle: 0 };
  }

  sync(gs) { void gs; }

  onEvent(name, e) {
    if (name !== 'perk') return;
    const it = this.list.find((x) => x.m.perk === e.perk);
    if (!it) return;
    it.jingle = 2.5;
    if (this.world._isSelf(e.pid)) music(this.ctx, 'perk:' + e.perk);
  }

  update(dt, t) {
    const P = this.world.lighting ? this.world.lighting.powerLevel : 0;
    for (const it of this.list) {
      if (it.jingle > 0) it.jingle -= dt;
      const flick = 0.85 + 0.15 * flickerNoise(t * 1.3, it.seed);
      const boost = it.jingle > 0 ? 0.5 * Math.abs(Math.sin(it.jingle * 9)) : 0;
      it.mat.emissiveIntensity = 0.05 + P * (0.75 * flick + boost);
      it.glow.material.opacity = P * (0.55 * flick + boost);
      it.floorGlow.material.opacity = P * 0.25 * flick;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Pack-a-Punch
export class PackAPunch {
  constructor(world, B) {
    this.world = world;
    this.ctx = world.ctx;
    const r = rectCenter(PAP_MACHINE);
    this.cx = r.cx; this.cz = r.cz;
    const yaw = this.yaw = yawForFace(PAP_MACHINE.face);
    const P = B.at(r.cx, 0, r.cz, yaw);
    const W = 1.85;
    // base y cuerpo
    P.box('metal', W, 0.14, 0.95, 0, 0.07, 0, { color: 0x121216 });
    P.box('metal', W - 0.1, 0.95, 0.85, 0, 0.61, 0, { color: 0x2a2436 });
    P.box('metal', W - 0.2, 0.5, 0.75, 0, 1.33, 0.02, { color: 0x3a3048 });
    P.box('chrome', W - 0.05, 0.05, 0.9, 0, 1.09, 0, { color: 0x9a8aa8 });
    // rodillos y engranajes laterales
    for (const s of [-1, 1]) {
      P.cyl('metal', 0.26, 0.26, 0.12, s * (W / 2 - 0.02), 0.75, 0, { rz: Math.PI / 2, seg: 16, color: 0x5a4a6a });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        P.box('metal', 0.14, 0.08, 0.08, s * (W / 2 + 0.03), 0.75 + Math.sin(a) * 0.28, Math.cos(a) * 0.28, { color: 0x4a3a5a, rx: a });
      }
    }
    // tolva (boca) donde entra el arma
    P.box('dark', 0.9, 0.12, 0.08, 0, 1.2, -0.41);
    P.box('chrome', 1.0, 0.04, 0.2, 0, 1.12, -0.46, { color: 0x8a7a9a });
    // tubos y antenas
    P.cyl('metal', 0.05, 0.05, 0.6, -0.6, 1.85, 0.2, { seg: 8, color: 0x4a3a5a });
    P.cyl('metal', 0.05, 0.05, 0.45, 0.62, 1.8, 0.25, { seg: 8, color: 0x4a3a5a });
    P.sphere('chrome', 0.08, -0.6, 2.18, 0.2, { seg: 8 });
    P.sphere('chrome', 0.08, 0.62, 2.05, 0.25, { seg: 8 });

    // Logo y paneles brillantes (dinámicos)
    const group = this.group = new THREE.Group();
    group.position.set(r.cx, 0, r.cz);
    group.rotation.y = yaw;
    this.logoMat = world.mats.track(panelMaterial(papLogoTexture(), 0.1));
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.44), this.logoMat);
    logo.position.set(0, 1.4, -0.4);
    logo.rotation.y = Math.PI;
    logo.userData.noShadow = true;
    group.add(logo);
    this.stripMat = world.mats.track(new THREE.MeshStandardMaterial({ color: 0x2a1040, emissive: 0xb050ff, emissiveIntensity: 0, roughness: 0.4 }));
    for (const y of [0.3, 0.55, 0.8]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.035, 0.02), this.stripMat);
      s.position.set(0, y, -0.435);
      group.add(s);
    }
    this.glow = makeGlow(0xb050ff, 3.2, 0);
    this.glow.position.set(0, 1.3, -0.6);
    group.add(this.glow);
    // Arma que entra o sale
    this.weaponHolder = new THREE.Group();
    this.weaponHolder.position.set(0, 1.3, -0.75);
    group.add(this.weaponHolder);
    this.weapon = null;
    this.weaponKey = null;
    this.weaponUp = false;
    this.state = 'idle';
    this.insertT = -1;
    this.ejectT = -1;
    world.root.add(group);
  }

  _setWeapon(key, up) {
    if (this.weaponKey === key && this.weaponUp === up) return;
    if (this.weapon) this.weaponHolder.remove(this.weapon);
    this.weapon = null;
    this.weaponKey = key;
    this.weaponUp = up;
    if (!key) return;
    try {
      this.weapon = createWeaponMesh(key, up);
      this.weapon.rotation.y = Math.PI / 2; // de lado frente a la máquina
      this.weaponHolder.add(this.weapon);
    } catch (e) { this.weapon = null; }
  }

  sync(gs) {
    const pap = gs.pap || { state: 'idle' };
    this.state = pap.state;
    this.until = pap.until || 0;
    if (pap.state === 'ready') {
      this._setWeapon(pap.weapon, true);
    } else if (pap.state === 'working') {
      if (this.insertT < 0) this._setWeapon(null, false);
    } else {
      this.insertT = -1; this.ejectT = -1;
      this._setWeapon(null, false);
    }
  }

  onEvent(name, e) {
    if (name === 'papStart') {
      this._setWeapon(e.weapon, false);
      this.insertT = 0;
      this.ejectT = -1;
      sfx(this.ctx, 'pap_work', this.cx, 1.2, this.cz);
      if (this.world._isSelf(e.pid)) music(this.ctx, 'pap');
    } else if (name === 'papReady') {
      this._setWeapon(e.weapon, true);
      this.ejectT = 0;
      this.insertT = -1;
      sfx(this.ctx, 'pap_ready', this.cx, 1.2, this.cz);
      _v.set(this.cx, 1.3, this.cz);
      fx(this.ctx, 'flash', _v.clone(), 0xc070ff, 2.2);
    }
  }

  update(dt, t) {
    const P = this.world.lighting ? this.world.lighting.powerLevel : 0;
    const working = this.state === 'working';
    const pulse = 0.5 + 0.5 * Math.sin(t * (working ? 14 : 2.4));
    this.logoMat.emissiveIntensity = 0.08 + P * (0.7 + 0.3 * pulse);
    this.stripMat.emissiveIntensity = P * (working ? 2.2 * pulse : 0.9 + 0.3 * pulse);
    this.glow.material.opacity = P * (working ? 0.9 * pulse : 0.45);
    const lights = this.world.lighting && this.world.lighting.points;
    if (lights && lights[L.PAP]) lights[L.PAP].intensity = P * (working ? 6 + 6 * pulse : 5);

    const h = this.weaponHolder;
    if (this.insertT >= 0) {
      // el arma avanza hacia la boca y desaparece dentro
      this.insertT += dt;
      const k = Math.min(1, this.insertT / 1.1);
      h.position.set(0, 1.3 - 0.05 * k, -0.75 + 0.5 * easeInOut(k));
      h.scale.setScalar(1 - 0.6 * Math.max(0, k - 0.6) / 0.4);
      h.rotation.set(0, 0, Math.sin(this.insertT * 30) * 0.03);
      if (k >= 1) { this.insertT = -1; if (this.state !== 'ready') this._setWeapon(null, false); }
    } else if (this.weapon && this.state === 'ready') {
      // el arma mejorada sale y flota esperando a su dueño; retrocede según pasa el tiempo
      if (this.ejectT >= 0) this.ejectT += dt;
      const k = this.ejectT >= 0 ? Math.min(1, this.ejectT / 0.8) : 1;
      const left = this.until ? Math.max(0, (this.until - this.world.now()) / (PAP.pickupTime * 1000)) : 1;
      h.scale.setScalar(0.4 + 0.6 * k);
      h.position.set(0, 1.3 + Math.sin(t * 2) * 0.03, -0.25 - 0.5 * easeInOut(k) * (0.4 + 0.6 * left));
      h.rotation.set(0, Math.sin(t * 1.2) * 0.25, 0);
    } else {
      h.position.set(0, 1.3, -0.75);
      h.scale.setScalar(1);
      h.rotation.set(0, 0, 0);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Palanca de la electricidad
export class PowerSwitch {
  constructor(world, B) {
    this.world = world;
    this.ctx = world.ctx;
    const it = INTERACTABLE_BY_ID.power;
    const yaw = yawForFace(OPP[POWER_SWITCH.wall]);
    this.x = it.wx; this.z = it.wz;
    const P = B.at(it.wx, 0, it.wz, yaw);
    P.box('metal', 0.7, 1.0, 0.28, 0, 1.45, -0.14, { color: 0x4a5448 });
    P.box('metal', 0.74, 0.06, 0.32, 0, 1.97, -0.16, { color: 0x3a4238 });
    P.box('zoc_hazard', 0.6, 0.12, 0.01, 0, 1.08, -0.285, {});
    P.box('metal', 0.12, 0.2, 0.1, 0, 1.4, -0.33, { color: 0x2a2a2a }); // eje
    P.rod('rubber', [0.2, 1.95, -0.14], [0.25, 3.9, -0.1], 0.04);
    P.rod('rubber', [-0.2, 1.95, -0.14], [-0.3, 3.9, -0.1], 0.04);
    P.box('metal', 1.2, 0.1, 0.1, 0, 3.9, -0.08, { color: 0x3a3a3a });
    // Palanca (dinámica)
    const lb = new StaticBatch(world.mats);
    const Q = lb.at(0, 0, 0, 0);
    Q.cyl('metal', 0.025, 0.025, 0.42, 0, 0.21, 0, { seg: 8, color: 0x9a9a9a });
    Q.cyl('plastic', 0.045, 0.045, 0.16, 0, 0.46, 0, { seg: 10, color: 0xa01010 });
    this.lever = lb.toGroup({ shadows: true });
    const pivot = this.pivot = new THREE.Group();
    pivot.position.set(it.wx, 0, it.wz);
    pivot.rotation.y = yaw;
    this.lever.position.set(0, 1.4, -0.38);
    pivot.add(this.lever);
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), world.mats.track(new THREE.MeshStandardMaterial({ color: 0x300808, emissive: 0xff2010, emissiveIntensity: 1 })));
    this.lamp.position.set(0.24, 1.8, -0.29);
    pivot.add(this.lamp);
    world.root.add(pivot);
    this.on = false;
    this.anim = -1;
    this._setAngle(0);
  }

  // k: 0 = abajo (apagada), 1 = arriba (encendida)
  // (ángulo negativo = la palanca sale hacia la sala, -Z local)
  _setAngle(k) { this.lever.rotation.x = -(Math.PI * 0.72 - k * Math.PI * 0.62); }

  sync(gs) {
    const on = !!gs.power;
    if (on === this.on) return;
    this.on = on;
    if (!on || this.anim < 0) { this.anim = -1; this._setAngle(on ? 1 : 0); }
  }

  onEvent(name) {
    if (name !== 'power') return;
    this.on = true;
    this.anim = 0;
    sfx(this.ctx, 'power_on', this.x, 1.5, this.z);
  }

  update(dt) {
    if (this.anim >= 0) {
      this.anim += dt;
      const k = Math.min(1, this.anim / 0.6);
      this._setAngle(easeInOut(k));
      if (k >= 1) {
        this.anim = -1;
        _v.set(this.x, 1.8, this.z);
        fx(this.ctx, 'spark', _v.clone(), new THREE.Vector3(-DIRS[POWER_SWITCH.wall].dx, 0, -DIRS[POWER_SWITCH.wall].dz));
      }
    }
    const P = this.world.lighting ? this.world.lighting.powerLevel : 0;
    this.lamp.material.emissive.setHex(P > 0.5 ? 0x30ff40 : 0xff2010);
    this.lamp.material.emissiveIntensity = P > 0.5 ? 1.5 : 0.6 + 0.6 * Math.max(0, Math.sin(this.world.time * 3.2));
  }
}

// ---------------------------------------------------------------------------------------------
// Mesa de trabajo y piezas del escudo
function partModel(world, id) {
  const lb = new StaticBatch(world.mats);
  const P = lb.at(0, 0, 0, 0);
  if (id === 0) {
    // puerta de auto
    P.box('rust', 0.9, 0.55, 0.06, 0, 0.3, 0, { color: 0x5a7087 });
    P.box('glass', 0.7, 0.3, 0.02, 0, 0.7, 0, { color: 0x708090 });
    P.box('metal', 0.9, 0.04, 0.07, 0, 0.58, 0, { color: 0x2a2a2a });
  } else if (id === 1) {
    // carretilla
    P.box('metal', 0.55, 0.22, 0.4, 0, 0.3, 0, { color: 0x3a5a3a });
    P.cyl('rubber', 0.12, 0.12, 0.06, 0.32, 0.12, 0, { rx: Math.PI / 2, seg: 12 });
    P.rod('metal', [-0.25, 0.25, 0.12], [-0.6, 0.35, 0.18], 0.015);
    P.rod('metal', [-0.25, 0.25, -0.12], [-0.6, 0.35, -0.18], 0.015);
  } else {
    // asa de metal
    P.box('chrome', 0.4, 0.04, 0.04, 0, 0.06, 0, {});
    P.box('metal', 0.04, 0.12, 0.04, -0.18, 0.04, 0, { color: 0x3a3a3a });
    P.box('metal', 0.04, 0.12, 0.04, 0.18, 0.04, 0, { color: 0x3a3a3a });
  }
  return lb.toGroup({ shadows: true });
}

export class Workbench {
  constructor(world, B) {
    this.world = world;
    this.ctx = world.ctx;
    const r = rectCenter(WORKBENCH);
    this.cx = r.cx; this.cz = r.cz;
    const yaw = yawForFace(WORKBENCH.face);
    const P = B.at(r.cx, 0, r.cz, yaw);
    P.box('wood', 1.95, 0.08, 0.9, 0, 0.96, 0, { color: 0x7a5a3a });
    for (const [x, z] of [[-0.9, -0.38], [0.9, -0.38], [-0.9, 0.38], [0.9, 0.38]]) P.box('metal', 0.07, 0.92, 0.07, x, 0.46, z, { color: 0x3a3a3a });
    P.box('wood', 1.85, 0.04, 0.8, 0, 0.3, 0, { color: 0x6a4a2a });
    P.box('metal', 0.3, 0.14, 0.18, -0.65, 1.07, 0.2, { color: 0x8a2a1a });  // caja de herramientas
    P.box('metal', 0.25, 0.1, 0.12, 0.7, 1.05, 0.25, { color: 0x4a4a4a });   // tornillo de banco
    P.cyl('metal', 0.03, 0.03, 0.2, 0.7, 1.15, 0.25, { rz: Math.PI / 2, seg: 6, color: 0x6a6a6a });

    const group = this.group = new THREE.Group();
    group.position.set(r.cx, 0, r.cz);
    group.rotation.y = yaw;
    world.root.add(group);
    // piezas sobre la mesa (se muestran al recogerlas)
    this.benchParts = [0, 1, 2].map((id) => {
      const g = partModel(world, id);
      g.scale.setScalar(0.6);
      g.position.set(-0.55 + id * 0.55, 1.0, -0.05);
      g.rotation.y = 0.3 * (id - 1);
      g.visible = false;
      group.add(g);
      return g;
    });
    // escudo terminado apoyado en la mesa
    try {
      this.shield = createShieldMesh();
      this.shield.position.set(0, 1.47, 0.2);
      this.shield.rotation.x = -0.15;
      this.shield.visible = false;
      group.add(this.shield);
    } catch (e) { this.shield = null; }
    this.glow = makeGlow(0x7ad0ff, 1.6, 0);
    this.glow.position.set(0, 1.3, 0);
    group.add(this.glow);

    // piezas en el suelo del mapa
    this.ground = SHIELD_PARTS.map((p) => {
      const g = partModel(world, p.id);
      g.position.set(p.x + 0.5, 0.02, p.z + 0.5);
      g.rotation.y = p.id * 1.7;
      const glow = makeGlow(0x9ad8ff, 1.1, 0.35);
      glow.position.set(0, 0.45, 0);
      g.add(glow);
      world.root.add(g);
      return { g, glow, p };
    });
    this.parts = [false, false, false];
    this.built = false;
    this.buildUntil = 0;
    this.buildSfx = 0;
    this.flashT = 0;
  }

  sync(gs) {
    const sh = gs.shield || { parts: [false, false, false], built: false };
    this.parts = sh.parts || [false, false, false];
    this.built = !!sh.built;
    this.buildUntil = sh.buildUntil || 0;
    for (let i = 0; i < 3; i++) {
      const got = !!this.parts[i];
      this.ground[i].g.visible = !got;
      this.benchParts[i].visible = got && !this.built;
    }
    if (this.shield) this.shield.visible = this.built;
  }

  onEvent(name, e) {
    if (name === 'part') {
      const gp = this.ground[e.id];
      if (gp) {
        sfx(this.ctx, 'part_pickup', gp.p.x + 0.5, 0.5, gp.p.z + 0.5);
        gp.g.visible = false;
      }
    } else if (name === 'built') {
      sfx(this.ctx, 'build', this.cx, 1.1, this.cz);
      _v.set(this.cx, 1.3, this.cz);
      fx(this.ctx, 'flash', _v.clone(), 0x9ad8ff, 1.8);
      this.flashT = 1;
    }
  }

  update(dt, t) {
    for (const gp of this.ground) {
      if (!gp.g.visible) continue;
      gp.glow.material.opacity = 0.25 + 0.2 * Math.sin(t * 3 + gp.p.id);
    }
    const building = !this.built && this.buildUntil && this.world.now() < this.buildUntil;
    if (building) {
      this.buildSfx -= dt;
      if (this.buildSfx <= 0) {
        this.buildSfx = 0.45;
        sfx(this.ctx, 'build', this.cx, 1.1, this.cz, { volume: 0.6 });
        _v.set(this.cx + (Math.random() - 0.5) * 0.8, 1.05, this.cz + (Math.random() - 0.5) * 0.4);
        fx(this.ctx, 'spark', _v.clone(), new THREE.Vector3(0, 1, 0));
      }
    }
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    const ready = this.parts.every(Boolean) && !this.built;
    this.glow.material.opacity = building ? 0.6 + 0.3 * Math.sin(t * 20) : ready ? 0.3 + 0.2 * Math.sin(t * 3) : this.flashT * 0.8;
  }
}
