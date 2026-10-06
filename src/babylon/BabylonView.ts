// The game's view on Babylon.js. It kept the public interface of the original three.js `View`, so
// main.ts, the input code, the HUD, the minimap and the overlay carried over unchanged.
//
// Everything it draws is Babylon: terrain, units, effects, projectiles, previews, and the HUD's
// icons and portrait (UiRenderer).
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import type { Plane } from '@babylonjs/core/Maths/math.plane';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';
import { createBabylon } from './engine';
import { RTSCamera, type GroundPoint } from './RTSCamera';
import { TerrainView, RoadView } from './TerrainView';
import { FogOfWar, registerFogOfWar } from './FogOfWar';
import { registerLinearLighting } from './Lighting';
import { ModelLibrary, type ModelInstance } from './ModelLibrary';
import { CharacterLibrary } from './Characters';
import { UnitAssets, UnitView, ItemView, quatFromEulerXYZ } from './UnitView';
import { ITEMS } from '../data/items.ts';
import { Effects } from './Effects';
import { MergedModelPlugin } from './MergedModel';
import { prepareGroundTextures } from './GroundMaterial';
import { prepareFoliageTexture } from './Foliage';
import { ProjectileView } from './Projectiles';
import { Previews } from './Previews';
import { UiRenderer } from './UiRenderer';
import { Graphics, QUALITIES, type Quality } from './Graphics';
import { ParticleFx, type BurningSite } from './Particles';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Game } from '../game/game.ts';
import type { Unit } from '../game/unit.ts';
import type { GroundItem } from '../game/types.ts';

export interface ScreenPoint {
  x: number;
  y: number;
  behind: boolean;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const QUALITY_KEY = 'he3d.quality';

/** The chosen quality preset: `?quality=low|medium|high` (tests, screenshots), else the saved one. */
function chosenQuality(): Quality | null {
  const q = new URLSearchParams(location.search).get('quality');
  if (q && (QUALITIES as string[]).includes(q)) return q as Quality;
  try {
    const s = localStorage.getItem(QUALITY_KEY);
    if (s && (QUALITIES as string[]).includes(s)) return s as Quality;
  } catch {
    /* storage unavailable */
  }
  return null;
}

export class BabylonView {
  readonly canvas: HTMLCanvasElement;
  readonly engine: Engine;
  readonly bscene: Scene;
  readonly cam: RTSCamera;
  width = 1;
  height = 1;
  game: Game | null = null;

  private readonly hemi: HemisphericLight;
  private readonly sun: DirectionalLight;
  /** Post-processing, shadows and quality presets (M8). */
  readonly graphics: Graphics;
  /** GPU particles (explosions, spells, burning buildings). */
  readonly particles: ParticleFx;
  private burnCheck = 0;
  /** First-run frame-rate check (see the constructor). */
  private autoQuality: { warm: number; time: number; frames: number } | null = null;
  private lastFrameAt = 0;
  /**
   * Frames left before material change tracking resumes (High). While the models load and the
   * first game's world is built, each new material makes the prepass renderer re-flag every
   * submesh in the scene (materials × meshes, seconds per pass on SwiftShader); one full refresh at
   * the end costs a fraction of that.
   */
  private settling = 3;
  /** Called when the first-run check settles on a lower preset. */
  onQualityLowered: ((q: Quality) => void) | null = null;
  private instrumentation: SceneInstrumentation | null = null;
  private readonly frustum: Plane[] = Frustum.GetPlanes(new Matrix());
  private readonly sphereCenter = new Vector3();
  private readonly toSun = new Vector3();
  private readonly sunColor = new Color3();
  private terrainView: TerrainView | null = null;
  private roadView: RoadView | null = null;
  private fog: FogOfWar | null = null;
  private citadel: ModelInstance[] = [];
  private models: ModelLibrary | null = null;
  private characters: CharacterLibrary | null = null;
  private unitAssets: UnitAssets | null = null;
  readonly unitViews = new Map<number, UnitView>();
  /** Visual effects (the game's `hooks.fx`). */
  fx: Effects | null = null;
  private projectileView: ProjectileView | null = null;
  /** Placement ghost and line preview (used by src/input.ts); set once the models are loaded. */
  previews!: Previews;
  private ui!: UiRenderer;
  readonly itemViews = new Map<GroundItem, ItemView>();
  /** Resolves when the baked models are loaded; main.ts waits for it before starting a game. */
  readonly ready: Promise<void>;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const { engine, scene } = createBabylon(canvas);
    this.engine = engine;
    this.bscene = scene;
    this.cam = new RTSCamera(scene);
    scene.activeCamera = this.cam.camera;
    // Before any material is created: every material gets three.js-style lighting and the fog of
    // war.
    registerLinearLighting();
    registerFogOfWar();

