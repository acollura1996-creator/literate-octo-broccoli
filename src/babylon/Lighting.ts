// Matches three.js lighting on Babylon's StandardMaterial.
//
// three.js lights in linear space and encodes the result to sRGB: on screen, a surface shows
// albedo_sRGB × irradiance^(1/2.2). Babylon's StandardMaterial multiplies the (gamma) albedo by
// the irradiance directly, so faces turned away from the sun come out far darker. This plugin
// recomputes the final colour with the accumulated light gamma-encoded, per pixel.
//
// Light intensities are set in three.js units divided by π (three.js's Lambert BRDF), so the
// numbers in the view carry over. The visual upgrade (M8) builds on this linear lighting.
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { RegisterMaterialPlugin } from '@babylonjs/core/Materials/materialPluginManager';
import type { Material } from '@babylonjs/core/Materials/material';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';

export class LinearLightingPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // Runs before the team-colour emissive and fog-of-war code in the same hooks.
    super(material, 'LinearLighting', 100, { LINEARLIGHTING: false }, true, true);
  }

  override getClassName(): string {
    return 'LinearLightingPlugin';
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['LINEARLIGHTING'] = true;
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FOG: `#if defined(LINEARLIGHTING) && !defined(DISABLELIGHTING)
        {
          vec3 litBase = pow(max(diffuseBase, vec3(0.0)), vec3(1.0 / 2.2));
        #ifdef EMISSIVEASILLUMINATION
          color.rgb = clamp(litBase * diffuseColor + vAmbientColor, 0.0, 1.0) * baseColor.rgb * baseAmbientColor + emissiveColor;
        #else
          color.rgb = clamp(litBase * diffuseColor + emissiveColor + vAmbientColor, 0.0, 1.0) * baseColor.rgb * baseAmbientColor;
        #endif
        }
      #endif`,
    };
  }
}

let registered = false;

/** Give every StandardMaterial created from now on three.js-style lighting. */
export function registerLinearLighting(): void {
  if (registered) return;
  registered = true;
  RegisterMaterialPlugin('LinearLighting', (material) => (material.getClassName() === 'StandardMaterial' ? new LinearLightingPlugin(material) : null));
}
