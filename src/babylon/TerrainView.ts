// Babylon meshes for the terrain data (src/world/terrain.ts): the heightfield with the hand-painted
// ground layers (GroundMaterial.ts), the moat water, trees and doodads as thin instances (one draw
// call per species per 32×32-cell chunk), and the road surface.
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
// Side effect: thin instances on Mesh.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { T_DIRT, T_FOREST, T_GRASS, T_SHORE, WATER_LEVEL } from '../world/terrain.ts';
import { BLOCK_BUILDING, BLOCK_GATE } from '../world/pathgrid.ts';
import { FoliagePlugin, boulderGeo, broadleafGeo, bushGeo, deadTreeGeo, flowerGeo, foliageMask, foliageMaterial, geoMesh, grassTuftGeo, pineGeo } from './Foliage';
import { makeCobbleCanvas, roadGeometry } from '../world/groundArt.ts';
import { GroundSplatPlugin } from './GroundMaterial';
import { FogOfWar } from './FogOfWar';
import type { Game } from '../game/game.ts';
import type { Roads } from '../game/roads.ts';
import type { Terrain, Tree } from '../world/terrain.ts';

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

// Warcraft III-style water (M13): turquoise shallows to deep blue by the actual depth below the
// surface, scrolling ripples that catch the sky and the sun, bright painted caustic streaks, and
// foam lapping at the shore. Darkened by the fog of war; in the HDR pipeline it outputs linear colour
// and takes the distance haze.
const WATER_FRAGMENT = `
precision highp float;
varying vec3 vW;
uniform float uTime;
uniform vec2 uWorldSize;
uniform sampler2D uFogTex;
uniform sampler2D uDepthTex;
uniform sampler2D uNoiseTex;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform float uLinear;
uniform vec3 uCamPos;
uniform vec3 uHazeColor;
uniform vec2 uHazeRange;
float nz(vec2 p) { return texture2D(uNoiseTex, p).r; }
float ripples(vec2 p) {
  return nz(p * 0.09 + vec2(uTime * 0.011, uTime * 0.007)) + 0.55 * nz(p * 0.21 + vec2(-uTime * 0.016, uTime * 0.012));
}
void main() {
  vec2 p = vW.xz;
  float depth = texture2D(uDepthTex, (p + 0.5) / (uWorldSize + 1.0)).r * 2.5;
  float e = 0.06;
  float h = ripples(p);
  vec3 n = normalize(vec3((h - ripples(p + vec2(e, 0.0))) * 3.2, 1.0, (h - ripples(p + vec2(0.0, e))) * 3.2));
  vec3 v = normalize(uCamPos - vW);
  float dk = smoothstep(0.0, 1.7, depth);
  vec3 col = mix(vec3(0.26, 0.68, 0.7), vec3(0.04, 0.22, 0.4), dk);
  // Painted caustic streaks, brightest in the shallows.
  float c = nz(p * 0.29 + vec2(uTime * 0.021, -uTime * 0.014)) * nz(p * 0.41 - vec2(uTime * 0.026, uTime * 0.011));
  col += vec3(0.5, 0.82, 0.78) * smoothstep(0.3, 0.48, c) * 0.3 * (1.0 - 0.6 * dk);
  float ndl = max(dot(n, uSunDir), 0.0);
  col *= (0.45 + 0.65 * ndl) * (0.35 + 0.65 * min(1.0, dot(uSunColor, vec3(0.333))));
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col = mix(col, uSkyColor, fres * 0.6);
  vec3 r = reflect(-v, n);
  col += uSunColor * pow(max(dot(r, uSunDir), 0.0), 80.0) * 1.5;
  // Foam where the water meets the land, breaking up and lapping.
  float fn = nz(p * 0.55 + vec2(uTime * 0.04, -uTime * 0.03));
  float foam = smoothstep(0.26, 0.0, depth + (fn - 0.5) * 0.3) * (0.65 + 0.35 * sin(uTime * 1.4 + depth * 22.0 + fn * 6.0));
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, vec3(0.93, 0.97, 0.96) * (0.5 + 0.5 * min(1.0, dot(uSunColor, vec3(0.333)))), foam * 0.85);
  float alpha = max(mix(0.5, 0.93, dk), foam * 0.9) * smoothstep(-0.02, 0.05, depth);
  float fog = texture2D(uFogTex, vW.xz / uWorldSize).r;
  if (uLinear > 0.5) {
    float hz = clamp((uHazeRange.y - distance(vW, uCamPos)) / (uHazeRange.y - uHazeRange.x), 0.0, 1.0);
    col = mix(uHazeColor, col, hz);
    col = pow(col, vec3(2.2)) * pow(fog, 2.2);
  } else {
    col *= fog;
  }
  gl_FragColor = vec4(col, alpha);
}`;

