// Sala de pruebas (/test/): visor de armas en primera persona, animaciones de manos y modelos de zombis,
// jefes y jugador, sin conectarse al servidor. No está enlazada desde el menú del juego.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ViewModel, KNIFE_DUR, THROW_DUR, DRINK_DUR, BASH_DUR } from './weapons/viewmodel.js';
import { updateCamo } from './weapons/models.js';
import { ZombieModel } from './entities/zombieModel.js';
import { PlayerModel } from './entities/playerModel.js';
import { World } from './world/level.js';
import { WEAPONS, MELEE_WEAPONS, weaponDef } from '/shared/weapons.js';
import { MEDS, ZOMBIE_TYPES, PLAYER } from '/shared/constants.js';
import { ZA, ZF, PF } from '/shared/protocol.js';

const $ = (id) => document.getElementById(id);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const seg = (x, a, b) => clamp01((x - a) / (b - a));
const TRACER = 0xffc070;

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.autoClear = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
$('view').appendChild(renderer.domElement);

// ------------------------------------------------------------------ escena del mundo (fondo en 1.ª persona)
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
const SPAWN = { x: 10.5, z: 24.5 };
camera.position.set(SPAWN.x, PLAYER.eyeHeight || 1.62, SPAWN.z);
camera.rotation.set(-0.05, 0, 0, 'YXZ');
scene.add(camera);
const ctx = { scene, camera, renderer, settings: { quality: 'high', brightness: 1.2 }, gs: null, events: null };
let world = null;
try {
  world = new World(ctx);
  world.build();
} catch (e) {
  console.warn('[test] no se pudo construir el mapa, uso una sala simple', e);
  world = null;
  scene.background = new THREE.Color(0x1a1716);
  scene.add(new THREE.HemisphereLight(0xc6d4f0, 0x2e2822, 1.4));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(SPAWN.x, 0, SPAWN.z);
  scene.add(floor);
}
// un par de zombis quietos delante para tener referencia de escala
const extras = [];
for (const [dx, dz, type] of [[-1.2, -4.5, 'normal'], [1.4, -6, 'runner']]) {
  const z = new ZombieModel({ quality: 'high', seed: 1000 + extras.length * 77, type });
  z.group.position.set(SPAWN.x + dx, 0, SPAWN.z + dz);
  z.group.rotation.y = 0;
  scene.add(z.group);
  extras.push(z);
}

// ------------------------------------------------------------------ escena del arma
const vmScene = new THREE.Scene();
const vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
const vm = new ViewModel(ctx, vmScene, vmCamera);
const controls = new OrbitControls(vmCamera, renderer.domElement);
controls.target.set(0.08, -0.15, -0.38);
controls.enableDamping = true;
controls.minDistance = 0.15;
controls.maxDistance = 1.5;
controls.enabled = false;

// ------------------------------------------------------------------ escena de modelos
const mScene = new THREE.Scene();
mScene.background = new THREE.Color(0x201c1b);
mScene.fog = new THREE.Fog(0x201c1b, 14, 30);
const mCamera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
mCamera.position.set(2.6, 2.0, 3.6);
mScene.add(new THREE.HemisphereLight(0xd6e0f5, 0x3a302a, 1.3));
const sun = new THREE.DirectionalLight(0xffe6c8, 2.2);
sun.position.set(4, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 8, bottom: -4, near: 0.5, far: 30 });
mScene.add(sun);
const rim = new THREE.DirectionalLight(0x8fb0ff, 0.8);
rim.position.set(-5, 3, -4);
mScene.add(rim);
{
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ color: 0x3a3431, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  mScene.add(floor);
  const grid = new THREE.GridHelper(30, 30, 0x5a4a44, 0x3a302c);
  grid.position.y = 0.002;
  mScene.add(grid);
}
const mControls = new OrbitControls(mCamera, renderer.domElement);
mControls.target.set(0, 1.0, 0);
mControls.enableDamping = true;
mControls.enabled = false;

