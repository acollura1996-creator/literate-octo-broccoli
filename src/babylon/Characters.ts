// Rigged, animated characters (M14): Kay Lousberg's KayKit Adventurers and Skeletons (CC0),
// imported by tools/kaykit/import.mjs into src/assets/kaykit/kaykit.bin.
//
// Every character is drawn by one shared material and animated on the GPU:
//
// - A vertex animation texture holds, for every frame of every animation of the three rigs, each
//   joint's skinning matrix as three rows of an affine matrix (half floats). Frames are stacked in
//   blocks of VAT_BLOCK rows side by side, so the texture stays within every GPU's size limit.
// - Each unit is an instance of its unit type's mesh (a body plus props merged into one mesh), with
//   two per-instance attributes: the team colour (`kkTeam`) and `kkFrame`:
//   x the frame of the current animation (fractional: the shader blends the two nearest frames),
//   y the frame of the animation it is fading out of, z the weight of that one. So every unit of a
//   type, in any pose and any team, shares one draw call.
// - Atlases: the packs' palette textures (8 × 4 colour swatches with a light-to-dark gradient) in
//   one texture array; a vertex's layer and its team mask (swatches that take the team colour) are
//   vertex attributes.
// - Shadows: the material's own vertex shader (with the skinning) renders the shadow maps, through
//   a ShadowDepthWrapper, so shadows move with the animation.
//
// Units ask CharacterAnimator (below) which frames to show; it plays clips by name, loops or holds
// them, matches walks to the movement speed and crossfades between clips.
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShadowDepthWrapper } from '@babylonjs/core/Materials/shadowDepthWrapper';
import { Material } from '@babylonjs/core/Materials/material';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { RawTexture2DArray } from '@babylonjs/core/Materials/Textures/rawTexture2DArray';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Meshes/instancedMesh';
import binUrl from '../assets/kaykit/kaykit.bin?url';
import { MergedModelPlugin } from './MergedModel';
import { BUILDING_RECIPES, CHARACTER_RECIPES, TEAM_CELLS, type CharacterRecipe } from './CharacterRecipes';
import { PROCEDURAL_PROPS } from './CharacterProps';
import type { GhostMode, ModelInstance } from './ModelLibrary';

