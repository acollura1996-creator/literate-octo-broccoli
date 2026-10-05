// Foliage and props (M13): trees, bushes, boulders, grass tufts and flowers in the Warcraft III
// manner: full, rounded shapes with painted detail instead of faceted low-poly solids.
//
// - Canopies are clusters of lumpy blobs with "soft" normals (bent toward the canopy centre), so
//   the light wraps around them like a painted tree rather than revealing facets. Vertex colours
//   carry ambient occlusion: darker underneath and inside.
// - The FoliagePlugin paints a greyscale texture (leaf clusters, needles, bark or stone, from
//   GroundPaint.ts) triplanar in object space, turning it into warm sunlit and cool shaded colour,
//   adds moss to the tops of stones, and sways canopies and grass in the wind. Grass and flowers
//   also read a per-cell mask and hide where buildings and roads stand.
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateIcoSphereVertexData } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Scene } from '@babylonjs/core/scene';
import { GROUND_TEX_SIZE, foliagePixels } from './GroundPaint';

// ------------------------------------------------------------------------------------ geometry

/** Plain geometry arrays: positions, normals, RGBA colours, indices. */
export interface Geo {
  p: number[];
  n: number[];
  c: number[];
  i: number[];
}

const newGeo = (): Geo => ({ p: [], n: [], c: [], i: [] });

function append(dst: Geo, src: Geo): void {
  const base = dst.p.length / 3;
  dst.p.push(...src.p);
  dst.n.push(...src.n);
  dst.c.push(...src.c);
  for (const k of src.i) dst.i.push(k + base);
}

export function geoMesh(name: string, g: Geo, scene: Scene): Mesh {
  const vd = new VertexData();
  vd.positions = g.p;
  vd.normals = g.n;
  vd.colors = g.c;
  vd.indices = g.i;
  const m = new Mesh(name, scene);
  vd.applyToMesh(m, false);
  return m;
}

/** Deterministic pseudo-random numbers for the shapes. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** Smooth lumpy wobble on the unit sphere. */
function lump(x: number, y: number, z: number, seed: number): number {
  return Math.sin(x * 3.1 + seed) * Math.sin(y * 2.7 + seed * 1.7) * Math.sin(z * 3.3 + seed * 0.6) + 0.5 * Math.sin(x * 5.3 - z * 4.1 + seed * 2.3);
}

interface Blob {
  x: number;
  y: number;
  z: number;
  r: number;
}

/**
 * A cluster of lumpy spheres with soft normals bent toward the cluster centre and ambient
 * occlusion in the vertex colours (dark at the bottom, `low` .. 1 from `y0` to `y1`).
 */
function blobCluster(blobs: Blob[], centre: [number, number, number], y0: number, y1: number, opts: { subdivisions?: number; bumpiness?: number; soften?: number; low?: number; squash?: number } = {}): Geo {
  const g = newGeo();
  const sph = CreateIcoSphereVertexData({ radius: 1, subdivisions: opts.subdivisions ?? 2, flat: false });
  const sp = sph.positions!;
  const si = sph.indices!;
  const bump = opts.bumpiness ?? 0.16;
  const soften = opts.soften ?? 0.75;
  const low = opts.low ?? 0.55;
  const squash = opts.squash ?? 0.85;
  let maxD = 0;
  for (const b of blobs) maxD = Math.max(maxD, Math.hypot(b.x - centre[0], (b.y - centre[1]) / squash, b.z - centre[2]) + b.r);
  blobs.forEach((b, bi) => {
    const part = newGeo();
    for (let k = 0; k < sp.length; k += 3) {
      const ux = sp[k]!;
      const uy = sp[k + 1]!;
      const uz = sp[k + 2]!;
      const r = b.r * (1 + bump * lump(ux, uy, uz, bi * 2.17 + 0.5));
      const x = b.x + ux * r;
      const y = b.y + uy * r * squash;
      const z = b.z + uz * r;
      const [cx, cy, cz] = normalize3(x - centre[0], (y - centre[1]) / squash, z - centre[2]);
      const n = normalize3(ux * (1 - soften) + cx * soften, uy * (1 - soften) + cy * soften + 0.15, uz * (1 - soften) + cz * soften);
      part.p.push(x, y, z);
      part.n.push(...n);
      const height = smooth(y0, y1, y);
      const outer = smooth(0.35, 1, Math.hypot(x - centre[0], (y - centre[1]) / squash, z - centre[2]) / maxD);
      const ao = (low + (1 - low) * Math.pow(height, 0.8)) * (0.8 + 0.2 * outer);
      part.c.push(ao, ao, ao, 1);
    }
    for (let k = 0; k < si.length; k += 3) part.i.push(si[k]!, si[k + 1]!, si[k + 2]!);
    append(g, part);
  });
  return g;
}

