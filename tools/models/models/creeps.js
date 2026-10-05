// Neutral hostile creeps and Kalenden's Dark Legion.
import {
  THREE, mat, geo, P, CG, glowMat, grp, add, beam, rig, scaled, legMesh, armMesh, grip, sword, MELEE_TILT,
  roundShield, bowMesh, quiver, fire,
} from './common.js';

const HALF_PI = Math.PI / 2;

function pack(r, height, radius, extra = {}) {
  return {
    root: r.root,
    parts: { body: r.body, head: r.head, legs: r.legs, arms: [{ obj: r.armL, phase: Math.PI }], weapon: r.weapon, ...extra },
    height,
    radius,
  };
}


// ---------------------------------------------------------------------------
export function kobold() {
  const L = 0.2;
  const r = rig({ legLen: L, hipW: 0.06, shoulderX: 0.13, shoulderY: 0.2, neckY: 0.25, headZ: 0.04 });
  const fur = mat(0xa8683a), furD = mat(0x6e3f22), muzzle = mat(0xd09868), cloth = mat(0x8a7a50);
  for (const l of r.legs) legMesh(l.obj, L, 0.07, fur, furD, { bootH: 0.4 });
  add(r.body, CG.frustum(1.15), fur, [0, 0.12, 0.01], [0.2, 0, 0], [0.21, 0.24, 0.17]);
  add(r.body, geo.box(0.22, 0.09, 0.18), cloth, [0, 0.01, 0]);
  add(r.body, geo.box(0.04, 0.24, 0.04), furD, [0, 0.0, -0.13], [-0.9, 0, 0]); // tail
  // rat-dog head
  add(r.head, geo.sphere(0.095, 7, 5), fur, [0, 0.07, 0]);
  add(r.head, geo.cone(0.055, 0.15, 5), muzzle, [0, 0.04, 0.12], [HALF_PI, 0, 0]);
  add(r.head, geo.sphere(0.022, 5, 4), mat(P.black), [0, 0.04, 0.2]);
  for (const s of [1, -1]) {
    add(r.head, geo.cyl(0.055, 0.055, 0.02, 7), furD, [s * 0.09, 0.14, -0.01], [HALF_PI, 0, s * 0.5]);
    add(r.head, geo.sphere(0.014, 4, 3), mat(0xffd040), [s * 0.04, 0.1, 0.08]);
  }
  // miner's cap + candle
  add(r.head, geo.sphere(0.085, 7, 4), mat(0x9a8a5a), [0, 0.13, -0.01], null, [1.1, 0.6, 1.1]);
  add(r.head, geo.cyl(0.018, 0.02, 0.08, 5), mat(0xf4f0dc), [0, 0.2, 0.0]);
  const fl = fire(r.head, 0, 0.24, 0, 0.08);
  armMesh(r.armL, { upper: 0.1, fore: 0.09, w: 0.055, upperMat: fur, foreMat: fur, handMat: furD, bend: 0.6 });
  const hand = armMesh(r.weapon, { upper: 0.1, fore: 0.09, w: 0.055, upperMat: fur, foreMat: fur, handMat: furD, bend: 0.7 });
  const g = grip(hand, 1.75);
  add(g, geo.cyl(0.013, 0.015, 0.34, 5), mat(P.wood), [0, 0.08, 0]);
  add(g, geo.box(0.03, 0.03, 0.2), mat(P.steelDark), [0, 0.25, 0.03], [-0.25, 0, 0]);
  add(g, geo.cone(0.015, 0.06, 4), mat(P.steelDark), [0, 0.22, 0.15], [HALF_PI + 0.4, 0, 0]);
  return pack(r, 0.7, 0.24, { fire: [fl] });
}

// ---------------------------------------------------------------------------
function gnollBase() {
  const L = 0.32;
  const r = rig({ legLen: L, hipW: 0.085, shoulderX: 0.22, shoulderY: 0.34, neckY: 0.38, headZ: 0.1, shoulderZ: 0.05 });
  const fur = mat(0xc49a58), spot = mat(0x7a5530), mane = mat(0x4a2e1c), leather = mat(P.leather);
  for (const l of r.legs) legMesh(l.obj, L, 0.1, fur, spot, { bootH: 0.4 });
  add(r.body, CG.frustum(1.35), fur, [0, 0.2, 0.03], [0.3, 0, 0], [0.3, 0.38, 0.24]);
  add(r.body, geo.box(0.12, 0.1, 0.03), spot, [0.07, 0.26, 0.15], [0.3, 0, 0.3]);
  add(r.body, geo.box(0.09, 0.08, 0.03), spot, [-0.08, 0.14, 0.13], [0.3, 0, -0.2]);
  add(r.body, geo.box(0.05, 0.42, 0.26), leather, [0, 0.2, 0.03], [0.3, 0, 0.55]); // strap
  add(r.body, geo.box(0.32, 0.07, 0.25), leather, [0, 0.03, 0]);
  add(r.body, geo.box(0.16, 0.16, 0.03), mat(0x6b5a3a), [0, -0.06, 0.13]); // loincloth
  for (let i = 0; i < 3; i++) add(r.body, geo.cone(0.05, 0.16, 4), mane, [0, 0.36 - i * 0.1, -0.08 - i * 0.04], [-1.0 - i * 0.2, 0, 0]);
  // hyena head
  add(r.head, geo.sphere(0.1, 7, 5), fur, [0, 0.08, 0], null, [0.95, 0.9, 1.1]);
  add(r.head, CG.frustum(0.75), spot, [0, 0.04, 0.13], [HALF_PI + 0.15, 0, 0], [0.11, 0.15, 0.1]); // blunt dark muzzle
  add(r.head, geo.box(0.075, 0.03, 0.1), mat(0xe8dcc0), [0, -0.01, 0.12], [0.1, 0, 0]); // teeth/jaw
  add(r.head, geo.sphere(0.028, 5, 4), mat(P.black), [0, 0.04, 0.21]);
  for (const s of [1, -1]) {
    add(r.head, geo.cone(0.045, 0.13, 5), spot, [s * 0.07, 0.19, -0.02], [-0.2, 0, -s * 0.3], [1, 1, 0.45]);
    add(r.head, geo.sphere(0.017, 4, 3), mat(0xffc020), [s * 0.05, 0.11, 0.08]);
  }
  add(r.head, geo.box(0.04, 0.12, 0.16), mane, [0, 0.15, -0.07], [-0.4, 0, 0]);
  const armOpt = { upper: 0.17, fore: 0.17, w: 0.075, upperMat: fur, foreMat: fur, handMat: spot, bend: 0.5 };
  armMesh(r.armL, armOpt);
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.6 });
  return { r, hand, fur, leather };
}

