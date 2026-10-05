// Shared building blocks for the procedural low-poly models.
// Every mesh uses cached geometry (geo.*) and cached materials (mat()) from
// ../assets.js, so creating many instances only allocates Object3Ds.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, geo, mesh } from '../assets.js';

export { THREE, mat, geo };

/**
 * Cached merged geometry made of boxes: [[w,h,d, x,y,z, ry?, rx?], ...].
 * Used for repetitive detail (crenellations, gear teeth, planks) so it costs one mesh.
 */
export function mergedBoxes(key, boxes) {
  return geo.custom(`mb:${key}`, () => {
    const list = boxes.map(([w, h, d, x, y, z, ry = 0, rx = 0]) => {
      const b = new THREE.BoxGeometry(w, h, d);
      if (rx) b.rotateX(rx);
      if (ry) b.rotateY(ry);
      b.translate(x, y, z);
      return b;
    });
    const g = mergeGeometries(list, false);
    for (const b of list) b.dispose();
    return g;
  });
}

/** Merged ring of n merlons, base at y=0. */
export function crenRingGeo(radius, n, w, h, d) {
  const boxes = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    boxes.push([w, h, d, Math.sin(a) * radius, h / 2, Math.cos(a) * radius, a]);
  }
  return mergedBoxes(`cring${radius},${n},${w},${h},${d}`, boxes);
}

/** Merged merlons along the edges of a W x D rectangle, base at y=0. */
export function crenRectGeo(W, D, n, s, h = s) {
  const boxes = [];
  const nz = Math.max(2, Math.round((n * D) / W));
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + (W * (i + 0.5)) / n;
    boxes.push([s, h, s * 0.8, x, h / 2, D / 2 - s * 0.4]);
    boxes.push([s, h, s * 0.8, x, h / 2, -D / 2 + s * 0.4]);
  }
  for (let i = 1; i < nz - 1; i++) {
    const z = -D / 2 + (D * (i + 0.5)) / nz;
    boxes.push([s * 0.8, h, s, W / 2 - s * 0.4, h / 2, z]);
    boxes.push([s * 0.8, h, s, -W / 2 + s * 0.4, h / 2, z]);
  }
  return mergedBoxes(`crect${W},${D},${n},${s},${h}`, boxes);
}

/** Warcraft-ish palette. */
export const P = {
  steel: 0xb4bcc6,
  steelDark: 0x6c7480,
  steelLight: 0xe2e8ef,
  mail: 0x858d98,
  iron: 0x3c4048,
  gold: 0xf2c43c,
  goldDark: 0xb98a1e,
  bronze: 0xb87333,
  skin: 0xf2c49b,
  skinShade: 0xd9a27c,
  leather: 0x7b4a25,
  leatherDark: 0x4e2e15,
  cloth: 0x8f6a42,
  linen: 0xeadcbc,
  wood: 0x8a5a2e,
  woodDark: 0x5a3a1c,
  woodLight: 0xb5844b,
  stone: 0xa8a59c,
  stoneDark: 0x7a776f,
  stoneLight: 0xcdc9bd,
  marble: 0xeeeae2,
  thatch: 0xdcb25c,
  thatchDark: 0xb48a3a,
  slate: 0x56637e,
  plaster: 0xf1e4c4,
  white: 0xf6f5f0,
  black: 0x1c1c20,
  bone: 0xe8e0c6,
  boneDark: 0xb9ae90,
  rust: 0x9a5a35,
  grass: 0x5f9e35,
  leaf: 0x3f8a2c,
  leafLight: 0x6cb33e,
  crimson: 0xb0101e,
  crimsonDark: 0x6a0812,
  darkIron: 0x26272d,
  darkIron2: 0x3a3c45,
  darkStone: 0x3d3b42,
  darkStone2: 0x55525a,
  sick: 0x7dff3a,
};

/** Emissive "glowing" material (cached). */
export const glowMat = (color, intensity = 1, extra = {}) =>
  mat(color, { emissive: color, emissiveIntensity: intensity, ...extra });

export const FIRE = {
  orange: [
    () => mat(0xff6a00, { emissive: 0xff4a00, emissiveIntensity: 1 }),
    () => mat(0xffd84a, { emissive: 0xffc22a, emissiveIntensity: 1 }),
  ],
  green: [
    () => mat(0x2aff3a, { emissive: 0x1ed42a, emissiveIntensity: 1 }),
    () => mat(0xd2ff7a, { emissive: 0xb0ff4a, emissiveIntensity: 1 }),
  ],
  red: [
    () => mat(0xff2418, { emissive: 0xd80c00, emissiveIntensity: 1 }),
    () => mat(0xffa040, { emissive: 0xff7a20, emissiveIntensity: 1 }),
  ],
};

