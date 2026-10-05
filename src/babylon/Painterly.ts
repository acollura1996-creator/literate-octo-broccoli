// Hand-painted surfaces without texture files (D3).
//
// One tileable texture is generated procedurally at load time. Each channel is a painted
// pattern: R stone (blotches and cracks), G wood grain, B cloth and leather (weave and fibre),
// A brush strokes. A material plugin samples it triplanar in object space, so the paint sticks to
// moving units and baked models need no UVs. It mixes the channels per material and modulates
// the albedo around its flat colour.
//
// The materials come from the three.js builders as flat colours, so each is classified by colour:
// exact palette entries first (src/render/models/common.js), then hue, saturation and value.
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Material } from '@babylonjs/core/Materials/material';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Scene } from '@babylonjs/core/scene';

export type PaintKind = 'stone' | 'wood' | 'thatch' | 'metal' | 'gold' | 'cloth' | 'leather' | 'skin' | 'foliage' | 'bone' | 'plain';

/** Channel weights (stone, wood, cloth, strokes), strength and scale (tiles per unit) per kind. */
const KINDS: Record<PaintKind, { w: [number, number, number, number]; strength: number; scale: number }> = {
  stone: { w: [0.65, 0, 0, 0.35], strength: 0.2, scale: 0.55 },
  wood: { w: [0, 0.75, 0, 0.25], strength: 0.2, scale: 0.6 },
  thatch: { w: [0, 0.6, 0.2, 0.2], strength: 0.24, scale: 1.4 },
  metal: { w: [0.15, 0, 0, 0.85], strength: 0.1, scale: 0.7 },
  gold: { w: [0, 0, 0, 1], strength: 0.12, scale: 0.8 },
  cloth: { w: [0, 0, 0.6, 0.4], strength: 0.14, scale: 1.1 },
  leather: { w: [0.2, 0, 0.5, 0.3], strength: 0.16, scale: 0.9 },
  skin: { w: [0, 0, 0, 1], strength: 0.06, scale: 1.2 },
  foliage: { w: [0.3, 0, 0, 0.7], strength: 0.18, scale: 0.8 },
  bone: { w: [0.5, 0, 0, 0.5], strength: 0.12, scale: 0.9 },
  plain: { w: [0, 0, 0, 1], strength: 0.08, scale: 0.8 },
};

/** The model palette (src/render/models/common.js `P`) by kind. */
const PALETTE: Record<number, PaintKind> = {
  0xb4bcc6: 'metal', 0x6c7480: 'metal', 0xe2e8ef: 'metal', 0x858d98: 'metal', 0x3c4048: 'metal',
  0xf2c43c: 'gold', 0xb98a1e: 'gold', 0xb87333: 'gold',
  0xf2c49b: 'skin', 0xd9a27c: 'skin',
  0x7b4a25: 'leather', 0x4e2e15: 'leather', 0x8f6a42: 'cloth', 0xeadcbc: 'cloth',
  0x8a5a2e: 'wood', 0x5a3a1c: 'wood', 0xb5844b: 'wood',
  0xa8a59c: 'stone', 0x7a776f: 'stone', 0xcdc9bd: 'stone', 0xeeeae2: 'stone', 0x56637e: 'stone', 0xf1e4c4: 'stone',
  0xdcb25c: 'thatch', 0xb48a3a: 'thatch',
  0xf6f5f0: 'plain', 0x1c1c20: 'plain',
  0xe8e0c6: 'bone', 0xb9ae90: 'bone', 0x9a5a35: 'metal',
  0x5f9e35: 'foliage', 0x3f8a2c: 'foliage', 0x6cb33e: 'foliage',
  0xb0101e: 'cloth', 0x6a0812: 'cloth',
  0x26272d: 'metal', 0x3a3c45: 'metal', 0x3d3b42: 'stone', 0x55525a: 'stone',
};

/** Classify a flat sRGB material colour (0-1 channels). */
export function classifyColor(r: number, g: number, b: number): PaintKind {
  const hex = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
  const known = PALETTE[hex];
  if (known) return known;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const s = max > 0 ? (max - min) / max : 0;
  let h = 0;
  if (max !== min) {
    if (max === r) h = ((g - b) / (max - min)) * 60;
    else if (max === g) h = (2 + (b - r) / (max - min)) * 60;
    else h = (4 + (r - g) / (max - min)) * 60;
    if (h < 0) h += 360;
  }
  if (s < 0.14) return max < 0.3 ? 'metal' : 'stone';
  if (h >= 70 && h <= 170) return 'foliage';
  if (h >= 190 && h <= 260 && s < 0.4) return 'metal';
  if (h >= 38 && h <= 62 && s > 0.55 && max > 0.7) return 'gold';
  if (h >= 12 && h <= 45 && s >= 0.18 && s <= 0.45 && max > 0.78) return 'skin';
  if (h >= 15 && h <= 48 && s > 0.3 && max < 0.75) return 'wood';
  if (h >= 30 && h <= 55 && s > 0.3) return 'thatch';
  return 'cloth';
}

