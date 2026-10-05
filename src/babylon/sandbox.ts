// Milestone 1 check scene (`?renderer=babylon`): proves the Babylon stack renders in the browser
// and in Electron, and that handedness matches three.js (red marker on +X, blue on +Z).
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { createBabylon } from './engine';

function flat(scene: import('@babylonjs/core/scene').Scene, hex: string): StandardMaterial {
  const m = new StandardMaterial(hex, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = Color3.Black();
  return m;
}

export function runSandbox(canvas: HTMLCanvasElement): void {
  const { engine, scene } = createBabylon(canvas);
  // Same framing as the three.js RTS camera: 56° pitch, 42° vertical FOV (in radians here).
  const cam = new ArcRotateCamera('cam', Math.PI / 2, (90 - 56) * (Math.PI / 180), 34, new Vector3(0, 0, 0), scene);
  cam.fov = (42 * Math.PI) / 180;
  cam.attachControl(canvas, true);

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.diffuse = Color3.FromHexString('#cfe6ff');
  hemi.groundColor = Color3.FromHexString('#5a4a30');
  hemi.intensity = 0.9;
  const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.35), scene);
  sun.diffuse = Color3.FromHexString('#fff1d6');
  sun.intensity = 1.6;

  const ground = CreateGround('ground', { width: 40, height: 40 }, scene);
  ground.material = flat(scene, '#4d8a2f');

  const pX = CreateBox('plusX', { size: 2 }, scene);
  pX.position.set(8, 1, 0);
  pX.material = flat(scene, '#ff0303');
  const pZ = CreateBox('plusZ', { size: 2 }, scene);
  pZ.position.set(0, 1, 8);
  pZ.material = flat(scene, '#0042ff');
  const origin = CreateCylinder('origin', { diameter: 1.2, height: 3 }, scene);
  origin.position.y = 1.5;
  origin.material = flat(scene, '#e8c860');

  const label = document.createElement('div');
  label.id = 'babylon-sandbox-label';
  label.textContent = 'Babylon.js renderer — milestone 1 (red = +X, blue = +Z)';
  Object.assign(label.style, {
    position: 'fixed', left: '12px', top: '12px', color: '#ffe680', font: '14px Georgia, serif',
    background: 'rgba(0,0,0,0.55)', padding: '6px 10px', borderRadius: '4px', zIndex: '50',
  });
  document.body.appendChild(label);

  engine.runRenderLoop(() => scene.render());
  (window as unknown as { __babylon: unknown }).__babylon = { engine, scene };
}
