// Capas de efectos con instanciado (una llamada de dibujo por capa):
//  - ParticleLayer: partículas billboard con física simple (sangre, chispas, humo, fuego...)
//  - RibbonLayer:   cintas orientadas a la cámara (trazadores de bala)
//  - DecalLayer:    calcomanías planas (impactos de bala, charcos de sangre, quemaduras)
//  - GibLayer:      trozos sólidos que rebotan (vísceras)
// Además genera las texturas procedurales de las calcomanías (atlas de 4 celdas).
import * as THREE from 'three';
import { rng, fbm, clamp01, smoothstep } from './procgen.js';

// Banderas de partícula
export const PFX = { COLLIDE: 1, BOUNCE: 2, STAIN: 4 };

const FLOOR_Y = 0.015;

function dynAttr(count, size) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
  a.setUsage(THREE.DynamicDrawUsage);
  return a;
}

// Marca solo el rango usado de un atributo para subirlo a la GPU
function touch(attr, n) {
  if (typeof attr.clearUpdateRanges === 'function') {
    attr.clearUpdateRanges();
    if (n > 0) attr.addUpdateRange(0, n * attr.itemSize);
  }
  attr.needsUpdate = true;
}

// Niebla propia: en capas aditivas la niebla apaga el brillo en vez de teñirlo
const FOG_FRAG = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  #ifdef ADDITIVE
    gl_FragColor.rgb *= 1.0 - fogFactor;
  #else
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #endif
#endif
`;

function fogUniforms(extra) {
  const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  return Object.assign(u, extra);
}

// --------------------------------------------------------------------------------------------
// Partículas
// --------------------------------------------------------------------------------------------
const PARTICLE_VS = `
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec4 aColor;
attribute vec3 aSRS; // tamaño, rotación, estiramiento por velocidad
varying vec4 vColor;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4( aPos, 1.0 );
  float size = aSRS.x;
  vec2 corner = position.xy;
  if ( aSRS.z > 0.0 ) {
    vec3 vv = ( modelViewMatrix * vec4( aVel, 0.0 ) ).xyz;
    float l = length( vv.xy );
    if ( l > 1e-4 ) {
      vec2 dir = vv.xy / l;
      vec2 perp = vec2( -dir.y, dir.x );
      float len = size + l * aSRS.z;
      mvPosition.xy += dir * ( corner.y * len ) + perp * ( corner.x * size );
    } else {
      mvPosition.xy += corner * size;
    }
  } else {
    float c = cos( aSRS.y ), s = sin( aSRS.y );
    mvPosition.xy += vec2( c * corner.x - s * corner.y, s * corner.x + c * corner.y ) * size;
  }
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const PARTICLE_FS = `
uniform sampler2D map;
varying vec4 vColor;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec4 tex = texture2D( map, vUv );
  gl_FragColor = vec4( vColor.rgb * tex.rgb, vColor.a * tex.a );
  if ( gl_FragColor.a < 0.004 ) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${FOG_FRAG}
}
`;

export class ParticleLayer {
  constructor(parent, { max = 512, map = null, additive = false, renderOrder = 0, name = 'particles' } = {}) {
    this.max = max;
    this.count = 0;
    this.onStain = null;
    const f = (n) => new Float32Array(max * n);
    this.p = f(3); this.v = f(3);
    this.age = f(1); this.life = f(1);
    this.sz = f(2);          // tamaño inicial y final
    this.c0 = f(3); this.c1 = f(3);
    this.al = f(3);          // alfa, fracción de aparición, inicio del desvanecido
    this.rt = f(2);          // rotación, velocidad de rotación
    this.ph = f(3);          // gravedad, rozamiento, estiramiento
    this.fl = new Uint8Array(max);

    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = dynAttr(max, 3);
    this.aVel = dynAttr(max, 3);
    this.aColor = dynAttr(max, 4);
    this.aSRS = dynAttr(max, 3);
    g.setAttribute('aPos', this.aPos);
    g.setAttribute('aVel', this.aVel);
    g.setAttribute('aColor', this.aColor);
    g.setAttribute('aSRS', this.aSRS);
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      name,
      uniforms: fogUniforms({ map: { value: map } }),
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: !additive,
      defines: additive ? { ADDITIVE: 1 } : {},
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    parent.add(this.mesh);
  }