// ---------------------------------------------------------------------------------- texture
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

/** Periodic value noise on a px × py lattice, sampled at u, v in [0, 1). */
class Lattice {
  private readonly g: Float32Array;
  constructor(
    private readonly px: number,
    private readonly py: number,
    rand: () => number,
  ) {
    this.g = new Float32Array(px * py);
    for (let i = 0; i < this.g.length; i++) this.g[i] = rand();
  }

  at(u: number, v: number): number {
    const x = u * this.px;
    const y = v * this.py;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const px = this.px;
    const py = this.py;
    const i = (a: number, b: number): number => this.g[(((b % py) + py) % py) * px + (((a % px) + px) % px)]!;
    const top = i(x0, y0) + (i(x0 + 1, y0) - i(x0, y0)) * sx;
    const bot = i(x0, y0 + 1) + (i(x0 + 1, y0 + 1) - i(x0, y0 + 1)) * sx;
    return top + (bot - top) * sy;
  }
}

function fbm(layers: Lattice[], u: number, v: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (const l of layers) {
    sum += l.at(u, v) * amp;
    norm += amp;
    amp *= 0.55;
  }
  return sum / norm;
}

/** Normalize a channel to mean 0.5 with a given spread, clamped to 0-1. */
function normalize(ch: Float32Array, spread: number): void {
  let mean = 0;
  for (const x of ch) mean += x;
  mean /= ch.length;
  let dev = 0;
  for (const x of ch) dev += (x - mean) * (x - mean);
  dev = Math.sqrt(dev / ch.length) || 1;
  for (let i = 0; i < ch.length; i++) ch[i] = Math.max(0, Math.min(1, 0.5 + ((ch[i]! - mean) / dev) * spread));
}

/** The four painted patterns, N × N, tileable. */
export function paintPixels(N = 256): Uint8Array {
  const rand = mulberry32(0x5eed);
  const L = (px: number, py = px): Lattice => new Lattice(px, py, rand);
  const stoneN = [L(4), L(8), L(16), L(32)];
  const woodN = [L(3, 24), L(6, 48), L(12, 96)];
  const woodWarp = [L(4), L(8)];
  const clothN = [L(32), L(64)];
  const strokeN = [L(8), L(16)];
  // Worley feature points (one per cell, 7 × 7 cells) for stone cracks.
  const C = 7;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < C * C; i++) pts.push([rand(), rand()]);

  const R = new Float32Array(N * N);
  const G = new Float32Array(N * N);
  const B = new Float32Array(N * N);
  const A = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const i = y * N + x;
      // Stone: blotches, darker cracks along the Worley cell borders.
      const cx = u * C;
      const cy = v * C;
      let f1 = 9;
      let f2 = 9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = Math.floor(cx) + ox;
          const gy = Math.floor(cy) + oy;
          const p = pts[(((gy % C) + C) % C) * C + (((gx % C) + C) % C)]!;
          const d = Math.hypot(gx + p[0] - cx, gy + p[1] - cy);
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) f2 = d;
        }
      }
      const crack = 1 - Math.min(1, (f2 - f1) / 0.09);
      R[i] = fbm(stoneN, u, v) - 0.45 * crack * crack + 0.15 * f1;
      // Wood: long grain lines warped by low-frequency noise.
      const warp = fbm(woodWarp, u, v);
      G[i] = 0.55 * Math.sin((u * 9 + warp * 2.2) * Math.PI * 2) * 0.5 + fbm(woodN, u, v);
      // Cloth / leather: weave plus fibre noise.
      B[i] = 0.35 * Math.sin(u * Math.PI * 2 * 48) * Math.sin(v * Math.PI * 2 * 48) + fbm(clothN, u, v);
      A[i] = fbm(strokeN, u, v);
    }
  }
  // Brush strokes: short dabs of lighter and darker paint, wrapped so the tile repeats.
  for (let k = 0; k < 900; k++) {
    const sx = rand() * N;
    const sy = rand() * N;
    const ang = rand() * Math.PI;
    const len = 6 + rand() * 18;
    const wid = 1.5 + rand() * 2.5;
    const val = (rand() - 0.5) * 0.9;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const ext = Math.ceil(len / 2 + wid);
    for (let dy = -ext; dy <= ext; dy++) {
      for (let dx = -ext; dx <= ext; dx++) {
        const along = dx * ca + dy * sa;
        const across = -dx * sa + dy * ca;
        const t = 1 - Math.max(Math.abs(along) / (len / 2), Math.abs(across) / wid);
        if (t <= 0) continue;
        const px = (((Math.round(sx + dx) % N) + N) % N);
        const py = (((Math.round(sy + dy) % N) + N) % N);
        const j = py * N + px;
        A[j] = A[j]! + val * Math.min(1, t * 2.5) * 0.35;
      }
    }
  }
  normalize(R, 0.2);
  normalize(G, 0.2);
  normalize(B, 0.18);
  normalize(A, 0.2);
  const out = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    out[i * 4] = Math.round(R[i]! * 255);
    out[i * 4 + 1] = Math.round(G[i]! * 255);
    out[i * 4 + 2] = Math.round(B[i]! * 255);
    out[i * 4 + 3] = Math.round(A[i]! * 255);
  }
  return out;
}

