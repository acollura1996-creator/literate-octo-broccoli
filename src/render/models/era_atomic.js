// Atomic Age (WWII / early Cold War): gas-masked flamethrower trooper, ghillie-caped sniper, an M3-style
// half-track, the art-deco Atomic Hall (town center), a 1950s suburban bungalow and the mid-era Research
// Center (also used from the Industrial to the Modern Age).
// Same conventions as the other builders: origin at ground center, facing +Z, character's weapon hand on
// -X, team color via mat(teamColor), cached geo/mat, everything casts shadows (add()). Buildings fill their
// fp x fp footprint.
//
// Firearms: for infantry `weapon` is pivoted at the right shoulder and carries BOTH arms + the gun (as in
// era_modern.js), so the recoil kick (rotation.x ~ -0.1, position.z - 0.05) moves the whole firing pose
// together. The half-track's `weapon` is the pintle-mounted heavy machine gun, pivoted at the pintle head.
// Every gun rests level along +Z at rotation 0 and carries an empty Object3D named 'muzzle' at its tip;
// the rest positions in model space are listed in MUZZLE below (same shape as render/projectiles.js).
import {
  THREE, mat, geo, P, CG, glowMat, grp, add, beam, rod, rig, scaled, fire, flag, banner, gableRoof, mergedBoxes,
} from './common.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HALF_PI = Math.PI / 2;

/**
 * Rest muzzle positions in model space (origin at ground center, facing +Z), measured from the built
 * models. The flamethrower's is the nozzle tip (its pilot flame sits there).
 */
export const MUZZLE = {
  flamethrower: [-0.18, 0.519, 0.604],
  sniper: [-0.12, 0.657, 0.974],
  half_track: [0, 1.17, 0.456],
};

/** Darker/lighter variant of a color. */
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();

const C = {
  // GI kit
  od: 0x68653f, odD: 0x4f4c31, wool: 0x5c573c, khaki: 0xaa9d6c, khakiD: 0x867a51, boot: 0x4a3220,
  helm: 0x545b37, rubber: 0x26272a, lens: 0xc8e0e4, glove: 0x5a4632,
  gun: 0x33363c, gunL: 0x575c64, wood: 0x7a4a26, woodL: 0x93623b,
  camoA: 0x5a6531, camoB: 0x707044, camoC: 0x3e4a25, camoD: 0x7d6c45,
  // vehicle
  armor: 0x5b633b, armorD: 0x454c2c, armorL: 0x6f784b, tire: 0x242426, track: 0x37362f,
  // buildings
  lime: 0xe9e0c8, limeD: 0xc8bc9d, limeL: 0xf5efe0, glassK: 0x27313f, bronze: 0x9a6a32, terrazzo: 0xcdc5b3,
  brick: 0x9e4a30, brickD: 0x74331f, conc: 0xbdb9ae, concD: 0x96928a, concL: 0xd8d5cc, steel: 0x8a919a, steelD: 0x4f555e,
  roof: 0x8f8b82, lab: 0xa6f2ff,
};

// ===========================================================================
// Geometry helpers
// ===========================================================================

/** Cached merged cylinders: [[rTop, rBot, h, x, y, z, rx = 0, rz = 0, seg = 8, open = false], ...]. */
function mergedCyls(key, list) {
  return geo.custom(`at-cyl:${key}`, () => {
    const parts = list.map(([rt, rb, h, x, y, z, rx = 0, rz = 0, seg = 8, open = false]) => {
      const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
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

/** Cached merged boxes with a full rotation: [[w, h, d, x, y, z, rx = 0, ry = 0, rz = 0], ...]. */
function mergedRot(key, list) {
  return geo.custom(`at-rot:${key}`, () => {
    const e = new THREE.Euler(), m = new THREE.Matrix4();
    const parts = list.map(([w, h, d, x, y, z, rx = 0, ry = 0, rz = 0]) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.applyMatrix4(m.makeRotationFromEuler(e.set(rx, ry, rz)));
      g.translate(x, y, z);
      return g;
    });
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

const _up = new THREE.Vector3(0, 1, 0);
/** Cached merged boxes stretched between two points: [[a, b, w, d = w], ...] (lattice masts, struts). */
function mergedBeams(key, list) {
  return geo.custom(`at-beams:${key}`, () => {
    const parts = list.map(([a, b, w, d = w]) => {
      const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
      const g = new THREE.BoxGeometry(w, va.distanceTo(vb), d);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, vb.clone().sub(va).normalize()));
      g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      return g;
    });
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

/** Merge geometries of mixed kinds (indexed or not): keeps position + normal only. Disposes the inputs. */
function mergeAll(list) {
  const flat = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    if (!n.attributes.normal) n.computeVertexNormals();
    n.clearGroups();
    return n;
  });
  const out = mergeGeometries(flat, false);
  for (const g of [...list, ...flat]) g.dispose();
  return out;
}

/** Cylinder along +Z from z0 (back, radius rb) to z1 (front, radius rf). */
function zcyl(parent, rf, rb, z0, z1, material, seg = 8, x = 0, y = 0) {
  return add(parent, geo.cyl(rf, rb, z1 - z0, seg), material, [x, y, (z0 + z1) / 2], [HALF_PI, 0, 0]);
}

/** Cylinder along X (axle / roller), centered at (x, y, z). */
function xcyl(parent, r, len, material, x, y, z, seg = 8) {
  return add(parent, geo.cyl(r, r, len, seg), material, [x, y, z], [0, 0, HALF_PI]);
}

/** Empty marker at a barrel tip (see header). */
function muzzle(parent, x, y, z) {
  const o = new THREE.Object3D();
  o.name = 'muzzle';
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

/** Low-poly upper hemisphere (8 x 3), radius 1, base at y = 0 (helmets, tank caps). */
const hemi8 = () => geo.custom('at:hemi8', () => new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, HALF_PI));

/** Side profile [[z, y], ...] extruded symmetrically along X by `width`. */
function profileX(key, pts, width, { holes = [], curve = 4 } = {}) {
  return geo.custom(`at-prof:${key}`, () => {
    const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    for (const h of holes) s.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y))));
    const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: curve });
    g.translate(0, 0, -width / 2);
    g.rotateY(-HALF_PI); // shape x -> world z, extrusion -> world x
    return g;
  });
}

/** Plan polygon [[x, z], ...] extruded from y = 0 up to y = h. */
function planGeo(key, pts, h) {
  return geo.custom(`at-plan:${key}`, () => {
    const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
    g.rotateX(-HALF_PI); // shape (x, -z) + depth -> world (x, depth, z)
    return g;
  });
}

/** Flat five-pointed star in the XY plane (one point up), extruded toward +Z by t. */
function starGeo(r1, r2, t) {
  return geo.custom(`at-star:${r1},${r2},${t}`, () => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = HALF_PI + (i * Math.PI) / 5, r = i % 2 ? r2 : r1;
      pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
    }
    return new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: t, bevelEnabled: false });
  });
}

/** Atom emblem in the XY plane facing +Z: three elliptical orbits + nucleus, outer radius r. */
function atomGeo(r, ts = 14) {
  return geo.custom(`at-atom:${r},${ts}`, () => {
    const parts = [0, 1, 2].map((k) => {
      const t = new THREE.TorusGeometry(r, r * 0.075, 3, ts);
      t.scale(1, 0.36, 1);
      t.rotateZ((k * Math.PI) / 3 + HALF_PI);
      return t;
    });
    parts.push(new THREE.SphereGeometry(r * 0.2, 6, 4));
    return mergeAll(parts);
  });
}

/** Shallow dish (spherical cap) whose concave side faces +Z, rim at z = 0. Render double-sided. */
function dishGeo(r, depth = 0.6) {
  return geo.custom(`at-dish:${r},${depth}`, () => {
    const R = r / Math.sin(depth);
    const g = new THREE.SphereGeometry(R, 14, 3, 0, Math.PI * 2, 0, depth);
    g.translate(0, -R * Math.cos(depth), 0); // rim at y = 0, apex at y = R(1 - cos)
    g.rotateX(-HALF_PI); // apex toward -Z
    return g;
  });
}

