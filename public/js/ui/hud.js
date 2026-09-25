// HUD estilo Black Ops 2 Zombies (DOM sobre el canvas, contenedor #hud).
// Ronda en tiza roja, puntos, ventajas, munición, potenciadores, cruz, daño, caídos, tabla, chat...

import * as THREE from 'three';
import { PERKS } from '/shared/perks.js';
import { POWERUP_INFO, PLAYER, MEDS, MED_KEYS, angleDiff, yawTo, clamp } from '/shared/constants.js';
import { weaponName, meleeStats } from '/shared/weapons.js';
import { MAP_NAME, SHIELD_PARTS } from '/shared/map.js';
import { esc, safeColor, mulberry32, serverNow, sfx, ensureChalkDefs, isDebugUrl } from './uiutil.js';

const DENY_TEXT = {
  points: 'No tienes suficientes puntos',
  power: 'Se requiere electricidad',
  limit: 'Solo puedes tener 4 ventajas',
  full: 'Ya tienes el máximo',
  busy: 'Está en uso, espera un momento',
  owned: 'Ya lo tienes',
};

const ICONS = {
  instakill: '<svg viewBox="0 0 40 40"><path fill-rule="evenodd" d="M20 3C11.7 3 6 8.6 6 16c0 4.3 1.9 7.3 4.5 9.2V30a2 2 0 0 0 2 2h2v3h3v-3h5v3h3v-3h2a2 2 0 0 0 2-2v-4.8C32.1 23.3 34 20.3 34 16c0-7.4-5.7-13-14-13zm-6 10a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm12 0a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM20 22l2.6 4.2h-5.2z"/></svg>',
  doublepoints: '<svg viewBox="0 0 40 40"><text x="20" y="29" text-anchor="middle" font-size="24" font-family="Impact, \'Arial Narrow\', sans-serif" font-weight="bold">x2</text></svg>',
  firesale: '<svg viewBox="0 0 40 40"><path d="M21 2c2 7-7 11-7 19a6 6 0 0 0 12 0c0-3-2-5-2-8 4 3 8 7 8 13a12 12 0 0 1-24 0C8 14 19 10 21 2z"/></svg>',
  nade: '<svg viewBox="0 0 20 26"><rect x="7" y="1.5" width="6" height="4" rx="1"/><path d="M13 3.5l5-1.5v3.5z"/><ellipse cx="10" cy="15.5" rx="7.2" ry="8.8"/><path d="M4 12.5h12M4 18.5h12" stroke="rgba(0,0,0,.45)" stroke-width="1.2"/></svg>',
  shield: '<svg viewBox="0 0 24 30"><path d="M2 2h20v14c0 6.5-5 10.5-10 12.5C7 26.5 2 22.5 2 16z"/><path d="M5 9h14M5 14h14" stroke="rgba(0,0,0,.4)" stroke-width="1.4"/></svg>',
  knife: '<svg viewBox="0 0 40 14"><path d="M2 7l22-5h6v10h-6z"/><rect x="30" y="4" width="9" height="6" rx="1.5"/></svg>',
  revive: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="rgba(0,0,0,.55)"/><path d="M16 7h8v9h9v8h-9v9h-8v-9H7v-8h9z"/></svg>',
  part: '<svg viewBox="0 0 24 24"><path d="M3 5h11l7 7v7H3z"/></svg>',
};

const TEMPLATE = `
<svg class="hud-defs" width="0" height="0" aria-hidden="true"><defs><linearGradient id="zlDmgGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff2a1a"/><stop offset="1" stop-color="#7a0000" stop-opacity="0"/></linearGradient></defs></svg>
<div class="hud-layer hud-vignette"></div>
<div class="hud-layer hud-hurt"></div>
<div class="hud-layer hud-infect"></div>
<div class="hud-layer hud-splats"></div>
<div class="hud-layer hud-flash"></div>
<div class="hud-scope"><div class="scope-glass"></div><i class="scope-h"></i><i class="scope-v"></i><i class="scope-dot"></i></div>
<div class="hud-dmgdirs"></div>
<div class="hud-crosshair"><i class="ch ch-t"></i><i class="ch ch-b"></i><i class="ch ch-l"></i><i class="ch ch-r"></i><i class="ch-dot"></i></div>
<div class="hud-hitmarker"><i></i><i></i><i></i><i></i></div>
<div class="hud-downicons"></div>
<div class="hud-timer"><div class="tm-main"></div><div class="tm-sub"></div></div>
<div class="hud-banner"><div class="bn-title"></div><div class="bn-sub"></div></div>
<div class="hud-puname"></div>
<div class="hud-msg"></div>
<div class="hud-prompt"><div class="hud-prompt-text"></div><div class="hud-progress"><i></i></div></div>
<div class="hud-reload"></div>
<div class="hud-downpanel"><div class="dp-title"></div><div class="dp-sub"></div><div class="dp-bar"><i></i></div></div>
<div class="hud-chat"><div class="chat-feed"></div><div class="chat-entry"><span class="chat-label">Decir:</span><input class="chat-input" type="text" maxlength="120" autocomplete="off" spellcheck="false"></div></div>
<div class="hud-bl"><div class="hud-parts"></div><div class="hud-perks"></div><div class="hud-round"></div><div class="hud-health"><div class="hp-row"><span class="hp-label">Salud</span><span class="hp-num"></span><span class="hp-inf">Infectado</span></div><div class="hp-bar"><i class="hp-fill"></i><i class="hp-cap"></i></div><div class="hp-heal"><span class="hp-heal-t"></span><div class="hp-heal-bar"><i></i></div></div><div class="hud-meds"></div></div></div>
<div class="hud-br">
  <div class="hud-scores"></div>
  <div class="hud-ammo">
    <div class="am-name"></div>
    <div class="am-count"><span class="am-mag"></span><span class="am-sep">/</span><span class="am-res"></span></div>
    <div class="am-extra">
      <div class="am-melee"></div>
      <div class="am-shield">${ICONS.shield}<div class="am-shield-bar"><i></i></div></div>
      <div class="am-nades"></div>
    </div>
  </div>
</div>
<div class="hud-powerups"></div>
<div class="hud-scoreboard"></div>
<div class="hud-dev"></div>
`;

// Texto con la tecla resaltada: "Pulsa F para..." -> "Pulsa [F] para..."
function formatKeys(text) {
  return esc(text).replace(/\b(Pulsa|Mantén|Mant&eacute;n)\s+([A-Z])\b/, '$1 <span class="key">$2</span>');
}

