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

/**
 * Shared limits of a family of effects (every melee hit, every gunshot, ...), on top of each
 * name's own: a 200-unit battle plays a handful of each family at a time, not dozens.
 */
export const SFX_GROUPS: Record<string, { max: number; gap: number }> = {
  melee: { max: 6, gap: 0.03 },
  shot: { max: 7, gap: 0.025 },
  impact: { max: 5, gap: 0.03 },
  boom: { max: 4, gap: 0.07 },
  death: { max: 4, gap: 0.09 },
  creature: { max: 2, gap: 0.6 },
  building: { max: 1, gap: 0.25 },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A unit acknowledging the player, Warcraft III style ('ready': it has just been trained). */
export type BarkKind = 'select' | 'move' | 'attack' | 'ready';
export const BARK_KINDS: readonly BarkKind[] = ['select', 'move', 'attack', 'ready'];

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
  /** Its group's stats (see SFX_GROUPS). */
  groupStats: NameStats | null;
  /** Requested volume (voice stealing prefers to drop the quietest). */
  vol: number;
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
  /** Key of SFX_GROUPS: a shared limit with similar effects. */
  group?: string;
}

interface SfxDef extends Throttle {
  fn: SfxFn;
  /** Seconds to lower the music for (fanfares). */
  duck?: number;
  /** Variants the Babylon.js backend renders (default 3; deaths and farm animals have more). */
  variants?: number;
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
 * offline, so a variant can be measured and then rendered identically (see renderOffline). It is
 * never Math.random: sounds are requested from inside simulation steps, and headless runs seed
 * Math.random, so the audio must not advance the game's sequence.
 */
let rnd = mulberry32((Date.now() ^ 0x5eed1e55) >>> 0);

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

/** The soft clipper's curve over inputs -2..2 (fed at half level): y = x up to 0.7, then a tanh knee to 1. */
function makeSoftClip(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= 0.7 ? a : 0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3));
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
  // A soft clipper after the master volume: transparent up to 0.7, then rounding off towards 1, so
  // the peaks of a big battle that slip past the compressor's attack never clip hard.
  const clipIn = ac.createGain();
  clipIn.gain.value = 0.5;
  const clip = ac.createWaveShaper();
  clip.curve = makeSoftClip();
  masterGain.connect(clipIn);
  clipIn.connect(clip);
  clip.connect(ac.destination);

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

function makeVoice(name: string, prio: number, out: GainNode | null, stats: NameStats | null, groupStats: NameStats | null = null, vol = 1): Voice {
  return {
    name,
    prio,
    out,
    stats,
    groupStats,
    vol,
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
  if (v.groupStats) v.groupStats.count--;
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
 * Free a slot for a sound of priority `prio` and volume `vol`; false if nothing may be stolen.
 * Lower-priority voices go first (the quietest, then the oldest); a voice of equal priority is
 * only stolen once it is past its attack and if it is no louder, so a burst of hits doesn't churn
 * and a far-off skirmish never cuts off the fight under the camera.
 */
function stealVoice(prio: number, vol = 1): boolean {
  const ac = ctx!;
  const now = ac.currentTime;
  let victim: Voice | null = null;
  for (const v of voices) {
    const ok = v.prio < prio || (v.prio === prio && now - v.start > 0.12 && v.vol <= vol);
    if (ok && (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.vol < victim.vol))) victim = v;
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

// ---------------------------------------------------------------------------
// Unit sounds (M14). Every unit sounds like what it is, in the manner of
// Warcraft III: a melee blow is the attacker's weapon on the target's
// material (a club thudding into flesh, a sword ringing off plate), missiles
// have their own launch and their own impact, and deaths, creatures,
// buildings and engines each get a voice. The mapping from unit types to these
// sounds lives in src/unitSounds.ts.
// ---------------------------------------------------------------------------

/** What a blow or a missile lands on (a unit's "armour sound"). */
export type Material = 'flesh' | 'metal' | 'wood' | 'stone' | 'bone' | 'water';
export const MATERIALS: readonly Material[] = ['flesh', 'metal', 'wood', 'stone', 'bone', 'water'];

/** A melee weapon (see sMelee). */
export type Weapon =
  | 'club' | 'tool' | 'sword' | 'saber' | 'katana' | 'axe' | 'spear' | 'hammer' | 'blade' | 'maul' | 'tusk'
  | 'bite' | 'fang' | 'claw' | 'fist' | 'energy';
/** How heavy each weapon's blows land (scales the struck material). */
const WEAPON_WEIGHT: Record<Weapon, number> = {
  club: 1, tool: 0.6, sword: 0.9, saber: 0.85, katana: 0.85, axe: 1.05, spear: 0.85, hammer: 1.25, blade: 1.35,
  maul: 1.45, tusk: 1.5, bite: 0.8, fang: 0.75, claw: 0.8, fist: 1.5, energy: 1,
};
export const WEAPONS = Object.keys(WEAPON_WEIGHT) as Weapon[];

/** A missile class for impacts that depend on the target's material (see sImpact). */
export type Missile = 'arrow' | 'blunt' | 'bullet' | 'beam' | 'rail';
export const MISSILES: readonly Missile[] = ['arrow', 'blunt', 'bullet', 'beam', 'rail'];

/** Options of cry(). */
interface CryOptions {
  /** Pitch contour (Hz), spread evenly over the duration. */
  f0: number[];
  /** Vowel targets (keys of VOWELS) spread over the duration. */
  vowels: string;
  dur: number;
  /** Formant scale: below 1 a bigger throat, above 1 a smaller one. */
  size?: number;
  /** Sub-octave buzz (growl, roughness). */
  rough?: number;
  /** Amplitude-modulation depth (0-1) and rate (Hz): a growl or a gurgle. */
  growl?: number;
  growlRate?: number;
  /** Noise through the formants (a breathy or hissing voice). */
  breath?: number;
  peak?: number;
  /** Attack (s). */
  a?: number;
  /** Vibrato depth (cents) and rate (Hz). */
  vib?: number;
  vibRate?: number;
  /** Saturation of the throat (>0: a strained, roaring voice). */
  drive?: number;
  src?: OscillatorType;
}

/**
 * A wordless voice: a buzzing source through three formants gliding along a vowel and a pitch
 * contour. Death cries, grunts, growls, howls, whinnies and moans are all made of this.
 */
function cry(v: Voice, t: number, o: CryOptions, dest: Dest): number {
  const dur = o.dur;
  const end = t + dur;
  const stop = end + 0.03;
  const size = o.size ?? 1;
  const peak = o.peak ?? 0.3;
  const a = Math.min(o.a ?? 0.03, dur * 0.4);
  const env = gainNode(v, 0, dest);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + a);
  env.gain.linearRampToValueAtTime(peak * 0.7, t + dur * 0.65);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  let into: AudioNode = env;
  if (o.drive) into = gainNode(v, o.drive, shaper(v, gainNode(v, 0.6, env)));
  if (o.growl) {
    const am = gainNode(v, 1 - o.growl * 0.5, into);
    oscNode(v, 'sine', o.growlRate ?? 30, t, stop, gainNode(v, o.growl * 0.5, am.gain));
    into = am;
  }
  const bank = gainNode(v, 1.5, into);
  const vox = gainNode(v, 1, null);
  const vowels = o.vowels.split('').map((c) => VOWELS[c] ?? VOWELS.a!);
  const filters = [0, 1, 2].map((k) => {
    const f = biquad(v, 'bandpass', vowels[0]![k]! * size, FORMANT_Q[k], gainNode(v, FORMANT_AMP[k]!, bank));
    vox.connect(f);
    for (let i = 1; i < vowels.length; i++) f.frequency.linearRampToValueAtTime(vowels[i]![k]! * size, t + (dur * i) / (vowels.length - 1));
    return f;
  });
  if (o.breath) {
    const asp = gainNode(v, o.breath, null);
    for (const f of filters) asp.connect(f);
    noiseNode(v, t, stop, asp);
  }
  const f0 = o.f0;
  const glide = (osc: OscillatorNode, r: number): void => {
    osc.frequency.setValueAtTime(f0[0]! * r, t);
    for (let i = 1; i < f0.length; i++) osc.frequency.linearRampToValueAtTime(f0[i]! * r, t + (dur * i) / (f0.length - 1));
  };
  const oscs = [oscNode(v, o.src ?? 'sawtooth', f0[0]!, t, stop, vox), oscNode(v, 'sawtooth', f0[0]!, t, stop, gainNode(v, 0.45, vox))];
  oscs[1]!.detune.value = 9;
  for (const osc of oscs) glide(osc, 1);
  if (o.rough) {
    const sub = oscNode(v, 'square', f0[0]! / 2, t, stop, gainNode(v, o.rough * 0.6, vox));
    glide(sub, 0.5);
    oscs.push(sub);
  }
  const vib = oscNode(v, 'sine', o.vibRate ?? rand(5, 6.5), t, stop, null);
  const vg = gainNode(v, o.vib ?? 12, null);
  vib.connect(vg);
  for (const osc of oscs) vg.connect(osc.detune);
  return end;
}

/** Wood under strain: a saw stick-slipping through a resonant band (`f` Hz squeaks, `rate` per second). */
function creak(v: Voice, t: number, dur: number, f: number, peak: number, dest: Dest, rate = 28): void {
  const g = gainNode(v, 0, dest);
  const bp = biquad(v, 'bandpass', f * 6, 6, g);
  oscNode(v, 'sawtooth', f, t, t + dur + 0.02, bp);
  const G = g.gain;
  G.setValueAtTime(0, t);
  for (let tt = t; tt < t + dur; tt += (1 / rate) * rand(0.6, 1.4)) {
    G.setValueAtTime(peak * rand(0.3, 1) * Math.sin((Math.PI * (tt - t)) / dur), tt);
    G.setTargetAtTime(0, tt + 0.004, 0.006);
  }
  G.setValueAtTime(0, t + dur);
}

/** `n` small pieces falling and bouncing over `dur` s: pitched clicks of a material. */
function debris(v: Voice, t: number, dur: number, n: number, mat: 'stone' | 'wood' | 'metal' | 'bone', peak: number, dest: Dest): void {
  for (let i = 0; i < n; i++) {
    const tt = t + dur * Math.pow(rnd(), 0.7);
    const lvl = peak * rand(0.3, 1) * (1 - (tt - t) / (dur * 1.4));
    if (mat === 'metal') ping(v, tt, rand(1400, 3800), lvl * 0.5, rand(0.05, 0.14), dest, 'sine', 0.0005);
    else if (mat === 'bone') ping(v, tt, rand(1300, 2800), lvl * 0.6, rand(0.02, 0.04), dest, 'triangle', 0.0005);
    else {
      noiseBurst(v, tt, { type: 'bandpass', freq: mat === 'wood' ? rand(700, 1500) : rand(1200, 3200), Q: 3, a: 0.0006, peak: lvl, d: rand(0.015, 0.04), dest });
    }
  }
}

/** Bubbles rising (water). */
function bubbles(v: Voice, t: number, dur: number, n: number, peak: number, dest: Dest): void {
  for (let i = 0; i < n; i++) {
    const tt = t + rand(0, dur);
    const f = rand(280, 900);
    const g = gainNode(v, 0, dest);
    perc(g.gain, tt, 0.003, peak * rand(0.5, 1), rand(0.04, 0.08));
    const o = oscNode(v, 'sine', f, tt, tt + 0.1, g);
    sweep(o.frequency, tt, f, f * rand(1.8, 2.8), 0.06);
  }
}

/** The swish of a swung weapon or a missile in flight: a noise band sweeping `f0` -> `f1`. */
function swish(v: Voice, t: number, f0: number, f1: number, dur: number, peak: number, dest: Dest, Q = 1.8): void {
  noiseBurst(v, t, { type: 'bandpass', freq: f0, freqTo: f1, sweep: dur, Q, a: dur * 0.6, peak, d: dur * 0.6, dest });
}

/** A single gunshot: supersonic crack, the body of the blast and a thump (`size` ~0.5 pistol .. 1.5 heavy). */
function shot(v: Voice, t: number, size: number, dest: Dest, bright = 1): void {
  const p = rand(0.92, 1.08);
  noiseBurst(v, t, { type: 'highpass', freq: 1500 * bright * p, a: 0.0003, peak: 0.6 * size, d: 0.02, dest });
  noiseBurst(v, t, { type: 'bandpass', freq: (1000 / Math.sqrt(size)) * bright * p, Q: 0.9, a: 0.0005, peak: 0.55 * size, d: 0.035 + 0.03 * size, dest });
  thump(v, t, 170 * p, 55, 0.4 * size, 0.04 + 0.03 * size, dest);
}

/**
 * The sound of the struck material; `w` is the weight of the blow (0.5 light .. 1.6 crushing).
 * Flesh thuds and slaps, armour rings, wood knocks, stone cracks and grits, bone clacks, water splashes.
 */
function strike(v: Voice, t: number, mat: Material, w: number, dest: Dest): void {
  const p = rand(0.9, 1.1);
  const k = Math.min(1.3, w);
  switch (mat) {
    case 'flesh':
      thump(v, t, (190 * p) / Math.sqrt(w), 60 * p, 0.6 * k, 0.07 + 0.05 * w, dest);
      noiseBurst(v, t, { type: 'bandpass', freq: 700 * p, Q: 1.3, a: 0.002, peak: 0.42 * k, d: 0.045 + 0.03 * w, dest });
      noiseBurst(v, t + 0.006, { type: 'bandpass', freq: 2300 * p, Q: 2, a: 0.001, peak: 0.12 * k, d: 0.03, dest });
      break;
    case 'metal': {
      noiseBurst(v, t, { type: 'highpass', freq: 2800, a: 0.0005, peak: 0.4 * k, d: 0.025, dest });
      const base = (rand(620, 820) * p) / Math.sqrt(w);
      const ring = 0.7 + 0.3 * w;
      metal(v, t, base, [1, 1.47, 2.09, 2.76, 3.65], [0.15 * k, 0.11 * k, 0.09 * k, 0.06 * k, 0.04 * k], [0.22 * ring, 0.17 * ring, 0.12 * ring, 0.09 * ring, 0.06 * ring], dest);
      thump(v, t, 300 * p, 140 * p, 0.28 * k, 0.05, dest, 'triangle');
      break;
    }
    case 'wood':
      noiseBurst(v, t, { type: 'bandpass', freq: 950 * p, Q: 3, a: 0.001, peak: 0.6 * k, d: 0.06, dest });
      thump(v, t, 230 * p, 130 * p, 0.45 * k, 0.08, dest);
      ping(v, t, 560 * p, 0.14 * k, 0.05, dest, 'triangle', 0.0008);
      break;
    case 'stone':
      noiseBurst(v, t, { type: 'bandpass', freq: 2600 * p, Q: 0.8, a: 0.0005, peak: 0.45 * k, d: 0.03, dest });
      thump(v, t, 140 * p, 55, 0.5 * k, 0.09, dest);
      noiseBurst(v, t, { type: 'lowpass', freq: 600, a: 0.001, peak: 0.3 * k, d: 0.1, dest });
      debris(v, t + 0.01, 0.12, 4, 'stone', 0.18 * k, dest);
      break;
    case 'bone':
      ping(v, t, 1900 * p, 0.32 * k, 0.035, dest, 'triangle', 0.0005);
      ping(v, t, 2950 * p, 0.16 * k, 0.025, dest, 'triangle', 0.0005);
      noiseBurst(v, t, { type: 'bandpass', freq: 2400 * p, Q: 4, a: 0.0005, peak: 0.6 * k, d: 0.02, dest });
      thump(v, t, 260 * p, 140 * p, 0.25 * k, 0.04, dest, 'triangle');
      debris(v, t + 0.02, 0.12, 3, 'bone', 0.4 * k, dest);
      break;
    case 'water':
      noiseBurst(v, t, { type: 'bandpass', freq: 1800 * p, freqTo: 500 * p, sweep: 0.18, Q: 0.9, a: 0.004, peak: 0.75 * k, d: 0.18, dest });
      bubbles(v, t + 0.02, 0.18, 4, 0.2 * k, dest);
      break;
  }
}

// --- melee -----------------------------------------------------------------

/** A melee blow: the weapon's swing and its own voice, then the struck material. */
function sMelee(v: Voice, t: number, out: GainNode, weapon: Weapon, mat: Material): void {
  const w = WEAPON_WEIGHT[weapon] * rand(0.92, 1.08);
  const p = rand(0.92, 1.08);
  // The swing leads the impact a little (heavy weapons start their swing earlier).
  const s = t + 0.03;
  const hit = s + 0.03;
  switch (weapon) {
    case 'club':
      swish(v, s, 350 * p, 900 * p, 0.06, 0.16, out);
      noiseBurst(v, hit, { type: 'bandpass', freq: 520 * p, Q: 2, a: 0.001, peak: 0.45, d: 0.07, dest: out });
      thump(v, hit, 150 * p, 80 * p, 0.45, 0.09, out);
      break;
    case 'tool':
      swish(v, s, 600 * p, 1400 * p, 0.05, 0.1, out);
      ping(v, hit, 1100 * p, 0.12, 0.05, out, 'triangle', 0.0008);
      break;
    case 'sword':
    case 'saber': {
      const hi = weapon === 'saber' ? 1.2 : 1;
      swish(v, s, 1200 * p * hi, 3200 * p * hi, 0.055, 0.2, out, 2);
      metal(v, hit, rand(1250, 1450) * p * hi, [1, 1.52, 2.17, 2.73], [0.07, 0.05, 0.04, 0.03], [0.25, 0.18, 0.12, 0.09], out);
      break;
    }
    case 'katana':
      swish(v, s - 0.01, 1800 * p, 4800 * p, 0.05, 0.24, out, 3);
      metal(v, hit, rand(1900, 2150) * p, [1, 1.5, 2.3, 3.2], [0.09, 0.06, 0.04, 0.03], [0.4, 0.28, 0.18, 0.12], out);
      break;
    case 'axe':
      swish(v, s, 600 * p, 1500 * p, 0.06, 0.2, out);
      noiseBurst(v, hit, { type: 'bandpass', freq: 800 * p, Q: 1.8, a: 0.001, peak: 0.45, d: 0.07, dest: out });
      metal(v, hit, rand(880, 980) * p, [1, 1.61, 2.4], [0.06, 0.04, 0.03], [0.18, 0.12, 0.08], out);
      break;
    case 'spear':
      swish(v, s, 900 * p, 2400 * p, 0.05, 0.22, out, 2.5);
      ping(v, hit, 380 * p, 0.14, 0.05, out, 'triangle', 0.0008); // the shaft knocks
      noiseBurst(v, hit, { type: 'bandpass', freq: 1700 * p, Q: 2, a: 0.0006, peak: 0.25, d: 0.03, dest: out });
      break;
    case 'hammer':
      swish(v, s, 300 * p, 700 * p, 0.07, 0.2, out);
      metal(v, hit, rand(420, 520) * p, [1, 1.6, 2.3, 3.1], [0.13, 0.09, 0.06, 0.04], [0.35, 0.25, 0.18, 0.12], out);
      thump(v, hit, 120 * p, 50, 0.5, 0.15, out);
      break;
    case 'blade':
      swish(v, s - 0.02, 500 * p, 1600 * p, 0.08, 0.28, out);
      metal(v, hit, rand(820, 920) * p, [1, 1.38, 1.95, 2.6, 3.3], [0.1, 0.08, 0.06, 0.04, 0.03], [0.45, 0.32, 0.22, 0.15, 0.1], out);
      thump(v, hit, 140 * p, 50, 0.45, 0.12, out);
      break;
    case 'maul':
      swish(v, s - 0.03, 250 * p, 600 * p, 0.09, 0.3, out);
      thump(v, hit, 110 * p, 40, 0.85, 0.2, out);
      noiseBurst(v, hit, { type: 'lowpass', freq: 600, a: 0.001, peak: 0.5, d: 0.1, dest: out });
      noiseBurst(v, hit, { type: 'bandpass', freq: 420 * p, Q: 2.2, a: 0.001, peak: 0.35, d: 0.08, dest: out });
      break;
    case 'tusk':
      thump(v, hit, 90 * p, 35, 1.0, 0.25, out);
      noiseBurst(v, hit, { type: 'lowpass', freq: 400, a: 0.002, peak: 0.6, d: 0.15, dest: out });
      swish(v, s - 0.03, 200 * p, 500 * p, 0.1, 0.25, out, 1);
      break;
    case 'bite':
      cry(v, s - 0.03, { f0: [300 * p, 220 * p], vowels: 'ao', dur: 0.18, size: 0.9, rough: 0.6, growl: 0.7, growlRate: 45, peak: 0.25, drive: 2 }, out);
      noiseBurst(v, hit, { type: 'bandpass', freq: 3200 * p, Q: 2, a: 0.0005, peak: 0.4, d: 0.02, dest: out });
      ping(v, hit, 2100 * p, 0.14, 0.02, out, 'triangle', 0.0005); // the jaws snap shut
      break;
    case 'fang':
      noiseBurst(v, t, { type: 'highpass', freq: 4200, a: 0.03, peak: 0.18, d: 0.08, dest: out }); // hiss
      noiseBurst(v, hit, { type: 'bandpass', freq: 1500 * p, Q: 3, a: 0.0006, peak: 0.35, d: 0.03, dest: out });
      ping(v, hit, 2600 * p, 0.08, 0.02, out, 'triangle', 0.0005);
      debris(v, hit, 0.06, 2, 'bone', 0.12, out); // legs clicking
      break;
    case 'claw':
      swish(v, s, 1500 * p, 3500 * p, 0.05, 0.22, out, 1.2);
      for (let i = 0; i < 3; i++) noiseBurst(v, hit + i * 0.012, { type: 'bandpass', freq: rand(2500, 4000), Q: 2, a: 0.0005, peak: 0.2, d: 0.02, dest: out });
      break;
    case 'fist':
      swish(v, s - 0.03, 200 * p, 450 * p, 0.09, 0.22, out, 1);
      thump(v, hit, 100 * p, 38, 1.0, 0.22, out);
      noiseBurst(v, hit, { type: 'bandpass', freq: 1800 * p, Q: 0.9, a: 0.0005, peak: 0.4, d: 0.04, dest: out });
      debris(v, hit + 0.01, 0.2, 6, 'stone', 0.22, out);
      break;
    case 'energy': {
      // a humming blade swipes and discharges
      const g = gainNode(v, 0, out);
      perc(g.gain, t, 0.01, 0.2, 0.12);
      const o = oscNode(v, 'sawtooth', 140 * p, t, t + 0.15, biquad(v, 'bandpass', 900, 2, g));
      sweep(o.frequency, t, 140 * p, 420 * p, 0.1);
      noiseBurst(v, hit, { type: 'highpass', freq: 3000, a: 0.0006, peak: 0.35, d: 0.05, dest: out });
      fmBell(v, hit, 1200 * p, 1.41, 800, 0.1, 0.2, out);
      break;
    }
  }
  strike(v, hit, mat, w, out);
}

// --- impacts ----------------------------------------------------------------

/** A missile lands on a unit: the projectile's own sound, then the struck material. */
function sImpact(v: Voice, t: number, out: GainNode, missile: Missile, mat: Material): void {
  const p = rand(0.92, 1.08);
  switch (missile) {
    case 'arrow':
      noiseBurst(v, t, { type: 'bandpass', freq: 1500 * p, Q: 2.5, a: 0.0005, peak: 0.35, d: 0.03, dest: out }); // the tip
      strike(v, t, mat, 0.55, out);
      if (mat === 'flesh' || mat === 'wood') ping(v, t + 0.004, rand(170, 230), 0.1, 0.12, out, 'triangle'); // the shaft quivers
      break;
    case 'blunt':
      thump(v, t, 160 * p, 70, 0.3, 0.08, out);
      strike(v, t, mat, 0.75, out);
      break;
    case 'bullet':
      if (mat === 'metal' || mat === 'stone') {
        // a ricochet
        noiseBurst(v, t, { type: 'highpass', freq: 3500, a: 0.0004, peak: 0.4, d: 0.02, dest: out });
        const g = gainNode(v, 0, out);
        perc(g.gain, t + 0.01, 0.003, 0.11, 0.24);
        const o = oscNode(v, 'sine', rand(2600, 3600), t + 0.01, t + 0.3, g);
        sweep(o.frequency, t + 0.01, o.frequency.value, o.frequency.value * 0.5, 0.25);
        oscNode(v, 'sine', 31, t, t + 0.3, gainNode(v, 60, o.detune));
        strike(v, t, mat, 0.45, out);
      } else {
        noiseBurst(v, t, { type: 'bandpass', freq: 2800 * p, Q: 1.5, a: 0.0004, peak: 0.35, d: 0.015, dest: out });
        strike(v, t, mat, 0.6, out);
      }
      break;
    case 'beam': {
      // a sizzle and a quick downward zap
      noiseBurst(v, t, { type: 'highpass', freq: 2500, a: 0.002, peak: 0.3, d: 0.12, dest: out });
      const g = gainNode(v, 0, out);
      perc(g.gain, t, 0.002, 0.12, 0.13);
      const o = oscNode(v, 'sawtooth', 900 * p, t, t + 0.16, biquad(v, 'bandpass', 1400, 1.5, g));
      sweep(o.frequency, t, 900 * p, 260 * p, 0.12);
      strike(v, t, mat, 0.3, out);
      break;
    }
    case 'rail':
      noiseBurst(v, t, { type: 'highpass', freq: 1500, a: 0.0004, peak: 0.55, d: 0.04, dest: out });
      metal(v, t, rand(1600, 1800), [1, 1.33, 1.9], [0.06, 0.05, 0.04], [0.3, 0.2, 0.14], out);
      strike(v, t, mat, 0.8, out);
      break;
  }
}

function sImpHoly(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.97, 1.03);
  chime(v, t, mtof(88) * p, 0.12, 0.4, out);
  noiseBurst(v, t, { type: 'highpass', freq: 6000, a: 0.002, peak: 0.15, d: 0.2, dest: out });
  thump(v, t, 400 * p, 200 * p, 0.2, 0.06, out);
}

function sImpArcane(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.94, 1.06);
  fmBell(v, t, 700 * p, 2.7, 500, 0.15, 0.3, out);
  noiseBurst(v, t, { type: 'bandpass', freq: 3000 * p, Q: 1.2, a: 0.001, peak: 0.3, d: 0.08, dest: out });
  for (let i = 0; i < 4; i++) ping(v, t + rand(0, 0.12), rand(2500, 5000), 0.05, rand(0.08, 0.16), out);
}

