// Imports the rigged, animated KayKit characters (Kay Lousberg, CC0: "Adventurers" and "Skeletons"
// character packs, https://github.com/KayKit-Game-Assets) into the game's own compact format,
// src/assets/kaykit/kaykit.bin, with their texture atlases next to it.
//
//   node tools/kaykit/import.mjs [--src <dir>]
//
// Without --src the two packs are fetched from GitHub (a sparse, shallow clone into
// tools/kaykit/.cache, about 60 MB). The output is committed, so this only runs when the selection
// of characters, props or animations below changes; the game never reads the packs themselves.
//
// What the file holds (see src/babylon/Characters.ts for the reader):
//   - Rigs: the packs share one 41-bone skeleton; the Rogues are built with other proportions and the
//     Skeletons pack has its own animation curves, so there are three rigs. For each, the joints the
//     meshes use and every selected animation, sampled at 30 frames a second, as skinning matrices
//     (joint world × inverse bind) in 3×4 affine rows, half floats: a vertex animation texture.
//   - Pieces: a character's body (its skinned parts merged into one mesh, in bind space) and its
//     props (helmets, capes, weapons, shields: rigid meshes in the space of the joint they hang on,
//     so any prop fits any body of any rig).
//   - Per vertex: position (float), normal (int8), uv (uint16), four joints and weights (uint8). (Which atlas swatches take the team
//     colour is decided by the game, per character and prop: see CharacterRecipes.ts.)
//   - Per animation: frame range, duration, and for walks and runs the ground speed of the feet, for
//     attacks the moment of impact (the weapon hand's fastest point), so the game can match them to
//     movement speed and to the simulation's attack timing.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'src/assets/kaykit');
const CACHE = path.join(ROOT, 'tools/kaykit/.cache');
const FPS = 30;

