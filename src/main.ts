// Entry point: title/setup screen, game construction and the main loop.
import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/900.css';
import { Overlay } from './ui/overlay.ts';
import { Game } from './game/game.ts';
import { Input } from './input.ts';
import { Hud } from './ui/hud.ts';
import { HEROES, HERO_IDS } from './data/heroes.ts';
import { UNITS } from './data/units.ts';
import { ABILITIES } from './game/abilities.ts';
import { TEAM_COLORS } from './data/colors.ts';
import { initAudio, playSfx, playBark, barkVoice, startMusic, stopMusic, setMuted, isMuted } from './audio.ts';
import { GeneralAI } from './ai/general.ts';
import { Roads } from './game/roads.ts';
import type { GameOptions, RivalSpec } from './game/game.ts';
import type { SimHooks } from './game/hooks.ts';
import type { Unit } from './game/unit.ts';
import type { GameOver, GeneralMode, Player } from './game/types.ts';
import type { BarkKind } from './audio.ts';
import type { BabylonView } from './babylon/BabylonView.ts';
import type { Quality } from './babylon/Graphics.ts';
import type { SpatialAudio } from './babylon/SpatialAudio.ts';
import type { PerfStats } from './globals.d.ts';

/** An element of index.html (always present), as the element type the caller expects. */
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

/** The title screen's choices (kept across page updates in the Artifact viewer). */
type Settings = Required<Pick<GameOptions, 'mode' | 'heroId' | 'rivals' | 'difficulty'>>;
const settings: Settings = {
  mode: 'hero',
  heroId: 'paladin',
  // Computer generals. By default a mix of AI heroes and AI empires, all rivals.
  rivals: [
    { mode: 'hero', hero: 'random', team: 'rival' },
    { mode: 'empire', hero: 'random', team: 'rival' },
    { mode: 'random', hero: 'random', team: 'rival' },
  ],
  difficulty: 'normal',
};

const ATTRIBUTE_NAMES = { str: 'Strength', agi: 'Agility', int: 'Intelligence' };

const RIVAL_COLORS: [string, string][] = [
  ['Blue', '#0042ff'],
  ['Teal', '#1ce6b9'],
  ['Purple', '#8a3ad0'],
];

/** Editable rows for the computer generals on the title screen. */
function renderRivalRows(): void {
  const box = $('rival-rows');
  box.innerHTML = '';
  settings.rivals.forEach((r, i) => {
    const [cname, ccol] = RIVAL_COLORS[i]!;
    const row = document.createElement('div');
    row.className = 'rival-row';
    const heroOpts = ['random', ...HERO_IDS]
      .map((h) => `<option value="${h}"${r.hero === h ? ' selected' : ''}>${h === 'random' ? 'Random' : UNITS[h]!.name}</option>`)
      .join('');
    row.innerHTML = `
      <div class="rr-head">
        <span class="swatch" style="background:${ccol}"></span>
        <b>${cname} general</b>
        ${settings.rivals.length > 1 ? `<button class="rr-remove" type="button" aria-label="Remove the ${cname} general">✕</button>` : ''}
      </div>
      <div class="rr-fields">
        <label>Path<select id="rival-${i}-mode" data-k="mode">
          <option value="random"${r.mode === 'random' ? ' selected' : ''}>Random</option>
          <option value="hero"${r.mode === 'hero' ? ' selected' : ''}>Hero</option>
          <option value="empire"${r.mode === 'empire' ? ' selected' : ''}>Empire</option>
        </select></label>
        <label>Hero<select id="rival-${i}-hero" data-k="hero"${r.mode === 'empire' ? ' disabled' : ''}>${heroOpts}</select></label>
        <label>Side<select id="rival-${i}-team" data-k="team">
          <option value="rival"${r.team === 'rival' ? ' selected' : ''}>Rival</option>
          <option value="ally"${r.team === 'ally' ? ' selected' : ''}>Ally</option>
        </select></label>
      </div>`;
    row.querySelectorAll('select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const k = sel.dataset['k'] as keyof RivalSpec;
        (r as Record<keyof RivalSpec, string>)[k] = sel.value;
        if (k === 'mode') renderRivalRows();
      });
    });
    row.querySelector('.rr-remove')?.addEventListener('click', () => {
      settings.rivals.splice(i, 1);
      renderRivalRows();
    });
    box.appendChild(row);
  });
  $('btn-add-rival').classList.toggle('hidden', settings.rivals.length >= 3);
}