function sImpFrost(v: Voice, t: number, out: GainNode): void {
  noiseBurst(v, t, { type: 'highpass', freq: 4000, a: 0.0005, peak: 0.4, d: 0.04, dest: out });
  for (const m of [96, 100, 103]) ping(v, t + rand(0, 0.04), mtof(m) * rand(0.99, 1.01), 0.07, rand(0.15, 0.25), out);
  crackle(v, t, 0.15, 6, 0.2, 5000, out);
  thump(v, t, 300, 120, 0.25, 0.06, out);
}

function sImpWater(v: Voice, t: number, out: GainNode): void {
  strike(v, t, 'water', 1.1, out);
  thump(v, t, 200, 80, 0.25, 0.08, out);
}

function sImpFel(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.94, 1.06);
  const g = gainNode(v, 0, out);
  perc(g.gain, t, 0.003, 0.3, 0.25);
  const lp = biquad(v, 'lowpass', 1200, 2, g);
  for (const f of [220, 233]) {
    const o = oscNode(v, 'sawtooth', f * p, t, t + 0.3, lp);
    sweep(o.frequency, t, f * p, f * 0.4 * p, 0.25);
  }
  noiseBurst(v, t, { type: 'bandpass', freq: 900, Q: 1, a: 0.002, peak: 0.35, d: 0.15, dest: out });
}

function sImpFire(v: Voice, t: number, out: GainNode): void {
  noiseBurst(v, t, { type: 'bandpass', freq: 600, freqTo: 1800, Q: 0.9, a: 0.02, peak: 0.5, d: 0.25, dest: out });
  crackle(v, t + 0.02, 0.3, 8, 0.3, 1800, out);
  thump(v, t, 150, 60, 0.35, 0.1, out);
}

/** A missile buries itself in the ground (the target got away or died). */
function sMissGround(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.9, 1.1);
  noiseBurst(v, t, { type: 'lowpass', freq: 700 * p, a: 0.001, peak: 0.45, d: 0.06, dest: out });
  thump(v, t, 200 * p, 80, 0.3, 0.06, out);
  crackle(v, t, 0.08, 4, 0.12, 2500, out);
}

// --- explosions (splash) -----------------------------------------------------

/** A boulder lands (catapult, trebuchet): a crash and a shower of stone. */
function sBoomRock(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.88, 1.08);
  thump(v, t, 90 * p, 35, 1.0, 0.35, out);
  noiseBurst(v, t, { type: 'lowpass', freq: 900 * p, freqTo: 150, sweep: 0.4, a: 0.003, peak: 0.8, d: 0.4, dest: out });
  noiseBurst(v, t, { type: 'bandpass', freq: 1800 * p, Q: 0.8, a: 0.0005, peak: 0.45, d: 0.05, dest: out });
  debris(v, t + 0.03, 0.5, 12, 'stone', 0.35, out);
  crackle(v, t + 0.05, 0.4, 8, 0.15, 1500, out);
}

/** A black-powder bomb: a sharp bang and shrapnel. */
function sBoomGrenade(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.12);
  const p = rand(0.9, 1.1);
  noiseBurst(v, t, { type: 'highpass', freq: 1500 * p, a: 0.0004, peak: 0.7, d: 0.05, dest: out });
  noiseBurst(v, t, { type: 'lowpass', freq: 1800 * p, freqTo: 200, sweep: 0.3, a: 0.001, peak: 0.8, d: 0.35, dest: out });
  thump(v, t, 140 * p, 45, 0.8, 0.25, out);
  crackle(v, t + 0.02, 0.3, 10, 0.3, 3500, out);
}

/** A cannonball strikes: boom and a spray of dirt. */
function sBoomCannon(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.15);
  const p = rand(0.88, 1.06);
  thump(v, t, 100 * p, 30, 1.0, 0.4, out);
  noiseBurst(v, t, { type: 'lowpass', freq: 1400 * p, freqTo: 100, sweep: 0.5, a: 0.002, peak: 0.9, d: 0.6, dest: out });
  noiseBurst(v, t, { type: 'bandpass', freq: 2200, Q: 0.9, a: 0.0005, peak: 0.35, d: 0.05, dest: out });
  crackle(v, t + 0.05, 0.5, 10, 0.25, 1200, out);
}

/** An artillery or tank shell: a big, punchy blast. */
function sBoomShell(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.22);
  const p = rand(0.85, 1.05);
  thump(v, t, 80 * p, 25, 1.0, 0.6, out);
  noiseBurst(v, t, { type: 'lowpass', freq: 2200 * p, freqTo: 80, sweep: 0.8, Q: 0.8, a: 0.003, peak: 1.0, d: 0.9, dest: out });
  noiseBurst(v, t, { type: 'bandpass', freq: 2500, Q: 0.8, a: 0.0005, peak: 0.5, d: 0.08, dest: out });
  crackle(v, t + 0.06, 0.7, 12, 0.3, 2000, out);
}

function sBoomRocket(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.2);
  const p = rand(0.88, 1.08);
  noiseBurst(v, t, { type: 'highpass', freq: 1000 * p, a: 0.0005, peak: 0.6, d: 0.06, dest: out });
  noiseBurst(v, t, { type: 'lowpass', freq: 1800 * p, freqTo: 120, sweep: 0.5, a: 0.002, peak: 0.9, d: 0.6, dest: out });
  thump(v, t, 120 * p, 35, 0.9, 0.4, out);
  crackle(v, t + 0.04, 0.5, 10, 0.25, 2200, out);
}

/** A plasma bolt bursts: an energy blast with a falling, bubbling FM tone. */
function sBoomPlasma(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.25);
  const p = rand(0.9, 1.1);
  const g = gainNode(v, 0, out);
  perc(g.gain, t, 0.004, 0.4, 0.5);
  const car = oscNode(v, 'sine', 900 * p, t, t + 0.56, g);
  sweep(car.frequency, t, 900 * p, 110 * p, 0.45);
  const mg = gainNode(v, 0, car.frequency);
  perc(mg.gain, t, 0.002, 700, 0.35);
  oscNode(v, 'sine', 1260 * p, t, t + 0.56, mg);
  noiseBurst(v, t, { type: 'bandpass', freq: 2000 * p, freqTo: 400, sweep: 0.35, Q: 1, a: 0.002, peak: 0.6, d: 0.35, dest: out });
  thump(v, t, 110 * p, 30, 0.8, 0.35, out);
  crackle(v, t + 0.02, 0.3, 8, 0.2, 4000, out);
}

/** The graviton lance: the air is sucked in, then a deep, crushing blast. */
function sBoomGraviton(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.4);
  const p = rand(0.95, 1.05);
  noiseBurst(v, t, { type: 'bandpass', freq: 200, freqTo: 2500, sweep: 0.28, Q: 1.5, a: 0.25, peak: 0.35, d: 0.04, dest: out });
  const b = t + 0.28;
  thump(v, b, 70 * p, 18, 1.0, 0.9, out);
  noiseBurst(v, b, { type: 'lowpass', freq: 1500 * p, freqTo: 50, sweep: 1.2, Q: 0.7, a: 0.003, peak: 0.9, d: 1.2, dest: out });
  const g = gainNode(v, 0, out);
  perc(g.gain, b, 0.01, 0.35, 1.0);
  const o = oscNode(v, 'sine', 48, b, b + 1.05, g);
  oscNode(v, 'sine', 7, b, b + 1.05, gainNode(v, 12, o.frequency));
}

/** A battle mage's or a drake's fireball bursts: a whoomp and crackling flames. */
function sBoomFire(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.15);
  const p = rand(0.9, 1.1);
  noiseBurst(v, t, { type: 'lowpass', freq: 1200 * p, freqTo: 300, sweep: 0.3, a: 0.004, peak: 0.75, d: 0.35, dest: out });
  noiseBurst(v, t, { type: 'bandpass', freq: 500 * p, freqTo: 1600 * p, Q: 0.9, a: 0.03, peak: 0.5, d: 0.5, dest: out });
  crackle(v, t + 0.03, 0.6, 14, 0.35, 1800, out);
  thump(v, t, 130 * p, 50, 0.6, 0.2, out);
}

/** Flames splash over the target (flamethrower). */
function sFlameLick(v: Voice, t: number, out: GainNode): void {
  noiseBurst(v, t, { type: 'bandpass', freq: 900, freqTo: 2200, Q: 0.8, a: 0.02, peak: 0.35, d: 0.3, dest: out });
  crackle(v, t, 0.4, 10, 0.25, 2500, out);
}

// --- missiles: the shot or throw at the attacker ---------------------------

/** A bow: a resonant string release and the arrow's whoosh (`f` string pitch, `len` 1 short bow .. 1.4 longbow). */
function bow(v: Voice, t: number, out: GainNode, f: number, q: number, whooshF: number, len: number): void {
  const p = rand(0.94, 1.06);
  const g = gainNode(v, 0, out);
  const lp = biquad(v, 'lowpass', 3200, q, g);
  perc(g.gain, t, 0.002, 0.34, 0.15 * len);
  sweep(lp.frequency, t, 3200, 280, 0.12 * len);
  const o = oscNode(v, 'sawtooth', f * p, t, t + 0.2 * len + 0.05, lp);
  sweep(o.frequency, t, f * p, f * 0.74 * p, 0.12);
  noiseBurst(v, t, { type: 'bandpass', freq: 3600, Q: 2, a: 0.0005, peak: 0.25, d: 0.012, dest: out }); // the fingers let go
  noiseBurst(v, t + 0.012, { type: 'bandpass', freq: whooshF * p, freqTo: whooshF * 0.35 * p, Q: 2.6, a: 0.025, peak: 0.42, d: 0.16 * len, dest: out });
}

