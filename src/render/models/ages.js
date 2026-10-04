// "Ages" content: Tribal -> Feudal -> Kingdom -> Imperial units, the upgrading house line, lumber yard,
// stable, imperial palace, and the player fortifications (tiling walls + gates with swinging doors).
// Same conventions as the other builders: origin at ground center, facing +Z, character's weapon hand
// on -X, team color via mat(teamColor), cached geo/mat, everything casts shadows (add()).
import {
  THREE, mat, geo, P, CG, glowMat, grp, add, beam, rod, rig, legMesh, armMesh, grip, MELEE_TILT, STAFF_TILT,
  kiteShield, roundShield, bowMesh, quiver, fire, flag, banner, gableRoof, timberWalls, door, windowPane,
  mergedBoxes, crenRectGeo, crenRingGeo,
} from './common.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HALF_PI = Math.PI / 2;

/** Darker/lighter variant of a color (used for team-colored quilting, trims...). */
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();

/**
 * Cached merged cylinders / cones: [[rTop, rBot, h, x, y, z, rx = 0, rz = 0, seg = 6], ...],
 * each centered on (x, y, z). rTop = 0 makes a cone. Used for log piles and stakes.
 */
function mergedCyls(key, list) {
  return geo.custom(`ages-cyl:${key}`, () => {
    const parts = list.map(([rt, rb, h, x, y, z, rx = 0, rz = 0, seg = 6]) => {
      const g = new THREE.CylinderGeometry(rt, rb, h, seg);
      if (rz) g.rotateZ(rz);
      if (rx) g.rotateX(rx);
      g.translate(x, y, z);
      return g;
    });
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

/** Upper hemisphere (dome), radius 1, base at y=0. */
const hemi = () => geo.custom('ages:hemi16', () => new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, HALF_PI));

/**
 * Keep a mesh out of the static-mesh merge of models.js: a mesh that has children makes its whole
 * merge bucket skip, so moving parts that are not animation anchors (gate doors) stay separate.
 * Give such meshes a material of their own so nothing else loses its merge.
 */
function noMerge(m) {
  m.add(new THREE.Object3D());
  return m;
}

function unitResult(r, height, radius, extra = {}) {
  return {
    root: r.root,
    parts: { body: r.body, head: r.head, legs: r.legs, arms: [{ obj: r.armL, phase: Math.PI }], weapon: r.weapon, ...extra },
    height,
    radius,
  };
}

/** Robe skirt + hem trim for casters (body-relative). */
function robe(body, { hipY, color, trim, w = 0.42, d = 0.36, topW = 0.55, top = 0.16 }) {
  const h = hipY + top;
  add(body, CG.frustum(topW), mat(color), [0, top - h / 2, 0], null, [w, h, d]);
  add(body, CG.frustum(0.97), mat(trim), [0, -hipY + 0.03, 0], null, [w * 1.02, 0.06, d * 1.02]);
}

/** Feet only (robed characters). */
function shoes(r, len, color, w = 0.08) {
  for (const l of r.legs) {
    add(l.obj, geo.box(w, 0.08, w * 1.7), mat(color), [0, -len + 0.04, w * 0.35]);
    l.amp = 0.45;
  }
}

/** Torso-hugging horizontal band on a CG.frustum torso (center cy, height th, bottom w0 x d0, top ratio k). */
function torsoBand(body, material, { cy, th, w0, d0, k, y, h = 0.018, grow = 0.012 }) {
  const t = (y - (cy - th / 2)) / th;
  const s = 1 + (k - 1) * t;
  add(body, geo.box(w0 * s + grow, h, d0 * s + grow), material, [0, y, 0]);
}

// ===========================================================================
// Units
// ===========================================================================

// Tribal levy: quilted team tunic, leather cap, round wooden shield, studded club.
export function militia(tc) {
  const L = 0.34;
  const r = rig({ legLen: L, hipW: 0.072, shoulderX: 0.2, shoulderY: 0.31, neckY: 0.39 });
  const team = mat(tc), teamD = mat(shade(tc, 0.6)), skin = mat(P.skin), leather = mat(P.leather), leatherD = mat(P.leatherDark);
  for (const l of r.legs) {
    legMesh(l.obj, L, 0.09, mat(0x76634a), leatherD, { bootH: 0.4 });
    add(l.obj, geo.box(0.1, 0.035, 0.1), mat(P.linen), [0, -L * 0.5, 0]); // leg wraps
  }
  // padded tunic with quilting rings
  const torso = { cy: 0.19, th: 0.32, w0: 0.27, d0: 0.2, k: 1.28 };
  add(r.body, CG.frustum(torso.k), team, [0, torso.cy, 0], null, [torso.w0, torso.th, torso.d0]);
  for (const y of [0.13, 0.21, 0.29]) torsoBand(r.body, teamD, { ...torso, y });
  add(r.body, CG.frustum(0.8), team, [0, -0.045, 0], null, [0.31, 0.15, 0.235]); // tunic skirt
  add(r.body, CG.frustum(0.97), teamD, [0, -0.115, 0], null, [0.31, 0.025, 0.235]);
  add(r.body, geo.box(0.29, 0.045, 0.22), leather, [0, 0.05, 0]); // rope/leather belt
  add(r.body, geo.box(0.06, 0.08, 0.03), leatherD, [-0.08, 0.0, 0.11]); // pouch
  add(r.body, CG.frustum(0.75), mat(P.linen), [0, 0.355, 0], null, [0.24, 0.04, 0.19]); // collar
  // head + leather cap with ear flaps
  add(r.head, geo.sphere(0.095, 8, 6), skin, [0, 0.1, 0.015]);
  add(r.head, geo.box(0.03, 0.04, 0.03), mat(P.skinShade), [0, 0.09, 0.112]);
  add(r.head, geo.box(0.13, 0.03, 0.04), mat(0x6a4a2a), [0, 0.045, 0.085]); // stubble beard
  add(r.head, geo.sphere(0.104, 8, 6), leather, [0, 0.15, -0.012], null, [1, 0.62, 1]);
  add(r.head, geo.cyl(0.1, 0.104, 0.03, 8), leatherD, [0, 0.122, -0.008]);
  for (const s of [1, -1]) add(r.head, geo.box(0.03, 0.08, 0.06), leather, [s * 0.095, 0.085, -0.01]);
  add(r.head, geo.cone(0.02, 0.05, 4), leatherD, [0, 0.225, -0.012]);
  // off arm: round plank shield with a painted team stripe
  const armOpt = { upper: 0.14, fore: 0.13, w: 0.075, upperMat: team, foreMat: skin, handMat: skin };
  const handL = armMesh(r.armL, { ...armOpt, bend: 0.5 });
  const sh = roundShield(handL, P.woodLight, { r: 0.16, x: 0.065, y: 0.02, z: 0.03, ry: 0.6, rim: P.woodDark, boss: P.iron });
  add(sh, geo.box(0.06, 0.26, 0.012), team, [0, 0, 0.032]);
  for (const x of [-0.075, 0.075]) add(sh, geo.box(0.012, 0.24, 0.01), leatherD, [x, 0, 0.031]);
  // weapon: studded club
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.6 });
  const g = grip(hand, MELEE_TILT);
  add(g, geo.cyl(0.022, 0.018, 0.14, 5), leatherD, [0, 0, 0]);
  add(g, geo.cyl(0.055, 0.024, 0.36, 6), mat(P.wood), [0, 0.2, 0]);
  add(g, geo.sphere(0.056, 6, 4), mat(P.wood), [0, 0.38, 0], null, [1, 0.7, 1]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    add(g, geo.cone(0.016, 0.05, 4), mat(P.steelDark), [Math.sin(a) * 0.054, 0.3 + (i % 2) * 0.05, Math.cos(a) * 0.054], [HALF_PI, 0, -a]);
  }
  return unitResult(r, 1.0, 0.3);
}

