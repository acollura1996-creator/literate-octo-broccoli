// Neutral buildings, Kalenden's fortifications and doodads.
import {
  THREE, mat, geo, P, CG, glowMat, grp, add, rod, fire, flag, banner,
  mergedBoxes, crenRingGeo, crenRectGeo, gableRoof, timberWalls, door, windowPane,
} from './common.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HALF_PI = Math.PI / 2;

/** Cached merged cones (spikes): [[r, h, x, y, z, rx, rz], ...]. */
function spikesGeo(key, list) {
  return geo.custom(`spikes:${key}`, () => {
    const parts = list.map(([r, h, x, y, z, rx = 0, rz = 0]) => {
      const c = new THREE.ConeGeometry(r, h, 4);
      c.translate(0, h / 2, 0);
      c.rotateZ(rz);
      c.rotateX(rx);
      c.translate(x, y, z);
      return c;
    });
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

// ---------------------------------------------------------------------------
export function goldmine() {
  const root = new THREE.Group();
  const r1 = mat(0x8c7a64), r2 = mat(0x766652), r3 = mat(0x9d8c76);
  add(root, geo.dodeca(1.0), r1, [0, 0.5, -0.35], [0.2, 0.3, 0], [1.3, 0.85, 0.95]);
  add(root, geo.dodeca(0.72), r2, [-0.78, 0.4, -0.1], [0.5, 0.1, 0.2]);
  add(root, geo.dodeca(0.68), r3, [0.8, 0.38, -0.15], [0.1, 0.6, 0.3]);
  add(root, geo.dodeca(0.6), r2, [-0.15, 1.45, -0.6], [0.3, 0.2, 0.1], [1.1, 1.05, 1]);
  add(root, geo.dodeca(0.45), r3, [0.55, 1.15, -0.75], [0.7, 0.1, 0.4]);
  add(root, geo.dodeca(0.35), r1, [-0.85, 0.9, -0.7]);
  add(root, geo.dodeca(0.3), r3, [1.05, 0.2, 0.75], [0.2, 0.5, 0]);
  add(root, geo.dodeca(0.24), r2, [-1.15, 0.15, 0.7]);
  // mine entrance
  const ez = 0.38;
  add(root, geo.box(0.95, 1.0, 0.6), mat(0x120d08), [0, 0.5, ez - 0.05]);
  const wood = mat(P.woodDark);
  for (const s of [1, -1]) add(root, geo.box(0.12, 1.08, 0.14), wood, [s * 0.52, 0.54, ez + 0.28]);
  add(root, geo.box(1.25, 0.14, 0.18), wood, [0, 1.13, ez + 0.28]);
  add(root, geo.box(1.35, 0.06, 0.45), mat(P.wood), [0, 1.25, ez + 0.2], [-0.25, 0, 0]);
  add(root, geo.box(0.55, 0.16, 0.04), mat(P.woodLight), [0, 1.0, ez + 0.38]);
  // rails + cart
  const rails = mergedBoxes('mineRails', [
    [0.04, 0.04, 1.0, -0.18, 0.02, 0], [0.04, 0.04, 1.0, 0.18, 0.02, 0],
    ...[0, 1, 2, 3].map((i) => [0.5, 0.03, 0.07, 0, 0.015, -0.38 + i * 0.25]),
  ]);
  add(root, rails, mat(0x5a4a3a), [0, 0, ez + 0.6]);
  add(root, geo.box(0.42, 0.24, 0.32), mat(0x4a4a50), [0, 0.2, ez + 0.78]);
  for (const s of [1, -1]) add(root, geo.cyl(0.07, 0.07, 0.05, 8), mat(P.iron), [s * 0.22, 0.08, ez + 0.78], [0, 0, HALF_PI]);
  const goldM = glowMat(0xffc81e, 0.55);
  const glows = [];
  glows.push(add(root, geo.dodeca(0.16), goldM, [0, 0.36, ez + 0.78], null, [1.2, 0.6, 1]));
  // gold veins / nuggets
  for (const [x, y, z, s] of [[-0.55, 0.85, 0.12, 0.12], [0.55, 0.75, 0.25, 0.1], [0.2, 1.55, -0.1, 0.11], [-0.9, 0.35, 0.55, 0.09], [0.95, 0.5, 0.35, 0.1], [-0.3, 1.2, 0.2, 0.08], [0.42, 0.05, 1.12, 0.08], [-0.45, 0.05, 1.05, 0.07]]) {
    glows.push(add(root, geo.octa(s), goldM, [x, y, z], [0.3, 0.5, 0]));
  }
  for (const m of glows) m.castShadow = false;
  return { root, parts: { glow: glows }, height: 2.2, radius: 1.45 };
}

// ---------------------------------------------------------------------------
export function shop() {
  const root = new THREE.Group();
  const red = mat(0xc8342a), yellow = mat(0xf2c63a), wood = mat(0x9a6a3a), woodD = mat(P.woodDark);
  add(root, geo.box(2.65, 0.12, 2.5), mat(P.woodLight), [0, 0.06, 0]);
  // round hut with striped cone roof
  add(root, geo.cyl(0.82, 0.86, 1.1, 10), wood, [0, 0.67, -0.35]);
  add(root, geo.cyl(0.87, 0.87, 0.08, 10), woodD, [0, 0.2, -0.35]);
  add(root, geo.cone(1.12, 0.95, 10), red, [0, 1.22 + 0.475, -0.35]);
  add(root, geo.cyl(0.62, 0.78, 0.18, 10), yellow, [0, 1.6, -0.35]);
  add(root, geo.cyl(0.22, 0.34, 0.12, 10), yellow, [0, 2.0, -0.35]);
  rod(root, [0, 2.1, -0.35], [0, 2.45, -0.35], 0.025, woodD);
  add(root, CG.pennant(), mat(0x3aa83a), [0, 2.38, -0.35], null, [0.42, 0.2, 0.02]);
  // striped awning
  for (let i = 0; i < 6; i++) {
    add(root, geo.box(0.26, 0.04, 0.72), i % 2 ? yellow : red, [-0.65 + i * 0.26, 1.2, 0.62], [0.32, 0, 0]);
  }
  for (const s of [1, -1]) add(root, geo.box(0.06, 1.0, 0.06), woodD, [s * 0.75, 0.6, 0.95]);
  // counter + potions
  add(root, geo.box(1.4, 0.45, 0.36), wood, [0, 0.34, 0.7]);
  add(root, geo.box(1.48, 0.05, 0.42), woodD, [0, 0.58, 0.7]);
  const glows = [];
  for (const [x, c] of [[-0.45, 0xff3a3a], [-0.2, 0x3a7aff], [0.05, 0x3aff6a], [0.3, 0xff3a3a]]) {
    glows.push(add(root, geo.sphere(0.075, 6, 5), glowMat(c, 0.45), [x, 0.68, 0.72]));
    add(root, geo.cyl(0.02, 0.025, 0.06, 5), mat(0xc8a070), [x, 0.77, 0.72]);
  }
  // goblin merchant behind the counter
  const gob = mat(0x6ab83a);
  add(root, geo.box(0.26, 0.22, 0.2), mat(0x7a3a8a), [0.45, 0.74, 0.42]);
  add(root, geo.sphere(0.13, 7, 5), gob, [0.45, 0.95, 0.44]);
  add(root, geo.cone(0.035, 0.12, 4), gob, [0.45, 0.94, 0.58], [HALF_PI, 0, 0]);
  for (const s of [1, -1]) add(root, geo.cone(0.05, 0.22, 4), gob, [0.45 + s * 0.17, 1.0, 0.42], [0, 0, -s * 1.3]);
  add(root, geo.cyl(0.08, 0.13, 0.1, 7), mat(0x7a3a8a), [0.45, 1.08, 0.43]);
  // sign
  add(root, geo.box(0.07, 1.3, 0.07), woodD, [1.08, 0.65, 0.95]);
  add(root, geo.box(0.55, 0.32, 0.05), mat(P.woodLight), [1.08, 1.25, 0.98]);
  add(root, geo.cyl(0.11, 0.11, 0.03, 10), mat(P.gold), [1.08, 1.25, 1.02], [HALF_PI, 0, 0]);
  // crates, barrels, sacks
  add(root, geo.box(0.36, 0.36, 0.36), mat(P.woodLight), [-1.0, 0.3, 0.6], [0, 0.3, 0]);
  add(root, geo.box(0.28, 0.28, 0.28), mat(P.wood), [-1.05, 0.62, 0.62], [0, -0.2, 0]);
  add(root, geo.cyl(0.18, 0.18, 0.42, 8), mat(P.wood), [-1.0, 0.33, -0.3]);
  add(root, geo.cyl(0.19, 0.19, 0.04, 8), mat(P.iron), [-1.0, 0.45, -0.3]);
  add(root, geo.cyl(0.16, 0.16, 0.36, 8), mat(P.wood), [1.0, 0.3, -0.5]);
  add(root, geo.sphere(0.17, 6, 5), mat(0xd8c08a), [1.05, 0.25, 0.35], null, [1, 0.8, 1]);
  for (const m of glows) m.castShadow = false;
  return { root, parts: { glow: glows }, height: 2.6, radius: 1.45 };
}

// ---------------------------------------------------------------------------
export function mercenary_camp() {
  const root = new THREE.Group();
  const canvas = mat(0xd9c69a), stripe = mat(0x8a2a22), woodD = mat(P.woodDark);
  add(root, geo.cyl(1.38, 1.4, 0.04, 14), mat(0x8a6a44), [0, 0.02, 0]);
  // big round tent
  add(root, geo.cone(0.75, 1.45, 9), mat(0x9a3a2a), [-0.55, 0.04 + 0.725, -0.55]);
  add(root, geo.cyl(0.62, 0.77, 0.12, 9), canvas, [-0.55, 0.42, -0.55]);
  add(root, geo.box(0.32, 0.5, 0.05), mat(0x2a1a14), [-0.55, 0.29, 0.11], [-0.45, 0, 0]);
  rod(root, [-0.55, 1.4, -0.55], [-0.55, 1.75, -0.55], 0.025, woodD);
  // A-frame tent
  const t = grp(root, 0.75, 0.04, -0.45, HALF_PI);
  add(t, CG.gable(), canvas, [0, 0, 0], null, [1.1, 0.8, 0.9]);
  add(t, geo.box(1.14, 0.06, 0.08), stripe, [0, 0.8, 0], [Math.PI / 4, 0, 0]);
  add(t, geo.box(0.04, 0.42, 0.3), mat(0x2a1a14), [-0.56, 0.18, 0], [0, 0, 0]);
  // campfire
  const fx = 0.1, fz = 0.45;
  const stones = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    stones.push([0.12, 0.09, 0.1, Math.sin(a) * 0.24, 0.045, Math.cos(a) * 0.24, a]);
  }
  add(root, mergedBoxes('fireRing7', stones), mat(P.stoneDark), [fx, 0.03, fz]);
  add(root, geo.box(0.36, 0.06, 0.07), woodD, [fx, 0.08, fz], [0, 0.6, 0]);
  add(root, geo.box(0.36, 0.06, 0.07), woodD, [fx, 0.1, fz], [0, -0.6, 0]);
  const fl = fire(root, fx, 0.08, fz, 0.42);
  // log seats
  add(root, geo.cyl(0.08, 0.08, 0.5, 6), mat(P.wood), [fx - 0.55, 0.1, fz + 0.15], [0, 0.4, HALF_PI]);
  add(root, geo.cyl(0.08, 0.08, 0.5, 6), mat(P.wood), [fx + 0.55, 0.1, fz + 0.3], [0, -0.5, HALF_PI]);
  // weapon rack
  const wx = 0.95, wz = 0.55;
  add(root, mergedBoxes('mercRack', [
    [0.05, 0.6, 0.05, -0.25, 0.3, 0], [0.05, 0.6, 0.05, 0.25, 0.3, 0], [0.6, 0.05, 0.05, 0, 0.55, 0],
  ]), woodD, [wx, 0.04, wz], [0, -0.6, 0]);
  rod(root, [wx - 0.1, 0.04, wz + 0.12], [wx - 0.04, 0.95, wz - 0.02], 0.015, mat(P.wood));
  add(root, CG.axeHead(), mat(P.steelDark), [wx - 0.045, 0.85, wz], [0, -0.6, 0], 0.28);
  rod(root, [wx + 0.12, 0.04, wz - 0.05], [wx + 0.16, 0.8, wz - 0.12], 0.012, mat(P.steelLight));
  // banner pole
  flag(root, -1.05, 0.04, 0.85, 0x8a1a1a, { pole: 2.1, w: 0.55, h: 0.42, dir: 1, finial: P.bone });
  add(root, geo.cyl(0.2, 0.2, 0.36, 8), mat(P.wood), [-0.95, 0.22, 0.25]);
  return { root, parts: { fire: [fl] }, height: 2.2, radius: 1.42 };
}

// ---------------------------------------------------------------------------
export function fountain() {
  return fountainOf({ water: 0x4ac8ff, glow: 0x2a9ad8, jet: 0x9ae6ff, jetGlow: 0x4ab8f0, crystal: 0x8affd0 });
}

// ---------------------------------------------------------------------------
/** A fountain; the healing one has blue water and green crystals, the mana one violet. */
function fountainOf({ water: wc, glow: wg, jet: jc, jetGlow, crystal }) {
  const root = new THREE.Group();
  const stone = mat(P.stoneLight), stoneD = mat(P.stone);
  const water = mat(wc, { emissive: wg, emissiveIntensity: 0.55, transparent: true, opacity: 0.85 });
  add(root, geo.cyl(1.38, 1.42, 0.12, 14), stoneD, [0, 0.06, 0]);
  add(root, geo.cyl(1.28, 1.3, 0.36, 14), stone, [0, 0.3, 0]);
  add(root, geo.torus(1.18, 0.12, 4, 14), stone, [0, 0.5, 0], [HALF_PI, 0, Math.PI / 4]);
  const pool = add(root, geo.cyl(1.1, 1.1, 0.04, 14), water, [0, 0.49, 0]);
  // central column with an upper bowl
  add(root, geo.cyl(0.18, 0.24, 0.75, 8), stoneD, [0, 0.85, 0]);
  add(root, geo.cyl(0.5, 0.22, 0.16, 10), stone, [0, 1.12, 0]);
  const bowlWater = add(root, geo.cyl(0.44, 0.44, 0.03, 10), water, [0, 1.19, 0]);
  add(root, geo.cyl(0.08, 0.11, 0.3, 6), stoneD, [0, 1.35, 0]);
  add(root, geo.sphere(0.12, 8, 6), stone, [0, 1.52, 0]);
  // water jet (bobs)
  const jet = grp(root, 0, 0, 0);
  const jetM = mat(jc, { emissive: jetGlow, emissiveIntensity: 0.7, transparent: true, opacity: 0.75 });
  const j1 = add(jet, geo.cone(0.09, 0.32, 6), jetM, [0, 1.72, 0]);
  const j2 = add(jet, geo.sphere(0.09, 6, 4), jetM, [0, 1.8, 0]);
  const fall = add(root, geo.cyl(0.45, 0.18, 0.35, 10), mat(jc, { transparent: true, opacity: 0.35 }), [0, 1.0, 0]);
  // glowing crystals around the rim
  const glows = [pool, bowlWater, j1, j2];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    glows.push(add(root, geo.octa(0.08), glowMat(crystal, 0.8), [Math.sin(a) * 1.18, 0.66, Math.cos(a) * 1.18], null, [0.8, 1.4, 0.8]));
  }
  for (const m of glows) m.castShadow = false;
  fall.castShadow = false;
  return { root, parts: { glow: glows, bob: [jet] }, height: 1.8, radius: 1.42 };
}

export function fountain_mana() {
  return fountainOf({ water: 0x8a5aff, glow: 0x6a3ae8, jet: 0xc8a8ff, jetGlow: 0x8a5af0, crystal: 0x6ab8ff });
}

// ---------------------------------------------------------------------------
export function tavern() {
  const root = new THREE.Group();
  const stoneD = mat(P.stoneDark), wood = mat(P.wood), woodD = mat(P.woodDark);
  add(root, geo.box(2.8, 0.16, 2.5), stoneD, [0, 0.08, 0]);
  // two storeys: stone ground floor, timbered upper floor jutting out over it
  add(root, geo.box(2.2, 0.85, 1.7), mat(P.stone), [0, 0.58, -0.2]);
  add(root, mergedBoxes('tavernCourses', [
    [2.22, 0.04, 1.72, 0, 0.4, 0], [2.22, 0.04, 1.72, 0, 0.7, 0],
  ]), stoneD, [0, 0, -0.2]);
  timberWalls(root, 0, 1.0, -0.2, 2.35, 0.75, 1.85, { plaster: P.plaster });
  gableRoof(root, 0, 1.75, -0.2, 2.6, 2.1, 0.95, 0x9a3a26, P.woodDark, { rows: 3 });
  // chimney with a fire on top
  add(root, geo.box(0.32, 1.1, 0.32), stoneD, [0.75, 2.2, -0.75]);
  const smoke = fire(root, 0.75, 2.76, -0.75, 0.22);
  door(root, -0.45, 0.16, 0.66, 0.42, 0.6, { color: P.woodDark, frame: P.woodLight });
  windowPane(root, 0.45, 0.62, 0.66, 0.28, 0.24, { pane: 0xffc86a });
  for (const x of [-0.6, 0.6]) windowPane(root, x, 1.35, 0.76, 0.24, 0.22, { pane: 0xffc86a });
  // hanging sign with a foaming mug
  rod(root, [-1.05, 1.05, 0.7], [-1.05, 1.05, 1.15], 0.025, woodD);
  const sign = grp(root, -1.05, 0.86, 1.05);
  add(sign, geo.box(0.04, 0.34, 0.44), mat(P.woodLight), [0, 0, 0]);
  add(sign, geo.cyl(0.08, 0.07, 0.14, 7), mat(P.goldDark), [0.03, -0.02, 0], [0, 0, HALF_PI]);
  add(sign, geo.sphere(0.07, 6, 4), mat(P.white), [0.03, 0.06, 0]);
  // warm lanterns and barrels
  const glows = [];
  for (const x of [-0.1, 0.95]) {
    glows.push(add(root, geo.box(0.09, 0.13, 0.09), glowMat(0xffb04a, 0.9), [x, 0.95, 0.75]));
  }
  for (const [x, z] of [[1.15, 0.85], [1.0, 1.1]]) {
    add(root, geo.cyl(0.17, 0.19, 0.4, 8), mat(0x9a6434), [x, 0.36, z]);
    add(root, geo.cyl(0.19, 0.19, 0.03, 8), mat(P.iron), [x, 0.46, z]);
  }
  add(root, geo.box(0.7, 0.06, 0.3), wood, [0.35, 0.45, 1.0]); // bench
  for (const sx of [0.05, 0.65]) add(root, geo.box(0.06, 0.28, 0.25), woodD, [sx, 0.3, 1.0]);
  for (const m of glows) m.castShadow = false;
  return { root, parts: { fire: [smoke], glow: glows }, height: 2.9, radius: 1.45 };
}

// ---------------------------------------------------------------------------
export function marketplace() {
  const root = new THREE.Group();
  const woodD = mat(P.woodDark), wood = mat(P.wood), woodL = mat(P.woodLight);
  add(root, geo.box(2.8, 0.1, 2.8), mat(0xb8a27a), [0, 0.05, 0]);
  // three stalls with striped awnings around a little square
  const stall = (x, z, ry, c1, c2, goods) => {
    const g = grp(root, x, 0.1, z, ry);
    add(g, geo.box(1.0, 0.42, 0.42), wood, [0, 0.21, 0.1]);
    add(g, geo.box(1.06, 0.05, 0.48), woodL, [0, 0.44, 0.1]);
    for (const sx of [-0.48, 0.48]) for (const sz of [-0.15, 0.3]) add(g, geo.box(0.05, 1.05, 0.05), woodD, [sx, 0.52, sz]);
    for (let i = 0; i < 5; i++) add(g, geo.box(0.21, 0.035, 0.68), i % 2 ? mat(c2) : mat(c1), [-0.42 + i * 0.21, 1.05, 0.12], [0.22, 0, 0]);
    goods.forEach(([gx, c, kind], i) => {
      if (kind === 'ball') add(g, geo.sphere(0.07, 6, 4), mat(c), [gx, 0.53, 0.1 + (i % 2) * 0.1]);
      else add(g, geo.box(0.13, 0.11, 0.13), mat(c), [gx, 0.53, 0.12], [0, i * 0.4, 0]);
    });
    return g;
  };
  stall(-0.75, -0.75, 0.3, 0x2a6ac8, 0xf2e6c8, [[-0.3, 0xd83a2a, 'ball'], [-0.1, 0xe8a83a, 'ball'], [0.15, 0x6a8a3a, 'box'], [0.35, 0xc8b06a, 'box']]);
  stall(0.8, -0.65, -0.35, 0x3a8a3a, 0xf2e6c8, [[-0.3, 0x8a5aaa, 'box'], [0.0, 0xd8d8e8, 'ball'], [0.3, 0x5a3a1c, 'box']]);
  stall(0.0, 0.85, Math.PI, 0xc8342a, 0xf2c63a, [[-0.3, 0xf2c43c, 'ball'], [-0.05, 0xb4bcc6, 'box'], [0.25, 0x2a8a8a, 'ball']]);
  // a goblin weighing gold, scales and sacks
  const gob = mat(0x6ab83a);
  add(root, geo.box(0.24, 0.22, 0.18), mat(0x8a6a2a), [0.15, 0.35, 0.05]);
  add(root, geo.sphere(0.12, 7, 5), gob, [0.15, 0.56, 0.06]);
  for (const s of [1, -1]) add(root, geo.cone(0.045, 0.2, 4), gob, [0.15 + s * 0.16, 0.6, 0.05], [0, 0, -s * 1.3]);
  rod(root, [-0.35, 0.1, 0.1], [-0.35, 0.75, 0.1], 0.02, mat(P.goldDark));
  add(root, geo.box(0.5, 0.02, 0.02), mat(P.goldDark), [-0.35, 0.75, 0.1]);
  for (const s of [1, -1]) add(root, geo.cyl(0.09, 0.06, 0.04, 8), mat(P.gold), [-0.35 + s * 0.22, 0.6, 0.1]);
  for (const [x, z] of [[1.15, 0.6], [-1.15, 0.5], [1.05, 1.05]]) add(root, geo.sphere(0.17, 6, 5), mat(0xd8c08a), [x, 0.22, z], null, [1, 0.85, 1]);
  add(root, geo.box(0.34, 0.34, 0.34), woodL, [-1.1, 0.27, 1.05], [0, 0.4, 0]);
  flag(root, 1.25, 0.1, -1.2, 0xf2c63a, { pole: 2.0, w: 0.5, h: 0.32, dir: -1 });
  return { root, parts: {}, height: 2.1, radius: 1.45 };
}

// ---------------------------------------------------------------------------
export function goblin_lab() {
  const root = new THREE.Group();
  const iron = mat(0x6a6e78), ironD = mat(0x44474e), copper = mat(0xb8733a), rust = mat(P.rust);
  add(root, geo.box(2.8, 0.14, 2.6), mat(0x5a5a5e), [0, 0.07, 0]);
  // riveted metal workshop with a curved roof
  add(root, geo.box(1.9, 1.05, 1.5), iron, [-0.2, 0.66, -0.35]);
  add(root, geo.cyl(0.78, 0.78, 1.95, 10), rust, [-0.2, 1.18, -0.35], [0, 0, HALF_PI]);
  add(root, mergedBoxes('labRivets', [0, 1, 2, 3, 4, 5].map((i) => [0.05, 0.05, 0.03, -1.0 + i * 0.32, 0.95, 0.42])), mat(P.steelLight));
  add(root, geo.box(0.55, 0.7, 0.06), ironD, [-0.6, 0.5, 0.42]);
  add(root, geo.box(0.42, 0.3, 0.05), glowMat(0x8aff4a, 0.5), [0.3, 0.75, 0.42]);
  // smokestack with green fumes
  add(root, geo.cyl(0.16, 0.2, 1.4, 8), ironD, [0.55, 1.75, -0.8]);
  add(root, geo.cyl(0.22, 0.22, 0.08, 8), copper, [0.55, 2.45, -0.8]);
  const fumes = fire(root, 0.55, 2.48, -0.8, 0.3, 'green');
  // bubbling vats and a tesla coil
  const glows = [];
  for (const [x, z, c] of [[0.95, 0.55, 0x8aff4a], [1.05, -0.15, 0xff5ad8]]) {
    add(root, geo.cyl(0.26, 0.22, 0.5, 9), copper, [x, 0.39, z]);
    glows.push(add(root, geo.cyl(0.22, 0.22, 0.04, 9), glowMat(c, 0.9), [x, 0.64, z]));
    glows.push(add(root, geo.sphere(0.06, 5, 4), glowMat(c, 1), [x + 0.06, 0.7, z]));
  }
  add(root, geo.cyl(0.08, 0.14, 1.2, 6), copper, [-1.1, 0.74, 0.65]);
  const coil = grp(root, -1.1, 1.38, 0.65);
  for (const y of [0, 0.14, 0.28]) add(coil, geo.torus(0.13 - y * 0.15, 0.025, 4, 10), copper, [0, y, 0], [HALF_PI, 0, 0]);
  glows.push(add(coil, geo.sphere(0.1, 7, 5), glowMat(0x8ad8ff, 1), [0, 0.42, 0]));
  // pipes and gears
  rod(root, [0.55, 1.2, -0.8], [0.95, 0.62, 0.55], 0.04, copper);
  add(root, geo.cyl(0.2, 0.2, 0.06, 10), iron, [-1.05, 0.9, -0.4], [0, 0, HALF_PI]);
  add(root, geo.box(0.34, 0.34, 0.34), mat(P.woodLight), [1.1, 0.27, 1.05], [0, 0.4, 0]);
  for (const m of glows) m.castShadow = false;
  return { root, parts: { fire: [fumes], glow: glows, spin: [coil] }, height: 2.6, radius: 1.45 };
}

// ---------------------------------------------------------------------------
export function waygate() {
  const root = new THREE.Group();
  const stone = mat(0x8a8c96), stoneD = mat(0x5e606a), rune = glowMat(0x6ad8ff, 1);
  // round dais (units walk onto it) with four standing stones
  add(root, geo.cyl(1.45, 1.5, 0.12, 16), stoneD, [0, 0.06, 0]);
  add(root, geo.cyl(1.2, 1.25, 0.08, 16), stone, [0, 0.16, 0]);
  const glows = [];
  glows.push(add(root, geo.torus(0.95, 0.04, 3, 20), rune, [0, 0.21, 0], [HALF_PI, 0, 0]));
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const x = Math.sin(a) * 1.32;
    const z = Math.cos(a) * 1.32;
    add(root, geo.box(0.26, 1.5, 0.22), stone, [x, 0.75, z], [0, a, 0.06]);
    add(root, geo.cone(0.16, 0.3, 4), stoneD, [x, 1.65, z], [0, a + Math.PI / 4, 0]);
    glows.push(add(root, geo.box(0.07, 0.42, 0.03), rune, [Math.sin(a) * 1.2, 0.95, Math.cos(a) * 1.2], [0, a, 0]));
  }
  // a floating ring of light with a swirling core
  const hover = grp(root, 0, 0, 0);
  const swirl = grp(hover, 0, 1.15, 0);
  glows.push(add(swirl, geo.torus(0.6, 0.06, 4, 18), glowMat(0x9ae8ff, 1), [0, 0, 0], [HALF_PI, 0, 0]));
  glows.push(add(swirl, geo.cyl(0.52, 0.52, 0.02, 14), mat(0x5ab8ff, { emissive: 0x3a9aff, emissiveIntensity: 0.8, transparent: true, opacity: 0.6 }), [0, 0, 0]));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    glows.push(add(swirl, geo.octa(0.07), glowMat(0xe8f8ff, 1), [Math.sin(a) * 0.6, 0, Math.cos(a) * 0.6]));
  }
  const beamM = mat(0x8ad8ff, { emissive: 0x5ab8ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.22, depthWrite: false });
  const column = add(root, geo.cyl(0.5, 0.75, 1.0, 12), beamM, [0, 0.7, 0]);
  column.castShadow = false;
  for (const m of glows) m.castShadow = false;
  return { root, parts: { glow: glows, spin: [swirl], bob: [hover] }, height: 1.8, radius: 1.45 };
}

