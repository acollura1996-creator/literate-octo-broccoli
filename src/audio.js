// Procedural sound for Heroes & Empires.
//
// There are no audio files: every effect and the background music is
// synthesized at runtime with the Web Audio API (oscillators, filtered noise,
// envelopes and a little FM). Nothing touches `window` / `AudioContext` until
// initAudio() is called, so the module can be imported anywhere (including
// Node) without side effects.
//
// Signal flow:
//   sfx voices ──► sfxGain ──────────────┐
//        └──(wet sends)──► reverb ───────┤
//   music notes ─► musicBus ─► musicGain ─► musicDuck ─┬──► compressor ─► masterGain ─► out
//                                                      └──(wet)──► reverb

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const MAX_VOICES = 24; // simultaneously active sfx voices
const MAX_PER_NAME = 4; // overlapping instances of the same effect
const MIN_GAP = 0.04; // seconds between two starts of the same effect
const START_DELAY = 0.005; // tiny scheduling offset so envelopes start cleanly

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let ctx = null;
let compressor = null;
let masterGain = null;
let sfxGain = null;
let musicGain = null;
let musicDuck = null;
let reverbIn = null;
let noiseBuf = null;
let distCurve = null;

let muted = false;
let masterVolume = 0.6;
let musicVolume = 0.35;
let resumeRequestedAt = -1e9;

/** Active, counted sfx voices in start order (oldest first). */
const voices = [];
/** name -> { count, last } */
const nameStats = new Map();

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function toUnit(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? clamp01(n) : fallback;
}

// ---------------------------------------------------------------------------
// Context / graph setup
// ---------------------------------------------------------------------------

function makeNoiseBuffer(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Stereo, slightly darkening, exponentially decaying noise = cheap hall reverb. */
function makeImpulse(seconds, decay) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const pre = Math.floor(sr * 0.012);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      if (i < pre) {
        d[i] = 0;
        continue;
      }
      const x = i / len;
      const k = 0.7 - 0.55 * x; // tail gets darker over time
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] = lp * Math.pow(1 - x, decay);
    }
  }
  return buf;
}

function makeDistCurve(amount) {
  const n = 1024;
  const c = new Float32Array(n);
  const norm = Math.tanh(amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(amount * x) / norm;
  }
  return c;
}

function buildGraph() {
  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 12;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.2;

  masterGain = ctx.createGain();
  masterGain.gain.value = muted ? 0 : masterVolume;
  compressor.connect(masterGain);
  masterGain.connect(ctx.destination);

  sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.9;
  sfxGain.connect(compressor);

  reverbIn = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(1.8, 2.6);
  const revOut = ctx.createGain();
  revOut.gain.value = 0.55;
  reverbIn.connect(conv);
  conv.connect(revOut);
  revOut.connect(compressor);

  musicGain = ctx.createGain();
  musicGain.gain.value = musicVolume;
  musicDuck = ctx.createGain();
  musicGain.connect(musicDuck);
  musicDuck.connect(compressor);
  const musicWet = ctx.createGain();
  musicWet.gain.value = 0.45;
  musicDuck.connect(musicWet);
  musicWet.connect(reverbIn);

  noiseBuf = makeNoiseBuffer(2);
  distCurve = makeDistCurve(2.5);

  // Older iOS only unlocks output once something is played inside a gesture.
  try {
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    s.connect(ctx.destination);
    s.onended = () => s.disconnect();
    s.start(0);
  } catch {
    /* ignore */
  }
}

/**
 * Create (once) and resume the AudioContext. Safe to call many times; call it
 * from a user gesture (pointerdown / keydown) so browsers allow playback.
 */
export function initAudio() {
  if (typeof window === 'undefined') return false;
  try {
    if (ctx && ctx.state === 'closed') ctx = null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        ctx = new AC();
      }
      buildGraph();
    }
    if (ctx.state !== 'running') {
      resumeRequestedAt = nowMs();
      const p = ctx.resume && ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    if (music.wanted && !music.on) beginMusic();
    return true;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[audio] init failed:', e);
    return false;
  }
}

/** True when sounds can be scheduled (running, or a resume was just requested). */
function canPlay() {
  if (!ctx) return false;
  if (ctx.state === 'running') return true;
  return ctx.state === 'suspended' && nowMs() - resumeRequestedAt < 600;
}

// ---------------------------------------------------------------------------
// Volume / mute
// ---------------------------------------------------------------------------

export function setMuted(m) {
  muted = !!m;
  if (ctx && masterGain) {
    masterGain.gain.setTargetAtTime(muted ? 0 : masterVolume, ctx.currentTime, 0.015);
  }
}

export function isMuted() {
  return muted;
}

export function setMasterVolume(v) {
  masterVolume = toUnit(v, masterVolume);
  if (ctx && masterGain && !muted) {
    masterGain.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.02);
  }
}

export function setMusicVolume(v) {
  musicVolume = toUnit(v, musicVolume);
  if (ctx && musicGain) musicGain.gain.setTargetAtTime(musicVolume, ctx.currentTime, 0.05);
}

/** Temporarily lower the music (victory / defeat stingers). */
function duckMusic(t, dur, level = 0.25) {
  if (!musicDuck) return;
  const p = musicDuck.gain;
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(level, t + 0.25);
  p.setValueAtTime(level, t + dur);
  p.linearRampToValueAtTime(1, t + dur + 1.5);
}

// ---------------------------------------------------------------------------
// Voices: every node of one sound is tracked so it can be disconnected when
// all of its sources have ended (or the voice is stolen).
// ---------------------------------------------------------------------------

function makeVoice(name, prio, out, stats) {
  return {
    name,
    prio,
    out,
    stats,
    start: ctx ? ctx.currentTime : 0,
    nodes: out ? [out] : [],
    sources: [],
    pending: 0,
    end: 0,
    counted: false,
    done: false,
    timer: 0,
  };
}

function releaseCounts(v) {
  if (!v.counted) return;
  v.counted = false;
  if (v.stats) v.stats.count--;
  const i = voices.indexOf(v);
  if (i >= 0) voices.splice(i, 1);
}

function finishVoice(v) {
  if (v.done) return;
  v.done = true;
  releaseCounts(v);
  if (v.timer) clearTimeout(v.timer);
  for (const s of v.sources) s.onended = null;
  for (const n of v.nodes) {
    try {
      n.disconnect();
    } catch {
      /* already disconnected */
    }
  }
  v.nodes.length = 0;
  v.sources.length = 0;
}

/** Quickly fade a voice out and stop its sources (voice stealing). */
function killVoice(v) {
  releaseCounts(v);
  if (!ctx || v.done) return;
  const t = ctx.currentTime;
  try {
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setTargetAtTime(0, t, 0.01);
  } catch {
    /* ignore */
  }
  for (const s of v.sources) {
    try {
      s.stop(t + 0.06);
    } catch {
      /* some browsers refuse a second stop(); the fade still silences it */
    }
  }
}