// ------------------------------------------------------------------ interfaz
const weaponKeys = Object.keys(WEAPONS);
for (const k of weaponKeys) $('weapon').add(new Option(`${WEAPONS[k].name} (${WEAPONS[k].model})`, k));
$('weapon').value = 'm1911';
for (const k of Object.keys(MELEE_WEAPONS)) $('melee').add(new Option(MELEE_WEAPONS[k].name, k));
$('pweapon').add(new Option('(sin arma)', ''));
for (const k of weaponKeys) $('pweapon').add(new Option(WEAPONS[k].name, k));
$('pweapon').value = 'm16' in WEAPONS ? 'm16' : weaponKeys[0];
const MODEL_TYPES = Object.keys(ZOMBIE_TYPES);
for (const k of MODEL_TYPES) $('model').add(new Option(`${ZOMBIE_TYPES[k].name}${ZOMBIE_TYPES[k].boss ? ' (jefe)' : ''}`, 'z:' + k));
$('model').add(new Option('Jugador', 'player'));
const ANIMS = [['Quieto', ZA.IDLE], ['Caminar', ZA.WALK], ['Correr', ZA.RUN], ['Esprintar', ZA.SPRINT], ['Atacar', ZA.ATTACK],
  ['Arrancar tablas', ZA.TEAR], ['Saltar ventana', ZA.CLIMB], ['Salir del suelo', ZA.RISE], ['Reptar', ZA.CRAWL], ['Aturdido', ZA.STUN]];
for (const [n, v] of ANIMS) $('anim').add(new Option(n, v));
$('anim').value = ZA.WALK;

let mode = 'weapons';
let cam = 'fp';
const state = {
  visible: true, hide: false, ads: 0, sprint: false, speed01: 0, onGround: true, crouch: false, down: false,
  yaw: 0, pitch: 0, velY: 0, reload: null, cycle: null, slideLocked: false, shieldOut: false,
};
let adsAmount = 0;
let reload = null;       // { style, t, dur, wasEmpty }
let cycle = null;        // { style, t, dur }
let lastAction = null;   // qué acción controla el deslizador de "congelar"
let fireCd = 0;
let equipped = null;

function curDef() { return weaponDef($('weapon').value, $('pap').checked); }
function reloadStyle(def) {
  switch (def.model) {
    case 'pistol': return 'pistol';
    case 'revolver': return 'revolver';
    case 'raygun': return 'raygun';
    case 'doublebarrel': return 'break';
    case 'shotgun': return def.mode === 'pump' ? 'shell' : 'mag';
    case 'lmg': return 'lmg';
    case 'sniper': return def.mode === 'bolt' ? 'bolt' : 'mag';
    case 'launcher': return 'launcher';
    default: return 'mag';
  }
}
function equip() {
  const key = $('weapon').value, up = $('pap').checked;
  const sig = key + (up ? '+' : '');
  if (sig === equipped) return;
  equipped = sig;
  reload = null; cycle = null;
  vm.setWeapon(key, up);
}
function clearActions() { vm.cancelActions(); reload = null; }

// Acciones: cada una recuerda cómo leer y fijar su progreso (para congelarla en un punto)
const ACTIONS = {
  fire() {
    const def = curDef();
    if (!def) return;
    vm.fire({ kick: 1, flash: 1, color: def.upgraded ? 0x9a6bff : TRACER });
    if (def.mode === 'pump' || def.mode === 'bolt') {
      cycle = { style: def.mode, t: 0, dur: 0.75 };
      lastAction = { name: 'Ciclo ' + (def.mode === 'pump' ? 'de corredera' : 'de cerrojo'), get: () => cycle && cycle.t / cycle.dur,
        set: (u) => { if (!cycle) cycle = { style: def.mode, t: 0, dur: 0.75 }; cycle.t = u * cycle.dur; } };
    }
  },
  reload() {
    const def = curDef();
    if (!def) return;
    clearActions();
    const style = reloadStyle(def);
    reload = { style, t: 0, dur: Math.max(0.6, def.reload || 2), wasEmpty: $('empty').checked };
    if (style === 'shell') reload.dur = 2.6;
    lastAction = { name: 'Recarga (' + style + ')', get: () => reload && reload.t / reload.dur,
      set: (u) => { if (!reload) ACTIONS.reload(); reload.t = u * reload.dur; } };
  },
  knife() {
    clearActions();
    const ms = MELEE_WEAPONS[$('melee').value] || MELEE_WEAPONS.knife;
    const dur = ms.dur || KNIFE_DUR;
    vm.playKnife(ms.key, dur);
    lastAction = { name: ms.name, get: () => vm.knifeT >= 0 ? vm.knifeT / vm.knifeDur : null,
      set: (u) => { if (vm.knifeT < 0) vm.playKnife(ms.key, dur); vm.knifeT = u * vm.knifeDur; } };
  },
  throw() {
    clearActions();
    vm.playThrow();
    lastAction = { name: 'Granada', get: () => vm.throwT >= 0 ? vm.throwT / THROW_DUR : null,
      set: (u) => { if (vm.throwT < 0) vm.playThrow(); vm.throwT = u * THROW_DUR; } };
  },
  drink(color = MEDS.antidote.color, dur = MEDS.antidote.useTime) {
    clearActions();
    vm.playDrink(color, dur);
    lastAction = { name: 'Beber', get: () => vm.drinkT >= 0 ? vm.drinkT / vm.drinkDur : null,
      set: (u) => { if (vm.drinkT < 0) vm.playDrink(color, dur); vm.drinkT = u * vm.drinkDur; } };
  },
  heal(kind) {
    clearActions();
    const dur = MEDS[kind].useTime;
    vm.playHeal(kind, dur);
    lastAction = { name: MEDS[kind].name, get: () => vm.healT >= 0 ? vm.healT / vm.healDur : null,
      set: (u) => { if (vm.healT < 0) vm.playHeal(kind, dur); vm.healT = u * vm.healDur; } };
  },
  bash() {
    if (!state.shieldOut) setShield(true);
    vm.playBash();
    lastAction = { name: 'Golpe de escudo', get: () => vm.bashT >= 0 ? vm.bashT / BASH_DUR : null,
      set: (u) => { if (vm.bashT < 0) vm.playBash(); vm.bashT = u * BASH_DUR; } };
  },
};
function setShield(on) { state.shieldOut = on; $('a-shield').classList.toggle('on', on); }

