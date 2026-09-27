// Efectos pasajeros de las habilidades de los jefes del Castillo: la nube de murciélagos del Conde y la descarga
// eléctrica del Doctor Vorkhaus. Geometrías y materiales compartidos; cada efecto vive menos de dos segundos.
import * as THREE from 'three';
import { glowTexture } from './procgen.js';

let _batTex = null;
function batTexture() {
  if (_batTex) return _batTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(32, 12);
  g.quadraticCurveTo(22, 2, 4, 6);
  g.quadraticCurveTo(10, 12, 8, 20);
  g.quadraticCurveTo(14, 16, 18, 22);
  g.quadraticCurveTo(24, 17, 28, 24);
  g.lineTo(32, 20);
  g.lineTo(36, 24);
  g.quadraticCurveTo(40, 17, 46, 22);
  g.quadraticCurveTo(50, 16, 56, 20);
  g.quadraticCurveTo(54, 12, 60, 6);
  g.quadraticCurveTo(42, 2, 32, 12);
  g.fill();
  g.beginPath(); g.arc(32, 13, 4, 0, Math.PI * 2); g.fill();
  _batTex = new THREE.CanvasTexture(c);
  return _batTex;
}

export class BossFx {
  constructor(parent) {
    this.parent = parent;
    this.list = [];
    this.batMat = new THREE.SpriteMaterial({ map: batTexture(), color: 0x0a0608, transparent: true, depthWrite: false });
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0x9ad8ff, transparent: true, opacity: 1, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.beamGeo.translate(0, 0.5, 0);
    this.glowMat = new THREE.SpriteMaterial({ map: glowTexture(64, 2.4), color: 0x9ad8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  }

  // Nube de murciélagos: out = se dispersa desde el punto; si no, converge hacia él
  bats(x, y, z, out = true, n = 26) {
    const g = new THREE.Group();
    g.position.set(x, y + 1.2, z);
    const bats = [];
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(this.batMat);
      const sz = 0.22 + Math.random() * 0.18;
      s.scale.set(sz, sz * 0.5, 1);
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 1.2;
      const dir = new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e) * 0.8 + 0.3, Math.sin(a) * Math.cos(e));
      const dist = 2.5 + Math.random() * 3;
      bats.push({ s, dir, dist, ph: Math.random() * 6, sz });
      g.add(s);
    }
    this.parent.add(g);
    this.list.push({ kind: 'bats', g, bats, out, t: 0, life: 1.2 });
  }

  // Rayo quebrado entre dos puntos (se regenera cada pocos fotogramas)
  beam(ax, ay, az, bx, by, bz) {
    const g = new THREE.Group();
    const segs = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(this.beamGeo, this.beamMat);
      g.add(m);
      segs.push(m);
    }
    // (sin luces nuevas: cambiar el número de luces obliga a recompilar los shaders)
    const glow = new THREE.Sprite(this.glowMat);
    glow.scale.set(1.6, 1.6, 1);
    glow.position.set(bx, by, bz);
    g.add(glow);
    this.parent.add(g);
    const fx = { kind: 'beam', g, segs, a: new THREE.Vector3(ax, ay, az), b: new THREE.Vector3(bx, by, bz), glow, t: 0, life: 0.45, next: 0 };
    this._shapeBeam(fx);
    this.list.push(fx);
  }

  _shapeBeam(fx) {
    const pts = [fx.a.clone()];
    const n = fx.segs.length;
    const d = fx.b.clone().sub(fx.a);
    const len = d.length();
    for (let i = 1; i < n; i++) {
      const p = fx.a.clone().addScaledVector(d, i / n);
      const j = len * 0.04;
      p.x += (Math.random() - 0.5) * j; p.y += (Math.random() - 0.5) * j; p.z += (Math.random() - 0.5) * j;
      pts.push(p);
    }
    pts.push(fx.b.clone());
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const m = fx.segs[i];
      const s = pts[i + 1].clone().sub(pts[i]);
      const l = s.length();
      m.position.copy(pts[i]);
      m.quaternion.setFromUnitVectors(up, s.normalize());
      m.scale.set(0.035, l, 0.035);
    }
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const fx = this.list[i];
      fx.t += dt;
      const k = fx.t / fx.life;
      if (k >= 1) { this.parent.remove(fx.g); this.list.splice(i, 1); continue; }
      if (fx.kind === 'bats') {
        const r = fx.out ? k : 1 - k;
        for (const b of fx.bats) {
          const flap = 0.5 + 0.5 * Math.sin(fx.t * 38 + b.ph);
          b.s.position.copy(b.dir).multiplyScalar(b.dist * r);
          b.s.position.y += Math.sin(fx.t * 9 + b.ph) * 0.15;
          b.s.scale.set(b.sz * (0.5 + 0.5 * flap), b.sz * 0.5, 1);
        }
        this.batMat.opacity = Math.min(1, (1 - k) * 3, fx.out ? 1 : k * 4 + 0.2);
      } else if (fx.kind === 'beam') {
        fx.next -= dt;
        if (fx.next <= 0) { this._shapeBeam(fx); fx.next = 0.05; }
        this.beamMat.opacity = 1 - k;
        this.glowMat.opacity = 1 - k;
      }
    }
  }

  clear() {
    for (const fx of this.list) this.parent.remove(fx.g);
    this.list.length = 0;
  }
}
