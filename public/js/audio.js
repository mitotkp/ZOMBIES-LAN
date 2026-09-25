// Audio procedural de ZOMBIES LAN: todo se sintetiza con WebAudio (no hay archivos de sonido).
//  play(nombre, {pos, volume, rate, loop}) -> { stop() }   efectos (con pos: espacializados con HRTF)
//  weapon(arquetipo, {pos, upgraded, volume})             disparos por capas
//  music(nombre)                                          música original sintetizada
//  announce(texto)                                        locutor (speechSynthesis) + efecto
//  setVolumes(master, music)

const MAX_VOICES = 48;
const DUMMY = Object.freeze({ stop() {}, setPos() {} });

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fclamp = (f) => clamp(f, 20, 20000);

// Formantes aproximados (F1, F2, F3) de vocales de voz masculina
const VOWELS = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [300, 2200, 3000],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
  uh: [640, 1190, 2390],
  ae: [660, 1720, 2410],
};

// Notas: "C#4" -> número MIDI
const NOTE_IDX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midiOf(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return null;
  return 12 * (parseInt(m[3], 10) + 1) + NOTE_IDX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const hz = (name) => mtof(midiOf(name));

// Convierte pos (Vector3, {x,y,z}, [x,y,z]) a objeto plano
function toVec(p) {
  if (!p) return null;
  if (Array.isArray(p)) {
    if (p.length < 2) return null;
    return p.length >= 3 ? { x: +p[0], y: +p[1], z: +p[2] } : { x: +p[0], y: 1, z: +p[1] };
  }
  if (typeof p.x === 'number' && typeof p.z === 'number') return { x: p.x, y: typeof p.y === 'number' ? p.y : 1, z: p.z };
  return null;
}

function setPannerPos(p, v, t) {
  if (p.positionX) {
    p.positionX.setValueAtTime(v.x, t);
    p.positionY.setValueAtTime(v.y, t);
    p.positionZ.setValueAtTime(v.z, t);
  } else if (p.setPosition) {
    p.setPosition(v.x, v.y, v.z);
  }
}

// ---------------------------------------------------------------------------------------------
// Sintetizador por voz: crea osciladores/ruido con envolventes y filtros hacia la salida de la voz
// ---------------------------------------------------------------------------------------------
class Synth {
  constructor(audio, voice, t0, pitch = 1) {
    this.A = audio;
    this.ac = audio.ac;
    this.v = voice;
    this.t0 = t0;
    this.p = pitch;
    this.out = voice.out;
  }

  track(node, end) {
    this.v.nodes.push([node, end]);
    if (end > this.v.end) this.v.end = end;
  }

  gain(g = 1, dest = this.out) {
    const n = this.ac.createGain();
    n.gain.value = g;
    if (dest) n.connect(dest);
    return n;
  }

  // Envolvente ataque-sostén-caída exponencial; devuelve el instante final
  env(param, t, peak, a, h, d) {
    const pk = Math.max(0.0002, peak);
    a = Math.max(0.001, a);
    d = Math.max(0.004, d);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(pk, t + a);
    if (h > 0) param.setValueAtTime(pk, t + a + h);
    param.exponentialRampToValueAtTime(0.0001, t + a + h + d);
    return t + a + h + d;
  }

  // Envolvente dibujada con una curva (valores 0..1)
  curveEnv(param, t, curve, dur, peak) {
    const c = new Float32Array(curve.length);
    for (let i = 0; i < curve.length; i++) c[i] = Math.max(0, curve[i] * peak);
    param.setValueCurveAtTime(c, t, dur);
    return t + dur;
  }

  // Cadena de filtros; devuelve el nodo de entrada
  filters(specs, dest, t, len, pm = this.p) {
    if (!specs) return dest;
    const list = Array.isArray(specs) ? specs : [specs];
    let node = dest;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      const f = this.ac.createBiquadFilter();
      f.type = s.type || 'lowpass';
      const k = s.fixed ? 1 : pm;
      const ts = t + (s.at || 0);
      f.frequency.setValueAtTime(fclamp(s.f * k), ts);
      if (s.f1) {
        const t1 = ts + (s.sw != null ? s.sw : len);
        if (s.lin) f.frequency.linearRampToValueAtTime(fclamp(s.f1 * k), t1);
        else f.frequency.exponentialRampToValueAtTime(fclamp(s.f1 * k), t1);
      }
      f.Q.value = s.q != null ? s.q : 0.707;
      if (s.gain != null) f.gain.value = s.gain;
      f.connect(node);
      node = f;
    }
    return node;
  }

  shaper(kind, dest) {
    const ws = this.ac.createWaveShaper();
    ws.curve = this.A._curve(kind);
    ws.connect(dest);
    return ws;
  }

  lfo(param, rate, depth, t, end, type = 'sine') {
    const o = this.ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(rate, t);
    const g = this.ac.createGain();
    g.gain.value = depth;
    o.connect(g);
    g.connect(param);
    o.start(t);
    o.stop(end + 0.02);
    this.track(o, end + 0.03);
    return o;
  }

  // Nodo de modulación de amplitud (trémolo / fritura vocal): ganancia en [1-2·depth, 1]
  amNode(dest, t, end, rate, depth, type = 'sine') {
    const g = this.gain(1 - depth, dest);
    this.lfo(g.gain, rate, depth, t, end, type);
    return g;
  }

  // Banco de 3 formantes en paralelo con transición entre vocales
  formants(dest, vowels, t, dur, scale = 1, gains = [2.6, 1.7, 0.9], qs = [7, 9, 11]) {
    const ac = this.ac;
    const input = ac.createGain();
    const seq = vowels.map((v) => VOWELS[v] || VOWELS.a);
    for (let k = 0; k < 3; k++) {
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = qs[k];
      bp.frequency.setValueAtTime(fclamp(seq[0][k] * scale), t);
      for (let i = 1; i < seq.length; i++) {
        bp.frequency.linearRampToValueAtTime(fclamp(seq[i][k] * scale), t + (dur * i) / (seq.length - 1));
      }
      const g = ac.createGain();
      g.gain.value = gains[k];
      input.connect(bp);
      bp.connect(g);
      g.connect(dest);
    }
    return input;
  }

  // Oscilador con envolvente. Opciones: type, wave, f, f1, sw, lin, fc(curva de frecuencia), amp(curva de
  // amplitud), dur, at, a, hold, d, g, filt, dest, detune, vib{r,d}, fm{ratio,index,d}, shape, am{r,d}, fixed
  osc(o) {
    const ac = this.ac;
    const t = this.t0 + (o.at || 0);
    const pm = o.fixed ? 1 : this.p;
    const n = ac.createOscillator();
    if (o.wave) n.setPeriodicWave(o.wave);
    else n.type = o.type || 'sine';
    const f0 = Math.max(1, (o.f || 440) * pm);
    const eg = ac.createGain();
    let len, end;
    if (o.amp) {
      len = o.dur || 0.5;
      end = this.curveEnv(eg.gain, t, o.amp, len, o.g != null ? o.g : 0.3);
    } else {
      const a = o.a != null ? o.a : 0.003, h = o.hold || 0, d = o.d != null ? o.d : 0.2;
      len = a + h + d;
      end = this.env(eg.gain, t, o.g != null ? o.g : 0.3, a, h, d);
    }
    if (o.fc) {
      n.frequency.setValueCurveAtTime(Float32Array.from(o.fc, (x) => Math.max(1, x * pm)), t, o.dur || len);
    } else {
      n.frequency.setValueAtTime(f0, t);
      if (o.f1) {
        const t1 = t + (o.sw != null ? o.sw : len);
        const f1 = Math.max(1, o.f1 * pm);
        if (o.lin) n.frequency.linearRampToValueAtTime(f1, t1);
        else n.frequency.exponentialRampToValueAtTime(f1, t1);
      }
    }
    if (o.detune) n.detune.setValueAtTime(o.detune, t);
    n.connect(eg);
    let dest = this.filters(o.filt, o.dest || this.out, t, len, pm);
    if (o.shape) dest = this.shaper(o.shape, dest);
    if (o.am) dest = this.amNode(dest, t, end, o.am.r, o.am.d, o.am.type);
    eg.connect(dest);
    if (o.vib) this.lfo(n.frequency, o.vib.r, o.vib.d * pm, t, end, o.vib.type || 'sine');
    if (o.fm) {
      const m = ac.createOscillator();
      m.type = o.fm.type || 'sine';
      m.frequency.setValueAtTime(f0 * o.fm.ratio, t);
      if (o.f1 && !o.fc) m.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1 * pm * o.fm.ratio), t + (o.sw != null ? o.sw : len));
      const mg = ac.createGain();
      mg.gain.setValueAtTime(f0 * o.fm.index, t);
      mg.gain.exponentialRampToValueAtTime(Math.max(1, f0 * o.fm.index * 0.04), t + (o.fm.d || len));
      m.connect(mg);
      mg.connect(n.frequency);
      m.start(t);
      m.stop(end + 0.02);
      this.track(m, end + 0.03);
    }
    n.start(t);
    n.stop(end + 0.02);
    this.track(n, end + 0.03);
    return eg;
  }

  // Ruido con envolvente. Opciones: color('white'|'pink'|'brown'), rate, rate1, sw, amp, dur, at, a, hold, d, g,
  // filt, dest, shape, am{r,d}, fixed
  noise(o) {
    const ac = this.ac;
    const t = this.t0 + (o.at || 0);
    const pm = o.fixed ? 1 : this.p;
    const src = ac.createBufferSource();
    const buf = this.A.noiseBuf[o.color || 'white'] || this.A.noiseBuf.white;
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.setValueAtTime(o.rate || 1, t);
    const eg = ac.createGain();
    let len, end;
    if (o.amp) {
      len = o.dur || 0.5;
      end = this.curveEnv(eg.gain, t, o.amp, len, o.g != null ? o.g : 0.3);
    } else {
      const a = o.a != null ? o.a : 0.002, h = o.hold || 0, d = o.d != null ? o.d : 0.15;
      len = a + h + d;
      end = this.env(eg.gain, t, o.g != null ? o.g : 0.3, a, h, d);
    }
    if (o.rate1) src.playbackRate.exponentialRampToValueAtTime(o.rate1, t + (o.sw != null ? o.sw : len));
    src.connect(eg);
    let dest = this.filters(o.filt, o.dest || this.out, t, len, pm);
    if (o.shape) dest = this.shaper(o.shape, dest);
    if (o.am) dest = this.amNode(dest, t, end, o.am.r, o.am.d, o.am.type);
    eg.connect(dest);
    src.start(t, Math.random() * Math.max(0, buf.duration - 0.6));
    src.stop(end + 0.02);
    this.track(src, end + 0.03);
    return eg;
  }
}

// ---------------------------------------------------------------------------------------------
// Voz sintética con formantes (zombis, quejidos, osito, eructo, locutor de reserva)
// ---------------------------------------------------------------------------------------------
function voiceSyl(s, {
  at = 0, dur = 0.3, f0 = 110, f1 = null, vowels = ['a'], scale = 1, g = 0.5, noise = 0.15,
  grit = null, fry = 0, fryDepth = 0.35, jitter = 0.04, amp = null, dest = null, detune = 0,
}) {
  const t = s.t0 + at;
  const out = dest || s.out;
  const bank = s.formants(out, vowels, t, dur, scale);
  let src = bank;
  if (grit) src = s.shaper(grit, bank);
  if (fry > 0) src = s.amNode(src, t, t + dur, fry, fryDepth, 'square');
  const N = 16;
  const fc = new Array(N);
  let w = 1;
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    w = clamp(w + rnd(-jitter, jitter), 0.86, 1.14);
    fc[i] = (f1 != null ? f0 + (f1 - f0) * k : f0) * w;
  }
  const env = amp || [0, 0.75, 1, 0.9, 0.85, 0.7, 0.45, 0];
  s.osc({ at, type: 'sawtooth', fc, dur, amp: env, g, dest: src, detune });
  if (noise > 0) s.noise({ at, color: 'pink', amp: env, dur, g: g * noise, dest: bank });
}