export function gnoll() {
  const { r, hand } = gnollBase();
  const g = grip(hand, MELEE_TILT);
  add(g, geo.cyl(0.075, 0.03, 0.52, 6), mat(P.wood), [0, 0.2, 0]);
  add(g, geo.cone(0.025, 0.08, 4), mat(P.steelDark), [0.07, 0.36, 0], [0, 0, -HALF_PI]);
  add(g, geo.cone(0.025, 0.08, 4), mat(P.steelDark), [0, 0.4, 0.07], [HALF_PI, 0, 0]);
  add(g, geo.cyl(0.035, 0.035, 0.05, 5), mat(P.leatherDark), [0, -0.02, 0]);
  return pack(r, 1.0, 0.32);
}

export function gnoll_archer() {
  const { r, hand } = gnollBase();
  quiver(r.body, { x: 0.05, y: 0.26, z: -0.13, rz: 0.4, len: 0.3, color: 0x5a3a20, fletch: 0xa04030 });
  bowMesh(grip(hand, 0.75), 0.68, { wood: 0x7a5a30, string: 0xcfc4a0 });
  add(r.head, geo.box(0.2, 0.05, 0.2), mat(0x8a3a2a), [0, 0.12, 0.01]); // headband
  return pack(r, 1.0, 0.32);
}

// ---------------------------------------------------------------------------
export function wolf() {
  const root = new THREE.Group();
  const grey = mat(0x8c8f94), dark = mat(0x55585e), light = mat(0xd0d0cc);
  const legs = [];
  for (const [x, z, ph, front] of [[0.1, 0.22, 0, 1], [-0.1, -0.24, 0, 0], [-0.1, 0.22, Math.PI, 1], [0.1, -0.24, Math.PI, 0]]) {
    const lg = grp(root, x, 0.38, z);
    add(lg, geo.box(front ? 0.08 : 0.1, 0.26, front ? 0.09 : 0.13), grey, [0, -0.11, front ? 0 : -0.01]);
    add(lg, geo.box(0.06, 0.16, 0.06), dark, [0, -0.29, 0.0]);
    add(lg, geo.box(0.07, 0.04, 0.1), dark, [0, -0.36, 0.02]);
    legs.push({ obj: lg, phase: ph, amp: 0.55 });
  }
  const body = grp(root, 0, 0.45, 0);
  add(body, CG.frustum(0.8), grey, [0, 0, -0.02], [-HALF_PI, 0, 0], [0.26, 0.6, 0.26]);
  add(body, geo.box(0.18, 0.08, 0.5), light, [0, -0.11, 0]);
  add(body, geo.sphere(0.17, 7, 5), dark, [0, 0.05, 0.18], null, [1, 1, 1.1]); // ruff
  const head = grp(body, 0, 0.12, 0.33);
  add(head, geo.box(0.18, 0.16, 0.18), grey, [0, 0, 0]);
  add(head, geo.box(0.09, 0.08, 0.17), grey, [0, -0.03, 0.15]);
  add(head, geo.box(0.07, 0.03, 0.14), light, [0, -0.07, 0.14]);
  add(head, geo.sphere(0.022, 4, 3), mat(P.black), [0, -0.0, 0.24]);
  for (const s of [1, -1]) {
    add(head, geo.cone(0.04, 0.11, 4), dark, [s * 0.06, 0.12, -0.03], [-0.2, 0, -s * 0.2]);
    add(head, geo.box(0.03, 0.02, 0.02), glowMat(0xffd23a, 0.6), [s * 0.05, 0.03, 0.09]);
  }
  add(body, geo.cone(0.06, 0.36, 5), grey, [0, -0.04, -0.44], [-2.2, 0, 0]);
  add(body, geo.cone(0.04, 0.12, 4), light, [0, -0.15, -0.58], [-2.2, 0, 0]);
  return { root, parts: { body, head, legs }, height: 0.7, radius: 0.36 };
}

