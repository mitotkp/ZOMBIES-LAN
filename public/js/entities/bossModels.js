// Modelos de los zombis especiales y jefes. Cada tipo monta su propia anatomía esculpida (torsos paramétricos,
// extremidades, ropa, armas y accesorios con colores de vértice) sobre el esqueleto del zombi normal, de modo que
// las animaciones, reacciones a impactos y muertes siguen funcionando. Además cada tipo puede retocar la pose
// (pose), animar sus piezas (update) y reaccionar a sus habilidades (onAbility: carga, golpe, invocación...).
// Geometrías y materiales se crean una vez por tipo y se comparten.

import * as THREE from 'three';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import { ZA, ZF } from '/shared/protocol.js';
import { ZOMBIE_TYPES } from '/shared/constants.js';
import {
  TAU, rng, deform, paintGeo, mergeGeos, makeMat, limbGeo, roundedBox, capsule, fbm, smoothstep, clamp01, easeInOut,
  valueNoise, makeCanvas, canvasTexture, blotches, glowTexture,
} from './procgen.js';

const PI = Math.PI;
const gauss = (x, m, s) => Math.exp(-((x - m) * (x - m)) / (s * s));
const lerp = (a, b, k) => a + (b - a) * k;
const C = (r, g, b) => new THREE.Color(r, g, b);

// Perfil suavizado por tramos: pts = [[t, valor], ...]
function profile(t, pts) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const a = pts[i - 1], b = pts[i];
      const k = (t - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * (k * k * (3 - 2 * k));
    }
  }
  return pts[pts.length - 1][1];
}

// Superficie paramétrica f(u, v, out) con colores de vértice paint(x, y, z, color, u, v)
function surface(f, su, sv, paint) {
  const g = new ParametricGeometry(f, su, sv);
  if (paint) {
    const uv = g.attributes.uv;
    let i = 0;
    paintGeo(g, (x, y, z, c, nx, ny, nz) => { paint(x, y, z, c, uv.getX(i), uv.getY(i), nx, ny, nz); i++; });
  }
  return g;
}

// Tubo a lo largo de una curva (ganchos, cadenas, raíces, cuernos)
function tube(points, radius, seg = 24, radial = 8, paint = null, taper = null) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const g = new THREE.TubeGeometry(curve, seg, radius, radial, false);
  if (taper) {
    // estrecha el tubo hacia el final (cuernos, garras, púas)
    const pos = g.attributes.position;
    const pts = curve.getSpacedPoints(seg);
    for (let s = 0; s <= seg; s++) {
      const k = taper(s / seg);
      for (let r = 0; r <= radial; r++) {
        const i = s * (radial + 1) + r;
        const c = pts[s];
        pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * k, c.y + (pos.getY(i) - c.y) * k, c.z + (pos.getZ(i) - c.z) * k);
      }
    }
    g.computeVertexNormals();
  }
  paintGeo(g, paint || null);
  return g;
}

function sphere(r, ws = 16, hs = 12) { return new THREE.SphereGeometry(r, ws, hs); }
function colored(geo, col) { return paintGeo(geo, (x, y, z, c) => c.copy(col)); }
function at(geo, x, y, z, rx = 0, ry = 0, rz = 0, s = null) {
  if (s) geo.scale(s[0], s[1], s[2]);
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  return geo;
}

// Púa cónica que sale en la dirección (dx, dy, dz)
function spike(x, y, z, dx, dy, dz, len, r, col) {
  const g = new THREE.ConeGeometry(r, len, 8, 1);
  g.translate(0, len / 2, 0);
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(x, y, z);
  paintGeo(g, (px, py, pz, c) => {
    const k = clamp01(((px - x) * dir.x + (py - y) * dir.y + (pz - z) * dir.z) / len);
    c.copy(col).lerp(C(0.95, 0.92, 0.82), k * 0.7);
  });
  return g;
}

// Mano (palma + dedos en garra o puño). Cuelga hacia -Y desde el origen (la muñeca).
function handGeo({ palmW = 0.055, palmL = 0.085, fingerR = 0.0075, fingerL = 0.07, curl = 0.6, claw = 0, seed = 1,
  skin = C(0.85, 0.82, 0.8), nail = C(0.25, 0.2, 0.15), bloody = 0 } = {}) {
  const r = rng(seed);
  const parts = [];
  const palm = roundedBox(palmW, palmL, palmW * 0.48, palmW * 0.2, 2);
  palm.translate(0, -palmL / 2, 0);
  parts.push(colored(palm, skin));
  for (let i = 0; i < 4; i++) {
    const len = fingerL * (i === 0 || i === 3 ? 0.85 : 1) * (0.92 + r() * 0.16);
    const x = -palmW * 0.38 + i * palmW * 0.25;
    // dos falanges: la segunda más curvada
    const a = capsule(fingerR, len * 0.55, 7);
    a.translate(0, -len * 0.27, 0);
    const b = capsule(fingerR * 0.9, len * 0.5 + claw, 7);
    b.translate(0, -len * 0.25 - claw * 0.5, 0);
    paintGeo(b, (px, py, pz, c) => {
      c.copy(skin);
      const tip = smoothstep(-len * 0.3, -len * 0.5 - claw, py);
      c.lerp(nail, tip * (claw > 0 ? 0.9 : 0.5));
    });
    b.rotateX(curl * 1.2);
    b.translate(0, -len * 0.55, 0);
    colored(a, skin);
    const f = mergeGeos([a, b]);
    f.rotateX(curl * 0.7 + (r() - 0.5) * 0.2);
    f.translate(x, -palmL + fingerR, 0);
    parts.push(f);
  }
  const th = capsule(fingerR * 1.05, fingerL * 0.7, 7);
  th.translate(0, -fingerL * 0.35, 0);
  colored(th, skin);
  th.rotateZ(0.55); th.rotateX(0.4 + curl * 0.4);
  th.translate(palmW * 0.5, -palmL * 0.3, -0.005);
  parts.push(th);
  const g = mergeGeos(parts);
  if (bloody > 0) {
    const col = g.attributes.color;
    const pos = g.attributes.position;
    for (let i = 0; i < col.count; i++) {
      if (fbm(pos.getX(i) * 40 + seed, pos.getY(i) * 40, seed) > 1 - bloody) col.setXYZ(i, col.getX(i) * 0.55, col.getY(i) * 0.1, col.getZ(i) * 0.08);
    }
  }
  return g;
}

// Brazo musculoso colgando hacia -Y (bíceps / antebrazo), con abultamiento y color de vértice
function armGeo(len, r0, r1, { bulge = 0.2, bulgeAt = 0.4, skin = C(1, 1, 1), paint = null, radial = 16, flat = 0.9 } = {}) {
  const g = new THREE.CylinderGeometry(1, 1, 1, radial, 12, true);
  deform(g, (v) => {
    const t = 0.5 - v.y;                                   // 0 arriba, 1 abajo
    let r = lerp(r0, r1, t) * (1 + bulge * gauss(t, bulgeAt, 0.25));
    // redondea los extremos para que no se vean huecos
    const cap = Math.sin(clamp01(t / 0.08) * PI / 2) * Math.sin(clamp01((1 - t) / 0.04) * PI / 2);
    r *= 0.35 + 0.65 * cap;
    v.set(v.x * r, -t * len, v.z * r * flat);
  });
  paintGeo(g, (x, y, z, c) => { c.copy(skin); if (paint) paint(x, y, z, c); });
  return g;
}

// Textura de tela/cuero sucia genérica (se tiñe con color del material)
let _grimeTex = null;
function grimeTexture() {
  if (_grimeTex) return _grimeTex;
  const c = makeCanvas(256, 256);
  if (!c) return null;
  const g = c.getContext('2d');
  const r = rng(913);
  // grano fino de poco contraste (poros, arrugas y suciedad), sin manchas grandes que se repitan
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const n = 0.55 * valueNoise(x / 6, y / 6, 3) + 0.3 * valueNoise(x / 2.5, y / 2.5, 7) + 0.15 * r();
      const v = 205 + (n - 0.5) * 60;
      const i = (y * 256 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  blotches(g, 256, 256, r, '#000000', 40, 3, 12, 0.02, 0.06);
  g.globalAlpha = 0.08;
  g.strokeStyle = '#000';
  for (let i = 0; i < 120; i++) { g.beginPath(); const x = r() * 256, y = r() * 256; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 24, y + (r() - 0.5) * 5); g.stroke(); }
  _grimeTex = canvasTexture(c);
  _grimeTex.wrapS = _grimeTex.wrapT = THREE.RepeatWrapping;
  _grimeTex.repeat.set(2, 2);
  return _grimeTex;
}

// Metal oxidado / chapa con remaches
let _metalTex = null;
function metalTexture() {
  if (_metalTex) return _metalTex;
  const c = makeCanvas(256, 256);
  if (!c) return null;
  const g = c.getContext('2d');
  const r = rng(517);
  g.fillStyle = '#b8b8b8';
  g.fillRect(0, 0, 256, 256);
  blotches(g, 256, 256, r, '#6a3a18', 60, 4, 26, 0.08, 0.35);   // óxido
  blotches(g, 256, 256, r, '#2a2a2a', 80, 3, 18, 0.05, 0.25);
  blotches(g, 256, 256, r, '#ffffff', 30, 3, 12, 0.04, 0.12);
  g.globalAlpha = 0.25;
  g.strokeStyle = '#ffffff';
  for (let i = 0; i < 60; i++) { g.beginPath(); const x = r() * 256, y = r() * 256; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 60); g.stroke(); }
  _metalTex = canvasTexture(c);
  _metalTex.wrapS = _metalTex.wrapT = THREE.RepeatWrapping;
  return _metalTex;
}

// Torso paramétrico genérico: perfiles de ancho (w) y fondo (d) a lo largo de t (0 = cadera, 1 = cuello), barriga,
// joroba, bultos de ruido y costillas marcadas. Devuelve f(u, t, out, grow) con u = vuelta (0 = espalda, 0.5 = frente).
function torsoFn({ y0 = -0.1, h = 0.8, w, d, belly = 0, bellyAt = 0.3, bellyS = 0.17, hump = 0, humpAt = 0.72,
  lump = 0, seed = 1, ribs = 0, ribFrom = 0.45, ribTo = 0.8, sink = 0 }) {
  return (u, t, out, grow = 0) => {
    const th = u * TAU;
    const front = Math.max(0, -Math.cos(th)), back = Math.max(0, Math.cos(th));
    let k = 1;
    if (lump) k += (fbm(u * 7 + seed, t * 5, seed, 3) - 0.5) * 2 * lump * Math.sin(PI * clamp01(t * 1.1));
    if (ribs) {
      const inR = smoothstep(ribFrom - 0.03, ribFrom + 0.03, t) * (1 - smoothstep(ribTo - 0.03, ribTo + 0.03, t));
      k += ribs * inR * Math.pow(Math.max(0, Math.sin(t * 70)), 3) * (0.8 * front + 0.6 * Math.abs(Math.sin(th)) * (1 - back));
    }
    const ww = profile(t, w) * k + grow, dd = profile(t, d) * k + grow;
    let x = Math.sin(th) * ww;
    let z = Math.cos(th) * dd;
    let y = y0 + t * h;
    if (belly) { const b = belly * gauss(t, bellyAt, bellyS) * Math.pow(front, 1.4); z -= b; y -= 0.3 * b; }
    if (hump) z += hump * gauss(t, humpAt, 0.13) * back;
    if (sink) z += sink * gauss(t, 0.3, 0.1) * front;                // vientre hundido
    out.set(x, y, z);
    return out;
  };
}

// Normal aproximada de un torso paramétrico (diferencias finitas)
function torsoPoint(F, u, t, off = 0) {
  const p = F(u, t, new THREE.Vector3());
  const a = F(u + 0.003, t, new THREE.Vector3()).sub(p);
  const b = F(u, t + 0.003, new THREE.Vector3()).sub(p);
  const n = new THREE.Vector3().crossVectors(b, a).normalize();
  return { p: p.addScaledVector(n, off), n };
}

// Tira de tela que cuelga hacia -Y desde el origen: ancho w0 → w1, largo len, borde inferior rasgado
function stripGeo(len, w0, w1, seed, paint, curveZ = 0.02) {
  const g = new THREE.PlaneGeometry(1, 1, 3, 10);
  deform(g, (v) => {
    const t = 0.5 - v.y;                                        // 0 arriba, 1 abajo
    const w = lerp(w0, w1, t);
    let y = -t * len;
    if (t > 0.85) y -= (valueNoise(v.x * 9 + seed, seed, seed) - 0.3) * len * 0.12;
    v.set(v.x * w, y, curveZ * Math.sin(v.x * PI) + 0.01 * Math.sin(t * 9 + seed));
  });
  paintGeo(g, paint);
  return g;
}

// Cabeza de monstruo esculpida (espacio del cuello: centro del cráneo en y = 0.215, cara hacia -Z).
// Devuelve { head, jaw }: head = cráneo + maxilar con dientes superiores (+ cuello), jaw = mandíbula con dientes
// inferiores para colgarla del pivote de la mandíbula del zombi (0, 0.18, -0.004), que ya se anima al gruñir.
function monsterHead({ w = 0.1, h = 0.118, d = 0.112, brow = 0.1, sockets = 0.18, socketW = 0.2, cheeks = 0.08, snout = 0,
  skull = 0, lumps = 0, seed = 1, paint, teethCol = C(0.78, 0.72, 0.5), teeth = 9, fang = 1, tusks = 0, jawW = 1,
  jawDrop = 0.075, neckR = 0.05, noNose = false, mouthGlow = null } = {}) {
  const g = new THREE.SphereGeometry(1, 30, 24);
  const mouthY = -0.42;                                          // línea de la boca (normalizada)
  deform(g, (v) => {
    const x = v.x, y = v.y, z = v.z;
    let k = 1;
    if (lumps) k += (fbm(x * 2.5 + seed, y * 2.5 + z * 1.5, seed, 3) - 0.5) * 2 * lumps;
    k += brow * gauss(Math.hypot(x * 0.7, y - 0.25, z + 0.9), 0, 0.3);                  // arco superciliar
    for (const s of [-1, 1]) {
      k -= sockets * gauss(Math.hypot(x - s * 0.36, y - 0.06, z + 0.9), 0, socketW);   // cuencas
      k -= cheeks * gauss(Math.hypot(x - s * 0.62, y + 0.3, z + 0.7), 0, 0.25);         // mejillas hundidas
      k += 0.06 * gauss(Math.hypot(x - s * 0.55, y + 0.05, z + 0.75), 0, 0.18);         // pómulos
    }
    if (!noNose) k += (skull ? -0.12 : 0.09) * gauss(Math.hypot(x, y + 0.12, z + 1), 0, 0.13);
    k += snout * gauss(Math.hypot(x * 0.8, y + 0.4, z + 0.9), 0, 0.35);
    v.multiplyScalar(k);
    // se corta por debajo de la boca: el mentón lo pone la mandíbula
    if (v.y < mouthY && v.z < 0.2) v.y = mouthY + (v.y - mouthY) * 0.15;
    if (v.z > 0) v.z *= 1.08;
    v.set(v.x * w, v.y * h + 0.215, v.z * d);
  });
  const my = mouthY * h + 0.215;
  paintGeo(g, (x, y, z, c) => {
    paint(x, y, z, c);
    for (const s of [-1, 1]) {
      const e = Math.hypot((x - s * 0.36 * w) / w, (y - 0.215 - 0.06 * h) / h);
      if (z < -0.5 * d && e < 0.24) c.lerp(C(0.02, 0.015, 0.015), clamp01((0.24 - e) / 0.1));
    }
    if (skull && z < -0.8 * d && Math.abs(x) < 0.12 * w && Math.abs(y - (0.215 - 0.12 * h)) < 0.1 * h) c.setRGB(0.03, 0.02, 0.02);
    if (y < my + 0.012 && z < -0.3 * d) c.lerp(C(0.25, 0.03, 0.03), 0.8);             // encías
  });
  const parts = [g];
  // boca: cavidad oscura detrás de los dientes
  const cav = sphere(1, 12, 8);
  cav.scale(w * 0.55, h * 0.3, d * 0.3);
  cav.translate(0, my - 0.012, -d * 0.62);
  parts.push(mouthGlow ? colored(cav, mouthGlow) : colored(cav, C(0.08, 0.01, 0.01)));
  const r = rng(seed + 3);
  const teethRow = (y, dir, n, len, rx, rz) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = lerp(-0.95, 0.95, n === 1 ? 0.5 : i / (n - 1));
      const x = Math.sin(a) * rx, z = -Math.cos(a) * rz;
      const isFang = Math.abs(Math.abs(a) - 0.55) < 0.2 && fang;
      const L = len * (isFang ? 1.9 : 0.8 + r() * 0.5);
      const t = new THREE.ConeGeometry(len * 0.32, L, 5, 1);
      t.translate(0, -L / 2, 0);
      if (dir > 0) t.rotateX(PI);
      t.rotateZ((r() - 0.5) * 0.35);
      t.translate(x, y, z);
      out.push(paintGeo(t, (px, py, pz, c) => c.copy(teethCol).multiplyScalar(0.8 + 0.3 * r())));
    }
    return out;
  };
  parts.push(...teethRow(my + 0.004, -1, teeth, 0.016, w * 0.5, d * 0.82));
  if (tusks) for (const sx of [-1, 1]) parts.push(spike(sx * w * 0.42, my - 0.035, -d * 0.7, sx * 0.2, 1, -0.3, 0.05 * tusks, 0.009, teethCol));
  const neck = limbGeo(0.2, neckR, neckR * 1.15, 10, 2);
  neck.rotateX(PI);
  neck.translate(0, -0.02, 0.01);
  paintGeo(neck, paint);
  parts.push(neck);
  const head = mergeGeos(parts);
  // mandíbula (relativa al pivote de la mandíbula del zombi)
  const jy = my - 0.18;
  const j = new THREE.SphereGeometry(1, 18, 10, 0, TAU, PI * 0.5, PI * 0.5);
  deform(j, (v) => { v.set(v.x * w * 0.78 * jawW, v.y * jawDrop, v.z * d * 0.95 - d * 0.1 * (v.z < 0 ? 1 : 0)); });
  j.translate(0, jy, 0.004);
  paintGeo(j, (x, y, z, c) => { paint(x, y + 0.18, z, c); if (y > jy - 0.012 && z < -0.3 * d) c.lerp(C(0.25, 0.03, 0.03), 0.8); });
  const jp = [j, ...teethRow(jy - 0.002, 1, Math.max(3, teeth - 2), 0.015, w * 0.45 * jawW, d * 0.75)];
  if (tusks) for (const sx of [-1, 1]) jp.push(spike(sx * w * 0.38 * jawW, jy - 0.01, -d * 0.68, sx * 0.25, 1, -0.2, 0.07 * tusks, 0.012, teethCol));
  return { head, jaw: mergeGeos(jp) };
}

