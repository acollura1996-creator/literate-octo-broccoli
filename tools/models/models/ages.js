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
  add(g, geo.cyl(0.017, 0.02, 1.62, 5), mat(P.woodLight), [0, 0.41, 0]);
  add(g, geo.box(0.024, 0.13, 0.024), steelD, [0, 1.2, 0]);
  add(g, geo.cone(0.036, 0.2, 4), mat(P.steelLight), [0, 1.36, 0], [0, Math.PI / 4, 0], [1, 1, 0.45]);
  add(g, geo.box(0.012, 0.11, 0.07), team, [0, 1.07, -0.04]); // little team streamer
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

// ===========================================================================
// Empire buildings
// ===========================================================================

/** Thatch courses on a cone/frustum roof (radius rb at y0, rt at y0 + h): raised rings at fractions fs. */
function thatchRings(parent, y0, h, rb, rt, fs, material, t = 0.05) {
  for (const f of fs) {
    const ra = rb + (rt - rb) * f, rbb = rb + (rt - rb) * Math.max(0, f - t / h);
    add(parent, geo.cyl(ra + 0.025, rbb + 0.03, t, 12), material, [0, y0 + h * f - t / 2, 0]);
  }
}

/** Pile of logs lying along X: rows = [n bottom, n next, ...]. Cut ends get pale discs. */
function logPile(parent, key, x, y, z, rows, { len = 1.0, r = 0.11, ry = 0 } = {}) {
  const logs = [], ends = [];
  rows.forEach((n, j) => {
    for (let i = 0; i < n; i++) {
      const lz = (i - (n - 1) / 2) * r * 2.02;
      const ly = r + j * r * 1.75;
      logs.push([r, r, len, 0, ly, lz, 0, HALF_PI, 7]);
      for (const s of [1, -1]) ends.push([r * 0.8, r * 0.8, 0.012, (s * len) / 2, ly, lz, 0, HALF_PI, 7]);
    }
  });
  const g = grp(parent, x, y, z, ry);
  add(g, mergedCyls(`logs:${key}`, logs), mat(0x7a4e28));
  add(g, mergedCyls(`logEnds:${key}`, ends), mat(0xd9b27a));
  return g;
}

/** Small pennant on a pole. Origin at the pole base. */
function pennantPole(parent, x, y, z, color, { h = 1.2, w = 0.34, ph = 0.2, poleColor = P.woodDark, ry = 0 } = {}) {
  const g = grp(parent, x, y, z, ry);
  add(g, geo.cyl(0.022, 0.028, h, 5), mat(poleColor), [0, h / 2, 0]);
  add(g, CG.pennant(), mat(color), [0.01, h - ph / 2 - 0.03, 0], null, [w, ph, 0.02]);
  return g;
}

// Tribal hut: round wattle-and-daub hut, conical thatch with a smoking smoke hole, team pennant.
export function house_1(tc) {
  const root = new THREE.Group();
  const wattle = mat(0x9c7b4f), wattleD = mat(0x6b4f30), daub = mat(0xc4a476), thatch = mat(P.thatch), thatchD = mat(P.thatchDark);
  add(root, geo.cyl(0.9, 0.94, 0.05, 14), mat(0x8a6a44), [0, 0.025, 0]); // trodden earth
  const wy = 0.05, wh = 0.6, wr = 0.6;
  add(root, geo.cyl(wr, wr + 0.03, wh, 12), wattle, [0, wy + wh / 2, 0]);
  for (const y of [0.18, 0.34, 0.5]) add(root, geo.cyl(wr + 0.012, wr + 0.016, 0.045, 12), wattleD, [0, wy + y, 0]);
  const stakes = [];
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) / 12) * Math.PI * 2;
    stakes.push([0.025, 0.03, wh + 0.04, Math.sin(a) * (wr + 0.025), wy + wh / 2, Math.cos(a) * (wr + 0.025), 0, 0, 5]);
  }
  add(root, mergedCyls('hutStakes', stakes), wattleD);
  add(root, mergedBoxes('hutDaub', [
    [0.22, 0.14, 0.04, Math.sin(2.2) * 0.615, 0.3, Math.cos(2.2) * 0.615, 2.2],
    [0.18, 0.12, 0.04, Math.sin(-1.2) * 0.615, 0.45, Math.cos(-1.2) * 0.615, -1.2],
    [0.2, 0.1, 0.04, Math.sin(0.75) * 0.62, 0.22, Math.cos(0.75) * 0.62, 0.75],
  ]), daub);
  // door: dark opening with a hide flap, timber lintel
  add(root, geo.box(0.32, 0.44, 0.08), mat(0x1f1810), [0, wy + 0.22, wr - 0.01]);
  add(root, geo.box(0.42, 0.06, 0.1), mat(P.woodDark), [0, wy + 0.47, wr]);
  for (const s of [1, -1]) add(root, geo.box(0.05, 0.46, 0.06), mat(P.woodDark), [s * 0.18, wy + 0.23, wr + 0.01]);
  add(root, geo.box(0.17, 0.4, 0.02), mat(P.leather), [0.075, wy + 0.23, wr + 0.045], [0, 0, 0.08]);
  // conical thatch roof (truncated: smoke hole at the top)
  const ry = 0.6, rh = 0.76, rb = 0.92, rt = 0.12;
  add(root, geo.cyl(rt, rb, rh, 12), thatch, [0, ry + rh / 2, 0]);
  thatchRings(root, ry, rh, rb, rt, [0.06, 0.38, 0.7], thatchD);
  add(root, geo.cyl(0.095, 0.1, 0.03, 8), mat(0x1f1810), [0, ry + rh + 0.005, 0]);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    rod(root, [Math.sin(a) * 0.04, ry + rh - 0.2, Math.cos(a) * 0.04], [Math.sin(a) * 0.16, ry + rh + 0.2, Math.cos(a) * 0.16], 0.02, mat(P.woodDark), 5);
  }
  // smoke wisp (slowly turns and bobs)
  const smoke = grp(root, 0, 0, 0);
  const sm = mat(0xb9b6ae, { transparent: true, opacity: 0.55 });
  for (const [x, y, z, s] of [[0.03, 1.42, 0, 0.085], [-0.05, 1.51, 0.03, 0.07], [0.02, 1.59, -0.04, 0.055]]) {
    add(smoke, geo.ico(s, 0), sm, [x, y, z]).castShadow = false;
  }
  // yard: firewood, clay pots, a drying rack with a hide, team pennant
  logPile(root, 'hut', -0.66, 0.05, 0.5, [3, 2], { len: 0.42, r: 0.06, ry: 0.5 });
  add(root, geo.sphere(0.09, 7, 5), mat(0xa0522d), [0.52, 0.12, 0.62], null, [1, 0.85, 1]);
  add(root, geo.sphere(0.065, 7, 5), mat(0x8a4523), [0.66, 0.1, 0.5], null, [1, 0.85, 1]);
  const rk = grp(root, 0.5, 0.05, -0.68, -0.6);
  for (const s of [1, -1]) add(rk, geo.box(0.04, 0.55, 0.04), mat(P.woodDark), [s * 0.22, 0.275, 0]);
  add(rk, geo.box(0.52, 0.04, 0.04), mat(P.woodDark), [0, 0.53, 0]);
  add(rk, geo.box(0.32, 0.36, 0.02), mat(0xb08050), [0, 0.33, 0.01]);
  pennantPole(root, -0.62, 0.05, -0.55, tc, { h: 1.3, w: 0.36, ph: 0.22 });
  return { root, parts: { spin: [smoke], bob: [smoke] }, height: 1.6, radius: 0.95 };
}