  // o: { x,y,z, vx,vy,vz, life, size, size1, color:[r,g,b], color1, alpha, fin, fout, grav, drag, stretch, rot, spin, flags }
  spawn(o) {
    let i = this.count;
    if (i >= this.max) {
      // lleno: se sustituye una partícula al azar de la mitad más vieja
      i = Math.floor(Math.random() * (this.max >> 1));
    } else {
      this.count++;
    }
    const i2 = i * 2, i3 = i * 3;
    this.p[i3] = o.x; this.p[i3 + 1] = o.y; this.p[i3 + 2] = o.z;
    this.v[i3] = o.vx || 0; this.v[i3 + 1] = o.vy || 0; this.v[i3 + 2] = o.vz || 0;
    this.age[i] = 0;
    this.life[i] = Math.max(0.016, o.life || 0.5);
    const s0 = o.size || 0.1;
    this.sz[i2] = s0; this.sz[i2 + 1] = o.size1 === undefined ? s0 : o.size1;
    const c0 = o.color || [1, 1, 1], c1 = o.color1 || c0;
    this.c0[i3] = c0[0]; this.c0[i3 + 1] = c0[1]; this.c0[i3 + 2] = c0[2];
    this.c1[i3] = c1[0]; this.c1[i3 + 1] = c1[1]; this.c1[i3 + 2] = c1[2];
    this.al[i3] = o.alpha === undefined ? 1 : o.alpha;
    this.al[i3 + 1] = o.fin || 0;
    this.al[i3 + 2] = o.fout === undefined ? 0.4 : o.fout;
    this.rt[i2] = o.rot === undefined ? Math.random() * 6.283 : o.rot;
    this.rt[i2 + 1] = o.spin || 0;
    this.ph[i3] = o.grav || 0; this.ph[i3 + 1] = o.drag || 0; this.ph[i3 + 2] = o.stretch || 0;
    this.fl[i] = o.flags || 0;
    return i;
  }

  _copy(from, to) {
    const f2 = from * 2, t2 = to * 2, f3 = from * 3, t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.p[t3 + k] = this.p[f3 + k]; this.v[t3 + k] = this.v[f3 + k];
      this.c0[t3 + k] = this.c0[f3 + k]; this.c1[t3 + k] = this.c1[f3 + k];
      this.al[t3 + k] = this.al[f3 + k]; this.ph[t3 + k] = this.ph[f3 + k];
    }
    this.sz[t2] = this.sz[f2]; this.sz[t2 + 1] = this.sz[f2 + 1];
    this.rt[t2] = this.rt[f2]; this.rt[t2 + 1] = this.rt[f2 + 1];
    this.age[to] = this.age[from]; this.life[to] = this.life[from];
    this.fl[to] = this.fl[from];
  }

  clear() {
    this.count = 0;
    this.geometry.instanceCount = 0;
    this.mesh.visible = false;
  }

  update(dt) {
    const p = this.p, v = this.v, ph = this.ph;
    let n = this.count;
    let i = 0;
    while (i < n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { n--; if (i !== n) this._copy(n, i); continue; }
      const i3 = i * 3;
      const drag = ph[i3 + 1];
      if (drag > 0) { const k = Math.exp(-drag * dt); v[i3] *= k; v[i3 + 1] *= k; v[i3 + 2] *= k; }
      v[i3 + 1] -= ph[i3] * dt;
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      const fl = this.fl[i];
      if ((fl & PFX.COLLIDE) && p[i3 + 1] < FLOOR_Y && v[i3 + 1] < 0) {
        p[i3 + 1] = FLOOR_Y;
        if (fl & PFX.STAIN) {
          if (this.onStain) this.onStain(p[i3], p[i3 + 2], this.sz[i * 2]);
          n--; if (i !== n) this._copy(n, i);
          continue;
        }
        if (fl & PFX.BOUNCE) {
          v[i3 + 1] = -v[i3 + 1] * 0.32; v[i3] *= 0.55; v[i3 + 2] *= 0.55;
          this.rt[i * 2 + 1] *= 0.5;
          if (Math.abs(v[i3 + 1]) < 0.4) { v[i3 + 1] = 0; ph[i3] = 0; ph[i3 + 1] = Math.max(ph[i3 + 1], 6); }
        } else {
          v[i3] = v[i3 + 1] = v[i3 + 2] = 0; ph[i3] = 0;
        }
      }
      i++;
    }
    this.count = n;
    // Escritura de atributos
    const aP = this.aPos.array, aV = this.aVel.array, aC = this.aColor.array, aS = this.aSRS.array;
    for (let j = 0; j < n; j++) {
      const j2 = j * 2, j3 = j * 3, j4 = j * 4;
      const t = this.age[j] / this.life[j];
      const e = 1 - (1 - t) * (1 - t);
      const size = this.sz[j2] + (this.sz[j2 + 1] - this.sz[j2]) * e;
      const fin = this.al[j3 + 1], fout = this.al[j3 + 2];
      let a = this.al[j3];
      if (fin > 0 && t < fin) a *= t / fin;
      if (t > fout) a *= 1 - (t - fout) / Math.max(1e-3, 1 - fout);
      aP[j3] = p[j3]; aP[j3 + 1] = p[j3 + 1]; aP[j3 + 2] = p[j3 + 2];
      aV[j3] = v[j3]; aV[j3 + 1] = v[j3 + 1]; aV[j3 + 2] = v[j3 + 2];
      aC[j4] = this.c0[j3] + (this.c1[j3] - this.c0[j3]) * t;
      aC[j4 + 1] = this.c0[j3 + 1] + (this.c1[j3 + 1] - this.c0[j3 + 1]) * t;
      aC[j4 + 2] = this.c0[j3 + 2] + (this.c1[j3 + 2] - this.c0[j3 + 2]) * t;
      aC[j4 + 3] = a;
      aS[j3] = size;
      aS[j3 + 1] = this.rt[j2] + this.rt[j2 + 1] * this.age[j];
      aS[j3 + 2] = ph[j3 + 2];
    }
    touch(this.aPos, n); touch(this.aVel, n); touch(this.aColor, n); touch(this.aSRS, n);
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
  }
}

