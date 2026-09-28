// Ragdoll de un jugador caído: 11 cuerpos rígidos de Rapier (uno por Group de playerModel.js) unidos por
// articulaciones con límites de ángulo reales. Solo cosmético: no se sincroniza por red.
//
// Convención del rig (playerModel.js): cada Group hijo está desplazado del padre a lo largo del eje local -Y
// del padre (el "hueso" apunta hacia -Y). Por eso cada cápsula se centra desplazando halfHeight a lo largo de
// esa misma dirección desde el pivote del Group, y el cuaternión de mundo del Group ya sirve tal cual como
// rotación inicial de la cápsula (su eje largo también es Y).
import * as THREE from 'three';

// Grupo de colisión de Rapier (16 bits de pertenencia << 16 | 16 bits de filtro): todas las cápsulas de
// CUALQUIER ragdoll comparten el bit 1 como pertenencia y excluyen ese mismo bit de su filtro, así que dos
// cuerpos "ragdoll" nunca colisionan entre sí (ni dentro del mismo jugador ni entre jugadores caídos a la
// vez) pero sí siguen colisionando con el mapa, que se queda con el filtro por defecto (colisiona con todo).
const RAGDOLL_MEMBERSHIP = 0x0002;
const RAGDOLL_FILTER = 0xffff & ~RAGDOLL_MEMBERSHIP;
const RAGDOLL_GROUPS = (RAGDOLL_MEMBERSHIP << 16) | RAGDOLL_FILTER;

// radius/halfHeight en metros: a ojo a partir de los radios reales de las mallas y las longitudes D.* de
// playerModel.js (D.upper=0.3, D.fore=0.32, D.thigh=0.45, D.shin=0.44, D.neckY=0.53) — valores de partida,
// se afinan visualmente en /test/.
const SEGMENTS = [
  { key: 'hips', parent: null, radius: 0.16, halfHeight: 0.02 },
  { key: 'spine', parent: 'hips', radius: 0.16, halfHeight: 0.105 },
  { key: 'neck', parent: 'spine', radius: 0.10, halfHeight: 0.03 },
  { key: 'armL_sh', parent: 'spine', radius: 0.055, halfHeight: 0.095 },
  { key: 'armL_el', parent: 'armL_sh', radius: 0.045, halfHeight: 0.115 },
  { key: 'armR_sh', parent: 'spine', radius: 0.055, halfHeight: 0.095 },
  { key: 'armR_el', parent: 'armR_sh', radius: 0.045, halfHeight: 0.115 },
  { key: 'legL_th', parent: 'hips', radius: 0.077, halfHeight: 0.148 },
  { key: 'legL_kn', parent: 'legL_th', radius: 0.06, halfHeight: 0.16 },
  { key: 'legR_th', parent: 'hips', radius: 0.077, halfHeight: 0.148 },
  { key: 'legR_kn', parent: 'legR_th', radius: 0.06, halfHeight: 0.16 },
];
// Límites de ángulo (rad) de las uniones de un solo eje, relativos a la pose de siembra (no a un "cero"
// anatómico absoluto: Rapier mide el ángulo entre los ejes locales tal como se siembran) — rangos generosos
// y simétricos para no arrancar ya al límite; codo/rodilla con algo de margen negativo por si el convenio de
// signo sale al revés. Hombro/cadera están aparte, en BALL_JOINTS (necesitan 2 ejes, no 1).
const LIMITS = {
  spine: [-1.05, 1.05], neck: [-1.05, 1.05],
  armL_el: [-0.17, 2.62], armR_el: [-0.17, 2.62],
  legL_kn: [-0.17, 2.62], legR_kn: [-0.17, 2.62],
};
// Hombro/cadera: los bindings JS de Rapier no dan límites de cono en spherical ni en generic (confirmado
// contra dynamics/impulse_joint.d.ts del paquete instalado — SphericalImpulseJoint y GenericImpulseJoint no
// heredan de UnitImpulseJoint, que es el único con setLimits). Para tener una rótula con límites reales de
// todas formas, se intercala un cuerpo diminuto ("swing") entre padre e hijo, unido por dos bisagras en ejes
// perpendiculares — flexión/extensión (adelante-atrás) y abducción/aducción (hacia los lados) — cada una con
// su propio límite. Es la técnica estándar para aproximar una rótula limitada con un motor que solo da
// bisagras de un eje. Queda sin limitar el giro sobre el propio eje del hueso (torsión), el grado de libertad
// menos visible en un ragdoll.
const BALL_JOINTS = {
  armL_sh: { limitsA: [-1.92, 1.92], limitsB: [-2.09, 2.09] },
  armR_sh: { limitsA: [-1.92, 1.92], limitsB: [-2.09, 2.09] },
  legL_th: { limitsA: [-1.92, 1.92], limitsB: [-1.57, 1.57] },
  legR_th: { limitsA: [-1.92, 1.92], limitsB: [-1.57, 1.57] },
};
function groupOf(model, key) {
  switch (key) {
    case 'hips': return model.hips;
    case 'spine': return model.spine;
    case 'neck': return model.neck;
    case 'armL_sh': return model.armL.sh;
    case 'armL_el': return model.armL.el;
    case 'armR_sh': return model.armR.sh;
    case 'armR_el': return model.armR.el;
    case 'legL_th': return model.legL.th;
    case 'legL_kn': return model.legL.kn;
    case 'legR_th': return model.legR.th;
    case 'legR_kn': return model.legR.kn;
    default: return null;
  }
}