/**
 * Free a slot for a sound of priority `prio`; false if nothing may be stolen.
 * Lower-priority voices go first (oldest first); a voice of equal priority is
 * only stolen once it is past its attack, so a burst of hits doesn't churn.
 */
function stealVoice(prio) {
  const now = ctx.currentTime;
  let victim = null;
  for (const v of voices) {
    const ok = v.prio < prio || (v.prio === prio && now - v.start > 0.12);
    if (ok && (!victim || v.prio < victim.prio)) victim = v;
  }
  if (!victim) return false;
  killVoice(victim);
  return true;
}

// --- node helpers (all register the node on the voice) ---------------------

function track(v, n) {
  v.nodes.push(n);
  return n;
}

function gainNode(v, value, dest) {
  const g = ctx.createGain();
  g.gain.value = value;
  if (dest) g.connect(dest);
  return track(v, g);
}

function biquad(v, type, freq, Q, dest) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (Q != null) f.Q.value = Q;
  if (dest) f.connect(dest);
  return track(v, f);
}

function shaper(v, dest) {
  const ws = ctx.createWaveShaper();
  ws.curve = distCurve;
  ws.oversample = 'none';
  ws.connect(dest);
  return track(v, ws);
}

function runSource(v, src, t0, t1, offset) {
  v.pending++;
  v.sources.push(src);
  src.onended = () => {
    v.pending--;
    if (v.pending <= 0) finishVoice(v);
  };
  if (offset != null) src.start(t0, offset);
  else src.start(t0);
  src.stop(t1);
  if (t1 > v.end) v.end = t1;
  return track(v, src);
}

function oscNode(v, type, freq, t0, t1, dest) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  if (dest) o.connect(dest);
  return runSource(v, o, t0, t1);
}

function noiseNode(v, t0, t1, dest, rate = 1) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  if (rate !== 1) s.playbackRate.value = rate;
  s.connect(dest);
  return runSource(v, s, t0, t1, Math.random() * (noiseBuf.duration - 0.05));
}

/** Send part of a voice to the shared reverb. */
function wet(v, amount) {
  if (!reverbIn) return;
  const g = gainNode(v, amount, reverbIn);
  v.out.connect(g);
}

// --- envelope helpers -------------------------------------------------------

/** 0 -> peak (linear, `a` s) -> ~0 (exponential, `d` s). */
function perc(param, t, a, peak, d) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.exponentialRampToValueAtTime(0.0001, t + a + d);
  return t + a + d;
}

/** 0 -> peak (linear, `a`), hold, -> ~0 (exponential, `r`). */
function swell(param, t, a, peak, hold, r) {
  const h = t + a + Math.max(0, hold);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setValueAtTime(peak, h);
  param.exponentialRampToValueAtTime(0.0001, h + r);
  return h + r;
}

function sweep(param, t, from, to, dur) {
  param.setValueAtTime(from, t);
  param.exponentialRampToValueAtTime(to, t + dur);
}

// --- building blocks --------------------------------------------------------

/** Filtered white-noise burst. o: {type,freq,Q,freqTo,sweep,a,peak,d,dest,rate} */
function noiseBurst(v, t, o) {
  const a = o.a != null ? o.a : 0.002;
  const d = o.d != null ? o.d : 0.1;
  const g = gainNode(v, 0, o.dest);
  const f = biquad(v, o.type || 'bandpass', o.freq, o.Q, g);
  perc(g.gain, t, a, o.peak != null ? o.peak : 0.5, d);
  if (o.freqTo) sweep(f.frequency, t, o.freq, o.freqTo, o.sweep != null ? o.sweep : a + d);
  noiseNode(v, t, t + a + d + 0.02, f, o.rate || 1);
  return { f, g };
}

/** Single decaying partial. */
function ping(v, t, f, peak, decay, dest, type = 'sine', attack = 0.002) {
  const g = gainNode(v, 0, dest);
  perc(g.gain, t, attack, peak, decay);
  return oscNode(v, type, f, t, t + attack + decay + 0.01, g);
}

/** Inharmonic struck-metal partials. */
function metal(v, t, base, ratios, amps, decays, dest) {
  for (let i = 0; i < ratios.length; i++) {
    ping(v, t, base * ratios[i] * rand(0.995, 1.005), amps[i], decays[i], dest, 'sine', 0.0008);
  }
}

/** Two-operator FM bell. */
function fmBell(v, t, f, ratio, index, peak, decay, dest) {
  const g = gainNode(v, 0, dest);
  perc(g.gain, t, 0.002, peak, decay);
  const car = oscNode(v, 'sine', f, t, t + decay + 0.02, g);
  const mg = gainNode(v, 0, car.frequency);
  perc(mg.gain, t, 0.001, index, decay * 0.6);
  oscNode(v, 'sine', f * ratio, t, t + decay + 0.02, mg);
}

/** Soft harmonic chime (fundamental + octave + 3rd harmonic). */
function chime(v, t, f, peak, decay, dest) {
  ping(v, t, f, peak, decay, dest);
  ping(v, t, f * 2, peak * 0.3, decay * 0.5, dest);
  ping(v, t, f * 3.01, peak * 0.12, decay * 0.3, dest);
}

/** Two detuned saws through an enveloped low-pass: a cheap brass note. */
function brass(v, t, f, dur, peak, dest, vib = false, bright = 1) {
  const end = t + dur;
  const g = gainNode(v, 0, dest);
  const lp = biquad(v, 'lowpass', f, 1.1, g);
  const a = 0.03;
  const dk = t + Math.max(a + 0.01, Math.min(0.12, dur * 0.7));
  const rel = Math.max(end, dk);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.linearRampToValueAtTime(peak * 0.78, dk);
  g.gain.setValueAtTime(peak * 0.78, rel);
  g.gain.exponentialRampToValueAtTime(0.0001, rel + 0.14);
  const fc = Math.min(f * 6 * bright, 8000);
  const fs = Math.min(f * 3.2 * bright, 5000);
  lp.frequency.setValueAtTime(f * 1.2, t);
  lp.frequency.linearRampToValueAtTime(fc, t + 0.035);
  lp.frequency.exponentialRampToValueAtTime(fs, t + 0.035 + Math.max(0.05, Math.min(0.25, dur)));
  const stop = rel + 0.16;
  const oscs = [-7, 7].map((dt) => {
    const o = oscNode(v, 'sawtooth', f, t, stop, lp);
    o.detune.value = dt;
    o.frequency.setValueAtTime(f * 0.97, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.04);
    return o;
  });
  if (vib && dur > 0.3) {
    const lfo = oscNode(v, 'sine', 5.2, t, stop, null);
    const lg = gainNode(v, 0, null);
    lfo.connect(lg);
    for (const o of oscs) lg.connect(o.detune);
    lg.gain.setValueAtTime(0, t + 0.15);
    lg.gain.linearRampToValueAtTime(14, t + 0.45);
  }
}

/** Sustained saw chord through a dark low-pass. */
function pad(v, t, midis, dur, peak, dest) {
  const g = gainNode(v, 0, dest);
  const lp = biquad(v, 'lowpass', 900, 0.7, g);
  swell(g.gain, t, 0.12, peak, dur - 0.12, 0.5);
  for (const m of midis) {
    const o = oscNode(v, 'sawtooth', mtof(m), t, t + dur + 0.55, lp);
    o.detune.value = rand(-6, 6);
  }
}

