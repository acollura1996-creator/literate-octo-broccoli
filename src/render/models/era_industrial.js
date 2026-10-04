// Industrial Age (and early Modern) structures: the Victorian brick city hall (town center), a terraced
// house, an industrial farm, a vehicle factory, a concrete bunker tower and the concrete wall +
// checkpoint gate. Same conventions as ages.js: origin at ground center, facing +Z, team color via
// mat(teamColor), cached geo/mat, everything casts shadows (add()). Buildings fill their fp x fp
// footprint; the wall fills its 1x1 cell exactly so pieces tile in every direction.
import { THREE, mat, geo, P, CG, glowMat, grp, add, beam, rod, flag, banner, gableRoof, mergedBoxes } from './common.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HALF_PI = Math.PI / 2;

/** Darker/lighter variant of a color. */
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();

// Palette
const BRICK = 0xa3432c, BRICK_D = 0x76301f;
const TRIM = 0xece6d7, TRIM_D = 0xc4bba7; // Portland stone
const SLATE = 0x5e6982, SLATE_D = 0x465068;
const GLASS = 0x26324a, SKY_GLASS = 0x86a6bc;
const CONC = 0xb2b0a8, CONC_D = 0x8c8b84, CONC_L = 0xcac8bf;
const STEEL = 0x8a919a, STEEL_D = 0x4f555e;
const HAZ_Y = 0xf2c11d, HAZ_K = 0x25262b;
const PAVING = 0xbdb7a9, ASPHALT = 0x5c5b58;
const SMOKE = 0xcbc8c1, SOOT = 0x75716c;
const BARN = 0xa82e22, BARN_D = 0x7c2018;
const SAND = 0xc4ad7c, SAND_D = 0xa8915f;
const WIRE = 0x3e4148;

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Cached merged cylinders / cones: [[rTop, rBot, h, x, y, z, rx = 0, rz = 0, seg = 8], ...], each
 * centered on (x, y, z) (rotated about Z first, then X). rTop = 0 makes a cone.
 */
function mergedCyls(key, list) {
  return geo.custom(`ind-cyl:${key}`, () => {
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

/** Upper hemisphere (dome), radius 1, base at y=0. */
const hemi = () => geo.custom('ind:hemi14', () => new THREE.SphereGeometry(1, 14, 4, 0, Math.PI * 2, 0, HALF_PI));

/** Profile [[x, y], ...] in the XY plane extruded along Z (depth d, centered on z=0). */
function prism(key, pts, d) {
  return geo.custom(`ind-prism:${key}`, () => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    return g;
  });
}

/**
 * Hip roof: base w (X) by d (Z) at y=0, ridge of length `ridge` along X at height h (ridge 0 = pyramid).
 */
function hipRoof(w, d, h, ridge) {
  return geo.custom(`ind-hip:${w},${d},${h},${ridge}`, () => {
    const x = w / 2, z = d / 2, r = ridge / 2;
    const A = [-x, 0, -z], B = [x, 0, -z], C = [x, 0, z], D = [-x, 0, z], R1 = [-r, h, 0], R2 = [r, h, 0];
    const tris = [D, C, R2, D, R2, R1, B, A, R1, B, R1, R2, C, B, R2, A, D, R1, A, B, C, A, C, D];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
    g.computeVertexNormals();
    return g;
  });
}

/** Raised slate courses on the front and back slopes of a hipRoof (fractions fs of the height). */
function hipCourses(key, w, d, h, ridge, fs) {
  const slope = Math.atan2(h, d / 2), t = 0.035;
  const ny = Math.cos(slope), nz = Math.sin(slope);
  const boxes = [];
  for (const f of fs) {
    const len = w - (w - ridge) * f - 0.16;
    for (const sz of [1, -1]) boxes.push([len, t, 0.07, 0, h * f + (ny * t) / 2, sz * ((d / 2) * (1 - f) + (nz * t) / 2), 0, sz * slope]);
  }
  return mergedBoxes(`ind-hipc:${key}`, boxes);
}

/** Boxes placed on all four faces of a 1x1 cell: list of [w, h, x, y] in face coordinates (from ages.js). */
function onFourFaces(list, t, out = 0.5) {
  const boxes = [];
  const c = out - t / 2 + 0.006; // proud of the face by 0.006
  for (const [w, h, x, y] of list) {
    boxes.push([w, h, t, x, y, c], [w, h, t, -x, y, -c], [t, h, w, c, y, -x], [t, h, w, -c, y, x]);
  }
  return boxes;
}

/**
 * A box on an axis-aligned facade. face: 'z' | '-z' | 'x' | '-x'; c = |plane coordinate|; u runs left to
 * right as seen from outside; w along the facade, h tall, t thick, its back face at c + back.
 */
function fb(face, c, u, y, w, h, t, back = 0) {
  const n = c + back + t / 2;
  if (face === 'z') return [w, h, t, u, y, n];
  if (face === '-z') return [w, h, t, -u, y, -n];
  if (face === 'x') return [t, h, w, n, y, -u];
  return [t, h, w, -n, y, u];
}

/**
 * Sash windows on a facade, merged per material: stone surround + sill + lintel (frameMat), glass pane,
 * white meeting rail. list = [[u, y, w, h], ...].
 */
function sashWindows(parent, key, face, c, list, { frameMat, glassMat, barMat, frame = true, sill = true, lintel = true, bars = true } = {}) {
  const F = [], G = [], B = [];
  for (const [u, y, w, h] of list) {
    if (frame) F.push(fb(face, c, u, y, w + 0.07, h + 0.07, 0.03, -0.01));
    if (sill) F.push(fb(face, c, u, y - h / 2 - 0.04, w + 0.13, 0.045, 0.065, -0.01));
    if (lintel) F.push(fb(face, c, u, y + h / 2 + 0.06, w + 0.12, 0.065, 0.05, -0.01));
    G.push(fb(face, c, u, y, w, h, 0.03, 0));
    if (bars) B.push(fb(face, c, u, y, w, 0.022, 0.012, 0.03));
  }
  if (F.length) add(parent, mergedBoxes(`ind-winF:${key}`, F), frameMat);
  add(parent, mergedBoxes(`ind-winG:${key}`, G), glassMat);
  if (B.length) add(parent, mergedBoxes(`ind-winB:${key}`, B), barMat ?? frameMat);
}

/**
 * Chimney smoke: a column of puffs over a chimney mouth. Put the group in parts.bob (and parts.spin
 * to make it swirl about the chimney axis).
 */
function smoke(parent, x, y, z, { s = 0.08, n = 3, color = SMOKE, opacity = 0.6 } = {}) {
  const g = grp(parent, x, y, z);
  const m = mat(color, { transparent: true, opacity });
  const pts = [[0, 0.6, 0, 1], [0.55, 2.0, 0.3, 0.9], [-0.45, 3.3, -0.35, 0.8], [0.35, 4.5, 0.45, 0.7], [-0.25, 5.6, -0.15, 0.6]];
  for (let i = 0; i < n; i++) {
    const [px, py, pz, k] = pts[i];
    add(g, geo.ico(s * k, 0), m, [px * s, py * s, pz * s]).castShadow = false;
  }
  return g;
}

/** Clip a convex polygon [[x, y], ...] to xmin <= x <= xmax. */
function clipX(poly, xmin, xmax) {
  const pass = (pts, inside, cut) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (inside(a)) out.push(a);
      if (inside(a) !== inside(b)) out.push(cut(a, b));
    }
    return out;
  };
  const at = (x) => (a, b) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  return pass(pass(poly, (q) => q[0] >= xmin - 1e-9, at(xmin)), (q) => q[0] <= xmax + 1e-9, at(xmax));
}

/**
 * Black 45-degree hazard bars clipped to an L x h band in the XY plane (thickness t, centered on z=0).
 * slant mirrors the bars; vertical turns the band to run along Y.
 */
function hazardBars(L, h, { bar = 0.055, period = 0.13, t = 0.01, slant = 1, vertical = false } = {}) {
  return geo.custom(`ind-haz:${L},${h},${bar},${period},${t},${slant},${vertical}`, () => {
    const list = [];
    for (let x0 = -L / 2 - h - bar + period * 0.5; x0 < L / 2; x0 += period) {
      const poly = clipX([[x0, -h / 2], [x0 + bar, -h / 2], [x0 + bar + h, h / 2], [x0 + h, h / 2]], -L / 2, L / 2);
      if (poly.length < 3) continue;
      let area = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        area += a[0] * b[1] - b[0] * a[1];
      }
      if (Math.abs(area) / 2 < 0.0004) continue;
      const s = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(slant * x, y)));
      const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
      g.translate(0, 0, -t / 2);
      list.push(g);
    }
    const g = mergeAll(list);
    if (vertical) g.rotateZ(HALF_PI);
    return g;
  });
}

/** Yellow/black hazard band facing +Z (rotate with ry / rx). Origin at the band center. */
function hazard(parent, x, y, z, L, h, { ry = 0, rx = 0, vertical = false, slant = 1, bar, period } = {}) {
  const g = grp(parent, x, y, z, ry);
  if (rx) g.rotation.x = rx;
  add(g, vertical ? geo.box(h, L, 0.016) : geo.box(L, h, 0.016), mat(HAZ_Y));
  add(g, hazardBars(L, h, { bar, period, slant, vertical }), mat(HAZ_K), [0, 0, 0.009]);
  return g;
}

/** Five-pointed star, radius 1, thickness 1, facing +Z. */
const starGeo = () =>
  geo.custom('ind:star5', () => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.42 : 1, a = (i / 10) * Math.PI * 2;
      if (i) s.lineTo(Math.sin(a) * r, Math.cos(a) * r);
      else s.moveTo(0, r);
    }
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    return g;
  });

/** A slab lying on the profile segment P -> Q (XY plane, outward = left of the direction), depth along Z. */
function slab(parent, Pt, Q, t, depth, material, [x, y, z] = [0, 0, 0]) {
  const dx = Q[0] - Pt[0], dy = Q[1] - Pt[1], len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  return add(parent, geo.box(len, t, depth), material,
    [x + (Pt[0] + Q[0]) / 2 + (nx * t) / 2, y + (Pt[1] + Q[1]) / 2 + (ny * t) / 2, z], [0, 0, Math.atan2(dy, dx)]);
}