    this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    this.sun = new DirectionalLight('sun', new Vector3(-0.4, -1, -0.4), scene);
    this.graphics = new Graphics(scene, this.cam.camera, this.sun);
    const chosen = chosenQuality();
    this.graphics.setQuality(chosen ?? 'high');
    // With High's prepass (for SSAO), hold material change tracking until the first game frames are
    // drawn (see `settling`); without it the final refresh would cost more than it saves.
    scene.blockMaterialDirtyMechanism = !!scene.prePassRenderer;
    // First run: start on High and step down if the frame rate is low (once; the result is saved).
    if (!chosen) this.autoQuality = { warm: 2.5, time: 0, frames: 0 };
    this.particles = new ParticleFx(scene, () => this.graphics.particleDensity);
    this.ready = Promise.all([ModelLibrary.load(scene), UiRenderer.create(engine), CharacterLibrary.load(scene)]).then(([lib, ui, chars]) => {
      this.models = lib;
      lib.onCaster = (m) => this.graphics.addCaster(m);
      for (const m of lib.receivers) this.graphics.addReceiver(m);
      for (const m of lib.glowSources) this.graphics.addGlow(m);
      chars.onCaster = (m) => this.graphics.addCaster(m);
      chars.onSource = (m) => this.graphics.addReceiver(m);
      this.characters = chars;
      this.unitAssets = new UnitAssets(scene, lib, chars);
      this.unitAssets.inView = (x, y, z, r) => this.inView(x, y, z, r);
      this.previews = new Previews(scene, lib, chars);
      this.ui = ui;
      // The painted ground and foliage textures (M13), so the first game frame doesn't wait for them.
      prepareGroundTextures();
      prepareFoliageTexture();
    });

    this.resize();
    (window as unknown as { __babylon: unknown }).__babylon = { engine, scene, view: this };
  }

  /** Could a sphere at (x, y, z) of radius r be on screen? */
  inView(x: number, y: number, z: number, r: number): boolean {
    const c = this.sphereCenter.set(x, y, z);
    for (const p of this.frustum) if (p.dotCoordinate(c) < -r) return false;
    return true;
  }

  // ---- Performance readout (M9) --------------------------------------------------------------------
  /** Per-frame renderer statistics (instrumentation starts on the first call). */
  perfStats(): { drawCalls: number; activeMeshes: number; meshes: number; evalMs: number; renderMs: number; frameMs: number } {
    if (!this.instrumentation) {
      const i = new SceneInstrumentation(this.bscene);
      i.captureFrameTime = true;
      i.captureRenderTime = true;
      i.captureActiveMeshesEvaluationTime = true;
      this.instrumentation = i;
    }
    const i = this.instrumentation;
    return {
      drawCalls: i.drawCallsCounter.current,
      activeMeshes: this.bscene.getActiveMeshes().length,
      meshes: this.bscene.meshes.length,
      evalMs: i.activeMeshesEvaluationTimeCounter.lastSecAverage,
      renderMs: i.renderTimeCounter.lastSecAverage,
      frameMs: i.frameTimeCounter.lastSecAverage,
    };
  }

  // ---- Graphics quality ----------------------------------------------------------------------------
  get quality(): Quality {
    return this.graphics.quality;
  }