// Tribal skirmisher: leather jerkin, wolf-fur hood, team scarf, short bow, quiver.
export function hunter(tc) {
  const L = 0.35;
  const r = rig({ legLen: L, hipW: 0.07, shoulderX: 0.19, shoulderY: 0.32, neckY: 0.4 });
  const leather = mat(P.leather), leatherD = mat(P.leatherDark), fur = mat(0x8c7354), furL = mat(0xdcd0b4);
  const team = mat(tc), skin = mat(P.skin);
  for (const l of r.legs) {
    legMesh(l.obj, L, 0.086, mat(0x5e4a32), leatherD, { bootH: 0.5 });
    add(l.obj, geo.box(0.115, 0.05, 0.125), furL, [0, -L * 0.52, 0.012]); // fur boot cuffs
  }
  const torso = { cy: 0.19, th: 0.31, w0: 0.25, d0: 0.19, k: 1.22 };
  add(r.body, CG.frustum(torso.k), leather, [0, torso.cy, 0], null, [torso.w0, torso.th, torso.d0]);
  add(r.body, geo.box(0.022, 0.24, 0.02), leatherD, [0, 0.2, 0.108], [0.08, 0, 0]); // lacing
  add(r.body, CG.frustum(0.86), mat(0x6a4322), [0, -0.035, 0], null, [0.27, 0.15, 0.215]); // skirt
  add(r.body, geo.box(0.27, 0.04, 0.21), leatherD, [0, 0.05, 0]);
  add(r.body, geo.box(0.07, 0.08, 0.04), leather, [0.09, 0.0, 0.11]); // pouch
  // team scarf with a trailing end
  add(r.body, CG.frustum(0.72), team, [0, 0.36, 0.005], null, [0.28, 0.075, 0.23]);
  add(r.body, geo.box(0.07, 0.2, 0.02), team, [0.06, 0.25, -0.13], [0.15, 0, 0.15]);
  add(r.body, geo.box(0.055, 0.13, 0.02), team, [-0.045, 0.285, 0.125], [-0.18, 0, -0.12]);
  quiver(r.body, { x: 0.06, y: 0.22, z: -0.15, rz: 0.42, len: 0.3, color: P.leatherDark });
  // head in a wolf-fur hood (ears + pale fur rim)
  add(r.head, geo.sphere(0.096, 8, 6), skin, [0, 0.1, 0.015]);
  add(r.head, geo.box(0.025, 0.035, 0.03), mat(P.skinShade), [0, 0.09, 0.112]);
  add(r.head, geo.sphere(0.114, 8, 6), fur, [0, 0.118, -0.028], null, [1, 1, 1.05]);
  add(r.head, geo.torus(0.094, 0.026, 4, 10), furL, [0, 0.108, 0.02], [0.3, 0, 0]);
  for (const s of [1, -1]) add(r.head, geo.cone(0.035, 0.085, 4), fur, [s * 0.065, 0.225, -0.035], [-0.15, 0, -s * 0.3]);
  add(r.head, geo.cone(0.06, 0.16, 5), fur, [0, 0.1, -0.15], [-2.1, 0, 0]); // hood tail
  const armOpt = { upper: 0.14, fore: 0.13, w: 0.072, upperMat: leather, foreMat: leatherD, handMat: skin };
  armMesh(r.armL, { ...armOpt, bend: 0.45 });
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.55 });
  bowMesh(grip(hand, 0.75), 0.72, { wood: 0x6a4020 });
  return unitResult(r, 1.0, 0.3);
}

