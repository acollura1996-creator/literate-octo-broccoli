// The Babylon.js view (`?renderer=babylon`). It has the same public interface as the three.js
// `View` (src/render/view.js), so main.js, the input code, the HUD, the minimap and the overlay
// work with either renderer.
//
// Migration strategy: the parts not ported yet keep running on a hidden three.js view (`legacy`),
// which is updated every frame but never drawn. It still supplies what the game and HUD expect
// from it today (effect and projectile timers, command-card icons). Each milestone moves another
// part onto Babylon; MIGRATION.md tracks what is left, and M12 removes `legacy`.
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';
import { View as LegacyView } from '../render/view.js';
import { createBabylon } from './engine';
import { RTSCamera, type GroundPoint } from './RTSCamera';
import { TerrainView, RoadView } from './TerrainView';
import { FogOfWar, registerFogOfWar } from './FogOfWar';
import { registerLinearLighting } from './Lighting';
import { ModelLibrary, type ModelInstance } from './ModelLibrary';
import { UnitAssets, UnitView, ItemView, quatFromEulerXYZ } from './UnitView';
import { ITEMS } from '../data/items.js';
import type { GameLike, ItemLike, UnitLike } from './types';

export interface ScreenPoint {
  x: number;
  y: number;
  behind: boolean;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export class BabylonView {
  readonly canvas: HTMLCanvasElement;
  readonly engine: Engine;
  readonly bscene: Scene;
  readonly cam: RTSCamera;
  readonly legacy: LegacyView;
  width = 1;
  height = 1;
  game: GameLike | null = null;

  private readonly hemi: HemisphericLight;
  private readonly sun: DirectionalLight;
  private terrainView: TerrainView | null = null;
  private roadView: RoadView | null = null;
  private fog: FogOfWar | null = null;
  private citadel: ModelInstance[] = [];
  private models: ModelLibrary | null = null;
  private unitAssets: UnitAssets | null = null;
  readonly unitViews = new Map<number, UnitView>();
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
    this.ready = ModelLibrary.load(scene).then((lib) => {
      this.models = lib;
      this.unitAssets = new UnitAssets(scene, lib);
    });

    // The hidden three.js view: an offscreen canvas that is never shown or drawn to.
    const off = document.createElement('canvas');
    off.width = 1;
    off.height = 1;
    this.legacy = new LegacyView(off);
    this.legacy.renderer.setSize(1, 1, false);
    this.legacy.drawsWorld = false; // terrain, roads and fog are drawn here

    this.resize();
    (window as unknown as { __babylon: unknown }).__babylon = { engine, scene, view: this };
  }

  // ---- Parts still served by the legacy view (see MIGRATION.md) --------------------------------
  /** three.js renderer, still used for command-card icons until M6. */
  get renderer() {
    return this.legacy.renderer;
  }

  /** three.js scene the simulation still adds meshes to until M5 (never drawn). */
  get scene() {
    return this.legacy.scene;
  }

  get fx() {
    return this.legacy.fx;
  }

  get projectiles() {
    return this.legacy.projectiles;
  }

  // ---- Game hooks --------------------------------------------------------------------------------
  attachGame(game: GameLike): void {
    this.game = game;
    this.legacy.attachGame(game);
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
    this.legacy.clearWorld();
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
    // Legacy pass: animation state, visibility, effect and projectile timers (not drawn).
    this.legacy.cam.target.set(this.cam.target.x, this.cam.target.y, this.cam.target.z);
    this.legacy.update(dt);

    this.updateWorld(g);
    this.updateLighting(g.timeOfDay);
    for (const v of this.unitViews.values()) v.sync(dt, g.time);
    for (const v of this.itemViews.values()) v.sync(dt, g.time);
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
      this.buildCitadel(g);
    }
    if (this.roadView?.roads !== g.roads) {
      this.roadView?.dispose();
      this.roadView = g.roads ? new RoadView(this.bscene, g.roads, g) : null;
    }
    this.terrainView.update(g.time);
    this.roadView?.update();
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
    this.sun.intensity = (0.55 + dayness * 1.75) / Math.PI;
    this.sun.diffuse.set(1 - night * 0.45, 0.95 - night * 0.3, 0.85 + night * 0.15);
    this.hemi.intensity = (0.75 + dayness * 0.55) / Math.PI;
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
