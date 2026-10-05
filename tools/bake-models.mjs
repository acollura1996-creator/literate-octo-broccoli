// Bakes every procedural model (tools/models/*) into one binary glTF file,
// src/generated/models.glb, for the game's Babylon.js renderer (MIGRATION.md, decision D1).
//
//   node tools/bake-models.mjs [--force]
//
// The builders are the original procedural models, written with three.js geometry. three.js needs
// no WebGL for that, so they run here in Node at build time; three.js is a devDependency only. The
// game loads the GLB with @babylonjs/loaders and contains no three.js. The bake is skipped when the
// GLB is newer than every input.
//
// What goes into the file:
//   - One root node per model, named after the model id. Its `extras` hold `height`, `radius` and
//     `parts`, the animation handles (legs, arms, weapon, doors, …) as node names, in the shape
//     built by buildTemplate() in tools/models/models.js.
//   - Nodes keep the builders' hierarchy and transforms (three.js and glTF are both right-handed,
//     Y up, +Z forward).
//   - Flat-shaded materials (the default in the builders) get no normals: the renderer derives
//     face normals from screen-space derivatives, as three.js does for `flatShading`. Smooth
//     materials keep their vertex normals. Vertices are welded and indexed.
//   - Materials hold linear colours, plus `extras` with what glTF has no field for:
//       team / teamEmissive: [k, b_r, b_g, b_b]  the colour is k × team colour + b (linear)
//       flat, depthWrite (and castShadow / receiveShadow on mesh nodes)
//     Team-coloured materials are found by building each model with two different team colours
//     and comparing.
import { mkdirSync, statSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_IDS, buildTemplate } from './models/models.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/generated/models.glb');
const INPUTS = [
  path.join(ROOT, 'tools/models/models'),
  path.join(ROOT, 'tools/models/models.js'),
  path.join(ROOT, 'tools/models/assets.js'),
  fileURLToPath(import.meta.url),
];

// Two unusual team colours (so no builder palette colour collides with them) and a third to
// validate that team-derived colours are linear in the team colour.
const TEAM_A = 0x13579b;
const TEAM_B = 0xeca864;
const TEAM_C = 0x6a2fd0;

// ------------------------------------------------------------------ freshness
function newestMtime(p) {
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  let t = st.mtimeMs;
  for (const f of readdirSync(p)) t = Math.max(t, newestMtime(path.join(p, f)));
  return t;
}

const force = process.argv.includes('--force');
if (!force && existsSync(OUT) && statSync(OUT).mtimeMs > Math.max(...INPUTS.map(newestMtime))) {
  console.log('[bake-models] up to date');
  process.exit(0);
}

// ------------------------------------------------------------------ GLB writer
class GlbWriter {
  constructor() {
    this.json = {
      asset: { version: '2.0', generator: 'heroes-empires bake-models' },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      meshes: [],
      materials: [],
      accessors: [],
      bufferViews: [],
      buffers: [{ byteLength: 0 }],
    };
    this.chunks = [];
    this.byteLength = 0;
  }

  /** Append typed-array data as a buffer view (4-byte aligned) and return an accessor index. */
  accessor(array, type, componentType, count, extra = {}, target) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.byteLength += pad;
    }
    const view = { buffer: 0, byteOffset: this.byteLength, byteLength: bytes.byteLength };
    if (target) view.target = target;
    this.json.bufferViews.push(view);
    this.chunks.push(bytes);
    this.byteLength += bytes.byteLength;
    this.json.accessors.push({ bufferView: this.json.bufferViews.length - 1, componentType, count, type, ...extra });
    return this.json.accessors.length - 1;
  }

  toBuffer() {
    const bin = new Uint8Array(Math.ceil(this.byteLength / 4) * 4);
    let o = 0;
    for (const c of this.chunks) {
      bin.set(c, o);
      o += c.byteLength;
    }
    this.json.buffers[0].byteLength = bin.byteLength;
    let jsonBytes = new TextEncoder().encode(JSON.stringify(this.json));
    const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
    if (jsonPad) {
      const padded = new Uint8Array(jsonBytes.byteLength + jsonPad).fill(0x20);
      padded.set(jsonBytes);
      jsonBytes = padded;
    }
    const total = 12 + 8 + jsonBytes.byteLength + 8 + bin.byteLength;
    const out = Buffer.alloc(total);
    out.writeUInt32LE(0x46546c67, 0); // 'glTF'
    out.writeUInt32LE(2, 4);
    out.writeUInt32LE(total, 8);
    out.writeUInt32LE(jsonBytes.byteLength, 12);
    out.writeUInt32LE(0x4e4f534a, 16); // 'JSON'
    out.set(jsonBytes, 20);
    const b = 20 + jsonBytes.byteLength;
    out.writeUInt32LE(bin.byteLength, b);
    out.writeUInt32LE(0x004e4942, b + 4); // 'BIN\0'
    out.set(bin, b + 8);
    return out;
  }
}

