// Merged model parts (M9) and their Warcraft III-style shading (M13).
//
// At load, every static part under an animated node is merged into one mesh in that node's space,
// whatever its material: footman 24 meshes → 6, knight 31 → 8. The colours that were materials
// become vertex attributes, read by this plugin on one shared material:
//
//   mAlbedo  rgb: sRGB albedo, a: team factor k (0: not team-coloured)
//   mTeamB   rgb: team offset b (linear; colour = k × team + b, as in TeamColor.ts), a: paint scale
//   mPaint   painted pattern weights × strength (see Painterly.ts)
//   mStyle   x: 1 on buildings, y: surface kind (STYLE_KIND)
//
// The team colour still arrives per instance in the instanced `color` buffer (vColor), so every
// unit of a model, whatever its team, shares each merged part's draw call. Glowing, translucent
// and depth-write-off parts keep their own materials.
//
// M13 shading, in the spirit of Warcraft III's hand-painted models:
// - Smooth normals with a crease angle (creaseNormals): round parts shade round, box edges stay
//   crisp. (The baked parts carry no normals; before, every face was lit flat.)
// - Ground contact: surfaces darken toward the terrain below them (a height map sampled in the
//   vertex shader), so units and buildings sit in the world.
// - Buildings get painted structure by surface kind: brick courses on stone, planks on wood, rows
//   of straw on thatch, tiles on team-coloured roofs.
// - A rim light in the sky's colour picks out silhouettes against the ground.
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Material } from '@babylonjs/core/Materials/material';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Scene } from '@babylonjs/core/scene';
import { PainterlyPlugin, paintTextureFor, type PaintKind } from './Painterly';

export const MERGED_ATTRIBUTES = ['mAlbedo', 'mTeamB', 'mPaint', 'mStyle'] as const;

/** Surface kinds in mStyle.y. */
export const STYLE_KIND: Record<PaintKind, number> = {
  plain: 0,
  stone: 1,
  wood: 2,
  thatch: 3,
  metal: 4,
  gold: 5,
  cloth: 6,
  leather: 7,
  skin: 8,
  foliage: 9,
  bone: 10,
};

/** The terrain's heights for the ground-contact shading (set by the terrain view; null: none). */
export const modelGround: { texture: RawTexture | null; size: number } = { texture: null, size: 1 };

