// Props made in code for the rigged characters (M14): the firearms of the gunpowder to galactic
// ages, which the KayKit packs don't have. They are built in the packs' style (chunky low-poly
// shapes coloured from a palette atlas) in the space of the joint they hang on, so they join a
// character's mesh like the packs' own props and move with its hand.
//
// Joint spaces (from the packs' crossbows and swords): in `handslot.r`, +X runs along the barrel
// toward the muzzle, +Y up out of the fist (a sword's blade), +Z across. In `chest`, +Y runs up the
// spine and +Z forward. Colours are swatches of the Rogue's atlas (column, row of its 8 × 4 grid);
// glowing swatches light up on their own (sci-fi weapons).

export interface PropGeometry {
  joint: string;
  texture: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  /** Per vertex: 1 where the surface glows. */
  glow: number[];
  indices: number[];
}

type Swatch = readonly [number, number];
/** Swatches of rogue_texture.png. */
const WOOD: Swatch = [5, 0];
const DARK_WOOD: Swatch = [6, 0];
const BLACK: Swatch = [2, 0];
const METAL: Swatch = [3, 0];
const GUNMETAL: Swatch = [4, 0];
const OLIVE: Swatch = [2, 2];
const TEAM: Swatch = [1, 1];
const CYAN: Swatch = [3, 3];
const PURPLE: Swatch = [2, 3];
const RED: Swatch = [4, 3];
const BRASS: Swatch = [1, 3];
const GLOWING = new Set<Swatch>([CYAN, PURPLE, RED]);

class Builder {
  readonly g: PropGeometry;
  constructor(joint: string) {
    this.g = { joint, texture: 'rogue_texture.png', positions: [], normals: [], uvs: [], glow: [], indices: [] };
  }

  /** A swatch's colour by how much a face looks up (the swatches run light to dark downward). */
  private uv(s: Swatch, ny: number): [number, number] {
    const shade = 0.5 - ny * 0.32;
    return [(s[0] + 0.4) / 8, (s[1] + shade) / 4];
  }

  private quad(a: number[], b: number[], c: number[], d: number[], n: number[], s: Swatch): void {
    const g = this.g;
    const base = g.positions.length / 3;
    const [u, v] = this.uv(s, n[1]!);
    for (const p of [a, b, c, d]) {
      g.positions.push(p[0]!, p[1]!, p[2]!);
      g.normals.push(n[0]!, n[1]!, n[2]!);
      g.uvs.push(u, v);
      g.glow.push(GLOWING.has(s) ? 1 : 0);
    }
    g.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** An axis-aligned box from (x0, y0, z0) to (x1, y1, z1). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, s: Swatch): this {
    const P = (x: number, y: number, z: number): number[] => [x, y, z];
    // Counter-clockwise seen from outside.
    this.quad(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1), [1, 0, 0], s);
    this.quad(P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), P(x0, y0, z0), [-1, 0, 0], s);
    this.quad(P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), [0, 1, 0], s);
    this.quad(P(x0, y0, z1), P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), [0, -1, 0], s);
    this.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), [0, 0, 1], s);
    this.quad(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), [0, 0, -1], s);
    return this;
  }

  /** A cylinder along X from x0 to x1, centred at (y, z), radius r0 at x0 and r1 at x1. */
  tubeX(x0: number, x1: number, y: number, z: number, r0: number, s: Swatch, r1 = r0, sides = 8): this {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const p = (x: number, r: number, a: number): number[] => [x, y + Math.cos(a) * r, z + Math.sin(a) * r];
      this.quad(p(x0, r0, a0), p(x0, r0, a1), p(x1, r1, a1), p(x1, r1, a0), [0, Math.cos(am), Math.sin(am)], s);
    }
    // End caps.
    for (const [x, r, nx] of [[x0, r0, -1], [x1, r1, 1]] as const) {
      for (let i = 0; i < sides; i += 2) {
        const pts = [0, 1, 2].map((k) => {
          const a = ((i + k) / sides) * Math.PI * 2;
          return [x, y + Math.cos(a) * r, z + Math.sin(a) * r];
        });
        const c = [x, y, z];
        if (nx > 0) this.quad(c, pts[0]!, pts[1]!, pts[2]!, [1, 0, 0], s);
        else this.quad(c, pts[2]!, pts[1]!, pts[0]!, [-1, 0, 0], s);
      }
    }
    return this;
  }

  /** A cylinder along Y (upright), centred at (x, z). */
  tubeY(y0: number, y1: number, x: number, z: number, r: number, s: Swatch, sides = 8): this {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const p = (y: number, a: number): number[] => [x + Math.sin(a) * r, y, z + Math.cos(a) * r];
      this.quad(p(y0, a1), p(y0, a0), p(y1, a0), p(y1, a1), [Math.sin(am), 0, Math.cos(am)], s);
    }
    for (let i = 0; i < sides; i += 2) {
      const pts = [0, 1, 2].map((k) => {
        const a = ((i + k) / sides) * Math.PI * 2;
        return [x + Math.sin(a) * r, y1, z + Math.cos(a) * r];
      });
      this.quad([x, y1, z], pts[0]!, pts[1]!, pts[2]!, [0, 1, 0], s);
    }
    return this;
  }
}

