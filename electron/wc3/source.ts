// Reading the game's files from a Warcraft III install on this computer:
//
// - Reforged (1.30 and later) keeps them in CASC storage (CascLib reads it). Its classic art sits
//   under the `war3.w3mod:` prefix; `_hd.w3mod`, localized and other variants are left alone.
// - Classic installs (1.31 and earlier) keep them in MPQ archives (StormLib reads them): War3.mpq,
//   then the expansion's War3x.mpq, then War3Patch.mpq on top.
// - Or a folder of files already extracted (units\..., buildings\..., textures\...).
//
// File names are looked up without regard to case or slash direction.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export interface FileSource {
  kind: 'casc' | 'mpq' | 'folder';
  /** What was opened (for the report). */
  description: string;
  /** Normalized name (lower case, backslashes, no prefix) → the name to read it by. */
  readonly names: Map<string, string>;
  read(name: string): Promise<Uint8Array | null>;
  /** Whether a file exists by its normalized name, when it isn't listed (storages that can't list). */
  probe(key: string): Promise<string | null>;
  close(): void;
}

/** The name to read a normalized name by: listed, or found by probing (and remembered). */
export async function lookup(source: FileSource, key: string): Promise<string | null> {
  const listed = source.names.get(key);
  if (listed) return listed;
  const found = await source.probe(key);
  if (found) source.names.set(key, found);
  return found;
}

export const normalize = (name: string): string => name.replace(/\//g, '\\').toLowerCase();

/** Which kind of install (or folder) `dir` is, looking one level up for Reforged's root too. */
export function detect(dir: string): { kind: FileSource['kind']; root: string } | null {
  const has = (d: string, name: string): string | null => {
    try {
      const hit = readdirSync(d).find((f) => f.toLowerCase() === name.toLowerCase());
      return hit ? path.join(d, hit) : null;
    } catch {
      return null;
    }
  };
  for (const d of [dir, path.dirname(dir), path.dirname(path.dirname(dir))]) {
    if (has(d, '.build.info') && has(d, 'Data')) return { kind: 'casc', root: d };
  }
  if (has(dir, 'War3.mpq') || has(dir, 'War3x.mpq')) return { kind: 'mpq', root: dir };
  const w3mod = has(dir, 'war3.w3mod');
  if (w3mod && statSync(w3mod).isDirectory()) return { kind: 'folder', root: w3mod };
  if (has(dir, 'units') || has(dir, 'Units')) return { kind: 'folder', root: dir };
  return null;
}

export async function openSource(dir: string): Promise<FileSource> {
  const found = detect(dir);
  if (!found) throw new Error(`No Warcraft III files found in ${dir}: choose the folder Warcraft III is installed in.`);
  if (found.kind === 'casc') return openCasc(found.root);
  if (found.kind === 'mpq') return openMpq(found.root);
  return openFolder(found.root);
}

// ------------------------------------------------------------------ CASC
async function openCasc(root: string): Promise<FileSource> {
  const { Storage } = await import('@jamiephan/casclib');
  const storage = await Storage.openAsync(root);
  const names = new Map<string, string>();
  const variants = new Map<string, string>();
  let product = '';
  try {
    const p = storage.getProductInfo();
    product = `${p.codeName} build ${p.buildNumber}`;
  } catch {
    // (older CascLib builds: no product info)
  }
  for (const f of storage.files('*')) {
    const full = f.fileName;
    let key = normalize(full);
    if (key.startsWith('war3.w3mod:')) key = key.slice('war3.w3mod:'.length);
    if (key.includes(':')) {
      // An HD, localized or alternate copy: only as a last resort.
      const plain = key.slice(key.lastIndexOf(':') + 1);
      if (!key.includes('_hd.w3mod') && !variants.has(plain)) variants.set(plain, full);
      continue;
    }
    names.set(key, full);
  }
  for (const [k, v] of variants) if (!names.has(k)) names.set(k, v);
  const read = async (name: string): Promise<Uint8Array | null> => {
    try {
      return new Uint8Array(await storage.readFileAsync(name));
    } catch {
      return null;
    }
  };
  const probe = async (key: string): Promise<string | null> => {
    for (const name of [`war3.w3mod:${key}`, key]) {
      try {
        if (storage.fileExists(name)) return name;
      } catch {
        // not there
      }
    }
    return null;
  };
  return {
    kind: 'casc',
    description: `CASC storage at ${root}${product ? ` (${product})` : ''}, ${names.size} files listed`,
    names,
    read,
    probe,
    close: () => void storage.close(),
  };
}

// ------------------------------------------------------------------ MPQ
async function openMpq(root: string): Promise<FileSource> {
  const { Archive } = await import('@jamiephan/stormlib');
  // Later archives override earlier ones.
  const order = ['War3.mpq', 'War3x.mpq', 'War3xlocal.mpq', 'War3Patch.mpq'];
  const files = readdirSync(root);
  const archives: Array<{ name: string; archive: InstanceType<typeof Archive> }> = [];
  for (const want of order) {
    const hit = files.find((f) => f.toLowerCase() === want.toLowerCase());
    if (!hit) continue;
    try {
      archives.push({ name: hit, archive: await Archive.openAsync(path.join(root, hit)) });
    } catch {
      // A locked or damaged archive: skip it.
    }
  }
  if (!archives.length) throw new Error(`Could not open the MPQ archives in ${root}`);
  const names = new Map<string, string>();
  const owner = new Map<string, number>();
  archives.forEach(({ archive }, i) => {
    for (const f of archive.listFiles()) {
      const key = normalize(f.name);
      names.set(key, f.name);
      owner.set(key, i);
    }
  });
  const read = async (name: string): Promise<Uint8Array | null> => {
    const key = normalize(name);
    // The newest archive that has it.
    const first = owner.get(key);
    const tries = first !== undefined ? [first, ...archives.keys()] : [...archives.keys()].reverse();
    for (const i of tries) {
      const a = archives[i]!.archive;
      try {
        if (a.hasFile(name)) return new Uint8Array(await a.readFileAsync(name));
      } catch {
        // try the next archive
      }
    }
    return null;
  };
  const probe = async (key: string): Promise<string | null> => {
    for (let i = archives.length - 1; i >= 0; i--) {
      try {
        if (archives[i]!.archive.hasFile(key)) return key;
      } catch {
        // not there
      }
    }
    return null;
  };
  return {
    kind: 'mpq',
    description: `MPQ archives in ${root} (${archives.map((a) => a.name).join(', ')}), ${names.size} files listed`,
    names,
    read,
    probe,
    close: () => archives.forEach((a) => a.archive.close()),
  };
}

// ------------------------------------------------------------------ folder
function openFolder(root: string): FileSource {
  const names = new Map<string, string>();
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('_hd')) walk(full, depth + 1);
      } else names.set(normalize(path.relative(root, full)), full);
    }
  };
  walk(root, 0);
  return {
    kind: 'folder',
    description: `extracted files in ${root}, ${names.size} files`,
    names,
    read: async (name) => {
      try {
        return existsSync(name) ? new Uint8Array(readFileSync(name)) : null;
      } catch {
        return null;
      }
    },
    probe: async () => null,
    close: () => undefined,
  };
}

