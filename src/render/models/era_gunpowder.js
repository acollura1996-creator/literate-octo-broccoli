// Gunpowder Age (musketeer, grenadier, dragoon, field cannon) and Industrial Age (WWI rifleman, machine
// gunner, rhomboid "Landship" steam tank, field howitzer) units.
// Same conventions as ages.js: origin at ground center, facing +Z, character's weapon hand on -X,
// team color via mat(teamColor), cached geo/mat, everything casts shadows (add()).
//
// Firearms: for infantry `weapon` is the gun arm pivoted at the right shoulder; the gun rests at the
// ready, barrel along +Z and level or tilted slightly down. For vehicles / artillery `weapon` is the
// barrel group pivoted at the trunnion / mantlet (rest rotation.x = 0; artillery elevation lives in an
// inner group). Every gun carries an empty Object3D named 'muzzle' at the barrel tip, so tracers can
// start at `parts.weapon.getObjectByName('muzzle').getWorldPosition(v)` and follow the recoil.
import {
  THREE, mat, geo, P, CG, glowMat, grp, add, beam, rod, rig, legMesh, armMesh, grip, scaled, MELEE_TILT,
  fire, flag, mergedBoxes,
} from './common.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HALF_PI = Math.PI / 2;

/** Darker/lighter variant of a color. */
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();

/** Upper hemisphere (dome), radius 1, base at y=0. */
const hemi = () => geo.custom('gp:hemi10', () => new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, HALF_PI));

/** Cached merged cylinders: [[rTop, rBot, h, x, y, z, rx = 0, rz = 0, seg = 6], ...]. */
function mergedCyls(key, list) {
  return geo.custom(`gp-cyl:${key}`, () => {
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

/** Cached merged rivet heads (tiny octahedra) at [[x, y, z], ...]. */
function rivets(key, list, r = 0.016) {
  return geo.custom(`gp-rivets:${key}`, () => {
    const parts = list.map(([x, y, z]) => new THREE.OctahedronGeometry(r).translate(x, y, z));
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return g;
  });
}

/** Cylinder along +Z from z0 (back, radius rb) to z1 (front, radius rf). */
function zcyl(parent, rf, rb, z0, z1, material, seg = 8, x = 0, y = 0) {
  return add(parent, geo.cyl(rf, rb, z1 - z0, seg), material, [x, y, (z0 + z1) / 2], [HALF_PI, 0, 0]);
}

/** Cylinder along X (axle / roll), centered at (x, y, z). */
function xcyl(parent, r, len, material, x, y, z, seg = 8) {
  return add(parent, geo.cyl(r, r, len, seg), material, [x, y, z], [0, 0, HALF_PI]);
}

/** Empty marker at the barrel tip (see header). */
function muzzle(parent, x, y, z) {
  const o = new THREE.Object3D();
  o.name = 'muzzle';
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

function unitResult(r, height, radius, extra = {}) {
  return {
    root: r.root,
    parts: { body: r.body, head: r.head, legs: r.legs, arms: [{ obj: r.armL, phase: Math.PI }], weapon: r.weapon, ...extra },
    height,
    radius,
  };
}

// ---------------------------------------------------------------------------
// Posed arms + guns (all target points are given in rig-root space, rig root at the origin)
// ---------------------------------------------------------------------------
const _q = new THREE.Quaternion();

/** Root-space point -> local point of `obj`. */
function toLocal(obj, p) {
  obj.updateWorldMatrix(true, false);
  return obj.worldToLocal(new THREE.Vector3(p[0], p[1], p[2]));
}

/**
 * Two-segment arm hanging from the pivot of `g`, reaching for a root-space `target` (clamped to the arm's
 * reach). The elbow bends toward the root-space `pole` direction. Returns the local hand position.
 */
function ikArm(g, target, { upper, fore, w, upperMat, foreMat, handMat, cuffMat, bandMat, handR = w * 0.6, pole = [0, -1, -0.3] }) {
  const T = toLocal(g, target);
  const pl = new THREE.Vector3(...pole).applyQuaternion(g.getWorldQuaternion(_q).invert());
  const dir = T.clone().normalize();
  const d = Math.min(T.length(), (upper + fore) * 0.995);
  const H = dir.clone().multiplyScalar(d);
  const x = (upper * upper - fore * fore + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - x * x));
  const n = pl.sub(dir.clone().multiplyScalar(pl.dot(dir))).normalize();
  const E = dir.clone().multiplyScalar(x).addScaledVector(n, h);
  const top = E.clone().normalize().multiplyScalar(-0.02);
  beam(g, top.toArray(), E.toArray(), w, upperMat);
  if (bandMat) beam(g, top.clone().lerp(E, 0.35).toArray(), top.clone().lerp(E, 0.62).toArray(), w * 1.18, bandMat);
  add(g, geo.sphere(w * 0.56, 5, 3), upperMat, E.toArray());
  beam(g, E.toArray(), H.toArray(), w * 1.04, foreMat ?? upperMat);
  if (cuffMat) beam(g, E.clone().lerp(H, 0.6).toArray(), E.clone().lerp(H, 0.86).toArray(), w * 1.34, cuffMat);
  add(g, geo.sphere(handR, 5, 4), handMat, H.toArray());
  g.userData.ikMiss = T.length() - d; // > 0: target out of reach (debug)
  return H;
}

/** Gun group inside `weapon`: origin at the butt (root-space `butt`), barrel along root +Z tilted down by `tilt`. */
function gunMount(weapon, butt, tilt) {
  const g = new THREE.Group();
  g.position.copy(toLocal(weapon, butt));
  g.quaternion.copy(weapon.getWorldQuaternion(_q).invert().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0))));
  weapon.add(g);
  return g;
}

/** Root-space point on a gun mounted at `butt` with `tilt`: (x, y, z) in gun space. */
function onGun(butt, tilt, z, y = 0, x = 0) {
  return [butt[0] + x, butt[1] + y * Math.cos(tilt) - z * Math.sin(tilt), butt[2] + y * Math.sin(tilt) + z * Math.cos(tilt)];
}

/** Flintlock musket along +Z from the butt plate (z=0). Returns the muzzle z. */
function musketMesh(g, { len = 0.88, wood = 0x6e4022, steel = P.steelDark, brass = P.gold, sling = 0xe9e2cc, bayonet = false } = {}) {
  const W = mat(wood), S = mat(steel), B = mat(brass);
  const by = 0.026; // barrel axis height
  add(g, geo.box(0.044, 0.095, 0.17), W, [0, -0.015, 0.085], [0.08, 0, 0]); // butt
  add(g, geo.box(0.046, 0.1, 0.014), B, [0, -0.019, 0.005], [0.08, 0, 0]); // butt plate
  add(g, geo.box(0.034, 0.048, 0.13), W, [0, 0.008, 0.225]); // wrist
  add(g, geo.box(0.032, 0.036, len - 0.34), W, [0, 0.012, 0.29 + (len - 0.34) / 2]); // fore-end
  zcyl(g, 0.0135, 0.016, 0.27, len, S, 6, 0, by); // barrel
  for (const z of [0.5, len - 0.2]) add(g, geo.box(0.038, 0.05, 0.02), B, [0, by - 0.01, z]);
  add(g, geo.box(0.012, 0.03, 0.075), S, [-0.021, 0.022, 0.285]); // lock plate
  add(g, geo.box(0.01, 0.045, 0.014), S, [-0.026, 0.05, 0.26], [-0.45, 0, 0]); // cock
  add(g, geo.box(0.01, 0.03, 0.012), S, [-0.024, 0.045, 0.31]); // frizzen
  add(g, geo.box(0.012, 0.035, 0.06), B, [0, -0.026, 0.25]); // trigger guard
  beam(g, [0, -0.03, 0.14], [0, -0.07, 0.36], 0.014, mat(sling), 0.006); // sling
  beam(g, [0, -0.07, 0.36], [0, -0.012, 0.6], 0.014, mat(sling), 0.006);
  if (bayonet) {
    add(g, geo.box(0.006, 0.02, 0.24), mat(P.steelLight), [0.018, by, len + 0.1]);
    add(g, geo.cone(0.012, 0.05, 4), mat(P.steelLight), [0.018, by, len + 0.245], [HALF_PI, 0, 0], [0.5, 1, 1]);
  }
  muzzle(g, 0, by, len + 0.005);
  return len;
}

