// Clase EntityManager (SPEC 6.9): dibuja zombis y jugadores remotos a partir de los snapshots interpolados
// (ctx.net.sample(serverNow − INTERP_DELAY_MS)). Crea, actualiza y elimina modelos; muertes según ev:zdie
// (cabeza que revienta, despedazado, calcinado, caídas; los cadáveres se hunden a los ~5 s); desvanecido corto de los
// zombis que desaparecen sin morir; sangre y reacción a los impactos de otros jugadores (ev:zhit); zarpazos (ev:zatk);
// gruñidos y pasos en 3D. El jugador local no se dibuja.
import * as THREE from 'three';
import { INTERP_DELAY_MS, angleDiff, ZOMBIE_TYPES, ZOMBIE_TYPE_BY_CODE } from '/shared/constants.js';
import { ZA, ZF, PF } from '/shared/protocol.js';
import { lineOfSight } from '/shared/collision.js';
import { ZombieModel, getZombieAssets, zombieMaterials } from './zombieModel.js';
import { PlayerModel, getPlayerAssets, playerMaterials } from './playerModel.js';

const MAX_CORPSES = 18;
const EMPTY = new Map();
const rnd = (a, b) => a + Math.random() * (b - a);

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();

function sameId(a, b) {
  return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
}

function plain(v) { return { x: v.x, y: v.y, z: v.z }; }

export class EntityManager {
  constructor(ctx) {
    this.ctx = ctx || {};
    this.group = new THREE.Group();
    this.group.name = 'entities';
    if (this.ctx.scene && typeof this.ctx.scene.add === 'function') this.ctx.scene.add(this.group);
    this.quality = this.ctx.settings && this.ctx.settings.quality === 'low' ? 'low' : 'high';

    this.zombies = new Map();     // id → registro de zombi vivo
    this.fading = new Map();      // id → registro desvaneciéndose (desapareció sin morir)
    this.corpses = [];            // registros muriendo / cadáveres
    this.players = new Map();     // pid (cadena) → registro de jugador remoto
    this.targets = [];            // caché de getZombieTargets()
    this.t = 0;
    this.frame = 0;
    this.env = { effects: this.ctx.effects || null };
    this.snd = { groan: -9, step: -9, hit: -9, die: [], atk: -9 };

    // Recursos compartidos y precompilación de sombreadores (evita tirones con el primer zombi)
    try {
      getZombieAssets(this.quality);
      getPlayerAssets(this.quality);
      this._warmup();
    } catch (err) {
      console.warn('[EntityManager] No se pudieron precargar los modelos:', err);
    }

    const ev = this.ctx.events;
    if (ev && typeof ev.on === 'function') {
      ev.on('ev:zdie', (e) => this._onZDie(e));
      ev.on('ev:zhit', (e) => this._onZHit(e));
      ev.on('ev:zatk', (e) => this._onZAtk(e));
      ev.on('ev:fuse', (e) => this._onFuse(e));
      ev.on('ev:tank', (e) => this._onTank(e));
      ev.on('ev:boss', (e) => this._onTank(e));
      ev.on('ev:bossAbility', (e) => this._onBossAbility(e));
      ev.on('ev:fire', (e) => this._onRemoteFire(e));
      ev.on('ev:proj', (e) => this._onRemoteFire(e));
    }
  }

  // ------------------------------------------------------------------ API pública (SPEC 6.9)
  update(dt) {
    dt = Math.min(Math.max(+dt || 0, 0), 0.1);
    this.t += dt;
    this.frame++;
    this.env.effects = this.ctx.effects || null;
    let sample = null;
    const net = this.ctx.net;
    if (net && typeof net.sample === 'function') {
      try {
        const now = typeof net.serverNow === 'function' ? net.serverNow() : Date.now();
        sample = net.sample(now - INTERP_DELAY_MS);
      } catch (err) {
        sample = null;
      }
    }
    const zs = sample && sample.zombies instanceof Map ? sample.zombies : EMPTY;
    const ps = sample && sample.players instanceof Map ? sample.players : EMPTY;
    this._updateZombies(dt, zs);
    this._updateCorpses(dt);
    this._updatePlayers(dt, ps);
  }

  // Posiciones RENDERIZADAS de los zombis vivos (las que se ven en pantalla), para disparar contra ellas
  getZombieTargets() { return this.targets; }