function timpani(v, t, f, peak, dest) {
  const g = gainNode(v, 0, dest);
  perc(g.gain, t, 0.003, peak, 0.9);
  const o = oscNode(v, 'sine', f, t, t + 0.95, g);
  sweep(o.frequency, t, f * 1.08, f, 0.08);
  ping(v, t, f * 1.5, peak * 0.35, 0.4, dest);
  noiseBurst(v, t, { type: 'lowpass', freq: 600, a: 0.001, peak: peak * 0.5, d: 0.07, dest });
}

/** Random tiny clicks from one noise source (fire / debris crackle). */
function crackle(v, t, dur, count, peak, hp, dest) {
  const g = gainNode(v, 0, dest);
  const f = biquad(v, 'highpass', hp, 0.8, g);
  const times = [];
  for (let i = 0; i < count; i++) times.push(t + Math.random() * dur);
  times.sort((x, y) => x - y);
  g.gain.setValueAtTime(0, t);
  for (const tt of times) {
    g.gain.setValueAtTime(peak * rand(0.3, 1), tt);
    g.gain.setTargetAtTime(0, tt, rand(0.002, 0.006));
  }
  noiseNode(v, t, t + dur + 0.05, f);
}

function thump(v, t, from, to, peak, decay, dest, type = 'sine') {
  const g = gainNode(v, 0, dest);
  perc(g.gain, t, 0.002, peak, decay);
  const o = oscNode(v, type, from, t, t + decay + 0.03, g);
  sweep(o.frequency, t, from, to, Math.max(0.02, decay * 0.6));
  return o;
}

function coin(v, t, p, peak, dest) {
  const base = 2350 * p;
  ping(v, t, base, peak, 0.25, dest, 'sine', 0.0008);
  ping(v, t, base * 2.32, peak * 0.5, 0.18, dest, 'sine', 0.0008);
  ping(v, t, base * 3.93, peak * 0.3, 0.1, dest, 'sine', 0.0008);
  noiseBurst(v, t, { type: 'highpass', freq: 5000, a: 0.0005, peak: peak * 0.6, d: 0.015, dest });
}

function knock(v, t, p, dest) {
  noiseBurst(v, t, { type: 'bandpass', freq: 1100 * p, Q: 3, a: 0.001, peak: 0.8, d: 0.07, dest });
  thump(v, t, 240 * p, 140 * p, 0.5, 0.09, dest);
  noiseBurst(v, t, { type: 'bandpass', freq: 3800 * p, Q: 5, a: 0.0005, peak: 0.35, d: 0.025, dest });
}

// ---------------------------------------------------------------------------
// Sound effects. Each takes (voice, startTime, outputNode).
// ---------------------------------------------------------------------------

function sSwordHit(v, t, out) {
  const p = rand(0.9, 1.12);
  noiseBurst(v, t, { type: 'bandpass', freq: 3800 * p, Q: 1.2, a: 0.001, peak: 0.7, d: 0.07, dest: out });
  metal(
    v,
    t,
    rand(1250, 1450) * p,
    [1, 1.52, 2.17, 2.73, 3.41],
    [0.22, 0.16, 0.12, 0.08, 0.06],
    [0.32, 0.22, 0.16, 0.12, 0.09],
    out
  );
  thump(v, t, 420 * p, 180 * p, 0.3, 0.06, out, 'triangle');
}

function sHeavyHit(v, t, out) {
  const p = rand(0.9, 1.1);
  thump(v, t, 150 * p, 42 * p, 0.9, 0.3, out);
  noiseBurst(v, t, { type: 'lowpass', freq: 700, Q: 0.7, a: 0.001, peak: 0.7, d: 0.12, dest: out });
  noiseBurst(v, t, { type: 'bandpass', freq: 1800 * p, Q: 1.5, a: 0.001, peak: 0.35, d: 0.06, dest: out });
  metal(
    v,
    t + 0.003,
    rand(560, 680) * p,
    [1, 1.47, 2.09, 2.64],
    [0.14, 0.1, 0.07, 0.05],
    [0.35, 0.25, 0.18, 0.12],
    out
  );
}

function sArrowShoot(v, t, out) {
  const p = rand(0.92, 1.08);
  // bowstring twang: resonant low-pass closing on a saw
  const g = gainNode(v, 0, out);
  const lp = biquad(v, 'lowpass', 3000, 6, g);
  perc(g.gain, t, 0.002, 0.35, 0.16);
  sweep(lp.frequency, t, 3000, 300, 0.14);
  const o = oscNode(v, 'sawtooth', 230 * p, t, t + 0.2, lp);
  sweep(o.frequency, t, 230 * p, 170 * p, 0.12);
  // arrow whoosh flying away
  noiseBurst(v, t + 0.01, {
    type: 'bandpass',
    freq: 2600 * p,
    freqTo: 900 * p,
    Q: 2.5,
    a: 0.03,
    peak: 0.5,
    d: 0.16,
    dest: out,
  });
}

function sArrowHit(v, t, out) {
  const p = rand(0.9, 1.15);
  thump(v, t, 300 * p, 90 * p, 0.6, 0.07, out);
  noiseBurst(v, t, { type: 'bandpass', freq: 1300 * p, Q: 2.5, a: 0.0005, peak: 0.6, d: 0.045, dest: out });
  noiseBurst(v, t, { type: 'lowpass', freq: 500, a: 0.001, peak: 0.4, d: 0.06, dest: out });
}

function sMagicCast(v, t, out) {
  wet(v, 0.45);
  const p = rand(0.95, 1.05);
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.12, 0.16, 0.25, 0.25);
  const o = oscNode(v, 'triangle', 330 * p, t, t + 0.65, g);
  sweep(o.frequency, t, 330 * p, 1320 * p, 0.45);
  const lfo = oscNode(v, 'sine', 11, t, t + 0.65, null);
  lfo.connect(gainNode(v, 30, o.detune));
  [76, 79, 81, 84, 88, 91].forEach((m, i) => ping(v, t + 0.05 + i * 0.06, mtof(m) * p, 0.12, 0.35, out));
  noiseBurst(v, t, { type: 'bandpass', freq: 1500, freqTo: 7000, Q: 3, a: 0.3, peak: 0.15, d: 0.3, dest: out });
}

function sMagicHit(v, t, out) {
  wet(v, 0.35);
  const p = rand(0.92, 1.1);
  noiseBurst(v, t, { type: 'bandpass', freq: 3200 * p, Q: 0.9, a: 0.001, peak: 0.5, d: 0.12, dest: out });
  fmBell(v, t, 880 * p, 3.5, 600, 0.22, 0.45, out);
  thump(v, t, 320 * p, 90 * p, 0.4, 0.12, out);
  for (let i = 0; i < 3; i++) {
    ping(v, t + 0.02 + Math.random() * 0.15, rand(2200, 4800), 0.07, rand(0.12, 0.25), out);
  }
}

