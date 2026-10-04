// Fog of war and black mask for the human player (and allies in allied mode).
import * as THREE from 'three';
import { MAP_SIZE } from '../world/layout.js';
import { fogUniforms } from '../render/assets.js';

const VISIBLE = 255;
const EXPLORED = 110;

export class Fog {
  constructor(game) {
    this.game = game;
    this.size = MAP_SIZE;
    const n = MAP_SIZE * MAP_SIZE;
    this.visible = new Uint8Array(n);
    this.explored = new Uint8Array(n);
    this.target = new Uint8Array(n);
    this.current = new Float32Array(n);
    this.texData = new Uint8Array(n);
    this.texture = new THREE.DataTexture(this.texData, MAP_SIZE, MAP_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    fogUniforms.uFogTex.value = this.texture;
    fogUniforms.uWorldSize.value.set(MAP_SIZE, MAP_SIZE);
    this.lastCompute = -1;
    this.revealAll = false;
    this.circles = new Map();
  }

  circle(r) {
    const key = Math.round(r * 2);
    let c = this.circles.get(key);
    if (c) return c;
    const R = key / 2;
    c = [];
    const ri = Math.ceil(R);
    for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) if (dx * dx + dz * dz <= R * R) c.push(dx, dz);
    this.circles.set(key, c);
    return c;
  }

  hasVision(p) {
    return this.game.isAlliedToHuman(p);
  }

  update(force = false) {
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
            const x = cx + c[i];
            const z = cz + c[i + 1];
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
      const t = tgt[i];
      const c = cur[i];
      if (c !== t) {
        const nc = force ? t : Math.abs(t - c) < 2 ? t : c + (t - c) * 0.25;
        cur[i] = nc;
        out[i] = nc;
        changed = true;
      }
    }
    if (changed) this.texture.needsUpdate = true;
  }

  isVisible(x, z) {
    if (this.revealAll) return true;
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) return false;
    return this.visible[cz * this.size + cx] === 1;
  }

  isExplored(x, z) {
    if (this.revealAll) return true;
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) return false;
    return this.explored[cz * this.size + cx] === 1;
  }

  /** Reveal everything (end of game / debug). */
  reveal() {
    this.revealAll = true;
    this.explored.fill(1);
    this.update(true);
  }
}
