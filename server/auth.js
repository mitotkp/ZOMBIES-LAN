// Sesiones de usuario (en memoria: al reiniciar el servidor hay que volver a iniciar sesión) y la
// API HTTP de cuentas: POST /api/register, /api/login, /api/reset, /api/logout y GET /api/me.

import crypto from 'node:crypto';
import { dbEnabled, createUser, verifyUser, resetPassword, USERNAME_RE, PASSWORD_MIN } from './db.js';

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_BODY = 4096;
const sessions = new Map();          // token -> { id, username, exp }
const attempts = new Map();          // ip -> [ms de intentos fallidos recientes]

export function sessionUser(token) {
  if (typeof token !== 'string' || token.length !== 64) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.exp) { sessions.delete(token); return null; }
  return { id: s.id, username: s.username };
}

function newSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { id: user.id, username: user.username, exp: Date.now() + SESSION_TTL_MS });
  return token;
}

// Tras cambiar la contraseña se cierran todas las sesiones abiertas de ese usuario
function dropSessions(username) {
  const u = username.toLowerCase();
  for (const [t, s] of sessions) if (s.username.toLowerCase() === u) sessions.delete(t);
}

// Freno contra adivinar contraseñas: como mucho 10 fallos por minuto por IP
function tooMany(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 60000);
  attempts.set(ip, list);
  return list.length >= 10;
}
function fail(ip) { (attempts.get(ip) || attempts.set(ip, []).get(ip)).push(Date.now()); }

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); resolve(null); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(obj));
}

export function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

// Devuelve true si la ruta era de la API de cuentas (y ya se respondió)
export async function handleAuth(req, res, urlPath) {
  const routes = { '/api/register': 1, '/api/login': 1, '/api/reset': 1, '/api/logout': 1, '/api/me': 1 };
  if (!routes[urlPath]) return false;
  if (urlPath === '/api/me') {
    const u = sessionUser(bearer(req));
    send(res, 200, { user: u, db: dbEnabled() });
    return true;
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); send(res, 405, { error: 'method' }); return true; }
  if (urlPath === '/api/logout') { sessions.delete(bearer(req)); send(res, 200, { ok: true }); return true; }
  if (!dbEnabled()) { send(res, 503, { error: 'nodb' }); return true; }
  const ip = (req.socket && req.socket.remoteAddress) || '?';
  if (tooMany(ip)) { send(res, 429, { error: 'wait' }); return true; }
  const body = await readJson(req);
  if (!body) { send(res, 400, { error: 'bad' }); return true; }
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const pass = typeof body.password === 'string' ? body.password : '';
  try {
    if (urlPath === '/api/login') {
      const user = await verifyUser(username, pass);
      if (!user) { fail(ip); send(res, 401, { error: 'invalid' }); return true; }
      send(res, 200, { token: newSession(user), user });
    } else if (urlPath === '/api/register') {
      if (!USERNAME_RE.test(username)) { send(res, 400, { error: 'username' }); return true; }
      if (pass.length < PASSWORD_MIN) { send(res, 400, { error: 'short' }); return true; }
      const r = await createUser(username, pass);
      if (r.error) { send(res, r.error === 'taken' ? 409 : 400, { error: r.error }); return true; }
      send(res, 200, { token: newSession(r.user), user: r.user });
    } else if (urlPath === '/api/reset') {
      if (pass.length < PASSWORD_MIN) { send(res, 400, { error: 'short' }); return true; }
      if (pass !== body.confirm) { send(res, 400, { error: 'mismatch' }); return true; }
      if (!(await resetPassword(username, pass))) { fail(ip); send(res, 404, { error: 'nouser' }); return true; }
      dropSessions(username);
      send(res, 200, { ok: true });
    }
  } catch (e) {
    console.error('[auth] error:', e.message);
    send(res, 500, { error: 'server' });
  }
  return true;
}
