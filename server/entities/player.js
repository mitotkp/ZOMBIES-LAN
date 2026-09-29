// Clase Player: agrupa los datos y las reglas de UN jugador — lo que se manda por red (lo que antes
// vivía suelto en gs.players[id]) más lo privado del servidor (lo que antes vivía suelto en Game.pd) —
// y expone como métodos reales las acciones que antes eran funciones sueltas dentro de game.js:
// recibir daño, caer, reanimar y procesar el reporte de movimiento del cliente.
//
// Paso 1 de la refactorización (ver plan.md): esta clase todavía NO conoce a `Game` ni dispara eventos
// de red — sus métodos mutan sus propios datos y devuelven un resumen de lo que pasó; quien la llama
// (Game, que sigue siendo el único que sabe de red/eventos/otros jugadores) decide qué anunciar. Así se
// puede razonar sobre las reglas de un jugador sin necesitar todo el servidor levantado, y el resto de
// game.js (compras, ventajas, caja, Pack-a-Punch, puertas...) sigue leyendo/escribiendo los mismos
// objetos de siempre sin cambios: `player.pub` ES gs.players[id] y `player.priv` ES lo que devolvía
// Game.pd.get(id) — mismas referencias, no copias.
//
// Autoridad de movimiento (paso 6): el SERVIDOR simula el movimiento. El cliente ya no manda su posición
// sino comandos (intención por fotograma, ver shared/movement.js); aquí se ejecutan con el mismo
// stepMovement() que usa el cliente para predecir, y se limita el tiempo simulado al tiempo real
// transcurrido (un cliente no puede correr más rápido mandando comandos de más).

import { PLAYER, BALANCE, SHIELD, INFECTION, clamp, angleDiff, yawTo } from '../../shared/constants.js';
import { PF, r2 } from '../../shared/protocol.js';
import { spawnMoveState, stepMovement, unpackCmd } from '../../shared/movement.js';

const DEG = Math.PI / 180;

// Tuneables de validación de movimiento y de reanimar (únicos, importados también por game.js:
// antes vivían duplicados como constantes sueltas en ese archivo).
export const MAX_MOVE_BUDGET = 0.5;    // s: tope de tiempo de movimiento acumulable (ráfagas/jitter de internet)
export const BUDGET_SLACK = 1.15;      // tolerancia sobre el tiempo real (relojes que no coinciden del todo)
export const MAX_CMDS_PER_MSG = 20;    // comandos que se atienden por mensaje 'st'
export const REVIVE_INVULN = 1500;     // ms de invulnerabilidad tras ser reanimado

function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

export class Player {
  // pub  = el objeto que se serializa y manda por red (antes creado por Game._newPlayer, guardado en
  //        gs.players[id]).
  // priv = lo privado del servidor, nunca viaja por red (antes creado por Game._newPriv, guardado en
  //        Game.pd). Puede recrearse (una partida nueva empieza con datos privados frescos): usar
  //        resetPriv() para que esta instancia apunte al objeto nuevo en vez de quedarse con el viejo.
  constructor(pub, priv) {
    this.pub = pub;
    this.priv = priv;
  }

  get id() { return this.pub.id; }

  // Al reiniciar partida/ronda Game reemplaza el objeto privado (this.priv) por completo; esto
  // mantiene esta instancia apuntando al que está en uso.
  resetPriv(priv) { this.priv = priv; }

  // ---------------------------------------------------------------- movimiento
  // Mirada, banderas y arma en mano de un mensaje 'st' (la posición ya no viaja: ver applyMoveCommands).
  applyMovementReport(m) {
    const p = this.pub, d = this.priv;
    if (isNum(m.yaw)) d.yaw = r2(m.yaw);
    if (isNum(m.pitch)) d.pitch = r2(clamp(m.pitch, -1.5, 1.5));
    if (isNum(m.f)) d.flags = (m.f | 0) & 0x3ff;
    let curChanged = false;
    if (Number.isInteger(m.cur)) {
      const c = clamp(m.cur, 0, Math.max(0, p.weapons.length - 1));
      if (c !== p.cur) { p.cur = c; curChanged = true; }
    }
    return { curChanged };
  }

  // Coloca al jugador en un punto (reaparecer, teletransporte): el estado de simulación se rehace desde
  // ahí en el siguiente comando.
  placeAt(x, y, z) {
    const d = this.priv;
    d.x = x; d.y = y; d.z = z;
    d.sim = null;
  }

  // Tras reconectar el cliente empieza su numeración de comandos de cero
  resetMoveSync() {
    this.priv.ackSeq = 0;
    this.priv.sim = null;
  }

  // Ejecuta los comandos de movimiento de un mensaje 'st'. env = { doors, separate? } (el mapa activo ya
  // es el de la sala). Devuelve cuántos comandos movieron al jugador.
  applyMoveCommands(rawCmds, now, env) {
    const p = this.pub, d = this.priv;
    if (p.state === 'dead' || !Array.isArray(rawCmds)) return 0;
    if (!d.sim) d.sim = spawnMoveState(d.x, d.z, d.y, env.doors);
    const elapsed = clamp((now - d.lastCmdAt) / 1000, 0, MAX_MOVE_BUDGET);
    d.lastCmdAt = now;
    d.moveBudget = Math.min(MAX_MOVE_BUDGET, d.moveBudget + elapsed * BUDGET_SLACK);
    const stepEnv = {
      doors: env.doors, down: p.state === 'down', staminUp: Array.isArray(p.perks) && p.perks.includes('staminup'),
      separate: env.separate,
    };
    let applied = 0;
    const n = Math.min(rawCmds.length, MAX_CMDS_PER_MSG);
    for (let i = 0; i < n; i++) {
      const c = unpackCmd(rawCmds[i]);
      if (!c || c.seq <= d.ackSeq) continue;   // repetido o viejo
      d.ackSeq = c.seq;
      const dt = Math.min(c.dt, d.moveBudget);
      if (dt <= 0) continue;                   // sin tiempo disponible: se confirma pero no se mueve
      d.moveBudget -= dt;
      stepMovement(d.sim, c, dt, stepEnv);
      applied++;
    }
    const s = d.sim;
    d.x = s.x; d.y = s.y; d.z = s.z;
    d.hasPos = true;
    return applied;
  }