// ------------------------------------------------------------------ Ataques y rugidos de los jefes
// Fases de un golpe cuyo impacto cae en W segundos (el mismo windup que usa el servidor): preparación (0 → 0.72·W),
// descarga (0.72·W → W) y recuperación (W + 0.08 → W + 0.58).
function atkPhases(tt, W) {
  return {
    wind: easeInOut(clamp01(tt / (W * 0.72))),
    strike: easeInOut(clamp01((tt - W * 0.72) / (W * 0.28))),
    rec: easeInOut(clamp01((tt - W - 0.08) / 0.5)),
  };
}
// Valor de una articulación: reposo a → preparación b → golpe c → vuelve a a
function k3(a, b, c, P) { return lerp(lerp(lerp(a, b, P.wind), c, P.strike), a, P.rec); }
// Sobrescribe una articulación con un golpe (mezcla desde el valor de la pose actual)
function setK(tp, i, b, c, P) { tp[i] = k3(tp[i], b, c, P); }

// Datos de ataque de un tipo: impacto (windup del servidor) y periodo (cooldown)
function atkInfo(type) {
  const T = ZOMBIE_TYPES[type] || {};
  return { hitTime: T.windup || 0.45, attackPeriod: Math.max((T.windup || 0.45) + 0.7, T.cooldown || 1.3) };
}

// Rugido: al aparecer y de vez en cuando levanta la cabeza, abre la boca y los brazos (solo la parte de arriba:
// las piernas siguen andando). style: 'roar' | 'chest' (golpes en el pecho) | 'scream' (brazos arriba, garras)
function makeRoar(M, K, style = 'roar', every = [9, 16], dur = 1.6) {
  let t = dur, wait = every[0] + Math.random() * (every[1] - every[0]);
  const P = K.P;
  return {
    busy: () => t > 0,
    update(dt, anim) {
      if (anim === ZA.CLIMB || anim === ZA.RISE || anim === ZA.ATTACK || anim === ZA.STUN || (M.flags & ZF.CHARGE)) { if (t > 0 && t < dur) t = 0; return; }
      if (t > 0) { t -= dt; return; }
      wait -= dt;
      if (wait <= 0) { t = dur; wait = every[0] + Math.random() * (every[1] - every[0]); M.jawBoost = 1; }
    },
    apply(tp) {
      if (t <= 0) return;
      const k = Math.sin(PI * clamp01(1 - t / dur));
      const s = Math.min(1, k * 1.6);
      const mix = (i, v) => { tp[i] = lerp(tp[i], v, s); };
      const tt = M.time;
      if (style === 'chest') {
        // gorila: se golpea el pecho con los dos puños alternando
        const a = Math.sin(tt * 16), b = Math.sin(tt * 16 + PI);
        mix(P.LRAISE, 1.25 + 0.35 * a); mix(P.RRAISE, 1.25 + 0.35 * b);
        mix(P.LSPLAY, -0.35); mix(P.RSPLAY, -0.35);
        mix(P.LELB, 1.7); mix(P.RELB, 1.7);
        mix(P.LEAN, -0.15); mix(P.NOD, -0.55); mix(P.JAW, 1);
      } else if (style === 'scream') {
        mix(P.LRAISE, 2.4); mix(P.RRAISE, 2.4); mix(P.LSPLAY, 0.7); mix(P.RSPLAY, 0.7);
        mix(P.LELB, 0.5); mix(P.RELB, 0.5);
        mix(P.LEAN, -0.25); mix(P.NOD, -0.7); mix(P.JAW, 1.2);
        tp[P.TILT] += 0.25 * s * Math.sin(tt * 23);
      } else {
        mix(P.LRAISE, 0.7); mix(P.RRAISE, 0.7); mix(P.LSPLAY, 1.1); mix(P.RSPLAY, 1.1);
        mix(P.LELB, 1.0); mix(P.RELB, 1.0);
        mix(P.LEAN, -0.2); mix(P.NOD, -0.6); mix(P.JAW, 1.1);
        tp[P.ROLL] += 0.06 * s * Math.sin(tt * 19);                     // tiembla de rabia
      }
    },
  };
}

const CACHE = new Map();
function cached(key, make) {
  let v = CACHE.get(key);
  if (!v) { v = make(); CACHE.set(key, v); }
  return v;
}

// ============================================================================================
// El Carnicero: gordo enorme con saco en la cabeza, delantal de cuero ensangrentado, cuchilla y gancho
// ============================================================================================
const BUTCHER_SKIN = C(0.93, 0.8, 0.76);

function butcherTorsoF(u, t, out, grow = 0) {
  const th = u * TAU;                                          // 0 = espalda (+Z), PI = frente (-Z)
  const w = profile(t, [[0, 0.2], [0.2, 0.26], [0.42, 0.29], [0.65, 0.285], [0.82, 0.3], [0.93, 0.2], [1, 0.075]]);
  const d = profile(t, [[0, 0.16], [0.25, 0.19], [0.5, 0.19], [0.75, 0.165], [0.9, 0.14], [1, 0.07]]);
  const front = Math.max(0, -Math.cos(th)), back = Math.max(0, Math.cos(th));
  let x = Math.sin(th) * (w + grow);
  let z = Math.cos(th) * (d + grow);
  let y = -0.12 + t * 0.82;
  // barriga colgante
  const belly = 0.13 * gauss(t, 0.3, 0.17) * Math.pow(front, 1.4);
  z -= belly;
  y -= 0.35 * belly * gauss(t, 0.22, 0.12);
  // pectorales caídos y joroba de grasa en la espalda alta
  z -= 0.035 * gauss(t, 0.68, 0.07) * front * gauss(Math.abs(Math.sin(th)), 0.45, 0.3);
  z += 0.07 * gauss(t, 0.74, 0.13) * back;
  out.set(x, y, z);
  return out;
}

function butcherGeos() {
  return cached('butcher', () => {
    const r = rng(41);
    const torso = surface((u, v, o) => butcherTorsoF(u, v, o), 40, 26, (x, y, z, c, u, v) => {
      c.copy(BUTCHER_SKIN);
      // moratones y manchas
      const n = fbm(x * 9 + 3, y * 9 + z * 4, 7, 3);
      if (n > 0.62) c.lerp(C(0.45, 0.3, 0.45), (n - 0.62) * 2.2);
      // cicatriz cosida en el pecho (en diagonal)
      const sy = 0.5 + x * 0.35;
      if (z < 0 && Math.abs(y - sy) < 0.011 && Math.abs(x) < 0.2) c.setRGB(0.35, 0.05, 0.05);
      if (z < 0 && Math.abs(x) < 0.2 && Math.abs(y - sy) < 0.03 && Math.abs(((x * 60) % 1)) < 0.18) c.setRGB(0.12, 0.08, 0.06);
      // sangre salpicada que cae desde el pecho
      const b = fbm(x * 5 + 11, y * 2.5, 13, 3);
      if (b > 0.58 && y > 0.1) c.lerp(C(0.4, 0.03, 0.02), clamp01((b - 0.58) * 4));
    });
    // delantal: sigue la barriga y cuelga hasta las rodillas
    const apron = surface((u, v, o) => {
      const y = -0.62 + v * 1.12;
      const bib = y > 0.22 ? lerp(1, 0.5, clamp01((y - 0.22) / 0.25)) : 1;
      const uu = 0.5 + (u - 0.5) * 0.36 * bib;
      const t = clamp01((y + 0.12) / 0.82);
      butcherTorsoF(uu, t, o, 0.018);
      if (y < -0.12) {
        const k = (-0.12 - y);
        o.x *= 1 + k * 0.35;
        o.z -= 0.03 + k * 0.08;
        o.y = y;
        const hem = (valueNoise(u * 14, 3.7, 5) - 0.5) * 0.06 * smoothstep(-0.45, -0.62, y);
        o.y += hem;
      }
    }, 18, 34, (x, y, z, c) => {
      c.setRGB(0.62, 0.58, 0.5);
      const g = fbm(x * 6, y * 6, 21, 3);
      c.multiplyScalar(0.75 + 0.35 * g);
      const b = fbm(x * 4 + 5, y * 3 + 2, 33, 3) + 0.25 * smoothstep(0.2, -0.5, y) - 0.12 * Math.abs(x) * 3;
      if (b > 0.5) c.lerp(C(0.33, 0.02, 0.02), clamp01((b - 0.5) * 3.5));
      if (b > 0.75) c.lerp(C(0.18, 0.0, 0.0), clamp01((b - 0.75) * 4));
    });
    // correas del delantal (cuello y cintura) y cinturón con ganchos
    const strap = C(0.25, 0.17, 0.1);
    const parts = [];
    const waist = new THREE.TorusGeometry(1, 0.1, 6, 40);
    waist.rotateX(PI / 2);
    deform(waist, (v) => { const a = Math.atan2(v.x, v.z); const o = butcherTorsoF(a / TAU + (a < 0 ? 1 : 0), 0.2, new THREE.Vector3(), 0.02); v.set(o.x * (1 + 0.1 * (v.length() - 1)), o.y + v.y * 0.12, o.z); });
    parts.push(colored(waist, strap));
    for (const s of [-1, 1]) {
      parts.push(tube([[s * 0.1, 0.46, -0.21], [s * 0.1, 0.6, -0.14], [s * 0.06, 0.7, -0.02], [s * 0.05, 0.69, 0.08]], 0.009, 12, 6, (x, y, z, c) => c.copy(strap)));
    }
    // ganchos y cuchillos colgando del cinturón
    const steel = C(0.55, 0.53, 0.5), rust = C(0.42, 0.22, 0.1);
    for (const [x, zz] of [[0.28, 0.02], [0.24, 0.12], [-0.27, 0.06]]) {
      parts.push(tube([[x, 0.02, zz], [x, -0.1, zz - 0.01], [x + 0.01 * Math.sign(x), -0.17, zz - 0.04], [x, -0.19, zz - 0.08], [x, -0.15, zz - 0.1]], 0.007, 14, 6,
        (px, py, pz, c) => c.copy(steel).lerp(rust, fbm(py * 30, px * 30, 3) > 0.5 ? 0.7 : 0.2)));
    }
    const knife = roundedBox(0.006, 0.16, 0.035, 0.003, 1);
    knife.translate(-0.3, -0.06, -0.06);
    parts.push(paintGeo(knife, (x, y, z, c) => c.copy(steel).lerp(C(0.4, 0.02, 0.02), y < -0.08 ? 0.7 : 0)));
    // gancho de carnicero clavado en la espalda
    parts.push(tube([[0.12, 0.62, 0.2], [0.14, 0.5, 0.27], [0.16, 0.36, 0.25], [0.15, 0.3, 0.17], [0.13, 0.34, 0.12]], 0.011, 16, 6,
      (x, y, z, c) => c.copy(rust).lerp(C(0.3, 0.02, 0.02), y < 0.4 ? 0.5 : 0)));
    const extras = mergeGeos(parts);

    // cabeza: saco de arpillera atado al cuello, con agujeros rasgados para los ojos y una boca cosida
    const sack = new THREE.SphereGeometry(1, 30, 22);
    deform(sack, (v) => {
      const n = fbm(v.x * 3 + 2, v.y * 3 + v.z * 2, 17, 3);
      let k = 1 + (n - 0.5) * 0.18;
      if (v.y > 0.6) k *= 1 + 0.2 * (v.y - 0.6);                 // pico arrugado arriba
      v.multiplyScalar(k);
      if (v.y < -0.55) v.multiplyScalar(0.75 + 0.25 * smoothstep(-1, -0.55, v.y));   // se cierra en el cuello
      v.set(v.x * 0.132, v.y * 0.155 + 0.22, v.z * 0.14 - 0.004);
    });
    paintGeo(sack, (x, y, z, c) => {
      c.setRGB(0.58, 0.47, 0.32);
      const weave = (Math.sin(x * 420) * Math.sin(y * 420)) * 0.06;
      c.multiplyScalar(0.8 + weave + 0.3 * fbm(x * 20, y * 20 + z * 10, 5, 2));
      for (const s of [-1, 1]) {
        const e = Math.hypot((x - s * 0.047) / 1.3, y - 0.235);
        if (z < 0 && e < 0.028 + 0.008 * fbm(x * 80, y * 80, 9, 1)) c.setRGB(0.02, 0.01, 0.01);
        else if (z < 0 && e < 0.04) c.multiplyScalar(0.55);
      }
      // boca cosida con hilo rojo
      if (z < 0 && Math.abs(y - (0.155 + 0.02 * Math.abs(x) * 4)) < 0.006 && Math.abs(x) < 0.06) c.setRGB(0.25, 0.03, 0.03);
      if (z < 0 && Math.abs(x) < 0.06 && Math.abs(y - 0.155) < 0.018 && Math.abs((x * 90) % 1) < 0.22) c.setRGB(0.5, 0.06, 0.05);
      // sangre empapada desde la boca
      const b = fbm(x * 8 + 1, y * 5, 45, 2);
      if (z < -0.05 && y < 0.17 && b > 0.45) c.lerp(C(0.3, 0.02, 0.02), 0.8);
    });
    const rope = new THREE.TorusGeometry(0.075, 0.012, 6, 20);
    rope.rotateX(PI / 2);
    rope.translate(0, 0.095, 0.004);
    colored(rope, C(0.45, 0.36, 0.2));
    const knot = tube([[0.02, 0.095, 0.075], [0.03, 0.06, 0.1], [0.025, 0.02, 0.105]], 0.009, 8, 5, (x, y, z, c) => c.setRGB(0.45, 0.36, 0.2));
    const head = mergeGeos([sack, rope, knot]);

    // brazos enormes (sin mangas), antebrazos ensangrentados
    const upper = mergeGeos([
      armGeo(0.3, 0.095, 0.078, { bulge: 0.18, bulgeAt: 0.45, skin: BUTCHER_SKIN }),
      at(sphere(0.105, 18, 12), 0, -0.02, 0, 0, 0, 0, [1, 0.9, 1]),
    ]);
    paintGeo(upper, (x, y, z, c) => { c.copy(BUTCHER_SKIN); const n = fbm(x * 12, y * 12 + z * 7, 29, 2); if (n > 0.64) c.lerp(C(0.5, 0.32, 0.45), 0.5); });
    const fore = armGeo(0.26, 0.082, 0.062, { bulge: 0.25, bulgeAt: 0.25, skin: BUTCHER_SKIN, paint: (x, y, z, c) => {
      const b = fbm(x * 14 + 3, y * 9, 51, 3) + 0.4 * smoothstep(-0.05, -0.24, y);
      if (b > 0.62) c.lerp(C(0.36, 0.02, 0.02), clamp01((b - 0.62) * 3));
    } });
    const hand = handGeo({ palmW: 0.075, palmL: 0.09, fingerR: 0.012, fingerL: 0.075, curl: 1.0, skin: BUTCHER_SKIN, bloody: 0.45, seed: 5 });
    hand.translate(0, -0.25, 0);
    const foreArm = mergeGeos([fore, hand]);

    // cuchilla de carnicero: mango de madera y hoja ancha con el filo hacia delante (-Z)
    const shape = new THREE.Shape();
    shape.moveTo(0.03, 0);
    shape.lineTo(0.035, -0.4);
    shape.quadraticCurveTo(-0.08, -0.44, -0.2, -0.4);
    shape.lineTo(-0.19, -0.02);
    shape.quadraticCurveTo(-0.1, 0.01, 0.03, 0);
    const hole = new THREE.Path();
    hole.absarc(-0.13, -0.06, 0.018, 0, TAU, true);
    shape.holes.push(hole);
    const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 10 });
    blade.translate(0, 0, -0.006);
    blade.rotateY(PI / 2);                                        // plano de la hoja = YZ, filo hacia -Z
    blade.translate(0, -0.2, 0);
    paintGeo(blade, (x, y, z, c) => {
      c.setRGB(0.72, 0.72, 0.74);
      c.multiplyScalar(0.75 + 0.3 * fbm(y * 20, z * 20, 3, 2));
      if (z < -0.14 && Math.abs(x) < 0.02) c.setRGB(0.9, 0.9, 0.92);   // filo brillante
      const b = fbm(y * 9 + 4, z * 9, 77, 3) + 0.5 * smoothstep(-0.08, -0.2, z);
      if (b > 0.7) c.lerp(C(0.35, 0.02, 0.02), clamp01((b - 0.7) * 3));
    });
    const handle2 = limbGeo(0.2, 0.022, 0.02, 8, 1);
    handle2.translate(0, 0.02, 0);
    colored(handle2, C(0.32, 0.2, 0.12));
    const cleaver = mergeGeos([blade, handle2]);

    // gancho de carnicero en la mano izquierda con un trozo de cadena
    const links = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.TorusGeometry(0.018, 0.005, 5, 10);
      if (i % 2) l.rotateY(PI / 2);
      l.translate(0, -0.03 - i * 0.03, 0);
      links.push(colored(l, C(0.35, 0.33, 0.3)));
    }
    links.push(tube([[0, -0.14, 0], [0, -0.26, -0.01], [0.005, -0.34, -0.05], [0, -0.36, -0.11], [0, -0.3, -0.14]], 0.01, 18, 6,
      (x, y, z, c) => c.setRGB(0.45, 0.25, 0.12).lerp(C(0.3, 0.02, 0.02), y < -0.3 ? 0.6 : 0.1), (k) => 1 - 0.6 * smoothstep(0.7, 1, k)));
    const hook = mergeGeos(links);
    return { torso, apron, extras, head, upper, foreArm, cleaver, hook };
  });
}

