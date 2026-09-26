// Módulos de respaldo del núcleo: si un módulo de otro responsable no carga o falla al construirse,
// main.js usa estos objetos para que el juego siga funcionando (con menos funciones).
// - makeStub(key): objeto con la API pública del módulo que no hace nada.
// - FallbackMenus: menús mínimos (título, sala, pausa, ajustes, fin de partida).
// - FallbackHUD: HUD mínimo (aviso de interacción, barra de progreso, mensajes y estado básico).

import { PLAYER_COLORS, clamp } from '/shared/constants.js';
import { MAP_NAME } from '/shared/map.js';
import { tr } from './i18n.js';

const noop = () => {};
const soundHandle = () => ({ stop() {} });

export function makeStub(key) {
  switch (key) {
    case 'audio':
      return { __stub: true, unlock: noop, update: noop, play: soundHandle, weapon: soundHandle, music: noop, announce: noop, setVolumes: noop };
    case 'effects':
      return {
        __stub: true, update: noop, blood: noop, gib: noop, spark: noop, dust: noop, decal: noop,
        explosion: noop, tracer: noop, muzzleLight: noop, flash: noop, fire: noop,
      };
    case 'world':
      return { __stub: true, build: noop, update: noop };
    case 'entities':
      return {
        __stub: true, update: noop, reset: noop, hitReact: noop,
        getZombieTargets: () => [], getZombie: () => null, getPlayerVisual: () => null,
      };
    case 'weapons':
      return {
        __stub: true, update: noop, reset: noop, vmScene: null, vmCamera: null, current: null,
        adsAmount: 0, isReloading: false, isShieldOut: false, isDrinking: false,
        hudInfo: () => ({ name: '', key: '', up: false, mag: 0, reserve: 0, grenades: 0, shieldHp: 0, shieldOut: false, lowAmmo: false, noAmmo: false, melee: 'knife' }),
        spreadDeg: () => 2,
      };
    case 'hud':
      return { __stub: true, update: noop, setPrompt: noop, setProgress: noop, hitmarker: noop, damage: noop, message: noop, setScope: noop, showScoreboard: noop };
    case 'menus':
      return { __stub: true, showMain: noop, showLobby: noop, showGameOver: noop, togglePause: noop, showSettings: noop, hideAll: noop, isOpen: false };
    default:
      return { __stub: true, update: noop };
  }
}