function sBowShot(v: Voice, t: number, out: GainNode): void {
  bow(v, t, out, 250, 6, 2700, 1);
}

function sLongbowShot(v: Voice, t: number, out: GainNode): void {
  bow(v, t, out, 165, 8, 2300, 1.4);
}

function sCrossbow(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.94, 1.06);
  noiseBurst(v, t, { type: 'highpass', freq: 3000, a: 0.0005, peak: 0.45, d: 0.012, dest: out }); // the trigger
  thump(v, t + 0.004, 260 * p, 120 * p, 0.5, 0.06, out, 'triangle'); // the stock knocks
  noiseBurst(v, t + 0.004, { type: 'bandpass', freq: 1200 * p, Q: 3, a: 0.0008, peak: 0.45, d: 0.05, dest: out });
  // a short, stiff string snap
  const g = gainNode(v, 0, out);
  const lp = biquad(v, 'lowpass', 4500, 9, g);
  perc(g.gain, t + 0.004, 0.001, 0.25, 0.06);
  sweep(lp.frequency, t + 0.004, 4500, 500, 0.05);
  oscNode(v, 'sawtooth', 340 * p, t + 0.004, t + 0.1, lp);
  noiseBurst(v, t + 0.01, { type: 'bandpass', freq: 3200 * p, freqTo: 1300 * p, Q: 3, a: 0.012, peak: 0.35, d: 0.09, dest: out });
  // and the windlass ratchets the next bolt in
  for (let i = 0; i < 3; i++) noiseBurst(v, t + 0.45 + i * 0.07, { type: 'bandpass', freq: 2600, Q: 5, a: 0.0005, peak: 0.12, d: 0.015, dest: out });
}

function sSling(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.9, 1.1);
  // two quick whirls of the sling, the strap snaps taut and the stone flies off
  for (let i = 0; i < 2; i++) swish(v, t + i * 0.09, 500 * p, 1300 * p, 0.07, 0.2 + i * 0.1, out, 2);
  ping(v, t + 0.18, 240 * p, 0.14, 0.04, out, 'triangle');
  noiseBurst(v, t + 0.19, { type: 'bandpass', freq: 1600 * p, freqTo: 600 * p, Q: 2.2, a: 0.008, peak: 0.3, d: 0.2, dest: out });
}

function sJavelin(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  cry(v, t, { f0: [175 * p, 135 * p], vowels: 'au', dur: 0.11, rough: 0.2, breath: 0.3, peak: 0.09 }, out); // "hup"
  swish(v, t + 0.04, 700 * p, 1500 * p, 0.1, 0.28, out);
  noiseBurst(v, t + 0.12, { type: 'bandpass', freq: 1100 * p, freqTo: 420 * p, Q: 3, a: 0.05, peak: 0.32, d: 0.35, dest: out });
}

function sBallista(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.94, 1.06);
  const g = gainNode(v, 0, out);
  const lp = biquad(v, 'lowpass', 2000, 7, g);
  perc(g.gain, t, 0.002, 0.45, 0.3);
  sweep(lp.frequency, t, 2000, 200, 0.25);
  oscNode(v, 'sawtooth', 95 * p, t, t + 0.35, lp);
  thump(v, t, 160 * p, 60, 0.7, 0.12, out);
  noiseBurst(v, t, { type: 'bandpass', freq: 700 * p, Q: 2, a: 0.001, peak: 0.5, d: 0.08, dest: out });
  noiseBurst(v, t + 0.02, { type: 'bandpass', freq: 1600 * p, freqTo: 500 * p, Q: 2.5, a: 0.03, peak: 0.45, d: 0.3, dest: out });
  creak(v, t + 0.5, 0.35, 70 * p, 0.25, out, 22); // winding back
}

function sCatapult(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.06);
  creak(v, t, 0.16, 65 * p, 0.3, out);
  const r = t + 0.14;
  noiseBurst(v, r, { type: 'bandpass', freq: 2000, Q: 2, a: 0.0005, peak: 0.25, d: 0.02, dest: out }); // the rope lets go
  noiseBurst(v, r, { type: 'bandpass', freq: 400 * p, freqTo: 900 * p, Q: 1.5, a: 0.08, peak: 0.5, d: 0.3, dest: out });
  const s = r + 0.12;
  thump(v, s, 110 * p, 45, 1.0, 0.3, out); // the arm slams into its stop
  noiseBurst(v, s, { type: 'bandpass', freq: 380 * p, Q: 1.5, a: 0.001, peak: 0.6, d: 0.12, dest: out });
}

function sTrebuchet(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.15);
  const p = rand(0.94, 1.04);
  creak(v, t, 0.3, 55 * p, 0.3, out, 20);
  const r = t + 0.25;
  noiseBurst(v, r, { type: 'bandpass', freq: 300 * p, freqTo: 800 * p, Q: 1.2, a: 0.15, peak: 0.45, d: 0.35, dest: out }); // the great arm swings
  swish(v, r + 0.25, 600 * p, 2400 * p, 0.12, 0.35, out, 2); // the sling whips
  thump(v, r + 0.12, 70 * p, 30, 0.9, 0.5, out); // the counterweight drops
  noiseBurst(v, r + 0.12, { type: 'lowpass', freq: 300, a: 0.01, peak: 0.4, d: 0.5, dest: out });
}

function sMusket(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.2);
  const p = rand(0.9, 1.08);
  // the pan flashes, then the charge goes off a moment later
  noiseBurst(v, t, { type: 'highpass', freq: 3000, a: 0.002, peak: 0.22, d: 0.04, dest: out });
  crackle(v, t, 0.04, 3, 0.18, 4000, out);
  const b = t + 0.045;
  noiseBurst(v, b, { type: 'highpass', freq: 700 * p, a: 0.0005, peak: 0.85, d: 0.06, dest: out });
  noiseBurst(v, b, { type: 'lowpass', freq: 1100 * p, freqTo: 150, sweep: 0.3, a: 0.001, peak: 0.8, d: 0.4, dest: out });
  thump(v, b, 140 * p, 40, 0.7, 0.18, out);
  // black powder crackles and fizzes as the smoke rolls out
  crackle(v, b + 0.04, 0.45, 12, 0.22, 2200, out);
  noiseBurst(v, b + 0.05, { type: 'bandpass', freq: 2500, Q: 0.7, a: 0.05, peak: 0.08, d: 0.35, dest: out });
}

function sRifle(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.12);
  const p = rand(0.92, 1.06);
  noiseBurst(v, t, { type: 'highpass', freq: 1500, a: 0.0003, peak: 0.85, d: 0.025, dest: out });
  noiseBurst(v, t, { type: 'bandpass', freq: 1100 * p, Q: 0.8, a: 0.0005, peak: 0.65, d: 0.09, dest: out });
  noiseBurst(v, t, { type: 'lowpass', freq: 900 * p, freqTo: 120, sweep: 0.25, a: 0.001, peak: 0.5, d: 0.3, dest: out });
  thump(v, t, 180 * p, 55, 0.5, 0.07, out);
  // the bolt is worked: back and home
  for (const dt of [0.42, 0.55]) {
    metal(v, t + dt, 2400 * p, [1, 1.7, 2.6], [0.06, 0.04, 0.03], [0.03, 0.02, 0.015], out);
    noiseBurst(v, t + dt, { type: 'highpass', freq: 4000, a: 0.0005, peak: 0.12, d: 0.01, dest: out });
  }
}

function sSniper(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.35);
  const p = rand(0.95, 1.05);
  noiseBurst(v, t, { type: 'highpass', freq: 2000, a: 0.0002, peak: 1.0, d: 0.02, dest: out });
  noiseBurst(v, t, { type: 'bandpass', freq: 900 * p, Q: 0.7, a: 0.0005, peak: 0.75, d: 0.12, dest: out });
  noiseBurst(v, t, { type: 'lowpass', freq: 700 * p, freqTo: 80, sweep: 0.6, a: 0.002, peak: 0.55, d: 0.8, dest: out });
  thump(v, t, 120 * p, 40, 0.65, 0.1, out);
  noiseBurst(v, t + 0.25, { type: 'lowpass', freq: 500, a: 0.05, peak: 0.14, d: 0.5, dest: out }); // the echo off the hills
}

/** An automatic weapon: `n` shots `gap` s apart (`size` and `bright` per shot), and spent casings. */
function burst(v: Voice, t: number, out: GainNode, n: number, gap: number, size: number, bright: number): void {
  for (let i = 0; i < n; i++) shot(v, t + i * gap + rand(0, 0.006), size * rand(0.85, 1), out, bright);
  noiseBurst(v, t, { type: 'lowpass', freq: 600, a: 0.02, peak: 0.18 * size, d: n * gap + 0.2, dest: out });
  for (let i = 0; i < 3; i++) ping(v, t + n * gap + rand(0.05, 0.3), rand(3000, 4500), 0.025, 0.06, out, 'sine', 0.0005);
}

function sMachineGun(v: Voice, t: number, out: GainNode): void {
  burst(v, t, out, 5, 0.075, 1.0, 0.8);
}

function sAssault(v: Voice, t: number, out: GainNode): void {
  burst(v, t, out, 3, 0.085, 0.85, 1.25);
}

function sDroneGun(v: Voice, t: number, out: GainNode): void {
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.03, 0.08, 0.2, 0.08);
  oscNode(v, 'sawtooth', 900, t, t + 0.35, biquad(v, 'bandpass', 1800, 4, g)); // the turret's motor
  burst(v, t + 0.02, out, 4, 0.06, 0.6, 1.6);
}

function sGrenadeThrow(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  noiseBurst(v, t, { type: 'highpass', freq: 5000, a: 0.01, peak: 0.18, d: 0.25, dest: out }); // the fuse fizzes
  crackle(v, t, 0.25, 6, 0.12, 5000, out);
  cry(v, t + 0.06, { f0: [165 * p, 130 * p], vowels: 'au', dur: 0.1, rough: 0.25, breath: 0.3, peak: 0.08 }, out);
  swish(v, t + 0.08, 600 * p, 1400 * p, 0.1, 0.25, out);
}

function sCannonShot(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.3);
  const p = rand(0.88, 1.05);
  thump(v, t, 85 * p, 26, 1.0, 0.5, out);
  noiseBurst(v, t, { type: 'lowpass', freq: 1300 * p, freqTo: 70, sweep: 0.7, a: 0.002, peak: 0.95, d: 0.8, dest: out });
  noiseBurst(v, t, { type: 'bandpass', freq: 2400, Q: 0.9, a: 0.0005, peak: 0.45, d: 0.05, dest: out });
  noiseBurst(v, t, { type: 'highpass', freq: 900, a: 0.0004, peak: 0.45, d: 0.03, dest: out });
  crackle(v, t + 0.06, 0.6, 14, 0.2, 2000, out);
}

function sHowitzer(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.4);
  const p = rand(0.92, 1.04);
  thump(v, t, 60 * p, 18, 1.0, 0.8, out);
  noiseBurst(v, t, { type: 'lowpass', freq: 900 * p, freqTo: 50, sweep: 1.0, a: 0.003, peak: 1.0, d: 1.1, dest: out });
  noiseBurst(v, t, { type: 'highpass', freq: 1000, a: 0.0004, peak: 0.5, d: 0.04, dest: out });
  metal(v, t + 0.7, 900 * p, [1, 1.5, 2.2], [0.08, 0.06, 0.04], [0.2, 0.15, 0.1], out); // the casing drops out
}

function sTankShot(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.25);
  const p = rand(0.9, 1.06);
  noiseBurst(v, t, { type: 'highpass', freq: 1200 * p, a: 0.0004, peak: 0.9, d: 0.04, dest: out });
  noiseBurst(v, t, { type: 'lowpass', freq: 1600 * p, freqTo: 90, sweep: 0.5, a: 0.002, peak: 0.9, d: 0.6, dest: out });
  thump(v, t, 110 * p, 30, 1.0, 0.35, out);
  // the breech clanks open
  metal(v, t + 0.35, 650 * p, [1, 1.45, 2.2, 3.1], [0.1, 0.08, 0.05, 0.03], [0.15, 0.1, 0.08, 0.05], out);
  noiseBurst(v, t + 0.35, { type: 'highpass', freq: 3000, a: 0.0005, peak: 0.15, d: 0.02, dest: out });
}

function sRocketLaunch(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.9, 1.1);
  noiseBurst(v, t, { type: 'bandpass', freq: 600 * p, Q: 1, a: 0.001, peak: 0.55, d: 0.05, dest: out }); // ignition pop
  thump(v, t, 150 * p, 60, 0.5, 0.1, out);
  noiseBurst(v, t, { type: 'bandpass', freq: 800 * p, freqTo: 2600 * p, sweep: 0.5, Q: 1.2, a: 0.02, peak: 0.6, d: 0.6, dest: out });
  noiseBurst(v, t + 0.03, { type: 'highpass', freq: 3000, a: 0.05, peak: 0.18, d: 0.5, dest: out });
}

/** A rocket of an artillery salvo screams away. */
function sRocketArty(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.9, 1.1);
  thump(v, t, 100 * p, 40, 0.5, 0.2, out);
  noiseBurst(v, t, { type: 'bandpass', freq: 500 * p, freqTo: 3000 * p, sweep: 0.7, Q: 2, a: 0.03, peak: 0.55, d: 0.7, dest: out });
  const g = gainNode(v, 0, out);
  swell(g.gain, t + 0.05, 0.2, 0.06, 0.2, 0.3);
  const o = oscNode(v, 'sine', 900 * p, t + 0.05, t + 0.8, g);
  sweep(o.frequency, t + 0.05, 900 * p, 2200 * p, 0.6);
}

function sFlameRoar(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.9, 1.1);
  const dur = 0.75;
  noiseBurst(v, t, { type: 'lowpass', freq: 300, a: 0.005, peak: 0.5, d: 0.1, dest: out }); // ignition whoomp
  thump(v, t, 90 * p, 45, 0.4, 0.12, out);
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.05, 0.55, dur - 0.3, 0.25);
  const bp = biquad(v, 'bandpass', 700 * p, 0.7, g);
  noiseNode(v, t, t + dur + 0.05, bp);
  oscNode(v, 'sine', 13, t, t + dur, gainNode(v, 0.15, g.gain)); // turbulence
  noiseBurst(v, t, { type: 'highpass', freq: 3500, a: 0.05, peak: 0.15, d: dur, dest: out }); // the jet hisses
  crackle(v, t + 0.05, dur, 14, 0.25, 2000, out);
}

function sRailShot(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.2);
  const p = rand(0.95, 1.05);
  // the coils charge with a rising whine, then the slug cracks out
  const cg = gainNode(v, 0, out);
  swell(cg.gain, t, 0.09, 0.12, 0, 0.03);
  const co = oscNode(v, 'sine', 500 * p, t, t + 0.14, cg);
  sweep(co.frequency, t, 500 * p, 3200 * p, 0.1);
  const f = t + 0.1;
  noiseBurst(v, f, { type: 'highpass', freq: 1800, a: 0.0003, peak: 0.8, d: 0.03, dest: out });
  fmBell(v, f, 1500 * p, 1.414, 1800, 0.2, 0.45, out);
  thump(v, f, 200 * p, 50, 0.55, 0.12, out);
  ping(v, f, 3400 * p, 0.05, 0.3, out);
}

/** Twin laser pulses (starfighters, laser turrets). */
function sLaserTwin(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  for (const [dt, f] of [[0, 2400], [0.07, 2000]] as const) {
    const g = gainNode(v, 0, out);
    perc(g.gain, t + dt, 0.002, 0.24, 0.14);
    const o = oscNode(v, 'square', f * p, t + dt, t + dt + 0.16, biquad(v, 'lowpass', 5000, 2, g));
    sweep(o.frequency, t + dt, f * p, 450 * p, 0.13);
  }
}

/** A plasma rifle or cannon: a charged "vwomp" (`big` for walkers and titans). */
function plasma(v: Voice, t: number, out: GainNode, big: boolean): void {
  const p = rand(0.92, 1.08) * (big ? 0.55 : 1);
  if (big) {
    wet(v, 0.2);
    const cg = gainNode(v, 0, out);
    swell(cg.gain, t, 0.12, 0.1, 0, 0.03);
    const co = oscNode(v, 'sawtooth', 300, t, t + 0.16, biquad(v, 'bandpass', 1200, 3, cg));
    sweep(co.frequency, t, 300, 1200, 0.13);
    t += 0.13;
  }
  const g = gainNode(v, 0, out);
  perc(g.gain, t, 0.004, 0.45, big ? 0.5 : 0.28);
  const car = oscNode(v, 'sine', 700 * p, t, t + 0.6, g);
  sweep(car.frequency, t, 700 * p, 140 * p, big ? 0.45 : 0.25);
  const mg = gainNode(v, 0, car.frequency);
  perc(mg.gain, t, 0.002, 500 * p, 0.2);
  oscNode(v, 'sine', 1050 * p, t, t + 0.6, mg);
  noiseBurst(v, t, { type: 'bandpass', freq: 2500 * p, freqTo: 600 * p, Q: 1.5, a: 0.003, peak: 0.3, d: 0.2, dest: out });
  thump(v, t, 160 * p, 60, big ? 0.8 : 0.4, big ? 0.3 : 0.1, out);
}

function sPlasmaShot(v: Voice, t: number, out: GainNode): void {
  plasma(v, t, out, false);
}

function sPlasmaHeavy(v: Voice, t: number, out: GainNode): void {
  plasma(v, t, out, true);
}