// ===========================================================================
// City hall (town center)
// ===========================================================================

// Victorian red-brick city hall: rusticated podium, hipped slate range with a team ridge, two corner
// pavilions with slate mansards and flags, a central clock tower (four clock faces, belfry, team spire),
// grand portal with steps, gas lamps, team banners, smoking chimneys.
export function city_hall(tc) {
  const root = new THREE.Group();
  const brick = mat(BRICK), trim = mat(TRIM), trimD = mat(TRIM_D), slate = mat(SLATE), slateD = mat(SLATE_D);
  const team = mat(tc), gold = mat(P.gold), glass = mat(GLASS), iron = mat(P.iron);
  const glow = [], puffs = [];
  const b = 0.26;
  // paved forecourt + rusticated podium
  add(root, geo.box(3.88, 0.04, 3.88), mat(PAVING), [0, 0.02, 0]);
  add(root, geo.box(3.8, b - 0.04, 2.96), mat(0x9d968a), [0, 0.04 + (b - 0.04) / 2, -0.42]);
  add(root, geo.box(3.82, 0.03, 2.98), trimD, [0, b - 0.012, -0.42]);

  // --- main range: two storeys of brick, stone bands, hipped slate roof -----------------------------
  const MX = 1.78, Z0 = -1.84, Z1 = 0.3, MH = 1.46;
  const mz = (Z0 + Z1) / 2, md = Z1 - Z0;
  add(root, geo.box(2 * MX, MH, md), brick, [0, b + MH / 2, mz]);
  add(root, mergedBoxes('ind-chMainBands', [
    [2 * MX + 0.03, 0.1, md + 0.03, 0, b + 0.05, mz],
    [2 * MX + 0.03, 0.05, md + 0.03, 0, b + 0.74, mz],
    [2 * MX + 0.1, 0.08, md + 0.1, 0, b + MH - 0.02, mz],
  ]), trim);
  const r0 = b + MH + 0.02, rh = 0.98, rw = 2 * MX + 0.14, rd = md + 0.14, ridge = rw - rd;
  add(root, hipRoof(rw, rd, rh, ridge), slate, [0, r0, mz]);
  add(root, hipCourses('ch', rw, rd, rh, ridge, [0.2, 0.42, 0.64]), slateD, [0, r0, mz]);
  add(root, geo.box(ridge + 0.12, 0.1, 0.1), team, [0, r0 + rh, mz], [Math.PI / 4, 0, 0]); // team ridge
  const crest = [[ridge + 0.1, 0.022, 0.022, 0, 0.17, 0]];
  for (let i = 1; i < 6; i++) crest.push([0.02, 0.17, 0.02, -ridge / 2 + (ridge * i) / 6, 0.1, 0]);
  for (const s of [1, -1]) crest.push([0.035, 0.3, 0.035, (s * (ridge + 0.1)) / 2, 0.15, 0]);
  add(root, mergedBoxes('ind-chCrest', crest), iron, [0, r0 + rh, mz]);
  // dormers on the front slope (between the tower and the pavilions)
  for (const s of [1, -1]) {
    const dx = s * 0.73, dz = 0.02, dy = r0 + 0.3;
    add(root, geo.box(0.24, 0.3, 0.36), trim, [dx, dy, dz]);
    add(root, geo.box(0.15, 0.17, 0.02), glass, [dx, dy - 0.01, dz + 0.18]);
    add(root, CG.gable(), slate, [dx, dy + 0.15, dz], [0, HALF_PI, 0], [0.4, 0.15, 0.32]);
  }
  // chimneys on the back slope, with smoke
  for (const s of [1, -1]) {
    const cx = s * 0.98, cz = -1.2, top = 3.02, bot = r0 + 0.2;
    add(root, geo.box(0.2, top - bot, 0.32), brick, [cx, (top + bot) / 2, cz]);
    add(root, geo.box(0.27, 0.06, 0.39), trim, [cx, top + 0.03, cz]);
    add(root, mergedCyls('chPots', [[0.034, 0.044, 0.12, 0, 0, -0.08, 0, 0, 6], [0.034, 0.044, 0.12, 0, 0, 0.08, 0, 0, 6]]), mat(0xb5602e), [cx, top + 0.12, cz]);
    puffs.push(smoke(root, cx, top + 0.18, cz + 0.08 * s, { s: 0.085 }));
  }

  // --- corner pavilions: taller, slate mansards with dormers, iron cresting, flags -------------------
  const PX0 = 1.0, PX1 = 1.86, PZ0 = 0.08, PZ1 = 0.96, PH = 1.78;
  const pw = PX1 - PX0, pd = PZ1 - PZ0, pz = (PZ0 + PZ1) / 2;
  for (const s of [1, -1]) {
    const px = (s * (PX0 + PX1)) / 2;
    add(root, geo.box(pw, PH, pd), brick, [px, b + PH / 2, pz]);
    const bands = [
      [pw + 0.03, 0.1, pd + 0.03, 0, b + 0.05, 0],
      [pw + 0.03, 0.05, pd + 0.03, 0, b + 0.74, 0],
      [pw + 0.03, 0.05, pd + 0.03, 0, b + 1.42, 0],
      [pw + 0.1, 0.09, pd + 0.1, 0, b + PH, 0],
    ];
    for (const qx of [1, -1]) for (const qz of [1, -1]) bands.push([0.1, PH, 0.1, qx * (pw / 2 - 0.035), b + PH / 2, qz * (pd / 2 - 0.035)]); // quoins
    add(root, mergedBoxes('ind-chPavStone', bands), trim, [px, 0, pz]);
    // windows: front (two tall + a small pair), outer side
    const face = s > 0 ? 'x' : '-x';
    sashWindows(root, `chPavFront${s}`, 'z', PZ1, [[px, b + 0.38, 0.3, 0.5], [px, b + 1.08, 0.3, 0.52]], { frameMat: trim, glassMat: glass, bars: false });
    sashWindows(root, `chPavAttic${s}`, 'z', PZ1, [[px - 0.12, b + 1.61, 0.12, 0.2], [px + 0.12, b + 1.61, 0.12, 0.2]], { frameMat: trim, glassMat: glass, bars: false, sill: false, lintel: false });
    sashWindows(root, `chPavSide${s}`, face, PX1, [[s * -pz, b + 0.38, 0.28, 0.5], [s * -pz, b + 1.08, 0.28, 0.52]], { frameMat: trim, glassMat: glass, bars: false, frame: false });
    // mansard roof + low cap + cresting
    const my = b + PH + 0.045, mh = 0.72;
    add(root, CG.frustum(0.5), slate, [px, my + mh / 2, pz], null, [pw + 0.1, mh, pd + 0.1]);
    add(root, CG.frustum(0.97), slateD, [px, my + 0.2, pz], null, [pw + 0.09 - 0.07, 0.04, pd + 0.09 - 0.07]);
    const topW = (pw + 0.1) * 0.5;
    add(root, hipRoof(topW, topW, 0.22, 0), slateD, [px, my + mh, pz]);
    const cr = [];
    for (const q of [1, -1]) cr.push([topW, 0.025, 0.025, 0, 0.08, (q * topW) / 2], [0.025, 0.025, topW, (q * topW) / 2, 0.08, 0]);
    add(root, mergedBoxes('ind-chPavCrest', cr), iron, [px, my + mh, pz]);
    // dormer on the mansard front
    add(root, geo.box(0.26, 0.3, 0.26), trim, [px, my + 0.27, PZ1 - 0.02]);
    add(root, geo.box(0.16, 0.18, 0.02), glass, [px, my + 0.25, PZ1 + 0.115]);
    add(root, CG.gable(), trim, [px, my + 0.42, PZ1 - 0.02], [0, HALF_PI, 0], [0.3, 0.13, 0.32]);
    flag(root, px, my + mh + 0.2, pz, tc, { pole: 0.62, w: 0.52, h: 0.3, dir: -s, poleColor: P.iron, finial: P.gold });
  }

  // --- main range windows (front ground floor between tower and pavilions, sides) + team banners -----
  sashWindows(root, 'chMainFront', 'z', Z1, [[-0.73, b + 0.38, 0.3, 0.5], [0.73, b + 0.38, 0.3, 0.5]], { frameMat: trim, glassMat: glass });
  for (const s of [1, -1]) banner(root, s * 0.73, b + 1.36, Z1 + 0.012, tc, { w: 0.32, h: 0.5 });
  for (const s of [1, -1]) {
    const face = s > 0 ? 'x' : '-x';
    const list = [];
    for (const z of [-1.5, -0.95, -0.4]) for (const y of [b + 0.38, b + 1.08]) list.push([s * -z, y, 0.24, 0.46]);
    sashWindows(root, `chMainSide${s}`, face, MX, list, { frameMat: trim, glassMat: glass, frame: false, bars: false, sill: false });
  }

  // --- clock tower -----------------------------------------------------------------------------------
  const TW = 0.92, TZ = 0.58, T1 = 2.72, tf = TZ + TW / 2;
  add(root, geo.box(TW, T1 - b, TW), brick, [0, (b + T1) / 2, TZ]);
  const tstone = [
    [TW + 0.04, 0.1, TW + 0.04, 0, b + 0.05, 0],
    [TW + 0.04, 0.05, TW + 0.04, 0, b + 1.0, 0],
    [TW + 0.04, 0.05, TW + 0.04, 0, b + 1.42, 0],
    [TW + 0.04, 0.05, TW + 0.04, 0, b + 2.12, 0],
  ];
  for (const qx of [1, -1]) for (const qz of [1, -1]) tstone.push([0.1, T1 - b, 0.1, qx * (TW / 2 - 0.035), (b + T1) / 2, qz * (TW / 2 - 0.035)]);
  add(root, mergedBoxes('ind-chTowerStone', tstone), trim, [0, 0, TZ]);
  sashWindows(root, 'chTowerFront', 'z', tf, [[-0.15, b + 1.21, 0.12, 0.26], [0.15, b + 1.21, 0.12, 0.26], [-0.15, b + 2.37, 0.12, 0.26], [0.15, b + 2.37, 0.12, 0.26]],
    { frameMat: trim, glassMat: glass, bars: false, sill: false });
  banner(root, 0, b + 2.04, tf + 0.012, tc, { w: 0.36, h: 0.4 });
  // grand portal: stone arch, double doors with a fanlight, keystone
  const portal = grp(root, 0, b, tf);
  add(portal, geo.box(0.6, 0.62, 0.05), trim, [0, 0.31, 0.012]);
  add(portal, geo.cyl(0.3, 0.3, 0.05, 10), trim, [0, 0.62, 0.012], [HALF_PI, 0, 0]);
  add(portal, geo.box(0.42, 0.56, 0.05), mat(0x4a2a16), [0, 0.28, 0.03]);
  add(portal, geo.cyl(0.21, 0.21, 0.05, 10), glass, [0, 0.56, 0.025], [HALF_PI, 0, 0]);
  add(portal, geo.box(0.02, 0.5, 0.02), gold, [0, 0.27, 0.06]);
  add(portal, geo.box(0.1, 0.12, 0.05), trimD, [0, 0.9, 0.03]);
  // clock stage: four gold-rimmed faces
  const C0 = T1, CH = 0.58, CW = 1.0;
  add(root, geo.box(CW, CH, CW), brick, [0, C0 + CH / 2, TZ]);
  const cstone = [[CW + 0.04, 0.06, CW + 0.04, 0, C0 + 0.03, 0], [CW + 0.1, 0.08, CW + 0.1, 0, C0 + CH + 0.04, 0]];
  for (const qx of [1, -1]) for (const qz of [1, -1]) cstone.push([0.1, CH, 0.1, qx * (CW / 2 - 0.035), C0 + CH / 2, qz * (CW / 2 - 0.035)]);
  add(root, mergedBoxes('ind-chClockStone', cstone), trim, [0, 0, TZ]);
  const cream = mat(0xf7f1dd), black = mat(0x1b1b1f);
  for (let i = 0; i < 4; i++) {
    const a = i * HALF_PI;
    const g = grp(root, Math.sin(a) * (CW / 2), C0 + CH / 2 + 0.01, TZ + Math.cos(a) * (CW / 2), a);
    add(g, geo.cyl(0.29, 0.29, 0.04, 10), gold, [0, 0, 0.01], [HALF_PI, 0, 0]);
    add(g, geo.cyl(0.245, 0.245, 0.04, 10), cream, [0, 0, 0.022], [HALF_PI, 0, 0]);
    add(g, geo.box(0.034, 0.15, 0.012), black, [-0.065, 0.037, 0.046], [0, 0, 1.05]);
    add(g, geo.box(0.026, 0.21, 0.012), black, [0, 0.095, 0.048]);
  }
  // belfry with louvres, corner pinnacles, team spire + flag
  const B0 = C0 + CH + 0.08, BH = 0.34, BW = 0.8;
  add(root, geo.box(BW, BH, BW), brick, [0, B0 + BH / 2, TZ]);
  add(root, mergedBoxes('ind-chLouvres', onFourFaces([[0.3, 0.24, 0, 0]], 0.03, BW / 2)), mat(0x2a221c), [0, B0 + BH / 2, TZ]);
  add(root, geo.box(BW + 0.06, 0.05, BW + 0.06), trim, [0, B0 + BH + 0.025, TZ]);
  add(root, mergedCyls('chPinnacles', [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([qx, qz]) => [0, 0.065, 0.34, qx * (CW / 2 - 0.05), 0.17, qz * (CW / 2 - 0.05), 0, 0, 4])), trim, [0, B0, TZ]);
  const S0 = B0 + BH + 0.05;
  add(root, hipRoof(0.84, 0.84, 0.72, 0), team, [0, S0, TZ]);
  add(root, geo.box(0.86, 0.04, 0.86), gold, [0, S0 + 0.02, TZ]);
  add(root, geo.sphere(0.05, 6, 4), gold, [0, S0 + 0.73, TZ]);
  flag(root, 0, S0 + 0.72, TZ, tc, { pole: 0.36, w: 0.46, h: 0.26, dir: 1, poleColor: P.iron, finial: P.gold, poleR: 0.018 });

  // --- grand steps, cheek walls with gas lamps, lawns with hedges --------------------------------------
  for (let k = 0; k < 3; k++) {
    const top = b - k * ((b - 0.04) / 3);
    const zf = tf + 0.24 * (k + 1);
    add(root, geo.box(1.02 + k * 0.14, top - 0.04, zf - tf + 0.02), k % 2 ? trimD : trim, [0, 0.04 + (top - 0.04) / 2, (zf + tf - 0.02) / 2]);
  }
  for (const s of [1, -1]) {
    const lx = s * 0.72, lz = 1.6;
    add(root, geo.box(0.1, b, 0.58), trimD, [s * 0.72, b / 2 + 0.02, 1.37]);
    add(root, geo.box(0.16, 0.12, 0.16), trimD, [lx, b + 0.06, lz]);
    add(root, geo.cyl(0.022, 0.032, 0.62, 6), iron, [lx, b + 0.43, lz]);
    add(root, geo.cyl(0.07, 0.035, 0.05, 6), iron, [lx, b + 0.76, lz]);
    const bulb = add(root, geo.ico(0.072, 0), glowMat(0xffe2a0, 0.9), [lx, b + 0.84, lz]);
    bulb.castShadow = false;
    glow.push(bulb);
    add(root, geo.cone(0.06, 0.08, 6), iron, [lx, b + 0.94, lz]);
    // lawn + clipped hedges + topiary in front of each pavilion
    const gx = s * 1.4;
    add(root, geo.box(0.9, 0.05, 0.8), mat(0x5f9e35), [gx, 0.065, 1.46]);
    add(root, mergedBoxes('ind-chHedges', [[0.9, 0.16, 0.1, 0, 0.12, 0.36], [0.1, 0.16, 0.66, 0.4, 0.12, 0], [0.1, 0.16, 0.66, -0.4, 0.12, 0]]), mat(0x3f7a2a), [gx, 0, 1.46]);
    add(root, geo.cone(0.14, 0.42, 6), mat(0x3f8a2c), [gx, 0.3, 1.42]);
    add(root, geo.box(0.16, 0.1, 0.16), trimD, [gx, 0.09, 1.42]);
  }
  return { root, parts: { bob: puffs, spin: puffs, glow }, height: 4.5, radius: 1.95 };
}

