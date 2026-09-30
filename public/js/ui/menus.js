// Menús de Zombies: The Last Survivors (DOM, contenedor #menus): título, sala de espera, pausa, ajustes, controles y fin de partida.
// El núcleo (main.js) decide cuándo se muestra cada pantalla; aquí solo se dibujan y se envían acciones al servidor.

import { PLAYER_COLORS, MAX_PLAYERS, GAME_VERSION, ZOMBIE_TYPES, clamp } from '/shared/constants.js';
import { MAP_NAME, MAP_LIST, DEFAULT_MAP } from '/shared/map.js';
import { esc, safeColor, mulberry32, sfx, ensureChalkDefs, isDebugUrl } from './uiutil.js';
import { COLOR_NAMES, CONTROL_GROUPS, CONTROLS_SHORT, TIPS, DEFAULT_SETTINGS, FPS_CAPS, sanitizeGfx } from './menudata.js';
import { tr, getLang, setLang, LANGS } from '../i18n.js';
import { ACHIEVEMENTS, ACHIEVEMENT_CATS, statValue } from '/shared/achievements.js';
import { fetchStats, getSession, checkSession, login, register, resetPass, logout, clearSession } from '../profile.js';

// Errores de la API de cuentas (server/auth.js) -> texto
const AUTH_ERRORS = {
  invalid: 'Usuario o contraseña incorrectos.',
  taken: 'Ese nombre de usuario ya existe.',
  username: 'El usuario debe tener de 3 a 16 caracteres: letras, números, punto, guion o guion bajo.',
  short: 'La contraseña debe tener al menos 6 caracteres.',
  mismatch: 'Las contraseñas no coinciden.',
  nouser: 'No existe ningún usuario con ese nombre.',
  wait: 'Demasiados intentos. Espera un minuto.',
  nodb: 'El servidor no tiene base de datos configurada: solo está disponible el modo un jugador.',
  network: 'No se pudo conectar con el servidor.',
  old: 'El servidor es de una versión anterior: reinícialo para usar las cuentas.',
};

const SETTINGS_KEY = 'zlan.settings';
const GAMEOVER_SECONDS = 15;          // el servidor vuelve a la sala 15 s después del fin
const ESC_GUARD_MS = 450;             // el Esc que abrió la pausa no debe cerrarla
const CHAT_HISTORY = 60;

// ---------------------------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------------------------

// "0.9.0-beta" -> "BETA 0.9.0"
function versionLabel() {
  const [num, tag] = GAME_VERSION.split('-');
  return tag ? `${tag.toUpperCase()} ${num}` : `v${num}`;
}

// Título "ZOMBIES": cada letra es un <text> propio (para animarlas por separado), con trazo de
// tiza, una salpicadura de sangre detrás, chorretones que cuelgan y gotas que se desprenden.
// La entrada (letras que caen de golpe + salpicadura) solo se ve con .mn-title.intro (ver showMain).
const TITLE_FONT = "Impact, Haettenschweiler, 'Arial Narrow Bold', 'Bahnschrift', sans-serif";
// Ancho relativo de cada letra en Impact: cada una ocupa su parte de los 860 px sin deformarse
const TITLE_WIDTHS = [0.52, 0.57, 0.74, 0.57, 0.29, 0.47, 0.55];
function titleSVG() {
  const r = mulberry32(90210);
  const f = (v) => v.toFixed(1);
  const scale = 860 / TITLE_WIDTHS.reduce((a, b) => a + b, 0);
  let letters = '', drips = '', drops = '';
  let left = 20;
  for (let i = 0; i < 7; i++) {
    const w = TITLE_WIDTHS[i] * scale;
    const cx = left + w / 2;
    left += w;
    const rot = (r() * 2 - 1) * 2.6;
    const dy = (r() * 2 - 1) * 4;
    letters += `<text class="tl-l" style="--i:${i};--r:${rot.toFixed(2)}deg" x="${f(cx)}" y="${f(192 + dy)}" text-anchor="middle"` +
      ` font-size="212" textLength="${f(w - 6)}" lengthAdjust="spacingAndGlyphs">${'ZOMBIES'[i]}</text>`;
    const n = 1 + (r() < 0.6 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const x = cx + (r() * 2 - 1) * w * 0.28;
      const dw = 8 + r() * 10;
      const len = 18 + r() * 58;
      const y = 176;
      // Chorretón: ancho arriba, cuello estrecho y bulbo redondo al final
      const nk = dw * 0.3, rb = dw * 0.42;
      const d = `M${f(x - dw / 2)} ${y} Q${f(x - nk)} ${f(y + len * 0.55)} ${f(x - nk)} ${f(y + len)} ` +
        `A${f(rb)} ${f(rb)} 0 1 0 ${f(x + nk)} ${f(y + len)} Q${f(x + nk)} ${f(y + len * 0.55)} ${f(x + dw / 2)} ${y} Z`;
      drips += `<path class="drip" style="--dd:${(r() * 5).toFixed(2)}s;--dl:${(6 + r() * 6).toFixed(2)}s;--gi:${(i * 0.09).toFixed(2)}s" d="${d}"/>`;
      // Una de cada dos gotas se desprende del bulbo cada pocos segundos
      if (r() < 0.55) {
        drops += `<circle class="drop" cx="${f(x)}" cy="${f(y + len + rb * 0.6)}" r="${f(rb * 0.8)}"` +
          ` style="--dp:${(2.5 + r() * 6).toFixed(2)}s;--df:${(4.5 + r() * 4).toFixed(2)}s"/>`;
      }
    }
  }
  // Salpicadura: mancha irregular + gotitas alrededor + regueros hacia fuera
  let blob = '';
  const N = 30;
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * Math.PI * 2;
    const rr = 1 + (r() * 2 - 1) * 0.22 + (k % 3 === 0 ? r() * 0.35 : 0);
    blob += `${k ? 'L' : 'M'}${f(450 + Math.cos(a) * 330 * rr)} ${f(128 + Math.sin(a) * 88 * rr)}`;
  }
  let dots = '';
  for (let k = 0; k < 34; k++) {
    const a = r() * Math.PI * 2;
    const d = 1.08 + r() * 0.6;
    const rad = 2 + r() * r() * 13;
    dots += `<circle cx="${f(450 + Math.cos(a) * 340 * d)}" cy="${f(128 + Math.sin(a) * 100 * d)}" r="${f(rad)}"/>`;
  }
  for (let k = 0; k < 9; k++) {
    const a = r() * Math.PI * 2;
    const x1 = 450 + Math.cos(a) * 300, y1 = 128 + Math.sin(a) * 80;
    const x2 = 450 + Math.cos(a) * (380 + r() * 90), y2 = 128 + Math.sin(a) * (110 + r() * 40);
    dots += `<path d="M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}" stroke-width="${f(3 + r() * 6)}" stroke-linecap="round"/>`;
  }
  return `<svg class="mn-title-svg" viewBox="0 0 900 270" role="img" aria-label="ZOMBIES">
    <defs>
      <linearGradient id="zlTitleGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ef2f22"/><stop offset="0.55" stop-color="#a80f0b"/><stop offset="1" stop-color="#560403"/>
      </linearGradient>
    </defs>
    <g class="tl-splat" fill="#4f0604" stroke="#4f0604" filter="url(#zl-chalk-heavy)"><path d="${blob}Z"/>${dots}</g>
    <g class="mn-title-glow" fill="#ff1a0a">
      <text x="450" y="192" text-anchor="middle" font-size="212" textLength="860" lengthAdjust="spacingAndGlyphs" font-family="${TITLE_FONT}">ZOMBIES</text>
    </g>
    <g class="tl-letters" filter="url(#zl-chalk-heavy)" fill="url(#zlTitleGrad)" font-family="${TITLE_FONT}">
      ${letters}
      ${drips}
    </g>
    <g class="tl-drops" fill="#8e0a07">${drops}</g>
  </svg>`;
}

function keysHTML(keys) {
  return keys.map((k) => `<kbd>${esc(tr(k))}</kbd>`).join('<span class="kb-sep">/</span>');
}

