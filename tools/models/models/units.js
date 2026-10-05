// Human "Empire" units and heroes.
import {
  THREE, mat, geo, P, CG, glowMat, grp, add, rig, scaled, legMesh, armMesh, grip, sword, MELEE_TILT, STAFF_TILT,
  kiteShield, bowMesh, quiver, flag,
} from './common.js';

const HALF_PI = Math.PI / 2;

/** Hooded head: skin face + hood shell + pointy hood tail. */
function hoodedHead(head, { r, skin = P.skin, hood, y = 0.1, tail = true }) {
  add(head, geo.sphere(r, 8, 6), mat(skin), [0, y, 0.015]);
  add(head, geo.sphere(r * 1.13, 8, 6), mat(hood), [0, y + r * 0.14, -r * 0.24], null, [1, 1, 1.02]);
  if (tail) add(head, geo.cone(r * 0.55, r * 1.3, 5), mat(hood), [0, y + r * 0.35, -r * 1.25], [-2.0, 0, 0]);
  add(head, geo.box(r * 0.22, r * 0.3, r * 0.3), mat(P.skinShade), [0, y - r * 0.05, r * 0.98]);
}

/** Robe skirt + hem trim for casters (body-relative). */
function robe(body, { hipY, color, trim, w = 0.42, d = 0.36, topW = 0.55, hemTrim = true, top = 0.16 }) {
  const h = hipY + top;
  add(body, CG.frustum(topW), mat(color), [0, top - h / 2, 0], null, [w, h, d]);
  if (hemTrim) add(body, CG.frustum(0.97), mat(trim), [0, -hipY + 0.03, 0], null, [w * 1.02, 0.06, d * 1.02]);
}

/** Little shoes for robed characters: legs exist only as feet under the robe. */
function shoes(r, len, color, w = 0.08) {
  for (const l of r.legs) {
    add(l.obj, geo.box(w, 0.08, w * 1.7), mat(color), [0, -len + 0.04, w * 0.35]);
    l.amp = 0.45;
  }
}

function result(r, height, radius, extra = {}) {
  return {
    root: r.root,
    parts: { body: r.body, head: r.head, legs: r.legs, arms: r.armL ? [{ obj: r.armL, phase: Math.PI }] : [], weapon: r.weapon, ...extra },
    height,
    radius,
  };
}

// ---------------------------------------------------------------------------
export function peasant(tc) {
  const L = 0.28;
  const r = rig({ legLen: L, hipW: 0.065, shoulderX: 0.165, shoulderY: 0.27, neckY: 0.34 });
  for (const l of r.legs) legMesh(l.obj, L, 0.085, mat(P.cloth), mat(P.leatherDark));
  const shirt = mat(tc);
  add(r.body, CG.frustum(1.15), shirt, [0, 0.16, 0], null, [0.25, 0.3, 0.19]);
  add(r.body, geo.box(0.27, 0.05, 0.21), mat(P.leather), [0, 0.04, 0]);
  add(r.body, geo.box(0.07, 0.08, 0.04), mat(P.leatherDark), [0.08, 0.0, 0.1]); // pouch
  add(r.body, geo.box(0.2, 0.12, 0.2), mat(P.cloth), [0, -0.02, 0]); // apron skirt
  // head with brown hood
  hoodedHead(r.head, { r: 0.1, hood: 0x8a6436, y: 0.1 });
  add(r.head, CG.frustum(0.6), mat(0x8a6436), [0, -0.01, -0.005], null, [0.24, 0.07, 0.2]); // cowl
  // arms: team sleeves, bare forearms
  armMesh(r.armL, { upper: 0.13, fore: 0.12, w: 0.072, upperMat: shirt, foreMat: mat(P.skin), handMat: mat(P.skin), bend: 0.45 });
  const hand = armMesh(r.weapon, { upper: 0.13, fore: 0.12, w: 0.072, upperMat: shirt, foreMat: mat(P.skin), handMat: mat(P.skin), bend: 0.7 });
  // pick
  const gp = grip(hand, MELEE_TILT);
  add(gp, geo.cyl(0.016, 0.018, 0.44, 5), mat(P.woodLight), [0, 0.12, 0]);
  const iron = mat(P.steelDark);
  add(gp, geo.box(0.036, 0.04, 0.17), iron, [0, 0.33, 0.07], [-0.3, 0, 0]);
  add(gp, geo.box(0.036, 0.04, 0.17), iron, [0, 0.33, -0.07], [0.3, 0, 0]);
  return result(r, 0.9, 0.3);
}

