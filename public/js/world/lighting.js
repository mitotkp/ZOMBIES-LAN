// Iluminación nocturna: luna direccional (con sombras en calidad alta), hemisférica tenue y 8 PointLight fijas
// (su número nunca cambia para no recompilar shaders). Lámparas del techo, focos de sodio y balizas de alarma
// son geometría emisiva + sprites aditivos. Secuencia de encendido al activar la electricidad.
import * as THREE from 'three';
import { CEIL_H } from '/shared/map.js';
import { makeGlow, makePool, flickerNoise, smoothstep } from './kit.js';
import { MOON_DIR } from './sky.js';
import { facadePoint, facadePlaneYaw } from './levelgeo.js';

// Índices de las luces puntuales
export const L = { TERMINAL: 0, BAR: 1, ALMACEN: 2, PLANTA: 3, STREET: 4, FIRE: 5, BOX: 6, PAP: 7 };

const C_WARM = new THREE.Color(0xffb46a), C_COLD = new THREE.Color(0xe4ecff);
const C_SODIUM = new THREE.Color(0xffa040), C_RED = new THREE.Color(0xff2a14);

export class Lighting {
  constructor(world) {
    this.world = world;
    this.ctx = world.ctx;
    this.points = [];
    this.glows = { bulb: [], sodium: [], alarm: [], fluo: [] };
    this.powerLevel = 0;       // 0..1 visible (con parpadeo al encender)
    this.powered = false;
    this._powerAt = -1;        // this.world.time en que se encendió en vivo
    this.streetFlick = 1;
  }

  build(batch) {
    const root = this.world.root;
    // Ambiente de luna
    this.hemi = new THREE.HemisphereLight(0x5a6d92, 0x2a241c, 1.25);
    root.add(this.hemi);
    const moon = new THREE.DirectionalLight(0xa9bcff, 1.15);
    const target = new THREE.Object3D();
    target.position.set(30, 0, 18);
    moon.position.copy(target.position).addScaledVector(MOON_DIR, 90);
    moon.target = target;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -44; sc.right = 44; sc.top = 44; sc.bottom = -44; sc.near = 10; sc.far = 190;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.03;
    root.add(moon, target);
    this.moon = moon;

    // Luces puntuales (posición inicial; algunas se mueven o cambian de color)
    const defs = [
      [0xffb46a, 20, 18, 11, 3.5, 26],       // terminal
      [0xff9a62, 22, 20, 11, 3.3, 12.5],     // bar
      [0xffa040, 24, 20, 28, 3.5, 12],       // almacén
      [0xff2a14, 10, 20, 46.5, 3.5, 12],     // planta
      [0xffa650, 42, 24, 37, 4.5, 20.95],    // farola de la calle
      [0xff7a2a, 8, 10, 33.5, 1.5, 28.5],    // barril en llamas
      [0x4a9cff, 0, 9, 23, 1.3, 20.5],       // caja misteriosa
      [0xb050ff, 0, 8, 42, 2.1, 6.6],        // Pack-a-Punch
    ];
    for (const [c, i, d, x, y, z] of defs) {
      const p = new THREE.PointLight(c, i, d, 2);
      p.position.set(x, y, z);
      p.castShadow = false;
      root.add(p);
      this.points.push(p);
    }
    this._baseStreet = this.points[L.STREET].position.clone();

    this._fixtures(batch);
    this.applyQuality();
  }

