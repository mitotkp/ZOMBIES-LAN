// Entrada de teclado y ratón: acciones con flancos, pointer lock, rueda y acumulado del ratón.
// isDown/pressed/released devuelven false mientras `enabled` es false (menú abierto) o se escribe en un campo de texto.

export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC', 'ControlLeft', 'ControlRight'],
  jump: ['Space'],
  fire: ['Mouse0'],
  ads: ['Mouse2'],
  reload: ['KeyR'],
  use: ['KeyF'],
  melee: ['KeyV', 'Mouse1'],
  grenade: ['KeyG'],
  shield: ['KeyQ'],
  flashlight: ['KeyL'],
  heal: ['KeyH'],
  weapon1: ['Digit1', 'Numpad1'],
  weapon2: ['Digit2', 'Numpad2'],
  weapon3: ['Digit3', 'Numpad3'],
  nextWeapon: ['WheelDown'],
  prevWeapon: ['WheelUp'],
  scoreboard: ['Tab'],
  chat: ['KeyT', 'Enter', 'NumpadEnter'],
  pause: ['Escape'],
};

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'number', 'password', 'url', 'tel']);
const INTERACTIVE_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'LABEL', 'OPTION']);
const MAX_MOVE_PER_EVENT = 400;   // px: descarta saltos anómalos del ratón
const WHEEL_COOLDOWN_MS = 110;

// ¿El elemento es un campo donde se está escribiendo?
function isEditable(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return TEXT_INPUT_TYPES.has((el.getAttribute('type') || '').toLowerCase());
  return false;
}

// ¿El clic cae sobre un control de la interfaz (botón, enlace, campo...)?
function isInteractive(el) {
  for (let n = el, depth = 0; n && n.nodeType === 1 && depth < 6; n = n.parentElement, depth++) {
    if (INTERACTIVE_TAGS.has(n.tagName)) return true;
    if (n.getAttribute && n.getAttribute('role') === 'button') return true;
  }
  return false;
}

export class Input {
  constructor(ctx, opts = {}) {
    this.ctx = ctx || null;
    this.element = opts.element || (ctx && ctx.renderer && ctx.renderer.domElement) || null;
    this.allowUnlocked = !!opts.allowUnlocked;   // modo ?debug=1: mirar arrastrando sin pointer lock
    this.bindings = {};
    this._codeMap = new Map();                   // código -> [acciones]
    this.setBindings(opts.bindings || DEFAULT_BINDINGS);

    this._enabled = true;
    this._held = new Set();          // códigos físicamente pulsados
    this._count = new Map();         // acción -> fuentes pulsadas
    this._pressed = new Set();       // flancos de bajada en este frame
    this._released = new Set();      // flancos de subida en este frame
    this._mx = 0;
    this._my = 0;
    this._dragging = false;
    this._skipMoves = 0;
    this._lastWheel = 0;

    this._bind();
  }

  // ------------------------------------------------------------------ configuración
  setBindings(map) {
    this.bindings = {};
    this._codeMap.clear();
    for (const [action, codes] of Object.entries(map || {})) {
      const list = Array.isArray(codes) ? codes.slice() : [codes];
      this.bindings[action] = list;
      for (const code of list) {
        if (!this._codeMap.has(code)) this._codeMap.set(code, []);
        this._codeMap.get(code).push(action);
      }
    }
  }

  get enabled() { return this._enabled && !this.typing; }
  set enabled(v) {
    const nv = !!v;
    if (nv === this._enabled) return;
    this._enabled = nv;
    // Al cambiar de estado, los flancos pendientes no deben filtrarse al juego
    this._pressed.clear();
    this._released.clear();
    this._mx = 0; this._my = 0;
  }

  // ¿Hay un campo de texto con el foco? (chat, nombre...)
  get typing() {
    return typeof document !== 'undefined' && isEditable(document.activeElement);
  }

  // ------------------------------------------------------------------ consultas
  isDown(action) { return this.enabled && (this._count.get(action) || 0) > 0; }
  pressed(action) { return this.enabled && this._pressed.has(action); }
  released(action) { return this.enabled && this._released.has(action); }

  consumeMouse() {
    const dx = this._mx, dy = this._my;
    this._mx = 0; this._my = 0;
    if (!this.enabled) return { dx: 0, dy: 0 };
    return { dx, dy };
  }

  get locked() {
    return typeof document !== 'undefined' && !!document.pointerLockElement &&
      (!this.element || document.pointerLockElement === this.element);
  }

