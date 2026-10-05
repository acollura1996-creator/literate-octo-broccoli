// Model pictures for the HUD on Babylon: command-card icons and the live 3D portrait (Warcraft III's
// talking head). A port of src/ui/icons.js.
//
// Both use a separate scene on the game's engine, with their own copy of the baked models, lights
// and no fog of war.
// - Icons render once per model and colour into a render target, are read back, composited on the
//   icon gradient and cached as data URLs.
// - The portrait renders each frame into the main canvas right under the portrait box (which the
//   box covers anyway), and that region is copied into the box's own canvas. No second WebGL
//   context and no pixel readback.
import { Scene } from '@babylonjs/core/scene';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/core/Engines/Extensions/engine.readTexture';
import { ModelLibrary, type ModelInstance, type ModelParts } from './ModelLibrary';
import type { FogOfWarPlugin } from './FogOfWar';
import { quatFromEulerXYZ, eulerXYZFromQuat } from './UnitView';

const ICON_SIZE = 96;
const DEG = Math.PI / 180;

interface UnitLike {
  id: number;
  modelId: string;
  isBuilding: boolean;
  owner: { color: number };
  def: { modelColor?: number };
}

/** Frame a model nicely: whole thing for buildings, upper body for units (as in icons.js). */
function frame(cam: TargetCamera, m: ModelInstance, isBuilding: boolean, portrait = false): void {
  m.root.computeWorldMatrix(true);
  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of m.meshes) {
    mesh.computeWorldMatrix(true);
    const bb = mesh.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, bb.minimumWorld);
    max = Vector3.Maximize(max, bb.maximumWorld);
  }
  if (!m.meshes.length) {
    min = new Vector3(-0.5, 0, -0.5);
    max = new Vector3(0.5, 1, 0.5);
  }
  const size = max.subtract(min);
  const center = min.add(max).scale(0.5);
  let focusY: number;
  let span: number;
  if (isBuilding) {
    focusY = center.y;
    span = Math.max(size.x, size.y, size.z) * 1.05;
  } else {
    focusY = min.y + size.y * (portrait ? 0.72 : 0.62);
    span = Math.max(size.y * (portrait ? 0.62 : 0.85), size.x * 0.7);
  }
  const dist = span / (2 * Math.tan(cam.fov / 2)) + 0.3;
  const dir = new Vector3(0.45, isBuilding ? 0.55 : 0.18, 1).normalize();
  cam.position.set(center.x + dir.x * dist, focusY + dir.y * dist, center.z + dir.z * dist);
  cam.setTarget(new Vector3(center.x, focusY, center.z));
}

const hex3 = (c: number): Color3 => Color3.FromHexString(`#${c.toString(16).padStart(6, '0')}`);

/**
 * One light rig for icons and the portrait, re-set before each picture: three.js used two scenes
 * with different lights, but here the lights' count must stay fixed so the shaders, compiled once
 * up front, can be drawn synchronously. Intensities are three.js's over π (see Lighting.ts).
 */
class LightRig {
  private readonly hemi: HemisphericLight;
  private readonly key: DirectionalLight;
  private readonly rim: DirectionalLight;

  constructor(scene: Scene) {
    this.hemi = new HemisphericLight('ui-hemi', new Vector3(0, 1, 0), scene);
    this.key = new DirectionalLight('ui-key', new Vector3(0, -1, 0), scene);
    this.rim = new DirectionalLight('ui-rim', new Vector3(0, -1, 0), scene);
    for (const l of [this.hemi, this.key, this.rim]) l.specular = Color3.Black();
  }

  /** Point a directional light from `from` toward the origin (three.js light placement). */
  private aim(l: DirectionalLight, from: Vector3, color: number, intensity: number): void {
    l.direction = from.scale(-1).normalize();
    l.diffuse = hex3(color);
    l.intensity = intensity / Math.PI;
  }

  /** icons.js icon scene: hemisphere 1.6, white key light 2.2 from (2, 4, 5). */
  icon(): void {
    this.hemi.diffuse = hex3(0xffffff);
    this.hemi.groundColor = hex3(0x404040);
    this.hemi.intensity = 1.6 / Math.PI;
    this.aim(this.key, new Vector3(2, 4, 5), 0xffffff, 2.2);
    this.rim.intensity = 0;
  }

