// One Warcraft III model (mdx.ts) to the game's character format: a mesh skinned to the model's own
// nodes, every chosen sequence sampled into skinning matrices (the rows of the vertex animation
// texture), geoset visibility per frame, and per-vertex material modes:
//
//   0 opaque, 2 team colour under the texture (shows where its alpha is low), 3 alpha-tested,
//   4 solid team colour.
//
// Coordinates: Warcraft III is Z up and faces +X; the game (like glTF) is Y up and faces +Z, so
// (x, y, z) → (y, z, x), a rotation, which keeps the triangles' winding. Model units are Warcraft III
// units / 100.
import type { Geoset, Model, Node, Track } from './mdx';

export const UNIT = 0.01;

export interface ClipOut {
  /** Frame rows: the clip's first row in the rig, and how many. */
  start: number;
  frames: number;
  duration: number;
  /** Model units a second the walk was made for (sequence move speed). */
  moveSpeed: number;
  nonLooping: boolean;
}

export interface ConvertedModel {
  /** Joint names (unique). */
  joints: string[];
  /** Each joint's rest frame (its pivot), column-major. */
  bindWorld: number[][];
  /** Visibility slots after the joints in each row. */
  vis: number;
  /** Rows: joints × 12 floats (three affine rows each), then the visibility slots. */
  rows: Float32Array[];
  clips: Record<string, ClipOut>;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  joints4: Uint8Array;
  weights4: Uint8Array;
  indices: Uint16Array | Uint32Array;
  /** Per vertex: mode, texture (index into `textures`), visibility slot (-1 always visible), glow 0-255. */
  meta: Int16Array;
  /** Texture paths as the model names them, or '' for none. */
  textures: string[];
  bounds: { minY: number; maxY: number; radius: number };
  /** Attachment points: joint index by name ("Hand Right", "Overhead", ...). */
  attach: Record<string, number>;
  report: ConvertReport;
}

export interface ConvertReport {
  version: number;
  sequences: string[];
  kept: string[];
  geosets: Array<{ index: number; vertices: number; triangles: number; kept: boolean; why: string; mode?: number; texture?: string }>;
  joints: number;
  frames: number;
  warnings: string[];
}

export interface ConvertOptions {
  /** Which sequences to keep (by name, trimmed). */
  keep: (name: string) => boolean;
  fps: number;
  /** Keep geosets drawn additively (wisps, ghosts, spirits are made of them). */
  keepEffects?: boolean;
}

// ------------------------------------------------------------------ math (column-major 4 × 4)
type Mat = Float64Array;
const ident = (): Mat => {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};
function mul(a: Mat, b: Mat, out: Mat = new Float64Array(16)): Mat {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
  return out;
}
/** T(p + t) · R(q) · S(s) · T(-p): a node's local transform about its pivot. */
function nodeLocal(p: ArrayLike<number>, t: number[], q: number[], s: number[]): Mat {
  const [x, y, z, w] = q as [number, number, number, number];
  const m = new Float64Array(16);
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  // R · S
  m[0] = (1 - 2 * (yy + zz)) * s[0]!;
  m[1] = 2 * (xy + wz) * s[0]!;
  m[2] = 2 * (xz - wy) * s[0]!;
  m[4] = 2 * (xy - wz) * s[1]!;
  m[5] = (1 - 2 * (xx + zz)) * s[1]!;
  m[6] = 2 * (yz + wx) * s[1]!;
  m[8] = 2 * (xz + wy) * s[2]!;
  m[9] = 2 * (yz - wx) * s[2]!;
  m[10] = (1 - 2 * (xx + yy)) * s[2]!;
  m[15] = 1;
  // translation: p + t - RS·p
  for (let r = 0; r < 3; r++) m[12 + r] = p[r]! + t[r]! - (m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]!);
  return m;
}