/** New group, optionally parented and placed. */
export function grp(parent, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (ry) g.rotation.y = ry;
  if (parent) parent.add(g);
  return g;
}

/**
 * Add a shadow-casting mesh. p = [x,y,z], r = [rx,ry,rz], s = number | [sx,sy,sz].
 */
export function add(parent, geometry, material, p, r, s) {
  const m = mesh(geometry, material, p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0, parent);
  if (r) m.rotation.set(r[0] || 0, r[1] || 0, r[2] || 0);
  if (s !== undefined && s !== null) {
    if (typeof s === 'number') m.scale.setScalar(s);
    else m.scale.set(s[0], s[1], s[2]);
  }
  m.castShadow = true;
  return m;
}

/** A box stretched between two points (thin beam / bone / pole). */
export function beam(parent, a, b, w, material, d = w) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const m = add(parent, geo.box(w, len, d), material, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return m;
}

/** A cylinder stretched between two points. */
export function rod(parent, a, b, rad, material, seg = 6, radB = rad) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const m = add(parent, geo.cyl(radB, rad, len, seg), material, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return m;
}

// ---------------------------------------------------------------------------
// Custom cached geometries
// ---------------------------------------------------------------------------
export const CG = {
  /** Gable roof prism: ridge along X (len 1), base spans z -0.5..0.5 at y=0, apex y=1. */
  gable: () =>
    geo.custom('gable', () => {
      const s = new THREE.Shape();
      s.moveTo(-0.5, 0);
      s.lineTo(0.5, 0);
      s.lineTo(0, 1);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
      g.translate(0, 0, -0.5);
      g.rotateY(Math.PI / 2);
      return g;
    }),
  /** Square pyramid, base 1x1 at y=0, apex at y=1. */
  pyramid: () =>
    geo.custom('pyr4', () => {
      const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      g.translate(0, 0.5, 0);
      return g;
    }),
  /** Square frustum, bottom 1x1, top ratio x ratio, height 1, centered. */
  frustum: (ratio) =>
    geo.custom(`frus4_${ratio}`, () => {
      const g = new THREE.CylinderGeometry(ratio * Math.SQRT1_2, Math.SQRT1_2, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      return g;
    }),
  /** Kite shield: width 1, height 1, thickness 1 (scale it), face toward +Z. */
  kite: () =>
    geo.custom('kite', () => {
      const s = new THREE.Shape();
      s.moveTo(-0.5, 0.36);
      s.lineTo(-0.36, 0.5);
      s.lineTo(0.36, 0.5);
      s.lineTo(0.5, 0.36);
      s.lineTo(0.42, -0.06);
      s.lineTo(0, -0.5);
      s.lineTo(-0.42, -0.06);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
      g.translate(0, 0, -0.5);
      return g;
    }),
  /** Bow arc in the YZ plane, grip at origin, belly toward +Z, height ~1.29, tips at z=-0.235. */
  bow: () =>
    geo.custom('bowArc', () => {
      const g = new THREE.TorusGeometry(1, 0.05, 4, 10, 1.4);
      g.rotateZ(-0.7);
      g.translate(-1, 0, 0);
      g.rotateY(-Math.PI / 2);
      return g;
    }),
  /** Bat/dragon wing membrane lying in XZ plane, root at x=0, extending to +X ~1.0. */
  wing: () =>
    geo.custom('wingMembrane', () => {
      const pts = [
        [0, 0.16], [0.5, 0.32], [1.0, 0.06], [0.82, -0.08], [0.66, -0.02],
        [0.5, -0.26], [0.32, -0.14], [0.16, -0.3], [0, -0.2],
      ];
      const s = new THREE.Shape();
      s.moveTo(pts[0][0], -pts[0][1]);
      for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], -pts[i][1]);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false });
      g.translate(0, 0, -0.0125);
      g.rotateX(-Math.PI / 2);
      return g;
    }),
  /** Flat isosceles triangle (pennant / tooth), base along Y at x=0 (-0.5..0.5), tip at x=1. */
  pennant: () =>
    geo.custom('pennant', () => {
      const s = new THREE.Shape();
      s.moveTo(0, 0.5);
      s.lineTo(1, 0);
      s.lineTo(0, -0.5);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
      g.translate(0, 0, -0.5);
      return g;
    }),
  /** Curved blade (katana / scimitar): along +Y, length 1, width ~0.12, thin. */
  curvedBlade: () =>
    geo.custom('curvedBlade', () => {
      const s = new THREE.Shape();
      s.moveTo(-0.05, 0);
      s.quadraticCurveTo(-0.02, 0.55, 0.06, 1.0);
      s.quadraticCurveTo(0.07, 0.5, 0.05, 0);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false, curveSegments: 4 });
      g.translate(0, 0, -0.01);
      return g;
    }),
  /** Axe head: blade fan on +Z side of the haft, thin in X. Size ~1. */
  axeHead: () =>
    geo.custom('axeHead', () => {
      const s = new THREE.Shape();
      s.moveTo(0, -0.18);
      s.lineTo(0.35, -0.42);
      s.quadraticCurveTo(0.55, 0, 0.35, 0.42);
      s.lineTo(0, 0.18);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false, curveSegments: 3 });
      g.translate(0, 0, -0.04);
      g.rotateY(-Math.PI / 2); // shape +X -> +Z
      return g;
    }),
};