// ---------------------------------------------------------------------------
export function footman(tc) {
  const L = 0.36;
  const r = rig({ legLen: L, hipW: 0.085, shoulderX: 0.25, shoulderY: 0.34, neckY: 0.42 });
  const steel = mat(P.steel), steelD = mat(P.steelDark), team = mat(tc), gold = mat(P.gold);
  for (const l of r.legs) legMesh(l.obj, L, 0.11, mat(P.mail), steelD);
  add(r.body, CG.frustum(1.4), steel, [0, 0.22, 0], null, [0.3, 0.3, 0.22]);
  add(r.body, geo.box(0.33, 0.06, 0.24), mat(P.leather), [0, 0.06, 0]);
  add(r.body, geo.box(0.22, 0.44, 0.03), team, [0, 0.1, 0.125]);
  add(r.body, geo.box(0.22, 0.36, 0.03), team, [0, 0.13, -0.125]);
  add(r.body, geo.box(0.07, 0.06, 0.02), gold, [0, 0.06, 0.145]);
  for (const s of [1, -1]) {
    add(r.body, geo.sphere(0.115, 7, 5), steel, [s * 0.235, 0.35, 0], null, [1.1, 0.8, 1.15]);
    add(r.body, geo.box(0.05, 0.03, 0.2), gold, [s * 0.3, 0.33, 0], [0, 0, s * -0.6]);
  }
  // helmet: full helm, visor slit, team brush crest
  add(r.head, geo.sphere(0.14, 8, 6), steel, [0, 0.09, 0], null, [1, 1.08, 1.05]);
  add(r.head, geo.cyl(0.145, 0.15, 0.06, 8), steelD, [0, 0.03, 0]);
  add(r.head, geo.box(0.17, 0.025, 0.04), mat(P.black), [0, 0.09, 0.135]);
  add(r.head, geo.box(0.022, 0.1, 0.03), gold, [0, 0.05, 0.145]);
  add(r.head, geo.box(0.04, 0.09, 0.24), team, [0, 0.25, -0.02]);
  // arms
  const handL = armMesh(r.armL, { upper: 0.16, fore: 0.15, w: 0.085, upperMat: mat(P.mail), foreMat: steel, handMat: steelD, bend: 0.5 });
  kiteShield(handL, tc, { w: 0.3, h: 0.44, x: 0.07, y: 0.04, z: 0.02, ry: 0.55 });
  const hand = armMesh(r.weapon, { upper: 0.16, fore: 0.15, w: 0.085, upperMat: mat(P.mail), foreMat: steel, handMat: steelD, bend: 0.6 });
  sword(grip(hand, MELEE_TILT), { len: 0.46, w: 0.06 });
  return result(r, 1.1, 0.32);
}

// ---------------------------------------------------------------------------
export function archer(tc) {
  const L = 0.36;
  const r = rig({ legLen: L, hipW: 0.075, shoulderX: 0.2, shoulderY: 0.33, neckY: 0.41 });
  const green = mat(0x4f7d36), leather = mat(P.leather), team = mat(tc);
  for (const l of r.legs) legMesh(l.obj, L, 0.09, mat(0x6b5a38), mat(P.leatherDark));
  add(r.body, CG.frustum(1.25), green, [0, 0.2, 0], null, [0.25, 0.3, 0.19]);
  add(r.body, geo.box(0.27, 0.05, 0.21), leather, [0, 0.06, 0]);
  add(r.body, geo.box(0.24, 0.16, 0.2), mat(0x3f6a2a), [0, -0.03, 0]); // tunic skirt
  // team cloak + hood
  const cloak = add(r.body, CG.frustum(0.62), team, [0, 0.08, -0.12], [0.1, 0, 0], [0.36, 0.62, 0.04]);
  cloak.castShadow = true;
  add(r.body, CG.frustum(0.7), team, [0, 0.39, -0.01], null, [0.34, 0.08, 0.25]); // mantle
  hoodedHead(r.head, { r: 0.105, hood: tc, y: 0.1 });
  quiver(r.body, { x: 0.06, y: 0.24, z: -0.16, rz: 0.45, len: 0.34 });
  armMesh(r.armL, { upper: 0.15, fore: 0.14, w: 0.075, upperMat: green, foreMat: leather, handMat: mat(P.skin), bend: 0.45 });
  const hand = armMesh(r.weapon, { upper: 0.15, fore: 0.14, w: 0.075, upperMat: green, foreMat: leather, handMat: mat(P.skin), bend: 0.55 });
  bowMesh(grip(hand, 0.75), 0.84, { wood: 0x7a4a22 });
  return result(r, 1.05, 0.3);
}

