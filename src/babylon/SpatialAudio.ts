// Babylon.js audio for Heroes & Empires.
//
// The sound effects are still synthesized by src/audio.ts, but rendered offline into buffers (a few
// variants each) and played as AudioEngineV2 spatial sounds: they pan with their place on screen and
// fade with distance from the camera target over the same 14 -> 50 unit range as before. The engine
// shares audio.ts's AudioContext, and its output joins the mix ahead of audio.ts's compressor and
// master volume, so mute and volume cover everything. The procedural music stays on the raw Web Audio
// scheduler in audio.ts.
//
// New with Babylon: unit acknowledgements (barks) and an ambient bed (wind, birds by day, crickets
// by night and the drone of Kalenden's citadel).
//
// Until the engine exists (it needs the first user gesture) or a sound's buffers are rendered,
// play() and bark() return false and the caller falls back to audio.ts's live synth.
import { CreateAudioEngineAsync } from '@babylonjs/core/AudioV2/webAudio/webAudioEngine';
import type { AudioEngineV2 } from '@babylonjs/core/AudioV2/abstractAudio/audioEngineV2';
import type { AudioBus } from '@babylonjs/core/AudioV2/abstractAudio/audioBus';
import type { StaticSound, IStaticSoundOptions } from '@babylonjs/core/AudioV2/abstractAudio/staticSound';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import * as synth from '../audio.ts';
import { CENTER } from '../world/layout.ts';

/** Full volume within this ground distance of the camera target, silent beyond FAR (as before). */
const NEAR = 14;
const FAR = 50;
/**
 * The listener hovers this far above the camera target, looking down. A sound right below it plays
 * in the centre and one at the screen edge pans gently, instead of every sound beside the target
 * panning hard left or right. The distance range is widened to match.
 */
const LISTENER_HEIGHT = 8;
/** Variants rendered per effect; effects longer than LONG seconds (fanfares, sirens, thunder) render once. */
const VARIANTS = 3;
const LONG = 2;
const BIRD_VARIANTS = 6;

const SPATIAL: Partial<IStaticSoundOptions> = {
  spatialEnabled: true,
  spatialAutoUpdate: false,
  spatialDistanceModel: 'linear',
  spatialMinDistance: Math.hypot(NEAR, LISTENER_HEIGHT),
  spatialMaxDistance: Math.hypot(FAR, LISTENER_HEIGHT),
  spatialRolloffFactor: 1,
  spatialPanningModel: 'equalpower',
};

const attenuation = (d: number): number => Math.max(0, Math.min(1, 1 - (d - NEAR) / (FAR - NEAR)));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Voice {
  sound: StaticSound;
  name: string;
  prio: number;
  start: number;
  busy: boolean;
  counted: boolean;
  /** Not positional: kept under the listener. */
  follow: boolean;
}

interface Pool {
  voices: Voice[];
  next: number;
}

export interface AudioCamera {
  target: { x: number; z: number };
  yaw: number;
  distance: number;
}

export interface AmbientClock {
  /** Hours, 0-24. */
  timeOfDay: number;
}

interface Ambience {
  wind: StaticSound;
  crickets: StaticSound;
  drone: StaticSound;
  birds: StaticSound[];
}

/**
 * The listener's orientation: looking straight down, with "up" pointing along the camera's view
 * across the ground, so screen right is the listener's right.
 */
function listenerRotation(yaw: number, out: Quaternion): void {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  // Local X (right), Y (up = the view direction across the ground), Z (back = world up).
  Quaternion.RotationQuaternionFromAxisToRef(new Vector3(c, 0, -s), new Vector3(-s, 0, -c), new Vector3(0, 1, 0), out);
}

/**
 * Send the engine's output into `node` (audio.ts's effects input, ahead of its compressor and
 * master volume) instead of straight to the speakers. AudioEngineV2 has no public option for this,
 * so this re-wires the main output's gain node; should that ever change, the engine keeps its own
 * output and SpatialAudio.setMuted() mirrors the mute button instead.
 */
function routeInto(engine: AudioEngineV2, node: AudioNode | null): boolean {
  const out = (engine.mainOut as unknown as { _inNode?: unknown })._inNode;
  if (!node || !(out instanceof AudioNode) || out.context !== node.context) return false;
  out.disconnect();
  out.connect(node);
  return true;
}