/** A tapered, slightly wavy cylinder between two points (trunks and branches). */
function limb(a: [number, number, number], b: [number, number, number], r0: number, r1: number, sides: number, ao: [number, number], flare = 0): Geo {
  const g = newGeo();
  const d = normalize3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  // Two axes perpendicular to the limb.
  const ref: [number, number, number] = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize3(d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]);
  const v: [number, number, number] = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const rings = 4;
  for (let ri = 0; ri <= rings; ri++) {
    const t = ri / rings;
    const r = (r0 + (r1 - r0) * t) * (1 + flare * Math.pow(1 - t, 3));
    const cx = a[0] + (b[0] - a[0]) * t;
    const cy = a[1] + (b[1] - a[1]) * t;
    const cz = a[2] + (b[2] - a[2]) * t;
    const shade = ao[0] + (ao[1] - ao[0]) * t;
    for (let s = 0; s <= sides; s++) {
      const ang = (s / sides) * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const wob = 1 + 0.08 * Math.sin(ang * 3 + ri * 1.9);
      const nx = u[0] * ca + v[0] * sa;
      const ny = u[1] * ca + v[1] * sa;
      const nz = u[2] * ca + v[2] * sa;
      g.p.push(cx + nx * r * wob, cy + ny * r * wob, cz + nz * r * wob);
      g.n.push(nx, ny, nz);
      g.c.push(shade, shade, shade, 1);
    }
  }
  const row = sides + 1;
  for (let ri = 0; ri < rings; ri++) {
    for (let s = 0; s < sides; s++) {
      const p0 = ri * row + s;
      const p1 = p0 + 1;
      const p2 = p0 + row;
      const p3 = p2 + 1;
      // Babylon's front faces wind clockwise as seen from outside.
      g.i.push(p0, p2, p1, p1, p2, p3);
    }
  }
  return g;
}

/** Broadleaf (Lordaeron summer) tree: a stout trunk and a full canopy of seven lumps. */
export function broadleafGeo(): { trunk: Geo; canopy: Geo } {
  const trunk = newGeo();
  append(trunk, limb([0, -0.1, 0], [0.02, 1.55, 0.03], 0.19, 0.11, 7, [0.55, 0.9], 0.9));
  append(trunk, limb([0.02, 1.05, 0.02], [0.42, 1.75, 0.12], 0.08, 0.04, 5, [0.75, 0.9]));
  append(trunk, limb([0.0, 1.15, 0.0], [-0.38, 1.8, -0.2], 0.07, 0.035, 5, [0.75, 0.9]));
  const blobs: Blob[] = [
    { x: 0, y: 2.15, z: 0, r: 0.92 },
    { x: 0.62, y: 1.85, z: 0.18, r: 0.68 },
    { x: -0.58, y: 1.9, z: -0.22, r: 0.7 },
    { x: 0.12, y: 1.82, z: 0.64, r: 0.62 },
    { x: -0.24, y: 1.88, z: 0.5, r: 0.55 },
    { x: 0.2, y: 1.9, z: -0.62, r: 0.6 },
    { x: 0.05, y: 2.8, z: 0.05, r: 0.62 },
  ];
  const canopy = blobCluster(blobs, [0, 2.1, 0], 1.25, 3.3, { subdivisions: 2, bumpiness: 0.18, soften: 0.7 });
  return { trunk, canopy };
}

