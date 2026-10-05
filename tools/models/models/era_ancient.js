// Ancient eras: the Stone Age (Clubman, Rock Thrower, stone camp, hide tent) and the Bronze Age (Hoplite,
// war chariot, bronze hall), the pre-industrial farm (Stone -> Gunpowder Age) and the neutral merchant
// caravan wagon. Same conventions as ages.js: origin at ground center, facing +Z, the character's weapon
// hand on -X, team color via mat(teamColor), cached geo/mat, every mesh casts shadows (add()).
import {
  THREE, mat, geo, P, CG, glowMat, grp, add, beam, rod, rig, legMesh, armMesh, grip, MELEE_TILT,
  fire, flag, banner, mergedBoxes,
} from './common.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;

/** Darker/lighter variant of a color. */
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();

const C = {
  tan: 0xc98a5a, tanD: 0xa3653c, // sun-tanned skin
  hair: 0x2e1d12,
  fur: 0x7a5636, furD: 0x4f3622, furL: 0xb0916a,
  hide: 0xbc9462, hideD: 0x8e693e, hideL: 0xdcc497, hideR: 0xa27548,
  bronze: 0xc98a3a, bronzeD: 0x8c5a22, bronzeL: 0xeab866,
  linen: 0xefe6cc, linenD: 0xcabc98,
  ivory: 0xf1e8cf, ivoryD: 0xcdbf9b,
  earth: 0x8a6a44, earthD: 0x6e5034,
  mud: 0xc99d68, mudD: 0xa77c4b,
  terracotta: 0xb4643a,
  dark: 0x1e1712,
};

/** mergedBoxes with a file-local key prefix. */
const mb = (key, boxes) => mergedBoxes(`anc:${key}`, boxes);

/**
 * Cached merged cylinders / cones: [[rTop, rBot, h, x, y, z, rx = 0, rz = 0, seg = 6], ...],
 * each centered on (x, y, z). rTop = 0 makes an upward cone, rBot = 0 a downward one.
 */
function mergedCyls(key, list) {
  return geo.custom(`anc-cyl:${key}`, () => {
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

/** Cached merged rocks / lumps: [[r, x, y, z, sy = 1, ry = 0], ...]; kind 'dodeca' or 'ico'. */
function mergedRocks(key, list, kind = 'dodeca') {
  return geo.custom(`anc-rocks:${key}`, () => {
    const parts = list.map(([r, x, y, z, sy = 1, ry = 0]) => {
      const g = kind === 'ico' ? new THREE.IcosahedronGeometry(r, 0) : new THREE.DodecahedronGeometry(r, 0);
      g.scale(1, sy, 1);
      if (ry) g.rotateY(ry);
      g.translate(x, y, z);
      return g;
    });
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

/** Upper hemisphere (dome), radius 1, base at y=0. */
const hemi = () => geo.custom('anc:hemi16', () => new THREE.SphereGeometry(1, 16, 6, 0, TAU, 0, HALF_PI));
/** Low-res upper hemisphere for small domes. */
const hemiLo = () => geo.custom('anc:hemi10', () => new THREE.SphereGeometry(1, 10, 4, 0, TAU, 0, HALF_PI));
/** Horizontal band of the unit sphere between polar angles t0..t1 (0 = top). */
const zone = (t0, t1) => geo.custom(`anc:zone${t0},${t1}`, () => new THREE.SphereGeometry(1, 16, 1, 0, TAU, t0, t1 - t0));
/** Curved patch of the unit sphere (phi 0 = -X, PI/2 = +Z; theta from the top). */
const patch = (p0, pl, t0, tl) => geo.custom(`anc:patch${p0},${pl},${t0},${tl}`, () => new THREE.SphereGeometry(1, 3, 2, p0, pl, t0, tl));
/** Upper half of an open tube of radius 1 running along Z (length 1, centered). */
const halfTube = () => geo.custom('anc:halfTube', () => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true, -HALF_PI, Math.PI);
  g.rotateX(-HALF_PI);
  return g;
});
/** Upper half disc of radius 1 in the XY plane, facing +Z. */
const halfDisc = () => geo.custom('anc:halfDisc', () => new THREE.CircleGeometry(1, 12, 0, Math.PI));

/**
 * Curved tapering tusk / horn: starts at the origin pointing +Y and curls toward +Z through `curl`
 * radians over arc length `len`, radius r0 -> r1. Orient it with basis().
 */
function tuskGeo(len, r0, r1, curl, n = 5, seg = 5) {
  return geo.custom(`anc:tusk${len},${r0},${r1},${curl},${n},${seg}`, () => {
    const R = len / curl;
    const pt = (a) => [R * Math.sin(a), R * (1 - Math.cos(a))];
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * curl, a1 = ((i + 1) / n) * curl;
      const [y0, z0] = pt(a0), [y1, z1] = pt(a1);
      const l = Math.hypot(y1 - y0, z1 - z0) * (i === n - 1 ? 1 : 1.12);
      const ra = r0 + ((r1 - r0) * i) / n, rb = r0 + ((r1 - r0) * (i + 1)) / n;
      const g = new THREE.CylinderGeometry(rb, ra, l, seg, 1, i > 0);
      g.translate(0, l / 2, 0);
      g.rotateX(a0 + (a1 - a0) * 0.5);
      g.translate(0, y0, z0);
      parts.push(g);
    }
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

/** Orient an object so its local +Y points along yDir and its local +Z (as close as possible) along zDir. */
function basis(obj, yDir, zDir) {
  const y = new THREE.Vector3(...yDir).normalize();
  const z = new THREE.Vector3(...zDir).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  z.crossVectors(x, y).normalize();
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return obj;
}

/** Spoked wheel group (axle = local X; the game rolls it with rotation.x). */
function spokedWheel(parent, key, x, y, z, R, { rim, spoke, hub, n = 6, w = 0.05, tube = 0.035, rs = 4 }) {
  const wg = grp(parent, x, y, z);
  add(wg, geo.torus(R - tube, tube, rs, 10), rim, [0, 0, 0], [0, HALF_PI, rs === 3 ? Math.PI / 2 : 0]);
  const sp = [];
  for (let i = 0; i < n / 2; i++) sp.push([w * 0.55, 2 * (R - tube), w * 0.55, 0, 0, 0, 0, (i / (n / 2)) * Math.PI]);
  add(wg, mb(`spokes:${key}`, sp), spoke);
  add(wg, geo.cyl(R * 0.2, R * 0.2, w * 2.4, 6), hub, [0, 0, 0], [0, 0, HALF_PI]);
  return wg;
}

/** Horse / ox leg pivot groups (hip at y = LL). defs: [x, z, phase]. */
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

/** Torso-hugging horizontal band on a CG.frustum torso (center cy, height th, bottom w0 x d0, top ratio k). */
function torsoBand(body, material, { cy, th, w0, d0, k, y, h = 0.018, grow = 0.012 }) {
  const t = (y - (cy - th / 2)) / th;
  const s = 1 + (k - 1) * t;
  add(body, geo.box(w0 * s + grow, h, d0 * s + grow), material, [0, y, 0]);
}

/** A box lying along the forearm made by armMesh (fraction t from the elbow). */
function onForearm(ag, { upper, fore }, bend, t, size, material) {
  const dy = -Math.cos(bend), dz = Math.sin(bend);
  return add(ag, geo.box(size[0], size[1], size[2]), material, [0, -upper + dy * fore * t, dz * fore * t], [-bend, 0, 0]);
}

/** Pile of logs lying along X: rows = [n bottom, n next, ...]. Cut ends get pale discs. */
function logPile(parent, key, x, y, z, rows, { len = 1.0, r = 0.11, ry = 0 } = {}) {
  const logs = [], ends = [];
  rows.forEach((n, j) => {
    for (let i = 0; i < n; i++) {
      const lz = (i - (n - 1) / 2) * r * 2.02;
      const ly = r + j * r * 1.75;
      logs.push([r, r, len, 0, ly, lz, 0, HALF_PI, 5]);
      for (const s of [1, -1]) ends.push([r * 0.8, r * 0.8, 0.012, (s * len) / 2, ly, lz, 0, HALF_PI, 5]);
    }
  });
  const g = grp(parent, x, y, z, ry);
  add(g, mergedCyls(`logs:${key}`, logs), mat(0x7a4e28));
  add(g, mergedCyls(`logEnds:${key}`, ends), mat(0xd9b27a));
  return g;
}

/** Thatch courses on a cone roof (radius rb at y0, rt at y0 + h): raised rings at fractions fs. */
function thatchRings(parent, y0, h, rb, rt, fs, material, t = 0.05, pos = [0, 0, 0]) {
  for (const f of fs) {
    const ra = rb + (rt - rb) * f, rbb = rb + (rt - rb) * Math.max(0, f - t / h);
    add(parent, geo.cyl(ra + 0.02, rbb + 0.025, t, 12), material, [pos[0], pos[1] + y0 + h * f - t / 2, pos[2]]);
  }
}

/** Ring of n stones (radius rr each) around (0, 0) at distance R, as one merged mesh. */
function stoneRing(key, n, R, rr, jitter = 0.2) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 1 + Math.sin(i * 2.7) * jitter;
    list.push([rr * k, Math.sin(a) * R, rr * 0.55 * k, Math.cos(a) * R, 0.7, a * 1.7]);
  }
  return mergedRocks(`ring:${key}`, list, 'ico');
}

function unitResult(r, height, radius, extra = {}) {
  return {
    root: r.root,
    parts: { body: r.body, head: r.head, legs: r.legs, arms: [{ obj: r.armL, phase: Math.PI }], weapon: r.weapon, ...extra },
    height,
    radius,
  };
}

// ===========================================================================
// Stone Age units
// ===========================================================================

// Clubman: stocky bare-skinned brute with wild hair and beard, fur loincloth, a team-dyed pelt over the
// shoulders, team headband and arm paint, and a big knobbly club.
export function caveman(tc) {
  const L = 0.32;
  const r = rig({ legLen: L, hipW: 0.09, shoulderX: 0.24, shoulderY: 0.31, neckY: 0.36, headZ: 0.04, legAmp: 0.55 });
  const skin = mat(C.tan), skinD = mat(C.tanD), fur = mat(C.fur), furD = mat(C.furD);
  const team = mat(tc), teamD = mat(shade(tc, 0.58)), hair = mat(C.hair), bone = mat(P.bone);
  for (const l of r.legs) {
    legMesh(l.obj, L, 0.115, skin, fur, { bootH: 0.42, toe: 0.2 });
    add(l.obj, geo.box(0.15, 0.04, 0.2), furD, [0, -L * 0.58, 0.022]); // fur wrap cuff
  }
  // barrel chest + belly
  const torso = { cy: 0.17, th: 0.33, w0: 0.3, d0: 0.235, k: 1.4 };
  add(r.body, CG.frustum(torso.k), skin, [0, torso.cy, 0], null, [torso.w0, torso.th, torso.d0]);
  add(r.body, geo.sphere(0.14, 7, 5), skin, [0, 0.08, 0.04], null, [1.05, 0.85, 0.85]);
  torsoBand(r.body, team, { ...torso, y: 0.2, h: 0.03 }); // painted stripe
  // fur loincloth with a ragged hem, rope belt
  add(r.body, CG.frustum(0.82), fur, [0, -0.04, 0], null, [0.36, 0.19, 0.28]);
  const hem = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    hem.push([0.04, 0, 0.08, Math.sin(a) * 0.168, -0.17, Math.cos(a) * 0.13, 0, 0, 4]);
  }
  add(r.body, mergedCyls('caveHem', hem), fur);
  add(r.body, geo.box(0.33, 0.045, 0.26), furD, [0, 0.05, 0]);
  // team-dyed pelt: mantle over both shoulders, diagonal strap, back flap with a tail, darker spots
  add(r.body, CG.frustum(0.6), team, [0, 0.35, -0.005], null, [0.55, 0.13, 0.41]);
  add(r.body, geo.box(0.12, 0.4, 0.035), team, [0.03, 0.17, 0.158], [-0.12, 0, -0.62]);
  add(r.body, CG.frustum(0.8), team, [0, 0.16, -0.16], [0.12, 0, 0], [0.42, 0.32, 0.04]);
  add(r.body, geo.cone(0.04, 0.2, 5), team, [0.1, -0.06, -0.19], [Math.PI - 0.2, 0, 0]);
  add(r.body, mb('caveSpots', [
    [0.07, 0.025, 0.06, 0.13, 0.405, 0.05], [0.06, 0.025, 0.07, -0.12, 0.405, -0.06],
    [0.06, 0.025, 0.05, 0.02, 0.418, -0.11], [0.06, 0.06, 0.02, -0.06, 0.18, -0.183],
  ]), teamD);
  // tooth necklace
  const teeth = [];
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.42;
    teeth.push([0.018, 0, 0.055, Math.sin(a) * 0.13, 0.33, Math.cos(a) * 0.15, 0, 0, 4]);
  }
  add(r.body, mergedCyls('caveTeeth', teeth), bone);
  // head: heavy brow, broad nose, beard, wild hair tied with a team band
  add(r.head, geo.sphere(0.1, 8, 6), skin, [0, 0.1, 0.02]);
  add(r.head, geo.box(0.165, 0.04, 0.06), skinD, [0, 0.135, 0.085]);
  add(r.head, geo.box(0.045, 0.05, 0.05), skinD, [0, 0.1, 0.115]);
  add(r.head, mb('caveEyes', [[0.03, 0.018, 0.01, -0.038, 0.113, 0.113], [0.03, 0.018, 0.01, 0.038, 0.113, 0.113]]), mat(P.black));
  add(r.head, geo.dodeca(0.088), hair, [0, 0.035, 0.07], [0.2, 0.3, 0], [1.1, 1.05, 0.7]);
  add(r.head, geo.dodeca(0.125), hair, [0, 0.17, -0.03], [0.3, 0.6, 0.1], [1.08, 0.9, 1.05]);
  const tufts = [];
  for (const [x, y, z, rx, rz] of [[0, 0.26, -0.02, -0.2, 0], [0.08, 0.24, -0.04, -0.1, -0.7], [-0.08, 0.24, -0.04, -0.1, 0.7],
    [0.1, 0.16, -0.08, -0.6, -1.2], [-0.1, 0.16, -0.08, -0.6, 1.2], [0, 0.18, -0.14, -1.5, 0], [0.05, 0.08, -0.12, -2.2, -0.4]]) {
    tufts.push([0, 0.04, 0.12, x, y, z, rx, rz, 4]);
  }
  add(r.head, mergedCyls('caveTufts', tufts), hair);
  add(r.head, geo.torus(0.122, 0.022, 4, 10), team, [0, 0.15, -0.02], [HALF_PI - 0.12, 0, 0]);
  add(r.head, mb('caveCheek', [[0.014, 0.05, 0.02, 0.068, 0.08, 0.09], [0.014, 0.05, 0.02, -0.068, 0.08, 0.09]]), team);
  // muscular arms with team paint bands and fur bracers
  const armOpt = { upper: 0.15, fore: 0.14, w: 0.095, upperMat: skin, foreMat: skin, handMat: skinD, handR: 0.06 };
  armMesh(r.armL, { ...armOpt, bend: 0.45 });
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.6 });
  for (const [g, bend] of [[r.armL, 0.45], [r.weapon, 0.6]]) {
    add(g, geo.sphere(0.078, 6, 5), skin, [0, -0.01, 0]);
    add(g, geo.box(0.106, 0.035, 0.106), team, [0, -0.085, 0]);
    onForearm(g, armOpt, bend, 0.55, [0.115, 0.07, 0.115], fur);
  }
  // big knobbly club
  const g = grip(hand, MELEE_TILT);
  const club = mat(0x8c5c30), clubD = mat(0x5e3c1e);
  add(g, geo.cyl(0.028, 0.024, 0.15, 6), mat(P.leatherDark), [0, 0, 0]);
  add(g, geo.cyl(0.064, 0.03, 0.32, 7), club, [0, 0.22, 0]);
  add(g, geo.dodeca(0.095), club, [0, 0.42, 0], [0.4, 0.3, 0], [1, 1.25, 1]);
  add(g, mergedRocks('clubKnobs', [
    [0.038, 0.07, 0.36, 0.01], [0.034, -0.065, 0.42, 0.05], [0.034, 0.0, 0.47, -0.08], [0.032, 0.045, 0.3, -0.06],
    [0.036, -0.05, 0.33, -0.05], [0.03, 0.02, 0.54, 0.035],
  ], 'ico'), clubD);
  return unitResult(r, 1.1, 0.4);
}