// ---------------------------------------------------------------------------------------------
// Disparos por arquetipo (capas: transitorio, chasquido, cuerpo, golpe grave, cola, mecánica)
// ---------------------------------------------------------------------------------------------
const GUNS = {
  pistol:   { tr: 0.5, cr: 0.85, crF: 2600, crD: 0.06, bo: 0.75, boF: 1000, boD: 0.11, th: 0.8, thF: 160, thD: 0.08, ta: 0.3, taF: 1500, taD: 0.45, mech: 0.25, verb: 0.3 },
  revolver: { tr: 0.6, cr: 1.0, crF: 2100, crD: 0.08, bo: 0.95, boF: 760, boD: 0.17, th: 1.05, thF: 118, thD: 0.14, ta: 0.45, taF: 1100, taD: 0.95, mech: 0.1, verb: 0.38, echo: 0.32 },
  smg:      { tr: 0.45, cr: 0.72, crF: 3000, crD: 0.045, bo: 0.62, boF: 1300, boD: 0.08, th: 0.62, thF: 180, thD: 0.06, ta: 0.22, taF: 1800, taD: 0.32, mech: 0.12, verb: 0.22 },
  rifle:    { tr: 0.55, cr: 0.95, crF: 3300, crD: 0.055, bo: 0.82, boF: 1100, boD: 0.11, th: 0.88, thF: 135, thD: 0.1, ta: 0.4, taF: 1400, taD: 0.65, mech: 0.1, verb: 0.3 },
  burst:    { tr: 0.5, cr: 0.86, crF: 3150, crD: 0.05, bo: 0.72, boF: 1200, boD: 0.095, th: 0.76, thF: 150, thD: 0.08, ta: 0.3, taF: 1600, taD: 0.5, mech: 0.08, verb: 0.26 },
  lmg:      { tr: 0.55, cr: 0.9, crF: 2800, crD: 0.06, bo: 0.98, boF: 900, boD: 0.13, th: 1.02, thF: 108, thD: 0.11, ta: 0.42, taF: 1200, taD: 0.72, mech: 0.1, verb: 0.3 },
  shotgun:  { tr: 0.62, cr: 0.92, crF: 1900, crD: 0.1, bo: 1.18, boF: 650, boD: 0.26, th: 1.28, thF: 94, thD: 0.2, ta: 0.62, taF: 900, taD: 1.15, mech: 0, verb: 0.38, echo: 0.36 },
  sniper:   { tr: 0.72, cr: 1.2, crF: 2900, crD: 0.1, bo: 1.02, boF: 850, boD: 0.22, th: 1.32, thF: 80, thD: 0.22, ta: 0.78, taF: 800, taD: 1.9, mech: 0, verb: 0.5, echo: 0.45 },
};
// Alias por si el arquetipo llega con el nombre del modelo
const GUN_ALIAS = { doublebarrel: 'shotgun', knife: 'pistol' };

function gunshot(s, P) {
  const mix = s.shaper('soft', s.out);
  s.noise({ a: 0.0005, d: 0.012, g: P.tr, filt: { type: 'highpass', f: 3500 }, dest: mix });
  s.noise({ a: 0.001, d: P.crD, g: P.cr, filt: { type: 'bandpass', f: P.crF, q: 0.9 }, dest: mix });
  s.noise({ color: 'pink', a: 0.002, d: P.boD, g: P.bo, filt: { type: 'lowpass', f: P.boF * 2, f1: P.boF * 0.45, sw: P.boD }, dest: mix });
  s.osc({ f: P.thF, f1: P.thF * 0.35, sw: P.thD, a: 0.001, d: P.thD, g: P.th, dest: mix });
  s.noise({ color: 'brown', at: 0.01, a: 0.015, d: P.taD, g: P.ta, filt: { type: 'lowpass', f: P.taF, f1: P.taF * 0.4, sw: P.taD } });
  if (P.mech) {
    s.noise({ at: 0.04, d: 0.015, g: P.mech, filt: { type: 'bandpass', f: 4200, q: 4 } });
    s.noise({ at: 0.075, d: 0.02, g: P.mech * 0.8, filt: { type: 'bandpass', f: 3300, q: 4 } });
  }
  if (P.echo) {
    s.noise({ color: 'pink', at: P.echo, a: 0.01, d: 0.4, g: P.ta * 0.35, filt: { type: 'lowpass', f: 900 } });
    s.noise({ color: 'pink', at: P.echo * 2.2, a: 0.02, d: 0.5, g: P.ta * 0.15, filt: { type: 'lowpass', f: 600 } });
  }
}

// Capa brillante del Pack-a-Punch
function papLayer(s) {
  s.osc({ type: 'sine', f: 2400, f1: 900, d: 0.22, g: 0.13, vib: { r: 45, d: 120 } });
  s.osc({ type: 'triangle', f: 4800, f1: 2300, d: 0.12, g: 0.05 });
  s.noise({ at: 0.005, d: 0.25, g: 0.1, filt: { type: 'bandpass', f: 6000, f1: 2800, q: 3 } });
  s.osc({ f: 70, f1: 34, d: 0.18, g: 0.45 });
}

const SPECIAL_GUNS = {
  raygun(s, up) {
    const k = up ? 0.78 : 1;
    s.osc({ type: 'square', f: 1700 * k, f1: 190 * k, a: 0.002, d: 0.26, g: 0.15, filt: { type: 'lowpass', f: 4200 }, vib: { r: 38, d: 90 } });
    s.osc({ type: 'sine', f: 900 * k, f1: 80 * k, d: 0.34, g: 0.45 });
    s.osc({ type: 'sawtooth', f: 2600 * k, f1: 700 * k, d: 0.12, g: 0.06, filt: { type: 'bandpass', f: 2500, q: 2 } });
    s.noise({ d: 0.05, g: 0.35, filt: { type: 'highpass', f: 4000 } });
    s.noise({ at: 0.02, d: 0.3, g: 0.12, filt: { type: 'bandpass', f: 1800, f1: 400, q: 4 } });
    return 0.35;
  },
  raygun2(s, up) {
    const k = up ? 0.85 : 1;
    s.osc({ type: 'sine', f: 1250 * k, f1: 260 * k, a: 0.001, d: 0.16, g: 0.4, fm: { ratio: 3.5, index: 3.5, d: 0.12 } });
    s.osc({ type: 'square', f: 620 * k, f1: 140 * k, d: 0.14, g: 0.09, filt: { type: 'lowpass', f: 3000 } });
    s.noise({ d: 0.03, g: 0.4, filt: { type: 'highpass', f: 5000 } });
    s.noise({ at: 0.01, d: 0.18, g: 0.1, filt: { type: 'bandpass', f: 3200, f1: 900, q: 5 } });
    s.osc({ f: 120, f1: 50, d: 0.1, g: 0.35 });
    return 0.2;
  },
  launcher(s) {
    s.osc({ f: 95, f1: 38, d: 0.3, g: 1.0, shape: 'soft' });
    s.noise({ color: 'pink', d: 0.28, g: 0.7, filt: { type: 'lowpass', f: 900, f1: 250 } });
    s.noise({ d: 0.03, g: 0.5, filt: { type: 'bandpass', f: 1500, q: 1 } });
    s.noise({ at: 0.06, a: 0.05, d: 0.45, g: 0.25, filt: { type: 'bandpass', f: 700, f1: 2500, q: 1.5 } });
    return 0.55;
  },
};

// ---------------------------------------------------------------------------------------------
// Efectos (todos los nombres de SPEC 6.12)
// ---------------------------------------------------------------------------------------------
function metalPartials(s, at, base, ratios, d, g, type = 'triangle') {
  for (const r of ratios) s.osc({ at: at + Math.random() * 0.004, type, f: base * r, d: d * rnd(0.7, 1.1), g: g * rnd(0.6, 1) });
}
function clicks(s, n, t0, t1, f0, f1, g) {
  for (let i = 0; i < n; i++) {
    s.noise({ at: rnd(t0, t1), d: rnd(0.008, 0.03), g: g * rnd(0.5, 1), filt: { type: 'bandpass', f: rnd(f0, f1), q: 3 } });
  }
}
function thud(s, at, f, g, d = 0.15) {
  s.osc({ at, f, f1: f * 0.45, d, g });
  s.noise({ color: 'pink', at, d: d * 0.8, g: g * 0.5, filt: { type: 'lowpass', f: 700 } });
}

