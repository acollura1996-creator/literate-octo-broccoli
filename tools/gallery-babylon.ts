// Dev gallery for the baked models on Babylon.js (npm run dev → /tools/gallery-babylon.html).
// Same layout, camera and URL options as tools/gallery.html (the three.js gallery), so the two
// can be compared shot for shot:
//   ids=footman,knight  team=0042ff,ff0303  zoom=2 dist=30 pitch=55 yaw=0 fov=40  rot=45
//   labels=0 help=0  cols=4 gap=0.7  atk=2.4 (weapon x rotation)
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { createBabylon } from '../src/babylon/engine';
import { registerLinearLighting } from '../src/babylon/Lighting';
import { ModelLibrary, type ModelInstance } from '../src/babylon/ModelLibrary';
import { quatFromEulerXYZ, eulerXYZFromQuat } from '../src/babylon/UnitView';

const q = new URLSearchParams(location.search);
const DEG = Math.PI / 180;
const teams = (q.get('team') ?? 'ff0303,0042ff').split(',').map((h) => parseInt(h, 16));
const zoom = parseFloat(q.get('zoom') ?? '1');
const pitch = parseFloat(q.get('pitch') ?? '55') * DEG;
const yaw = parseFloat(q.get('yaw') ?? '0') * DEG;
const fixedDist = q.has('dist') ? parseFloat(q.get('dist')!) : null;
const fov = parseFloat(q.get('fov') ?? '40');
const rot = parseFloat(q.get('rot') ?? '0') * DEG;
const gap = parseFloat(q.get('gap') ?? '0.7');
const atk = q.has('atk') ? parseFloat(q.get('atk')!) : null;
const showLabels = q.get('labels') !== '0';
if (q.get('help') === '0') document.getElementById('help')?.remove();

registerLinearLighting();
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const { engine, scene } = createBabylon(canvas);
scene.clearColor = Color4.FromHexString('#8fbbe0ff');

