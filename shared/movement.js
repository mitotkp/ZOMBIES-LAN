// Simulación de movimiento del jugador (COMPARTIDA servidor/cliente). Es la única fuente de verdad de cómo
// se mueve un jugador: el servidor la ejecuta con los comandos que recibe (autoridad) y el cliente la
// ejecuta a la vez con sus propios comandos (predicción) y se corrige con la respuesta del servidor.
// Para que ambos lados den el MISMO resultado, aquí no hay nada que dependa del navegador, del reloj ni
// del azar: todo entra por el estado, el comando y `env`.
//
// Un comando (`cmd`) es la INTENCIÓN de un fotograma, ya interpretada por el cliente (qué teclas cuentan
// como "agacharse", si hay que correr...). Ver quantizeCmd(): los valores se redondean antes de simular
// (en ambos lados) para que lo que viaja por red sea exactamente lo que se simuló.

import { PLAYER, clamp, lerp } from './constants.js';
import { MAP } from './map.js';
import { moveCircle, resolveCircle, solidForPlayer } from './collision.js';

export const GROUND_ACCEL = 11;          // respuesta al acelerar (1/s)
export const GROUND_DECEL = 9;           // respuesta al frenar
export const AIR_ACCEL = 2.2;            // control en el aire
export const STAMINUP_SPEED = 1.07;
export const SPRINT_REGEN_DELAY = 0.45;  // s sin correr antes de recuperar estamina
export const EXHAUST_RECOVER = 0.35;     // estamina necesaria para volver a correr tras agotarse
export const MAX_CMD_DT = 0.05;          // s: tope de un comando (igual que el tope de fotograma del cliente)

// Bits del campo `bits` de un comando
export const CB = { SPRINT: 1, SPRINT_PRESSED: 2, CROUCH_PRESSED: 4, CROUCH_DOWN: 8, CROUCH_RELEASED: 16, JUMP_PRESSED: 32 };

// Estado de simulación de un jugador (todo lo que el paso necesita recordar entre comandos)
export function newMoveState(x = 0, y = 0, z = 0) {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, onGround: true,
    sprinting: false, crouching: false, sliding: false, crouchWanted: false,
    crouchPressT: 0, crouchPressOn: false,
    exhausted: false, regenDelay: 0, stamina: 1,
    slideT: 0, slideCd: 0, sdx: 0, sdz: 0,
  };
}

// Estado inicial al aparecer/teletransportarse: empuja fuera de muros y pega a la altura del suelo
export function spawnMoveState(x, z, y, doors = {}) {
  const s = newMoveState(x, y, z);
  const solid = (cx, cz) => solidForPlayer(cx, cz, doors, s.y, s.x, s.z);
  [s.x, s.z] = resolveCircle(x, z, PLAYER.radius, solid);
  s.y = MAP.groundY(s.x, s.z, y);
  return s;
}

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

// Comando canónico (lo que se simula Y lo que viaja): tiempo en ms enteros, ejes y guiño redondeados
export function quantizeCmd(c) {
  const ms = clamp(Math.round((Number(c.dt) || 0) * 1000), 1, MAX_CMD_DT * 1000);
  return {
    seq: c.seq | 0,
    dt: ms / 1000,
    fwd: clamp(r2(Number(c.fwd) || 0), -1, 1),
    str: clamp(r2(Number(c.str) || 0), -1, 1),
    analogK: clamp(r2(Number.isFinite(Number(c.analogK)) ? Number(c.analogK) : 1), 0, 1),
    yaw: r4(Number(c.yaw) || 0),
    mm: clamp(r2(Number.isFinite(Number(c.mm)) ? Number(c.mm) : 1), 0.1, 1),
    bits: (c.bits | 0) & 63,
  };
}