function buildButcher(M, K) {
  const G = butcherGeos();
  const q = M.A.quality;
  const mats = cached('butcherMats:' + q, () => ({
    skin: makeMat(q, { map: grimeTexture(), vertexColors: true, roughness: 0.55, color: 0xc0a8a0 }),
    cloth: makeMat(q, { map: grimeTexture(), vertexColors: true, roughness: 0.8, color: 0xc8c0b4, side: THREE.DoubleSide }),
    metal: makeMat(q, { vertexColors: true, roughness: 0.35, metalness: 0.75 }),
    sack: makeMat(q, { map: grimeTexture(), vertexColors: true, roughness: 1 }),
  }));
  K.hideBase({ head: true, arms: true, torso: true });
  M.group.scale.set(1.7, 1.7, 1.7);
  K.mesh(G.torso, mats.skin, M.spine, true);
  K.mesh(G.apron, mats.cloth, M.spine, true);
  K.mesh(G.extras, mats.metal, M.spine, true);
  K.mesh(G.head, mats.sack, M.neck, true);
  // ojos: brillan dentro de los agujeros del saco
  M.eyes.material = K.T.eyesRed;
  M.eyes.position.set(0, 0.02, -0.052);
  M.eyes.scale.set(1.25, 1, 1);
  M.halo.position.set(0, 0.02, -0.055);
  for (const arm of [M.armL, M.armR]) {
    K.mesh(G.upper, mats.skin, arm.sh, true);
    K.mesh(G.foreArm, mats.skin, arm.el, true);
  }
  const cleaver = K.mesh(G.cleaver, mats.metal, M.armR.hand, true);
  cleaver.position.set(0.01, 0.06, 0);
  const hook = K.mesh(G.hook, mats.metal, M.armL.hand, true);
  hook.position.set(0, 0.05, 0);
  // piernas gruesas
  for (const leg of [M.legL, M.legR]) { leg.tm.scale.set(1.75, 1, 1.6); leg.sm.scale.set(1.55, 1, 1.45); leg.ft.scale.set(1.4, 1.2, 1.2); }
  const AI = atkInfo('butcher');
  const roar = makeRoar(M, K, 'roar');
  return {
    ...AI, stagger: 0.35, ownAttack: true,
    update(dt) { roar.update(dt, M.anim); },
    pose(tp, anim, c) {
      if (anim === ZA.ATTACK) {
        // tajo: sube la cuchilla por detrás de la cabeza girando el tronco y la descarga en diagonal
        const P = atkPhases(M.animT % AI.attackPeriod, AI.hitTime), I = K.P;
        setK(tp, I.RRAISE, 3.0, 0.45, P); setK(tp, I.RELB, 1.5, 0.1, P); setK(tp, I.RSPLAY, 0.45, -0.25, P);
        setK(tp, I.TWIST, -0.4, 0.45, P); setK(tp, I.LEAN, -0.12, 0.6, P); setK(tp, I.NOD, -0.3, 0.1, P);
        setK(tp, I.LRAISE, 1.1, 0.5, P); setK(tp, I.LELB, 0.8, 0.4, P); setK(tp, I.LSPLAY, 0.3, 0.5, P);
        setK(tp, I.LKNEE, 0.15, 0.5, P); setK(tp, I.RKNEE, 0.15, 0.45, P);
        tp[I.JAW] = 0.6 + 0.4 * P.wind;
        return;
      }
      const charging = !!(M.flags & ZF.CHARGE);
      if (charging) {
        // embestida: cabeza gacha, cuchilla atrás y el gancho por delante
        tp[K.P.LEAN] = 0.55; tp[K.P.NOD] = -0.45;
        tp[K.P.RRAISE] = 2.3 + 0.15 * Math.sin(M.time * 14); tp[K.P.RELB] = 1.3; tp[K.P.RSPLAY] = 0.35;
        tp[K.P.LRAISE] = 0.9; tp[K.P.LELB] = 0.6; tp[K.P.LSPLAY] = 0.3;
        tp[K.P.JAW] = 0.8;
        return;
      }
      if (anim === ZA.WALK || anim === ZA.RUN || anim === ZA.IDLE) {
        // andar pesado: se balancea de lado a lado, la cuchilla cuelga y el gancho oscila
        const s = Math.sin(c);
        tp[K.P.ROLL] = 0.13 * s; tp[K.P.HIPROLL] = 0.08 * s;
        tp[K.P.LEAN] = 0.24 + 0.03 * Math.sin(M.time * 1.7);     // respiración pesada
        tp[K.P.NOD] = 0.05;
        tp[K.P.RRAISE] = 0.28 - 0.18 * s; tp[K.P.RELB] = 0.55; tp[K.P.RSPLAY] = 0.28;
        tp[K.P.LRAISE] = 0.25 + 0.2 * s; tp[K.P.LELB] = 0.35; tp[K.P.LSPLAY] = 0.3;
      }
      roar.apply(tp);
    },
  };
}

// ============================================================================================
// La Madre Plaga: cuerpo hinchado y deforme lleno de bubones que brillan, sacos de huevos en la espalda,
// brazos largos y huesudos, boca abierta que chorrea bilis y una nube tóxica alrededor
// ============================================================================================
const PLAGUE_SKIN = C(0.78, 0.8, 0.55);
const plagueTorsoF = torsoFn({
  y0: -0.16, h: 0.84, seed: 9, lump: 0.07, belly: 0.13, bellyAt: 0.3, hump: 0.12, humpAt: 0.7,
  w: [[0, 0.21], [0.25, 0.32], [0.5, 0.34], [0.72, 0.29], [0.88, 0.22], [1, 0.075]],
  d: [[0, 0.19], [0.3, 0.28], [0.55, 0.27], [0.8, 0.2], [1, 0.075]],
});
const PLAGUE_BURST = [[0.42, 0.45], [0.61, 0.3], [0.2, 0.55], [0.85, 0.4], [0.55, 0.62]];

function plagueGeos() {
  return cached('plague', () => {
    const r = rng(77);
    const burst = PLAGUE_BURST.map(([u, t]) => plagueTorsoF(u, t, new THREE.Vector3()));
    const skinPaint = (x, y, z, c) => {
      c.copy(PLAGUE_SKIN);
      const n = fbm(x * 6 + 1, y * 6 + z * 3, 3, 3);
      c.lerp(C(0.45, 0.55, 0.25), clamp01((n - 0.4) * 2));
      c.lerp(C(0.55, 0.4, 0.5), clamp01((fbm(x * 11, z * 11 + y * 4, 8, 2) - 0.62) * 3));  // cardenales
      // venas oscuras
      const v = fbm(x * 9 + 7, y * 9 + z * 5, 19, 3);
      if (Math.abs(v - 0.5) < 0.016) c.setRGB(0.18, 0.28, 0.12);
      // bubones reventados: cráter oscuro con borde amarillento
      for (const b of burst) {
        const d = Math.hypot(x - b.x, y - b.y, z - b.z);
        if (d < 0.045) c.lerp(C(0.12, 0.16, 0.04), 1 - d / 0.045);
        else if (d < 0.06) c.lerp(C(0.85, 0.8, 0.3), 0.5);
      }
    };
    const torsoS = surface((u, v, o) => plagueTorsoF(u, v, o), 44, 28, (x, y, z, c) => skinPaint(x, y, z, c));
    // bubones que brillan (emisivos), repartidos por el cuerpo
    const pust = [];
    for (let i = 0; i < 26; i++) {
      const u = r(), t = 0.1 + r() * 0.78;
      const rad = 0.018 + r() * r() * 0.05;
      const { p, n } = torsoPoint(plagueTorsoF, u, t, rad * 0.35);
      const g = sphere(rad, 10, 8);
      g.scale(1, 1, 0.7);
      g.lookAt(n);
      g.translate(p.x, p.y, p.z);
      pust.push(paintGeo(g, (x, y, z, c) => c.setRGB(0.9, 1, 0.6)));
    }
    const pustules = mergeGeos(pust);
    // sacos de huevos en la espalda alta
    const eggs = [];
    for (let i = 0; i < 9; i++) {
      const u = 0.12 * (r() - 0.5) + (r() < 0.5 ? 0.06 : -0.06), t = 0.52 + r() * 0.3;
      const rad = 0.04 + r() * 0.045;
      const { p, n } = torsoPoint(plagueTorsoF, (u + 1) % 1, t, rad * 0.55);
      const g = sphere(rad, 12, 9);
      g.translate(p.x, p.y, p.z);
      eggs.push(paintGeo(g, (x, y, z, c) => { c.setRGB(0.75, 0.85, 0.45); if (fbm(x * 60, y * 60, 3, 1) > 0.62) c.setRGB(0.3, 0.35, 0.12); }));
    }
    const eggSacs = mergeGeos(eggs);
    // tumor enorme que le deforma el hombro izquierdo y el cuello
    const tum = [];
    for (let i = 0; i < 7; i++) {
      const g = sphere(0.05 + r() * 0.05, 14, 10);
      deform(g, (v) => v.multiplyScalar(1 + (fbm(v.x * 30, v.y * 30 + v.z * 20, i, 2) - 0.5) * 0.4));
      g.translate(-0.17 + (r() - 0.5) * 0.12, 0.58 + (r() - 0.5) * 0.12, 0.02 + (r() - 0.5) * 0.1);
      tum.push(paintGeo(g, (x, y, z, c) => { skinPaint(x, y, z, c); c.lerp(C(0.55, 0.4, 0.45), 0.3); }));
    }
    // falda / camisón hecho jirones desde la cadera
    const skirt = surface((u, v, o) => {
      const th = u * TAU;
      const y = 0.06 - (1 - v) * 0.66;
      const t = 1 - v;
      const rr = lerp(0.27, 0.36, t) + 0.02 * Math.sin(th * 7);
      let yy = y;
      if (t > 0.8) yy += (valueNoise(u * 22, 1.3, 4) - 0.25) * 0.22 * (t - 0.8) / 0.2;
      o.set(Math.sin(th) * rr, yy, Math.cos(th) * rr * 0.9 - 0.02);
    }, 36, 10, (x, y, z, c) => {
      c.setRGB(0.55, 0.58, 0.48);
      c.multiplyScalar(0.7 + 0.4 * fbm(x * 7, y * 7, 5, 2));
      if (fbm(x * 5 + 3, y * 4, 12, 3) > 0.55) c.lerp(C(0.35, 0.4, 0.12), 0.6);
      if (fbm(x * 6, y * 5 + 7, 31, 3) > 0.63) c.lerp(C(0.3, 0.05, 0.03), 0.5);
    });
    // cabeza calva y deforme con unas fauces llenas de colmillos (dentro brilla la bilis)
    const mh = monsterHead({ w: 0.108, h: 0.122, d: 0.118, brow: 0.14, sockets: 0.24, cheeks: 0.12, lumps: 0.1, seed: 23, teeth: 11,
      jawW: 1.15, jawDrop: 0.085, neckR: 0.065, mouthGlow: C(0.35, 0.9, 0.2), teethCol: C(0.75, 0.72, 0.45), paint: (x, y, z, c) => skinPaint(x * 1.5, y, z * 1.5, c) });
    const headAll = mh.head;
    // babas de bilis colgando de la mandíbula
    const drool = [];
    for (const [x, len] of [[-0.035, 0.22], [0.01, 0.32], [0.04, 0.16]]) {
      drool.push(tube([[x, -0.02, -0.085], [x * 1.1, -len * 0.4, -0.095], [x * 1.2, -len * 0.8, -0.09], [x * 1.25, -len, -0.08]], 0.006, 12, 5,
        (px, py, pz, c) => c.setRGB(0.6, 1, 0.3), (k) => 1 - 0.55 * k + 0.5 * gauss(k, 1, 0.08)));
    }
    const bile = mergeGeos(drool);
    // brazos largos y huesudos con garras
    const upper = mergeGeos([armGeo(0.34, 0.05, 0.036, { bulge: 0, skin: PLAGUE_SKIN }), at(sphere(0.06, 14, 10), 0, -0.01, 0)]);
    paintGeo(upper, (x, y, z, c) => skinPaint(x * 2, y, z * 2, c));
    const fore = mergeGeos([armGeo(0.3, 0.042, 0.03, { bulge: 0, skin: PLAGUE_SKIN }), at(sphere(0.047, 12, 9), 0, 0, 0)]);
    paintGeo(fore, (x, y, z, c) => skinPaint(x * 2, y, z * 2, c));
    const hand = handGeo({ palmW: 0.05, palmL: 0.08, fingerR: 0.0065, fingerL: 0.09, claw: 0.035, curl: 0.45, skin: C(0.72, 0.74, 0.5), nail: C(0.15, 0.13, 0.05), seed: 13 });
    hand.translate(0, -0.3, 0);
    const torso = mergeGeos([torsoS, ...tum]);
    return { torso, pustules, eggSacs, skirt, head: headAll, jaw: mh.jaw, bile, upper, fore: mergeGeos([fore, hand]) };
  });
}