  // Geometría de lámparas y sus halos
  _fixtures(B) {
    const root = this.world.root;
    const addGlow = (group, color, size, x, y, z, op = 0.8) => {
      const g = makeGlow(color, size, op);
      g.position.set(x, y, z);
      root.add(g);
      this.glows[group].push({ s: g, base: op, seed: Math.random() * 10 });
      return g;
    };
    const fluo = (x, z, len = 1.3, alongZ = false) => {
      const P = B.at(x, CEIL_H, z, alongZ ? Math.PI / 2 : 0);
      P.box('metal', len, 0.07, 0.34, 0, -0.035, 0, { color: 0xd4d4d0 });
      P.box('fluo', len - 0.1, 0.05, 0.22, 0, -0.095, 0);
      this.glows.fluo.push({ x, z });
    };
    const bulbHang = (x, z, drop, shade) => {
      const P = B.at(x, CEIL_H, z, 0);
      P.cyl('dark', 0.008, 0.008, drop, 0, -drop / 2, 0, { seg: 4 });
      if (shade) {
        P.cyl('metal', 0.06, 0.3, 0.22, 0, -drop - 0.08, 0, { seg: 12, open: true, color: shade });
        P.cyl('bulb', 0.25, 0.25, 0.01, 0, -drop - 0.18, 0, { seg: 12 });
      } else {
        P.sphere('bulb', 0.07, 0, -drop - 0.05, 0, { seg: 8 });
      }
      addGlow('bulb', 0xffb866, shade ? 1.2 : 0.9, x, CEIL_H - drop - 0.15, z, 0.75);
    };
    const sodiumBay = (x, z) => {
      const P = B.at(x, CEIL_H, z, 0);
      P.cyl('metal', 0.02, 0.02, 0.6, 0, -0.3, 0, { seg: 5, color: 0x505050 });
      P.cyl('metal', 0.12, 0.42, 0.34, 0, -0.75, 0, { seg: 14, open: true, color: 0x4a5048 });
      P.cyl('sodium', 0.38, 0.38, 0.01, 0, -0.9, 0, { seg: 14 });
      addGlow('sodium', 0xff9a3a, 1.6, x, CEIL_H - 1.0, z, 0.7);
    };
    const alarm = (x, y, z, nx, nz) => {
      const P = B.at(x, y, z, Math.atan2(nx, nz));
      P.box('metal', 0.22, 0.22, 0.08, 0, 0, 0.04, { color: 0x3a3a3a });
      P.cyl('alarm', 0.09, 0.09, 0.16, 0, 0, 0.14, { seg: 10, rx: Math.PI / 2 });
      addGlow('alarm', 0xff2010, 1.3, x + nx * 0.25, y, z + nz * 0.25, 0);
    };

    // Terminal: fluorescentes y dos bombillas de emergencia
    for (const x of [7.5, 11, 14.5]) for (const z of [22.5, 26, 29.5]) fluo(x, z);
    bulbHang(9, 26, 0.7, null);
    bulbHang(13, 26, 0.7, null);
    // Bar: lámparas colgantes sobre la barra y las mesas
    for (const x of [8.5, 11, 13.5]) bulbHang(x, 9.5, 0.8, 0x2a4a2a);
    for (const [x, z] of [[7.5, 13.5], [11.5, 13.5], [14.5, 15.5], [8.5, 16.5]]) bulbHang(x, z, 1.0, 0x5a2a1a);
    // Almacén: campanas de sodio y tubos (con electricidad)
    for (const [x, z] of [[23, 7.5], [28, 12], [33, 7.5], [24, 16.5], [32, 16.5]]) sodiumBay(x, z);
    for (const x of [21.5, 26, 30.5, 35]) for (const z of [10, 14]) fluo(x, z, 1.8, true);
    // Planta: fluorescentes y balizas rojas
    for (const x of [41, 46, 51]) for (const z of [8, 12.5, 17]) fluo(x, z, 1.5);
    alarm(38.0, 3.2, 9.5, 1, 0);
    alarm(55.0, 3.2, 14.5, -1, 0);
    alarm(48.5, 3.2, 5.0, 0, 1);
    // Calle: farolas de pared (sodio)
    const lamp = (side, a, lit) => {
      const [x, z] = facadePoint(side, a, 0);
      const P = B.at(x, 4.6, z, facadePlaneYaw(side));
      P.box('metal', 0.18, 0.3, 0.1, 0, 0, 0.05, { color: 0x2a2a2a });
      P.box('metal', 0.06, 0.06, 0.95, 0, 0.12, 0.5, { color: 0x2a2a2a, rx: -0.12 });
      P.box('metal', 0.34, 0.12, 0.5, 0, 0.18, 0.98, { color: 0x3a3c3a });
      P.box(lit ? 'sodium' : 'dark', 0.28, 0.02, 0.42, 0, 0.11, 0.98);
      const [gx, gz] = facadePoint(side, a, 0.98);
      if (lit) addGlow('sodium', 0xffa04a, 2.2, gx, 4.62, gz, 0.85);
    };
    lamp('N', 37, true);
    lamp('S', 27, true);
    lamp('N', 50.5, true);
    lamp('S', 46, false);
    lamp('E', 30, true);
    // Charcos de luz de las farolas
    const pools = [];
    for (const [side, a, s] of [['N', 37, 7], ['S', 27, 5], ['N', 50.5, 5], ['E', 30, 5]]) {
      const [x, z] = facadePoint(side, a, 1.6);
      const p = makePool(0xff9a40, s, 0.22);
      p.position.set(x, 0.03, z);
      root.add(p);
      pools.push(p);
    }
    this.streetPools = pools;
  }