function sHeal(v, t, out) {
  wet(v, 0.5);
  [72, 76, 79, 84, 88].forEach((m, i) => {
    const tt = t + i * 0.075;
    ping(v, tt, mtof(m), 0.13, 0.55, out, 'sine', 0.015);
    ping(v, tt, mtof(m + 12), 0.04, 0.3, out, 'triangle', 0.01);
  });
  noiseBurst(v, t, { type: 'highpass', freq: 6000, a: 0.25, peak: 0.05, d: 0.5, dest: out });
}

function sExplosion(v, t, out) {
  wet(v, 0.2);
  const p = rand(0.85, 1.1);
  noiseBurst(v, t, {
    type: 'lowpass',
    freq: 1600 * p,
    freqTo: 90,
    sweep: 0.9,
    Q: 0.8,
    a: 0.004,
    peak: 1.0,
    d: 1.1,
    dest: out,
  });
  thump(v, t, 110 * p, 32, 1.0, 0.7, out);
  noiseBurst(v, t, { type: 'bandpass', freq: 2200, Q: 0.8, a: 0.001, peak: 0.45, d: 0.12, dest: out });
  crackle(v, t + 0.08, 0.6, 8, 0.25, 2500, out);
}

function sFire(v, t, out) {
  const p = rand(0.9, 1.1);
  noiseBurst(v, t, {
    type: 'bandpass',
    freq: 500 * p,
    freqTo: 1800 * p,
    Q: 0.9,
    a: 0.1,
    peak: 0.55,
    d: 0.55,
    dest: out,
  });
  noiseBurst(v, t, { type: 'lowpass', freq: 400, a: 0.08, peak: 0.4, d: 0.5, dest: out });
  crackle(v, t + 0.03, 0.6, 12, 0.35, 1800, out);
}

function sFrost(v, t, out) {
  wet(v, 0.5);
  const scale = [88, 91, 93, 95, 98, 100, 103];
  for (let i = 0; i < 7; i++) {
    const tt = t + i * 0.055 + Math.random() * 0.04;
    const f = mtof(pick(scale));
    const decay = rand(0.2, 0.45);
    ping(v, tt, f, rand(0.05, 0.1), decay, out, 'sine', 0.001);
    ping(v, tt, f * 2.76, 0.025, decay * 0.4, out, 'sine', 0.001);
  }
  noiseBurst(v, t, { type: 'highpass', freq: 7000, a: 0.05, peak: 0.12, d: 0.5, dest: out });
  noiseBurst(v, t, { type: 'bandpass', freq: 4500, Q: 2, a: 0.001, peak: 0.25, d: 0.05, dest: out });
}

function sThunder(v, t, out) {
  wet(v, 0.3);
  // crack
  noiseBurst(v, t, { type: 'highpass', freq: 1200, a: 0.002, peak: 0.8, d: 0.18, dest: out });
  // slam
  thump(v, t, 95, 38, 1.0, 0.6, out);
  // rumble with random swells
  const rg = gainNode(v, 0, out);
  const lp = biquad(v, 'lowpass', 900, 0.9, rg);
  sweep(lp.frequency, t, 900, 120, 1.4);
  rg.gain.setValueAtTime(0, t);
  rg.gain.linearRampToValueAtTime(0.9, t + 0.02);
  let tt = t + 0.1;
  while (tt < t + 1.5) {
    rg.gain.linearRampToValueAtTime(rand(0.25, 0.8) * (1 - (tt - t) / 1.7), tt);
    tt += rand(0.08, 0.2);
  }
  rg.gain.linearRampToValueAtTime(0, t + 1.8);
  noiseNode(v, t, t + 1.85, lp, 0.5);
}

function sStun(v, t, out) {
  wet(v, 0.25);
  const p = rand(0.95, 1.05);
  thump(v, t, 750 * p, 180 * p, 0.55, 0.14, out, 'triangle');
  noiseBurst(v, t, { type: 'bandpass', freq: 1000, Q: 1.5, a: 0.001, peak: 0.4, d: 0.04, dest: out });
  // dizzy ringing: two close sines beat against each other
  ping(v, t + 0.02, 1568 * p, 0.08, 0.8, out);
  ping(v, t + 0.02, 1577 * p, 0.08, 0.8, out);
  ping(v, t + 0.02, 1568 * 2.42 * p, 0.03, 0.4, out);
}

function sBuild(v, t, out) {
  for (let i = 0; i < 3; i++) knock(v, t + i * 0.2 + rand(0, 0.03), rand(0.9, 1.1), out);
}

function sBuildComplete(v, t, out) {
  wet(v, 0.3);
  brass(v, t, mtof(67), 0.11, 0.22, out); // G4
  brass(v, t + 0.13, mtof(72), 0.11, 0.22, out); // C5
  brass(v, t + 0.26, mtof(76), 0.55, 0.24, out, true); // E5
  brass(v, t + 0.26, mtof(60), 0.55, 0.12, out); // C4 under it
}

function sUnitReady(v, t, out) {
  wet(v, 0.35);
  chime(v, t, mtof(76), 0.2, 0.6, out); // E5
  chime(v, t + 0.13, mtof(81), 0.2, 0.8, out); // A5
}

function sSelect(v, t, out) {
  const g = gainNode(v, 0, out);
  perc(g.gain, t, 0.002, 0.18, 0.06);
  const o = oscNode(v, 'sine', 820, t, t + 0.08, g);
  sweep(o.frequency, t, 820, 1250, 0.04);
}

function sClick(v, t, out) {
  noiseBurst(v, t, { type: 'bandpass', freq: 3000, Q: 1.2, a: 0.0005, peak: 0.35, d: 0.018, dest: out });
  thump(v, t, 1800, 1100, 0.25, 0.03, out, 'triangle');
}

function sError(v, t, out) {
  const g = gainNode(v, 0, out);
  const lp = biquad(v, 'lowpass', 520, 1, g);
  const G = g.gain;
  G.setValueAtTime(0, t);
  G.linearRampToValueAtTime(0.35, t + 0.01);
  G.setValueAtTime(0.35, t + 0.11);
  G.linearRampToValueAtTime(0.02, t + 0.14);
  G.linearRampToValueAtTime(0.35, t + 0.16);
  G.setValueAtTime(0.35, t + 0.3);
  G.exponentialRampToValueAtTime(0.0001, t + 0.36);
  oscNode(v, 'sawtooth', 92, t, t + 0.38, lp);
  oscNode(v, 'square', 97.5, t, t + 0.38, lp);
}

function sLevelUp(v, t, out) {
  wet(v, 0.45);
  [67, 72, 76, 79].forEach((m, i) => brass(v, t + i * 0.085, mtof(m), 0.08, 0.17, out));
  brass(v, t + 0.34, mtof(84), 0.6, 0.2, out, true); // C6
  brass(v, t + 0.34, mtof(76), 0.6, 0.1, out); // E5
  for (let i = 0; i < 8; i++) {
    const tt = t + 0.3 + i * 0.07 + rand(0, 0.03);
    ping(v, tt, mtof(pick([84, 88, 91, 96, 100])), rand(0.04, 0.08), rand(0.25, 0.5), out);
  }
  noiseBurst(v, t + 0.2, { type: 'bandpass', freq: 2000, freqTo: 9000, Q: 2, a: 0.3, peak: 0.1, d: 0.6, dest: out });
}

