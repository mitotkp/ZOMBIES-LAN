// Easter egg del Castillo Vorkhaus: la búsqueda que abre el salón de baile y termina con el Doctor Vorkhaus.
//
//  1. Encender la electricidad (en el laboratorio).
//  2. Recoger los 3 viales de sangre repartidos al azar por el castillo.
//  3. El Conde huele la sangre y aparece en la siguiente ronda: hay que matarlo con un arma del Pack-a-Punch
//     para que suelte su colmillo (si no, vuelve en la ronda siguiente). Recoger el colmillo.
//  4. Cargar viales y colmillo en la centrifugadora del laboratorio y defenderla 90 s (solo avanza con alguien cerca).
//  5. Encender los 4 braseros del patio en el orden que muestra la pantalla del laboratorio (si fallas, se apagan).
//  6. Se abre la puerta sellada del salón de baile. Al entrar empieza la batalla final contra el Doctor Vorkhaus:
//     se detienen las rondas; al vencerle, victoria, recompensa y la partida sigue.
//
// Estado compartido en gs.ee (lo lee el cliente para avisos, pantallas y objetos).

import { PERK_KEYS } from '../shared/perks.js';

const CENTRI_TIME = 90;       // s de centrifugado
const CENTRI_RADIUS = 7;      // m: alguien tiene que estar cerca para que avance
const PICK_RADIUS = 1.4;
const REWARD_POINTS = 5000;

export const EE_STEP = { POWER: 0, VIALS: 1, VAMPIRE: 2, FANG: 3, CENTRIFUGE: 4, BRAZIERS: 5, BALLROOM: 6, FIGHT: 7, WON: 8 };

export class EasterEgg {
  constructor(game) {
    this.game = game;
    this.M = game.M;
    this.E = game.M.EE;
  }

  get enabled() { return !!this.E; }

  // Estado inicial (gs.ee)
  fresh() {
    if (!this.E) return null;
    const idx = this.E.vials.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const order = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return {
      step: EE_STEP.POWER,
      vials: idx.slice(0, 3),          // escondites activos
      got: [],                         // escondites ya recogidos
      fang: null,                      // { x, y, z } colmillo en el suelo
      centri: 0,                       // s de centrifugado acumulados
      order,                           // orden de los braseros (índices)
      lit: [],                         // braseros encendidos en orden
      bossId: null,
    };
  }

  get st() { return this.game.gs.ee; }

  // Aviso para todos: k es la clave del texto (el cliente lo muestra y lo traduce, ver ui/hud.js)
  _say(k, extra = {}) {
    this.game._ev({ e: 'ee', k, step: this.st.step, ...extra });
    this.game._log(`[easter egg] ${k} (paso ${this.st.step})`);
  }

  _advance(step, k, extra) {
    this.st.step = step;
    this.game.markDirty();
    this._say(k, extra);
  }

  // ------------------------------------------------------------------ ganchos desde Game
  onPower() {
    if (!this.E || !this.st || this.st.step !== EE_STEP.POWER) return;
    this._advance(EE_STEP.VIALS, 'start');
  }

  // el Conde acude en la siguiente ronda (y en cada una hasta que le arranquen el colmillo)
  _summonCount() { this.game.zombies.forceBoss = 'vampire'; }

  onKill(z, p, info) {
    const s = this.st;
    if (!s) return;
    if (z.type === 'vampire' && s.step === EE_STEP.VAMPIRE) {
      const pap = !!(info && info.upgraded);
      if (pap) {
        s.fang = { x: Math.round(z.x * 100) / 100, y: Math.round((z.y || 0) * 100) / 100, z: Math.round(z.z * 100) / 100 };
        this._advance(EE_STEP.FANG, 'fang', { x: s.fang.x, y: s.fang.y, z: s.fang.z });
      } else {
        this._summonCount();
        this._say('noPap');
      }
    }
    if (z.type === 'scientist' && s.step === EE_STEP.FIGHT) this._victory(p);
  }

  use(p, d, it, now) {
    const s = this.st;
    if (!s) return;
    const parts = it.id.split(':');
    if (parts[1] === 'vial') {
      const i = Number(parts[2]);
      if (s.step !== EE_STEP.VIALS || !s.vials.includes(i) || s.got.includes(i)) return;
      s.got.push(i);
      this.game.markDirty();
      this.game._ev({ e: 'eePick', what: 'vial', i, pid: p.id });
      if (s.got.length >= 3) this._summonCount();
      if (s.got.length >= 3) this._advance(EE_STEP.VAMPIRE, 'vials');
      else this._say('vial', { n: s.got.length, pid: p.id });
    } else if (parts[1] === 'centri') {
      if (s.step !== EE_STEP.FANG || s.fang) return;           // hay que tener el colmillo
      this._advance(EE_STEP.CENTRIFUGE, 'centri');
      this.game.zombies.rush = true;
    } else if (parts[1] === 'braz') {
      const i = Number(parts[2]);
      if (s.step !== EE_STEP.BRAZIERS || s.lit.includes(i)) return;
      if (s.order[s.lit.length] === i) {
        s.lit.push(i);
        this.game.markDirty();
        this.game._ev({ e: 'eeBrazier', i, ok: true, pid: p.id });
        if (s.lit.length === 4) this._openBallroom();
      } else {
        s.lit = [];
        this.game.markDirty();
        this.game._ev({ e: 'eeBrazier', i, ok: false, pid: p.id });
        this._say('brazFail');
      }
    }
    void d; void now;
  }

