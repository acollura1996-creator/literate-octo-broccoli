// Empire (human) buildings. Footprints are centered on the origin, front faces +Z.
import {
  THREE, mat, geo, P, CG, glowMat, grp, add, beam, rod, fire, flag, banner, gableRoof, timberWalls,
  door, windowPane, mergedBoxes, crenRectGeo,
} from './common.js';

const HALF_PI = Math.PI / 2;

function foundation(root, size, h1 = 0.22, h2 = 0.18, inset = 0.3) {
  add(root, geo.box(size, h1, size), mat(P.stoneDark), [0, h1 / 2, 0]);
  add(root, geo.box(size - inset, h2, size - inset), mat(P.stone), [0, h1 + h2 / 2, 0]);
  return h1 + h2;
}

function stoneBlock(parent, w, h, d, x, y, z, color = P.stone, trim = P.stoneDark) {
  add(parent, geo.box(w, h, d), mat(color), [x, y + h / 2, z]);
  add(parent, geo.box(w + 0.08, 0.12, d + 0.08), mat(trim), [x, y + 0.06, z]);
}

/** Square stone tower with crenellated top. Returns top y. */
function squareTower(parent, x, z, y0, w, h, { color = P.stone, trim = P.stoneDark, cren = true, n = 3 } = {}) {
  add(parent, geo.box(w, h, w), mat(color), [x, y0 + h / 2, z]);
  add(parent, geo.box(w + 0.1, 0.14, w + 0.1), mat(trim), [x, y0 + 0.07, z]);
  add(parent, geo.box(w + 0.16, 0.14, w + 0.16), mat(trim), [x, y0 + h + 0.07, z]);
  if (cren) add(parent, crenRectGeo(w + 0.16, w + 0.16, n, 0.16, 0.18), mat(color), [x, y0 + h + 0.14, z]);
  return y0 + h + 0.14;
}

function pyramidRoof(parent, x, y, z, w, h, color, trimColor) {
  add(parent, CG.pyramid(), mat(color), [x, y, z], null, [w, h, w]);
  if (trimColor !== undefined) add(parent, geo.box(w + 0.04, 0.07, w + 0.04), mat(trimColor), [x, y + 0.035, z]);
  add(parent, geo.sphere(0.06, 6, 4), mat(P.gold), [x, y + h + 0.03, z]);
}

function coneRoof(parent, x, y, z, r, h, color, seg = 8) {
  add(parent, geo.cone(r, h, seg), mat(color), [x, y + h / 2, z]);
  add(parent, geo.cyl(r * 1.0, r * 1.02, 0.07, seg), mat(P.stoneDark), [x, y + 0.035, z]);
}

// ---------------------------------------------------------------------------
export function townhall(tc) {
  const root = new THREE.Group();
  const b = foundation(root, 3.7);
  // main hall
  timberWalls(root, 0, b, 0.3, 2.8, 1.25, 2.0);
  gableRoof(root, 0, b + 1.25, 0.3, 3.15, 2.45, 1.3, P.thatch, tc, { rows: 4 });
  // dormer on the roof front
  add(root, geo.box(0.5, 0.46, 0.5), mat(P.plaster), [0.8, b + 1.52, 1.0]);
  add(root, CG.gable(), mat(P.thatchDark), [0.8, b + 1.75, 1.0], [0, HALF_PI, 0], [0.62, 0.36, 0.66]);
  add(root, geo.box(0.04, 0.05, 0.62), mat(tc), [0.8, b + 2.1, 1.0], [Math.PI / 4, 0, 0]);
  windowPane(root, 0.8, b + 1.5, 1.26, 0.18, 0.2);
  // bell tower at the back
  const tz = -1.05;
  add(root, geo.box(1.25, 2.85, 1.2), mat(P.stone), [0, b + 1.425, tz]);
  add(root, geo.box(1.35, 0.14, 1.3), mat(P.stoneDark), [0, b + 1.4, tz]);
  add(root, geo.box(1.4, 0.14, 1.35), mat(P.stoneDark), [0, b + 2.85, tz]);
  add(root, geo.box(0.5, 0.55, 0.05), mat(0x1a1a20), [0, b + 2.45, tz + 0.6]);
  add(root, geo.cone(0.17, 0.28, 8), mat(P.gold), [0, b + 2.4, tz + 0.55]);
  pyramidRoof(root, 0, b + 2.92, tz, 1.5, 0.8, tc, P.goldDark);
  flag(root, 0.68, b + 2.92, tz + 0.62, tc, { pole: 0.55, w: 0.4, h: 0.24, dir: 1, finial: P.gold });
  // chimney
  add(root, geo.box(0.3, 1.25, 0.3), mat(P.stoneDark), [1.15, b + 1.7, -0.25]);
  // front: porch steps, door, windows, banners
  add(root, geo.box(1.0, 0.12, 0.35), mat(P.stoneLight), [0, b - 0.06 + 0.06, 1.48]);
  door(root, 0, b, 1.31, 0.55, 0.7, { frame: P.stoneDark });
  for (const s of [1, -1]) {
    windowPane(root, s * 0.95, b + 0.75, 1.31, 0.22, 0.28);
    banner(root, s * 0.5, b + 1.12, 1.34, tc, { w: 0.28, h: 0.5 });
    windowPane(root, s * 1.405, b + 0.7, 0.3, 0.22, 0.28, { ry: s * HALF_PI });
  }
  // barrels and crates by the entrance
  add(root, geo.cyl(0.14, 0.14, 0.32, 8), mat(P.wood), [1.55, b + 0.16, 1.45]);
  add(root, geo.box(0.3, 0.3, 0.3), mat(P.woodLight), [-1.5, b + 0.15, 1.45], [0, 0.3, 0]);
  add(root, geo.box(0.22, 0.22, 0.22), mat(P.woodLight), [-1.5, b + 0.41, 1.45], [0, -0.2, 0]);
  return { root, parts: {}, height: 4.0, radius: 1.95 };
}