// Feudal cottage: cream timber-frame walls, thatched gable roof with team trim, chimney, little yard.
export function house_2(tc) {
  const root = new THREE.Group();
  const hz = -0.2;
  add(root, geo.box(1.52, 0.14, 1.12), mat(P.stoneDark), [0, 0.07, hz]);
  timberWalls(root, 0, 0.14, hz, 1.42, 0.74, 1.02, { plaster: 0xf3e6c4 });
  gableRoof(root, 0, 0.88, hz, 1.72, 1.38, 0.86, P.thatch, tc, { rows: 3 });
  add(root, geo.box(0.24, 1.12, 0.24), mat(P.stoneDark), [-0.48, 0.88 + 0.4, hz - 0.3]);
  add(root, geo.box(0.3, 0.08, 0.3), mat(P.stone), [-0.48, 1.88, hz - 0.3]);
  const front = hz + 0.51;
  door(root, 0.3, 0.14, front, 0.28, 0.42, { frame: P.woodDark });
  windowPane(root, -0.3, 0.56, front, 0.2, 0.2);
  for (const s of [1, -1]) add(root, geo.box(0.08, 0.23, 0.03), mat(tc), [-0.3 + s * 0.15, 0.56, front + 0.01]); // shutters
  for (const s of [1, -1]) windowPane(root, s * 0.71, 0.56, hz, 0.18, 0.18, { ry: s * HALF_PI });
  add(root, geo.box(1.0, 0.06, 0.02), mat(tc), [0, 0.86, front + 0.03]); // team eave board
  // yard: stepping stones, wattle fence with a gap, water barrel, bench, woodpile
  add(root, mergedBoxes('cottagePath', [[0.2, 0.03, 0.16, 0.3, 0.015, 0.45], [0.18, 0.03, 0.15, 0.25, 0.015, 0.66], [0.2, 0.03, 0.16, 0.32, 0.015, 0.86]]), mat(P.stone));
  add(root, mergedBoxes('cottageFence', [
    ...[-0.9, -0.62, -0.34, -0.06].map((x) => [0.05, 0.3, 0.05, x, 0.15, 0.9]),
    ...[0.62, 0.9].map((x) => [0.05, 0.3, 0.05, x, 0.15, 0.9]),
    [0.88, 0.05, 0.03, -0.48, 0.24, 0.9], [0.88, 0.05, 0.03, -0.48, 0.12, 0.9],
    [0.32, 0.05, 0.03, 0.76, 0.24, 0.9], [0.32, 0.05, 0.03, 0.76, 0.12, 0.9],
    [0.03, 0.05, 0.6, 0.9, 0.24, 0.62], [0.03, 0.05, 0.6, -0.9, 0.24, 0.62],
  ]), mat(P.woodLight));
  add(root, geo.cyl(0.13, 0.13, 0.3, 8), mat(P.wood), [0.72, 0.15, 0.48]);
  add(root, geo.cyl(0.135, 0.135, 0.03, 8), mat(P.iron), [0.72, 0.24, 0.48]);
  add(root, geo.cyl(0.11, 0.11, 0.02, 8), mat(0x3a6aa0), [0.72, 0.3, 0.48]);
  add(root, mergedBoxes('cottageBench', [[0.42, 0.04, 0.12, 0, 0.18, 0], [0.04, 0.18, 0.1, -0.17, 0.09, 0], [0.04, 0.18, 0.1, 0.17, 0.09, 0]]), mat(P.woodLight), [-0.42, 0, 0.5]);
  logPile(root, 'cottage', -0.82, 0.0, -0.05, [2, 1], { len: 0.5, r: 0.07, ry: HALF_PI });
  // vegetable patch
  add(root, geo.box(0.42, 0.04, 0.22), mat(0x6e4a2a), [-0.5, 0.02, 0.74]);
  add(root, mergedBoxes('cottageVeg', [0, 1, 2, 3].map((i) => [0.07, 0.08, 0.07, -0.15 + i * 0.1, 0.06, 0])), mat(0x6cb33e), [-0.5, 0, 0.74]);
  return { root, parts: {}, height: 2.0, radius: 0.95 };
}

// Kingdom townhouse: two storeys, stone ground floor, jettied timber upper floor, slate roof, team banner.
export function house_3(tc) {
  const root = new THREE.Group();
  const hz = -0.14;
  add(root, geo.box(1.62, 0.1, 1.34), mat(P.stoneDark), [0, 0.05, hz]);
  add(root, geo.box(1.46, 0.78, 1.16), mat(P.stone), [0, 0.1 + 0.39, hz]);
  // quoins
  const qs = [];
  for (const sx of [1, -1]) for (const sz of [1, -1]) for (let i = 0; i < 3; i++) {
    const y = 0.22 + i * 0.25, long = i % 2 === 0;
    qs.push([long ? 0.2 : 0.12, 0.12, long ? 0.12 : 0.2, sx * (0.73 - (long ? 0.09 : 0.05)), y, sz * (0.58 - (long ? 0.05 : 0.09))]);
  }
  add(root, mergedBoxes('townQuoins', qs.map(([w, h, d, x, y, z]) => [w + 0.01, h, d + 0.01, x, y, z])), mat(P.stoneLight), [0, 0, hz]);
  add(root, geo.box(1.52, 0.07, 1.22), mat(P.stoneDark), [0, 0.89, hz]);
  // jettied timber upper floor + joist ends
  timberWalls(root, 0, 0.92, hz, 1.56, 0.72, 1.28, { plaster: 0xf1e4c4 });
  add(root, mergedBoxes('townJoists', [-0.6, -0.36, -0.12, 0.12, 0.36, 0.6].map((x) => [0.06, 0.06, 0.08, x, 0, 0])), mat(P.woodDark), [0, 0.9, hz + 0.62]);
  gableRoof(root, 0, 1.64, hz, 1.78, 1.5, 0.86, P.slate, tc, { rows: 4, rowColor: 0x6d7c9a });
  add(root, geo.box(0.26, 1.0, 0.26), mat(P.stoneDark), [0.5, 1.64 + 0.36, hz - 0.32]);
  add(root, geo.box(0.32, 0.08, 0.32), mat(P.stone), [0.5, 2.5, hz - 0.32]);
  // front: door, shop window, striped team awning, upper windows with flower boxes, banner
  const front = hz + 0.58, front2 = hz + 0.64;
  door(root, -0.32, 0.1, front, 0.3, 0.5, { frame: P.stoneDark });
  windowPane(root, 0.3, 0.45, front, 0.42, 0.26, { frame: P.woodDark });
  const aw = grp(root, 0.0, 0.8, front + 0.15);
  aw.rotation.x = 0.45;
  for (let i = 0; i < 6; i++) add(aw, geo.box(0.19, 0.03, 0.34), i % 2 ? mat(P.linen) : mat(tc), [-0.475 + i * 0.19, 0, 0]);
  for (const x of [-0.48, 0.48]) {
    windowPane(root, x, 1.3, front2, 0.18, 0.24);
    add(root, geo.box(0.26, 0.06, 0.08), mat(P.woodDark), [x, 1.16, front2 + 0.04]);
    add(root, mergedBoxes('flowers3', [[0.05, 0.05, 0.05, -0.08, 0, 0], [0.05, 0.05, 0.05, 0, 0.01, 0], [0.05, 0.05, 0.05, 0.08, 0, 0]]), mat(0xe8384a), [x, 1.21, front2 + 0.05]);
  }
  banner(root, 0, 1.6, front2 + 0.02, tc, { w: 0.24, h: 0.42 });
  for (const s of [1, -1]) {
    windowPane(root, s * 0.73, 0.5, hz, 0.16, 0.22, { ry: s * HALF_PI });
    windowPane(root, s * 0.79, 1.3, hz, 0.16, 0.22, { ry: s * HALF_PI });
  }
  // stoop, barrels, crate
  add(root, geo.box(0.42, 0.06, 0.2), mat(P.stoneLight), [-0.32, 0.03, front + 0.12]);
  add(root, geo.cyl(0.12, 0.12, 0.28, 8), mat(P.wood), [0.78, 0.14, 0.72]);
  add(root, geo.cyl(0.1, 0.1, 0.24, 8), mat(P.wood), [0.56, 0.12, 0.82]);
  add(root, geo.box(0.24, 0.24, 0.24), mat(P.woodLight), [-0.8, 0.12, 0.74], [0, 0.4, 0]);
  return { root, parts: {}, height: 2.6, radius: 0.95 };
}