/** Low-detail long arm along +Z from the butt (slung / holstered guns). */
function slungGun(g, len, { wood = 0x6e4022, steel = P.steelDark, brass = P.gold } = {}) {
  add(g, geo.box(0.04, 0.085, 0.2), mat(wood), [0, -0.012, 0.1], [0.08, 0, 0]);
  add(g, geo.box(0.032, 0.036, len - 0.2), mat(wood), [0, 0.008, 0.2 + (len - 0.2) / 2]);
  add(g, geo.box(0.02, 0.02, len - 0.25), mat(steel), [0, 0.034, 0.25 + (len - 0.25) / 2]);
  add(g, geo.box(0.036, 0.04, 0.02), mat(brass), [0, 0.012, len * 0.6]);
}

// ---------------------------------------------------------------------------
// 18th-century line soldier (musketeer, grenadier, gunner, dragoon rider)
// ---------------------------------------------------------------------------
function soldierMats(tc, { facing = P.white, vest = 0xe2d4ac } = {}) {
  return {
    team: mat(tc), teamD: mat(shade(tc, 0.6)), face: mat(facing), vest: mat(vest), buff: mat(0xe6dbbd),
    black: mat(0x24252b), felt: mat(0x1f1f25), skin: mat(P.skin), white: mat(P.white), brass: mat(P.gold),
    leather: mat(P.leather), leatherD: mat(P.leatherDark), hair: mat(0xe9e5dc), belt: mat(0xf4f1e6),
  };
}

/** Team coat on a torso parent: tapered body, waistcoat, facing lapels, neck stock, belts, skirts. */
function coatTorso(body, M, { w0 = 0.27, d0 = 0.2, th = 0.32, cy = 0.2, k = 1.3, skirt = true, belts = 'x', sx = 0.2, sy = 0.34, lite = false } = {}) {
  add(body, CG.frustum(k), M.team, [0, cy, 0], null, [w0, th, d0]);
  const halfD = (y) => (d0 * (1 + (k - 1) * ((y - (cy - th / 2)) / th))) / 2;
  const lean = Math.atan(((k - 1) * d0) / 2 / th);
  add(body, geo.box(0.1, th * 0.9, 0.02), M.vest, [0, cy - 0.005, halfD(cy) + 0.002], [lean, 0, 0]);
  for (const s of [1, -1]) add(body, geo.box(0.045, th * 0.72, 0.022), M.face, [s * 0.073, cy + th * 0.1, halfD(cy + th * 0.1) + 0.004], [lean, 0, s * 0.06]);
  if (!lite) add(body, mergedBoxes('gp:vestButtons', [0, 1, 2, 3].map((i) => [0.018, 0.018, 0.012, 0, -0.08 + i * 0.06, 0])), M.brass, [0, cy, halfD(cy) + 0.012], [lean, 0, 0]);
  add(body, geo.cyl(0.062, 0.07, 0.05, 8), M.black, [0, cy + th / 2 + 0.02, 0.005]); // neck stock
  for (const s of [1, -1]) add(body, geo.sphere(0.078, 6, 4), M.team, [s * (sx - 0.02), sy - 0.01, 0], null, [1.05, 0.85, 1.1]);
  // facing-colored shoulder strap on the left shoulder
  if (!lite) add(body, geo.box(0.05, 0.02, 0.1), M.face, [sx - 0.06, sy + 0.035, 0], [0, 0, -0.35]);
  if (belts === 'x' || belts === 'single') {
    const yc = cy + 0.01, len = 0.44, a = 0.66;
    const list = belts === 'x' ? [a, -a] : [-a];
    for (const rz of list) {
      add(body, geo.box(0.048, len, 0.02), M.belt, [0, yc, halfD(yc) + 0.016], [lean, 0, rz]);
      add(body, geo.box(0.048, len, 0.02), M.belt, [0, yc, -halfD(yc) - 0.016], [-lean, 0, rz]);
    }
    if (belts === 'x') add(body, geo.box(0.05, 0.06, 0.02), M.brass, [0, yc, halfD(yc) + 0.03], [lean, 0, 0]);
  }
  if (skirt) {
    // long coat skirts, open at the front with facing-colored turnbacks
    add(body, CG.frustum(0.84), M.team, [0, -0.075, -0.035], null, [w0 + 0.06, 0.26, d0 + 0.02]);
    for (const s of [1, -1]) {
      add(body, geo.box(0.075, 0.2, 0.024), M.face, [s * 0.118, -0.1, 0.068], [0.08, -s * 0.35, s * 0.1]);
      if (!lite) add(body, geo.box(0.06, 0.16, 0.022), M.face, [s * 0.075, -0.1, -0.15], [-0.08, s * 0.3, 0]);
    }
    add(body, geo.box(w0 + 0.01, 0.035, d0 + 0.01), M.leatherD, [0, 0.03, 0]); // waist line
  }
}

/** Head with powdered hair and a tied queue. */
function powderedHead(head, M) {
  add(head, geo.sphere(0.094, 8, 6), M.skin, [0, 0.1, 0.016]);
  add(head, geo.box(0.026, 0.038, 0.03), mat(P.skinShade), [0, 0.088, 0.11]);
  add(head, geo.sphere(0.097, 7, 5), M.hair, [0, 0.112, -0.022], null, [1.03, 0.92, 1]);
  for (const s of [1, -1]) add(head, geo.box(0.04, 0.04, 0.065), M.hair, [s * 0.086, 0.085, -0.008]);
  add(head, geo.box(0.035, 0.09, 0.03), M.hair, [0, 0.02, -0.095], [0.25, 0, 0]);
  add(head, geo.box(0.045, 0.025, 0.035), M.black, [0, 0.055, -0.1]);
}

/** Black tricorn (front corner forward) with lace edging and a team cockade. Origin at the brim. */
function tricorn(head, y, M, { lace = M.belt, cockade = M.team, size = 1 } = {}) {
  const g = grp(head, 0, y, -0.008);
  g.scale.setScalar(size);
  add(g, geo.cyl(0.082, 0.094, 0.08, 8), M.felt, [0, 0.04, 0]);
  add(g, geo.cyl(0.16, 0.16, 0.02, 3), M.felt, [0, 0.005, 0]);
  const ri = 0.08, side = 0.27, h = 0.075, tilt = 0.32;
  const sides = [], laces = [];
  for (const a of [Math.PI / 3, Math.PI, -Math.PI / 3]) {
    const rr = ri + Math.sin(tilt) * h * 0.5;
    sides.push([side, h, 0.022, Math.sin(a) * rr, Math.cos(tilt) * h * 0.5, Math.cos(a) * rr, a, tilt]);
    const rt = ri + Math.sin(tilt) * h;
    laces.push([side + 0.01, 0.016, 0.03, Math.sin(a) * rt, Math.cos(tilt) * h, Math.cos(a) * rt, a, tilt]);
  }
  add(g, mergedBoxes('gp:tricornSides', sides), M.felt);
  add(g, mergedBoxes('gp:tricornLace', laces), lace);
  const ca = Math.PI / 3; // cockade on the left front face
  const ck = grp(g, Math.sin(ca) * 0.114, 0.04, Math.cos(ca) * 0.114, ca);
  add(ck, geo.cyl(0.03, 0.03, 0.014, 6), cockade, [0, 0, 0], [HALF_PI + tilt, 0, 0]);
  return g;
}

/** Breeches + black gaiters + rig (+ optional torso twist for gun holders). */
function lineSoldier(tc, { L = 0.37, hipW = 0.075, sx = 0.2, sy = 0.34, neckY = 0.42, yaw = 0, belts = 'x', facing, lite = false } = {}) {
  const r = rig({ legLen: L, hipW, shoulderX: sx, shoulderY: sy, neckY });
  const M = soldierMats(tc, { facing });
  for (const l of r.legs) {
    legMesh(l.obj, L, 0.094, M.buff, M.black, { bootH: 0.56, toe: 0.28 });
    if (!lite) add(l.obj, geo.box(0.112, 0.022, 0.12), M.black, [0, -L * 0.42, 0.004]); // gaiter top
  }
  coatTorso(r.body, M, { belts, sx, sy, lite });
  powderedHead(r.head, M);
  if (yaw) {
    r.body.rotation.y = yaw;
    r.head.rotation.y = -yaw;
  }
  return { r, M };
}

const COAT_ARM = (M, extra = {}) => ({ upper: 0.17, fore: 0.19, w: 0.074, upperMat: M.team, foreMat: M.team, handMat: M.skin, cuffMat: M.face, ...extra });