// ---------------------------------------------------------------------------
export function keep(tc) {
  const root = new THREE.Group();
  const b = foundation(root, 3.7);
  const stone = P.stone;
  // main block with slate roof
  stoneBlock(root, 2.6, 1.85, 2.0, 0, b, -0.35);
  gableRoof(root, 0, b + 1.85, -0.35, 2.85, 2.3, 1.35, P.slate, tc, { rows: 4, rowColor: 0x6d7c9a });
  add(root, geo.box(0.35, 1.4, 0.35), mat(P.stoneDark), [-0.9, b + 2.3, -0.9]); // chimney
  // gatehouse between front towers
  add(root, geo.box(1.8, 1.55, 0.7), mat(stone), [0, b + 0.775, 0.95]);
  add(root, geo.box(1.9, 0.12, 0.8), mat(P.stoneDark), [0, b + 1.55, 0.95]);
  add(root, crenRectGeo(1.9, 0.8, 5, 0.16, 0.18), mat(stone), [0, b + 1.61, 0.95]);
  door(root, 0, b, 1.31, 0.6, 0.75, { frame: P.stoneDark });
  // two front towers
  for (const s of [1, -1]) {
    const top = squareTower(root, s * 1.25, 0.95, b, 0.95, 3.0, { n: 3 });
    pyramidRoof(root, s * 1.25, top + 0.04, 0.95, 0.9, 1.0, tc, P.goldDark);
    flag(root, s * 1.25, top + 1.04, 0.95, tc, { pole: 0.35, w: 0.4, h: 0.22, dir: -s, finial: null });
    banner(root, s * 1.25, b + 2.55, 1.44, tc, { w: 0.36, h: 1.0 });
    windowPane(root, s * 1.25, b + 1.0, 1.43, 0.1, 0.3, { pane: 0x1a1d26 });
  }
  // back buttresses + windows on the main block
  for (const s of [1, -1]) {
    add(root, geo.box(0.3, 1.3, 0.4), mat(P.stoneDark), [s * 1.32, b + 0.65, -1.2]);
    windowPane(root, s * 0.75, b + 1.3, 0.66, 0.16, 0.3);
  }
  return { root, parts: {}, height: 5.0, radius: 1.95 };
}

// ---------------------------------------------------------------------------
export function castle(tc) {
  const root = new THREE.Group();
  const b = foundation(root, 3.8, 0.24, 0.16, 0.2);
  const stone = mat(P.stone), stoneD = mat(P.stoneDark);
  // curtain walls
  const W = 2.8, wallH = 1.35, t = 0.3;
  for (const s of [1, -1]) {
    add(root, geo.box(W, wallH, t), stone, [0, b + wallH / 2, (s * W) / 2]);
    add(root, geo.box(t, wallH, W), stone, [(s * W) / 2, b + wallH / 2, 0]);
  }
  add(root, crenRectGeo(W + t, W + t, 7, 0.16, 0.18), stone, [0, b + wallH, 0]);
  // gatehouse
  add(root, geo.box(1.0, 1.9, 0.55), stone, [0, b + 0.95, 1.45]);
  add(root, crenRectGeo(1.05, 0.6, 3, 0.16, 0.18), stone, [0, b + 1.9, 1.45]);
  door(root, 0, b, 1.73, 0.5, 0.7, { frame: P.stoneDark });
  banner(root, 0, b + 1.75, 1.74, tc, { w: 0.34, h: 0.55 });
  // corner round towers with team cones
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const x = sx * 1.36, z = sz * 1.36;
      add(root, geo.cyl(0.46, 0.52, 2.5, 10), stone, [x, b + 1.25, z]);
      add(root, geo.cyl(0.55, 0.55, 0.14, 10), stoneD, [x, b + 2.5, z]);
      coneRoof(root, x, b + 2.57, z, 0.57, 1.15, tc, 10);
      add(root, geo.sphere(0.06, 6, 4), mat(P.gold), [x, b + 3.75, z]);
      add(root, geo.box(0.08, 0.28, 0.05), mat(0x1a1d26), [x, b + 1.6, z + sz * 0.48]);
    }
  }
  // central keep + great tower
  add(root, geo.box(1.75, 3.0, 1.6), stone, [0, b + 1.5, -0.25]);
  add(root, geo.box(1.85, 0.14, 1.7), stoneD, [0, b + 3.0, -0.25]);
  add(root, crenRectGeo(1.85, 1.7, 5, 0.18, 0.2), stone, [0, b + 3.07, -0.25]);
  for (const s of [1, -1]) {
    banner(root, s * 0.48, b + 2.75, 0.56, tc, { w: 0.34, h: 1.05 });
    windowPane(root, s * 0.48, b + 1.15, 0.56, 0.12, 0.3, { pane: 0x1a1d26 });
  }
  add(root, geo.cyl(0.48, 0.52, 1.3, 10), stone, [0, b + 3.65, -0.35]);
  add(root, geo.cyl(0.58, 0.58, 0.14, 10), stoneD, [0, b + 4.3, -0.35]);
  coneRoof(root, 0, b + 4.37, -0.35, 0.64, 1.0, tc, 10);
  flag(root, 0, b + 5.3, -0.35, tc, { pole: 0.32, w: 0.5, h: 0.28, dir: -1 });
  return { root, parts: {}, height: 6.0, radius: 1.95 };
}