// ---------------------------------------------------------------------------
export function shrine() {
  const root = new THREE.Group();
  const stone = mat(0xb8b4a8), stoneD = mat(0x8a8678), moss = mat(0x5f8a3a), gold = glowMat(0xffd85a, 0.9);
  add(root, geo.cyl(0.95, 1.0, 0.16, 8), stoneD, [0, 0.08, 0]);
  add(root, geo.cyl(0.72, 0.78, 0.14, 8), stone, [0, 0.23, 0]);
  add(root, geo.box(0.42, 1.25, 0.42), stone, [0, 0.92, 0], [0, Math.PI / 4, 0]);
  add(root, CG.pyramid(), stoneD, [0, 1.55, 0], [0, Math.PI / 4, 0], [0.48, 0.32, 0.48]);
  add(root, geo.box(0.3, 0.08, 0.3), moss, [0.2, 0.32, 0.25], [0.1, 0.5, 0]);
  const glows = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    glows.push(add(root, geo.box(0.06, 0.5, 0.02), gold, [Math.sin(a) * 0.22, 0.95, Math.cos(a) * 0.22], [0, a, 0]));
  }
  // floating golden crystal
  const hover = grp(root, 0, 0, 0);
  const spin = grp(hover, 0, 2.25, 0);
  glows.push(add(spin, geo.octa(0.22), gold, [0, 0, 0], null, [0.8, 1.6, 0.8]));
  for (const s of [1, -1]) glows.push(add(spin, geo.octa(0.07), glowMat(0xfff4c8, 1), [s * 0.35, -0.1, 0]));
  for (const m of glows) m.castShadow = false;
  return { root, parts: { glow: glows, spin: [spin], bob: [hover] }, height: 2.6, radius: 0.95 };
}