// ---------------------------------------------------------------------------
export function forest_troll() {
  const L = 0.46;
  const r = rig({ legLen: L, hipW: 0.09, shoulderX: 0.21, shoulderY: 0.36, neckY: 0.4, headZ: 0.12, shoulderZ: 0.06 });
  const skin = mat(0x5b8fd0), skinD = mat(0x3f6ea8), leather = mat(0x6a4022), bone = mat(P.bone), hair = mat(0xd6402a);
  for (const l of r.legs) {
    add(l.obj, geo.box(0.07, L * 0.6, 0.075), skin, [0, -L * 0.3, 0]);
    add(l.obj, geo.box(0.065, L * 0.42, 0.07), skin, [0, -L * 0.75, -0.02]);
    add(l.obj, geo.box(0.09, 0.06, 0.16), skinD, [0, -L + 0.03, 0.04]);
  }
  add(r.body, CG.frustum(1.45), skin, [0, 0.2, 0.04], [0.32, 0, 0], [0.27, 0.38, 0.19]);
  add(r.body, geo.box(0.28, 0.06, 0.2), leather, [0, 0.03, 0]);
  add(r.body, geo.box(0.16, 0.22, 0.03), leather, [0, -0.09, 0.1]);
  add(r.body, geo.box(0.16, 0.2, 0.03), leather, [0, -0.08, -0.1]);
  add(r.body, geo.torus(0.1, 0.015, 3, 8), bone, [0, 0.36, 0.12], [1.2, 0, 0]); // bone necklace
  add(r.body, CG.axeHead(), mat(P.steelDark), [0.15, 0.0, -0.02], [0, -0.4, 0], 0.2); // belt axe
  // head
  add(r.head, geo.sphere(0.1, 7, 5), skin, [0, 0.07, 0], null, [1, 1, 1.15]);
  add(r.head, geo.cone(0.035, 0.12, 4), skinD, [0, 0.06, 0.14], [1.9, 0, 0]); // long nose
  add(r.head, geo.box(0.11, 0.05, 0.08), skin, [0, -0.01, 0.07]); // jaw
  for (const s of [1, -1]) {
    add(r.head, geo.cone(0.016, 0.1, 4), bone, [s * 0.045, 0.04, 0.11], [-0.3, 0, -s * 0.3]); // tusks
    add(r.head, geo.cone(0.03, 0.2, 4), skin, [s * 0.15, 0.09, -0.03], [0, 0, -s * 1.35]); // ears
    add(r.head, geo.sphere(0.014, 4, 3), mat(0xffe040), [s * 0.04, 0.09, 0.1]);
  }
  add(r.head, geo.box(0.035, 0.16, 0.28), hair, [0, 0.17, -0.04], [-0.25, 0, 0]); // mohawk
  const armOpt = { upper: 0.22, fore: 0.21, w: 0.065, upperMat: skin, foreMat: skin, handMat: skinD, bend: 0.4, handR: 0.055 };
  const hl = armMesh(r.armL, armOpt);
  add(hl, geo.cyl(0.05, 0.05, 0.06, 6), leather, [0, 0.08, -0.03], [0.4, 0, 0]);
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.6 });
  const g = grip(hand, MELEE_TILT);
  add(g, geo.cyl(0.016, 0.018, 0.36, 5), mat(P.wood), [0, 0.1, 0]);
  add(g, CG.axeHead(), mat(P.steelDark), [0, 0.25, 0.01], null, 0.32);
  add(g, geo.box(0.04, 0.04, 0.04), mat(P.leather), [0, 0.25, 0]);
  return pack(r, 1.2, 0.3);
}

// ---------------------------------------------------------------------------
function ogreBase({ skinC = 0xc98f62, loin = 0x6b4a2a }) {
  const L = 0.5;
  const r = rig({ legLen: L, hipW: 0.17, shoulderX: 0.42, shoulderY: 0.64, neckY: 0.74, headZ: 0.12, shoulderZ: 0.04, legAmp: 0.45 });
  const skin = mat(skinC), skinD = mat(new THREE.Color(skinC).multiplyScalar(0.75).getHex()), cloth = mat(loin);
  for (const l of r.legs) {
    add(l.obj, CG.frustum(0.8), skin, [0, -L * 0.32, 0], null, [0.22, L * 0.66, 0.24]);
    add(l.obj, geo.box(0.17, L * 0.4, 0.18), skin, [0, -L * 0.75, 0]);
    add(l.obj, geo.box(0.2, 0.08, 0.27), skinD, [0, -L + 0.04, 0.05]);
  }
  add(r.body, geo.sphere(0.38, 8, 6), skin, [0, 0.3, 0.06], null, [1.05, 1.0, 0.95]);
  add(r.body, CG.frustum(1.3), skin, [0, 0.55, 0], null, [0.62, 0.36, 0.42]);
  for (const s of [1, -1]) add(r.body, geo.sphere(0.17, 7, 5), skin, [s * 0.36, 0.66, 0]);
  add(r.body, geo.box(0.58, 0.09, 0.48), cloth, [0, 0.03, 0]);
  add(r.body, geo.box(0.3, 0.3, 0.04), cloth, [0, -0.12, 0.24], [-0.1, 0, 0]);
  add(r.body, geo.box(0.3, 0.26, 0.04), cloth, [0, -0.1, -0.22]);
  // head
  add(r.head, geo.sphere(0.16, 7, 5), skin, [0, 0.1, 0.04]);
  add(r.head, geo.box(0.26, 0.1, 0.2), skin, [0, -0.0, 0.1]); // jaw
  add(r.head, geo.box(0.24, 0.05, 0.08), skinD, [0, 0.15, 0.15]); // brow
  for (const s of [1, -1]) {
    add(r.head, geo.cone(0.025, 0.1, 4), mat(P.bone), [s * 0.08, 0.08, 0.19]); // tusks
    add(r.head, geo.sphere(0.02, 4, 3), mat(P.black), [s * 0.06, 0.12, 0.18]);
  }
  const armOpt = { upper: 0.32, fore: 0.3, w: 0.16, upperMat: skin, foreMat: skin, handMat: skinD, bend: 0.4, handR: 0.12 };
  armMesh(r.armL, armOpt);
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.6 });
  return { r, hand, skin, skinD };
}