// Imperial manor: dressed pale stone, red tile roof with team trim, columned porch, corner turret + flag.
export function house_4(tc) {
  const root = new THREE.Group();
  const ashM = mat(0xe2dccd), ashD = mat(0xb9b1a0), marble = mat(P.marble), gold = mat(P.gold);
  add(root, geo.box(1.88, 0.1, 1.88), ashD, [0, 0.05, 0]);
  add(root, geo.box(1.72, 0.1, 1.72), ashM, [0, 0.15, 0]);
  const b = 0.2, hz = -0.28;
  add(root, geo.box(1.34, 1.42, 1.08), ashM, [0, b + 0.71, hz]);
  add(root, geo.box(1.38, 0.1, 1.12), ashD, [0, b + 0.05, hz]);
  add(root, geo.box(1.38, 0.06, 1.12), ashD, [0, b + 0.72, hz]);
  add(root, geo.box(1.42, 0.1, 1.16), ashD, [0, b + 1.42, hz]);
  add(root, geo.box(1.43, 0.025, 1.17), gold, [0, b + 1.37, hz]);
  gableRoof(root, 0, b + 1.47, hz, 1.5, 1.24, 0.68, 0xb4532a, tc, { rows: 4, rowColor: 0x8a3a1c });
  add(root, geo.box(0.22, 0.6, 0.22), ashD, [0.45, b + 1.9, hz - 0.3]); // chimney
  // tall windows with pale frames and gold keystones
  const front = hz + 0.54;
  for (const x of [-0.45, 0.45]) {
    for (const y of [b + 0.4, b + 1.06]) {
      windowPane(root, x, y, front, 0.16, 0.32, { frame: P.marble, pane: 0x25304a });
      add(root, geo.box(0.06, 0.06, 0.03), gold, [x, y + 0.2, front + 0.02], [0, 0, Math.PI / 4]);
    }
  }
  for (const s of [1, -1]) for (const z of [hz - 0.25, hz + 0.25]) windowPane(root, s * 0.67, b + 1.06, z, 0.14, 0.3, { ry: s * HALF_PI, frame: P.marble, pane: 0x25304a });
  // columned porch with a pediment
  const pz = 0.5;
  add(root, geo.box(0.86, 0.06, 0.5), marble, [0, b + 0.03, pz - 0.04]);
  door(root, 0, b, front, 0.3, 0.55, { frame: P.marble, color: 0x5a3018 });
  for (const x of [-0.3, 0.3]) {
    add(root, geo.box(0.13, 0.06, 0.13), marble, [x, b + 0.09, pz + 0.1]);
    add(root, geo.cyl(0.055, 0.065, 0.86, 8), marble, [x, b + 0.55, pz + 0.1]);
    add(root, geo.box(0.13, 0.05, 0.13), gold, [x, b + 1.0, pz + 0.1]);
  }
  add(root, geo.box(0.78, 0.1, 0.48), marble, [0, b + 1.07, pz - 0.04]);
  add(root, CG.gable(), marble, [0, b + 1.12, pz - 0.04], [0, HALF_PI, 0], [0.48, 0.28, 0.78]);
  add(root, CG.gable(), mat(tc), [0, b + 1.123, pz + 0.205], [0, HALF_PI, 0], [0.02, 0.2, 0.56]); // team tympanum
  add(root, geo.cyl(0.05, 0.05, 0.02, 8), gold, [0, b + 1.2, pz + 0.22], [HALF_PI, 0, 0]);
  // corner turret (front right) with a team cone roof and flag
  const tx = -0.66, tzz = hz + 0.54;
  add(root, geo.cyl(0.25, 0.27, 2.05, 10), ashM, [tx, b + 1.025, tzz]);
  add(root, geo.cyl(0.3, 0.27, 0.12, 10), ashD, [tx, b + 2.05, tzz]);
  add(root, geo.cyl(0.275, 0.275, 0.03, 10), gold, [tx, b + 1.98, tzz]);
  add(root, geo.cone(0.32, 0.55, 10), mat(tc), [tx, b + 2.11 + 0.275, tzz]);
  for (const a of [0.4, -1.0]) windowPane(root, tx + Math.sin(a) * 0.26, b + 1.55, tzz + Math.cos(a) * 0.26, 0.09, 0.22, { ry: a, frame: P.marble, pane: 0x25304a });
  flag(root, tx, b + 2.44, tzz, tc, { pole: 0.34, w: 0.34, h: 0.2, dir: 1 });
  // garden: topiaries and urns
  for (const [x, z] of [[0.74, 0.72], [-0.74, 0.74]]) {
    add(root, geo.box(0.16, 0.12, 0.16), ashD, [x, b + 0.06, z]);
    add(root, geo.cone(0.12, 0.36, 6), mat(P.leaf), [x, b + 0.3, z]);
  }
  add(root, geo.cyl(0.08, 0.05, 0.14, 8), ashD, [0.42, b + 0.07, 0.8]);
  add(root, geo.cyl(0.08, 0.05, 0.14, 8), ashD, [-0.42, b + 0.07, 0.8]);
  return { root, parts: {}, height: 3.0, radius: 0.95 };
}

// Lumber yard: open timber shed, log piles, plank stacks, sawhorse, big circular saw (spins), axe in a stump.
export function lumberyard(tc) {
  const root = new THREE.Group();
  const wood = mat(P.wood), woodD = mat(P.woodDark), woodL = mat(P.woodLight), iron = mat(P.iron);
  add(root, geo.box(2.8, 0.04, 2.8), mat(0xae8a5c), [0, 0.02, 0]); // sawdust yard
  // open shed across the back
  const sz = -0.7, b = 0.04;
  for (const x of [-1.24, 0, 1.24]) for (const z of [sz + 0.56, sz - 0.56]) add(root, geo.box(0.12, 1.36, 0.12), woodD, [x, b + 0.68, z]);
  for (const z of [sz + 0.56, sz - 0.56]) add(root, geo.box(2.6, 0.1, 0.12), woodD, [0, b + 1.36, z]);
  for (const x of [-1.24, 1.24]) for (const z of [sz + 0.56, sz - 0.56]) beam(root, [x, b + 1.0, z], [x * 0.75, b + 1.33, z], 0.06, woodD);
  gableRoof(root, 0, b + 1.41, sz, 2.76, 1.36, 0.6, 0xa0703c, tc, { rows: 4, rowColor: 0x6e4a24 });
  // under the shed: sorted planks and seasoning logs
  const planks = [];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 4; i++) planks.push([0.95, 0.045, 0.15, 0, 0.03 + j * 0.065, -0.24 + i * 0.16]);
  for (let j = 0; j < 4; j++) for (const x of [-0.4, 0, 0.4]) planks.push([0.05, 0.02, 0.62, x, 0.06 + j * 0.065, 0]); // stickers
  add(root, mergedBoxes('lyPlanks', planks), mat(0xd2a66a), [0.58, b, sz]);
  logPile(root, 'lyShed', -0.6, b, sz, [4, 3, 2], { len: 1.0, r: 0.1 });
  // big log pile in the front-left yard (logs along Z)
  logPile(root, 'lyYard', -0.92, b, 0.62, [4, 3, 2, 1], { len: 1.2, r: 0.125, ry: HALF_PI });
  // circular saw bench (front right): blade turns about the world Z axis, so it faces the camera
  const bx = 0.72, bz = 0.66, top = 0.56;
  for (const sx of [1, -1]) for (const sz2 of [1, -1]) add(root, geo.box(0.06, top, 0.06), woodD, [bx + sx * 0.5, b + top / 2, bz + sz2 * 0.17]);
  add(root, geo.box(1.12, 0.06, 0.42), wood, [bx, b + top, bz]);
  add(root, geo.box(1.0, 0.05, 0.05), woodD, [bx, b + 0.18, bz - 0.17]);
  add(root, geo.cyl(0.11, 0.11, 0.7, 7), mat(0x7a4e28), [bx - 0.22, b + top + 0.14, bz + 0.02], [0, 0, HALF_PI]); // log being cut
  add(root, geo.cyl(0.09, 0.09, 0.012, 7), mat(0xd9b27a), [bx + 0.13, b + top + 0.14, bz + 0.02], [0, 0, HALF_PI]);
  const axle = grp(root, bx + 0.25, b + top + 0.02, bz);
  axle.rotation.x = HALF_PI;
  const saw = grp(axle, 0, 0, 0);
  const R = 0.38;
  add(saw, geo.cyl(R, R, 0.022, 20), mat(0xd6dce4), [0, 0, 0]);
  const teeth = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    teeth.push([0.06, 0.02, 0.07, Math.sin(a) * (R + 0.015), 0, Math.cos(a) * (R + 0.015), a + 0.5]);
  }
  add(saw, mergedBoxes('sawTeeth18', teeth), mat(P.steel));
  add(saw, geo.cyl(0.08, 0.08, 0.05, 8), iron, [0, 0, 0]);
  add(saw, mergedBoxes('sawMarks', [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2;
    return [0.05, 0.03, 0.14, Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2, a];
  })), mat(P.steelDark));
  add(root, geo.box(0.12, 0.2, 0.08), iron, [bx + 0.25, b + 0.34, bz - 0.1]); // bearing
  add(root, geo.cyl(0.035, 0.035, 0.3, 6), iron, [bx + 0.25, b + top + 0.02, bz - 0.08], [HALF_PI, 0, 0]);
  // sawhorse with a log, axe in a chopping stump
  const sh = grp(root, 0.12, b, 0.2, 0.15);
  for (const s of [1, -1]) {
    add(sh, geo.box(0.05, 0.5, 0.05), woodD, [s * 0.32, 0.22, 0.08], [0.35, 0, 0]);
    add(sh, geo.box(0.05, 0.5, 0.05), woodD, [s * 0.32, 0.22, -0.08], [-0.35, 0, 0]);
  }
  add(sh, geo.box(0.8, 0.06, 0.06), woodD, [0, 0.44, 0]);
  add(sh, geo.cyl(0.1, 0.1, 0.9, 7), mat(0x7a4e28), [0, 0.56, 0], [0, 0, HALF_PI]);
  add(root, geo.cyl(0.2, 0.23, 0.32, 8), mat(0x6a4426), [-0.12, b + 0.16, 1.08]);
  add(root, geo.cyl(0.18, 0.18, 0.02, 8), mat(0xd0a870), [-0.12, b + 0.325, 1.08]);
  rod(root, [-0.06, b + 0.33, 1.06], [0.14, b + 0.72, 1.16], 0.02, mat(P.woodLight), 5);
  add(root, CG.axeHead(), mat(P.steelDark), [-0.05, b + 0.36, 1.06], [0.0, 1.1, -0.5], 0.3);
  add(root, mergedBoxes('lyChips', [[0.06, 0.02, 0.04, 0.12, 0.01, 0.12, 0.4], [0.05, 0.02, 0.03, -0.2, 0.01, 0.2, 1.2], [0.06, 0.02, 0.03, 0.22, 0.01, -0.1, 2.0]]), woodL, [-0.12, b, 1.08]);
  // team banner on the shed front, team flag on the yard corner
  banner(root, 0, b + 1.28, sz + 0.63, tc, { w: 0.4, h: 0.45 });
  flag(root, -1.3, b, 1.3, tc, { pole: 2.15, w: 0.5, h: 0.32, dir: 1 });
  return { root, parts: { spin: [saw] }, height: 2.4, radius: 1.45 };
}