// ---------------------------------------------------------------------------
export function cage() {
  const root = new THREE.Group();
  const wood = mat(P.woodDark), woodL = mat(P.wood), rope = mat(0xb8a070);
  add(root, geo.box(1.7, 0.12, 1.7), woodL, [0, 0.06, 0]);
  const bars = [];
  for (let i = 0; i < 5; i++) {
    const t = -0.72 + i * 0.36;
    bars.push([0.07, 1.35, 0.07, t, 0.78, 0.8], [0.07, 1.35, 0.07, t, 0.78, -0.8], [0.07, 1.35, 0.07, 0.8, 0.78, t], [0.07, 1.35, 0.07, -0.8, 0.78, t]);
  }
  add(root, mergedBoxes('cageBars', bars), wood);
  add(root, geo.box(1.76, 0.1, 1.76), woodL, [0, 1.48, 0]);
  add(root, geo.box(1.76, 0.08, 0.1), rope, [0, 0.5, 0.82]);
  add(root, geo.box(0.16, 0.18, 0.06), mat(P.iron), [0.25, 0.8, 0.85]); // padlock
  // two captives inside, slumped
  for (const [x, z, c, ry] of [[-0.3, -0.2, 0x8a6a42, 0.5], [0.3, 0.15, 0x5a6a8a, -0.6]]) {
    const g = grp(root, x, 0.12, z, ry);
    add(g, geo.box(0.26, 0.36, 0.18), mat(c), [0, 0.2, 0], [0.25, 0, 0]);
    add(g, geo.sphere(0.1, 6, 5), mat(P.skin), [0, 0.46, 0.06]);
    add(g, geo.box(0.24, 0.1, 0.32), mat(c), [0, 0.06, 0.12]);
  }
  return { root, parts: {}, height: 1.6, radius: 0.95 };
}