// --------------------------------------------------------------------------------------------
// Cintas (trazadores)
// --------------------------------------------------------------------------------------------
const RIBBON_VS = `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec4 aColor;
attribute float aWidth;
varying vec4 vColor;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColor = aColor;
  vec4 a = modelViewMatrix * vec4( aStart, 1.0 );
  vec4 b = modelViewMatrix * vec4( aEnd, 1.0 );
  vec4 mvPosition = mix( a, b, position.y + 0.5 );
  vec3 side = cross( b.xyz - a.xyz, mvPosition.xyz );
  float sl = length( side );
  side = sl > 1e-6 ? side / sl : vec3( 1.0, 0.0, 0.0 );
  mvPosition.xyz += side * ( position.x * aWidth );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const RIBBON_FS = `
varying vec4 vColor;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float across = 1.0 - abs( vUv.x * 2.0 - 1.0 );
  float a = vColor.a * across * across * mix( 0.25, 1.0, vUv.y );
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( vColor.rgb * ( 0.6 + 0.8 * across ), a );
  #include <colorspace_fragment>
  ${FOG_FRAG}
}
`;

export class RibbonLayer {
  constructor(parent, { max = 48, renderOrder = 7 } = {}) {
    this.max = max;
    this.list = [];            // { ax,ay,az, dx,dy,dz, dist, age, life, speed, len, width, color, alpha, streak }
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.aStart = dynAttr(max, 3);
    this.aEnd = dynAttr(max, 3);
    this.aColor = dynAttr(max, 4);
    this.aWidth = dynAttr(max, 1);
    g.setAttribute('aStart', this.aStart);
    g.setAttribute('aEnd', this.aEnd);
    g.setAttribute('aColor', this.aColor);
    g.setAttribute('aWidth', this.aWidth);
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      name: 'tracers',
      uniforms: fogUniforms({}),
      vertexShader: RIBBON_VS,
      fragmentShader: RIBBON_FS,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      defines: { ADDITIVE: 1 },
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'tracers';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    parent.add(this.mesh);
  }

  add(o) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push(o);
  }

  clear() { this.list.length = 0; this.geometry.instanceCount = 0; this.mesh.visible = false; }

  update(dt) {
    const L = this.list;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const r = L[i];
      r.age += dt;
      let alive;
      if (r.streak) {
        const head = Math.min(r.dist, r.age * r.speed);
        alive = head - r.len < r.dist && r.age < r.life;
      } else {
        alive = r.age < r.life;
      }
      if (alive) L[w++] = r;
    }
    L.length = w;
    const S = this.aStart.array, E = this.aEnd.array, C = this.aColor.array, W = this.aWidth.array;
    for (let i = 0; i < w; i++) {
      const r = L[i];
      let t0, t1, a;
      if (r.streak) {
        const head = Math.min(r.dist, r.age * r.speed);
        t0 = Math.max(0, head - r.len); t1 = head;
        a = r.alpha * (head >= r.dist ? Math.max(0, 1 - (r.age * r.speed - r.dist) / Math.max(0.01, r.len)) : 1);
      } else {
        t0 = 0; t1 = r.dist;
        const k = 1 - r.age / r.life;
        a = r.alpha * k * k;
      }
      const i3 = i * 3, i4 = i * 4;
      S[i3] = r.ax + r.dx * t0; S[i3 + 1] = r.ay + r.dy * t0; S[i3 + 2] = r.az + r.dz * t0;
      E[i3] = r.ax + r.dx * t1; E[i3 + 1] = r.ay + r.dy * t1; E[i3 + 2] = r.az + r.dz * t1;
      C[i4] = r.color[0]; C[i4 + 1] = r.color[1]; C[i4 + 2] = r.color[2]; C[i4 + 3] = a;
      W[i] = r.width;
    }
    touch(this.aStart, w); touch(this.aEnd, w); touch(this.aColor, w); touch(this.aWidth, w);
    this.geometry.instanceCount = w;
    this.mesh.visible = w > 0;
  }
}

// --------------------------------------------------------------------------------------------
// Calcomanías
// --------------------------------------------------------------------------------------------
const DECAL_VS = `
attribute vec4 aDec; // celda del atlas, alfa, brillo
varying vec2 vUv;
varying vec2 vDec;
#include <fog_pars_vertex>
void main() {
  vUv = vec2( ( uv.x + aDec.x ) * 0.25, uv.y );
  vDec = aDec.yz;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const DECAL_FS = `
uniform sampler2D map;
uniform float uLight;
varying vec2 vUv;
varying vec2 vDec;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D( map, vUv );
  float a = t.a * vDec.x;
  if ( a < 0.01 ) discard;
  gl_FragColor = vec4( t.rgb * vDec.y * uLight, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${FOG_FRAG}
}
`;

export const DECAL_CELL = { HOLE: 0, CHIP: 1, BLOOD: 2, SCORCH: 3 };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _Z = new THREE.Vector3(0, 0, 1);

export class DecalLayer {
  constructor(parent, { max = 60, map = null, renderOrder = 1, name = 'decals', light = 0.8 } = {}) {
    this.max = max;
    this.next = 0;
    this.used = 0;
    this.items = new Array(max).fill(null);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.aDec = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aDec.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDec', this.aDec);
    this.material = new THREE.ShaderMaterial({
      name,
      uniforms: fogUniforms({ map: { value: map }, uLight: { value: light } }),
      vertexShader: DECAL_VS,
      fragmentShader: DECAL_FS,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parent.add(this.mesh);
    this.animating = new Set();
  }

  // opts: { cell, alpha, bright, life (s, 0 = permanente), grow (s), roll }
  add(pos, normal, size, opts = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.used = Math.min(this.max, this.used + 1);
    const it = {
      x: pos.x, y: pos.y, z: pos.z, nx: normal.x, ny: normal.y, nz: normal.z,
      size, roll: opts.roll === undefined ? Math.random() * Math.PI * 2 : opts.roll,
      cell: opts.cell || 0, alpha: opts.alpha === undefined ? 1 : opts.alpha, bright: opts.bright === undefined ? 1 : opts.bright,
      life: opts.life || 0, grow: opts.grow || 0, age: 0,
    };
    this.items[i] = it;
    this._write(i, it, it.grow > 0 ? 0.25 : 1, it.alpha);
    if (it.life > 0 || it.grow > 0) this.animating.add(i);
    else this.animating.delete(i);
    this.mesh.count = this.used;
    return i;
  }

  _write(i, it, scale, alpha) {
    _n.set(it.nx, it.ny, it.nz);
    if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0);
    _n.normalize();
    _q.setFromUnitVectors(_Z, _n);
    _qr.setFromAxisAngle(_Z, it.roll);
    _q.multiply(_qr);
    _p.set(it.x, it.y, it.z);
    const s = it.size * scale;
    _s.set(s, s, 1);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    const a = this.aDec.array;
    a[i * 4] = it.cell; a[i * 4 + 1] = alpha; a[i * 4 + 2] = it.bright; a[i * 4 + 3] = 0;
    this.aDec.needsUpdate = true;
  }

  clear() {
    this.items.fill(null);
    this.animating.clear();
    this.next = 0; this.used = 0;
    this.mesh.count = 0;
  }

  update(dt) {
    this.mesh.visible = this.used > 0;
    if (!this.animating.size) return;
    for (const i of this.animating) {
      const it = this.items[i];
      if (!it) { this.animating.delete(i); continue; }
      it.age += dt;
      let scale = 1, alpha = it.alpha;
      if (it.grow > 0 && it.age < it.grow) scale = 0.25 + 0.75 * (1 - Math.pow(1 - it.age / it.grow, 3));
      if (it.life > 0) {
        const fadeStart = it.life * 0.8;
        if (it.age > fadeStart) alpha *= Math.max(0, 1 - (it.age - fadeStart) / (it.life - fadeStart));
        if (it.age >= it.life) alpha = 0;
      }
      this._write(i, it, scale, alpha);
      const growing = it.grow > 0 && it.age < it.grow;
      if (!growing && (it.life <= 0 || it.age >= it.life)) this.animating.delete(i);
    }
  }
}

// --------------------------------------------------------------------------------------------
// Vísceras (trozos sólidos)
// --------------------------------------------------------------------------------------------
const _e = new THREE.Euler();
const _c = new THREE.Color();

export class GibLayer {
  constructor(parent, { max = 64, quality = 'high', drops = null } = {}) {
    this.max = max;
    this.list = [];
    this.drops = drops;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    // deformación irregular para que no parezcan piedras perfectas
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = 0.75 + 0.5 * fbm(pos.getX(i) * 3 + 1.7, pos.getY(i) * 3 + pos.getZ(i) * 2, 9, 2);
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.8, pos.getZ(i) * k);
    }
    geo.computeVertexNormals();
    const mat = quality === 'low'
      ? new THREE.MeshLambertMaterial({ color: 0xffffff })
      : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.name = 'gibs';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, _c.setRGB(0.4, 0.05, 0.04));
    this.mesh.count = 0;
    parent.add(this.mesh);
  }

  spawn(x, y, z, vx, vy, vz, size, color) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      x, y, z, vx, vy, vz, size,
      sx: size * (0.7 + Math.random() * 0.6), sy: size * (0.6 + Math.random() * 0.5), sz: size * (0.8 + Math.random() * 0.7),
      rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
      wx: (Math.random() - 0.5) * 18, wy: (Math.random() - 0.5) * 12, wz: (Math.random() - 0.5) * 18,
      color, age: 0, life: 5 + Math.random() * 2, rest: false, bleed: 0.5 + Math.random() * 0.5, acc: 0,
    });
  }

  clear() { this.list.length = 0; this.mesh.count = 0; }

  update(dt) {
    const L = this.list;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const g = L[i];
      g.age += dt;
      if (g.age >= g.life) continue;
      if (!g.rest) {
        g.vy -= 9.8 * dt;
        g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
        g.rx += g.wx * dt; g.ry += g.wy * dt; g.rz += g.wz * dt;
        const floor = g.sy * 0.6;
        if (g.y < floor) {
          g.y = floor;
          if (g.vy < -1.6) {
            g.vy = -g.vy * 0.28; g.vx *= 0.5; g.vz *= 0.5; g.wx *= 0.4; g.wy *= 0.4; g.wz *= 0.4;
          } else {
            g.rest = true; g.vx = g.vy = g.vz = 0;
          }
        }
        // rastro de sangre mientras vuela
        if (g.bleed > 0 && this.drops) {
          g.bleed -= dt;
          g.acc += dt;
          if (g.acc > 0.05) {
            g.acc = 0;
            this.drops.spawn({
              x: g.x, y: g.y, z: g.z, vx: g.vx * 0.2, vy: g.vy * 0.2, vz: g.vz * 0.2,
              life: 0.8, size: 0.03 + Math.random() * 0.02, color: [0.32, 0.02, 0.02], alpha: 0.9, fout: 0.8,
              grav: 9.8, flags: PFX.COLLIDE | PFX.STAIN,
            });
          }
        }
      }
      L[w++] = g;
    }
    L.length = w;
    for (let i = 0; i < w; i++) {
      const g = L[i];
      // se hunden y encogen al final
      const k = g.age > g.life - 1 ? Math.max(0.01, g.life - g.age) : 1;
      _p.set(g.x, g.y - (1 - k) * g.sy, g.z);
      _e.set(g.rx, g.ry, g.rz);
      _q.setFromEuler(_e);
      _s.set(g.sx * k, g.sy * k, g.sz * k);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, _c.setRGB(g.color[0], g.color[1], g.color[2]));
    }
    this.mesh.count = w;
    this.mesh.visible = w > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// --------------------------------------------------------------------------------------------