function sGravitonShot(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.35);
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.3, 0.3, 0.05, 0.4);
  const o = oscNode(v, 'sine', 80, t, t + 0.8, g);
  o.frequency.setValueAtTime(80, t);
  o.frequency.exponentialRampToValueAtTime(240, t + 0.35);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.75);
  oscNode(v, 'sine', 160, t, t + 0.8, gainNode(v, 60, o.frequency));
  noiseBurst(v, t + 0.3, { type: 'bandpass', freq: 300, freqTo: 1500, Q: 1, a: 0.02, peak: 0.35, d: 0.45, dest: out });
  thump(v, t + 0.33, 90, 30, 0.7, 0.3, out);
}

function sHolyBolt(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.3);
  const p = rand(0.98, 1.02);
  noiseBurst(v, t, { type: 'bandpass', freq: 4000, freqTo: 1500, Q: 1.5, a: 0.02, peak: 0.15, d: 0.25, dest: out });
  chime(v, t, mtof(84) * p, 0.1, 0.35, out);
  chime(v, t + 0.05, mtof(91) * p, 0.06, 0.3, out);
}

function sArcaneBolt(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.25);
  const p = rand(0.95, 1.05);
  const g = gainNode(v, 0, out);
  perc(g.gain, t, 0.01, 0.16, 0.25);
  const o = oscNode(v, 'triangle', 900 * p, t, t + 0.3, g);
  sweep(o.frequency, t, 900 * p, 1800 * p, 0.2);
  oscNode(v, 'sine', 22, t, t + 0.3, gainNode(v, 60, o.detune));
  [86, 89, 93].forEach((m, i) => ping(v, t + 0.03 + i * 0.04, mtof(m) * p, 0.07, 0.15, out));
  noiseBurst(v, t, { type: 'bandpass', freq: 3000, freqTo: 6000, Q: 2, a: 0.05, peak: 0.12, d: 0.15, dest: out });
}

function sFrostBolt(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.3);
  noiseBurst(v, t, { type: 'highpass', freq: 5000, a: 0.02, peak: 0.2, d: 0.25, dest: out });
  [93, 98, 100].forEach((m, i) => ping(v, t + i * 0.035, mtof(m) * rand(0.99, 1.01), 0.07, 0.2, out));
  fmBell(v, t, 1760, 2.76, 300, 0.07, 0.3, out);
}

function sWaterBolt(v: Voice, t: number, out: GainNode): void {
  noiseBurst(v, t, { type: 'bandpass', freq: 400, freqTo: 1600, Q: 1.2, a: 0.02, peak: 0.35, d: 0.25, dest: out });
  bubbles(v, t, 0.2, 5, 0.22, out);
}

function sFireballCast(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  noiseBurst(v, t, { type: 'bandpass', freq: 300 * p, freqTo: 1400 * p, sweep: 0.4, Q: 0.8, a: 0.05, peak: 0.55, d: 0.4, dest: out });
  crackle(v, t + 0.02, 0.4, 10, 0.25, 1800, out);
  thump(v, t, 120 * p, 70, 0.25, 0.1, out);
}

function sFelBolt(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.3);
  const p = rand(0.95, 1.05);
  const g = gainNode(v, 0, out);
  perc(g.gain, t, 0.02, 0.22, 0.35);
  const lp = biquad(v, 'lowpass', 900, 3, g);
  for (const f of [160, 169]) {
    const o = oscNode(v, 'sawtooth', f * p, t, t + 0.4, lp);
    sweep(o.frequency, t, f * p, f * 0.56 * p, 0.35);
  }
  noiseBurst(v, t, { type: 'bandpass', freq: 800, freqTo: 300, Q: 1.2, a: 0.03, peak: 0.25, d: 0.35, dest: out });
}

function sAxeThrow(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  // the axe spins away: a whooshing band chopped by its rotation
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.05, 0.3, 0.15, 0.2);
  const am = gainNode(v, 0.5, g);
  const bp = biquad(v, 'bandpass', 1500 * p, 3, am);
  sweep(bp.frequency, t, 1500 * p, 800 * p, 0.4);
  noiseNode(v, t, t + 0.45, bp);
  oscNode(v, 'sine', 14, t, t + 0.45, gainNode(v, 0.5, am.gain));
  cry(v, t, { f0: [210 * p, 160 * p], vowels: 'ao', dur: 0.12, rough: 0.2, peak: 0.08, breath: 0.2 }, out);
}

function sDrakeBreath(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  cry(v, t, { f0: [140 * p, 185 * p, 120 * p], vowels: 'oao', dur: 0.45, size: 0.7, rough: 0.5, growl: 0.5, growlRate: 32, drive: 2, peak: 0.22, breath: 0.3 }, out);
  noiseBurst(v, t + 0.1, { type: 'bandpass', freq: 300 * p, freqTo: 1600 * p, sweep: 0.35, Q: 0.8, a: 0.05, peak: 0.5, d: 0.4, dest: out });
  crackle(v, t + 0.12, 0.4, 10, 0.25, 1800, out);
}

// --- deaths ------------------------------------------------------------------

/** Death cries: [pitch contour (relative), vowels, length]. A variant picks one; the unit's own pitch scales it. */
const DEATH_CRIES: [number[], string, number][] = [
  [[1.9, 2.1, 1.2], 'aao', 0.55],
  [[1.7, 1.25, 0.85], 'uuo', 0.6],
  [[2.2, 2.5, 1.35], 'eaa', 0.5],
  [[1.6, 1.75, 0.8], 'aou', 0.65],
  [[2.0, 1.5], 'ao', 0.4],
];

/** A soldier's death cry and the body hitting the ground (`f0` voice pitch, `size` throat). */
function dyingCry(v: Voice, t: number, out: GainNode, f0: number, size: number, rough: number, armour: boolean): void {
  const [shape, vowels, len] = pick(DEATH_CRIES);
  const p = rand(0.94, 1.06);
  const end = cry(v, t, { f0: shape.map((k) => k * f0 * p), vowels, dur: len * rand(0.9, 1.1), size, rough, breath: 0.12, peak: 0.4, drive: 1.2, a: 0.02 }, out);
  thump(v, end - 0.1, 120, 50, 0.35, 0.12, out); // the body falls
  noiseBurst(v, end - 0.1, { type: 'lowpass', freq: 500, a: 0.002, peak: 0.2, d: 0.1, dest: out });
  if (armour) debris(v, end - 0.1, 0.25, 5, 'metal', 0.35, out);
}

function sDieMan(v: Voice, t: number, out: GainNode): void {
  dyingCry(v, t, out, 118, 1, 0.15, false);
}

function sDieWoman(v: Voice, t: number, out: GainNode): void {
  dyingCry(v, t, out, 205, 1.17, 0, false);
}

/** Armoured infantry: the cry, then the clatter of plate. */
function sDieKnight(v: Voice, t: number, out: GainNode): void {
  dyingCry(v, t, out, 105, 0.95, 0.2, true);
}

/** A brute (clubman, gnoll, troll, ogre-kin): a rough, low groan. */
function sDieBrute(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  const end = cry(v, t, { f0: [190 * p, 160 * p, 90 * p], vowels: 'aou', dur: 0.6, size: 0.88, rough: 0.5, growl: 0.3, growlRate: 28, drive: 1.6, peak: 0.4, breath: 0.15 }, out);
  thump(v, end - 0.1, 110, 45, 0.45, 0.14, out);
}

/** Future infantry: a cry through the suit's speaker, sparks and a clank. */
function sDieCyborg(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  const ring = gainNode(v, 0, out);
  const end = cry(v, t, { f0: [220 * p, 250 * p, 120 * p], vowels: 'aao', dur: 0.5, rough: 0.1, peak: 0.6, drive: 1.5 }, ring);
  oscNode(v, 'sine', 90, t, end + 0.05, ring.gain); // ring-modulated by the helmet's speaker
  noiseBurst(v, t + 0.05, { type: 'highpass', freq: 3000, a: 0.002, peak: 0.25, d: 0.15, dest: out });
  crackle(v, t + 0.05, 0.5, 14, 0.25, 4000, out); // sparks
  debris(v, end - 0.05, 0.25, 4, 'metal', 0.35, out);
  thump(v, end - 0.05, 110, 40, 0.5, 0.15, out);
}

/** A horse screams and goes down with its rider. */
function sDieHorse(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  const end = cry(v, t, { f0: [700 * p, 950 * p, 820 * p, 600 * p, 420 * p], vowels: 'ieea', dur: 0.85, size: 0.8, rough: 0.12, vib: 170, vibRate: 11, breath: 0.25, peak: 0.32 }, out);
  noiseBurst(v, end, { type: 'lowpass', freq: 900, a: 0.01, peak: 0.25, d: 0.12, dest: out }); // a last snort
  thump(v, end - 0.15, 85, 32, 0.9, 0.3, out);
  noiseBurst(v, end - 0.15, { type: 'lowpass', freq: 500, a: 0.003, peak: 0.45, d: 0.2, dest: out });
  debris(v, end - 0.12, 0.3, 5, 'metal', 0.3, out);
}

function sDieElephant(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.2);
  const p = rand(0.94, 1.04);
  const dur = 1.0;
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.08, 0.32, dur - 0.35, 0.3);
  const bp = biquad(v, 'bandpass', 1100, 1.2, g);
  const o = oscNode(v, 'sawtooth', 420 * p, t, t + dur + 0.05, gainNode(v, 2, shaper(v, bp)));
  o.frequency.linearRampToValueAtTime(470 * p, t + 0.2);
  o.frequency.linearRampToValueAtTime(240 * p, t + dur);
  oscNode(v, 'sine', 6, t, t + dur, gainNode(v, 40, o.detune));
  thump(v, t + 0.95, 60, 22, 1.0, 0.5, out);
  noiseBurst(v, t + 0.95, { type: 'lowpass', freq: 350, a: 0.01, peak: 0.6, d: 0.5, dest: out });
}

/** A wooden siege engine breaks apart. */
function sDieSiege(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  creak(v, t, 0.3, 60 * p, 0.3, out, 18);
  noiseBurst(v, t + 0.25, { type: 'highpass', freq: 1500, a: 0.0005, peak: 0.55, d: 0.05, dest: out }); // timber cracks
  for (let i = 0; i < 3; i++) {
    const tt = t + 0.3 + i * rand(0.09, 0.15);
    thump(v, tt, (150 - i * 25) * p, 50, 0.6 - i * 0.12, 0.15, out);
    noiseBurst(v, tt, { type: 'bandpass', freq: rand(400, 700), Q: 1.5, a: 0.001, peak: 0.4, d: 0.1, dest: out });
  }
  debris(v, t + 0.3, 0.5, 10, 'wood', 0.3, out);
}

/** A vehicle brews up: explosion, flying metal and fire. */
function sDieVehicle(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.25);
  const p = rand(0.88, 1.06);
  thump(v, t, 95 * p, 26, 1.0, 0.6, out);
  noiseBurst(v, t, { type: 'lowpass', freq: 1800 * p, freqTo: 80, sweep: 0.9, a: 0.003, peak: 1.0, d: 1.0, dest: out });
  noiseBurst(v, t, { type: 'bandpass', freq: 2200, Q: 0.8, a: 0.0005, peak: 0.45, d: 0.1, dest: out });
  metal(v, t + 0.02, 380 * p, [1, 1.33, 1.82, 2.5], [0.1, 0.08, 0.06, 0.04], [0.6, 0.45, 0.3, 0.2], out); // the hull groans
  debris(v, t + 0.1, 0.9, 10, 'metal', 0.35, out);
  crackle(v, t + 0.15, 0.9, 12, 0.25, 2000, out);
}

/** A walker's servos whine down, then it blows up and crashes. */
function sDieMech(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.3);
  const p = rand(0.92, 1.05);
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.03, 0.22, 0.45, 0.2);
  const o = oscNode(v, 'sawtooth', 600 * p, t, t + 0.75, biquad(v, 'bandpass', 1200, 3, g));
  sweep(o.frequency, t, 600 * p, 70 * p, 0.7);
  crackle(v, t, 0.6, 10, 0.2, 4000, out);
  const b = t + 0.55;
  thump(v, b, 80 * p, 22, 1.0, 0.7, out);
  noiseBurst(v, b, { type: 'lowpass', freq: 1800 * p, freqTo: 70, sweep: 0.9, a: 0.003, peak: 1.0, d: 1.0, dest: out });
  metal(v, b + 0.3, 260 * p, [1, 1.4, 2.0, 2.7], [0.14, 0.1, 0.07, 0.05], [0.7, 0.5, 0.35, 0.25], out);
  thump(v, b + 0.3, 70, 25, 0.8, 0.4, out); // it crashes down
  debris(v, b + 0.1, 0.9, 10, 'metal', 0.3, out);
}

/** A drone: a zap, a pop and sparks as it drops. */
function sDieDrone(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  noiseBurst(v, t, { type: 'highpass', freq: 3000, a: 0.001, peak: 0.4, d: 0.15, dest: out });
  thump(v, t, 300 * p, 90, 0.5, 0.08, out);
  crackle(v, t, 0.45, 14, 0.3, 5000, out);
  const g = gainNode(v, 0, out);
  perc(g.gain, t + 0.05, 0.01, 0.1, 0.35);
  const o = oscNode(v, 'sine', 1800 * p, t + 0.05, t + 0.45, g);
  sweep(o.frequency, t + 0.05, 1800 * p, 500 * p, 0.35);
  thump(v, t + 0.45, 160, 60, 0.45, 0.12, out);
  debris(v, t + 0.45, 0.2, 5, 'metal', 0.3, out);
}

function sDieWolf(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  cry(v, t, { f0: [900 * p, 1100 * p, 700 * p], vowels: 'iea', dur: 0.22, size: 1.2, peak: 0.32, breath: 0.2 }, out); // yelp
  cry(v, t + 0.3, { f0: [700 * p, 520 * p], vowels: 'iu', dur: 0.4, size: 1.2, peak: 0.12, breath: 0.35, vib: 40 }, out); // whimper
  thump(v, t + 0.25, 140, 60, 0.35, 0.1, out);
}

function sDieSpider(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.02, 0.35, 0.2, 0.15);
  const am = gainNode(v, 0.5, g);
  noiseNode(v, t, t + 0.4, biquad(v, 'bandpass', 3500 * p, 2, am));
  oscNode(v, 'sine', 40, t, t + 0.4, gainNode(v, 0.5, am.gain));
  const sg = gainNode(v, 0, out);
  perc(sg.gain, t, 0.01, 0.18, 0.3);
  const o = oscNode(v, 'sawtooth', 1600 * p, t, t + 0.35, biquad(v, 'bandpass', 2000, 2, sg));
  sweep(o.frequency, t, 1600 * p, 500 * p, 0.3);
  noiseBurst(v, t + 0.35, { type: 'lowpass', freq: 900, a: 0.003, peak: 0.4, d: 0.1, dest: out }); // squish
  debris(v, t + 0.4, 0.35, 5, 'bone', 0.2, out); // legs twitch
}

function sDieOgre(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.06);
  const end = cry(v, t, { f0: [115 * p, 100 * p, 62 * p], vowels: 'aou', dur: 0.95, size: 0.72, rough: 0.5, growl: 0.3, growlRate: 30, drive: 1.5, peak: 0.4, breath: 0.12 }, out);
  thump(v, end - 0.15, 80, 30, 1.0, 0.3, out);
  noiseBurst(v, end - 0.15, { type: 'lowpass', freq: 400, a: 0.003, peak: 0.5, d: 0.25, dest: out });
}

function sDieGolem(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.2);
  const p = rand(0.92, 1.06);
  noiseBurst(v, t, { type: 'highpass', freq: 1500, a: 0.0005, peak: 0.6, d: 0.05, dest: out });
  thump(v, t, 70 * p, 25, 1.0, 0.5, out);
  noiseBurst(v, t, { type: 'lowpass', freq: 400, a: 0.05, peak: 0.5, d: 0.9, dest: out });
  crackle(v, t + 0.05, 1.0, 26, 0.35, 1200, out);
  debris(v, t + 0.05, 1.0, 16, 'stone', 0.4, out);
  thump(v, t + 0.5, 60, 25, 0.6, 0.3, out);
}

function sDieDrake(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.3);
  const p = rand(0.94, 1.04);
  const end = cry(v, t, { f0: [240 * p, 280 * p, 130 * p, 70 * p], vowels: 'aaou', dur: 1.15, size: 0.65, rough: 0.6, growl: 0.6, growlRate: 35, drive: 2.5, peak: 0.35, breath: 0.3 }, out);
  thump(v, end - 0.15, 70, 25, 1.0, 0.4, out);
  noiseBurst(v, end - 0.15, { type: 'lowpass', freq: 450, a: 0.005, peak: 0.5, d: 0.3, dest: out });
}

function sDieKobold(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.9, 1.1);
  cry(v, t, { f0: [500 * p, 680 * p, 380 * p], vowels: 'iiu', dur: 0.35, size: 1.3, peak: 0.32, breath: 0.1 }, out);
  thump(v, t + 0.3, 170, 70, 0.3, 0.08, out);
}

function sDieGnoll(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  cry(v, t, { f0: [420 * p, 540 * p, 300 * p, 190 * p], vowels: 'eao', dur: 0.5, size: 1.05, rough: 0.3, peak: 0.34, breath: 0.15 }, out);
  thump(v, t + 0.45, 130, 55, 0.4, 0.1, out);
}

function sDieTroll(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  const end = cry(v, t, { f0: [200 * p, 235 * p, 115 * p], vowels: 'uau', dur: 0.6, rough: 0.35, growl: 0.5, growlRate: 18, peak: 0.36, breath: 0.15 }, out);
  thump(v, end - 0.1, 120, 50, 0.4, 0.12, out);
}

