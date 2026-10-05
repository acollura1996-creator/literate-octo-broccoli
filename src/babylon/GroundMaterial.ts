// The terrain's hand-painted ground (M13): the eight paintings of GroundPaint.ts in one texture
// array, blended per pixel by splat weights built from the simulation's ground types.
//
// - Each map cell gives its type full weight (grass, forest floor, dirt, road, cobbles, shore,
//   blight); steep cells turn to cliff rock. Bilinear filtering spreads the weights over a cell.
// - Height blending: where layers meet, the higher painted detail wins (a stone, a clump of grass),
//   so borders are crisp and irregular, as on Warcraft III's tile sets, instead of a smudge.
// - Anti-tiling: a second, rotated and rescaled sample of each layer takes over in blotches chosen
//   by a macro noise map, which also varies the brightness and warmth across the map.
// - Ground near the waterline is darkened as if wet.
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { RawTexture2DArray } from '@babylonjs/core/Materials/Textures/rawTexture2DArray';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Material } from '@babylonjs/core/Materials/material';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Scene } from '@babylonjs/core/scene';
import { fbm } from '../world/noise.ts';
import { T_BLIGHT, T_COBBLE, T_DIRT, T_FOREST, T_GRASS, T_ROAD, T_SHORE, WATER_LEVEL } from '../world/terrain.ts';
import type { Terrain } from '../world/terrain.ts';
import { GROUND_LAYERS, GROUND_TILE_UNITS, groundLayerPixels, paintGroundLayers } from './GroundPaint';

/** Simulation ground type → painted layer (index into GROUND_LAYERS). */
const LAYER_OF_TYPE: Record<number, number> = {
  [T_GRASS]: 0,
  [T_FOREST]: 1,
  [T_DIRT]: 2,
  [T_ROAD]: 3,
  [T_COBBLE]: 4,
  [T_SHORE]: 5,
  [T_BLIGHT]: 6,
};
const ROCK_LAYER = 7;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

let layerPixels: Uint8Array | null = null;
const layerTextures = new WeakMap<Scene, RawTexture2DArray>();

/** The painted layers as a texture array (painted once per session, uploaded once per scene). */
function layerTexture(scene: Scene): RawTexture2DArray {
  let t = layerTextures.get(scene);
  if (!t) {
    layerPixels ??= groundLayerPixels(paintGroundLayers());
    const n = GROUND_LAYERS.length;
    const size = Math.round(Math.sqrt(layerPixels.length / 4 / n));
    t = new RawTexture2DArray(layerPixels, size, size, n, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 8;
    layerTextures.set(scene, t);
  }
  return t;
}

/** Two RGBA splat maps (layers 0-3 and 4-7), one texel per map cell. */
function splatPixels(terrain: Terrain): [Uint8Array, Uint8Array] {
  const S = terrain.size;
  const n = S + 1;
  const h = terrain.heights;
  const a = new Uint8Array(S * S * 4);
  const b = new Uint8Array(S * S * 4);
  for (let cz = 0; cz < S; cz++) {
    for (let cx = 0; cx < S; cx++) {
      const i = cz * S + cx;
      const h00 = h[cz * n + cx]!;
      const h10 = h[cz * n + cx + 1]!;
      const h01 = h[(cz + 1) * n + cx]!;
      const h11 = h[(cz + 1) * n + cx + 1]!;
      const slope = Math.hypot((h10 - h00 + h11 - h01) / 2, (h01 - h00 + h11 - h10) / 2);
      const rock = smoothstep(0.3, 0.6, slope);
      const layer = LAYER_OF_TYPE[terrain.types[i]!] ?? 0;
      const w = new Float32Array(8);
      w[layer] = 1 - rock;
      w[ROCK_LAYER] = (w[ROCK_LAYER] ?? 0) + rock;
      for (let k = 0; k < 4; k++) {
        a[i * 4 + k] = Math.round(w[k]! * 255);
        b[i * 4 + k] = Math.round(w[k + 4]! * 255);
      }
    }
  }
  return [a, b];
}

/** Map-wide variation: R brightness, G warmth, B which of the two layer samples shows. */
function macroPixels(S: number): Uint8Array {
  const out = new Uint8Array(S * S * 4);
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const o = (z * S + x) * 4;
      const v = (f: number): number => Math.round(Math.max(0, Math.min(1, f)) * 255);
      out[o] = v(0.5 + fbm(x * 0.045, z * 0.045, 501, 3) * 1.1);
      out[o + 1] = v(0.5 + fbm(x * 0.022, z * 0.022, 502, 2) * 1.3);
      out[o + 2] = v(0.5 + fbm(x * 0.16, z * 0.16, 503, 2) * 1.4);
      out[o + 3] = 255;
    }
  }
  return out;
}

