// Mundo de físicas de Rapier3D, compartido por todos los ragdolls de jugadores caídos. Carga asíncrona sin
// bloquear el arranque (mismo patrón que MODELS/modelsFailed en playerModel.js): mientras this.ready es false,
// createRagdoll() no hace nada y el jugador se queda con la pose estática de "última batalla" de siempre.
// Colisionadores estáticos del mapa: se reconstruyen al cargar y cada vez que cambia MAP_ID. Se detecta
// comparando MAP_ID en cada update() en vez de escuchar el evento 'map:change' — ese evento también lo
// escucha main.js para llamar a setActiveMap(), y como PhysicsWorld se construye ANTES de que main.js
// registre su propio listener (main.js lo hace más tarde en boot()), un listener aquí se ejecutaría antes
// de que setActiveMap() actualizase MAP/MAP_ID, leyendo el mapa todavía viejo. Comprobar MAP_ID en update()
// es independiente del orden de los listeners.
import * as THREE from 'three';
import { PLAYER } from '/shared/constants.js';
import { MAP, MAP_ID, C, WALL_KIND } from '/shared/map.js';
import { Ragdoll } from './ragdoll.js';
import { Gib } from './gib.js';

const STAIR_HALF_THICK = 0.3;
const DOOR_HEIGHT = 4.0;   // altura de bloqueo de una puerta cerrada: la misma que un muro normal (MAP.WALL_H)
const MAX_RAGDOLL_TIME = 3;

function idx(x, z) { return z * MAP.W + x; }

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _rx = new THREE.Vector3();
const _ry = new THREE.Vector3();
const _rz = new THREE.Vector3();
const _rm = new THREE.Matrix4();
const _rq = new THREE.Quaternion();

// Caja orientada entre dos puntos de mundo (p0 → p1), con el ancho perpendicular alineado a widthDir.
function orientedBox(p0, p1, widthDir) {
  _rz.copy(p1).sub(p0);
  const halfLength = _rz.length() / 2;
  _rz.normalize();
  _rx.copy(widthDir).addScaledVector(_rz, -widthDir.dot(_rz)).normalize();
  _ry.crossVectors(_rz, _rx).normalize();
  _rm.makeBasis(_rx, _ry, _rz);
  _rq.setFromRotationMatrix(_rm);
  return { cx: (p0.x + p1.x) / 2, cy: (p0.y + p1.y) / 2, cz: (p0.z + p1.z) / 2, halfLength, quat: _rq.clone() };
}

export class PhysicsWorld {
  constructor(ctx) {
    this.ctx = ctx || {};
    this.ready = false;
    this.RAPIER = null;
    this.world = null;
    this._timestep = 1 / 60;
    this._acc = 0;
    this._mapBody = null;
    this._doorColliders = new Map();   // doorId -> Collider
    this._ragdolls = new Set();
    this._gibs = new Set();
    this._onReady = [];
    this._builtMapId = null;

    const ev = this.ctx.events;
    if (ev && typeof ev.on === 'function') {
      ev.on('gs', ({ gs }) => { if (this.ready && gs) this._syncDoors(gs); });
    }
    this._init();
  }

  async _init() {
    try {
      const mod = await import('@dimforge/rapier3d-compat');
      const RAPIER = mod.default || mod;
      await RAPIER.init();
      this.RAPIER = RAPIER;
      this.world = new RAPIER.World({ x: 0, y: -PLAYER.gravity, z: 0 });
      this.world.timestep = this._timestep;
      this._buildMapColliders();
      if (this.ctx.gs) this._syncDoors(this.ctx.gs);
      this.ready = true;
      for (const fn of this._onReady) fn();
      this._onReady.length = 0;
    } catch (err) {
      console.warn('[PhysicsWorld] No se pudo cargar Rapier3D; no habrá ragdoll físico.', err);
    }
  }

