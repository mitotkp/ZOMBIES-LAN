// Idiomas del juego (español / inglés). El texto fuente es el español: t('Texto en español') devuelve la traducción
// del idioma activo o el propio texto si no hay traducción. Los textos con variables usan {0}, {1}...:
//   t('{0} ha caído', nombre)
// Los argumentos de tipo texto también se traducen (nombres de armas, curas, jefes...).
// El idioma se lee de los ajustes guardados al cargar la página; al cambiarlo la página se recarga, así que
// los carteles del mapa y los menús se construyen ya en el idioma correcto.
import { EN } from './lang/en.js';

const SETTINGS_KEY = 'zlan.settings';
export const LANGS = [{ id: 'es', name: 'Español' }, { id: 'en', name: 'English' }];

function detect() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (s && (s.lang === 'es' || s.lang === 'en')) return s.lang;
  } catch { /* sin almacenamiento */ }
  const nav = typeof navigator !== 'undefined' ? String(navigator.language || '') : '';
  return /^es/i.test(nav) || !nav ? 'es' : 'en';
}

let lang = detect();
const DICTS = { en: EN };

// Plantillas con partes variables ({0}, {1}...) compiladas a expresiones regulares para traducir textos ya
// formateados que llegan del servidor (p. ej. «No tienes vendas.»)
let patterns = null;
function compile(dict) {
  const out = [];
  for (const key of Object.keys(dict)) {
    if (!/\{\d\}/.test(key)) continue;
    const re = new RegExp('^' + key.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\d)\}/g, '(.+?)') + '$');
    out.push([re, dict[key]]);
  }
  return out;
}

export function getLang() { return lang; }

// Cambia el idioma y lo guarda en los ajustes (quien llama recarga la página)
export function setLang(l) {
  if (l !== 'es' && l !== 'en') return;
  lang = l;
  patterns = null;
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    s.lang = l;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch { /* sin almacenamiento */ }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

const fill = (s, args) => s.replace(/\{(\d)\}/g, (m, i) => (args[i] != null ? String(args[i]) : m));

export function t(text, ...args) {
  if (text == null) return '';
  const s = String(text);
  const dict = DICTS[lang];
  if (!dict) return args.length ? fill(s, args) : s;
  const targs = args.map((a) => (typeof a === 'string' ? t(a) : a));
  const tr = dict[s];
  if (tr != null) return targs.length ? fill(tr, targs) : tr;
  if (targs.length) return fill(s, targs);
  // texto ya formateado: prueba las plantillas
  if (!patterns) patterns = compile(dict);
  for (const [re, out] of patterns) {
    const m = re.exec(s);
    if (m) return fill(out, m.slice(1).map((a) => t(a)));
  }
  return s;
}

// Alias corto que se usa en todo el código (t suele ser una variable local de tiempo)
export const tr = t;

if (typeof document !== 'undefined') document.documentElement.lang = lang;