export function ogre() {
  const { r, hand } = ogreBase({});
  add(r.head, geo.cone(0.06, 0.16, 5), mat(0x2a1a10), [0, 0.28, 0.0], [-0.3, 0, 0]); // topknot
  add(r.body, geo.box(0.06, 0.6, 0.48), mat(P.leatherDark), [0, 0.45, 0.03], [0, 0, 0.6]);
  const g = grip(hand, MELEE_TILT);
  add(g, geo.cyl(0.12, 0.045, 0.85, 7), mat(P.wood), [0, 0.3, 0]);
  const iron = mat(P.steelDark);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const y = 0.5 + (i % 2) * 0.16;
    add(g, geo.cone(0.03, 0.12, 4), iron, [Math.sin(a) * 0.11, y, Math.cos(a) * 0.11], [Math.cos(a) * HALF_PI, 0, -Math.sin(a) * HALF_PI]);
  }
  return pack(r, 1.7, 0.5);
}

export function ogre_lord() {
  const { r, hand } = ogreBase({ skinC: 0xb88468, loin: 0x5a1a1a });
  const iron = mat(0x4a4d55), gold = mat(P.goldDark), spike = mat(P.steelLight);
  // armor
  add(r.body, geo.box(0.5, 0.36, 0.08), iron, [0, 0.36, 0.38], [-0.15, 0, 0]);
  add(r.body, geo.box(0.12, 0.12, 0.03), gold, [0, 0.4, 0.43], [-0.15, 0, Math.PI / 4]);
  for (const s of [1, -1]) {
    add(r.body, geo.sphere(0.22, 7, 5), iron, [s * 0.4, 0.72, 0], null, [1.15, 0.75, 1.1]);
    add(r.body, geo.cone(0.05, 0.22, 4), spike, [s * 0.45, 0.88, 0.0], [0, 0, -s * 0.4]);
    add(r.body, geo.cone(0.04, 0.16, 4), spike, [s * 0.52, 0.8, -0.1], [-0.5, 0, -s * 0.9]);
  }
  add(r.head, geo.sphere(0.175, 7, 4), iron, [0, 0.16, 0.03], null, [1, 0.75, 1]);
  for (const s of [1, -1]) add(r.head, geo.cone(0.05, 0.24, 5), mat(P.bone), [s * 0.2, 0.27, 0.02], [0, 0, -s * 0.7]);
  const g = grip(hand, 1.75);
  add(g, geo.cyl(0.04, 0.04, 0.9, 6), mat(P.woodDark), [0, 0.25, 0]);
  add(g, geo.cyl(0.05, 0.05, 0.08, 6), gold, [0, 0.62, 0]);
  add(g, geo.dodeca(0.17), iron, [0, 0.8, 0]);
  for (let i = 0; i < 6; i++) {
    const v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0.0]][i];
    const m = add(g, geo.cone(0.045, 0.16, 4), spike, [v[0] * 0.19, 0.8 + v[1] * 0.19, v[2] * 0.19]);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(v[0], v[1], v[2]).normalize());
  }
  scaled(r, 1.18);
  return pack(r, 2.0, 0.6);
}

// ---------------------------------------------------------------------------
export function spider() {
  const root = new THREE.Group();
  const black = mat(0x2a2030), purple = mat(0x5a2a7a), legM = mat(0x1e1824);
  const body = grp(root, 0, 0.3, 0);
  add(body, geo.sphere(0.16, 8, 6), black, [0, 0, 0.1], null, [1, 0.8, 1.1]);
  add(body, geo.sphere(0.27, 8, 6), purple, [0, 0.08, -0.27], null, [1, 0.85, 1.15]);
  add(body, geo.box(0.06, 0.04, 0.3), mat(0xc83a2a), [0, 0.3, -0.26], [0.15, 0, 0]); // marking
  add(body, geo.box(0.16, 0.04, 0.05), mat(0xc83a2a), [0, 0.3, -0.24], [0.15, 0, 0]);
  const head = grp(body, 0, 0.02, 0.24);
  add(head, geo.sphere(0.09, 7, 5), black, [0, 0, 0]);
  const eyes = [];
  for (const [x, y] of [[0.035, 0.04], [-0.035, 0.04], [0.06, 0.0], [-0.06, 0.0]]) {
    const e = add(head, geo.sphere(0.022, 5, 4), glowMat(0xff1a1a, 1), [x, y, 0.075]);
    e.castShadow = false;
    eyes.push(e);
  }
  for (const s of [1, -1]) add(head, geo.cone(0.02, 0.1, 4), mat(0x6a2a2a), [s * 0.03, -0.07, 0.07], [2.6, 0, 0]); // fangs
  // 8 legs: each hangs from a yaw group so that rotation.x (about the outward axis) lifts/swings it
  const legs = [];
  const yaws = [-0.75, -0.25, 0.3, 0.8];
  for (let i = 0; i < 4; i++) {
    for (const side of [1, -1]) {
      const z = 0.17 - i * 0.07;
      const holder = grp(body, side * 0.1, 0, z);
      holder.rotation.y = side > 0 ? yaws[i] : Math.PI - yaws[i];
      const lg = grp(holder, 0, 0, 0);
      const knee = [0.3, 0.24, 0];
      const tip = [0.62, -0.3, 0];
      beam(lg, [0, 0, 0], knee, 0.04, legM);
      beam(lg, knee, tip, 0.032, legM);
      add(lg, geo.sphere(0.03, 5, 4), purple, knee);
      const phase = ((i + (side > 0 ? 0 : 1)) % 2) * Math.PI;
      legs.push({ obj: lg, phase, amp: 0.35 });
    }
  }
  return { root, parts: { body, head, legs, glow: eyes }, height: 0.6, radius: 0.6 };
}