async function main(): Promise<void> {
  const lib = await ModelLibrary.load(scene);
  const ids = q.get('ids') ? q.get('ids')!.split(',').filter(Boolean) : lib.ids;

  // --- models and shelf layout (as in tools/gallery.js) --------------------------------------
  interface Item {
    id: string;
    m: ModelInstance;
    w: number;
    d: number;
    x: number;
    z: number;
  }
  const items: Item[] = ids.map((id, i) => {
    const m = lib.instantiate(id, teams[i % teams.length]!);
    m.root.rotationQuaternion = quatFromEulerXYZ(0, rot, 0);
    const r = Math.max(m.radius, 0.35);
    return { id, m, w: 2 * r + gap, d: 2 * r + gap + m.height * 0.35, x: 0, z: 0 };
  });
  const totalArea = items.reduce((s, it) => s + it.w * it.d, 0);
  const aspect = window.innerWidth / window.innerHeight;
  const cols = q.has('cols') ? parseInt(q.get('cols')!, 10) : 0;
  const rowW = Math.max(Math.sqrt(totalArea * aspect * 1.2), ...items.map((i) => i.w));
  const rows: Array<{ list: Item[]; width: number; depth: number }> = [];
  let cur = { list: [] as Item[], width: 0, depth: 0 };
  for (const it of items) {
    if (cur.list.length && (cols ? cur.list.length >= cols : cur.width + it.w > rowW)) {
      rows.push(cur);
      cur = { list: [], width: 0, depth: 0 };
    }
    it.x = cur.width + it.w / 2;
    cur.width += it.w;
    cur.depth = Math.max(cur.depth, it.d);
    cur.list.push(it);
  }
  rows.push(cur);
  const totalD = rows.reduce((s, r) => s + r.depth, 0);
  let zAcc = -totalD / 2;
  for (const row of rows) {
    for (const it of row.list) {
      it.x -= row.width / 2;
      it.z = zAcc + row.depth / 2;
      it.m.root.position.set(it.x, 0, it.z);
    }
    zAcc += row.depth;
  }
  if (atk !== null) {
    for (const it of items) {
      const w = it.m.parts.weapon;
      if (!w) continue;
      const [, ry, rz] = eulerXYZFromQuat(w.rotationQuaternion);
      w.rotationQuaternion = quatFromEulerXYZ(atk, ry, rz);
    }
  }

  // --- ground and lights (a sunny day, like the three.js gallery) -----------------------------
  const ground = CreateGround('ground', { width: 400, height: 400 }, scene);
  const gm = new StandardMaterial('ground', scene);
  gm.diffuseColor = Color3.FromHexString('#6aa636');
  gm.specularColor = Color3.Black();
  ground.material = gm;
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.diffuse = Color3.FromHexString('#dcecff');
  hemi.groundColor = Color3.FromHexString('#58773a');
  hemi.specular = Color3.Black();
  const sunDir = new Vector3(0.55, -2.2, -0.75).normalize();
  const sun = new DirectionalLight('sun', sunDir, scene);
  sun.diffuse = Color3.FromHexString('#fff0d2');
  // three.js intensities (1.15 hemisphere, 2.5 sun) over π, lit like three.js (see Lighting.ts).
  hemi.intensity = 1.15 / Math.PI;
  sun.intensity = 2.5 / Math.PI;

  // --- camera fitted to every model (as in tools/gallery.js) ----------------------------------
  const camera = new TargetCamera('cam', Vector3.Zero(), scene);
  camera.fov = fov * DEG;
  camera.minZ = 0.1;
  camera.maxZ = 2000;
  scene.activeCamera = camera;
  const maxH = Math.max(...items.map((i) => i.m.height));
  const dir = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const corners: Vector3[] = [];
  for (const it of items) {
    const hw = it.w / 2 - gap * 0.3;
    const hd = it.d / 2 - gap * 0.3;
    for (const y of [0, it.m.height]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) corners.push(new Vector3(it.x + sx * hw, y, it.z + sz * hd));
  }
  const min = corners.reduce((a, c) => Vector3.Minimize(a, c), corners[0]!.clone());
  const max = corners.reduce((a, c) => Vector3.Maximize(a, c), corners[0]!.clone());
  const target = min.add(max).scale(0.5);
  target.y = Math.min(target.y, maxH * 0.3);
  const place = (d: number): void => {
    camera.position.copyFrom(target.add(dir.scale(d)));
    camera.setTarget(target);
    camera.getViewMatrix(true);
    camera.getProjectionMatrix(true);
  };
  const ndc = (v: Vector3): Vector3 => Vector3.TransformCoordinates(v, camera.getTransformationMatrix());
  const fits = (d: number): boolean => {
    place(d);
    return corners.every((c) => {
      const v = ndc(c);
      return Math.abs(v.x) <= 0.97 && Math.abs(v.y) <= 0.95 && v.z < 1;
    });
  };
  let lo = 0.5;
  let hi = 1000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  place(fixedDist ?? hi / zoom);

  // --- labels ---------------------------------------------------------------------------------
  const labelRoot = document.getElementById('labels')!;
  const labels = showLabels
    ? items.map((it) => {
        const el = document.createElement('div');
        el.className = 'lbl';
        el.textContent = it.id;
        labelRoot.appendChild(el);
        return el;
      })
    : [];
  const placeLabels = (): void => {
    items.forEach((it, i) => {
      const el = labels[i];
      if (!el) return;
      const v = ndc(new Vector3(it.x, 0, it.z + it.d / 2 - gap * 0.35));
      el.style.left = `${((v.x + 1) / 2) * window.innerWidth}px`;
      el.style.top = `${((1 - v.y) / 2) * window.innerHeight}px`;
    });
  };

  // Stats for automated checks: per model, world-space bounds at the origin.
  (window as unknown as { __stats: unknown }).__stats = items.map((it) => {
    const saved = it.m.root.position.clone();
    it.m.root.position.setAll(0);
    it.m.root.computeWorldMatrix(true);
    let lo3 = new Vector3(Infinity, Infinity, Infinity);
    let hi3 = new Vector3(-Infinity, -Infinity, -Infinity);
    // Exact bounds from the vertices (like three.js's Box3.setFromObject(root, true)).
    for (const mesh of it.m.meshes) {
      const world = mesh.computeWorldMatrix(true);
      const pos = mesh.getVerticesData('position') ?? [];
      const v = new Vector3();
      for (let i = 0; i < pos.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(pos[i]!, pos[i + 1]!, pos[i + 2]!, world, v);
        lo3 = Vector3.Minimize(lo3, v);
        hi3 = Vector3.Maximize(hi3, v);
      }
    }
    it.m.root.position.copyFrom(saved);
    const r2 = (v: Vector3): number[] => v.asArray().map((n) => +n.toFixed(2));
    return { id: it.id, meshes: it.m.meshes.length, height: it.m.height, radius: it.m.radius, min: r2(lo3), max: r2(hi3), parts: Object.keys(it.m.parts) };
  });

  (window as unknown as { __gallery: unknown }).__gallery = { scene, lib, items };
  let frames = 0;
  engine.runRenderLoop(() => {
    scene.render();
    placeLabels();
    if (++frames === 3) (window as unknown as { __ready: boolean }).__ready = true;
  });
}

main().catch((e) => console.error(e));