// The view and overlay exist from the first screen on; the rest while a game is set up.
let view!: BabylonView;
let overlay!: Overlay;
let game: Game | null = null;
let input: Input | null = null;
let hud: Hud | null = null;
let paused = false;
let speed = Number(params.get('speed')) || 1;
let running = false;
let lastFrame = 0;
let endShown = false;

// The Babylon.js renderer and audio backend, loaded before boot (src/babylon/).
let ViewClass: typeof BabylonView | null = null;
/** Spatial sound effects and ambience (src/babylon/SpatialAudio.ts). */
let spatial: SpatialAudio | null = null;

function ensureView(): void {
  if (view) return;
  view = new ViewClass!($<HTMLCanvasElement>('gl'));
  overlay = new Overlay($<HTMLCanvasElement>('overlay'), null, view, null);
  window.addEventListener('resize', () => {
    view.resize();
    overlay.resize();
  });
}

// ------------------------------------------------------------- title screen
function buildTitle(): void {
  ensureView();
  const list = $('hero-list');
  list.innerHTML = '';
  for (const id of HERO_IDS) {
    const h = HEROES[id]!;
    const d = UNITS[id]!;
    const btn = document.createElement('button');
    btn.className = `heroc${id === settings.heroId ? ' selected' : ''}`;
    btn.dataset['hero'] = id;
    let img = '';
    try {
      img = view.icon(d.model, TEAM_COLORS.red, false);
    } catch (e) {
      console.error(e);
    }
    btn.innerHTML = `
      <img src="${img}" alt="">
      <div class="hn">${d.name}</div>
      <div class="ht">${d.title}</div>
      <div class="hp">Primary: ${ATTRIBUTE_NAMES[h.primary]}</div>
      <div class="hb">${h.blurb}</div>
      <div class="ht" style="margin-top:4px">${h.abilities.map((a) => `${ABILITIES[a]!.icon} ${ABILITIES[a]!.name}`).join('<br>')}</div>`;
    btn.addEventListener('click', () => {
      settings.heroId = id;
      list.querySelectorAll<HTMLElement>('.heroc').forEach((b) => b.classList.toggle('selected', b.dataset['hero'] === id));
      initSound();
      sfx('click', 0.6);
    });
    list.appendChild(btn);
  }
  document.querySelectorAll<HTMLElement>('.path').forEach((b) => {
    b.addEventListener('click', () => {
      settings.mode = b.dataset['mode'] as GeneralMode;
      document.querySelectorAll('.path').forEach((x) => x.classList.toggle('selected', x === b));
      $('hero-pick').classList.toggle('hidden', settings.mode !== 'hero');
      initSound();
      sfx('click', 0.6);
    });
  });
  $('btn-add-rival').addEventListener('click', () => {
    if (settings.rivals.length >= 3) return;
    const heroes = settings.rivals.filter((r) => r.mode === 'hero').length;
    const empires = settings.rivals.filter((r) => r.mode === 'empire').length;
    settings.rivals.push({ mode: heroes <= empires ? 'hero' : 'empire', hero: 'random', team: 'rival' });
    renderRivalRows();
  });
  $('btn-start').addEventListener('click', () => {
    settings.difficulty = $<HTMLSelectElement>('opt-difficulty').value as Settings['difficulty'];
    initSound();
    startGame();
  });
  $('btn-help').addEventListener('click', () => openModal('modal-help'));
  document.querySelectorAll<HTMLElement>('.path').forEach((x) => x.classList.toggle('selected', x.dataset['mode'] === settings.mode));
  $('hero-pick').classList.toggle('hidden', settings.mode !== 'hero');
  renderRivalRows();
  $<HTMLSelectElement>('opt-difficulty').value = settings.difficulty;
  if (matchMedia('(pointer: coarse)').matches) {
    const n = document.createElement('div');
    n.className = 'touch-note';
    n.textContent = 'Heroes & Empires is a real-time strategy game designed for mouse and keyboard.';
    $('btn-start').after(n);
  }
}

