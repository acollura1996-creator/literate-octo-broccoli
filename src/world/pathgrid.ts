// Grid-based pathing (1 cell = 1 world unit) with A* search and path smoothing.
import type { Point } from '../game/hooks.ts';

export const BLOCK_TREE = 1;
export const BLOCK_BUILDING = 2;
export const BLOCK_TERRAIN = 4;
/** Gates: impassable except for units of the gate owner's team (see passTeam). */
export const BLOCK_GATE = 8;

const SQRT2 = Math.SQRT2;

class MinHeap {
  nodes: Int32Array;
  keys: Float32Array;
  size: number;

  constructor(cap: number) {
    this.nodes = new Int32Array(cap);
    this.keys = new Float32Array(cap);
    this.size = 0;
  }
  clear(): void {
    this.size = 0;
  }
  push(node: number, key: number): void {
    if (this.size >= this.nodes.length) this.grow();
    let i = this.size++;
    const nodes = this.nodes;
    const keys = this.keys;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      nodes[i] = nodes[p]!;
      keys[i] = keys[p]!;
      i = p;
    }
    nodes[i] = node;
    keys[i] = key;
  }
  pop(): number {
    const nodes = this.nodes;
    const keys = this.keys;
    const top = nodes[0]!;
    const n = --this.size;
    if (n > 0) {
      const lastN = nodes[n]!;
      const lastK = keys[n]!;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1]! < keys[c]!) c++;
        if (keys[c]! >= lastK) break;
        nodes[i] = nodes[c]!;
        keys[i] = keys[c]!;
        i = c;
      }
      nodes[i] = lastN;
      keys[i] = lastK;
    }
    return top;
  }
  grow(): void {
    const n = new Int32Array(this.nodes.length * 2);
    n.set(this.nodes);
    const k = new Float32Array(this.keys.length * 2);
    k.set(this.keys);
    this.nodes = n;
    this.keys = k;
  }
}

export class PathGrid {
  readonly size: number;
  flags: Uint8Array;
  /** 1 where a road speeds movement (and is preferred by A*). */
  road: Uint8Array;
  gateTeam: Int16Array;
  passTeam: number;
  g: Float32Array;
  parent: Int32Array;
  seen: Uint32Array;
  closed: Uint32Array;
  gen: number;
  heap: MinHeap;
  /** Bumped whenever blocking changes. */
  version: number;
  /** Nodes the last search expanded (a cost measure for the path budget). */
  lastExpanded = 0;

  constructor(size: number) {
    this.size = size;
    const n = size * size;
    this.flags = new Uint8Array(n);
    this.road = new Uint8Array(n); // 1 where a road speeds movement (and is preferred by A*)
    this.gateTeam = new Int16Array(n).fill(-1);
    // Team allowed through gates for the current query. Set per unit before moving it;
    // -99 (nobody) for placement checks.
    this.passTeam = -99;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 1;
    this.heap = new MinHeap(4096);
    this.version = 0; // bumped whenever blocking changes
  }

  inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.size && cz < this.size;
  }

  walkable(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) return false;
    const i = cz * this.size + cx;
    const f = this.flags[i]!;
    return f === 0 || (f === BLOCK_GATE && this.gateTeam[i] === this.passTeam);
  }

  walkableAt(x: number, z: number): boolean {
    return this.walkable(Math.floor(x), Math.floor(z));
  }

  setFlag(cx: number, cz: number, flag: number, on: boolean): void {
    if (!this.inBounds(cx, cz)) return;
    const i = cz * this.size + cx;
    if (on) this.flags[i]! |= flag;
    else this.flags[i]! &= ~flag;
    this.version++;
  }

  /** Set/clear a flag on a w*h rectangle of cells starting at (cx, cz). */
  setRect(cx: number, cz: number, w: number, h: number, flag: number, on: boolean): void {
    for (let z = cz; z < cz + h; z++) for (let x = cx; x < cx + w; x++) this.setFlag(x, z, flag, on);
  }

  rectFree(cx: number, cz: number, w: number, h: number): boolean {
    for (let z = cz; z < cz + h; z++) {
      for (let x = cx; x < cx + w; x++) {
        if (!this.inBounds(x, z) || this.flags[z * this.size + x] !== 0) return false;
      }
    }
    return true;
  }

  /** Nearest walkable cell center to (x, z) within maxR cells, or null. */
  nearestWalkable(x: number, z: number, maxR = 12): Point | null {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (this.walkable(cx, cz)) return { x, z };
    let best: Point | null = null;
    let bestD = Infinity;
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.walkable(cx + dx, cz + dz)) continue;
          const px = cx + dx + 0.5;
          const pz = cz + dz + 0.5;
          const d = (px - x) * (px - x) + (pz - z) * (pz - z);
          if (d < bestD) {
            bestD = d;
            best = { x: px, z: pz };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** True if a straight line between two points only crosses walkable cells. */
  lineWalkable(ax: number, az: number, bx: number, bz: number, halfWidth = 0.28): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return this.walkableAt(ax, az);
    const steps = Math.ceil(len / 0.25);
    const nx = (-dz / len) * halfWidth;
    const nz = (dx / len) * halfWidth;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = ax + dx * t;
      const z = az + dz * t;
      if (!this.walkableAt(x, z)) return false;
      if (halfWidth > 0 && (!this.walkableAt(x + nx, z + nz) || !this.walkableAt(x - nx, z - nz))) return false;
    }
    return true;
  }

  /**
   * A* from (sx, sz) toward (gx, gz). Stops once within `range` of the goal.
   * Returns an array of {x, z} waypoints (excluding the start) or null.
   */
  findPath(sx: number, sz: number, gx: number, gz: number, range = 0, maxNodes = 60000): Point[] | null {
    const size = this.size;
    let start: Point = { x: sx, z: sz };
    if (!this.walkableAt(sx, sz)) {
      const near = this.nearestWalkable(sx, sz, 4);
      if (!near) return null;
      start = near;
    }
    let goalX = gx;
    let goalZ = gz;
    const exact = range <= 0.01;
    if (exact && !this.walkableAt(gx, gz)) {
      const nw = this.nearestWalkable(gx, gz, 16);
      if (!nw) return null;
      goalX = nw.x;
      goalZ = nw.z;
    }
    const stopR = Math.max(range, 0.0);

    // Already close enough and line is clear.
    this.lastExpanded = 0;
    if (Math.hypot(start.x - goalX, start.z - goalZ) <= Math.max(stopR, 0.05)) return [];
    if (Math.hypot(start.x - goalX, start.z - goalZ) < 40 && exact && this.lineWalkable(start.x, start.z, goalX, goalZ)) {
      return [{ x: goalX, z: goalZ }];
    }

    const gen = ++this.gen;
    const g = this.g;
    const parent = this.parent;
    const seen = this.seen;
    const closed = this.closed;
    const flags = this.flags;
    const road = this.road;
    const gateTeam = this.gateTeam;
    const team = this.passTeam;
    const blocked = (i: number): boolean => flags[i] !== 0 && !(flags[i] === BLOCK_GATE && gateTeam[i] === team);
    const heap = this.heap;
    heap.clear();

    const scx = Math.floor(start.x);
    const scz = Math.floor(start.z);
    const s = scz * size + scx;
    const gcx = Math.floor(goalX);
    const gcz = Math.floor(goalZ);
    const h = (cx: number, cz: number): number => {
      const dx = Math.abs(cx - gcx);
      const dz = Math.abs(cz - gcz);
      return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
    };
    g[s] = 0;
    parent[s] = -1;
    seen[s] = gen;
    heap.push(s, h(scx, scz));

    let found = -1;
    let best = s;
    let bestH = Infinity;
    let expanded = 0;
    const stopR2 = Math.max(stopR, 0.5) ** 2;

    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      const cx = cur % size;
      const cz = (cur - cx) / size;
      const px = cx + 0.5;
      const pz = cz + 0.5;
      const d2 = (px - goalX) * (px - goalX) + (pz - goalZ) * (pz - goalZ);
      if ((exact && cx === gcx && cz === gcz) || (!exact && d2 <= stopR2)) {
        found = cur;
        break;
      }
      const hc = h(cx, cz);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      if (++expanded > maxNodes) break;
      const gc = g[cur]!;
      for (let dz = -1; dz <= 1; dz++) {
        const nz = cz + dz;
        if (nz < 0 || nz >= size) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          if (nx < 0 || nx >= size) continue;
          const ni = nz * size + nx;
          if (closed[ni] === gen || blocked(ni)) continue;
          let cost = 1;
          if (dx !== 0 && dz !== 0) {
            if (blocked(cz * size + nx) || blocked(nz * size + cx)) continue;
            cost = SQRT2;
          }
          if (road[ni]) cost *= 0.75;
          const ng = gc + cost;
          if (seen[ni] !== gen || ng < g[ni]!) {
            seen[ni] = gen;
            g[ni] = ng;
            parent[ni] = cur;
            heap.push(ni, ng + h(nx, nz) * 1.001);
          }
        }
      }
    }

    this.lastExpanded = expanded;
    const end = found >= 0 ? found : best;
    if (end === s && found < 0) return null;
    const cells: number[] = [];
    for (let c = end; c !== -1 && c !== s; c = parent[c]!) cells.push(c);
    cells.reverse();
    const pts = cells.map((c): Point => {
      const cx = c % size;
      return { x: cx + 0.5, z: (c - cx) / size + 0.5 };
    });
    if (found >= 0 && exact && pts.length) pts[pts.length - 1] = { x: goalX, z: goalZ };
    return this.smooth(start, pts);
  }

  /** Greedy string-pulling: drop waypoints that are directly reachable. */
  smooth(start: Point, pts: Point[]): Point[] {
    if (pts.length <= 1) return pts;
    const out: Point[] = [];
    let ax = start.x;
    let az = start.z;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      // Find the farthest point visible from the anchor (cap the scan for speed).
      const limit = Math.min(pts.length - 1, i + 40);
      j = i;
      for (let k = limit; k > i; k--) {
        if (this.lineWalkable(ax, az, pts[k]!.x, pts[k]!.z)) {
          j = k;
          break;
        }
      }
      const pj = pts[j]!;
      out.push(pj);
      ax = pj.x;
      az = pj.z;
      i = j + 1;
    }
    return out;
  }
}
