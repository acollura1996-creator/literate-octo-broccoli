// Future Age: power-armoured laser troopers, heavy exoskeletons, anti-gravity tanks and combat mechs,
// plus the Nexus arcology (town center), habitat pods, a hydroponic farm, tiling energy walls + gate and
// a laser defence tower. Look: sleek white and silver plating, glowing cyan energy, team-colored panels.
//
// Same conventions as ages.js: origin at ground center, facing +Z, weapon hand on -X, team color via
// mat(teamColor), cached geo/mat, everything casts shadows (add()).
// - parts.glow meshes pulse in scale (+-8%) about their own origin, so every glow piece is either small
//   or sits where the pulse stays hidden (the spire core inside its fins, the wall field over a static
//   copy of itself, door panes inside their frames).
// - Shooters rest with their barrels level along +Z. Each barrel tip carries an empty Object3D named
//   'muzzle' inside parts.weapon (weapon.getObjectByName('muzzle') / traverse for twin guns).
import {
  THREE, mat, geo, CG, glowMat, grp, add, beam, rod, rig, scaled, armMesh, grip, MELEE_TILT, mergedBoxes,
} from './common.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;

/** Future palette. */
const C = {
  white: 0xf2f5f9,
  pearl: 0xd9e0e8,
  silver: 0xaab5c3,
  steel: 0x77828f,
  gun: 0x4a525e,
  dark: 0x2a2f37,
  glass: 0x15202c,
  cyan: 0x3cf0ff,
  solar: 0x1d3f86,
  leaf: 0x3fae35,
  leafL: 0x86dc4c,
  grow: 0xe46cff,
  nutrient: 0x8dff5c,
};

/** The shared material set of a team. */
function mats(tc) {
  return {
    white: mat(C.white), pearl: mat(C.pearl), silver: mat(C.silver), steel: mat(C.steel), gun: mat(C.gun),
    dark: mat(C.dark), glass: mat(C.glass), team: mat(tc), cyan: glowMat(C.cyan, 1),
  };
}