  applyQuality() {
    const high = !this.ctx.settings || this.ctx.settings.quality !== 'low';
    if (this.moon) {
      this.moon.castShadow = high;
      this.moon.intensity = high ? 1.4 : 0.95;
    }
    if (this.hemi) this.hemi.intensity = high ? 1.25 : 1.45;
  }

  // Cambia el estado de la electricidad. live = animar el encendido
  setPowered(on, live) {
    if (on === this.powered) return;
    this.powered = on;
    if (on) this._powerAt = live ? this.world.time : -100;
    else { this._powerAt = -1; this.powerLevel = 0; }
  }

  // Nivel de energía con el parpadeo de arranque
  _computePower(t) {
    if (!this.powered) return 0;
    const e = t - this._powerAt;
    if (e < 0.18) return 0;
    if (e < 1.5) return flickerNoise(t * 3, 4.2) > 0.45 ? 0.35 + 0.65 * smoothstep(0.18, 1.5, e) : 0.05;
    return 1;
  }

  update(dt, t) {
    const P = this.powerLevel = this._computePower(t);
    const mats = this.world.mats;
    const flick = flickerNoise(t, 1.7);
    // Tubos fluorescentes (con electricidad), con algún tubo fallando
    mats.get('fluo').emissiveIntensity = P * (1.5 + 0.1 * Math.sin(t * 50));
    mats.get('bulb').emissiveIntensity = 1.2 * (0.86 + 0.14 * flick) * (1 - 0.3 * P);
    // Farolas de sodio: parpadeo ocasional
    const glitch = flickerNoise(t * 0.6, 9.1);
    this.streetFlick = glitch > 0.93 ? (flickerNoise(t * 6, 3) > 0.5 ? 0.2 : 1) : 1;
    mats.get('sodium').emissiveIntensity = 1.8 * (0.92 + 0.08 * flick) * this.streetFlick;
    const pulse = Math.max(0, Math.sin(t * 3.2));
    mats.get('alarm').emissiveIntensity = (1 - P) * (0.3 + 2.2 * pulse);

    for (const g of this.glows.bulb) g.s.material.opacity = g.base * (0.8 + 0.2 * flickerNoise(t, g.seed));
    for (const g of this.glows.sodium) g.s.material.opacity = g.base * this.streetFlick * (0.9 + 0.1 * flick);
    for (const g of this.glows.alarm) g.s.material.opacity = (1 - P) * pulse * 0.9;
    for (const p of this.streetPools) p.material.opacity = 0.22 * this.streetFlick;

    const pts = this.points;
    // Terminal: cálida y titilante sin luz, fría y estable con luz
    const tf = 0.75 + 0.25 * flickerNoise(t * 1.3, 2.2);
    pts[L.TERMINAL].color.copy(C_WARM).lerp(C_COLD, P);
    pts[L.TERMINAL].intensity = THREE.MathUtils.lerp(28 * tf, 40, P);
    pts[L.BAR].intensity = 42 * (0.9 + 0.1 * flickerNoise(t * 0.8, 5));
    pts[L.ALMACEN].color.copy(C_SODIUM).lerp(C_COLD, P);
    pts[L.ALMACEN].intensity = THREE.MathUtils.lerp(30, 38, P);
    pts[L.PLANTA].color.copy(C_RED).lerp(C_COLD, P);
    pts[L.PLANTA].intensity = THREE.MathUtils.lerp(9 + 12 * pulse, 40, P);
    pts[L.STREET].intensity = 52 * this.streetFlick * (0.95 + 0.05 * flick);
    pts[L.FIRE].intensity = 7 + 5 * flickerNoise(t * 2.2, 7.7);
    pts[L.FIRE].position.y = 1.5 + 0.1 * flickerNoise(t * 3, 1.1);
  }
}

export default Lighting;
