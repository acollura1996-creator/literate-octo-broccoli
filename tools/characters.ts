// Dev gallery for the rigged KayKit characters (npm run dev → /tools/characters.html): every
// recipe of src/babylon/CharacterRecipes.ts in a row, playing one role's clip, lit and shadowed
// like the game.
//   ids=footman,paladin  role=idle|walk|attack|cast|death|work|spawn  clip=Death_B  rate=1
//   t=0.4 (freeze the clips at this time)  team=ff0303,0042ff  dist=14 pitch=28 yaw=20 cols=6
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { createBabylon } from '../src/babylon/engine';
import { registerLinearLighting } from '../src/babylon/Lighting';
import { CharacterLibrary, type CharacterInstance } from '../src/babylon/Characters';
import { CHARACTER_RECIPES, type CharacterRecipe } from '../src/babylon/CharacterRecipes';

const q = new URLSearchParams(location.search);
const DEG = Math.PI / 180;
const teams = (q.get('team') ?? 'ff0303,0042ff,1ce6b9,540081,fffc00,fe8a0e').split(',').map((h) => parseInt(h, 16));
const role = q.get('role') ?? 'idle';
const clipName = q.get('clip');
const rate = parseFloat(q.get('rate') ?? '1');
const freeze = q.has('t') ? parseFloat(q.get('t')!) : null;
const pitch = parseFloat(q.get('pitch') ?? '28') * DEG;
const yaw = parseFloat(q.get('yaw') ?? '20') * DEG;
const cols = parseInt(q.get('cols') ?? '7', 10);
const showLabels = q.get('labels') !== '0';
if (q.get('help') === '0') document.getElementById('help')?.remove();

registerLinearLighting();
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const { engine, scene } = createBabylon(canvas);
scene.clearColor = Color4.FromHexString('#8fbbe0ff');

function roleClip(r: CharacterRecipe): string {
  switch (role) {
    case 'walk':
      return r.walk;
    case 'run':
      return r.run ?? r.walk;
    case 'attack':
      return r.attack[0]!;
    case 'cast':
      return r.cast;
    case 'death':
      return r.death[0]!;
    case 'work':
      return r.work ?? r.idle[0]!;
    case 'spawn':
      return r.spawn ?? r.idle[0]!;
    default:
      return r.idle[0]!;
  }
}

async function main(): Promise<void> {
  const lib = await CharacterLibrary.load(scene);
  const ids = q.get('ids') ? q.get('ids')!.split(',').filter(Boolean) : Object.keys(CHARACTER_RECIPES);

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.diffuse = Color3.FromHexString('#dcecff');
  hemi.groundColor = Color3.FromHexString('#58773a');
  hemi.specular = Color3.Black();
  hemi.intensity = 1.15 / Math.PI;
  const sun = new DirectionalLight('sun', new Vector3(0.55, -2.2, -0.75).normalize(), scene);
  sun.diffuse = Color3.FromHexString('#fff0d2');
  sun.intensity = 2.5 / Math.PI;
  sun.position = new Vector3(-20, 60, 25);
  const shadows = new ShadowGenerator(2048, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.bias = 0.002;
  lib.onCaster = (m) => shadows.addShadowCaster(m, false);

  const ground = CreateGround('ground', { width: 200, height: 200 }, scene);
  const gm = new StandardMaterial('ground', scene);
  gm.diffuseColor = Color3.FromHexString('#6aa636');
  gm.specularColor = Color3.Black();
  ground.material = gm;
  ground.receiveShadows = true;

  const spacing = 2.4;
  const rows = Math.ceil(ids.length / cols);
  const items: Array<{ id: string; c: CharacterInstance; x: number; z: number }> = [];
  ids.forEach((id, i) => {
    const c = lib.instantiate(id, teams[i % teams.length]!, `gal-${id}`);
    if (!c) return;
    const x = ((i % cols) - (cols - 1) / 2) * spacing;
    const z = (Math.floor(i / cols) - (rows - 1) / 2) * spacing * 1.1;
    c.root.position.set(x, 0, z);
    const clip = clipName ?? roleClip(c.recipe);
    const loop = !['death', 'spawn'].includes(role);
    c.animator.play(clip, { loop, rate, fade: 0 });
    if (freeze !== null) c.animator.update(freeze);
    c.syncFrames();
    items.push({ id, c, x, z });
  });
  for (const m of lib.sources) m.receiveShadows = true;

  const camera = new TargetCamera('cam', Vector3.Zero(), scene);
  camera.fov = 40 * DEG;
  camera.minZ = 0.1;
  camera.maxZ = 500;
  scene.activeCamera = camera;
  const width = Math.min(cols, ids.length) * spacing;
  const dist = q.has('dist') ? parseFloat(q.get('dist')!) : Math.max(width, rows * spacing * 1.6) * 1.05;
  const target = new Vector3(0, 0.7, 0);
  camera.position = target.add(new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).scale(dist));
  camera.setTarget(target);

  const labelRoot = document.getElementById('labels')!;
  const labels = showLabels
    ? items.map((it) => {
        const el = document.createElement('div');
        el.className = 'lbl';
        el.textContent = `${it.id} · ${it.c.animator.current}`;
        labelRoot.appendChild(el);
        return el;
      })
    : [];
  (window as unknown as { __gallery: unknown }).__gallery = { scene, lib, items };
  let frames = 0;
  let last = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const it of items) {
      if (freeze === null) it.c.animator.update(dt);
      it.c.syncFrames();
    }
    scene.render();
    const m = camera.getTransformationMatrix();
    items.forEach((it, i) => {
      const el = labels[i];
      if (!el) return;
      const v = Vector3.TransformCoordinates(new Vector3(it.x, 0, it.z + 0.9), m);
      el.style.left = `${((v.x + 1) / 2) * window.innerWidth}px`;
      el.style.top = `${((1 - v.y) / 2) * window.innerHeight}px`;
    });
    if (++frames === 3) (window as unknown as { __ready: boolean }).__ready = true;
  });
}
main().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:absolute;top:0;color:red">${String(e?.stack ?? e)}</pre>`);
});
