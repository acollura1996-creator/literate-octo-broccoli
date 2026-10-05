// Engine-free art for the roads: the cobble texture and the road surface geometry. Textures are
// plain 2D canvases.

/** Small tiling road texture: cobbles with mortar lines (tinted per age by vertex colours). */
export function makeCobbleCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
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
export function roadGeometry<P>(
  roads: { count: number; size: number; owner: ArrayLike<number>; colorFor(p: P | undefined): ArrayLike<number> },
  game: { terrain: { heightAt(x: number, z: number): number }; generals: P[] },
): { quads: number; positions: Float32Array; normals: Float32Array; uvs: Float32Array; colors: Float32Array } {
  const n = roads.count;
  const positions = new Float32Array(n * 12);
  const normals = new Float32Array(n * 12);
  const uvs = new Float32Array(n * 8);
  const colors = new Float32Array(n * 12);
  const S = roads.size;
  const t = game.terrain;
  const h = (x: number, z: number): number => t.heightAt(x, z) + 0.05;
  let q = 0;
  for (let k = 0; k < roads.owner.length && q < n; k++) {
    const owner = roads.owner[k]!;
    if (owner < 0) continue;
    const x = k % S;
    const z = (k - x) / S;
    const c = roads.colorFor(game.generals[owner]);
    const corners: [number, number][] = [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]];
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
