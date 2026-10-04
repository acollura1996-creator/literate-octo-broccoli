// Modern Age: camo infantry with assault rifles, rocket troopers, a main battle tank, a 6x6 rocket
// artillery truck, the nuclear missile silo, the capitol (town center) and the apartment block.
// Same conventions as the other builders: origin at ground center, facing +Z, character's weapon hand
// on -X, team color via mat(teamColor), cached geo/mat, everything casts shadows (add()).
//
// Firearms: infantry hold their gun at the ready (barrel along +Z, level). The `weapon` group is the
// gun arm pivoted at the right shoulder and carries BOTH arms + the gun, so a recoil kick
// (rotation.x ~ -0.1, position.z - 0.05) moves the whole aiming pose together. Vehicle `weapon`
// groups are the barrel (pivot at the mantlet) and the rocket pod (pivot at its rear hinge).
// Rest muzzle / launch points (model space, see MUZZLE below) are where tracers/rockets start.
import {
  THREE, mat, geo, P, CG, glowMat, grp, add, beam, rig, legMesh, flag, banner, mergedBoxes,
} from './common.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HALF_PI = Math.PI / 2;

/**
 * Rest muzzle / launch positions in model space (origin at ground center, facing +Z), measured from the
 * built models; same shape as the MUZZLE table of render/projectiles.js, so it can be merged into it.
 * The rocket pod fires along (0, sin 0.5, cos 0.5); its six tubes sit at x = -0.21 / 0 / 0.21 and
 * y = 1.21 (lower row, z = -0.29) or 1.37 (upper row, z = -0.375). The tank's static roof machine gun
 * muzzle is at (-0.26, 1.21, 0.22).
 */
export const MUZZLE = {
  infantry: [-0.105, 0.7, 0.7],
  bazooka: [-0.16, 0.81, 0.57],
  tank: [0, 0.82, 1.82],
  rocket_artillery: [0, 1.29, -0.33],
};

const C = {
  // fatigues / gear
  olive: 0x5b6638, oliveD: 0x404827, oliveL: 0x7b8150, khaki: 0x9a8f62,
  coyote: 0x8f7c55, coyoteD: 0x6a5a3c, boot: 0x2c2823, glove: 0x2a2925,
  helm: 0x56603a, gun: 0x2a2c30, gunL: 0x4a4d53,
  // vehicles
  armor: 0x5d6a3b, armorD: 0x46502b, sand: 0xb9a171, track: 0x353430, wheel: 0x3e4530,
  rubber: 0x222224, glass: 0x26394a,
  // buildings
  conc: 0xc7c3b8, concD: 0x9e9a90, concL: 0xe0ddd4, steel: 0x6d737a, steelD: 0x464b52,
  glassB: 0x5b8bb4, glassBD: 0x34597c, mullion: 0x8c949c, hazard: 0xf0c020, black: 0x1d1e21,
  lit: 0xffd27a,
};

// ===========================================================================
// Geometry helpers
// ===========================================================================

/** Cached merged cylinders: [[rTop, rBot, h, x, y, z, rx = 0, rz = 0, seg = 6], ...]. */
function mergedCyls(key, list) {
  return geo.custom(`mod-cyl:${key}`, () => {
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

const _up = new THREE.Vector3(0, 1, 0);
/** Cached merged boxes stretched between two points: [[a, b, w, d = w], ...] (lattice masts, frames). */
function mergedBeams(key, list) {
  return geo.custom(`mod-beams:${key}`, () => {
    const parts = list.map(([a, b, w, d = w]) => {
      const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
      const len = va.distanceTo(vb);
      const g = new THREE.BoxGeometry(w, len, d);
      const q = new THREE.Quaternion().setFromUnitVectors(_up, vb.clone().sub(va).normalize());
      g.applyQuaternion(q);
      g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      return g;
    });
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

/**
 * Cached convex loft: rings = [[y, [[x, z], ...]], ...] (same vertex count, convex, ordered around).
 * Side quads join consecutive rings; the first and last rings are capped. Used for angular armor.
 */
function loftGeo(key, rings) {
  return geo.custom(`mod-loft:${key}`, () => {
    const pos = [];
    const n = rings[0][1].length;
    const cx = rings[0][1].reduce((s, p) => s + p[0], 0) / n;
    const cz = rings[0][1].reduce((s, p) => s + p[1], 0) / n;
    const V = (y, p) => new THREE.Vector3(p[0], y, p[1]);
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const tri = (a, b, c, ref) => {
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      if (e1.cross(e2).dot(ref) < 0) [b, c] = [c, b];
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    };
    for (let k = 0; k + 1 < rings.length; k++) {
      const [y0, p0] = rings[k], [y1, p1] = rings[k + 1];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = V(y0, p0[i]), b = V(y0, p0[j]), c = V(y1, p1[j]), d = V(y1, p1[i]);
        const ref = new THREE.Vector3((a.x + b.x + c.x + d.x) / 4 - cx, 0, (a.z + b.z + c.z + d.z) / 4 - cz);
        tri(a, b, c, ref);
        tri(a, c, d, ref);
      }
    }
    for (const [[y, p], dir] of [[rings[0], -1], [rings[rings.length - 1], 1]]) {
      for (let i = 1; i + 1 < n; i++) tri(V(y, p[0]), V(y, p[i]), V(y, p[i + 1]), new THREE.Vector3(0, dir, 0));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });
}

/** Polygon ring interpolated between two rings at fraction t, pushed outward by `grow` (relative). */
function ringAt(r0, r1, t, grow = 0) {
  const y = r0[0] + (r1[0] - r0[0]) * t;
  return [y, r0[1].map((p, i) => [(p[0] + (r1[1][i][0] - p[0]) * t) * (1 + grow), (p[1] + (r1[1][i][1] - p[1]) * t) * (1 + grow)])];
}

/**
 * Group sitting on a loft side face (ring k -> k+1, edge i -> i+1) at (u along, v up), oriented with
 * +X to the right as seen from outside, +Y up the face, +Z out of the face. For decals (camo, numbers).
 */
function onFace(parent, rings, k, i, u, v, lift = 0.004) {
  const [y0, p0] = rings[k], [y1, p1] = rings[k + 1];
  const n = p0.length, j = (i + 1) % n;
  const V = (y, p) => new THREE.Vector3(p[0], y, p[1]);
  const A = V(y0, p0[i]), B = V(y0, p0[j]), Cc = V(y1, p1[j]), D = V(y1, p1[i]);
  const bottom = A.clone().lerp(B, u), top = D.clone().lerp(Cc, u);
  const pos = bottom.clone().lerp(top, v);
  const up = top.clone().sub(bottom).normalize();
  const along = B.clone().sub(A).lerp(Cc.clone().sub(D), v).normalize();
  const N = along.clone().cross(up).normalize();
  if (N.x * pos.x + N.z * pos.z < 0) N.negate();
  const R = up.clone().cross(N).normalize();
  const Vv = N.clone().cross(R).normalize();
  const g = new THREE.Group();
  g.position.copy(pos).addScaledVector(N, lift);
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(R, Vv, N));
  parent.add(g);
  return g;
}

/**
 * Cached extrusion of a side profile drawn in the (z, y) plane, extruded symmetrically along X.
 * `pts` = [[z, y], ...]; holes = list of point lists.
 */
function profileX(key, pts, width, { holes = [], curve = 4 } = {}) {
  return geo.custom(`mod-prof:${key}`, () => {
    const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    for (const h of holes) s.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y))));
    const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: curve });
    g.translate(0, 0, -width / 2);
    g.rotateY(-HALF_PI); // shape x -> world z, extrusion -> world x
    return g;
  });
}

/** Cached half disc slab (the x < 0 half, straight edge on the Z axis), thickness h from y = 0. */
function halfDisc(r, h, seg = 12) {
  return geo.custom(`mod-halfdisc:${r},${h},${seg}`, () => {
    const s = new THREE.Shape();
    s.moveTo(0, -r);
    s.absarc(0, 0, r, -HALF_PI, HALF_PI, true);
    s.lineTo(0, -r);
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: seg });
    g.rotateX(-HALF_PI);
    return g;
  });
}

/** Cached flat five-pointed star lying in XZ (one point toward -Z), thickness h from y = 0. */
function starGeo(r1, r2, h) {
  return geo.custom(`mod-star:${r1},${r2},${h}`, () => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = HALF_PI + (i * Math.PI) / 5, r = i % 2 ? r2 : r1;
      pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
    }
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: h, bevelEnabled: false });
    g.rotateX(-HALF_PI);
    return g;
  });
}