/** Standing (grazing) horse prop, origin at ground, facing +Z. */
function horseProp(parent, x, z, ry, coatColor, darkColor, graze = true) {
  const g = grp(parent, x, 0, z, ry);
  const coat = mat(coatColor), dark = mat(darkColor);
  add(g, mergedBoxes('horsePropLegs', [
    [0.08, 0.5, 0.09, 0.1, 0.25, 0.3], [0.08, 0.5, 0.09, -0.1, 0.25, 0.3],
    [0.08, 0.5, 0.09, 0.1, 0.25, -0.3], [0.08, 0.5, 0.09, -0.1, 0.25, -0.3],
  ]), coat);
  add(g, mergedBoxes('horsePropHooves', [
    [0.085, 0.05, 0.1, 0.1, 0.025, 0.31], [0.085, 0.05, 0.1, -0.1, 0.025, 0.31],
    [0.085, 0.05, 0.1, 0.1, 0.025, -0.29], [0.085, 0.05, 0.1, -0.1, 0.025, -0.29],
  ]), mat(0x2e221a));
  add(g, geo.box(0.28, 0.28, 0.78), coat, [0, 0.62, 0]);
  if (graze) {
    add(g, geo.box(0.13, 0.4, 0.17), coat, [0, 0.5, 0.45], [-0.75, 0, 0]);
    horseHead(g, 0, 0.24, 0.62, { coat, dark, tilt: 1.25 });
  } else {
    add(g, geo.box(0.13, 0.4, 0.17), coat, [0, 0.82, 0.4], [0.55, 0, 0]);
    horseHead(g, 0, 0.98, 0.58, { coat, dark });
  }
  add(g, geo.box(0.05, 0.3, 0.06), dark, [0, 0.82, 0.3], [graze ? -0.75 : 0.55, 0, 0]);
  add(g, geo.box(0.06, 0.32, 0.06), dark, [0, 0.52, -0.43], [-0.35, 0, 0]);
  return g;
}

// Stable: long timber stable with three stalls (horses looking out), hay, paddock fence, team banners.
export function stable(tc) {
  const root = new THREE.Group();
  const woodD = mat(P.woodDark), woodL = mat(P.woodLight), hay = mat(P.thatch), hayD = mat(P.thatchDark);
  const bz = -0.72, W = 2.6, D = 1.06;
  add(root, geo.box(W + 0.14, 0.12, D + 0.14), mat(P.stoneDark), [0, 0.06, bz]);
  timberWalls(root, 0, 0.12, bz, W, 0.95, D, { plaster: 0xb07c46, braces: false });
  add(root, mergedBoxes('stablePlanks', [-1.1, -0.7, -0.3, 0.3, 0.7, 1.1].map((x) => [0.025, 0.85, 0.02, x, 0.55, D / 2 + 0.005])), woodD, [0, 0, bz]);
  gableRoof(root, 0, 1.07, bz, 2.76, 1.34, 0.78, P.thatch, tc, { rows: 4 });
  // cupola + weathervane on the ridge
  add(root, geo.box(0.34, 0.3, 0.34), woodL, [0, 1.92, bz]);
  add(root, geo.box(0.22, 0.14, 0.36), mat(0x2a1f18), [0, 1.93, bz]);
  add(root, CG.pyramid(), mat(tc), [0, 2.07, bz], null, [0.46, 0.26, 0.46]);
  add(root, geo.cyl(0.012, 0.012, 0.24, 4), mat(P.iron), [0, 2.42, bz]);
  add(root, geo.box(0.2, 0.08, 0.015), mat(P.iron), [0.03, 2.5, bz]);
  // three stalls with dutch doors, two horses looking out
  const front = bz + D / 2;
  const coats = [[0x7a4a2a, 0x3a2414], null, [0xe8e2d6, 0x9a948a]];
  [-0.86, 0, 0.86].forEach((x, i) => {
    add(root, geo.box(0.56, 0.72, 0.06), mat(0x1c1610), [x, 0.12 + 0.36, front]);
    add(root, geo.box(0.62, 0.06, 0.08), woodD, [x, 0.12 + 0.75, front + 0.01]);
    add(root, geo.box(0.54, 0.38, 0.06), woodL, [x, 0.12 + 0.19, front + 0.03]);
    add(root, geo.box(0.6, 0.04, 0.05), woodD, [x, 0.12 + 0.4, front + 0.05]);
    beam(root, [x - 0.24, 0.16, front + 0.065], [x + 0.24, 0.46, front + 0.065], 0.04, woodD, 0.02);
    if (coats[i]) {
      const [c, dk] = coats[i];
      add(root, geo.box(0.14, 0.32, 0.2), mat(c), [x, 0.62, front + 0.02], [0.45, 0, 0]);
      add(root, geo.box(0.05, 0.3, 0.06), mat(dk), [x, 0.68, front - 0.05], [0.45, 0, 0]);
      horseHead(root, x, 0.74, front + 0.2, { coat: mat(c), dark: mat(dk), tilt: 0.7, blaze: i === 2 ? null : mat(0xeee6d8) });
    }
  });
  for (const s of [1, -1]) banner(root, s * 0.43, 1.03, front + 0.05, tc, { w: 0.22, h: 0.42 });
  // hay loft hatch on the side gable with hay spilling out
  add(root, geo.box(0.04, 0.3, 0.36), mat(0x1c1610), [W / 2 + 0.01, 1.3, bz]);
  add(root, geo.box(0.12, 0.08, 0.32), hay, [W / 2 + 0.05, 1.18, bz], [0, 0, -0.3]);
  // paddock fence in front (gap toward the front), hay bales, water trough, a grazing horse
  const fz0 = -0.12, fz1 = 1.32, fx = 1.32;
  const fence = [];
  for (const z of [0.25, 0.65, 1.0, fz1]) for (const s of [1, -1]) fence.push([0.06, 0.42, 0.06, s * fx, 0.21, z]);
  for (const x of [-0.9, -0.45, 0.45, 0.9]) fence.push([0.06, 0.42, 0.06, x, 0.21, fz1]);
  for (const y of [0.3, 0.16]) {
    for (const s of [1, -1]) fence.push([0.035, 0.045, fz1 - fz0 - 0.06, s * fx, y, (fz0 + fz1) / 2 + 0.03]);
    for (const s of [1, -1]) fence.push([0.92, 0.045, 0.035, s * 0.88, y, fz1]);
  }
  add(root, mergedBoxes('stableFence', fence), woodL);
  const bales = [[0.4, 0.22, 0.26, -1.0, 0.11, 0.2, 0.1], [0.4, 0.22, 0.26, -1.0, 0.11, 0.48, -0.05], [0.4, 0.22, 0.26, -0.98, 0.33, 0.34, 0.2]];
  add(root, mergedBoxes('stableBales', bales), hay);
  add(root, mergedBoxes('stableBaleTies', bales.flatMap(([, h, d, x, y, z, r]) => [[0.03, h + 0.01, d + 0.01, x - 0.1, y, z, r], [0.03, h + 0.01, d + 0.01, x + 0.1, y, z, r]])), hayD);
  add(root, geo.cone(0.28, 0.32, 7), hay, [-0.5, 0.16, 0.12]);
  add(root, geo.box(0.62, 0.18, 0.22), mat(P.wood), [0.72, 0.09, 0.2]);
  add(root, geo.box(0.54, 0.02, 0.15), mat(0x3a6aa0), [0.72, 0.17, 0.2]);
  horseProp(root, 0.35, 0.85, -1.1, 0x9a6234, 0x3e2412, true);
  return { root, parts: {}, height: 2.6, radius: 1.45 };
}