  // ---------------------------------------------------------------- daño / muerte / reanimación
  // Aplica daño de un zombi, una explosión o cuerpo a cuerpo. Devuelve un resumen para que Game
  // decida qué eventos de red anunciar (shieldHit/shieldBreak/down/infected); esta clase no anuncia
  // nada por sí misma. `attacker` es opcional: { x, z, boss, type } del zombi que golpeó (para el
  // ángulo del escudo y el tope de golpe fuerte de jefes/tanques); `solo` = si es partida de 1 jugador.
  takeDamage(amount, attacker, now, solo) {
    const p = this.pub, d = this.priv;
    if (p.state !== 'alive') return { hit: false, blocked: false };
    if (d.god || now < d.invulnUntil) return { hit: false, blocked: false };
    let amt = Math.max(0, Math.round(Number(amount) || 0));
    const heavy = !!(attacker && (attacker.boss || attacker.type === 'tank'));
    if (heavy) {
      if (solo) amt = Math.round(amt * BALANCE.soloHeavyDamage);
      amt = Math.min(amt, Math.round((p.maxHp || PLAYER.health) * BALANCE.heavyHitCap));
    }
    if (p.shield && attacker && isNum(attacker.x) && isNum(attacker.z)) {
      const ang = Math.abs(angleDiff(d.yaw, yawTo(d.x, d.z, attacker.x, attacker.z)));
      const out = (d.flags & PF.SHIELD_OUT) !== 0;
      const front = ang <= (SHIELD.frontArcDeg / 2) * DEG;
      const back = ang >= Math.PI - (SHIELD.backArcDeg / 2) * DEG;
      if ((out && front) || (!out && back)) {
        p.shield.hp -= amt;
        // Game._breakShield es quien pone p.shield = null (además de avisar por red); no se hace aquí
        // para que solo pase en un lugar.
        return { hit: false, blocked: true, shieldBroke: p.shield.hp <= 0, amt };
      }
    }
    p.hp = Math.max(0, p.hp - amt);
    d.lastDamageAt = now;
    if (heavy && amt >= BALANCE.heavyHitMin) d.invulnUntil = Math.max(d.invulnUntil || 0, now + BALANCE.heavyHitInvuln * 1000);
    if (p.hp <= 0) return { hit: true, blocked: false, wentDown: true, amt };
    let newlyInfected = false;
    if (!p.infected && Math.random() < INFECTION.chance) {
      p.infected = true;
      d.infT = 0; d.infAcc = 0;
      newlyInfected = true;
    }
    return { hit: true, blocked: false, wentDown: false, newlyInfected, amt };
  }

  // Pasa a "caído": pierde las ventajas y (con Mule Kick) la 3.ª arma, pierde puntos, y si estaba solo
  // y tenía Quick Revive agenda su auto-reanimación. Devuelve los puntos perdidos (para el evento 'pts').
  // Nota: cancelar lo que el jugador estuviera sosteniendo (Game._cancelHold) sigue siendo cosa de Game,
  // porque toca recursos compartidos (caja, Pack-a-Punch, mesa) que esta clase no conoce.
  goDown(now, solo) {
    const p = this.pub;
    p.state = 'down';
    p.hp = 0;
    p.infected = false;
    p.healing = null;
    p.downs++;
    const pointsLost = Math.floor(p.points * PLAYER.downPointsLoss);
    if (pointsLost > 0) p.points -= pointsLost;
    const hadQR = p.perks.includes('quickrevive');
    const hadMule = p.perks.includes('mulekick');
    p.perks = [];
    p.maxHp = PLAYER.health;
    if (hadMule && p.weapons.length > PLAYER.maxWeapons) {
      p.weapons.length = PLAYER.maxWeapons;
      p.cur = clamp(p.cur, 0, Math.max(0, p.weapons.length - 1));
    }
    p.bleedUntil = now + PLAYER.bleedoutTime * 1000;
    p.reviver = null;
    p.reviveUntil = 0;
    p.selfReviveAt = 0;
    let selfRevive = false;
    if (solo && hadQR && p.qrUses < PLAYER.soloQuickReviveUses) {
      p.qrUses++;
      p.selfReviveAt = now + PLAYER.soloQuickReviveTime * 1000;
      selfRevive = true;
    }
    return { pointsLost, selfRevive };
  }

  // Reanima al jugador (por un compañero, o auto-reanimación en solitario si byPid es null).
  revive(now) {
    const p = this.pub, d = this.priv;
    p.state = 'alive';
    p.hp = p.maxHp;
    p.infected = false;
    p.healing = null;
    p.bleedUntil = 0;
    p.selfReviveAt = 0;
    p.reviver = null;
    p.reviveUntil = 0;
    if (d) { d.lastDamageAt = now; d.invulnUntil = now + REVIVE_INVULN; }
  }
}

export default Player;