function sDeath(v, t, out) {
  const p = rand(0.8, 1.2);
  const g = gainNode(v, 0, out);
  const lp = biquad(v, 'lowpass', 1400 * p, 2, g);
  swell(g.gain, t, 0.03, 0.32, 0.25, 0.35);
  sweep(lp.frequency, t, 1400 * p, 300, 0.6);
  const o = oscNode(v, 'sawtooth', 210 * p, t, t + 0.68, lp);
  sweep(o.frequency, t, 210 * p, 75 * p, 0.6);
  const o2 = oscNode(v, 'sawtooth', 210 * p, t, t + 0.68, lp);
  o2.detune.value = 22;
  sweep(o2.frequency, t, 210 * p, 75 * p, 0.6);
  const lfo = oscNode(v, 'sine', 7, t, t + 0.68, null);
  const lg = gainNode(v, 30, null);
  lfo.connect(lg);
  lg.connect(o.detune);
  lg.connect(o2.detune);
  noiseBurst(v, t, { type: 'bandpass', freq: 700 * p, Q: 1.2, a: 0.02, peak: 0.25, d: 0.4, dest: out });
  thump(v, t + 0.3, 120, 50, 0.3, 0.12, out); // body hits the ground
}

function sGold(v, t, out) {
  const p = rand(0.95, 1.08);
  coin(v, t, p, 0.18, out);
  coin(v, t + 0.07, p * 1.06, 0.14, out);
}

function sBuy(v, t, out) {
  wet(v, 0.2);
  for (let i = 0; i < 5; i++) coin(v, t + i * 0.045 + rand(0, 0.02), rand(0.85, 1.15), 0.12, out);
  chime(v, t + 0.25, mtof(93), 0.13, 0.7, out); // "ka-ching"
  chime(v, t + 0.25, mtof(88), 0.08, 0.6, out);
}

function sChop(v, t, out) {
  const p = rand(0.88, 1.12);
  noiseBurst(v, t, { type: 'bandpass', freq: 750 * p, Q: 1.8, a: 0.001, peak: 0.8, d: 0.09, dest: out });
  noiseBurst(v, t, { type: 'bandpass', freq: 2600 * p, Q: 2, a: 0.0005, peak: 0.35, d: 0.025, dest: out });
  thump(v, t, 200 * p, 95 * p, 0.55, 0.1, out);
}

function sTeleport(v, t, out) {
  wet(v, 0.5);
  const g = gainNode(v, 0, out);
  const bp = biquad(v, 'bandpass', 250, 5, g);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.9, t + 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
  bp.frequency.setValueAtTime(250, t);
  bp.frequency.exponentialRampToValueAtTime(4500, t + 0.4);
  bp.frequency.exponentialRampToValueAtTime(700, t + 0.85);
  noiseNode(v, t, t + 0.87, bp);
  const sg = gainNode(v, 0, out);
  swell(sg.gain, t, 0.3, 0.1, 0.05, 0.4);
  const o = oscNode(v, 'sine', 200, t, t + 0.8, sg);
  o.frequency.setValueAtTime(200, t);
  o.frequency.exponentialRampToValueAtTime(1800, t + 0.45);
  o.frequency.exponentialRampToValueAtTime(600, t + 0.78);
  const lfo = oscNode(v, 'sine', 16, t, t + 0.8, null);
  lfo.connect(gainNode(v, 80, o.detune));
  for (let i = 0; i < 3; i++) ping(v, t + 0.38 + i * 0.06, mtof(pick([88, 91, 95, 100])), 0.06, 0.3, out);
}

function sHorn(v, t, out) {
  wet(v, 0.45);
  const f0 = 98; // G2
  const end = t + 1.2;
  const stop = t + 1.62;
  const g = gainNode(v, 0, out);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.55, t + 0.22);
  g.gain.linearRampToValueAtTime(0.45, t + 0.55);
  g.gain.setValueAtTime(0.45, end);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  const lp = biquad(v, 'lowpass', 220, 1.8, g);
  lp.frequency.setValueAtTime(220, t);
  lp.frequency.linearRampToValueAtTime(1100, t + 0.25);
  lp.frequency.exponentialRampToValueAtTime(800, t + 0.9);
  lp.frequency.setValueAtTime(800, end);
  lp.frequency.exponentialRampToValueAtTime(250, t + 1.55);
  const mk = (mult, det, lvl) => {
    const f = f0 * mult;
    const o = oscNode(v, 'sawtooth', f, t, stop, gainNode(v, lvl, lp));
    o.detune.value = det;
    o.frequency.setValueAtTime(f * 0.9, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.2);
    o.frequency.setValueAtTime(f, end);
    o.frequency.exponentialRampToValueAtTime(f * 0.95, t + 1.55);
    return o;
  };
  const oscs = [mk(1, -6, 0.5), mk(1, 6, 0.5), mk(1.5, 0, 0.28), mk(0.5, 0, 0.3)];
  const lfo = oscNode(v, 'sine', 4.5, t, stop, null);
  const lg = gainNode(v, 0, null);
  lfo.connect(lg);
  for (const o of oscs) lg.connect(o.detune);
  lg.gain.setValueAtTime(0, t + 0.4);
  lg.gain.linearRampToValueAtTime(10, t + 0.8);
  // breath
  const ng = gainNode(v, 0, out);
  swell(ng.gain, t, 0.15, 0.06, 0.9, 0.4);
  noiseNode(v, t, t + 1.5, biquad(v, 'bandpass', 600, 0.8, ng));
}

function sWarning(v, t, out) {
  wet(v, 0.4);
  // alarm bell rung three times
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.24;
    fmBell(v, tt, 880, 1.41, 520, 0.22, 0.6, out);
    ping(v, tt, 440, 0.09, 0.7, out);
  }
}

function sVictory(v, t, out) {
  wet(v, 0.35);
  duckMusic(t, 3.4);
  const B = (dt, m, dur, pk, vib) => brass(v, t + dt, mtof(m), dur, pk, out, vib);
  B(0.0, 67, 0.13, 0.2);
  B(0.15, 72, 0.13, 0.2);
  B(0.3, 76, 0.13, 0.2);
  B(0.45, 79, 0.38, 0.22, true);
  B(0.45, 76, 0.38, 0.1);
  B(0.9, 76, 0.13, 0.2);
  B(1.05, 79, 0.13, 0.2);
  // final C major chord
  B(1.25, 84, 1.45, 0.22, true);
  B(1.25, 79, 1.45, 0.12, true);
  B(1.25, 76, 1.45, 0.11);
  B(1.25, 72, 1.45, 0.11);
  B(1.25, 48, 1.45, 0.12);
  timpani(v, t, 65.4, 0.5, out);
  timpani(v, t + 0.45, 98, 0.4, out);
  for (let i = 0; i < 5; i++) timpani(v, t + 0.98 + i * 0.05, 65.4, 0.12 + i * 0.05, out);
  timpani(v, t + 1.25, 65.4, 0.7, out);
  noiseBurst(v, t + 1.25, { type: 'highpass', freq: 5000, a: 0.005, peak: 0.18, d: 1.6, dest: out });
}