const SFX = {
  footstep(s) {
    s.osc({ f: rnd(70, 95), f1: 45, d: 0.07, g: 0.5 });
    s.noise({ d: rnd(0.04, 0.07), g: 0.22, filt: { type: 'bandpass', f: rnd(900, 1600), q: 1.2 } });
    s.noise({ at: 0.012, d: 0.03, g: 0.07, filt: { type: 'highpass', f: 3500 } });
  },
  jump(s) {
    s.noise({ color: 'pink', a: 0.03, d: 0.18, g: 0.2, filt: { type: 'bandpass', f: 600, f1: 1800, q: 0.8 } });
    s.osc({ f: 90, f1: 55, d: 0.06, g: 0.25 });
  },
  land(s) {
    s.osc({ f: 110, f1: 40, d: 0.14, g: 0.8 });
    s.noise({ color: 'pink', d: 0.12, g: 0.35, filt: { type: 'lowpass', f: 1400 } });
    s.noise({ at: 0.01, d: 0.06, g: 0.12, filt: { type: 'bandpass', f: 2500, q: 1 } });
  },
  hurt(s) {
    s.osc({ f: 120, f1: 45, d: 0.18, g: 0.9 });
    s.noise({ color: 'pink', d: 0.15, g: 0.5, filt: { type: 'lowpass', f: 900 } });
    voiceSyl(s, { at: 0.02, dur: 0.24, f0: rnd(125, 150), f1: rnd(85, 100), vowels: ['uh', 'u'], g: 0.5, noise: 0.25, fry: 24, amp: [0, 1, 0.8, 0.5, 0.2, 0] });
  },
  heartbeat(s) {
    s.osc({ f: 58, f1: 38, a: 0.01, d: 0.16, g: 1.0, filt: { type: 'lowpass', f: 180 } });
    s.osc({ at: 0.24, f: 52, f1: 35, a: 0.01, d: 0.2, g: 0.75, filt: { type: 'lowpass', f: 160 } });
  },
  down(s) {
    s.osc({ f: 90, f1: 30, d: 1.2, g: 0.9 });
    s.noise({ color: 'brown', a: 0.01, d: 1.0, g: 0.6, filt: { type: 'lowpass', f: 700, f1: 120 } });
    s.osc({ type: 'sawtooth', f: 440, f1: 110, a: 0.02, d: 1.4, g: 0.1, filt: { type: 'lowpass', f: 1200, f1: 300 } });
    s.osc({ f: 3100, a: 0.05, hold: 0.6, d: 1.5, g: 0.03, fixed: true });
    voiceSyl(s, { at: 0.05, dur: 0.55, f0: 150, f1: 80, vowels: ['a', 'uh', 'u'], g: 0.45, noise: 0.3, fry: 18 });
  },
  revive(s) {
    [0, 4, 7, 12].forEach((st, i) => s.osc({ at: i * 0.07, type: 'triangle', f: 392 * Math.pow(2, st / 12), d: 0.9, g: 0.13 }));
    s.noise({ color: 'pink', a: 0.2, d: 0.6, g: 0.12, filt: { type: 'bandpass', f: 1200, f1: 4000, q: 1.2 } });
    s.osc({ f: 196, a: 0.05, d: 1.0, g: 0.2 });
    s.noise({ at: 0.05, a: 0.1, d: 0.3, g: 0.2, filt: { type: 'bandpass', f: 500, q: 1 } });
  },
  deny(s) {
    for (let i = 0; i < 2; i++) {
      s.osc({ at: i * 0.14, type: 'square', f: 98, a: 0.004, hold: 0.08, d: 0.04, g: 0.18, filt: { type: 'lowpass', f: 900 } });
      s.osc({ at: i * 0.14, type: 'square', f: 104, a: 0.004, hold: 0.08, d: 0.04, g: 0.09, filt: { type: 'lowpass', f: 700 } });
    }
  },
  buy(s) {
    s.noise({ d: 0.04, g: 0.3, filt: { type: 'bandpass', f: 3000, q: 2 } });
    s.osc({ f: 2093, d: 0.9, g: 0.15, fixed: true });
    s.osc({ f: 2093 * 2.76, d: 0.35, g: 0.05, fixed: true });
    s.osc({ at: 0.09, f: 2637, d: 1.0, g: 0.14, fixed: true });
    s.osc({ at: 0.09, f: 2637 * 2.4, d: 0.3, g: 0.04, fixed: true });
    s.noise({ at: 0.12, a: 0.02, d: 0.25, g: 0.18, filt: { type: 'bandpass', f: 900, q: 1.5 } });
    s.osc({ at: 0.3, f: 140, f1: 70, d: 0.12, g: 0.35 });
    clicks(s, 4, 0.14, 0.3, 2500, 5000, 0.12);
  },
  reload_out(s) {
    s.noise({ d: 0.02, g: 0.5, filt: { type: 'bandpass', f: 3200, q: 3 } });
    s.osc({ type: 'square', f: 1850, d: 0.02, g: 0.05, filt: { type: 'bandpass', f: 1850, q: 8 } });
    s.noise({ at: 0.03, a: 0.02, d: 0.12, g: 0.18, filt: { type: 'bandpass', f: 2200, f1: 900, q: 2 } });
  },
  reload_in(s) {
    s.noise({ a: 0.03, d: 0.08, g: 0.14, filt: { type: 'bandpass', f: 900, f1: 2200, q: 2 } });
    s.noise({ at: 0.11, d: 0.03, g: 0.7, filt: { type: 'bandpass', f: 2600, q: 2.5 } });
    s.osc({ at: 0.11, f: 180, f1: 90, d: 0.05, g: 0.35 });
    s.osc({ at: 0.11, f: 3400, d: 0.08, g: 0.04 });
  },
  reload_bolt(s) {
    s.noise({ d: 0.03, g: 0.6, filt: { type: 'bandpass', f: 2400, q: 3 } });
    s.noise({ at: 0.03, a: 0.02, d: 0.1, g: 0.15, filt: { type: 'bandpass', f: 1600, f1: 3000, q: 2 } });
    s.noise({ at: 0.17, d: 0.03, g: 0.7, filt: { type: 'bandpass', f: 2000, q: 3 } });
    s.osc({ at: 0.17, f: 200, f1: 90, d: 0.05, g: 0.3 });
    s.noise({ at: 0.22, a: 0.02, d: 0.09, g: 0.14, filt: { type: 'bandpass', f: 3000, f1: 1500, q: 2 } });
    s.noise({ at: 0.33, d: 0.03, g: 0.75, filt: { type: 'bandpass', f: 2800, q: 3 } });
    s.osc({ at: 0.33, f: 3600, d: 0.06, g: 0.04 });
  },
  pump(s) {
    for (const at of [0, 0.17]) {
      s.noise({ at, d: 0.05, g: 0.7, filt: { type: 'bandpass', f: 1800, q: 2 } });
      s.osc({ at, f: 160, f1: 80, d: 0.06, g: 0.4 });
      s.osc({ at, type: 'square', f: 720, d: 0.03, g: 0.04, filt: { type: 'bandpass', f: 1400, q: 6 } });
    }
    s.noise({ at: 0.04, a: 0.03, d: 0.08, g: 0.12, filt: { type: 'bandpass', f: 1200, f1: 2600, q: 2 } });
  },
  empty(s) {
    s.noise({ d: 0.015, g: 0.5, filt: { type: 'bandpass', f: 4200, q: 4 } });
    s.osc({ f: 2400, d: 0.02, g: 0.07 });
  },
  switch(s) {
    s.noise({ color: 'pink', a: 0.03, d: 0.12, g: 0.15, filt: { type: 'bandpass', f: 700, f1: 1400, q: 1 } });
    clicks(s, 3, 0.06, 0.22, 3000, 4500, 0.25);
    s.osc({ at: 0.2, f: 2900, d: 0.06, g: 0.03 });
  },
  knife(s) {
    s.noise({ color: 'pink', a: 0.04, d: 0.16, g: 0.55, filt: { type: 'bandpass', f: 700, f1: 3500, q: 2.2, sw: 0.12 } });
    s.noise({ at: 0.03, a: 0.03, d: 0.08, g: 0.1, filt: { type: 'highpass', f: 5000 } });
  },
  knife_hit(s) {
    s.osc({ f: 150, f1: 60, d: 0.1, g: 0.7 });
    s.noise({ color: 'pink', d: 0.12, g: 0.5, filt: { type: 'lowpass', f: 1200 } });
    s.noise({ at: 0.02, d: 0.15, g: 0.3, filt: { type: 'bandpass', f: 500, q: 4 } });
  },
  bash(s) {
    s.osc({ f: 90, f1: 45, d: 0.25, g: 1.0 });
    s.noise({ color: 'pink', d: 0.2, g: 0.6, filt: { type: 'lowpass', f: 1500 } });
    metalPartials(s, 0, 310, [1, 1.7, 2.61, 4.01], 0.5, 0.06);
    s.noise({ color: 'pink', a: 0.02, d: 0.15, g: 0.25, filt: { type: 'bandpass', f: 600, f1: 2200, q: 1.5 } });
  },
  hit_flesh(s) {
    s.noise({ color: 'pink', d: 0.07, g: 0.55, filt: { type: 'lowpass', f: 1800 } });
    s.osc({ f: 180, f1: 70, d: 0.06, g: 0.45 });
    s.noise({ at: 0.01, d: 0.08, g: 0.2, filt: { type: 'bandpass', f: 900, q: 3 } });
  },
  headshot(s) {
    s.noise({ d: 0.04, g: 0.5, filt: { type: 'bandpass', f: 2500, q: 1 } });
    s.osc({ f: 400, f1: 120, d: 0.05, g: 0.3 });
    s.noise({ color: 'pink', d: 0.08, g: 0.5, filt: { type: 'lowpass', f: 1600 } });
    s.noise({ color: 'pink', at: 0.03, d: 0.2, g: 0.35, filt: { type: 'bandpass', f: 700, q: 2 } });
    clicks(s, 4, 0.04, 0.2, 800, 2000, 0.1);
  },
  hitmarker(s) {
    s.osc({ type: 'triangle', f: 2600, d: 0.035, g: 0.22, fixed: true });
    s.noise({ d: 0.012, g: 0.2, filt: { type: 'highpass', f: 5000, fixed: true } });
  },
  kill(s) {
    s.osc({ type: 'triangle', f: 1900, d: 0.05, g: 0.22, fixed: true });
    s.osc({ at: 0.035, type: 'triangle', f: 1400, d: 0.07, g: 0.18, fixed: true });
  },
  door_open(s) {
    s.noise({ d: 0.04, g: 0.6, filt: { type: 'bandpass', f: 1500, q: 2 } });
    s.osc({ f: 140, f1: 70, d: 0.12, g: 0.5 });
    s.noise({ color: 'brown', at: 0.1, a: 0.2, hold: 0.8, d: 0.4, g: 0.7, filt: { type: 'lowpass', f: 600 } });
    s.noise({ at: 0.1, a: 0.2, hold: 0.8, d: 0.3, g: 0.12, filt: { type: 'bandpass', f: 1800, q: 3 }, am: { r: 14, d: 0.45 } });
    s.osc({ at: 0.1, type: 'sawtooth', f: 70, f1: 58, a: 0.2, hold: 0.7, d: 0.3, g: 0.05, filt: { type: 'bandpass', f: 800, q: 5 } });
    thud(s, 1.35, 80, 0.8, 0.3);
    metalPartials(s, 1.35, 220, [1, 1.58, 2.37, 3.1], 0.8, 0.05);
  },
  debris(s) {
    thud(s, 0, 70, 0.9, 0.4);
    s.noise({ color: 'brown', a: 0.05, hold: 0.6, d: 0.6, g: 0.8, filt: { type: 'lowpass', f: 500 } });
    s.noise({ color: 'pink', a: 0.05, hold: 0.4, d: 0.6, g: 0.2, filt: { type: 'bandpass', f: 1500, q: 0.8 } });
    for (let i = 0; i < 16; i++) {
      s.noise({ at: rnd(0.05, 1.3), d: rnd(0.03, 0.07), g: rnd(0.1, 0.35), filt: { type: 'bandpass', f: rnd(1200, 4000), q: 3 } });
    }
  },
  board_tear(s) {
    s.noise({ d: 0.05, g: 0.9, filt: { type: 'bandpass', f: 1200, q: 1.5 } });
    s.osc({ type: 'triangle', f: rnd(180, 260), d: 0.12, g: 0.3 });
    s.osc({ type: 'sawtooth', f: 90, f1: 140, lin: true, a: 0.02, hold: 0.15, d: 0.1, g: 0.2, filt: { type: 'bandpass', f: 700, q: 6 } });
    clicks(s, 5, 0.02, 0.2, 1500, 3500, 0.3);
    thud(s, 0.35, 120, 0.45, 0.12);
  },
  board_repair(s) {
    s.noise({ d: 0.06, g: 0.3, filt: { type: 'bandpass', f: 900, q: 2 } });
    for (const at of [0.12, 0.26, 0.4]) {
      s.osc({ at, f: 300, f1: 180, d: 0.06, g: 0.5 });
      s.noise({ at, d: 0.03, g: 0.5, filt: { type: 'bandpass', f: 1800, q: 3 } });
    }
  },
  box_open(s) {
    s.osc({ type: 'sawtooth', f: 60, f1: 95, lin: true, a: 0.05, hold: 0.35, d: 0.15, g: 0.25, filt: { type: 'bandpass', f: 850, q: 9 }, vib: { r: 11, d: 4 } });
    thud(s, 0.45, 110, 0.6, 0.2);
    const notes = [1046, 1175, 1397, 1568, 1760, 2093];
    notes.forEach((f, i) => s.osc({ at: 0.3 + i * 0.05, f, d: 0.6, g: 0.06, fixed: true }));
    s.noise({ at: 0.2, a: 0.4, d: 0.5, g: 0.08, filt: { type: 'bandpass', f: 3000, q: 2 } });
  },
  box_close(s) {
    s.osc({ type: 'sawtooth', f: 90, f1: 65, lin: true, a: 0.03, hold: 0.12, d: 0.08, g: 0.2, filt: { type: 'bandpass', f: 800, q: 9 } });
    thud(s, 0.22, 100, 0.9, 0.25);
    s.noise({ color: 'pink', at: 0.22, d: 0.15, g: 0.4, filt: { type: 'lowpass', f: 800 } });
  },
  teddy_laugh(s) {
    let t = 0;
    for (let i = 0; i < 6; i++) {
      const f0 = 300 - i * 18 + rnd(-8, 8);
      s.noise({ at: t, d: 0.04, g: 0.12, filt: { type: 'bandpass', f: 1800, q: 1 } });
      voiceSyl(s, { at: t + 0.03, dur: 0.13, f0, f1: f0 * 0.88, vowels: ['a', 'ae'], scale: 1.25, g: 0.45, noise: 0.2, amp: [0, 1, 0.9, 0.5, 0] });
      voiceSyl(s, { at: t + 0.03, dur: 0.13, f0: f0 / 2.02, f1: f0 * 0.44, vowels: ['a', 'uh'], scale: 0.8, g: 0.3, noise: 0.1, amp: [0, 1, 0.9, 0.5, 0] });
      t += 0.17 + rnd(0, 0.03);
    }
    voiceSyl(s, { at: t, dur: 0.7, f0: 250, f1: 140, vowels: ['a', 'uh', 'u'], scale: 1.2, g: 0.4, noise: 0.25, fry: 9, fryDepth: 0.25 });
    voiceSyl(s, { at: t, dur: 0.7, f0: 124, f1: 70, vowels: ['a', 'o'], scale: 0.8, g: 0.3, noise: 0.1 });
  },
  box_whoosh(s) {
    s.noise({ color: 'pink', a: 0.5, hold: 0.3, d: 0.7, g: 0.7, filt: { type: 'bandpass', f: 300, f1: 2400, q: 1.2, sw: 1.2 } });
    s.osc({ type: 'sawtooth', f: 60, f1: 240, a: 0.4, d: 1.0, g: 0.08, filt: { type: 'lowpass', f: 800 } });
    for (let i = 0; i < 8; i++) s.osc({ at: 0.3 + i * 0.09, f: 1568 * Math.pow(2, (i * 2) / 12), d: 0.4, g: 0.04, fixed: true });
  },
  perk_drink(s) {
    s.noise({ d: 0.03, g: 0.4, filt: { type: 'bandpass', f: 2500, q: 5 } });
    s.osc({ f: 900, f1: 500, d: 0.04, g: 0.12 });
    s.noise({ at: 0.04, a: 0.05, d: 0.5, g: 0.06, filt: { type: 'highpass', f: 4000 } });
    for (const at of [0.35, 0.65, 0.95]) {
      s.osc({ at, f: 90, f1: 170, lin: true, a: 0.01, d: 0.12, g: 0.5, filt: { type: 'lowpass', f: 600 } });
      s.noise({ color: 'pink', at: at + 0.02, d: 0.08, g: 0.25, filt: { type: 'lowpass', f: 600 } });
    }
  },
  perk_burp(s) {
    voiceSyl(s, { dur: 0.65, f0: 78, f1: 60, vowels: ['o', 'uh', 'u'], scale: 0.9, g: 0.7, noise: 0.2, fry: 11, fryDepth: 0.45, grit: 'growl', amp: [0, 0.9, 1, 0.9, 0.8, 0.6, 0.3, 0] });
  },
  pap_work(s) {
    s.osc({ type: 'sawtooth', f: 110, f1: 220, sw: 1.2, a: 0.3, hold: 3.2, d: 0.6, g: 0.07, filt: { type: 'lowpass', f: 900 } });
    s.noise({ a: 0.2, hold: 3.4, d: 0.4, g: 0.12, filt: { type: 'bandpass', f: 1200, q: 1 }, am: { r: 9, d: 0.4 } });
    for (let i = 0; i < 12; i++) {
      const at = 0.3 + i * 0.3;
      metalPartials(s, at, rnd(280, 340), [1, 1.47, 2.09, 2.76], 0.2, 0.03, 'square');
      thud(s, at, 110, 0.35, 0.08);
    }
    s.noise({ at: 3.8, a: 0.05, d: 0.6, g: 0.25, filt: { type: 'highpass', f: 3000 } });
  },
  pap_ready(s) {
    s.osc({ f: 1568, d: 1.2, g: 0.15, fixed: true });
    s.osc({ f: 2349, d: 1.0, g: 0.1, fixed: true });
    s.osc({ f: 1568 * 2.76, d: 0.4, g: 0.04, fixed: true });
    s.noise({ at: 0.05, a: 0.02, d: 0.8, g: 0.2, filt: { type: 'highpass', f: 3000 } });
    thud(s, 0, 120, 0.5, 0.2);
  },
  power_on(s) {
    thud(s, 0, 90, 0.9, 0.3);
    s.noise({ d: 0.05, g: 0.5, filt: { type: 'bandpass', f: 2000, q: 2 } });
    s.osc({ at: 0.3, type: 'sawtooth', f: 30, f1: 60, sw: 1.2, a: 0.3, hold: 1.2, d: 0.8, g: 0.18, filt: { type: 'lowpass', f: 400 } });
    s.osc({ at: 0.3, type: 'sawtooth', f: 60, f1: 120, sw: 1.2, a: 0.3, hold: 1.2, d: 0.8, g: 0.1, filt: { type: 'lowpass', f: 900 } });
    thud(s, 0.6, 70, 1.0, 0.4);
    clicks(s, 14, 0.6, 2.2, 3000, 8000, 0.2);
  },
  powerup_spawn(s) {
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    scale.forEach((st, i) => s.osc({ at: i * 0.045, f: 1046 * Math.pow(2, st / 12), d: 0.4, g: 0.07, fixed: true }));
    s.noise({ a: 0.1, d: 0.4, g: 0.06, filt: { type: 'bandpass', f: 2000, f1: 6000, q: 2 } });
  },
  powerup_grab(s) {
    [523, 659, 784, 1046, 1318].forEach((f, i) => s.osc({ at: i * 0.04, type: 'triangle', f, d: 0.7, g: 0.12, fixed: true }));
    s.osc({ f: 262, d: 0.6, g: 0.15, fixed: true });
    s.noise({ a: 0.05, d: 0.4, g: 0.08, filt: { type: 'highpass', f: 5000 } });
  },
  powerup_loop(s) {
    s.osc({ f: 880, a: 0.3, hold: 0.5, d: 0.45, g: 0.03, vib: { r: 6, d: 8 } });
    s.osc({ f: 1320, a: 0.3, hold: 0.5, d: 0.45, g: 0.02, vib: { r: 7, d: 12 } });
    s.osc({ f: 110, a: 0.3, hold: 0.5, d: 0.45, g: 0.05 });
  },
  nuke(s) {
    s.noise({ color: 'pink', a: 0.5, d: 0.05, g: 0.5, filt: { type: 'lowpass', f: 800, f1: 5000, sw: 0.5 } });
    s.noise({ at: 0.5, d: 0.3, g: 1.0, filt: { type: 'highpass', f: 800 } });
    s.osc({ at: 0.5, f: 60, f1: 20, d: 3.5, g: 1.2, shape: 'soft' });
    s.noise({ color: 'brown', at: 0.5, a: 0.01, d: 3.5, g: 1.2, filt: { type: 'lowpass', f: 2000, f1: 150, sw: 3 }, shape: 'soft' });
    s.osc({ at: 0.6, f: 2900, a: 0.1, hold: 1, d: 2, g: 0.025, fixed: true });
  },
  zombie_groan(s) {
    const style = Math.random();
    if (style < 0.45) {
      // gemido largo y grave
      voiceSyl(s, {
        dur: rnd(0.9, 1.7), f0: rnd(58, 90), f1: rnd(48, 70), vowels: pick([['uh', 'a', 'o'], ['u', 'a', 'uh'], ['o', 'a', 'u']]),
        scale: rnd(0.78, 0.9), g: 0.75, noise: 0.25, grit: 'growl', fry: rnd(14, 26), fryDepth: 0.3, jitter: 0.05,
      });
    } else if (style < 0.8) {
      // gruñido áspero
      voiceSyl(s, {
        dur: rnd(0.5, 0.9), f0: rnd(85, 120), f1: rnd(65, 90), vowels: pick([['ae', 'a'], ['a', 'uh'], ['e', 'a', 'o']]),
        scale: rnd(0.85, 0.95), g: 0.7, noise: 0.45, grit: 'hard', fry: rnd(22, 38), fryDepth: 0.4, jitter: 0.07,
        amp: [0, 0.9, 1, 0.8, 0.95, 0.6, 0.3, 0],
      });
    } else {
      // gorgoteo entrecortado
      const dur = rnd(0.7, 1.2);
      voiceSyl(s, {
        dur, f0: rnd(60, 80), vowels: ['o', 'u', 'o'], scale: 0.85, g: 0.65, noise: 0.35, grit: 'growl', fry: rnd(9, 14), fryDepth: 0.48,
      });
      s.noise({ color: 'pink', amp: [0, 0.6, 1, 0.7, 0.9, 0.4, 0], dur, g: 0.12, filt: { type: 'bandpass', f: 380, q: 6 }, am: { r: rnd(12, 18), d: 0.45, type: 'square' } });
    }
  },
  zombie_attack(s) {
    const f0 = rnd(170, 230);
    voiceSyl(s, {
      dur: rnd(0.4, 0.55), f0, f1: f0 * 0.65, vowels: ['ae', 'a'], scale: 0.95, g: 0.8, noise: 0.5, grit: 'hard', fry: 30, fryDepth: 0.3,
      amp: [0, 1, 0.95, 0.8, 0.5, 0.2, 0],
    });
    s.noise({ color: 'pink', at: 0.15, a: 0.03, d: 0.15, g: 0.35, filt: { type: 'bandpass', f: 800, f1: 2500, q: 1.5 } });
  },
  zombie_die(s) {
    voiceSyl(s, {
      dur: 0.9, f0: rnd(110, 130), f1: 45, vowels: ['a', 'o', 'u'], scale: 0.85, g: 0.7, noise: 0.4, grit: 'growl', fry: 12, fryDepth: 0.4,
      amp: [0, 1, 0.9, 0.7, 0.5, 0.35, 0.15, 0],
    });
    s.noise({ color: 'pink', at: 0.3, d: 0.6, g: 0.15, filt: { type: 'bandpass', f: 400, q: 6 }, am: { r: 15, d: 0.45 } });
    thud(s, 0.7, 90, 0.6, 0.25);
  },
  zombie_step(s) {
    s.osc({ f: 75, f1: 45, d: 0.08, g: 0.35 });
    s.noise({ at: 0.03, a: 0.05, d: 0.15, g: 0.08, filt: { type: 'bandpass', f: 1400, q: 1 } });
  },
  explosion(s) {
    s.noise({ d: 0.05, g: 1.0, filt: { type: 'highpass', f: 900 } });
    s.osc({ f: 75, f1: 26, a: 0.004, d: 1.3, g: 1.3, shape: 'soft' });
    s.noise({ color: 'brown', a: 0.005, d: 1.8, g: 1.4, filt: { type: 'lowpass', f: 2400, f1: 160, sw: 1.2 }, shape: 'soft' });
    s.noise({ color: 'pink', a: 0.002, d: 0.5, g: 0.8, filt: { type: 'lowpass', f: 5000, f1: 700, sw: 0.4 } });
    for (let i = 0; i < 14; i++) {
      s.noise({ at: 0.08 + Math.random() * 1.1, d: rnd(0.01, 0.04), g: rnd(0.05, 0.2), filt: { type: 'bandpass', f: rnd(1500, 5000), q: 2 } });
    }
  },
  grenade_throw(s) {
    s.noise({ color: 'pink', a: 0.04, d: 0.15, g: 0.4, filt: { type: 'bandpass', f: 500, f1: 2000, q: 1.2 } });
    voiceSyl(s, { at: 0.01, dur: 0.14, f0: 140, f1: 110, vowels: ['uh', 'u'], g: 0.25, noise: 0.3, amp: [0, 1, 0.6, 0] });
  },
  grenade_bounce(s) {
    s.osc({ type: 'triangle', f: rnd(700, 900), d: 0.05, g: 0.15 });
    s.osc({ f: 1900, d: 0.03, g: 0.05 });
    s.noise({ d: 0.02, g: 0.3, filt: { type: 'bandpass', f: 2500, q: 3 } });
    s.osc({ f: 150, f1: 80, d: 0.04, g: 0.3 });
  },
  pin(s) {
    s.noise({ d: 0.01, g: 0.4, filt: { type: 'bandpass', f: 5000, q: 4 } });
    s.osc({ f: 3200, d: 0.25, g: 0.09 });
    s.osc({ f: 4700, d: 0.12, g: 0.05 });
    clicks(s, 3, 0.03, 0.12, 4000, 7000, 0.12);
  },
  shield_hit(s) {
    thud(s, 0, 100, 0.9, 0.2);
    metalPartials(s, 0, 420, [1, 1.66, 2.41, 3.64, 5.4], 0.55, 0.07);
    s.noise({ d: 0.08, g: 0.4, filt: { type: 'bandpass', f: 2000, q: 1 } });
  },
  shield_break(s) {
    s.noise({ a: 0.002, d: 0.6, g: 0.9, filt: { type: 'lowpass', f: 5000, f1: 800 } });
    metalPartials(s, 0, 380, [1, 1.51, 2.23, 3.07, 4.4], 0.7, 0.07);
    clicks(s, 6, 0.02, 0.25, 1200, 3000, 0.3);
    for (let i = 0; i < 8; i++) s.osc({ at: rnd(0.2, 1.0), type: 'triangle', f: rnd(900, 2600), d: rnd(0.05, 0.12), g: rnd(0.03, 0.08) });
    thud(s, 0, 80, 0.9, 0.3);
  },
  part_pickup(s) {
    clicks(s, 3, 0, 0.12, 1500, 4000, 0.3);
    metalPartials(s, 0.02, 520, [1, 1.9, 2.7], 0.25, 0.04);
    s.osc({ at: 0.15, f: 1318, d: 0.5, g: 0.1, fixed: true });
    s.osc({ at: 0.24, f: 1976, d: 0.6, g: 0.08, fixed: true });
  },
  build(s) {
    for (let i = 0; i < 10; i++) s.noise({ at: i * 0.05, d: 0.015, g: 0.35, filt: { type: 'bandpass', f: 3500, q: 5 } });
    for (const at of [0.6, 0.8]) { s.osc({ at, f: 300, f1: 170, d: 0.07, g: 0.5 }); s.noise({ at, d: 0.04, g: 0.4, filt: { type: 'bandpass', f: 1800, q: 3 } }); }
    metalPartials(s, 1.0, 330, [1, 1.58, 2.4, 3.3], 0.8, 0.06);
    s.osc({ at: 1.1, f: 1568, d: 0.8, g: 0.1, fixed: true });
    s.osc({ at: 1.18, f: 2093, d: 0.9, g: 0.08, fixed: true });
  },
  chat(s) {
    s.osc({ f: 1320, d: 0.06, g: 0.1, fixed: true });
    s.osc({ at: 0.06, f: 1760, d: 0.08, g: 0.08, fixed: true });
  },
  ui_click(s) {
    s.osc({ type: 'triangle', f: 1400, f1: 900, d: 0.04, g: 0.12 });
    s.noise({ d: 0.01, g: 0.1, filt: { type: 'highpass', f: 3000 } });
    s.osc({ f: 120, f1: 60, d: 0.05, g: 0.15 });
  },
  ui_hover(s) {
    s.osc({ f: 2200, d: 0.025, g: 0.04 });
  },
  round_tick(s) {
    s.noise({ d: 0.015, g: 0.4, filt: { type: 'bandpass', f: 3000, q: 6 } });
    s.osc({ f: 1600, d: 0.03, g: 0.06 });
  },
  // Internos (no forman parte del contrato)
  __announce(s) {
    s.osc({ f: 55, f1: 32, a: 0.01, d: 1.2, g: 0.55 });
    s.noise({ color: 'brown', a: 0.3, d: 0.8, g: 0.22, filt: { type: 'lowpass', f: 300, f1: 900 } });
  },
  __creak(s) {
    s.osc({ type: 'sawtooth', f: rnd(45, 70), f1: rnd(80, 120), lin: true, a: 0.2, hold: rnd(0.4, 0.9), d: 0.4, g: 0.12, filt: { type: 'bandpass', f: rnd(600, 1100), q: 10 }, vib: { r: 7, d: 3 } });
  },
};

