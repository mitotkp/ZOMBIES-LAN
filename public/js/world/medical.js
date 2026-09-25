// Curas en el mundo: armarios de primeros auxilios en la pared (venden vendas, antídotos o botiquines)
// y curas en el suelo que sueltan los zombis (gs.items), que se recogen pasando por encima.
import * as THREE from 'three';
import { MED_CABINETS, INTERACTABLE_BY_ID } from '/shared/map.js';
import { MEDS, MED_DROPS } from '/shared/constants.js';
import { StaticBatch, yawForFace, makeGlow, makePool, sfx } from './kit.js';
import { makeSign } from './textures.js';

const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
const BLINK_AT = 8;   // segundos finales en los que parpadean

// ---------------------------------------------------------------------------------------------
// Armarios de primeros auxilios
export class MedCabinets {
  constructor(world, B) {
    this.world = world;
    this.ctx = world.ctx;
    this.glows = [];
    for (const mc of MED_CABINETS) {
      const it = INTERACTABLE_BY_ID['med:' + mc.item];
      const def = MEDS[mc.item];
      if (!it || !def) continue;
      const yaw = yawForFace(OPP[mc.wall]);
      // caja metálica blanca con puerta y bisagras (estática)
      const P = B.at(it.wx, 0, it.wz, yaw);
      P.box('metal', 0.7, 0.8, 0.2, 0, 1.45, -0.1, { color: 0xdcdcd4 });
      P.box('metal', 0.66, 0.76, 0.02, 0, 1.45, -0.205, { color: 0xeeeee6 });
      P.box('metal', 0.03, 0.12, 0.03, 0.27, 1.45, -0.225, { color: 0x6a6a6a });
      for (const y of [1.2, 1.7]) P.box('metal', 0.03, 0.06, 0.03, -0.33, y, -0.21, { color: 0x6a6a6a });
      P.box('rust', 0.25, 0.2, 0.004, -0.15, 1.2, -0.217, {});
      // cartel con la cruz y el precio (emisivo tenue, se ve a oscuras)
      const tex = makeSign({
        w: 256, h: 256, bg: '#f2f0e8', border: '#b01414', grime: 0.35, seed: 90 + mc.id, emissive: true,
        lines: [
          { text: '+', size: 0.78, y: 0.4, color: '#d01818', font: '"Arial Black", Impact, sans-serif' },
          { text: def.plural.toUpperCase(), size: 0.13, y: 0.76, color: '#1a1a1a' },
          { text: String(def.price), size: 0.12, y: 0.9, color: '#b01414' },
        ],
      });
      const mat = new THREE.MeshLambertMaterial({
        map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), mat);
      sign.userData.noShadow = true;
      const g = new THREE.Group();
      g.position.set(it.wx, 0, it.wz);
      g.rotation.y = yaw;
      sign.position.set(0, 1.5, -0.218);
      sign.rotation.y = Math.PI;
      g.add(sign);
      const glow = makeGlow(0xff4a3a, 1.2, 0.25);
      glow.position.set(0, 1.5, -0.4);
      g.add(glow);
      this.glows.push({ glow, seed: mc.id * 1.7 });
      world.root.add(g);
    }
  }

  update(dt, t) {
    for (const g of this.glows) g.glow.material.opacity = 0.18 + 0.1 * Math.sin(t * 2 + g.seed);
  }
}

// ---------------------------------------------------------------------------------------------
// Curas en el suelo
function itemModel(world, type) {
  const lb = new StaticBatch(world.mats);
  const P = lb.at(0, 0, 0, 0);
  if (type === 'bandage') {
    P.cyl('tarp', 0.09, 0.09, 0.1, 0, 0, 0, { rz: Math.PI / 2, seg: 14, color: 0xf2eee2 });
    P.box('tarp', 0.1, 0.004, 0.18, 0, -0.07, 0.12, { color: 0xe8e2d0, rx: 0.3 });
  } else if (type === 'antidote') {
    P.cyl('glass', 0.045, 0.045, 0.2, 0, 0, 0, { seg: 10, color: 0x39c46a });
    P.cyl('plastic', 0.03, 0.03, 0.05, 0, 0.125, 0, { seg: 8, color: 0xdcdcdc });
    P.cyl('metal', 0.006, 0.006, 0.08, 0, 0.19, 0, { seg: 4, color: 0xc0c0c0 });
  } else {
    P.box('plastic', 0.34, 0.22, 0.12, 0, 0, 0, { color: 0xd8262a });
    P.box('plastic', 0.12, 0.04, 0.02, 0, 0.13, 0, { color: 0x2a2a2a });
    P.box('plastic', 0.18, 0.05, 0.005, 0, 0, -0.063, { color: 0xffffff });
    P.box('plastic', 0.05, 0.16, 0.005, 0, 0, -0.063, { color: 0xffffff });
    P.box('plastic', 0.18, 0.05, 0.005, 0, 0, 0.063, { color: 0xffffff });
    P.box('plastic', 0.05, 0.16, 0.005, 0, 0, 0.063, { color: 0xffffff });
  }
  return lb.toGroup({ shadows: false });
}

export class MedItems {
  constructor(world) {
    this.world = world;
    this.ctx = world.ctx;
    this.name = 'meditems';
    this.items = new Map();
    this.protos = new Map();
  }

  _proto(type) {
    let m = this.protos.get(type);
    if (!m) { m = itemModel(this.world, type); this.protos.set(type, m); }
    return m;
  }

  _add(it) {
    const def = MEDS[it.type];
    if (!def) return;
    const group = new THREE.Group();
    group.position.set(it.x, 0, it.z);
    const spin = new THREE.Group();
    spin.position.y = 0.45;
    spin.add(this._proto(it.type).clone());
    group.add(spin);
    const color = new THREE.Color(def.color);
    const glow = makeGlow(color.getHex(), 1.0, 0.55);
    glow.position.y = 0.45;
    group.add(glow);
    const pool = makePool(color.getHex(), 1.2, 0.3);
    pool.position.y = 0.03;
    group.add(pool);
    this.world.root.add(group);
    this.items.set(it.id, { group, spin, glow, until: it.until || 0, seed: Math.random() * 6 });
  }

  _remove(id) {
    const e = this.items.get(id);
    if (!e) return;
    this.world.root.remove(e.group);
    this.items.delete(id);
  }

  sync(gs) {
    const list = gs.items || [];
    const seen = new Set();
    for (const it of list) {
      seen.add(it.id);
      const e = this.items.get(it.id);
      if (e) e.until = it.until || e.until;
      else this._add(it);
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this._remove(id);
  }

  onEvent(name, e) {
    if (name === 'itemSpawn') {
      if (!this.items.has(e.id)) this._add({ ...e, until: Date.now() + MED_DROPS.lifetime * 1000 });
    } else if (name === 'itemPick') {
      sfx(this.ctx, 'part_pickup', e.x, 0.5, e.z, { volume: 0.8 });
      this._remove(e.id);
    }
  }

  update(dt, t) {
    const now = this.world.now();
    for (const e of this.items.values()) {
      e.spin.rotation.y += dt * 1.5;
      e.spin.position.y = 0.45 + Math.sin(t * 2.2 + e.seed) * 0.06;
      e.glow.position.y = e.spin.position.y;
      let vis = true;
      if (e.until) {
        const left = (e.until - now) / 1000;
        if (left < BLINK_AT) vis = Math.sin(t * (left < 3 ? 8 : 4) * Math.PI) > -0.3;
      }
      e.group.visible = vis;
    }
  }
}