/** Cached radiation trefoil (three 60 deg blades + hub) in the XY plane facing +Z, outer radius r. */
function trefoilGeo(r) {
  return geo.custom(`mod-trefoil:${r}`, () => {
    const parts = [0, 1, 2].map((i) => new THREE.RingGeometry(r * 0.3, r, 4, 1, HALF_PI - Math.PI / 6 + (i * 2 * Math.PI) / 3, Math.PI / 3));
    parts.push(new THREE.CircleGeometry(r * 0.18, 8));
    for (const p of parts) p.deleteAttribute('uv');
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

/** Cached shallow dish (spherical cap) whose concave side faces +Z. Render double-sided. */
function dishGeo(r, depth = 0.6) {
  return geo.custom(`mod-dish:${r},${depth}`, () => {
    const R = r / Math.sin(depth);
    const g = new THREE.SphereGeometry(R, 12, 3, 0, Math.PI * 2, 0, depth);
    g.translate(0, -R * Math.cos(depth), 0); // rim at y = 0, apex at y = R(1 - cos)
    g.rotateX(-HALF_PI); // apex toward -Z
    return g;
  });
}

/** Cached missile nose (ogive) of base radius r, length len, base at y = 0. */
function ogive(r, len, seg = 10) {
  return geo.custom(`mod-ogive:${r},${len},${seg}`, () => {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push(new THREE.Vector2(r * Math.sqrt(1 - t * t) + 0.0001, len * t));
    }
    return new THREE.LatheGeometry(pts, seg);
  });
}

/** Cached wheel along X built from cylinders/boxes (one geometry -> one draw call per wheel). */
function wheelGeo(key, list) {
  return geo.custom(`mod-wheel:${key}`, () => {
    const parts = list.map(([kind, a, b, c, x = 0, y = 0, z = 0, rx = 0, seg = 10]) => {
      let g;
      if (kind === 'cyl') {
        g = new THREE.CylinderGeometry(a, a, b, seg);
        g.rotateZ(HALF_PI);
      } else {
        g = new THREE.BoxGeometry(a, b, c);
        if (rx) g.rotateX(rx);
      }
      g.translate(x, y, z);
      return g;
    });
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

/** 7-segment digits as boxes [w, h, d, x, y, z] in a plane (x right, y up), string centered at 0. */
function digitBoxes(str, s, t = s * 0.16, d = 0.012) {
  const SEG = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
  const w = s * 0.55, adv = w + s * 0.3;
  const boxes = [];
  [...str].forEach((ch, k) => {
    const ox = (k - (str.length - 1) / 2) * adv;
    for (const sg of SEG[+ch]) {
      const hz = { a: s / 2, g: 0, d: -s / 2 }[sg];
      if (hz !== undefined) boxes.push([w, t, d, ox, hz, 0]);
      else {
        const x = 'bc'.includes(sg) ? w / 2 : -w / 2;
        const y = 'bf'.includes(sg) ? s / 4 : -s / 4;
        boxes.push([t, s / 2 + t * 0.5, d, ox + x, y, 0]);
      }
    }
  });
  return boxes;
}

// ===========================================================================
// Soldiers
// ===========================================================================

const SOLDIER = { L: 0.38, hipW: 0.085, shoulderX: 0.21, shoulderY: 0.35, neckY: 0.42 };

/** Camo infantryman: legs, torso, plate carrier, helmet with goggles. The weapon group stays empty. */
function soldierBase(tc, { radioPack = true } = {}) {
  const { L } = SOLDIER;
  const r = rig({ legLen: L, hipW: SOLDIER.hipW, shoulderX: SOLDIER.shoulderX, shoulderY: SOLDIER.shoulderY, neckY: SOLDIER.neckY });
  const fat = mat(C.olive), fatD = mat(C.oliveD), khaki = mat(C.khaki), coy = mat(C.coyote), coyD = mat(C.coyoteD);
  const team = mat(tc), boot = mat(C.boot), skin = mat(P.skin);
  // legs: camo trousers, cargo pocket, knee pads, combat boots
  for (const l of r.legs) {
    const s = l.obj.position.x > 0 ? 1 : -1;
    legMesh(l.obj, L, 0.1, fat, boot, { bootH: 0.42, toe: 0.28 });
    add(l.obj, geo.box(0.104, 0.05, 0.06), fatD, [0, -0.07, -0.025]); // camo blotch
    add(l.obj, geo.box(0.06, 0.045, 0.106), khaki, [-s * 0.02, -0.15, 0.0]);
    add(l.obj, geo.box(0.035, 0.075, 0.07), fatD, [s * 0.058, -0.12, 0.0]); // cargo pocket
    add(l.obj, geo.box(0.1, 0.07, 0.04), coyD, [0, -L * 0.6, 0.06]); // knee pad
  }
  // torso (camo blouse) + hips
  const T = { cy: 0.19, th: 0.34, w0: 0.25, d0: 0.18, k: 1.26 };
  add(r.body, CG.frustum(T.k), fat, [0, T.cy, 0], null, [T.w0, T.th, T.d0]);
  add(r.body, CG.frustum(0.9), fat, [0, -0.025, 0], null, [0.27, 0.1, 0.2]);
  add(r.body, geo.box(0.282, 0.045, 0.212), coyD, [0, 0.035, 0]); // belt
  add(r.body, mergedBoxes('modBeltPouch', [[0.06, 0.07, 0.05, -0.1, 0, 0.09], [0.06, 0.07, 0.05, 0.1, 0, 0.09], [0.07, 0.08, 0.05, -0.12, 0, -0.06]]), coy, [0, 0.02, 0]);
  // plate carrier: front/back plates, magazine pouches, shoulder straps, team chest + back patches
  add(r.body, CG.frustum(1.1), coy, [0, 0.215, 0], null, [0.29, 0.25, 0.25]);
  add(r.body, CG.frustum(0.98), coyD, [0, 0.1, 0], null, [0.3, 0.03, 0.255]); // cummerbund edge
  add(r.body, mergedBoxes('modMagPouch', [-0.08, 0, 0.08].map((x) => [0.065, 0.085, 0.04, x, 0, 0])), coyD, [0, 0.155, 0.135]);
  add(r.body, mergedBoxes('modStraps', [[0.06, 0.03, 0.27, 0.085, 0, 0], [0.06, 0.03, 0.27, -0.085, 0, 0]]), coyD, [0, 0.345, 0]);
  add(r.body, geo.box(0.15, 0.065, 0.02), team, [0, 0.27, 0.142], [-0.05, 0, 0]);
  add(r.body, geo.box(0.17, 0.12, 0.02), team, [0, 0.24, -0.142], [0.05, 0, 0]);
  // small assault pack with a whip antenna (radio)
  if (radioPack) {
    add(r.body, geo.box(0.2, 0.2, 0.08), fat, [0, 0.21, -0.17]);
    add(r.body, geo.box(0.16, 0.06, 0.03), fatD, [0, 0.16, -0.215]);
    add(r.body, geo.cyl(0.006, 0.008, 0.32, 4), fatD, [0.07, 0.42, -0.18], [-0.12, 0, 0]);
  }
  // team scarf (shemagh) round the neck: the team color that reads from above
  add(r.body, CG.frustum(0.7), team, [0, 0.37, 0.0], null, [0.25, 0.06, 0.21]);
  add(r.body, geo.box(0.07, 0.1, 0.02), team, [0.05, 0.31, 0.135], [-0.1, 0, -0.15]);
  // head: face, helmet with team band, goggles strapped over the brim, chin strap
  const helm = mat(C.helm);
  add(r.head, geo.sphere(0.088, 8, 6), skin, [0, 0.092, 0.012]);
  add(r.head, geo.box(0.026, 0.034, 0.03), skin, [0, 0.082, 0.1]);
  add(r.head, geo.sphere(0.108, 9, 6), helm, [0, 0.13, -0.008], null, [1.02, 0.8, 1.08]);
  add(r.head, geo.cyl(0.112, 0.12, 0.03, 10), helm, [0, 0.104, -0.008], null, [1, 1, 1.08]);
  add(r.head, geo.cyl(0.113, 0.113, 0.05, 10), team, [0, 0.15, -0.008], null, [1.02, 1, 1.08]);
  add(r.head, geo.box(0.05, 0.03, 0.03), team, [0, 0.21, -0.03]); // ID patch on the crown
  const gog = grp(r.head, 0, 0.165, 0.096);
  gog.rotation.x = -0.35;
  add(gog, geo.box(0.16, 0.05, 0.03), mat(C.black), [0, 0, 0]);
  add(gog, mergedBoxes('modGoggleLens', [[0.058, 0.034, 0.02, -0.04, 0, 0], [0.058, 0.034, 0.02, 0.04, 0, 0]]), mat(0xd89a2a), [0, 0, 0.012]);
  for (const s of [1, -1]) add(r.head, geo.box(0.012, 0.09, 0.012), mat(C.black), [s * 0.08, 0.06, 0.03], [0.2, 0, s * 0.15]);
  return r;
}

/** Sleeve + glove limb segment between shoulder S, elbow E and hand H (team armband on the upper arm). */
function soldierArm(g, S, E, H, team) {
  const fat = mat(C.olive);
  add(g, geo.sphere(0.05, 6, 4), fat, S, null, [1, 0.9, 1]);
  beam(g, S, E, 0.072, fat);
  const lerp = (t) => [S[0] + (E[0] - S[0]) * t, S[1] + (E[1] - S[1]) * t, S[2] + (E[2] - S[2]) * t];
  beam(g, lerp(0.12), lerp(0.62), 0.09, team);
  add(g, geo.sphere(0.04, 5, 4), fat, E);
  beam(g, E, H, 0.066, fat);
  add(g, geo.sphere(0.038, 5, 4), mat(C.glove), H);
}

/** Assault rifle built along +Z from the butt plate (receiver axis at y = 0). Muzzle at z = 0.7. */
function assaultRifle(g) {
  const gun = mat(C.gun), gunL = mat(C.gunL);
  add(g, geo.box(0.036, 0.074, 0.16), gun, [0, -0.014, 0.08]); // stock
  add(g, geo.box(0.044, 0.068, 0.22), gun, [0, 0, 0.27]); // receiver
  add(g, geo.box(0.03, 0.075, 0.034), gun, [0, -0.07, 0.2], [0.35, 0, 0]); // pistol grip
  add(g, geo.box(0.03, 0.1, 0.05), mat(C.coyoteD), [0, -0.085, 0.315], [-0.28, 0, 0]); // magazine
  add(g, geo.box(0.05, 0.054, 0.18), gunL, [0, 0.002, 0.465]); // handguard
  add(g, geo.cyl(0.012, 0.012, 0.13, 6), gun, [0, 0.004, 0.61], [HALF_PI, 0, 0]); // barrel
  add(g, geo.cyl(0.017, 0.017, 0.05, 6), gun, [0, 0.004, 0.675], [HALF_PI, 0, 0]); // flash hider
  add(g, geo.box(0.032, 0.038, 0.09), gunL, [0, 0.054, 0.28]); // optic
  add(g, geo.box(0.012, 0.036, 0.012), gun, [0, 0.04, 0.54]); // front sight
  add(g, geo.box(0.022, 0.06, 0.024), gun, [0, -0.055, 0.475]); // vertical foregrip
}

// Modern rifleman: helmet + goggles, olive camo fatigues, plate carrier, team armbands, assault rifle at the ready.
export function infantry(tc) {
  const r = soldierBase(tc);
  const team = mat(tc);
  const W = 2 * SOLDIER.shoulderX;
  // weapon group (pivot: right shoulder) holds both arms and the rifle, barrel level along +Z
  const gunG = grp(r.weapon, 0.105, -0.035, 0.0);
  assaultRifle(gunG);
  soldierArm(r.weapon, [0, 0, 0], [-0.03, -0.15, 0.05], [0.105, -0.105, 0.205], team);
  soldierArm(r.weapon, [W, 0, 0], [0.33, -0.13, 0.16], [0.105, -0.085, 0.43], team);
  return {
    root: r.root,
    parts: { body: r.body, head: r.head, legs: r.legs, weapon: r.weapon },
    height: 1.15,
    radius: 0.38,
  };
}

// Rocket trooper: same soldier with a shoulder-fired launcher tube and a backpack of spare rockets.
export function bazooka(tc) {
  const r = soldierBase(tc, { radioPack: false });
  const team = mat(tc), olive = mat(C.olive), oliveD = mat(C.oliveD), gun = mat(C.gun);
  const W = 2 * SOLDIER.shoulderX;
  // launcher tube on the right shoulder (weapon group pivots at the shoulder)
  const t = grp(r.weapon, 0.05, 0.08, 0);
  const tube = olive;
  add(t, geo.cyl(0.055, 0.055, 0.84, 8), tube, [0, 0, 0.08], [HALF_PI, 0, 0]);
  add(t, geo.cyl(0.068, 0.056, 0.07, 8), oliveD, [0, 0, 0.535], [HALF_PI, 0, 0]); // muzzle flare
  add(t, geo.cyl(0.05, 0.05, 0.012, 8), mat(C.black), [0, 0, 0.566], [HALF_PI, 0, 0]); // bore
  add(t, geo.cyl(0.056, 0.078, 0.11, 8), oliveD, [0, 0, -0.39], [HALF_PI, 0, 0]); // rear venturi
  add(t, geo.cyl(0.06, 0.06, 0.012, 8), mat(C.black), [0, 0, -0.446], [HALF_PI, 0, 0]);
  add(t, geo.cyl(0.059, 0.059, 0.1, 8), team, [0, 0, 0.36], [HALF_PI, 0, 0]); // team bands
  add(t, geo.cyl(0.059, 0.059, 0.06, 8), team, [0, 0, -0.22], [HALF_PI, 0, 0]);
  add(t, geo.box(0.04, 0.055, 0.1), gun, [0.075, 0.03, 0.12]); // optical sight
  add(t, geo.box(0.032, 0.085, 0.036), gun, [0, -0.085, 0.1], [0.25, 0, 0]); // trigger grip
  add(t, geo.box(0.03, 0.075, 0.032), gun, [0, -0.08, 0.3], [0.15, 0, 0]); // front grip
  add(t, geo.box(0.07, 0.03, 0.14), gun, [0, -0.06, -0.03]); // shoulder rest
  soldierArm(r.weapon, [0, 0, 0], [-0.05, -0.14, 0.03], [0.05, -0.02, 0.1], team);
  soldierArm(r.weapon, [W, 0, 0], [0.33, -0.13, 0.13], [0.06, 0.0, 0.3], team);
  // rocket backpack (replaces the small pack): frame, two spare rockets with team-banded warheads
  add(r.body, geo.box(0.24, 0.26, 0.11), olive, [0, 0.2, -0.205]);
  add(r.body, geo.box(0.25, 0.05, 0.12), oliveD, [0, 0.12, -0.205]);
  add(r.body, geo.box(0.12, 0.08, 0.03), team, [0, 0.24, -0.265]); // team flap patch
  for (const x of [-0.065, 0.065]) {
    add(r.body, geo.cyl(0.032, 0.032, 0.16, 6), oliveD, [x, 0.39, -0.205]);
    add(r.body, geo.cyl(0.046, 0.032, 0.05, 6), team, [x, 0.49, -0.205]);
    add(r.body, geo.cone(0.046, 0.12, 6), mat(C.coyote), [x, 0.575, -0.205]);
  }
  return {
    root: r.root,
    parts: { body: r.body, head: r.head, legs: r.legs, weapon: r.weapon },
    height: 1.15,
    radius: 0.4,
  };
}

// ===========================================================================
// Vehicles
// ===========================================================================

// Main battle tank: tracked hull with side skirts, angular turret, long smoothbore gun (parts.weapon,
// pivot at the mantlet), roof machine gun, olive/sand camo, team turret band, air panel and turret number.
export function tank(tc) {
  const root = new THREE.Group();
  const armor = mat(C.armor), armorD = mat(C.armorD), sand = mat(C.sand), team = mat(tc);
  const track = mat(C.track), dark = mat(0x26282a), gun = mat(C.gun);
  // --- running gear: track loops, road wheels, drive sprocket (rear) and idler (front)
  const TX = 0.6, TW = 0.32, EZ = 1.06, EY = 0.26, RO = 0.18, RI = 0.13;
  const arc = (r, a0, a1, cz, n = 3) => Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cz + r * Math.cos(a), EY + r * Math.sin(a)];
  });
  const outer = [[-0.86, 0], [0.86, 0], ...arc(RO, -2.0, HALF_PI, EZ), ...arc(RO, HALF_PI, Math.PI + 1.14, -EZ)];
  const inner = [[-0.82, 0.05], [0.82, 0.05], ...arc(RI, -2.0, HALF_PI, EZ), ...arc(RI, HALF_PI, Math.PI + 1.14, -EZ)];
  const trackGeo = profileX('tankTrack', outer, TW, { holes: [inner.reverse()], curve: 3 });
  for (const s of [1, -1]) add(root, trackGeo, track, [s * TX, 0, 0]);
  // one mesh per wheel (tyre + hub in one geometry) keeps the draw calls and triangles down
  const roadWheel = wheelGeo('tankRoad', [['cyl', 0.16, 0.26, 0, 0, 0, 0, 0, 8], ['cyl', 0.075, 0.3, 0, 0, 0, 0, 0, 6]]);
  const sprocket = wheelGeo('tankSprocket', [['cyl', 0.115, 0.28, 0, 0, 0, 0, 0, 8], ['box', 0.3, 0.05, 0.25], ['box', 0.3, 0.25, 0.05]]);
  const wheels = [];
  const wm = mat(C.wheel);
  for (const s of [1, -1]) {
    for (const z of [-0.76, -0.38, 0, 0.38, 0.76]) {
      const w = grp(root, s * TX, 0.21, z);
      add(w, roadWheel, wm);
      wheels.push(w);
    }
    for (const z of [-EZ, EZ]) {
      const w = grp(root, s * TX, EY, z);
      add(w, sprocket, wm);
      wheels.push(w);
    }
  }
  // --- hull: narrow lower hull between the tracks, wide upper hull over them, glacis, side skirts
  add(root, profileX('tankLowerHull', [[-1.14, 0.14], [0.9, 0.14], [1.14, 0.47], [-1.2, 0.47]], 0.86), armorD);
  const hullProf = [[-1.24, 0.46], [1.12, 0.46], [1.3, 0.55], [0.72, 0.68], [-1.2, 0.68], [-1.26, 0.62]];
  add(root, profileX('tankUpperHull', hullProf, 1.5), armor);
  const skirt = [[-1.18, 0.27], [0.96, 0.27], [1.2, 0.4], [1.24, 0.5], [-1.2, 0.5]];
  for (const s of [1, -1]) {
    add(root, profileX('tankSkirt', skirt, 0.05), armor, [s * 0.775, 0, 0]);
    add(root, geo.box(0.012, 0.06, 1.7), team, [s * 0.803, 0.43, -0.12]); // team stripe along the skirt
    add(root, mergedBoxes('tankSkirtSeams', [-0.75, -0.25, 0.25].map((z) => [0.012, 0.18, 0.02, 0, 0.38, z])), armorD, [s * 0.803, 0, 0]);
    // sand camo blotches on the skirts
    add(root, mergedBoxes('tankSkirtCamo', [[0.012, 0.12, 0.36, 0, 0.34, -0.95], [0.012, 0.1, 0.22, 0, 0.38, 0.05], [0.012, 0.14, 0.3, 0, 0.36, 0.72]]), sand, [s * 0.803, 0, 0]);
  }
  // deck details: driver hatch, engine grilles, tool boxes, lights, tow hooks
  add(root, geo.cyl(0.11, 0.11, 0.03, 8), armorD, [0, 0.69, 0.86]);
  add(root, geo.box(0.16, 0.03, 0.06), dark, [0, 0.67, 1.0]); // driver periscopes
  const grille = [];
  for (let i = 0; i < 5; i++) grille.push([0.9, 0.02, 0.04, 0, 0, -0.8 - i * 0.085]);
  add(root, mergedBoxes('tankGrille', grille), dark, [0, 0.69, 0]);
  add(root, mergedBoxes('tankBoxes', [[0.22, 0.08, 0.5, 0.62, 0.72, -0.85], [0.22, 0.08, 0.5, -0.62, 0.72, -0.85], [0.2, 0.06, 0.34, 0.62, 0.71, 0.5]]), armorD);
  add(root, mergedBoxes('tankDeckCamo', [[0.4, 0.01, 0.3, 0.42, 0.685, -0.4, 0.4], [0.34, 0.01, 0.42, -0.38, 0.685, 0.42, -0.6], [0.3, 0.01, 0.26, 0.5, 0.685, 0.62, 0.3], [0.32, 0.01, 0.2, -0.5, 0.685, -0.5, 0.2]]), sand);
  add(root, mergedBoxes('tankLights', [[0.08, 0.06, 0.04, 0.6, 0.6, 1.2], [0.08, 0.06, 0.04, -0.6, 0.6, 1.2]]), mat(0xe9e3c0));
  add(root, mergedBoxes('tankHooks', [[0.06, 0.06, 0.08, 0.3, 0.42, 1.2], [0.06, 0.06, 0.08, -0.3, 0.42, 1.2]]), dark);
  add(root, mergedBoxes('tankTail', [[0.08, 0.05, 0.02, 0.62, 0.6, -1.25], [0.08, 0.05, 0.02, -0.62, 0.6, -1.25]]), mat(0xb22018));
  // --- turret: angular loft with a chamfered skirt, team band, camo, hatches, sights
  const tz = -0.14, ty = 0.68;
  const base = [[-0.52, -0.66], [0.52, -0.66], [0.6, -0.08], [0.56, 0.38], [0.32, 0.6], [-0.32, 0.6], [-0.56, 0.38], [-0.6, -0.08]];
  const ring = (y, sx, szf, szb) => [y, base.map(([x, z]) => [x * sx, z > 0 ? z * szf : z * szb])];
  const TR = [ring(0, 0.9, 0.9, 0.94), ring(0.06, 1, 1, 1), ring(0.27, 0.9, 0.86, 0.97), ring(0.3, 0.84, 0.8, 0.93)];
  const turret = grp(root, 0, ty, tz);
  add(turret, loftGeo('tankTurret', TR), armor);
  add(turret, loftGeo('tankTurretBand', [ringAt(TR[1], TR[2], 0.2, 0.012), ringAt(TR[1], TR[2], 0.7, 0.012)]), team);
  const roofY = 0.3;
  add(turret, geo.box(0.46, 0.012, 0.24), team, [0.06, roofY + 0.004, -0.38]); // air recognition panel
  add(turret, mergedBoxes('tankTurretCamo', [[0.3, 0.012, 0.2, -0.25, 0, 0.18, 0.5], [0.24, 0.012, 0.14, 0.3, 0, 0.12, -0.3], [0.2, 0.012, 0.12, -0.32, 0, -0.42, 0.2]]), sand, [0, roofY + 0.002, 0]);
  // side faces: sand blotches + white turret number on the band (edge 0->7 is the left rear side)
  for (const [edge, u] of [[1, 0.42], [7, 0.58]]) {
    const f = onFace(turret, TR, 1, edge, u, 0.45, 0.012);
    add(f, mergedBoxes('tankNumber', digitBoxes('17', 0.085, 0.017)), mat(0xf4f4ee));
    const cam = onFace(turret, TR, 1, edge, 1 - u, 0.86);
    add(cam, geo.box(0.18, 0.05, 0.01), sand, [0, 0, 0], [0, 0, 0.15]);
  }
  for (const edge of [2, 6]) add(onFace(turret, TR, 1, edge, 0.5, 0.75), geo.box(0.2, 0.06, 0.01), sand, [0, 0, 0], [0, 0, -0.2]);
  // commander's cupola + roof machine gun (static), loader's hatch, gunner's sight, smoke launchers
  const cx = -0.26, cz = -0.14;
  add(turret, geo.cyl(0.12, 0.13, 0.08, 8), armorD, [cx, roofY + 0.04, cz]);
  add(turret, geo.cyl(0.1, 0.1, 0.03, 8), armor, [cx, roofY + 0.095, cz]);
  add(turret, mergedBoxes('tankVision', [0, 1, 2].map((i) => {
    const a = -0.7 + i * 0.7;
    return [0.05, 0.03, 0.02, Math.sin(a) * 0.125, 0, Math.cos(a) * 0.125, a];
  })), dark, [cx, roofY + 0.05, cz]);
  add(turret, geo.box(0.03, 0.12, 0.03), gun, [cx, roofY + 0.16, cz + 0.06]); // pintle
  add(turret, geo.box(0.05, 0.06, 0.22), gun, [cx, roofY + 0.22, cz + 0.12]);
  add(turret, geo.cyl(0.012, 0.012, 0.28, 6), gun, [cx, roofY + 0.23, cz + 0.36], [HALF_PI, 0, 0]);
  add(turret, geo.box(0.07, 0.06, 0.08), armorD, [cx + 0.06, roofY + 0.2, cz + 0.08]); // ammo can
  add(turret, geo.cyl(0.1, 0.1, 0.03, 8), armorD, [0.26, roofY + 0.015, -0.18]);
  add(turret, geo.box(0.14, 0.1, 0.16), armorD, [-0.3, roofY + 0.05, 0.28]); // gunner's sight
  add(turret, geo.box(0.11, 0.06, 0.01), mat(0x2b4a5a), [-0.3, roofY + 0.06, 0.362]);
  add(turret, geo.box(0.1, 0.1, 0.1), armorD, [0.26, roofY + 0.05, 0.14]); // commander's sight
  for (const s of [1, -1]) {
    const tubes = [];
    for (let i = 0; i < 3; i++) tubes.push([0.03, 0.03, 0.1, i * 0.06 - 0.06, 0, 0, 0, 0, 5]);
    const sm = grp(turret, s * 0.5, 0.2, 0.3);
    sm.rotation.set(-0.7, s * 0.6, 0);
    add(sm, mergedCyls('tankSmoke', tubes), armorD);
  }
  // bustle rack with stowage and a team-colored tarp, whip antennas
  const rack = [];
  for (const x of [-0.5, 0.5]) rack.push([0.03, 0.03, 0.22, x, 0.2, -0.75]);
  rack.push([1.03, 0.03, 0.03, 0, 0.2, -0.86], [1.03, 0.03, 0.03, 0, 0.1, -0.86]);
  add(turret, mergedBoxes('tankRack', rack), armorD);
  add(turret, mergedBoxes('tankStow', [[0.34, 0.14, 0.16, -0.28, 0.13, -0.76], [0.3, 0.12, 0.16, 0.08, 0.12, -0.76]]), mat(0x6e6a4a));
  add(turret, geo.cyl(0.07, 0.07, 0.3, 7), team, [0.36, 0.14, -0.76], [0, 0, HALF_PI]);
  for (const s of [1, -1]) add(turret, geo.cyl(0.006, 0.01, 0.42, 4), gun, [s * 0.42, roofY + 0.19, -0.58], [-0.3, 0, 0]);
  // --- main gun (parts.weapon): pivot at the mantlet, barrel along +Z
  const weapon = grp(root, 0, 0.82, tz + 0.6);
  add(weapon, geo.box(0.34, 0.2, 0.16), armorD, [0, 0, 0.0]); // mantlet
  add(weapon, geo.cyl(0.075, 0.09, 0.1, 8), dark, [0, 0, 0.12], [HALF_PI, 0, 0]); // dust boot
  add(weapon, geo.cyl(0.041, 0.048, 1.2, 8), armor, [0, 0, 0.75], [HALF_PI, 0, 0]);
  add(weapon, geo.cyl(0.064, 0.064, 0.2, 8), armorD, [0, 0, 0.66], [HALF_PI, 0, 0]); // bore evacuator
  add(weapon, geo.cyl(0.05, 0.05, 0.06, 8), dark, [0, 0, 1.33], [HALF_PI, 0, 0]); // muzzle
  add(weapon, geo.box(0.03, 0.03, 0.06), dark, [0, 0.05, 1.3]); // muzzle reference sensor
  add(weapon, geo.cyl(0.05, 0.05, 0.05, 8), sand, [0, 0, 0.98], [HALF_PI, 0, 0]); // camo ring
  return { root, parts: { weapon, wheels }, height: 1.15, radius: 0.95 };
}

// 6x6 rocket artillery truck: armored cab with team doors, launcher pod on a turntable at the rear.
// parts.weapon is the pod, pivoting at its rear hinge; its holder keeps it raised 0.5 rad at rest.
export function rocket_artillery(tc) {
  const root = new THREE.Group();
  const olive = mat(C.armor), oliveD = mat(C.armorD), team = mat(tc), rubber = mat(C.rubber), dark = mat(0x26282a);
  const glass = mat(C.glass), sand = mat(C.sand), steel = mat(0x55594f);
  // --- wheels (3 axles)
  const tire = wheelGeo('mlrsTire', [['cyl', 0.2, 0.17, 0, 0, 0, 0, 0, 12], ...[0, 1, 2].map((i) => ['box', 0.175, 0.03, 0.39, 0, 0, 0, (i * Math.PI) / 3 + 0.5])]);
  const hub = wheelGeo('mlrsHub', [['cyl', 0.11, 0.18, 0, 0, 0, 0, 0, 8], ['cyl', 0.045, 0.2, 0, 0, 0, 0, 0, 6], ...[0, 1, 2].map((i) => ['box', 0.19, 0.03, 0.16, 0, 0, 0, (i * Math.PI) / 3])]);
  const wheels = [];
  for (const z of [0.78, -0.4, -0.82]) {
    for (const s of [1, -1]) {
      const w = grp(root, s * 0.46, 0.2, z);
      add(w, tire, rubber);
      add(w, hub, olive);
      wheels.push(w);
    }
  }
  // --- chassis, axles, fenders, side lockers
  add(root, geo.box(0.6, 0.14, 2.24), oliveD, [0, 0.32, -0.04]);
  add(root, mergedCyls('mlrsAxles', [0.78, -0.4, -0.82].map((z) => [0.04, 0.04, 0.8, 0, 0.2, z, 0, HALF_PI, 6])), dark);
  add(root, mergedBoxes('mlrsFenders', [
    [0.22, 0.04, 0.5, 0.46, 0.43, 0.78], [0.22, 0.04, 0.5, -0.46, 0.43, 0.78],
    [0.22, 0.04, 0.92, 0.46, 0.43, -0.61], [0.22, 0.04, 0.92, -0.46, 0.43, -0.61],
  ]), oliveD);
  add(root, mergedBoxes('mlrsLockers', [[0.08, 0.16, 0.42, 0.45, 0.33, 0.18], [0.08, 0.16, 0.42, -0.45, 0.33, 0.18]]), olive);
  add(root, mergedBoxes('mlrsLockerCamo', [[0.012, 0.08, 0.2, 0.495, 0.34, 0.12], [0.012, 0.08, 0.2, -0.495, 0.34, 0.24]]), sand);
  // --- armored cab (team doors), windshield, grille, bumper, lights, mirrors
  const cab = [[0.46, 0.36], [1.17, 0.36], [1.19, 0.66], [1.08, 0.98], [0.5, 1.0]];
  add(root, profileX('mlrsCab', cab, 0.98), olive);
  add(root, mergedBoxes('mlrsWindshield', [[0.4, 0.27, 0.02, 0.22, 0, 0], [0.4, 0.27, 0.02, -0.22, 0, 0]]), glass, [0, 0.82, 1.14], [-0.33, 0, 0]);
  for (const s of [1, -1]) {
    add(root, geo.box(0.02, 0.32, 0.4), team, [s * 0.495, 0.56, 0.83]); // door
    add(root, geo.box(0.02, 0.2, 0.3), glass, [s * 0.495, 0.84, 0.82]); // door window
    add(root, geo.box(0.03, 0.03, 0.08), dark, [s * 0.508, 0.62, 0.7]); // handle
    add(root, geo.box(0.03, 0.12, 0.06), dark, [s * 0.56, 0.86, 1.06]); // mirror
    add(root, geo.box(0.08, 0.02, 0.02), dark, [s * 0.52, 0.86, 1.04]);
  }
  add(root, geo.box(0.98, 0.012, 0.36), team, [0, 1.0, 0.74], [-0.03, 0, 0]); // roof air panel
  add(root, geo.cyl(0.08, 0.08, 0.04, 8), oliveD, [-0.22, 1.02, 0.68]); // roof hatch
  add(root, geo.box(0.6, 0.18, 0.02), dark, [0, 0.5, 1.185]); // grille
  add(root, mergedBoxes('mlrsGrilleSlats', [0, 1, 2, 3].map((i) => [0.56, 0.018, 0.01, 0, -0.06 + i * 0.04, 0])), oliveD, [0, 0.5, 1.198]);
  add(root, geo.box(1.0, 0.1, 0.1), oliveD, [0, 0.33, 1.2]); // bumper
  add(root, mergedBoxes('mlrsLights', [[0.08, 0.07, 0.02, 0.38, 0, 0], [0.08, 0.07, 0.02, -0.38, 0, 0]]), mat(0xe9e3c0), [0, 0.5, 1.19]);
  add(root, geo.cyl(0.006, 0.01, 0.5, 4), dark, [0.42, 1.24, 0.56], [-0.25, 0, 0]); // whip antenna
  // --- rear deck, turntable, hinge brackets, rear lights
  add(root, geo.box(0.98, 0.06, 1.66), oliveD, [0, 0.49, -0.36]);
  add(root, geo.cyl(0.36, 0.4, 0.08, 12), olive, [0, 0.56, -0.74]);
  add(root, mergedBoxes('mlrsHinge', [[0.08, 0.14, 0.16, 0.3, 0.62, -1.06], [0.08, 0.14, 0.16, -0.3, 0.62, -1.06]]), oliveD);
  add(root, geo.cyl(0.035, 0.035, 0.68, 6), dark, [0, 0.64, -1.06], [0, 0, HALF_PI]);
  // travel cradle the pod rests on when stowed, stowage lockers, jerry cans
  add(root, mergedBoxes('mlrsCradle', [[0.06, 0.26, 0.06, 0.26, 0.65, 0.3], [0.06, 0.26, 0.06, -0.26, 0.65, 0.3], [0.6, 0.06, 0.08, 0, 0.78, 0.3], [0.5, 0.04, 0.04, 0, 0.6, 0.3]]), oliveD);
  add(root, mergedBoxes('mlrsDeckBoxes', [[0.2, 0.14, 0.5, 0.36, 0.59, -0.1], [0.2, 0.14, 0.5, -0.36, 0.59, -0.1]]), olive);
  add(root, mergedBoxes('mlrsDeckBoxLids', [[0.21, 0.02, 0.51, 0.36, 0.67, -0.1], [0.21, 0.02, 0.51, -0.36, 0.67, -0.1]]), sand);
  add(root, mergedBoxes('mlrsCans', [[0.06, 0.14, 0.1, 0.42, 0.59, 0.2], [0.06, 0.14, 0.1, 0.34, 0.59, 0.2]]), mat(0x3e4630));
  add(root, mergedBoxes('mlrsTail', [[0.08, 0.05, 0.02, 0.4, 0.42, -1.2], [0.08, 0.05, 0.02, -0.4, 0.42, -1.2]]), mat(0xb22018));
  add(root, geo.box(0.98, 0.08, 0.06), oliveD, [0, 0.36, -1.17]); // rear bumper
  // --- launcher pod (parts.weapon) on a holder raised 0.5 rad; pivot = rear hinge
  const ELEV = 0.5;
  const holder = grp(root, 0, 0.64, -1.06);
  holder.rotation.x = -ELEV;
  const weapon = grp(holder, 0, 0, 0);
  const PL = 0.95, PH = 0.4, PW = 0.7;
  add(weapon, geo.box(0.74, 0.05, PL), oliveD, [0, 0.0, PL / 2]); // cradle
  add(weapon, geo.box(PW, PH, PL - 0.02), olive, [0, 0.02 + PH / 2, PL / 2 - 0.01]);
  add(weapon, mergedBoxes('mlrsPodRibs', [0.15, 0.4, 0.65].flatMap((z) => [[PW + 0.02, 0.03, 0.04, 0, PH + 0.02, z], [PW + 0.02, PH, 0.04, 0, 0.02 + PH / 2, z]])), oliveD);
  add(weapon, geo.box(PW + 0.024, PH + 0.024, 0.14), team, [0, 0.02 + PH / 2, 0.8]); // team band
  add(weapon, mergedBoxes('mlrsPodCamo', [[0.28, 0.012, 0.22, -0.16, 0, 0.3], [0.2, 0.012, 0.16, 0.2, 0, 0.52]]), sand, [0, PH + 0.025, 0]);
  // front face: frame lip, 2 x 3 tubes with rocket noses
  const fz = PL - 0.02;
  add(weapon, mergedBoxes('mlrsPodLip', [[PW + 0.02, 0.04, 0.04, 0, 0.02 + PH, fz], [PW + 0.02, 0.04, 0.04, 0, 0.02, fz], [0.04, PH, 0.04, PW / 2, 0.02 + PH / 2, fz], [0.04, PH, 0.04, -PW / 2, 0.02 + PH / 2, fz]]), oliveD);
  const tubes = [], noses = [];
  for (const x of [-0.21, 0, 0.21]) {
    for (const y of [0.13, 0.31]) {
      tubes.push([0.085, 0.085, 0.03, x, y, fz + 0.002, HALF_PI, 0, 10]);
      noses.push([0.0, 0.058, 0.1, x, y, fz - 0.02, HALF_PI, 0, 8]);
    }
  }
  add(weapon, mergedCyls('mlrsTubes', tubes), dark);
  add(weapon, mergedCyls('mlrsNoses', noses), mat(0xd8d4c4));
  // hydraulic ram: sleeve on the deck (static), piston rod in the pod group (telescopes on recoil)
  root.updateMatrixWorld(true);
  const attach = new THREE.Vector3(0, 0, 0.5).applyMatrix4(weapon.matrixWorld);
  const foot = new THREE.Vector3(0, 0.56, -0.38);
  const mid = foot.clone().lerp(attach, 0.55);
  beam(root, foot.toArray(), mid.toArray(), 0.07, oliveD);
  const inv = new THREE.Matrix4().copy(weapon.matrixWorld).invert();
  const footL = foot.clone().applyMatrix4(inv), midL = mid.clone().applyMatrix4(inv);
  beam(weapon, [0, 0, 0.5], midL.clone().lerp(footL, 0.12).toArray(), 0.04, steel);
  return { root, parts: { weapon, wheels }, height: 1.4, radius: 0.9 };
}

// ===========================================================================
// Buildings
// ===========================================================================

/** Alternating hazard blocks along a line from a to b (in XZ at height y), width w, n blocks. */
function hazardStrip(key, a, b, y, w, n, h = 0.012) {
  const yellow = [], black = [];
  const dx = (b[0] - a[0]) / n, dz = (b[1] - a[1]) / n;
  const len = Math.hypot(dx, dz), ry = Math.atan2(dx, dz);
  for (let i = 0; i < n; i++) {
    const box = [w, h, len, a[0] + dx * (i + 0.5), y, a[1] + dz * (i + 0.5), ry];
    (i % 2 ? black : yellow).push(box);
  }
  return [mergedBoxes(`hz:${key}:y`, yellow), mergedBoxes(`hz:${key}:b`, black)];
}

// Nuclear missile silo: concrete pad, armored collar with hazard ring, two blast-door leaves slid half
// open over a white warhead nose cone, lattice radar mast (dish spins), control bunker, red warning lights.
export function missile_silo(tc) {
  const root = new THREE.Group();
  const conc = mat(C.conc), concD = mat(C.concD), concL = mat(C.concL), steel = mat(C.steel), steelD = mat(C.steelD);
  const yellow = mat(C.hazard), black = mat(C.black), team = mat(tc), red = glowMat(0xff2a1a, 1.2);
  const glow = [];
  const light = (parent, x, y, z, r = 0.05) => {
    const m = add(parent, geo.sphere(r, 8, 6), red, [x, y, z]);
    m.castShadow = false;
    glow.push(m);
    return m;
  };
  // --- pad with expansion joints and a painted team border
  const S = 2.88;
  add(root, geo.box(S, 0.1, S), conc, [0, 0.05, 0]);
  const joints = [];
  for (const v of [-0.72, 0.72]) {
    joints.push([0.025, 0.006, S - 0.02, v, 0.1, 0], [S - 0.02, 0.006, 0.025, 0, 0.1, v]);
  }
  add(root, mergedBoxes('siloJoints', joints), concD);
  add(root, mergedBoxes('siloBorder', [[S, 0.012, 0.07, 0, 0.1, S / 2 - 0.035], [S, 0.012, 0.07, 0, 0.1, -S / 2 + 0.035], [0.07, 0.012, S - 0.14, S / 2 - 0.035, 0.1, 0], [0.07, 0.012, S - 0.14, -S / 2 + 0.035, 0.1, 0]]), team);
  // --- silo collar, hazard ring, dark shaft
  const hx = 0.1, hzc = 0.16, R = 0.74;
  add(root, geo.cyl(R + 0.16, R + 0.24, 0.16, 24), concL, [hx, 0.18, hzc]);
  add(root, geo.cyl(R + 0.245, R + 0.245, 0.05, 24), team, [hx, 0.13, hzc]); // team ring at the collar foot
  const ringY = [], ringB = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const rr = R + 0.09;
    (i % 2 ? ringB : ringY).push([0.17, 0.012, 0.12, Math.sin(a) * rr, 0, Math.cos(a) * rr, a + HALF_PI]);
  }
  add(root, mergedBoxes('siloRingY', ringY), yellow, [hx, 0.262, hzc]);
  add(root, mergedBoxes('siloRingB', ringB), black, [hx, 0.262, hzc]);
  add(root, geo.cyl(R, R, 0.02, 24), black, [hx, 0.255, hzc]);
  // --- the missile: white body with a team band, ogive nose with a black tip
  add(root, geo.cyl(0.25, 0.25, 0.3, 12), mat(0xeeeeea), [hx, 0.25 + 0.15, hzc]);
  add(root, geo.cyl(0.255, 0.255, 0.08, 12), team, [hx, 0.47, hzc]);
  add(root, ogive(0.25, 0.48, 12), mat(0xf2f2ee), [hx, 0.55, hzc]);
  add(root, geo.cone(0.06, 0.08, 8), black, [hx, 1.0, hzc]);
  // --- blast-door leaves slid apart on rails (static), ribbed tops, hazard edges
  const GAP = 0.27;
  for (const s of [1, -1]) {
    const leaf = grp(root, hx + s * GAP, 0.27, hzc);
    leaf.rotation.y = s > 0 ? Math.PI : 0; // the x < 0 half disc, mirrored for the +x leaf
    add(leaf, halfDisc(R + 0.04, 0.13, 12), steel);
    add(leaf, mergedBoxes('siloLeafRibs', [[0.06, 0.04, 1.3, -0.3, 0.15, 0], [0.06, 0.04, 1.0, -0.55, 0.15, 0], [0.5, 0.04, 0.06, -0.3, 0.15, 0.32], [0.5, 0.04, 0.06, -0.3, 0.15, -0.32]]), steelD);
    const [hy, hb] = hazardStrip('siloLeafEdge', [-0.06, -0.72], [-0.06, 0.72], 0.135, 0.12, 9);
    add(leaf, hy, yellow);
    add(leaf, hb, black);
    add(leaf, geo.box(0.05, 0.14, 1.52), steelD, [-0.02, 0.07, 0]); // heavy edge beam
  }
  // rails the leaves slide on, with end stops
  for (const z of [hzc - 0.55, hzc + 0.55]) {
    add(root, geo.box(2.66, 0.05, 0.1), steelD, [hx, 0.125, z]);
    add(root, mergedBoxes('siloRailStops', [[0.1, 0.12, 0.14, 1.27, 0, 0], [0.1, 0.12, 0.14, -1.27, 0, 0]]), black, [hx, 0.16, z]);
  }
  light(root, hx + 1.27, 0.27, hzc + 0.55, 0.045);
  light(root, hx - 1.27, 0.27, hzc - 0.55, 0.045);
  // --- lattice radar mast (back left) with the spinning dish
  const mx = -1.08, mz = -1.08, MH = 1.65;
  const legs = [], b0 = 0.2, b1 = 0.06;
  const corner = (sx, sz, t) => [sx * (b0 + (b1 - b0) * t), 0.1 + MH * t, sz * (b0 + (b1 - b0) * t)];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) legs.push([corner(sx, sz, 0), corner(sx, sz, 1), 0.04]);
  const lv = [0, 0.25, 0.5, 0.75, 1];
  const sides = [[[1, 1], [1, -1]], [[1, -1], [-1, -1]], [[-1, -1], [-1, 1]], [[-1, 1], [1, 1]]];
  for (let k = 0; k + 1 < lv.length; k++) {
    for (const [[ax, az], [bx, bz]] of sides) {
      legs.push([corner(ax, az, lv[k + 1]), corner(bx, bz, lv[k + 1]), 0.025]);
      legs.push([corner(ax, az, lv[k]), corner(bx, bz, lv[k + 1]), 0.02]);
    }
  }
  add(root, mergedBeams('siloMast', legs), steel, [mx, 0, mz]);
  add(root, geo.box(0.46, 0.08, 0.46), concD, [mx, 0.14, mz]);
  add(root, geo.box(0.24, 0.05, 0.24), steelD, [mx, 0.1 + MH + 0.025, mz]);
  const radar = grp(root, mx, 0.1 + MH + 0.05, mz);
  add(radar, geo.cyl(0.07, 0.09, 0.1, 8), steelD, [0, 0.05, 0]);
  add(radar, geo.box(0.06, 0.2, 0.06), steelD, [0, 0.18, 0]);
  const dish = grp(radar, 0, 0.26, 0.04);
  dish.rotation.x = -0.35;
  add(dish, dishGeo(0.36, 0.55), mat(0xdfe3e6, { side: THREE.DoubleSide }));
  add(dish, mergedBeams('siloFeed', [[[0.3, 0, 0.03], [0, 0, 0.3], 0.015], [[-0.3, 0, 0.03], [0, 0, 0.3], 0.015], [[0, 0.3, 0.03], [0, 0, 0.3], 0.015]]), steelD);
  add(dish, geo.box(0.06, 0.06, 0.06), steelD, [0, 0, 0.31]);
  add(dish, geo.box(0.16, 0.12, 0.08), steelD, [0, 0, -0.12]); // counterweight / receiver
  light(radar, 0, 0.12, -0.2, 0.04);
  // --- control bunker (back right): sloped concrete blockhouse, blast door, team stripe + star
  const bx = 0.86, bz = -1.04;
  add(root, CG.frustum(0.78), conc, [bx, 0.1 + 0.27, bz], null, [1.08, 0.54, 0.74]);
  add(root, geo.box(0.86, 0.06, 0.56), concD, [bx, 0.67, bz]);
  add(root, geo.box(0.88, 0.07, 0.58), team, [bx, 0.6, bz]);
  add(root, geo.box(0.26, 0.34, 0.06), steelD, [bx - 0.2, 0.27, bz + 0.33], [-0.2, 0, 0]); // blast door
  add(root, mergedBoxes('siloDoorBolts', [[0.2, 0.025, 0.02, 0, 0.08, 0], [0.2, 0.025, 0.02, 0, -0.08, 0]]), yellow, [bx - 0.2, 0.27, bz + 0.37], [-0.2, 0, 0]);
  add(root, geo.box(0.22, 0.06, 0.04), mat(C.black), [bx + 0.18, 0.42, bz + 0.31], [-0.2, 0, 0]); // vision slit
  // team star on the bunker roof
  add(root, starGeo(0.17, 0.07, 0.012), team, [bx - 0.12, 0.7, bz]);
  add(root, geo.box(0.16, 0.12, 0.14), steel, [bx + 0.22, 0.76, bz - 0.06]); // vent unit
  add(root, geo.cyl(0.006, 0.01, 0.6, 4), mat(C.black), [bx + 0.3, 1.0, bz + 0.12]);
  light(root, bx - 0.38, 0.74, bz + 0.2, 0.045);
  // --- launch exhaust grates (front left), sign with the radiation trefoil, barriers, team flag
  add(root, geo.box(0.5, 0.04, 0.34), concD, [-1.08, 0.12, 1.06]);
  const grate = [];
  for (let i = 0; i < 6; i++) grate.push([0.42, 0.02, 0.025, 0, 0, -0.12 + i * 0.048]);
  add(root, mergedBoxes('siloGrate', grate), black, [-1.08, 0.145, 1.06]);
  const sign = grp(root, -0.62, 0.1, 1.24);
  add(sign, mergedBoxes('siloSignPosts', [[0.03, 0.34, 0.03, -0.14, 0.17, 0], [0.03, 0.34, 0.03, 0.14, 0.17, 0]]), steel);
  add(sign, geo.box(0.36, 0.26, 0.025), yellow, [0, 0.42, 0.0]);
  add(sign, trefoilGeo(0.11), black, [0, 0.42, 0.014]);
  add(root, mergedBoxes('siloBarriers', [[0.4, 0.14, 0.12, 0.55, 0.17, 1.3], [0.4, 0.14, 0.12, 1.0, 0.17, 1.3], [0.12, 0.14, 0.4, 1.3, 0.17, 0.9]]), concL);
  add(root, mergedBoxes('siloBarrierStripes', [[0.405, 0.03, 0.125, 0.55, 0.2, 1.3], [0.405, 0.03, 0.125, 1.0, 0.2, 1.3], [0.125, 0.03, 0.405, 1.3, 0.2, 0.9]]), mat(0xc03020));
  flag(root, 1.3, 0.1, -0.5, tc, { pole: 1.25, w: 0.46, h: 0.28, dir: -1, poleColor: C.steel, finial: C.steel, poleR: 0.02 });
  return { root, parts: { spin: [radar], glow }, height: 2.4, radius: 1.45 };
}

