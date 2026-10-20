// The "Warcraft III Models" dialog (desktop app only): import the player's own Warcraft III models
// through the importer in electron/wc3, switch them on or off, or remove them. The game loads the
// pack when it starts, so a change takes effect after a restart.
import type { Wc3Bridge, Wc3Status } from '../globals.d.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const STAGES: Record<string, string> = {
  open: 'Opening the game files…',
  data: 'Reading the unit tables…',
  models: 'Converting models',
  write: 'Writing the models…',
  done: 'Done.',
};

/** Show the dialog's buttons (desktop app only); `open` shows the dialog. */
export function bindWarcraftModels(open: () => void): void {
  const bridge = window.desktop?.wc3;
  if (!bridge) return;
  $('btn-wc3').classList.remove('hidden');
  $('menu-wc3').classList.remove('hidden');
  $('btn-wc3').addEventListener('click', open);
  let changed = false;
  const status = $('wc3-status');
  const enabled = $<HTMLInputElement>('wc3-enabled');
  const importBtn = $<HTMLButtonElement>('wc3-import');

  const show = (s: Wc3Status): void => {
    if (s.installed) {
      const parts = [`Imported: ${s.units ?? 0} unit and building types`];
      if (s.created) parts.push(`on ${new Date(s.created).toLocaleDateString()}`);
      if (s.bytes) parts.push(`(${(s.bytes / 1024 / 1024).toFixed(1)} MB)`);
      let text = `${parts.join(' ')}.`;
      if (s.missing?.length) text += ` Not found in your copy: ${s.missing.length} (they keep the game's own models).`;
      if (s.failed?.length) text += ` Could not convert: ${s.failed.join(', ')}.`;
      status.textContent = text;
    } else status.textContent = 'Nothing imported yet: the game uses its own models.';
    enabled.checked = s.enabled;
    enabled.disabled = !s.installed;
    $('wc3-remove').classList.toggle('hidden', !s.installed);
    $('wc3-report').classList.toggle('hidden', !s.installed && !s.failed?.length);
    $('wc3-reload').classList.toggle('hidden', !changed);
    importBtn.textContent = s.installed ? 'Import again from Warcraft III…' : 'Import from Warcraft III…';
    importBtn.disabled = s.busy;
  };
  const refresh = (): void => void bridge.status().then(show, () => (status.textContent = 'The importer is not available.'));

  $('modal-wc3').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset['act'] === 'close' || t.id === 'modal-wc3') $('modal-wc3').classList.add('hidden');
  });
  enabled.addEventListener('change', () => {
    changed = true;
    void bridge.enable(enabled.checked).then(show);
  });
  $('wc3-remove').addEventListener('click', () => {
    changed = true;
    void bridge.remove().then(show);
  });
  $('wc3-report').addEventListener('click', () => void bridge.showReport());
  $('wc3-reload').addEventListener('click', () => location.reload());
  importBtn.addEventListener('click', () => void runImport(bridge));

  async function runImport(b: Wc3Bridge): Promise<void> {
    const dir = await b.choose();
    if (!dir) return;
    importBtn.disabled = true;
    const progress = $('wc3-progress');
    const bar = progress.querySelector<HTMLElement>('.wc3-bar')!;
    const step = progress.querySelector<HTMLElement>('.wc3-step')!;
    progress.classList.remove('hidden');
    bar.style.width = '0%';
    status.textContent = `Importing from ${dir}…`;
    const off = b.onProgress((p) => {
      const k = p.stage === 'models' ? p.done / Math.max(1, p.total) : p.stage === 'write' || p.stage === 'done' ? 1 : 0;
      bar.style.width = `${Math.round(5 + k * 95)}%`;
      step.textContent = p.stage === 'models' ? `${STAGES.models} ${p.done + 1} of ${p.total}…` : STAGES[p.stage] ?? '';
    });
    try {
      const res = await b.import(dir);
      changed = changed || res.ok;
      show(res.status);
      if (!res.ok) status.textContent = `The import did not work: ${res.error ?? res.log?.slice(-1)[0] ?? 'no Warcraft III models were found there'}. Choose the folder Warcraft III is installed in.`;
    } finally {
      off();
      progress.classList.add('hidden');
      importBtn.disabled = false;
    }
  }

  refresh();
  // Opening the dialog refreshes it.
  new MutationObserver(() => {
    if (!$('modal-wc3').classList.contains('hidden')) refresh();
  }).observe($('modal-wc3'), { attributes: true, attributeFilter: ['class'] });
}
