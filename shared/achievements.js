// Logros y estadísticas acumuladas de cada perfil (compartido: el servidor los desbloquea y el
// cliente dibuja la lista con el progreso de cada uno a partir del mismo perfil).

import { ZOMBIE_TYPES } from './constants.js';

// Jefes que entran en el sorteo normal (el jefe final del Castillo tiene su propio logro)
export const BOSS_KEYS = Object.keys(ZOMBIE_TYPES).filter((k) => ZOMBIE_TYPES[k].boss && !ZOMBIE_TYPES[k].final);
export const FINAL_BOSS_KEYS = Object.keys(ZOMBIE_TYPES).filter((k) => ZOMBIE_TYPES[k].boss && ZOMBIE_TYPES[k].final);

// Perfil vacío: todo lo que se acumula entre partidas y salas
export function emptyProfile(name = '') {
  return {
    name, points: 0, kills: 0, headshots: 0, bossKills: 0, bosses: {}, bestRound: 0,
    games: 0, revives: 0, eeWins: 0, ach: {}, created: Date.now(), seen: Date.now(),
  };
}

// Valor de una estadística ('boss:KEY' = veces que has derrotado a ese jefe)
export function statValue(p, stat) {
  if (!p) return 0;
  if (stat.startsWith('boss:')) return (p.bosses && p.bosses[stat.slice(5)]) || 0;
  if (stat === 'bossTypes') return BOSS_KEYS.filter((k) => p.bosses && p.bosses[k] > 0).length;
  const v = p[stat];
  return Number.isFinite(v) ? v : 0;
}

const A = (id, cat, stat, goal, name, desc) => ({ id, cat, stat, goal, name, desc });

export const ACHIEVEMENTS = [
  // Bajas
  A('kills1', 'kills', 'kills', 1, 'Primera sangre', 'Mata a tu primer zombi'),
  A('kills100', 'kills', 'kills', 100, 'Cazador', 'Mata a {0} zombis'),
  A('kills500', 'kills', 'kills', 500, 'Exterminador', 'Mata a {0} zombis'),
  A('kills1000', 'kills', 'kills', 1000, 'Mil caídos', 'Mata a {0} zombis'),
  A('kills5000', 'kills', 'kills', 5000, 'Azote de la plaga', 'Mata a {0} zombis'),
  A('head100', 'kills', 'headshots', 100, 'Buena puntería', 'Mata a {0} zombis de un tiro a la cabeza'),
  A('head1000', 'kills', 'headshots', 1000, 'Tirador de élite', 'Mata a {0} zombis de un tiro a la cabeza'),
  // Rondas
  A('round5', 'rounds', 'bestRound', 5, 'Superviviente', 'Llega a la ronda {0}'),
  A('round10', 'rounds', 'bestRound', 10, 'Duro de roer', 'Llega a la ronda {0}'),
  A('round15', 'rounds', 'bestRound', 15, 'Veterano', 'Llega a la ronda {0}'),
  A('round20', 'rounds', 'bestRound', 20, 'Inquebrantable', 'Llega a la ronda {0}'),
  A('round30', 'rounds', 'bestRound', 30, 'El último en pie', 'Llega a la ronda {0}'),
  // Jefes
  A('boss1', 'bosses', 'bossKills', 1, 'Matagigantes', 'Derrota a tu primer jefe'),
  A('boss10', 'bosses', 'bossKills', 10, 'Cazador de jefes', 'Derrota a {0} jefes'),
  A('boss50', 'bosses', 'bossKills', 50, 'Pesadilla de pesadillas', 'Derrota a {0} jefes'),
  ...BOSS_KEYS.map((k) => A('boss_' + k, 'bosses', 'boss:' + k, 1, ZOMBIE_TYPES[k].name, 'Derrota a {1}')),
  A('bossAll', 'bosses', 'bossTypes', BOSS_KEYS.length, 'Coleccionista de trofeos', 'Derrota a los {0} jefes distintos'),
  ...FINAL_BOSS_KEYS.map((k) => A('boss_' + k, 'bosses', 'boss:' + k, 1, ZOMBIE_TYPES[k].name, 'Derrota a {1}')),
  // Otros
  A('ee1', 'other', 'eeWins', 1, 'Fin de la pesadilla', 'Completa el easter egg del Castillo'),
  A('revive25', 'other', 'revives', 25, 'Ángel de la guarda', 'Reanima a {0} compañeros'),
  A('points100k', 'other', 'points', 100000, 'Bolsillos llenos', 'Gana {0} puntos en total'),
  A('games25', 'other', 'games', 25, 'Habitual', 'Juega {0} partidas'),
];
// El nombre del jefe va aparte para poder traducir la plantilla ('Derrota a {1}')
for (const a of ACHIEVEMENTS) if (a.stat.startsWith('boss:')) a.boss = a.stat.slice(5);

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

export const ACHIEVEMENT_CATS = [
  ['kills', 'Bajas'], ['rounds', 'Rondas'], ['bosses', 'Jefes'], ['other', 'Otros'],
];

// Logros que el perfil cumple pero aún no tiene marcados
export function pendingUnlocks(p) {
  const out = [];
  for (const a of ACHIEVEMENTS) if (!p.ach[a.id] && statValue(p, a.stat) >= a.goal) out.push(a.id);
  return out;
}
