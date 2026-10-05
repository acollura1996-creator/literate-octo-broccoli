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

import type { UnitDef } from './data/types.ts';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const MAX_VOICES = 24; // simultaneously active sfx voices
const MAX_PER_NAME = 4; // overlapping instances of the same effect
const MIN_GAP = 0.04; // seconds between two starts of the same effect
const START_DELAY = 0.005; // tiny scheduling offset so envelopes start cleanly

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A unit acknowledging the player, Warcraft III style. */
export type BarkKind = 'select' | 'move' | 'attack';

/** Where a node's output goes: another node, or a parameter it modulates. */
type Dest = AudioNode | AudioParam;

/** Per-name throttle state: voices playing and the last start time. */
interface NameStats {
  count: number;
  last: number;
}

/** One playing sound: every node it created, so all of them can be disconnected when its sources end. */
interface Voice {
  name: string;
  prio: number;
  /** The sound's output gain (null for music notes, which write straight to the music bus). */
  out: GainNode | null;
  stats: NameStats | null;
  start: number;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  /** Sources that haven't ended yet. */
  pending: number;
  /** When the last source stops (context time). */
  end: number;
  /** Counted in `voices` and its name's stats. */
  counted: boolean;
  done: boolean;
  timer: ReturnType<typeof setTimeout> | 0;
}

/** A sound: schedules its nodes on voice `v` from time `t` into `out`. */
type SfxFn = (v: Voice, t: number, out: GainNode) => void;
/** A sound rendered offline: an SfxFn, or an ambient loop filling `dur` seconds (0 for one-shots). */
type RenderFn = (v: Voice, t: number, out: GainNode, dur: number) => void;

/** Voice-pool priority and per-name limits (see startVoice). */
interface Throttle {
  prio: number;
  max?: number;
  gap?: number;
  gain?: number;
}

interface SfxDef extends Throttle {
  fn: SfxFn;
  /** Seconds to lower the music for (fanfares). */
  duck?: number;
}

/** Options of noiseBurst. */
interface BurstOptions {
  type?: BiquadFilterType;
  freq: number;
  Q?: number;
  freqTo?: number;
  sweep?: number;
  a?: number;
  peak?: number;
  d?: number;
  dest: Dest | null;
  rate?: number;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The live context, or an OfflineAudioContext while a sound is rendered (see buildOffline). */
let ctx: AudioContext | OfflineAudioContext | null = null;
let compressor: DynamicsCompressorNode | null = null;
let masterGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let musicDuck: GainNode | null = null;
let reverbIn: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let distCurve: Float32Array<ArrayBuffer> | null = null;

let muted = false;
let masterVolume = 0.6;
let musicVolume = 0.35;
let resumeRequestedAt = -1e9;
/** Set when a sound sends to the reverb (lets the offline renderer skip the reverb when unused). */
let wetUsed = false;

/** Active, counted sfx voices in start order (oldest first). */
const voices: Voice[] = [];
const nameStats = new Map<string, NameStats>();

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/**
 * The random source of every synth. It is swapped for a seeded generator while a sound is rendered
 * offline, so a variant can be measured and then rendered identically (see renderOffline).
 */
let rnd = Math.random;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const rand = (a: number, b: number): number => a + rnd() * (b - a);
const pick = <T>(arr: readonly T[]): T => arr[(rnd() * arr.length) | 0]!;
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function toUnit(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? clamp01(n) : fallback;
}

// ---------------------------------------------------------------------------
// Context / graph setup
// ---------------------------------------------------------------------------

function makeNoiseBuffer(seconds: number): AudioBuffer {
  const ac = ctx!;
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
  return buf;
}

/** Stereo, slightly darkening, exponentially decaying noise = cheap hall reverb. */
function makeImpulse(seconds: number, decay: number): AudioBuffer {
  const ac = ctx!;
  const sr = ac.sampleRate;
  const len = Math.floor(sr * seconds);
  const pre = Math.floor(sr * 0.012);
  const buf = ac.createBuffer(2, len, sr);
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
      lp += (rnd() * 2 - 1 - lp) * k;
      d[i] = lp * Math.pow(1 - x, decay);
    }
  }
  return buf;
}

function makeDistCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  const norm = Math.tanh(amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(amount * x) / norm;
  }
  return c;
}

