// Base de datos PostgreSQL: usuarios, logros y récords (tabla de puntos global).
// Conexión: variable de entorno DATABASE_URL (o una línea DATABASE_URL=... en database.env, en la raíz
// del proyecto), p. ej. postgres://usuario:clave@host:5432/zombies
// (añade ?sslmode=require si tu servidor lo pide). Para pruebas locales sin servidor también se
// acepta DATABASE_URL=pglite:<carpeta> o pglite:memory si el paquete @electric-sql/pglite está instalado.
// Sin DATABASE_URL el juego funciona igual, pero sin cuentas: no se puede entrar al multijugador.

import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ACHIEVEMENTS, emptyProfile, BOSS_KEYS, FINAL_BOSS_KEYS } from '../shared/achievements.js';
import { ZOMBIE_TYPES } from '../shared/constants.js';

const scrypt = promisify(crypto.scrypt);
const LEADERBOARD_SIZE = 25;
const KNOWN_BOSSES = new Set([...BOSS_KEYS, ...FINAL_BOSS_KEYS]);

export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,16}$/;
export const PASSWORD_MIN = 6;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  username    VARCHAR(16) NOT NULL UNIQUE,
  pass        TEXT NOT NULL,
  reset_token TEXT
);
CREATE TABLE IF NOT EXISTS achievements (
  id          SERIAL PRIMARY KEY,
  achievement VARCHAR(40) NOT NULL UNIQUE,
  description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_achievements (
  id            SERIAL PRIMARY KEY,
  idachievement INTEGER NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  iduser        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unlocked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (iduser, idachievement)
);
CREATE TABLE IF NOT EXISTS user_rounds (
  id       SERIAL PRIMARY KEY,
  iduser   INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  maxround INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS user_points (
  id        SERIAL PRIMARY KEY,
  iduser    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  maxpoints INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS user_stats (
  id         SERIAL PRIMARY KEY,
  iduser     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  kills      INTEGER NOT NULL DEFAULT 0,
  headshots  INTEGER NOT NULL DEFAULT 0,
  boss_kills INTEGER NOT NULL DEFAULT 0,
  bosses     JSONB   NOT NULL DEFAULT '{}'::jsonb,
  best_round INTEGER NOT NULL DEFAULT 0,
  points     BIGINT  NOT NULL DEFAULT 0,
  games      INTEGER NOT NULL DEFAULT 0,
  revives    INTEGER NOT NULL DEFAULT 0,
  ee_wins    INTEGER NOT NULL DEFAULT 0
);`;

let client = null;       // { query(text, params) -> { rows } }
let readyError = null;

export const dbEnabled = () => !!client;
export const dbError = () => readyError;

async function connect(url) {
  if (url.startsWith('pglite:')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const where = url.slice(7);
    const pg = where && where !== 'memory' ? new PGlite(where) : new PGlite();
    await pg.waitReady;
    return { query: (t, p) => pg.query(t, p), close: () => pg.close() };
  }
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  pool.on('error', (e) => console.error('[db] error de conexión:', e.message));
  return { query: (t, p) => pool.query(t, p), close: () => pool.end() };
}

// DATABASE_URL del entorno o, si no está, del archivo database.env de la raíz del proyecto
function configuredUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const file = fileURLToPath(new URL('../database.env', import.meta.url));
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/.exec(line);
      if (m) return m[1];
    }
  } catch { /* sin archivo */ }
  return '';
}

// Crea las tablas si no existen y sincroniza el catálogo de logros. Devuelve true si hay BD.
export async function initDb(url = configuredUrl()) {
  if (!url) return false;
  try {
    const c = await connect(url);
    for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await c.query(stmt);
    for (const a of ACHIEVEMENTS) {
      await c.query(
        'INSERT INTO achievements (achievement, description) VALUES ($1, $2) ON CONFLICT (achievement) DO UPDATE SET description = EXCLUDED.description',
        [a.id, achievementText(a)]);
    }
    client = c;
    return true;
  } catch (e) {
    // Un fallo de red llega como AggregateError sin mensaje: el código (ECONNREFUSED...) es lo útil
    readyError = e.message || e.code || (e.errors && e.errors[0] && (e.errors[0].code || e.errors[0].message)) || String(e);
    console.error('[db] no se pudo conectar con PostgreSQL:', readyError);
    return false;
  }
}

export async function closeDb() {
  if (client && client.close) { try { await client.close(); } catch { /* nada */ } }
  client = null;
}

function achievementText(a) {
  const boss = a.boss && ZOMBIE_TYPES[a.boss] ? ZOMBIE_TYPES[a.boss].name : '';
  return `${a.name}: ${a.desc.replace('{0}', a.goal).replace('{1}', boss)}`;
}

const q = async (text, params) => {
  if (!client) throw new Error('Sin base de datos');
  return (await client.query(text, params)).rows;
};

// ------------------------------------------------------------------ contraseñas

async function hashPassword(pass) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pass, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function checkPassword(pass, stored) {
  const [kind, saltHex, keyHex] = String(stored).split('$');
  if (kind !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(pass, Buffer.from(saltHex, 'hex'), 64);
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

// ------------------------------------------------------------------ usuarios

// Devuelve { user } o { error: 'taken' | 'bad' }
export async function createUser(username, pass) {
  if (!USERNAME_RE.test(username) || typeof pass !== 'string' || pass.length < PASSWORD_MIN) return { error: 'bad' };
  const hash = await hashPassword(pass);
  const rows = await q('INSERT INTO users (username, pass) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING RETURNING id, username', [username, hash]);
  return rows.length ? { user: rows[0] } : { error: 'taken' };
}

// Usuario si la contraseña coincide, null si no (sin distinguir "no existe" de "clave incorrecta")
export async function verifyUser(username, pass) {
  if (typeof username !== 'string' || typeof pass !== 'string') return null;
  const rows = await q('SELECT id, username, pass FROM users WHERE lower(username) = lower($1)', [username]);
  if (!rows.length || !(await checkPassword(pass, rows[0].pass))) return null;
  return { id: rows[0].id, username: rows[0].username };
}

// Cambia la contraseña de un usuario existente. Devuelve false si no existe.
export async function resetPassword(username, pass) {
  if (typeof pass !== 'string' || pass.length < PASSWORD_MIN) return false;
  const hash = await hashPassword(pass);
  const rows = await q('UPDATE users SET pass = $2, reset_token = NULL WHERE lower(username) = lower($1) RETURNING id', [username, hash]);
  return rows.length > 0;
}

// ------------------------------------------------------------------ estadísticas y logros

// Perfil en el formato de shared/achievements.js (el mismo que usan la partida y la pantalla de logros)
export async function loadProfile(userId, username = '') {
  const [s] = await q('SELECT * FROM user_stats WHERE iduser = $1', [userId]);
  const ach = await q(
    'SELECT a.achievement, ua.unlocked_at FROM user_achievements ua JOIN achievements a ON a.id = ua.idachievement WHERE ua.iduser = $1', [userId]);
  const p = emptyProfile(username);
  if (s) {
    Object.assign(p, {
      kills: s.kills, headshots: s.headshots, bossKills: s.boss_kills, bestRound: s.best_round,
      points: Number(s.points), games: s.games, revives: s.revives, eeWins: s.ee_wins,
    });
    for (const [k, v] of Object.entries(s.bosses || {})) if (KNOWN_BOSSES.has(k)) p.bosses[k] = Number(v) || 0;
  }
  for (const r of ach) p.ach[r.achievement] = new Date(r.unlocked_at).getTime();
  return p;
}

export async function saveStats(userId, p) {
  await q(`INSERT INTO user_stats (iduser, kills, headshots, boss_kills, bosses, best_round, points, games, revives, ee_wins)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (iduser) DO UPDATE SET kills = EXCLUDED.kills, headshots = EXCLUDED.headshots, boss_kills = EXCLUDED.boss_kills,
             bosses = EXCLUDED.bosses, best_round = EXCLUDED.best_round, points = EXCLUDED.points, games = EXCLUDED.games,
             revives = EXCLUDED.revives, ee_wins = EXCLUDED.ee_wins`,
  [userId, p.kills, p.headshots, p.bossKills, JSON.stringify(p.bosses), p.bestRound, p.points, p.games, p.revives, p.eeWins]);
}

export async function unlockAchievement(userId, code) {
  await q(`INSERT INTO user_achievements (idachievement, iduser)
           SELECT id, $2 FROM achievements WHERE achievement = $1 ON CONFLICT (iduser, idachievement) DO NOTHING`, [code, userId]);
}

// Récords de la tabla global: solo sube si el valor nuevo es mayor
export async function submitRecord(userId, round, points) {
  await q(`INSERT INTO user_rounds (iduser, maxround) VALUES ($1, $2)
           ON CONFLICT (iduser) DO UPDATE SET maxround = GREATEST(user_rounds.maxround, EXCLUDED.maxround)`, [userId, Math.max(0, round | 0)]);
  await q(`INSERT INTO user_points (iduser, maxpoints) VALUES ($1, $2)
           ON CONFLICT (iduser) DO UPDATE SET maxpoints = GREATEST(user_points.maxpoints, EXCLUDED.maxpoints)`, [userId, Math.max(0, Math.round(points))]);
}

// Tabla de puntos (mejor partida en multijugador) + la fila del usuario si no está entre los primeros
export async function leaderboard(userId) {
  const rows = await q(`
    SELECT u.id, u.username, p.maxpoints, COALESCE(r.maxround, 0) AS maxround, COALESCE(s.kills, 0) AS kills,
           COALESCE(s.boss_kills, 0) AS bosses, (SELECT count(*) FROM user_achievements ua WHERE ua.iduser = u.id) AS ach,
           rank() OVER (ORDER BY p.maxpoints DESC, COALESCE(r.maxround, 0) DESC) AS rank
    FROM user_points p JOIN users u ON u.id = p.iduser
    LEFT JOIN user_rounds r ON r.iduser = u.id LEFT JOIN user_stats s ON s.iduser = u.id
    WHERE p.maxpoints > 0
    ORDER BY rank, u.username`);
  const row = (r) => ({
    rank: Number(r.rank), name: r.username, points: r.maxpoints, bestRound: r.maxround, kills: r.kills,
    bosses: r.bosses, ach: Number(r.ach), me: r.id === userId,
  });
  const top = rows.slice(0, LEADERBOARD_SIZE).map(row);
  const mine = userId != null && !top.some((r) => r.me) ? rows.find((r) => r.id === userId) : null;
  return { top, meRow: mine ? row(mine) : null, total: rows.length };
}
