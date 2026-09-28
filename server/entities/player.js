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
// Autoridad de movimiento: hoy sigue siendo la del cliente (reporta su posición, aquí solo se valida
// con un presupuesto de velocidad real). Pasar el cálculo al servidor es un cambio de red aparte y más
// grande (predicción + reconciliación en el cliente); se aborda en un paso posterior, no en este.

import { PLAYER, BALANCE, SHIELD, INFECTION, clamp, angleDiff, yawTo } from '../../shared/constants.js';
import { PF, r2 } from '../../shared/protocol.js';

const DEG = Math.PI / 180;

// Tuneables de validación de movimiento y de reanimar (únicos, importados también por game.js:
// antes vivían duplicados como constantes sueltas en ese archivo).
export const MAX_STATE_GAP_MS = 2000;  // tope de "crédito" de tiempo tras una pausa larga entre mensajes 'st'
export const RESYNC_AFTER = 30;        // mensajes de posición rechazados seguidos antes de aceptarla igual
export const MAX_JUMP_MARGIN = 0.75;   // m de tolerancia fija (redondeo/ráfagas de mensajes)
export const MAX_SPEED_MPS = PLAYER.sprintSpeed * 1.5; // margen sobre la velocidad real máxima (sprint)
export const TELEPORT_GRACE = 3000;    // ms tras reaparecer en los que se acepta cualquier salto de posición
export const REVIVE_INVULN = 1500;     // ms de invulnerabilidad tras ser reanimado

function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function vec3(a, max) {
  if (!Array.isArray(a) || a.length < 3) return null;
  const x = Number(a[0]), y = Number(a[1]), z = Number(a[2]);
  if (!isNum(x) || !isNum(y) || !isNum(z)) return null;
  if (Math.abs(x) > max || Math.abs(y) > max || Math.abs(z) > max) return null;
  return [x, y, z];
}

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
  // Aplica un mensaje 'st' del cliente (posición, mirada, banderas, arma en mano). La posición se
  // valida con un presupuesto de velocidad real (tolera ráfagas/jitter de internet) en vez de una
  // distancia fija por mensaje. bounds = { W, H, M } — el mapa activo DE ESTA PARTIDA (Game.M), no un
  // valor global: cada sala puede tener un mapa distinto.
  applyMovementReport(m, now, bounds) {
    const p = this.pub, d = this.priv;
    if (isNum(m.yaw)) d.yaw = r2(m.yaw);
    if (isNum(m.pitch)) d.pitch = r2(clamp(m.pitch, -1.5, 1.5));
    if (isNum(m.f)) d.flags = (m.f | 0) & 0x3ff;
    let curChanged = false;
    if (Number.isInteger(m.cur)) {
      const c = clamp(m.cur, 0, Math.max(0, p.weapons.length - 1));
      if (c !== p.cur) { p.cur = c; curChanged = true; }
    }
    if (p.state === 'dead') return { curChanged, posApplied: false }; // espectador: su posición no importa
    const pos = vec3(m.p, 500);
    if (!pos) return { curChanged, posApplied: false };
    const { W, H, M } = bounds;
    const topLv = M.levels[M.NL - 1];
    const x = clamp(pos[0], 0, W), y = clamp(pos[1], M.levels[0].y - 1, topLv.y + topLv.h + 2), z = clamp(pos[2], 0, H);
    const jump = Math.hypot(x - d.x, z - d.z);
    if (d.hasPos && now > d.teleportUntil) {
      const dtMs = clamp(now - d.lastMoveAt, 0, MAX_STATE_GAP_MS);
      const allowed = MAX_JUMP_MARGIN + MAX_SPEED_MPS * (dtMs / 1000);
      if (jump > allowed) { if (++d.badPos < RESYNC_AFTER) return { curChanged, posApplied: false }; }
    }
    d.badPos = 0;
    d.lastMoveAt = now;
    d.x = x; d.y = y; d.z = z;
    d.hasPos = true;
    return { curChanged, posApplied: true };
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