const TEXTURE_URLS = import.meta.glob('../assets/kaykit/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** Rows of the animation texture per block (blocks sit side by side). */
const VAT_BLOCK = 2048;
/** Atlas size in the texture array (the packs ship 1024²; their swatches survive 512² fine). */
const ATLAS_SIZE = 512;
/** Seconds to crossfade from one clip to the next. */
const FADE = 0.16;

// ------------------------------------------------------------------ file format (tools/kaykit/import.mjs)
interface ClipInfo {
  start: number;
  frames: number;
  duration: number;
  groundSpeed?: number;
  impact?: number;
}
interface RigInfo {
  joints: string[];
  bindWorld: number[][];
  vat: { offset: number; width: number; height: number };
  anims: Record<string, ClipInfo>;
}
interface PieceInfo {
  name: string;
  rig: string;
  texture: string;
  kind: 'body' | 'prop' | 'static';
  joint?: string;
  vertices: number;
  indices: number;
  bounds: { minY: number; maxY: number; radius: number };
  position: number;
  normal: number;
  uv: number;
  joints: number;
  weights: number;
  index: number;
  index32: boolean;
}
interface FileInfo {
  version: number;
  fps: number;
  rigs: Record<string, RigInfo>;
  pieces: PieceInfo[];
  textures: string[];
}

/** A clip as the animator plays it: its first row in the texture and its length. */
export interface Clip {
  name: string;
  row: number;
  frames: number;
  duration: number;
  groundSpeed: number;
  impact: number;
}

// ------------------------------------------------------------------ material plugin
export class CharacterPlugin extends MaterialPluginBase {
  /** Nearest frame only, no crossfade (the Low preset; the quality presets toggle it). */
  static fast = false;
  /** Linear tint and amount (illusions are blended toward blue), team colour for non-instanced draws. */
  tint: [number, number, number, number] = [0, 0, 0, 0];
  fallback: [number, number, number] = [0.58, 0.59, 0.59];

  constructor(
    material: Material,
    private readonly vat: RawTexture,
    private readonly atlas: RawTexture2DArray,
    private readonly vatWidth: number,
    /** Buildings: no skinning. */
    private readonly isStatic = false,
  ) {
    super(material, 'Character', 140, { KAYKIT: false, KAYKITFAST: false, KKSTATIC: false }, true, true);
  }

  override getClassName(): string {
    return 'CharacterPlugin';
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['KAYKIT'] = true;
    defines['KAYKITFAST'] = CharacterPlugin.fast;
    defines['KKSTATIC'] = this.isStatic;
  }

  override getAttributes(attributes: string[]): void {
    attributes.push('kkJ', 'kkW', 'kkUV', 'kkMeta', 'kkFrame', 'kkTeam');
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('kkVat', 'kkAtlas');
  }

  override getUniforms() {
    return {
      ubo: [
        { name: 'kkVatInfo', size: 2, type: 'vec2' },
        { name: 'kkTint', size: 4, type: 'vec4' },
        { name: 'kkFallback', size: 3, type: 'vec3' },
        { name: 'kkRim', size: 3, type: 'vec3' },
      ],
      vertex: `#ifdef KAYKIT
        uniform vec2 kkVatInfo;
      #endif`,
      fragment: `#ifdef KAYKIT
        uniform vec4 kkTint;
        uniform vec3 kkFallback;
        uniform vec3 kkRim;
      #endif`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat2('kkVatInfo', VAT_BLOCK, this.vatWidth);
    uniformBuffer.updateFloat4('kkTint', this.tint[0], this.tint[1], this.tint[2], this.tint[3]);
    uniformBuffer.updateFloat3('kkFallback', this.fallback[0], this.fallback[1], this.fallback[2]);
    const r = MergedModelPlugin.rim;
    uniformBuffer.updateFloat3('kkRim', r[0], r[1], r[2]);
    uniformBuffer.setTexture('kkVat', this.vat);
    uniformBuffer.setTexture('kkAtlas', this.atlas);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef KAYKIT
          attribute vec4 kkJ;
          attribute vec4 kkW;
          attribute vec2 kkUV;
          attribute vec3 kkMeta;
          attribute vec4 kkFrame;
          attribute vec4 kkTeam;
          uniform highp sampler2D kkVat;
          varying vec2 vKkUV;
          varying vec3 vKkMeta;
          varying vec3 vKkTeam;

          // Add weight × the skinning matrix of joint j at an integer frame to the three rows.
          void kkAdd(int frame, int j, float weight, inout vec4 s0, inout vec4 s1, inout vec4 s2) {
            int block = frame / int(kkVatInfo.x);
            int y = frame - block * int(kkVatInfo.x);
            int x = block * int(kkVatInfo.y) + j * 3;
            s0 += texelFetch(kkVat, ivec2(x, y), 0) * weight;
            s1 += texelFetch(kkVat, ivec2(x + 1, y), 0) * weight;
            s2 += texelFetch(kkVat, ivec2(x + 2, y), 0) * weight;
          }
          // The vertex's blended skinning matrix at a fractional frame, scaled by weight.
          void kkSkin(float frame, float weight, inout vec4 s0, inout vec4 s1, inout vec4 s2) {
            float f0 = floor(frame);
            float t = frame - f0;
            int a = int(f0);
            for (int k = 0; k < 4; k++) {
              float w = kkW[k] * weight;
              if (w <= 0.0) continue;
              int j = int(kkJ[k] + 0.5);
              kkAdd(a, j, w * (1.0 - t), s0, s1, s2);
              if (t > 0.001) kkAdd(a + 1, j, w * t, s0, s1, s2);
            }
          }
        #endif`,
        CUSTOM_VERTEX_UPDATE_POSITION: `#ifdef KAYKIT
        #ifndef KKSTATIC
          vec4 kkS0 = vec4(0.0);
          vec4 kkS1 = vec4(0.0);
          vec4 kkS2 = vec4(0.0);
        #if defined(SM_ESM) || defined(KAYKITFAST)
          // Shadow maps (their passes define SM_*) and the Low preset: the nearest frame is plenty.
          kkSkin(floor(kkFrame.x + 0.5), 1.0, kkS0, kkS1, kkS2);
        #else
          kkSkin(kkFrame.x, 1.0 - kkFrame.z, kkS0, kkS1, kkS2);
          if (kkFrame.z > 0.001) kkSkin(kkFrame.y, kkFrame.z, kkS0, kkS1, kkS2);
        #endif
          {
            vec4 p = vec4(positionUpdated, 1.0);
            positionUpdated = vec3(dot(kkS0, p), dot(kkS1, p), dot(kkS2, p));
          }
        #endif
          vKkUV = kkUV;
          vKkMeta = kkMeta;
          vKkTeam = kkTeam.a > 0.0 ? kkTeam.rgb : vec3(-1.0);
        #endif`,
        CUSTOM_VERTEX_UPDATE_NORMAL: `#if defined(KAYKIT) && defined(NORMAL) && !defined(KKSTATIC)
          normalUpdated = vec3(dot(kkS0.xyz, normalUpdated), dot(kkS1.xyz, normalUpdated), dot(kkS2.xyz, normalUpdated));
        #endif`,
      };
    }
    if (shaderType === 'fragment') {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef KAYKIT
          uniform highp sampler2DArray kkAtlas;
          varying vec2 vKkUV;
          varying vec3 vKkMeta;
          varying vec3 vKkTeam;
        #endif`,
        CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef KAYKIT
          {
            vec3 tex = texture(kkAtlas, vec3(vKkUV, vKkMeta.y)).rgb;
            // The instance's team colour (non-instanced draws have none: the fallback).
            vec3 team = vKkTeam.r < 0.0 ? kkFallback : vKkTeam;
            // Team swatches: the team colour shaded by the swatch's own light-to-dark gradient.
            float l = dot(tex, vec3(0.299, 0.587, 0.114));
            vec3 teamShade = team * clamp(0.35 + l * 1.45, 0.0, 1.35);
            vec3 c = mix(tex, teamShade, vKkMeta.x);
            // A little more saturation than the packs' pastel palette, toward Warcraft III's.
            float g = dot(c, vec3(0.299, 0.587, 0.114));
            c = clamp(mix(vec3(g), c, 1.18), 0.0, 1.0);
            c = mix(c, pow(kkTint.rgb, vec3(1.0 / 2.2)), kkTint.a);
            baseColor.rgb = c;
          }
        #endif`,
        CUSTOM_FRAGMENT_BEFORE_FOG: `#ifdef KAYKIT
          {
            // A rim light in the sky's colour picks out silhouettes (as on the baked models).
            float rimK = pow(1.0 - max(dot(normalW, viewDirectionW), 0.0), 3.0);
            color.rgb += kkRim * rimK * (0.6 + 0.4 * baseColor.rgb);
            // Glowing parts (sci-fi weapons) shine on their own.
            color.rgb += baseColor.rgb * vKkMeta.z * 1.1;
          }
        #endif`,
      };
    }
    return null;
  }
}

