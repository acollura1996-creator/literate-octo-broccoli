// The Reforged look (M8, regraded in M13): HDR rendering with neutral tone mapping, bloom, day/night
// colour grading,
// distance haze, cascaded soft shadows, ambient occlusion and a glow layer for emissive parts, in
// three quality presets.
//
// "Low" is the original look: no post-processing, and materials write gamma colour straight to
// the screen (as in the three.js version). From "Medium" up, the camera renders through Babylon's
// DefaultRenderingPipeline: StandardMaterial then outputs linear colour into a half-float target
// (its IMAGEPROCESSINGPOSTPROCESS path), and the pipeline grades, tone maps and gamma-encodes.
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { Constants } from '@babylonjs/core/Engines/constants';
import { PainterlyPlugin } from './Painterly';

export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: Quality[] = ['low', 'medium', 'high'];

interface Preset {
  /** HDR post-processing (tone mapping, grading, bloom, haze). */
  post: boolean;
  /** Shadow cascades (0: no shadows) and their map size. */
  cascades: number;
  shadowSize: number;
  ssao: boolean;
  glow: boolean;
  /** Multisampling of the HDR target (otherwise FXAA). */
  msaa: number;
  /** Share of GPU particles spawned (read by the particle effects). */
  particles: number;
}

const PRESETS: Record<Quality, Preset> = {
  low: { post: false, cascades: 0, shadowSize: 0, ssao: false, glow: false, msaa: 1, particles: 0.35 },
  medium: { post: true, cascades: 2, shadowSize: 1024, ssao: false, glow: true, msaa: 1, particles: 0.7 },
  high: { post: true, cascades: 3, shadowSize: 2048, ssao: true, glow: true, msaa: 4, particles: 1 },
};

/** Grading keyframes over the day: hour, then ColorCurves values and the haze colour. */
interface Grade {
  h: number;
  /** Global tint (hue, strength). */
  gHue: number;
  gDen: number;
  sat: number;
  hiHue: number;
  hiDen: number;
  hiSat: number;
  shHue: number;
  shDen: number;
  shSat: number;
  exposure: number;
  haze: [number, number, number];
}

const GRADES: Grade[] = [
  // Night: lifted so the battlefield stays readable (the moonlight pass turns it blue).
  { h: 0, gHue: 222, gDen: 0, sat: -10, hiHue: 215, hiDen: 30, hiSat: 20, shHue: 228, shDen: 45, shSat: 30, exposure: 2.1, haze: [0.04, 0.06, 0.12] },
  { h: 5, gHue: 222, gDen: 0, sat: -10, hiHue: 215, hiDen: 30, hiSat: 20, shHue: 228, shDen: 45, shSat: 30, exposure: 2.0, haze: [0.06, 0.08, 0.15] },
  // Dawn and dusk: warm highlights, violet shade (golden hour before the 18:00 nightfall).
  // Day: saturated and warm, Warcraft III's bold colours; shade leans blue.
  { h: 7, gHue: 30, gDen: 12, sat: 10, hiHue: 28, hiDen: 40, hiSat: 30, shHue: 250, shDen: 28, shSat: 14, exposure: 1.15, haze: [0.78, 0.6, 0.5] },
  { h: 9.5, gHue: 40, gDen: 3, sat: 12, hiHue: 42, hiDen: 16, hiSat: 14, shHue: 220, shDen: 16, shSat: 10, exposure: 1.12, haze: [0.7, 0.78, 0.86] },
  { h: 15, gHue: 40, gDen: 3, sat: 12, hiHue: 42, hiDen: 16, hiSat: 14, shHue: 220, shDen: 16, shSat: 10, exposure: 1.12, haze: [0.7, 0.78, 0.86] },
  { h: 17, gHue: 25, gDen: 15, sat: 12, hiHue: 24, hiDen: 45, hiSat: 32, shHue: 255, shDen: 30, shSat: 15, exposure: 1.15, haze: [0.85, 0.58, 0.45] },
  { h: 18.6, gHue: 222, gDen: 0, sat: -10, hiHue: 215, hiDen: 30, hiSat: 20, shHue: 228, shDen: 45, shSat: 30, exposure: 2.0, haze: [0.08, 0.08, 0.16] },
  { h: 24, gHue: 222, gDen: 0, sat: -10, hiHue: 215, hiDen: 30, hiSat: 20, shHue: 228, shDen: 45, shSat: 30, exposure: 2.1, haze: [0.04, 0.06, 0.12] },
];