// Imperial Palace: marble terraces, colonnaded hall with a great golden dome, two slender minarets with
// golden onion domes, front pavilions with team cone roofs, team banners and flags.
export function palace(tc) {
  const root = new THREE.Group();
  const marble = mat(P.marble), marbleD = mat(0xd3ccbc), marbleS = mat(0xb8b0a0), gold = mat(P.gold), goldD = mat(P.goldDark);
  const team = mat(tc), win = mat(0x2a3446);
  // terraces + grand stair
  add(root, geo.box(3.8, 0.16, 3.8), marbleS, [0, 0.08, 0]);
  add(root, geo.box(3.6, 0.14, 3.6), marbleD, [0, 0.23, 0]);
  add(root, geo.box(3.62, 0.03, 3.62), team, [0, 0.285, 0]);
  add(root, geo.box(3.56, 0.05, 3.56), marble, [0, 0.325, 0]);
  const b = 0.35;
  for (let i = 0; i < 3; i++) add(root, geo.box(1.3 - i * 0.08, 0.1, 0.16), marble, [0, 0.05 + i * 0.1, 1.82 - i * 0.12]);
  // main hall
  const hz = -0.2;
  add(root, geo.box(2.5, 1.85, 1.9), marble, [0, b + 0.925, hz]);
  add(root, geo.box(2.56, 0.08, 1.96), gold, [0, b + 0.95, hz]);
  add(root, geo.box(2.62, 0.12, 2.02), marbleD, [0, b + 1.85, hz]);
  add(root, crenRectGeo(2.6, 2.0, 9, 0.1, 0.16), marble, [0, b + 1.91, hz]);
  const wins = [];
  for (const x of [-0.95, -0.6, 0.6, 0.95]) for (const y of [b + 0.45, b + 1.35]) wins.push([0.16, 0.38, 0.04, x, y, 0]);
  add(root, mergedBoxes('palWinFront', wins), win, [0, 0, hz + 0.95]);
  add(root, mergedBoxes('palWinSide', [-0.55, 0, 0.55].flatMap((z) => [[0.04, 0.38, 0.16, 1.25, b + 1.35, z], [0.04, 0.38, 0.16, -1.25, b + 1.35, z]])), win, [0, 0, hz]);
  add(root, mergedBoxes('palArchCaps', [-0.95, -0.6, 0.6, 0.95].flatMap((x) => [[0.2, 0.05, 0.05, x, b + 0.66, 0], [0.2, 0.05, 0.05, x, b + 1.56, 0]])), gold, [0, 0, hz + 0.96]);
  // front portico: six columns, entablature, team pediment roof
  const pz = 1.02;
  add(root, geo.box(2.0, 0.08, 0.52), marble, [0, b + 0.04, pz - 0.08]);
  for (let i = 0; i < 6; i++) {
    const x = -0.85 + i * 0.34;
    add(root, geo.box(0.16, 0.08, 0.16), marbleD, [x, b + 0.12, pz]);
    add(root, geo.cyl(0.065, 0.075, 1.36, 8), marble, [x, b + 0.84, pz]);
    add(root, geo.box(0.17, 0.07, 0.17), gold, [x, b + 1.55, pz]);
  }
  door(root, 0, b, hz + 0.95, 0.42, 0.8, { frame: P.gold, color: 0x5a3018 });
  add(root, geo.box(2.04, 0.18, 0.54), marbleD, [0, b + 1.67, pz - 0.08]);
  add(root, geo.box(2.06, 0.04, 0.56), gold, [0, b + 1.6, pz - 0.08]);
  add(root, CG.gable(), team, [0, b + 1.76, pz - 0.08], [0, HALF_PI, 0], [0.56, 0.42, 2.06]);
  add(root, CG.gable(), marble, [0, b + 1.77, pz + 0.2], [0, HALF_PI, 0], [0.02, 0.36, 1.86]);
  add(root, geo.cyl(0.11, 0.11, 0.03, 10), gold, [0, b + 1.9, pz + 0.22], [HALF_PI, 0, 0]);
  for (const s of [1, -1]) banner(root, s * 1.12, b + 1.75, hz + 0.97, tc, { w: 0.24, h: 0.95 });
  // drum + great golden dome + lantern
  const dy = b + 1.91;
  add(root, geo.cyl(0.86, 0.9, 0.72, 16), marble, [0, dy + 0.36, hz]);
  const drumWins = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    drumWins.push([0.12, 0.34, 0.06, Math.sin(a) * 0.85, 0.38, Math.cos(a) * 0.85, a]);
  }
  add(root, mergedBoxes('palDrumWins', drumWins), win, [0, dy, hz]);
  add(root, geo.cyl(0.92, 0.92, 0.08, 16), team, [0, dy + 0.06, hz]);
  add(root, geo.cyl(0.93, 0.9, 0.08, 16), gold, [0, dy + 0.72, hz]);
  add(root, hemi(), gold, [0, dy + 0.74, hz], null, [0.88, 0.95, 0.88]);
  add(root, geo.cyl(0.14, 0.17, 0.3, 8), marble, [0, dy + 1.82, hz]);
  add(root, hemi(), gold, [0, dy + 1.96, hz], null, 0.16);
  add(root, geo.cone(0.05, 0.4, 6), gold, [0, dy + 2.3, hz]);
  add(root, geo.sphere(0.06, 6, 4), gold, [0, dy + 2.5, hz]);
  // two slender rear minarets with gold onion domes and team flags (to ~7)
  for (const s of [1, -1]) {
    const x = s * 1.36, z = -1.3;
    add(root, geo.cyl(0.36, 0.42, 4.2, 12), marble, [x, b + 2.1, z]);
    for (const y of [b + 1.85, b + 3.3]) add(root, geo.cyl(0.44, 0.42, 0.08, 12), gold, [x, y, z]);
    add(root, geo.cyl(0.5, 0.4, 0.16, 12), marbleD, [x, b + 4.25, z]);
    add(root, crenRingGeo(0.45, 10, 0.1, 0.16, 0.08), marble, [x, b + 4.33, z]);
    add(root, geo.cyl(0.26, 0.3, 0.7, 10), marble, [x, b + 4.68, z]);
    add(root, geo.box(0.1, 0.28, 0.04), win, [x, b + 4.7, z + 0.28]);
    add(root, geo.sphere(0.33, 10, 8), gold, [x, b + 5.25, z], null, [1, 1.1, 1]);
    add(root, geo.cone(0.12, 0.5, 8), gold, [x, b + 5.75, z]);
    add(root, geo.sphere(0.05, 6, 4), goldD, [x, b + 6.0, z]);
    flag(root, x, b + 5.95, z, tc, { pole: 0.65, w: 0.52, h: 0.3, dir: s, finial: P.gold });
    add(root, mergedBoxes('minaretWins', [0, 1, 2].map((i) => [0.09, 0.3, 0.04, 0, 0.6 + i * 1.1, 0])), win, [x, b, z + 0.4]);
  }
  // front pavilions with team cone roofs
  for (const s of [1, -1]) {
    const x = s * 1.5, z = 1.18;
    add(root, geo.cyl(0.32, 0.36, 2.55, 10), marble, [x, b + 1.275, z]);
    add(root, geo.cyl(0.37, 0.36, 0.08, 10), gold, [x, b + 1.3, z]);
    add(root, geo.cyl(0.42, 0.35, 0.14, 10), marbleD, [x, b + 2.6, z]);
    add(root, geo.cone(0.42, 1.0, 10), team, [x, b + 2.67 + 0.5, z]);
    add(root, geo.cyl(0.425, 0.425, 0.05, 10), gold, [x, b + 2.7, z]);
    add(root, geo.sphere(0.08, 6, 4), gold, [x, b + 3.72, z]);
    add(root, geo.cone(0.03, 0.22, 4), gold, [x, b + 3.86, z]);
    add(root, geo.box(0.1, 0.32, 0.04), win, [x, b + 1.8, z + 0.33]);
    add(root, geo.box(0.62, 1.2, 0.3), marble, [s * 1.2, b + 0.6, 0.72]); // link wall
    add(root, geo.box(0.64, 0.06, 0.32), gold, [s * 1.2, b + 1.2, 0.72]);
  }
  // golden statues / braziers on the terrace front
  for (const s of [1, -1]) {
    add(root, geo.box(0.22, 0.32, 0.22), marbleD, [s * 0.86, b + 0.16, 1.62]);
    add(root, geo.cyl(0.12, 0.06, 0.12, 8), gold, [s * 0.86, b + 0.38, 1.62]);
    add(root, geo.sphere(0.09, 8, 6), gold, [s * 0.86, b + 0.5, 1.62]);
  }
  return { root, parts: {}, height: 7.0, radius: 1.95 };
}