// ---------------------------------------------------------------------------
export function knight(tc) {
  const root = new THREE.Group();
  const horse = mat(0x7a4a2a), horseD = mat(0x3a2414), steel = mat(P.steel), steelD = mat(P.steelDark);
  const team = mat(tc), gold = mat(P.gold);
  const legs = [];
  const LL = 0.62;
  const legDefs = [
    [0.14, 0.34, 0], [-0.14, -0.36, 0], [-0.14, 0.34, Math.PI], [0.14, -0.36, Math.PI],
  ];
  for (const [x, z, ph] of legDefs) {
    const lg = grp(root, x, LL, z);
    add(lg, geo.box(0.11, 0.42, 0.13), horse, [0, -0.2, 0]);
    add(lg, geo.box(0.085, 0.22, 0.09), horse, [0, -0.47, 0]);
    add(lg, geo.box(0.11, 0.08, 0.13), horseD, [0, -0.58, 0.01]);
    legs.push({ obj: lg, phase: ph, amp: 0.5 });
  }
  const body = grp(root, 0, 0.8, 0);
  add(body, geo.box(0.38, 0.36, 0.95), horse, [0, 0, 0]);
  add(body, geo.box(0.46, 0.32, 0.98), team, [0, -0.06, 0]); // caparison
  add(body, geo.box(0.47, 0.05, 0.99), gold, [0, -0.2, 0]);
  add(body, geo.box(0.3, 0.06, 0.34), mat(P.leatherDark), [0, 0.2, -0.04]); // saddle
  // neck + head with steel chanfron
  add(body, geo.box(0.18, 0.46, 0.24), horse, [0, 0.26, 0.47], [0.55, 0, 0]);
  add(body, geo.box(0.2, 0.3, 0.12), steel, [0, 0.33, 0.43], [0.55, 0, 0]); // crinet
  add(body, geo.box(0.06, 0.4, 0.1), horseD, [0, 0.33, 0.33], [0.55, 0, 0]); // mane
  add(body, geo.box(0.16, 0.18, 0.42), horse, [0, 0.45, 0.72], [0.55, 0, 0]);
  add(body, geo.box(0.17, 0.08, 0.32), steel, [0, 0.52, 0.74], [0.55, 0, 0]);
  add(body, geo.box(0.14, 0.1, 0.04), horseD, [0, 0.6, 0.56], [0.2, 0, 0]); // ears
  add(body, geo.box(0.08, 0.36, 0.08), horseD, [0, -0.08, -0.55], [-0.45, 0, 0]); // tail
  // rider (static legs)
  for (const s of [1, -1]) {
    add(body, geo.box(0.1, 0.12, 0.3), mat(P.mail), [s * 0.2, 0.22, 0.04], [0.2, 0, 0]);
    add(body, geo.box(0.1, 0.3, 0.12), steelD, [s * 0.25, 0.08, 0.15]);
  }
  const rider = grp(body, 0, 0.24, -0.04);
  add(rider, CG.frustum(1.35), steel, [0, 0.17, 0], null, [0.29, 0.3, 0.21]);
  add(rider, geo.box(0.21, 0.32, 0.03), team, [0, 0.13, 0.115]);
  for (const s of [1, -1]) add(rider, geo.sphere(0.11, 7, 5), steel, [s * 0.22, 0.3, 0], null, [1.1, 0.8, 1.1]);
  const head = grp(rider, 0, 0.38, 0);
  add(head, geo.cyl(0.115, 0.12, 0.22, 8), steel, [0, 0.1, 0]);
  add(head, geo.cyl(0.118, 0.115, 0.05, 8), gold, [0, 0.22, 0]);
  add(head, geo.box(0.16, 0.025, 0.04), mat(P.black), [0, 0.12, 0.11]);
  add(head, geo.cone(0.06, 0.2, 5), team, [0, 0.33, -0.03], [-0.4, 0, 0]); // plume
  const armL = grp(rider, 0.22, 0.29, 0);
  const handL = armMesh(armL, { upper: 0.15, fore: 0.14, w: 0.08, upperMat: mat(P.mail), foreMat: steel, handMat: steelD, bend: 0.7 });
  kiteShield(handL, tc, { w: 0.28, h: 0.4, x: 0.07, y: 0.02, z: 0.0, ry: 0.9 });
  const weapon = grp(rider, -0.22, 0.29, 0);
  const hand = armMesh(weapon, { upper: 0.15, fore: 0.14, w: 0.08, upperMat: mat(P.mail), foreMat: steel, handMat: steelD, bend: 0.8 });
  sword(grip(hand, 1.0), { len: 0.56, w: 0.062 });
  return {
    root,
    parts: { body, head, legs, arms: [{ obj: armL, phase: Math.PI }], weapon },
    height: 1.8,
    radius: 0.55,
  };
}

// ---------------------------------------------------------------------------
export function priest(tc) {
  const L = 0.34;
  const r = rig({ legLen: L, hipW: 0.07, shoulderX: 0.19, shoulderY: 0.37, neckY: 0.44 });
  shoes(r, L, P.leather);
  const white = mat(P.white), goldM = mat(P.gold), team = mat(tc);
  robe(r.body, { hipY: L, color: P.white, trim: P.gold, w: 0.4, d: 0.34, topW: 0.55 });
  add(r.body, CG.frustum(1.25), white, [0, 0.28, 0], null, [0.25, 0.3, 0.19]);
  add(r.body, geo.box(0.06, 0.44, 0.215), team, [0, 0.24, 0], [0, 0, 0.62]); // sash
  add(r.body, geo.box(0.08, 0.5, 0.02), team, [0, -0.05, 0.155], [-0.2, 0, 0]); // front stole
  add(r.body, CG.frustum(0.62), goldM, [0, 0.42, 0], null, [0.34, 0.09, 0.26]); // mantle
  hoodedHead(r.head, { r: 0.1, hood: P.white, y: 0.1, tail: false });
  add(r.head, geo.torus(0.1, 0.014, 4, 10), goldM, [0, 0.1, -0.005], [0.25, 0, 0]); // hood trim
  armMesh(r.armL, { upper: 0.15, fore: 0.13, w: 0.08, upperMat: white, foreMat: white, handMat: mat(P.skin), bend: 0.6, foreW: 0.1 });
  const hand = armMesh(r.weapon, { upper: 0.15, fore: 0.13, w: 0.08, upperMat: white, foreMat: white, handMat: mat(P.skin), bend: 0.6, foreW: 0.1 });
  const g = grip(hand, STAFF_TILT);
  add(g, geo.cyl(0.018, 0.02, 0.86, 5), mat(P.woodLight), [0, 0.12, 0]);
  add(g, geo.torus(0.07, 0.015, 4, 10), goldM, [0, 0.6, 0]);
  add(g, geo.cone(0.03, 0.08, 4), goldM, [0, 0.53, 0], [Math.PI, 0, 0]);
  const orb = add(g, geo.sphere(0.055, 8, 6), glowMat(0xfff4b0, 0.9), [0, 0.6, 0]);
  orb.castShadow = false;
  return result(r, 1.05, 0.3, { glow: [orb] });
}

