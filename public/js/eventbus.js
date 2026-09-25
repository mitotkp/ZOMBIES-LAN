// Bus de eventos simple del cliente.
// on(name, fn) -> función para desuscribirse; off(name, fn); emit(name, payload)
// Un oyente que lanza una excepción no impide que los demás reciban el evento.

const MAX_LOGS_PER_LISTENER = 3;

export class EventBus {
  constructor() {
    this._map = new Map();          // nombre -> array de funciones
    this._errors = new WeakMap();   // función -> cantidad de errores registrados
  }

  on(name, fn) {
    if (typeof fn !== 'function') return () => {};
    let list = this._map.get(name);
    if (!list) { list = []; this._map.set(name, list); }
    list.push(fn);
    return () => this.off(name, fn);
  }

  // Suscripción de un solo uso
  once(name, fn) {
    const off = this.on(name, (payload) => { off(); fn(payload); });
    return off;
  }

  off(name, fn) {
    const list = this._map.get(name);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) this._map.delete(name);
  }

  emit(name, payload) {
    const list = this._map.get(name);
    if (!list || !list.length) return;
    // Copia: un oyente puede desuscribirse durante la emisión
    const snapshot = list.slice();
    for (let i = 0; i < snapshot.length; i++) {
      const fn = snapshot[i];
      try {
        fn(payload);
      } catch (err) {
        const n = (this._errors.get(fn) || 0) + 1;
        this._errors.set(fn, n);
        if (n <= MAX_LOGS_PER_LISTENER) {
          console.error(`[EventBus] Error en un oyente de '${name}'${n === MAX_LOGS_PER_LISTENER ? ' (no se registrarán más errores de este oyente)' : ''}:`, err);
        }
      }
    }
  }

  // ¿Hay alguien escuchando este evento?
  has(name) {
    const list = this._map.get(name);
    return !!(list && list.length);
  }

  clear(name) {
    if (name === undefined) this._map.clear();
    else this._map.delete(name);
  }
}

export default EventBus;