  getZombie(id) {
    const rec = this._zrec(id) || this._frec(id);
    if (!rec) return null;
    return { id: rec.id, x: rec.x, z: rec.z, group: rec.model.group };
  }

  getPlayerVisual(pid) {
    if (pid === null || pid === undefined) return null;
    const ctx = this.ctx;
    if (sameId(pid, ctx.selfId)) {
      const p = ctx.player;
      if (!p || !p.position) return null;
      const head = p.eye && p.eye.isVector3 ? p.eye.clone() : p.position.clone().setY((p.position.y || 0) + 1.62);
      return { position: p.position.clone(), head };
    }
    const rec = this.players.get(String(pid));
    if (!rec) return null;
    return { position: rec.model.group.position.clone(), head: rec.model.getHeadWorld(new THREE.Vector3()) };
  }

  // Reacción inmediata a un impacto propio (el servidor no nos envía zhit de nuestros disparos)
  hitReact(id, part = 'b', dir) {
    const rec = this._zrec(id);
    if (!rec) return;
    let dx = 0, dz = 0;
    if (dir && isFinite(dir.x) && isFinite(dir.z)) { dx = dir.x; dz = dir.z; }
    else if (Array.isArray(dir)) { dx = +dir[0] || 0; dz = +dir[2] || 0; }
    else {
      const cam = this.ctx.camera;
      if (cam) { dx = rec.x - cam.position.x; dz = rec.z - cam.position.z; }
    }
    try { rec.model.hitReact(part === 'h' || part === 'l' ? part : 'b', dx, dz, 1); } catch { /* nada */ }
  }

  reset() {
    for (const rec of this.zombies.values()) rec.model.dispose();
    for (const rec of this.fading.values()) rec.model.dispose();
    for (const rec of this.corpses) rec.model.dispose();
    for (const rec of this.players.values()) rec.model.dispose();
    this.zombies.clear();
    this.fading.clear();
    this.corpses.length = 0;
    this.players.clear();
    this.targets.length = 0;
  }

  // ------------------------------------------------------------------ Zombis
  _zrec(id) {
    if (id === null || id === undefined) return null;
    return this.zombies.get(id) || this.zombies.get(Number(id)) || null;
  }

  _frec(id) {
    if (id === null || id === undefined) return null;
    return this.fading.get(id) || this.fading.get(Number(id)) || null;
  }

  _spawnZombie(id, s) {
    // semilla según el id: todos los clientes ven el mismo aspecto para el mismo zombi
    const seed = (Math.imul(Number(id) || 1, 2654435761) ^ 0x5bd1e995) >>> 0;
    const type = ZOMBIE_TYPE_BY_CODE[s.type | 0] || 'normal';
    const scale = (ZOMBIE_TYPES[type] && ZOMBIE_TYPES[type].scale) || 1;
    const model = new ZombieModel({ quality: this.quality, seed, type });
    model.group.position.set(s.x, s.yOff || 0, s.z);
    model.group.rotation.y = s.rot || 0;
    this.group.add(model.group);
    const rec = {
      id, model, x: s.x, z: s.z, rot: s.rot || 0, anim: s.anim | 0, flags: s.flags | 0, yOff: s.yOff || 0,
      speed: 0, lastX: null, lastZ: null, groanAt: this.t + rnd(0.6, 5), burnAt: 0, seen: 0, crawler: false,
      type, fuseBeep: 0,
      target: { id, x: s.x, z: s.z, rot: s.rot || 0, yOff: s.yOff || 0, crawler: false, anim: s.anim | 0, scale, type },
    };
    this.zombies.set(id, rec);
    return rec;
  }