  /** 'low' | 'medium' | 'high' (saved for the next session). */
  setQuality(q: Quality): void {
    this.autoQuality = null; // a choice (the player's, or the first-run check's) ends the check
    this.graphics.setQuality(q);
    try {
      localStorage.setItem(QUALITY_KEY, this.graphics.quality);
    } catch {
      /* storage unavailable */
    }
  }

  // ---- HUD pictures --------------------------------------------------------------------------------
  /** Data URL icon of a model in a team colour (command card, title screen). */
  icon(modelId: string, color: number, isBuilding: boolean): string {
    return this.ui.icon(modelId, color, isBuilding);
  }

  /** The animated 3D portrait shown in the console element. */
  createPortrait(element: HTMLElement) {
    this.ui.portrait.attach(element);
    return this.ui.portrait;
  }

  // ---- Game hooks --------------------------------------------------------------------------------
  attachGame(game: Game): void {
    this.game = game;
    this.fx?.clear();
    this.projectileView?.clear();
    this.particles.clear();
    this.fx = new Effects(game, this.bscene);
    this.fx.particles = this.particles;
    this.projectileView = new ProjectileView(game, this.fx);
  }

  addUnit(u: Unit): void {
    const v = new UnitView(u, this.game!, this.unitAssets!);
    u.view = v;
    this.unitViews.set(u.id, v);
  }

  removeUnit(u: Unit): void {
    this.unitViews.get(u.id)?.dispose();
    this.unitViews.delete(u.id);
    u.view = null;
  }

  changeUnit(u: Unit, modelChanged = false): void {
    if (modelChanged) this.unitViews.get(u.id)?.buildModel();
  }

  addItem(it: GroundItem): void {
    const def = (ITEMS as Record<string, { color?: string }>)[(it as { id: string }).id];
    const color = parseInt((def?.color ?? '#ffd700').replace('#', ''), 16);
    this.itemViews.set(it, new ItemView(it, this.game!, this.bscene, color));
  }

  removeItem(it: GroundItem): void {
    this.itemViews.get(it)?.dispose();
    this.itemViews.delete(it);
  }

  clearWorld(): void {
    this.fx?.clear();
    this.particles.clear();
    this.projectileView?.clear();
    for (const v of this.unitViews.values()) v.dispose();
    this.unitViews.clear();
    for (const v of this.itemViews.values()) v.dispose();
    this.itemViews.clear();
    for (const c of this.citadel) c.dispose();
    this.citadel = [];
    this.terrainView?.dispose();
    this.terrainView = null;
    this.roadView?.dispose();
    this.roadView = null;
    this.fog?.dispose();
    this.fog = null;
  }

  // ---- Frame -------------------------------------------------------------------------------------
  resize(): void {
    this.engine.resize();
    this.width = this.canvas.clientWidth || window.innerWidth;
    this.height = this.canvas.clientHeight || window.innerHeight;
    this.cam.refreshMatrices();
  }

  render(dt: number): void {
    const g = this.game;
    if (!g) return;
    this.updateWorld(g);
    this.updateLighting(g.timeOfDay);
    // Last frame's camera frustum for culling whole units (the margin covers one frame of motion).
    Frustum.GetPlanesToRef(this.cam.camera.getTransformationMatrix(), this.frustum);
    this.graphics.update(g.timeOfDay, this.cam.distance);
    for (const v of this.unitViews.values()) v.sync(dt, g.time);
    for (const v of this.itemViews.values()) v.sync(dt, g.time);
    this.fx?.update(dt);
    this.particles.update(dt);
    this.burnCheck -= dt;
    if (this.burnCheck <= 0) {
      this.burnCheck = 0.25;
      this.particles.syncBurning(this.burningSites(g));
    }
    this.projectileView?.update(dt);
    this.cam.update(g.terrain, g.shakeAmount);
    this.engine.beginFrame();
    this.bscene.render();
    this.engine.endFrame();
    if (this.settling > 0 && --this.settling === 0) this.bscene.blockMaterialDirtyMechanism = false;
    this.checkAutoQuality();
  }

