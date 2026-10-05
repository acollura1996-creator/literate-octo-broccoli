// Merged model parts (M9). At load, every static part under an animated node is merged into one
// mesh in that node's space, whatever its material: footman 24 meshes → 6, knight 31 → 8. The
// colours that were materials become vertex attributes, read by this plugin on one shared material:
//
//   mAlbedo  rgb: sRGB albedo, a: team factor k (0: not team-coloured)
//   mTeamB   rgb: team offset b (linear; colour = k × team + b, as in TeamColor.ts), a: paint scale
//   mPaint   painted pattern weights × strength (see Painterly.ts)
//
// The team colour still arrives per instance in the instanced `color` buffer (vColor), so every
// unit of a model, whatever its team, shares each merged part's draw call. Glowing, translucent
// and depth-write-off parts keep their own materials.
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { PainterlyPlugin, paintTextureFor } from './Painterly';

export const MERGED_ATTRIBUTES = ['mAlbedo', 'mTeamB', 'mPaint'] as const;

export class MergedModelPlugin extends MaterialPluginBase {
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
    samplers.push('mPaintSampler');
  }

  override getUniforms() {
    return {
      ubo: [
        { name: 'mFallback', size: 3, type: 'vec3' },
        { name: 'mTint', size: 4, type: 'vec4' },
      ],
      fragment: `#ifdef MERGEDMODEL
        uniform vec3 mFallback;
        uniform vec4 mTint;
      #endif`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat3('mFallback', this.fallback[0], this.fallback[1], this.fallback[2]);
    uniformBuffer.updateFloat4('mTint', this.tint[0], this.tint[1], this.tint[2], this.tint[3]);
    if (PainterlyPlugin.enabled) uniformBuffer.setTexture('mPaintSampler', this.texture);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef MERGEDMODEL
          attribute vec4 mAlbedo;
          attribute vec4 mTeamB;
          attribute vec4 mPaint;
          varying vec4 vMAlbedo;
          varying vec4 vMTeamB;
          varying vec4 vMPaint;
          varying vec3 vMPos;
        #endif`,
        CUSTOM_VERTEX_MAIN_END: `#ifdef MERGEDMODEL
          vMAlbedo = mAlbedo;
          vMTeamB = mTeamB;
          vMPaint = mPaint;
          vMPos = positionUpdated;
        #endif`,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef MERGEDMODEL
        varying vec4 vMAlbedo;
        varying vec4 vMTeamB;
        varying vec4 vMPaint;
        varying vec3 vMPos;
      #ifdef MERGEDPAINT
        uniform sampler2D mPaintSampler;
      #endif
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
        #ifdef MERGEDPAINT
          vec3 pp = vMPos * vMTeamB.a;
          vec3 pn = abs(normalize(cross(dFdx(vMPos), dFdy(vMPos))));
          vec3 tw = pn * pn * pn * pn;
          tw /= max(1e-4, tw.x + tw.y + tw.z);
          vec4 ps = texture2D(mPaintSampler, pp.zy) * tw.x + texture2D(mPaintSampler, pp.xz) * tw.y + texture2D(mPaintSampler, pp.xy) * tw.z;
          float strength = vMPaint.x + vMPaint.y + vMPaint.z + vMPaint.w;
          alb *= 1.0 + 2.0 * (dot(ps, vMPaint) - 0.5 * strength);
        #endif
          baseColor.rgb = alb;
        }
      #endif`,
    };
  }
}