// ---------------------------------------------------------------------------
export function sorceress(tc) {
  const L = 0.36;
  const r = rig({ legLen: L, hipW: 0.065, shoulderX: 0.18, shoulderY: 0.37, neckY: 0.44 });
  shoes(r, L, 0x3b2350);
  const purple = mat(0x7d47b4), lav = mat(0xc7a2ea), team = mat(tc), goldM = mat(P.gold);
  robe(r.body, { hipY: L, color: 0x7d47b4, trim: tc, w: 0.38, d: 0.34, topW: 0.5 });
  add(r.body, CG.frustum(0.9), lav, [0, -0.08, 0.06], null, [0.12, 0.5, 0.26]); // front panel
  add(r.body, CG.frustum(1.3), purple, [0, 0.27, 0], null, [0.23, 0.3, 0.17]);
  add(r.body, geo.box(0.25, 0.05, 0.19), goldM, [0, 0.13, 0]);
  add(r.body, CG.frustum(0.6), team, [0, 0.41, 0], null, [0.32, 0.08, 0.24]); // collar
  // tall pointed hood
  add(r.head, geo.sphere(0.095, 8, 6), mat(P.skin), [0, 0.1, 0.02]);
  add(r.head, geo.sphere(0.112, 8, 6), purple, [0, 0.115, -0.02]);
  add(r.head, geo.cone(0.11, 0.26, 6), purple, [0, 0.29, -0.05], [-0.38, 0, 0]);
  add(r.head, geo.torus(0.1, 0.016, 4, 10), team, [0, 0.12, 0.0], [0.3, 0, 0]);
  add(r.head, geo.box(0.16, 0.18, 0.06), mat(0x2a1a14), [0, 0.03, -0.09]); // hair
  armMesh(r.armL, { upper: 0.14, fore: 0.13, w: 0.07, upperMat: purple, foreMat: lav, handMat: mat(P.skin), bend: 0.6, foreW: 0.095 });
  const hand = armMesh(r.weapon, { upper: 0.14, fore: 0.13, w: 0.07, upperMat: purple, foreMat: lav, handMat: mat(P.skin), bend: 0.6, foreW: 0.095 });
  const g = grip(hand, STAFF_TILT);
  add(g, geo.cyl(0.017, 0.02, 0.86, 5), mat(P.woodDark), [0, 0.12, 0]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    add(g, geo.cone(0.018, 0.12, 4), goldM, [Math.sin(a) * 0.04, 0.6, Math.cos(a) * 0.04], [Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4]);
  }
  const orb = add(g, geo.ico(0.06, 1), glowMat(0xd77bff, 0.9), [0, 0.64, 0]);
  orb.castShadow = false;
  return result(r, 1.2, 0.3, { glow: [orb] });
}

// ---------------------------------------------------------------------------
export function catapult(tc) {
  const root = new THREE.Group();
  const wood = mat(P.wood), woodD = mat(P.woodDark), iron = mat(P.iron), team = mat(tc);
  // chassis
  for (const s of [1, -1]) add(root, geo.box(0.1, 0.1, 1.3), wood, [s * 0.28, 0.32, 0]);
  for (const z of [0.55, 0.1, -0.55]) add(root, geo.box(0.66, 0.08, 0.09), woodD, [0, 0.33, z]);
  add(root, geo.box(0.5, 0.04, 0.5), wood, [0, 0.37, 0.32]); // deck
  // wheels (local X = axle)
  const wheels = [];
  for (const [x, z] of [[0.37, 0.42], [-0.37, 0.42], [0.37, -0.42], [-0.37, -0.42]]) {
    const w = grp(root, x, 0.235, z);
    add(w, geo.cyl(0.24, 0.24, 0.07, 10), woodD, [0, 0, 0], [0, 0, HALF_PI]);
    add(w, geo.cyl(0.07, 0.07, 0.1, 6), iron, [0, 0, 0], [0, 0, HALF_PI]);
    add(w, geo.box(0.075, 0.44, 0.05), wood, [0, 0, 0]);
    add(w, geo.box(0.075, 0.05, 0.44), wood, [0, 0, 0]);
    wheels.push(w);
  }
  // A-frame with crossbar
  for (const s of [1, -1]) {
    add(root, geo.box(0.08, 0.66, 0.08), wood, [s * 0.25, 0.68, 0.24], [-0.15, 0, 0]);
    add(root, geo.box(0.06, 0.5, 0.06), woodD, [s * 0.25, 0.58, 0.0], [0.6, 0, 0]);
  }
  add(root, geo.box(0.62, 0.09, 0.09), wood, [0, 0.98, 0.29]);
  add(root, geo.box(0.32, 0.11, 0.11), team, [0, 0.98, 0.29]); // padded crossbar
  // torsion bundle
  add(root, geo.cyl(0.08, 0.08, 0.5, 8), mat(0xc9b07a), [0, 0.42, -0.12], [0, 0, HALF_PI]);
  // throwing arm: holder flipped 180° so that +x winds back and -x throws
  const holder = grp(root, 0, 0.42, -0.12);
  holder.rotation.y = Math.PI;
  const weapon = grp(holder, 0, 0, 0);
  const elev = 0.5;
  const len = 0.72;
  add(weapon, geo.box(0.08, 0.08, len), wood, [0, Math.sin(elev) * len / 2, Math.cos(elev) * len / 2], [-elev, 0, 0]);
  const bucket = grp(weapon, 0, Math.sin(elev) * len, Math.cos(elev) * len);
  add(bucket, geo.cyl(0.13, 0.09, 0.09, 8), woodD, [0, 0.04, 0]);
  add(bucket, geo.dodeca(0.09), mat(P.stoneDark), [0, 0.11, 0]);
  // ammo stones on deck
  add(root, geo.dodeca(0.08), mat(P.stone), [0.1, 0.44, 0.38]);
  add(root, geo.dodeca(0.07), mat(P.stoneDark), [-0.08, 0.43, 0.42]);
  const fl = flag(root, 0.3, 0.37, -0.6, tc, { pole: 0.72, w: 0.32, h: 0.22, dir: 1 });
  fl.position.y = 0.37;
  return { root, parts: { wheels, weapon }, height: 1.1, radius: 0.72 };
}