/** Pine: five drooping tiers of needles around a thin trunk. */
export function pineGeo(): { trunk: Geo; canopy: Geo } {
  const trunk = limb([0, -0.1, 0], [0, 1.4, 0], 0.13, 0.07, 6, [0.5, 0.85], 0.7);
  const canopy = newGeo();
  const rand = rng(77);
  const tiers = 5;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const y = 0.85 + k * 0.52;
    const R = 1.12 - t * 0.78;
    const H = 0.95 - t * 0.2;
    const tier = newGeo();
    const spokes = 12;
    // Apex, then an outer ring (alternating long and short tips that droop), then an inner
    // underside ring that closes the skirt.
    tier.p.push(0, y + H, 0);
    tier.n.push(0, 1, 0);
    const topAo = 0.95;
    tier.c.push(topAo, topAo, topAo, 1);
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2 + k * 0.4 + rand() * 0.15;
      const long = s % 2 === 0;
      const r = R * (long ? 1 : 0.8) * (0.92 + rand() * 0.16);
      const droop = long ? 0.14 : 0.05;
      const [nx, ny, nz] = normalize3(Math.cos(a), 0.9, Math.sin(a));
      tier.p.push(Math.cos(a) * r, y - droop, Math.sin(a) * r);
      tier.n.push(nx, ny, nz);
      const ao = 0.68 + 0.22 * t + (long ? 0.1 : 0);
      tier.c.push(ao, ao, ao, 1);
    }
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2;
      tier.p.push(Math.cos(a) * R * 0.3, y + 0.18, Math.sin(a) * R * 0.3);
      tier.n.push(0, -1, 0);
      tier.c.push(0.42, 0.42, 0.42, 1);
    }
    for (let s = 0; s < spokes; s++) {
      const o0 = 1 + s;
      const o1 = 1 + ((s + 1) % spokes);
      const i0 = 1 + spokes + s;
      const i1 = 1 + spokes + ((s + 1) % spokes);
      tier.i.push(0, o0, o1);
      tier.i.push(o0, i0, o1, o1, i0, i1);
    }
    append(canopy, tier);
  }
  // A small crown at the top.
  append(canopy, blobCluster([{ x: 0, y: 3.15, z: 0, r: 0.16 }], [0, 3.1, 0], 2.9, 3.3, { subdivisions: 1, bumpiness: 0, low: 0.8 }));
  return { trunk, canopy };
}

/** Blighted dead tree: a crooked trunk with bare, upward-clawing branches. */
export function deadTreeGeo(): { trunk: Geo; canopy: Geo } {
  const trunk = newGeo();
  append(trunk, limb([0, -0.1, 0], [0.05, 1.0, 0.02], 0.17, 0.12, 6, [0.5, 0.75], 0.8));
  append(trunk, limb([0.05, 1.0, 0.02], [-0.08, 2.1, 0.05], 0.12, 0.05, 6, [0.75, 0.9]));
  const canopy = newGeo();
  const branches: Array<[[number, number, number], [number, number, number], number]> = [
    [[0.04, 1.2, 0.02], [0.75, 2.0, 0.15], 0.06],
    [[0.0, 1.45, 0.03], [-0.7, 2.2, -0.1], 0.055],
    [[-0.03, 1.7, 0.04], [0.15, 2.45, 0.7], 0.05],
    [[-0.05, 1.9, 0.05], [-0.25, 2.6, -0.6], 0.045],
    [[0.75, 2.0, 0.15], [1.0, 2.5, 0.05], 0.03],
    [[-0.7, 2.2, -0.1], [-0.95, 2.6, 0.15], 0.028],
  ];
  for (const [a, b, r] of branches) append(canopy, limb(a, b, r, r * 0.35, 5, [0.75, 0.95]));
  return { trunk, canopy };
}

/** A bush: three or four leafy lumps sitting on the ground. */
export function bushGeo(): Geo {
  return blobCluster(
    [
      { x: 0, y: 0.45, z: 0, r: 0.62 },
      { x: 0.5, y: 0.32, z: 0.15, r: 0.45 },
      { x: -0.42, y: 0.34, z: -0.18, r: 0.48 },
      { x: 0.05, y: 0.3, z: 0.48, r: 0.4 },
    ],
    [0, 0.35, 0],
    -0.1,
    1.0,
    { subdivisions: 2, bumpiness: 0.2, soften: 0.6, low: 0.5 },
  );
}

/** A boulder: a lumpy, flattened, smooth-shaded stone. */
export function boulderGeo(): Geo {
  return blobCluster([{ x: 0, y: 0, z: 0, r: 1 }], [0, 0, 0], -0.7, 0.7, { subdivisions: 2, bumpiness: 0.24, soften: 0.25, low: 0.55, squash: 0.7 });
}