// ------------------------------------------------------------------ tracks
function slerp(a: number[], b: number[], k: number): number[] {
  let [bx, by, bz, bw] = b as [number, number, number, number];
  let d = a[0]! * bx + a[1]! * by + a[2]! * bz + a[3]! * bw;
  if (d < 0) {
    d = -d;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let ka = 1 - k;
  let kb = k;
  if (d < 0.9995) {
    const th = Math.acos(Math.min(1, d));
    const sn = Math.sin(th);
    ka = Math.sin((1 - k) * th) / sn;
    kb = Math.sin(k * th) / sn;
  }
  const q = [a[0]! * ka + bx * kb, a[1]! * ka + by * kb, a[2]! * ka + bz * kb, a[3]! * ka + bw * kb];
  const n = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!) || 1;
  return q.map((v) => v / n);
}

/**
 * A track's value at `time` (ms) while the sequence [from, to] plays, as Warcraft III does it: only
 * keys inside the sequence count; before the first and after the last the value holds; with no
 * keys inside, the default. Tracks on a global sequence run on their own clock.
 */
function sample(track: Track<number[]> | null, time: number, from: number, to: number, globals: number[], def: number[], rotation = false): number[] {
  if (!track || !track.keys.length) return def;
  let t = time;
  if (track.globalSeq >= 0) {
    const len = globals[track.globalSeq] ?? 0;
    from = 0;
    to = len;
    t = len > 0 ? (time - from) % len : 0;
  }
  const keys = track.keys;
  let lo = -1;
  let hi = -1;
  for (let i = 0; i < keys.length; i++) {
    const kt = keys[i]!.time;
    if (kt < from || kt > to) continue;
    if (lo < 0) lo = i;
    hi = i;
  }
  if (lo < 0) return def;
  if (t <= keys[lo]!.time) return keys[lo]!.value;
  if (t >= keys[hi]!.time) return keys[hi]!.value;
  let i = lo;
  while (i < hi && keys[i + 1]!.time <= t) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  if (track.interp === 0) return a.value;
  const k = (t - a.time) / Math.max(1, b.time - a.time);
  if (rotation) return slerp(a.value, b.value, k);
  if (track.interp === 1 || !a.outTan || !b.inTan) return a.value.map((v, c) => v + (b.value[c]! - v) * k);
  if (track.interp === 2) {
    // Hermite.
    const k2 = k * k, k3 = k2 * k;
    const h1 = 2 * k3 - 3 * k2 + 1, h2 = k3 - 2 * k2 + k, h3 = k3 - k2, h4 = -2 * k3 + 3 * k2;
    return a.value.map((v, c) => v * h1 + a.outTan![c]! * h2 + b.inTan![c]! * h3 + b.value[c]! * h4);
  }
  // Bezier.
  const ik = 1 - k;
  const b1 = ik * ik * ik, b2 = 3 * k * ik * ik, b3 = 3 * k * k * ik, b4 = k * k * k;
  return a.value.map((v, c) => v * b1 + a.outTan![c]! * b2 + b.inTan![c]! * b3 + b.value[c]! * b4);
}

// ------------------------------------------------------------------ conversion
const ATTACH_POINTS = ['Hand Right', 'Hand Left', 'Weapon', 'Overhead', 'Head', 'Chest', 'Origin', 'Foot Left', 'Foot Right'];

/** Warcraft III → game coordinates for a point or direction. */
const toGame = (x: number, y: number, z: number, s = 1): [number, number, number] => [y * s, z * s, x * s];

