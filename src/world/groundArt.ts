// Engine-free road surface geometry (the renderer paints the road texture: GroundPaint.ts).

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
