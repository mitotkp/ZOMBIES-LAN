// Controlador del jugador local: movimiento, colisión, cámara en primera persona y modo espectador.
// Movimiento con autoridad en el SERVIDOR (paso 6): aquí se PREDICE con el mismo stepMovement() del
// servidor (shared/movement.js) para que se sienta inmediato, cada fotograma genera un comando que viaja en
// 'st', y cuando llega la confirmación del servidor ('mv') se corrige y se re-simulan los comandos aún no
// confirmados. Lo cosmético (cámara, balanceo, pasos, sonidos) sigue siendo solo del cliente.

import * as THREE from 'three';
import { PLAYER, clamp, lerp, angleDiff } from '/shared/constants.js';
import { raycastMap } from '/shared/collision.js';
import { CB, STAMINUP_SPEED, newMoveState, spawnMoveState, quantizeCmd, packCmd, stepMovement, separateFromZombies, unpackMoveState, copyMoveState } from '/shared/movement.js';
import { PF } from '/shared/protocol.js';
import { PLAYER_SPAWNS, PLAYER_SPAWN_YAW, ZONES, MAP } from '/shared/map.js';

const LOOK_SCALE = 0.0022;        // rad por píxel con sensibilidad 1
const PITCH_LIMIT = 1.5;
const RECOIL_RECOVER = 0.6;       // fracción del retroceso que se recupera sola
const RECOIL_RATE = 7;