// ---------------------------------------------------------------------------
export function farm(tc) {
  const root = new THREE.Group();
  // cottage at the back left
  const cx = -0.32, cz = -0.38;
  add(root, geo.box(1.05, 0.12, 0.9), mat(P.stoneDark), [cx, 0.06, cz]);
  timberWalls(root, cx, 0.12, cz, 0.95, 0.55, 0.75, { braces: false });
  gableRoof(root, cx, 0.67, cz, 1.18, 1.02, 0.66, P.thatch, tc, { rows: 2 });
  add(root, geo.box(0.17, 0.62, 0.17), mat(P.stoneDark), [cx - 0.33, 1.0, cz - 0.2]);
  door(root, cx + 0.15, 0.12, cz + 0.38, 0.2, 0.32, { frame: P.woodDark });
  windowPane(root, cx - 0.22, 0.45, cz + 0.38, 0.14, 0.14);
  // field
  add(root, geo.box(0.86, 0.06, 0.8), mat(0x6e4a2a), [0.45, 0.03, 0.47]);
  const rows = mergedBoxes('farmRows', [0, 1, 2, 3].map((i) => [0.74, 0.1, 0.1, 0, 0.05, -0.27 + i * 0.18]));
  add(root, rows, mat(0x7cbf3a), [0.45, 0.06, 0.47]);
  const wheat = mergedBoxes('farmWheat', [0, 1, 2, 3, 4, 5].map((i) => [0.07, 0.2, 0.07, -0.3 + (i % 3) * 0.3, 0.1, -0.18 + Math.floor(i / 3) * 0.36]));
  add(root, wheat, mat(0xe8c64a), [0.45, 0.06, 0.47]);
  // fence along the field edges
  const fence = mat(P.woodLight);
  const posts = mergedBoxes('farmPosts', [
    [0.05, 0.3, 0.05, -0.02, 0.15, 0.88], [0.05, 0.3, 0.05, 0.45, 0.15, 0.88], [0.05, 0.3, 0.05, 0.9, 0.15, 0.88],
    [0.05, 0.3, 0.05, 0.9, 0.15, 0.45], [0.05, 0.3, 0.05, 0.9, 0.15, 0.04],
    [0.95, 0.04, 0.03, 0.44, 0.22, 0.88], [0.95, 0.04, 0.03, 0.44, 0.12, 0.88],
    [0.03, 0.04, 0.86, 0.9, 0.22, 0.46], [0.03, 0.04, 0.86, 0.9, 0.12, 0.46],
  ]);
  add(root, posts, fence);
  // hay bale + haystack
  add(root, geo.cyl(0.13, 0.13, 0.2, 8), mat(P.thatch), [-0.55, 0.13, 0.45], [0, 0, HALF_PI]);
  add(root, geo.cone(0.22, 0.4, 7), mat(P.thatchDark), [-0.3, 0.2, 0.62]);
  flag(root, 0.25, 0.12, -0.75, tc, { pole: 1.55, w: 0.42, h: 0.26, dir: 1 });
  return { root, parts: {}, height: 1.8, radius: 0.95 };
}

