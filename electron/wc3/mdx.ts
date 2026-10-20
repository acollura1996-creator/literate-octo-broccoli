// A tolerant reader for Warcraft III models (MDX, versions 800 to 1800): only what the game needs to
// draw and animate a unit: sequences, textures, materials, geosets, geoset alpha, nodes (bones,
// helpers, attachments) with their animation tracks, and pivots.
//
// MDX is a chunked format (a 4-byte tag and a byte size, then the payload), and most objects inside a
// chunk start with their own inclusive byte size. Every object is read up to its declared size and
// skipped past whatever is left, so fields added by later versions cost nothing; chunks the game
// doesn't use (particles, ribbons, cameras, lights, collision, events, Reforged's face and popcorn
// effects) are skipped whole. Layouts follow the community specification (Magos, GhostWolf) and the
// Reforged additions documented by war3-model (4eb0da) and the Universal Modder field notes.
//
// Coordinates are as stored: Z up, units facing +X.

export interface Track<T extends number[]> {
  /** 0 none (step), 1 linear, 2 hermite, 3 bezier. */
  interp: number;
  globalSeq: number;
  keys: Array<{ time: number; value: T; inTan?: T; outTan?: T }>;
}

export interface Sequence {
  name: string;
  start: number;
  end: number;
  moveSpeed: number;
  nonLooping: boolean;
}

export interface Texture {
  /** 0 a file; 1 team colour; 2 team glow; 11, 31... other replaceables (trees, cliffs). */
  replaceableId: number;
  path: string;
}

export interface Layer {
  /** 0 none, 1 transparent (alpha test), 2 blend, 3 additive, 4 add alpha, 5 modulate, 6 modulate 2x. */
  filterMode: number;
  shading: number;
  textureId: number;
  alpha: number;
  /** Reforged (1100+): the layer's (texture, slot) table, as read. */
  table?: Array<[number, number]>;
  /** Reforged: the layer's bytes, to look for the table again if it doesn't check out. */
  raw?: Uint8Array;
}

export interface Material {
  layers: Layer[];
}

export interface Geoset {
  vertices: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  faces: Uint16Array;
  /** Per vertex: index of its matrix group (classic skinning). */
  vertexGroups: Uint8Array;
  /** Matrix groups: the node object ids each vertex group follows (equal weights). */
  groups: number[][];
  /** Reforged: per vertex 4 node ids and 4 weights (bytes); null for classic models. */
  skin: Uint8Array | null;
  materialId: number;
  lod: number;
}

export interface GeosetAnim {
  geosetId: number;
  alpha: number;
  alphaTrack: Track<[number]> | null;
}

export interface Node {
  name: string;
  objectId: number;
  parent: number;
  flags: number;
  kind: 'bone' | 'helper' | 'attachment' | 'other';
  translation: Track<[number, number, number]> | null;
  rotation: Track<[number, number, number, number]> | null;
  scaling: Track<[number, number, number]> | null;
}

export interface Model {
  version: number;
  sequences: Sequence[];
  globalSequences: number[];
  textures: Texture[];
  materials: Material[];
  geosets: Geoset[];
  geosetAnims: GeosetAnim[];
  /** Indexed by object id. */
  nodes: Node[];
  pivots: Float32Array;
  /** Chunks seen but not used, for the import report. */
  skipped: string[];
  /** Anything read on a best guess, for the import report. */
  warnings: string[];
}