function sameId(a, b) { return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b); }
function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export class PlayerController {
  constructor(ctx) {
    this.ctx = ctx;
    const sp = PLAYER_SPAWNS[0] || { x: 0, z: 0 };

    // API pública
    this.position = new THREE.Vector3(sp.x, 0, sp.z);   // pies
    this.eye = new THREE.Vector3(sp.x, PLAYER.eyeHeight, sp.z);
    this.velocity = new THREE.Vector3();
    this.yaw = PLAYER_SPAWN_YAW;
    this.pitch = 0;
    this.onGround = true;
    this.isSprinting = false;
    this.isCrouching = false;
    this.isSliding = false;
    this.isMoving = false;
    this.speed01 = 0;
    this.adsZoom = 1;       // los fija WeaponSystem cada frame
    this.adsAmount = 0;
    this.moveMult = 1;
    this.stamina01 = 1;
    this.state = 'alive';   // vista actual: 'alive' | 'down' | 'dead'
    this.spectating = null; // pid observado en modo espectador

    // Internos
    this._lastState = null;
    this._eyeH = PLAYER.eyeHeight;
    this.sim = newMoveState(sp.x, 0, sp.z);   // estado simulado (predicción); position/velocity lo reflejan
    this._seq = 0;                 // numeración de comandos
    this._pending = [];            // comandos aún sin confirmar: { cmd, post }
    this._outbox = [];             // comandos por enviar en el próximo 'st'
    this._corr = new THREE.Vector3();   // corrección visual pendiente (se disipa sola)
    this._sprintT = 0;
    this._slideFx = 0;        // 0..1 suavizado para la cámara
    this._bobPhase = 0;
    this._bobAmp = 0;
    this._roll = 0;
    this._landDip = 0;
    this._recoilP = 0;
    this._recoilY = 0;
    this._shakeAmp = 0;
    this._shakeTime = 0;
    this._shakeDur = 0;
    this._shakeSeed = Math.random() * 100;
    this._t = 0;
    this._doors = {};
    this._spec = {
      angle: 0, elev: 0.35, dist: 4.2, idle: 0, init: false,
      cam: new THREE.Vector3(), focus: new THREE.Vector3(), lastPid: null,
    };
    this._tmp = new THREE.Vector3();

    const ev = ctx && ctx.events;
    if (ev && typeof ev.on === 'function') {
      ev.on('local:damage', (d) => {
        const amount = d && typeof d.amount === 'number' ? d.amount : 50;
        this.shake(amount > 0 ? 0.45 : 0.2, 0.3);
        // pequeño golpe de cámara que se recupera solo
        this._kick((Math.random() * 0.5 + 0.5) * 0.03, (Math.random() - 0.5) * 0.03, 1);
      });
      ev.on('ev:down', (e) => { if (e && sameId(e.pid, this.ctx.selfId)) this.shake(0.8, 0.6); });
      ev.on('ev:shieldHit', (e) => { if (e && sameId(e.pid, this.ctx.selfId)) this.shake(0.25, 0.2); });
      ev.on('ev:shieldBreak', (e) => { if (e && sameId(e.pid, this.ctx.selfId)) this.shake(0.5, 0.35); });
      ev.on('ev:boom', (e) => {
        if (!e || !Array.isArray(e.p)) return;
        const d = Math.hypot((+e.p[0] || 0) - this.position.x, (+e.p[2] || 0) - this.position.z);
        const r = Math.max(4, (+e.r || 4) * 2.5);
        if (d < r) this.shake(clamp(1 - d / r, 0.1, 1) * 0.9, 0.5);
      });
      ev.on('ev:pu', (e) => { if (e && e.type === 'nuke') this.shake(0.6, 0.9); });
      ev.on('net:mv', (m) => this._onServerMove(m));
      ev.on('net:open', () => { this._seq = 0; this._pending.length = 0; this._outbox.length = 0; });
    }
  }

  // ------------------------------------------------------------------ API pública
  spawn(x, z, yaw, y) {
    const sp = PLAYER_SPAWNS[0] || { x: 0, z: 0, y: 0 };
    x = Number(x); z = Number(z); y = Number(y);
    if (!isFinite(x) || !isFinite(z)) { x = sp.x; z = sp.z; y = sp.y; }
    if (!isFinite(y)) y = sp.y || 0;
    this._doors = (this.ctx.gs && this.ctx.gs.doors) || {};
    this.sim = spawnMoveState(x, z, y, this._doors);
    this._pending.length = 0;
    this._outbox.length = 0;
    this._corr.set(0, 0, 0);
    x = this.sim.x; z = this.sim.z;
    this.position.set(x, this.sim.y, z);
    this.velocity.set(0, 0, 0);
    this.yaw = isFinite(Number(yaw)) ? wrapAngle(Number(yaw)) : PLAYER_SPAWN_YAW;
    this.pitch = 0;
    this.onGround = true;
    this.isSprinting = false;
    this.isCrouching = false;
    this.isSliding = false;
    this.stamina01 = 1;
    this._recoilP = 0; this._recoilY = 0;
    this._shakeTime = 0; this._shakeAmp = 0;
    this._landDip = 0;
    this._bobAmp = 0;
    this._roll = 0;
    this._eyeH = PLAYER.eyeHeight;
    this._spec.init = false;
    this.eye.set(x, this._eyeH, z);
    const cam = this.ctx.camera;
    if (cam && this._viewState() !== 'dead') {
      cam.position.copy(this.eye);
      cam.rotation.order = 'YXZ';
      cam.rotation.set(this.pitch, this.yaw, 0);
    }
    const ev = this.ctx.events;
    if (ev && ev.emit) ev.emit('local:respawn', { x, z, yaw: this.yaw });
  }

  // Retroceso: se aplica de inmediato y se recupera parcialmente
  addRecoil(pitchRad, yawRad) {
    this._kick(Number(pitchRad) || 0, Number(yawRad) || 0, RECOIL_RECOVER);
  }

  shake(intensity, seconds) {
    intensity = clamp(Number(intensity) || 0, 0, 3);
    seconds = clamp(Number(seconds) || 0.25, 0.02, 5);
    if (intensity <= 0) return;
    const cur = this._shakeDur > 0 ? this._shakeAmp * (this._shakeTime / this._shakeDur) : 0;
    this._shakeAmp = Math.max(cur, intensity);
    this._shakeTime = Math.max(this._shakeTime, seconds);
    this._shakeDur = this._shakeTime;
  }

  flags() {
    let f = 0;
    const st = this._viewState();
    if (this.isCrouching) f |= PF.CROUCH;
    if (this.isSprinting) f |= PF.SPRINT;
    if (!this.onGround) f |= PF.JUMPING;
    if (st === 'down') f |= PF.DOWN;
    if (this.ctx.flashlightOn) f |= PF.FLASHLIGHT;
    const w = this.ctx.weapons;
    if (w) {
      const ads = typeof w.adsAmount === 'number' ? w.adsAmount : this.adsAmount;
      if (ads > 0.5) f |= PF.ADS;
      if (w.isShieldOut) f |= PF.SHIELD_OUT;
      if (w.isReloading) f |= PF.RELOADING;
      if (w.isDrinking) f |= PF.DRINKING;
    } else if (this.adsAmount > 0.5) {
      f |= PF.ADS;
    }
    return f;
  }

  // Dirección de la mirada (vector unitario)
  getLookDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  // ------------------------------------------------------------------ bucle
  update(dt) {
    const ctx = this.ctx;
    const gs = ctx.gs;
    this._t += dt;
    if (!gs || gs.phase !== 'playing') {
      this.isMoving = false;
      this.isSprinting = false;
      this.speed01 = 0;
      this._lastState = null;
      return;
    }
    this._doors = gs.doors || {};
    const state = this._viewState();
    if (state !== this._lastState) this._onStateChange(this._lastState, state);
    this._lastState = state;
    this.state = state;

    if (state === 'dead') {
      this.isMoving = false;
      this.isSprinting = false;
      this.isCrouching = false;
      this.speed01 = 0;
      this._updateSpectator(dt);
      return;
    }
    this.spectating = null;
    this._updateLook(dt);
    this._updateMove(dt, state);
    this._updateCamera(dt, state);
  }

  _viewState() {
    const self = this.ctx.self;
    if (!self) return 'dead';
    return self.state === 'down' ? 'down' : self.state === 'dead' ? 'dead' : 'alive';
  }

  _onStateChange(prev, next) {
    if (next === 'down') {
      this.sim.crouchWanted = false;
      this.isSprinting = false;
    }
    if (next === 'dead') {
      this._spec.init = false;
      this._spec.lastPid = null;
    }
    if (prev === 'dead' && next !== 'dead') {
      // Volver a primera persona sin arrastrar la rotación del espectador
      const cam = this.ctx.camera;
      if (cam) cam.rotation.order = 'YXZ';
    }
  }

  _perks() {
    const self = this.ctx.self;
    return self && Array.isArray(self.perks) ? self.perks : [];
  }

  _kick(p, y, recoverFrac) {
    this.pitch = clamp(this.pitch + p, -PITCH_LIMIT, PITCH_LIMIT);
    this.yaw = wrapAngle(this.yaw + y);
    this._recoilP += p * recoverFrac;
    this._recoilY += y * recoverFrac;
  }

  _currentFovScale() {
    const cam = this.ctx.camera;
    const base = this._baseFov();
    if (!cam || !cam.fov) return 1;
    return clamp(cam.fov / base, 0.15, 1.2);
  }

  _baseFov() {
    const s = this.ctx.settings || {};
    return clamp(Number(s.fov) || 75, 50, 120);
  }

  _updateLook(dt) {
    const input = this.ctx.input;
    const s = this.ctx.settings || {};
    const m = input && typeof input.consumeMouse === 'function' ? input.consumeMouse() : { dx: 0, dy: 0 };
    const sens = clamp(Number(s.sensitivity) || 1, 0.05, 10) * LOOK_SCALE * this._currentFovScale();
    const dyaw = -(m.dx || 0) * sens;
    const dpitch = -(m.dy || 0) * sens * (s.invertY ? -1 : 1);
    this.yaw += dyaw;
    this.pitch += dpitch;
    // Si el jugador compensa el retroceso con el ratón, no se "recupera" dos veces
    if (dpitch < 0 && this._recoilP > 0) this._recoilP = Math.max(0, this._recoilP + dpitch);
    if (dpitch > 0 && this._recoilP < 0) this._recoilP = Math.min(0, this._recoilP + dpitch);
    const k = 1 - Math.exp(-RECOIL_RATE * dt);
    const rp = this._recoilP * k, ry = this._recoilY * k;
    this.pitch -= rp; this._recoilP -= rp;
    this.yaw -= ry; this._recoilY -= ry;
    this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    this.yaw = wrapAngle(this.yaw);
  }

  _staminUp() { return this._perks().includes('staminup'); }

  // Entorno de la simulación (el mismo que arma el servidor): puertas, si está caído, ventaja y empuje de zombis
  _moveEnv(state) {
    const ents = this.ctx.entities;
    return {
      doors: this._doors,
      down: state === 'down',
      staminUp: this._staminUp(),
      separate: (x, z, dt, y, solid) => {
        if (!ents || typeof ents.getZombieTargets !== 'function') return null;
        let list;
        try { list = ents.getZombieTargets(); } catch { return null; }
        return separateFromZombies(list, 'yOff', x, z, dt, y, solid);
      },
    };
  }

  // Comandos por enviar en el próximo 'st' (formato de red)
  drainCommands() {
    if (!this._outbox.length) return [];
    const out = this._outbox.map(packCmd);
    this._outbox.length = 0;
    return out;
  }

  // Confirmación del servidor: descarta lo confirmado, compara con lo predicho y, si hay diferencia,
  // adopta el estado del servidor y vuelve a simular los comandos aún sin confirmar.
  _onServerMove(m) {
    const gs = this.ctx.gs;
    if (!m || !gs || gs.phase !== 'playing' || this._viewState() === 'dead') return;
    const srv = unpackMoveState(m.s);
    const ack = Number(m.seq);
    if (!srv || !Number.isFinite(ack)) return;
    let acked = null;
    while (this._pending.length && this._pending[0].cmd.seq <= ack) acked = this._pending.shift();
    if (!acked) return;                       // confirmación de algo que ya no recordamos
    const pr = acked.post;
    const err = Math.hypot(srv.x - pr.x, srv.z - pr.z) + Math.abs(srv.y - pr.y);
    if (err < 0.02) return;
    const bx = this.sim.x, by = this.sim.y, bz = this.sim.z;
    const env = this._moveEnv(this._viewState());
    const s = copyMoveState(this.sim, srv);
    for (const e of this._pending) {
      stepMovement(s, e.cmd, e.cmd.dt, env);
      e.post.x = s.x; e.post.y = s.y; e.post.z = s.z;
    }
    if (err < 1.5) {
      this._corr.x += bx - s.x; this._corr.y += by - s.y; this._corr.z += bz - s.z;
    } else this._corr.set(0, 0, 0);
  }

  _updateMove(dt, state) {
    const ctx = this.ctx;
    const input = ctx.input;
    const down = state === 'down';
    const staminUp = this._staminUp();
    const isDown = (a) => !!(input && input.isDown(a));
    const pressed = (a) => !!(input && input.pressed(a));
    const released = (a) => !!(input && input.released(a));

    let fwd = 0, str = 0;
    if (isDown('forward')) fwd += 1;
    if (isDown('back')) fwd -= 1;
    if (isDown('right')) str += 1;
    if (isDown('left')) str -= 1;
    // stick izquierdo del mando (analógico): manda si no se usa el teclado; la inclinación regula la velocidad
    let analogK = 1;
    const pm = input && input.enabled ? input.padMove : null;
    if (pm && fwd === 0 && str === 0 && (pm.x || pm.y)) { fwd = -pm.y; str = pm.x; analogK = Math.min(1, Math.hypot(pm.x, pm.y)); }

    const w = ctx.weapons;
    const adsActive = isDown('ads') || (w && typeof w.adsAmount === 'number' ? w.adsAmount : this.adsAmount) > 0.5;
    let bits = 0;
    if (isDown('sprint') && fwd > 0 && !adsActive) bits |= CB.SPRINT;
    if (pressed('sprint')) bits |= CB.SPRINT_PRESSED;
    if (pressed('crouch')) bits |= CB.CROUCH_PRESSED;
    if (isDown('crouch')) bits |= CB.CROUCH_DOWN;
    if (released('crouch')) bits |= CB.CROUCH_RELEASED;
    if (pressed('jump')) bits |= CB.JUMP_PRESSED;
    const mmRaw = Number(this.moveMult);

    // Predicción: el mismo paso que hace el servidor con este comando
    const sim = this.sim;
    let ev = null;
    if (dt > 0.0005) {
      const cmd = quantizeCmd({
        seq: ++this._seq, dt, fwd, str, analogK, yaw: this.yaw, mm: isFinite(mmRaw) ? mmRaw : 1, bits,
      });
      ev = stepMovement(sim, cmd, cmd.dt, this._moveEnv(state));
      this._pending.push({ cmd, post: { x: sim.x, y: sim.y, z: sim.z } });
      this._outbox.push(cmd);
      if (this._pending.length > 180) this._pending.shift();
      if (this._outbox.length > 90) this._outbox.shift();
    }
    if (ev) {
      if (ev.slid) this._sound('slide', { volume: 0.8 });
      if (ev.jumped) this._sound('jump', { volume: 0.7 });
      if (ev.impact > 2) {
        this._landDip = -Math.min(0.14, ev.impact * 0.022);
        this._sound('land', { volume: clamp(ev.impact / 7, 0.3, 1) });
      }
    }

    // La corrección visual pendiente se disipa sola (la simulación ya está en su sitio)
    const c = this._corr;
    const kc = Math.exp(-14 * dt);
    c.x *= kc; c.y *= kc; c.z *= kc;
    if (Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z) < 0.0005) c.set(0, 0, 0);

    // Reflejo de la simulación en la API pública
    const p = this.position, v = this.velocity;
    p.set(sim.x + c.x, sim.y + c.y, sim.z + c.z);
    v.set(sim.vx, sim.vy, sim.vz);
    this.onGround = sim.onGround;
    this.isSprinting = sim.sprinting;
    this.isCrouching = sim.crouching;
    this.isSliding = sim.sliding;
    this.stamina01 = sim.stamina;
    const sprint = sim.sprinting;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const rx = cy, rz = -sy;           // derecha
    this._sprintT += ((sprint ? 1 : 0) - this._sprintT) * (1 - Math.exp(-6 * dt));
    this._slideFx += ((this.isSliding ? 1 : 0) - this._slideFx) * (1 - Math.exp(-10 * dt));

    const hs = Math.hypot(v.x, v.z);
    this.isMoving = hs > 0.4;
    this.speed01 = clamp(hs / (PLAYER.sprintSpeed * (staminUp ? STAMINUP_SPEED : 1)), 0, 1);

    // Balanceo de cabeza y pasos
    if (this.onGround && hs > 0.4 && !this.isSliding) {
      const stride = down ? 1.0 : sprint ? 2.7 : this.isCrouching ? 1.6 : 2.15;   // m por ciclo (2 pasos)
      const prev = this._bobPhase;
      let ph = prev + (hs / stride) * Math.PI * 2 * dt;
      if (Math.floor(prev / Math.PI) !== Math.floor(ph / Math.PI)) this._footstep(down, sprint);
      if (ph >= Math.PI * 2) ph -= Math.PI * 2;
      this._bobPhase = ph;
    }
    let ampTarget = 0;
    if (this.onGround && hs > 0.4 && !this.isSliding) {
      ampTarget = (down ? 0.6 : sprint ? 1.35 : this.isCrouching ? 0.5 : 0.8) * Math.min(1, hs / PLAYER.walkSpeed);
    }
    const ads = clamp(Number(this.adsAmount) || 0, 0, 1);
    ampTarget *= 1 - 0.85 * ads;
    this._bobAmp += (ampTarget - this._bobAmp) * (1 - Math.exp(-10 * dt));

    // Inclinación lateral al desplazarse de costado
    const lateral = v.x * rx + v.z * rz;
    let rollTarget = -lateral * 0.0045;
    if (down) rollTarget += 0.11;
    rollTarget += 0.07 * this._slideFx;
    this._roll += (rollTarget - this._roll) * (1 - Math.exp(-8 * dt));

    // Altura de los ojos (agacharse / caído suave)
    const eyeTarget = down ? PLAYER.downEyeHeight : this.isSliding ? PLAYER.slideEyeHeight : this.isCrouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
    this._eyeH += (eyeTarget - this._eyeH) * (1 - Math.exp(-(down ? 4.5 : this.isSliding ? 16 : 12) * dt));
    this._landDip *= Math.exp(-9 * dt);
  }

  _footstep(down, sprint) {
    const vol = down ? 0.3 : this.isCrouching ? 0.3 : sprint ? 0.85 : 0.55;
    const rate = (down ? 0.75 : 1) * (0.92 + Math.random() * 0.16);
    this._sound('footstep', { volume: vol, rate });
  }

  _sound(name, opts) {
    const a = this.ctx.audio;
    if (a && typeof a.play === 'function') {
      try { a.play(name, opts); } catch { /* sin sonido */ }
    }
  }

  _shakeOffsets(dt) {
    if (this._shakeTime <= 0) return null;
    this._shakeTime = Math.max(0, this._shakeTime - dt);
    const f = this._shakeDur > 0 ? this._shakeTime / this._shakeDur : 0;
    const k = this._shakeAmp * f * f;
    if (k <= 0.0001) return null;
    const t = this._t, s = this._shakeSeed;
    return {
      p: k * 0.035 * (Math.sin(t * 37 + s) * 0.6 + Math.sin(t * 61 + s * 2) * 0.4),
      y: k * 0.03 * (Math.sin(t * 29 + s * 3) * 0.6 + Math.sin(t * 53 + s) * 0.4),
      r: k * 0.02 * Math.sin(t * 43 + s * 5),
      x: k * 0.02 * Math.sin(t * 47 + s * 7),
      yy: k * 0.02 * Math.sin(t * 41 + s * 11),
    };
  }

  _updateCamera(dt, state) {
    const cam = this.ctx.camera;
    const p = this.position;
    const bobY = Math.sin(this._bobPhase * 2) * 0.034 * this._bobAmp;
    const bobX = Math.sin(this._bobPhase) * 0.024 * this._bobAmp;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const rx = cy, rz = -sy;
    this.eye.set(p.x + rx * bobX, p.y + this._eyeH + bobY + this._landDip, p.z + rz * bobX);
    if (!cam) return;

    const sh = this._shakeOffsets(dt);
    cam.rotation.order = 'YXZ';
    cam.position.copy(this.eye);
    let rp = this.pitch, ry = this.yaw, rr = this._roll + Math.sin(this._bobPhase) * 0.004 * this._bobAmp;
    if (sh) {
      rp += sh.p; ry += sh.y; rr += sh.r;
      cam.position.x += rx * sh.x;
      cam.position.z += rz * sh.x;
      cam.position.y += sh.yy;
    }
    cam.rotation.set(rp, ry, rr);

    // FOV = fov / lerp(1, adsZoom, adsAmount), con un leve aumento al correr
    const zoom = Math.max(1, Number(this.adsZoom) || 1);
    const ads = clamp(Number(this.adsAmount) || 0, 0, 1);
    let fov = this._baseFov() / lerp(1, zoom, ads);
    if (state !== 'down') fov *= 1 + (0.05 * this._sprintT + 0.06 * this._slideFx) * (1 - ads);
    this._applyFov(fov);
  }

  _applyFov(fov) {
    const cam = this.ctx.camera;
    if (!cam) return;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------ espectador
  _spectateCandidates() {
    const gs = this.ctx.gs;
    if (!gs || !gs.players) return [];
    const me = this.ctx.selfId;
    const all = Object.values(gs.players).filter((pl) => pl && !sameId(pl.id, me));
    let list = all.filter((pl) => pl.state === 'alive');
    if (!list.length) list = all.filter((pl) => pl.state === 'down');
    return list.map((pl) => pl.id).sort((a, b) => Number(a) - Number(b));
  }

  _playerFeet(pid, out) {
    const ents = this.ctx.entities;
    if (ents && typeof ents.getPlayerVisual === 'function') {
      try {
        const v = ents.getPlayerVisual(Number(pid));
        if (v && v.position && isFinite(v.position.x)) return out.copy(v.position);
      } catch { /* usar la red */ }
    }
    const net = this.ctx.net;
    const snap = net && net.lastSnapshot;
    if (snap && snap.p) {
      const s = snap.p.get(Number(pid)) || snap.p.get(String(pid));
      if (s) return out.set(s.x, s.y || 0, s.z);
    }
    return null;
  }

  _updateSpectator(dt) {
    const ctx = this.ctx;
    const input = ctx.input;
    const cam = ctx.camera;
    const sp = this._spec;
    const cands = this._spectateCandidates();

    // Cambiar de compañero con clic (o la rueda)
    let idx = cands.findIndex((id) => sameId(id, this.spectating));
    if (idx < 0) idx = 0;
    if (input && cands.length > 1) {
      if (input.pressed('fire') || input.pressed('nextWeapon')) idx = (idx + 1) % cands.length;
      else if (input.pressed('ads') || input.pressed('prevWeapon')) idx = (idx - 1 + cands.length) % cands.length;
    }
    this.spectating = cands.length ? cands[idx] : null;
    if (!sameId(this.spectating, sp.lastPid)) { sp.init = false; sp.lastPid = this.spectating; }

    // Órbita: automática y con el ratón
    const m = input && typeof input.consumeMouse === 'function' ? input.consumeMouse() : { dx: 0, dy: 0 };
    const sens = clamp(Number((ctx.settings || {}).sensitivity) || 1, 0.05, 10) * LOOK_SCALE;
    if (m.dx || m.dy) {
      sp.angle -= m.dx * sens;
      sp.elev = clamp(sp.elev + m.dy * sens * 0.6, -0.1, 1.1);
      sp.idle = 0;
    } else {
      sp.idle += dt;
    }
    if (sp.idle > 1.5) sp.angle += dt * 0.22;

    const focus = this._tmp;
    let have = false;
    if (this.spectating != null) have = !!this._playerFeet(this.spectating, focus);
    if (!have) {
      // Sin compañeros: vista aérea lenta de la zona inicial
      const z0 = ZONES[0];
      if (z0) focus.set((z0.x0 + z0.x1 + 1) / 2, 0, (z0.z0 + z0.z1 + 1) / 2);
      else focus.copy(this.position);
    }
    focus.y += 1.35;

    const dist = have ? sp.dist : 6;
    const ce = Math.cos(sp.elev), se = Math.sin(sp.elev);
    let dx = Math.sin(sp.angle) * ce, dy = se, dz = Math.cos(sp.angle) * ce;
    let len = dist;
    // No atravesar paredes
    const hit = raycastMap(focus.x, focus.y, focus.z, dx, dy, dz, dist, (ctx.gs && ctx.gs.doors) || {});
    if (hit && hit.dist < dist) len = Math.max(0.35, hit.dist - 0.3);
    const tx = focus.x + dx * len, ty = Math.max(0.3, focus.y + dy * len), tz = focus.z + dz * len;

    if (!sp.init) {
      sp.cam.set(tx, ty, tz);
      sp.focus.copy(focus);
      sp.init = true;
    } else {
      const k = 1 - Math.exp(-10 * dt);
      sp.cam.x += (tx - sp.cam.x) * k; sp.cam.y += (ty - sp.cam.y) * k; sp.cam.z += (tz - sp.cam.z) * k;
      const kf = 1 - Math.exp(-14 * dt);
      sp.focus.x += (focus.x - sp.focus.x) * kf; sp.focus.y += (focus.y - sp.focus.y) * kf; sp.focus.z += (focus.z - sp.focus.z) * kf;
    }
    if (!cam) return;
    cam.position.copy(sp.cam);
    cam.rotation.order = 'YXZ';
    cam.lookAt(sp.focus);
    this.eye.copy(sp.cam);
    this._applyFov(this._baseFov());
  }
}

// Utilidad expuesta por si otro módulo la necesita
export function yawDelta(a, b) { return angleDiff(a, b); }

export default PlayerController;
