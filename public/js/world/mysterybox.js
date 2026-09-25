// Caja misteriosa en sus 4 ubicaciones. Cada ubicación tiene un palé fijo; la caja aparece donde gs.box.slots
// no está 'off'. Estados: idle (cerrada, rayo azul), spinning (armas girando), ready (arma ofrecida),
// teddy (osito y la caja sale volando), arriving (cae del cielo).
import * as THREE from 'three';
import { BOX_LOCATIONS } from '/shared/map.js';
import { BOX } from '/shared/constants.js';
import { BOX_POOL } from '/shared/weapons.js';
import { StaticBatch, yawForFace, makeGlow, sfx, music, fx, easeInOut, TAU } from './kit.js';
import { boxTexture, boxEmissiveTexture, beamTexture } from './textures.js';
import { L } from './lighting.js';
import { createWeaponMesh, createTeddyMesh } from '../weapons/models.js';

const BW = 1.7, BH = 0.62, BD = 0.72;   // tamaño de la caja
const BASE_Y = 0.16;                    // altura del palé
const _v = new THREE.Vector3();

export class MysteryBoxes {
  constructor(world, B) {
    this.world = world;
    this.ctx = world.ctx;
    const tex = boxTexture();
    this.sideMat = world.mats.track(new THREE.MeshStandardMaterial({
      map: tex, emissive: 0xffffff, emissiveMap: boxEmissiveTexture(), emissiveIntensity: 0.6, roughness: 0.85,
    }));
    this.woodMat = world.mats.get('wood');
    this.beamMat = world.mats.track(new THREE.MeshBasicMaterial({
      map: beamTexture(), color: 0x6ab8ff, transparent: true, opacity: 0.55, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    }));
    this.weaponCache = new Map();
    this.poolKeys = BOX_POOL.map((b) => b.key);
    this.list = BOX_LOCATIONS.map((loc) => this._make(loc, B));
    this.loc = 0;
    this.firesale = false;
  }