/** Bones clatter to the ground. */
function sDieSkeleton(v: Voice, t: number, out: GainNode): void {
  noiseBurst(v, t, { type: 'bandpass', freq: 600, Q: 0.8, a: 0.05, peak: 0.12, d: 0.4, dest: out }); // a hollow sigh
  for (let i = 0; i < 16; i++) {
    const tt = t + 0.05 + 0.65 * Math.pow(i / 16, 0.8) + rand(0, 0.03);
    const lvl = 0.25 * (1 - i / 22);
    ping(v, tt, rand(900, 2600), lvl, rand(0.02, 0.045), out, 'triangle', 0.0005);
    noiseBurst(v, tt, { type: 'bandpass', freq: rand(1800, 3200), Q: 4, a: 0.0005, peak: lvl, d: 0.015, dest: out });
  }
  thump(v, t + 0.3, 160, 70, 0.3, 0.08, out);
}

/** The Legion's death guards: a ghostly moan and falling armour. */
function sDieUndead(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.4);
  const p = rand(0.94, 1.06);
  const end = cry(v, t, { f0: [130 * p, 112 * p, 78 * p], vowels: 'oou', dur: 0.95, size: 0.85, breath: 0.6, rough: 0.2, peak: 0.3 }, out);
  debris(v, end - 0.3, 0.35, 6, 'metal', 0.35, out);
  thump(v, end - 0.3, 100, 40, 0.5, 0.15, out);
}

/** A boss falls: a huge, dying bellow and the ground shaking. */
function sDieBoss(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.5);
  const end = cry(v, t, { f0: [95, 110, 70, 45], vowels: 'aaou', dur: 1.6, size: 0.7, rough: 0.6, growl: 0.4, growlRate: 26, drive: 2, peak: 0.4, breath: 0.25 }, out);
  debris(v, end - 0.5, 0.5, 8, 'metal', 0.4, out);
  thump(v, end - 0.4, 55, 18, 1.0, 0.8, out);
  noiseBurst(v, end - 0.4, { type: 'lowpass', freq: 300, a: 0.02, peak: 0.6, d: 0.9, dest: out });
}

/** The water elemental collapses into a splash. */
function sDieWater(v: Voice, t: number, out: GainNode): void {
  noiseBurst(v, t, { type: 'bandpass', freq: 2000, freqTo: 300, sweep: 0.6, Q: 0.9, a: 0.01, peak: 0.6, d: 0.6, dest: out });
  noiseBurst(v, t + 0.1, { type: 'lowpass', freq: 600, a: 0.05, peak: 0.3, d: 0.5, dest: out });
  bubbles(v, t, 0.6, 9, 0.2, out);
}

// --- buildings collapsing ----------------------------------------------------

function sCollapseWood(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.15);
  const p = rand(0.9, 1.08);
  creak(v, t, 0.35, 50 * p, 0.35, out, 16);
  noiseBurst(v, t + 0.3, { type: 'highpass', freq: 1300, a: 0.0005, peak: 0.6, d: 0.06, dest: out });
  for (let i = 0; i < 4; i++) {
    const tt = t + 0.35 + i * rand(0.1, 0.18);
    thump(v, tt, (130 - i * 18) * p, 40, 0.8 - i * 0.12, 0.2, out);
    noiseBurst(v, tt, { type: 'bandpass', freq: rand(300, 600), Q: 1.2, a: 0.002, peak: 0.45, d: 0.15, dest: out });
  }
  debris(v, t + 0.35, 0.8, 14, 'wood', 0.3, out);
  noiseBurst(v, t + 0.4, { type: 'lowpass', freq: 500, a: 0.1, peak: 0.35, d: 0.8, dest: out });
}

function sCollapseStone(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.25);
  const p = rand(0.9, 1.06);
  noiseBurst(v, t, { type: 'highpass', freq: 1500, a: 0.0005, peak: 0.5, d: 0.05, dest: out });
  thump(v, t, 75 * p, 22, 1.0, 0.6, out);
  noiseBurst(v, t, { type: 'lowpass', freq: 380 * p, a: 0.25, peak: 0.7, d: 1.3, dest: out }); // rumble
  crackle(v, t + 0.1, 1.3, 30, 0.3, 1000, out);
  debris(v, t + 0.1, 1.3, 20, 'stone', 0.4, out);
  thump(v, t + 0.55, 65, 22, 0.7, 0.4, out);
}

function sCollapseMetal(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.3);
  const p = rand(0.9, 1.06);
  thump(v, t, 85 * p, 22, 1.0, 0.7, out);
  noiseBurst(v, t, { type: 'lowpass', freq: 2000 * p, freqTo: 70, sweep: 1.0, a: 0.003, peak: 1.0, d: 1.2, dest: out });
  // girders groan as they buckle
  const g = gainNode(v, 0, out);
  swell(g.gain, t + 0.15, 0.1, 0.2, 0.5, 0.3);
  const o = oscNode(v, 'sawtooth', 120 * p, t + 0.15, t + 1.1, biquad(v, 'bandpass', 700, 8, g));
  sweep(o.frequency, t + 0.15, 120 * p, 60 * p, 0.9);
  debris(v, t + 0.1, 1.2, 14, 'metal', 0.35, out);
  crackle(v, t + 0.2, 1.1, 14, 0.25, 2500, out);
}

function sCollapseEnergy(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.35);
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.02, 0.25, 0.6, 0.3);
  const o = oscNode(v, 'sawtooth', 800, t, t + 1.0, biquad(v, 'lowpass', 2500, 4, g));
  sweep(o.frequency, t, 800, 60, 0.9); // the power fails
  crackle(v, t, 0.7, 16, 0.3, 4500, out);
  const b = t + 0.6;
  thump(v, b, 80, 22, 1.0, 0.6, out);
  noiseBurst(v, b, { type: 'lowpass', freq: 2000, freqTo: 70, sweep: 0.9, a: 0.003, peak: 0.9, d: 1.0, dest: out });
  debris(v, b + 0.05, 0.9, 10, 'metal', 0.3, out);
}

// --- creatures: idle calls near their camps and aggro roars --------------------

function sWolfHowl(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.45);
  const p = rand(0.9, 1.1);
  cry(v, t, { f0: [330 * p, 560 * p, 620 * p, 600 * p, 470 * p], vowels: 'uooou', dur: 1.5, size: 1.1, peak: 0.3, a: 0.15, src: 'triangle', breath: 0.1, vib: 25, vibRate: 5 }, out);
}

function sWolfSnarl(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.9, 1.1);
  cry(v, t, { f0: [180 * p, 240 * p, 200 * p], vowels: 'oaa', dur: 0.5, size: 1.05, rough: 0.7, growl: 0.8, growlRate: 42, drive: 2.5, peak: 0.28, breath: 0.4 }, out);
  cry(v, t + 0.5, { f0: [520 * p, 380 * p], vowels: 'ao', dur: 0.14, size: 1.1, rough: 0.3, peak: 0.25, drive: 1.5 }, out); // a bark
}

function sSpiderChitter(v: Voice, t: number, out: GainNode): void {
  const n = 9 + ((rnd() * 6) | 0);
  for (let i = 0; i < n; i++) {
    const tt = t + i * rand(0.03, 0.05);
    noiseBurst(v, tt, { type: 'bandpass', freq: rand(3000, 6000), Q: 6, a: 0.0005, peak: rand(0.15, 0.3), d: 0.012, dest: out });
  }
  noiseBurst(v, t, { type: 'highpass', freq: 5000, a: 0.05, peak: 0.06, d: 0.4, dest: out });
}

function sSpiderHiss(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.9, 1.1);
  noiseBurst(v, t, { type: 'highpass', freq: 3500 * p, a: 0.04, peak: 0.35, d: 0.45, dest: out });
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.05, 0.16, 0.2, 0.15);
  const o = oscNode(v, 'sawtooth', 1100 * p, t, t + 0.45, biquad(v, 'bandpass', 2400, 3, g));
  oscNode(v, 'sine', 35, t, t + 0.45, gainNode(v, 300, o.frequency));
  sSpiderChitter(v, t + 0.3, out);
}

function sOgreGrumble(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.9, 1.1);
  cry(v, t, { f0: [82 * p, 92 * p, 78 * p], vowels: 'uou', dur: 0.45, size: 0.75, rough: 0.5, growl: 0.4, growlRate: 24, peak: 0.3 }, out);
  cry(v, t + 0.55, { f0: [88 * p, 70 * p], vowels: 'ou', dur: 0.35, size: 0.75, rough: 0.5, peak: 0.25 }, out);
}

function sOgreRoar(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.25);
  const p = rand(0.92, 1.08);
  cry(v, t, { f0: [100 * p, 135 * p, 120 * p, 85 * p], vowels: 'aaao', dur: 0.85, size: 0.72, rough: 0.6, growl: 0.3, growlRate: 28, drive: 2.5, peak: 0.32, breath: 0.25 }, out);
}

function sKoboldChatter(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.9, 1.1);
  for (let i = 0; i < 3; i++) {
    const f = rand(320, 420) * p;
    cry(v, t + i * 0.13, { f0: [f, f * rand(1.1, 1.3)], vowels: pick(['ie', 'ai', 'ea']), dur: 0.1, size: 1.3, peak: 0.22 }, out);
  }
}

function sKoboldYell(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.9, 1.1);
  cry(v, t, { f0: [400 * p, 520 * p, 440 * p], vowels: 'aaa', dur: 0.35, size: 1.3, peak: 0.3, drive: 1.5 }, out);
}

function sGnollCackle(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  for (let i = 0; i < 5; i++) {
    const f = (460 - i * 25) * p;
    cry(v, t + i * 0.1, { f0: [f, f * 0.85], vowels: 'ee', dur: 0.075, size: 1.05, rough: 0.25, breath: 0.3, peak: 0.24 }, out);
  }
}

function sGnollYell(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  cry(v, t, { f0: [300 * p, 420 * p, 330 * p], vowels: 'eaa', dur: 0.4, rough: 0.4, growl: 0.4, growlRate: 34, drive: 2, peak: 0.28 }, out);
  sGnollCackle(v, t + 0.45, out);
}

function sTrollMutter(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  cry(v, t, { f0: [125 * p, 140 * p], vowels: 'uu', dur: 0.22, rough: 0.1, peak: 0.24, vib: 40 }, out);
  cry(v, t + 0.27, { f0: [150 * p, 115 * p], vowels: 'ou', dur: 0.3, rough: 0.1, peak: 0.26, vib: 40 }, out);
}

function sTrollYell(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  cry(v, t, { f0: [170 * p, 260 * p, 230 * p], vowels: 'aaa', dur: 0.45, rough: 0.25, drive: 1.8, peak: 0.3, vib: 60, vibRate: 7 }, out);
}

function sGolemGrind(v: Voice, t: number, out: GainNode): void {
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.2, 0.4, 0.4, 0.3);
  const am = gainNode(v, 0.5, g);
  noiseNode(v, t, t + 1, biquad(v, 'bandpass', 700, 2, am)); // stone scraping on stone
  oscNode(v, 'sine', 19, t, t + 1, gainNode(v, 0.5, am.gain));
  noiseBurst(v, t, { type: 'lowpass', freq: 150, a: 0.2, peak: 0.5, d: 0.7, dest: out });
  debris(v, t + 0.3, 0.5, 4, 'stone', 0.18, out);
}

function sGolemRumble(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.25);
  thump(v, t, 60, 25, 0.9, 0.4, out);
  sGolemGrind(v, t, out);
  cry(v, t + 0.1, { f0: [55, 70, 50], vowels: 'ooo', dur: 0.8, size: 0.6, rough: 0.8, growl: 0.7, growlRate: 14, drive: 3, peak: 0.25, breath: 0.5 }, out);
}

function sDrakeGrowl(v: Voice, t: number, out: GainNode): void {
  const p = rand(0.92, 1.08);
  cry(v, t, { f0: [150 * p, 170 * p, 130 * p], vowels: 'ooo', dur: 0.7, size: 0.68, rough: 0.6, growl: 0.6, growlRate: 30, drive: 2, peak: 0.26, breath: 0.3 }, out);
  // a wing beat or two
  for (let i = 0; i < 2; i++) noiseBurst(v, t + 0.75 + i * 0.3, { type: 'lowpass', freq: 350, a: 0.06, peak: 0.35, d: 0.15, dest: out });
}

function sDrakeRoar(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.35);
  const p = rand(0.94, 1.06);
  cry(v, t, { f0: [170 * p, 260 * p, 240 * p, 150 * p], vowels: 'oaao', dur: 1.1, size: 0.62, rough: 0.6, growl: 0.4, growlRate: 34, drive: 3, peak: 0.3, breath: 0.45 }, out);
  noiseBurst(v, t + 0.05, { type: 'highpass', freq: 2500, a: 0.15, peak: 0.12, d: 0.8, dest: out }); // hiss
}

function sUndeadMoan(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.5);
  const p = rand(0.92, 1.08);
  cry(v, t, { f0: [140 * p, 165 * p, 120 * p], vowels: 'ouo', dur: 0.9, size: 0.85, breath: 0.7, rough: 0.15, peak: 0.24, vib: 30, vibRate: 4 }, out);
  debris(v, t + 0.2, 0.6, 5, 'bone', 0.15, out);
}

// --- building selection, as Warcraft III answers a click on a building -------------

/** A church bell (town hall): hum, prime, minor third, fifth and nominal partials. */
function bell(v: Voice, t: number, f: number, peak: number, dest: Dest): void {
  const parts: [number, number, number][] = [[0.5, 0.5, 2.5], [1, 1, 1.8], [1.19, 0.5, 1.4], [1.5, 0.35, 1.1], [2, 0.45, 0.9], [2.66, 0.2, 0.5]];
  for (const [r, a, d] of parts) ping(v, t, f * r * rand(0.998, 1.002), peak * a, d, dest, 'sine', 0.001);
  noiseBurst(v, t, { type: 'bandpass', freq: f * 4, Q: 2, a: 0.0005, peak: peak * 0.6, d: 0.02, dest });
}

function sSelTribal(v: Voice, t: number, out: GainNode): void {
  timpani(v, t, 82, 0.5, out);
  timpani(v, t + 0.22, 110, 0.4, out);
  timpani(v, t + 0.44, 82, 0.5, out);
  cry(v, t + 0.42, { f0: [150, 180, 165], vowels: 'eei', dur: 0.3, rough: 0.2, peak: 0.18, drive: 1.2 }, out); // "hey!"
}

function sSelBell(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.4);
  bell(v, t, rand(290, 310), 0.22, out);
}

function sSelCityHall(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.3);
  chime(v, t, mtof(76), 0.18, 0.9, out); // a clock chime: ding-dong
  chime(v, t + 0.35, mtof(72), 0.18, 1.1, out);
}

function sSelNexus(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.35);
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.15, 0.12, 0.35, 0.35);
  for (const m of [60, 67, 72, 76]) {
    const o = oscNode(v, 'sawtooth', mtof(m), t, t + 0.9, biquad(v, 'lowpass', 1800, 1, g));
    o.detune.value = rand(-8, 8);
  }
  for (let i = 0; i < 4; i++) ping(v, t + 0.1 + i * 0.07, mtof(84 + i * 3), 0.05, 0.25, out);
}

function sSelHouse(v: Voice, t: number, out: GainNode): void {
  creak(v, t, 0.35, 180, 0.2, out, 40); // the door
  // muffled voices inside
  const g = gainNode(v, 0, out);
  swell(g.gain, t + 0.3, 0.05, 0.12, 0.3, 0.15);
  const am = gainNode(v, 0.5, g);
  noiseNode(v, t + 0.3, t + 0.85, biquad(v, 'bandpass', 500, 2.5, am));
  oscNode(v, 'sine', 6, t + 0.3, t + 0.85, gainNode(v, 0.5, am.gain));
  knock(v, t + 0.4, 0.8, gainNode(v, 0.3, out));
}

function sSelHouseModern(v: Voice, t: number, out: GainNode): void {
  chime(v, t, mtof(79), 0.16, 0.7, out); // a doorbell
  chime(v, t + 0.3, mtof(75), 0.16, 0.9, out);
}

/** A farm: a sheep, a cow, a rooster or a hoe in the soil (one per variant). */
function sSelFarm(v: Voice, t: number, out: GainNode): void {
  const which = (rnd() * 4) | 0;
  if (which === 0) cry(v, t, { f0: [380, 400, 360], vowels: 'eaa', dur: 0.6, size: 1.2, vib: 90, vibRate: 9, breath: 0.2, peak: 0.25 }, out); // baa
  else if (which === 1) cry(v, t, { f0: [130, 150, 120], vowels: 'uoo', dur: 0.9, size: 0.72, rough: 0.2, breath: 0.15, peak: 0.3 }, out); // moo
  else if (which === 2) cry(v, t, { f0: [600, 900, 880, 700], vowels: 'oiio', dur: 0.75, size: 1.35, rough: 0.2, peak: 0.22 }, out); // cock-a-doodle
  else {
    for (let i = 0; i < 3; i++) {
      noiseBurst(v, t + i * 0.25, { type: 'bandpass', freq: 2500, freqTo: 1200, Q: 1.5, a: 0.01, peak: 0.25, d: 0.12, dest: out });
      thump(v, t + i * 0.25, 220, 100, 0.3, 0.05, out);
    }
  }
}

function sSelTractor(v: Voice, t: number, out: GainNode): void {
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.05, 0.3, 0.6, 0.2);
  const lp = biquad(v, 'lowpass', 600, 2, g);
  const am = gainNode(v, 0.4, gainNode(v, 2, shaper(v, lp)));
  oscNode(v, 'sawtooth', 55, t, t + 0.95, am);
  oscNode(v, 'square', 9, t, t + 0.95, gainNode(v, 0.6, am.gain)); // putt-putt
}

function sSelHydro(v: Voice, t: number, out: GainNode): void {
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.1, 0.2, 0.5, 0.2);
  const am = gainNode(v, 0.6, g);
  noiseNode(v, t, t + 0.9, biquad(v, 'bandpass', 400, 1.5, am)); // the pumps
  oscNode(v, 'sine', 2.5, t, t + 0.9, gainNode(v, 0.4, am.gain));
  oscNode(v, 'sine', 120, t, t + 0.9, gainNode(v, 0.05, g));
  for (let i = 0; i < 4; i++) ping(v, t + 0.1 + i * rand(0.12, 0.2), rand(1500, 2500), 0.08, 0.06, out); // drips
}

