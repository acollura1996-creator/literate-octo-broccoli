// Run the Warcraft III importer from a terminal (development and troubleshooting):
//
//   node dist-electron/wc3/cli.js "C:\Program Files (x86)\Warcraft III" out-folder
//        [--only footman,knight] [--file footman=Footman,barracks=HumanBarracks]
//
// It writes the pack and its report to out-folder, as the desktop app does to its app data.
import path from 'node:path';
import { importWarcraft, PACK_FILE, REPORT_FILE } from './importer';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const only = opt('only')?.split(',');
  const files = Object.fromEntries((opt('file') ?? '').split(',').filter(Boolean).map((kv) => {
    const [id, file] = kv.split('=');
    return [id!, [file!]];
  }));
  const [dir, out = 'wc3-out'] = args;
  if (!dir) {
    console.log('usage: node dist-electron/wc3/cli.js <Warcraft III folder> [out folder] [--only ids] [--file id=Model,...]');
    process.exit(2);
  }
  let last = '';
  const report = await importWarcraft(dir, path.resolve(out), (p) => {
    const line = `${p.stage} ${p.done}/${p.total}${p.current ? ` ${p.current}` : ''}`;
    if (line !== last) console.log(line);
    last = line;
  }, { only, files });
  for (const line of report.log) console.log(line);
  const counts: Record<string, number> = {};
  for (const m of Object.values(report.models)) counts[m.status] = (counts[m.status] ?? 0) + 1;
  console.log(`models: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  for (const [id, m] of Object.entries(report.models)) if (m.status !== 'converted') console.log(`  ${id}: ${m.status}${m.error ? ` (${m.error})` : ''}`);
  console.log(report.ok ? `wrote ${path.join(out, PACK_FILE)} and ${REPORT_FILE}` : `no pack written; see ${path.join(out, REPORT_FILE)}`);
  process.exit(report.ok ? 0 : 1);
}

void main();
