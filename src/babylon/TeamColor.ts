// Team colour for baked models. A team-coloured material stores, from the bake, how its colour
// follows the team colour: colour = k × team + b in linear space (mat(team) is k = 1, shade() scales
// k, a blend toward white adds b). Each unit's team colour arrives per instance in the instanced
// `color` buffer (which Babylon feeds through its vertex-colour path, `vColor`), so every team
// shares one material and one draw call per part.
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';

/** [k, b_r, b_g, b_b] from the bake (tools/bake-models.mjs). */
export type TeamFactor = [number, number, number, number];

export class TeamColorPlugin extends MaterialPluginBase {
  /** Team colour (sRGB 0-1) for meshes drawn without instances (e.g. ghost copies). */
  fallback: [number, number, number] = [0.58, 0.59, 0.59];

  constructor(
    material: Material,
    private readonly base: TeamFactor | null,
    private readonly emissive: TeamFactor | null,
  ) {
    super(material, 'TeamColor', 150, { TEAMCOLOR: false, TEAMEMISSIVE: false }, true, true);
  }

  override getClassName(): string {
    return 'TeamColorPlugin';
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['TEAMCOLOR'] = !!this.base;
    defines['TEAMEMISSIVE'] = !!this.emissive;
  }

  override getUniforms() {
    return {
      ubo: [
        { name: 'teamBase', size: 4, type: 'vec4' },
        { name: 'teamEmissive', size: 4, type: 'vec4' },
        { name: 'teamFallback', size: 3, type: 'vec3' },
      ],
      fragment: `#if defined(TEAMCOLOR) || defined(TEAMEMISSIVE)
        uniform vec4 teamBase;
        uniform vec4 teamEmissive;
        uniform vec3 teamFallback;
      #endif`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    const b = this.base ?? [0, 0, 0, 0];
    const e = this.emissive ?? [0, 0, 0, 0];
    uniformBuffer.updateFloat4('teamBase', b[0], b[1], b[2], b[3]);
    uniformBuffer.updateFloat4('teamEmissive', e[0], e[1], e[2], e[3]);
    uniformBuffer.updateFloat3('teamFallback', this.fallback[0], this.fallback[1], this.fallback[2]);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== 'fragment') return null;
    // The team colour is sRGB; the factors are linear (three.js colour management). The result is
    // converted back to the gamma space StandardMaterial works in.
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#if defined(TEAMCOLOR) || defined(TEAMEMISSIVE)
        vec3 teamLinear() {
        #if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
          return pow(vColor.rgb, vec3(2.2));
        #else
          return pow(teamFallback, vec3(2.2));
        #endif
        }
        vec3 teamApply(vec4 f) {
          return pow(max(vec3(0.0), f.x * teamLinear() + f.yzw), vec3(1.0 / 2.2));
        }
      #endif`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef TEAMCOLOR
        baseColor.rgb = teamApply(teamBase);
      #elif defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
        baseColor.rgb /= max(vColor.rgb, vec3(1e-4));
      #endif`,
      CUSTOM_FRAGMENT_BEFORE_FOG: `#ifdef TEAMEMISSIVE
        color.rgb += teamApply(teamEmissive);
      #endif`,
    };
  }
}
