// Builds the 4x3 command card for the current selection.
import { UNITS, UPGRADES, BUILD_MENUS, ROAD, AGE_NAMES, AGES, ECONOMY, researchCost, researchTime, researchCap } from '../data/units.ts';
import { moodOf } from '../game/empire.js';
import { ITEMS, SHOP_STOCK } from '../data/items.ts';
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
  if ((input.cardMenu === 'build' || input.cardMenu === 'build2') && u.def.worker) {
    const order = input.cardMenu === 'build' ? BUILD_MENUS.basic : BUILD_MENUS.advanced;
    const keys = {
      house: 'H', road: 'R', farm: 'F', wall: 'W', gate: 'G', lumberyard: 'L', barracks: 'B', scouttower: 'T', townhall: 'N',
      research_center: 'C', stable: 'E', sanctum: 'A', workshop: 'K', factory: 'Y', missile_silo: 'M',
    };
    order.forEach((type, i) => {
      const pos = { x: i % 4, y: Math.floor(i / 4) };
      if (type === 'road') {
        B.push({
          id: 'build:road', ...pos, hotkey: keys.road, icon: '🛤️', iconBg: '#8a6a3a', name: 'Lay Road',
          tooltip: `${ROAD.description}<br><span class="dim">Click and drag to lay a line of road.</span>`,
          cost: `${costLine(ROAD.cost)} <span class="dim">per tile</span>`,
          disabled: p.gold < ROAD.cost.gold,
          onClick: () => input.beginLine('road'),
        });
        return;
      }
      const d = UNITS[type];
      const missing = game.missingRequirements(p, d);
      const line = !!d.wall;
      B.push({
        id: `build:${type}`,
        ...pos,
        hotkey: keys[type],
        model: d.ageModels?.[Math.max(1, p.tier) - 1] ?? d.model,
        building: true,
        name: `Build ${d.ageNames?.[Math.max(1, p.tier) - 1] ?? d.name}`,
        tooltip: `${d.description}${line ? '<br><span class="dim">Click and drag to build a line of wall.</span>' : ''}${d.housingByAge ? `<br><span class="dim">Shelters ${d.housingByAge[Math.max(1, p.tier) - 1]} citizens in the ${AGE_NAMES[Math.max(1, p.tier)]} (more in later ages).</span>` : ''}${d.foodRateByAge ? `<br><span class="dim">Grows ${Math.round(d.foodRateByAge[Math.max(1, p.tier) - 1] * 60)} food per minute in the ${AGE_NAMES[Math.max(1, p.tier)]}.</span>` : ''}${missing.length ? `<br><span class="req">Requires: ${missing.map((m) => game.requirementName(m)).join(', ')}</span>` : ''}`,
        cost: `${costLine(d.cost)}${line ? ' <span class="dim">per piece</span>' : ''}`,
        disabled: missing.length > 0 || !game.canAfford(p, d.cost),
        onClick: () => (line ? input.beginLine('wall') : input.beginPlacement(type)),
      });
    });
    B.push({ id: 'cancel', x: 3, y: 2, hotkey: 'Escape', keyLabel: 'Esc', icon: '✖', name: 'Cancel', onClick: () => (input.cardMenu = null) });
    return B;
  }
  if (input.cardMenu === 'hire' && u.def.tier && u.owner === p) {
    const list = game.empires.heroesForHire(p);
    list.slice(0, 8).forEach((hg, i) => {
      const h = hg.hero;
      const fee = game.empires.hireFee(hg);
      B.push({
        id: `hirehero:${hg.index}`, x: i % 4, y: Math.floor(i / 4), hotkey: GRID_KEYS[Math.floor(i / 4)][i % 4],
        model: h.def.model, name: `Hire ${hg.name}'s ${h.def.name} (level ${h.level})`,
        tooltip: `The Hero fights on your side for ${ECONOMY.hireTime / 60} minutes: your enemies become theirs.${hg.isHuman ? '' : ''}${hg.team === p.team ? '' : '<br><span class="dim">Currently not your ally.</span>'}`,
        cost: costLine({ gold: fee }),
        disabled: p.gold < fee,
        onClick: () => {
          if (game.empires.hire(p, hg)) input.cardMenu = null;
        },
      });
    });
    if (!list.length) {
      B.push({ id: 'nohire', x: 0, y: 0, icon: '🛡️', iconBg: '#444', name: 'No Heroes available', tooltip: 'Every Hero is already your ally, hired by someone else, fallen, or there are no Hero generals in this game.', disabled: true });
    }
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
    if (u.upgrading || (u.researching && !u.def.researches?.includes(u.researching.upg))) {
      B.push({
        id: 'cancelup', x: 3, y: 2, hotkey: 'Escape', keyLabel: 'Esc', icon: '✖', name: 'Cancel',
        onClick: () => (u.upgrading ? game.cancelUpgrade(u) : game.cancelResearch(u)),
      });
    }
    const trains = (u.def.trains ?? []).filter((type) => {
      const a = UNITS[type].age ?? 1;
      return type === 'peasant' || (a <= Math.max(1, p.tier) && a >= p.tier - 1);
    });
    trains.forEach((type, i) => {
      const d = UNITS[type];
      const missing = game.missingRequirements(p, d);
      B.push({
        id: `train:${type}`,
        x: i % 4,
        y: Math.floor(i / 4),
        hotkey: d.hotkey,
        model: d.model,
        name: `Train ${d.name}`,
        tooltip: `${d.description ?? ''}<br><span class="dim">HP ${d.hp} · Damage ${d.damage[0]}-${d.damage[1]} · Armor ${d.armor}</span>${missing.length ? `<br><span class="req">Requires: ${missing.map((m) => game.requirementName(m)).join(', ')}</span>` : ''}`,
        cost: costLine(d.cost, d.food),
        disabled: missing.length > 0 || !!u.upgrading,
        onClick: () => game.trainUnit(u, type),
      });
    });
    (u.def.researches ?? []).forEach((upg, i) => {
      const U = UPGRADES[upg];
      const lvl = p.upgrades[upg] ?? 0;
      const cap = researchCap(p);
      const x = i % 4;
      const y = Math.floor(i / 4);
      // The research in progress becomes its own Cancel button.
      if (u.researching?.upg === upg) {
        B.push({
          id: `cancelresearch:${upg}`, x, y, hotkey: 'Escape', keyLabel: 'Esc', icon: U.icon, iconBg: '#7a2a2a', label: '✖',
          name: `Cancel ${U.name} level ${lvl + 1}`, tooltip: 'Cancels the research and refunds its cost.',
          progress: u.researching.time / u.researching.total,
          onClick: () => game.cancelResearch(u),
        });
        return;
      }
      const busy = p.researchingUpg?.[upg];
      const maxed = lvl >= cap;
      B.push({
        id: `research:${upg}`,
        x,
        y,
        hotkey: GRID_KEYS[y][x],
        icon: U.icon,
        iconBg: '#3a4a5a',
        name: `Research ${U.name} - [Level ${lvl + 1}]`,
        tooltip: `${U.effect} per level.<br><span class="dim">Level ${lvl} of ${cap} available in the ${AGE_NAMES[Math.max(1, p.tier)]} · ${researchTime(upg, lvl)}s</span>${maxed ? '<br><span class="req">Advance to the next age to research further.</span>' : ''}${busy ? '<br><span class="dim">Being researched at another Research Center.</span>' : ''}`,
        cost: maxed ? '' : costLine(researchCost(upg, lvl)),
        level: lvl,
        disabled: !!u.researching || busy || maxed || !game.canAfford(p, researchCost(upg, lvl)),
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
        name: d.tier ? `Advance to the ${AGE_NAMES[d.tier]} (${d.name})` : `Upgrade to ${d.name}`,
        tooltip: `${d.description}${missing.length ? `<br><span class="req">Requires: ${missing.map((m) => game.requirementName(m)).join(', ')}</span>` : ''}`,
        cost: costLine(d.cost),
        disabled: missing.length > 0 || u.trainQueue.length > 0,
        onClick: () => game.startUpgrade(u),
      });
    }
    if (u.def.tier && u.owner.mode === 'empire') {
      const next = game.empires.nextAge(p);
      if (next && !u.upgrading) {
        const missing = game.empires.ageMissing(p);
        const advancing = p.buildings.some((o) => !o.dead && o.upgrading?.age);
        B.push({
          id: 'advance', x: 0, y: 2, hotkey: 'U', icon: next.icon, iconBg: '#6a5a2a',
          name: `Advance to the ${next.name}`,
          tooltip: `Unlocks the units and structures of the ${next.name}. Your town center, houses, farms, walls, gates and towers are rebuilt in the new style.${missing.length ? `<br><span class="req">Requires: ${missing.map((m) => game.requirementName(m)).join(', ')}</span>` : ''}`,
          cost: `${costLine(next.cost)} <span class="dim">· ${next.time}s</span>`,
          disabled: missing.length > 0 || u.trainQueue.length > 0 || advancing,
          onClick: () => game.empires.startAgeUp(u),
        });
      }
      const mood = moodOf(p.happiness);
      const econ = `<br><span class="dim">Citizens ${Math.floor(p.citizens)}/${p.housing} · Mood ${mood.icon} ${mood.name} · Tax ${p.tax} · Rations ${p.rations}</span><br><span class="dim">There is no limit. Hold Shift to change by 5.</span>`;
      const step = (e) => (e?.shiftKey ? 5 : 1);
      B.push({
        id: 'tax-', x: 0, y: 1, hotkey: 'Z', icon: '💰', iconBg: '#3a5a3a', label: '−', name: `Lower Taxes (now ${p.tax})`,
        tooltip: `Lower taxes make your people happier but bring in less gold.${econ}`,
        disabled: p.tax <= 0, onClick: (e) => game.empires.setTax(p, p.tax - step(e)),
      });
      B.push({
        id: 'tax+', x: 1, y: 1, hotkey: 'X', icon: '💰', iconBg: '#6a4a2a', label: '+', name: `Raise Taxes (now ${p.tax})`,
        tooltip: `Each citizen pays more gold, but heavy taxes anger your people. No taxes are paid while they starve or hate you.${econ}`,
        onClick: (e) => game.empires.setTax(p, p.tax + step(e)),
      });
      B.push({
        id: 'rations-', x: 2, y: 1, hotkey: 'C', icon: '🍞', iconBg: '#5a4a2a', label: '−', name: `Smaller Rations (now ${p.rations})`,
        tooltip: `Citizens eat less food, but meager rations make them unhappy.${econ}`,
        disabled: p.rations <= 0, onClick: (e) => game.empires.setRations(p, p.rations - step(e)),
      });
      B.push({
        id: 'rations+', x: 3, y: 1, hotkey: 'V', icon: '🍞', iconBg: '#3a5a3a', label: '+', name: `Bigger Rations (now ${p.rations})`,
        tooltip: `Well-fed citizens are happier and resist plague, but eat more of your food.${econ}`,
        onClick: (e) => game.empires.setRations(p, p.rations + step(e)),
      });
      B.push({
        id: 'hiremenu', x: 1, y: 0, hotkey: 'H', icon: '🤝', iconBg: '#4a3a6a', name: 'Hire a Hero',
        tooltip: `Pay a Hero to fight for you for ${ECONOMY.hireTime / 60} minutes. Their fee grows with their level.`,
        onClick: () => (input.cardMenu = 'hire'),
      });
    }
    if (u.def.nukes) {
      if (u.nukeBuild) {
        B.push({
          id: 'nukebuild', x: 0, y: 0, hotkey: '', icon: '☢️', iconBg: '#5a5a1a', name: 'Building nuclear missile…',
          tooltip: `Ready in ${Math.ceil(u.nukeBuild.total - u.nukeBuild.time)} seconds.`, disabled: true,
          progress: u.nukeBuild.time / u.nukeBuild.total,
        });
        B.push({ id: 'cancelnuke', x: 3, y: 2, hotkey: 'Escape', keyLabel: 'Esc', icon: '✖', name: 'Cancel', onClick: () => game.empires.cancelNuke(u) });
      } else if (!u.nukeReady) {
        B.push({
          id: 'nukebuild', x: 0, y: 0, hotkey: 'B', icon: '☢️', iconBg: '#5a5a1a', name: 'Build Nuclear Missile',
          tooltip: `Builds one nuclear missile (${ECONOMY.nuke.time}s). Its blast destroys almost anything within ${ECONOMY.nuke.radius} paces — friend or foe — and terrifies nearby citizens.`,
          cost: costLine(ECONOMY.nuke.cost), disabled: !game.canAfford(p, ECONOMY.nuke.cost),
          onClick: () => game.empires.startNuke(u),
        });
      }
      B.push({
        id: 'nukelaunch', x: 1, y: 0, hotkey: 'N', icon: '🚀', iconBg: '#7a2a2a', name: 'Launch Nuclear Missile',
        tooltip: 'Choose a target anywhere in explored land. Everyone will see the warning, and the missile lands 7 seconds later.',
        disabled: !u.nukeReady, glow: !!u.nukeReady,
        onClick: () => input.beginTarget({ kind: 'nuke', silo: u }),
      });
    }
    if (u.def.trains) {
      B.push({
        id: 'rally', x: 3, y: u.def.tier ? 0 : 1, hotkey: 'Y', icon: '🚩', iconBg: '#7a5a2a', name: 'Set Rally Point',
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
      B.push({ id: 'return', x: 2, y: 1, hotkey: 'R', icon: '⤺', iconBg: '#5a4a2a', name: 'Return Resources', tooltip: 'Return carried resources to the nearest town center.', onClick: () => input.orderWorkersReturn() });
    }
    B.push({ id: 'buildmenu', x: 0, y: 2, hotkey: 'B', icon: '🔨', iconBg: '#5a4a3a', name: 'Build Basic Structure', tooltip: 'Houses, roads, farms, walls, gates, the Lumber Yard, Barracks, towers and town centers.', onClick: () => (input.cardMenu = 'build') });
    B.push({ id: 'buildmenu2', x: 1, y: 2, hotkey: 'V', icon: '🏛️', iconBg: '#4a4a5a', name: 'Build Advanced Structure', tooltip: 'Research Center, Stable, Workshop, Arcane Sanctum, Factory and Missile Silo. Most unlock in later ages.', onClick: () => (input.cardMenu = 'build2') });
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
