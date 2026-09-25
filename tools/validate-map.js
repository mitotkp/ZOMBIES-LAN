// Valida el mapa compartido: imprime el ASCII y comprueba conectividad y colocación de objetos.
import {
  W, H, C, cellType, idx, typeAt, zoneAt, toAscii, ZONES, DOORS, WINDOW_INFO, WALLBUYS, PERK_MACHINES,
  PAP_MACHINE, POWER_SWITCH, WORKBENCH, BOX_LOCATIONS, SHIELD_PARTS, PLAYER_SPAWNS, INTERACTABLES, DIRS,
} from '../shared/map.js';
import { solidForPlayer, solidForZombieOutside, circleBlocked, raycastMap } from '../shared/collision.js';
import { WEAPONS } from '../shared/weapons.js';
import { PERKS } from '../shared/perks.js';

let errors = 0;
const err = (m) => { errors++; console.log('ERROR:', m); };

console.log(toAscii());
console.log();

// 1) Todas las zonas alcanzables desde la inicial con todas las puertas abiertas
const allOpen = Object.fromEntries(DOORS.map((d) => [d.id, true]));
function flood(sx, sz, solid) {
  const seen = new Uint8Array(W * H);
  const q = [[sx, sz]];
  seen[idx(sx, sz)] = 1;
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      if (seen[idx(nx, nz)] || solid(nx, nz)) continue;
      seen[idx(nx, nz)] = 1;
      q.push([nx, nz]);
    }
  }
  return seen;
}
const { x: sx, z: sz } = PLAYER_SPAWNS[0];
const reach = flood(Math.floor(sx), Math.floor(sz), (x, z) => solidForPlayer(x, z, allOpen));
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  if (cellType[idx(x, z)] === C.FLOOR && !reach[idx(x, z)]) err(`celda de suelo inalcanzable (${x},${z}) zona ${zoneAt(x, z)}`);
}
// Con puertas cerradas solo la zona inicial es alcanzable
const reachClosed = flood(Math.floor(sx), Math.floor(sz), (x, z) => solidForPlayer(x, z, {}));
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  if (reachClosed[idx(x, z)] && zoneAt(x, z) !== 0) err(`con puertas cerradas se alcanza (${x},${z}) zona ${zoneAt(x, z)}`);
}

// 2) Puertas: cada celda debe tocar suelo de ambas zonas a ambos lados
for (const d of DOORS) {
  const touched = new Set();
  for (const [x, z] of d.cells) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (typeAt(x + dx, z + dz) === C.FLOOR) touched.add(zoneAt(x + dx, z + dz));
    }
  }
  for (const zn of d.zones) if (!touched.has(zn)) err(`puerta ${d.id} no toca la zona ${zn}`);
}

// 3) Ventanas: celda exterior e interior correctas, callejón conectado
for (const w of WINDOW_INFO) {
  if (typeAt(w.land[0], w.land[1]) !== C.FLOOR) err(`ventana ${w.id}: celda interior (${w.land}) no es suelo (tipo ${typeAt(w.land[0], w.land[1])})`);
  if (zoneAt(w.land[0], w.land[1]) !== w.zone) err(`ventana ${w.id}: la zona interior no coincide`);
  if (typeAt(w.tear[0], w.tear[1]) !== C.OUTSIDE) err(`ventana ${w.id}: celda de arranque no es exterior`);
  if (typeAt(w.spawn[0], w.spawn[1]) !== C.OUTSIDE) err(`ventana ${w.id}: celda de aparición no es exterior`);
  const f = flood(w.spawn[0], w.spawn[1], (x, z) => solidForZombieOutside(x, z));
  if (!f[idx(w.tear[0], w.tear[1])]) err(`ventana ${w.id}: el callejón no conecta aparición con la ventana`);
  // Un jugador parado en la celda interior no debe estar bloqueado
  if (circleBlocked(w.land[0] + 0.5, w.land[1] + 0.5, 0.35, (x, z) => solidForPlayer(x, z, {}))) err(`ventana ${w.id}: la celda interior está obstruida`);
}

// 4) Armas de pared: la celda es suelo y el muro es muro
for (const wb of WALLBUYS) {
  const d = DIRS[wb.wall];
  if (typeAt(wb.x, wb.z) !== C.FLOOR) err(`wallbuy ${wb.id}: la celda (${wb.x},${wb.z}) no es suelo`);
  if (typeAt(wb.x + d.dx, wb.z + d.dz) !== C.WALL) err(`wallbuy ${wb.id}: detrás no hay muro (tipo ${typeAt(wb.x + d.dx, wb.z + d.dz)})`);
  if (!WEAPONS[wb.weapon]) err(`wallbuy ${wb.id}: arma desconocida ${wb.weapon}`);
}
{
  const d = DIRS[POWER_SWITCH.wall];
  if (typeAt(POWER_SWITCH.x + d.dx, POWER_SWITCH.z + d.dz) !== C.WALL) err('palanca: detrás no hay muro');
}
// 5) Máquinas: el frente debe ser suelo libre
for (const m of PERK_MACHINES) {
  if (!PERKS[m.perk]) err(`máquina con ventaja desconocida ${m.perk}`);
  const d = DIRS[m.face];
  if (typeAt(m.x + d.dx, m.z + d.dz) !== C.FLOOR) err(`máquina ${m.perk}: el frente (${m.x + d.dx},${m.z + d.dz}) no es suelo`);
  const back = typeAt(m.x - d.dx, m.z - d.dz);
  if (back !== C.WALL) console.log(`aviso: máquina ${m.perk} no tiene muro detrás`);
}
// 6) Interactuables: el punto de interacción debe ser alcanzable por un jugador
for (const it of INTERACTABLES) {
  if (it.kind === 'door') continue;
  const cx = Math.floor(it.x), cz = Math.floor(it.z);
  if (!reach[idx(cx, cz)]) err(`interactuable ${it.id}: punto (${it.x},${it.z}) inalcanzable`);
}
for (const p of SHIELD_PARTS) if (typeAt(p.x, p.z) !== C.FLOOR || zoneAt(p.x, p.z) !== p.zone) err(`pieza ${p.id} mal colocada`);
for (const b of BOX_LOCATIONS) if (zoneAt(b.x0, b.z0) !== -1 && zoneAt(b.x0, b.z0) !== b.zone) console.log(`aviso: caja ${b.id} zona`);

// 7) Raycast básico: desde el spawn hacia el norte choca con el muro z=19
const hit = raycastMap(9.5, 1.6, 29.5, 0, 0, -1, 100, {});
if (!hit || Math.abs(hit.z - 20) > 0.01) err(`raycast de prueba inesperado: ${JSON.stringify(hit)}`);

console.log(`Zonas: ${ZONES.length}, puertas: ${DOORS.length}, ventanas: ${WINDOW_INFO.length}, interactuables: ${INTERACTABLES.length}`);
console.log(errors ? `${errors} error(es)` : 'Mapa OK');
process.exit(errors ? 1 : 0);
