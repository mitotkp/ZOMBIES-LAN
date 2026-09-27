// Valida los mapas: imprime el ASCII de cada planta y comprueba conectividad (por plantas, escaleras y
// teletransportes) y la colocación de objetos.
// Uso: node tools/validate-map.js [--map pueblo|castillo] [--quiet]   (sin --map: todos)
import {
  MAP_IDS, setActiveMap, C, DIRS,
} from '../shared/map.js';
import { circleBlocked, raycastMap, solidForPlayer, solidForZombieOutside } from '../shared/collision.js';
import { FlowField } from '../server/nav.js';
import { WEAPONS } from '../shared/weapons.js';
import { PERKS } from '../shared/perks.js';

const argMap = (() => { const i = process.argv.indexOf('--map'); return i >= 0 ? process.argv[i + 1] : null; })();
const QUIET = process.argv.includes('--quiet');
let total = 0;

for (const id of argMap ? [argMap] : MAP_IDS) {
  const M = setActiveMap(id);
  let errors = 0;
  const err = (m) => { errors++; console.log(`ERROR [${id}]:`, m); };
  const T = (l, x, z) => M.typeAtL(l, x, z);
  const Z = (l, x, z) => M.zoneAtL(l, x, z);

  console.log(`\n######## ${M.MAP_NAME} (${id}) — ${M.W}×${M.H}, ${M.NL} planta(s)`);
  if (!QUIET) for (let l = 0; l < M.NL; l++) { console.log(`--- planta ${l} (y=${M.levels[l].y})`); console.log(M.toAscii({}, l)); }

  // 1) Alcance: nodos transitables desde la aparición siguiendo escaleras y teletransportes
  const reachFrom = (doors) => {
    const f = new FlowField(M);
    const sources = [{ x: M.PLAYER_SPAWNS[0].x, z: M.PLAYER_SPAWNS[0].z, y: M.PLAYER_SPAWNS[0].y }];
    for (let k = 0; k < 4; k++) {
      f.walkKey = null;
      f.compute(sources, doors);
      let added = false;
      for (const tp of M.TELEPORTERS) {
        if (f.at(tp.x, tp.z, tp.lv || 0) === Infinity) continue;
        const to = tp.to;
        if (!sources.some((s) => s.x === to.x && s.z === to.z)) { sources.push({ x: to.x, z: to.z, y: M.baseY(to.lv) }); added = true; }
      }
      if (!added) break;
    }
    return f;
  };
  const openAll = Object.fromEntries(M.DOORS.filter((d) => !d.sealed).map((d) => [d.id, true]));
  const openSealed = Object.fromEntries(M.DOORS.map((d) => [d.id, true]));
  const sealedZones = new Set(M.DOORS.filter((d) => d.sealed).map((d) => d.zones[1]));
  const reach = reachFrom(openAll);
  const reachSealed = reachFrom(openSealed);
  const reachClosed = reachFrom({});
  const seenZones = new Set();
  for (let l = 0; l < M.NL; l++) {
    for (let z = 0; z < M.H; z++) for (let x = 0; x < M.W; x++) {
      if (T(l, x, z) !== C.FLOOR) continue;
      const zn = Z(l, x, z);
      const r = reach.at(x, z, l) !== Infinity;
      if (r) seenZones.add(zn);
      if (sealedZones.has(zn)) {
        if (r) err(`la zona sellada ${zn} se alcanza sin abrir la puerta sellada (${x},${z}) planta ${l}`);
        if (reachSealed.at(x, z, l) === Infinity) err(`celda de la zona sellada ${zn} inalcanzable incluso abierta (${x},${z})`);
      } else if (!r) err(`celda de suelo inalcanzable (${x},${z}) planta ${l} zona ${zn}`);
      if (reachClosed.at(x, z, l) !== Infinity && zn !== M.START_ZONE) err(`con las puertas cerradas se alcanza (${x},${z}) planta ${l} zona ${zn}`);
    }
  }
  for (const zn of M.ZONES) if (!seenZones.has(zn.id) && !sealedZones.has(zn.id)) err(`zona ${zn.id} (${zn.name}) nunca alcanzada`);

  // 2) Puertas: cada una toca suelo de sus dos zonas en su planta
  for (const d of M.DOORS) {
    if (d.sealed) continue;   // la sellada da a una escalera, no al suelo de la zona de arriba
    const touched = new Set();
    for (const [x, z] of d.cells) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = T(d.lv, x + dx, z + dz);
        if (t === C.FLOOR || t === C.STAIR) touched.add(Z(d.lv, x + dx, z + dz));
      }
    }
    for (const zn of d.zones) if (!touched.has(zn)) err(`puerta ${d.id} no toca la zona ${zn}`);
  }

  // 3) Ventanas
  for (const w of M.WINDOW_INFO) {
    const l = w.lv;
    if (T(l, w.land[0], w.land[1]) !== C.FLOOR) err(`ventana ${w.id}: celda interior (${w.land}) no es suelo (tipo ${T(l, w.land[0], w.land[1])})`);
    if (Z(l, w.land[0], w.land[1]) !== w.zone) err(`ventana ${w.id}: la zona interior no coincide`);
    if (T(l, w.tear[0], w.tear[1]) !== C.OUTSIDE) err(`ventana ${w.id}: celda de arranque no es exterior`);
    if (T(l, w.spawn[0], w.spawn[1]) !== C.OUTSIDE) err(`ventana ${w.id}: celda de aparición no es exterior`);
    if (circleBlocked(w.land[0] + 0.5, w.land[1] + 0.5, 0.35, (x, z) => solidForPlayer(x, z, {}, w.y))) err(`ventana ${w.id}: la celda interior está obstruida`);
    // callejón conectado (relleno por su planta)
    const seen = new Set([w.spawn.join()]);
    const q = [w.spawn];
    while (q.length) {
      const [x, z] = q.pop();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${z + dz}`;
        if (seen.has(k) || solidForZombieOutside(x + dx, z + dz, w.y)) continue;
        seen.add(k); q.push([x + dx, z + dz]);
      }
    }
    if (!seen.has(w.tear.join())) err(`ventana ${w.id}: el callejón no conecta aparición con la ventana`);
  }

  // 4) Armas de pared, armarios y palanca: celda de suelo delante de un muro
  const onWall = (o, name) => {
    const d = DIRS[o.wall];
    if (T(o.lv, o.x, o.z) !== C.FLOOR) err(`${name}: la celda (${o.x},${o.z}) planta ${o.lv} no es suelo (tipo ${T(o.lv, o.x, o.z)})`);
    const back = T(o.lv, o.x + d.dx, o.z + d.dz);
    if (back !== C.WALL) err(`${name}: detrás no hay muro (tipo ${back})`);
  };
  for (const wb of M.WALLBUYS) { onWall(wb, `wallbuy ${wb.id}`); if (!WEAPONS[wb.weapon]) err(`wallbuy ${wb.id}: arma desconocida ${wb.weapon}`); }
  for (const mc of M.MED_CABINETS) onWall(mc, `armario ${mc.item}`);
  if (M.POWER_SWITCH) onWall(M.POWER_SWITCH, 'palanca');

  // 5) Máquinas: el frente debe ser suelo libre
  for (const m of M.PERK_MACHINES) {
    if (!PERKS[m.perk]) err(`máquina con ventaja desconocida ${m.perk}`);
    const d = DIRS[m.face];
    if (T(m.lv, m.x + d.dx, m.z + d.dz) !== C.FLOOR) err(`máquina ${m.perk}: el frente (${m.x + d.dx},${m.z + d.dz}) no es suelo`);
    if (T(m.lv, m.x - d.dx, m.z - d.dz) !== C.WALL) console.log(`aviso [${id}]: máquina ${m.perk} no tiene muro detrás`);
  }

  // 6) Interactuables: el punto de interacción debe ser alcanzable
  for (const it of M.INTERACTABLES) {
    if (it.kind === 'door') continue;
    const cx = Math.floor(it.x), cz = Math.floor(it.z);
    const lv = it.lv || 0;
    const zn = Z(lv, cx, cz);
    const R = sealedZones.has(zn) ? reachSealed : reach;
    let r = R.at(cx, cz, lv);
    // objeto sólido (brasero...): basta con poder llegar a una celda vecina
    if (r === Infinity && T(lv, cx, cz) === C.PROP) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) r = Math.min(r, R.at(cx + dx, cz + dz, lv));
    }
    if (r === Infinity) err(`interactuable ${it.id}: punto (${it.x},${it.z}) planta ${lv} inalcanzable`);
  }
  for (const p of M.SHIELD_PARTS) if (T(p.lv, p.x, p.z) !== C.FLOOR || Z(p.lv, p.x, p.z) !== p.zone) err(`pieza ${p.id} mal colocada`);
  for (const b of M.BOX_LOCATIONS) {
    const d = DIRS[b.face];
    const fx = (d.dx > 0 ? b.x1 + 1 : d.dx < 0 ? b.x0 - 1 : b.x0), fz = (d.dz > 0 ? b.z1 + 1 : d.dz < 0 ? b.z0 - 1 : b.z0);
    if (T(b.lv, fx, fz) !== C.FLOOR) err(`caja ${b.id}: el frente (${fx},${fz}) no es suelo`);
  }
  for (const tp of M.TELEPORTERS) {
    if (T(tp.lv || 0, tp.x, tp.z) !== C.FLOOR) err(`teletransporte ${tp.id}: la celda no es suelo`);
    const to = tp.to;
    if (T(to.lv, Math.floor(to.x), Math.floor(to.z)) !== C.FLOOR) err(`teletransporte ${tp.id}: el destino no es suelo`);
  }
  for (const s of M.PLAYER_SPAWNS) {
    if (circleBlocked(s.x, s.z, 0.35, (x, z) => solidForPlayer(x, z, {}, s.y))) err(`aparición (${s.x},${s.z}) obstruida`);
  }

  // 7) Escaleras: se entra por abajo en su planta y se sale por arriba a la planta siguiente
  for (const st of M.STAIRS) {
    const d = DIRS[st.dir];
    const botX = d.dx > 0 ? st.x0 - 1 : d.dx < 0 ? st.x1 + 1 : st.x0;
    const botZ = d.dz > 0 ? st.z0 - 1 : d.dz < 0 ? st.z1 + 1 : st.z0;
    const topX = d.dx > 0 ? st.x1 + 1 : d.dx < 0 ? st.x0 - 1 : st.x0;
    const topZ = d.dz > 0 ? st.z1 + 1 : d.dz < 0 ? st.z0 - 1 : st.z0;
    const tb = T(st.lv, botX, botZ), tt = T(st.lv + 1, topX, topZ);
    if (tb !== C.FLOOR && tb !== C.DOOR) err(`escalera ${st.id}: el pie (${botX},${botZ}) planta ${st.lv} no es suelo`);
    if (tt !== C.FLOOR && tt !== C.DOOR) err(`escalera ${st.id}: la llegada (${topX},${topZ}) planta ${st.lv + 1} no es suelo`);
  }

  // 8) Raycast básico (Pueblo: desde el spawn hacia el norte choca con el muro z=19)
  if (id === 'pueblo') {
    const hit = raycastMap(9.5, 1.6, 29.5, 0, 0, -1, 100, {});
    if (!hit || Math.abs(hit.z - 20) > 0.01) err(`raycast de prueba inesperado: ${JSON.stringify(hit)}`);
  }

  console.log(`Zonas: ${M.ZONES.length}, puertas: ${M.DOORS.length}, ventanas: ${M.WINDOW_INFO.length}, escaleras: ${M.STAIRS.length}, interactuables: ${M.INTERACTABLES.length}`);
  console.log(errors ? `${errors} error(es) en ${id}` : `Mapa ${id} OK`);
  total += errors;
}
process.exit(total ? 1 : 0);