// Feudal pikeman: kettle hat, quilted gambeson with team tabard, small team shield, tall pike.
export function spearman(tc) {
  const L = 0.37;
  const r = rig({ legLen: L, hipW: 0.08, shoulderX: 0.22, shoulderY: 0.34, neckY: 0.42 });
  const gam = mat(0xd8c9a0), gamD = mat(0xa8996e), team = mat(tc), steel = mat(P.steel), steelD = mat(P.steelDark);
  const skin = mat(P.skin), leatherD = mat(P.leatherDark);
  for (const l of r.legs) legMesh(l.obj, L, 0.1, mat(0x6a6656), leatherD);
  const torso = { cy: 0.21, th: 0.32, w0: 0.28, d0: 0.21, k: 1.32 };
  add(r.body, CG.frustum(torso.k), gam, [0, torso.cy, 0], null, [torso.w0, torso.th, torso.d0]);
  for (const y of [0.12, 0.3]) torsoBand(r.body, gamD, { ...torso, y });
  add(r.body, CG.frustum(0.84), gam, [0, -0.045, 0], null, [0.31, 0.16, 0.24]); // gambeson skirt
  // team tabard (front + back) with a pale diamond
  add(r.body, geo.box(0.2, 0.5, 0.025), team, [0, 0.12, 0.126], [0.1, 0, 0]);
  add(r.body, geo.box(0.2, 0.42, 0.025), team, [0, 0.15, -0.126], [-0.1, 0, 0]);
  add(r.body, geo.box(0.08, 0.08, 0.02), mat(P.linen), [0, 0.2, 0.15], [0.1, 0, Math.PI / 4]);
  add(r.body, geo.box(0.31, 0.045, 0.235), mat(P.leather), [0, 0.06, 0]);
  for (const s of [1, -1]) add(r.body, geo.sphere(0.085, 7, 5), gam, [s * 0.2, 0.33, 0], null, [1.1, 0.8, 1.1]);
  // head + wide-brimmed kettle hat
  add(r.head, geo.sphere(0.098, 8, 6), skin, [0, 0.1, 0.015]);
  add(r.head, geo.box(0.03, 0.04, 0.03), mat(P.skinShade), [0, 0.085, 0.113]);
  add(r.head, geo.sphere(0.112, 8, 6), steel, [0, 0.15, 0], null, [1, 0.75, 1]);
  add(r.head, geo.cyl(0.17, 0.18, 0.022, 10), steel, [0, 0.135, 0]);
  add(r.head, geo.cyl(0.182, 0.182, 0.012, 10), steelD, [0, 0.122, 0]);
  add(r.head, geo.box(0.016, 0.03, 0.2), steelD, [0, 0.225, 0]); // comb
  const armOpt = { upper: 0.15, fore: 0.14, w: 0.08, upperMat: gam, foreMat: gam, handMat: leatherD };
  const handL = armMesh(r.armL, { ...armOpt, bend: 0.5 });
  kiteShield(handL, tc, { w: 0.2, h: 0.28, x: 0.06, y: 0.03, z: 0.02, ry: 0.6 });
  // tall pike, carried leaning forward
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.55 });
  const g = grip(hand, 0.42);
  add(g, geo.cyl(0.017, 0.02, 1.8, 5), mat(P.woodLight), [0, 0.45, 0]);
  add(g, geo.box(0.024, 0.13, 0.024), steelD, [0, 1.33, 0]);
  add(g, geo.cone(0.036, 0.2, 4), mat(P.steelLight), [0, 1.49, 0], [0, Math.PI / 4, 0], [1, 1, 0.45]);
  add(g, geo.box(0.012, 0.11, 0.07), team, [0, 1.2, -0.04]); // little team streamer
  return unitResult(r, 1.15, 0.32);
}

/** Horse leg pivot groups (hip at y = LL). defs: [x, z, phase]. */
function horseLegs(root, LL, defs, { upper, lower, hoofSize, coat, sock, hoof, amp }) {
  const legs = [];
  for (const [x, z, ph] of defs) {
    const lg = grp(root, x, LL, z);
    const uh = upper[1], lh = lower[1];
    add(lg, geo.box(upper[0], uh, upper[2]), coat, [0, -uh / 2 + 0.01, 0]);
    add(lg, geo.box(lower[0], lh, lower[2]), coat, [0, -uh - lh / 2 + 0.04, 0]);
    if (sock) add(lg, geo.box(lower[0] * 1.15, 0.06, lower[2] * 1.15), sock, [0, -LL + hoofSize[1] + 0.03, 0.004]);
    add(lg, geo.box(hoofSize[0], hoofSize[1], hoofSize[2]), hoof, [0, -LL + hoofSize[1] / 2, 0.012]);
    legs.push({ obj: lg, phase: ph, amp });
  }
  return legs;
}

/** Horse head group (muzzle toward +Z, tilted nose-down). */
function horseHead(parent, x, y, z, { coat, dark, size = 1, blaze = null, tilt = 0.55 }) {
  const hg = grp(parent, x, y, z);
  hg.rotation.x = tilt;
  hg.scale.setScalar(size);
  add(hg, geo.box(0.14, 0.15, 0.36), coat, [0, 0, 0]);
  add(hg, geo.box(0.125, 0.12, 0.1), dark, [0, -0.012, 0.16]); // muzzle
  if (blaze) add(hg, geo.box(0.04, 0.012, 0.24), blaze, [0, 0.075, 0.03]);
  for (const s of [1, -1]) add(hg, geo.cone(0.025, 0.08, 4), coat, [s * 0.045, 0.1, -0.13], [-0.3, 0, 0]);
  return hg;
}