/** Empty marker at a barrel tip (beams / muzzle flashes start here). */
function muzzle(parent, x, y, z) {
  const o = new THREE.Object3D();
  o.name = 'muzzle';
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

/** add() + register in a glow list. */
function glowAdd(list, parent, geometry, material, p, r, s) {
  const g = add(parent, geometry, material, p, r, s);
  list.push(g);
  return g;
}

/**
 * Cached merged cylinders / cones: [[rTop, rBot, h, x, y, z, rx = 0, rz = 0, seg = 8], ...],
 * each centered on (x, y, z). rx = HALF_PI lays a cylinder along Z, rz = HALF_PI along X.
 */
function mergedCyls(key, list) {
  return geo.custom(`fut-cyl:${key}`, () => {
    const parts = list.map(([rt, rb, h, x, y, z, rx = 0, rz = 0, seg = 8]) => {
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

/** Solid of revolution from a closed counter-clockwise (r, y) profile (faces point outward). */
function lathe(key, pts, segs = 24, phiStart = 0, phiLen = TAU) {
  return geo.custom(`fut-lathe:${key}`, () => {
    const v = pts.map(([r, y]) => new THREE.Vector2(r, y));
    if (!v[0].equals(v[v.length - 1])) v.push(v[0].clone());
    return new THREE.LatheGeometry(v, segs, phiStart, phiLen);
  });
}

/** Several partial lathes (window bands, arcs) merged: arcs = [[phiStart, phiLen], ...]. */
function latheArcs(key, pts, arcs, segs = 3) {
  return geo.custom(`fut-larcs:${key}`, () => {
    const v = pts.map(([r, y]) => new THREE.Vector2(r, y));
    v.push(v[0].clone());
    const list = arcs.map(([a, l]) => new THREE.LatheGeometry(v, segs, a, l).toNonIndexed());
    const g = mergeGeometries(list, false);
    for (const p of list) p.dispose();
    return g;
  });
}

/** Flat annulus ring (rIn..rOut), base at y = 0, height h. */
const annulus = (rIn, rOut, h, segs = 24) => lathe(`ann${rIn},${rOut},${h},${segs}`, [[rIn, 0], [rOut, 0], [rOut, h], [rIn, h]], segs);

/** Rounded-rectangle slab w x d, corner radius r, from y = 0 to y = h. */
function roundSlab(w, d, h, r, seg = 3) {
  return geo.custom(`fut-rslab:${w},${d},${h},${r},${seg}`, () => {
    const s = new THREE.Shape();
    const x = w / 2, z = d / 2;
    s.moveTo(-x + r, -z);
    s.lineTo(x - r, -z);
    s.absarc(x - r, -z + r, r, -HALF_PI, 0, false);
    s.lineTo(x, z - r);
    s.absarc(x - r, z - r, r, 0, HALF_PI, false);
    s.lineTo(-x + r, z);
    s.absarc(-x + r, z - r, r, HALF_PI, Math.PI, false);
    s.lineTo(-x, -z + r);
    s.absarc(-x + r, -z + r, r, Math.PI, Math.PI * 1.5, false);
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: seg });
    g.rotateX(-HALF_PI);
    return g;
  });
}

/**
 * Side profile [[z, y], ...] extruded across X to width w (centered on x = 0), with chamfered edges
 * (bevel) that stay inside the profile. Used for wedge hulls and turret heads.
 */
function profileX(key, pts, w, bevel = 0) {
  return geo.custom(`fut-prof:${key}`, () => {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    const depth = w - 2 * bevel;
    const g = new THREE.ExtrudeGeometry(s, bevel
      ? { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1 }
      : { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    g.rotateY(-HALF_PI); // shape x -> +Z, extrusion -> X
    return g;
  });
}

/**
 * n tapering fins with annular-sector cross-sections (rIn..rOut) around the Y axis, separated by
 * angular gaps, from y = 0 to y = h; at the top every radius is scaled by `taper`.
 */
function spireFins(key, n, gap, rIn, rOut, h, taper) {
  return geo.custom(`fut-fins:${key}`, () => {
    const list = [];
    const span = TAU / n;
    for (let i = 0; i < n; i++) {
      const a0 = i * span + gap / 2, a1 = (i + 1) * span - gap / 2;
      const s = new THREE.Shape();
      s.moveTo(Math.cos(a0) * rIn, Math.sin(a0) * rIn);
      s.absarc(0, 0, rOut, a0, a1, false);
      s.absarc(0, 0, rIn, a1, a0, true);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 3 });
      g.rotateX(-HALF_PI);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const f = 1 - (1 - taper) * (p.getY(k) / h);
        p.setX(k, p.getX(k) * f);
        p.setZ(k, p.getZ(k) * f);
      }
      g.computeVertexNormals();
      list.push(g);
    }
    const g = mergeGeometries(list, false);
    for (const p of list) p.dispose();
    return g;
  });
}

/** Upper hemisphere (dome), radius 1, base at y = 0. */
const hemi = (ws = 16, hs = 6) => geo.custom(`fut:hemi${ws},${hs}`, () => new THREE.SphereGeometry(1, ws, hs, 0, TAU, 0, HALF_PI));

/** Corner posts of a 1x1 cell (square s, height h), base at y = 0. */
function cornerPosts(key, s, h, inset = 0) {
  const o = 0.5 - s / 2 - inset;
  return mergedBoxes(`fut-corners:${key}`, [[s, h, s, o, h / 2, o], [s, h, s, -o, h / 2, o], [s, h, s, o, h / 2, -o], [s, h, s, -o, h / 2, -o]]);
}

/** Boxes placed on all four faces of a 1x1 cell: list of [w, h, x, y] in face coordinates. */
function onFourFaces(list, t, out = 0.5) {
  const boxes = [];
  const c = out - t / 2 + 0.006;
  for (const [w, h, x, y] of list) {
    boxes.push([w, h, t, x, y, c], [w, h, t, -x, y, -c], [t, h, w, c, y, -x], [t, h, w, -c, y, x]);
  }
  return boxes;
}

/** Flat energy blade along +Y (base at the origin, length 1), thin in Z. */
const bladeGeo = () => geo.custom('fut:energyBlade', () => {
  const s = new THREE.Shape();
  s.moveTo(-0.045, 0);
  s.lineTo(-0.062, 0.1);
  s.lineTo(-0.05, 0.8);
  s.lineTo(0.0, 1.0);
  s.lineTo(0.034, 0.86);
  s.lineTo(0.058, 0.14);
  s.lineTo(0.045, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false });
  g.translate(0, 0, -0.015);
  return g;
});

/** Solar panel (dark blue cells, silver frame + grid) tilted toward +Z by `tilt`, on a post. */
function solarPanel(parent, key, x, y, z, { w = 0.5, d = 0.34, tilt = 0.5, ry = 0, post = 0.3 } = {}) {
  const g = grp(parent, x, y, z, ry);
  add(g, geo.cyl(0.025, 0.03, post, 6), mat(C.steel), [0, post / 2, 0]);
  const p = grp(g, 0, post, 0);
  p.rotation.x = tilt;
  add(p, geo.box(w, 0.03, d), mat(C.silver), [0, 0, 0]);
  add(p, geo.box(w - 0.04, 0.03, d - 0.04), mat(C.solar), [0, 0.008, 0]);
  const grid = [];
  const nx = Math.max(2, Math.round(w / 0.12)), nz = Math.max(2, Math.round(d / 0.12));
  for (let i = 1; i < nx; i++) grid.push([0.01, 0.01, d - 0.04, -w / 2 + (w * i) / nx, 0.026, 0]);
  for (let i = 1; i < nz; i++) grid.push([w - 0.04, 0.01, 0.01, 0, 0.026, -d / 2 + (d * i) / nz]);
  add(p, mergedBoxes(`fut-solarGrid:${key}`, grid), mat(0x6f8fc8));
  return g;
}

// ===========================================================================
// Units
// ===========================================================================

function unitResult(r, height, radius, extra = {}) {
  return {
    root: r.root,
    parts: { body: r.body, head: r.head, legs: r.legs, arms: [{ obj: r.armL, phase: Math.PI }], weapon: r.weapon, ...extra },
    height,
    radius,
  };
}

/** Power-armour leg hanging from a hip pivot: white thigh + shin plates, team knee guard, boot. */
function armourLeg(lg, L, w, m) {
  add(lg, geo.sphere(w * 0.5, 6, 4), m.dark, [0, -0.01, 0]);
  add(lg, CG.frustum(1.2), m.white, [0, -L * 0.25, 0], null, [w, L * 0.44, w * 1.1]);
  add(lg, geo.box(w * 1.06, L * 0.06, w * 1.16), m.silver, [0, -L * 0.07, 0]);
  add(lg, geo.sphere(w * 0.44, 6, 4), m.dark, [0, -L * 0.5, 0]);
  add(lg, geo.box(w * 0.86, w * 0.8, 0.035), m.team, [0, -L * 0.5, w * 0.58], [-0.12, 0, 0]);
  add(lg, CG.frustum(1.22), m.white, [0, -L * 0.69, 0], null, [w * 0.9, L * 0.34, w]);
  add(lg, geo.box(w * 1.15, L * 0.13, w * 1.75), m.gun, [0, -L + L * 0.065, w * 0.28]);
  add(lg, geo.box(w * 1.18, L * 0.09, w * 0.52), m.silver, [0, -L + L * 0.05, w * 0.28 + w * 0.66]);
}

// Laser trooper: sleek white power armour with team chest plate, pauldron tops, knee guards and crest,
// a helmet with a glowing visor and a laser rifle held at the ready (two-handed, level along +Z).
export function laser_trooper(tc) {
  const L = 0.42;
  const r = rig({ legLen: L, hipW: 0.085, shoulderX: 0.235, shoulderY: 0.37, neckY: 0.45, legAmp: 0.55 });
  const m = mats(tc);
  const glow = [];
  for (const l of r.legs) armourLeg(l.obj, L, 0.1, m);
  const b = r.body;
  // pelvis, abdomen, cuirass
  add(b, CG.frustum(1.12), m.silver, [0, -0.02, 0], null, [0.25, 0.12, 0.18]);
  add(b, geo.box(0.12, 0.1, 0.035), m.team, [0, -0.045, 0.095], [-0.12, 0, 0]);
  add(b, mergedBoxes('ltAbs', [[0.19, 0.04, 0.14, 0, 0.06, 0], [0.2, 0.04, 0.145, 0, 0.105, 0]]), m.dark);
  add(b, CG.frustum(1.36), m.white, [0, 0.27, 0], null, [0.26, 0.28, 0.19]);
  add(b, geo.box(0.16, 0.12, 0.025), m.team, [0, 0.31, 0.123], [0.12, 0, 0]);
  add(b, geo.box(0.04, 0.12, 0.028), m.white, [0, 0.31, 0.126], [0.12, 0, 0]);
  add(b, geo.cyl(0.026, 0.026, 0.02, 6), m.cyan, [0, 0.205, 0.108], [HALF_PI + 0.12, 0, 0]); // chest cell
  add(b, CG.frustum(0.8), m.dark, [0, 0.43, 0], null, [0.17, 0.05, 0.14]);
  // pauldrons with team tops
  for (const s of [1, -1]) {
    add(b, geo.sphere(0.092, 8, 6), m.white, [s * 0.25, 0.39, 0], null, [1.25, 0.85, 1.18]);
    add(b, geo.box(0.17, 0.035, 0.18), m.team, [s * 0.262, 0.486, 0], [0, 0, -s * 0.32]);
    add(b, geo.box(0.04, 0.09, 0.17), m.silver, [s * 0.345, 0.37, 0], [0, 0, -s * 0.15]);
  }
  // power pack: team lid, cyan cells, antenna
  add(b, geo.box(0.2, 0.21, 0.1), m.white, [0, 0.3, -0.14]);
  add(b, geo.box(0.205, 0.025, 0.105), m.team, [0, 0.41, -0.14]);
  add(b, mergedBoxes('ltCells', [[0.045, 0.12, 0.02, 0.05, 0.29, 0], [0.045, 0.12, 0.02, -0.05, 0.29, 0]]), m.cyan, [0, 0, -0.192]);
  rod(b, [0.07, 0.4, -0.15], [0.08, 0.62, -0.18], 0.007, m.dark, 4);
  // helmet: white shell, dark faceplate, glowing visor, team crest
  const h = r.head;
  add(h, geo.sphere(0.1, 8, 6), m.white, [0, 0.105, -0.005], null, [1, 1.05, 1.12]);
  add(h, geo.box(0.165, 0.075, 0.07), m.glass, [0, 0.1, 0.07]);
  glowAdd(glow, h, geo.box(0.15, 0.028, 0.02), m.cyan, [0, 0.105, 0.106]);
  add(h, geo.box(0.11, 0.05, 0.05), m.silver, [0, 0.045, 0.08]);
  add(h, geo.box(0.032, 0.05, 0.21), m.team, [0, 0.21, -0.012]);
  add(h, mergedCyls('ltEars', [[0.035, 0.035, 0.03, 0.104, 0.1, 0, 0, HALF_PI], [0.035, 0.035, 0.03, -0.104, 0.1, 0, 0, HALF_PI]]), m.silver);
  rod(h, [0.11, 0.13, -0.03], [0.12, 0.28, -0.08], 0.006, m.dark, 4);
  // off arm (supports the barrel)
  const aL = r.armL;
  const eL = [-0.1, -0.2, 0.12], hL = [-0.31, -0.18, 0.31];
  beam(aL, [0, 0, 0], eL, 0.082, m.white);
  add(aL, geo.sphere(0.045, 6, 4), m.dark, eL);
  beam(aL, eL, hL, 0.09, m.white);
  beam(aL, [eL[0] * 0.6 + hL[0] * 0.4, eL[1] * 0.6 + hL[1] * 0.4, eL[2] * 0.6 + hL[2] * 0.4], [eL[0] * 0.25 + hL[0] * 0.75, eL[1] * 0.25 + hL[1] * 0.75, eL[2] * 0.25 + hL[2] * 0.75], 0.097, m.team);
  add(aL, geo.box(0.065, 0.07, 0.07), m.dark, hL);
  // gun arm: hand on the pistol grip
  const w = r.weapon;
  const eR = [-0.005, -0.19, -0.03], hR = [0.115, -0.165, 0.085];
  beam(w, [0, 0, 0], eR, 0.082, m.white);
  add(w, geo.sphere(0.045, 6, 4), m.dark, eR);
  beam(w, eR, hR, 0.09, m.white);
  add(w, geo.box(0.06, 0.07, 0.07), m.dark, hR);
  // rifle in its own frame (axis along +Z through the origin), a little oversized so it reads in play
  const gun = grp(w, 0.135, -0.11, 0);
  gun.scale.setScalar(1.2);
  add(gun, geo.box(0.045, 0.075, 0.15), m.silver, [0, -0.015, -0.07]);
  add(gun, geo.box(0.05, 0.085, 0.02), m.dark, [0, -0.015, -0.15]);
  add(gun, geo.box(0.07, 0.095, 0.3), m.white, [0, 0, 0.15]);
  add(gun, geo.box(0.076, 0.03, 0.2), m.team, [0, 0.005, 0.16]);
  add(gun, geo.box(0.03, 0.012, 0.22), m.team, [0, 0.052, 0.2]);
  add(gun, geo.box(0.028, 0.035, 0.12), m.dark, [0, 0.064, 0.08]);
  add(gun, geo.box(0.022, 0.022, 0.01), m.cyan, [0, 0.066, 0.142]);
  add(gun, geo.box(0.035, 0.085, 0.045), m.dark, [0, -0.08, 0.065], [-0.25, 0, 0]);
  add(gun, geo.box(0.05, 0.06, 0.07), m.dark, [0, -0.07, 0.2]);
  add(gun, geo.box(0.052, 0.014, 0.05), m.cyan, [0, -0.075, 0.2]);
  add(gun, geo.box(0.035, 0.055, 0.04), m.dark, [0, -0.07, 0.26]);
  add(gun, geo.cyl(0.03, 0.036, 0.18, 8), m.silver, [0, 0, 0.39], [HALF_PI, 0, 0]);
  glowAdd(glow, gun, geo.cyl(0.019, 0.019, 0.17, 8), m.cyan, [0, 0, 0.545], [HALF_PI, 0, 0]);
  add(gun, mergedCyls('ltCoils', [0.5, 0.54, 0.58].map((z) => [0.033, 0.033, 0.016, 0, 0, z, HALF_PI])), m.dark);
  add(gun, geo.cyl(0.03, 0.027, 0.025, 8), m.silver, [0, 0, 0.625], [HALF_PI, 0, 0]);
  muzzle(gun, 0, 0, 0.645);
  scaled(r, 1.04);
  return unitResult(r, 1.2, 0.4, { glow });
}

/** Mechanical exoskeleton leg: actuators, white plates with a team side plate, pistons, big foot. */
function exoLeg(lg, L, s, m) {
  add(lg, geo.cyl(0.075, 0.075, 0.17, 8), m.dark, [0, 0, 0], [0, 0, HALF_PI]);
  add(lg, geo.box(0.1, 0.28, 0.12), m.gun, [0, -0.15, 0]);
  add(lg, geo.box(0.14, 0.22, 0.06), m.white, [0, -0.13, 0.07], [0.08, 0, 0]);
  add(lg, geo.box(0.04, 0.2, 0.15), m.team, [s * 0.07, -0.14, 0]);
  rod(lg, [0, -0.04, -0.075], [0, -0.27, -0.065], 0.018, m.silver, 5);
  add(lg, geo.cyl(0.066, 0.066, 0.15, 8), m.dark, [0, -0.3, 0], [0, 0, HALF_PI]);
  add(lg, geo.box(0.12, 0.12, 0.07), m.white, [0, -0.29, 0.07], [0.35, 0, 0]);
  add(lg, CG.frustum(1.35), m.white, [0, -0.42, 0.005], null, [0.13, 0.2, 0.15]);
  add(lg, geo.box(0.08, 0.2, 0.06), m.gun, [0, -0.41, -0.08]);
  add(lg, geo.sphere(0.05, 6, 4), m.dark, [0, -0.5, 0]);
  add(lg, geo.box(0.17, 0.06, 0.3), m.gun, [0, -L + 0.03, 0.05]);
  add(lg, geo.box(0.18, 0.05, 0.12), m.white, [0, -L + 0.045, 0.165]);
  add(lg, geo.box(0.11, 0.045, 0.09), m.dark, [0, -L + 0.023, -0.13]);
}

// Exo trooper: heavy powered exoskeleton with bulky team-topped pauldrons, mechanical legs, a reactor
// pack with exhaust stacks and a wrist-mounted glowing energy blade on the weapon arm (melee swing).
export function exo_trooper(tc) {
  const L = 0.56;
  const r = rig({ legLen: L, hipW: 0.15, shoulderX: 0.34, shoulderY: 0.47, neckY: 0.5, legAmp: 0.5 });
  const m = mats(tc);
  const glow = [];
  r.legs.forEach((l, i) => exoLeg(l.obj, L, i === 0 ? 1 : -1, m));
  scaled(r, 1.08);
  const b = r.body;
  // pelvis, skirt plates, abdomen
  add(b, geo.box(0.36, 0.14, 0.24), m.gun, [0, 0, 0]);
  add(b, geo.box(0.22, 0.15, 0.04), m.white, [0, -0.04, 0.14], [-0.2, 0, 0]);
  add(b, geo.box(0.14, 0.035, 0.045), m.team, [0, 0.015, 0.152], [-0.2, 0, 0]);
  for (const s of [1, -1]) add(b, geo.box(0.04, 0.15, 0.2), m.silver, [s * 0.2, -0.03, 0], [0, 0, s * 0.2]);
  add(b, mergedBoxes('exoAbs', [[0.26, 0.05, 0.2, 0, 0.1, 0], [0.28, 0.05, 0.21, 0, 0.155, 0]]), m.dark);
  // chest + team plates + reactor
  add(b, CG.frustum(1.3), m.white, [0, 0.34, 0], null, [0.44, 0.34, 0.3]);
  for (const s of [1, -1]) add(b, geo.box(0.16, 0.2, 0.03), m.team, [s * 0.1, 0.36, 0.182], [0.13, -s * 0.18, 0]);
  add(b, geo.cyl(0.045, 0.045, 0.03, 6), m.cyan, [0, 0.25, 0.168], [HALF_PI + 0.13, 0, 0]);
  add(b, geo.box(0.05, 0.22, 0.035), m.silver, [0, 0.38, 0.19], [0.13, 0, 0]);
  add(b, CG.frustum(0.8), m.dark, [0, 0.53, 0], null, [0.24, 0.06, 0.2]);
  // reactor pack + exhaust stacks
  add(b, geo.box(0.34, 0.3, 0.16), m.silver, [0, 0.34, -0.21]);
  add(b, geo.box(0.22, 0.12, 0.02), m.team, [0, 0.36, -0.295]);
  add(b, mergedCyls('exoStacks', [[0.045, 0.055, 0.34, 0.1, 0.6, -0.24], [0.045, 0.055, 0.34, -0.1, 0.6, -0.24]]), m.gun);
  add(b, mergedCyls('exoStackGlow', [[0.035, 0.035, 0.02, 0.1, 0.77, -0.24], [0.035, 0.035, 0.02, -0.1, 0.77, -0.24]]), m.cyan);
  // bulky pauldrons, team tops
  for (const s of [1, -1]) {
    add(b, geo.sphere(0.1, 6, 4), m.dark, [s * 0.34, 0.47, 0]);
    add(b, geo.sphere(0.17, 8, 6), m.white, [s * 0.37, 0.52, 0], null, [1.12, 0.75, 1.1]);
    add(b, geo.box(0.32, 0.034, 0.34), m.silver, [s * 0.385, 0.655, 0], [0, 0, -s * 0.24]);
    add(b, geo.box(0.29, 0.05, 0.31), m.team, [s * 0.385, 0.682, 0], [0, 0, -s * 0.24]);
    add(b, geo.box(0.03, 0.13, 0.22), m.white, [s * 0.505, 0.665, -0.02], [0, 0, -s * 0.24]);
  }
  // compact helmet with a glowing T-visor and team crest
  const h = r.head;
  add(h, geo.cyl(0.07, 0.08, 0.06, 8), m.dark, [0, 0.0, 0]);
  add(h, geo.box(0.17, 0.15, 0.19), m.white, [0, 0.09, 0]);
  add(h, geo.box(0.15, 0.09, 0.03), m.glass, [0, 0.08, 0.098]);
  glowAdd(glow, h, mergedBoxes('exoVisor', [[0.13, 0.024, 0.02, 0, 0.017, 0], [0.026, 0.06, 0.02, 0, -0.017, 0]]), m.cyan, [0, 0.083, 0.11]);
  add(h, geo.box(0.04, 0.05, 0.21), m.team, [0, 0.18, -0.01]);
  add(h, mergedBoxes('exoCheeks', [[0.03, 0.08, 0.1, 0.095, 0.07, 0.02], [0.03, 0.08, 0.1, -0.095, 0.07, 0.02]]), m.silver);
  // arms: dark actuator upper arms with white plates, armoured forearms
  const armOpt = { upper: 0.2, fore: 0.19, w: 0.11, upperMat: m.gun, foreMat: m.white, handMat: m.dark, handR: 0.07, foreW: 0.15 };
  const handL = armMesh(r.armL, { ...armOpt, bend: 0.5 });
  add(r.armL, geo.box(0.05, 0.16, 0.13), m.white, [0.06, -0.1, 0]);
  add(r.armL, geo.box(0.155, 0.05, 0.155), m.team, [0, -0.2 - Math.cos(0.5) * 0.12, Math.sin(0.5) * 0.12], [-0.5, 0, 0]);
  add(handL, geo.box(0.12, 0.08, 0.1), m.gun, [0, -0.02, 0.03]);
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.6 });
  add(r.weapon, geo.box(0.05, 0.16, 0.13), m.white, [-0.06, -0.1, 0]);
  add(r.weapon, geo.box(0.155, 0.05, 0.155), m.team, [0, -0.2 - Math.cos(0.6) * 0.12, Math.sin(0.6) * 0.12], [-0.6, 0, 0]);
  // wrist blade emitter + energy blade (forward and a little down at rest)
  const g = grip(hand, MELEE_TILT);
  add(g, geo.box(0.085, 0.13, 0.085), m.silver, [0, 0.0, 0]);
  add(g, geo.box(0.11, 0.035, 0.05), m.dark, [0, 0.07, 0]);
  add(g, geo.box(0.12, 0.02, 0.045), m.team, [0, 0.05, 0]);
  glowAdd(glow, g, bladeGeo(), m.cyan, [0, 0.085, 0], null, [1.25, 0.82, 1]);
  return unitResult(r, 1.5, 0.5, { glow });
}