class Reader {
  pos = 0;
  readonly view: DataView;
  readonly bytes: Uint8Array;
  constructor(buffer: ArrayBufferView) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  get length(): number {
    return this.bytes.length;
  }
  need(n: number): void {
    if (this.pos + n > this.bytes.length) throw new Error(`MDX: unexpected end of file at ${this.pos} (+${n})`);
  }
  u8(): number {
    this.need(1);
    return this.bytes[this.pos++]!;
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  tag(): string {
    this.need(4);
    const b = this.bytes;
    const p = this.pos;
    this.pos += 4;
    return String.fromCharCode(b[p]!, b[p + 1]!, b[p + 2]!, b[p + 3]!);
  }
  peekTag(): string {
    if (this.pos + 4 > this.bytes.length) return '';
    const b = this.bytes;
    const p = this.pos;
    return String.fromCharCode(b[p]!, b[p + 1]!, b[p + 2]!, b[p + 3]!);
  }
  str(n: number): string {
    this.need(n);
    let end = this.pos;
    const stop = this.pos + n;
    while (end < stop && this.bytes[end] !== 0) end++;
    let s = '';
    for (let i = this.pos; i < end; i++) s += String.fromCharCode(this.bytes[i]!);
    this.pos = stop;
    return s;
  }
  f32s(n: number): Float32Array<ArrayBuffer> {
    this.need(n * 4);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = this.f32();
    return out;
  }
}

const EXTENT = 28; // bounds radius + min + max

function readTrack<T extends number[]>(r: Reader, size: number, int = false): Track<T> {
  const count = r.u32();
  const interp = r.u32();
  const globalSeq = r.i32();
  if (count > 100000) throw new Error(`MDX: implausible key count ${count}`);
  const value = (): T => {
    const v: number[] = [];
    for (let i = 0; i < size; i++) v.push(int ? r.i32() : r.f32());
    return v as T;
  };
  const keys: Track<T>['keys'] = [];
  for (let i = 0; i < count; i++) {
    const time = r.i32();
    const v = value();
    if (interp > 1) keys.push({ time, value: v, inTan: value(), outTan: value() });
    else keys.push({ time, value: v });
  }
  return { interp, globalSeq, keys };
}

/** Skip one known animation track (any tag) whose value size is known. */
const TRACK_SIZES: Record<string, number> = {
  KMTA: 1, KMTF: 1, KMTE: 1, KFC3: 3, KFCA: 1, KFTC: 1, // layers
  KGAO: 1, KGAC: 3, // geoset anims
  KGTR: 3, KGRT: 4, KGSC: 3, // nodes
  KATV: 1, // attachment visibility
};

function readNode(r: Reader, kind: Node['kind']): Node & { end: number } {
  const start = r.pos;
  const size = r.u32();
  const end = start + size;
  const node: Node & { end: number } = {
    name: r.str(80).trim(),
    objectId: r.i32(),
    parent: r.i32(),
    flags: r.u32(),
    kind,
    translation: null,
    rotation: null,
    scaling: null,
    end,
  };
  while (r.pos + 4 <= end) {
    const t = r.peekTag();
    if (t === 'KGTR') {
      r.pos += 4;
      node.translation = readTrack(r, 3);
    } else if (t === 'KGRT') {
      r.pos += 4;
      node.rotation = readTrack(r, 4);
    } else if (t === 'KGSC') {
      r.pos += 4;
      node.scaling = readTrack(r, 3);
    } else break;
  }
  r.pos = end;
  return node;
}

function readSequences(r: Reader, end: number, m: Model): void {
  while (r.pos + 132 <= end) {
    const s = r.pos;
    const name = r.str(80);
    const start = r.u32();
    const stop = r.u32();
    const moveSpeed = r.f32();
    const flags = r.u32();
    m.sequences.push({ name: name.trim(), start, end: stop, moveSpeed, nonLooping: flags !== 0 });
    r.pos = s + 132;
  }
}

function readTextures(r: Reader, end: number, m: Model): void {
  while (r.pos + 268 <= end) {
    const s = r.pos;
    const replaceableId = r.u32();
    const path = r.str(260);
    m.textures.push({ replaceableId, path: path.replace(/\//g, '\\') });
    r.pos = s + 268;
  }
}

function readMaterials(r: Reader, end: number, m: Model): void {
  while (r.pos + 4 <= end) {
    const start = r.pos;
    const size = r.u32();
    const mEnd = start + size;
    r.u32(); // priority plane
    r.u32(); // flags
    if (m.version >= 900 && m.version < 1100) r.pos += 80; // shader name
    // (Later versions may add fields before the layers: look for them.)
    while (r.pos + 4 <= mEnd && r.peekTag() !== 'LAYS') r.pos += 4;
    const material: Material = { layers: [] };
    if (r.peekTag() === 'LAYS') {
      r.pos += 4;
      const count = r.u32();
      for (let i = 0; i < count && r.pos + 4 <= mEnd; i++) {
        const ls = r.pos;
        const lsize = r.u32();
        const lEnd = ls + lsize;
        const layer: Layer = { filterMode: r.u32(), shading: r.u32(), textureId: r.u32(), alpha: 1 };
        r.u32(); // texture animation
        r.u32(); // coord id
        layer.alpha = r.f32();
        if (m.version >= 900) r.f32(); // emissive gain
        if (m.version >= 1000) r.pos += 20; // fresnel colour, opacity, team colour
        if (m.version >= 1100 && r.pos + 8 <= lEnd) {
          // Reforged: a shader type and a table of (texture, slot); slot 0 is the diffuse map. (The
          // old texture field above reads 0.)
          layer.raw = r.bytes.subarray(ls, lEnd);
          r.u32();
          const n = r.u32();
          if (n >= 1 && n < 16) {
            layer.table = [];
            for (let k = 0; k < n && r.pos + 8 <= lEnd; k++) {
              const tex = r.u32();
              const slot = r.u32();
              layer.table.push([tex, slot]);
              if (r.peekTag() === 'KMTF') {
                r.pos += 4;
                readTrack(r, 1, true);
              }
            }
            const diffuse = layer.table.find(([, slot]) => slot === 0) ?? layer.table[0];
            if (diffuse) layer.textureId = diffuse[0];
          }
        }
        // Remaining tracks: only the alpha is used (its first key).
        while (r.pos + 4 <= lEnd) {
          const t = r.peekTag();
          const size = TRACK_SIZES[t];
          if (!size) break;
          r.pos += 4;
          const track = readTrack<number[]>(r, size, t === 'KMTF');
          if (t === 'KMTA' && track.keys.length) layer.alpha = track.keys[0]!.value[0]!;
        }
        r.pos = lEnd;
        material.layers.push(layer);
      }
    }
    m.materials.push(material);
    r.pos = mEnd;
  }
}

function readGeosets(r: Reader, end: number, m: Model): void {
  while (r.pos + 4 <= end) {
    const start = r.pos;
    const size = r.u32();
    const gEnd = start + size;
    const expect = (t: string): void => {
      const got = r.tag();
      if (got !== t) throw new Error(`MDX: geoset expected ${t}, found ${got}`);
    };
    expect('VRTX');
    const vertices = r.f32s(r.u32() * 3);
    expect('NRMS');
    const normals = r.f32s(r.u32() * 3);
    expect('PTYP');
    const nTypes = r.u32();
    const types: number[] = [];
    for (let i = 0; i < nTypes; i++) types.push(r.u32());
    expect('PCNT');
    const nCounts = r.u32();
    for (let i = 0; i < nCounts; i++) r.u32();
    expect('PVTX');
    const nIdx = r.u32();
    const faces = new Uint16Array(nIdx);
    for (let i = 0; i < nIdx; i++) faces[i] = r.u16();
    expect('GNDX');
    const nGroups = r.u32();
    const vertexGroups = new Uint8Array(nGroups);
    for (let i = 0; i < nGroups; i++) vertexGroups[i] = r.u8();
    expect('MTGC');
    const nSizes = r.u32();
    const sizes: number[] = [];
    for (let i = 0; i < nSizes; i++) sizes.push(r.u32());
    expect('MATS');
    const nMats = r.u32();
    const mats: number[] = [];
    for (let i = 0; i < nMats; i++) mats.push(r.u32());
    const groups: number[][] = [];
    let k = 0;
    for (const s of sizes) {
      groups.push(mats.slice(k, k + s));
      k += s;
    }
    const materialId = r.u32();
    r.u32(); // selection group
    r.u32(); // selection flags
    let lod = 0;
    if (m.version >= 900) {
      lod = r.u32();
      r.pos += 80; // LOD name
    }
    r.pos += EXTENT;
    const nExtents = r.u32();
    r.pos += nExtents * EXTENT;
    let skin: Uint8Array | null = null;
    // Optional Reforged blocks (tangents, skin weights), then the texture coordinates.
    while (r.pos + 4 <= gEnd && r.peekTag() !== 'UVAS') {
      const t = r.tag();
      const n = r.u32();
      if (t === 'TANG') r.pos += n * 16;
      else if (t === 'SKIN') {
        skin = r.bytes.slice(r.pos, r.pos + n);
        r.pos += n;
      } else {
        // Something newer: look for the texture coordinates past it.
        const at = findTag(r, 'UVAS', r.pos - 8, gEnd);
        if (at < 0) throw new Error(`MDX: unknown geoset block ${t}, no texture coordinates after it`);
        m.warnings.push(`geoset ${m.geosets.length}: skipped an unknown block ${JSON.stringify(t)} (${at - r.pos + 8} bytes)`);
        r.pos = at;
      }
    }
    expect('UVAS');
    const nSets = r.u32();
    let uvs = new Float32Array(0);
    for (let i = 0; i < nSets; i++) {
      expect('UVBS');
      const set = r.f32s(r.u32() * 2);
      if (i === 0) uvs = set;
    }
    if (types.some((t) => t !== 4)) throw new Error(`MDX: geoset with non-triangle primitives (${types.join(',')})`);
    m.geosets.push({ vertices, normals, uvs, faces, vertexGroups, groups, skin, materialId, lod });
    r.pos = gEnd;
  }
}

/** The offset of the next `tag` (followed by a plausible count) in [from, end), or -1. */
function findTag(r: Reader, tag: string, from: number, end: number): number {
  const b = r.bytes;
  const c0 = tag.charCodeAt(0), c1 = tag.charCodeAt(1), c2 = tag.charCodeAt(2), c3 = tag.charCodeAt(3);
  for (let p = from; p + 8 <= end; p++) {
    if (b[p] === c0 && b[p + 1] === c1 && b[p + 2] === c2 && b[p + 3] === c3 && r.view.getUint32(p + 4, true) < 64) return p;
  }
  return -1;
}

function readGeosetAnims(r: Reader, end: number, m: Model): void {
  while (r.pos + 4 <= end) {
    const start = r.pos;
    const size = r.u32();
    const aEnd = start + size;
    const alpha = r.f32();
    r.u32(); // flags
    r.pos += 12; // colour
    const geosetId = r.i32();
    let alphaTrack: Track<[number]> | null = null;
    while (r.pos + 4 <= aEnd) {
      const t = r.peekTag();
      const sz = TRACK_SIZES[t];
      if (!sz) break;
      r.pos += 4;
      const track = readTrack<number[]>(r, sz);
      if (t === 'KGAO') alphaTrack = track as Track<[number]>;
    }
    m.geosetAnims.push({ geosetId, alpha, alphaTrack });
    r.pos = aEnd;
  }
}

function readNodes(r: Reader, end: number, m: Model, kind: Node['kind'], extra: (r: Reader, nodeEnd: number) => void): void {
  while (r.pos + 4 <= end) {
    const node = readNode(r, kind);
    extra(r, node.end);
    const { end: _e, ...n } = node;
    if (node.objectId >= 0 && node.objectId < 100000) m.nodes[node.objectId] = n;
  }
}

export function parseMDX(data: ArrayBufferView): Model {
  const r = new Reader(data);
  if (r.tag() !== 'MDLX') throw new Error('Not an MDX file');
  const m: Model = { version: 800, sequences: [], globalSequences: [], textures: [], materials: [], geosets: [], geosetAnims: [], nodes: [], pivots: new Float32Array(0), skipped: [], warnings: [] };
  while (r.pos + 8 <= r.length) {
    const tag = r.tag();
    const size = r.u32();
    const start = r.pos;
    const end = start + size;
    if (end > r.length) throw new Error(`MDX: chunk ${tag} runs past the end of the file`);
    switch (tag) {
      case 'VERS':
        m.version = r.u32();
        break;
      case 'SEQS':
        readSequences(r, end, m);
        break;
      case 'GLBS':
        for (let i = 0; i < size / 4; i++) m.globalSequences.push(r.u32());
        break;
      case 'TEXS':
        readTextures(r, end, m);
        break;
      case 'MTLS':
        readMaterials(r, end, m);
        break;
      case 'GEOS':
        readGeosets(r, end, m);
        break;
      case 'GEOA':
        readGeosetAnims(r, end, m);
        break;
      case 'BONE':
        readNodes(r, end, m, 'bone', (rr) => {
          rr.i32(); // geoset id
          rr.i32(); // geoset anim id
        });
        break;
      case 'HELP':
        readNodes(r, end, m, 'helper', () => undefined);
        break;
      case 'ATCH':
        // Attachments wrap the node in their own inclusive size.
        while (r.pos + 4 <= end) {
          const s = r.pos;
          const asize = r.u32();
          const node = readNode(r, 'attachment');
          const { end: _e, ...n } = node;
          if (node.objectId >= 0 && node.objectId < 100000) m.nodes[node.objectId] = n;
          r.pos = s + asize;
        }
        break;
      case 'PIVT':
        m.pivots = r.f32s(size / 4);
        break;
      default:
        // Emitters, ribbons, lights, cameras, event objects and collision shapes are nodes too, and
        // bones may hang from them; they are kept as plain transforms when they can be read safely.
        if (tag === 'EVTS' || tag === 'CLID' || tag === 'LITE' || tag === 'PREM' || tag === 'PRE2' || tag === 'RIBB' || tag === 'CORN') {
          readOtherNodes(r, tag, end, m);
        }
        m.skipped.push(tag);
    }
    r.pos = end;
  }
  checkLayerTables(m);
  return m;
}

/**
 * A Reforged layer's (texture, slot) table at byte `p` of the layer (the count first), if the bytes
 * there read as one: each entry may carry a texture-flip track, and the table must end where the
 * layer ends or where one of its animation tracks starts.
 */
function tableAt(raw: Uint8Array, p: number): { table: Array<[number, number]>; end: number } | null {
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (p + 4 > raw.length) return null;
  const count = v.getUint32(p, true);
  if (count < 1 || count > 8) return null;
  let q = p + 4;
  const table: Array<[number, number]> = [];
  const tagAt = (o: number): string => (o + 4 <= raw.length ? String.fromCharCode(raw[o]!, raw[o + 1]!, raw[o + 2]!, raw[o + 3]!) : '');
  for (let k = 0; k < count; k++) {
    if (q + 8 > raw.length) return null;
    const slot = v.getUint32(q + 4, true);
    if (slot > 15) return null;
    table.push([v.getUint32(q, true), slot]);
    q += 8;
    if (tagAt(q) === 'KMTF') {
      if (q + 16 > raw.length) return null;
      const keys = v.getUint32(q + 4, true);
      const interp = v.getUint32(q + 8, true);
      if (keys > 10000 || interp > 3) return null;
      q += 16 + keys * (interp > 1 ? 16 : 8);
    }
  }
  if (q > raw.length) return null;
  if (q < raw.length && !TRACK_SIZES[tagAt(q)]) return null;
  return { table, end: q };
}

/**
 * Reforged layers: the table read where it was expected must hold together and name real textures;
 * if not, the layout differs from the one assumed, so look through the layer's bytes for one that
 * does (preferring one with a diffuse slot and no slot twice).
 */
function checkLayerTables(m: Model): void {
  const n = m.textures.length;
  const valid = (t: Array<[number, number]>): boolean => t.every(([tex]) => tex < n);
  m.materials.forEach((mat, mi) =>
    mat.layers.forEach((layer, li) => {
      if (!layer.raw) return;
      // The expected place: after the fixed fields, the fresnel block and the shader type.
      const expected = tableAt(layer.raw, 56);
      if (expected && valid(expected.table)) {
        layer.table = expected.table;
      } else {
        let best: { table: Array<[number, number]>; at: number; score: number } | null = null;
        for (let p = 28; p + 12 <= layer.raw.length; p += 4) {
          const t = tableAt(layer.raw, p);
          if (!t || !valid(t.table)) continue;
          const slots = new Set(t.table.map(([, s]) => s));
          const score = (slots.has(0) ? 2 : 0) + (slots.size === t.table.length ? 1 : 0);
          if (!best || score > best.score) best = { table: t.table, at: p, score };
        }
        if (!best) {
          m.warnings.push(`material ${mi} layer ${li}: no valid texture table (using texture ${layer.textureId} of ${n})`);
          return;
        }
        layer.table = best.table;
        m.warnings.push(`material ${mi} layer ${li}: texture table found at byte ${best.at} of the layer, not 56`);
      }
      layer.textureId = (layer.table.find(([, s]) => s === 0) ?? layer.table[0]!)[0];
    }),
  );
}

/** Nodes of chunks the game doesn't draw: read their node headers so the hierarchy stays whole. */
function readOtherNodes(r: Reader, tag: string, end: number, m: Model): void {
  try {
    while (r.pos + 4 <= end) {
      const s = r.pos;
      if (tag === 'EVTS' || tag === 'CLID') {
        // No outer size: the node, then the object's own data.
        const node = readNode(r, 'other');
        const { end: _e, ...n } = node;
        if (node.objectId >= 0 && node.objectId < 100000 && !m.nodes[node.objectId]) m.nodes[node.objectId] = n;
        if (tag === 'EVTS') {
          if (r.peekTag() === 'KEVT') {
            r.pos += 4;
            const count = r.u32();
            r.u32();
            r.pos += count * 4;
          }
        } else {
          const shape = r.u32();
          r.pos += shape === 0 ? 24 : shape === 2 ? 16 : 12;
          if (shape === 2) r.pos += 0;
        }
      } else {
        const osize = r.u32();
        const node = readNode(r, 'other');
        const { end: _e, ...n } = node;
        if (node.objectId >= 0 && node.objectId < 100000 && !m.nodes[node.objectId]) m.nodes[node.objectId] = n;
        r.pos = s + osize;
      }
      if (r.pos <= s) break;
    }
  } catch {
    // Not needed for drawing: give up on this chunk only.
  }
}