const _pv = new THREE.Vector3();
const _cv = new THREE.Vector3();
const _pq = new THREE.Quaternion();
const _cq = new THREE.Quaternion();
const _down = new THREE.Vector3();
const _axisW = new THREE.Vector3();
const _axisW2 = new THREE.Vector3();
const _anchorP = new THREE.Vector3();
const _anchorC = new THREE.Vector3();
const _axisP = new THREE.Vector3();
const _axisC = new THREE.Vector3();
const _axisSwingA = new THREE.Vector3();
const _axisSwingB = new THREE.Vector3();
const _lv = new THREE.Vector3();
const _lq = new THREE.Quaternion();

// Convierte un punto/dirección de mundo al espacio local de body (usa la orientación/posición ACTUAL del
// cuerpo, leída directamente de Rapier — no depende de que ningún Group de Three.js esté actualizado).
function localPoint(body, worldPoint, out) {
  const t = body.translation(), r = body.rotation();
  return out.copy(worldPoint).sub(_lv.set(t.x, t.y, t.z)).applyQuaternion(_lq.set(r.x, r.y, r.z, r.w).invert());
}
function localDir(body, worldDir, out) {
  const r = body.rotation();
  return out.copy(worldDir).applyQuaternion(_lq.set(r.x, r.y, r.z, r.w).invert());
}