// ---------------------------------------------------------------------------
export function barracks(tc) {
  const root = new THREE.Group();
  const b = 0.16;
  add(root, geo.box(2.8, b, 2.5), mat(P.stoneDark), [0, b / 2, -0.05]);
  const hz = -0.3;
  add(root, geo.box(2.4, 0.55, 1.5), mat(P.stone), [0, b + 0.275, hz]);
  timberWalls(root, 0, b + 0.55, hz, 2.36, 0.7, 1.46);
  gableRoof(root, 0, b + 1.25, hz, 2.65, 1.85, 1.1, P.thatch, tc, { rows: 3 });
  // tower at the right end
  const top = squareTower(root, -0.92, hz - 0.15, b, 0.75, 2.2, { n: 3 });
  pyramidRoof(root, -0.92, top + 0.02, hz - 0.15, 0.78, 0.5, tc, P.goldDark);
  // door + banners
  door(root, 0.15, b, hz + 0.76, 0.5, 0.65, { frame: P.stoneDark });
  for (const s of [1, -1]) banner(root, 0.15 + s * 0.48, b + 1.15, hz + 0.77, tc, { w: 0.26, h: 0.5 });
  windowPane(root, 0.88, b + 0.9, hz + 0.75, 0.2, 0.22);
  // weapon rack (front left = -X side as seen from the front is the building's right)
  const rx = -0.85, rz = 0.85;
  add(root, geo.box(0.06, 0.6, 0.06), mat(P.woodDark), [rx - 0.3, b + 0.3, rz]);
  add(root, geo.box(0.06, 0.6, 0.06), mat(P.woodDark), [rx + 0.3, b + 0.3, rz]);
  add(root, geo.box(0.7, 0.06, 0.06), mat(P.woodDark), [rx, b + 0.55, rz]);
  for (let i = 0; i < 3; i++) {
    const x = rx - 0.18 + i * 0.18;
    rod(root, [x, b, rz + 0.12], [x + 0.02, b + 0.95, rz - 0.02], 0.015, mat(P.wood), 5);
    add(root, geo.cone(0.03, 0.12, 4), mat(P.steelLight), [x + 0.02, b + 1.0, rz - 0.03]);
  }
  add(root, geo.cyl(0.15, 0.15, 0.04, 10), mat(tc), [rx + 0.3, b + 0.42, rz + 0.06], [HALF_PI, 0, 0]);
  // training dummy (front right)
  const dx = 0.95, dz = 0.85;
  add(root, geo.cyl(0.03, 0.03, 0.9, 5), mat(P.woodDark), [dx, b + 0.45, dz]);
  add(root, geo.cyl(0.11, 0.12, 0.38, 7), mat(P.thatch), [dx, b + 0.6, dz]);
  add(root, geo.box(0.55, 0.05, 0.05), mat(P.woodDark), [dx, b + 0.72, dz]);
  add(root, geo.sphere(0.09, 6, 4), mat(P.linen), [dx, b + 0.9, dz]);
  add(root, geo.box(0.04, 0.05, 0.02), mat(0xb02020), [dx, b + 0.62, dz + 0.12]);
  return { root, parts: {}, height: 3.05, radius: 1.45 };
}

// ---------------------------------------------------------------------------
export function blacksmith(tc) {
  const root = new THREE.Group();
  const b = 0.15;
  add(root, geo.box(2.75, b, 2.55), mat(P.stoneDark), [0, b / 2, 0]);
  const hx = 0.32, hz = -0.42;
  add(root, geo.box(1.75, 1.0, 1.4), mat(P.stone), [hx, b + 0.5, hz]);
  add(root, geo.box(1.82, 0.1, 1.47), mat(P.stoneDark), [hx, b + 0.05, hz]);
  gableRoof(root, hx, b + 1.0, hz, 1.95, 1.65, 0.95, P.slate, tc, { rows: 3, rowColor: 0x6d7c9a });
  // chimney
  add(root, geo.box(0.48, 2.2, 0.48), mat(P.stoneDark), [hx + 0.62, b + 1.1, hz - 0.35]);
  add(root, geo.box(0.58, 0.12, 0.58), mat(P.stone), [hx + 0.62, b + 2.26, hz - 0.35]);
  door(root, hx + 0.3, b, hz + 0.71, 0.4, 0.6, { frame: P.stoneDark });
  banner(root, hx - 0.35, b + 0.92, hz + 0.72, tc, { w: 0.28, h: 0.5 });
  // forge under a lean-to
  const fx = -0.82, fz = 0.45;
  for (const x of [-0.38, 0.38]) add(root, geo.box(0.07, 1.25, 0.07), mat(P.woodDark), [fx + x, b + 0.62, fz - 0.05]);
  add(root, geo.box(0.95, 0.06, 0.72), mat(P.woodDark), [fx, b + 1.3, fz - 0.38], [-0.3, 0, 0]);
  add(root, geo.box(0.97, 0.05, 0.08), mat(tc), [fx, b + 1.22, fz - 0.03]);
  add(root, geo.box(0.62, 0.42, 0.55), mat(P.stoneDark), [fx, b + 0.21, fz + 0.1]);
  add(root, geo.box(0.68, 0.06, 0.61), mat(P.stone), [fx, b + 0.42, fz + 0.1]);
  const coals = add(root, geo.box(0.46, 0.06, 0.4), glowMat(0xff5a10, 1), [fx, b + 0.46, fz + 0.1]);
  coals.castShadow = false;
  const fl = fire(root, fx, b + 0.48, fz + 0.1, 0.36);
  add(root, geo.box(0.22, 0.12, 0.3), mat(P.leather), [fx + 0.42, b + 0.3, fz - 0.1], [0, 0, 0.3]); // bellows
  // anvil on a stump
  const ax = 0.25, az = 0.75;
  add(root, geo.cyl(0.16, 0.18, 0.3, 7), mat(P.wood), [ax, b + 0.15, az]);
  add(root, geo.box(0.14, 0.1, 0.14), mat(P.iron), [ax, b + 0.35, az]);
  add(root, geo.box(0.18, 0.08, 0.36), mat(P.iron), [ax, b + 0.44, az]);
  add(root, geo.cone(0.05, 0.14, 4), mat(P.iron), [ax, b + 0.44, az + 0.24], [HALF_PI, 0, 0]);
  add(root, geo.cyl(0.15, 0.15, 0.32, 8), mat(P.wood), [0.95, b + 0.16, 0.8]); // quench barrel
  add(root, geo.cyl(0.13, 0.13, 0.02, 8), mat(0x3a6aa0), [0.95, b + 0.32, 0.8]);
  return { root, parts: { fire: [fl], glow: [coals] }, height: 2.5, radius: 1.45 };
}