// ===========================================================================
// Fortifications
// Wall pieces fill their whole 1x1 cell (body boxes are exactly 1 x 1, detail repeats with period 1),
// so pieces placed side by side in any of the 8 directions read as one continuous wall. Battlements
// sit only on the cell corners: two neighbours' corner merlons pair up across the seam into regular
// crenellations, and the walkway between them stays open whichever way the wall runs.
// Gates are 2x2: the wall line runs along X, the passage along Z. parts.doors = [{ obj, side }] with obj
// a Group at the door's hinge; the game sets obj.rotation.y = side * open * 1.4 (both leaves swing to -Z).
// ===========================================================================

const DOOR_PLANK = 0x6e4526, DOOR_IRON = 0x33353b; // door-only materials (see noMerge)
const ASHLAR = 0xd8d2c4, ASHLAR_MORTAR = 0xaaa394, ASHLAR_DARK = 0x8f887a;

/** Sharpened stakes [[x, z, h], ...] (shaft + pale tip), merged under `key`. */
function stakes(parent, key, list, { r = 0.155, tip = 0.26, seg = 7, pos = [0, 0, 0] } = {}) {
  add(parent, mergedCyls(`stakes:${key}`, list.map(([x, z, h]) => [r, r * 1.06, h, x, h / 2, z, 0, 0, seg])), mat(P.wood), pos);
  add(parent, mergedCyls(`stakeTips:${key}`, list.map(([x, z, h]) => [0, r, tip, x, h + tip / 2, z, 0, 0, seg])), mat(P.woodLight), pos);
}

/** Corner merlons of a 1x1 wall cell, base at y=0. */
function cornerMerlons(key, s, h) {
  const o = 0.5 - s / 2;
  return mergedBoxes(`cornerMerlons:${key}`, [[s, h, s, o, h / 2, o], [s, h, s, -o, h / 2, o], [s, h, s, o, h / 2, -o], [s, h, s, -o, h / 2, -o]]);
}

/** Boxes placed on all four faces of a 1x1 cell: list of [w, h, x, y] in face coordinates. */
function onFourFaces(list, t, out = 0.5) {
  const boxes = [];
  const c = out - t / 2 + 0.006; // proud of the face by 0.006
  for (const [w, h, x, y] of list) {
    boxes.push([w, h, t, x, y, c], [w, h, t, -x, y, -c], [t, h, w, c, y, -x], [t, h, w, -c, y, x]);
  }
  return boxes;
}

/** Ashlar block courses (running bond with period 1) for a face spanning x in [x0, x1], y in [y0, y1]. */
function ashlarRows(y0, y1, { x0 = -0.5, x1 = 0.5, rowH = 0.27, skip = null } = {}) {
  const out = [];
  const rows = Math.max(1, Math.round((y1 - y0) / rowH));
  const rh = (y1 - y0) / rows;
  for (let k = 0; k < rows; k++) {
    const y = y0 + rh * (k + 0.5);
    const offset = k % 2 ? 0.25 : 0;
    for (let e = Math.floor(x0 - 1); e <= Math.ceil(x1 + 1); e += 0.5) {
      const a = Math.max(x0, e + offset - 0.25 + 0.01), b = Math.min(x1, e + offset + 0.25 - 0.01);
      if (b - a < 0.06) continue;
      const cx = (a + b) / 2;
      if (skip && skip(cx, y, (b - a) / 2, rh / 2)) continue;
      out.push([b - a, rh - 0.025, cx, y]);
    }
  }
  return out;
}

export function wall_palisade() {
  const root = new THREE.Group();
  add(root, geo.box(1, 0.1, 1), mat(0x7a5a3a), [0, 0.05, 0]); // earth berm
  add(root, geo.box(0.88, 1.12, 0.88), mat(P.woodDark), [0, 0.56, 0]); // packed core (no see-through gaps)
  const H = [[1.36, 1.46, 1.32], [1.44, 1.52, 1.4], [1.34, 1.48, 1.42]];
  const list = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) list.push([(i - 1) * 0.32, (j - 1) * 0.32, H[i][j]]);
  stakes(root, 'wallPal', list);
  // crossbeams lashed around all four sides
  const beams = [];
  for (const s of [1, -1]) {
    beams.push([0.055, 0.055, 1.0, 0, 0.98, s * 0.445, 0, HALF_PI, 6]);
    beams.push([0.055, 0.055, 1.0, s * 0.445, 0.98, 0, HALF_PI, 0, 6]);
  }
  add(root, mergedCyls('wallPalBeams', beams), mat(P.woodDark));
  const ropes = [];
  for (const s of [1, -1]) for (const t of [-0.32, 0, 0.32]) {
    ropes.push([0.06, 0.07, 0.12, t, 0.98, s * 0.443], [0.12, 0.07, 0.06, s * 0.443, 0.98, t]);
  }
  add(root, mergedBoxes('wallPalRopes', ropes), mat(0xcdb98a));
  return { root, parts: {}, height: 1.8, radius: 0.5 };
}

export function wall_stone() {
  const root = new THREE.Group();
  const stone = mat(P.stone), stoneD = mat(P.stoneDark);
  add(root, geo.box(1, 0.26, 1), stoneD, [0, 0.13, 0]);
  add(root, geo.box(1, 1.58, 1), stone, [0, 0.26 + 0.79, 0]);
  add(root, mergedBoxes('wallStoneCourses', [0.62, 1.0, 1.38].map((y) => [1.004, 0.03, 1.004, 0, y, 0])), stoneD);
  add(root, mergedBoxes('wallStoneBlocks', onFourFaces([
    [0.3, 0.16, -0.2, 0.46], [0.26, 0.16, 0.24, 0.81], [0.34, 0.16, -0.08, 1.19], [0.24, 0.16, 0.3, 1.6], [0.22, 0.14, -0.33, 1.6],
  ], 0.03)), mat(0x9b988f));
  add(root, mergedBoxes('wallStoneSlits', onFourFaces([[0.06, 0.26, 0, 1.25]], 0.03)), mat(0x1c1e24));
  add(root, geo.box(1, 0.08, 1), stoneD, [0, 1.88, 0]);
  add(root, cornerMerlons('stone', 0.25, 0.28), stone, [0, 1.92, 0]);
  return { root, parts: {}, height: 2.2, radius: 0.5 };
}

export function wall_fortified(tc) {
  const root = new THREE.Group();
  const ash = mat(ASHLAR), ashD = mat(ASHLAR_DARK), team = mat(tc), gold = mat(P.gold);
  add(root, geo.box(1, 0.32, 1), ashD, [0, 0.16, 0]);
  add(root, geo.box(1, 2.02, 1), mat(ASHLAR_MORTAR), [0, 0.32 + 1.01, 0]);
  add(root, mergedBoxes('wallFortBlocks', onFourFaces(ashlarRows(0.34, 2.08), 0.03)), ash);
  add(root, geo.box(1.006, 0.12, 1.006), team, [0, 2.16, 0]); // team strip (lines up with the gate)
  add(root, geo.box(1.008, 0.025, 1.008), gold, [0, 2.1, 0]);
  add(root, geo.box(1, 0.12, 1), ashD, [0, 2.28, 0]);
  add(root, cornerMerlons('fort', 0.28, 0.4), ash, [0, 2.34, 0]);
  add(root, cornerMerlons('fortCap', 0.29, 0.06), team, [0, 2.74, 0]);
  // heraldic team shields on every face (hidden where a neighbour joins)
  const shields = grp(root, 0, 1.5, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const f = grp(shields, Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5, a);
    add(f, CG.kite(), gold, [0, 0, -0.004], null, [0.26, 0.32, 0.016]);
    add(f, CG.kite(), team, [0, 0, -0.001], null, [0.21, 0.27, 0.016]);
  }
  return { root, parts: {}, height: 2.8, radius: 0.5 };
}