// ===========================================================================
// Terraced house
// ===========================================================================

// Brick terraced house: slate roof between party-wall parapets with chimney stacks (smoke), sash
// windows with team shutters, team front door with a fanlight, white bay window, railed front garden,
// gas lamp.
export function house_ind(tc) {
  const root = new THREE.Group();
  const brick = mat(BRICK), brickD = mat(BRICK_D), trim = mat(TRIM), team = mat(tc), teamD = mat(shade(tc, 0.6));
  const glass = mat(GLASS), iron = mat(P.iron), white = mat(0xf4f2ea);
  add(root, geo.box(1.9, 0.04, 1.9), mat(PAVING), [0, 0.02, 0]);
  const b = 0.08, W = 1.74, Z0 = -0.9, Z1 = 0.22, H = 1.3;
  const zc = (Z0 + Z1) / 2, D = Z1 - Z0;
  add(root, geo.box(W + 0.03, 0.12, D + 0.03), mat(0x8f887c), [0, 0.1, zc]);
  add(root, geo.box(W, H, D), brick, [0, b + H / 2, zc]);
  add(root, geo.box(W + 0.02, 0.045, D + 0.02), brickD, [0, b + 0.68, zc]);
  add(root, geo.box(W + 0.04, 0.06, D + 0.1), trim, [0, b + H - 0.02, zc]);
  // slate roof between parapet gables
  const r0 = b + H + 0.01, rh = 0.56, rd = D + 0.1;
  gableRoof(root, 0, r0, zc, W - 0.06, rd, rh, SLATE, tc, { eaves: false, rows: 3, rowColor: SLATE_D }); // team ridge tiles
  const ph = rh + 0.06, pdp = rd;
  const slope = Math.atan2(ph, pdp / 2), sl = Math.hypot(ph, pdp / 2);
  const puffs = [];
  for (const s of [1, -1]) {
    const x = s * (W / 2 - 0.05);
    add(root, CG.gable(), brick, [x, r0 - 0.01, zc], null, [0.1, ph, pdp]);
    for (const sz of [1, -1]) {
      add(root, geo.box(0.14, sl - 0.02, 0.04), trim,
        [x, r0 - 0.01 + ph / 2 + Math.cos(slope) * 0.02, zc + (sz * pdp) / 4 + sz * Math.sin(slope) * 0.02], [-sz * (HALF_PI - slope), 0, 0]);
    }
    // chimney stack on the party wall
    const cx = s * (W / 2 - 0.1), top = 2.16, bot = r0 + rh - 0.25;
    add(root, geo.box(0.2, top - bot, 0.42), brick, [cx, (top + bot) / 2, zc]);
    add(root, geo.box(0.24, 0.05, 0.46), trim, [cx, top + 0.02, zc]);
    add(root, mergedCyls('hiPots', [-0.12, 0, 0.12].map((z) => [0.032, 0.042, 0.11, 0, 0, z, 0, 0, 6])), mat(0xb5602e), [cx, top + 0.1, zc]);
    if (s < 0) puffs.push(smoke(root, cx, top + 0.16, zc - 0.12, { s: 0.07 }));
  }
  // front: team door with stone surround + fanlight, hood on brackets, step
  const fz = Z1, dx = -0.48;
  add(root, geo.box(0.36, 0.68, 0.04), trim, [dx, b + 0.34, fz + 0.01]);
  add(root, geo.box(0.24, 0.5, 0.04), team, [dx, b + 0.25, fz + 0.03]);
  add(root, mergedBoxes('ind-hiDoorPanels', [[0.075, 0.15, 0.012, -0.055, 0.14, 0], [0.075, 0.15, 0.012, 0.055, 0.14, 0], [0.075, 0.17, 0.012, -0.055, 0.35, 0], [0.075, 0.17, 0.012, 0.055, 0.35, 0]]), teamD, [dx, b, fz + 0.054]);
  add(root, geo.box(0.24, 0.09, 0.03), glass, [dx, b + 0.58, fz + 0.03]);
  add(root, geo.box(0.03, 0.03, 0.03), mat(P.gold), [dx + 0.08, b + 0.25, fz + 0.06]);
  add(root, mergedBoxes('ind-hiHood', [[0.44, 0.04, 0.17, 0, 0.72, 0.085], [0.03, 0.09, 0.12, -0.19, 0.66, 0.06], [0.03, 0.09, 0.12, 0.19, 0.66, 0.06]]), trim, [dx, b, fz]);
  add(root, geo.box(0.4, 0.06, 0.16), trim, [dx, 0.07, fz + 0.08]);
  // white bay window (ground floor) with a slate hood
  const bx = 0.36;
  add(root, geo.box(0.62, 0.62, 0.2), white, [bx, b + 0.31, fz + 0.1]);
  add(root, geo.box(0.44, 0.38, 0.02), glass, [bx, b + 0.38, fz + 0.205]);
  add(root, mergedBoxes('ind-hiBaySide', [[0.02, 0.38, 0.12, 0.312, 0, 0], [0.02, 0.38, 0.12, -0.312, 0, 0]]), glass, [bx, b + 0.38, fz + 0.1]);
  add(root, mergedBoxes('ind-hiBayBars', [[0.44, 0.022, 0.012, 0, 0.42, 0], [0.022, 0.38, 0.012, -0.11, 0.38, 0], [0.022, 0.38, 0.012, 0.11, 0.38, 0]]), white, [bx, b, fz + 0.218]);
  add(root, geo.box(0.68, 0.05, 0.27), mat(SLATE), [bx, b + 0.66, fz + 0.1], [0.3, 0, 0]);
  // upper floor: sash windows with team shutters
  sashWindows(root, 'hiUpper', 'z', fz, [[dx, b + 1.0, 0.26, 0.4], [bx, b + 1.0, 0.26, 0.4]], { frameMat: trim, glassMat: glass, barMat: white });
  const sh = [];
  for (const x of [dx, bx]) for (const s of [1, -1]) sh.push([0.12, 0.44, 0.025, x + s * 0.21, b + 1.0, fz + 0.015]);
  add(root, mergedBoxes('ind-hiShutters', sh), team);
  const slats = [];
  for (const [w, , , x, y, z] of sh) for (const dy of [-0.12, 0, 0.12]) slats.push([w - 0.03, 0.02, 0.01, x, y + dy, z + 0.016]);
  add(root, mergedBoxes('ind-hiSlats', slats), teamD);
  // front garden: path, lawn, shrubs, flowers, low brick wall with iron railings, gas lamp, dustbin
  add(root, geo.box(0.32, 0.02, 0.66), mat(0xd8d2c4), [dx, 0.05, 0.58]);
  add(root, geo.box(1.14, 0.03, 0.42), mat(0x5f9e35), [0.34, 0.055, 0.64]);
  add(root, geo.ico(0.11, 0), mat(P.leaf), [0.78, 0.15, 0.6]);
  add(root, geo.ico(0.085, 0), mat(0x4f9a34), [-0.12, 0.13, 0.66]);
  add(root, mergedBoxes('ind-hiFlowers', [[0.05, 0.05, 0.05, 0, 0, 0], [0.05, 0.05, 0.05, 0.1, 0.01, 0.02], [0.05, 0.05, 0.05, 0.2, 0, -0.01], [0.05, 0.05, 0.05, 0.3, 0.01, 0.01]]), mat(0xe8384a), [0.12, 0.1, 0.78]);
  const wall = [[0.27, 0.16, 0.07, -0.815, 0.12, 0.9], [1.23, 0.16, 0.07, 0.335, 0.12, 0.9], [0.07, 0.16, 0.62, 0.915, 0.12, 0.56], [0.07, 0.16, 0.62, -0.915, 0.12, 0.56],
    [0.1, 0.34, 0.1, -0.68, 0.21, 0.9], [0.1, 0.34, 0.1, -0.28, 0.21, 0.9]];
  add(root, mergedBoxes('ind-hiGardenWall', wall), brick);
  add(root, mergedBoxes('ind-hiCoping', [[0.27, 0.03, 0.09, -0.815, 0.215, 0.9], [1.23, 0.03, 0.09, 0.335, 0.215, 0.9], [0.12, 0.04, 0.12, -0.68, 0.4, 0.9], [0.12, 0.04, 0.12, -0.28, 0.4, 0.9]]), trim);
  const rail = [[1.15, 0.02, 0.02, 0.335, 0.4, 0.9], [0.2, 0.02, 0.02, -0.83, 0.4, 0.9]];
  for (let i = 0; i < 10; i++) rail.push([0.018, 0.18, 0.018, -0.2 + i * 0.12, 0.31, 0.9]);
  for (const x of [-0.9, -0.78]) rail.push([0.018, 0.18, 0.018, x, 0.31, 0.9]);
  add(root, mergedBoxes('ind-hiRailing', rail), iron);
  add(root, geo.cyl(0.06, 0.055, 0.15, 7), mat(STEEL), [-0.16, 0.115, 0.32]);
  const lx = 0.82, lz = 0.78;
  add(root, geo.cyl(0.02, 0.03, 0.98, 6), iron, [lx, 0.53, lz]);
  add(root, geo.box(0.1, 0.02, 0.1), iron, [lx, 1.03, lz]);
  const lamp = add(root, geo.box(0.07, 0.1, 0.07), glowMat(0xffdb8a, 0.9), [lx, 1.09, lz]);
  lamp.castShadow = false;
  add(root, geo.cone(0.075, 0.08, 4), iron, [lx, 1.18, lz], [0, Math.PI / 4, 0]);
  return { root, parts: { bob: puffs, spin: puffs, glow: [lamp] }, height: 2.4, radius: 0.95 };
}