// ---------------------------------------------------------------------------
export function sanctum(tc) {
  const root = new THREE.Group();
  const wall = mat(0xd9d4e6), roof = 0x5a3aa8, gold = mat(P.gold);
  add(root, geo.cyl(1.38, 1.42, 0.2, 12), mat(P.stoneDark), [0, 0.1, 0]);
  add(root, geo.cyl(1.12, 1.18, 0.16, 12), mat(P.stoneLight), [0, 0.28, 0]);
  const b = 0.36;
  add(root, geo.cyl(0.62, 0.75, 2.15, 10), wall, [0, b + 1.075, 0]);
  add(root, geo.cyl(0.71, 0.72, 0.12, 10), mat(tc), [0, b + 1.0, 0]);
  add(root, geo.cyl(0.68, 0.68, 0.12, 10), gold, [0, b + 2.12, 0]);
  add(root, geo.cone(0.92, 0.95, 10), mat(roof), [0, b + 2.18 + 0.475, 0]);
  add(root, geo.cone(0.05, 0.3, 4), gold, [0, b + 3.2, 0]);
  door(root, 0, b, 0.69, 0.38, 0.6, { frame: P.stoneDark });
  const glows = [];
  for (const a of [0.8, -0.8, Math.PI]) {
    const w = add(root, geo.box(0.14, 0.32, 0.05), glowMat(0x7fd0ff, 0.8), [Math.sin(a) * 0.66, b + 1.5, Math.cos(a) * 0.66], [0, a, 0]);
    glows.push(w);
  }
  banner(root, 0, b + 1.85, 0.66, tc, { w: 0.28, h: 0.55, emblem: P.gold });
  // four crystal pylons
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const x = Math.sin(a) * 1.0, z = Math.cos(a) * 1.0;
    add(root, geo.cyl(0.08, 0.12, 0.55, 6), mat(P.stoneLight), [x, b + 0.27, z]);
    const c = add(root, geo.octa(0.1), glowMat(0x9a7aff, 0.9), [x, b + 0.68, z], null, [0.8, 1.6, 0.8]);
    glows.push(c);
  }
  // floating orb with spinning rings
  const hover = grp(root, 0, 0, 0);
  const orb = add(hover, geo.ico(0.2, 1), glowMat(0x8fe0ff, 1), [0, 3.72, 0]);
  glows.push(orb);
  const spin = grp(hover, 0, 3.72, 0);
  add(spin, geo.torus(0.33, 0.022, 4, 16), gold, [0, 0, 0], [1.2, 0, 0]);
  add(spin, geo.torus(0.29, 0.018, 4, 16), mat(tc), [0, 0, 0], [1.9, 0.6, 0]);
  for (const s of [1, -1]) glows.push(add(spin, geo.sphere(0.05, 6, 4), glowMat(0xd8b0ff, 1), [s * 0.42, 0, 0]));
  for (const m of glows) m.castShadow = false;
  return { root, parts: { spin: [spin], bob: [hover], glow: glows }, height: 4.0, radius: 1.42 };
}

