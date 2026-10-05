// Digital Age (2030s-2050s): railgun infantry, quad-rotor combat drones, a faceted stealth tank, the Digital
// Hub smart-city tower (town center), a modular smart-home stack and the late Research Center (research_3,
// used from the Digital to the Galactic Age).
// Look: dark composite panels with white / grey accents, blue LED light and team-colored panels: a step
// beyond the Modern Age's camo and concrete, but not yet the Future Age's white-and-cyan sci-fi.
//
// Same conventions as the other builders: origin at ground center, facing +Z, weapon hand on -X, team color
// via mat(teamColor), cached geo/mat, everything casts shadows (add()).
// - parts.glow meshes pulse in scale (+-8%) about their own origin, so every glow piece is small or sits
//   proud of whatever is behind it (the tower's LED ledges overhang their floor slabs).
// - Shooters rest with their barrels level along +Z (weapon.rotation = 0). Each barrel tip carries an empty
//   Object3D named 'muzzle' inside parts.weapon; rest positions in model space are listed in MUZZLE.
import {
  THREE, mat, geo, P, CG, glowMat, grp, add, beam, rod, rig, scaled, legMesh, mergedBoxes,
} from './common.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;

/** Rest muzzle positions in model space (origin at ground center, facing +Z), measured from the built models. */
export const MUZZLE = {
  railgunner: [-0.116, 0.761, 1.071],
  combat_drone: [0, 0.865, 0.56],
  stealth_tank: [0, 0.74, 1.88],
};

/** Digital palette. */
const C = {
  comp: 0x30353d, // dark composite panels
  compM: 0x474e58,
  compD: 0x1f2328,
  grey: 0x8c95a0,
  pearl: 0xc8cfd7,
  white: 0xe8ecf0,
  visor: 0x121a24,
  boot: 0x23262b,
  track: 0x25282c,
  led: 0x3a8cff, // blue LED
  ledL: 0x9cc6ff,
  glass: 0x7aaed6, // gleaming tower glass
  glassB: 0x5d93c2,
  glassD: 0x2b4a68,
  lit: 0xffd27a,
  green: 0x5a9a36,
  greenD: 0x3f7d28,
  solar: 0x1c335e,
  pave: 0xbcc3cb,
  red: 0xff2a1a,
};

/** The shared material set of a team. */
function mats(tc) {
  return {
    comp: mat(C.comp), compM: mat(C.compM), compD: mat(C.compD), grey: mat(C.grey), pearl: mat(C.pearl),
    white: mat(C.white), visor: mat(C.visor), boot: mat(C.boot), team: mat(tc),
    led: glowMat(C.led, 1.25), // pulsing LED (parts.glow)
    ledS: mat(C.ledL, { emissive: C.led, emissiveIntensity: 0.9 }), // static LED (merged)
    lit: mat(C.lit, { emissive: 0xffb84a, emissiveIntensity: 0.65 }), // warm lit windows
  };
}

// ===========================================================================
// Geometry helpers (copied / adapted from era_modern.js and era_future.js)
// ===========================================================================

/** Empty marker at a barrel tip (tracers / muzzle flashes start here). */
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
  g.castShadow = false;
  list.push(g);
  return g;
}