// Gunpowder Age line infantry: tricorn, team coat with white cross-belts, flintlock musket at the ready.
export function musketeer(tc) {
  const yaw = -0.35;
  const { r, M } = lineSoldier(tc, { yaw });
  tricorn(r.head, 0.165, M);
  // cartridge box (back right) + bayonet scabbard (left hip)
  add(r.body, geo.box(0.12, 0.075, 0.06), M.black, [-0.08, 0.02, -0.13]);
  add(r.body, geo.box(0.04, 0.04, 0.012), M.brass, [-0.08, 0.025, -0.162]);
  add(r.body, geo.box(0.025, 0.2, 0.03), M.black, [0.15, -0.06, -0.06], [-0.35, 0, 0.1]);
  // musket at the ready, butt against the chest
  const butt = [0.0, 0.625, 0.07], tilt = 0.06;
  const gun = gunMount(r.weapon, butt, tilt);
  musketMesh(gun);
  ikArm(r.weapon, onGun(butt, tilt, 0.17, -0.02, -0.01), { ...COAT_ARM(M), pole: [-0.6, -1, -0.2] });
  ikArm(r.armL, onGun(butt, tilt, 0.33, -0.03, 0.014), { ...COAT_ARM(M), fore: 0.22, pole: [0.7, -1, 0] });
  scaled(r, 1.08);
  return unitResult(r, 1.18, 0.4);
}

/** Tall mitre front plate: width 1, height 1, thickness 1, base at y=0, face toward +Z. */
const mitreGeo = () =>
  geo.custom('gp:mitre', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.5, 0);
    s.lineTo(0.5, 0);
    s.lineTo(0.4, 0.55);
    s.quadraticCurveTo(0.26, 0.92, 0, 1);
    s.quadraticCurveTo(-0.26, 0.92, -0.4, 0.55);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 3 });
    g.translate(0, 0, -0.5);
    return g;
  });

/** Round black bomb with a brass fuse socket. */
function bomb(parent, x, y, z, r = 0.05) {
  add(parent, geo.sphere(r, 7, 5), mat(0x2a2b31), [x, y, z]);
  add(parent, geo.cyl(r * 0.32, r * 0.36, r * 0.4, 5), mat(P.gold), [x, y + r * 0.98, z]);
}

// Gunpowder Age grenadier: tall team mitre cap, coat, satchel of bombs, lobs a lit bomb underarm.
export function grenadier(tc) {
  const { r, M } = lineSoldier(tc, { sx: 0.21, facing: 0xf2e6c4 });
  // mitre cap: team front plate with brass rim and badge, cloth back, white pompom
  const cap = grp(r.head, 0, 0.15, -0.01);
  cap.rotation.x = -0.1;
  add(cap, mitreGeo(), M.brass, [0, -0.005, 0.07], null, [0.215, 0.33, 0.02]);
  add(cap, mitreGeo(), M.team, [0, 0.005, 0.082], null, [0.19, 0.3, 0.02]);
  add(cap, geo.box(0.2, 0.05, 0.02), M.face, [0, 0.03, 0.094]); // front flap
  add(cap, geo.sphere(0.032, 6, 4), M.brass, [0, 0.15, 0.095], null, [1, 1, 0.5]); // grenade badge
  add(cap, geo.cone(0.022, 0.05, 4), M.brass, [0, 0.19, 0.095], null, [1, 1, 0.5]);
  add(cap, CG.frustum(0.3), M.teamD, [0, 0.12, -0.005], [0.05, 0, 0], [0.17, 0.25, 0.16]);
  add(cap, geo.sphere(0.034, 6, 4), M.white, [0, 0.3, 0.06]);
  // grenade satchel on the left hip, slung from the right shoulder (the X belts), bombs peeking out
  const sat = grp(r.body, 0.17, -0.02, 0.04);
  sat.rotation.y = 0.35;
  add(sat, geo.box(0.07, 0.13, 0.17), M.leather, [0, 0, 0]);
  add(sat, geo.box(0.075, 0.06, 0.175), M.leatherD, [0, 0.045, 0]);
  add(sat, geo.sphere(0.025, 6, 4), M.brass, [0.04, 0.02, 0], null, [0.4, 1, 1]);
  for (const [z, s] of [[-0.045, 0.042], [0.035, 0.04]]) bomb(sat, 0, 0.085, z, s);
  // slung musket on the back
  const sl = grp(r.body, 0.0, 0.17, -0.165);
  sl.rotation.z = -0.5;
  const sl2 = grp(sl, 0, 0, 0);
  sl2.rotation.x = -HALF_PI;
  slungGun(grp(sl2, 0, 0, -0.42), 0.8);
  // arms: off hand on the satchel strap, weapon hand holding a lit bomb low for an underarm lob
  const armOpt = { upper: 0.15, fore: 0.15, w: 0.074, upperMat: M.team, foreMat: M.team, handMat: M.skin };
  const handL = armMesh(r.armL, { ...armOpt, bend: 0.55 });
  add(handL, geo.box(0.09, 0.03, 0.09), M.face, [0, 0.07, -0.03], [-0.55, 0, 0]);
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.85 });
  add(r.weapon, geo.box(0.09, 0.035, 0.09), M.face, [0, -0.15 - Math.cos(0.85) * 0.09, Math.sin(0.85) * 0.09], [-0.85, 0, 0]);
  const b = grp(hand, 0, -0.02, 0.05);
  bomb(b, 0, 0, 0, 0.06);
  rod(b, [0, 0.07, 0], [0.012, 0.11, 0.022], 0.007, mat(0xd8c89a), 4);
  const spark = fire(b, 0.014, 0.105, 0.025, 0.09);
  const glow = add(b, geo.sphere(0.018, 5, 4), glowMat(0xffe27a, 1.4), [0.014, 0.11, 0.025]);
  glow.castShadow = false;
  scaled(r, 1.04);
  return unitResult(r, 1.25, 0.4, { fire: [spark], glow: [glow] });
}

// ---------------------------------------------------------------------------
// Horses (same construction as ages.js)
// ---------------------------------------------------------------------------
/** Horse leg pivot groups (hip at y = LL). defs: [x, z, phase]. */
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
  add(hg, geo.box(0.125, 0.12, 0.1), dark, [0, -0.012, 0.16]);
  if (blaze) add(hg, geo.box(0.04, 0.012, 0.24), blaze, [0, 0.075, 0.03]);
  for (const s of [1, -1]) add(hg, geo.cone(0.025, 0.08, 4), coat, [s * 0.045, 0.1, -0.13], [-0.3, 0, 0]);
  return hg;
}