function sDefeat(v, t, out) {
  wet(v, 0.45);
  duckMusic(t, 3.4);
  const L = (dt, m, dur, pk) => brass(v, t + dt, mtof(m), dur, pk, out, true, 0.45);
  L(0.0, 69, 0.4, 0.17); // A4
  L(0.45, 67, 0.4, 0.17); // G4
  L(0.9, 65, 0.4, 0.17); // F4
  L(1.35, 64, 0.55, 0.17); // E4
  L(2.0, 57, 1.0, 0.19); // A3
  pad(v, t, [53, 57, 60], 0.9, 0.05, out); // F
  pad(v, t + 0.9, [50, 53, 57], 0.45, 0.05, out); // Dm
  pad(v, t + 1.35, [52, 56, 59], 0.65, 0.05, out); // E
  pad(v, t + 2.0, [45, 52, 57, 60], 1.1, 0.06, out); // Am
  timpani(v, t, 55, 0.3, out);
  timpani(v, t + 2.0, 55, 0.5, out);
  fmBell(v, t + 2.0, 110, 1.4, 90, 0.12, 1.4, out); // distant gong
}

function sBladestorm(v, t, out) {
  const dur = 1.1;
  const stop = t + dur + 0.05;
  const rate = rand(6.5, 8);
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.15, 0.7, dur - 0.45, 0.3);
  const am = gainNode(v, 0.5, g);
  const bp = biquad(v, 'bandpass', 1400, 2.5, am);
  const lfo = oscNode(v, 'sine', rate, t, stop, null);
  lfo.connect(gainNode(v, 900, bp.frequency));
  lfo.connect(gainNode(v, 0.45, am.gain));
  noiseNode(v, t, stop, bp);
  // blades ringing, tremolo'd by the same rotation
  const rg = gainNode(v, 0, g);
  lfo.connect(gainNode(v, 0.05, rg.gain));
  oscNode(v, 'sine', 2600, t, stop, rg);
  oscNode(v, 'sine', 3710, t, stop, rg);
}

function sRoar(v, t, out) {
  wet(v, 0.35);
  const p = rand(0.92, 1.06);
  const stop = t + 1.65;
  const g = gainNode(v, 0, out);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.8, t + 0.12);
  g.gain.linearRampToValueAtTime(0.65, t + 0.7);
  g.gain.setValueAtTime(0.65, t + 1.0);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  const lp = biquad(v, 'lowpass', 350, 4, g);
  lp.frequency.setValueAtTime(350, t);
  lp.frequency.exponentialRampToValueAtTime(1700, t + 0.3);
  lp.frequency.exponentialRampToValueAtTime(1100, t + 1.0);
  lp.frequency.exponentialRampToValueAtTime(260, t + 1.55);
  const am = gainNode(v, 0.65, lp); // growl amplitude modulation
  const drive = gainNode(v, 1.6, shaper(v, am));
  const f0 = 68 * p;
  const voice = (type, m, det) => {
    const o = oscNode(v, type, f0 * m, t, stop, drive);
    o.detune.value = det;
    o.frequency.setValueAtTime(f0 * m * 0.75, t);
    o.frequency.exponentialRampToValueAtTime(f0 * m * 1.2, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(f0 * m, t + 1.0);
    o.frequency.exponentialRampToValueAtTime(f0 * m * 0.7, t + 1.55);
    return o;
  };
  const oscs = [voice('sawtooth', 1, 0), voice('sawtooth', 1.5, 18), voice('square', 0.5, 0)];
  const vib = oscNode(v, 'sine', 6.5, t, stop, null);
  const vg = gainNode(v, 40, null);
  vib.connect(vg);
  for (const o of oscs) vg.connect(o.detune);
  const growl = oscNode(v, 'triangle', 31, t, stop, null);
  growl.connect(gainNode(v, 0.35, am.gain));
  noiseNode(v, t, stop, biquad(v, 'bandpass', 700, 0.8, gainNode(v, 0.9, drive)));
}

/**
 * Registry. prio: higher = more important (may steal lower voices when the
 * voice pool is full). max / gap override the per-name throttle. gain scales
 * the whole effect.
 */
const SFX = {
  swordHit: { fn: sSwordHit, prio: 0 },
  heavyHit: { fn: sHeavyHit, prio: 0 },
  arrowShoot: { fn: sArrowShoot, prio: 0, gain: 1.2 },
  arrowHit: { fn: sArrowHit, prio: 0 },
  magicCast: { fn: sMagicCast, prio: 1 },
  magicHit: { fn: sMagicHit, prio: 0, gain: 1.4 },
  heal: { fn: sHeal, prio: 1 },
  explosion: { fn: sExplosion, prio: 1 },
  fire: { fn: sFire, prio: 1 },
  frost: { fn: sFrost, prio: 1, gain: 1.4 },
  thunder: { fn: sThunder, prio: 1, max: 2 },
  stun: { fn: sStun, prio: 1, gain: 1.4 },
  build: { fn: sBuild, prio: 0, max: 3 },
  buildComplete: { fn: sBuildComplete, prio: 2, max: 2, gap: 0.15 },
  unitReady: { fn: sUnitReady, prio: 2, max: 2, gap: 0.12 },
  select: { fn: sSelect, prio: 3, max: 2, gap: 0.05, gain: 1.5 },
  click: { fn: sClick, prio: 3, max: 3, gain: 1.8 },
  error: { fn: sError, prio: 3, max: 1, gap: 0.2, gain: 0.45 },
  levelUp: { fn: sLevelUp, prio: 2, max: 2, gap: 0.15 },
  death: { fn: sDeath, prio: 0, gain: 0.55 },
  gold: { fn: sGold, prio: 1, max: 3, gap: 0.06 },
  buy: { fn: sBuy, prio: 3, max: 2 },
  chop: { fn: sChop, prio: 0 },
  teleport: { fn: sTeleport, prio: 2, max: 2 },
  horn: { fn: sHorn, prio: 3, max: 1, gap: 1 },
  warning: { fn: sWarning, prio: 3, max: 1, gap: 0.8 },
  victory: { fn: sVictory, prio: 4, max: 1, gap: 2 },
  defeat: { fn: sDefeat, prio: 4, max: 1, gap: 2 },
  bladestorm: { fn: sBladestorm, prio: 1, max: 2, gap: 0.3 },
  roar: { fn: sRoar, prio: 3, max: 1, gap: 0.8, gain: 0.85 },
};

/**
 * Fire-and-forget sound effect. `volume` (0..1) is typically distance
 * attenuation from the game. Unknown names, a muted / uninitialized context
 * and throttled calls are silently ignored.
 */
