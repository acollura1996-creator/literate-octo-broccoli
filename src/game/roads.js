// Roads: tiles laid by Empire generals. Houses only add population while they
// touch a road that connects back to one of the owner's town centers, and all
// units move faster on roads. Roads are drawn as a mesh hugging the terrain;
// their surface follows the owner's age (packed dirt, then cobbles, then
// dressed paving).
import { MAP_SIZE } from '../world/layout.js';
import { ROAD } from '../data/units.ts';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Roads {
  constructor(game) {
    this.game = game;
    this.size = MAP_SIZE;
    this.owner = new Int8Array(MAP_SIZE * MAP_SIZE).fill(-1); // general index, -1 = no road
    this.connected = new Uint8Array(MAP_SIZE * MAP_SIZE);
    this.count = 0;
    this.counts = new Int32Array(16); // road tiles per general index
    this.version = 0; // bumped whenever the road surface changes (renderers rebuild their mesh)
  }

  idx(cx, cz) {
    return cz * this.size + cx;
  }

  isRoad(cx, cz) {
    return cx >= 0 && cz >= 0 && cx < this.size && cz < this.size && this.owner[cz * this.size + cx] >= 0;
  }

  isRoadAt(x, z) {
    return this.isRoad(Math.floor(x), Math.floor(z));
  }

  /** Number of road tiles a general owns. */
  countOf(p) {
    return this.counts[p.index] ?? 0;
  }

  ownerAt(cx, cz) {
    if (!this.isRoad(cx, cz)) return null;
    return this.game.generals[this.owner[this.idx(cx, cz)]] ?? null;
  }

  canPlace(cx, cz, p, ignoreFog = false) {
    const g = this.game;
    if (cx < 1 || cz < 1 || cx >= this.size - 1 || cz >= this.size - 1) return false;
    if (this.isRoad(cx, cz)) return false;
    g.grid.passTeam = -99;
    if (!g.grid.walkable(cx, cz)) return false;
    if (p?.isHuman && !p.ai && !ignoreFog && !g.fog.isExplored(cx + 0.5, cz + 0.5)) return false;
    return true;
  }

  /** A 4-connected line of cells from a to b (so roads and walls join edge to edge). */
  static line(ax, az, bx, bz) {
    const cells = [[ax, az]];
    let x = ax;
    let z = az;
    const dx = Math.abs(bx - ax);
    const dz = Math.abs(bz - az);
    const sx = Math.sign(bx - ax);
    const sz = Math.sign(bz - az);
    let ix = 0;
    let iz = 0;
    // One axis step at a time, always the one that stays closest to the ideal line.
    while (ix < dx || iz < dz) {
      if ((0.5 + ix) / dx < (0.5 + iz) / dz) {
        x += sx;
        ix++;
      } else {
        z += sz;
        iz++;
      }
      cells.push([x, z]);
    }
    return cells;
  }

  /** Lay roads on the given cells (those that can be placed). Returns the number laid. */
  place(cells, p, free = false) {
    const g = this.game;
    const ok = cells.filter(([cx, cz]) => this.canPlace(cx, cz, p, free));
    if (!ok.length) return 0;
    let n = ok.length;
    if (!free) {
      const per = ROAD.cost.gold;
      n = Math.min(n, Math.floor(p.gold / per));
      if (n <= 0) {
        if (p.isHuman) {
          g.message('Not enough gold.', '#ff8080');
          g.sound('error');
        }
        return 0;
      }
      p.gold -= n * per;
    }
    for (const [cx, cz] of ok.slice(0, n)) {
      this.owner[this.idx(cx, cz)] = p.index;
      g.grid.road[this.idx(cx, cz)] = 1;
      this.count++;
      this.counts[p.index]++;
    }
    this.version++;
    this.recompute(p);
    return n;
  }

  /** Remove road tiles (e.g. under a newly placed building). */
  clear(cx, cz, w, h) {
    let changed = null;
    for (let z = cz; z < cz + h; z++) {
      for (let x = cx; x < cx + w; x++) {
        if (!this.isRoad(x, z)) continue;
        const i = this.idx(x, z);
        changed = this.game.generals[this.owner[i]];
        this.counts[this.owner[i]]--;
        this.owner[i] = -1;
        this.game.grid.road[i] = 0;
        this.count--;
      }
    }
    if (changed) {
      this.version++;
      this.recompute(changed);
    }
  }

  /** Does any cell around a building footprint touch one of p's roads? */
  touchesRoad(cx, cz, fp, p, connectedOnly = false) {
    for (let i = -1; i <= fp; i++) {
      for (const [x, z] of [[cx + i, cz - 1], [cx + i, cz + fp], [cx - 1, cz + i], [cx + fp, cz + i]]) {
        if (i < 0 || i >= fp) {
          // skip the four corner-diagonal cells: roads must touch an edge
          if ((x === cx - 1 || x === cx + fp) && (z === cz - 1 || z === cz + fp)) continue;
        }
        if (!this.isRoad(x, z) || this.owner[this.idx(x, z)] !== p.index) continue;
        if (connectedOnly && !this.connected[this.idx(x, z)]) continue;
        return true;
      }
    }
    return false;
  }

  /** Flood the road network out from p's town centers and mark connected houses. */
  recompute(p) {
    if (!p?.general) return;
    const S = this.size;
    const own = this.owner;
    const conn = this.connected;
    for (let i = 0; i < own.length; i++) if (own[i] === p.index) conn[i] = 0;
    const queue = [];
    for (const b of p.buildings) {
      if (b.dead || b.underConstruction || !b.def.tier) continue;
      const fp = b.def.footprint;
      const { x: cx, z: cz } = b.cell;
      for (let i = -1; i <= fp; i++) {
        for (const [x, z] of [[cx + i, cz - 1], [cx + i, cz + fp], [cx - 1, cz + i], [cx + fp, cz + i]]) {
          if (!this.isRoad(x, z)) continue;
          const k = this.idx(x, z);
          if (own[k] === p.index && !conn[k]) {
            conn[k] = 1;
            queue.push(k);
          }
        }
      }
    }
    while (queue.length) {
      const k = queue.pop();
      const x = k % S;
      const z = (k - x) / S;
      for (const [dx, dz] of N4) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= S || nz >= S) continue;
        const nk = nz * S + nx;
        if (own[nk] === p.index && !conn[nk]) {
          conn[nk] = 1;
          queue.push(nk);
        }
      }
    }
    for (const b of p.buildings) {
      if (!b.def.needsRoad || b.dead) continue;
      b.roadConnected = this.touchesRoad(b.cell.x, b.cell.z, b.def.footprint, p, true);
    }
  }

  // ------------------------------------------------------------ appearance
  /** Road surface colour for a general's age (the renderers tint the cobble texture with it). */
  colorFor(p) {
    const tier = p?.tier ?? 1;
    if (tier <= 2) return [0.55, 0.42, 0.27]; // packed dirt
    if (tier <= 4) return [0.62, 0.58, 0.52]; // cobbles
    if (tier === 5) return [0.78, 0.75, 0.68]; // dressed paving
    if (tier === 6) return [0.5, 0.46, 0.44]; // macadam
    if (tier === 7) return [0.3, 0.31, 0.33]; // asphalt
    return [0.82, 0.9, 0.95]; // smart paving
  }
}