// ---------------------------------------------------------------------------
export function rock_golem() {
  const L = 0.5;
  const r = rig({ legLen: L, hipW: 0.2, shoulderX: 0.52, shoulderY: 0.66, neckY: 0.78, headZ: 0.16, legAmp: 0.4 });
  const rock = mat(0x8d8a80), rockD = mat(0x66635c), rockL = mat(0xa8a49a), moss = mat(0x5f8a3a);
  const rune = glowMat(0x4ae8ff, 1);
  for (const l of r.legs) {
    add(l.obj, geo.dodeca(0.18), rockD, [0, -0.16, 0]);
    add(l.obj, geo.dodeca(0.2), rock, [0, -L + 0.14, 0.04], [0.4, 0.3, 0], [1.1, 0.75, 1.2]);
  }
  add(r.body, geo.dodeca(0.24), rockD, [0, 0.12, 0]);
  add(r.body, geo.dodeca(0.46), rock, [0, 0.48, 0.02], [0.2, 0.4, 0.1], [1.1, 0.92, 0.85]);
  add(r.body, geo.dodeca(0.22), rockL, [0, 0.42, 0.28], [0.5, 0, 0.3]);
  for (const s of [1, -1]) {
    add(r.body, geo.dodeca(0.27), rockL, [s * 0.46, 0.7, 0], [s * 0.3, 0.5, 0]);
    add(r.body, geo.dodeca(0.13), moss, [s * 0.44, 0.9, -0.02], null, [1.2, 0.5, 1.2]);
  }
  const glows = [];
  glows.push(add(r.body, geo.box(0.05, 0.22, 0.04), rune, [0, 0.46, 0.44]));
  glows.push(add(r.body, geo.box(0.16, 0.04, 0.04), rune, [0, 0.52, 0.43]));
  glows.push(add(r.body, geo.box(0.04, 0.12, 0.04), rune, [0.12, 0.38, 0.4], [0, 0, 0.6]));
  add(r.head, geo.dodeca(0.17), rock, [0, 0.08, 0], [0.3, 0.2, 0]);
  for (const s of [1, -1]) glows.push(add(r.head, geo.box(0.05, 0.03, 0.03), rune, [s * 0.06, 0.1, 0.15]));
  const mkArm = (g) => {
    add(g, geo.dodeca(0.17), rockD, [0, -0.18, 0]);
    add(g, geo.dodeca(0.17), rock, [0, -0.44, 0.08]);
    add(g, geo.dodeca(0.26), rockL, [0, -0.72, 0.14], [0.4, 0.6, 0]);
    const rr = add(g, geo.box(0.04, 0.14, 0.04), rune, [0, -0.7, 0.38]);
    glows.push(rr);
  };
  mkArm(r.armL);
  mkArm(r.weapon);
  for (const m of glows) m.castShadow = false;
  scaled(r, 1.15);
  return pack(r, 1.75, 0.75, { glow: glows });
}

