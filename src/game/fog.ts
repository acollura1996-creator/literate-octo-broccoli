// Fog of war and black mask for the human player (and allies in allied mode). Engine-free.
import { MAP_SIZE } from '../world/layout.ts';
import type { Game } from './game.ts';
import type { Player } from './types.ts';

const VISIBLE = 255;
const EXPLORED = 110;

export class Fog {
  readonly game: Game;
  readonly size: number;
  /** 1 where the human (and allies) see this instant. */
  visible: Uint8Array;
  /** 1 where they have ever seen. */
  explored: Uint8Array;
  target: Uint8Array;
  current: Float32Array;
  texData: Uint8Array;
  version: number;
  lastCompute: number;
  revealAll: boolean;
  /** Cell offsets [dx, dz, dx, dz, ...] of a vision circle, by twice its radius. */
  circles: Map<number, number[]>;

  constructor(game: Game) {
    this.game = game;
    this.size = MAP_SIZE;
    const n = MAP_SIZE * MAP_SIZE;
    this.visible = new Uint8Array(n);
    this.explored = new Uint8Array(n);
    this.target = new Uint8Array(n);
    this.current = new Float32Array(n);
    // Fog brightness per cell (0 black mask, 110 explored, 255 visible), eased over time. The
    // renderers upload it as a single-channel texture whenever `version` changes.
    this.texData = new Uint8Array(n);
    this.version = 0;
    this.lastCompute = -1;
    this.revealAll = false;
    this.circles = new Map();
  }

  circle(r: number): number[] {
    const key = Math.round(r * 2);
    const cached = this.circles.get(key);
    if (cached) return cached;
    const R = key / 2;
    const c: number[] = [];
    const ri = Math.ceil(R);
    for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) if (dx * dx + dz * dz <= R * R) c.push(dx, dz);
    this.circles.set(key, c);
    return c;
  }

  hasVision(p: Player): boolean {
    return this.game.isAlliedToHuman(p);
  }

  update(force = false): void {
    const g = this.game;
    if (force || g.time - this.lastCompute >= 0.12 || g.time < this.lastCompute) {
      this.lastCompute = g.time;
      const S = this.size;
      const vis = this.visible;
      vis.fill(0);
      if (this.revealAll) vis.fill(1);
      else {
        for (const u of g.units) {
          if (u.dead || u.removed || !this.hasVision(u.owner)) continue;
          const cx = Math.floor(u.x);
          const cz = Math.floor(u.z);
          const c = this.circle(u.sight);
          for (let i = 0; i < c.length; i += 2) {
            const x = cx + c[i]!;
            const z = cz + c[i + 1]!;
            if (x < 0 || z < 0 || x >= S || z >= S) continue;
            vis[z * S + x] = 1;
          }
        }
      }
      const exp = this.explored;
      const tgt = this.target;
      for (let i = 0; i < vis.length; i++) {
        if (vis[i]) exp[i] = 1;
        tgt[i] = vis[i] ? VISIBLE : exp[i] ? EXPLORED : 0;
      }
    }
    // Ease toward the target for soft transitions.
    const cur = this.current;
    const tgt = this.target;
    const out = this.texData;
    let changed = force;
    for (let i = 0; i < cur.length; i++) {
      const t = tgt[i]!;
      const c = cur[i]!;
      if (c !== t) {
        const nc = force ? t : Math.abs(t - c) < 2 ? t : c + (t - c) * 0.25;
        cur[i] = nc;
        out[i] = nc;
        changed = true;
      }
    }
    if (changed) this.version++;
  }

  isVisible(x: number, z: number): boolean {
    if (this.revealAll) return true;
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) return false;
    return this.visible[cz * this.size + cx] === 1;
  }

  isExplored(x: number, z: number): boolean {
    if (this.revealAll) return true;
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) return false;
    return this.explored[cz * this.size + cx] === 1;
  }

  /** Reveal everything (end of game / debug). */
  reveal(): void {
    this.revealAll = true;
    this.explored.fill(1);
    this.update(true);
  }
}
