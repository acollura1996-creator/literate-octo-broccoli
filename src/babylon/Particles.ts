// GPU particles for the Reforged look (M8): fire, smoke, sparks, sparkles, snow and the nuke, on
// top of the mesh effects (Effects.ts), plus fire and smoke on badly damaged buildings as in
// Warcraft III. Particle systems are pooled per kind and reused; the quality preset scales how
// many particles are spawned. GPUParticleSystem where supported, otherwise the CPU ParticleSystem.
// Sprites are drawn procedurally (no texture files).
import { GPUParticleSystem } from '@babylonjs/core/Particles/gpuParticleSystem';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
// Side effects: the WebGL2 GPU particle backend and the scene component that renders particles.
import '@babylonjs/core/Particles/webgl2ParticleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { BoxParticleEmitter } from '@babylonjs/core/Particles/EmitterTypes/boxParticleEmitter';

type Sprite = 'soft' | 'smoke' | 'spark';
type System = GPUParticleSystem | ParticleSystem;

interface Spec {
  sprite: Sprite;
  additive: boolean;
  life: [number, number];
  size: [number, number];
  power: [number, number];
  /** Vertical acceleration (negative falls). */
  gravity: number;
  color1: Color4;
  color2: Color4;
  dead: Color4;
  /** Size over life: [age 0-1, factor]. */
  grow?: Array<[number, number]>;
  /** Emitter: sphere (radius, upward bias) or box (half extents). */
  sphere?: number;
  box?: [number, number, number];
  /** Initial direction spread: up-only (0) to all round (1). */
  spread?: number;
}

const C = (r: number, g: number, b: number, a: number): Color4 => new Color4(r, g, b, a);

const SPECS: Record<string, Spec> = {
  fire: { sprite: 'soft', additive: true, life: [0.3, 0.75], size: [0.5, 1.2], power: [1.2, 3.5], gravity: 1.5, color1: C(1, 0.75, 0.3, 1), color2: C(1, 0.4, 0.1, 1), dead: C(0.3, 0.05, 0, 0), grow: [[0, 0.6], [0.3, 1.1], [1, 0.4]], sphere: 0.35, spread: 1 },
  smoke: { sprite: 'smoke', additive: false, life: [1.4, 2.8], size: [0.9, 1.8], power: [0.4, 1.3], gravity: 0.7, color1: C(0.22, 0.2, 0.19, 0.55), color2: C(0.35, 0.33, 0.31, 0.45), dead: C(0.45, 0.43, 0.42, 0), grow: [[0, 0.5], [1, 1.9]], sphere: 0.4, spread: 0.6 },
  sparks: { sprite: 'spark', additive: true, life: [0.35, 0.85], size: [0.07, 0.15], power: [4, 9], gravity: -9, color1: C(1, 0.9, 0.5, 1), color2: C(1, 0.6, 0.2, 1), dead: C(0.6, 0.2, 0, 0), sphere: 0.2, spread: 0.8 },
  sparkle: { sprite: 'spark', additive: true, life: [0.8, 1.6], size: [0.1, 0.24], power: [0.4, 1.4], gravity: 2.4, color1: C(1, 0.95, 0.6, 1), color2: C(1, 0.85, 0.3, 1), dead: C(1, 0.7, 0.2, 0), box: [0.8, 0.1, 0.8], spread: 0.3 },
  snow: { sprite: 'soft', additive: true, life: [0.75, 1.0], size: [0.1, 0.22], power: [0, 0.3], gravity: -16, color1: C(0.85, 0.95, 1, 0.9), color2: C(0.6, 0.8, 1, 0.8), dead: C(0.5, 0.7, 1, 0), box: [1, 1.2, 1], spread: 1 },
  nukeFire: { sprite: 'soft', additive: true, life: [0.8, 1.8], size: [2.5, 5.5], power: [3, 9], gravity: 3, color1: C(1, 0.85, 0.5, 1), color2: C(1, 0.45, 0.15, 1), dead: C(0.25, 0.05, 0, 0), grow: [[0, 0.5], [0.4, 1.2], [1, 0.6]], sphere: 1.5, spread: 1 },
  nukeSmoke: { sprite: 'smoke', additive: false, life: [3, 6], size: [3, 6], power: [3, 7], gravity: 0.6, color1: C(0.3, 0.26, 0.24, 0.65), color2: C(0.45, 0.4, 0.36, 0.55), dead: C(0.5, 0.47, 0.45, 0), grow: [[0, 0.6], [1, 2.2]], sphere: 1.2, spread: 0.25 },
  burnFire: { sprite: 'soft', additive: true, life: [0.4, 0.9], size: [0.55, 1.15], power: [0.8, 1.8], gravity: 2.2, color1: C(1, 0.7, 0.25, 1), color2: C(1, 0.4, 0.1, 1), dead: C(0.25, 0.05, 0, 0), grow: [[0, 0.7], [0.5, 1], [1, 0.3]], box: [0.6, 0.1, 0.6], spread: 0.35 },
  burnSmoke: { sprite: 'smoke', additive: false, life: [2, 4], size: [0.9, 1.8], power: [0.8, 1.8], gravity: 0.5, color1: C(0.15, 0.14, 0.13, 0.5), color2: C(0.28, 0.27, 0.26, 0.4), dead: C(0.4, 0.4, 0.4, 0), grow: [[0, 0.5], [1, 2.2]], box: [0.5, 0.1, 0.5], spread: 0.25 },
  trail: { sprite: 'soft', additive: true, life: [0.2, 0.45], size: [0.5, 0.9], power: [0.1, 0.5], gravity: 0.5, color1: C(1, 0.7, 0.3, 1), color2: C(1, 0.4, 0.1, 1), dead: C(0.2, 0.05, 0, 0), grow: [[0, 1], [1, 0.3]], sphere: 0.25, spread: 1 },
};