// ---------------------------------------------------------------------------
export function drake() {
  const root = new THREE.Group();
  const red = mat(0xb8261c), redD = mat(0x6a1410), belly = mat(0xf0a040), horn = mat(0x2a2224), black = mat(0x231c1c);
  const hover = grp(root, 0, 0, 0);
  const body = grp(hover, 0, 0.82, 0);
  add(body, geo.sphere(0.26, 8, 6), red, [0, 0, 0], null, [0.95, 0.9, 1.6]);
  add(body, geo.sphere(0.2, 7, 5), belly, [0, -0.07, 0.05], null, [0.9, 0.8, 1.6]);
  for (let i = 0; i < 4; i++) add(body, geo.cone(0.045, 0.14, 4), black, [0, 0.22 - i * 0.02, 0.22 - i * 0.16], [-0.4, 0, 0]);
  // neck + head
  add(body, geo.cyl(0.1, 0.14, 0.42, 7), red, [0, 0.2, 0.42], [0.85, 0, 0]);
  const head = grp(body, 0, 0.4, 0.62);
  add(head, geo.box(0.2, 0.16, 0.24), red, [0, 0, 0]);
  add(head, geo.box(0.14, 0.08, 0.2), red, [0, 0.0, 0.2]);
  add(head, geo.box(0.12, 0.05, 0.22), redD, [0, -0.08, 0.15], [0.2, 0, 0]); // jaw
  for (const s of [1, -1]) {
    add(head, geo.cone(0.035, 0.24, 5), horn, [s * 0.07, 0.12, -0.14], [-1.1, 0, -s * 0.2]);
    const e = add(head, geo.box(0.04, 0.025, 0.02), glowMat(0xffd820, 1), [s * 0.08, 0.04, 0.1]);
    e.castShadow = false;
  }
  // tail
  const tail = grp(body, 0, -0.02, -0.38);
  add(tail, geo.cone(0.12, 0.5, 6), red, [0, -0.08, -0.22], [-1.9, 0, 0]);
  add(tail, geo.cone(0.06, 0.35, 5), red, [0, -0.23, -0.58], [-2.2, 0, 0]);
  add(tail, geo.tetra(0.07), black, [0, -0.33, -0.76]);
  // tucked legs
  for (const s of [1, -1]) {
    add(body, geo.box(0.07, 0.18, 0.1), redD, [s * 0.15, -0.2, 0.2], [0.6, 0, 0]);
    add(body, geo.box(0.09, 0.2, 0.14), redD, [s * 0.15, -0.2, -0.22], [-0.7, 0, 0]);
  }
  // wings
  const wings = [];
  for (const side of [1, -1]) {
    // w = animated pivot at the wing root (unrotated, so rotation.z = side * x raises both wings).
    const w = grp(body, side * 0.18, 0.14, 0.12);
    const flapper = grp(w, 0, 0, 0);
    flapper.rotation.z = side * 0.25; // resting dihedral
    const mirror = grp(flapper, 0, 0, 0);
    mirror.scale.x = side; // right wing is a mirror image of the left one
    add(mirror, CG.wing(), mat(0xd8562c), [0, 0, 0], null, [0.75, 1, 0.9]);
    add(mirror, geo.box(0.42, 0.04, 0.04), redD, [0.19, 0.01, 0.2], [0, 0.28, 0]);
    add(mirror, geo.box(0.36, 0.035, 0.035), redD, [0.55, 0.01, 0.17], [0, -0.45, 0]);
    wings.push({ obj: w, side });
  }
  return { root, parts: { body, head, bob: [hover], wings }, height: 1.4, radius: 0.6 };
}