// ---------------------------------------------------------------------------
export function kalenden_keep() {
  const root = new THREE.Group();
  const ds = mat(P.darkStone), ds2 = mat(P.darkStone2), iron = mat(P.darkIron);
  const crimsonD = mat(P.crimsonDark), spikeM = mat(0x5a5c66);
  const redWin = glowMat(0xff2a1a, 0.9);
  const glows = [];
  const fires = [];
  // tiers
  add(root, geo.box(5.7, 0.3, 5.7), ds, [0, 0.15, 0]);
  add(root, geo.box(5.2, 0.3, 5.2), ds2, [0, 0.45, 0]);
  const b = 0.6;
  // perimeter spikes on the lower tier
  const sp = [];
  for (let i = 0; i < 9; i++) {
    const t = -2.6 + i * 0.65;
    sp.push([0.06, 0.4, t, 0.3, 2.78, 0.5, 0], [0.06, 0.4, t, 0.3, -2.78, -0.5, 0]);
    sp.push([0.06, 0.4, 2.78, 0.3, t, 0, -0.5], [0.06, 0.4, -2.78, 0.3, t, 0, 0.5]);
  }
  add(root, spikesGeo('kkPerimeter', sp), spikeM);
  // main keep block
  const kz = -0.35;
  add(root, geo.box(3.4, 3.1, 3.0), ds2, [0, b + 1.55, kz]);
  add(root, geo.box(3.6, 0.2, 3.2), ds, [0, b + 0.1, kz]);
  add(root, geo.box(3.6, 0.18, 3.2), ds, [0, b + 3.1, kz]);
  add(root, geo.box(3.62, 0.1, 3.22), crimsonD, [0, b + 2.95, kz]);
  add(root, crenRectGeo(3.6, 3.2, 7, 0.24, 0.3), ds2, [0, b + 3.19, kz]);
  // gate with portcullis and green glow
  add(root, geo.box(1.2, 1.5, 0.3), mat(0x0c0a0e), [0, b + 0.75, kz + 1.42]);
  glows.push(add(root, geo.box(1.0, 1.2, 0.05), glowMat(0x3a9a1a, 0.6), [0, b + 0.62, kz + 1.4]));
  add(root, mergedBoxes('portcullis', [
    ...[0, 1, 2, 3, 4].map((i) => [0.05, 1.4, 0.05, -0.44 + i * 0.22, 0.7, 0]),
    [1.05, 0.05, 0.05, 0, 0.5, 0], [1.05, 0.05, 0.05, 0, 1.0, 0],
  ]), iron, [0, b, kz + 1.56]);
  add(root, geo.box(1.6, 0.35, 0.35), ds, [0, b + 1.65, kz + 1.55]);
  add(root, geo.box(0.5, 0.35, 0.1), mat(P.bone), [0, b + 1.65, kz + 1.74]); // skull lintel
  for (const s of [1, -1]) add(root, geo.box(0.12, 0.12, 0.05), mat(P.black), [s * 0.12, b + 1.7, kz + 1.8]);
  // banners on the keep front
  for (const s of [1, -1]) {
    banner(root, s * 1.1, b + 2.85, kz + 1.52, P.crimson, { w: 0.62, h: 1.7, trim: P.darkIron2, emblem: P.black });
    glows.push(add(root, geo.box(0.16, 0.4, 0.05), redWin, [s * 0.55, b + 2.3, kz + 1.51]));
  }
  // gate braziers (green fire)
  for (const s of [1, -1]) {
    const x = s * 0.95, z = kz + 1.95;
    add(root, geo.box(0.32, 0.9, 0.32), ds, [x, b + 0.45, z]);
    add(root, geo.cyl(0.24, 0.12, 0.2, 6), iron, [x, b + 1.0, z]);
    fires.push(fire(root, x, b + 1.08, z, 0.5, 'green'));
  }
  // corner towers with spiked roofs and red braziers
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const x = sx * 2.18, z = sz * 2.18;
      add(root, geo.cyl(0.55, 0.68, 4.3, 8), ds2, [x, b + 2.15, z]);
      add(root, geo.cyl(0.72, 0.72, 0.2, 8), ds, [x, b + 0.1, z]);
      add(root, geo.cyl(0.7, 0.62, 0.22, 8), ds, [x, b + 4.3, z]);
      add(root, geo.cyl(0.71, 0.71, 0.08, 8), crimsonD, [x, b + 3.9, z]);
      add(root, crenRingGeo(0.6, 8, 0.2, 0.28, 0.16), ds2, [x, b + 4.4, z]);
      add(root, geo.cone(0.45, 1.6, 8), iron, [x, b + 4.4 + 0.8, z]);
      glows.push(add(root, geo.box(0.12, 0.38, 0.05), redWin, [x, b + 2.7, z + 0.6 * Math.sign(z) * 1.0 + 0.0], [0, sz > 0 ? 0 : Math.PI, 0]));
      if (sz > 0) fires.push(fire(root, x - sx * 0.48, b + 4.45, z + 0.3, 0.42, 'red'));
    }
  }
  // central spire
  add(root, geo.box(1.7, 2.7, 1.7), ds, [0, b + 3.1 + 1.35, kz]);
  add(root, geo.box(1.85, 0.16, 1.85), crimsonD, [0, b + 5.8, kz]);
  add(root, CG.pyramid(), iron, [0, b + 5.88, kz], null, [1.8, 1.25, 1.8]);
  add(root, geo.cone(0.08, 0.5, 4), spikeM, [0, b + 7.1 + 0.25 - 0.1, kz]);
  add(root, spikesGeo('kkSpireCorners', [
    [0.09, 0.7, 0.88, 0, 0.88, -0.35, 0.35], [0.09, 0.7, -0.88, 0, 0.88, -0.35, -0.35],
    [0.09, 0.7, 0.88, 0, -0.88, 0.35, 0.35], [0.09, 0.7, -0.88, 0, -0.88, 0.35, -0.35],
  ]), spikeM, [0, b + 5.85, kz]);
  glows.push(add(root, geo.box(0.3, 0.7, 0.05), redWin, [0, b + 4.7, kz + 0.86]));
  banner(root, 0, b + 4.15, kz + 0.88, P.crimson, { w: 0.5, h: 0.6, trim: P.darkIron2, emblem: P.black });
  for (const m of glows) m.castShadow = false;
  return { root, parts: { fire: fires, glow: glows }, height: 8.0, radius: 2.95 };
}