// Gunpowder Age mounted infantry: tricorn, team coat, saber; bay horse with a laced team shabraque,
// pistol holsters, rolled cloak and a carbine in its saddle bucket.
export function dragoon(tc) {
  const root = new THREE.Group();
  const M = soldierMats(tc);
  const coat = mat(0x6a4126), coatD = mat(0x24170f), hoof = mat(0x2a221c), white = mat(0xeee6d8);
  const lace = mat(P.gold);
  const legs = horseLegs(root, 0.68, [[0.14, 0.4, 0], [-0.14, -0.42, 0], [-0.14, 0.4, Math.PI], [0.14, -0.42, Math.PI]], {
    upper: [0.11, 0.42, 0.135], lower: [0.08, 0.27, 0.088], hoofSize: [0.1, 0.065, 0.115],
    coat, sock: white, hoof, amp: 0.6,
  });
  const body = grp(root, 0, 0.92, 0);
  add(body, geo.box(0.36, 0.36, 1.0), coat, [0, 0, 0]);
  add(body, geo.box(0.32, 0.3, 0.2), coat, [0, -0.01, 0.46]); // chest
  add(body, geo.box(0.38, 0.32, 0.26), coat, [0, 0.03, -0.42]); // rump
  // team shabraque with gold lace border and cyphers
  add(body, geo.box(0.44, 0.3, 0.6), M.team, [0, 0.03, -0.1]);
  add(body, geo.box(0.445, 0.04, 0.605), lace, [0, -0.115, -0.1]);
  add(body, geo.box(0.445, 0.3, 0.035), lace, [0, 0.03, -0.39]);
  for (const s of [1, -1]) add(body, geo.box(0.02, 0.08, 0.08), lace, [s * 0.225, -0.04, -0.3], [Math.PI / 4, 0, 0]);
  // saddle, pistol holsters (team caps), rolled cloak
  add(body, geo.box(0.27, 0.07, 0.34), M.leatherD, [0, 0.2, -0.06]);
  add(body, geo.box(0.22, 0.1, 0.05), M.leatherD, [0, 0.25, -0.22]);
  for (const s of [1, -1]) {
    add(body, geo.box(0.07, 0.07, 0.2), M.leatherD, [s * 0.14, 0.16, 0.2], [-0.45, 0, -s * 0.25]);
    add(body, geo.cyl(0.056, 0.05, 0.08, 5), M.team, [s * 0.15, 0.2, 0.25], [1.1, 0, -s * 0.25]);
  }
  add(body, geo.cyl(0.06, 0.06, 0.38, 7), M.teamD, [0, 0.25, -0.32], [0, 0, HALF_PI]); // rolled cloak
  add(body, geo.box(0.03, 0.13, 0.13), M.leatherD, [0, 0.25, -0.32]);
  // neck, mane, head with bridle, tail
  add(body, geo.box(0.17, 0.48, 0.23), coat, [0, 0.27, 0.46], [0.6, 0, 0]);
  add(body, geo.box(0.05, 0.46, 0.07), coatD, [0, 0.35, 0.37], [0.6, 0, 0]);
  const hg = horseHead(body, 0, 0.48, 0.7, { coat, dark: coatD, size: 1.12, blaze: white });
  add(hg, geo.box(0.15, 0.025, 0.03), M.leatherD, [0, 0.03, -0.06]);
  add(hg, geo.box(0.135, 0.025, 0.03), M.leatherD, [0, -0.02, 0.13]);
  add(body, geo.box(0.08, 0.42, 0.08), coatD, [0, -0.07, -0.58], [-0.45, 0, 0]);
  // rider: buff breeches, black jackboots
  for (const s of [1, -1]) {
    add(body, geo.box(0.1, 0.1, 0.28), M.buff, [s * 0.18, 0.22, 0.03], [0.2, 0, 0]);
    add(body, geo.box(0.1, 0.3, 0.12), M.black, [s * 0.235, 0.07, 0.15]);
    add(body, geo.box(0.125, 0.075, 0.145), M.black, [s * 0.235, 0.205, 0.15]);
    add(body, geo.box(0.11, 0.05, 0.17), M.black, [s * 0.235, -0.065, 0.18]);
  }
  // carbine hanging in its bucket on the right side
  const cb = grp(body, -0.25, 0.08, -0.2);
  cb.rotation.x = 2.2;
  slungGun(cb, 0.6);
  add(cb, geo.box(0.06, 0.07, 0.12), M.leatherD, [0, 0.01, 0.52]);
  const rider = grp(body, 0, 0.25, -0.06);
  coatTorso(rider, M, { belts: 'single', skirt: false, sx: 0.19, sy: 0.33 });
  add(rider, geo.box(0.28, 0.035, 0.21), M.leatherD, [0, 0.04, 0]);
  // coat skirts spread over the horse's back
  add(rider, geo.box(0.3, 0.04, 0.24), M.team, [0, 0.0, -0.18], [-0.25, 0, 0]);
  for (const s of [1, -1]) add(rider, geo.box(0.07, 0.042, 0.2), M.face, [s * 0.12, 0.004, -0.18], [-0.25, 0, 0]);
  add(rider, geo.box(0.06, 0.022, 0.1), lace, [-0.15, 0.37, 0], [0, 0, 0.35]); // epaulette
  const head = grp(rider, 0, 0.41, 0);
  powderedHead(head, M);
  tricorn(head, 0.165, M, { lace });
  const armOpt = { upper: 0.14, fore: 0.14, w: 0.074, upperMat: M.team, foreMat: M.team, handMat: mat(0xe8dcc0) };
  const armL = grp(rider, 0.19, 0.33, 0);
  armMesh(armL, { ...armOpt, bend: 1.05 });
  add(body, geo.box(0.02, 0.02, 0.36), M.leatherD, [0.04, 0.38, 0.36], [-0.5, 0, 0.2]); // reins
  const weapon = grp(rider, -0.19, 0.33, 0);
  const hand = armMesh(weapon, { ...armOpt, bend: 0.8 });
  for (const [ag, b] of [[armL, 1.05], [weapon, 0.8]]) {
    add(ag, geo.box(0.09, 0.035, 0.09), M.face, [0, -0.14 - Math.cos(b) * 0.1, Math.sin(b) * 0.1], [-b, 0, 0]);
  }
  // cavalry saber: brass stirrup hilt, curved blade
  const g = grip(hand, MELEE_TILT);
  add(g, geo.cyl(0.016, 0.016, 0.11, 5), M.leatherD, [0, 0, 0]);
  add(g, geo.sphere(0.022, 5, 4), M.brass, [0, -0.065, 0]);
  add(g, geo.box(0.1, 0.02, 0.03), M.brass, [0, 0.06, 0]);
  add(g, geo.box(0.012, 0.13, 0.014), M.brass, [-0.04, -0.005, 0], [0, 0, -0.1]);
  add(g, CG.curvedBlade(), mat(P.steelLight), [0.0, 0.065, 0], null, [0.95, 0.64, 1.2]);
  return {
    root,
    parts: { body, head, legs, arms: [{ obj: armL, phase: Math.PI }], weapon },
    height: 2.0,
    radius: 0.6,
  };
}

// ---------------------------------------------------------------------------
// Artillery
// ---------------------------------------------------------------------------
/** Spoked wheel group (axle along X). Origin at the hub. */
function spokedWheel(parent, x, y, z, { r, width = 0.06, spokes = 12, rimMat, tireMat, spokeMat, hubMat, capMat, key }) {
  const g = grp(parent, x, y, z);
  add(g, geo.torus(r - 0.032, 0.03, 4, 12), rimMat, [0, 0, 0], [0, HALF_PI, 0], [1, 1, width / 0.06]);
  add(g, geo.torus(r - 0.008, 0.012, 3, 12), tireMat, [0, 0, 0], [0, HALF_PI, 0], [1, 1, (width / 0.024) * 0.95]);
  const hubR = r * 0.18, len = r - 0.05 - hubR * 0.6;
  const boxes = [];
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const c = hubR * 0.6 + len / 2;
    boxes.push([width * 0.45, len, 0.03, 0, Math.cos(a) * c, Math.sin(a) * c, 0, a]);
  }
  add(g, mergedBoxes(`gp:spokes${key}`, boxes), spokeMat);
  xcyl(g, hubR, width * 2.2, hubMat, 0, 0, 0, 8);
  if (capMat) xcyl(g, hubR * 0.62, width * 2.6, capMat, 0, 0, 0, 6);
  return g;
}

// Gunpowder Age field cannon: bronze barrel on a team-painted bracket-trail carriage, a gunner with a rammer.
export function cannon(tc) {
  const root = new THREE.Group();
  const team = mat(tc), teamD = mat(shade(tc, 0.62)), wood = mat(P.wood), woodD = mat(P.woodDark), iron = mat(P.iron);
  const bronze = mat(0xc28b45), bronzeD = mat(0x9a6430), black = mat(0x1b1b20);
  const AX = 0.36;
  const wheels = [];
  for (const s of [1, -1]) {
    wheels.push(spokedWheel(root, s * 0.43, AX, 0.02, {
      r: AX, width: 0.06, spokes: 8, rimMat: wood, tireMat: iron, spokeMat: mat(P.woodLight), hubMat: woodD, capMat: iron, key: 'cannon',
    }));
  }
  add(root, geo.box(0.74, 0.1, 0.12), teamD, [0, AX, 0.02]); // axle tree
  // bracket trail: two team-painted cheeks converging to the trail eye, iron straps
  for (const s of [1, -1]) {
    beam(root, [s * 0.14, 0.47, 0.18], [s * 0.065, 0.1, -1.0], 0.06, team, 0.17);
    add(root, geo.box(0.065, 0.2, 0.38), team, [s * 0.14, 0.53, 0.06]); // trunnion bracket
    add(root, geo.box(0.07, 0.025, 0.1), iron, [s * 0.14, 0.64, 0.06]); // cap square
    for (const k of [0.35, 0.7]) {
      const p = [s * (0.14 - 0.075 * k), 0.47 - 0.37 * k, 0.18 - 1.18 * k];
      add(root, geo.box(0.075, 0.19, 0.035), iron, p, [-0.3, s * 0.06, 0]);
    }
  }
  for (const [z, y, w] of [[-0.18, 0.4, 0.24], [-0.55, 0.27, 0.17]]) add(root, geo.box(w, 0.09, 0.1), teamD, [0, y, z]);
  add(root, geo.box(0.22, 0.05, 0.14), iron, [0, 0.07, -1.0]); // trail plate
  add(root, geo.torus(0.04, 0.012, 3, 6), iron, [0, 0.1, -1.08], [HALF_PI, 0, 0]);
  rod(root, [0.0, 0.1, -0.95], [0.0, 0.42, -1.18], 0.018, mat(P.woodLight), 5); // handspike
  // elevating quoin under the breech + ammo chest with shot on the trail
  add(root, geo.box(0.14, 0.06, 0.24), woodD, [0, 0.48, -0.32], [0.18, 0, 0]);
  add(root, geo.box(0.2, 0.12, 0.18), woodD, [0, 0.35, -0.68]);
  add(root, geo.box(0.21, 0.03, 0.19), team, [0, 0.42, -0.68]);
  for (const [x, y, z] of [[-0.055, 0.47, -0.64], [0.055, 0.47, -0.64], [0, 0.47, -0.73], [0, 0.55, -0.67]]) add(root, geo.sphere(0.05, 6, 4), black, [x, y, z]);
  // barrel (weapon) on the trunnions
  const weapon = grp(root, 0, 0.64, 0.06);
  const el = grp(weapon, 0, 0, 0);
  el.rotation.x = -0.05;
  zcyl(el, 0.112, 0.118, -0.36, -0.31, bronzeD, 8);
  zcyl(el, 0.104, 0.112, -0.31, 0.06, bronze, 8);
  zcyl(el, 0.108, 0.108, 0.04, 0.08, bronzeD, 8);
  zcyl(el, 0.078, 0.097, 0.08, 0.6, bronze, 8);
  zcyl(el, 0.086, 0.086, 0.33, 0.36, bronzeD, 8);
  zcyl(el, 0.094, 0.08, 0.6, 0.66, bronzeD, 8);
  zcyl(el, 0.088, 0.094, 0.66, 0.72, bronze, 8);
  zcyl(el, 0.046, 0.046, 0.715, 0.724, black, 8);
  add(el, geo.sphere(0.045, 6, 5), bronzeD, [0, 0, -0.44]);
  zcyl(el, 0.025, 0.035, -0.42, -0.36, bronzeD, 6);
  xcyl(el, 0.032, 0.36, bronzeD, 0, -0.015, 0, 8); // trunnions
  for (const z of [-0.04, 0.1]) add(el, geo.torus(0.03, 0.011, 3, 6, Math.PI), bronzeD, [0, 0.1, z], [0, HALF_PI, 0]);
  add(el, geo.box(0.014, 0.03, 0.02), bronzeD, [0, 0.11, -0.27]); // vent
  muzzle(el, 0, 0, 0.73);
  // gunner with a rammer (static)
  const gun = gunner(tc);
  gun.position.set(0.64, 0, -0.42);
  gun.rotation.y = -0.45;
  root.add(gun);
  return { root, parts: { wheels, weapon }, height: 0.95, radius: 0.75 };
}