// ------------------------------------------------------------------ animator
/** Plays clips by name on one unit: looping or held, at a rate, crossfading between them. */
export class CharacterAnimator {
  private clip: Clip;
  private time = 0;
  private rate = 1;
  private loop = true;
  private prev: Clip | null = null;
  private prevTime = 0;
  private prevRate = 1;
  private prevLoop = true;
  private fade = 0;

  constructor(
    private readonly library: CharacterLibrary,
    readonly rig: string,
    first: string,
  ) {
    this.clip = library.clip(rig, first)!;
  }

  get current(): string {
    return this.clip.name;
  }

  /** Seconds into the current clip (at its own pace). */
  get elapsed(): number {
    return this.time;
  }

  /** True once a held (non-looping) clip has reached its last frame. */
  get finished(): boolean {
    return !this.loop && this.time * this.rate >= this.clip.duration - 1e-3;
  }

  has(name: string): boolean {
    return !!this.library.clip(this.rig, name);
  }

  clipInfo(name: string): Clip | null {
    return this.library.clip(this.rig, name);
  }

  /**
   * Play a clip. Re-playing the current clip only changes its rate and looping, unless `restart`.
   * `fade` 0 cuts instead of crossfading.
   */
  play(name: string, opts: { loop?: boolean; rate?: number; restart?: boolean; fade?: number; at?: number } = {}): void {
    const c = this.library.clip(this.rig, name);
    if (!c) return;
    const loop = opts.loop ?? true;
    const rate = opts.rate ?? 1;
    if (c === this.clip && !opts.restart) {
      this.rate = rate;
      this.loop = loop;
      return;
    }
    const fade = opts.fade ?? FADE;
    if (fade > 0) {
      this.prev = this.clip;
      this.prevTime = this.time;
      this.prevRate = this.rate;
      this.prevLoop = this.loop;
      this.fade = fade;
      this.fadeLength = fade;
    } else {
      this.prev = null;
      this.fade = 0;
    }
    this.clip = c;
    this.time = opts.at ?? 0;
    this.rate = rate;
    this.loop = loop;
  }

  private fadeLength = FADE;

  update(dt: number): void {
    dt = Math.max(0, dt);
    this.time += dt;
    if (this.prev) {
      this.prevTime += dt;
      this.fade -= dt;
      if (this.fade <= 0) this.prev = null;
    }
  }

  private static frame(c: Clip, t: number, rate: number, loop: boolean, fps: number): number {
    const span = Math.max(1, c.frames - 1);
    let f = Math.max(0, t * rate * fps);
    if (loop) f %= span;
    else f = Math.min(f, span);
    return c.row + f;
  }

  /** The instance attribute: current frame, fading frame, fade weight. */
  write(out: Vector4, fps: number): void {
    out.x = CharacterAnimator.frame(this.clip, this.time, this.rate, this.loop, fps);
    if (this.prev) {
      out.y = CharacterAnimator.frame(this.prev, this.prevTime, this.prevRate, this.prevLoop, fps);
      const k = Math.max(0, this.fade / this.fadeLength);
      out.z = k * k * (3 - 2 * k);
    } else {
      out.y = out.x;
      out.z = 0;
    }
    out.w = 0;
  }
}