// Feudal light cavalry: hooded leather rider on a fast unarmored horse with a team saddle cloth.
export function scout_rider(tc) {
  const root = new THREE.Group();
  const horse = mat(0xa86c36), horseD = mat(0x4a2c16), team = mat(tc), teamD = mat(shade(tc, 0.6));
  const leather = mat(P.leather), leatherD = mat(P.leatherDark), skin = mat(P.skin), white = mat(0xeee6d8);
  const legs = horseLegs(root, 0.6, [[0.12, 0.32, 0], [-0.12, -0.34, 0], [-0.12, 0.32, Math.PI], [0.12, -0.34, Math.PI]], {
    upper: [0.095, 0.38, 0.12], lower: [0.07, 0.24, 0.075], hoofSize: [0.09, 0.06, 0.1],
    coat: horse, sock: white, hoof: mat(0x2e221a), amp: 0.62,
  });
  const body = grp(root, 0, 0.76, 0);
  add(body, geo.box(0.32, 0.32, 0.86), horse, [0, 0, 0]);
  add(body, geo.box(0.29, 0.26, 0.2), horse, [0, -0.01, 0.4]); // chest
  // team saddle cloth + saddle
  add(body, geo.box(0.37, 0.24, 0.42), team, [0, 0.045, -0.04]);
  add(body, geo.box(0.375, 0.035, 0.425), mat(P.linen), [0, -0.075, -0.04]);
  add(body, geo.box(0.25, 0.06, 0.3), leatherD, [0, 0.19, -0.04]);
  add(body, geo.box(0.2, 0.08, 0.04), leatherD, [0, 0.23, -0.19]); // cantle
  for (const s of [1, -1]) add(body, geo.box(0.06, 0.12, 0.14), leather, [s * 0.2, 0.0, -0.3]); // saddle bags
  // neck, mane, head, tail
  add(body, geo.box(0.15, 0.44, 0.2), horse, [0, 0.25, 0.44], [0.6, 0, 0]);
  add(body, geo.box(0.05, 0.42, 0.07), horseD, [0, 0.33, 0.35], [0.6, 0, 0]);
  horseHead(body, 0, 0.44, 0.66, { coat: horse, dark: horseD, blaze: white });
  add(body, geo.box(0.07, 0.38, 0.07), horseD, [0, -0.06, -0.5], [-0.45, 0, 0]);
  add(body, geo.box(0.02, 0.02, 0.3), leatherD, [0, 0.3, 0.35], [-0.35, 0, 0]); // reins
  // rider (static legs)
  for (const s of [1, -1]) {
    add(body, geo.box(0.09, 0.1, 0.26), mat(0x5e4a32), [s * 0.17, 0.21, 0.02], [0.2, 0, 0]);
    add(body, geo.box(0.085, 0.27, 0.1), leatherD, [s * 0.215, 0.08, 0.13]);
  }
  const rider = grp(body, 0, 0.23, -0.04);
  add(rider, CG.frustum(1.3), leather, [0, 0.16, 0], null, [0.25, 0.28, 0.19]);
  add(rider, geo.box(0.26, 0.04, 0.2), leatherD, [0, 0.04, 0]);
  add(rider, CG.frustum(0.62), team, [0, 0.12, -0.115], [0.18, 0, 0], [0.3, 0.32, 0.035]); // short cape
  add(rider, CG.frustum(0.7), team, [0, 0.31, -0.005], null, [0.29, 0.07, 0.22]); // mantle
  const head = grp(rider, 0, 0.34, 0);
  add(head, geo.sphere(0.095, 8, 6), skin, [0, 0.1, 0.015]);
  add(head, geo.sphere(0.108, 8, 6), team, [0, 0.115, -0.025], null, [1, 1, 1.03]);
  add(head, geo.torus(0.09, 0.016, 4, 10), teamD, [0, 0.105, 0.015], [0.3, 0, 0]);
  add(head, geo.cone(0.05, 0.15, 5), team, [0, 0.1, -0.14], [-2.0, 0, 0]);
  const armOpt = { upper: 0.13, fore: 0.13, w: 0.07, upperMat: leather, foreMat: leatherD, handMat: skin };
  const armL = grp(rider, 0.18, 0.27, 0);
  armMesh(armL, { ...armOpt, bend: 1.0 });
  const weapon = grp(rider, -0.18, 0.27, 0);
  const hand = armMesh(weapon, { ...armOpt, bend: 0.8 });
  const g = grip(hand, 1.1);
  add(g, geo.cyl(0.014, 0.016, 1.0, 5), mat(P.woodLight), [0, 0.22, 0]);
  add(g, geo.cone(0.032, 0.17, 4), mat(P.steelLight), [0, 0.8, 0], [0, Math.PI / 4, 0], [1, 1, 0.45]);
  add(g, geo.box(0.01, 0.1, 0.06), team, [0, 0.64, -0.035]);
  return {
    root,
    parts: { body, head, legs, arms: [{ obj: armL, phase: Math.PI }], weapon },
    height: 1.6,
    radius: 0.5,
  };
}

// Kingdom-age marksman: open-face helmet, mail, team tabard, heavy windlass crossbow, bolt case.
export function crossbowman(tc) {
  const L = 0.36;
  const r = rig({ legLen: L, hipW: 0.08, shoulderX: 0.22, shoulderY: 0.34, neckY: 0.42 });
  const mail = mat(P.mail), steel = mat(P.steel), steelD = mat(P.steelDark), team = mat(tc);
  const leather = mat(P.leather), leatherD = mat(P.leatherDark), skin = mat(P.skin), wood = mat(0x7a4a24);
  for (const l of r.legs) legMesh(l.obj, L, 0.1, mat(0x5a5048), leatherD);
  add(r.body, CG.frustum(1.3), mail, [0, 0.21, 0], null, [0.28, 0.31, 0.21]);
  add(r.body, CG.frustum(0.84), mail, [0, -0.04, 0], null, [0.3, 0.15, 0.23]);
  add(r.body, geo.box(0.21, 0.48, 0.025), team, [0, 0.12, 0.126], [0.1, 0, 0]);
  add(r.body, geo.box(0.21, 0.4, 0.025), team, [0, 0.15, -0.126], [-0.1, 0, 0]);
  add(r.body, geo.box(0.04, 0.16, 0.02), mat(P.white), [0, 0.2, 0.146], [0.1, 0, 0]); // cross
  add(r.body, geo.box(0.12, 0.04, 0.02), mat(P.white), [0, 0.23, 0.149], [0.1, 0, 0]);
  add(r.body, geo.box(0.3, 0.045, 0.23), leather, [0, 0.06, 0]);
  for (const s of [1, -1]) add(r.body, geo.sphere(0.085, 7, 5), mail, [s * 0.2, 0.33, 0], null, [1.1, 0.8, 1.1]);
  // bolt case on the right hip
  const q = grp(r.body, -0.165, 0.0, -0.05);
  q.rotation.z = -0.18;
  add(q, geo.box(0.08, 0.2, 0.1), leatherD, [0, 0, 0]);
  add(q, mergedBoxes('boltFletch', [[0.012, 0.05, 0.03, -0.02, 0.12, 0.02], [0.012, 0.05, 0.03, 0.015, 0.125, -0.015], [0.012, 0.05, 0.03, 0.0, 0.115, 0.0]]), mat(0xf2f2f2));
  // head: open-face helmet with brim and mail aventail
  add(r.head, geo.sphere(0.097, 8, 6), skin, [0, 0.1, 0.015]);
  add(r.head, geo.box(0.03, 0.04, 0.03), mat(P.skinShade), [0, 0.088, 0.112]);
  add(r.head, CG.frustum(1.3), mail, [0, 0.025, -0.01], null, [0.17, 0.08, 0.17]);
  add(r.head, geo.sphere(0.112, 8, 6), steel, [0, 0.145, -0.014], null, [1, 0.82, 1.02]);
  add(r.head, geo.cyl(0.13, 0.135, 0.022, 10), steelD, [0, 0.12, -0.014]);
  add(r.head, geo.box(0.016, 0.03, 0.18), steelD, [0, 0.235, -0.014]); // comb
  for (const s of [1, -1]) add(r.head, geo.box(0.025, 0.09, 0.07), steel, [s * 0.095, 0.08, 0.02]); // cheek plates
  const armOpt = { upper: 0.15, fore: 0.14, w: 0.08, upperMat: mail, foreMat: leather, handMat: leatherD };
  armMesh(r.armL, { ...armOpt, bend: 0.9 });
  // heavy crossbow held level at the chest; the stock runs along grip +Y, its top faces grip -Z
  const hand = armMesh(r.weapon, { ...armOpt, bend: 1.25 });
  const g = grip(hand, 1.5);
  add(g, geo.box(0.075, 0.6, 0.08), wood, [0, 0.13, 0]);
  add(g, geo.box(0.085, 0.18, 0.12), wood, [0, -0.15, 0.02]);
  add(g, geo.box(0.09, 0.07, 0.09), steelD, [0, 0.4, -0.005]); // prod lath
  for (const s of [1, -1]) {
    beam(g, [0, 0.41, -0.02], [s * 0.3, 0.33, -0.02], 0.05, steel, 0.045);
    add(g, geo.box(0.04, 0.05, 0.05), steelD, [s * 0.3, 0.33, -0.02]);
    beam(g, [s * 0.3, 0.33, -0.04], [0, 0.17, -0.06], 0.012, mat(0xe8e2d0));
  }
  add(g, geo.box(0.018, 0.3, 0.018), mat(P.woodLight), [0, 0.3, -0.06]); // bolt
  add(g, geo.cone(0.022, 0.06, 4), steelD, [0, 0.48, -0.06]);
  add(g, geo.torus(0.05, 0.012, 4, 8), steelD, [0, 0.47, 0], [0, HALF_PI, 0]); // stirrup
  add(g, geo.cyl(0.03, 0.03, 0.22, 6), steelD, [0, -0.12, -0.04], [0, 0, HALF_PI]); // windlass
  for (const s of [1, -1]) add(g, geo.box(0.025, 0.12, 0.025), steelD, [s * 0.11, -0.07, -0.04]);
  return unitResult(r, 1.1, 0.32);
}