// Serialización compacta de un comando para la red
export function packCmd(c) { return [c.seq, Math.round(c.dt * 1000), c.fwd, c.str, c.analogK, c.yaw, c.mm, c.bits]; }
export function unpackCmd(a) {
  if (!Array.isArray(a) || a.length < 8) return null;
  const [seq, ms, fwd, str, analogK, yaw, mm, bits] = a;
  if (![seq, ms, fwd, str, analogK, yaw, mm, bits].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return quantizeCmd({ seq, dt: ms / 1000, fwd, str, analogK, yaw, mm, bits });
}

// Estado que el servidor devuelve al cliente para reconciliar (y su lectura)
export function packMoveState(s) {
  return [s.x, s.y, s.z, s.vx, s.vy, s.vz, s.onGround ? 1 : 0, s.sprinting ? 1 : 0, s.sliding ? 1 : 0, s.crouchWanted ? 1 : 0,
    s.exhausted ? 1 : 0, s.stamina, s.regenDelay, s.slideT, s.slideCd, s.sdx, s.sdz, s.crouchPressT, s.crouchPressOn ? 1 : 0].map((v) => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v));
}
export function unpackMoveState(a) {
  if (!Array.isArray(a) || a.length < 19) return null;
  const n = a.map(Number);
  if (!n.every(Number.isFinite)) return null;
  const s = newMoveState(n[0], n[1], n[2]);
  s.vx = n[3]; s.vy = n[4]; s.vz = n[5]; s.onGround = !!n[6]; s.sprinting = !!n[7]; s.sliding = !!n[8]; s.crouchWanted = !!n[9];
  s.exhausted = !!n[10]; s.stamina = n[11]; s.regenDelay = n[12]; s.slideT = n[13]; s.slideCd = n[14]; s.sdx = n[15]; s.sdz = n[16];
  s.crouchPressT = n[17]; s.crouchPressOn = !!n[18];
  s.crouching = s.crouchWanted;
  return s;
}
export function copyMoveState(dst, src) { Object.assign(dst, src); return dst; }

