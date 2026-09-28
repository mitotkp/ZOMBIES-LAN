// Props del mundo cargados desde un modelo .glb real (en vez de geometría procedural). Carga en segundo
// plano sin bloquear, con caché por URL — mismo patrón tolerante a fallos que ya usa playerModel.js para las
// armas (MODELS/modelsFailed): mientras el modelo no está listo, placeGltfProp() devuelve null y quien lo
// llama debe caer al respaldo procedural existente.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();   // url -> THREE.Object3D (la escena original, NUNCA se inserta directamente) | 'failed'

// Dispara la carga la primera vez que se pide esta URL; llamadas posteriores solo consultan la caché.
function getPropModel(url) {
  const hit = cache.get(url);
  if (hit === 'failed') return null;
  if (hit) return hit;
  if (!cache.has(url)) {
    cache.set(url, null);   // marca "cargando" para no disparar loadAsync dos veces
    loader.loadAsync(url)
      .then((gltf) => cache.set(url, gltf.scene))
      .catch((err) => { cache.set(url, 'failed'); console.warn(`[gltfProps] No se pudo cargar ${url}:`, err); });
  }
  return null;
}

// Coloca una instancia (clonada) del modelo en (x, y, z) con rotación ry, colgada directamente de world.root
// (no del StaticBatch: éste solo funde BufferGeometry cruda con una clave de MaterialLib, no objetos GLTF —
// mismo patrón que ya usa castle/props.js para el retrato con textura única). Devuelve el Object3D creado, o
// null si el modelo todavía no ha terminado de cargar (el llamador debe usar el respaldo procedural en ese
// caso). castShadow/receiveShadow se fijan a mano porque _applyQuality() en level.js solo captura el
// castShadow inicial en su primera pasada, no en cargas asíncronas posteriores (mismo motivo por el que
// playerModel.js:630 ya lo hace igual para las armas).
// tint (opcional, un color de Three.js): multiplica el color de TODOS los materiales de esta instancia —
// para variar el color entre instancias (p. ej. barriles pintados de colores distintos) sin tocar el
// material compartido del caché. Clona el material la primera vez que hace falta un tinte concreto en este
// Object3D (nunca el material cacheado directamente).
export function placeGltfProp(world, url, x, y, z, ry = 0, tint = null) {
  const source = getPropModel(url);
  if (!source) return null;
  const inst = source.clone(true);
  inst.position.set(x, y, z);
  inst.rotation.y = ry;
  const highQuality = !world.ctx.settings || world.ctx.settings.quality !== 'low';
  const tintedCache = tint != null ? new Map() : null;
  inst.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = highQuality;
    o.receiveShadow = true;
    // La geometría (y, sin tinte, el material) vienen del caché de arriba, compartidos entre todas las
    // instancias y entre reconstrucciones del mundo (cambio de mapa) — level.js:dispose() no debe liberarlos.
    o.userData.sharedAsset = true;
    if (tintedCache) {
      let m = tintedCache.get(o.material);
      if (!m) { m = o.material.clone(); m.color.multiply(new THREE.Color(tint)); tintedCache.set(o.material, m); }
      o.material = m;
    }
  });
  world.root.add(inst);
  return inst;
}
