// Galactic Age: the final age, an interstellar empire. Void troopers in iridescent power armour,
// antigravity starfighters, colossal war-titans and graviton artillery, plus the Galactic Citadel (town
// center), floating habitat pods and tiling hex force-field walls + gate.
// Look: gleaming iridescent alloys (pearl plating with lilac / frost / rose sheen panels), violet,
// magenta and white energy, floating antigravity elements and team-colored (partly glowing) panels.
//
// Same conventions as era_future.js: origin at ground center, facing +Z, weapon hand on -X, team color
// via mat(teamColor), cached geo/mat, everything casts shadows (add()).
// - parts.glow meshes pulse in scale (+-8%) about their own origin, so every glow piece is small, has its
//   origin at its own center, or sits where the pulse stays hidden (wall hex cells over a static lattice
//   block, door panes inside their frames, the citadel core inside its ribs).
// - Floating pieces (starfighter, graviton platform, habitat pod, citadel crystals) live in parts.bob
//   and never also in body.
// - Shooters rest with their barrels level along +Z. Each barrel tip carries an empty Object3D named
//   'muzzle' inside parts.weapon (weapon.getObjectByName('muzzle') / traverse for twin guns).
import { THREE, mat, geo, CG, glowMat, grp, add, beam, rod, rig, scaled, mergedBoxes } from './common.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;

/** Galactic palette. */
const C = {
  pearl: 0xf4f1ff, // iridescent white alloy
  lilac: 0xd3c4f6, // violet sheen
  frost: 0xc6e4fb, // cyan sheen
  rose: 0xf4cfec, // magenta sheen
  chrome: 0x9d96c6,
  gun: 0x463e66, // violet gunmetal
  void: 0x1c1630,
  glass: 0x1f0f40,
  violet: 0xb45cff,
  magenta: 0xff4fe4,
  white: 0xf3e6ff,
};