/** Wheel along X built from cylinders/boxes: [['cyl', r, len, seg] | ['box', w, h, d, rx], ...]. */
function wheelGeo(key, list) {
  return geo.custom(`at-wheel:${key}`, () => {
    const parts = list.map(([kind, a, b, c, d = 0]) => {
      let g;
      if (kind === 'cyl') {
        g = new THREE.CylinderGeometry(a, a, b, c);
        g.rotateZ(HALF_PI);
      } else {
        g = new THREE.BoxGeometry(a, b, c);
        if (d) g.rotateX(d);
      }
      return g;
    });
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

/**
 * Chimney smoke: a column of puffs over a chimney mouth. Put the group in parts.bob (and parts.spin to
 * make it swirl about the chimney axis).
 */
function smoke(parent, x, y, z, { s = 0.08, n = 3, color = 0xd2cfc8, opacity = 0.62 } = {}) {
  const g = grp(parent, x, y, z);
  const m = mat(color, { transparent: true, opacity });
  const pts = [[0, 0.6, 0, 1], [0.55, 2.0, 0.3, 0.9], [-0.45, 3.3, -0.35, 0.8], [0.35, 4.5, 0.45, 0.7]];
  for (let i = 0; i < n; i++) {
    const [px, py, pz, k] = pts[i];
    add(g, geo.ico(s * k, 0), m, [px * s, py * s, pz * s]).castShadow = false;
  }
  return g;
}

/** Deterministic pseudo-random sequence (cached geometry keys stay valid). */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp3 = (A, B, t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];

// ===========================================================================
// WWII soldier base (flamethrower, sniper)
// ===========================================================================

const SOLDIER = { L: 0.37, hipW: 0.085, sx: 0.21, sy: 0.35, neckY: 0.42 };

function giMats(tc) {
  return {
    team: mat(tc), teamD: mat(shade(tc, 0.62)), od: mat(C.od), odD: mat(C.odD), wool: mat(C.wool), khaki: mat(C.khaki),
    khakiD: mat(C.khakiD), boot: mat(C.boot), helm: mat(C.helm), skin: mat(P.skin), rubber: mat(C.rubber), gun: mat(C.gun),
    gunL: mat(C.gunL), wood: mat(C.wood), woodL: mat(C.woodL), brass: mat(0xd2a446), glove: mat(C.glove), black: mat(0x16161a),
  };
}

/**
 * GI in an M1943 field jacket: wool trousers, canvas leggings, boots, pistol belt with pouches, chest
 * pockets and collar. The weapon group stays empty (each unit adds its arms + gun).
 */
function giBase(tc) {
  const { L, hipW, sx, sy, neckY } = SOLDIER;
  const r = rig({ legLen: L, hipW, shoulderX: sx, shoulderY: sy, neckY });
  const M = giMats(tc);
  const lw = 0.098;
  for (const l of r.legs) {
    add(l.obj, geo.box(lw, L * 0.6, lw * 1.05), M.wool, [0, -L * 0.3, 0]);
    add(l.obj, geo.box(lw * 1.07, L * 0.34, lw * 1.1), M.khaki, [0, -L * 0.72, 0.002]); // canvas leggings
    add(l.obj, geo.box(lw * 1.12, 0.018, lw * 1.14), M.khakiD, [0, -L * 0.56, 0.002]);
    add(l.obj, geo.box(lw * 1.12, 0.06, lw * 1.72), M.boot, [0, -L + 0.03, lw * 0.3]);
  }
  const T = { w0: 0.27, d0: 0.2, th: 0.33, cy: 0.19, k: 1.26 };
  T.halfD = (y) => (T.d0 * (1 + (T.k - 1) * ((y - (T.cy - T.th / 2)) / T.th))) / 2;
  T.lean = Math.atan(((T.k - 1) * T.d0) / 2 / T.th);
  const B = r.body;
  add(B, CG.frustum(T.k), M.od, [0, T.cy, 0], null, [T.w0, T.th, T.d0]);
  add(B, CG.frustum(0.9), M.wool, [0, -0.03, 0], null, [T.w0 + 0.02, 0.1, T.d0 + 0.02]);
  // pistol belt, buckle, ammo pouches, canteen
  add(B, geo.box(T.w0 + 0.04, 0.045, T.d0 + 0.04), M.khaki, [0, 0.05, 0]);
  add(B, geo.box(0.05, 0.045, 0.02), M.brass, [0, 0.05, T.d0 / 2 + 0.03]);
  add(B, mergedBoxes('at-giPouches', [[0.06, 0.065, 0.04, -0.1, 0, 0.1], [0.06, 0.065, 0.04, 0.1, 0, 0.1]]), M.khakiD, [0, 0.04, 0]);
  add(B, geo.box(0.07, 0.1, 0.06), M.khakiD, [0.15, 0.0, -0.07]); // canteen
  // jacket placket, chest pocket flaps, collar
  add(B, geo.box(0.02, T.th * 0.8, 0.012), M.odD, [0, T.cy + 0.02, T.halfD(T.cy + 0.02) + 0.004], [T.lean, 0, 0]);
  add(B, mergedBoxes('at-giPockets', [[0.075, 0.03, 0.014, -0.07, 0, 0], [0.075, 0.03, 0.014, 0.07, 0, 0]]), M.odD, [0, 0.29, T.halfD(0.29) + 0.004], [T.lean, 0, 0]);
  add(B, CG.frustum(0.8), M.od, [0, T.cy + T.th / 2 + 0.018, 0], null, [0.18, 0.05, 0.16]);
  return { r, M, T };
}

/** Sleeve + hand between shoulder S, elbow E and hand H (optional team armband on the upper arm). */
function giArm(g, S, E, H, M, { band = null, hand = M.skin, sleeve = M.od } = {}) {
  add(g, geo.sphere(0.054, 5, 4), sleeve, S, null, [1, 0.9, 1]);
  beam(g, S, E, 0.074, sleeve);
  if (band) beam(g, lerp3(S, E, 0.16), lerp3(S, E, 0.58), 0.09, band);
  add(g, geo.sphere(0.041, 5, 3), sleeve, E);
  beam(g, E, H, 0.068, sleeve);
  beam(g, lerp3(E, H, 0.72), lerp3(E, H, 0.9), 0.076, M.odD);
  add(g, geo.sphere(0.037, 5, 3), hand, H);
}

/** M1 helmet: dome + rim, origin at the head pivot. Returns nothing; band adds a team band. */
function m1Helmet(head, shell, { band = null, y = 0.112 } = {}) {
  add(head, hemi8(), shell, [0, y, -0.006], null, [0.113, 0.11, 0.124]);
  add(head, geo.cyl(0.121, 0.127, 0.02, 8), shell, [0, y, -0.006], null, [1, 1, 1.1]);
  if (band) add(head, geo.cyl(0.103, 0.117, 0.04, 8), band, [0, y + 0.035, -0.006], null, [1, 1, 1.1]);
}

// ---------------------------------------------------------------------------
// Flamethrower
// ---------------------------------------------------------------------------

// WWII assault engineer with an M2 flamethrower: M1 helmet with a team band, gas mask with eyepieces and
// a filter canister, twin fuel tanks (team bands) and a pressure sphere on a back frame, a hose to the
// wand held at the hip (pointing +Z) with a small pilot flame at the nozzle; team armbands.
export function flamethrower(tc) {
  const { r, M, T } = giBase(tc);
  const B = r.body;
  // --- back frame, twin fuel tanks, pressure sphere, valves
  const bz = -T.halfD(0.2) - 0.012;
  add(B, geo.box(0.29, 0.34, 0.024), M.khakiD, [0, 0.2, bz]);
  const tz = bz - 0.012 - 0.072;
  const tankM = mat(0x484c3a);
  add(B, mergedCyls('ftTanks', [-0.086, 0.086].map((x) => [0.072, 0.072, 0.34, x, 0.22, tz, 0, 0, 8])), tankM);
  for (const x of [-0.086, 0.086]) add(B, hemi8(), M.team, [x, 0.39, tz], null, [0.072, 0.036, 0.072]); // team-painted caps
  add(B, mergedCyls('ftTankBands', [-0.086, 0.086].map((x) => [0.076, 0.076, 0.07, x, 0.33, tz, 0, 0, 8, true])), M.team);
  add(B, geo.sphere(0.058, 6, 4), mat(0x5d6150), [0, 0.2, tz - 0.06]); // pressure tank
  add(B, mergedCyls('ftValves', [[0.016, 0.016, 0.06, -0.086, 0.44, tz, 0, 0, 6], [0.016, 0.016, 0.06, 0.086, 0.44, tz, 0, 0, 6]]), M.gunL);
  // harness: shoulder straps over the shoulders and down the chest
  add(B, mergedBoxes('at-ftStraps', [[0.045, 0.02, 0.26, -0.1, 0.36, 0.0], [0.045, 0.02, 0.26, 0.1, 0.36, 0.0]]), M.khakiD);
  for (const x of [-0.095, 0.095]) add(B, geo.box(0.042, 0.2, 0.014), M.khakiD, [x, 0.24, T.halfD(0.24) + 0.008], [T.lean, 0, 0]);
  add(B, geo.box(T.w0 + 0.03, 0.035, 0.02), M.khakiD, [0, 0.14, T.halfD(0.14) + 0.012], [T.lean, 0, 0]); // chest strap

  // --- head: gas mask (rubber face piece, eyepieces, outlet + canister), M1 helmet with a team band
  const H = r.head;
  add(H, geo.sphere(0.088, 7, 5), M.skin, [0, 0.092, 0.0]);
  add(H, geo.sphere(0.086, 7, 5), M.rubber, [0, 0.086, 0.034], null, [1.05, 1.03, 0.82]);
  for (const s of [1, -1]) {
    zcyl(H, 0.03, 0.03, 0.088, 0.106, M.gunL, 6, s * 0.037, 0.108);
    zcyl(H, 0.024, 0.024, 0.09, 0.112, mat(C.lens), 6, s * 0.037, 0.108);
  }
  zcyl(H, 0.026, 0.034, 0.085, 0.13, M.gunL, 6, 0, 0.052);
  add(H, geo.cyl(0.04, 0.04, 0.075, 7), mat(0x5a6340), [0, 0.03, 0.14], [1.05, 0, 0]); // filter canister
  m1Helmet(H, M.helm, { band: M.team });
  add(H, geo.box(0.05, 0.035, 0.02), M.team, [0, 0.165, 0.118], [-0.5, 0, 0]); // front marking
  add(H, geo.box(0.085, 0.014, 0.085), M.team, [0, 0.219, -0.01], [0, Math.PI / 4, 0]); // tactical diamond on the crown

  // --- weapon group (pivot: right shoulder): wand at the right hip, hose, both arms
  const W = r.weapon;
  const piv = [-SOLDIER.sx, SOLDIER.sy, 0];
  const wsp = (p) => [p[0] - piv[0], p[1] - piv[1], p[2] - piv[2]]; // body space -> weapon space
  const G = wsp([-0.17, 0.12, -0.03]);
  const gun = grp(W, G[0], G[1], G[2]);
  zcyl(gun, 0.021, 0.024, 0.0, 0.52, M.gun, 6); // fuel tube
  zcyl(gun, 0.032, 0.032, -0.02, 0.05, M.gunL, 6); // hose coupling
  add(gun, geo.box(0.032, 0.09, 0.036), M.wood, [0, -0.055, 0.1], [0.3, 0, 0]); // rear grip
  add(gun, geo.box(0.012, 0.03, 0.04), M.gunL, [0, -0.032, 0.14]); // trigger guard
  add(gun, geo.box(0.05, 0.05, 0.11), M.gunL, [0, 0.014, 0.17]); // fuel valve
  add(gun, geo.box(0.03, 0.08, 0.032), M.wood, [0, -0.05, 0.32], [0.15, 0, 0]); // front grip
  zcyl(gun, 0.033, 0.033, 0.38, 0.54, M.gunL, 6, 0, -0.042); // igniter cylinder
  add(gun, mergedCyls('ftIgnBand', [[0.036, 0.036, 0.05, 0, -0.042, 0.445, HALF_PI, 0, 6, true]]), M.team);
  zcyl(gun, 0.025, 0.03, 0.52, 0.6, M.gun, 6); // nozzle
  muzzle(gun, 0, 0, 0.6);
  const pilot = fire(gun, 0, -0.004, 0.6, 0.085);
  pilot.rotation.x = 1.15; // small flame licking forward and up from the nozzle
  // hose: tank bottom -> round the right hip -> wand coupling
  const hose = [[-0.086, 0.03, tz], [-0.19, -0.02, -0.15], [-0.215, 0.05, -0.08], [-0.17, 0.12, -0.05]].map(wsp);
  const rubber = M.rubber;
  for (let i = 0; i < hose.length - 1; i++) {
    const a = i ? lerp3(hose[i], hose[i - 1], 0.12) : hose[i]; // overlap the joints a little
    rod(W, a, hose[i + 1], 0.018, rubber, 5);
  }
  const hR = [G[0], G[1] - 0.062, G[2] + 0.1];
  const hL = [G[0], G[1] - 0.06, G[2] + 0.32];
  giArm(W, [0, 0, 0], [-0.045, -0.165, -0.035], hR, M, { band: M.team, hand: M.glove });
  giArm(W, [2 * SOLDIER.sx, 0, 0], [0.33, -0.19, 0.08], hL, M, { band: M.team, hand: M.glove });
  scaled(r, 1.06);
  return {
    root: r.root,
    parts: { body: r.body, head: r.head, legs: r.legs, weapon: r.weapon, fire: [pilot] },
    height: 1.18,
    radius: 0.42,
  };
}

// ---------------------------------------------------------------------------
// Sniper
// ---------------------------------------------------------------------------

/** Scoped bolt-action rifle along +Z from the butt plate (bore at y = 0.022). Returns the muzzle z. */
function sniperRifle(g, M) {
  const by = 0.022, len = 0.92, sy = by + 0.062;
  add(g, geo.box(0.04, 0.088, 0.2), M.wood, [0, -0.02, 0.1], [0.1, 0, 0]); // butt
  add(g, geo.box(0.042, 0.09, 0.012), M.gun, [0, -0.026, 0.004], [0.1, 0, 0]); // butt plate
  add(g, geo.box(0.036, 0.03, 0.08), M.woodL, [0, 0.03, 0.12]); // cheek rest
  add(g, geo.box(0.034, 0.05, 0.1), M.wood, [0, -0.002, 0.24]); // wrist
  add(g, geo.box(0.036, 0.04, 0.16), M.gun, [0, by, 0.35]); // receiver
  add(g, geo.box(0.055, 0.012, 0.012), M.gun, [-0.032, 0.03, 0.31], [0, 0, -0.3]); // bolt handle
  add(g, geo.box(0.022, 0.022, 0.022), M.gun, [-0.06, 0.022, 0.31]);
  add(g, geo.box(0.012, 0.035, 0.05), M.gun, [0, -0.026, 0.3]); // trigger guard
  add(g, geo.box(0.036, 0.046, 0.46), M.wood, [0, 0.006, 0.66]); // fore-end
  zcyl(g, 0.011, 0.013, 0.86, len, M.gun, 6, 0, by); // barrel
  zcyl(g, 0.014, 0.014, len - 0.03, len, M.gun, 6, 0, by); // crown
  // burlap strips wound round the fore-end
  add(g, mergedBoxes('at-snWrap', [[0.044, 0.054, 0.035, 0, 0, 0.56], [0.044, 0.054, 0.03, 0, 0, 0.74]]), mat(C.camoD), [0, 0.006, 0]);
  // telescope: mounts, tube, ocular and objective bells, lens
  add(g, mergedBoxes('at-snMounts', [[0.02, 0.05, 0.022, 0, 0, 0.3], [0.02, 0.05, 0.022, 0, 0, 0.42]]), M.gun, [0, by + 0.035, 0]);
  zcyl(g, 0.017, 0.017, 0.22, 0.5, M.gun, 6, 0, sy);
  zcyl(g, 0.021, 0.017, 0.19, 0.24, M.gun, 6, 0, sy);
  zcyl(g, 0.026, 0.017, 0.48, 0.55, M.gun, 6, 0, sy);
  zcyl(g, 0.02, 0.02, 0.55, 0.556, mat(0x6fb0d0, { emissive: 0x2a5a78, emissiveIntensity: 0.4 }), 6, 0, sy);
  add(g, geo.cyl(0.012, 0.012, 0.03, 6), M.gun, [0, sy + 0.024, 0.36]); // turret
  // sling
  beam(g, [0, -0.045, 0.16], [0, -0.09, 0.42], 0.016, M.khakiD, 0.006);
  beam(g, [0, -0.09, 0.42], [0, -0.02, 0.7], 0.016, M.khakiD, 0.006);
  muzzle(g, 0, by, len + 0.004);
  return len;
}

// WWII marksman: helmet under a burlap scrim, hooded ghillie cape of hanging camo strips over a camo
// smock, a big team scarf knotted at the throat with its tails over the cape, a team armband, and a long
// scoped bolt-action rifle held at the ready, level along +Z.
export function sniper(tc) {
  const { r, M } = giBase(tc);
  const B = r.body;
  const camoA = mat(C.camoA), camoB = mat(C.camoB), camoC = mat(C.camoC), camoD = mat(C.camoD);
  // --- ghillie cape: mantle over the shoulders, drape down the back, hanging strips
  add(B, CG.frustum(0.55), camoB, [0, 0.31, -0.015], null, [0.46, 0.16, 0.33]);
  add(B, CG.frustum(0.72), camoA, [0, 0.07, -0.14], [0.16, 0, 0], [0.44, 0.52, 0.07]);
  const rand = rng(1947);
  const strips = [[], [], []];
  for (let i = 0; i < 13; i++) {
    const a = -2.25 + (4.5 * i) / 12 + (rand() - 0.5) * 0.12;
    const h = 0.12 + rand() * 0.08;
    const x = Math.sin(a) * 0.23, z = -Math.cos(a) * 0.165 - 0.015;
    strips[i % 3].push([0.05 + rand() * 0.02, h, 0.014, x, 0.25 - h / 2 + rand() * 0.02, z, Math.PI - a, -0.25]);
  }
  for (const [y, n] of [[0.2, 3], [0.06, 4], [-0.08, 3], [-0.18, 3]]) {
    for (let i = 0; i < n; i++) {
      const x = -0.17 + (0.34 * (i + 0.5)) / n + (rand() - 0.5) * 0.04;
      const h = 0.1 + rand() * 0.07;
      const z = -0.185 - (0.07 - y) * 0.16;
      strips[(i + n) % 3].push([0.055 + rand() * 0.02, h, 0.014, x, y - h * 0.3, z, (rand() - 0.5) * 0.5, 0.2]);
    }
  }
  add(B, mergedBoxes('at-snStripsA', strips[0]), camoC);
  add(B, mergedBoxes('at-snStripsB', strips[1]), camoD);
  add(B, mergedBoxes('at-snStripsC', strips[2]), camoA);
  // --- team scarf: neck wrap, knot, tails over the cape
  add(B, CG.frustum(0.74), M.team, [0, 0.395, -0.005], null, [0.28, 0.085, 0.24]);
  add(B, geo.box(0.075, 0.06, 0.045), M.teamD, [0.03, 0.37, 0.11], [0.2, 0, 0.3]);
  add(B, mergedRot('snScarfTails', [[0.07, 0.17, 0.016, 0.0, 0, 0, 0.18, 0, 0.12], [0.06, 0.13, 0.016, 0.07, 0.02, -0.01, 0.22, 0, -0.18]]), M.team, [0.03, 0.29, -0.2]);
  add(B, geo.box(0.055, 0.1, 0.016), M.team, [0.06, 0.31, 0.125], [0.25, 0, 0.15]); // front tail

  // --- head: face with camo paint, helmet under burlap scrim with tufts
  const H = r.head;
  H.rotation.x = 0.1;
  add(H, geo.sphere(0.088, 7, 5), M.skin, [0, 0.092, 0.012]);
  add(H, geo.box(0.026, 0.034, 0.03), M.skin, [0, 0.082, 0.1]);
  add(H, mergedBoxes('at-snFacePaint', [[0.15, 0.022, 0.03, 0, 0.1, 0.075], [0.12, 0.02, 0.03, 0, 0.06, 0.07]]), camoC, [0, 0, 0]);
  m1Helmet(H, camoB);
  const tufts = [];
  const r2 = rng(77);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    tufts.push([0.055, 0.07 + r2() * 0.04, 0.014, Math.sin(a) * 0.1, 0.17 + r2() * 0.03, Math.cos(a) * 0.1 - 0.01, -0.5, a, 0]);
  }
  add(H, mergedRot('snTufts', tufts), camoD);
  add(H, mergedBoxes('at-snNet', [[0.24, 0.012, 0.012, 0, 0.2, 0.02], [0.012, 0.012, 0.25, 0, 0.2, -0.006], [0.2, 0.012, 0.012, 0, 0.19, -0.07]]), camoC);

  // --- weapon group (pivot: right shoulder): rifle tucked into the shoulder, both arms
  const W = r.weapon;
  const R0 = [0.09, -0.085, 0.05]; // butt plate, weapon space
  const gunG = grp(W, R0[0], R0[1], R0[2]);
  sniperRifle(gunG, M);
  giArm(W, [0, 0, 0], [-0.075, -0.16, 0.07], [R0[0], R0[1] - 0.03, R0[2] + 0.24], M, { sleeve: camoB });
  giArm(W, [2 * SOLDIER.sx, 0, 0], [0.31, -0.19, 0.2], [R0[0], R0[1] - 0.035, R0[2] + 0.44], M, { band: M.team, sleeve: camoB });
  return {
    root: r.root,
    parts: { body: r.body, head: r.head, legs: r.legs, weapon: r.weapon },
    height: 1.15,
    radius: 0.38,
  };
}

// ===========================================================================
// Half-track
// ===========================================================================

// M3-style armored half-track in olive drab: front wheels under flat fenders, unditching roller, louvered
// radiator armor, a hood with a team star in a white ring, open cab with a raised armored windshield, open
// troop bay with benches and ammo boxes, rear track units (sprocket, idler, four road wheels), team stars and
// stripes on the bay sides, a team tarp roll, jerrycans, a radio whip with a team pennant, and the
// pintle-mounted .50 cal machine gun (parts.weapon, pivot at the pintle head) resting level over the cab.
export function half_track(tc) {
  const root = new THREE.Group();
  const armor = mat(C.armor), armorD = mat(C.armorD), armorL = mat(C.armorL), team = mat(tc), white = mat(0xf0eee4);
  const tire = mat(C.tire), trackM = mat(C.track), dark = mat(0x1c1d20), gun = mat(C.gun), gunL = mat(C.gunL);
  const canvas = mat(0x8f8560), seat = mat(0x5e4b34);
  const wheels = [];
  // --- rear track units: rubber band loop (profile with a hole), grousers, road wheels, sprocket, idler
  const TX = 0.465, TW = 0.24, T = 0.045;
  const SZ = -0.14, SY = 0.22, SR = 0.2; // drive sprocket at the front of the unit
  const IZ = -0.94, IY = 0.19, IR = 0.18; // idler at the rear
  const arc = (cz, cy, r, a0, a1, n = 3) => Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cz + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  const outer = [[-0.86, 0], [-0.22, 0], ...arc(SZ, SY, SR, -1.9, HALF_PI), ...arc(IZ, IY, IR, HALF_PI, Math.PI + 1.25)];
  const inner = [[-0.84, T], [-0.24, T], ...arc(SZ, SY, SR - T, -1.9, HALF_PI), ...arc(IZ, IY, IR - T, HALF_PI, Math.PI + 1.25)];
  const trackGeo = profileX('htTrack', outer, TW, { holes: [inner.slice().reverse()] });
  // tread bars: flat quads facing out of the loop (2 triangles each; the camera sees the top runs)
  add(root, geo.custom('at:htTread', () => {
    const list = [];
    for (let i = 1; i < outer.length - 1; i++) { // skip the ground run and the hidden rear-bottom edge
      const [az, ay] = outer[i], [bz, by] = outer[i + 1];
      const dz = bz - az, dy = by - ay, len = Math.hypot(dz, dy);
      const nz = dy / len, ny = -dz / len;
      const n = Math.max(1, Math.round(len / 0.1));
      for (let j = 0; j < n; j++) {
        const t = (j + 0.5) / n;
        for (const s of [1, -1]) {
          list.push(new THREE.PlaneGeometry(TW + 0.004, 0.036).rotateX(-HALF_PI).rotateX(Math.atan2(nz, ny))
            .translate(s * TX, ay + dy * t + ny * 0.003, az + dz * t + nz * 0.003));
        }
      }
    }
    return mergeAll(list);
  }), mat(0x55534a));
  const roadTyre = wheelGeo('htRoad', [['cyl', 0.1, 0.2, 7]]);
  const roadHub = wheelGeo('htRoadHub', [['cyl', 0.055, 0.214, 5]]);
  const sprocket = wheelGeo('htSprocket', [['cyl', 0.152, 0.2, 8]]);
  const sprHub = wheelGeo('htSprHub', [['box', 0.216, 0.26, 0.04], ['box', 0.216, 0.04, 0.26]]);
  const idler = wheelGeo('htIdler', [['cyl', 0.132, 0.2, 8]]);
  for (const s of [1, -1]) {
    add(root, trackGeo, trackM, [s * TX, 0, 0]);
    for (const z of [-0.34, -0.51, -0.68, -0.85]) {
      const w = grp(root, s * TX, 0.145, z);
      add(w, roadTyre, tire);
      add(w, roadHub, armorL);
      wheels.push(w);
    }
    const sp = grp(root, s * TX, SY, SZ);
    add(sp, sprocket, armorD);
    add(sp, sprHub, armorL);
    const id = grp(root, s * TX, IY, IZ);
    add(id, idler, armorD);
    add(id, roadHub, armorL);
    wheels.push(sp, id);
    add(root, geo.box(0.12, 0.05, 0.62), armorD, [s * TX, 0.29, -0.58]); // suspension beam
  }
  // --- front wheels + axle
  const fTyre = wheelGeo('htFrontTyre', [['cyl', 0.21, 0.15, 10]]);
  const fHub = wheelGeo('htFrontHub', [['cyl', 0.125, 0.158, 6], ['box', 0.164, 0.2, 0.034], ['box', 0.164, 0.034, 0.2]]);
  for (const s of [1, -1]) {
    const w = grp(root, s * 0.485, 0.21, 0.7);
    add(w, fTyre, tire);
    add(w, fHub, armorL);
    wheels.push(w);
  }
  xcyl(root, 0.035, 0.84, dark, 0, 0.21, 0.7, 5);
  // --- chassis, hood, radiator armor, fenders, lights, bumper + roller
  add(root, geo.box(0.66, 0.2, 1.42), armorD, [0, 0.33, -0.42]);
  add(root, profileX('htHood', [[0.3, 0.4], [0.97, 0.4], [0.97, 0.73], [0.92, 0.79], [0.3, 0.82]], 0.66), armor);
  add(root, geo.box(0.02, 0.012, 0.6), armorD, [0, 0.812, 0.6], [0.048, 0, 0]); // hood hinge
  add(root, geo.box(0.62, 0.32, 0.03), armorD, [0, 0.57, 0.975]);
  add(root, mergedRot('htLouvers', [0, 1, 2, 3, 4].map((i) => [0.6, 0.018, 0.065, 0, 0.45 + i * 0.06, 0, -0.6, 0, 0])), armor, [0, 0, 1.0]);
  // Allied air-recognition star on the hood: white ring, olive disc, team star
  const hy = 0.807, hz = 0.6;
  add(root, geo.ring(0.148, 0.178, 12), white, [0, hy + 0.003, hz], [-HALF_PI + 0.048, 0, 0]);
  add(root, starGeo(0.14, 0.056, 0.012), team, [0, hy + 0.004, hz], [-HALF_PI + 0.048, 0, 0]);
  for (const s of [1, -1]) {
    const fx = s * 0.485;
    add(root, geo.box(0.22, 0.025, 0.54), armor, [fx, 0.47, 0.66]);
    add(root, geo.box(0.22, 0.025, 0.16), armor, [fx, 0.43, 0.985], [0.55, 0, 0]);
    add(root, geo.box(0.22, 0.025, 0.14), armor, [fx, 0.445, 0.35], [-0.35, 0, 0]);
    add(root, geo.box(0.014, 0.08, 0.5), armorD, [fx + s * 0.11, 0.43, 0.66]); // fender skirt
    zcyl(root, 0.045, 0.05, 0.86, 0.94, armorD, 6, s * 0.42, 0.53); // headlight on the fender
    zcyl(root, 0.036, 0.036, 0.94, 0.946, mat(0xf2ecc8, { emissive: 0x6a6040, emissiveIntensity: 0.4 }), 6, s * 0.42, 0.53);
  }
  add(root, geo.box(1.08, 0.09, 0.06), armorD, [0, 0.36, 1.0]);
  xcyl(root, 0.085, 0.7, armorL, 0, 0.36, 1.065, 8); // unditching roller
  add(root, mergedBoxes('at-htRollerArms', [[0.04, 0.06, 0.12, 0.4, 0.36, 1.04], [0.04, 0.06, 0.12, -0.4, 0.36, 1.04]]), armorD);
  add(root, mergedBoxes('at-htShackles', [[0.06, 0.07, 0.05, 0.5, 0.36, 1.03], [0.06, 0.07, 0.05, -0.5, 0.36, 1.03]]), dark);
  // --- armored body: side plates (door cut at the cab), rear plate, cowl, raised windshield
  const SX = 0.505;
  const sidePts = [[0.33, 0.42], [0.33, 0.84], [0.29, 0.865], [-0.04, 0.865], [-0.04, 0.98], [-1.12, 0.98], [-1.12, 0.42]];
  for (const s of [1, -1]) {
    add(root, profileX('htSide', sidePts, 0.03), armor, [s * SX, 0, 0]);
    add(root, geo.box(0.012, 0.42, 0.012), armorD, [s * (SX + 0.016), 0.64, 0.06]); // door seam
  }
  add(root, geo.box(2 * SX + 0.03, 0.56, 0.03), armor, [0, 0.7, -1.105]);
  add(root, mergedBoxes('at-htRearDoor', [[0.012, 0.44, 0.012, -0.19, 0, 0], [0.012, 0.44, 0.012, 0.19, 0, 0]]), armorD, [0, 0.66, -1.122]);
  add(root, mergedBoxes('at-htTail', [[0.06, 0.04, 0.02, 0.4, 0, 0], [0.06, 0.04, 0.02, -0.4, 0, 0]]), mat(0xa02018), [0, 0.88, -1.126]);
  add(root, geo.box(2 * SX, 0.42, 0.03), armor, [0, 0.63, 0.315]);
  const ws = grp(root, 0, 0.84, 0.322);
  ws.rotation.x = -0.12;
  add(ws, geo.box(2 * SX + 0.02, 0.2, 0.03), armor, [0, 0.1, 0]);
  add(ws, mergedBoxes('at-htSlits', [[0.17, 0.026, 0.034, 0.23, 0.11, 0], [0.17, 0.026, 0.034, -0.23, 0.11, 0]]), dark);
  // --- cab interior: dashboard, seats, steering wheel
  add(root, geo.box(2 * SX - 0.02, 0.03, 1.42), armorD, [0, 0.455, -0.4]);
  add(root, geo.box(2 * SX - 0.02, 0.07, 0.07), armorD, [0, 0.8, 0.27]);
  for (const x of [0.22, -0.22]) {
    add(root, geo.box(0.26, 0.07, 0.22), seat, [x, 0.6, 0.08]);
    add(root, geo.box(0.26, 0.2, 0.05), seat, [x, 0.74, -0.03], [-0.15, 0, 0]);
  }
  rod(root, [0.22, 0.78, 0.27], [0.22, 0.86, 0.16], 0.012, dark, 5);
  add(root, geo.torus(0.075, 0.012, 3, 6), dark, [0.22, 0.865, 0.155], [0.52, 0, 0]);
  // --- troop bay: benches, ammo boxes, team tarp roll on the rear plate
  for (const s of [1, -1]) {
    add(root, geo.box(0.15, 0.2, 0.92), canvas, [s * 0.4, 0.56, -0.6]);
    add(root, geo.box(0.03, 0.2, 0.92), canvas, [s * 0.475, 0.77, -0.6]);
  }
  add(root, mergedBoxes('at-htAmmo', [[0.14, 0.1, 0.09, 0.12, 0.52, -0.7], [0.14, 0.1, 0.09, -0.1, 0.52, -0.66]]), armorL);
  xcyl(root, 0.062, 0.92, team, 0, 1.04, -1.07, 8);
  // team air-recognition panel lashed over the stowage at the back of the bay
  add(root, geo.box(0.86, 0.02, 0.3), team, [0, 0.69, -0.9], [-0.12, 0, 0]);
  add(root, mergedBoxes('at-htTarpStraps', [[0.025, 0.135, 0.135, 0.26, 0, 0], [0.025, 0.135, 0.135, -0.26, 0, 0]]), mat(0x6e6648), [0, 1.04, -1.07]);
  // --- markings + stowage outside: team stars and stripes on the bay sides, jerrycans, radio whip + pennant
  for (const s of [1, -1]) {
    const x = s * (SX + 0.016);
    add(root, starGeo(0.12, 0.048, 0.012), team, [x, 0.69, -0.42], [0, s * HALF_PI, 0]);
    add(root, geo.box(0.012, 0.045, 1.06), team, [x, 0.93, -0.58]);
    add(root, mergedBoxes('at-htCans', [[0.06, 0.2, 0.13, 0, 0, -0.97], [0.06, 0.2, 0.13, 0, 0, -0.82]]), armorL, [s * (SX + 0.045), 0.65, 0]);
    add(root, geo.box(0.07, 0.025, 0.31), armorD, [s * (SX + 0.045), 0.56, -0.895]); // can rack shelf
  }
  add(root, geo.box(0.06, 0.08, 0.06), armorD, [-0.45, 1.0, -1.04]);
  add(root, geo.cyl(0.005, 0.008, 0.6, 4), dark, [-0.45, 1.34, -1.04]);
  add(root, CG.pennant(), team, [-0.45, 1.58, -1.04], [0, HALF_PI, 0], [0.14, 0.09, 0.012]);
  // --- pintle post + .50 cal machine gun (weapon)
  const PZ = -0.42, PY = 1.14;
  add(root, geo.cyl(0.07, 0.09, 0.05, 6), armorD, [0, 0.495, PZ]);
  add(root, geo.cyl(0.03, 0.035, PY - 0.52, 6), gunL, [0, (0.52 + PY) / 2 - 0.02, PZ]);
  const weapon = grp(root, 0, PY, PZ);
  add(weapon, mergedBoxes('at-htYoke', [[0.13, 0.03, 0.08, 0, -0.035, 0], [0.02, 0.07, 0.07, 0.058, 0.0, 0], [0.02, 0.07, 0.07, -0.058, 0.0, 0]]), gunL);
  add(weapon, geo.box(0.08, 0.1, 0.3), gun, [0, 0.03, 0.02]); // receiver
  add(weapon, geo.box(0.084, 0.02, 0.22), gunL, [0, 0.088, 0.03]); // top cover
  add(weapon, mergedBoxes('at-htGrips', [[0.016, 0.07, 0.018, 0.034, 0.02, -0.18], [0.016, 0.07, 0.018, -0.034, 0.02, -0.18], [0.084, 0.018, 0.04, 0, 0.0, -0.15]]), gun);
  zcyl(weapon, 0.031, 0.031, 0.17, 0.34, gunL, 6, 0, 0.03); // perforated barrel support
  add(weapon, mergedBoxes('at-htJacketHoles', [0.21, 0.26, 0.31].map((z) => [0.066, 0.016, 0.016, 0, 0, z])), dark, [0, 0.03, 0]);
  zcyl(weapon, 0.016, 0.018, 0.34, 0.83, gun, 6, 0, 0.03); // barrel
  zcyl(weapon, 0.024, 0.02, 0.81, 0.876, gun, 6, 0, 0.03); // muzzle booster
  add(weapon, geo.box(0.012, 0.035, 0.012), gun, [0, 0.065, 0.79]); // front sight
  add(weapon, geo.box(0.03, 0.04, 0.03), gun, [0, 0.11, -0.07]); // rear sight
  add(weapon, geo.box(0.085, 0.12, 0.18), armorL, [0.095, -0.02, 0.02]); // ammo can
  add(weapon, geo.box(0.088, 0.03, 0.12), team, [0.095, 0.0, 0.02]);
  add(weapon, mergedRot('htBelt', [[0.014, 0.05, 0.06, 0.05, 0.04, 0.02, 0, 0, -0.5]]), mat(0xd2a446));
  muzzle(weapon, 0, 0.03, 0.876);
  return { root, parts: { weapon, wheels }, height: 1.3, radius: 0.85 };
}

// ===========================================================================
// Atomic Hall (town center)
// ===========================================================================

// Art-deco / streamline-moderne seat of government: terrazzo plaza with a reflecting pool, flagpoles and
// deco lamps; a limestone terrace with a grand stair; two streamline wings with rounded corners, wrap-around
// ribbon windows, triple team "speed stripes", team banners and roof flags; a stepped setback tower with
// vertical fins and gold caps, a bronze-and-gold portal under a team sunburst panel, a big clock, a gold atom
// emblem, team bands at every setback, and a lattice radio mast with a blinking red beacon (glow).
export function atomic_hall(tc) {
  const root = new THREE.Group();
  const lime = mat(C.lime), limeD = mat(C.limeD), limeL = mat(C.limeL), team = mat(tc);
  const gold = mat(P.gold), glass = mat(C.glassK), bronze = mat(C.bronze), roofM = mat(C.roof), dark = mat(0x1d1e22);
  const glow = [];
  // --- plaza, terrace, grand stair
  add(root, geo.box(3.86, 0.06, 3.86), mat(C.terrazzo), [0, 0.03, 0]);
  add(root, mergedBoxes('at-ahPaving', [-1.5, -0.9, 0.9, 1.5].map((x) => [0.025, 0.006, 0.86, x, 0, 1.5]).concat([[3.8, 0.006, 0.025, 0, 0, 1.25]])), mat(0xb3ab98), [0, 0.062, 0]);
  const b = 0.26;
  add(root, geo.box(3.72, b - 0.06, 2.9), limeD, [0, 0.06 + (b - 0.06) / 2, -0.47]);
  add(root, geo.box(3.74, 0.035, 2.92), limeL, [0, b - 0.0175, -0.47]);
  for (let k = 0; k < 3; k++) {
    const h = (b - 0.06) * (1 - k / 3), z1 = 0.98 + (k + 1) * 0.12;
    add(root, geo.box(1.5 + k * 0.16, h, z1 - 0.9), k % 2 ? limeD : limeL, [0, 0.06 + h / 2, (z1 + 0.9) / 2]);
  }
  // --- streamline wings: rounded front corners, ribbon windows, team speed stripes, banners, roof flags
  const WX0 = 0.66, WX1 = 1.84, WZ0 = -1.8, WZ1 = 0.5, WR = 0.5, WH = 1.4;
  const wingPts = (s, o) => {
    const pts = [[s * WX0, WZ0 - o], [s * (WX1 + o), WZ0 - o]];
    const cx = WX1 - WR, cz = WZ1 - WR;
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * HALF_PI;
      pts.push([s * (cx + (WR + o) * Math.cos(a)), cz + (WR + o) * Math.sin(a)]);
    }
    pts.push([s * WX0, WZ1 + o]);
    return pts;
  };
  for (const s of [1, -1]) {
    add(root, planGeo(`ahWing${s}`, wingPts(s, 0), WH), lime, [0, b, 0]);
    add(root, planGeo(`ahWingPlinth${s}`, wingPts(s, 0.014), 0.1), limeD, [0, b, 0]);
    for (const y of [0.24, 0.68]) add(root, planGeo(`ahWingWin${s}`, wingPts(s, 0.01), 0.26), glass, [0, b + y, 0]);
    for (const y of [1.04, 1.11, 1.18]) add(root, planGeo(`ahWingStripe${s}`, wingPts(s, 0.012), 0.035), team, [0, b + y, 0]);
    add(root, planGeo(`ahWingCap${s}`, wingPts(s, 0.035), 0.07), limeL, [0, b + WH, 0]);
    add(root, planGeo(`ahWingRoof${s}`, wingPts(s, -0.07), 0.012), roofM, [0, b + WH + 0.07, 0]);
    const mull = [];
    for (const y of [0.37, 0.81]) {
      for (let x = WX0 + 0.3; x < WX1 - WR; x += 0.2) mull.push([0.03, 0.27, 0.025, s * x, y, WZ1 + 0.012]);
      for (let i = 1; i < 4; i++) {
        const a = (i / 4) * HALF_PI;
        mull.push([0.03, 0.27, 0.025, s * (WX1 - WR + (WR + 0.012) * Math.cos(a)), y, WZ1 - WR + (WR + 0.012) * Math.sin(a), Math.atan2(s * Math.cos(a), Math.sin(a))]);
      }
    }
    add(root, mergedBoxes(`at-ahWingMull${s}`, mull), limeL, [0, b, 0]);
    banner(root, s * 1.0, b + 0.99, WZ1 + 0.018, tc, { w: 0.3, h: 0.62, trim: P.gold, emblem: P.gold });
    flag(root, s * (WX1 - WR * 0.62), b + WH + 0.08, WZ1 - WR * 0.62, tc, { pole: 0.85, w: 0.46, h: 0.28, dir: -s, poleColor: 0xd8dde2, finial: P.gold, poleR: 0.018 });
    // rooftop skylight strip
    add(root, geo.box(0.5, 0.06, 1.3), mat(0x86a9c2), [s * 1.18, b + WH + 0.1, -0.95]);
    add(root, mergedBoxes('at-ahSkyBars', [-0.12, 0.12].map((x) => [0.025, 0.07, 1.32, x, 0, 0])), limeL, [s * 1.18, b + WH + 0.105, -0.95]);
  }
  // --- tower: tier 1 (fins, ribbon strips, portal)
  const tier = (x, z0, z1, y0, y1, key) => {
    const zc = (z0 + z1) / 2, d = z1 - z0;
    add(root, geo.box(2 * x, y1 - y0, d), lime, [0, (y0 + y1) / 2, zc]);
    add(root, geo.box(2 * x + 0.03, 0.08, d + 0.03), team, [0, y1 - 0.07, zc]);
    add(root, geo.box(2 * x + 0.06, 0.07, d + 0.06), limeL, [0, y1 + 0.035, zc]);
    const fins = [], caps = [];
    for (const [fx, top] of key) {
      for (const s of [1, -1]) {
        fins.push([0.09, top - y0, 0.1, s * fx, (y0 + top) / 2, z1 + 0.03]);
        caps.push([0.062, 0.1, 0.072, s * fx, top + 0.05, z1 + 0.03]);
      }
    }
    add(root, mergedBoxes(`at-ahFins${y0}`, fins), limeL);
    add(root, mergedBoxes(`at-ahFinCaps${y0}`, caps), gold);
    return y1 + 0.07;
  };
  const T1 = { x: 0.74, z0: -1.55, z1: 0.78, y1: 2.3 };
  const y2 = tier(T1.x, T1.z0, T1.z1, b, T1.y1, [[0.27, 2.46], [0.5, 2.46], [0.72, 2.46]]);
  add(root, geo.box(2 * T1.x + 0.03, 0.1, T1.z1 - T1.z0 + 0.03), limeD, [0, b + 0.05, (T1.z0 + T1.z1) / 2]);
  const wins = [], spand = [];
  for (const s of [1, -1]) {
    for (const [x, w] of [[0.385, 0.13], [0.61, 0.12]]) {
      wins.push([w, 1.62, 0.02, s * x, 1.36, T1.z1 + 0.005]);
      for (const y of [1.0, 1.7]) spand.push([w + 0.01, 0.1, 0.03, s * x, y, T1.z1 + 0.012]);
    }
    for (const z of [-0.2, -0.65, -1.1]) wins.push([0.02, 0.42, 0.16, s * (T1.x + 0.005), 1.98, z]);
  }
  add(root, mergedBoxes('at-ahWin1', wins), glass);
  add(root, mergedBoxes('at-ahSpand1', spand), limeD);
  // portal: surround, bronze doors with gold trim, transom with gold bars, canopy, team sunburst panel
  const pz = T1.z1;
  add(root, geo.box(0.44, 1.5, 0.04), limeL, [0, b + 0.75, pz + 0.02]);
  add(root, geo.box(0.32, 0.68, 0.03), dark, [0, b + 0.34, pz + 0.035]);
  add(root, mergedBoxes('at-ahDoors', [[0.14, 0.62, 0.02, -0.075, 0, 0], [0.14, 0.62, 0.02, 0.075, 0, 0]]), bronze, [0, b + 0.31, pz + 0.05]);
  add(root, mergedBoxes('at-ahDoorTrim', [[0.012, 0.6, 0.012, 0, 0.31, 0], [0.012, 0.12, 0.012, -0.03, 0.32, 0.01], [0.012, 0.12, 0.012, 0.03, 0.32, 0.01], [0.3, 0.02, 0.012, 0, 0.12, 0]]), gold, [0, b, pz + 0.062]);
  add(root, geo.box(0.32, 0.6, 0.02), glass, [0, b + 1.06, pz + 0.045]);
  add(root, mergedBoxes('at-ahTransom', [[0.014, 0.6, 0.014, -0.08, 0, 0], [0.014, 0.6, 0.014, 0, 0, 0], [0.014, 0.6, 0.014, 0.08, 0, 0], [0.32, 0.014, 0.014, 0, -0.1, 0], [0.32, 0.014, 0.014, 0, 0.12, 0]]), gold, [0, b + 1.06, pz + 0.058]);
  add(root, geo.box(0.66, 0.045, 0.3), limeL, [0, b + 0.73, pz + 0.17]);
  add(root, geo.box(0.67, 0.022, 0.31), gold, [0, b + 0.7, pz + 0.17]);
  add(root, geo.box(0.44, 0.44, 0.03), team, [0, b + 1.76, pz + 0.04]);
  const rays = [];
  for (let i = 0; i < 7; i++) {
    const a = -1.3 + (2.6 * i) / 6;
    rays.push([0.022, 0.15, 0.012, Math.sin(a) * 0.12, Math.cos(a) * 0.12, 0, 0, 0, -a]);
  }
  add(root, mergedRot('ahSunburst', rays), gold, [0, b + 1.62, pz + 0.06]);
  add(root, geo.cyl(0.06, 0.06, 0.02, 10), gold, [0, b + 1.62, pz + 0.06], [HALF_PI, 0, 0]);
  add(root, geo.box(0.36, 0.03, 0.02), gold, [0, b + 1.94, pz + 0.06]);
  // --- tier 2 with the big clock
  const T2 = { x: 0.58, z0: -1.35, z1: 0.46, y1: 3.18 };
  const y3 = tier(T2.x, T2.z0, T2.z1, y2, T2.y1, [[0.45, T2.y1 + 0.12], [0.57, T2.y1 + 0.12]]);
  add(root, mergedBoxes('at-ahWin2', [1, -1].flatMap((s) => [[0.06, 0.6, 0.02, s * 0.51, 2.76, T2.z1 + 0.005]].concat([-0.15, -0.6, -1.05].map((z) => [0.02, 0.5, 0.14, s * (T2.x + 0.005), 2.76, z])))), glass);
  const ck = grp(root, 0, (y2 + T2.y1) / 2 - 0.02, T2.z1);
  add(ck, geo.cyl(0.33, 0.33, 0.05, 16), gold, [0, 0, 0.015], [HALF_PI, 0, 0]);
  add(ck, geo.cyl(0.285, 0.285, 0.05, 16), mat(0xf6f0dc), [0, 0, 0.03], [HALF_PI, 0, 0]);
  const marks = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, big = i % 3 === 0;
    marks.push([big ? 0.036 : 0.02, big ? 0.07 : 0.045, 0.012, Math.sin(a) * 0.235, Math.cos(a) * 0.235, 0, 0, 0, -a]);
  }
  add(ck, mergedRot('ahClockMarks', marks), dark, [0, 0, 0.058]);
  add(ck, mergedRot('ahClockHands', [[0.032, 0.15, 0.012, Math.sin(-0.96) * 0.075, Math.cos(-0.96) * 0.075, 0, 0, 0, 0.96], [0.022, 0.23, 0.012, Math.sin(1.05) * 0.115, Math.cos(1.05) * 0.115, 0.01, 0, 0, -1.05]]), dark, [0, 0, 0.06]);
  add(ck, geo.cyl(0.026, 0.026, 0.03, 8), gold, [0, 0, 0.075], [HALF_PI, 0, 0]);
  // --- tier 3 with the gold atom emblem
  const T3 = { x: 0.42, z0: -1.15, z1: 0.22, y1: 3.8 };
  const y4 = tier(T3.x, T3.z0, T3.z1, y3, T3.y1, [[0.41, T3.y1 + 0.1]]);
  add(root, atomGeo(0.205), gold, [0, (y3 + T3.y1) / 2 - 0.01, T3.z1 + 0.035]);
  // --- crown: slim block with gold steps, slits, lattice radio mast + beacon
  const T4 = { x: 0.26, z0: -0.92, z1: 0.0, y1: 4.04 };
  const zc4 = (T4.z0 + T4.z1) / 2;
  add(root, geo.box(2 * T4.x, T4.y1 - y4, T4.z1 - T4.z0), lime, [0, (y4 + T4.y1) / 2, zc4]);
  add(root, mergedBoxes('at-ahCrownSlits', [-0.13, 0, 0.13].map((x) => [0.04, 0.16, 0.02, x, 0, 0])), glass, [0, (y4 + T4.y1) / 2, T4.z1 + 0.005]);
  add(root, geo.box(2 * T4.x + 0.06, 0.05, T4.z1 - T4.z0 + 0.06), gold, [0, T4.y1 + 0.025, zc4]);
  add(root, geo.box(0.32, 0.07, 0.56), lime, [0, T4.y1 + 0.085, zc4]);
  add(root, geo.box(0.34, 0.03, 0.58), team, [0, T4.y1 + 0.075, zc4]);
  const m0 = T4.y1 + 0.12, AH = 4.74 - m0;
  const mast = [];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) mast.push([[sx * 0.07, 0, sz * 0.07], [sx * 0.012, AH, sz * 0.012], 0.022]);
  for (let k = 1; k < 4; k++) {
    const t = k / 4, h = 0.07 + (0.012 - 0.07) * t;
    mast.push([[h, AH * t, h], [-h, AH * t, -h], 0.014], [[-h, AH * t, h], [h, AH * t, -h], 0.014]);
  }
  add(root, mergedBeams('ahMast', mast), mat(0xd8dde2), [0, m0, zc4]);
  add(root, mergedBoxes('at-ahMastBands', [0.25, 0.55].map((t) => [0.13 - 0.1 * t, 0.04, 0.13 - 0.1 * t, 0, AH * t, 0])), mat(0xc0281c), [0, m0, zc4]);
  const beacon = add(root, geo.sphere(0.045, 6, 4), glowMat(0xff2a1a, 1.3), [0, m0 + AH + 0.02, zc4]);
  beacon.castShadow = false;
  glow.push(beacon);
  // --- plaza: reflecting pool, flagpoles, deco lamps (glow), planters with clipped hedges
  add(root, geo.box(1.3, 0.07, 0.44), limeL, [0, 0.095, 1.64]);
  add(root, geo.box(1.2, 0.02, 0.34), mat(0x4e84ae), [0, 0.125, 1.64]);
  for (const s of [1, -1]) {
    add(root, geo.box(0.2, 0.08, 0.2), limeD, [s * 0.98, 0.1, 1.64]);
    flag(root, s * 0.98, 0.14, 1.64, tc, { pole: 1.85, w: 0.56, h: 0.34, dir: -s, poleColor: 0xd8dde2, finial: P.gold, poleR: 0.022 });
    const lx = s * 1.02, lz = 1.16;
    add(root, geo.box(0.14, 0.08, 0.14), limeD, [lx, 0.1, lz]);
    add(root, geo.cyl(0.022, 0.03, 0.66, 6), mat(0x2c2e33), [lx, 0.47, lz]);
    add(root, geo.cyl(0.05, 0.03, 0.04, 8), gold, [lx, 0.81, lz]);
    const lamp = add(root, geo.sphere(0.075, 7, 5), glowMat(0xfff0c0, 0.95), [lx, 0.89, lz]);
    lamp.castShadow = false;
    glow.push(lamp);
    const px = s * 1.48;
    add(root, geo.box(0.66, 0.14, 0.34), limeD, [px, 0.13, 1.36]);
    add(root, geo.box(0.6, 0.12, 0.28), mat(0x3f7a2a), [px, 0.26, 1.36]);
    add(root, mergedCyls('ahTopiary', [[0, 0.1, 0.34, -0.2, 0.17, 0, 0, 0, 6], [0, 0.1, 0.34, 0.2, 0.17, 0, 0, 0, 6]]), mat(0x3f8a2c), [px, 0.32, 1.36]);
  }
  return { root, parts: { glow }, height: 4.8, radius: 1.95 };
}