// Imperial elite infantry: full plate, great helm with a team plume, team tabard + cape, greatsword.
export function champion(tc) {
  const L = 0.42;
  const r = rig({ legLen: L, hipW: 0.1, shoulderX: 0.29, shoulderY: 0.4, neckY: 0.49 });
  const plate = mat(0xdfe5ec), plateD = mat(P.steelDark), steel = mat(P.steel), gold = mat(P.gold), team = mat(tc);
  for (const l of r.legs) {
    legMesh(l.obj, L, 0.125, plate, plateD);
    add(l.obj, geo.sphere(0.055, 6, 4), gold, [0, -L * 0.56, 0.065]);
  }
  add(r.body, CG.frustum(1.45), plate, [0, 0.25, 0], null, [0.35, 0.38, 0.25]);
  add(r.body, CG.frustum(0.8), steel, [0, -0.045, 0], null, [0.37, 0.17, 0.27]); // faulds
  add(r.body, CG.frustum(0.97), gold, [0, -0.125, 0], null, [0.37, 0.03, 0.27]);
  add(r.body, geo.box(0.24, 0.6, 0.03), team, [0, 0.1, 0.14], [0.08, 0, 0]);
  add(r.body, geo.box(0.24, 0.5, 0.03), team, [0, 0.13, -0.14], [-0.08, 0, 0]);
  add(r.body, geo.box(0.37, 0.06, 0.27), gold, [0, 0.07, 0]);
  add(r.body, geo.box(0.09, 0.09, 0.02), gold, [0, 0.25, 0.165], [0.08, 0, Math.PI / 4]);
  // layered pauldrons with gold rims
  for (const s of [1, -1]) {
    add(r.body, geo.sphere(0.15, 8, 6), plate, [s * 0.29, 0.44, 0], null, [1.15, 0.8, 1.1]);
    add(r.body, geo.sphere(0.13, 8, 6), steel, [s * 0.32, 0.37, 0], null, [1.05, 0.7, 1.05]);
    add(r.body, geo.torus(0.15, 0.022, 4, 10), gold, [s * 0.31, 0.405, 0], [HALF_PI, 0, 0], [1.1, 1.05, 1]);
  }
  add(r.body, CG.frustum(0.6), team, [0, 0.06, -0.17], [0.12, 0, 0], [0.48, 0.76, 0.04]); // cape
  // great helm + crest + plume
  add(r.head, geo.cyl(0.125, 0.132, 0.27, 8), plate, [0, 0.12, 0]);
  add(r.head, geo.cyl(0.095, 0.125, 0.06, 8), plate, [0, 0.285, 0]);
  add(r.head, geo.box(0.21, 0.026, 0.04), mat(P.black), [0, 0.155, 0.118]);
  add(r.head, geo.box(0.026, 0.2, 0.03), gold, [0, 0.11, 0.13]);
  add(r.head, geo.box(0.12, 0.024, 0.03), gold, [0, 0.2, 0.128]);
  add(r.head, geo.cyl(0.13, 0.13, 0.03, 8), gold, [0, 0.255, 0]);
  add(r.head, geo.box(0.05, 0.11, 0.26), team, [0, 0.36, -0.02]);
  add(r.head, geo.cone(0.075, 0.38, 6), team, [0, 0.42, -0.14], [-0.75, 0, 0]);
  const armOpt = { upper: 0.18, fore: 0.17, w: 0.11, upperMat: plate, foreMat: plate, handMat: plateD };
  armMesh(r.armL, { ...armOpt, bend: 0.55 });
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.65 });
  // two-handed greatsword (rests a little higher than a one-hander so the tip clears the ground)
  const g = grip(hand, 1.8);
  add(g, geo.cyl(0.022, 0.022, 0.26, 6), mat(P.leatherDark), [0, 0, 0]);
  add(g, geo.sphere(0.042, 6, 4), gold, [0, -0.15, 0]);
  add(g, geo.box(0.34, 0.04, 0.06), gold, [0, 0.15, 0]);
  for (const s of [1, -1]) add(g, geo.sphere(0.03, 5, 4), gold, [s * 0.17, 0.15, 0]);
  add(g, geo.box(0.1, 0.9, 0.024), mat(P.steelLight), [0, 0.62, 0]);
  add(g, geo.box(0.024, 0.72, 0.028), steel, [0, 0.55, 0]);
  add(g, geo.box(0.16, 0.026, 0.04), gold, [0, 0.29, 0]);
  add(g, geo.cone(0.07, 0.16, 4), mat(P.steelLight), [0, 1.15, 0], [0, Math.PI / 4, 0], [1, 1, 0.3]);
  return unitResult(r, 1.3, 0.38);
}

