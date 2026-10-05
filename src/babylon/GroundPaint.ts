// Hand-painted ground textures (M13), generated at load with Canvas 2D: one tileable painting per
// ground layer in the spirit of Warcraft III's Lordaeron Summer tile set (grass, forest floor,
// dirt, rough road, cobblestone, shore, blight and cliff rock). Each layer also gets a height map
// (stones, clumps and blades stand high; gaps and cracks lie low) that the terrain's splat shader
// uses for crisp, irregular borders between layers.
//
// No Babylon imports, so tools/textures.html can preview the paintings on their own.

export const GROUND_LAYERS = ['grass', 'forest', 'dirt', 'road', 'cobble', 'shore', 'blight', 'rock'] as const;
export type GroundLayer = (typeof GROUND_LAYERS)[number];

/** Pixels per side of each painting. */
export const GROUND_TEX_SIZE = 512;

/** World units covered by one repeat of each layer's painting. */
export const GROUND_TILE_UNITS: Record<GroundLayer, number> = {
  grass: 6,
  forest: 6,
  dirt: 5,
  road: 5,
  cobble: 4.5,
  shore: 5,
  blight: 6,
  rock: 5,
};

/** Hue (degrees), saturation and lightness (percent). */
type Hsl = [number, number, number];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paints a colour canvas and its height map side by side, wrapping shapes so the tile repeats. */
class Painter {
  readonly albedo: HTMLCanvasElement;
  readonly height: HTMLCanvasElement;
  readonly c: CanvasRenderingContext2D;
  readonly h: CanvasRenderingContext2D;

  constructor(
    readonly N: number,
    readonly rand: () => number,
  ) {
    this.albedo = document.createElement('canvas');
    this.height = document.createElement('canvas');
    for (const cv of [this.albedo, this.height]) {
      cv.width = N;
      cv.height = N;
    }
    this.c = this.albedo.getContext('2d', { willReadFrequently: true })!;
    this.h = this.height.getContext('2d', { willReadFrequently: true })!;
  }