// ===========================================================================
// 1950s bungalow
// ===========================================================================

/** Merged white picket fence along runs [[x0, z0, x1, z1, nx, nz], ...] (n = inward normal for the rails). */
function picketFence(key, runs, { h = 0.2, step = 0.07, w = 0.03 } = {}) {
  return geo.custom(`at-pickets:${key}`, () => {
    const s = new THREE.Shape([[-w / 2, 0], [w / 2, 0], [w / 2, h], [0, h + w * 0.8], [-w / 2, h]].map(([x, y]) => new THREE.Vector2(x, y)));
    const picket = new THREE.ExtrudeGeometry(s, { depth: 0.016, bevelEnabled: false });
    picket.translate(0, 0, -0.008);
    const list = [];
    for (const [x0, z0, x1, z1, nx, nz] of runs) {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / step));
      const ry = Math.atan2(x1 - x0, z1 - z0) - HALF_PI;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        list.push(picket.clone().rotateY(ry).translate(x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t));
      }
      for (const y of [h * 0.3, h * 0.72]) {
        list.push(new THREE.BoxGeometry(len, 0.024, 0.016).rotateY(ry).translate((x0 + x1) / 2 + nx * 0.016, y, (z0 + z1) / 2 + nz * 0.016));
      }
    }
    picket.dispose();
    return mergeAll(list);
  });
}