// ------------------------------------------------------------------ library
/** One unit's character: the instance, its node, and its animator. */
export interface CharacterInstance extends ModelInstance {
  recipe: CharacterRecipe;
  animator: CharacterAnimator;
  mesh: InstancedMesh;
  /** Write the animator's frames into the instance (call once per frame). */
  syncFrames(): void;
}

export class CharacterLibrary {
  private readonly info: FileInfo;
  private readonly bin: ArrayBuffer;
  private readonly rigRow: Record<string, number> = {};
  private readonly clips = new Map<string, Clip>();
  private readonly pieces = new Map<string, PieceInfo>();
  private readonly layer = new Map<string, number>();
  private readonly meshes = new Map<string, Mesh>();
  private readonly materials = new Map<string, StandardMaterial>();
  private vat!: RawTexture;
  private atlas!: RawTexture2DArray;
  private vatWidth = 0;
  /** Called for every new instance (the shadow generator's caster list). */
  onCaster: ((mesh: AbstractMesh) => void) | null = null;
  /** Called for every new source mesh (to receive shadows; instances follow their source). */
  onSource: ((mesh: Mesh) => void) | null = null;
  /** Source meshes, to have them receive shadows. */
  readonly sources: Mesh[] = [];

  private constructor(
    private readonly scene: Scene,
    bin: ArrayBuffer,
    images: Map<string, ImageBitmap | HTMLImageElement>,
  ) {
    this.bin = bin;
    const dv = new DataView(bin);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'KKC1') throw new Error('kaykit.bin: bad header');
    const jsonLength = dv.getUint32(4, true);
    this.info = JSON.parse(new TextDecoder().decode(new Uint8Array(bin, 8, jsonLength))) as FileInfo;
    const dataStart = 8 + jsonLength;
    for (const p of this.info.pieces) this.pieces.set(p.name, p);
    this.info.textures.forEach((t, i) => this.layer.set(t, i));
    this.buildVat(dataStart);
    this.buildAtlas(images);
    this.dataStart = dataStart;
  }

  private readonly dataStart: number;

  /** The file and atlases, fetched once and shared by every scene (the game's and the HUD's). */
  private static files: Promise<[ArrayBuffer, Map<string, HTMLImageElement>]> | null = null;

  /** Load the characters for a scene. `fog: false` for scenes without the fog of war (HUD pictures). */
  static async load(scene: Scene, opts: { fog?: boolean } = {}): Promise<CharacterLibrary> {
    CharacterLibrary.files ??= Promise.all([
      fetch(binUrl).then((r) => r.arrayBuffer()),
      (async () => {
        const images = new Map<string, HTMLImageElement>();
        await Promise.all(
          Object.entries(TEXTURE_URLS).map(async ([path, url]) => {
            const img = new Image();
            img.src = url;
            await img.decode();
            images.set(path.split('/').pop()!, img);
          }),
        );
        return images;
      })(),
    ]);
    const [bin, images] = await CharacterLibrary.files;
    const lib = new CharacterLibrary(scene, bin, images);
    lib.fog = opts.fog ?? true;
    return lib;
  }

  private fog = true;

  /** The animation texture: every rig's frames, stacked in blocks of VAT_BLOCK rows. */
  private buildVat(dataStart: number): void {
    const rigs = Object.entries(this.info.rigs);
    const width = Math.max(...rigs.map(([, r]) => r.vat.width));
    let rows = 0;
    for (const [name, r] of rigs) {
      this.rigRow[name] = rows;
      rows += r.vat.height;
      for (const [clip, c] of Object.entries(r.anims)) {
        this.clips.set(`${name}|${clip}`, {
          name: clip,
          row: this.rigRow[name]! + c.start,
          frames: c.frames,
          duration: c.duration,
          groundSpeed: c.groundSpeed ?? 1,
          impact: c.impact ?? c.duration * 0.4,
        });
      }
    }
    const blocks = Math.ceil(rows / VAT_BLOCK);
    const texW = width * blocks;
    const data = new Uint16Array(texW * VAT_BLOCK * 4);
    for (const [name, r] of rigs) {
      const src = new Uint16Array(this.bin, dataStart + r.vat.offset, r.vat.width * 4 * r.vat.height);
      for (let y = 0; y < r.vat.height; y++) {
        const row = this.rigRow[name]! + y;
        const block = Math.floor(row / VAT_BLOCK);
        const ty = row - block * VAT_BLOCK;
        data.set(src.subarray(y * r.vat.width * 4, (y + 1) * r.vat.width * 4), (ty * texW + block * width) * 4);
      }
    }
    this.vatWidth = width;
    this.vat = new RawTexture(data, texW, VAT_BLOCK, Constants.TEXTUREFORMAT_RGBA, this.scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
    this.vat.name = 'kaykit-vat';
  }

  /** The palette atlases, scaled to ATLAS_SIZE, in one texture array. */
  private buildAtlas(images: Map<string, ImageBitmap | HTMLImageElement>): void {
    const n = this.info.textures.length;
    const S = ATLAS_SIZE;
    const pixels = new Uint8Array(S * S * 4 * n);
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    this.info.textures.forEach((t, i) => {
      const img = images.get(t);
      ctx.clearRect(0, 0, S, S);
      if (img) ctx.drawImage(img, 0, 0, S, S);
      pixels.set(ctx.getImageData(0, 0, S, S).data, i * S * S * 4);
    });
    this.atlas = new RawTexture2DArray(pixels, S, S, n, Constants.TEXTUREFORMAT_RGBA, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    this.atlas.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.atlas.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.atlas.name = 'kaykit-atlas';
  }

  get fps(): number {
    return this.info.fps;
  }

  clip(rig: string, name: string): Clip | null {
    return this.clips.get(`${rig}|${name}`) ?? null;
  }

  has(modelId: string): boolean {
    return !!CHARACTER_RECIPES[modelId];
  }

  private material(ghost: GhostMode | null, isStatic = false): StandardMaterial {
    const key = `${ghost ?? 'solid'}${isStatic ? '-static' : ''}`;
    let m = this.materials.get(key);
    if (m) return m;
    m = new StandardMaterial(`kaykit-${key}`, this.scene);
    m.diffuseColor = Color3.White();
    m.specularColor = Color3.Black();
    m.backFaceCulling = isStatic; // the packs' capes and hats are single-sided; buildings are closed
    const plugin = new CharacterPlugin(m, this.vat, this.atlas, this.vatWidth, isStatic);
    if (!this.fog) {
      const fog = m.pluginManager?.getPlugin('FogOfWar') as { fogEnabled: boolean } | null;
      if (fog) fog.fogEnabled = false;
    }
    if (ghost) {
      m.alpha = ghost === 'illusion' ? 0.75 : 0.4;
      m.transparencyMode = Material.MATERIAL_ALPHABLEND;
      m.disableDepthWrite = ghost !== 'illusion';
      if (ghost === 'illusion') plugin.tint = [0.16, 0.33, 1.0, 0.45];
    } else {
      // Shadow maps run this material's vertex shader, skinning included.
      m.shadowDepthWrapper = new ShadowDepthWrapper(m, this.scene);
    }
    this.materials.set(key, m);
    return m;
  }

  /** Typed views into the file's binary part. */
  private f32(offset: number, count: number): Float32Array {
    return new Float32Array(this.bin, this.dataStart + offset, count);
  }
  private u8(offset: number, count: number): Uint8Array {
    return new Uint8Array(this.bin, this.dataStart + offset, count);
  }

  /** The merged mesh of a recipe (built once, hidden: units draw instances of it). */
  private recipeMesh(id: string, recipe: CharacterRecipe, ghost: GhostMode | null): Mesh {
    const key = `${id}|${ghost ?? ''}`;
    let mesh = this.meshes.get(key);
    if (mesh) return mesh;
    const body = this.pieces.get(recipe.body);
    if (!body) throw new Error(`kaykit: no piece ${recipe.body}`);
    const rig = this.info.rigs[body.rig]!;
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const jnt: number[] = [];
    const wgt: number[] = [];
    const meta: number[] = [];
    const idx: number[] = [];
    const add = (p: PieceInfo, teamCells: ReadonlyArray<readonly [number, number]>): void => {
      const base = pos.length / 3;
      const P = this.f32(p.position, p.vertices * 3);
      const N8 = new Int8Array(this.bin, this.dataStart + p.normal, p.vertices * 3);
      const UV16 = new Uint16Array(this.bin, this.dataStart + p.uv, p.vertices * 2);
      const J = this.u8(p.joints, p.vertices * 4);
      const W8 = this.u8(p.weights, p.vertices * 4);
      const layer = this.layer.get(p.texture) ?? 0;
      // Props are stored in the space of the joint they hang on: into this rig's bind space.
      let m: number[] | null = null;
      let joint = 0;
      if (p.kind === 'prop') {
        joint = rig.joints.indexOf(p.joint!);
        if (joint < 0) throw new Error(`kaykit: rig ${body.rig} has no joint ${p.joint}`);
        m = rig.bindWorld[joint]!;
      }
      for (let i = 0; i < p.vertices; i++) {
        const x = P[i * 3]!, y = P[i * 3 + 1]!, z = P[i * 3 + 2]!;
        const nx = N8[i * 3]! / 127, ny = N8[i * 3 + 1]! / 127, nz = N8[i * 3 + 2]! / 127;
        if (m) {
          pos.push(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
          nrm.push(m[0]! * nx + m[4]! * ny + m[8]! * nz, m[1]! * nx + m[5]! * ny + m[9]! * nz, m[2]! * nx + m[6]! * ny + m[10]! * nz);
          jnt.push(joint, 0, 0, 0);
          wgt.push(1, 0, 0, 0);
        } else {
          pos.push(x, y, z);
          nrm.push(nx, ny, nz);
          jnt.push(J[i * 4]!, J[i * 4 + 1]!, J[i * 4 + 2]!, J[i * 4 + 3]!);
          wgt.push(W8[i * 4]! / 255, W8[i * 4 + 1]! / 255, W8[i * 4 + 2]! / 255, W8[i * 4 + 3]! / 255);
        }
        const u = UV16[i * 2]! / 65535;
        const v = UV16[i * 2 + 1]! / 65535;
        uv.push(u, v);
        // The team mask: is the vertex on one of the team's swatches (8 × 4 grid, v down)?
        const col = Math.min(7, Math.floor(u * 8));
        const row = Math.min(3, Math.floor(v * 4));
        meta.push(teamCells.some(([c, r]) => c === col && r === row) ? 1 : 0, layer, 0);
      }
      const I = p.index32 ? new Uint32Array(this.bin, this.dataStart + p.index, p.indices) : new Uint16Array(this.bin, this.dataStart + p.index, p.indices);
      for (let i = 0; i < I.length; i++) idx.push(base + I[i]!);
    };
    add(body, recipe.bodyTeam ?? TEAM_CELLS[body.texture] ?? []);
    for (const spec of recipe.props) {
      const name = typeof spec === 'string' ? spec : spec.p;
      if (name.startsWith('@')) {
        // A prop made in code (CharacterProps.ts), in its joint's space like the packs' props.
        const make = PROCEDURAL_PROPS[name.slice(1)];
        if (!make) throw new Error(`kaykit: no procedural prop ${name}`);
        const g = make();
        const joint = rig.joints.indexOf(g.joint);
        const m = rig.bindWorld[joint]!;
        const base = pos.length / 3;
        const layer = this.layer.get(g.texture) ?? 0;
        const cells = typeof spec === 'string' ? TEAM_CELLS[g.texture] ?? [] : spec.team;
        for (let i = 0; i < g.positions.length / 3; i++) {
          const x = g.positions[i * 3]!, y = g.positions[i * 3 + 1]!, z = g.positions[i * 3 + 2]!;
          const nx = g.normals[i * 3]!, ny = g.normals[i * 3 + 1]!, nz = g.normals[i * 3 + 2]!;
          pos.push(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
          nrm.push(m[0]! * nx + m[4]! * ny + m[8]! * nz, m[1]! * nx + m[5]! * ny + m[9]! * nz, m[2]! * nx + m[6]! * ny + m[10]! * nz);
          jnt.push(joint, 0, 0, 0);
          wgt.push(1, 0, 0, 0);
          const u = g.uvs[i * 2]!;
          const v = g.uvs[i * 2 + 1]!;
          uv.push(u, v);
          const col = Math.min(7, Math.floor(u * 8));
          const row = Math.min(3, Math.floor(v * 4));
          meta.push(cells.some(([c, r]) => c === col && r === row) ? 1 : 0, layer, g.glow[i]!);
        }
        for (const i of g.indices) idx.push(base + i);
        continue;
      }
      const p = this.pieces.get(name);
      if (!p) throw new Error(`kaykit: no piece ${name}`);
      add(p, typeof spec === 'string' ? TEAM_CELLS[p.texture] ?? [] : spec.team);
    }
    mesh = new Mesh(`kaykit-${key}`, this.scene);
    mesh.sideOrientation = Material.CounterClockWiseSideOrientation; // glTF winding
    const vd = new VertexData();
    vd.positions = pos;
    vd.normals = nrm;
    vd.indices = idx;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData('kkJ', jnt, false, 4);
    mesh.setVerticesData('kkW', wgt, false, 4);
    mesh.setVerticesData('kkUV', uv, false, 2);
    mesh.setVerticesData('kkMeta', meta, false, 3);
    // (Not Babylon's instance `color`: its define is only set once an instance buffer exists.)
    mesh.registerInstancedBuffer('kkTeam', 4);
    mesh.instancedBuffers.kkTeam = new Color4(0.58, 0.59, 0.59, 0);
    mesh.registerInstancedBuffer('kkFrame', 4);
    // (Instance values must be vectors: Babylon copies them with toArray.)
    mesh.instancedBuffers.kkFrame = new Vector4(0, 0, 0, 0);
    mesh.material = this.material(ghost);
    // Animated poses reach past the bind pose (a fallen body, a raised staff): a generous box.
    const h = body.bounds.maxY;
    mesh.setBoundingInfo(new BoundingInfo(new Vector3(-h * 0.7, -0.3, -h * 0.7), new Vector3(h * 0.7, h * 1.2, h * 0.7)));
    mesh.doNotSyncBoundingInfo = true;
    mesh.isVisible = false;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = false;
    this.meshes.set(key, mesh);
    if (!ghost) {
      this.sources.push(mesh);
      this.onSource?.(mesh);
    }
    return mesh;
  }

  hasBuilding(modelId: string): boolean {
    return !!BUILDING_RECIPES[modelId];
  }

  /** The mesh of a building recipe (built once, hidden), and its size once scaled. */
  private buildingMesh(modelId: string, ghost: GhostMode | null): { mesh: Mesh; scale: number; height: number; radius: number } {
    const recipe = BUILDING_RECIPES[modelId]!;
    return this.staticMesh(recipe.piece, recipe.size, ghost);
  }

  /** A static piece's mesh (built once, hidden), scaled to `size` wide. */
  private staticMesh(pieceName: string, size: number, ghost: GhostMode | null): { mesh: Mesh; scale: number; height: number; radius: number } {
    const key = `static:${pieceName}|${ghost ?? ''}`;
    const piece = this.pieces.get(pieceName);
    if (!piece) throw new Error(`kaykit: no piece ${pieceName}`);
    let mesh = this.meshes.get(key);
    if (!mesh) {
      mesh = this.pieceMesh(key, piece, TEAM_CELLS[piece.texture] ?? [], ghost);
      this.meshes.set(key, mesh);
      if (!ghost) {
        this.sources.push(mesh);
        this.onSource?.(mesh);
      }
    }
    const bb = mesh.getBoundingInfo().boundingBox;
    const w = Math.max(bb.maximum.x - bb.minimum.x, bb.maximum.z - bb.minimum.z);
    const scale = size / Math.max(0.1, w);
    return { mesh, scale, height: bb.maximum.y * scale, radius: (w / 2) * scale };
  }

  /** A static piece as a mesh (buildings): exact bounds, the static material. */
  private pieceMesh(name: string, p: PieceInfo, teamCells: ReadonlyArray<readonly [number, number]>, ghost: GhostMode | null): Mesh {
    const P = this.f32(p.position, p.vertices * 3);
    const N8 = new Int8Array(this.bin, this.dataStart + p.normal, p.vertices * 3);
    const UV16 = new Uint16Array(this.bin, this.dataStart + p.uv, p.vertices * 2);
    const layer = this.layer.get(p.texture) ?? 0;
    const nrm = new Float32Array(p.vertices * 3);
    const uv = new Float32Array(p.vertices * 2);
    const meta = new Float32Array(p.vertices * 3);
    for (let i = 0; i < p.vertices; i++) {
      for (let k = 0; k < 3; k++) nrm[i * 3 + k] = N8[i * 3 + k]! / 127;
      const u = UV16[i * 2]! / 65535;
      const v = UV16[i * 2 + 1]! / 65535;
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
      const col = Math.min(7, Math.floor(u * 8));
      const row = Math.min(3, Math.floor(v * 4));
      meta[i * 3] = teamCells.some(([c, r]) => c === col && r === row) ? 1 : 0;
      meta[i * 3 + 1] = layer;
    }
    const I = p.index32 ? new Uint32Array(this.bin, this.dataStart + p.index, p.indices) : new Uint16Array(this.bin, this.dataStart + p.index, p.indices);
    const mesh = new Mesh(`kaykit-${name}`, this.scene);
    mesh.sideOrientation = Material.CounterClockWiseSideOrientation; // glTF winding
    const vd = new VertexData();
    vd.positions = Float32Array.from(P);
    vd.normals = nrm;
    vd.indices = Array.from(I);
    vd.applyToMesh(mesh, false);
    const zeros = new Float32Array(p.vertices * 4);
    mesh.setVerticesData('kkJ', zeros, false, 4);
    mesh.setVerticesData('kkW', zeros, false, 4);
    mesh.setVerticesData('kkUV', uv, false, 2);
    mesh.setVerticesData('kkMeta', meta, false, 3);
    mesh.registerInstancedBuffer('kkTeam', 4);
    mesh.instancedBuffers.kkTeam = new Color4(0.58, 0.59, 0.59, 0);
    mesh.registerInstancedBuffer('kkFrame', 4);
    mesh.instancedBuffers.kkFrame = new Vector4(0, 0, 0, 0);
    mesh.material = this.material(ghost, true);
    mesh.isVisible = false;
    mesh.isPickable = false;
    return mesh;
  }

  /** A building drawn with the KayKit model (null when the model id has no building recipe). */
  instantiateBuilding(modelId: string, team: number, name: string, ghost: GhostMode | null = null): ModelInstance | null {
    if (!BUILDING_RECIPES[modelId]) return null;
    const { mesh, scale, height, radius } = this.buildingMesh(modelId, ghost);
    const root = new TransformNode(name, this.scene);
    const inst = mesh.createInstance(`${name}-kk`);
    inst.parent = root;
    inst.scaling.setAll(scale);
    inst.isPickable = false;
    inst.instancedBuffers.kkTeam = new Color4(((team >> 16) & 255) / 255, ((team >> 8) & 255) / 255, (team & 255) / 255, 1);
    inst.instancedBuffers.kkFrame = new Vector4(0, 0, 0, 0);
    if (!ghost) this.onCaster?.(inst);
    return { id: modelId, root, parts: {}, height, radius, meshes: [inst], dispose: () => root.dispose(false, false) };
  }

  /** Any static piece (construction stages, rubble), `size` wide, in a team colour. */
  instantiateStatic(pieceName: string, team: number, name: string, size: number): ModelInstance {
    const { mesh, scale, height, radius } = this.staticMesh(pieceName, size, null);
    const root = new TransformNode(name, this.scene);
    const inst = mesh.createInstance(`${name}-kk`);
    inst.parent = root;
    inst.scaling.setAll(scale);
    inst.isPickable = false;
    inst.instancedBuffers.kkTeam = new Color4(((team >> 16) & 255) / 255, ((team >> 8) & 255) / 255, (team & 255) / 255, 1);
    inst.instancedBuffers.kkFrame = new Vector4(0, 0, 0, 0);
    this.onCaster?.(inst);
    return { id: pieceName, root, parts: {}, height, radius, meshes: [inst], dispose: () => root.dispose(false, false) };
  }

  /** A building in one flat material (placement previews). */
  instantiateBuildingFlat(modelId: string, material: Material, name: string): ModelInstance | null {
    if (!BUILDING_RECIPES[modelId]) return null;
    const { mesh, scale, height, radius } = this.buildingMesh(modelId, null);
    const root = new TransformNode(name, this.scene);
    const copy = new Mesh(`${name}-flat`, this.scene, root, mesh, true);
    copy.material = material;
    copy.isVisible = true;
    copy.isPickable = false;
    copy.scaling.setAll(scale);
    return { id: modelId, root, parts: {}, height, radius, meshes: [copy], dispose: () => root.dispose(false, false) };
  }

  /** A character for a unit of the given model id (null when the model has no recipe). */
  instantiate(modelId: string, team: number, name: string, ghost: GhostMode | null = null): CharacterInstance | null {
    const recipe = CHARACTER_RECIPES[modelId];
    if (!recipe) return null;
    const source = this.recipeMesh(modelId, recipe, ghost);
    const body = this.pieces.get(recipe.body)!;
    const root = new TransformNode(name, this.scene);
    const scaleNode = new TransformNode(`${name}-scale`, this.scene);
    scaleNode.parent = root;
    const k = recipe.height / (body.bounds.maxY - body.bounds.minY);
    scaleNode.scaling.setAll(k);
    const inst = source.createInstance(`${name}-kk`);
    inst.parent = scaleNode;
    inst.isPickable = false;
    inst.instancedBuffers.kkTeam = new Color4(((team >> 16) & 255) / 255, ((team >> 8) & 255) / 255, (team & 255) / 255, 1);
    const frame = new Vector4(0, 0, 0, 0);
    inst.instancedBuffers.kkFrame = frame;
    if (!ghost) this.onCaster?.(inst);
    const animator = new CharacterAnimator(this, body.rig, recipe.idle[0]!);
    const fps = this.info.fps;
    return {
      id: modelId,
      root,
      parts: {},
      height: recipe.height,
      radius: Math.max(0.3, body.bounds.radius * k),
      meshes: [inst],
      recipe,
      animator,
      mesh: inst,
      syncFrames: () => {
        animator.write(frame, fps);
        inst.instancedBuffers.kkFrame = frame;
      },
      dispose: () => root.dispose(false, false),
    };
  }

  /** Build (and compile) one character's mesh and material ahead of time. */
  async warmUp(modelId = 'footman'): Promise<void> {
    const recipe = CHARACTER_RECIPES[modelId];
    if (!recipe) return;
    const mesh = this.recipeMesh(modelId, recipe, null);
    await mesh.material!.forceCompilationAsync(mesh, { useInstances: true }).catch(() => undefined);
  }

  /** Scale from the recipe's body (model units → world). */
  scaleOf(modelId: string): number {
    const r = CHARACTER_RECIPES[modelId];
    const b = r && this.pieces.get(r.body);
    return r && b ? r.height / (b.bounds.maxY - b.bounds.minY) : 1;
  }
}