/** A grass tuft: seven bent blades fanning out, dark at the root and sunlit at the tip. */
export function grassTuftGeo(): Geo {
  const g = newGeo();
  const rand = rng(4242);
  const blades = 7;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rand() * 0.6;
    const ox = Math.cos(a) * 0.05 * rand();
    const oz = Math.sin(a) * 0.05 * rand();
    const len = 0.28 + rand() * 0.22;
    const lean = 0.35 + rand() * 0.35;
    const w = 0.035 + rand() * 0.015;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // Across-blade direction.
    const px = -dz * w;
    const pz = dx * w;
    const base = g.p.length / 3;
    const seg = [0, 0.55, 1];
    seg.forEach((t, si) => {
      const bend = lean * t * t;
      const cx = ox + dx * bend * len;
      const cz = oz + dz * bend * len;
      const cy = len * t * (1 - 0.25 * t * lean);
      const k = 1 - t * 0.85;
      if (si < 2) {
        g.p.push(cx - px * k, cy, cz - pz * k, cx + px * k, cy, cz + pz * k);
        g.n.push(0, 1, 0, 0, 1, 0);
        const ao = 0.45 + 0.55 * t;
        g.c.push(ao, ao, ao, 1, ao, ao, ao, 1);
      } else {
        g.p.push(cx, cy, cz);
        g.n.push(0, 1, 0);
        g.c.push(1.05, 1.05, 1.05, 1);
      }
    });
    g.i.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  return g;
}

/** Flower clump: stems (in `stems`) and five-petal heads (in `heads`, tinted per instance). */
export function flowerGeo(): { stems: Geo; heads: Geo } {
  const stems = newGeo();
  const heads = newGeo();
  const rand = rng(9001);
  for (let f = 0; f < 4; f++) {
    const a = rand() * Math.PI * 2;
    const r = 0.06 + rand() * 0.12;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 0.16 + rand() * 0.12;
    // Stem: a thin quad (two triangles), green (white instance colour keeps it green).
    const base = stems.p.length / 3;
    stems.p.push(x - 0.012, 0, z, x + 0.012, 0, z, x - 0.008, h, z, x + 0.008, h, z);
    stems.n.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    stems.c.push(0.2, 0.36, 0.1, 1, 0.2, 0.36, 0.1, 1, 0.36, 0.58, 0.18, 1, 0.36, 0.58, 0.18, 1);
    stems.i.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    // Head: a centre and five petals.
    const hb = heads.p.length / 3;
    heads.p.push(x, h + 0.015, z);
    heads.n.push(0, 1, 0);
    heads.c.push(1, 0.85, 0.35, 1);
    const pr = 0.045 + rand() * 0.02;
    for (let k = 0; k < 10; k++) {
      const pa = (k / 10) * Math.PI * 2;
      const rr = k % 2 === 0 ? pr : pr * 0.45;
      heads.p.push(x + Math.cos(pa) * rr, h + (k % 2 === 0 ? 0.0 : 0.012), z + Math.sin(pa) * rr);
      heads.n.push(0, 1, 0);
      heads.c.push(1, 1, 1, 1);
    }
    for (let k = 0; k < 10; k++) heads.i.push(hb, hb + 1 + k, hb + 1 + ((k + 1) % 10));
  }
  return { stems, heads };
}

// ------------------------------------------------------------------------------------- shader

/** Which painted channel a material uses and how it is shaded. */
export interface FoliageSpec {
  /** Weights of the painting's channels: R leaves, G needles, B bark, A stone. */
  channel: [number, number, number, number];
  /** Painting repeats per unit (object space). */
  scale: number;
  /** Warm-light / cool-shade colour shift (0-1). */
  hue: number;
  /** Moss on upward faces (0-1). */
  moss?: number;
  /** Constant added to the painted value (grass and flowers use no painting). */
  lift?: number;
  /** Wind sway at 1 unit above `windFrom` (object space height). */
  wind?: number;
  windFrom?: number;
  /** Hide where the clear mask is set (buildings, roads). */
  masked?: boolean;
}

let paintingPixels: Uint8Array | null = null;
const paintings = new WeakMap<Scene, RawTexture>();