// 1950s ranch bungalow: pastel clapboard walls on a low foundation, a long low-pitched shingle roof with a
// front cross gable over the living room (big picture window under a team/white striped awning, stone
// planter, attic vent), fieldstone chimney (smoke wisp in bob), team front door in the recessed entry,
// garage door, TV antenna on the ridge, white picket fence round the front lawn with a gate and a
// team-flagged mailbox, a tree and shrubs, and a two-tone sedan in the driveway.
export function house_atomic(tc) {
  const root = new THREE.Group();
  const siding = mat(0xf2e3ae), sidingD = mat(0xd9c78e), trim = mat(0xf8f6ee), team = mat(tc), teamD = mat(shade(tc, 0.62));
  const stone = mat(0xae9677), stoneD = mat(0x86705a), glass = mat(0x2c3a4c), conc = mat(0xd4cfc4), steel = mat(0x9aa0a8);
  const roofC = 0x7f756a, roofM = mat(roofC), leaf = mat(P.leaf), leafL = mat(0x4f9a34);
  // --- lot: lawn, driveway, front walk
  add(root, geo.box(1.92, 0.04, 1.92), mat(0x73b347), [0, 0.02, 0]);
  add(root, geo.box(0.5, 0.012, 0.86), conc, [0.62, 0.046, 0.52]);
  add(root, geo.box(0.16, 0.012, 0.8), conc, [-0.04, 0.046, 0.54]);
  // --- main block + living-room wing on a foundation, clapboard lines, corner boards
  const HX = 0.86, HZ0 = -0.82, HZ1 = 0.12, b = 0.04, H0 = b + 0.07, HH = 0.56;
  const zc = (HZ0 + HZ1) / 2, D = HZ1 - HZ0, top = H0 + HH;
  const WX0 = -0.86, WX1 = -0.2, WZ1 = 0.32; // wing front
  const wx = (WX0 + WX1) / 2, ww = WX1 - WX0, wz0 = -0.2, wzc = (wz0 + WZ1) / 2, wd = WZ1 - wz0;
  add(root, mergedBoxes('at-haFound', [[2 * HX + 0.02, 0.07, D + 0.02, 0, 0, zc], [ww + 0.02, 0.07, wd + 0.02, wx, 0, wzc]]), mat(0xb7b2a6), [0, b + 0.035, 0]);
  add(root, mergedBoxes('at-haWalls', [[2 * HX, HH, D, 0, 0, zc], [ww, HH, wd, wx, 0, wzc]]), siding, [0, H0 + HH / 2, 0]);
  const clap = [];
  for (let i = 1; i < 6; i++) {
    const y = H0 + (HH * i) / 6;
    clap.push([2 * HX - ww + 0.008, 0.012, 0.012, (HX + WX1) / 2, y, HZ1], [0.012, 0.012, D + 0.008, HX, y, zc], [0.012, 0.012, D + 0.008, -HX, y, zc]);
    clap.push([ww + 0.008, 0.012, 0.012, wx, y, WZ1], [0.012, 0.012, WZ1 - HZ1, WX1, y, (WZ1 + HZ1) / 2], [0.012, 0.012, WZ1 - HZ1 + 0.004, WX0, y, (WZ1 + HZ1) / 2]);
  }
  add(root, mergedBoxes('at-haClap', clap), sidingD);
  const corners = [[HX, HZ1], [HX, HZ0], [-HX, HZ0], [WX0, WZ1], [WX1, WZ1]].map(([x, z]) => [0.04, HH, 0.04, x, H0 + HH / 2, z]);
  add(root, mergedBoxes('at-haCorners', corners), trim);
  // --- living-room gable front: picture window, stone planter with flowers, striped awning, attic vent
  const pw = { x: wx, y: H0 + 0.3, w: 0.46, h: 0.3 }, fz = WZ1;
  add(root, geo.box(pw.w + 0.06, pw.h + 0.06, 0.03), trim, [pw.x, pw.y, fz + 0.01]);
  add(root, geo.box(pw.w, pw.h, 0.03), glass, [pw.x, pw.y, fz + 0.02]);
  add(root, mergedBoxes('at-haPicBars', [[0.02, pw.h, 0.012, -0.12, 0, 0], [0.02, pw.h, 0.012, 0.12, 0, 0]]), trim, [pw.x, pw.y, fz + 0.036]);
  add(root, geo.box(ww - 0.02, 0.13, 0.12), stone, [pw.x, H0 + 0.065, fz + 0.06]);
  add(root, mergedBoxes('at-haStones', [[0.1, 0.05, 0.01, -0.22, 0.03, 0], [0.12, 0.05, 0.01, 0.04, -0.02, 0], [0.09, 0.04, 0.01, 0.24, 0.025, 0], [0.08, 0.04, 0.01, -0.06, 0.035, 0]]), stoneD, [pw.x, H0 + 0.065, fz + 0.122]);
  add(root, mergedBoxes('at-haFlowers', [-0.24, -0.13, -0.02, 0.09, 0.2].map((x, i) => [0.06, 0.05, 0.06, x, 0, i % 2 ? 0.01 : -0.01])), mat(0xe5404f), [pw.x, H0 + 0.15, fz + 0.06]);
  add(root, mergedBoxes('at-haFlowersY', [-0.185, 0.035, 0.145].map((x) => [0.05, 0.05, 0.05, x, 0, 0.02])), mat(0xf2d03a), [pw.x, H0 + 0.16, fz + 0.06]);
  const stripes = [[], []];
  const aw = 0.6, n = 7;
  for (let i = 0; i < n; i++) stripes[i % 2].push([aw / n + 0.002, 0.014, 0.24, -aw / 2 + (aw * (i + 0.5)) / n, 0, 0, 0.5, 0, 0]);
  const awg = grp(root, pw.x, top - 0.04 - 0.12 * Math.sin(0.5), fz + 0.12 * Math.cos(0.5));
  add(awg, mergedRot('haAwnTeam', stripes[0]), team);
  add(awg, mergedRot('haAwnWhite', stripes[1]), trim);
  add(awg, geo.box(aw, 0.05, 0.012), team, [0, -0.08, 0.11]); // valance
  add(awg, mergedBoxes('at-haAwnSides', [[0.012, 0.1, 0.2, aw / 2, -0.05, 0.02], [0.012, 0.1, 0.2, -aw / 2, -0.05, 0.02]]), teamD);
  // cross-gable roof over the wing: siding gable end, two roof slabs, white barge boards
  const GH = 0.22, GW = ww + 0.16, GL = WZ1 - wz0 + 0.1, gz = wz0 + GL / 2 - 0.02;
  add(root, CG.gable(), siding, [wx, top, (WZ1 + wz0) / 2], [0, HALF_PI, 0], [wd, GH, ww]);
  add(root, mergedBoxes('at-haAtticVent', [0, 1, 2].map((i) => [0.14 - i * 0.03, 0.014, 0.012, 0, i * 0.03, 0])), trim, [wx, top + 0.05, WZ1 + 0.006]);
  const gs = Math.atan2(GH, GW / 2), gl = Math.hypot(GH, GW / 2);
  for (const s of [1, -1]) {
    add(root, geo.box(gl + 0.02, 0.03, GL), roofM, [wx + (s * GW) / 4, top + GH / 2 + 0.012, gz], [0, 0, -s * gs]);
    add(root, geo.box(gl + 0.03, 0.05, 0.03), trim, [wx + (s * GW) / 4, top + GH / 2 + 0.005, gz + GL / 2], [0, 0, -s * gs]);
  }
  add(root, mergedRot('haGableRows', [1, -1].flatMap((s) => [0.35, 0.7].map((f) => [0.03, 0.025, GL, wx + s * (GW / 2) * (1 - f), top + GH * f + 0.03, gz, 0, 0, -s * gs]))), mat(0x695f56));
  // --- recessed entry: team door + stoop + lamp; small window with team shutters; garage door
  const dx = -0.04, ez = HZ1;
  add(root, geo.box(0.23, 0.46, 0.03), trim, [dx, H0 + 0.23, ez + 0.01]);
  add(root, geo.box(0.17, 0.42, 0.03), team, [dx, H0 + 0.21, ez + 0.022]);
  add(root, geo.box(0.05, 0.05, 0.012), glass, [dx, H0 + 0.33, ez + 0.04], [0, 0, Math.PI / 4]);
  add(root, geo.sphere(0.014, 5, 4), mat(P.gold), [dx + 0.055, H0 + 0.2, ez + 0.045]);
  add(root, geo.box(0.32, 0.06, 0.16), conc, [dx, b + 0.03, ez + 0.08]);
  add(root, geo.box(0.32, 0.05, 0.08), conc, [dx, H0, ez + 0.04]);
  add(root, geo.box(0.04, 0.06, 0.04), glowMat(0xffe6a8, 0.6), [dx + 0.15, H0 + 0.36, ez + 0.03]).castShadow = false;
  add(root, geo.box(0.2, 0.18, 0.03), trim, [0.22, H0 + 0.34, ez + 0.01]);
  add(root, geo.box(0.15, 0.13, 0.03), glass, [0.22, H0 + 0.34, ez + 0.02]);
  add(root, mergedBoxes('at-haShutters', [[0.05, 0.18, 0.02, 0.14, 0, 0], [0.05, 0.18, 0.02, 0.3, 0, 0]]), teamD, [0, H0 + 0.34, ez + 0.025]);
  const gx = 0.6, gw = 0.42, gh = 0.4;
  add(root, geo.box(gw + 0.05, gh + 0.03, 0.03), trim, [gx, H0 + gh / 2, ez + 0.01]);
  add(root, geo.box(gw, gh, 0.03), mat(0xeceae2), [gx, H0 + gh / 2 - 0.005, ez + 0.02]);
  add(root, mergedBoxes('at-haGarageLines', [1, 2, 3].map((k) => [gw, 0.01, 0.012, 0, (gh * k) / 4, 0]).concat([-0.12, 0, 0.12].map((x) => [0.08, 0.04, 0.012, x, gh * 0.83, -0.004]))), mat(0xb9b5aa), [gx, H0 - 0.005, ez + 0.036]);
  // side windows
  add(root, mergedBoxes('at-haSideWin', [[0.03, 0.18, 0.26, HX + 0.005, 0, -0.25], [0.03, 0.18, 0.2, -HX - 0.005, 0, -0.6]]), glass, [0, H0 + 0.32, 0]);
  // --- long low-pitched main roof with white fascia
  const RL = 1.82, RD = D + 0.2, RH = 0.23;
  gableRoof(root, 0, top, zc, RL, RD, RH, roofC, 0xf8f6ee, { rows: 3, rowColor: 0x695f56 });
  add(root, mergedBoxes('at-haFascia', [[RL + 0.04, 0.04, 0.03, 0, 0, RD / 2], [RL + 0.04, 0.04, 0.03, 0, 0, -RD / 2]]), trim, [0, top, zc]);
  // --- fieldstone chimney with a smoke wisp
  const cx = -0.6, cz = -0.52, ct = 1.24;
  add(root, geo.box(0.2, ct - top + 0.05, 0.22), stone, [cx, (ct + top - 0.05) / 2, cz]);
  add(root, mergedBoxes('at-haChimStones', [[0.21, 0.04, 0.12, 0, 0.0, 0.02], [0.12, 0.04, 0.23, 0.03, 0.14, 0], [0.21, 0.04, 0.1, 0, 0.28, -0.03]]), stoneD, [cx, top + 0.25, cz]);
  add(root, geo.box(0.24, 0.04, 0.26), conc, [cx, ct + 0.02, cz]);
  const puff = smoke(root, cx, ct + 0.06, cz, { s: 0.075 });
  // --- TV antenna on the ridge: mast, guy wires, Yagi arrays
  const ax = 0.36, az = zc, a0 = top + RH - 0.02, aTop = 1.89;
  add(root, geo.box(0.06, 0.04, 0.06), mat(0x5a5f66), [ax, a0 + 0.02, az]);
  add(root, geo.cyl(0.011, 0.014, aTop - a0, 5), steel, [ax, (a0 + aTop) / 2, az]);
  const yagi = [];
  for (const [y, k] of [[aTop - 0.03, 1], [aTop - 0.2, 0.75]]) {
    yagi.push([0.012, 0.012, 0.5 * k, 0, y, 0]);
    for (let i = 0; i < 5; i++) yagi.push([0.34 * k * (1 - i * 0.12), 0.01, 0.01, 0, y, (-0.22 + i * 0.11) * k]);
  }
  add(root, mergedBoxes('at-haYagi', yagi), steel, [ax, 0, az]);
  add(root, mergedBeams('haGuys', [[[0, 1.45, 0], [0.32, top + 0.12, -0.36], 0.006], [[0, 1.45, 0], [-0.3, top + 0.12, -0.34], 0.006], [[0, 1.45, 0], [0.0, top + 0.1, 0.4], 0.006]]), mat(0x3a3d44), [ax, 0, az]);
  // --- front yard: picket fence + gate posts, mailbox with a team flag, tree, shrubs
  const FZ = 0.925;
  add(root, picketFence('haFence', [[-0.935, FZ, -0.16, FZ, 0, -1], [0.08, FZ, 0.34, FZ, 0, -1], [-0.935, 0.2, -0.935, FZ - 0.07, 1, 0]]), trim);
  add(root, mergedBoxes('at-haGatePosts', [[0.05, 0.27, 0.05, -0.14, 0.135, FZ], [0.05, 0.27, 0.05, 0.06, 0.135, FZ], [0.05, 0.27, 0.05, 0.34, 0.135, FZ], [0.05, 0.27, 0.05, -0.935, 0.135, FZ]]), trim, [0, 0.04, 0]);
  const mb = grp(root, 0.2, 0.04, FZ - 0.08);
  add(mb, geo.box(0.03, 0.26, 0.03), mat(P.woodDark), [0, 0.13, 0]);
  add(mb, geo.box(0.07, 0.07, 0.13), mat(0x9aa0a8), [0, 0.29, 0]);
  add(mb, geo.cyl(0.035, 0.035, 0.13, 8), mat(0x9aa0a8), [0, 0.325, 0], [HALF_PI, 0, 0]);
  add(mb, geo.box(0.012, 0.09, 0.025), team, [0.042, 0.35, -0.02]);
  add(mb, geo.box(0.012, 0.03, 0.05), team, [0.042, 0.38, -0.005]);
  add(root, geo.cyl(0.028, 0.036, 0.3, 6), mat(P.woodDark), [-0.74, 0.19, 0.72]);
  add(root, geo.ico(0.17, 0), leaf, [-0.74, 0.46, 0.72]);
  add(root, geo.ico(0.12, 0), leafL, [-0.68, 0.6, 0.68]);
  add(root, mergedBoxes('at-haShrubs', [[0.16, 0.13, 0.14, -0.86, 0.1, 0.42], [0.13, 0.11, 0.12, 0.3, 0.09, 0.22], [0.14, 0.12, 0.13, -0.16, 0.1, 0.22]]), leafL);
  // --- two-tone sedan in the driveway (nose to the street)
  const car = grp(root, 0.62, 0.052, 0.56);
  const paint = mat(0x96d0bd), cream = mat(0xf3ecd8), chrome = mat(0xdde1e6), tyre = mat(0x1f1f22);
  add(car, geo.box(0.34, 0.1, 0.7), paint, [0, 0.11, 0]);
  add(car, geo.box(0.345, 0.035, 0.56), cream, [0, 0.15, -0.04]);
  add(car, geo.box(0.3, 0.1, 0.3), glass, [0, 0.21, -0.05]);
  add(car, geo.box(0.31, 0.025, 0.32), cream, [0, 0.27, -0.05]);
  add(car, mergedBoxes('at-haCarFins', [[0.03, 0.06, 0.16, 0.155, 0.17, -0.27], [0.03, 0.06, 0.16, -0.155, 0.17, -0.27]]), paint);
  add(car, mergedBoxes('at-haCarChrome', [[0.36, 0.04, 0.03, 0, 0.08, 0.355], [0.36, 0.04, 0.03, 0, 0.08, -0.355], [0.2, 0.04, 0.012, 0, 0.12, 0.352]]), chrome);
  add(car, mergedBoxes('at-haCarLamps', [[0.06, 0.04, 0.012, 0.12, 0.13, 0.352], [0.06, 0.04, 0.012, -0.12, 0.13, 0.352]]), mat(0xfff4c8));
  add(car, mergedBoxes('at-haCarTail', [[0.03, 0.05, 0.012, 0.155, 0.17, -0.352], [0.03, 0.05, 0.012, -0.155, 0.17, -0.352]]), mat(0xc0281c));
  const wheelsXZ = [[0.16, 0.22], [-0.16, 0.22], [0.16, -0.22], [-0.16, -0.22]];
  add(car, mergedCyls('haCarWheels', wheelsXZ.map(([x, z]) => [0.06, 0.06, 0.05, x, 0.06, z, 0, HALF_PI, 8])), tyre);
  add(car, mergedCyls('haCarWhitewall', wheelsXZ.map(([x, z]) => [0.036, 0.036, 0.056, x, 0.06, z, 0, HALF_PI, 8])), trim);
  return { root, parts: { bob: [puff], spin: [puff] }, height: 1.9, radius: 0.95 };
}

