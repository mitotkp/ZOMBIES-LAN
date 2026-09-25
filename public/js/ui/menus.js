// Menús de ZOMBIES LAN (DOM, contenedor #menus): título, sala de espera, pausa, ajustes, controles y fin de partida.
// El núcleo (main.js) decide cuándo se muestra cada pantalla; aquí solo se dibujan y se envían acciones al servidor.

import { PLAYER_COLORS, MAX_PLAYERS, clamp } from '/shared/constants.js';
import { MAP_NAME } from '/shared/map.js';
import { esc, safeColor, mulberry32, sfx, ensureChalkDefs, isDebugUrl } from './uiutil.js';
import { COLOR_NAMES, CONTROL_GROUPS, CONTROLS_SHORT, TIPS, DEFAULT_SETTINGS } from './menudata.js';

const SETTINGS_KEY = 'zlan.settings';
const GAMEOVER_SECONDS = 15;          // el servidor vuelve a la sala 15 s después del fin
const ESC_GUARD_MS = 450;             // el Esc que abrió la pausa no debe cerrarla
const CHAT_HISTORY = 60;

// ---------------------------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------------------------

// Título "ZOMBIES" con trazo de tiza y gotas de sangre que cuelgan
function titleSVG() {
  const r = mulberry32(90210);
  const letterW = 860 / 7;
  let drips = '';
  for (let i = 0; i < 7; i++) {
    const n = 1 + (r() < 0.6 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const x = 20 + letterW * (i + 0.5) + (r() * 2 - 1) * letterW * 0.28;
      const w = 8 + r() * 10;
      const len = 18 + r() * 58;
      const y = 176;
      // Gota: ancha arriba, cuello estrecho y bulbo redondo al final
      const f = (v) => v.toFixed(1);
      const nk = w * 0.3, rb = w * 0.42;
      const d = `M${f(x - w / 2)} ${y} Q${f(x - nk)} ${f(y + len * 0.55)} ${f(x - nk)} ${f(y + len)} ` +
        `A${f(rb)} ${f(rb)} 0 1 0 ${f(x + nk)} ${f(y + len)} Q${f(x + nk)} ${f(y + len * 0.55)} ${f(x + w / 2)} ${y} Z`;
      drips += `<path class="drip" style="--dd:${(r() * 5).toFixed(2)}s;--dl:${(6 + r() * 6).toFixed(2)}s" d="${d}"/>`;
    }
  }
  return `<svg class="mn-title-svg" viewBox="0 0 900 270" role="img" aria-label="ZOMBIES">
    <defs>
      <linearGradient id="zlTitleGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ef2f22"/><stop offset="0.55" stop-color="#a80f0b"/><stop offset="1" stop-color="#560403"/>
      </linearGradient>
    </defs>
    <g class="mn-title-glow" fill="#ff1a0a" opacity="0.35">
      <text x="450" y="192" text-anchor="middle" font-size="212" textLength="860" lengthAdjust="spacingAndGlyphs"
        font-family="Impact, Haettenschweiler, 'Arial Narrow Bold', 'Bahnschrift', sans-serif">ZOMBIES</text>
    </g>
    <g filter="url(#zl-chalk-heavy)" fill="url(#zlTitleGrad)">
      <text x="450" y="192" text-anchor="middle" font-size="212" textLength="860" lengthAdjust="spacingAndGlyphs"
        font-family="Impact, Haettenschweiler, 'Arial Narrow Bold', 'Bahnschrift', sans-serif">ZOMBIES</text>
      ${drips}
    </g>
  </svg>`;
}

function keysHTML(keys) {
  return keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('<span class="kb-sep">/</span>');
}

function controlsShortHTML() {
  return CONTROLS_SHORT.map(([keys, label]) => `<div class="ct-row"><span class="ct-keys">${keysHTML(keys)}</span><span class="ct-label">${esc(label)}</span></div>`).join('');
}

function controlsFullHTML() {
  return CONTROL_GROUPS.map((g) => `
    <div class="ct-group">
      <h3 class="ct-title">${esc(g.title)}</h3>
      ${g.rows.map(([keys, label]) => `<div class="ct-row"><span class="ct-keys">${keysHTML(keys)}</span><span class="ct-label">${esc(label)}</span></div>`).join('')}
    </div>`).join('');
}