  _make(loc, B) {
    const cx = (loc.x0 + loc.x1 + 1) / 2, cz = (loc.z0 + loc.z1 + 1) / 2;
    const yaw = yawForFace(loc.face);
    // Palé fijo
    const P = B.at(cx, 0, cz, yaw);
    for (const z of [-0.3, 0, 0.3]) P.box('wood', 1.9, 0.1, 0.12, 0, 0.05, z, { color: 0x6a5238 });
    for (let x = -0.85; x <= 0.86; x += 0.21) P.box('wood', 0.16, 0.05, 0.86, x, 0.13, 0, { color: 0x8a6a48 });
    P.cyl('bulb', 0.03, 0.03, 0.1, 0.85, 0.2, 0.35, { seg: 6 });   // vela

    const group = new THREE.Group();
    group.position.set(cx, 0, cz);
    group.rotation.y = yaw;
    this.world.root.add(group);

    // Caja (se mueve en conjunto al volar/caer)
    const box = new THREE.Group();
    box.position.y = BASE_Y;
    group.add(box);
    const body = new THREE.Group();
    box.add(body);
    const mk = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; body.add(m); return m; };
    // fondo y paredes (grosor 0.05)
    mk(new THREE.BoxGeometry(BW, 0.05, BD), this.woodMat, 0, 0.025, 0);
    const side = new THREE.PlaneGeometry(BW, BH);
    const end = new THREE.PlaneGeometry(BD, BH);
    mk(side, this.sideMat, 0, BH / 2, -BD / 2, Math.PI);   // frente (mira a -Z)
    mk(side, this.sideMat, 0, BH / 2, BD / 2, 0);
    mk(end, this.sideMat, -BW / 2, BH / 2, 0, -Math.PI / 2);
    mk(end, this.sideMat, BW / 2, BH / 2, 0, Math.PI / 2);
    // interior oscuro
    const inner = new THREE.Mesh(new THREE.BoxGeometry(BW - 0.06, BH - 0.04, BD - 0.06), new THREE.MeshBasicMaterial({ color: 0x050608, side: THREE.BackSide }));
    inner.position.y = BH / 2 + 0.02;
    body.add(inner);
    // esquineros metálicos
    const lb = new StaticBatch(this.world.mats);
    const Q = lb.at(0, 0, 0, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) Q.box('metal', 0.07, BH + 0.02, 0.07, sx * (BW / 2 - 0.02), BH / 2, sz * (BD / 2 - 0.02), { color: 0x4a4c52 });
    body.add(lb.toGroup({ shadows: true }));
    // tapa con bisagra en la parte trasera
    const lid = new THREE.Group();
    lid.position.set(0, BH, BD / 2);
    box.add(lid);
    const lidTop = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.04, 0.06, BD + 0.04), this.woodMat);
    lidTop.position.set(0, 0.03, -BD / 2);
    lidTop.castShadow = true;
    lid.add(lidTop);
    const lidSign = new THREE.Mesh(new THREE.PlaneGeometry(BW * 0.9, BD * 0.9), this.sideMat);
    lidSign.rotation.x = -Math.PI / 2;
    lidSign.position.set(0, 0.062, -BD / 2);
    lid.add(lidSign);

    // Luz azul interior y rayo hacia el cielo
    const innerGlow = makeGlow(0x6ab8ff, 1.8, 0);
    innerGlow.position.set(0, BH + 0.2, 0);
    box.add(innerGlow);
    const beam = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 40), this.beamMat);
      pl.position.y = 20;
      pl.rotation.y = i * Math.PI / 2;
      pl.renderOrder = 3;
      pl.userData.noShadow = true;
      beam.add(pl);
    }
    beam.position.y = BH;
    box.add(beam);

    // Arma / osito flotando
    const holder = new THREE.Group();
    holder.position.set(0, BH * 0.6, 0);
    box.add(holder);

    return {
      loc, cx, cz, yaw, group, box, lid, beam, innerGlow, holder,
      state: 'off', until: 0, weapon: null, user: null,
      lidK: 0, showKey: null, teddy: null, cycleT: 0, cycleIdx: 0, flyT: -1, arriveT: -1, fly: false,
    };
  }

  _weapon(key) {
    let m = this.weaponCache.get(key);
    if (!m) {
      try { m = createWeaponMesh(key, false); } catch (e) { m = new THREE.Group(); }
      m.rotation.y = Math.PI / 2;
      this.weaponCache.set(key, m);
    }
    return m;
  }

  _show(e, key) {
    if (e.showKey === key) return;
    e.holder.clear();
    e.showKey = key;
    if (!key) return;
    if (key === '__teddy') {
      if (!e.teddy) { try { e.teddy = createTeddyMesh(); e.teddy.scale.setScalar(1.6); } catch (err) { e.teddy = new THREE.Group(); } }
      e.holder.add(e.teddy);
      return;
    }
    // el mismo modelo puede estar en otra caja (liquidación): se clona para no robarlo
    const m = this._weapon(key);
    e.holder.add(m.parent ? m.clone() : m);
  }

  sync(gs, prev) {
    const box = gs.box;
    if (!box || !box.slots) return;
    this.loc = box.loc | 0;
    this.firesale = !!(gs.timers && gs.timers.firesale && gs.timers.firesale > (gs.now || 0));
    box.slots.forEach((s, i) => {
      const e = this.list[i];
      if (!e) return;
      const was = e.state;
      e.state = s.state;
      e.until = s.until || 0;
      e.user = s.user;
      e.weapon = s.weapon;
      if (was === 'spinning' && s.state === 'ready') {
        sfx(this.ctx, 'box_close', e.cx, 1, e.cz, { volume: 0.4 });
      }
      if ((was === 'ready' || was === 'spinning') && s.state === 'idle') {
        sfx(this.ctx, 'box_close', e.cx, 1, e.cz);
      }
      if (s.state === 'off' && was === 'teddy' && e.flyT < 0) e.flyT = 0;   // se va volando
      if (s.state === 'arriving' && was !== 'arriving') e.arriveT = prev ? 0 : -1;
      if (s.state !== 'arriving') e.arriveT = -1;
      if (s.state !== 'off') e.flyT = -1;
    });
  }

  onEvent(name, ev) {
    const e = this.list[ev.loc != null ? ev.loc : ev.from];
    if (name === 'boxOpen' && e) {
      sfx(this.ctx, 'box_open', e.cx, 1, e.cz);
      if (this.world._isSelf(ev.pid)) music(this.ctx, 'box');
      e.cycleT = 0;
    } else if (name === 'boxTeddy' && e) {
      sfx(this.ctx, 'teddy_laugh', e.cx, 1.2, e.cz);
    } else if (name === 'boxMove') {
      const from = this.list[ev.from];
      if (from) {
        from.flyT = 0;
        sfx(this.ctx, 'box_whoosh', from.cx, 2, from.cz);
      }
      const to = this.list[ev.to];
      if (to) to.arriveT = 0;
    }
  }

  update(dt, t) {
    const now = this.world.now();
    let lightBox = null;
    for (const e of this.list) {
      const st = e.state;
      const present = st !== 'off' || e.flyT >= 0;
      e.group.visible = true;
      e.box.visible = present;
      if (!present) { this._show(e, null); continue; }

      // Tapa
      const open = st === 'spinning' || st === 'ready' || st === 'teddy';
      e.lidK += ((open ? 1 : 0) - e.lidK) * Math.min(1, dt * 7);
      e.lid.rotation.x = e.lidK * 1.95;
      e.innerGlow.material.opacity = e.lidK * (0.7 + 0.3 * Math.sin(t * 9));

      // Contenido
      const left = e.until ? (e.until - now) / 1000 : 0;
      if (st === 'spinning') {
        const k = 1 - Math.max(0, Math.min(1, left / BOX.spinTime));
        e.cycleT += dt;
        const interval = 0.06 + 0.3 * k * k;          // cada vez más lento
        if (e.cycleT >= interval || !e.showKey) {
          e.cycleT = 0;
          e.cycleIdx = (e.cycleIdx + 1 + ((Math.random() * 3) | 0)) % this.poolKeys.length;
          this._show(e, this.poolKeys[e.cycleIdx]);
        }
        e.holder.position.y = BH * 0.6 + 0.65 * easeInOut(Math.min(1, k * 1.4));
        e.holder.rotation.set(0, 0, 0);
      } else if (st === 'ready') {
        this._show(e, e.weapon);
        const k = Math.max(0, Math.min(1, left / BOX.pickupTime));
        e.holder.position.y = BH * 0.6 + 0.65 * k;   // baja poco a poco hasta cerrarse
        e.holder.rotation.set(0, Math.sin(t * 1.5) * 0.15, 0);
      } else if (st === 'teddy') {
        this._show(e, '__teddy');
        e.holder.position.y = BH * 0.4 + 0.5;
        e.holder.rotation.set(0, Math.sin(t * 2) * 0.3, 0);
      } else {
        this._show(e, null);
      }

      // Movimiento de la caja: temblor con el osito, vuelo, llegada
      let y = BASE_Y, rz = 0, ry = 0;
      if (st === 'teddy') {
        const k = 1 - Math.max(0, Math.min(1, left / BOX.teddyTime));
        const shake = k > 0.3 ? (k - 0.3) * 0.12 : 0;
        rz = Math.sin(t * 40) * shake;
        if (k > 0.65) y += Math.pow((k - 0.65) / 0.35, 2) * 2.5;
      }
      if (e.flyT >= 0) {
        e.flyT += dt;
        const k = Math.min(1, e.flyT / 2.0);
        y = BASE_Y + 2.5 + k * k * 45;
        ry = k * TAU * 3;
        if (k >= 1) { e.flyT = -1; e.box.visible = false; }
      }
      if (st === 'arriving') {
        const k = e.arriveT >= 0 ? Math.max(0, Math.min(1, 1 - left / BOX.arriveTime)) : 1;
        y = BASE_Y + (1 - k) * (1 - k) * 40;
        ry = (1 - k) * TAU * 2;
        if (e.arriveT >= 0 && k >= 1) {
          e.arriveT = -1;
          sfx(this.ctx, 'box_close', e.cx, 0.5, e.cz);
          _v.set(e.cx, 0.3, e.cz);
          fx(this.ctx, 'dust', _v.clone(), new THREE.Vector3(0, 1, 0));
        }
      }
      e.box.position.y = y;
      e.box.rotation.set(0, ry, rz);

      // Rayo de luz: en la ubicación principal o durante la liquidación
      const main = this.list.indexOf(e) === this.loc;
      e.beam.visible = (main || this.firesale) && st !== 'teddy' && e.flyT < 0;
      if (e.beam.visible && main) lightBox = e;
    }
    this.beamMat.opacity = 0.4 + 0.12 * Math.sin(t * 2.2);

    // Luz azul de la caja principal
    const lights = this.world.lighting && this.world.lighting.points;
    const pl = lights && lights[L.BOX];
    if (pl) {
      if (lightBox) {
        pl.position.set(lightBox.cx, 1.3, lightBox.cz);
        pl.intensity = 3 + lightBox.lidK * (5 + 2 * Math.sin(t * 9));
      } else pl.intensity = 0;
    }
  }
}