  r(a: number, b: number): number {
    return a + this.rand() * (b - a);
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rand() * list.length)]!;
  }

  /** A colour jittered by up to ±jh degrees of hue and ±js / ±jl points of saturation / lightness. */
  col([hu, s, l]: Hsl, a = 1, jh = 0, js = 0, jl = 0): string {
    const j = (v: number): number => (this.rand() * 2 - 1) * v;
    return `hsla(${(hu + j(jh)).toFixed(1)},${Math.max(0, Math.min(100, s + j(js))).toFixed(1)}%,${Math.max(0, Math.min(100, l + j(jl))).toFixed(1)}%,${a})`;
  }

  grey(v: number, a = 1): string {
    const g = Math.round(Math.max(0, Math.min(1, v)) * 255);
    return `rgba(${g},${g},${g},${a})`;
  }

  /** Draw at (x, y) and at each wrapped copy that reaches into the tile. */
  wrap(x: number, y: number, r: number, draw: (x: number, y: number) => void): void {
    const N = this.N;
    for (const ox of [-N, 0, N]) {
      const px = x + ox;
      if (px + r < 0 || px - r > N) continue;
      for (const oy of [-N, 0, N]) {
        const py = y + oy;
        if (py + r < 0 || py - r > N) continue;
        draw(px, py);
      }
    }
  }

  fill(color: Hsl, height: number): void {
    this.c.fillStyle = this.col(color);
    this.c.fillRect(0, 0, this.N, this.N);
    this.h.fillStyle = this.grey(height);
    this.h.fillRect(0, 0, this.N, this.N);
  }

  /** A soft round patch of colour; `dh` raises or lowers the height map under it. */
  blotch(x: number, y: number, r: number, color: Hsl, alpha: number, dh = 0, jl = 0): void {
    const inner = this.col(color, alpha, 0, 0, jl);
    const outer = this.col(color, 0);
    this.wrap(x, y, r, (px, py) => {
      const g = this.c.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, inner);
      g.addColorStop(1, outer);
      this.c.fillStyle = g;
      this.c.fillRect(px - r, py - r, r * 2, r * 2);
      if (dh) {
        const gh = this.h.createRadialGradient(px, py, 0, px, py, r);
        const v = dh > 0 ? 1 : 0;
        gh.addColorStop(0, this.grey(v, Math.abs(dh)));
        gh.addColorStop(1, this.grey(v, 0));
        this.h.fillStyle = gh;
        this.h.fillRect(px - r, py - r, r * 2, r * 2);
      }
    });
  }

  /** A tapering, slightly bent stroke from (x, y): a grass blade, needle or straw. */
  blade(x: number, y: number, len: number, ang: number, w: number, color: string, height: number, bend = 0): void {
    const sx = Math.sin(ang);
    const cy = Math.cos(ang);
    this.wrap(x, y, len + w, (px, py) => {
      const tx = px + sx * len;
      const ty = py - cy * len;
      const nx = (cy * w) / 2;
      const ny = (sx * w) / 2;
      const mx = (px + tx) / 2 + cy * bend * len;
      const my = (py + ty) / 2 + sx * bend * len;
      for (const [ctx, style] of [
        [this.c, color],
        [this.h, this.grey(height)],
      ] as const) {
        ctx.fillStyle = style;
        ctx.beginPath();
        ctx.moveTo(px - nx, py - ny);
        ctx.quadraticCurveTo(mx, my, tx, ty);
        ctx.quadraticCurveTo(mx, my, px + nx, py + ny);
        ctx.closePath();
        ctx.fill();
      }
    });
  }

  /** An irregular closed outline around (0, 0): `n` points on an ellipse with jittered radius. */
  blob(rx: number, ry: number, n: number, jitter: number): Array<[number, number]> {
    const pts: Array<[number, number]> = [];
    const a0 = this.r(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      const k = 1 + this.r(-jitter, jitter);
      pts.push([Math.cos(a) * rx * k, Math.sin(a) * ry * k]);
    }
    return pts;
  }

  private path(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, x: number, y: number): void {
    ctx.beginPath();
    const n = pts.length;
    // Smooth closed curve through the midpoints (rounded, hand-drawn edges).
    const mid = (i: number): [number, number] => {
      const a = pts[i % n]!;
      const b = pts[(i + 1) % n]!;
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    };
    const m0 = mid(0);
    ctx.moveTo(x + m0[0], y + m0[1]);
    for (let i = 1; i <= n; i++) {
      const p = pts[i % n]!;
      const m = mid(i);
      ctx.quadraticCurveTo(x + p[0], y + p[1], x + m[0], y + m[1]);
    }
    ctx.closePath();
  }

  /**
   * A painted stone: dark outline and cast shadow, a body colour, a light top-left and a darker
   * bottom-right, the way Warcraft III's tiles paint pebbles and cobbles.
   */
  stone(x: number, y: number, rx: number, ry: number, base: Hsl, height: number, opts: { shadow?: number; outline?: number; jitter?: number; light?: number } = {}): void {
    const pts = this.blob(rx, ry, 9, opts.jitter ?? 0.16);
    const r = Math.max(rx, ry) * 1.3 + 3;
    const shadow = opts.shadow ?? 0.32;
    const outline = opts.outline ?? 0.55;
    const light = opts.light ?? 0.5;
    const body = this.col(base, 1, 3, 3, 4);
    const [hu, s, l] = base;
    this.wrap(x, y, r, (px, py) => {
      const c = this.c;
      if (shadow > 0) {
        c.fillStyle = `rgba(20,14,8,${shadow})`;
        this.path(c, pts, px + rx * 0.18 + 1, py + ry * 0.25 + 1.2);
        c.fill();
      }
      c.fillStyle = body;
      this.path(c, pts, px, py);
      c.fill();
      c.save();
      c.clip();
      const g = c.createRadialGradient(px - rx * 0.45, py - ry * 0.5, 0, px - rx * 0.2, py - ry * 0.25, Math.max(rx, ry) * 1.25);
      g.addColorStop(0, `hsla(${hu},${s}%,${Math.min(95, l + 22)}%,${light})`);
      g.addColorStop(0.55, `hsla(${hu},${s}%,${l}%,0)`);
      g.addColorStop(1, `hsla(${hu},${s}%,${Math.max(0, l - 20)}%,0.55)`);
      c.fillStyle = g;
      c.fillRect(px - r, py - r, r * 2, r * 2);
      c.restore();
      if (outline > 0) {
        c.strokeStyle = `hsla(${hu},${s}%,${Math.max(0, l - 28)}%,${outline})`;
        c.lineWidth = Math.max(0.8, Math.min(rx, ry) * 0.12);
        this.path(c, pts, px, py);
        c.stroke();
      }
      const h = this.h;
      const gh = h.createRadialGradient(px - rx * 0.15, py - ry * 0.2, 0, px, py, Math.max(rx, ry) * 1.1);
      gh.addColorStop(0, this.grey(height));
      gh.addColorStop(1, this.grey(height * 0.6));
      h.fillStyle = gh;
      this.path(h, pts, px, py);
      h.fill();
    });
  }

  /** A flat, worn flagstone: a rounded, slightly irregular slab lit from the top. */
  slab(x: number, y: number, w: number, hgt: number, base: Hsl, height: number): void {
    const j = (): number => this.r(-2.2, 2.2);
    const hw = w / 2;
    const hh = hgt / 2;
    const pts: Array<[number, number]> = [
      [-hw + j(), -hh + j()], [j(), -hh + j()], [hw + j(), -hh + j()], [hw + j(), j()],
      [hw + j(), hh + j()], [j(), hh + j()], [-hw + j(), hh + j()], [-hw + j(), j()],
    ];
    const r = Math.max(hw, hh) + 4;
    const body = this.col(base, 1, 4, 3, 5);
    const [hu, s, l] = base;
    this.wrap(x, y, r, (px, py) => {
      const c = this.c;
      c.fillStyle = body;
      this.path(c, pts, px, py);
      c.fill();
      c.save();
      c.clip();
      const g = c.createLinearGradient(px, py - hh, px, py + hh);
      g.addColorStop(0, `hsla(${hu},${s}%,${Math.min(95, l + 12)}%,0.55)`);
      g.addColorStop(0.45, `hsla(${hu},${s}%,${l}%,0)`);
      g.addColorStop(1, `hsla(${hu},${s}%,${Math.max(0, l - 14)}%,0.6)`);
      c.fillStyle = g;
      c.fillRect(px - r, py - r, r * 2, r * 2);
      c.restore();
      c.strokeStyle = `hsla(${hu},${s}%,${Math.max(0, l - 26)}%,0.75)`;
      c.lineWidth = 1.6;
      this.path(c, pts, px, py);
      c.stroke();
      c.strokeStyle = `hsla(${hu},${s}%,${Math.min(95, l + 16)}%,0.35)`;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(px - hw + 4, py - hh + 2.5);
      c.lineTo(px + hw - 4, py - hh + 2.5);
      c.stroke();
      const h = this.h;
      h.fillStyle = this.grey(height * 0.7);
      this.path(h, pts, px, py);
      h.fill();
      h.save();
      this.path(h, pts, px, py);
      h.clip();
      const gh = h.createRadialGradient(px, py, 0, px, py, Math.max(hw, hh));
      gh.addColorStop(0, this.grey(height));
      gh.addColorStop(1, this.grey(height * 0.7));
      h.fillStyle = gh;
      h.fillRect(px - r, py - r, r * 2, r * 2);
      h.restore();
    });
  }

  /** A crack: a jagged polyline in a dark colour, cut into the height map. */
  crack(x: number, y: number, segs: number, step: number, width: number, color: Hsl, alpha: number): void {
    const pts: Array<[number, number]> = [[0, 0]];
    let a = this.r(0, Math.PI * 2);
    let px = 0;
    let py = 0;
    for (let i = 0; i < segs; i++) {
      a += this.r(-0.7, 0.7);
      const s = step * this.r(0.6, 1.3);
      px += Math.cos(a) * s;
      py += Math.sin(a) * s;
      pts.push([px, py]);
    }
    const ext = segs * step * 1.3 + width;
    const style = this.col(color, alpha);
    this.wrap(x, y, ext, (ox, oy) => {
      for (const [ctx, st, w] of [
        [this.c, style, width],
        [this.h, this.grey(0, 0.7), width * 1.4],
      ] as const) {
        ctx.strokeStyle = st;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach(([qx, qy], i) => (i ? ctx.lineTo(ox + qx, oy + qy) : ctx.moveTo(ox + qx, oy + qy)));
        ctx.stroke();
      }
    });
  }

  /** A continuous stroke along points, in colour and onto the height map. */
  stroke(pts: Array<[number, number]>, width: number, color: string, height: number): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of pts) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const r = Math.max(maxX - minX, maxY - minY) / 2 + width;
    this.wrap(cx, cy, r, (px, py) => {
      for (const [ctx, st] of [
        [this.c, color],
        [this.h, this.grey(height)],
      ] as const) {
        ctx.strokeStyle = st;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x - cx + px, y - cy + py) : ctx.moveTo(x - cx + px, y - cy + py)));
        ctx.stroke();
      }
    });
  }

  /** A pointed leaf lying on the ground. */
  leaf(x: number, y: number, len: number, ang: number, color: string, height: number): void {
    const w = len * 0.42;
    this.wrap(x, y, len, (px, py) => {
      for (const [ctx, st] of [
        [this.c, color],
        [this.h, this.grey(height)],
      ] as const) {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang);
        ctx.fillStyle = st;
        ctx.beginPath();
        ctx.moveTo(-len / 2, 0);
        ctx.quadraticCurveTo(0, -w, len / 2, 0);
        ctx.quadraticCurveTo(0, w, -len / 2, 0);
        ctx.fill();
        ctx.restore();
      }
    });
    // Midrib.
    this.wrap(x, y, len, (px, py) => {
      const c = this.c;
      c.save();
      c.translate(px, py);
      c.rotate(ang);
      c.strokeStyle = 'rgba(30,20,8,0.35)';
      c.lineWidth = 0.7;
      c.beginPath();
      c.moveTo(-len / 2, 0);
      c.lineTo(len / 2, 0);
      c.stroke();
      c.restore();
    });
  }

  /** Small dots: grit, specks, flower heads. */
  dot(x: number, y: number, r: number, color: string, height?: number): void {
    this.wrap(x, y, r, (px, py) => {
      this.c.fillStyle = color;
      this.c.beginPath();
      this.c.arc(px, py, r, 0, Math.PI * 2);
      this.c.fill();
      if (height !== undefined) {
        this.h.fillStyle = this.grey(height);
        this.h.beginPath();
        this.h.arc(px, py, r, 0, Math.PI * 2);
        this.h.fill();
      }
    });
  }
}

