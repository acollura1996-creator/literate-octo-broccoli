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
  flamethrower: [-0.18, 0.517, 0.636],
  sniper: [-0.12, 0.664, 0.983],
  half_track: [0, 1.16, 0.452],
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

/** Cached merged cylinders: [[rTop, rBot, h, x, y, z, rx = 0, rz = 0, seg = 8], ...]. */
function mergedCyls(key, list) {
  return geo.custom(`at-cyl:${key}`, () => {
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

/** Upper hemisphere (dome), radius 1, base at y = 0. */
const hemi = () => geo.custom('at:hemi10', () => new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, HALF_PI));

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
function atomGeo(r) {
  return geo.custom(`at-atom:${r}`, () => {
    const parts = [0, 1, 2].map((k) => {
      const t = new THREE.TorusGeometry(r, r * 0.075, 3, 18);
      t.scale(1, 0.36, 1);
      t.rotateZ((k * Math.PI) / 3 + HALF_PI);
      return t;
    });
    parts.push(new THREE.SphereGeometry(r * 0.2, 8, 5));
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
  add(B, geo.cyl(0.04, 0.04, 0.1, 6), M.khakiD, [0.15, 0.0, -0.07]);
  // jacket placket, chest pocket flaps, collar
  add(B, geo.box(0.02, T.th * 0.8, 0.012), M.odD, [0, T.cy + 0.02, T.halfD(T.cy + 0.02) + 0.004], [T.lean, 0, 0]);
  add(B, mergedBoxes('at-giPockets', [[0.075, 0.03, 0.014, -0.07, 0, 0], [0.075, 0.03, 0.014, 0.07, 0, 0]]), M.odD, [0, 0.29, T.halfD(0.29) + 0.004], [T.lean, 0, 0]);
  add(B, CG.frustum(0.8), M.od, [0, T.cy + T.th / 2 + 0.018, 0], null, [0.18, 0.05, 0.16]);
  return { r, M, T };
}

/** Sleeve + hand between shoulder S, elbow E and hand H (optional team armband on the upper arm). */
function giArm(g, S, E, H, M, { band = null, hand = M.skin, sleeve = M.od } = {}) {
  add(g, geo.sphere(0.054, 6, 4), sleeve, S, null, [1, 0.9, 1]);
  beam(g, S, E, 0.074, sleeve);
  if (band) beam(g, lerp3(S, E, 0.16), lerp3(S, E, 0.58), 0.09, band);
  add(g, geo.sphere(0.041, 5, 4), sleeve, E);
  beam(g, E, H, 0.068, sleeve);
  beam(g, lerp3(E, H, 0.72), lerp3(E, H, 0.9), 0.076, M.odD);
  add(g, geo.sphere(0.037, 5, 4), hand, H);
}

/** M1 helmet: dome + rim, origin at the head pivot. Returns nothing; band adds a team band. */
function m1Helmet(head, shell, { band = null, y = 0.112 } = {}) {
  add(head, hemi(), shell, [0, y, -0.006], null, [0.113, 0.11, 0.124]);
  add(head, geo.cyl(0.121, 0.127, 0.02, 10), shell, [0, y, -0.006], null, [1, 1, 1.1]);
  if (band) add(head, geo.cyl(0.104, 0.116, 0.036, 10), band, [0, y + 0.036, -0.006], null, [1, 1, 1.1]);
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
  add(B, geo.custom('at:ftDomes', () => {
    const list = [];
    for (const x of [-0.086, 0.086]) for (const y of [0.39, 0.05]) list.push(new THREE.SphereGeometry(0.072, 8, 4).scale(1, 0.42, 1).translate(x, y, tz));
    return mergeAll(list);
  }), tankM);
  add(B, mergedCyls('ftTankBands', [-0.086, 0.086].flatMap((x) => [[0.076, 0.076, 0.06, x, 0.325, tz, 0, 0, 8], [0.076, 0.076, 0.03, x, 0.12, tz, 0, 0, 8]])), M.team);
  add(B, geo.sphere(0.058, 8, 6), mat(0x5d6150), [0, 0.2, tz - 0.06]); // pressure tank
  add(B, mergedCyls('ftValves', [[0.016, 0.016, 0.06, -0.086, 0.45, tz], [0.016, 0.016, 0.06, 0.086, 0.45, tz], [0.012, 0.012, 0.19, 0, 0.47, tz, 0, HALF_PI, 6]]), M.gunL);
  // harness: shoulder straps over the shoulders and down the chest
  add(B, mergedBoxes('at-ftStraps', [[0.045, 0.02, 0.26, -0.1, 0.36, 0.0], [0.045, 0.02, 0.26, 0.1, 0.36, 0.0]]), M.khakiD);
  for (const x of [-0.095, 0.095]) add(B, geo.box(0.042, 0.2, 0.014), M.khakiD, [x, 0.24, T.halfD(0.24) + 0.008], [T.lean, 0, 0]);
  add(B, geo.box(T.w0 + 0.03, 0.035, 0.02), M.khakiD, [0, 0.14, T.halfD(0.14) + 0.012], [T.lean, 0, 0]); // chest strap

  // --- head: gas mask (rubber face piece, eyepieces, outlet + canister), M1 helmet with a team band
  const H = r.head;
  add(H, geo.sphere(0.088, 8, 6), M.skin, [0, 0.092, 0.0]);
  add(H, geo.sphere(0.086, 8, 6), M.rubber, [0, 0.086, 0.034], null, [1.05, 1.03, 0.82]);
  for (const s of [1, -1]) {
    zcyl(H, 0.03, 0.03, 0.088, 0.106, M.gunL, 8, s * 0.037, 0.108);
    zcyl(H, 0.024, 0.024, 0.09, 0.112, mat(C.lens), 8, s * 0.037, 0.108);
  }
  zcyl(H, 0.026, 0.034, 0.085, 0.13, M.gunL, 7, 0, 0.052);
  add(H, geo.cyl(0.04, 0.04, 0.075, 8), mat(0x5a6340), [0, 0.03, 0.14], [1.05, 0, 0]); // filter canister
  add(H, geo.cyl(0.042, 0.042, 0.016, 8), M.gunL, [0, 0.012, 0.165], [1.05, 0, 0]);
  m1Helmet(H, M.helm, { band: M.team });
  add(H, geo.box(0.05, 0.035, 0.02), M.team, [0, 0.165, 0.118], [-0.5, 0, 0]); // front marking

  // --- weapon group (pivot: right shoulder): wand at the right hip, hose, both arms
  const W = r.weapon;
  const piv = [-SOLDIER.sx, SOLDIER.sy, 0];
  const wsp = (p) => [p[0] - piv[0], p[1] - piv[1], p[2] - piv[2]]; // body space -> weapon space
  const G = wsp([-0.17, 0.12, -0.03]);
  const gun = grp(W, G[0], G[1], G[2]);
  zcyl(gun, 0.021, 0.024, 0.0, 0.52, M.gun, 7); // fuel tube
  zcyl(gun, 0.032, 0.032, -0.02, 0.05, M.gunL, 7); // hose coupling
  add(gun, geo.box(0.032, 0.09, 0.036), M.wood, [0, -0.055, 0.1], [0.3, 0, 0]); // rear grip
  add(gun, geo.box(0.012, 0.03, 0.04), M.gunL, [0, -0.032, 0.14]); // trigger guard
  add(gun, geo.box(0.05, 0.05, 0.11), M.gunL, [0, 0.014, 0.17]); // fuel valve
  add(gun, geo.box(0.03, 0.08, 0.032), M.wood, [0, -0.05, 0.32], [0.15, 0, 0]); // front grip
  zcyl(gun, 0.033, 0.033, 0.38, 0.54, M.gunL, 8, 0, -0.042); // igniter cylinder
  zcyl(gun, 0.035, 0.035, 0.42, 0.47, M.team, 8, 0, -0.042);
  zcyl(gun, 0.025, 0.03, 0.52, 0.6, M.gun, 8); // nozzle
  zcyl(gun, 0.016, 0.016, 0.6, 0.606, M.black, 6);
  muzzle(gun, 0, 0, 0.606);
  const pilot = fire(gun, 0, -0.004, 0.6, 0.085);
  pilot.rotation.x = 1.15; // small flame licking forward and up from the nozzle
  // hose: tank bottom -> round the right hip -> wand coupling
  const hose = [[-0.086, 0.03, tz], [-0.19, -0.02, -0.15], [-0.215, 0.05, -0.08], [-0.17, 0.12, -0.05]].map(wsp);
  const rubber = M.rubber;
  for (let i = 0; i < hose.length - 1; i++) {
    rod(W, hose[i], hose[i + 1], 0.017, rubber, 6);
    if (i) add(W, geo.sphere(0.017, 6, 4), rubber, hose[i]);
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
  add(g, geo.sphere(0.012, 5, 4), M.gun, [-0.06, 0.022, 0.31]);
  add(g, geo.box(0.012, 0.035, 0.05), M.gun, [0, -0.026, 0.3]); // trigger guard
  add(g, geo.box(0.036, 0.046, 0.46), M.wood, [0, 0.006, 0.66]); // fore-end
  zcyl(g, 0.011, 0.013, 0.86, len, M.gun, 6, 0, by); // barrel
  zcyl(g, 0.014, 0.014, len - 0.03, len, M.gun, 6, 0, by); // crown
  // burlap strips wound round the fore-end
  add(g, mergedBoxes('at-snWrap', [[0.044, 0.054, 0.035, 0, 0, 0.56], [0.044, 0.054, 0.03, 0, 0, 0.74]]), mat(C.camoD), [0, 0.006, 0]);
  // telescope: mounts, tube, ocular and objective bells, lens
  add(g, mergedBoxes('at-snMounts', [[0.02, 0.05, 0.022, 0, 0, 0.3], [0.02, 0.05, 0.022, 0, 0, 0.42]]), M.gun, [0, by + 0.035, 0]);
  zcyl(g, 0.017, 0.017, 0.22, 0.5, M.gun, 8, 0, sy);
  zcyl(g, 0.021, 0.017, 0.19, 0.24, M.gun, 8, 0, sy);
  zcyl(g, 0.026, 0.017, 0.48, 0.55, M.gun, 8, 0, sy);
  zcyl(g, 0.02, 0.02, 0.55, 0.556, mat(0x6fb0d0, { emissive: 0x2a5a78, emissiveIntensity: 0.4 }), 8, 0, sy);
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
  const { r, M, T } = giBase(tc);
  const B = r.body;
  const camoA = mat(C.camoA), camoB = mat(C.camoB), camoC = mat(C.camoC), camoD = mat(C.camoD);
  // smock blotches on the jacket front
  add(B, mergedBoxes('at-snSmock', [[0.08, 0.06, 0.012, -0.06, 0.12, 0], [0.06, 0.08, 0.012, 0.08, 0.22, 0]]), camoC, [0, 0, T.halfD(0.17) + 0.006], [T.lean, 0, 0]);
  // --- ghillie cape: mantle over the shoulders, drape down the back, hanging strips
  add(B, CG.frustum(0.55), camoB, [0, 0.31, -0.015], null, [0.46, 0.16, 0.33]);
  add(B, CG.frustum(0.72), camoA, [0, 0.07, -0.14], [0.16, 0, 0], [0.44, 0.52, 0.07]);
  const rand = rng(1947);
  const strips = [[], [], []];
  for (let i = 0; i < 17; i++) {
    const a = -2.25 + (4.5 * i) / 16 + (rand() - 0.5) * 0.12;
    const h = 0.12 + rand() * 0.08;
    const x = Math.sin(a) * 0.23, z = -Math.cos(a) * 0.165 - 0.015;
    strips[i % 3].push([0.05 + rand() * 0.02, h, 0.014, x, 0.25 - h / 2 + rand() * 0.02, z, Math.PI - a, -0.25]);
  }
  for (const [y, n] of [[0.24, 4], [0.1, 5], [-0.04, 5], [-0.16, 4]]) {
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
  add(H, geo.sphere(0.088, 8, 6), M.skin, [0, 0.092, 0.012]);
  add(H, geo.box(0.026, 0.034, 0.03), M.skin, [0, 0.082, 0.1]);
  add(H, mergedBoxes('at-snFacePaint', [[0.15, 0.022, 0.03, 0, 0.1, 0.075], [0.12, 0.02, 0.03, 0, 0.06, 0.07]]), camoC, [0, 0, 0]);
  m1Helmet(H, camoB);
  const tufts = [];
  const r2 = rng(77);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    tufts.push([0.05, 0.07 + r2() * 0.04, 0.014, Math.sin(a) * 0.1, 0.17 + r2() * 0.03, Math.cos(a) * 0.1 - 0.01, 0.5 - r2() * 0.3 * 0, a, 0]);
  }
  add(H, mergedRot('snTufts', tufts.map(([w, h, d, x, y, z, rx, ry]) => [w, h, d, x, y, z, -0.5, ry, 0])), camoD);
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
