// A small three.js-style toolkit on Babylon for transient visuals (effects, projectiles, placement
// previews), so the three.js effect code ports nearly line for line.
//
// - Shapes use three.js geometry conventions (cylinders and cones along Y and centred, rings and
//   circles in the XY plane facing +Z, polyhedra sized by circumradius).
// - Every shape is created once per material style; each visual is an InstancedMesh of it, so
//   effects cost no new materials or shaders. Unlit effect colours and opacities are per instance
//   (and can animate); lit styles (projectiles) are cached per colour set.
// - FxNode mirrors the parts of THREE.Object3D the effects use: position, Euler XYZ rotation,
//   scale, visible, add(), lookAt() and setFromUnitVectors().
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Meshes/instancedMesh';
import { TeamColorPlugin } from './TeamColor';
import type { FogOfWarPlugin } from './FogOfWar';
import { quatFromEulerXYZ } from './UnitView';

// ----------------------------------------------------------------------------------- colours
export function hexToColor3(hex: number): Color3 {
  return new Color3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

/** An effect material: colour (sRGB) and opacity, animated by the effect, shared by its meshes. */
export class FxMaterial {
  color: Color3;
  constructor(
    hex: number,
    public opacity = 1,
    readonly additive = false,
    /** Depth-tested but no depth writes, like three.js transparent effect materials. */
    readonly doubleSided = true,
  ) {
    this.color = hexToColor3(hex);
  }

  setHex(hex: number): this {
    this.color = hexToColor3(hex);
    return this;
  }

  /**
   * three.js Color.setHSL: the HSL values describe a linear colour (three.js's working space),
   * which is shown sRGB-encoded.
   */
  setHSL(h: number, s: number, l: number): this {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
      return p;
    };
    h = ((h % 1) + 1) % 1;
    s = Math.min(1, Math.max(0, s));
    l = Math.min(1, Math.max(0, l));
    let r = l, g = l, b = l;
    if (s !== 0) {
      const p = l <= 0.5 ? l * (1 + s) : l + s - l * s;
      const q = 2 * l - p;
      r = hue2rgb(q, p, h + 1 / 3);
      g = hue2rgb(q, p, h);
      b = hue2rgb(q, p, h - 1 / 3);
    }
    const enc = (c: number): number => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055);
    this.color = new Color3(enc(r), enc(g), enc(b));
    return this;
  }
}

/** A lit material (three.js Lambert via mat()): fixed colours, cached per combination. */
export interface LitSpec {
  color: number;
  emissive?: number;
  emissiveIntensity?: number;
  opacity?: number;
}

// ------------------------------------------------------------------------------------ nodes
export class FxNode {
  readonly position: Vector3;
  readonly scale: Vector3;
  /** Euler angles, order XYZ (three.js). Ignored while `quaternion` is set. */
  readonly rotation = { x: 0, y: 0, z: 0 };
  quaternion: Quaternion | null = null;
  readonly children: FxNode[] = [];
  private shown = true;

  constructor(
    readonly node: TransformNode,
    readonly material: FxMaterial | null = null,
  ) {
    this.position = node.position;
    this.scale = node.scaling;
  }

  get visible(): boolean {
    return this.shown;
  }

  set visible(v: boolean) {
    if (v === this.shown) return;
    this.shown = v;
    this.node.setEnabled(v);
  }

  add(...nodes: FxNode[]): this {
    for (const n of nodes) {
      n.node.parent = this.node;
      this.children.push(n);
    }
    return this;
  }

  /** Point +Z at a world position (three.js Object3D.lookAt for non-camera objects). */
  lookAt(x: number, y: number, z: number): void {
    const p = this.node.getAbsolutePosition();
    const zAxis = new Vector3(x - p.x, y - p.y, z - p.z);
    if (zAxis.lengthSquared() < 1e-12) return;
    zAxis.normalize();
    let xAxis = Vector3.Cross(new Vector3(0, 1, 0), zAxis);
    if (xAxis.lengthSquared() < 1e-12) {
      // Looking straight up or down: nudge, as three.js does.
      zAxis.z += 1e-4;
      zAxis.normalize();
      xAxis = Vector3.Cross(new Vector3(0, 1, 0), zAxis);
    }
    xAxis.normalize();
    const yAxis = Vector3.Cross(zAxis, xAxis);
    // Rows are the basis vectors in Babylon's row-vector convention.
    const m = Matrix.FromValues(xAxis.x, xAxis.y, xAxis.z, 0, yAxis.x, yAxis.y, yAxis.z, 0, zAxis.x, zAxis.y, zAxis.z, 0, 0, 0, 0, 1);
    this.quaternion = Quaternion.FromRotationMatrix(m);
  }