const TEMPLATE = `
<div class="mn-root">
  <div class="mn-bg"></div>

  <section class="mn-screen mn-main" data-screen="main" aria-label="Pantalla de título">
    <div class="mn-main-grid">
      <div class="mn-main-left">
        <div class="mn-title">${titleSVG()}<div class="mn-sub">LAN <span class="mn-dash">—</span> ${esc(MAP_NAME)}</div></div>
        <div class="mn-card mn-join">
          <label class="mn-label" for="zl-name">Tu nombre</label>
          <input id="zl-name" class="mn-input mn-name" type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Superviviente">
          <div class="mn-label">Tu color</div>
          <div class="mn-swatches" role="radiogroup" aria-label="Color del jugador"></div>
          <div class="mn-actions">
            <button type="button" class="mn-btn primary mn-join-btn">Unirse a la partida</button>
          </div>
          <div class="mn-actions mn-actions-row">
            <button type="button" class="mn-btn small mn-open-settings">Ajustes</button>
            <button type="button" class="mn-btn small mn-open-controls">Controles</button>
          </div>
          <div class="mn-join-status"></div>
        </div>
      </div>
      <aside class="mn-card mn-main-controls">
        <h3 class="mn-card-title">Controles</h3>
        <div class="ct-list">${controlsShortHTML()}</div>
        <div class="mn-hint">Mantén <kbd>F</kbd> para reconstruir barricadas, construir el escudo y reanimar.</div>
      </aside>
    </div>
    <div class="mn-foot"><span class="mn-server"></span><span class="mn-foot-sep">·</span><span>1 a ${MAX_PLAYERS} jugadores en red local</span></div>
  </section>

  <section class="mn-screen mn-lobby" data-screen="lobby" aria-label="Sala de espera">
    <header class="mn-head">
      <h2 class="mn-h2">Sala de espera</h2>
      <div class="mn-head-sub">${esc(MAP_NAME)} <span class="mn-dev-tag">DEV</span></div>
    </header>
    <div class="mn-lobby-grid">
      <div class="mn-card lb-players">
        <h3 class="mn-card-title">Jugadores <span class="lb-count"></span></h3>
        <div class="lb-slots"></div>
        <div class="lb-status"></div>
        <div class="lb-actions">
          <button type="button" class="mn-btn lb-ready">Listo</button>
          <button type="button" class="mn-btn primary lb-start">Iniciar partida</button>
        </div>
        <div class="lb-wait">El anfitrión iniciará la partida cuando todos estén listos.</div>
        <div class="lb-actions lb-actions-row">
          <button type="button" class="mn-btn small mn-open-settings">Ajustes</button>
          <button type="button" class="mn-btn small mn-open-controls">Controles</button>
          <button type="button" class="mn-btn small ghost lb-leave">Salir</button>
        </div>
      </div>
      <div class="mn-lobby-right">
        <div class="mn-card lb-lan">
          <h3 class="mn-card-title">Invita a tus amigos</h3>
          <div class="lb-lan-text">Comparte esta dirección con tus amigos (misma red):</div>
          <div class="lb-urls"></div>
        </div>
        <div class="mn-card lb-chat">
          <h3 class="mn-card-title">Chat</h3>
          <div class="lb-feed" aria-live="polite"></div>
          <form class="lb-entry" autocomplete="off">
            <input class="mn-input lb-input" type="text" maxlength="120" spellcheck="false" placeholder="Escribe un mensaje y pulsa Enter">
            <button type="submit" class="mn-btn small">Enviar</button>
          </form>
        </div>
      </div>
    </div>
    <div class="lb-tip"><span class="lb-tip-label">Consejo</span><span class="lb-tip-text"></span></div>
  </section>

  <section class="mn-screen mn-pause" data-screen="pause" aria-label="Pausa">
    <div class="mn-pause-box">
      <h2 class="mn-h2 mn-pause-title">Pausa</h2>
      <div class="mn-pause-info"></div>
      <div class="mn-menu">
        <button type="button" class="mn-btn primary ps-continue">Continuar</button>
        <button type="button" class="mn-btn mn-open-settings">Ajustes</button>
        <button type="button" class="mn-btn mn-open-controls">Controles</button>
        <button type="button" class="mn-btn danger ps-exit">Salir de la partida</button>
      </div>
      <div class="mn-pause-note">La partida sigue en marcha: los zombis no esperan.</div>
    </div>
  </section>

  <section class="mn-screen mn-settings" data-screen="settings" aria-label="Ajustes">
    <div class="mn-panel-box">
      <h2 class="mn-h2">Ajustes</h2>
      <div class="st-list">
        <div class="st-row"><label class="st-label" for="zl-st-sens">Sensibilidad del ratón</label>
          <input id="zl-st-sens" class="st-range" data-key="sensitivity" type="range" min="0.1" max="4" step="0.05"><span class="st-val" data-val="sensitivity"></span></div>
        <div class="st-row"><label class="st-label" for="zl-st-fov">Campo de visión</label>
          <input id="zl-st-fov" class="st-range" data-key="fov" type="range" min="60" max="100" step="1"><span class="st-val" data-val="fov"></span></div>
        <div class="st-row"><label class="st-label" for="zl-st-bri">Brillo</label>
          <input id="zl-st-bri" class="st-range" data-key="brightness" type="range" min="0.5" max="2" step="0.05"><span class="st-val" data-val="brightness"></span></div>
        <div class="st-row"><label class="st-label" for="zl-st-vol">Volumen general</label>
          <input id="zl-st-vol" class="st-range" data-key="volume" type="range" min="0" max="1" step="0.01"><span class="st-val" data-val="volume"></span></div>
        <div class="st-row"><label class="st-label" for="zl-st-mus">Volumen de la música</label>
          <input id="zl-st-mus" class="st-range" data-key="music" type="range" min="0" max="1" step="0.01"><span class="st-val" data-val="music"></span></div>
        <div class="st-row"><span class="st-label">Calidad gráfica</span>
          <div class="st-seg" role="radiogroup" aria-label="Calidad gráfica">
            <button type="button" class="st-seg-btn" data-quality="high">Alta</button>
            <button type="button" class="st-seg-btn" data-quality="low">Baja</button>
          </div><span class="st-val"></span></div>
        <div class="st-row"><label class="st-label" for="zl-st-inv">Invertir eje Y</label>
          <label class="st-toggle"><input id="zl-st-inv" type="checkbox" data-key="invertY"><span class="st-knob"></span></label><span class="st-val" data-val="invertY"></span></div>
      </div>
      <div class="st-note">La calidad baja desactiva las sombras y reduce la resolución interna. El suavizado de bordes cambia al recargar la página.</div>
      <div class="mn-actions mn-actions-row">
        <button type="button" class="mn-btn small ghost st-reset">Restablecer</button>
        <button type="button" class="mn-btn primary mn-back">Volver</button>
      </div>
    </div>
  </section>

  <section class="mn-screen mn-controls" data-screen="controls" aria-label="Controles">
    <div class="mn-panel-box wide">
      <h2 class="mn-h2">Controles</h2>
      <div class="ct-groups">${controlsFullHTML()}</div>
      <h3 class="ct-title ct-tips-title">Consejos para sobrevivir</h3>
      <ul class="ct-tips">${TIPS.slice(0, 8).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <div class="mn-actions mn-actions-row"><button type="button" class="mn-btn primary mn-back">Volver</button></div>
    </div>
  </section>

  <section class="mn-screen mn-gameover" data-screen="gameover" aria-label="Fin de la partida">
    <div class="go-box">
      <h2 class="go-title">Fin de la partida</h2>
      <div class="go-sub"></div>
      <table class="go-table">
        <thead><tr><th class="go-name">Jugador</th><th>Puntos</th><th>Bajas</th><th>A la cabeza</th><th>Caídas</th><th>Reanimaciones</th></tr></thead>
        <tbody></tbody>
        <tfoot></tfoot>
      </table>
      <div class="go-count"></div>
      <div class="mn-actions mn-actions-row"><button type="button" class="mn-btn small ghost go-leave">Salir</button></div>
    </div>
  </section>

  <div class="mn-confirm" role="dialog" aria-modal="true">
    <div class="mn-confirm-box">
      <div class="mn-confirm-title"></div>
      <div class="mn-confirm-text"></div>
      <div class="mn-actions mn-actions-row">
        <button type="button" class="mn-btn small ghost cf-no">Cancelar</button>
        <button type="button" class="mn-btn small danger cf-yes">Salir</button>
      </div>
    </div>
  </div>
</div>`;