function buildPlague(M, K) {
  const G = plagueGeos();
  const q = M.A.quality;
  const mats = cached('plagueMats:' + q, () => ({
    skin: makeMat(q, { map: grimeTexture(), vertexColors: true, roughness: 0.38, color: 0xb4b89c }),
    cloth: makeMat(q, { map: grimeTexture(), vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
    egg: makeMat(q, { vertexColors: true, roughness: 0.2, transparent: true, opacity: 0.85, emissive: 0x3a7a10, emissiveIntensity: 0.6 }),
    bile: new THREE.MeshBasicMaterial({ color: 0x9aff4a, transparent: true, opacity: 0.8, toneMapped: false }),
  }));
  K.hideBase({ head: true, torso: true, arms: true, pelvis: true });
  M.group.scale.set(1.5, 1.4, 1.5);
  const torso = K.mesh(G.torso, mats.skin, M.spine, true);
  M.pustMat = K.T.plagueSpot.clone();
  M.pustMat.vertexColors = true;
  const pust = K.mesh(G.pustules, M.pustMat, M.spine);
  const eggs = K.mesh(G.eggSacs, mats.egg.clone(), M.spine);
  K.mesh(G.skirt, mats.cloth, M.hips, true);
  K.mesh(G.head, mats.skin, M.neck, true);
  K.mesh(G.jaw, mats.skin, K.jaw(), true);
  K.mesh(G.bile, mats.bile, K.jaw());
  M.eyes.material = K.T.eyesYellow;
  M.eyes.scale.setScalar(0.7);
  M.eyes.position.z = 0.012;
  // brazos largos
  for (const arm of [M.armL, M.armR]) {
    arm.el.position.y = -0.34;
    arm.hand.position.y = -0.36;
    K.mesh(G.upper, mats.skin, arm.sh, true);
    K.mesh(G.fore, mats.skin, arm.el, true);
  }
  for (const leg of [M.legL, M.legR]) { leg.tm.material = mats.skin; leg.sm.material = mats.skin; leg.tm.scale.set(0.85, 1, 0.85); leg.sm.scale.set(0.8, 1, 0.8); }
  // nube tóxica: bocanadas verdes que suben alrededor
  const puffTex = cached('puffTex', () => glowTexture(64, 1.4));
  const gas = [];
  for (let i = 0; i < 9; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0x7aff3a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    M.group.add(sp);
    gas.push({ sp, t: i / 9 * 3, a: K.r() * TAU, rad: 0.3 + K.r() * 0.35 });
  }
  M._aura(0x7aff3a, 2.4, 0.22);
  const AI = atkInfo('plague');
  const roar = makeRoar(M, K, 'roar', [10, 18]);
  return {
    ...AI, stagger: 0.5, ownAttack: true,
    pose(tp, anim, c) {
      if (anim === ZA.ATTACK) {
        // agarra con los dos brazos y lanza un bocado; en la preparación abre las fauces del todo
        const P = atkPhases(M.animT % AI.attackPeriod, AI.hitTime), I = K.P;
        setK(tp, I.LRAISE, 1.7, 1.35, P); setK(tp, I.RRAISE, 1.7, 1.35, P);
        setK(tp, I.LSPLAY, 0.75, -0.2, P); setK(tp, I.RSPLAY, 0.75, -0.2, P);
        setK(tp, I.LELB, 0.2, 1.2, P); setK(tp, I.RELB, 0.2, 1.2, P);
        setK(tp, I.LEAN, 0.2, 0.75, P); setK(tp, I.NOD, -0.45, 0.25, P);
        tp[I.JAW] = 0.4 + 0.9 * P.wind * (1 - P.strike) + 0.2;
        return;
      }
      // encorvada bajo su propio peso, cabeza colgando, brazos largos que casi arrastran
      const s = Math.sin(c);
      tp[K.P.LEAN] = 0.4 + 0.04 * Math.sin(M.time * 1.3);
      tp[K.P.NOD] = -0.12;
      tp[K.P.JAW] = 0.7 + 0.25 * Math.sin(M.time * 2.1);
      tp[K.P.TILT] = 0.2 * Math.sin(M.time * 0.7);
      if (anim === ZA.WALK || anim === ZA.RUN || anim === ZA.IDLE || anim === ZA.SPRINT) {
        tp[K.P.ROLL] = 0.16 * s; tp[K.P.HIPROLL] = 0.1 * s;
        tp[K.P.LRAISE] = 0.55 + 0.25 * s; tp[K.P.RRAISE] = 0.55 - 0.25 * s;
        tp[K.P.LELB] = tp[K.P.RELB] = 0.35;
        tp[K.P.LSPLAY] = tp[K.P.RSPLAY] = 0.28;
      }
      roar.apply(tp);
    },
    update(dt) {
      roar.update(dt, M.anim);
      // respiración: el cuerpo y los huevos laten
      const br = 1 + 0.035 * Math.sin(M.time * 2.2);
      torso.scale.set(br, 1, br);
      pust.scale.set(br, 1, br);
      eggs.scale.setScalar(1 + 0.05 * Math.sin(M.time * 3.1 + 1));
      eggs.material.emissiveIntensity = 0.5 + 0.4 * Math.sin(M.time * 3.1 + 1);
      for (const g of gas) {
        g.t += dt;
        const life = 3;
        if (g.t > life) { g.t -= life; g.a = Math.random() * TAU; g.rad = 0.25 + Math.random() * 0.4; }
        const k = g.t / life;
        g.sp.position.set(Math.sin(g.a) * g.rad * (1 + k), 0.4 + k * 1.3, Math.cos(g.a) * g.rad * (1 + k));
        g.sp.scale.setScalar(0.35 + k * 0.6);
        g.sp.material.opacity = 0.22 * Math.sin(PI * k);
      }
    },
  };
}

// ============================================================================================
// El Nigromante: flota envuelto en una túnica hecha jirones, con capucha y cara de calavera, manto de huesos,
// bastón retorcido con una calavera y un orbe, y runas que orbitan a su alrededor
// ============================================================================================
const ROBE = C(0.16, 0.12, 0.2);
const BONE = C(0.86, 0.82, 0.7);

function runeTexture(seed) {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const r = rng(seed);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.shadowColor = '#ffffff';
  g.shadowBlur = 8;
  g.beginPath();
  g.arc(32, 32, 24, 0, TAU);
  g.stroke();
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = r() * TAU, b = r() * TAU;
    g.moveTo(32 + Math.cos(a) * 18, 32 + Math.sin(a) * 18);
    g.lineTo(32 + Math.cos(b) * 12 * r(), 32 + Math.sin(b) * 12 * r());
  }
  g.stroke();
  return canvasTexture(c);
}

function necroGeos() {
  return cached('necro', () => {
    const r = rng(55);
    const clothPaint = (x, y, z, c) => {
      c.copy(ROBE);
      c.multiplyScalar(0.7 + 0.5 * fbm(x * 8, y * 8 + z * 3, 3, 3));
      // bordados morados apagados
      if (Math.abs(fbm(x * 4 + 2, y * 4, 41, 2) - 0.5) < 0.006) c.setRGB(0.3, 0.15, 0.38);
    };
    const bodyF = torsoFn({ y0: -0.1, h: 0.8, w: [[0, 0.17], [0.5, 0.18], [0.8, 0.22], [0.92, 0.2], [1, 0.1]], d: [[0, 0.13], [0.5, 0.12], [0.8, 0.14], [1, 0.09]] });
    const body = surface((u, v, o) => bodyF(u, v, o), 32, 16, clothPaint);
    // falda larga hasta el suelo, con el bajo hecho jirones
    const skirt = surface((u, v, o) => {
      const th = u * TAU;
      const t = 1 - v;
      const y = 0.08 - t * 0.86;
      let rr = lerp(0.19, 0.4, Math.pow(t, 1.3)) + 0.025 * Math.sin(th * 9 + t * 3);
      let yy = y;
      if (t > 0.78) yy += (valueNoise(u * 30, 2.1, 8) - 0.2) * 0.3 * (t - 0.78) / 0.22;
      o.set(Math.sin(th) * rr, yy, Math.cos(th) * rr * 0.95);
    }, 48, 14, (x, y, z, c) => { clothPaint(x, y, z, c); c.multiplyScalar(0.8 + 0.25 * smoothstep(-0.8, 0, y)); });
    // cuello alto de la capa con el borde en picos
    const mantle = surface((u, v, o) => {
      const th = u * TAU;
      const y = 0.46 + v * 0.3;
      let rr = lerp(0.27, 0.16, v);
      const spikes = v > 0.8 ? (Math.abs(Math.sin(th * 7)) - 0.5) * 0.12 * (v - 0.8) / 0.2 : 0;
      o.set(Math.sin(th) * rr, y + spikes, Math.cos(th) * rr * 0.85 + 0.02);
    }, 40, 6, clothPaint);
    // hombreras de hueso: púas curvas
    const bones = [];
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const x = s * (0.18 + i * 0.03), z = -0.06 + i * 0.05;
        bones.push(tube([[x, 0.56, z], [x + s * 0.05, 0.66, z + 0.02], [x + s * 0.07, 0.76 + i * 0.02, z + 0.06]], 0.018, 10, 6,
          (px, py, pz, c) => c.copy(BONE).multiplyScalar(0.8 + 0.2 * Math.sin(py * 80)), (k) => 1 - 0.9 * k));
      }
    }
    // pequeñas calaveras colgando del pecho
    for (const [x, y] of [[-0.08, 0.3], [0.09, 0.26], [0, 0.18]]) {
      const sk = sphere(0.032, 10, 8);
      sk.scale(1, 1.1, 1);
      sk.translate(x, y, -0.15);
      bones.push(paintGeo(sk, (px, py, pz, c) => {
        c.copy(BONE);
        for (const e of [-1, 1]) if (Math.hypot(px - x - e * 0.011, py - y - 0.005) < 0.008 && pz < -0.17) c.setRGB(0.05, 0.03, 0.05);
      }));
    }
    const boneParts = mergeGeos(bones);
    // capucha: casco abierto por delante que acaba en punta caída hacia atrás
    const hood = new THREE.SphereGeometry(1, 32, 20, 1.5 * PI + 0.95, TAU - 1.9, 0, PI * 0.78);
    deform(hood, (v) => {
      if (v.y > 0.3) { v.z += 0.5 * (v.y - 0.3) * (v.y - 0.3) * 2; v.y += 0.25 * (v.y - 0.3); }
      v.set(v.x * 0.15, v.y * 0.17 + 0.24, v.z * 0.16 + 0.015);
    });
    paintGeo(hood, (x, y, z, c) => { clothPaint(x, y, z, c); if (z < -0.08) c.multiplyScalar(0.6); });
    const hoodIn = new THREE.SphereGeometry(1, 20, 12, 1.5 * PI + 0.95, TAU - 1.9, 0, PI * 0.78);
    hoodIn.scale(0.142, 0.16, 0.152);
    hoodIn.translate(0, 0.24, 0.02);
    colored(hoodIn, C(0.02, 0.015, 0.03));
    // calavera de verdad: cuencas profundas, fosa nasal, pómulos y dientes
    const sk = monsterHead({ w: 0.086, h: 0.1, d: 0.098, brow: 0.1, sockets: 0.3, socketW: 0.21, cheeks: 0.18, skull: 1, seed: 61, teeth: 12,
      fang: 0, jawW: 0.95, jawDrop: 0.06, neckR: 0.022, teethCol: C(0.85, 0.8, 0.66),
      paint: (x, y, z, c) => { c.copy(BONE).multiplyScalar(0.72 + 0.32 * fbm(x * 30, y * 30 + z * 10, 7, 2)); if (Math.abs(fbm(x * 20 + 1, y * 20, 13, 2) - 0.5) < 0.01) c.multiplyScalar(0.5); } });
    const skull = sk.head;
    // mangas acampanadas y manos esqueléticas
    const upper = armGeo(0.28, 0.07, 0.075, { bulge: 0.05, skin: ROBE, paint: clothPaint, radial: 14 });
    const sleeve = limbGeo(0.26, 0.075, 0.13, 10, 2, 0.08, 3);
    paintGeo(sleeve, clothPaint);
    const hand = handGeo({ palmW: 0.045, palmL: 0.075, fingerR: 0.0055, fingerL: 0.1, claw: 0.025, curl: 0.5, skin: BONE, nail: C(0.2, 0.15, 0.2), seed: 17 });
    hand.translate(0, -0.25, 0);
    const wrist = limbGeo(0.08, 0.018, 0.016, 6, 1);
    wrist.translate(0, -0.18, 0);
    colored(wrist, BONE);
    // bastón retorcido con una corona de ramas que sujeta el orbe y una calavera
    const staffPts = [];
    for (let i = 0; i <= 10; i++) { const y = -1.05 + i * 0.17; staffPts.push([(valueNoise(i * 0.8, 1, 3) - 0.5) * 0.05, y, (valueNoise(i * 0.8, 4, 3) - 0.5) * 0.05]); }
    const wood = C(0.3, 0.22, 0.16);
    const sp = [tube(staffPts, 0.02, 40, 7, (x, y, z, c) => c.copy(wood).multiplyScalar(0.7 + 0.4 * fbm(y * 20, x * 60, 5, 2)), (k) => 0.7 + 0.35 * k)];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      sp.push(tube([[0, 0.6, 0], [Math.cos(a) * 0.07, 0.68, Math.sin(a) * 0.07], [Math.cos(a) * 0.09, 0.78, Math.sin(a) * 0.09], [Math.cos(a) * 0.04, 0.88, Math.sin(a) * 0.04]], 0.009, 12, 5,
        (x, y, z, c) => c.copy(wood), (k) => 1 - 0.7 * k));
    }
    const ssk = sphere(0.045, 12, 10);
    ssk.scale(1, 1.1, 1.05);
    ssk.translate(0, 0.62, -0.01);
    sp.push(paintGeo(ssk, (x, y, z, c) => {
      c.copy(BONE);
      for (const e of [-1, 1]) if (Math.hypot(x - e * 0.016, y - 0.628) < 0.012 && z < -0.03) c.setRGB(0.4, 0.1, 0.6);
    }));
    const staff = mergeGeos(sp);
    const ring = new THREE.TorusGeometry(0.13, 0.004, 6, 48);
    return { body, skirt, mantle, boneParts, hood, hoodIn, skull, skullJaw: sk.jaw, upper, fore: mergeGeos([sleeve, wrist, hand]), staff, ring };
  });
}

