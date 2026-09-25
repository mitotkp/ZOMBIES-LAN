// Proyectiles simulados en el cliente: Ray Gun (verde / rojo mejorado), Mustang & Sally, War Machine
// (con gravedad, rebotes y mecha) y granadas de fragmentación con física simple.
// Solo el dueño del proyectil avisa al servidor del impacto ('boom'); los de otros jugadores son solo visuales.
// Las explosiones las dibuja Effects al recibir ev:boom.
import * as THREE from 'three';
import { weaponDef } from '/shared/weapons.js';
import { GRENADE } from '/shared/constants.js';
import { raycastMap, rayZombie } from '/shared/collision.js';
import { createGrenadeMesh, getGlowTexture } from './models.js';

const NADE_GRAVITY = 12;
const r2 = (v) => Math.round(v * 100) / 100;

function toVec(v, out = new THREE.Vector3()) {
  if (!v) return null;
  if (Array.isArray(v)) return out.set(+v[0] || 0, +v[1] || 0, +v[2] || 0);
  if (typeof v.x === 'number') return out.set(v.x, v.y || 0, v.z || 0);
  return null;
}

// Conjunto de partículas aditivas para las estelas (un único objeto Points por tamaño)
class TrailPool {
  constructor(parent, size, capacity) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.base = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.max = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) this.pos[i * 3 + 1] = -500;
    this.cursor = 0;
    this.alive = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    this.mat = new THREE.PointsMaterial({
      size, map: getGlowTexture(), vertexColors: true, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, sizeAttenuation: true, toneMapped: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    parent.add(this.points);
  }

  emit(x, y, z, color, life, drift = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.base[j] = color.r; this.base[j + 1] = color.g; this.base[j + 2] = color.b;
    this.vel[j] = (Math.random() - 0.5) * drift;
    this.vel[j + 1] = (Math.random() * 0.6 + 0.2) * drift;
    this.vel[j + 2] = (Math.random() - 0.5) * drift;
    this.life[i] = life;
    this.max[i] = life;
    this.alive = Math.min(this.cap, this.alive + 1);
  }

  update(dt) {
    if (!this.alive) return;
    let any = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      const j = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.col[j] = this.col[j + 1] = this.col[j + 2] = 0;
        this.pos[j + 1] = -500;
        continue;
      }
      any++;
      const f = this.life[i] / this.max[i];
      const k = f * f;
      this.col[j] = this.base[j] * k; this.col[j + 1] = this.base[j + 1] * k; this.col[j + 2] = this.base[j + 2] * k;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
    }
    this.alive = any;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.col.fill(0);
    for (let i = 0; i < this.cap; i++) this.pos[i * 3 + 1] = -500;
    this.alive = 0;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}