function dataTexture(data: Uint8Array, size: number, scene: Scene): RawTexture {
  const t = new RawTexture(data, size, size, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
  t.wrapU = Texture.CLAMP_ADDRESSMODE;
  t.wrapV = Texture.CLAMP_ADDRESSMODE;
  return t;
}

export class GroundSplatPlugin extends MaterialPluginBase {
  private readonly layers: RawTexture2DArray;
  private readonly splatA: RawTexture;
  private readonly splatB: RawTexture;
  private readonly macro: RawTexture;
  private readonly size: number;

  constructor(material: Material, terrain: Terrain) {
    super(material, 'GroundSplat', 120, { GROUNDSPLAT: false }, true, true);
    const scene = material.getScene();
    this.size = terrain.size;
    this.layers = layerTexture(scene);
    const [a, b] = splatPixels(terrain);
    this.splatA = dataTexture(a, terrain.size, scene);
    this.splatB = dataTexture(b, terrain.size, scene);
    this.macro = dataTexture(macroPixels(terrain.size), terrain.size, scene);
  }

  override getClassName(): string {
    return 'GroundSplatPlugin';
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['GROUNDSPLAT'] = true;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('gsLayers', 'gsSplatA', 'gsSplatB', 'gsMacro');
  }

  override getUniforms() {
    return {
      ubo: [
        { name: 'gsScaleA', size: 4, type: 'vec4' },
        { name: 'gsScaleB', size: 4, type: 'vec4' },
        { name: 'gsMap', size: 2, type: 'vec2' },
      ],
      fragment: `#ifdef GROUNDSPLAT
        uniform vec4 gsScaleA;
        uniform vec4 gsScaleB;
        uniform vec2 gsMap;
      #endif`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    const k = (i: number): number => 1 / GROUND_TILE_UNITS[GROUND_LAYERS[i]!];
    uniformBuffer.updateFloat4('gsScaleA', k(0), k(1), k(2), k(3));
    uniformBuffer.updateFloat4('gsScaleB', k(4), k(5), k(6), k(7));
    uniformBuffer.updateFloat2('gsMap', this.size, WATER_LEVEL);
    uniformBuffer.setTexture('gsLayers', this.layers);
    uniformBuffer.setTexture('gsSplatA', this.splatA);
    uniformBuffer.setTexture('gsSplatB', this.splatB);
    uniformBuffer.setTexture('gsMacro', this.macro);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef GROUNDSPLAT
        uniform highp sampler2DArray gsLayers;
        uniform sampler2D gsSplatA;
        uniform sampler2D gsSplatB;
        uniform sampler2D gsMacro;

        vec3 groundSplat(vec3 posW) {
          vec2 p = posW.xz;
          vec2 suv = p / gsMap.x;
          vec4 wa = texture2D(gsSplatA, suv);
          vec4 wb = texture2D(gsSplatB, suv);
          vec4 macro = texture2D(gsMacro, suv);
          float w[8] = float[8](wa.r, wa.g, wa.b, wa.a, wb.r, wb.g, wb.b, wb.a);
          float sc[8] = float[8](gsScaleA.x, gsScaleA.y, gsScaleA.z, gsScaleA.w, gsScaleB.x, gsScaleB.y, gsScaleB.z, gsScaleB.w);
          vec2 dx = dFdx(p);
          vec2 dy = dFdy(p);
          // Anti-tiling: blotches where a rotated, rescaled second sample shows instead.
          float alt = smoothstep(0.44, 0.56, macro.b);
          const mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
          vec4 s[8];
          float hgt[8];
          float top = -1.0;
          for (int i = 0; i < 8; i++) {
            hgt[i] = -2.0;
            s[i] = vec4(0.0);
            if (w[i] > 0.004) {
              vec2 uv = p * sc[i];
              vec4 t1 = textureGrad(gsLayers, vec3(uv, float(i)), dx * sc[i], dy * sc[i]);
              vec4 t2 = textureGrad(gsLayers, vec3(rot * uv * 0.73 + 0.37, float(i)), rot * dx * sc[i] * 0.73, rot * dy * sc[i] * 0.73);
              s[i] = mix(t1, t2, alt);
              hgt[i] = s[i].a + w[i];
              top = max(top, hgt[i]);
            }
          }
          // Height blending: only the layers whose height-plus-weight is near the top show.
          float edge = top - 0.2;
          vec3 col = vec3(0.0);
          float sum = 0.0;
          for (int i = 0; i < 8; i++) {
            float b = max(hgt[i] - edge, 0.0);
            col += s[i].rgb * b;
            sum += b;
          }
          col /= max(sum, 1e-4);
          // Macro variation: brighter and darker stretches, warm sunlit meadows.
          float green = w[0] + w[1];
          col *= 0.88 + 0.24 * macro.r;
          col = mix(col, col * vec3(1.1, 1.05, 0.78), smoothstep(0.55, 0.85, macro.g) * 0.55 * green);
          // Wet ground at the waterline.
          col *= 1.0 - 0.3 * smoothstep(gsMap.y + 0.35, gsMap.y, posW.y);
          return col;
        }
      #endif`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef GROUNDSPLAT
        baseColor.rgb = groundSplat(vPositionW);
      #endif`,
    };
  }

  override dispose(forceDisposeTextures?: boolean): void {
    this.splatA.dispose();
    this.splatB.dispose();
    this.macro.dispose();
    super.dispose(forceDisposeTextures);
  }
}