// Un paso de simulación. `s` se modifica. env = { doors, down, staminUp, separate? } donde
// separate(x, z, dt) -> [x, z] | null es el empuje suave entre jugador y zombis (si el lado lo conoce).
// Devuelve eventos sueltos para el cliente (sonidos, cabeceo al aterrizar); el servidor los ignora.
export function stepMovement(s, cmd, dt, env) {
  const down = !!env.down;
  const staminUp = !!env.staminUp;
  const ev = { slid: false, jumped: false, impact: 0 };
  const bits = cmd.bits;
  const sprintWanted = !!(bits & CB.SPRINT), sprintPressed = !!(bits & CB.SPRINT_PRESSED);
  const crouchPressed = !!(bits & CB.CROUCH_PRESSED), crouchDown = !!(bits & CB.CROUCH_DOWN), crouchReleased = !!(bits & CB.CROUCH_RELEASED);
  const jumpPressed = !!(bits & CB.JUMP_PRESSED);
  const fwd = cmd.fwd, str = cmd.str, analogK = cmd.analogK;
  const yaw = cmd.yaw;
  const wantsMove = fwd !== 0 || str !== 0;
  const solid = (cx, cz) => solidForPlayer(cx, cz, env.doors, s.y, s.x, s.z);

  // Deslizarse: agacharse mientras se corre (como en CoD). Termina agachado.
  if (s.slideCd > 0) s.slideCd -= dt;
  if (!down && crouchPressed && s.sprinting && s.onGround && s.slideCd <= 0 && !s.sliding) {
    const hv = Math.hypot(s.vx, s.vz);
    if (hv > 0.5) { s.sdx = s.vx / hv; s.sdz = s.vz / hv; }
    else { s.sdx = -Math.sin(yaw); s.sdz = -Math.cos(yaw); }
    s.slideT = PLAYER.slideDuration;
    s.slideCd = PLAYER.slideDuration + PLAYER.slideCooldown;
    s.sliding = true;
    s.crouchWanted = true;
    s.crouchPressOn = false;     // al soltar la C se sigue agachado
    ev.slid = true;
  }
  if (s.sliding && (down || s.slideT <= 0)) s.sliding = false;

  // Agacharse: pulsación = alternar; mantener y soltar = agacharse solo mientras se mantiene
  if (!down && !s.sliding) {
    if (crouchPressed) {
      s.crouchWanted = !s.crouchWanted;
      s.crouchPressT = 0;
      s.crouchPressOn = s.crouchWanted;
    }
    if (crouchDown) s.crouchPressT += dt;
    if (crouchReleased && s.crouchPressOn && s.crouchPressT > 0.3) s.crouchWanted = false;
  } else if (down) {
    s.crouchWanted = false;
  }

  // Correr
  const wantSprint = !down && sprintWanted && fwd > 0;
  if (wantSprint && s.crouchWanted && sprintPressed) s.crouchWanted = false;
  let sprint = wantSprint && !s.sliding && !s.crouchWanted && !s.exhausted && s.stamina > 0;
  const dur = PLAYER.sprintDuration * (staminUp ? 2 : 1);
  if (sprint) {
    s.stamina -= dt / dur;
    s.regenDelay = SPRINT_REGEN_DELAY;
    if (s.stamina <= 0) { s.stamina = 0; s.exhausted = true; sprint = false; }
  } else {
    if (s.regenDelay > 0) s.regenDelay -= dt;
    else s.stamina = Math.min(1, s.stamina + dt / PLAYER.sprintRecover);
    if (s.exhausted && s.stamina >= EXHAUST_RECOVER) s.exhausted = false;
  }
  s.sprinting = sprint;
  s.crouching = s.crouchWanted && !down;

  // Saltar (agachado: primero se levanta)
  if (!down && jumpPressed) {
    if (s.sliding) {
      // Salto desde el deslizamiento: conserva la inercia
      s.sliding = false;
      s.slideT = 0;
      s.crouchWanted = false;
      s.crouching = false;
      s.vy = PLAYER.jumpVelocity;
      s.onGround = false;
      ev.jumped = true;
    } else if (s.crouchWanted) {
      s.crouchWanted = false;
      s.crouching = false;
    } else if (s.onGround) {
      s.vy = PLAYER.jumpVelocity;
      s.onGround = false;
      ev.jumped = true;
    }
  }

  // Velocidad objetivo
  let speed = down ? PLAYER.downSpeed
    : sprint ? PLAYER.sprintSpeed
    : s.crouching ? PLAYER.crouchSpeed
    : PLAYER.walkSpeed;
  if (staminUp && !down) speed *= STAMINUP_SPEED;
  speed *= clamp(cmd.mm, 0.1, 1.5);
  if (!sprint) {
    if (fwd < 0) speed *= 0.88;
    else if (fwd === 0 && str !== 0) speed *= 0.95;
  }

  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const fx = -sy, fz = -cy;          // adelante
  const rx = cy, rz = -sy;           // derecha
  let wx = fx * fwd + rx * str, wz = fz * fwd + rz * str;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  const k = sprint ? 1 : Math.max(0.3, analogK);
  const tx = wx * speed * k, tz = wz * speed * k;

  if (s.sliding) {
    // Impulso inicial que se frena hasta la velocidad agachado; se puede torcer un poco con A/D
    const f = 1 - s.slideT / PLAYER.slideDuration;        // 0 → 1
    const sp = lerp(PLAYER.slideSpeed * (staminUp ? STAMINUP_SPEED : 1), PLAYER.crouchSpeed, f * f);
    const steer = -str * 1.6 * dt;   // girar a la derecha = yaw negativo
    const c = Math.cos(steer), sn = Math.sin(steer);
    const dx = s.sdx, dz = s.sdz;
    let nx = dx * c + dz * sn, nz = dz * c - dx * sn;
    const nl = Math.hypot(nx, nz) || 1;
    s.sdx = nx / nl; s.sdz = nz / nl;
    s.vx = s.sdx * sp;
    s.vz = s.sdz * sp;
    s.slideT -= dt;
  } else {
    const accel = s.onGround ? (wantsMove ? GROUND_ACCEL : GROUND_DECEL) : AIR_ACCEL;
    const kk = 1 - Math.exp(-accel * dt);
    s.vx += (tx - s.vx) * kk;
    s.vz += (tz - s.vz) * kk;
  }

  // Vertical: suelo de la planta o rampa de la escalera bajo los pies
  const ground = MAP.groundY(s.x, s.z, s.y);
  if (down) {
    s.y = ground; s.vy = 0;
    s.onGround = true;
  } else {
    if (!s.onGround) s.vy -= PLAYER.gravity * dt;
    s.y += s.vy * dt;
    if (s.y <= ground) {
      if (!s.onGround) ev.impact = -s.vy;
      s.y = ground; s.vy = 0;
      s.onGround = true;
    }
  }

  // Horizontal con colisión y deslizamiento
  const ox = s.x, oz = s.z;
  const res = moveCircle(ox, oz, s.vx * dt, s.vz * dt, PLAYER.radius, solid);
  let nx = res.x, nz = res.z;
  if (env.separate) {
    const sep = env.separate(nx, nz, dt, s.y, solid);
    if (sep) { nx = sep[0]; nz = sep[1]; }
  }
  if (!Number.isFinite(nx) || !Number.isFinite(nz)) {
    nx = ox; nz = oz;
    s.vx = 0; s.vz = 0;
  }
  s.x = nx; s.z = nz;
  // Al caminar: seguir la rampa (subir o bajar escalones); si el suelo desaparece, caer
  if (s.onGround && s.vy <= 0) {
    const g2 = MAP.groundY(s.x, s.z, s.y);
    if (Math.abs(g2 - s.y) <= MAP.STEP + 0.05) s.y = g2;
    else if (g2 < s.y) s.onGround = false;
  }
  if (dt > 0) {
    const ax = (nx - ox) / dt, az = (nz - oz) / dt;
    if (Math.abs(ax) < Math.abs(s.vx)) s.vx = ax;
    if (Math.abs(az) < Math.abs(s.vz)) s.vz = az;
  }
  const hs = Math.hypot(s.vx, s.vz);
  if (s.sliding && hs < 1.2 && s.slideT < PLAYER.slideDuration - 0.1) { s.sliding = false; s.slideT = 0; }
  return ev;
}