  /**
   * First-run quality check: after a short warm-up, average the frame rate over six seconds of play;
   * below 45 fps drop from High to Medium, below 30 from Medium to Low, then save the result.
   */
  private checkAutoQuality(): void {
    const a = this.autoQuality;
    const now = performance.now();
    const dt = this.lastFrameAt ? Math.min(0.5, (now - this.lastFrameAt) / 1000) : 0;
    this.lastFrameAt = now;
    if (!a || !this.game || document.hidden) return;
    if (a.warm > 0) {
      a.warm -= dt;
      return;
    }
    a.time += dt;
    a.frames++;
    if (a.time < 6) return;
    const fps = a.frames / a.time;
    const q = this.graphics.quality;
    const lower: Quality | null = q === 'high' && fps < 45 ? 'medium' : q === 'medium' && fps < 30 ? 'low' : null;
    if (lower) {
      this.graphics.setQuality(lower); // saved once the check settles
      this.onQualityLowered?.(lower);
      this.autoQuality = { warm: 2.5, time: 0, frames: 0 };
    } else {
      this.setQuality(q);
      this.autoQuality = null;
    }
  }

  /** Build the terrain, road and fog visuals for a new game, then keep them in sync. */
  private updateWorld(g: Game): void {
    if (this.fog?.fog !== g.fog) {
      this.fog?.dispose();
      this.fog = new FogOfWar(g.fog, this.bscene);
    }
    this.fog.update();
    if (this.terrainView?.terrain !== g.terrain) {
      this.terrainView?.dispose();
      this.terrainView = new TerrainView(this.bscene, g.terrain);
      for (const m of this.terrainView.casters) this.graphics.addCaster(m);
      for (const m of this.terrainView.receivers) this.graphics.addReceiver(m);
      this.buildCitadel(g);
    }
    if (this.roadView?.roads !== g.roads) {
      this.roadView?.dispose();
      this.roadView = g.roads ? new RoadView(this.bscene, g.roads, g) : null;
    }
    this.terrainView.update(g.time);
    this.terrainView.setDetail(this.graphics.quality !== 'low');
    this.terrainView.updateClearMask(g.roads ?? null);
    this.terrainView.setWaterGrading(this.graphics.linear, this.cam.camera.position, this.graphics.haze);
    this.terrainView.setWaterLight(this.toSun.copyFrom(this.sun.direction).scaleInPlace(-1), this.sunColor.copyFrom(this.sun.diffuse).scaleInPlace((this.sun.intensity * Math.PI) / 2.3), this.hemi.diffuse);
    this.roadView?.update();
  }

  /**
   * Buildings below half health burn, more fiercely the closer they are to falling (only where
   * the player can see them), nearest the camera first.
   */
  private burningSites(g: Game): BurningSite[] {
    const sites: Array<BurningSite & { d: number }> = [];
    const t = this.cam.target;
    for (const v of this.unitViews.values()) {
      const u = v.unit;
      if (!u.isBuilding || u.dead || u.underConstruction || u.def.wall || u.hp >= u.maxHp * 0.5) continue;
      if (!g.fog.isVisible(u.x, u.z)) continue;
      const size = (u.def.footprint ?? 2) / 2;
      sites.push({ id: u.id, x: u.x, y: g.terrain.heightAt(u.x, u.z) + (v.height ?? 1.5) * 0.8, z: u.z, damage: 1 - (u.hp / u.maxHp) * 2, size, d: Math.hypot(u.x - t.x, u.z - t.z) });
    }
    return sites.sort((a, b) => a.d - b.d);
  }

  /** Kalenden's citadel walls and towers, from the placements in game.citadelWalls. */
  private buildCitadel(g: Game): void {
    for (const c of this.citadel) c.dispose();
    this.citadel = (g.citadelWalls ?? []).map((w, i) => {
      const m = this.models!.instantiate(w.model, w.color, `citadel-${i}`);
      m.root.position.set(w.x, w.y, w.z);
      m.root.rotationQuaternion = quatFromEulerXYZ(0, w.rotY, 0);
      return m;
    });
  }