/** Glass curtain wall facing +Z: glass box + merged mullion grid. Origin at the bottom center. */
function curtainWall(parent, key, x, y, z, w, h, { cols, rows, ry = 0, glass = C.glassB, frame = C.mullion, depth = 0.04 } = {}) {
  const g = grp(parent, x, y, z, ry);
  add(g, geo.box(w, h, depth), mat(glass), [0, h / 2, 0]);
  const bars = [];
  for (let i = 0; i <= cols; i++) bars.push([0.025, h, 0.03, -w / 2 + (w * i) / cols, h / 2, depth / 2]);
  for (let j = 0; j <= rows; j++) bars.push([w, 0.025, 0.03, 0, (h * j) / rows, depth / 2]);
  add(g, mergedBoxes(`cw:${key}`, bars), mat(frame));
  return g;
}

// Capitol (Modern town center): granite plaza, colonnaded concrete base with a glass curtain wall,
// team frieze + banners, glass office tower with a helipad, antenna mast and team flags.
export function capitol(tc) {
  const root = new THREE.Group();
  const conc = mat(C.conc), concD = mat(C.concD), concL = mat(C.concL), team = mat(tc), gold = mat(P.gold);
  const granite = mat(0xbcb8ae), glassD = mat(C.glassBD), steel = mat(C.steel), lit = mat(C.lit, { emissive: 0xffb84a, emissiveIntensity: 0.65 });
  // --- plaza, podium and grand stair
  add(root, geo.box(3.84, 0.08, 3.84), granite, [0, 0.04, 0]);
  add(root, mergedBoxes('capPaving', [-1.2, -0.4, 0.4, 1.2].map((x) => [0.03, 0.006, 0.8, x, 0.083, 1.48])), concD);
  add(root, geo.box(3.56, 0.22, 2.9), concL, [0, 0.19, -0.43]);
  add(root, geo.box(3.58, 0.03, 2.92), concD, [0, 0.29, -0.43]);
  for (let i = 0; i < 3; i++) add(root, geo.box(1.8, 0.22 - (i + 1) * 0.055, 0.12), concL, [0, 0.08 + (0.22 - (i + 1) * 0.055) / 2, 1.08 + i * 0.12]);
  const b = 0.3;
  // --- main block (x +-1.65, z -1.8..0.3) with ribbon windows on the sides and back
  add(root, geo.box(3.3, 1.42, 2.1), conc, [0, b + 0.71, -0.75]);
  const ribbons = [];
  for (const y of [b + 0.42, b + 1.0]) {
    ribbons.push([0.03, 0.3, 1.9, 1.65, y, -0.75], [0.03, 0.3, 1.9, -1.65, y, -0.75], [3.1, 0.3, 0.03, 0, y, -1.8]);
  }
  add(root, mergedBoxes('capRibbons', ribbons), glassD);
  const fins = [];
  for (const y of [b + 0.42, b + 1.0]) {
    for (let i = 0; i < 7; i++) fins.push([0.05, 0.32, 0.04, 1.665, y, -1.6 + i * 0.28], [0.05, 0.32, 0.04, -1.665, y, -1.6 + i * 0.28]);
    for (let i = 0; i < 11; i++) fins.push([0.04, 0.32, 0.05, -1.5 + i * 0.3, y, -1.815]);
  }
  add(root, mergedBoxes('capFins', fins), concD);
  // front glass curtain wall + entrance
  curtainWall(root, 'capFront', 0, b, 0.31, 3.1, 1.36, { cols: 12, rows: 3 });
  add(root, geo.box(0.62, 0.56, 0.03), glassD, [0, b + 0.28, 0.34]);
  add(root, geo.box(0.7, 0.05, 0.05), steel, [0, b + 0.585, 0.35]);
  add(root, mergedBoxes('capLitLow', [[0.22, 0.36, 0.01, -1.04, b + 0.95, 0.34], [0.22, 0.36, 0.01, 0.78, b + 0.5, 0.34], [0.22, 0.36, 0.01, 1.3, b + 0.95, 0.34]]), lit);
  // colonnade + cantilevered roof slab with the team frieze and a gold seal
  const cols = [];
  for (let i = 0; i < 8; i++) cols.push([0.075, 0.075, 1.42, -1.47 + i * 0.42, b + 0.71, 0.7, 0, 0, 8]);
  add(root, mergedCyls('capColumns', cols), concL);
  add(root, mergedBoxes('capColumnFeet', cols.map(([, , , x]) => [0.17, 0.06, 0.17, x, b + 0.03, 0.7])), concD);
  add(root, geo.box(3.4, 0.08, 0.5), concL, [0, b + 0.02, 0.56]); // porch floor
  add(root, geo.box(3.42, 0.17, 2.66), conc, [0, b + 1.505, -0.5]);
  add(root, geo.box(3.44, 0.07, 2.68), team, [0, b + 1.505, -0.5]);
  add(root, geo.cyl(0.17, 0.17, 0.03, 16), gold, [0, b + 1.5, 0.84], [HALF_PI, 0, 0]);
  add(root, geo.cyl(0.11, 0.11, 0.035, 16), team, [0, b + 1.5, 0.848], [HALF_PI, 0, 0]);
  for (const x of [-0.84, 0.84]) banner(root, x, b + 1.38, 0.72, tc, { w: 0.26, h: 0.82, trim: C.mullion, emblem: P.gold });
  const top = b + 1.59; // roof level of the base
  add(root, mergedBoxes('capParapet', [[3.42, 0.08, 0.06, 0, 0.04, 0.8], [3.42, 0.08, 0.06, 0, 0.04, -1.8], [0.06, 0.08, 2.6, 1.68, 0.04, -0.5], [0.06, 0.08, 2.6, -1.68, 0.04, -0.5]]), concD, [0, top, 0]);
  add(root, geo.box(3.3, 0.012, 2.54), mat(0x9a978f), [0, top + 0.006, -0.5]); // roof membrane
  // glass dome over the entrance hall, in front of the tower: drum, team ring, ribs, lantern
  const dz = 0.2, DR = 0.5, DH = 0.46;
  add(root, geo.cyl(DR + 0.04, DR + 0.06, 0.18, 16), concL, [0, top + 0.09, dz]);
  add(root, geo.cyl(DR + 0.055, DR + 0.055, 0.05, 16), team, [0, top + 0.15, dz]);
  add(root, geo.custom('mod-dome14', () => new THREE.SphereGeometry(1, 14, 5, 0, Math.PI * 2, 0, HALF_PI)), mat(C.glassB), [0, top + 0.18, dz], null, [DR, DH, DR]);
  add(root, geo.custom('mod-domeRibs', () => {
    const parts = [0, 1, 2, 3].map((k) => new THREE.TorusGeometry(1, 0.045, 3, 8, Math.PI).rotateY((k * Math.PI) / 4));
    const g = mergeGeometries(parts, false);
    for (const q of parts) q.dispose();
    return g;
  }), mat(C.concL), [0, top + 0.18, dz], null, [DR + 0.008, DH + 0.008, DR + 0.008]);
  add(root, geo.cyl(0.07, 0.08, 0.1, 8), concL, [0, top + 0.18 + DH + 0.04, dz]);
  add(root, geo.sphere(0.055, 8, 6), gold, [0, top + 0.18 + DH + 0.13, dz]);
  // roof: HVAC units, skylights
  for (const s of [1, -1]) {
    add(root, geo.box(0.42, 0.18, 0.34), steel, [s * 1.2, top + 0.09, -1.3]);
    add(root, mergedCyls('capFans', [[0.08, 0.08, 0.02, -0.1, 0.19, 0, 0, 0, 10], [0.08, 0.08, 0.02, 0.1, 0.19, 0, 0, 0, 10]]), mat(C.black), [s * 1.2, top, -1.3]);
    add(root, geo.box(0.5, 0.06, 0.7), glassD, [s * 1.2, top + 0.03, -0.25]);
    add(root, mergedBoxes('capSkyBars', [-0.15, 0, 0.15].map((x) => [0.025, 0.07, 0.72, x, 0, 0])), steel, [s * 1.2, top + 0.035, -0.25]);
  }
  // --- central glass tower with concrete frame, floor bands and a few lit offices
  const tzc = -1.0, TW = 1.3, TD = 1.2, ty0 = top, TH = 2.62;
  add(root, geo.box(TW, TH, TD), mat(C.glassB), [0, ty0 + TH / 2, tzc]);
  const frame = [];
  for (const sx of [1, -1]) for (const sz of [1, -1]) frame.push([0.16, TH + 0.04, 0.16, sx * (TW / 2), TH / 2, sz * (TD / 2)]);
  for (let k = 1; k <= 5; k++) frame.push([TW + 0.06, 0.06, TD + 0.06, 0, (TH * k) / 6, 0]);
  add(root, mergedBoxes('capTowerFrame', frame), concL, [0, ty0, tzc]);
  const mull = [];
  for (let i = 1; i < 6; i++) {
    const u = -TW / 2 + (TW * i) / 6;
    mull.push([0.03, TH, 0.03, u, TH / 2, TD / 2 + 0.01], [0.03, TH, 0.03, u, TH / 2, -TD / 2 - 0.01]);
    mull.push([0.03, TH, 0.03, TW / 2 + 0.01, TH / 2, u], [0.03, TH, 0.03, -TW / 2 - 0.01, TH / 2, u]);
  }
  add(root, mergedBoxes('capTowerMullions', mull), mat(C.mullion), [0, ty0, tzc]);
  const fl = TH / 6, litW = [];
  for (const [i, k] of [[1, 1], [4, 2], [2, 4], [5, 3], [0, 5]]) litW.push([TW / 6 - 0.04, fl - 0.1, 0.01, -TW / 2 + (TW * (i + 0.5)) / 6, fl * (k + 0.5), TD / 2 + 0.005]);
  for (const [i, k] of [[2, 1], [4, 3], [1, 4]]) litW.push([0.01, fl - 0.1, TD / 6 - 0.04, TW / 2 + 0.005, fl * (k + 0.5), -TD / 2 + (TD * (i + 0.5)) / 6]);
  add(root, mergedBoxes('capTowerLit', litW), lit, [0, ty0, tzc]);
  // crown with team band, helipad, antenna mast, team flag
  const cy = ty0 + TH;
  add(root, geo.box(TW + 0.14, 0.14, TD + 0.14), concL, [0, cy + 0.07, tzc]);
  add(root, geo.box(TW + 0.16, 0.06, TD + 0.16), team, [0, cy + 0.07, tzc]);
  add(root, geo.box(TW - 0.02, 0.04, TD - 0.02), mat(0x4a4d52), [0, cy + 0.16, tzc]);
  const pad = grp(root, 0, cy + 0.181, tzc);
  add(pad, geo.ring(0.42, 0.48, 24), mat(C.hazard), [0, 0.001, 0], [-HALF_PI, 0, 0]);
  add(pad, mergedBoxes('capHeliH', [[0.08, 0.008, 0.42, -0.13, 0, 0], [0.08, 0.008, 0.42, 0.13, 0, 0], [0.2, 0.008, 0.08, 0, 0, 0]]), mat(0xf4f4f0));
  const corners = [];
  for (const sx of [1, -1]) for (const sz of [1, -1]) corners.push([0.05, 0.03, 0.05, sx * 0.6, 0.01, sz * 0.6]);
  add(pad, mergedBoxes('capPadLights', corners), mat(0x9fe07a, { emissive: 0x6fd040, emissiveIntensity: 0.6 }));
  const ax = 0.56, az = tzc - 0.56, AH = 5.5 - cy - 0.2;
  const mast = [];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) mast.push([[sx * 0.06, 0, sz * 0.06], [sx * 0.015, AH, sz * 0.015], 0.025]);
  for (let k = 1; k < 5; k++) {
    const t = k / 5, h = 0.06 + (0.015 - 0.06) * t;
    mast.push([[h, AH * t, h], [-h, AH * t, -h], 0.015], [[-h, AH * t, h], [h, AH * t, -h], 0.015]);
  }
  add(root, mergedBeams('capMast', mast), mat(0xd8dde2), [ax, cy + 0.14, az]);
  const beacon = add(root, geo.sphere(0.04, 8, 6), glowMat(0xff2a1a, 1.2), [ax, cy + 0.16 + AH, az]);
  beacon.castShadow = false;
  flag(root, -0.58, cy + 0.14, tzc - 0.58, tc, { pole: 0.75, w: 0.5, h: 0.3, dir: -1, poleColor: 0xd8dde2, finial: P.gold, poleR: 0.02 });
  // --- plaza: flagpoles, planters with trees, bollards
  for (const s of [1, -1]) {
    flag(root, s * 1.5, 0.08, 1.58, tc, { pole: 2.0, w: 0.62, h: 0.38, dir: -s, poleColor: 0xd8dde2, finial: P.gold, poleR: 0.025 });
    add(root, geo.box(0.36, 0.06, 0.36), concD, [s * 1.5, 0.11, 1.58]);
    add(root, geo.box(0.5, 0.18, 0.3), concD, [s * 0.75, 0.17, 1.6]);
    add(root, geo.box(0.46, 0.04, 0.26), mat(0x4a7a2a), [s * 0.75, 0.27, 1.6]);
    add(root, geo.ico(0.2, 0), mat(P.leaf), [s * 0.75, 0.48, 1.6]);
    add(root, geo.cyl(0.025, 0.03, 0.2, 5), mat(P.woodDark), [s * 0.75, 0.34, 1.6]);
  }
  return { root, parts: { glow: [beacon] }, height: 5.5, radius: 1.95 };
}