const FLOAT = 5126;
const UINT16 = 5123;
const UINT32 = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

const lin = (c) => [c.r, c.g, c.b];
const round = (v) => Math.round(v * 1e5) / 1e5;

// ------------------------------------------------------------------ team colours
function walk(root, fn) {
  const order = [];
  root.traverse((o) => order.push(o));
  order.forEach(fn);
  return order;
}

/** Per mesh index: { team?: k[3], teamEmissive?: k[3] } by comparing builds with two team colours. */
function teamInfo(id) {
  const builds = [TEAM_A, TEAM_B, TEAM_C].map((c) => buildTemplate(id, c));
  const meshes = builds.map((b) => {
    const list = [];
    b.root.traverse((o) => o.isMesh && list.push(o));
    return list;
  });
  if (meshes[1].length !== meshes[0].length || meshes[2].length !== meshes[0].length) {
    throw new Error(`${id}: structure differs between team colours`);
  }
  const tA = lin(new THREE.Color(TEAM_A));
  const tB = lin(new THREE.Color(TEAM_B));
  const tC = lin(new THREE.Color(TEAM_C));
  // Colour = k × team + b (linear): mat(team) is k = 1, shade(team, k) scales, and a blend
  // toward another colour such as lerp(white, t) adds an offset. Returns [k, b_r, b_g, b_b].
  const solve = (cA, cB, cC, label) => {
    if (cA.every((v, i) => Math.abs(v - cB[i]) < 1e-4)) return null;
    const ks = cA.map((v, i) => (v - cB[i]) / (tA[i] - tB[i]));
    const k = (ks[0] + ks[1] + ks[2]) / 3;
    const b = cA.map((v, i) => v - k * tA[i]);
    const ok = [cA, cB, cC].every((c, j) => c.every((v, i) => Math.abs(k * [tA, tB, tC][j][i] + b[i] - v) < 0.02));
    if (!ok) throw new Error(`${id}: ${label} colour is not k × team colour + b`);
    return [k, ...b].map(round);
  };
  return meshes[0].map((m, i) => {
    const [a, b, c] = [m.material, meshes[1][i].material, meshes[2][i].material];
    const info = {};
    const team = solve(lin(a.color), lin(b.color), lin(c.color), 'base');
    if (team) info.team = team;
    const em = (x) => lin(x.emissive).map((v) => v * x.emissiveIntensity);
    const teamEmissive = solve(em(a), em(b), em(c), 'emissive');
    if (teamEmissive) info.teamEmissive = teamEmissive;
    return info;
  });
}

// ------------------------------------------------------------------ bake
const w = new GlbWriter();
const geometryCache = new Map(); // `${geometry.uuid}|${flat}` -> primitive attributes
const materialCache = new Map(); // key -> material index
const meshCache = new Map(); // `${prim}|${material}|${flags}` -> mesh index
let vertexTotal = 0;

function primitiveFor(geometry, flat) {
  const key = `${geometry.uuid}|${flat ? 1 : 0}`;
  let p = geometryCache.get(key);
  if (p) return p;
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', geometry.attributes.position.clone());
  if (!flat) {
    let normal = geometry.attributes.normal;
    if (!normal) {
      const c = geometry.clone();
      c.computeVertexNormals();
      normal = c.attributes.normal;
    }
    g.setAttribute('normal', normal.clone());
  }
  if (geometry.index) g.setIndex(geometry.index.clone());
  g = mergeVertices(g, 1e-5);
  if (!g.index) {
    const n = g.attributes.position.count;
    g.setIndex(Array.from({ length: n }, (_, i) => i));
  }
  const pos = g.attributes.position;
  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) positions.set([pos.getX(i), pos.getY(i), pos.getZ(i)], i * 3);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const attributes = {
    POSITION: w.accessor(positions, 'VEC3', FLOAT, pos.count, { min: bb.min.toArray(), max: bb.max.toArray() }, ARRAY_BUFFER),
  };
  if (!flat) {
    const nor = g.attributes.normal;
    const normals = new Float32Array(nor.count * 3);
    for (let i = 0; i < nor.count; i++) {
      const v = new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i)).normalize();
      normals.set([v.x, v.y, v.z], i * 3);
    }
    attributes.NORMAL = w.accessor(normals, 'VEC3', FLOAT, nor.count, {}, ARRAY_BUFFER);
  }
  const idx = g.index.array;
  const big = pos.count > 65535;
  const indices = big ? new Uint32Array(idx) : new Uint16Array(idx);
  p = { attributes, indices: w.accessor(indices, 'SCALAR', big ? UINT32 : UINT16, indices.length, {}, ELEMENT_ARRAY_BUFFER) };
  vertexTotal += pos.count;
  geometryCache.set(key, p);
  return p;
}

