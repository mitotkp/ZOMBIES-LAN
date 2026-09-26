// Arranque del cliente: renderer, escena, ctx, construcción de módulos, flujo de pantallas y bucle principal.
// Orden por frame (SPEC 6.3): player → interaction → weapons → entities → world → effects → hud → audio → render → input.endFrame()

import * as THREE from 'three';
import { EventBus } from './eventbus.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { PlayerController } from './player.js';
import { Interaction } from './interaction.js';
import { makeStub, FallbackMenus, FallbackHUD } from './fallback.js';
import { GAME_TITLE, PLAYER_COLORS, CLIENT_SEND_RATE, ZOMBIE, clamp } from '/shared/constants.js';
import { PLAYER_SPAWNS, PLAYER_SPAWN_YAW, MAP_NAME } from '/shared/map.js';
import { r2, r3 } from '/shared/protocol.js';
import { tr } from './i18n.js';

const SETTINGS_KEY = 'zlan.settings';
const PARAMS = new URLSearchParams(location.search);
const DEBUG = PARAMS.get('debug') === '1';
const SEND_INTERVAL = 1 / CLIENT_SEND_RATE;
const PING_INTERVAL_MS = 2000;
const WELCOME_TIMEOUT_MS = 7000;
const BASE_EXPOSURE = 1.3;            // exposición base (el ajuste 'Brillo' la multiplica)

// Cámara de fondo (título / sala / fin): órbita lenta sobre la calle
const ORBIT = { cx: 36.5, cz: 25.5, rx: 13, rz: 4, y: 3.3, speed: 0.055 };

// Módulos de otros responsables, en el orden de construcción de SPEC 6.3
const MODULES = [
  { key: 'audio', path: './audio.js', cls: 'Audio' },
  { key: 'effects', path: './entities/effects.js', cls: 'Effects' },
  { key: 'world', path: './world/level.js', cls: 'World' },
  { key: 'entities', path: './entities/entities.js', cls: 'EntityManager' },
  { key: 'weapons', path: './weapons/weaponSystem.js', cls: 'WeaponSystem' },
  { key: 'player', local: PlayerController },
  { key: 'interaction', local: Interaction },
  { key: 'hud', path: './ui/hud.js', cls: 'HUD' },
  { key: 'menus', path: './ui/menus.js', cls: 'Menus' },
];
const UPDATE_ORDER = ['player', 'interaction', 'weapons', 'entities', 'world', 'effects', 'hud', 'audio'];

// ---------------------------------------------------------------------------------------------
// Ajustes persistidos
const DEFAULT_SETTINGS = {
  name: '', color: PLAYER_COLORS[0], sensitivity: 1.0, fov: 75, volume: 0.8, music: 0.5, quality: 'high', invertY: false, brightness: 1.0,
};

function sanitizeSettings(s) {
  const d = DEFAULT_SETTINGS;
  const num = (v, def, a, b) => { const n = Number(v); return isFinite(n) ? clamp(n, a, b) : def; };
  s.name = typeof s.name === 'string' ? s.name.trim().slice(0, 16) : '';
  s.color = typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : d.color;
  s.sensitivity = num(s.sensitivity, d.sensitivity, 0.05, 10);
  s.fov = num(s.fov, d.fov, 50, 120);
  s.volume = num(s.volume, d.volume, 0, 1);
  s.music = num(s.music, d.music, 0, 1);
  s.quality = s.quality === 'low' ? 'low' : 'high';
  s.invertY = !!s.invertY;
  s.brightness = num(s.brightness, d.brightness, 0.5, 2);
  if (s.lang !== 'es' && s.lang !== 'en') delete s.lang;     // idioma (lo gestiona i18n.js)
  return s;
}

function loadSettings() {
  let stored = {};
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) stored = JSON.parse(raw) || {};
  } catch { stored = {}; }
  const s = sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored });
  if (!s.name) s.name = tr('Jugador{0}', Math.floor(10 + Math.random() * 90));
  return s;
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* almacenamiento no disponible */ }
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