// ---------------------------------------------------------------------------
export function dark_tower() {
  const root = new THREE.Group();
  const ds = mat(P.darkStone), ds2 = mat(P.darkStone2), iron = mat(P.darkIron), crimsonD = mat(P.crimsonDark);
  const spikeM = mat(0x5a5c66);
  const glows = [];
  add(root, geo.cyl(0.9, 0.95, 0.25, 8), ds, [0, 0.125, 0]);
  // tapered square shaft: width(y) = 1.25 * (1 - 0.1086 * (y - 0.25))
  const wAt = (y) => 1.25 * (1 - 0.1086 * (y - 0.25));
  add(root, CG.frustum(0.62), ds2, [0, 0.25 + 1.75, 0], null, [1.25, 3.5, 1.25]);
  for (const y of [1.25, 2.85]) add(root, geo.box(wAt(y) + 0.06, 0.12, wAt(y) + 0.06), crimsonD, [0, y, 0]);
  add(root, spikesGeo('dtBase', [0, 1, 2, 3].map((i) => {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    return [0.13, 1.3, Math.sin(a) * 0.72, 0.15, Math.cos(a) * 0.72, Math.cos(a) * 0.5, -Math.sin(a) * 0.5];
  })), spikeM);
  // top platform with corner spikes
  add(root, geo.box(1.0, 0.16, 1.0), ds, [0, 3.83, 0]);
  add(root, spikesGeo('dtTop', [0, 1, 2, 3].map((i) => {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    return [0.07, 0.55, Math.sin(a) * 0.62, 0, Math.cos(a) * 0.62, Math.cos(a) * 0.3, -Math.sin(a) * 0.3];
  })), spikeM, [0, 3.9, 0]);
  add(root, geo.cyl(0.18, 0.28, 0.25, 6), iron, [0, 4.0, 0]);
  // windows
  for (const a of [0, Math.PI / 2, -Math.PI / 2]) {
    glows.push(add(root, geo.box(0.1, 0.36, 0.05), glowMat(0x7dff3a, 0.8), [Math.sin(a) * wAt(2.2) / 2, 2.2, Math.cos(a) * wAt(2.2) / 2], [0, a, 0]));
  }
  add(root, geo.box(0.36, 0.55, 0.06), mat(0x0c0a0e), [0, 0.52, wAt(0.5) / 2]);
  // floating crystal (bob anchor at the origin, spin group at the crystal)
  const hover = grp(root, 0, 0, 0);
  const spin = grp(hover, 0, 4.45, 0);
  const c1 = add(spin, geo.octa(0.3), glowMat(0xff1a2a, 1), [0, 0, 0], null, [0.8, 1.7, 0.8]);
  const c2 = add(spin, geo.octa(0.11), glowMat(0x7dff3a, 1), [0.38, -0.08, 0], null, [0.8, 1.5, 0.8]);
  const c3 = add(spin, geo.octa(0.09), glowMat(0x7dff3a, 1), [-0.34, 0.06, 0.12], null, [0.8, 1.5, 0.8]);
  glows.push(c1, c2, c3);
  for (const m of glows) m.castShadow = false;
  return { root, parts: { spin: [spin], bob: [hover], glow: glows }, height: 5.0, radius: 0.95 };
}