// ===========================================================================
// Farm
// ===========================================================================

// Industrial farm: red gambrel barn (white trim, team hayloft door + cupola), tall galvanized silo with a
// domed cap and a team band, grain auger, crop rows behind a split-rail fence, and a multi-blade windmill
// water pump (rotor spins, team tail vane and rim) with its water tank.
export function farm_2(tc) {
  const root = new THREE.Group();
  const team = mat(tc), white = mat(0xf2efe6), red = mat(BARN), redD = mat(BARN_D), roofM = mat(0x5d6066);
  const steel = mat(0xc6cbd0), steelD = mat(0x8c939a), woodD = mat(P.woodDark), iron = mat(P.iron);
  add(root, geo.box(2.9, 0.04, 2.9), mat(0xa48b62), [0, 0.02, 0]); // farmyard
  const b = 0.04;

  // --- barn ---------------------------------------------------------------------------------------
  const bx = -0.68, bz = -0.62, hw = 0.6, BD = 1.5, wh = 0.78;
  const prof = [[-hw, 0], [hw, 0], [hw, wh], [0.42, wh + 0.44], [0, wh + 0.72], [-0.42, wh + 0.44], [-hw, wh]];
  add(root, prism('barn', prof, BD), red, [bx, b, bz]);
  const eave = (sx) => [sx * (hw + 0.04), wh - 0.1];
  const roofPts = [eave(-1), [-0.42, wh + 0.44], [0, wh + 0.72], [0.42, wh + 0.44], eave(1)];
  for (let i = 0; i < 4; i++) slab(root, roofPts[i], roofPts[i + 1], 0.05, BD + 0.12, roofM, [bx, b, bz]);
  add(root, geo.box(0.06, 0.06, BD + 0.14), white, [bx, b + wh + 0.75, bz]); // ridge cap
  const front = bz + BD / 2;
  // white trim: gambrel edge boards (front + back), corner boards
  for (const z of [front + 0.025, bz - BD / 2 - 0.025]) {
    for (let i = 0; i < 4; i++) {
      const [p, q] = [roofPts[i], roofPts[i + 1]];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      add(root, geo.box(len + 0.04, 0.07, 0.03), white, [bx + (p[0] + q[0]) / 2, b + (p[1] + q[1]) / 2 - 0.02, z], [0, 0, Math.atan2(q[1] - p[1], q[0] - p[0])]);
    }
  }
  add(root, mergedBoxes('ind-fBarnCorners', [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => [0.07, wh, 0.07, sx * (hw - 0.02), wh / 2, sz * (BD / 2 - 0.02)])), white, [bx, b, bz]);
  // big double doors with white X bracing, door rail, team hayloft door, hay hood beam
  add(root, mergedBoxes('ind-fBarnDoors', [[0.32, 0.62, 0.04, -0.17, 0.31, 0], [0.32, 0.62, 0.04, 0.17, 0.31, 0]]), redD, [bx, b, front + 0.02]);
  const trimB = [[0.76, 0.05, 0.03, 0, 0.66, 0]];
  for (const s of [1, -1]) trimB.push([0.32, 0.04, 0.03, s * 0.17, 0.6, 0], [0.32, 0.04, 0.03, s * 0.17, 0.02, 0], [0.04, 0.62, 0.03, s * 0.31, 0.31, 0], [0.04, 0.62, 0.03, s * 0.03, 0.31, 0]);
  add(root, mergedBoxes('ind-fBarnDoorTrim', trimB), white, [bx, b, front + 0.045]);
  for (const s of [1, -1]) {
    beam(root, [bx + s * 0.04, b + 0.04, front + 0.05], [bx + s * 0.3, b + 0.58, front + 0.05], 0.035, white, 0.02);
    beam(root, [bx + s * 0.3, b + 0.04, front + 0.05], [bx + s * 0.04, b + 0.58, front + 0.05], 0.035, white, 0.02);
  }
  add(root, geo.box(0.34, 0.34, 0.03), white, [bx, b + wh + 0.2, front + 0.01]);
  add(root, geo.box(0.26, 0.27, 0.03), team, [bx, b + wh + 0.2, front + 0.025]);
  add(root, geo.box(0.05, 0.05, 0.3), woodD, [bx, b + wh + 0.6, front + 0.13]);
  // side windows (toward the silo)
  sashWindows(root, 'fBarnSide', 'x', bx + hw, [[-(bz - 0.4), b + 0.48, 0.16, 0.16], [-(bz + 0.4), b + 0.48, 0.16, 0.16]], { frameMat: white, glassMat: mat(GLASS), sill: false, lintel: false, bars: false });
  // cupola with a team roof on the ridge
  const cy = b + wh + 0.72;
  add(root, geo.box(0.22, 0.2, 0.22), white, [bx, cy + 0.08, bz]);
  add(root, mergedBoxes('ind-fCupolaLouvre', [[0.14, 0.11, 0.232, 0, 0, 0], [0.232, 0.11, 0.14, 0, 0, 0]]), mat(0x3a3a3a), [bx, cy + 0.1, bz]);
  add(root, hipRoof(0.32, 0.32, 0.2, 0), team, [bx, cy + 0.18, bz]);
  add(root, geo.cyl(0.008, 0.008, 0.16, 4), iron, [bx, cy + 0.44, bz]);
  add(root, geo.box(0.16, 0.05, 0.01), iron, [bx + 0.03, cy + 0.48, bz]);

  // --- silo, with a grain auger ---------------------------------------------------------------------
  const sx = 0.52, sz = -0.92, SR = 0.4, SH = 2.9;
  add(root, geo.cyl(SR + 0.06, SR + 0.08, 0.1, 14), mat(CONC), [sx, b + 0.05, sz]);
  add(root, geo.cyl(SR, SR, SH - b - 0.1, 14), steel, [sx, (SH + b + 0.1) / 2, sz]);
  add(root, mergedCyls('fSiloRings', [0.55, 1.0, 1.45, 1.9, 2.3].map((y) => [SR + 0.012, SR + 0.012, 0.035, 0, y, 0, 0, 0, 14])), steelD, [sx, 0, sz]);
  add(root, geo.cyl(SR + 0.018, SR + 0.018, 0.24, 14), team, [sx, 2.6, sz]);
  add(root, hemi(), steel, [sx, SH, sz], null, [SR + 0.02, 0.3, SR + 0.02]);
  add(root, geo.cyl(SR + 0.03, SR + 0.03, 0.04, 14), steelD, [sx, SH, sz]);
  add(root, geo.cyl(0.07, 0.08, 0.1, 8), steelD, [sx, SH + 0.32, sz]);
  add(root, geo.cone(0.11, 0.07, 8), steelD, [sx, SH + 0.405, sz]);
  const lad = grp(root, sx, 0, sz, 0.75);
  const ladder = [[0.02, 2.7, 0.02, -0.07, 1.5, SR + 0.05], [0.02, 2.7, 0.02, 0.07, 1.5, SR + 0.05]];
  for (let i = 0; i < 7; i++) ladder.push([0.14, 0.018, 0.018, 0, 0.35 + i * 0.4, SR + 0.05]);
  add(lad, mergedBoxes('ind-fLadder', ladder), steelD);
  rod(root, [sx + 0.62, b + 0.32, sz + 0.62], [sx + 0.08, SH + 0.12, sz + 0.08], 0.045, steelD, 6);
  add(root, geo.cone(0.13, 0.2, 6), steelD, [sx + 0.64, b + 0.3, sz + 0.64], [Math.PI, 0, 0]);
  beam(root, [sx + 0.38, b, sz + 0.38], [sx + 0.38, 1.3, sz + 0.38], 0.04, iron);

  // --- crop field: wheat, corn and cabbage rows behind a split-rail fence ------------------------------
  const fx0 = -1.44, fx1 = 0.42, fz0 = 0.34, fz1 = 1.4;
  const fcx = (fx0 + fx1) / 2, fcz = (fz0 + fz1) / 2;
  add(root, geo.box(fx1 - fx0, 0.04, fz1 - fz0), mat(0x5e3f24), [fcx, b + 0.02, fcz]);
  const rows = 6, rl = fz1 - fz0 - 0.12;
  const ridges = [], wheat = [], corn = [], tassel = [], cabbage = [];
  for (let i = 0; i < rows; i++) {
    const x = fx0 + 0.16 + i * ((fx1 - fx0 - 0.32) / (rows - 1));
    ridges.push([0.18, 0.04, rl, x, b + 0.06, fcz]);
    if (i < 2) wheat.push([0.17, 0.2, rl - 0.04, x, b + 0.17, fcz]);
    else if (i < 4) {
      for (let k = 0; k < 6; k++) {
        const z = fz0 + 0.14 + k * ((rl - 0.16) / 5);
        corn.push([0.07, 0.34, 0.07, x + (k % 2 ? 0.02 : -0.02), b + 0.25, z]);
        tassel.push([0.05, 0.05, 0.05, x + (k % 2 ? 0.02 : -0.02), b + 0.44, z]);
      }
    } else {
      for (let k = 0; k < 7; k++) cabbage.push([0.13, 0.1, 0.13, x, b + 0.12, fz0 + 0.12 + k * ((rl - 0.12) / 6), Math.PI / 4]);
    }
  }
  add(root, mergedBoxes('ind-fRidges', ridges), mat(0x7a5532));
  add(root, mergedBoxes('ind-fWheat', wheat), mat(0xdcb64c));
  add(root, mergedBoxes('ind-fCorn', corn), mat(0x4f9a34));
  add(root, mergedBoxes('ind-fTassel', tassel), mat(0xe8cf5a));
  add(root, mergedBoxes('ind-fCabbage', cabbage), mat(0x86c25a));
  const fence = [];
  for (let i = 0; i < 6; i++) fence.push([0.05, 0.34, 0.05, fx0 + 0.03 + i * ((fx1 - fx0 - 0.06) / 5), b + 0.17, fz1 + 0.02]);
  for (let i = 1; i < 4; i++) fence.push([0.05, 0.34, 0.05, fx0 + 0.03, b + 0.17, fz1 + 0.02 - i * ((fz1 - fz0) / 3)]);
  for (const y of [0.14, 0.27]) {
    fence.push([fx1 - fx0, 0.035, 0.03, fcx, b + y, fz1 + 0.02]);
    fence.push([0.03, 0.035, fz1 - fz0 + 0.04, fx0 + 0.03, b + y, fcz]);
  }
  add(root, mergedBoxes('ind-fFence', fence), mat(P.woodLight));

  // --- windmill water pump --------------------------------------------------------------------------
  const wx = 0.98, wz = 0.56, WH = 2.3, base = 0.3, topH = 0.07;
  const half = (y) => base - ((base - topH) * (y - b)) / (WH - b);
  for (const [ux, uz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) beam(root, [wx + ux * base, b, wz + uz * base], [wx + ux * topH, WH, wz + uz * topH], 0.04, steelD);
  const braces = [];
  for (const y of [0.6, 1.2, 1.8]) {
    const h = half(y);
    braces.push([2 * h, 0.025, 0.025, 0, y, h], [2 * h, 0.025, 0.025, 0, y, -h], [0.025, 0.025, 2 * h, h, y, 0], [0.025, 0.025, 2 * h, -h, y, 0]);
  }
  add(root, mergedBoxes('ind-fMillBraces', braces), steelD, [wx, 0, wz]);
  for (const [y0, y1] of [[b, 0.6], [0.6, 1.2], [1.2, 1.8]]) {
    const h0 = half(y0), h1 = half(y1);
    for (const s of [1, -1]) beam(root, [wx - s * h0, y0, wz + h0], [wx + s * h1, y1, wz + h1], 0.018, steelD);
    beam(root, [wx + h0, y0, wz - h0], [wx + h1, y1, wz + h1], 0.018, steelD);
  }
  add(root, geo.box(0.26, 0.03, 0.26), woodD, [wx, WH, wz]);
  add(root, geo.box(0.015, WH - 0.2, 0.015), iron, [wx, WH / 2, wz]); // pump rod
  const head = grp(root, wx, WH + 0.1, wz, -0.45);
  add(head, geo.box(0.11, 0.13, 0.24), steelD, [0, 0, 0]);
  add(head, geo.cyl(0.03, 0.03, 0.2, 6), iron, [0, -0.08, 0]);
  add(head, geo.box(0.025, 0.025, 0.5), steelD, [0, 0.02, -0.34]);
  add(head, geo.box(0.02, 0.3, 0.42), team, [0, 0.05, -0.62]);
  const axle = grp(head, 0, 0, 0.15);
  axle.rotation.x = HALF_PI;
  const rotor = grp(axle, 0, 0, 0);
  const blades = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    blades.push([0.075, 0.012, 0.28, Math.sin(a) * 0.23, 0, Math.cos(a) * 0.23, a]);
  }
  add(rotor, mergedBoxes('ind-fMillBlades', blades), mat(0xe2e6ea));
  add(rotor, geo.torus(0.37, 0.02, 3, 16), team, [0, 0, 0], [HALF_PI, 0, 0]);
  add(rotor, geo.torus(0.15, 0.014, 3, 10), steelD, [0, 0, 0], [HALF_PI, 0, 0]);
  add(rotor, geo.cyl(0.05, 0.05, 0.08, 8), iron, [0, 0, 0]);
  // round water tank with iron hoops + pump spout
  const tx = 0.86, tz = 1.18;
  add(root, geo.cyl(0.22, 0.22, 0.34, 12), mat(P.wood), [tx, b + 0.17, tz]);
  add(root, mergedCyls('fTankHoops', [0.08, 0.26].map((y) => [0.227, 0.227, 0.03, 0, y, 0, 0, 0, 12])), iron, [tx, b, tz]);
  add(root, geo.cyl(0.2, 0.2, 0.01, 12), mat(0x3a6aa0), [tx, b + 0.33, tz]);
  rod(root, [wx, b + 0.5, wz], [tx + 0.05, b + 0.42, tz - 0.15], 0.02, iron, 5);

  // --- yard: round hay bales, milk cans by the tank ----------------------------------------------------
  add(root, mergedCyls('fBales', [[0.15, 0.15, 0.24, 0, 0.15, 0, 0, HALF_PI, 10], [0.15, 0.15, 0.24, 0.05, 0.15, 0.34, 0, HALF_PI, 10]]), mat(0xd8b45a), [0.06, b, -0.02]);
  add(root, mergedCyls('fBaleEnds', [[0.12, 0.12, 0.25, 0, 0.15, 0, 0, HALF_PI, 10], [0.12, 0.12, 0.25, 0.05, 0.15, 0.34, 0, HALF_PI, 10]]), mat(0xb8923e), [0.06, b, -0.02]);
  add(root, mergedCyls('fCans', [[0.045, 0.05, 0.14, 0, 0.07, 0, 0, 0, 7], [0.045, 0.05, 0.14, 0.11, 0.07, 0.03, 0, 0, 7], [0.045, 0.05, 0.14, 0.05, 0.07, 0.11, 0, 0, 7]]), steel, [0.5, b, 1.06]);
  return { root, parts: { spin: [rotor] }, height: 3.2, radius: 1.45 };
}