// Marcas de conteo (1-5) o número de ronda, dibujados en SVG con trazo irregular de tiza.
// El rectángulo invisible fija la caja del filtro (si no, el filtro recorta los trazos casi verticales).
function roundSVG(n) {
  if (n <= 0) return '';
  const r = mulberry32(n * 7919 + 17);
  const j = (a) => (r() * 2 - 1) * a;
  if (n <= 5) {
    let paths = '';
    const count = Math.min(n, 4);
    for (let i = 0; i < count; i++) {
      const x = 26 + i * 34 + j(3);
      const top = 14 + j(5), bot = 126 + j(4);
      const lean = j(7);
      const mid = (top + bot) / 2;
      const d = `M${(x + lean).toFixed(1)} ${top.toFixed(1)} Q${(x + lean * 0.6 + j(4)).toFixed(1)} ${(top + (bot - top) * 0.3).toFixed(1)} ${(x + lean * 0.3 + j(2)).toFixed(1)} ${mid.toFixed(1)} T${(x + j(2)).toFixed(1)} ${bot.toFixed(1)}`;
      paths += `<path class="tm" pathLength="1" style="--i:${i}" d="${d}"/>`;
      paths += `<path class="tm-streak" d="${d}" transform="translate(${j(2).toFixed(1)} ${j(2).toFixed(1)})"/>`;
    }
    if (n >= 5) {
      const d = `M6 ${(106 + j(4)).toFixed(1)} Q${(84 + j(8)).toFixed(1)} ${(74 + j(6)).toFixed(1)} 164 ${(30 + j(5)).toFixed(1)}`;
      paths += `<path class="tm" pathLength="1" style="--i:4" d="${d}"/><path class="tm-streak" d="${d}"/>`;
    }
    return `<svg class="round-svg" viewBox="0 0 172 140" preserveAspectRatio="xMinYMax meet"><g class="chalk" filter="url(#zl-chalk)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect width="172" height="140" fill="none" stroke="none"/>${paths}</g></svg>`;
  }
  const s = String(n);
  const w = s.length * 82 + 24;
  return `<svg class="round-svg" viewBox="0 0 ${w} 140" preserveAspectRatio="xMinYMax meet"><g class="chalk" filter="url(#zl-chalk)"><rect width="${w}" height="140" fill="none"/><text class="rn" x="6" y="128" transform="skewX(-4) rotate(${j(2).toFixed(2)} 40 70)" fill="currentColor" font-size="150" font-family="Impact, Haettenschweiler, 'Arial Narrow Bold', 'Bahnschrift', sans-serif" letter-spacing="2">${s}</text></g></svg>`;
}

