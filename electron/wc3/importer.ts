// The Warcraft III importer: finds the models of CATALOG in an install on this computer, converts
// them (convert.ts) and writes one pack the game loads (the same container as the KayKit pack: a
// JSON header and a binary part), plus a report of what was found, converted and skipped.
//
// The pack holds Blizzard's art: it is written to this computer's app data only, never shipped.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { CATALOG, rolesOf, sequencesFor, type CatalogEntry, type Roles } from './catalog';
import { convertModel, type ConvertedModel, type ConvertReport } from './convert';
import { parseMDX } from './mdx';
import { findByBase, guessModelPaths, lookup, normalize, openSource, resolveTexture, type FileSource } from './source';
import { decodeTexture, resize } from './textures';
import { loadUnitData, type UnitInfo } from './unitdata';

export const PACK_FILE = 'wc3-pack.bin';
export const REPORT_FILE = 'wc3-report.json';
/** Frames a second sampled from the sequences. */
const FPS = 20;
/** Texture size in the game's texture array (Warcraft III's classic art is mostly 256²). */
const ATLAS = 256;
/** Walk speed when a walk doesn't say (Warcraft III units a second / 100). */
const DEFAULT_MOVE = 2.7;
/** Command card icons (Warcraft III's are 64²). */
const ICON = 64;

export interface ImportProgress {
  stage: 'open' | 'data' | 'models' | 'write' | 'done';
  done: number;
  total: number;
  current?: string;
}

export interface ImportReport {
  created: string;
  source: string;
  ok: boolean;
  models: Record<string, { file: string | null; status: 'converted' | 'missing' | 'failed'; error?: string; scale?: number; damagePoint?: number; roles?: Roles; convert?: ConvertReport }>;
  textures: Record<string, string>;
  pack?: { bytes: number; rigs: number; vatRows: number; vatWidth: number; textures: number };
  log: string[];
}

/** Recipe data for one model id, as the game reads it from the pack. */
export interface PackRecipe extends Roles {
  body: string;
  kind: 'unit' | 'building';
  /** Height of the rest pose in model units, the model's own scale, and the catalog's. */
  restHeight: number;
  modelScale: number;
  scale: number;
  lift?: number;
  rapid?: boolean;
}

// ------------------------------------------------------------------ pack writer
const half = (() => {
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  return (v: number): number => {
    f[0] = v;
    const x = u[0]!;
    const sign = (x >> 16) & 0x8000;
    let e = ((x >> 23) & 0xff) - 127 + 15;
    let m = x & 0x7fffff;
    if (e <= 0) return sign;
    if (e >= 31) return sign | 0x7c00;
    m += 0x1000;
    if (m & 0x800000) {
      m = 0;
      e++;
      if (e >= 31) return sign | 0x7c00;
    }
    return sign | (e << 10) | (m >> 13);
  };
})();

class Binary {
  chunks: Buffer[] = [];
  length = 0;
  put(arr: ArrayBufferView): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.chunks.push(Buffer.alloc(pad));
      this.length += pad;
    }
    const off = this.length;
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    this.chunks.push(Buffer.from(b));
    this.length += b.length;
    return off;
  }
}

// ------------------------------------------------------------------ import
export interface ImportOptions {
  /** Only these model ids. */
  only?: string[];
  /** Other file names for some model ids (tests, or a model the catalog guesses wrong). */
  files?: Record<string, string[]>;
}