// Hover tank: sleek white wedge hull floating ~0.35 above the ground on glowing anti-grav pads, side
// nacelles with team stripes, a low turret with a team disc and twin plasma cannons (parts.weapon).
export function hover_tank(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  const hull = grp(root, 0, 0.35, 0);
  // wedge hull
  add(hull, profileX('hoverHull', [[-0.8, 0.02], [0.62, 0.02], [0.86, 0.13], [0.82, 0.19], [0.36, 0.33], [-0.52, 0.36], [-0.84, 0.26], [-0.86, 0.1]], 0.84, 0.04), m.white);
  add(hull, geo.box(0.6, 0.06, 1.5), m.gun, [0, 0.01, -0.06]);
  add(hull, geo.box(0.5, 0.022, 0.2), m.team, [0, 0.27, 0.6], [0.296, 0, 0]);
  add(hull, geo.box(0.36, 0.035, 0.03), m.glass, [0, 0.21, 0.83], [0.296, 0, 0]);
  for (const s of [1, -1]) add(hull, geo.box(0.07, 0.02, 0.86), m.team, [s * 0.3, 0.355, -0.08], [0.034, 0, 0]);
  // side nacelles with team stripes and hover pads
  const nac = profileX('hoverNacelle', [[-0.8, 0.0], [0.6, 0.0], [0.8, 0.1], [0.66, 0.23], [-0.7, 0.25], [-0.84, 0.13]], 0.3, 0.03);
  for (const s of [1, -1]) {
    const x = s * 0.57;
    add(hull, nac, m.pearl, [x, -0.02, 0]);
    add(hull, geo.box(0.02, 0.07, 1.1), m.team, [s * 0.722, 0.12, -0.02]);
    add(hull, geo.box(0.07, 0.02, 1.0), m.team, [s * 0.65, 0.245, -0.06]);
    add(hull, geo.box(0.12, 0.022, 0.5), m.gun, [s * 0.53, 0.245, -0.2]);
    add(hull, geo.box(0.2, 0.05, 0.03), m.cyan, [x, 0.12, 0.78], [0, 0, 0]);
    // tail fin with a team tip
    add(hull, geo.box(0.03, 0.22, 0.24), m.pearl, [s * 0.62, 0.34, -0.66], [-0.35, 0, 0]);
    add(hull, geo.box(0.034, 0.06, 0.2), m.team, [s * 0.62, 0.43, -0.7], [-0.35, 0, 0]);
    add(hull, mergedCyls('hoverPadRims', [[0.165, 0.165, 0.05, 0, 0, 0.42, 0, 0, 10], [0.165, 0.165, 0.05, 0, 0, -0.42, 0, 0, 10]]), m.dark, [x, -0.02, 0]);
    glowAdd(glow, hull, mergedCyls('hoverPads', [[0.14, 0.12, 0.05, 0, 0, 0.42, 0, 0, 10], [0.14, 0.12, 0.05, 0, 0, -0.42, 0, 0, 10]]), m.cyan, [x, -0.05, 0]);
  }
  // rear thrusters
  add(hull, mergedCyls('hoverThrust', [[0.08, 0.1, 0.12, 0.2, 0.19, -0.86, HALF_PI], [0.08, 0.1, 0.12, -0.2, 0.19, -0.86, HALF_PI]]), m.dark);
  add(hull, mergedCyls('hoverThrustGlow', [[0.066, 0.066, 0.02, 0.2, 0.19, -0.925, HALF_PI], [0.066, 0.066, 0.02, -0.2, 0.19, -0.925, HALF_PI]]), m.cyan);
  // turret: low white drum, big team disc on top, sensor dome, antenna
  const tz = -0.12;
  add(hull, geo.cyl(0.3, 0.36, 0.14, 8), m.white, [0, 0.42, tz], [0, Math.PI / 8, 0]);
  add(hull, geo.cyl(0.25, 0.28, 0.03, 8), m.team, [0, 0.5, tz], [0, Math.PI / 8, 0]);
  add(hull, geo.cyl(0.37, 0.37, 0.03, 8), m.silver, [0, 0.36, tz], [0, Math.PI / 8, 0]);
  add(hull, geo.sphere(0.06, 8, 4), m.glass, [0.17, 0.5, tz - 0.17], null, [1, 0.7, 1]);
  rod(hull, [-0.17, 0.48, tz - 0.2], [-0.2, 0.86, tz - 0.26], 0.008, m.dark, 4);
  add(hull, geo.sphere(0.018, 6, 4), m.cyan, [-0.2, 0.87, tz - 0.26]);
  // twin plasma cannons (parts.weapon), pivoted at the mantlet
  const weapon = grp(hull, 0, 0.45, 0.08);
  add(weapon, geo.box(0.34, 0.13, 0.15), m.silver, [0, 0, 0]);
  add(weapon, geo.box(0.12, 0.08, 0.03), m.team, [0, 0, 0.08]);
  for (const s of [1, -1]) {
    const x = s * 0.1;
    add(weapon, geo.cyl(0.042, 0.05, 0.36, 8), m.white, [x, 0, 0.25], [HALF_PI, 0, 0]);
    add(weapon, geo.cyl(0.053, 0.053, 0.04, 8), m.team, [x, 0, 0.14], [HALF_PI, 0, 0]);
    glowAdd(glow, weapon, geo.cyl(0.032, 0.032, 0.2, 8), m.cyan, [x, 0, 0.52], [HALF_PI, 0, 0]);
    add(weapon, mergedCyls('hoverCoils', [0.47, 0.52, 0.57].map((z) => [0.046, 0.046, 0.02, 0, 0, z, HALF_PI])), m.dark, [x, 0, 0]);
    add(weapon, geo.cyl(0.045, 0.04, 0.05, 8), m.silver, [x, 0, 0.64], [HALF_PI, 0, 0]);
    muzzle(weapon, x, 0, 0.67);
  }
  return { root, parts: { bob: [hull], weapon, glow }, height: 1.25, radius: 0.9 };
}

