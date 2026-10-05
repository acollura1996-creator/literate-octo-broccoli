// Entry point: title/setup screen, game construction and the main loop.
import { View } from './render/view.js';
import { Overlay } from './render/overlay.js';
import { Game } from './game/game.js';
import { Input } from './input.js';
import { Hud } from './ui/hud.js';
import { modelIcon } from './ui/icons.js';
import { HEROES, HERO_IDS } from './data/heroes.js';
import { UNITS } from './data/units.js';
import { ABILITIES } from './game/abilities.js';
import { TEAM_COLORS } from './render/assets.js';
import { initAudio, playSfx, startMusic, stopMusic, setMuted, isMuted } from './audio.js';
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
      img = modelIcon(view.renderer, d.model, TEAM_COLORS.red, false);
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
      initAudio();
      playSfx('click', 0.6);
    });
    list.appendChild(btn);
  }
  document.querySelectorAll('.path').forEach((b) => {
    b.addEventListener('click', () => {
      settings.mode = b.dataset.mode;
      document.querySelectorAll('.path').forEach((x) => x.classList.toggle('selected', x === b));
      $('hero-pick').classList.toggle('hidden', settings.mode !== 'hero');
      initAudio();
      playSfx('click', 0.6);
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
    initAudio();
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
    playSfx('click', 0.6);
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
  $('btn-fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => game?.message('Fullscreen is not available here.', '#ccc'));
  });
  $('btn-sound').addEventListener('click', () => {
    setMuted(!isMuted());
    $('btn-sound').textContent = isMuted() ? '🔇' : '🔊';
  });
  window.addEventListener('keydown', (e) => {
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
  setTimeout(() => {
    try {
      createGame();
    } catch (e) {
      console.error(e);
      $('screen-loading').querySelector('.loading-text').textContent = `Failed to start: ${e.message}`;
    }
  }, 30);
}

function soundHook(name, vol = 1, x, z) {
  if (x !== undefined && view) {
    const t = view.cam.target;
    const d = Math.hypot(t.x - x, t.z - z);
    vol *= Math.max(0, Math.min(1, 1 - (d - 14) / 36));
    if (vol < 0.03) return;
  }
  playSfx(name, vol);
}

function createGame() {
  const hooks = {
    scene: view.scene,
    onUnitAdded: (u) => view.addUnit(u),
    onUnitRemoved: (u) => view.removeUnit(u),
    onUnitChanged: (u, modelChanged) => view.changeUnit(u, modelChanged),
    onItemDropped: (it) => view.addItem(it),
    onItemTaken: (it) => view.removeItem(it),
    isOnScreen: (x, z) => view.isOnScreen(x, z),
    centerOn: (x, z) => input?.centerOn(x, z),
    sound: soundHook,
    onGameOver: (over) => {
      setTimeout(() => showEnd(over), 2500);
    },
  };
  game = new Game({ ...settings }, hooks);
  view.attachGame(game);
  hooks.fx = view.fx;
  hooks.projectiles = view.projectiles;
  game.fx = view.fx;
  game.projectiles = view.projectiles;
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
  startMusic();
  running = true;
  lastFrame = performance.now();
}

function quitToTitle() {
  closeModal('modal-menu');
  closeModal('modal-end');
  teardown();
  stopMusic();
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
function frame(now) {
  requestAnimationFrame(frame);
  if (!running || !game) {
    lastFrame = now;
    return;
  }
  const realDt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  try {
    if (!paused) {
      const dt = realDt * speed;
      const steps = Math.max(1, Math.ceil(dt / 0.034));
      for (let i = 0; i < steps; i++) game.update(dt / steps);
    }
    input.update(realDt);
    view.render(paused ? 0 : realDt * speed);
    overlay.draw();
    hud.update(realDt);
    hud.renderPortrait(now / 1000);
  } catch (e) {
    console.error(e);
  }
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
  if (hot?.ready) hot.ready(boot);
  else boot(hot?.data ?? {});
  autostart();
}

if (params.get('renderer') === 'babylon') {
  import('./babylon/BabylonView.ts')
    .then((m) => {
      ViewClass = m.BabylonView;
      launch();
    })
    .catch((e) => {
      console.error('Babylon.js renderer failed to load; using three.js', e);
      launch();
    });
} else launch();
window.__setSpeed = (s) => (speed = s);