$('a-fire').onclick = () => ACTIONS.fire();
$('a-reload').onclick = () => ACTIONS.reload();
$('a-knife').onclick = () => ACTIONS.knife();
$('a-throw').onclick = () => ACTIONS.throw();
$('a-drink').onclick = () => ACTIONS.drink();
$('a-perk').onclick = () => ACTIONS.drink('#e0282e', DRINK_DUR);
$('a-bandage').onclick = () => ACTIONS.heal('bandage');
$('a-medkit').onclick = () => ACTIONS.heal('medkit');
$('a-shield').onclick = () => setShield(!state.shieldOut);
$('a-bash').onclick = () => ACTIONS.bash();
$('weapon').onchange = equip;
$('pap').onchange = equip;
$('speed').oninput = () => { $('speed-v').textContent = (+$('speed').value).toFixed(2) + '×'; };
$('scrub').oninput = () => { $('scrub-v').textContent = (+$('scrub').value).toFixed(2); };
$('mspeed').oninput = () => { $('mspeed-v').textContent = (+$('mspeed').value).toFixed(1); };
$('freeze').onchange = () => {
  // al congelar sin acción en curso, se repite la última
  if ($('freeze').checked && lastAction && lastAction.get() == null) lastAction.set(+$('scrub').value);
};
$('toggle').onclick = () => {
  const hid = $('panel').classList.toggle('hidden');
  $('toggle').textContent = hid ? 'Mostrar panel' : 'Ocultar panel';
};
for (const b of document.querySelectorAll('[data-cam]')) {
  b.onclick = () => {
    cam = b.dataset.cam;
    for (const o of document.querySelectorAll('[data-cam]')) o.classList.toggle('on', o === b);
    vmCamera.position.set(0, 0, 0);
    vmCamera.rotation.set(0, 0, 0);
    if (cam === 'side') { vmCamera.position.set(0.42, -0.08, -0.32); vmCamera.lookAt(0.08, -0.14, -0.36); }
    if (cam === 'free') { vmCamera.position.set(0.35, 0.05, 0.05); controls.target.set(0.08, -0.15, -0.38); controls.update(); }
    controls.enabled = cam === 'free' && mode === 'weapons';
  };
}
function setMode(m) {
  mode = m;
  document.body.className = 'm-' + m;
  $('tab-weapons').classList.toggle('on', m === 'weapons');
  $('tab-models').classList.toggle('on', m === 'models');
  controls.enabled = m === 'weapons' && cam === 'free';
  mControls.enabled = m === 'models';
  buildModels();
}
$('tab-weapons').onclick = () => setMode('weapons');
$('tab-models').onclick = () => setMode('models');
// atajos de teclado
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  const map = { f: 'fire', r: 'reload', v: 'knife', g: 'throw' };
  if (map[k]) ACTIONS[map[k]]();
  else if (k === 'h') ACTIONS.heal('bandage');
  else if (k === 'j') ACTIONS.heal('medkit');
  else if (k === 'q') setShield(!state.shieldOut);
  else if (k === ' ') { $('freeze').checked = !$('freeze').checked; $('freeze').onchange(); e.preventDefault(); }
});