function sSelLumber(v: Voice, t: number, out: GainNode): void {
  for (let i = 0; i < 3; i++) noiseBurst(v, t + i * 0.18, { type: 'bandpass', freq: i % 2 ? 2200 : 2700, Q: 3, a: 0.06, peak: 0.25, d: 0.1, dest: out }); // a saw
  sChop(v, t + 0.6, out);
}

function sSelBarracks(v: Voice, t: number, out: GainNode): void {
  sMelee(v, t, out, 'sword', 'metal');
  sMelee(v, t + 0.22, out, 'sword', 'metal');
  cry(v, t + 0.45, { f0: [140, 165, 150], vowels: 'aaa', dur: 0.25, rough: 0.3, peak: 0.16, drive: 1.5 }, out); // "hah!"
}

function sSelBarracksGun(v: Voice, t: number, out: GainNode): void {
  for (const dt of [0, 0.12]) {
    metal(v, t + dt, 2200, [1, 1.7, 2.6], [0.08, 0.05, 0.04], [0.04, 0.03, 0.02], out); // a rifle bolt
    noiseBurst(v, t + dt, { type: 'highpass', freq: 4000, a: 0.0005, peak: 0.18, d: 0.012, dest: out });
  }
  for (let i = 0; i < 2; i++) thump(v, t + 0.35 + i * 0.3, 120, 60, 0.45, 0.08, out); // boots stamp
  cry(v, t + 0.6, { f0: [150, 135], vowels: 'au', dur: 0.18, rough: 0.3, peak: 0.15, drive: 1.5 }, out); // "hup!"
}

function sSelBarracksFuture(v: Voice, t: number, out: GainNode): void {
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.3, 0.12, 0.1, 0.2);
  const o = oscNode(v, 'sawtooth', 300, t, t + 0.65, biquad(v, 'lowpass', 2500, 3, g));
  sweep(o.frequency, t, 300, 1500, 0.4); // a weapon charges
  ping(v, t + 0.42, 2200, 0.08, 0.1, out, 'square');
  noiseBurst(v, t + 0.42, { type: 'highpass', freq: 3000, a: 0.002, peak: 0.12, d: 0.08, dest: out });
}

function sSelStable(v: Voice, t: number, out: GainNode): void {
  cry(v, t, { f0: [650, 880, 760, 560], vowels: 'ieea', dur: 0.6, size: 0.8, rough: 0.1, vib: 160, vibRate: 11, breath: 0.25, peak: 0.24 }, out); // a whinny
  for (let i = 0; i < 2; i++) knock(v, t + 0.7 + i * 0.15, 0.7, gainNode(v, 0.35, out)); // hooves stamp
}

function sSelAcademy(v: Voice, t: number, out: GainNode): void {
  for (let i = 0; i < 2; i++) swish(v, t + i * 0.18, 2500, 5000, 0.1, 0.12, out, 1); // pages turn
  bubbles(v, t + 0.35, 0.5, 8, 0.15, out); // a flask bubbles
}

function sSelLab(v: Voice, t: number, out: GainNode): void {
  bubbles(v, t, 0.8, 12, 0.14, out);
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.1, 0.06, 0.6, 0.2);
  oscNode(v, 'sawtooth', 60, t, t + 0.95, biquad(v, 'lowpass', 400, 1, g)); // mains hum
  ping(v, t + 0.5, 2600, 0.08, 0.3, out); // glass clinks
  ping(v, t + 0.56, 3100, 0.06, 0.25, out);
}

function sSelComputer(v: Voice, t: number, out: GainNode): void {
  for (let i = 0; i < 6; i++) {
    const tt = t + i * 0.09;
    const g = gainNode(v, 0, out);
    swell(g.gain, tt, 0.004, 0.08, 0.05, 0.01);
    oscNode(v, 'square', pick([880, 1320, 1760, 1175, 2093]), tt, tt + 0.08, biquad(v, 'lowpass', 3500, 1, g));
  }
  noiseBurst(v, t, { type: 'bandpass', freq: 1000, Q: 0.6, a: 0.1, peak: 0.04, d: 0.6, dest: out }); // fans
}

function sSelWorkshop(v: Voice, t: number, out: GainNode): void {
  for (let i = 0; i < 2; i++) {
    const tt = t + i * 0.28;
    metal(v, tt, rand(1150, 1250), [1, 2.76, 5.4, 8.9], [0.12, 0.06, 0.04, 0.02], [0.5, 0.3, 0.15, 0.08], out); // hammer on anvil
    thump(v, tt, 300, 150, 0.25, 0.04, out, 'triangle');
  }
  noiseBurst(v, t + 0.65, { type: 'bandpass', freq: 2400, Q: 3, a: 0.08, peak: 0.18, d: 0.12, dest: out }); // a saw stroke
}

function sSelArcane(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.5);
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.2, 0.1, 0.4, 0.4);
  for (const m of [57, 64, 69, 76]) {
    const o = oscNode(v, 'sine', mtof(m), t, t + 1.05, g);
    oscNode(v, 'sine', rand(3, 5), t, t + 1.05, gainNode(v, 10, o.detune));
  }
  for (let i = 0; i < 6; i++) ping(v, t + 0.1 + i * 0.1 + rand(0, 0.04), mtof(pick([81, 84, 88, 91, 93])), 0.05, 0.3, out);
}

function sSelFactory(v: Voice, t: number, out: GainNode): void {
  for (let i = 0; i < 3; i++) {
    thump(v, t + i * 0.18, 95, 45, 0.55, 0.1, out); // pistons
    metal(v, t + i * 0.18, 520, [1, 1.5, 2.3], [0.06, 0.04, 0.03], [0.12, 0.08, 0.05], out);
  }
  noiseBurst(v, t + 0.55, { type: 'highpass', freq: 3000, a: 0.01, peak: 0.25, d: 0.35, dest: out }); // steam
}

function sSelSilo(v: Voice, t: number, out: GainNode): void {
  noiseBurst(v, t, { type: 'highpass', freq: 2500, a: 0.05, peak: 0.2, d: 0.4, dest: out }); // hydraulics
  const g = gainNode(v, 0, out);
  swell(g.gain, t + 0.1, 0.02, 0.07, 0.4, 0.05);
  const o = oscNode(v, 'square', 600, t + 0.1, t + 0.6, biquad(v, 'lowpass', 2000, 1, g)); // klaxon blips
  o.frequency.setValueAtTime(600, t + 0.1);
  o.frequency.setValueAtTime(800, t + 0.3);
  thump(v, t + 0.6, 80, 40, 0.5, 0.2, out);
}

function sSelTower(v: Voice, t: number, out: GainNode): void {
  creak(v, t, 0.4, 90, 0.22, out, 30);
  metal(v, t + 0.3, 1400, [1, 1.52, 2.2], [0.05, 0.04, 0.03], [0.2, 0.14, 0.1], out); // a sentry's mail
}

function sSelBunker(v: Voice, t: number, out: GainNode): void {
  noiseBurst(v, t, { type: 'lowpass', freq: 400, a: 0.005, peak: 0.4, d: 0.12, dest: out }); // sandbags
  for (const dt of [0.2, 0.32]) metal(v, t + dt, 2000, [1, 1.7, 2.6], [0.08, 0.05, 0.04], [0.05, 0.03, 0.02], out);
  ping(v, t + 0.5, 1800, 0.05, 0.05, out, 'square'); // a radio blip
}

function sSelTurret(v: Voice, t: number, out: GainNode): void {
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.03, 0.12, 0.25, 0.08);
  const o = oscNode(v, 'sawtooth', 400, t, t + 0.4, biquad(v, 'bandpass', 1200, 4, g)); // servos turn
  sweep(o.frequency, t, 400, 800, 0.3);
  ping(v, t + 0.42, 2600, 0.08, 0.12, out, 'square');
}

function sSelWall(v: Voice, t: number, out: GainNode): void {
  noiseBurst(v, t, { type: 'lowpass', freq: 900, a: 0.05, peak: 0.3, d: 0.3, dest: out }); // stone grinds
  crackle(v, t, 0.3, 8, 0.15, 1200, out);
  thump(v, t + 0.25, 110, 50, 0.45, 0.12, out);
}

function sSelGate(v: Voice, t: number, out: GainNode): void {
  for (let i = 0; i < 8; i++) ping(v, t + i * 0.05 + rand(0, 0.02), rand(1800, 3200), 0.12, 0.05, out, 'triangle', 0.0005); // chains
  creak(v, t + 0.15, 0.45, 70, 0.22, out, 18);
}

function sSelForce(v: Voice, t: number, out: GainNode): void {
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.1, 0.15, 0.4, 0.2);
  oscNode(v, 'sawtooth', 120, t, t + 0.75, biquad(v, 'lowpass', 900, 3, g));
  oscNode(v, 'sawtooth', 121.5, t, t + 0.75, biquad(v, 'lowpass', 900, 3, g));
  crackle(v, t, 0.6, 10, 0.15, 5000, out);
}

function sSelAltar(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.55);
  for (const [m, d] of [[57, 0], [64, 0.04], [69, 0.08]] as const) {
    cry(v, t + d, { f0: [mtof(m), mtof(m)], vowels: 'aa', dur: 1.0, size: 1.05, peak: 0.12, a: 0.25, breath: 0.1, vib: 15, vibRate: 5 }, out); // a choir
  }
}

function sSelKeep(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.5);
  bell(v, t, 98, 0.18, out);
  for (let i = 0; i < 6; i++) ping(v, t + 0.3 + i * 0.06, rand(1500, 2800), 0.05, 0.06, out, 'triangle', 0.0005); // chains
  cry(v, t + 0.1, { f0: [70, 66], vowels: 'oo', dur: 1.0, size: 0.75, breath: 0.6, peak: 0.12 }, out);
}

function sSelSpire(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.5);
  noiseBurst(v, t, { type: 'bandpass', freq: 1500, freqTo: 4000, Q: 4, a: 0.3, peak: 0.12, d: 0.5, dest: out }); // a whisper
  ping(v, t, 311, 0.08, 0.9, out);
  ping(v, t, 329, 0.08, 0.9, out); // a dissonant hum
}

function sSelMine(v: Voice, t: number, out: GainNode): void {
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.2 + rand(0, 0.03);
    metal(v, tt, rand(2100, 2400), [1, 2.4, 3.9], [0.1, 0.05, 0.03], [0.12, 0.07, 0.05], out); // picks
    noiseBurst(v, tt, { type: 'bandpass', freq: 3000, Q: 1, a: 0.0005, peak: 0.25, d: 0.02, dest: out });
  }
}

function sSelShop(v: Voice, t: number, out: GainNode): void {
  for (let i = 0; i < 4; i++) coin(v, t + i * 0.05, rand(0.85, 1.15), 0.1, out);
  for (let i = 0; i < 3; i++) cry(v, t + 0.3 + i * 0.1, { f0: [330, 300], vowels: 'ee', dur: 0.07, size: 1.25, breath: 0.4, peak: 0.16 }, out); // a goblin's "heh heh heh"
}

function sSelVault(v: Voice, t: number, out: GainNode): void {
  wet(v, 0.4);
  creak(v, t, 0.3, 120, 0.15, out, 30); // a chest lid
  chime(v, t + 0.25, mtof(88), 0.1, 0.6, out);
  chime(v, t + 0.32, mtof(95), 0.07, 0.6, out);
  for (let i = 0; i < 3; i++) coin(v, t + 0.3 + i * 0.06, rand(0.9, 1.1), 0.07, out);
}

function sSelMercs(v: Voice, t: number, out: GainNode): void {
  sMelee(v, t, out, 'axe', 'metal');
  for (let i = 0; i < 3; i++) cry(v, t + 0.3 + i * 0.12, { f0: [130, 115], vowels: 'aa', dur: 0.09, size: 0.85, rough: 0.4, breath: 0.3, peak: 0.16 }, out); // "ha ha ha"
  crackle(v, t, 0.8, 10, 0.12, 1800, out); // the campfire
}

function sSelFountain(v: Voice, t: number, out: GainNode): void {
  noiseBurst(v, t, { type: 'bandpass', freq: 1200, Q: 0.7, a: 0.15, peak: 0.18, d: 0.7, dest: out });
  bubbles(v, t, 0.8, 14, 0.14, out);
}

function sSelWagon(v: Voice, t: number, out: GainNode): void {
  creak(v, t, 0.5, 75, 0.2, out, 14); // wheels
  noiseBurst(v, t + 0.35, { type: 'lowpass', freq: 900, a: 0.01, peak: 0.25, d: 0.15, dest: out }); // the horse snorts
  for (let i = 0; i < 3; i++) coin(v, t + 0.55 + i * 0.05, rand(0.9, 1.1), 0.07, out);
}

function sSelBuilding(v: Voice, t: number, out: GainNode): void {
  knock(v, t, 0.9, out);
  thump(v, t + 0.12, 120, 60, 0.35, 0.1, out);
}

// --- movement loops (one shared loop per kind, at the moving units' centre) -----

/** Tracked vehicles: a diesel rumble and the clatter of the tracks (3.2 s loop). */
function aTracks(v: Voice, t: number, out: GainNode, dur: number): void {
  out = gainNode(v, 0.2, out);
  const lp = biquad(v, 'lowpass', 320, 1.5, gainNode(v, 0.5, out));
  const drive = gainNode(v, 2.2, shaper(v, lp));
  oscNode(v, 'sawtooth', 40, t, t + dur, drive);
  oscNode(v, 'square', 20, t, t + dur, gainNode(v, 0.4, drive));
  longNoise(v, t, dur, biquad(v, 'lowpass', 200, 0.7, gainNode(v, 0.5, out)));
  // the tracks: link clanks, 10 a second (32 per loop)
  const g = gainNode(v, 0, out);
  longNoise(v, t, dur, biquad(v, 'bandpass', 1900, 3, g));
  for (let tt = t; tt < t + dur; tt += 0.1) {
    g.gain.setValueAtTime(rand(0.25, 0.4), tt);
    g.gain.setTargetAtTime(0, tt + 0.002, 0.012);
  }
}

/** Antigravity craft: a turbine whine over a soft roar. */
function aHover(v: Voice, t: number, out: GainNode, dur: number): void {
  out = gainNode(v, 2, out);
  const g = gainNode(v, 0.12, out);
  const bp = biquad(v, 'bandpass', 900, 3, g);
  for (const f of [220, 223.125]) oscNode(v, 'sawtooth', f, t, t + dur, bp);
  oscNode(v, 'sine', 0.3125, t, t + dur, gainNode(v, 120, bp.frequency));
  longNoise(v, t, dur, biquad(v, 'bandpass', 1500, 1.2, gainNode(v, 0.25, out)));
  longNoise(v, t, dur, biquad(v, 'lowpass', 160, 0.7, gainNode(v, 0.35, out)));
}

/** Walkers: heavy footfalls with servo whines, two a second. */
function aMech(v: Voice, t: number, out: GainNode, dur: number): void {
  out = gainNode(v, 0.45, out);
  for (let tt = t; tt < t + dur - 0.05; tt += 0.5) {
    thump(v, tt, 80, 30, 0.8, 0.25, out);
    noiseBurst(v, tt, { type: 'lowpass', freq: 400, a: 0.003, peak: 0.35, d: 0.15, dest: out });
    metal(v, tt + 0.01, 300, [1, 1.45, 2.1], [0.05, 0.04, 0.03], [0.2, 0.15, 0.1], out);
    const g = gainNode(v, 0, out);
    swell(g.gain, tt + 0.2, 0.05, 0.06, 0.1, 0.08);
    const o = oscNode(v, 'sawtooth', 500, tt + 0.2, tt + 0.45, biquad(v, 'bandpass', 1300, 4, g));
    sweep(o.frequency, tt + 0.2, 500, 750, 0.2);
  }
}

/** Galloping horses: three-beat clops from a few horses out of step. */
function aHooves(v: Voice, t: number, out: GainNode, dur: number): void {
  out = gainNode(v, 0.7, out);
  for (let h = 0; h < 3; h++) {
    const off = h * 0.13;
    for (let tt = t + off; tt < t + dur - 0.05; tt += 0.4) {
      for (const [dt, lvl] of [[0, 0.5], [0.07, 0.35], [0.14, 0.45]] as const) {
        const c = tt + dt;
        if (c >= t + dur) continue;
        noiseBurst(v, c, { type: 'bandpass', freq: rand(700, 1000), Q: 2.5, a: 0.001, peak: lvl * rand(0.7, 1), d: 0.04, dest: out });
        thump(v, c, 160, 80, lvl * 0.5, 0.05, out);
      }
    }
  }
  longNoise(v, t, dur, biquad(v, 'lowpass', 250, 0.7, gainNode(v, 0.15, out)));
}