// Rock Thrower: lean skirmisher in hide leggings and loin skirt, team body paint, team headband with a
// feather, a pouch of stones on the hip. The throwing arm is cocked overhand; its pivot sits in a holder
// turned 180 deg about Y so the standard ranged wind-up (+0.55) draws the stone back and the release
// (-0.25) brings it forward over the shoulder.
export function rock_thrower(tc) {
  const L = 0.35;
  const r = rig({ legLen: L, hipW: 0.068, shoulderX: 0.185, shoulderY: 0.31, neckY: 0.385 });
  const skin = mat(C.tan), skinD = mat(C.tanD), hide = mat(C.hide), hideD = mat(C.hideD), hideL = mat(C.hideL);
  const team = mat(tc), hair = mat(C.hair);
  r.legs.forEach((l, i) => {
    const s = i === 0 ? 1 : -1;
    legMesh(l.obj, L, 0.082, hide, hideD, { bootH: 0.32, toe: 0.22 });
    add(l.obj, geo.box(0.02, 0.17, 0.05), hideL, [s * 0.048, -L * 0.36, 0]); // side fringe
    add(l.obj, geo.box(0.094, 0.03, 0.094), team, [0, -L * 0.62, 0.0]); // painted garter
  });
  const torso = { cy: 0.175, th: 0.3, w0: 0.23, d0: 0.175, k: 1.25 };
  add(r.body, CG.frustum(torso.k), skin, [0, torso.cy, 0], null, [torso.w0, torso.th, torso.d0]);
  for (const y of [0.17, 0.23, 0.29]) torsoBand(r.body, team, { ...torso, y, h: 0.03 });
  // hide wrap over the left shoulder, loin skirt with fringe, belt
  add(r.body, geo.box(0.06, 0.42, 0.025), hideD, [0.03, 0.16, 0.112], [-0.1, 0, -0.55]);
  add(r.body, geo.box(0.06, 0.4, 0.025), hideD, [0.03, 0.17, -0.11], [0.1, 0, -0.55]);
  add(r.body, CG.frustum(0.86), team, [0, -0.04, 0], null, [0.26, 0.17, 0.2]);
  const fr = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    fr.push([0.04, 0.06, 0.012, Math.sin(a) * 0.128, -0.15, Math.cos(a) * 0.098, a]);
  }
  add(r.body, mb('throwFringe', fr), hideD);
  add(r.body, geo.box(0.25, 0.04, 0.19), hideD, [0, 0.045, 0]);
  // pouch of stones on the right hip
  add(r.body, geo.sphere(0.068, 7, 5), mat(P.leather), [-0.155, -0.03, 0.05], null, [0.85, 1.05, 0.9]);
  add(r.body, geo.torus(0.04, 0.012, 4, 8), hideD, [-0.155, 0.035, 0.05], [HALF_PI, 0, 0]);
  add(r.body, mergedRocks('pouchStones', [[0.03, -0.155, 0.06, 0.06], [0.027, -0.13, 0.065, 0.03], [0.026, -0.175, 0.06, 0.03]]), mat(P.stone));
  add(r.body, geo.box(0.02, 0.1, 0.02), hideD, [-0.14, 0.04, 0.05], [0, 0, 0.3]);
  // head: tied-back hair, team headband with trailing ends and a feather, face paint
  add(r.head, geo.sphere(0.092, 8, 6), skin, [0, 0.1, 0.015]);
  add(r.head, geo.box(0.03, 0.04, 0.03), skinD, [0, 0.09, 0.108]);
  add(r.head, mb('throwEyes', [[0.026, 0.016, 0.01, -0.033, 0.112, 0.1], [0.026, 0.016, 0.01, 0.033, 0.112, 0.1]]), mat(P.black));
  add(r.head, geo.sphere(0.1, 8, 6), hair, [0, 0.135, -0.025], null, [1.0, 0.82, 1.05]);
  add(r.head, geo.cone(0.045, 0.16, 5), hair, [0, 0.08, -0.13], [-2.6, 0, 0]);
  add(r.head, geo.torus(0.1, 0.02, 4, 10), team, [0, 0.13, -0.005], [HALF_PI - 0.12, 0, 0]);
  add(r.head, mb('throwBandTails', [[0.03, 0.13, 0.012, 0.02, 0.07, -0.11, 0, 0.35], [0.03, 0.11, 0.012, -0.02, 0.07, -0.108, 0, 0.25]]), team);
  add(r.head, geo.box(0.022, 0.15, 0.04), hideL, [0.07, 0.24, -0.06], [-0.3, 0, -0.35]);
  add(r.head, geo.box(0.024, 0.05, 0.042), mat(P.black), [0.093, 0.3, -0.08], [-0.3, 0, -0.35]);
  add(r.head, mb('throwFacePaint', [[0.06, 0.016, 0.02, 0.05, 0.085, 0.085, -0.4], [0.06, 0.016, 0.02, -0.05, 0.085, 0.085, 0.4]]), team);
  // off arm reaches forward to aim
  const armOpt = { upper: 0.14, fore: 0.13, w: 0.068, upperMat: team, foreMat: skin, handMat: skinD };
  armMesh(r.armL, { ...armOpt, bend: 1.15 });
  add(r.armL, geo.sphere(0.048, 6, 4), team, [0, -0.005, 0]);
  onForearm(r.armL, armOpt, 1.15, 0.5, [0.08, 0.06, 0.08], hide);
  // throwing arm (local frame mirrored in X and Z by the holder: local +Z points backward)
  r.body.remove(r.weapon);
  const holder = grp(r.body, -0.185, 0.31, 0);
  holder.rotation.y = Math.PI;
  const weapon = grp(holder, 0, 0, 0);
  const el = [0.125, 0.0, 0.055], hd = [0.12, 0.145, 0.085];
  add(weapon, geo.sphere(0.05, 6, 4), team, [0, -0.005, 0]);
  beam(weapon, [0, 0, 0], el, 0.068, team);
  add(weapon, geo.sphere(0.036, 6, 4), skin, el);
  beam(weapon, el, hd, 0.062, skin);
  onForearmBeam(weapon, el, hd, 0.5, 0.07, hide);
  add(weapon, geo.sphere(0.042, 6, 4), skinD, hd);
  add(weapon, geo.dodeca(0.05), mat(0x9a968c), [hd[0], hd[1] + 0.045, hd[2] + 0.01], [0.4, 0.2, 0]);
  const res = unitResult(r, 1.05, 0.38);
  res.parts.weapon = weapon;
  return res;
}

/** Short cuff along a beam from a to b (fraction t), slightly thicker than the limb. */
function onForearmBeam(parent, a, b, t, w, material) {
  const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const d = [(b[0] - a[0]) * 0.18, (b[1] - a[1]) * 0.18, (b[2] - a[2]) * 0.18];
  return beam(parent, [c[0] - d[0], c[1] - d[1], c[2] - d[2]], [c[0] + d[0], c[1] + d[1], c[2] + d[2]], w, material);
}

// ===========================================================================
// Bronze Age units
// ===========================================================================

/**
 * Hoplite spear grip tilt. The spear lies along the grip's +Y, so it points level forward (+Z) when
 * weapon.rotation.x = PI/2 - HOPLITE_SPEAR_TILT (~1.21).
 */
const HOPLITE_SPEAR_TILT = 0.36;