export async function importWarcraft(dir: string, outDir: string, onProgress: (p: ImportProgress) => void = () => undefined, opts: ImportOptions = {}): Promise<ImportReport> {
  const catalog: Record<string, CatalogEntry> = Object.fromEntries(Object.entries(CATALOG).map(([id, e]) => [id, opts.files?.[id] ? { ...e, files: opts.files[id]! } : e]));
  const report: ImportReport = { created: new Date().toISOString(), source: dir, ok: false, models: {}, textures: {}, log: [] };
  const log = (msg: string): void => {
    report.log.push(msg);
  };
  onProgress({ stage: 'open', done: 0, total: 1 });
  let source: FileSource;
  try {
    source = await openSource(dir);
  } catch (e) {
    log(String((e as Error).message ?? e));
    return report;
  }
  report.source = source.description;
  log(`opened ${source.description}`);
  try {
    onProgress({ stage: 'data', done: 0, total: 1 });
    const units = await loadUnitData(source, log).catch((e: Error) => {
      log(`unit data unreadable: ${e.message}`);
      return new Map<string, UnitInfo>();
    });

    // Which file each model id uses.
    const entries = Object.entries(catalog).filter(([id]) => !opts.only || opts.only.includes(id));
    const fileOf = new Map<string, string>();
    for (const [id, entry] of entries) {
      const file = await findModel(source, entry);
      report.models[id] = { file, status: file ? 'converted' : 'missing' };
      if (file) fileOf.set(id, file);
    }

    // Convert each file once.
    const files = [...new Set(fileOf.values())];
    const converted = new Map<string, { conv: ConvertedModel; roles: Roles; unit: UnitInfo | undefined }>();
    const textureIndex = new Map<string, number>();
    const images: Array<{ name: string; data: Uint8Array }> = [{ name: '(missing)', data: new Uint8Array(ATLAS * ATLAS * 4).fill(150) }];
    textureIndex.set('', 0);
    let done = 0;
    for (const file of files) {
      onProgress({ stage: 'models', done: done++, total: files.length, current: file });
      const ids = [...fileOf].filter(([, f]) => f === file).map(([id]) => id);
      const entry = catalog[ids[0]!]!;
      try {
        const data = await source.read((await lookup(source, file)) ?? file);
        if (!data) throw new Error('could not read the file');
        const model = parseMDX(data);
        const roles = rolesOf(model.sequences.map((s) => s.name), entry.kind);
        const keep = sequencesFor(roles);
        const conv = convertModel(model, { keep: (n) => keep.has(n), fps: FPS, keepEffects: ids.some((id) => catalog[id]!.keepEffects) });
        if (!conv.positions.length) throw new Error(`nothing to draw (geosets: ${conv.report.geosets.map((g) => g.why || 'kept').join('; ')})`);
        // Textures.
        for (const ref of conv.textures) {
          if (textureIndex.has(ref)) continue;
          const key = await resolveTexture(source, ref);
          let img: Uint8Array | null = null;
          if (key) {
            try {
              const bytes = await source.read(key);
              if (bytes) img = resize(decodeTexture(bytes), ATLAS).data;
              report.textures[ref] = bytes ? key : 'unreadable';
            } catch (e) {
              report.textures[ref] = `failed: ${(e as Error).message}`;
            }
          } else report.textures[ref] = 'missing';
          if (img) {
            textureIndex.set(ref, images.length);
            images.push({ name: ref, data: img });
          } else textureIndex.set(ref, 0);
        }
        const unit = units.get(file.replace(/\.mdx$/, ''));
        converted.set(file, { conv, roles, unit });
        for (const id of ids) Object.assign(report.models[id]!, { status: 'converted', scale: unit?.scale ?? 1, damagePoint: unit?.damagePoint, roles, convert: conv.report });
      } catch (e) {
        for (const id of ids) Object.assign(report.models[id]!, { status: 'failed', error: (e as Error).message });
        log(`${file}: ${(e as Error).message}`);
      }
    }

    // The pack.
    onProgress({ stage: 'write', done: 0, total: 1 });
    const bin = new Binary();
    const rigs: Record<string, unknown> = {};
    const pieces: unknown[] = [];
    let vatRows = 0;
    let vatWidth = 0;
    for (const [file, { conv, unit }] of converted) {
      const width = conv.joints.length * 3 + Math.ceil(conv.vis / 4);
      const vat = new Uint16Array(width * 4 * conv.rows.length);
      conv.rows.forEach((row, r) => row.forEach((v, i) => (vat[r * width * 4 + i] = half(v))));
      vatRows += conv.rows.length;
      vatWidth = Math.max(vatWidth, width);
      const anims: Record<string, unknown> = {};
      for (const [name, c] of Object.entries(conv.clips)) {
        const info: Record<string, number> = { start: c.start, frames: c.frames, duration: +c.duration.toFixed(4) };
        if (/^walk/i.test(name)) info['groundSpeed'] = +(c.moveSpeed > 0 ? c.moveSpeed : DEFAULT_MOVE).toFixed(3);
        if (/^attack|^spell/i.test(name)) info['impact'] = +Math.min(c.duration * 0.85, unit?.damagePoint ?? c.duration * 0.4).toFixed(3);
        anims[name] = info;
      }
      rigs[file] = { joints: conv.joints, bindWorld: conv.bindWorld, vat: { offset: bin.put(vat), width, height: conv.rows.length }, anims, vis: conv.vis, attach: conv.attach };
      // Per-vertex material: mode, texture layer, visibility (column × 4 + channel in the row), glow.
      const meta = new Int16Array(conv.meta.length);
      for (let i = 0; i < conv.meta.length; i += 4) {
        const ref = conv.textures[conv.meta[i + 1]!];
        const layer = ref === undefined ? 0 : textureIndex.get(ref) ?? 0;
        const slot = conv.meta[i + 2]!;
        // A missing texture: the body still shows, in the team colour's place a neutral grey.
        meta[i] = conv.meta[i]!;
        meta[i + 1] = layer;
        meta[i + 2] = slot < 0 ? -1 : (conv.joints.length * 3 + (slot >> 2)) * 4 + (slot & 3);
        meta[i + 3] = conv.meta[i + 3]!;
      }
      const n = conv.positions.length / 3;
      pieces.push({
        name: file,
        rig: file,
        texture: '',
        kind: 'body',
        vertices: n,
        indices: conv.indices.length,
        bounds: { minY: +conv.bounds.minY.toFixed(3), maxY: +conv.bounds.maxY.toFixed(3), radius: +conv.bounds.radius.toFixed(3) },
        position: bin.put(conv.positions),
        normal: bin.put(Int8Array.from(conv.normals, (v) => Math.round(Math.max(-1, Math.min(1, v)) * 127))),
        // (Float: Warcraft III's texture coordinates may run past 0-1 and wrap.)
        uv: bin.put(conv.uvs),
        uvFloat: true,
        joints: bin.put(conv.joints4),
        weights: bin.put(conv.weights4),
        index: bin.put(conv.indices),
        index32: conv.indices instanceof Uint32Array,
        meta: bin.put(meta),
      });
    }
    // Command card icons: the unit table's, else the usual name for the model's.
    const icons: Record<string, { offset: number; length: number; size: number }> = {};
    const iconCache = new Map<string, { offset: number; length: number; size: number } | null>();
    for (const [id, file] of fileOf) {
      const c = converted.get(file);
      if (!c) continue;
      const base = file.slice(file.lastIndexOf('\\') + 1).replace(/\.mdx$/, '');
      const tries = [c.unit?.icon, `ReplaceableTextures\\CommandButtons\\BTN${base}.blp`].filter((x): x is string => !!x);
      for (const ref of tries) {
        if (!iconCache.has(ref)) {
          let entry: { offset: number; length: number; size: number } | null = null;
          const key = await resolveTexture(source, ref);
          const bytes = key ? await source.read(key) : null;
          if (bytes) {
            try {
              const img = resize(decodeTexture(bytes), ICON);
              const z = deflateSync(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength));
              entry = { offset: bin.put(z), length: z.length, size: ICON };
            } catch {
              // an unreadable icon: the game draws its own
            }
          }
          iconCache.set(ref, entry);
        }
        const hit = iconCache.get(ref);
        if (hit) {
          icons[id] = hit;
          break;
        }
      }
    }
    log(`icons: ${Object.keys(icons).length}`);
    const imageInfo = images.map((img) => {
      const z = deflateSync(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { level: 6 });
      return { name: img.name, offset: bin.put(z), length: z.length };
    });
    const recipes: Record<string, PackRecipe> = {};
    for (const [id, file] of fileOf) {
      const c = converted.get(file);
      if (!c) continue;
      const entry = catalog[id]!;
      recipes[id] = {
        body: file,
        kind: entry.kind,
        ...c.roles,
        restHeight: +(c.conv.bounds.maxY - Math.min(0, c.conv.bounds.minY)).toFixed(3),
        modelScale: c.unit?.scale ?? 1,
        scale: entry.scale ?? 1,
        ...(entry.lift ? { lift: entry.lift } : {}),
        ...(entry.rapid ? { rapid: true } : {}),
      };
    }
    const json = Buffer.from(
      JSON.stringify({ version: 1, kind: 'wc3', fps: FPS, atlas: ATLAS, created: report.created, source: source.description, rigs, pieces, textures: images.map((i) => i.name), images: imageInfo, recipes, icons }),
    );
    const jsonPad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
    const header = Buffer.alloc(8);
    header.write('KKC1', 0, 'ascii');
    header.writeUInt32LE(json.length + jsonPad.length, 4);
    mkdirSync(outDir, { recursive: true });
    const out = Buffer.concat([header, json, jsonPad, ...bin.chunks]);
    if (Object.keys(recipes).length) {
      const tmp = path.join(outDir, `${PACK_FILE}.tmp`);
      writeFileSync(tmp, out);
      renameSync(tmp, path.join(outDir, PACK_FILE));
      report.ok = true;
    } else log('no model could be converted: no pack written');
    report.pack = { bytes: out.length, rigs: converted.size, vatRows, vatWidth, textures: images.length };
    log(`pack: ${(out.length / 1024 / 1024).toFixed(1)} MB, ${converted.size} models for ${Object.keys(recipes).length} unit types, ${images.length} textures, animation ${vatWidth} × ${vatRows}`);
  } catch (e) {
    log(`import failed: ${(e as Error).stack ?? e}`);
  } finally {
    source.close();
    try {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, REPORT_FILE), JSON.stringify(report, null, 1));
    } catch {
      // (the report is a convenience)
    }
    onProgress({ stage: 'done', done: 1, total: 1 });
  }
  return report;
}

/** The model file for a catalog entry: the first of its names that exists. */
async function findModel(source: FileSource, entry: CatalogEntry): Promise<string | null> {
  for (const name of entry.files) {
    if (name.includes('\\') || name.includes('/')) {
      const key = normalize(name).replace(/(\.mdx)?$/, '.mdx');
      if (await lookup(source, key)) return key;
      continue;
    }
    const hits = findByBase(source, name, '.mdx');
    if (hits.length) return hits[0]!;
    // A storage that couldn't list its files: try where Warcraft III usually keeps such a model.
    if (source.names.size < 1000) for (const key of guessModelPaths(name)) if (await lookup(source, key)) return key;
  }
  return null;
}