// ---------------------------------------------------------------------------
// Heroes
// ---------------------------------------------------------------------------
export function paladin(tc) {
  const L = 0.48;
  const r = rig({ legLen: L, hipW: 0.11, shoulderX: 0.33, shoulderY: 0.46, neckY: 0.56 });
  const silver = mat(0xdfe5ec), steelD = mat(P.steelDark), gold = mat(P.gold), team = mat(tc);
  for (const l of r.legs) {
    legMesh(l.obj, L, 0.14, silver, steelD);
    add(l.obj, geo.sphere(0.06, 6, 4), gold, [0, -L * 0.56, 0.07]);
  }
  add(r.body, CG.frustum(1.4), silver, [0, 0.27, 0], null, [0.4, 0.42, 0.28]);
  add(r.body, geo.box(0.42, 0.08, 0.3), gold, [0, 0.07, 0]);
  add(r.body, geo.box(0.3, 0.56, 0.03), team, [0, 0.14, 0.16]);
  add(r.body, geo.box(0.11, 0.11, 0.03), gold, [0, 0.28, 0.18], [0, 0, Math.PI / 4]);
  // big pauldrons
  for (const s of [1, -1]) {
    add(r.body, geo.sphere(0.17, 8, 6), silver, [s * 0.32, 0.47, 0], null, [1.15, 0.85, 1.1]);
    add(r.body, geo.torus(0.16, 0.025, 4, 10), gold, [s * 0.34, 0.43, 0], [HALF_PI, 0, 0], [1.1, 1.05, 1]);
  }
  // cape
  add(r.body, CG.frustum(0.6), team, [0, 0.04, -0.18], [0.12, 0, 0], [0.56, 0.84, 0.045]);
  // head: face + beard + winged helm
  add(r.head, geo.sphere(0.13, 8, 6), mat(P.skin), [0, 0.1, 0.02]);
  add(r.head, geo.box(0.2, 0.1, 0.1), mat(0x8a5a2a), [0, 0.02, 0.07]); // beard
  add(r.head, geo.sphere(0.145, 8, 6), silver, [0, 0.15, -0.015], null, [1, 0.9, 1.05]);
  add(r.head, geo.box(0.035, 0.08, 0.3), gold, [0, 0.27, -0.01]);
  for (const s of [1, -1]) {
    add(r.head, geo.box(0.02, 0.12, 0.16), gold, [s * 0.15, 0.2, -0.04], [0.5, 0, s * 0.35]);
  }
  const armOpt = { upper: 0.2, fore: 0.19, w: 0.12, upperMat: silver, foreMat: silver, handMat: gold, bend: 0.55 };
  armMesh(r.armL, armOpt);
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.65 });
  const g = grip(hand, MELEE_TILT);
  add(g, geo.cyl(0.026, 0.026, 0.82, 6), mat(P.woodDark), [0, 0.2, 0]);
  add(g, geo.cyl(0.035, 0.035, 0.05, 6), gold, [0, -0.18, 0]);
  add(g, geo.box(0.17, 0.2, 0.36), silver, [0, 0.62, 0]);
  add(g, geo.box(0.18, 0.06, 0.37), gold, [0, 0.62, 0]);
  add(g, geo.cone(0.05, 0.14, 4), gold, [0, 0.78, 0]);
  scaled(r, 1.1);
  return result(r, 1.5, 0.5);
}