// Texturas
// --------------------------------------------------------------------------------------------
function dataTex(data, w, h, srgb, mips) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  if (mips) {
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
  } else {
    tex.minFilter = THREE.LinearFilter;
  }
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Gota: círculo de borde definido (sangre, astillas)
export function dotTexture(size = 32) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = 1 - smoothstep(0.62, 0.95, d);
      const shade = 1 - 0.35 * smoothstep(0.1, 0.8, Math.hypot(dx + 0.15, dy - 0.15) * 2);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(255 * shade);
      data[i + 3] = Math.round(255 * a);
    }
  }
  return dataTex(data, size, size, false, false);
}

// Atlas de calcomanías 512x128: [impacto, impacto astillado, sangre, quemadura]
export function decalAtlas() {
  const CW = 128, W = CW * 4, H = CW;
  const data = new Uint8Array(W * H * 4);
  const r = rng(4242);
  const cracks = [[], []];
  for (let v = 0; v < 2; v++) {
    const n = 4 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) cracks[v].push({ a: r() * Math.PI * 2, len: 22 + r() * 22, w: 0.05 + r() * 0.05 });
  }
  const drops = [];
  for (let k = 0; k < 11; k++) {
    const a = r() * Math.PI * 2, d = 38 + r() * 20;
    drops.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 1.5 + r() * 4.5 });
  }
  const put = (x, y, R, G, B, A) => {
    const i = (y * W + x) * 4;
    data[i] = R; data[i + 1] = G; data[i + 2] = B; data[i + 3] = Math.round(clamp01(A) * 255);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = (x / CW) | 0;
      const u = (x % CW) + 0.5 - CW / 2, v = y + 0.5 - CW / 2;
      const d = Math.hypot(u, v);
      const ang = Math.atan2(v, u);
      const n = fbm(u / 9 + cell * 7, v / 9, 3 + cell, 3);
      if (d > CW / 2 - 3) { put(x, y, 0, 0, 0, 0); continue; }
      if (cell === 0 || cell === 1) {
        // agujero de bala: centro negro, anillo roto, grietas y hollín
        const hole = 1 - smoothstep(7, 10 + n * 3, d);
        const ring = (1 - smoothstep(12, 20 + n * 6, d)) * 0.85;
        let crack = 0;
        for (const c of cracks[cell]) {
          let da = Math.abs(ang - c.a);
          if (da > Math.PI) da = Math.PI * 2 - da;
          const wob = (fbm(d / 6, c.a * 3, 17, 2) - 0.5) * 0.25;
          if (d > 8 && d < c.len && Math.abs(da + wob) < c.w * (1 - d / c.len)) crack = Math.max(crack, 0.8 * (1 - d / c.len));
        }
        const soot = (1 - smoothstep(10, 34 + n * 10, d)) * 0.35;
        const a = Math.max(hole, ring, crack, soot);
        let R, G, B;
        if (cell === 1) {
          // astillado claro alrededor (madera, yeso)
          const chip = smoothstep(9, 13, d) * (1 - smoothstep(13, 22 + n * 5, d));
          R = 20 + chip * 150; G = 16 + chip * 125; B = 12 + chip * 90;
        } else {
          const g = hole > 0.5 ? 8 : 38 + 30 * n;
          R = g; G = g * 0.95; B = g * 0.9;
        }
        put(x, y, R, G, B, a);
      } else if (cell === 2) {
        // salpicadura de sangre con borde irregular y gotas satélite
        const R0 = 30 + 16 * fbm(Math.cos(ang) * 2.2 + 3, Math.sin(ang) * 2.2 + 3, 21, 3);
        let a = 1 - smoothstep(R0 - 3, R0 + 1, d);
        for (const dr of drops) {
          const dd = Math.hypot(u - dr.x, v - dr.y);
          a = Math.max(a, 1 - smoothstep(dr.r - 1, dr.r + 0.8, dd));
        }
        const dark = 0.55 + 0.45 * n;
        const edge = smoothstep(R0 - 10, R0, d);
        put(x, y, 95 * dark + 25 * edge, 6 * dark, 5 * dark, a * (0.92 - 0.2 * (1 - n)));
      } else {
        // quemadura de explosión
        const a = (1 - smoothstep(14, 58, d + (n - 0.5) * 22)) * 0.9;
        const g = 10 + 24 * smoothstep(0, 50, d) * n;
        put(x, y, g, g * 0.85, g * 0.75, a);
      }
    }
  }
  return dataTex(data, W, H, true, true);
}