// Hoplite: Corinthian helmet with a team crest, big bronze aspis with a team blazon, linen cuirass with
// pteruges, team cloak, bronze greaves, long dory carried leaning forward.
export function hoplite(tc) {
  const L = 0.38;
  const r = rig({ legLen: L, hipW: 0.08, shoulderX: 0.225, shoulderY: 0.35, neckY: 0.425 });
  const bronze = mat(C.bronze), bronzeD = mat(C.bronzeD), bronzeL = mat(C.bronzeL);
  const linen = mat(C.linen), linenD = mat(C.linenD), team = mat(tc), teamD = mat(shade(tc, 0.58));
  const skin = mat(P.skin), skinD = mat(P.skinShade), leatherD = mat(P.leatherDark), black = mat(P.black);
  for (const l of r.legs) {
    add(l.obj, geo.box(0.095, L * 0.52, 0.1), skin, [0, -L * 0.26, 0]);
    add(l.obj, geo.box(0.108, L * 0.47, 0.108), bronze, [0, -L * 0.645, 0.008]);
    add(l.obj, geo.sphere(0.052, 6, 4), bronzeL, [0, -L * 0.42, 0.038], null, [1, 0.8, 0.7]);
    add(l.obj, geo.box(0.1, 0.045, 0.17), leatherD, [0, -L + 0.0225, 0.03]);
    add(l.obj, geo.box(0.085, 0.03, 0.12), skin, [0, -L + 0.055, 0.05]);
  }
  // linothorax with team band, bronze belt, shoulder flaps
  const torso = { cy: 0.205, th: 0.33, w0: 0.27, d0: 0.2, k: 1.32 };
  add(r.body, CG.frustum(torso.k), linen, [0, torso.cy, 0], null, [torso.w0, torso.th, torso.d0]);
  torsoBand(r.body, team, { ...torso, y: 0.105, h: 0.04 });
  torsoBand(r.body, linenD, { ...torso, y: 0.3, h: 0.02 });
  add(r.body, geo.box(0.29, 0.04, 0.22), bronze, [0, 0.055, 0]);
  for (const s of [1, -1]) add(r.body, geo.box(0.13, 0.035, 0.22), linen, [s * 0.13, 0.37, 0], [0, 0, -s * 0.22]);
  // pteruges: two tiers of strips over a chiton skirt
  add(r.body, CG.frustum(0.86), linenD, [0, -0.07, 0], null, [0.3, 0.2, 0.23]);
  const ptA = [], ptB = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU, a2 = ((i + 0.5) / 10) * TAU;
    ptA.push([0.08, 0.12, 0.018, Math.sin(a) * 0.15, -0.0, Math.cos(a) * 0.115, a, -0.15]);
    ptB.push([0.08, 0.11, 0.018, Math.sin(a2) * 0.162, -0.1, Math.cos(a2) * 0.127, a2, -0.2]);
  }
  add(r.body, mb('hopPterugesA', ptA), linen);
  add(r.body, mb('hopPterugesB', ptB), team);
  // team cloak down the back
  add(r.body, CG.frustum(0.62), team, [0, 0.12, -0.14], [0.1, 0, 0], [0.44, 0.62, 0.04]);
  add(r.body, CG.frustum(0.7), teamD, [0, -0.19, -0.11], [0.1, 0, 0], [0.45, 0.025, 0.045]);
  // Corinthian helmet: skull, face guard with a T opening, brow ring, neck flare, team crest on a holder
  const H = r.head;
  add(H, geo.sphere(0.112, 8, 6), bronze, [0, 0.12, -0.005], null, [1, 1.02, 1.08]);
  add(H, geo.sphere(0.104, 7, 5), bronze, [0, 0.06, 0.022], null, [0.95, 1.05, 1.0]);
  add(H, geo.cyl(0.117, 0.119, 0.022, 10), bronzeD, [0, 0.14, -0.002]);
  add(H, mb('hopVisor', [[0.115, 0.024, 0.02, 0, 0.116, 0.098], [0.032, 0.075, 0.02, 0, 0.045, 0.108]]), black);
  add(H, geo.box(0.024, 0.075, 0.026), bronzeL, [0, 0.09, 0.113]);
  add(H, geo.box(0.17, 0.08, 0.04), bronze, [0, 0.03, -0.1], [-0.5, 0, 0]);
  add(H, geo.box(0.03, 0.05, 0.05), bronzeD, [0, 0.245, -0.01]);
  add(H, geo.cyl(0.14, 0.14, 0.05, 12), team, [0, 0.27, -0.03], [0, 0, HALF_PI], [1, 1, 1.15]);
  add(H, geo.cyl(0.142, 0.142, 0.03, 12), teamD, [0, 0.27, -0.03], [0, 0, HALF_PI], [1, 1, 1.15]);
  add(H, geo.box(0.045, 0.22, 0.05), team, [0, 0.15, -0.19], [0.45, 0, 0]);
  // arms: linen sleeves, bare forearms
  const armOpt = { upper: 0.15, fore: 0.14, w: 0.078, upperMat: linen, foreMat: skin, handMat: skinD };
  const handL = armMesh(r.armL, { ...armOpt, bend: 1.15 });
  // aspis: bronze rim and face, team blazon field with a bronze lambda
  const sg = grp(handL, -0.13, 0.04, 0.085, 0.3);
  const R = 0.29;
  add(sg, geo.cyl(R, R, 0.04, 14), bronzeD, [0, 0, -0.012], [HALF_PI, 0, 0]);
  add(sg, geo.cyl(R - 0.035, R - 0.035, 0.03, 14), bronze, [0, 0, 0.012], [HALF_PI, 0, 0]);
  add(sg, geo.torus(R - 0.02, 0.024, 4, 14), bronzeL, [0, 0, 0.012]);
  add(sg, geo.cyl(0.18, 0.18, 0.03, 12), team, [0, 0, 0.022], [HALF_PI, 0, 0]);
  lambda(sg, bronzeL);
  // dory: ash shaft, leaf-shaped bronze head, bronze butt spike
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.5 });
  const g = grip(hand, HOPLITE_SPEAR_TILT);
  add(g, geo.cyl(0.016, 0.019, 1.66, 5), mat(0xa8784a), [0, 0.43, 0]);
  add(g, geo.cyl(0.022, 0.018, 0.07, 6), bronze, [0, 1.27, 0]);
  add(g, geo.octa(0.05), bronzeL, [0, 1.42, 0], null, [0.8, 2.7, 0.3]);
  add(g, geo.cone(0.022, 0.1, 5), bronze, [0, -0.44, 0], [Math.PI, 0, 0]);
  add(g, geo.cyl(0.024, 0.024, 0.06, 6), leatherD, [0, 0.0, 0]);
  return unitResult(r, 1.2, 0.42);
}

/** Lambda blazon on a shield face group (two bars meeting at the top). */
function lambda(sg, material) {
  for (const s of [1, -1]) add(sg, geo.box(0.045, 0.24, 0.02), material, [s * 0.048, -0.01, 0.042], [0, 0, s * 0.4]);
}

// War chariot: two galloping horses with team blankets and plumes, wicker car with team side panels and
// bronze rails, two six-spoked wheels, a driver at the reins and a spear-armed warrior (parts.weapon).
export function chariot(tc) {
  const root = new THREE.Group();
  const team = mat(tc), teamD = mat(shade(tc, 0.58));
  const bronze = mat(C.bronze), bronzeD = mat(C.bronzeD), bronzeL = mat(C.bronzeL);
  const wicker = mat(0xc49a5c), wickerD = mat(0x8e6a3a), wood = mat(P.wood), woodD = mat(P.woodDark);
  const leatherD = mat(P.leatherDark), skin = mat(P.skin), skinD = mat(P.skinShade), linen = mat(C.linen);
  const horses = [
    { x: 0.185, coat: mat(0x9a5f30), dark: mat(0x3a2414), ph: 0 },
    { x: -0.185, coat: mat(0x6e4024), dark: mat(0x24160c), ph: 0.5 },
  ];
  const LL = 0.5, HZ = 0.42;
  const legs = [];
  for (const h of horses) {
    legs.push(...horseLegs(root, LL, [
      [h.x + 0.065, HZ + 0.24, h.ph], [h.x - 0.065, HZ + 0.24, h.ph + 0.7],
      [h.x + 0.065, HZ - 0.24, h.ph + Math.PI], [h.x - 0.065, HZ - 0.24, h.ph + Math.PI + 0.7],
    ], { upper: [0.072, 0.3, 0.095], lower: [0.054, 0.2, 0.06], hoofSize: [0.07, 0.05, 0.08], coat: h.coat, sock: null, hoof: mat(0x2e221a), amp: 0.75 }));
  }
  const body = grp(root, 0, 0.64, 0);
  for (const h of horses) {
    add(body, geo.box(0.2, 0.23, 0.62), h.coat, [h.x, 0, HZ]);
    add(body, geo.box(0.18, 0.2, 0.16), h.coat, [h.x, -0.01, HZ + 0.3]);
    add(body, geo.box(0.11, 0.36, 0.15), h.coat, [h.x, 0.17, HZ + 0.36], [0.55, 0, 0]);
    add(body, geo.box(0.04, 0.36, 0.06), h.dark, [h.x, 0.23, HZ + 0.3], [0.55, 0, 0]);
    const hg = horseHead(body, h.x, 0.33, HZ + 0.55, { coat: h.coat, dark: h.dark, size: 0.8, tilt: 0.65 });
    add(hg, geo.cone(0.045, 0.22, 5), team, [0, 0.17, -0.1], [-1.15, 0, 0]);
    add(hg, geo.box(0.15, 0.03, 0.03), bronze, [0, 0.0, 0.12]);
    add(body, geo.box(0.045, 0.3, 0.05), h.dark, [h.x, -0.05, HZ - 0.34], [-0.5, 0, 0]);
    add(body, geo.box(0.24, 0.13, 0.34), team, [h.x, 0.07, HZ - 0.03]);
    add(body, geo.box(0.245, 0.03, 0.345), teamD, [h.x, 0.015, HZ - 0.03]);
    add(body, geo.box(0.12, 0.05, 0.1), leatherD, [h.x, 0.135, HZ + 0.27]);
  }
  // yoke + draught pole
  add(root, geo.cyl(0.026, 0.026, 0.6, 6), woodD, [0, 0.83, HZ + 0.3], [0, 0, HALF_PI]);
  beam(root, [0, 0.82, HZ + 0.3], [0, 0.5, -0.36], 0.05, wood);
  // car: floor, wicker breastwork and sides with team panels, bronze rails and sun disc
  const cz = -0.66, cw = 0.78, cd = 0.6, fy = 0.44, front = cz + cd / 2;
  add(root, geo.box(cw, 0.05, cd), woodD, [0, fy, cz]);
  add(root, geo.box(cw, 0.4, 0.05), wicker, [0, fy + 0.2, front - 0.025]);
  for (const s of [1, -1]) {
    add(root, geo.box(0.045, 0.3, cd), wicker, [s * (cw / 2 - 0.0225), fy + 0.15, cz]);
    add(root, geo.box(0.02, 0.22, cd - 0.08), team, [s * (cw / 2 + 0.006), fy + 0.14, cz]);
    beam(root, [s * cw / 2, fy + 0.41, front], [s * cw / 2, fy + 0.3, cz - cd / 2], 0.04, bronze);
  }
  add(root, geo.box(cw - 0.1, 0.3, 0.02), team, [0, fy + 0.2, front + 0.006]);
  add(root, geo.box(cw + 0.02, 0.04, 0.06), bronze, [0, fy + 0.41, front - 0.02]);
  add(root, geo.cyl(0.085, 0.085, 0.02, 6), bronzeL, [0, fy + 0.21, front + 0.02], [HALF_PI, 0, 0]);
  add(root, mb('chariotWicker', [0.08, 0.16, 0.24].map((y) => [cw - 0.04, 0.02, 0.012, 0, y, 0])), wickerD, [0, fy, front - 0.054]);
  add(root, geo.cyl(0.025, 0.025, 1.04, 6), woodD, [0, 0.36, -0.74], [0, 0, HALF_PI]);
  const wheels = [];
  for (const s of [1, -1]) wheels.push(spokedWheel(root, 'chariot', s * 0.48, 0.36, -0.74, 0.36, { rim: woodD, spoke: wood, hub: bronze, n: 6, w: 0.05 }));
  // driver (front left), leaning into the reins
  const drv = grp(root, 0.15, fy + 0.025, -0.5);
  drv.rotation.x = 0.12;
  add(drv, mb('drvLegs', [[0.07, 0.28, 0.08, 0.05, 0.14, 0], [0.07, 0.28, 0.08, -0.05, 0.14, 0]]), skin);
  add(drv, CG.frustum(1.25), linen, [0, 0.42, 0], null, [0.2, 0.3, 0.15]);
  add(drv, CG.frustum(0.9), linen, [0, 0.26, 0], null, [0.22, 0.12, 0.17]);
  add(drv, geo.box(0.06, 0.34, 0.02), team, [0.01, 0.43, 0.088], [-0.05, 0, -0.55]);
  add(drv, geo.sphere(0.08, 6, 5), skin, [0, 0.66, 0.01]);
  add(drv, geo.sphere(0.086, 6, 4), team, [0, 0.69, -0.012], null, [1, 0.7, 1]);
  const dHands = [[0.07, 0.45, 0.21], [-0.06, 0.45, 0.21]];
  for (const [i, s] of [[0, 1], [1, -1]]) {
    beam(drv, [s * 0.11, 0.54, 0], [s * 0.1, 0.46, 0.1], 0.055, linen);
    beam(drv, [s * 0.1, 0.46, 0.1], dHands[i], 0.05, skin);
  }
  drv.updateMatrix();
  for (const [i, h] of [[0, horses[0]], [1, horses[1]]]) {
    const hw = new THREE.Vector3(...dHands[i]).applyMatrix4(drv.matrix).toArray();
    for (const s of [1, -1]) beam(root, hw, [h.x + s * 0.05, 0.88, HZ + 0.63], 0.012, leatherD);
  }
  // warrior (rear right): bronze scale corslet, plumed helmet, small team shield, spear arm = weapon
  const war = grp(root, -0.15, fy + 0.025, -0.8);
  add(war, mb('warLegs', [[0.075, 0.3, 0.085, 0.055, 0.15, 0], [0.075, 0.3, 0.085, -0.055, 0.15, 0]]), skin);
  add(war, CG.frustum(0.9), linen, [0, 0.28, 0], null, [0.24, 0.12, 0.18]);
  add(war, CG.frustum(1.3), bronze, [0, 0.45, 0], null, [0.22, 0.3, 0.17]);
  add(war, mb('warScales', [0.4, 0.5].map((y) => [0.262, 0.02, 0.2, 0, y, 0])), bronzeD);
  add(war, geo.box(0.24, 0.04, 0.19), leatherD, [0, 0.32, 0]);
  add(war, CG.frustum(0.55), bronze, [0, 0.6, 0], null, [0.36, 0.06, 0.2]);
  const head = grp(war, 0, 0.62, 0);
  add(head, geo.sphere(0.082, 6, 4), skin, [0, 0.08, 0.015]);
  add(head, geo.sphere(0.093, 6, 5), bronze, [0, 0.11, -0.01], null, [1, 0.88, 1.05]);
  add(head, mb('warCheeks', [[0.02, 0.07, 0.06, 0.08, 0.06, 0.03], [0.02, 0.07, 0.06, -0.08, 0.06, 0.03]]), bronze);
  add(head, geo.box(0.035, 0.09, 0.22), team, [0, 0.22, -0.02]);
  add(head, geo.cone(0.05, 0.22, 5), team, [0, 0.16, -0.15], [-2.2, 0, 0]);
  const wOpt = { upper: 0.13, fore: 0.12, w: 0.065, upperMat: bronze, foreMat: skin, handMat: skinD, handR: 0.04 };
  const armL = grp(war, 0.14, 0.57, 0);
  const handL = armMesh(armL, { ...wOpt, bend: 0.9 });
  const shg = grp(handL, 0.05, 0.02, 0.03, 0.5);
  add(shg, geo.cyl(0.15, 0.15, 0.035, 8), bronze, [0, 0, 0], [HALF_PI, 0, 0]);
  add(shg, geo.cyl(0.12, 0.12, 0.04, 8), team, [0, 0, 0.006], [HALF_PI, 0, 0]);
  const weapon = grp(war, -0.14, 0.57, 0);
  const hand = armMesh(weapon, { ...wOpt, bend: 0.7 });
  const g = grip(hand, 0.62);
  add(g, geo.cyl(0.013, 0.016, 1.0, 5), mat(0xa8784a), [0, 0.22, 0]);
  add(g, geo.octa(0.04), bronzeL, [0, 0.8, 0], null, [0.8, 2.6, 0.3]);
  add(g, geo.box(0.01, 0.09, 0.06), team, [0, 0.62, -0.035]);
  return {
    root,
    parts: { body, head, legs, wheels, weapon },
    height: 1.5,
    radius: 0.75,
  };
}