// ------------------------------------------------------------------------------------- layers

/** Lordaeron summer grass: lush green with clumps of darker and sunlit blades and a few flowers. */
function paintGrass(p: Painter): void {
  const N = p.N;
  p.fill([86, 52, 33], 0.42);
  for (let i = 0; i < 80; i++) {
    const light = p.rand() < 0.5;
    p.blotch(p.r(0, N), p.r(0, N), p.r(28, 100), light ? [76, 58, 44] : [98, 50, 23], 0.28, light ? 0.08 : -0.08, 4);
  }
  // Dark under-blades, mid blades, sunlit blades, then bright tips: depth from layering.
  const passes: Array<{ n: number; c: Hsl; h: number; len: [number, number]; w: [number, number] }> = [
    { n: 2200, c: [100, 52, 18], h: 0.28, len: [8, 15], w: [1.8, 2.8] },
    { n: 4600, c: [90, 52, 28], h: 0.48, len: [7, 13], w: [1.5, 2.5] },
    { n: 3200, c: [80, 56, 39], h: 0.68, len: [5, 11], w: [1.3, 2.1] },
    { n: 1100, c: [68, 62, 53], h: 0.84, len: [4, 8], w: [1.1, 1.7] },
  ];
  for (const pass of passes) {
    for (let i = 0; i < pass.n; i++) {
      p.blade(p.r(0, N), p.r(0, N), p.r(...pass.len), p.r(-0.9, 0.9), p.r(...pass.w), p.col(pass.c, 1, 6, 6, 4), pass.h, p.r(-0.25, 0.25));
    }
  }
  // Tufts: a dark base with blades fanning out of it.
  for (let i = 0; i < 46; i++) {
    const x = p.r(0, N);
    const y = p.r(0, N);
    const s = p.r(0.8, 1.4);
    p.blotch(x, y + 3, 11 * s, [105, 55, 12], 0.55, -0.15);
    for (let k = 0; k < 14; k++) {
      const a = p.r(-1.2, 1.2);
      p.blade(x + p.r(-3, 3), y + p.r(-1, 3), p.r(9, 17) * s, a, p.r(1.6, 2.6), p.col(k < 7 ? [88, 54, 30] : [74, 60, 48], 1, 5, 5, 5), 0.6 + k * 0.025, a * 0.15);
    }
  }
  // Scattered wild flowers: white and yellow heads with a darker eye.
  for (let i = 0; i < 7; i++) {
    const x = p.r(0, N);
    const y = p.r(0, N);
    const yellow = p.rand() < 0.45;
    for (let k = 0; k < p.r(2, 6); k++) {
      const fx = x + p.r(-9, 9);
      const fy = y + p.r(-9, 9);
      p.dot(fx + 0.8, fy + 0.9, 2.6, 'rgba(25,40,10,0.45)');
      p.dot(fx, fy, 2.3, yellow ? p.col([50, 90, 62], 1, 4, 4, 4) : p.col([60, 40, 93], 1, 4, 4, 2), 0.9);
      p.dot(fx, fy, 0.9, yellow ? 'hsl(32,90%,40%)' : 'hsl(48,90%,55%)');
    }
  }
}