export function archmage(tc) {
  const L = 0.42;
  const r = rig({ legLen: L, hipW: 0.08, shoulderX: 0.24, shoulderY: 0.44, neckY: 0.5 });
  shoes(r, L, 0x3a2a1a, 0.09);
  const blue = mat(0x2f4cb8), purple = mat(0x5a3aa8), team = mat(tc), gold = mat(P.gold), beard = mat(0xf2f2ee);
  robe(r.body, { hipY: L, color: 0x2f4cb8, trim: tc, w: 0.52, d: 0.44, topW: 0.55, top: 0.2 });
  add(r.body, geo.box(0.09, 0.62, 0.02), team, [0, -0.11, 0.185], [-0.18, 0, 0]);
  add(r.body, CG.frustum(1.25), blue, [0, 0.34, 0], null, [0.32, 0.34, 0.24]);
  add(r.body, geo.box(0.34, 0.06, 0.26), gold, [0, 0.2, 0]);
  add(r.body, CG.frustum(0.6), purple, [0, 0.48, 0], null, [0.46, 0.11, 0.34]); // mantle
  add(r.body, CG.frustum(0.98), team, [0, 0.43, 0], null, [0.47, 0.03, 0.35]);
  // head, long beard, pointy hat with stars
  add(r.head, geo.sphere(0.12, 8, 6), mat(P.skin), [0, 0.1, 0.02]);
  add(r.head, geo.cone(0.12, 0.42, 6), beard, [0, -0.1, 0.11], [Math.PI - 0.25, 0, 0]);
  add(r.head, geo.box(0.18, 0.04, 0.05), beard, [0, 0.07, 0.13]);
  add(r.head, geo.cyl(0.27, 0.27, 0.03, 10), purple, [0, 0.19, 0]);
  add(r.head, geo.cyl(0.15, 0.155, 0.06, 8), team, [0, 0.22, 0]);
  const hat = grp(r.head, 0, 0.2, 0);
  add(hat, geo.cyl(0.09, 0.15, 0.22, 8), purple, [0, 0.12, -0.01], [-0.12, 0, 0]);
  add(hat, geo.cone(0.09, 0.26, 8), purple, [0, 0.34, -0.08], [-0.55, 0, 0]);
  add(hat, geo.octa(0.03), gold, [0.08, 0.1, 0.1]);
  add(hat, geo.octa(0.025), gold, [-0.06, 0.2, 0.06]);
  const armOpt = { upper: 0.17, fore: 0.16, w: 0.1, upperMat: blue, foreMat: purple, handMat: mat(P.skin), bend: 0.6, foreW: 0.13 };
  armMesh(r.armL, armOpt);
  const hand = armMesh(r.weapon, armOpt);
  const g = grip(hand, STAFF_TILT);
  add(g, geo.cyl(0.022, 0.026, 1.12, 6), mat(P.woodDark), [0, 0.18, 0]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    add(g, geo.cone(0.02, 0.16, 4), gold, [Math.sin(a) * 0.05, 0.8, Math.cos(a) * 0.05], [Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45]);
  }
  const spin = grp(g, 0, 0.9, 0);
  const crystal = add(spin, geo.octa(0.08), glowMat(0x6fe8ff, 0.9), [0, 0, 0], null, [0.8, 1.5, 0.8]);
  crystal.castShadow = false;
  return result(r, 1.55, 0.42, { spin: [spin], glow: [crystal] });
}

export function blademaster(tc) {
  const L = 0.46;
  const r = rig({ legLen: L, hipW: 0.11, shoulderX: 0.3, shoulderY: 0.44, neckY: 0.52, headZ: 0.03 });
  const skin = mat(0x5f9a3a), pants = mat(0x5a3a2a), iron = mat(0x3a3a44), gold = mat(P.gold), red = mat(0x8a1c1c), team = mat(tc);
  for (const l of r.legs) {
    add(l.obj, CG.frustum(1.3), pants, [0, -0.2, 0], null, [0.14, 0.4, 0.16]);
    add(l.obj, geo.box(0.13, 0.2, 0.2), mat(0x2a2220), [0, -L + 0.1, 0.03]);
  }
  add(r.body, CG.frustum(1.5), skin, [0, 0.27, 0], null, [0.36, 0.42, 0.26]);
  add(r.body, geo.box(0.06, 0.52, 0.28), team, [0, 0.24, 0], [0, 0, -0.6]); // sash
  add(r.body, geo.box(0.36, 0.08, 0.28), red, [0, 0.07, 0]);
  for (const [x, z, ry] of [[0, 0.12, 0], [0.15, 0.06, 0.9], [-0.15, 0.06, -0.9]]) {
    add(r.body, geo.box(0.17, 0.22, 0.03), iron, [x, -0.06, z], [0.15, ry, 0]); // tassets
  }
  // big left shoulder guard
  add(r.body, geo.box(0.24, 0.06, 0.26), iron, [0.32, 0.5, 0], [0, 0, -0.45]);
  add(r.body, geo.box(0.25, 0.02, 0.27), gold, [0.33, 0.47, 0], [0, 0, -0.45]);
  // banner pole on back (sashimono) with team flag
  const pole = grp(r.body, 0, 0.1, -0.17);
  add(pole, geo.cyl(0.018, 0.018, 1.08, 5), mat(P.woodDark), [0, 0.5, 0]);
  add(pole, geo.box(0.26, 0.03, 0.03), mat(P.woodDark), [0, 0.98, -0.01]);
  add(pole, geo.box(0.24, 0.42, 0.02), team, [0, 0.76, -0.02]);
  add(pole, geo.box(0.08, 0.08, 0.025), gold, [0, 0.8, -0.03], [0, 0, Math.PI / 4]);
  // head: orc face, kabuto with crescent and mask
  add(r.head, geo.sphere(0.13, 8, 6), skin, [0, 0.1, 0.02]);
  add(r.head, geo.box(0.17, 0.08, 0.06), iron, [0, 0.06, 0.12]); // mask
  for (const s of [1, -1]) add(r.head, geo.cone(0.016, 0.07, 4), mat(P.bone), [s * 0.05, 0.11, 0.15]);
  add(r.head, geo.sphere(0.15, 8, 5), red, [0, 0.16, -0.01], null, [1, 0.8, 1]);
  add(r.head, CG.frustum(1.6), iron, [0, 0.08, -0.06], [-0.3, 0, 0], [0.26, 0.1, 0.22]); // neck guard
  add(r.head, geo.torus(0.12, 0.018, 4, 10, Math.PI), gold, [0, 0.27, 0.06], [0, 0, 0]);
  add(r.head, geo.cone(0.04, 0.22, 5), mat(tc), [0, 0.34, -0.06], [-0.4, 0, 0]); // plume
  const armOpt = { upper: 0.2, fore: 0.18, w: 0.12, upperMat: skin, foreMat: skin, handMat: skin, bend: 0.55 };
  const hl = armMesh(r.armL, armOpt);
  add(hl, geo.box(0.14, 0.1, 0.14), iron, [0, 0.07, -0.03]);
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.65 });
  const g = grip(hand, MELEE_TILT);
  add(g, geo.cyl(0.02, 0.02, 0.2, 5), mat(P.black), [0, 0.02, 0]);
  add(g, geo.cyl(0.05, 0.05, 0.02, 8), gold, [0, 0.12, 0]);
  add(g, CG.curvedBlade(), mat(P.steelLight), [0, 0.13, 0], [0, HALF_PI - 0.7, 0], [1.1, 0.78, 1.4]);
  return result(r, 1.55, 0.42);
}