function buildNecro(M, K) {
  const G = necroGeos();
  const q = M.A.quality;
  const mats = cached('necroMats:' + q, () => ({
    cloth: makeMat(q, { map: grimeTexture(), vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
    bone: makeMat(q, { vertexColors: true, roughness: 0.6 }),
    dark: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    ring: new THREE.MeshBasicMaterial({ color: 0xc070ff, transparent: true, opacity: 0.7, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false }),
    runes: [11, 23, 37].map((sd) => runeTexture(sd)),
  }));
  K.hideBase({ head: true, torso: true, arms: true, pelvis: true, legs: true });
  M.group.scale.set(1.2, 1.35, 1.2);
  K.mesh(G.body, mats.cloth, M.spine, true);
  const skirt = K.mesh(G.skirt, mats.cloth, M.hips, true);
  K.mesh(G.mantle, mats.cloth, M.spine, true);
  K.mesh(G.boneParts, mats.bone, M.spine, true);
  K.mesh(G.hood, mats.cloth, M.neck, true);
  K.mesh(G.hoodIn, mats.dark, M.neck);
  K.mesh(G.skull, mats.bone, M.neck, true);
  K.mesh(G.skullJaw, mats.bone, K.jaw(), true);
  M.eyes.material = K.T.eyesPurple;
  M.eyes.scale.setScalar(0.8);
  M.halo.material = M.halo.material.clone();
  M.halo.material.color.setHex(0xa040ff);
  for (const arm of [M.armL, M.armR]) {
    K.mesh(G.upper, mats.cloth, arm.sh, true);
    K.mesh(G.fore, mats.cloth, arm.el, true);
  }
  // el bastón se mantiene vertical aunque la mano se mueva
  const staffPivot = new THREE.Group();
  M.armR.hand.add(staffPivot);
  K.mesh(G.staff, mats.bone, staffPivot, true);
  M.orb = K.mesh(K.T.sphere, K.T.orb, staffPivot);
  M.orb.scale.setScalar(0.055);
  M.orb.position.y = 0.76;
  M._aura(0xb050ff, 1.1, 0.8, M.orb);
  const orbGlow = M.auraSprite;
  const ring = new THREE.Mesh(G.ring, mats.ring);
  ring.position.y = 0.76;
  staffPivot.add(ring);
  // runas que orbitan
  const runes = mats.runes.map((tex, i) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xb060ff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    sp.scale.setScalar(0.22);
    M.group.add(sp);
    return { sp, a: (i / 3) * TAU };
  });
  let summonT = 0, jab = 0;
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const AI = atkInfo('necro');
  return {
    ...AI, stagger: 0.6, ownAttack: true,
    onAbility(a) { if (a === 'summon') summonT = 1.8; },
    pose(tp, anim, c) {
      // flota: sin pasos, balanceo suave de la túnica
      const s = Math.sin(c);
      tp[K.P.LIFT] = 0.05 + 0.04 * Math.sin(M.time * 1.6);
      tp[K.P.LSWING] = tp[K.P.RSWING] = 0; tp[K.P.LKNEE] = tp[K.P.RKNEE] = 0;
      tp[K.P.LEAN] = 0.08; tp[K.P.ROLL] = 0.04 * s; tp[K.P.TWIST] = 0.05 * s;
      tp[K.P.NOD] = 0.12; tp[K.P.TILT] = 0.15 * Math.sin(M.time * 0.6);
      tp[K.P.JAW] = 0.25 + 0.2 * Math.max(0, Math.sin(M.time * 1.9));
      // mano derecha con el bastón delante, izquierda como una garra que conjura
      tp[K.P.RRAISE] = 0.45; tp[K.P.RELB] = 1.05; tp[K.P.RSPLAY] = 0.15;
      tp[K.P.LRAISE] = 0.8 + 0.12 * Math.sin(M.time * 1.3); tp[K.P.LELB] = 0.7; tp[K.P.LSPLAY] = 0.25;
      if (summonT > 0) {
        const k = Math.sin(PI * clamp01(1 - summonT / 1.8));
        tp[K.P.RRAISE] = lerp(0.45, 2.6, k); tp[K.P.RELB] = lerp(1.05, 0.3, k);
        tp[K.P.LRAISE] = lerp(0.8, 2.2, k); tp[K.P.LSPLAY] = lerp(0.25, 0.9, k);
        tp[K.P.NOD] = lerp(0.12, -0.45, k); tp[K.P.JAW] = 0.3 + 0.6 * k; tp[K.P.LEAN] = lerp(0.08, -0.15, k);
        tp[K.P.LIFT] += 0.06 * k;
      }
      jab = 0;
      if (anim === ZA.ATTACK) {
        // echa el bastón atrás y lo clava hacia delante con el orbe; la otra mano se abre como una garra
        const P = atkPhases(M.animT % AI.attackPeriod, AI.hitTime), I = K.P;
        setK(tp, I.RRAISE, 0.5, 1.5, P); setK(tp, I.RELB, 1.6, 0.15, P); setK(tp, I.RSPLAY, 0.35, 0.05, P);
        setK(tp, I.TWIST, -0.35, 0.3, P); setK(tp, I.LEAN, -0.1, 0.35, P);
        setK(tp, I.LRAISE, 1.2, 0.7, P); setK(tp, I.LSPLAY, 0.7, 0.3, P);
        tp[I.JAW] = 0.3 + 0.7 * P.strike * (1 - P.rec);
        jab = P.strike * (1 - P.rec);
      }
    },
    update(dt) {
      summonT = Math.max(0, summonT - dt);
      const boost = summonT > 0 ? Math.sin(PI * (1 - summonT / 1.8)) : 0;
      // bastón vertical respecto al cuerpo, algo inclinado hacia delante
      M.armR.hand.getWorldQuaternion(_q1).invert();
      M.group.getWorldQuaternion(_q2);
      staffPivot.quaternion.copy(_q1.multiply(_q2));
      staffPivot.rotateX(boost > 0 ? -0.2 * boost : -0.12 - 1.25 * jab);
      if (orbGlow && jab > 0) orbGlow.scale.setScalar(1.1 + 1.2 * jab);
      skirt.rotation.x = 0.04 * Math.sin(M.time * 1.4);
      skirt.rotation.z = 0.03 * Math.sin(M.time * 1.1);
      ring.rotation.set(M.time * 1.3, M.time * 0.9, 0);
      ring.scale.setScalar(1 + boost);
      if (orbGlow) orbGlow.scale.setScalar(1.1 + 1.8 * boost);
      for (const [i, rn] of runes.entries()) {
        rn.a += dt * (0.8 + 3 * boost);
        const rad = 0.55 + 0.25 * boost;
        rn.sp.position.set(Math.cos(rn.a) * rad, 1.05 + 0.12 * Math.sin(M.time * 1.7 + i * 2), Math.sin(rn.a) * rad);
        rn.sp.material.opacity = 0.55 + 0.3 * Math.sin(M.time * 3 + i) + 0.3 * boost;
      }
    },
  };
}

// ============================================================================================
// El Acorazado: armadura de chatarra soldada (peto, placas del vientre, hombreras en capas con púas, guanteletes,
// rodilleras y grebas), cadenas, y un casco abierto con barrotes que deja la cara al descubierto (su punto débil)
// ============================================================================================
const armorF = torsoFn({ y0: -0.1, h: 0.8, w: [[0, 0.21], [0.4, 0.23], [0.7, 0.28], [0.85, 0.29], [0.95, 0.22], [1, 0.1]], d: [[0, 0.15], [0.5, 0.16], [0.75, 0.18], [0.9, 0.16], [1, 0.1]] });

function metalPaint(seed, base = C(0.62, 0.63, 0.66)) {
  return (x, y, z, c) => {
    c.copy(base).multiplyScalar(0.7 + 0.4 * fbm(x * 9 + seed, y * 9 + z * 5, seed, 3));
    const rust = fbm(x * 5 + 3, y * 7 + z * 3, seed + 7, 3);
    if (rust > 0.55) c.lerp(C(0.42, 0.2, 0.08), clamp01((rust - 0.55) * 3));
    const bl = fbm(x * 8, y * 4 + 9, seed + 13, 3);
    if (bl > 0.7 && y < 0.5) c.lerp(C(0.3, 0.02, 0.02), clamp01((bl - 0.7) * 3));
  };
}

// Banda de armadura alrededor del torso entre t0 y t1 (con grosor: cara exterior + canto)
function armorBand(F, t0, t1, grow, seed, uFrom = 0, uTo = 1) {
  const paint = metalPaint(seed);
  const outer = surface((u, v, o) => {
    const uu = lerp(uFrom, uTo, u);
    F(uu, lerp(t0, t1, v), o, grow);
    // abolladuras
    o.multiplyScalar(1 - 0.02 * gauss(fbm(uu * 9 + seed, v * 4, seed, 2), 0.7, 0.08));
  }, 36, 6, (x, y, z, c, u, v) => { paint(x, y, z, c); if (v < 0.08 || v > 0.92) c.multiplyScalar(0.55); if (Math.abs(Math.sin(u * 7 * PI)) < 0.05) c.multiplyScalar(0.5); });
  const parts = [outer];
  // remaches a lo largo del borde inferior
  const n = Math.round(22 * (uTo - uFrom));
  for (let i = 0; i < n; i++) {
    const { p } = torsoPoint(F, lerp(uFrom, uTo, (i + 0.5) / n), t0 + 0.02, grow + 0.004);
    const rv = sphere(0.009, 6, 4);
    rv.translate(p.x, p.y, p.z);
    parts.push(colored(rv, C(0.35, 0.33, 0.3)));
  }
  return mergeGeos(parts);
}

function armoredGeos() {
  return cached('armored', () => {
    const parts = [];
    parts.push(armorBand(armorF, 0.55, 0.97, 0.03, 3));                 // peto y espaldar
    parts.push(armorBand(armorF, 0.4, 0.56, 0.045, 5));                  // placas del vientre, superpuestas
    parts.push(armorBand(armorF, 0.25, 0.41, 0.05, 7));
    parts.push(armorBand(armorF, 0.1, 0.26, 0.055, 9));
    // gola: collar alto con púas
    const collar = surface((u, v, o) => { const th = u * TAU; const rr = lerp(0.2, 0.15, v); o.set(Math.sin(th) * rr, 0.66 + v * 0.1, Math.cos(th) * rr * 0.9 + 0.015); }, 32, 4, metalPaint(11));
    parts.push(collar);
    for (let i = 0; i < 6; i++) { const a = PI * 0.25 + (i / 5) * PI * 1.5; parts.push(spike(Math.sin(a) * 0.17, 0.74, Math.cos(a) * 0.15, Math.sin(a), 0.8, Math.cos(a), 0.09, 0.015, C(0.3, 0.3, 0.32))); }
    // cadena cruzada sobre el pecho con un candado
    for (let i = 0; i < 16; i++) {
      const k = i / 15;
      const { p } = torsoPoint(armorF, lerp(0.38, 0.62, k), lerp(0.9, 0.35, k), 0.06);
      const l = new THREE.TorusGeometry(0.02, 0.006, 5, 10);
      l.rotateZ(0.9);
      if (i % 2) l.rotateY(PI / 2);
      l.translate(p.x, p.y, p.z);
      parts.push(colored(l, C(0.4, 0.38, 0.36)));
    }
    const lock = roundedBox(0.05, 0.055, 0.02, 0.006, 1);
    lock.translate(0.12, 0.3, -0.27);
    parts.push(paintGeo(lock, metalPaint(21, C(0.5, 0.42, 0.2))));
    const shackle = new THREE.TorusGeometry(0.018, 0.005, 5, 10, PI);
    shackle.translate(0.12, 0.33, -0.27);
    parts.push(colored(shackle, C(0.5, 0.5, 0.5)));
    const chest = mergeGeos(parts);
    // faldones colgando de la cadera
    const tas = [];
    for (const s of [-1, 1]) {
      const g = roundedBox(0.14, 0.2, 0.02, 0.008, 1);
      g.translate(s * 0.1, -0.12, -0.17);
      g.rotateX(0.12);
      tas.push(paintGeo(g, metalPaint(31 + s)));
    }
    const tassets = mergeGeos(tas);
    // hombrera en tres capas con púas de ferralla
    const pp = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, PI * 0.5);
      g.scale(0.135 + i * 0.012, 0.09, 0.14 + i * 0.012);
      g.translate(0, 0.05 - i * 0.055, 0);
      pp.push(paintGeo(g, (x, y, z, c) => { metalPaint(41 + i)(x, y, z, c); if (y < 0.05 - i * 0.055 + 0.01) c.multiplyScalar(0.5); }));
    }
    pp.push(spike(0.03, 0.12, 0, 0.3, 1, 0, 0.13, 0.016, C(0.35, 0.3, 0.28)));
    pp.push(spike(0.07, 0.08, 0.05, 0.6, 0.8, 0.3, 0.1, 0.013, C(0.35, 0.3, 0.28)));
    pp.push(spike(0.06, 0.08, -0.06, 0.6, 0.8, -0.3, 0.09, 0.013, C(0.35, 0.3, 0.28)));
    const pauldron = mergeGeos(pp);
    // guantelete: antebrazo blindado y puño enorme
    const gp = [armGeo(0.25, 0.075, 0.068, { bulge: 0.1, radial: 12, skin: C(1, 1, 1), paint: metalPaint(51) })];
    for (const y of [-0.06, -0.13, -0.2]) { const b = new THREE.TorusGeometry(0.073, 0.008, 5, 16); b.rotateX(PI / 2); b.translate(0, y, 0); gp.push(colored(b, C(0.3, 0.3, 0.32))); }
    gp.push(spike(0, -0.02, 0.06, 0, 0.3, 1, 0.08, 0.014, C(0.35, 0.3, 0.28)));
    const fist = handGeo({ palmW: 0.085, palmL: 0.09, fingerR: 0.014, fingerL: 0.07, curl: 1.1, skin: C(0.4, 0.4, 0.42), nail: C(0.2, 0.2, 0.2), seed: 3 });
    fist.translate(0, -0.25, 0);
    gp.push(fist);
    const knuck = roundedBox(0.1, 0.03, 0.05, 0.008, 1);
    knuck.translate(0, -0.34, -0.035);
    gp.push(paintGeo(knuck, metalPaint(61)));
    const gauntlet = mergeGeos(gp);
    // rodillera con púa y greba
    const lp = [];
    const knee = sphere(0.075, 14, 10);
    knee.scale(1, 0.9, 0.8);
    knee.translate(0, 0, -0.05);
    lp.push(paintGeo(knee, metalPaint(71)));
    lp.push(spike(0, 0.0, -0.1, 0, 0.3, -1, 0.07, 0.014, C(0.35, 0.3, 0.28)));
    const greave = surface((u, v, o) => { const th = PI * 0.4 + u * PI * 1.2; const rr = lerp(0.07, 0.058, v); o.set(Math.sin(th) * rr * 1.1, -0.05 - v * 0.26, Math.cos(th) * rr); }, 14, 4, metalPaint(81));
    lp.push(greave);
    const legArmor = mergeGeos(lp);
    // casco abierto: cúpula con cresta de ferralla, carrilleras y barrotes delante de la cara
    const hp = [];
    const dome = new THREE.SphereGeometry(1, 26, 14, 0, TAU, 0, PI * 0.52);
    dome.scale(0.13, 0.13, 0.14);
    dome.translate(0, 0.245, 0.005);
    hp.push(paintGeo(dome, metalPaint(91)));
    for (const sx of [-1, 1]) {
      const cheek = surface((u, v, o) => { const th = sx * (PI * 0.5 + u * PI * 0.35); o.set(Math.sin(th) * 0.132, 0.25 - v * 0.13, Math.cos(th) * 0.138); }, 8, 4, metalPaint(95));
      hp.push(cheek);
    }
    for (const x of [-0.045, 0, 0.045]) hp.push(tube([[x, 0.3, -0.12], [x * 1.1, 0.23, -0.145], [x * 1.15, 0.13, -0.13]], 0.006, 8, 5, (px, py, pz, c) => c.setRGB(0.3, 0.3, 0.32)));
    hp.push(tube([[-0.11, 0.27, -0.07], [0, 0.285, -0.135], [0.11, 0.27, -0.07]], 0.008, 12, 5, (px, py, pz, c) => c.setRGB(0.3, 0.3, 0.32)));
    for (let i = 0; i < 3; i++) hp.push(spike(0, 0.37, -0.04 + i * 0.05, 0, 1, -0.2 + i * 0.25, 0.1 - i * 0.02, 0.014, C(0.35, 0.3, 0.28)));
    const helmet = mergeGeos(hp);
    return { chest, tassets, pauldron, gauntlet, legArmor, helmet };
  });
}