// ---------------------------------------------------------------------------------------------
// Utilidades DOM
function el(tag, style, text) {
  const e = document.createElement(tag);
  if (style) e.style.cssText = style;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

const BTN = 'display:inline-block;margin:6px;padding:10px 22px;font:600 16px "Segoe UI",Tahoma,sans-serif;color:#fff;' +
  'background:#7a0d0d;border:1px solid #c33;border-radius:3px;cursor:pointer;letter-spacing:1px;text-transform:uppercase;';
const PANEL = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:340px;max-width:92vw;max-height:90vh;overflow:auto;' +
  'padding:26px 30px;background:rgba(8,8,10,0.88);border:1px solid #5a1010;box-shadow:0 0 40px rgba(160,0,0,0.35);' +
  'color:#ddd;font:15px "Segoe UI",Tahoma,sans-serif;text-align:center;pointer-events:auto;';
const TITLE = 'margin:0 0 6px;font:bold 64px Impact,"Arial Black",sans-serif;letter-spacing:6px;color:#b30f0f;text-shadow:0 0 18px #600;';

function button(label, onClick) {
  const b = el('button', BTN, label);
  b.type = 'button';
  b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
  return b;
}

// ---------------------------------------------------------------------------------------------
export class FallbackMenus {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = document.getElementById('menus') || document.body;
    this.root.innerHTML = '';
    this.el = el('div', 'position:fixed;inset:0;z-index:40;display:none;background:rgba(0,0,0,0.35);');
    this.root.appendChild(this.el);
    this.mode = null;
    this._ready = false;
    const ev = ctx && ctx.events;
    if (ev && ev.on) {
      ev.on('gs', () => { if (this.mode === 'lobby') this._renderLobby(); });
    }
    this._lobbySig = '';
  }

  // Firma de lo que muestra la sala: solo se vuelve a dibujar si cambia (los botones no "parpadean")
  _lobbySignature() {
    const gs = this.ctx.gs;
    const players = gs && gs.players ? Object.values(gs.players) : [];
    return JSON.stringify([players.map((p) => [p.id, p.name, p.color, p.ready, p.host]), this.ctx.selfId, this.ctx.lan]);
  }

  get isOpen() { return this.mode !== null; }

  _open(mode) {
    this.mode = mode;
    this.el.innerHTML = '';
    this.el.style.display = 'block';
    const p = el('div', PANEL);
    this.el.appendChild(p);
    return p;
  }

  hideAll() {
    this.mode = null;
    this.el.innerHTML = '';
    this.el.style.display = 'none';
  }

  showMain(onJoin) {
    const s = this.ctx.settings || {};
    const p = this._open('main');
    p.appendChild(el('h1', TITLE, 'ZOMBIES'));
    p.appendChild(el('div', 'margin-bottom:18px;color:#aaa;letter-spacing:2px;', tr('Mapa: {0}', MAP_NAME)));
    p.appendChild(el('div', 'margin:6px 0 4px;color:#bbb;', tr('Tu nombre')));
    const name = el('input', 'width:220px;padding:8px;font-size:16px;background:#111;color:#fff;border:1px solid #444;text-align:center;');
    name.maxLength = 16;
    name.value = s.name || '';
    p.appendChild(name);
    p.appendChild(el('div', 'margin:14px 0 6px;color:#bbb;', tr('Color')));
    let color = PLAYER_COLORS.includes(s.color) ? s.color : PLAYER_COLORS[0];
    const row = el('div');
    const swatches = PLAYER_COLORS.map((c) => {
      const sw = el('button', `width:34px;height:34px;margin:0 5px;border-radius:50%;cursor:pointer;background:${c};border:3px solid transparent;`);
      sw.type = 'button';
      sw.addEventListener('click', () => { color = c; paint(); });
      row.appendChild(sw);
      return sw;
    });
    const paint = () => swatches.forEach((sw, i) => { sw.style.borderColor = PLAYER_COLORS[i] === color ? '#fff' : 'transparent'; });
    paint();
    p.appendChild(row);
    const go = () => {
      const n = (name.value || '').trim().slice(0, 16) || tr('Jugador');
      if (typeof onJoin === 'function') onJoin(n, color);
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const b = el('div', 'margin-top:20px;');
    b.appendChild(button(tr('Unirse'), go));
    b.appendChild(button(tr('Ajustes'), () => this.showSettings(() => this.showMain(onJoin))));
    p.appendChild(b);
    p.appendChild(el('div', 'margin-top:16px;font-size:12px;color:#888;line-height:1.6;',
      tr('WASD mover · Ratón mirar · Clic izq. disparar · Clic der. apuntar · Shift correr · C/Ctrl agacharse · Espacio saltar · ') +
      tr('R recargar · F usar/comprar · V cuchillo · G granada · Q escudo · 1/2/3 o rueda cambiar de arma · Tab puntuaciones · T/Enter chat · Esc pausa')));
  }

  showLobby() {
    this._ready = false;
    this.mode = 'lobby';
    this._lobbySig = '';
    this._renderLobby();
  }

  _renderLobby() {
    const ctx = this.ctx;
    const gs = ctx.gs;
    const sig = this._lobbySignature();
    if (sig === this._lobbySig && this.el.childElementCount) return;
    this._lobbySig = sig;
    const p = this._open('lobby');
    p.appendChild(el('h1', TITLE.replace('64px', '40px'), tr('SALA DE ESPERA')));
    p.appendChild(el('div', 'margin-bottom:12px;color:#aaa;', tr('Mapa: {0}', MAP_NAME)));
    const list = el('div', 'text-align:left;margin:10px auto;max-width:320px;');
    const players = gs && gs.players ? Object.values(gs.players) : [];
    for (const pl of players) {
      const row = el('div', 'display:flex;justify-content:space-between;padding:6px 8px;border-bottom:1px solid #222;');
      row.appendChild(el('span', `color:${pl.color || '#fff'};font-weight:600;`, `${pl.name || tr('Jugador')}${pl.host ? ` (${tr('anfitrión')})` : ''}`));
      row.appendChild(el('span', `color:${pl.ready ? '#6f6' : '#999'};`, pl.ready ? tr('LISTO') : tr('esperando')));
      list.appendChild(row);
    }
    p.appendChild(list);
    const self = ctx.self;
    if (self) this._ready = !!self.ready;
    const btns = el('div', 'margin-top:12px;');
    btns.appendChild(button(this._ready ? tr('No listo') : tr('Listo'), () => {
      this._ready = !this._ready;
      if (ctx.net) ctx.net.send({ t: 'ready', v: this._ready });
    }));
    if (self && self.host) btns.appendChild(button(tr('Iniciar partida'), () => { if (ctx.net) ctx.net.send({ t: 'start' }); }));
    p.appendChild(btns);
    if (Array.isArray(ctx.lan) && ctx.lan.length) {
      p.appendChild(el('div', 'margin-top:16px;color:#bbb;', tr('Comparte esta dirección con tus amigos:')));
      for (const u of ctx.lan) p.appendChild(el('div', 'font:600 16px Consolas,monospace;color:#fc6;margin-top:4px;', u));
    }
    if (!(self && self.host)) p.appendChild(el('div', 'margin-top:12px;font-size:13px;color:#888;', tr('El anfitrión iniciará la partida.')));
  }

  showGameOver(data) {
    const p = this._open('gameover');
    const round = data && data.round ? data.round : (this.ctx.gs && this.ctx.gs.round) || 0;
    p.appendChild(el('h1', TITLE.replace('64px', '44px'), tr('FIN DE LA PARTIDA')));
    p.appendChild(el('div', 'font-size:20px;margin-bottom:14px;', (round === 1 ? tr('Sobreviviste {0} ronda', round) : tr('Sobreviviste {0} rondas', round))));
    const stats = data && Array.isArray(data.stats) ? data.stats : [];
    const t = el('table', 'margin:0 auto;border-collapse:collapse;font-size:14px;');
    const head = el('tr');
    for (const h of [tr('Jugador'), tr('Puntos'), tr('Bajas'), tr('Cabezas'), tr('Caídas'), tr('Reanim.')]) head.appendChild(el('th', 'padding:4px 10px;color:#c33;', h));
    t.appendChild(head);
    for (const s of stats) {
      const r = el('tr');
      r.appendChild(el('td', `padding:4px 10px;color:${s.color || '#fff'};font-weight:600;`, s.name || ''));
      for (const k of ['points', 'kills', 'headshots', 'downs', 'revives']) r.appendChild(el('td', 'padding:4px 10px;', String(s[k] ?? 0)));
      t.appendChild(r);
    }
    p.appendChild(t);
    p.appendChild(el('div', 'margin-top:14px;color:#888;font-size:13px;', tr('Volviendo a la sala en unos segundos…')));
  }

  togglePause() {
    if (this.mode === 'pause' || this.mode === 'settings') {
      this.hideAll();
      if (this.ctx.input && this.ctx.input.requestLock) this.ctx.input.requestLock();
      return;
    }
    const gs = this.ctx.gs;
    if (!gs || gs.phase !== 'playing') return;
    if (this.ctx.input && this.ctx.input.exitLock) this.ctx.input.exitLock();
    const p = this._open('pause');
    p.appendChild(el('h1', TITLE.replace('64px', '44px'), tr('PAUSA')));
    p.appendChild(el('div', 'color:#999;margin-bottom:12px;font-size:13px;', tr('La partida sigue en marcha para los demás.')));
    const col = el('div', 'display:flex;flex-direction:column;align-items:center;');
    col.appendChild(button(tr('Continuar'), () => this.togglePause()));
    col.appendChild(button(tr('Ajustes'), () => this.showSettings(() => { this.mode = null; this.togglePause(); })));
    col.appendChild(button(tr('Salir al lobby'), () => {
      try { if (this.ctx.net) this.ctx.net.close(); } catch { /* nada */ }
      location.reload();
    }));
    p.appendChild(col);
  }

  showSettings(onBack) {
    const ctx = this.ctx;
    const s = ctx.settings;
    const p = this._open('settings');
    p.appendChild(el('h1', TITLE.replace('64px', '40px'), tr('AJUSTES')));
    const grid = el('div', 'display:grid;grid-template-columns:auto 200px 50px;gap:10px 12px;align-items:center;text-align:left;margin:10px auto;');
    const emit = () => {
      if (ctx.saveSettings) ctx.saveSettings();
      if (ctx.events) ctx.events.emit('settings', s);
    };
    const slider = (label, key, min, max, step, fmt) => {
      grid.appendChild(el('label', '', label));
      const r = el('input', 'width:200px;');
      r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = s[key];
      const v = el('span', 'color:#fc6;', fmt(s[key]));
      r.addEventListener('input', () => { s[key] = clamp(parseFloat(r.value), min, max); v.textContent = fmt(s[key]); emit(); });
      grid.appendChild(r); grid.appendChild(v);
    };
    slider(tr('Sensibilidad'), 'sensitivity', 0.1, 4, 0.05, (x) => Number(x).toFixed(2));
    slider(tr('Campo de visión'), 'fov', 60, 110, 1, (x) => String(Math.round(x)));
    slider(tr('Volumen'), 'volume', 0, 1, 0.05, (x) => `${Math.round(x * 100)}%`);
    slider(tr('Música'), 'music', 0, 1, 0.05, (x) => `${Math.round(x * 100)}%`);
    grid.appendChild(el('label', '', tr('Calidad')));
    const q = el('select', 'background:#111;color:#fff;border:1px solid #444;padding:4px;');
    for (const [val, txt] of [['high', tr('Alta')], ['low', tr('Baja')]]) { const o = el('option', '', txt); o.value = val; q.appendChild(o); }
    q.value = s.quality === 'low' ? 'low' : 'high';
    q.addEventListener('change', () => { s.quality = q.value; emit(); });
    grid.appendChild(q); grid.appendChild(el('span'));
    grid.appendChild(el('label', '', tr('Invertir eje Y')));
    const inv = el('input');
    inv.type = 'checkbox'; inv.checked = !!s.invertY;
    inv.addEventListener('change', () => { s.invertY = inv.checked; emit(); });
    grid.appendChild(inv); grid.appendChild(el('span'));
    p.appendChild(grid);
    p.appendChild(button(tr('Volver'), () => {
      if (typeof onBack === 'function') onBack();
      else this.hideAll();
    }));
  }
}

// ---------------------------------------------------------------------------------------------
export class FallbackHUD {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = document.getElementById('hud') || document.body;
    this.el = el('div', 'position:fixed;inset:0;pointer-events:none;z-index:15;font:15px "Segoe UI",Tahoma,sans-serif;color:#eee;text-shadow:0 1px 3px #000;');
    this.root.appendChild(this.el);
    this.prompt = el('div', 'position:absolute;left:50%;top:62%;transform:translateX(-50%);font-size:18px;display:none;');
    this.bar = el('div', 'position:absolute;left:50%;top:67%;width:220px;height:8px;margin-left:-110px;background:rgba(0,0,0,0.6);border:1px solid #777;display:none;');
    this.fill = el('div', 'height:100%;width:0;background:#e9e9e9;');
    this.bar.appendChild(this.fill);
    this.msg = el('div', 'position:absolute;left:50%;top:32%;transform:translateX(-50%);font-size:22px;display:none;');
    this.status = el('div', 'position:absolute;left:20px;bottom:18px;font-size:16px;white-space:pre;');
    this.ammo = el('div', 'position:absolute;right:24px;bottom:18px;font-size:18px;text-align:right;white-space:pre;');
    this.cross = el('div', 'position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;background:#fff;border-radius:2px;opacity:0.8;');
    for (const e of [this.prompt, this.bar, this.msg, this.status, this.ammo, this.cross]) this.el.appendChild(e);
    this._msgT = 0;
    const ev = ctx && ctx.events;
    if (ev && ev.on) {
      ev.on('ev:msg', (e) => e && e.text && this.message(e.text));
      ev.on('ev:roundStart', (e) => e && this.message(tr('Ronda {0}', e.round), 3));
      ev.on('ev:deny', () => this.message(tr('No puedes hacer eso ahora'), 1.5));
    }
  }

  update(dt) {
    const gs = this.ctx.gs;
    const playing = !!(gs && gs.phase === 'playing');
    this.el.style.display = playing ? 'block' : 'none';
    if (this._msgT > 0) { this._msgT -= dt; if (this._msgT <= 0) this.msg.style.display = 'none'; }
    if (!playing) return;
    const self = this.ctx.self;
    if (self) {
      this.status.textContent = tr('RONDA {0}\n{1} puntos\nSalud {2}/{3}', gs.round || 0, self.points || 0, Math.round(self.hp || 0), self.maxHp || 100);
      this.status.style.color = self.color || '#fff';
    }
    const w = this.ctx.weapons;
    let info = null;
    try { info = w && typeof w.hudInfo === 'function' ? w.hudInfo() : null; } catch { info = null; }
    this.ammo.textContent = info && info.name ? tr('{0}\n{1} / {2}\nGranadas: {3}', info.name, info.mag, info.reserve, info.grenades) : '';
  }

  setPrompt(text) {
    this.prompt.textContent = text || '';
    this.prompt.style.display = text ? 'block' : 'none';
  }

  setProgress(v) {
    if (v === null || v === undefined) { this.bar.style.display = 'none'; return; }
    this.bar.style.display = 'block';
    this.fill.style.width = `${Math.round(clamp(v, 0, 1) * 100)}%`;
  }

  message(text, seconds = 2.5) {
    this.msg.textContent = text || '';
    this.msg.style.display = text ? 'block' : 'none';
    this._msgT = seconds;
  }

  hitmarker() {}
  damage() {}
  setScope() {}
  showScoreboard() {}
}

export default FallbackMenus;
