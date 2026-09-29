// Piscina de objetos genérica: reutiliza objetos en vez de crear/tirar uno nuevo cada vez (menos basura para
// el recolector durante las hordas). `create()` construye un objeto nuevo cuando la piscina está vacía;
// quien adquiere es responsable de (re)inicializar TODOS los campos (la piscina no toca el contenido).
//
// Liberación diferida (deferRelease + flush): un objeto que acaba de "morir" puede seguir siendo leído en
// el resto del mismo tick (eventos, puntos, explosiones...). Si se devolviera y reutilizara al instante,
// esa lectura vería datos de otro zombi. Con deferRelease() el objeto espera en cuarentena y flush() (al
// principio del siguiente tick) lo devuelve de verdad.

export class ObjectPool {
  constructor(create, { max = 64, prewarm = 0 } = {}) {
    this._create = create;
    this._max = max;
    this._free = [];
    this._quarantine = [];
    this.stats = { created: 0, reused: 0, dropped: 0 };
    for (let i = 0; i < prewarm; i++) { this._free.push(create()); this.stats.created++; }
  }

  get available() { return this._free.length; }
  get pending() { return this._quarantine.length; }

  acquire() {
    const o = this._free.pop();
    if (o !== undefined) { this.stats.reused++; return o; }
    this.stats.created++;
    return this._create();
  }

  // Devuelve ya (solo si nadie más va a leer el objeto)
  release(o) {
    if (this._free.length < this._max) this._free.push(o);
    else this.stats.dropped++;
  }

  // Lo devuelve en el próximo flush()
  deferRelease(o) { this._quarantine.push(o); }

  flush() {
    const q = this._quarantine;
    for (let i = 0; i < q.length; i++) this.release(q[i]);
    q.length = 0;
  }

  // Descarta todo lo pendiente sin reutilizarlo (p. ej. al reiniciar la partida)
  clearPending() { this._quarantine.length = 0; }
}

export default ObjectPool;