function buildGraph(): void {
  const ac = ctx!;
  compressor = ac.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 12;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.2;

  masterGain = ac.createGain();
  masterGain.gain.value = muted ? 0 : masterVolume;
  compressor.connect(masterGain);
  masterGain.connect(ac.destination);

  sfxGain = ac.createGain();
  sfxGain.gain.value = 0.9;
  sfxGain.connect(compressor);

  reverbIn = ac.createGain();
  const conv = ac.createConvolver();
  conv.buffer = makeImpulse(1.8, 2.6);
  const revOut = ac.createGain();
  revOut.gain.value = 0.55;
  reverbIn.connect(conv);
  conv.connect(revOut);
  revOut.connect(compressor);

  musicGain = ac.createGain();
  musicGain.gain.value = musicVolume;
  musicDuck = ac.createGain();
  musicGain.connect(musicDuck);
  musicDuck.connect(compressor);
  const musicWet = ac.createGain();
  musicWet.gain.value = 0.45;
  musicDuck.connect(musicWet);
  musicWet.connect(reverbIn);

  noiseBuf = makeNoiseBuffer(2);
  distCurve = makeDistCurve(2.5);

  // Older iOS only unlocks output once something is played inside a gesture.
  try {
    const s = ac.createBufferSource();
    s.buffer = ac.createBuffer(1, 1, ac.sampleRate);
    s.connect(ac.destination);
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
export function initAudio(): boolean {
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
function canPlay(): boolean {
  if (!ctx) return false;
  if (ctx.state === 'running') return true;
  return ctx.state === 'suspended' && nowMs() - resumeRequestedAt < 600;
}

// ---------------------------------------------------------------------------
// Volume / mute
// ---------------------------------------------------------------------------

export function setMuted(m: boolean): void {
  muted = !!m;
  if (ctx && masterGain) {
    masterGain.gain.setTargetAtTime(muted ? 0 : masterVolume, ctx.currentTime, 0.015);
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMasterVolume(v: number): void {
  masterVolume = toUnit(v, masterVolume);
  if (ctx && masterGain && !muted) {
    masterGain.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.02);
  }
}

export function setMusicVolume(v: number): void {
  musicVolume = toUnit(v, musicVolume);
  if (ctx && musicGain) musicGain.gain.setTargetAtTime(musicVolume, ctx.currentTime, 0.05);
}

/** Temporarily lower the music (victory / defeat stingers). */
function duckMusic(t: number, dur: number, level = 0.25): void {
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

function makeVoice(name: string, prio: number, out: GainNode | null, stats: NameStats | null): Voice {
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

function releaseCounts(v: Voice): void {
  if (!v.counted) return;
  v.counted = false;
  if (v.stats) v.stats.count--;
  const i = voices.indexOf(v);
  if (i >= 0) voices.splice(i, 1);
}

function finishVoice(v: Voice): void {
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
function killVoice(v: Voice): void {
  releaseCounts(v);
  if (!ctx || v.done) return;
  const t = ctx.currentTime;
  try {
    v.out!.gain.cancelScheduledValues(t);
    v.out!.gain.setTargetAtTime(0, t, 0.01);
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
function stealVoice(prio: number): boolean {
  const ac = ctx!;
  const now = ac.currentTime;
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

/** Connect `src` to a node, or let it modulate a parameter. */
function connectTo(src: AudioNode, dest: Dest): void {
  if (dest instanceof AudioParam) src.connect(dest);
  else src.connect(dest);
}

function track<T extends AudioNode>(v: Voice, n: T): T {
  v.nodes.push(n);
  return n;
}

function gainNode(v: Voice, value: number, dest: Dest | null): GainNode {
  const ac = ctx!;
  const g = ac.createGain();
  g.gain.value = value;
  if (dest) connectTo(g, dest);
  return track(v, g);
}

function biquad(v: Voice, type: BiquadFilterType, freq: number, Q: number | null | undefined, dest: Dest | null): BiquadFilterNode {
  const ac = ctx!;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (Q != null) f.Q.value = Q;
  if (dest) connectTo(f, dest);
  return track(v, f);
}

function shaper(v: Voice, dest: AudioNode): WaveShaperNode {
  const ac = ctx!;
  const ws = ac.createWaveShaper();
  ws.curve = distCurve;
  ws.oversample = 'none';
  ws.connect(dest);
  return track(v, ws);
}

function runSource<T extends AudioScheduledSourceNode>(v: Voice, src: T, t0: number, t1: number, offset?: number): T {
  v.pending++;
  v.sources.push(src);
  src.onended = () => {
    v.pending--;
    if (v.pending <= 0) finishVoice(v);
  };
  if (offset != null && src instanceof AudioBufferSourceNode) src.start(t0, offset);
  else src.start(t0);
  src.stop(t1);
  if (t1 > v.end) v.end = t1;
  return track(v, src);
}

function oscNode(v: Voice, type: OscillatorType, freq: number, t0: number, t1: number, dest: Dest | null): OscillatorNode {
  const ac = ctx!;
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  if (dest) connectTo(o, dest);
  return runSource(v, o, t0, t1);
}

function noiseNode(v: Voice, t0: number, t1: number, dest: AudioNode, rate = 1): AudioBufferSourceNode {
  const ac = ctx!;
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  if (rate !== 1) s.playbackRate.value = rate;
  s.connect(dest);
  return runSource(v, s, t0, t1, rnd() * (noiseBuf!.duration - 0.05));
}

/** Send part of a voice to the shared reverb. */
function wet(v: Voice, amount: number): void {
  wetUsed = true;
  if (!reverbIn) return;
  const g = gainNode(v, amount, reverbIn);
  v.out!.connect(g);
}

// --- envelope helpers -------------------------------------------------------

/** 0 -> peak (linear, `a` s) -> ~0 (exponential, `d` s). */
function perc(param: AudioParam, t: number, a: number, peak: number, d: number): number {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.exponentialRampToValueAtTime(0.0001, t + a + d);
  return t + a + d;
}

/** 0 -> peak (linear, `a`), hold, -> ~0 (exponential, `r`). */
function swell(param: AudioParam, t: number, a: number, peak: number, hold: number, r: number): number {
  const h = t + a + Math.max(0, hold);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setValueAtTime(peak, h);
  param.exponentialRampToValueAtTime(0.0001, h + r);
  return h + r;
}

function sweep(param: AudioParam, t: number, from: number, to: number, dur: number): void {
  param.setValueAtTime(from, t);
  param.exponentialRampToValueAtTime(to, t + dur);
}

// --- building blocks --------------------------------------------------------

/** Filtered white-noise burst. o: {type,freq,Q,freqTo,sweep,a,peak,d,dest,rate} */
function noiseBurst(v: Voice, t: number, o: BurstOptions): { f: BiquadFilterNode; g: GainNode } {
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
function ping(v: Voice, t: number, f: number, peak: number, decay: number, dest: Dest | null, type: OscillatorType = 'sine', attack = 0.002): OscillatorNode {
  const g = gainNode(v, 0, dest);
  perc(g.gain, t, attack, peak, decay);
  return oscNode(v, type, f, t, t + attack + decay + 0.01, g);
}

/** Inharmonic struck-metal partials. */
function metal(v: Voice, t: number, base: number, ratios: number[], amps: number[], decays: number[], dest: Dest): void {
  for (let i = 0; i < ratios.length; i++) {
    ping(v, t, base * ratios[i]! * rand(0.995, 1.005), amps[i]!, decays[i]!, dest, 'sine', 0.0008);
  }
}

/** Two-operator FM bell. */
function fmBell(v: Voice, t: number, f: number, ratio: number, index: number, peak: number, decay: number, dest: Dest): void {
  const g = gainNode(v, 0, dest);
  perc(g.gain, t, 0.002, peak, decay);
  const car = oscNode(v, 'sine', f, t, t + decay + 0.02, g);
  const mg = gainNode(v, 0, car.frequency);
  perc(mg.gain, t, 0.001, index, decay * 0.6);
  oscNode(v, 'sine', f * ratio, t, t + decay + 0.02, mg);
}

/** Soft harmonic chime (fundamental + octave + 3rd harmonic). */
function chime(v: Voice, t: number, f: number, peak: number, decay: number, dest: Dest): void {
  ping(v, t, f, peak, decay, dest);
  ping(v, t, f * 2, peak * 0.3, decay * 0.5, dest);
  ping(v, t, f * 3.01, peak * 0.12, decay * 0.3, dest);
}

/** Two detuned saws through an enveloped low-pass: a cheap brass note. */
function brass(v: Voice, t: number, f: number, dur: number, peak: number, dest: Dest, vib = false, bright = 1): void {
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
function pad(v: Voice, t: number, midis: number[], dur: number, peak: number, dest: Dest): void {
  const g = gainNode(v, 0, dest);
  const lp = biquad(v, 'lowpass', 900, 0.7, g);
  swell(g.gain, t, 0.12, peak, dur - 0.12, 0.5);
  for (const m of midis) {
    const o = oscNode(v, 'sawtooth', mtof(m), t, t + dur + 0.55, lp);
    o.detune.value = rand(-6, 6);
  }
}

function timpani(v: Voice, t: number, f: number, peak: number, dest: Dest): void {
  const g = gainNode(v, 0, dest);
  perc(g.gain, t, 0.003, peak, 0.9);
  const o = oscNode(v, 'sine', f, t, t + 0.95, g);
  sweep(o.frequency, t, f * 1.08, f, 0.08);
  ping(v, t, f * 1.5, peak * 0.35, 0.4, dest);
  noiseBurst(v, t, { type: 'lowpass', freq: 600, a: 0.001, peak: peak * 0.5, d: 0.07, dest });
}

/** Random tiny clicks from one noise source (fire / debris crackle). */
function crackle(v: Voice, t: number, dur: number, count: number, peak: number, hp: number, dest: Dest): void {
  const g = gainNode(v, 0, dest);
  const f = biquad(v, 'highpass', hp, 0.8, g);
  const times = [];
  for (let i = 0; i < count; i++) times.push(t + rnd() * dur);
  times.sort((x, y) => x - y);
  g.gain.setValueAtTime(0, t);
  for (const tt of times) {
    g.gain.setValueAtTime(peak * rand(0.3, 1), tt);
    g.gain.setTargetAtTime(0, tt, rand(0.002, 0.006));
  }
  noiseNode(v, t, t + dur + 0.05, f);
}

function thump(v: Voice, t: number, from: number, to: number, peak: number, decay: number, dest: Dest | null, type: OscillatorType = 'sine'): OscillatorNode {
  const g = gainNode(v, 0, dest);
  perc(g.gain, t, 0.002, peak, decay);
  const o = oscNode(v, type, from, t, t + decay + 0.03, g);
  sweep(o.frequency, t, from, to, Math.max(0.02, decay * 0.6));
  return o;
}

function coin(v: Voice, t: number, p: number, peak: number, dest: Dest): void {
  const base = 2350 * p;
  ping(v, t, base, peak, 0.25, dest, 'sine', 0.0008);
  ping(v, t, base * 2.32, peak * 0.5, 0.18, dest, 'sine', 0.0008);
  ping(v, t, base * 3.93, peak * 0.3, 0.1, dest, 'sine', 0.0008);
  noiseBurst(v, t, { type: 'highpass', freq: 5000, a: 0.0005, peak: peak * 0.6, d: 0.015, dest });
}

function knock(v: Voice, t: number, p: number, dest: Dest): void {
  noiseBurst(v, t, { type: 'bandpass', freq: 1100 * p, Q: 3, a: 0.001, peak: 0.8, d: 0.07, dest });
  thump(v, t, 240 * p, 140 * p, 0.5, 0.09, dest);
  noiseBurst(v, t, { type: 'bandpass', freq: 3800 * p, Q: 5, a: 0.0005, peak: 0.35, d: 0.025, dest });
}

// ---------------------------------------------------------------------------
// Sound effects. Each takes (voice, startTime, outputNode).
// ---------------------------------------------------------------------------

function sSwordHit(v: Voice, t: number, out: GainNode): void {
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

function sHeavyHit(v: Voice, t: number, out: GainNode): void {
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

function sArrowShoot(v: Voice, t: number, out: GainNode): void {
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

function sArrowHit(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.9, 1.15);
  thump(v, t, 300 * p, 90 * p, 0.6, 0.07, out);
  noiseBurst(v, t, { type: 'bandpass', freq: 1300 * p, Q: 2.5, a: 0.0005, peak: 0.6, d: 0.045, dest: out });
  noiseBurst(v, t, { type: 'lowpass', freq: 500, a: 0.001, peak: 0.4, d: 0.06, dest: out });
}

function sMagicCast(v: Voice, t: number, out: GainNode): void {
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

function sMagicHit(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.35);
  const p = rand(0.92, 1.1);
  noiseBurst(v, t, { type: 'bandpass', freq: 3200 * p, Q: 0.9, a: 0.001, peak: 0.5, d: 0.12, dest: out });
  fmBell(v, t, 880 * p, 3.5, 600, 0.22, 0.45, out);
  thump(v, t, 320 * p, 90 * p, 0.4, 0.12, out);
  for (let i = 0; i < 3; i++) {
    ping(v, t + 0.02 + rnd() * 0.15, rand(2200, 4800), 0.07, rand(0.12, 0.25), out);
  }
}

function sHeal(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.5);
  [72, 76, 79, 84, 88].forEach((m, i) => {
    const tt = t + i * 0.075;
    ping(v, tt, mtof(m), 0.13, 0.55, out, 'sine', 0.015);
    ping(v, tt, mtof(m + 12), 0.04, 0.3, out, 'triangle', 0.01);
  });
  noiseBurst(v, t, { type: 'highpass', freq: 6000, a: 0.25, peak: 0.05, d: 0.5, dest: out });
}

function sExplosion(v: Voice, t: number, out: GainNode): void {
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

function sFire(v: Voice, t: number, out: GainNode): void {
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

function sFrost(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.5);
  const scale = [88, 91, 93, 95, 98, 100, 103];
  for (let i = 0; i < 7; i++) {
    const tt = t + i * 0.055 + rnd() * 0.04;
    const f = mtof(pick(scale));
    const decay = rand(0.2, 0.45);
    ping(v, tt, f, rand(0.05, 0.1), decay, out, 'sine', 0.001);
    ping(v, tt, f * 2.76, 0.025, decay * 0.4, out, 'sine', 0.001);
  }
  noiseBurst(v, t, { type: 'highpass', freq: 7000, a: 0.05, peak: 0.12, d: 0.5, dest: out });
  noiseBurst(v, t, { type: 'bandpass', freq: 4500, Q: 2, a: 0.001, peak: 0.25, d: 0.05, dest: out });
}

function sThunder(v: Voice, t: number, out: GainNode): void {
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

function sStun(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.25);
  const p = rand(0.95, 1.05);
  thump(v, t, 750 * p, 180 * p, 0.55, 0.14, out, 'triangle');
  noiseBurst(v, t, { type: 'bandpass', freq: 1000, Q: 1.5, a: 0.001, peak: 0.4, d: 0.04, dest: out });
  // dizzy ringing: two close sines beat against each other
  ping(v, t + 0.02, 1568 * p, 0.08, 0.8, out);
  ping(v, t + 0.02, 1577 * p, 0.08, 0.8, out);
  ping(v, t + 0.02, 1568 * 2.42 * p, 0.03, 0.4, out);
}

function sBuild(v: Voice, t: number, out: GainNode): void {
  for (let i = 0; i < 3; i++) knock(v, t + i * 0.2 + rand(0, 0.03), rand(0.9, 1.1), out);
}

function sBuildComplete(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.3);
  brass(v, t, mtof(67), 0.11, 0.22, out); // G4
  brass(v, t + 0.13, mtof(72), 0.11, 0.22, out); // C5
  brass(v, t + 0.26, mtof(76), 0.55, 0.24, out, true); // E5
  brass(v, t + 0.26, mtof(60), 0.55, 0.12, out); // C4 under it
}

function sUnitReady(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.35);
  chime(v, t, mtof(76), 0.2, 0.6, out); // E5
  chime(v, t + 0.13, mtof(81), 0.2, 0.8, out); // A5
}

function sSelect(v: Voice, t: number, out: GainNode): void {
  const g = gainNode(v, 0, out);
  perc(g.gain, t, 0.002, 0.18, 0.06);
  const o = oscNode(v, 'sine', 820, t, t + 0.08, g);
  sweep(o.frequency, t, 820, 1250, 0.04);
}

function sClick(v: Voice, t: number, out: GainNode): void {
  noiseBurst(v, t, { type: 'bandpass', freq: 3000, Q: 1.2, a: 0.0005, peak: 0.35, d: 0.018, dest: out });
  thump(v, t, 1800, 1100, 0.25, 0.03, out, 'triangle');
}

function sError(v: Voice, t: number, out: GainNode): void {
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

function sLevelUp(v: Voice, t: number, out: GainNode): void {
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

function sDeath(v: Voice, t: number, out: GainNode): void {
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

function sGold(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.95, 1.08);
  coin(v, t, p, 0.18, out);
  coin(v, t + 0.07, p * 1.06, 0.14, out);
}

function sBuy(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.2);
  for (let i = 0; i < 5; i++) coin(v, t + i * 0.045 + rand(0, 0.02), rand(0.85, 1.15), 0.12, out);
  chime(v, t + 0.25, mtof(93), 0.13, 0.7, out); // "ka-ching"
  chime(v, t + 0.25, mtof(88), 0.08, 0.6, out);
}

function sChop(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.88, 1.12);
  noiseBurst(v, t, { type: 'bandpass', freq: 750 * p, Q: 1.8, a: 0.001, peak: 0.8, d: 0.09, dest: out });
  noiseBurst(v, t, { type: 'bandpass', freq: 2600 * p, Q: 2, a: 0.0005, peak: 0.35, d: 0.025, dest: out });
  thump(v, t, 200 * p, 95 * p, 0.55, 0.1, out);
}

function sTeleport(v: Voice, t: number, out: GainNode): void {
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

function sHorn(v: Voice, t: number, out: GainNode): void {
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
  const mk = (mult: number, det: number, lvl: number): OscillatorNode => {
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

function sWarning(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.4);
  // alarm bell rung three times
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.24;
    fmBell(v, tt, 880, 1.41, 520, 0.22, 0.6, out);
    ping(v, tt, 440, 0.09, 0.7, out);
  }
}

function sVictory(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.35);
  duckMusic(t, 3.4);
  const B = (dt: number, m: number, dur: number, pk: number, vib?: boolean): void => brass(v, t + dt, mtof(m), dur, pk, out, vib);
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

function sDefeat(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.45);
  duckMusic(t, 3.4);
  const L = (dt: number, m: number, dur: number, pk: number): void => brass(v, t + dt, mtof(m), dur, pk, out, true, 0.45);
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

function sBladestorm(v: Voice, t: number, out: GainNode): void {
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

function sRoar(v: Voice, t: number, out: GainNode): void {
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
  const voice = (type: OscillatorType, m: number, det: number): OscillatorNode => {
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

function sGunshot(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.85, 1.15);
  noiseBurst(v, t, { type: 'highpass', freq: 900 * p, Q: 0.7, a: 0.0005, peak: 0.9, d: 0.07, dest: out });
  noiseBurst(v, t, { type: 'lowpass', freq: 1400 * p, freqTo: 200, sweep: 0.12, Q: 0.7, a: 0.001, peak: 0.6, d: 0.18, dest: out });
  thump(v, t, 160 * p, 60, 0.5, 0.06, out);
}

function sCannon(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.25);
  const p = rand(0.85, 1.05);
  thump(v, t, 90 * p, 28, 1.0, 0.45, out);
  noiseBurst(v, t, { type: 'lowpass', freq: 1200 * p, freqTo: 80, sweep: 0.6, Q: 0.7, a: 0.002, peak: 0.95, d: 0.7, dest: out });
  noiseBurst(v, t, { type: 'bandpass', freq: 2600, Q: 0.9, a: 0.0005, peak: 0.4, d: 0.06, dest: out });
}

function sLaser(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.9, 1.1);
  const g = gainNode(v, 0, out);
  perc(g.gain, t, 0.002, 0.28, 0.2);
  const o = oscNode(v, 'sawtooth', 1900 * p, t, t + 0.22, biquad(v, 'lowpass', 4200, 2, g));
  sweep(o.frequency, t, 1900 * p, 260 * p, 0.2);
  const o2 = oscNode(v, 'square', 950 * p, t, t + 0.18, gainNode(v, 0.12, g));
  sweep(o2.frequency, t, 950 * p, 180 * p, 0.17);
}

function sRocket(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.9, 1.1);
  noiseBurst(v, t, { type: 'bandpass', freq: 700 * p, freqTo: 2400 * p, sweep: 0.5, Q: 1.2, a: 0.02, peak: 0.7, d: 0.6, dest: out });
  thump(v, t, 120 * p, 50, 0.5, 0.12, out);
}

function sNukeSiren(v: Voice, t: number, out: GainNode): void {
  const g = gainNode(v, 0, out);
  perc(g.gain, t, 0.15, 0.35, 2.6);
  const o = oscNode(v, 'sawtooth', 440, t, t + 2.8, biquad(v, 'lowpass', 1800, 1, g));
  for (let i = 0; i < 3; i++) {
    sweep(o.frequency, t + i * 0.9, 440, 880, 0.45);
    sweep(o.frequency, t + i * 0.9 + 0.45, 880, 440, 0.45);
  }
}

function sNukeBlast(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.5);
  thump(v, t, 70, 18, 1.0, 1.6, out);
  noiseBurst(v, t, { type: 'lowpass', freq: 2000, freqTo: 60, sweep: 2.5, Q: 0.6, a: 0.005, peak: 1.0, d: 3.0, dest: out });
  noiseBurst(v, t + 0.05, { type: 'bandpass', freq: 300, Q: 0.5, a: 0.3, peak: 0.7, d: 2.6, dest: out });
  crackle(v, t + 0.2, 2.2, 6, 0.3, 1800, out);
}

/**
 * Registry. prio: higher = more important (may steal lower voices when the
 * voice pool is full). max / gap override the per-name throttle. gain scales
 * the whole effect.
 */
const SFX: Record<string, SfxDef> = {
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
  victory: { fn: sVictory, prio: 4, max: 1, gap: 2, duck: 3.4 },
  defeat: { fn: sDefeat, prio: 4, max: 1, gap: 2, duck: 3.4 },
  bladestorm: { fn: sBladestorm, prio: 1, max: 2, gap: 0.3 },
  roar: { fn: sRoar, prio: 3, max: 1, gap: 0.8, gain: 0.85 },
  gunshot: { fn: sGunshot, prio: 0, max: 4, gap: 0.03, gain: 0.7 },
  cannon: { fn: sCannon, prio: 1, max: 3, gain: 0.9 },
  laser: { fn: sLaser, prio: 0, max: 4, gap: 0.03, gain: 0.6 },
  rocket: { fn: sRocket, prio: 1, max: 3, gain: 0.8 },
  nukeSiren: { fn: sNukeSiren, prio: 4, max: 1, gap: 2 },
  nukeBlast: { fn: sNukeBlast, prio: 4, max: 1, gap: 1 },
};

/**
 * Fire-and-forget sound effect. `volume` (0..1) is typically distance
 * attenuation from the game. Unknown names, a muted / uninitialized context
 * and throttled calls are silently ignored.
 */
export function playSfx(name: string, volume = 1): void {
  const def = Object.prototype.hasOwnProperty.call(SFX, name) ? SFX[name] : null;
  if (def) startVoice(name, def, volume, def.fn);
}

/** Start one synthesized voice, subject to the per-name limits and voice stealing. */
function startVoice(name: string, def: Throttle, volume: number, fn: SfxFn): void {
  if (muted || !canPlay()) return;
  const ac = ctx!;
  const vol = toUnit(volume, 1);
  if (vol < 0.01) return;

  const now = ac.currentTime;
  let st = nameStats.get(name);
  if (!st) {
    st = { count: 0, last: -1e9 };
    nameStats.set(name, st);
  }
  if (now - st.last < (def.gap != null ? def.gap : MIN_GAP)) return;
  if (st.count >= (def.max != null ? def.max : MAX_PER_NAME)) return;
  if (voices.length >= MAX_VOICES && !stealVoice(def.prio)) return;

  const out = ac.createGain();
  out.gain.value = vol * (def.gain != null ? def.gain : 1);
  out.connect(sfxGain!);
  const v = makeVoice(name, def.prio, out, st);
  v.counted = true;
  st.count++;
  st.last = now;
  voices.push(v);

  const t = now + START_DELAY;
  try {
    fn(v, t, out);
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
const PROGS: number[][] = [
  [0, -1, 3, 0], // Dm  C  G  Dm
  [2, -1, 0, 0], // F   C  Dm Dm
  [0, 3, 0, -1], // Dm  G  Dm C
  [2, 3, 0, -3], // F   G  Dm Am
  [0, -1, 2, 3], // Dm  C  F  G
];

/** Lute arpeggio patterns, degree offsets from the chord root (null = rest). */
const ARPS: (number | null)[][] = [
  [-7, -3, 0, 2, 4, 2],
  [-7, 0, 2, 4, 7, 4],
  [-7, -3, 0, -3, 2, 0],
  [-7, null, 0, 4, 2, null],
  [-7, 2, 4, 7, 4, 2],
];
const ARP_VEL = [1, 0.55, 0.7, 0.55, 0.65, 0.5];

/** Melody rhythms over two bars: [onset step, length in steps]. */
const RHYTHMS: [onset: number, len: number][][] = [
  [[0, 3], [3, 1], [4, 2], [6, 4], [10, 2]],
  [[0, 2], [2, 2], [4, 2], [6, 6]],
  [[0, 4], [4, 1], [5, 1], [6, 3], [9, 3]],
  [[0, 6], [6, 2], [8, 2], [10, 2]],
  [[3, 1], [4, 2], [6, 2], [8, 4]],
  [[0, 2], [2, 1], [3, 3], [6, 2], [8, 1], [9, 3]],
];
const MEL_LO = 3; // G4
const MEL_HI = 12; // B5

function degMidi(d: number): number {
  const o = Math.floor(d / 7);
  return TONIC + o * 12 + SCALE[d - o * 7]!;
}

/** A melody note: scale degree and length in steps. */
interface MelodyNote {
  deg: number;
  len: number;
}

/** What a progression cycle plays (picked by newCycle). */
interface MusicFlags {
  melody: boolean;
  drums: boolean;
  /** Arpeggio pattern of each bar of a chord. */
  arp: (number | null)[][];
  density: number;
}

const music: {
  /** startMusic() was called (the music starts once there is a context). */
  wanted: boolean;
  on: boolean;
  bus: GainNode | null;
  timer: ReturnType<typeof setInterval> | null;
  step: number;
  nextTime: number;
  /** The drone's nodes, which play for as long as the music. */
  persistent: { nodes: AudioNode[]; srcs: AudioScheduledSourceNode[] } | null;
  cycle: number;
  lastProg: number;
  prog: number[];
  flags: MusicFlags | null;
  /** Step within the cycle -> note. */
  melody: Map<number, MelodyNote> | null;
} = {
  wanted: false,
  on: false,
  bus: null,
  timer: null,
  step: 0,
  nextTime: 0,
  persistent: null,
  cycle: -1,
  lastProg: -1,
  prog: PROGS[0]!,
  flags: null,
  melody: null,
};

function isChordTone(d: number, root: number): boolean {
  const r = (((d - root) % 7) + 7) % 7;
  return r === 0 || r === 2 || r === 4;
}

function genMelody(prog: number[]): Map<number, MelodyNote> {
  const ev = new Map<number, MelodyNote>();
  const rA = pick(RHYTHMS);
  const rB = pick(RHYTHMS);
  const plan = [rA, rB, rA, pick(RHYTHMS)];
  let prev = 7 + pick([0, 2, 4]);
  for (let c = 0; c < 4; c++) {
    const root = prog[c]!;
    const rh = plan[c]!;
    rh.forEach(([on, len], k) => {
      const last = c === 3 && k === rh.length - 1;
      let deg: number;
      // 3/4: downbeats always land on a chord tone, other quarter beats often do
      const strong = on % STEPS_PER_BAR === 0 || (on % 2 === 0 && rnd() < 0.5);
      if (last || strong) {
        // nearest chord tone (or the root to end the phrase)
        const cands: number[] = [];
        for (let d = MEL_LO; d <= MEL_HI; d++) {
          if (last ? (((d - root) % 7) + 7) % 7 === 0 : isChordTone(d, root)) cands.push(d);
        }
        cands.sort((x, y) => Math.abs(x - prev) - Math.abs(y - prev));
        deg = (cands.length > 1 && !last && rnd() < 0.3 ? cands[1] : cands[0])!;
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

function newCycle(cyc: number): void {
  music.cycle = cyc;
  let pi = 0;
  if (cyc > 0) {
    do pi = (rnd() * PROGS.length) | 0;
    while (pi === music.lastProg);
  }
  music.lastProg = pi;
  music.prog = PROGS[pi]!;
  const intro = cyc === 0;
  const flags: MusicFlags = {
    melody: !intro && rnd() < 0.7,
    drums: !intro && rnd() < 0.65,
    arp: [pick(ARPS), pick(ARPS)],
    density: intro ? 0.75 : rand(0.8, 1),
  };
  music.flags = flags;
  music.melody = flags.melody ? genMelody(music.prog) : null;
}

function musicVoice(): Voice {
  return makeVoice('music', 0, null, null);
}

function mPluck(t: number, midi: number, vel: number): void {
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

function mFlute(t: number, midi: number, len: number): void {
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

function mPad(t: number, midis: number[], dur: number): void {
  const v = musicVoice();
  const g = gainNode(v, 0, music.bus);
  swell(g.gain, t, 0.9, 0.035, dur - 0.9, 1.2);
  const lp = biquad(v, 'lowpass', 750, 0.7, g);
  for (const m of midis) oscNode(v, 'triangle', mtof(m), t, t + dur + 1.25, lp);
}

function mDoum(t: number, vel: number): void {
  const v = musicVoice();
  thump(v, t, 120, 62, 0.22 * vel, 0.3, music.bus);
  noiseBurst(v, t, { type: 'lowpass', freq: 350, a: 0.002, peak: 0.08 * vel, d: 0.08, dest: music.bus });
}

function mTek(t: number, vel: number): void {
  const v = musicVoice();
  noiseBurst(v, t, { type: 'bandpass', freq: 2600, Q: 1.4, a: 0.001, peak: 0.07 * vel, d: 0.045, dest: music.bus });
  ping(v, t, 520, 0.03 * vel, 0.03, music.bus);
}

function scheduleStep(step: number, t: number, silent: boolean): void {
  const cyc = Math.floor(step / STEPS_PER_CYCLE);
  if (cyc !== music.cycle) newCycle(cyc);
  if (silent) return;
  const s = step % STEPS_PER_CYCLE;
  const root = music.prog[Math.floor(s / STEPS_PER_CHORD)]!;
  const inChord = s % STEPS_PER_CHORD;
  const bar = Math.floor(inChord / STEPS_PER_BAR);
  const sb = s % STEPS_PER_BAR;
  const f = music.flags!;
  const hum = () => (rnd() - 0.5) * 0.012;

  if (inChord === 0) mPad(t, [root - 7, root - 5, root - 3].map(degMidi), STEPS_PER_CHORD * STEP);

  const off = f.arp[bar]![sb]!;
  if (off !== null && (sb === 0 || rnd() < f.density)) {
    mPluck(t + (sb === 0 ? 0 : hum()), degMidi(root + off), ARP_VEL[sb]! * rand(0.85, 1.1));
  }

  if (music.melody) {
    const ev = music.melody.get(s);
    if (ev) mFlute(t + hum(), degMidi(ev.deg), ev.len);
  }

  if (f.drums) {
    if (sb === 0) mDoum(t, bar === 0 ? 1 : 0.8);
    else if (sb === 3 && rnd() < 0.35) mDoum(t, 0.5);
    else if ((sb === 2 || sb === 4) && rnd() < 0.75) mTek(t, sb === 4 ? 0.8 : 0.6);
    else if (sb === 5 && bar === 1 && rnd() < 0.4) mTek(t, 0.5);
  }
}

function musicTick(): void {
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

function beginMusic(): void {
  const ac = ctx!;
  music.on = true;
  const t = ac.currentTime + 0.05;
  const bus = ac.createGain();
  bus.gain.setValueAtTime(0, t);
  bus.gain.linearRampToValueAtTime(1, t + 3);
  bus.connect(musicGain!);
  music.bus = bus;

  // Drone: low D + A fifth, like a hurdy-gurdy, with a slowly breathing filter.
  const dg = ac.createGain();
  dg.gain.value = 0.05;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 280;
  lp.Q.value = 0.8;
  lp.connect(dg);
  dg.connect(bus);
  const nodes: AudioNode[] = [dg, lp];
  const srcs: OscillatorNode[] = [];
  for (const [midi, det] of [[38, -4], [38, 5], [45, 0]] as const) {
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(midi);
    o.detune.value = det;
    o.connect(lp);
    srcs.push(o);
  }
  const lfo = ac.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ac.createGain();
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
export function startMusic(): void {
  music.wanted = true;
  if (!ctx || music.on) return;
  beginMusic();
}

/** Stop scheduling new notes and fade the music out. */
export function stopMusic(): void {
  music.wanted = false;
  if (!music.on) return;
  music.on = false;
  if (music.timer) clearInterval(music.timer);
  music.timer = null;
  const bus = music.bus;
  const pers = music.persistent;
  music.bus = null;
  music.persistent = null;
  if (!ctx || !bus) return;
  const t = ctx.currentTime;
  const fade = 1.5;
  bus.gain.cancelScheduledValues(t);
  bus.gain.setValueAtTime(bus.gain.value, t);
  bus.gain.linearRampToValueAtTime(0, t + fade);
  for (const s of pers?.srcs ?? []) {
    try {
      s.stop(t + fade + 0.05);
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => {
    for (const n of (pers?.nodes ?? []).concat(bus)) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
  }, (fade + 2) * 1000);
}

// ---------------------------------------------------------------------------
// Unit acknowledgements ("barks"): short gibberish phrases from a small formant
// synthesizer, in the spirit of Warcraft III's unit responses. A buzzing
// glottal source runs through three band-pass formants that glide between
// vowel targets; consonants are noise bursts, gaps and formant transitions.
// Each unit type maps to a voice (pitch, vocal-tract size, roughness and a
// radio or robot filter in the later ages). Vehicles and summons answer with
// engines, bleeps, a trumpet or bubbles instead.
// ---------------------------------------------------------------------------

/** F1, F2 and F3 (Hz). */
type Formants = [number, number, number];
type ConsonantClass = 'h' | 'fric' | 'vfric' | 'stop' | 'vstop' | 'nasal' | 'glide';
/** One syllable of a phrase: consonant units (see consUnit), up to two vowels, and stress. */
interface Syllable {
  onset: string;
  glide: string;
  vowels: string;
  coda: string;
  stress: boolean;
}

/** Formant frequencies (Hz) of an adult male voice; scaled by the voice's `size`. */
const VOWELS: Record<string, Formants> = {
  a: [740, 1180, 2500],
  e: [480, 1850, 2550],
  i: [310, 2250, 2950],
  o: [520, 900, 2450],
  u: [340, 820, 2300],
};
const FORMANT_AMP = [1, 0.6, 0.3];
const FORMANT_Q = [7, 10, 14];
/** Where the formants start for a consonant (F1, F2, F3) before gliding to the vowel. */
const LOCUS: Record<string, Formants | null> = {
  b: [250, 800, 2300], p: [250, 800, 2300], m: [250, 900, 2300], w: [300, 700, 2200], f: [300, 1000, 2400],
  v: [300, 1000, 2400], d: [300, 1700, 2600], t: [300, 1700, 2600], n: [260, 1600, 2600], l: [350, 1100, 2700],
  th: [300, 1500, 2600], s: [300, 1600, 2600], z: [300, 1600, 2600], g: [300, 2000, 2400], k: [300, 2000, 2400],
  y: [300, 2200, 2950], j: [300, 1900, 2600], ch: [300, 1900, 2600], sh: [300, 1900, 2600], r: [420, 1250, 1650],
  h: null,
};
/** Consonant class and duration (s). */
const CONS: Record<string, [ConsonantClass, number]> = {
  h: ['h', 0.06], s: ['fric', 0.08], sh: ['fric', 0.08], f: ['fric', 0.06], th: ['fric', 0.06], ch: ['fric', 0.07],
  z: ['vfric', 0.06], v: ['vfric', 0.05], p: ['stop', 0.06], t: ['stop', 0.06], k: ['stop', 0.065],
  b: ['vstop', 0.045], d: ['vstop', 0.045], g: ['vstop', 0.05], j: ['vstop', 0.06],
  m: ['nasal', 0.06], n: ['nasal', 0.055], l: ['glide', 0.05], r: ['glide', 0.05], w: ['glide', 0.05], y: ['glide', 0.045],
};
/** Noise of fricatives: [band centre, Q, level]. */
const HISS: Record<string, [freq: number, Q: number, level: number]> = {
  s: [6200, 1.8, 0.22], sh: [3000, 1.6, 0.3], ch: [3000, 1.6, 0.3], f: [4500, 0.5, 0.08], th: [5000, 0.5, 0.07],
  z: [5800, 1.8, 0.12], v: [4000, 0.5, 0.05],
};
/** Release burst of stops: [band centre, Q, level]. */
const BURST: Record<string, [freq: number, Q: number, level: number]> = {
  p: [900, 1, 0.25], b: [800, 1, 0.12], t: [4200, 1.2, 0.3], d: [3600, 1.2, 0.15], k: [2300, 2, 0.3],
  g: [2100, 2, 0.15], j: [3000, 1.5, 0.12],
};

const PHRASES: Record<string, Record<BarkKind, string[]>> = {
  soldier: {
    select: ['YE-es?', 'RE-dy?', 'mi-LORD?', 'WHA-at?', 'SIR?', 'hm-MM?'],
    move: ['MO-ving.', 'rai-ta-WEI.', 'o-KEI.', 'YES sir.', 'on-mai-WEI.', 'az-yu-WISH.'],
    attack: ['ha-AH!', 'for-KA-ra!', 'a-TAK!', 'CHAR-ja!', 'tu-AR-mas!', 'RAAH!'],
  },
  worker: {
    select: ['YE-es?', 'mi-LORD?', 'MOR-wurk?', 'hm?', 'WHAT?'],
    move: ['o-KEI.', 'JOB-dan.', 'YUP.', 'WUR-kin.', 'al-RAIT.'],
    attack: ['HAH!', 'ok-OK!', 'if-ai-MUST!'],
  },
  caveman: {
    select: ['UG?', 'hu-UH?', 'GA?', 'oo-GA?'],
    move: ['UG-ga.', 'oo-GA.', 'BA-du.', 'HUP.'],
    attack: ['RAAH!', 'UG-ga-BUG!', 'GRA-ah!', 'HAA-ga!'],
  },
  mystic: {
    select: ['YE-es?', 'ai-LIS-en.', 'SPIK.', 'the-LAIT?'],
    move: ['SO-bi-it.', 'AZ-yu-WISH.', 'ai-GO.', 'of-KORS.'],
    attack: ['BI-GON!', 'BURN!', 'for-the-LAIT!', 'FIL-mai-RATH!'],
  },
  radio: {
    select: ['GO-a-HED.', 'RO-ger?', 'SAR-jent?', 'STAN-din-BAI.'],
    move: ['RO-ger.', 'KO-pi.', 'MO-vin-AUT.', 'ON-it.', 'WIL-ko.'],
    attack: ['en-GEI-jin!', 'O-pen-FAI-er!', 'TAR-get-SAI-ted!', 'LOK-and-LOD!'],
  },
  robot: {
    select: ['a-WEI-tin-IN-put.', 'SIS-tems-ON-lain.', 'RE-di.'],
    move: ['AF-fir-ma-tiv.', 'KO-or-di-nets-LOKT.', 'PRO-sid-in.'],
    attack: ['TAR-get-ak-WAI-erd!', 'EK-se-kyu-tin!', 'ter-mi-NEIT!'],
  },
  hero: {
    select: ['ai-AM-RE-di.', 'WOT-iz-it?', 'SPIK.', 'YES?', 'mai-LIJ?'],
    move: ['AT-wans.', 'LID-on.', 'ai-SHAL-GO.', 'SO-bi-IT.'],
    attack: ['for-ON-or!', 'tu-BAT-tel!', 'DAI!', 'yu-WIL-FOL!'],
  },
};

/**
 * Voices. Speakers: f0 (Hz), size (formant scale: <1 bigger, >1 smaller vocal tract), rough (growl),
 * tempo, breath, wet (reverb), vib (vibrato), fx ('radio' | 'robot') and level. Others: `type`.
 */
interface Speaker {
  type?: undefined;
  f0: number;
  size: number;
  rough: number;
  tempo?: number;
  breath?: number;
  wet?: number;
  vib?: number;
  level?: number;
  /** Key of PHRASES. */
  words: string;
  fx?: 'radio' | 'robot';
}
type VoiceDef = Speaker | { type: 'engine' } | { type: 'droid' } | { type: 'trumpet' } | { type: 'bubbles' };

const VOICES: Record<string, VoiceDef> = {
  man: { f0: 118, size: 1, rough: 0.08, words: 'soldier' },
  heavy: { f0: 98, size: 0.93, rough: 0.2, tempo: 0.92, words: 'soldier' },
  worker: { f0: 138, size: 1.04, rough: 0.04, tempo: 1.1, words: 'worker' },
  caveman: { f0: 92, size: 0.9, rough: 0.32, tempo: 0.85, words: 'caveman' },
  mystic: { f0: 150, size: 1.03, rough: 0, tempo: 0.9, breath: 0.08, wet: 0.3, level: 0.85, words: 'mystic' },
  sorceress: { f0: 215, size: 1.17, rough: 0, tempo: 0.95, breath: 0.1, wet: 0.3, level: 0.6, words: 'mystic' },
  radio: { f0: 122, size: 1, rough: 0.1, tempo: 1.15, level: 0.85, words: 'radio', fx: 'radio' },
  robot: { f0: 104, size: 0.95, rough: 0, tempo: 1, level: 0.55, words: 'robot', fx: 'robot' },
  paladin: { f0: 106, size: 0.95, rough: 0.06, tempo: 0.9, wet: 0.25, words: 'hero' },
  archmage: { f0: 128, size: 0.98, rough: 0.12, tempo: 0.85, breath: 0.06, wet: 0.3, vib: 1.6, level: 0.8, words: 'hero' },
  blademaster: { f0: 112, size: 0.97, rough: 0.15, tempo: 1.05, wet: 0.2, words: 'hero' },
  mountainking: { f0: 84, size: 0.88, rough: 0.36, tempo: 0.95, wet: 0.2, words: 'hero' },
  ranger: { f0: 205, size: 1.16, rough: 0.02, wet: 0.25, level: 0.8, words: 'hero' },
  engine: { type: 'engine' },
  droid: { type: 'droid' },
  trumpet: { type: 'trumpet' },
  bubbles: { type: 'bubbles' },
};

/** Which voice a unit type answers with (null: it doesn't). */
export function barkVoice(def: UnitDef | null | undefined): string | null {
  if (!def || def.kind === 'building') return null;
  if (def.hero) return VOICES[def.id] ? def.id : 'paladin';
  if (def.id === 'water_elemental') return 'bubbles';
  if (def.id === 'war_elephant') return 'trumpet';
  const age = def.age ?? 0;
  if (def.vehicle) return age >= 10 ? 'droid' : 'engine';
  if (def.worker) return 'worker';
  if (def.id === 'sorceress') return 'sorceress';
  if (def.attackType === 'magic' && age <= 6) return 'mystic';
  if (age === 1) return 'caveman';
  if (age >= 11) return 'robot';
  if (age >= 8) return 'radio';
  if (def.armorType === 'heavy' || def.cavalry) return 'heavy';
  return 'man';
}

function parsePhrase(text: string): { tone: 'ask' | 'shout' | 'say'; syl: Syllable[] } {
  const last = text.trim().slice(-1);
  const tone = last === '?' ? 'ask' : last === '!' ? 'shout' : 'say';
  const syl: Syllable[] = [];
  for (const word of text.replace(/[?!.,]/g, '').split(/[-\s]+/)) {
    if (!word) continue;
    const stress = word !== word.toLowerCase();
    let w = word.toLowerCase();
    while (w) {
      const m = /^([^aeiou]*)([aeiou]*)([^aeiou]*)/.exec(w)!; // matches any string
      const onset = m[1]!;
      const vowels = m[2]!;
      let coda = m[3]!;
      w = w.slice(m[0].length);
      if (w && coda) {
        // Consonants between two vowels start the next syllable (all but the first of a cluster).
        const keep = coda.length >= 2 ? 1 : 0;
        w = coda.slice(keep) + w;
        coda = coda.slice(0, keep);
      }
      syl.push({ onset: consUnit(onset), glide: liquidIn(onset), vowels: vowels.slice(0, 2), coda: consUnit(coda), stress });
    }
  }
  return { tone, syl };
}

function consUnit(cluster: string): string {
  if (!cluster) return '';
  const two = cluster.slice(0, 2);
  if (two === 'ch' || two === 'sh' || two === 'th') return two;
  const c = cluster.charAt(0);
  return CONS[c] ? c : '';
}

/** A liquid after the first consonant of an onset ("gr", "pl"): its locus colours the transition. */
function liquidIn(cluster: string): string {
  for (let i = 1; i < cluster.length; i++) if ('rlwy'.includes(cluster.charAt(i))) return cluster.charAt(i);
  return '';
}

/** Speak `text` with voice `vc`. */
function speak(v: Voice, t: number, vc: Speaker, text: string, out: GainNode): GainNode {
  const { tone, syl } = parsePhrase(text);
  const shout = tone === 'shout';
  const tempo = vc.tempo || 1;
  const size = vc.size || 1;
  const breath = vc.breath || 0;
  const n = syl.length;

  // Timeline.
  let cur = t + 0.01;
  const plan = syl.map((s, i) => {
    const lastSyl = i === n - 1;
    const on = s.onset ? CONS[s.onset] : null;
    const co = s.coda ? CONS[s.coda] : null;
    const vlen = ((s.stress ? 0.2 : 0.13) * (lastSyl ? 1.3 : 1) * (shout ? 1.1 : 1)) / tempo;
    const v0 = cur + (on ? on[1] : 0.02);
    const v1 = v0 + vlen;
    const p = { s, i, t0: cur, v0, v1, end: v1 + (co ? co[1] : 0), on, co, last: lastSyl };
    cur = p.end + 0.015;
    return p;
  });
  const end = cur + 0.15;

  // Signal chain: glottal source -> voicing gain -> three formants -> mix -> effect -> out.
  const mix = gainNode(v, 1, null);
  const fxOut = voiceFx(v, t, end, vc, shout, mix, out);
  const bank = gainNode(v, 1.2 * (vc.level || 1), mix);
  const vox = gainNode(v, 0, null);
  const asp = gainNode(v, breath, null);
  const filters = [0, 1, 2].map((k) => {
    const g = gainNode(v, FORMANT_AMP[k]!, bank);
    const f = biquad(v, 'bandpass', VOWELS.e![k]! * size, FORMANT_Q[k], g);
    vox.connect(f);
    asp.connect(f);
    return f;
  });
  noiseNode(v, t, end, asp);

  const f0 = vc.f0 * (shout ? 1.3 : 1);
  const oscs: [OscillatorNode, number][] = [[oscNode(v, vc.fx === 'robot' ? 'square' : 'sawtooth', f0, t, end, vox), 1]];
  const o2 = oscNode(v, 'sawtooth', f0, t, end, gainNode(v, 0.5, vox));
  o2.detune.value = 7;
  oscs.push([o2, 1]);
  if (vc.rough) oscs.push([oscNode(v, 'square', f0 / 2, t, end, gainNode(v, vc.rough * 0.6, vox)), 0.5]);
  const lfo = oscNode(v, 'sine', rand(5, 6), t, end, null);
  const lg = gainNode(v, 6 + 10 * (vc.vib || 0), null);
  lfo.connect(lg);
  for (const [o] of oscs) lg.connect(o.detune);

  const setPitch = (time: number, k: number, ramp: boolean): void => {
    for (const [o, r] of oscs) {
      if (ramp) o.frequency.linearRampToValueAtTime(f0 * k * r, time);
      else o.frequency.setValueAtTime(f0 * k * r, time);
    }
  };
  const setForm = (time: number, freqs: Formants, ramp: boolean): void => {
    filters.forEach((f, k) => {
      const hz = freqs[k]! * size;
      if (ramp) f.frequency.linearRampToValueAtTime(hz, time);
      else f.frequency.setValueAtTime(hz, time);
    });
  };

  const first = plan[0]!;
  setForm(t, LOCUS[first.s.onset] || VOWELS[first.s.vowels.charAt(0)] || LOCUS.m!, false);
  setPitch(t, shout ? 1.1 : 1.06, false);
  vox.gain.setValueAtTime(0, t);
  const G = vox.gain;
  const A = asp.gain;

  for (const p of plan) {
    const { s, on, co } = p;
    const k = n > 1 ? p.i / (n - 1) : 0;
    const peak = (s.stress ? 1 : 0.72) * (shout ? 1.25 : 1);
    const pitch = tone === 'shout' ? 1 + (s.stress ? 0.15 : 0) - 0.1 * k : tone === 'ask' ? 1 + (s.stress ? 0.08 : 0) : 1.06 - 0.18 * k + (s.stress ? 0.1 : 0);
    const vowel = s.vowels ? VOWELS[s.vowels.charAt(0)]! : LOCUS.m!;
    const kind = on ? on[0] : 'none';

    // Onset: formants start at the consonant's locus (or the liquid's in a cluster) and glide to the vowel.
    const locus = LOCUS[s.glide] || LOCUS[s.onset];
    if (locus) setForm(p.t0 + 0.012, locus, true);
    else setForm(p.t0 + 0.012, vowel, true);
    if (kind === 'fric' || kind === 'stop' || kind === 'h') {
      G.linearRampToValueAtTime(0, p.t0 + 0.012);
      G.setValueAtTime(0, p.v0);
    } else if (kind === 'vstop') {
      G.linearRampToValueAtTime(0.12 * peak, p.t0 + 0.012);
      G.setValueAtTime(0.12 * peak, p.v0 - 0.01);
    } else if (kind === 'nasal') {
      G.linearRampToValueAtTime(0.3 * peak, p.t0 + 0.02);
      G.setValueAtTime(0.3 * peak, p.v0);
    } else if (kind === 'glide' || kind === 'vfric') {
      G.linearRampToValueAtTime(0.5 * peak, p.t0 + 0.02);
      G.setValueAtTime(0.5 * peak, p.v0);
    } else {
      G.linearRampToValueAtTime(0.4 * peak, p.t0 + 0.012);
    }
    const onsetHiss = HISS[s.onset];
    if (onsetHiss) {
      const [freq, Q, lvl] = onsetHiss;
      noiseBurst(v, p.t0, { type: 'bandpass', freq, Q, a: 0.015, peak: lvl * peak, d: Math.max(0.02, p.v0 - p.t0 - 0.01), dest: mix });
    }
    const onsetBurst = BURST[s.onset];
    if (onsetBurst) {
      const [freq, Q, lvl] = onsetBurst;
      noiseBurst(v, p.v0 - 0.025, { type: 'bandpass', freq, Q, a: 0.001, peak: lvl * peak, d: 0.02, dest: mix });
    }
    if (kind === 'h' || kind === 'stop') {
      // Aspiration through the formants.
      A.setValueAtTime(breath, p.t0);
      A.linearRampToValueAtTime(kind === 'h' ? 0.5 : 0.25, p.t0 + 0.015);
      A.setValueAtTime(kind === 'h' ? 0.5 : 0.25, p.v0);
      A.linearRampToValueAtTime(breath, p.v0 + 0.03);
    }

    // Vowel (a two-letter vowel glides to its second target).
    setPitch(p.v0 + 0.03, pitch, true);
    setForm(p.v0 + 0.045, vowel, true);
    G.linearRampToValueAtTime(peak * (s.vowels ? 1 : 0.5), p.v0 + 0.025);
    if (s.vowels.length > 1) {
      setForm(p.v0 + (p.v1 - p.v0) * 0.45, vowel, true);
      setForm(p.v0 + (p.v1 - p.v0) * 0.9, VOWELS[s.vowels.charAt(1)]!, true);
    }
    G.linearRampToValueAtTime(peak * (s.vowels ? 0.85 : 0.45), p.v1);
    if (p.last) {
      const finalPitch = tone === 'ask' ? 1.38 : tone === 'shout' ? 1.02 : 0.82;
      setPitch(tone === 'ask' ? p.v1 : p.end + 0.05, finalPitch, true);
    }

    // Coda.
    const ck = co ? co[0] : 'none';
    const codaLocus = LOCUS[s.coda];
    if (codaLocus) setForm(p.end, codaLocus, true);
    if (ck === 'nasal' || ck === 'glide') {
      G.linearRampToValueAtTime(0.3 * peak, p.v1 + 0.02);
      G.linearRampToValueAtTime(p.last ? 0 : 0.25 * peak, p.end + 0.01);
    } else if (ck === 'stop' || ck === 'fric' || ck === 'h') {
      G.linearRampToValueAtTime(0, p.v1 + 0.02);
    } else if (ck === 'vstop' || ck === 'vfric') {
      G.linearRampToValueAtTime(0.12 * peak, p.v1 + 0.015);
      G.linearRampToValueAtTime(0, p.end);
    } else {
      G.linearRampToValueAtTime(p.last ? 0 : 0.35 * peak, p.end + (p.last ? 0.06 : 0.015));
    }
    const codaHiss = HISS[s.coda];
    if (codaHiss) {
      const [freq, Q, lvl] = codaHiss;
      noiseBurst(v, p.v1, { type: 'bandpass', freq, Q, a: 0.012, peak: lvl * peak, d: Math.max(0.03, p.end - p.v1), dest: mix });
    }
    const codaBurst = BURST[s.coda];
    if (codaBurst) {
      const [freq, Q, lvl] = codaBurst;
      noiseBurst(v, p.end - 0.015, { type: 'bandpass', freq, Q, a: 0.001, peak: lvl * peak * 0.8, d: 0.025, dest: mix });
    }
  }
  G.linearRampToValueAtTime(0, plan[n - 1]!.end + 0.08);
  if (vc.wet) wet(v, vc.wet);
  return fxOut;
}

/** The voice's effect from `mix` to `out`: shout drive, a radio, or a robot's ring modulator. */
function voiceFx(v: Voice, t: number, end: number, vc: Speaker, shout: boolean, mix: GainNode, out: GainNode): GainNode {
  if (vc.fx === 'radio') {
    const hp = biquad(v, 'highpass', 500, 0.8, null);
    const lp = biquad(v, 'lowpass', 2800, 1.2, null);
    mix.connect(hp);
    hp.connect(lp);
    const drive = gainNode(v, 2.2, shaper(v, gainNode(v, 0.45, out)));
    lp.connect(drive);
    // Squelch at the start and the end of the transmission.
    noiseBurst(v, t, { type: 'bandpass', freq: 2500, Q: 0.8, a: 0.002, peak: 0.12, d: 0.05, dest: out });
    noiseBurst(v, end - 0.12, { type: 'bandpass', freq: 2200, Q: 0.7, a: 0.004, peak: 0.16, d: 0.09, dest: out });
    ping(v, end - 0.03, 1800, 0.05, 0.03, out, 'square');
    return out;
  }
  if (vc.fx === 'robot') {
    const ring = gainNode(v, 0, gainNode(v, 0.9, out));
    mix.connect(ring);
    oscNode(v, 'sine', 70, t, end, ring.gain);
    mix.connect(gainNode(v, 0.35, out));
    return out;
  }
  if (shout || vc.rough > 0.25) {
    mix.connect(gainNode(v, 1.6, shaper(v, gainNode(v, 0.55, out))));
    return out;
  }
  mix.connect(out);
  return out;
}

/** Vehicles before the Digital Age: an engine revving (move), idling (select) or roaring (attack). */
function engineBark(v: Voice, t: number, kind: BarkKind, out: GainNode): void {
  const dur = kind === 'select' ? 0.55 : kind === 'move' ? 0.9 : 0.8;
  const stop = t + dur + 0.05;
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.04, 0.12, dur - 0.25, 0.22);
  const lp = biquad(v, 'lowpass', 500, 3, g);
  const drive = gainNode(v, 2.5, shaper(v, lp));
  const o = oscNode(v, 'sawtooth', 42, t, stop, drive);
  const o2 = oscNode(v, 'square', 21, t, stop, gainNode(v, 0.5, drive));
  const [f1, f2] = kind === 'select' ? [42, 52] : kind === 'move' ? [40, 85] : [48, 105];
  for (const [osc, r] of [[o, 1], [o2, 0.5]] as const) {
    osc.frequency.setValueAtTime(f1 * r, t);
    if (kind === 'select') {
      osc.frequency.linearRampToValueAtTime(f2 * r, t + 0.12);
      osc.frequency.linearRampToValueAtTime(f1 * r, t + 0.35);
    } else osc.frequency.exponentialRampToValueAtTime(f2 * r, t + dur * 0.7);
  }
  sweep(lp.frequency, t, 350, kind === 'select' ? 600 : 1400, dur * 0.7);
  noiseBurst(v, t, { type: 'lowpass', freq: 400, a: 0.05, peak: 0.08, d: dur, dest: out });
  if (kind !== 'move') metal(v, t + 0.02, 320, [1, 2.76, 5.4], [0.2, 0.12, 0.06], [0.12, 0.08, 0.05], out);
}

/** Digital Age vehicles and later: droid bleeps. */
function droidBark(v: Voice, t: number, kind: BarkKind, out: GainNode): void {
  const r = rand(0.85, 1.15);
  const notes: [dt: number, from: number, to: number, dur: number][] =
    kind === 'select'
      ? [[0, 1300, 1900, 0.07], [0.09, 1900, 1500, 0.06]]
      : kind === 'move'
        ? [[0, 900, 1400, 0.06], [0.08, 1400, 1400, 0.05], [0.15, 2100, 2100, 0.08]]
        : [[0, 2600, 700, 0.22], [0.25, 700, 1800, 0.1]];
  const lp = biquad(v, 'lowpass', 3200, 0.7, out);
  for (const [dt, a, b, d] of notes) {
    const tt = t + dt;
    const g = gainNode(v, 0, lp);
    swell(g.gain, tt, 0.006, 0.22, d - 0.02, 0.03);
    const o = oscNode(v, 'square', a * r, tt, tt + d + 0.05, g);
    sweep(o.frequency, tt, a * r, b * r, d);
  }
  if (kind === 'attack') {
    const g = gainNode(v, 0, out);
    swell(g.gain, t, 0.01, 0.18, 0.18, 0.06);
    const o = oscNode(v, 'sawtooth', 110, t, t + 0.3, g);
    oscNode(v, 'square', 30, t, t + 0.3, gainNode(v, 40, o.frequency));
  }
}

/** The war elephant's trumpet. */
function trumpetBark(v: Voice, t: number, kind: BarkKind, out: GainNode): void {
  const dur = kind === 'attack' ? 1 : kind === 'move' ? 0.5 : 0.65;
  const f = rand(330, 380) * (kind === 'attack' ? 1.15 : 1);
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.06, 0.32, dur - 0.2, 0.18);
  const bp = biquad(v, 'bandpass', 1100, 1.2, g);
  const drive = gainNode(v, 2, shaper(v, bp));
  const o = oscNode(v, 'sawtooth', f * 0.8, t, t + dur + 0.05, drive);
  o.frequency.linearRampToValueAtTime(f * 1.25, t + dur * 0.3);
  o.frequency.linearRampToValueAtTime(f * 1.05, t + dur);
  oscNode(v, 'sine', 7, t, t + dur + 0.05, gainNode(v, 30, o.detune));
  noiseBurst(v, t, { type: 'bandpass', freq: 2000, Q: 0.8, a: 0.05, peak: 0.1, d: dur, dest: out });
}

/** The water elemental: bubbles and a wash. */
function bubbleBark(v: Voice, t: number, kind: BarkKind, out: GainNode): void {
  const count = kind === 'attack' ? 10 : 6;
  const spread = kind === 'attack' ? 0.5 : 0.4;
  for (let i = 0; i < count; i++) {
    const tt = t + rand(0, spread);
    const f = rand(300, 900);
    const g = gainNode(v, 0, out);
    perc(g.gain, tt, 0.003, rand(0.16, 0.36), rand(0.04, 0.09));
    const o = oscNode(v, 'sine', f, tt, tt + 0.12, g);
    sweep(o.frequency, tt, f, f * rand(1.8, 2.8), 0.06);
  }
  noiseBurst(v, t, { type: 'lowpass', freq: 700, a: 0.08, peak: 0.2, d: 0.5, dest: out });
  if (kind === 'attack') noiseBurst(v, t, { type: 'bandpass', freq: 400, freqTo: 2000, Q: 1, a: 0.1, peak: 0.15, d: 0.4, dest: out });
}

/** Number of distinct lines a voice has for `kind`. */
export function barkLines(voiceId: string, kind: BarkKind): number {
  const vc = VOICES[voiceId];
  if (!vc) return 0;
  return vc.type ? 3 : PHRASES[vc.words]![kind].length;
}

function sBark(v: Voice, t: number, out: GainNode, voiceId: string, kind: BarkKind, line?: number): void {
  const vc = VOICES[voiceId] || VOICES.man!;
  if (vc.type === 'engine') return engineBark(v, t, kind, out);
  if (vc.type === 'droid') return droidBark(v, t, kind, out);
  if (vc.type === 'trumpet') return trumpetBark(v, t, kind, out);
  if (vc.type === 'bubbles') return bubbleBark(v, t, kind, out);
  const words = PHRASES[vc.words]!;
  const lines = words[kind] || words.select;
  speak(v, t, vc, line != null ? lines[line % lines.length]! : pick(lines), out);
}

/** Barks share one voice slot: a unit doesn't talk over another. */
export const BARK = { prio: 3, max: 1, gap: 0.3 };

/** A unit acknowledges a selection or an order (kind: 'select' | 'move' | 'attack'). */
export function playBark(voiceId: string, kind: BarkKind, volume = 0.8): void {
  if (!VOICES[voiceId]) return;
  startVoice('bark', BARK, volume, (v, t, out) => sBark(v, t, out, voiceId, kind));
}

// ---------------------------------------------------------------------------
// Ambience: rendered offline into seamless loops (wind, crickets, the citadel's
// drone) and one-shot bird calls, played by the Babylon.js audio backend.
// ---------------------------------------------------------------------------

/** Noise from a buffer as long as the sound itself (the shared 2 s buffer would repeat audibly). */
function longNoise(v: Voice, t: number, dur: number, dest: AudioNode): AudioBufferSourceNode {
  const ac = ctx!;
  const len = Math.ceil(ac.sampleRate * (dur + 0.1));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
  const s = ac.createBufferSource();
  s.buffer = buf;
  s.connect(dest);
  return runSource(v, s, t, t + dur);
}

function aWind(v: Voice, t: number, out: GainNode, dur: number): void {
  for (const [freq, Q, lvl] of [
    [380, 0.7, 0.55],
    [900, 4, 0.12],
    [160, 0.7, 0.4],
  ] as const) {
    const g = gainNode(v, lvl * 0.6, out);
    const f = biquad(v, 'bandpass', freq, Q, g);
    longNoise(v, t, dur, f);
    // Gusts: level and pitch wander every second or two.
    for (let tt = t + rand(0.5, 1.5); tt < t + dur; tt += rand(0.8, 2.2)) {
      g.gain.linearRampToValueAtTime(lvl * rand(0.3, 1), tt);
      f.frequency.linearRampToValueAtTime(freq * rand(0.7, 1.4), tt);
    }
  }
}

function aCrickets(v: Voice, t: number, out: GainNode, dur: number): void {
  for (let c = 0; c < 4; c++) {
    const g = gainNode(v, 0, out);
    oscNode(v, 'sine', rand(4200, 5200), t, t + dur, g);
    const period = rand(0.55, 0.95);
    const pulses = 2 + ((rnd() * 3) | 0);
    const gap = rand(0.028, 0.04);
    const lvl = rand(0.05, 0.12);
    g.gain.setValueAtTime(0, t);
    for (let tt = t + rand(0, period); tt < t + dur - 0.2; tt += period * rand(0.92, 1.08)) {
      for (let p = 0; p < pulses; p++) {
        const ps = tt + p * gap;
        g.gain.setValueAtTime(0, ps);
        g.gain.linearRampToValueAtTime(lvl, ps + 0.004);
        g.gain.linearRampToValueAtTime(0, ps + gap * 0.7);
      }
    }
  }
  // A distant chorus.
  const g = gainNode(v, 0.04, out);
  longNoise(v, t, dur, biquad(v, 'bandpass', 4600, 6, g));
  oscNode(v, 'sine', 9, t, t + dur, gainNode(v, 0.03, g.gain));
}

function aDrone(v: Voice, t: number, out: GainNode, dur: number): void {
  const g = gainNode(v, 0.45, out);
  const lp = biquad(v, 'lowpass', 320, 1.5, g);
  for (const f of [55, 55.25, 82.5, 110.1]) oscNode(v, 'sawtooth', f, t, t + dur, lp);
  oscNode(v, 'sine', 0.125, t, t + dur, gainNode(v, 140, lp.frequency));
  // An eerie choir: an "oo" on A3 with slow vibrato.
  const cg = gainNode(v, 1.4, out);
  const src = gainNode(v, 1, null);
  for (const [k, f] of VOWELS.u!.entries()) src.connect(biquad(v, 'bandpass', f * 1.1, FORMANT_Q[k], gainNode(v, FORMANT_AMP[k]! * 0.12, cg)));
  const o = oscNode(v, 'sawtooth', 220, t, t + dur, src);
  oscNode(v, 'sine', 0.25, t, t + dur, gainNode(v, 12, o.detune));
  oscNode(v, 'sine', 0.0625, t, t + dur, gainNode(v, 0.6, cg.gain));
  // Low rumble.
  longNoise(v, t, dur, biquad(v, 'lowpass', 90, 0.7, gainNode(v, 0.5, out)));
}

function aBird(v: Voice, t: number, out: GainNode): void {
  const type = (rnd() * 3) | 0;
  if (type === 0) {
    // Tweets: a few quick downward sweeps.
    const n = 2 + ((rnd() * 3) | 0);
    const f = rand(3800, 5200);
    for (let i = 0; i < n; i++) {
      const tt = t + i * rand(0.09, 0.14);
      const g = gainNode(v, 0, out);
      perc(g.gain, tt, 0.004, 0.25, 0.06);
      const o = oscNode(v, 'sine', f, tt, tt + 0.08, g);
      sweep(o.frequency, tt, f, f * 0.65, 0.06);
    }
  } else if (type === 1) {
    // A trill.
    const n = 8 + ((rnd() * 6) | 0);
    const fa = rand(3000, 4000);
    const fb = fa * rand(1.15, 1.35);
    const step = rand(0.035, 0.05);
    for (let i = 0; i < n; i++) {
      const tt = t + i * step;
      const g = gainNode(v, 0, out);
      perc(g.gain, tt, 0.003, 0.16 * (1 - (i / n) * 0.5), step * 0.8);
      oscNode(v, 'sine', i % 2 ? fb : fa, tt, tt + step + 0.01, g);
    }
  } else {
    // A two-note whistle.
    const f = rand(2600, 3400);
    for (const [dt, a, b] of [
      [0, f, f * 0.98],
      [0.32, f * 0.8, f * 0.78],
    ] as const) {
      const tt = t + dt;
      const g = gainNode(v, 0, out);
      swell(g.gain, tt, 0.02, 0.2, 0.18, 0.06);
      const o = oscNode(v, 'sine', a, tt, tt + 0.3, g);
      sweep(o.frequency, tt, a, b, 0.2);
    }
  }
}

const AMBIENT: Record<string, { fn: RenderFn; loop?: number }> = {
  wind: { fn: aWind, loop: 16 },
  crickets: { fn: aCrickets, loop: 8 },
  drone: { fn: aDrone, loop: 16 },
  bird: { fn: aBird },
};

// ---------------------------------------------------------------------------
// Offline rendering. The Babylon.js audio backend plays pre-rendered buffers
// as spatial sounds instead of building a node graph per sound. The synths
// above run unchanged against an OfflineAudioContext: for the (synchronous)
// duration of a build, the module's context, noise buffer, reverb send and
// random source point at the offline graph.
// ---------------------------------------------------------------------------

/** 32 kHz keeps the buffers small (Warcraft III itself shipped 22 kHz sounds); playback resamples. */
export const OFFLINE_RATE = 32000;
let offlineShared: { noise: AudioBuffer; impulse: AudioBuffer } | null = null;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Build `fn` (`dur` seconds long) into the offline context `oac`; returns when its last source stops and whether it used the reverb. */
function buildOffline(oac: OfflineAudioContext, fn: RenderFn, seed: number, reverb: boolean, dur: number): { end: number; wet: boolean } {
  const saved = { ctx, noiseBuf, reverbIn, musicDuck, rnd };
  try {
    ctx = oac;
    if (!offlineShared) offlineShared = { noise: makeNoiseBuffer(2), impulse: makeImpulse(1.8, 2.6) };
    noiseBuf = offlineShared.noise;
    musicDuck = null; // the backend ducks the live music itself
    rnd = mulberry32(seed);
    wetUsed = false;
    const out = oac.createGain();
    out.connect(oac.destination);
    reverbIn = oac.createGain();
    if (reverb) {
      const conv = oac.createConvolver();
      conv.buffer = offlineShared.impulse;
      const ret = oac.createGain();
      ret.gain.value = 0.55 / 0.9; // live, the dry signal passes sfxGain (0.9) and the reverb return doesn't
      reverbIn.connect(conv);
      conv.connect(ret);
      ret.connect(oac.destination);
    }
    const v = makeVoice('offline', 0, out, null);
    fn(v, 0, out, dur);
    return { end: v.end, wet: wetUsed };
  } finally {
    ({ ctx, noiseBuf, reverbIn, musicDuck, rnd } = saved);
  }
}

function monoBuffer(data: Float32Array<ArrayBuffer>, sampleRate: number): AudioBuffer {
  const buf = new AudioBuffer({ length: Math.max(1, data.length), numberOfChannels: 1, sampleRate });
  buf.copyToChannel(data, 0);
  return buf;
}

/** Drop the silent tail; optionally scale to a peak level. */
function trimTail(buf: AudioBuffer, normalize: number): AudioBuffer {
  const d = buf.getChannelData(0);
  let last = d.length - 1;
  let peak = 0;
  while (last > 0 && Math.abs(d[last]!) < 1e-4) last--;
  for (let i = 0; i <= last; i++) peak = Math.max(peak, Math.abs(d[i]!));
  const out = d.slice(0, Math.min(d.length, last + Math.ceil(buf.sampleRate * 0.02)));
  if (normalize && peak > 0) {
    const k = normalize / peak;
    for (let i = 0; i < out.length; i++) out[i] = out[i]! * k;
  }
  return monoBuffer(out, buf.sampleRate);
}

/** Cut a seamless loop of `len` s after `pre` s, cross-fading the following `fold` s into its start. */
function foldLoop(buf: AudioBuffer, pre: number, len: number, fold: number): AudioBuffer {
  const sr = buf.sampleRate;
  const a = buf.getChannelData(0);
  const n = Math.round(len * sr);
  const x = Math.round(fold * sr);
  const p = Math.round(pre * sr);
  const out = a.slice(p, p + n);
  for (let i = 0; i < x; i++) {
    const k = i / x;
    out[i] = a[p + i]! * Math.sqrt(k) + a[p + n + i]! * Math.sqrt(1 - k);
  }
  return monoBuffer(out, sr);
}

/**
 * Render `fn(v, t, out, duration)` into a mono AudioBuffer (null where offline rendering is
 * unavailable). `seed` makes the render repeatable; `loop` renders a seamless loop of that many
 * seconds; `normalize` scales the result to that peak.
 */
export async function renderOffline(fn: RenderFn, { seed = 1, loop = 0, normalize = 0 } = {}): Promise<AudioBuffer | null> {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC) return null;
  const rate = OFFLINE_RATE;
  const PRE = 0.5;
  const FOLD = 1;
  let seconds: number;
  let reverb = false;
  if (loop) {
    seconds = PRE + loop + FOLD;
  } else {
    // A cheap first pass (never rendered) finds the length and whether the reverb is used.
    const probe = buildOffline(new OAC(1, 1, rate), fn, seed, false, 0);
    reverb = probe.wet;
    seconds = probe.end + (reverb ? 1.9 : 0.05);
  }
  const oac = new OAC(1, Math.ceil(seconds * rate), rate);
  buildOffline(oac, fn, seed, reverb, loop ? seconds : 0);
  const rendered = await oac.startRendering();
  return loop ? foldLoop(rendered, PRE, loop, FOLD) : trimTail(rendered, normalize);
}

/** Variant `variant` of a sound effect. */
export function renderSfx(name: string, variant = 0): Promise<AudioBuffer | null> {
  const def = SFX[name];
  return def ? renderOffline(def.fn, { seed: hashString(name) + variant * 7919 }) : Promise.resolve(null);
}

/** Line `line` of a voice's barks for `kind`, normalized to a common peak level (0: as synthesized). */
export function renderBark(voiceId: string, kind: BarkKind, line = 0, normalize = 0.5): Promise<AudioBuffer | null> {
  return renderOffline((v, t, out) => sBark(v, t, out, voiceId, kind, line), { seed: hashString(voiceId + kind) + line * 7919, normalize });
}

/** An ambient loop ('wind', 'crickets', 'drone') or a one-shot ('bird', with variants). */
export function renderAmbient(name: string, variant = 0): Promise<AudioBuffer | null> {
  const a = AMBIENT[name];
  if (!a) return Promise.resolve(null);
  return renderOffline(a.fn, { seed: hashString(name) + variant * 7919, loop: a.loop || 0 });
}

export const SFX_NAMES = Object.keys(SFX);

/** Limits and level of a sound effect (used by the Babylon.js backend). */
export function sfxInfo(name: string): { prio: number; max: number; gap: number; gain: number; duck: number } | null {
  const d = Object.prototype.hasOwnProperty.call(SFX, name) ? SFX[name] : null;
  if (!d) return null;
  return { prio: d.prio, max: d.max ?? MAX_PER_NAME, gap: d.gap ?? MIN_GAP, gain: d.gain ?? 1, duck: d.duck ?? 0 };
}

export const MAX_SFX_VOICES = MAX_VOICES;

/** The live AudioContext (null until initAudio). */
export function getAudioContext(): AudioContext | OfflineAudioContext | null {
  return ctx;
}

/** Where other engines' sound effects join the mix (before the compressor and the master volume). */
export function getSfxInput(): GainNode | null {
  return sfxGain;
}

/** True when sound can be heard now (not muted, context running or just resumed). */
export function canPlayNow(): boolean {
  return !muted && canPlay();
}

/** Lower the music for a fanfare played by another engine. */
export function duckMusicFor(seconds: number): void {
  if (ctx) duckMusic(ctx.currentTime + START_DELAY, seconds);
}