// ---------------------------------------------------------------------------
export function wall_segment() {
  const root = new THREE.Group();
  const ds = mat(P.darkStone), ds2 = mat(P.darkStone2);
  add(root, geo.box(2.0, 0.26, 0.98), ds, [0, 0.13, 0]);
  add(root, geo.box(2.0, 1.95, 0.8), ds2, [0, 0.26 + 0.975, 0]);
  add(root, geo.box(2.0, 0.08, 0.86), mat(P.crimsonDark), [0, 1.9, 0]);
  add(root, geo.box(2.0, 0.14, 0.92), ds, [0, 2.27, 0]);
  const m = [];
  for (let i = 0; i < 4; i++) {
    const x = -0.75 + i * 0.5;
    m.push([0.3, 0.28, 0.2, x, 0.14, 0.36], [0.3, 0.28, 0.2, x, 0.14, -0.36]);
  }
  add(root, mergedBoxes('wallMerlons', m), ds2, [0, 2.34, 0]);
  // irregular stone blocks for texture (tile-safe: kept inside the segment)
  add(root, mergedBoxes('wallBlocks', [
    [0.42, 0.22, 0.84, -0.62, 0.62, 0], [0.36, 0.2, 0.84, 0.48, 0.95, 0], [0.5, 0.22, 0.84, -0.1, 1.35, 0],
    [0.3, 0.2, 0.84, 0.75, 1.6, 0], [0.34, 0.2, 0.84, -0.7, 1.55, 0], [0.4, 0.2, 0.84, 0.15, 0.5, 0],
  ]), ds);
  return { root, parts: {}, height: 2.6, radius: 1.0 };
}

