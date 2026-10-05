// Fog of war and black mask: every Babylon material is darkened by the fog grid of the simulation
// (src/game/fog.js), sampled at the fragment's world XZ position. This replaces the three.js
// `onBeforeCompile` patch in src/render/assets.js with a Babylon material plugin.
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { RegisterMaterialPlugin } from '@babylonjs/core/Materials/materialPluginManager';
import type { Material } from '@babylonjs/core/Materials/material';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Scene } from '@babylonjs/core/scene';
import type { Fog } from '../game/fog.ts';

/** What the fog texture reads from the game's fog of war. */
export type FogLike = Pick<Fog, 'size' | 'texData' | 'version'>;

/** The fog texture shared by every material (and the water shader). */
export class FogOfWar {
  static current: FogOfWar | null = null;
  readonly fog: FogLike;
  readonly texture: RawTexture;
  private version = -1;

  constructor(fog: FogLike, scene: Scene) {
    this.fog = fog;
    this.texture = new RawTexture(
      fog.texData,
      fog.size,
      fog.size,
      Constants.TEXTUREFORMAT_R,
      scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    );
    this.texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    FogOfWar.current = this;
  }

  /** Upload the grid when the simulation changed it. */
  update(): void {
    if (this.version === this.fog.version) return;
    this.version = this.fog.version;
    this.texture.update(this.fog.texData);
  }

  dispose(): void {
    if (FogOfWar.current === this) FogOfWar.current = null;
    this.texture.dispose();
  }
}

// Bound while no game (and so no fog grid) exists: everything fully visible.
let white: RawTexture | null = null;
function whiteTexture(scene: Scene): RawTexture {
  if (!white || white.getScene() !== scene) {
    white = new RawTexture(new Uint8Array([255]), 1, 1, Constants.TEXTUREFORMAT_R, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  }
  return white;
}

/** Material plugin: multiplies the final colour by the fog value. */
export class FogOfWarPlugin extends MaterialPluginBase {
  private enabled = true;

  constructor(material: Material) {
    super(material, 'FogOfWar', 300, { FOGOFWAR: false }, true, true);
  }

  /** Off for materials that ignore the fog (UI previews, icons). */
  get fogEnabled(): boolean {
    return this.enabled;
  }

  set fogEnabled(v: boolean) {
    if (v === this.enabled) return;
    this.enabled = v;
    this.markAllDefinesAsDirty();
  }

  override getClassName(): string {
    return 'FogOfWarPlugin';
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['FOGOFWAR'] = this.enabled;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('fowSampler');
  }

  override getUniforms() {
    return {
      ubo: [{ name: 'fowWorldSize', size: 2, type: 'vec2' }],
      fragment: `#ifdef FOGOFWAR
        uniform vec2 fowWorldSize;
      #endif`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, scene: Scene): void {
    if (!this.enabled) return;
    const f = FogOfWar.current;
    const size = f ? f.fog.size : 1;
    uniformBuffer.updateFloat2('fowWorldSize', size, size);
    uniformBuffer.setTexture('fowSampler', f ? f.texture : whiteTexture(scene));
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef FOGOFWAR
        uniform sampler2D fowSampler;
      #endif`,
      // With the HDR pipeline (IMAGEPROCESSINGPOSTPROCESS) the colour is linear at this point, so
      // the fog factor is too: the darkening looks the same once the pipeline gamma-encodes.
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `#ifdef FOGOFWAR
        float fowV = texture2D(fowSampler, vPositionW.xz / fowWorldSize).r;
      #ifdef IMAGEPROCESSINGPOSTPROCESS
        color.rgb *= pow(fowV, 2.2);
      #else
        color.rgb *= fowV;
      #endif
      #endif`,
    };
  }
}

let registered = false;

/** Give every material created from now on the fog-of-war plugin. */
export function registerFogOfWar(): void {
  if (registered) return;
  registered = true;
  RegisterMaterialPlugin('FogOfWar', (material) => {
    if (material.getClassName() !== 'StandardMaterial') return null;
    return new FogOfWarPlugin(material);
  });
}