/** Wooden wheels of siege engines and wagons: creaks over a rolling rumble. */
function aWheels(v: Voice, t: number, out: GainNode, dur: number): void {
  out = gainNode(v, 3.5, out);
  const g = gainNode(v, 0.35, out);
  longNoise(v, t, dur, biquad(v, 'lowpass', 220, 0.7, g));
  oscNode(v, 'sine', 2.5, t, t + dur, gainNode(v, 0.15, g.gain));
  for (let tt = t + 0.2; tt < t + dur - 0.5; tt += 0.8) creak(v, tt, 0.35, rand(60, 85), 0.18, out, 22);
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

/** The effects the game itself names; the Babylon.js backend renders these up front, the rest on first use. */
export const CORE_SFX = Object.keys(SFX);

// Unit sounds (see src/unitSounds.ts for which unit makes which).
const asShot = (fn: SfxFn, gain = 1, prio = 0): SfxDef => ({ fn, prio, max: 3, group: 'shot', gain });
const asImpact = (fn: SfxFn, gain = 1): SfxDef => ({ fn, prio: 0, max: 2, group: 'impact', gain });
const asBoom = (fn: SfxFn, gain = 1, prio = 1): SfxDef => ({ fn, prio, max: 3, group: 'boom', gain });
const asDeath = (fn: SfxFn, gain = 1, variants = 4): SfxDef => ({ fn, prio: 1, max: 2, group: 'death', gain, variants });
const asCreature = (fn: SfxFn, gain = 1): SfxDef => ({ fn, prio: 1, max: 1, gap: 1, group: 'creature', gain });
const asRoar = (fn: SfxFn, gain = 1): SfxDef => ({ fn, prio: 2, max: 1, gap: 1.5, gain });
const asSelect = (fn: SfxFn, gain = 1, variants = 3): SfxDef => ({ fn, prio: 3, max: 1, gap: 0.25, group: 'building', gain, variants });
Object.assign(SFX, {
  // missiles leaving the attacker
  slingShot: asShot(sSling, 5),
  bowShot: asShot(sBowShot, 1.3),
  longbowShot: asShot(sLongbowShot, 1.4),
  crossbowShot: asShot(sCrossbow, 1.6),
  javelinThrow: asShot(sJavelin, 5),
  ballistaShot: asShot(sBallista, 0.75),
  catapultLaunch: asShot(sCatapult, 0.75, 1),
  trebuchetLaunch: asShot(sTrebuchet, 0.9, 1),
  musketShot: asShot(sMusket, 0.6),
  rifleShot: asShot(sRifle, 0.75),
  sniperShot: asShot(sSniper, 0.7, 1),
  machineGun: asShot(sMachineGun, 1.1),
  assaultBurst: asShot(sAssault, 1.2),
  droneGun: asShot(sDroneGun, 1.4),
  grenadeThrow: asShot(sGrenadeThrow, 2.2),
  cannonShot: asShot(sCannonShot, 0.6, 1),
  howitzerShot: asShot(sHowitzer, 0.6, 1),
  tankShot: asShot(sTankShot, 0.45, 1),
  rocketLaunch: asShot(sRocketLaunch, 1.4),
  rocketArty: asShot(sRocketArty, 1.4),
  flameRoar: asShot(sFlameRoar, 1.3),
  railShot: asShot(sRailShot, 0.75),
  laserTwin: asShot(sLaserTwin, 1.8),
  plasmaShot: asShot(sPlasmaShot),
  plasmaHeavy: asShot(sPlasmaHeavy, 0.7, 1),
  gravitonShot: asShot(sGravitonShot, 0.85, 1),
  holyBolt: asShot(sHolyBolt, 3),
  arcaneBolt: asShot(sArcaneBolt, 3),
  frostBolt: asShot(sFrostBolt, 2),
  waterBolt: asShot(sWaterBolt, 2),
  fireballCast: asShot(sFireballCast, 2),
  felBolt: asShot(sFelBolt, 2),
  axeThrow: asShot(sAxeThrow, 5),
  drakeBreath: asShot(sDrakeBreath, 2),
  // impacts that don't depend on the target
  impHoly: asImpact(sImpHoly, 1.5),
  impArcane: asImpact(sImpArcane, 2.5),
  impFrost: asImpact(sImpFrost, 1.1),
  impWater: asImpact(sImpWater, 1.5),
  impFel: asImpact(sImpFel),
  impFire: asImpact(sImpFire, 1.8),
  missGround: asImpact(sMissGround, 2),
  flameLick: asImpact(sFlameLick, 1.8),
  // splash
  boomRock: asBoom(sBoomRock, 0.75),
  boomGrenade: asBoom(sBoomGrenade, 0.6),
  boomCannon: asBoom(sBoomCannon, 0.6),
  boomShell: asBoom(sBoomShell, 0.55),
  boomRocket: asBoom(sBoomRocket, 0.55),
  boomPlasma: asBoom(sBoomPlasma, 0.7),
  boomGraviton: asBoom(sBoomGraviton, 0.6, 2),
  boomFire: asBoom(sBoomFire, 1.05),
  // deaths
  dieMan: asDeath(sDieMan, 2),
  dieWoman: asDeath(sDieWoman, 2),
  dieKnight: asDeath(sDieKnight, 2),
  dieBrute: asDeath(sDieBrute, 1.8),
  dieCyborg: asDeath(sDieCyborg, 1.6),
  dieHorse: asDeath(sDieHorse, 0.9),
  dieElephant: asDeath(sDieElephant, 0.85, 2),
  dieSiege: asDeath(sDieSiege, 1.2, 3),
  dieVehicle: asDeath(sDieVehicle, 0.55, 3),
  dieMech: asDeath(sDieMech, 0.6, 2),
  dieDrone: asDeath(sDieDrone, 0.85, 3),
  dieWolf: asDeath(sDieWolf, 2.4, 3),
  dieSpider: asDeath(sDieSpider, 3, 3),
  dieOgre: asDeath(sDieOgre, 0.85, 3),
  dieGolem: asDeath(sDieGolem, 0.6, 2),
  dieDrake: asDeath(sDieDrake, 0.8, 2),
  dieKobold: asDeath(sDieKobold, 3, 3),
  dieGnoll: asDeath(sDieGnoll, 2, 3),
  dieTroll: asDeath(sDieTroll, 2, 3),
  dieSkeleton: asDeath(sDieSkeleton, 2.8, 3),
  dieUndead: asDeath(sDieUndead, 1.6, 3),
  dieBoss: { fn: sDieBoss, prio: 3, max: 1, gap: 2, variants: 1 },
  dieWater: asDeath(sDieWater, 2, 2),
  // buildings falling
  collapseWood: asBoom(sCollapseWood, 1.1, 2),
  collapseStone: asBoom(sCollapseStone, 0.75, 2),
  collapseMetal: asBoom(sCollapseMetal, 0.7, 2),
  collapseEnergy: asBoom(sCollapseEnergy, 0.65, 2),
  // creatures: idle calls near their camps, and the roar when a camp is attacked
  wolfHowl: asCreature(sWolfHowl, 1.3),
  spiderChitter: asCreature(sSpiderChitter, 5),
  ogreGrumble: asCreature(sOgreGrumble, 3),
  koboldChatter: asCreature(sKoboldChatter, 3.5),
  gnollCackle: asCreature(sGnollCackle, 3),
  trollMutter: asCreature(sTrollMutter, 3.3),
  golemGrind: asCreature(sGolemGrind, 3.5),
  drakeGrowl: asCreature(sDrakeGrowl, 3),
  undeadMoan: asCreature(sUndeadMoan, 3.5),
  wolfSnarl: asRoar(sWolfSnarl, 3),
  spiderHiss: asRoar(sSpiderHiss, 1.5),
  ogreRoar: asRoar(sOgreRoar, 2.7),
  koboldYell: asRoar(sKoboldYell, 4),
  gnollYell: asRoar(sGnollYell, 5),
  trollYell: asRoar(sTrollYell, 4),
  golemRumble: asRoar(sGolemRumble, 0.95),
  drakeRoar: asRoar(sDrakeRoar, 2.2),
  // a click on a building
  selTribal: asSelect(sSelTribal, 0.8),
  selBell: asSelect(sSelBell, 1.1),
  selCityHall: asSelect(sSelCityHall, 2.4),
  selNexus: asSelect(sSelNexus, 1.1),
  selHouse: asSelect(sSelHouse, 3),
  selHouseModern: asSelect(sSelHouseModern, 2.6),
  selFarm: asSelect(sSelFarm, 2.4, 6),
  selTractor: asSelect(sSelTractor, 0.7),
  selHydro: asSelect(sSelHydro, 3.8),
  selLumber: asSelect(sSelLumber, 0.75),
  selBarracks: asSelect(sSelBarracks, 0.7),
  selBarracksGun: asSelect(sSelBarracksGun),
  selBarracksFuture: asSelect(sSelBarracksFuture, 2.3),
  selStable: asSelect(sSelStable, 2.5),
  selAcademy: asSelect(sSelAcademy, 2.8),
  selLab: asSelect(sSelLab, 2.5),
  selComputer: asSelect(sSelComputer, 2.4),
  selWorkshop: asSelect(sSelWorkshop, 1.4),
  selArcane: asSelect(sSelArcane, 1.2),
  selFactory: asSelect(sSelFactory, 0.85),
  selSilo: asSelect(sSelSilo, 1.05),
  selTower: asSelect(sSelTower, 5),
  selBunker: asSelect(sSelBunker, 4.2),
  selTurret: asSelect(sSelTurret, 5.5),
  selWall: asSelect(sSelWall),
  selGate: asSelect(sSelGate, 4),
  selForce: asSelect(sSelForce, 1.5),
  selAltar: asSelect(sSelAltar, 4.5),
  selKeep: asSelect(sSelKeep, 1.15),
  selSpire: asSelect(sSelSpire, 3),
  selMine: asSelect(sSelMine, 2.2),
  selShop: asSelect(sSelShop, 2.4),
  selVault: asSelect(sSelVault, 2.6),
  selMercs: asSelect(sSelMercs, 0.65),
  selFountain: asSelect(sSelFountain, 2.4),
  selWagon: asSelect(sSelWagon, 3.5),
  selBuilding: asSelect(sSelBuilding),
} satisfies Record<string, SfxDef>);
// Every weapon on every material, and every missile on every material ("melee.sword.metal",
// "impact.arrow.flesh"): built lazily, so only the pairs a game actually hears get rendered.
const MELEE_GAIN: Record<Weapon, number> = {
  club: 0.95, tool: 1.4, sword: 1.3, saber: 1.3, katana: 1.3, axe: 1.25, spear: 1.35, hammer: 0.75, blade: 0.75, maul: 0.6,
  tusk: 0.55, bite: 1.3, fang: 1.5, claw: 1.35, fist: 0.55, energy: 1,
};
const IMPACT_GAIN: Record<Missile, number> = { arrow: 1.8, blunt: 1.1, bullet: 1.6, beam: 1.2, rail: 0.8 };
for (const w of WEAPONS) {
  for (const m of MATERIALS) SFX[`melee.${w}.${m}`] = { fn: (v, t, out) => sMelee(v, t, out, w, m), prio: 0, max: 2, group: 'melee', gain: MELEE_GAIN[w] };
}
for (const mi of MISSILES) {
  for (const m of MATERIALS) SFX[`impact.${mi}.${m}`] = asImpact((v, t, out) => sImpact(v, t, out, mi, m), IMPACT_GAIN[mi]);
}

/**
 * Fire-and-forget sound effect. `volume` (0..1) is typically distance
 * attenuation from the game. Unknown names, a muted / uninitialized context
 * and throttled calls are silently ignored.
 */
export function playSfx(name: string, volume = 1): void {
  const def = Object.prototype.hasOwnProperty.call(SFX, name) ? SFX[name] : null;
  if (def) startVoice(name, def, volume, def.fn);
}

function statsOf(key: string): NameStats {
  let st = nameStats.get(key);
  if (!st) {
    st = { count: 0, last: -1e9 };
    nameStats.set(key, st);
  }
  return st;
}

/** Start one synthesized voice, subject to the per-name and group limits and voice stealing. */
function startVoice(name: string, def: Throttle, volume: number, fn: SfxFn): void {
  if (muted || !canPlay()) return;
  const ac = ctx!;
  const vol = toUnit(volume, 1);
  if (vol < 0.01) return;

  const now = ac.currentTime;
  const st = statsOf(name);
  if (now - st.last < (def.gap != null ? def.gap : MIN_GAP)) return;
  if (st.count >= (def.max != null ? def.max : MAX_PER_NAME)) return;
  const grp = def.group ? SFX_GROUPS[def.group] : undefined;
  const gst = grp ? statsOf(`group:${def.group}`) : null;
  if (grp && gst && (now - gst.last < grp.gap || gst.count >= grp.max)) return;
  if (voices.length >= MAX_VOICES && !stealVoice(def.prio, vol)) return;

  const out = ac.createGain();
  out.gain.value = vol * (def.gain != null ? def.gain : 1);
  out.connect(sfxGain!);
  const v = makeVoice(name, def.prio, out, st, gst, vol);
  v.counted = true;
  st.count++;
  st.last = now;
  if (gst) {
    gst.count++;
    gst.last = now;
  }
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
    ready: ['RE-di-for-AK-shon!', 'RE-di-tu-FAIT.'],
  },
  worker: {
    select: ['YE-es?', 'mi-LORD?', 'MOR-wurk?', 'hm?', 'WHAT?'],
    move: ['o-KEI.', 'JOB-dan.', 'YUP.', 'WUR-kin.', 'al-RAIT.'],
    attack: ['HAH!', 'ok-OK!', 'if-ai-MUST!'],
    ready: ['RE-di-tu-WURK!', 'wurk-WURK.'],
  },
  caveman: {
    select: ['UG?', 'hu-UH?', 'GA?', 'oo-GA?'],
    move: ['UG-ga.', 'oo-GA.', 'BA-du.', 'HUP.'],
    attack: ['RAAH!', 'UG-ga-BUG!', 'GRA-ah!', 'HAA-ga!'],
    ready: ['UG! RE-di!', 'HU-ga-HUP!'],
  },
  mystic: {
    select: ['YE-es?', 'ai-LIS-en.', 'SPIK.', 'the-LAIT?'],
    move: ['SO-bi-it.', 'AZ-yu-WISH.', 'ai-GO.', 'of-KORS.'],
    attack: ['BI-GON!', 'BURN!', 'for-the-LAIT!', 'FIL-mai-RATH!'],
    ready: ['ai-AM-HIR.', 'the-LAIT-gaids-mi.'],
  },
  radio: {
    select: ['GO-a-HED.', 'RO-ger?', 'SAR-jent?', 'STAN-din-BAI.'],
    move: ['RO-ger.', 'KO-pi.', 'MO-vin-AUT.', 'ON-it.', 'WIL-ko.'],
    attack: ['en-GEI-jin!', 'O-pen-FAI-er!', 'TAR-get-SAI-ted!', 'LOK-and-LOD!'],
    ready: ['RE-por-tin-for-DU-ti.', 'LOKT-and-LO-ded.'],
  },
  robot: {
    select: ['a-WEI-tin-IN-put.', 'SIS-tems-ON-lain.', 'RE-di.'],
    move: ['AF-fir-ma-tiv.', 'KO-or-di-nets-LOKT.', 'PRO-sid-in.'],
    attack: ['TAR-get-ak-WAI-erd!', 'EK-se-kyu-tin!', 'ter-mi-NEIT!'],
    ready: ['ON-lain.', 'SIS-tems-RE-di.'],
  },
  hero: {
    select: ['ai-AM-RE-di.', 'WOT-iz-it?', 'SPIK.', 'YES?', 'mai-LIJ?'],
    move: ['AT-wans.', 'LID-on.', 'ai-SHAL-GO.', 'SO-bi-IT.'],
    attack: ['for-ON-or!', 'tu-BAT-tel!', 'DAI!', 'yu-WIL-FOL!'],
    ready: ['ai-RE-turn!', 'LET-us-BE-gin.'],
  },
  archer: {
    select: ['ai-MING?', 'YES?', 'RE-di?', 'mi-LORD?'],
    move: ['on-mai-WEI.', 'SWIFT-li.', 'az-yu-WISH.', 'YES.'],
    attack: ['LOOS!', 'FAI-er!', 'DROR!', 'TEI-king-AIM!'],
    ready: ['BOWS-RE-di!', 'ar-ROWS-NOKT.'],
  },
  rider: {
    select: ['mi-LORD?', 'YES?', 'RE-di-tu-RAID.', 'MOUN-ted.'],
    move: ['RAID-on!', 'HAA!', 'GAL-op.', 'tu-the-FRONT.'],
    attack: ['CHAR-ja!', 'RAID-them-DOUN!', 'for-the-KING!'],
    ready: ['MOUN-ted-and-RE-di!', 'tu-the-SAD-del!'],
  },
  siege: {
    select: ['LO-ded?', 'KRU-RE-di.', 'WHAT-ta-HIT?'],
    move: ['ROL-it-OUT.', 'HEEV!', 'PUSH!'],
    attack: ['LET-er-FLAI!', 'FAI-er!', 'BRING-it-DOUN!'],
    ready: ['SIJ-RE-di.', 'ma-SHIN-as-SEM-bled.'],
  },
  musket: {
    select: ['PRAI-med?', 'SAR-jent?', 'YES-sir?'],
    move: ['MARCH!', 'FORM-up.', 'LEFT-RAIT.'],
    attack: ['PRE-sent!', 'FAI-er!', 'VOL-li!'],
    ready: ['MUS-kets-RE-di.', 'PRAIMD-and-LO-ded!'],
  },
  rifle: {
    select: ['SIR?', 'OR-ders?', 'YES-sir?'],
    move: ['MO-vin-OUT.', 'on-mai-WEI.', 'DUB-el-TAIM!'],
    attack: ['FAI-er!', 'TEI-king-SHOTS!', 'O-ver-the-TOP!'],
    ready: ['re-POR-ting-SIR!', 'RAI-fels-RE-di.'],
  },
  future: {
    select: ['STAN-ding-BAI.', 'IN-put?', 'SUT-on-LAIN.'],
    move: ['VEK-tor-SET.', 're-lo-KEI-ting.', 'MO-ving.'],
    attack: ['en-GEI-jing!', 'WEP-ons-FREE!', 'LEI-zers-HOT!'],
    ready: ['SUT-pow-ered.', 'BAT-tel-RE-di.'],
  },
  void: {
    select: ['the-VOID-a-WEITS.', 'WE-are-HIR.', 'SPIK.'],
    move: ['SHIFT-ing.', 'THRU-the-VOID.', 'be-YOND.'],
    attack: ['UN-MEIK!', 'o-BLI-vi-on!', 'FEID!'],
    ready: ['FROM-the-STARS.', 'WE-a-RAIV.'],
  },
  kobold: {
    select: ['yu-no-TEIK!', 'KAN-del?', 'WHAT-yu-WANT?'],
    move: ['GO-GO.', 'o-kei-o-KEI.', 'DIG-dig.'],
    attack: ['MAIN!', 'YA-ha!', 'GET-em!'],
    ready: ['KO-bold-RE-di!'],
  },
  gnoll: {
    select: ['YAP?', 'HUH-huh?', 'WHAT?'],
    move: ['YIP-yip.', 'GO-ing.', 'HUN-ting.'],
    attack: ['RAA-ip!', 'BAIT!', 'KILL-kill!'],
    ready: ['GNOL-HUN-gri!'],
  },
  troll: {
    select: ['WHAT-mon?', 'HMM?', 'YA-mon?', 'SPIK-mon.'],
    move: ['YA-mon.', 'EE-zi.', 'ai-be-GO-in.'],
    attack: ['DAI!', 'HA-ya!', 'yu-be-DED!'],
    ready: ['TROL-be-RE-di-mon.'],
  },
  ogre: {
    select: ['DUH?', 'WHAT?', 'HUH?', 'MI-HIR.'],
    move: ['o-KEI.', 'MI-GO.', 'STOMP-stomp.'],
    attack: ['MI-SMASH!', 'RAA!', 'KRUSH!'],
    ready: ['O-ger-RE-di!', 'MI-BIG!'],
  },
  undead: {
    select: ['WE-SERV.', 'hwat-iz-thai-WIL?', 'DETH-a-WEITS.'],
    move: ['WE-MARCH.', 'az-yu-ko-MAND.', 'THRU-SHA-dou.'],
    attack: ['DAI!', 'for-the-MAS-ter!', 'NO-MER-si!'],
    ready: ['RAIZD-a-GEN.'],
  },
  tyrant: {
    select: ['HU-DARS?', 'KNEEL.', 'SPIK-mor-tal.'],
    move: ['MAI-WIL.', 'the-LAND-iz-MAIN.'],
    attack: ['PE-rish!', 'BURN!', 'KNEEL-or-DAI!'],
    ready: ['ai-RAIZ.'],
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
  /** A radio, a robot's ring modulator, a ghostly echo, a helmet speaker or the void's shimmer. */
  fx?: 'radio' | 'robot' | 'ghost' | 'helmet' | 'void';
  /** A sound after the words: a horse snorts, wood creaks, servos whir. */
  extra?: 'horse' | 'creak' | 'servo';
}
/** Units that answer without words: engines, droids, beasts and bones. */
type BarkType = 'engine' | 'droid' | 'trumpet' | 'bubbles' | 'steam' | 'hover' | 'wolf' | 'spider' | 'golem' | 'drake' | 'skeleton' | 'wagon';
type VoiceDef = Speaker | { type: BarkType };

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
  archer: { f0: 132, size: 1.04, rough: 0.05, tempo: 1.08, words: 'archer' },
  rider: { f0: 108, size: 0.95, rough: 0.15, tempo: 0.95, words: 'rider', extra: 'horse' },
  siege: { f0: 112, size: 0.97, rough: 0.2, words: 'siege', extra: 'creak' },
  musket: { f0: 115, size: 0.98, rough: 0.12, words: 'musket' },
  rifle: { f0: 110, size: 0.97, rough: 0.16, tempo: 1.05, words: 'rifle' },
  helmet: { f0: 116, size: 1, rough: 0.05, tempo: 1.05, level: 0.85, words: 'future', fx: 'helmet' },
  exo: { f0: 100, size: 0.93, rough: 0.15, tempo: 0.95, level: 0.85, words: 'future', fx: 'helmet', extra: 'servo' },
  void: { f0: 98, size: 0.92, rough: 0, tempo: 0.9, breath: 0.05, wet: 0.35, vib: 0.5, level: 0.75, words: 'void', fx: 'void' },
  mech: { f0: 72, size: 0.82, rough: 0.1, tempo: 0.85, level: 0.6, words: 'robot', fx: 'robot', extra: 'servo' },
  kobold: { f0: 290, size: 1.3, rough: 0.1, tempo: 1.35, level: 0.7, words: 'kobold' },
  gnoll: { f0: 175, size: 1.02, rough: 0.35, tempo: 1.2, words: 'gnoll' },
  troll: { f0: 125, size: 0.96, rough: 0.12, tempo: 0.95, vib: 0.4, words: 'troll' },
  ogre: { f0: 72, size: 0.8, rough: 0.45, tempo: 0.8, words: 'ogre' },
  deathguard: { f0: 88, size: 0.88, rough: 0.3, tempo: 0.85, breath: 0.15, wet: 0.4, level: 0.9, words: 'undead', fx: 'ghost' },
  kalenden: { f0: 62, size: 0.78, rough: 0.55, tempo: 0.8, breath: 0.1, wet: 0.45, words: 'tyrant', fx: 'ghost' },
  engine: { type: 'engine' },
  droid: { type: 'droid' },
  trumpet: { type: 'trumpet' },
  bubbles: { type: 'bubbles' },
  steam: { type: 'steam' },
  hover: { type: 'hover' },
  wolf: { type: 'wolf' },
  spider: { type: 'spider' },
  golem: { type: 'golem' },
  drake: { type: 'drake' },
  skeleton: { type: 'skeleton' },
  wagon: { type: 'wagon' },
};