export class SpatialAudio {
  private engine: AudioEngineV2 | null = null;
  private starting: Promise<void> | null = null;
  private rendering: Promise<void> | null = null;
  private routed = false;
  private sfxBus: AudioBus | null = null;
  private voiceBus: AudioBus | null = null;
  private ambientBus: AudioBus | null = null;

  private readonly buffers = new Map<string, AudioBuffer[]>();
  private readonly pools = new Map<string, Pool>();
  private readonly building = new Map<string, Promise<void>>();
  private readonly active: Voice[] = [];
  private readonly stats = new Map<string, { count: number; last: number }>();

  private readonly barks = new Map<string, StaticSound[]>();
  private readonly barksRequested = new Set<string>();
  private readonly barkQueue: string[] = [];
  private barkUntil = 0;

  private ambience: Ambience | null = null;
  private ambienceBuilding = false;
  private clock: AmbientClock | null = null;
  private nextAmbience = 0;
  private nextBird = 0;

  private tx = CENTER;
  private tz = CENTER;
  private yaw = Number.NaN;

  /** Render the sound effects in the background (call once at boot; needs no user gesture). */
  prerender(): Promise<void> {
    this.rendering ??= (async () => {
      for (const name of synth.SFX_NAMES) {
        const list: AudioBuffer[] = [];
        for (let i = 0; i < VARIANTS; i++) {
          const b = await synth.renderSfx(name, i);
          if (b) list.push(b);
          if (!b || b.duration > LONG) break;
        }
        if (!list.length) continue;
        this.buffers.set(name, list);
        if (this.engine) await this.buildPool(name);
      }
    })().catch((e: unknown) => console.warn('[audio] pre-rendering failed; using the live synth:', e));
    return this.rendering;
  }

  /** Create the audio engine on audio.ts's context. Call after initAudio(), from a user gesture. */
  start(): Promise<void> {
    const ctx = synth.getAudioContext() as AudioContext | null;
    if (!ctx) return Promise.resolve();
    this.starting ??= (async () => {
      const engine = await CreateAudioEngineAsync({
        audioContext: ctx,
        disableDefaultUI: true,
        disableIOSRingerSwitchWorkaround: true,
        resumeOnInteraction: false, // audio.ts resumes the context on gestures
        listenerEnabled: true,
        listenerAutoUpdate: false,
        // Parameter changes apply at once: a pooled sound must not glide from its last position.
        parameterRampDuration: 0,
      });
      this.routed = routeInto(engine, synth.getSfxInput() as AudioNode | null);
      [this.sfxBus, this.voiceBus, this.ambientBus] = await Promise.all([
        engine.createBusAsync('effects'),
        engine.createBusAsync('voices'),
        engine.createBusAsync('ambience'),
      ]);
      this.engine = engine;
      for (const name of [...this.buffers.keys()]) await this.buildPool(name);
      if (this.clock) void this.buildAmbience();
      this.prepareBarks(this.barkQueue.splice(0));
    })().catch((e: unknown) => {
      console.warn('[audio] Babylon audio is unavailable; using the live synth:', e);
    });
    return this.starting;
  }

  get ready(): boolean {
    return this.engine !== null;
  }

  /** Mirror the mute button when the engine's output couldn't be routed through audio.ts's master. */
  setMuted(muted: boolean): void {
    if (this.engine && !this.routed) this.engine.volume = muted ? 0 : 0.6;
  }

  private buildPool(name: string): Promise<void> {
    if (this.pools.has(name)) return Promise.resolve();
    let p = this.building.get(name);
    if (!p) {
      p = (async () => {
        const engine = this.engine!;
        const info = synth.sfxInfo(name)!;
        const bufs = await Promise.all(this.buffers.get(name)!.map((b) => engine.createSoundBufferAsync(b)));
        const voices: Voice[] = [];
        for (let i = 0; i < info.max; i++) {
          const sound = await engine.createSoundAsync(`${name}-${i}`, bufs[i % bufs.length]!, { ...SPATIAL, outBus: this.sfxBus });
          const v: Voice = { sound, name, prio: info.prio, start: 0, busy: false, counted: false, follow: false };
          sound.onEndedObservable.add(() => {
            this.release(v);
            v.busy = false;
          });
          voices.push(v);
        }
        this.pools.set(name, { voices, next: 0 });
      })();
      this.building.set(name, p);
    }
    return p;
  }