function buildArmored(M, K) {
  const G = armoredGeos();
  const q = M.A.quality;
  const mats = cached('armoredMats:' + q, () => ({
    metal: makeMat(q, { map: metalTexture(), vertexColors: true, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide }),
  }));
  M.group.scale.set(1.6, 1.6, 1.6);
  M.torso.scale.set(1.3, 1, 1.35);
  if (M.hat) M.hat.visible = false;
  K.mesh(G.chest, mats.metal, M.spine, true);
  K.mesh(G.tassets, mats.metal, M.hips, true);
  K.mesh(G.helmet, mats.metal, M.neck, true);
  M.eyes.material = K.T.eyesYellow;
  for (const [i, arm] of [M.armL, M.armR].entries()) {
    arm.um.scale.set(1.45, 1, 1.45);
    arm.fm.visible = false;
    const p = K.mesh(G.pauldron, mats.metal, arm.sh, true);
    p.rotation.z = i === 0 ? 0.35 : -0.35;
    p.scale.x = i === 0 ? -1 : 1;
    K.mesh(G.gauntlet, mats.metal, arm.el, true);
  }
  for (const leg of [M.legL, M.legR]) {
    leg.tm.scale.set(1.35, 1, 1.35); leg.sm.scale.set(1.3, 1, 1.3); leg.ft.scale.set(1.25, 1.2, 1.15);
    const la = K.mesh(G.legArmor, mats.metal, leg.kn, true);
    la.position.y = 0.0;
  }
  let slamT = 0, impactT = 0;
  const AI = atkInfo('armored');
  const roar = makeRoar(M, K, 'roar', [11, 19]);
  return {
    ...AI, stagger: 0.25, ownAttack: true,
    onAbility(a) { if (a === 'slamStart') { slamT = 0.8; impactT = 0; } if (a === 'slam') { slamT = 0; impactT = 0.7; } },
    pose(tp, anim, c) {
      const s = Math.sin(c);
      if (anim === ZA.ATTACK && slamT <= 0 && impactT <= 0) {
        // gancho con el guantelete derecho: abre el brazo y gira todo el cuerpo en el golpe
        const P = atkPhases(M.animT % AI.attackPeriod, AI.hitTime), I = K.P;
        setK(tp, I.RRAISE, 1.1, 1.55, P); setK(tp, I.RSPLAY, 1.25, -0.25, P); setK(tp, I.RELB, 1.6, 0.25, P);
        setK(tp, I.TWIST, -0.55, 0.55, P); setK(tp, I.LEAN, 0.05, 0.4, P); setK(tp, I.NOD, -0.15, 0.05, P);
        setK(tp, I.LRAISE, 1.2, 0.5, P); setK(tp, I.LELB, 1.5, 1.2, P); setK(tp, I.LSPLAY, 0.1, 0.35, P);
        setK(tp, I.LKNEE, 0.25, 0.45, P); setK(tp, I.RSWING, 0.1, -0.3, P);
        tp[I.JAW] = 0.3 + 0.6 * P.wind;
        return;
      }
      // pisadas pesadas, brazos abiertos por el peso de la armadura
      if (anim === ZA.WALK || anim === ZA.RUN || anim === ZA.IDLE) {
        tp[K.P.LEAN] = 0.18; tp[K.P.NOD] = 0.02;
        tp[K.P.ROLL] = 0.08 * s;
        tp[K.P.LRAISE] = 0.3 + 0.2 * s; tp[K.P.RRAISE] = 0.3 - 0.2 * s;
        tp[K.P.LELB] = tp[K.P.RELB] = 0.55;
        tp[K.P.LSPLAY] = tp[K.P.RSPLAY] = 0.38;
      }
      if (slamT > 0) {
        // carga el golpe: los dos puños por encima de la cabeza
        const k = easeInOut(1 - slamT / 0.8);
        tp[K.P.LRAISE] = tp[K.P.RRAISE] = lerp(0.4, 2.9, k);
        tp[K.P.LELB] = tp[K.P.RELB] = lerp(0.5, 0.6, k);
        tp[K.P.LSPLAY] = tp[K.P.RSPLAY] = lerp(0.35, 0.15, k);
        tp[K.P.LEAN] = lerp(0.18, -0.2, k); tp[K.P.NOD] = -0.3 * k; tp[K.P.JAW] = 0.3 + 0.6 * k;
      } else if (impactT > 0) {
        // impacto contra el suelo: se agacha con los puños abajo
        const k = impactT / 0.7;
        tp[K.P.LRAISE] = tp[K.P.RRAISE] = 0.9;
        tp[K.P.LELB] = tp[K.P.RELB] = 0.15;
        tp[K.P.LSPLAY] = tp[K.P.RSPLAY] = 0.12;
        tp[K.P.LEAN] = 0.75 * k + 0.18 * (1 - k); tp[K.P.HIPY] -= 0.16 * k;
        tp[K.P.LKNEE] = tp[K.P.RKNEE] = 0.6 * k; tp[K.P.LSWING] = tp[K.P.RSWING] = 0.35 * k;
        tp[K.P.JAW] = 0.9;
      } else roar.apply(tp);
    },
    update(dt) { slamT = Math.max(0, slamT - dt); impactT = Math.max(0, impactT - dt); roar.update(dt, M.anim); },
  };
}

// ============================================================================================
// El Espectro: cuerpo esquelético y pálido, pelo negro larguísimo que le tapa la cara, brazos alargados con
// garras, y sin piernas: flota envuelto en jirones de sudario que se deshacen en el aire
// ============================================================================================
const GHOST_SKIN = C(0.78, 0.84, 0.88);
const specterF = torsoFn({ y0: -0.08, h: 0.78, ribs: 0.035, ribFrom: 0.5, ribTo: 0.78, sink: 0.05, seed: 4,
  w: [[0, 0.12], [0.4, 0.125], [0.7, 0.16], [0.86, 0.17], [0.95, 0.12], [1, 0.05]],
  d: [[0, 0.075], [0.4, 0.07], [0.7, 0.1], [0.88, 0.095], [1, 0.05]] });

function specterGeos() {
  return cached('specter', () => {
    const r = rng(99);
    const skinP = (x, y, z, c) => {
      c.copy(GHOST_SKIN).multiplyScalar(0.8 + 0.25 * fbm(x * 10, y * 10 + z * 4, 5, 2));
      const v = fbm(x * 12 + 3, y * 12, 17, 3);
      if (Math.abs(v - 0.5) < 0.014) c.setRGB(0.35, 0.42, 0.55);   // venas azuladas
    };
    const torso = surface((u, v, o) => specterF(u, v, o), 36, 30, (x, y, z, c) => { skinP(x, y, z, c); if (z > 0.05 && Math.abs(x) < 0.015) c.multiplyScalar(0.7); });
    // cabeza: cara demacrada con la boca estirada en un grito
    const head = new THREE.SphereGeometry(1, 28, 22);
    deform(head, (v) => {
      let k = 1;
      for (const s of [-1, 1]) {
        k -= 0.2 * gauss(Math.hypot(v.x - s * 0.36, v.y - 0.08, v.z + 0.9), 0, 0.2);
        k -= 0.1 * gauss(Math.hypot(v.x - s * 0.6, v.y + 0.25, v.z + 0.7), 0, 0.25);     // mejillas hundidas
      }
      k -= 0.28 * gauss(Math.hypot(v.x * 1.8, v.y + 0.5, v.z + 0.85), 0, 0.35);           // boca abierta
      v.multiplyScalar(k);
      if (v.y < -0.2) v.y *= 1.35;                                                         // mandíbula alargada
      v.set(v.x * 0.092, v.y * 0.118 + 0.22, v.z * 0.105);
    });
    paintGeo(head, (x, y, z, c) => {
      skinP(x, y, z, c);
      for (const s of [-1, 1]) { const e = Math.hypot(x - s * 0.034, y - 0.226); if (z < -0.05 && e < 0.028) c.lerp(C(0.02, 0.03, 0.06), 1 - e / 0.028); }
      const m = Math.hypot(x * 1.7, (y - 0.13) * 0.8);
      if (z < -0.04 && m < 0.05) c.lerp(C(0.02, 0.02, 0.04), clamp01((0.05 - m) / 0.015));
    });
    const neck = limbGeo(0.16, 0.035, 0.04, 8, 2);
    neck.rotateX(PI);
    neck.translate(0, -0.01, 0.01);
    paintGeo(neck, skinP);
    // pelo largo: mechones que caen por delante de la cara y por la espalda (3 grupos para animarlos)
    const hair = [[], [], []];
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * TAU;
      const front = Math.cos(a) < -0.2;
      const grp = front ? (Math.sin(a) < 0 ? 0 : 1) : 2;
      const x0 = Math.sin(a) * 0.09, z0 = Math.cos(a) * 0.1;
      const len = (front ? 0.32 : 0.55) + r() * 0.2;
      const out = front ? 0.04 : 0.02;
      const pts = [[x0 * 0.5, 0.34, z0 * 0.5], [x0 * 1.1, 0.29, z0 * 1.1], [x0 * 1.25 + (r() - 0.5) * 0.02, 0.2, z0 * 1.2 - (front ? out : 0)],
        [x0 * 1.2 + (r() - 0.5) * 0.04, 0.2 - len * 0.5, z0 * 1.15 - out], [x0 * 1.1 + (r() - 0.5) * 0.06, 0.2 - len, z0 * 1.1 - out * 0.8]];
      hair[grp].push(tube(pts, 0.009 + r() * 0.006, 12, 4, (x, y, z, c) => c.setRGB(0.03, 0.03, 0.04).multiplyScalar(1 + 2 * r()), (k) => 1 - 0.7 * k));
    }
    const hairG = hair.map((h) => mergeGeos(h));
    // brazos larguísimos y huesudos con garras
    const upper = mergeGeos([armGeo(0.36, 0.036, 0.027, { bulge: 0, skin: GHOST_SKIN }), at(sphere(0.03, 12, 9), 0, -0.01, 0)]);
    paintGeo(upper, skinP);
    const fore = mergeGeos([armGeo(0.33, 0.03, 0.022, { bulge: 0, skin: GHOST_SKIN }), at(sphere(0.025, 10, 8), 0, 0, 0)]);
    paintGeo(fore, skinP);
    const hand = handGeo({ palmW: 0.045, palmL: 0.085, fingerR: 0.0055, fingerL: 0.13, claw: 0.05, curl: 0.35, skin: GHOST_SKIN, nail: C(0.1, 0.12, 0.16), seed: 29 });
    hand.translate(0, -0.33, 0);
    // jirones del sudario
    const clothP = (x, y, z, c) => { c.setRGB(0.72, 0.78, 0.82); c.multiplyScalar(0.7 + 0.4 * fbm(x * 9, y * 9, 3, 2)); };
    const strips = [stripGeo(0.62, 0.09, 0.03, 1, clothP), stripGeo(0.5, 0.08, 0.02, 2, clothP), stripGeo(0.7, 0.1, 0.035, 3, clothP)];
    const wrap = surface((u, v, o) => { specterF(u, lerp(0.02, 0.28, v), o, 0.02); }, 28, 4, clothP);
    const shoulderRag = stripGeo(0.35, 0.09, 0.04, 7, clothP, 0.03);
    return { torso, head: mergeGeos([head, neck]), hair: hairG, upper, fore: mergeGeos([fore, hand]), strips, wrap, shoulderRag };
  });
}