/** Heavy mech leg from the hip pivot down to the ground at y = -H: knee forward, shin raked back, clawed foot. */
function mechLeg(lg, H, s, m) {
  const K = [0, -0.52, 0.26], A = [0, -1.0, -0.12];
  add(lg, geo.cyl(0.15, 0.15, 0.22, 10), m.dark, [0, 0, 0], [0, 0, HALF_PI]);
  beam(lg, [0, -0.02, 0.01], K, 0.24, m.white, 0.28);
  beam(lg, [s * 0.132, -0.08, 0.04], [s * 0.132, -0.44, 0.22], 0.03, m.team, 0.2);
  add(lg, geo.cyl(0.12, 0.12, 0.26, 10), m.dark, K, [0, 0, HALF_PI]);
  add(lg, geo.box(0.22, 0.18, 0.12), m.white, [0, K[1] + 0.03, K[2] + 0.1], [0.45, 0, 0]);
  add(lg, geo.box(0.12, 0.05, 0.13), m.team, [0, K[1] + 0.1, K[2] + 0.13], [0.45, 0, 0]);
  beam(lg, K, A, 0.17, m.silver, 0.2);
  beam(lg, [0, K[1] - 0.05, K[2] + 0.07], [0, A[1] + 0.12, A[2] + 0.08], 0.19, m.white, 0.06);
  rod(lg, [0, -0.14, -0.1], [0, -0.78, -0.2], 0.025, m.silver, 6);
  add(lg, geo.sphere(0.095, 8, 6), m.dark, A);
  beam(lg, A, [0, -H + 0.1, -0.05], 0.12, m.gun);
  // foot: three splayed toes + heel spur
  const fy = -H;
  add(lg, geo.box(0.26, 0.1, 0.24), m.gun, [0, fy + 0.07, -0.05]);
  add(lg, mergedBoxes('mechToes', [
    [0.1, 0.07, 0.36, 0, 0.035, 0.18],
    [0.09, 0.065, 0.3, 0.13, 0.033, 0.12, 0.45],
    [0.09, 0.065, 0.3, -0.13, 0.033, 0.12, -0.45],
  ]), m.white, [0, fy, 0]);
  add(lg, geo.box(0.08, 0.06, 0.22), m.gun, [0, fy + 0.03, -0.24]);
}

// Mech walker: big armoured biped with a wedge cockpit (team side/roof armour, glowing eye
// slits), shoulder missile pods and two arm cannons that move together as parts.weapon.
export function mech_walker(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  const HY = 1.25;
  const legs = [];
  for (const s of [1, -1]) {
    const lg = grp(root, s * 0.36, HY, 0);
    mechLeg(lg, HY, s, m);
    legs.push({ obj: lg, phase: s > 0 ? 0 : Math.PI, amp: 0.4 });
  }
  const body = grp(root, 0, HY, 0);
  add(body, geo.box(0.56, 0.24, 0.4), m.gun, [0, 0.02, 0]);
  add(body, geo.cyl(0.2, 0.25, 0.16, 8), m.dark, [0, 0.2, 0]);
  // wedge cockpit
  add(body, profileX('mechCockpit', [[-0.5, 0.26], [0.36, 0.26], [0.62, 0.42], [0.5, 0.66], [-0.28, 0.76], [-0.52, 0.62]], 0.86, 0.04), m.white);
  for (const s of [1, -1]) add(body, geo.box(0.03, 0.24, 0.62), m.team, [s * 0.43, 0.48, -0.03]);
  add(body, geo.box(0.5, 0.025, 0.66), m.team, [0, 0.726, 0.11], [0.127, 0, 0]);
  add(body, geo.box(0.06, 0.03, 0.7), m.silver, [0, 0.74, 0.11], [0.127, 0, 0]);
  // canopy + glowing eye slits on the upper front slope
  const face = grp(body, 0, 0.545, 0.565);
  face.rotation.x = -0.464;
  add(face, geo.box(0.62, 0.17, 0.02), m.glass, [0, 0, 0]);
  glowAdd(glow, face, mergedBoxes('mechEyes', [[0.17, 0.04, 0.02, -0.13, 0.015, 0], [0.17, 0.04, 0.02, 0.13, 0.015, 0], [0.05, 0.035, 0.02, 0, -0.04, 0]]), m.cyan, [0, 0, 0.012]);
  add(body, geo.box(0.7, 0.05, 0.08), m.silver, [0, 0.43, 0.6]);
  // reactor + vents + antenna on the back
  add(body, geo.box(0.6, 0.34, 0.22), m.silver, [0, 0.5, -0.58]);
  add(body, mergedBoxes('mechVents', [-0.16, 0, 0.16].map((x) => [0.09, 0.2, 0.02, x, 0.5, -0.695])), m.cyan);
  rod(body, [0.22, 0.66, -0.55], [0.25, 1.33, -0.62], 0.012, m.dark, 4);
  add(body, geo.sphere(0.025, 6, 4), m.cyan, [0.25, 1.335, -0.62]);
  // shoulder missile pods (team flanks, warheads in a 3x2 grid)
  for (const s of [1, -1]) {
    const pod = grp(body, s * 0.5, 0.88, -0.1);
    add(pod, geo.box(0.16, 0.12, 0.3), m.dark, [-s * 0.04, -0.14, 0]);
    add(pod, geo.box(0.3, 0.26, 0.5), m.white, [0, 0, 0]);
    add(pod, geo.box(0.02, 0.2, 0.42), m.team, [s * 0.155, 0, -0.01]);
    add(pod, geo.box(0.22, 0.02, 0.4), m.team, [0, 0.135, -0.03]);
    add(pod, geo.box(0.26, 0.2, 0.02), m.dark, [0, 0, 0.25]);
    const tubes = [], tips = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const x = (i - 1) * 0.08, y = (j - 0.5) * 0.09;
      tubes.push([0.032, 0.032, 0.03, x, y, 0.262, HALF_PI, 0, 8]);
      tips.push([0, 0.026, 0.05, x, y, 0.27, HALF_PI, 0, 6]);
    }
    add(pod, mergedCyls('mechTubes', tubes), m.gun);
    add(pod, mergedCyls('mechTips', tips), mat(0xff5a3c));
  }
  // twin arm cannons (one group = parts.weapon), pivoted on the shoulder line
  const weapon = grp(body, 0, 0.5, 0);
  for (const s of [1, -1]) {
    const x = s * 0.6;
    add(weapon, geo.sphere(0.13, 8, 6), m.dark, [s * 0.47, 0, 0]);
    add(weapon, geo.box(0.22, 0.24, 0.62), m.white, [x, -0.08, 0.12]);
    add(weapon, geo.box(0.1, 0.02, 0.5), m.team, [x, 0.045, 0.12]);
    add(weapon, geo.box(0.02, 0.12, 0.44), m.team, [x + s * 0.112, -0.08, 0.12]);
    add(weapon, geo.box(0.16, 0.08, 0.3), m.gun, [x, -0.22, 0.05]);
    add(weapon, geo.cyl(0.07, 0.08, 0.22, 10), m.silver, [x, -0.1, 0.53], [HALF_PI, 0, 0]);
    glowAdd(glow, weapon, geo.cyl(0.045, 0.045, 0.22, 8), m.cyan, [x, -0.1, 0.72], [HALF_PI, 0, 0]);
    add(weapon, mergedCyls('mechCoils', [0.66, 0.72, 0.78].map((z) => [0.066, 0.066, 0.025, 0, 0, z, HALF_PI, 0, 10])), m.dark, [x, -0.1, 0]);
    add(weapon, geo.cyl(0.065, 0.058, 0.06, 10), m.silver, [x, -0.1, 0.85], [HALF_PI, 0, 0]);
    muzzle(weapon, x, -0.1, 0.89);
  }
  return { root, parts: { body, legs, weapon, glow }, height: 2.6, radius: 0.85 };
}

