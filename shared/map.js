// Mapa ACTIVO (fachada). Exporta los mismos nombres que usa todo el código (MAP_NAME, ZONES, cellType...)
// como enlaces vivos que apuntan al mapa activo: al llamar a setActiveMap() cambian para todos los módulos.
//
//  - Cliente: un único mapa activo (el de la sala en la que está).
//  - Servidor: cada sala (Game) tiene su mapa y lo activa al entrar en cualquiera de sus manejadores
//    (tick, mensajes, conexiones). Node ejecuta un manejador cada vez, así que no se mezclan.
//
// Las definiciones están en shared/maps/*.js y el constructor de la cuadrícula en shared/mapcore.js.

import { buildMap, C, WALL_KIND, DIRS, sameFloor } from './mapcore.js';
import pueblo from './maps/pueblo.js';
import castillo from './maps/castillo.js';

export { C, WALL_KIND, DIRS, sameFloor };

// Mapas disponibles (id → definición) en el orden en que se ofrecen
export const MAP_DEFS = [pueblo, castillo];
export const MAP_IDS = MAP_DEFS.map((d) => d.id);
export const DEFAULT_MAP = 'pueblo';
export const MAP_LIST = MAP_DEFS.map((d) => ({ id: d.id, name: d.name, desc: d.desc || '' }));

const built = new Map();
export function getMap(id) {
  const key = MAP_IDS.includes(id) ? id : DEFAULT_MAP;
  let M = built.get(key);
  if (!M) { M = buildMap(MAP_DEFS.find((d) => d.id === key)); built.set(key, M); }
  return M;
}
export function isMapId(id) { return MAP_IDS.includes(id); }

// ---------------------------------------------------------------------------- enlaces vivos al mapa activo
export let MAP = null;
export let MAP_ID = DEFAULT_MAP;
export let MAP_NAME, W, H, WALL_H, FENCE_H, CEIL_H;
export let LEVELS, NL;
export let ZONES, START_ZONE, DOORS, WINDOWS, WINDOW_INFO, PROPS, STAIRS, HOLES, TELEPORTERS;
export let WALLBUYS, MED_CABINETS, PERK_MACHINES, PAP_MACHINE, POWER_SWITCH, WORKBENCH;
export let BOX_LOCATIONS, BOX_START, SHIELD_PARTS, PLAYER_SPAWNS, PLAYER_SPAWN_YAW;
export let cellType, cellZone, cellHeight, cellWallKind, cellDoor, cellWindow;
export let INTERACTABLES, INTERACTABLE_BY_ID;

// Activa un mapa (id o mapa ya construido). Devuelve el mapa activo.
export function setActiveMap(idOrMap) {
  const M = idOrMap && typeof idOrMap === 'object' ? idOrMap : getMap(idOrMap);
  if (M === MAP) return M;
  MAP = M; MAP_ID = M.id;
  MAP_NAME = M.MAP_NAME; W = M.W; H = M.H; WALL_H = M.WALL_H; FENCE_H = M.FENCE_H; CEIL_H = M.CEIL_H;
  LEVELS = M.levels; NL = M.NL;
  ZONES = M.ZONES; START_ZONE = M.START_ZONE; DOORS = M.DOORS; WINDOWS = M.WINDOWS; WINDOW_INFO = M.WINDOW_INFO;
  PROPS = M.PROPS; STAIRS = M.STAIRS; HOLES = M.HOLES; TELEPORTERS = M.TELEPORTERS;
  WALLBUYS = M.WALLBUYS; MED_CABINETS = M.MED_CABINETS; PERK_MACHINES = M.PERK_MACHINES; PAP_MACHINE = M.PAP_MACHINE;
  POWER_SWITCH = M.POWER_SWITCH; WORKBENCH = M.WORKBENCH;
  BOX_LOCATIONS = M.BOX_LOCATIONS; BOX_START = M.BOX_START; SHIELD_PARTS = M.SHIELD_PARTS;
  PLAYER_SPAWNS = M.PLAYER_SPAWNS; PLAYER_SPAWN_YAW = M.PLAYER_SPAWN_YAW;
  cellType = M.cellType; cellZone = M.cellZone; cellHeight = M.cellHeight; cellWallKind = M.cellWallKind;
  cellDoor = M.cellDoor; cellWindow = M.cellWindow;
  INTERACTABLES = M.INTERACTABLES; INTERACTABLE_BY_ID = M.INTERACTABLE_BY_ID;
  return M;
}
setActiveMap(DEFAULT_MAP);

// Funciones del mapa activo
export function idx(x, z) { return z * W + x; }
export function inBounds(x, z) { return x >= 0 && z >= 0 && x < W && z < H; }
export function typeAt(x, z) { return MAP.typeAt(x, z); }
export function zoneAt(x, z) { return MAP.zoneAt(x, z); }
export function pocketWindowAt(x, z, l = 0) { return MAP.pocketWindowAt(x, z, l); }
export function toAscii(doorsOpen = {}, l = 0) { return MAP.toAscii(doorsOpen, l); }
export function groundY(x, z, y) { return MAP.groundY(x, z, y); }
export function levelOfY(y) { return MAP.levelOfY(y); }
export function baseY(l) { return MAP.baseY(l); }