// ===========================================================================
// Factory
// ===========================================================================

// Vehicle factory: brick hall with a saw-tooth roof of skylights, big roll-up garage door with hazard
// jambs, team signage stripes, pale concrete office block with a team sign, two tall smokestacks with
// team bands and sooty smoke, tyres, drums and crates in the yard.
export function factory(tc) {
  const root = new THREE.Group();
  const brick = mat(BRICK), brickD = mat(BRICK_D), conc = mat(CONC), concL = mat(CONC_L), team = mat(tc);
  const steel = mat(STEEL), steelD = mat(STEEL_D), glass = mat(GLASS), sky = mat(SKY_GLASS), iron = mat(P.iron), white = mat(0xf2f0ea);
  add(root, geo.box(2.9, 0.04, 2.9), mat(ASPHALT), [0, 0.02, 0]);
  const b = 0.04, HX = 1.38, Z0 = -1.1, Z1 = 0.6, WH = 1.2;
  const zc = (Z0 + Z1) / 2, D = Z1 - Z0;
  // --- hall --------------------------------------------------------------------------------------------
  add(root, geo.box(2 * HX, WH, D), brick, [0, b + WH / 2, zc]);
  add(root, geo.box(2 * HX + 0.03, 0.16, D + 0.03), brickD, [0, b + 0.08, zc]);
  const pil = [];
  for (const x of [0.9, 1.33]) pil.push([0.1, WH - 0.06, 0.05, x, b + (WH - 0.06) / 2, Z1 + 0.02]);
  for (const s of [1, -1]) for (const z of [-1.05, -0.62, -0.19, 0.24]) pil.push([0.05, WH - 0.06, 0.1, s * (HX + 0.02), b + (WH - 0.06) / 2, z]);
  add(root, mergedBoxes('ind-faPilasters', pil), brickD);
  add(root, geo.box(2 * HX + 0.05, 0.1, D + 0.05), team, [0, b + WH - 0.17, zc]); // team signage stripe
  add(root, geo.box(2 * HX + 0.055, 0.025, D + 0.055), white, [0, b + WH - 0.235, zc]);
  add(root, geo.box(2 * HX + 0.07, 0.06, D + 0.07), concL, [0, b + WH - 0.03, zc]);
  sashWindows(root, 'faRight', 'z', Z1, [[1.115, b + 0.5, 0.22, 0.6]], { frameMat: conc, glassMat: glass, frame: false, bars: false });
  for (const s of [1, -1]) {
    const list = [-0.84, -0.41, 0.03, 0.42].map((z) => [s * -z, b + 0.5, 0.22, 0.5]);
    sashWindows(root, `faSide${s}`, s > 0 ? 'x' : '-x', HX, list, { frameMat: conc, glassMat: glass, frame: false, bars: false });
  }
  // --- saw-tooth roof: glazed north lights face +Z, corrugated slopes ------------------------------------
  const TH = 0.36, n = 4, L = D / n, ry = b + WH;
  const tooth = prism(`saw${L},${TH}`, [[0, 0], [0, TH], [L, 0]], 2 * HX);
  const slopeLen = Math.hypot(L, TH), ang = Math.atan2(TH, L);
  const mull = [];
  for (let i = 0; i < n; i++) {
    const zf = Z1 - i * L;
    add(root, tooth, brick, [0, ry, zf], [0, HALF_PI, 0]);
    add(root, geo.box(2 * HX + 0.08, 0.03, slopeLen + 0.03), mat(0x858a90),
      [0, ry + TH / 2 + Math.cos(ang) * 0.015, zf - L / 2 - Math.sin(ang) * 0.015], [-ang, 0, 0]);
    add(root, geo.box(2 * HX - 0.06, TH * 0.55, 0.02), sky, [0, ry + TH * 0.66, zf + 0.012]);
    add(root, geo.box(2 * HX - 0.06, TH * 0.36, 0.02), steelD, [0, ry + TH * 0.2, zf + 0.012]);
    for (let k = 0; k <= 8; k++) mull.push([0.03, TH * 0.6, 0.03, -HX + 0.05 + (k * (2 * HX - 0.1)) / 8, ry + TH * 0.66, zf + 0.022]);
    mull.push([2 * HX + 0.08, 0.04, 0.05, 0, ry + TH, zf]);
  }
  add(root, mergedBoxes('ind-faMullions', mull), steelD);
  // --- roll-up garage door with hazard jambs, roll housing, threshold stripe -----------------------------
  const gx = 0.32, gw = 1.0, gh = 0.8, fz = Z1;
  add(root, geo.box(gw + 0.18, gh + 0.09, 0.05), conc, [gx, b + (gh + 0.09) / 2, fz + 0.01]);
  add(root, geo.box(gw, gh, 0.04), steel, [gx, b + gh / 2, fz + 0.03]);
  const slats = [];
  for (let i = 1; i < 9; i++) slats.push([gw, 0.014, 0.012, 0, (gh * i) / 9, 0]);
  add(root, mergedBoxes('ind-faSlats', slats), steelD, [gx, b, fz + 0.055]);
  add(root, geo.cyl(0.055, 0.055, gw + 0.16, 8), steelD, [gx, b + gh + 0.07, fz + 0.06], [0, 0, HALF_PI]);
  for (const s of [1, -1]) hazard(root, gx + s * (gw / 2 + 0.045), b + gh / 2, fz + 0.044, gh, 0.08, { vertical: true, slant: s });
  hazard(root, gx, b + 0.005, fz + 0.12, gw, 0.12, { rx: -HALF_PI });
  add(root, geo.box(gw + 0.3, 0.012, 0.7), mat(0x7a7975), [gx, b + 0.003, fz + 0.5]); // concrete apron
  add(root, mergedBoxes('ind-faLaneLines', [[0.05, 0.004, 0.6, -0.2, 0, 0], [0.05, 0.004, 0.6, 0.2, 0, 0]]), mat(HAZ_Y), [gx, b + 0.011, fz + 0.52]);
  // --- office block: pale concrete, ribbon windows, team sign on the roof --------------------------------
  const ox0 = -1.42, ox1 = -0.4, oz0 = 0.3, oz1 = 1.22, OH = 1.32;
  const ox = (ox0 + ox1) / 2, oz = (oz0 + oz1) / 2, ow = ox1 - ox0, od = oz1 - oz0;
  add(root, geo.box(ow, OH, od), concL, [ox, b + OH / 2, oz]);
  add(root, geo.box(ow + 0.04, 0.08, od + 0.04), conc, [ox, b + OH + 0.02, oz]);
  add(root, geo.box(ow + 0.02, 0.1, od + 0.02), conc, [ox, b + 0.05, oz]);
  const rib = [[0.86, 0.22, 0.03, 0, 0.5, 0], [0.86, 0.22, 0.03, 0, 1.0, 0], [0.03, 0.22, 0.7, ow / 2, 1.0, -od / 2 + 0.4]];
  add(root, mergedBoxes('ind-faRibbons', rib.map(([w, h, d, x, y, z]) => [w, h, d, x, y, z === 0 ? od / 2 + 0.005 : z])), glass, [ox, b, oz]);
  const ribM = [];
  for (const y of [0.5, 1.0]) for (let k = 0; k <= 5; k++) ribM.push([0.02, 0.22, 0.02, -0.43 + k * 0.172, y, od / 2 + 0.02]);
  add(root, mergedBoxes('ind-faRibbonMull', ribM), conc, [ox, b, oz]);
  add(root, geo.box(0.22, 0.4, 0.03), glass, [ox + 0.3, b + 0.2, oz1 + 0.01]); // glazed door (below the ribbon)
  add(root, geo.box(0.36, 0.035, 0.18), conc, [ox + 0.3, b + 0.42, oz1 + 0.08]);
  const sy = b + OH + 0.06;
  add(root, mergedBoxes('ind-faSignPosts', [[0.03, 0.34, 0.03, -0.36, 0.17, 0], [0.03, 0.34, 0.03, 0.36, 0.17, 0]]), steelD, [ox, sy, oz1 - 0.12]);
  add(root, geo.box(0.92, 0.26, 0.04), team, [ox, sy + 0.24, oz1 - 0.1]);
  add(root, mergedBoxes('ind-faSignStripes', [[0.84, 0.03, 0.012, 0, 0.07, 0], [0.84, 0.03, 0.012, 0, -0.07, 0], [0.5, 0.05, 0.012, 0, 0, 0]]), white, [ox, sy + 0.24, oz1 - 0.074]);
  // --- smokestacks ----------------------------------------------------------------------------------
  const puffs = [];
  for (const [x, top] of [[-1.02, 3.4], [0.98, 3.15]]) {
    const z = -1.22, y0 = b + 0.56, h = top - 0.1 - y0;
    add(root, geo.box(0.44, 0.52, 0.44), brickD, [x, b + 0.26, z]);
    add(root, geo.box(0.48, 0.06, 0.48), concL, [x, b + 0.54, z]);
    add(root, geo.cyl(0.13, 0.19, h, 10), brick, [x, y0 + h / 2, z]);
    const rAt = (y) => 0.19 - (0.06 * (y - y0)) / h + 0.012;
    add(root, geo.cyl(rAt(top - 0.42), rAt(top - 0.58), 0.16, 10), team, [x, top - 0.5, z]);
    add(root, mergedCyls(`faStackBands${top}`, [[rAt(top - 0.66), rAt(top - 0.7), 0.04, 0, top - 0.68, 0, 0, 0, 10], [rAt(top - 0.3), rAt(top - 0.34), 0.04, 0, top - 0.32, 0, 0, 0, 10]]), white, [x, 0, z]);
    add(root, geo.cyl(0.16, 0.14, 0.1, 10), iron, [x, top - 0.05, z]);
    puffs.push(smoke(root, x, top + 0.02, z, { s: 0.1, n: 4, color: SOOT, opacity: 0.72 }));
  }
  // --- yard props: tyre stacks, oil drums, crates ------------------------------------------------------
  const tyres = [], hubs = [];
  for (const [x, z, k] of [[1.16, 0.86, 3], [1.2, 1.2, 2]]) {
    for (let i = 0; i < k; i++) tyres.push([0.15, 0.15, 0.075, x, 0.04 + 0.0375 + i * 0.077, z, 0, 0, 10]);
    hubs.push([0.07, 0.07, 0.01, x, 0.04 + k * 0.077 + 0.003, z, 0, 0, 8]);
  }
  add(root, mergedCyls('faTyres', tyres), mat(0x1f1f22));
  add(root, mergedCyls('faHubs', hubs), steel);
  add(root, mergedCyls('faDrums', [[0.09, 0.09, 0.26, 0, 0.13, 0, 0, 0, 8], [0.09, 0.09, 0.26, 0.2, 0.13, 0.02, 0, 0, 8]]), mat(0x2f5f8a), [-0.28, 0.04, 1.32]);
  add(root, mergedCyls('faDrumRims', [[0.093, 0.093, 0.02, 0, 0.09, 0, 0, 0, 8], [0.093, 0.093, 0.02, 0.2, 0.09, 0.02, 0, 0, 8], [0.093, 0.093, 0.02, 0, 0.19, 0, 0, 0, 8], [0.093, 0.093, 0.02, 0.2, 0.19, 0.02, 0, 0, 8]]), steelD, [-0.28, 0.04, 1.32]);
  add(root, mergedBoxes('ind-faCrates', [[0.26, 0.24, 0.26, 0, 0.12, 0], [0.22, 0.2, 0.22, 0.02, 0.34, 0.01, 0.3], [0.24, 0.22, 0.24, 0.28, 0.11, 0.05, 0.15]]), mat(P.woodLight), [0.94, 0.04, 1.28 - 0.04]);
  return { root, parts: { bob: puffs, spin: puffs }, height: 3.4, radius: 1.45 };
}

