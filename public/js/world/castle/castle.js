// Castillo Vorkhaus: punto de entrada del tema 'castillo' para World (geometría, mobiliario, laboratorio animado
// e iluminación). Ver shared/maps/castillo.js para el plano.
import * as THREE from 'three';
import { MAP } from '/shared/map.js';
import { makeGlow, makePool, flickerNoise, smoothstep, shadowMode, applyMoonShadow } from '../kit.js';
import { buildChalk } from '../props.js';
import { MOON_DIR } from '../sky.js';
import { buildCastleGeometry } from './geo.js';
import { buildCastleProps } from './props.js';
import { CastleEE } from './easteregg.js';
import { ZombieModel } from '../../entities/zombieModel.js';
import { ZA } from '/shared/protocol.js';
import { ZOMBIE_TYPES } from '/shared/constants.js';

export function buildCastle(B, world) {
  buildCastleGeometry(B);
  buildCastleProps(B, world);
  buildChalk(world.root);
  return [new CastleLab(world), new CastleEE(world), new CastleCull(world)];
}

// Trozo de la geometría estática: planta (por la altura del centro) y celda de 24 × 24 m
const CHUNK = 24;
export function castleChunk(x, y, z) {
  const L = MAP.levels;
  let lv = 0;
  for (let l = 0; l < L.length; l++) if (y >= L[l].y - 0.05) lv = l;   // el techo (0.12 bajo el suelo de arriba) es de la planta de abajo
  const tx = Math.floor(x / CHUNK), tz = Math.floor(z / CHUNK);
  return { key: lv + '_' + tx + '_' + tz, lv, tx, tz };
}

// ---------------------------------------------------------------------------------------------
// Visibilidad por plantas: el sótano solo se dibuja estando en él (o junto a las escaleras que bajan) y las
// plantas de arriba no se dibujan desde el sótano. Las llamas lejanas o de plantas ocultas se apagan.
export class CastleCull {
  constructor(world) {
    this.world = world;
    this.ctx = world.ctx;
    this.name = 'castleCull';
    this.chunks = null;
    this.key = '';
    this.show = MAP.levels.map(() => true);
    // llegada de las escaleras que bajan al sótano (desde ahí se ve el fondo)
    this.downStairs = MAP.STAIRS.filter((st) => st.lv === 0).map((st) => ({ x: (st.x0 + st.x1 + 1) / 2, z: (st.z0 + st.z1 + 1) / 2 }));
  }

  _collect() {
    this.chunks = [];
    this.wraps = [];
    const root = this.world.root;
    for (const o of root.children.slice()) {
      if (o.isMesh && o.userData.chunk) { this.chunks.push(o); continue; }
      // ventanas y puertas: gestionan su propia visibilidad, así que se ocultan con un grupo contenedor
      if (/^(window|door):/.test(o.name)) {
        const box = new THREE.Box3().setFromObject(o);
        if (box.isEmpty()) continue;
        const c = box.getCenter(new THREE.Vector3());
        const w = new THREE.Group();
        w.name = 'cull:' + o.name;
        root.add(w);
        w.add(o);
        this.wraps.push({ w, x: c.x, z: c.z, lv: castleChunk(c.x, box.min.y + 0.3, c.z).lv });
      }
    }
  }