/** Voices of particular unit types (the rest follow their age and kind; see barkVoice). */
const VOICE_OF: Record<string, string> = {
  water_elemental: 'bubbles', war_elephant: 'trumpet', sorceress: 'sorceress', exo_trooper: 'exo',
  kobold: 'kobold', gnoll: 'gnoll', gnoll_archer: 'gnoll', wolf: 'wolf', forest_troll: 'troll', spider: 'spider',
  ogre: 'ogre', ogre_lord: 'ogre', rock_golem: 'golem', drake: 'drake',
  skeleton: 'skeleton', skeleton_archer: 'skeleton', dark_knight: 'deathguard', kalenden: 'kalenden',
  cargo_wagon: 'wagon', steam_tank: 'steam', combat_drone: 'droid', mech_walker: 'mech', titan: 'mech',
  hover_tank: 'hover', starfighter: 'hover', stealth_tank: 'hover', graviton: 'hover',
};

/**
 * Which voice a unit type answers with (null: it doesn't). Infantry, archers, riders, siege crews,
 * mages, musketeers, riflemen, radio-era soldiers, armoured future troopers and the void troopers of
 * the last age each sound different; so do vehicles, heroes, creeps and the Legion.
 */
export function barkVoice(def: UnitDef | null | undefined): string | null {
  if (!def || def.kind === 'building') return null;
  if (def.hero) return VOICES[def.id] ? def.id : 'paladin';
  const known = VOICE_OF[def.id];
  if (known) return known;
  const age = def.age ?? 0;
  if (def.caravan) return 'wagon';
  if (def.boss) return 'kalenden';
  if (def.undead) return def.armorType === 'heavy' ? 'deathguard' : 'skeleton';
  if (def.vehicle) return age >= 10 ? 'hover' : 'engine';
  if (def.worker) return 'worker';
  if (def.creep || def.legion) return def.radius >= 0.65 ? 'ogre' : 'gnoll';
  if (def.attackType === 'magic' && age <= 6) return 'mystic';
  if (age === 1) return 'caveman';
  if (def.minRange && age <= 7) return 'siege';
  if (age >= 12) return 'void';
  if (age >= 11) return 'helmet';
  if (age >= 8) return 'radio';
  if (age === 7) return 'rifle';
  if (def.cavalry) return 'rider';
  if (age === 6) return 'musket';
  if (def.projectile?.kind === 'arrow') return 'archer';
  if (def.armorType === 'heavy') return 'heavy';
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
  if (vc.fx === 'helmet') {
    // A suit's speaker: band-limited, a little driven, with a soft click on and off.
    const hp = biquad(v, 'highpass', 350, 0.7, null);
    mix.connect(hp);
    hp.connect(biquad(v, 'lowpass', 3400, 1, gainNode(v, 1.6, shaper(v, gainNode(v, 0.6, out)))));
    ping(v, t, 2400, 0.05, 0.02, out, 'square');
    ping(v, end - 0.05, 1600, 0.04, 0.02, out, 'square');
    return out;
  }
  if (vc.fx === 'ghost' || vc.fx === 'void') {
    // A hollow comb echo (ghost), or a shimmering, slowly swept one with a ring-modulated halo (void).
    const ac = ctx!;
    const d = track(v, ac.createDelay(0.1));
    d.delayTime.value = vc.fx === 'ghost' ? 0.017 : 0.011;
    const fb = gainNode(v, vc.fx === 'ghost' ? 0.55 : 0.45, d);
    d.connect(fb);
    mix.connect(d);
    d.connect(gainNode(v, 0.6, out));
    mix.connect(gainNode(v, 0.8, out));
    if (vc.fx === 'void') {
      oscNode(v, 'sine', 0.7, t, end, gainNode(v, 0.004, d.delayTime));
      const ring = gainNode(v, 0, gainNode(v, 0.35, out));
      mix.connect(ring);
      oscNode(v, 'sine', 410, t, end, ring.gain);
    }
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
  const dur = kind === 'select' ? 0.55 : kind === 'move' ? 0.9 : kind === 'ready' ? 1.1 : 0.8;
  const stop = t + dur + 0.05;
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.04, 0.12, dur - 0.25, 0.22);
  const lp = biquad(v, 'lowpass', 500, 3, g);
  const drive = gainNode(v, 2.5, shaper(v, lp));
  const o = oscNode(v, 'sawtooth', 42, t, stop, drive);
  const o2 = oscNode(v, 'square', 21, t, stop, gainNode(v, 0.5, drive));
  const [f1, f2] = kind === 'select' ? [42, 52] : kind === 'move' ? [40, 85] : kind === 'ready' ? [30, 90] : [48, 105];
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
        : kind === 'ready'
          ? [[0, 700, 1400, 0.1], [0.12, 1400, 1400, 0.06], [0.2, 1760, 1760, 0.06], [0.28, 2350, 2350, 0.12]]
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
  const dur = kind === 'attack' || kind === 'ready' ? 1 : kind === 'move' ? 0.5 : 0.65;
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
  const count = kind === 'attack' || kind === 'ready' ? 10 : 6;
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

/** A landship: a steam whistle and the chuff of its engine. */
function steamBark(v: Voice, t: number, kind: BarkKind, out: GainNode): void {
  const whistle = kind === 'attack' || kind === 'ready';
  if (whistle) {
    const g = gainNode(v, 0, out);
    swell(g.gain, t, 0.04, 0.16, kind === 'ready' ? 0.6 : 0.35, 0.12);
    for (const f of [560, 700, 840]) oscNode(v, 'sine', f * rand(0.99, 1.01), t, t + 0.9, g);
    noiseBurst(v, t, { type: 'bandpass', freq: 3000, Q: 1, a: 0.04, peak: 0.08, d: 0.5, dest: out });
  }
  const t0 = whistle ? t + 0.2 : t;
  for (let i = 0; i < (kind === 'move' ? 5 : 3); i++) {
    noiseBurst(v, t0 + i * 0.17, { type: 'bandpass', freq: 900, Q: 0.8, a: 0.01, peak: 0.25, d: 0.12, dest: out }); // chuff
    thump(v, t0 + i * 0.17, 90, 50, 0.2, 0.08, out);
  }
}

/** Antigravity craft: a turbine spinning up (move, attack) or idling (select), and a cockpit beep. */
function hoverBark(v: Voice, t: number, kind: BarkKind, out: GainNode): void {
  const dur = kind === 'select' ? 0.5 : 0.8;
  const g = gainNode(v, 0, out);
  swell(g.gain, t, 0.08, 0.16, dur - 0.25, 0.15);
  const bp = biquad(v, 'bandpass', 900, 3, g);
  for (const det of [0, 9]) {
    const o = oscNode(v, 'sawtooth', 220, t, t + dur + 0.05, bp);
    o.detune.value = det;
    sweep(o.frequency, t, kind === 'select' ? 260 : 180, kind === 'select' ? 240 : 420, dur * 0.8);
  }
  sweep(bp.frequency, t, 700, kind === 'select' ? 900 : 2000, dur * 0.8);
  noiseBurst(v, t, { type: 'bandpass', freq: 1500, Q: 1.2, a: 0.1, peak: 0.12, d: dur, dest: out });
  const beeps = kind === 'attack' ? [1760, 1760] : kind === 'ready' ? [1320, 1760, 2093] : [1568];
  beeps.forEach((f, i) => ping(v, t + 0.05 + i * 0.09, f, 0.07, 0.06, out, 'square'));
}

/** Beasts and bones answer with their own calls. */
function creatureBark(v: Voice, t: number, type: BarkType, kind: BarkKind, out: GainNode): void {
  const soft = gainNode(v, 0.7, out);
  switch (type) {
    case 'wolf':
      if (kind === 'attack') sWolfSnarl(v, t, out);
      else if (kind === 'ready') cry(v, t, { f0: [380, 600, 520], vowels: 'uou', dur: 0.8, size: 1.1, peak: 0.3, a: 0.1, src: 'triangle', vib: 25 }, out);
      else if (kind === 'move') for (let i = 0; i < 3; i++) noiseBurst(v, t + i * 0.15, { type: 'bandpass', freq: 1200, Q: 1, a: 0.02, peak: 0.25, d: 0.08, dest: out }); // panting
      else cry(v, t, { f0: [160, 190, 150], vowels: 'ooo', dur: 0.45, size: 1.05, rough: 0.7, growl: 0.8, growlRate: 40, drive: 2, peak: 0.25, breath: 0.4 }, out);
      break;
    case 'spider':
      if (kind === 'attack' || kind === 'ready') sSpiderHiss(v, t, out);
      else sSpiderChitter(v, t, out);
      break;
    case 'golem':
      if (kind === 'attack' || kind === 'ready') sGolemRumble(v, t, out);
      else sGolemGrind(v, t, soft);
      break;
    case 'drake':
      if (kind === 'attack' || kind === 'ready') sDrakeRoar(v, t, out);
      else sDrakeGrowl(v, t, out);
      break;
    case 'skeleton':
      debris(v, t, 0.4, 8, 'bone', 0.3, out); // a rattle of bones and a dry whisper
      noiseBurst(v, t + 0.05, { type: 'bandpass', freq: kind === 'attack' ? 2500 : 1500, freqTo: 900, Q: 3, a: 0.08, peak: 0.12, d: 0.35, dest: out });
      if (kind === 'attack' || kind === 'ready') sUndeadMoan(v, t + 0.1, soft);
      break;
    case 'wagon':
      sSelWagon(v, t, out);
      break;
    default:
      break;
  }
}

/** A sound after a speaker's words. */
function voiceExtra(v: Voice, t: number, extra: Speaker['extra'], kind: BarkKind, out: GainNode): void {
  if (extra === 'horse') {
    if (kind === 'attack' || kind === 'ready') {
      cry(v, t, { f0: [650, 880, 760, 560], vowels: 'ieea', dur: 0.55, size: 0.8, rough: 0.1, vib: 160, vibRate: 11, breath: 0.25, peak: 0.16 }, out);
    } else {
      noiseBurst(v, t, { type: 'lowpass', freq: 900, a: 0.01, peak: 0.25, d: 0.15, dest: out }); // a snort
    }
  } else if (extra === 'creak') {
    creak(v, t, 0.35, 70, 0.18, out, 20);
  } else if (extra === 'servo') {
    const g = gainNode(v, 0, out);
    swell(g.gain, t, 0.04, 0.08, 0.15, 0.08);
    const o = oscNode(v, 'sawtooth', 380, t, t + 0.3, biquad(v, 'bandpass', 1100, 4, g));
    sweep(o.frequency, t, 380, 620, 0.22);
    if (kind === 'move' || kind === 'attack') thump(v, t + 0.25, 80, 35, 0.35, 0.18, out); // a heavy step
  }
}

function sBark(v: Voice, t: number, out: GainNode, voiceId: string, kind: BarkKind, line?: number): void {
  const vc = VOICES[voiceId] || VOICES.man!;
  if (vc.type) {
    if (vc.type === 'engine') return engineBark(v, t, kind, out);
    if (vc.type === 'droid') return droidBark(v, t, kind, out);
    if (vc.type === 'trumpet') return trumpetBark(v, t, kind, out);
    if (vc.type === 'bubbles') return bubbleBark(v, t, kind, out);
    if (vc.type === 'steam') return steamBark(v, t, kind, out);
    if (vc.type === 'hover') return hoverBark(v, t, kind, out);
    return creatureBark(v, t, vc.type, kind, out);
  }
  const words = PHRASES[vc.words]!;
  const lines = words[kind] || words.select;
  speak(v, t, vc, line != null ? lines[line % lines.length]! : pick(lines), out);
  if (vc.extra) voiceExtra(v, v.end - 0.1, vc.extra, kind, out);
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
  // Movement loops; each length is a whole number of its rhythm, so the loop point is seamless.
  tracks: { fn: aTracks, loop: 3.2 },
  hover: { fn: aHover, loop: 3.2 },
  mech: { fn: aMech, loop: 3 },
  hooves: { fn: aHooves, loop: 3.2 },
  wheels: { fn: aWheels, loop: 3.2 },
};
/** Movement loops (see renderAmbient). */
export const MOVE_LOOPS = ['tracks', 'hover', 'mech', 'hooves', 'wheels'] as const;
export type MoveLoop = (typeof MOVE_LOOPS)[number];

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
export function sfxInfo(name: string): { prio: number; max: number; gap: number; gain: number; duck: number; group: string | null; variants: number } | null {
  const d = Object.prototype.hasOwnProperty.call(SFX, name) ? SFX[name] : null;
  if (!d) return null;
  return { prio: d.prio, max: d.max ?? MAX_PER_NAME, gap: d.gap ?? MIN_GAP, gain: d.gain ?? 1, duck: d.duck ?? 0, group: d.group ?? null, variants: d.variants ?? 3 };
}

/** Is `name` a sound effect? */
export function hasSfx(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(SFX, name);
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
