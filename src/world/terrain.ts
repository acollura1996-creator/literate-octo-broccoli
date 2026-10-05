// Terrain generation: heightmap, ground classification, the painted ground map (Lordaeron Summer
// look with a blighted citadel), trees and decorative doodads. Engine-free: the meshes are built by
// the renderers from this data.
import { fbm, valueNoise, mulberry32, smoothstep, distToSegment } from './noise.ts';
import { MAP_SIZE, CENTER, CITADEL, MOAT } from './layout.ts';
import type { Layout } from './layout.ts';
import { BLOCK_TERRAIN, BLOCK_TREE } from './pathgrid.ts';
import type { PathGrid } from './pathgrid.ts';

/** Linear-ish colour channels 0-1. */
export type Rgb = [number, number, number];
type Vec3 = [number, number, number];

export interface Tree {
  x: number;
  z: number;
  /** Cell it blocks. */
  cx: number;
  cz: number;
  lumber: number;
  alive: boolean;
  /** 0 pine, 1 broadleaf, 2 dead (blight). */
  species: number;
  scale: number;
  rot: number;
  tint: Rgb;
}

/** A rock, bush or flower: position, size `s`, rotation, stretch and colour. */
export interface Doodad {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: Vec3;
  scale: Vec3;
  color: Rgb;
}
export interface Doodads {
  rocks: Doodad[];
  bushes: Doodad[];
  flowers: Doodad[];
}
interface FlatSpot {
  x: number;
  z: number;
  radius: number;
}

export const WATER_LEVEL = -0.35;

// Ground types used for painting.
const T_GRASS = 0;
const T_FOREST = 1;
const T_ROAD = 2;
const T_DIRT = 3;
const T_COBBLE = 4;
const T_SHORE = 5;
const T_BLIGHT = 6;

const TYPE_COLORS: Record<number, Rgb> = {
  [T_GRASS]: [0.36, 0.56, 0.18],
  [T_FOREST]: [0.25, 0.4, 0.13],
  [T_ROAD]: [0.62, 0.5, 0.32],
  [T_DIRT]: [0.5, 0.41, 0.25],
  [T_COBBLE]: [0.5, 0.49, 0.45],
  [T_SHORE]: [0.55, 0.5, 0.33],
  [T_BLIGHT]: [0.3, 0.24, 0.33],
};

function moatInfo(x: number, z: number) {
  const dx = x - CENTER;
  const dz = z - CENTER;
  const r = Math.hypot(dx, dz);
  const ang = Math.atan2(dz, dx);
  const wobble = fbm(Math.cos(ang) * 2 + 10, Math.sin(ang) * 2 + 10, 7, 3) * 1.6;
  const inner = MOAT.inner + wobble;
  const outer = MOAT.outer + wobble;
  // Distance (in world units, along the arc) to the nearest diagonal ford.
  let fordDist = Infinity;
  for (let k = 0; k < 4; k++) {
    const fa = Math.PI / 4 + (k * Math.PI) / 2;
    let da = Math.abs(ang - fa);
    if (da > Math.PI) da = Math.PI * 2 - da;
    fordDist = Math.min(fordDist, da * r);
  }
  const inBand = r > inner && r < outer;
  const bandDist = inBand ? Math.min(r - inner, outer - r) : -Math.min(Math.abs(r - inner), Math.abs(r - outer));
  return { r, inner, outer, inBand, bandDist, fordDist, isFord: fordDist < MOAT.fordHalfWidth };
}

export class Terrain {
  readonly size: number;
  readonly layout: Layout;
  readonly grid: PathGrid;
  readonly seed: number;
  /** (MAP_SIZE + 1)² corner heights. */
  heights: Float32Array;
  /** Ground type per cell (T_*). */
  types: Uint8Array;
  /** Distance from each cell to the nearest map road. */
  roadDist = new Float32Array(MAP_SIZE * MAP_SIZE);
  trees: Tree[];
  treeByCell = new Map<number, Tree>();
  flatSpots: FlatSpot[];
  /** Trees cut down, in order (renderers replay this list). */
  felled: Tree[];
  doodads: Doodads | null;
  textureCanvas: HTMLCanvasElement | null = null;

  constructor(layout: Layout, grid: PathGrid, seed = 1337) {
    this.size = MAP_SIZE;
    this.layout = layout;
    this.grid = grid;
    this.seed = seed;
    const n = MAP_SIZE + 1;
    this.heights = new Float32Array(n * n);
    this.types = new Uint8Array(MAP_SIZE * MAP_SIZE);
    this.trees = [];
    this.flatSpots = [];
    this.felled = [];
    this.doodads = null;
  }