  /** icons.js portrait scene: cool hemisphere 1.5, warm key 2.4, blue rim 1.2 from behind. */
  portrait(): void {
    this.hemi.diffuse = hex3(0xdde8ff);
    this.hemi.groundColor = hex3(0x2a2018);
    this.hemi.intensity = 1.5 / Math.PI;
    this.aim(this.key, new Vector3(3, 4, 4), 0xffe2b8, 2.4);
    this.aim(this.rim, new Vector3(-4, 2, -3), 0x88aaff, 1.2);
  }
}

export class UiRenderer {
  private readonly cache = new Map<string, string>();
  private readonly iconCam: TargetCamera;
  private readonly rtt: RenderTargetTexture;
  readonly lights: LightRig;
  readonly portrait: Portrait;

  private constructor(
    readonly engine: Engine,
    readonly scene: Scene,
    readonly models: ModelLibrary,
  ) {
    this.lights = new LightRig(scene);
    this.iconCam = new TargetCamera('icon-cam', Vector3.Zero(), scene);
    this.iconCam.fov = 30 * DEG;
    this.iconCam.minZ = 0.1;
    this.iconCam.maxZ = 100;
    // Square icons: fix the projection (the render target pass would otherwise use the main
    // canvas's aspect ratio).
    this.iconCam.freezeProjectionMatrix(Matrix.PerspectiveFovRH(this.iconCam.fov, 1, 0.1, 100, engine.isNDCHalfZRange));
    this.rtt = new RenderTargetTexture('icon', { width: ICON_SIZE, height: ICON_SIZE }, scene, { generateMipMaps: false });
    this.rtt.samples = 4;
    this.rtt.activeCamera = this.iconCam;
    this.rtt.clearColor = new Color4(0, 0, 0, 0);
    this.rtt.renderParticles = false;
    this.portrait = new Portrait(this);
  }

  static async create(engine: Engine): Promise<UiRenderer> {
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    scene.autoClear = false;
    scene.autoClearDepthAndStencil = false;
    scene.detachControl();
    const models = await ModelLibrary.load(scene);
    // No fog of war on HUD pictures.
    for (const m of scene.materials) {
      const fog = m.pluginManager?.getPlugin('FogOfWar') as FogOfWarPlugin | null;
      if (fog) fog.fogEnabled = false;
    }
    const ui = new UiRenderer(engine, scene, models);
    // Compile every model shader now (Babylon compiles asynchronously), so icons can be drawn and
    // read back synchronously, as the HUD expects.
    await Promise.all(
      scene.meshes
        .filter((m) => m.material && m.getTotalVertices() > 0)
        .map((m) => m.material!.forceCompilationAsync(m, { useInstances: true }).catch(() => undefined)),
    );
    return ui;
  }

