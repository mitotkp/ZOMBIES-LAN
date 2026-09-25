// Barreras con estado: puertas/escombros comprables y ventanas con barricada de 6 tablas.
// El aspecto se deriva de gs (gs.doors, gs.windows); los eventos solo animan.
import * as THREE from 'three';
import { DOORS, WINDOW_INFO } from '/shared/map.js';
import { BOARDS_PER_WINDOW } from '/shared/constants.js';
import { StaticBatch, sfx, fx, easeOutBack, easeInOut, TAU } from './kit.js';
import { getTex, doorPriceTexture, makeRng } from './textures.js';
import { DOOR_H, WIN, windowFrame } from './levelgeo.js';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

// Cartel de precio (plano con material propio, a ambos lados)
function priceSign(tex, w, h) {
  const mat = new THREE.MeshLambertMaterial({
    map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.userData.noShadow = true;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Puertas y escombros
export class Doors {
  constructor(world, B) {
    this.world = world;
    this.ctx = world.ctx;
    this.list = [];
    for (const d of DOORS) this.list.push(this._make(d, B));
  }

  _make(d, B) {
    const xs = d.cells.map((c) => c[0]), zs = d.cells.map((c) => c[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, z0 = Math.min(...zs), z1 = Math.max(...zs) + 1;
    const alongX = zs[0] === zs[zs.length - 1] && xs[0] !== xs[xs.length - 1];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const span = alongX ? x1 - x0 : z1 - z0;
    const yaw = alongX ? 0 : Math.PI / 2;
    const r = makeRng(d.id.charCodeAt(0) * 131);

    // Parte móvil (se construye como grupo propio con materiales compartidos)
    const lb = new StaticBatch(this.world.mats);
    const P = lb.at(0, 0, 0, 0);
    if (d.kind === 'door') {
      const w = span - 0.04, h = DOOR_H - 0.02;
      P.box('metal', w, h, 0.14, 0, h / 2, 0, { color: 0x6c7479 });
      for (let y = 0.35; y < h; y += 0.42) P.box('metal', w, 0.06, 0.18, 0, y, 0, { color: 0x4a5055 });
      P.box('metal', 0.06, h, 0.18, 0, h / 2, 0, { color: 0x3a3f44 });
      P.box('zoc_hazard', w, 0.22, 0.16, 0, 0.14, 0, {});
      for (const s of [-1, 1]) {
        P.box('rust', 0.5 + r() * 0.4, 0.3 + r() * 0.5, 0.005, (r() - 0.5) * w * 0.7, 0.6 + r() * 1.2, s * 0.093, {});
        P.box('chrome', 0.05, 0.28, 0.05, 0.22, 1.1, s * 0.11, {});
      }
    } else {
      // escombros: muebles rotos, tablones, sacos y cascotes que tapan el hueco
      P.box('concrete', span - 0.1, 0.35, 0.9, 0, 0.17, 0, { color: 0x6a655e });
      for (let i = 0; i < 9; i++) {
        const x = (r() - 0.5) * (span - 0.5), y = 0.4 + r() * 1.7;
        const k = r();
        if (k < 0.4) P.box('crate', 0.5 + r() * 0.4, 0.4 + r() * 0.3, 0.5 + r() * 0.3, x, y, (r() - 0.5) * 0.3, { color: 0xc8b8a0, ry: r() * 0.8, rz: (r() - 0.5) * 0.6 });
        else if (k < 0.7) P.box('wood', 1.2 + r() * 0.8, 0.12, 0.08, x, y, (r() - 0.5) * 0.5, { color: 0x6a5038, rz: (r() - 0.5) * 1.6, ry: (r() - 0.5) * 0.6 });
        else P.sphere('concrete', 0.25 + r() * 0.2, x, y * 0.5, (r() - 0.5) * 0.5, { color: 0x7a746c, seg: 6, sy: 0.7 });
      }
      P.box('metal', 0.9, 0.7, 0.5, span * 0.22, 0.75, 0.1, { color: 0x5a4a3a, ry: 0.3, rz: 0.2 }); // mueble volcado
      P.box('tarp', span * 0.8, 0.04, 1.0, 0, 2.05, 0, { color: 0x6a6a52, rz: 0.12 });
      P.box('wood', 0.12, DOOR_H - 0.1, 0.12, -span / 2 + 0.25, (DOOR_H - 0.1) / 2, 0.3, { color: 0x4a3828, rz: 0.08 });
    }
    const group = lb.toGroup({ shadows: true });
    group.name = 'door:' + d.id;
    group.position.set(cx, 0, cz);
    group.rotation.y = yaw;

    // Placas de precio en ambos lados
    const tex = doorPriceTexture(d.cost, d.kind);
    for (const s of [-1, 1]) {
      const sign = priceSign(tex, 0.62, 0.39);
      const out = d.kind === 'door' ? 0.1 : 0.52;
      sign.position.set(0, 1.55, s * out);
      if (s < 0) sign.rotation.y = Math.PI;
      group.add(sign);
    }
    this.world.root.add(group);
    void B;
    return { d, group, cx, cz, yaw, open: false, anim: -1 };
  }

  sync(gs) {
    const doors = gs.doors || {};
    for (const e of this.list) {
      const open = !!doors[e.d.id];
      if (open === e.open) continue;
      e.open = open;
      if (!open) {
        e.anim = -1;
        e.group.visible = true;
        e.group.position.y = 0;
        e.group.scale.set(1, 1, 1);
        e.group.rotation.z = 0;
      } else if (e.anim < 0) {
        e.group.visible = false; // abierta sin animación (al conectarse)
      }
    }
  }

  onEvent(name, ev) {
    if (name !== 'door') return;
    const e = this.list.find((x) => x.d.id === ev.id);
    if (!e) return;
    e.open = true;
    e.anim = 0;
    e.group.visible = true;
    sfx(this.ctx, e.d.kind === 'debris' ? 'debris' : 'door_open', e.cx, 1.3, e.cz);
    if (e.d.kind === 'debris') {
      for (let i = 0; i < 4; i++) {
        _v.set(e.cx + (Math.random() - 0.5) * 1.5, 0.4 + Math.random(), e.cz + (Math.random() - 0.5) * 1.5);
        fx(this.ctx, 'dust', _v.clone(), _n.set(0, 1, 0).clone());
      }
    }
  }

  update(dt) {
    for (const e of this.list) {
      if (e.anim < 0) continue;
      e.anim += dt;
      const k = Math.min(1, e.anim / (e.d.kind === 'door' ? 1.1 : 0.9));
      if (e.d.kind === 'door') {
        // la persiana sube al techo con un pequeño tirón inicial
        e.group.position.y = easeInOut(k) * (DOOR_H + 0.1) + Math.sin(k * 40) * 0.01 * (1 - k);
      } else {
        // los escombros se hunden y encogen
        e.group.position.y = -easeInOut(k) * 2.2;
        const s = 1 - 0.4 * k;
        e.group.scale.set(s, 1, s);
        e.group.rotation.z = Math.sin(k * 30) * 0.02 * (1 - k);
      }
      if (k >= 1) { e.anim = -1; e.group.visible = false; }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Ventanas con barricada
// Disposición de las 6 tablas (coordenadas locales del marco: X a lo largo del muro, +Z hacia el interior)
const BOARD_LAYOUT = [
  { y: 0.78, rz: 0.07 },
  { y: 1.08, rz: -0.12 },
  { y: 1.42, rz: 0.55 },
  { y: 1.46, rz: -0.52 },
  { y: 1.84, rz: 0.08 },
  { y: 2.14, rz: -0.1 },
];

export class Windows {
  constructor(world, B) {
    this.world = world;
    this.ctx = world.ctx;
    const tex = getTex('board');
    this.mat = world.mats.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, color: 0xd8c8b0 }));
    this.geo = new THREE.BoxGeometry(1.02, 0.17, 0.045);
    this.list = WINDOW_INFO.map((w) => this._make(w));
    void B;
  }

  _make(w) {
    const f = windowFrame(w);
    const group = new THREE.Group();
    group.name = 'window:' + w.id;
    group.position.set(f.x, 0, f.z);
    group.rotation.y = f.yaw;
    const boards = [];
    const r = makeRng(w.id * 71 + 5);
    BOARD_LAYOUT.forEach((L, i) => {
      const m = new THREE.Mesh(this.geo, this.mat);
      const home = { x: (r() - 0.5) * 0.06, y: L.y + (r() - 0.5) * 0.05, z: 0.09 + i * 0.012, rz: L.rz + (r() - 0.5) * 0.06 };
      m.position.set(home.x, home.y, home.z);
      m.rotation.z = home.rz;
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      boards.push({ m, home, anim: 0, mode: null, from: null });
    });
    this.world.root.add(group);
    return { w, f, group, boards, count: BOARDS_PER_WINDOW };
  }

  _setCount(e, n, animate) {
    n = Math.max(0, Math.min(BOARDS_PER_WINDOW, n | 0));
    if (n === e.count) return;
    for (let i = 0; i < BOARDS_PER_WINDOW; i++) {
      const b = e.boards[i];
      const want = i < n;
      const had = i < e.count;
      if (want === had) continue;
      if (animate) {
        b.mode = want ? 'in' : 'out';
        b.anim = 0;
        b.m.visible = true;
        // pequeña variación para que no salgan todas iguales
        b.spin = (Math.random() - 0.5) * 6;
        b.side = (Math.random() - 0.5) * 1.2;
      } else {
        b.mode = null;
        this._home(b);
        b.m.visible = want;
      }
    }
    e.count = n;
  }

  _home(b) {
    b.m.position.set(b.home.x, b.home.y, b.home.z);
    b.m.rotation.set(0, 0, b.home.rz);
  }

  sync(gs, prev, live) {
    const wins = gs.windows || [];
    for (const e of this.list) {
      const n = wins[e.w.id];
      if (n == null) continue;
      this._setCount(e, n, live);
    }
  }

  onEvent(name, ev) {
    if (name !== 'board') return;
    const e = this.list[ev.win];
    if (!e) return;
    const repaired = ev.pid != null;
    this._setCount(e, ev.n, true);
    sfx(this.ctx, repaired ? 'board_repair' : 'board_tear', e.w.cx, 1.4, e.w.cz);
    if (!repaired) {
      _v.set(e.w.cx, 1.2 + Math.random() * 0.8, e.w.cz);
      fx(this.ctx, 'dust', _v.clone(), _n.set(e.f.inX, 0, e.f.inZ).clone());
    }
  }

  update(dt) {
    for (const e of this.list) {
      for (const b of e.boards) {
        if (!b.mode) continue;
        b.anim += dt;
        if (b.mode === 'out') {
          // arrancada hacia fuera: sale volando por la ventana y cae en el callejón
          const t = b.anim;
          const k = Math.min(1, t / 0.55);
          b.m.position.set(b.home.x + b.side * k, b.home.y + 1.6 * t - 4.9 * t * t, b.home.z - 2.4 * k);
          b.m.rotation.set(b.spin * k * 0.5, b.spin * k * 0.3, b.home.rz + b.spin * k);
          if (k >= 1) { b.mode = null; b.m.visible = false; this._home(b); }
        } else {
          // reparada: vuela desde el suelo del interior hasta su sitio
          const k = Math.min(1, b.anim / 0.28);
          const e2 = easeOutBack(k);
          b.m.position.set(b.home.x + b.side * (1 - k) * 0.4, 0.15 + (b.home.y - 0.15) * e2, b.home.z + 0.9 * (1 - k));
          b.m.rotation.set(0, 0, b.home.rz + (1 - k) * b.spin * 0.3);
          if (k >= 1) { b.mode = null; this._home(b); }
        }
      }
    }
  }
}

void WIN; void TAU;