// Salpicadura de sangre procedural (canvas -> dataURL)
function makeSplat(seed) {
  const r = mulberry32(seed);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (!g) return '';
  const cx = 128, cy = 118;
  for (let i = 0; i < 26; i++) {
    const ang = r() * Math.PI * 2, dist = r() * 52;
    const rad = 10 + r() * 32 * (1 - dist / 90);
    const x = cx + Math.cos(ang) * dist, y = cy + Math.sin(ang) * dist;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(105,0,0,0.92)');
    grd.addColorStop(0.7, 'rgba(85,0,0,0.78)');
    grd.addColorStop(1, 'rgba(50,0,0,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgba(95,0,0,0.85)';
  for (let i = 0; i < 44; i++) {
    const ang = r() * Math.PI * 2, dist = 48 + r() * 72, rad = 1 + r() * 5;
    g.beginPath(); g.arc(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, rad, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 5; i++) {
    const x = cx + (r() - 0.5) * 80, y0 = cy + r() * 18, len = 30 + r() * 90, w = 2 + r() * 5;
    const lg = g.createLinearGradient(0, y0, 0, y0 + len);
    lg.addColorStop(0, 'rgba(90,0,0,0.85)');
    lg.addColorStop(1, 'rgba(70,0,0,0.6)');
    g.fillStyle = lg;
    g.fillRect(x - w / 2, y0, w, len);
    g.beginPath(); g.arc(x, y0 + len, w * 0.9, 0, Math.PI * 2); g.fill();
  }
  return c.toDataURL('image/png');
}

export class HUD {
  constructor(ctx) {
    this.ctx = ctx || {};
    ensureChalkDefs();
    let root = document.getElementById('hud');
    if (!root) { root = document.createElement('div'); root.id = 'hud'; document.body.appendChild(root); }
    this.root = root;
    root.innerHTML = TEMPLATE;
    root.classList.add('hud-off');
    const q = (s) => root.querySelector(s);
    this.el = {
      vignette: q('.hud-vignette'), hurt: q('.hud-hurt'), splats: q('.hud-splats'), flash: q('.hud-flash'),
      scope: q('.hud-scope'), dmgdirs: q('.hud-dmgdirs'), cross: q('.hud-crosshair'), hit: q('.hud-hitmarker'),
      downicons: q('.hud-downicons'), banner: q('.hud-banner'), bnTitle: q('.bn-title'), bnSub: q('.bn-sub'),
      puname: q('.hud-puname'), msg: q('.hud-msg'), prompt: q('.hud-prompt'), promptText: q('.hud-prompt-text'),
      progress: q('.hud-progress'), progressBar: q('.hud-progress i'), reload: q('.hud-reload'),
      downpanel: q('.hud-downpanel'), dpTitle: q('.dp-title'), dpSub: q('.dp-sub'), dpBar: q('.dp-bar i'),
      chat: q('.hud-chat'), chatFeed: q('.chat-feed'), chatInput: q('.chat-input'),
      parts: q('.hud-parts'), perks: q('.hud-perks'), round: q('.hud-round'), scores: q('.hud-scores'),
      ammo: q('.hud-ammo'), amName: q('.am-name'), amMag: q('.am-mag'), amRes: q('.am-res'), amSep: q('.am-sep'),
      amMelee: q('.am-melee'), amShield: q('.am-shield'), amShieldBar: q('.am-shield-bar i'), amNades: q('.am-nades'),
      powerups: q('.hud-powerups'), scoreboard: q('.hud-scoreboard'), dev: q('.hud-dev'),
      timer: q('.hud-timer'), tmMain: q('.tm-main'), tmSub: q('.tm-sub'),
      infect: q('.hud-infect'), health: q('.hud-health'), hpNum: q('.hp-num'), hpFill: q('.hp-fill'), hpCap: q('.hp-cap'),
      hpInf: q('.hp-inf'), hpHeal: q('.hp-heal'), hpHealT: q('.hp-heal-t'), hpHealBar: q('.hp-heal-bar i'), meds: q('.hud-meds'),
    };

    this.time = 0;
    this.debug = isDebugUrl();
    this.dev = !!this.ctx.dev;
    // Estado de la ronda
    this.roundShown = -1;
    this.roundAnimUntil = 0;
    // Puntos
    this.scoreRows = new Map();
    // Varios
    this.promptValue = null;
    this.progressValue = null;
    this.hitT = 0;
    this.hitDur = 0.2;
    this.vig = 0;
    this.hurtFlash = 0;
    this.dmgDirs = [];
    this.splats = [];
    this.splatImgs = null;
    this.msgT = 0;
    this.puT = 0;
    this.bannerT = 0;
    this.scopeOn = false;
    this.sbForced = false;
    this.sbTimer = 0;
    this.chatOpen = false;
    this.lastChatClose = 0;
    this.chatLines = [];
    this.chGap = 12;
    this.heartbeat = null;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this._cache = {};
    this._v3 = new THREE.Vector3();
    this.downIcons = new Map();
    this._lastDmg = { t: 0, x: 0, z: 0 };

    this._bindChat();
    this._bindEvents();
  }

  // ================================================================== API pública
  setPrompt(text) {
    const t = text ? String(text) : null;
    if (t === this.promptValue) return;
    this.promptValue = t;
    if (t) this.el.promptText.innerHTML = formatKeys(t);
    this.el.prompt.classList.toggle('on', !!t);
  }

  setProgress(v) {
    const val = v == null || !isFinite(v) ? null : clamp(+v, 0, 1);
    this.progressValue = val;
    this.el.progress.classList.toggle('on', val != null);
    if (val != null) this.el.progressBar.style.transform = `scaleX(${val.toFixed(3)})`;
  }

  hitmarker(kind = 'hit') {
    const h = this.el.hit;
    h.classList.remove('is-hit', 'is-kill', 'is-head');
    void h.offsetWidth; // reinicia la animación
    const k = kind === 'kill' || kind === 'head' ? kind : 'hit';
    h.classList.add('is-' + k, 'on');
    this.hitDur = k === 'hit' ? 0.2 : 0.34;
    this.hitT = this.hitDur;
    sfx(this.ctx, k === 'hit' ? 'hitmarker' : 'kill');
  }

  damage(fromX, fromZ) {
    if (!isFinite(fromX) || !isFinite(fromZ)) return;
    const now = performance.now();
    const L = this._lastDmg;
    if (now - L.t < 60 && Math.abs(L.x - fromX) < 0.3 && Math.abs(L.z - fromZ) < 0.3) return;
    L.t = now; L.x = fromX; L.z = fromZ;
    const el = document.createElement('div');
    el.className = 'dmg-dir';
    el.innerHTML = '<svg viewBox="0 0 200 200"><path d="M58 22 A92 92 0 0 1 142 22 L130 44 A70 70 0 0 0 70 44 Z" fill="url(#zlDmgGrad)"/></svg>';
    this.el.dmgdirs.appendChild(el);
    this.dmgDirs.push({ el, x: fromX, z: fromZ, life: 1.7 });
    while (this.dmgDirs.length > 6) { const d = this.dmgDirs.shift(); d.el.remove(); }
    this._placeDmgDir(this.dmgDirs[this.dmgDirs.length - 1]);
  }

  message(text, seconds = 2.5) {
    if (!text) return;
    this.el.msg.textContent = String(text);
    this.el.msg.classList.remove('on');
    void this.el.msg.offsetWidth;
    this.el.msg.classList.add('on');
    this.msgT = Math.max(0.5, +seconds || 2.5);
  }

  setScope(on) {
    this.scopeOn = !!on;
    this.el.scope.classList.toggle('on', this.scopeOn);
  }

  showScoreboard(on) {
    this.sbForced = !!on;
  }

  // Extra (no forma parte del contrato): cierra el chat si está abierto
  closeChat() { this._closeChat(false); }

  // ================================================================== eventos
  _on(name, fn) {
    const ev = this.ctx.events;
    if (!ev || typeof ev.on !== 'function') return;
    ev.on(name, (p) => {
      try { fn(p || {}); } catch (e) { console.error('[HUD] Error en', name, e); }
    });
  }

  _isSelf(pid) {
    return pid != null && this.ctx.selfId != null && Number(pid) === Number(this.ctx.selfId);
  }

  _player(pid) {
    const gs = this.ctx.gs;
    return gs && gs.players ? gs.players[pid] || null : null;
  }

  _name(pid) {
    const p = this._player(pid);
    return p && p.name ? String(p.name) : `Jugador ${pid}`;
  }

  _bindEvents() {
    this._on('welcome', (w) => { this.dev = !!(w.dev || this.ctx.dev); });

    this._on('ev:pts', (e) => {
      if (e.pid != null && !this._isSelf(e.pid)) return;
      const n = Math.round(+e.n || 0);
      if (n) this._floatPoints(this.ctx.selfId, n, true);
    });

    this._on('gs', ({ gs, prev }) => {
      if (!gs || !prev || gs.phase !== 'playing' || !gs.players || !prev.players) return;
      for (const id of Object.keys(gs.players)) {
        if (this._isSelf(id)) continue;
        const a = prev.players[id], b = gs.players[id];
        if (!a || !b) continue;
        const d = (b.points | 0) - (a.points | 0);
        if (d) this._floatPoints(id, d, false);
      }
    });

    this._on('ev:roundStart', (e) => this._roundStart(+e.round || (this.ctx.gs && this.ctx.gs.round) || 1));
    this._on('ev:roundEnd', () => this._roundEnd());

    this._on('ev:pu', (e) => {
      const info = POWERUP_INFO[e.type];
      if (info) this._showPowerupName(info.name);
      if (e.type === 'nuke') this._flash('#fff8e0', 1.4);
      else this._flash('rgba(120,255,140,0.35)', 0.5);
    });

    this._on('ev:down', (e) => {
      if (this._isSelf(e.pid)) {
        sfx(this.ctx, 'down');
        this._flash('rgba(160,0,0,0.6)', 0.9);
        this.setScope(false);
      } else {
        const p = this._player(e.pid);
        this._banner(`${this._name(e.pid)} ha caído`, '¡Reanímalo antes de que se desangre!', p && p.color);
      }
    });

    this._on('ev:revived', (e) => {
      const self = this._isSelf(e.pid);
      if (self) {
        sfx(this.ctx, 'revive');
        this.message(e.by == null ? 'Te has reanimado con Quick Revive' : `${this._name(e.by)} te ha reanimado`, 3);
      } else if (this._isSelf(e.by)) {
        sfx(this.ctx, 'revive');
        this.message(`Has reanimado a ${this._name(e.pid)}`, 3);
      } else {
        this.message(e.by == null ? `${this._name(e.pid)} se ha reanimado` : `${this._name(e.by)} ha reanimado a ${this._name(e.pid)}`, 3);
      }
    });

    this._on('ev:bleedout', (e) => {
      if (this._isSelf(e.pid)) this._banner('Te has desangrado', 'Reaparecerás al comienzo de la próxima ronda', '#ff4040');
      else this._banner(`${this._name(e.pid)} se ha desangrado`, 'Volverá en la próxima ronda', this._player(e.pid) && this._player(e.pid).color);
    });

    this._on('ev:respawn', (e) => {
      if (!this._isSelf(e.pid)) return;
      this.vig = 0;
      this.hurtFlash = 0;
      for (const s of this.splats) s.el.remove();
      this.splats.length = 0;
    });

    this._on('ev:chat', (e) => this._addChat(e));
    this._on('ev:deny', (e) => {
      sfx(this.ctx, 'deny');
      this.message(DENY_TEXT[e.reason] || 'No puedes hacer eso ahora', 2.2);
    });
    this._on('ev:msg', (e) => { if (e.text) this.message(e.text, 3); });

    this._on('local:damage', (e) => {
      this.damage(+e.fromX, +e.fromZ);
      this.hurtFlash = Math.min(1, this.hurtFlash + 0.55);
      this._spawnSplat(1 + (Math.random() < 0.4 ? 1 : 0));
      sfx(this.ctx, 'hurt');
    });

    this._on('ev:power', () => this.message('¡Electricidad activada!', 3));
    this._on('ev:tank', () => {
      this._flash('rgba(120,0,0,0.35)', 0.8);
      this._banner('¡Un Tanque se acerca!', 'Mucha vida y golpes brutales · Mantén la distancia', '#ff3b30');
    });
    this._on('ev:infected', (e) => {
      if (!this._isSelf(e.pid)) return;
      this._flash('rgba(90,220,70,0.35)', 0.9);
      this._banner('¡Estás infectado!', 'Pierdes salud poco a poco · Pulsa H para usar un antídoto o un botiquín', '#6fe04a');
    });
    this._on('ev:healed', (e) => {
      if (!this._isSelf(e.pid)) return;
      const def = MEDS[e.item];
      sfx(this.ctx, 'revive');
      this._flash('rgba(255,255,255,0.18)', 0.5);
      if (def) this.message(def.cures ? `${def.name}: infección curada` : `${def.name}: +${def.heal} de salud`, 2);
    });
    this._on('ev:itemPick', (e) => {
      if (!this._isSelf(e.pid)) return;
      const def = MEDS[e.type];
      if (def) this.message(`Has recogido: ${def.name}`, 1.8);
    });
    this._on('ev:boxMove', () => this.message('La Caja Misteriosa se ha movido a otro lugar', 3.5));
    this._on('ev:part', (e) => {
      const part = SHIELD_PARTS.find((p) => p.id === +e.id);
      const gs = this.ctx.gs;
      const have = gs && gs.shield && Array.isArray(gs.shield.parts) ? gs.shield.parts.filter(Boolean).length : 0;
      const who = this._isSelf(e.pid) ? 'Has recogido' : `${this._name(e.pid)} ha recogido`;
      this.message(`${who}: ${part ? part.name : 'pieza del escudo'} (${Math.max(have, 1)}/3)`, 3);
    });
    this._on('ev:built', (e) => this.message(this._isSelf(e.pid) ? 'Has construido el Escudo Antidisturbios' : `${this._name(e.pid)} ha construido el Escudo Antidisturbios`, 3));
    this._on('ev:shieldBreak', (e) => { if (this._isSelf(e.pid)) this.message('¡Tu escudo se ha roto!', 2.5); });

    this._on('ev:gameover', () => { this._closeChat(false); this.setScope(false); this.setPrompt(null); this.setProgress(null); });

    this._on('phase', ({ phase }) => {
      if (phase !== 'playing') {
        this._closeChat(false);
        this.setScope(false);
        this.setPrompt(null);
        this.setProgress(null);
        this._stopHeartbeat();
        document.body.classList.remove('zl-down', 'zl-dead');
      }
      if (phase === 'lobby') this._resetMatch();
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('pointerlockchange', () => {
        if (!document.pointerLockElement && this.chatOpen && !this.debug) this._closeChat(false);
      });
    }
  }

  _resetMatch() {
    this.roundShown = -1;
    this.roundAnimUntil = 0;
    this.el.round.innerHTML = '';
    this.el.round.className = 'hud-round';
    for (const d of this.dmgDirs) d.el.remove();
    this.dmgDirs.length = 0;
    for (const s of this.splats) s.el.remove();
    this.splats.length = 0;
    for (const [, row] of this.scoreRows) row.el.remove();
    this.scoreRows.clear();
    for (const [, ic] of this.downIcons) ic.remove();
    this.downIcons.clear();
    this.vig = 0;
    this.hurtFlash = 0;
    this._cache = {};
  }

  // ================================================================== bucle
  update(dt) {
    const ctx = this.ctx;
    dt = Math.min(0.1, Math.max(0, +dt || 0));
    this.time += dt;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) { this.fps = Math.round(this.fpsFrames / this.fpsTime); this.fpsFrames = 0; this.fpsTime = 0; }

    const gs = ctx.gs;
    let self = null;
    try { self = ctx.self; } catch { self = null; }
    const playing = !!gs && gs.phase === 'playing';
    this.root.classList.toggle('hud-off', !playing);
    this._updateDev(gs);
    if (!playing) {
      this._stopHeartbeat();
      return;
    }
    const now = serverNow(ctx);
    const menusOpen = !!(ctx.menus && ctx.menus.isOpen);

    this._updateChatInput(menusOpen);
    this._updateRound(gs);
    this._updateTimer(gs, now);
    this._updateScores(gs);
    this._updatePerks(self);
    this._updateParts(gs);
    const info = this._updateAmmo(self);
    this._updateReloadHint(self, info);
    this._updatePowerups(gs, now);
    this._updateCrosshair(self, dt, menusOpen);
    this._updateHitmarker(dt);
    this._updateHealth(self, dt);
    this._updateVitals(self, now);
    this._updateDamageDirs(dt);
    this._updateSplats(dt);
    this._updateDownState(self, gs, now);
    this._updateDownIcons(gs, now);
    this._updateTimedTexts(dt);
    this._updateScoreboard(gs, dt);
    this._updateChatFeed(dt);
    if (self && self.state !== 'alive' && this.promptValue) this.setPrompt(null);
  }

  // ------------------------------------------------------------------ ronda
  _renderRound(n, anim) {
    const el = this.el.round;
    el.innerHTML = roundSVG(n);
    el.classList.remove('is-start', 'is-end');
    if (anim) { void el.offsetWidth; el.classList.add('is-start'); }
    this.roundShown = n;
  }

  _roundStart(round) {
    this._renderRound(round, true);
    this.roundAnimUntil = performance.now() + 4500;
    try { if (this.ctx.audio && this.ctx.audio.music) this.ctx.audio.music('round_start'); } catch { /* nada */ }
  }

  _roundEnd() {
    this.el.round.classList.remove('is-start');
    this.el.round.classList.add('is-end');
    this.roundAnimUntil = performance.now() + 12000;
    try { if (this.ctx.audio && this.ctx.audio.music) this.ctx.audio.music('round_end'); } catch { /* nada */ }
  }

  _updateRound(gs) {
    const r = gs.round | 0;
    const animating = performance.now() < this.roundAnimUntil;
    if (r !== this.roundShown && !animating) this._renderRound(r, false);
    if (!animating && this.el.round.classList.contains('is-end') && gs.roundState === 'active') this.el.round.classList.remove('is-end');
  }

  // ------------------------------------------------------------------ puntos
  _updateScores(gs) {
    const players = gs.players || {};
    const ids = Object.keys(players);
    const selfKey = this.ctx.selfId != null ? String(this.ctx.selfId) : null;
    // Orden: compañeros arriba, el jugador local abajo (más grande)
    ids.sort((a, b) => (a === selfKey ? 1 : b === selfKey ? -1 : (+a) - (+b)));
    const orderKey = ids.join(',');
    for (const id of ids) {
      const p = players[id];
      let row = this.scoreRows.get(id);
      if (!row) {
        const el = document.createElement('div');
        el.className = 'score-row';
        el.innerHTML = '<span class="sc-floats"></span><span class="sc-name"></span><span class="sc-val"></span>';
        row = { el, val: el.querySelector('.sc-val'), name: el.querySelector('.sc-name'), floats: el.querySelector('.sc-floats'), shown: null, color: null, state: null };
        this.scoreRows.set(id, row);
        this._cache.scoreOrder = null;
      }
      const isSelf = id === selfKey;
      row.el.classList.toggle('is-self', isSelf);
      const col = safeColor(p.color);
      if (row.color !== col) { row.color = col; row.el.style.setProperty('--pc', col); }
      const pts = p.points | 0;
      if (row.shown !== pts) { row.shown = pts; row.val.textContent = pts.toLocaleString('es'); }
      const nm = isSelf ? '' : String(p.name || '');
      if (row.name.textContent !== nm) row.name.textContent = nm;
      if (row.state !== p.state) {
        row.state = p.state;
        row.el.classList.toggle('is-down', p.state === 'down');
        row.el.classList.toggle('is-dead', p.state === 'dead');
      }
    }
    for (const [id, row] of this.scoreRows) {
      if (!players[id]) { row.el.remove(); this.scoreRows.delete(id); this._cache.scoreOrder = null; }
    }
    if (this._cache.scoreOrder !== orderKey) {
      this._cache.scoreOrder = orderKey;
      for (const id of ids) this.el.scores.appendChild(this.scoreRows.get(id).el);
    }
  }

  _floatPoints(pid, n, big) {
    const row = this.scoreRows.get(String(pid));
    if (!row) return;
    const f = document.createElement('span');
    f.className = 'pts-float' + (n < 0 ? ' neg' : '') + (big ? ' big' : '');
    f.textContent = (n > 0 ? '+' : '−') + Math.abs(n);
    f.style.setProperty('--dy', `${(Math.random() * 2 - 1) * 0.9}em`);
    f.style.setProperty('--dx', `${-(2.2 + Math.random() * 1.6)}em`);
    row.floats.appendChild(f);
    setTimeout(() => f.remove(), 1300);
    while (row.floats.childElementCount > 8) row.floats.firstElementChild.remove();
  }

  // ------------------------------------------------------------------ ventajas y piezas
  _updatePerks(self) {
    const perks = self && Array.isArray(self.perks) ? self.perks : [];
    const key = perks.join(',');
    if (this._cache.perks === key) return;
    const prev = new Set((this._cache.perks || '').split(',').filter(Boolean));
    this._cache.perks = key;
    this.el.perks.innerHTML = perks.map((k) => {
      const p = PERKS[k];
      const col = safeColor(p ? p.color : '#888888', '#888888');
      const fresh = prev.has(k) ? '' : ' fresh';
      return `<div class="perk-icon${fresh}" style="--pk:${col}" title="${esc(p ? p.name : k)}"><span>${esc(p ? p.icon : k.slice(0, 2).toUpperCase())}</span></div>`;
    }).join('');
  }

  _updateParts(gs) {
    const sh = gs.shield || {};
    const parts = Array.isArray(sh.parts) ? sh.parts : [];
    const any = parts.some(Boolean);
    const key = sh.built ? 'built' : parts.map((p) => (p ? 1 : 0)).join('');
    if (this._cache.parts === key) return;
    this._cache.parts = key;
    if (sh.built || !any) { this.el.parts.innerHTML = ''; this.el.parts.classList.remove('on'); return; }
    this.el.parts.classList.add('on');
    this.el.parts.innerHTML = '<span class="parts-label">Escudo</span>' + SHIELD_PARTS.map((p, i) =>
      `<span class="part-slot${parts[i] ? ' got' : ''}" title="${esc(p.name)}">${ICONS.part}</span>`).join('');
  }

  // ------------------------------------------------------------------ munición
  _hudInfo(self) {
    const w = this.ctx.weapons;
    let info = null;
    if (w && typeof w.hudInfo === 'function') {
      try { info = w.hudInfo(); } catch { info = null; }
    }
    if (!info && self) {
      const cw = Array.isArray(self.weapons) ? self.weapons[self.cur | 0] : null;
      info = {
        name: cw ? weaponName(cw.k, !!cw.up) : null, key: cw ? cw.k : null, up: cw ? !!cw.up : false,
        mag: null, reserve: null, grenades: self.grenades, shieldHp: self.shield ? self.shield.hp : null,
        shieldOut: false, lowAmmo: false, noAmmo: false, melee: self.melee,
      };
    }
    return info;
  }

  _updateAmmo(self) {
    const info = this._hudInfo(self);
    const el = this.el;
    const dead = !self || self.state === 'dead';
    el.ammo.classList.toggle('off', dead || !info);
    if (dead || !info) return info;
    const num = (v) => (v == null || !isFinite(v) ? '—' : String(Math.max(0, v | 0)));
    const nades = info.grenades != null ? info.grenades : (self.grenades | 0);
    const shieldHp = info.shieldHp != null ? info.shieldHp : (self.shield ? self.shield.hp : null);
    const melee = info.melee || self.melee || 'knife';
    const key = [info.name, info.up, info.mag, info.reserve, nades, shieldHp, info.shieldOut, info.lowAmmo, info.noAmmo, melee, self.state].join('|');
    if (this._cache.ammo === key) return info;
    this._cache.ammo = key;
    el.amName.textContent = info.name || 'Sin arma';
    el.amName.classList.toggle('is-up', !!info.up);
    const hasGun = !!info.name && info.mag != null;
    el.amMag.textContent = num(info.mag);
    el.amRes.textContent = num(info.reserve);
    el.ammo.querySelector('.am-count').classList.toggle('off', !info.name);
    el.amMag.classList.toggle('low', hasGun && (!!info.lowAmmo || !!info.noAmmo));
    el.amRes.classList.toggle('low', hasGun && info.reserve === 0);
    const n = clamp(nades | 0, 0, 4);
    el.amNades.innerHTML = ICONS.nade.repeat(n);
    el.amNades.classList.toggle('empty', n === 0);
    const hasShield = shieldHp != null && shieldHp > 0;
    el.amShield.classList.toggle('on', hasShield);
    el.amShield.classList.toggle('out', !!info.shieldOut);
    if (hasShield) {
      const f = clamp(shieldHp / 1500, 0, 1);
      el.amShieldBar.style.transform = `scaleX(${f.toFixed(3)})`;
      el.amShield.classList.toggle('low', f < 0.3);
    }
    el.amMelee.innerHTML = melee && melee !== 'knife' ? `${ICONS.knife}<span>${esc(meleeStats(melee).name)}</span>` : '';
    return info;
  }

  _updateReloadHint(self, info) {
    let hint = '';
    if (info && self && self.state !== 'dead' && info.name && info.mag != null) {
      const w = this.ctx.weapons;
      const reloading = !!(w && w.isReloading);
      if (info.noAmmo) hint = 'Sin munición';
      else if (!reloading && (info.lowAmmo || info.mag === 0) && info.reserve > 0) hint = 'Pulsa R para recargar';
      else if (!reloading && info.lowAmmo && info.reserve === 0) hint = 'Poca munición';
    }
    if (this._cache.reload === hint) return;
    this._cache.reload = hint;
    this.el.reload.innerHTML = hint ? formatKeys(hint) : '';
    this.el.reload.classList.toggle('on', !!hint);
    this.el.reload.classList.toggle('warn', hint === 'Sin munición');
  }

  // ------------------------------------------------------------------ potenciadores activos
  _updatePowerups(gs, now) {
    const timers = gs.timers || {};
    const list = [];
    for (const k of ['instakill', 'doublepoints', 'firesale']) {
      const until = +timers[k] || 0;
      const rem = until - now;
      if (until > 0 && rem > 0) list.push([k, rem]);
    }
    const key = list.map(([k, rem]) => `${k}:${Math.ceil(rem / 1000)}:${rem < 5000 ? 1 : 0}`).join(',');
    if (this._cache.pu === key) return;
    const prevKinds = (this._cache.puKinds || '');
    const kinds = list.map(([k]) => k).join(',');
    this._cache.pu = key;
    if (prevKinds !== kinds) {
      this._cache.puKinds = kinds;
      this.el.powerups.innerHTML = list.map(([k]) =>
        `<div class="pu-icon pu-${k}" data-k="${k}"><div class="pu-glyph">${ICONS[k]}</div><div class="pu-time"></div></div>`).join('');
    }
    for (const [k, rem] of list) {
      const el = this.el.powerups.querySelector(`[data-k="${k}"]`);
      if (!el) continue;
      el.querySelector('.pu-time').textContent = `${Math.ceil(rem / 1000)}`;
      el.classList.toggle('blink', rem < 5000);
    }
  }

  // ------------------------------------------------------------------ cruz y hitmarker
  _updateCrosshair(self, dt, menusOpen) {
    const ctx = this.ctx;
    const w = ctx.weapons;
    let show = !!self && self.state !== 'dead' && !this.scopeOn && !menusOpen;
    if (ctx.player && ctx.player.isSprinting) show = false;
    if (w && w.isDrinking) show = false;
    let ads = 0;
    if (w && typeof w.adsAmount === 'number') ads = clamp(w.adsAmount, 0, 1);
    let spread = 3;
    if (w && typeof w.spreadDeg === 'function') {
      try { const s = +w.spreadDeg(); if (isFinite(s)) spread = s; } catch { /* nada */ }
    }
    const fov = (ctx.camera && ctx.camera.fov) || 75;
    const h = window.innerHeight || 720;
    const px = (Math.tan((clamp(spread, 0, 30) * Math.PI) / 180) / Math.tan((fov * Math.PI) / 360)) * (h / 2);
    const target = clamp(px, 3, h * 0.4);
    this.chGap += (target - this.chGap) * Math.min(1, dt * 16);
    const op = show ? clamp(1 - ads * 1.7, 0, 1) : 0;
    const k = `${this.chGap.toFixed(1)}|${op.toFixed(2)}|${w && w.isShieldOut ? 1 : 0}`;
    if (this._cache.cross === k) return;
    this._cache.cross = k;
    this.el.cross.style.setProperty('--gap', `${this.chGap.toFixed(1)}px`);
    this.el.cross.style.opacity = op.toFixed(2);
    this.el.cross.classList.toggle('shield', !!(w && w.isShieldOut));
  }

  _updateHitmarker(dt) {
    if (this.hitT <= 0) return;
    this.hitT -= dt;
    if (this.hitT <= 0) this.el.hit.classList.remove('on');
  }

  // ------------------------------------------------------------------ salud, daño y sangre
  _updateHealth(self, dt) {
    let target = 0;
    let hpFrac = 1;
    if (self) {
      const maxHp = +self.maxHp || PLAYER.health;
      hpFrac = clamp((+self.hp || 0) / maxHp, 0, 1);
      if (self.state === 'alive') target = Math.pow(1 - hpFrac, 1.25) * 0.95;
      else if (self.state === 'down') target = 0.72;
    }
    this.vig += (target - this.vig) * Math.min(1, dt * 4);
    let v = this.vig;
    if (self && self.state === 'alive' && hpFrac < 0.4) v += 0.12 * (0.5 + 0.5 * Math.sin(this.time * 7));
    if (self && self.state === 'down') v += 0.1 * (0.5 + 0.5 * Math.sin(this.time * 3.2));
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    this.el.vignette.style.opacity = clamp(v, 0, 1).toFixed(3);
    this.el.hurt.style.opacity = this.hurtFlash.toFixed(3);
    // Latido con poca salud
    if (self && self.state === 'alive' && hpFrac < 0.35) this._startHeartbeat();
    else this._stopHeartbeat();
  }

  // Contador de ronda: tiempo transcurrido en la ronda activa y cuenta atrás de la preparación
  _updateTimer(gs, now) {
    const el = this.el;
    const fmt = (ms) => {
      const s = Math.max(0, Math.floor(ms / 1000));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    let main = '', sub = '', mode = '';
    if (gs.roundState === 'active' && gs.roundStartAt) {
      mode = 'active';
      main = `Ronda ${gs.round} · ${fmt(now - gs.roundStartAt)}`;
    } else if ((gs.roundState === 'pre' || gs.roundState === 'intermission') && gs.roundUntil) {
      mode = 'count';
      const left = gs.roundUntil - now;
      const secs = Math.max(0, Math.ceil(left / 1000));
      main = `${gs.round > 0 ? 'Siguiente ronda' : 'La partida empieza'} en <b>${secs}</b>`;
      if (gs.round > 0 && gs.lastRoundTime) sub = `Ronda ${gs.round} superada en ${fmt(gs.lastRoundTime)}`;
      // aviso sonoro en los últimos 3 segundos
      if (secs > 0 && secs <= 3 && this._lastTick !== secs) { this._lastTick = secs; sfx(this.ctx, 'round_tick'); }
      if (secs > 3) this._lastTick = null;
      el.timer.classList.toggle('urgent', secs <= 3);
    }
    const key = `${mode}|${main}|${sub}`;
    if (this._cache.timer === key) return;
    this._cache.timer = key;
    el.timer.classList.toggle('on', !!mode);
    el.timer.classList.toggle('count', mode === 'count');
    if (mode !== 'count') el.timer.classList.remove('urgent');
    el.tmMain.innerHTML = main;
    el.tmSub.textContent = sub;
  }

  // Barra de salud, infección, curas en el inventario y progreso de la cura en uso
  _updateVitals(self, now) {
    const el = this.el;
    const alive = !!self && self.state === 'alive';
    el.health.classList.toggle('on', alive);
    const inf = alive && !!self.infected;
    el.infect.style.opacity = inf ? (0.32 + 0.14 * Math.sin(this.time * 2.6)).toFixed(3) : '0';
    if (!alive) return;
    const maxHp = +self.maxHp || PLAYER.health;
    const hp = Math.max(0, Math.round(+self.hp || 0));
    const f = clamp(hp / maxHp, 0, 1);
    const c = this._cache;
    const key = `${hp}|${maxHp}|${inf}`;
    if (c.vitals !== key) {
      c.vitals = key;
      el.hpNum.textContent = `${hp} / ${maxHp}`;
      el.hpFill.style.transform = `scaleX(${f.toFixed(3)})`;
      el.hpCap.style.left = `${(PLAYER.regenCap * 100).toFixed(1)}%`;
      el.health.classList.toggle('low', f < 0.35);
      el.health.classList.toggle('inf', inf);
    }
    // curas
    const meds = self.meds || {};
    const mkey = MED_KEYS.map((k) => meds[k] | 0).join(',');
    if (c.meds !== mkey) {
      c.meds = mkey;
      el.meds.innerHTML = MED_KEYS.map((k) => {
        const n = meds[k] | 0;
        return `<span class="med ${n ? '' : 'none'}" style="--mc:${MEDS[k].color}"><i></i>${esc(MEDS[k].name)} <b>${n}</b></span>`;
      }).join('') + '<span class="med-key">H</span>';
    }
    // cura en curso
    const h = self.healing && MEDS[self.healing.item] ? self.healing : null;
    el.hpHeal.classList.toggle('on', !!h);
    if (h) {
      const def = MEDS[h.item];
      const p = clamp(1 - ((+h.until || now) - now) / (def.useTime * 1000), 0, 1);
      if (c.healT !== h.item) { c.healT = h.item; el.hpHealT.textContent = `Usando: ${def.name}`; }
      el.hpHealBar.style.transform = `scaleX(${p.toFixed(3)})`;
    } else c.healT = null;
  }

  _startHeartbeat() {
    if (this.heartbeat) return;
    try {
      if (this.ctx.audio && typeof this.ctx.audio.play === 'function') {
        const h = this.ctx.audio.play('heartbeat', { loop: true });
        this.heartbeat = h && typeof h.stop === 'function' ? h : null;
      }
    } catch { this.heartbeat = null; }
  }

  _stopHeartbeat() {
    if (!this.heartbeat) return;
    try { this.heartbeat.stop(); } catch { /* nada */ }
    this.heartbeat = null;
  }

  _placeDmgDir(d) {
    const p = this.ctx.player;
    let px = null, pz = null, yaw = 0;
    if (p && p.position) { px = p.position.x; pz = p.position.z; yaw = +p.yaw || 0; }
    if (px == null) { d.el.style.transform = 'translate(-50%,-50%)'; return; }
    const ang = yawTo(px, pz, d.x, d.z);
    const rel = angleDiff(yaw, ang); // > 0: a la izquierda
    d.el.style.transform = `translate(-50%,-50%) rotate(${(-rel).toFixed(3)}rad)`;
  }

  _updateDamageDirs(dt) {
    for (let i = this.dmgDirs.length - 1; i >= 0; i--) {
      const d = this.dmgDirs[i];
      d.life -= dt;
      if (d.life <= 0) { d.el.remove(); this.dmgDirs.splice(i, 1); continue; }
      this._placeDmgDir(d);
      d.el.style.opacity = Math.min(1, d.life / 0.7).toFixed(3);
    }
  }

  _spawnSplat(count = 1) {
    if (!this.splatImgs) {
      this.splatImgs = [];
      for (let i = 0; i < 4; i++) { const u = makeSplat(1234 + i * 977); if (u) this.splatImgs.push(u); }
    }
    if (!this.splatImgs.length) return;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'splat';
      // Cerca de los bordes, nunca en el centro de la pantalla
      let x, y;
      do { x = 4 + Math.random() * 92; y = 4 + Math.random() * 88; } while (x > 28 && x < 72 && y > 22 && y < 78);
      const size = 16 + Math.random() * 14;
      el.style.left = `${x}%`;
      el.style.top = `${y}%`;
      el.style.setProperty('--sz', `${size.toFixed(1)}`);
      el.style.backgroundImage = `url(${this.splatImgs[(Math.random() * this.splatImgs.length) | 0]})`;
      el.style.transform = `translate(-50%,-50%) rotate(${(Math.random() * 360) | 0}deg)`;
      this.el.splats.appendChild(el);
      this.splats.push({ el, life: 2.8 + Math.random() });
    }
    while (this.splats.length > 9) { const s = this.splats.shift(); s.el.remove(); }
  }

  _updateSplats(dt) {
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      s.life -= dt;
      if (s.life <= 0) { s.el.remove(); this.splats.splice(i, 1); continue; }
      s.el.style.opacity = Math.min(1, s.life / 1.2).toFixed(3);
    }
  }

  // ------------------------------------------------------------------ caído / muerto
  _updateDownState(self, gs, now) {
    const st = self ? self.state : null;
    document.body.classList.toggle('zl-down', st === 'down');
    document.body.classList.toggle('zl-dead', st === 'dead');
    const el = this.el;
    let title = '', sub = '', frac = null, kind = '';
    if (st === 'down') {
      const reviver = self.reviver != null ? gs.players[self.reviver] : null;
      if (reviver && self.reviveUntil > now) {
        const qr = Array.isArray(reviver.perks) && reviver.perks.includes('quickrevive');
        const total = PLAYER.reviveTime * (qr ? 0.5 : 1) * 1000;
        frac = clamp(1 - (self.reviveUntil - now) / total, 0, 1);
        title = 'Te están reanimando';
        sub = String(reviver.name || '');
        kind = 'revive';
      } else if (self.selfReviveAt > 0) {
        const total = PLAYER.soloQuickReviveTime * 1000;
        const rem = Math.max(0, self.selfReviveAt - now);
        frac = clamp(1 - rem / total, 0, 1);
        title = 'Quick Revive';
        sub = `Te levantarás en ${Math.ceil(rem / 1000)} s`;
        kind = 'qr';
      } else {
        const total = PLAYER.bleedoutTime * 1000;
        const rem = Math.max(0, (+self.bleedUntil || now) - now);
        frac = clamp(rem / total, 0, 1);
        const others = Object.values(gs.players || {}).filter((p) => !this._isSelf(p.id) && p.state === 'alive').length;
        title = 'Has caído';
        sub = others > 0 ? `Te desangras en ${Math.ceil(rem / 1000)} s · Espera a que un compañero te reanime` : `Te desangras en ${Math.ceil(rem / 1000)} s`;
        kind = 'bleed';
      }
    } else if (st === 'dead') {
      title = 'Has muerto';
      sub = 'Reaparecerás al comienzo de la próxima ronda · Modo espectador: haz clic para cambiar de jugador';
      kind = 'dead';
    }
    const key = `${title}|${sub}|${kind}`;
    if (this._cache.down !== key) {
      this._cache.down = key;
      el.downpanel.classList.toggle('on', !!title);
      el.downpanel.dataset.kind = kind;
      el.dpTitle.textContent = title;
      el.dpSub.textContent = sub;
    }
    el.downpanel.classList.toggle('has-bar', frac != null);
    if (frac != null) el.dpBar.style.transform = `scaleX(${frac.toFixed(3)})`;
  }

  _updateDownIcons(gs, now) {
    const ctx = this.ctx;
    const cam = ctx.camera;
    const ents = ctx.entities;
    const seen = new Set();
    const W = window.innerWidth || 1280, H = window.innerHeight || 720;
    const me = ctx.player && ctx.player.position ? ctx.player.position : null;
    if (cam && ents && typeof ents.getPlayerVisual === 'function') {
      for (const [id, p] of Object.entries(gs.players || {})) {
        if (this._isSelf(id) || p.state !== 'down') continue;
        let vis = null;
        try { vis = ents.getPlayerVisual(+id); } catch { vis = null; }
        if (!vis || !vis.position) continue;
        seen.add(id);
        let ic = this.downIcons.get(id);
        if (!ic) {
          ic = document.createElement('div');
          ic.className = 'down-icon';
          ic.innerHTML = `<div class="di-ring"></div><div class="di-glyph">${ICONS.revive}</div><div class="di-name"></div><div class="di-dist"></div>`;
          this.el.downicons.appendChild(ic);
          this.downIcons.set(id, ic);
        }
        const v = this._v3.set(vis.position.x, (vis.position.y || 0) + 1.1, vis.position.z);
        v.project(cam);
        let x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
        const behind = v.z > 1;
        if (behind) { x = W - x; y = H - y; }
        const m = 48;
        let edge = behind;
        if (x < m || x > W - m || y < m || y > H - m) edge = true;
        if (behind) y = H - m * 2; // detrás: pegado al borde inferior
        x = clamp(x, m, W - m);
        y = clamp(y, m, H - m);
        ic.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
        ic.classList.toggle('edge', edge);
        ic.classList.toggle('reviving', p.reviver != null && p.reviveUntil > now);
        ic.style.setProperty('--pc', safeColor(p.color));
        const total = PLAYER.bleedoutTime * 1000;
        const f = clamp(((+p.bleedUntil || now) - now) / total, 0, 1);
        ic.style.setProperty('--f', f.toFixed(3));
        const nm = String(p.name || '');
        const nameEl = ic.querySelector('.di-name');
        if (nameEl.textContent !== nm) nameEl.textContent = nm;
        const dist = me ? Math.round(Math.hypot(vis.position.x - me.x, vis.position.z - me.z)) : null;
        const dEl = ic.querySelector('.di-dist');
        const dt = dist != null ? `${dist} m` : '';
        if (dEl.textContent !== dt) dEl.textContent = dt;
      }
    }
    for (const [id, ic] of this.downIcons) {
      if (!seen.has(id)) { ic.remove(); this.downIcons.delete(id); }
    }
  }

  // ------------------------------------------------------------------ textos temporales
  _showPowerupName(name) {
    const el = this.el.puname;
    el.textContent = name;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    this.puT = 2.6;
  }

  _banner(title, sub, color) {
    const el = this.el.banner;
    this.el.bnTitle.textContent = title || '';
    this.el.bnSub.textContent = sub || '';
    el.style.setProperty('--bc', safeColor(color, '#ff3b30'));
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    this.bannerT = 3.5;
  }

  _flash(color, seconds = 1) {
    const el = this.el.flash;
    el.style.background = color;
    el.style.setProperty('--fd', `${seconds}s`);
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  _updateTimedTexts(dt) {
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.el.msg.classList.remove('on'); }
    if (this.puT > 0) { this.puT -= dt; if (this.puT <= 0) this.el.puname.classList.remove('on'); }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.el.banner.classList.remove('on'); }
  }

  // ------------------------------------------------------------------ tabla de puntuación
  _updateScoreboard(gs, dt) {
    const inp = this.ctx.input;
    let down = false;
    try { down = !!(inp && typeof inp.isDown === 'function' && inp.isDown('scoreboard')); } catch { down = false; }
    const on = (down || this.sbForced) && !this.chatOpen;
    this.el.scoreboard.classList.toggle('on', on);
    if (!on) { this.sbTimer = 0; return; }
    this.sbTimer -= dt;
    if (this.sbTimer > 0) return;
    this.sbTimer = 0.3;
    const players = Object.values(gs.players || {}).sort((a, b) => (b.points | 0) - (a.points | 0));
    const rows = players.map((p) => {
      const col = safeColor(p.color);
      const me = this._isSelf(p.id) ? ' me' : '';
      const st = p.state === 'down' ? '<span class="sb-st down">caído</span>' : p.state === 'dead' ? '<span class="sb-st dead">muerto</span>' : '';
      return `<tr class="sb-row${me}" style="--pc:${col}"><td class="sb-name"><i class="sb-dot"></i>${esc(p.name || 'Jugador')}${p.host ? '<span class="sb-host">anfitrión</span>' : ''}${st}</td>` +
        `<td>${(p.points | 0).toLocaleString('es')}</td><td>${p.kills | 0}</td><td>${p.headshots | 0}</td><td>${p.downs | 0}</td><td>${p.revives | 0}</td><td class="sb-ping">${Math.round(+p.ping || 0)} ms</td></tr>`;
    }).join('');
    const zl = gs.zLeft != null ? `<span class="sb-zl">Zombis restantes: ${gs.zLeft | 0}</span>` : '';
    this.el.scoreboard.innerHTML = `
      <div class="sb-head"><span class="sb-round">Ronda ${gs.round | 0}</span><span class="sb-map">${esc(MAP_NAME)}</span>${this.dev ? zl : ''}</div>
      <table class="sb-table"><thead><tr><th>Jugador</th><th>Puntos</th><th>Bajas</th><th>A la cabeza</th><th>Caídas</th><th>Reanimaciones</th><th>Ping</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ------------------------------------------------------------------ chat
  _bindChat() {
    const input = this.el.chatInput;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this._closeChat(true); }
      else if (e.key === 'Escape') { e.preventDefault(); this._closeChat(false); }
      else if (e.key === 'Tab') e.preventDefault();
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('blur', () => { if (this.chatOpen) setTimeout(() => { if (this.chatOpen && document.activeElement !== input) this._closeChat(false); }, 0); });
  }

  _updateChatInput(menusOpen) {
    if (this.chatOpen || menusOpen) return;
    const inp = this.ctx.input;
    if (!inp || typeof inp.pressed !== 'function') return;
    if (performance.now() - this.lastChatClose < 250) return;
    let p = false;
    try { p = inp.pressed('chat'); } catch { p = false; }
    if (p) this._openChat();
  }

  _openChat() {
    if (this.chatOpen) return;
    this.chatOpen = true;
    this.root.classList.add('chat-open');
    const input = this.el.chatInput;
    input.value = '';
    try { input.focus({ preventScroll: true }); } catch { input.focus(); }
    if (this.ctx.input) this.ctx.input.enabled = false;
  }

  _closeChat(send) {
    if (!this.chatOpen) return;
    const input = this.el.chatInput;
    const msg = input.value.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (send && msg) {
      try { if (this.ctx.net && typeof this.ctx.net.send === 'function') this.ctx.net.send({ t: 'chat', msg }); } catch { /* nada */ }
    }
    this.chatOpen = false;
    this.lastChatClose = performance.now();
    this.root.classList.remove('chat-open');
    input.value = '';
    if (document.activeElement === input) input.blur();
    const menusOpen = !!(this.ctx.menus && this.ctx.menus.isOpen);
    if (this.ctx.input && !menusOpen) this.ctx.input.enabled = true;
  }

  _addChat(e) {
    const line = document.createElement('div');
    const sys = !e.pid || +e.pid === 0;
    line.className = 'chat-line' + (sys ? ' sys' : '');
    if (!sys) {
      const nm = document.createElement('span');
      nm.className = 'chat-name';
      const p = this._player(e.pid);
      nm.style.color = safeColor(p && p.color);
      nm.textContent = `${e.name || this._name(e.pid)}: `;
      line.appendChild(nm);
    }
    const tx = document.createElement('span');
    tx.className = 'chat-text';
    tx.textContent = String(e.msg || '');
    line.appendChild(tx);
    this.el.chatFeed.appendChild(line);
    this.chatLines.push({ el: line, age: 0 });
    while (this.chatLines.length > 8) { const l = this.chatLines.shift(); l.el.remove(); }
    const gs = this.ctx.gs;
    if (gs && gs.phase === 'playing' && !this._isSelf(e.pid)) sfx(this.ctx, 'chat');
  }

  _updateChatFeed(dt) {
    for (const l of this.chatLines) {
      l.age += dt;
      const op = this.chatOpen ? 1 : l.age < 9 ? 1 : Math.max(0, 1 - (l.age - 9) / 2);
      const s = op.toFixed(2);
      if (l.op !== s) { l.op = s; l.el.style.opacity = s; }
    }
  }

  // ------------------------------------------------------------------ varios
  _updateDev(gs) {
    const on = this.dev || this.debug || !!this.ctx.dev;
    this.el.dev.classList.toggle('on', on);
    if (!on) return;
    const parts = [];
    if (this.dev || this.ctx.dev) parts.push('<b>DEV</b>');
    parts.push(`${this.fps} FPS`);
    if (gs && gs.phase === 'playing') {
      parts.push(`Ronda ${gs.round | 0}`);
      parts.push(`Zombis restantes: ${gs.zLeft | 0}`);
      const ents = this.ctx.entities;
      if (ents && typeof ents.getZombieTargets === 'function') {
        try { parts.push(`Visibles: ${ents.getZombieTargets().length}`); } catch { /* nada */ }
      }
    }
    try { if (this.ctx.net && typeof this.ctx.net.rtt === 'number') parts.push(`RTT ${Math.round(this.ctx.net.rtt)} ms`); } catch { /* nada */ }
    const html = parts.join(' · ');
    if (this._cache.dev !== html) { this._cache.dev = html; this.el.dev.innerHTML = html; }
  }
}

export default HUD;