let pixels: Uint8Array | null = null;
const textures = new WeakMap<Scene, RawTexture>();

/** The paint texture of a scene (generated once, shared by every scene). */
function paintTexture(scene: Scene): RawTexture {
  let t = textures.get(scene);
  if (!t) {
    pixels ??= paintPixels();
    const N = Math.round(Math.sqrt(pixels.length / 4));
    t = new RawTexture(pixels, N, N, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 4;
    textures.set(scene, t);
  }
  return t;
}

// ---------------------------------------------------------------------------------- plugin
export class PainterlyPlugin extends MaterialPluginBase {
  /** Global switch (the quality presets turn the paint off on Low, the original look). */
  static enabled = true;
  private readonly texture: RawTexture;
  private readonly spec: (typeof KINDS)[PaintKind];

  constructor(
    material: Material,
    readonly kind: PaintKind,
  ) {
    // After the team colour (150), which sets the base colour this modulates.
    super(material, 'Painterly', 160, { PAINTERLY: false }, true, true);
    this.texture = paintTexture(material.getScene());
    this.spec = KINDS[kind];
  }

  override getClassName(): string {
    return 'PainterlyPlugin';
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['PAINTERLY'] = PainterlyPlugin.enabled;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('paintSampler');
  }

  override getUniforms() {
    return {
      ubo: [
        { name: 'paintWeights', size: 4, type: 'vec4' },
        { name: 'paintParams', size: 2, type: 'vec2' },
      ],
      fragment: `#ifdef PAINTERLY
        uniform vec4 paintWeights;
        uniform vec2 paintParams;
      #endif`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    if (!PainterlyPlugin.enabled) return;
    const w = this.spec.w;
    uniformBuffer.updateFloat4('paintWeights', w[0], w[1], w[2], w[3]);
    uniformBuffer.updateFloat2('paintParams', this.spec.strength, this.spec.scale);
    uniformBuffer.setTexture('paintSampler', this.texture);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef PAINTERLY
          varying vec3 vPaintPos;
        #endif`,
        CUSTOM_VERTEX_MAIN_END: `#ifdef PAINTERLY
          vPaintPos = positionUpdated;
        #endif`,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef PAINTERLY
        uniform sampler2D paintSampler;
        varying vec3 vPaintPos;
      #endif`,
      // Triplanar in object space; the face normal comes from screen-space derivatives (the baked
      // models are flat shaded). The pattern scales the albedo around its flat colour.
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef PAINTERLY
        {
          vec3 pp = vPaintPos * paintParams.y;
          vec3 pn = abs(normalize(cross(dFdx(vPaintPos), dFdy(vPaintPos))));
          vec3 tw = pn * pn * pn * pn;
          tw /= max(1e-4, tw.x + tw.y + tw.z);
          vec4 ps = texture2D(paintSampler, pp.zy) * tw.x + texture2D(paintSampler, pp.xz) * tw.y + texture2D(paintSampler, pp.xy) * tw.z;
          float pat = dot(ps, paintWeights);
          baseColor.rgb *= 1.0 + paintParams.x * (pat - 0.5) * 2.0;
        }
      #endif`,
    };
  }
}

/** Give a material the painted look for its colour (sRGB) or an explicit kind. */
export function paint(material: Material, kind: PaintKind): PainterlyPlugin {
  return new PainterlyPlugin(material, kind);
}