  /**
   * Day/night cycle: the same curve and colours as the three.js view. Intensities are three.js's
   * divided by π (its Lambert BRDF); the LinearLighting plugin gamma-encodes the light per pixel.
   */
  private updateLighting(hour: number): void {
    const dayness = clamp01(Math.sin(((hour - 6) / 12) * Math.PI) * 1.4 + 0.25);
    const night = 1 - dayness;
    this.sun.intensity = ((0.55 + dayness * 1.75) / Math.PI) * this.graphics.keyBoost;
    this.sun.diffuse.set(1 - night * 0.45, 0.95 - night * 0.3, 0.85 + night * 0.15);
    this.hemi.intensity = ((0.75 + dayness * 0.55) / Math.PI) * this.graphics.fillBoost;
    this.hemi.diffuse.set(0.81 - night * 0.35, 0.9 - night * 0.3, 1.0);
    this.hemi.groundColor.set(0.35 - night * 0.15, 0.29 - night * 0.12, 0.19 + night * 0.05);
    this.hemi.specular = Color3.Black();
    // Rim light on models (MergedModel.ts): the sky's colour, by day.
    const rim = 0.22 + 0.2 * dayness;
    MergedModelPlugin.rim = [this.hemi.diffuse.r * rim, this.hemi.diffuse.g * rim, this.hemi.diffuse.b * rim];
    const ang = ((hour - 6) / 12) * Math.PI;
    const sx = Math.cos(ang) * 30;
    const sy = 45 + Math.abs(Math.sin(ang)) * 20;
    this.sun.direction.set(-sx, -sy, -25).normalize();
  }

  // ---- Screen <-> world --------------------------------------------------------------------------
  /** Project a world point to CSS pixel coordinates. */
  project(x: number, y: number, z: number, out: ScreenPoint = { x: 0, y: 0, behind: false }): ScreenPoint {
    const m = this.cam.camera.getTransformationMatrix().m;
    const cx = x * m[0]! + y * m[4]! + z * m[8]! + m[12]!;
    const cy = x * m[1]! + y * m[5]! + z * m[9]! + m[13]!;
    const cz = x * m[2]! + y * m[6]! + z * m[10]! + m[14]!;
    const cw = x * m[3]! + y * m[7]! + z * m[11]! + m[15]!;
    const w = Math.abs(cw) < 1e-6 ? 1e-6 : cw;
    out.x = ((cx / w) * 0.5 + 0.5) * this.width;
    out.y = (-(cy / w) * 0.5 + 0.5) * this.height;
    out.behind = cw <= 0 || cz / w > 1;
    return out;
  }

  screenToGround(px: number, py: number): GroundPoint | null {
    if (!this.game) return null;
    return this.cam.screenToGround((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1, this.game.terrain);
  }

  /** Screen pixels per world unit at a world point (used for picking radii). */
  pixelsPerUnit(x: number, y: number, z: number): number {
    const fovK = this.height / (2 * Math.tan(this.cam.camera.fov / 2));
    return fovK / Math.max(0.01, Vector3.Distance(this.cam.camera.position, new Vector3(x, y, z)));
  }

  /** Ground-plane polygon visible on screen (for the minimap). */
  viewPolygon(): GroundPoint[] {
    const pts: GroundPoint[] = [];
    const corners: Array<[number, number]> = [
      [0, 0],
      [this.width, 0],
      [this.width, this.height * 0.78],
      [0, this.height * 0.78],
    ];
    for (const [x, y] of corners) {
      const p = this.screenToGround(x, y);
      if (p) pts.push(p);
    }
    return pts;
  }

  isOnScreen(x: number, z: number): boolean {
    if (!this.game) return false;
    const p = this.project(x, this.game.terrain.heightAt(x, z), z);
    return !p.behind && p.x > 0 && p.y > 0 && p.x < this.width && p.y < this.height * 0.78;
  }
}