export function playSfx(name, volume = 1) {
  if (muted || !canPlay()) return;
  const def = Object.prototype.hasOwnProperty.call(SFX, name) ? SFX[name] : null;
  if (!def) return;
  const vol = toUnit(volume, 1);
  if (vol < 0.01) return;

  const now = ctx.currentTime;
  let st = nameStats.get(name);
  if (!st) {
    st = { count: 0, last: -1e9 };
    nameStats.set(name, st);
  }
  if (now - st.last < (def.gap != null ? def.gap : MIN_GAP)) return;
  if (st.count >= (def.max != null ? def.max : MAX_PER_NAME)) return;
  if (voices.length >= MAX_VOICES && !stealVoice(def.prio)) return;

  const out = ctx.createGain();
  out.gain.value = vol * (def.gain != null ? def.gain : 1);
  out.connect(sfxGain);
  const v = makeVoice(name, def.prio, out, st);
  v.counted = true;
  st.count++;
  st.last = now;
  voices.push(v);

  const t = now + START_DELAY;
  try {
    def.fn(v, t, out);
  } catch {
    for (const s of v.sources) {
      try {
        s.stop();
      } catch {
        /* ignore */
      }
    }
    finishVoice(v);
    return;
  }
  if (v.pending <= 0) {
    finishVoice(v);
    return;
  }
  // Safety net in case `onended` never fires (e.g. the context gets suspended).
  v.timer = setTimeout(() => finishVoice(v), (v.end - now + 1) * 1000);
}

// ---------------------------------------------------------------------------
// Procedural music: D dorian, 3/4, lute arpeggios over a hurdy-gurdy drone,
// a sparse recorder melody, soft pads and a frame drum. Notes are scheduled
// ahead on the AudioContext clock by a 100 ms lookahead scheduler.
// ---------------------------------------------------------------------------

const STEP = 0.3; // one eighth note (quarter = 100 bpm)
const STEPS_PER_BAR = 6; // 3/4
const STEPS_PER_CHORD = 12; // two bars per chord
const STEPS_PER_CYCLE = 48; // four chords per progression
const LOOKAHEAD = 0.35;
const SCALE = [0, 2, 3, 5, 7, 9, 10]; // dorian
const TONIC = 62; // D4

/** Root scale degrees (0 = D). Triads are [r, r+2, r+4] within the mode. */
const PROGS = [
  [0, -1, 3, 0], // Dm  C  G  Dm
  [2, -1, 0, 0], // F   C  Dm Dm
  [0, 3, 0, -1], // Dm  G  Dm C
  [2, 3, 0, -3], // F   G  Dm Am
  [0, -1, 2, 3], // Dm  C  F  G
];

/** Lute arpeggio patterns, degree offsets from the chord root (null = rest). */
const ARPS = [
  [-7, -3, 0, 2, 4, 2],
  [-7, 0, 2, 4, 7, 4],
  [-7, -3, 0, -3, 2, 0],
  [-7, null, 0, 4, 2, null],
  [-7, 2, 4, 7, 4, 2],
];
const ARP_VEL = [1, 0.55, 0.7, 0.55, 0.65, 0.5];

/** Melody rhythms over two bars: [onset step, length in steps]. */
const RHYTHMS = [
  [[0, 3], [3, 1], [4, 2], [6, 4], [10, 2]],
  [[0, 2], [2, 2], [4, 2], [6, 6]],
  [[0, 4], [4, 1], [5, 1], [6, 3], [9, 3]],
  [[0, 6], [6, 2], [8, 2], [10, 2]],
  [[3, 1], [4, 2], [6, 2], [8, 4]],
  [[0, 2], [2, 1], [3, 3], [6, 2], [8, 1], [9, 3]],
];
const MEL_LO = 3; // G4
const MEL_HI = 12; // B5

function degMidi(d) {
  const o = Math.floor(d / 7);
  return TONIC + o * 12 + SCALE[d - o * 7];
}

const music = {
  wanted: false,
  on: false,
  bus: null,
  timer: null,
  step: 0,
  nextTime: 0,
  persistent: [],
  cycle: -1,
  lastProg: -1,
  prog: PROGS[0],
  flags: null,
  melody: null,
};

function isChordTone(d, root) {
  const r = (((d - root) % 7) + 7) % 7;
  return r === 0 || r === 2 || r === 4;
}

function genMelody(prog) {
  const ev = new Map();
  const rA = pick(RHYTHMS);
  const rB = pick(RHYTHMS);
  const plan = [rA, rB, rA, pick(RHYTHMS)];
  let prev = 7 + pick([0, 2, 4]);
  for (let c = 0; c < 4; c++) {
    const root = prog[c];
    const rh = plan[c];
    rh.forEach(([on, len], k) => {
      const last = c === 3 && k === rh.length - 1;
      let deg;
      // 3/4: downbeats always land on a chord tone, other quarter beats often do
      const strong = on % STEPS_PER_BAR === 0 || (on % 2 === 0 && Math.random() < 0.5);
      if (last || strong) {
        // nearest chord tone (or the root to end the phrase)
        const cands = [];
        for (let d = MEL_LO; d <= MEL_HI; d++) {
          if (last ? (((d - root) % 7) + 7) % 7 === 0 : isChordTone(d, root)) cands.push(d);
        }
        cands.sort((x, y) => Math.abs(x - prev) - Math.abs(y - prev));
        deg = cands.length > 1 && !last && Math.random() < 0.3 ? cands[1] : cands[0];
      } else {
        deg = prev + pick([-1, 1, 1, -1, 2, -2]);
        if (deg < MEL_LO) deg = MEL_LO + 1;
        if (deg > MEL_HI) deg = MEL_HI - 1;
      }
      ev.set(c * STEPS_PER_CHORD + on, { deg, len: last ? Math.max(len, STEPS_PER_CHORD - on) : len });
      prev = deg;
    });
  }
  return ev;
}

function newCycle(cyc) {
  music.cycle = cyc;
  let pi = 0;
  if (cyc > 0) {
    do pi = (Math.random() * PROGS.length) | 0;
    while (pi === music.lastProg);
  }
  music.lastProg = pi;
  music.prog = PROGS[pi];
  const intro = cyc === 0;
  music.flags = {
    melody: !intro && Math.random() < 0.7,
    drums: !intro && Math.random() < 0.65,
    arp: [pick(ARPS), pick(ARPS)],
    density: intro ? 0.75 : rand(0.8, 1),
  };
  music.melody = music.flags.melody ? genMelody(music.prog) : null;
}

function musicVoice() {
  return makeVoice('music', 0, null, null);
}

function mPluck(t, midi, vel) {
  const v = musicVoice();
  const f = mtof(midi);
  const dur = 1.1;
  const g = gainNode(v, 0, music.bus);
  perc(g.gain, t, 0.003, 0.13 * vel, dur);
  const lp = biquad(v, 'lowpass', f * 8, 1.5, g);
  sweep(lp.frequency, t, Math.min(f * 8, 7000), Math.max(f * 1.2, 200), 0.35);
  // lute strings come in pairs (courses): two slightly detuned saws
  oscNode(v, 'sawtooth', f, t, t + dur + 0.01, lp);
  oscNode(v, 'sawtooth', f, t, t + dur + 0.01, lp).detune.value = 5;
}