// --------------------------------------------------------------- modals
function openModal(id: string): void {
  $(id).classList.remove('hidden');
}
function closeModal(id: string): void {
  $(id).classList.add('hidden');
}

function setPaused(p: boolean): void {
  paused = p;
  $('pause-banner').classList.toggle('hidden', !p || !$('modal-menu').classList.contains('hidden'));
}

/** The `data-act` of a clicked element. */
const actOf = (e: Event): string | undefined => (e.target as HTMLElement).dataset?.['act'];

function bindModals(): void {
  $('modal-menu').addEventListener('click', (e) => {
    const act = actOf(e);
    if (!act) return;
    sfx('click', 0.6);
    if (act === 'resume') {
      closeModal('modal-menu');
      setPaused(false);
    } else if (act === 'help') openModal('modal-help');
    else if (act === 'quests') showQuests();
    else if (act === 'restart') {
      closeModal('modal-menu');
      startGame();
    } else if (act === 'quit') quitToTitle();
  });
  for (const id of ['modal-help', 'modal-quests']) {
    $(id).addEventListener('click', (e) => {
      if (actOf(e) === 'close' || (e.target as HTMLElement).id === id) {
        closeModal(id);
        if (id === 'modal-quests' && $('modal-menu').classList.contains('hidden') && !game?.over) setPaused(false);
      }
    });
  }
  $('modal-end').addEventListener('click', (e) => {
    const act = actOf(e);
    if (act === 'observe') closeModal('modal-end');
    else if (act === 'restart') {
      closeModal('modal-end');
      startGame();
    } else if (act === 'quit') quitToTitle();
  });
  $('btn-menu').addEventListener('click', () => toggleMenu());
  $('btn-quests').addEventListener('click', () => showQuests());
  $('btn-fullscreen').addEventListener('click', toggleFullscreen);
  $('btn-sound').addEventListener('click', () => {
    setMuted(!isMuted());
    spatial?.setMuted(isMuted());
    $('btn-sound').textContent = isMuted() ? '🔇' : '🔊';
  });
  window.addEventListener('keydown', (e) => {
    // Ctrl+Shift+F: frame-rate readout (packaged builds take no URL options).
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') {
      e.preventDefault();
      perf.on = !perf.on;
      perf.el?.remove();
      perf.el = null;
      perf.t0 = 0;
      return;
    }
    // Alt+Enter: fullscreen, in or out of a game (F11 is the Generals board while playing).
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    if (!running) return;
    if (e.key === 'F10') {
      e.preventDefault();
      toggleMenu();
    } else if (e.key === 'F9') {
      e.preventDefault();
      showQuests();
    } else if (e.key === 'F11') {
      e.preventDefault();
      hud?.toggleScoreboard();
    } else if (e.key === 'Pause') {
      setPaused(!paused);
    } else if (e.key === 'Escape' && !$('modal-menu').classList.contains('hidden')) {
      closeModal('modal-menu');
      setPaused(false);
    }
  });
}

/** The desktop app toggles the window itself (as F11 does there); browsers use the page API. */
function toggleFullscreen(): void {
  if (window.desktop?.toggleFullscreen) {
    void window.desktop.toggleFullscreen();
    return;
  }
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => game?.message('Fullscreen is not available here.', '#ccc'));
}

