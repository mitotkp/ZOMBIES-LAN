// Clase World (SPEC 6.8): construye el mapa a partir de shared/map.js y lo mantiene sincronizado con el estado
// del servidor. La geometría estática se fusiona por material (StaticBatch); los objetos con estado
// (puertas, ventanas, máquinas, caja, mesa, potenciadores) derivan su aspecto de ctx.gs para que volver al lobby
// y empezar otra partida funcione sin recargar. Los eventos solo disparan animaciones y sonidos.
import * as THREE from 'three';
import { MaterialLib, StaticBatch, serverNow, sfx, music, announce } from './kit.js';
import { setAnisotropy } from './textures.js';
import { buildLevelGeometry } from './levelgeo.js';
import { buildStaticProps, createInteractives, SignSet, Flames } from './props.js';
import { Lighting } from './lighting.js';
import { Sky, FOG_COLOR, FOG_DENSITY } from './sky.js';
import { Powerups } from './powerups.js';
import { POWERUP_INFO } from '/shared/constants.js';

// Eventos del servidor que se reenvían a los objetos interactivos
const FORWARD = [
  'door', 'power', 'board', 'boxOpen', 'boxTeddy', 'boxMove', 'papStart', 'papReady', 'perk', 'part', 'built',
  'pu', 'puSpawn', 'shieldTake',
];

export class World {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'world';
    this.mats = new MaterialLib();
    this.signs = new SignSet();
    this.flames = new Flames(this.root);
    this.time = 0;
    this.built = false;
    this.interactives = [];
    this.lighting = null;
    this.sky = null;
    this.powerups = null;
    this._gs = null;          // último gs aplicado
    this._unsub = [];
  }

  // ------------------------------------------------------------------ construcción (una sola vez)
  build() {
    if (this.built) return;
    this.built = true;
    const { ctx } = this;
    const scene = ctx.scene;

    try { setAnisotropy(ctx.renderer.capabilities.getMaxAnisotropy()); } catch (e) { /* sin renderer */ }
    scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
    scene.background = new THREE.Color(FOG_COLOR);

    this.sky = new Sky(this);
    this.sky.addTo(scene);

    const B = new StaticBatch(this.mats);
    buildLevelGeometry(B);
    this._try('props', () => buildStaticProps(B, this));
    this.lighting = new Lighting(this);
    this._try('lighting', () => this.lighting.build(B));
    this.interactives = createInteractives(this, B);
    this.powerups = new Powerups(this);
    this.interactives.push(this.powerups);

    B.build(this.root, { shadows: true, name: 'level' });
    this.signs.build(this.root);
    scene.add(this.root);
    this._applyQuality();

    const ev = ctx.events;
    if (ev) {
      this._unsub.push(ev.on('gs', ({ gs, prev }) => this._sync(gs, prev)));
      this._unsub.push(ev.on('settings', () => this._applyQuality()));
      for (const name of FORWARD) {
        this._unsub.push(ev.on('ev:' + name, (e) => this._event(name, e || {})));
      }
      this._unsub.push(ev.on('ev:buy', (e) => {
        if (e && this._isSelf(e.pid)) sfx(ctx, 'buy');
      }));
    }
    if (ctx.gs) this._sync(ctx.gs, null);
  }

  _try(name, fn) {
    try { return fn(); } catch (e) { console.error('[World] Error en', name, e); return undefined; }
  }

  _isSelf(pid) {
    const id = this.ctx.selfId;
    return pid != null && id != null && String(pid) === String(id);
  }

  now() { return serverNow(this.ctx); }

  // ¿Se reproducen animaciones "en vivo"? (no al conectarse ni al volver del lobby)
  isLive() {
    const gs = this.ctx.gs;
    return !!(gs && gs.phase === 'playing');
  }

  _applyQuality() {
    const high = !this.ctx.settings || this.ctx.settings.quality !== 'low';
    if (this.lighting) this._try('lighting.quality', () => this.lighting.applyQuality());
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.noShadow) return;
      if (o.userData.baseCast === undefined) o.userData.baseCast = o.castShadow;
      o.castShadow = high && o.userData.baseCast;
    });
  }

  // ------------------------------------------------------------------ estado
  _sync(gs, prev) {
    if (!gs) return;
    const live = !!(prev && gs.phase === 'playing' && prev.phase === 'playing');
    if (this.lighting) this.lighting.setPowered(!!gs.power, live && !(prev && prev.power));
    for (const it of this.interactives) {
      if (typeof it.sync === 'function') this._try(`${it.name}.sync`, () => it.sync(gs, prev, live));
    }
    this._gs = gs;
  }

  _event(name, e) {
    const ctx = this.ctx;
    // Sonidos/voces generales
    switch (name) {
      case 'power':
        music(ctx, 'power');
        if (this.lighting) this.lighting.setPowered(true, true);
        break;
      case 'pu': {
        const info = POWERUP_INFO[e.type];
        if (info) announce(ctx, info.announce);
        sfx(ctx, e.type === 'nuke' ? 'nuke' : 'powerup_grab', e.x, 0.6, e.z);
        break;
      }
      default: break;
    }
    for (const it of this.interactives) {
      if (typeof it.onEvent === 'function') this._try(`${it.name}.${name}`, () => it.onEvent(name, e));
    }
  }

  // ------------------------------------------------------------------ bucle
  update(dt) {
    if (!this.built) return;
    this.time += dt;
    const t = this.time;
    if (this.sky) this.sky.update(dt, this.ctx.camera);
    if (this.lighting) this._try('lighting.update', () => this.lighting.update(dt, t));
    this.flames.update(t);
    const gs = this.ctx.gs;
    for (const it of this.interactives) {
      if (typeof it.update === 'function') this._try(`${it.name}.update`, () => it.update(dt, t, gs));
    }
  }
}

export default World;