// ---------------------------------------------------------------------------------------------
// Utilidades locales
// ---------------------------------------------------------------------------------------------

function isEditable(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const t = (el.getAttribute('type') || '').toLowerCase();
  return ['', 'text', 'search', 'email', 'number', 'password', 'url', 'tel'].includes(t);
}

function num(v, def, a, b) {
  const n = Number(v);
  return isFinite(n) ? clamp(n, a, b) : def;
}

function fmtSetting(key, v) {
  switch (key) {
    case 'sensitivity': return Number(v).toFixed(2);
    case 'fov': return `${Math.round(v)}°`;
    case 'volume':
    case 'music':
    case 'brightness': return `${Math.round(v * 100)}%`;
    case 'invertY': return v ? 'Sí' : 'No';
    default: return String(v);
  }
}

function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
  } catch { /* se usa el método antiguo */ }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch { return false; }
}

// ---------------------------------------------------------------------------------------------
// Clase Menus
// ---------------------------------------------------------------------------------------------

export class Menus {
  constructor(ctx) {
    this.ctx = ctx || {};
    ensureChalkDefs();
    let root = document.getElementById('menus');
    if (!root) { root = document.createElement('div'); root.id = 'menus'; document.body.appendChild(root); }
    this.container = root;
    root.innerHTML = TEMPLATE;
    this.root = root.querySelector('.mn-root');

    const q = (s) => this.root.querySelector(s);
    this.screens = {};
    for (const s of this.root.querySelectorAll('.mn-screen')) this.screens[s.dataset.screen] = s;
    this.el = {
      name: q('.mn-name'), swatches: q('.mn-swatches'), joinBtn: q('.mn-join-btn'), joinStatus: q('.mn-join-status'),
      server: q('.mn-server'),
      lbCount: q('.lb-count'), lbSlots: q('.lb-slots'), lbStatus: q('.lb-status'), lbReady: q('.lb-ready'), lbStart: q('.lb-start'),
      lbWait: q('.lb-wait'), lbUrls: q('.lb-urls'), lbFeed: q('.lb-feed'), lbEntry: q('.lb-entry'), lbInput: q('.lb-input'),
      lbTip: q('.lb-tip-text'), devTag: q('.mn-dev-tag'),
      pauseInfo: q('.mn-pause-info'),
      stRanges: Array.from(this.root.querySelectorAll('.st-range')), stVals: Array.from(this.root.querySelectorAll('[data-val]')),
      stSeg: Array.from(this.root.querySelectorAll('.st-seg-btn')), stInv: q('#zl-st-inv'),
      goSub: q('.go-sub'), goBody: q('.go-table tbody'), goFoot: q('.go-table tfoot'), goCount: q('.go-count'),
      confirm: q('.mn-confirm'), cfTitle: q('.mn-confirm-title'), cfText: q('.mn-confirm-text'), cfYes: q('.cf-yes'), cfNo: q('.cf-no'),
    };

    this.mode = null;                 // 'main' | 'lobby' | 'pause' | 'settings' | 'controls' | 'gameover' | null
    this.debug = isDebugUrl();
    this.onJoin = null;
    this.joining = false;
    this._joinTimer = 0;
    this._openedAt = 0;
    this._backMode = null;
    this._lobbySig = '';
    this._readyPending = null;
    this._startCooldown = 0;
    this._chat = [];
    this._tipIdx = Math.floor(Math.random() * TIPS.length);
    this._tipTimer = 0;
    this._goTimer = 0;
    this._goEndsAt = 0;
    this._goSig = '';
    this._emitTimer = 0;
    this._emitting = false;
    this._confirmYes = null;
    this._lastHover = 0;
    this.color = PLAYER_COLORS.includes((this.ctx.settings || {}).color) ? this.ctx.settings.color : PLAYER_COLORS[0];

    this._buildSwatches();
    this._bindUI();
    this._bindEvents();
    this._syncSettingsUI();
    if (this.el.server) this.el.server.textContent = `Servidor: ${location.host || 'local'}`;
  }

  // ================================================================== API pública
  get isOpen() { return this.mode !== null; }

  showMain(onJoin) {
    if (typeof onJoin === 'function') this.onJoin = onJoin;
    const s = this.ctx.settings || {};
    if (this.mode !== 'settings' && this.mode !== 'controls') {
      this.el.name.value = typeof s.name === 'string' ? s.name.slice(0, 16) : '';
      if (PLAYER_COLORS.includes(s.color)) this.color = s.color;
    }
    this._paintSwatches();
    this._setJoining(false);
    this._open('main');
    this._music('lobby');
    // Foco en el nombre (sin robarlo si el usuario ya está en otro campo)
    setTimeout(() => {
      if (this.mode === 'main' && !isEditable(document.activeElement)) {
        try { this.el.name.focus({ preventScroll: true }); } catch { /* nada */ }
      }
    }, 60);
  }