/** Cached merged cylinders: [[rTop, rBot, h, x, y, z, rx = 0, rz = 0, seg = 8], ...]. */
function mergedCyls(key, list) {
  return geo.custom(`dig-cyl:${key}`, () => {
    const parts = list.map(([rt, rb, h, x, y, z, rx = 0, rz = 0, seg = 8]) => {
      const g = new THREE.CylinderGeometry(rt, rb, h, seg);
      if (rz) g.rotateZ(rz);
      if (rx) g.rotateX(rx);
      g.translate(x, y, z);
      return g.index ? g.toNonIndexed() : g;
    });
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

/**
 * Cached convex loft: rings = [[y, [[x, z], ...]], ...] (same vertex count, convex, ordered around).
 * Side quads join consecutive rings; the first and last rings are capped. Used for faceted armor.
 */
function loftGeo(key, rings) {
  return geo.custom(`dig-loft:${key}`, () => {
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
 * +X to the right as seen from outside, +Y up the face, +Z out of the face. For decals and lights.
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
 * Cached extrusion of a side profile drawn in the (z, y) plane, extruded symmetrically along X to `width`.
 * `holes` = lists of points; `bevel` chamfers the edges inside the profile.
 */
function profileX(key, pts, width, { holes = [], curve = 4, bevel = 0 } = {}) {
  return geo.custom(`dig-prof:${key}`, () => {
    const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    for (const h of holes) s.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y))));
    const depth = width - 2 * bevel;
    const g = new THREE.ExtrudeGeometry(s, bevel
      ? { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, curveSegments: curve }
      : { depth, bevelEnabled: false, curveSegments: curve });
    g.translate(0, 0, -depth / 2);
    g.rotateY(-HALF_PI); // shape x -> world z, extrusion -> world x
    return g;
  });
}

/** Cached wheel along X built from cylinders/boxes (one geometry -> one draw call per wheel). */
function wheelGeo(key, list) {
  return geo.custom(`dig-wheel:${key}`, () => {
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
      return g.index ? g.toNonIndexed() : g;
    });
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

/** Rounded-rectangle slab w x d, corner radius r, from y = 0 to y = h. */
function roundSlab(w, d, h, r, seg = 3) {
  return geo.custom(`dig-rslab:${w},${d},${h},${r},${seg}`, () => {
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

/** Solid of revolution from a closed counter-clockwise (r, y) profile (faces point outward). */
function lathe(key, pts, segs = 24, phiStart = 0, phiLen = TAU) {
  return geo.custom(`dig-lathe:${key}`, () => {
    const v = pts.map(([r, y]) => new THREE.Vector2(r, y));
    if (!v[0].equals(v[v.length - 1])) v.push(v[0].clone());
    return new THREE.LatheGeometry(v, segs, phiStart, phiLen);
  });
}

/** Flat annulus ring (rIn..rOut), base at y = 0, height h. */
const annulus = (rIn, rOut, h, segs = 24) => lathe(`ann${rIn},${rOut},${h},${segs}`, [[rIn, 0], [rOut, 0], [rOut, h], [rIn, h]], segs);

/**
 * Cached swept solid: a convex closed profile [[r, y], ...] revolved from phi0 over phiLen (phi = 0 at +Z,
 * like LatheGeometry) in `segs` steps, with both ends capped. Curved building wings, window bands.
 * `arcs` (optional) = [[phi0, phiLen, segs], ...] merges several such pieces into one geometry.
 */
function sweepGeo(key, prof, arcs) {
  return geo.custom(`dig-sweep:${key}`, () => {
    const pos = [];
    const n = prof.length;
    const cr = prof.reduce((s, p) => s + p[0], 0) / n, cy = prof.reduce((s, p) => s + p[1], 0) / n;
    const Pt = (p, a) => new THREE.Vector3(p[0] * Math.sin(a), p[1], p[0] * Math.cos(a));
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const tri = (a, b, c, ref) => {
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      if (e1.cross(e2).dot(ref) < 0) [b, c] = [c, b];
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    };
    for (const [phi0, phiLen, segs] of arcs) {
      for (let s = 0; s < segs; s++) {
        const a0 = phi0 + (phiLen * s) / segs, a1 = phi0 + (phiLen * (s + 1)) / segs, am = (a0 + a1) / 2;
        for (let i = 0; i < n; i++) {
          const p = prof[i], q = prof[(i + 1) % n];
          const nr = (p[0] + q[0]) / 2 - cr, ny = (p[1] + q[1]) / 2 - cy;
          const ref = new THREE.Vector3(nr * Math.sin(am), ny, nr * Math.cos(am));
          const A = Pt(p, a0), B = Pt(q, a0), Cc = Pt(q, a1), D = Pt(p, a1);
          tri(A, B, Cc, ref);
          tri(A, Cc, D, ref);
        }
      }
      for (const [a, dir] of [[phi0, -1], [phi0 + phiLen, 1]]) {
        const ref = new THREE.Vector3(Math.cos(a) * dir, 0, -Math.sin(a) * dir);
        for (let i = 1; i + 1 < n; i++) tri(Pt(prof[0], a), Pt(prof[i], a), Pt(prof[i + 1], a), ref);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });
}

/** Cached shallow dish (spherical cap) whose concave side faces +Z. Render double-sided. */
function dishGeo(r, depth = 0.6) {
  return geo.custom(`dig-dish:${r},${depth}`, () => {
    const R = r / Math.sin(depth);
    const g = new THREE.SphereGeometry(R, 12, 3, 0, Math.PI * 2, 0, depth);
    g.translate(0, -R * Math.cos(depth), 0);
    g.rotateX(-HALF_PI);
    return g;
  });
}

/** Upper hemisphere (dome), radius 1, base at y = 0. */
const hemi = (ws = 16, hs = 6) => geo.custom(`dig:hemi${ws},${hs}`, () => new THREE.SphereGeometry(1, ws, hs, 0, TAU, 0, HALF_PI));

/** Small quad-rotor drone (static prop), ~0.36 across, origin under its body. */
function miniDrone(parent, x, y, z, ry, m) {
  const g = grp(parent, x, y, z, ry);
  add(g, geo.box(0.12, 0.05, 0.16), m.comp, [0, 0.045, 0]);
  add(g, geo.box(0.1, 0.02, 0.12), m.team, [0, 0.075, 0]);
  add(g, mergedBoxes('dgMiniArms', [[0.3, 0.02, 0.025, 0, 0, 0, Math.PI / 4], [0.3, 0.02, 0.025, 0, 0, 0, -Math.PI / 4]]), m.compM, [0, 0.05, 0]);
  add(g, mergedCyls('dgMiniRotors', [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([sx, sz]) => [0.06, 0.06, 0.01, sx * 0.106, 0, sz * 0.106, 0, 0, 8])), m.grey, [0, 0.07, 0]);
  add(g, mergedBoxes('dgMiniSkids', [[0.015, 0.025, 0.16, 0.05, 0.012, 0], [0.015, 0.025, 0.16, -0.05, 0.012, 0]]), m.compD);
  add(g, geo.box(0.04, 0.02, 0.01), m.ledS, [0, 0.045, 0.082]);
  return g;
}

// ===========================================================================
// Units
// ===========================================================================

const SOLDIER = { L: 0.4, hipW: 0.085, shoulderX: 0.215, shoulderY: 0.36, neckY: 0.44 };

/** Armored-fatigue leg: digital-camo trousers, white thigh + shin plates, team knee guard, boots. */
function trooperLeg(lg, L, s, m) {
  legMesh(lg, L, 0.1, m.compM, m.boot, { bootH: 0.42, toe: 0.28 });
  add(lg, mergedBoxes('dgLegPix', [[0.104, 0.035, 0.035, 0, -0.05, 0.025], [0.104, 0.03, 0.04, 0, -0.17, -0.025], [0.036, 0.03, 0.108, 0.02, -0.11, 0]]), m.comp);
  add(lg, geo.box(0.106, 0.1, 0.035), m.pearl, [0, -0.1, 0.048], [-0.06, 0, 0]); // thigh plate
  add(lg, geo.box(0.036, 0.08, 0.075), m.comp, [s * 0.06, -0.14, -0.005]); // thigh pocket
  add(lg, geo.box(0.11, 0.075, 0.045), m.team, [0, -L * 0.6, 0.058], [-0.12, 0, 0]); // knee guard
  add(lg, geo.box(0.098, 0.1, 0.03), m.pearl, [0, -L * 0.79, 0.104]); // shin plate
}

/** Sleeve + glove limb between shoulder S, elbow E and hand H (team armband, white bracer). */
function trooperArm(g, S, E, H, m) {
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  add(g, geo.sphere(0.05, 6, 4), m.compM, S, null, [1, 0.9, 1]);
  beam(g, S, E, 0.072, m.compM);
  beam(g, lerp(S, E, 0.15), lerp(S, E, 0.6), 0.088, m.team);
  add(g, geo.sphere(0.043, 5, 4), m.comp, E);
  beam(g, E, H, 0.068, m.compM);
  beam(g, lerp(E, H, 0.22), lerp(E, H, 0.74), 0.08, m.pearl);
  add(g, geo.sphere(0.04, 5, 4), m.compD, H);
}

/**
 * Railgun built along +Z from the butt plate (bore axis at y = 0): capacitor housing with a team band,
 * smart scope, twin side rails with a glowing core between them and four blue coil rings. Muzzle at z = 1.02.
 */
function railgun(g, m, glow) {
  add(g, geo.box(0.038, 0.075, 0.16), m.comp, [0, -0.015, 0.07]); // stock
  add(g, geo.box(0.04, 0.026, 0.12), m.pearl, [0, 0.03, 0.08]); // cheek rest
  add(g, geo.box(0.062, 0.096, 0.3), m.compM, [0, 0, 0.3]); // capacitor housing
  add(g, geo.box(0.066, 0.026, 0.24), m.team, [0, 0.012, 0.31]); // team band
  add(g, geo.box(0.03, 0.075, 0.034), m.compD, [0, -0.08, 0.2], [0.3, 0, 0]); // pistol grip
  add(g, geo.box(0.048, 0.085, 0.07), m.compD, [0, -0.085, 0.34]); // power cell
  add(g, geo.box(0.05, 0.012, 0.072), m.ledS, [0, -0.07, 0.34]); // charge indicator
  add(g, geo.box(0.032, 0.042, 0.13), m.compD, [0, 0.07, 0.29]); // smart scope
  add(g, geo.box(0.026, 0.026, 0.01), m.ledS, [0, 0.07, 0.357]);
  add(g, mergedBoxes('dgRgRails', [[0.022, 0.06, 0.56, 0.031, 0, 0], [0.022, 0.06, 0.56, -0.031, 0, 0]]), m.compD, [0, 0, 0.72]);
  add(g, geo.box(0.06, 0.02, 0.5), m.comp, [0, -0.032, 0.7]); // spine under the rails
  glowAdd(glow, g, geo.box(0.02, 0.022, 0.5), m.led, [0, 0.004, 0.72]); // charged core between the rails
  glowAdd(glow, g, mergedCyls('dgRgCoils', [-0.15, -0.05, 0.05, 0.15].map((z) => [0.05, 0.05, 0.024, 0, 0, z, HALF_PI, 0, 8])), m.led, [0, 0, 0.66]);
  add(g, geo.box(0.03, 0.06, 0.03), m.compD, [0, -0.065, 0.46]); // foregrip
  add(g, geo.box(0.08, 0.075, 0.04), m.compM, [0, 0, 0.995]); // muzzle frame
  add(g, geo.box(0.084, 0.02, 0.044), m.team, [0, 0.03, 0.995]);
  muzzle(g, 0, 0, 1.02);
}

// Railgunner: sleek armored fatigues in dark digital camo with white plates, team chest plate, knee guards,
// shoulder pads and armbands, a smart helmet with a glowing HUD visor and a long railgun held level at the
// ready (two-handed: parts.weapon carries both arms and the gun, pivoted at the right shoulder).
export function railgunner(tc) {
  const { L } = SOLDIER;
  const r = rig({ legLen: L, hipW: SOLDIER.hipW, shoulderX: SOLDIER.shoulderX, shoulderY: SOLDIER.shoulderY, neckY: SOLDIER.neckY, legAmp: 0.55 });
  const m = mats(tc);
  const glow = [];
  r.legs.forEach((l, i) => trooperLeg(l.obj, L, i === 0 ? 1 : -1, m));
  // hips, belt, torso, armored vest with a team chest plate and a static LED strip
  const b = r.body;
  add(b, CG.frustum(1.1), m.compM, [0, -0.02, 0], null, [0.25, 0.12, 0.18]);
  add(b, geo.box(0.27, 0.04, 0.195), m.compD, [0, 0.035, 0]);
  add(b, mergedBoxes('dgBeltPods', [[0.055, 0.06, 0.045, -0.095, 0, 0.095], [0.055, 0.06, 0.045, 0.095, 0, 0.095], [0.07, 0.07, 0.05, 0.11, 0, -0.08]]), m.comp, [0, 0.03, 0]);
  add(b, CG.frustum(1.28), m.compM, [0, 0.2, 0], null, [0.24, 0.32, 0.17]);
  add(b, CG.frustum(1.12), m.comp, [0, 0.235, 0], null, [0.29, 0.25, 0.235]);
  add(b, geo.box(0.17, 0.12, 0.025), m.team, [0, 0.27, 0.137], [-0.06, 0, 0]);
  add(b, geo.box(0.036, 0.122, 0.027), m.pearl, [0, 0.27, 0.138], [-0.06, 0, 0]);
  add(b, geo.box(0.12, 0.014, 0.012), m.ledS, [0, 0.18, 0.131]);
  add(b, CG.frustum(0.82), m.comp, [0, 0.385, 0], null, [0.2, 0.05, 0.16]);
  for (const s of [1, -1]) {
    add(b, geo.sphere(0.078, 8, 6), m.compM, [s * 0.235, 0.37, 0], null, [1.2, 0.78, 1.15]);
    add(b, geo.box(0.12, 0.028, 0.14), m.team, [s * 0.25, 0.425, 0], [0, 0, -s * 0.3]);
  }
  // slim power pack: team flap, blue cells, whip antenna
  add(b, geo.box(0.2, 0.24, 0.085), m.comp, [0, 0.235, -0.16]);
  add(b, geo.box(0.16, 0.05, 0.02), m.team, [0, 0.32, -0.205]);
  add(b, mergedBoxes('dgPackCells', [[0.03, 0.11, 0.012, -0.05, 0, 0], [0.03, 0.11, 0.012, 0.05, 0, 0]]), m.ledS, [0, 0.21, -0.203]);
  rod(b, [0.07, 0.35, -0.17], [0.085, 0.6, -0.2], 0.006, m.compD, 4);
  // smart helmet: dark shell, faceplate with the glowing HUD visor, team crest, sensor pods, helmet cam
  const h = r.head;
  add(h, geo.sphere(0.084, 8, 6), mat(P.skin), [0, 0.09, 0.012]);
  add(h, geo.sphere(0.106, 10, 7), m.comp, [0, 0.128, -0.012], null, [1.05, 0.86, 1.1]);
  add(h, geo.cyl(0.112, 0.118, 0.03, 10), m.compM, [0, 0.098, -0.012], null, [1, 1, 1.08]);
  add(h, geo.box(0.17, 0.085, 0.06), m.visor, [0, 0.1, 0.075]);
  glowAdd(glow, h, geo.box(0.16, 0.03, 0.02), m.led, [0, 0.112, 0.105]);
  add(h, geo.box(0.1, 0.04, 0.04), m.compM, [0, 0.048, 0.088]);
  add(h, geo.box(0.036, 0.03, 0.2), m.team, [0, 0.218, -0.02]);
  add(h, mergedBoxes('dgEarPods', [[0.03, 0.07, 0.08, 0.112, 0, 0], [0.03, 0.07, 0.08, -0.112, 0, 0]]), m.pearl, [0, 0.11, -0.01]);
  add(h, geo.box(0.03, 0.035, 0.05), m.compD, [-0.128, 0.13, 0.0]);
  add(h, geo.box(0.022, 0.022, 0.01), m.ledS, [-0.128, 0.13, 0.027]);
  rod(h, [0.118, 0.15, -0.04], [0.13, 0.28, -0.09], 0.005, m.compD, 4);
  // weapon group (pivot: right shoulder) carries both arms and the railgun, level along +Z
  const W = 2 * SOLDIER.shoulderX;
  const gun = grp(r.weapon, 0.105, -0.035, 0);
  railgun(gun, m, glow);
  trooperArm(r.weapon, [0, 0, 0], [-0.03, -0.15, 0.05], [0.105, -0.11, 0.2], m);
  trooperArm(r.weapon, [W, 0, 0], [0.33, -0.13, 0.18], [0.105, -0.1, 0.46], m);
  scaled(r, 1.05);
  return {
    root: r.root,
    parts: { body: r.body, head: r.head, legs: r.legs, weapon: r.weapon, glow },
    height: 1.18,
    radius: 0.4,
  };
}

// Combat drone: a quad-rotor gunship hovering ~1 above the ground. Faceted pod with a dark belly, white top
// shell and team spine panel, team arms out to four ducted rotors (parts.spin), blue LED strips (glow),
// sensor ball, landing skids, rocket pods and a chin gun turret (parts.weapon). The whole craft bobs.
export function combat_drone(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  const spin = [];
  const craft = grp(root, 0, 1.0, 0);
  // fuselage
  const P0 = [[0, 0.4], [0.17, 0.26], [0.22, -0.1], [0.13, -0.3], [-0.13, -0.3], [-0.22, -0.1], [-0.17, 0.26]];
  const ring = (y, sx, sz = sx) => [y, P0.map(([x, z]) => [x * sx, z * sz])];
  add(craft, loftGeo('dgDroneBelly', [ring(-0.11, 0.62, 0.7), ring(-0.02, 1)]), m.comp);
  add(craft, loftGeo('dgDroneShell', [ring(-0.02, 1), ring(0.06, 0.93, 0.95), ring(0.12, 0.6, 0.66)]), m.white);
  add(craft, loftGeo('dgDroneSpine', [ring(0.115, 0.5, 0.56), ring(0.132, 0.44, 0.5)]), m.team);
  add(craft, loftGeo('dgDroneSeam', [ring(-0.032, 1.015), ring(-0.012, 1.015)]), m.compD);
  // LED strips along the flanks (each its own mesh so the pulse stays on the hull)
  for (const s of [1, -1]) glowAdd(glow, craft, geo.box(0.022, 0.024, 0.34), m.led, [s * 0.198, -0.022, 0.08], [0, -s * 0.138, 0]);
  add(craft, mergedBoxes('dgDroneTail', [[0.2, 0.024, 0.02, 0, 0, 0]]), m.ledS, [0, -0.02, -0.305]);
  // sensor ball under the nose
  add(craft, geo.sphere(0.055, 8, 6), m.visor, [0, -0.06, 0.3]);
  add(craft, geo.box(0.03, 0.03, 0.012), m.ledS, [0, -0.06, 0.352]);
  // arms, motor pods, rotor ducts, rotors (spin)
  const RX = 0.38, RZ = 0.35, RY = 0.02;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    const x = sx * RX, z = sz * RZ;
    beam(craft, [sx * 0.13, 0.0, sz * 0.1], [x, RY, z], 0.075, m.team, 0.045);
    add(craft, geo.cyl(0.045, 0.05, 0.1, 8), m.compD, [x, RY - 0.02, z]);
    add(craft, annulus(0.175, 0.205, 0.075, 16), m.pearl, [x, RY - 0.045, z]);
    add(craft, annulus(0.2, 0.21, 0.03, 16), m.team, [x, RY - 0.01, z]);
    add(craft, mergedBoxes('dgDuctStruts', [[0.37, 0.014, 0.022, 0, 0, 0, Math.PI / 4], [0.37, 0.014, 0.022, 0, 0, 0, -Math.PI / 4]]), m.compD, [x, RY - 0.04, z]);
    const rot = grp(craft, x, RY + 0.035, z);
    add(rot, mergedBoxes('dgProp', [[0.33, 0.008, 0.045, 0, 0, 0, 0, 0.3], [0.33, 0.008, 0.045, 0, 0, 0, HALF_PI, 0.3]]), m.compD);
    add(rot, geo.cyl(0.022, 0.03, 0.03, 6), m.grey, [0, 0.01, 0]);
    spin.push(rot);
  }
  // landing skids + struts, rocket pods under the flanks
  for (const s of [1, -1]) {
    add(craft, geo.box(0.024, 0.024, 0.52), m.compD, [s * 0.17, -0.25, -0.01]);
    for (const z of [0.12, -0.13]) beam(craft, [s * 0.09, -0.09, z], [s * 0.17, -0.25, z], 0.02, m.compD);
    add(craft, geo.box(0.07, 0.07, 0.26), m.compM, [s * 0.24, -0.085, -0.02]);
    add(craft, geo.box(0.072, 0.025, 0.2), m.team, [s * 0.24, -0.045, -0.03]);
    add(craft, mergedCyls('dgDronePodTubes', [[0.018, 0.018, 0.02, -0.017, 0.015, 0, HALF_PI, 0, 6], [0.018, 0.018, 0.02, 0.017, 0.015, 0, HALF_PI, 0, 6], [0.018, 0.018, 0.02, -0.017, -0.017, 0, HALF_PI, 0, 6], [0.018, 0.018, 0.02, 0.017, -0.017, 0, HALF_PI, 0, 6]]), m.compD, [s * 0.24, -0.085, 0.112]);
  }
  // GPS puck + antenna
  add(craft, geo.cyl(0.035, 0.04, 0.02, 8), m.pearl, [0.05, 0.135, -0.14]);
  rod(craft, [-0.05, 0.12, -0.16], [-0.06, 0.45, -0.22], 0.006, m.compD, 4);
  add(craft, geo.sphere(0.015, 6, 4), m.ledS, [-0.06, 0.455, -0.22]);
  // chin gun turret (parts.weapon): ball mount with a short cannon, level along +Z
  add(craft, geo.cyl(0.05, 0.06, 0.05, 8), m.compD, [0, -0.11, 0.17]);
  const weapon = grp(craft, 0, -0.135, 0.17);
  add(weapon, geo.sphere(0.072, 8, 6), m.compM);
  add(weapon, geo.box(0.11, 0.06, 0.11), m.comp, [0, -0.005, 0.04]);
  add(weapon, geo.box(0.112, 0.02, 0.08), m.team, [0, 0.025, 0.04]);
  add(weapon, geo.cyl(0.022, 0.026, 0.28, 8), m.compD, [0, -0.005, 0.2], [HALF_PI, 0, 0]);
  add(weapon, geo.cyl(0.03, 0.03, 0.02, 8), m.ledS, [0, -0.005, 0.18], [HALF_PI, 0, 0]);
  add(weapon, geo.cyl(0.032, 0.032, 0.05, 8), m.comp, [0, -0.005, 0.355], [HALF_PI, 0, 0]);
  muzzle(weapon, 0, -0.005, 0.39);
  return { root, parts: { bob: [craft], spin, weapon, glow }, height: 1.5, radius: 0.6 };
}

// Stealth tank: low tracks (road wheels in parts.wheels) under a faceted hull of dark radar-absorbent panels
// with a sharp chine, team edge stripes, sawtooth deck panels, a faceted low turret with a team roof panel,
// sensor mast and APS sensors, and a long railgun (parts.weapon, pivot at the mantlet) with glowing coils.
export function stealth_tank(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  // --- running gear: track loops, road wheels, drive sprocket + idler
  const TX = 0.58, TW = 0.3, EZ = 1.0, EY = 0.19, RO = 0.17, RI = 0.125;
  const arc = (r, a0, a1, cz, n = 3) => Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cz + r * Math.cos(a), EY + r * Math.sin(a)];
  });
  const outer = [[-0.8, 0], [0.8, 0], ...arc(RO, -2.0, HALF_PI, EZ), ...arc(RO, HALF_PI, Math.PI + 1.14, -EZ)];
  const inner = [[-0.76, 0.045], [0.76, 0.045], ...arc(RI, -2.0, HALF_PI, EZ), ...arc(RI, HALF_PI, Math.PI + 1.14, -EZ)];
  const trackGeo = profileX('dgStealthTrack', outer, TW, { holes: [inner.reverse()], curve: 3 });
  const track = mat(C.track);
  for (const s of [1, -1]) add(root, trackGeo, track, [s * TX, 0, 0]);
  const roadWheel = wheelGeo('dgRoad', [['cyl', 0.12, 0.22, 0, 0, 0, 0, 0, 8], ['cyl', 0.055, 0.25, 0, 0, 0, 0, 0, 6]]);
  const sprocket = wheelGeo('dgSprocket', [['cyl', 0.11, 0.24, 0, 0, 0, 0, 0, 8], ['box', 0.26, 0.04, 0.22], ['box', 0.26, 0.22, 0.04]]);
  const wheels = [];
  for (const s of [1, -1]) {
    for (const z of [-0.66, -0.33, 0, 0.33, 0.66]) {
      const w = grp(root, s * TX, 0.165, z);
      add(w, roadWheel, m.compM);
      wheels.push(w);
    }
    for (const z of [-EZ, EZ]) {
      const w = grp(root, s * TX, EY, z);
      add(w, sprocket, m.compM);
      wheels.push(w);
    }
  }
  // --- hull: lower hull between the tracks, faceted upper hull with a chine over the tracks
  add(root, profileX('dgStealthLower', [[-1.1, 0.12], [0.86, 0.12], [1.1, 0.36], [-1.16, 0.36]], 0.84), m.compD);
  const H = [[-0.48, 1.3], [0.48, 1.3], [0.8, 0.96], [0.8, -1.06], [0.6, -1.28], [-0.6, -1.28], [-0.8, -1.06], [-0.8, 0.96]];
  const hr = (y, sx, zf, zb) => [y, H.map(([x, z]) => [x * sx, z > 0 ? z * zf : z * zb])];
  const HR = [hr(0.25, 0.97, 0.88, 0.95), hr(0.42, 1, 1, 1), hr(0.56, 0.86, 0.74, 0.94), hr(0.62, 0.74, 0.62, 0.9)];
  add(root, loftGeo('dgStealthHull', HR), m.comp);
  add(root, loftGeo('dgStealthStripe', [ringAt(HR[1], HR[2], 0.1, 0.007), ringAt(HR[1], HR[2], 0.3, 0.007)]), m.team);
  add(root, loftGeo('dgStealthChine', [ringAt(HR[0], HR[1], 0.86, 0.006), ringAt(HR[0], HR[1], 1, 0.006)]), m.compM);
  // glacis: LED running lights, driver's sensor slit
  for (const u of [0.1, 0.9]) add(onFace(root, HR, 1, 0, u, 0.55), geo.box(0.14, 0.022, 0.01), m.ledS);
  add(onFace(root, HR, 2, 0, 0.5, 0.5), geo.box(0.3, 0.025, 0.01), m.visor);
  // deck: sawtooth-edged RAM panels, engine deck, rear grille, tail lights
  const dy = 0.62;
  const saw = [];
  for (let i = 0; i < 7; i++) saw.push([0.07, 0.01, 0.07, -0.45 + i * 0.15, 0, -0.62, Math.PI / 4]);
  add(root, mergedBoxes('dgDeckSaw', [...saw, [0.96, 0.01, 0.42, 0, 0, -0.86]]), m.compM, [0, dy + 0.004, 0]);
  const grille = [];
  for (let i = 0; i < 6; i++) grille.push([0.07, 0.012, 0.3, -0.3 + i * 0.12, 0, 0, 0.5]);
  add(root, mergedBoxes('dgDeckGrille', grille), m.compD, [0, dy + 0.012, -0.86]);
  add(root, mergedBoxes('dgDeckPanels', [[0.012, 0.012, 0.5, 0.36, 0, 0.42], [0.012, 0.012, 0.5, -0.36, 0, 0.42], [0.5, 0.012, 0.012, 0, 0, 0.66]]), m.compD, [0, dy + 0.002, 0]);
  for (const s of [1, -1]) add(onFace(root, HR, 1, 4, s > 0 ? 0.15 : 0.85, 0.5), geo.box(0.12, 0.03, 0.01), mat(0xd02418, { emissive: 0xa01208, emissiveIntensity: 0.6 }));
  // --- turret: faceted low wedge with a team stripe and roof panel
  const T = [[-0.4, -0.62], [0.4, -0.62], [0.54, -0.3], [0.54, 0.18], [0.24, 0.6], [-0.24, 0.6], [-0.54, 0.18], [-0.54, -0.3]];
  const tr = (y, sx, zf, zb) => [y, T.map(([x, z]) => [x * sx, z > 0 ? z * zf : z * zb])];
  const TR = [tr(0, 0.88, 0.86, 0.94), tr(0.08, 1, 1, 1), tr(0.25, 0.78, 0.72, 0.9)];
  const turret = grp(root, 0, dy, -0.18);
  add(turret, loftGeo('dgStealthTurret', TR), m.compM);
  add(turret, loftGeo('dgTurretStripe', [ringAt(TR[1], TR[2], 0.12, 0.012), ringAt(TR[1], TR[2], 0.34, 0.012)]), m.team);
  const roof = 0.25;
  add(turret, geo.box(0.42, 0.012, 0.26), m.team, [0.04, roof + 0.004, -0.3]);
  add(turret, mergedBoxes('dgTurretSeams', [[0.012, 0.01, 0.66, 0.22, 0, -0.05], [0.012, 0.01, 0.66, -0.22, 0, -0.05]]), m.comp, [0, roof + 0.003, 0]);
  // sensor mast (rear left), commander's sight (right), APS sensors on the front corners
  add(turret, geo.cyl(0.02, 0.026, 0.2, 6), m.compD, [-0.24, roof + 0.1, -0.36]);
  add(turret, geo.octa(0.075), m.comp, [-0.24, roof + 0.23, -0.36], null, [1.1, 0.7, 1.1]);
  add(turret, geo.box(0.05, 0.022, 0.012), m.ledS, [-0.24, roof + 0.23, -0.29]);
  add(turret, geo.box(0.13, 0.08, 0.13), m.comp, [0.26, roof + 0.04, 0.02], [0, Math.PI / 4, 0]);
  add(turret, geo.box(0.07, 0.035, 0.012), m.ledS, [0.26, roof + 0.05, 0.112]);
  for (const s of [1, -1]) {
    const f = onFace(turret, TR, 1, s > 0 ? 3 : 5, s > 0 ? 0.3 : 0.7, 0.4);
    add(f, geo.box(0.1, 0.06, 0.04), m.comp);
    add(f, geo.box(0.05, 0.025, 0.012), m.ledS, [0, 0, 0.024]);
  }
  // --- railgun (parts.weapon): faceted mantlet, shroud, twin rails, glowing core + coils
  const weapon = grp(root, 0, 0.74, 0.38);
  add(weapon, profileX('dgTankMantlet', [[-0.1, -0.075], [0.08, -0.075], [0.14, -0.03], [0.14, 0.03], [0.08, 0.075], [-0.1, 0.075]], 0.34), m.comp);
  add(weapon, profileX('dgTankShroud', [[0.1, -0.06], [0.6, -0.05], [0.66, 0], [0.6, 0.05], [0.1, 0.06]], 0.19), m.compM);
  add(weapon, geo.box(0.06, 0.012, 0.44), m.team, [0, 0.058, 0.36]);
  add(weapon, mergedBoxes('dgTankRails', [[0.045, 0.11, 0.86, 0.06, 0, 1.02], [0.045, 0.11, 0.86, -0.06, 0, 1.02]]), m.comp);
  add(weapon, geo.box(0.16, 0.03, 0.86), m.compD, [0, -0.045, 1.02]);
  glowAdd(glow, weapon, geo.box(0.04, 0.04, 0.8), m.led, [0, 0.005, 1.02]);
  glowAdd(glow, weapon, mergedCyls('dgTankCoils', [-0.27, -0.09, 0.09, 0.27].map((z) => [0.1, 0.1, 0.04, 0, 0, z, HALF_PI, 0, 8])), m.led, [0, 0, 0.98]);
  add(weapon, profileX('dgTankMuzzle', [[0, -0.07], [0.07, -0.06], [0.09, 0], [0.07, 0.06], [0, 0.07]], 0.2), m.compM, [0, 0, 1.4]);
  add(weapon, geo.box(0.204, 0.03, 0.05), m.team, [0, 0.04, 1.44]);
  muzzle(weapon, 0, 0, 1.5);
  return { root, parts: { weapon, wheels, glow }, height: 1.15, radius: 0.95 };
}

// ===========================================================================
// Buildings
// ===========================================================================

// Digital Hub (Digital town center, 4x4): a rounded glass podium with a white slab, a glowing ribbon and a
// green roof, a twisting tower of rotated glass floors with blue LED ledges (glow) between them, a crown
// with a team band, a drone pad (LED ring) and antenna masts, and a giant team-colored holographic screen
// tilted toward the camera over the entrance. Plaza with LED paths, light pylons and planters.
export function digital_hub(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  const pave = mat(C.pave), glassD = mat(C.glassD), green = mat(C.green), greenD = mat(C.greenD);
  // --- plaza: rounded plinth, team rim, light paving with LED paths
  add(root, roundSlab(3.86, 3.86, 0.08, 0.34), m.compM);
  add(root, roundSlab(3.78, 3.78, 0.03, 0.3), m.team, [0, 0.08, 0]);
  add(root, roundSlab(3.68, 3.68, 0.04, 0.26), pave, [0, 0.1, 0]);
  const b = 0.14;
  add(root, mergedBoxes('dgHubPaths', [[0.04, 0.008, 1.0, -0.62, 0, 1.3], [0.04, 0.008, 1.0, 0.62, 0, 1.3], [3.3, 0.008, 0.04, 0, 0, 1.78]]), m.ledS, [0, b, 0]);
  // --- podium (z -1.7 .. 0.8): lobby glass, white slab, glowing ribbon floor, parapet, green roof
  const PZ = -0.45, PW = 3.3, PD = 2.5;
  add(root, roundSlab(PW - 0.12, PD - 0.12, 0.44, 0.3), glassD, [0, b, PZ]);
  const fins = [];
  for (let i = 0; i < 11; i++) fins.push([0.04, 0.44, 0.04, -1.45 + i * 0.29, 0.22, PZ + PD / 2 - 0.05]);
  for (let i = 0; i < 7; i++) fins.push([0.04, 0.44, 0.04, PW / 2 - 0.05, 0.22, PZ - 0.9 + i * 0.3], [0.04, 0.44, 0.04, -PW / 2 + 0.05, 0.22, PZ - 0.9 + i * 0.3]);
  add(root, mergedBoxes('dgHubLobbyFins', fins), m.white, [0, b, 0]);
  add(root, roundSlab(PW, PD, 0.07, 0.36), m.white, [0, b + 0.44, PZ]);
  add(root, roundSlab(PW - 0.08, PD - 0.08, 0.26, 0.32), m.comp, [0, b + 0.51, PZ]);
  add(root, roundSlab(PW - 0.05, PD - 0.05, 0.08, 0.33), mat(C.ledL, { emissive: C.led, emissiveIntensity: 0.55 }), [0, b + 0.6, PZ]);
  add(root, roundSlab(PW + 0.04, PD + 0.04, 0.07, 0.38), m.white, [0, b + 0.77, PZ]);
  const top = b + 0.84;
  add(root, roundSlab(PW - 0.12, PD - 0.12, 0.012, 0.3), mat(0x7d858f), [0, top - 0.008, PZ]);
  add(root, mergedBoxes('dgHubGreen', [[0.75, 0.05, 2.0, -1.12, 0.025, PZ - 0.05], [0.75, 0.05, 2.0, 1.12, 0.025, PZ - 0.05], [1.4, 0.05, 0.4, 0, 0.025, PZ - 0.98]]), green, [0, top, 0]);
  add(root, mergedBoxes('dgHubShrubs', [[0.16, 0.1, 0.16, -1.2, 0.1, -1.2], [0.14, 0.09, 0.14, -1.0, 0.09, -0.3], [0.16, 0.1, 0.16, 1.2, 0.1, -1.0], [0.14, 0.09, 0.14, 1.05, 0.09, 0.15], [0.15, 0.1, 0.15, 0.5, 0.1, -1.4]]), greenD, [0, top, 0]);
  // entrance: glass doors, white canopy with a team edge
  add(root, geo.box(0.7, 0.36, 0.03), mat(C.visor), [0, b + 0.18, PZ + PD / 2 - 0.02]);
  add(root, geo.box(0.04, 0.36, 0.04), m.white, [0, b + 0.18, PZ + PD / 2]);
  add(root, geo.box(1.1, 0.05, 0.4), m.white, [0, b + 0.42, PZ + PD / 2 + 0.18]);
  add(root, geo.box(1.12, 0.04, 0.03), m.team, [0, b + 0.42, PZ + PD / 2 + 0.38]);
  add(root, geo.box(0.7, 0.012, 0.3), m.ledS, [0, b + 0.39, PZ + PD / 2 + 0.17]);
  // --- twisting tower: rotated glass floors, white slabs, LED ledges (glow)
  const N = 8, LH = 0.44, TZ = -0.62;
  const glassA = mat(C.glass), glassB = mat(C.glassB);
  for (let i = 0; i < N; i++) {
    const w = 1.5 - i * 0.045, a = i * 0.11;
    const lv = grp(root, 0, top + i * LH, TZ, a);
    add(lv, geo.box(w, LH - 0.06, w), i % 2 ? glassB : glassA, [0, (LH - 0.06) / 2, 0]);
    const mull = [];
    for (const u of [-w / 4, 0, w / 4]) {
      mull.push([0.03, LH - 0.06, 0.03, u, (LH - 0.06) / 2, w / 2], [0.03, LH - 0.06, 0.03, u, (LH - 0.06) / 2, -w / 2]);
      mull.push([0.03, LH - 0.06, 0.03, w / 2, (LH - 0.06) / 2, u], [0.03, LH - 0.06, 0.03, -w / 2, (LH - 0.06) / 2, u]);
    }
    add(lv, mergedBoxes(`dgHubMull${w.toFixed(3)}`, mull), m.white);
    add(lv, geo.box(w + 0.08, 0.04, w + 0.08), m.white, [0, LH - 0.04, 0]);
    glowAdd(glow, lv, geo.box(w + 0.15, 0.02, w + 0.15), m.led, [0, LH - 0.01, 0]);
  }
  // --- crown: white cap, team band, drone pad with an LED ring and a parked drone, antenna masts
  const ty = top + N * LH, wt = 1.5 - N * 0.045;
  const crown = grp(root, 0, ty, TZ, N * 0.11);
  add(crown, geo.box(wt, 0.14, wt), m.white, [0, 0.07, 0]);
  add(crown, geo.box(wt + 0.03, 0.05, wt + 0.03), m.team, [0, 0.09, 0]);
  add(crown, geo.cyl(0.46, 0.48, 0.05, 20), m.compD, [0, 0.165, 0]);
  glowAdd(glow, crown, annulus(0.38, 0.43, 0.012, 20), m.led, [0, 0.19, 0]);
  add(crown, mergedBoxes('dgHubPadMark', [[0.42, 0.008, 0.05, 0, 0, 0, Math.PI / 4], [0.42, 0.008, 0.05, 0, 0, 0, -Math.PI / 4]]), m.white, [0, 0.192, 0]);
  miniDrone(crown, 0.0, 0.196, 0.0, 0.4, m);
  const mastBase = [[0.46, 0.46, 1.42], [-0.46, -0.46, 0.98]];
  for (const [x, z, h] of mastBase) {
    add(crown, geo.box(0.12, 0.06, 0.12), m.comp, [x, 0.17, z]);
    add(crown, geo.cyl(0.018, 0.035, h, 6), m.pearl, [x, 0.2 + h / 2, z]);
    add(crown, mergedBoxes(`dgHubMastBars${h}`, [[0.2, 0.014, 0.014, 0, h * 0.45, 0], [0.014, 0.014, 0.16, 0, h * 0.62, 0], [0.12, 0.014, 0.014, 0, h * 0.8, 0]]), m.pearl, [x, 0.2, z]);
    glowAdd(glow, crown, geo.sphere(0.04, 6, 4), glowMat(C.red, 1.3), [x, 0.2 + h + 0.02, z]);
  }
  // --- giant holographic team screen over the entrance, tilted back toward the camera
  const scr = grp(root, 0, top + 0.01, 0.6);
  scr.rotation.x = -0.45;
  add(scr, geo.box(2.1, 0.96, 0.06), m.white, [0, 0.5, 0]);
  add(scr, geo.box(1.98, 0.84, 0.02), mat(tc, { emissive: tc, emissiveIntensity: 0.6 }), [0, 0.5, 0.035]);
  const bright = mat(new THREE.Color(tc).lerp(new THREE.Color(0xffffff), 0.55).getHex(), { emissive: tc, emissiveIntensity: 0.5 });
  add(scr, mergedBoxes('dgHubScreenData', [
    [0.5, 0.035, 0.01, -0.62, 0.78, 0], [0.38, 0.035, 0.01, -0.68, 0.7, 0], [0.44, 0.035, 0.01, -0.65, 0.62, 0],
    [0.06, 0.2, 0.01, 0.55, 0.3, 0], [0.06, 0.32, 0.01, 0.64, 0.36, 0], [0.06, 0.26, 0.01, 0.73, 0.33, 0], [0.06, 0.4, 0.01, 0.82, 0.4, 0],
    [0.5, 0.02, 0.01, -0.62, 0.24, 0], [0.32, 0.02, 0.01, -0.71, 0.2, 0],
  ]), bright, [0, 0, 0.047]);
  glowAdd(glow, scr, geo.custom('dig:hubEmblem', () => {
    const ring = new THREE.TorusGeometry(0.24, 0.035, 4, 6).toNonIndexed();
    ring.rotateZ(HALF_PI);
    const list = [ring];
    for (let k = 0; k < 3; k++) {
      const a = HALF_PI + (k * TAU) / 3;
      const bx = new THREE.BoxGeometry(0.035, 0.2, 0.02).toNonIndexed();
      bx.translate(0, 0.1, 0);
      bx.rotateZ(a - HALF_PI);
      list.push(bx);
      const nd = new THREE.BoxGeometry(0.07, 0.07, 0.025).toNonIndexed();
      nd.translate(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0);
      list.push(nd);
    }
    const g = mergeGeometries(list, false);
    for (const p of list) p.dispose();
    return g;
  }), glowMat(0xf2f8ff, 0.9), [0, 0.5, 0.05]);
  add(scr, mergedBoxes('dgHubScreenLegs', [[0.08, 0.5, 0.08, -0.8, 0.2, -0.06], [0.08, 0.5, 0.08, 0.8, 0.2, -0.06]]), m.comp, [0, 0, 0]);
  add(scr, geo.box(1.9, 0.03, 0.03), m.ledS, [0, 0.03, 0.04]);
  // --- plaza: front light pylons with team caps, planters with trees
  for (const s of [1, -1]) {
    const x = s * 1.5;
    add(root, geo.box(0.16, 0.05, 0.16), m.comp, [x, b + 0.025, 1.5]);
    add(root, geo.box(0.07, 0.9, 0.07), m.white, [x, b + 0.45, 1.5]);
    add(root, geo.box(0.09, 0.22, 0.09), mat(tc, { emissive: tc, emissiveIntensity: 0.55 }), [x, b + 0.98, 1.5]);
    add(root, geo.box(0.11, 0.03, 0.11), m.white, [x, b + 1.1, 1.5]);
    add(root, geo.box(0.46, 0.14, 0.3), m.compM, [s * 1.0, b + 0.07, 1.42]);
    add(root, geo.box(0.42, 0.03, 0.26), greenD, [s * 1.0, b + 0.145, 1.42]);
    add(root, geo.cyl(0.02, 0.025, 0.2, 5), mat(P.woodDark), [s * 1.0, b + 0.24, 1.42]);
    add(root, geo.ico(0.17, 0), green, [s * 1.0, b + 0.42, 1.42]);
  }
  return { root, parts: { glow }, height: 5.8, radius: 1.95 };
}

// Smart home (2x2): stacked, offset modules: a white ground floor with a warm-lit glass front, a dark
// composite upper module cantilevered over a charging bay (team band, lit ribbon window), a white top module
// with a green roof, solar glass on the exposed roof, a glass-railed terrace with team panels and a sensor mast.
export function house_digital(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const pave = mat(C.pave), glass = mat(C.glassD), green = mat(C.green), greenD = mat(C.greenD);
  const railGlass = mat(0xbfe2ff, { transparent: true, opacity: 0.45, depthWrite: false });
  add(root, roundSlab(1.92, 1.92, 0.06, 0.14), m.compM);
  add(root, roundSlab(1.84, 1.84, 0.03, 0.11), pave, [0, 0.06, 0]);
  const b = 0.09;
  // front lawn and LED path to the door
  add(root, geo.box(0.56, 0.025, 0.36), green, [0.55, b + 0.012, 0.7]);
  add(root, geo.box(0.06, 0.008, 0.3), m.ledS, [-0.2, b + 0.004, 0.76]);
  // --- module A (ground floor): white, x -0.82..0.42, z -0.55..0.61
  const A = { x: -0.2, z: 0.03, w: 1.24, d: 1.16, h: 0.82 };
  add(root, geo.box(A.w, A.h, A.d), m.white, [A.x, b + A.h / 2, A.z]);
  const fa = A.z + A.d / 2;
  add(root, geo.box(0.62, 0.6, 0.03), m.lit, [A.x - 0.25, b + 0.36, fa + 0.005]); // lit living room glazing
  add(root, mergedBoxes('dgHomeMullA', [[0.025, 0.6, 0.04, -0.2, 0, 0], [0.025, 0.6, 0.04, 0.0, 0, 0], [0.62, 0.025, 0.04, -0.1, 0.18, 0]]), m.compD, [A.x - 0.15, b + 0.36, fa + 0.01]);
  add(root, geo.box(0.3, 0.58, 0.04), m.team, [A.x + 0.38, b + 0.31, fa + 0.005]); // door frame
  add(root, geo.box(0.22, 0.52, 0.04), glass, [A.x + 0.38, b + 0.28, fa + 0.012]);
  add(root, geo.box(0.36, 0.03, 0.2), pave, [A.x + 0.38, b + 0.015, fa + 0.1]);
  add(root, mergedBoxes('dgHomeSideWinA', [[0.03, 0.3, 0.5, A.w / 2, 0, -0.1], [0.03, 0.3, 0.4, -A.w / 2, 0, 0.1], [0.6, 0.3, 0.03, 0.1, 0, -A.d / 2]]), glass, [A.x, b + 0.45, A.z]);
  add(root, geo.box(0.03, 0.28, 0.24, ), m.lit, [A.x - A.w / 2 - 0.004, b + 0.45, A.z + 0.24]);
  // --- module B (upper floor): dark composite, cantilevered toward +X over the charging bay
  const B = { x: 0.24, z: -0.12, w: 1.3, d: 1.1, h: 0.74 };
  const by = b + A.h;
  add(root, geo.box(B.w, B.h, B.d), m.comp, [B.x, by + B.h / 2, B.z]);
  add(root, geo.box(B.w + 0.02, 0.07, B.d + 0.02), m.team, [B.x, by + 0.06, B.z]); // team band
  const fb = B.z + B.d / 2;
  add(root, geo.box(1.0, 0.3, 0.03), glass, [B.x + 0.05, by + 0.42, fb + 0.005]);
  add(root, mergedBoxes('dgHomeLitB', [[0.3, 0.26, 0.01, -0.28, 0, 0], [0.3, 0.26, 0.01, 0.34, 0, 0]]), m.lit, [B.x + 0.05, by + 0.42, fb + 0.022]);
  add(root, mergedBoxes('dgHomeFinsB', [-0.4, -0.1, 0.2, 0.5].map((x) => [0.03, 0.36, 0.06, x, 0, 0])), m.white, [B.x + 0.05, by + 0.42, fb + 0.02]);
  add(root, mergedBoxes('dgHomeSideB', [[0.03, 0.26, 0.8, B.w / 2, 0, 0], [0.8, 0.26, 0.03, 0, 0, -B.d / 2]]), glass, [B.x, by + 0.42, B.z]);
  add(root, geo.box(0.012, 0.22, 0.3), m.lit, [B.x + B.w / 2 + 0.012, by + 0.42, B.z + 0.15]);
  add(root, geo.box(0.012, 0.03, 1.0), m.ledS, [B.x + B.w / 2 + 0.008, by + 0.12, B.z]); // LED soffit line
  // charging bay under the cantilever: column, charger post with an LED, parking pad
  add(root, geo.box(0.07, A.h, 0.07), m.white, [0.85, b + A.h / 2, -0.62]);
  add(root, geo.box(0.4, 0.012, 0.86), mat(0x8b939c), [0.66, b + 0.006, -0.12]);
  add(root, geo.box(0.1, 0.32, 0.08), m.white, [0.66, b + 0.16, -0.62]);
  add(root, geo.box(0.06, 0.1, 0.012), m.ledS, [0.66, b + 0.22, -0.575]);
  add(root, geo.box(0.04, 0.04, 0.02), m.team, [0.66, b + 0.29, -0.575]);
  // --- module C (top): white box set back, green roof with shrubs
  const Cm = { x: -0.18, z: -0.3, w: 0.96, d: 0.86, h: 0.64 };
  const cy = by + B.h;
  add(root, geo.box(Cm.w, Cm.h, Cm.d), m.white, [Cm.x, cy + Cm.h / 2, Cm.z]);
  const fc = Cm.z + Cm.d / 2;
  add(root, geo.box(0.5, 0.4, 0.03), m.lit, [Cm.x - 0.1, cy + 0.27, fc + 0.005]);
  add(root, geo.box(0.025, 0.4, 0.04), m.compD, [Cm.x - 0.1, cy + 0.27, fc + 0.012]);
  add(root, geo.box(0.22, 0.4, 0.03), glass, [Cm.x + 0.28, cy + 0.27, fc + 0.005]);
  add(root, mergedBoxes('dgHomeSideC', [[0.03, 0.22, 0.5, Cm.w / 2, 0, 0], [0.03, 0.22, 0.5, -Cm.w / 2, 0, 0]]), glass, [Cm.x, cy + 0.36, Cm.z]);
  const ry = cy + Cm.h;
  add(root, geo.box(Cm.w + 0.04, 0.05, Cm.d + 0.04), m.team, [Cm.x, ry + 0.025, Cm.z]);
  add(root, geo.box(Cm.w - 0.06, 0.06, Cm.d - 0.06), green, [Cm.x, ry + 0.06, Cm.z]);
  add(root, mergedBoxes('dgHomeShrubs', [[0.14, 0.09, 0.14, -0.25, 0, -0.18], [0.12, 0.08, 0.12, 0.18, 0, 0.12], [0.16, 0.1, 0.12, 0.2, 0, -0.22], [0.1, 0.07, 0.1, -0.22, 0, 0.18]]), greenD, [Cm.x, ry + 0.12, Cm.z]);
  // sensor / weather mast with a team pennant light
  add(root, geo.cyl(0.012, 0.016, 0.42, 5), m.pearl, [Cm.x - 0.36, ry + 0.27, Cm.z - 0.3]);
  add(root, geo.box(0.12, 0.012, 0.012), m.pearl, [Cm.x - 0.36, ry + 0.38, Cm.z - 0.3]);
  add(root, geo.sphere(0.03, 6, 4), m.ledS, [Cm.x - 0.36, ry + 0.49, Cm.z - 0.3]);
  // --- exposed roof of B: solar glass (right strip) and a glass-railed terrace (front strip)
  const sy = by + B.h;
  const sol = grp(root, 0.6, sy, -0.12);
  sol.rotation.x = 0.0;
  add(sol, geo.box(0.5, 0.03, 0.98), m.pearl, [0, 0.03, 0], [0.12, 0, 0]);
  add(sol, geo.box(0.46, 0.03, 0.94), mat(C.solar), [0, 0.04, 0], [0.12, 0, 0]);
  const sg = [];
  for (let i = 1; i < 4; i++) sg.push([0.01, 0.01, 0.94, -0.23 + i * 0.115, 0, 0]);
  for (let i = 1; i < 6; i++) sg.push([0.46, 0.01, 0.01, 0, 0, -0.47 + i * 0.157]);
  const sgg = grp(sol, 0, 0.057, 0);
  sgg.rotation.x = 0.12;
  add(sgg, mergedBoxes('dgHomeSolarGrid', sg), mat(0x6f8fc8));
  add(root, geo.box(0.62, 0.012, 0.28), mat(0x9a8a74), [-0.1, sy + 0.006, 0.28]); // terrace decking
  add(root, geo.box(0.66, 0.16, 0.02), railGlass, [-0.1, sy + 0.09, 0.42]).castShadow = false;
  add(root, mergedBoxes('dgHomeRail', [[0.68, 0.025, 0.03, 0, 0.17, 0], [0.025, 0.17, 0.03, -0.33, 0.085, 0], [0.025, 0.17, 0.03, 0.33, 0.085, 0]]), m.team, [-0.1, sy, 0.42]);
  // small tree in a planter (front left)
  add(root, geo.box(0.24, 0.12, 0.24), m.compM, [-0.72, b + 0.06, 0.74]);
  add(root, geo.cyl(0.02, 0.025, 0.2, 5), mat(P.woodDark), [-0.72, b + 0.2, 0.74]);
  add(root, geo.ico(0.15, 0), green, [-0.72, b + 0.38, 0.74]);
  return { root, parts: {}, height: 2.6, radius: 0.95 };
}

// Research Center III (3x3, Digital to Galactic Age): a white curved lab wrapping the back, with window bands,
// team fins and a team fascia; in its arms a drum with a glass dome over a glowing quantum core (glow) and a
// tilted gyroscope ring (spin); a satellite dish mast (spin) at the back right, a dark server annex with LED
// racks at the back left, conduits from the lab to the core and team-capped sensor pylons at the front.
export function research_3(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  const spin = [];
  const pave = mat(C.pave);
  add(root, roundSlab(2.88, 2.88, 0.08, 0.3), m.compM);
  add(root, roundSlab(2.8, 2.8, 0.03, 0.27), m.team, [0, 0.08, 0]);
  add(root, roundSlab(2.7, 2.7, 0.04, 0.24), pave, [0, 0.1, 0]);
  const b = 0.14;
  // --- curved lab around the back (open toward the front)
  const RI = 0.86, RO = 1.26, LH = 0.86;
  const ph0 = 0.78, phL = TAU - 2 * 0.78;
  add(root, sweepGeo('dgLab', [[RI, 0], [RO, 0], [RO + 0.02, 0.08], [RO - 0.01, 0.6], [RO - 0.12, LH - 0.04], [RO - 0.26, LH], [RI, LH]], [[ph0, phL, 18]]), m.white, [0, b, 0]);
  const winArcs = [];
  for (let k = 0; k < 6; k++) winArcs.push([ph0 + 0.1 + (k * (phL - 0.2)) / 6, (phL - 0.2) / 6 - 0.12, 2]);
  add(root, sweepGeo('dgLabWin', [[RO + 0.005, 0.2], [RO + 0.03, 0.2], [RO + 0.025, 0.42], [RO + 0.0, 0.42]], winArcs), mat(C.glassD), [0, b, 0]);
  add(root, sweepGeo('dgLabWinLED', [[RO + 0.03, 0.215], [RO + 0.04, 0.215], [RO + 0.04, 0.235], [RO + 0.03, 0.235]], winArcs), m.ledS, [0, b, 0]);
  add(root, sweepGeo('dgLabFascia', [[RO - 0.13, LH - 0.06], [RO - 0.1, LH - 0.08], [RO - 0.22, LH + 0.01], [RO - 0.25, LH + 0.0]], [[ph0, phL, 18]]), m.team, [0, b, 0]);
  add(root, sweepGeo('dgLabInnerWin', [[RI - 0.03, 0.15], [RI + 0.005, 0.15], [RI + 0.005, 0.62], [RI - 0.03, 0.62]], [[ph0 + 0.1, phL - 0.2, 12]]), mat(C.glassB), [0, b, 0]);
  // team fins between the windows, lab end entrances
  const finBoxes = [];
  for (let k = 0; k <= 6; k++) {
    const a = ph0 + 0.1 + (k * (phL - 0.2)) / 6 - 0.06;
    finBoxes.push([0.06, 0.62, 0.05, Math.sin(a) * (RO + 0.03), 0.34, Math.cos(a) * (RO + 0.03), a]);
  }
  add(root, mergedBoxes('dgLabFins', finBoxes), m.team, [0, b, 0]);
  for (const s of [1, -1]) {
    const a = s > 0 ? ph0 : TAU - ph0;
    const g = grp(root, Math.sin(a) * (RI + RO) / 2, b, Math.cos(a) * (RI + RO) / 2, a + s * HALF_PI);
    add(g, geo.box(0.26, 0.5, 0.03), mat(C.visor), [0, 0.25, 0.012]);
    add(g, geo.box(0.32, 0.04, 0.12), m.pearl, [0, 0.52, 0.05]);
    add(g, geo.box(0.22, 0.012, 0.01), m.ledS, [0, 0.5, 0.105]);
  }
  // roof: grey membrane strip + rooftop units
  add(root, sweepGeo('dgLabRoof', [[RI + 0.04, LH], [RO - 0.28, LH], [RO - 0.28, LH + 0.012], [RI + 0.04, LH + 0.012]], [[ph0 + 0.05, phL - 0.1, 18]]), mat(0x9aa2ac), [0, b, 0]);
  for (const a of [Math.PI - 0.55, Math.PI + 0.55]) {
    add(root, geo.box(0.22, 0.12, 0.18), m.pearl, [Math.sin(a) * 1.02, b + LH + 0.06, Math.cos(a) * 1.02], [0, a, 0]);
    add(root, geo.cyl(0.06, 0.06, 0.02, 8), m.compD, [Math.sin(a) * 1.02, b + LH + 0.125, Math.cos(a) * 1.02]);
  }
  // --- quantum core: drum, team ring, glowing core, gyroscope ring (spin), glass dome
  const cz = 0.06;
  add(root, geo.cyl(0.66, 0.7, 0.3, 20), m.white, [0, b + 0.15, cz]);
  add(root, geo.cyl(0.705, 0.705, 0.06, 20), m.team, [0, b + 0.22, cz]);
  add(root, mergedBoxes('dgCoreVents', [0, 1, 2, 3, 4, 5].map((k) => {
    const a = (k * TAU) / 6 + 0.26;
    return [0.16, 0.08, 0.02, Math.sin(a) * 0.7, 0, Math.cos(a) * 0.7, a];
  })), m.ledS, [0, b + 0.1, cz]);
  const dy = b + 0.3;
  add(root, geo.cyl(0.62, 0.62, 0.02, 20), m.compD, [0, dy + 0.01, cz]);
  add(root, geo.cyl(0.16, 0.22, 0.14, 8), m.compM, [0, dy + 0.07, cz]);
  add(root, geo.cyl(0.08, 0.1, 0.2, 8), m.pearl, [0, dy + 0.2, cz]);
  glowAdd(glow, root, geo.ico(0.15, 0), glowMat(0x7ec4ff, 1.4), [0, dy + 0.42, cz]);
  glowAdd(glow, root, geo.ico(0.085, 0), glowMat(0xeaf4ff, 1.5), [0, dy + 0.42, cz], [0.5, 0.3, 0]);
  const gyro = grp(root, 0, dy + 0.42, cz);
  const gt = grp(gyro, 0, 0, 0);
  gt.rotation.z = 0.45;
  add(gt, geo.torus(0.3, 0.02, 4, 20), m.team, [0, 0, 0], [HALF_PI, 0, 0]);
  add(gt, geo.torus(0.24, 0.015, 4, 18), m.pearl, [0, 0, 0], [0.3, 0, 0]);
  add(gt, mergedBoxes('dgGyroNodes', [[0.06, 0.06, 0.06, 0.3, 0, 0], [0.06, 0.06, 0.06, -0.3, 0, 0]]), m.white);
  spin.push(gyro);
  const dome = add(root, hemi(20, 6), mat(0xbfe6ff, { transparent: true, opacity: 0.28, depthWrite: false }), [0, dy + 0.02, cz], null, [0.6, 0.66, 0.6]);
  dome.castShadow = false;
  add(root, geo.custom('dig:coreDomeRibs', () => {
    const list = [0, 1, 2].map((k) => new THREE.TorusGeometry(1, 0.02, 3, 10, Math.PI).rotateY((k * Math.PI) / 3).toNonIndexed());
    const g = mergeGeometries(list, false);
    for (const q of list) q.dispose();
    return g;
  }), m.white, [0, dy + 0.02, cz], null, [0.605, 0.665, 0.605]);
  add(root, geo.cyl(0.07, 0.08, 0.05, 8), m.white, [0, dy + 0.69, cz]);
  // conduits from the lab to the drum
  for (const a of [Math.PI, Math.PI - 1.4, Math.PI + 1.4]) {
    const r0 = 0.7, r1 = RI;
    const g = grp(root, Math.sin(a) * (r0 + r1) / 2, b + 0.2, Math.cos(a) * (r0 + r1) / 2 + cz / 2, a);
    add(g, geo.box(0.12, 0.1, r1 - r0 + 0.08), m.pearl);
    add(g, geo.box(0.04, 0.02, r1 - r0 + 0.08), m.ledS, [0, 0.055, 0]);
  }
  // --- satellite dish mast (back right) with the dish (spin)
  const mx = 1.06, mz = -1.06;
  add(root, geo.box(0.42, 0.1, 0.42), m.comp, [mx, b + 0.05, mz], [0, Math.PI / 4, 0]);
  add(root, geo.cyl(0.07, 0.12, 1.9, 6), m.white, [mx, b + 0.1 + 0.95, mz]);
  add(root, geo.cyl(0.125, 0.125, 0.08, 6), m.team, [mx, b + 0.6, mz]);
  add(root, geo.cyl(0.1, 0.1, 0.06, 6), m.team, [mx, b + 1.5, mz]);
  const dish = grp(root, mx, b + 2.0, mz);
  add(dish, geo.cyl(0.09, 0.1, 0.1, 8), m.compM, [0, 0.05, 0]);
  add(dish, geo.box(0.06, 0.24, 0.06), m.compM, [0, 0.2, 0]);
  const dt = grp(dish, 0, 0.3, 0.02);
  dt.rotation.x = -0.6;
  add(dt, dishGeo(0.42, 0.55), mat(C.white, { side: THREE.DoubleSide }));
  add(dt, annulus(0.4, 0.43, 0.03, 16), m.team, [0, 0, 0.0], [HALF_PI, 0, 0]);
  beam(dt, [0.3, 0, 0.04], [0, 0, 0.34], 0.015, m.compD);
  beam(dt, [-0.3, 0, 0.04], [0, 0, 0.34], 0.015, m.compD);
  beam(dt, [0, 0.3, 0.04], [0, 0, 0.34], 0.015, m.compD);
  add(dt, geo.box(0.06, 0.06, 0.08), m.compD, [0, 0, 0.36]);
  glowAdd(glow, dt, geo.sphere(0.025, 6, 4), m.led, [0, 0, 0.41]);
  add(dt, geo.box(0.16, 0.12, 0.1), m.compM, [0, 0, -0.14]);
  spin.push(dish);
  // --- server annex (back left): dark composite block with LED racks and roof fans
  const sx = -1.04, sz = -1.04;
  const ann = grp(root, sx, b, sz, -Math.PI / 4);
  add(ann, geo.box(0.62, 0.5, 0.36), m.comp, [0, 0.25, 0]);
  add(ann, geo.box(0.64, 0.05, 0.38), m.team, [0, 0.47, 0]);
  add(ann, mergedBoxes('dgServerLED', [-0.2, -0.07, 0.06, 0.19].map((x) => [0.05, 0.3, 0.01, x, 0.22, 0.185])), m.ledS);
  add(ann, mergedCyls('dgServerFans', [[0.08, 0.08, 0.03, -0.15, 0.51, 0, 0, 0, 10], [0.08, 0.08, 0.03, 0.15, 0.51, 0, 0, 0, 10]]), m.compD);
  // --- front sensor pylons with team light caps
  for (const s of [1, -1]) {
    const x = s * 1.12, z = 1.12;
    add(root, geo.box(0.2, 0.05, 0.2), m.comp, [x, b + 0.025, z], [0, Math.PI / 4, 0]);
    add(root, geo.cyl(0.04, 0.06, 0.7, 6), m.white, [x, b + 0.4, z]);
    add(root, geo.cyl(0.07, 0.07, 0.14, 6), mat(tc, { emissive: tc, emissiveIntensity: 0.55 }), [x, b + 0.82, z]);
    add(root, geo.cyl(0.08, 0.08, 0.025, 6), m.white, [x, b + 0.9, z]);
  }
  add(root, mergedBoxes('dgLabPaths', [[0.04, 0.008, 0.9, 0, 0, 0.95]]), m.ledS, [0, b, 0]);
  return { root, parts: { spin, glow }, height: 3.0, radius: 1.45 };
}