// ===========================================================================
// Neutral caravan
// ===========================================================================

/** Iron-banded treasure chest (origin at its base center). open: lid tilted back with gold heaped inside. */
function chest(parent, key, x, y, z, ry, { body, band, gold, open }) {
  const g = grp(parent, x, y, z, ry);
  add(g, geo.box(0.32, 0.18, 0.22), body, [0, 0.09, 0]);
  add(g, mb('chestBands', [[0.04, 0.185, 0.225, -0.1, 0.09, 0], [0.04, 0.185, 0.225, 0.1, 0.09, 0]]), band);
  if (open) {
    add(g, mergedRocks(`goldHeap:${key}`, [[0.075, -0.06, 0.18, 0.0, 0.6], [0.075, 0.06, 0.18, 0.01, 0.6], [0.065, 0.0, 0.22, -0.02, 0.7],
      [0.05, -0.1, 0.19, 0.05, 0.6], [0.05, 0.1, 0.2, -0.05, 0.6]], 'ico'), gold);
    const lid = grp(g, 0, 0.18, -0.11);
    lid.rotation.x = -1.9;
    add(lid, geo.box(0.32, 0.03, 0.22), body, [0, 0.015, 0.11]);
    add(lid, geo.box(0.33, 0.035, 0.04), band, [0, 0.018, 0.2]);
  } else {
    add(g, geo.box(0.33, 0.05, 0.23), body, [0, 0.205, 0]);
    add(g, geo.box(0.06, 0.07, 0.02), gold, [0, 0.15, 0.115]);
  }
  return g;
}

// Merchant caravan wagon: canvas-covered wagon with gold chests showing at the open back, a merchant on
// the bench and an ox in the shafts. Usually neutral grey: team color is only trim (rails, pennant, tassels).
export function cargo_wagon(tc) {
  const root = new THREE.Group();
  const coat = mat(0x8e6a48), coatD = mat(0x4e3a28), coatL = mat(0xc8b090), horn = mat(C.ivory);
  const wood = mat(P.wood), woodD = mat(P.woodDark), woodL = mat(P.woodLight), iron = mat(P.iron);
  const canvas = mat(0xece2c6, { side: THREE.DoubleSide }), canvasD = mat(0xd2c39e, { side: THREE.DoubleSide });
  const team = mat(tc), gold = mat(P.gold, { emissive: 0x7a5200, emissiveIntensity: 0.35 });
  // ox
  const LL = 0.4, OZ = 0.72;
  const legs = horseLegs(root, LL, [[0.13, OZ + 0.25, 0], [-0.13, OZ + 0.25, Math.PI], [0.13, OZ - 0.25, Math.PI], [-0.13, OZ - 0.25, 0]], {
    upper: [0.11, 0.24, 0.13], lower: [0.085, 0.16, 0.095], hoofSize: [0.1, 0.05, 0.11], coat, sock: null, hoof: mat(0x2a2018), amp: 0.4,
  });
  const body = grp(root, 0, 0.6, 0);
  add(body, geo.box(0.42, 0.36, 0.74), coat, [0, 0, OZ]);
  add(body, geo.box(0.38, 0.08, 0.58), coatL, [0, -0.17, OZ]);
  add(body, geo.box(0.3, 0.12, 0.24), coat, [0, 0.2, OZ + 0.25], [0.15, 0, 0]);
  add(body, geo.box(0.12, 0.2, 0.2), coatL, [0, -0.15, OZ + 0.38]);
  const hg = grp(body, 0, 0.04, OZ + 0.47);
  hg.rotation.x = 0.55;
  add(hg, geo.box(0.22, 0.2, 0.3), coat, [0, 0, 0.1]);
  add(hg, geo.box(0.2, 0.15, 0.1), coatL, [0, -0.02, 0.28]);
  add(hg, geo.box(0.12, 0.03, 0.02), coatD, [0, 0.0, 0.335]);
  for (const s of [1, -1]) {
    basis(add(hg, tuskGeo(0.22, 0.032, 0.01, 1.4, 3, 5), horn, [s * 0.1, 0.09, 0.02]), [s, 0.3, 0], [0, 1, 0.2]);
    add(hg, geo.box(0.1, 0.04, 0.06), coat, [s * 0.15, 0.05, -0.0], [0, 0, -s * 0.3]);
  }
  add(body, geo.box(0.04, 0.34, 0.04), coatD, [0, -0.08, OZ - 0.38], [-0.15, 0, 0]);
  add(body, geo.box(0.07, 0.08, 0.07), coatD, [0, -0.27, OZ - 0.4]);
  // yoke with bows and team tassels
  add(body, geo.box(0.66, 0.06, 0.07), woodD, [0, 0.21, OZ + 0.3]);
  add(body, mb('oxBows', [[0.025, 0.26, 0.025, 0.17, 0.07, 0], [0.025, 0.26, 0.025, -0.17, 0.07, 0]]), woodL, [0, 0, OZ + 0.3]);
  add(body, mergedCyls('oxTassels', [[0.03, 0, 0.1, 0.31, 0.12, 0, 0, 0, 5], [0.03, 0, 0.1, -0.31, 0.12, 0, 0, 0, 5]]), team, [0, 0, OZ + 0.3]);
  // wagon bed
  const bedY = 0.46, W = 0.8, z0 = -1.14, z1 = -0.04, BL = z1 - z0, bz = (z0 + z1) / 2;
  add(root, geo.box(W, 0.05, BL), woodD, [0, bedY, bz]);
  for (const s of [1, -1]) {
    add(root, geo.box(0.04, 0.24, BL), wood, [s * (W / 2 - 0.02), bedY + 0.12, bz]);
    add(root, geo.box(0.05, 0.035, BL + 0.02), team, [s * (W / 2 - 0.02), bedY + 0.255, bz]);
    add(root, geo.box(0.07, 0.07, BL + 0.12), woodD, [s * 0.24, bedY - 0.06, bz]);
    beam(root, [s * 0.24, bedY - 0.02, z1], [s * 0.27, 0.8, OZ + 0.3], 0.045, wood); // shafts
  }
  add(root, mb('wagonPlanks', [1, -1].flatMap((s) => [[0.012, 0.015, BL, s * (W / 2 + 0.002), bedY + 0.08, 0], [0.012, 0.015, BL, s * (W / 2 + 0.002), bedY + 0.16, 0]])), woodD, [0, 0, bz]);
  add(root, geo.box(W, 0.3, 0.04), wood, [0, bedY + 0.15, z1]);
  add(root, geo.box(W, 0.05, 0.04), woodD, [0, bedY + 0.06, z0 + 0.02]); // tailboard (down)
  add(root, geo.box(W - 0.06, 0.05, 0.18), woodL, [0, bedY + 0.3, z1 - 0.12]); // bench
  for (const [z, y] of [[-0.3, 0.25], [-0.9, 0.3]]) add(root, geo.cyl(0.025, 0.025, 1.0, 6), iron, [0, y, z], [0, 0, HALF_PI]);
  const wheels = [];
  for (const s of [1, -1]) {
    wheels.push(spokedWheel(root, 'wagonF', s * 0.47, 0.25, -0.3, 0.25, { rim: woodD, spoke: wood, hub: iron, n: 6, w: 0.045, tube: 0.032, rs: 3 }));
    wheels.push(spokedWheel(root, 'wagonR', s * 0.47, 0.3, -0.9, 0.3, { rim: woodD, spoke: wood, hub: iron, n: 6, w: 0.045, tube: 0.032, rs: 3 }));
  }
  // canvas cover on hoops, front closed with a puckered opening, back open
  const cz0 = -0.22, cz1 = -0.78, cy = bedY + 0.24;
  add(root, halfTube(), canvas, [0, cy, (cz0 + cz1) / 2], null, [0.43, 0.62, cz0 - cz1]);
  add(root, halfDisc(), canvasD, [0, cy, cz0], null, [0.43, 0.62, 1]);
  add(root, halfDisc(), mat(0x2a221a, { side: THREE.DoubleSide }), [0, cy, cz0 + 0.006], null, [0.17, 0.3, 1]);
  for (const z of [cz0, (cz0 + cz1) / 2, cz1]) add(root, geo.torus(0.44, 0.024, 3, 7, Math.PI), woodL, [0, cy, z], null, [1, 1.43, 1]);
  // cargo at the open back: chests of gold, sacks
  chest(root, 'wagonA', 0.17, bedY + 0.025, -0.96, 0.05, { body: mat(0x6a4224), band: iron, gold, open: true });
  chest(root, 'wagonB', -0.18, bedY + 0.025, -0.95, -0.08, { body: mat(0x5a3820), band: iron, gold, open: false });
  add(root, mergedRocks('wagonGold', [[0.05, 0.05, 0.03, -1.1, 0.5], [0.04, -0.06, 0.03, -1.11, 0.5], [0.035, 0.28, 0.03, -1.1, 0.5]], 'ico'), gold, [0, bedY, 0]);
  add(root, mergedRocks('wagonSacks', [[0.11, -0.2, 0.32, -0.92, 0.75], [0.09, 0.24, 0.12, -0.72, 1.1]], 'ico'), mat(0xb89a6a), [0, bedY, 0]);
  // merchant on the bench with a goad
  const m = grp(root, 0.05, bedY + 0.33, z1 - 0.12);
  const robe = mat(0x6a4a7a), skin = mat(P.skin);
  add(m, CG.frustum(1.2), robe, [0, 0.13, 0], null, [0.22, 0.26, 0.17]);
  add(m, geo.box(0.23, 0.04, 0.18), mat(P.gold), [0, 0.05, 0]);
  add(m, mb('merchLegs', [[0.075, 0.07, 0.2, 0.055, 0.0, 0.09], [0.075, 0.07, 0.2, -0.055, 0.0, 0.09], [0.07, 0.2, 0.075, 0.055, -0.1, 0.18], [0.07, 0.2, 0.075, -0.055, -0.1, 0.18]]), robe);
  add(m, geo.sphere(0.08, 6, 5), skin, [0, 0.34, 0.01]);
  add(m, geo.cone(0.055, 0.1, 5), mat(0x3a2a1a), [0, 0.27, 0.06], [Math.PI - 0.4, 0, 0]);
  add(m, geo.sphere(0.088, 6, 4), mat(C.linen), [0, 0.39, -0.01], null, [1.05, 0.72, 1.05]);
  for (const s of [1, -1]) beam(m, [s * 0.11, 0.24, 0], [s * 0.07, 0.15, 0.17], 0.055, robe);
  rod(m, [-0.07, 0.15, 0.17], [-0.2, 0.55, 0.85], 0.01, mat(P.woodLight), 4);
  // team pennant on the canopy front
  flag(root, -0.36, cy, cz0 + 0.04, tc, { pole: 0.86, w: 0.3, h: 0.17, dir: -1, poleR: 0.018 });
  return { root, parts: { body, legs, wheels }, height: 1.6, radius: 0.8 };
}