// ---------------------------------------------------------------------------
// Humanoid rig
// ---------------------------------------------------------------------------
/**
 * Creates the skeleton groups of a biped. Coordinates: y up, facing +Z.
 * Character's left = +X, right (weapon hand) = -X.
 */
export function rig({ legLen, hipW, shoulderX, shoulderY, neckY, headZ = 0, shoulderZ = 0, legAmp = 0.6 }) {
  const root = new THREE.Group();
  const legs = [];
  for (const side of [1, -1]) {
    const lg = grp(root, side * hipW, legLen, 0);
    legs.push({ obj: lg, phase: side > 0 ? 0 : Math.PI, amp: legAmp });
  }
  const body = grp(root, 0, legLen, 0);
  const head = grp(body, 0, neckY, headZ);
  const armL = grp(body, shoulderX, shoulderY, shoulderZ);
  const weapon = grp(body, -shoulderX, shoulderY, shoulderZ);
  return { root, body, head, legs, armL, weapon };
}

/** Wrap a rig in an outer group that scales it uniformly (keeps root.scale free for the game). */
export function scaled(r, s) {
  const outer = new THREE.Group();
  outer.add(r.root);
  r.root.scale.setScalar(s);
  r.root = outer;
  return r;
}

/** Leg meshes hanging from a hip pivot: upper leg + boot. */
export function legMesh(lg, len, w, upperMat, bootMat, { bootH = 0.45, toe = 0.25 } = {}) {
  add(lg, geo.box(w, len * 0.62, w * 1.05), upperMat, [0, -len * 0.31, 0]);
  const bh = len * bootH;
  add(lg, geo.box(w * 1.15, bh, w * 1.65), bootMat, [0, -len + bh / 2, w * toe]);
}

/**
 * Arm meshes from a shoulder pivot: upper arm straight down, forearm bent forward.
 * Returns the hand group (at the palm, unrotated).
 */
export function armMesh(ag, { upper, fore, w, upperMat, foreMat, handMat, bend = 0.5, handR, foreW }) {
  add(ag, geo.box(w, upper, w), upperMat, [0, -upper / 2, 0]);
  const dy = -Math.cos(bend), dz = Math.sin(bend);
  const fw = foreW ?? w * 1.08;
  add(ag, geo.box(fw, fore, fw), foreMat ?? upperMat, [0, -upper + (dy * fore) / 2, (dz * fore) / 2], [-bend, 0, 0]);
  const hand = grp(ag, 0, -upper + dy * fore, dz * fore);
  if (handMat) add(hand, geo.sphere(handR ?? w * 0.68, 6, 4), handMat);
  return hand;
}

/**
 * Grip tilts. Melee weapons rest pointing forward and slightly down, so that the wind-up
 * (weapon.rotation.x ~ +2.4) puts the blade behind the head and the strike (~ -0.9) ends level/forward.
 * Staffs rest leaning ~15deg back against the shoulder, so a raised casting pose (~ +2.5) points
 * the staff head forward at the target.
 */
export const MELEE_TILT = 2.0;
export const STAFF_TILT = -0.25;