/** Static artillery crewman (tricorn, team coat) holding a rammer upright. Returns his root group. */
function gunner(tc) {
  const { r, M } = lineSoldier(tc, { belts: 'single', lite: true });
  tricorn(r.head, 0.165, M);
  const g = new THREE.Group();
  const a = [-0.05, 0.02, 0.22], b = [-0.14, 1.12, -0.04];
  rod(r.root, a, b, 0.014, mat(P.woodLight), 5);
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const head = add(r.root, geo.cyl(0.04, 0.04, 0.08, 7), mat(P.woodLight), at(0.98));
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  add(r.root, geo.sphere(0.05, 6, 4), mat(0x3d3a33), at(0.02), null, [1, 0.7, 1]); // sponge
  ikArm(r.weapon, at(0.62), { ...COAT_ARM(M), cuffMat: null, pole: [-0.6, -1, -0.3] });
  ikArm(r.armL, at(0.48), { ...COAT_ARM(M), cuffMat: null, pole: [0.6, -1, -0.2] });
  r.root.scale.setScalar(0.9);
  g.add(r.root);
  return g;
}

// ---------------------------------------------------------------------------
// WWI soldier (rifleman, machine gunner)
// ---------------------------------------------------------------------------
function wwiMats(tc) {
  return {
    team: mat(tc), teamD: mat(shade(tc, 0.6)), coat: mat(0x7d6d48), coatD: mat(0x655739), web: mat(0xbcae80),
    puttee: mat(0x5e5236), boot: mat(0x4a3220), jerkin: mat(0x8e6038), jerkinD: mat(0x5a3b22), helmet: mat(0x5c6142), helmetD: mat(0x474b33), skin: mat(P.skin),
    brass: mat(P.gold), steel: mat(P.steelDark), black: mat(0x24252b),
  };
}

/** Greatcoat soldier with puttees, webbing, small pack and team shoulder boards / collar / helmet band. */
function wwiSoldier(tc, { L = 0.37, hipW = 0.078, sx = 0.2, sy = 0.34, neckY = 0.42, yaw = 0, bulk = 1, jerkin = false } = {}) {
  const r = rig({ legLen: L, hipW, shoulderX: sx, shoulderY: sy, neckY });
  const M = wwiMats(tc);
  const lw = 0.096 * bulk;
  for (const l of r.legs) {
    add(l.obj, geo.box(lw, L * 0.58, lw * 1.05), M.coatD, [0, -L * 0.29, 0]);
    add(l.obj, geo.box(lw * 0.98, L * 0.42, lw), M.puttee, [0, -L * 0.62, 0]);
    for (const y of [0.58, 0.7]) add(l.obj, geo.box(lw * 1.08, 0.016, lw * 1.08), M.coatD, [0, -L * y, 0], [0, 0, 0.28]);
    add(l.obj, geo.box(lw * 1.12, 0.065, lw * 1.7), M.boot, [0, -L + 0.0325, lw * 0.3]);
  }
  const w0 = 0.28 * bulk, d0 = 0.21 * bulk, th = 0.32, cy = 0.2, k = 1.28;
  add(r.body, CG.frustum(k), M.coat, [0, cy, 0], null, [w0, th, d0]);
  const halfD = (y) => (d0 * (1 + (k - 1) * ((y - (cy - th / 2)) / th))) / 2;
  const lean = Math.atan(((k - 1) * d0) / 2 / th);
  const buttons = mergedBoxes('gp:coatButtons', [0, 1, 2].flatMap((i) => [[0.018, 0.018, 0.012, 0.055, i * 0.075, 0], [0.018, 0.018, 0.012, -0.055, i * 0.075, 0]]));
  if (jerkin) {
    // short tunic skirt + sleeveless leather jerkin
    add(r.body, CG.frustum(0.92), M.coat, [0, -0.03, 0], null, [w0 + 0.03, 0.12, d0 + 0.03]);
    add(r.body, CG.frustum(1.12), M.jerkin, [0, cy - 0.015, 0], null, [w0 + 0.035, th - 0.03, d0 + 0.035]);
    add(r.body, geo.box(0.014, th - 0.04, 0.012), M.jerkinD, [0, cy - 0.01, halfD(cy) + 0.016], [lean, 0, 0]);
    add(r.body, buttons, M.brass, [0, cy, halfD(cy) + 0.018], [lean, 0, 0]);
  } else {
    add(r.body, CG.frustum(0.8), M.coat, [0, -0.1, -0.012], null, [w0 + 0.07, 0.3, d0 + 0.05]); // greatcoat skirt
    add(r.body, geo.box(0.02, 0.28, 0.02), M.coatD, [0, -0.11, halfD(0.05) + 0.03], [-0.12, 0, 0]); // front split
    add(r.body, buttons, M.brass, [0, cy, halfD(cy) + 0.004], [lean, 0, 0]);
  }
  // webbing: belt, ammo pouches, braces, small pack with a team blanket roll, water bottle
  add(r.body, geo.box(w0 + 0.035, 0.045, d0 + 0.035), M.web, [0, 0.055, 0]);
  for (const s of [1, -1]) {
    add(r.body, geo.box(0.07, 0.08, 0.04), M.web, [s * 0.085, 0.1, halfD(0.1) + 0.025], [lean, 0, 0]);
    if (jerkin) continue;
    add(r.body, geo.box(0.03, 0.3, 0.015), M.web, [s * 0.075, 0.24, halfD(0.24) + 0.008], [lean, 0, 0]);
    add(r.body, geo.box(0.03, 0.3, 0.015), M.web, [s * 0.075, 0.24, -halfD(0.24) - 0.008], [-lean, 0, 0]);
  }
  if (!jerkin) {
    add(r.body, geo.box(0.2 * bulk, 0.17, 0.08), M.web, [0, 0.24, -halfD(0.24) - 0.045]);
    xcyl(r.body, 0.042, 0.24 * bulk, M.team, 0, 0.35, -halfD(0.3) - 0.05, 7);
    for (const x of [-0.07, 0.07]) xcyl(r.body, 0.045, 0.018, M.web, x, 0.35, -halfD(0.3) - 0.05, 7);
  }
  add(r.body, geo.cyl(0.035, 0.035, 0.1, 6), mat(0x4a5a3a), [-0.15 * bulk, 0.0, -0.06]);
  add(r.body, geo.box(0.09, 0.1, 0.06), M.web, [0.13 * bulk, 0.0, 0.07]); // gas-mask bag
  // collar with team tabs, team shoulder boards
  add(r.body, CG.frustum(0.82), M.coat, [0, cy + th / 2 + 0.02, 0.0], null, [0.17, 0.06, 0.15]);
  for (const s of [1, -1]) {
    add(r.body, geo.box(0.035, 0.03, 0.02), M.team, [s * 0.05, cy + th / 2 + 0.015, 0.072], [0, s * 0.5, 0]);
    add(r.body, geo.sphere(0.08 * bulk, 6, 4), M.coat, [s * (sx - 0.02), sy - 0.01, 0], null, [1.05, 0.85, 1.1]);
    add(r.body, geo.box(0.11 * bulk, 0.03, 0.14 * bulk), M.team, [s * (sx - 0.04), sy + 0.062, 0], [0, 0, -s * 0.3]);
    add(r.body, geo.box(0.02, 0.035, 0.145 * bulk), M.brass, [s * (sx + 0.012), sy + 0.045, 0], [0, 0, -s * 0.3]);
  }
  // head + Brodie helmet: olive brim and band, team-painted crown (reads from the RTS camera)
  add(r.head, geo.sphere(0.093, 8, 6), M.skin, [0, 0.1, 0.016]);
  add(r.head, geo.box(0.026, 0.038, 0.03), mat(P.skinShade), [0, 0.088, 0.108]);
  add(r.head, geo.box(0.1, 0.05, 0.08), mat(0x5a4632), [0, 0.11, -0.06]); // hair at the back
  add(r.head, geo.cyl(0.165, 0.17, 0.018, 12), M.helmet, [0, 0.15, -0.005]);
  add(r.head, hemi(), M.team, [0, 0.155, -0.005], null, [0.112, 0.088, 0.112]);
  add(r.head, geo.cyl(0.114, 0.116, 0.025, 10), M.helmetD, [0, 0.172, -0.005]);
  add(r.head, geo.box(0.17, 0.012, 0.012), M.web, [0, 0.03, 0.04]); // chin strap
  if (yaw) {
    r.body.rotation.y = yaw;
    r.head.rotation.y = -yaw;
  }
  return { r, M };
}