function bindCameraOptions(input: Input): void {
  const s = input.settings;
  const scroll = $<HTMLInputElement>('opt-scroll');
  const scrollVal = $('opt-scroll-val');
  const showScroll = (v: number): void => {
    const name = v < 0.6 ? 'Very slow' : v < 0.85 ? 'Slow' : v <= 1.15 ? 'Normal' : v < 1.6 ? 'Fast' : 'Very fast';
    scrollVal.textContent = `${name} (${Math.round(v * 100)}%)`;
  };
  const wheel = $<HTMLSelectElement>('opt-wheel');
  const edge = $<HTMLInputElement>('opt-edge');
  const quality = $<HTMLSelectElement>('opt-quality');
  scroll.value = String(s.scrollSpeed || 1);
  showScroll(Number(scroll.value));
  wheel.value = s.wheelMode;
  edge.checked = !!s.edgeScroll;
  // The speed applies while the slider moves; it is saved when it is let go.
  scroll.addEventListener('input', () => {
    s.scrollSpeed = Number(scroll.value);
    showScroll(s.scrollSpeed);
  });
  scroll.addEventListener('change', () => {
    s.scrollSpeed = Number(scroll.value);
    input.saveSettings();
  });
  wheel.addEventListener('change', () => {
    s.wheelMode = wheel.value as typeof s.wheelMode;
    input.saveSettings();
  });
  edge.addEventListener('change', () => {
    s.edgeScroll = edge.checked;
    input.saveSettings();
  });
  // Graphics presets.
  $('opt-quality-row').classList.remove('hidden');
  quality.value = view.quality;
  quality.addEventListener('change', () => view.setQuality(quality.value as Quality));
}

function toggleMenu(): void {
  const m = $('modal-menu');
  if (m.classList.contains('hidden')) {
    openModal('modal-menu');
    setPaused(true);
  } else {
    closeModal('modal-menu');
    setPaused(false);
  }
}

function showQuests(): void {
  const g = game;
  if (!g) return;
  const others = g.generals.filter((p) => !p.isHuman);
  const describe = (p: Player): string =>
    `<span style="color:${g.nameColor(p)}">${p.name}</span> (${p.mode === 'hero' ? UNITS[p.heroType!]!.name : 'Empire'})${p.defeated ? ' — <b>defeated</b>' : ''}`;
  const allies = others.filter((p) => g.isAlliedToHuman(p));
  const rivals = others.filter((p) => !g.isAlliedToHuman(p));
  $('quest-rivals').innerHTML = [
    allies.length ? `Your allies: ${allies.map(describe).join(', ')}. They defend your base and join your assault on Kalenden.` : '',
    rivals.length ? `Rival generals: ${rivals.map(describe).join(', ')}. Defeat them all, or slay Kalenden before they do.` : 'Every general is on your side. Bring the tyrant down together.',
  ]
    .filter(Boolean)
    .join('<br>');
  openModal('modal-quests');
  setPaused(true);
}

// ------------------------------------------------------------- game setup
function teardown(): void {
  if (!game) return;
  running = false;
  input!.enabled = false;
  input!.cancelPlacement();
  input!.cancelLine();
  view.clearWorld();
  game = null;
}

function startGame(): void {
  ensureView();
  teardown();
  endShown = false;
  $('screen-title').classList.add('hidden');
  $('screen-loading').classList.remove('hidden');
  $('hud').classList.add('hidden');
  // The view loads its models first (view.ready).
  Promise.resolve(view.ready)
    .then(() => new Promise((resolve) => setTimeout(resolve, 30)))
    .then(createGame)
    .catch((e) => {
      console.error(e);
      $('screen-loading').querySelector('.loading-text')!.textContent = `Failed to start: ${(e as Error).message}`;
    });
}

/** Create or resume the audio (call from user gestures). */
function initSound(): void {
  if (initAudio()) spatial?.start();
}

/** Play a sound effect, at a map position when given (fading with distance from the camera target). */
function sfx(name: string, vol = 1, x?: number, z?: number): void {
  if (spatial?.play(name, vol, x, z)) return;
  if (x !== undefined && view) {
    const t = view.cam.target;
    const d = Math.hypot(t.x - x, t.z - z!);
    vol *= Math.max(0, Math.min(1, 1 - (d - 14) / 36));
    if (vol < 0.03) return;
  }
  playSfx(name, vol);
}