/** A pivot group inside a hand, rotated so its +Y points forward/up by `tilt` (radians from vertical). */
export function grip(hand, tilt = 1.0, x = 0, y = 0, z = 0) {
  const g = grp(hand, x, y, z);
  g.rotation.x = tilt;
  return g;
}

// ---------------------------------------------------------------------------
// Weapons & gear (built along +Y of the given group)
// ---------------------------------------------------------------------------
export function sword(g, { len = 0.48, w = 0.06, blade = P.steelLight, guard = P.gold, handle = P.leatherDark, bladeMat } = {}) {
  add(g, geo.cyl(0.018, 0.018, 0.12, 5), mat(handle), [0, 0, 0]);
  add(g, geo.sphere(0.03, 5, 4), mat(guard), [0, -0.07, 0]);
  add(g, geo.box(w * 2.6, 0.03, 0.045), mat(guard), [0, 0.065, 0]);
  const bm = bladeMat ?? mat(blade);
  add(g, geo.box(w, len, 0.018), bm, [0, 0.08 + len / 2, 0]);
  add(g, geo.cone(w * 0.72, w * 1.6, 4), bm, [0, 0.08 + len + w * 0.8, 0], [0, Math.PI / 4, 0], [1, 1, 0.3]);
}

export function kiteShield(parent, color, { w = 0.3, h = 0.42, x = 0, y = 0, z = 0, ry = 0.6, rim = P.steel, boss = P.gold } = {}) {
  const g = grp(parent, x, y, z, ry);
  add(g, CG.kite(), mat(rim), [0, 0, -0.006], null, [w * 1.12, h * 1.08, 0.03]);
  add(g, CG.kite(), mat(color), [0, 0, 0.012], null, [w, h, 0.02]);
  add(g, geo.box(w * 0.18, h * 0.55, 0.02), mat(boss), [0, h * 0.06, 0.026]);
  add(g, geo.box(w * 0.55, w * 0.16, 0.02), mat(boss), [0, h * 0.18, 0.026]);
  return g;
}

export function roundShield(parent, faceColor, { r = 0.17, x = 0, y = 0, z = 0, ry = 0.6, rim = P.steelDark, boss = P.steel } = {}) {
  const g = grp(parent, x, y, z, ry);
  add(g, geo.cyl(r, r, 0.04, 10), mat(rim), [0, 0, 0], [Math.PI / 2, 0, 0]);
  add(g, geo.cyl(r * 0.84, r * 0.84, 0.05, 10), mat(faceColor), [0, 0, 0.004], [Math.PI / 2, 0, 0]);
  add(g, geo.sphere(r * 0.28, 6, 4), mat(boss), [0, 0, 0.03], null, [1, 1, 0.6]);
  return g;
}

/** Bow along +Y of g (grip at origin, belly +Z). size = overall height. */
export function bowMesh(parent, size = 0.8, { wood = P.woodDark, string = 0xe8e2d0, woodMat, grip: gripC = P.leather, twist = -0.85 } = {}) {
  // twist turns the bow about its own axis so its curve reads from the front/top camera
  const g = grp(parent, 0, 0, 0, twist);
  const s = size / 1.29;
  const bow = add(g, CG.bow(), woodMat ?? mat(wood), [0, 0, 0], null, s);
  add(g, geo.box(0.01, size, 0.01), mat(string), [0, 0, -0.235 * s]);
  add(g, geo.cyl(0.03 * s * 1.5, 0.03 * s * 1.5, 0.12 * s, 5), mat(gripC), [0, 0, 0.0]);
  return bow;
}

export function quiver(parent, { x = 0, y = 0, z = 0, rz = 0.35, len = 0.34, r = 0.06, color = P.leather, fletch = 0xf2f2f2 } = {}) {
  const g = grp(parent, x, y, z);
  g.rotation.z = rz;
  add(g, geo.cyl(r, r * 0.85, len, 6), mat(color), [0, 0, 0]);
  add(g, geo.cyl(r * 1.08, r * 1.08, 0.03, 6), mat(P.goldDark), [0, len / 2 - 0.02, 0]);
  for (let i = 0; i < 3; i++) {
    add(g, geo.box(0.02, 0.09, 0.05), mat(fletch), [(i - 1) * r * 0.55, len / 2 + 0.05, (i % 2) * 0.015]);
  }
  return g;
}