function sameId(a, b) { return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b); }

function isEditableEl(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const t = (el.getAttribute('type') || '').toLowerCase();
  return ['', 'text', 'search', 'email', 'number', 'password', 'url', 'tel'].includes(t);
}

function isInteractiveEl(el) {
  for (let n = el, i = 0; n && n.nodeType === 1 && i < 6; n = n.parentElement, i++) {
    if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'LABEL', 'OPTION'].includes(n.tagName)) return true;
    if (n.getAttribute && n.getAttribute('role') === 'button') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Capas propias del núcleo (carga, estado de conexión, "haz clic", espectador, DEV, FPS)
class CoreOverlays {
  constructor() {
    const mk = (css) => { const e = document.createElement('div'); e.style.cssText = css; document.body.appendChild(e); return e; };
    const font = 'font-family:"Segoe UI",Tahoma,sans-serif;';

    this.loading = mk(`position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;color:#aaa;${font}`);
    const t = document.createElement('div');
    t.style.cssText = 'font:bold 72px Impact,"Arial Black",sans-serif;letter-spacing:8px;color:#a50d0d;text-shadow:0 0 24px #500;';
    t.textContent = 'ZOMBIES';
    const sub = document.createElement('div');
    sub.style.cssText = 'margin-top:6px;letter-spacing:6px;color:#666;font-size:14px;';
    sub.textContent = 'L A N';
    this.loadingText = document.createElement('div');
    this.loadingText.style.cssText = 'margin-top:28px;font-size:15px;letter-spacing:2px;';
    this.loading.append(t, sub, this.loadingText);

    this.status = mk(`position:fixed;inset:0;z-index:1001;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);color:#ddd;${font}`);
    this.statusBox = document.createElement('div');
    this.statusBox.style.cssText = 'min-width:320px;max-width:90vw;padding:26px 32px;text-align:center;background:rgba(10,8,8,0.95);border:1px solid #6a1111;box-shadow:0 0 40px rgba(150,0,0,0.35);';
    this.status.appendChild(this.statusBox);
    this.statusVisible = false;
    this.statusBlocking = false;

    this.click = mk(`position:fixed;left:50%;top:58%;transform:translateX(-50%);z-index:30;display:none;pointer-events:none;padding:10px 22px;background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.25);color:#fff;font-size:18px;letter-spacing:1px;${font}`);
    this.click.textContent = tr('Haz clic para jugar');

    this.spectate = mk(`position:fixed;left:50%;top:11vh;transform:translateX(-50%);z-index:30;display:none;pointer-events:none;text-align:center;color:#eee;text-shadow:0 1px 4px #000;${font}`);

    this.dev = mk(`position:fixed;right:10px;top:8px;z-index:31;display:none;pointer-events:none;padding:2px 8px;background:#a00;color:#fff;font:bold 12px Consolas,monospace;letter-spacing:2px;`);
    this.dev.textContent = 'DEV';

    this.fps = mk('position:fixed;left:8px;top:6px;z-index:31;display:none;pointer-events:none;color:#8f8;font:12px Consolas,monospace;text-shadow:0 1px 2px #000;white-space:pre;');
    this._last = {};
  }

  setLoading(text) { this.loadingText.textContent = text || ''; }
  hideLoading() { this.loading.style.display = 'none'; }