/** The usual long gun: a stock behind the fist, the action above it, the barrel forward. */
function longGun(stock: Swatch, body: Swatch, barrelLength: number, barrelR: number, barrel: Swatch): Builder {
  const b = new Builder('handslot.r');
  b.box(-0.55, -0.02, -0.055, -0.08, 0.13, 0.055, stock); // butt stock
  b.box(-0.12, -0.16, -0.045, 0.02, 0.06, 0.045, stock); // grip
  b.box(-0.08, 0.02, -0.06, 0.5, 0.15, 0.06, body); // action and fore-end
  b.tubeX(0.2, 0.2 + barrelLength, 0.17, 0, barrelR, barrel);
  return b;
}

export const PROCEDURAL_PROPS: Record<string, () => PropGeometry> = {
  // Gunpowder: a long wooden musket with a brass lock.
  musket: () => {
    const b = longGun(WOOD, DARK_WOOD, 1.15, 0.035, GUNMETAL);
    b.box(0.02, 0.12, -0.075, 0.14, 0.2, 0.075, BRASS);
    b.tubeX(1.25, 1.35, 0.17, 0, 0.045, GUNMETAL);
    return b.g;
  },
  // Industrial: a bolt-action rifle.
  rifle: () => {
    const b = longGun(WOOD, DARK_WOOD, 0.95, 0.03, GUNMETAL);
    b.box(0.05, 0.15, 0.06, 0.12, 0.2, 0.13, METAL); // bolt
    b.box(0.3, 0.06, -0.035, 0.36, 0.13, 0.035, METAL); // band
    return b.g;
  },
  // A long rifle with a telescopic sight.
  sniper: () => {
    const b = longGun(DARK_WOOD, GUNMETAL, 1.3, 0.03, BLACK);
    b.tubeX(-0.05, 0.42, 0.29, 0, 0.055, BLACK);
    b.tubeX(-0.06, -0.04, 0.29, 0, 0.045, CYAN);
    b.box(0.08, 0.15, -0.025, 0.14, 0.25, 0.025, BLACK);
    b.box(0.28, 0.15, -0.025, 0.34, 0.25, 0.025, BLACK);
    return b.g;
  },
  // A heavy machine gun: water jacket, box magazine (team coloured).
  mg: () => {
    const b = new Builder('handslot.r');
    b.box(-0.45, -0.05, -0.08, 0.45, 0.2, 0.08, GUNMETAL);
    b.box(-0.12, -0.18, -0.045, 0.0, 0.0, 0.045, BLACK);
    b.tubeX(0.4, 1.0, 0.1, 0, 0.085, GUNMETAL, 0.085, 10);
    b.tubeX(1.0, 1.32, 0.1, 0, 0.035, BLACK);
    b.box(0.05, -0.32, -0.1, 0.32, -0.05, 0.1, TEAM);
    b.box(0.0, 0.2, -0.02, 0.06, 0.27, 0.02, BLACK);
    return b.g;
  },
  // A flamethrower wand with a pilot flame; the fuel tanks hang on the back (`flamerTanks`).
  flamer: () => {
    const b = new Builder('handslot.r');
    b.box(-0.35, -0.03, -0.06, 0.15, 0.13, 0.06, GUNMETAL);
    b.box(-0.1, -0.18, -0.045, 0.02, 0.0, 0.045, BLACK);
    b.tubeX(0.1, 1.0, 0.08, 0, 0.05, METAL);
    b.tubeX(1.0, 1.15, 0.08, 0, 0.07, BLACK, 0.09);
    b.tubeX(1.15, 1.22, 0.08, 0, 0.05, RED, 0.02);
    b.tubeX(-0.3, 0.3, -0.06, 0.08, 0.035, BLACK);
    return b.g;
  },
  flamerTanks: () => {
    const b = new Builder('chest');
    b.tubeY(-0.25, 0.42, 0.16, -0.38, 0.13, RED, 10);
    b.tubeY(-0.25, 0.42, -0.16, -0.38, 0.13, RED, 10);
    b.box(-0.3, 0.1, -0.3, 0.3, 0.18, -0.2, BLACK);
    return b.g;
  },
  // Modern: an assault rifle with a curved magazine.
  assault: () => {
    const b = new Builder('handslot.r');
    b.box(-0.5, -0.02, -0.05, -0.12, 0.12, 0.05, BLACK);
    b.box(-0.12, -0.17, -0.045, 0.0, 0.04, 0.045, BLACK);
    b.box(-0.12, 0.0, -0.06, 0.55, 0.16, 0.06, OLIVE);
    b.box(0.1, -0.28, -0.04, 0.22, 0.0, 0.04, BLACK);
    b.tubeX(0.5, 0.95, 0.09, 0, 0.03, BLACK);
    b.box(0.05, 0.16, -0.02, 0.35, 0.21, 0.02, BLACK);
    return b.g;
  },
  // A rocket launcher tube carried over the shoulder line.
  bazooka: () => {
    const b = new Builder('handslot.r');
    b.tubeX(-0.75, 0.85, 0.22, 0, 0.11, OLIVE, 0.11, 10);
    b.tubeX(0.85, 0.95, 0.22, 0, 0.13, BLACK, 0.13, 10);
    b.tubeX(-0.85, -0.75, 0.22, 0, 0.13, BLACK, 0.13, 10);
    b.box(-0.1, -0.15, -0.04, 0.02, 0.14, 0.04, BLACK);
    b.box(0.15, 0.3, -0.12, 0.28, 0.42, -0.06, BLACK);
    b.tubeX(0.7, 0.86, 0.22, 0, 0.07, RED);
    return b.g;
  },
  // Digital: a railgun with glowing coils.
  railgun: () => {
    const b = new Builder('handslot.r');
    b.box(-0.5, -0.02, -0.06, -0.1, 0.13, 0.06, BLACK);
    b.box(-0.12, -0.17, -0.045, 0.0, 0.04, 0.045, BLACK);
    b.box(-0.1, 0.0, -0.08, 0.5, 0.18, 0.08, METAL);
    b.box(0.3, 0.06, -0.04, 1.35, 0.12, 0.04, GUNMETAL);
    for (let i = 0; i < 5; i++) b.tubeX(0.55 + i * 0.16, 0.6 + i * 0.16, 0.09, 0, 0.075, CYAN, 0.075, 8);
    return b.g;
  },
  // Future: a sleek laser rifle with a glowing strip and emitter.
  laser: () => {
    const b = new Builder('handslot.r');
    b.box(-0.45, -0.02, -0.055, -0.1, 0.13, 0.055, METAL);
    b.box(-0.12, -0.17, -0.045, 0.0, 0.04, 0.045, GUNMETAL);
    b.box(-0.12, 0.0, -0.07, 0.75, 0.17, 0.07, METAL);
    b.box(-0.05, 0.17, -0.03, 0.6, 0.2, 0.03, CYAN);
    b.tubeX(0.75, 0.95, 0.09, 0, 0.05, GUNMETAL, 0.035);
    b.tubeX(0.95, 1.0, 0.09, 0, 0.035, CYAN);
    return b.g;
  },
  // Galactic: a plasma rifle with a purple core.
  plasma: () => {
    const b = new Builder('handslot.r');
    b.box(-0.45, -0.02, -0.06, -0.1, 0.13, 0.06, BLACK);
    b.box(-0.12, -0.17, -0.045, 0.0, 0.04, 0.045, BLACK);
    b.box(-0.12, -0.02, -0.09, 0.7, 0.2, 0.09, GUNMETAL);
    b.tubeX(0.1, 0.55, 0.09, 0, 0.1, PURPLE, 0.1, 10);
    b.tubeX(0.7, 1.05, 0.09, 0, 0.06, BLACK, 0.045);
    b.tubeX(1.05, 1.1, 0.09, 0, 0.045, PURPLE);
    return b.g;
  },
  // An exosuit's energy blade (Future Age melee).
  energyBlade: () => {
    const b = new Builder('handslot.r');
    b.tubeY(-0.32, 0.12, 0, 0, 0.05, BLACK);
    b.box(-0.3, 0.1, -0.07, 0.3, 0.22, 0.07, METAL);
    b.box(-0.08, 0.22, -0.03, 0.08, 1.75, 0.03, CYAN);
    b.box(-0.04, 1.75, -0.02, 0.04, 1.86, 0.02, CYAN);
    return b.g;
  },
  // An exosuit's heavy cannon.
  cannonArm: () => {
    const b = new Builder('handslot.r');
    b.box(-0.4, -0.08, -0.12, 0.6, 0.26, 0.12, GUNMETAL);
    b.box(-0.12, -0.2, -0.05, 0.02, 0.0, 0.05, BLACK);
    b.tubeX(0.55, 1.2, 0.09, 0.0, 0.11, BLACK, 0.09, 10);
    b.tubeX(0.2, 0.5, 0.09, 0, 0.14, CYAN, 0.14, 10);
    b.box(-0.3, 0.26, -0.06, 0.4, 0.32, 0.06, TEAM);
    return b.g;
  },
};
