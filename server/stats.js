// Estadísticas y logros de los usuarios durante la partida: el perfil de cada usuario conectado
// se carga de la base de datos al entrar, se actualiza en memoria (cada baja, punto...) y se
// guarda cada pocos segundos y al salir. Los logros nuevos se escriben en cuanto se consiguen.

import { dbEnabled, loadProfile, saveStats, unlockAchievement, submitRecord } from './db.js';
import { pendingUnlocks, BOSS_KEYS, FINAL_BOSS_KEYS } from '../shared/achievements.js';

const SAVE_EVERY_MS = 10000;
const KNOWN_BOSSES = new Set([...BOSS_KEYS, ...FINAL_BOSS_KEYS]);
const logErr = (what) => (e) => console.error(`[stats] ${what}:`, e.message);

class StatsService {
  constructor() {
    this.cache = new Map();   // userId -> { p, dirty, refs, queue: [fn] | null }
    this._timer = setInterval(() => this.flush(), SAVE_EVERY_MS);
    if (this._timer.unref) this._timer.unref();
  }

  // Un jugador con cuenta entra en una sala (se puede llamar varias veces: cuenta referencias)
  attach(userId, username) {
    if (!dbEnabled() || userId == null) return;
    let e = this.cache.get(userId);
    if (e) { e.refs++; return; }
    e = { p: null, dirty: false, refs: 1, queue: [] };
    this.cache.set(userId, e);
    loadProfile(userId, username).then((p) => {
      e.p = p;
      // Lo que pasó mientras cargaba (normalmente nada: se carga en la sala de espera)
      for (const fn of e.queue) this._apply(userId, e, fn);
      e.queue = null;
    }, logErr('no se pudo cargar el perfil'));
  }

  detach(userId) {
    const e = this.cache.get(userId);
    if (!e) return;
    if (--e.refs > 0) return;
    this._save(userId, e);
    this.cache.delete(userId);
  }

  // Aplica fn(perfil) y devuelve los ids de los logros que se acaban de desbloquear
  update(userId, fn) {
    const e = this.cache.get(userId);
    if (!e) return [];
    if (!e.p) { e.queue.push(fn); return []; }
    return this._apply(userId, e, fn);
  }

  _apply(userId, e, fn) {
    fn(e.p);
    e.dirty = true;
    const got = pendingUnlocks(e.p);
    const t = Date.now();
    for (const id of got) {
      e.p.ach[id] = t;
      unlockAchievement(userId, id).catch(logErr('no se pudo guardar el logro'));
    }
    return got;
  }

  bossKill(p, key) {
    p.bossKills++;
    if (KNOWN_BOSSES.has(key)) p.bosses[key] = (p.bosses[key] || 0) + 1;
  }

  // Récord de la tabla global (solo multijugador; la BD se queda con el mayor)
  record(userId, round, points) {
    if (!dbEnabled() || userId == null) return;
    submitRecord(userId, round, points).catch(logErr('no se pudo guardar el récord'));
  }

  _save(userId, e) {
    if (!e.p || !e.dirty) return;
    e.dirty = false;
    saveStats(userId, e.p).catch(logErr('no se pudieron guardar las estadísticas'));
  }

  flush() { for (const [id, e] of this.cache) this._save(id, e); }
}

export const stats = new StatsService();