const REPOS = {
  adv: { url: 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0', dir: 'addons/kaykit_character_pack_adventures' },
  skel: { url: 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0', dir: 'addons/kaykit_character_pack_skeletons' },
};

// ------------------------------------------------------------------ selection
/** Animations every rig exports (names as in the packs). */
const COMMON_ANIMS = [
  'Idle', '2H_Melee_Idle',
  'Walking_A', 'Walking_B', 'Walking_C', 'Running_A', 'Running_B',
  '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab',
  '2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice', '2H_Melee_Attack_Stab', '2H_Melee_Attack_Spinning',
  '1H_Ranged_Shoot', '2H_Ranged_Shoot', '2H_Ranged_Shooting', '2H_Ranged_Aiming', 'Throw',
  'Spellcast_Shoot', 'Spellcast_Raise', 'Spellcast_Long',
  'Death_A', 'Death_B', 'Cheer', 'Interact',
];
const SKELETON_ANIMS = ['Idle_B', 'Idle_Combat', 'Walking_D_Skeletons', 'Running_C', 'Death_C_Skeletons', 'Skeletons_Awaken_Floor', 'Taunt'];

/** Rigs: where their skeleton and animations come from. */
const RIGS = {
  hero: { repo: 'adv', file: 'Characters/gltf/Knight.glb', anims: COMMON_ANIMS },
  rogue: { repo: 'adv', file: 'Characters/gltf/Rogue.glb', anims: COMMON_ANIMS },
  skel: { repo: 'skel', file: 'Characters/gltf/Skeleton_Warrior.glb', anims: [...COMMON_ANIMS, ...SKELETON_ANIMS] },
};

/** Characters: the body (skinned parts) and the props found on them. */
const CHARACTERS = [
  { name: 'Knight', rig: 'hero', repo: 'adv', file: 'Characters/gltf/Knight.glb', texture: 'knight_texture.png' },
  { name: 'Barbarian', rig: 'hero', repo: 'adv', file: 'Characters/gltf/Barbarian.glb', texture: 'barbarian_texture.png' },
  { name: 'Mage', rig: 'hero', repo: 'adv', file: 'Characters/gltf/Mage.glb', texture: 'mage_texture.png' },
  { name: 'Rogue', rig: 'rogue', repo: 'adv', file: 'Characters/gltf/Rogue.glb', texture: 'rogue_texture.png' },
  { name: 'Rogue_Hooded', rig: 'rogue', repo: 'adv', file: 'Characters/gltf/Rogue_Hooded.glb', texture: 'rogue_texture.png' },
  { name: 'Skeleton_Warrior', rig: 'skel', repo: 'skel', file: 'Characters/gltf/Skeleton_Warrior.glb', texture: 'skeleton_texture.png' },
  { name: 'Skeleton_Rogue', rig: 'skel', repo: 'skel', file: 'Characters/gltf/Skeleton_Rogue.glb', texture: 'skeleton_texture.png' },
  { name: 'Skeleton_Mage', rig: 'skel', repo: 'skel', file: 'Characters/gltf/Skeleton_Mage.glb', texture: 'skeleton_texture.png' },
  { name: 'Skeleton_Minion', rig: 'skel', repo: 'skel', file: 'Characters/gltf/Skeleton_Minion.glb', texture: 'skeleton_texture.png' },
];

/** Loose props (separate files in the packs), with the joint and offset they are worn at. */
const RIGHT_HAND = { joint: 'handslot.r', t: [0, 0.033, 0], r: [0, -1, 0, 0] };
const LEFT_HAND = { joint: 'handslot.l', t: [0, 0.017, 0.156], r: [0, 0, 0, 1] };
const PROPS = [
  { name: 'Skeleton_Blade', repo: 'skel', file: 'Assets/gltf/Skeleton_Blade.gltf', texture: 'skeleton_texture.png', ...RIGHT_HAND },
  { name: 'Skeleton_Axe', repo: 'skel', file: 'Assets/gltf/Skeleton_Axe.gltf', texture: 'skeleton_texture.png', ...RIGHT_HAND },
  { name: 'Skeleton_Staff', repo: 'skel', file: 'Assets/gltf/Skeleton_Staff.gltf', texture: 'skeleton_texture.png', ...RIGHT_HAND },
  // (Turned a quarter: crossbows lie along the hand slot's X, as the packs' own do.)
  { name: 'Skeleton_Crossbow', repo: 'skel', file: 'Assets/gltf/Skeleton_Crossbow.gltf', texture: 'skeleton_texture.png', ...RIGHT_HAND, r: [0, Math.SQRT1_2, 0, Math.SQRT1_2] },
  { name: 'Skeleton_Shield_Small_A', repo: 'skel', file: 'Assets/gltf/Skeleton_Shield_Small_A.gltf', texture: 'skeleton_texture.png', ...LEFT_HAND },
  { name: 'Skeleton_Shield_Large_A', repo: 'skel', file: 'Assets/gltf/Skeleton_Shield_Large_A.gltf', texture: 'skeleton_texture.png', ...LEFT_HAND },
  { name: 'Skeleton_Shield_Large_B', repo: 'skel', file: 'Assets/gltf/Skeleton_Shield_Large_B.gltf', texture: 'skeleton_texture.png', ...LEFT_HAND },
];

/** Joints props may hang on even when no vertex is weighted to them. */
const ATTACH_JOINTS = ['handslot.r', 'handslot.l', 'head', 'chest', 'hips'];

// ------------------------------------------------------------------ sources
function fetchSources() {
  mkdirSync(CACHE, { recursive: true });
  for (const [key, r] of Object.entries(REPOS)) {
    const dir = path.join(CACHE, key);
    if (!existsSync(path.join(dir, '.git'))) {
      console.log(`[kaykit] cloning ${r.url}`);
      execFileSync('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', r.url, dir], { stdio: 'inherit' });
    }
    execFileSync('git', ['-C', dir, 'sparse-checkout', 'set', `${r.dir}/Characters/gltf`, `${r.dir}/Assets/gltf`], { stdio: 'inherit' }); // (cone mode keeps the files of parent folders: the licence)
  }
  return CACHE;
}

const srcArg = process.argv.indexOf('--src');
const SRC = srcArg > 0 ? path.resolve(process.argv[srcArg + 1]) : fetchSources();
const srcPath = (repo, file) => path.join(SRC, repo, REPOS[repo].dir, file);

// ------------------------------------------------------------------ glTF reading
function readGltf(file) {
  const buf = readFileSync(file);
  let json;
  let bin;
  if (buf.readUInt32LE(0) === 0x46546c67) {
    const jl = buf.readUInt32LE(12);
    json = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8'));
    bin = buf.subarray(20 + jl + 8);
  } else {
    json = JSON.parse(buf.toString('utf8'));
    bin = readFileSync(path.join(path.dirname(file), json.buffers[0].uri));
  }
  const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const accessor = (i) => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const n = SIZES[a.type];
    const Ctor = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array, 5122: Int16Array, 5120: Int8Array }[a.componentType];
    const stride = bv.byteStride || n * Ctor.BYTES_PER_ELEMENT;
    const start = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const out = new Float32Array(a.count * n);
    const view = new DataView(bin.buffer);
    const get = {
      5126: (o) => view.getFloat32(o, true),
      5125: (o) => view.getUint32(o, true),
      5123: (o) => view.getUint16(o, true) / (a.normalized ? 65535 : 1),
      5121: (o) => view.getUint8(o) / (a.normalized ? 255 : 1),
      5122: (o) => Math.max(-1, view.getInt16(o, true) / (a.normalized ? 32767 : 1)),
      5120: (o) => Math.max(-1, view.getInt8(o) / (a.normalized ? 127 : 1)),
    }[a.componentType];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = get(start + k * stride + c * Ctor.BYTES_PER_ELEMENT);
    return out;
  };
  const parent = new Map();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  return { json, accessor, parent };
}