  private stat(name: string): { count: number; last: number } {
    let st = this.stats.get(name);
    if (!st) {
      st = { count: 0, last: -1e9 };
      this.stats.set(name, st);
    }
    return st;
  }

  private release(v: Voice): void {
    if (!v.counted) return;
    v.counted = false;
    this.stat(v.name).count--;
    const i = this.active.indexOf(v);
    if (i >= 0) this.active.splice(i, 1);
  }

  /**
   * Free a slot for a sound of priority `prio`, as audio.ts does: lower priorities go first, and a
   * sound of the same priority only once it is past its attack.
   */
  private steal(prio: number, now: number): boolean {
    let victim: Voice | null = null;
    for (const v of this.active) {
      const ok = v.prio < prio || (v.prio === prio && now - v.start > 0.12);
      if (ok && (!victim || v.prio < victim.prio)) victim = v;
    }
    if (!victim) return false;
    this.release(victim);
    victim.sound.setVolume(0, { duration: 0.03 });
    victim.sound.stop({ waitTime: 0.05 });
    return true;
  }

  private place(s: StaticSound, x: number, z: number): void {
    s.spatial.position.set(x, 0, z);
    s.spatial.update();
  }

  /**
   * Play effect `name` at map position (x, z), or centred when there is none. Returns false when
   * this backend can't play it yet; true when it played or was dropped (throttled, muted, too far).
   */
  play(name: string, volume = 1, x?: number, z?: number): boolean {
    const pool = this.pools.get(name);
    const engine = this.engine;
    if (!pool || !engine) return false;
    if (!synth.canPlayNow() || volume < 0.01) return true;
    const info = synth.sfxInfo(name)!;
    const positional = x !== undefined && z !== undefined;
    if (positional && volume * attenuation(Math.hypot(x - this.tx, z - this.tz)) < 0.03) return true;
    const now = engine.currentTime;
    const st = this.stat(name);
    if (now - st.last < info.gap || st.count >= info.max) return true;
    if (this.active.length >= synth.MAX_SFX_VOICES && !this.steal(info.prio, now)) return true;
    let v: Voice | null = null;
    for (let i = 0; i < pool.voices.length && !v; i++) {
      const c = pool.voices[(pool.next + i) % pool.voices.length]!;
      if (!c.busy) v = c;
    }
    if (!v) return true;
    pool.next = (pool.voices.indexOf(v) + 1) % pool.voices.length;
    v.busy = true;
    v.counted = true;
    v.start = now;
    v.follow = !positional;
    st.count++;
    st.last = now;
    this.active.push(v);
    const s = v.sound;
    s.volume = volume * info.gain;
    s.playbackRate = 1 + (Math.random() - 0.5) * 0.06;
    this.place(s, positional ? x : this.tx, positional ? z : this.tz);
    s.play();
    if (info.duck) synth.duckMusicFor(info.duck);
    return true;
  }

  /**
   * A unit acknowledges a selection or an order. Returns false while that voice's lines are still
   * being rendered (the caller plays the live synth meanwhile).
   */
  bark(voiceId: string, kind: synth.BarkKind, volume = 0.8): boolean {
    const engine = this.engine;
    if (!engine) return false;
    const lines = this.barks.get(`${voiceId}:${kind}`);
    if (!lines) {
      this.prepareBarks([voiceId]);
      return false;
    }
    if (!synth.canPlayNow()) return true;
    const now = engine.currentTime;
    if (now < this.barkUntil) return true; // one unit talks at a time
    const s = lines[(Math.random() * lines.length) | 0]!;
    s.volume = volume;
    s.play();
    this.barkUntil = now + Math.min(1.2, s.buffer.duration) + 0.15;
    return true;
  }

  /** Render the barks of these voices in the background. */
  prepareBarks(voiceIds: string[]): void {
    const engine = this.engine;
    if (!engine) {
      this.barkQueue.push(...voiceIds);
      return;
    }
    for (const id of voiceIds) {
      if (this.barksRequested.has(id)) continue;
      this.barksRequested.add(id);
      void (async () => {
        for (const kind of ['select', 'move', 'attack'] as const) {
          const sounds: StaticSound[] = [];
          for (let line = 0; line < synth.barkLines(id, kind); line++) {
            const b = await synth.renderBark(id, kind, line);
            if (b) sounds.push(await engine.createSoundAsync(`bark-${id}-${kind}-${line}`, b, { outBus: this.voiceBus }));
          }
          if (sounds.length) this.barks.set(`${id}:${kind}`, sounds);
        }
      })().catch((e: unknown) => console.warn('[audio] bark rendering failed:', e));
    }
  }