// Imperial heavy cavalry: gold-trimmed plate, crowned helm, couched lance with team pennon,
// on a fully barded destrier in a long team caparison.
export function royal_knight(tc) {
  const root = new THREE.Group();
  const coat = mat(0xd8d4cc), coatD = mat(0x8a857c), plate = mat(0xe6ebf0), plateD = mat(P.steelDark);
  const gold = mat(P.gold), team = mat(tc), teamD = mat(shade(tc, 0.62));
  const legs = horseLegs(root, 0.66, [[0.16, 0.38, 0], [-0.16, -0.4, 0], [-0.16, 0.38, Math.PI], [0.16, -0.4, Math.PI]], {
    upper: [0.13, 0.44, 0.15], lower: [0.1, 0.26, 0.105], hoofSize: [0.13, 0.07, 0.145],
    coat, sock: mat(0xf2efe8), hoof: mat(0x3a3430), amp: 0.45,
  });
  const body = grp(root, 0, 0.88, 0);
  add(body, geo.box(0.42, 0.4, 1.04), coat, [0, 0, 0]);
  // long team caparison with gold hem, emblems and a darker team border
  add(body, geo.box(0.5, 0.2, 1.12), team, [0, 0.06, 0]);
  add(body, CG.frustum(0.88), team, [0, -0.25, 0], null, [0.58, 0.38, 1.22]);
  add(body, CG.frustum(0.98), teamD, [0, -0.41, 0], null, [0.585, 0.06, 1.225]);
  add(body, CG.frustum(0.98), gold, [0, -0.45, 0], null, [0.59, 0.035, 1.23]);
  for (const s of [1, -1]) {
    for (const z of [0.25, -0.25]) add(body, geo.box(0.02, 0.13, 0.13), gold, [s * 0.272, -0.14, z], [Math.PI / 4, 0, 0]);
  }
  // saddle with gold cantle/pommel
  add(body, geo.box(0.32, 0.07, 0.36), mat(P.leatherDark), [0, 0.2, -0.05]);
  add(body, geo.box(0.3, 0.14, 0.05), gold, [0, 0.28, -0.23]);
  add(body, geo.box(0.16, 0.1, 0.05), gold, [0, 0.25, 0.12]);
  // barded neck (team crinet cover + steel plates) and chanfron
  add(body, geo.box(0.2, 0.52, 0.26), coat, [0, 0.31, 0.5], [0.5, 0, 0]);
  add(body, geo.box(0.215, 0.44, 0.22), team, [0, 0.27, 0.5], [0.5, 0, 0]);
  add(body, geo.box(0.225, 0.46, 0.1), plate, [0, 0.38, 0.42], [0.5, 0, 0]);
  add(body, geo.box(0.06, 0.46, 0.105), gold, [0, 0.4, 0.4], [0.5, 0, 0]);
  const hg = horseHead(body, 0, 0.56, 0.74, { coat, dark: coatD, size: 1.2 });
  add(hg, geo.box(0.15, 0.06, 0.3), plate, [0, 0.07, 0.02]);
  add(hg, geo.box(0.03, 0.07, 0.3), gold, [0, 0.08, 0.02]);
  add(hg, geo.cone(0.035, 0.18, 5), team, [0, 0.16, -0.08], [-0.6, 0, 0]); // chanfron plume
  add(body, geo.box(0.08, 0.4, 0.08), coatD, [0, -0.08, -0.6], [-0.45, 0, 0]); // tail
  // rider legs (plate)
  for (const s of [1, -1]) {
    add(body, geo.box(0.11, 0.12, 0.3), plate, [s * 0.22, 0.25, 0.02], [0.2, 0, 0]);
    add(body, geo.box(0.11, 0.3, 0.13), plateD, [s * 0.27, 0.1, 0.14]);
  }
  const rider = grp(body, 0, 0.27, -0.06);
  add(rider, CG.frustum(1.38), plate, [0, 0.18, 0], null, [0.31, 0.32, 0.22]);
  add(rider, geo.box(0.32, 0.05, 0.23), gold, [0, 0.03, 0]);
  add(rider, geo.box(0.21, 0.34, 0.03), team, [0, 0.15, 0.125], [0.08, 0, 0]);
  add(rider, geo.box(0.08, 0.08, 0.02), gold, [0, 0.2, 0.145], [0.08, 0, Math.PI / 4]);
  add(rider, CG.frustum(0.98), gold, [0, 0.33, 0], null, [0.38, 0.03, 0.27]); // gold gorget rim
  for (const s of [1, -1]) {
    add(rider, geo.sphere(0.13, 8, 6), plate, [s * 0.23, 0.32, 0], null, [1.15, 0.8, 1.1]);
    add(rider, geo.torus(0.13, 0.02, 4, 10), gold, [s * 0.245, 0.29, 0], [HALF_PI, 0, 0], [1.1, 1.05, 1]);
  }
  add(rider, CG.frustum(0.55), team, [0, -0.02, -0.17], [0.4, 0, 0], [0.44, 0.66, 0.04]); // cape
  // crowned great helm
  const head = grp(rider, 0, 0.4, 0);
  add(head, geo.cyl(0.115, 0.122, 0.24, 8), plate, [0, 0.1, 0]);
  add(head, geo.box(0.17, 0.025, 0.04), mat(P.black), [0, 0.13, 0.11]);
  add(head, geo.box(0.024, 0.16, 0.03), gold, [0, 0.09, 0.12]);
  add(head, geo.cyl(0.132, 0.126, 0.065, 8), gold, [0, 0.235, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(head, geo.cone(0.032, 0.09, 4), gold, [Math.sin(a) * 0.115, 0.31, Math.cos(a) * 0.115]);
  }
  add(head, geo.box(0.035, 0.035, 0.02), mat(0xd8202a), [0, 0.235, 0.132], [0, 0, Math.PI / 4]);
  add(head, geo.cone(0.055, 0.24, 5), team, [0, 0.36, -0.04], [-0.35, 0, 0]);
  const armOpt = { upper: 0.15, fore: 0.14, w: 0.085, upperMat: plate, foreMat: plate, handMat: plateD };
  const armL = grp(rider, 0.24, 0.31, 0);
  const handL = armMesh(armL, { ...armOpt, bend: 0.7 });
  kiteShield(handL, tc, { w: 0.3, h: 0.42, x: 0.07, y: 0.02, z: 0.0, ry: 0.9, rim: P.gold, boss: P.gold });
  const weapon = grp(rider, -0.24, 0.31, 0);
  const hand = armMesh(weapon, { ...armOpt, bend: 0.9 });
  // couched lance with vamplate and a team pennon
  const g = grip(hand, 1.35);
  add(g, geo.cyl(0.03, 0.03, 0.3, 6), mat(P.woodLight), [0, -0.1, 0]);
  add(g, geo.cyl(0.015, 0.036, 1.3, 7), mat(P.woodLight), [0, 0.7, 0]);
  for (const y of [0.35, 0.65, 0.95]) {
    const rr = 0.036 - ((y - 0.05) / 1.3) * 0.021 + 0.004;
    add(g, geo.cyl(rr, rr, 0.08, 7), team, [0, y, 0]);
  }
  add(g, geo.cone(0.09, 0.17, 8), plate, [0, 0.1, 0]);
  add(g, geo.cone(0.026, 0.14, 5), mat(P.steelLight), [0, 1.42, 0]);
  add(g, CG.pennant(), team, [0, 1.14, 0.01], [0, -HALF_PI, 0], [0.34, 0.22, 0.015]);
  return {
    root,
    parts: { body, head, legs, arms: [{ obj: armL, phase: Math.PI }], weapon },
    height: 1.9,
    radius: 0.6,
  };
}

// Imperial war-wizard: dark ornate robes with ember panel, team mantle, tall hood, fire-orb staff.
export function battlemage(tc) {
  const L = 0.36;
  const r = rig({ legLen: L, hipW: 0.07, shoulderX: 0.2, shoulderY: 0.37, neckY: 0.44 });
  shoes(r, L, 0x2a1a14);
  const robeC = 0x34303f, robeM = mat(robeC), ember = mat(0x9a2a12), gold = mat(P.gold), team = mat(tc), skin = mat(P.skin);
  robe(r.body, { hipY: L, color: robeC, trim: P.gold, w: 0.4, d: 0.35, topW: 0.55 });
  add(r.body, CG.frustum(0.85), ember, [0, -0.1, 0.075], null, [0.13, 0.48, 0.25]); // front panel
  for (const s of [1, -1]) add(r.body, geo.box(0.02, 0.46, 0.02), gold, [s * 0.07, -0.1, 0.16], [-0.17, 0, 0]);
  add(r.body, CG.frustum(1.3), robeM, [0, 0.27, 0], null, [0.25, 0.3, 0.18]);
  add(r.body, geo.box(0.27, 0.05, 0.2), gold, [0, 0.13, 0]);
  add(r.body, geo.box(0.06, 0.06, 0.02), ember, [0, 0.13, 0.105], [0, 0, Math.PI / 4]);
  // team mantle: shoulder cape + back drape, gold-edged
  add(r.body, CG.frustum(0.6), team, [0, 0.39, -0.005], null, [0.42, 0.12, 0.3]);
  add(r.body, CG.frustum(0.98), gold, [0, 0.33, -0.005], null, [0.425, 0.025, 0.305]);
  add(r.body, CG.frustum(0.6), team, [0, 0.04, -0.14], [0.12, 0, 0], [0.42, 0.7, 0.04]);
  // spellbook on the hip
  add(r.body, geo.box(0.1, 0.13, 0.05), mat(0x5a1a1a), [0.15, 0.05, 0.07], [0, 0.5, 0]);
  add(r.body, geo.box(0.03, 0.135, 0.055), gold, [0.15, 0.05, 0.07], [0, 0.5, 0]);
  // tall pointed hood with gold trim, grey beard
  add(r.head, geo.sphere(0.095, 8, 6), skin, [0, 0.1, 0.02]);
  add(r.head, geo.cone(0.06, 0.15, 5), mat(0xa8a8a8), [0, 0.0, 0.08], [Math.PI - 0.3, 0, 0]);
  add(r.head, geo.sphere(0.114, 8, 6), robeM, [0, 0.122, -0.022]);
  add(r.head, geo.cone(0.108, 0.36, 6), robeM, [0, 0.33, -0.065], [-0.32, 0, 0]);
  add(r.head, geo.torus(0.098, 0.017, 4, 10), gold, [0, 0.112, 0.012], [0.28, 0, 0]);
  const armOpt = { upper: 0.15, fore: 0.14, w: 0.08, upperMat: robeM, foreMat: robeM, handMat: skin, foreW: 0.11 };
  armMesh(r.armL, { ...armOpt, bend: 0.6 });
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.6 });
  const g = grip(hand, STAFF_TILT);
  add(g, geo.cyl(0.018, 0.022, 0.95, 5), mat(0x3a2418), [0, 0.15, 0]);
  add(g, geo.cyl(0.026, 0.026, 0.05, 6), gold, [0, 0.55, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    add(g, geo.cone(0.016, 0.14, 4), gold, [Math.sin(a) * 0.045, 0.64, Math.cos(a) * 0.045], [Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4]);
  }
  const orb = add(g, geo.sphere(0.065, 8, 6), glowMat(0xff7a1a, 1), [0, 0.7, 0]);
  orb.castShadow = false;
  const fl = fire(g, 0, 0.73, 0, 0.22, 'orange');
  return unitResult(r, 1.2, 0.32, { glow: [orb], fire: [fl] });
}