/** Forest floor: dark grass under the canopy, fallen leaves, needles and twigs. */
function paintForest(p: Painter): void {
  const N = p.N;
  p.fill([92, 42, 21], 0.4);
  for (let i = 0; i < 70; i++) {
    const brown = p.rand() < 0.45;
    p.blotch(p.r(0, N), p.r(0, N), p.r(25, 90), brown ? [40, 40, 22] : [100, 45, 15], 0.4, brown ? 0.05 : -0.08, 4);
  }
  for (let i = 0; i < 3800; i++) {
    const dark = p.rand() < 0.5;
    p.blade(p.r(0, N), p.r(0, N), p.r(5, 11), p.r(-1, 1), p.r(1.3, 2.2), p.col(dark ? [98, 48, 15] : [86, 46, 26], 1, 6, 6, 4), dark ? 0.35 : 0.55, p.r(-0.3, 0.3));
  }
  // Pine needles and twigs.
  for (let i = 0; i < 1500; i++) {
    p.blade(p.r(0, N), p.r(0, N), p.r(4, 8), p.r(0, Math.PI * 2), 0.9, p.col([30, 35, 24], 0.9, 6, 6, 6), 0.5);
  }
  for (let i = 0; i < 70; i++) {
    p.blade(p.r(0, N), p.r(0, N), p.r(12, 26), p.r(0, Math.PI * 2), p.r(1.5, 2.6), p.col([28, 35, 20], 1, 4, 4, 4), 0.62, p.r(-0.2, 0.2));
  }
  // Fallen leaves: olive, ochre, rust and brown.
  const leafColours: Hsl[] = [
    [58, 45, 32],
    [42, 60, 40],
    [24, 55, 32],
    [34, 40, 24],
    [75, 40, 26],
  ];
  for (let i = 0; i < 1500; i++) {
    const x = p.r(0, N);
    const y = p.r(0, N);
    const len = p.r(5, 10);
    const a = p.r(0, Math.PI * 2);
    p.leaf(x + 0.8, y + 1, len, a, 'rgba(12,16,4,0.35)', 0.4);
    p.leaf(x, y, len, a, p.col(p.pick(leafColours), 1, 6, 6, 5), 0.66);
  }
  // A few mushrooms and stones.
  for (let i = 0; i < 18; i++) p.stone(p.r(0, N), p.r(0, N), p.r(3, 6), p.r(3, 5), [30, 10, 46], 0.85);
}

