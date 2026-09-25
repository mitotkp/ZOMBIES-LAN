// Linterna del jugador local (tecla L). Es un SpotLight hijo de la cámara que siempre está en la escena
// (apagada = intensidad 0) para no cambiar el número de luces y evitar recompilar shaders al encenderla.
// El estado se publica en ctx.flashlightOn: PlayerController lo envía como PF.FLASHLIGHT para que
// los demás jugadores vean el haz (PlayerModel).
import * as THREE from 'three';
import { sfx, flickerNoise } from './kit.js';

const ON_INTENSITY = 80;

export class Flashlight {
  constructor(world) {
    this.world = world;
    this.ctx = world.ctx;
    this.name = 'flashlight';
    this.on = false;
    this.level = 0;
    const cam = this.ctx.camera;
    this.light = new THREE.SpotLight(0xfff1d8, 0, 32, 0.44, 0.6, 1.3);
    this.light.castShadow = false;
    this.light.position.set(0.16, -0.14, 0.05);
    this.target = new THREE.Object3D();
    this.target.position.set(0.04, -0.12, -6);
    this.light.target = this.target;
    if (cam) {
      cam.add(this.light);
      cam.add(this.target);
      if (!cam.parent && this.ctx.scene) this.ctx.scene.add(cam);
    }
  }

  _canUse() {
    const ctx = this.ctx;
    const gs = ctx.gs;
    const self = ctx.self;
    return !!(gs && gs.phase === 'playing' && self && self.state !== 'dead');
  }

  sync(gs) {
    // al volver al lobby o en modo espectador se apaga
    if (!gs || gs.phase !== 'playing') this.on = false;
  }

  update(dt, t) {
    const ctx = this.ctx;
    if (!this._canUse()) {
      this.on = false;
    } else if (ctx.input && typeof ctx.input.pressed === 'function' && ctx.input.pressed('flashlight')) {
      this.on = !this.on;
      sfx(ctx, 'ui_click', null, null, null, { volume: 0.7 });
    }
    ctx.flashlightOn = this.on;
    // encendido suave y un temblor muy leve de pila vieja
    const want = this.on ? 1 : 0;
    this.level += (want - this.level) * Math.min(1, dt * 18);
    const flick = 0.94 + 0.06 * flickerNoise(t * 0.7, 3.3);
    this.light.intensity = ON_INTENSITY * this.level * flick;
  }
}

export default Flashlight;