// ------------------------------------------------------------------ matrices (column-major, glTF)
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function invert(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det, (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det, (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det, (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ];
}
const point = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const dir = (m, x, y, z) => {
  const v = [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
  const l = Math.hypot(...v) || 1;
  return v.map((c) => c / l);
};
const localOf = (n) => (n.matrix ? [...n.matrix] : trs(n.translation, n.rotation, n.scale));

// ------------------------------------------------------------------ animation sampling
function sampler(g, s) {
  const times = g.accessor(s.input);
  const values = g.accessor(s.output);
  const n = values.length / times.length;
  return (t) => {
    if (t <= times[0]) return Array.from(values.subarray(0, n));
    const last = times.length - 1;
    if (t >= times[last]) return Array.from(values.subarray(last * n, last * n + n));
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }
    const k = (t - times[lo]) / (times[hi] - times[lo]);
    const a = values.subarray(lo * n, lo * n + n);
    const b = values.subarray(hi * n, hi * n + n);
    if (s.interpolation === 'STEP') return Array.from(a);
    if (n === 4) {
      // Quaternions: shortest-path normalised lerp (keys are a thirtieth of a second apart).
      const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
      const q = [0, 1, 2, 3].map((i) => a[i] * (1 - k) + b[i] * d * k);
      const l = Math.hypot(...q);
      return q.map((c) => c / l);
    }
    return Array.from(a).map((v, i) => v + (b[i] - v) * k);
  };
}

/** World matrices of every node of the rig file at time t of an animation (null: rest pose). */
function poseAt(g, anim, t, channels) {
  const { json } = g;
  const local = json.nodes.map((n) => ({ t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1], m: n.matrix }));
  if (anim) for (const c of channels) local[c.node][c.path === 'translation' ? 't' : c.path === 'rotation' ? 'r' : 's'] = c.fn(t);
  const world = new Array(json.nodes.length);
  const visit = (i, pm) => {
    const l = local[i];
    world[i] = mul(pm, l.m ? [...l.m] : trs(l.t, l.r, l.s));
    for (const c of json.nodes[i].children ?? []) visit(c, world[i]);
  };
  for (const r of json.scenes[json.scene ?? 0].nodes) visit(r, ident());
  return world;
}

// ------------------------------------------------------------------ build
const half = (() => {
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  return (v) => {
    f[0] = v;
    const x = u[0];
    const sign = (x >> 16) & 0x8000;
    let e = ((x >> 23) & 0xff) - 127 + 15;
    let m = x & 0x7fffff;
    if (e <= 0) return sign;
    if (e >= 31) return sign | 0x7c00;
    m += 0x1000; // round to nearest
    if (m & 0x800000) {
      m = 0;
      e++;
      if (e >= 31) return sign | 0x7c00;
    }
    return sign | (e << 10) | (m >> 13);
  };
})();

const chunks = [];
let binLength = 0;
/** Append a typed array to the binary part (4-byte aligned) and return its offset. */
function put(arr) {
  const pad = (4 - (binLength % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    binLength += pad;
  }
  const off = binLength;
  const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  chunks.push(Buffer.from(b));
  binLength += b.length;
  return off;
}

const out = { version: 1, fps: FPS, rigs: {}, pieces: [], textures: [] };

// Rigs: joints used, inverse binds, animations.
const rigFiles = {};
for (const [name, rig] of Object.entries(RIGS)) rigFiles[name] = readGltf(srcPath(rig.repo, rig.file));

// Joints used per rig: weighted by any body vertex, plus attachment joints.
const usedJoints = Object.fromEntries(Object.keys(RIGS).map((r) => [r, new Set(ATTACH_JOINTS)]));
const charFiles = CHARACTERS.map((c) => ({ c, g: readGltf(srcPath(c.repo, c.file)) }));
for (const { c, g } of charFiles) {
  const skin = g.json.skins[0];
  for (const n of g.json.nodes) {
    if (n.mesh === undefined || n.skin === undefined) continue;
    for (const p of g.json.meshes[n.mesh].primitives) {
      const j = g.accessor(p.attributes.JOINTS_0);
      const w = g.accessor(p.attributes.WEIGHTS_0);
      for (let i = 0; i < j.length; i++) if (w[i] > 0) usedJoints[c.rig].add(g.json.nodes[skin.joints[j[i]]].name);
    }
  }
}

for (const [rigName, rig] of Object.entries(RIGS)) {
  const g = rigFiles[rigName];
  const skin = g.json.skins[0];
  const ibmAll = g.accessor(skin.inverseBindMatrices);
  const jointNames = skin.joints.map((i) => g.json.nodes[i].name).filter((n) => usedJoints[rigName].has(n));
  const jointNode = jointNames.map((n) => g.json.nodes.findIndex((x) => x.name === n));
  const ibm = jointNode.map((ni) => {
    const k = skin.joints.indexOf(ni);
    return Array.from(ibmAll.subarray(k * 16, k * 16 + 16));
  });
  const nodeIndex = (name) => g.json.nodes.findIndex((x) => x.name === name);
  const anims = {};
  const rows = [];
  for (const an of rig.anims) {
    const a = g.json.animations.find((x) => x.name === an);
    if (!a) throw new Error(`${rigName}: no animation ${an}`);
    const channels = a.channels.map((ch) => ({ node: ch.target.node, path: ch.target.path, fn: sampler(g, a.samplers[ch.sampler]) }));
    let duration = 0;
    for (const s of a.samplers) {
      const times = g.accessor(s.input);
      duration = Math.max(duration, times[times.length - 1]);
    }
    const frames = Math.max(1, Math.round(duration * FPS) + 1);
    const start = rows.length;
    const hand = [];
    const feet = [];
    for (let f = 0; f < frames; f++) {
      const world = poseAt(g, a, Math.min(duration, f / FPS), channels);
      const row = new Float32Array(jointNames.length * 12);
      jointNode.forEach((ni, k) => {
        const m = mul(world[ni], ibm[k]);
        // Three rows of the affine matrix (column-vector convention): r_i = (m0i, m1i, m2i, ti).
        for (let r = 0; r < 3; r++) {
          row[k * 12 + r * 4 + 0] = m[r];
          row[k * 12 + r * 4 + 1] = m[4 + r];
          row[k * 12 + r * 4 + 2] = m[8 + r];
          row[k * 12 + r * 4 + 3] = m[12 + r];
        }
      });
      rows.push(row);
      const h = world[nodeIndex('handslot.r')];
      hand.push([h[12], h[13], h[14]]);
      const fl = world[nodeIndex('toes.l')];
      const fr = world[nodeIndex('toes.r')];
      feet.push([[fl[12], fl[13], fl[14]], [fr[12], fr[13], fr[14]]]);
    }
    const info = { start, frames, duration: +duration.toFixed(4) };
    if (/Walking|Running/.test(an)) {
      // Ground speed: how fast the planted (lower) foot slides backward, averaged over the cycle.
      let sum = 0;
      let n = 0;
      for (let f = 1; f < frames; f++) {
        const lo = feet[f][0][1] < feet[f][1][1] ? 0 : 1;
        const dz = feet[f][lo][2] - feet[f - 1][lo][2];
        if (dz < 0) {
          sum += -dz * FPS;
          n++;
        }
      }
      info.groundSpeed = +(n ? sum / n : 1).toFixed(3);
    }
    if (/Attack|Shoot|Throw|Punch|Kick|Spellcast_Shoot/.test(an)) {
      // Impact: the frame where the weapon hand moves fastest (in the first 80% of the clip).
      let best = 0;
      let bestF = Math.round(frames * 0.4);
      for (let f = 1; f < Math.floor(frames * 0.8); f++) {
        const v = Math.hypot(hand[f][0] - hand[f - 1][0], hand[f][1] - hand[f - 1][1], hand[f][2] - hand[f - 1][2]);
        if (v > best) {
          best = v;
          bestF = f;
        }
      }
      info.impact = +(bestF / FPS).toFixed(3);
    }
    anims[an] = info;
  }
  const width = jointNames.length * 3;
  const data = new Uint16Array(width * 4 * rows.length);
  rows.forEach((row, r) => row.forEach((v, i) => (data[r * width * 4 + i] = half(v))));
  out.rigs[rigName] = {
    joints: jointNames,
    bindWorld: ibm.map((m) => invert(m).map((v) => +v.toFixed(6))),
    vat: { offset: put(data), width, height: rows.length },
    anims,
  };
  console.log(`[kaykit] rig ${rigName}: ${jointNames.length} joints, ${Object.keys(anims).length} animations, ${rows.length} frames, ${(data.byteLength / 1024).toFixed(0)} KB`);
}

/** Weights as bytes, four per vertex, still summing to exactly 255. */
function quantizeWeights(w) {
  const out = new Uint8Array(w.length);
  for (let i = 0; i < w.length; i += 4) {
    let sum = 0;
    for (let k = 1; k < 4; k++) sum += out[i + k] = Math.round(w[i + k] * 255);
    out[i] = 255 - sum;
  }
  return out;
}

/** A mesh piece: merged primitives with skin data remapped to the rig's joints. */
function writePiece(name, rigName, texture, parts, extra) {
  const rig = out.rigs[rigName];
  const pos = [];
  const nrm = [];
  const uv = [];
  const jnt = [];
  const wgt = [];
  const idx = [];
  const cells = new Map();
  for (const p of parts) {
    const base = pos.length / 3;
    const n = p.pos.length / 3;
    for (let i = 0; i < n; i++) {
      pos.push(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]);
      nrm.push(p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]);
      const u = p.uv[i * 2];
      const v = p.uv[i * 2 + 1];
      uv.push(u, v);
      const cell = `${Math.min(7, Math.floor(u * 8))},${Math.min(3, Math.floor(v * 4))}`;
      cells.set(cell, (cells.get(cell) ?? 0) + 1);
      // Up to four influences, largest first, renormalised.
      const inf = [0, 1, 2, 3].map((k) => [p.jnt[i * 4 + k], p.wgt[i * 4 + k]]).filter((x) => x[1] > 0.001).sort((a, b) => b[1] - a[1]);
      const sum = inf.reduce((s, x) => s + x[1], 0) || 1;
      for (let k = 0; k < 4; k++) {
        const x = inf[k];
        const ji = x ? rig.joints.indexOf(x[0]) : 0;
        if (x && ji < 0) throw new Error(`${name}: joint ${x[0]} not in rig ${rigName}`);
        jnt.push(x ? ji : 0);
        wgt.push(x ? x[1] / sum : 0);
      }
    }
    for (const i of p.idx) idx.push(base + i);
  }
  const vcount = pos.length / 3;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxR = 0;
  for (let i = 0; i < vcount; i++) {
    minY = Math.min(minY, pos[i * 3 + 1]);
    maxY = Math.max(maxY, pos[i * 3 + 1]);
    maxR = Math.max(maxR, Math.hypot(pos[i * 3], pos[i * 3 + 2]));
  }
  const piece = {
    name,
    rig: rigName,
    texture,
    vertices: vcount,
    indices: idx.length,
    bounds: { minY: +minY.toFixed(3), maxY: +maxY.toFixed(3), radius: +maxR.toFixed(3) },
    position: put(new Float32Array(pos)),
    normal: put(Int8Array.from(nrm, (v) => Math.round(Math.max(-1, Math.min(1, v)) * 127))),
    uv: put(Uint16Array.from(uv, (v) => Math.round(Math.max(0, Math.min(1, v)) * 65535))),
    joints: put(new Uint8Array(jnt)),
    weights: put(quantizeWeights(wgt)),
    index: put(vcount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)),
    index32: vcount > 65535,
    ...extra,
  };
  out.pieces.push(piece);
  return { piece, cells };
}