  showLobby() {
    this._setJoining(false);
    this._readyPending = null;
    this._lobbySig = '';
    this._open('lobby');
    this._renderLobby(true);
    this._renderChat();
    this._showTip();
  }

  showGameOver(data) {
    const d = data && typeof data === 'object' ? data : {};
    const gs = this.ctx.gs || {};
    const round = Math.max(0, (+d.round || +gs.round || 0) | 0);
    let stats = Array.isArray(d.stats) ? d.stats.slice() : [];
    if (!stats.length && gs.players) stats = Object.values(gs.players);
    const sig = JSON.stringify([round, stats.map((s) => [s.id, s.points, s.kills])]);
    // Llamarlo dos veces seguidas (cambio de fase + evento) no reinicia la cuenta atrás
    if (sig !== this._goSig || this.mode !== 'gameover' || !this._goEndsAt) {
      if (sig !== this._goSig || !this._goEndsAt || performance.now() > this._goEndsAt) this._goEndsAt = performance.now() + GAMEOVER_SECONDS * 1000;
      this._goSig = sig;
      this._renderGameOver(round, stats);
    }
    this._open('gameover');
    clearInterval(this._goTimer);
    this._goTimer = setInterval(() => this._tickGameOver(), 250);
    this._tickGameOver();
  }

  togglePause() {
    // Cerrar (desde la pausa o desde una subpantalla abierta desde la pausa)
    if (this.mode === 'pause' || ((this.mode === 'settings' || this.mode === 'controls') && this._backMode === 'pause')) {
      this._closeConfirm();
      this.hideAll();
      this._requestLock();
      return;
    }
    const gs = this.ctx.gs;
    if (!gs || gs.phase !== 'playing') return;
    if (this.mode) return;              // hay otra pantalla abierta (p. ej. fin de partida)
    this._openPause();
  }

  showSettings(onBack) {
    const from = this.mode === 'settings' ? this._backMode : this.mode;
    this._backMode = from;
    this._backFn = typeof onBack === 'function' ? onBack : null;
    this._syncSettingsUI();
    this._open('settings');
  }

  hideAll() {
    this._closeConfirm();
    const wasOpen = this.mode !== null;
    this.mode = null;
    this._backMode = null;
    this._backFn = null;
    for (const s of Object.values(this.screens)) s.classList.remove('on');
    this.root.classList.remove('is-open');
    this.root.removeAttribute('data-mode');
    clearInterval(this._goTimer);
    this._goTimer = 0;
    clearInterval(this._tipTimer);
    this._tipTimer = 0;
    const ae = document.activeElement;
    if (ae && this.root.contains(ae) && typeof ae.blur === 'function') ae.blur();
    if (this.ctx.input) this.ctx.input.enabled = true;
    // En partida la música del título/sala se apaga
    const gs = this.ctx.gs;
    if (wasOpen && gs && gs.phase === 'playing') {
      const a = this.ctx.audio;
      try { if (a && typeof a.stopMusic === 'function') a.stopMusic('lobby'); } catch { /* nada */ }
    }
  }

  // ================================================================== pantallas
  _open(mode) {
    const prev = this.mode;
    this.mode = mode;
    this._openedAt = performance.now();
    for (const [k, s] of Object.entries(this.screens)) s.classList.toggle('on', k === mode);
    this.root.classList.add('is-open');
    this.root.dataset.mode = mode;
    if (mode !== 'gameover') { clearInterval(this._goTimer); this._goTimer = 0; }
    if (mode !== 'lobby') { clearInterval(this._tipTimer); this._tipTimer = 0; }
    // Menú abierto: sin control del jugador, sin chat del HUD y con el ratón libre
    const ctx = this.ctx;
    if (ctx.input) ctx.input.enabled = false;
    try { if (ctx.hud && typeof ctx.hud.closeChat === 'function') ctx.hud.closeChat(); } catch { /* nada */ }
    try { if (ctx.input && typeof ctx.input.exitLock === 'function') ctx.input.exitLock(); } catch { /* nada */ }
    if (prev !== mode) {
      const scr = this.screens[mode];
      if (scr) scr.scrollTop = 0;
    }
  }

  _openPause() {
    this._backMode = null;
    this._renderPauseInfo();
    this._open('pause');
    try { this.root.querySelector('.ps-continue').focus({ preventScroll: true }); } catch { /* nada */ }
  }

  _goBack() {
    const fn = this._backFn;
    const to = this._backMode;
    this._backFn = null;
    this._backMode = null;
    if (fn) { try { fn(); return; } catch (e) { console.error('[Menus] Error al volver:', e); } }
    const gs = this.ctx.gs;
    const phase = gs ? gs.phase : null;
    if (to === 'main' || (!gs && to == null)) { this._open('main'); this._paintSwatches(); return; }
    if (to === 'lobby' && phase === 'lobby') { this.showLobby(); return; }
    if (to === 'pause' && phase === 'playing') { this._openPause(); return; }
    if (to === 'gameover' && phase === 'gameover') { this._open('gameover'); this._goTimer = setInterval(() => this._tickGameOver(), 250); return; }
    // Si la fase cambió mientras tanto, se muestra la pantalla que corresponde
    if (phase === 'lobby') this.showLobby();
    else if (phase === 'gameover') this.showGameOver(null);
    else if (phase === 'playing') { this.hideAll(); this._requestLock(); }
    else { this._open('main'); this._paintSwatches(); }
  }