  /** Register a spot (center + radius) that should be flat (for buildings). */
  addFlatSpot(x: number, z: number, radius: number): void {
    this.flatSpots.push({ x, z, radius });
  }

  rawHeight(x: number, z: number): number {
    let h = 0.45 + fbm(x * 0.035, z * 0.035, this.seed, 4) * 0.9 + fbm(x * 0.12, z * 0.12, this.seed + 3, 2) * 0.15;
    // Keep the open land above the waterline (only the moat holds water).
    if (h < 0.1) h = 0.1 - (0.1 - h) * 0.15;
    const r = Math.hypot(x - CENTER, z - CENTER);
    // Central plateau.
    const plateau = smoothstep(21.5, 18.5, r);
    h = h * (1 - plateau) + 1.6 * plateau;
    // Moat.
    const m = moatInfo(x, z);
    if (m.r > m.inner - 2.5 && m.r < m.outer + 2.5) {
      const depthT = smoothstep(-2.0, 1.2, m.bandDist);
      const fordT = smoothstep(MOAT.fordHalfWidth + 2.5, MOAT.fordHalfWidth - 0.5, m.fordDist);
      const bed = -1.7 * (1 - fordT) + -0.5 * fordT;
      h = h * (1 - depthT) + bed * depthT;
    }
    // Map border rises a little (hills behind the forests).
    const edge = Math.min(x, z, MAP_SIZE - x, MAP_SIZE - z);
    h += smoothstep(6, 0, edge) * 1.5;
    return h;
  }