function buildSpecter(M, K) {
  const G = specterGeos();
  const q = M.A.quality;
  const base = cached('specterMats:' + q, () => ({
    skin: makeMat(q, { map: grimeTexture(), vertexColors: true, roughness: 0.5 }),
    hair: makeMat(q, { vertexColors: true, roughness: 0.7 }),
    cloth: makeMat(q, { map: grimeTexture(), vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
  }));
  K.hideBase({ head: true, torso: true, arms: true, pelvis: true, legs: true });
  M.group.scale.set(1.15, 1.3, 1.15);
  K.mesh(G.torso, base.skin, M.spine, true);
  K.mesh(G.wrap, base.cloth, M.spine, true);
  K.mesh(G.head, base.skin, M.neck, true);
  const hair = G.hair.map((g) => K.mesh(g, base.hair, M.neck, true));
  M.eyes.material = K.T.eyesCyan;
  M.eyes.position.z = 0.01;
  for (const arm of [M.armL, M.armR]) {
    arm.el.position.y = -0.36;
    arm.hand.position.y = -0.4;
    K.mesh(G.upper, base.skin, arm.sh, true);
    K.mesh(G.fore, base.skin, arm.el, true);
    const rag = K.mesh(G.shoulderRag, base.cloth, arm.sh);
    rag.position.set(0, -0.02, 0.03);
  }
  // sudario: jirones colgando de la cintura que ondean
  const strips = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    const m = K.mesh(G.strips[i % 3], base.cloth, M.hips);
    m.position.set(Math.sin(a) * 0.12, 0.02, Math.cos(a) * 0.09);
    m.rotation.y = a;
    strips.push({ m, a, ph: K.r() * TAU });
  }
  // materiales fantasmales (translúcidos); el pelo se queda oscuro
  M._ghostMats = new Map();
  M.group.traverse((o) => {
    if (!o.isMesh || o === M.eyes) return;
    let g = M._ghostMats.get(o.material);
    if (!g) {
      g = o.material.clone();
      g.transparent = true;
      g.depthWrite = false;
      const isHair = o.material === base.hair;
      if (g.color && !isHair) g.color.lerp(new THREE.Color(0xcfe8ff), 0.45);
      if (g.emissive && !isHair) { g.emissive.setHex(0x2a5a7a); g.emissiveIntensity = 0.55; }
      M._ghostMats.set(o.material, g);
    }
    o.material = g;
  });
  M._aura(0x9ad8ff, 2.2, 0.22);
  let twitch = 0, twitchT = 0;
  const AI = atkInfo('specter');
  const roar = makeRoar(M, K, 'scream', [8, 14], 1.3);
  return {
    ...AI, stagger: 0.8, ownAttack: true,
    pose(tp, anim, c) {
      // flota inclinada hacia delante, con los brazos estirados y la cabeza ladeada
      const t = M.time;
      tp[K.P.LIFT] = 0.07 + 0.05 * Math.sin(t * 1.4);          // poco: la caja de impacto no flota
      tp[K.P.LSWING] = tp[K.P.RSWING] = 0.1; tp[K.P.LKNEE] = tp[K.P.RKNEE] = 0.3;
      tp[K.P.LEAN] = 0.32 + 0.05 * Math.sin(t * 0.9);
      tp[K.P.NOD] = -0.1;
      tp[K.P.TILT] = 0.45 + twitch * 0.5;
      tp[K.P.TURN] = twitch * 0.4;
      tp[K.P.JAW] = 0;
      if (anim !== ZA.ATTACK && anim !== ZA.STUN) {
        tp[K.P.LRAISE] = 1.25 + 0.15 * Math.sin(t * 1.3); tp[K.P.RRAISE] = 1.15 + 0.15 * Math.sin(t * 1.3 + 2);
        tp[K.P.LELB] = 0.25; tp[K.P.RELB] = 0.35;
        tp[K.P.LSPLAY] = tp[K.P.RSPLAY] = 0.2;
        roar.apply(tp);
      }
      if (anim === ZA.ATTACK) {
        // echa los brazos atrás chillando y rasga con las dos garras en cruz mientras se abalanza
        const P = atkPhases(M.animT % AI.attackPeriod, AI.hitTime), I = K.P;
        setK(tp, I.LRAISE, 2.5, 0.7, P); setK(tp, I.RRAISE, 2.7, 0.5, P);
        setK(tp, I.LSPLAY, 0.9, -0.45, P); setK(tp, I.RSPLAY, 0.9, -0.5, P);
        setK(tp, I.LELB, 0.6, 0.1, P); setK(tp, I.RELB, 0.6, 0.1, P);
        setK(tp, I.LEAN, -0.1, 0.8, P); setK(tp, I.NOD, -0.55, 0.15, P);
        tp[I.JAW] = 1.3 * (1 - P.rec);
        tp[I.TILT] += 0.3 * Math.sin(M.time * 27) * (1 - P.rec);
        tp[I.LIFT] += 0.06 * P.strike * (1 - P.rec);
      }
    },
    update(dt) {
      roar.update(dt, M.anim);
      // espasmos bruscos de la cabeza de vez en cuando
      twitchT -= dt;
      if (twitchT <= 0) { twitch = (Math.random() - 0.5) * 1.6; twitchT = 0.6 + Math.random() * 2.2; }
      twitch *= Math.exp(-dt * 6);
      const t = M.time;
      hair[0].rotation.z = 0.05 * Math.sin(t * 1.7); hair[1].rotation.z = -0.05 * Math.sin(t * 1.5 + 1);
      hair[2].rotation.x = 0.06 * Math.sin(t * 1.3);
      for (const s of strips) s.m.rotation.x = 0.18 + 0.14 * Math.sin(t * 2.3 + s.ph);
    },
  };
}

// ============================================================================================
// Tanque: mole jorobada con hombros y brazos de gorila, puños enormes, huesos que le salen de la espalda y los
// antebrazos, y restos de camisa rasgada
// ============================================================================================
const TANK_SKIN = C(0.66, 0.7, 0.6);
const tankF = torsoFn({ y0: -0.1, h: 0.82, seed: 12, lump: 0.03, hump: 0.12, humpAt: 0.78,
  w: [[0, 0.17], [0.3, 0.2], [0.6, 0.3], [0.8, 0.37], [0.92, 0.3], [1, 0.13]],
  d: [[0, 0.13], [0.4, 0.15], [0.7, 0.21], [0.85, 0.23], [1, 0.12]] });

function tankGeos() {
  return cached('tank', () => {
    const skinP = (x, y, z, c) => {
      c.copy(TANK_SKIN).multiplyScalar(0.8 + 0.3 * fbm(x * 8, y * 8 + z * 4, 9, 3));
      const v = fbm(x * 10 + 1, y * 10 + z * 6, 27, 3);
      if (Math.abs(v - 0.5) < 0.02) c.setRGB(0.3, 0.3, 0.38);
      if (fbm(x * 6, y * 6, 41, 2) > 0.66) c.lerp(C(0.4, 0.12, 0.1), 0.5);
    };
    const torso = surface((u, v, o) => {
      tankF(u, v, o);
      // pectorales y trapecios enormes que hunden la cabeza entre los hombros
      const th = u * TAU;
      o.z -= 0.04 * gauss(v, 0.72, 0.08) * Math.max(0, -Math.cos(th)) * gauss(Math.abs(Math.sin(th)), 0.5, 0.35);
    }, 40, 28, (x, y, z, c) => {
      skinP(x, y, z, c);
      // abdominales marcados (se fusionan con los trapecios más abajo)
      if (z < -0.12 && y > 0.05 && y < 0.35 && Math.abs(x) < 0.09 && (Math.abs(x) < 0.006 || Math.abs(((y - 0.05) * 14) % 1) < 0.1)) c.multiplyScalar(0.6);
    });
    const parts = [];
    // huesos de la columna saliendo de la joroba
    for (let i = 0; i < 5; i++) {
      const t = 0.55 + i * 0.08;
      const { p, n } = torsoPoint(tankF, 0.0, t, 0.1);
      parts.push(spike(p.x, p.y, p.z + 0.02, 0, 0.5, 1, 0.12 - i * 0.012, 0.022, C(0.55, 0.45, 0.4)));
    }
    // restos de camisa rasgada a la cintura
    const shirt = surface((u, v, o) => {
      tankF(u, lerp(0.02, 0.3, v), o, 0.015);
      if (v > 0.8) o.y += (valueNoise(u * 26, 3, 5) - 0.6) * 0.12;
    }, 40, 5, (x, y, z, c) => { c.setRGB(0.13, 0.14, 0.2); c.multiplyScalar(0.6 + 0.5 * fbm(x * 8, y * 8, 3, 2)); if (fbm(x * 5, y * 5, 9, 2) > 0.6) c.lerp(C(0.25, 0.03, 0.02), 0.6); });
    parts.push(shirt);
    // trapecios enormes: la cabeza queda hundida entre los hombros
    const traps = [];
    for (const sx of [-1, 1]) {
      const tr = sphere(1, 18, 12);
      tr.scale(0.14, 0.09, 0.12);
      tr.rotateZ(sx * 0.5);
      tr.translate(sx * 0.12, 0.66, 0.03);
      traps.push(paintGeo(tr, skinP));
    }
    const torsoAll = mergeGeos([torso, ...traps]);
    const extras = mergeGeos(parts);
    const th = monsterHead({ w: 0.098, h: 0.108, d: 0.108, brow: 0.2, sockets: 0.2, socketW: 0.15, cheeks: 0.02, snout: 0.1, seed: 7, teeth: 8,
      tusks: 1, jawW: 1.3, jawDrop: 0.095, neckR: 0.08, paint: (x, y, z, c) => {
        skinP(x, y, z, c);
        // cicatrices y costura en el cráneo
        if (Math.abs(x + 0.3 * (y - 0.25)) < 0.005 && y > 0.25 && z < 0.02) c.setRGB(0.3, 0.1, 0.1);
      } });
    const upper = mergeGeos([armGeo(0.28, 0.13, 0.1, { bulge: 0.3, bulgeAt: 0.4, skin: TANK_SKIN }), at(sphere(0.16, 18, 12), 0, -0.02, 0, 0, 0, 0, [1, 0.9, 1])]);
    paintGeo(upper, skinP);
    const fore = armGeo(0.26, 0.1, 0.13, { bulge: 0.25, bulgeAt: 0.65, skin: TANK_SKIN });
    paintGeo(fore, skinP);
    const fp = [fore];
    fp.push(spike(0.04, -0.02, 0.08, 0.3, 0.6, 1, 0.1, 0.02, C(0.55, 0.45, 0.4)));
    fp.push(spike(0.08, -0.14, 0.06, 1, 0.2, 0.6, 0.08, 0.017, C(0.55, 0.45, 0.4)));
    fp.push(spike(0.07, -0.08, 0.1, 0.8, 0.3, 0.9, 0.07, 0.015, C(0.55, 0.45, 0.4)));
    const fist = handGeo({ palmW: 0.13, palmL: 0.11, fingerR: 0.024, fingerL: 0.09, curl: 1.1, skin: TANK_SKIN, nail: C(0.3, 0.25, 0.2), bloody: 0.35, seed: 8 });
    fist.translate(0, -0.25, 0);
    fp.push(fist);
    return { torso: torsoAll, extras, head: th.head, jaw: th.jaw, upper, fore: mergeGeos(fp) };
  });
}

function buildTank(M, K) {
  const G = tankGeos();
  const q = M.A.quality;
  const mats = cached('tankMats:' + q, () => ({
    skin: makeMat(q, { map: grimeTexture(), vertexColors: true, roughness: 0.6, color: 0x8e9480 }),
    extra: makeMat(q, { map: grimeTexture(), vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
  }));
  K.hideBase({ torso: true, arms: true, head: true });
  M.group.scale.set(1.5, 1.5, 1.5);
  K.mesh(G.head, mats.skin, M.neck, true);
  K.mesh(G.jaw, mats.skin, K.jaw(), true);
  M.eyes.scale.setScalar(0.75);
  K.mesh(G.torso, mats.skin, M.spine, true);
  K.mesh(G.extras, mats.extra, M.spine, true);
  M.eyes.material = K.T.eyesRed;
  for (const [i, arm] of [M.armL, M.armR].entries()) {
    const big = i === 1 ? 1.15 : 1;                              // brazo derecho más grande
    arm.sh.position.x *= 1.35;
    const u = K.mesh(G.upper, mats.skin, arm.sh, true); u.scale.setScalar(big);
    const f = K.mesh(G.fore, mats.skin, arm.el, true); f.scale.set(big * (i === 0 ? -1 : 1), big, big);
  }
  for (const leg of [M.legL, M.legR]) { leg.tm.scale.set(1.5, 1, 1.5); leg.sm.scale.set(1.45, 1, 1.4); leg.ft.scale.set(1.35, 1.2, 1.2); }
  const AI = atkInfo('tank');
  const roar = makeRoar(M, K, 'chest', [8, 14], 1.8);
  return {
    ...AI, stagger: 0.35, ownAttack: true,
    update(dt) { roar.update(dt, M.anim); },
    pose(tp, anim, c) {
      const s = Math.sin(c);
      if (anim === ZA.ATTACK) {
        // junta los puños por encima de la cabeza y los estampa contra el suelo delante
        const P = atkPhases(M.animT % AI.attackPeriod, AI.hitTime), I = K.P;
        setK(tp, I.LRAISE, 2.9, 0.75, P); setK(tp, I.RRAISE, 2.9, 0.75, P);
        setK(tp, I.LELB, 1.1, 0.1, P); setK(tp, I.RELB, 1.1, 0.1, P);
        setK(tp, I.LSPLAY, -0.1, 0.1, P); setK(tp, I.RSPLAY, -0.1, 0.1, P);
        setK(tp, I.LEAN, -0.2, 0.85, P); setK(tp, I.NOD, -0.5, -0.1, P);
        setK(tp, I.LKNEE, 0.2, 0.6, P); setK(tp, I.RKNEE, 0.2, 0.6, P);
        setK(tp, I.LSWING, 0.1, 0.4, P); setK(tp, I.RSWING, -0.1, 0.3, P);
        tp[I.JAW] = 0.4 + 0.7 * P.wind;
        return;
      }
      tp[K.P.NOD] = -0.3;                                         // cabeza erguida mirando al frente
      if (anim === ZA.RUN || anim === ZA.SPRINT) {
        // galope de gorila: se apoya en los puños
        tp[K.P.LEAN] = 0.7;
        tp[K.P.RRAISE] = 0.4 + 0.85 * s; tp[K.P.LRAISE] = 0.4 - 0.85 * s;
        tp[K.P.LELB] = tp[K.P.RELB] = 0.25;
        tp[K.P.LSPLAY] = tp[K.P.RSPLAY] = 0.3;
        tp[K.P.NOD] = -0.6;
      } else if (anim === ZA.WALK || anim === ZA.IDLE) {
        tp[K.P.LEAN] = 0.4 + 0.03 * Math.sin(M.time * 2);
        tp[K.P.ROLL] = 0.1 * s;
        tp[K.P.LRAISE] = 0.25 + 0.2 * s; tp[K.P.RRAISE] = 0.25 - 0.2 * s;
        tp[K.P.LELB] = tp[K.P.RELB] = 0.35;
        tp[K.P.LSPLAY] = tp[K.P.RSPLAY] = 0.35;
      }
      tp[K.P.JAW] = Math.max(tp[K.P.JAW], 0.35 + 0.3 * Math.max(0, Math.sin(M.time * 0.9)));
      if (anim !== ZA.RUN && anim !== ZA.SPRINT) roar.apply(tp);
    },
  };
}

// ============================================================================================
// Explosivo: barriga hinchada a reventar con venas incandescentes bajo la piel y pústulas que laten
// ============================================================================================
const bomberF = torsoFn({ y0: -0.12, h: 0.8, seed: 21, lump: 0.05, belly: 0.14, bellyAt: 0.32, bellyS: 0.2,
  w: [[0, 0.19], [0.3, 0.28], [0.5, 0.3], [0.72, 0.24], [0.9, 0.18], [1, 0.07]],
  d: [[0, 0.17], [0.35, 0.27], [0.55, 0.26], [0.8, 0.15], [1, 0.07]] });

function veinTexture() {
  return cached('veinTex', () => {
    const c = makeCanvas(256, 256);
    const g = c.getContext('2d');
    const r = rng(5);
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round';
    for (let i = 0; i < 40; i++) {
      let x = r() * 256, y = r() * 256;
      g.lineWidth = 1 + r() * 3;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
    return canvasTexture(c);
  });
}

function bomberGeos() {
  return cached('bomber', () => {
    const r = rng(33);
    const torso = surface((u, v, o) => bomberF(u, v, o), 40, 26, (x, y, z, c) => {
      c.setRGB(0.62, 0.56, 0.4).multiplyScalar(0.8 + 0.3 * fbm(x * 8, y * 8 + z * 3, 4, 3));
      if (fbm(x * 5, y * 5, 12, 2) > 0.6) c.lerp(C(0.55, 0.3, 0.3), 0.4);
      // piel estirada casi transparente sobre la barriga
      if (z < -0.15) c.lerp(C(0.8, 0.55, 0.35), 0.3);
    });
    const pust = [];
    for (let i = 0; i < 18; i++) {
      const u = 0.25 + r() * 0.5, t = 0.12 + r() * 0.6;
      const rad = 0.02 + r() * r() * 0.04;
      const { p, n } = torsoPoint(bomberF, u, t, rad * 0.3);
      const g = sphere(rad, 10, 8);
      g.scale(1, 1, 0.75);
      g.lookAt(n);
      g.translate(p.x, p.y, p.z);
      pust.push(paintGeo(g, (x, y, z, c) => c.setRGB(1, 0.85, 0.5)));
    }
    // camisa reventada: solo quedan tirantes y el cuello
    const straps = [];
    for (const s of [-1, 1]) straps.push(tube([[s * 0.12, 0.66, -0.06], [s * 0.15, 0.5, -0.22], [s * 0.17, 0.25, -0.3], [s * 0.15, 0.02, -0.24]], 0.012, 16, 5, (x, y, z, c) => c.setRGB(0.25, 0.2, 0.15)));
    const collar = new THREE.TorusGeometry(0.085, 0.015, 6, 20);
    collar.rotateX(PI / 2); collar.translate(0, 0.66, 0.015);
    straps.push(colored(collar, C(0.6, 0.6, 0.55)));
    return { torso, pustules: mergeGeos(pust), straps: mergeGeos(straps) };
  });
}

function buildBomber(M, K) {
  const G = bomberGeos();
  const q = M.A.quality;
  const mats = cached('bomberMats:' + q, () => ({ cloth: makeMat(q, { vertexColors: true, roughness: 0.9 }) }));
  K.hideBase({ torso: true });
  M.group.scale.set(1.12, 1.0, 1.12);
  // material propio (la mecha lo hace parpadear): venas que brillan bajo la piel
  const belly = makeMat(q, { map: grimeTexture(), vertexColors: true, roughness: 0.32, color: 0xb0a090, emissive: 0xffa020, emissiveMap: veinTexture(), emissiveIntensity: 1 });
  M.pustMat = belly;
  const torso = K.mesh(G.torso, belly, M.spine, true);
  const pust = K.mesh(G.pustules, belly, M.spine);
  K.mesh(G.straps, mats.cloth, M.spine, true);
  for (const side of [M.armL, M.armR]) side.um.scale.set(1.2, 1, 1.2);
  return {
    pose(tp, anim, c) {
      const s = Math.sin(c);
      if (anim === ZA.WALK || anim === ZA.RUN || anim === ZA.IDLE) {
        tp[K.P.ROLL] = 0.12 * s; tp[K.P.LEAN] = -0.02; tp[K.P.LSPLAY] = tp[K.P.RSPLAY] = 0.35;
      }
    },
    update() {
      const fuse = !!(M.flags & ZF.FUSE);
      const k = 1 + (fuse ? 0.06 * Math.abs(Math.sin(M.time * 14)) : 0.03 * Math.sin(M.time * 2.4));
      torso.scale.set(k, 1, k);
      pust.scale.set(k, 1, k);
    },
  };
}

// ============================================================================================
// Corredor: esquelético, con la camisa desgarrada y las costillas a la vista
// ============================================================================================
function runnerGeos() {
  return cached('runner', () => {
    const parts = [];
    const hole = new THREE.CircleGeometry(1, 20);
    deform(hole, (v) => { const a = Math.atan2(v.y, v.x); const k = 1 + (valueNoise(a * 3, 1, 3) - 0.5) * 0.5; v.set(v.x * 0.085 * k, v.y * 0.1 * k + 0.33, -0.125); });
    hole.rotateY(PI); hole.translate(0, 0, -0.25);
    paintGeo(hole, (x, y, z, c) => c.setRGB(0.3, 0.03, 0.03).multiplyScalar(0.6 + 0.6 * fbm(x * 30, y * 30, 3, 2)));
    parts.push(hole);
    for (let i = 0; i < 4; i++) {
      const y = 0.4 - i * 0.045;
      for (const s of [-1, 1]) parts.push(tube([[0, y + 0.01, -0.128], [s * 0.04, y, -0.132], [s * 0.075, y - 0.02, -0.12]], 0.0065, 8, 5, (px, py, pz, c) => c.setRGB(0.85, 0.8, 0.68)));
    }
    parts.push(tube([[0, 0.43, -0.13], [0, 0.26, -0.13]], 0.008, 6, 5, (px, py, pz, c) => c.setRGB(0.85, 0.8, 0.68)));
    return { ribs: mergeGeos(parts) };
  });
}

function buildRunner(M, K) {
  const G = runnerGeos();
  const q = M.A.quality;
  const mat = cached('runnerMat:' + q, () => makeMat(q, { vertexColors: true, roughness: 0.5 }));
  M.group.scale.set(0.9, 0.98, 0.9);
  M.eyes.material = K.T.eyesRed;
  K.mesh(G.ribs, mat, M.spine);
  M.torso.scale.set(0.9, 1, 0.9);
  for (const a of [M.armL, M.armR]) { a.um.scale.set(0.8, 1.05, 0.8); a.fm.scale.set(0.85, 1.05, 0.85); }
  return {
    pose(tp, anim) {
      // depredador: más agachado, cabeza hacia delante y temblores
      tp[K.P.LEAN] += 0.12;
      tp[K.P.NOD] -= 0.12;
      tp[K.P.TILT] += 0.08 * Math.sin(M.time * 23) * Math.sin(M.time * 1.7);
      if (anim === ZA.SPRINT || anim === ZA.RUN) tp[K.P.JAW] = Math.max(tp[K.P.JAW], 0.7);
    },
  };
}

// ============================================================================================
// Zombi común: faldones de camisa, falda y pelo largo (vestido / bata) y heridas variadas: costillas al aire,
// tripas colgando, sin mandíbula, antebrazo arrancado o un ojo reventado
// ============================================================================================
function commonGeos() {
  return cached('common', () => {
    // faldones rasgados bajo el dobladillo de la camisa (UV: parte baja del torso de la textura)
    const tails = surface((u, v, o) => {
      const th = u * TAU, t = 1 - v;
      let y = -0.015 - t * 0.12;
      if (t > 0.55) y -= (valueNoise(u * 18, 2.2, 3) - 0.35) * 0.1 * (t - 0.55) / 0.45;
      const rr = 1 + t * 0.07;
      o.set(Math.sin(th) * 0.166 * rr, y, Math.cos(th) * 0.116 * rr);
    }, 28, 4, (x, y, z, c) => { const k = 0.78 + 0.2 * smoothstep(-0.14, -0.02, y); c.setRGB(k, k, k); });
    remapUVp(tails, 0.25, 0.31);
    // falda (vestido o bata) desde la cintura hasta las rodillas, con el bajo rasgado
    const skirt = surface((u, v, o) => {
      const th = u * TAU, t = 1 - v;
      let y = 0.03 - t * 0.47;
      if (t > 0.8) y -= (valueNoise(u * 20, 5.1, 7) - 0.3) * 0.12 * (t - 0.8) / 0.2;
      o.set(Math.sin(th) * lerp(0.172, 0.27, t), y, Math.cos(th) * lerp(0.122, 0.23, t) + 0.005);
    }, 30, 8, (x, y, z, c) => { const k = 0.72 + 0.28 * smoothstep(-0.44, 0, y); c.setRGB(k, k, k); });
    remapUVp(skirt, 0.25, 0.52);
    // agujero en la tripa con las tripas colgando (el intestino se balancea desde su punto de anclaje)
    const hole = new THREE.CircleGeometry(1, 16);
    deform(hole, (v) => { const a = Math.atan2(v.y, v.x); const k = 1 + (valueNoise(a * 3, 4, 9) - 0.5) * 0.5; v.set(v.x * 0.06 * k, v.y * 0.05 * k, 0); });
    hole.rotateY(PI);
    hole.translate(0.075, 0.26, -0.118);
    paintGeo(hole, (x, y, z, c) => c.setRGB(0.25, 0.02, 0.02).multiplyScalar(0.6 + 0.6 * fbm(x * 40, y * 40, 3, 2)));
    // dos lazos de intestino cortos y gruesos que cuelgan del agujero (en U, sin llegar a la cintura)
    const gutPaint = (x, y, z, c) => c.setRGB(0.42, 0.1, 0.09).lerp(C(0.22, 0.03, 0.03), clamp01(fbm(y * 30, x * 30, 5, 2) * 1.4 - 0.3));
    const loopA = tube([[-0.02, 0, 0], [-0.035, -0.05, -0.025], [-0.01, -0.09, -0.035], [0.025, -0.075, -0.03], [0.02, -0.02, -0.01]], 0.018, 24, 8, gutPaint, (k) => 1 + 0.15 * Math.sin(k * 25));
    const loopB = tube([[0.015, 0, 0], [0.04, -0.035, -0.02], [0.05, -0.065, -0.01], [0.03, -0.07, 0.005]], 0.015, 18, 8, gutPaint, (k) => 1 + 0.15 * Math.sin(k * 22));
    const guts = mergeGeos([loopA, loopB]);
    // sin mandíbula: carne desgarrada y la lengua colgando
    const jawGore = sphere(1, 12, 8);
    deform(jawGore, (v) => v.multiplyScalar(1 + (fbm(v.x * 3, v.y * 3 + v.z * 2, 4, 2) - 0.5) * 0.5));
    jawGore.scale(0.05, 0.028, 0.05);
    jawGore.translate(0, 0.165, -0.06);
    paintGeo(jawGore, (x, y, z, c) => c.setRGB(0.5, 0.05, 0.05).lerp(C(0.8, 0.75, 0.62), fbm(x * 60, z * 60, 7, 1) > 0.62 ? 0.8 : 0));
    const tongue = tube([[0, 0.16, -0.07], [0.005, 0.12, -0.1], [-0.003, 0.08, -0.105], [0.004, 0.05, -0.1]], 0.012, 12, 6, (x, y, z, c) => c.setRGB(0.55, 0.22, 0.25), (k) => 1 - 0.4 * k);
    // brazo arrancado: muñón con hueso asomando (en el codo)
    const stump = sphere(1, 12, 8);
    stump.scale(0.045, 0.03, 0.045);
    paintGeo(stump, (x, y, z, c) => c.setRGB(0.45, 0.04, 0.04).lerp(C(0.8, 0.72, 0.6), fbm(x * 70, z * 70, 11, 1) > 0.6 ? 0.8 : 0));
    const bone = tube([[0, 0, 0], [0.004, -0.04, -0.005], [0.002, -0.075, 0]], 0.009, 6, 6, (x, y, z, c) => c.setRGB(0.88, 0.84, 0.72), (k) => 1 - 0.3 * k);
    // un ojo reventado: solo queda uno brillando
    const eyeL = sphere(0.0125, 8, 6); eyeL.translate(-0.036, 0.222, -0.089);
    const eyeR = sphere(0.0125, 8, 6); eyeR.translate(0.036, 0.222, -0.089);
    const halo1 = (x) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x, 0.222, -0.1]), 3)); g.computeBoundingSphere(); return g; };
    return {
      tails, skirt, hole, guts, jawGore: mergeGeos([jawGore, tongue]), stump: mergeGeos([stump, bone]),
      eyeL, eyeR, haloL: halo1(-0.036), haloR: halo1(0.036),
    };
  });
}