export function mountainking(tc) {
  const L = 0.27;
  const r = rig({ legLen: L, hipW: 0.13, shoulderX: 0.36, shoulderY: 0.42, neckY: 0.5, headZ: 0.03 });
  const bronze = mat(0xc8902a), steel = mat(P.steel), gold = mat(P.gold), team = mat(tc), beard = mat(0xb5541e);
  for (const l of r.legs) legMesh(l.obj, L, 0.16, mat(P.leather), mat(P.steelDark), { bootH: 0.55 });
  add(r.body, CG.frustum(0.85), team, [0, 0.0, 0], null, [0.54, 0.24, 0.42]); // kilt
  add(r.body, CG.frustum(1.15), mat(P.mail), [0, 0.25, 0], null, [0.5, 0.42, 0.4]);
  add(r.body, geo.box(0.36, 0.3, 0.05), steel, [0, 0.28, 0.19]); // breastplate
  add(r.body, geo.box(0.54, 0.09, 0.44), mat(P.leatherDark), [0, 0.07, 0]);
  add(r.body, geo.box(0.13, 0.11, 0.05), gold, [0, 0.07, 0.22]);
  for (const s of [1, -1]) {
    add(r.body, geo.sphere(0.17, 8, 6), bronze, [s * 0.33, 0.44, 0], null, [1.15, 0.85, 1.15]);
    add(r.body, geo.cone(0.05, 0.14, 5), steel, [s * 0.4, 0.55, 0], [0, 0, -s * 0.5]);
  }
  add(r.body, CG.frustum(0.75), team, [0, 0.12, -0.21], [0.08, 0, 0], [0.56, 0.56, 0.04]); // cloak
  // head, massive beard and braids, horned helm
  add(r.head, geo.sphere(0.13, 8, 6), mat(P.skin), [0, 0.1, 0.03]);
  add(r.head, geo.box(0.12, 0.05, 0.05), mat(P.skinShade), [0, 0.09, 0.15]); // nose
  add(r.head, CG.frustum(1.5), beard, [0, -0.12, 0.13], [0.12, 0, 0], [0.28, 0.4, 0.14]);
  for (const s of [1, -1]) {
    add(r.head, geo.cyl(0.03, 0.022, 0.22, 5), beard, [s * 0.07, -0.33, 0.17]);
    add(r.head, geo.sphere(0.03, 5, 4), gold, [s * 0.07, -0.43, 0.17]);
  }
  add(r.head, geo.box(0.22, 0.04, 0.05), beard, [0, 0.04, 0.15]); // moustache
  add(r.head, geo.sphere(0.15, 8, 5), steel, [0, 0.16, -0.01], null, [1, 0.85, 1]);
  add(r.head, geo.cyl(0.152, 0.155, 0.05, 8), gold, [0, 0.13, -0.01]);
  for (const s of [1, -1]) {
    add(r.head, geo.cone(0.04, 0.2, 5), mat(P.bone), [s * 0.2, 0.25, 0], [0, 0, -s * 0.9]);
    add(r.head, geo.cone(0.025, 0.12, 5), mat(P.bone), [s * 0.27, 0.36, 0], [0, 0, -s * 0.2]);
  }
  const armOpt = { upper: 0.18, fore: 0.16, w: 0.13, upperMat: bronze, foreMat: mat(P.skin), handMat: mat(P.leatherDark), bend: 0.5 };
  armMesh(r.armL, armOpt);
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.65 });
  const g = grip(hand, 1.7);
  add(g, geo.cyl(0.03, 0.03, 0.62, 6), mat(P.woodDark), [0, 0.14, 0]);
  add(g, geo.box(0.22, 0.22, 0.36), steel, [0, 0.48, 0]);
  add(g, geo.box(0.23, 0.07, 0.37), gold, [0, 0.48, 0]);
  for (const s of [1, -1]) add(g, geo.box(0.24, 0.24, 0.04), bronze, [0, 0.48, s * 0.18]);
  scaled(r, 1.08);
  return result(r, 1.3, 0.5);
}