// ---------------------------------------------------------------------------
// Kalenden's Dark Legion
// ---------------------------------------------------------------------------
export function kalenden() {
  const L = 1.0;
  const r = rig({ legLen: L, hipW: 0.22, shoulderX: 0.6, shoulderY: 0.86, neckY: 0.98, headZ: 0.03 });
  const black = mat(P.darkIron), black2 = mat(P.darkIron2), crimson = mat(P.crimson), crimsonD = mat(P.crimsonDark);
  const spike = mat(0x8a8e98), redGlow = glowMat(0xff2a1a, 1);
  const glows = [];
  for (const l of r.legs) {
    legMesh(l.obj, L, 0.28, black2, black, { bootH: 0.5 });
    add(l.obj, geo.cone(0.07, 0.24, 4), crimson, [0, -L * 0.52, 0.17], [HALF_PI, 0, 0]);
    glows.push(add(l.obj, geo.box(0.06, 0.22, 0.03), redGlow, [0, -L * 0.75, 0.24]));
  }
  add(r.body, CG.frustum(1.5), black2, [0, 0.46, 0], null, [0.74, 0.78, 0.5]);
  add(r.body, geo.box(0.5, 0.36, 0.05), black, [0, 0.55, 0.26]);
  glows.push(add(r.body, geo.octa(0.15), redGlow, [0, 0.56, 0.3], null, [1, 1.4, 0.35]));
  for (const s of [1, -1]) add(r.body, geo.box(0.05, 0.36, 0.04), crimson, [s * 0.18, 0.55, 0.29], [0, 0, s * 0.5]);
  add(r.body, geo.box(0.8, 0.12, 0.54), crimsonD, [0, 0.1, 0]);
  add(r.body, geo.sphere(0.08, 6, 4), mat(P.bone), [0, 0.1, 0.28]);
  add(r.body, geo.box(0.42, 0.8, 0.04), crimson, [0, -0.3, 0.28]); // tabard
  add(r.body, geo.box(0.42, 0.7, 0.04), crimson, [0, -0.26, -0.27]);
  add(r.body, geo.box(0.42 * 0.7071, 0.42 * 0.7071, 0.04), crimson, [0, -0.7, 0.28], [0, 0, Math.PI / 4]);
  // pauldrons with spikes
  for (const s of [1, -1]) {
    add(r.body, geo.sphere(0.3, 8, 6), black, [s * 0.56, 0.86, 0], null, [1.1, 0.8, 1.1]);
    add(r.body, geo.torus(0.27, 0.035, 4, 10), crimson, [s * 0.6, 0.8, 0], [HALF_PI, 0, 0]);
    add(r.body, geo.cone(0.08, 0.42, 5), spike, [s * 0.64, 1.12, 0], [0, 0, -s * 0.35]);
    add(r.body, geo.cone(0.06, 0.3, 5), spike, [s * 0.78, 0.98, -0.12], [-0.4, 0, -s * 0.95]);
    add(r.body, geo.cone(0.05, 0.24, 4), spike, [s * 0.56, 1.02, 0.18], [0.6, 0, -s * 0.4]);
  }
  // tattered cape
  for (let i = 0; i < 4; i++) {
    const x = -0.36 + i * 0.24;
    const len = [1.55, 1.3, 1.6, 1.35][i];
    add(r.body, geo.box(0.25, len, 0.04), i % 2 ? crimsonD : crimson, [x, 0.84 - len / 2, -0.34 - (i % 2) * 0.02], [0.14, 0, (i - 1.5) * 0.04]);
  }
  // head: great helm, glowing eyes, spiked crown
  add(r.head, geo.cyl(0.22, 0.24, 0.38, 8), black, [0, 0.18, 0]);
  add(r.head, geo.sphere(0.22, 8, 4), black, [0, 0.37, 0], null, [1, 0.5, 1]);
  add(r.head, geo.box(0.06, 0.26, 0.06), black2, [0, 0.14, 0.22]);
  for (const s of [1, -1]) glows.push(add(r.head, geo.box(0.1, 0.035, 0.04), redGlow, [s * 0.08, 0.22, 0.215], [0, 0, s * 0.2]));
  add(r.head, geo.cyl(0.25, 0.25, 0.08, 8), crimsonD, [0, 0.36, 0]);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const h = i === 0 ? 0.4 : 0.26;
    add(r.head, geo.cone(0.05, h, 4), spike, [Math.sin(a) * 0.23, 0.4 + h / 2, Math.cos(a) * 0.23], [Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25]);
  }
  // arms
  const armOpt = { upper: 0.42, fore: 0.38, w: 0.22, upperMat: black2, foreMat: black, handMat: black2, bend: 0.5, handR: 0.15 };
  const hl = armMesh(r.armL, armOpt);
  add(hl, geo.cone(0.04, 0.16, 4), spike, [0.1, 0.12, -0.05], [0, 0, -1.2]);
  add(hl, geo.cyl(0.17, 0.15, 0.1, 6), crimson, [0, 0.16, -0.05], [0.5, 0, 0]);
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.6 });
  add(hand, geo.cyl(0.17, 0.15, 0.1, 6), crimson, [0, 0.16, -0.06], [0.6, 0, 0]);
  // flaming greatsword
  const g = grip(hand, 0.6);
  add(g, geo.cyl(0.04, 0.04, 0.42, 6), mat(P.leatherDark), [0, 0.05, 0]);
  add(g, geo.octa(0.07), crimson, [0, -0.2, 0]);
  add(g, geo.box(0.62, 0.08, 0.1), black, [0, 0.27, 0]);
  for (const s of [1, -1]) add(g, geo.cone(0.05, 0.2, 4), spike, [s * 0.36, 0.33, 0], [0, 0, -s * 0.8]);
  add(g, geo.box(0.22, 1.5, 0.05), mat(0x34343c), [0, 1.06, 0]);
  glows.push(add(g, geo.box(0.07, 1.4, 0.07), glowMat(0xff3a10, 1), [0, 1.04, 0]));
  add(g, geo.cone(0.155, 0.32, 4), mat(0x34343c), [0, 1.97, 0], [0, Math.PI / 4, 0], [1, 1, 0.25]);
  const fires = [];
  for (let i = 0; i < 4; i++) {
    const f = fire(g, (i % 2 ? 1 : -1) * 0.06, 0.45 + i * 0.36, 0, 0.32 - i * 0.03, i % 2 ? 'red' : 'orange');
    fires.push(f);
  }
  for (const m of glows) m.castShadow = false;
  return pack(r, 2.9, 0.9, { glow: glows, fire: fires });
}

export function dark_knight() {
  const L = 0.48;
  const r = rig({ legLen: L, hipW: 0.11, shoulderX: 0.31, shoulderY: 0.46, neckY: 0.54 });
  const black = mat(P.darkIron), black2 = mat(P.darkIron2), crimson = mat(P.crimson), spike = mat(0x9a9ea8);
  for (const l of r.legs) legMesh(l.obj, L, 0.14, black2, black);
  add(r.body, CG.frustum(1.45), black2, [0, 0.27, 0], null, [0.38, 0.42, 0.27]);
  add(r.body, geo.box(0.24, 0.56, 0.03), crimson, [0, 0.12, 0.15]);
  add(r.body, geo.box(0.4, 0.07, 0.29), black, [0, 0.06, 0]);
  for (const s of [1, -1]) {
    add(r.body, CG.frustum(0.6), black, [s * 0.31, 0.49, 0], [0, 0, -s * 0.35], [0.26, 0.14, 0.3]);
    add(r.body, geo.cone(0.04, 0.2, 4), spike, [s * 0.36, 0.62, 0], [0, 0, -s * 0.4]);
  }
  add(r.head, geo.cyl(0.13, 0.14, 0.27, 7), black2, [0, 0.12, 0]);
  add(r.head, geo.cone(0.13, 0.08, 7), black2, [0, 0.29, 0]);
  const eyes = add(r.head, geo.box(0.17, 0.025, 0.03), glowMat(0xff2a1a, 1), [0, 0.15, 0.125]);
  add(r.head, geo.box(0.025, 0.12, 0.03), black, [0, 0.08, 0.135]);
  add(r.head, geo.box(0.05, 0.12, 0.3), crimson, [0, 0.36, -0.08], [0.25, 0, 0]); // plume
  add(r.head, geo.box(0.05, 0.22, 0.08), crimson, [0, 0.26, -0.24], [0.5, 0, 0]);
  const armOpt = { upper: 0.2, fore: 0.18, w: 0.12, upperMat: black2, foreMat: black, handMat: black2, bend: 0.5 };
  const hl = armMesh(r.armL, armOpt);
  // tower shield
  const sh = grp(hl, 0.09, 0.05, 0.04, 0.45);
  add(sh, geo.box(0.38, 0.66, 0.05), black, [0, 0, 0]);
  add(sh, geo.box(0.3, 0.56, 0.05), crimson, [0, 0, 0.012]);
  add(sh, geo.sphere(0.07, 6, 4), mat(P.bone), [0, 0.06, 0.04], null, [1, 1.1, 0.6]);
  add(sh, geo.box(0.04, 0.5, 0.03), black, [0, 0, 0.04]);
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.65 });
  const g = grip(hand, MELEE_TILT);
  add(g, geo.cyl(0.028, 0.028, 0.86, 6), mat(P.woodDark), [0, 0.2, 0]);
  add(g, CG.axeHead(), mat(0x9a9ea8), [0, 0.5, 0.02], null, 0.72);
  add(g, geo.box(0.07, 0.14, 0.1), crimson, [0, 0.5, 0.02]);
  add(g, geo.cone(0.04, 0.2, 4), spike, [0, 0.5, -0.1], [-HALF_PI, 0, 0]);
  add(g, geo.cone(0.035, 0.16, 4), spike, [0, 0.7, 0], null);
  eyes.castShadow = false;
  return pack(r, 1.5, 0.4, { glow: [eyes] });
}