/** Soft round glow, smoke puff and spark sprites, drawn once per scene. */
function makeSprites(scene: Scene): Record<Sprite, Texture> {
  const make = (name: string, draw: (ctx: CanvasRenderingContext2D, n: number) => void): Texture => {
    const n = 64;
    const t = new DynamicTexture(`fx-${name}`, { width: n, height: n }, scene, true);
    const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, n, n);
    draw(ctx, n);
    t.hasAlpha = true;
    t.update(false);
    return t;
  };
  const radial = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stops: Array<[number, string]>): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (const [o, c] of stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return {
    soft: make('soft', (ctx, n) => radial(ctx, n / 2, n / 2, n / 2, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']])),
    smoke: make('smoke', (ctx, n) => {
      for (let i = 0; i < 9; i++) {
        const a = rnd() * Math.PI * 2;
        const d = rnd() * n * 0.18;
        radial(ctx, n / 2 + Math.cos(a) * d, n / 2 + Math.sin(a) * d, n * (0.22 + rnd() * 0.16), [[0, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
      }
    }),
    spark: make('spark', (ctx, n) => radial(ctx, n / 2, n / 2, n / 2, [[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,0.9)'], [0.4, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']])),
  };
}

interface Pooled {
  ps: System;
  busyUntil: number;
}

interface Burning {
  fire: System;
  smoke: System;
  pos: Vector3;
}

export interface BurningSite {
  id: number;
  x: number;
  y: number;
  z: number;
  /** 0 (fine) - 1 (about to fall). */
  damage: number;
  /** Footprint half-width. */
  size: number;
}

const MAX_POOL = 6;
const MAX_BURNING = 24;

export class ParticleFx {
  private readonly sprites: Record<Sprite, Texture>;
  private readonly gpu: boolean;
  private readonly pools = new Map<string, Pooled[]>();
  private readonly burning = new Map<number, Burning>();
  private time = 0;

  constructor(
    private readonly scene: Scene,
    /** Share of particles to spawn (quality preset); 0 disables particles. */
    private readonly density: () => number,
  ) {
    this.sprites = makeSprites(scene);
    this.gpu = GPUParticleSystem.IsSupported;
  }

  private create(kind: string, capacity: number): System {
    const s = SPECS[kind]!;
    const ps: System = this.gpu ? new GPUParticleSystem(kind, { capacity }, this.scene) : new ParticleSystem(kind, capacity, this.scene);
    ps.particleTexture = this.sprites[s.sprite];
    ps.blendMode = s.additive ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
    ps.minLifeTime = s.life[0];
    ps.maxLifeTime = s.life[1];
    ps.minSize = s.size[0];
    ps.maxSize = s.size[1];
    ps.minEmitPower = s.power[0];
    ps.maxEmitPower = s.power[1];
    ps.gravity = new Vector3(0, s.gravity, 0);
    ps.color1 = s.color1;
    ps.color2 = s.color2;
    ps.colorDead = s.dead;
    if (s.grow) for (const [t, f] of s.grow) ps.addSizeGradient(t, f);
    const spread = s.spread ?? 1;
    if (s.box) {
      const [bx, by, bz] = s.box;
      ps.createBoxEmitter(new Vector3(-spread, 1, -spread), new Vector3(spread, 1, spread), new Vector3(-bx, -by, -bz), new Vector3(bx, by, bz));
    } else {
      ps.createSphereEmitter(s.sphere ?? 0.3, spread);
    }
    ps.minAngularSpeed = -1.5;
    ps.maxAngularSpeed = 1.5;
    ps.minInitialRotation = 0;
    ps.maxInitialRotation = Math.PI * 2;
    ps.isLocal = false;
    ps.renderingGroupId = 0;
    return ps;
  }

  /** Box emitters cover `extent` × their base size (area spells). */
  private setExtent(ps: System, kind: string, extent: number): void {
    const box = SPECS[kind]!.box;
    if (!box) return;
    const e = ps.particleEmitterType as BoxParticleEmitter;
    e.minEmitBox.set(-box[0] * extent, -box[1], -box[2] * extent);
    e.maxEmitBox.set(box[0] * extent, box[1], box[2] * extent);
  }

  /** A burst of about `count` particles of `kind` at (x, y, z), sizes × `scale`. */
  burst(kind: string, x: number, y: number, z: number, count: number, scale = 1, color?: Color4, extent = 1): void {
    const d = this.density();
    const n = Math.round(count * d);
    if (n < 1) return;
    const spec = SPECS[kind]!;
    let pool = this.pools.get(kind);
    if (!pool) this.pools.set(kind, (pool = []));
    let slot = pool.find((p) => p.busyUntil <= this.time);
    if (!slot) {
      if (pool.length >= MAX_POOL) return;
      slot = { ps: this.create(kind, Math.max(64, Math.round(count * 1.5))), busyUntil: 0 };
      pool.push(slot);
    }
    const ps = slot.ps;
    ps.stop();
    ps.reset();
    ps.emitter = new Vector3(x, y, z);
    this.setExtent(ps, kind, extent);
    ps.minSize = spec.size[0] * scale;
    ps.maxSize = spec.size[1] * scale;
    ps.minEmitPower = spec.power[0] * Math.sqrt(scale);
    ps.maxEmitPower = spec.power[1] * Math.sqrt(scale);
    if (color) {
      ps.color1 = color;
      ps.color2 = new Color4(color.r * 0.85, color.g * 0.85, color.b * 0.85, color.a);
    } else {
      ps.color1 = spec.color1;
      ps.color2 = spec.color2;
    }
    ps.emitRate = 0;
    ps.manualEmitCount = Math.min(n, Math.round(count * 1.5));
    ps.targetStopDuration = 0;
    ps.start();
    slot.busyUntil = this.time + spec.life[1] + 0.2;
  }

  /** A continuous stream for `duration` seconds at `rate` particles/s from a moving point. */
  stream(kind: string, at: Vector3, rate: number, duration: number, scale = 1, extent = 1): void {
    const d = this.density();
    if (d <= 0) return;
    const spec = SPECS[kind]!;
    let pool = this.pools.get(`${kind}:stream`);
    if (!pool) this.pools.set(`${kind}:stream`, (pool = []));
    let slot = pool.find((p) => p.busyUntil <= this.time);
    if (!slot) {
      if (pool.length >= MAX_POOL) return;
      slot = { ps: this.create(kind, Math.max(64, Math.round(rate * spec.life[1] * 1.4))), busyUntil: 0 };
      pool.push(slot);
    }
    const ps = slot.ps;
    ps.stop();
    ps.reset();
    ps.emitter = at;
    this.setExtent(ps, kind, extent);
    ps.minSize = spec.size[0] * scale;
    ps.maxSize = spec.size[1] * scale;
    ps.emitRate = rate * d;
    ps.manualEmitCount = -1;
    ps.targetStopDuration = duration;
    ps.start();
    slot.busyUntil = this.time + duration + spec.life[1] + 0.2;
  }

  /** Fire and smoke on badly damaged buildings (the list of what should burn now). */
  syncBurning(sites: BurningSite[]): void {
    const d = this.density();
    const want = new Map<number, BurningSite>();
    if (d > 0) for (const s of sites.slice(0, MAX_BURNING)) want.set(s.id, s);
    for (const [id, b] of this.burning) {
      if (!want.has(id)) {
        b.fire.dispose();
        b.smoke.dispose();
        this.burning.delete(id);
      }
    }
    for (const s of want.values()) {
      let b = this.burning.get(s.id);
      if (!b) {
        const pos = new Vector3(s.x, s.y, s.z);
        b = { fire: this.create('burnFire', 160), smoke: this.create('burnSmoke', 120), pos };
        b.fire.emitter = pos;
        b.smoke.emitter = pos;
        // Flames spread over the roof, bigger on bigger buildings.
        this.setExtent(b.fire, 'burnFire', Math.max(0.6, s.size * 0.55));
        this.setExtent(b.smoke, 'burnSmoke', Math.max(0.6, s.size * 0.45));
        for (const ps of [b.fire, b.smoke]) {
          ps.minSize *= Math.max(0.9, s.size * 0.55);
          ps.maxSize *= Math.max(0.9, s.size * 0.55);
          ps.start();
        }
        this.burning.set(s.id, b);
      }
      b.pos.set(s.x, s.y, s.z);
      // Heavier damage, bigger fire.
      b.fire.emitRate = (15 + 70 * s.damage) * d;
      b.smoke.emitRate = (5 + 18 * s.damage) * d;
    }
  }

  update(dt: number): void {
    this.time += dt;
  }

  clear(): void {
    for (const pool of this.pools.values()) for (const p of pool) p.ps.dispose();
    this.pools.clear();
    for (const b of this.burning.values()) {
      b.fire.dispose();
      b.smoke.dispose();
    }
    this.burning.clear();
  }
}
