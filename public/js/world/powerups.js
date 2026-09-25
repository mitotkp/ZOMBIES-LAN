// Potenciadores en el suelo (gs.powerups): símbolo verde brillante que gira y flota, con halo;
// parpadea cuando le quedan POWERUPS.blinkAt segundos. Se crean y destruyen según gs (idempotente).
import * as THREE from 'three';
import { POWERUPS } from '/shared/constants.js';
import { StaticBatch, makeGlow, makePool, sfx, fx } from './kit.js';
import { makeSign } from './textures.js';

const GREEN = 0x5cff6a;
const _v = new THREE.Vector3();

export class Powerups {
  constructor(world) {
    this.world = world;
    this.ctx = world.ctx;
    this.name = 'powerups';
    this.items = new Map();   // id -> { group, spin, until, type }
    this.models = new Map();  // type -> prototipo
    this.mat = world.mats.track(new THREE.MeshStandardMaterial({
      color: 0x1a4a20, emissive: GREEN, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.3,
    }));
  }

  _proto(type) {
    let m = this.models.get(type);
    if (m) return m;
    const lb = new StaticBatch(this.world.mats);
    const P = lb.at(0, 0, 0, 0);
    let text = null;
    switch (type) {
      case 'maxammo':
        P.box('plastic', 0.42, 0.26, 0.24, 0, 0, 0, {});
        P.box('plastic', 0.2, 0.06, 0.06, 0, 0.16, 0, {});
        for (let i = 0; i < 4; i++) P.cyl('plastic', 0.025, 0.025, 0.16, -0.12 + i * 0.08, 0.24, 0, { seg: 6 });
        break;
      case 'instakill':
        P.sphere('plastic', 0.18, 0, 0.05, 0, { seg: 12 });
        P.box('plastic', 0.2, 0.12, 0.16, 0, -0.12, 0.01, {});
        text = null;
        break;
      case 'doublepoints':
        text = 'x2';
        break;
      case 'nuke':
        P.sphere('plastic', 0.17, 0, 0, 0, { seg: 12, sy: 1.3 });
        for (let k = 0; k < 4; k++) P.box('plastic', 0.02, 0.14, 0.14, 0, -0.24, 0, { ry: k * Math.PI / 4 });
        break;
      case 'carpenter':
        P.box('plastic', 0.05, 0.42, 0.05, 0, -0.05, 0, {});
        P.box('plastic', 0.3, 0.08, 0.08, 0, 0.18, 0, {});
        P.box('plastic', 0.08, 0.1, 0.08, 0.13, 0.12, 0, { rz: 0.4 });
        break;
      case 'firesale':
        text = '$';
        break;
      default:
        P.sphere('plastic', 0.18, 0, 0, 0, { seg: 10 });
    }
    m = lb.isEmpty() ? new THREE.Group() : lb.toGroup({ shadows: false });
    m.traverse((o) => { if (o.isMesh) o.material = this.mat; });
    if (type === 'instakill') {
      // ojos de la calavera
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x031006 });
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeMat);
        eye.position.set(s * 0.07, 0.07, -0.15);
        m.add(eye);
      }
    }
    if (text) {
      const tex = makeSign({
        w: 256, h: 256, bg: null, grime: 0, emissive: true,
        lines: [{ text, size: 0.75, y: 0.52, color: '#b8ffbf', glow: '#3fff6a', font: '"Arial Black", Impact, sans-serif' }],
      });
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), mat);
      m.add(pl);
    }
    this.models.set(type, m);
    return m;
  }

  _add(pu, live) {
    const group = new THREE.Group();
    group.position.set(pu.x, 0, pu.z);
    const spin = new THREE.Group();
    spin.position.y = 0.75;
    spin.add(this._proto(pu.type).clone());
    group.add(spin);
    const glow = makeGlow(GREEN, 1.6, 0.8);
    glow.position.y = 0.75;
    group.add(glow);
    const pool = makePool(GREEN, 1.8, 0.35);
    pool.position.y = 0.03;
    group.add(pool);
    this.world.root.add(group);
    const it = { group, spin, glow, pool, until: pu.until || 0, type: pu.type, born: this.world.time, seed: Math.random() * 6 };
    this.items.set(pu.id, it);
    if (live) {
      _v.set(pu.x, 0.8, pu.z);
      fx(this.ctx, 'flash', _v.clone(), GREEN, 1.6);
    }
    return it;
  }

  _remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.world.root.remove(it.group);
    this.items.delete(id);
  }

  sync(gs, prev, live) {
    const list = gs.powerups || [];
    const seen = new Set();
    for (const pu of list) {
      seen.add(pu.id);
      const it = this.items.get(pu.id);
      if (it) it.until = pu.until || it.until;
      else this._add(pu, live);
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this._remove(id);
  }

  onEvent(name, e) {
    if (name === 'puSpawn') {
      sfx(this.ctx, 'powerup_spawn', e.x, 0.8, e.z);
      if (!this.items.has(e.id)) this._add({ id: e.id, type: e.type, x: e.x, z: e.z, until: 0 }, true);
    } else if (name === 'pu') {
      // quitar el que se recogió (el gs llegará después)
      for (const [id, it] of this.items) {
        if (it.type === e.type && Math.abs(it.group.position.x - e.x) < 0.2 && Math.abs(it.group.position.z - e.z) < 0.2) {
          _v.set(e.x, 0.8, e.z);
          fx(this.ctx, 'flash', _v.clone(), GREEN, 2.4);
          this._remove(id);
          break;
        }
      }
    }
  }

  update(dt, t) {
    const now = this.world.now();
    for (const it of this.items.values()) {
      it.spin.rotation.y += dt * 1.8;
      it.spin.position.y = 0.75 + Math.sin(t * 2.4 + it.seed) * 0.08;
      it.glow.position.y = it.spin.position.y;
      it.glow.material.opacity = 0.6 + 0.2 * Math.sin(t * 5 + it.seed);
      // parpadeo al final
      let vis = true;
      if (it.until) {
        const left = (it.until - now) / 1000;
        if (left < POWERUPS.blinkAt) {
          const rate = left < 3 ? 8 : 4;
          vis = Math.sin(t * rate * Math.PI) > -0.3;
        }
      }
      it.group.visible = vis;
    }
  }
}

export default Powerups;