/** Bare earth: warm brown, mottled, with painted pebbles and fine cracks. */
function paintDirt(p: Painter, road: boolean): void {
  const N = p.N;
  const base: Hsl = road ? [36, 34, 47] : [30, 38, 33];
  p.fill(base, 0.42);
  for (let i = 0; i < 90; i++) {
    const light = p.rand() < 0.5;
    const c: Hsl = light ? [base[0] + 3, base[1] - 4, base[2] + 9] : [base[0] - 4, base[1] + 4, base[2] - 9];
    p.blotch(p.r(0, N), p.r(0, N), p.r(20, 80), c, 0.4, light ? 0.06 : -0.06, 3);
  }
  if (road) {
    // Sandy streaks of packed earth.
    for (let i = 0; i < 140; i++) {
      const x = p.r(0, N);
      const y = p.r(0, N);
      p.blade(x, y, p.r(30, 70), p.r(1.2, 1.9), p.r(5, 12), p.col([40, 30, 58], 0.35, 4, 4, 4), 0.48);
    }
  }
  // Grit.
  for (let i = 0; i < 5000; i++) {
    const light = p.rand() < 0.5;
    p.dot(p.r(0, N), p.r(0, N), p.r(0.6, 1.4), p.col(light ? [base[0], 20, base[2] + 18] : [base[0], 40, base[2] - 16], 0.8, 6, 6, 5));
  }
  for (let i = 0; i < (road ? 18 : 30); i++) p.crack(p.r(0, N), p.r(0, N), Math.floor(p.r(3, 8)), p.r(6, 12), p.r(1, 1.8), [base[0] - 6, 40, base[2] - 18], 0.65);
  // Pebbles, bigger and more on the road.
  const n = road ? 560 : 320;
  for (let i = 0; i < n; i++) {
    const s = road ? p.r(2.5, 7.5) : p.r(1.8, 5.5);
    const grey = p.rand() < 0.6;
    p.stone(p.r(0, N), p.r(0, N), s, s * p.r(0.65, 0.95), grey ? [35, 10, p.r(50, 66)] : [28, 28, p.r(40, 52)], p.r(0.75, 0.95));
  }
  // Grass creeping in.
  for (let i = 0; i < (road ? 120 : 380); i++) {
    const x = p.r(0, N);
    const y = p.r(0, N);
    for (let k = 0; k < 5; k++) p.blade(x + p.r(-4, 4), y + p.r(-2, 2), p.r(5, 10), p.r(-1, 1), p.r(1.2, 2), p.col([84, 48, 32], 1, 6, 6, 6), 0.6, p.r(-0.2, 0.2));
  }
}