// ===========================================================================
// Stone Age buildings
// ===========================================================================

/** Carved totem: stacked faces with team paint, thunderbird wings. Origin at its base. */
function totemPole(parent, x, y, z, ry, tc) {
  const t = grp(parent, x, y, z, ry);
  const wood = mat(0x8a5a32), woodD = mat(0x5a3a1c), team = mat(tc), teamD = mat(shade(tc, 0.6)), white = mat(C.ivory), black = mat(P.black);
  add(t, geo.cyl(0.11, 0.13, 2.25, 8), wood, [0, 1.125, 0]);
  add(t, mergedRocks('totemBase', [[0.13, 0.1, 0.06, 0.08, 0.5], [0.12, -0.1, 0.06, 0.06, 0.5], [0.11, 0.0, 0.05, -0.12, 0.5]], 'ico'), mat(P.stoneDark));
  // three carved heads: alternately team-painted and bare wood
  const heads = [[0.42, team], [0.98, wood], [1.52, team]];
  for (const [hy, m] of heads) {
    add(t, geo.cyl(0.155, 0.15, 0.4, 8), m, [0, hy, 0]);
    add(t, geo.cyl(0.165, 0.165, 0.04, 6), woodD, [0, hy + 0.2, 0]);
  }
  const faces = [];
  for (const [hy] of heads) {
    faces.push([0.07, 0.07, 0.03, -0.065, hy + 0.06, 0.15], [0.07, 0.07, 0.03, 0.065, hy + 0.06, 0.15]);
  }
  add(t, mb('totemEyeWhites', faces), white);
  add(t, mb('totemPupils', heads.flatMap(([hy]) => [[0.035, 0.035, 0.02, -0.065, hy + 0.06, 0.168], [0.035, 0.035, 0.02, 0.065, hy + 0.06, 0.168]])), black);
  add(t, mb('totemMouths', heads.map(([hy]) => [0.14, 0.04, 0.03, 0, hy - 0.09, 0.15])), black);
  add(t, mergedCyls('totemBeaks', [[0, 0.05, 0.14, 0, 0.98, 0.2, HALF_PI, 0, 4], [0, 0.045, 0.12, 0, 0.42, 0.19, HALF_PI, 0, 4]]), woodD);
  // thunderbird on top
  add(t, geo.cyl(0.13, 0.14, 0.3, 8), wood, [0, 2.08, 0]);
  for (const s of [1, -1]) {
    add(t, geo.box(0.46, 0.16, 0.05), team, [s * 0.33, 2.02, 0], [0, 0, s * 0.32]);
    add(t, geo.box(0.32, 0.06, 0.055), teamD, [s * 0.37, 1.95, 0], [0, 0, s * 0.32]);
    add(t, geo.box(0.1, 0.12, 0.055), white, [s * 0.54, 2.14, 0], [0, 0, s * 0.32]);
  }
  add(t, geo.box(0.16, 0.2, 0.2), team, [0, 2.32, 0.02]);
  add(t, geo.cone(0.06, 0.2, 4), mat(0xe8b040), [0, 2.3, 0.2], [HALF_PI + 0.3, Math.PI / 4, 0]);
  add(t, mb('totemTopEyes', [[0.04, 0.04, 0.02, 0.05, 2.36, 0.12], [0.04, 0.04, 0.02, -0.05, 2.36, 0.12]]), white);
  add(t, geo.cone(0.09, 0.2, 4), teamD, [0, 2.5, -0.04], [-0.3, 0, 0]);
  return t;
}

