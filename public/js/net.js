// Conexión WebSocket con el servidor, reloj del servidor e interpolación de snapshots.
// Despacha los mensajes al bus de eventos de ctx: 'welcome', 'gs', 'phase', 'ev:<nombre>'
// y eventos propios 'net:open', 'net:close', 'net:kick'.

import { INTERP_DELAY_MS, angleDiff } from '/shared/constants.js';
import { safeParse } from '/shared/protocol.js';

const MAX_EXTRAP_MS = 100;       // extrapolación máxima si falta el snapshot siguiente
const BUFFER_KEEP_MS = 1500;     // cuánto historial de snapshots se guarda
const TELEPORT_DIST2 = 5 * 5;    // saltos mayores no se interpolan (reapariciones)
const CONNECT_TIMEOUT_MS = 8000;

// Reloj local monotónico en ms de época (comparable con Date.now() del servidor)
function localNow() {
  return (performance.timeOrigin || 0) + performance.now();
}

function lerpAngle(a, b, t) { return a + angleDiff(a, b) * t; }

export class Net {
  constructor(ctx) {
    this.ctx = ctx || null;
    this.ws = null;
    this.url = null;
    this.connected = false;
    this.rtt = 0;               // ms (suavizado)
    this.lastKick = null;       // motivo del último 'kick'
    this.stats = { msgsIn: 0, bytesIn: 0, msgsOut: 0, bytesOut: 0 };

    this._offset = 0;           // serverNow = localNow + offset
    this._haveOffset = false;
    this._havePong = false;
    this._minRtt = Infinity;
    this._snaps = [];           // [{ now, z: Map, p: Map }] ordenados por now
    this._intentional = false;
  }

