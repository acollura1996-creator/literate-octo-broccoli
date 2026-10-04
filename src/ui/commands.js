// Builds the 4x3 command card for the current selection.
import { UNITS, UPGRADES } from '../data/units.js';
import { ITEMS, SHOP_STOCK } from '../data/items.js';
import { ABILITIES, requiredHeroLevel } from '../game/abilities.js';

const GRID_KEYS = [['Q', 'W', 'E', 'R'], ['A', 'S', 'D', 'F'], ['Z', 'X', 'C', 'V']];

function costLine(cost, food) {
  const parts = [];
  if (cost?.gold) parts.push(`<span class="c-gold">◉ ${cost.gold}</span>`);
  if (cost?.lumber) parts.push(`<span class="c-lumber">♣ ${cost.lumber}</span>`);
  if (food) parts.push(`<span class="c-food">🍖 ${food}</span>`);
  return parts.join(' ');
}

export function getCommands(game, input) {
  const sel = input.selection.filter((u) => !u.dead);
  const p = game.human;
  if (!sel.length) return [];
  const u = input.activeUnit();
  if (!u) return [];
  const own = u.owner === p;
  const B = [];

  // Neutral shops & mercenaries can be "used" by selecting them.
  if (u.def.shop) {
    const stock = SHOP_STOCK[u.def.shop];
    const customer = game.shopCustomer(p, u);
    stock.forEach((id, i) => {
      const it = ITEMS[id];
      const x = i % 4;
      const y = Math.floor(i / 4);
      B.push({
        id: `buy:${id}`,
        x,
        y,
        hotkey: GRID_KEYS[y][x],
        icon: it.icon,
        iconBg: it.color,
        name: `Purchase ${it.name}`,
        tooltip: `${it.description}`,
        cost: costLine({ gold: it.cost }),
        disabled: !customer || p.gold < it.cost,
        onClick: () => game.buyItem(p, u, id),
      });
    });
    return B;
  }
  if (u.def.mercenaries) {
    u.def.mercenaries.forEach((type, i) => {
      const d = UNITS[type];
      B.push({
        id: `hire:${type}`,
        x: i,
        y: 0,
        hotkey: GRID_KEYS[0][i],
        model: d.model,
        name: `Hire ${d.name}`,
        tooltip: `${d.description ?? ''}<br><span class="dim">HP ${d.hp} · Damage ${d.damage[0]}-${d.damage[1]} · Level ${d.level}</span><br><span class="dim">Available: ${u.stock[type]}</span>`,
        cost: costLine(d.cost, d.food),
        count: u.stock[type],
        disabled: u.stock[type] < 1 || p.gold < d.cost.gold,
        onClick: () => game.hireMerc(p, u, type),
      });
    });
    return B;
  }
  if (!own) return [];

  // ---------------------------------------------------------------- menus
  if (input.cardMenu === 'build' && u.def.worker) {
    const order = ['townhall', 'farm', 'barracks', 'blacksmith', 'scouttower', 'sanctum', 'workshop'];
    const keys = { townhall: 'H', farm: 'F', barracks: 'B', blacksmith: 'S', scouttower: 'T', sanctum: 'A', workshop: 'W' };
    order.forEach((type, i) => {
      const d = UNITS[type];
      const missing = game.missingRequirements(p, d);
      B.push({
        id: `build:${type}`,
        x: i % 4,
        y: Math.floor(i / 4),
        hotkey: keys[type],
        model: d.model,
        building: true,
        name: `Build ${d.name}`,
        tooltip: `${d.description}${missing.length ? `<br><span class="req">Requires: ${missing.map((m) => UNITS[m].name).join(', ')}</span>` : ''}`,
        cost: costLine(d.cost),
        disabled: missing.length > 0 || !game.canAfford(p, d.cost),
        onClick: () => input.beginPlacement(type),
      });
    });
    B.push({ id: 'cancel', x: 3, y: 2, hotkey: 'Escape', keyLabel: 'Esc', icon: '✖', name: 'Cancel', onClick: () => (input.cardMenu = null) });
    return B;
  }
  if (input.cardMenu === 'learn' && u.isHero) {
    u.heroDef.abilities.forEach((id, i) => {
      const ab = ABILITIES[id];
      const cur = u.abilityLevels[id];
      const req = cur < ab.levels ? requiredHeroLevel(ab, cur + 1) : 99;
      B.push({
        id: `learn:${id}`,
        x: i,
        y: 0,
        hotkey: ab.hotkey,
        icon: ab.icon,
        iconBg: ab.color,
        name: `Learn ${ab.name} - [Level ${cur + 1}]`,
        tooltip: `${ab.tooltip(cur + 1)}${cur >= ab.levels ? '<br><span class="dim">Fully learned.</span>' : u.level < req ? `<br><span class="req">Requires Hero level ${req}.</span>` : ''}`,
        level: cur,
        disabled: cur >= ab.levels || u.level < req || u.skillPoints <= 0,
        onClick: () => {
          if (game.learnAbility(u, id)) {
            game.sound('click');
            if (u.skillPoints <= 0) input.cardMenu = null;
          }
        },
      });
    });
    B.push({ id: 'cancel', x: 3, y: 2, hotkey: 'Escape', keyLabel: 'Esc', icon: '✖', name: 'Cancel', onClick: () => (input.cardMenu = null) });
    return B;
  }

  // ----------------------------------------------------------- buildings
  if (u.isBuilding) {
    if (u.underConstruction) {
      B.push({
        id: 'cancelbuild', x: 3, y: 2, hotkey: 'Escape', keyLabel: 'Esc', icon: '✖', name: 'Cancel construction',
        tooltip: 'Cancels construction and refunds 75% of the cost.',
        onClick: () => input.cancelConstruction(u),
      });
      return B;
    }
    if (u.upgrading || u.researching) {
      B.push({
        id: 'cancelup', x: 3, y: 2, hotkey: 'Escape', keyLabel: 'Esc', icon: '✖', name: 'Cancel',
        onClick: () => (u.upgrading ? game.cancelUpgrade(u) : game.cancelResearch(u)),
      });
    }
    (u.def.trains ?? []).forEach((type, i) => {
      const d = UNITS[type];
      const missing = game.missingRequirements(p, d);
      B.push({
        id: `train:${type}`,
        x: i,
        y: 0,
        hotkey: d.hotkey,
        model: d.model,
        name: `Train ${d.name}`,
        tooltip: `${d.description ?? ''}<br><span class="dim">HP ${d.hp} · Damage ${d.damage[0]}-${d.damage[1]} · Armor ${d.armor}</span>${missing.length ? `<br><span class="req">Requires: ${missing.map((m) => UNITS[m].name).join(', ')}</span>` : ''}`,
        cost: costLine(d.cost, d.food),
        disabled: missing.length > 0 || !!u.upgrading,
        onClick: () => game.trainUnit(u, type),
      });
    });
    (u.def.researches ?? []).forEach((upg, i) => {
      const U = UPGRADES[upg];
      const lvl = p.upgrades[upg];
      if (lvl >= 3) return;
      const busy = p.researchingUpg?.[upg];
      B.push({
        id: `research:${upg}`,
        x: i,
        y: 0,
        hotkey: U.hotkey,
        icon: U.icon,
        iconBg: '#555',
        name: `Research ${U.name[lvl]}`,
        tooltip: `${U.description}${p.tier < U.tier[lvl] ? `<br><span class="req">Requires ${['', 'Town Hall', 'Keep', 'Castle'][U.tier[lvl]]}.</span>` : ''}`,
        cost: costLine(U.cost[lvl]),
        level: lvl,
        disabled: !!u.researching || busy || p.tier < U.tier[lvl],
        onClick: () => game.startResearch(u, upg),
      });
    });
    if (u.def.upgradesTo && !u.upgrading) {
      const d = UNITS[u.def.upgradesTo];
      const missing = game.missingRequirements(p, d);
      B.push({
        id: 'upgrade',
        x: 0,
        y: 2,
        hotkey: 'U',
        model: d.model,
        building: true,
        name: `Upgrade to ${d.name}`,
        tooltip: `${d.description}${missing.length ? `<br><span class="req">Requires: ${missing.map((m) => UNITS[m].name).join(', ')}</span>` : ''}`,
        cost: costLine(d.cost),
        disabled: missing.length > 0 || u.trainQueue.length > 0,
        onClick: () => game.startUpgrade(u),
      });
    }
    if (u.def.trains) {
      B.push({
        id: 'rally', x: 3, y: 1, hotkey: 'Y', icon: '🚩', iconBg: '#7a5a2a', name: 'Set Rally Point',
        tooltip: 'Trained units will move to the rally point. Rally on a gold mine or tree to send Peasants to work.',
        onClick: () => input.beginTarget({ kind: 'rally' }),
      });
    }
    if (u.def.revivesHeroes) {
      const h = p.hero;
      if (h && h.dead && h.reviveAt) {
        const left = Math.max(0, Math.ceil(h.reviveAt - game.time));
        B.push({
          id: 'revive', x: 0, y: 0, hotkey: '', model: h.def.model, name: `Reviving ${h.def.name}`,
          tooltip: `Your Hero returns in ${left} seconds.`, disabled: true,
          progress: 1 - left / (12 + 4 * h.level),
        });
      }
    }
    return B;
  }

  // ------------------------------------------------------------- units
  const movable = sel.some((s) => s.canMove && s.owner === p);
  if (movable) {
    B.push({ id: 'move', x: 0, y: 0, hotkey: 'M', icon: '➤', iconBg: '#2a5a2a', name: 'Move', tooltip: 'Orders the selected units to move, ignoring enemies.', onClick: () => input.beginTarget({ kind: 'move' }) });
    B.push({ id: 'stop', x: 1, y: 0, hotkey: 'S', icon: '✋', iconBg: '#5a2a2a', name: 'Stop', tooltip: 'Orders the selected units to stop.', onClick: () => input.orderAll({ type: 'idle' }) });
    B.push({ id: 'hold', x: 2, y: 0, hotkey: 'H', icon: '🛡', iconBg: '#4a4a2a', name: 'Hold Position', tooltip: 'Units hold their ground and only attack enemies in range.', onClick: () => input.orderAll({ type: 'hold' }) });
    if (sel.some((s) => s.canAttack)) {
      B.push({ id: 'attack', x: 3, y: 0, hotkey: 'A', icon: '⚔', iconBg: '#6a2a2a', name: 'Attack', tooltip: 'Attack a target, or attack-move to a location, engaging enemies on the way.', onClick: () => input.beginTarget({ kind: 'attack' }) });
      B.push({ id: 'patrol', x: 0, y: 1, hotkey: 'P', icon: '↻', iconBg: '#2a3a5a', name: 'Patrol', tooltip: 'Patrol between the current position and a target point.', onClick: () => input.beginTarget({ kind: 'patrol' }) });
    }
  }
  if (u.def.worker) {
    B.push({ id: 'gather', x: 1, y: 1, hotkey: 'G', icon: '⛏', iconBg: '#6a5a2a', name: 'Gather', tooltip: 'Harvest gold from a Gold Mine or lumber from trees.', onClick: () => input.beginTarget({ kind: 'gather' }) });
    if (sel.some((s) => s.carry)) {
      B.push({ id: 'return', x: 2, y: 1, hotkey: 'R', icon: '⤺', iconBg: '#5a4a2a', name: 'Return Resources', tooltip: 'Return carried resources to the nearest Town Hall.', onClick: () => input.orderWorkersReturn() });
    }
    B.push({ id: 'buildmenu', x: 0, y: 2, hotkey: 'B', icon: '🔨', iconBg: '#5a4a3a', name: 'Build Structure', tooltip: 'Opens the list of structures this Peasant can build.', onClick: () => (input.cardMenu = 'build') });
  }
  if (u.isHero && !u.isIllusion) {
    if (u.skillPoints > 0) {
      B.push({ id: 'learnmenu', x: 3, y: 1, hotkey: 'O', icon: '✚', iconBg: '#7a6a1a', name: `Hero Abilities (${u.skillPoints} point${u.skillPoints > 1 ? 's' : ''})`, tooltip: 'Learn a new ability or improve an existing one.', glow: true, onClick: () => (input.cardMenu = 'learn') });
    }
    u.heroDef.abilities.forEach((id, i) => {
      const ab = ABILITIES[id];
      const lvl = u.abilityLevels[id];
      const passive = ab.target === 'passive' || ab.target === 'aura';
      const cd = u.cooldowns[id] || 0;
      const total = ab.cooldown?.[Math.max(0, lvl - 1)] ?? 1;
      const mana = ab.mana?.[Math.max(0, lvl - 1)] ?? 0;
      B.push({
        id: `cast:${id}`,
        x: i,
        y: 2,
        hotkey: passive ? '' : ab.hotkey,
        icon: ab.icon,
        iconBg: ab.color,
        name: `${ab.name}${lvl ? ` - [Level ${lvl}]` : ''}`,
        tooltip: `${ab.tooltip(Math.max(1, lvl))}${passive ? '<br><span class="dim">Passive.</span>' : ''}`,
        cost: !passive && mana ? `<span class="c-mana">✦ ${mana} mana</span>${ab.cooldown ? ` <span class="dim">· ${total}s cooldown</span>` : ''}` : '',
        level: lvl,
        disabled: lvl === 0 || passive,
        passive,
        unlearned: lvl === 0,
        cooldown: cd > 0 ? cd / total : 0,
        noMana: !passive && lvl > 0 && u.mana < mana,
        onClick: () => input.useAbility(u, id),
      });
    });
  } else if (u.def.abilities.length) {
    u.def.abilities.forEach((id) => {
      const ab = ABILITIES[id];
      if (!ab.autocast) return;
      B.push({
        id: `cast:${id}`,
        x: id === 'heal' ? 2 : 1,
        y: 2,
        hotkey: ab.hotkey,
        icon: ab.icon,
        iconBg: ab.color,
        name: ab.name,
        tooltip: `${ab.tooltip(1)}<br><span class="dim">Right-click to toggle autocast.</span>`,
        cost: `<span class="c-mana">✦ ${ab.mana[0]} mana</span>`,
        autocast: u.autocast[id],
        onClick: () => input.useAbility(u, id),
        onRightClick: () => {
          const v = !u.autocast[id];
          for (const s of sel) if (s.type === u.type) s.autocast[id] = v;
        },
      });
    });
  }
  return B;
}