export function wall_tower() {
  const root = new THREE.Group();
  const ds = mat(P.darkStone), ds2 = mat(P.darkStone2);
  add(root, geo.cyl(0.95, 0.97, 0.28, 12), ds, [0, 0.14, 0]);
  add(root, geo.cyl(0.84, 0.9, 2.75, 12), ds2, [0, 0.28 + 1.375, 0]);
  add(root, geo.cyl(0.87, 0.87, 0.08, 12), mat(P.crimsonDark), [0, 2.55, 0]);
  add(root, geo.cyl(0.95, 0.88, 0.18, 12), ds, [0, 3.1, 0]);
  add(root, crenRingGeo(0.84, 10, 0.3, 0.32, 0.2), ds2, [0, 3.19, 0]);
  add(root, geo.cone(0.12, 0.45, 4), mat(0x5a5c66), [0, 3.4, 0]);
  const glows = [];
  for (const a of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    glows.push(add(root, geo.box(0.08, 0.32, 0.05), glowMat(0xff2a1a, 0.7), [Math.sin(a) * 0.87, 1.9, Math.cos(a) * 0.87], [0, a, 0]));
  }
  banner(root, 0, 2.45, 0.9, P.crimson, { w: 0.38, h: 0.85, trim: P.darkIron2, emblem: P.black });
  for (const m of glows) m.castShadow = false;
  return { root, parts: { glow: glows }, height: 3.6, radius: 0.97 };
}

// ---------------------------------------------------------------------------
// Doodads
// ---------------------------------------------------------------------------
export function rock() {
  const root = new THREE.Group();
  add(root, geo.dodeca(0.32), mat(0x8e8b84), [0, 0.2, 0], [0.3, 0.5, 0.1], [1.15, 0.75, 1]);
  add(root, geo.dodeca(0.2), mat(0x7a7770), [0.28, 0.12, 0.1], [0.6, 0.2, 0.3]);
  add(root, geo.dodeca(0.13), mat(0xa29f97), [-0.25, 0.08, 0.18], [0.1, 0.9, 0]);
  return { root, parts: {}, height: 0.45, radius: 0.42 };
}

export function bush() {
  const root = new THREE.Group();
  const l1 = mat(P.leaf), l2 = mat(P.leafLight), l3 = mat(0x2f7024);
  add(root, geo.ico(0.3, 0), l1, [0, 0.3, 0], [0.2, 0.4, 0]);
  add(root, geo.ico(0.24, 0), l2, [0.22, 0.24, 0.12], [0.5, 0.1, 0]);
  add(root, geo.ico(0.22, 0), l3, [-0.22, 0.22, 0.08], [0.1, 0.7, 0.3]);
  add(root, geo.ico(0.2, 0), l2, [0.02, 0.2, -0.24]);
  for (const [x, y, z] of [[0.15, 0.42, 0.2], [-0.12, 0.38, 0.25], [0.3, 0.3, -0.05]]) add(root, geo.sphere(0.04, 4, 3), mat(0xd8283a), [x, y, z]);
  return { root, parts: {}, height: 0.6, radius: 0.45 };
}

export function flowers() {
  const root = new THREE.Group();
  add(root, mergedBoxes('flowerStems', [
    [0.015, 0.2, 0.015, 0, 0.1, 0], [0.015, 0.16, 0.015, 0.14, 0.08, 0.08], [0.015, 0.18, 0.015, -0.12, 0.09, 0.1],
    [0.015, 0.14, 0.015, 0.08, 0.07, -0.14], [0.015, 0.17, 0.015, -0.16, 0.085, -0.08],
    [0.08, 0.02, 0.03, 0.03, 0.04, 0.02, 0.6], [0.08, 0.02, 0.03, -0.1, 0.04, -0.05, -0.4],
  ]), mat(0x4a9a2a));
  add(root, geo.cone(0.06, 0.12, 4), mat(0x5aaa32), [0.05, 0.06, 0.05]);
  add(root, geo.cone(0.05, 0.1, 4), mat(0x5aaa32), [-0.08, 0.05, -0.1]);
  for (const [x, y, z, c] of [[0, 0.21, 0, 0xffd83a], [0.14, 0.17, 0.08, 0xffffff], [-0.12, 0.19, 0.1, 0xe83a5a], [0.08, 0.15, -0.14, 0xa05ae8], [-0.16, 0.18, -0.08, 0xffd83a]]) {
    add(root, geo.octa(0.04), mat(c), [x, y, z], null, [1, 0.6, 1]);
  }
  return { root, parts: {}, height: 0.25, radius: 0.25 };
}

