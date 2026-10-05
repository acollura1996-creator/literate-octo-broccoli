// The RTS camera, ported from the original three.js `RTSCamera` with the same public
// shape, so the existing input code (edge, keyboard and middle-drag panning, wheel zoom), the
// minimap and the HUD drive it unchanged: `target`, `distance`, `zoomTarget`, `minDist`,
// `maxDist`, `vel`, `setTarget()`, `update()` and `screenToGround()`.
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { MAP_SIZE } from '../world/layout.ts';

export interface HeightSource {
  heightAt(x: number, z: number): number;
}

export interface GroundPoint {
  x: number;
  z: number;
}

const DEG = Math.PI / 180;
const clampMap = (v: number): number => Math.max(0, Math.min(MAP_SIZE, v));

export class RTSCamera {
  readonly camera: TargetCamera;
  readonly target = new Vector3(40, 0, 120);
  distance = 34;
  zoomTarget = 34;
  minDist = 12;
  maxDist = 68;
  readonly vel = { x: 0, z: 0 };
  /** Fixed RTS pitch, 56° above the horizon. */
  pitch = 56 * DEG;
  yaw = 0;
  shake = 0;

  private readonly inv = new Matrix();
  private readonly near = new Vector3();
  private readonly far = new Vector3();

  constructor(scene: Scene) {
    this.camera = new TargetCamera('rts-camera', new Vector3(40, 30, 140), scene);
    // three.js takes the vertical FOV in degrees; Babylon in radians (both vertical by default).
    this.camera.fov = 42 * DEG;
    this.camera.minZ = 0.5;
    this.camera.maxZ = 400;
  }

  setTarget(x: number, z: number): void {
    this.target.x = Math.max(4, Math.min(MAP_SIZE - 4, x));
    this.target.z = Math.max(6, Math.min(MAP_SIZE + 4, z));
  }

  /** Follow the terrain height under the target and place the camera (with optional shake). */
  update(terrain?: HeightSource | null, shakeAmount = 0): void {
    const ty = terrain ? terrain.heightAt(this.target.x, Math.min(MAP_SIZE - 0.01, this.target.z)) : 0;
    this.target.y += (ty - this.target.y) * 0.15;
    const d = this.distance;
    const c = this.camera;
    c.position.set(
      this.target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * d,
      this.target.y + Math.sin(this.pitch) * d,
      this.target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * d,
    );
    if (shakeAmount > 0) {
      c.position.x += (Math.random() - 0.5) * shakeAmount;
      c.position.y += (Math.random() - 0.5) * shakeAmount;
    }
    c.setTarget(this.target);
    this.refreshMatrices();
  }

  /** Recompute the view and projection matrices now (picking can happen between frames). */
  refreshMatrices(): void {
    this.camera.getViewMatrix(true);
    this.camera.getProjectionMatrix(true);
  }

  /** World-space ray through a point in normalized device coordinates (-1..1, y up). */
  rayFromNdc(ndcX: number, ndcY: number): { origin: Vector3; dir: Vector3 } {
    this.camera.getTransformationMatrix().invertToRef(this.inv);
    // Two points on the ray; z = 0 and 1 are inside the clip volume for both depth conventions.
    Vector3.TransformCoordinatesFromFloatsToRef(ndcX, ndcY, 0, this.inv, this.near);
    Vector3.TransformCoordinatesFromFloatsToRef(ndcX, ndcY, 1, this.inv, this.far);
    const dir = this.far.subtract(this.near).normalize();
    return { origin: this.camera.position.clone(), dir };
  }

  /** Intersect a screen ray with the terrain heightfield (same march-and-bisect as before). */
  screenToGround(ndcX: number, ndcY: number, terrain: HeightSource): GroundPoint | null {
    const { origin: o, dir } = this.rayFromNdc(ndcX, ndcY);
    let prevT = 0;
    let t = 0;
    const step = 0.6;
    for (let i = 0; i < 800; i++) {
      t += step;
      const x = o.x + dir.x * t;
      const y = o.y + dir.y * t;
      const z = o.z + dir.z * t;
      if (y <= terrain.heightAt(clampMap(x), clampMap(z))) {
        let a = prevT;
        let b = t;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) / 2;
          if (o.y + dir.y * m <= terrain.heightAt(clampMap(o.x + dir.x * m), clampMap(o.z + dir.z * m))) b = m;
          else a = m;
        }
        return { x: o.x + dir.x * b, z: o.z + dir.z * b };
      }
      prevT = t;
    }
    // Fall back to the y = 0 plane.
    if (dir.y < 0) {
      const tt = -o.y / dir.y;
      return { x: o.x + dir.x * tt, z: o.z + dir.z * tt };
    }
    return null;
  }
}