export function ranger(tc) {
  const L = 0.56;
  const r = rig({ legLen: L, hipW: 0.075, shoulderX: 0.21, shoulderY: 0.4, neckY: 0.48 });
  const green = mat(0x3f7a3a), leather = mat(0x6b4426), team = mat(tc), gold = mat(P.gold);
  for (const l of r.legs) legMesh(l.obj, L, 0.09, green, mat(0x4a2c16), { bootH: 0.6 });
  add(r.body, CG.frustum(1.3), green, [0, 0.25, 0], null, [0.24, 0.36, 0.18]);
  add(r.body, geo.box(0.26, 0.05, 0.2), leather, [0, 0.08, 0]);
  add(r.body, geo.box(0.06, 0.05, 0.03), gold, [0, 0.08, 0.1]);
  add(r.body, CG.frustum(1.2), mat(0x356030), [0, -0.04, 0], null, [0.24, 0.16, 0.2]);
  // long team cloak + mantle
  add(r.body, CG.frustum(0.5), team, [0, -0.02, -0.13], [0.1, 0, 0], [0.5, 0.92, 0.04]);
  add(r.body, CG.frustum(0.65), team, [0, 0.42, -0.01], null, [0.36, 0.1, 0.26]);
  quiver(r.body, { x: 0.07, y: 0.28, z: -0.17, rz: 0.4, len: 0.38, color: 0x5a3418 });
  // head: hood with long hair, elf ears
  add(r.head, geo.sphere(0.105, 8, 6), mat(0xf6d6b8), [0, 0.1, 0.015]);
  for (const s of [1, -1]) add(r.head, geo.cone(0.025, 0.12, 4), mat(0xf6d6b8), [s * 0.11, 0.12, 0], [0, 0, -s * 1.2]);
  add(r.head, geo.box(0.17, 0.32, 0.08), mat(0xf0e090), [0, -0.02, -0.08]); // hair
  add(r.head, geo.sphere(0.118, 8, 6), team, [0, 0.13, -0.03], null, [1, 1, 1.02]);
  add(r.head, geo.cone(0.06, 0.18, 5), team, [0, 0.15, -0.16], [-2.1, 0, 0]);
  const armOpt = { upper: 0.17, fore: 0.16, w: 0.075, upperMat: green, foreMat: leather, handMat: mat(0xf6d6b8), bend: 0.45 };
  armMesh(r.armL, armOpt);
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.55 });
  const g = grip(hand, 0.75);
  const bowMat = glowMat(0x6dffb4, 0.85);
  const glowBow = bowMesh(g, 1.05, { woodMat: bowMat, string: 0xffffff, grip: P.gold });
  glowBow.castShadow = false;
  scaled(r, 1.13);
  return result(r, 1.5, 0.38, { glow: [glowBow] });
}

export function water_elemental() {
  const root = new THREE.Group();
  const water = mat(0x2f8fe0, { transparent: true, opacity: 0.72 });
  const light = mat(0x8fd8ff, { transparent: true, opacity: 0.75 });
  const foam = mat(0xeaf8ff);
  const float = grp(root, 0, 0, 0);
  // swirling base
  const swirl = grp(float, 0, 0, 0);
  add(swirl, geo.cone(0.34, 0.62, 7), water, [0, 0.4, 0], [Math.PI, 0, 0]);
  add(swirl, geo.torus(0.26, 0.05, 4, 10), light, [0, 0.48, 0], [HALF_PI, 0, 0]);
  add(swirl, geo.torus(0.16, 0.04, 4, 8), light, [0.03, 0.26, 0], [HALF_PI + 0.2, 0, 0]);
  add(swirl, geo.cone(0.05, 0.16, 4), foam, [0.22, 0.56, 0.08], [0, 0, -0.6]);
  const body = grp(float, 0, 0.8, 0);
  add(body, geo.ico(0.34, 1), water, [0, 0.0, 0], null, [1.05, 1.0, 0.85]);
  add(body, geo.ico(0.2, 0), light, [0, 0.05, 0.12]);
  for (const s of [1, -1]) add(body, geo.ico(0.17, 0), water, [s * 0.34, 0.17, -0.02]);
  add(body, geo.cone(0.06, 0.2, 4), foam, [0.38, 0.33, -0.04], [0, 0, -0.4]);
  add(body, geo.cone(0.06, 0.2, 4), foam, [-0.38, 0.33, -0.04], [0, 0, 0.4]);
  const head = grp(body, 0, 0.42, 0.06);
  add(head, geo.ico(0.17, 0), light, [0, 0, 0]);
  add(head, geo.cone(0.08, 0.26, 5), foam, [0, 0.12, -0.1], [-1.0, 0, 0]);
  const eyes = [];
  for (const s of [1, -1]) eyes.push(add(head, geo.sphere(0.03, 5, 4), glowMat(0xffffff, 1), [s * 0.06, 0.01, 0.14]));
  const mkArm = (g, bend) => {
    add(g, geo.ico(0.11, 0), water, [0, -0.15, 0.02]);
    add(g, geo.ico(0.1, 0), water, [0, -0.32, 0.08 + bend]);
    const fist = add(g, geo.ico(0.16, 0), light, [0, -0.5, 0.14 + bend]);
    add(g, geo.cone(0.04, 0.12, 4), foam, [0, -0.4, 0.26 + bend], [1.2, 0, 0]);
    return fist;
  };
  const armL = grp(body, 0.38, 0.12, 0);
  mkArm(armL, 0);
  const weapon = grp(body, -0.38, 0.12, 0);
  mkArm(weapon, 0.04);
  for (const m of [...eyes]) m.castShadow = false;
  return {
    root,
    parts: { body, head, bob: [float], spin: [swirl], arms: [{ obj: armL, phase: Math.PI }], weapon, glow: eyes },
    height: 1.4,
    radius: 0.42,
  };
}