export function crate() {
  const root = new THREE.Group();
  add(root, geo.box(0.46, 0.46, 0.46), mat(P.woodLight), [0, 0.23, 0]);
  const e = 0.05, s = 0.48;
  add(root, mergedBoxes('crateEdges', [
    [s, e, e, 0, s / 2 - e / 2, s / 2 - e / 2], [s, e, e, 0, -s / 2 + e / 2, s / 2 - e / 2],
    [s, e, e, 0, s / 2 - e / 2, -s / 2 + e / 2], [s, e, e, 0, -s / 2 + e / 2, -s / 2 + e / 2],
    [e, s, e, s / 2 - e / 2, 0, s / 2 - e / 2], [e, s, e, -s / 2 + e / 2, 0, s / 2 - e / 2],
    [e, s, e, s / 2 - e / 2, 0, -s / 2 + e / 2], [e, s, e, -s / 2 + e / 2, 0, -s / 2 + e / 2],
    [e, e, s, s / 2 - e / 2, s / 2 - e / 2, 0], [e, e, s, -s / 2 + e / 2, s / 2 - e / 2, 0],
    [e, e, s, s / 2 - e / 2, -s / 2 + e / 2, 0], [e, e, s, -s / 2 + e / 2, -s / 2 + e / 2, 0],
  ]), mat(P.wood), [0, 0.24, 0]);
  add(root, geo.box(0.06, 0.6, 0.02), mat(P.wood), [0, 0.23, 0.235], [0, 0, 0.78]);
  return { root, parts: {}, height: 0.48, radius: 0.33 };
}

export function barrel() {
  const root = new THREE.Group();
  const w = mat(0x9a6434);
  add(root, geo.cyl(0.2, 0.24, 0.28, 10), w, [0, 0.42, 0]);
  add(root, geo.cyl(0.24, 0.2, 0.28, 10), w, [0, 0.14, 0]);
  const band = mat(P.iron);
  add(root, geo.cyl(0.225, 0.225, 0.04, 10), band, [0, 0.08, 0]);
  add(root, geo.cyl(0.225, 0.225, 0.04, 10), band, [0, 0.48, 0]);
  add(root, geo.cyl(0.18, 0.18, 0.02, 10), mat(P.woodDark), [0, 0.565, 0]);
  return { root, parts: {}, height: 0.58, radius: 0.25 };
}

export function campfire() {
  const root = new THREE.Group();
  const stones = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    stones.push([0.12, 0.09, 0.1, Math.sin(a) * 0.24, 0.045, Math.cos(a) * 0.24, a]);
  }
  add(root, mergedBoxes('fireRing7', stones), mat(P.stoneDark));
  add(root, geo.box(0.38, 0.06, 0.07), mat(P.woodDark), [0, 0.05, 0], [0, 0.6, 0]);
  add(root, geo.box(0.38, 0.06, 0.07), mat(P.woodDark), [0, 0.08, 0], [0, -0.6, 0]);
  const coals = add(root, geo.box(0.16, 0.03, 0.16), glowMat(0xff5a10, 0.8), [0, 0.04, 0]);
  coals.castShadow = false;
  const fl = fire(root, 0, 0.06, 0, 0.42);
  return { root, parts: { fire: [fl], glow: [coals] }, height: 0.5, radius: 0.32 };
}

export function ruins_pillar() {
  const root = new THREE.Group();
  const m = mat(0xc8c2b2), md = mat(0xa29c8c), moss = mat(0x5f8a3a);
  add(root, geo.box(0.62, 0.2, 0.62), md, [0, 0.1, 0]);
  add(root, geo.box(0.5, 0.12, 0.5), m, [0, 0.26, 0]);
  add(root, geo.cyl(0.2, 0.22, 1.3, 8), m, [0, 0.32 + 0.65, 0]);
  add(root, geo.cyl(0.2, 0.2, 0.3, 8), m, [0.02, 1.74, 0.01], [0.12, 0, -0.1]);
  add(root, geo.dodeca(0.15), m, [-0.05, 1.86, 0.02], [0.5, 0.3, 0.2], [1.1, 1.0, 1.0]);
  add(root, geo.tetra(0.14), md, [0.08, 1.92, -0.04], [0.3, 0.8, 0.1]);
  add(root, geo.cyl(0.21, 0.21, 0.36, 8), md, [0.45, 0.18, 0.3], [HALF_PI, 0.7, 0]);
  add(root, geo.dodeca(0.1), md, [-0.38, 0.06, 0.32]);
  add(root, geo.box(0.3, 0.05, 0.3), moss, [0.0, 0.33, 0.1], [0.05, 0.4, 0]);
  return { root, parts: {}, height: 2.0, radius: 0.45 };
}

export function banner_pole(tc) {
  const root = new THREE.Group();
  add(root, geo.cyl(0.18, 0.22, 0.14, 8), mat(P.stoneDark), [0, 0.07, 0]);
  flag(root, 0, 0.1, 0, tc, { pole: 2.3, w: 0.7, h: 0.48, dir: 1, poleR: 0.035 });
  return { root, parts: {}, height: 2.5, radius: 0.3 };
}

export function stump() {
  const root = new THREE.Group();
  add(root, geo.cyl(0.24, 0.28, 0.3, 8), mat(0x6a4426), [0, 0.15, 0]);
  add(root, geo.cyl(0.22, 0.22, 0.02, 8), mat(0xd0a870), [0, 0.305, 0]);
  add(root, mergedBoxes('stumpRoots', [
    [0.1, 0.08, 0.26, 0, 0.04, 0.3, 0], [0.1, 0.08, 0.26, 0, 0.04, -0.3, 0],
    [0.26, 0.08, 0.1, 0.3, 0.04, 0, 0], [0.24, 0.07, 0.1, -0.28, 0.035, 0.08, 0.4],
  ]), mat(0x5a3a1e));
  return { root, parts: {}, height: 0.32, radius: 0.4 };
}

export function mushrooms() {
  const root = new THREE.Group();
  const stem = mat(0xf0e8d6), cap = mat(0xd8302a), spot = mat(0xffffff);
  for (const [x, z, s] of [[0, 0, 1], [0.16, 0.1, 0.65], [-0.12, 0.12, 0.5]]) {
    add(root, geo.cyl(0.04 * s, 0.05 * s, 0.22 * s, 6), stem, [x, 0.11 * s, z]);
    add(root, geo.sphere(0.13 * s, 8, 4), cap, [x, 0.22 * s, z], null, [1, 0.55, 1]);
    add(root, geo.sphere(0.025 * s, 4, 3), spot, [x + 0.05 * s, 0.28 * s, z + 0.03 * s]);
  }
  return { root, parts: {}, height: 0.3, radius: 0.25 };
}