export function convertModel(m: Model, opts: ConvertOptions): ConvertedModel {
  const warnings: string[] = [...m.warnings];
  const report: ConvertReport = { version: m.version, sequences: m.sequences.map((s) => s.name), kept: [], geosets: [], joints: 0, frames: 0, warnings };
  const pivot = (id: number): number[] => [m.pivots[id * 3] ?? 0, m.pivots[id * 3 + 1] ?? 0, m.pivots[id * 3 + 2] ?? 0];

  // Sequences and the times sampled for each (the last frame at end - 1: a key at the very end may
  // already belong to what follows).
  const seqs = m.sequences.filter((s) => opts.keep(s.name));
  report.kept = seqs.map((s) => s.name);
  const samples: Array<{ seq: (typeof seqs)[number]; time: number }> = [];
  const clips: Record<string, ClipOut> = {};
  for (const s of seqs) {
    const dur = Math.max(0, s.end - s.start) / 1000;
    const frames = Math.max(1, Math.round(dur * opts.fps) + 1);
    if (clips[s.name]) continue; // (duplicate names: the first)
    clips[s.name] = { start: samples.length, frames, duration: frames > 1 ? (frames - 1) / opts.fps : 0, moveSpeed: s.moveSpeed * UNIT, nonLooping: s.nonLooping };
    for (let f = 0; f < frames; f++) samples.push({ seq: s, time: Math.min(s.start + (f / opts.fps) * 1000, Math.max(s.start, s.end - 1)) });
  }
  report.frames = samples.length;

  // Geoset alpha per sampled frame.
  const geosetAlpha = (gi: number, smp: (typeof samples)[number]): number => {
    const ga = m.geosetAnims.find((a) => a.geosetId === gi);
    if (!ga) return 1;
    return sample(ga.alphaTrack as Track<number[]> | null, smp.time, smp.seq.start, smp.seq.end, m.globalSequences, [ga.alpha])[0]!;
  };

  // Which geosets to draw, and how.
  interface Kept {
    g: Geoset;
    index: number;
    mode: number;
    texture: string;
    glow: number;
    visibility: boolean[] | null;
  }
  const kept: Kept[] = [];
  const lowestLod = Math.min(...m.geosets.map((g) => g.lod));
  m.geosets.forEach((g, index) => {
    const entry = { index, vertices: g.vertices.length / 3, triangles: g.faces.length / 3, kept: false, why: '' };
    report.geosets.push(entry);
    if (g.lod !== lowestLod) return void (entry.why = `level of detail ${g.lod}`);
    const mat = m.materials[g.materialId];
    if (!mat || !mat.layers.length) return void (entry.why = 'no material');
    const tex = (id: number) => m.textures[id];
    const team = mat.layers.find((l) => tex(l.textureId)?.replaceableId === 1);
    const diffuse = mat.layers.find((l) => {
      const t = tex(l.textureId);
      return t && t.replaceableId === 0 && t.path;
    });
    let mode: number;
    let texture = '';
    if (diffuse) {
      texture = tex(diffuse.textureId)!.path;
      if (diffuse.filterMode >= 3 && !opts.keepEffects && !(team && team.filterMode < 3)) return void (entry.why = `effect layer (filter ${diffuse.filterMode})`);
      mode = team ? 2 : diffuse.filterMode === 1 || diffuse.filterMode === 2 ? 3 : 0;
    } else if (team && team.filterMode < 3) {
      mode = 4;
    } else {
      const glowOnly = mat.layers.every((l) => tex(l.textureId)?.replaceableId === 2);
      return void (entry.why = glowOnly ? 'team glow' : 'no texture of its own');
    }
    // Visibility over the kept sequences.
    let visibility: boolean[] | null = samples.map((s) => geosetAlpha(index, s) > 0.35);
    if (!visibility.some(Boolean) && samples.length) return void (entry.why = 'never visible');
    if (visibility.every(Boolean)) visibility = null;
    const unshaded = (diffuse ?? team)!.shading & 1;
    kept.push({ g, index, mode, texture, glow: unshaded ? 140 : 0, visibility });
    Object.assign(entry, { kept: true, why: '', mode, texture });
  });

  // Joints: every node a kept vertex follows, plus the attachment points.
  const jointIds: number[] = [];
  const jointOf = new Map<number, number>();
  const useNode = (id: number): number => {
    let j = jointOf.get(id);
    if (j === undefined) {
      j = jointIds.length;
      jointIds.push(id);
      jointOf.set(id, j);
    }
    return j;
  };
  const attach: Record<string, number> = {};
  for (const k of kept) {
    for (const group of k.g.groups) for (const id of group) if (m.nodes[id]) useNode(id);
    if (k.g.skin) for (let i = 0; i < k.g.skin.length; i += 8) for (let c = 0; c < 4; c++) if (k.g.skin[i + 4 + c]! > 0 && m.nodes[k.g.skin[i + c]!]) useNode(k.g.skin[i + c]!);
  }
  m.nodes.forEach((n, id) => {
    if (!n || n.kind !== 'attachment') return;
    const name = n.name.replace(/\s*Ref\s*$/i, '').trim();
    const point = ATTACH_POINTS.find((p) => p.toLowerCase() === name.toLowerCase());
    if (point && attach[point] === undefined) attach[point] = useNode(id);
  });
  report.joints = jointIds.length;

  // Geometry, in game coordinates.
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const jnt: number[] = [];
  const wgt: number[] = [];
  const meta: number[] = [];
  const idx: number[] = [];
  const textures: string[] = [];
  let visSlots = 0;
  const visOf: Array<boolean[]> = [];
  for (const k of kept) {
    const g = k.g;
    const base = pos.length / 3;
    const n = g.vertices.length / 3;
    let texIndex = -1;
    if (k.texture) {
      texIndex = textures.indexOf(k.texture);
      if (texIndex < 0) texIndex = textures.push(k.texture) - 1;
    }
    let slot = -1;
    if (k.visibility) {
      slot = visSlots++;
      visOf.push(k.visibility);
    }
    for (let i = 0; i < n; i++) {
      pos.push(...toGame(g.vertices[i * 3]!, g.vertices[i * 3 + 1]!, g.vertices[i * 3 + 2]!, UNIT));
      nrm.push(...toGame(g.normals[i * 3] ?? 0, g.normals[i * 3 + 1] ?? 0, g.normals[i * 3 + 2] ?? 1));
      uv.push(g.uvs[i * 2] ?? 0, g.uvs[i * 2 + 1] ?? 0);
      // Influences: Reforged skin weights, or the vertex's matrix group (equal weights, first four).
      const inf: Array<[number, number]> = [];
      if (g.skin) {
        for (let c = 0; c < 4; c++) {
          const w = g.skin[i * 8 + 4 + c]!;
          const id = g.skin[i * 8 + c]!;
          if (w > 0 && jointOf.has(id)) inf.push([jointOf.get(id)!, w / 255]);
        }
      } else {
        const group = (g.groups[g.vertexGroups[i] ?? 0] ?? []).filter((id) => jointOf.has(id)).slice(0, 4);
        for (const id of group) inf.push([jointOf.get(id)!, 1 / group.length]);
      }
      if (!inf.length) {
        // A vertex attached to nothing stays where it is: on the first joint (most often the root).
        inf.push([0, 1]);
        if (!report.warnings.includes('vertices without a bone')) report.warnings.push('vertices without a bone');
      }
      const sum = inf.reduce((s, x) => s + x[1], 0) || 1;
      for (let c = 0; c < 4; c++) {
        jnt.push(inf[c]?.[0] ?? 0);
        wgt.push((inf[c]?.[1] ?? 0) / sum);
      }
      meta.push(k.mode, texIndex, slot, k.glow);
    }
    for (let i = 0; i < g.faces.length; i++) idx.push(base + g.faces[i]!);
  }

  // Skinning matrices for every sampled frame: each joint's world transform, in game coordinates.
  // (In Warcraft III the vertices are stored in the rest pose, where every node's transform is the
  // identity, so the skinning matrix is the node's world transform itself.)
  const order: number[] = [];
  const seen = new Set<number>();
  const visit = (id: number, depth: number): void => {
    if (seen.has(id) || depth > 64) return;
    const n = m.nodes[id];
    if (n && n.parent >= 0 && n.parent !== id && m.nodes[n.parent]) visit(n.parent, depth + 1);
    seen.add(id);
    order.push(id);
  };
  for (const id of jointIds) visit(id, 0);
  const visTexels = Math.ceil(visSlots / 4);
  const rowLength = jointIds.length * 12 + visTexels * 4;
  // Game ← Warcraft III: G = U·C with C the axis swap and U the unit scale; skinning in game space
  // is G · W · G⁻¹.
  const G = new Float64Array([0, 0, UNIT, 0, UNIT, 0, 0, 0, 0, UNIT, 0, 0, 0, 0, 0, 1]);
  const Gi = new Float64Array([0, 1 / UNIT, 0, 0, 0, 0, 1 / UNIT, 0, 1 / UNIT, 0, 0, 0, 0, 0, 0, 1]);
  const rows: Float32Array[] = [];
  const world = new Map<number, Mat>();
  const tmp = new Float64Array(16);
  const skin = new Float64Array(16);
  for (let f = 0; f < samples.length; f++) {
    const smp = samples[f]!;
    world.clear();
    for (const id of order) {
      const n = m.nodes[id]!;
      const t = sample(n.translation as Track<number[]> | null, smp.time, smp.seq.start, smp.seq.end, m.globalSequences, [0, 0, 0]);
      const q = sample(n.rotation as Track<number[]> | null, smp.time, smp.seq.start, smp.seq.end, m.globalSequences, [0, 0, 0, 1], true);
      const s = sample(n.scaling as Track<number[]> | null, smp.time, smp.seq.start, smp.seq.end, m.globalSequences, [1, 1, 1]);
      const local = nodeLocal(pivot(id), t, q, s);
      const parent = n.parent >= 0 ? world.get(n.parent) : undefined;
      world.set(id, parent ? mul(parent, local) : local);
    }
    const row = new Float32Array(rowLength);
    jointIds.forEach((id, j) => {
      mul(mul(G, world.get(id) ?? ident(), tmp), Gi, skin);
      for (let r = 0; r < 3; r++) {
        row[j * 12 + r * 4] = skin[r]!;
        row[j * 12 + r * 4 + 1] = skin[4 + r]!;
        row[j * 12 + r * 4 + 2] = skin[8 + r]!;
        row[j * 12 + r * 4 + 3] = skin[12 + r]!;
      }
    });
    visOf.forEach((v, slot) => (row[jointIds.length * 12 + slot] = v[f] ? 1 : 0));
    rows.push(row);
  }
  if (!samples.length) warnings.push('no sequences kept');

  // Bounds of the rest pose.
  let minY = Infinity;
  let maxY = -Infinity;
  let radius = 0;
  for (let i = 0; i < pos.length; i += 3) {
    minY = Math.min(minY, pos[i + 1]!);
    maxY = Math.max(maxY, pos[i + 1]!);
    radius = Math.max(radius, Math.hypot(pos[i]!, pos[i + 2]!));
  }
  if (!pos.length) minY = maxY = 0;

  // Unique joint names.
  const names = new Set<string>();
  const joints = jointIds.map((id) => {
    let name = m.nodes[id]!.name || `node${id}`;
    while (names.has(name)) name += `#${id}`;
    names.add(name);
    return name;
  });
  const bindWorld = jointIds.map((id) => {
    const [x, y, z] = toGame(...(pivot(id) as [number, number, number]), UNIT);
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  });

  const vcount = pos.length / 3;
  const weights4 = new Uint8Array(wgt.length);
  for (let i = 0; i < wgt.length; i += 4) {
    let sum = 0;
    for (let c = 1; c < 4; c++) sum += weights4[i + c] = Math.round(wgt[i + c]! * 255);
    weights4[i] = 255 - sum;
  }
  return {
    joints,
    bindWorld,
    vis: visSlots,
    rows,
    clips,
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    uvs: new Float32Array(uv),
    joints4: new Uint8Array(jnt),
    weights4,
    indices: vcount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
    meta: new Int16Array(meta),
    textures,
    bounds: { minY, maxY, radius },
    attach,
    report,
  };
}

/** Node lookup helper for callers that want to list a model's attachment names. */
export function attachmentNames(m: Model): string[] {
  return m.nodes.filter((n): n is Node => !!n && n.kind === 'attachment').map((n) => n.name.trim());
}