  /** Start the ambient bed for a game; its time of day decides between birds and crickets. */
  startAmbience(clock: AmbientClock): void {
    this.clock = clock;
    this.nextAmbience = 0;
    if (this.engine) void this.buildAmbience();
  }

  /** Fade the ambient bed out (back to the title screen). */
  stopAmbience(): void {
    this.clock = null;
    const a = this.ambience;
    if (a) for (const s of [a.wind, a.crickets, a.drone]) s.setVolume(0, { duration: 1 });
  }

  private async buildAmbience(): Promise<void> {
    const engine = this.engine;
    if (!engine || this.ambience || this.ambienceBuilding) return;
    this.ambienceBuilding = true;
    try {
      const [wind, crickets, drone] = await Promise.all(['wind', 'crickets', 'drone'].map((n) => synth.renderAmbient(n)));
      const birdBufs: AudioBuffer[] = [];
      for (let i = 0; i < BIRD_VARIANTS; i++) {
        const b = await synth.renderAmbient('bird', i);
        if (b) birdBufs.push(b);
      }
      if (!wind || !crickets || !drone) return;
      const loop = { loop: true, volume: 0, outBus: this.ambientBus };
      const a: Ambience = {
        wind: await engine.createSoundAsync('wind', wind, loop),
        crickets: await engine.createSoundAsync('crickets', crickets, loop),
        // The citadel hums from its centre and is heard from just outside its moat.
        drone: await engine.createSoundAsync('citadel', drone, {
          ...SPATIAL,
          ...loop,
          spatialMinDistance: Math.hypot(8, LISTENER_HEIGHT),
          spatialMaxDistance: Math.hypot(48, LISTENER_HEIGHT),
        }),
        birds: [],
      };
      for (const [i, b] of birdBufs.entries()) a.birds.push(await engine.createSoundAsync(`bird-${i}`, b, { ...SPATIAL, outBus: this.ambientBus }));
      this.place(a.drone, CENTER, CENTER);
      for (const s of [a.wind, a.crickets, a.drone]) s.play();
      this.ambience = a;
    } catch (e) {
      console.warn('[audio] ambience unavailable:', e);
    } finally {
      this.ambienceBuilding = false;
    }
  }

  /** Per frame: the listener follows the camera; centred sounds stay centred; the ambience follows the clock. */
  update(cam: AudioCamera): void {
    this.tx = cam.target.x;
    this.tz = cam.target.z;
    const engine = this.engine;
    if (!engine) return;
    const L = engine.listener;
    L.position.set(this.tx, LISTENER_HEIGHT, this.tz);
    if (cam.yaw !== this.yaw) {
      this.yaw = cam.yaw;
      listenerRotation(cam.yaw, L.rotationQuaternion);
    }
    L.update();
    for (const v of this.active) if (v.follow) this.place(v.sound, this.tx, this.tz);
    this.updateAmbience(cam, engine.currentTime);
  }

  private updateAmbience(cam: AudioCamera, now: number): void {
    const a = this.ambience;
    if (!a || !this.clock || now < this.nextAmbience) return;
    this.nextAmbience = now + 0.25;
    const h = this.clock.timeOfDay;
    const day = smoothstep(4.5, 7, h) * (1 - smoothstep(17.5, 20, h));
    const height = Math.max(0, Math.min(1, (cam.distance - 12) / 56));
    a.wind.setVolume(0.16 + 0.22 * height + 0.08 * (1 - day), { duration: 0.25 });
    a.crickets.setVolume(0.55 * (1 - day), { duration: 0.25 });
    a.drone.setVolume(0.16, { duration: 0.25 });
    if (now >= this.nextBird) {
      this.nextBird = now + 1.5 + Math.random() * 5;
      const idle = a.birds.filter((s) => s.activeInstancesCount === 0);
      if (idle.length && Math.random() < day) {
        const s = idle[(Math.random() * idle.length) | 0]!;
        const ang = Math.random() * Math.PI * 2;
        const r = 4 + Math.random() * 24;
        this.place(s, this.tx + Math.cos(ang) * r, this.tz + Math.sin(ang) * r);
        s.volume = 0.5 + Math.random() * 0.4;
        s.playbackRate = 0.9 + Math.random() * 0.2;
        s.play();
      }
    }
  }
}