function materialFor(m, info) {
  const flat = m.flatShading !== false;
  // Team-coloured: the stored colour is the one for a white team (k + b), and extras carry k, b.
  const white = (t) => [t[0] + t[1], t[0] + t[2], t[0] + t[3]].map((v) => Math.min(1, Math.max(0, v)));
  const color = info.team ? white(info.team) : lin(m.color);
  const emissive = info.teamEmissive ? white(info.teamEmissive) : lin(m.emissive).map((v) => Math.min(1, v * m.emissiveIntensity));
  const extras = { flat };
  if (info.team) extras.team = info.team;
  if (info.teamEmissive) extras.teamEmissive = info.teamEmissive;
  if (m.depthWrite === false) extras.depthWrite = false;
  const def = {
    pbrMetallicRoughness: { baseColorFactor: [...color.map(round), round(m.transparent ? m.opacity : 1)], metallicFactor: 0, roughnessFactor: 1 },
    extras,
  };
  if (emissive.some((v) => v > 0)) def.emissiveFactor = emissive.map(round);
  if (m.transparent) def.alphaMode = 'BLEND';
  if (m.side === THREE.DoubleSide) def.doubleSided = true;
  const key = JSON.stringify(def);
  let i = materialCache.get(key);
  if (i === undefined) {
    def.name = `m${w.json.materials.length}`;
    w.json.materials.push(def);
    i = w.json.materials.length - 1;
    materialCache.set(key, i);
  }
  return i;
}

function meshFor(o, info) {
  const flat = o.material.flatShading !== false;
  const prim = primitiveFor(o.geometry, flat);
  const material = materialFor(o.material, info);
  const key = `${prim.indices}|${material}`;
  let i = meshCache.get(key);
  if (i === undefined) {
    w.json.meshes.push({ primitives: [{ attributes: prim.attributes, indices: prim.indices, material }] });
    i = w.json.meshes.length - 1;
    meshCache.set(key, i);
  }
  return i;
}

const t0 = performance.now();
let meshCount = 0;
let teamCount = 0;
for (const id of MODEL_IDS) {
  const t = buildTemplate(id, TEAM_A);
  const info = teamInfo(id);
  const names = new Map(); // three node -> unique node name within the model
  const nodeIndex = new Map();
  let meshI = 0;
  walk(t.root, (o) => names.set(o, o === t.root ? id : `${id}/${names.size}`));
  const addNode = (o) => {
    const node = { name: names.get(o) };
    if (o.position.lengthSq() > 0) node.translation = o.position.toArray().map(round);
    if (Math.abs(o.quaternion.w - 1) > 1e-7) node.rotation = o.quaternion.toArray().map((v) => Math.round(v * 1e7) / 1e7);
    if (o.scale.x !== 1 || o.scale.y !== 1 || o.scale.z !== 1) node.scale = o.scale.toArray().map(round);
    if (o.isMesh) {
      const mi = info[meshI++];
      if (mi.team || mi.teamEmissive) teamCount++;
      node.mesh = meshFor(o, mi);
      // Shadow flags (node extras: Babylon's loader keeps node and material extras as metadata).
      const shadow = {};
      if (o.castShadow) shadow.castShadow = true;
      if (o.receiveShadow) shadow.receiveShadow = true;
      if (shadow.castShadow || shadow.receiveShadow) node.extras = shadow;
      meshCount++;
    }
    w.json.nodes.push(node);
    const index = w.json.nodes.length - 1;
    nodeIndex.set(o, index);
    const children = o.children.map(addNode);
    if (children.length) node.children = children;
    return index;
  };
  // Mesh order must match teamInfo(), which uses traverse() order; addNode is depth-first in the
  // same order.
  const rootIndex = addNode(t.root);
  // Animation handles: node paths → node names.
  const nodeAtPath = (p) => p.reduce((n, i) => n.children[i], t.root);
  const parts = {};
  for (const [k, v] of Object.entries(t.spec)) {
    if (v.nodes) parts[k] = v.nodes.map((p) => names.get(nodeAtPath(p)));
    else if (v.entries) parts[k] = v.entries.map((e) => ({ ...e, obj: names.get(nodeAtPath(e.obj)) }));
    else parts[k] = names.get(nodeAtPath(v.node));
  }
  w.json.nodes[rootIndex].extras = { model: id, height: t.height ?? null, radius: t.radius ?? null, parts };
  w.json.scenes[0].nodes.push(rootIndex);
}

mkdirSync(path.dirname(OUT), { recursive: true });
const buf = w.toBuffer();
writeFileSync(OUT, buf);
console.log(
  `[bake-models] ${MODEL_IDS.length} models, ${meshCount} meshes (${teamCount} team-coloured), ${w.json.meshes.length} unique meshes, ` +
    `${w.json.materials.length} materials, ${vertexTotal} vertices → ${path.relative(ROOT, OUT)} (${(buf.byteLength / 1024 / 1024).toFixed(2)} MB) in ${Math.round(performance.now() - t0)} ms`,
);