/** Arch spandrel: fills [-PW, PW] x [AS, VB] above a round arch (radius PW, springing at AS); thickness t. */
function archSpandrel(PW, AS, VB, t) {
  return geo.custom(`ages:spandrel${PW},${AS},${VB},${t}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-PW, AS);
    s.lineTo(-PW, VB);
    s.lineTo(PW, VB);
    s.lineTo(PW, AS);
    s.absarc(0, AS, PW, 0, Math.PI, false);
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 10 });
    g.translate(0, 0, -t / 2);
    return g;
  });
}

/** Front/back faces of the masonry gatehouses sit at z = +-GZ, a little inside the footprint so that
 * banners hung on them stay within it (the side faces, where walls join, are flush with x = +-1). */
const GZ = 0.975;

/**
 * Masonry gatehouse filling a 2x2 footprint: piers either side, a vault over the passage (|x| < PW,
 * along Z) and arched facades front and back. Returns the vault height VB.
 */
function gatehouse(root, { PW, H, AS, color, trim }) {
  const m = mat(color), mT = mat(trim);
  const VB = AS + PW + 0.1;
  for (const s of [1, -1]) add(root, geo.box(1 - PW, H, 2 * GZ), m, [s * (PW + (1 - PW) / 2), H / 2, 0]);
  add(root, geo.box(2 * PW, H - VB, 2 * GZ), m, [0, (VB + H) / 2, 0]);
  const sp = archSpandrel(PW, AS, VB, 0.24);
  for (const s of [1, -1]) {
    add(root, sp, m, [0, 0, s * (GZ - 0.12)]);
    add(root, geo.torus(PW + 0.035, 0.045, 4, 12, Math.PI), mT, [0, AS, s * (GZ - 0.045)]);
    for (const sx of [1, -1]) add(root, geo.box(0.08, AS, 0.06), mT, [sx * (PW + 0.035), AS / 2, s * (GZ - 0.03)]);
  }
  add(root, geo.box(2 * PW, 0.03, 2), mat(0x8e8a80), [0, 0.015, 0]); // paved passage
  add(root, geo.box(2 * PW, 0.04, 2 * GZ), mat(0x2a2620), [0, VB - 0.02, 0]); // shadowed vault ceiling
  return VB;
}

/** Raised portcullis (bars + teeth) hanging in the vault just behind a facade at z. */
function portcullis(root, key, PW, bottom, top, z) {
  const bars = [], n = 5;
  for (let i = 0; i < n; i++) bars.push([0.035, top - bottom, 0.035, -PW + 0.08 + (i * (2 * PW - 0.16)) / (n - 1), (top + bottom) / 2, 0]);
  for (const y of [bottom + 0.12, bottom + 0.4]) bars.push([2 * PW - 0.04, 0.035, 0.035, 0, y, 0]);
  add(root, mergedBoxes(`portcullis:${key}`, bars), mat(P.iron), [0, 0, z]);
  add(root, mergedCyls(`portcullisTeeth:${key}`, bars.slice(0, n).map((b) => [0.022, 0, 0.09, b[3], bottom - 0.045, 0, 0, 0, 4])), mat(P.iron), [0, 0, z]);
}

/**
 * One gate leaf. The returned group sits on the hinge; the leaf extends toward +X (dir = 1) or -X
 * (dir = -1) with its front face at the hinge plane, so rotation.y = dir * angle swings it toward -Z.
 */
function gateLeaf(parent, key, x, z, dir, w, h, { studs = false, pointed = false } = {}) {
  const hinge = grp(parent, x, 0, z);
  const t = 0.07, n = 4, bw = w / n;
  const plank = mat(DOOR_PLANK), iron = mat(DOOR_IRON);
  const boards = [];
  for (let i = 0; i < n; i++) {
    const bh = h - (pointed ? 0 : (i % 2) * 0.02);
    boards.push([bw - 0.014, bh, t, dir * bw * (i + 0.5), bh / 2, -t / 2]);
  }
  noMerge(add(hinge, mergedBoxes(`gateBoards:${key}:${dir}`, boards), plank));
  // diagonal brace across the back (from the bottom hinge side up to the meeting edge)
  const bl = Math.hypot(w * 0.8, h * 0.52);
  noMerge(add(hinge, geo.box(0.06, bl, 0.025), plank, [(dir * w) / 2, h * 0.48, -t - 0.012], [0, 0, -dir * Math.atan2(w * 0.8, h * 0.52)]));
  const ir = [];
  for (const y of [h * 0.2, h * 0.76]) {
    ir.push([w - 0.04, 0.06, 0.016, (dir * w) / 2, y, 0.008]);
    ir.push([w - 0.04, 0.06, 0.016, (dir * w) / 2, y, -t - 0.008]);
    ir.push([0.05, 0.09, t + 0.05, dir * 0.015, y, -t / 2]); // hinge knuckle
  }
  ir.push([0.05, 0.05, 0.03, dir * (w - 0.07), h * 0.48, 0.015]); // handle plate
  if (studs) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) ir.push([0.03, 0.03, 0.014, dir * (w * (c + 0.75)) / 3.5, h * (0.3 + r * 0.14), 0.007]);
  }
  noMerge(add(hinge, mergedBoxes(`gateIron:${key}:${dir}`, ir), iron));
  noMerge(add(hinge, geo.torus(0.04, 0.01, 4, 8), iron, [dir * (w - 0.07), h * 0.44, 0.03]));
  if (pointed) {
    const tips = [];
    for (let i = 0; i < n; i++) tips.push([0, (bw - 0.014) * 0.62, 0.12, dir * bw * (i + 0.5), h + 0.06, -t / 2, 0, 0, 4]);
    noMerge(add(hinge, mergedCyls(`gateTips:${key}:${dir}`, tips), plank));
  }
  return { obj: hinge, side: dir };
}

export function gate_wood(tc) {
  const root = new THREE.Group();
  const wood = mat(P.wood), woodD = mat(P.woodDark), woodL = mat(P.woodLight);
  add(root, geo.box(1.0, 0.03, 2.0), mat(0x8a6a44), [0, 0.015, 0]); // trodden path
  for (const s of [1, -1]) {
    const x = s * 0.74;
    // log tower
    add(root, geo.box(0.42, 1.92, 0.56), woodD, [x, 0.96, 0]);
    add(root, mergedCyls('gwPosts', [[-0.17, -0.26], [0.17, -0.26], [-0.17, 0.26], [0.17, 0.26]].map(([px, pz]) => [0.07, 0.075, 2.0, px, 1.0, pz, 0, 0, 7])), wood, [x, 0, 0]);
    add(root, mergedCyls('gwClad', [-0.1, 0, 0.1].flatMap((lx) => [[0.055, 0.055, 1.8, lx, 0.92, 0.27, 0, 0, 6], [0.055, 0.055, 1.8, lx, 0.92, -0.27, 0, 0, 6]])), wood, [x, 0, 0]);
    add(root, mergedBoxes('gwLashings', [0.55, 1.3].map((y) => [0.46, 0.05, 0.6, 0, y, 0])), mat(0xcdb98a), [x, 0, 0]);
    // fighting platform with a stake parapet and a little thatched roof
    add(root, geo.box(0.5, 0.08, 0.66), woodL, [x, 1.95, 0]);
    const par = [];
    for (const pz of [-0.29, 0.29]) for (const px of [-0.19, 0, 0.19]) par.push([px, pz, 0.16]);
    stakes(root, 'gwParapet', par, { r: 0.045, tip: 0.08, seg: 5, pos: [x, 1.99, 0] });
    for (const [px, pz] of [[-0.21, -0.29], [0.21, -0.29], [-0.21, 0.29], [0.21, 0.29]]) add(root, geo.box(0.04, 0.2, 0.04), woodD, [x + px, 2.08, pz]);
    add(root, CG.pyramid(), mat(P.thatch), [x, 2.15, 0], null, [0.5, 0.25, 0.68]);
    add(root, geo.box(0.06, 0.06, 0.06), mat(tc), [x, 2.4, 0], [0, Math.PI / 4, 0]);
    // team cloth wrapped round the tower top
    add(root, geo.box(0.47, 0.14, 0.6), mat(tc), [x, 1.8, 0]);
    // palisade wings filling the rest of the side cells
    add(root, geo.box(0.46, 1.1, 0.6), woodD, [x, 0.55, 0.65]);
    add(root, geo.box(0.46, 1.1, 0.6), woodD, [x, 0.55, -0.65]);
  }
  const wing = [];
  const hs = [1.4, 1.5, 1.36, 1.46];
  for (const s of [1, -1]) for (const z of [0.5, 0.82, -0.5, -0.82]) for (const [k, xx] of [0.64, 0.85].entries()) {
    wing.push([s * xx, z, hs[(k + Math.round(z * 10)) & 3]]);
  }
  stakes(root, 'gwWings', wing, { r: 0.14 });
  const beams = [];
  for (const s of [1, -1]) for (const sz of [1, -1]) beams.push([0.05, 0.05, 0.62, s * 0.95, 0.98, sz * 0.67, HALF_PI, 0, 6]);
  for (const s of [1, -1]) for (const sz of [1, -1]) beams.push([0.05, 0.05, 0.5, s * 0.75, 0.98, sz * 0.95, 0, HALF_PI, 6]);
  add(root, mergedCyls('gwWingBeams', beams), woodD);
  // lintel logs + walkway over the passage, team banner
  add(root, geo.cyl(0.085, 0.085, 1.22, 7), wood, [0, 1.86, 0.12], [0, 0, HALF_PI]);
  add(root, geo.cyl(0.085, 0.085, 1.22, 7), wood, [0, 1.86, -0.12], [0, 0, HALF_PI]);
  add(root, geo.box(1.0, 0.05, 0.4), woodL, [0, 1.96, 0]);
  banner(root, 0, 1.9, 0.225, tc, { w: 0.36, h: 0.14 });
  banner(root, 0, 1.9, -0.225, tc, { w: 0.36, h: 0.14, ry: Math.PI });
  const doors = [
    gateLeaf(root, 'wood', -0.495, 0.035, 1, 0.49, 1.52, { pointed: true }),
    gateLeaf(root, 'wood', 0.495, 0.035, -1, 0.49, 1.52, { pointed: true }),
  ];
  return { root, parts: { doors }, height: 2.4, radius: 1.0 };
}

export function gate_stone(tc) {
  const root = new THREE.Group();
  const stone = mat(P.stone), stoneD = mat(P.stoneDark);
  const PW = 0.5, H = 2.45, AS = 1.22;
  const VB = gatehouse(root, { PW, H, AS, color: P.stone, trim: P.stoneDark });
  for (const s of [1, -1]) add(root, geo.box(1 - PW, 0.26, 2 * GZ + 0.004), stoneD, [s * (PW + (1 - PW) / 2), 0.13, 0]);
  const courses = [];
  for (const y of [0.62, 1.0, 1.38]) for (const s of [1, -1]) courses.push([1 - PW + 0.004, 0.03, 2 * GZ + 0.004, s * (PW + (1 - PW) / 2), y, 0]);
  for (const y of [1.84, 2.16]) courses.push([2.004, 0.03, 2 * GZ + 0.004, 0, y, 0]);
  add(root, mergedBoxes('gateStoneCourses', courses), stoneD);
  add(root, geo.box(2, 0.1, 2), stoneD, [0, H + 0.05, 0]);
  add(root, crenRectGeo(2, 2, 5, 0.24, 0.32), stone, [0, H + 0.1, 0]);
  for (const s of [1, -1]) {
    add(root, mergedBoxes('gateStoneSlits', [[0.06, 0.28, 0.03, 0.75, 1.55, 0], [0.06, 0.28, 0.03, -0.75, 1.55, 0]]), mat(0x1c1e24), [0, 0, s * (GZ - 0.01)]);
  }
  portcullis(root, 'stone', PW, 1.48, VB, GZ - 0.23);
  portcullis(root, 'stoneB', PW, 1.48, VB, -(GZ - 0.23));
  banner(root, 0, H - 0.1, GZ + 0.013, tc, { w: 0.3, h: 0.2 });
  banner(root, 0, H - 0.1, -GZ - 0.013, tc, { w: 0.3, h: 0.2, ry: Math.PI });
  flag(root, -0.78, H + 0.1, -0.78, tc, { pole: 0.4, w: 0.4, h: 0.22, dir: 1 });
  const doors = [
    gateLeaf(root, 'stone', -PW, GZ - 0.275, 1, PW - 0.005, VB - 0.1),
    gateLeaf(root, 'stone', PW, GZ - 0.275, -1, PW - 0.005, VB - 0.1),
  ];
  return { root, parts: { doors }, height: 3.0, radius: 1.0 };
}

export function gate_fortified(tc) {
  const root = new THREE.Group();
  const ash = mat(ASHLAR), ashD = mat(ASHLAR_DARK), team = mat(tc), gold = mat(P.gold);
  const PW = 0.47, H = 2.34, AS = 1.22;
  const VB = gatehouse(root, { PW, H, AS, color: ASHLAR_MORTAR, trim: ASHLAR_DARK });
  for (const s of [1, -1]) add(root, geo.box(1 - PW, 0.32, 2 * GZ + 0.004), ashD, [s * (PW + (1 - PW) / 2), 0.16, 0]);
  // ashlar courses: front/back faces skip the arch opening, side faces are whole
  const inOpening = (cx, y, hw, hh) => {
    const ax = Math.abs(cx) - hw;
    if (ax >= PW + 0.04) return false;
    const top = y + hh;
    if (y - hh < AS) return true;
    const dx = Math.max(0, ax);
    return y - hh < AS + Math.sqrt(Math.max(0, (PW + 0.06) ** 2 - dx * dx)) + 0.02 || top < VB;
  };
  const underBanner = (cx, y, hw) => Math.abs(Math.abs(cx) - 0.735) < hw + 0.17 && y > 0.92;
  const face = ashlarRows(0.34, 2.08, { x0: -1, x1: 1, skip: (cx, y, hw, hh) => inOpening(cx, y, hw, hh) || underBanner(cx, y, hw) });
  const side = ashlarRows(0.34, 2.08, { x0: -GZ, x1: GZ });
  const blocks = [];
  for (const [w, h, x, y] of face) blocks.push([w, h, 0.03, x, y, GZ - 0.009], [w, h, 0.03, -x, y, -(GZ - 0.009)]);
  for (const [w, h, x, y] of side) blocks.push([0.03, h, w, 0.991, y, -x], [0.03, h, w, -0.991, y, x]);
  add(root, mergedBoxes('gateFortBlocks', blocks), ash);
  add(root, geo.box(2.006, 0.12, 2 * GZ + 0.006), team, [0, 2.16, 0]);
  add(root, geo.box(2.008, 0.025, 2 * GZ + 0.008), gold, [0, 2.1, 0]);
  add(root, geo.box(2, 0.12, 2), ashD, [0, 2.28, 0]);
  add(root, crenRectGeo(2, 2, 6, 0.26, 0.4), ash, [0, H, 0]);
  // two small towers over the piers with team roofs
  for (const s of [1, -1]) {
    const x = s * 0.735;
    add(root, geo.box(0.53, 0.72, 0.62), ash, [x, H + 0.36, 0]);
    add(root, geo.box(0.535, 0.1, 0.625), ashD, [x, H + 0.05, 0]);
    add(root, geo.box(0.535, 0.08, 0.625), ashD, [x, H + 0.72, 0]);
    add(root, geo.box(0.536, 0.05, 0.626), team, [x, H + 0.62, 0]);
    add(root, mergedBoxes(`gfTowerSlits${s}`, [[0.06, 0.24, 0.03, 0, 0, 0.315], [0.06, 0.24, 0.03, 0, 0, -0.315], [0.03, 0.24, 0.06, s * 0.255, 0, 0]]), mat(0x1c1e24), [x, H + 0.34, 0]);
    add(root, CG.pyramid(), team, [x, H + 0.76, 0], null, [0.53, 0.46, 0.62]);
    add(root, geo.sphere(0.045, 6, 4), gold, [x, H + 1.23, 0]);
    for (const sz of [1, -1]) banner(root, x, 2.02, sz * (GZ + 0.013), tc, { w: 0.3, h: 0.86, ry: sz > 0 ? 0 : Math.PI });
  }
  portcullis(root, 'fort', PW, 1.42, VB, GZ - 0.23);
  portcullis(root, 'fortB', PW, 1.42, VB, -(GZ - 0.23));
  const doors = [
    gateLeaf(root, 'fort', -PW, GZ - 0.275, 1, PW - 0.005, VB - 0.1, { studs: true }),
    gateLeaf(root, 'fort', PW, GZ - 0.275, -1, PW - 0.005, VB - 0.1, { studs: true }),
  ];
  return { root, parts: { doors }, height: 3.6, radius: 1.0 };
}