// Stone Age town center: a great mammoth-bone lodge (hide dome on a ring of stacked jawbones, tusk ribs,
// tusk-arched entrance under a mammoth skull, team-painted band), central fire pit with a spit, drying
// racks, firewood, a stretched team hide, bone pile, a carved totem pole with team paint.
export function stone_camp(tc) {
  const root = new THREE.Group();
  const team = mat(tc), teamD = mat(shade(tc, 0.6));
  const hide = mat(C.hide), hideD = mat(C.hideD), hideL = mat(C.hideL), hideR = mat(C.hideR);
  const ivory = mat(C.ivory), ivoryD = mat(C.ivoryD), wood = mat(P.wood), woodD = mat(P.woodDark), dark = mat(C.dark);
  // trodden earth: an octagon whose flats reach the footprint edges
  add(root, geo.cyl(2.075, 2.08, 0.04, 8), mat(C.earth), [0, 0.02, 0], [0, Math.PI / 8, 0]);
  const by = 0.04;
  // the great lodge
  const hz = -0.42, HX = 1.3, HY = 1.68, HZ = 0.96;
  add(root, hemi(), hide, [0, by, hz], null, [HX, HY, HZ]);
  const S = (k) => [HX * k, HY * k, HZ * k];
  for (const [p0, pl, t0, tl, m] of [
    [0.25, 0.7, 0.3, 0.5, hideD], [1.9, 0.55, 0.42, 0.42, hideL], [3.4, 0.8, 0.22, 0.5, hideR], [4.6, 0.7, 0.45, 0.4, hideD],
    [5.5, 0.6, 1.16, 0.32, hideL], [2.45, 0.55, 1.16, 0.32, hideR], [0.85, 0.5, 1.18, 0.3, hideL], [4.0, 0.5, 1.15, 0.33, hideR],
  ]) add(root, patch(p0, pl, t0, tl), m, [0, by, hz], null, S(1.006));
  add(root, zone(0.9, 1.08), team, [0, by, hz], null, S(1.012));
  add(root, zone(0.82, 0.86), teamD, [0, by, hz], null, S(1.012));
  // smoke hole with a hide collar and crossed poles
  add(root, geo.cyl(0.15, 0.15, 0.03, 8), dark, [0, by + HY - 0.005, hz]);
  add(root, geo.torus(0.16, 0.045, 4, 10), hideD, [0, by + HY - 0.02, hz], [HALF_PI, 0, 0]);
  for (const a of [0.4, 1.95, 3.5, 5.05]) {
    rod(root, [Math.cos(a) * 0.09, by + HY - 0.1, hz + Math.sin(a) * 0.09], [-Math.cos(a) * 0.17, by + HY + 0.3, hz - Math.sin(a) * 0.17], 0.025, woodD, 5);
  }
  // two courses of stacked mammoth jawbones round the base (gap at the entrance)
  const c1 = [], c2 = [];
  const N = 19;
  for (let i = 0; i < N; i++) {
    for (const [list, off, w, h, y, k] of [[c1, 0.5, 0.42, 0.15, 0.075, 0.07], [c2, 0, 0.38, 0.13, 0.21, 0.04]]) {
      const a = ((i + off) / N) * TAU;
      if (Math.cos(a) > 0.9) continue;
      list.push([w, h, 0.13, Math.sin(a) * (HX + k), y, Math.cos(a) * (HZ + k), a]);
    }
  }
  add(root, mb('campJaws1', c1), ivoryD, [0, by, hz]);
  add(root, mb('campJaws2', c2), ivory, [0, by, hz]);
  // tusk ribs arching over the dome
  for (const dz of [0.34, -0.36]) {
    const f = Math.sqrt(1 - (dz / HZ) ** 2);
    const x0 = HX * f + 0.08, dx = x0 - 0.03, dy = HY * f + 0.1;
    const c = 2 * Math.atan(dx / dy), R = dy / Math.sin(c);
    for (const s of [1, -1]) {
      const m = add(root, tuskGeo(R * c, 0.075, 0.035, c, 5, 5), ivory, [s * x0, by, hz + dz]);
      basis(m, [0, 1, 0], [-s, 0, 0]);
    }
  }
  // entrance: porch dome, dark doorway, team hide flap, tusk arch, mammoth skull
  const ez = hz + HZ - 0.08;
  add(root, hemiLo(), hideD, [0, by, ez], null, [0.54, 0.8, 0.5]);
  add(root, hemiLo(), dark, [0, by, ez + 0.47], null, [0.27, 0.5, 0.07]);
  add(root, geo.box(0.2, 0.44, 0.03), team, [0.25, by + 0.23, ez + 0.47], [-0.25, 0.3, 0.12]);
  {
    const dx = 0.58, dy = 1.1, c = 2 * Math.atan(dx / dy), R = dy / Math.sin(c);
    for (const s of [1, -1]) basis(add(root, tuskGeo(R * c, 0.085, 0.03, c, 5, 5), ivory, [s * 0.61, by, ez + 0.52]), [0, 1, 0], [-s, 0, 0]);
  }
  const sk = grp(root, 0, by + 0.98, ez + 0.08);
  add(sk, geo.dodeca(0.2), ivoryD, [0, 0, 0], [0.3, 0.2, 0], [1.25, 1.0, 0.9]);
  add(sk, geo.sphere(0.17, 7, 5), ivory, [0, 0.1, -0.03], null, [1.1, 0.9, 0.9]);
  add(sk, mb('skullSockets', [[0.07, 0.06, 0.04, 0.1, 0.0, 0.17], [0.07, 0.06, 0.04, -0.1, 0.0, 0.17], [0.09, 0.1, 0.04, 0, -0.1, 0.17]]), dark);
  // central fire pit with a spit
  const fx = 0.4, fz = 1.42;
  add(root, stoneRing('campFire', 10, 0.32, 0.075), mat(P.stoneDark), [fx, by, fz]);
  add(root, geo.cyl(0.26, 0.28, 0.03, 10), mat(0x2a2420), [fx, by + 0.015, fz]);
  add(root, mb('campFireLogs', [[0.42, 0.06, 0.07, 0, 0.05, 0, 0.6], [0.42, 0.06, 0.07, 0, 0.08, 0, -0.6], [0.36, 0.06, 0.07, 0, 0.06, 0, HALF_PI]]), woodD, [fx, by, fz]);
  const coals = add(root, geo.box(0.2, 0.03, 0.2), glowMat(0xff5a10, 0.8), [fx, by + 0.04, fz]);
  coals.castShadow = false;
  const fl = fire(root, fx, by + 0.07, fz, 0.46);
  for (const s of [1, -1]) {
    add(root, geo.box(0.035, 0.62, 0.035), woodD, [fx + s * 0.38, by + 0.31, fz]);
    add(root, geo.box(0.035, 0.12, 0.035), woodD, [fx + s * 0.4, by + 0.64, fz], [0, 0, -s * 0.5]);
  }
  add(root, geo.cyl(0.018, 0.018, 0.9, 5), wood, [fx, by + 0.62, fz], [0, 0, HALF_PI]);
  add(root, geo.dodeca(0.075), mat(0x8a3a24), [fx + 0.1, by + 0.62, fz], null, [1.5, 0.9, 1]);
  add(root, geo.cyl(0.075, 0.075, 0.6, 6), mat(0x7a4e28), [-0.35, by + 0.075, 1.5], [0, 0.35, HALF_PI]); // seat log
  // drying rack with hides and meat strips (front left)
  const rk = grp(root, -1.18, by, 1.12, 0.25);
  for (const s of [1, -1]) add(rk, geo.box(0.05, 0.86, 0.05), woodD, [s * 0.4, 0.43, 0]);
  add(rk, geo.box(0.92, 0.045, 0.045), woodD, [0, 0.84, 0]);
  add(rk, geo.box(0.3, 0.46, 0.02), hideL, [-0.2, 0.6, 0.01], [0, 0, 0.04]);
  add(rk, geo.box(0.24, 0.4, 0.02), hideR, [0.16, 0.62, 0.01], [0, 0, -0.05]);
  add(rk, mb('campMeat', [0.03, 0.08, 0.13, 0.32].map((x, i) => [0.035, 0.2 + (i % 2) * 0.06, 0.015, x + 0.0, 0.72 - (i % 2) * 0.03, 0.03])), mat(0x8a3a28));
  // stretched team-painted hide on a hoop (left side)
  const hf = grp(root, -1.62, by, 0.12, 1.1);
  add(hf, geo.torus(0.3, 0.025, 4, 12), woodD, [0, 0.42, 0]);
  add(hf, geo.cyl(0.27, 0.27, 0.015, 12), hideL, [0, 0.42, 0], [HALF_PI, 0, 0]);
  add(hf, geo.cyl(0.17, 0.17, 0.02, 10), team, [0, 0.42, 0.004], [HALF_PI, 0, 0]);
  add(hf, mb('hoopLegs', [[0.04, 0.36, 0.04, -0.2, 0.18, -0.04], [0.04, 0.36, 0.04, 0.2, 0.18, -0.04]]), woodD);
  // leaning spears (left side, against the lodge)
  for (const [x, z, rz] of [[-1.38, -0.65, 0.18], [-1.42, -0.5, 0.22], [-1.36, -0.82, 0.14]]) {
    const sp = grp(root, x, by, z);
    sp.rotation.z = rz;
    add(sp, geo.cyl(0.014, 0.016, 1.1, 4), wood, [0, 0.55, 0]);
    add(sp, geo.cone(0.03, 0.12, 4), mat(0x55524c), [0, 1.16, 0]);
  }
  // firewood (right side, along Z)
  logPile(root, 'camp', 1.62, by, -0.1, [3, 2, 1], { len: 0.8, r: 0.08, ry: HALF_PI });
  // bone pile with a skull and tusks (back right)
  const bp = grp(root, 1.28, by, -1.42, -0.6);
  add(bp, mb('campBones', [[0.42, 0.06, 0.07, 0, 0.03, 0, 0.3], [0.38, 0.06, 0.07, 0.02, 0.06, 0.08, -0.5], [0.3, 0.06, 0.07, -0.08, 0.09, -0.04, 1.1], [0.34, 0.06, 0.06, 0.1, 0.03, -0.12, 1.8]]), ivoryD);
  add(bp, geo.dodeca(0.17), ivory, [-0.05, 0.16, 0.1], [0.4, 0.5, 0], [1.2, 0.95, 0.9]);
  for (const s of [1, -1]) basis(add(bp, tuskGeo(0.6, 0.05, 0.02, 1.4, 4, 5), ivory, [s * 0.08, 0.1, 0.25]), [s * 0.4, 0.2, 1], [0, 1, 0]);
  // hide store tent (back left)
  add(root, geo.cone(0.38, 0.8, 7), hideR, [-1.3, by + 0.4, -1.3]);
  add(root, geo.cyl(0.25, 0.3, 0.1, 7), team, [-1.3, by + 0.3, -1.3]);
  add(root, mergedCyls('storePoles', [0, 2.1, 4.2].map((a) => [0.012, 0.012, 0.3, -1.3 + Math.cos(a) * 0.03, by + 0.86, -1.3 + Math.sin(a) * 0.03, Math.sin(a) * 0.25, -Math.cos(a) * 0.25, 4])), woodD);
  // totem pole (front right) and a team banner pole (front left)
  totemPole(root, 1.26, by, 1.16, -0.3, tc);
  flag(root, -1.5, by, 0.72, tc, { pole: 1.9, w: 0.5, h: 0.32, dir: 1, finial: C.ivory });
  return { root, parts: { fire: [fl], glow: [coals] }, height: 2.6, radius: 1.95 };
}

// Stone Age dwelling: hide tipi with team-painted bands and zigzag, crossed poles and a smoke wisp, a small
// yard with a hearth ring, a stretched team-marked hide, firewood, a clay pot and a grinding stone.
export function house_stone(tc) {
  const root = new THREE.Group();
  const hide = mat(0xcaa878), hideD = mat(0x9c7a4c), hideL = mat(C.hideL), team = mat(tc), teamD = mat(shade(tc, 0.6));
  const woodD = mat(P.woodDark), dark = mat(C.dark);
  add(root, geo.cyl(0.95, 0.96, 0.04, 16), mat(C.earth), [0, 0.02, 0]);
  const by = 0.04, tz = -0.1, TR = 0.78, TH = 1.2;
  const slope = Math.atan(TR / TH);
  const rAt = (y) => TR * (1 - y / TH);
  add(root, geo.cone(TR, TH, 12), hide, [0, by + TH / 2, tz]);
  const ring = (y0, y1, m, grow = 0.012) => add(root, geo.cyl(rAt(y1) + grow, rAt(y0) + grow, y1 - y0, 12), m, [0, by + (y0 + y1) / 2, tz]);
  ring(0.0, 0.07, hideD);
  ring(0.3, 0.45, team);
  ring(0.52, 0.56, teamD);
  ring(0.8, 0.86, team);
  // painted team zigzag between the bands (triangles lying on the cone surface)
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + 0.35;
    if (Math.cos(a) > 0.93) continue; // keep the doorway clear
    const yy = 0.565, rr = rAt(yy) + 0.009;
    const tg = grp(root, Math.sin(a) * rr, by + yy, tz + Math.cos(a) * rr, a);
    add(tg, CG.pennant(), teamD, [0, 0, 0], [-slope, 0, HALF_PI], [0.17, 0.14, 0.01]);
  }
  // doorway (dark triangle), hide flap pinned aside, lacing above
  add(root, CG.pennant(), dark, [0, by, tz + TR + 0.008], [-slope, 0, HALF_PI], [0.55, 0.4, 0.02]);
  add(root, geo.box(0.22, 0.44, 0.02), hideL, [0.24, by + 0.23, tz + TR - 0.06], [-slope, 0.45, 0.15]);
  beam(root, [0, by + 0.6, tz + rAt(0.6) + 0.012], [0, by + 0.95, tz + rAt(0.95) + 0.012], 0.022, woodD, 0.012);
  // poles crossing above the smoke hole
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + 0.3;
    const bx = Math.sin(a) * TR, bzz = Math.cos(a) * TR;
    const p = (t) => [bx * (1 - t), by + TH * t, tz + bzz * (1 - t)];
    rod(root, p(0.8), p(1.22), 0.016, woodD, 4);
  }
  add(root, geo.cyl(0.05, 0.06, 0.04, 6), dark, [0, by + TH - 0.06, tz]);
  // smoke wisp (slowly turns and bobs)
  const smoke = grp(root, 0, 0, 0);
  const sm = mat(0xb9b6ae, { transparent: true, opacity: 0.55 });
  for (const [x, y, z, sz] of [[0.02, 1.4, tz, 0.08], [-0.04, 1.5, tz + 0.03, 0.066], [0.02, 1.59, tz - 0.03, 0.052]]) {
    add(smoke, geo.ico(sz, 0), sm, [x, y, z]).castShadow = false;
  }
  // yard: hearth ring with embers, stretched hide on a frame, firewood, clay pot, grinding stone
  const hx = 0.6, hzz = 0.72;
  add(root, stoneRing('hutHearth', 7, 0.15, 0.045), mat(P.stoneDark), [hx, by, hzz]);
  const em = add(root, geo.box(0.12, 0.025, 0.12), glowMat(0xff5a10, 0.6), [hx, by + 0.02, hzz]);
  em.castShadow = false;
  add(root, mb('hutHearthLogs', [[0.2, 0.04, 0.045, 0, 0.04, 0, 0.5], [0.2, 0.04, 0.045, 0, 0.06, 0, -0.6]]), woodD, [hx, by, hzz]);
  const fr = grp(root, -0.66, by, 0.58, 0.75);
  add(fr, mb('hutFrame', [[0.04, 0.62, 0.04, -0.24, 0.31, 0], [0.04, 0.62, 0.04, 0.24, 0.31, 0], [0.56, 0.035, 0.035, 0, 0.58, 0], [0.56, 0.035, 0.035, 0, 0.16, 0]]), woodD);
  add(fr, geo.box(0.4, 0.36, 0.015), hideL, [0, 0.37, 0]);
  add(fr, geo.box(0.13, 0.13, 0.02), team, [0, 0.37, 0.004], [0, 0, Math.PI / 4]);
  logPile(root, 'hut', -0.72, by, -0.62, [3, 2], { len: 0.4, r: 0.055, ry: 0.75 });
  add(root, geo.sphere(0.09, 7, 5), mat(C.terracotta), [0.68, by + 0.08, -0.66], null, [1, 0.85, 1]);
  add(root, geo.cyl(0.05, 0.06, 0.04, 7), mat(0x8a4a2a), [0.68, by + 0.16, -0.66]);
  add(root, geo.cyl(0.1, 0.12, 0.05, 7), mat(P.stone), [-0.2, by + 0.025, 0.82]);
  add(root, geo.dodeca(0.04), mat(P.stoneDark), [-0.18, by + 0.07, 0.82], null, [1.4, 0.6, 1]);
  return { root, parts: { spin: [smoke], bob: [smoke] }, height: 1.45, radius: 0.95 };
}

// ===========================================================================
// Bronze Age town center
// ===========================================================================