/**
 * Moonlight: at night the graded image is mapped onto a blue luminance ramp, as in Warcraft III,
 * while bright saturated lights (fires, magic, team colours) keep some of their colour. Babylon's
 * ColorCurves can't do this: their tint multiplies the colour, so green grass stays green.
 */
Effect.ShadersStore['moonlightFragmentShader'] = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float uNight;
void main() {
  vec3 c = texture2D(textureSampler, vUV).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 moon = l * vec3(0.66, 0.84, 1.3) + vec3(0.0, 0.012, 0.035);
  float hi = max(c.r, max(c.g, c.b));
  float vivid = smoothstep(0.25, 0.6, (hi - min(c.r, min(c.g, c.b))) * hi);
  vec3 graded = mix(moon, c, 0.22 + 0.55 * vivid);
  gl_FragColor = vec4(mix(c, graded, uNight), 1.0);
}`;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Hue interpolation along the shorter way round. */
const lerpHue = (a: number, b: number, t: number): number => {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return (a + d * t + 360) % 360;
};

function gradeAt(hour: number): Grade {
  let i = 0;
  while (i < GRADES.length - 2 && GRADES[i + 1]!.h <= hour) i++;
  const a = GRADES[i]!;
  const b = GRADES[i + 1]!;
  const t = Math.max(0, Math.min(1, (hour - a.h) / (b.h - a.h)));
  return {
    h: hour,
    gHue: lerpHue(a.gHue, b.gHue, t),
    gDen: lerp(a.gDen, b.gDen, t),
    sat: lerp(a.sat, b.sat, t),
    hiHue: lerpHue(a.hiHue, b.hiHue, t),
    hiDen: lerp(a.hiDen, b.hiDen, t),
    hiSat: lerp(a.hiSat, b.hiSat, t),
    shHue: lerpHue(a.shHue, b.shHue, t),
    shDen: lerp(a.shDen, b.shDen, t),
    shSat: lerp(a.shSat, b.shSat, t),
    exposure: lerp(a.exposure, b.exposure, t),
    haze: [0, 1, 2].map((k) => lerp(a.haze[k]!, b.haze[k]!, t)) as [number, number, number],
  };
}

/** Haze for shaders that don't use scene fog (the water): colour, start, end. */
export interface HazeState {
  enabled: boolean;
  color: Color3;
  start: number;
  end: number;
}

export class Graphics {
  quality: Quality = 'high';
  private preset: Preset = PRESETS.high;
  private pipeline: DefaultRenderingPipeline | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;
  private glow: GlowLayer | null = null;
  private shadows: CascadedShadowGenerator | null = null;
  private moonlight: PostProcess | null = null;
  private night = 0;
  private readonly casters = new Set<AbstractMesh>();
  private readonly receivers = new Set<AbstractMesh>();
  /** Meshes with emissive parts: the glow layer renders only these (not the whole scene again). */
  private readonly glowing = new Set<AbstractMesh>();
  private readonly curves = new ColorCurves();
  readonly haze: HazeState = { enabled: false, color: new Color3(), start: 0, end: 1 };

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly sun: DirectionalLight,
  ) {}

  /** True while materials output linear colour into the HDR pipeline. */
  get linear(): boolean {
    return this.preset.post;
  }

  /** Share of particles to spawn at this quality. */
  get particleDensity(): number {
    return this.preset.particles;
  }

  setQuality(q: Quality): void {
    if (!PRESETS[q]) q = 'high';
    this.quality = q;
    this.preset = PRESETS[q];
    // Low keeps the original flat-coloured look.
    if (PainterlyPlugin.enabled !== this.preset.post) {
      PainterlyPlugin.enabled = this.preset.post;
      for (const s of this.scene.getEngine().scenes) s.markAllMaterialsAsDirty(Constants.MATERIAL_AllDirtyFlag);
    }
    this.rebuild();
  }

  /** Meshes (or instances) that cast shadows; removed again when disposed. */
  addCaster(mesh: AbstractMesh): void {
    if (this.casters.has(mesh)) return;
    this.casters.add(mesh);
    this.shadows?.addShadowCaster(mesh, false);
    mesh.onDisposeObservable.addOnce(() => this.removeCaster(mesh));
  }

  removeCaster(mesh: AbstractMesh): void {
    if (!this.casters.delete(mesh)) return;
    this.shadows?.removeShadowCaster(mesh, false);
  }

  /** A mesh (or instance source) that glows. */
  addGlow(mesh: AbstractMesh): void {
    if (this.glowing.has(mesh)) return;
    this.glowing.add(mesh);
    this.glow?.addIncludedOnlyMesh(mesh as Mesh);
    mesh.onDisposeObservable.addOnce(() => this.glowing.delete(mesh));
  }

  /** Meshes that receive shadows (instances follow their source mesh). */
  addReceiver(mesh: AbstractMesh): void {
    this.receivers.add(mesh);
    mesh.receiveShadows = this.preset.cascades > 0;
    mesh.onDisposeObservable.addOnce(() => this.receivers.delete(mesh));
  }

  private rebuild(): void {
    const p = this.preset;
    const scene = this.scene;
    this.pipeline?.dispose();
    this.pipeline = null;
    this.ssao?.dispose();
    this.ssao = null;
    this.glow?.dispose();
    this.glow = null;
    this.shadows?.dispose();
    this.shadows = null;
    this.moonlight?.dispose(this.camera);
    this.moonlight = null;

    if (p.cascades > 0) {
      const csm = new CascadedShadowGenerator(p.shadowSize, this.sun);
      csm.numCascades = p.cascades;
      csm.lambda = 0.75;
      csm.stabilizeCascades = true;
      csm.depthClamp = true;
      csm.cascadeBlendPercentage = 0.08;
      csm.usePercentageCloserFiltering = true;
      csm.filteringQuality = p.cascades >= 3 ? ShadowGenerator.QUALITY_HIGH : ShadowGenerator.QUALITY_MEDIUM;
      csm.bias = 0.004;
      csm.normalBias = 0.015;
      csm.darkness = 0;
      for (const m of this.casters) csm.addShadowCaster(m, false);
      this.cullCascades(csm);
      this.shadows = csm;
    }
    for (const m of this.receivers) m.receiveShadows = p.cascades > 0;

    if (p.ssao) {
      const ssao = new SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [this.camera]);
      ssao.radius = 1.6;
      ssao.totalStrength = 1.1;
      ssao.base = 0.15;
      ssao.samples = 12;
      ssao.maxZ = 220;
      ssao.expensiveBlur = true;
      this.ssao = ssao;
    }

    if (p.glow) {
      const glow = new GlowLayer('glow', scene, { mainTextureRatio: 0.5, blurKernelSize: 48 });
      glow.intensity = 0.55;
      for (const m of this.glowing) glow.addIncludedOnlyMesh(m as Mesh);
      this.glow = glow;
    }

    if (p.post) {
      const pl = new DefaultRenderingPipeline('reforged', true, scene, [this.camera]);
      pl.samples = p.msaa;
      pl.fxaaEnabled = p.msaa <= 1;
      pl.bloomEnabled = true;
      pl.bloomThreshold = 0.82;
      pl.bloomWeight = 0.28;
      pl.bloomKernel = 64;
      pl.bloomScale = 0.5;
      pl.sharpenEnabled = true;
      pl.sharpen.edgeAmount = 0.22;
      pl.sharpen.colorAmount = 1;
      pl.imageProcessingEnabled = true;
      const ip = pl.imageProcessing;
      ip.toneMappingEnabled = true;
      // Khronos PBR Neutral keeps hues and saturation (ACES greys out bold colours).
      ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
      ip.contrast = 1.15;
      ip.colorCurvesEnabled = true;
      ip.colorCurves = this.curves;
      ip.vignetteEnabled = true;
      ip.vignetteWeight = 1.6;
      ip.vignetteStretch = 0.4;
      ip.vignetteColor = new Color4(0, 0, 0, 0);
      ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
      this.pipeline = pl;
      // After the pipeline, on its graded, gamma-encoded output.
      const moon = new PostProcess('moonlight', 'moonlight', ['uNight'], null, 1, this.camera);
      moon.onApply = (effect) => effect.setFloat('uNight', this.night);
      this.moonlight = moon;
      scene.fogMode = Scene.FOGMODE_LINEAR;
    } else {
      scene.fogMode = Scene.FOGMODE_NONE;
    }
    this.haze.enabled = p.post;
  }

  /**
   * Per-cascade caster culling. Babylon's CascadedShadowGenerator draws every caster into every
   * cascade; this keeps those whose bounding sphere touches the cascade's light frustum (sides and
   * far plane only: with depth clamping, casters between the sun and the cascade still count).
   */
  private cullCascades(csm: CascadedShadowGenerator): void {
    const map = csm.getShadowMap();
    if (!map) return;
    const planes = Frustum.GetPlanes(Matrix.Identity());
    const list: AbstractMesh[] = [];
    map.getCustomRenderList = (layer, renderList, length) => {
      const tm = csm.getCascadeTransformMatrix(layer);
      if (!tm || !renderList) return null;
      Frustum.GetPlanesToRef(tm, planes);
      list.length = 0;
      for (let i = 0; i < length; i++) {
        const m = renderList[i] as AbstractMesh;
        const bs = m.getBoundingInfo().boundingSphere;
        let inside = true;
        for (let p = 1; p < 6 && inside; p++) if (planes[p]!.dotCoordinate(bs.centerWorld) < -bs.radiusWorld) inside = false;
        if (inside) list.push(m);
      }
      return list;
    };
  }

  /** Per frame: grading and haze follow the time of day; the haze range follows the zoom. */
  update(hour: number, cameraDistance: number): void {
    if (!this.pipeline) return;
    const g = gradeAt(((hour % 24) + 24) % 24);
    const c = this.curves;
    c.globalHue = g.gHue;
    c.globalDensity = g.gDen;
    c.globalSaturation = g.sat;
    c.highlightsHue = g.hiHue;
    c.highlightsDensity = g.hiDen;
    c.highlightsSaturation = g.hiSat;
    c.shadowsHue = g.shHue;
    c.shadowsDensity = g.shDen;
    c.shadowsSaturation = g.shSat;
    this.pipeline.imageProcessing.exposure = g.exposure;
    const h = ((hour % 24) + 24) % 24;
    this.night = 0.85 * Math.max(1 - smooth(5, 6.6, h), smooth(17.6, 19, h));
    // Haze: none in the foreground, about a fifth at the top of the screen at any zoom.
    const s = this.scene;
    s.fogColor.set(g.haze[0], g.haze[1], g.haze[2]);
    // Shadows only as far as the RTS camera sees (the top of the screen is ~1.5× the camera
    // distance away); the default (the camera's 400-unit far plane) would put most of the map's
    // forests in the far cascade.
    if (this.shadows) {
      const maxZ = Math.round(cameraDistance * 2.2 + 20);
      if (Math.abs(this.shadows.shadowMaxZ - maxZ) > 4) this.shadows.shadowMaxZ = maxZ;
    }
    s.fogStart = cameraDistance * 1.05;
    s.fogEnd = cameraDistance * 3.2;
    this.haze.color.copyFrom(s.fogColor);
    this.haze.start = s.fogStart;
    this.haze.end = s.fogEnd;
  }

  /** Sun and sky strength for this quality: more contrast between light and shade with HDR. */
  get keyBoost(): number {
    return this.preset.post ? 1.25 : 1;
  }

  get fillBoost(): number {
    return this.preset.post ? 0.98 : 1;
  }

  dispose(): void {
    this.moonlight?.dispose(this.camera);
    this.pipeline?.dispose();
    this.ssao?.dispose();
    this.glow?.dispose();
    this.shadows?.dispose();
  }
}