/** Fire group: origin at the flame base. Returns the group (put it into parts.fire). */
export function fire(parent, x, y, z, size = 0.3, kind = 'orange') {
  const f = grp(parent, x, y, z);
  const [o, i] = FIRE[kind] ?? FIRE.orange;
  const a = add(f, geo.cone(0.36, 1, 5), o(), [0, size / 2, 0], null, size);
  const b = add(f, geo.cone(0.22, 0.7, 5), i(), [0, size * 0.35, 0], [0, 0.6, 0], size);
  const c = add(f, geo.cone(0.14, 0.5, 4), o(), [size * 0.18, size * 0.25, size * 0.08], [0, 0, -0.35], size);
  a.castShadow = b.castShadow = c.castShadow = false;
  return f;
}

/** Waving flag on a pole. Origin at pole base. dir = +1 flag extends to +X. */
export function flag(parent, x, y, z, color, { pole = 1.0, w = 0.5, h = 0.32, dir = -1, poleColor = P.woodDark, finial = P.gold, poleR = 0.025 } = {}) {
  const g = grp(parent, x, y, z);
  add(g, geo.cyl(poleR, poleR * 1.2, pole, 6), mat(poleColor), [0, pole / 2, 0]);
  if (finial !== null) add(g, geo.sphere(poleR * 2, 6, 4), mat(finial), [0, pole + poleR, 0]);
  const fy = pole - h / 2 - poleR;
  const half = w / 2;
  const p1 = grp(g, 0, fy, 0);
  p1.rotation.y = dir * 0.22;
  add(p1, geo.box(half, h, 0.02), mat(color), [(dir * half) / 2, 0, 0]);
  const p2 = grp(p1, dir * half, 0, 0);
  p2.rotation.y = -dir * 0.45;
  add(p2, geo.box(half, h * 0.92, 0.02), mat(color), [(dir * half) / 2, -h * 0.04, 0]);
  return g;
}

/** Hanging banner. Origin at the top rod; hangs down -Y; faces +Z (rotate with ry). */
export function banner(parent, x, y, z, color, { w = 0.35, h = 0.7, ry = 0, trim = P.gold, emblem = P.gold } = {}) {
  const g = grp(parent, x, y, z, ry);
  add(g, geo.cyl(0.022, 0.022, w + 0.12, 5), mat(trim), [0, 0, 0], [0, 0, Math.PI / 2]);
  add(g, geo.box(w, h, 0.025), mat(color), [0, -h / 2, 0]);
  add(g, geo.box(w * 0.7071, w * 0.7071, 0.025), mat(color), [0, -h, 0], [0, 0, Math.PI / 4]);
  if (emblem !== null) add(g, geo.box(w * 0.34, w * 0.34, 0.035), mat(emblem), [0, -h * 0.5, 0.004], [0, 0, Math.PI / 4]);
  return g;
}

/** Ring of `n` merlons (crenellations) around a circle. */
export function merlonRing(parent, y, radius, n, size, material, offset = 0) {
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * Math.PI * 2;
    add(parent, geo.box(size[0], size[1], size[2]), material, [Math.sin(a) * radius, y + size[1] / 2, Math.cos(a) * radius], [0, a, 0]);
  }
}

/** Merlons along the 4 edges of a rectangle (top at y). */
export function merlonRect(parent, y, w, d, step, size, material, cx = 0, cz = 0) {
  const nx = Math.max(2, Math.round(w / step));
  const nz = Math.max(2, Math.round(d / step));
  for (let i = 0; i < nx; i++) {
    const x = cx - w / 2 + (w * (i + 0.5)) / nx;
    add(parent, geo.box(size, size, size * 0.7), material, [x, y + size / 2, cz + d / 2 - size * 0.35]);
    add(parent, geo.box(size, size, size * 0.7), material, [x, y + size / 2, cz - d / 2 + size * 0.35]);
  }
  for (let i = 1; i < nz - 1; i++) {
    const z = cz - d / 2 + (d * (i + 0.5)) / nz;
    add(parent, geo.box(size * 0.7, size, size), material, [cx + w / 2 - size * 0.35, y + size / 2, z]);
    add(parent, geo.box(size * 0.7, size, size), material, [cx - w / 2 + size * 0.35, y + size / 2, z]);
  }
}

/**
 * Gable roof with team trim. Ridge along X. Origin at roof base center.
 * `rows` adds raised courses (thatch layers / shingle rows) so the slope reads as a roof from above.
 */