/** Kalenden's plaza: worn flagstones of varied widths in courses, dark joints with grime and moss. */
function paintCobble(p: Painter): void {
  const N = p.N;
  p.fill([28, 14, 14], 0.05);
  for (let i = 0; i < 90; i++) p.blotch(p.r(0, N), p.r(0, N), p.r(8, 20), [85, 30, 18], 0.5);
  const rows = 8;
  const H = N / rows;
  for (let row = 0; row < rows; row++) {
    // Slab widths for this course, scaled to fill the tile exactly (so it repeats).
    const widths: number[] = [];
    let sum = 0;
    while (sum < N - 40) {
      const w = p.r(44, 96);
      widths.push(w);
      sum += w;
    }
    const k = N / sum;
    let x = p.r(0, N);
    for (const w0 of widths) {
      const w = w0 * k;
      const warm = p.rand() < 0.3;
      const base: Hsl = warm ? [32, p.r(6, 12), p.r(40, 50)] : [p.r(240, 270), p.r(5, 10), p.r(38, 48)];
      p.slab(x + w / 2, (row + 0.5) * H, w - 5, H - 5, base, p.r(0.8, 1));
      for (let j = 0; j < 2; j++) p.blotch(x + p.r(6, w - 6), (row + 0.5) * H + p.r(-H / 4, H / 4), p.r(5, 11), [base[0], base[1], base[2] - 8], 0.3);
      x += w;
    }
  }
  for (let i = 0; i < 34; i++) p.crack(p.r(0, N), p.r(0, N), Math.floor(p.r(2, 4)), p.r(5, 9), 1, [25, 15, 16], 0.55);
}

