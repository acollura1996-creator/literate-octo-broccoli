// Neutral buildings, Kalenden's fortifications and doodads.
import {
  THREE, mat, geo, P, CG, glowMat, grp, add, rod, fire, flag, banner,
  mergedBoxes, crenRingGeo, crenRectGeo,
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
  const root = new THREE.Group();
  const stone = mat(P.stoneLight), stoneD = mat(P.stone);
  const water = mat(0x4ac8ff, { emissive: 0x2a9ad8, emissiveIntensity: 0.55, transparent: true, opacity: 0.85 });
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
  const jetM = mat(0x9ae6ff, { emissive: 0x4ab8f0, emissiveIntensity: 0.7, transparent: true, opacity: 0.75 });
  const j1 = add(jet, geo.cone(0.09, 0.32, 6), jetM, [0, 1.72, 0]);
  const j2 = add(jet, geo.sphere(0.09, 6, 4), jetM, [0, 1.8, 0]);
  const fall = add(root, geo.cyl(0.45, 0.18, 0.35, 10), mat(0x9ae6ff, { transparent: true, opacity: 0.35 }), [0, 1.0, 0]);
  // healing glow crystals around the rim
  const glows = [pool, bowlWater, j1, j2];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    glows.push(add(root, geo.octa(0.08), glowMat(0x8affd0, 0.8), [Math.sin(a) * 1.18, 0.66, Math.cos(a) * 1.18], null, [0.8, 1.4, 0.8]));
  }
  for (const m of glows) m.castShadow = false;
  fall.castShadow = false;
  return { root, parts: { glow: glows, bob: [jet] }, height: 1.8, radius: 1.42 };
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