  /** Rotation taking unit vector `from` to unit vector `to` (three.js Quaternion.setFromUnitVectors). */
  setFromUnitVectors(from: Vector3, to: Vector3): void {
    const q = new Quaternion();
    Quaternion.FromUnitVectorsToRef(from, to, q);
    this.quaternion = q;
  }

  /** Apply rotation and material state (call after changing them, e.g. once per frame). */
  sync(): void {
    if (this.quaternion) this.node.rotationQuaternion = this.quaternion;
    else this.node.rotationQuaternion = quatFromEulerXYZ(this.rotation.x, this.rotation.y, this.rotation.z, this.node.rotationQuaternion ?? new Quaternion());
    const m = this.material;
    if (m) {
      const inst = this.node as InstancedMesh;
      const c = inst.instancedBuffers?.color as Color4 | undefined;
      if (c) {
        c.r = m.color.r;
        c.g = m.color.g;
        c.b = m.color.b;
        c.a = Math.max(0, Math.min(1, m.opacity));
      }
    }
    for (const c of this.children) c.sync();
  }

  dispose(): void {
    this.node.dispose(false, false);
  }
}

// ------------------------------------------------------------------------------------ shapes
/** Scale a mesh so its farthest vertex is `radius` from the origin (three.js polyhedron sizing). */
function toRadius(mesh: Mesh, radius: number): Mesh {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
  let max = 0;
  for (let i = 0; i < pos.length; i += 3) max = Math.max(max, Math.hypot(pos[i]!, pos[i + 1]!, pos[i + 2]!));
  mesh.bakeTransformIntoVertices(Matrix.Scaling(radius / max, radius / max, radius / max));
  return mesh;
}

/** Ring or disc in the XY plane facing +Z (three.js RingGeometry / CircleGeometry). */
function ringXY(name: string, inner: number, outer: number, segments: number, scene: Scene): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(a) * inner, Math.sin(a) * inner, 0, Math.cos(a) * outer, Math.sin(a) * outer, 0);
    normals.push(0, 0, 1, 0, 0, 1);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    indices.push(a, c, b, b, c, d);
  }
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.indices = indices;
  vd.applyToMesh(m);
  return m;
}

export type ShapeSpec =
  | ['box', number, number, number]
  | ['cyl', number, number, number, number?]
  | ['cone', number, number, number?]
  | ['sphere', number, number?, number?]
  | ['ico', number, number?]
  | ['octa', number]
  | ['dodeca', number]
  | ['tetra', number]
  | ['ring', number, number, number?]
  | ['circle', number, number?]
  | ['torus', number, number, number?, number?];

/** Shape helpers with the three.js geo.* signatures (see src/render/assets.js). */
export const shape = {
  box: (w: number, h: number, d: number): ShapeSpec => ['box', w, h, d],
  cyl: (rt: number, rb: number, h: number, seg = 8): ShapeSpec => ['cyl', rt, rb, h, seg],
  cone: (r: number, h: number, seg = 8): ShapeSpec => ['cone', r, h, seg],
  sphere: (r: number, ws = 8, hs = 6): ShapeSpec => ['sphere', r, ws, hs],
  ico: (r: number, detail = 0): ShapeSpec => ['ico', r, detail],
  octa: (r: number): ShapeSpec => ['octa', r],
  dodeca: (r: number): ShapeSpec => ['dodeca', r],
  tetra: (r: number): ShapeSpec => ['tetra', r],
  ring: (inner: number, outer: number, seg = 32): ShapeSpec => ['ring', inner, outer, seg],
  circle: (r: number, seg = 24): ShapeSpec => ['circle', r, seg],
  torus: (r: number, tube: number, rs = 6, ts = 12): ShapeSpec => ['torus', r, tube, rs, ts],
};