/** Tileable value noise (two octaves) for the water ripples, caustics and foam. */
function waterNoise(size = 256): Uint8Array {
  let seed = 0x2545f491;
  const rand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const octave = (cells: number): Float32Array => {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const sx = (fx - x0) * (fx - x0) * (3 - 2 * (fx - x0));
        const sy = (fy - y0) * (fy - y0) * (3 - 2 * (fy - y0));
        const at = (a: number, b: number): number => g[(b % cells) * cells + (a % cells)]!;
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        out[y * size + x] = top + (bot - top) * sy;
      }
    }
    return out;
  };
  const a = octave(8);
  const b = octave(16);
  const c = octave(32);
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = a[i]! * 0.55 + b[i]! * 0.3 + c[i]! * 0.15;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = Math.round(v * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Linear → sRGB. Instance and vertex colours are linear in the three.js version (which encodes its
 * output to sRGB); Babylon's StandardMaterial works in gamma space, so they are converted once here.
 * (Hex material colours are sRGB in both.)
 */
const toGamma = (c: number): number => Math.pow(Math.max(0, c), 1 / 2.2);

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
  readonly terrain: Terrain;
  private readonly scene: Scene;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly treeSlots = new Map<Tree, TreeSlot>();
  private felledSeen = 0;
  private water!: ShaderMaterial;
  private readonly mask: RawTexture;
  private readonly maskData: Uint8Array;
  private maskVersion = -1;
  /** Meshes that cast and receive shadows (trees, rocks, bushes) and the ground, which receives. */
  readonly casters: Mesh[] = [];
  readonly receivers: Mesh[] = [];

  constructor(scene: Scene, terrain: Terrain) {
    this.scene = scene;
    this.terrain = terrain;
    const S = terrain.size;
    this.maskData = new Uint8Array(S * S);
    this.mask = this.keep(new RawTexture(this.maskData, S, S, Constants.TEXTUREFORMAT_R, scene, false, false, Texture.NEAREST_SAMPLINGMODE));
    this.mask.wrapU = this.mask.wrapV = Texture.CLAMP_ADDRESSMODE;
    foliageMask.texture = this.mask;
    foliageMask.size = S;
    this.buildGround();
    this.buildWater();
    this.buildTrees();
    this.buildDoodads();
    this.buildGrass();
  }

  /** Sun (direction towards it, colour × strength) and sky colour for the water. */
  setWaterLight(toSun: Vector3, sun: Color3, sky: Color3): void {
    this.water.setVector3('uSunDir', toSun);
    this.water.setColor3('uSunColor', sun);
    this.water.setColor3('uSkyColor', sky);
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
    FoliagePlugin.time = time;
    const fog = FogOfWar.current;
    if (fog) this.water.setTexture('uFogTex', fog.texture);
    const felled = this.terrain.felled;
    while (this.felledSeen < felled.length) this.fellTree(felled[this.felledSeen++]!);
  }

  dispose(): void {
    if (foliageMask.texture === this.mask) foliageMask.texture = null;
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
    // The flat colour map is still painted: the minimap draws it.
    if (!t.textureCanvas) t.paintTexture();
    new GroundSplatPlugin(material, t);
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
          uniforms: ['world', 'viewProjection', 'uTime', 'uWorldSize', 'uLinear', 'uCamPos', 'uHazeColor', 'uHazeRange', 'uSunDir', 'uSunColor', 'uSkyColor'],
          samplers: ['uFogTex', 'uDepthTex', 'uNoiseTex'],
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
    material.setVector3('uSunDir', new Vector3(0.4, 0.8, 0.4).normalize());
    material.setColor3('uSunColor', Color3.White());
    material.setColor3('uSkyColor', new Color3(0.6, 0.75, 0.9));
    // Depth below the surface at each height-map corner (0-2.5 units).
    const t = this.terrain;
    const n = S + 1;
    const depth = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      depth[i * 4] = Math.round(Math.max(0, Math.min(1, (WATER_LEVEL - t.heights[i]!) / 2.5)) * 255);
      depth[i * 4 + 3] = 255;
    }
    const depthTex = this.keep(new RawTexture(depth, n, n, Constants.TEXTUREFORMAT_RGBA, this.scene, false, false, Texture.BILINEAR_SAMPLINGMODE));
    depthTex.wrapU = depthTex.wrapV = Texture.CLAMP_ADDRESSMODE;
    material.setTexture('uDepthTex', depthTex);
    const noiseTex = this.keep(new RawTexture(waterNoise(), 256, 256, Constants.TEXTUREFORMAT_RGBA, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE));
    noiseTex.wrapU = noiseTex.wrapV = Texture.WRAP_ADDRESSMODE;
    material.setTexture('uNoiseTex', noiseTex);
    mesh.material = material;
    this.water = material;
  }

  private buildTrees(): void {
    const sc = this.scene;
    const shapes = [pineGeo(), broadleafGeo(), deadTreeGeo()];
    const bases = shapes.map((sh, i) => ({ trunk: this.keep(geoMesh(`trunk-${i}`, sh.trunk, sc)), canopy: this.keep(geoMesh(`canopy-${i}`, sh.canopy, sc)) }));
    const bark = this.keep(foliageMaterial(sc, 'bark', { channel: [0, 0, 1, 0], scale: 1.6, hue: 0.4 }, Color3.FromHexString('#7d5833')));
    const deadBark = this.keep(foliageMaterial(sc, 'bark-dead', { channel: [0, 0, 1, 0], scale: 1.6, hue: 0.3 }, Color3.FromHexString('#5b4a5a')));
    const needles = this.keep(foliageMaterial(sc, 'needles', { channel: [0, 1, 0, 0], scale: 0.6, hue: 0.5, wind: 0.025, windFrom: 1.0 }));
    const leaves = this.keep(foliageMaterial(sc, 'leaves', { channel: [1, 0, 0, 0], scale: 0.55, hue: 0.85, wind: 0.035, windFrom: 1.2 }));
    const trunkMats = [bark, bark, deadBark];
    const canopyMats = [needles, leaves, deadBark];
    for (const b of bases) {
      b.trunk.setEnabled(false);
      b.canopy.setEnabled(false);
    }
    // Canopy colours (sRGB): deep blue-green pines, lush summer broadleaves. The simulation's tint
    // varies each tree around these.
    const base: Array<[number, number, number]> = [
      [0.25, 0.53, 0.31],
      [0.38, 0.64, 0.19],
      [1, 1, 1],
    ];
    const mean: Array<[number, number, number]> = [
      [0.155, 0.41, 0.185],
      [0.32, 0.56, 0.165],
      [0.32, 0.27, 0.3],
    ];

    // Batch per 32×32-cell chunk and species, so off-screen forests are culled.
    const chunksPerSide = Math.ceil(this.terrain.size / CHUNK);
    const buckets = new Map<string, Tree[]>();
    for (const t of this.terrain.trees) {
      const key = `${Math.floor(t.cx / CHUNK) + Math.floor(t.cz / CHUNK) * chunksPerSide}:${t.species}`;
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(t);
    }
    for (const [key, list] of buckets) {
      const s = list[0]!.species;
      const trunks = this.keep(bases[s]!.trunk.clone(`trunks-${key}`));
      const canopy = this.keep(bases[s]!.canopy.clone(`canopy-${key}`));
      trunks.material = trunkMats[s]!;
      canopy.material = canopyMats[s]!;
      const matrices = new Float32Array(list.length * 16);
      const colors = new Float32Array(list.length * 4);
      list.forEach((t, i) => {
        // Each tree a little wider or taller than the next.
        const h1 = (Math.sin(t.cx * 12.9898 + t.cz * 78.233) * 43758.5453) % 1;
        const h2 = (Math.sin(t.cx * 39.346 + t.cz * 11.135) * 24634.6345) % 1;
        const w = t.scale * (0.92 + 0.16 * Math.abs(h1));
        const h = t.scale * (0.92 + 0.22 * Math.abs(h2));
        compose(t.x, this.terrain.heightAt(t.x, t.z) - 0.05, t.z, 0, t.rot, 0, w, h, w).copyToArray(matrices, i * 16);
        const b = base[s]!;
        const m = mean[s]!;
        const v = Math.max(0.82, Math.min(1.18, t.tint[1] / m[1]));
        const warm = Math.max(-0.15, Math.min(0.15, t.tint[0] / m[0] - 1));
        colors.set([b[0] * v * (1 + warm), b[1] * v, b[2] * v * (1 - warm), 1], i * 4);
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
      }
      // Canopies carry their own painted shading; shadows from the next tree would make the forest
      // a black mass. Trunks stand in the canopy's shade.
      this.receivers.push(trunks);
      canopy.thinInstanceSetBuffer('color', colors, 4, true);
    }
  }

  /** A felled tree leaves a low stump and no canopy. */
  private fellTree(tree: Tree): void {
    const slot = this.treeSlots.get(tree);
    if (!slot) return;
    const y = this.terrain.heightAt(tree.x, tree.z) - 0.05;
    slot.trunks.thinInstanceSetMatrixAt(slot.index, compose(tree.x, y, tree.z, 0, 0, 0, tree.scale * 1.1, 0.16, tree.scale * 1.1), true);
    slot.canopy.thinInstanceSetMatrixAt(slot.index, compose(tree.x, y, tree.z, 0, 0, 0, 0, 0, 0), true);
  }

  /** Thin instances of `mesh` (one draw call); it casts shadows if asked and receives them if `receive`. */
  private place(mesh: Mesh, matrices: Float32Array, colors: Float32Array | null, cast: boolean, receive = true): void {
    this.keep(mesh);
    mesh.isPickable = false;
    if (!matrices.length) {
      mesh.setEnabled(false);
      return;
    }
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
    if (colors) mesh.thinInstanceSetBuffer('color', colors, 4, true);
    mesh.thinInstanceRefreshBoundingInfo(false);
    if (cast) this.casters.push(mesh);
    if (receive) this.receivers.push(mesh);
  }

  private buildDoodads(): void {
    const sc = this.scene;
    const t = this.terrain;
    const d = t.doodads ?? t.scatterDoodads();
    const stone = this.keep(foliageMaterial(sc, 'boulder', { channel: [0, 0, 0, 1], scale: 0.9, hue: 0.35, moss: 0.9 }));
    const leafy = this.keep(foliageMaterial(sc, 'bush', { channel: [1, 0, 0, 0], scale: 0.8, hue: 0.85, wind: 0.02, windFrom: 0.3 }));
    const stemMat = this.keep(foliageMaterial(sc, 'flower-stems', { channel: [0, 0, 0, 0], scale: 1, hue: 0, lift: 0.62, wind: 0.12, masked: true }, Color3.White(), true));
    const headMat = this.keep(foliageMaterial(sc, 'flower-heads', { channel: [0, 0, 0, 0], scale: 1, hue: 0.3, lift: 0.72, wind: 0.12, masked: true }, Color3.White(), true));

    const rock = geoMesh('boulders', boulderGeo(), sc);
    rock.material = stone;
    const rm = new Float32Array(d.rocks.length * 16);
    const rc = new Float32Array(d.rocks.length * 4);
    d.rocks.forEach((p, i) => {
      compose(p.x, p.y, p.z, p.rot[0], p.rot[1], p.rot[2], p.scale[0], p.scale[1], p.scale[2]).copyToArray(rm, i * 16);
      const v = toGamma(p.color[0]) * 0.8;
      rc.set([v, v * 0.96, v * 0.9, 1], i * 4);
    });
    this.place(rock, rm, rc, true);

    const bush = geoMesh('bushes', bushGeo(), sc);
    bush.material = leafy;
    const bm = new Float32Array(d.bushes.length * 16);
    const bc = new Float32Array(d.bushes.length * 4);
    d.bushes.forEach((p, i) => {
      compose(p.x, t.heightAt(p.x, p.z) - 0.04, p.z, 0, p.rot[1], 0, p.scale[0], p.scale[1], p.scale[2]).copyToArray(bm, i * 16);
      const v = Math.max(0.85, Math.min(1.15, p.color[1] / 0.44));
      bc.set([0.33 * v, 0.58 * v, 0.17 * v, 1], i * 4);
    });
    this.place(bush, bm, bc, true, false);

    const { stems, heads } = flowerGeo();
    const stemMesh = geoMesh('flower-stems', stems, sc);
    const headMesh = geoMesh('flower-heads', heads, sc);
    stemMesh.material = stemMat;
    headMesh.material = headMat;
    const fm = new Float32Array(d.flowers.length * 16);
    const fc = new Float32Array(d.flowers.length * 4);
    d.flowers.forEach((p, i) => {
      compose(p.x, t.heightAt(p.x, p.z) - 0.01, p.z, 0, p.rot[1], 0, p.scale[0], p.scale[0], p.scale[0]).copyToArray(fm, i * 16);
      fc.set([p.color[0], p.color[1], p.color[2], 1], i * 4);
    });
    this.place(stemMesh, fm, null, false);
    this.place(headMesh, fm.slice(), fc, false);
  }

  /** Grass tufts over the meadows (fewer on the forest floor and on dirt), batched per chunk. */
  private buildGrass(): void {
    const sc = this.scene;
    const t = this.terrain;
    const S = t.size;
    const mat = this.keep(foliageMaterial(sc, 'grass-tufts', { channel: [0, 0, 0, 0], scale: 1, hue: 0.5, lift: 0.6, wind: 0.16, masked: true }, Color3.White(), true));
    const proto = this.keep(geoMesh('grass-tuft', grassTuftGeo(), sc));
    proto.setEnabled(false);
    let seed = 0x1234567;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const chance: Record<number, number> = { [T_GRASS]: 0.6, [T_FOREST]: 0.18, [T_DIRT]: 0.14, [T_SHORE]: 0.05 };
    const chunksPerSide = Math.ceil(S / CHUNK);
    const buckets = new Map<number, number[]>();
    for (let cz = 1; cz < S - 1; cz++) {
      for (let cx = 1; cx < S - 1; cx++) {
        const p = chance[t.types[cz * S + cx]!] ?? 0;
        for (let k = 0; k < 2; k++) {
          if (rand() >= p * 0.6) continue;
          const x = cx + rand();
          const z = cz + rand();
          if (t.heightAt(x, z) < WATER_LEVEL + 0.08 || t.isNearFlatSpot(x, z)) continue;
          const key = Math.floor(cx / CHUNK) + Math.floor(cz / CHUNK) * chunksPerSide;
          let list = buckets.get(key);
          if (!list) buckets.set(key, (list = []));
          list.push(x, z, t.types[cz * S + cx]!);
        }
      }
    }
    for (const [key, list] of buckets) {
      const n = list.length / 3;
      const matrices = new Float32Array(n * 16);
      const colors = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const x = list[i * 3]!;
        const z = list[i * 3 + 1]!;
        const type = list[i * 3 + 2]!;
        const s = 0.8 + rand() * 0.7;
        compose(x, t.heightAt(x, z) - 0.02, z, 0, rand() * Math.PI * 2, 0, s, s * (0.85 + rand() * 0.4), s).copyToArray(matrices, i * 16);
        const v = 0.85 + rand() * 0.3;
        const c = type === T_FOREST ? [0.26, 0.45, 0.13] : type === T_DIRT || type === T_SHORE ? [0.42, 0.56, 0.2] : [0.38, 0.62, 0.17];
        colors.set([c[0]! * v * (0.9 + rand() * 0.2), c[1]! * v, c[2]! * v, 1], i * 4);
      }
      const m = proto.clone(`grass-${key}`);
      m.makeGeometryUnique();
      m.setEnabled(true);
      m.material = mat;
      this.place(m, matrices, colors, false);
    }
  }

  /** The foliage mask: grass and flowers hide where a building, gate or road now stands. */
  updateClearMask(roads: Roads | null): void {
    const grid = this.terrain.grid;
    const version = grid.version * 100003 + (roads?.version ?? 0);
    if (version === this.maskVersion) return;
    this.maskVersion = version;
    const S = this.terrain.size;
    const data = this.maskData;
    for (let i = 0; i < S * S; i++) {
      const blocked = (grid.flags[i]! & (BLOCK_BUILDING | BLOCK_GATE)) !== 0 || (roads !== null && roads.owner[i]! >= 0);
      data[i] = blocked ? 255 : 0;
    }
    this.mask.update(data);
  }
}

/** The road surface, rebuilt when the road network or a general's age changes. */
export class RoadView {
  readonly roads: Roads;
  private readonly game: Game;
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly texture: DynamicTexture;
  private version = -1;

  constructor(scene: Scene, roads: Roads, game: Game) {
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