// ---------------------------------------------------------------------------
export function workshop(tc) {
  const root = new THREE.Group();
  const b = 0.15;
  add(root, geo.box(2.75, b, 2.5), mat(P.stoneDark), [0, b / 2, 0]);
  const hx = 0.25, hz = -0.3;
  add(root, geo.box(2.1, 0.35, 1.55), mat(P.stone), [hx, b + 0.175, hz]);
  timberWalls(root, hx, b + 0.35, hz, 2.0, 0.85, 1.48, { plaster: 0xc89a62 });
  gableRoof(root, hx, b + 1.2, hz, 2.25, 1.85, 1.0, 0x9a5230, tc, { rows: 3, rowColor: 0x6e3a20 });
  door(root, hx - 0.3, b, hz + 0.76, 0.6, 0.75, { frame: P.woodDark });
  banner(root, hx - 0.3, b + 1.1, hz + 0.78, tc, { w: 0.32, h: 0.3, emblem: null });
  // big gear on the facade
  const gear = grp(root, hx + 0.55, b + 0.78, hz + 0.78);
  const iron = mat(0x6a6058), brass = mat(0xc8962a);
  add(gear, geo.torus(0.24, 0.05, 4, 12), brass, [0, 0, 0]);
  const teeth = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    teeth.push([0.08, 0.09, 0.06, Math.sin(a) * 0.31, Math.cos(a) * 0.31, 0, 0]);
  }
  const tg = mergedBoxes('gearTeeth10', teeth);
  const tm = add(gear, tg, brass);
  tm.rotation.set(0, 0, 0);
  add(gear, geo.box(0.46, 0.05, 0.04), brass, [0, 0, 0], [0, 0, 0.5]);
  add(gear, geo.box(0.46, 0.05, 0.04), brass, [0, 0, 0], [0, 0, -1.07]);
  add(gear, geo.cyl(0.07, 0.07, 0.1, 8), iron, [0, 0, 0], [HALF_PI, 0, 0]);
  // horizontal flywheel on the roof (spins)
  add(root, geo.cyl(0.05, 0.05, 0.5, 6), iron, [hx + 0.65, b + 2.0, hz]);
  const fly = grp(root, hx + 0.65, b + 2.28, hz);
  add(fly, geo.torus(0.22, 0.04, 4, 12), brass, [0, 0, 0], [HALF_PI, 0, 0]);
  add(fly, geo.box(0.46, 0.04, 0.05), iron, [0, 0, 0]);
  add(fly, geo.box(0.05, 0.04, 0.46), iron, [0, 0, 0]);
  // crane on the left side with a hanging crate
  const cx = -1.15, cz = 0.3;
  add(root, geo.box(0.14, 2.45, 0.14), mat(P.woodDark), [cx, b + 1.22, cz]);
  beam(root, [cx, b + 1.6, cz], [cx + 0.45, b + 2.3, cz + 0.3], 0.07, mat(P.wood));
  beam(root, [cx - 0.05, b + 2.4, cz], [cx + 0.75, b + 2.55, cz + 0.55], 0.1, mat(P.wood));
  add(root, geo.box(0.015, 0.95, 0.015), mat(0xd8c89a), [cx + 0.7, b + 2.0, cz + 0.52]);
  add(root, geo.box(0.3, 0.26, 0.3), mat(P.woodLight), [cx + 0.7, b + 1.4, cz + 0.52], [0, 0.4, 0]);
  // chimney pipe + crates
  add(root, geo.cyl(0.08, 0.1, 0.9, 6), iron, [hx - 0.7, b + 1.95, hz - 0.35]);
  add(root, geo.box(0.32, 0.32, 0.32), mat(P.woodLight), [0.95, b + 0.16, 0.85], [0, 0.2, 0]);
  add(root, geo.box(0.24, 0.24, 0.24), mat(P.wood), [0.6, b + 0.12, 0.95], [0, -0.3, 0]);
  add(root, geo.cyl(0.22, 0.22, 0.05, 10), mat(P.woodDark), [1.2, b + 0.3, 0.2], [0, 0, 1.3]); // leaning wheel
  return { root, parts: { spin: [fly] }, height: 2.8, radius: 1.45 };
}