  // ------------------------------------------------------------------ conexión
  connect(url) {
    if (!url) {
      const proto = (typeof location !== 'undefined' && location.protocol === 'https:') ? 'wss:' : 'ws:';
      const host = (typeof location !== 'undefined' && location.host) || 'localhost:3000';
      url = `${proto}//${host}`;
    }
    // Cerrar una conexión anterior sin avisar a nadie
    this._dropSocket();
    this.url = url;
    this.lastKick = null;
    this._intentional = false;
    this._snaps.length = 0;
    this._havePong = false;
    this._minRtt = Infinity;

    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }
      this.ws = ws;
      let opened = false;
      let settled = false;
      const timer = setTimeout(() => {
        if (opened) return;
        settled = true;
        if (this.ws === ws) this.ws = null;
        try { ws.close(); } catch { /* nada */ }
        reject(new Error('Tiempo de espera agotado al conectar con el servidor'));
      }, CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        if (this.ws !== ws) return;
        opened = true;
        clearTimeout(timer);
        this.connected = true;
        this._emit('net:open', { url });
        this.ping();
        if (!settled) { settled = true; resolve(); }
      };
      ws.onmessage = (e) => {
        if (this.ws !== ws) return;
        this._onMessage(e.data);
      };
      ws.onerror = () => { /* siempre llega un 'close' después */ };
      ws.onclose = (e) => {
        clearTimeout(timer);
        if (this.ws !== ws) return;
        this.ws = null;
        const wasOpen = opened;
        this.connected = false;
        if (!wasOpen) {
          if (!settled) { settled = true; reject(new Error('No se pudo conectar con el servidor')); }
          return;
        }
        this._emit('net:close', {
          code: e.code, reason: e.reason || '', intentional: this._intentional, kicked: this.lastKick,
        });
      };
    });
  }

  // ¿Se pidió cerrar la conexión a propósito?
  get closing() { return this._intentional; }

  // Cierre voluntario (no muestra el aviso de desconexión)
  close() {
    this._intentional = true;
    const ws = this.ws;
    if (!ws) { this.connected = false; return; }
    try { ws.close(1000, 'bye'); } catch { /* nada */ }
  }

  _dropSocket() {
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try { ws.close(1000, 'reconnect'); } catch { /* nada */ }
    }
  }

  send(obj) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 /* OPEN */) return false;
    try {
      const s = JSON.stringify(obj);
      ws.send(s);
      this.stats.msgsOut++;
      this.stats.bytesOut += s.length;
      return true;
    } catch (err) {
      console.warn('[Net] No se pudo enviar el mensaje:', err);
      return false;
    }
  }

  ping() {
    return this.send({ t: 'ping', c: localNow() });
  }

  // ------------------------------------------------------------------ reloj
  serverNow() {
    if (!this._haveOffset) return Date.now();
    return localNow() + this._offset;
  }

  // Muestra de pong: la más precisa (compensa media latencia)
  _onPong(m) {
    const t = localNow();
    const c = Number(m.c), sNow = Number(m.now);
    if (!isFinite(c) || !isFinite(sNow)) return;
    const rtt = Math.max(0, t - c);
    this.rtt = this._havePong ? this.rtt + (rtt - this.rtt) * 0.25 : rtt;
    this._minRtt = Math.min(rtt, this._minRtt + 2);
    const sample = sNow + rtt / 2 - t;
    if (!this._havePong || !this._haveOffset) {
      this._offset = sample;
    } else {
      // Las muestras con mucha más latencia que la mínima reciente pesan menos
      const w = rtt > this._minRtt * 2 + 15 ? 0.04 : 0.2;
      this._offset += (sample - this._offset) * w;
    }
    this._havePong = true;
    this._haveOffset = true;
  }

  // Muestra de gs.now / snap.now: cota inferior del reloj del servidor en el momento de recibir
  _onServerStamp(serverSentAt) {
    const sNow = Number(serverSentAt);
    if (!isFinite(sNow)) return;
    const t = localNow();
    const lower = sNow - t;
    if (!this._haveOffset) {
      this._offset = lower + (this.rtt ? this.rtt / 2 : 0);
      this._haveOffset = true;
      return;
    }
    if (!this._havePong) {
      // Sin pong todavía: acercarse suavemente
      this._offset += (lower - this._offset) * 0.1;
    } else if (lower > this._offset) {
      // Nuestra estimación va por detrás de lo que el servidor ya envió: corregir hacia arriba
      this._offset += (lower - this._offset) * 0.1;
    }
  }

  // ------------------------------------------------------------------ mensajes
  _emit(name, payload) {
    const ev = this.ctx && this.ctx.events;
    if (ev && typeof ev.emit === 'function') ev.emit(name, payload);
  }

  _onMessage(data) {
    this.stats.msgsIn++;
    if (typeof data === 'string') this.stats.bytesIn += data.length;
    const m = safeParse(data);
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'snap': this._onSnap(m); break;
      case 'gs': this._onGs(m); break;
      case 'ev':
        if (typeof m.e === 'string' && m.e) this._emit('ev:' + m.e, m);
        break;
      case 'pong': this._onPong(m); break;
      case 'welcome': this._onWelcome(m); break;
      case 'kick':
        this.lastKick = m.reason || 'desconocido';
        this._emit('net:kick', { reason: this.lastKick });
        break;
      default:
        this._emit('net:' + m.t, m);
    }
  }

  _normalizeGs(gs) {
    if (!gs || typeof gs !== 'object') return null;
    if (!gs.players || typeof gs.players !== 'object') gs.players = {};
    if (!gs.doors || typeof gs.doors !== 'object') gs.doors = {};
    return gs;
  }

  _setGs(gs) {
    const ctx = this.ctx;
    if (!ctx) return;
    const prev = ctx.gs || null;
    ctx.gs = gs;
    this._emit('gs', { gs, prev });
    const pp = prev ? prev.phase : null;
    if (gs && gs.phase !== pp) {
      if (gs.phase !== 'playing') this._snaps.length = 0;   // zombis viejos fuera
      this._emit('phase', { phase: gs.phase, prev: pp });
    }
  }

  _onWelcome(m) {
    const ctx = this.ctx;
    const gs = this._normalizeGs(m.gs);
    if (gs && gs.now) this._onServerStamp(gs.now);
    if (ctx) {
      ctx.selfId = m.id;
      ctx.dev = !!m.dev;
      ctx.lan = Array.isArray(m.lan) ? m.lan : [];
    }
    this._emit('welcome', { id: m.id, host: !!m.host, gs, lan: Array.isArray(m.lan) ? m.lan : [], dev: !!m.dev });
    if (gs) this._setGs(gs);
  }

  _onGs(m) {
    const gs = this._normalizeGs(m);
    if (!gs) return;
    if (gs.now) this._onServerStamp(gs.now);
    this._setGs(gs);
  }

  _onSnap(m) {
    const now = Number(m.now);
    if (!isFinite(now)) return;
    this._onServerStamp(now);
    const z = new Map();
    if (Array.isArray(m.z)) {
      for (const a of m.z) {
        if (!Array.isArray(a)) continue;
        z.set(a[0], {
          x: +a[1] || 0, z: +a[2] || 0, rot: +a[3] || 0,
          anim: a[4] | 0, flags: a[5] | 0, yOff: +a[6] || 0,
        });
      }
    }
    const p = new Map();
    if (Array.isArray(m.p)) {
      for (const a of m.p) {
        if (!Array.isArray(a)) continue;
        p.set(a[0], {
          x: +a[1] || 0, y: +a[2] || 0, z: +a[3] || 0, yaw: +a[4] || 0, pitch: +a[5] || 0,
          flags: a[6] | 0, w: a[7] || '', up: !!a[8],
        });
      }
    }
    const snap = { now, z, p };
    const s = this._snaps;
    // Insertar ordenado (normalmente al final)
    let i = s.length;
    while (i > 0 && s[i - 1].now > now) i--;
    if (i > 0 && s[i - 1].now === now) s[i - 1] = snap;
    else s.splice(i, 0, snap);
    // Recortar el historial
    const newest = s[s.length - 1].now;
    let cut = 0;
    while (cut < s.length - 2 && s[cut + 1].now < newest - BUFFER_KEEP_MS) cut++;
    if (cut > 0) s.splice(0, cut);
  }

  clearSnapshots() { this._snaps.length = 0; }

  // Último snapshot recibido (sin interpolar) o null
  get lastSnapshot() {
    return this._snaps.length ? this._snaps[this._snaps.length - 1] : null;
  }

  // ------------------------------------------------------------------ interpolación
  // Devuelve { zombies: Map<id,{x,z,rot,anim,flags,yOff}>, players: Map<id,{x,y,z,yaw,pitch,flags,w,up}> }
  sample(renderTime) {
    const out = { zombies: new Map(), players: new Map() };
    const s = this._snaps;
    if (!s.length) return out;
    if (renderTime === undefined || renderTime === null || !isFinite(renderTime)) {
      renderTime = this.serverNow() - INTERP_DELAY_MS;
    }

    // Antes del snapshot más viejo (o solo hay uno): usar el más viejo tal cual
    if (s.length === 1 || renderTime <= s[0].now) {
      const a = s[0];
      for (const [id, v] of a.z) out.zombies.set(id, { ...v });
      for (const [id, v] of a.p) out.players.set(id, { ...v });
      return out;
    }

    const last = s[s.length - 1];
    if (renderTime >= last.now) {
      // Extrapolar desde los dos últimos, como máximo MAX_EXTRAP_MS
      const prev = s[s.length - 2];
      const span = last.now - prev.now;
      const ex = Math.min(renderTime - last.now, MAX_EXTRAP_MS);
      const k = span > 0 ? ex / span : 0;
      for (const [id, b] of last.z) {
        const a = prev.z.get(id);
        if (!a || k <= 0 || this._far(a, b)) { out.zombies.set(id, { ...b }); continue; }
        out.zombies.set(id, {
          x: b.x + (b.x - a.x) * k, z: b.z + (b.z - a.z) * k,
          rot: b.rot + angleDiff(a.rot, b.rot) * k,
          anim: b.anim, flags: b.flags, yOff: b.yOff,
        });
      }
      for (const [id, b] of last.p) {
        const a = prev.p.get(id);
        if (!a || k <= 0 || this._far(a, b)) { out.players.set(id, { ...b }); continue; }
        out.players.set(id, {
          x: b.x + (b.x - a.x) * k, y: Math.max(0, b.y + (b.y - a.y) * k), z: b.z + (b.z - a.z) * k,
          yaw: b.yaw + angleDiff(a.yaw, b.yaw) * k,
          pitch: b.pitch,
          flags: b.flags, w: b.w, up: b.up,
        });
      }
      return out;
    }

    // Buscar los dos snapshots que rodean renderTime
    let i = s.length - 2;
    while (i > 0 && s[i].now > renderTime) i--;
    const A = s[i], B = s[i + 1];
    const span = B.now - A.now;
    const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - A.now) / span)) : 1;
    const late = t >= 0.5;

    // El conjunto de entidades es el del snapshot más nuevo
    for (const [id, b] of B.z) {
      const a = A.z.get(id);
      if (!a || this._far(a, b)) { out.zombies.set(id, { ...b }); continue; }
      const d = late ? b : a;
      out.zombies.set(id, {
        x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
        rot: lerpAngle(a.rot, b.rot, t),
        anim: d.anim, flags: d.flags, yOff: a.yOff + (b.yOff - a.yOff) * t,
      });
    }
    for (const [id, b] of B.p) {
      const a = A.p.get(id);
      if (!a || this._far(a, b)) { out.players.set(id, { ...b }); continue; }
      const d = late ? b : a;
      out.players.set(id, {
        x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
        yaw: lerpAngle(a.yaw, b.yaw, t), pitch: lerpAngle(a.pitch, b.pitch, t),
        flags: d.flags, w: d.w, up: d.up,
      });
    }
    return out;
  }

  _far(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    return dx * dx + dz * dz > TELEPORT_DIST2;
  }
}

export default Net;