/** The shared material set of a team. */
function mats(tc) {
  return {
    pearl: mat(C.pearl), lilac: mat(C.lilac), frost: mat(C.frost), rose: mat(C.rose), chrome: mat(C.chrome),
    gun: mat(C.gun), void: mat(C.void), glass: mat(C.glass, { emissive: 0x3a1586, emissiveIntensity: 0.35 }),
    team: mat(tc), teamGlow: mat(tc, { emissive: tc, emissiveIntensity: 0.5 }),
    violet: glowMat(C.violet, 1), magenta: glowMat(C.magenta, 1), white: glowMat(C.white, 0.85),
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

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Cached merged cylinders / cones: [[rTop, rBot, h, x, y, z, rx = 0, rz = 0, seg = 8], ...],
 * each centered on (x, y, z). rx = HALF_PI lays a cylinder along Z, rz = HALF_PI along X.
 */
function mergedCyls(key, list) {
  return geo.custom(`gal-cyl:${key}`, () => {
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

/** Cached merged tori: [[radius, tube, x, y, z, rx, ry, rz, radial = 4, tubular = 16], ...]. */
function mergedTori(key, list) {
  return geo.custom(`gal-tori:${key}`, () => {
    const parts = list.map(([rad, tube, x, y, z, rx = 0, ry = 0, rz = 0, rs = 4, ts = 16]) => {
      const g = new THREE.TorusGeometry(rad, tube, rs, ts);
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
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
  return geo.custom(`gal-lathe:${key}`, () => {
    const v = pts.map(([r, y]) => new THREE.Vector2(r, y));
    if (!v[0].equals(v[v.length - 1])) v.push(v[0].clone());
    return new THREE.LatheGeometry(v, segs, phiStart, phiLen);
  });
}

/** Several partial lathes (window bands, arcs) merged: arcs = [[phiStart, phiLen], ...]. */
function latheArcs(key, pts, arcs, segs = 3) {
  return geo.custom(`gal-larcs:${key}`, () => {
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
  return geo.custom(`gal-rslab:${w},${d},${h},${r},${seg}`, () => {
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
 * (bevel) that stay inside the profile. Used for wedge hulls, fins and turret heads.
 */
function profileX(key, pts, w, bevel = 0) {
  return geo.custom(`gal-prof:${key}`, () => {
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

/** Flat plate(s) from (x, z) outlines lying in the XZ plane, thickness t centered on y = 0. */
function plateXZ(key, outlines, t) {
  return geo.custom(`gal-plate:${key}`, () => {
    const shapes = outlines.map((pts) => {
      const s = new THREE.Shape();
      s.moveTo(pts[0][0], -pts[0][1]);
      for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], -pts[i][1]);
      s.closePath();
      return s;
    });
    const g = new THREE.ExtrudeGeometry(shapes, { depth: t, bevelEnabled: false });
    g.translate(0, 0, -t / 2);
    g.rotateX(-HALF_PI); // shape (x, -z) -> (x, z), extrusion -> Y
    return g;
  });
}

/** Mirror a right-hand outline (front center ... back center, x >= 0) into a closed symmetric outline. */
const sym = (right) => [...right, ...right.slice(1, -1).reverse().map(([x, z]) => [-x, z])];
/** Mirror an outline to the -X side. */
const flipX = (pts) => pts.map(([x, z]) => [-x, z]).reverse();

/** Faceted cross-section of 8 points around (0, y): half-width w, top / bottom heights. */
const SECTION8 = ([, y, w, top, bot]) => [
  [0, y - bot], [w * 0.72, y - bot * 0.72], [w, y], [w * 0.64, y + top * 0.8],
  [0, y + top], [-w * 0.64, y + top * 0.8], [-w, y], [-w * 0.72, y - bot * 0.72],
];

/** Lofted hull along +Z through cross-sections [[z, y, w, top, bot], ...] (z ascending), capped. */
function loftZ(key, sections, shape = SECTION8) {
  return geo.custom(`gal-loft:${key}`, () => {
    const pos = [];
    const rings = sections.map((s) => shape(s).map(([x, y]) => [x, y, s[0]]));
    const n = rings[0].length;
    const tri = (a, b, c) => pos.push(...a, ...b, ...c);
    for (let i = 0; i < rings.length - 1; i++) {
      const A = rings[i], B = rings[i + 1];
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        tri(A[k], A[k1], B[k1]);
        tri(A[k], B[k1], B[k]);
      }
    }
    const cap = (R, front) => {
      const c = [0, 1, 2].map((j) => R.reduce((s, p) => s + p[j], 0) / n);
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        if (front) tri(c, R[k], R[k1]);
        else tri(c, R[k1], R[k]);
      }
    };
    cap(rings[0], false);
    cap(rings[rings.length - 1], true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });
}

/** Crystal along Y: an n-sided prism (radius r, from y = 0 to y = mid) with pointed ends (up / down). */
function crystalGeo(key, r, up, mid, down, n = 6) {
  return geo.custom(`gal-crystal:${key}`, () => {
    const pos = [];
    const ring = (y) => Array.from({ length: n }, (_, k) => [Math.sin((k / n) * TAU) * r, y, Math.cos((k / n) * TAU) * r]);
    const lo = ring(0), hi = ring(mid);
    const top = [0, mid + up, 0], bot = [0, -down, 0];
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      pos.push(...hi[k], ...hi[k1], ...top);
      pos.push(...lo[k1], ...lo[k], ...bot);
      pos.push(...lo[k], ...lo[k1], ...hi[k1], ...lo[k], ...hi[k1], ...hi[k]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });
}

/** Upper hemisphere (dome), radius 1, base at y = 0. */
const hemi = (ws = 16, hs = 6) => geo.custom(`gal:hemi${ws},${hs}`, () => new THREE.SphereGeometry(1, ws, hs, 0, TAU, 0, HALF_PI));

/** n tapering fins with annular-sector cross-sections (rIn..rOut) around Y, from y = 0 to h; radii x taper at the top. */
function spireFins(key, n, gap, rIn, rOut, h, taper) {
  return geo.custom(`gal-fins:${key}`, () => {
    const list = [];
    const span = TAU / n;
    for (let i = 0; i < n; i++) {
      const a0 = i * span + gap / 2, a1 = (i + 1) * span - gap / 2;
      const s = new THREE.Shape();
      s.moveTo(Math.cos(a0) * rIn, Math.sin(a0) * rIn);
      s.absarc(0, 0, rOut, a0, a1, false);
      s.absarc(0, 0, rIn, a1, a0, true);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 1 });
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

// ---------------------------------------------------------------------------
// Honeycomb (hex-pattern) energy surfaces
// ---------------------------------------------------------------------------

/** Convex polygon [[x, y], ...] clipped to the rectangle [x0, x1] x [y0, y1] (Sutherland-Hodgman). */
function clipRect(poly, x0, x1, y0, y1) {
  let out = poly;
  for (const f of [(p) => p[0] - x0, (p) => x1 - p[0], (p) => p[1] - y0, (p) => y1 - p[1]]) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length];
      const fa = f(a), fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) {
        const t = fa / (fa - fb);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    if (out.length < 3) return [];
  }
  return out;
}

/**
 * Honeycomb cells (flat-top hexagons shrunk by k toward their centers) covering [x0, x1] x [y0, y1] of
 * the XY plane, as a flat list of 2D triangle corners facing +Z. Columns every cs along X (column 0 at
 * x = ox), rows every rs along Y (row 0 at y = oy), odd columns offset by half a row, so the pattern
 * repeats every 2 cs in X and every rs in Y.
 */
function honeyTris(x0, x1, y0, y1, cs, rs, k, ox = 0, oy = 0) {
  const R = (cs * 2) / 3, H = rs / 2;
  const tris = [];
  for (let i = Math.floor((x0 - ox) / cs) - 1; i <= Math.ceil((x1 - ox) / cs) + 1; i++) {
    const cx = ox + i * cs;
    const off = (((i % 2) + 2) % 2) * H;
    for (let j = Math.floor((y0 - oy) / rs) - 2; j <= Math.ceil((y1 - oy) / rs) + 1; j++) {
      const cy = oy + j * rs + off;
      const hex = [[R, 0], [R / 2, H], [-R / 2, H], [-R, 0], [-R / 2, -H], [R / 2, -H]].map(([x, y]) => [cx + x * k, cy + y * k]);
      const p = clipRect(hex, x0, x1, y0, y1);
      if (p.length < 3) continue;
      let area = 0;
      for (let t = 0; t < p.length; t++) {
        const a = p[t], b = p[(t + 1) % p.length];
        area += a[0] * b[1] - b[0] * a[1];
      }
      if (area / 2 < 0.0015 * cs * rs * 12) continue; // drop slivers
      for (let t = 1; t < p.length - 1; t++) tris.push(p[0], p[t], p[t + 1]);
    }
  }
  return tris;
}

/** Geometry from honeycomb faces: [{ tris, map: (x, y) => [X, Y, Z] }, ...] (maps must keep the winding). */
function honeyGeo(key, faces) {
  return geo.custom(`gal-honey:${key}`, () => {
    const pos = [];
    for (const { tris, map } of faces()) for (const [x, y] of tris) pos.push(...map(x, y));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });
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

/** Sleek power-armour leg from the hip pivot: pearl thigh with team stripe, team knee guard, lilac shin, antigrav boot. */
function voidLeg(lg, L, w, m, s) {
  add(lg, geo.sphere(w * 0.5, 5, 3), m.void, [0, -0.01, 0]);
  add(lg, CG.frustum(1.28), m.pearl, [0, -L * 0.25, 0], null, [w, L * 0.44, w * 1.1]);
  add(lg, geo.box(0.022, L * 0.3, w * 0.7), m.team, [s * w * 0.6, -L * 0.24, 0]);
  add(lg, geo.sphere(w * 0.42, 5, 3), m.void, [0, -L * 0.5, 0]);
  add(lg, geo.box(w * 0.92, w * 0.85, 0.04), m.team, [0, -L * 0.5, w * 0.58], [-0.14, 0, 0]);
  add(lg, CG.frustum(1.3), m.lilac, [0, -L * 0.7, 0], null, [w * 0.84, L * 0.34, w * 0.98]);
  add(lg, geo.box(w * 1.12, L * 0.12, w * 1.72), m.gun, [0, -L + L * 0.075, w * 0.28]);
  add(lg, geo.box(w * 1.02, L * 0.07, w * 0.55), m.pearl, [0, -L + L * 0.1, w * 0.28 + w * 0.66]);
  add(lg, geo.box(w * 1.16, L * 0.035, w * 1.5), m.violet, [0, -L + L * 0.0175, w * 0.2]);
}

// Void trooper: elite soldier in sleek iridescent power armour: team chevron, knee guards, pauldron tops
// and crest, an antigrav back-pack with swept fins, a helmet with a glowing violet visor under a halo
// crown fin, and a plasma lance-rifle (glowing magenta core, forked emitter prongs) held level along +Z.
export function void_trooper(tc) {
  const L = 0.44;
  const r = rig({ legLen: L, hipW: 0.088, shoulderX: 0.24, shoulderY: 0.38, neckY: 0.46, legAmp: 0.55 });
  const m = mats(tc);
  const glow = [];
  r.legs.forEach((l, i) => voidLeg(l.obj, L, 0.1, m, i === 0 ? 1 : -1));
  const b = r.body;
  // pelvis + belt, abdomen
  add(b, CG.frustum(1.12), m.gun, [0, -0.02, 0], null, [0.25, 0.12, 0.18]);
  add(b, geo.box(0.11, 0.1, 0.03), m.team, [0, -0.05, 0.096], [-0.15, 0, 0]);
  add(b, mergedBoxes('galVtAbs', [[0.18, 0.04, 0.13, 0, 0.06, 0], [0.19, 0.04, 0.14, 0, 0.105, 0]]), m.void);
  // cuirass: narrow waist widening to the chest, team chevron, glowing core
  add(b, CG.frustum(1.45), m.pearl, [0, 0.27, 0], null, [0.25, 0.28, 0.19]);
  add(b, CG.pennant(), m.teamGlow, [0, 0.4, 0.136], [0.15, 0, -HALF_PI], [0.17, 0.24, 0.02]);
  add(b, geo.box(0.03, 0.15, 0.024), m.pearl, [0, 0.33, 0.14], [0.15, 0, 0]);
  add(b, mergedBoxes('galVtRibs', [[0.04, 0.02, 0.15, 0.115, 0.2, 0, 0, 0], [0.04, 0.02, 0.15, -0.115, 0.2, 0, 0, 0]]), m.rose);
  glowAdd(glow, b, geo.cyl(0.03, 0.03, 0.02, 6), m.magenta, [0, 0.19, 0.112], [HALF_PI + 0.15, 0, 0]);
  add(b, CG.frustum(0.8), m.void, [0, 0.43, 0], null, [0.17, 0.05, 0.14]);
  // swept pauldrons with team tops and iridescent edge fins
  for (const s of [1, -1]) {
    add(b, geo.sphere(0.09, 7, 5), m.pearl, [s * 0.25, 0.39, 0], null, [1.3, 0.8, 1.2]);
    add(b, geo.box(0.16, 0.03, 0.17), m.team, [s * 0.262, 0.47, 0], [0, 0, -s * 0.34]);
    add(b, geo.box(0.022, 0.12, 0.17), m.lilac, [s * 0.35, 0.4, -0.02], [0.3, 0, -s * 0.22]);
  }
  // antigrav pack: team lid, glowing vents, two swept fins
  add(b, geo.box(0.18, 0.21, 0.08), m.pearl, [0, 0.3, -0.13]);
  add(b, geo.box(0.185, 0.025, 0.085), m.team, [0, 0.4, -0.13]);
  add(b, mergedBoxes('galVtVents', [[0.04, 0.12, 0.02, 0.045, 0, 0], [0.04, 0.12, 0.02, -0.045, 0, 0]]), m.violet, [0, 0.29, -0.172]);
  for (const s of [1, -1]) {
    add(b, geo.box(0.02, 0.3, 0.08), m.frost, [s * 0.12, 0.42, -0.2], [-0.55, 0, -s * 0.5]);
    add(b, geo.box(0.024, 0.06, 0.05), m.violet, [s * 0.19, 0.53, -0.27], [-0.55, 0, -s * 0.5]);
  }
  // helmet: pearl shell, dark faceplate, glowing visor, team crest and a halo crown fin
  const h = r.head;
  add(h, geo.sphere(0.1, 8, 6), m.pearl, [0, 0.105, -0.01], null, [0.95, 1.04, 1.16]);
  add(h, geo.box(0.15, 0.068, 0.07), m.glass, [0, 0.1, 0.066]);
  glowAdd(glow, h, geo.box(0.135, 0.024, 0.02), m.violet, [0, 0.105, 0.1]);
  add(h, geo.box(0.1, 0.045, 0.05), m.lilac, [0, 0.045, 0.075]);
  add(h, geo.box(0.026, 0.05, 0.2), m.team, [0, 0.2, -0.02], [0.12, 0, 0]);
  const halo = grp(h, 0, 0.2, -0.1);
  halo.rotation.x = -0.6;
  add(halo, geo.torus(0.12, 0.014, 3, 14), m.pearl);
  glowAdd(glow, halo, geo.torus(0.12, 0.007, 3, 14), m.violet, [0, 0, 0.01]);
  add(halo, mergedBoxes('galVtHaloFins', [[0.022, 0.07, 0.02, 0.1, 0.07, 0, 0, 0], [0.022, 0.07, 0.02, -0.1, 0.07, 0, 0, 0]]), m.pearl);
  // off arm (supports the barrel)
  const aL = r.armL;
  const eL = [-0.1, -0.21, 0.1], hL = [-0.335, -0.19, 0.27];
  beam(aL, [0, 0, 0], eL, 0.08, m.pearl);
  add(aL, geo.sphere(0.045, 5, 3), m.void, eL);
  beam(aL, eL, hL, 0.088, m.pearl);
  beam(aL, lerp3(eL, hL, 0.35), lerp3(eL, hL, 0.75), 0.096, m.team);
  add(aL, geo.box(0.065, 0.07, 0.07), m.void, hL);
  // gun arm: hand on the pistol grip
  const w = r.weapon;
  const eR = [-0.005, -0.19, -0.03], hR = [0.115, -0.165, 0.085];
  beam(w, [0, 0, 0], eR, 0.08, m.pearl);
  add(w, geo.sphere(0.045, 5, 3), m.void, eR);
  beam(w, eR, hR, 0.088, m.pearl);
  beam(w, lerp3(eR, hR, 0.3), lerp3(eR, hR, 0.75), 0.096, m.team);
  add(w, geo.box(0.06, 0.07, 0.07), m.void, hR);
  // plasma lance-rifle in its own frame (axis along +Z), a little oversized so it reads in play
  const gun = grp(w, 0.135, -0.11, 0);
  gun.scale.setScalar(1.2);
  add(gun, geo.box(0.04, 0.07, 0.15), m.pearl, [0, -0.012, -0.075]);
  add(gun, geo.box(0.046, 0.08, 0.024), m.void, [0, -0.012, -0.155]);
  add(gun, profileX('vtRecv', [[-0.01, -0.045], [0.3, -0.045], [0.36, -0.01], [0.33, 0.045], [0.04, 0.05], [-0.01, 0.02]], 0.07), m.pearl);
  add(gun, geo.box(0.074, 0.028, 0.2), m.team, [0, -0.008, 0.15]);
  add(gun, geo.box(0.035, 0.085, 0.045), m.void, [0, -0.08, 0.065], [-0.25, 0, 0]);
  add(gun, geo.box(0.045, 0.06, 0.06), m.void, [0, -0.07, 0.22]);
  // exposed plasma core on top, held by chrome clamps
  glowAdd(glow, gun, geo.cyl(0.021, 0.021, 0.2, 8), m.magenta, [0, 0.07, 0.16], [HALF_PI, 0, 0]);
  add(gun, mergedCyls('vtClamps', [0.07, 0.16, 0.25].map((z) => [0.03, 0.03, 0.022, 0, 0.07, z, HALF_PI, 0, 6])), m.chrome);
  // barrel + forked lance prongs with glowing tips
  add(gun, geo.cyl(0.022, 0.03, 0.3, 8), m.chrome, [0, 0, 0.48], [HALF_PI, 0, 0]);
  add(gun, mergedBoxes('vtProngs', [[0.016, 0.034, 0.34, 0.042, 0, 0.5, -0.07], [0.016, 0.034, 0.34, -0.042, 0, 0.5, 0.07]]), m.pearl);
  add(gun, mergedBoxes('vtProngTips', [[0.018, 0.036, 0.05, 0.03, 0, 0.66, -0.07], [0.018, 0.036, 0.05, -0.03, 0, 0.66, 0.07]]), m.violet);
  add(gun, geo.cyl(0.026, 0.026, 0.03, 8), m.magenta, [0, 0, 0.64], [HALF_PI, 0, 0]);
  muzzle(gun, 0, 0, 0.67);
  scaled(r, 1.08);
  return unitResult(r, 1.3, 0.42, { glow });
}

// Starfighter: small antigravity attack craft hovering ~1.2 above the ground (the whole craft is in
// parts.bob): a faceted pearl fuselage with a violet canopy, swept wings with team stripes and team
// wingtip fins, canted tail fins, two engines with glowing exhausts, a glowing antigrav emitter with a
// faint lift beam, and twin nose cannons (parts.weapon) under the canards.
export function starfighter(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  const hull = grp(root, 0, 1.3, 0);
  // fuselage
  add(hull, loftZ('sfHull', [
    [-1.04, 0.02, 0.16, 0.09, 0.07],
    [-0.9, 0.0, 0.22, 0.13, 0.1],
    [-0.35, 0.0, 0.26, 0.17, 0.12],
    [0.15, 0.0, 0.25, 0.19, 0.12],
    [0.55, -0.01, 0.17, 0.13, 0.09],
    [0.92, -0.025, 0.07, 0.06, 0.05],
    [1.1, -0.03, 0.008, 0.008, 0.008],
  ]), m.pearl);
  add(hull, loftZ('sfKeel', [
    [-0.95, -0.06, 0.12, 0.04, 0.07],
    [0.3, -0.08, 0.14, 0.04, 0.08],
    [0.75, -0.06, 0.06, 0.03, 0.05],
  ]), m.gun);
  // canopy + spine
  add(hull, geo.sphere(0.13, 10, 6), mat(0x6a4ccc, { emissive: 0x3c1c9a, emissiveIntensity: 0.55 }), [0, 0.15, 0.3], null, [0.95, 0.72, 2.2]);
  add(hull, geo.box(0.03, 0.02, 0.52), m.pearl, [0, 0.245, 0.28], [-0.05, 0, 0]);
  add(hull, geo.box(0.07, 0.012, 0.14), m.white, [0.05, 0.235, 0.36], [-0.05, 0.2, 0]);
  add(hull, geo.box(0.16, 0.025, 0.5), m.team, [0, 0.18, -0.32], [0.04, 0, 0]);
  add(hull, geo.box(0.04, 0.03, 0.56), m.lilac, [0, 0.195, -0.32], [0.04, 0, 0]);
  // swept wings with team stripes, iridescent tip bands and canted team wingtip fins
  const wing = sym([[0, 0.45], [0.26, 0.25], [0.86, -0.38], [1.0, -0.5], [1.0, -0.68], [0.82, -0.66], [0.5, -0.72], [0.28, -0.9], [0, -0.86]]);
  add(hull, plateXZ('sfWing', [wing], 0.045), m.pearl, [0, -0.03, 0]);
  const stripe = [[0.3, 0.14], [0.84, -0.43], [0.84, -0.53], [0.3, 0.03]];
  add(hull, plateXZ('sfStripe', [stripe, flipX(stripe)], 0.012), m.teamGlow, [0, -0.003, 0]);
  const band = [[0.5, -0.32], [0.58, -0.4], [0.58, -0.66], [0.5, -0.69]];
  add(hull, plateXZ('sfBand', [band, flipX(band)], 0.012), m.rose, [0, -0.003, 0]);
  const canard = [[0.06, 0.78], [0.38, 0.5], [0.38, 0.43], [0.06, 0.5]];
  add(hull, plateXZ('sfCanard', [canard, flipX(canard)], 0.03), m.lilac, [0, 0.0, 0]);
  for (const s of [1, -1]) {
    add(hull, geo.box(0.025, 0.2, 0.3), m.team, [s * 1.0, -0.08, -0.6], [0.2, 0, s * 0.35]);
    add(hull, geo.box(0.03, 0.03, 0.12), m.violet, [s * 1.03, -0.17, -0.5]);
  }
  // canted tail fins with team tips
  for (const s of [1, -1]) {
    const fin = grp(hull, s * 0.17, 0.12, 0);
    fin.rotation.z = -s * 0.32;
    add(fin, profileX('sfFin', [[-1.02, 0], [-0.52, 0], [-0.84, 0.34], [-1.06, 0.36]], 0.03), m.pearl);
    add(fin, geo.box(0.034, 0.05, 0.22), m.team, [0, 0.33, -0.95]);
  }
  // engines with glowing exhausts
  for (const s of [1, -1]) {
    const x = s * 0.3;
    add(hull, geo.cyl(0.11, 0.13, 0.62, 8), m.gun, [x, 0.0, -0.76], [HALF_PI, 0, 0]);
    add(hull, geo.cyl(0.115, 0.115, 0.05, 8), m.team, [x, 0.0, -0.62], [HALF_PI, 0, 0]);
    add(hull, geo.cyl(0.135, 0.135, 0.06, 8), m.pearl, [x, 0.0, -0.46], [HALF_PI, 0, 0]);
    add(hull, geo.box(0.035, 0.03, 0.42), m.violet, [x, 0.12, -0.78], [-0.03, 0, 0]);
    add(hull, geo.cyl(0.125, 0.11, 0.06, 8), m.chrome, [x, 0.0, -1.06], [HALF_PI, 0, 0]);
    glowAdd(glow, hull, geo.cyl(0.09, 0.09, 0.04, 8), m.violet, [x, 0.0, -1.085], [HALF_PI, 0, 0]);
    add(hull, geo.cone(0.075, 0.2, 8), m.magenta, [x, 0.0, -1.18], [-HALF_PI, 0, 0]).castShadow = false;
  }
  // antigrav emitter under the belly
  add(hull, geo.cyl(0.24, 0.2, 0.05, 12), m.chrome, [0, -0.15, -0.1]);
  glowAdd(glow, hull, geo.cyl(0.18, 0.18, 0.03, 12), m.violet, [0, -0.18, -0.1]);
  // twin nose cannons (parts.weapon), slung under the canards
  const weapon = grp(hull, 0, -0.05, 0.4);
  for (const s of [1, -1]) {
    const x = s * 0.21;
    add(weapon, geo.box(0.09, 0.08, 0.3), m.gun, [x, 0, 0.02]);
    add(weapon, geo.box(0.095, 0.025, 0.2), m.team, [x, 0.045, 0.04]);
    add(weapon, geo.cyl(0.03, 0.038, 0.4, 8), m.pearl, [x, 0, 0.36], [HALF_PI, 0, 0]);
    add(weapon, mergedCyls('sfCoils', [0.26, 0.33, 0.4].map((z) => [0.042, 0.042, 0.02, 0, 0, z, HALF_PI, 0, 8])), m.void, [x, 0, 0]);
    glowAdd(glow, weapon, geo.cyl(0.02, 0.02, 0.1, 6), m.magenta, [x, 0, 0.52], [HALF_PI, 0, 0]);
    add(weapon, geo.cyl(0.034, 0.028, 0.04, 8), m.chrome, [x, 0, 0.58], [HALF_PI, 0, 0]);
    muzzle(weapon, x, 0, 0.61);
  }
  return { root, parts: { bob: [hull], weapon, glow }, height: 1.8, radius: 0.95 };
}

/** Titan leg from the hip pivot down to the ground at y = -H: pearl thigh with team plate, knee guard, armoured shin, antigrav foot. */
function titanLeg(lg, H, s, m) {
  const K = [0, -0.84, 0.16], A = [0, -H + 0.36, -0.04];
  add(lg, geo.cyl(0.24, 0.24, 0.4, 10), m.void, [0, 0, 0], [0, 0, HALF_PI]);
  beam(lg, [0, -0.04, 0.02], K, 0.4, m.pearl, 0.46);
  add(lg, geo.box(0.05, 0.56, 0.4), m.team, [s * 0.22, -0.42, 0.08], [0.19, 0, 0]);
  add(lg, geo.box(0.42, 0.08, 0.5), m.lilac, [0, -0.2, 0.04], [0.19, 0, 0]);
  add(lg, geo.sphere(0.21, 6, 4), m.void, K);
  add(lg, geo.box(0.36, 0.34, 0.14), m.pearl, [0, K[1] + 0.03, K[2] + 0.17], [0.3, 0, 0]);
  add(lg, geo.box(0.16, 0.05, 0.04), m.violet, [0, K[1] + 0.06, K[2] + 0.25], [0.3, 0, 0]);
  beam(lg, K, A, 0.32, m.gun, 0.34);
  beam(lg, [0, K[1] - 0.12, K[2] + 0.12], [0, A[1] + 0.06, A[2] + 0.14], 0.38, m.pearl, 0.1);
  beam(lg, [0, K[1] - 0.2, K[2] + 0.17], [0, A[1] + 0.16, A[2] + 0.19], 0.16, m.team, 0.02);
  for (const t of [1, -1]) rod(lg, [t * 0.17, -0.12, -0.14], [t * 0.17, A[1] + 0.12, A[2] - 0.12], 0.03, m.chrome, 5);
  add(lg, geo.sphere(0.16, 6, 4), m.void, A);
  // foot: armoured wedge with toe cap, heel spur and a glowing antigrav sole
  add(lg, geo.box(0.5, 0.2, 0.82), m.gun, [0, -H + 0.12, 0.06]);
  add(lg, profileX('titanToe', [[0.12, 0], [0.56, 0], [0.56, 0.1], [0.3, 0.24], [0.12, 0.26]], 0.46), m.pearl, [0, -H + 0.02, 0]);
  add(lg, geo.box(0.3, 0.16, 0.2), m.pearl, [0, -H + 0.12, -0.38]);
  add(lg, geo.box(0.54, 0.04, 0.86), m.violet, [0, -H + 0.02, 0.06]);
}

// Titan: colossal bipedal war-titan, the largest unit. Massive armoured legs (parts.legs), a keeled pearl
// torso with team chest plates around a glowing reactor core, a sunken head with a glowing visor under a
// halo crown, shoulder pauldrons carrying tall pylons with floating crystals, a back halo ring and two
// heavy arm cannons that move together as parts.weapon.
export function titan(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  const HY = 1.95;
  const legs = [];
  for (const s of [1, -1]) {
    const lg = grp(root, s * 0.5, HY, 0);
    titanLeg(lg, HY, s, m);
    legs.push({ obj: lg, phase: s > 0 ? 0 : Math.PI, amp: 0.3 });
  }
  const body = grp(root, 0, HY, 0);
  // pelvis + armoured skirt
  add(body, geo.box(0.96, 0.36, 0.62), m.gun, [0, 0.02, 0]);
  add(body, geo.box(0.5, 0.4, 0.06), m.pearl, [0, -0.1, 0.33], [-0.22, 0, 0]);
  add(body, geo.box(0.3, 0.3, 0.02), m.team, [0, -0.08, 0.37], [-0.22, 0, 0]);
  add(body, geo.box(0.5, 0.36, 0.06), m.pearl, [0, -0.08, -0.33], [0.22, 0, 0]);
  for (const s of [1, -1]) add(body, geo.box(0.06, 0.42, 0.5), m.lilac, [s * 0.52, -0.08, 0], [0, 0, s * 0.2]);
  add(body, geo.cyl(0.34, 0.4, 0.3, 8), m.void, [0, 0.33, 0]);
  // keeled torso
  add(body, profileX('titanTorso', [[-0.42, 0.42], [0.36, 0.42], [0.54, 0.72], [0.5, 1.14], [0.26, 1.42], [-0.38, 1.46], [-0.52, 1.1]], 1.2, 0.06), m.pearl);
  add(body, geo.box(1.1, 0.07, 0.86), m.void, [0, 0.47, 0]);
  // team chest plates around the reactor
  for (const s of [1, -1]) {
    add(body, geo.box(0.34, 0.42, 0.05), m.team, [s * 0.36, 0.94, 0.51], [-0.05, s * 0.42, 0]);
    add(body, geo.box(0.06, 0.42, 0.06), m.lilac, [s * 0.18, 0.94, 0.56], [-0.05, s * 0.42, 0]);
  }
  add(body, CG.pennant(), m.teamGlow, [0, 1.36, 0.5], [-0.42, 0, -HALF_PI], [0.24, 0.62, 0.05]);
  for (const s of [1, -1]) add(body, geo.box(0.05, 0.5, 0.5), s > 0 ? m.frost : m.rose, [s * 0.6, 0.95, -0.02]);
  // reactor core: pearl ring, magenta inner ring, white-violet core (glow)
  add(body, geo.torus(0.2, 0.06, 4, 10), m.pearl, [0, 0.9, 0.56], [-0.05, 0, 0]);
  add(body, geo.torus(0.15, 0.025, 3, 10), m.magenta, [0, 0.9, 0.58], [-0.05, 0, 0]);
  glowAdd(glow, body, geo.ico(0.14, 0), m.white, [0, 0.9, 0.55]);
  add(body, geo.cyl(0.16, 0.16, 0.06, 8), m.void, [0, 0.9, 0.5], [HALF_PI, 0, 0]);
  // collar + sunken head with a glowing visor and a halo crown
  add(body, geo.box(0.6, 0.1, 0.5), m.gun, [0, 1.46, 0.08]);
  const head = grp(body, 0, 1.48, 0.2);
  head.scale.setScalar(1.25);
  add(head, profileX('titanHead', [[-0.2, 0], [0.16, 0], [0.26, 0.1], [0.18, 0.24], [-0.18, 0.26]], 0.34, 0.03), m.pearl);
  add(head, geo.box(0.3, 0.07, 0.04), m.glass, [0, 0.13, 0.215], [0, 0, 0]);
  glowAdd(glow, head, geo.box(0.26, 0.035, 0.02), m.violet, [0, 0.135, 0.235]);
  add(head, geo.box(0.04, 0.08, 0.36), m.team, [0, 0.29, -0.02]);
  const halo = grp(head, 0, 0.28, -0.24);
  halo.rotation.x = -0.6;
  add(halo, geo.torus(0.26, 0.03, 3, 14), m.pearl);
  glowAdd(glow, halo, geo.torus(0.26, 0.014, 3, 14), m.violet, [0, 0, 0.02]);
  // massive pauldrons with team tops, carrying tall pylons and floating crystals
  for (const s of [1, -1]) {
    const x = s * 0.78;
    add(body, geo.sphere(0.36, 8, 6), m.pearl, [x, 1.22, 0], null, [1.0, 0.75, 1.1]);
    add(body, geo.box(0.56, 0.06, 0.66), m.team, [x + s * 0.04, 1.47, 0], [0, 0, -s * 0.3]);
    add(body, geo.box(0.06, 0.3, 0.66), m.lilac, [x + s * 0.32, 1.26, 0], [0, 0, -s * 0.12]);
    const px = s * 0.8, pz = -0.14;
    add(body, geo.cyl(0.13, 0.16, 0.12, 6), m.gun, [px, 1.56, pz]);
    add(body, geo.cyl(0.07, 0.12, 0.7, 6), m.pearl, [px, 1.91, pz]);
    add(body, geo.cyl(0.11, 0.11, 0.08, 6), m.team, [px, 1.78, pz]);
    add(body, geo.cyl(0.1, 0.075, 0.06, 6), m.chrome, [px, 2.28, pz]);
    add(body, crystalGeo('titanPylon', 0.07, 0.14, 0.06, 0.08, 6), m.violet, [px, 2.42, pz]);
  }
  // back: reactor spine with vents, halo ring
  add(body, geo.box(0.56, 0.6, 0.2), m.gun, [0, 0.98, -0.52]);
  add(body, geo.box(0.6, 0.06, 0.24), m.team, [0, 1.3, -0.52]);
  add(body, mergedBoxes('titanVents', [-0.16, 0, 0.16].map((x) => [0.08, 0.36, 0.02, x, 0, 0])), m.violet, [0, 0.98, -0.625]);
  add(body, geo.torus(0.5, 0.04, 3, 16), m.lilac, [0, 1.2, -0.66], [0.2, 0, 0]);
  add(body, geo.torus(0.5, 0.018, 3, 16), m.violet, [0, 1.2, -0.62], [0.2, 0, 0]);
  add(body, mergedBoxes('titanHaloStruts', [[0.06, 0.06, 0.2, 0.5, 0, 0.06], [0.06, 0.06, 0.2, -0.5, 0, 0.06]]), m.gun, [0, 1.2, -0.66]);
  // twin arm cannons (one group = parts.weapon), pivoted on the shoulder line
  const weapon = grp(body, 0, 1.18, 0);
  for (const s of [1, -1]) {
    const x = s * 0.98;
    add(weapon, geo.sphere(0.2, 6, 4), m.void, [s * 0.86, 0, 0]);
    add(weapon, geo.box(0.26, 0.48, 0.3), m.gun, [x, -0.28, 0]);
    add(weapon, geo.box(0.04, 0.36, 0.26), m.team, [x + s * 0.15, -0.26, 0]);
    add(weapon, geo.sphere(0.17, 6, 4), m.void, [x, -0.54, 0]);
    // cannon housing
    add(weapon, profileX('titanCannon', [[-0.28, -0.2], [0.62, -0.2], [0.72, -0.08], [0.66, 0.16], [-0.18, 0.2], [-0.32, 0.04]], 0.34, 0.03), m.pearl, [x, -0.66, 0]);
    add(weapon, geo.box(0.03, 0.22, 0.7), m.team, [x + s * 0.17, -0.66, 0.2]);
    add(weapon, geo.box(0.16, 0.03, 0.6), m.team, [x, -0.47, 0.2], [0.05, 0, 0]);
    add(weapon, geo.box(0.032, 0.05, 0.5), m.violet, [x - s * 0.17, -0.74, 0.22]);
    // barrel: shroud, coils, glowing core, muzzle crown
    add(weapon, geo.cyl(0.11, 0.13, 0.3, 10), m.chrome, [x, -0.68, 0.84], [HALF_PI, 0, 0]);
    glowAdd(glow, weapon, geo.cyl(0.07, 0.07, 0.26, 8), m.violet, [x, -0.68, 1.06], [HALF_PI, 0, 0]);
    add(weapon, mergedCyls('titanCoils', [0.98, 1.06, 1.14].map((z) => [0.11, 0.11, 0.03, 0, 0, z, HALF_PI, 0, 10])), m.void, [x, -0.68, 0]);
    add(weapon, geo.cyl(0.1, 0.085, 0.07, 10), m.pearl, [x, -0.68, 1.22], [HALF_PI, 0, 0]);
    muzzle(weapon, x, -0.68, 1.27);
  }
  return { root, parts: { body, legs, weapon, glow }, height: 4.5, radius: 1.3 };
}

// Graviton: antigravity artillery. A hexagonal pearl platform hovers ~0.4 above the ground on glowing
// antigrav pads (parts.bob), with outrigger pods and team armour; at the back a gravity core is held by
// two tilted containment rings (parts.spin, glowing); on top a long gravity-lance (parts.weapon): twin
// team-striped rails threaded with floating violet rings and a glowing tip, resting elevated in an inner
// group so the weapon group itself rests at rotation 0.
export function graviton(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  const base = grp(root, 0, 0.4, 0);
  // hexagonal hover platform (pointed fore and aft), dark keel, team band, lilac deck
  const hs = [1, 1, 1.12];
  add(base, geo.cyl(0.78, 0.6, 0.2, 6), m.gun, [0, 0.1, 0], null, hs);
  add(base, geo.cyl(0.86, 0.8, 0.14, 6), m.pearl, [0, 0.27, 0], null, hs);
  add(base, geo.cyl(0.875, 0.875, 0.05, 6), m.team, [0, 0.365, 0], null, hs);
  add(base, geo.cyl(0.76, 0.84, 0.07, 6), m.pearl, [0, 0.425, 0], null, hs);
  add(base, geo.cyl(0.6, 0.6, 0.02, 6), m.lilac, [0, 0.465, 0], null, hs);
  add(base, mergedBoxes('gvDeckLines', [[0.035, 0.012, 0.5, 0.11, 0, -0.16], [0.035, 0.012, 0.5, -0.11, 0, -0.16]]), m.violet, [0, 0.48, 0]);
  add(base, plateXZ('gvChevron', [[[0, 0.84], [0.42, 0.6], [0.42, 0.48], [0, 0.72]], [[0, 0.84], [0, 0.72], [-0.42, 0.48], [-0.42, 0.6]]], 0.03), m.teamGlow, [0, 0.47, 0]);
  add(base, plateXZ('gvRearPlates', [[[0.36, -0.5], [0.62, -0.36], [0.62, -0.22], [0.36, -0.36]], [[-0.36, -0.36], [-0.62, -0.22], [-0.62, -0.36], [-0.36, -0.5]]], 0.03), m.frost, [0, 0.47, 0]);
  // antigrav pads
  for (const [x, z] of [[0, 0.5], [0.42, -0.3], [-0.42, -0.3]]) {
    add(base, geo.cyl(0.21, 0.21, 0.04, 10), m.chrome, [x, 0.0, z]);
    glowAdd(glow, base, geo.cyl(0.17, 0.13, 0.04, 10), m.violet, [x, -0.03, z]);
  }
  // outrigger pods with team noses and glowing tails
  for (const s of [1, -1]) {
    const x = s * 0.84;
    add(base, loftZ('gvPod', [
      [-0.42, 0, 0.04, 0.04, 0.04], [-0.32, 0, 0.11, 0.11, 0.1], [0.2, 0, 0.11, 0.11, 0.1], [0.42, 0, 0.02, 0.02, 0.02],
    ]), m.pearl, [x, 0.24, -0.05]);
    add(base, geo.box(0.04, 0.05, 0.36), m.team, [x + s * 0.1, 0.25, -0.05]);
    add(base, geo.box(0.16, 0.06, 0.14), m.gun, [s * 0.74, 0.24, -0.05]);
    add(base, geo.cyl(0.07, 0.07, 0.03, 8), m.violet, [x, 0.24, -0.47], [HALF_PI, 0, 0]);
  }
  // front team armour plate with a glowing chevron
  add(base, geo.box(0.5, 0.12, 0.04), m.team, [0, 0.3, 0.86], [-0.3, 0, 0]);
  // gravity core: a void singularity in a glowing accretion disk, held by containment rings (spin)
  const cz = -0.42, cy = 0.84;
  add(base, geo.cyl(0.26, 0.32, 0.1, 6), m.gun, [0, 0.5, cz]);
  add(base, geo.cyl(0.08, 0.18, 0.16, 6), m.chrome, [0, 0.6, cz]);
  add(base, geo.sphere(0.13, 10, 8), mat(0x241040, { emissive: 0x4a12a0, emissiveIntensity: 0.6 }), [0, cy, cz]);
  glowAdd(glow, base, lathe('gvDisk', [[0.15, -0.012], [0.25, -0.004], [0.25, 0.004], [0.15, 0.012]], 16), m.magenta, [0, cy, cz], [0.25, 0, 0]);
  const spin = grp(base, 0, cy, cz);
  const ringA = grp(spin, 0, 0, 0);
  ringA.rotation.set(HALF_PI + 0.55, 0, 0.25);
  glowAdd(glow, ringA, geo.torus(0.33, 0.026, 4, 24), m.violet);
  add(ringA, mergedBoxes('gvBeadsA', [0, 1, 2, 3].map((k) => [0.07, 0.07, 0.07, Math.cos((k * TAU) / 4) * 0.33, Math.sin((k * TAU) / 4) * 0.33, 0, 0, 0])), m.pearl);
  const ringB = grp(spin, 0, 0, 0);
  ringB.rotation.set(HALF_PI - 0.6, 0, -0.5);
  glowAdd(glow, ringB, geo.torus(0.27, 0.022, 4, 24), m.white);
  add(ringB, mergedBoxes('gvBeadsB', [0, 1, 2].map((k) => [0.06, 0.06, 0.06, Math.cos((k * TAU) / 3 + 0.5) * 0.27, Math.sin((k * TAU) / 3 + 0.5) * 0.27, 0, 0, 0])), m.team);
  // lance mount: hex turret with trunnion cheeks
  add(base, geo.cyl(0.3, 0.36, 0.12, 6), m.pearl, [0, 0.52, 0.14]);
  add(base, geo.cyl(0.31, 0.31, 0.04, 6), m.team, [0, 0.6, 0.14]);
  for (const s of [1, -1]) add(base, profileX('gvCheek', [[-0.14, 0], [0.16, 0], [0.08, 0.24], [-0.1, 0.24]], 0.06), m.lilac, [s * 0.2, 0.6, 0.12]);
  // gravity lance (parts.weapon): pivot on the trunnions, elevated in an inner group
  const weapon = grp(base, 0, 0.8, 0.12);
  const lance = grp(weapon, 0, 0, 0);
  lance.rotation.x = -0.45;
  add(lance, geo.cyl(0.07, 0.07, 0.34, 8), m.void, [0, 0, 0], [0, 0, HALF_PI]);
  add(lance, profileX('gvBreech', [[-0.34, -0.12], [0.2, -0.13], [0.3, -0.04], [0.26, 0.12], [-0.22, 0.14], [-0.36, 0.04]], 0.3, 0.03), m.pearl);
  for (const s of [1, -1]) add(lance, geo.box(0.02, 0.12, 0.34), m.team, [s * 0.151, 0, -0.04]);
  add(lance, geo.box(0.16, 0.12, 0.08), m.void, [0, 0, -0.4]);
  for (const s of [1, -1]) {
    add(lance, geo.box(0.05, 0.08, 1.12), m.pearl, [s * 0.1, 0, 0.78]);
    add(lance, geo.box(0.052, 0.022, 0.9), m.team, [s * 0.1, 0.05, 0.72]);
  }
  add(lance, geo.cyl(0.032, 0.032, 1.1, 6), m.chrome, [0, 0, 0.8], [HALF_PI, 0, 0]);
  add(lance, mergedTori('gvLanceRings', [0.5, 0.74, 0.98, 1.22].map((z, i) => [0.15 - i * 0.012, 0.02, 0, 0, z, 0, 0, 0, 4, 12])), m.violet);
  add(lance, mergedBoxes('gvForks', [[0.05, 0.06, 0.14, 0.085, 0, 1.36, -0.25], [0.05, 0.06, 0.14, -0.085, 0, 1.36, 0.25]]), m.lilac);
  glowAdd(glow, lance, crystalGeo('gvTip', 0.05, 0.1, 0.06, 0.1, 6), m.white, [0, 0, 1.38], [HALF_PI, 0, 0]);
  muzzle(lance, 0, 0, 1.5);
  return { root, parts: { bob: [base], weapon, spin: [spin], glow }, height: 1.8, radius: 1.0 };
}

// ===========================================================================
// Buildings
// ===========================================================================

/** Big team emblem: pearl hex rim, glowing team hex plate and a white four-point star (faces +Z). */
function emblemGeo() {
  return geo.custom('gal:emblemStar', () => {
    const s = new THREE.Shape();
    const pts = [];
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const r = k % 2 ? 0.1 : 0.3;
      pts.push([Math.sin(a) * r, Math.cos(a) * r]);
    }
    s.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < 8; k++) s.lineTo(pts[k][0], pts[k][1]);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false });
    g.translate(0, 0, -0.02);
    return g;
  });
}

// Galactic Citadel (4x4 town center): a stepped octagonal base on a square team-trimmed foundation, an
// inner hall drum with glowing windows and four portals, eight sweeping iridescent petals with glowing
// edges, a ribbed central tower around a glowing core holding a radiant cradle, and above it a huge
// floating crystal spire with satellite shards (parts.bob) inside two tilted orbiting rings (parts.spin).
// A big glowing team emblem crowns the front portal; corner obelisks carry floating crystals.
export function galactic_citadel(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  const bob = [];
  const OCT = 1 / Math.cos(Math.PI / 8); // octagon circumradius per unit apothem
  // foundation + terraces
  add(root, roundSlab(3.86, 3.86, 0.12, 0.5), m.void);
  add(root, roundSlab(3.78, 3.78, 0.05, 0.46), m.team, [0, 0.12, 0]);
  add(root, roundSlab(3.66, 3.66, 0.06, 0.42), m.gun, [0, 0.17, 0]);
  add(root, geo.cyl(1.62 * OCT, 1.76 * OCT, 0.2, 8), m.pearl, [0, 0.33, 0], [0, Math.PI / 8, 0]);
  add(root, geo.cyl(1.6 * OCT, 1.6 * OCT, 0.04, 8), m.lilac, [0, 0.45, 0], [0, Math.PI / 8, 0]);
  const b = 0.47;
  // radiant deck: violet spokes + a glowing ring around the hall
  const spokes = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    spokes.push([0.05, 0.012, 0.36, Math.sin(a) * 1.4, 0, Math.cos(a) * 1.4, a]);
  }
  add(root, mergedBoxes('citSpokes', spokes), m.violet, [0, b, 0]);
  glowAdd(glow, root, geo.ring(1.27, 1.34, 32), m.white, [0, b + 0.006, 0], [-HALF_PI, 0, 0]);
  // inner hall drum with window band and team cornice
  add(root, lathe('citDrum', [[0.4, b], [1.26, b], [1.24, b + 0.5], [1.14, b + 0.78], [0.96, b + 0.9], [0.4, b + 0.9]], 24), m.pearl);
  const winArcs = [];
  for (let k = 0; k < 8; k++) winArcs.push([k * (Math.PI / 4) + 0.2, Math.PI / 4 - 0.4]);
  add(root, latheArcs('citWin', [[1.252, b + 0.16], [1.272, b + 0.16], [1.262, b + 0.4], [1.242, b + 0.4]], winArcs, 2), m.white);
  add(root, geo.cyl(1.2, 1.2, 0.05, 24), m.team, [0, b + 0.805, 0]);
  // four portals (cardinal) with team lintels
  for (let k = 0; k < 4; k++) {
    const g = grp(root, 0, b, 0, (k * Math.PI) / 2);
    add(g, geo.box(0.5, 0.62, 0.34), m.lilac, [0, 0.31, 1.2]);
    add(g, geo.box(0.32, 0.46, 0.02), m.glass, [0, 0.23, 1.375]);
    add(g, mergedBoxes('citPortalFrame', [[0.03, 0.48, 0.02, 0.175, 0.24, 0], [0.03, 0.48, 0.02, -0.175, 0.24, 0], [0.38, 0.03, 0.02, 0, 0.475, 0]]), m.violet, [0, 0, 1.385]);
    add(g, geo.box(0.58, 0.07, 0.4), m.team, [0, 0.655, 1.2]);
  }
  // eight sweeping petals (diagonals between the portals) with glowing outer edges and team bands
  const petal = profileX('citPetal', [[1.66, b], [1.7, b + 0.24], [1.54, b + 0.9], [1.26, b + 1.6], [0.9, b + 2.2], [0.6, b + 2.62], [0.44, b + 2.62], [0.44, b + 2.3], [0.8, b + 1.72], [1.04, b + 1.06], [1.14, b + 0.46], [1.12, b]], 0.15);
  const edge = profileX('citPetalEdge', [[1.72, b + 0.24], [1.555, b + 0.91], [1.275, b + 1.61], [0.915, b + 2.21], [0.615, b + 2.635], [0.56, b + 2.6], [0.86, b + 2.18], [1.22, b + 1.58], [1.5, b + 0.88], [1.66, b + 0.25]], 0.07);
  const petalTeam = profileX('citPetalTeam', [[1.62, b + 0.5], [1.5, b + 0.95], [1.12, b + 0.95], [1.15, b + 0.5]], 0.17);
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    add(root, petal, k % 2 ? m.lilac : m.pearl, [0, 0, 0], [0, a, 0]);
    add(root, edge, m.white, [0, 0, 0], [0, a, 0]);
    add(root, petalTeam, m.team, [0, 0, 0], [0, a, 0]);
  }
  // central tower: glowing core inside tapering ribs, tier rings
  const ty = b + 0.86, TH = 2.0;
  glowAdd(glow, root, geo.cyl(0.2, 0.36, TH - 0.1, 12), m.violet, [0, ty + (TH - 0.1) / 2, 0]);
  add(root, spireFins('citRibs', 6, 0.22, 0.26, 0.56, TH, 0.62), m.pearl, [0, ty, 0], [0, Math.PI / 6, 0]);
  const rRib = (y) => 0.56 * (1 - 0.38 * ((y - ty) / TH));
  for (const [y, h, mm] of [[ty + 0.55, 0.1, m.team], [ty + 1.25, 0.08, m.lilac], [ty + 1.7, 0.08, m.team]]) {
    add(root, geo.cyl(rRib(y + h / 2) + 0.03, rRib(y - h / 2) + 0.03, h, 12), mm, [0, y, 0]);
  }
  // radiant cradle: dish, glowing lens and four curved prongs
  const cy = ty + TH;
  add(root, lathe('citCradle', [[0.2, cy - 0.06], [0.44, cy + 0.02], [0.66, cy + 0.2], [0.6, cy + 0.24], [0.4, cy + 0.12], [0.2, cy + 0.1]], 16), m.pearl);
  add(root, geo.cyl(0.42, 0.42, 0.03, 16), m.white, [0, cy + 0.11, 0]);
  add(root, geo.custom('gal:citProngs', () => {
    const list = [];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const g = new THREE.BoxGeometry(0.07, 0.56, 0.12);
      g.translate(0, 0.28, 0);
      g.rotateX(-0.42);
      g.translate(0, 0, 0.6);
      g.rotateY(a);
      g.translate(0, cy + 0.14, 0);
      list.push(g);
    }
    const g = mergeGeometries(list, false);
    for (const p of list) p.dispose();
    return g;
  }), m.lilac);
  // floating crystal spire with satellite shards (bob)
  const fl = grp(root, 0, cy + 0.98, 0);
  bob.push(fl);
  glowAdd(glow, fl, crystalGeo('citSpire', 0.4, 1.95, 0.5, 0.74, 6), mat(0xf0e0ff, { emissive: 0xa860ff, emissiveIntensity: 0.8 }));
  add(fl, mergedBoxes('citSpireBands', [[0.06, 0.5, 0.02, 0, 0.25, 0.41]]), m.white);
  for (let k = 0; k < 3; k++) {
    const a = (k * TAU) / 3 + 0.4;
    add(fl, crystalGeo('citShard', 0.1, 0.3, 0.1, 0.2, 5), m.violet, [Math.sin(a) * 0.64, 0.3 + k * 0.32, Math.cos(a) * 0.64]);
  }
  // orbiting rings (spin): two tilted rings with nodes
  const orbit = grp(root, 0, cy + 1.5, 0);
  const t1 = grp(orbit, 0, 0, 0);
  t1.rotation.set(0.28, 0, 0.1);
  add(t1, geo.torus(1.12, 0.05, 4, 24), m.pearl, [0, 0, 0], [HALF_PI, 0, 0]);
  glowAdd(glow, t1, geo.torus(1.05, 0.025, 3, 24), m.violet, [0, 0, 0], [HALF_PI, 0, 0]);
  add(t1, mergedBoxes('citNodes', [0, 1, 2].map((k) => {
    const a = (k * TAU) / 3;
    return [0.2, 0.12, 0.24, Math.sin(a) * 1.12, 0, Math.cos(a) * 1.12, a];
  })), m.team);
  const t2 = grp(orbit, 0, 0.55, 0);
  t2.rotation.set(-0.36, 0, -0.2);
  add(t2, geo.torus(0.82, 0.04, 4, 20), m.lilac, [0, 0, 0], [HALF_PI, 0, 0]);
  add(t2, mergedBoxes('citNodes2', [0, 1, 2].map((k) => {
    const a = (k * TAU) / 3 + 1;
    return [0.12, 0.12, 0.12, Math.sin(a) * 0.82, 0, Math.cos(a) * 0.82, a];
  })), m.white);
  // big team emblem over the front portal
  const em = grp(root, 0, ty + 0.62, 0.95);
  em.rotation.x = -0.3;
  add(em, geo.torus(0.44, 0.05, 4, 6), m.pearl, [0, 0, 0], [0, 0, Math.PI / 6]);
  glowAdd(glow, em, geo.cyl(0.42, 0.42, 0.05, 6), m.teamGlow, [0, 0, -0.01], [HALF_PI, Math.PI / 6, 0]);
  add(em, emblemGeo(), m.white, [0, 0, 0.03]);
  add(em, geo.box(0.12, 0.5, 0.08), m.gun, [0, -0.36, -0.12], [0.3, 0, 0]);
  // corner obelisks with floating crystals (bob)
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const x = sx * 1.56, z = sz * 1.56;
    add(root, geo.cyl(0.2, 0.24, 0.1, 6), m.gun, [x, 0.28, z]);
    add(root, geo.cyl(0.06, 0.12, 0.72, 6), m.pearl, [x, 0.69, z]);
    add(root, geo.cyl(0.11, 0.11, 0.06, 6), m.team, [x, 0.48, z]);
    add(root, geo.cyl(0.1, 0.07, 0.06, 6), m.chrome, [x, 1.07, z]);
    const c = grp(root, x, 1.3, z);
    bob.push(c);
    add(c, crystalGeo('citCorner', 0.09, 0.2, 0.08, 0.12, 6), m.violet);
  }
  return { root, parts: { bob, spin: [orbit], glow }, height: 7.0, radius: 1.95 };
}

// Floating habitat (2x2): a landing pad with a glowing lift ring, an antigrav pylon with a glowing emitter
// orb, and above it a saucer-dome pod (parts.bob) with a team rim, glowing window band, team-framed door,
// iridescent dome bands, a skylight and a little halo; crystal planters and light posts on the pad.
export function house_galactic(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  add(root, roundSlab(1.92, 1.92, 0.08, 0.3), m.gun);
  add(root, roundSlab(1.84, 1.84, 0.04, 0.27), m.team, [0, 0.08, 0]);
  add(root, roundSlab(1.74, 1.74, 0.03, 0.24), m.pearl, [0, 0.12, 0]);
  const b = 0.15;
  add(root, annulus(0.56, 0.62, 0.012, 24), m.violet, [0, b, 0]);
  // antigrav pylon
  add(root, geo.cyl(0.3, 0.36, 0.12, 6), m.lilac, [0, b + 0.06, 0]);
  add(root, geo.cyl(0.1, 0.19, 0.56, 6), m.pearl, [0, b + 0.4, 0]);
  add(root, geo.cyl(0.19, 0.2, 0.05, 6), m.team, [0, b + 0.26, 0]);
  add(root, geo.cyl(0.2, 0.1, 0.1, 8), m.chrome, [0, b + 0.73, 0]);
  glowAdd(glow, root, geo.sphere(0.085, 8, 6), m.violet, [0, b + 0.84, 0]);
  // pod (bob): saucer hull with a flared team rim, glowing window band, iridescent dome bands
  const pod = grp(root, 0, 1.2, 0);
  const R = 0.64;
  add(pod, hemi(18, 4), m.pearl, [0, 0.18, 0], [Math.PI, 0, 0], [R - 0.04, 0.18, R - 0.04]);
  add(pod, geo.torus(0.26, 0.028, 3, 14), m.violet, [0, 0.04, 0], [HALF_PI, 0, 0]);
  add(pod, lathe('habGalRim', [[R - 0.06, 0.15], [R + 0.08, 0.2], [R + 0.08, 0.25], [R - 0.06, 0.27]], 20), m.team);
  add(pod, geo.cyl(R - 0.04, R - 0.02, 0.22, 20), m.pearl, [0, 0.37, 0]);
  const winArcs = [];
  for (let k = 0; k < 6; k++) winArcs.push([k * (TAU / 6) + 0.75, TAU / 6 - 0.32]);
  add(pod, latheArcs('habGalWin', [[R - 0.035, 0.3], [R - 0.012, 0.3], [R - 0.016, 0.43], [R - 0.039, 0.43]], winArcs, 3), m.white);
  add(pod, geo.cyl(R - 0.03, R - 0.03, 0.03, 20), m.lilac, [0, 0.495, 0]);
  // dome in iridescent bands (pearl, rose, lilac, frost), a team crown and a glowing skylight
  const DR = R - 0.05, DH = 0.46, el = (t) => [DR * Math.cos(t), 0.51 + DH * Math.sin(t)];
  const band = (t0, t1) => {
    const [r0, y0] = el(t0), [r1, y1] = el((t0 + t1) / 2), [r2, y2] = el(t1);
    return [[0, y0], [r0, y0], [r1 + 0.012, y1], [r2, y2], [0, y2]];
  };
  const bands = [[0, 0.42, m.pearl], [0.42, 0.78, m.rose], [0.78, 1.08, m.lilac], [1.08, 1.32, m.frost]];
  bands.forEach(([t0, t1, mm], i) => add(pod, lathe(`habGalDome${i}`, band(t0, t1), 18), mm));
  const [rc, yc] = el(1.32);
  add(pod, annulus(rc - 0.04, rc + 0.03, 0.05, 16), m.team, [0, yc - 0.01, 0]);
  add(pod, hemi(10, 3), m.white, [0, yc + 0.02, 0], null, [rc - 0.03, 0.07, rc - 0.03]);
  // halo above the dome
  const halo = grp(pod, 0, yc + 0.2, 0);
  add(halo, geo.torus(0.24, 0.022, 3, 16), m.pearl, [0, 0, 0], [HALF_PI, 0, 0]);
  add(halo, geo.torus(0.24, 0.012, 3, 16), m.violet, [0, -0.02, 0], [HALF_PI, 0, 0]);
  add(halo, mergedBoxes('habGalHaloStruts', [[0.025, 0.14, 0.025, 0.22, -0.09, 0], [0.025, 0.14, 0.025, -0.22, -0.09, 0]]), m.pearl);
  // door on the pod front
  const dg = grp(pod, 0, 0.27, R - 0.05);
  add(dg, geo.box(0.3, 0.24, 0.08), m.team, [0, 0.12, 0.02]);
  add(dg, geo.box(0.22, 0.19, 0.06), m.gun, [0, 0.105, 0.05]);
  add(dg, geo.box(0.24, 0.025, 0.03), m.violet, [0, 0.22, 0.065]);
  // crystal planters + light posts on the pad
  for (const [x, z] of [[0.62, 0.62], [-0.62, -0.62]]) {
    add(root, geo.cyl(0.16, 0.13, 0.12, 6), m.lilac, [x, b + 0.06, z]);
    add(root, geo.cyl(0.14, 0.14, 0.02, 6), m.void, [x, b + 0.12, z]);
    add(root, crystalGeo('habGalShardA', 0.045, 0.12, 0.08, 0.02, 5), m.magenta, [x, b + 0.13, z], [0.2, 0, 0.15]);
    add(root, crystalGeo('habGalShardB', 0.035, 0.08, 0.05, 0.02, 5), m.violet, [x + 0.07, b + 0.13, z - 0.04], [-0.3, 0, -0.35]);
    add(root, crystalGeo('habGalShardB', 0.035, 0.08, 0.05, 0.02, 5), m.violet, [x - 0.06, b + 0.13, z + 0.05], [0.35, 0, 0.3]);
  }
  for (const [x, z] of [[-0.66, 0.66], [0.66, -0.66]]) {
    add(root, geo.cyl(0.025, 0.04, 0.5, 6), m.pearl, [x, b + 0.25, z]);
    add(root, geo.cyl(0.045, 0.045, 0.03, 6), m.team, [x, b + 0.3, z]);
    add(root, geo.octa(0.05), m.white, [x, b + 0.56, z]);
  }
  return { root, parts: { bob: [pod], glow }, height: 2.4, radius: 0.95 };
}

// ===========================================================================
// Fortifications
// The force wall fills its whole 1x1 cell: a hex-paneled emitter plinth, then a full-cell energy block
// whose four sides carry a honeycomb pattern with period 1/2 along the wall, so neighbours in any of the 8
// directions join into one continuous hex shield. The bright lattice block and the side cells are static;
// the hex cells on the top pulse in-plane (parts.glow, origin on the top plane). A hexagonal emitter
// pylon crowned with a floating crystal rises through the middle of every cell.
// Gate: 2x2, wall line along X, passage along Z; pylon towers flush at x = +-1. parts.doors = [{ obj, side }]
// with obj a Group on the hinge; the game sets obj.rotation.y = side * open * 1.4 (both swing to -Z).
// ===========================================================================

const WALL_TOP = 0.46; // plinth top = field base
const FIELD_H = 1.04; // energy field height
const LATTICE = () => mat(0xf7efff, { emissive: 0xd2a6ff, emissiveIntensity: 0.8 });
const CELLS = () => mat(0xa47cff, { emissive: 0x7444ee, emissiveIntensity: 0.7 });

/** Wall plinth (fills [-w/2, w/2] x [-d/2, d/2]) with team band and pearl cap course. */
function forcePlinth(parent, m, w = 1, d = 1, x = 0, z = 0) {
  add(parent, geo.box(w, 0.1, d), m.void, [x, 0.05, z]);
  add(parent, geo.box(w - 0.01, 0.25, d - 0.01), m.gun, [x, 0.225, z]);
  add(parent, geo.box(w, 0.05, d), m.teamGlow, [x, 0.375, z]);
  add(parent, geo.box(w, 0.06, d), m.pearl, [x, 0.43, z]);
}

/** Hex relief plates centered on the four faces of the 1x1 plinth. */
const plinthHexes = () => mergedCyls('forceHexes', [
  [0.12, 0.12, 0.03, 0, 0.22, 0.488, HALF_PI, 0, 6], [0.12, 0.12, 0.03, 0, 0.22, -0.488, HALF_PI, 0, 6],
  [0.12, 0.12, 0.03, 0.488, 0.22, 0, 0, HALF_PI, 6], [0.12, 0.12, 0.03, -0.488, 0.22, 0, 0, HALF_PI, 6],
]);

/** Honeycomb cells on the four sides of the 1 x FIELD_H x 1 field block (origin at its center); period 1/2 along the wall. */
const fieldSideCells = () => honeyGeo(`forceSides${FIELD_H}`, () => {
  const hh = FIELD_H / 2, e = 0.5 + 0.004;
  const tris = honeyTris(-0.5, 0.5, -hh, hh, 0.25, 1 / 3, 0.8, 0, -hh + 1 / 6);
  const faces = [];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
    faces.push({ tris, map: (x, y) => [x * c + e * s, y, -x * s + e * c] });
  }
  return faces;
});

/**
 * Honeycomb cells on the field top, origin on the top plane, so the glow pulse only breathes them
 * in-plane (they can never sink into the block); kept 0.04 inside the cell edges so the +8% pulse
 * stays inside the cell (no overlap with a neighbour's top).
 */
const fieldTopCells = () => honeyGeo('forceTop', () => [
  { tris: honeyTris(-0.46, 0.46, -0.46, 0.46, 0.25, 1 / 3, 0.8, 0, 1 / 6), map: (x, y) => [x, 0, -y] },
]);

export function wall_force(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  forcePlinth(root, m);
  add(root, plinthHexes(), m.lilac);
  // energy field: static bright lattice block + pulsing hex cells
  const fy = WALL_TOP + FIELD_H / 2;
  add(root, geo.box(1, FIELD_H, 1), LATTICE(), [0, fy, 0]).castShadow = false;
  add(root, fieldSideCells(), CELLS(), [0, fy, 0]).castShadow = false;
  glowAdd(glow, root, fieldTopCells(), CELLS(), [0, WALL_TOP + FIELD_H + 0.004, 0]).castShadow = false;
  // hexagonal emitter pylon through the middle, crowned with a floating crystal
  const top = WALL_TOP + FIELD_H;
  add(root, geo.cyl(0.2, 0.22, 0.06, 6), m.lilac, [0, top + 0.03, 0]);
  add(root, geo.cyl(0.11, 0.14, 0.24, 6), m.pearl, [0, top + 0.16, 0]);
  add(root, geo.cyl(0.14, 0.145, 0.06, 6), m.team, [0, top + 0.14, 0]);
  add(root, geo.cyl(0.13, 0.1, 0.04, 6), m.chrome, [0, top + 0.3, 0]);
  glowAdd(glow, root, crystalGeo('forceTip', 0.06, 0.1, 0.04, 0.06, 6), m.violet, [0, top + 0.42, 0]);
  return { root, parts: { glow }, height: 2.0, radius: 0.5 };
}

/**
 * One gate leaf on its hinge: a pearl frame with a team crossbar holding a glowing hex pane. The leaf
 * extends toward +X (dir = 1) or -X (dir = -1) with its front face on the hinge plane, so
 * rotation.y = dir * angle swings it toward -Z.
 */
function forceLeaf(parent, glow, m, x, z, dir, w, h) {
  const hinge = grp(parent, x, 0, z);
  const t = 0.07, fb = 0.07, y0 = 0.04;
  const cx = (dir * w) / 2;
  add(hinge, mergedBoxes(`galLeafFrame:${dir}`, [
    [w, fb, t, cx, y0 + fb / 2, -t / 2],
    [w, fb, t, cx, y0 + h - fb / 2, -t / 2],
    [fb, h, t, dir * (fb / 2), y0 + h / 2, -t / 2],
    [fb, h, t, dir * (w - fb / 2), y0 + h / 2, -t / 2],
  ]), m.pearl);
  add(hinge, geo.box(w - fb, 0.07, t + 0.014), m.team, [cx, y0 + h * 0.36, -t / 2]);
  add(hinge, mergedBoxes(`galLeafHinge:${dir}`, [[0.05, 0.14, t + 0.04, dir * 0.02, y0 + 0.3, -t / 2], [0.05, 0.14, t + 0.04, dir * 0.02, y0 + h - 0.3, -t / 2]]), m.gun);
  const pw = w - 2 * fb + 0.02, ph = h - 2 * fb + 0.02;
  add(hinge, geo.box(pw, ph, 0.02), LATTICE(), [cx, y0 + h / 2, -t / 2]).castShadow = false;
  const pane = glowAdd(glow, hinge, honeyGeo(`galLeafCells:${pw.toFixed(3)},${ph.toFixed(3)}`, () => {
    const tris = honeyTris(-pw / 2, pw / 2, -ph / 2, ph / 2, 0.1, 0.14, 0.8, 0, 0);
    return [
      { tris, map: (px, py) => [px, py, 0.013] },
      { tris, map: (px, py) => [-px, py, -0.013] },
    ];
  }), CELLS(), [cx, y0 + h / 2, -t / 2]);
  pane.castShadow = false;
  return { obj: hinge, side: dir };
}

export function gate_force(tc) {
  const root = new THREE.Group();
  const m = mats(tc);
  const glow = [];
  const PW = 0.55, GZ = 0.96, pw = 1 - PW;
  // passage floor with violet guide lights
  add(root, geo.box(2 * PW, 0.04, 2 * GZ), m.gun, [0, 0.02, 0]);
  add(root, mergedBoxes('galGateGuides', [-0.75, -0.45, -0.15, 0.15, 0.45, 0.75].flatMap((z) => [[0.05, 0.012, 0.12, 0.42, 0.045, z], [0.05, 0.012, 0.12, -0.42, 0.045, z]])), m.violet);
  for (const s of [1, -1]) {
    const x = s * (PW + pw / 2);
    // full-depth base with sloped ends, then the plinth course matching the walls
    add(root, geo.box(pw, 0.28, 2 * GZ), m.void, [x, 0.14, 0]);
    add(root, CG.frustum(0.84), m.lilac, [x, 0.36, 0], null, [pw, 0.16, 2 * GZ]);
    forcePlinth(root, m, pw, 1.12, x, 0);
    // pylon tower: outer face flush with x = +-1, team panels front and back with hex badges, emitter strip inside
    const tw = pw - 0.03, tx = s * (1 - tw / 2), TH = 1.5;
    add(root, geo.box(tw, TH, 1.0), m.pearl, [tx, WALL_TOP + TH / 2, 0]);
    for (const sz of [1, -1]) {
      add(root, geo.box(tw - 0.1, 1.0, 0.02), m.team, [tx, WALL_TOP + 0.7, sz * 0.505]);
      add(root, geo.cyl(0.11, 0.11, 0.03, 6), m.lilac, [tx, WALL_TOP + 0.9, sz * 0.515], [HALF_PI, 0, 0]);
      add(root, geo.cyl(0.06, 0.06, 0.035, 6), m.teamGlow, [tx, WALL_TOP + 0.9, sz * 0.52], [HALF_PI, 0, 0]);
    }
    for (const sz of [1, -1]) add(root, geo.box(0.05, TH, 0.05), m.lilac, [s * (PW + 0.04), WALL_TOP + TH / 2, sz * 0.49]);
    add(root, geo.box(0.02, 1.36, 0.14), m.void, [s * (PW + 0.025), WALL_TOP + 0.76, 0]);
    add(root, geo.box(0.024, 1.26, 0.06), m.violet, [s * (PW + 0.022), WALL_TOP + 0.76, 0]);
    // crown: hex collar, emitter neck and floating crystal
    const cy = WALL_TOP + TH;
    add(root, geo.box(pw, 0.06, 1.04), m.lilac, [x, cy + 0.03, 0]);
    add(root, CG.frustum(0.6), m.pearl, [x, cy + 0.16, 0], null, [pw - 0.04, 0.2, 0.8]);
    add(root, geo.cyl(0.13, 0.16, 0.08, 6), m.team, [x, cy + 0.3, 0]);
    add(root, geo.cyl(0.1, 0.07, 0.06, 6), m.chrome, [x, cy + 0.37, 0]);
    glowAdd(glow, root, crystalGeo('gateForceTip', 0.08, 0.14, 0.05, 0.08, 6), m.violet, [x, cy + 0.5, 0]);
  }
  // floating lintel over the passage (team band, hex badge), linked to the towers by energy nodes
  const ly = WALL_TOP + 1.42;
  add(root, geo.box(2 * PW - 0.1, 0.16, 0.3), m.pearl, [0, ly, 0]);
  add(root, geo.box(2 * PW - 0.1, 0.05, 0.31), m.team, [0, ly + 0.02, 0]);
  add(root, geo.box(2 * PW - 0.2, 0.02, 0.1), m.violet, [0, ly - 0.085, 0]);
  for (const sz of [1, -1]) add(root, geo.cyl(0.08, 0.08, 0.03, 6), m.white, [0, ly, sz * 0.16], [HALF_PI, 0, 0]);
  add(root, mergedBoxes('galLintelLinks', [[0.05, 0.06, 0.12, PW - 0.025, ly, 0], [0.05, 0.06, 0.12, -PW + 0.025, ly, 0]]), m.violet);
  const doors = [
    forceLeaf(root, glow, m, -PW, 0.62, 1, PW - 0.005, 1.68),
    forceLeaf(root, glow, m, PW, 0.62, -1, PW - 0.005, 1.68),
  ];
  return { root, parts: { doors, glow }, height: 2.6, radius: 1.0 };
}