/** "Horns of consecration": base block with two upswept horns (origin at its base). */
const hornsGeo = () => geo.custom('anc:horns', () => {
  const parts = [new THREE.BoxGeometry(0.3, 0.06, 0.1).translate(0, 0.03, 0)];
  for (const s of [1, -1]) {
    const h = new THREE.CylinderGeometry(0.0, 0.05, 0.22, 5);
    h.rotateZ(-s * 0.35);
    h.translate(s * 0.12, 0.15, 0);
    parts.push(h);
  }
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g;
});

/** Bronze tripod brazier with a fire; returns { fire, glow }. */
function brazier(parent, x, y, z, bronze, bronzeD) {
  const g = grp(parent, x, y, z);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    beam(g, [Math.sin(a) * 0.17, 0, Math.cos(a) * 0.17], [Math.sin(a) * 0.08, 0.5, Math.cos(a) * 0.08], 0.03, bronzeD);
  }
  add(g, geo.cyl(0.18, 0.09, 0.13, 10), bronze, [0, 0.55, 0]);
  add(g, geo.torus(0.18, 0.02, 4, 10), bronzeD, [0, 0.615, 0], [HALF_PI, 0, 0]);
  const coals = add(g, geo.cyl(0.15, 0.15, 0.02, 8), glowMat(0xff5a10, 0.8), [0, 0.61, 0]);
  coals.castShadow = false;
  const fl = fire(g, 0, 0.62, 0, 0.42);
  return { fire: fl, glow: coals };
}

/** Pithos (big storage jar), origin at its base. */
function pithos(parent, x, y, z, s, clay, band) {
  const g = grp(parent, x, y, z);
  g.scale.setScalar(s);
  add(g, geo.sphere(0.15, 7, 5), clay, [0, 0.2, 0], null, [1, 1.35, 1]);
  add(g, geo.cyl(0.085, 0.06, 0.1, 6), clay, [0, 0.42, 0]);
  add(g, geo.cyl(0.153, 0.153, 0.025, 7), band, [0, 0.25, 0]);
  return g;
}

// Bronze Age town center: a mud-brick and ashlar megaron on a stepped plinth. A deep porch with red Minoan
// columns under a lower team-trimmed roof, the tall hall behind it with a painted team frieze and rosettes,
// flat roofs edged in team color with horns of consecration, a clerestory storey with a striped team
// awning and flag, side storerooms, bronze braziers, storage jars, oxhide ingots and a bronze bull.
export function bronze_hall(tc) {
  const root = new THREE.Group();
  const team = mat(tc);
  const stone = mat(0xcbbb98), stoneD = mat(0xa39272), stoneL = mat(0xe4d8ba);
  const mud = mat(C.mud), mudD = mat(C.mudD), plaster = mat(0xeadfc4), plasterD = mat(0xcfc09c), timber = mat(0x5a3a1e);
  const bronze = mat(C.bronze), bronzeD = mat(C.bronzeD);
  const red = mat(0xa52a22), black = mat(0x2a221e), dark = mat(C.dark), gold = mat(P.gold);
  // stepped plinth + team runner up the front stair
  add(root, geo.box(3.86, 0.14, 3.86), stoneD, [0, 0.07, 0]);
  add(root, geo.box(3.58, 0.14, 3.58), stone, [0, 0.21, 0]);
  add(root, geo.box(3.3, 0.12, 3.3), stoneL, [0, 0.34, 0]);
  const b = 0.4;
  add(root, mb('hallRunner', [[0.6, 0.012, 0.15, 0, 0.146, 1.86], [0.6, 0.012, 0.15, 0, 0.286, 1.72], [0.6, 0.012, 0.64, 0, 0.406, 1.33]]), team);
  add(root, mb('hallRunnerHem', [[0.66, 0.008, 0.155, 0, 0.144, 1.86], [0.66, 0.008, 0.155, 0, 0.284, 1.72], [0.66, 0.008, 0.645, 0, 0.404, 1.33]]), gold);
  // the tall hall: ashlar socle, mud brick laced with timber, team frieze with pale rosettes
  const hz = -0.5, HW = 2.16, HD = 1.9, HH = 1.75, fz = hz + HD / 2;
  add(root, geo.box(HW + 0.08, 0.26, HD + 0.08), stoneD, [0, b + 0.13, hz]);
  add(root, geo.box(HW, HH, HD), mud, [0, b + HH / 2, hz]);
  add(root, mb('hallTimber', [0.62, 1.05].map((y) => [HW + 0.03, 0.06, HD + 0.03, 0, y, 0])), timber, [0, b, hz]);
  add(root, geo.box(HW + 0.04, 0.2, HD + 0.04), team, [0, b + HH - 0.16, hz]);
  const ros = [];
  for (let i = 0; i < 7; i++) ros.push([0.055, 0.055, 0.02, -0.9 + i * 0.3, 0, 0, HALF_PI, 0, 6]);
  add(root, mergedCyls('hallRosettes', ros), stoneL, [0, b + HH - 0.16, fz + 0.025]);
  add(root, mergedCyls('hallRosettesSide', [-0.6, 0, 0.6].flatMap((z) => [[0.055, 0.055, 0.02, HW / 2 + 0.025, 0, z, 0, HALF_PI, 6], [0.055, 0.055, 0.02, -HW / 2 - 0.025, 0, z, 0, HALF_PI, 6]])), stoneL, [0, b + HH - 0.16, hz]);
  add(root, mb('hallClerestory', [-0.66, -0.22, 0.22, 0.66].map((x) => [0.15, 0.2, 0.03, x, 0, 0])), dark, [0, b + 1.43, fz + 0.005]);
  add(root, mb('hallSideWins', [-0.75, -0.25].flatMap((z) => [[0.03, 0.24, 0.15, HW / 2 + 0.005, 0, z], [0.03, 0.24, 0.15, -HW / 2 - 0.005, 0, z]])), dark, [0, b + 1.3, 0]);
  // main roof: slab, parapet with a team cap, horns of consecration along the front
  const RY = b + HH, RW = HW + 0.12, RD = HD + 0.12;
  add(root, geo.box(RW, 0.1, RD), plaster, [0, RY + 0.05, hz]);
  const par = [[RW, 0.1, 0.08, 0, 0, RD / 2 - 0.04], [RW, 0.1, 0.08, 0, 0, -RD / 2 + 0.04], [0.08, 0.1, RD - 0.16, RW / 2 - 0.04, 0, 0], [0.08, 0.1, RD - 0.16, -RW / 2 + 0.04, 0, 0]];
  add(root, mb('hallParapet', par), plasterD, [0, RY + 0.15, hz]);
  add(root, mb('hallParapetCap', par.map(([w, , d, x, , z]) => [w + 0.01, 0.035, d + 0.01, x, 0, z])), team, [0, RY + 0.215, hz]);
  for (const x of [-0.8, -0.4, 0.4, 0.8]) add(root, hornsGeo(), stoneL, [x, RY + 0.23, hz + RD / 2 - 0.04]);
  // porch: lower roof on two red Minoan columns and mud-brick antae, bronze double door, team banners
  const PD = 0.62, PH = 1.2, pz = fz + PD / 2;
  for (const s of [1, -1]) {
    const ax = s * (HW / 2 - 0.13);
    add(root, geo.box(0.26, PH, PD), mud, [ax, b + PH / 2, pz]);
    add(root, geo.box(0.3, 0.26, PD + 0.04), stoneD, [ax, b + 0.13, pz]);
    add(root, geo.box(0.29, 0.06, PD + 0.03), timber, [ax, b + 0.62, pz]);
    banner(root, ax, b + PH - 0.06, fz + PD + 0.04, tc, { w: 0.22, h: 0.56, trim: C.bronze, emblem: C.bronzeL });
  }
  for (const x of [-0.38, 0.38]) {
    const cz = fz + PD - 0.14, sh = PH - 0.18;
    add(root, geo.cyl(0.13, 0.14, 0.06, 8), stoneL, [x, b + 0.03, cz]);
    add(root, geo.cyl(0.11, 0.08, sh, 8), red, [x, b + 0.06 + sh / 2, cz]);
    add(root, geo.cyl(0.15, 0.12, 0.08, 8), black, [x, b + PH - 0.08, cz]);
    add(root, geo.box(0.28, 0.04, 0.28), black, [x, b + PH - 0.02, cz]);
  }
  add(root, geo.box(HW + 0.1, 0.06, PD + 0.1), team, [0, b + PH + 0.03, pz + 0.02]); // painted fascia
  add(root, geo.box(HW + 0.08, 0.07, PD + 0.08), plaster, [0, b + PH + 0.095, pz + 0.02]);
  add(root, mergedCyls('porchBeamEnds', [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9].map((x) => [0.03, 0.03, 0.04, x, 0, 0, HALF_PI, 0, 6])), timber, [0, b + PH + 0.03, fz + PD + 0.075]);
  for (const x of [-0.6, 0, 0.6]) add(root, hornsGeo(), stoneL, [x, b + PH + 0.13, fz + PD - 0.02], null, 0.8);
  add(root, geo.box(0.76, 1.0, 0.04), dark, [0, b + 0.5, fz + 0.01]);
  add(root, mb('hallDoor', [[0.31, 0.9, 0.04, -0.165, 0.45, 0], [0.31, 0.9, 0.04, 0.165, 0.45, 0]]), bronze, [0, b, fz + 0.03]);
  add(root, mb('hallDoorStuds', [-0.165, 0.165].flatMap((x) => [0.2, 0.45, 0.7].map((y) => [0.24, 0.03, 0.02, x, y, 0]))), bronzeD, [0, b, fz + 0.055]);
  add(root, geo.box(0.84, 0.08, 0.06), stoneL, [0, b + 1.04, fz + 0.02]);
  // clerestory storey with a team band, windows, flat roof, horns and the flag
  const uz = hz - 0.28, UW = 1.1, UD = 0.8, UH = 0.42, uy = RY + 0.1;
  add(root, geo.box(UW, UH, UD), mud, [0, uy + UH / 2, uz]);
  add(root, geo.box(UW + 0.03, 0.1, UD + 0.03), team, [0, uy + UH - 0.08, uz]);
  add(root, mb('upperWins', [-0.3, 0, 0.3].map((x) => [0.13, 0.18, 0.03, x, 0.17, 0])), dark, [0, uy, uz + UD / 2]);
  add(root, geo.box(UW + 0.12, 0.07, UD + 0.12), plaster, [0, uy + UH + 0.035, uz]);
  for (const s of [1, -1]) add(root, hornsGeo(), stoneL, [s * 0.38, uy + UH + 0.07, uz + UD / 2], null, 0.8);
  flag(root, 0, uy + UH + 0.07, uz - 0.15, tc, { pole: 0.62, w: 0.5, h: 0.3, dir: 1, finial: C.bronzeL });
  // striped team awning on the roof terrace in front of the clerestory
  const aw = grp(root, 0, uy + 0.4, uz + UD / 2);
  aw.rotation.x = 0.3;
  for (let i = 0; i < 5; i++) add(aw, geo.box(0.2, 0.03, 0.56), i % 2 ? mat(C.linen) : team, [-0.4 + i * 0.2, 0, 0.28]);
  for (const s of [1, -1]) add(root, geo.cyl(0.018, 0.018, 0.26, 5), bronze, [s * 0.45, uy + 0.13, uz + UD / 2 + 0.52]);
  // side storerooms with team-trimmed flat roofs
  for (const s of [1, -1]) {
    const wx = s * 1.37;
    add(root, geo.box(0.46, 0.86, 1.5), mudD, [wx, b + 0.43, -0.72]);
    add(root, geo.box(0.47, 0.06, 1.51), timber, [wx, b + 0.5, -0.72]);
    add(root, geo.box(0.53, 0.05, 1.57), team, [wx, b + 0.885, -0.72]);
    add(root, geo.box(0.52, 0.06, 1.56), plaster, [wx, b + 0.94, -0.72]);
    add(root, geo.box(0.2, 0.42, 0.03), dark, [wx, b + 0.21, 0.035]);
    pithos(root, wx - s * 0.04, b + 0.97, -1.22, 0.75, mat(C.terracotta), mat(0x5a2a18));
  }
  // bronze braziers flanking the stair
  const fires = [], glows = [];
  for (const s of [1, -1]) {
    const br = brazier(root, s * 0.82, b, 1.4, bronze, bronzeD);
    fires.push(br.fire);
    glows.push(br.glow);
  }
  // front terraces: storage jars, oxhide copper ingots, a bronze bull on a pedestal
  const clay = mat(C.terracotta), clayBand = mat(0x5a2a18);
  for (const s of [1, -1]) {
    pithos(root, s * 1.36, b, 0.38, 1.0, clay, clayBand);
    pithos(root, s * 1.42, b, 0.76, 0.85, clay, clayBand);
  }
  const ing = [];
  for (let i = 0; i < 6; i++) ing.push([0.3, 0.035, 0.18, 0, 0.0175 + i * 0.037, 0, i % 2 ? HALF_PI : 0]);
  add(root, mb('ingots', ing), mat(0xb4683a), [-1.38, b, 1.32]);
  const bull = grp(root, 1.38, b, 1.3, -0.5);
  add(bull, geo.box(0.3, 0.16, 0.3), stoneL, [0, 0.08, 0]);
  add(bull, geo.box(0.16, 0.16, 0.3), bronze, [0, 0.35, 0]);
  add(bull, mb('bullLegs', [[0.04, 0.12, 0.04, 0.05, 0.22, 0.11], [0.04, 0.12, 0.04, -0.05, 0.22, 0.11], [0.04, 0.12, 0.04, 0.05, 0.22, -0.11], [0.04, 0.12, 0.04, -0.05, 0.22, -0.11]]), bronzeD);
  add(bull, geo.box(0.12, 0.12, 0.14), bronze, [0, 0.4, 0.2], [0.3, 0, 0]);
  for (const s of [1, -1]) basis(add(bull, tuskGeo(0.14, 0.018, 0.006, 1.4, 3, 4), mat(C.bronzeL), [s * 0.05, 0.46, 0.22]), [s, 0.2, 0], [0, 1, 0.2]);
  return { root, parts: { fire: fires, glow: glows }, height: 3.2, radius: 1.95 };
}

