// Clase Renderer: paso 4 de la refactorización a clases (ver plan.md). Fachada fina sobre THREE.WebGLRenderer
// -- no reimplementa Three.js: el recorte por frustum, la ordenación de transparencias y la transformación
// mundo->pantalla ya los hace Three. Aquí vive lo que es de "dibujar" y antes estaba suelto en main.js:
// crear/configurar el renderer, tamaño y resolución dinámica, sombras a 30 Hz y el pase de dibujo.
//
// Principio de solo lectura: render() recibe la escena, la cámara y (opcional) la capa del arma en primera
// persona, y NO cambia el estado del juego. Qué se dibuja y cuándo (¿hay partida?, ¿está muerto?) lo decide
// quien llama (main.js).
//
// ctx.renderer sigue siendo el THREE.WebGLRenderer (otros módulos usan .capabilities/.domElement/.compile);
// esta fachada se expone aparte como ctx.gfx.
import * as THREE from 'three';

const DYN_MIN = 0.75;   // escala mínima de la resolución dinámica (más baja se ve demasiado borroso)

export class Renderer {
  // opts: { quality, brightness, baseExposure, mount }. Lanza si no hay WebGL (quien llama lo muestra).
  constructor({ quality, brightness, baseExposure, mount }) {
    this.baseExposure = baseExposure;
    this.dynScale = 1;
    this._dyn = { t: 0, n: 0, good: 0, probe: null, holdUntil: 0 };
    this._shadowTick = 0;

    const gl = new THREE.WebGLRenderer({
      antialias: quality === 'high',
      powerPreference: 'high-performance',
      stencil: false,
    });
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = baseExposure * brightness;
    gl.autoClear = false;
    gl.shadowMap.type = THREE.PCFShadowMap;
    gl.shadowMap.enabled = quality === 'high';
    gl.shadowMap.autoUpdate = false;   // se recalcula a 30 Hz (ver tickShadows)
    gl.setClearColor(0x000000, 1);
    gl.setPixelRatio(this.pixelRatioFor(quality));
    gl.setSize(window.innerWidth, window.innerHeight);
    gl.domElement.style.display = 'block';
    gl.domElement.tabIndex = -1;
    mount.appendChild(gl.domElement);
    gl.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[main] Se perdió el contexto WebGL; se intentará recuperar.');
    });
    this.gl = gl;
  }

  get domElement() { return this.gl.domElement; }
  get info() { return this.gl.info; }

  pixelRatioFor(quality) {
    return Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.5) * this.dynScale;
  }

  // Ajusta canvas y resolución al tamaño de la ventana. Devuelve el aspecto (ancho/alto).
  resize(quality) {
    const w = window.innerWidth, h = Math.max(1, window.innerHeight);
    this.gl.setPixelRatio(this.pixelRatioFor(quality));
    this.gl.setSize(w, h);
    return w / h;
  }

  // Aplica los ajustes del jugador (calidad, brillo, sombras). scene: para recompilar materiales al cambiar sombras.
  applySettings(settings, scene) {
    const gl = this.gl;
    this.resize(settings.quality);
    gl.toneMappingExposure = this.baseExposure * settings.brightness;
    const shadows = settings.quality === 'high';
    if (gl.shadowMap.enabled !== shadows) {
      gl.shadowMap.enabled = shadows;
      scene.traverse((o) => {
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const mat of mats) mat.needsUpdate = true;
      });
    }
  }

  // Resolución dinámica: baja si el juego no llega a ~50 FPS y vuelve a subir cuando sobra margen.
  // active: false en menús/pestaña oculta (no se mide entonces).
  adaptResolution(realDt, active, quality) {
    if (!active || realDt > 0.25) return;
    const d = this._dyn;
    d.t += realDt; d.n++;
    if (d.t < 1.5) return;
    const avg = d.t / d.n;
    d.t = 0; d.n = 0;
    let next = this.dynScale;
    const now = performance.now();
    if (d.probe && avg > d.probe.avg * 0.92) {
      // bajar la resolución no ha servido (el límite es el procesador, no la gráfica): se deshace y se deja estar
      next = d.probe.scale;
      d.holdUntil = now + 20000;
      d.probe = null;
    } else if (avg > 1 / 48 && now >= d.holdUntil && this.dynScale > DYN_MIN) {
      d.probe = { avg, scale: this.dynScale };
      next = Math.max(DYN_MIN, this.dynScale - 0.1); d.good = 0;
    } else if (avg < 1 / 57 && ++d.good >= 3) { d.probe = null; next = Math.min(1, this.dynScale + 0.05); d.good = 0; }
    else d.probe = null;
    if (next !== this.dynScale) {
      this.dynScale = next;
      this.resize(quality);
    }
  }

  // Sombras a 30 Hz: la mitad de pasadas sin que se note. worldWants: función del mundo (puede pedir menos).
  tickShadows(world) {
    const sm = this.gl.shadowMap;
    if (sm.enabled && (this._shadowTick ^= 1)) {
      if (!world || typeof world.wantShadowUpdate !== 'function' || world.wantShadowUpdate()) sm.needsUpdate = true;
    }
  }

  resetStats() { this.gl.info.autoReset = false; this.gl.info.reset(); }

  // Pase de dibujo. overlay = { scene, camera } (arma en primera persona) o null: se dibuja encima con el
  // buffer de profundidad limpio para que no atraviese paredes.
  render(scene, camera, overlay = null) {
    const gl = this.gl;
    gl.autoClear = false;
    gl.clear();
    gl.render(scene, camera);
    if (overlay) {
      gl.clearDepth();
      gl.render(overlay.scene, overlay.camera);
    }
  }
}

export default Renderer;