// Imperial siege engine. The throwing arm (parts.weapon) pivots at the axle; like the catapult its
// holder is turned 180 deg so +rotation.x winds the long arm back/down and about -1.5 flings it up.
export function trebuchet(tc) {
  const root = new THREE.Group();
  const wood = mat(P.wood), woodD = mat(P.woodDark), woodL = mat(P.woodLight), iron = mat(P.iron), team = mat(tc);
  const rope = mat(0xcdb98a);
  // log rollers instead of wheels (they turn while moving)
  const wheels = [];
  for (const z of [0.66, -0.66]) {
    const w = grp(root, 0, 0.11, z);
    add(w, geo.cyl(0.11, 0.11, 1.0, 8), woodD, [0, 0, 0], [0, 0, HALF_PI]);
    for (const s of [1, -1]) add(w, geo.cyl(0.118, 0.118, 0.05, 8), iron, [s * 0.4, 0, 0], [0, 0, HALF_PI]);
    add(w, geo.box(0.86, 0.04, 0.05), woodL, [0, 0.095, 0]);
    wheels.push(w);
  }
  // base frame: two long rails + end beams (the middle stays open for the swinging arm)
  for (const s of [1, -1]) add(root, geo.box(0.16, 0.16, 2.0), wood, [s * 0.42, 0.3, 0]);
  for (const z of [0.93, -0.93]) add(root, geo.box(1.0, 0.12, 0.13), woodD, [0, 0.3, z]);
  add(root, geo.box(0.68, 0.04, 0.34), woodL, [0, 0.4, 0.72]); // ammo deck
  for (const [x, z, rr] of [[0.12, 0.66, 0.1], [-0.12, 0.78, 0.09], [0.0, 0.7, 0.08], [-0.18, 0.62, 0.08]]) {
    add(root, geo.dodeca(rr), mat(P.stone), [x, 0.42 + rr * 0.8, z], [x, z, 0]);
  }
  // A-frames up to the axle
  const AY = 1.55;
  for (const s of [1, -1]) {
    const x = s * 0.31;
    beam(root, [s * 0.42, 0.36, 0.82], [x, AY + 0.04, 0.03], 0.12, wood);
    beam(root, [s * 0.42, 0.36, -0.82], [x, AY + 0.04, -0.03], 0.12, wood);
    add(root, geo.box(0.1, AY - 0.36, 0.1), woodD, [x, 0.36 + (AY - 0.36) / 2, 0]);
    add(root, geo.box(0.1, 0.09, 1.0), woodD, [s * 0.36, 0.86, 0]);
    add(root, geo.box(0.16, 0.16, 0.22), woodD, [x, AY, 0]);
    beam(root, [s * 0.5, 0.36, 0.0], [s * 0.36, 1.05, 0.0], 0.08, woodD); // outer prop
  }
  add(root, geo.cyl(0.055, 0.055, 0.78, 8), iron, [0, AY, 0], [0, 0, HALF_PI]);
  // winch at the back
  add(root, geo.cyl(0.08, 0.08, 0.7, 8), woodL, [0, 0.47, -0.62], [0, 0, HALF_PI]);
  for (const s of [1, -1]) {
    add(root, geo.box(0.04, 0.34, 0.04), woodD, [s * 0.3, 0.47, -0.62]);
    add(root, geo.box(0.04, 0.04, 0.34), woodD, [s * 0.3, 0.47, -0.62]);
  }
  // throwing arm
  const holder = grp(root, 0, AY, 0);
  holder.rotation.y = Math.PI;
  const weapon = grp(holder, 0, 0, 0);
  const phi = 2.2; // rest: long end down and to the back (cocked)
  const d = [0, Math.cos(phi), Math.sin(phi)];
  const at = (k) => [0, d[1] * k, d[2] * k];
  const A = at(-0.42), B = at(1.3);
  beam(weapon, A, at(0.5), 0.13, wood);
  beam(weapon, at(0.5), B, 0.085, wood);
  for (const k of [-0.3, 0.25, 0.75]) beam(weapon, at(k - 0.03), at(k + 0.03), 0.145, iron);
  add(weapon, geo.cyl(0.09, 0.09, 0.22, 8), iron, [0, 0, 0], [0, 0, HALF_PI]);
  // counterweight box hanging from the short end (local -Z is the world front)
  const cy = A[1] - 0.33;
  for (const s of [1, -1]) beam(weapon, [s * 0.12, A[1], A[2]], [s * 0.15, cy + 0.15, A[2]], 0.04, iron);
  add(weapon, geo.box(0.42, 0.36, 0.42), woodD, [0, cy, A[2]]);
  add(weapon, geo.box(0.44, 0.05, 0.44), iron, [0, cy + 0.12, A[2]]);
  add(weapon, geo.box(0.44, 0.05, 0.44), iron, [0, cy - 0.12, A[2]]);
  add(weapon, geo.box(0.3, 0.16, 0.02), team, [0, cy, A[2] - 0.215]);
  add(weapon, geo.box(0.3, 0.16, 0.02), team, [0, cy, A[2] + 0.215]);
  add(weapon, geo.dodeca(0.12), mat(P.stoneDark), [0.06, cy + 0.2, A[2]]);
  // sling with a loaded stone hanging from the tip of the long end
  add(weapon, geo.box(0.014, 0.24, 0.014), rope, [0.03, B[1] - 0.12, B[2]]);
  add(weapon, geo.box(0.014, 0.24, 0.014), rope, [-0.03, B[1] - 0.12, B[2]]);
  add(weapon, geo.sphere(0.075, 6, 4), mat(P.leather), [0, B[1] - 0.27, B[2]], null, [1, 0.6, 1.3]);
  add(weapon, geo.dodeca(0.065), mat(P.stone), [0, B[1] - 0.23, B[2]]);
  add(weapon, geo.cone(0.03, 0.08, 4), iron, [0, B[1] + d[1] * 0.04, B[2] + d[2] * 0.04], [phi, 0, 0]);
  // team banner on top of the left frame
  flag(root, 0.31, AY + 0.1, -0.02, tc, { pole: 0.72, w: 0.46, h: 0.3, dir: 1 });
  return { root, parts: { wheels, weapon }, height: 2.4, radius: 1.0 };
}