  update() {
    const cam = this.ctx.camera;
    if (!cam) return;
    if (!this.chunks) this._collect();
    const p = cam.position;
    const lc = MAP.levelOfY(p.y - 1.2);
    const nearStair = (lc === 1 || lc === 0) && this.downStairs.some((s) => Math.hypot(p.x - s.x, p.z - s.z) < 11);
    const show = this.show;
    // sótano: solo desde él o junto a las escaleras que bajan; desde el sótano, la planta baja solo junto a ellas
    for (let l = 0; l < show.length; l++) show[l] = l === 0 ? (lc === 0 || nearStair) : (lc === 0 ? (l === 1 && nearStair) : true);
    const key = show.map((v) => (v ? 1 : 0)).join('') + '|' + Math.floor(p.x / 4) + ',' + Math.floor(p.z / 4);
    if (key === this.key) return;
    this.key = key;
    for (const m of this.chunks) m.visible = show[m.userData.chunk.lv];
    for (const o of this.wraps) o.w.visible = show[o.lv] && Math.hypot(o.x - p.x, o.z - p.z) < 30;
    const fl = this.world.flames && this.world.flames.list;
    if (fl) {
      for (const f of fl) {
        const gp = f.g.position;
        f.g.visible = show[castleChunk(gp.x, gp.y, gp.z).lv] && Math.hypot(gp.x - p.x, gp.z - p.z) < 34;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Laboratorio: jefes suspendidos en los tubos (decorativos), burbujas y teletransportes
export class CastleLab {
  constructor(world) {
    this.world = world;
    this.ctx = world.ctx;
    this.name = 'castleLab';
    this.tubes = [];
    this.pads = [];
    this.t = 0;
    const quality = (this.ctx.settings && this.ctx.settings.quality) || 'high';
    for (const p of MAP.PROPS) {
      if (p.kind !== 'tube') continue;
      const cx = (p.x0 + p.x1 + 1) / 2, cz = (p.z0 + p.z1 + 1) / 2, y = MAP.baseY(p.lv || 0);
      const holder = new THREE.Group();
      holder.position.set(cx, y + 0.45, cz);
      world.root.add(holder);
      let model = null;
      if (ZOMBIE_TYPES[p.boss]) try {
        model = new ZombieModel({ quality, seed: 77 + this.tubes.length * 13, type: p.boss });
        // los jefes grandes se encogen para caber en el tubo
        const s = model.group.scale.x;
        const k = Math.min(1, 1.0 / Math.max(1, s));
        model.group.scale.multiplyScalar(k * 0.9);
        model.update(0.016, { anim: ZA.IDLE, flags: 0, speed: 0 });
        model.group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
        holder.add(model.group);
      } catch (e) { model = null; }
      // burbujas
      const bubbles = [];
      for (let i = 0; i < 6; i++) {
        const b = makeGlow(0x6aff9a, 0.12, 0.6);
        b.position.set((Math.random() - 0.5) * 0.6, Math.random() * 2.4, (Math.random() - 0.5) * 0.6);
        holder.add(b);
        bubbles.push({ b, speed: 0.4 + Math.random() * 0.6 });
      }
      const glow = makeGlow(0x2aff8a, 2.6, 0.25);
      glow.position.set(0, 1.4, 0);
      holder.add(glow);
      this.tubes.push({ holder, model, bubbles, glow, ph: Math.random() * 6, x: cx, z: cz, y });
    }
    for (const tp of MAP.TELEPORTERS) {
      const g = new THREE.Group();
      const y = MAP.baseY(tp.lv || 0);
      g.position.set(tp.x + 0.5, y, tp.z + 0.5);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.12, 24), world.mats.get('c_iron'));
      base.position.y = 0.06;
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.02, 24), world.mats.get('c_telepad'));
      disc.position.y = 0.13;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 32), world.mats.get('c_telepad'));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.3;
      const glow = makeGlow(0x9a50ff, 2.2, 0.0);
      glow.position.y = 1.0;
      const pool = makePool(0x9a50ff, 2.4, 0);
      pool.position.y = 0.02;
      g.add(base, disc, ring, glow, pool);
      world.root.add(g);
      this.pads.push({ tp, g, ring, glow, pool });
    }
  }

  sync() { /* nada: el aspecto depende de la electricidad (World.lighting.powerLevel) */ }

  onEvent() { /* nada */ }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const cam = this.ctx.camera;
    const P = this.world.lighting ? this.world.lighting.powerLevel : 0;
    for (const tb of this.tubes) {
      // solo desde el propio sótano y de cerca (son modelos de jefe completos: muchos triángulos)
      const near = !cam || (Math.hypot(cam.position.x - tb.x, cam.position.z - tb.z) < 26 && cam.position.y - tb.y < 3.5);
      tb.holder.visible = near;
      if (!near) continue;
      tb.holder.position.y = tb.y + 0.45 + Math.sin(t * 0.7 + tb.ph) * 0.06;
      tb.holder.rotation.y = Math.sin(t * 0.2 + tb.ph) * 0.3;
      if (tb.model) { try { tb.model.update(dt * 0.35, { anim: ZA.IDLE, flags: 0, speed: 0 }); } catch { /* nada */ } }
      for (const b of tb.bubbles) {
        b.b.position.y += b.speed * dt;
        if (b.b.position.y > 2.5) b.b.position.y = 0;
      }
      tb.glow.material.opacity = 0.18 + 0.12 * P + 0.05 * Math.sin(t * 2 + tb.ph);
    }
    for (const pd of this.pads) {
      const on = pd.tp.power ? P : 1;
      pd.ring.position.y = 0.3 + (Math.sin(t * 2.5) * 0.5 + 0.5) * 1.6 * on;
      pd.ring.rotation.z = t * 1.5;
      pd.glow.material.opacity = on * (0.35 + 0.2 * Math.sin(t * 4));
      pd.pool.material.opacity = on * 0.45;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Iluminación: luna, luz ambiente y 8 luces puntuales (su número no cambia para no recompilar shaders).
// Índices 6 y 7 son la caja misteriosa y el Pack-a-Punch, como en el Pueblo (los usan esos módulos).
export const CL = { VEST: 0, PATIO: 1, LAB: 2, SALON: 3, ALA: 4, SOTANO: 5, BOX: 6, PAP: 7 };
const SHADOW_HALF = 26, SHADOW_RES = 2048;

export class CastleLighting {
  constructor(world) {
    this.world = world;
    this.ctx = world.ctx;
    this.points = [];
    this.powerLevel = 0;
    this.powered = false;
    this._powerAt = -1;
  }

  build(B) {
    void B;
    const root = this.world.root;
    this.hemi = new THREE.HemisphereLight(0x98a0c4, 0x4a3c2e, 3.6);
    root.add(this.hemi);
    const moon = new THREE.DirectionalLight(0xb0c0ff, 1.5);
    const target = new THREE.Object3D();
    target.position.set(36, 0, 50);
    moon.position.copy(target.position).addScaledVector(MOON_DIR, 90);
    moon.target = target;
    moon.shadow.mapSize.set(SHADOW_RES, SHADOW_RES);
    const sc = moon.shadow.camera;
    sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF; sc.near = 10; sc.far = 200;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.03;
    root.add(moon, target);
    this.moon = moon; this.moonTarget = target;

    const O = 4, b = (l) => MAP.baseY(l);
    const pap = MAP.PAP_MACHINE;
    const box0 = MAP.BOX_LOCATIONS[0];
    const defs = [
      [0xffc27a, 34, 26, 32 + O, b(1) + 6.5, 30 + O],     // vestíbulo (araña)
      [0xffb060, 26, 26, 32 + O, b(1) + 4.0, 52 + O],     // patio (farolas)
      [0x60ff9a, 18, 26, 32 + O, b(0) + 3.6, 12 + O],     // laboratorio (verde)
      [0xffc88a, 0, 30, 32 + O, b(3) + 5.5, 16 + O],      // salón de baile (apagado hasta abrirlo)
      [0xffb46a, 26, 24, 12 + O, b(1) + 3.6, 31 + O],     // biblioteca
      [0xff5a2a, 10, 22, 10 + O, b(0) + 3.2, 12 + O],     // criptas (brasas)
      [0x4a9cff, 0, 9, box0 ? (box0.x0 + box0.x1 + 1) / 2 : 0, b(box0 ? box0.lv : 1) + 1.3, box0 ? box0.z0 + 0.5 : 0],
      [0xb050ff, 0, 8, pap ? (pap.x0 + pap.x1 + 1) / 2 : 0, b(pap ? pap.lv : 1) + 2.1, pap ? pap.z0 + 1.6 : 0],
    ];
    for (const [c, i, d, x, y, z] of defs) {
      const p = new THREE.PointLight(c, i, d, 2);
      p.position.set(x, y, z);
      p.castShadow = false;
      root.add(p);
      this.points.push(p);
    }
    this.applyQuality();
  }

  applyQuality() {
    const high = shadowMode(this.ctx.settings) !== 'off';
    if (this.moon) { this.shadowRes = applyMoonShadow(this.moon, this.ctx.settings); this.moon.intensity = high ? 1.5 : 1.1; }
    if (this.hemi) this.hemi.intensity = high ? 3.6 : 3.9;
  }

  setPowered(on, live) {
    if (on === this.powered) return;
    this.powered = on;
    if (on) this._powerAt = live ? this.world.time : -100;
    else { this._powerAt = -1; this.powerLevel = 0; }
  }

  _computePower(t) {
    if (!this.powered) return 0;
    const e = t - this._powerAt;
    if (e < 0.18) return 0;
    if (e < 1.5) return flickerNoise(t * 3, 4.2) > 0.45 ? 0.35 + 0.65 * smoothstep(0.18, 1.5, e) : 0.05;
    return 1;
  }

  // La zona de sombra de la luna sigue a la cámara. Al aire libre se recalcula siempre (a 30 Hz, main.js); dentro
  // del castillo la luna apenas se ve: la zona avanza a saltos de 6 m y solo entonces se recalcula el mapa.
  _followShadow() {
    const cam = this.ctx.camera;
    if (!cam || !this.moon) return;
    const p = cam.position;
    const lv = MAP.levelOfY(p.y - 1.2);
    const zn = MAP.zoneAtL(lv, Math.floor(p.x), Math.floor(p.z));
    const zone = zn >= 0 ? MAP.ZONES[zn] : null;
    this.outdoors = !zone || !zone.indoor;
    const step = this.outdoors ? (SHADOW_HALF * 2) / (this.shadowRes || SHADOW_RES) : 6;
    const x = Math.round(p.x / step) * step;
    const z = Math.round(p.z / step) * step;
    if (x === this.moonTarget.position.x && z === this.moonTarget.position.z) return;
    this.moonTarget.position.set(x, 0, z);
    this.moon.position.copy(this.moonTarget.position).addScaledVector(MOON_DIR, 90);
    this.moonTarget.updateMatrixWorld();
    this._shadowDirty = true;
  }

  wantShadowUpdate() {
    if (this.outdoors !== false) return true;
    if (!this._shadowDirty) return false;
    this._shadowDirty = false;
    return true;
  }

  update(dt, t) {
    this._followShadow();
    const P = this.powerLevel = this._computePower(t);
    const mats = this.world.mats;
    const flick = flickerNoise(t * 1.4, 2.3);
    try {
      mats.get('c_candle').emissiveIntensity = 1.3 + 0.4 * flick;
      mats.get('c_lamp').emissiveIntensity = 1.5 + 0.3 * flickerNoise(t * 0.9, 5.1);
      mats.get('c_screen').emissiveIntensity = 0.25 + 1.1 * P + 0.1 * Math.sin(t * 13);
      mats.get('c_telepad').emissiveIntensity = 0.2 + 1.2 * P;
      mats.get('c_liquid').emissiveIntensity = 0.3 + 0.5 * P;
    } catch { /* material aún no creado */ }
    const pts = this.points;
    pts[CL.VEST].intensity = 34 * (0.9 + 0.1 * flick);
    pts[CL.PATIO].intensity = 26 * (0.9 + 0.1 * flickerNoise(t, 7.7));
    // laboratorio: rojo de emergencia sin corriente, verde frío con ella
    pts[CL.LAB].color.setHex(P > 0.5 ? 0x70ffb0 : 0xff3a1a);
    pts[CL.LAB].intensity = P > 0.5 ? 34 : 14 + 10 * Math.max(0, Math.sin(t * 3.2));
    pts[CL.ALA].intensity = 22 * (0.88 + 0.12 * flick);
    pts[CL.SOTANO].intensity = 10 + 5 * flickerNoise(t * 2.2, 3.3);
    const gs = this.ctx.gs;
    const salonOpen = !!(gs && gs.doors && MAP.DOORS.some((d) => d.sealed && gs.doors[d.id]));
    pts[CL.SALON].intensity = salonOpen ? 40 : 0;
  }
}
