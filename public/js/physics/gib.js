// Pieza de desmembramiento (cabeza, brazo, pierna) con física real de Rapier: un solo cuerpo rígido, sin
// articulaciones — una vez separada de un zombi no está unida a nada. Colisiona con el mapa real (muros,
// props, escaleras) igual que el ragdoll del jugador, en vez del suelo plano fijo del sistema anterior.
//
// Se asume que el objeto lanzado cuelga de un padre con transformada identidad (EntityManager.group, en la
// raíz de la escena) — así que su .position/.quaternion LOCAL ya son directamente su posición/orientación de
// MUNDO, sin falta de tocar matrixWorld ni convertir nada (ver zombieModel.js: parent.attach(obj) antes de
// crear el Gib preserva la transformada de mundo en esas mismas propiedades locales).

// Las piezas se ignoran entre sí (para que dos trozos nacidos en el mismo punto no se atasquen empujándose)
// pero sí colisionan con el mapa y con los ragdolls de jugadores caídos.
const GIB_MEMBERSHIP = 0x0004;
const GIB_FILTER = 0xffff & ~GIB_MEMBERSHIP;
const GIB_GROUPS = (GIB_MEMBERSHIP << 16) | GIB_FILTER;

export class Gib {
  // shape: { type: 'ball', radius, offset? } | { type: 'capsule', halfHeight, radius, offset? }
  // offset (opcional, {x,y,z}): desplazamiento LOCAL de la forma respecto al origen del objeto (el pivote de
  // la pieza, p. ej. el hombro) — el cuerpo rígido en sí se siembra siempre en el pivote, para que sampleInto
  // pueda escribir directamente en obj.position sin ningún cálculo adicional.
  // linvel/angvel: {x,y,z} — velocidad lineal y angular iniciales (mundo).
  constructor(physicsWorld, obj, shape, linvel, angvel) {
    this.pw = physicsWorld;
    this.age = 0;
    const RAPIER = physicsWorld.RAPIER;
    const world = physicsWorld.world;
    const p = obj.position, q = obj.quaternion;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.05).setAngularDamping(0.2);
    this.body = world.createRigidBody(bodyDesc);
    const cd = (shape.type === 'ball' ? RAPIER.ColliderDesc.ball(shape.radius) : RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius))
      .setDensity(1000).setRestitution(0.3).setFriction(0.8).setCollisionGroups(GIB_GROUPS);
    if (shape.offset) cd.setTranslation(shape.offset.x, shape.offset.y, shape.offset.z);
    world.createCollider(cd, this.body);
    this.body.setLinvel({ x: linvel.x, y: linvel.y, z: linvel.z }, true);
    this.body.setAngvel({ x: angvel.x, y: angvel.y, z: angvel.z }, true);
  }

  sampleInto(obj) {
    const t = this.body.translation(), r = this.body.rotation();
    obj.position.set(t.x, t.y, t.z);
    obj.quaternion.set(r.x, r.y, r.z, r.w);
  }

  isSettled(maxAge = 3) {
    return this.age > maxAge || this.body.isSleeping();
  }

  update(dt) { this.age += dt; }

  dispose() {
    try { this.pw.world.removeRigidBody(this.body); } catch { /* ya liberado */ }
  }
}
