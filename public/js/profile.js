// Sesión del usuario (cuentas en la base de datos del servidor): se guarda el token en este
// navegador para no tener que iniciar sesión cada vez. Al reiniciar el servidor el token caduca.

const AUTH_KEY = 'zlan.auth';
let session = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    return s && typeof s.token === 'string' && typeof s.username === 'string' ? s : null;
  } catch { return null; }
}
function store(s) {
  session = s;
  try { if (s) localStorage.setItem(AUTH_KEY, JSON.stringify(s)); else localStorage.removeItem(AUTH_KEY); } catch { /* sin almacenamiento */ }
}

export const getSession = () => session;
export const authToken = () => (session ? session.token : null);
export const clearSession = () => store(null);

async function post(path, body) {
  let r;
  try {
    r = await fetch(path, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
      body: JSON.stringify(body || {}),
    });
  } catch { return { error: 'network' }; }
  let data = {};
  try { data = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) return { error: data.error || (r.status === 404 ? 'old' : 'server') };
  return data;
}

// Devuelven { ok: true } o { error: código } (ver AUTH_ERRORS en menus.js)
export async function login(username, password) {
  const r = await post('/api/login', { username, password });
  if (r.error) return r;
  store({ token: r.token, username: r.user.username });
  return { ok: true };
}
export async function register(username, password) {
  const r = await post('/api/register', { username, password });
  if (r.error) return r;
  store({ token: r.token, username: r.user.username });
  return { ok: true };
}
export async function resetPass(username, password, confirm) {
  const r = await post('/api/reset', { username, password, confirm });
  return r.error ? r : { ok: true };
}
export async function logout() {
  await post('/api/logout');
  store(null);
}

// Comprueba que la sesión guardada siga valiendo (el servidor pudo reiniciarse). Devuelve { user, db }.
export async function checkSession() {
  try {
    const r = await fetch('/api/me', { cache: 'no-store', headers: session ? { Authorization: `Bearer ${session.token}` } : {} });
    const d = await r.json();
    if (session && !d.user) store(null);
    return { user: d.user || null, db: !!d.db };
  } catch { return { user: session ? { username: session.username } : null, db: true }; }
}

// Tabla de puntos + tu perfil (si has iniciado sesión): { top, meRow, total, me }
export async function fetchStats() {
  const r = await fetch('/api/stats', { cache: 'no-store', headers: session ? { Authorization: `Bearer ${session.token}` } : {} });
  if (r.status === 503) throw new Error('nodb');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
