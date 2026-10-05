// Entry point: title/setup screen, game construction and the main loop.
import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/900.css';
import { View } from './render/view.js';
import { Overlay } from './render/overlay.js';
import { Game } from './game/game.js';
import { Input } from './input.js';
import { Hud } from './ui/hud.js';
import { HEROES, HERO_IDS } from './data/heroes.ts';
import { UNITS } from './data/units.ts';
import { ABILITIES } from './game/abilities.js';
import { TEAM_COLORS } from './render/assets.js';
import { initAudio, playSfx, playBark, barkVoice, startMusic, stopMusic, setMuted, isMuted } from './audio.js';
import { GeneralAI } from './ai/general.js';
import { Roads } from './game/roads.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const settings = {
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

const RIVAL_COLORS = [
  ['Blue', '#0042ff'],
  ['Teal', '#1ce6b9'],
  ['Purple', '#8a3ad0'],
];

/** Editable rows for the computer generals on the title screen. */
function renderRivalRows() {
  const box = $('rival-rows');
  box.innerHTML = '';
  settings.rivals.forEach((r, i) => {
    const [cname, ccol] = RIVAL_COLORS[i];
    const row = document.createElement('div');
    row.className = 'rival-row';
    const heroOpts = ['random', ...HERO_IDS]
      .map((h) => `<option value="${h}"${r.hero === h ? ' selected' : ''}>${h === 'random' ? 'Random' : UNITS[h].name}</option>`)
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
        r[sel.dataset.k] = sel.value;
        if (sel.dataset.k === 'mode') renderRivalRows();
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

let view = null;
let overlay = null;
let game = null;
let input = null;
let hud = null;
let paused = false;
let speed = Number(params.get('speed')) || 1;
let running = false;
let lastFrame = 0;
let endShown = false;

// The renderer: three.js by default, Babylon.js with `?renderer=babylon` (migration in progress,
// see MIGRATION.md). Resolved before boot.
let ViewClass = View;
/** The Babylon.js audio backend (src/babylon/SpatialAudio.ts) with the Babylon renderer; null with three.js. */
let spatial = null;

function ensureView() {
  if (view) return;
  view = new ViewClass($('gl'));
  overlay = new Overlay($('overlay'), null, view, null);
  window.addEventListener('resize', () => {
    view.resize();
    overlay.resize();
  });
}

// ------------------------------------------------------------- title screen
function buildTitle() {
  ensureView();
  const list = $('hero-list');
  list.innerHTML = '';
  for (const id of HERO_IDS) {
    const h = HEROES[id];
    const d = UNITS[id];
    const btn = document.createElement('button');
    btn.className = `heroc${id === settings.heroId ? ' selected' : ''}`;
    btn.dataset.hero = id;
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
      <div class="hp">Primary: ${{ str: 'Strength', agi: 'Agility', int: 'Intelligence' }[h.primary]}</div>
      <div class="hb">${h.blurb}</div>
      <div class="ht" style="margin-top:4px">${h.abilities.map((a) => `${ABILITIES[a].icon} ${ABILITIES[a].name}`).join('<br>')}</div>`;
    btn.addEventListener('click', () => {
      settings.heroId = id;
      list.querySelectorAll('.heroc').forEach((b) => b.classList.toggle('selected', b.dataset.hero === id));
      initSound();
      sfx('click', 0.6);
    });
    list.appendChild(btn);
  }
  document.querySelectorAll('.path').forEach((b) => {
    b.addEventListener('click', () => {
      settings.mode = b.dataset.mode;
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
    settings.difficulty = $('opt-difficulty').value;
    initSound();
    startGame();
  });
  $('btn-help').addEventListener('click', () => openModal('modal-help'));
  document.querySelectorAll('.path').forEach((x) => x.classList.toggle('selected', x.dataset.mode === settings.mode));
  $('hero-pick').classList.toggle('hidden', settings.mode !== 'hero');
  renderRivalRows();
  $('opt-difficulty').value = settings.difficulty;
  if (matchMedia('(pointer: coarse)').matches) {
    const n = document.createElement('div');
    n.className = 'touch-note';
    n.textContent = 'Heroes & Empires is a real-time strategy game designed for mouse and keyboard.';
    $('btn-start').after(n);
  }
}

// --------------------------------------------------------------- modals
function openModal(id) {
  $(id).classList.remove('hidden');
}
function closeModal(id) {
  $(id).classList.add('hidden');
}

function setPaused(p) {
  paused = p;
  $('pause-banner').classList.toggle('hidden', !p || !$('modal-menu').classList.contains('hidden'));
}

function bindModals() {
  $('modal-menu').addEventListener('click', (e) => {
    const act = e.target.dataset?.act;
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
      if (e.target.dataset?.act === 'close' || e.target.id === id) {
        closeModal(id);
        if (id === 'modal-quests' && $('modal-menu').classList.contains('hidden') && !game?.over) setPaused(false);
      }
    });
  }
  $('modal-end').addEventListener('click', (e) => {
    const act = e.target.dataset?.act;
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
function toggleFullscreen() {
  if (window.desktop?.toggleFullscreen) {
    window.desktop.toggleFullscreen();
    return;
  }
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => game?.message('Fullscreen is not available here.', '#ccc'));
}

function bindCameraOptions() {
  const s = input.settings;
  $('opt-scroll').value = String(s.scrollSpeed);
  if (!$('opt-scroll').value) $('opt-scroll').value = '1';
  $('opt-wheel').value = s.wheelMode;
  $('opt-edge').checked = !!s.edgeScroll;
  $('opt-scroll').addEventListener('change', () => {
    s.scrollSpeed = Number($('opt-scroll').value);
    input.saveSettings();
  });
  $('opt-wheel').addEventListener('change', () => {
    s.wheelMode = $('opt-wheel').value;
    input.saveSettings();
  });
  $('opt-edge').addEventListener('change', () => {
    s.edgeScroll = $('opt-edge').checked;
    input.saveSettings();
  });
  // Graphics presets (Babylon renderer only).
  if (typeof view.setQuality === 'function') {
    $('opt-quality-row').classList.remove('hidden');
    $('opt-quality').value = view.quality;
    $('opt-quality').addEventListener('change', () => view.setQuality($('opt-quality').value));
  }
}

function toggleMenu() {
  const m = $('modal-menu');
  if (m.classList.contains('hidden')) {
    openModal('modal-menu');
    setPaused(true);
  } else {
    closeModal('modal-menu');
    setPaused(false);
  }
}

function showQuests() {
  if (!game) return;
  const others = game.generals.filter((p) => !p.isHuman);
  const describe = (p) =>
    `<span style="color:${game.nameColor(p)}">${p.name}</span> (${p.mode === 'hero' ? UNITS[p.heroType].name : 'Empire'})${p.defeated ? ' — <b>defeated</b>' : ''}`;
  const allies = others.filter((p) => game.isAlliedToHuman(p));
  const rivals = others.filter((p) => !game.isAlliedToHuman(p));
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
function teardown() {
  if (!game) return;
  running = false;
  input.enabled = false;
  input.cancelPlacement();
  input.cancelLine();
  view.clearWorld();
  game = null;
}

function startGame() {
  ensureView();
  teardown();
  endShown = false;
  $('screen-title').classList.add('hidden');
  $('screen-loading').classList.remove('hidden');
  $('hud').classList.add('hidden');
  // The Babylon view loads its models first (view.ready); the three.js view has nothing to wait for.
  Promise.resolve(view.ready)
    .then(() => new Promise((resolve) => setTimeout(resolve, 30)))
    .then(createGame)
    .catch((e) => {
      console.error(e);
      $('screen-loading').querySelector('.loading-text').textContent = `Failed to start: ${e.message}`;
    });
}

/** Create or resume the audio (call from user gestures). */
function initSound() {
  if (initAudio()) spatial?.start();
}

/** Play a sound effect, at a map position when given (fading with distance from the camera target). */
function sfx(name, vol = 1, x, z) {
  if (spatial?.play(name, vol, x, z)) return;
  if (x !== undefined && view) {
    const t = view.cam.target;
    const d = Math.hypot(t.x - x, t.z - z);
    vol *= Math.max(0, Math.min(1, 1 - (d - 14) / 36));
    if (vol < 0.03) return;
  }
  playSfx(name, vol);
}

/** A unit acknowledges a selection or an order ('select' | 'move' | 'attack'). */
function bark(u, kind) {
  const voice = barkVoice(u?.def);
  if (voice && !spatial?.bark(voice, kind)) playBark(voice, kind);
}

function createGame() {
  /** @type {import('./game/hooks').SimHooks} */
  const hooks = {
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
  game = new Game({ ...settings }, hooks);
  view.attachGame(game);
  hooks.fx = view.fx;
  game.fx = view.fx;
  game.setup();
  if (params.get('reveal') === '1') game.fog.reveal();
  // Test helper: let the computer play for the human too.
  if (params.get('aiplayer') === '1') game.human.ai = new GeneralAI(game, game.human);

  if (input) {
    input.game = game;
    input.selection = [];
    input.groups = {};
    input.enabled = true;
    input.targetMode = null;
    input.cardMenu = null;
  } else {
    input = new Input(game, view, $('gl'));
    input.onBark = bark;
    view.onQualityLowered = (q) => {
      game?.message(`Graphics set to ${q === 'low' ? 'Low' : 'Medium'} for a smoother frame rate (change it in the Menu).`, '#d8ccaa');
      if ($('opt-quality')) $('opt-quality').value = q;
    };
    bindCameraOptions();
  }
  overlay.game = game;
  overlay.input = input;
  overlay.resize();
  if (hud) hud.attach(game);
  else hud = new Hud(game, view, input);

  const home = game.homeOf(game.human);
  if (home) input.centerOn(home.x, home.z + 4);
  const h = game.human.hero;
  if (h) input.setSelection([h], false);
  game.message('Welcome, General. Slay Kalenden and claim his lands!', '#ffe680');
  game.message(
    settings.mode === 'hero'
      ? 'Hero path: slay creeps to gain levels, buy items and hire mercenaries. Press F1 to select your Hero.'
      : 'Empire path: you begin in the Stone Age. Build Houses along roads for citizens who pay taxes, Farms to feed them, and advance through the ages at your town center.',
    '#d8ccaa',
  );
  $('screen-loading').classList.add('hidden');
  $('hud').classList.remove('hidden');
  window.__game = game;
  window.__input = input;
  window.__view = view;
  window.__U = UNITS;
  window.__R = Roads;
  paused = false;
  setPaused(false);
  if (params.get('bench')) benchmark(Math.max(2, Math.min(600, Number(params.get('bench')) || 200)));
  startMusic();
  if (spatial) {
    spatial.startAmbience(game);
    const own = new Set(['worker', game.human.hero ? barkVoice(game.human.hero.def) : 'caveman']);
    spatial.prepareBarks([...own]);
  }
  running = true;
  lastFrame = performance.now();
}

function quitToTitle() {
  closeModal('modal-menu');
  closeModal('modal-end');
  teardown();
  stopMusic();
  spatial?.stopAmbience();
  $('hud').classList.add('hidden');
  $('screen-title').classList.remove('hidden');
}

function showEnd(over) {
  if (endShown || !game) return;
  endShown = true;
  game.fog.reveal();
  const t = $('end-title');
  t.textContent = over.victory ? 'Victory!' : 'Defeat';
  t.className = over.victory ? 'victory' : 'defeat';
  $('end-text').textContent = over.text;
  const rows = game.generals
    .map((p) => {
      const col = `#${p.color.toString(16).padStart(6, '0')}`;
      const side = p.isHuman ? ' (you)' : game.isAlliedToHuman(p) ? ' (ally)' : '';
      return `<tr><td style="color:${col}">${p.name}${side}</td><td>${p.mode === 'hero' ? `${UNITS[p.heroType].name} ${p.hero ? `L${p.hero.level}` : ''}` : 'Empire'}</td>
      <td>${p.stats.kills}</td><td>${p.stats.creepsKilled}</td><td>${p.stats.unitsLost}</td><td>${p.stats.goldMined}</td><td>${p.stats.unitsTrained}</td><td>${p.defeated ? 'Defeated' : 'Alive'}</td></tr>`;
    })
    .join('');
  $('end-stats').innerHTML = `<tr><th>General</th><th>Path</th><th>Kills</th><th>Creeps</th><th>Lost</th><th>Gold mined</th><th>Trained</th><th>Status</th></tr>${rows}`;
  openModal('modal-end');
}

// -------------------------------------------------------------- main loop
// Performance readout (?fps=1, or ?bench=N): frame rate and where the frame time goes.
const perf = { on: params.has('fps') || params.has('bench'), frames: 0, t0: 0, sim: 0, render: 0, ui: 0, el: null };
window.__perf = null;

function frame(now) {
  requestAnimationFrame(frame);
  if (!running || !game) {
    lastFrame = now;
    return;
  }
  const realDt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  try {
    const t0 = performance.now();
    if (!paused) {
      const dt = realDt * speed;
      const steps = Math.max(1, Math.ceil(dt / 0.034));
      for (let i = 0; i < steps; i++) game.update(dt / steps);
    }
    const t1 = performance.now();
    input.update(realDt);
    view.render(paused ? 0 : realDt * speed);
    spatial?.update(view.cam);
    const t2 = performance.now();
    overlay.draw();
    hud.update(realDt);
    hud.renderPortrait(now / 1000);
    if (perf.on) perfTick(now, t1 - t0, t2 - t1, performance.now() - t2);
  } catch (e) {
    console.error(e);
  }
}

function perfTick(now, simMs, renderMs, uiMs) {
  perf.frames++;
  perf.sim += simMs;
  perf.render += renderMs;
  perf.ui += uiMs;
  if (!perf.t0) perf.t0 = now;
  if (now - perf.t0 < 500) return;
  const n = perf.frames;
  const stats = typeof view.perfStats === 'function' ? view.perfStats() : {};
  const units = game.units.filter((u) => !u.isBuilding && !u.dead).length;
  window.__perf = { ...stats, fps: (n * 1000) / (now - perf.t0), simMs: perf.sim / n, viewMs: perf.render / n, uiMs: perf.ui / n, units };
  perf.frames = 0;
  perf.sim = perf.render = perf.ui = 0;
  perf.t0 = now;
  if (!perf.el) {
    perf.el = document.createElement('div');
    perf.el.id = 'perf-readout';
    perf.el.style.cssText = 'position:fixed;top:44px;left:50%;transform:translateX(-50%);z-index:50;font:12px/1.3 monospace;color:#e8ffd0;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:4px;pointer-events:none;white-space:pre';
    document.body.appendChild(perf.el);
  }
  const p = window.__perf;
  perf.el.textContent = `${p.fps.toFixed(0)} fps · sim ${p.simMs.toFixed(1)} ms · view ${p.viewMs.toFixed(1)} ms · ui ${p.uiMs.toFixed(1)} ms · ${units} units` + (p.drawCalls !== undefined ? ` · ${p.drawCalls} draws · ${p.activeMeshes} active` : '');
}

/** ?bench=N: two armies of mixed units (ancient to galactic) meet between your base and the citadel. */
function benchmark(n) {
  const g = game;
  const foe = g.generals.find((p) => p !== g.human && g.isEnemy(g.human, p));
  if (!foe) return;
  const home = g.homeOf(g.human);
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
    const u = g.spawnUnit(types[k % types.length], side ? foe : g.human, x, z);
    g.issueOrder(u, { type: 'attackMove', point: { x: cx, z: cz + (side ? 6 : -6) } });
  }
  input.centerOn(cx, cz);
  view.cam.distance = view.cam.zoomTarget = 46;
}

function boot(data) {
  if (data?.settings) Object.assign(settings, data.settings);
  if (!Array.isArray(settings.rivals) || !settings.rivals.length) settings.rivals = [{ mode: 'random', hero: 'random', team: 'rival' }];
  buildTitle();
  bindModals();
  requestAnimationFrame(frame);
}
// When hosted in the Artifact viewer, keep the chosen settings across page updates.
const hot = window.claude?.hot;
hot?.snapshot?.(() => ({ settings: { ...settings, rivals: settings.rivals.map((r) => ({ ...r })) } }));

// Test/debug helpers: ?autostart=hero:paladin or ?autostart=empire
function autostart() {
  const auto = params.get('autostart');
  if (!auto) return;
  const [mode, heroId] = auto.split(':');
  settings.mode = mode === 'empire' ? 'empire' : 'hero';
  if (heroId && HEROES[heroId]) settings.heroId = heroId;
  // ?rivals=hero-ranger-ally,empire,random  (mode[-hero][-team] per computer general)
  if (params.get('rivals')) {
    settings.rivals = params
      .get('rivals')
      .split(',')
      .slice(0, 3)
      .map((tok) => {
        const [mode = 'random', hero = 'random', team = 'rival'] = tok.split('-');
        return { mode, hero: HEROES[hero] ? hero : 'random', team: team === 'ally' ? 'ally' : 'rival' };
      });
  } else if (params.get('opponents') || params.get('diplomacy')) {
    const n = Math.max(1, Math.min(3, Number(params.get('opponents') || 3)));
    const team = params.get('diplomacy') === 'allied' ? 'ally' : 'rival';
    settings.rivals = Array.from({ length: n }, () => ({ mode: 'random', hero: 'random', team }));
  }
  if (params.get('difficulty')) settings.difficulty = params.get('difficulty');
  startGame();
}

function launch() {
  // The Babylon view loads its models first (view.ready); the three.js view has nothing to wait for.
  ensureView();
  Promise.resolve(view.ready).then(() => {
    spatial?.prerender();
    if (hot?.ready) hot.ready(boot);
    else boot(hot?.data ?? {});
    autostart();
  });
}

if (params.get('renderer') === 'babylon') {
  Promise.all([import('./babylon/BabylonView.ts'), import('./babylon/SpatialAudio.ts')])
    .then(([m, a]) => {
      ViewClass = m.BabylonView;
      spatial = new a.SpatialAudio();
      launch();
    })
    .catch((e) => {
      console.error('Babylon.js renderer failed to load; using three.js', e);
      launch();
    });
} else launch();
window.__setSpeed = (s) => (speed = s);
window.__initSound = initSound;
window.__audio = () => spatial;