// Ganancia, reverberación, distancia de referencia, variación de tono y periodo en bucle por sonido
const META = {
  footstep: { g: 0.35, verb: 0.05, jit: 0.08 }, jump: { g: 0.4, verb: 0.05 }, land: { g: 0.5, verb: 0.06 },
  hurt: { g: 0.8, verb: 0.08 }, heartbeat: { g: 0.9, verb: 0, period: 0.95 }, down: { g: 0.9, verb: 0.3 },
  revive: { g: 0.7, verb: 0.25 }, deny: { g: 0.7, verb: 0.05 }, buy: { g: 0.6, verb: 0.15 },
  reload_out: { g: 0.6, verb: 0.05, jit: 0.04 }, reload_in: { g: 0.6, verb: 0.05, jit: 0.04 },
  reload_bolt: { g: 0.6, verb: 0.05 }, pump: { g: 0.65, verb: 0.06 }, empty: { g: 0.6, verb: 0.02 },
  switch: { g: 0.5, verb: 0.04 }, knife: { g: 0.6, verb: 0.05, jit: 0.1 }, knife_hit: { g: 0.7, verb: 0.06, jit: 0.08 },
  bash: { g: 0.9, verb: 0.1 }, hit_flesh: { g: 0.55, verb: 0.03, jit: 0.1 }, headshot: { g: 0.7, verb: 0.05, jit: 0.08 },
  hitmarker: { g: 0.5, verb: 0 }, kill: { g: 0.5, verb: 0 },
  door_open: { g: 0.8, verb: 0.25, ref: 4 }, debris: { g: 0.9, verb: 0.25, ref: 4 },
  board_tear: { g: 0.7, verb: 0.15, ref: 3, jit: 0.08 }, board_repair: { g: 0.6, verb: 0.12, ref: 3, jit: 0.06 },
  box_open: { g: 0.7, verb: 0.2, ref: 3 }, box_close: { g: 0.7, verb: 0.2, ref: 3 },
  teddy_laugh: { g: 0.9, verb: 0.45, ref: 5 }, box_whoosh: { g: 0.8, verb: 0.35, ref: 6 },
  perk_drink: { g: 0.6, verb: 0.05 }, perk_burp: { g: 0.7, verb: 0.1 },
  pap_work: { g: 0.7, verb: 0.2, ref: 4, period: 4.4 }, pap_ready: { g: 0.7, verb: 0.25, ref: 4 },
  power_on: { g: 0.9, verb: 0.4, ref: 8 }, powerup_spawn: { g: 0.6, verb: 0.3, ref: 4 },
  powerup_grab: { g: 0.7, verb: 0.3 }, powerup_loop: { g: 0.5, verb: 0.2, ref: 2, period: 1.2 },
  nuke: { g: 1.0, verb: 0.5 },
  zombie_groan: { g: 0.75, verb: 0.18, ref: 2.2, period: 2.4 }, zombie_attack: { g: 0.85, verb: 0.15, ref: 2.2 },
  zombie_die: { g: 0.8, verb: 0.2, ref: 2.2 }, zombie_step: { g: 0.35, verb: 0.05, ref: 1.5, jit: 0.1 },
  explosion: { g: 1.0, verb: 0.45, ref: 6 }, grenade_throw: { g: 0.5, verb: 0.05 }, grenade_bounce: { g: 0.5, verb: 0.08, ref: 2, jit: 0.1 },
  pin: { g: 0.5, verb: 0.03 }, shield_hit: { g: 0.8, verb: 0.15, ref: 3 }, shield_break: { g: 0.9, verb: 0.25, ref: 3 },
  part_pickup: { g: 0.6, verb: 0.15 }, build: { g: 0.7, verb: 0.2, ref: 3 },
  chat: { g: 0.45, verb: 0 }, ui_click: { g: 0.5, verb: 0 }, ui_hover: { g: 0.35, verb: 0 }, round_tick: { g: 0.5, verb: 0.05 },
  __announce: { g: 0.9, verb: 0.6 }, __creak: { g: 0.5, verb: 0.5 },
};