/** A unit acknowledges a selection or an order ('select' | 'move' | 'attack'). */
function bark(u: Unit, kind: BarkKind): void {
  const voice = barkVoice(u?.def);
  if (voice && !spatial?.bark(voice, kind)) playBark(voice, kind);
}

function createGame(): void {
  const hooks: SimHooks = {
    onUnitAdded: (u) => view.addUnit(u),
    onUnitRemoved: (u) => view.removeUnit(u),
    onUnitChanged: (u, modelChanged) => view.changeUnit(u, modelChanged),
    onItemDropped: (it) => view.addItem(it),
    onItemTaken: (it) => view.removeItem(it),
    isOnScreen: (x, z) => view.isOnScreen(x, z),
    centerOn: (x, z) => input?.centerOn(x, z),
    sound: sfx,
    onGameOver: (over) => {
      setTimeout(() => showEnd(over), 2500);
    },
  };
  const game_ = new Game({ ...settings }, hooks);
  game = game_;
  view.attachGame(game_);
  hooks.fx = view.fx!;
  game_.fx = view.fx!;
  game_.setup();
  if (params.get('reveal') === '1') game_.fog.reveal();
  // Test helper: let the computer play for the human too.
  if (params.get('aiplayer') === '1') game_.human.ai = new GeneralAI(game_, game_.human);

  if (input) {
    input.game = game;
    input.selection = [];
    input.groups = {};
    input.enabled = true;
    input.targetMode = null;
    input.cardMenu = null;
  } else {
    input = new Input(game_, view, $<HTMLCanvasElement>('gl'));
    input.onBark = bark;
    view.onQualityLowered = (q) => {
      game?.message(`Graphics set to ${q === 'low' ? 'Low' : 'Medium'} for a smoother frame rate (change it in the Menu).`, '#d8ccaa');
      if ($('opt-quality')) $<HTMLSelectElement>('opt-quality').value = q;
    };
    bindCameraOptions(input);
  }
  overlay.game = game_;
  overlay.input = input;
  overlay.resize();
  if (hud) hud.attach(game_);
  else hud = new Hud(game_, view, input);

  const home = game_.homeOf(game_.human);
  if (home) input.centerOn(home.x, home.z + 4);
  const h = game_.human.hero;
  if (h) input.setSelection([h], false);
  game_.message('Welcome, General. Slay Kalenden and claim his lands!', '#ffe680');
  game_.message(
    settings.mode === 'hero'
      ? 'Hero path: slay creeps to gain levels, buy items and hire mercenaries. Press F1 to select your Hero.'
      : 'Empire path: you begin in the Stone Age. Build Houses along roads for citizens who pay taxes, Farms to feed them, and advance through the ages at your town center.',
    '#d8ccaa',
  );
  $('screen-loading').classList.add('hidden');
  $('hud').classList.remove('hidden');
  window.__game = game_;
  window.__input = input;
  window.__view = view;
  window.__U = UNITS;
  window.__R = Roads;
  paused = false;
  setPaused(false);
  if (params.get('bench')) benchmark(Math.max(2, Math.min(600, Number(params.get('bench')) || 200)));
  startMusic();
  if (spatial) {
    spatial.startAmbience(game_);
    const own = new Set(['worker', game_.human.hero ? barkVoice(game_.human.hero.def)! : 'caveman']);
    spatial.prepareBarks([...own]);
  }
  running = true;
  lastFrame = performance.now();
}

function quitToTitle(): void {
  closeModal('modal-menu');
  closeModal('modal-end');
  teardown();
  stopMusic();
  spatial?.stopAmbience();
  $('hud').classList.add('hidden');
  $('screen-title').classList.remove('hidden');
}