const noGround = new WeakMap<Scene, RawTexture>();
function noGroundTexture(scene: Scene): RawTexture {
  let t = noGround.get(scene);
  if (!t) {
    t = new RawTexture(new Float32Array([-1000]), 1, 1, Constants.TEXTUREFORMAT_R, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
    noGround.set(scene, t);
  }
  return t;
}

export class MergedModelPlugin extends MaterialPluginBase {
  /** Rim light colour (sRGB, already scaled by strength), set each frame from the sky. */
  static rim: [number, number, number] = [0.25, 0.28, 0.32];
  /** Team colour (sRGB) for copies drawn without instances (ghosts). */
  fallback: [number, number, number] = [0.58, 0.59, 0.59];
  /** Linear tint and amount (illusions are blended 45 % toward blue). */
  tint: [number, number, number, number] = [0, 0, 0, 0];
  private readonly texture: RawTexture;

  constructor(material: Material) {
    super(material, 'MergedModel', 150, { MERGEDMODEL: false, MERGEDPAINT: false }, true, true);
    this.texture = paintTextureFor(material.getScene());
  }

  override getClassName(): string {
    return 'MergedModelPlugin';
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['MERGEDMODEL'] = true;
    defines['MERGEDPAINT'] = PainterlyPlugin.enabled;
  }

  override getAttributes(attributes: string[]): void {
    attributes.push(...MERGED_ATTRIBUTES);
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('mPaintSampler', 'mHeight');
  }

  override getUniforms() {
    const decl = `#ifdef MERGEDMODEL
        uniform vec3 mFallback;
        uniform vec4 mTint;
        uniform vec4 mGroundInfo;
        uniform vec3 mRim;
      #endif`;
    return {
      ubo: [
        { name: 'mFallback', size: 3, type: 'vec3' },
        { name: 'mTint', size: 4, type: 'vec4' },
        { name: 'mGroundInfo', size: 4, type: 'vec4' },
        { name: 'mRim', size: 3, type: 'vec3' },
      ],
      vertex: decl,
      fragment: decl,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, scene: Scene): void {
    uniformBuffer.updateFloat3('mFallback', this.fallback[0], this.fallback[1], this.fallback[2]);
    uniformBuffer.updateFloat4('mTint', this.tint[0], this.tint[1], this.tint[2], this.tint[3]);
    const ground = modelGround.texture && modelGround.texture.getScene() === scene ? modelGround.texture : null;
    uniformBuffer.updateFloat4('mGroundInfo', ground ? modelGround.size : 1, ground ? 1 : 0, 0, 0);
    const r = MergedModelPlugin.rim;
    uniformBuffer.updateFloat3('mRim', r[0], r[1], r[2]);
    uniformBuffer.setTexture('mHeight', ground ?? noGroundTexture(scene));
    if (PainterlyPlugin.enabled) uniformBuffer.setTexture('mPaintSampler', this.texture);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef MERGEDMODEL
          attribute vec4 mAlbedo;
          attribute vec4 mTeamB;
          attribute vec4 mPaint;
          attribute vec4 mStyle;
          uniform sampler2D mHeight;
          varying vec4 vMAlbedo;
          varying vec4 vMTeamB;
          varying vec4 vMPaint;
          varying vec4 vMStyle;
          varying vec3 vMPos;
          varying float vMHag;
          // Terrain height (bilinear between the height map's corners; the map is (size+1)² points).
          float mGroundAt(vec2 xz) {
            float n = mGroundInfo.x;
            vec2 g = clamp(xz, vec2(0.0), vec2(n - 1.001));
            vec2 i = floor(g);
            vec2 f = g - i;
            vec2 t = (i + 0.5) / n;
            float a = texture2D(mHeight, t).r;
            float b = texture2D(mHeight, t + vec2(1.0 / n, 0.0)).r;
            float c = texture2D(mHeight, t + vec2(0.0, 1.0 / n)).r;
            float d = texture2D(mHeight, t + vec2(1.0 / n, 1.0 / n)).r;
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }
        #endif`,
        CUSTOM_VERTEX_MAIN_END: `#ifdef MERGEDMODEL
          vMAlbedo = mAlbedo;
          vMTeamB = mTeamB;
          vMPaint = mPaint;
          vMStyle = mStyle;
          vMPos = positionUpdated;
          vMHag = mGroundInfo.y > 0.5 ? worldPos.y - mGroundAt(worldPos.xz) : 10.0;
        #endif`,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef MERGEDMODEL
        varying vec4 vMAlbedo;
        varying vec4 vMTeamB;
        varying vec4 vMPaint;
        varying vec4 vMStyle;
        varying vec3 vMPos;
        varying float vMHag;
      #ifdef MERGEDPAINT
        uniform sampler2D mPaintSampler;
      #endif
        float mHash(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        // A running-bond grid: brightness of the block, and 0 in the joints (sizes in model units).
        float mBlocks(vec2 q, vec2 size, float joint, float vary) {
          float row = floor(q.y / size.y);
          float u = q.x / size.x + row * 0.5;
          vec2 cell = vec2(floor(u), row);
          float du = min(fract(u), 1.0 - fract(u)) * size.x;
          float dv = min(fract(q.y / size.y), 1.0 - fract(q.y / size.y)) * size.y;
          float edge = smoothstep(joint * 0.4, joint, min(du, dv));
          float shade = 1.0 + vary * (mHash(cell) - 0.5) * 2.0;
          // Each block a touch lighter along its upper edge, darker along its lower edge.
          float fv = fract(q.y / size.y);
          shade *= 1.0 + 0.07 * smoothstep(0.6, 1.0, fv) - 0.09 * smoothstep(0.35, 0.0, fv);
          return mix(0.52, shade, edge);
        }
        // Painted structure for building surfaces; 1 where none applies.
        float mBuilding(vec3 p, vec3 fn, float kind, float team) {
          float side = abs(fn.x) > abs(fn.z) ? p.z : p.x;
          float up = abs(fn.y);
          if (kind < 1.5) {
            // Stone: brick courses on walls, flagstones on top.
            return up < 0.5 ? mBlocks(vec2(side, p.y), vec2(0.46, 0.22), 0.028, 0.12) : mBlocks(p.xz, vec2(0.42, 0.42), 0.03, 0.1);
          }
          if (kind < 2.5) {
            // Wood: planks with dark seams.
            float row = up < 0.5 ? p.y / 0.15 : (abs(fn.x) > abs(fn.z) ? p.z : p.x) / 0.15;
            float seam = smoothstep(0.0, 0.09, min(fract(row), 1.0 - fract(row)));
            return mix(0.6, 0.9 + 0.2 * mHash(vec2(floor(row), 7.0)), seam);
          }
          if (kind < 3.5) {
            // Thatch: overlapping rows of straw, each lighter at its top edge, with straw streaks.
            float r = p.y / 0.12;
            float fv = fract(r);
            float straw = 0.88 + 0.24 * mHash(vec2(floor(side * 38.0), floor(r)));
            return (0.68 + 0.42 * fv) * straw;
          }
          if (kind > 5.5 && kind < 6.5 && team > 0.0 && up > 0.3 && up < 0.97) {
            // Team-coloured roofs: rows of tiles.
            float r = p.y / 0.14;
            float fv = fract(r);
            float u = side / 0.17 + floor(r) * 0.5;
            float gap = smoothstep(0.0, 0.08, min(fract(u), 1.0 - fract(u)));
            float tile = 0.92 + 0.16 * mHash(vec2(floor(u), floor(r)));
            return mix(0.55, (0.72 + 0.4 * fv) * tile, gap);
          }
          return 1.0;
        }
      #endif`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef MERGEDMODEL
        {
          vec3 alb = vMAlbedo.rgb;
          if (vMAlbedo.a > 0.0) {
          #if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
            vec3 teamLin = pow(vColor.rgb, vec3(2.2));
          #else
            vec3 teamLin = pow(mFallback, vec3(2.2));
          #endif
            alb = pow(max(vec3(0.0), vMAlbedo.a * teamLin + vMTeamB.rgb), vec3(1.0 / 2.2));
          }
          if (mTint.a > 0.0) alb = pow(mix(pow(alb, vec3(2.2)), mTint.rgb, mTint.a), vec3(1.0 / 2.2));
          vec3 fnM = normalize(cross(dFdx(vMPos), dFdy(vMPos)));
        #ifdef MERGEDPAINT
          vec3 pp = vMPos * vMTeamB.a;
          vec3 pn = abs(fnM);
          vec3 tw = pn * pn * pn * pn;
          tw /= max(1e-4, tw.x + tw.y + tw.z);
          vec4 ps = texture2D(mPaintSampler, pp.zy) * tw.x + texture2D(mPaintSampler, pp.xz) * tw.y + texture2D(mPaintSampler, pp.xy) * tw.z;
          float strength = vMPaint.x + vMPaint.y + vMPaint.z + vMPaint.w;
          // On units, stone-coloured parts (white plate, marble) take brush strokes, not cracks.
          vec4 pw = vMStyle.x > 0.5 ? vMPaint : vec4(0.0, vMPaint.yz, vMPaint.w + vMPaint.x);
          alb *= max(0.4, 1.0 + 2.0 * (dot(ps, pw) - 0.5 * strength));
          if (vMStyle.x > 0.5) alb *= mBuilding(vMPos, fnM, vMStyle.y, vMAlbedo.a);
        #endif
          // Ground contact: darker toward the terrain below.
          alb *= mix(0.55, 1.0, smoothstep(0.0, 0.85, vMHag));
          baseColor.rgb = alb;
        }
      #endif`,
      // After the lighting (LinearLighting, priority 100): a rim light in the sky's colour, and a
      // painted sheen on metal and gold (a highlight from a fixed high sky direction).
      CUSTOM_FRAGMENT_BEFORE_FOG: `#ifdef MERGEDMODEL
        {
          float rimK = pow(1.0 - max(dot(normalW, viewDirectionW), 0.0), 3.0);
          color.rgb += mRim * rimK * (0.6 + 0.4 * baseColor.rgb);
          float kind = vMStyle.y;
          if (kind > 3.5 && kind < 5.5) {
            vec3 sky = normalize(vec3(-0.35, 0.85, 0.4));
            float sheen = pow(max(dot(reflect(-viewDirectionW, normalW), sky), 0.0), 14.0);
            color.rgb += sheen * (kind > 4.5 ? vec3(0.55, 0.45, 0.2) : vec3(0.45)) * (0.4 + 2.5 * dot(mRim, vec3(0.333)));
          }
        }
      #endif`,
    };
  }
}

/**
 * Smooth normals with a crease angle: each corner averages the normals of the triangles around its
 * vertex that lie within `creaseDeg` of its own triangle, and vertices split where the results
 * differ (hard edges). Triangles wind counter-clockwise seen from outside.
 */
export function creaseNormals(pos: number[], idx: number[], attrs: number[][], creaseDeg = 42): { pos: number[]; idx: number[]; normals: number[]; attrs: number[][] } {
  const nv = pos.length / 3;
  const nt = idx.length / 3;
  const area = new Float32Array(nt * 3);
  const unit = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3]! * 3;
    const b = idx[t * 3 + 1]! * 3;
    const c = idx[t * 3 + 2]! * 3;
    const ux = pos[b]! - pos[a]!;
    const uy = pos[b + 1]! - pos[a + 1]!;
    const uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!;
    const vy = pos[c + 1]! - pos[a + 1]!;
    const vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1e-12;
    area.set([nx, ny, nz], t * 3);
    unit.set([nx / l, ny / l, nz / l], t * 3);
  }
  // Triangles around each vertex (compressed lists).
  const count = new Uint32Array(nv + 1);
  for (const v of idx) count[v + 1]!++;
  for (let v = 0; v < nv; v++) count[v + 1]! += count[v]!;
  const around = new Uint32Array(idx.length);
  const fill = count.slice(0, nv);
  for (let k = 0; k < idx.length; k++) around[fill[idx[k]!]!++] = (k / 3) | 0;

  const cosT = Math.cos((creaseDeg * Math.PI) / 180);
  const outPos: number[] = [];
  const outN: number[] = [];
  const outAttrs: number[][] = attrs.map(() => []);
  const outIdx: number[] = new Array(idx.length);
  const made: Array<Array<{ n: [number, number, number]; i: number }>> = [];
  for (let k = 0; k < idx.length; k++) {
    const v = idx[k]!;
    const t = (k / 3) | 0;
    const fx = unit[t * 3]!;
    const fy = unit[t * 3 + 1]!;
    const fz = unit[t * 3 + 2]!;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let j = count[v]!; j < count[v + 1]!; j++) {
      const u = around[j]!;
      if (unit[u * 3]! * fx + unit[u * 3 + 1]! * fy + unit[u * 3 + 2]! * fz < cosT) continue;
      sx += area[u * 3]!;
      sy += area[u * 3 + 1]!;
      sz += area[u * 3 + 2]!;
    }
    const l = Math.hypot(sx, sy, sz) || 1;
    const n: [number, number, number] = [sx / l, sy / l, sz / l];
    const list = (made[v] ??= []);
    let found = -1;
    for (const e of list) {
      if (e.n[0] * n[0] + e.n[1] * n[1] + e.n[2] * n[2] > 0.9995) {
        found = e.i;
        break;
      }
    }
    if (found < 0) {
      found = outPos.length / 3;
      outPos.push(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
      outN.push(...n);
      attrs.forEach((a, ai) => outAttrs[ai]!.push(a[v * 4]!, a[v * 4 + 1]!, a[v * 4 + 2]!, a[v * 4 + 3]!));
      list.push({ n, i: found });
    }
    outIdx[k] = found;
  }
  return { pos: outPos, idx: outIdx, normals: outN, attrs: outAttrs };
}