function mFlute(t, midi, len) {
  const v = musicVoice();
  const f = mtof(midi);
  const dur = len * STEP * 0.95;
  const peak = 0.085;
  const g = gainNode(v, 0, music.bus);
  const G = g.gain;
  const dk = t + Math.min(0.2, dur);
  G.setValueAtTime(0, t);
  G.linearRampToValueAtTime(peak, t + 0.05);
  G.linearRampToValueAtTime(peak * 0.8, dk);
  G.setValueAtTime(peak * 0.8, Math.max(dk, t + dur));
  G.exponentialRampToValueAtTime(0.0001, Math.max(dk, t + dur) + 0.18);
  const stop = Math.max(dk, t + dur) + 0.2;
  const lp = biquad(v, 'lowpass', 2400, 0.5, g);
  const o = oscNode(v, 'triangle', f, t, stop, lp);
  oscNode(v, 'sine', f * 2, t, stop, gainNode(v, 0.15, lp));
  if (dur > 0.5) {
    const lfo = oscNode(v, 'sine', 5, t, stop, null);
    const lg = gainNode(v, 0, o.detune);
    lfo.connect(lg);
    lg.gain.setValueAtTime(0, t + 0.25);
    lg.gain.linearRampToValueAtTime(10, t + 0.6);
  }
}

function mPad(t, midis, dur) {
  const v = musicVoice();
  const g = gainNode(v, 0, music.bus);
  swell(g.gain, t, 0.9, 0.035, dur - 0.9, 1.2);
  const lp = biquad(v, 'lowpass', 750, 0.7, g);
  for (const m of midis) oscNode(v, 'triangle', mtof(m), t, t + dur + 1.25, lp);
}

function mDoum(t, vel) {
  const v = musicVoice();
  thump(v, t, 120, 62, 0.22 * vel, 0.3, music.bus);
  noiseBurst(v, t, { type: 'lowpass', freq: 350, a: 0.002, peak: 0.08 * vel, d: 0.08, dest: music.bus });
}

function mTek(t, vel) {
  const v = musicVoice();
  noiseBurst(v, t, { type: 'bandpass', freq: 2600, Q: 1.4, a: 0.001, peak: 0.07 * vel, d: 0.045, dest: music.bus });
  ping(v, t, 520, 0.03 * vel, 0.03, music.bus);
}

function scheduleStep(step, t, silent) {
  const cyc = Math.floor(step / STEPS_PER_CYCLE);
  if (cyc !== music.cycle) newCycle(cyc);
  if (silent) return;
  const s = step % STEPS_PER_CYCLE;
  const root = music.prog[Math.floor(s / STEPS_PER_CHORD)];
  const inChord = s % STEPS_PER_CHORD;
  const bar = Math.floor(inChord / STEPS_PER_BAR);
  const sb = s % STEPS_PER_BAR;
  const f = music.flags;
  const hum = () => (Math.random() - 0.5) * 0.012;

  if (inChord === 0) mPad(t, [root - 7, root - 5, root - 3].map(degMidi), STEPS_PER_CHORD * STEP);

  const off = f.arp[bar][sb];
  if (off !== null && (sb === 0 || Math.random() < f.density)) {
    mPluck(t + (sb === 0 ? 0 : hum()), degMidi(root + off), ARP_VEL[sb] * rand(0.85, 1.1));
  }

  if (music.melody) {
    const ev = music.melody.get(s);
    if (ev) mFlute(t + hum(), degMidi(ev.deg), ev.len);
  }

  if (f.drums) {
    if (sb === 0) mDoum(t, bar === 0 ? 1 : 0.8);
    else if (sb === 3 && Math.random() < 0.35) mDoum(t, 0.5);
    else if ((sb === 2 || sb === 4) && Math.random() < 0.75) mTek(t, sb === 4 ? 0.8 : 0.6);
    else if (sb === 5 && bar === 1 && Math.random() < 0.4) mTek(t, 0.5);
  }
}

function musicTick() {
  if (!ctx || !music.on) return;
  const now = ctx.currentTime;
  // If we fell behind (throttled background tab), skip the missed steps
  // instead of firing them all at once.
  if (music.nextTime < now - 0.05) {
    const behind = Math.ceil((now - music.nextTime) / STEP);
    music.step += behind;
    music.nextTime += behind * STEP;
  }
  const hidden = typeof document !== 'undefined' && document.hidden;
  const horizon = now + (hidden ? 1.5 : LOOKAHEAD);
  while (music.nextTime < horizon) {
    try {
      scheduleStep(music.step, music.nextTime, muted);
    } catch {
      /* never let a music glitch break the game loop */
    }
    music.step++;
    music.nextTime += STEP;
  }
}

function beginMusic() {
  music.on = true;
  const t = ctx.currentTime + 0.05;
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0, t);
  bus.gain.linearRampToValueAtTime(1, t + 3);
  bus.connect(musicGain);
  music.bus = bus;

  // Drone: low D + A fifth, like a hurdy-gurdy, with a slowly breathing filter.
  const dg = ctx.createGain();
  dg.gain.value = 0.05;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 280;
  lp.Q.value = 0.8;
  lp.connect(dg);
  dg.connect(bus);
  const nodes = [dg, lp];
  const srcs = [];
  for (const [midi, det] of [[38, -4], [38, 5], [45, 0]]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(midi);
    o.detune.value = det;
    o.connect(lp);
    srcs.push(o);
  }
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 90;
  lfo.connect(lfoGain);
  lfoGain.connect(lp.frequency);
  srcs.push(lfo);
  nodes.push(lfoGain);
  for (const s of srcs) s.start(t);
  music.persistent = { nodes: nodes.concat(srcs), srcs };

  music.step = 0;
  music.cycle = -1;
  music.nextTime = t + 0.1;
  music.timer = setInterval(musicTick, 100);
  musicTick();
}

/** Start the endless procedural background music (deferred until initAudio). */
export function startMusic() {
  music.wanted = true;
  if (!ctx || music.on) return;
  beginMusic();
}

/** Stop scheduling new notes and fade the music out. */
export function stopMusic() {
  music.wanted = false;
  if (!music.on) return;
  music.on = false;
  if (music.timer) clearInterval(music.timer);
  music.timer = null;
  const bus = music.bus;
  const pers = music.persistent;
  music.bus = null;
  music.persistent = [];
  if (!ctx || !bus) return;
  const t = ctx.currentTime;
  const fade = 1.5;
  bus.gain.cancelScheduledValues(t);
  bus.gain.setValueAtTime(bus.gain.value, t);
  bus.gain.linearRampToValueAtTime(0, t + fade);
  for (const s of pers.srcs || []) {
    try {
      s.stop(t + fade + 0.05);
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => {
    for (const n of (pers.nodes || []).concat(bus)) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
  }, (fade + 2) * 1000);
}