// Modern apartment block: four concrete floors with ribbon windows, team-panelled balconies, lit flats,
// entrance with a team awning, rooftop AC units, stair housing, TV antenna and a satellite dish.
export function house_mod(tc) {
  const root = new THREE.Group();
  const conc = mat(0xd9d4c8), concD = mat(0xaaa59b), concL = mat(0xe8e5dd), team = mat(tc), glass = mat(0x2d3b4c);
  const steel = mat(C.steel), lit = mat(C.lit, { emissive: 0xffb84a, emissiveIntensity: 0.65 }), black = mat(C.black);
  add(root, geo.box(1.92, 0.05, 1.92), mat(0xb4b1a8), [0, 0.025, 0]); // pavement
  const W = 1.6, D = 1.34, z0 = -0.2, FH = 0.72, b = 0.05;
  const zf = z0 + D / 2; // front face
  add(root, geo.box(W, FH * 4 + 0.02, D), conc, [0, b + (FH * 4 + 0.02) / 2, z0]);
  // floor slab bands (wrap around)
  add(root, mergedBoxes('hmSlabs', [1, 2, 3].map((k) => [W + 0.04, 0.07, D + 0.04, 0, b + FH * k, 0])), concD, [0, 0, z0]);
  // ribbon windows on the sides and the back (floors 1..3), ground floor small windows
  const win = [], winLit = [];
  for (let k = 1; k <= 3; k++) {
    const y = b + FH * k + FH * 0.5;
    win.push([0.03, 0.3, D - 0.3, W / 2, y, 0], [0.03, 0.3, D - 0.3, -W / 2, y, 0], [W - 0.3, 0.3, 0.03, 0, y, -D / 2]);
  }
  win.push([0.03, 0.26, 0.4, W / 2, b + 0.4, -0.25], [0.03, 0.26, 0.4, -W / 2, b + 0.4, -0.25], [0.5, 0.26, 0.03, -0.35, b + 0.4, -D / 2], [0.5, 0.26, 0.03, 0.35, b + 0.4, -D / 2]);
  add(root, mergedBoxes('hmWindows', win), glass, [0, 0, z0]);
  const mull = [];
  for (let k = 1; k <= 3; k++) {
    const y = b + FH * k + FH * 0.5;
    for (let i = 0; i <= 4; i++) {
      const u = -(D - 0.3) / 2 + ((D - 0.3) * i) / 4;
      mull.push([0.05, 0.32, 0.035, W / 2 + 0.005, y, u], [0.05, 0.32, 0.035, -W / 2 - 0.005, y, u]);
      const v = -(W - 0.3) / 2 + ((W - 0.3) * i) / 4;
      mull.push([0.035, 0.32, 0.05, v, y, -D / 2 - 0.005]);
    }
    mull.push([0.05, 0.035, D - 0.28, W / 2 + 0.005, y - 0.165, 0], [0.05, 0.035, D - 0.28, -W / 2 - 0.005, y - 0.165, 0], [W - 0.28, 0.035, 0.05, 0, y - 0.165, -D / 2 - 0.005]);
  }
  add(root, mergedBoxes('hmMullions', mull), concL, [0, 0, z0]);
  for (const [x, y, z, w, d] of [[W / 2 + 0.017, 1, 0.2, 0.01, 0.2], [-W / 2 - 0.017, 2, -0.22, 0.01, 0.2], [0.3, 3, -D / 2 - 0.017, 0.24, 0.01], [-0.42, 1, -D / 2 - 0.017, 0.24, 0.01], [-W / 2 - 0.017, 3, 0.36, 0.01, 0.2]]) {
    winLit.push([w, 0.26, d, x, b + FH * y + FH * 0.5, z]);
  }
  add(root, mergedBoxes('hmLitSides', winLit), lit, [0, 0, z0]);
  // outdoor AC units hanging on the sides
  add(root, mergedBoxes('hmWallAC', [[0.1, 0.12, 0.2, W / 2 + 0.05, b + FH * 2 + 0.12, -0.3], [0.1, 0.12, 0.2, -W / 2 - 0.05, b + FH + 0.12, 0.25], [0.1, 0.12, 0.2, W / 2 + 0.05, b + FH * 3 + 0.12, 0.3]]), mat(0xe2e2dc), [0, 0, z0]);
  // front: balcony doors (glass) + two balconies per upper floor with team parapet panels
  const front = [], frontLit = [], slabs = [], panels = [], rails = [];
  for (let k = 1; k <= 3; k++) {
    const y = b + FH * k;
    for (const s of [1, -1]) {
      const x = s * 0.4;
      const isLit = (k === 1 && s < 0) || (k === 3 && s > 0) || (k === 2 && s > 0);
      (isLit ? frontLit : front).push([0.56, 0.5, 0.03, x, y + 0.3, zf]);
      slabs.push([0.66, 0.06, 0.3, x, y + 0.03, zf + 0.15]);
      panels.push([0.66, 0.24, 0.03, x, y + 0.18, zf + 0.29]);
      panels.push([0.03, 0.24, 0.28, x + 0.315, y + 0.18, zf + 0.15], [0.03, 0.24, 0.28, x - 0.315, y + 0.18, zf + 0.15]);
      rails.push([0.68, 0.03, 0.04, x, y + 0.32, zf + 0.29]);
    }
  }
  add(root, mergedBoxes('hmFrontGlass', front), glass);
  add(root, mergedBoxes('hmFrontLit', frontLit), lit);
  add(root, mergedBoxes('hmBalconySlabs', slabs), concL);
  add(root, mergedBoxes('hmBalconyPanels', panels), team);
  add(root, mergedBoxes('hmBalconyRails', rails), steel);
  add(root, mergedBoxes('hmFrontPiers', [[0.08, FH * 3, 0.06, 0, b + FH * 2.5, zf + 0.01], [0.08, FH * 3, 0.06, 0.78, b + FH * 2.5, zf + 0.01], [0.08, FH * 3, 0.06, -0.78, b + FH * 2.5, zf + 0.01]]), concD);
  // ground floor: entrance door + awning, shop window + awning, number plate, planters
  add(root, geo.box(0.36, 0.5, 0.03), glass, [0.4, b + 0.25, zf + 0.005]);
  add(root, geo.box(0.04, 0.5, 0.04), steel, [0.4, b + 0.25, zf + 0.02]);
  add(root, geo.box(0.6, 0.36, 0.03), mat(0x45627c), [-0.38, b + 0.32, zf + 0.005]);
  add(root, mergedBoxes('hmShopLit', [[0.24, 0.3, 0.01, -0.5, b + 0.32, zf + 0.022]]), lit);
  for (const [x, w] of [[0.4, 0.56], [-0.38, 0.72]]) {
    const aw = grp(root, x, b + 0.62, zf + 0.13);
    aw.rotation.x = 0.35;
    add(aw, geo.box(w, 0.03, 0.28), team);
    add(aw, geo.box(w, 0.07, 0.02), team, [0, -0.03, 0.14]);
  }
  add(root, geo.box(0.6, 0.04, 0.24), concL, [0.4, b + 0.02, zf + 0.12]); // step
  add(root, mergedBoxes('hmPlanters', [[0.28, 0.14, 0.18, -0.72, b + 0.07, 0.86], [0.28, 0.14, 0.18, 0.78, b + 0.07, 0.86]]), concD);
  add(root, mergedBoxes('hmShrubs', [[0.24, 0.12, 0.14, -0.72, b + 0.19, 0.86], [0.24, 0.12, 0.14, 0.78, b + 0.19, 0.86]]), mat(P.leaf));
  // roof: parapet, gravel, AC units, stair housing, antenna, satellite dish, team trim
  const ry = b + FH * 4 + 0.02;
  add(root, mergedBoxes('hmParapet', [[W, 0.1, 0.06, 0, 0.05, D / 2 - 0.03], [W, 0.1, 0.06, 0, 0.05, -D / 2 + 0.03], [0.06, 0.1, D - 0.12, W / 2 - 0.03, 0.05, 0], [0.06, 0.1, D - 0.12, -W / 2 + 0.03, 0.05, 0]]), concL, [0, ry, z0]);
  add(root, mergedBoxes('hmParapetTrim', [[W + 0.01, 0.03, 0.07, 0, 0.1, D / 2 - 0.03], [W + 0.01, 0.03, 0.07, 0, 0.1, -D / 2 + 0.03], [0.07, 0.03, D - 0.12, W / 2 - 0.03, 0.1, 0], [0.07, 0.03, D - 0.12, -W / 2 + 0.03, 0.1, 0]]), team, [0, ry, z0]);
  add(root, geo.box(W - 0.12, 0.012, D - 0.12), mat(0x8e8a82), [0, ry + 0.006, z0]);
  add(root, geo.box(0.46, 0.34, 0.42), concL, [-0.48, ry + 0.17, z0 - 0.38]); // stair housing
  add(root, geo.box(0.5, 0.04, 0.46), concD, [-0.48, ry + 0.36, z0 - 0.38]);
  add(root, geo.box(0.2, 0.26, 0.02), mat(0x5a5048), [-0.48, ry + 0.13, z0 - 0.165]);
  for (const [x, z] of [[0.35, -0.42], [0.35, 0.02]]) {
    add(root, geo.box(0.32, 0.18, 0.28), mat(0xe2e2dc), [x, ry + 0.09, z0 + z]);
    add(root, geo.cyl(0.09, 0.09, 0.02, 10), black, [x, ry + 0.185, z0 + z]);
    add(root, mergedBoxes('hmFanBlade', [[0.16, 0.01, 0.03, 0, 0, 0], [0.03, 0.01, 0.16, 0, 0, 0]]), steel, [x, ry + 0.195, z0 + z]);
  }
  // TV antenna and satellite dish
  const tx = -0.62, tz = z0 + 0.25;
  add(root, geo.cyl(0.012, 0.015, 3.4 - ry, 5), steel, [tx, ry + (3.4 - ry) / 2, tz]);
  add(root, mergedBoxes('hmAntennaBars', [[0.34, 0.012, 0.012, 0, 0, 0], [0.26, 0.012, 0.012, 0, 0.1, 0], [0.18, 0.012, 0.012, 0, 0.2, 0]]), steel, [tx, 3.05, tz]);
  const sd = grp(root, 0.0, ry + 0.06, z0 + 0.45);
  add(sd, geo.box(0.03, 0.12, 0.03), steel, [0, 0.0, 0]);
  const dsh = grp(sd, 0, 0.1, 0.0);
  dsh.rotation.set(-0.5, 0.4, 0);
  add(dsh, dishGeo(0.11, 0.6), mat(0xeeeeea, { side: THREE.DoubleSide }));
  add(dsh, geo.box(0.015, 0.015, 0.12), steel, [0, -0.04, 0.06], [0.5, 0, 0]);
  return { root, parts: {}, height: 3.4, radius: 0.95 };
}