function controlsShortHTML() {
  return CONTROLS_SHORT.map(([keys, label]) => `<div class="ct-row"><span class="ct-keys">${keysHTML(keys)}</span><span class="ct-label">${esc(tr(label))}</span></div>`).join('');
}

function controlsFullHTML() {
  return CONTROL_GROUPS.map((g) => `
    <div class="ct-group">
      <h3 class="ct-title">${esc(tr(g.title))}</h3>
      ${g.rows.map(([keys, label]) => `<div class="ct-row"><span class="ct-keys">${keysHTML(keys)}</span><span class="ct-label">${esc(tr(label))}</span></div>`).join('')}
    </div>`).join('');
}

const TEMPLATE = `
<div class="mn-root">
  <div class="mn-bg"></div>

  <section class="mn-screen mn-main" data-screen="main" aria-label="${tr('Pantalla de título')}">
    <div class="mn-main-grid">
      <div class="mn-main-left">
        <div class="mn-title">${titleSVG()}<div class="mn-sub"><span>The Last Survivors</span></div></div>
        <div class="mn-card mn-join">
          <label class="mn-label" for="zl-name">${tr('Tu nombre')}</label>
          <input id="zl-name" class="mn-input mn-name" type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="${tr('Superviviente')}">
          <div class="mn-label">${tr('Tu color')}</div>
          <div class="mn-swatches" role="radiogroup" aria-label="${tr('Color del jugador')}"></div>
          <div class="mn-actions mn-actions-row mn-play-row">
            <button type="button" class="mn-btn primary mn-join-btn">${tr('Multijugador')}</button>
            <button type="button" class="mn-btn primary mn-solo-btn">${tr('Un jugador')}</button>
          </div>
          <div class="mn-session"></div>
          <div class="mn-actions mn-actions-row">
            <button type="button" class="mn-btn small mn-open-settings">${tr('Ajustes')}</button>
            <button type="button" class="mn-btn small mn-open-controls">${tr('Controles')}</button>
            <button type="button" class="mn-btn small ghost mn-lang" data-lang="${getLang() === 'es' ? 'en' : 'es'}">${getLang() === 'es' ? 'English' : 'Español'}</button>
          </div>
          <div class="mn-actions mn-actions-row">
            <button type="button" class="mn-btn small mn-open-leaders">${tr('Tabla de puntos')}</button>
            <button type="button" class="mn-btn small mn-open-achv">${tr('Logros')}</button>
          </div>
          <div class="mn-join-status"></div>
        </div>
      </div>
      <aside class="mn-card mn-main-controls">
        <h3 class="mn-card-title">${tr('Controles')}</h3>
        <div class="ct-list">${controlsShortHTML()}</div>
        <div class="mn-hint">${tr('Mantén {0} para reconstruir barricadas, construir el escudo y reanimar.', '<kbd>F</kbd>')}</div>
      </aside>
    </div>
    <div class="mn-foot"><span class="mn-server"></span><span class="mn-foot-sep">·</span><span>${tr('1 a {0} jugadores en red local', MAX_PLAYERS)}</span><span class="mn-foot-sep">·</span><span class="mn-version">${esc(versionLabel())}</span></div>
  </section>

  <section class="mn-screen mn-rooms" data-screen="rooms" aria-label="${tr('Salas')}">
    <header class="mn-head">
      <h2 class="mn-h2">${tr('Salas')}</h2>
    </header>
    <div class="mn-rooms-grid">
      <div class="mn-card rm-browser">
        <h3 class="mn-card-title">${tr('Salas públicas')}<button type="button" class="mn-btn small ghost rm-refresh">${tr('Actualizar')}</button></h3>
        <div class="rm-list"></div>
        <div class="rm-empty">${tr('No hay salas abiertas todavía. ¡Creá una!')}</div>
      </div>
      <div class="mn-card rm-create">
        <h3 class="mn-card-title">${tr('Crear sala')}</h3>
        <label class="mn-label" for="zl-room-name">${tr('Nombre de la sala')}</label>
        <input id="zl-room-name" class="mn-input rm-name" type="text" maxlength="24" autocomplete="off" spellcheck="false" placeholder="${tr('Mi sala')}">
        <label class="mn-label" for="zl-room-map">${tr('Mapa')}</label>
        <select id="zl-room-map" class="mn-input rm-map">${MAP_LIST.map((m) => `<option value="${esc(m.id)}"${m.id === DEFAULT_MAP ? ' selected' : ''}>${esc(tr(m.name))}</option>`).join('')}</select>
        <label class="st-toggle-row rm-pw-toggle"><input type="checkbox" class="rm-pw-on"><span>${tr('Proteger con contraseña')}</span></label>
        <input class="mn-input rm-pw-input" type="password" maxlength="32" autocomplete="off" spellcheck="false" placeholder="${tr('Contraseña')}" hidden>
        <div class="mn-actions">
          <button type="button" class="mn-btn primary rm-create-btn">${tr('Crear sala')}</button>
        </div>
      </div>
    </div>
    <div class="rm-status" aria-live="polite"></div>
    <div class="mn-actions mn-actions-row">
      <button type="button" class="mn-btn small ghost rm-back">${tr('Volver')}</button>
    </div>
  </section>

  <section class="mn-screen mn-lobby" data-screen="lobby" aria-label="${tr('Sala de espera')}">
    <header class="mn-head">
      <h2 class="mn-h2">${tr('Sala de espera')}</h2>
      <div class="mn-head-sub">${esc(tr(MAP_NAME))} <span class="mn-dev-tag">DEV</span></div>
    </header>
    <div class="mn-lobby-grid">
      <div class="mn-card lb-players">
        <h3 class="mn-card-title">${tr('Jugadores')} <span class="lb-count"></span></h3>
        <div class="lb-slots"></div>
        <div class="lb-status"></div>
        <div class="lb-actions">
          <button type="button" class="mn-btn lb-ready">${tr('Listo')}</button>
          <button type="button" class="mn-btn primary lb-start">${tr('Iniciar partida')}</button>
        </div>
        <div class="lb-wait">${tr('El anfitrión iniciará la partida cuando todos estén listos.')}</div>
        <div class="lb-actions lb-actions-row">
          <button type="button" class="mn-btn small mn-open-settings">${tr('Ajustes')}</button>
          <button type="button" class="mn-btn small mn-open-controls">${tr('Controles')}</button>
          <button type="button" class="mn-btn small ghost lb-leave">${tr('Salir')}</button>
        </div>
      </div>
      <div class="mn-lobby-right">
        <div class="mn-card lb-lan">
          <h3 class="mn-card-title lb-lan-title">${tr('Invita a tus amigos')}</h3>
          <div class="lb-lan-text">${tr('Comparte esta dirección con tus amigos (misma red):')}</div>
          <div class="lb-urls"></div>
        </div>
        <div class="mn-card lb-chat">
          <h3 class="mn-card-title">${tr('Chat')}</h3>
          <div class="lb-feed" aria-live="polite"></div>
          <form class="lb-entry" autocomplete="off">
            <input class="mn-input lb-input" type="text" maxlength="120" spellcheck="false" placeholder="${tr('Escribe un mensaje y pulsa Enter')}">
            <button type="submit" class="mn-btn small">${tr('Enviar')}</button>
          </form>
        </div>
      </div>
    </div>
    <div class="lb-tip"><span class="lb-tip-label">${tr('Consejo')}</span><span class="lb-tip-text"></span></div>
  </section>

  <section class="mn-screen mn-pause" data-screen="pause" aria-label="${tr('Pausa')}">
    <div class="mn-pause-box">
      <h2 class="mn-h2 mn-pause-title">${tr('Pausa')}</h2>
      <div class="mn-pause-info"></div>
      <div class="mn-menu">
        <button type="button" class="mn-btn primary ps-continue">${tr('Continuar')}</button>
        <button type="button" class="mn-btn mn-open-settings">${tr('Ajustes')}</button>
        <button type="button" class="mn-btn mn-open-controls">${tr('Controles')}</button>
        <button type="button" class="mn-btn danger ps-exit">${tr('Salir de la partida')}</button>
      </div>
      <div class="mn-pause-note">${tr('La partida está en pausa para todos. Se reanuda sola a los 5 minutos.')}</div>
    </div>
  </section>

  <section class="mn-screen mn-settings" data-screen="settings" aria-label="${tr('Ajustes')}">
    <div class="mn-panel-box">
      <h2 class="mn-h2">${tr('Ajustes')}</h2>
      <div class="st-list">
        <h3 class="st-section">${tr('Controles')}</h3>
        ${stRange('sensitivity', 'Sensibilidad del ratón', 0.1, 4, 0.05)}
        ${stRange('fov', 'Campo de visión', 60, 100, 1)}
        ${stCheck('invertY', 'Invertir eje Y')}
        ${stRange('cameraMotion', 'Movimiento de cámara', 0, 1, 0.05)}

        <h3 class="st-section">${tr('Gráficos')}</h3>
        ${stSeg('quality', 'Detalle de modelos y efectos', [['high', 'Alto'], ['low', 'Bajo']])}
        ${stSeg('shadows', 'Sombras', [['off', 'No'], ['low', 'Bajas'], ['high', 'Altas']])}
        ${stRange('renderScale', 'Escala de resolución', 0.5, 1.5, 0.05)}
        ${stCheck('dynRes', 'Resolución dinámica')}
        ${stCheck('antialias', 'Suavizado de bordes')}
        ${stRange('brightness', 'Brillo', 0.5, 2, 0.05)}
        ${stRange('fog', 'Niebla', 0.5, 1.5, 0.05)}
        ${stSeg('fpsCap', 'Límite de FPS', FPS_CAPS.map((v) => [String(v), v ? String(v) : 'Libre']))}
        ${stCheck('showFps', 'Mostrar FPS')}

        <h3 class="st-section">${tr('Audio e idioma')}</h3>
        ${stRange('volume', 'Volumen general', 0, 1, 0.01)}
        ${stRange('music', 'Volumen de la música', 0, 1, 0.01)}
        <div class="st-row"><span class="st-label">${tr('Idioma')}</span>
          <div class="st-seg" role="radiogroup" aria-label="${tr('Idioma')}">
            ${LANGS.map((l) => `<button type="button" class="st-seg-btn st-lang${l.id === getLang() ? ' sel' : ''}" data-lang="${l.id}">${l.name}</button>`).join('')}
          </div><span class="st-val"></span></div>
      </div>
      <div class="st-note">${tr('El suavizado de bordes se aplica al recargar la página. La resolución dinámica baja la escala sola si el juego no llega a ~50 FPS. Con detalle bajo, los personajes no proyectan sombra.')}</div>
      <div class="mn-actions mn-actions-row">
        <button type="button" class="mn-btn small ghost st-reset">${tr('Restablecer')}</button>
        <button type="button" class="mn-btn primary mn-back">${tr('Volver')}</button>
      </div>
    </div>
  </section>

  <section class="mn-screen mn-controls" data-screen="controls" aria-label="${tr('Controles')}">
    <div class="mn-panel-box wide">
      <h2 class="mn-h2">${tr('Controles')}</h2>
      <div class="ct-groups">${controlsFullHTML()}</div>
      <h3 class="ct-title ct-tips-title">${tr('Consejos para sobrevivir')}</h3>
      <ul class="ct-tips">${TIPS.slice(0, 8).map((tip) => `<li>${esc(tr(tip))}</li>`).join('')}</ul>
      <div class="mn-actions mn-actions-row"><button type="button" class="mn-btn primary mn-back">${tr('Volver')}</button></div>
    </div>
  </section>

  <section class="mn-screen mn-solo" data-screen="solo" aria-label="${tr('Un jugador')}">
    <div class="mn-panel-box so-box">
      <h2 class="mn-h2">${tr('Un jugador')}</h2>
      <div class="au-sub">${tr('Elige el mapa. En un jugador los logros se guardan si has iniciado sesión, pero los puntos no cuentan para la tabla global.')}</div>
      <div class="so-maps" role="radiogroup" aria-label="${tr('Mapa')}">
        ${MAP_LIST.map((m) => `<button type="button" class="so-map" role="radio" data-map="${esc(m.id)}">
          <span class="so-map-name">${esc(tr(m.name))}</span>${m.desc ? `<span class="so-map-desc">${esc(tr(m.desc))}</span>` : ''}</button>`).join('')}
      </div>
      <div class="mn-actions mn-actions-row">
        <button type="button" class="mn-btn small ghost so-back">${tr('Volver')}</button>
        <button type="button" class="mn-btn primary so-start">${tr('Empezar partida')}</button>
      </div>
    </div>
  </section>

  <section class="mn-screen mn-auth" data-screen="auth" aria-label="${tr('Cuenta')}">
    <form class="mn-panel-box au-box" autocomplete="off" novalidate>
      <h2 class="mn-h2 au-title"></h2>
      <div class="au-sub"></div>
      <label class="mn-label" for="zl-au-user">${tr('Usuario')}</label>
      <input id="zl-au-user" class="mn-input au-user" type="text" maxlength="16" spellcheck="false" autocomplete="username">
      <label class="mn-label au-pass-label" for="zl-au-pass"></label>
      <input id="zl-au-pass" class="mn-input au-pass" type="password" maxlength="72" autocomplete="current-password">
      <div class="au-confirm-wrap">
        <label class="mn-label" for="zl-au-confirm">${tr('Confirmar contraseña')}</label>
        <input id="zl-au-confirm" class="mn-input au-confirm" type="password" maxlength="72" autocomplete="new-password">
      </div>
      <div class="au-status" aria-live="polite"></div>
      <div class="mn-actions">
        <button type="submit" class="mn-btn primary au-submit"></button>
      </div>
      <div class="au-links">
        <button type="button" class="au-link" data-go="register">${tr('Crear una cuenta')}</button>
        <button type="button" class="au-link" data-go="reset">${tr('¿Olvidaste tu contraseña?')}</button>
        <button type="button" class="au-link" data-go="login">${tr('Ya tengo cuenta: iniciar sesión')}</button>
      </div>
      <div class="mn-actions mn-actions-row"><button type="button" class="mn-btn small ghost au-back">${tr('Volver')}</button></div>
    </form>
  </section>

  <section class="mn-screen mn-leaders" data-screen="leaders" aria-label="${tr('Tabla de puntos')}">
    <div class="mn-panel-box wide">
      <h2 class="mn-h2">${tr('Tabla de puntos')}</h2>
      <div class="lbd-sub">${tr('Mejor partida de cada jugador en multijugador: puntos ganados y ronda máxima. Las partidas de un jugador no cuentan.')}</div>
      <div class="lbd-body"></div>
      <div class="mn-actions mn-actions-row"><button type="button" class="mn-btn primary mn-back">${tr('Volver')}</button></div>
    </div>
  </section>

  <section class="mn-screen mn-achv" data-screen="achv" aria-label="${tr('Logros')}">
    <div class="mn-panel-box wide">
      <h2 class="mn-h2">${tr('Logros')} <span class="ach-count"></span></h2>
      <div class="ach-body"></div>
      <div class="mn-actions mn-actions-row"><button type="button" class="mn-btn primary mn-back">${tr('Volver')}</button></div>
    </div>
  </section>

  <section class="mn-screen mn-gameover" data-screen="gameover" aria-label="${tr('Fin de la partida')}">
    <div class="go-box">
      <h2 class="go-title">${tr('Fin de la partida')}</h2>
      <div class="go-sub"></div>
      <table class="go-table">
        <thead><tr><th class="go-name">${tr('Jugador')}</th><th>${tr('Puntos')}</th><th>${tr('Bajas')}</th><th>${tr('A la cabeza')}</th><th>${tr('Caídas')}</th><th>${tr('Reanimaciones')}</th></tr></thead>
        <tbody></tbody>
        <tfoot></tfoot>
      </table>
      <div class="go-count"></div>
      <div class="mn-actions mn-actions-row"><button type="button" class="mn-btn small ghost go-leave">${tr('Salir')}</button></div>
    </div>
  </section>

  <div class="mn-confirm" role="dialog" aria-modal="true">
    <div class="mn-confirm-box">
      <div class="mn-confirm-title"></div>
      <div class="mn-confirm-text"></div>
      <input class="mn-input cf-pw" type="password" maxlength="32" autocomplete="off" spellcheck="false" placeholder="${tr('Contraseña')}" hidden>
      <div class="mn-actions mn-actions-row">
        <button type="button" class="mn-btn small ghost cf-no">${tr('Cancelar')}</button>
        <button type="button" class="mn-btn small danger cf-yes">${tr('Salir')}</button>
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

function fmtNum(n) {
  return (Number(n) || 0).toLocaleString(getLang() === 'es' ? 'es-ES' : 'en-US');
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
    case 'brightness':
    case 'renderScale':
    case 'fog':
    case 'cameraMotion': return `${Math.round(v * 100)}%`;
    case 'invertY':
    case 'dynRes':
    case 'showFps': return v ? tr('Sí') : tr('No');
    case 'antialias': return v ? tr('Sí') : tr('No');
    default: return '';
  }
}

// Filas de la pantalla de Ajustes (el enlace es genérico por data-key / data-set)
function stRange(key, label, min, max, step) {
  return `<div class="st-row"><label class="st-label" for="zl-st-${key}">${tr(label)}</label>`
    + `<input id="zl-st-${key}" class="st-range" data-key="${key}" type="range" min="${min}" max="${max}" step="${step}">`
    + `<span class="st-val" data-val="${key}"></span></div>`;
}
function stCheck(key, label) {
  return `<div class="st-row"><label class="st-label" for="zl-st-${key}">${tr(label)}</label>`
    + `<label class="st-toggle"><input id="zl-st-${key}" class="st-check" type="checkbox" data-key="${key}"><span class="st-knob"></span></label>`
    + `<span class="st-val" data-val="${key}"></span></div>`;
}
function stSeg(key, label, options) {
  return `<div class="st-row"><span class="st-label">${tr(label)}</span>`
    + `<div class="st-seg" role="radiogroup" aria-label="${tr(label)}">`
    + options.map(([v, text]) => `<button type="button" class="st-seg-btn" role="radio" data-set="${key}" data-v="${v}">${tr(text)}</button>`).join('')
    + '</div><span class="st-val"></span></div>';
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
      soloBtn: q('.mn-solo-btn'), session: q('.mn-session'),
      auUser: q('.au-user'), auPass: q('.au-pass'), auConfirm: q('.au-confirm'), auStatus: q('.au-status'),
      server: q('.mn-server'),
      lbCount: q('.lb-count'), lbSlots: q('.lb-slots'), lbStatus: q('.lb-status'), lbReady: q('.lb-ready'), lbStart: q('.lb-start'),
      lbWait: q('.lb-wait'), lbUrls: q('.lb-urls'), lbLanTitle: q('.lb-lan-title'), lbLanText: q('.lb-lan-text'),
      lbFeed: q('.lb-feed'), lbEntry: q('.lb-entry'), lbInput: q('.lb-input'),
      lbTip: q('.lb-tip-text'), devTag: q('.mn-dev-tag'),
      pauseInfo: q('.mn-pause-info'),
      stRanges: Array.from(this.root.querySelectorAll('.st-range')), stVals: Array.from(this.root.querySelectorAll('[data-val]')),
      stSeg: Array.from(this.root.querySelectorAll('.st-seg-btn[data-set]')),
      stChecks: Array.from(this.root.querySelectorAll('.st-check')),
      goSub: q('.go-sub'), goBody: q('.go-table tbody'), goFoot: q('.go-table tfoot'), goCount: q('.go-count'),
      confirm: q('.mn-confirm'), cfTitle: q('.mn-confirm-title'), cfText: q('.mn-confirm-text'), cfPw: q('.cf-pw'), cfYes: q('.cf-yes'), cfNo: q('.cf-no'),
      rmList: q('.rm-list'), rmEmpty: q('.rm-empty'), rmRefresh: q('.rm-refresh'), rmName: q('.rm-name'),
      rmMap: q('.rm-map'), rmPwOn: q('.rm-pw-on'), rmPwInput: q('.rm-pw-input'), rmCreateBtn: q('.rm-create-btn'), rmStatus: q('.rm-status'), rmBack: q('.rm-back'),
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
    this._roomCb = null;
    this._roomsList = [];
    this._pendingJoinCode = null;
    this.color = PLAYER_COLORS.includes((this.ctx.settings || {}).color) ? this.ctx.settings.color : PLAYER_COLORS[0];

    this._buildSwatches();
    this._bindUI();
    this._bindEvents();
    this._syncSettingsUI();
    if (this.el.server) this.el.server.textContent = tr('Servidor: {0}', location.host || 'local');
  }

  // ================================================================== API pública
  get isOpen() { return this.mode !== null; }

  showMain(onJoin) {
    if (typeof onJoin === 'function') this.onJoin = onJoin;
    const s = this.ctx.settings || {};
    if (!['settings', 'controls', 'leaders', 'achv', 'auth', 'solo'].includes(this.mode)) {
      this.el.name.value = typeof s.name === 'string' ? s.name.slice(0, 16) : '';
      if (PLAYER_COLORS.includes(s.color)) this.color = s.color;
    }
    this._renderSession();
    this._paintSwatches();
    this._setJoining(false);
    this._open('main');
    this._music('lobby');
    // La entrada del título solo se reproduce la primera vez (no al volver de Ajustes, etc.)
    if (!this._titleIntroDone) {
      this._titleIntroDone = true;
      const t = this.root.querySelector('.mn-title');
      t.classList.add('intro');
      setTimeout(() => t.classList.remove('intro'), 4200);
    }
    // Foco en el nombre (sin robarlo si el usuario ya está en otro campo)
    setTimeout(() => {
      if (this.mode === 'main' && !isEditable(document.activeElement)) {
        try { this.el.name.focus({ preventScroll: true }); } catch { /* nada */ }
      }
    }, 60);
  }

  // cb: { onRefresh, onCreate({name,password}), onJoin({code,password}), onBack }
  showRooms(cb) {
    this._roomCb = cb || null;
    this.el.rmName.value = '';
    this.el.rmPwOn.checked = false;
    this.el.rmPwInput.hidden = true;
    this.el.rmPwInput.value = '';
    this.el.rmStatus.textContent = '';
    this._renderRoomList(this._roomsList);
    this._open('rooms');
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
      const gs = this.ctx.gs;
      if (gs && gs.pause) this._send({ t: 'resume' });
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
    clearInterval(this._pauseTimer);
    this._pauseTimer = 0;
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

  // fromServer: otro jugador pausó (no se vuelve a pedir la pausa)
  _openPause(fromServer = false) {
    this._backMode = null;
    const gs = this.ctx.gs;
    if (!fromServer && gs && gs.phase === 'playing' && !gs.pause) this._send({ t: 'pause' });
    this._renderPauseInfo();
    clearInterval(this._pauseTimer);
    this._pauseTimer = setInterval(() => this._renderPauseInfo(), 250);
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
    try { sessionStorage.removeItem('zlan.room-session'); } catch { /* nada */ }
    setTimeout(() => location.reload(), 60);
  }

  // ------------------------------------------------------------------ puntuaciones y logros
  _openStats(mode) {
    this._backMode = 'main';
    this._backFn = null;
    const body = this.root.querySelector(mode === 'leaders' ? '.lbd-body' : '.ach-body');
    body.innerHTML = `<div class="lbd-msg">${tr('Cargando…')}</div>`;
    if (mode === 'achv') this.root.querySelector('.ach-count').textContent = '';
    this._open(mode);
    const req = (this._statsReq = (this._statsReq || 0) + 1);
    fetchStats().then((data) => {
      if (req !== this._statsReq || this.mode !== mode) return;
      if (mode === 'leaders') this._renderLeaders(body, data);
      else this._renderAchievements(body, data.me);
    }, (err) => {
      if (req !== this._statsReq) return;
      // 404: servidor de una versión anterior (hay que reiniciarlo); nodb: sin DATABASE_URL
      const msg = err && err.message === 'nodb' ? tr(AUTH_ERRORS.nodb)
        : err && /404/.test(err.message) ? tr('El servidor no tiene la tabla de puntos: reinícialo para usar la versión actual.')
          : tr('No se pudo conectar con el servidor.');
      body.innerHTML = `<div class="lbd-msg">${msg}</div>`;
    });
  }

  _renderLeaders(body, data) {
    const top = Array.isArray(data.top) ? data.top : [];
    if (!top.length) {
      body.innerHTML = `<div class="lbd-msg">${tr('Todavía no hay puntuaciones. ¡Juega una partida para aparecer aquí!')}</div>`;
      return;
    }
    const row = (r) => `<tr class="${r.me ? 'me' : ''}${r.rank <= 3 ? ' podium p' + r.rank : ''}">
      <td class="lbd-rank">${r.rank}</td><td class="lbd-name">${esc(r.name)}${r.me ? ` <span class="lbd-you">${tr('Tú')}</span>` : ''}</td>
      <td class="lbd-pts">${fmtNum(r.points)}</td><td>${fmtNum(r.kills)}</td><td>${r.bestRound | 0}</td><td>${r.bosses | 0}</td><td>${r.ach | 0}/${ACHIEVEMENTS.length}</td></tr>`;
    body.innerHTML = `<table class="lbd-table">
      <thead><tr><th>#</th><th class="lbd-name">${tr('Jugador')}</th><th>${tr('Récord')}</th><th>${tr('Bajas')}</th><th>${tr('Mejor ronda')}</th><th>${tr('Jefes')}</th><th>${tr('Logros')}</th></tr></thead>
      <tbody>${top.map(row).join('')}${data.meRow ? `<tr class="lbd-gap"><td colspan="7">···</td></tr>${row(data.meRow)}` : ''}</tbody>
    </table>
    <div class="lbd-foot">${tr('{0} jugadores en la tabla', data.total | 0)}</div>`;
  }

  _renderAchievements(body, me) {
    if (!getSession()) {
      this.root.querySelector('.ach-count').textContent = `0 / ${ACHIEVEMENTS.length}`;
      body.innerHTML = `<div class="lbd-msg">${tr('Inicia sesión para ver tus logros y guardarlos al jugar.')}<br><br>` +
        `<button type="button" class="mn-btn primary ach-login">${tr('Iniciar sesión')}</button></div>`;
      body.querySelector('.ach-login').addEventListener('click', () => this._openAuth('login', () => this._openStats('achv')));
      return;
    }
    const p = me || null;
    const done = p ? ACHIEVEMENTS.filter((a) => p.ach && p.ach[a.id]).length : 0;
    this.root.querySelector('.ach-count').textContent = `${done} / ${ACHIEVEMENTS.length}`;
    const summary = p
      ? `<div class="ach-summary">${[
        [tr('Puntos'), fmtNum(p.points)], [tr('Bajas'), fmtNum(p.kills)], [tr('Mejor ronda'), p.bestRound | 0],
        [tr('Jefes'), p.bossKills | 0], [tr('Partidas'), p.games | 0]].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>`
      : `<div class="lbd-msg small">${tr('Aún no has jugado en este servidor. Tu progreso se guarda en este navegador.')}</div>`;
    const card = (a) => {
      const val = Math.min(statValue(p, a.stat), a.goal);
      const got = !!(p && p.ach && p.ach[a.id]);
      const boss = a.boss && ZOMBIE_TYPES[a.boss] ? tr(ZOMBIE_TYPES[a.boss].name) : '';
      const pct = got ? 100 : Math.floor((val / a.goal) * 100);
      return `<div class="ach-card${got ? ' got' : ''}">
        <div class="ach-icon">${got ? '★' : '🔒'}</div>
        <div class="ach-text"><div class="ach-name">${esc(tr(a.name))}</div>
          <div class="ach-desc">${esc(tr(a.desc, fmtNum(a.goal), boss))}</div>
          ${got ? `<div class="ach-date">${tr('Conseguido el {0}', new Date(p.ach[a.id]).toLocaleDateString(getLang() === 'es' ? 'es-ES' : 'en-US'))}</div>`
            : `<div class="ach-prog"><i style="width:${pct}%"></i></div><div class="ach-num">${fmtNum(got ? a.goal : val)} / ${fmtNum(a.goal)}</div>`}
        </div></div>`;
    };
    body.innerHTML = summary + ACHIEVEMENT_CATS.map(([cat, title]) => {
      const list = ACHIEVEMENTS.filter((a) => a.cat === cat);
      return `<h3 class="st-section">${tr(title)}</h3><div class="ach-grid">${list.map(card).join('')}</div>`;
    }).join('');
  }

  // ------------------------------------------------------------------ título
  _buildSwatches() {
    this.el.swatches.innerHTML = PLAYER_COLORS.map((c, i) =>
      `<button type="button" class="mn-swatch" role="radio" data-color="${esc(c)}" style="--sw:${safeColor(c)}" aria-label="${esc(tr(COLOR_NAMES[i] || c))}">` +
      `<i></i><span>${esc(tr(COLOR_NAMES[i] || ''))}</span></button>`).join('');
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

  // mode: 'multi' (necesita sesión: si no la hay, primero se pide) o 'solo'
  async _join(mode) {
    if (this.joining) return;
    try { if (this.ctx.audio && typeof this.ctx.audio.unlock === 'function') this.ctx.audio.unlock(); } catch { /* nada */ }
    if (mode === 'multi') {
      if (!getSession()) { this._openAuth('login', () => this._join('multi')); return; }
      // La sesión guardada puede haber caducado (servidor reiniciado)
      this._setJoining(true, mode);
      const { user, db } = await checkSession();
      if (!user) {
        this._setJoining(false);
        this._renderSession();
        this._openAuth('login', () => this._join('multi'), db ? tr('Tu sesión caducó: vuelve a iniciar sesión.') : '');
        return;
      }
    }
    let name = (this.el.name.value || '').replace(/\s+/g, ' ').trim().slice(0, 16);
    if (!name) name = ((this.ctx.settings && this.ctx.settings.name) || '').trim().slice(0, 16) || tr('Jugador{0}', Math.floor(10 + Math.random() * 90));
    this.el.name.value = name;
    this._setJoining(true, mode);
    if (typeof this.onJoin === 'function') {
      try { this.onJoin(name, this.color, mode, mode === 'solo' ? { map: this.soloMap || DEFAULT_MAP } : undefined); } catch (e) { console.error('[Menus] Error al unirse:', e); this._setJoining(false); }
    } else {
      this._setJoining(false);
    }
  }

  // Un jugador: primero se elige el mapa (se recuerda el último)
  _openSolo() {
    if (this.joining) return;
    let last = null;
    try { last = localStorage.getItem('zlan.soloMap'); } catch { /* sin almacenamiento */ }
    this._pickSoloMap(MAP_LIST.some((m) => m.id === last) ? last : DEFAULT_MAP);
    this._backMode = 'main';
    this._backFn = null;
    this._open('solo');
  }

  _pickSoloMap(id) {
    this.soloMap = id;
    for (const b of this.root.querySelectorAll('.so-map')) {
      const on = b.dataset.map === id;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    try { localStorage.setItem('zlan.soloMap', id); } catch { /* sin almacenamiento */ }
  }

  // Línea de sesión del título; con sesión, el nombre en partida es el de usuario
  _renderSession() {
    const s = getSession();
    this.el.session.innerHTML = s
      ? `${tr('Sesión iniciada como {0}', `<b>${esc(s.username)}</b>`)} <button type="button" class="au-link mn-logout">${tr('Cerrar sesión')}</button>`
      : `${tr('Sin sesión: el multijugador y los logros necesitan una cuenta.')} <button type="button" class="au-link mn-login">${tr('Iniciar sesión')}</button>`;
    this.el.name.readOnly = !!s;
    this.el.name.classList.toggle('locked', !!s);
    if (s) this.el.name.value = s.username;
  }

  // Pantalla de cuenta. form: 'login' | 'register' | 'reset'; after: qué hacer al iniciar sesión
  _openAuth(form, after, msg = '') {
    if (after !== undefined) this._authAfter = after || null;
    this._authForm = form;
    const T = {
      login: [tr('Iniciar sesión'), tr('Entra con tu cuenta para jugar en multijugador y guardar tus logros.'), tr('Contraseña'), tr('Entrar')],
      register: [tr('Crear cuenta'), tr('Usuario de 3 a 16 caracteres (letras, números, punto, guion o guion bajo) y contraseña de al menos 6.'), tr('Contraseña'), tr('Crear cuenta')],
      reset: [tr('Restablecer contraseña'), tr('Escribe tu usuario y la contraseña nueva dos veces.'), tr('Contraseña nueva'), tr('Cambiar contraseña')],
    }[form];
    const box = this.root.querySelector('.au-box');
    box.dataset.form = form;
    this.root.querySelector('.au-title').textContent = T[0];
    this.root.querySelector('.au-sub').textContent = T[1];
    this.root.querySelector('.au-pass-label').textContent = T[2];
    this.root.querySelector('.au-submit').textContent = T[3];
    this.el.auPass.autocomplete = form === 'login' ? 'current-password' : 'new-password';
    this.el.auPass.value = '';
    this.el.auConfirm.value = '';
    if (!this.el.auUser.value && getSession()) this.el.auUser.value = getSession().username;
    this._authStatus(msg, !!msg);
    if (this.mode !== 'auth') { this._backMode = 'main'; this._backFn = null; }
    this._open('auth');
    setTimeout(() => { try { (this.el.auUser.value ? this.el.auPass : this.el.auUser).focus({ preventScroll: true }); } catch { /* nada */ } }, 50);
  }

  _authStatus(text, error = true) {
    this.el.auStatus.textContent = text || '';
    this.el.auStatus.classList.toggle('error', !!text && error);
  }

  async _submitAuth() {
    if (this._authBusy) return;
    const form = this._authForm;
    const user = this.el.auUser.value.trim();
    const pass = this.el.auPass.value;
    const confirm = this.el.auConfirm.value;
    if (!user || !pass) { this._authStatus(tr('Escribe tu usuario y tu contraseña.')); return; }
    if (form !== 'login' && pass !== confirm) { this._authStatus(tr('Las contraseñas no coinciden.')); return; }
    this._authBusy = true;
    this.root.querySelector('.au-submit').disabled = true;
    this._authStatus(tr('Un momento…'), false);
    let r;
    if (form === 'login') r = await login(user, pass);
    else if (form === 'register') r = await register(user, pass);
    else r = await resetPass(user, pass, confirm);
    this._authBusy = false;
    this.root.querySelector('.au-submit').disabled = false;
    if (r.error) { this._authStatus(AUTH_ERRORS[r.error] ? tr(AUTH_ERRORS[r.error]) : tr('No se pudo completar. Inténtalo de nuevo.')); return; }
    this.el.auPass.value = '';
    this.el.auConfirm.value = '';
    this._renderSession();
    if (form === 'reset') {
      // Contraseña cambiada: de vuelta al inicio, con el aviso en la tarjeta del título
      this._authAfter = null;
      this._open('main');
      this._paintSwatches();
      this.el.joinStatus.textContent = tr('Contraseña actualizada. Ya puedes iniciar sesión con la nueva.');
      return;
    }
    const after = this._authAfter;
    this._authAfter = null;
    this._open('main');
    this._paintSwatches();
    if (typeof after === 'function') after();
  }

  _setJoining(on, mode = 'multi') {
    this.joining = !!on;
    clearTimeout(this._joinTimer);
    this.el.joinBtn.disabled = this.joining;
    this.el.soloBtn.disabled = this.joining;
    this.el.joinBtn.textContent = this.joining && mode === 'multi' ? tr('Conectando…') : tr('Multijugador');
    this.el.soloBtn.textContent = this.joining && mode === 'solo' ? tr('Conectando…') : tr('Un jugador');
    this.el.joinStatus.textContent = this.joining ? tr('Conectando con {0}…', location.host || 'el servidor') : '';
    // Si no hay respuesta, se vuelve a habilitar el botón
    if (this.joining) this._joinTimer = setTimeout(() => this._setJoining(false), 9000);
  }

  // ------------------------------------------------------------------ buscador de salas
  _renderRoomList(list) {
    this._roomsList = Array.isArray(list) ? list : [];
    if (!this.el.rmList) return;
    const rooms = this._roomsList;
    this.el.rmEmpty.style.display = rooms.length ? 'none' : 'block';
    this.el.rmList.innerHTML = rooms.map((r) => {
      const code = esc(String(r.code || ''));
      const name = esc(r.name || r.code || '');
      const n = Math.max(0, +r.players || 0), max = Math.max(1, +r.max || 4);
      const full = n >= max;
      const playing = r.phase === 'playing';
      const badge = playing ? tr('Ronda {0}', Math.max(1, +r.round || 1)) : (r.phase === 'gameover' ? tr('Fin de la partida') : tr('En sala de espera'));
      return `<div class="rm-row${full ? ' full' : ''}" data-code="${code}" data-locked="${r.locked ? '1' : '0'}">
        <span class="rm-lock" aria-hidden="true">${r.locked ? '🔒' : ''}</span>
        <span class="rm-info"><span class="rm-name2">${name}</span><span class="rm-sub">${tr('Código')}: ${code} · ${esc(tr(r.mapName || ''))} · ${badge}</span></span>
        <span class="rm-count">${n}/${max}</span>
        <button type="button" class="mn-btn small primary rm-join-btn" ${full ? 'disabled' : ''}>${tr('Entrar')}</button>
      </div>`;
    }).join('');
  }

  _roomStatus(text, isError) {
    this.el.rmStatus.textContent = text || '';
    this.el.rmStatus.classList.toggle('error', !!isError);
  }

  // Llamado desde main.js cuando llega 'rooms' o 'roomDeny' del servidor
  onRoomsList(list) { this._renderRoomList(list); }
  onRoomDeny(reason, text) {
    if (this.mode !== 'rooms') return;
    this._roomStatus(text || tr('No se pudo unir a la sala.'), true);
    if (this.el.rmCreateBtn) this.el.rmCreateBtn.disabled = false;
  }

  _startJoinRoom(code, locked) {
    if (!locked) { this._doJoinRoom(code, ''); return; }
    this._pendingJoinCode = code;
    this._askConfirm(tr('Sala protegida'), tr('Esta sala tiene contraseña.'), tr('Entrar'), (pw) => {
      this._doJoinRoom(this._pendingJoinCode, pw);
    }, { password: true });
  }

  _doJoinRoom(code, password) {
    if (!this._roomCb || typeof this._roomCb.onJoin !== 'function') return;
    this._roomStatus(tr('Uniéndose…'));
    this._roomCb.onJoin({ code, password });
  }

  _createRoomFromForm() {
    if (!this._roomCb || typeof this._roomCb.onCreate !== 'function') return;
    const name = (this.el.rmName.value || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    const password = this.el.rmPwOn.checked ? (this.el.rmPwInput.value || '').slice(0, 32) : '';
    if (this.el.rmPwOn.checked && !password) { this._roomStatus(tr('Escribe una contraseña o desmarca la casilla.'), true); return; }
    this._roomStatus(tr('Creando sala…'));
    const map = this.el.rmMap ? this.el.rmMap.value : DEFAULT_MAP;
    this._roomCb.onCreate({ name, password, map });
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
        html += `<div class="lb-slot empty"><span class="lb-color"></span><span class="lb-name">${tr('Esperando jugador…')}</span><span class="lb-state"></span></div>`;
        continue;
      }
      const me = String(p.id) === selfKey;
      const col = safeColor(p.color);
      html += `<div class="lb-slot${me ? ' me' : ''}${p.ready ? ' ready' : ''}" style="--pc:${col}">` +
        `<span class="lb-color"></span>` +
        `<span class="lb-name">${esc(p.name || tr('Jugador'))}${me ? `<em class="lb-you">${tr('(tú)')}</em>` : ''}${p.host ? `<span class="lb-host">${tr('Anfitrión')}</span>` : ''}</span>` +
        `<span class="lb-state">${p.ready ? tr('Listo') : tr('Esperando')}</span></div>`;
    }
    this.el.lbSlots.innerHTML = html;
    const readyN = players.filter((p) => p.ready).length;
    this.el.lbCount.textContent = `${players.length}/${MAX_PLAYERS}`;
    this.el.lbStatus.textContent = players.length
      ? (readyN === players.length ? tr('¡Todos listos!') : (players.length === 1 ? tr('{0} de {1} jugador listo', readyN, players.length) : tr('{0} de {1} jugadores listos', readyN, players.length)))
      : tr('Conectando…');
    this.el.lbStatus.classList.toggle('all', players.length > 0 && readyN === players.length);

    // Botones
    const ready = this._readyPending != null ? this._readyPending : !!(self && self.ready);
    this.el.lbReady.textContent = ready ? tr('Cancelar listo') : tr('Listo');
    this.el.lbReady.classList.toggle('on', ready);
    this.el.lbReady.disabled = !self;
    const host = !!(self && self.host);
    this.el.lbStart.style.display = host ? '' : 'none';
    this.el.lbStart.disabled = performance.now() < this._startCooldown;
    this.el.lbStart.textContent = host && players.length > 1 && readyN < players.length ? tr('Iniciar de todos modos') : tr('Iniciar partida');
    this.el.lbWait.style.display = host ? 'none' : '';
    this.el.lbWait.textContent = host ? '' : tr('El anfitrión iniciará la partida cuando todos estén listos.');
    this.el.devTag.style.display = ctx.dev ? '' : 'none';

    // Invitación: si hay una sala (server público), un código/link; si no, las IPs LAN del anfitrión
    const room = ctx.room;
    // Un jugador: no hay a quién invitar
    this.root.querySelector('.lb-lan').hidden = !!(room && room.solo);
    if (room && room.code) {
      const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(room.code)}`;
      this.el.lbLanTitle.textContent = tr('Invita a tus amigos');
      this.el.lbLanText.textContent = tr('Comparte el código o el link de la sala:');
      this.el.lbUrls.innerHTML =
        `<div class="lb-url"><code>${esc(room.code)}</code><button type="button" class="mn-btn small lb-copy" data-url="${esc(room.code)}">${tr('Copiar')}</button></div>` +
        `<div class="lb-url"><code>${esc(link)}</code><button type="button" class="mn-btn small lb-copy" data-url="${esc(link)}">${tr('Copiar')}</button></div>`;
    } else {
      let urls = Array.isArray(ctx.lan) ? ctx.lan.filter((u) => typeof u === 'string' && u) : [];
      if (!urls.length) urls = [location.origin];
      this.el.lbLanTitle.textContent = tr('Invita a tus amigos');
      this.el.lbLanText.textContent = tr('Comparte esta dirección con tus amigos (misma red):');
      this.el.lbUrls.innerHTML = urls.map((u) =>
        `<div class="lb-url"><code>${esc(u)}</code><button type="button" class="mn-btn small lb-copy" data-url="${esc(u)}">${tr('Copiar')}</button></div>`).join('');
    }
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
      el.textContent = tr(TIPS[this._tipIdx]);
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
    const line = { sys, name: sys ? tr('Sistema') : String(e.name || (p && p.name) || tr('Jugador')), color: safeColor(p && p.color), msg: sys ? tr(String(e.msg || '')) : String(e.msg || '') };
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
      d.textContent = tr('Todavía no hay mensajes. ¡Saluda a tu equipo!');
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
  _send(msg) {
    try { if (this.ctx.net && typeof this.ctx.net.send === 'function') this.ctx.net.send(msg); } catch { /* nada */ }
  }

  // Otro jugador pausó: todos ven el menú de pausa (salvo que ya tengan otra pantalla abierta)
  onRemotePause() {
    const gs = this.ctx.gs;
    if (!gs || gs.phase !== 'playing' || this.mode) return;
    this._openPause(true);
  }

  // Alguien reanudó (o pasaron 5 minutos): se cierra la pausa en todos los clientes
  onRemoteResume() {
    if (this.mode === 'pause' || ((this.mode === 'settings' || this.mode === 'controls') && this._backMode === 'pause')) {
      this._closeConfirm();
      this.hideAll();
      this._requestLock();
    }
  }

  _renderPauseInfo() {
    const gs = this.ctx.gs;
    let self = null;
    try { self = this.ctx.self; } catch { self = null; }
    const parts = [];
    if (gs && gs.round > 0) parts.push(tr('Ronda {0}', gs.round | 0));
    parts.push(esc(MAP_NAME));
    if (self) parts.push(tr('{0} puntos', (self.points | 0).toLocaleString(getLang())));
    let html = parts.map((p) => `<span>${p}</span>`).join('<span class="mn-dot">·</span>');
    const P = gs && gs.pause;
    if (P) {
      const left = Math.max(0, (P.leftMs || 0) - (performance.now() - (P.receivedAt || performance.now())));
      const m = Math.floor(left / 60000), sec = Math.floor((left % 60000) / 1000);
      html += `<div class="mn-pause-by">${tr('Pausada por {0} · se reanuda sola en {1}', esc(P.name || '?'), `${m}:${String(sec).padStart(2, '0')}`)}</div>`;
    }
    if (this.el.pauseInfo.innerHTML !== html) this.el.pauseInfo.innerHTML = html;
  }

  // ------------------------------------------------------------------ fin de partida
  _renderGameOver(round, stats) {
    const gs = this.ctx.gs || {};
    const players = gs.players || {};
    this.el.goSub.innerHTML = round > 0
      ? (round === 1 ? tr('Sobreviviste {0} ronda', `<b>${round}</b>`) : tr('Sobreviviste {0} rondas', `<b>${round}</b>`))
      : tr('No sobreviviste ninguna ronda');
    const rows = stats.map((s) => ({
      id: s.id, name: String(s.name || (players[s.id] && players[s.id].name) || tr('Jugador')),
      color: safeColor(s.color || (players[s.id] && players[s.id].color)),
      points: s.points | 0, kills: s.kills | 0, headshots: s.headshots | 0, downs: s.downs | 0, revives: s.revives | 0,
    })).sort((a, b) => b.points - a.points || b.kills - a.kills);
    const selfKey = this.ctx.selfId != null ? String(this.ctx.selfId) : null;
    const best = rows.length > 1 ? rows.reduce((m, r) => (r.kills > m.kills ? r : m), rows[0]) : null;
    this.el.goBody.innerHTML = rows.map((r, i) => {
      const me = String(r.id) === selfKey;
      const mvp = best && r === best && r.kills > 0;
      return `<tr class="go-row${me ? ' me' : ''}${mvp ? ' mvp' : ''}" style="--pc:${r.color};--i:${i}">` +
        `<td class="go-name"><i class="go-dot"></i>${esc(r.name)}${mvp ? `<span class="go-badge">${tr('Más bajas')}</span>` : ''}</td>` +
        `<td>${r.points.toLocaleString(getLang())}</td><td>${r.kills}</td><td>${r.headshots}</td><td>${r.downs}</td><td>${r.revives}</td></tr>`;
    }).join('') || `<tr><td colspan="6" class="go-empty">${tr('Sin datos')}</td></tr>`;
    if (rows.length > 1) {
      const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
      this.el.goFoot.innerHTML = `<tr><td class="go-name">${tr('Equipo')}</td><td>${sum('points').toLocaleString(getLang())}</td><td>${sum('kills')}</td>` +
        `<td>${sum('headshots')}</td><td>${sum('downs')}</td><td>${sum('revives')}</td></tr>`;
    } else {
      this.el.goFoot.innerHTML = '';
    }
  }

  _tickGameOver() {
    if (this.mode !== 'gameover') { clearInterval(this._goTimer); this._goTimer = 0; return; }
    const rem = Math.max(0, Math.ceil((this._goEndsAt - performance.now()) / 1000));
    const txt = rem > 0 ? tr('Volviendo a la sala de espera en {0} s…', rem) : tr('Volviendo a la sala de espera…');
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
    sanitizeGfx(s);
    return s;
  }

  _syncSettingsUI() {
    const s = this._sanitize(this._settings());
    for (const r of this.el.stRanges) r.value = String(s[r.dataset.key]);
    for (const v of this.el.stVals) v.textContent = fmtSetting(v.dataset.val, s[v.dataset.val]);
    for (const b of this.el.stSeg) {
      const on = b.dataset.v === String(s[b.dataset.set]);
      b.classList.toggle('sel', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    for (const c of this.el.stChecks) c.checked = !!s[c.dataset.key];
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
  // opts.password: true muestra un campo de contraseña; onYes recibe su valor (o undefined si no aplica)
  _askConfirm(title, text, yesLabel, onYes, opts = {}) {
    this.el.cfTitle.textContent = title;
    this.el.cfText.textContent = text;
    this.el.cfYes.textContent = yesLabel || tr('Aceptar');
    this.el.cfYes.classList.toggle('danger', !opts.password);
    this.el.cfYes.classList.toggle('primary', !!opts.password);
    this._confirmYes = onYes;
    this._confirmPw = !!opts.password;
    this.el.cfPw.value = '';
    this.el.cfPw.hidden = !opts.password;
    this.el.confirm.classList.add('on');
    const toFocus = opts.password ? this.el.cfPw : this.el.cfNo;
    try { toFocus.focus({ preventScroll: true }); } catch { /* nada */ }
  }

  _closeConfirm() {
    this._confirmYes = null;
    this._confirmPw = false;
    this.el.cfPw.value = '';
    this.el.cfPw.hidden = true;
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
    this.el.joinBtn.addEventListener('click', () => this._join('multi'));
    this.el.soloBtn.addEventListener('click', () => this._openSolo());
    for (const b of this.root.querySelectorAll('.so-map')) b.addEventListener('click', () => this._pickSoloMap(b.dataset.map));
    this.root.querySelector('.so-start').addEventListener('click', () => { this._open('main'); this._paintSwatches(); this._join('solo'); });
    this.root.querySelector('.so-back').addEventListener('click', () => this._goBack());
    this.el.session.addEventListener('click', async (e) => {
      if (e.target.closest('.mn-login')) this._openAuth('login', null);
      else if (e.target.closest('.mn-logout')) { await logout(); this._renderSession(); this.el.name.value = ''; }
    });
    // Cuenta
    this.root.querySelector('.au-box').addEventListener('submit', (e) => { e.preventDefault(); this._submitAuth(); });
    for (const b of this.root.querySelectorAll('.au-link[data-go]')) b.addEventListener('click', () => this._openAuth(b.dataset.go));
    this.root.querySelector('.au-back').addEventListener('click', () => { this._authAfter = null; this._goBack(); });
    this.el.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._join(); }
    });
    this.el.swatches.addEventListener('click', (e) => {
      const b = e.target.closest('.mn-swatch');
      if (!b) return;
      this.color = b.dataset.color;
      this._paintSwatches();
    });

    // Salas
    this.el.rmRefresh.addEventListener('click', () => { if (this._roomCb && this._roomCb.onRefresh) this._roomCb.onRefresh(); });
    this.el.rmBack.addEventListener('click', () => { if (this._roomCb && this._roomCb.onBack) this._roomCb.onBack(); });
    this.el.rmCreateBtn.addEventListener('click', () => this._createRoomFromForm());
    this.el.rmPwOn.addEventListener('change', () => { this.el.rmPwInput.hidden = !this.el.rmPwOn.checked; });
    this.el.rmList.addEventListener('click', (e) => {
      const b = e.target.closest('.rm-join-btn');
      if (!b || b.disabled) return;
      const row = b.closest('.rm-row');
      if (!row) return;
      this._startJoinRoom(row.dataset.code, row.dataset.locked === '1');
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
    root.querySelector('.mn-open-leaders').addEventListener('click', () => this._openStats('leaders'));
    root.querySelector('.mn-open-achv').addEventListener('click', () => this._openStats('achv'));

    // Sala
    this.el.lbReady.addEventListener('click', () => this._sendReady());
    this.el.lbStart.addEventListener('click', () => this._sendStart());
    root.querySelector('.lb-leave').addEventListener('click', () => {
      this._askConfirm(tr('¿Salir de la sala?'), tr('Te desconectarás del servidor y volverás a la pantalla de título.'), tr('Salir'), () => this._leave());
    });
    this.el.lbUrls.addEventListener('click', (e) => {
      const b = e.target.closest('.lb-copy');
      if (!b) return;
      copyText(b.dataset.url || '').then((ok) => {
        b.textContent = ok ? tr('¡Copiado!') : tr('Selecciona y copia');
        b.classList.toggle('done', !!ok);
        setTimeout(() => { b.textContent = tr('Copiar'); b.classList.remove('done'); }, 1800);
      });
    });
    this.el.lbEntry.addEventListener('submit', (e) => { e.preventDefault(); this._sendChat(); });

    // Pausa
    root.querySelector('.ps-continue').addEventListener('click', () => this.togglePause());
    root.querySelector('.ps-exit').addEventListener('click', () => {
      this._askConfirm(tr('¿Salir de la partida?'), tr('Te desconectarás y perderás tu progreso en esta partida. Tus compañeros seguirán jugando.'), tr('Salir'), () => this._leave());
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
        const key = b.dataset.set;
        for (const o of this.el.stSeg) {
          if (o.dataset.set !== key) continue;
          o.classList.toggle('sel', o === b); o.setAttribute('aria-checked', o === b ? 'true' : 'false');
        }
        const raw = b.dataset.v;
        this._setSetting(key, /^\d+$/.test(raw) ? Number(raw) : raw, true);
      });
    }
    for (const c of this.el.stChecks) c.addEventListener('change', () => this._setSetting(c.dataset.key, c.checked, true));
    // Idioma: se guarda y la página se recarga (en partida, se vuelve a entrar al recargar)
    for (const b of root.querySelectorAll('.st-lang, .mn-lang')) {
      b.addEventListener('click', () => {
        const l = b.dataset.lang;
        if (!l || l === getLang()) return;
        const apply = () => { setLang(l); location.reload(); };
        const gs = this.ctx.gs;
        if (gs && gs.phase === 'playing') {
          this._askConfirm(tr('¿Cambiar de idioma?'), tr('La página se recargará y volverás a entrar en la partida (aparecerás en la siguiente ronda).'), tr('Cambiar'), apply);
        } else apply();
      });
    }
    root.querySelector('.st-reset').addEventListener('click', () => this._resetSettings());

    // Confirmación
    this.el.cfNo.addEventListener('click', () => this._closeConfirm());
    this.el.cfYes.addEventListener('click', () => {
      const fn = this._confirmYes;
      const pw = this.el.cfPw.value;
      this._closeConfirm();
      if (typeof fn === 'function') fn(pw);
    });
    this.el.cfPw.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.el.cfYes.click(); }
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
      else if (['settings', 'controls', 'leaders', 'achv', 'auth', 'solo'].includes(this.mode)) { e.preventDefault(); this._authAfter = null; this._goBack(); }
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
    on('net:rooms', (m) => this.onRoomsList(m.list));
    on('net:roomDeny', (m) => {
      const TEXT = {
        notfound: tr('Esa sala ya no existe.'),
        password: tr('Contraseña incorrecta.'),
        full: tr('Esa sala está llena.'),
        bad: tr('No se pudo unir a la sala.'),
        auth: tr('Tu sesión caducó: vuelve a iniciar sesión.'),
      };
      if (m.reason === 'auth') { clearSession(); this._renderSession(); }
      this.onRoomDeny(m.reason, TEXT[m.reason] || tr('No se pudo unir a la sala.'));
    });
    on('settings', (s) => {
      // Otro módulo cambió los ajustes: refrescar controles si la pantalla está abierta
      if (this.mode === 'settings' && s && !this._emitting) this._syncSettingsUI();
    });
  }
}

export default Menus;