  // Suelo plano adicional para escenas que no comparten coordenadas con el mapa real (p. ej. la pestaña
  // "Modelos" de /test/, que renderiza en su propia escena aislada). No lo usa el juego real.
  addFlatGroundPlane(y = 0, halfSize = 50) {
    const add = () => {
      const cd = this.RAPIER.ColliderDesc.cuboid(halfSize, 0.1, halfSize).setTranslation(0, y - 0.1, 0);
      this.world.createCollider(cd, this._mapBody);
    };
    if (this.ready) add(); else this._onReady.push(add);
  }

  // ------------------------------------------------------------------ colisionadores estáticos del mapa
  _buildMapColliders() {
    const RAPIER = this.RAPIER, world = this.world;
    if (this._mapBody) { world.removeRigidBody(this._mapBody); this._mapBody = null; }
    this._doorColliders.clear();
    this._mapBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

    const addBox = (x0, x1, z0, z1, baseY, height) => {
      const hx = (x1 - x0 + 1) / 2, hz = (z1 - z0 + 1) / 2, hy = height / 2;
      const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation((x0 + x1 + 1) / 2, baseY + hy, (z0 + z1 + 1) / 2);
      return world.createCollider(cd, this._mapBody);
    };
    // Losa fina de suelo (top exacto en baseY) bajo FLOOR/DOOR — sin esto un ragdoll cae atravesando el
    // suelo indefinidamente: WALL/WINDOW/PROP ya son cajas sólidas desde el suelo hacia arriba, pero el
    // suelo transitable en sí no tenía ningún colisionador.
    const addFloor = (x0, x1, z0, z1, baseY) => {
      const hx = (x1 - x0 + 1) / 2, hz = (z1 - z0 + 1) / 2, hy = 0.1;
      const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation((x0 + x1 + 1) / 2, baseY - hy, (z0 + z1 + 1) / 2);
      return world.createCollider(cd, this._mapBody);
    };

    const W = MAP.W, H = MAP.H;
    for (let l = 0; l < MAP.NL; l++) {
      const T = MAP.cellTypeL[l], K = MAP.cellWallKindL[l], HGT = MAP.cellHeightL[l];
      const baseY = MAP.levels[l].y;
      for (let z = 0; z < H; z++) {
        let x = 0;
        while (x < W) {
          const t = T[idx(x, z)];
          if (t === C.WALL) {
            const kind = K[idx(x, z)];
            let x2 = x;
            while (x2 + 1 < W && T[idx(x2 + 1, z)] === C.WALL && K[idx(x2 + 1, z)] === kind) x2++;
            addBox(x, x2, z, z, baseY, kind === WALL_KIND.FENCE ? MAP.FENCE_H : MAP.WALL_H);
            x = x2 + 1;
          } else if (t === C.WINDOW) {
            let x2 = x;
            while (x2 + 1 < W && T[idx(x2 + 1, z)] === C.WINDOW) x2++;
            addBox(x, x2, z, z, baseY, MAP.WALL_H);
            x = x2 + 1;
          } else if (t === C.PROP) {
            const h = HGT[idx(x, z)];
            let x2 = x;
            while (x2 + 1 < W && T[idx(x2 + 1, z)] === C.PROP && HGT[idx(x2 + 1, z)] === h) x2++;
            addBox(x, x2, z, z, baseY, h);
            x = x2 + 1;
          } else if (t === C.FLOOR || t === C.DOOR) {
            let x2 = x;
            while (x2 + 1 < W && (T[idx(x2 + 1, z)] === C.FLOOR || T[idx(x2 + 1, z)] === C.DOOR)) x2++;
            addFloor(x, x2, z, z, baseY);
            x = x2 + 1;
          } else {
            x++;   // VOID, OUTSIDE, HOLE, OPEN, STAIR (aparte): sin caja aquí
          }
        }
      }
    }

    // Puertas: un colisionador por puerta, activado/desactivado según gs.doors
    for (const d of MAP.DOORS) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [cx, cz] of d.cells) { x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); z0 = Math.min(z0, cz); z1 = Math.max(z1, cz); }
      const collider = addBox(x0, x1, z0, z1, MAP.levels[d.lv].y, DOOR_HEIGHT);
      this._doorColliders.set(d.id, collider);
    }

    // Escaleras: una caja inclinada por tramo (las barandillas laterales ya son muros normales generados arriba)
    for (const st of MAP.STAIRS) {
      const alongZ = st.dir === 'N' || st.dir === 'S';
      const cx = (st.x0 + st.x1 + 1) / 2, cz = (st.z0 + st.z1 + 1) / 2;
      if (alongZ) { _p0.set(cx, MAP.rampY(st, cx, st.z0), st.z0); _p1.set(cx, MAP.rampY(st, cx, st.z1 + 1), st.z1 + 1); }
      else { _p0.set(st.x0, MAP.rampY(st, st.x0, cz), cz); _p1.set(st.x1 + 1, MAP.rampY(st, st.x1 + 1, cz), cz); }
      const widthDir = alongZ ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const halfWidth = alongZ ? (st.x1 - st.x0 + 1) / 2 : (st.z1 - st.z0 + 1) / 2;
      const ob = orientedBox(_p0, _p1, widthDir);
      const cd = RAPIER.ColliderDesc.cuboid(halfWidth, STAIR_HALF_THICK, ob.halfLength)
        .setTranslation(ob.cx, ob.cy, ob.cz)
        .setRotation({ x: ob.quat.x, y: ob.quat.y, z: ob.quat.z, w: ob.quat.w });
      world.createCollider(cd, this._mapBody);
    }
    this._builtMapId = MAP_ID;
  }

  _syncDoors(gs) {
    const open = gs && gs.doors;
    for (const [id, collider] of this._doorColliders) {
      try { collider.setEnabled(!(open && open[id])); } catch { /* colisionador ya liberado */ }
    }
  }

  // ------------------------------------------------------------------ paso de simulación
  update(dt) {
    dt = Math.min(Math.max(+dt || 0, 0), 0.1);
    if (!this.ready) return;
    if (MAP_ID !== this._builtMapId) this._buildMapColliders();
    if (this._ragdolls.size === 0 && this._gibs.size === 0) return;
    this._acc += dt;
    let steps = 0;
    while (this._acc >= this._timestep && steps < 4) {
      this.world.step();
      this._acc -= this._timestep;
      steps++;
    }
    for (const rd of this._ragdolls) rd.update(dt);
    for (const g of this._gibs) g.update(dt);
  }

  // ------------------------------------------------------------------ API de ragdoll
  createRagdoll(playerModel, fromX, fromZ, amt) {
    if (!this.ready) return null;
    let rd;
    try { rd = new Ragdoll(this, playerModel, fromX, fromZ, amt); } catch (err) { console.warn('[PhysicsWorld] No se pudo crear el ragdoll:', err); return null; }
    this._ragdolls.add(rd);
    return rd;
  }

  destroyRagdoll(rd) {
    if (!rd || !this._ragdolls.has(rd)) return;
    this._ragdolls.delete(rd);
    rd.dispose();
  }

  isRagdollSettled(rd) { return !rd || rd.isSettled(MAX_RAGDOLL_TIME); }

  // ------------------------------------------------------------------ API de piezas desmembradas (gibs)
  createGib(obj, shape, linvel, angvel) {
    if (!this.ready) return null;
    let g;
    try { g = new Gib(this, obj, shape, linvel, angvel); } catch (err) { console.warn('[PhysicsWorld] No se pudo crear el gib:', err); return null; }
    this._gibs.add(g);
    return g;
  }

  destroyGib(g) {
    if (!g || !this._gibs.has(g)) return;
    this._gibs.delete(g);
    g.dispose();
  }
}