function foliageTexture(scene: Scene): RawTexture {
  let t = paintings.get(scene);
  if (!t) {
    paintingPixels ??= foliagePixels();
    t = new RawTexture(paintingPixels, GROUND_TEX_SIZE, GROUND_TEX_SIZE, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 4;
    paintings.set(scene, t);
  }
  return t;
}

/** The clear mask (R: 1 where a building or road stands) and its map size, shared by all foliage. */
export const foliageMask: { texture: RawTexture | null; size: number } = { texture: null, size: 256 };

export class FoliagePlugin extends MaterialPluginBase {
  /** Seconds, for the wind (set each frame by the terrain view). */
  static time = 0;
  private readonly texture: RawTexture;

  constructor(
    material: Material,
    private readonly spec: FoliageSpec,
  ) {
    super(material, 'Foliage', 170, { FOLIAGE: false, FOLIAGEMASK: false }, true, true);
    this.texture = foliageTexture(material.getScene());
  }

  override getClassName(): string {
    return 'FoliagePlugin';
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['FOLIAGE'] = true;
    defines['FOLIAGEMASK'] = !!this.spec.masked;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('folTex', 'folMask');
  }

  override getUniforms() {
    const decl = `#ifdef FOLIAGE
        uniform vec4 folChannel;
        uniform vec4 folParams;
        uniform vec4 folWind;
      #endif`;
    return {
      ubo: [
        { name: 'folChannel', size: 4, type: 'vec4' },
        { name: 'folParams', size: 4, type: 'vec4' },
        { name: 'folWind', size: 4, type: 'vec4' },
      ],
      vertex: decl,
      fragment: decl,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    const s = this.spec;
    uniformBuffer.updateFloat4('folChannel', ...s.channel);
    uniformBuffer.updateFloat4('folParams', s.scale, s.hue, s.moss ?? 0, s.lift ?? 0);
    uniformBuffer.updateFloat4('folWind', s.wind ?? 0, s.windFrom ?? 0, FoliagePlugin.time, foliageMask.size);
    uniformBuffer.setTexture('folTex', this.texture);
    if (s.masked && foliageMask.texture) uniformBuffer.setTexture('folMask', foliageMask.texture);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef FOLIAGE
          varying vec3 vFolPos;
          varying vec3 vFolNrm;
        #ifdef FOLIAGEMASK
          uniform sampler2D folMask;
        #endif
        #endif`,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `#ifdef FOLIAGE
          {
            float sway = folWind.x * max(positionUpdated.y - folWind.y, 0.0);
            worldPos.x += sway * sin(folWind.z * 1.7 + worldPos.x * 0.37 + worldPos.z * 0.23);
            worldPos.z += sway * 0.6 * sin(folWind.z * 1.3 + worldPos.z * 0.31 + worldPos.x * 0.19);
          #ifdef FOLIAGEMASK
            // Sink the whole clump below the ground where a building or road stands.
            vec3 root = finalWorld[3].xyz;
            if (texture2D(folMask, root.xz / folWind.w).r > 0.5) worldPos.xyz = root - vec3(0.0, 2.0, 0.0);
          #endif
          }
        #endif`,
        CUSTOM_VERTEX_MAIN_END: `#ifdef FOLIAGE
          vFolPos = positionUpdated;
          vFolNrm = normalUpdated;
        #endif`,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef FOLIAGE
        uniform sampler2D folTex;
        varying vec3 vFolPos;
        varying vec3 vFolNrm;
      #endif`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef FOLIAGE
        {
          vec3 fn = normalize(vFolNrm);
          vec3 tw = abs(fn);
          tw = tw * tw * tw * tw;
          tw /= max(1e-4, tw.x + tw.y + tw.z);
          vec3 fp = vFolPos * folParams.x;
          vec4 t = texture2D(folTex, fp.zy) * tw.x + texture2D(folTex, fp.xz) * tw.y + texture2D(folTex, fp.xy) * tw.z;
          float lum = clamp(dot(t, folChannel) + folParams.w, 0.0, 1.0);
          vec3 c = baseColor.rgb * (0.5 + 1.05 * lum);
          // Painted light: warm, yellowed highlights and cool, bluish shade.
          c = mix(c, c * vec3(1.2, 1.12, 0.68), smoothstep(0.55, 0.95, lum) * folParams.y);
          c = mix(c, c * vec3(0.75, 0.92, 1.18), smoothstep(0.45, 0.08, lum) * folParams.y);
          // Moss on the upper faces of stones.
          float moss = smoothstep(0.35, 0.8, fn.y) * smoothstep(0.3, 0.55, t.a) * folParams.z;
          c = mix(c, vec3(0.3, 0.44, 0.13) * (0.55 + 0.7 * lum), moss);
          baseColor.rgb = c;
        }
      #endif`,
    };
  }
}

/** A foliage material: white diffuse (the instance and vertex colours carry the colour). */
export function foliageMaterial(scene: Scene, name: string, spec: FoliageSpec, diffuse = Color3.White(), twoSided = false): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = diffuse;
  m.specularColor = Color3.Black();
  m.backFaceCulling = !twoSided;
  new FoliagePlugin(m, spec);
  return m;
}