  tick(now, dt) {
    const s = this.st;
    if (!s) return;
    const g = this.game;
    // recoger el colmillo pasando por encima
    if (s.step === EE_STEP.FANG && s.fang) {
      for (const p of g._players()) {
        const d = g.pd.get(p.id);
        if (p.state !== 'alive' || !d || !d.hasPos) continue;
        if (Math.hypot(d.x - s.fang.x, d.z - s.fang.z) <= PICK_RADIUS && Math.abs((d.y || 0) - s.fang.y) < 1.8) {
          s.fang = null;
          g.markDirty();
          g._ev({ e: 'eePick', what: 'fang', pid: p.id });
          this._say('fangGot', { pid: p.id });
          break;
        }
      }
    }
    // centrifugado: avanza con alguien cerca
    if (s.step === EE_STEP.CENTRIFUGE) {
      const c = this.E.centrifuge;
      const cy = this.M.baseY(c.lv);
      const near = g._players().some((p) => {
        const d = g.pd.get(p.id);
        return p.state === 'alive' && d && Math.hypot(d.x - (c.x + 0.5), d.z - (c.z + 0.5)) <= CENTRI_RADIUS && Math.abs((d.y || 0) - cy) < 2;
      });
      if (near) {
        const before = Math.floor(s.centri / 10);
        s.centri = Math.min(CENTRI_TIME, s.centri + dt);
        if (Math.floor(s.centri / 10) !== before) g.markDirty();
        if (s.centri >= CENTRI_TIME) {
          g.zombies.rush = false;
          this._advance(EE_STEP.BRAZIERS, 'centriDone');
        }
      }
    }
    // entrar en el salón de baile empieza la batalla final
    if (s.step === EE_STEP.BALLROOM) {
      const zone = this.E.ballroom;
      const inside = g._players().some((p) => {
        const d = g.pd.get(p.id);
        if (p.state !== 'alive' || !d || !d.hasPos) return false;
        const lv = this.M.levelOfY(d.y || 0);
        return this.M.zoneAtL(lv, Math.floor(d.x), Math.floor(d.z)) === zone;
      });
      if (inside) this._startFight();
    }
    if (s.step === EE_STEP.FIGHT && s.bossId != null && !g.zombies.get(s.bossId)) {
      // el jefe desapareció sin morir (no debería): se vuelve a invocar
      this._spawnScientist();
    }
  }

  // ------------------------------------------------------------------ transiciones
  _openBallroom() {
    const g = this.game;
    const door = this.M.DOORS.find((d) => d.sealed);
    if (door) g._openDoor(door, null);
    this._advance(EE_STEP.BALLROOM, 'ballroom');
  }

  _startFight() {
    const g = this.game;
    const zm = g.zombies;
    // el castillo se estremece: caen los zombis de fuera y se detienen las rondas
    zm.killAll('nuke');
    zm.pauseSpawns = true;
    zm.queue = 0;
    zm.rush = false;
    this.st.step = EE_STEP.FIGHT;
    this._spawnScientist();
    g.markDirty();
    this._say('fight', { id: this.st.bossId });
  }

  _spawnScientist() {
    const g = this.game;
    const sp = this.E.scientist;
    const z = g.zombies.spawnBossAt('scientist', sp.x, sp.z, this.M.baseY(sp.lv));
    this.st.bossId = z ? z.id : null;
  }

  _victory(killer) {
    const g = this.game;
    const s = this.st;
    s.step = EE_STEP.WON;
    s.bossId = null;
    const zm = g.zombies;
    zm.pauseSpawns = false;
    zm.rush = false;
    // recompensa: todas las ventajas (sin límite) y puntos para los que siguen en pie
    for (const p of g._players()) {
      if (p.state === 'dead' || p.state === 'disconnected') continue;
      for (const k of PERK_KEYS) if (!p.perks.includes(k)) g._grantPerk(p, k, true);
      g._addPoints(p, REWARD_POINTS, false);
      g._stat(p, (st) => { st.eeWins++; });
    }
    g.markDirty();
    const stats = g._players().map((p) => ({ id: p.id, name: p.name, color: p.color, points: p.points, kills: p.kills, headshots: p.headshots, downs: p.downs, revives: p.revives }));
    g._ev({ e: 'victory', pid: killer ? killer.id : null, round: g.gs.round, stats, reward: REWARD_POINTS });
    g._log('[easter egg] ¡Victoria! El Doctor Vorkhaus ha sido derrotado.');
    // la ronda en curso termina con normalidad (quedan los vampiros invocados)
  }
}