  // Muestra un aviso modal. buttons: [{ label, onClick }]
  showStatus(title, text, buttons = [], blocking = true) {
    const box = this.statusBox;
    box.innerHTML = '';
    const h = document.createElement('div');
    h.style.cssText = 'font:bold 28px Impact,"Arial Black",sans-serif;letter-spacing:3px;color:#c21a1a;margin-bottom:10px;';
    h.textContent = title || '';
    box.appendChild(h);
    if (text) {
      const p = document.createElement('div');
      p.style.cssText = 'font-size:15px;line-height:1.5;color:#ccc;white-space:pre-line;';
      p.textContent = text;
      box.appendChild(p);
    }
    if (buttons.length) {
      const row = document.createElement('div');
      row.style.cssText = 'margin-top:18px;';
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = b.label;
        btn.style.cssText = 'margin:0 6px;padding:9px 20px;font:600 15px "Segoe UI",Tahoma,sans-serif;color:#fff;background:#7a0d0d;border:1px solid #c33;border-radius:3px;cursor:pointer;';
        btn.addEventListener('click', (e) => { e.preventDefault(); b.onClick(); });
        row.appendChild(btn);
      }
      box.appendChild(row);
    }
    this.status.style.display = 'flex';
    this.statusVisible = true;
    this.statusBlocking = blocking;
  }

  hideStatus() {
    this.status.style.display = 'none';
    this.statusVisible = false;
    this.statusBlocking = false;
  }

  fatal(title, text) {
    this.hideLoading();
    this.showStatus(title, text, [{ label: tr('Recargar'), onClick: () => location.reload() }]);
  }

  // Cambia display/texto solo si difiere (evita tocar el DOM cada frame)
  toggle(name, on, text) {
    const el = this[name];
    const last = this._last[name] || (this._last[name] = { on: null, text: null });
    if (last.on !== on) { el.style.display = on ? 'block' : 'none'; last.on = on; }
    if (on && text !== undefined && last.text !== text) {
      if (name === 'spectate') el.innerHTML = text; else el.textContent = text;
      last.text = text;
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------------------------
async function boot() {
  window.__zlanBooted = true;
  const overlays = new CoreOverlays();
  overlays.setLoading(tr('Cargando…'));
  document.title = GAME_TITLE;

  const settings = loadSettings();
  const events = new EventBus();

  // ------------------------------------------------------------ renderer
  const appEl = document.getElementById('app') || document.body;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: settings.quality === 'high',
      powerPreference: 'high-performance',
      stencil: false,
    });
  } catch (err) {
    overlays.fatal(tr('SIN WEBGL'), tr('Tu navegador o tu tarjeta gráfica no permiten WebGL.\nPrueba con Chrome, Edge o Firefox actualizados y con la aceleración por hardware activada.'));
    throw err;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = BASE_EXPOSURE * settings.brightness;
  renderer.autoClear = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.enabled = settings.quality === 'high';
  renderer.setClearColor(0x000000, 1);
  const pixelRatioFor = (q) => Math.min(window.devicePixelRatio || 1, q === 'low' ? 1 : 1.5);
  renderer.setPixelRatio(pixelRatioFor(settings.quality));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.style.display = 'block';
  renderer.domElement.tabIndex = -1;
  appEl.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('[main] Se perdió el contexto WebGL; se intentará recuperar.');
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.05, 250);
  camera.rotation.order = 'YXZ';
  camera.position.set(ORBIT.cx + ORBIT.rx, ORBIT.y, ORBIT.cz);
  scene.add(camera);

  // ------------------------------------------------------------ ctx (SPEC 6.1)
  const ctx = {
    THREE, renderer, scene, camera,
    events,
    net: null, input: null, settings,
    selfId: null,
    gs: null,
    get self() {
      const gs = this.gs;
      if (!gs || !gs.players || this.selfId === null || this.selfId === undefined) return null;
      return gs.players[this.selfId] || null;
    },
    get host() { const s = this.self; return !!(s && s.host); },
    dev: false,
    debug: DEBUG,
    lan: [],
    time: 0,
    player: null, interaction: null, world: null, entities: null, effects: null, weapons: null, hud: null, menus: null, audio: null,
    saveSettings: () => saveSettings(settings),
  };
  window.game = ctx;

  ctx.net = new Net(ctx);
  ctx.input = new Input(ctx, { element: renderer.domElement, allowUnlocked: DEBUG });
  const net = ctx.net;
  const input = ctx.input;

  // ------------------------------------------------------------ llamadas seguras
  const failed = new Set();
  function safe(name, fn) {
    try { return fn(); } catch (err) {
      if (!failed.has(name)) {
        failed.add(name);
        console.error(`[main] Error en ${name} (solo se registra la primera vez):`, err);
      }
      return undefined;
    }
  }
  function call(key, method, ...args) {
    const m = ctx[key];
    if (!m || typeof m[method] !== 'function') return undefined;
    return safe(`${key}.${method}`, () => m[method](...args));
  }

  // ------------------------------------------------------------ carga y construcción de módulos
  overlays.setLoading(tr('Cargando módulos…'));
  const imported = await Promise.all(MODULES.map((m) => {
    if (m.local) return Promise.resolve(m.local);
    return import(m.path).then((mod) => {
      const C = mod && (mod[m.cls] || mod.default);
      if (typeof C !== 'function') throw new Error(`El módulo ${m.path} no exporta la clase ${m.cls}`);
      return C;
    }).catch((err) => {
      console.error(`[main] No se pudo cargar ${m.path}:`, err);
      return null;
    });
  }));

  for (let i = 0; i < MODULES.length; i++) {
    const m = MODULES[i];
    const C = imported[i];
    let inst = null;
    if (C) {
      try {
        inst = new C(ctx);
      } catch (err) {
        console.error(`[main] Error al construir ${m.cls || m.key}:`, err);
        inst = null;
      }
    }
    ctx[m.key] = inst;
    if (m.key === 'world' && inst) {
      // El mapa es estático: se construye una sola vez antes de conectar
      overlays.setLoading(tr('Construyendo el mapa…'));
      await nextFrame();
      safe('world.build', () => inst.build());
    }
  }
  // Respaldos para los módulos que fallaron
  for (const m of MODULES) {
    if (ctx[m.key]) continue;
    if (m.key === 'menus') ctx.menus = safe('FallbackMenus', () => new FallbackMenus(ctx)) || makeStub('menus');
    else if (m.key === 'hud') ctx.hud = safe('FallbackHUD', () => new FallbackHUD(ctx)) || makeStub('hud');
    else ctx[m.key] = makeStub(m.key);
    console.warn(`[main] Usando un módulo de respaldo para '${m.key}'.`);
  }

  // Si una pantalla de Menus falla, se sustituye por los menús de respaldo
  let menusFallbackUsed = !!ctx.menus.__stub || ctx.menus instanceof FallbackMenus;
  function menus(method, ...args) {
    const m = ctx.menus;
    if (m && typeof m[method] === 'function') {
      try { return m[method](...args); } catch (err) {
        console.error(`[main] Error en menus.${method}:`, err);
      }
    }
    if (!menusFallbackUsed) {
      menusFallbackUsed = true;
      console.warn('[main] Cambiando a los menús de respaldo.');
      const fb = safe('FallbackMenus', () => new FallbackMenus(ctx));
      if (fb) {
        ctx.menus = fb;
        return safe(`fallback.${method}`, () => fb[method](...args));
      }
    }
    return undefined;
  }
  function menusOpen() {
    const m = ctx.menus;
    if (!m) return false;
    try {
      return typeof m.isOpen === 'function' ? !!m.isOpen() : !!m.isOpen;
    } catch { return false; }
  }

  // ------------------------------------------------------------ ajustes
  function applySettings() {
    sanitizeSettings(settings);
    renderer.setPixelRatio(pixelRatioFor(settings.quality));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMappingExposure = BASE_EXPOSURE * settings.brightness;
    const shadows = settings.quality === 'high';
    if (renderer.shadowMap.enabled !== shadows) {
      renderer.shadowMap.enabled = shadows;
      scene.traverse((o) => {
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const mat of mats) mat.needsUpdate = true;
      });
    }
    call('audio', 'setVolumes', settings.volume, settings.music);
  }
  events.on('settings', (s) => {
    if (s && typeof s === 'object' && s !== settings) Object.assign(settings, s);
    applySettings();
    saveSettings(settings);
  });
  applySettings();

  // ------------------------------------------------------------ estado del flujo
  const app = {
    stage: 'title',          // 'title' | 'connecting' | 'online' | 'disconnected'
    joinName: settings.name,
    joinColor: settings.color,
    connecting: false,
    welcomeTimer: 0,
    lastGameOver: null,
    expectUnlock: false,
    lastTypingAt: 0,
    lastPauseAt: 0,
    kickReason: null,
    scoreboard: false,
  };
  const isPlaying = () => !!(ctx.gs && ctx.gs.phase === 'playing');

  function releaseGameplay() {
    if (input.locked) app.expectUnlock = true;
    input.exitLock();
    if (app.scoreboard) { app.scoreboard = false; call('hud', 'showScoreboard', false); }
  }

  // ------------------------------------------------------------ conexión
  const KICK_TEXT = {
    full: tr('La partida está llena (máximo 4 jugadores).'),
    busy: tr('La partida no admite jugadores en este momento.'),
  };

  function showConnectError(title, text) {
    app.stage = 'disconnected';
    overlays.showStatus(title, text, [
      { label: tr('Reintentar'), onClick: () => connectAndHello() },
      { label: tr('Volver al título'), onClick: () => location.reload() },
    ]);
  }

  async function connectAndHello() {
    if (app.connecting) return;
    app.connecting = true;
    app.stage = 'connecting';
    app.kickReason = null;
    overlays.showStatus(tr('CONECTANDO'), tr('Conectando con {0}…', location.host || 'el servidor'), [], true);
    // Sin estado anterior: el 'welcome' volverá a disparar el cambio de fase
    const prevGs = ctx.gs;
    ctx.gs = null;
    ctx.selfId = null;
    if (prevGs && prevGs.phase === 'playing') safe('entities.reset', () => ctx.entities.reset && ctx.entities.reset());
    try {
      await net.connect();
      net.send({ t: 'hello', name: app.joinName, color: app.joinColor });
      clearTimeout(app.welcomeTimer);
      app.welcomeTimer = setTimeout(() => {
        if (ctx.selfId === null && net.connected) {
          net.close();
          showConnectError(tr('SIN RESPUESTA'), tr('El servidor aceptó la conexión pero no respondió.\nComprueba que sea un servidor de ZOMBIES LAN.'));
        }
      }, WELCOME_TIMEOUT_MS);
    } catch (err) {
      showConnectError(tr('NO SE PUDO CONECTAR'),
        tr('No se pudo conectar con el servidor ({0}).\n', location.host || 'desconocido') +
        tr('Comprueba que el anfitrión tenga el servidor abierto, que estés en la misma red\n') +
        tr('y que el firewall de Windows permita Node.js en redes privadas (puerto 3000).'));
    } finally {
      app.connecting = false;
    }
  }

  function onJoin(name, color) {
    if (app.connecting) return;
    const n = typeof name === 'string' ? name.trim().slice(0, 16) : '';
    app.joinName = n || settings.name || tr('Jugador');
    app.joinColor = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : settings.color;
    settings.name = app.joinName;
    settings.color = app.joinColor;
    saveSettings(settings);
    events.emit('settings', settings);
    call('audio', 'unlock');
    connectAndHello();
  }

  events.on('welcome', (w) => {
    clearTimeout(app.welcomeTimer);
    app.stage = 'online';
    overlays.hideStatus();
    overlays.toggle('dev', !!(w && w.dev));
  });

  events.on('net:kick', (k) => { app.kickReason = k && k.reason ? String(k.reason) : 'desconocido'; });

  events.on('net:close', (c) => {
    if (c && c.intentional) return;
    clearTimeout(app.welcomeTimer);
    releaseGameplay();
    if (app.kickReason) {
      const r = app.kickReason;
      showConnectError(tr('DESCONECTADO'), KICK_TEXT[r] || tr('El servidor cerró la conexión: {0}', r));
    } else {
      showConnectError(tr('CONEXIÓN PERDIDA'), tr('Se perdió la conexión con el servidor.\nPuede que el anfitrión haya cerrado la partida o que la red se haya caído.'));
    }
  });

  // ------------------------------------------------------------ fases
  function gameOverFromGs() {
    const gs = ctx.gs || {};
    const stats = Object.values(gs.players || {}).map((p) => ({
      id: p.id, name: p.name, color: p.color, points: p.points || 0, kills: p.kills || 0,
      headshots: p.headshots || 0, downs: p.downs || 0, revives: p.revives || 0,
    }));
    return { round: gs.round || 0, stats };
  }

  function enterPhase(phase, prev) {
    if (phase === 'lobby') {
      releaseGameplay();
      if (prev === 'playing' || prev === 'gameover') {
        call('entities', 'reset');
        call('weapons', 'reset');
      }
      net.clearSnapshots();
      app.lastGameOver = null;
      menus('showLobby');
      call('audio', 'music', 'lobby');
    } else if (phase === 'playing') {
      if (prev !== 'playing') {
        call('entities', 'reset');
        call('weapons', 'reset');
      }
      menus('hideAll');
      if (document.activeElement && document.activeElement !== document.body && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      const self = ctx.self;
      const idx = self && Number.isInteger(self.spawn) ? self.spawn : 0;
      const sp = PLAYER_SPAWNS[idx] || PLAYER_SPAWNS[0];
      safe('player.spawn', () => ctx.player.spawn(sp.x, sp.z, PLAYER_SPAWN_YAW));
      if (!DEBUG) input.requestLock();
    } else if (phase === 'gameover') {
      releaseGameplay();
      menus('showGameOver', app.lastGameOver || gameOverFromGs());
    }
  }
  events.on('phase', (p) => { if (p) enterPhase(p.phase, p.prev); });

  events.on('ev:gameover', (e) => {
    app.lastGameOver = e;
    call('audio', 'music', 'game_over');
    if (ctx.gs && ctx.gs.phase === 'gameover') menus('showGameOver', e);
  });

  events.on('ev:respawn', (e) => {
    if (!e || !sameId(e.pid, ctx.selfId)) return;
    safe('player.spawn', () => ctx.player.spawn(e.x, e.z, e.yaw));
  });

  // Golpe de zombi al jugador local → 'local:damage'
  events.on('ev:zatk', (e) => {
    if (!e || !e.hit || !sameId(e.pid, ctx.selfId)) return;
    let fromX, fromZ;
    const zv = safe('entities.getZombie', () => ctx.entities.getZombie && ctx.entities.getZombie(e.id));
    if (zv && isFinite(zv.x) && isFinite(zv.z)) { fromX = zv.x; fromZ = zv.z; }
    else {
      const snap = net.lastSnapshot;
      const zs = snap && snap.z && snap.z.get(e.id);
      if (zs) { fromX = zs.x; fromZ = zs.z; }
      else {
        const p = ctx.player;
        fromX = p.position.x - Math.sin(p.yaw);
        fromZ = p.position.z - Math.cos(p.yaw);
      }
    }
    const dmg = Number(e.amount ?? e.dmg);
    const amount = e.blocked ? 0 : (isFinite(dmg) && dmg > 0 ? dmg : ZOMBIE.damage);
    events.emit('local:damage', { amount, fromX, fromZ, blocked: !!e.blocked });
  });

  // ------------------------------------------------------------ pointer lock y pausa
  function openPause() {
    const t = performance.now();
    if (t - app.lastPauseAt < 300) return;
    app.lastPauseAt = t;
    menus('togglePause');
  }

  events.on('input:lock', ({ locked } = {}) => {
    if (locked) {
      app.expectUnlock = false;
      if (document.activeElement && document.activeElement !== document.body && !isEditableEl(document.activeElement) &&
          typeof document.activeElement.blur === 'function') document.activeElement.blur();
      return;
    }
    const expected = app.expectUnlock;
    app.expectUnlock = false;
    if (expected) return;
    if (!isPlaying() || !net.connected || overlays.statusVisible || menusOpen()) return;
    if (input.typing || performance.now() - app.lastTypingAt < 400) return;
    openPause();
  });

  // Clic en el juego sin pointer lock → bloquear (el clic no dispara)
  window.addEventListener('mousedown', (e) => {
    if (DEBUG || !isPlaying() || input.locked || menusOpen() || overlays.statusVisible) return;
    if (isEditableEl(e.target) || isInteractiveEl(e.target) || input.typing) return;
    input.requestLock();
  }, true);

  // Audio: se desbloquea con el primer gesto del usuario
  const unlockAudio = () => {
    call('audio', 'unlock');
    window.removeEventListener('pointerdown', unlockAudio, true);
    window.removeEventListener('keydown', unlockAudio, true);
  };
  window.addEventListener('pointerdown', unlockAudio, true);
  window.addEventListener('keydown', unlockAudio, true);

  // Evita cerrar la pestaña por accidente en plena partida (p. ej. Ctrl+W al agacharse)
  // (si el menú de pausa cierra la conexión antes de recargar, no se pregunta)
  window.addEventListener('beforeunload', (e) => {
    if (isPlaying() && net.connected && !net.closing) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ------------------------------------------------------------ redimensionado
  function onResize() {
    const w = window.innerWidth, h = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(pixelRatioFor(settings.quality));
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const vc = ctx.weapons && ctx.weapons.vmCamera;
    if (vc && vc.isPerspectiveCamera) { vc.aspect = w / h; vc.updateProjectionMatrix(); }
  }
  window.addEventListener('resize', onResize);

  // ------------------------------------------------------------ ping
  setInterval(() => { if (net.connected) net.ping(); }, PING_INTERVAL_MS);

  // ------------------------------------------------------------ cámara de fondo
  let orbitT = Math.random() * Math.PI * 2;
  function orbitCamera(dt) {
    orbitT += dt * ORBIT.speed;
    const c = Math.cos(orbitT), s = Math.sin(orbitT);
    camera.position.set(ORBIT.cx + c * ORBIT.rx, ORBIT.y + Math.sin(orbitT * 1.7) * 0.35, ORBIT.cz + s * ORBIT.rz);
    camera.rotation.order = 'YXZ';
    camera.lookAt(ORBIT.cx - c * 5, 1.5, ORBIT.cz - s * 1.5);
    const fov = settings.fov;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------ envío del estado local
  let sendAcc = 0;
  function currentSlot() {
    const cur = ctx.weapons && ctx.weapons.current;
    if (cur && Number.isInteger(cur.slot)) return cur.slot;
    const self = ctx.self;
    return self && Number.isInteger(self.cur) ? self.cur : 0;
  }
  function sendState(dt) {
    sendAcc += dt;
    if (sendAcc < SEND_INTERVAL) return;
    sendAcc -= SEND_INTERVAL;
    if (sendAcc > SEND_INTERVAL * 3) sendAcc = 0;
    if (!isPlaying() || !net.connected || ctx.selfId === null) return;
    const p = ctx.player;
    if (!p || !p.position) return;
    let f = 0;
    try { f = p.flags(); } catch { f = 0; }
    net.send({
      t: 'st',
      p: [r2(p.position.x), r2(p.position.y), r2(p.position.z)],
      yaw: r3(p.yaw), pitch: r3(p.pitch), f, cur: currentSlot(),
    });
  }

  // ------------------------------------------------------------ capas por frame
  let fpsFrames = 0, fpsTime = 0, fpsValue = 0;
  function updateOverlays(dt) {
    const playing = isPlaying();
    const self = ctx.self;
    if (input.typing) app.lastTypingAt = performance.now();
    const needClick = playing && !DEBUG && !input.locked && !menusOpen() && !overlays.statusVisible && !input.typing;
    overlays.toggle('click', needClick, self && self.state === 'dead' ? tr('Haz clic para observar') : tr('Haz clic para jugar'));

    let spec = null;
    if (playing && self && self.state === 'dead') {
      const pid = ctx.player && ctx.player.spectating;
      const target = pid !== null && pid !== undefined && ctx.gs.players ? ctx.gs.players[pid] : null;
      if (target) {
        spec = `<div style="font-size:13px;letter-spacing:3px;color:#aaa">${tr('OBSERVANDO A')}</div>` +
          `<div style="font-size:24px;font-weight:700;color:${escapeHtml(target.color || '#fff')}">${escapeHtml(target.name || 'Jugador')}</div>` +
          `<div style="font-size:13px;color:#bbb;margin-top:4px">${tr('Clic para cambiar · Reaparecerás al comenzar la siguiente ronda')}</div>`;
      } else {
        spec = `<div style="font-size:18px;color:#ddd">${tr('Esperando la siguiente ronda…')}</div>`;
      }
    }
    overlays.toggle('spectate', !!spec, spec || '');

    if (DEBUG) {
      fpsFrames++; fpsTime += dt;
      if (fpsTime >= 0.5) { fpsValue = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0; }
      const zs = net.lastSnapshot ? net.lastSnapshot.z.size : 0;
      overlays.toggle('fps', true, `FPS ${fpsValue}  RTT ${Math.round(net.rtt)} ms  Z ${zs}\n${renderer.info.render.calls} draws  ${renderer.info.render.triangles} tris`);
    }
  }

  // ------------------------------------------------------------ render
  let vmAspect = 0;
  function render() {
    renderer.autoClear = false;
    renderer.clear();
    renderer.render(scene, camera);
    const w = ctx.weapons;
    const self = ctx.self;
    if (isPlaying() && w && w.vmScene && w.vmCamera && self && self.state !== 'dead') {
      if (w.vmCamera.isPerspectiveCamera && vmAspect !== camera.aspect) {
        vmAspect = camera.aspect;
        w.vmCamera.aspect = camera.aspect;
        w.vmCamera.updateProjectionMatrix();
      }
      renderer.clearDepth();
      renderer.render(w.vmScene, w.vmCamera);
    }
  }

  // ------------------------------------------------------------ bucle principal
  let lastT = performance.now();
  function frame() {
    requestAnimationFrame(frame);
    const t = performance.now();
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.05);
    ctx.time += dt;
    if (DEBUG) { renderer.info.autoReset = false; renderer.info.reset(); }

    const open = menusOpen();
    input.enabled = !open && !overlays.statusBlocking;

    if (isPlaying()) {
      // Esc sin pointer lock (modo debug o navegador que lo entrega)
      if (!open && input.pressed('pause')) openPause();
      const sb = input.isDown('scoreboard');
      if (sb !== app.scoreboard) { app.scoreboard = sb; call('hud', 'showScoreboard', sb); }
    } else if (app.scoreboard) {
      app.scoreboard = false;
      call('hud', 'showScoreboard', false);
    }

    for (const key of UPDATE_ORDER) {
      const m = ctx[key];
      if (m && typeof m.update === 'function') safe(`${key}.update`, () => m.update(dt));
    }
    if (!isPlaying()) orbitCamera(dt);

    sendState(dt);
    safe('render', render);
    input.endFrame();
    updateOverlays(dt);
  }

  // ------------------------------------------------------------ inicio
  onResize();
  overlays.hideLoading();
  requestAnimationFrame(frame);
  menus('showMain', onJoin);
  console.info(`[${GAME_TITLE}] Cliente listo. Mapa: ${MAP_NAME}.${DEBUG ? ' Modo debug activo.' : ''}`);
}

boot().catch((err) => {
  console.error('[main] Error fatal al iniciar el juego:', err);
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:#000;color:#ddd;font:16px "Segoe UI",Tahoma,sans-serif;text-align:center;padding:20px;';
  box.textContent = tr('No se pudo iniciar el juego. Abre la consola del navegador (F12) para ver el detalle y recarga la página.');
  if (!document.querySelector('[data-zlan-fatal]')) { box.setAttribute('data-zlan-fatal', '1'); document.body.appendChild(box); }
});