  _requestLock() {
    const ctx = this.ctx;
    const gs = ctx.gs;
    if (this.debug || !gs || gs.phase !== 'playing' || !ctx.input) return;
    try {
      const r = ctx.input.requestLock();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch { /* el núcleo muestra "Haz clic para jugar" */ }
  }

  _music(name) {
    const a = this.ctx.audio;
    try { if (a && typeof a.music === 'function') a.music(name); } catch { /* sin audio */ }
  }

  _leave() {
    try { if (this.ctx.net && typeof this.ctx.net.close === 'function') this.ctx.net.close(); } catch { /* nada */ }
    setTimeout(() => location.reload(), 60);
  }

  // ------------------------------------------------------------------ título
  _buildSwatches() {
    this.el.swatches.innerHTML = PLAYER_COLORS.map((c, i) =>
      `<button type="button" class="mn-swatch" role="radio" data-color="${esc(c)}" style="--sw:${safeColor(c)}" aria-label="${esc(COLOR_NAMES[i] || c)}">` +
      `<i></i><span>${esc(COLOR_NAMES[i] || '')}</span></button>`).join('');
    this._paintSwatches();
  }

  _paintSwatches() {
    for (const b of this.el.swatches.querySelectorAll('.mn-swatch')) {
      const on = b.dataset.color === this.color;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    this.el.name.style.setProperty('--pc', safeColor(this.color));
  }

  _join() {
    if (this.joining) return;
    let name = (this.el.name.value || '').replace(/\s+/g, ' ').trim().slice(0, 16);
    if (!name) name = ((this.ctx.settings && this.ctx.settings.name) || '').trim().slice(0, 16) || `Jugador${Math.floor(10 + Math.random() * 90)}`;
    this.el.name.value = name;
    this._setJoining(true);
    try { if (this.ctx.audio && typeof this.ctx.audio.unlock === 'function') this.ctx.audio.unlock(); } catch { /* nada */ }
    if (typeof this.onJoin === 'function') {
      try { this.onJoin(name, this.color); } catch (e) { console.error('[Menus] Error al unirse:', e); this._setJoining(false); }
    } else {
      this._setJoining(false);
    }
  }

  _setJoining(on) {
    this.joining = !!on;
    clearTimeout(this._joinTimer);
    this.el.joinBtn.disabled = this.joining;
    this.el.joinBtn.textContent = this.joining ? 'Conectando…' : 'Unirse a la partida';
    this.el.joinStatus.textContent = this.joining ? `Conectando con ${location.host || 'el servidor'}…` : '';
    // Si no hay respuesta, se vuelve a habilitar el botón
    if (this.joining) this._joinTimer = setTimeout(() => this._setJoining(false), 9000);
  }

  // ------------------------------------------------------------------ sala de espera
  _lobbySignature() {
    const ctx = this.ctx;
    const gs = ctx.gs;
    const players = gs && gs.players ? Object.values(gs.players) : [];
    return JSON.stringify([
      players.map((p) => [p.id, p.name, p.color, !!p.ready, !!p.host]),
      ctx.selfId, Array.isArray(ctx.lan) ? ctx.lan : [], !!ctx.dev, this._readyPending,
    ]);
  }

  _renderLobby(force = false) {
    const sig = this._lobbySignature();
    if (!force && sig === this._lobbySig) return;
    this._lobbySig = sig;
    const ctx = this.ctx;
    const gs = ctx.gs;
    const players = gs && gs.players ? Object.values(gs.players).sort((a, b) => (+a.id) - (+b.id)) : [];
    const selfKey = ctx.selfId != null ? String(ctx.selfId) : null;
    let self = null;
    try { self = ctx.self; } catch { self = null; }

    // Jugadores (4 huecos)
    let html = '';
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = players[i];
      if (!p) {
        html += `<div class="lb-slot empty"><span class="lb-color"></span><span class="lb-name">Esperando jugador…</span><span class="lb-state"></span></div>`;
        continue;
      }
      const me = String(p.id) === selfKey;
      const col = safeColor(p.color);
      html += `<div class="lb-slot${me ? ' me' : ''}${p.ready ? ' ready' : ''}" style="--pc:${col}">` +
        `<span class="lb-color"></span>` +
        `<span class="lb-name">${esc(p.name || 'Jugador')}${me ? '<em class="lb-you">(tú)</em>' : ''}${p.host ? '<span class="lb-host">Anfitrión</span>' : ''}</span>` +
        `<span class="lb-state">${p.ready ? 'Listo' : 'Esperando'}</span></div>`;
    }
    this.el.lbSlots.innerHTML = html;
    const readyN = players.filter((p) => p.ready).length;
    this.el.lbCount.textContent = `${players.length}/${MAX_PLAYERS}`;
    this.el.lbStatus.textContent = players.length
      ? (readyN === players.length ? '¡Todos listos!' : `${readyN} de ${players.length} ${players.length === 1 ? 'jugador listo' : 'jugadores listos'}`)
      : 'Conectando…';
    this.el.lbStatus.classList.toggle('all', players.length > 0 && readyN === players.length);

    // Botones
    const ready = this._readyPending != null ? this._readyPending : !!(self && self.ready);
    this.el.lbReady.textContent = ready ? 'Cancelar listo' : 'Listo';
    this.el.lbReady.classList.toggle('on', ready);
    this.el.lbReady.disabled = !self;
    const host = !!(self && self.host);
    this.el.lbStart.style.display = host ? '' : 'none';
    this.el.lbStart.disabled = performance.now() < this._startCooldown;
    this.el.lbStart.textContent = host && players.length > 1 && readyN < players.length ? 'Iniciar de todos modos' : 'Iniciar partida';
    this.el.lbWait.style.display = host ? 'none' : '';
    this.el.lbWait.textContent = host ? '' : 'El anfitrión iniciará la partida cuando todos estén listos.';
    this.el.devTag.style.display = ctx.dev ? '' : 'none';

    // Direcciones LAN
    let urls = Array.isArray(ctx.lan) ? ctx.lan.filter((u) => typeof u === 'string' && u) : [];
    if (!urls.length) urls = [location.origin];
    this.el.lbUrls.innerHTML = urls.map((u) =>
      `<div class="lb-url"><code>${esc(u)}</code><button type="button" class="mn-btn small lb-copy" data-url="${esc(u)}">Copiar</button></div>`).join('');
  }

  _sendReady() {
    const ctx = this.ctx;
    let self = null;
    try { self = ctx.self; } catch { self = null; }
    if (!self || !ctx.net || typeof ctx.net.send !== 'function') return;
    const cur = this._readyPending != null ? this._readyPending : !!self.ready;
    const v = !cur;
    this._readyPending = v;
    try { ctx.net.send({ t: 'ready', v }); } catch { /* nada */ }
    this._renderLobby(true);
  }

  _sendStart() {
    const ctx = this.ctx;
    if (!ctx.net || typeof ctx.net.send !== 'function') return;
    if (performance.now() < this._startCooldown) return;
    this._startCooldown = performance.now() + 1500;
    try { ctx.net.send({ t: 'start' }); } catch { /* nada */ }
    this._renderLobby(true);
    setTimeout(() => { if (this.mode === 'lobby') this._renderLobby(true); }, 1600);
  }

  _showTip() {
    const next = () => {
      this._tipIdx = (this._tipIdx + 1) % TIPS.length;
      const el = this.el.lbTip;
      el.classList.remove('in');
      void el.offsetWidth;
      el.textContent = TIPS[this._tipIdx];
      el.classList.add('in');
    };
    next();
    clearInterval(this._tipTimer);
    this._tipTimer = setInterval(() => { if (this.mode === 'lobby') next(); }, 8000);
  }

  // ------------------------------------------------------------------ chat de la sala
  _addChat(e) {
    const sys = !e.pid || +e.pid === 0;
    const gs = this.ctx.gs;
    const p = !sys && gs && gs.players ? gs.players[e.pid] : null;
    const line = { sys, name: String(e.name || (p && p.name) || (sys ? 'Sistema' : 'Jugador')), color: safeColor(p && p.color), msg: String(e.msg || '') };
    this._chat.push(line);
    while (this._chat.length > CHAT_HISTORY) this._chat.shift();
    if (this.mode === 'lobby') {
      this._appendChatLine(line);
      const self = this.ctx.selfId;
      if (!sys && String(e.pid) !== String(self)) sfx(this.ctx, 'chat');
    }
  }

  _chatLineEl(l) {
    const div = document.createElement('div');
    div.className = 'lb-line' + (l.sys ? ' sys' : '');
    if (!l.sys) {
      const n = document.createElement('span');
      n.className = 'lb-line-name';
      n.style.color = l.color;
      n.textContent = `${l.name}: `;
      div.appendChild(n);
    }
    const t = document.createElement('span');
    t.className = 'lb-line-text';
    t.textContent = l.msg;
    div.appendChild(t);
    return div;
  }

  _appendChatLine(l) {
    const feed = this.el.lbFeed;
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    feed.appendChild(this._chatLineEl(l));
    while (feed.childElementCount > CHAT_HISTORY) feed.firstElementChild.remove();
    if (atBottom) feed.scrollTop = feed.scrollHeight;
  }

  _renderChat() {
    const feed = this.el.lbFeed;
    feed.innerHTML = '';
    if (!this._chat.length) {
      const d = document.createElement('div');
      d.className = 'lb-line sys lb-empty';
      d.textContent = 'Todavía no hay mensajes. ¡Saluda a tu equipo!';
      feed.appendChild(d);
    }
    for (const l of this._chat) feed.appendChild(this._chatLineEl(l));
    feed.scrollTop = feed.scrollHeight;
  }

  _sendChat() {
    const input = this.el.lbInput;
    const msg = (input.value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    input.value = '';
    if (!msg) return;
    try { if (this.ctx.net && typeof this.ctx.net.send === 'function') this.ctx.net.send({ t: 'chat', msg }); } catch { /* nada */ }
    const empty = this.el.lbFeed.querySelector('.lb-empty');
    if (empty) empty.remove();
  }

  // ------------------------------------------------------------------ pausa
  _renderPauseInfo() {
    const gs = this.ctx.gs;
    let self = null;
    try { self = this.ctx.self; } catch { self = null; }
    const parts = [];
    if (gs && gs.round > 0) parts.push(`Ronda ${gs.round | 0}`);
    parts.push(esc(MAP_NAME));
    if (self) parts.push(`${(self.points | 0).toLocaleString('es')} puntos`);
    const html = parts.map((p) => `<span>${p}</span>`).join('<span class="mn-dot">·</span>');
    if (this.el.pauseInfo.innerHTML !== html) this.el.pauseInfo.innerHTML = html;
  }

  // ------------------------------------------------------------------ fin de partida
  _renderGameOver(round, stats) {
    const gs = this.ctx.gs || {};
    const players = gs.players || {};
    this.el.goSub.innerHTML = round > 0
      ? `Sobreviviste <b>${round}</b> ${round === 1 ? 'ronda' : 'rondas'}`
      : 'No sobreviviste ninguna ronda';
    const rows = stats.map((s) => ({
      id: s.id, name: String(s.name || (players[s.id] && players[s.id].name) || 'Jugador'),
      color: safeColor(s.color || (players[s.id] && players[s.id].color)),
      points: s.points | 0, kills: s.kills | 0, headshots: s.headshots | 0, downs: s.downs | 0, revives: s.revives | 0,
    })).sort((a, b) => b.points - a.points || b.kills - a.kills);
    const selfKey = this.ctx.selfId != null ? String(this.ctx.selfId) : null;
    const best = rows.length > 1 ? rows.reduce((m, r) => (r.kills > m.kills ? r : m), rows[0]) : null;
    this.el.goBody.innerHTML = rows.map((r, i) => {
      const me = String(r.id) === selfKey;
      const mvp = best && r === best && r.kills > 0;
      return `<tr class="go-row${me ? ' me' : ''}${mvp ? ' mvp' : ''}" style="--pc:${r.color};--i:${i}">` +
        `<td class="go-name"><i class="go-dot"></i>${esc(r.name)}${mvp ? '<span class="go-badge">Más bajas</span>' : ''}</td>` +
        `<td>${r.points.toLocaleString('es')}</td><td>${r.kills}</td><td>${r.headshots}</td><td>${r.downs}</td><td>${r.revives}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="go-empty">Sin datos</td></tr>';
    if (rows.length > 1) {
      const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
      this.el.goFoot.innerHTML = `<tr><td class="go-name">Equipo</td><td>${sum('points').toLocaleString('es')}</td><td>${sum('kills')}</td>` +
        `<td>${sum('headshots')}</td><td>${sum('downs')}</td><td>${sum('revives')}</td></tr>`;
    } else {
      this.el.goFoot.innerHTML = '';
    }
  }

  _tickGameOver() {
    if (this.mode !== 'gameover') { clearInterval(this._goTimer); this._goTimer = 0; return; }
    const rem = Math.max(0, Math.ceil((this._goEndsAt - performance.now()) / 1000));
    const txt = rem > 0 ? `Volviendo a la sala de espera en ${rem} s…` : 'Volviendo a la sala de espera…';
    if (this.el.goCount.textContent !== txt) this.el.goCount.textContent = txt;
  }

  // ------------------------------------------------------------------ ajustes
  _settings() {
    if (!this.ctx.settings || typeof this.ctx.settings !== 'object') this.ctx.settings = { ...DEFAULT_SETTINGS };
    return this.ctx.settings;
  }

  _sanitize(s) {
    const d = DEFAULT_SETTINGS;
    s.sensitivity = num(s.sensitivity, d.sensitivity, 0.1, 4);
    s.fov = Math.round(num(s.fov, d.fov, 60, 100));
    s.volume = num(s.volume, d.volume, 0, 1);
    s.music = num(s.music, d.music, 0, 1);
    s.quality = s.quality === 'low' ? 'low' : 'high';
    s.invertY = !!s.invertY;
    s.brightness = num(s.brightness, d.brightness, 0.5, 2);
    return s;
  }

  _syncSettingsUI() {
    const s = this._sanitize(this._settings());
    for (const r of this.el.stRanges) r.value = String(s[r.dataset.key]);
    for (const v of this.el.stVals) v.textContent = fmtSetting(v.dataset.val, s[v.dataset.val]);
    for (const b of this.el.stSeg) {
      const on = b.dataset.quality === s.quality;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    this.el.stInv.checked = !!s.invertY;
    this._paintRanges();
  }

  // Relleno de la barra de cada deslizador
  _paintRanges() {
    for (const r of this.el.stRanges) {
      const min = +r.min, max = +r.max, v = +r.value;
      r.style.setProperty('--fill', `${(((v - min) / (max - min)) * 100).toFixed(1)}%`);
    }
  }

  _setSetting(key, value, immediate = false) {
    const s = this._settings();
    s[key] = value;
    this._sanitize(s);
    for (const v of this.el.stVals) if (v.dataset.val === key) v.textContent = fmtSetting(key, s[key]);
    this._paintRanges();
    if (immediate) this._commitSettings();
    else {
      clearTimeout(this._emitTimer);
      this._emitTimer = setTimeout(() => this._commitSettings(), 90);
    }
  }

  // Guarda en localStorage y avisa al resto de módulos
  _commitSettings() {
    clearTimeout(this._emitTimer);
    const ctx = this.ctx;
    const s = this._sanitize(this._settings());
    try {
      let stored = {};
      try { stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { stored = {}; }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...stored, ...s }));
    } catch { /* almacenamiento no disponible */ }
    try { if (typeof ctx.saveSettings === 'function') ctx.saveSettings(); } catch { /* nada */ }
    this._emitting = true;
    try { if (ctx.events && typeof ctx.events.emit === 'function') ctx.events.emit('settings', s); } catch (e) { console.error('[Menus] Error al aplicar ajustes:', e); }
    this._emitting = false;
  }

  _resetSettings() {
    const s = this._settings();
    Object.assign(s, DEFAULT_SETTINGS);
    this._syncSettingsUI();
    this._commitSettings();
  }

  // ------------------------------------------------------------------ confirmación
  _askConfirm(title, text, yesLabel, onYes) {
    this.el.cfTitle.textContent = title;
    this.el.cfText.textContent = text;
    this.el.cfYes.textContent = yesLabel || 'Aceptar';
    this._confirmYes = onYes;
    this.el.confirm.classList.add('on');
    try { this.el.cfNo.focus({ preventScroll: true }); } catch { /* nada */ }
  }

  _closeConfirm() {
    this._confirmYes = null;
    this.el.confirm.classList.remove('on');
  }

  get _confirmOpen() { return this.el.confirm.classList.contains('on'); }

  // ================================================================== enlaces del DOM
  _bindUI() {
    const root = this.root;

    // Sonidos de interfaz
    root.addEventListener('pointerover', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('button, .st-toggle, .st-range') : null;
      if (!b || b.disabled || (e.relatedTarget && b.contains(e.relatedTarget))) return;
      const t = performance.now();
      if (t - this._lastHover < 55) return;
      this._lastHover = t;
      sfx(this.ctx, 'ui_hover', { volume: 0.6 });
    });
    root.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('button') : null;
      if (b && !b.disabled) sfx(this.ctx, 'ui_click');
    });

    // Título
    this.el.joinBtn.addEventListener('click', () => this._join());
    this.el.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._join(); }
    });
    this.el.swatches.addEventListener('click', (e) => {
      const b = e.target.closest('.mn-swatch');
      if (!b) return;
      this.color = b.dataset.color;
      this._paintSwatches();
    });

    // Botones compartidos
    for (const b of root.querySelectorAll('.mn-open-settings')) b.addEventListener('click', () => this.showSettings());
    for (const b of root.querySelectorAll('.mn-open-controls')) {
      b.addEventListener('click', () => {
        this._backMode = this.mode === 'controls' ? this._backMode : this.mode;
        this._backFn = null;
        this._open('controls');
      });
    }
    for (const b of root.querySelectorAll('.mn-back')) b.addEventListener('click', () => this._goBack());

    // Sala
    this.el.lbReady.addEventListener('click', () => this._sendReady());
    this.el.lbStart.addEventListener('click', () => this._sendStart());
    root.querySelector('.lb-leave').addEventListener('click', () => {
      this._askConfirm('¿Salir de la sala?', 'Te desconectarás del servidor y volverás a la pantalla de título.', 'Salir', () => this._leave());
    });
    this.el.lbUrls.addEventListener('click', (e) => {
      const b = e.target.closest('.lb-copy');
      if (!b) return;
      copyText(b.dataset.url || '').then((ok) => {
        b.textContent = ok ? '¡Copiado!' : 'Selecciona y copia';
        b.classList.toggle('done', !!ok);
        setTimeout(() => { b.textContent = 'Copiar'; b.classList.remove('done'); }, 1800);
      });
    });
    this.el.lbEntry.addEventListener('submit', (e) => { e.preventDefault(); this._sendChat(); });

    // Pausa
    root.querySelector('.ps-continue').addEventListener('click', () => this.togglePause());
    root.querySelector('.ps-exit').addEventListener('click', () => {
      this._askConfirm('¿Salir de la partida?', 'Te desconectarás y perderás tu progreso en esta partida. Tus compañeros seguirán jugando.', 'Salir', () => this._leave());
    });

    // Fin de partida
    root.querySelector('.go-leave').addEventListener('click', () => this._leave());

    // Ajustes
    for (const r of this.el.stRanges) {
      r.addEventListener('input', () => this._setSetting(r.dataset.key, parseFloat(r.value)));
      r.addEventListener('change', () => this._setSetting(r.dataset.key, parseFloat(r.value), true));
    }
    for (const b of this.el.stSeg) {
      b.addEventListener('click', () => {
        for (const o of this.el.stSeg) { o.classList.toggle('sel', o === b); o.setAttribute('aria-checked', o === b ? 'true' : 'false'); }
        this._setSetting('quality', b.dataset.quality, true);
      });
    }
    this.el.stInv.addEventListener('change', () => this._setSetting('invertY', this.el.stInv.checked, true));
    root.querySelector('.st-reset').addEventListener('click', () => this._resetSettings());

    // Confirmación
    this.el.cfNo.addEventListener('click', () => this._closeConfirm());
    this.el.cfYes.addEventListener('click', () => {
      const fn = this._confirmYes;
      this._closeConfirm();
      if (typeof fn === 'function') fn();
    });
    this.el.confirm.addEventListener('click', (e) => { if (e.target === this.el.confirm) this._closeConfirm(); });

    // Que el clic derecho y la rueda no lleguen al juego mientras hay un menú
    root.addEventListener('contextmenu', (e) => { if (!isEditable(e.target)) e.preventDefault(); });

    // Teclado: Esc (volver / cerrar pausa) y T/Enter para el chat de la sala
    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  _onKey(e) {
    if (!this.mode) return;
    const t = e.target;
    if (e.key === 'Escape' || e.code === 'Escape') {
      if (isEditable(t) && this.root.contains(t)) { e.preventDefault(); t.blur(); return; }
      if (this._confirmOpen) { e.preventDefault(); this._closeConfirm(); return; }
      if (e.repeat || performance.now() - this._openedAt < ESC_GUARD_MS) return;
      if (this.mode === 'pause') { e.preventDefault(); this.togglePause(); }
      else if (this.mode === 'settings' || this.mode === 'controls') { e.preventDefault(); this._goBack(); }
      return;
    }
    if (this.mode === 'lobby' && !isEditable(t) && !this._confirmOpen && !e.ctrlKey && !e.altKey && !e.metaKey &&
        (e.code === 'KeyT' || e.key === 'Enter')) {
      if (e.key === 'Enter' && t && t.tagName === 'BUTTON') return;   // Enter sobre un botón lo activa
      e.preventDefault();
      try { this.el.lbInput.focus({ preventScroll: true }); } catch { /* nada */ }
    }
  }

  _bindEvents() {
    const ev = this.ctx.events;
    if (!ev || typeof ev.on !== 'function') return;
    const on = (name, fn) => ev.on(name, (p) => {
      try { fn(p || {}); } catch (e) { console.error('[Menus] Error en', name, e); }
    });
    on('welcome', () => {
      this._setJoining(false);
      if (this.mode === 'lobby') this._renderLobby(true);
    });
    on('gs', ({ gs }) => {
      if (this._readyPending != null && gs) {
        let self = null;
        try { self = this.ctx.self; } catch { self = null; }
        if (!self || !!self.ready === this._readyPending) this._readyPending = null;
      }
      if (this.mode === 'lobby') this._renderLobby();
      else if (this.mode === 'pause') this._renderPauseInfo();
    });
    on('ev:chat', (e) => this._addChat(e));
    on('net:close', () => this._setJoining(false));
    on('settings', (s) => {
      // Otro módulo cambió los ajustes: refrescar controles si la pantalla está abierta
      if (this.mode === 'settings' && s && !this._emitting) this._syncSettingsUI();
    });
  }
}

export default Menus;