// ===========================================================================
// Bunker tower
// ===========================================================================

/** Muzzle of the bunker's machine gun in the weapon group's frame (the group sits at BUNKER_PIVOT). */
const BUNKER_PIVOT = [0, 0.92, 0.44];
const BUNKER_MUZZLE = [0, 0, 0.46];

// Octagonal concrete pillbox on a short tower base: firing slits under concrete hoods, sandbag ring at
// the foot and on the roof, team band, radio set + whip antenna, small team flag. The water-cooled
// machine gun in the front slit is parts.weapon (it pitches like a ranged unit's weapon arm).
export function tower_bunker(tc) {
  const root = new THREE.Group();
  const conc = mat(CONC), concD = mat(CONC_D), concL = mat(CONC_L), team = mat(tc), dark = mat(0x16171b);
  const sand = mat(SAND), sandD = mat(SAND_D), steelD = mat(STEEL_D), iron = mat(P.iron);
  const oct = Math.PI / 8, cosO = Math.cos(oct);
  add(root, geo.box(1.9, 0.04, 1.9), mat(0x8f8670), [0, 0.02, 0]); // packed gravel
  // sandbag ring at the foot, open at the back for the door
  const bagsA = [], bagsB = [];
  const ring = (list, r, y, ln, offs, a, h = 0.11, d = 0.17) => {
    const ca = Math.cos(a), sa = Math.sin(a);
    for (const t of offs) list.push([ln, h, d, sa * r + ca * t, y, ca * r - sa * t, a]);
  };
  for (let i = 0; i < 8; i++) {
    if (i === 4) continue;
    const a = (i * Math.PI) / 4;
    ring(bagsA, 0.83, 0.095, 0.34, [-0.175, 0.175], a);
    ring(bagsB, 0.82, 0.2, 0.235, [-0.24, 0, 0.24], a, 0.1, 0.16);
  }
  add(root, mergedBoxes('ind-tbBagsA', bagsA), sand);
  add(root, mergedBoxes('ind-tbBagsB', bagsB), sandD);
  // tower base + pillbox
  add(root, geo.cyl(0.6, 0.68, 0.56, 8), concD, [0, 0.04 + 0.28, 0], [0, oct, 0]);
  add(root, geo.cyl(0.605, 0.605, 0.04, 8), conc, [0, 0.42, 0], [0, oct, 0]);
  add(root, geo.cyl(0.68, 0.64, 0.62, 8), conc, [0, 0.6 + 0.31, 0], [0, oct, 0]);
  add(root, geo.cyl(0.685, 0.685, 0.12, 8), team, [0, 0.69, 0], [0, oct, 0]);
  add(root, geo.cyl(0.78, 0.78, 0.12, 8), concL, [0, 1.28, 0], [0, oct, 0]);
  // firing slits with hoods on all eight faces (wide one in front for the gun)
  const slits = [], hoods = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, ap = 0.655 * cosO;
    const w = i === 0 ? 0.42 : 0.3, h = i === 0 ? 0.14 : 0.07;
    slits.push([w, h, 0.03, Math.sin(a) * (ap + 0.004), BUNKER_PIVOT[1], Math.cos(a) * (ap + 0.004), a]);
    hoods.push([w + 0.1, 0.045, 0.08, Math.sin(a) * (ap + 0.03), BUNKER_PIVOT[1] + h / 2 + 0.03, Math.cos(a) * (ap + 0.03), a]);
  }
  add(root, mergedBoxes('ind-tbSlits', slits), dark);
  add(root, mergedBoxes('ind-tbHoods', hoods), concL);
  // roof: sandbag parapet, hatch, radio set + whip antenna, team flag
  const roofBags = [];
  for (let i = 0; i < 8; i++) ring(roofBags, 0.6, 1.39, 0.4, [0], (i * Math.PI) / 4, 0.1, 0.15);
  add(root, mergedBoxes('ind-tbRoofBags', roofBags), sand);
  add(root, geo.box(0.26, 0.04, 0.26), steelD, [0.05, 1.36, -0.08]);
  add(root, geo.box(0.17, 0.13, 0.12), mat(0x56603c), [-0.26, 1.405, -0.3]);
  add(root, geo.box(0.06, 0.04, 0.01), mat(0xd8d2a0), [-0.26, 1.42, -0.236]);
  add(root, geo.cyl(0.006, 0.011, 0.62, 4), iron, [-0.31, 1.78, -0.32]);
  add(root, geo.sphere(0.022, 5, 4), mat(0xd02020), [-0.31, 2.1, -0.32]);
  flag(root, 0.3, 1.34, -0.32, tc, { pole: 0.56, w: 0.36, h: 0.22, dir: -1, poleColor: STEEL_D, finial: null, poleR: 0.016 });
  // steel door + step at the back
  add(root, geo.box(0.28, 0.44, 0.03), steelD, [0, 0.27, -0.6]);
  add(root, geo.box(0.36, 0.06, 0.18), concD, [0, 0.07, -0.7]);
  // water-cooled machine gun: receiver inside the slit, jacket + barrel + flash hider, gun shield
  const weapon = grp(root, ...BUNKER_PIVOT);
  add(weapon, geo.box(0.1, 0.1, 0.24), iron, [0, 0, -0.04]);
  add(weapon, geo.cyl(0.042, 0.042, 0.3, 8), steelD, [0, 0, 0.24], [HALF_PI, 0, 0]);
  add(weapon, geo.cyl(0.018, 0.018, 0.06, 6), iron, [0, 0, 0.41], [HALF_PI, 0, 0]);
  add(weapon, geo.cyl(0.03, 0.022, 0.04, 6), iron, [0, 0, BUNKER_MUZZLE[2] - 0.02], [HALF_PI, 0, 0]);
  add(weapon, geo.box(0.3, 0.17, 0.02), steelD, [0, 0.01, 0.2]);
  add(weapon, geo.box(0.04, 0.06, 0.06), iron, [0, -0.08, 0.02]);
  return { root, parts: { weapon }, height: 1.9, radius: 0.95 };
}