// ------------------------------------------------------------------ lookups
/** Every file whose name (without folders and extension) is `base`, models first by path depth. */
export function findByBase(source: FileSource, base: string, ext: string): string[] {
  const want = `\\${base.toLowerCase()}${ext}`;
  const out: string[] = [];
  for (const key of source.names.keys()) if (key.endsWith(want) || key === want.slice(1)) out.push(key);
  // Prefer units\ and buildings\ over doodads and campaign copies; then shorter paths.
  const rank = (k: string): number => (k.startsWith('units\\') || k.startsWith('buildings\\') ? 0 : k.startsWith('doodads\\') ? 2 : 1) * 1000 + k.length;
  return out.sort((a, b) => rank(a) - rank(b));
}

/** A file by its path as a model names it, trying other extensions (Reforged swapped some). */
export async function resolveTexture(source: FileSource, ref: string): Promise<string | null> {
  const key = normalize(ref);
  const stem = key.replace(/\.[a-z0-9]+$/, '');
  for (const k of [key, stem + '.blp', stem + '.dds', stem + '.tga']) if (source.names.has(k)) return source.names.get(k)!;
  for (const k of [key, stem + '.blp', stem + '.dds']) {
    const found = await lookup(source, k);
    if (found) return found;
  }
  return null;
}

/** Where Warcraft III keeps a model called `base`, for storages that can't list their files. */
export function guessModelPaths(base: string): string[] {
  const b = base.toLowerCase();
  const races = ['human', 'orc', 'nightelf', 'undead', 'creeps', 'demon', 'naga', 'other', 'critters'];
  return [...races.map((r) => `units\\${r}\\${b}\\${b}.mdx`), ...races.map((r) => `buildings\\${r}\\${b}\\${b}.mdx`)];
}
