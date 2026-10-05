// The Babylon.js view (`?renderer=babylon`). It has the same public interface as the three.js
// `View` (src/render/view.js), so main.js, the input code, the HUD, the minimap and the overlay
// work with either renderer.
//
// Everything it draws is Babylon: terrain, units, effects, projectiles, previews, and the HUD's
// icons and portrait (UiRenderer).
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
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
import { UnitAssets, UnitView, ItemView, quatFromEulerXYZ } from './UnitView';
import { ITEMS } from '../data/items.js';
import { Effects } from './Effects';
import { ProjectileView } from './Projectiles';
import { Previews } from './Previews';
import { UiRenderer } from './UiRenderer';
import { Graphics, QUALITIES, type Quality } from './Graphics';
import { ParticleFx, type BurningSite } from './Particles';
import type { GameLike, ItemLike, UnitLike } from './types';

export interface ScreenPoint {
  x: number;
  y: number;
  behind: boolean;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const QUALITY_KEY = 'he3d.quality';

/** The saved quality preset; `?quality=low|medium|high` overrides it (tests, screenshots). */
function savedQuality(): Quality {
  const q = new URLSearchParams(location.search).get('quality');
  if (q && (QUALITIES as string[]).includes(q)) return q as Quality;
  try {
    const s = localStorage.getItem(QUALITY_KEY);
    if (s && (QUALITIES as string[]).includes(s)) return s as Quality;
  } catch {
    /* storage unavailable */
  }
  return 'high';
}

export class BabylonView {
  readonly canvas: HTMLCanvasElement;
  readonly engine: Engine;
  readonly bscene: Scene;
  readonly cam: RTSCamera;
  width = 1;
  height = 1;
  game: GameLike | null = null;

  private readonly hemi: HemisphericLight;
  private readonly sun: DirectionalLight;
  /** Post-processing, shadows and quality presets (M8). */
  readonly graphics: Graphics;
  /** GPU particles (explosions, spells, burning buildings). */
  readonly particles: ParticleFx;
  private burnCheck = 0;
  private terrainView: TerrainView | null = null;
  private roadView: RoadView | null = null;
  private fog: FogOfWar | null = null;
  private citadel: ModelInstance[] = [];
  private models: ModelLibrary | null = null;
  private unitAssets: UnitAssets | null = null;
  readonly unitViews = new Map<number, UnitView>();
  /** Visual effects (the game's `hooks.fx`). */
  fx: Effects | null = null;
  private projectileView: ProjectileView | null = null;
  /** Placement ghost and line preview (used by src/input.js); set once the models are loaded. */
  previews!: Previews;
  private ui!: UiRenderer;
  readonly itemViews = new Map<ItemLike, ItemView>();
  /** Resolves when the baked models are loaded; main.js waits for it before starting a game. */
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
    this.graphics.setQuality(savedQuality());
    this.particles = new ParticleFx(scene, () => this.graphics.particleDensity);
    this.ready = Promise.all([ModelLibrary.load(scene), UiRenderer.create(engine)]).then(([lib, ui]) => {
      this.models = lib;
      lib.onCaster = (m) => this.graphics.addCaster(m);
      for (const m of lib.receivers) this.graphics.addReceiver(m);
      this.unitAssets = new UnitAssets(scene, lib);
      this.previews = new Previews(scene, lib);
      this.ui = ui;
    });

    this.resize();
    (window as unknown as { __babylon: unknown }).__babylon = { engine, scene, view: this };
  }

  // ---- Graphics quality ----------------------------------------------------------------------------
  get quality(): Quality {
    return this.graphics.quality;
  }

  /** 'low' | 'medium' | 'high' (saved for the next session). */
  setQuality(q: Quality): void {
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
  attachGame(game: GameLike): void {
    this.game = game;
    this.fx?.clear();
    this.projectileView?.clear();
    this.particles.clear();
    this.fx = new Effects(game, this.bscene);
    this.fx.particles = this.particles;
    this.projectileView = new ProjectileView(game as never, this.fx);
  }

  addUnit(u: UnitLike): void {
    const v = new UnitView(u as never, this.game as never, this.unitAssets!);
    u.view = v;
    this.unitViews.set(u.id, v);
  }

  removeUnit(u: UnitLike): void {
    this.unitViews.get(u.id)?.dispose();
    this.unitViews.delete(u.id);
    u.view = null;
  }

  changeUnit(u: UnitLike, modelChanged: boolean): void {
    if (modelChanged) this.unitViews.get(u.id)?.buildModel();
  }

  addItem(it: ItemLike): void {
    const def = (ITEMS as Record<string, { color?: string }>)[(it as { id: string }).id];
    const color = parseInt((def?.color ?? '#ffd700').replace('#', ''), 16);
    this.itemViews.set(it, new ItemView(it as never, this.game as never, this.bscene, color));
  }

  removeItem(it: ItemLike): void {
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
  }

  /** Build the terrain, road and fog visuals for a new game, then keep them in sync. */
  private updateWorld(g: GameLike): void {
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
    this.terrainView.setWaterGrading(this.graphics.linear, this.cam.camera.position, this.graphics.haze);
    this.roadView?.update();
  }

  /**
   * Buildings below half health burn, more fiercely the closer they are to falling (only where
   * the player can see them), nearest the camera first.
   */
  private burningSites(g: GameLike): BurningSite[] {
    const sites: Array<BurningSite & { d: number }> = [];
    const t = this.cam.target;
    for (const v of this.unitViews.values()) {
      const u = v.unit as unknown as { id: number; x: number; z: number; hp: number; maxHp: number; isBuilding?: boolean; dead?: boolean; underConstruction?: boolean; def: { footprint?: number; wall?: boolean } };
      if (!u.isBuilding || u.dead || u.underConstruction || u.def.wall || u.hp >= u.maxHp * 0.5) continue;
      if (!g.fog.isVisible(u.x, u.z)) continue;
      const size = (u.def.footprint ?? 2) / 2;
      sites.push({ id: u.id, x: u.x, y: g.terrain.heightAt(u.x, u.z) + (v.height ?? 1.5) * 0.8, z: u.z, damage: 1 - (u.hp / u.maxHp) * 2, size, d: Math.hypot(u.x - t.x, u.z - t.z) });
    }
    return sites.sort((a, b) => a.d - b.d);
  }

  /** Kalenden's citadel walls and towers, from the placements in game.citadelWalls. */
  private buildCitadel(g: GameLike): void {
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