// ---------------------------------------------------------------------------
export function scouttower(tc) {
  const root = new THREE.Group();
  const log = mat(P.wood), logD = mat(P.woodDark);
  const pH = 2.35;
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      rod(root, [sx * 0.72, 0, sz * 0.72], [sx * 0.45, pH + 0.05, sz * 0.45], 0.06, log, 6, 0.075);
      add(root, geo.cyl(0.11, 0.13, 0.12, 6), mat(P.stoneDark), [sx * 0.72, 0.06, sz * 0.72]);
    }
  }
  // cross braces
  for (const s of [1, -1]) {
    beam(root, [s * 0.66, 0.35, -0.66], [s * 0.5, 1.9, 0.5], 0.05, logD);
    beam(root, [-0.66, 0.35, s * 0.66], [0.5, 1.9, s * 0.5], 0.05, logD);
  }
  add(root, geo.box(1.25, 0.1, 1.25), mat(P.woodLight), [0, pH, 0]);
  add(root, geo.box(1.3, 0.06, 1.3), logD, [0, pH - 0.08, 0]);
  // railing
  const rail = mergedBoxes('scoutRail', [
    [1.2, 0.05, 0.05, 0, 0.35, 0.6], [1.2, 0.05, 0.05, 0, 0.35, -0.6],
    [0.05, 0.05, 1.2, 0.6, 0.35, 0], [0.05, 0.05, 1.2, -0.6, 0.35, 0],
    [0.05, 0.4, 0.05, 0.0, 0.18, 0.6], [0.05, 0.4, 0.05, 0.0, 0.18, -0.6],
    [0.05, 0.4, 0.05, 0.6, 0.18, 0], [0.05, 0.4, 0.05, -0.6, 0.18, 0],
  ]);
  add(root, rail, logD, [0, pH + 0.05, 0]);
  // roof on 4 posts
  for (const sx of [1, -1]) for (const sz of [1, -1]) add(root, geo.box(0.06, 0.62, 0.06), logD, [sx * 0.56, pH + 0.34, sz * 0.56]);
  add(root, CG.pyramid(), mat(P.thatch), [0, pH + 0.62, 0], null, [1.45, 0.5, 1.45]);
  add(root, geo.box(1.48, 0.06, 1.48), mat(tc), [0, pH + 0.65, 0]);
  add(root, geo.sphere(0.06, 6, 4), mat(P.gold), [0, pH + 1.14, 0]);
  flag(root, -0.58, pH + 0.05, -0.58, tc, { pole: 1.12, w: 0.42, h: 0.24, dir: 1 });
  // ladder
  const ladder = mergedBoxes('ladder', [
    [0.04, 2.3, 0.04, -0.14, 1.15, 0], [0.04, 2.3, 0.04, 0.14, 1.15, 0],
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => [0.28, 0.03, 0.03, 0, 0.25 + i * 0.3, 0]),
  ]);
  add(root, ladder, mat(P.woodLight), [0.1, 0, 0.72], [-0.1, 0, 0]);
  banner(root, -0.3, pH - 0.05, 0.64, tc, { w: 0.24, h: 0.42 });
  return { root, parts: {}, height: 3.5, radius: 0.95 };
}

// ---------------------------------------------------------------------------
export function guardtower(tc) {
  const root = new THREE.Group();
  const stone = mat(P.stone), stoneD = mat(P.stoneDark);
  add(root, geo.box(1.7, 0.2, 1.7), stoneD, [0, 0.1, 0]);
  add(root, CG.frustum(0.82), stone, [0, 0.2 + 1.2, 0], null, [1.32, 2.4, 1.32]);
  add(root, geo.box(1.38, 0.14, 1.38), stoneD, [0, 0.32, 0]);
  add(root, geo.box(1.18, 0.12, 1.18), stoneD, [0, 1.5, 0]);
  // overhanging fighting platform
  add(root, geo.box(1.42, 0.18, 1.42), stoneD, [0, 2.69, 0]);
  add(root, geo.box(1.32, 0.34, 1.32), stone, [0, 2.95, 0]);
  add(root, crenRectGeo(1.38, 1.38, 4, 0.18, 0.2), stone, [0, 3.12, 0]);
  // corbels under the platform
  add(root, mergedBoxes('gtCorbels', [0, 1, 2, 3].flatMap((i) => {
    const t = -0.45 + i * 0.3;
    return [[0.1, 0.16, 0.1, t, 0, 0.62], [0.1, 0.16, 0.1, t, 0, -0.62], [0.1, 0.16, 0.1, 0.62, 0, t], [0.1, 0.16, 0.1, -0.62, 0, t]];
  })), stoneD, [0, 2.54, 0]);
  // tall roof + finial
  pyramidRoof(root, 0, 3.12, 0, 1.06, 0.84, tc, P.goldDark);
  // arrow slits + door + banner
  for (const a of [0, HALF_PI, -HALF_PI, Math.PI]) {
    add(root, geo.box(0.07, 0.3, 0.05), mat(0x1a1d26), [Math.sin(a) * 0.6, 2.05, Math.cos(a) * 0.6], [0, a, 0]);
  }
  door(root, 0, 0.2, 0.67, 0.36, 0.55, { frame: P.stoneDark });
  banner(root, 0, 2.5, 0.66, tc, { w: 0.34, h: 0.7 });
  return { root, parts: {}, height: 4.0, radius: 0.95 };
}