  /** Data URL icon for a model id rendered with a team colour (cached). */
  icon(modelId: string, color: number, isBuilding: boolean): string {
    const key = `${modelId}|${color}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const m = this.models.instantiate(modelId, color, `icon-${modelId}`);
    this.lights.icon();
    frame(this.iconCam, m, isBuilding);
    this.iconCam.getViewMatrix(true);
    this.rtt.renderList = m.meshes;
    this.rtt.render();
    const engine = this.engine as unknown as {
      _readTexturePixelsSync(t: unknown, w: number, h: number): ArrayBufferView;
    };
    const buf = new Uint8Array((engine._readTexturePixelsSync(this.rtt.getInternalTexture(), ICON_SIZE, ICON_SIZE) as Uint8Array).buffer.slice(0));
    m.dispose();

    const canvas = document.createElement('canvas');
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const ctx = canvas.getContext('2d')!;
    // Background gradient like a Warcraft III icon.
    const grd = ctx.createLinearGradient(0, 0, 0, ICON_SIZE);
    grd.addColorStop(0, '#3b3f4a');
    grd.addColorStop(1, '#12141a');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
    const img = ctx.createImageData(ICON_SIZE, ICON_SIZE);
    // Flip vertically (GL origin is bottom-left).
    for (let y = 0; y < ICON_SIZE; y++) {
      const src = (ICON_SIZE - 1 - y) * ICON_SIZE * 4;
      img.data.set(buf.subarray(src, src + ICON_SIZE * 4), y * ICON_SIZE * 4);
    }
    const tmp = document.createElement('canvas');
    tmp.width = ICON_SIZE;
    tmp.height = ICON_SIZE;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    ctx.drawImage(tmp, 0, 0);
    const url = canvas.toDataURL();
    this.cache.set(key, url);
    return url;
  }
}

/** The animated 3D portrait in the console (icons.js Portrait, same framing and idle motion). */
export class Portrait {
  private el: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private readonly cam: TargetCamera;
  private current: string | null = null;
  private model: ModelInstance | null = null;
  private unit: UnitLike | null = null;
  private rest = new Map<TransformNode, [number, number, number]>();
  private baseScale = new Map<TransformNode, number>();

  constructor(private readonly ui: UiRenderer) {
    this.cam = new TargetCamera('portrait-cam', Vector3.Zero(), ui.scene);
    this.cam.fov = 28 * DEG;
    this.cam.minZ = 0.05;
    this.cam.maxZ = 100;
  }

  /** The console element to fill (the three.js version is given it in its constructor). */
  attach(element: HTMLElement): void {
    this.el = element;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'portrait-canvas';
    element.appendChild(this.canvas);
  }

  show(unit: UnitLike | null): void {
    const key = unit ? `${unit.modelId}|${unit.owner.color}|${unit.id}` : null;
    if (key === this.current) return;
    this.current = key;
    this.model?.dispose();
    this.model = null;
    this.unit = unit;
    this.rest.clear();
    this.baseScale.clear();
    if (!unit) {
      const ctx = this.canvas?.getContext('2d');
      if (ctx && this.canvas) {
        ctx.fillStyle = '#0b0d12';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
      return;
    }
    const m = this.ui.models.instantiate(unit.modelId, unit.def.modelColor ?? unit.owner.color, 'portrait');
    m.root.rotationQuaternion = quatFromEulerXYZ(0, 0.35, 0);
    this.model = m;
    frame(this.cam, m, unit.isBuilding, true);
    const P = m.parts;
    for (const n of [P.head, P.body, ...(P.spin ?? []), ...(P.wings ?? []).map((w) => w.obj)]) {
      if (n) this.rest.set(n, eulerXYZFromQuat(n.rotationQuaternion));
    }
    for (const f of P.fire ?? []) this.baseScale.set(f, f.scaling.x);
  }

  /** Draw this frame: render into the main canvas under the portrait box, then copy it out. */
  render(time: number): void {
    const m = this.model;
    const el = this.el;
    const canvas = this.canvas;
    if (!m || !el || !canvas) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w < 4 || h < 4) return;
    const engine = this.ui.engine;
    const main = engine.getRenderingCanvas()!;
    const scale = engine.getRenderWidth() / Math.max(1, main.clientWidth);
    const pw = Math.min(Math.round(w * scale), engine.getRenderWidth());
    const ph = Math.min(Math.round(h * scale), engine.getRenderHeight());
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    this.animate(m.parts, time);
    if (this.unit?.isBuilding) m.root.rotationQuaternion = quatFromEulerXYZ(0, 0.35 + Math.sin(time * 0.3) * 0.15, 0);

    // The main canvas under the portrait box (hidden by it), in canvas pixels.
    const W = engine.getRenderWidth();
    const H = engine.getRenderHeight();
    const box = el.getBoundingClientRect();
    const host = main.getBoundingClientRect();
    const px = Math.max(0, Math.min(W - pw, Math.round((box.left - host.left) * scale)));
    const py = Math.max(0, Math.min(H - ph, Math.round((box.top - host.top) * scale)));
    const gy = H - py - ph; // GL rows count from the bottom
    this.cam.viewport = new Viewport(px / W, gy / H, pw / W, ph / H);
    const scene = this.ui.scene;
    scene.activeCamera = this.cam;
    this.ui.lights.portrait();
    engine.enableScissor(px, gy, pw, ph);
    engine.clear(new Color4(0x0b / 255, 0x0d / 255, 0x12 / 255, 1), true, true, true);
    scene.render();
    engine.disableScissor();
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(main, px, py, pw, ph, 0, 0, pw, ph);
  }

  private animate(P: ModelParts, time: number): void {
    const set = (n: TransformNode | undefined, axis: 0 | 1 | 2, v: number): void => {
      if (!n) return;
      const r = [...(this.rest.get(n) ?? [0, 0, 0])] as [number, number, number];
      r[axis] = v;
      n.rotationQuaternion = quatFromEulerXYZ(r[0], r[1], r[2]);
    };
    set(P.head, 1, Math.sin(time * 0.7) * 0.25);
    set(P.body, 1, Math.sin(time * 0.5) * 0.05);
    for (const s of P.spin ?? []) set(s, 1, time * 1.5);
    for (const w of P.wings ?? []) set(w.obj, 2, (w.side ?? 1) * Math.sin(time * 8) * 0.5);
    for (const f of P.fire ?? []) f.scaling.setAll((this.baseScale.get(f) ?? 1) * (0.85 + Math.random() * 0.3));
  }
}
