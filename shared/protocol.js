// Protocolo de red (JSON sobre WebSocket). Ver SPEC.md sección 4 para el detalle de cada mensaje.

// Cliente -> Servidor
export const C2S = {
  HELLO: 'hello',     // { name, color }
  READY: 'ready',     // { v: bool }
  START: 'start',     // {}  (solo anfitrión)
  STATE: 'st',        // { p:[x,y,z], yaw, pitch, f: flags, cur: slot }
  FIRE: 'fire',       // { w, up, o:[x,y,z], d:[dx,dy,dz], e:[x,y,z], hits:[[zid, part, dist], ...] }
  PROJ: 'proj',       // { w, up, o:[x,y,z], d:[dx,dy,dz] }         (proyectil lanzado, para los demás)
  NADE: 'nade',       // { o:[x,y,z], v:[vx,vy,vz] }                 (granada lanzada)
  BOOM: 'boom',       // { w, up, p:[x,y,z], direct: zid|null }       (impacto de proyectil/granada: w='frag' para granadas)
  MELEE: 'melee',     // { hits:[zid,...], shield: bool }
  USE: 'use',         // { id }                                        (interactuable de pulsación)
  HOLD: 'hold',       // { id, on: bool }                              (interactuable de mantener: win:N, bench, revive:PID)
  CHAT: 'chat',       // { msg }
  PING: 'ping',       // { c: clientTimeMs }
};

// Servidor -> Cliente
export const S2C = {
  WELCOME: 'welcome', // { id, host: bool, gs }
  GS: 'gs',           // estado de juego completo (ver SPEC.md 3)
  SNAP: 'snap',       // { now, z:[[id,x,z,rot,anim,flags,yOff]...], p:[[id,x,y,z,yaw,pitch,flags,w,up]...] }
  EV: 'ev',           // { e: nombre, ...datos }
  PONG: 'pong',       // { c, now }
  KICK: 'kick',       // { reason }
};

// Banderas del estado del jugador (campo f de 'st' y de los snapshots)
export const PF = {
  CROUCH: 1,
  SPRINT: 2,
  ADS: 4,
  DOWN: 8,          // lo pone el servidor en el snapshot
  SHIELD_OUT: 16,   // escudo en las manos
  RELOADING: 32,
  UPGRADED: 64,     // arma actual mejorada (solo en snapshot)
  JUMPING: 128,
  DRINKING: 256,    // bebiendo una ventaja / animación de compra
  FLASHLIGHT: 512,  // linterna encendida
};

// Animaciones de zombi (campo anim del snapshot)
export const ZA = {
  IDLE: 0,
  WALK: 1,
  RUN: 2,
  SPRINT: 3,
  ATTACK: 4,
  TEAR: 5,      // arrancando tablas
  CLIMB: 6,     // cruzando la ventana
  RISE: 7,      // emergiendo del suelo
  CRAWL: 8,     // reptando (sin piernas)
  STUN: 9,      // empujado por el escudo
};

// Banderas de zombi (campo flags del snapshot)
export const ZF = {
  CRAWLER: 1,   // perdió las piernas
  BURNING: 2,   // en llamas (Hades)
  NOHEAD: 4,    // (reservado)
  OUTSIDE: 8,   // todavía está fuera, en el callejón
};

// Partes del cuerpo en los impactos
export const PART = { HEAD: 'h', BODY: 'b', LEGS: 'l' };

// Redondeo para reducir el tamaño de los mensajes
export function r2(v) { return Math.round(v * 100) / 100; }
export function r3(v) { return Math.round(v * 1000) / 1000; }

// Parseo seguro
export function safeParse(data) {
  try { return JSON.parse(typeof data === 'string' ? data : data.toString()); } catch { return null; }
}