// ---------------------------------------------------------------------------------------------
// Música original: instrumentos, secuenciador y piezas
// ---------------------------------------------------------------------------------------------
const INST = {
  bell(s, at, f, dur, v) {
    s.osc({ at, f, a: 0.002, d: 1.6 + dur, g: 0.2 * v, fixed: true });
    s.osc({ at, f: f * 1.003, d: 1.3 + dur, g: 0.09 * v, fixed: true });
    s.osc({ at, f: f * 2.76, d: 0.7, g: 0.07 * v, fixed: true });
    s.osc({ at, f: f * 5.4, d: 0.3, g: 0.035 * v, fixed: true });
  },
  tine(s, at, f, dur, v) {
    s.osc({ at, f, a: 0.001, d: 1.2, g: 0.18 * v, fixed: true });
    s.osc({ at, f: f * 4.02, a: 0.001, d: 0.18, g: 0.045 * v, fixed: true });
    s.osc({ at, f: f * 2, d: 0.5, g: 0.035 * v, fixed: true });
  },
  pad(s, at, f, dur, v) {
    for (const dt of [-9, 0, 8]) {
      s.osc({ at, type: 'sawtooth', f, detune: dt, a: Math.min(1.2, dur * 0.4), hold: dur * 0.5, d: Math.max(0.6, dur * 0.5), g: 0.04 * v, filt: { type: 'lowpass', f: 900, q: 0.6, fixed: true }, fixed: true });
    }
  },
  brass(s, at, f, dur, v) {
    for (const dt of [-6, 6]) {
      s.osc({ at, type: 'sawtooth', f, detune: dt, a: 0.05, hold: dur * 0.75, d: 0.25, g: 0.085 * v, filt: { type: 'lowpass', f: 500, f1: 2300, sw: 0.1, q: 1, fixed: true }, fixed: true });
    }
  },
  bass(s, at, f, dur, v) {
    s.osc({ at, type: 'triangle', f, a: 0.005, hold: dur * 0.7, d: 0.15, g: 0.28 * v, fixed: true });
    s.osc({ at, type: 'sine', f, a: 0.005, hold: dur * 0.7, d: 0.15, g: 0.16 * v, fixed: true });
  },
  lead(s, at, f, dur, v) {
    s.osc({ at, type: 'square', f, a: 0.005, hold: dur * 0.6, d: 0.12, g: 0.065 * v, filt: { type: 'lowpass', f: 3200, fixed: true }, vib: { r: 5.5, d: f * 0.006 }, fixed: true });
  },
  pluck(s, at, f, dur, v) {
    s.osc({ at, type: 'sawtooth', f, a: 0.002, d: 0.4, g: 0.11 * v, filt: { type: 'lowpass', f: f * 8, f1: f * 1.5, sw: 0.25, fixed: true }, fixed: true });
    s.osc({ at, type: 'triangle', f: f * 2, d: 0.2, g: 0.035 * v, fixed: true });
  },
  accordion(s, at, f, dur, v) {
    for (const dt of [-11, 11]) {
      s.osc({ at, type: 'square', f, detune: dt, a: 0.03, hold: dur * 0.8, d: 0.08, g: 0.045 * v, filt: { type: 'lowpass', f: 2500, fixed: true }, fixed: true });
    }
    s.osc({ at, type: 'sawtooth', f: f / 2, a: 0.03, hold: dur * 0.8, d: 0.08, g: 0.03 * v, filt: { type: 'lowpass', f: 1500, fixed: true }, fixed: true });
  },
  choir(s, at, f, dur, v) {
    const t = s.t0 + at;
    const bank = s.formants(s.out, ['a', 'o', 'a'], t, dur + 0.9, 1, [1.6, 1.0, 0.5], [6, 8, 10]);
    for (const dt of [-12, 0, 12]) {
      s.osc({ at, type: 'sawtooth', f, detune: dt, a: 0.5, hold: dur, d: 0.9, g: 0.06 * v, dest: bank, vib: { r: 4.5, d: f * 0.004 }, fixed: true });
    }
  },
  timp(s, at, f, dur, v) {
    s.osc({ at, f: f * 1.4, f1: f, sw: 0.08, a: 0.003, d: 1.4, g: 0.5 * v, fixed: true });
    s.noise({ at, color: 'brown', d: 0.25, g: 0.35 * v, filt: { type: 'lowpass', f: 500, fixed: true }, fixed: true });
  },
  kick(s, at, f, dur, v) { s.osc({ at, f: 150, f1: 45, sw: 0.1, d: 0.28, g: 0.55 * v, fixed: true }); },
  snare(s, at, f, dur, v) {
    s.noise({ at, d: 0.14, g: 0.2 * v, filt: { type: 'bandpass', f: 2200, q: 0.8, fixed: true }, fixed: true });
    s.osc({ at, type: 'triangle', f: 190, f1: 150, d: 0.07, g: 0.18 * v, fixed: true });
  },
  hat(s, at, f, dur, v) { s.noise({ at, d: 0.035, g: 0.09 * v, filt: { type: 'highpass', f: 7500, fixed: true }, fixed: true }); },
  clank(s, at, f, dur, v) {
    for (const r of [1, 1.47, 2.09, 2.76, 3.9]) {
      s.osc({ at, type: 'square', f: 330 * r, d: 0.15 + Math.random() * 0.1, g: 0.018 * v, filt: { type: 'bandpass', f: 330 * r, q: 6, fixed: true }, fixed: true });
    }
    s.noise({ at, d: 0.05, g: 0.28 * v, filt: { type: 'bandpass', f: 2500, q: 1.5, fixed: true }, fixed: true });
    s.osc({ at, f: 120, f1: 60, d: 0.1, g: 0.28 * v, fixed: true });
  },
};

