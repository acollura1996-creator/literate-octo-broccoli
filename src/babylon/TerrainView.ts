// Babylon meshes for the terrain data (src/world/terrain.js), matching the three.js TerrainView:
// the heightfield with the painted ground map and detail map, the moat water, trees and doodads as
// thin instances (one draw call per species per 32×32-cell chunk), and the road surface.
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Material } from '@babylonjs/core/Materials/material';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Scene } from '@babylonjs/core/scene';
// Side effect: thin instances on Mesh.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { WATER_LEVEL } from '../world/terrain.js';
import { makeDetailCanvas, makeCobbleCanvas, roadGeometry } from '../world/groundArt.js';
import { FogOfWar } from './FogOfWar';
import { paint, type PaintKind } from './Painterly';
import type { GameLike, TerrainLike, TreeLike, DoodadLike, RoadsLike } from './types';

const CHUNK = 32;

/** Canvas → texture (Babylon samples canvases with row 0 at v = 1, like three.js). */
function canvasTexture(name: string, canvas: HTMLCanvasElement, scene: Scene, repeat: boolean): DynamicTexture {
  const tex = new DynamicTexture(name, canvas, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  tex.anisotropicFilteringLevel = 8;
  if (repeat) {
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
  }
  tex.update(true);
  return tex;
}

/**
 * The ground's tiling detail map, as in three.js: two scales of noise multiply the painted
 * colour so the large map stays crisp up close. three.js applies it in linear colour; Babylon's
 * StandardMaterial works in gamma space, hence the 1/2.2 power.
 */
class GroundDetailPlugin extends MaterialPluginBase {
  constructor(material: Material, private readonly detail: Texture) {
    super(material, 'GroundDetail', 200, { GROUNDDETAIL: false }, true, true);
  }

  override getClassName(): string {
    return 'GroundDetailPlugin';
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['GROUNDDETAIL'] = true;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('groundDetailSampler');
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.setTexture('groundDetailSampler', this.detail);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef GROUNDDETAIL
        uniform sampler2D groundDetailSampler;
      #endif`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef GROUNDDETAIL
        float gdA = texture2D(groundDetailSampler, vPositionW.xz * 0.37).r;
        float gdB = texture2D(groundDetailSampler, vPositionW.xz * 0.091 + 0.37).g;
        baseColor.rgb *= pow(max(0.0, 0.62 + 0.5 * gdA + 0.26 * (gdB - 0.5)), 1.0 / 2.2);
      #endif`,
    };
  }
}