// ------------------------------------------------------------------ modelos
let models = [];   // { kind: 'zombie'|'player', m, x, type }
function clearModels() {
  for (const o of models) { mScene.remove(o.m.group); try { o.m.dispose(); } catch { /* nada */ } }
  models = [];
}
function makeModel(sel, x) {
  if (sel === 'player') {
    const m = new PlayerModel({ quality: 'high', color: '#3a7bd5', name: 'Jugador' });
    mScene.add(m.group);
    return { kind: 'player', m, x };
  }
  const type = sel.slice(2);
  const m = new ZombieModel({ quality: 'high', seed: 4242 + x * 13, type });
  m.group.position.set(x, 0, 0);
  m.group.rotation.y = Math.PI;                    // de cara a la cámara
  m.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  mScene.add(m.group);
  return { kind: 'zombie', m, x, type };
}
function buildModels() {
  clearModels();
  if (mode !== 'models') return;
  if ($('row').checked) {
    const all = MODEL_TYPES.map((k) => 'z:' + k).concat(['player']);
    const gap = 1.6;
    all.forEach((s, i) => models.push(makeModel(s, (i - (all.length - 1) / 2) * gap)));
    mControls.target.set(-1.6, 1.1, 0);             // desplazado para que el panel no tape la fila
    mCamera.position.set(-1.6, 3.4, 13.5);
  } else {
    models.push(makeModel($('model').value, 0));
    const big = models[0].type && ZOMBIE_TYPES[models[0].type] && (ZOMBIE_TYPES[models[0].type].boss || models[0].type === 'tank');
    mControls.target.set(0, big ? 1.3 : 1.0, 0);
    mCamera.position.set(2.6, 2.0, big ? 5 : 3.6);
  }
}
$('model').onchange = buildModels;
$('row').onchange = buildModels;
$('z-reset').onclick = buildModels;
$('z-hit').onclick = () => { for (const o of models) if (o.kind === 'zombie') o.m.hitReact('torso', 0, 1, 1); };
$('z-attack').onclick = () => { for (const o of models) if (o.kind === 'zombie') { o.m.onAttack(); o.attackT = 0.9; } };
// Habilidad según el jefe: carga (Carnicero), golpe al suelo (Acorazado), invocación (Nigromante)
let chargeT = 0;
$('z-ability').onclick = () => {
  for (const o of models) {
    if (o.kind !== 'zombie') continue;
    if (o.type === 'butcher') { chargeT = 1.3; o.m.onAbility('charge'); }
    else if (o.type === 'armored') { o.m.onAbility('slamStart'); setTimeout(() => o.m.onAbility('slam'), 800); }
    else if (o.type === 'necro') o.m.onAbility('summon');
    else if (o.type === 'specter') $('cloak').checked = !$('cloak').checked;
  }
};
$('z-death').onclick = () => { for (const o of models) if (o.kind === 'zombie') o.m.startDeath(null, 0, 1, {}); };

// ------------------------------------------------------------------ bucle
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  for (const c of [camera, vmCamera, mCamera]) { c.aspect = w / h; c.updateProjectionMatrix(); }
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let walkT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dt = realDt * (+$('speed').value);
  if (mode === 'weapons') updateWeapons(dt);
  else updateModels(dt);
  render();
}