const WWI_ARM = (M, extra = {}) => ({ upper: 0.17, fore: 0.19, w: 0.076, upperMat: M.coat, foreMat: M.coat, handMat: M.skin, cuffMat: M.coatD, ...extra });

/** Bolt-action rifle along +Z from the butt; optional fixed bayonet. Returns the muzzle z. */
function rifleMesh(g, M, { len = 0.84, bayonet = true } = {}) {
  const wood = mat(0x7a4a26), woodL = mat(0x91603a), steel = mat(0x3a3d44);
  const by = 0.022;
  add(g, geo.box(0.04, 0.085, 0.2), wood, [0, -0.018, 0.1], [0.12, 0, 0]);
  add(g, geo.box(0.042, 0.088, 0.012), steel, [0, -0.026, 0.004], [0.12, 0, 0]);
  add(g, geo.box(0.032, 0.05, 0.1), wood, [0, 0.0, 0.24]);
  add(g, geo.box(0.034, 0.04, 0.16), steel, [0, 0.022, 0.34]); // receiver
  add(g, geo.box(0.05, 0.012, 0.012), steel, [-0.03, 0.03, 0.31], [0, 0, -0.35]); // bolt handle
  add(g, geo.sphere(0.012, 5, 4), steel, [-0.055, 0.02, 0.31]);
  add(g, geo.box(0.028, 0.06, 0.07), steel, [0, -0.025, 0.36]); // magazine
  add(g, geo.box(0.036, 0.05, len - 0.46), woodL, [0, 0.015, 0.42 + (len - 0.46) / 2]); // handguard
  add(g, geo.box(0.03, 0.035, 0.05), steel, [0, by, len - 0.06]); // nose cap
  zcyl(g, 0.011, 0.012, len - 0.1, len, steel, 6, 0, by);
  add(g, geo.box(0.012, 0.022, 0.014), steel, [0, by + 0.02, len - 0.04]); // front sight
  beam(g, [0, -0.04, 0.15], [0, -0.075, 0.45], 0.016, M.web, 0.006); // sling
  beam(g, [0, -0.075, 0.45], [0, -0.006, 0.7], 0.016, M.web, 0.006);
  if (bayonet) {
    add(g, geo.box(0.014, 0.03, 0.06), steel, [0, by - 0.022, len - 0.02]);
    add(g, geo.box(0.006, 0.022, 0.2), mat(P.steelLight), [0, by - 0.02, len + 0.1]);
    add(g, geo.cone(0.011, 0.045, 4), mat(P.steelLight), [0, by - 0.02, len + 0.22], [HALF_PI, 0, 0], [0.5, 1, 1]);
  }
  muzzle(g, 0, by, len + 0.005);
  return len;
}

// Industrial Age (WWI) infantry: Brodie helmet, greatcoat, puttees, bolt-action rifle with fixed bayonet.
export function rifleman(tc) {
  const yaw = -0.35;
  const { r, M } = wwiSoldier(tc, { yaw });
  const butt = [0.0, 0.625, 0.07], tilt = 0.06;
  const gun = gunMount(r.weapon, butt, tilt);
  rifleMesh(gun, M);
  ikArm(r.weapon, onGun(butt, tilt, 0.19, -0.025, -0.01), { ...WWI_ARM(M), fore: 0.21, pole: [-0.6, -1, -0.2] });
  ikArm(r.armL, onGun(butt, tilt, 0.36, -0.03, 0.014), { ...WWI_ARM(M), fore: 0.23, bandMat: M.team, pole: [0.7, -1, 0] });
  scaled(r, 1.08);
  return unitResult(r, 1.18, 0.4);
}

/** Belt-fed, water-cooled machine gun along +Z from the butt. Returns muzzle z. */
function machineGunMesh(g, M) {
  const steel = mat(0x3a3d44), steelL = mat(0x5a5f68), wood = mat(0x7a4a26), brass = mat(0xd8a640);
  add(g, geo.box(0.04, 0.08, 0.15), wood, [0, -0.025, 0.075], [0.1, 0, 0]); // stock
  add(g, geo.box(0.035, 0.08, 0.035), wood, [0, -0.07, 0.17], [0.3, 0, 0]); // pistol grip
  add(g, geo.box(0.085, 0.095, 0.22), steel, [0, 0.01, 0.25]); // receiver
  add(g, geo.box(0.09, 0.02, 0.2), steelL, [0, 0.065, 0.25]); // top cover
  add(g, geo.box(0.04, 0.025, 0.06), steel, [0, -0.04, 0.2]); // trigger
  zcyl(g, 0.056, 0.056, 0.35, 0.78, steelL, 8, 0, 0.012); // water jacket
  for (const z of [0.36, 0.74]) zcyl(g, 0.062, 0.062, z, z + 0.03, steel, 8, 0, 0.012);
  zcyl(g, 0.025, 0.04, 0.78, 0.84, steel, 8, 0, 0.012); // muzzle booster
  zcyl(g, 0.016, 0.016, 0.84, 0.86, mat(0x18181c), 6, 0, 0.012);
  add(g, mergedBoxes('gp:mgHandle', [[0.022, 0.022, 0.15, 0, 0.115, 0.44], [0.022, 0.06, 0.022, 0, 0.09, 0.37], [0.022, 0.06, 0.022, 0, 0.09, 0.51]]), steel);
  // ammo belt: from the feed block on the left of the receiver, looping down into the team ammo box
  const pts = [[0.045, 0.03, 0.3], [0.085, 0.075, 0.33], [0.125, 0.06, 0.31], [0.13, 0.03, 0.27]];
  const carts = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    for (let t = 0; t < 1; t += 0.25) {
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      carts.push([0.022, 0.016, 0.07, p[0], p[1], p[2]]);
    }
  }
  add(g, mergedBoxes('gp:mgBelt', carts), brass);
  for (let i = 0; i < pts.length - 1; i++) beam(g, pts[i], pts[i + 1], 0.028, mat(0x8a7a50), 0.012);
  add(g, geo.box(0.09, 0.13, 0.17), M.team, [0.11, -0.04, 0.23]);
  add(g, geo.box(0.095, 0.025, 0.175), M.coatD, [0.11, 0.03, 0.23]);
  add(g, geo.box(0.06, 0.02, 0.02), steel, [0.11, 0.05, 0.23]);
  muzzle(g, 0, 0.012, 0.865);
  return 0.865;
}