function showEnd(over: GameOver): void {
  const g = game;
  if (endShown || !g) return;
  endShown = true;
  g.fog.reveal();
  const t = $('end-title');
  t.textContent = over.victory ? 'Victory!' : 'Defeat';
  t.className = over.victory ? 'victory' : 'defeat';
  $('end-text').textContent = over.text;
  const rows = g.generals
    .map((p) => {
      const col = `#${p.color.toString(16).padStart(6, '0')}`;
      const side = p.isHuman ? ' (you)' : g.isAlliedToHuman(p) ? ' (ally)' : '';
      return `<tr><td style="color:${col}">${p.name}${side}</td><td>${p.mode === 'hero' ? `${UNITS[p.heroType!]!.name} ${p.hero ? `L${p.hero.level}` : ''}` : 'Empire'}</td>
      <td>${p.stats.kills}</td><td>${p.stats.creepsKilled}</td><td>${p.stats.unitsLost}</td><td>${p.stats.goldMined}</td><td>${p.stats.unitsTrained}</td><td>${p.defeated ? 'Defeated' : 'Alive'}</td></tr>`;
    })
    .join('');
  $('end-stats').innerHTML = `<tr><th>General</th><th>Path</th><th>Kills</th><th>Creeps</th><th>Lost</th><th>Gold mined</th><th>Trained</th><th>Status</th></tr>${rows}`;
  openModal('modal-end');
}

// -------------------------------------------------------------- main loop
// Performance readout (?fps=1, or ?bench=N): frame rate and where the frame time goes.
const perf: { on: boolean; frames: number; t0: number; sim: number; render: number; ui: number; el: HTMLElement | null } = {
  on: params.has('fps') || params.has('bench'),
  frames: 0,
  t0: 0,
  sim: 0,
  render: 0,
  ui: 0,
  el: null,
};
window.__perf = null;

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (!running || !game) {
    lastFrame = now;
    return;
  }
  // (Never negative: the first frame of a game can be timed against a later clock reading.)
  const realDt = Math.max(0, Math.min(0.1, (now - lastFrame) / 1000));
  lastFrame = now;
  try {
    const t0 = performance.now();
    if (!paused) {
      const dt = realDt * speed;
      const steps = Math.max(1, Math.ceil(dt / 0.034));
      for (let i = 0; i < steps; i++) game.update(dt / steps);
    }
    const t1 = performance.now();
    input!.update(realDt);
    view.render(paused ? 0 : realDt * speed);
    spatial?.update(view.cam);
    const t2 = performance.now();
    overlay.draw();
    hud!.update(realDt);
    hud!.renderPortrait(now / 1000);
    if (perf.on) perfTick(now, t1 - t0, t2 - t1, performance.now() - t2);
  } catch (e) {
    console.error(e);
  }
}

function perfTick(now: number, simMs: number, renderMs: number, uiMs: number): void {
  perf.frames++;
  perf.sim += simMs;
  perf.render += renderMs;
  perf.ui += uiMs;
  if (!perf.t0) perf.t0 = now;
  if (now - perf.t0 < 500) return;
  const n = perf.frames;
  const stats = view.perfStats();
  const units = game!.units.filter((u) => !u.isBuilding && !u.dead).length;
  const p: PerfStats = { ...stats, fps: (n * 1000) / (now - perf.t0), simMs: perf.sim / n, viewMs: perf.render / n, uiMs: perf.ui / n, units };
  window.__perf = p;
  perf.frames = 0;
  perf.sim = perf.render = perf.ui = 0;
  perf.t0 = now;
  if (!perf.el) {
    perf.el = document.createElement('div');
    perf.el.id = 'perf-readout';
    perf.el.style.cssText = 'position:fixed;top:44px;left:50%;transform:translateX(-50%);z-index:50;font:12px/1.3 monospace;color:#e8ffd0;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:4px;pointer-events:none;white-space:pre';
    document.body.appendChild(perf.el);
  }
  perf.el.textContent = `${p.fps.toFixed(0)} fps · sim ${p.simMs.toFixed(1)} ms · view ${p.viewMs.toFixed(1)} ms · ui ${p.uiMs.toFixed(1)} ms · ${units} units` + (p.drawCalls !== undefined ? ` · ${p.drawCalls} draws · ${p.activeMeshes} active` : '');
}