export const ZOMBIE_SEP = 0.62;          // distancia mínima jugador-zombi (empuje suave)

// Empuje suave para no meterse dentro de un zombi. list: [{ x, z, dead?, <yKey> }] (yKey: 'yOff' en el
// cliente, 'y' en el servidor: la planta del zombi). Devuelve [x, z] ajustado o null si no empujó.
export function separateFromZombies(list, yKey, x, z, dt, y, solid) {
  if (!Array.isArray(list) || !list.length) return null;
  let moved = false;
  const kk = Math.min(1, dt * 12);
  for (let i = 0; i < list.length; i++) {
    const zb = list[i];
    if (!zb || zb.dead || !Number.isFinite(zb.x) || !Number.isFinite(zb.z)) continue;
    if (Math.abs((zb[yKey] || 0) - y) > 1.5) continue;   // zombi en otra planta (arriba o abajo)
    const dx = x - zb.x, dz = z - zb.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= ZOMBIE_SEP * ZOMBIE_SEP || d2 < 1e-8) continue;
    const d = Math.sqrt(d2);
    const push = (ZOMBIE_SEP - d) * kk;
    x += (dx / d) * push;
    z += (dz / d) * push;
    moved = true;
  }
  if (!moved) return null;
  return resolveCircle(x, z, PLAYER.radius, solid);
}