  requestLock() {
    const el = this.element;
    if (!el || typeof el.requestPointerLock !== 'function') return Promise.resolve(false);
    if (this.locked) return Promise.resolve(true);
    const plain = () => {
      try {
        const r2 = el.requestPointerLock();
        if (r2 && typeof r2.then === 'function') return r2.then(() => true, () => false);
        return Promise.resolve(true);
      } catch {
        return Promise.resolve(false);
      }
    };
    try {
      // Movimiento sin aceleración del sistema cuando el navegador lo permite
      const r = el.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof r.then === 'function') {
        return r.then(() => true, (err) => (err && err.name === 'NotSupportedError' ? plain() : false));
      }
      return Promise.resolve(true);
    } catch {
      return plain();
    }
  }

  exitLock() {
    if (typeof document === 'undefined') return;
    if (document.pointerLockElement && typeof document.exitPointerLock === 'function') {
      try { document.exitPointerLock(); } catch { /* nada */ }
    }
  }

  endFrame() {
    this._pressed.clear();
    this._released.clear();
  }

  // Suelta todas las teclas (pérdida de foco, cambio de pestaña)
  releaseAll() {
    for (const code of Array.from(this._held)) this._up(code);
    this._dragging = false;
  }

  // Nombre legible de la primera tecla asignada a una acción (para textos de ayuda)
  keyLabel(action) {
    const code = (this.bindings[action] || [])[0];
    if (!code) return '';
    const names = {
      Mouse0: 'Clic izq.', Mouse1: 'Clic central', Mouse2: 'Clic der.', WheelUp: 'Rueda arriba', WheelDown: 'Rueda abajo',
      Space: 'Espacio', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
      Tab: 'Tab', Enter: 'Enter', Escape: 'Esc',
    };
    if (names[code]) return names[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
  }

  // ------------------------------------------------------------------ internos
  _down(code) {
    if (this._held.has(code)) return;
    this._held.add(code);
    const actions = this._codeMap.get(code);
    if (!actions) return;
    const edges = this.enabled;
    for (const a of actions) {
      const n = (this._count.get(a) || 0) + 1;
      this._count.set(a, n);
      if (n === 1 && edges) this._pressed.add(a);
    }
  }

  _up(code) {
    if (!this._held.has(code)) return;
    this._held.delete(code);
    const actions = this._codeMap.get(code);
    if (!actions) return;
    const edges = this.enabled;
    for (const a of actions) {
      const n = Math.max(0, (this._count.get(a) || 0) - 1);
      this._count.set(a, n);
      if (n === 0 && edges) this._released.add(a);
    }
  }

  // Pulso instantáneo (rueda): flanco de bajada y subida en el mismo frame
  _pulse(code) {
    if (!this.enabled) return;
    const actions = this._codeMap.get(code);
    if (!actions) return;
    for (const a of actions) { this._pressed.add(a); this._released.add(a); }
  }

  _inGamePointer(e) {
    if (this.locked) return true;
    return this.allowUnlocked && this._enabled && !isInteractive(e.target) && !isEditable(e.target);
  }

  _bind() {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      if (isEditable(e.target)) return;          // escribiendo: que el navegador lo gestione
      const code = e.code;
      if (!code) return;
      const bound = this._codeMap.has(code);
      // En juego, evitar acciones del navegador (desplazar, buscar, recargar con Ctrl+R, mover el foco con Tab...)
      if (bound && this.enabled && code !== 'Escape') e.preventDefault();
      else if (code === 'Tab' && this.enabled) e.preventDefault();
      if (e.repeat) return;
      this._down(code);
    });

    window.addEventListener('keyup', (e) => {
      const code = e.code;
      if (!code) return;
      if (this._codeMap.has(code) && this.enabled && !isEditable(e.target)) e.preventDefault();
      this._up(code);
    });

    window.addEventListener('mousedown', (e) => {
      if (!this._inGamePointer(e)) return;
      if (!this.locked) this._dragging = true;
      if (e.button === 1 || this.locked) e.preventDefault();
      this._down('Mouse' + e.button);
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 || !this.locked) this._dragging = false;
      this._up('Mouse' + e.button);
    });

    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        if (this._skipMoves > 0) { this._skipMoves--; return; }
        const dx = e.movementX || 0, dy = e.movementY || 0;
        if (Math.abs(dx) > MAX_MOVE_PER_EVENT || Math.abs(dy) > MAX_MOVE_PER_EVENT) return;
        this._mx += dx;
        this._my += dy;
      } else if (this.allowUnlocked && this._dragging) {
        this._mx += e.movementX || 0;
        this._my += e.movementY || 0;
      }
    });

    window.addEventListener('wheel', (e) => {
      if (!this._inGamePointer(e)) return;
      e.preventDefault();
      const dy = e.deltaY || 0;
      if (Math.abs(dy) < 0.5) return;
      const t = performance.now();
      if (t - this._lastWheel < WHEEL_COOLDOWN_MS) return;
      this._lastWheel = t;
      this._pulse(dy > 0 ? 'WheelDown' : 'WheelUp');
    }, { passive: false });

    window.addEventListener('contextmenu', (e) => {
      if (!isEditable(e.target)) e.preventDefault();
    });

    if (this.element) {
      this.element.addEventListener('dragstart', (e) => e.preventDefault());
      this.element.addEventListener('selectstart', (e) => e.preventDefault());
    }

    document.addEventListener('pointerlockchange', () => {
      const locked = this.locked;
      if (locked) {
        this._skipMoves = 1;        // el primer movimiento tras bloquear suele traer un salto
        this._mx = 0; this._my = 0;
      } else {
        // Al perder el bloqueo se sueltan los botones del ratón
        for (const code of Array.from(this._held)) if (code.startsWith('Mouse')) this._up(code);
      }
      const ev = this.ctx && this.ctx.events;
      if (ev && ev.emit) ev.emit('input:lock', { locked });
    });

    document.addEventListener('pointerlockerror', () => {
      const ev = this.ctx && this.ctx.events;
      if (ev && ev.emit) ev.emit('input:lockerror', {});
    });

    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
  }
}

export default Input;