// Secuenciador: "D3:1 F3+A3:0.5 -:1" (nota o acorde con '+', '-' = silencio, duración en pulsos)
function seq(s, inst, str, { bpm = 120, at = 0, vel = 1 } = {}) {
  const beat = 60 / bpm;
  let pos = 0;
  for (const tok of str.trim().split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const [n, d] = tok.split(':');
    const dur = parseFloat(d || '1') * beat;
    if (n !== '-') {
      for (const nn of n.split('+')) {
        const m = midiOf(nn);
        if (m != null) inst(s, at + pos, mtof(m), dur, vel);
      }
    }
    pos += dur;
  }
  return at + pos;
}

function drums(s, style, bpm, beats, at0 = 0) {
  const b = 60 / bpm;
  for (let i = 0; i < beats; i++) {
    const t = at0 + i * b;
    switch (style) {
      case 'march':
        INST.kick(s, t, 0, 0, 0.9);
        if (i % 2) INST.snare(s, t, 0, 0, 0.8);
        break;
      case 'fast':
        if (i % 2 === 0) INST.kick(s, t, 0, 0, 0.9); else INST.snare(s, t, 0, 0, 0.7);
        INST.hat(s, t, 0, 0, 0.8); INST.hat(s, t + b / 2, 0, 0, 0.5);
        break;
      case 'swing':
        if (i % 2 === 0) INST.kick(s, t, 0, 0, 0.6); else INST.snare(s, t, 0, 0, 0.45);
        INST.hat(s, t, 0, 0, 0.7); INST.hat(s, t + b * 0.66, 0, 0, 0.45);
        break;
      case 'waltz':
        if (i % 3 === 0) INST.kick(s, t, 0, 0, 0.6); else INST.hat(s, t, 0, 0, 0.6);
        break;
      case 'disco':
        INST.kick(s, t, 0, 0, 0.9);
        INST.hat(s, t + b / 2, 0, 0, 0.8);
        if (i % 2) INST.snare(s, t, 0, 0, 0.6);
        break;
      case 'polka':
        INST.hat(s, t + b / 2, 0, 0, 0.7);
        if (i % 2) INST.snare(s, t + b / 2, 0, 0, 0.35);
        break;
      default:
        INST.kick(s, t, 0, 0, 0.7);
    }
  }
}

// Jingles de las máquinas de ventajas (melodías originales, estilo máquina expendedora)
const PERK_SONGS = {
  juggernog: { bpm: 112, inst: 'brass', lead: 'Bb3:0.5 Bb3:0.5 D4:0.5 F4:0.5 G4:1 F4:1 Eb4:0.5 D4:0.5 C4:0.5 D4:0.5 Bb3:2', bass: 'Bb1:1 F2:1 Bb1:1 F2:1 Eb2:1 F2:1 Bb1:2', drums: 'march', end: 'Bb4+D5+F5' },
  speedcola: { bpm: 168, inst: 'lead', lead: 'E5:0.5 G#5:0.5 B5:0.5 E6:0.5 D#6:0.5 B5:0.5 G#5:0.5 B5:0.5 C#6:0.5 A5:0.5 F#5:0.5 A5:0.5 B5:0.5 G#5:0.5 E5:1', bass: 'E2:1 E3:1 E2:1 E3:1 A2:1 A3:1 B2:1 E2:1', drums: 'fast', end: 'E5+G#5+B5' },
  doubletap: { bpm: 118, inst: 'pluck', lead: 'G4:0.75 B4:0.25 D5:0.75 B4:0.25 C5:0.75 E5:0.25 D5:1 B4:0.5 A4:0.5 F#4:0.5 A4:0.5 G4:2', bass: 'G2:1 D3:1 C3:1 D3:1 D2:1 D3:1 G2:2', drums: 'swing', end: 'G4+B4+D5' },
  quickrevive: { bpm: 132, inst: 'bell', lead: 'C5:1 F5:1 A5:1 G5:2 F5:1 E5:1 G5:1 C6:1 A5:3', bass: 'F2:3 C3:3 C2:3 F2:3', drums: 'waltz', end: 'F5+A5+C6' },
  staminup: { bpm: 124, inst: 'lead', lead: 'E5:0.5 A5:0.5 C6:0.5 B5:0.5 A5:0.5 G5:0.5 A5:1 E5:0.5 G5:0.5 A5:0.5 C6:0.5 B5:2', bass: 'A2:0.5 A3:0.5 A2:0.5 A3:0.5 A2:0.5 A3:0.5 A2:0.5 A3:0.5 F2:0.5 F3:0.5 F2:0.5 F3:0.5 E2:0.5 E3:0.5 E2:1', drums: 'disco', end: 'A4+C5+E5' },
  mulekick: { bpm: 136, inst: 'accordion', lead: 'D5:0.5 F#5:0.5 A5:0.5 F#5:0.5 G5:0.5 E5:0.5 C#5:0.5 E5:0.5 D5:0.5 A4:0.5 F#4:0.5 A4:0.5 D5:2', bass: 'D2:1 A2:1 A1:1 A2:1 D2:1 A2:1 D2:2', drums: 'polka', end: 'D5+F#5+A5' },
  _default: { bpm: 120, inst: 'lead', lead: 'C5:0.5 E5:0.5 G5:0.5 C6:0.5 B5:0.5 G5:0.5 E5:1 F5:0.5 A5:0.5 G5:0.5 E5:0.5 C5:2', bass: 'C2:1 G2:1 C2:1 G2:1 F2:1 G2:1 C2:2', drums: 'march', end: 'C5+E5+G5' },
};

function perkJingle(s, key) {
  const song = PERK_SONGS[key] || PERK_SONGS._default;
  const b = 60 / song.bpm;
  INST.clank(s, 0, 0, 0, 0.5); // "ka-chunk" de la máquina
  const start = 0.25;
  const endT = seq(s, INST[song.inst] || INST.lead, song.lead, { bpm: song.bpm, at: start, vel: 1.1 });
  seq(s, INST.bass, song.bass, { bpm: song.bpm, at: start, vel: 0.9 });
  drums(s, song.drums, song.bpm, 8, start);
  seq(s, INST.bell, `${song.end}:2`, { bpm: song.bpm, at: endT, vel: 0.5 });
  INST.kick(s, endT, 0, 0, 0.8);
  return endT + 2 * b;
}

const MUSIC = {
  round_start(s) {
    const bpm = 66, b = 60 / bpm;
    INST.timp(s, 0, hz('D2'), 1, 1);
    s.osc({ f: 55, f1: 28, a: 0.01, d: 2.6, g: 0.45, fixed: true });
    seq(s, INST.pad, 'D2+A2+D3:4 Bb1+F2+D3:2 A1+E2+C#3:3', { bpm, vel: 1.1 });
    seq(s, INST.choir, 'D3+A3:4 D3+Bb3:2 C#3+A3:3', { bpm, vel: 0.8 });
    seq(s, INST.brass, '-:0.5 D3:1 F3:0.5 E3:0.5 D3:1 A2:1.5 Bb2:0.5 A2:3.5', { bpm, vel: 0.9 });
    seq(s, INST.bass, 'D2:4 Bb1:2 A1:3', { bpm, vel: 0.9 });
    INST.timp(s, 4 * b, hz('A1'), 1, 0.8);
    INST.timp(s, 6 * b, hz('A1'), 1, 0.9);
    seq(s, INST.bell, '-:6 D5+A5:3', { bpm, vel: 0.45 });
  },
  round_end(s) {
    const bpm = 78;
    seq(s, INST.bell, 'A4:1 F4:1 E4:1 D4:1 C#4:1.5 D4:2.5', { bpm, vel: 0.8 });
    seq(s, INST.pad, 'D3+F3+A3:4 Bb2+D3+G3:2 A2+C#3+E3:2.5', { bpm, vel: 0.9 });
    seq(s, INST.bass, 'D2:4 G1:2 A1:2.5', { bpm, vel: 0.8 });
    s.noise({ color: 'pink', at: 4.6, a: 1.2, d: 0.4, g: 0.1, filt: { type: 'bandpass', f: 500, f1: 3000, q: 1, fixed: true }, fixed: true });
  },
  game_over(s) {
    const bpm = 76, b = 60 / bpm;
    seq(s, INST.pad, 'D3+F3+A3:4 Bb2+D3+F3:4 G2+Bb2+D3:4 A2+C#3+E3:4 D3+F3+A3:6', { bpm, vel: 1 });
    seq(s, INST.tine, 'A5:1.5 F5:0.5 E5:1 D5:1 C#5:1.5 D5:0.5 E5:2 F5:1.5 G5:0.5 A5:1 Bb5:1 A5:3 -:1 D5:4', { bpm, vel: 0.9 });
    seq(s, INST.bass, 'D2:4 Bb1:4 G1:4 A1:4 D1:6', { bpm, vel: 0.9 });
    seq(s, INST.choir, '-:8 G2+D3:4 A2+E3:4 D3+A3:6', { bpm, vel: 0.6 });
    INST.timp(s, 0, hz('D2'), 1, 0.9);
    INST.timp(s, 16 * b, hz('D1'), 1, 1);
  },
  box(s) {
    const bpm = 232;
    seq(s, INST.tine, 'E6:1 B6:1 G6:1 F#6:1 B6:1 D7:1 E7:1.5 D7:0.5 B6:1 C7:2 A6:1 G6:1 F#6:1 D#6:1 E6:2', { bpm, vel: 0.8 });
    seq(s, INST.tine, 'E5:3 B4:3 C5:3 A4:3 B4:3 E5:2', { bpm, vel: 0.5 });
  },
  pap(s) {
    const bpm = 150, b = 60 / bpm;
    for (let i = 0; i < 8; i++) INST.clank(s, i * b, 0, 0, i % 2 ? 0.6 : 1);
    seq(s, INST.lead, 'C3:0.5 G3:0.5 C4:0.5 G3:0.5 Eb3:0.5 Bb3:0.5 Eb4:0.5 Bb3:0.5 F3:0.5 C4:0.5 F4:0.5 C4:0.5 G3:0.5 D4:0.5 G4:0.5 B4:0.5', { bpm, vel: 1.2 });
    seq(s, INST.bass, 'C2:2 Eb2:2 F2:2 G2:2', { bpm, vel: 1 });
    seq(s, INST.bell, '-:8 C5+G5+C6:3', { bpm, vel: 0.7 });
    s.noise({ at: 8 * b, a: 0.02, d: 0.9, g: 0.13, filt: { type: 'highpass', f: 3000, fixed: true }, fixed: true });
  },
  power(s) {
    s.noise({ color: 'pink', a: 1.2, d: 0.05, g: 0.3, filt: { type: 'lowpass', f: 300, f1: 6000, sw: 1.2, fixed: true }, fixed: true });
    seq(s, INST.pad, 'D2+A2+D3+F3:3', { bpm: 60, vel: 1 });
    INST.kick(s, 1.25, 0, 0, 1.2);
    INST.timp(s, 1.25, hz('D1'), 1, 1.2);
    s.noise({ at: 1.25, d: 1.6, g: 0.25, filt: { type: 'highpass', f: 4000, fixed: true }, fixed: true });
    seq(s, INST.brass, 'D3+A3+D4:2 C3+G3+C4:0.5 D3+A3+D4:3', { bpm: 90, at: 1.25, vel: 1 });
    seq(s, INST.bass, 'D2:2 C2:0.5 D2:3', { bpm: 90, at: 1.25, vel: 1 });
  },
};