export class Ragdoll {
  constructor(physicsWorld, playerModel, fromX, fromZ, amt) {
    this.pw = physicsWorld;
    this.model = playerModel;
    this.bodies = {};       // key -> RigidBody
    this.swingBodies = {};  // key -> RigidBody (los 4 cuerpos intermedios de hombro/cadera, ver BALL_JOINTS)
    this.joints = [];       // ImpulseJoint[]
    this.age = 0;

    const RAPIER = physicsWorld.RAPIER;
    const world = physicsWorld.world;
    playerModel.group.updateMatrixWorld(true);

    // 1) Cuerpos: cápsula centrada a halfHeight del pivote del Group, a lo largo de su -Y de mundo.
    for (const seg of SEGMENTS) {
      const g = groupOf(playerModel, seg.key);
      g.getWorldPosition(_pv);
      g.getWorldQuaternion(_pq);
      _down.set(0, -1, 0).applyQuaternion(_pq);
      const center = _pv.clone().addScaledVector(_down, seg.halfHeight);
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: _pq.x, y: _pq.y, z: _pq.z, w: _pq.w })
        .setLinearDamping(0.15).setAngularDamping(0.5);
      const body = world.createRigidBody(bodyDesc);
      // Densidad ~agua/tejido: sin esto Rapier usa densidad 1 (kg/m³), así que estas cápsulas pequeñas
      // pesarían gramos y cualquier velocidad inicial las dispararía a decenas de m/s.
      world.createCollider(
        RAPIER.ColliderDesc.capsule(seg.halfHeight, seg.radius).setDensity(1000).setCollisionGroups(RAGDOLL_GROUPS),
        body,
      );
      this.bodies[seg.key] = body;
    }

    // 2) Uniones: ancla = punto de mundo del pivote del Group (donde padre e hijo se tocan al sembrar).
    // Ejes de bisagra en espacio de mundo: "derecha" del personaje (flexión/extensión, la misma que usan
    // codo/rodilla) y "adelante" (abducción/aducción, solo para hombro/cadera — ver BALL_JOINTS).
    _axisW.set(1, 0, 0).applyQuaternion(playerModel.group.quaternion);
    _axisW2.set(0, 0, 1).applyQuaternion(playerModel.group.quaternion);
    for (const seg of SEGMENTS) {
      if (!seg.parent) continue;
      const childBody = this.bodies[seg.key];
      const parentBody = this.bodies[seg.parent];
      const jointWorld = groupOf(playerModel, seg.key).getWorldPosition(_pv).clone();
      const ball = BALL_JOINTS[seg.key];

      if (ball) {
        // Cuerpo "swing" diminuto en el propio punto de la articulación, con la orientación del padre al
        // sembrar (solo sirve de referencia para los dos ejes; no tiene Group ni se lee en sampleInto).
        const pr = parentBody.rotation();
        const swingDesc = RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(jointWorld.x, jointWorld.y, jointWorld.z)
          .setRotation({ x: pr.x, y: pr.y, z: pr.z, w: pr.w })
          .setLinearDamping(0.15).setAngularDamping(0.5);
        const swing = world.createRigidBody(swingDesc);
        world.createCollider(RAPIER.ColliderDesc.ball(0.02).setDensity(1000).setCollisionGroups(RAGDOLL_GROUPS), swing);
        this.swingBodies[seg.key] = swing;

        // Bisagra A: padre -> swing, eje "derecha" (flexión/extensión).
        localPoint(parentBody, jointWorld, _anchorP);
        localDir(parentBody, _axisW, _axisP);
        localDir(swing, _axisW, _axisSwingA);
        const jdA = RAPIER.JointData.revoluteWithAxes(
          { x: _anchorP.x, y: _anchorP.y, z: _anchorP.z }, { x: 0, y: 0, z: 0 },
          { x: _axisP.x, y: _axisP.y, z: _axisP.z }, { x: _axisSwingA.x, y: _axisSwingA.y, z: _axisSwingA.z },
        );
        const jointA = world.createImpulseJoint(jdA, parentBody, swing, true);
        if (typeof jointA.setLimits === 'function') jointA.setLimits(ball.limitsA[0], ball.limitsA[1]);
        this.joints.push(jointA);

        // Bisagra B: swing -> hijo, eje "adelante" (abducción/aducción).
        localDir(swing, _axisW2, _axisSwingB);
        localPoint(childBody, jointWorld, _anchorC);
        localDir(childBody, _axisW2, _axisC);
        const jdB = RAPIER.JointData.revoluteWithAxes(
          { x: 0, y: 0, z: 0 }, { x: _anchorC.x, y: _anchorC.y, z: _anchorC.z },
          { x: _axisSwingB.x, y: _axisSwingB.y, z: _axisSwingB.z }, { x: _axisC.x, y: _axisC.y, z: _axisC.z },
        );
        const jointB = world.createImpulseJoint(jdB, swing, childBody, true);
        if (typeof jointB.setLimits === 'function') jointB.setLimits(ball.limitsB[0], ball.limitsB[1]);
        this.joints.push(jointB);
        continue;
      }

      // Resto de uniones: bisagra simple de 1 eje (codo/rodilla ya son así anatómicamente; cuello/columna
      // se simplifican igual).
      localPoint(parentBody, jointWorld, _anchorP);
      localDir(parentBody, _axisW, _axisP);
      localPoint(childBody, jointWorld, _anchorC);
      localDir(childBody, _axisW, _axisC);
      const jd = RAPIER.JointData.revoluteWithAxes(
        { x: _anchorP.x, y: _anchorP.y, z: _anchorP.z }, { x: _anchorC.x, y: _anchorC.y, z: _anchorC.z },
        { x: _axisP.x, y: _axisP.y, z: _axisP.z }, { x: _axisC.x, y: _axisC.y, z: _axisC.z },
      );
      const joint = world.createImpulseJoint(jd, parentBody, childBody, true);
      const lim = LIMITS[seg.key];
      if (lim && typeof joint.setLimits === 'function') joint.setLimits(lim[0], lim[1]);
      this.joints.push(joint);
    }

    // 3) Velocidad inicial (dirección atacante → jugador, o solo vertical si no hay atacante conocido),
    // escalada por lo fuerte que fue el golpe que derribó al jugador. Escala lineal (no logarítmica, como en
    // los gibs de zombis): el daño de un solo golpe a un jugador se mueve en un rango mucho más estrecho
    // (como mucho ronda los 60, el tope de un golpe fuerte de jefe/tanque — ZOMBIE.damage=25 es lo normal),
    // así que no hace falta comprimir varios órdenes de magnitud.
    // Se fija directamente con setLinvel en vez de un impulso: así no depende de la masa del cuerpo.
    const scale = Math.max(0.6, Math.min(2.0, 0.6 + Math.max(0, amt || 0) / 50));
    const pelvis = this.bodies.hips;
    const p = playerModel.group.position;
    let ix = 0, iz = 0;
    if (Number.isFinite(fromX) && Number.isFinite(fromZ)) {
      const dx = p.x - fromX, dz = p.z - fromZ;
      const len = Math.hypot(dx, dz) || 1;
      ix = (dx / len) * 2.2 * scale; iz = (dz / len) * 2.2 * scale;
    }
    pelvis.setLinvel({ x: ix, y: 1.6 * scale, z: iz }, true);
  }

  // Cada frame: lee la orientación/posición absoluta de cada cuerpo y la convierte en la rotación LOCAL del
  // Group correspondiente (padre antes que hijo). Solo hips recibe también posición — el resto conserva su
  // desplazamiento fijo de siempre respecto a su padre, igual que hace _apply() en modo normal.
  sampleInto(playerModel) {
    const groupQ = playerModel.group.quaternion;
    const setLocal = (g, body, parentPosW, parentQuatW, isHips) => {
      const t = body.translation(), r = body.rotation();
      _cq.set(r.x, r.y, r.z, r.w);
      const localQ = parentQuatW.clone().invert().multiply(_cq);
      g.quaternion.copy(localQ);
      if (isHips) {
        _cv.set(t.x, t.y, t.z).sub(parentPosW).applyQuaternion(parentQuatW.clone().invert());
        g.position.copy(_cv);
      }
    };
    const groupPos = playerModel.group.position;
    setLocal(playerModel.hips, this.bodies.hips, groupPos, groupQ, true);

    const wq = (key) => { const r = this.bodies[key].rotation(); return _pq.set(r.x, r.y, r.z, r.w).clone(); };
    const wp = (key) => { const t = this.bodies[key].translation(); return _pv.set(t.x, t.y, t.z).clone(); };
    setLocal(playerModel.spine, this.bodies.spine, wp('hips'), wq('hips'), false);
    setLocal(playerModel.neck, this.bodies.neck, wp('spine'), wq('spine'), false);
    setLocal(playerModel.armL.sh, this.bodies.armL_sh, wp('spine'), wq('spine'), false);
    setLocal(playerModel.armR.sh, this.bodies.armR_sh, wp('spine'), wq('spine'), false);
    setLocal(playerModel.armL.el, this.bodies.armL_el, wp('armL_sh'), wq('armL_sh'), false);
    setLocal(playerModel.armR.el, this.bodies.armR_el, wp('armR_sh'), wq('armR_sh'), false);
    setLocal(playerModel.legL.th, this.bodies.legL_th, wp('hips'), wq('hips'), false);
    setLocal(playerModel.legR.th, this.bodies.legR_th, wp('hips'), wq('hips'), false);
    setLocal(playerModel.legL.kn, this.bodies.legL_kn, wp('legL_th'), wq('legL_th'), false);
    setLocal(playerModel.legR.kn, this.bodies.legR_kn, wp('legR_th'), wq('legR_th'), false);
  }

  isSettled(maxAge) {
    if (this.age > maxAge) return true;
    for (const key in this.bodies) if (!this.bodies[key].isSleeping()) return false;
    return true;
  }

  update(dt) { this.age += dt; }

  dispose() {
    const world = this.pw.world;
    for (const j of this.joints) { try { world.removeImpulseJoint(j, true); } catch { /* ya liberado */ } }
    for (const key in this.bodies) { try { world.removeRigidBody(this.bodies[key]); } catch { /* ya liberado */ } }
    for (const key in this.swingBodies) { try { world.removeRigidBody(this.swingBodies[key]); } catch { /* ya liberado */ } }
    this.joints.length = 0;
    this.bodies = {};
    this.swingBodies = {};
  }
}