// ===========================================================================
// Buildings
// ===========================================================================

// Nexus (Future town center, 4x4): terraced plinth, a curved white ring building with glowing window
// bands and four portals, and a tapering spire whose white fins leave glowing cyan seams onto its core.
// A tilted ring with three pods orbits the spire (parts.spin) and a team-colored hologram emblem hovers
// on the spire front.
export function nexus(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  // terraces: silver base, team ledge, pearl deck
  add(root, roundSlab(3.86, 3.86, 0.1, 0.42), m.silver);
  add(root, roundSlab(3.76, 3.76, 0.05, 0.38), m.team, [0, 0.1, 0]);
  add(root, roundSlab(3.62, 3.62, 0.09, 0.34), m.pearl, [0, 0.15, 0]);
  const b = 0.24;
  // curved ring building
  add(root, lathe('nexRing', [[1.08, b], [1.76, b], [1.78, b + 0.1], [1.72, b + 0.32], [1.6, b + 0.5], [1.46, b + 0.62], [1.4, b + 0.66], [1.08, b + 0.66]], 28), m.white);
  add(root, annulus(1.1, 1.42, 0.03, 28), m.team, [0, b + 0.655, 0]);
  add(root, annulus(1.06, 1.12, 0.08, 24), m.silver, [0, b + 0.64, 0]);
  // window bands on the curved face, interrupted at the portals
  const arcs = [];
  for (let k = 0; k < 8; k++) arcs.push([k * (Math.PI / 4) + 0.15, Math.PI / 4 - 0.3]);
  add(root, latheArcs('nexWin1', [[1.772, b + 0.13], [1.792, b + 0.13], [1.754, b + 0.27], [1.734, b + 0.27]], arcs, 2), m.cyan);
  add(root, latheArcs('nexWin2', [[1.577, b + 0.52], [1.59, b + 0.535], [1.496, b + 0.615], [1.483, b + 0.6]], arcs, 2), mat(0x9ff7ff, { emissive: C.cyan, emissiveIntensity: 0.7 }));
  // four portals with team canopies
  for (let k = 0; k < 4; k++) {
    const g = grp(root, 0, b, 0, (k * Math.PI) / 2);
    add(g, geo.box(0.56, 0.5, 0.36), m.white, [0, 0.25, 1.62]);
    add(g, geo.box(0.34, 0.38, 0.02), m.glass, [0, 0.19, 1.805]);
    add(g, mergedBoxes('nexPortalFrame', [[0.03, 0.4, 0.02, 0.185, 0.2, 0], [0.03, 0.4, 0.02, -0.185, 0.2, 0], [0.4, 0.03, 0.02, 0, 0.405, 0]]), m.cyan, [0, 0, 1.812]);
    add(g, geo.box(0.62, 0.05, 0.4), m.team, [0, 0.525, 1.6]);
    add(g, geo.box(0.64, 0.02, 0.42), m.silver, [0, 0.5, 1.6]);
  }
  // courtyard light ring
  add(root, geo.cyl(1.08, 1.08, 0.012, 24), mat(0x2c7f8c, { emissive: C.cyan, emissiveIntensity: 0.35 }), [0, b + 0.006, 0]);
  // four sweeping buttress fins from the ring roof up to the spire (diagonals), cyan edge lights
  const fin = profileX('nexButtress', [[0.3, b + 0.5], [1.3, b + 0.66], [1.3, b + 0.74], [1.02, b + 0.98], [0.74, b + 1.5], [0.52, b + 2.2], [0.3, b + 2.2]], 0.12);
  const finLight = profileX('nexButtressLight', [[1.27, b + 0.76], [1.3, b + 0.79], [1.04, b + 1.02], [0.77, b + 1.53], [0.56, b + 2.2], [0.53, b + 2.18], [0.74, b + 1.5], [1.02, b + 0.98]], 0.06);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    add(root, fin, m.white, [0, 0, 0], [0, a, 0]);
    add(root, finLight, m.cyan, [0, 0, 0], [0, a, 0]);
  }
  // spire: foot, fins (white) around a glowing core
  add(root, geo.cyl(0.8, 0.88, 0.5, 16), m.white, [0, b + 0.25, 0]);
  add(root, geo.cyl(0.835, 0.84, 0.05, 16), m.team, [0, b + 0.4, 0]);
  add(root, geo.cyl(0.72, 0.78, 0.06, 16), m.dark, [0, b + 0.53, 0]);
  const fy = b + 0.5, FH = 5.0;
  add(root, spireFins('nexus', 6, 0.2, 0.3, 0.72, FH, 0.12), m.white, [0, fy, 0], [0, Math.PI / 6, 0]);
  const rFin = (y) => 0.72 * (1 - 0.88 * ((y - fy) / FH));
  glowAdd(glow, root, geo.cyl(0.07, 0.62, 4.5, 12), m.cyan, [0, fy + 0.1 + 2.25, 0]);
  for (const [y, h, mm] of [[fy + 1.0, 0.1, m.silver], [fy + 3.15, 0.09, m.team], [fy + 4.25, 0.06, m.silver]]) {
    add(root, geo.cyl(rFin(y + h / 2) + 0.025, rFin(y - h / 2) + 0.025, h, 12), mm, [0, y, 0]);
  }
  // crown: beacon + needle
  glowAdd(glow, root, geo.sphere(0.11, 8, 6), m.cyan, [0, fy + FH + 0.05, 0]);
  add(root, geo.cyl(0.12, 0.1, 0.06, 8), m.silver, [0, fy + FH - 0.06, 0]);
  add(root, geo.cone(0.075, 0.7, 8), m.silver, [0, fy + FH + 0.38, 0]);
  // hologram emblem on the spire front (team glow)
  const ey = fy + 1.85;
  const emblem = glowAdd(glow, root, geo.custom('fut:nexEmblem', () => {
    const ring = new THREE.TorusGeometry(0.34, 0.045, 4, 6);
    ring.rotateZ(Math.PI / 6);
    const parts = [ring.toNonIndexed()];
    for (const [w, h, x, y, rz] of [[0.075, 0.3, -0.075, 0.025, -0.5], [0.075, 0.3, 0.075, 0.025, 0.5], [0.09, 0.09, 0, -0.13, Math.PI / 4]]) {
      const bx = new THREE.BoxGeometry(w, h, 0.04);
      bx.rotateZ(rz);
      bx.translate(x, y, 0);
      parts.push(bx.toNonIndexed());
      bx.dispose();
    }
    const gg = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    ring.dispose();
    return gg;
  }), glowMat(tc, 0.85), [0, ey, rFin(ey) + 0.22], [-0.25, 0, 0]);
  emblem.castShadow = false;
  add(root, geo.box(0.1, 0.06, 0.2), m.silver, [0, ey - 0.45, rFin(ey - 0.45) + 0.08]);
  add(root, geo.cone(0.16, 0.36, 6), mat(tc, { emissive: tc, emissiveIntensity: 0.5, transparent: true, opacity: 0.25, depthWrite: false }), [0, ey - 0.26, rFin(ey) + 0.2], [Math.PI, 0, 0]).castShadow = false;
  // orbiting ring (spins), tilted so its rotation reads
  const orbit = grp(root, 0, fy + 3.15, 0);
  const tilt = grp(orbit, 0, 0, 0);
  tilt.rotation.z = 0.2;
  add(tilt, geo.torus(1.2, 0.055, 5, 28), m.white, [0, 0, 0], [HALF_PI, 0, 0]);
  add(tilt, geo.torus(1.12, 0.025, 4, 28), m.cyan, [0, -0.01, 0], [HALF_PI, 0, 0]);
  for (let k = 0; k < 3; k++) {
    const a = (k * TAU) / 3;
    const pg = grp(tilt, Math.sin(a) * 1.2, 0, Math.cos(a) * 1.2, a);
    add(pg, geo.box(0.22, 0.14, 0.3), m.white, [0, 0, 0]);
    add(pg, geo.box(0.18, 0.025, 0.24), m.team, [0, 0.08, 0]);
    add(pg, geo.box(0.12, 0.02, 0.18), m.cyan, [0, -0.075, 0]);
  }
  // corner pylons
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const x = sx * 1.55, z = sz * 1.55;
    add(root, geo.box(0.3, 0.08, 0.3), m.silver, [x, b + 0.04, z], [0, Math.PI / 4, 0]);
    add(root, geo.cyl(0.05, 0.11, 1.05, 6), m.white, [x, b + 0.6, z]);
    add(root, geo.cyl(0.092, 0.1, 0.09, 6), m.team, [x, b + 0.42, z]);
    add(root, geo.octa(0.08), m.cyan, [x, b + 1.17, z]);
  }
  return { root, parts: { spin: [orbit], glow }, height: 6.5, radius: 1.95 };
}