  _updateZombies(dt, zs) {
    const cam = this.ctx.camera;
    const camPos = cam ? cam.position : null;
    const fx = this.ctx.effects;
    const kRot = 1 - Math.exp(-18 * dt);
    const kSpd = 1 - Math.exp(-8 * dt);
    this.targets.length = 0;
    for (const [id, s] of zs) {
      let rec = this.zombies.get(id);
      if (!rec) {
        rec = this.fading.get(id);
        if (rec) {
          // reapareció antes de terminar de desvanecerse
          this.fading.delete(id);
          rec.model.cancelFade();
          rec.lastX = null;
          this.zombies.set(id, rec);
        } else {
          rec = this._spawnZombie(id, s);
        }
      }
      const model = rec.model;
      if (rec.lastX === null) { rec.lastX = s.x; rec.lastZ = s.z; rec.rot = s.rot; }
      const moved = Math.hypot(s.x - rec.lastX, s.z - rec.lastZ);
      const inst = dt > 0 ? moved / dt : 0;
      if (inst < 15) rec.speed += (inst - rec.speed) * kSpd;
      rec.lastX = s.x; rec.lastZ = s.z;
      rec.x = s.x; rec.z = s.z;
      rec.rot += angleDiff(rec.rot, s.rot) * kRot;
      rec.anim = s.anim; rec.flags = s.flags; rec.yOff = s.yOff || 0;
      const g = model.group;
      g.position.x = s.x;
      g.position.z = s.z;
      g.rotation.y = rec.rot;
      model.update(dt, { anim: s.anim, flags: s.flags, speed: rec.speed, yOff: rec.yOff });
      rec.crawler = !!model.crawler || !!(s.flags & ZF.CRAWLER) || s.anim === ZA.CRAWL;
      if (model.becameCrawler) { model.becameCrawler = false; this._crawlerFx(rec); }
      if ((s.flags & ZF.BURNING) && fx && typeof fx.fire === 'function' && this.t >= rec.burnAt) {
        rec.burnAt = this.t + 0.2;
        try { fx.fire(g, 0.45); } catch { /* nada */ }
      }
      if (camPos) this._zombieAudio(rec, camPos);
      if ((s.flags & ZF.FUSE) && this.t >= rec.fuseBeep) {
        rec.fuseBeep = this.t + 0.2;
        try { this.ctx.audio.play('round_tick', { pos: { x: rec.x, y: 1.2, z: rec.z }, volume: 0.9, rate: 1.6 }); } catch { /* sin sonido */ }
      }
      rec.seen = this.frame;
      const tg = rec.target;
      tg.x = rec.x; tg.z = rec.z; tg.rot = rec.rot; tg.yOff = rec.yOff; tg.crawler = rec.crawler; tg.anim = rec.anim;
      this.targets.push(tg);
    }
    // Zombis que desaparecieron sin morir (atascados que reaparecen, fin de partida...): desvanecido corto
    for (const [id, rec] of this.zombies) {
      if (rec.seen === this.frame) continue;
      this.zombies.delete(id);
      rec.model.startFade();
      this.fading.set(id, rec);
    }
    for (const [id, rec] of this.fading) {
      let alive = false;
      try { alive = rec.model.updateFade(dt); } catch { alive = false; }
      if (!alive) { rec.model.dispose(); this.fading.delete(id); }
    }
  }