const WATER_VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vW;
void main() {
  vec4 w = world * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = viewProjection * w;
}`;

// Same water as the three.js version: animated colour bands, highlights, darkened by the fog. (Its
// output is written as-is in both renderers: three.js does not colour-convert a ShaderMaterial.)
const WATER_FRAGMENT = `
precision highp float;
varying vec3 vW;
uniform float uTime;
uniform vec2 uWorldSize;
uniform sampler2D uFogTex;
// HDR pipeline (M8): output linear colour and add the distance haze.
uniform float uLinear;
uniform vec3 uCamPos;
uniform vec3 uHazeColor;
uniform vec2 uHazeRange;
void main() {
  float w1 = sin(vW.x * 1.3 + uTime * 1.1) * sin(vW.z * 1.1 - uTime * 0.9);
  float w2 = sin((vW.x + vW.z) * 2.3 + uTime * 1.7);
  float s = w1 * 0.5 + w2 * 0.25;
  vec3 deep = vec3(0.08, 0.27, 0.42);
  vec3 light = vec3(0.32, 0.6, 0.72);
  vec3 col = mix(deep, light, 0.45 + s * 0.25);
  col += vec3(0.9) * smoothstep(0.62, 0.75, s) * 0.35;
  float fog = texture2D(uFogTex, vW.xz / uWorldSize).r;
  if (uLinear > 0.5) {
    float h = clamp((uHazeRange.y - distance(vW, uCamPos)) / (uHazeRange.y - uHazeRange.x), 0.0, 1.0);
    col = mix(uHazeColor, col, h);
    col = pow(col, vec3(2.2)) * pow(fog, 2.2);
  } else {
    col *= fog;
  }
  gl_FragColor = vec4(col, 0.78);
}`;

/**
 * Linear → sRGB. Instance and vertex colours are linear in the three.js version (which encodes its
 * output to sRGB); Babylon's StandardMaterial works in gamma space, so they are converted once here.
 * (Hex material colours are sRGB in both.)
 */
const toGamma = (c: number): number => Math.pow(Math.max(0, c), 1 / 2.2);

/** Bake a transform into a mesh's vertices. */
function bake(mesh: Mesh, m: Matrix): Mesh {
  mesh.bakeTransformIntoVertices(m);
  return mesh;
}

/** Scale a mesh so its farthest vertex is `radius` from the origin (three.js polyhedron sizing). */
function toRadius(mesh: Mesh, radius: number): Mesh {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
  let max = 0;
  for (let i = 0; i < pos.length; i += 3) max = Math.max(max, Math.hypot(pos[i]!, pos[i + 1]!, pos[i + 2]!));
  return bake(mesh, Matrix.Scaling(radius / max, radius / max, radius / max));
}

/** Merge parts into one flat-shaded mesh (the faceted low-poly look of the three.js materials). */
function merged(name: string, parts: Mesh[]): Mesh {
  const m = Mesh.MergeMeshes(parts, true, true)!;
  m.name = name;
  m.convertToFlatShadedMesh();
  return m;
}

/** three.js-style transform: translate · rotate (Euler XYZ) · scale. */
function compose(x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number): Matrix {
  return Matrix.Scaling(sx, sy, sz)
    .multiply(Matrix.RotationZ(rz))
    .multiply(Matrix.RotationY(ry))
    .multiply(Matrix.RotationX(rx))
    .multiply(Matrix.Translation(x, y, z));
}

function mat(scene: Scene, name: string, color: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = Color3.Black();
  return m;
}

interface TreeSlot {
  trunks: Mesh;
  canopy: Mesh;
  index: number;
}

export class TerrainView {
  readonly terrain: TerrainLike;
  private readonly scene: Scene;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly treeSlots = new Map<TreeLike, TreeSlot>();
  private felledSeen = 0;
  private water!: ShaderMaterial;
  /** Meshes that cast and receive shadows (trees, rocks, bushes) and the ground, which receives. */
  readonly casters: Mesh[] = [];
  readonly receivers: Mesh[] = [];

  constructor(scene: Scene, terrain: TerrainLike) {
    this.scene = scene;
    this.terrain = terrain;
    this.buildGround();
    this.buildWater();
    this.buildTrees();
    this.buildDoodads();
  }

  /** HDR pipeline state for the water shader (linear output and distance haze). */
  setWaterGrading(linear: boolean, camPos: { x: number; y: number; z: number }, haze: { color: Color3; start: number; end: number }): void {
    this.water.setFloat('uLinear', linear ? 1 : 0);
    this.water.setVector3('uCamPos', new Vector3(camPos.x, camPos.y, camPos.z));
    this.water.setColor3('uHazeColor', haze.color);
    this.water.setVector2('uHazeRange', new Vector2(haze.start, Math.max(haze.start + 1, haze.end)));
  }

  /** Per frame: animate the water and turn newly felled trees into stumps. */
  update(time: number): void {
    this.water.setFloat('uTime', time);
    const fog = FogOfWar.current;
    if (fog) this.water.setTexture('uFogTex', fog.texture);
    const felled = this.terrain.felled;
    while (this.felledSeen < felled.length) this.fellTree(felled[this.felledSeen++]!);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.treeSlots.clear();
  }

  private keep<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  private buildGround(): void {
    const t = this.terrain;
    const S = t.size;
    const n = S + 1;
    const h = t.heights;
    const at = (x: number, z: number): number => h[Math.min(S, Math.max(0, z)) * n + Math.min(S, Math.max(0, x))]!;
    const positions = new Float32Array(n * n * 3);
    const normals = new Float32Array(n * n * 3);
    const uvs = new Float32Array(n * n * 2);
    for (let z = 0; z <= S; z++) {
      for (let x = 0; x <= S; x++) {
        const i = z * n + x;
        positions[i * 3] = x;
        positions[i * 3 + 1] = at(x, z);
        positions[i * 3 + 2] = z;
        const nx = at(x - 1, z) - at(x + 1, z);
        const nz = at(x, z - 1) - at(x, z + 1);
        const len = Math.hypot(nx, 2, nz);
        normals[i * 3] = nx / len;
        normals[i * 3 + 1] = 2 / len;
        normals[i * 3 + 2] = nz / len;
        // Canvas row 0 is world z = 0, as in the three.js ground.
        uvs[i * 2] = x / S;
        uvs[i * 2 + 1] = 1 - z / S;
      }
    }
    const indices = new Uint32Array(S * S * 6);
    let k = 0;
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const a = z * n + x;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        // Babylon's front-face winding, which it keeps in right-handed scenes too (the opposite
        // of three.js; the same order as MeshBuilder.CreateGround).
        indices.set([a, b, c, b, d, c], k);
        k += 6;
      }
    }
    const data = new VertexData();
    data.positions = positions;
    data.normals = normals;
    data.uvs = uvs;
    data.indices = indices;
    const mesh = this.keep(new Mesh('ground', this.scene));
    data.applyToMesh(mesh, false);
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    this.receivers.push(mesh);

    const material = this.keep(mat(this.scene, 'ground', Color3.White()));
    const canvas = t.textureCanvas ?? t.paintTexture();
    material.diffuseTexture = this.keep(canvasTexture('ground-paint', canvas, this.scene, false));
    const detail = this.keep(canvasTexture('ground-detail', makeDetailCanvas(), this.scene, true));
    new GroundDetailPlugin(material, detail);
    mesh.material = material;
  }

  private buildWater(): void {
    const S = this.terrain.size;
    const mesh = this.keep(CreateGround('water', { width: S, height: S }, this.scene));
    mesh.position.set(S / 2, WATER_LEVEL, S / 2);
    mesh.isPickable = false;
    const material = this.keep(
      new ShaderMaterial(
        'water',
        this.scene,
        { vertexSource: WATER_VERTEX, fragmentSource: WATER_FRAGMENT },
        {
          attributes: ['position'],
          uniforms: ['world', 'viewProjection', 'uTime', 'uWorldSize', 'uLinear', 'uCamPos', 'uHazeColor', 'uHazeRange'],
          samplers: ['uFogTex'],
          needAlphaBlending: true,
        },
      ),
    );
    material.disableDepthWrite = true;
    material.setVector2('uWorldSize', new Vector2(S, S));
    material.setFloat('uTime', 0);
    material.setFloat('uLinear', 0);
    material.setVector3('uCamPos', Vector3.Zero());
    material.setColor3('uHazeColor', Color3.Black());
    material.setVector2('uHazeRange', new Vector2(1, 2));
    mesh.material = material;
    this.water = material;
  }

  private buildTrees(): void {
    const sc = this.scene;
    const trunkBase = bake(CreateCylinder('trunk', { height: 1, diameterTop: 0.18, diameterBottom: 0.32, tessellation: 6 }, sc), Matrix.Translation(0, 0.5, 0));
    trunkBase.convertToFlatShadedMesh();
    const cone = (r: number, h: number, seg: number, m: Matrix): Mesh =>
      bake(CreateCylinder('cone', { height: h, diameterTop: 0, diameterBottom: r * 2, tessellation: seg }, sc), m);
    const ico = (r: number, x: number, y: number, z: number): Mesh =>
      bake(CreateIcoSphere('ico', { radius: r, subdivisions: 1, flat: true }, sc), Matrix.Translation(x, y, z));
    const canopyBases = [
      merged('pine', [cone(0.85, 1.3, 7, Matrix.Translation(0, 1.35, 0)), cone(0.68, 1.15, 7, Matrix.Translation(0, 2.0, 0)), cone(0.45, 0.95, 7, Matrix.Translation(0, 2.6, 0))]),
      merged('ash', [ico(0.85, 0, 1.85, 0), ico(0.6, 0.45, 1.5, 0.2), ico(0.58, -0.4, 1.55, -0.25), ico(0.5, 0.05, 2.45, 0.1)]),
      merged('dead', [
        cone(0.06, 1.0, 4, Matrix.RotationZ(0.9).multiply(Matrix.Translation(0.35, 1.5, 0))),
        cone(0.05, 0.9, 4, Matrix.RotationZ(-0.8).multiply(Matrix.Translation(-0.3, 1.7, 0.1))),
        cone(0.05, 0.8, 4, Matrix.RotationX(0.8).multiply(Matrix.Translation(0, 1.6, 0.3))),
        cone(0.08, 1.2, 5, Matrix.Translation(0, 1.9, 0)),
      ]),
    ];
    const trunkMats = [this.keep(mat(sc, 'trunk', Color3.FromHexString('#6b4a2b'))), this.keep(mat(sc, 'trunk-dead', Color3.FromHexString('#3d3236')))];
    const leafMats = [this.keep(mat(sc, 'leaves', Color3.White())), this.keep(mat(sc, 'leaves-dead', Color3.FromHexString('#4a3a40')))];
    for (const m of trunkMats) paint(m, 'wood');
    paint(leafMats[0]!, 'foliage');
    paint(leafMats[1]!, 'wood');
    for (const b of [trunkBase, ...canopyBases]) {
      b.setEnabled(false);
      this.keep(b);
    }

    // Batch per 32×32-cell chunk and species, so off-screen forests are culled.
    const chunksPerSide = Math.ceil(this.terrain.size / CHUNK);
    const buckets = new Map<string, TreeLike[]>();
    for (const t of this.terrain.trees) {
      const key = `${Math.floor(t.cx / CHUNK) + Math.floor(t.cz / CHUNK) * chunksPerSide}:${t.species}`;
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(t);
    }
    for (const [key, list] of buckets) {
      const s = list[0]!.species;
      const trunks = this.keep(trunkBase.clone(`trunks-${key}`));
      const canopy = this.keep(canopyBases[s]!.clone(`canopy-${key}`));
      trunks.material = trunkMats[s === 2 ? 1 : 0]!;
      canopy.material = leafMats[s === 2 ? 1 : 0]!;
      const matrices = new Float32Array(list.length * 16);
      const colors = new Float32Array(list.length * 4);
      list.forEach((t, i) => {
        compose(t.x, this.terrain.heightAt(t.x, t.z) - 0.05, t.z, 0, t.rot, 0, t.scale, t.scale, t.scale).copyToArray(matrices, i * 16);
        colors.set([toGamma(t.tint[0]), toGamma(t.tint[1]), toGamma(t.tint[2]), 1], i * 4);
        this.treeSlots.set(t, { trunks, canopy, index: i });
      });
      for (const m of [trunks, canopy]) {
        // Thin-instance buffers live on the geometry, which clones share: each chunk needs its own.
        m.makeGeometryUnique();
        m.setEnabled(true);
        m.isPickable = false;
        m.thinInstanceSetBuffer('matrix', matrices.slice(), 16, false);
        m.thinInstanceRefreshBoundingInfo(false);
        this.casters.push(m);
        this.receivers.push(m);
      }
      canopy.thinInstanceSetBuffer('color', colors, 4, true);
    }
  }

  /** A felled tree leaves a low stump and no canopy. */
  private fellTree(tree: TreeLike): void {
    const slot = this.treeSlots.get(tree);
    if (!slot) return;
    const y = this.terrain.heightAt(tree.x, tree.z) - 0.05;
    slot.trunks.thinInstanceSetMatrixAt(slot.index, compose(tree.x, y, tree.z, 0, 0, 0, tree.scale * 1.3, 0.12, tree.scale * 1.3), true);
    slot.canopy.thinInstanceSetMatrixAt(slot.index, compose(tree.x, y, tree.z, 0, 0, 0, 0, 0, 0), true);
  }

  private buildDoodads(): void {
    const sc = this.scene;
    const d = this.terrain.doodads ?? this.terrain.scatterDoodads();
    const doodadMat = (kind: PaintKind | null): StandardMaterial => {
      const m = this.keep(mat(sc, 'doodad', Color3.White()));
      if (kind) paint(m, kind);
      return m;
    };
    const rock = toRadius(CreatePolyhedron('rock', { type: 2, size: 1, flat: true }, sc), 1);
    const bush = CreateIcoSphere('bush', { radius: 1, subdivisions: 1, flat: true }, sc);
    const petals: Mesh[] = [];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      petals.push(bake(toRadius(CreatePolyhedron('petal', { type: 1, size: 1, flat: true }, sc), 0.07), Matrix.Translation(Math.cos(a) * 0.22, 0.06, Math.sin(a) * 0.22)));
    }
    const flower = merged('flowers', petals);
    const place = (mesh: Mesh, list: DoodadLike[], kind: PaintKind | null): void => {
      this.keep(mesh);
      mesh.material = doodadMat(kind);
      mesh.isPickable = false;
      if (!list.length) {
        mesh.setEnabled(false);
        return;
      }
      const matrices = new Float32Array(list.length * 16);
      const colors = new Float32Array(list.length * 4);
      list.forEach((p, i) => {
        compose(p.x, p.y, p.z, p.rot[0], p.rot[1], p.rot[2], p.scale[0], p.scale[1], p.scale[2]).copyToArray(matrices, i * 16);
        colors.set([toGamma(p.color[0]), toGamma(p.color[1]), toGamma(p.color[2]), 1], i * 4);
      });
      mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
      mesh.thinInstanceSetBuffer('color', colors, 4, true);
      mesh.thinInstanceRefreshBoundingInfo(false);
      this.casters.push(mesh);
      this.receivers.push(mesh);
    };
    place(rock, d.rocks, 'stone');
    place(bush, d.bushes, 'foliage');
    place(flower, d.flowers, null);
  }
}

/** The road surface, rebuilt when the road network or a general's age changes. */
export class RoadView {
  readonly roads: RoadsLike;
  private readonly game: GameLike;
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly texture: DynamicTexture;
  private version = -1;

  constructor(scene: Scene, roads: RoadsLike, game: GameLike) {
    this.roads = roads;
    this.game = game;
    this.mesh = new Mesh('roads', scene);
    this.mesh.isPickable = false;
    this.material = mat(scene, 'roads', Color3.White());
    this.texture = canvasTexture('road-cobbles', makeCobbleCanvas(), scene, true);
    this.material.diffuseTexture = this.texture;
    // Drawn over the ground (three.js used a polygon offset of -2).
    this.material.zOffset = -2;
    this.material.zOffsetUnits = -2;
    this.mesh.material = this.material;
  }

  update(): void {
    if (this.version === this.roads.version) return;
    this.version = this.roads.version;
    const r = roadGeometry(this.roads, this.game);
    if (!r.quads) {
      this.mesh.setEnabled(false);
      return;
    }
    const indices = new Uint32Array(r.quads * 6);
    const colors = new Float32Array(r.quads * 16);
    for (let q = 0; q < r.quads; q++) {
      // Babylon winding (see TerrainView.buildGround).
      indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6);
      for (let v = 0; v < 4; v++) {
        const i = q * 4 + v;
        colors.set([toGamma(r.colors[i * 3]!), toGamma(r.colors[i * 3 + 1]!), toGamma(r.colors[i * 3 + 2]!), 1], i * 4);
      }
    }
    const data = new VertexData();
    data.positions = r.positions;
    data.normals = r.normals;
    data.uvs = r.uvs;
    data.colors = colors;
    data.indices = indices;
    data.applyToMesh(this.mesh, true);
    this.mesh.setEnabled(true);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