// Habitat pod (2x2): white drum + dome dwelling with glowing window bands and portholes, team trim,
// a small annex pod linked by a tube, solar panels and an antenna mast with a beacon.
export function house_fut(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  add(root, roundSlab(1.92, 1.92, 0.08, 0.24), m.silver);
  add(root, roundSlab(1.82, 1.82, 0.04, 0.2), m.team, [0, 0.08, 0]);
  add(root, roundSlab(1.72, 1.72, 0.03, 0.18), m.pearl, [0, 0.11, 0]);
  const b = 0.14;
  // main pod
  const px = 0.12, pz = -0.14, R = 0.6;
  const pod = grp(root, px, b, pz);
  add(pod, geo.cyl(R, R + 0.05, 0.5, 20), m.white, [0, 0.25, 0]);
  add(pod, geo.cyl(R + 0.06, R + 0.07, 0.06, 20), m.silver, [0, 0.03, 0]);
  const winArcs = [];
  for (let k = 0; k < 6; k++) winArcs.push([k * (TAU / 6) + 0.5, TAU / 6 - 0.36]);
  add(pod, latheArcs('habWin', [[R + 0.005, 0.24], [R + 0.03, 0.24], [R + 0.03, 0.34], [R + 0.005, 0.34]], winArcs, 3), m.cyan);
  add(pod, geo.cyl(R + 0.025, R + 0.025, 0.07, 20), m.team, [0, 0.5, 0]);
  add(pod, hemi(20, 6), m.white, [0, 0.53, 0], null, [R, R * 1.12, R]);
  // portholes on the dome
  const ports = [];
  for (let k = 0; k < 6; k++) {
    const a = k * (TAU / 6) + 0.3;
    const el = 0.55;
    ports.push([0.1, 0.1, 0.04, Math.sin(a) * Math.cos(el) * R, 0.53 + Math.sin(el) * R * 1.12, Math.cos(a) * Math.cos(el) * R, a, -el]);
  }
  add(pod, mergedBoxes('habPorts', ports), m.cyan);
  // roof: team cap ring, skylight, solar petals, antenna + beacon
  const top = 0.53 + R * 1.12;
  add(pod, geo.cyl(0.2, 0.26, 0.07, 12), m.team, [0, top - 0.04, 0]);
  add(pod, hemi(10, 3), mat(0x9ff7ff, { emissive: C.cyan, emissiveIntensity: 0.6 }), [0, top - 0.01, 0], null, [0.17, 0.1, 0.17]);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const g = grp(grp(pod, Math.sin(a) * R * 0.62, 0.53 + R * 0.86, Math.cos(a) * R * 0.62, a), 0, 0, 0);
    g.rotation.x = 0.62;
    add(g, geo.box(0.26, 0.025, 0.2), m.silver);
    add(g, geo.box(0.22, 0.03, 0.16), mat(C.solar), [0, 0.006, 0]);
  }
  rod(pod, [0.06, top, 0.02], [0.07, 2.04 - b, 0.03], 0.012, m.steel, 5);
  glowAdd(glow, pod, geo.sphere(0.045, 6, 4), m.cyan, [0.07, 2.08 - b, 0.03]);
  add(pod, geo.box(0.12, 0.02, 0.02), m.steel, [0.07, 1.86 - b, 0.03]);
  // door facing the front, framed in team color with a glowing lintel
  const dg = grp(pod, 0, 0, R - 0.02);
  add(dg, geo.box(0.34, 0.46, 0.08), m.team, [0, 0.23, 0.02]);
  add(dg, geo.box(0.24, 0.38, 0.06), m.gun, [0, 0.19, 0.05]);
  add(dg, geo.box(0.02, 0.36, 0.02), m.dark, [0, 0.19, 0.085]);
  add(dg, geo.box(0.26, 0.03, 0.03), m.cyan, [0, 0.42, 0.065]);
  add(root, geo.box(0.36, 0.03, 0.26), m.silver, [px, b + 0.015, pz + R + 0.16]);
  // annex pod (front-left), tube link
  const ax = -0.57, az = 0.55, r2 = 0.33;
  const an = grp(root, ax, b, az);
  add(an, geo.cyl(r2, r2 + 0.03, 0.26, 16), m.white, [0, 0.13, 0]);
  add(an, geo.cyl(r2 + 0.015, r2 + 0.015, 0.05, 16), m.team, [0, 0.26, 0]);
  add(an, hemi(16, 5), m.white, [0, 0.28, 0], null, [r2, r2 * 1.05, r2]);
  add(an, latheArcs('habWin2', [[r2 + 0.005, 0.12], [r2 + 0.025, 0.12], [r2 + 0.025, 0.19], [r2 + 0.005, 0.19]], [[0.3, 1.2], [2.0, 1.2], [3.8, 1.4]], 3), m.cyan);
  add(an, geo.sphere(0.07, 8, 4), m.glass, [0, 0.28 + r2 * 1.02, 0], null, [1, 0.5, 1]);
  const ta = Math.atan2(px - ax, pz - az);
  const tl = Math.hypot(px - ax, pz - az);
  const tube = grp(root, (px + ax) / 2, b + 0.2, (pz + az) / 2, ta);
  add(tube, geo.cyl(0.13, 0.13, tl, 10), m.pearl, [0, 0, 0], [HALF_PI, 0, 0]);
  add(tube, mergedCyls('habTubeRings', [-0.12, 0.12].map((t) => [0.145, 0.145, 0.04, 0, 0, t, HALF_PI, 0, 10])), m.silver);
  // solar panels: front-right tree and a back-left ground rack
  solarPanel(root, 'habA', 0.68, b, 0.62, { w: 0.42, d: 0.3, tilt: 0.55, ry: -0.3, post: 0.4 });
  for (const [x, z] of [[-0.72, -0.48], [-0.72, -0.8]]) solarPanel(root, 'habB', x, b, z, { w: 0.4, d: 0.26, tilt: 0.7, ry: 0.0, post: 0.14 });
  // battery / water tank at the back right
  add(root, geo.cyl(0.13, 0.13, 0.36, 10), m.silver, [0.74, b + 0.18, -0.74]);
  add(root, geo.cyl(0.135, 0.135, 0.04, 10), m.team, [0.74, b + 0.3, -0.74]);
  add(root, geo.box(0.04, 0.16, 0.02), m.cyan, [0.74, b + 0.16, -0.61]);
  return { root, parts: { glow }, height: 2.2, radius: 0.95 };
}