  generateHeights(): void {
    const n = MAP_SIZE + 1;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) this.heights[z * n + x] = this.rawHeight(x, z);
    // Flatten building spots.
    for (const s of this.flatSpots) {
      let sum = 0;
      let cnt = 0;
      const r0 = Math.ceil(s.radius);
      for (let z = Math.floor(s.z - r0); z <= s.z + r0; z++) {
        for (let x = Math.floor(s.x - r0); x <= s.x + r0; x++) {
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          sum += this.heights[z * n + x]!;
          cnt++;
        }
      }
      const target = cnt ? sum / cnt : 0;
      const outer = s.radius + 3;
      for (let z = Math.floor(s.z - outer); z <= s.z + outer; z++) {
        for (let x = Math.floor(s.x - outer); x <= s.x + outer; x++) {
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          const d = Math.hypot(x - s.x, z - s.z);
          const t = smoothstep(outer, s.radius, d);
          const i = z * n + x;
          this.heights[i] = this.heights[i]! * (1 - t) + target * t;
        }
      }
    }
  }

  heightAt(x: number, z: number): number {
    const n = MAP_SIZE + 1;
    x = Math.min(MAP_SIZE - 0.001, Math.max(0, x));
    z = Math.min(MAP_SIZE - 0.001, Math.max(0, z));
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const fx = x - xi;
    const fz = z - zi;
    const h = this.heights;
    const a = h[zi * n + xi]!;
    const b = h[zi * n + xi + 1]!;
    const c = h[(zi + 1) * n + xi]!;
    const d = h[(zi + 1) * n + xi + 1]!;
    return a * (1 - fx) * (1 - fz) + b * fx * (1 - fz) + c * (1 - fx) * fz + d * fx * fz;
  }

  /** Classify every cell and mark unwalkable water in the path grid. */
  classify(): void {
    const { roads } = this.layout;
    for (let cz = 0; cz < MAP_SIZE; cz++) {
      for (let cx = 0; cx < MAP_SIZE; cx++) {
        const x = cx + 0.5;
        const z = cz + 0.5;
        const i = cz * MAP_SIZE + cx;
        const h = this.heightAt(x, z);
        let t = T_GRASS;
        const r = Math.hypot(x - CENTER, z - CENTER);
        if (h < WATER_LEVEL - 0.05) t = T_SHORE;
        else if (h < WATER_LEVEL + 0.35) t = T_SHORE;
        // Roads
        let rd = Infinity;
        for (const road of roads) {
          for (let k = 0; k < road.length - 1; k++) {
            const a = road[k]!;
            const b = road[k + 1]!;
            rd = Math.min(rd, distToSegment(x, z, a[0], a[1], b[0], b[1]));
          }
        }
        this.roadDist[i] = rd;
        if (t === T_GRASS) {
          if (rd < 1.4) t = T_ROAD;
          else if (rd < 2.4 + valueNoise(x * 0.4, z * 0.4, 5) * 1.2) t = T_DIRT;
        }
        // Citadel cobbles and blight.
        const half = CITADEL.half;
        if (Math.abs(x - CENTER) < half + 0.5 && Math.abs(z - CENTER) < half + 0.5) t = T_COBBLE;
        else if (r < 23 + fbm(x * 0.2, z * 0.2, 9, 2) * 2 && t !== T_ROAD && t !== T_SHORE) t = T_BLIGHT;
        this.types[i] = t;
        // Deep water is unwalkable.
        if (h < -0.75) this.grid.setFlag(cx, cz, BLOCK_TERRAIN, true);
        // Map border.
        if (cx < 1 || cz < 1 || cx >= MAP_SIZE - 1 || cz >= MAP_SIZE - 1) this.grid.setFlag(cx, cz, BLOCK_TERRAIN, true);
      }
    }
  }

  /** Scatter forests. `keepClear(x, z)` returns true where trees must not grow. */
  plantTrees(keepClear: (x: number, z: number) => boolean): void {
    const rand = mulberry32(this.seed + 99);
    for (let cz = 1; cz < MAP_SIZE - 1; cz++) {
      for (let cx = 1; cx < MAP_SIZE - 1; cx++) {
        const x = cx + 0.5;
        const z = cz + 0.5;
        const i = cz * MAP_SIZE + cx;
        if (this.grid.flags[i] !== 0) continue;
        const t = this.types[i];
        if (t === T_ROAD || t === T_COBBLE || t === T_SHORE) continue;
        if (this.roadDist[i]! < 3.2) continue;
        if (keepClear(x, z)) continue;
        const edge = Math.min(x, z, MAP_SIZE - x, MAP_SIZE - z);
        const r = Math.hypot(x - CENTER, z - CENTER);
        if (r < MOAT.outer + 3.5) continue;
        const n = fbm(x * 0.07, z * 0.07, this.seed + 21, 3);
        let p = 0;
        if (edge < 7) p = 0.92;
        else if (edge < 10) p = 0.55;
        // Corner groves behind each base (lumber for the starting peasants).
        const cornerDist = Math.min(
          Math.hypot(x, z), Math.hypot(MAP_SIZE - x, z), Math.hypot(x, MAP_SIZE - z), Math.hypot(MAP_SIZE - x, MAP_SIZE - z),
        );
        if (cornerDist < 34) p = Math.max(p, 0.9);
        if (n > 0.24) p = Math.max(p, 0.75);
        else if (n > 0.15) p = Math.max(p, 0.2);
        if (rand() < p) {
          const species = t === T_BLIGHT ? 2 : rand() < 0.55 ? 0 : 1;
          this.trees.push({
            x: x + (rand() - 0.5) * 0.35,
            z: z + (rand() - 0.5) * 0.35,
            cx,
            cz,
            lumber: 50,
            alive: true,
            species,
            scale: 0.7 + rand() * 0.3,
            rot: rand() * Math.PI * 2,
            tint: [0, 0, 0], // set below, from its own random sequence
          });
          this.types[i] = this.types[i] === T_GRASS ? T_FOREST : this.types[i]!;
          this.grid.setFlag(cx, cz, BLOCK_TREE, true);
        }
      }
    }
    this.treeByCell = new Map();
    for (const tr of this.trees) this.treeByCell.set(tr.cz * MAP_SIZE + tr.cx, tr);
    // Canopy tint per tree: summer pine, broadleaf ash, dead/blighted.
    const tint = mulberry32(this.seed + 7);
    for (const tr of this.trees) {
      if (tr.species === 0) tr.tint = [0.13 + tint() * 0.05, 0.36 + tint() * 0.1, 0.16 + tint() * 0.05];
      else if (tr.species === 1) tr.tint = [0.27 + tint() * 0.1, 0.5 + tint() * 0.12, 0.14 + tint() * 0.05];
      else tr.tint = [0.32, 0.27, 0.3];
    }
  }

  treeAtCell(cx: number, cz: number): Tree | null {
    const t = this.treeByCell.get(cz * MAP_SIZE + cx);
    return t && t.alive ? t : null;
  }

  // ------------------------------------------------------------- appearance
  // Engine-free inputs for the renderers: the painted ground map, per-tree tints and the scattered
  // rocks, bushes and flowers. The meshes are built by the renderer (src/render/terrainView.js,
  // src/babylon/TerrainView.ts).

  paintTexture(): HTMLCanvasElement {
    const RES = 2048;
    const canvas = document.createElement('canvas');
    canvas.width = RES;
    canvas.height = RES;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(RES, RES);
    const data = img.data;
    const S = MAP_SIZE;

    // Per-cell base colors (with slight per-cell variation).
    const cellCol = new Float32Array(S * S * 3);
    const cobbleW = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      const cx = i % S;
      const cz = (i - cx) / S;
      const c = TYPE_COLORS[this.types[i]!]!;
      const v = 0.92 + valueNoise(cx * 0.31, cz * 0.31, 3) * 0.16;
      const tint = fbm(cx * 0.05, cz * 0.05, 11, 2) * 0.06;
      cellCol[i * 3] = c[0] * v + tint * 0.4;
      cellCol[i * 3 + 1] = c[1] * v + tint;
      cellCol[i * 3 + 2] = c[2] * v;
      cobbleW[i] = this.types[i] === T_COBBLE ? 1 : 0;
    }
    // Fine noise tile.
    const NT = 256;
    const fine = new Float32Array(NT * NT);
    const rand = mulberry32(4242);
    for (let i = 0; i < NT * NT; i++) fine[i] = rand();
    // Smooth the fine noise a bit (blur pass) for blades/specks.
    const fine2 = new Float32Array(NT * NT);
    for (let y = 0; y < NT; y++) {
      for (let x = 0; x < NT; x++) {
        let s = 0;
        for (let k = -1; k <= 1; k++) s += fine[y * NT + ((x + k + NT) % NT)]! + fine[((y + k + NT) % NT) * NT + x]!;
        fine2[y * NT + x] = fine[y * NT + x]! * 0.6 + (s / 6) * 0.4;
      }
    }
    // Low-frequency warp so borders between ground types look organic.
    const WN = S + 1;
    const warpX = new Float32Array(WN * WN);
    const warpZ = new Float32Array(WN * WN);
    for (let z = 0; z < WN; z++) {
      for (let x = 0; x < WN; x++) {
        warpX[z * WN + x] = fbm(x * 0.25, z * 0.25, 31, 2) * 0.9;
        warpZ[z * WN + x] = fbm(x * 0.25, z * 0.25, 57, 2) * 0.9;
      }
    }
    const sampleBil = (arr: Float32Array, W: number, x: number, z: number): number => {
      const xi = Math.max(0, Math.min(W - 2, Math.floor(x)));
      const zi = Math.max(0, Math.min(W - 2, Math.floor(z)));
      const fx = Math.min(1, Math.max(0, x - xi));
      const fz = Math.min(1, Math.max(0, z - zi));
      const a = arr[zi * W + xi]!;
      const b = arr[zi * W + xi + 1]!;
      const c = arr[(zi + 1) * W + xi]!;
      const d = arr[(zi + 1) * W + xi + 1]!;
      return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
    };

    const scale = S / RES;
    for (let py = 0; py < RES; py++) {
      const wz = (py + 0.5) * scale;
      for (let px = 0; px < RES; px++) {
        const wx = (px + 0.5) * scale;
        const sx = wx + sampleBil(warpX, WN, wx, wz) - 0.5;
        const sz = wz + sampleBil(warpZ, WN, wx, wz) - 0.5;
        // Bilinear blend of cell colors.
        const xi = Math.max(0, Math.min(S - 2, Math.floor(sx)));
        const zi = Math.max(0, Math.min(S - 2, Math.floor(sz)));
        let fx = Math.min(1, Math.max(0, sx - xi));
        let fz = Math.min(1, Math.max(0, sz - zi));
        // Sharpen the blend a little.
        fx = fx * fx * (3 - 2 * fx);
        fz = fz * fz * (3 - 2 * fz);
        const i00 = (zi * S + xi) * 3;
        const i10 = i00 + 3;
        const i01 = i00 + S * 3;
        const i11 = i01 + 3;
        const w00 = (1 - fx) * (1 - fz);
        const w10 = fx * (1 - fz);
        const w01 = (1 - fx) * fz;
        const w11 = fx * fz;
        let r = cellCol[i00]! * w00 + cellCol[i10]! * w10 + cellCol[i01]! * w01 + cellCol[i11]! * w11;
        let g = cellCol[i00 + 1]! * w00 + cellCol[i10 + 1]! * w10 + cellCol[i01 + 1]! * w01 + cellCol[i11 + 1]! * w11;
        let b = cellCol[i00 + 2]! * w00 + cellCol[i10 + 2]! * w10 + cellCol[i01 + 2]! * w01 + cellCol[i11 + 2]! * w11;
        const ci = i00 / 3;
        const cw = cobbleW[ci]! * w00 + cobbleW[ci + 1]! * w10 + cobbleW[ci + S]! * w01 + cobbleW[ci + S + 1]! * w11;
        const fn = fine2[(py & (NT - 1)) * NT + (px & (NT - 1))]!;
        let m = 0.86 + fn * 0.28;
        if (cw > 0.3) {
          // Cobblestone pattern.
          const bx = wx * 2.2 + (Math.floor(wz * 2.2) % 2) * 0.5;
          const bz = wz * 2.2;
          const ex = Math.abs(bx - Math.round(bx));
          const ez = Math.abs(bz - Math.round(bz));
          if (ex < 0.07 || ez < 0.07) m *= 1 - 0.35 * cw;
        }
        r *= m;
        g *= m;
        b *= m;
        const o = (py * RES + px) * 4;
        data[o] = Math.min(255, r * 255);
        data[o + 1] = Math.min(255, g * 255);
        data[o + 2] = Math.min(255, b * 255);
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.textureCanvas = canvas;
    return canvas;
  }

  /** Remove a chopped-down tree (the renderers turn it into a stump). */
  fellTree(tree: Tree): void {
    if (!tree.alive) return;
    tree.alive = false;
    this.felled.push(tree);
    this.grid.setFlag(tree.cx, tree.cz, BLOCK_TREE, false);
    this.types[tree.cz * MAP_SIZE + tree.cx] = T_GRASS;
  }

  /** Scatter rocks, bushes and flowers; each entry has a position, rotation, scale and colour. */
  scatterDoodads(): Doodads {
    const rand = mulberry32(this.seed + 31);
    type Spot = { x: number; z: number; s: number };
    const rocks: Spot[] = [];
    const bushes: Spot[] = [];
    const flowers: Spot[] = [];
    for (let i = 0; i < Math.round(2600 * (MAP_SIZE / 160) ** 2); i++) {
      const x = 2 + rand() * (MAP_SIZE - 4);
      const z = 2 + rand() * (MAP_SIZE - 4);
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      const ci = cz * MAP_SIZE + cx;
      if (this.grid.flags[ci]! & BLOCK_TERRAIN) continue;
      const t = this.types[ci];
      if (t === T_ROAD || t === T_COBBLE) continue;
      const h = this.heightAt(x, z);
      if (h < WATER_LEVEL + 0.1) continue;
      if (this.isNearFlatSpot(x, z)) continue;
      const roll = rand();
      if (t === T_FOREST || t === T_BLIGHT) {
        if (roll < 0.35) rocks.push({ x, z, s: 0.25 + rand() * 0.35 });
        else if (roll < 0.75 && t !== T_BLIGHT) bushes.push({ x, z, s: 0.3 + rand() * 0.35 });
      } else if (t === T_GRASS) {
        if (roll < 0.06) rocks.push({ x, z, s: 0.2 + rand() * 0.3 });
        else if (roll < 0.16) bushes.push({ x, z, s: 0.25 + rand() * 0.3 });
        else if (roll < 0.36) flowers.push({ x, z, s: 0.5 + rand() * 0.6 });
      }
    }
    // Placement: y offset (in units of the doodad's scale), rotation, stretch and colour (the
    // random draws happen in this order: rocks, bushes, flowers; per doodad rot, scale, colour).
    const place = (list: Spot[], yOff: number, colorFn: () => Rgb): Doodad[] =>
      list.map((d) => ({
        ...d,
        y: this.heightAt(d.x, d.z) + yOff * d.s,
        rot: [rand() * 0.4, rand() * Math.PI * 2, rand() * 0.3],
        scale: [d.s, d.s * (0.7 + rand() * 0.5), d.s],
        color: colorFn(),
      }));
    const placedRocks = place(rocks, 0.3, () => {
      const v = 0.45 + rand() * 0.2;
      return [v, v * 0.97, v * 0.92];
    });
    const placedBushes = place(bushes, 0.5, () => [0.18 + rand() * 0.1, 0.38 + rand() * 0.12, 0.12]);
    const pal: Rgb[] = [[1, 0.9, 0.3], [1, 1, 1], [0.9, 0.4, 0.8], [0.5, 0.6, 1], [1, 0.5, 0.3]];
    const placedFlowers = place(flowers, 0, () => pal[Math.floor(rand() * pal.length)]!);
    this.doodads = { rocks: placedRocks, bushes: placedBushes, flowers: placedFlowers };
    return this.doodads;
  }

  isNearFlatSpot(x: number, z: number): boolean {
    for (const s of this.flatSpots) if (Math.hypot(x - s.x, z - s.z) < s.radius + 1.5) return true;
    return false;
  }
}