// ===========================================================================
// Research Center (mid era: Industrial to Modern)
// ===========================================================================

// Brick-and-concrete laboratory: two storeys of brick with concrete bands, steel-framed lab windows glowing
// cyan (glow), team door under a concrete canopy with a team fascia, a rooftop team sign with a white atom,
// fume vents, a brick chimney (smoke in bob), and a roaring Tesla coil on the roof (glowing spark + arcs in
// glow). Beside it a round concrete tower with a team band carries a radio-telescope dish on a turntable
// (parts.spin) with a team receiver cabin at the focus. Yard: transformer, gas cylinders, team flag.
export function research_2(tc) {
  const root = new THREE.Group();
  const brick = mat(C.brick), brickD = mat(C.brickD), conc = mat(C.conc), concD = mat(C.concD), concL = mat(C.concL);
  const team = mat(tc), steel = mat(C.steel), steelD = mat(C.steelD), white = mat(0xf2f0ea);
  const dark = mat(0x1c1d21), glass = mat(0x27313f), alu = mat(0xd5dade);
  const glow = [], puffs = [];
  add(root, geo.box(2.88, 0.05, 2.88), mat(0xa9a69e), [0, 0.025, 0]);
  const b = 0.05;
  // --- main laboratory
  const LX0 = -1.38, LX1 = 0.36, LZ0 = -1.38, LZ1 = 0.2, LH = 1.38;
  const lx = (LX0 + LX1) / 2, lz = (LZ0 + LZ1) / 2, lw = LX1 - LX0, ld = LZ1 - LZ0;
  add(root, geo.box(lw, LH, ld), brick, [lx, b + LH / 2, lz]);
  add(root, mergedBoxes('at-rsBands', [[lw + 0.03, 0.14, ld + 0.03, 0, 0.07, 0], [lw + 0.03, 0.06, ld + 0.03, 0, 0.71, 0]]), concL, [lx, b, lz]);
  const ry0 = b + LH + 0.06; // roof level
  add(root, geo.box(lw + 0.06, 0.06, ld + 0.06), concL, [lx, b + LH + 0.03, lz]);
  add(root, mergedBoxes('at-rsParapet', [[lw + 0.06, 0.08, 0.05, 0, 0, (ld + 0.06) / 2 - 0.025], [lw + 0.06, 0.08, 0.05, 0, 0, -(ld + 0.06) / 2 + 0.025], [0.05, 0.08, ld - 0.04, (lw + 0.06) / 2 - 0.025, 0, 0], [0.05, 0.08, ld - 0.04, -(lw + 0.06) / 2 + 0.025, 0, 0]]), concL, [lx, ry0 + 0.04, lz]);
  add(root, geo.box(lw - 0.04, 0.01, ld - 0.04), mat(C.roof), [lx, ry0 + 0.005, lz]);
  // brick pilasters on the front
  add(root, mergedBoxes('at-rsPilasters', [-1.33, -0.68, -0.32, 0.31].map((x) => [0.07, LH - 0.2, 0.04, x, 0, 0])), brickD, [0, b + 0.14 + (LH - 0.2) / 2, LZ1 + 0.02]);
  // glowing lab windows (each pane its own glow mesh) with concrete surrounds and steel glazing bars
  const labGlow = glowMat(C.lab, 0.85);
  const W = 0.22, frames = [], bars = [];
  const panes = [[-1.16, 1.06], [-0.86, 1.06], [-0.5, 1.06], [-0.14, 1.06], [0.16, 1.06], [-1.16, 0.42], [-0.86, 0.42], [-0.14, 0.42], [0.16, 0.42]];
  for (const [x, y] of panes) {
    const h = y > 1 ? 0.36 : 0.34;
    frames.push([W + 0.07, h + 0.07, 0.03, x, y, LZ1 + 0.006]);
    frames.push([W + 0.1, 0.035, 0.06, x, y - h / 2 - 0.035, LZ1 + 0.02]);
    bars.push([0.016, h, 0.012, x, y, LZ1 + 0.032], [W, 0.016, 0.012, x, y + h * 0.12, LZ1 + 0.032]);
    const p = add(root, geo.box(W, h, 0.02), labGlow, [x, y, LZ1 + 0.018]);
    p.castShadow = false;
    glow.push(p);
  }
  add(root, mergedBoxes('at-rsWinFrames', frames), concL);
  add(root, mergedBoxes('at-rsWinBars', bars), steelD);
  // side windows (dark)
  const sw = [];
  for (const z of [-1.1, -0.65, -0.2]) for (const y of [0.42, 1.06]) sw.push([0.03, 0.3, 0.2, LX0 - 0.005, y, z], [0.03, 0.3, 0.2, LX1 + 0.005, y, z]);
  add(root, mergedBoxes('at-rsSideWin', sw), glass);
  // entrance: team door, concrete canopy with a team fascia, posts, step, walkway
  const dx = -0.5;
  add(root, geo.box(0.36, 0.56, 0.03), concL, [dx, b + 0.28, LZ1 + 0.008]);
  add(root, geo.box(0.28, 0.5, 0.03), team, [dx, b + 0.25, LZ1 + 0.02]);
  add(root, mergedBoxes('at-rsDoorBits', [[0.012, 0.5, 0.012, 0, 0.25, 0], [0.09, 0.12, 0.012, -0.06, 0.36, 0], [0.09, 0.12, 0.012, 0.06, 0.36, 0]]), glass, [dx, b, LZ1 + 0.038]);
  add(root, geo.box(0.62, 0.045, 0.36), concL, [dx, b + 0.62, LZ1 + 0.17]);
  add(root, geo.box(0.63, 0.07, 0.02), team, [dx, b + 0.62, LZ1 + 0.355]);
  add(root, mergedBoxes('at-rsCanopyPosts', [[0.03, 0.6, 0.03, -0.27, 0, 0], [0.03, 0.6, 0.03, 0.27, 0, 0]]), steelD, [dx, b + 0.3, LZ1 + 0.31]);
  add(root, geo.box(0.5, 0.04, 0.2), concL, [dx, b + 0.02, LZ1 + 0.1]);
  add(root, geo.box(0.3, 0.008, 1.0), concL, [dx, b + 0.004, LZ1 + 0.68]);
  // rooftop team sign with a white atom and lettering
  const sg = grp(root, dx, ry0, LZ1 - 0.08);
  add(sg, mergedBoxes('at-rsSignPosts', [[0.035, 0.36, 0.035, -0.38, 0.18, 0], [0.035, 0.36, 0.035, 0.38, 0.18, 0]]), steelD);
  add(sg, geo.box(0.94, 0.32, 0.04), team, [0, 0.36, 0]);
  add(sg, geo.box(0.96, 0.025, 0.05), white, [0, 0.53, 0]);
  add(sg, geo.box(0.96, 0.025, 0.05), white, [0, 0.19, 0]);
  add(sg, atomGeo(0.12, 10), white, [-0.3, 0.36, 0.025]);
  add(sg, mergedBoxes('at-rsLetters', [[0.42, 0.05, 0.012, 0.15, 0.05, 0], [0.32, 0.045, 0.012, 0.1, -0.04, 0]]), white, [0, 0.36, 0.024]);
  // fume vents with rain caps, louvered air handler, skylight
  add(root, mergedCyls('rsVents', [[0.045, 0.045, 0.38, -0.12, 0.19, -0.42], [0.045, 0.045, 0.3, 0.1, 0.15, -0.42], [0.04, 0.04, 0.44, 0.1, 0.22, -0.66]]), steel, [0, ry0, 0]);
  add(root, mergedCyls('rsVentCaps', [[0, 0.085, 0.07, -0.12, 0.43, -0.42], [0, 0.085, 0.07, 0.1, 0.35, -0.42], [0, 0.08, 0.07, 0.1, 0.49, -0.66]]), steelD, [0, ry0, 0]);
  add(root, geo.box(0.34, 0.2, 0.26), steel, [-0.42, ry0 + 0.1, -1.08]);
  add(root, mergedBoxes('at-rsLouvres', [0, 1, 2, 3].map((i) => [0.3, 0.018, 0.012, 0, 0.04 + i * 0.04, 0])), steelD, [-0.42, ry0, -0.947]);
  add(root, geo.box(0.5, 0.07, 0.3), mat(0x7fa6c0), [-0.42, ry0 + 0.035, -0.55]);
  // brick chimney with smoke
  const chx = 0.12, chz = -1.12, cht = 2.32;
  add(root, geo.box(0.22, cht - ry0, 0.22), brick, [chx, (cht + ry0) / 2, chz]);
  add(root, geo.box(0.24, 0.08, 0.24), team, [chx, cht - 0.2, chz]);
  add(root, geo.box(0.27, 0.05, 0.27), concL, [chx, cht + 0.025, chz]);
  puffs.push(smoke(root, chx, cht + 0.06, chz, { s: 0.085, color: 0xbab6ae }));
  // --- Tesla coil on the roof: pad, porcelain insulator, copper secondary, aluminium toroid, spark + arcs
  const tx = -0.98, tz = -0.82;
  add(root, geo.box(0.44, 0.1, 0.44), concD, [tx, ry0 + 0.05, tz]);
  add(root, mergedBoxes('at-rsCoilRail', [[0.44, 0.1, 0.02, 0, 0, 0.21], [0.44, 0.1, 0.02, 0, 0, -0.21], [0.02, 0.1, 0.4, 0.21, 0, 0], [0.02, 0.1, 0.4, -0.21, 0, 0]]), mat(0xe0b020), [tx, ry0 + 0.15, tz]);
  add(root, mergedCyls('rsInsulator', [[0.07, 0.09, 0.26, 0, 0.13, 0, 0, 0, 7], [0.12, 0.12, 0.025, 0, 0.06, 0, 0, 0, 7], [0.11, 0.11, 0.025, 0, 0.13, 0, 0, 0, 7], [0.1, 0.1, 0.025, 0, 0.2, 0, 0, 0, 7]]), white, [tx, ry0 + 0.1, tz]);
  const coilY = ry0 + 0.36;
  add(root, geo.cyl(0.095, 0.1, 0.84, 10), mat(0xc27a3c), [tx, coilY + 0.42, tz]);
  add(root, mergedCyls('rsWinding', Array.from({ length: 6 }, (_, i) => [0.104, 0.104, 0.02, 0, 0.1 + i * 0.13, 0, 0, 0, 10, true])), mat(0x8a4f22), [tx, coilY, tz]);
  add(root, geo.cyl(0.05, 0.07, 0.08, 8), alu, [tx, coilY + 0.88, tz]);
  const torY = coilY + 0.95;
  add(root, geo.torus(0.17, 0.06, 5, 14), alu, [tx, torY, tz], [HALF_PI, 0, 0]);
  const spark = add(root, geo.sphere(0.07, 8, 6), glowMat(0xdcd0ff, 1.4), [tx, torY + 0.1, tz]);
  spark.castShadow = false;
  glow.push(spark);
  const arcs = [];
  for (const a of [0.5, 2.1, 3.5, 5.1]) {
    const pt = (r, y) => [Math.cos(a) * r + Math.sin(a) * (y * 0.3), y, Math.sin(a) * r - Math.cos(a) * (y * 0.3)];
    const pts = [pt(0.22, 0.0), pt(0.3, 0.07), pt(0.36, -0.02), pt(0.44, 0.06)];
    for (let i = 0; i < 3; i++) arcs.push([pts[i], pts[i + 1], 0.016]);
  }
  const bolts = add(root, mergedBeams('rsArcs', arcs), glowMat(0xb9a6ff, 1.6), [tx, torY, tz]);
  bolts.castShadow = false;
  glow.push(bolts);
  // --- round tower with the radio telescope (turntable in spin)
  const TXc = 0.9, TZc = -0.62, TR = 0.5, TH = 1.2;
  add(root, geo.cyl(TR, TR + 0.02, TH, 16), conc, [TXc, b + TH / 2, TZc]);
  add(root, geo.cyl(TR + 0.03, TR + 0.035, 0.12, 16), concL, [TXc, b + 0.06, TZc]);
  add(root, geo.cyl(TR + 0.025, TR + 0.025, 0.12, 16), team, [TXc, b + TH - 0.22, TZc]);
  add(root, geo.cyl(TR + 0.035, TR + 0.035, 0.06, 16), concL, [TXc, b + TH + 0.03, TZc]);
  const slits = [];
  for (const a of [-0.75, 0.75, 1.9]) slits.push([0.07, 0.34, 0.03, Math.sin(a) * (TR + 0.005), 0.62, Math.cos(a) * (TR + 0.005), a]);
  add(root, mergedBoxes('at-rsSlits', slits), glass, [TXc, b, TZc]);
  add(root, geo.box(0.26, 0.46, 0.06), concL, [TXc, b + 0.23, TZc + TR - 0.005]);
  add(root, geo.box(0.2, 0.42, 0.03), mat(0x506878), [TXc, b + 0.21, TZc + TR + 0.02]);
  add(root, geo.box(0.34, 0.035, 0.18), concL, [TXc, b + 0.48, TZc + TR + 0.06]);
  const tt = grp(root, TXc, b + TH + 0.06, TZc);
  add(tt, geo.cyl(0.3, 0.33, 0.08, 12), steelD, [0, 0.04, 0]);
  add(tt, mergedBoxes('at-rsYoke', [[0.06, 0.46, 0.14, 0.25, 0.31, 0], [0.06, 0.46, 0.14, -0.25, 0.31, 0], [0.56, 0.06, 0.16, 0, 0.1, 0]]), steel);
  xcyl(tt, 0.045, 0.58, steelD, 0, 0.5, 0, 8);
  const el = grp(tt, 0, 0.5, 0);
  el.rotation.x = -0.8;
  add(el, dishGeo(0.5, 0.55), mat(0xf0efe8, { side: THREE.DoubleSide }), [0, 0, 0.12]);
  add(el, geo.cyl(0.2, 0.07, 0.1, 8), steel, [0, 0, -0.07], [HALF_PI, 0, 0]);
  const feed = [];
  for (const a of [HALF_PI, HALF_PI + 2.094, HALF_PI + 4.189]) feed.push([[Math.cos(a) * 0.47, Math.sin(a) * 0.47, 0.12], [0, 0, 0.47], 0.016]);
  add(el, mergedBeams('rsFeed', feed), steel);
  add(el, geo.box(0.1, 0.1, 0.12), team, [0, 0, 0.5]);
  add(el, geo.cyl(0.03, 0.05, 0.06, 6), steelD, [0, 0, 0.43], [-HALF_PI, 0, 0]);
  // --- yard: transformer with insulators and hazard plate, gas cylinders, crates, team flag
  const trx = 0.78, trz = 0.62;
  add(root, geo.box(0.42, 0.06, 0.34), concD, [trx, b + 0.03, trz]);
  add(root, geo.box(0.34, 0.36, 0.26), mat(0x6c7a68), [trx, b + 0.24, trz]);
  add(root, mergedBoxes('at-rsFins', [-0.1, -0.05, 0, 0.05, 0.1].map((z) => [0.04, 0.28, 0.012, 0, 0, z])), mat(0x55614f), [trx + 0.19, b + 0.24, trz]);
  add(root, mergedCyls('rsTrInsul', [-0.1, 0, 0.1].map((x) => [0.025, 0.035, 0.12, x, 0, 0, 0, 0, 6])), white, [trx, b + 0.48, trz]);
  add(root, geo.box(0.12, 0.12, 0.012), mat(0xf2c11d), [trx, b + 0.26, trz + 0.136], [0, 0, Math.PI / 4]);
  add(root, geo.box(0.04, 0.06, 0.014), dark, [trx, b + 0.26, trz + 0.14], [0, 0, 0.4]);
  const gas = [0x2f6a3a, 0x9aa0a8, 0x2f4f8a, 0x2f6a3a];
  gas.forEach((c, i) => {
    const x = 1.04 + i * 0.1;
    add(root, geo.cyl(0.042, 0.042, 0.4, 7), mat(c), [x, b + 0.2, 0.18]);
    add(root, geo.cyl(0.016, 0.042, 0.05, 7), mat(c), [x, b + 0.425, 0.18]);
  });
  add(root, mergedBoxes('at-rsGasValves', gas.map((c, i) => [0.03, 0.04, 0.03, 1.04 + i * 0.1, 0, 0])), mat(0x3a3d44), [0, b + 0.47, 0.18]);
  add(root, mergedBoxes('at-rsGasRack', [[0.46, 0.03, 0.02, 0, 0.28, 0.05], [0.02, 0.36, 0.02, -0.22, 0.18, 0.05], [0.02, 0.36, 0.02, 0.22, 0.18, 0.05]]), steelD, [1.19, b, 0.18]);
  add(root, mergedBoxes('at-rsCrates', [[0.26, 0.24, 0.26, 0, 0.12, 0], [0.22, 0.2, 0.22, 0.02, 0.34, 0.01, 0.3], [0.24, 0.22, 0.24, 0.3, 0.11, 0.06, 0.15]]), mat(P.woodLight), [-1.15, b, 0.6]);
  add(root, mergedBoxes('at-rsCrateBands', [[0.265, 0.03, 0.265, 0, 0.12, 0], [0.245, 0.03, 0.245, 0.3, 0.11, 0.06, 0.15]]), mat(P.woodDark), [-1.15, b, 0.6]);
  // radioactive-waste drums and a lamp post by the walk
  const drums = [[-0.98, 1.08], [-1.17, 1.16], [-1.06, 1.3]];
  add(root, mergedCyls('rsDrums', drums.map(([x, z]) => [0.075, 0.075, 0.22, x, 0.11, z, 0, 0, 8])), mat(0xe2b81e), [0, b, 0]);
  add(root, mergedCyls('rsDrumBands', drums.map(([x, z]) => [0.078, 0.078, 0.05, x, 0.13, z, 0, 0, 8, true])), dark, [0, b, 0]);
  add(root, mergedCyls('rsDrumLids', drums.map(([x, z]) => [0.05, 0.05, 0.012, x, 0.226, z, 0, 0, 8])), mat(0x8a7414), [0, b, 0]);
  add(root, geo.cyl(0.018, 0.026, 0.7, 6), steelD, [-0.22, b + 0.35, 1.05]);
  add(root, geo.box(0.12, 0.03, 0.08), steelD, [-0.22, b + 0.7, 1.05]);
  add(root, geo.box(0.09, 0.04, 0.06), mat(0xfff0c8, { emissive: 0xffd88a, emissiveIntensity: 0.7 }), [-0.22, b + 0.67, 1.05]);
  flag(root, 1.26, b, 1.22, tc, { pole: 1.25, w: 0.44, h: 0.27, dir: -1, poleColor: C.steel, finial: P.gold, poleR: 0.02 });
  add(root, geo.box(0.16, 0.06, 0.16), concD, [1.26, b + 0.03, 1.22]);
  return { root, parts: { spin: [tt, ...puffs], bob: puffs, glow }, height: 3.0, radius: 1.45 };
}