// Hydroponic farm (3x3): a glass dome over rows of plants under glowing grow-light bars, a low glass
// grow bed along the front, nutrient tanks with glowing level gauges and team bands, piping.
export function farm_3(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  const glass = mat(0xc8f4ff, { transparent: true, opacity: 0.26, depthWrite: false });
  const leaf = mat(C.leaf, { emissive: 0x1d5a12, emissiveIntensity: 0.6 });
  const leafL = mat(C.leafL, { emissive: 0x2f6a14, emissiveIntensity: 0.5 });
  const growM = glowMat(C.grow, 1);
  add(root, roundSlab(2.88, 2.88, 0.08, 0.3), m.silver);
  add(root, roundSlab(2.78, 2.78, 0.04, 0.27), m.team, [0, 0.08, 0]);
  add(root, roundSlab(2.68, 2.68, 0.03, 0.24), m.pearl, [0, 0.11, 0]);
  const b = 0.14;
  // dome (back-left)
  const dx = -0.32, dz = -0.32, R = 1.06, SY = 1.22;
  const d = grp(root, dx, b, dz);
  add(d, geo.cyl(R, R + 0.05, 0.16, 24), m.white, [0, 0.08, 0]);
  add(d, annulus(R - 0.02, R + 0.045, 0.05, 24), m.team, [0, 0.14, 0]);
  add(d, geo.cyl(R - 0.04, R - 0.04, 0.02, 24), mat(0x3b4a3a), [0, 0.17, 0]);
  const dy = 0.18;
  // plant rows: white trays, two greens, grow-light bars above (glow)
  const trays = [], plantsA = [], plantsB = [], lights = [], rails = [[1.3, 0.03, 0.04, 0, 0, 0]];
  for (const [i, x] of [-0.6, -0.2, 0.2, 0.6].entries()) {
    const half = Math.sqrt(R * R - x * x) * 0.82;
    trays.push([0.22, 0.1, half * 2, x, dy + 0.05, 0]);
    const n = Math.max(2, Math.round((half * 2) / 0.16));
    for (let k = 0; k < n; k++) {
      const z = -half + ((k + 0.5) * half * 2) / n;
      const hh = 0.1 + ((k + i) % 3) * 0.04;
      ((k + i) % 2 ? plantsA : plantsB).push([0.17, hh, 0.13, x, dy + 0.1 + hh / 2, z, (k % 2) * 0.4]);
    }
    const lh = Math.sqrt(Math.max(0.01, R * R - x * x)) * 0.62;
    lights.push([0.05, 0.03, lh * 2, x, 0, 0]);
    rails.push([0.015, 0.26, 0.015, x, -0.14, 0]);
  }
  add(d, mergedBoxes('farmTrays', trays), m.white);
  add(d, mergedBoxes('farmPlantsA', plantsA), leaf);
  add(d, mergedBoxes('farmPlantsB', plantsB), leafL);
  glowAdd(glow, d, mergedBoxes('farmLights', lights), growM, [0, dy + 0.62, 0]);
  add(d, mergedBoxes('farmLightRail', rails), m.steel, [0, dy + 0.9, 0]);
  // glass shell + ribs + hub
  const shell = add(d, hemi(20, 7), glass, [0, dy, 0], null, [R, R * SY, R]);
  shell.castShadow = false;
  for (let k = 0; k < 4; k++) add(d, geo.torus(R, 0.022, 4, 16, Math.PI), m.silver, [0, dy, 0], [0, (k * Math.PI) / 4, 0], [1, SY, 1]);
  add(d, geo.torus(R * Math.cos(0.6), 0.02, 4, 24), m.silver, [0, dy + Math.sin(0.6) * R * SY, 0], [HALF_PI, 0, 0]);
  const top = dy + R * SY;
  add(d, geo.cyl(0.14, 0.18, 0.08, 10), m.white, [0, top, 0]);
  add(d, geo.cyl(0.15, 0.15, 0.03, 10), m.team, [0, top + 0.05, 0]);
  rod(d, [0, top + 0.06, 0], [0, 1.82 - b, 0], 0.02, m.steel, 6);
  add(d, geo.sphere(0.06, 8, 6), growM, [0, 1.86 - b, 0]);
  // front grow bed under a glass roof
  const fz = 1.02;
  add(root, geo.box(2.1, 0.16, 0.5), m.white, [-0.27, b + 0.08, fz]);
  add(root, geo.box(2.12, 0.04, 0.52), m.team, [-0.27, b + 0.17, fz]);
  add(root, geo.box(2.0, 0.03, 0.42), mat(0x3b4a3a), [-0.27, b + 0.18, fz]);
  const bedA = [], bedB = [];
  for (let k = 0; k < 12; k++) {
    const x = -1.2 + k * 0.17;
    for (const [j, z] of [-0.1, 0.1].entries()) ((k + j) % 2 ? bedA : bedB).push([0.13, 0.1 + ((k + j) % 3) * 0.03, 0.12, x, 0, z]);
  }
  add(root, mergedBoxes('farmBedA', bedA.map(([w, h, dd, x, , z]) => [w, h, dd, x, h / 2, z])), leaf, [-0.27 + 0.14, b + 0.19, fz]);
  add(root, mergedBoxes('farmBedB', bedB.map(([w, h, dd, x, , z]) => [w, h, dd, x, h / 2, z])), leafL, [-0.27 + 0.14, b + 0.19, fz]);
  add(root, mergedBoxes('farmBedFrame', [
    [0.04, 0.32, 0.04, -1.3, 0.16, 0.24], [0.04, 0.32, 0.04, 0.76, 0.16, 0.24], [0.04, 0.42, 0.04, -1.3, 0.21, -0.24], [0.04, 0.42, 0.04, 0.76, 0.21, -0.24],
    [2.1, 0.03, 0.03, -0.27, 0.32, 0.24], [2.1, 0.03, 0.03, -0.27, 0.42, -0.24],
  ]), m.silver, [0, b + 0.18, fz]);
  const roof = add(root, geo.box(2.08, 0.02, 0.52), glass, [-0.27, b + 0.18 + 0.37, fz], [-0.2, 0, 0]);
  roof.castShadow = false;
  add(root, geo.box(2.0, 0.025, 0.04), growM, [-0.27, b + 0.18 + 0.33, fz]);
  // nutrient tanks (right column) with level gauges and team bands, piping to the dome
  const tanks = [[1.12, -1.08, 1.18], [1.12, -0.5, 1.02], [1.12, 0.08, 0.86]];
  for (const [x, z, h] of tanks) {
    add(root, geo.cyl(0.25, 0.27, h, 12), m.white, [x, b + h / 2, z]);
    add(root, hemi(12, 3), m.silver, [x, b + h, z], null, [0.25, 0.12, 0.25]);
    for (const y of [0.18, h - 0.14]) add(root, geo.cyl(0.278, 0.278, 0.06, 12), m.team, [x, b + y, z]);
    add(root, geo.box(0.07, h * 0.55, 0.04), m.dark, [x - 0.18, b + h * 0.5, z + 0.18], [0, -Math.PI / 4, 0]);
    add(root, geo.box(0.05, h * 0.38, 0.045), mat(C.nutrient, { emissive: C.nutrient, emissiveIntensity: 0.8 }), [x - 0.18, b + h * 0.44, z + 0.18], [0, -Math.PI / 4, 0]);
  }
  add(root, mergedCyls('farmPipes', [
    [0.04, 0.04, 1.16, 0.82, b + 0.3, -0.5, HALF_PI],
    [0.035, 0.035, 0.42, 0.98, b + 0.3, -1.08, 0, HALF_PI],
    [0.035, 0.035, 0.42, 0.98, b + 0.3, -0.5, 0, HALF_PI],
    [0.035, 0.035, 0.42, 0.98, b + 0.3, 0.08, 0, HALF_PI],
  ]), m.steel);
  // control kiosk (front right)
  add(root, geo.box(0.36, 0.5, 0.3), m.white, [1.08, b + 0.25, 0.98]);
  add(root, geo.box(0.37, 0.06, 0.31), m.team, [1.08, b + 0.47, 0.98]);
  add(root, geo.box(0.26, 0.18, 0.02), m.cyan, [1.08, b + 0.3, 1.14]);
  return { root, parts: { glow }, height: 2.0, radius: 1.45 };
}

// ===========================================================================
// Fortifications
// The wall's plinth fills its whole 1x1 cell and its energy field spans the cell between the four
// corner pylons (a cross-shaped footprint that leaves the corners to the pylons), so neighbours in any
// of the 8 directions join into one continuous barrier and their corner pylons pair up at the seams.
// The field pulses (parts.glow) over a slightly lower static copy of itself, so seams never open.
// Gate: 2x2, wall line along X, passage along Z; pylons flush at x = +-1. parts.doors = [{ obj, side }]
// with obj a Group on the hinge; the game sets obj.rotation.y = side * open * 1.4 (both swing to -Z).
// ===========================================================================

const WALL_TOP = 0.62; // plinth top
const FIELD_H = 0.8; // energy field height above the plinth
const POST = 0.18; // corner pylon size
const FIELD_MAT = () => mat(0x6cecff, { emissive: 0x18c4e6, emissiveIntensity: 0.75 });

/** Wall plinth (fills [-w/2, w/2] x [-d/2, d/2]) with team band and face panels. */
function wallPlinth(parent, m, key, w = 1, d = 1, x = 0, z = 0) {
  add(parent, geo.box(w, 0.12, d), m.gun, [x, 0.06, z]);
  add(parent, geo.box(w - 0.01, 0.35, d - 0.01), m.white, [x, 0.295, z]);
  add(parent, geo.box(w, 0.06, d), m.team, [x, 0.5, z]);
  add(parent, geo.box(w, 0.09, d), m.silver, [x, 0.575, z]);
  if (key) add(parent, mergedBoxes(key, onFourFaces([[0.5, 0.2, 0, 0.3], [0.3, 0.04, 0, 0.3]], 0.02, 0.494)), m.silver, [x, 0, z]);
}

/** Cross-shaped field footprint inside a 1x1 cell (leaves the POST x POST corners free). */
const fieldGeo = (h) => mergedBoxes(`fut-field:${h}`, [[1, h, 1 - 2 * POST, 0, h / 2, 0], [1 - 2 * POST, h, 1, 0, h / 2, 0]]);

export function wall_energy(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  wallPlinth(root, m, 'wallPanels');
  // corner emitter pylons: white posts, team band, dark emitter grilles, cyan tips
  const PH = 1.04;
  add(root, cornerPosts('wallPost', POST, PH, 0.004), m.white, [0, WALL_TOP, 0]);
  add(root, cornerPosts('wallPostCollar', POST + 0.004, 0.08, 0.002), m.gun, [0, WALL_TOP, 0]);
  add(root, cornerPosts('wallPostBand', POST + 0.008, 0.07), m.team, [0, WALL_TOP + 0.84, 0]);
  add(root, cornerPosts('wallPostCap', POST, 0.05), m.silver, [0, WALL_TOP + PH, 0]);
  add(root, cornerPosts('wallPostTip', POST * 0.5, 0.1, POST * 0.25), FIELD_MAT(), [0, WALL_TOP + PH + 0.05, 0]);
  // field: emitter channel, static under-layer, pulsing glow on top
  // energy field: emitter channel, a static under-layer and the pulsing glow on top of it
  add(root, fieldGeo(0.03), m.gun, [0, WALL_TOP, 0]);
  add(root, fieldGeo(FIELD_H * 0.9), FIELD_MAT(), [0, WALL_TOP, 0]);
  const f = glowAdd(glow, root, fieldGeo(FIELD_H), FIELD_MAT(), [0, WALL_TOP, 0]);
  f.castShadow = false;
  return { root, parts: { glow }, height: 1.8, radius: 0.5 };
}

/**
 * One gate leaf on its hinge: a white frame with a team crossbar holding a glowing energy pane.
 * The leaf extends toward +X (dir = 1) or -X (dir = -1) with its front face on the hinge plane, so
 * rotation.y = dir * angle swings it toward -Z.
 */
function energyLeaf(parent, glow, m, x, z, dir, w, h) {
  const hinge = grp(parent, x, 0, z);
  const t = 0.07, fb = 0.07, y0 = 0.04;
  const cx = (dir * w) / 2;
  add(hinge, mergedBoxes(`gateLeafFrame:${dir}`, [
    [w, fb, t, cx, y0 + fb / 2, -t / 2],
    [w, fb, t, cx, y0 + h - fb / 2, -t / 2],
    [fb, h, t, dir * (fb / 2), y0 + h / 2, -t / 2],
    [fb, h, t, dir * (w - fb / 2), y0 + h / 2, -t / 2],
  ]), m.white);
  add(hinge, geo.box(w - fb, 0.08, t + 0.012), m.team, [cx, y0 + h * 0.5, -t / 2]);
  add(hinge, mergedBoxes(`gateLeafHinge:${dir}`, [[0.05, 0.12, t + 0.04, dir * 0.02, y0 + 0.25, -t / 2], [0.05, 0.12, t + 0.04, dir * 0.02, y0 + h - 0.25, -t / 2]]), m.gun);
  const pane = glowAdd(glow, hinge, geo.box(w - 2 * fb + 0.02, h - 2 * fb + 0.02, 0.022), glowMat(0x7ff6ff, 0.85), [cx, y0 + h / 2, -t / 2]);
  pane.castShadow = false;
  return { obj: hinge, side: dir };
}