/** ?bench=N: two armies of mixed units (ancient to galactic) meet between your base and the citadel. */
function benchmark(n: number): void {
  const g = game!;
  const foe = g.generals.find((p) => p !== g.human && g.isEnemy(g.human, p));
  if (!foe) return;
  const home = g.homeOf(g.human)!;
  const dx = 128 - home.x;
  const dz = 128 - home.z;
  const len = Math.hypot(dx, dz) || 1;
  const cx = home.x + (dx / len) * 26;
  const cz = home.z + (dz / len) * 26;
  const types = ['footman', 'archer', 'knight', 'spearman', 'musketeer', 'rifleman', 'crossbowman', 'priest', 'tank', 'catapult', 'laser_trooper', 'mech_walker', 'war_elephant', 'hoplite', 'sniper', 'exo_trooper'];
  const perRow = 12;
  for (let i = 0; i < n; i++) {
    const side = i % 2;
    const k = Math.floor(i / 2);
    const row = Math.floor(k / perRow);
    const col = k % perRow;
    const x = cx + (col - (perRow - 1) / 2) * 1.4;
    const z = cz + (side ? -1 : 1) * (5 + row * 1.4);
    const u = g.spawnUnit(types[k % types.length]!, side ? foe : g.human, x, z);
    g.issueOrder(u, { type: 'attackMove', point: { x: cx, z: cz + (side ? 6 : -6) } });
  }
  input!.centerOn(cx, cz);
  view.cam.distance = view.cam.zoomTarget = 46;
}

function boot(data: { settings?: Partial<Settings> } | undefined): void {
  if (data?.settings) Object.assign(settings, data.settings);
  if (!Array.isArray(settings.rivals) || !settings.rivals.length) settings.rivals = [{ mode: 'random', hero: 'random', team: 'rival' }];
  buildTitle();
  bindModals();
  requestAnimationFrame(frame);
}
// When hosted in the Artifact viewer, keep the chosen settings across page updates.
const hot = window.claude?.hot as import('./globals.d.ts').ArtifactHot<{ settings?: Partial<Settings> }> | undefined;
hot?.snapshot?.(() => ({ settings: { ...settings, rivals: settings.rivals.map((r) => ({ ...r })) } }));

// Test/debug helpers: ?autostart=hero:paladin or ?autostart=empire
function autostart(): void {
  const auto = params.get('autostart');
  if (!auto) return;
  const [mode, heroId] = auto.split(':');
  settings.mode = mode === 'empire' ? 'empire' : 'hero';
  if (heroId && HEROES[heroId]) settings.heroId = heroId;
  // ?rivals=hero-ranger-ally,empire,random  (mode[-hero][-team] per computer general)
  if (params.get('rivals')) {
    settings.rivals = params
      .get('rivals')!
      .split(',')
      .slice(0, 3)
      .map((tok): RivalSpec => {
        const [mode = 'random', hero = 'random', team = 'rival'] = tok.split('-');
        return { mode: mode as RivalSpec['mode'], hero: HEROES[hero] ? hero : 'random', team: team === 'ally' ? 'ally' : 'rival' };
      });
  } else if (params.get('opponents') || params.get('diplomacy')) {
    const n = Math.max(1, Math.min(3, Number(params.get('opponents') || 3)));
    const team = params.get('diplomacy') === 'allied' ? 'ally' : 'rival';
    settings.rivals = Array.from({ length: n }, (): RivalSpec => ({ mode: 'random', hero: 'random', team }));
  }
  if (params.get('difficulty')) settings.difficulty = params.get('difficulty') as Settings['difficulty'];
  startGame();
}

function launch(): void {
  // The view loads its models first (view.ready).
  ensureView();
  void Promise.resolve(view.ready).then(() => {
    spatial?.prerender();
    if (hot?.ready) hot.ready(boot);
    else boot(hot?.data ?? {});
    autostart();
  });
}

void Promise.all([import('./babylon/BabylonView.ts'), import('./babylon/SpatialAudio.ts')]).then(([m, a]) => {
  ViewClass = m.BabylonView;
  spatial = new a.SpatialAudio();
  launch();
});
window.__setSpeed = (s: number) => (speed = s);
window.__initSound = initSound;
window.__audio = () => spatial;
