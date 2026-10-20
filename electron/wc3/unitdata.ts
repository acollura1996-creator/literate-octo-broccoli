// Warcraft III's unit tables, for what the models themselves don't say: each model's scale
// (`modelScale`, Reforged's classic-art `modelScale:sd`) and when an attack lands (`dmgpt1`, seconds
// into the attack). Classic installs keep them in SYLK tables (units\unitUI.slk,
// units\unitWeapons.slk); Reforged in INI-style text (units\*skin.txt, units\*func.txt) as well.
import { lookup, type FileSource } from './source';

export interface UnitInfo {
  id: string;
  /** Model path, lower case, without extension. */
  file: string;
  scale: number;
  /** Seconds from the start of the attack to the hit (or the missile's release). */
  damagePoint?: number;
  /** Command card icon (ReplaceableTextures\CommandButtons\BTN....blp). */
  icon?: string;
}

/** Rows of a SYLK table, keyed by the first row's names. */
export function parseSlk(text: string): Array<Record<string, string>> {
  const cells = new Map<number, Map<number, string>>();
  let x = 1;
  let y = 1;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('C;')) continue;
    let value: string | null = null;
    for (const part of line.slice(2).split(';')) {
      const k = part[0];
      const v = part.slice(1);
      if (k === 'X') x = Number(v);
      else if (k === 'Y') y = Number(v);
      else if (k === 'K') value = v.startsWith('"') ? v.slice(1, v.endsWith('"') ? -1 : undefined) : v;
    }
    if (value === null) continue;
    let row = cells.get(y);
    if (!row) cells.set(y, (row = new Map()));
    row.set(x, value);
  }
  const header = cells.get(1);
  if (!header) return [];
  const out: Array<Record<string, string>> = [];
  for (const [ry, row] of cells) {
    if (ry === 1) continue;
    const rec: Record<string, string> = {};
    for (const [cx, name] of header) {
      const v = row.get(cx);
      if (v !== undefined) rec[name.toLowerCase()] = v;
    }
    out.push(rec);
  }
  return out;
}

/** Sections of an INI-style table: [id] then key=value lines. */
export function parseIni(text: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  let cur: Record<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith(';')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      const id = sec[1]!;
      cur = out.get(id) ?? {};
      out.set(id, cur);
      continue;
    }
    const eq = line.indexOf('=');
    if (cur && eq > 0) cur[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
}

const modelKey = (file: string): string => file.replace(/\//g, '\\').toLowerCase().replace(/\.(mdx|mdl)$/, '').trim();

/** Unit info by model path (lower case, no extension). */
export async function loadUnitData(source: FileSource, log: (msg: string) => void): Promise<Map<string, UnitInfo>> {
  const text = async (key: string): Promise<string | null> => {
    const name = await lookup(source, key);
    const data = name ? await source.read(name) : null;
    return data ? new TextDecoder('utf-8').decode(data) : null;
  };
  const units = new Map<string, UnitInfo>();
  const byId = new Map<string, UnitInfo>();
  const add = (id: string, file: string | undefined, scale: string | undefined): void => {
    if (!file) return;
    const key = modelKey(file.split(',')[0]!);
    const info = byId.get(id) ?? { id, file: key, scale: 1 };
    info.file = key;
    const s = Number(scale);
    if (scale !== undefined && Number.isFinite(s) && s > 0) info.scale = s;
    byId.set(id, info);
  };
  let tables = 0;
  // Classic: the UI table.
  const ui = await text('units\\unitui.slk');
  if (ui) {
    tables++;
    for (const r of parseSlk(ui)) if (r['unituiid'] ?? r['unitid']) add((r['unituiid'] ?? r['unitid'])!, r['file'], r['modelscale']);
  }
  // Reforged: skin tables (the classic art's own values first).
  await lookup(source, 'units\\unitskin.txt');
  for (const key of [...source.names.keys()]) {
    if (!/^units\\[a-z]*skin\.txt$/.test(key)) continue;
    const t = await text(key);
    if (!t) continue;
    tables++;
    for (const [id, sec] of parseIni(t)) add(id, sec['file:sd'] ?? sec['file'], sec['modelscale:sd'] ?? sec['modelscale']);
  }
  // Icons (Art), from any unit table that has them.
  const icons = new Map<string, string>();
  for (const key of [...source.names.keys()]) {
    if (!/^units\\[a-z]*(func|skin|strings)\.txt$/.test(key)) continue;
    const t = await text(key);
    if (!t) continue;
    for (const [id, sec] of parseIni(t)) {
      const art = (sec['art:sd'] ?? sec['art'])?.split(',')[0];
      if (art && !icons.has(id)) icons.set(id, art);
    }
  }
  // Attack timing.
  const damage = new Map<string, number>();
  const weapons = await text('units\\unitweapons.slk');
  if (weapons) {
    tables++;
    for (const r of parseSlk(weapons)) {
      const id = r['unitweapid'] ?? r['unitid'];
      const d = Number(r['dmgpt1']);
      if (id && Number.isFinite(d) && d > 0) damage.set(id, d);
    }
  }
  for (const key of [...source.names.keys()]) {
    if (!/^units\\[a-z]*(func|weapons[a-z]*)\.txt$/.test(key)) continue;
    const t = await text(key);
    if (!t) continue;
    for (const [id, sec] of parseIni(t)) {
      const d = Number(sec['dmgpt1']);
      if (Number.isFinite(d) && d > 0 && !damage.has(id)) damage.set(id, d);
    }
  }
  for (const [id, info] of byId) {
    const d = damage.get(id);
    if (d) info.damagePoint = d;
    const icon = icons.get(id);
    if (icon) info.icon = icon;
    // The first unit that uses a model speaks for it.
    if (!units.has(info.file)) units.set(info.file, info);
  }
  log(`unit data: ${tables} tables, ${byId.size} units, ${units.size} models, ${damage.size} attack timings, ${icons.size} icons`);
  return units;
}