// ---------------------------------------------------------------------------------------------
// Clase Audio
// ---------------------------------------------------------------------------------------------
export class Audio {
  constructor(ctx) {
    this.ctx = ctx || {};
    this.ac = null;
    this.voices = [];
    this.musicVoices = [];
    this.noiseBuf = {};
    this._curves = new Map();
    this._recent = new Map();
    this._lp = { x: 0, y: 1.6, z: 0 };
    this.lobby = null;
    this.amb = null;
    this.pendingMusic = null;
    this._voices = [];
    const st = this.ctx.settings || {};
    this.masterVolume = typeof st.volume === 'number' ? clamp(st.volume, 0, 1) : 0.8;
    this.musicVolume = typeof st.music === 'number' ? clamp(st.music, 0, 1) : 0.5;

    // Desbloqueo automático en el primer gesto del usuario
    if (typeof window !== 'undefined') {
      const gesture = () => {
        this.unlock();
        if (this.ac && this.ac.state === 'running') {
          for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, gesture, true);
        }
      };
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, gesture, true);
    }

    // Ajustes de volumen
    const events = this.ctx.events;
    if (events && typeof events.on === 'function') {
      events.on('settings', (s) => { if (s) this.setVolumes(s.volume, s.music); });
    }

    // Voces del sintetizador de voz (se cargan de forma asíncrona)
    try {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        const load = () => { try { this._voices = window.speechSynthesis.getVoices() || []; } catch { this._voices = []; } };
        load();
        if (typeof window.speechSynthesis.addEventListener === 'function') window.speechSynthesis.addEventListener('voiceschanged', load);
        else window.speechSynthesis.onvoiceschanged = load;
      }
    } catch { /* sin síntesis de voz */ }
  }

  // ------------------------------------------------------------------ arranque
  unlock() {
    try {
      if (!this.ac) this._init();
      if (this.ac && this.ac.state === 'suspended') {
        this.ac.resume().then(() => this._afterRunning(), () => {});
      } else {
        this._afterRunning();
      }
    } catch (e) {
      console.warn('[Audio] No se pudo iniciar el audio:', e);
    }
  }

  _afterRunning() {
    if (!this.ac || this.ac.state !== 'running') return;
    if (!this.amb) this._startAmbient();
    if (this.pendingMusic === 'lobby') { this.pendingMusic = null; this._startLobby(); }
  }

  _init() {
    const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!AC) return;
    const ac = new AC({ latencyHint: 'interactive' });
    this.ac = ac;

    // Buses: sfx -> filtro (apagado al caer) -> master -> compresor -> salida
    this.comp = ac.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.25;
    this.comp.connect(ac.destination);

    this.master = ac.createGain();
    this.master.gain.value = this.masterVolume;
    this.master.connect(this.comp);

    this.sfxLP = ac.createBiquadFilter();
    this.sfxLP.type = 'lowpass';
    this.sfxLP.frequency.value = 20000;
    this.sfxLP.connect(this.master);

    this.sfx = ac.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.sfxLP);

    this.musicBus = ac.createGain();
    this.musicBus.gain.value = this.musicVolume * 0.9;
    this.musicBus.connect(this.master);

    // Reverberación por convolución con respuesta generada
    this.reverbIn = ac.createGain();
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 180;
    this.convolver = ac.createConvolver();
    this.convolver.buffer = this._makeIR(2.6);
    const wet = ac.createGain();
    wet.gain.value = 0.85;
    this.reverbIn.connect(hp);
    hp.connect(this.convolver);
    this.convolver.connect(wet);
    wet.connect(this.master);

    // Búferes de ruido reutilizables
    this.noiseBuf.white = this._makeNoise(2, 'white');
    this.noiseBuf.pink = this._makeNoise(2, 'pink');
    this.noiseBuf.brown = this._makeNoise(2, 'brown');
    this.noiseBuf.brownLong = this._makeNoise(7.3, 'brown');
    this.noiseBuf.pinkLong = this._makeNoise(6.7, 'pink');
  }

  _makeNoise(seconds, kind) {
    const ac = this.ac;
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else {
        d[i] = w;
      }
    }
    // Fundido cruzado del final con el principio para que el bucle no haga clic
    const F = Math.min(2048, Math.floor(len / 4));
    for (let i = 0; i < F; i++) {
      const k = i / F;
      d[len - F + i] = d[len - F + i] * (1 - k) + d[i] * k;
    }
    return buf;
  }

  _makeIR(seconds) {
    const ac = this.ac;
    const sr = ac.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ac.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len;
        const a = 0.85 - 0.75 * k;               // se oscurece con el tiempo
        lp += a * ((Math.random() * 2 - 1) - lp);
        const fadeIn = i < sr * 0.004 ? i / (sr * 0.004) : 1;
        d[i] = lp * Math.pow(1 - k, 2.6) * fadeIn;
      }
      for (let r = 0; r < 9; r++) {           // reflexiones tempranas
        const at = Math.floor(sr * (0.008 + Math.random() * 0.07));
        if (at < len) d[at] += (Math.random() * 2 - 1) * 0.6 * (1 - r / 12);
      }
    }
    return buf;
  }

  _curve(kind) {
    if (this._curves.has(kind)) return this._curves.get(kind);
    const n = 1024;
    const c = new Float32Array(n);
    const k = kind === 'hard' ? 10 : kind === 'growl' ? 5 : 2.2;
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    this._curves.set(kind, c);
    return c;
  }

  _ready() { return !!this.ac && this.ac.state === 'running'; }

  _distTo(P) {
    const l = this._lp;
    return Math.hypot(P.x - l.x, P.y - l.y, P.z - l.z);
  }

  // ------------------------------------------------------------------ voces
  _voice({ pos = null, volume = 1, verb = 0.15, ref = 2, bus = null, music = false } = {}) {
    const ac = this.ac;
    const now = ac.currentTime;
    const list = music ? this.musicVoices : this.voices;
    this._purge(now);
    if (!music) {
      let alive = 0, oldest = null;
      for (const v of list) {
        if (v.dead) continue;
        alive++;
        if (!v.loop && (!oldest || v.born < oldest.born)) oldest = v;
      }
      if (alive >= MAX_VOICES && oldest) this._kill(oldest, 0.02);
    }
    const out = ac.createGain();
    out.gain.value = volume;
    const v = { out, tail: out, nodes: [], end: now + 0.05, born: now, loop: false, dead: false, music, panner: null, lp: null, send: null };
    let tail = out;
    let wetAmt = verb;
    if (pos) {
      const p = ac.createPanner();
      const low = this.ctx.settings && this.ctx.settings.quality === 'low';
      p.panningModel = low ? 'equalpower' : 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = ref;
      p.maxDistance = 40;
      p.rolloffFactor = 1.1;
      setPannerPos(p, pos, now);
      const d = this._distTo(pos);
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 18000 * Math.pow(0.15, clamp(d / 40, 0, 1)); // absorción del aire
      out.connect(lp);
      lp.connect(p);
      tail = p;
      v.panner = p;
      v.lp = lp;
      wetAmt *= 1 + clamp(d / 25, 0, 1.2);
    }
    tail.connect(bus || this.sfx);
    if (wetAmt > 0) {
      const send = ac.createGain();
      send.gain.value = wetAmt;
      tail.connect(send);
      send.connect(this.reverbIn);
      v.send = send;
    }
    v.tail = tail;
    list.push(v);
    return v;
  }

  _kill(v, fade = 0.05) {
    if (!v || v.dead || !this.ac) return;
    v.dead = true;
    v.loop = false;
    const t = this.ac.currentTime;
    try {
      const g = v.out.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + fade);
    } catch { /* nada */ }
    for (const [n] of v.nodes) { try { n.stop(t + fade + 0.02); } catch { /* ya detenido */ } }
    v.end = t + fade + 0.05;
  }

  _disconnect(v) {
    for (const n of [v.out, v.lp, v.panner, v.send]) { if (n) { try { n.disconnect(); } catch { /* nada */ } } }
    v.nodes.length = 0;
  }

  _purge(now) {
    for (const list of [this.voices, this.musicVoices]) {
      let w = 0;
      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        if (!v.loop && now > v.end + 0.15) this._disconnect(v);
        else list[w++] = v;
      }
      list.length = w;
    }
  }

  _handle(v) {
    return {
      stop: (fade) => this._kill(v, typeof fade === 'number' ? fade : 0.06),
      setPos: (p) => { const P = toVec(p); if (P && v.panner && this.ac) setPannerPos(v.panner, P, this.ac.currentTime); },
    };
  }

  // ------------------------------------------------------------------ API pública
  play(name, opts = {}) {
    if (!this._ready()) return DUMMY;
    const fn = SFX[name];
    if (!fn) return DUMMY;
    const o = opts || {};
    const vol = o.volume == null ? 1 : +o.volume;
    if (!(vol > 0)) return DUMMY;
    const P = toVec(o.pos);
    const now = this.ac.currentTime;
    // Evita duplicados exactos (dos módulos pidiendo el mismo sonido 2D en el mismo frame)
    if (!P && !o.loop) {
      const last = this._recent.get(name);
      if (last != null && now - last < 0.03) return DUMMY;
      this._recent.set(name, now);
    }
    if (P && !o.loop && this._distTo(P) > 60) return DUMMY;
    const meta = META[name] || {};
    const v = this._voice({ pos: P, volume: vol * (meta.g != null ? meta.g : 0.7), verb: meta.verb != null ? meta.verb : 0.12, ref: meta.ref || 2 });
    const rate = typeof o.rate === 'number' && o.rate > 0 ? o.rate : 1;
    const pitch = rate * (meta.jit ? rnd(1 - meta.jit, 1 + meta.jit) : 1);
    const t0 = now + 0.004;
    try { fn(new Synth(this, v, t0, pitch), o); } catch (e) { console.warn('[Audio] Error al sintetizar', name, e); }
    if (o.loop) {
      v.loop = true;
      v.fn = fn;
      v.opts = o;
      v.pitch = pitch;
      v.period = meta.period || Math.max(0.25, v.end - t0);
      v.nextAt = t0 + v.period;
    }
    return this._handle(v);
  }

  weapon(soundKey, { pos, upgraded = false, volume = 1 } = {}) {
    if (!this._ready()) return DUMMY;
    const vol = volume == null ? 1 : +volume;
    if (!(vol > 0)) return DUMMY;
    let key = GUN_ALIAS[soundKey] || soundKey;
    if (!GUNS[key] && !SPECIAL_GUNS[key]) key = 'rifle';
    const P = toVec(pos);
    if (P && this._distTo(P) > 70) return DUMMY;
    const verb = GUNS[key] ? GUNS[key].verb : 0.32;
    const v = this._voice({ pos: P, volume: vol * (P ? 1.0 : 0.8), verb, ref: 4 });
    const s = new Synth(this, v, this.ac.currentTime + 0.003, rnd(0.95, 1.05));
    try {
      if (SPECIAL_GUNS[key]) SPECIAL_GUNS[key](s, !!upgraded);
      else gunshot(s, GUNS[key]);
      if (upgraded) papLayer(s);
    } catch (e) { console.warn('[Audio] Error en disparo', soundKey, e); }
    return this._handle(v);
  }

  music(name) {
    if (!name || name === 'stop' || name === 'none') { this.stopMusic(); return DUMMY; }
    if (!this._ready()) {
      if (name === 'lobby') this.pendingMusic = 'lobby';
      return DUMMY;
    }
    if (name === 'lobby') { this._startLobby(); return { stop: () => this._stopLobby(1.5), setPos() {} }; }
    let fn = MUSIC[name];
    if (!fn && typeof name === 'string' && name.startsWith('perk:')) {
      const key = name.slice(5);
      fn = (s) => perkJingle(s, key);
    }
    if (!fn) return DUMMY;
    const now = this.ac.currentTime;
    // Evita repetir la misma pieza si ya se pidió hace un instante
    for (const v of this.musicVoices) if (v.tag === name && !v.dead && now - v.born < 0.3) return this._handle(v);
    if (name === 'round_start' || name === 'round_end' || name === 'game_over' || name === 'power') this._stopLobby(2);
    if (name === 'game_over') for (const v of this.musicVoices) this._kill(v, 0.8);
    const v = this._voice({ bus: this.musicBus, verb: 0.3, music: true });
    v.tag = name;
    try { fn(new Synth(this, v, now + 0.03, 1)); } catch (e) { console.warn('[Audio] Error en música', name, e); }
    return this._handle(v);
  }

  stopMusic(name) {
    if (!name || name === 'lobby') { this.pendingMusic = null; if (this.ac) this._stopLobby(1.5); }
    if (!this.ac) return;
    for (const v of this.musicVoices) if (!name || v.tag === name) this._kill(v, 0.6);
  }

  announce(text) {
    if (!text) return;
    if (this._ready()) this.play('__announce');
    let spoke = false;
    try {
      const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
      if (synth && typeof window.SpeechSynthesisUtterance === 'function') {
        if (!this._voices || !this._voices.length) this._voices = synth.getVoices() || [];
        if (this._voices.length) {
          const u = new window.SpeechSynthesisUtterance(String(text));
          const vv = this._pickVoice(this._voices);
          if (vv) { u.voice = vv; u.lang = vv.lang; } else u.lang = 'en-US';
          u.pitch = 0.25;
          u.rate = 0.8;
          u.volume = clamp(this.masterVolume, 0, 1);
          if (synth.speaking || synth.pending) synth.cancel();
          synth.speak(u);
          spoke = true;
        }
      }
    } catch { spoke = false; }
    if (!spoke) this._robotVoice(text);
  }

  setVolumes(master, music) {
    if (typeof master === 'number' && isFinite(master)) this.masterVolume = clamp(master, 0, 1);
    if (typeof music === 'number' && isFinite(music)) this.musicVolume = clamp(music, 0, 1);
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.master.gain.setTargetAtTime(this.masterVolume, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.musicVolume * 0.9, t, 0.05);
  }

  update(dt) {
    if (!this.ac) return;
    const now = this.ac.currentTime;
    this._updateListener(now);
    this._purge(now);
    if (this.ac.state !== 'running') return;

    // Sonidos en bucle: se vuelven a sintetizar justo antes de que termine cada periodo
    for (const v of this.voices) {
      if (!v.loop || v.dead) continue;
      if (v.nextAt < now) v.nextAt = now + 0.02;
      if (v.nextAt - now < 0.15) {
        try { v.fn(new Synth(this, v, v.nextAt, v.pitch), v.opts); } catch { /* nada */ }
        v.nextAt += v.period;
        v.nodes = v.nodes.filter(([, e]) => e > now);
      }
    }

    // Campanas del lobby
    if (this.lobby && now >= this.lobby.nextBell) {
      const v = this._voice({ bus: this.musicBus, verb: 0.8, music: true, volume: 0.55 });
      v.tag = 'lobby_bell';
      const s = new Synth(this, v, now + 0.02, 1);
      INST.bell(s, 0, hz(pick(['D5', 'F5', 'A5', 'C6', 'E5', 'A4', 'D6', 'G5'])), 1, rnd(0.3, 0.6));
      if (Math.random() < 0.35) INST.bell(s, rnd(0.3, 0.8), hz(pick(['A4', 'D5', 'F5', 'Bb4'])), 1, 0.3);
      if (Math.random() < 0.2) INST.choir(s, 0, hz(pick(['D3', 'A2', 'F3'])), 4, 0.5);
      this.lobby.nextBell = now + rnd(4, 9);
    }

    // Ambiente: ráfagas de viento y ruidos lejanos
    if (this.amb) {
      const A = this.amb;
      if (now >= A.nextGust) {
        A.out.gain.setTargetAtTime(rnd(0.075, 0.11), now, 0.9);
        A.out.gain.setTargetAtTime(0.055, now + rnd(1.8, 3.2), 1.6);
        A.nextGust = now + rnd(6, 14);
      }
      const gs = this.ctx.gs;
      if (now >= A.nextEvent) {
        if (gs && gs.phase === 'playing') {
          if (Math.random() < 0.6) this.play('zombie_groan', { volume: 0.1, rate: rnd(0.75, 0.9) });
          else this.play('__creak', { volume: 0.5 });
        }
        A.nextEvent = now + rnd(14, 32);
      }
    }

    // Sonido apagado cuando el jugador local está caído
    let down = false;
    try { const me = this.ctx.self; down = !!(me && me.state === 'down'); } catch { down = false; }
    if (down !== this._muffled) {
      this._muffled = down;
      this.sfxLP.frequency.setTargetAtTime(down ? 1100 : 20000, now, down ? 0.25 : 0.4);
    }
  }

  // ------------------------------------------------------------------ internos
  _updateListener(now) {
    const cam = this.ctx.camera;
    if (!cam || !cam.matrixWorld) return;
    const e = cam.matrixWorld.elements;
    const x = e[12], y = e[13], z = e[14];
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    this._lp.x = x; this._lp.y = y; this._lp.z = z;
    const L = this.ac.listener;
    try {
      if (L.positionX) {
        L.positionX.setTargetAtTime(x, now, 0.015);
        L.positionY.setTargetAtTime(y, now, 0.015);
        L.positionZ.setTargetAtTime(z, now, 0.015);
        L.forwardX.setTargetAtTime(fx, now, 0.015);
        L.forwardY.setTargetAtTime(fy, now, 0.015);
        L.forwardZ.setTargetAtTime(fz, now, 0.015);
        L.upX.setTargetAtTime(ux, now, 0.015);
        L.upY.setTargetAtTime(uy, now, 0.015);
        L.upZ.setTargetAtTime(uz, now, 0.015);
      } else {
        L.setPosition(x, y, z);
        L.setOrientation(fx, fy, fz, ux, uy, uz);
      }
    } catch { /* nada */ }
  }

  _pickVoice(voices) {
    const en = voices.filter((v) => /^en/i.test(v.lang || ''));
    const pool = en.length ? en : voices;
    const male = pool.find((v) => /\b(male|david|mark|daniel|fred|alex|guy|george|james|arthur|ryan|thomas)\b/i.test(v.name) && !/female/i.test(v.name));
    return male || pool[0] || null;
  }

  // Locutor de reserva sin speechSynthesis: sílabas con formantes, grave y con mucha reverberación
  _robotVoice(text) {
    if (!this._ready()) return;
    const groups = String(text).toLowerCase().match(/[aeiouy]+/g) || ['a'];
    const syl = groups.slice(0, 8);
    const v = this._voice({ volume: 0.9, verb: 0.55 });
    const s = new Synth(this, v, this.ac.currentTime + 0.25, 1);
    let t = 0;
    syl.forEach((g, i) => {
      const vw = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u', y: 'i' }[g[0]] || 'a';
      const last = i === syl.length - 1;
      const dur = last ? 0.42 : 0.2;
      s.noise({ at: t, d: 0.04, g: 0.08, filt: { type: 'bandpass', f: 2500, q: 1 } });
      voiceSyl(s, { at: t + 0.03, dur, f0: 78 - i * 1.5, f1: last ? 55 : 72 - i, vowels: [vw, vw === 'a' ? 'uh' : vw], scale: 0.9, g: 0.7, noise: 0.08, amp: [0, 1, 0.95, 0.85, 0.6, 0] });
      t += dur + 0.06;
    });
  }

  _startLobby() {
    if (this.lobby || !this._ready()) return;
    const ac = this.ac;
    const t = ac.currentTime;
    const out = ac.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.5, t + 5);
    out.connect(this.musicBus);
    const send = ac.createGain();
    send.gain.value = 0.6;
    out.connect(send);
    send.connect(this.reverbIn);
    const trem = ac.createGain();
    trem.gain.value = 0.85;
    trem.connect(out);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 2.5;
    lp.connect(trem);
    const nodes = [];
    const mk = (type, f, det, g, dest = lp) => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      const gg = ac.createGain();
      gg.gain.value = g;
      o.connect(gg);
      gg.connect(dest);
      o.start(t);
      nodes.push(o);
      return o;
    };
    mk('sawtooth', 36.71, 0, 0.16);
    mk('sawtooth', 73.42, 6, 0.12);
    mk('sawtooth', 110.0, -7, 0.07);
    mk('triangle', 174.61, 3, 0.03);
    mk('sine', 36.71, 0, 0.22, out);
    const lfo = (rate, depth, param) => {
      const o = ac.createOscillator();
      o.frequency.value = rate;
      const g = ac.createGain();
      g.gain.value = depth;
      o.connect(g);
      g.connect(param);
      o.start(t);
      nodes.push(o);
    };
    lfo(0.045, 220, lp.frequency);
    lfo(0.11, 0.15, trem.gain);
    const n = ac.createBufferSource();
    n.buffer = this.noiseBuf.brownLong;
    n.loop = true;
    const nb = ac.createBiquadFilter();
    nb.type = 'bandpass';
    nb.frequency.value = 300;
    nb.Q.value = 0.8;
    const ng = ac.createGain();
    ng.gain.value = 0.05;
    n.connect(nb);
    nb.connect(ng);
    ng.connect(out);
    n.start(t);
    nodes.push(n);
    this.lobby = { out, send, nodes, nextBell: t + 2.5 };
  }

  _stopLobby(fade = 1.5) {
    const L = this.lobby;
    if (!L || !this.ac) return;
    this.lobby = null;
    const t = this.ac.currentTime;
    try {
      L.out.gain.cancelScheduledValues(t);
      L.out.gain.setValueAtTime(Math.max(0.0001, L.out.gain.value), t);
      L.out.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    } catch { /* nada */ }
    for (const n of L.nodes) { try { n.stop(t + fade + 0.1); } catch { /* nada */ } }
    setTimeout(() => { try { L.out.disconnect(); L.send.disconnect(); } catch { /* nada */ } }, (fade + 0.4) * 1000);
    for (const v of this.musicVoices) if (v.tag === 'lobby_bell') this._kill(v, fade);
  }

  // Viento nocturno suave en bucle
  _startAmbient() {
    const ac = this.ac;
    const t = ac.currentTime;
    const out = ac.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.055, t + 4);
    out.connect(this.sfx);
    const src = (buf) => { const n = ac.createBufferSource(); n.buffer = buf; n.loop = true; n.start(t, Math.random() * 2); return n; };
    const bp1 = ac.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.frequency.value = 420;
    bp1.Q.value = 0.8;
    src(this.noiseBuf.brownLong).connect(bp1);
    bp1.connect(out);
    const bp2 = ac.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 1400;
    bp2.Q.value = 4;
    const g2 = ac.createGain();
    g2.gain.value = 0.22;
    src(this.noiseBuf.pinkLong).connect(bp2);
    bp2.connect(g2);
    g2.connect(out);
    const lfo = (rate, depth, param) => {
      const o = ac.createOscillator();
      o.frequency.value = rate;
      const g = ac.createGain();
      g.gain.value = depth;
      o.connect(g);
      g.connect(param);
      o.start(t);
    };
    lfo(0.06, 160, bp1.frequency);
    lfo(0.09, 500, bp2.frequency);
    lfo(0.13, 0.12, g2.gain);
    this.amb = { out, nextGust: t + rnd(3, 8), nextEvent: t + rnd(15, 30) };
  }
}

export default Audio;