function buildShape(s: ShapeSpec, name: string, scene: Scene): Mesh {
  switch (s[0]) {
    case 'box':
      return CreateBox(name, { width: s[1], height: s[2], depth: s[3] }, scene);
    case 'cyl':
      return CreateCylinder(name, { diameterTop: s[1] * 2, diameterBottom: s[2] * 2, height: s[3], tessellation: s[4] ?? 8 }, scene);
    case 'cone':
      return CreateCylinder(name, { diameterTop: 0, diameterBottom: s[1] * 2, height: s[2], tessellation: s[3] ?? 8 }, scene);
    case 'sphere':
      return CreateSphere(name, { diameter: s[1] * 2, segments: Math.max(2, Math.round((s[3] ?? 6) / 2)) }, scene);
    case 'ico':
      return CreateIcoSphere(name, { radius: s[1], subdivisions: (s[2] ?? 0) + 1, flat: true }, scene);
    case 'octa':
      return toRadius(CreatePolyhedron(name, { type: 1, size: 1, flat: true }, scene), s[1]);
    case 'dodeca':
      return toRadius(CreatePolyhedron(name, { type: 2, size: 1, flat: true }, scene), s[1]);
    case 'tetra':
      return toRadius(CreatePolyhedron(name, { type: 0, size: 1, flat: true }, scene), s[1]);
    case 'ring':
      return ringXY(name, s[1], s[2], s[3] ?? 32, scene);
    case 'circle':
      return ringXY(name, 0, s[1], s[2] ?? 24, scene);
    case 'torus': {
      // three.js tori lie in the XY plane; Babylon's in XZ.
      const t = CreateTorus(name, { diameter: s[1] * 2, thickness: s[2] * 2, tessellation: s[4] ?? 12 }, scene);
      t.bakeTransformIntoVertices(Matrix.RotationX(Math.PI / 2));
      return t;
    }
  }
}

// ---------------------------------------------------------------------------------- the kit
export class FxKit {
  private readonly sources = new Map<string, Mesh>();

  constructor(readonly scene: Scene) {}

  private noFog(m: StandardMaterial): StandardMaterial {
    const fog = m.pluginManager?.getPlugin('FogOfWar') as FogOfWarPlugin | null;
    if (fog) fog.fogEnabled = false;
    return m;
  }

  /** Source mesh for a shape in an unlit style; instances carry colour and opacity. */
  private unlitSource(s: ShapeSpec, additive: boolean, doubleSided: boolean): Mesh {
    const key = `u|${s.join(',')}|${additive ? 1 : 0}|${doubleSided ? 1 : 0}`;
    let src = this.sources.get(key);
    if (src) return src;
    src = buildShape(s, key, this.scene);
    const m = this.noFog(new StandardMaterial(key, this.scene));
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.emissiveColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.disableDepthWrite = true;
    m.backFaceCulling = !doubleSided;
    m.transparencyMode = Material.MATERIAL_ALPHABLEND;
    if (additive) m.alphaMode = Constants.ALPHA_ADD;
    // Unlit materials show only their emissive colour: the instance colour goes in there.
    new TeamColorPlugin(m, null, [1, 0, 0, 0]);
    src.material = m;
    src.registerInstancedBuffer('color', 4);
    src.instancedBuffers.color = new Color4(1, 1, 1, 1);
    src.hasVertexAlpha = true;
    src.isVisible = false;
    src.isPickable = false;
    this.sources.set(key, src);
    return src;
  }

  /** Source mesh for a shape in a lit style (cached per colour set). */
  private litSource(s: ShapeSpec, spec: LitSpec, flat = true): Mesh {
    const key = `l|${s.join(',')}|${spec.color}|${spec.emissive ?? ''}|${spec.emissiveIntensity ?? ''}|${spec.opacity ?? 1}|${flat ? 1 : 0}`;
    let src = this.sources.get(key);
    if (src) return src;
    src = buildShape(s, key, this.scene);
    if (flat) src.convertToFlatShadedMesh();
    const m = this.noFog(new StandardMaterial(key, this.scene));
    m.diffuseColor = hexToColor3(spec.color);
    m.specularColor = Color3.Black();
    if (spec.emissive !== undefined) {
      m.emissiveColor = hexToColor3(spec.emissive).scale(spec.emissiveIntensity ?? 1);
      m.useEmissiveAsIllumination = true;
    }
    if ((spec.opacity ?? 1) < 1) {
      m.alpha = spec.opacity!;
      m.transparencyMode = Material.MATERIAL_ALPHABLEND;
    }
    src.material = m;
    src.isVisible = false;
    src.isPickable = false;
    this.sources.set(key, src);
    return src;
  }

  group(name = 'fx'): FxNode {
    return new FxNode(new TransformNode(name, this.scene));
  }

  /** An unlit effect mesh (three.js MeshBasicMaterial); its colour and opacity follow `material`. */
  mesh(s: ShapeSpec, material: FxMaterial): FxNode {
    const inst = this.unlitSource(s, material.additive, material.doubleSided).createInstance('fx');
    inst.isPickable = false;
    inst.instancedBuffers.color = new Color4(material.color.r, material.color.g, material.color.b, material.opacity);
    return new FxNode(inst, material);
  }

  /** A lit mesh (three.js Lambert material from mat()). */
  lit(s: ShapeSpec, spec: LitSpec, flat = true): FxNode {
    const inst = this.litSource(s, spec, flat).createInstance('fx-lit');
    inst.isPickable = false;
    return new FxNode(inst);
  }
}
