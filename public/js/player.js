// Controlador del jugador local: movimiento, colisión, cámara en primera persona y modo espectador.
// La posición local es autoritativa en el cliente (el servidor recibe 'st' a 20 Hz).

import * as THREE from 'three';
import { PLAYER, clamp, lerp, angleDiff } from '/shared/constants.js';
import { moveCircle, resolveCircle, solidForPlayer, raycastMap } from '/shared/collision.js';
import { PF } from '/shared/protocol.js';
import { PLAYER_SPAWNS, PLAYER_SPAWN_YAW, ZONES } from '/shared/map.js';

const LOOK_SCALE = 0.0022;        // rad por píxel con sensibilidad 1
const PITCH_LIMIT = 1.5;
const GROUND_ACCEL = 11;          // respuesta al acelerar (1/s)
const GROUND_DECEL = 9;           // respuesta al frenar
const AIR_ACCEL = 2.2;            // control en el aire
const STAMINUP_SPEED = 1.07;
const SPRINT_REGEN_DELAY = 0.45;  // s sin correr antes de recuperar estamina
const EXHAUST_RECOVER = 0.35;     // estamina necesaria para volver a correr tras agotarse
const ZOMBIE_SEP = 0.62;          // distancia mínima jugador-zombi (empuje suave)
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
    this._crouchWanted = false;
    this._crouchPressT = 0;
    this._crouchPressOn = false;
    this._exhausted = false;
    this._regenDelay = 0;
    this._sprintT = 0;
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
    this._solid = (cx, cz) => solidForPlayer(cx, cz, this._doors);
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
    }
  }

  // ------------------------------------------------------------------ API pública
  spawn(x, z, yaw) {
    const sp = PLAYER_SPAWNS[0] || { x: 0, z: 0 };
    x = Number(x); z = Number(z);
    if (!isFinite(x) || !isFinite(z)) { x = sp.x; z = sp.z; }
    this._doors = (this.ctx.gs && this.ctx.gs.doors) || {};
    [x, z] = resolveCircle(x, z, PLAYER.radius, this._solid);
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.yaw = isFinite(Number(yaw)) ? wrapAngle(Number(yaw)) : PLAYER_SPAWN_YAW;
    this.pitch = 0;
    this.onGround = true;
    this.isSprinting = false;
    this.isCrouching = false;
    this._crouchWanted = false;
    this.stamina01 = 1;
    this._exhausted = false;
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
      this._crouchWanted = false;
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

  _updateMove(dt, state) {
    const ctx = this.ctx;
    const input = ctx.input;
    const down = state === 'down';
    const perks = this._perks();
    const staminUp = perks.includes('staminup');
    const isDown = (a) => !!(input && input.isDown(a));
    const pressed = (a) => !!(input && input.pressed(a));
    const released = (a) => !!(input && input.released(a));

    let fwd = 0, str = 0;
    if (isDown('forward')) fwd += 1;
    if (isDown('back')) fwd -= 1;
    if (isDown('right')) str += 1;
    if (isDown('left')) str -= 1;
    const wantsMove = fwd !== 0 || str !== 0;

    // Agacharse: pulsación = alternar; mantener y soltar = agacharse solo mientras se mantiene
    if (!down) {
      if (pressed('crouch')) {
        this._crouchWanted = !this._crouchWanted;
        this._crouchPressT = 0;
        this._crouchPressOn = this._crouchWanted;
      }
      if (isDown('crouch')) this._crouchPressT += dt;
      if (released('crouch') && this._crouchPressOn && this._crouchPressT > 0.3) this._crouchWanted = false;
    } else {
      this._crouchWanted = false;
    }

    // Correr
    const w = ctx.weapons;
    const adsActive = isDown('ads') || (w && typeof w.adsAmount === 'number' ? w.adsAmount : this.adsAmount) > 0.5;
    const wantSprint = !down && isDown('sprint') && fwd > 0 && !adsActive;
    if (wantSprint && this._crouchWanted && pressed('sprint')) this._crouchWanted = false;
    let sprint = wantSprint && !this._crouchWanted && !this._exhausted && this.stamina01 > 0;
    const dur = PLAYER.sprintDuration * (staminUp ? 2 : 1);
    if (sprint) {
      this.stamina01 -= dt / dur;
      this._regenDelay = SPRINT_REGEN_DELAY;
      if (this.stamina01 <= 0) { this.stamina01 = 0; this._exhausted = true; sprint = false; }
    } else {
      if (this._regenDelay > 0) this._regenDelay -= dt;
      else this.stamina01 = Math.min(1, this.stamina01 + dt / PLAYER.sprintRecover);
      if (this._exhausted && this.stamina01 >= EXHAUST_RECOVER) this._exhausted = false;
    }
    this.isSprinting = sprint;
    this.isCrouching = this._crouchWanted && !down;
    this._sprintT += ((sprint ? 1 : 0) - this._sprintT) * (1 - Math.exp(-6 * dt));

    // Saltar (agachado: primero se levanta)
    if (!down && pressed('jump')) {
      if (this._crouchWanted) {
        this._crouchWanted = false;
        this.isCrouching = false;
      } else if (this.onGround) {
        this.velocity.y = PLAYER.jumpVelocity;
        this.onGround = false;
        this._sound('jump', { volume: 0.7 });
      }
    }

    // Velocidad objetivo
    let speed = down ? PLAYER.downSpeed
      : sprint ? PLAYER.sprintSpeed
      : this.isCrouching ? PLAYER.crouchSpeed
      : PLAYER.walkSpeed;
    if (staminUp && !down) speed *= STAMINUP_SPEED;
    const mm = Number(this.moveMult);
    speed *= isFinite(mm) ? clamp(mm, 0.1, 1.5) : 1;
    if (!sprint) {
      if (fwd < 0) speed *= 0.88;
      else if (fwd === 0 && str !== 0) speed *= 0.95;
    }

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const fx = -sy, fz = -cy;          // adelante
    const rx = cy, rz = -sy;           // derecha
    let wx = fx * fwd + rx * str, wz = fz * fwd + rz * str;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const tx = wx * speed, tz = wz * speed;

    const accel = this.onGround ? (wantsMove ? GROUND_ACCEL : GROUND_DECEL) : AIR_ACCEL;
    const k = 1 - Math.exp(-accel * dt);
    const v = this.velocity;
    v.x += (tx - v.x) * k;
    v.z += (tz - v.z) * k;

    // Vertical (solo visual: no hay plataformas)
    const p = this.position;
    if (down) {
      p.y = 0; v.y = 0;
      this.onGround = true;
    } else {
      if (!this.onGround) v.y -= PLAYER.gravity * dt;
      p.y += v.y * dt;
      if (p.y <= 0) {
        if (!this.onGround) {
          const impact = -v.y;
          if (impact > 2) {
            this._landDip = -Math.min(0.14, impact * 0.022);
            this._sound('land', { volume: clamp(impact / 7, 0.3, 1) });
          }
        }
        p.y = 0; v.y = 0;
        this.onGround = true;
      }
    }

    // Horizontal con colisión y deslizamiento
    const ox = p.x, oz = p.z;
    let res = moveCircle(ox, oz, v.x * dt, v.z * dt, PLAYER.radius, this._solid);
    let nx = res.x, nz = res.z;
    const sep = this._separateFromZombies(nx, nz, dt);
    if (sep) { nx = sep[0]; nz = sep[1]; }
    if (!isFinite(nx) || !isFinite(nz)) {
      const sp = PLAYER_SPAWNS[0] || { x: 0, z: 0 };
      nx = sp.x; nz = sp.z;
      v.set(0, 0, 0);
    }
    p.x = nx; p.z = nz;
    if (dt > 0) {
      const ax = (nx - ox) / dt, az = (nz - oz) / dt;
      if (Math.abs(ax) < Math.abs(v.x)) v.x = ax;
      if (Math.abs(az) < Math.abs(v.z)) v.z = az;
    }

    const hs = Math.hypot(v.x, v.z);
    this.isMoving = hs > 0.4;
    this.speed01 = clamp(hs / (PLAYER.sprintSpeed * (staminUp ? STAMINUP_SPEED : 1)), 0, 1);

    // Balanceo de cabeza y pasos
    if (this.onGround && hs > 0.4) {
      const stride = down ? 1.0 : sprint ? 2.7 : this.isCrouching ? 1.6 : 2.15;   // m por ciclo (2 pasos)
      const prev = this._bobPhase;
      let ph = prev + (hs / stride) * Math.PI * 2 * dt;
      if (Math.floor(prev / Math.PI) !== Math.floor(ph / Math.PI)) this._footstep(down, sprint);
      if (ph >= Math.PI * 2) ph -= Math.PI * 2;
      this._bobPhase = ph;
    }
    let ampTarget = 0;
    if (this.onGround && hs > 0.4) {
      ampTarget = (down ? 0.6 : sprint ? 1.35 : this.isCrouching ? 0.5 : 0.8) * Math.min(1, hs / PLAYER.walkSpeed);
    }
    const ads = clamp(Number(this.adsAmount) || 0, 0, 1);
    ampTarget *= 1 - 0.85 * ads;
    this._bobAmp += (ampTarget - this._bobAmp) * (1 - Math.exp(-10 * dt));

    // Inclinación lateral al desplazarse de costado
    const lateral = v.x * rx + v.z * rz;
    let rollTarget = -lateral * 0.0045;
    if (down) rollTarget += 0.11;
    this._roll += (rollTarget - this._roll) * (1 - Math.exp(-8 * dt));

    // Altura de los ojos (agacharse / caído suave)
    const eyeTarget = down ? PLAYER.downEyeHeight : this.isCrouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
    this._eyeH += (eyeTarget - this._eyeH) * (1 - Math.exp(-(down ? 4.5 : 12) * dt));
    this._landDip *= Math.exp(-9 * dt);
  }

  _separateFromZombies(x, z, dt) {
    const ents = this.ctx.entities;
    if (!ents || typeof ents.getZombieTargets !== 'function') return null;
    let list;
    try { list = ents.getZombieTargets(); } catch { return null; }
    if (!Array.isArray(list) || !list.length) return null;
    let moved = false;
    const kk = Math.min(1, dt * 12);
    for (let i = 0; i < list.length; i++) {
      const zb = list[i];
      if (!zb || !isFinite(zb.x) || !isFinite(zb.z)) continue;
      const dx = x - zb.x, dz = z - zb.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= ZOMBIE_SEP * ZOMBIE_SEP || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const push = (ZOMBIE_SEP - d) * kk;
      x += (dx / d) * push;
      z += (dz / d) * push;
      moved = true;
    }
    if (!moved) return null;
    return resolveCircle(x, z, PLAYER.radius, this._solid);
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
    if (state !== 'down') fov *= 1 + 0.05 * this._sprintT * (1 - ads);
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