/** Wet sand and mud at the waterline, with ripple marks and shells. */
function paintShore(p: Painter): void {
  const N = p.N;
  p.fill([42, 30, 50], 0.45);
  for (let i = 0; i < 80; i++) {
    const wet = p.rand() < 0.55;
    p.blotch(p.r(0, N), p.r(0, N), p.r(25, 85), wet ? [38, 22, 36] : [46, 34, 60], 0.45, wet ? -0.08 : 0.06, 3);
  }
  // Ripple marks: gentle light arcs with a shadow under each.
  for (let i = 0; i < 260; i++) {
    const x = p.r(0, N);
    const y = p.r(0, N);
    const len = p.r(16, 40);
    p.blade(x, y + 1.5, len, 1.57 + p.r(-0.15, 0.15), 2.2, 'rgba(60,45,25,0.25)', 0.35, 0.12);
    p.blade(x, y, len, 1.57 + p.r(-0.15, 0.15), 1.8, p.col([45, 35, 70], 0.45, 4, 4, 4), 0.6, 0.12);
  }
  for (let i = 0; i < 3500; i++) p.dot(p.r(0, N), p.r(0, N), p.r(0.6, 1.2), p.col(p.rand() < 0.5 ? [40, 20, 70] : [35, 30, 30], 0.7, 6, 6, 5));
  for (let i = 0; i < 220; i++) {
    const s = p.r(1.6, 4.5);
    p.stone(p.r(0, N), p.r(0, N), s, s * p.r(0.6, 0.9), p.rand() < 0.3 ? [30, 20, 82] : [35, 12, p.r(45, 62)], 0.8);
  }
}

/** The Scourge's blight: dark violet earth with pale, root-like veins. */
function paintBlight(p: Painter): void {
  const N = p.N;
  p.fill([282, 22, 21], 0.4);
  for (let i = 0; i < 90; i++) {
    const light = p.rand() < 0.45;
    p.blotch(p.r(0, N), p.r(0, N), p.r(20, 85), light ? [278, 26, 27] : [292, 30, 9], 0.45, light ? 0.06 : -0.08, 3);
  }
  for (let i = 0; i < 4000; i++) p.dot(p.r(0, N), p.r(0, N), p.r(0.6, 1.3), p.col(p.rand() < 0.5 ? [280, 20, 34] : [290, 30, 8], 0.8, 8, 6, 5));
  // Veins: wandering, branching strokes that thin out, with a dark rim.
  const vein = (x: number, y: number, a: number, w: number, depth: number): void => {
    let px = x;
    let py = y;
    for (let i = 0; i < 8 && w > 0.6; i++) {
      const pts: Array<[number, number]> = [[px, py]];
      for (let k = 0; k < 3; k++) {
        a += p.r(-0.35, 0.35);
        px += Math.sin(a) * p.r(4, 7);
        py -= Math.cos(a) * p.r(4, 7);
        pts.push([px, py]);
      }
      p.stroke(pts, w + 2, 'rgba(12,4,18,0.5)', 0.35);
      p.stroke(pts, w, p.col([280, 34, 48], 0.95, 6, 4, 5), 0.75);
      w *= 0.84;
      if (depth < 2 && p.rand() < 0.3) vein(px, py, a + p.r(-1.2, 1.2), w * 0.85, depth + 1);
    }
  };
  for (let i = 0; i < 60; i++) vein(p.r(0, N), p.r(0, N), p.r(0, Math.PI * 2), p.r(3, 5.5), 0);
  for (let i = 0; i < 30; i++) p.crack(p.r(0, N), p.r(0, N), Math.floor(p.r(3, 7)), p.r(6, 12), p.r(1, 2), [290, 40, 5], 0.8);
  // Bone-white grit.
  for (let i = 0; i < 90; i++) p.stone(p.r(0, N), p.r(0, N), p.r(1.5, 3.5), p.r(1, 2.5), [45, 20, 72], 0.85, { shadow: 0.4, outline: 0.4 });
}