export class Projectiles {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.onBoom = null; // (info) => void  — lo asigna WeaponSystem para enviar 'boom'
    this.group = new THREE.Group();
    this.group.name = 'projectiles';
    if (ctx && ctx.scene) ctx.scene.add(this.group);
    this.glowTrail = new TrailPool(this.group, 0.16, 900);
    this.smokeTrail = new TrailPool(this.group, 0.11, 500);
    this._mats = new Map();
    this._coreGeo = new THREE.SphereGeometry(1, 10, 8);
    this._shellGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.07, 10);
    this._shellGeo.rotateX(-Math.PI / 2);
    this._noseGeo = new THREE.SphereGeometry(0.02, 10, 8);
    this._col = new THREE.Color();
    this._v = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._prev = new THREE.Vector3();
    this._targets = null;
  }

  get count() { return this.list.length; }

  _basicMat(color) {
    const k = `b${color}`;
    let m = this._mats.get(k);
    if (!m) { m = new THREE.MeshBasicMaterial({ color, toneMapped: false }); this._mats.set(k, m); }
    return m;
  }
  _haloMat(color) {
    const k = `h${color}`;
    let m = this._mats.get(k);
    if (!m) {
      m = new THREE.SpriteMaterial({
        map: getGlowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
      });
      this._mats.set(k, m);
    }
    return m;
  }
  _stdMat(color) {
    const k = `s${color}`;
    let m = this._mats.get(k);
    if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.5 }); this._mats.set(k, m); }
    return m;
  }

  // Lanza un proyectil de arma. o y d: [x,y,z] o Vector3. owner = true si es del jugador local.
  spawnProjectile({ w, up = false, o, d, owner = false, def = null } = {}) {
    const wd = def || weaponDef(w, !!up);
    const pr = wd && wd.projectile;
    if (!pr) return null;
    const pos = toVec(o);
    const dir = toVec(d);
    if (!pos || !dir || dir.lengthSq() < 1e-8) return null;
    dir.normalize();
    const style = pr.bounce || w === 'warmachine' ? 'shell' : (w === 'm1911' ? 'ms' : 'ray');
    const p = {
      kind: 'proj', w, up: !!up, owner: !!owner, style,
      pos, vel: dir.clone().multiplyScalar(pr.speed), gravity: pr.gravity || 0,
      bounce: !!pr.bounce, restitution: 0.45, friction: 0.7,
      fuse: pr.fuse || 0, age: 0, maxAge: pr.fuse ? pr.fuse + 1 : 3.5,
      radius: Math.max(0.03, pr.size || 0.08), color: pr.color || 0xffffff,
      done: false, resting: false, emitAcc: 0, bounceSndAt: -1,
    };
    const obj = new THREE.Group();
    if (style === 'shell') {
      const shell = new THREE.Mesh(this._shellGeo, this._stdMat(0x4a5534));
      const nose = new THREE.Mesh(this._noseGeo, this._stdMat(0xb89a3a));
      nose.position.z = -0.035;
      obj.add(shell, nose);
      const halo = new THREE.Sprite(this._haloMat(0xff9040));
      halo.scale.setScalar(0.12);
      halo.position.z = 0.04;
      obj.add(halo);
      p.halo = halo;
      p.trailColor = new THREE.Color(0x6a4a30);
    } else {
      const coreColor = style === 'ms' ? 0xffd2a0 : 0xffffff;
      const core = new THREE.Mesh(this._coreGeo, this._basicMat(coreColor));
      const r = p.radius * (style === 'ms' ? 0.45 : 0.5);
      core.scale.set(r, r, r * (style === 'ms' ? 2.2 : 3.2));
      const glowCore = new THREE.Mesh(this._coreGeo, this._basicMat(p.color));
      glowCore.scale.set(r * 1.5, r * 1.5, r * 4.2);
      obj.add(glowCore, core);
      const halo = new THREE.Sprite(this._haloMat(p.color));
      halo.scale.setScalar(p.radius * (style === 'ms' ? 6 : 8));
      obj.add(halo);
      p.halo = halo;
      p.trailColor = new THREE.Color(p.color);
    }
    obj.traverse((m) => { m.frustumCulled = false; });
    obj.position.copy(pos);
    this.group.add(obj);
    p.obj = obj;
    this._orient(p);
    this.list.push(p);
    return p;
  }

  // Lanza una granada de fragmentación. v: velocidad inicial [vx,vy,vz].
  spawnGrenade({ o, v, owner = false, fuse = GRENADE.fuse } = {}) {
    const pos = toVec(o);
    const vel = toVec(v);
    if (!pos || !vel) return null;
    const p = {
      kind: 'nade', w: 'frag', up: false, owner: !!owner, style: 'nade',
      pos, vel, gravity: NADE_GRAVITY, bounce: true, restitution: GRENADE.bounce, friction: GRENADE.friction,
      fuse, age: 0, maxAge: fuse + 1, radius: 0.04, color: 0x333333,
      done: false, resting: false, emitAcc: 0, bounceSndAt: -1,
      spin: new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 18),
    };
    const obj = new THREE.Group();
    const mesh = createGrenadeMesh();
    obj.add(mesh);
    const blink = new THREE.Sprite(this._haloMat(0xff2a1a));
    blink.scale.setScalar(0.12);
    blink.position.y = 0.05;
    obj.add(blink);
    p.blink = blink;
    p.mesh = mesh;
    p.trailColor = new THREE.Color(0x2a2016);
    obj.traverse((m) => { m.frustumCulled = false; });
    obj.position.copy(pos);
    this.group.add(obj);
    p.obj = obj;
    this.list.push(p);
    return p;
  }

  update(dt) {
    if (!(dt > 0)) dt = 0;
    const doors = (this.ctx && this.ctx.gs && this.ctx.gs.doors) || {};
    this._targets = null;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      if (p.done) continue;
      p.age += dt;
      if (p.fuse > 0 && p.age >= p.fuse) { this._explode(p, null); continue; }
      if (p.age >= p.maxAge) { this._finish(p); continue; }
      this._prev.copy(p.pos);
      // sub-pasos para no atravesar paredes a gran velocidad
      let rem = dt;
      let guard = 0;
      while (rem > 1e-6 && !p.done && guard++ < 8) {
        const speed = p.vel.length();
        const h = Math.min(rem, 0.5 / Math.max(1, speed), 1 / 60);
        this._step(p, h, doors);
        rem -= h;
      }
      if (p.done) continue;
      this._visuals(p, dt);
    }
    // limpiar terminados
    if (this.list.some((p) => p.done)) this.list = this.list.filter((p) => !p.done);
    this.glowTrail.update(dt);
    this.smokeTrail.update(dt);
  }

  _getTargets() {
    if (this._targets) return this._targets;
    let t = [];
    try {
      const ents = this.ctx && this.ctx.entities;
      if (ents && typeof ents.getZombieTargets === 'function') t = ents.getZombieTargets() || [];
    } catch (e) { t = []; }
    this._targets = Array.isArray(t) ? t : [];
    return this._targets;
  }

  _step(p, h, doors) {
    if (p.resting) return;
    p.vel.y -= p.gravity * h;
    const sx = p.vel.x * h, sy = p.vel.y * h, sz = p.vel.z * h;
    const len = Math.hypot(sx, sy, sz);
    if (len < 1e-7) return;
    const dx = sx / len, dy = sy / len, dz = sz / len;
    const hit = raycastMap(p.pos.x, p.pos.y, p.pos.z, dx, dy, dz, len + p.radius * 0.5, doors);
    const mapT = hit ? hit.dist : Infinity;
    // impacto directo contra zombis (las granadas de mano los atraviesan)
    if (p.kind === 'proj') {
      let best = null;
      for (const z of this._getTargets()) {
        if (!z) continue;
        const r = rayZombie(p.pos.x, p.pos.y, p.pos.z, dx, dy, dz, z);
        if (r && r.t <= len && r.t < mapT && (!best || r.t < best.t)) best = { id: z.id, t: r.t };
      }
      if (best) {
        p.pos.set(p.pos.x + dx * best.t, p.pos.y + dy * best.t, p.pos.z + dz * best.t);
        this._explode(p, best.id);
        return;
      }
    }
    if (hit && hit.dist <= len + p.radius * 0.5) {
      const n = this._n.set(hit.nx, hit.ny, hit.nz);
      if (p.bounce) {
        // rebote: invertir la componente normal y frenar la tangencial
        const off = Math.max(0.01, p.radius);
        p.pos.set(hit.x + n.x * off, hit.y + n.y * off, hit.z + n.z * off);
        const vn = p.vel.dot(n);
        if (vn < 0) {
          const vnx = n.x * vn, vny = n.y * vn, vnz = n.z * vn;
          const tx = p.vel.x - vnx, ty = p.vel.y - vny, tz = p.vel.z - vnz;
          p.vel.set(tx * p.friction - vnx * p.restitution, ty * p.friction - vny * p.restitution, tz * p.friction - vnz * p.restitution);
          if (-vn > 1.5 && p.age - p.bounceSndAt > 0.12) {
            p.bounceSndAt = p.age;
            this._sound('grenade_bounce', p.pos, Math.min(1, -vn / 8));
          }
          if (p.spin) p.spin.multiplyScalar(0.6);
        }
        if (n.y > 0.7 && p.vel.length() < 0.7) {
          p.vel.set(0, 0, 0);
          p.resting = true;
          p.pos.y = Math.max(p.pos.y, p.radius);
        }
      } else {
        p.pos.set(hit.x + n.x * 0.05, hit.y + n.y * 0.05, hit.z + n.z * 0.05);
        this._explode(p, null);
      }
      return;
    }
    p.pos.x += sx; p.pos.y += sy; p.pos.z += sz;
    // rodar por el suelo con rozamiento
    if (p.bounce && p.pos.y <= p.radius + 0.03 && Math.abs(p.vel.y) < 0.8) {
      const k = Math.exp(-2.8 * h);
      p.vel.x *= k; p.vel.z *= k;
      if (p.pos.y < p.radius) p.pos.y = p.radius;
      if (Math.hypot(p.vel.x, p.vel.z) < 0.15 && Math.abs(p.vel.y) < 0.3) { p.vel.set(0, 0, 0); p.resting = true; }
    }
  }

  _orient(p) {
    if (!p.obj || p.kind !== 'proj') return;
    const v = p.vel;
    if (v.lengthSq() < 1e-6) return;
    this._v.copy(p.pos).sub(v);
    p.obj.lookAt(this._v); // +Z hacia atrás => el frente (-Z) mira hacia la velocidad
  }

  _visuals(p, dt) {
    p.obj.position.copy(p.pos);
    if (p.kind === 'nade') {
      if (!p.resting) {
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.y += p.spin.y * dt;
        p.mesh.rotation.z += p.spin.z * dt;
      }
      // luz parpadeante que acelera al final de la mecha
      const left = Math.max(0, p.fuse - p.age);
      const rate = left < 0.8 ? 16 : 6;
      p.blink.visible = Math.sin(p.age * rate * Math.PI) > 0;
    } else {
      this._orient(p);
      if (p.halo) {
        const base = p.style === 'shell' ? 0.12 : p.radius * (p.style === 'ms' ? 6 : 8);
        p.halo.scale.setScalar(base * (0.85 + Math.random() * 0.3));
      }
    }
    // estela
    const dist = this._prev.distanceTo(p.pos);
    if (dist < 1e-4) return;
    const spacing = p.style === 'ray' ? 0.09 : p.style === 'ms' ? 0.11 : 0.16;
    p.emitAcc += dist;
    const n = Math.min(12, Math.floor(p.emitAcc / spacing));
    if (n <= 0) return;
    p.emitAcc -= n * spacing;
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n;
      const x = this._prev.x + (p.pos.x - this._prev.x) * f;
      const y = this._prev.y + (p.pos.y - this._prev.y) * f;
      const z = this._prev.z + (p.pos.z - this._prev.z) * f;
      if (p.style === 'ray') {
        this.glowTrail.emit(x, y, z, p.trailColor, 0.26, 0.2);
      } else if (p.style === 'ms') {
        this.glowTrail.emit(x, y, z, p.trailColor, 0.18, 0.1);
        this.smokeTrail.emit(x, y, z, this._col.setHex(0x3a2a20), 0.45, 0.5);
      } else if (p.style === 'shell') {
        this.smokeTrail.emit(x, y, z, p.trailColor, 0.5, 0.4);
      } else {
        this.smokeTrail.emit(x, y, z, p.trailColor, 0.3, 0.2);
      }
    }
  }

  _sound(name, pos, volume = 1) {
    const a = this.ctx && this.ctx.audio;
    if (!a || typeof a.play !== 'function') return;
    try { a.play(name, { pos: pos.clone(), volume }); } catch (e) { /* audio opcional */ }
  }

  // Impacto o fin de la mecha: solo el dueño avisa al servidor
  _explode(p, directId) {
    if (p.done) return;
    const y = Math.max(0.05, p.pos.y);
    if (p.owner && typeof this.onBoom === 'function') {
      try {
        this.onBoom({
          w: p.kind === 'nade' ? 'frag' : p.w,
          up: p.kind === 'nade' ? false : p.up,
          p: [r2(p.pos.x), r2(y), r2(p.pos.z)],
          direct: directId === undefined ? null : directId,
          kind: p.kind,
        });
      } catch (e) { console.error('[projectiles] onBoom', e); }
    }
    this._finish(p);
  }

  _finish(p) {
    p.done = true;
    if (p.obj && p.obj.parent) p.obj.parent.remove(p.obj);
  }

  clear() {
    for (const p of this.list) this._finish(p);
    this.list = [];
    this.glowTrail.clear();
    this.smokeTrail.clear();
  }
}

export default Projectiles;