export function gate_energy(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  const PW = 0.55, GZ = 0.96;
  // passage floor with guide lights
  add(root, geo.box(2 * PW, 0.04, 2 * GZ), m.gun, [0, 0.02, 0]);
  add(root, mergedBoxes('gateGuides', [-0.75, -0.45, -0.15, 0.15, 0.45, 0.75].flatMap((z) => [[0.05, 0.012, 0.12, 0.4, 0.045, z], [0.05, 0.012, 0.12, -0.4, 0.045, z]])), m.cyan);
  for (const s of [1, -1]) {
    const x = s * (PW + (1 - PW) / 2), pw = 1 - PW;
    // full-depth base with sloped ends, then the plinth course matching the walls
    add(root, geo.box(pw, 0.3, 2 * GZ), m.gun, [x, 0.15, 0]);
    add(root, CG.frustum(0.86), m.pearl, [x, 0.38, 0], null, [pw, 0.16, 2 * GZ]);
    wallPlinth(root, m, null, pw, 1.1, x, 0);
    // pylon tower: outer face flush with x = +-1, team panels front and back, emitter strip inside
    add(root, geo.box(pw - 0.03, 1.3, 1.0), m.white, [s * (1 - (pw - 0.03) / 2), WALL_TOP + 0.65, 0]);
    add(root, geo.box(pw - 0.1, 0.9, 0.02), m.team, [s * (1 - (pw - 0.03) / 2), WALL_TOP + 0.6, 0.505]);
    add(root, geo.box(pw - 0.1, 0.9, 0.02), m.team, [s * (1 - (pw - 0.03) / 2), WALL_TOP + 0.6, -0.505]);
    add(root, geo.box(0.02, 1.1, 0.12), m.dark, [s * (PW + 0.02), WALL_TOP + 0.62, 0]);
    add(root, geo.box(0.024, 1.0, 0.06), m.cyan, [s * (PW + 0.022), WALL_TOP + 0.62, 0]);
    add(root, geo.box(pw, 0.06, 1.02), m.silver, [x, WALL_TOP + 1.3, 0]);
    // crown with an emitter orb
    add(root, CG.frustum(0.55), m.white, [x, WALL_TOP + 1.33 + 0.2, 0], null, [pw - 0.02, 0.4, 0.8]);
    add(root, geo.box(pw - 0.12, 0.06, 0.5), m.team, [x, WALL_TOP + 1.58, 0]);
    add(root, geo.sphere(0.09, 8, 6), m.cyan, [x, WALL_TOP + 1.72, 0]);
    add(root, geo.cyl(0.05, 0.08, 0.06, 8), m.silver, [x, WALL_TOP + 1.62, 0]);
  }
  // lintel beam over the passage
  add(root, geo.box(2 * PW + 0.06, 0.2, 0.36), m.white, [0, 2.06, 0]);
  add(root, geo.box(2 * PW + 0.06, 0.07, 0.37), m.team, [0, 2.095, 0]);
  add(root, geo.box(2 * PW - 0.1, 0.02, 0.12), m.cyan, [0, 1.955, 0]);
  const doors = [
    energyLeaf(root, glow, m, -PW, 0.6, 1, PW - 0.005, 1.58),
    energyLeaf(root, glow, m, PW, 0.6, -1, PW - 0.005, 1.58),
  ];
  return { root, parts: { doors, glow }, height: 2.4, radius: 1.0 };
}

// Laser tower (2x2): plinth, armoured hexagonal base with team panels, collar, a sensor ring that spins
// round the neck and a white turret head with a glowing emitter barrel (parts.weapon, level along +Z).
export function tower_laser(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  add(root, roundSlab(1.92, 1.92, 0.08, 0.24), m.silver);
  add(root, roundSlab(1.82, 1.82, 0.04, 0.2), m.team, [0, 0.08, 0]);
  add(root, roundSlab(1.72, 1.72, 0.03, 0.18), m.pearl, [0, 0.11, 0]);
  const b = 0.14;
  add(root, mergedBoxes('towerCornerLights', [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => [0.12, 0.02, 0.12, sx * 0.72, b + 0.01, sz * 0.72, Math.PI / 4])), m.cyan);
  // hexagonal armoured base (flat face to the front)
  const H0 = 0.8;
  add(root, geo.cyl(0.74, 0.86, H0, 6), m.white, [0, b + H0 / 2, 0], [0, Math.PI / 6, 0]);
  const lean = Math.atan(((0.86 - 0.74) * Math.cos(Math.PI / 6)) / H0);
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    const ap = ((0.86 + 0.74) / 2) * Math.cos(Math.PI / 6) + 0.012;
    const g = grp(grp(root, Math.sin(a) * ap, b + H0 * 0.5, Math.cos(a) * ap, a), 0, 0, 0);
    g.rotation.x = lean;
    add(g, geo.box(0.6, 0.46, 0.04), k % 2 ? m.silver : m.team, [0, 0, 0]);
    add(g, geo.box(0.36, 0.05, 0.05), m.dark, [0, 0.13, 0.01]);
  }
  add(root, geo.cyl(0.76, 0.76, 0.05, 6), m.silver, [0, b + H0 + 0.02, 0], [0, Math.PI / 6, 0]);
  const edges = [];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    edges.push([0.05, H0 * 0.8, 0.05, Math.sin(a) * 0.81, b + H0 * 0.5, Math.cos(a) * 0.81, a, -Math.atan((0.86 - 0.74) / H0)]);
  }
  add(root, mergedBoxes('towerEdgeLights', edges), m.cyan);
  // collar + neck
  add(root, geo.cyl(0.52, 0.62, 0.3, 6), m.silver, [0, b + H0 + 0.19, 0], [0, Math.PI / 6, 0]);
  add(root, geo.cyl(0.535, 0.535, 0.05, 6), m.team, [0, b + H0 + 0.3, 0], [0, Math.PI / 6, 0]);
  add(root, geo.cyl(0.22, 0.28, 0.48, 10), m.gun, [0, b + H0 + 0.56, 0]);
  add(root, mergedCyls('towerNeckRings', [[0.27, 0.27, 0.03, 0, 0.1, 0, 0, 0, 10], [0.255, 0.255, 0.03, 0, 0.3, 0, 0, 0, 10]]), m.cyan, [0, b + H0 + 0.36, 0]);
  // spinning sensor ring with a dish
  const sensor = grp(root, 0, b + H0 + 0.5, 0);
  add(sensor, geo.torus(0.46, 0.03, 4, 24), m.silver, [0, 0, 0], [HALF_PI, 0, 0]);
  add(sensor, mergedBoxes('towerSpokes', [[0.92, 0.03, 0.05, 0, 0, 0], [0.05, 0.03, 0.92, 0, 0, 0]]), m.steel);
  add(sensor, geo.box(0.1, 0.08, 0.1), m.team, [0, 0, -0.46]);
  add(sensor, geo.sphere(0.04, 6, 4), m.cyan, [0, 0, 0.46]);
  const dish = grp(sensor, 0.46, 0.04, 0);
  add(dish, geo.cyl(0.015, 0.015, 0.14, 4), m.steel, [0, 0.07, 0]);
  add(dish, hemi(10, 3), m.white, [0.0, 0.17, 0], [0, 0, -1.1], [0.13, 0.05, 0.13]);
  // turret head (parts.weapon) pivoted on the vertical axis at barrel height
  const PY = 2.0;
  const weapon = grp(root, 0, PY, 0);
  add(weapon, profileX('towerHead', [[-0.56, -0.17], [0.18, -0.2], [0.38, -0.08], [0.33, 0.13], [0.02, 0.27], [-0.46, 0.25], [-0.6, 0.06]], 0.7, 0.04), m.white);
  for (const s of [1, -1]) {
    add(weapon, geo.box(0.02, 0.2, 0.62), m.team, [s * 0.35, 0.02, -0.14]);
    add(weapon, geo.box(0.022, 0.05, 0.5), m.cyan, [s * 0.352, -0.12, -0.14]);
  }
  add(weapon, geo.box(0.42, 0.025, 0.44), m.team, [0, 0.268, -0.21], [-0.04, 0, 0]);
  add(weapon, mergedBoxes('towerFins', [-0.15, -0.05, 0.05, 0.15].map((x) => [0.028, 0.14, 0.28, x, 0.33, -0.36])), m.silver);
  add(weapon, geo.box(0.24, 0.07, 0.04), m.glass, [0, 0.12, 0.25], [-0.5, 0, 0]);
  add(weapon, geo.box(0.16, 0.025, 0.02), m.cyan, [0, 0.125, 0.272], [-0.5, 0, 0]);
  // emitter barrel: shroud, sleeve, glowing coil core, crown
  add(weapon, geo.cyl(0.09, 0.115, 0.2, 10), m.silver, [0, -0.02, 0.44], [HALF_PI, 0, 0]);
  add(weapon, geo.cyl(0.062, 0.07, 0.18, 10), m.white, [0, -0.02, 0.62], [HALF_PI, 0, 0]);
  add(weapon, geo.cyl(0.075, 0.075, 0.03, 10), m.team, [0, -0.02, 0.57], [HALF_PI, 0, 0]);
  glowAdd(glow, weapon, geo.cyl(0.045, 0.045, 0.22, 8), m.cyan, [0, -0.02, 0.8], [HALF_PI, 0, 0]);
  add(weapon, mergedCyls('towerCoils', [0.74, 0.8, 0.86].map((z) => [0.072, 0.072, 0.025, 0, 0, z, HALF_PI, 0, 10])), m.dark, [0, -0.02, 0]);
  add(weapon, geo.cyl(0.07, 0.058, 0.05, 10), m.silver, [0, -0.02, 0.925], [HALF_PI, 0, 0]);
  muzzle(weapon, 0, -0.02, 0.95);
  // antenna on the head
  rod(weapon, [-0.24, 0.24, -0.38], [-0.26, 0.6, -0.42], 0.01, m.dark, 4);
  add(weapon, geo.sphere(0.025, 6, 4), m.cyan, [-0.26, 0.61, -0.42]);
  return { root, parts: { weapon, spin: [sensor], glow }, height: 2.6, radius: 1.0 };
}