function skeletonBase() {
  const L = 0.36;
  const r = rig({ legLen: L, hipW: 0.07, shoulderX: 0.17, shoulderY: 0.36, neckY: 0.42, headZ: 0.02 });
  const bone = mat(P.bone), boneD = mat(P.boneDark);
  for (const l of r.legs) {
    add(l.obj, geo.box(0.045, 0.19, 0.045), bone, [0, -0.1, 0]);
    add(l.obj, geo.sphere(0.035, 5, 4), boneD, [0, -0.2, 0.01]);
    add(l.obj, geo.box(0.04, 0.15, 0.04), bone, [0, -0.28, 0]);
    add(l.obj, geo.box(0.06, 0.03, 0.11), boneD, [0, -L + 0.015, 0.03]);
  }
  add(r.body, geo.box(0.18, 0.06, 0.1), bone, [0, 0.0, 0]);
  add(r.body, geo.box(0.035, 0.24, 0.035), boneD, [0, 0.13, -0.04]);
  for (let i = 0; i < 3; i++) add(r.body, geo.torus(0.085 + i * 0.012, 0.016, 3, 8), bone, [0, 0.33 - i * 0.065, 0], [HALF_PI, 0, 0], [1.1, 0.75, 1]);
  add(r.body, geo.box(0.03, 0.17, 0.03), bone, [0, 0.27, 0.07]);
  add(r.body, geo.box(0.3, 0.035, 0.05), bone, [0, 0.36, 0]); // collar bones
  add(r.head, geo.sphere(0.1, 7, 5), bone, [0, 0.08, 0]);
  add(r.head, geo.box(0.11, 0.05, 0.09), boneD, [0, 0.0, 0.05]);
  const eyes = [];
  for (const s of [1, -1]) {
    add(r.head, geo.sphere(0.026, 5, 4), mat(P.black), [s * 0.04, 0.09, 0.08]);
    const e = add(r.head, geo.sphere(0.013, 4, 3), glowMat(P.sick, 1), [s * 0.04, 0.09, 0.098]);
    e.castShadow = false;
    eyes.push(e);
  }
  const armOpt = { upper: 0.15, fore: 0.14, w: 0.04, upperMat: bone, foreMat: bone, handMat: boneD, bend: 0.5, handR: 0.035 };
  const handL = armMesh(r.armL, armOpt);
  const hand = armMesh(r.weapon, { ...armOpt, bend: 0.6 });
  return { r, hand, handL, eyes };
}

export function skeleton() {
  const { r, hand, handL, eyes } = skeletonBase();
  add(r.head, geo.sphere(0.108, 7, 4), mat(P.rust), [0, 0.12, -0.01], null, [1, 0.6, 1]); // rusty cap
  roundShield(handL, P.woodDark, { r: 0.14, x: 0.05, y: 0.02, z: 0.02, ry: 0.6, rim: P.rust, boss: P.rust });
  sword(grip(hand, MELEE_TILT), { len: 0.4, w: 0.055, blade: 0xa0705a, guard: P.rust, handle: P.leatherDark });
  return pack(r, 1.0, 0.28, { glow: eyes });
}

export function skeleton_archer() {
  const { r, hand, eyes } = skeletonBase();
  add(r.head, geo.sphere(0.118, 7, 5), mat(0x3a2a40), [0, 0.11, -0.03], null, [1, 1, 1.05]); // ragged hood
  add(r.head, geo.cone(0.07, 0.3, 5), mat(0x3a2a40), [0, -0.02, -0.1], [-0.25, 0, 0]);
  quiver(r.body, { x: 0.05, y: 0.22, z: -0.1, rz: 0.4, len: 0.3, color: 0x4a3020, fletch: 0x2a2a2a });
  bowMesh(grip(hand, 0.75), 0.7, { wood: 0x6a5a40, string: 0xb0a890 });
  return pack(r, 1.0, 0.28, { glow: eyes });
}