  _updateCorpses(dt) {
    const list = this.corpses;
    // demasiados cadáveres: los más viejos se hunden ya
    for (let i = 0; i < list.length - MAX_CORPSES; i++) {
      const D = list[i].model.death;
      if (D && D.t < D.sinkAt) D.t = D.sinkAt;
    }
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      let alive = false;
      try { alive = rec.model.updateDeath(dt, this.env); } catch (err) { alive = false; }
      if (alive) list[w++] = rec;
      else rec.model.dispose();
    }
    list.length = w;
  }

  _zombieAudio(rec, camPos) {
    const audio = this.ctx.audio;
    if (!audio || typeof audio.play !== 'function') return;
    const dx = rec.x - camPos.x, dz = rec.z - camPos.z;
    const d2 = dx * dx + dz * dz;
    const S = this.snd;
    // Gruñidos aleatorios (los corredores chillan más a menudo)
    if (this.t >= rec.groanAt) {
      const fast = rec.anim === ZA.SPRINT || rec.anim === ZA.RUN;
      rec.groanAt = this.t + (fast ? rnd(1.6, 4) : rnd(3.5, 9));
      if (d2 < 35 * 35 && this.t - S.groan > 0.3) {
        S.groan = this.t;
        rec.model.groan();
        rec.model.getHeadWorld(_v);
        try {
          const tank = rec.type === 'tank', runner = rec.type === 'runner';
          audio.play('zombie_groan', { pos: plain(_v), volume: tank ? 1 : rnd(0.55, 0.9), rate: tank ? rnd(0.5, 0.6) : runner ? rnd(1.3, 1.5) : fast ? rnd(1.08, 1.3) : rnd(0.8, 1.02) });
        } catch { /* sin sonido */ }
      }
    }
    // Pasos cercanos
    if (rec.model.stepped) {
      rec.model.stepped = false;
      if (d2 < 11 * 11 && rec.speed > 0.3 && this.t - S.step > 0.09) {
        S.step = this.t;
        try {
          audio.play('zombie_step', { pos: { x: rec.x, y: 0.1, z: rec.z }, volume: rec.type === 'tank' ? 1 : Math.min(0.9, 0.3 + rec.speed * 0.12), rate: rec.type === 'tank' ? 0.55 : 1 });
        } catch { /* sin sonido */ }
      }
    }
  }

  // Explosivo: enciende la mecha (destello de aviso)
  _onFuse(e) {
    const rec = this._zrec(e.id);
    if (!rec) return;
    const fx = this.ctx.effects;
    try { if (fx) fx.flash(new THREE.Vector3(rec.x, 1.3, rec.z), 0xff7a20, 1.4); } catch { /* nada */ }
    try { this.ctx.audio.play('pin', { pos: { x: rec.x, y: 1.2, z: rec.z }, volume: 1 }); } catch { /* sin sonido */ }
  }

  // Tanque: rugido al aparecer (se oye en todo el mapa)
  _onTank() {
    try { this.ctx.audio.play('zombie_groan', { volume: 1, rate: 0.42 }); } catch { /* sin sonido */ }
    setTimeout(() => { try { this.ctx.audio.play('zombie_attack', { volume: 1, rate: 0.5 }); } catch { /* nada */ } }, 450);
  }

  // Efectos de las habilidades de los jefes
  _onBossAbility(e) {
    const fx = this.ctx.effects, audio = this.ctx.audio;
    const V = (x, y, z) => new THREE.Vector3(+x || 0, y, +z || 0);
    const play = (name, o) => { try { if (audio) audio.play(name, o); } catch { /* sin sonido */ } };
    const call = (fn) => { try { if (fx) fn(fx); } catch { /* nada */ } };
    const pos = { x: +e.x || 0, y: 1.5, z: +e.z || 0 };
    // animación propia del jefe (levantar el bastón, cargar el golpe al suelo...)
    const rec = this._zrec(e.id);
    if (rec && rec.model && typeof rec.model.onAbility === 'function') { try { rec.model.onAbility(e.a); } catch { /* nada */ } }
    switch (e.a) {
      case 'charge':
        play('zombie_attack', { pos, volume: 1, rate: 0.55 });
        play('zombie_groan', { pos, volume: 1, rate: 0.5 });
        break;
      case 'slamStart':
        play('zombie_groan', { pos, volume: 1, rate: 0.45 });
        break;
      case 'slam': {
        play('explosion', { pos, volume: 0.8, rate: 0.6 });
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2, r = (+e.r || 3) * 0.6;
          call((f) => f.dust(V(e.x + Math.cos(a) * r, 0.1, e.z + Math.sin(a) * r), V(0, 1, 0)));
        }
        const pl = this.ctx.player;
        if (pl && pl.position && typeof pl.shake === 'function') {
          const d = Math.hypot(pl.position.x - e.x, pl.position.z - e.z);
          if (d < 10) pl.shake(0.8 * (1 - d / 10), 0.5);
        }
        break;
      }
      case 'summon':
        play('power_on', { pos, volume: 0.6, rate: 0.7 });
        call((f) => f.flash(V(e.x, 2.2, e.z), 0xb050ff, 2.5));
        for (const s of (Array.isArray(e.spots) ? e.spots : [])) call((f) => f.flash(V(s[0], 0.4, s[1]), 0xb050ff, 1.6));
        break;
      case 'cloak':
      case 'uncloak':
        play('box_whoosh', { pos, volume: 0.6, rate: e.a === 'cloak' ? 1.3 : 0.9 });
        call((f) => f.flash(V(e.x, 1.5, e.z), 0x9ad8ff, 1.8));
        break;
      default: break;
    }
  }

  _crawlerFx(rec) {
    const fx = this.ctx.effects;
    const g = rec.model.group;
    _v.set(g.position.x, 0.4, g.position.z);
    if (fx) {
      try {
        if (typeof fx.gib === 'function') fx.gib(_v, 1.1);
        else if (typeof fx.blood === 'function') fx.blood(_v, null, 2);
      } catch { /* nada */ }
    }
    this._sound('hit_flesh', _v, 0.7);
  }

  // Posición (pies + altura del pecho) de un jugador, local o remoto
  _actorPos(pid, out) {
    if (pid === null || pid === undefined) return null;
    const ctx = this.ctx;
    if (sameId(pid, ctx.selfId)) {
      const p = ctx.player;
      if (p && p.position) return out.set(p.position.x, (p.position.y || 0) + 1.3, p.position.z);
      return null;
    }
    const rec = this.players.get(String(pid));
    if (rec) { const gp = rec.model.group.position; return out.set(gp.x, gp.y + 1.3, gp.z); }
    return null;
  }

  _partPos(rec, part, out) {
    const m = rec.model;
    try {
      if (part === 'h' && m.neck && m.neck.visible) return m.getHeadWorld(out);
      if (part === 'l') return out.set(rec.x, rec.crawler ? 0.2 : 0.45, rec.z);
      return m.getChestWorld(out);
    } catch {
      return out.set(rec.x, 1.1, rec.z);
    }
  }

  _sound(name, pos, volume = 1) {
    const audio = this.ctx.audio;
    if (!audio || typeof audio.play !== 'function') return;
    try { audio.play(name, { pos: plain(pos), volume }); } catch { /* sin sonido */ }
  }

  _onZDie(e) {
    if (!e) return;
    let rec = this._zrec(e.id);
    if (rec) this.zombies.delete(rec.id);
    else {
      rec = this._frec(e.id);
      if (rec) { this.fading.delete(rec.id); rec.model.cancelFade(); }
    }
    if (!rec) {
      // murió antes de llegar a dibujarse: se crea en su última posición conocida para verlo caer
      const net = this.ctx.net;
      const snap = net && net.lastSnapshot;
      const s = snap && snap.z && (snap.z.get(e.id) || snap.z.get(Number(e.id)));
      if (!s) return;
      rec = this._spawnZombie(e.id, s);
      this.zombies.delete(e.id);
      try { rec.model.update(0.016, { anim: s.anim, flags: s.flags, speed: 0, yOff: s.yOff || 0 }); } catch { /* nada */ }
    }
    const ti = this.targets.indexOf(rec.target);
    if (ti >= 0) this.targets.splice(ti, 1);

    const fxName = typeof e.fx === 'string' ? e.fx : 'normal';
    const from = this._actorPos(e.pid, _v2);
    let px = 0, pz = 0;
    if (from) { px = rec.x - from.x; pz = rec.z - from.z; }
    const m = rec.model;
    try { m.startDeath(fxName, px, pz, this.env); } catch (err) { console.warn('[EntityManager] startDeath:', err); }
    this.corpses.push(rec);

    // Efectos de la muerte
    const fx = this.ctx.effects;
    const len = Math.hypot(px, pz) || 1;
    _dir.set(px / len, 0.35, pz / len);
    const chest = this._partPos(rec, 'b', _v);
    try {
      if (fx) {
        if (fxName === 'head') {
          // la cabeza ya no está visible: el estallido va a la altura del cuello
          m.getNeckWorld(_v).y += 0.12;
          if (typeof fx.gib === 'function') fx.gib(_v, 0.8);
          if (typeof fx.blood === 'function') fx.blood(_v, _dir, 2.2);
        } else if (fxName === 'explode') {
          if (typeof fx.gib === 'function') fx.gib(chest, 2);
        } else if (fxName === 'fire') {
          if (typeof fx.fire === 'function') fx.fire(m.group, 1.6);
        } else if (fxName === 'nuke') {
          if (typeof fx.fire === 'function') fx.fire(m.group, 0.6);
        } else if (typeof fx.blood === 'function') {
          fx.blood(chest, _dir, fxName === 'melee' || fxName === 'shield' ? 1.6 : 1.1);
        }
      }
    } catch { /* un fallo de efectos no debe romper las muertes */ }

    // Sonidos: estertor (limitado para que una bomba nuclear no sature) e impacto en la cabeza de otros
    const now = this.t;
    const S = this.snd;
    S.die = S.die.filter((t) => now - t < 0.35);
    m.getNeckWorld(_v);
    if (S.die.length < 3) {
      S.die.push(now);
      this._sound('zombie_die', _v, fxName === 'nuke' ? 0.5 : 0.85);
    }
    if (fxName === 'head' && !sameId(e.pid, this.ctx.selfId)) this._sound('headshot', _v, 0.55);
  }

  _onZHit(e) {
    if (!e) return;
    const rec = this._zrec(e.id);
    if (!rec) return;
    const part = e.part === 'h' || e.part === 'l' ? e.part : 'b';
    const from = this._actorPos(e.pid, _v2);
    let dx = 0, dz = 0;
    if (from) { dx = rec.x - from.x; dz = rec.z - from.z; }
    try { rec.model.hitReact(part, dx, dz, 0.8); } catch { /* nada */ }
    const pos = this._partPos(rec, part, _v);
    const len = Math.hypot(dx, dz) || 1;
    _dir.set(dx / len, 0.25, dz / len);
    const fx = this.ctx.effects;
    if (fx && typeof fx.blood === 'function') {
      try { fx.blood(pos, _dir, part === 'h' ? 1.2 : 0.8); } catch { /* nada */ }
    }
    if (this.t - this.snd.hit > 0.06) {
      this.snd.hit = this.t;
      this._sound(part === 'h' ? 'headshot' : 'hit_flesh', pos, 0.5);
    }
  }

  _onZAtk(e) {
    if (!e) return;
    const rec = this._zrec(e.id);
    if (!rec) return;
    try { rec.model.onAttack(); } catch { /* nada */ }
    rec.model.getHeadWorld(_v);
    this._sound('zombie_attack', _v, 0.9);
  }

  _onRemoteFire(e) {
    if (!e || sameId(e.pid, this.ctx.selfId)) return;
    const rec = this.players.get(String(e.pid));
    if (rec) { try { rec.model.onFire(); } catch { /* nada */ } }
  }

  // ------------------------------------------------------------------ Jugadores remotos
  _updatePlayers(dt, ps) {
    const ctx = this.ctx;
    const gs = ctx.gs;
    const infoAll = gs && gs.players ? gs.players : null;
    const cam = ctx.camera;
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (const [pid, s] of ps) {
      if (sameId(pid, ctx.selfId)) continue;
      const key = String(pid);
      const info = infoAll ? infoAll[key] : null;
      if (info && info.state === 'dead') continue;
      let rec = this.players.get(key);
      if (!rec) {
        const model = new PlayerModel({ quality: this.quality, color: info && info.color, name: info && info.name, id: pid });
        this.group.add(model.group);
        rec = { pid: key, model, losAt: 0 };
        this.players.set(key, rec);
      }
      const model = rec.model;
      if (info) { model.setColor(info.color); model.setName(info.name); }
      let flags = s.flags | 0;
      if (info && info.state === 'down') flags |= PF.DOWN;
      model.update(dt, {
        x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, flags, w: s.w || '', up: !!s.up,
        hasShield: !!(info && info.shield),
      });
      // El nombre se atenúa si hay una pared de por medio
      if (cam && this.t >= rec.losAt) {
        rec.losAt = this.t + 0.2 + Math.random() * 0.05;
        let vis = true;
        try {
          vis = lineOfSight(cam.position.x, cam.position.y, cam.position.z, s.x, (s.y || 0) + 1.4, s.z, gs && gs.doors);
        } catch { vis = true; }
        model.setTagVisibility(vis ? 1 : 0.35);
      }
      seen.add(key);
    }
    for (const [key, rec] of this.players) {
      if (seen.has(key)) continue;
      rec.model.dispose();
      this.players.delete(key);
    }
  }

  // ------------------------------------------------------------------ Precompilación
  _warmup() {
    const r = this.ctx.renderer, scene = this.ctx.scene, cam = this.ctx.camera;
    if (!r || typeof r.compile !== 'function' || !scene || !cam) return;
    const tmp = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
    let zm = null, pm = null;
    try {
      const mats = [...zombieMaterials(this.quality), ...playerMaterials(this.quality)];
      for (const m of mats) {
        if (!m) continue;
        tmp.add(m.isPointsMaterial ? new THREE.Points(geo, m) : new THREE.Mesh(geo, m));
      }
      zm = new ZombieModel({ quality: this.quality, seed: 12345 });
      tmp.add(zm.group);
      pm = new PlayerModel({ quality: this.quality, color: '#ffffff', name: '' });
      tmp.add(pm.group);
      r.compile(tmp, cam, scene);
      const fxg = this.ctx.effects && this.ctx.effects.group;
      if (fxg && fxg.isObject3D) r.compile(fxg, cam, scene);
    } catch (err) {
      console.warn('[EntityManager] Precompilación omitida:', err);
    } finally {
      if (zm) zm.dispose();
      if (pm) pm.dispose();
      tmp.clear();
      geo.dispose();
    }
  }
}

export default EntityManager;
