// Engine-free art for the ground, shared by both renderers: the tiling detail map, the road
// cobble texture and the road surface geometry. Textures are plain 2D canvases.
import { valueNoise, mulberry32 } from './noise.js';

/** Grayscale tiling noise (R: fine blades and specks, G: soft blotches) for ground detail. */
export function makeDetailCanvas() {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  const rand = mulberry32(777);
  const fine = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) fine[i] = rand();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // Short vertical streaks read as grass blades from the RTS camera.
      let v = 0;
      for (let k = 0; k < 3; k++) v += fine[((y + k) % N) * N + x];
      v = v / 3;
      // Tileable soft noise from wrapped value noise.
      const u = (x / N) * 8;
      const w = (y / N) * 8;
      const s = valueNoiseWrap(u, w, 8);
      const o = (y * N + x) * 4;
      img.data[o] = Math.round(v * 255);
      img.data[o + 1] = Math.round(s * 255);
      img.data[o + 2] = 0;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function valueNoiseWrap(x, z, period) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const h = (a, b) => valueNoise(((a % period) + period) % period, ((b % period) + period) % period, 99);
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = h(xi, zi);
  const b = h(xi + 1, zi);
  const c = h(xi, zi + 1);
  const d = h(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** Small tiling road texture: cobbles with mortar lines (tinted per age by vertex colours). */
export function makeCobbleCanvas() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d9d2c2';
  ctx.fillRect(0, 0, 64, 64);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = col * 16 + (row % 2) * 8;
      const y = row * 16;
      const v = 200 + Math.floor(rnd() * 50);
      ctx.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
      ctx.beginPath();
      ctx.roundRect?.(x + 1.5, y + 1.5, 13, 13, 4);
      if (!ctx.roundRect) ctx.rect(x + 1.5, y + 1.5, 13, 13);
      ctx.fill();
      if (x + 16 > 64) {
        ctx.beginPath();
        ctx.rect(x - 64 + 1.5, y + 1.5, 13, 13);
        ctx.fill();
      }
    }
  }
  return c;
}

/**
 * Road surface: one quad per road tile hugging the terrain, tinted by its owner's age.
 * Returns typed arrays; `corners` lists each quad's four vertices in the order
 * (x, z), (x + 1, z), (x, z + 1), (x + 1, z + 1), so each renderer chooses its own winding.
 */
export function roadGeometry(roads, game) {
  const n = roads.count;
  const positions = new Float32Array(n * 12);
  const normals = new Float32Array(n * 12);
  const uvs = new Float32Array(n * 8);
  const colors = new Float32Array(n * 12);
  const S = roads.size;
  const t = game.terrain;
  const h = (x, z) => t.heightAt(x, z) + 0.05;
  let q = 0;
  for (let k = 0; k < roads.owner.length && q < n; k++) {
    if (roads.owner[k] < 0) continue;
    const x = k % S;
    const z = (k - x) / S;
    const c = roads.colorFor(game.generals[roads.owner[k]]);
    const corners = [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]];
    corners.forEach(([cx, cz], i) => {
      positions.set([cx, h(cx, cz), cz], q * 12 + i * 3);
      // Normal from the terrain slope at the corner.
      const nx = t.heightAt(cx - 0.5, cz) - t.heightAt(cx + 0.5, cz);
      const nz = t.heightAt(cx, cz - 0.5) - t.heightAt(cx, cz + 0.5);
      const len = Math.hypot(nx, 1, nz);
      normals.set([nx / len, 1 / len, nz / len], q * 12 + i * 3);
      uvs.set([cx * 0.5, cz * 0.5], q * 8 + i * 2);
      colors.set(c, q * 12 + i * 3);
    });
    q++;
  }
  return { quads: q, positions, normals, uvs, colors };
}
