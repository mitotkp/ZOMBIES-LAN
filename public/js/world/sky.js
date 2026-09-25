// Cielo nocturno: cúpula con degradado, estrellas, luna con halo, nubes oscuras que se desplazan
// y balizas rojas lejanas (antena y chimenea) que atraviesan la niebla.
import * as THREE from 'three';
import { moonTexture, starTexture, glowTexture, makeRng } from './textures.js';

export const FOG_COLOR = 0x0c1522;
export const FOG_DENSITY = 0.022;
// Dirección hacia la luna (este, algo al norte, 35° de elevación): coincide con la luz direccional
export const MOON_DIR = new THREE.Vector3(0.79, 0.57, -0.2).normalize();

const R = 190;

export class Sky {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'sky';
    this.beacons = [];
    this.clouds = [];
    this._t = 0;
    this._build();
  }

  _build() {
    const rng = makeRng(777);
    // Cúpula con degradado por vértice (horizonte = color de la niebla)
    const geo = new THREE.SphereGeometry(R, 32, 18);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const cHor = new THREE.Color(FOG_COLOR), cMid = new THREE.Color(0x0a1628), cTop = new THREE.Color(0x02050c);
    const cGlow = new THREE.Color(0x1a2436), tmp = new THREE.Color();
    const moon = MOON_DIR;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / R, y = pos.getY(i) / R, z = pos.getZ(i) / R;
      if (y <= 0.02) tmp.copy(cHor);
      else if (y < 0.3) tmp.copy(cHor).lerp(cMid, (y - 0.02) / 0.28);
      else tmp.copy(cMid).lerp(cTop, Math.min(1, (y - 0.3) / 0.7));
      // resplandor alrededor de la luna
      const dm = x * moon.x + y * moon.y + z * moon.z;
      if (dm > 0.75) tmp.lerp(cGlow, Math.pow((dm - 0.75) / 0.25, 2) * 0.8);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);

    // Estrellas (dos capas con parpadeo desfasado)
    for (let layer = 0; layer < 2; layer++) {
      const n = 520;
      const p = new Float32Array(n * 3), c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const az = rng() * Math.PI * 2;
        const el = Math.asin(0.12 + rng() * 0.88);
        const r = R * 0.95;
        p[i * 3] = Math.cos(el) * Math.cos(az) * r;
        p[i * 3 + 1] = Math.sin(el) * r;
        p[i * 3 + 2] = Math.cos(el) * Math.sin(az) * r;
        const b = 0.35 + Math.pow(rng(), 3) * 0.65;
        const warm = rng();
        c[i * 3] = b * (warm < 0.2 ? 1 : 0.85); c[i * 3 + 1] = b * 0.9; c[i * 3 + 2] = b * (warm > 0.8 ? 1 : 0.95);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      const m = new THREE.PointsMaterial({
        size: layer ? 2.6 : 1.7, sizeAttenuation: false, map: starTexture(), vertexColors: true,
        transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(g, m);
      pts.renderOrder = -9;
      pts.frustumCulled = false;
      this.group.add(pts);
      if (layer) this.twinkle = m; else this.stars = m;
    }

    // Luna y halo
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0x7f98c8, transparent: true, opacity: 0.55, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    }));
    halo.position.copy(MOON_DIR).multiplyScalar(R * 0.9);
    halo.scale.set(80, 80, 1);
    halo.renderOrder = -8;
    this.group.add(halo);
    const moonSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), color: 0xe6ecf8, transparent: true, depthWrite: false, fog: false }));
    moonSpr.position.copy(MOON_DIR).multiplyScalar(R * 0.88);
    moonSpr.scale.set(15, 15, 1);
    moonSpr.renderOrder = -7;
    this.group.add(moonSpr);

    // Nubes oscuras que tapan estrellas y luna al pasar
    for (let i = 0; i < 9; i++) {
      const m = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x101722, transparent: true, opacity: 0.55 + rng() * 0.3, depthWrite: false, fog: false });
      const s = new THREE.Sprite(m);
      const cl = { sprite: s, az: rng() * Math.PI * 2, el: 0.2 + rng() * 0.6, speed: 0.004 + rng() * 0.006, size: 70 + rng() * 60 };
      s.scale.set(cl.size * 1.8, cl.size * 0.7, 1);
      s.renderOrder = -6;
      this.group.add(s);
      this.clouds.push(cl);
    }
    this._placeClouds();

    // Balizas rojas en el mundo (no siguen a la cámara)
    this.beaconGroup = new THREE.Group();
    this.beaconGroup.name = 'beacons';
    for (const [x, y, z, ph] of [[30, 44.4, -34, 0], [-9, 34.6, 14, 1.3], [84, 31, -6, 0.6]]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xff2a1a, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      }));
      s.position.set(x, y, z);
      s.scale.set(3, 3, 1);
      this.beaconGroup.add(s);
      this.beacons.push({ sprite: s, ph });
    }
  }

  _placeClouds() {
    for (const c of this.clouds) {
      const r = R * 0.8;
      c.sprite.position.set(Math.cos(c.el) * Math.cos(c.az) * r, Math.sin(c.el) * r, Math.cos(c.el) * Math.sin(c.az) * r);
    }
  }

  addTo(scene) {
    scene.add(this.group);
    scene.add(this.beaconGroup);
  }

  update(dt, camera) {
    this._t += dt;
    if (camera) this.group.position.copy(camera.position);
    for (const c of this.clouds) c.az += c.speed * dt;
    this._placeClouds();
    if (this.twinkle) this.twinkle.opacity = 0.75 + 0.25 * Math.sin(this._t * 1.7);
    if (this.stars) this.stars.opacity = 0.85 + 0.15 * Math.sin(this._t * 2.3 + 1);
    for (const b of this.beacons) {
      const k = (this._t * 0.8 + b.ph) % 1;
      b.sprite.material.opacity = k < 0.45 ? 1 : 0.12;
    }
  }
}

export default Sky;