// ===========================================================================
// Concrete wall + checkpoint gate
// Same tiling rules as the ages.js fortifications: the wall body fills its 1x1 cell exactly and every
// detail repeats with period 1 (edge details overhang by at most 6 mm), so pieces join in any of the 8
// directions. Steel posts stand only on the cell corners and pair up across seams; the coiled wire
// runs along all four top edges between them. The team band sits at the same height on wall and gate.
// The gate is 2x2: wall line along X, passage along Z, pier side faces flush with x = +-1.
// parts.doors = [{ obj, side }], obj on the hinge; the game sets obj.rotation.y = side * open * 1.4
// (both leaves swing toward -Z).
// ===========================================================================

const WALL_BAND_Y = 0.9, WALL_BAND_H = 0.15;
const CAP = 0x9d9b93; // wall/pier top (a touch darker than the faces so long runs don't glare)

/**
 * Concertina wire: n alternately tilted flat loops (radius r, wire width w) along X from -len/2 to len/2,
 * merged (cached). Flat rings are cheap; draw them with a double-sided material.
 */
function concertina(len, r, n, w = 0.014) {
  return geo.custom(`ind-coil:${len},${r},${n},${w}`, () => {
    const list = [];
    for (let i = 0; i < n; i++) {
      const g = new THREE.RingGeometry(r - w, r, 9, 1);
      g.rotateY(HALF_PI + (i % 2 ? 0.5 : -0.5));
      g.translate(-len / 2 + (len * (i + 0.5)) / n, 0, 0);
      list.push(g);
    }
    return mergeAll(list);
  });
}