// ---------------------------------------------------------------------------
export function altar(tc) {
  const root = new THREE.Group();
  const marble = mat(P.marble), marbleD = mat(0xc9c3b6), gold = mat(P.gold);
  add(root, geo.box(2.75, 0.18, 2.75), marbleD, [0, 0.09, 0]);
  add(root, geo.box(2.35, 0.18, 2.35), marble, [0, 0.27, 0]);
  add(root, geo.box(1.3, 0.16, 1.3), marbleD, [0, 0.44, 0]);
  add(root, geo.box(1.0, 0.1, 0.2), marble, [0, 0.05, 1.38]); // front step
  add(root, geo.box(2.37, 0.04, 2.37), mat(tc), [0, 0.34, 0]); // team inlay band
  add(root, geo.box(2.3, 0.05, 2.3), marble, [0, 0.37, 0]);
  // four pillars topped with golden orbs
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const x = sx * 0.95, z = sz * 0.95;
      add(root, geo.box(0.3, 0.12, 0.3), marbleD, [x, 0.45, z]);
      add(root, geo.cyl(0.11, 0.13, 1.2, 8), marble, [x, 1.11, z]);
      add(root, geo.box(0.28, 0.1, 0.28), gold, [x, 1.76, z]);
      add(root, geo.sphere(0.12, 8, 6), gold, [x, 1.92, z]);
    }
  }
  // back arch with a team banner framing the statue
  add(root, geo.box(2.15, 0.16, 0.24), marble, [0, 1.92, -0.95]);
  add(root, geo.box(2.18, 0.05, 0.27), gold, [0, 1.83, -0.95]);
  banner(root, 0, 1.8, -0.8, tc, { w: 0.5, h: 0.75 });
  // golden hero statue on a pedestal (sword raised)
  add(root, geo.box(0.56, 0.4, 0.56), marbleD, [0, 0.72, 0]);
  add(root, geo.box(0.62, 0.06, 0.62), gold, [0, 0.93, 0]);
  const st = grp(root, 0, 0.96, 0);
  st.scale.setScalar(1.15);
  for (const s of [1, -1]) add(st, geo.box(0.1, 0.36, 0.12), gold, [s * 0.07, 0.18, 0]);
  add(st, CG.frustum(1.4), gold, [0, 0.52, 0], null, [0.26, 0.32, 0.18]);
  for (const s of [1, -1]) add(st, geo.sphere(0.07, 6, 4), gold, [s * 0.15, 0.66, 0]);
  add(st, geo.sphere(0.09, 7, 5), gold, [0, 0.8, 0]);
  add(st, geo.box(0.06, 0.3, 0.06), gold, [-0.17, 0.78, 0], [0, 0, -0.3]);
  add(st, geo.box(0.04, 0.5, 0.015), mat(P.steelLight), [-0.24, 1.18, 0]);
  add(st, geo.box(0.16, 0.03, 0.04), gold, [-0.235, 0.93, 0]);
  add(st, geo.box(0.06, 0.28, 0.06), gold, [0.17, 0.5, 0.04], [0.3, 0, 0.15]);
  add(st, CG.kite(), gold, [0.22, 0.42, 0.08], [0, 0.5, 0], [0.2, 0.28, 0.03]);
  // team cloth on the pedestal front
  add(root, geo.box(0.34, 0.32, 0.02), mat(tc), [0, 0.72, 0.29]);
  // braziers at the front corners with fire
  const fires = [];
  for (const s of [1, -1]) {
    const x = s * 0.5, z = 0.95;
    add(root, geo.cyl(0.04, 0.07, 0.42, 6), gold, [x, 0.6, z]);
    add(root, geo.cyl(0.17, 0.08, 0.12, 8), gold, [x, 0.85, z]);
    fires.push(fire(root, x, 0.9, z, 0.34));
  }
  return { root, parts: { fire: fires }, height: 2.6, radius: 1.42 };
}

// ---------------------------------------------------------------------------
export function construction() {
  const root = new THREE.Group();
  const pole = mat(P.wood), plank = mat(P.woodLight);
  const frame = mergedBoxes('scaffold', [
    [0.05, 0.9, 0.05, 0.42, 0.45, 0.42], [0.05, 0.9, 0.05, -0.42, 0.45, 0.42],
    [0.05, 0.9, 0.05, 0.42, 0.45, -0.42], [0.05, 0.9, 0.05, -0.42, 0.45, -0.42],
    [0.9, 0.04, 0.04, 0, 0.45, 0.42], [0.9, 0.04, 0.04, 0, 0.45, -0.42],
    [0.04, 0.04, 0.9, 0.42, 0.45, 0], [0.04, 0.04, 0.9, -0.42, 0.45, 0],
    [0.9, 0.04, 0.04, 0, 0.86, 0.42], [0.9, 0.04, 0.04, 0, 0.86, -0.42],
    [0.04, 0.04, 0.9, 0.42, 0.86, 0], [0.04, 0.04, 0.9, -0.42, 0.86, 0],
  ]);
  add(root, frame, pole);
  // diagonal braces
  beam(root, [-0.42, 0.05, 0.43], [0.42, 0.45, 0.43], 0.035, pole);
  beam(root, [0.43, 0.45, -0.42], [0.43, 0.86, 0.42], 0.035, pole);
  // plank walkways
  add(root, geo.box(0.86, 0.03, 0.2), plank, [0, 0.48, 0.32]);
  add(root, geo.box(0.2, 0.03, 0.86), plank, [-0.32, 0.48, 0]);
  // foundation stones + material pile
  add(root, geo.box(0.7, 0.1, 0.7), mat(P.stone), [0, 0.05, 0]);
  add(root, geo.box(0.36, 0.06, 0.12), plank, [0.12, 0.13, -0.1], [0, 0.3, 0]);
  add(root, geo.box(0.36, 0.06, 0.12), plank, [0.1, 0.19, -0.08], [0, 0.6, 0]);
  add(root, geo.dodeca(0.09), mat(P.stoneDark), [-0.15, 0.17, 0.15]);
  return { root, parts: {}, height: 0.95, radius: 0.5 };
}
