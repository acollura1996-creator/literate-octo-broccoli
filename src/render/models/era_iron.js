// Iron Age (classical Rome and Carthage): legionary, velite javelineer, Carthaginian war elephant and a
// wheeled carroballista; the Iron Age town center (a temple-fronted forum), a Roman domus, and the early
// Research Center (an academy library used from the Stone to the Gunpowder Age).
// Same conventions as ages.js / era_ancient.js: origin at ground center, facing +Z, the character's weapon
// hand on -X, team color via mat(teamColor), cached geo/mat, every mesh casts shadows (add()).
import {
  THREE, mat, geo, P, CG, glowMat, grp, add, beam, rod, rig, armMesh, grip, MELEE_TILT, fire, flag, banner,
  gableRoof, mergedBoxes,
} from './common.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;

/** Darker/lighter variant of a color. */
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();

const C = {
  bronze: 0xc98a3a, bronzeD: 0x8c5a22, bronzeL: 0xeab866,
  linen: 0xefe6cc, linenD: 0xcabc98,
  ivory: 0xf1e8cf, ivoryD: 0xcdbf9b,
  dark: 0x1e1712,
  hair: 0x2e1d12,
  fur: 0x7d6b58, furD: 0x54463a, furL: 0xcdbfa6,
  hide: 0x8e8780, hideD: 0x6d6761, hideL: 0xa59e95, earIn: 0xb39089, nail: 0xd9cfba,
  sinew: 0x4a3626, rope: 0xcdb98a,
  marble: 0xf3efe6, marbleD: 0xd6cfbf, trav: 0xe2d8c2, travD: 0xbcb097, ashlar: 0xdccfb0, ashlarD: 0xb9a985,
  tile: 0xb4532a, tileD: 0x8a3a1c,
  plaster: 0xf0e1bc, plasterD: 0xd5bf94, pompeii: 0xa3332a, pompeiiD: 0x5a1a14,
  water: 0x3f86c0, patina: 0x6aa592, patinaD: 0x4a7f6e, scroll: 0xf0e4c4, scrollD: 0xd6be8a,
};

/** mergedBoxes with a file-local key prefix. */
const mb = (key, boxes) => mergedBoxes(`iron:${key}`, boxes);

/**
 * Cached merged cylinders / cones: [[rTop, rBot, h, x, y, z, rx = 0, rz = 0, seg = 6], ...],
 * each centered on (x, y, z). rTop = 0 makes an upward cone, rBot = 0 a downward one.
 */