/** Cliff rock for steep banks: overlapping grey-brown slabs with cracks and lichen. */
function paintRock(p: Painter): void {
  const N = p.N;
  p.fill([28, 12, 22], 0.1);
  for (let i = 0; i < 70; i++) {
    const s = p.r(22, 48);
    p.stone(p.r(0, N), p.r(0, N), s, s * p.r(0.55, 0.85), [p.r(22, 40), p.r(6, 14), p.r(38, 52)], p.r(0.7, 1), { jitter: 0.22, shadow: 0.5, outline: 0.7, light: 0.55 });
  }
  for (let i = 0; i < 70; i++) p.crack(p.r(0, N), p.r(0, N), Math.floor(p.r(3, 7)), p.r(8, 16), p.r(1, 2), [25, 20, 14], 0.7);
  for (let i = 0; i < 160; i++) p.blotch(p.r(0, N), p.r(0, N), p.r(3, 9), p.rand() < 0.6 ? [75, 30, 46] : [50, 25, 70], 0.55, 0.04);
}

const PAINTERS: Record<GroundLayer, (p: Painter) => void> = {
  grass: paintGrass,
  forest: paintForest,
  dirt: (p) => paintDirt(p, false),
  road: (p) => paintDirt(p, true),
  cobble: paintCobble,
  shore: paintShore,
  blight: paintBlight,
  rock: paintRock,
};

export interface GroundPainting {
  layer: GroundLayer;
  albedo: HTMLCanvasElement;
  height: HTMLCanvasElement;
}

/** Paint every ground layer (each from its own seed, so the result never changes). */
export function paintGroundLayers(size = GROUND_TEX_SIZE): GroundPainting[] {
  return GROUND_LAYERS.map((layer, i) => {
    const p = new Painter(size, mulberry32(0x9e3779b1 + i * 7919));
    PAINTERS[layer](p);
    return { layer, albedo: p.albedo, height: p.height };
  });
}

/** All layers as one RGBA buffer, layer after layer: painted colour in RGB, height in A. */
export function groundLayerPixels(paintings: GroundPainting[]): Uint8Array {
  const N = paintings[0]!.albedo.width;
  const out = new Uint8Array(N * N * 4 * paintings.length);
  paintings.forEach((pt, l) => {
    const a = pt.albedo.getContext('2d')!.getImageData(0, 0, N, N).data;
    const h = pt.height.getContext('2d')!.getImageData(0, 0, N, N).data;
    const o = l * N * N * 4;
    for (let i = 0; i < N * N; i++) {
      out[o + i * 4] = a[i * 4]!;
      out[o + i * 4 + 1] = a[i * 4 + 1]!;
      out[o + i * 4 + 2] = a[i * 4 + 2]!;
      out[o + i * 4 + 3] = h[i * 4]!;
    }
  });
  return out;
}
