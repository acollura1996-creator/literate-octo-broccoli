// The desktop app's side of "Use my Warcraft III art": choosing the install, running the importer
// (worker.ts) and handing the pack to the game. Everything stays in this computer's app data
// (userData/wc3): the pack is Blizzard's art, made from the player's own copy, for their own use.
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { PACK_FILE, REPORT_FILE, type ImportReport } from './importer';

const dir = (): string => path.join(app.getPath('userData'), 'wc3');
const settingsFile = (): string => path.join(dir(), 'settings.json');

interface Settings {
  enabled: boolean;
  source?: string;
}

function settings(): Settings {
  try {
    return { enabled: true, ...(JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<Settings>) };
  } catch {
    return { enabled: true };
  }
}

function saveSettings(s: Settings): void {
  try {
    writeFileSync(settingsFile(), JSON.stringify(s));
  } catch {
    // (no pack folder yet)
  }
}

export interface Wc3Status {
  installed: boolean;
  enabled: boolean;
  source?: string;
  created?: string;
  bytes?: number;
  units?: number;
  missing?: string[];
  failed?: string[];
  busy: boolean;
}

function summary(report: ImportReport | null): Pick<Wc3Status, 'units' | 'missing' | 'failed' | 'created'> {
  if (!report) return {};
  const ids = Object.entries(report.models);
  return {
    created: report.created,
    units: ids.filter(([, m]) => m.status === 'converted').length,
    missing: ids.filter(([, m]) => m.status === 'missing').map(([id]) => id),
    failed: ids.filter(([, m]) => m.status === 'failed').map(([id]) => id),
  };
}

function readReport(): ImportReport | null {
  try {
    return JSON.parse(readFileSync(path.join(dir(), REPORT_FILE), 'utf8')) as ImportReport;
  } catch {
    return null;
  }
}

let busy = false;
/** The folder last picked in the dialog: the only one (besides the last import's) the page may import. */
let chosen: string | null = null;

function status(): Wc3Status {
  const pack = path.join(dir(), PACK_FILE);
  const installed = existsSync(pack);
  const s = settings();
  return { installed, enabled: s.enabled, source: s.source, bytes: installed ? statSync(pack).size : undefined, busy, ...(installed ? summary(readReport()) : {}) };
}

/** Where Warcraft III usually is, to start the folder dialog there. */
function guessInstall(): string | undefined {
  const roots = process.platform === 'win32' ? ['C:\\Program Files (x86)', 'C:\\Program Files', 'D:\\Program Files (x86)', 'D:\\Games', 'C:\\Games'] : [path.join(app.getPath('home'), 'Games')];
  for (const r of roots) for (const name of ['Warcraft III', 'Warcraft III Reforged']) if (existsSync(path.join(r, name))) return path.join(r, name);
  return undefined;
}

export function registerWarcraftIpc(): void {
  ipcMain.handle('wc3:status', () => status());

  ipcMain.handle('wc3:choose', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = { title: 'Choose the folder Warcraft III is installed in', defaultPath: settings().source ?? guessInstall(), properties: ['openDirectory' as const] };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    chosen = res.canceled ? null : res.filePaths[0] ?? null;
    return chosen;
  });

  ipcMain.handle('wc3:import', (e, source: string) => {
    if (busy) return Promise.resolve({ ok: false, error: 'An import is already running.', status: status() });
    // Only a folder the player chose (development runs may name any, for tests).
    if (app.isPackaged && source !== chosen && source !== settings().source) return Promise.resolve({ ok: false, error: 'Choose the folder first.', status: status() });
    busy = true;
    const sender = e.sender;
    return new Promise((resolve) => {
      // HE3D_WC3_FILES (unpackaged development runs only) names other model files for some ids:
      // `footman=TestSoldier,barracks=TestBarracks`, as the command line importer's --file does.
      const files = !app.isPackaged && process.env.HE3D_WC3_FILES ? Object.fromEntries(process.env.HE3D_WC3_FILES.split(',').map((kv) => kv.split('=')).map(([id, f]) => [id, [f]])) : undefined;
      const worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: { dir: source, outDir: dir(), files } });
      const finish = (result: { ok: boolean; error?: string; status?: Wc3Status; log?: string[] }): void => {
        busy = false;
        resolve({ ...result, status: status() });
      };
      worker.on('message', (m: { type: string; progress?: unknown; report?: ImportReport; message?: string }) => {
        if (m.type === 'progress' && !sender.isDestroyed()) sender.send('wc3:progress', m.progress);
        if (m.type === 'done' && m.report) {
          if (m.report.ok) saveSettings({ ...settings(), enabled: true, source });
          finish({ ok: m.report.ok, log: m.report.log });
        }
        if (m.type === 'error') finish({ ok: false, error: m.message });
      });
      worker.on('error', (err) => finish({ ok: false, error: String(err?.stack ?? err) }));
      worker.on('exit', (code) => {
        if (busy) finish({ ok: false, error: `The importer stopped (code ${code}).` });
      });
    });
  });

  ipcMain.handle('wc3:enable', (_e, enabled: boolean) => {
    saveSettings({ ...settings(), enabled: !!enabled });
    return status();
  });

  ipcMain.handle('wc3:remove', () => {
    rmSync(path.join(dir(), PACK_FILE), { force: true });
    rmSync(path.join(dir(), REPORT_FILE), { force: true });
    return status();
  });

  ipcMain.handle('wc3:report', () => {
    const file = path.join(dir(), REPORT_FILE);
    if (existsSync(file)) shell.showItemInFolder(file);
    return existsSync(file);
  });

  /** The pack's bytes, when there is one and it is switched on. */
  ipcMain.handle('wc3:pack', () => {
    const pack = path.join(dir(), PACK_FILE);
    if (!settings().enabled || !existsSync(pack)) return null;
    const b = readFileSync(pack);
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  });
}