function mergedCyls(key, list) {
  return geo.custom(`iron-cyl:${key}`, () => {
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

/** Open-ended merged cylinders (column shafts whose ends are hidden): [[rTop, rBot, h, x, y, z, seg = 8], ...]. */
function mergedTubes(key, list) {
  return geo.custom(`iron-tube:${key}`, () => {
    const parts = list.map(([rt, rb, h, x, y, z, seg = 8]) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, true).translate(x, y, z));
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

/** Merged flat discs facing +Z (scroll ends, paterae): [[r, x, y, z, seg = 6], ...]. */
function mergedDiscs(key, list) {
  return geo.custom(`iron-disc:${key}`, () => {
    const parts = list.map(([r, x, y, z, seg = 6]) => new THREE.CircleGeometry(r, seg).translate(x, y, z));
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

/** Upper hemisphere (dome), radius 1, base at y=0. */
const hemi = () => geo.custom('iron:hemi16', () => new THREE.SphereGeometry(1, 16, 6, 0, TAU, 0, HALF_PI));
/** Low-res upper hemisphere for helmets and small bowls. */
const hemiLo = () => geo.custom('iron:hemi10', () => new THREE.SphereGeometry(1, 10, 4, 0, TAU, 0, HALF_PI));
/** Flat disc (cylinder) with its axis along Z, radius 1, thickness 1 (scale it): ears, shields. */
const zDisc = (seg) => geo.custom(`iron:zdisc${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg).rotateX(HALF_PI));
/** Cap of the unit sphere from the top down to polar angle t (a blanket over a body). */
const cap = (t, ws = 16, hs = 4) => geo.custom(`iron:cap${t},${ws},${hs}`, () => new THREE.SphereGeometry(1, ws, hs, 0, TAU, 0, t));

/**
 * Curved tapering tusk / trunk: starts at the origin pointing +Y and curls toward +Z through `curl`
 * radians over arc length `len`, radius r0 -> r1. Orient it with basis().
 */
function tuskGeo(len, r0, r1, curl, n = 5, seg = 5) {
  return geo.custom(`iron:tusk${len},${r0},${r1},${curl},${n},${seg}`, () => {
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

/**
 * Curved plate: a slice of a vertical cylinder of radius R with chord w, height h and thickness t.
 * The convex face points to +Z with its center at the origin (the edges curve back toward -Z).
 */
function curvedPlate(w, h, t, R, seg = 6) {
  return geo.custom(`iron:cplate${w},${h},${t},${R},${seg}`, () => {
    const half = Math.asin(w / 2 / R);
    const s = new THREE.Shape();
    for (let i = 0; i <= seg; i++) {
      const a = -half + (2 * half * i) / seg;
      if (i === 0) s.moveTo(R * Math.sin(a), R * Math.cos(a) - R);
      else s.lineTo(R * Math.sin(a), R * Math.cos(a) - R);
    }
    for (let i = seg; i >= 0; i--) {
      const a = -half + (2 * half * i) / seg;
      s.lineTo((R - t) * Math.sin(a), (R - t) * Math.cos(a) - R);
    }
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
    g.rotateX(HALF_PI); // extrusion (+Z) -> -Y, shape y -> +Z
    g.translate(0, h / 2, 0);
    return g;
  });
}

/**
 * Cached geometry made of quads: [[a, b, c, d, n], ...] with corner points a..d (in order round the quad)
 * and the direction n the face should look toward (winding is fixed to match).
 */
function quadsGeo(key, quads) {
  return geo.custom(`iron:quads:${key}`, () => {
    const pos = [];
    const v = (p) => new THREE.Vector3(...p);
    for (const [a, b, c, d, n] of quads) {
      const nn = new THREE.Vector3().crossVectors(v(b).sub(v(a)), v(c).sub(v(a)));
      const tri = (p, q, r) => pos.push(...p, ...q, ...r);
      if (nn.dot(v(n)) >= 0) { tri(a, b, c); tri(a, c, d); } else { tri(a, c, b); tri(a, d, c); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });
}

/** Spoked wheel group (axle = local X; the game rolls it with rotation.x). */
function spokedWheel(parent, key, x, y, z, R, { rim, spoke, hub, tire, n = 8, w = 0.05, tube = 0.035, rs = 4 }) {
  const wg = grp(parent, x, y, z);
  add(wg, geo.torus(R - tube, tube, rs, 12), rim, [0, 0, 0], [0, HALF_PI, 0]);
  if (tire) add(wg, geo.torus(R - tube * 0.3, tube * 0.45, 3, 12), tire, [0, 0, 0], [0, HALF_PI, 0]);
  const sp = [];
  for (let i = 0; i < n / 2; i++) sp.push([w * 0.55, 2 * (R - tube), w * 0.55, 0, 0, 0, 0, (i / (n / 2)) * Math.PI]);
  add(wg, mb(`spokes:${key}`, sp), spoke);
  add(wg, geo.cyl(R * 0.2, R * 0.2, w * 2.4, 6), hub, [0, 0, 0], [0, 0, HALF_PI]);
  return wg;
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

/** Short cuff along a beam from a to b (fraction t), slightly thicker than the limb. */
function onBeam(parent, a, b, t, w, material) {
  const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const d = [(b[0] - a[0]) * 0.18, (b[1] - a[1]) * 0.18, (b[2] - a[2]) * 0.18];
  return beam(parent, [c[0] - d[0], c[1] - d[1], c[2] - d[2]], [c[0] + d[0], c[1] + d[1], c[2] + d[2]], w, material);
}

function unitResult(r, height, radius, extra = {}) {
  return {
    root: r.root,
    parts: { body: r.body, head: r.head, legs: r.legs, arms: [{ obj: r.armL, phase: Math.PI }], weapon: r.weapon, ...extra },
    height,
    radius,
  };
}

/** Empty marker (projectile spawn point); read with getObjectByName('muzzle'). */
function muzzle(parent, x, y, z) {
  const m = new THREE.Object3D();
  m.name = 'muzzle';
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Bronze tripod brazier with a fire; returns { fire, glow }. */
function brazier(parent, x, y, z, bronze, bronzeD, s = 1) {
  const g = grp(parent, x, y, z);
  g.scale.setScalar(s);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    beam(g, [Math.sin(a) * 0.17, 0, Math.cos(a) * 0.17], [Math.sin(a) * 0.08, 0.5, Math.cos(a) * 0.08], 0.03, bronzeD);
  }
  add(g, geo.cyl(0.18, 0.09, 0.13, 10), bronze, [0, 0.55, 0]);
  add(g, geo.torus(0.18, 0.02, 3, 10), bronzeD, [0, 0.615, 0], [HALF_PI, 0, 0]);
  const coals = add(g, geo.cyl(0.15, 0.15, 0.02, 8), glowMat(0xff5a10, 0.8), [0, 0.61, 0]);
  coals.castShadow = false;
  const fl = fire(g, 0, 0.62, 0, 0.42);
  return { fire: fl, glow: coals };
}

/** Gold eagle with raised wings on a perch bar (origin at the perch, facing +Z, ~0.3 tall at s = 1). */
function eagle(parent, x, y, z, s, gold, goldD) {
  const g = grp(parent, x, y, z);
  g.scale.setScalar(s);
  add(g, geo.box(0.16, 0.025, 0.04), goldD, [0, 0, 0]);
  add(g, geo.sphere(0.05, 6, 4), gold, [0, 0.07, 0.0], null, [0.85, 1.25, 0.9]);
  add(g, geo.sphere(0.03, 5, 3), gold, [0, 0.15, 0.025]);
  add(g, geo.cone(0.014, 0.05, 4), goldD, [0, 0.14, 0.065], [HALF_PI + 0.5, 0, 0]);
  add(g, geo.box(0.05, 0.07, 0.02), goldD, [0, 0.01, -0.04], [0.5, 0, 0]);
  for (const sd of [1, -1]) {
    add(g, geo.box(0.13, 0.05, 0.018), gold, [sd * 0.08, 0.12, -0.01], [0, 0, sd * 0.75]);
    add(g, geo.box(0.1, 0.04, 0.016), gold, [sd * 0.15, 0.22, -0.01], [0, 0, sd * 1.15]);
    add(g, geo.box(0.07, 0.035, 0.016), goldD, [sd * 0.12, 0.08, -0.012], [0, 0, sd * 0.25]);
  }
  return g;
}

/** Vexillum: square team cloth hanging from a crossbar, gold fringe, spear-point finial. Origin at the pole base. */
function vexillum(parent, x, y, z, tc, { h = 1.6, w = 0.34, ch = 0.36, ry = 0 } = {}) {
  const g = grp(parent, x, y, z, ry);
  const gold = mat(P.gold), goldD = mat(P.goldDark);
  add(g, geo.cyl(0.022, 0.026, h, 6), mat(P.woodDark), [0, h / 2, 0]);
  add(g, geo.cone(0.035, 0.12, 4), mat(P.steelLight), [0, h + 0.06, 0]);
  add(g, geo.cyl(0.03, 0.03, 0.04, 6), gold, [0, h - 0.01, 0]);
  const bar = h - 0.1;
  add(g, geo.cyl(0.016, 0.016, w + 0.1, 5), goldD, [0, bar, 0], [0, 0, HALF_PI]);
  add(g, geo.box(w, ch, 0.022), mat(tc), [0, bar - ch / 2 - 0.01, 0.012]);
  add(g, geo.box(w * 0.42, w * 0.42, 0.03), gold, [0, bar - ch * 0.48, 0.016], [0, 0, Math.PI / 4]);
  add(g, geo.box(w * 0.26, w * 0.26, 0.034), mat(tc), [0, bar - ch * 0.48, 0.018], [0, 0, Math.PI / 4]);
  add(g, geo.box(w + 0.01, 0.04, 0.026), gold, [0, bar - ch - 0.02, 0.012]);
  for (const sd of [1, -1]) add(g, geo.box(0.02, 0.2, 0.012), mat(tc), [sd * (w / 2 + 0.035), bar - 0.11, 0.006]);
  for (const yy of [0.62, 0.48]) add(g, geo.cyl(0.04, 0.04, 0.02, 8), gold, [0, h * yy, 0.022], [HALF_PI, 0, 0]);
  return g;
}

// ===========================================================================
// Units
// ===========================================================================

/** Scutum: big curved rectangular shield, team face, bronze rim and boss, gold wings-and-thunderbolts. */
function scutum(parent, tc, { x = 0, y = 0, z = 0, ry = 0, w = 0.4, h = 0.58 } = {}) {
  const g = grp(parent, x, y, z, ry);
  const R = 0.34;
  const team = mat(tc), gold = mat(P.gold), rim = mat(C.bronzeD), boss = mat(C.bronzeL);
  add(g, curvedPlate(w, h, 0.03, R), team);
  const half = Math.asin(w / 2 / R);
  for (const s of [1, -1]) {
    add(g, curvedPlate(w + 0.01, 0.026, 0.05, R + 0.008, 4), rim, [0, (s * h) / 2, 0.006]);
    add(g, geo.box(0.022, h + 0.02, 0.05), rim, [s * (R + 0.002) * Math.sin(half), 0, (R + 0.002) * Math.cos(half) - R - 0.016], [0, s * half, 0]);
  }
  // decoration on the curved face: (x, y) on the face, size, in-plane angle
  const on = (bx, by, bw, bh, rz = 0, m = gold, d = 0.012) => {
    const a = Math.asin(bx / R);
    const msh = add(g, geo.box(bw, bh, d), m, [bx, by, R * Math.cos(a) - R + 0.008]);
    msh.rotation.set(0, a, rz);
    return msh;
  };
  // inner border
  for (const s of [1, -1]) {
    add(g, curvedPlate(w - 0.07, 0.016, 0.012, R + 0.006, 3), gold, [0, s * (h / 2 - 0.05), 0.008]);
    on(s * (w / 2 - 0.045), 0, 0.016, h - 0.1, 0);
  }
  // wings either side of the boss
  for (const s of [1, -1]) {
    on(s * 0.085, 0.025, 0.13, 0.036, s * 0.3);
    on(s * 0.085, -0.025, 0.11, 0.03, -s * 0.15);
  }
  // zigzag thunderbolts toward the corners
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      on(sx * 0.045, sy * 0.1, 0.024, 0.1, sx * sy * -0.55);
      on(sx * 0.1, sy * 0.175, 0.024, 0.09, sx * sy * 0.15);
    }
  }
  // boss on a square plate
  on(0, 0, 0.13, 0.13, 0, rim, 0.014);
  add(g, geo.sphere(0.058, 7, 4), boss, [0, 0, 0.012], null, [1, 1, 0.55]);
  return g;
}

// Roman legionary: galea helmet with a team crest, lorica segmentata over a team tunic, a team scarf,
// caligae, the big curved team scutum with gold wings and thunderbolts, gladius in the weapon hand.
export function legionary(tc) {
  const L = 0.38;
  const r = rig({ legLen: L, hipW: 0.08, shoulderX: 0.225, shoulderY: 0.345, neckY: 0.42 });
  const steel = mat(P.steel), steelD = mat(P.steelDark), steelL = mat(P.steelLight);
  const bronze = mat(C.bronze), bronzeL = mat(C.bronzeL);
  const team = mat(tc), teamD = mat(shade(tc, 0.6));
  const skin = mat(P.skin), skinD = mat(P.skinShade), leather = mat(P.leather), leatherD = mat(P.leatherDark), black = mat(P.black);
  // bare legs in hobnailed caligae (sandal straps up the ankle)
  for (const l of r.legs) {
    add(l.obj, geo.box(0.09, L * 0.9, 0.096), skin, [0, -L * 0.45, 0]);
    add(l.obj, geo.box(0.1, 0.045, 0.17), leatherD, [0, -L + 0.0225, 0.03]);
    add(l.obj, mb('caligae', [[0.1, 0.02, 0.1, 0, 0.085, 0.0], [0.03, 0.05, 0.104, 0, 0.06, 0.03]]), leather, [0, -L, 0]);
  }
  // team tunic skirt below the armour, cingulum belt with a studded apron
  add(r.body, CG.frustum(0.84), team, [0, -0.055, 0], null, [0.31, 0.2, 0.235]);
  add(r.body, CG.frustum(0.97), teamD, [0, -0.15, 0], null, [0.315, 0.03, 0.24]);
  // lorica segmentata: steel torso, girth hoops, chest plates, layered shoulder lames
  const torso = { cy: 0.2, th: 0.33, w0: 0.27, d0: 0.2, k: 1.3 };
  add(r.body, CG.frustum(torso.k), steel, [0, torso.cy, 0], null, [torso.w0, torso.th, torso.d0]);
  for (const y of [0.09, 0.145, 0.2]) torsoBand(r.body, steelD, { ...torso, y, h: 0.014, grow: 0.01 });
  torsoBand(r.body, steelL, { ...torso, y: 0.285, h: 0.09, grow: 0.012 });
  add(r.body, mb('legBuckles', [[0.02, 0.02, 0.01, 0.04, 0.29, 0.135], [0.02, 0.02, 0.01, -0.04, 0.29, 0.135], [0.012, 0.13, 0.01, 0, 0.15, 0.128]]), bronze);
  for (const s of [1, -1]) {
    const lames = [];
    for (let i = 0; i < 3; i++) {
      const t = 0.15 + i * 0.52;
      lames.push([0.085, 0.022, 0.21 - i * 0.008, s * (0.13 + 0.105 * Math.sin(t)), 0.315 + 0.105 * Math.cos(t), 0, -s * t]);
    }
    for (const [w, h, d, x, y, z, rz] of lames) add(r.body, geo.box(w, h, d), steel, [x, y, z], [0, 0, rz]);
  }
  add(r.body, geo.box(0.29, 0.045, 0.22), leatherD, [0, 0.04, 0]);
  add(r.body, mb('legApron', [-0.045, -0.015, 0.015, 0.045].map((x) => [0.02, 0.15, 0.01, x, -0.04, 0.122])), leatherD);
  add(r.body, mb('legApronStuds', [-0.045, -0.015, 0.015, 0.045].map((x) => [0.026, 0.026, 0.012, x, -0.115, 0.124])), bronzeL);
  // team scarf (focale) at the neck
  add(r.body, CG.frustum(0.75), team, [0, 0.375, 0.005], null, [0.23, 0.05, 0.19]);
  add(r.body, geo.box(0.05, 0.06, 0.03), team, [0.02, 0.34, 0.1]);
  // empty scabbard on the right hip, pugio on the left
  add(r.body, geo.box(0.045, 0.24, 0.025), leatherD, [-0.16, -0.06, 0.04], [0.15, 0, 0.18]);
  add(r.body, geo.box(0.045, 0.1, 0.022), leatherD, [0.155, 0.0, 0.05], [0.1, 0, -0.2]);
  // head + galea helmet: bowl, bronze brow band, cheek guards, flared neck guard, team crest
  const H = r.head;
  add(H, geo.sphere(0.093, 8, 6), skin, [0, 0.1, 0.018]);
  add(H, geo.box(0.028, 0.04, 0.03), skinD, [0, 0.088, 0.114]);
  add(H, mb('legEyes', [[0.024, 0.014, 0.01, -0.032, 0.11, 0.104], [0.024, 0.014, 0.01, 0.032, 0.11, 0.104]]), black);
  add(H, hemiLo(), steel, [0, 0.122, -0.006], null, [0.108, 0.11, 0.115]);
  add(H, geo.cyl(0.112, 0.114, 0.026, 8), bronze, [0, 0.13, -0.006]);
  add(H, geo.box(0.12, 0.022, 0.03), bronzeL, [0, 0.152, 0.098], [-0.3, 0, 0]);
  for (const s of [1, -1]) add(H, geo.box(0.02, 0.1, 0.075), steel, [s * 0.097, 0.07, 0.035], [0.12, 0, s * 0.08]);
  add(H, geo.box(0.21, 0.02, 0.11), steel, [0, 0.105, -0.115], [-0.4, 0, 0]);
  add(H, geo.box(0.03, 0.04, 0.03), bronze, [0, 0.235, -0.01]);
  add(H, geo.cyl(0.105, 0.105, 0.042, 9), team, [0, 0.215, -0.015], [0, 0, HALF_PI], [1, 1, 1.12]);
  add(H, geo.cyl(0.108, 0.108, 0.026, 9), teamD, [0, 0.215, -0.015], [0, 0, HALF_PI], [1, 1, 1.12]);
  // arms: team sleeves, bare forearms, leather bracer on the sword arm
  const armOpt = { upper: 0.15, fore: 0.14, w: 0.078, upperMat: team, foreMat: skin, handMat: skinD };
  const handL = armMesh(r.armL, { ...armOpt, bend: 1.1 });
  scutum(handL, tc, { x: -0.075, y: 0.06, z: 0.065, ry: 0.22, w: 0.4, h: 0.58 });
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.5 });
  onForearm(r.weapon, armOpt, 0.5, 0.6, [0.09, 0.07, 0.09], leatherD);
  // gladius: bone grip, round pommel, short broad blade with a long point
  const g = grip(hand, MELEE_TILT);
  add(g, geo.cyl(0.017, 0.017, 0.09, 6), mat(C.ivory), [0, 0, 0]);
  add(g, geo.sphere(0.03, 6, 4), mat(C.ivoryD), [0, -0.058, 0], null, [1, 0.75, 1]);
  add(g, geo.box(0.07, 0.026, 0.045), mat(C.ivoryD), [0, 0.056, 0]);
  add(g, geo.box(0.054, 0.27, 0.016), steelL, [0, 0.205, 0]);
  add(g, geo.box(0.012, 0.24, 0.02), steelD, [0, 0.2, 0]);
  add(g, geo.cone(0.038, 0.1, 4), steelL, [0, 0.39, 0], [0, Math.PI / 4, 0], [1, 1, 0.3]);
  return unitResult(r, 1.18, 0.42);
}

// Velite (light skirmisher): wolf-pelt hood with the wolf's head over the brow, team tunic, round team parma,
// a bundle of javelins on the back. The throwing arm is cocked overhand holding a javelin level; its pivot
// sits in a holder turned 180 deg about Y so the standard ranged wind-up (+0.55) draws the javelin back and
// up, and the release (-0.25) brings it forward over the shoulder. A 'muzzle' marker sits at the hand.
export function javelineer(tc) {
  const L = 0.35;
  const r = rig({ legLen: L, hipW: 0.07, shoulderX: 0.19, shoulderY: 0.32, neckY: 0.39 });
  const skin = mat(P.skin), skinD = mat(P.skinShade), leather = mat(P.leather), leatherD = mat(P.leatherDark);
  const team = mat(tc), teamD = mat(shade(tc, 0.6));
  const fur = mat(C.fur), furD = mat(C.furD), furL = mat(C.furL), black = mat(P.black), ivory = mat(C.ivory);
  const shaft = mat(0xa8784a), iron = mat(P.steelDark);
  for (const l of r.legs) {
    add(l.obj, geo.box(0.084, L * 0.9, 0.09), skin, [0, -L * 0.45, 0]);
    add(l.obj, geo.box(0.094, 0.042, 0.16), leatherD, [0, -L + 0.021, 0.028]);
    add(l.obj, mb('veliteStraps', [[0.094, 0.016, 0.096, 0, 0.06, 0], [0.094, 0.016, 0.096, 0, 0.1, 0]]), leather, [0, -L, 0]);
  }
  // team tunic with a darker hem, leather belt
  const torso = { cy: 0.175, th: 0.3, w0: 0.24, d0: 0.18, k: 1.25 };
  add(r.body, CG.frustum(torso.k), team, [0, torso.cy, 0], null, [torso.w0, torso.th, torso.d0]);
  add(r.body, CG.frustum(0.84), team, [0, -0.045, 0], null, [0.275, 0.18, 0.215]);
  add(r.body, CG.frustum(0.97), teamD, [0, -0.13, 0], null, [0.28, 0.03, 0.22]);
  add(r.body, geo.box(0.26, 0.04, 0.2), leatherD, [0, 0.045, 0]);
  add(r.body, geo.box(0.06, 0.07, 0.035), leather, [-0.085, 0.0, 0.1]); // pouch
  // wolf pelt: cape down the back with a tail, forepaws knotted on the chest
  add(r.body, CG.frustum(0.78), fur, [0, 0.17, -0.12], [0.1, 0, 0], [0.32, 0.46, 0.04]);
  add(r.body, geo.cone(0.04, 0.22, 5), furD, [0.02, -0.1, -0.16], [Math.PI - 0.15, 0, 0]);
  for (const s of [1, -1]) add(r.body, geo.box(0.05, 0.17, 0.028), fur, [s * 0.075, 0.31, 0.095], [-0.35, 0, s * 0.55]);
  add(r.body, geo.sphere(0.03, 6, 4), furD, [0, 0.27, 0.115]);
  add(r.body, mb('velitePaws', [[0.04, 0.06, 0.03, 0.028, 0.215, 0.118], [0.04, 0.06, 0.03, -0.028, 0.22, 0.118]]), furD);
  add(r.body, mb('velitePawClaws', [[0.036, 0.012, 0.03, 0.028, 0.18, 0.12], [0.036, 0.012, 0.03, -0.028, 0.185, 0.12]]), ivory);
  // javelin bundle across the back (tips up over the left shoulder)
  const bundle = grp(r.body, 0.03, 0.2, -0.155);
  bundle.rotation.z = -0.45;
  add(bundle, mergedCyls('veliteBundle', [[0.011, 0.013, 0.72, -0.028, 0.06, 0, 0, 0, 5], [0.011, 0.013, 0.72, 0, 0.08, -0.016, 0, 0, 5], [0.011, 0.013, 0.72, 0.028, 0.05, 0, 0, 0, 5]]), shaft);
  add(bundle, mergedCyls('veliteBundleHeads', [[0, 0.02, 0.08, -0.028, 0.46, 0, 0, 0, 4], [0, 0.02, 0.08, 0, 0.48, -0.016, 0, 0, 4], [0, 0.02, 0.08, 0.028, 0.45, 0, 0, 0, 4]]), iron);
  add(bundle, mb('veliteBundleTies', [[0.1, 0.03, 0.045, 0, 0.0, -0.005], [0.1, 0.03, 0.045, 0, 0.22, -0.005]]), leatherD);
  add(r.body, geo.box(0.04, 0.4, 0.02), leatherD, [0.0, 0.2, 0.108], [0.1, 0, 0.65]); // carrying strap
  // head in the wolf hood
  const H = r.head;
  add(H, geo.sphere(0.092, 8, 6), skin, [0, 0.1, 0.016]);
  add(H, geo.box(0.026, 0.036, 0.03), skinD, [0, 0.088, 0.11]);
  add(H, mb('veliteEyes', [[0.024, 0.014, 0.01, -0.031, 0.108, 0.1], [0.024, 0.014, 0.01, 0.031, 0.108, 0.1]]), black);
  add(H, geo.sphere(0.106, 8, 6), fur, [0, 0.128, -0.035], null, [1.04, 0.92, 1.08]);
  add(H, geo.torus(0.086, 0.022, 4, 10), furL, [0, 0.11, 0.035], [0.35, 0, 0]);
  // the wolf's head over the brow: tapered snout, black nose, fangs, amber eyes
  const wh = grp(H, 0, 0.205, 0.05);
  wh.rotation.x = 0.32;
  add(wh, geo.box(0.11, 0.06, 0.08), fur, [0, 0.0, -0.01]);
  add(wh, CG.frustum(0.5), fur, [0, -0.005, 0.085], [HALF_PI, 0, 0], [0.085, 0.12, 0.055]);
  add(wh, CG.frustum(0.6), furL, [0, -0.026, 0.08], [HALF_PI, 0, 0], [0.07, 0.11, 0.016]);
  add(wh, geo.box(0.03, 0.02, 0.022), black, [0, 0.006, 0.142]);
  add(wh, mergedCyls('wolfFangs', [[0.008, 0, 0.035, 0.022, -0.045, 0.11, 0, 0, 4], [0.008, 0, 0.035, -0.022, -0.045, 0.11, 0, 0, 4]]), ivory);
  add(wh, mb('wolfEyes', [[0.022, 0.014, 0.02, 0.036, 0.022, 0.03], [0.022, 0.014, 0.02, -0.036, 0.022, 0.03]]), mat(0xe8b030));
  for (const s of [1, -1]) add(H, geo.cone(0.032, 0.085, 4), fur, [s * 0.052, 0.265, 0.005], [-0.2, 0, -s * 0.3]);
  // off arm reaches forward with the parma
  const armOpt = { upper: 0.14, fore: 0.13, w: 0.068, upperMat: team, foreMat: skin, handMat: skinD };
  const handL = armMesh(r.armL, { ...armOpt, bend: 1.15 });
  add(r.armL, geo.sphere(0.048, 6, 4), team, [0, -0.005, 0]);
  const pg = grp(handL, -0.015, 0.03, 0.045, 0.3);
  const PR = 0.19;
  add(pg, geo.cyl(PR, PR, 0.035, 14), mat(P.steelDark), [0, 0, -0.01], [HALF_PI, 0, 0]);
  add(pg, geo.cyl(PR - 0.022, PR - 0.022, 0.04, 14), team, [0, 0, 0], [HALF_PI, 0, 0]);
  add(pg, geo.torus(PR * 0.58, 0.014, 3, 14), mat(C.linen), [0, 0, 0.021]);
  add(pg, geo.sphere(0.05, 7, 5), mat(P.steel), [0, 0, 0.02], null, [1, 1, 0.6]);
  // throwing arm (local frame mirrored in X and Z by the holder: local +Z points backward)
  r.body.remove(r.weapon);
  const holder = grp(r.body, -0.19, 0.32, 0);
  holder.rotation.y = Math.PI;
  const weapon = grp(holder, 0, 0, 0);
  const el = [0.12, -0.01, 0.06], hd = [0.11, 0.15, 0.085];
  add(weapon, geo.sphere(0.05, 6, 4), team, [0, -0.005, 0]);
  beam(weapon, [0, 0, 0], el, 0.066, team);
  add(weapon, geo.sphere(0.034, 6, 4), skin, el);
  beam(weapon, el, hd, 0.06, skin);
  onBeam(weapon, el, hd, 0.5, 0.07, leatherD);
  add(weapon, geo.sphere(0.04, 6, 4), skinD, hd);
  // javelin held level-ish: world forward is local -Z here
  const e = 0.2;
  const jav = grp(weapon, hd[0], hd[1], hd[2]);
  jav.rotation.x = e - HALF_PI;
  add(jav, geo.cyl(0.012, 0.014, 0.74, 5), shaft, [0, 0.07, 0]);
  add(jav, geo.cyl(0.007, 0.007, 0.1, 4), iron, [0, 0.48, 0]);
  add(jav, geo.cone(0.022, 0.08, 4), mat(P.steelLight), [0, 0.57, 0]);
  add(jav, geo.cyl(0.018, 0.018, 0.04, 5), leather, [0, 0.0, 0]);
  muzzle(jav, 0, 0, 0);
  const res = unitResult(r, 1.1, 0.38);
  res.parts.weapon = weapon;
  return res;
}

// Carthaginian war elephant: thick-legged elephant in a team caparison with a gold hem, tassels and bronze
// phalerae, team headdress with a plume, bronze-capped tusks; a wooden howdah tower with team panels,
// hung shields and a team pennant carries a spearman (his spear arm = parts.weapon, melee swing); a
// mahout with a goad sits on the neck.
export function war_elephant(tc) {
  const root = new THREE.Group();
  const hide = mat(C.hide), hideD = mat(C.hideD), hideL = mat(C.hideL), earIn = mat(C.earIn), nail = mat(C.nail);
  const team = mat(tc), teamD = mat(shade(tc, 0.6));
  const gold = mat(P.gold), bronze = mat(C.bronze), bronzeD = mat(C.bronzeD), bronzeL = mat(C.bronzeL), ivory = mat(C.ivory);
  const wood = mat(P.wood), woodD = mat(P.woodDark), woodL = mat(P.woodLight), leatherD = mat(P.leatherDark);
  const skin = mat(P.skin), linen = mat(C.linen), dark = mat(C.dark);
  const OZ = -0.2, LL = 0.92;
  // legs: thick columns (one lathe each, flaring at the foot) with toenails
  const legs = [];
  for (const [x, z, ph] of [[0.29, 0.36, 0], [-0.29, 0.36, Math.PI], [0.29, -0.52, Math.PI], [-0.29, -0.52, 0]]) {
    const lg = grp(root, x, LL, z + OZ);
    add(lg, eleLegGeo(), hide, [0, -LL, 0]);
    add(lg, eleFootGeo(), hideD, [0, -LL + 0.037, 0.0]);
    add(lg, mb('eleNails', [[0.06, 0.05, 0.03, -0.055, 0.03, 0.172, -0.3], [0.06, 0.05, 0.03, 0.055, 0.03, 0.172, 0.3]]), nail, [0, -LL, 0.012]);
    legs.push({ obj: lg, phase: ph, amp: 0.35 });
  }
  const body = grp(root, 0, LL, OZ);
  // barrel body, shoulder hump, tail
  const BY = 0.38, BZ = -0.08;
  add(body, geo.sphere(1, 10, 7), hide, [0, BY, BZ], null, [0.54, 0.56, 0.86]);
  add(body, geo.sphere(1, 8, 5), hide, [0, 0.44, 0.38], null, [0.5, 0.54, 0.46]);
  rod(body, [0, 0.5, BZ - 0.8], [0, 0.0, BZ - 0.86], 0.022, hideD, 4);
  add(body, geo.cone(0.045, 0.14, 5), dark, [0, -0.04, BZ - 0.865], [Math.PI, 0, 0]);
  // caparison: blanket over the back, side drapes with a dark border, gold hem, tassels and bronze phalerae
  const CT = 1.12;
  add(body, cap(CT, 12, 3), team, [0, BY, BZ], null, [0.57, 0.6, 0.9]);
  const ex = 0.57 * Math.sin(CT), ey = BY + 0.6 * Math.cos(CT);
  add(body, geo.torus(1, 0.03, 3, 12), gold, [0, ey, BZ], [HALF_PI, 0, 0], [ex + 0.01, 0.9 * Math.sin(CT) + 0.01, 1]);
  const tas = [];
  for (let i = 0; i < 4; i++) tas.push([0.034, 0, 0.09, 0, -0.5, -0.33 + i * 0.22, 0, 0, 4]);
  for (const s of [1, -1]) {
    const pg = grp(body, s * ex, ey, BZ);
    pg.rotation.z = s * 0.2;
    add(pg, geo.box(0.026, 0.46, 0.86), team, [0, -0.23, 0]);
    add(pg, geo.box(0.032, 0.04, 0.87), teamD, [0, -0.38, 0]);
    add(pg, geo.box(0.034, 0.05, 0.88), gold, [0, -0.45, 0]);
    add(pg, mergedCyls('eleTassels', tas), gold);
    add(pg, geo.cyl(0.12, 0.12, 0.024, 8), bronze, [s * 0.016, -0.2, 0], [0, 0, HALF_PI]);
    add(pg, geo.cyl(0.055, 0.055, 0.03, 6), bronzeL, [s * 0.022, -0.2, 0], [0, 0, HALF_PI]);
  }
  // breast strap
  add(body, geo.torus(0.42, 0.03, 3, 8, Math.PI), leatherD, [0, 0.36, 0.62], [0.35, 0, Math.PI], [1.05, 0.8, 1]);
  // head: cranium, cheeks, eyes, ears, trunk, tusks with bronze caps, team frontlet and plume
  const head = grp(body, 0, 0.6, 0.86);
  add(head, geo.sphere(1, 8, 6), hide, [0, 0.02, 0], null, [0.31, 0.34, 0.3]);
  add(head, geo.sphere(1, 7, 5), hide, [0, -0.19, 0.1], null, [0.25, 0.26, 0.22]);
  add(head, mb('eleEyes', [[0.035, 0.035, 0.035, 0.235, 0.0, 0.17], [0.035, 0.035, 0.035, -0.235, 0.0, 0.17]]), dark);
  for (const s of [1, -1]) {
    const eg = grp(head, s * 0.26, 0.03, -0.05, s * 0.5);
    add(eg, zDisc(7), hideL, [s * 0.18, -0.05, 0], [0, 0, s * 0.3], [0.2, 0.26, 0.035]);
    add(eg, earInGeo(), earIn, [s * 0.17, -0.06, 0.019], [0, 0, s * 0.3], [0.15, 0.2, 1]);
  }
  const trunk = add(head, tuskGeo(0.92, 0.13, 0.048, 1.35, 6, 6), hide, [0, -0.26, 0.2]);
  basis(trunk, [0, -1, -0.3], [0, 0, 1]);
  add(head, geo.box(0.12, 0.05, 0.08), dark, [0, -0.36, 0.12]);
  for (const s of [1, -1]) {
    const tg = grp(head, s * 0.13, -0.3, 0.18);
    basis(tg, [s * 0.16, -0.7, 1], [0, 1, 0.3]);
    const len = 0.46, c = 1.15, R = len / c;
    add(tg, tuskGeo(len, 0.048, 0.024, c, 4, 4), ivory);
    const tip = grp(tg, 0, R * Math.sin(c), R * (1 - Math.cos(c)));
    tip.rotation.x = c;
    add(tip, geo.cyl(0.026, 0.032, 0.07, 5), bronzeD, [0, -0.02, 0]);
    add(tip, geo.cone(0.026, 0.1, 5), bronzeL, [0, 0.065, 0]);
  }
  const fr = grp(head, 0, 0.06, 0.29);
  fr.rotation.x = -0.32;
  add(fr, CG.kite(), gold, [0, 0, -0.012], null, [0.31, 0.44, 0.02]);
  add(fr, CG.kite(), team, [0, 0, 0], null, [0.27, 0.4, 0.024]);
  add(fr, geo.box(0.09, 0.09, 0.03), bronzeL, [0, 0.03, 0.02], [0, 0, Math.PI / 4]);
  add(fr, geo.box(0.05, 0.05, 0.03), gold, [0, -0.13, 0.016], [0, 0, Math.PI / 4]);
  add(head, geo.cone(0.065, 0.32, 5), team, [0, 0.48, -0.04], [-0.25, 0, 0]);
  // mahout on the neck with a goad
  const mh = grp(body, 0, 0.93, 0.56);
  mh.rotation.x = 0.12;
  add(mh, mb('mahoutLegs', [[0.07, 0.07, 0.2, 0.14, 0.0, 0.06, 0, 0.2], [0.07, 0.07, 0.2, -0.14, 0.0, 0.06, 0, 0.2], [0.065, 0.2, 0.07, 0.19, -0.09, 0.15], [0.065, 0.2, 0.07, -0.19, -0.09, 0.15]]), linen);
  add(mh, CG.frustum(1.25), linen, [0, 0.13, 0], null, [0.19, 0.24, 0.14]);
  add(mh, geo.box(0.2, 0.05, 0.15), team, [0, 0.05, 0]);
  add(mh, geo.sphere(0.068, 6, 4), skin, [0, 0.32, 0.01]);
  add(mh, geo.sphere(0.076, 6, 4), team, [0, 0.355, -0.01], null, [1, 0.72, 1.05]);
  for (const s of [1, -1]) beam(mh, [s * 0.1, 0.22, 0], [s * 0.06, 0.13, 0.17], 0.05, linen);
  rod(mh, [-0.05, 0.12, 0.2], [-0.08, 0.36, 0.44], 0.012, woodD, 4);
  // howdah tower
  const hw = grp(body, 0, 0.9, -0.16);
  const W = 0.66, D = 0.72, WH = 0.3, FB = 0.06;
  add(hw, geo.box(W + 0.08, FB, D + 0.08), woodD, [0, FB / 2, 0]);
  add(hw, mb('howdahWalls', [[W, WH, 0.04, 0, 0, D / 2 - 0.02], [W, WH, 0.04, 0, 0, -D / 2 + 0.02], [0.04, WH, D - 0.08, W / 2 - 0.02, 0, 0], [0.04, WH, D - 0.08, -W / 2 + 0.02, 0, 0]]), wood, [0, FB + WH / 2, 0]);
  const posts = [];
  for (const sx of [1, -1]) for (const sz of [1, -1]) posts.push([0.065, WH + 0.1, 0.065, sx * (W / 2), 0, sz * (D / 2)]);
  add(hw, mb('howdahPosts', posts), woodD, [0, FB + (WH + 0.1) / 2, 0]);
  add(hw, mb('howdahRail', [[W + 0.04, 0.04, 0.06, 0, 0, D / 2], [W + 0.04, 0.04, 0.06, 0, 0, -D / 2], [0.06, 0.04, D, W / 2, 0, 0], [0.06, 0.04, D, -W / 2, 0, 0]]), woodL, [0, FB + WH, 0]);
  add(hw, mb('howdahMerlons', [[0.1, 0.07, 0.05, 0.13, 0, D / 2], [0.1, 0.07, 0.05, -0.13, 0, D / 2], [0.05, 0.07, 0.1, W / 2, 0, 0], [0.05, 0.07, 0.1, -W / 2, 0, 0]]), woodD, [0, FB + WH + 0.055, 0]);
  add(hw, mb('howdahPanels', [[0.016, WH - 0.1, D - 0.18, W / 2 + 0.006, 0, 0], [0.016, WH - 0.1, D - 0.18, -W / 2 - 0.006, 0, 0], [W - 0.18, WH - 0.1, 0.016, 0, 0, D / 2 + 0.006]]), team, [0, FB + WH / 2, 0]);
  add(hw, mb('howdahPanelTrim', [[0.02, 0.025, D - 0.16, W / 2 + 0.008, 0.1, 0], [0.02, 0.025, D - 0.16, -W / 2 - 0.008, 0.1, 0], [W - 0.16, 0.025, 0.02, 0, 0.1, D / 2 + 0.008]]), gold, [0, FB + WH / 2, 0]);
  for (const s of [1, -1]) {
    add(hw, geo.cyl(0.11, 0.11, 0.025, 8), bronze, [s * (W / 2 + 0.03), FB + WH * 0.45, 0], [0, 0, HALF_PI]);
    add(hw, mb('howdahBoss', [[0.04, 0.06, 0.06, 0, 0, 0, 0, Math.PI / 4]]), bronzeL, [s * (W / 2 + 0.045), FB + WH * 0.45, 0]);
  }
  add(hw, geo.cyl(0.07, 0.07, 0.022, 6), bronze, [0, FB + WH * 0.45, D / 2 + 0.024], [HALF_PI, 0, 0]);
  // team pennant streaming back from the rear-left post
  const pp = grp(hw, W / 2, FB + WH, -D / 2, HALF_PI);
  add(pp, geo.cyl(0.018, 0.022, 0.78, 5), woodD, [0, 0.39, 0]);
  add(pp, geo.cone(0.03, 0.08, 4), gold, [0, 0.82, 0]);
  add(pp, CG.pennant(), team, [0.01, 0.64, 0], null, [0.44, 0.26, 0.02]);
  // spearman in the tower: bronze cuirass, plumed helmet, shield on the rail, spear arm = weapon
  const sp = grp(hw, -0.09, FB, 0.04);
  add(sp, CG.frustum(1.3), bronze, [0, 0.4, 0], null, [0.22, 0.26, 0.17]);
  add(sp, geo.box(0.23, 0.035, 0.175), team, [0, 0.3, 0]);
  add(sp, CG.frustum(0.55), bronzeD, [0, 0.555, 0], null, [0.34, 0.05, 0.2]);
  add(sp, CG.frustum(0.6), team, [0, 0.4, -0.1], [0.1, 0, 0], [0.32, 0.36, 0.03]);
  const sh = grp(sp, 0, 0.58, 0);
  add(sh, geo.sphere(0.072, 6, 4), skin, [0, 0.075, 0.012]);
  add(sh, geo.sphere(0.082, 6, 4), bronze, [0, 0.1, -0.006], null, [1, 0.85, 1.05]);
  add(sh, geo.box(0.03, 0.09, 0.2), team, [0, 0.2, -0.015]);
  add(sh, geo.cone(0.04, 0.16, 4), team, [0, 0.14, -0.13], [-2.2, 0, 0]);
  const sOpt = { upper: 0.12, fore: 0.11, w: 0.058, upperMat: bronze, foreMat: skin };
  const armL = grp(sp, 0.13, 0.5, 0);
  armL.rotation.x = -0.35;
  const hL = armMesh(armL, { ...sOpt, bend: 1.3 });
  add(hL, geo.sphere(0.036, 5, 3), skin);
  const shg = grp(hL, 0.03, 0.02, 0.04, 0.35);
  add(shg, geo.cyl(0.13, 0.13, 0.03, 8), bronze, [0, 0, 0], [HALF_PI, 0, 0]);
  add(shg, geo.cyl(0.1, 0.1, 0.035, 8), team, [0, 0, 0.004], [HALF_PI, 0, 0]);
  // spear arm: holder turned 180 deg about Y (local +Z points backward) so the melee wind-up raises the
  // spear overhead and the strike stabs it down past the elephant's right flank. Rest: overhand, level.
  const holder = grp(sp, -0.13, 0.5, 0);
  holder.rotation.y = Math.PI;
  const weapon = grp(holder, 0, 0, 0);
  const el = [0.09, -0.08, -0.04], hd = [0.07, 0.08, -0.11];
  add(weapon, geo.sphere(0.042, 5, 3), bronze);
  beam(weapon, [0, 0, 0], el, 0.056, bronze);
  beam(weapon, el, hd, 0.05, skin);
  add(weapon, geo.sphere(0.036, 5, 3), skin, hd);
  const yaw = 0.68;
  const g = grp(weapon, hd[0], hd[1], hd[2]);
  basis(g, [Math.sin(yaw), 0, -Math.cos(yaw)], [0, 1, 0]);
  add(g, geo.cyl(0.013, 0.016, 1.2, 5), mat(0xa8784a), [0, 0.18, 0]);
  add(g, geo.octa(0.045), mat(P.steelLight), [0, 0.86, 0], null, [0.8, 2.6, 0.3]);
  add(g, geo.box(0.01, 0.1, 0.07), team, [0, 0.66, -0.04]);
  return {
    root,
    parts: { body, head, legs, weapon },
    height: 2.6,
    radius: 0.9,
  };
}

/** Elephant leg (lathe): foot at y = 0 flaring out, column up to the hip at y = 0.98. */
const eleLegGeo = () => geo.custom('iron:eleLeg', () => new THREE.LatheGeometry(
  [[0.185, 0.0], [0.17, 0.12], [0.15, 0.2], [0.152, 0.5], [0.178, 0.98]].map(([r, y]) => new THREE.Vector2(r, y)), 6,
));
/** Flat disc facing +Z (inner ear). */
const earInGeo = () => geo.custom('iron:earIn', () => new THREE.CircleGeometry(1, 8));
/** Open ring round the foot (darker sole band). */
const eleFootGeo = () => geo.custom('iron:eleFoot', () => new THREE.CylinderGeometry(0.176, 0.192, 0.075, 6, 1, true));

// Carroballista: a torsion bolt-thrower on a two-wheeled cart with team-painted side boards. parts.weapon is
// the stock + torsion frame + bow arms pivoting on the mount (rest rotation.x = 0; the inner group tilts it
// slightly up). A heavy bolt is loaded; a 'muzzle' marker sits at its tip.
export function ballista(tc) {
  const root = new THREE.Group();
  const team = mat(tc), teamD = mat(shade(tc, 0.6)), wood = mat(P.wood), woodD = mat(P.woodDark), woodL = mat(P.woodLight);
  const iron = mat(P.iron), bronze = mat(C.bronze), bronzeD = mat(C.bronzeD), bronzeL = mat(C.bronzeL);
  const sinew = mat(C.sinew), rope = mat(C.rope), gold = mat(P.gold);
  const WR = 0.3, AZ = -0.3, BY = 0.44;
  const wheels = [];
  for (const s of [1, -1]) wheels.push(spokedWheel(root, 'ballista', s * 0.45, WR, AZ, WR, { rim: woodD, spoke: wood, hub: bronze, tire: iron, n: 8, w: 0.05, tube: 0.035, rs: 4 }));
  add(root, geo.cyl(0.03, 0.03, 0.98, 6), iron, [0, WR, AZ], [0, 0, HALF_PI]);
  // cart bed: rails, team side boards with bronze studs, cross beams, deck, front trestle legs
  for (const s of [1, -1]) {
    add(root, geo.box(0.08, 0.1, 1.12), team, [s * 0.29, BY, -0.07]);
    add(root, geo.box(0.022, 0.16, 0.98), team, [s * 0.34, BY, -0.06]);
    add(root, geo.box(0.028, 0.03, 1.0), bronzeD, [s * 0.342, BY + 0.085, -0.06]);
    add(root, geo.box(0.028, 0.03, 1.0), bronzeD, [s * 0.342, BY - 0.085, -0.06]);
    add(root, geo.box(0.07, 0.16, 0.12), woodD, [s * 0.29, WR + 0.06, AZ]);
    beam(root, [s * 0.27, BY - 0.04, 0.42], [s * 0.33, 0.0, 0.6], 0.065, woodD);
  }
  add(root, mergedCyls('ballistaStuds', [1, -1].flatMap((s) => [-0.42, -0.14, 0.14, 0.38].map((z) => [0.025, 0.025, 0.012, s * 0.352, BY, z, 0, HALF_PI, 6]))), bronzeL);
  add(root, mb('ballistaCross', [[0.66, 0.08, 0.08, 0, BY, 0.47], [0.66, 0.08, 0.08, 0, BY, -0.6], [0.6, 0.04, 0.04, 0, 0.2, 0.52]]), woodD);
  add(root, mb('ballistaDeck', [-0.18, -0.06, 0.06, 0.18].map((x) => [0.11, 0.03, 1.02, x, BY + 0.06, -0.07])), woodL);
  // chest of spare bolts with a team lid on the rear deck
  add(root, geo.box(0.2, 0.12, 0.26), woodD, [-0.13, BY + 0.135, -0.47]);
  add(root, geo.box(0.215, 0.03, 0.275), team, [-0.13, BY + 0.2, -0.47]);
  add(root, mergedCyls('ballistaSpareBolts', [-0.18, -0.13, -0.08].map((x) => [0.014, 0.014, 0.3, x, BY + 0.24, -0.47, HALF_PI, 0, 4])), woodL);
  add(root, mergedCyls('ballistaSpareHeads', [-0.18, -0.13, -0.08].map((x) => [0, 0.026, 0.07, x, BY + 0.24, -0.29, HALF_PI, 0, 4])), iron);
  // mount: post with braces and bronze fork cheeks
  const PY = 0.78, PZ = -0.04;
  add(root, geo.box(0.11, PY - BY - 0.1, 0.11), woodD, [0, (BY + 0.075 + PY - 0.03) / 2, PZ]);
  for (const [dx, dz] of [[0.2, 0.22], [-0.2, 0.22], [0.2, -0.26], [-0.2, -0.26]]) beam(root, [dx, BY + 0.08, PZ + dz], [0, PY - 0.14, PZ], 0.04, wood);
  add(root, mb('ballistaFork', [[0.025, 0.14, 0.12, 0.075, 0, 0], [0.025, 0.14, 0.12, -0.075, 0, 0]]), bronze, [0, PY - 0.03, PZ]);
  // weapon
  const weapon = grp(root, 0, PY, PZ);
  const el = grp(weapon, 0, 0, 0);
  el.rotation.x = -0.1;
  add(el, geo.cyl(0.025, 0.025, 0.2, 6), iron, [0, 0, 0], [0, 0, HALF_PI]);
  add(el, geo.box(0.12, 0.08, 1.0), wood, [0, 0.04, -0.12]);
  add(el, geo.box(0.08, 0.03, 0.86), woodL, [0, 0.095, -0.1]);
  add(el, geo.box(0.026, 0.012, 0.8), woodD, [0, 0.112, -0.08]);
  add(el, mb('ballistaStockBands', [-0.45, -0.2, 0.08].map((z) => [0.13, 0.09, 0.03, 0, 0.04, z])), bronzeD);
  // torsion frame (capitulum): team-painted beams, wooden uprights, sinew springs, bronze washers + levers
  const FZ = 0.3, TY = 0.27, BYb = -0.05, MY = (TY + BYb) / 2;
  add(el, mb('ballistaFrameBeams', [[0.6, 0.07, 0.13, 0, TY, 0], [0.6, 0.07, 0.13, 0, BYb, 0]]), team, [0, 0, FZ]);
  add(el, mb('ballistaFrameEdges', [[0.62, 0.02, 0.135, 0, TY + 0.04, 0], [0.62, 0.02, 0.135, 0, BYb - 0.04, 0]]), bronzeD, [0, 0, FZ]);
  add(el, mb('ballistaUprights', [-0.27, -0.065, 0.065, 0.27].map((x) => [0.05, TY - BYb, 0.11, x, MY, 0])), woodD, [0, 0, FZ]);
  add(el, mergedCyls('ballistaSprings', [1, -1].map((s) => [0.05, 0.05, TY - BYb + 0.04, s * 0.165, MY, 0, 0, 0, 7])), sinew, [0, 0, FZ]);
  add(el, mergedCyls('ballistaWashers', [1, -1].flatMap((s) => [[0.078, 0.078, 0.04, s * 0.165, TY + 0.055, 0, 0, 0, 8], [0.078, 0.078, 0.04, s * 0.165, BYb - 0.055, 0, 0, 0, 8]])), bronze, [0, 0, FZ]);
  add(el, mb('ballistaLevers', [1, -1].flatMap((s) => [[0.2, 0.022, 0.03, s * 0.165, TY + 0.085, 0, s * 0.5], [0.2, 0.022, 0.03, s * 0.165, BYb - 0.085, 0, -s * 0.5]])), iron, [0, 0, FZ]);
  // bow arms drawn back, bowstring to the claw
  const SZ = -0.3, SY = 0.125;
  for (const s of [1, -1]) {
    const a = [s * 0.165, MY, FZ - 0.02], t = [s * 0.46, MY + 0.01, FZ - 0.2];
    beam(el, a, t, 0.045, woodD);
    add(el, geo.box(0.05, 0.05, 0.05), iron, t);
    beam(el, t, [s * 0.015, SY, SZ], 0.012, rope);
  }
  add(el, geo.box(0.06, 0.05, 0.08), iron, [0, SY + 0.01, SZ - 0.02]);
  add(el, geo.box(0.02, 0.07, 0.02), iron, [0, SY - 0.03, SZ - 0.07], [0.5, 0, 0]);
  // loaded bolt
  const tipZ = 0.74;
  add(el, geo.cyl(0.018, 0.018, tipZ - 0.12 - SZ, 6), woodL, [0, SY, (SZ + tipZ - 0.12) / 2], [HALF_PI, 0, 0]);
  add(el, geo.cone(0.036, 0.13, 4), iron, [0, SY, tipZ - 0.065], [HALF_PI, 0, Math.PI / 4]);
  add(el, mb('boltFletch', [[0.1, 0.008, 0.12, 0, 0, 0], [0.008, 0.1, 0.12, 0, 0, 0]]), team, [0, SY, SZ + 0.1]);
  muzzle(el, 0, SY, tipZ);
  // windlass at the back
  add(el, geo.cyl(0.045, 0.045, 0.34, 7), woodL, [0, 0.04, -0.56], [0, 0, HALF_PI]);
  add(el, mb('ballistaHandles', [1, -1].flatMap((s) => [[0.025, 0.26, 0.025, s * 0.19, 0.04, -0.56], [0.025, 0.025, 0.26, s * 0.19, 0.04, -0.56]])), woodD);
  add(el, geo.cyl(0.065, 0.065, 0.025, 8), iron, [0.1, 0.04, -0.56], [0, 0, HALF_PI]);
  // team pennant on the rear corner of the cart
  const pp = grp(root, 0.3, BY + 0.05, -0.36, HALF_PI);
  add(pp, geo.cyl(0.014, 0.018, 0.62, 5), woodD, [0, 0.31, 0]);
  add(pp, geo.sphere(0.025, 6, 4), gold, [0, 0.63, 0]);
  add(pp, CG.pennant(), team, [0.01, 0.52, 0], null, [0.32, 0.18, 0.016]);
  add(pp, CG.pennant(), teamD, [0.012, 0.52, 0], null, [0.12, 0.07, 0.02]);
  return { root, parts: { wheels, weapon }, height: 1.1, radius: 0.75 };
}

// ===========================================================================
// Buildings
// ===========================================================================

// Iron Age town center: a Roman temple-fronted forum. A travertine plaza, a high podium with a broad marble
// stair between cheek walls, a peristyle of white columns with gilded capitals round a cream cella with
// bronze doors and team banners, a team frieze with gold paterae, a red-tiled gable roof with a marble
// pediment (team tympanum, gold eagle and wreath) and gilded acroteria. Bronze braziers burn on the stair
// cheeks; team vexilla stand at the front corners and an eagle standard (aquila) before the steps.
export function iron_forum(tc) {
  const root = new THREE.Group();
  const team = mat(tc), gold = mat(P.gold), goldD = mat(P.goldDark);
  const marble = mat(C.marble), marbleD = mat(C.marbleD), trav = mat(C.trav), travD = mat(C.travD), dark = mat(C.dark);
  const bronze = mat(C.bronze), bronzeD = mat(C.bronzeD), cella = mat(0xece0c4);
  // plaza paving with slab joints
  add(root, geo.box(3.88, 0.06, 3.88), travD, [0, 0.03, 0]);
  const joints = [];
  for (const t of [-1.3, -0.65, 0, 0.65, 1.3]) joints.push([0.025, 0.004, 3.86, t, 0.061, 0], [3.86, 0.004, 0.025, 0, 0.061, t]);
  add(root, mb('forumJoints', joints), mat(0xa89c83));
  // podium
  const b = 0.06, PH = 0.52, PW = 3.24, Z0 = -1.82, Z1 = 0.92;
  const pz = (Z0 + Z1) / 2, PD = Z1 - Z0;
  add(root, geo.box(PW + 0.1, 0.1, PD + 0.1), marbleD, [0, b + 0.05, pz]);
  add(root, geo.box(PW, PH, PD), trav, [0, b + PH / 2, pz]);
  add(root, geo.box(PW + 0.1, 0.07, PD + 0.1), marble, [0, b + PH - 0.035, pz]);
  // stair between cheek walls
  const SW = 1.64, SZ = 1.72, cw = (PW - SW) / 2, cx = SW / 2 + cw / 2, cz = (Z1 + SZ) / 2;
  for (const s of [1, -1]) {
    add(root, geo.box(cw, PH, SZ - Z1), trav, [s * cx, b + PH / 2, cz]);
    add(root, geo.box(cw + 0.1, 0.1, SZ - Z1 + 0.05), marbleD, [s * cx, b + 0.05, cz + 0.025]);
    add(root, geo.box(cw + 0.1, 0.07, SZ - Z1 + 0.05), marble, [s * cx, b + PH - 0.035, cz + 0.025]);
  }
  const n = 7, sh = PH / n, sd = (SZ - Z1) / n, steps = [];
  for (let i = 0; i < n; i++) steps.push([SW, sh * (i + 1), sd + 0.002, 0, b + (sh * (i + 1)) / 2, SZ - sd * (i + 0.5)]);
  add(root, mb('forumSteps', steps), marble);
  // peristyle: 6 columns across the front, 4 down each side
  const FY = b + PH, CH = 1.5;
  const cols = [];
  for (const x of [-1.3, -0.78, -0.26, 0.26, 0.78, 1.3]) cols.push([x, 0.7]);
  for (const s of [1, -1]) for (const z of [0.14, -0.42, -0.98, -1.54]) cols.push([s * 1.3, z]);
  add(root, mb('forumColBases', cols.map(([x, z]) => [0.21, 0.07, 0.21, x, FY + 0.035, z])), marbleD);
  add(root, mergedTubes('forumColTori', cols.map(([x, z]) => [0.1, 0.112, 0.05, x, FY + 0.095, z, 8])), marbleD);
  add(root, mergedTubes('forumColShafts', cols.map(([x, z]) => [0.074, 0.086, CH - 0.24, x, FY + 0.12 + (CH - 0.24) / 2, z, 8])), marble);
  add(root, mergedTubes('forumColCaps', cols.map(([x, z]) => [0.118, 0.076, 0.1, x, FY + CH - 0.1, z, 8])), gold);
  add(root, mb('forumColAbaci', cols.map(([x, z]) => [0.23, 0.05, 0.23, x, FY + CH - 0.025, z])), marble);
  // cella with bronze doors and team banners
  const CX = 1.0, CZ0 = -1.68, CZ1 = 0.22;
  add(root, geo.box(2 * CX, CH, CZ1 - CZ0), cella, [0, FY + CH / 2, (CZ0 + CZ1) / 2]);
  add(root, geo.box(2 * CX + 0.03, 0.12, CZ1 - CZ0 + 0.03), marbleD, [0, FY + 0.06, (CZ0 + CZ1) / 2]);
  add(root, mb('forumPilasters', [-0.98, 0.98].map((x) => [0.1, CH, 0.04, x, CH / 2, 0])), marble, [0, FY, CZ1 + 0.01]);
  add(root, geo.box(0.7, 1.08, 0.03), dark, [0, FY + 0.54, CZ1 + 0.01]);
  add(root, mb('forumDoors', [[0.29, 1.0, 0.03, -0.155, 0.5, 0], [0.29, 1.0, 0.03, 0.155, 0.5, 0]]), bronze, [0, FY, CZ1 + 0.025]);
  add(root, mb('forumDoorPanels', [-0.155, 0.155].flatMap((x) => [0.25, 0.72].map((y) => [0.2, 0.28, 0.02, x, y, 0]))), bronzeD, [0, FY, CZ1 + 0.04]);
  add(root, geo.box(0.86, 0.1, 0.07), marble, [0, FY + 1.12, CZ1 + 0.03]);
  for (const s of [1, -1]) banner(root, s * 0.62, FY + 1.36, CZ1 + 0.04, tc, { w: 0.3, h: 0.86, trim: P.gold, emblem: P.gold });
  // entablature: architrave, team frieze with gold paterae, cornice with dentils
  const EY = FY + CH, ex = 1.43, ez0 = -1.69, ez1 = 0.83, ezc = (ez0 + ez1) / 2, eL = ez1 - ez0;
  add(root, geo.box(2 * ex, 0.12, eL), marble, [0, EY + 0.06, ezc]);
  add(root, geo.box(2 * ex - 0.04, 0.15, eL - 0.04), team, [0, EY + 0.195, ezc]);
  add(root, mergedDiscs('forumPaterae', [-1.04, -0.52, 0, 0.52, 1.04].map((x) => [0.05, x, 0, 0, 8])), gold, [0, EY + 0.195, ez1 - 0.018]);
  for (const s of [1, -1]) add(root, mergedDiscs('forumPateraeSide', [-1.3, -0.8, -0.3, 0.2, 0.6].map((z) => [0.05, -z, 0, 0, 8])), gold, [s * (ex - 0.018), EY + 0.195, 0], [0, s * HALF_PI, 0]);
  const dent = [];
  for (let i = 0; i < 15; i++) dent.push([0.06, 0.04, 0.04, -1.4 + i * 0.2, 0, 0]);
  add(root, mb('forumDentils', dent), marble, [0, EY + 0.29, ez1 + 0.01]);
  add(root, geo.box(2 * ex + 0.12, 0.08, eL + 0.12), marble, [0, EY + 0.35, ezc]);
  // red-tiled gable roof (ridge front-to-back) with a marble pediment
  const RY = EY + 0.39, RH = 0.68, RL = eL + 0.16, RD = 2 * ex + 0.16, rf = ezc + RL / 2;
  gableRoof(root, 0, RY, ezc, RL, RD, RH, C.tile, C.marble, { ry: HALF_PI, rows: 4, rowColor: C.tileD });
  add(root, CG.gable(), marble, [0, RY, rf + 0.012], [0, HALF_PI, 0], [0.05, RH, RD]);
  const tH = 0.46, tW = tH * (RD / RH);
  add(root, CG.gable(), team, [0, RY + 0.075, rf + 0.03], [0, HALF_PI, 0], [0.03, tH, tW]);
  add(root, geo.box(RD - 0.1, 0.06, 0.06), marble, [0, RY + 0.04, rf + 0.03]);
  add(root, geo.torus(0.12, 0.024, 4, 12), mat(0xd9b84a), [0, RY + 0.25, rf + 0.05]);
  eagle(root, 0, RY + 0.115, rf + 0.06, 0.88, gold, goldD);
  // acroteria: a big gilded eagle on the apex, gilded palmettes on the corners
  add(root, geo.box(0.16, 0.1, 0.16), marble, [0, RY + RH + 0.02, rf - 0.06]);
  eagle(root, 0, RY + RH + 0.07, rf - 0.06, 0.85, gold, goldD);
  for (const s of [1, -1]) {
    add(root, geo.box(0.14, 0.08, 0.14), marble, [s * (RD / 2 - 0.08), RY + 0.04, rf - 0.06]);
    add(root, geo.cone(0.07, 0.2, 5), gold, [s * (RD / 2 - 0.08), RY + 0.18, rf - 0.06]);
  }
  // braziers on the stair cheeks
  const fires = [], glows = [];
  for (const s of [1, -1]) {
    const br = brazier(root, s * cx, FY, cz + 0.12, bronze, bronzeD, 1.1);
    fires.push(br.fire);
    glows.push(br.glow);
  }
  // team vexilla at the front corners, the aquila before the steps
  for (const s of [1, -1]) vexillum(root, s * 1.71, b, 1.72, tc, { h: 1.75, w: 0.32, ch: 0.34 });
  const aq = grp(root, 0, b, 1.83);
  add(aq, geo.box(0.18, 0.08, 0.14), marbleD, [0, 0.04, 0]);
  add(aq, geo.cyl(0.024, 0.028, 1.95, 6), mat(P.woodDark), [0, 1.0, 0]);
  add(aq, mergedCyls('aquilaDiscs', [1.3, 1.12, 0.94].map((y) => [0.055, 0.055, 0.02, 0, y, 0.026, HALF_PI, 0, 8])), gold);
  add(aq, geo.box(0.2, 0.12, 0.025), team, [0, 1.5, 0.03]);
  add(aq, geo.box(0.22, 0.14, 0.02), gold, [0, 1.5, 0.018]);
  add(aq, geo.torus(0.09, 0.018, 4, 10), mat(0xd9b84a), [0, 1.78, 0.0]);
  add(aq, geo.box(0.12, 0.04, 0.12), gold, [0, 1.96, 0]);
  eagle(aq, 0, 1.98, 0, 0.9, gold, goldD);
  return { root, parts: { fire: fires, glow: glows }, height: 3.4, radius: 1.95 };
}

// Roman domus: plastered walls with a red dado on a travertine base; the red-tiled roof slopes out to the
// street and in toward the open atrium (compluvium) above a marble impluvium pool. A team door with bronze
// knockers, a taberna shopfront with a striped team awning, amphorae and a counter, a small upper room
// with its own tiled roof and a team cloth hung from its window.
export function house_iron(tc) {
  const root = new THREE.Group();
  const team = mat(tc), teamD = mat(shade(tc, 0.6));
  const plaster = mat(C.plaster), plasterD = mat(C.plasterD), red = mat(C.pompeii), redD = mat(C.pompeiiD);
  const tile = mat(C.tile), tileD = mat(C.tileD), trav = mat(C.trav), travD = mat(C.travD), marble = mat(C.marble), dark = mat(C.dark);
  const bronze = mat(C.bronze), woodD = mat(P.woodDark), clay = mat(0xb4643a), clayD = mat(0x8a4a2a);
  add(root, geo.box(1.92, 0.08, 1.92), travD, [0, 0.04, 0]);
  const b = 0.08, WH = 0.78, X1 = 0.82, Z0 = -0.84, Z1 = 0.64;
  const zc = (Z0 + Z1) / 2;
  // roof ring dimensions: eave, ridge, compluvium hole (half sizes)
  const eX = X1 + 0.07, eZ = (Z1 - Z0) / 2 + 0.07, rX = 0.56, rZ = 0.5, hX = 0.28, hZ = 0.24, RH = 0.36, HD = 0.16;
  // wings round the atrium
  const wings = [
    [2 * X1, WH, Z1 - (zc + hZ), 0, 0, (Z1 + zc + hZ) / 2],
    [2 * X1, WH, zc - hZ - Z0, 0, 0, (Z0 + zc - hZ) / 2],
    [X1 - hX, WH, 2 * hZ, (X1 + hX) / 2, 0, zc],
    [X1 - hX, WH, 2 * hZ, -(X1 + hX) / 2, 0, zc],
  ];
  add(root, mb('domusWings', wings), plaster, [0, b + WH / 2, 0]);
  const dado = [[2 * X1 + 0.012, 0.18, 0.012, 0, 0, Z1], [2 * X1 + 0.012, 0.18, 0.012, 0, 0, Z0], [0.012, 0.18, Z1 - Z0, X1, 0, zc], [0.012, 0.18, Z1 - Z0, -X1, 0, zc]];
  add(root, mb('domusDado', dado), red, [0, b + 0.09, 0]);
  // atrium: Pompeian red walls up to the compluvium, black dado, mosaic floor, impluvium
  const ah = WH + RH - HD;
  add(root, mb('atriumWalls', [[2 * hX, ah, 0.012, 0, 0, hZ - 0.006], [2 * hX, ah, 0.012, 0, 0, -hZ + 0.006], [0.012, ah, 2 * hZ, hX - 0.006, 0, 0], [0.012, ah, 2 * hZ, -hX + 0.006, 0, 0]]), red, [0, b + ah / 2, zc]);
  add(root, mb('atriumDado', [[2 * hX - 0.02, 0.12, 0.014, 0, 0, hZ - 0.012], [0.014, 0.12, 2 * hZ - 0.02, hX - 0.012, 0, 0], [0.014, 0.12, 2 * hZ - 0.02, -hX + 0.012, 0, 0]]), redD, [0, b + 0.06, zc]);
  add(root, geo.box(2 * hX - 0.02, 0.01, 2 * hZ - 0.02), mat(0xe8dcc0), [0, b + 0.005, zc]);
  add(root, geo.box(0.32, 0.04, 0.26), marble, [0, b + 0.02, zc]);
  const water = add(root, geo.box(0.26, 0.042, 0.2), mat(C.water, { emissive: 0x1a3a5a, emissiveIntensity: 0.4 }), [0, b + 0.021, zc]);
  water.castShadow = false;
  add(root, geo.box(0.07, 0.12, 0.07), marble, [0, b + 0.06, zc - hZ + 0.06]); // cartibulum table
  // roof: outer slopes to the street, inner slopes down to the compluvium
  const ry = b + WH;
  const q = [];
  const ring = (ax, az, ay, bx, bz, by, sense) => {
    // four quads between rectangle A (half ax, az at ay) and rectangle B (bx, bz at by); sense +1 faces out, -1 in
    const A = [[ax, ay, az], [-ax, ay, az], [-ax, ay, -az], [ax, ay, -az]];
    const B = [[bx, by, bz], [-bx, by, bz], [-bx, by, -bz], [bx, by, -bz]];
    const N = [[0, 1, sense], [-sense, 1, 0], [0, 1, -sense], [sense, 1, 0]];
    for (let i = 0; i < 4; i++) q.push([A[i], A[(i + 1) % 4], B[(i + 1) % 4], B[i], N[i]]);
  };
  ring(eX, eZ, 0, rX, rZ, RH, 1);
  ring(rX, rZ, RH, hX, hZ, RH - HD, -1);
  add(root, quadsGeo('domusRoof', q), tile, [0, ry, zc]);
  // imbrex ridges running down the outer slopes, hip and ridge caps, eave line
  const im = [];
  const slopeZ = Math.atan2(RH, eZ - rZ), lenZ = Math.hypot(RH, eZ - rZ);
  const slopeX = Math.atan2(RH, eX - rX), lenX = Math.hypot(RH, eX - rX);
  for (const x of [-0.42, -0.21, 0, 0.21, 0.42]) {
    for (const s of [1, -1]) im.push([0.035, 0.03, lenZ, x, RH / 2 + 0.015, s * (rZ + eZ) / 2, s > 0 ? 0 : Math.PI, slopeZ]);
  }
  for (const z of [-0.3, -0.1, 0.1, 0.3]) {
    for (const s of [1, -1]) im.push([0.035, 0.03, lenX, s * (rX + eX) / 2, RH / 2 + 0.015, z, s * HALF_PI, slopeX]);
  }
  add(root, mb('domusImbrices', im), tileD, [0, ry, zc]);
  const ridge = [[2 * rX + 0.05, 0.05, 0.06, 0, RH, rZ], [2 * rX + 0.05, 0.05, 0.06, 0, RH, -rZ], [0.06, 0.05, 2 * rZ, rX, RH, 0], [0.06, 0.05, 2 * rZ, -rX, RH, 0]];
  add(root, mb('domusRidge', ridge), tileD, [0, ry, zc]);
  for (const sx of [1, -1]) for (const sz of [1, -1]) beam(root, [sx * eX, ry + 0.01, zc + sz * eZ], [sx * rX, ry + RH + 0.01, zc + sz * rZ], 0.05, tileD);
  add(root, mb('domusCompluvium', [[2 * hX + 0.04, 0.04, 0.04, 0, 0, hZ], [2 * hX + 0.04, 0.04, 0.04, 0, 0, -hZ], [0.04, 0.04, 2 * hZ, hX, 0, 0], [0.04, 0.04, 2 * hZ, -hX, 0, 0]]), marble, [0, ry + RH - HD, zc]);
  // upper room (cenaculum) at the back left with its own tiled pyramid roof
  const ux = 0.52, uz = -0.62, uw = 0.5, ud = 0.42, uh = 0.62;
  add(root, geo.box(uw, uh, ud), plaster, [ux, ry + uh / 2, uz]);
  add(root, geo.box(uw + 0.02, 0.05, ud + 0.02), plasterD, [ux, ry + uh - 0.025, uz]);
  add(root, CG.pyramid(), tile, [ux, ry + uh, uz], null, [uw + 0.14, 0.36, ud + 0.14]);
  add(root, geo.box(0.05, 0.05, 0.05), tileD, [ux, ry + uh + 0.36, uz]);
  add(root, mb('cenaculumWins', [[0.12, 0.17, 0.02, -0.1, 0, 0], [0.12, 0.17, 0.02, 0.1, 0, 0]]), dark, [ux, ry + uh * 0.55, uz + ud / 2 + 0.005]);
  add(root, geo.box(0.12, 0.2, 0.015), team, [ux - 0.1, ry + uh * 0.55 - 0.13, uz + ud / 2 + 0.02], [0.08, 0, 0]);
  add(root, geo.box(0.36, 0.03, 0.08), woodD, [ux, ry + uh * 0.55 - 0.11, uz + ud / 2 + 0.035]);
  // front: team door in a travertine frame with bronze knockers, small high windows
  const fz = Z1;
  add(root, mb('domusDoorFrame', [[0.06, 0.6, 0.05, -0.2, 0.3, 0], [0.06, 0.6, 0.05, 0.2, 0.3, 0], [0.48, 0.07, 0.06, 0, 0.62, 0]]), trav, [0.18, b, fz + 0.01]);
  add(root, mb('domusDoor', [[0.16, 0.56, 0.03, -0.083, 0.28, 0], [0.16, 0.56, 0.03, 0.083, 0.28, 0]]), team, [0.18, b, fz + 0.015]);
  add(root, mb('domusDoorBands', [[0.34, 0.025, 0.035, 0, 0.12, 0], [0.34, 0.025, 0.035, 0, 0.44, 0]]), teamD, [0.18, b, fz + 0.02]);
  add(root, mergedCyls('domusKnockers', [[0.022, 0.022, 0.02, 0.15, 0, 0, HALF_PI, 0, 6], [0.022, 0.022, 0.02, 0.21, 0, 0, HALF_PI, 0, 6]]), bronze, [0, b + 0.3, fz + 0.04]);
  add(root, geo.box(0.5, 0.04, 0.14), trav, [0.18, b + 0.02, fz + 0.07]);
  add(root, mb('domusWinsFront', [[0.1, 0.12, 0.02, 0.63, 0, 0]]), dark, [0, b + 0.56, fz + 0.005]);
  add(root, mb('domusWinsSide', [[0.02, 0.12, 0.1, X1 + 0.005, 0, -0.4], [0.02, 0.12, 0.1, X1 + 0.005, 0, 0.2], [0.02, 0.12, 0.1, -X1 - 0.005, 0, -0.4], [0.02, 0.12, 0.1, -X1 - 0.005, 0, 0.2]]), dark, [0, b + 0.56, 0]);
  // taberna shopfront (right side): dark opening, marble counter with set-in jars, striped team awning
  const tx = -0.48;
  add(root, geo.box(0.5, 0.5, 0.02), dark, [tx, b + 0.25, fz + 0.005]);
  add(root, geo.box(0.46, 0.24, 0.12), marble, [tx, b + 0.12, fz + 0.07]);
  add(root, mergedCyls('tabernaJars', [-0.13, 0.0, 0.13].map((x) => [0.04, 0.04, 0.02, x, 0, 0, 0, 0, 7])), clayD, [tx, b + 0.245, fz + 0.07]);
  const aw = grp(root, tx, b + 0.62, fz + 0.01);
  aw.rotation.x = 0.55;
  for (let i = 0; i < 5; i++) add(aw, geo.box(0.12, 0.022, 0.3), i % 2 ? mat(C.linen) : team, [-0.24 + i * 0.12, 0, 0.15]);
  add(aw, geo.box(0.62, 0.03, 0.03), teamD, [0, -0.01, 0.3]);
  for (const s of [1, -1]) rod(root, [tx + s * 0.29, b, fz + 0.25], [tx + s * 0.29, b + 0.5, fz + 0.25], 0.012, woodD, 4);
  add(root, geo.box(0.42, 0.08, 0.02), team, [tx, b + 0.7, fz + 0.012]); // painted shop sign
  add(root, geo.box(0.3, 0.035, 0.022), mat(C.linen), [tx, b + 0.7, fz + 0.02]);
  // amphorae by the shop, a potted laurel by the door
  const amph = (x, z, rot, s) => {
    const g = grp(root, x, b, z, rot);
    g.scale.setScalar(s);
    add(g, geo.cone(0.05, 0.1, 6), clay, [0, 0.05, 0], [Math.PI, 0, 0]);
    add(g, geo.sphere(0.075, 7, 5), clay, [0, 0.17, 0], null, [1, 1.35, 1]);
    add(g, geo.cyl(0.025, 0.03, 0.1, 6), clay, [0, 0.31, 0]);
    add(g, mb('amphHandles', [[0.11, 0.02, 0.02, 0, 0.3, 0]]), clayD);
    return g;
  };
  amph(-0.86, 0.82, 0.3, 1);
  amph(-0.74, 0.86, -0.4, 0.95);
  amph(-0.86, 0.68, 0.9, 0.9);
  add(root, geo.cyl(0.07, 0.055, 0.12, 7), clay, [0.62, b + 0.06, 0.82]);
  add(root, geo.ico(0.13, 0), mat(P.leaf), [0.62, b + 0.25, 0.82], null, [1, 1.2, 1]);
  add(root, geo.ico(0.09, 0), mat(P.leafLight), [0.65, b + 0.36, 0.84]);
  return { root, parts: {}, height: 1.9, radius: 0.95 };
}

/** Armillary sphere rings + polar axis + globe (built inside a spin group centred on the sphere). */
function armillary(g, gold, goldD, globe) {
  add(g, geo.torus(0.17, 0.014, 3, 14), gold, [0, 0, 0], [HALF_PI, 0, 0]);
  add(g, geo.torus(0.17, 0.014, 3, 14), gold);
  add(g, geo.torus(0.17, 0.014, 3, 14), gold, [0, 0, 0], [0, HALF_PI, 0]);
  add(g, geo.torus(0.155, 0.017, 3, 14), goldD, [0, 0, 0], [HALF_PI - 0.41, 0, 0.3]);
  add(g, geo.cyl(0.008, 0.008, 0.42, 4), goldD, [0, 0, 0], [0.41, 0, 0]);
  add(g, geo.sphere(0.055, 8, 6), globe);
}

// Early Research Center (Stone -> Gunpowder Age): an academy library. A stone hall on a stepped platform
// whose front is a wall of scroll cubbies seen through a colonnade, a team frieze, team banners on the
// corner piers, a roof terrace with a patinated observatory dome topped by a spinning armillary sphere,
// a philosopher's statue, a sundial and a capsa of scrolls in front.
export function research_1(tc) {
  const root = new THREE.Group();
  const team = mat(tc), gold = mat(P.gold), goldD = mat(P.goldDark);
  const ash = mat(C.ashlar), ashD = mat(C.ashlarD), trav = mat(C.trav), travD = mat(C.travD), marble = mat(C.marble), marbleD = mat(C.marbleD);
  const dark = mat(C.dark), wood = mat(P.wood), bronze = mat(C.bronze), patina = mat(C.patina), patinaD = mat(C.patinaD);
  // base + platform + front steps
  add(root, geo.box(2.88, 0.1, 2.88), travD, [0, 0.05, 0]);
  add(root, geo.box(2.66, 0.12, 2.36), trav, [0, 0.16, -0.12]);
  add(root, geo.box(1.3, 0.06, 0.14), trav, [0, 0.13, 1.12]);
  const FY = 0.22;
  // hall
  const HX = 1.16, HZ0 = -1.22, HZ1 = 0.36, HH = 1.12, hzc = (HZ0 + HZ1) / 2;
  add(root, geo.box(2 * HX, HH, HZ1 - HZ0), ash, [0, FY + HH / 2, hzc]);
  const courses = [];
  for (const y of [0.25, 0.5, 0.75, 1.0]) {
    courses.push([2 * HX + 0.012, 0.014, 0.012, 0, y, HZ0], [0.012, 0.014, HZ1 - HZ0, HX, y, hzc], [0.012, 0.014, HZ1 - HZ0, -HX, y, hzc]);
  }
  add(root, mb('libCourses', courses), ashD, [0, FY, 0]);
  add(root, geo.box(2 * HX + 0.04, 0.1, HZ1 - HZ0 + 0.04), ashD, [0, FY + 0.05, hzc]);
  // corner piers framing the portico, with team banners
  const PZ = 0.72;
  for (const s of [1, -1]) {
    add(root, geo.box(0.16, HH, PZ - HZ1 + 0.02), ash, [s * (HX - 0.08), FY + HH / 2, (PZ + HZ1) / 2]);
    banner(root, s * (HX - 0.08), FY + HH - 0.08, PZ + 0.02, tc, { w: 0.15, h: 0.62, trim: P.gold, emblem: P.gold });
  }
  // scroll shelves (armaria) either side of the doorway
  const rows = 4, ncol = 4, cw = 0.19, ch = 0.21, sy0 = FY + 0.08;
  const grid = [], scrollsA = [], scrollsB = [], tags = [];
  for (const s of [1, -1]) {
    const x0 = s * 0.66;
    const W = ncol * cw, Hh = rows * ch;
    for (let i = 0; i <= rows; i++) grid.push([W + 0.03, 0.025, 0.1, x0, sy0 + i * ch, 0]);
    for (let j = 0; j <= ncol; j++) grid.push([0.025, Hh, 0.1, x0 - W / 2 + j * cw, sy0 + Hh / 2, 0]);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < ncol; j++) {
        const cx = x0 - W / 2 + (j + 0.5) * cw, cy = sy0 + i * ch + 0.0125;
        const k = (i * 7 + j * 3 + (s > 0 ? 1 : 0)) % 5;
        const list = k % 2 ? scrollsA : scrollsB;
        list.push([0.036, cx - 0.042, cy + 0.037, 0.0]);
        list.push([0.036, cx + 0.033, cy + 0.037, 0.0]);
        (k === 3 ? scrollsA : scrollsB).push([0.034, cx - 0.004, cy + 0.104, 0.004]);
        if (k === 1) tags.push([0.022, 0.03, 0.012, cx + 0.033, cy + 0.0, 0.004]);
      }
    }
  }
  add(root, mb('libShelfBack', [[0.8, 0.88, 0.02, 0.66, 0, 0], [0.8, 0.88, 0.02, -0.66, 0, 0]]), mat(0x2e2118), [0, sy0 + rows * ch / 2, HZ1 + 0.01]);
  add(root, mb('libShelfGrid', grid), wood, [0, 0, HZ1 + 0.06]);
  add(root, mergedDiscs('libScrollsA', scrollsA), mat(C.scroll), [0, 0, HZ1 + 0.075]);
  add(root, mergedDiscs('libScrollsB', scrollsB), mat(C.scrollD), [0, 0, HZ1 + 0.075]);
  add(root, mb('libTags', tags), team, [0, 0, HZ1 + 0.075]);
  // doorway with a marble frame and a gold owl above
  add(root, geo.box(0.4, 0.82, 0.02), dark, [0, FY + 0.41, HZ1 + 0.01]);
  add(root, mb('libDoorFrame', [[0.06, 0.86, 0.05, -0.23, 0.43, 0], [0.06, 0.86, 0.05, 0.23, 0.43, 0], [0.54, 0.07, 0.06, 0, 0.88, 0]]), marble, [0, FY, HZ1 + 0.02]);
  const owl = grp(root, 0, FY + 1.0, HZ1 + 0.03);
  add(owl, geo.box(0.12, 0.14, 0.03), gold, [0, 0, 0]);
  add(owl, mb('owlEars', [[0.03, 0.04, 0.03, -0.045, 0.08, 0], [0.03, 0.04, 0.03, 0.045, 0.08, 0]]), gold);
  add(owl, mergedCyls('owlEyes', [[0.025, 0.025, 0.02, -0.03, 0.025, 0.02, HALF_PI, 0, 8], [0.025, 0.025, 0.02, 0.03, 0.025, 0.02, HALF_PI, 0, 8]]), dark);
  // portico columns in front of the shelves
  const cols = [-0.86, -0.43, 0.43, 0.86].map((x) => [x, PZ - 0.06]);
  add(root, mb('libColBases', cols.map(([x, z]) => [0.17, 0.06, 0.17, x, FY + 0.03, z])), marbleD);
  add(root, mergedTubes('libColShafts', cols.map(([x, z]) => [0.06, 0.07, HH - 0.14, x, FY + 0.06 + (HH - 0.14) / 2, z, 8])), marble);
  add(root, mergedTubes('libColCaps', cols.map(([x, z]) => [0.095, 0.065, 0.06, x, FY + HH - 0.05, z, 8])), marbleD);
  add(root, mb('libColAbaci', cols.map(([x, z]) => [0.18, 0.04, 0.18, x, FY + HH - 0.01, z])), marble);
  // entablature: architrave, team frieze with gold rosettes, cornice
  const EY = FY + HH, eZ0 = HZ0 - 0.03, eZ1 = PZ + 0.04, eL = eZ1 - eZ0, ezc = (eZ0 + eZ1) / 2;
  add(root, geo.box(2 * HX + 0.06, 0.1, eL), marble, [0, EY + 0.05, ezc]);
  add(root, geo.box(2 * HX + 0.04, 0.12, eL - 0.02), team, [0, EY + 0.16, ezc]);
  add(root, mergedDiscs('libRosettes', [-0.9, -0.45, 0, 0.45, 0.9].map((x) => [0.04, x, 0, 0, 8])), gold, [0, EY + 0.16, eZ1 + 0.001]);
  add(root, geo.box(2 * HX + 0.16, 0.07, eL + 0.1), marble, [0, EY + 0.255, ezc]);
  // roof terrace: balustrade posts and rail
  const TY = EY + 0.29, tX = HX - 0.02, tZ0 = eZ0 + 0.04, tZ1 = eZ1 - 0.02;
  const bal = [];
  for (let i = 0; i <= 6; i++) {
    const x = -tX + (2 * tX * i) / 6;
    bal.push([0.04, 0.12, 0.04, x, 0.06, tZ1], [0.04, 0.12, 0.04, x, 0.06, tZ0]);
  }
  for (let i = 1; i < 4; i++) {
    const z = tZ0 + ((tZ1 - tZ0) * i) / 4;
    bal.push([0.04, 0.12, 0.04, tX, 0.06, z], [0.04, 0.12, 0.04, -tX, 0.06, z]);
  }
  add(root, mb('libBalusters', bal), marbleD, [0, TY, 0]);
  add(root, geo.box(2 * tX - 0.04, 0.012, tZ1 - tZ0 - 0.04), mat(0xc98c62), [0, TY + 0.006, (tZ0 + tZ1) / 2]);
  add(root, mb('libRail', [[2 * tX + 0.05, 0.035, 0.06, 0, 0.13, tZ1], [2 * tX + 0.05, 0.035, 0.06, 0, 0.13, tZ0], [0.06, 0.035, tZ1 - tZ0, tX, 0.13, (tZ0 + tZ1) / 2], [0.06, 0.035, tZ1 - tZ0, -tX, 0.13, (tZ0 + tZ1) / 2]]), marble, [0, TY, 0]);
  // observatory: drum with windows, patinated dome with an observing slit, armillary sphere on top
  const dz = -0.42, DR = 0.44, DH = 0.2, DK = 0.8;
  add(root, geo.cyl(DR, DR + 0.02, DH, 16), marble, [0, TY + DH / 2, dz]);
  add(root, geo.cyl(DR + 0.04, DR + 0.04, 0.05, 16), marbleD, [0, TY + DH, dz]);
  add(root, mb('domeWins', [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const a = (i / 8) * TAU + Math.PI / 8;
    return [0.08, 0.13, 0.03, Math.sin(a) * (DR + 0.005), 0, Math.cos(a) * (DR + 0.005), a];
  })), dark, [0, TY + DH * 0.5, dz]);
  const dy = TY + DH + 0.02;
  add(root, hemi(), patina, [0, dy, dz], null, [DR, DR * DK, DR]);
  const ribs = [];
  for (let i = 0; i < 6; i++) ribs.push(i * (TAU / 6));
  for (const a of ribs) {
    const rg = grp(root, 0, dy, dz, a);
    add(rg, geo.torus(DR + 0.005, 0.018, 3, 5, HALF_PI), patinaD, [0, 0, 0], [0, HALF_PI, 0], [1, DK, 1]);
  }
  const slit = grp(root, 0, dy, dz);
  slit.rotation.x = -0.65;
  add(slit, geo.box(0.11, 0.04, 0.24), dark, [0, DR * DK - 0.03, 0.06]);
  const AY = dy + DR * DK + 0.21;
  add(root, geo.cyl(0.05, 0.08, 0.08, 8), goldD, [0, dy + DR * DK + 0.02, dz]);
  add(root, geo.cyl(0.02, 0.02, 0.06, 6), goldD, [0, dy + DR * DK + 0.08, dz]);
  const spin = grp(root, 0, AY, dz);
  armillary(spin, gold, goldD, mat(0x3f7fbf));
  add(root, geo.torus(0.19, 0.016, 3, 14), goldD, [0, AY, dz]);
  rod(root, [0.19, AY, dz], [0.05, AY - 0.18, dz], 0.012, goldD, 4);
  rod(root, [-0.19, AY, dz], [-0.05, AY - 0.18, dz], 0.012, goldD, 4);
  // team pennants on the front roof corners
  for (const s of [1, -1]) flag(root, s * (HX - 0.04), TY, tZ1 - 0.02, tc, { pole: 0.62, w: 0.36, h: 0.22, dir: -s, finial: P.gold });
  // forecourt: philosopher statue (left), sundial (right), capsa of scrolls and a bench by the steps
  const st = grp(root, 0.98, FY, 0.98, -0.3);
  add(st, geo.box(0.24, 0.3, 0.22), marbleD, [0, 0.15, 0]);
  add(st, geo.box(0.28, 0.04, 0.26), marble, [0, 0.32, 0]);
  add(st, CG.frustum(0.7), marble, [0, 0.55, 0], null, [0.2, 0.42, 0.15]);
  add(st, geo.box(0.07, 0.24, 0.06), marble, [0.1, 0.6, 0.02], [0, 0, -0.25]);
  add(st, geo.sphere(0.06, 7, 5), marble, [0, 0.82, 0.01]);
  add(st, geo.box(0.07, 0.08, 0.05), marble, [0, 0.77, 0.05]);
  add(st, geo.cyl(0.025, 0.025, 0.12, 6), mat(C.scroll), [-0.09, 0.6, 0.07], [0, 0, HALF_PI]);
  const sd = grp(root, -0.98, FY, 0.98);
  add(sd, geo.cyl(0.1, 0.12, 0.34, 8), marbleD, [0, 0.17, 0]);
  add(sd, geo.box(0.26, 0.05, 0.26), marble, [0, 0.36, 0]);
  add(sd, hemiLo(), marble, [0, 0.47, 0], [Math.PI, 0, 0], [0.12, 0.1, 0.12]);
  add(sd, geo.cyl(0.11, 0.11, 0.012, 12), mat(0xb9ad94), [0, 0.47, 0]);
  add(sd, geo.box(0.012, 0.14, 0.012), bronze, [0, 0.53, -0.02], [-0.4, 0, 0]);
  const capsa = grp(root, 0.42, FY, 1.0);
  add(capsa, geo.cyl(0.1, 0.09, 0.2, 8), mat(P.leather), [0, 0.1, 0]);
  add(capsa, geo.cyl(0.103, 0.103, 0.025, 8), mat(P.leatherDark), [0, 0.18, 0]);
  add(capsa, mergedCyls('capsaScrolls', [[0.026, 0.026, 0.14, 0.03, 0.24, 0.02, 0.2, 0.1, 6], [0.026, 0.026, 0.14, -0.035, 0.24, 0.0, -0.15, -0.1, 6], [0.026, 0.026, 0.14, 0.0, 0.25, -0.04, -0.1, 0.25, 6]]), mat(C.scroll));
  add(root, mb('libBench', [[0.5, 0.04, 0.14, 0, 0.17, 0], [0.04, 0.15, 0.12, -0.21, 0.075, 0], [0.04, 0.15, 0.12, 0.21, 0.075, 0]]), marble, [-0.42, FY, 0.98]);
  return { root, parts: { spin: [spin] }, height: 2.6, radius: 1.45 };
}