// Remapea las UV de una superficie paramétrica a una franja vertical de la textura (v0..v1)
function remapUVp(g, v0, v1) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  uv.needsUpdate = true;
}

// Pelo largo: mechones que caen por los lados y la espalda (sin tapar la cara)
function longHairGeo(col, seed) {
  return cached('longHair:' + seed, () => {
    const r = rng(seed * 31 + 7);
    const hair = [];
    for (let i = 0; i < 26; i++) {
      const a = lerp(-2.3, 2.3, i / 25) + (r() - 0.5) * 0.1;        // 0 = nuca (+Z); los extremos rodean hasta las sienes
      const x0 = Math.sin(a) * 0.1, z0 = Math.cos(a) * 0.108 + 0.01;
      const len = 0.2 + r() * 0.2 + 0.08 * Math.cos(a);
      const pts = [[x0 * 0.4, 0.33, z0 * 0.4], [x0 * 1.05, 0.29, z0 * 1.05], [x0 * 1.22, 0.2, z0 * 1.2],
        [x0 * 1.3 + (r() - 0.5) * 0.02, 0.2 - len * 0.5, z0 * 1.28 + 0.01], [x0 * 1.25 + (r() - 0.5) * 0.04, 0.2 - len, z0 * 1.25 + 0.02]];
      hair.push(tube(pts, 0.011 + r() * 0.006, 10, 4, (x, y, z, c) => c.setRGB(col[0], col[1], col[2]).multiplyScalar(0.8 + 0.6 * r()), (k) => 1 - 0.6 * k));
    }
    return mergeGeos(hair);
  });
}

// Superficie del torso del zombi común (mismo perfil que torsoGeo en zombieModel.js) para pegar heridas encima
function commonTorsoPt(u, t, grow, out) {
  const th = u * TAU;
  const w = profile(t, [[0, 0.15], [0.3, 0.155], [0.55, 0.168], [0.72, 0.186], [0.84, 0.2], [0.92, 0.186], [0.97, 0.13], [1, 0.058]]);
  const d = profile(t, [[0, 0.1], [0.35, 0.104], [0.62, 0.12], [0.84, 0.114], [0.95, 0.1], [1, 0.05]]);
  let z = Math.cos(th) * d;
  if (z < 0) z *= 1 - 0.08 * smoothstep(0.5, 0.75, t);
  return out.set(Math.sin(th) * (w + grow), -0.03 + t * 0.7, z - (z < 0 ? grow : -grow));
}

// Costillas al aire: carne abierta en el costado del pecho con las costillas curvadas encima
function ribWoundGeo(u0) {
  return cached('ribWound:' + u0, () => {
    const u1 = u0 + 0.16, t0 = 0.5, t1 = 0.74;
    const flesh = surface((u, v, o) => {
      const uu = lerp(u0, u1, u), tt = lerp(t0, t1, v);
      commonTorsoPt(uu, tt, 0.004, o);
    }, 10, 10, (x, y, z, c, u, v) => {
      c.setRGB(0.32, 0.03, 0.03).multiplyScalar(0.6 + 0.7 * fbm(x * 40, y * 40, 3, 2));
      const e = Math.min(u, 1 - u, v, 1 - v);
      if (e < 0.12) c.lerp(C(0.55, 0.45, 0.38), 1 - e / 0.12);            // borde de piel desgarrada
    });
    // recorte irregular: los bordes de la herida se hunden en el torso (así no se ve un rectángulo)
    const pos = flesh.attributes.position, uv = flesh.attributes.uv;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      const e = Math.hypot((u - 0.5) * 2, (v - 0.5) * 2) + (valueNoise(u * 7, v * 7, 3) - 0.5) * 0.5;
      if (e > 0.95) { commonTorsoPt(lerp(u0, u1, u), lerp(t0, t1, v), -0.01, tmp); pos.setXYZ(i, tmp.x, tmp.y, tmp.z); }
    }
    flesh.computeVertexNormals();
    const parts = [flesh];
    for (let i = 0; i < 4; i++) {
      const tt = lerp(t0 + 0.04, t1 - 0.04, i / 3);
      const pts = [];
      for (let k = 0; k <= 4; k++) { const p = commonTorsoPt(lerp(u0 + 0.02, u1 - 0.02, k / 4), tt - k * 0.006, 0.009, new THREE.Vector3()); pts.push([p.x, p.y, p.z]); }
      parts.push(tube(pts, 0.0065, 12, 5, (x, y, z, c) => c.setRGB(0.86, 0.8, 0.68).multiplyScalar(0.85 + 0.2 * Math.sin(x * 300))));
    }
    return mergeGeos(parts);
  });
}

export function decorateCommon(M, K) {
  const G = commonGeos();
  const r = K.r;
  const q = M.A.quality;
  const outfit = K.outfit || {};
  const gore = cached('commonGore:' + q, () => makeMat(q, { vertexColors: true, roughness: 0.35 }));
  const parts = { guts: null, hair: null };
  if (outfit.skirt) {
    const dbl = cached('dbl:' + K.shirtMat.uuid, () => { const m = K.shirtMat.clone(); m.side = THREE.DoubleSide; return m; });
    K.mesh(G.skirt, dbl, M.hips, true);
  } else if (outfit.shirt !== 'vest' && outfit.shirt !== 'police' && r() < 0.55) {
    const dbl = cached('dbl:' + K.shirtMat.uuid, () => { const m = K.shirtMat.clone(); m.side = THREE.DoubleSide; return m; });
    K.mesh(G.tails, dbl, M.spine, true);
  }
  if (outfit.longHair) {
    const hm = cached('hairMat:' + q, () => makeMat(q, { vertexColors: true, roughness: 0.75 }));
    const seed = Math.round(K.hairColor[0] * 100 + K.hairColor[1] * 10);
    parts.hair = K.mesh(longHairGeo(K.hairColor, seed), hm, M.neck, true);
    if (M.hat) M.hat.visible = false;
  }
  // heridas (como mucho dos por zombi)
  let wounds = 0;
  const roll = (p) => wounds < 2 && r() < p && ++wounds;
  if (roll(0.16)) K.mesh(ribWoundGeo(r() < 0.5 ? 0.3 : 0.55), gore, M.spine);
  if (!outfit.skirt && roll(0.12)) {
    K.mesh(G.hole, gore, M.spine);
    const anchor = new THREE.Group();
    anchor.position.set(0.075, 0.26, -0.122);
    M.spine.add(anchor);
    parts.guts = K.mesh(G.guts, gore, anchor, true);
  }
  if (roll(0.07)) {
    M.jaw.visible = false;
    K.mesh(G.jawGore, gore, M.neck, true);
  }
  if (roll(0.07)) {
    const arm = r() < 0.5 ? M.armL : M.armR;
    arm.fm.visible = false;
    K.mesh(G.stump, gore, arm.el, true);
  }
  if (r() < 0.12) {
    const left = r() < 0.5;
    M.eyes.geometry = left ? G.eyeR : G.eyeL;               // queda el otro
    M.halo.geometry = left ? G.haloR : G.haloL;
  }
  const ph = r() * TAU;
  return {
    update() {
      const t = M.time;
      if (parts.guts) { parts.guts.rotation.x = 0.15 * Math.sin(t * 3.1 + ph); parts.guts.rotation.z = 0.1 * Math.sin(t * 2.3 + ph); }
      if (parts.hair) { parts.hair.rotation.x = 0.06 * Math.sin(t * 2.2 + ph); parts.hair.rotation.z = 0.04 * Math.sin(t * 1.7 + ph); }
    },
  };
}

// ============================================================================================
// Registro
// ============================================================================================
const BUILDERS = {
  butcher: buildButcher, plague: buildPlague, necro: buildNecro, armored: buildArmored, specter: buildSpecter,
  tank: buildTank, bomber: buildBomber, runner: buildRunner,
};

export function hasTypeModel(type) { return !!BUILDERS[type]; }

// M = ZombieModel, K = utilidades del modelo base ({ mesh, hideBase, T, P, DIM })
export function buildTypeModel(M, type, K) {
  const b = BUILDERS[type];
  return b ? b(M, K) || {} : null;
}