function updateWeapons(dt) {
  equip();
  const def = curDef();
  // estado de movimiento
  adsAmount += (($('ads').checked ? 1 : 0) - adsAmount) * Math.min(1, dt * 10);
  state.ads = adsAmount;
  state.sprint = $('sprint').checked;
  state.crouch = $('crouch').checked;
  state.down = $('down').checked;
  const moving = $('walk').checked || state.sprint;
  state.speed01 = moving ? (state.sprint ? 1 : 0.6) : 0;
  walkT += dt;
  // disparo automático
  fireCd -= dt;
  if ($('auto').checked && fireCd <= 0 && !reload) {
    ACTIONS.fire();
    fireCd = def && def.rpm ? 60 / def.rpm : 0.15;
  }
  // recarga y ciclo (los lleva la página: el visor solo recibe su progreso)
  if (reload) { reload.t += dt; if (reload.t >= reload.dur) reload = null; }
  if (cycle) { cycle.t += dt; if (cycle.t >= cycle.dur) cycle = null; }
  // congelar: fija el progreso de la última acción (compensando el dt que sumará update)
  const frozen = $('freeze').checked && lastAction;
  if (frozen) {
    const u = Math.min(0.999, +$('scrub').value);
    lastAction.set(u);
    if (vm.knifeT >= 0) vm.knifeT -= dt;
    if (vm.throwT >= 0) vm.throwT -= dt;
    if (vm.drinkT >= 0) vm.drinkT -= dt;
    if (vm.healT >= 0) vm.healT -= dt;
    if (vm.bashT >= 0) vm.bashT -= dt;
  }
  state.reload = reload ? reloadState(reload) : null;
  state.cycle = cycle ? { style: cycle.style, p: cycle.t / cycle.dur } : null;
  state.slideLocked = false;
  vm.update(dt, state);
  updateCamo(dt);
  const u = lastAction ? lastAction.get() : null;
  $('status').textContent = lastAction ? `${lastAction.name}: ${u == null ? 'terminada' : u.toFixed(2)}` : 'Pulsa una acción (F, R, V, G, H, J, Q; espacio congela).';
  // fondo
  if (world) { try { world.update(dt); } catch { /* nada */ } }
  for (const z of extras) z.update(dt, { anim: ZA.IDLE, flags: 0, speed: 0 });
  // balanceo de cámara al caminar (solo en 1.ª persona, como referencia)
  camera.position.y = (PLAYER.eyeHeight || 1.62) - (state.crouch ? 0.5 : 0) + (moving ? Math.sin(walkT * 9) * 0.02 : 0);
}

// progreso de recarga en el formato que espera el visor
function reloadState(r) {
  const p = clamp01(r.t / r.dur);
  if (r.style === 'shell') {
    // inclinar, meter 3 cartuchos y bombear
    const tilt = seg(p, 0, 0.12) * (1 - seg(p, 0.8, 0.88));
    const lp = seg(p, 0.12, 0.8) * 3;
    return { style: 'shell', tilt, shell: p > 0.12 && p < 0.8 ? lp - Math.floor(lp) : 0, pump: p > 0.8 ? seg(p, 0.8, 1) : -1 };
  }
  return { style: r.style, p, wasEmpty: r.wasEmpty };
}

function updateModels(dt) {
  const anim = +$('anim').value;
  const spd = +$('mspeed').value;
  let flags = 0;
  if ($('fuse').checked) flags |= ZF.FUSE;
  if ($('cloak').checked) flags |= ZF.CLOAK;
  if (chargeT > 0) { chargeT -= dt; flags |= ZF.CHARGE; }
  for (const o of models) {
    if (o.kind === 'zombie') {
      if (o.m.death) { o.m.updateDeath(dt, {}); continue; }
      let a = anim;
      if (o.attackT > 0) { o.attackT -= dt; a = ZA.ATTACK; }
      if (flags & ZF.CHARGE) a = ZA.SPRINT;
      o.m.update(dt, { anim: a, flags, speed: a === ZA.WALK || a === ZA.RUN || a === ZA.SPRINT || a === ZA.CRAWL ? spd : 0 });
    } else {
      let pf = 0;
      if ($('pcrouch').checked) pf |= PF.CROUCH;
      if ($('pads').checked) pf |= PF.ADS;
      if ($('pdown').checked) pf |= PF.DOWN;
      if ($('ptorch').checked) pf |= PF.FLASHLIGHT;
      o.m.update(dt, { x: o.x, y: 0, z: 0, yaw: Math.PI, pitch: 0, flags: pf, w: $('pweapon').value, up: false, hasShield: false });
    }
  }
  mControls.update();
}

function render() {
  renderer.clear();
  if (mode === 'models') { renderer.render(mScene, mCamera); return; }
  if (cam === 'free') controls.update();
  const bg = $('world').checked && cam === 'fp';
  if (bg) {
    renderer.render(scene, camera);
    renderer.clearDepth();
  } else {
    renderer.setClearColor(0x2a2624, 1);
    renderer.clear();
  }
  renderer.render(vmScene, vmCamera);
}

requestAnimationFrame(frame);
// altura (m) del modelo mostrado, para encuadrarlo en las pruebas automáticas
function lastModel() {
  const o = models[0];
  if (!o) return 1.8;
  const box = new THREE.Box3().setFromObject(o.m.group);
  return Math.max(0.5, box.max.y);
}
window.testroom = { vm, ACTIONS, setMode, vmCamera, controls, mCamera, mControls, lastModel, models: () => models };
