// Babylon.js engine and scene setup shared by every Babylon renderer entry point.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color4 } from '@babylonjs/core/Maths/math.color';

export interface BabylonContext {
  engine: Engine;
  scene: Scene;
  canvas: HTMLCanvasElement;
}

/**
 * Create the engine and a scene that uses the same right-handed, Y-up coordinate system as the
 * three.js version, so world positions (X right, Z toward the camera) and model facings (+Z)
 * carry over unchanged.
 */
export function createBabylon(canvas: HTMLCanvasElement): BabylonContext {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: true,
    antialias: true,
    powerPreference: 'high-performance',
  }, true);
  // Same pixel-ratio cap as the three.js renderer (devicePixelRatio, at most 2).
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0, 0, 0, 1);
  // The game has its own input handling (src/input.ts). Babylon's pointer handling would cancel
  // pointerdown, which stops the browser from sending the mouse events the game listens for.
  scene.detachControl();
  window.addEventListener('resize', () => engine.resize());
  return { engine, scene, canvas };
}