// Industrial Age machine gunner: bulkier soldier firing a water-cooled belt-fed MG from the hip.
export function machine_gunner(tc) {
  const yaw = -0.3;
  const { r, M } = wwiSoldier(tc, { yaw, sx: 0.23, hipW: 0.085, bulk: 1.15, jerkin: true });
  // ammo bandolier across the chest
  add(r.body, geo.box(0.06, 0.46, 0.03), mat(0x8a7a50), [0, 0.2, 0.15], [0.12, 0, 0.62]);
  add(r.body, mergedBoxes('gp:bandolier', [0, 1, 2, 3, 4].map((i) => [0.05, 0.02, 0.03, 0, -0.14 + i * 0.07, 0])), mat(0xd8a640), [0, 0.2, 0.17], [0.12, 0, 0.62]);
  const butt = [-0.02, 0.5, -0.04], tilt = 0.0;
  const gun = gunMount(r.weapon, butt, tilt);
  machineGunMesh(gun, M);
  const arm = WWI_ARM(M, { w: 0.088, upper: 0.18, fore: 0.2 });
  ikArm(r.weapon, onGun(butt, tilt, 0.17, -0.09), { ...arm, fore: 0.23, pole: [-0.7, -0.6, -0.4] });
  ikArm(r.armL, onGun(butt, tilt, 0.42, 0.125), { ...arm, fore: 0.23, bandMat: M.team, pole: [0.7, -1, -0.2] });
  scaled(r, 1.06);
  return unitResult(r, 1.18, 0.42);
}

// ---------------------------------------------------------------------------
// Steam tank ("Landship")
// ---------------------------------------------------------------------------
// Rhomboid side profile (z, y), counter-clockwise.
const LOOP = [[-0.75, 0.0], [0.45, 0.0], [1.25, 0.62], [1.12, 0.94], [-0.95, 0.94], [-1.17, 0.45]];

/** Inset a convex CCW polygon by t. */
function insetPoly(pts, t) {
  const n = pts.length, lines = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    lines.push([ax - (dy / len) * t, ay + (dx / len) * t, dx, dy]);
  }
  return lines.map((l, i) => {
    const [x0, y0, dx0, dy0] = lines[(i + n - 1) % n], [x1, y1, dx1, dy1] = l;
    const den = dx0 * dy1 - dy0 * dx1;
    const s = ((x1 - x0) * dy1 - (y1 - y0) * dx1) / den;
    return [x0 + dx0 * s, y0 + dy0 * s];
  });
}

/** Side-profile prism: shape in (z, y), extruded along X by `depth` (centered). */
function profileGeo(key, outer, hole, depth) {
  return geo.custom(`gp:prof:${key}`, () => {
    const s = new THREE.Shape(outer.map(([z, y]) => new THREE.Vector2(z, y)));
    if (hole) s.holes.push(new THREE.Path(hole.map(([z, y]) => new THREE.Vector2(z, y))));
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    g.rotateY(-HALF_PI);
    return g;
  });
}

/** Small road wheel / sprocket group (axle along X). */
function tankWheel(parent, x, y, z, r, side, M, big = true) {
  const g = grp(parent, x, y, z);
  xcyl(g, r, 0.05, M.wheel, 0, 0, 0, big ? 9 : 7);
  if (big) {
    xcyl(g, r * 0.4, 0.07, M.brass, side * 0.012, 0, 0, 6);
    add(g, mergedBoxes(`gp:wheelX${r}`, [[0.06, r * 1.7, 0.035, 0, 0, 0], [0.06, 0.035, r * 1.7, 0, 0, 0]]), M.plateD, [side * 0.004, 0, 0]);
  } else add(g, geo.box(0.06, r * 1.5, 0.03), M.brass, [side * 0.006, 0, 0]);
  return g;
}

// Industrial Age "Landship": rhomboid hull with all-round tracks, riveted plates, sponson guns, a front
// gun (weapon), smoking stacks, team stripes and pennant.
export function steam_tank(tc) {
  const root = new THREE.Group();
  const M = {
    plate: mat(0x786b4c), plateD: mat(0x574d36), track: mat(0x36332d), shoe: mat(0x4a463e), wheel: mat(0x3e3b35),
    rivet: mat(0x9a8c68), brass: mat(0xc9a24a), team: mat(tc), teamD: mat(shade(tc, 0.6)), black: mat(0x15151a),
    steel: mat(0x3a3d44), wood: mat(P.wood),
  };
  const TW = 0.27, TX = 0.535; // track width, side center x
  const inner = insetPoly(LOOP, 0.085);
  const plateLoop = insetPoly(LOOP, 0.08);
  const trackGeo = profileGeo('tankTrack', LOOP, inner, TW);
  const plateGeo = profileGeo('tankPlate', plateLoop, null, TW - 0.05);
  // grouser shoes around the outside of each track loop
  const shoes = [];
  for (let i = 1; i < LOOP.length; i++) { // the ground run (edge 0) is never seen
    const [az, ay] = LOOP[i], [bz, by] = LOOP[(i + 1) % LOOP.length];
    const dz = bz - az, dy = by - ay, len = Math.hypot(dz, dy);
    const th = Math.atan2(dy, dz), nz = dy / len, ny = -dz / len;
    const n = Math.max(1, Math.round(len / 0.24));
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n;
      for (const s of [1, -1]) shoes.push([TW + 0.02, 0.026, 0.07, s * TX, ay + dy * t + ny * 0.008, az + dz * t + nz * 0.008, 0, -th]);
    }
  }
  add(root, mergedBoxes('gp:tankShoes', shoes), M.shoe);
  const wheels = [];
  const rv = [];
  for (const s of [1, -1]) {
    add(root, trackGeo, M.track, [s * TX, 0, 0]);
    add(root, plateGeo, M.plate, [s * TX, 0, 0]);
    const ox = s * (TX + (TW - 0.05) / 2); // outer face of the side plate
    // team stripe along the side, plate seams
    add(root, geo.box(0.012, 0.11, 1.62), M.team, [ox + s * 0.006, 0.7, 0.06]);
    add(root, geo.box(0.014, 0.56, 0.03), M.plateD, [ox + s * 0.007, 0.5, -0.62]);
    for (let i = 0; i < 7; i++) rv.push([ox + s * 0.01, 0.86, -0.8 + i * 0.29]);
    // wheels inside the track loop on the outer face
    const wx = ox + s * 0.025;
    wheels.push(tankWheel(root, wx, 0.43, -0.86, 0.15, s, M));
    wheels.push(tankWheel(root, wx, 0.6, 0.98, 0.13, s, M));
    for (const z of [-0.42, 0.0, 0.38]) wheels.push(tankWheel(root, wx, 0.18, z, 0.085, s, M, false));
    // sponson: armored box with chamfered front, team top band, short 6-pdr gun
    const sp = grp(root, s * 0.74, 0.55, 0.02);
    add(sp, geo.box(0.16, 0.42, 0.52), M.plate, [0, 0, 0]);
    add(sp, geo.box(0.16, 0.42, 0.16), M.plate, [-s * 0.035, 0, 0.27], [0, s * 0.55, 0]);
    add(sp, geo.box(0.16, 0.42, 0.16), M.plate, [-s * 0.035, 0, -0.27], [0, -s * 0.55, 0]);
    add(sp, geo.box(0.17, 0.07, 0.58), M.team, [0, 0.19, 0]);
    add(sp, geo.box(0.12, 0.05, 0.4), M.plateD, [0, 0.235, 0]);
    add(sp, geo.sphere(0.075, 6, 4), M.plateD, [-s * 0.02, 0.02, 0.33], null, [1, 1, 0.6]);
    zcyl(sp, 0.026, 0.032, 0.33, 0.7, M.steel, 7, -s * 0.02, 0.02);
    add(sp, rivets(`sponson${s}`, [-0.12, 0.12].flatMap((z) => [[s * 0.085, 0.12, z], [s * 0.085, -0.15, z]])), M.rivet);
  }
  add(root, rivets('tankSides', rv), M.rivet);
  // central hull, cab, roof details
  add(root, geo.box(0.82, 0.7, 1.78), M.plate, [0, 0.6, -0.04]);
  add(root, geo.box(0.84, 0.04, 1.8), M.plateD, [0, 0.95, -0.04]);
  add(root, geo.box(0.6, 0.18, 0.4), M.plate, [0, 1.05, 0.62]);
  add(root, geo.box(0.62, 0.03, 0.42), M.team, [0, 1.15, 0.62]);
  for (const x of [-0.18, 0.0, 0.18]) add(root, geo.box(0.1, 0.022, 0.02), M.black, [x, 1.06, 0.825]); // vision slits
  for (const x of [-0.26, 0.26]) add(root, geo.box(0.12, 0.03, 0.02), M.black, [x, 0.8, 0.865]);
  add(root, geo.cyl(0.085, 0.095, 0.08, 8), M.plate, [0.14, 1.2, 0.56]); // cupola
  add(root, geo.cyl(0.07, 0.07, 0.02, 8), M.team, [0.14, 1.245, 0.56]);
  add(root, rivets('tankRoof', [-0.6, -0.2, 0.2].flatMap((z) => [[0.37, 0.975, z], [-0.37, 0.975, z]]).concat(
    [-0.2, 0.2].map((x) => [x, 1.0, 0.845]))), M.rivet);
  // team roundel + chevron on the roof (reads from the RTS camera)
  add(root, geo.cyl(0.17, 0.17, 0.02, 12), M.team, [0, 0.98, 0.05]);
  add(root, geo.cyl(0.1, 0.1, 0.024, 10), mat(P.white), [0, 0.982, 0.05]);
  add(root, geo.cyl(0.05, 0.05, 0.028, 8), M.teamD, [0, 0.984, 0.05]);
  // unditching beam on the rails
  add(root, geo.box(1.34, 0.12, 0.12), M.wood, [0, 1.02, -0.78]);
  for (const s of [1, -1]) add(root, geo.box(0.04, 0.14, 0.14), M.steel, [s * 0.5, 1.02, -0.78]);
  // exhaust stacks with smoke + firebox glow at the rear
  const bob = [];
  const smoke = mat(0xd6d3cc, { transparent: true, opacity: 0.82 });
  for (const s of [1, -1]) {
    const x = s * 0.2, z = -0.45;
    add(root, geo.cyl(0.05, 0.055, 0.36, 8), M.plateD, [x, 1.13, z]);
    add(root, geo.cyl(0.068, 0.058, 0.06, 6), M.brass, [x, 1.32, z]);
    const puff = grp(root, x, 1.42, z);
    for (const [px, py, pz, ps] of [[0, 0, 0, 0.075], [0.03 * s, 0.12, -0.07, 0.09]]) {
      add(puff, geo.ico(ps, 0), smoke, [px, py, pz]).castShadow = false;
    }
    bob.push(puff);
  }
  add(root, geo.box(0.3, 0.2, 0.03), M.plateD, [0, 0.55, -0.945]);
  const grate = add(root, geo.box(0.22, 0.1, 0.02), glowMat(0xff7a1a, 1.2), [0, 0.55, -0.962]);
  grate.castShadow = false;
  for (const x of [-0.06, 0, 0.06]) add(root, geo.box(0.014, 0.12, 0.03), M.black, [x, 0.55, -0.965]);
  // pennant at the rear
  flag(root, -0.3, 0.95, -0.85, tc, { pole: 0.5, w: 0.4, h: 0.24, dir: 1, poleColor: P.iron, finial: P.gold });
  // front gun in a ball mantlet (weapon)
  add(root, geo.box(0.36, 0.3, 0.06), M.plateD, [0, 0.6, 0.86]);
  add(root, geo.sphere(0.12, 7, 5), M.plate, [0, 0.6, 0.9], null, [1, 1, 0.75]); // ball mantlet (static)
  const weapon = grp(root, 0, 0.6, 0.9);
  zcyl(weapon, 0.05, 0.055, 0.0, 0.16, M.plateD, 8);
  zcyl(weapon, 0.032, 0.036, 0.1, 0.5, M.steel, 8);
  zcyl(weapon, 0.04, 0.04, 0.47, 0.52, M.steel, 8);
  muzzle(weapon, 0, 0, 0.525);
  return { root, parts: { wheels, weapon, bob, glow: [grate] }, height: 1.3, radius: 0.95 };
}