export function gableRoof(parent, x, y, z, len, depth, height, roofColor, trimColor, { ridge = true, eaves = true, ry = 0, rows = 3, rowColor } = {}) {
  const g = grp(parent, x, y, z, ry);
  add(g, CG.gable(), mat(roofColor), [0, 0, 0], null, [len, height, depth]);
  const slope = Math.atan2(height, depth / 2);
  const sl = Math.hypot(height, depth / 2);
  if (rows > 0) {
    const t = 0.05;
    const w = (sl / rows) * 0.42;
    const boxes = [];
    const nyv = Math.cos(slope), nzv = Math.sin(slope); // outward normal of the front slope
    const tilt = Math.atan2(nzv, nyv);
    for (let i = 0; i < rows; i++) {
      const f = (i + 0.3) / (rows + 0.15);
      for (const sz of [1, -1]) {
        const zz = ((sz * depth) / 2) * (1 - f);
        const yy = height * f;
        boxes.push([len + 0.04, t, w, 0, yy + (nyv * t) / 2, zz + (sz * nzv * t) / 2, 0, sz * tilt]);
      }
    }
    const rc = rowColor ?? new THREE.Color(roofColor).multiplyScalar(0.78).getHex();
    add(g, mergedBoxes(`roofRows${len},${depth},${height},${rows}`, boxes), mat(rc));
  }
  if (ridge) add(g, geo.box(len + 0.06, 0.1, 0.1), mat(trimColor), [0, height, 0], [Math.PI / 4, 0, 0], [1, 1.3, 1.3]);
  if (eaves) {
    // barge boards on the gable ends (team trim)
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        add(g, geo.box(0.06, sl + 0.06, 0.1), mat(trimColor),
          [sx * (len / 2 + 0.02), height / 2, (sz * depth) / 4], [-sz * (Math.PI / 2 - slope), 0, 0]);
      }
    }
  }
  return g;
}

/** Timber-framed wall block: plaster walls + dark corner posts + beams. Origin at base center. */
export function timberWalls(parent, x, y, z, w, h, d, { plaster = P.plaster, timber = P.woodDark, braces = true } = {}) {
  const g = grp(parent, x, y, z);
  add(g, geo.box(w, h, d), mat(plaster), [0, h / 2, 0]);
  const tm = mat(timber);
  const t = 0.07;
  for (const sx of [1, -1]) for (const sz of [1, -1]) add(g, geo.box(t, h, t), tm, [(sx * w) / 2, h / 2, (sz * d) / 2]);
  add(g, geo.box(w + t, t, d + t), tm, [0, h - t / 2, 0]);
  add(g, geo.box(w + t * 0.6, t * 0.8, d + t * 0.6), tm, [0, h * 0.45, 0]);
  if (braces) {
    const bl = Math.hypot(w * 0.25, h * 0.45);
    const ang = Math.atan2(w * 0.25, h * 0.45);
    for (const sx of [1, -1]) {
      add(g, geo.box(t * 0.8, bl, 0.03), tm, [sx * w * 0.36, h * 0.45 + h * 0.225, d / 2 + 0.01], [0, 0, sx * ang]);
    }
  }
  return g;
}

/** Door (dark planks + arch) on a +Z facing wall at local z. */
export function door(parent, x, y, z, w = 0.4, h = 0.6, { color = P.woodDark, frame = P.stoneDark, ry = 0 } = {}) {
  const g = grp(parent, x, y, z, ry);
  add(g, geo.box(w + 0.1, h + 0.06, 0.05), mat(frame), [0, (h + 0.06) / 2, 0]);
  add(g, geo.box(w, h, 0.07), mat(color), [0, h / 2, 0.01]);
  add(g, geo.cyl(w / 2, w / 2, 0.07, 8, ), mat(color), [0, h, 0.01], [Math.PI / 2, 0, 0], [1, 1, 1]);
  add(g, geo.box(w * 0.9, 0.035, 0.03), mat(P.iron), [0, h * 0.3, 0.05]);
  add(g, geo.box(w * 0.9, 0.035, 0.03), mat(P.iron), [0, h * 0.7, 0.05]);
  return g;
}

/** Window: dark pane with a light frame, on a +Z facing wall. */
export function windowPane(parent, x, y, z, w = 0.18, h = 0.24, { ry = 0, frame = P.woodDark, pane = 0x2a3140 } = {}) {
  const g = grp(parent, x, y, z, ry);
  add(g, geo.box(w + 0.05, h + 0.05, 0.03), mat(frame), [0, 0, 0]);
  add(g, geo.box(w, h, 0.04), mat(pane), [0, 0, 0.005]);
  return g;
}