// ===========================================================================
// Farm (Stone -> Gunpowder Age)
// ===========================================================================

// Pre-industrial farm: tilled furrows of wheat and a vegetable bed, stick fence with a gate gap, a raised
// thatched granary in the back-left corner with sheaves, a scarecrow in team cloth.
export function farm_1(tc) {
  const root = new THREE.Group();
  const soil = mat(0x6e4a2a), soilL = mat(0x87603a), team = mat(tc), teamD = mat(shade(tc, 0.6));
  const wheat = mat(P.thatch), wheatD = mat(0xc49a44), woodD = mat(P.woodDark), woodL = mat(P.woodLight);
  const thatch = mat(P.thatch), thatchD = mat(P.thatchDark);
  add(root, geo.box(2.86, 0.05, 2.86), soil, [0, 0.025, 0]);
  // wheat: ridged rows across the front two thirds (a stalk band per row topped by ragged ears)
  const ridges = [], stalks = [], ears = [], ears2 = [];
  for (let j = 0; j < 6; j++) {
    const z = -0.12 + j * 0.25;
    ridges.push([2.62, 0.05, 0.14, 0, 0.065, z]);
    stalks.push([2.5, 0.2, 0.09, 0, 0.19, z]);
    for (let i = 0; i < 15; i++) {
      const x = -1.22 + i * 0.174 + (j % 2) * 0.06;
      const h = 0.17 + Math.sin(i * 1.7 + j * 2.3) * 0.04;
      (i % 3 === 1 ? ears2 : ears).push([0, 0.06, h, x, 0.28 + h / 2, z + Math.sin(i * 2.9 + j) * 0.02, 0, 0, 4]);
    }
  }
  add(root, mb('farmRidges', ridges), soilL);
  add(root, mb('farmStalks', stalks), wheatD);
  add(root, mergedCyls('farmWheat', ears), wheat);
  add(root, mergedCyls('farmWheat2', ears2), mat(0xe8c870));
  // vegetable bed (back right)
  const veg = [], vridge = [];
  for (let j = 0; j < 3; j++) {
    const z = -1.18 + j * 0.3;
    vridge.push([1.12, 0.05, 0.16, 0.7, 0.065, z]);
    for (let i = 0; i < 6; i++) veg.push([0.075 + (i % 2) * 0.01, 0.18 + i * 0.19, 0.12, z, 0.85, i]);
  }
  add(root, mb('farmVegRidges', vridge), soilL);
  add(root, mergedRocks('farmCabbage', veg, 'ico'), mat(0x5aa03a));
  // packed-earth yard (back left) with the granary
  add(root, geo.box(1.18, 0.012, 1.08), mat(0x9a7a50), [-0.78, 0.056, -0.83]);
  const gx = -0.86, gz = -0.86;
  add(root, mergedCyls('granaryStaddles', [[1, 1], [1, -1], [-1, 1], [-1, -1]].flatMap(([sx, sz]) => [
    [0.04, 0.06, 0.2, sx * 0.24, 0.15, sz * 0.24, 0, 0, 6], [0.1, 0.08, 0.04, sx * 0.24, 0.27, sz * 0.24, 0, 0, 6],
  ])), mat(P.stone), [gx, 0, gz]);
  add(root, geo.box(0.68, 0.05, 0.68), woodD, [gx, 0.31, gz]);
  add(root, geo.cyl(0.3, 0.31, 0.42, 10), mat(0x9c7b4f), [gx, 0.54, gz]);
  for (const y of [0.42, 0.58, 0.7]) add(root, geo.cyl(0.312, 0.316, 0.035, 10), mat(0x6b4f30), [gx, y, gz]);
  add(root, geo.box(0.18, 0.26, 0.04), mat(0x2a2014), [gx + 0.0, 0.5, gz + 0.3]);
  add(root, geo.box(0.12, 0.12, 0.02), team, [gx, 0.5, gz + 0.325], [0, 0, Math.PI / 4]);
  const ry0 = 0.75, rh = 0.42, rb = 0.5;
  add(root, geo.cone(rb, rh, 10), thatch, [gx, ry0 + rh / 2, gz]);
  thatchRings(root, ry0, rh, rb, 0.02, [0.05, 0.4], thatchD, 0.05, [gx, 0, gz]);
  add(root, geo.cone(0.035, 0.08, 4), team, [gx, ry0 + rh + 0.03, gz]);
  // ladder leaning on the platform
  const ld = grp(root, gx + 0.24, 0.05, gz + 0.48);
  ld.rotation.x = -0.35;
  add(ld, mb('farmLadder', [[0.025, 0.42, 0.025, -0.07, 0.21, 0], [0.025, 0.42, 0.025, 0.07, 0.21, 0], [0.16, 0.02, 0.02, 0, 0.1, 0], [0.16, 0.02, 0.02, 0, 0.22, 0], [0.16, 0.02, 0.02, 0, 0.34, 0]]), woodL);
  // sheaves stacked by the granary, a basket of grain, a water pot
  const sheaf = [];
  for (const [x, z, rz] of [[-0.28, -1.1, 0], [-0.16, -1.12, 0.1], [-0.22, -1.0, -0.08], [-0.4, -0.98, 0.15]]) sheaf.push([0.06, 0.05, 0.3, x, 0.2, z, 0, rz, 6]);
  add(root, mergedCyls('farmSheaves', sheaf), wheatD);
  add(root, mergedCyls('farmSheafTies', sheaf.map(([, , , x, y, z, rx, rz]) => [0.064, 0.064, 0.03, x, y + 0.02, z, rx, rz, 6])), woodD);
  add(root, geo.cyl(0.1, 0.075, 0.1, 8), mat(0xa08050), [-0.45, 0.1, -0.5]);
  add(root, geo.cyl(0.085, 0.085, 0.02, 8), wheat, [-0.45, 0.155, -0.5]);
  add(root, geo.sphere(0.08, 7, 5), mat(C.terracotta), [-1.25, 0.12, -0.38], null, [1, 0.9, 1]);
  // scarecrow in team cloth
  const sc = grp(root, 0.42, 0.05, 0.42, -0.3);
  add(sc, geo.cyl(0.022, 0.026, 1.0, 5), woodD, [0, 0.5, 0]);
  add(sc, geo.box(0.66, 0.03, 0.03), woodD, [0, 0.76, 0]);
  add(sc, CG.frustum(1.15), team, [0, 0.62, 0], null, [0.22, 0.3, 0.13]);
  add(sc, mb('scSleeves', [[0.24, 0.09, 0.1, 0.19, 0.755, 0], [0.24, 0.09, 0.1, -0.19, 0.755, 0]]), team);
  add(sc, mb('scRags', [[0.05, 0.08, 0.02, 0.24, 0.69, 0.04], [0.05, 0.1, 0.02, -0.2, 0.68, 0.04], [0.06, 0.09, 0.02, 0.05, 0.43, 0.06], [0.05, 0.08, 0.02, -0.07, 0.44, -0.06]]), teamD);
  add(sc, mergedCyls('scStraw', [[0.0, 0.035, 0.08, 0.34, 0.75, 0, 0, HALF_PI, 4], [0.0, 0.035, 0.08, -0.34, 0.75, 0, 0, -HALF_PI, 4], [0, 0.04, 0.09, 0, 0.42, 0, Math.PI, 0, 4]]), wheat);
  add(sc, geo.box(0.2, 0.035, 0.14), woodD, [0, 0.5, 0]);
  add(sc, geo.sphere(0.085, 7, 5), mat(0xd8c08a), [0, 0.88, 0]);
  add(sc, mb('scFace', [[0.025, 0.025, 0.01, 0.03, 0.9, 0.082], [0.025, 0.025, 0.01, -0.03, 0.9, 0.082], [0.06, 0.012, 0.01, 0, 0.85, 0.08]]), mat(P.black));
  add(sc, geo.cyl(0.16, 0.16, 0.015, 10), wheat, [0, 0.95, 0]);
  add(sc, geo.cone(0.085, 0.13, 8), wheatD, [0, 1.02, 0]);
  add(sc, geo.box(0.06, 0.05, 0.1), mat(P.black), [0.3, 0.8, 0]); // crow
  add(sc, geo.cone(0.012, 0.04, 4), mat(0xe8b040), [0.3, 0.8, 0.065], [HALF_PI, 0, 0]);
  // stick fence round the edge, gap at the front middle
  const E = 1.405, posts = [], rails = [];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const t = -E + (2 * E * i) / n;
    const h = 0.36 + Math.sin(i * 2.1) * 0.03;
    posts.push([0.05, h, 0.05, t, h / 2 + 0.05, -E], [0.05, h, 0.05, -E, h / 2 + 0.05, t], [0.05, h, 0.05, E, h / 2 + 0.05, t]);
    if (i !== 3 && i !== 4) posts.push([0.05, h, 0.05, t, h / 2 + 0.05, E]);
  }
  posts.push([0.05, 0.42, 0.05, -0.24, 0.26, E], [0.05, 0.42, 0.05, 0.24, 0.26, E]);
  for (const y of [0.18, 0.32]) {
    rails.push([2 * E, 0.03, 0.03, 0, y, -E], [0.03, 0.03, 2 * E, -E, y, 0], [0.03, 0.03, 2 * E, E, y, 0]);
    rails.push([E - 0.24, 0.03, 0.03, -(E + 0.24) / 2, y, E], [E - 0.24, 0.03, 0.03, (E + 0.24) / 2, y, E]);
  }
  add(root, mb('farmPosts', posts), woodD);
  add(root, mb('farmRails', rails), woodL);
  for (const s of [1, -1]) add(root, CG.pennant(), team, [s * 0.24, 0.42, E], [0, HALF_PI, 0], [0.16, 0.1, 0.01]);
  add(root, mb('farmRags', [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => [0.07, 0.09, 0.07, sx * E, 0.36, sz * E])), team);
  return { root, parts: {}, height: 1.2, radius: 1.45 };
}