// Industrial Age field howitzer: shielded barrel with recoil cylinders on a box cradle, spoked wheels,
// split trail with spades; team-painted shield band, trail stripes and hub caps.
export function howitzer(tc) {
  const root = new THREE.Group();
  const olive = mat(0x5f6345), oliveD = mat(0x464a33), oliveL = mat(0x737858), steel = mat(0x3a3d44), team = mat(tc);
  const wood = mat(0x8a6a44), black = mat(0x16161a);
  const AX = 0.38;
  const wheels = [];
  for (const s of [1, -1]) {
    wheels.push(spokedWheel(root, s * 0.47, AX, 0, {
      r: AX, width: 0.07, spokes: 12, rimMat: wood, tireMat: steel, spokeMat: wood, hubMat: steel, capMat: team, key: 'howitzer',
    }));
  }
  xcyl(root, 0.04, 0.9, steel, 0, AX, 0, 8); // axle
  add(root, geo.box(0.3, 0.16, 0.36), olive, [0, 0.5, -0.04]); // carriage saddle
  for (const s of [1, -1]) add(root, geo.box(0.04, 0.22, 0.26), oliveD, [s * 0.13, 0.62, -0.04]); // trunnion brackets
  // split trail with spades, team stripes and handles
  for (const s of [1, -1]) {
    const a = [s * 0.11, 0.45, -0.12], b = [s * 0.38, 0.08, -0.98];
    beam(root, a, b, 0.07, olive, 0.11);
    for (const k of [0.45, 0.6]) {
      const p = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      const q = [a[0] + (b[0] - a[0]) * (k + 0.08), a[1] + (b[1] - a[1]) * (k + 0.08), a[2] + (b[2] - a[2]) * (k + 0.08)];
      beam(root, p, q, 0.078, team, 0.118);
    }
    add(root, geo.box(0.2, 0.16, 0.03), oliveD, [b[0], 0.06, b[2] - 0.02], [0.25, s * 0.3, 0]); // spade
    add(root, geo.torus(0.045, 0.01, 3, 8), steel, [b[0] - s * 0.06, 0.16, b[2] + 0.1], [0, 0, HALF_PI]);
  }
  add(root, geo.box(0.3, 0.06, 0.08), oliveD, [0, 0.36, -0.42]); // trail spreader
  // gun shield: two side panels, top and bottom, team band, apron below the axle
  const SZ = 0.2;
  for (const s of [1, -1]) {
    add(root, geo.box(0.32, 0.66, 0.025), olive, [s * 0.24, 0.66, SZ], [-0.12, 0, 0]);
    add(root, geo.box(0.33, 0.12, 0.03), team, [s * 0.24, 0.84, SZ + 0.022], [-0.12, 0, 0]);
    add(root, geo.box(0.03, 0.66, 0.035), oliveD, [s * 0.4, 0.66, SZ], [-0.12, 0, 0]);
  }
  add(root, geo.box(0.17, 0.08, 0.025), olive, [0, 0.975, SZ - 0.075], [-0.12, 0, 0]);
  add(root, geo.box(0.17, 0.08, 0.03), team, [0, 0.975, SZ - 0.053], [-0.12, 0, 0]);
  add(root, geo.box(0.17, 0.2, 0.025), olive, [0, 0.44, SZ + 0.025], [-0.12, 0, 0]);
  add(root, geo.box(0.8, 0.03, 0.04), oliveD, [0, 1.0, SZ - 0.075], [-0.12, 0, 0]);
  add(root, geo.box(0.62, 0.16, 0.022), olive, [0, 0.2, 0.16]);
  add(root, rivets('howShield', [-0.36, -0.12, 0.12, 0.36].flatMap((x) => [[x, 0.42, SZ + 0.04], [x, 0.72, SZ + 0.005]])), oliveL);
  // barrel group (weapon) on the trunnions, elevated 25 degrees at rest
  const weapon = grp(root, 0, 0.66, -0.04);
  const el = grp(weapon, 0, 0, 0);
  el.rotation.x = -0.436;
  add(el, geo.box(0.16, 0.1, 0.78), oliveD, [0, -0.07, 0.08]); // cradle
  zcyl(el, 0.042, 0.042, -0.25, 0.5, oliveL, 8, 0, 0.085); // recuperator above
  zcyl(el, 0.034, 0.034, -0.2, 0.45, olive, 8, 0, -0.13); // buffer below
  zcyl(el, 0.048, 0.056, -0.3, 0.9, steel, 9); // barrel
  zcyl(el, 0.056, 0.056, 0.86, 0.92, steel, 9);
  zcyl(el, 0.03, 0.03, 0.92, 0.925, black, 8);
  add(el, geo.box(0.14, 0.14, 0.16), steel, [0, 0, -0.36]); // breech
  add(el, geo.box(0.02, 0.02, 0.14), oliveL, [-0.08, 0.02, -0.4], [0.4, 0, 0]); // breech lever
  xcyl(el, 0.035, 0.3, oliveD, 0, -0.04, 0, 8); // trunnion
  add(el, geo.box(0.04, 0.08, 0.06), oliveL, [0.1, 0.07, -0.1]); // sight
  add(el, geo.torus(0.05, 0.01, 3, 8), steel, [0.12, -0.08, -0.15], [0, HALF_PI, 0]); // elevation handwheel
  muzzle(el, 0, 0, 0.93);
  return { root, parts: { wheels, weapon }, height: 1.2, radius: 0.8 };
}