export function wall_concrete(tc) {
  const root = new THREE.Group();
  const conc = mat(CONC), concD = mat(CONC_D), team = mat(tc), steelD = mat(STEEL_D);
  add(root, geo.box(1, 0.1, 1), concD, [0, 0.05, 0]); // footing
  add(root, geo.box(1, 1.2, 1), conc, [0, 0.7, 0]); // slab 0.1 .. 1.3
  add(root, geo.box(1.006, WALL_BAND_H, 1.006), team, [0, WALL_BAND_Y, 0]);
  add(root, mergedBoxes('ind-wcPin', [[1.008, 0.018, 1.008, 0, WALL_BAND_Y - WALL_BAND_H / 2 - 0.006, 0], [1.008, 0.018, 1.008, 0, WALL_BAND_Y + WALL_BAND_H / 2 + 0.006, 0]]), mat(HAZ_K));
  // formwork lines and panel joints at the cell edges (neighbours' joints pair up into one seam)
  add(root, mergedBoxes('ind-wcLines', [
    [1.004, 0.014, 1.004, 0, 0.45, 0],
    [1.004, 0.014, 1.004, 0, 1.17, 0],
    ...onFourFaces([[0.016, 1.18, 0.492, 0.7], [0.016, 1.18, -0.492, 0.7]], 0.01),
  ]), concD);
  add(root, geo.box(1, 0.06, 1), mat(CAP), [0, 1.33, 0]); // cap 1.30 .. 1.36
  // steel posts on the corners, coiled wire along the edges between them
  const o = 0.47;
  add(root, mergedBoxes('ind-wcPosts', [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => [0.05, 0.3, 0.05, sx * o, 1.36 + 0.15, sz * o])), steelD);
  const coil = concertina(0.86, 0.085, 6, 0.022);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    add(root, coil, mat(WIRE, { side: THREE.DoubleSide }), [Math.sin(a) * 0.415, 1.455, Math.cos(a) * 0.415], [0, a, 0]);
  }
  return { root, parts: {}, height: 1.6, radius: 0.5 };
}

/**
 * Steel gate leaf. The returned group sits on the hinge; the leaf extends toward +X (dir = 1) or -X
 * (dir = -1) with its front face on the hinge plane, so rotation.y = dir * angle swings it toward -Z.
 */
function steelLeaf(parent, x, z, dir, w, h) {
  const hinge = grp(parent, x, 0, z);
  const t = 0.05, y0 = 0.03;
  const frame = mat(0x3f454d), plate = mat(0x7c848d), bars = mat(0x5a616a);
  add(hinge, mergedBoxes(`ind-leafFrame:${w},${h},${dir}`, [
    [0.06, h, t, dir * 0.03, y0 + h / 2, -t / 2],
    [0.06, h, t, dir * (w - 0.03), y0 + h / 2, -t / 2],
    [w, 0.07, t, (dir * w) / 2, y0 + 0.035, -t / 2],
    [w, 0.07, t, (dir * w) / 2, y0 + h - 0.035, -t / 2],
    [w, 0.06, t, (dir * w) / 2, y0 + h * 0.5, -t / 2],
  ]), frame);
  add(hinge, geo.box(w - 0.1, h * 0.5 - 0.08, t * 0.5), plate, [(dir * w) / 2, y0 + h * 0.25 + 0.01, -t / 2]);
  const vb = [];
  for (let i = 1; i <= 4; i++) vb.push([0.026, h * 0.5 - 0.08, 0.026, dir * (w * i) / 5, y0 + h * 0.75 - 0.005, -t / 2]);
  vb.push([0.05, 0.12, t + 0.03, 0, y0 + h * 0.2, -t / 2], [0.05, 0.12, t + 0.03, 0, y0 + h * 0.8, -t / 2]); // hinge knuckles
  add(hinge, mergedBoxes(`ind-leafBars:${w},${h},${dir}`, vb), bars);
  hazard(hinge, (dir * w) / 2, y0 + h * 0.25 + 0.01, 0.002, w - 0.12, 0.13, { slant: dir, period: 0.12 });
  return { obj: hinge, side: dir };
}

export function gate_concrete(tc) {
  const root = new THREE.Group();
  const conc = mat(CONC), concD = mat(CONC_D), team = mat(tc), steelD = mat(STEEL_D), iron = mat(P.iron);
  const PW = 0.56, GZ = 0.975, H = 1.44, pw = 1 - PW, pc = PW + pw / 2;
  const glow = [];
  // road through the passage: asphalt, stop lines, a striped speed bump outside
  add(root, geo.box(2 * PW, 0.02, 2), mat(ASPHALT), [0, 0.01, 0]);
  add(root, mergedBoxes('ind-gcStop', [[2 * PW - 0.1, 0.004, 0.06, 0, 0.021, 0.78], [2 * PW - 0.1, 0.004, 0.06, 0, 0.021, -0.78]]), mat(0xf2f0ea));
  hazard(root, 0, 0.03, 0.9, 2 * PW - 0.04, 0.1, { rx: -HALF_PI, period: 0.12 });
  for (const s of [1, -1]) {
    const x = s * pc;
    add(root, geo.box(pw, 0.1, 2 * GZ), concD, [x, 0.05, 0]);
    add(root, geo.box(pw, H - 0.1, 2 * GZ), conc, [x, 0.1 + (H - 0.1) / 2, 0]);
    add(root, geo.box(pw + 0.006, WALL_BAND_H, 2 * GZ + 0.006), team, [x, WALL_BAND_Y, 0]);
    add(root, mergedBoxes('ind-gcPin', [[pw + 0.008, 0.018, 2 * GZ + 0.008, 0, WALL_BAND_Y - WALL_BAND_H / 2 - 0.006, 0], [pw + 0.008, 0.018, 2 * GZ + 0.008, 0, WALL_BAND_Y + WALL_BAND_H / 2 + 0.006, 0]]), mat(HAZ_K), [x, 0, 0]);
    add(root, mergedBoxes('ind-gcLines', [[pw + 0.004, 0.014, 2 * GZ + 0.004, 0, 0.45, 0], [pw + 0.004, 0.014, 2 * GZ + 0.004, 0, 1.17, 0]]), concD, [x, 0, 0]);
    add(root, geo.box(pw + 0.02, 0.08, 2 * GZ + 0.02), mat(CAP), [x - s * 0.01, H + 0.04, 0]);
    const coil = concertina(0.74, 0.085, 5, 0.022);
    for (const sz of [1, -1]) add(root, coil, mat(WIRE, { side: THREE.DoubleSide }), [x + s * 0.04, H + 0.17, sz * 0.56], [0, HALF_PI, 0]);
    add(root, mergedBoxes('ind-gcPosts', [[0.05, 0.3, 0.05, 0, 0.15, 0.93], [0.05, 0.3, 0.05, 0, 0.15, -0.93]]), steelD, [x + s * 0.04, H + 0.08, 0]);
    // hazard stripes on the pier nose and the inner face at the front (the camera never sees the back)
    hazard(root, s * (PW + 0.075), 0.12 + (H - 0.2) / 2, GZ + 0.008, H - 0.2, 0.15, { vertical: true, slant: s });
    hazard(root, s * (PW - 0.008), 0.12 + (H - 0.2) / 2, GZ - 0.075, H - 0.2, 0.15, { vertical: true, ry: -s * HALF_PI, slant: -1 });
    // sentry window on the pier front
    add(root, geo.box(0.22, 0.17, 0.03), steelD, [s * (pc + 0.07), 1.2, GZ + 0.005]);
    add(root, geo.box(0.17, 0.12, 0.03), mat(0x30425a), [s * (pc + 0.07), 1.2, GZ + 0.012]);
    // floodlight on the pier cap
    const lx = s * (PW + 0.14), lz = 0.66;
    add(root, geo.cyl(0.022, 0.03, 0.44, 6), iron, [lx, H + 0.08 + 0.22, lz]);
    add(root, geo.box(0.12, 0.08, 0.15), steelD, [lx, H + 0.56, lz + 0.02], [0.35, 0, 0]);
    const lamp = add(root, geo.box(0.09, 0.02, 0.11), glowMat(0xfff0b8, 1), [lx, H + 0.51, lz + 0.04], [0.35, 0, 0]);
    lamp.castShadow = false;
    glow.push(lamp);
  }
  // overhead steel beam with hazard bands, team insignia (roundel + star), amber beacon
  const by = H + 0.08 + 0.09;
  add(root, geo.box(2, 0.18, 0.2), steelD, [0, by, 0]);
  hazard(root, 0, by, 0.108, 2 * PW, 0.12);
  const ins = grp(root, 0, by, 0.11);
  add(ins, geo.cyl(0.2, 0.2, 0.03, 14), mat(0xf2f0ea), [0, 0, 0.015], [HALF_PI, 0, 0]);
  add(ins, geo.cyl(0.17, 0.17, 0.03, 14), team, [0, 0, 0.025], [HALF_PI, 0, 0]);
  add(ins, starGeo(), mat(0xf2f0ea), [0, 0, 0.045], null, [0.12, 0.12, 0.012]);
  add(root, geo.cyl(0.05, 0.06, 0.04, 8), iron, [0, by + 0.11, 0]);
  const beacon = add(root, geo.cyl(0.04, 0.045, 0.08, 8), glowMat(0xffa21a, 1), [0, by + 0.17, 0]);
  beacon.castShadow = false;
  glow.push(beacon);
  // two steel leaves hinged on the piers, just inside the front faces
  const ZH = 0.6, w = PW - 0.012, h = 1.16;
  const doors = [steelLeaf(root, -PW + 0.006, ZH, 1, w, h), steelLeaf(root, PW - 0.006, ZH, -1, w, h)];
  return { root, parts: { doors, glow }, height: 2.1, radius: 1.0 };
}