/** Geometry of one mesh, with positions and normals transformed by m. */
function meshGeometry(g, meshIndex, m) {
  const parts = [];
  for (const p of g.json.meshes[meshIndex].primitives) {
    const P = g.accessor(p.attributes.POSITION);
    const N = g.accessor(p.attributes.NORMAL);
    const UV = g.accessor(p.attributes.TEXCOORD_0);
    const n = P.length / 3;
    const pos = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set(m ? point(m, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]) : [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], i * 3);
      nrm.set(m ? dir(m, N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) : [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], i * 3);
    }
    parts.push({ pos, nrm, uv: UV, idx: g.accessor(p.indices), prim: p });
  }
  return parts;
}

const textures = new Set();
for (const { c, g } of charFiles) {
  textures.add(c.texture);
  const skin = g.json.skins[0];
  const jointName = (k) => g.json.nodes[skin.joints[k]].name;
  // The body: every skinned mesh, merged, in bind space.
  const body = [];
  for (const n of g.json.nodes) {
    if (n.mesh === undefined || n.skin === undefined) continue;
    for (const part of meshGeometry(g, n.mesh, null)) {
      const J = g.accessor(part.prim.attributes.JOINTS_0);
      const W = g.accessor(part.prim.attributes.WEIGHTS_0);
      part.jnt = Array.from(J, (k) => jointName(k));
      part.wgt = W;
      body.push(part);
    }
  }
  const { piece, cells } = writePiece(`${c.name}`, c.rig, c.texture, body, { kind: 'body' });
  const used = [...cells.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`[kaykit] ${c.name}: ${piece.vertices} vertices, ${piece.indices / 3} triangles, height ${(piece.bounds.maxY - piece.bounds.minY).toFixed(2)}; swatches ${used}`);
  // Props: rigid meshes below a joint, in that joint's space.
  g.json.nodes.forEach((n, i) => {
    if (n.mesh === undefined || n.skin !== undefined) return;
    let m = localOf(n);
    let p = g.parent.get(i);
    while (p !== undefined && !skin.joints.includes(p)) {
      m = mul(localOf(g.json.nodes[p]), m);
      p = g.parent.get(p);
    }
    if (p === undefined) return;
    const joint = g.json.nodes[p].name;
    const parts = meshGeometry(g, n.mesh, m).map((part) => ({ ...part, jnt: new Array(part.pos.length / 3 * 4).fill(joint), wgt: Float32Array.from({ length: (part.pos.length / 3) * 4 }, (_, k) => (k % 4 === 0 ? 1 : 0)) }));
    const pc = writePiece(`${c.name}/${n.name}`, c.rig, c.texture, parts, { kind: 'prop', joint });
    const sw = [...pc.cells.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(`[kaykit]   prop ${pc.piece.name} on ${joint}: ${pc.piece.indices / 3} triangles; swatches ${sw}`);
  });
}
for (const pr of PROPS) {
  textures.add(pr.texture);
  const g = readGltf(srcPath(pr.repo, pr.file));
  // The file's scene: one or more mesh nodes; their transforms, then the wearing offset.
  const wear = trs(pr.t, pr.r);
  const parts = [];
  for (const root of g.json.scenes[g.json.scene ?? 0].nodes) {
    const visit = (i, pm) => {
      const n = g.json.nodes[i];
      const m = mul(pm, localOf(n));
      if (n.mesh !== undefined) parts.push(...meshGeometry(g, n.mesh, m));
      for (const c of n.children ?? []) visit(c, m);
    };
    visit(root, wear);
  }
  const withSkin = parts.map((part) => ({ ...part, jnt: new Array((part.pos.length / 3) * 4).fill(pr.joint), wgt: Float32Array.from({ length: (part.pos.length / 3) * 4 }, (_, k) => (k % 4 === 0 ? 1 : 0)) }));
  const pc = writePiece(pr.name, 'skel', pr.texture, withSkin, { kind: 'prop', joint: pr.joint });
  const sw = [...pc.cells.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`[kaykit]   prop ${pc.piece.name} on ${pr.joint}: ${pc.piece.indices / 3} triangles; swatches ${sw}`);
}
out.textures = [...textures];

// ------------------------------------------------------------------ write
mkdirSync(OUT_DIR, { recursive: true });
const json = Buffer.from(JSON.stringify(out));
const jsonPad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
const header = Buffer.alloc(8);
header.write('KKC1', 0, 'ascii');
header.writeUInt32LE(json.length + jsonPad.length, 4);
writeFileSync(path.join(OUT_DIR, 'kaykit.bin'), Buffer.concat([header, json, jsonPad, ...chunks]));
for (const t of textures) {
  const from = CHARACTERS.find((c) => c.texture === t);
  copyFileSync(srcPath(from.repo, path.join(path.dirname(from.file), t)), path.join(OUT_DIR, t));
}
copyFileSync(srcPath('adv', 'LICENSE.txt'), path.join(OUT_DIR, 'LICENSE-adventurers.txt'));
copyFileSync(srcPath('skel', 'LICENSE.txt'), path.join(OUT_DIR, 'LICENSE-skeletons.txt'));
console.log(`[kaykit] wrote ${path.relative(ROOT, OUT_DIR)}/kaykit.bin (${((8 + json.length + binLength) / 1024 / 1024).toFixed(2)} MB) and ${textures.size} textures`);
