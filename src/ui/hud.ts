// The Warcraft III-style console: resources, clock, hero buttons, minimap,
// 3D portrait, unit info, inventory and the command card.
import { moodOf } from '../game/empire.ts';
import { UNITS, UPGRADES, AGE_NAMES, ECONOMY } from '../data/units.ts';
import { ITEMS } from '../data/items.ts';
import { getCommands } from './commands.ts';
import { Minimap } from './minimap.ts';
import { isEmpire } from '../game/types.ts';
import type { Game } from '../game/game.ts';
import type { Unit } from '../game/unit.ts';
import type { InventoryItem } from '../game/types.ts';
import type { Input } from '../input.ts';
import type { BabylonView } from '../babylon/BabylonView.ts';
import type { Portrait } from '../babylon/UiRenderer.ts';
import type { ButtonEvent, CommandButton } from './commands.ts';

/** An element of index.html (always present). */
const $ = (id: string): HTMLElement => document.getElementById(id)!;

function fmtTime(s: number): string {
  s = Math.max(0, Math.floor(s)); // the game clock starts slightly below zero
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s: unknown): string {
  return String(s).replace(/[&<>"]/g, (c) => ESCAPES[c]!);
}

export class Hud {
  readonly view: BabylonView;
  readonly input: Input;
  readonly el: HTMLElement;
  readonly portrait: Portrait;
  readonly minimap: Minimap;
  game!: Game;
  // Signatures of what is on screen, to rebuild DOM only when something changed.
  private cardSig = '';
  private infoSig = '';
  private invSig = '';
  private heroSig = '';
  private msgHtml = '';
  private sbHtml = '';
  private offerSig = '';
  private sbTimer = 0;
  private timer = 0;
  private tooltipBtn: string | null = null;
  private invTip: string | null = null;
  private invHover: number | null = null;
  private idleIndex?: number;
  private lastHeroClick?: number;

  constructor(game: Game, view: BabylonView, input: Input) {
    this.view = view;
    this.input = input;
    this.el = $('hud');
    this.portrait = view.createPortrait($('portrait'));
    this.minimap = new Minimap($('minimap') as HTMLCanvasElement, game, view, input);
    this.input.onInventoryClick = (slot, e) => this.inventoryClick(slot, e);
    this.buildInventory();
    this.bindTopbar();
    $('sb-toggle').addEventListener('click', () => this.toggleScoreboard());
    this.attach(game);
  }

  toggleScoreboard(): void {
    $('scoreboard').classList.toggle('collapsed');
    this.sbHtml = '';
  }

  /** Point the HUD at a (new) game. */
  attach(game: Game): void {
    this.game = game;
    this.minimap.attach(game);
    this.portrait.show(null);
    this.cardSig = '';
    this.infoSig = '';
    this.invSig = '';
    this.heroSig = '';
    this.msgHtml = '';
    this.sbHtml = '';
    this.sbTimer = 0;
    this.timer = 0;
    this.tooltipBtn = null;
    this.el.classList.remove('hidden');
    $('r-mode').textContent = game.human.mode === 'hero' ? 'Hero Path' : 'Empire Path';
  }

  icon(modelId: string, color: number, isBuilding = false): string {
    return this.view.icon(modelId, color, isBuilding);
  }

  bindTopbar(): void {
    $('idleworkers').addEventListener('click', () => {
      const idle = this.game.human.units.filter((u) => !u.dead && u.def.worker && u.order.type === 'idle');
      if (!idle.length) return;
      this.idleIndex = ((this.idleIndex ?? -1) + 1) % idle.length;
      const u = idle[this.idleIndex]!;
      this.input.setSelection([u]);
      this.input.centerOn(u.x, u.z);
    });
  }

  // ---------------------------------------------------------------- frame
  update(dt: number): void {
    const g = this.game;
    const p = g.human;
    this.timer -= dt;
    const unit = this.input.activeUnit();
    this.portrait.show(unit);
    this.minimap.update(dt);
    if (this.timer > 0) return;
    this.timer = 0.1;

    $('r-gold').textContent = String(Math.floor(p.gold));
    $('r-lumber').textContent = String(Math.floor(p.lumber));
    $('r-food').textContent = `${p.foodUsed}/${p.foodCap}`;
    if (isEmpire(p)) {
      const age = AGE_NAMES[p.tier]! || 'No Town Center';
      if ($('r-mode').textContent !== age) $('r-mode').textContent = age;
      $('r-grain').textContent = String(Math.floor(p.food));
      const fr = Math.round(p.foodRate * 60);
      const rate = $('r-grain-rate');
      rate.textContent = `${fr >= 0 ? '+' : ''}${fr}/m`;
      rate.className = `rate ${fr < 0 ? 'neg' : 'pos'}`;
      $('res-grain').classList.toggle('warn', p.starving);
      $('r-citizens').textContent = `${Math.floor(p.citizens)}/${p.housing}`;
      const mood = moodOf(p.happiness);
      $('r-mood-ico').textContent = mood.icon;
      $('r-mood').textContent = mood.name;
      $('r-mood').style.color = mood.color;
      $('res-mood').title = `Mood ${Math.round(p.happiness)}/100 (heading to ${Math.round(p.happinessTarget)}). Tax ${p.tax}, rations ${p.rations}, roads ${p.roadBonus! >= 0 ? '+' : ''}${Math.round(p.roadBonus ?? 0)}${p.crowding! >= 1 ? `, crowding -${Math.round(p.crowding!)}` : ''}${p.starving ? ', STARVING' : ''}. Income ${Math.round(p.taxRate * 60)} gold/min from taxes.`;
    }
    document.body.classList.toggle('mode-empire', p.mode === 'empire');
    $('r-food').classList.toggle('warn', p.foodUsed >= p.foodCap && p.mode === 'empire');
    $('gametime').textContent = fmtTime(g.time);
    const hour = g.timeOfDay;
    $('clock-dial').style.transform = `rotate(${(hour / 24) * 360 + 180}deg)`;
    $('clock-label').textContent = g.isNight ? 'Night' : 'Day';

    const idle = p.units.filter((u) => !u.dead && u.def.worker && u.order.type === 'idle').length;
    const iw = $('idleworkers');
    iw.classList.toggle('hidden', idle === 0);
    if (idle) $('idle-count').textContent = String(idle);

    this.updateHeroBar();
    this.sbTimer = (this.sbTimer ?? 0) - 1;
    if (this.sbTimer <= 0) {
      this.sbTimer = 5;
      this.updateScoreboard();
    }
    this.updateCommandCard();
    this.updateInfo(unit);
    this.updateInventory(unit);
    this.updateMessages();
    this.updateTooltip();
    this.updateOffers();
  }

  /** Contract offers from empires that want to hire the player's Hero. */
  updateOffers(): void {
    const g = this.game;
    const offers = (g.empires?.offers ?? []).filter((o) => o.to === g.human);
    const box = $('offers');
    // Rebuild only when the offers change: rebuilding replaces the buttons, which would drop a
    // click in progress. The countdowns are updated in place.
    const sig = offers.map((o) => `${o.from.index}:${o.fee}:${o.expires}`).join('|');
    if (sig === this.offerSig) {
      box.querySelectorAll('.of-left').forEach((el, i) => {
        const o = offers[i];
        if (o) el.textContent = `(${Math.ceil(o.expires - g.time)}s)`;
      });
      return;
    }
    this.offerSig = sig;
    box.innerHTML = offers
      .map(
        (o, i) => `<div class="offer" data-i="${i}">
          <div class="of-title" style="color:${g.nameColor(o.from)}">${o.from.name} wants to hire you</div>
          <div class="of-body">${o.fee} gold to fight for them for ${ECONOMY.hireTime / 60} minutes. Their enemies become yours. <span class="dim of-left">(${Math.ceil(o.expires - g.time)}s)</span></div>
          <div class="of-btns"><button class="of-yes">Accept</button><button class="of-no">Decline</button></div>
        </div>`,
      )
      .join('');
    box.querySelectorAll<HTMLElement>('.offer').forEach((el) => {
      const o = offers[Number(el.dataset['i'])]!;
      el.querySelector('.of-yes')!.addEventListener('click', () => {
        g.empires.acceptOffer(o);
        this.offerSig = '';
      });
      el.querySelector('.of-no')!.addEventListener('click', () => {
        g.empires.declineOffer(o);
        this.offerSig = '';
      });
    });
  }

  renderPortrait(time: number): void {
    this.portrait.render(time);
  }

  // -------------------------------------------------------------- heroes
  updateHeroBar(): void {
    const g = this.game;
    const h = g.human.hero;
    const bar = $('herobar');
    if (!h) {
      bar.innerHTML = '';
      return;
    }
    const sig = `${h.id}|${h.dead}|${h.level}|${h.skillPoints}`;
    if (sig !== this.heroSig) {
      this.heroSig = sig;
      bar.innerHTML = `
        <div class="herobtn ${h.dead ? 'dead' : ''}" title="${esc(h.def.name)} (F1)">
          <img src="${this.icon(h.def.model, g.human.color)}" alt="">
          <div class="lvl">${h.level}</div>
          ${h.skillPoints! > 0 && !h.dead ? '<div class="plus">+</div>' : ''}
          <div class="bars"><div class="hp"><i></i></div><div class="mp"><i></i></div></div>
          <div class="revive"></div>
        </div>`;
      const btn = bar.querySelector('.herobtn')!;
      btn.addEventListener('click', () => {
        if (h.dead) return;
        const now = performance.now();
        if (this.input.selection[0] === h && now - (this.lastHeroClick || 0) < 400) this.input.centerOn(h.x, h.z);
        this.lastHeroClick = now;
        this.input.setSelection([h]);
      });
    }
    const btn = bar.querySelector('.herobtn');
    if (!btn) return;
    btn.querySelector<HTMLElement>('.hp i')!.style.width = `${h.dead ? 0 : (h.hp / h.maxHp) * 100}%`;
    btn.querySelector<HTMLElement>('.mp i')!.style.width = `${h.dead || !h.maxMana ? 0 : (h.mana / h.maxMana) * 100}%`;
    btn.querySelector('.revive')!.textContent = h.dead && h.reviveAt ? String(Math.max(0, Math.ceil(h.reviveAt - g.time))) : '';
  }

  // ---------------------------------------------------------- scoreboard
  updateScoreboard(): void {
    const g = this.game;
    if ($('scoreboard').classList.contains('collapsed')) return;
    const rows = g.generals
      .map((p) => {
        const side = p.isHuman ? 'You' : p.hiredBy ? (p.hiredBy === g.human ? 'Hired' : 'Mercenary') : g.isAlliedToHuman(p) ? 'Ally' : 'Rival';
        const alive = p.units.filter((u) => !u.dead && !u.isIllusion && !u.summoned);
        let line2: string;
        if (p.mode === 'hero') {
          const h = p.hero;
          const mercs = alive.filter((u) => !u.isHero).length;
          line2 = h
            ? `${h.def.name} · level ${h.level}${h.dead ? ` · reviving${h.reviveAt ? ` in ${Math.max(0, Math.ceil(h.reviveAt - g.time))}s` : ''}` : ''}${mercs ? ` · ${mercs} merc${mercs > 1 ? 's' : ''}` : ''}`
            : 'Hero';
        } else {
          const army = alive.filter((u) => !u.def.worker).length;
          const workers = alive.length - army;
          line2 = `${AGE_NAMES[Math.max(1, p.tier)]!} · ${army} soldiers · ${workers} peasants · ${Math.floor(p.citizens ?? 0)} citizens`;
        }
        let status = '';
        if (p.defeated) status = 'Defeated';
        else if (p.ai) status = p.ai.status ?? '';
        if (p.hiredBy && !p.defeated) status = `Hired by ${p.hiredBy.isHuman ? 'you' : p.hiredBy.name} (${Math.max(0, Math.ceil((p.contractEnds! - g.time) / 60))} min left)${status ? ` · ${status}` : ''}`;
        return `<div class="sb-row ${side.toLowerCase()}${p.defeated ? ' out' : ''}">
          <span class="swatch" style="background:#${p.color.toString(16).padStart(6, '0')}"></span>
          <div class="sb-main">
            <div class="sb-l1"><b style="color:${g.nameColor(p)}">${esc(p.name)}</b><span class="sb-tag">${side}</span><span class="sb-kills" title="Kills">⚔ ${p.stats.kills}</span></div>
            <div class="sb-l2">${p.mode === 'hero' ? '⚔' : '🏰'} ${esc(line2)}</div>
            ${status ? `<div class="sb-l3">${esc(status)}</div>` : ''}
          </div>
        </div>`;
      })
      .join('');
    const L = g.legionMgr;
    const k = L.kalenden;
    const kHtml = k.dead
      ? '<div class="sb-k-l1"><b>Kalenden</b> has been slain</div>'
      : `<div class="sb-k-l1"><b>Kalenden</b><span>${Math.ceil(k.hp)} / ${k.maxHp}</span></div>
         <div class="sb-kbar"><i style="width:${(k.hp / k.maxHp) * 100}%"></i></div>
         <div class="sb-l3">${L.keep.dead ? "Keep destroyed: the Legion no longer marches" : `Legion wave ${L.wave + 1} marches in ${fmtTime(Math.max(0, L.waveTimer))}`}</div>`;
    const html = rows + kHtml;
    if (html === this.sbHtml) return;
    this.sbHtml = html;
    $('sb-rows').innerHTML = rows;
    $('sb-kalenden').innerHTML = kHtml;
  }

  // -------------------------------------------------------- command card
  updateCommandCard(): void {
    const buttons = getCommands(this.game, this.input);
    this.input.buttons = buttons;
    const sig = buttons
      .map((b) => `${b.id}:${b.name}:${b.disabled ? 1 : 0}:${b.level ?? ''}:${b.autocast ?? ''}:${b.count ?? ''}:${Math.round((b.cooldown || 0) * 20)}:${b.noMana ? 1 : 0}:${Math.round((b.progress || 0) * 20)}:${b.unlearned ? 1 : 0}`)
      .join('|') + `|${this.input.targetMode?.kind ?? ''}`;
    if (sig === this.cardSig) return;
    this.cardSig = sig;
    const card = $('commandcard');
    card.innerHTML = '';
    const grid = Array.from({ length: 12 }, (): CommandButton | null => null);
    for (const b of buttons) grid[b.y * 4 + b.x] = b;
    grid.forEach((b) => {
      const cell = document.createElement('div');
      cell.className = 'cmd';
      if (!b) {
        cell.classList.add('empty');
        card.appendChild(cell);
        return;
      }
      if (b.disabled) cell.classList.add('disabled');
      if (b.passive) cell.classList.add('passive');
      if (b.unlearned) cell.classList.add('unlearned');
      if (b.glow) cell.classList.add('glow');
      if (b.noMana) cell.classList.add('nomana');
      let inner = '';
      if (b.model) inner += `<img src="${this.icon(b.model, this.game.human.color, b.building || UNITS[b.model]?.kind === 'building')}" alt="">`;
      else inner += `<div class="glyph" style="background:${b.iconBg ? `radial-gradient(circle at 35% 30%, ${b.iconBg}, #111 85%)` : 'radial-gradient(circle at 35% 30%, #555, #111 85%)'}">${b.icon ?? ''}</div>`;
      if (b.hotkey) inner += `<span class="hk">${b.keyLabel ?? b.hotkey}</span>`;
      if (b.level) inner += `<span class="lv">${b.level}</span>`;
      if (b.count !== undefined) inner += `<span class="cnt">${b.count}</span>`;
      if (b.label) inner += `<span class="lbl">${b.label}</span>`;
      if (b.autocast !== undefined) cell.classList.toggle('autocast', !!b.autocast);
      if (b.cooldown) inner += `<div class="cd" style="height:${Math.round(b.cooldown * 100)}%"></div>`;
      if (b.progress) inner += `<div class="cd prog" style="height:${Math.round((1 - b.progress) * 100)}%"></div>`;
      cell.innerHTML = inner;
      cell.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.button === 2) {
          b.onRightClick?.();
          this.cardSig = '';
          return;
        }
        if (b.disabled) {
          this.game.sound('error');
          return;
        }
        b.onClick?.(e);
        this.game.sound('click', undefined, undefined, 0.4);
        this.cardSig = '';
      });
      cell.addEventListener('contextmenu', (e) => e.preventDefault());
      cell.addEventListener('mouseenter', () => {
        this.tooltipBtn = b.id;
      });
      cell.addEventListener('mouseleave', () => {
        if (this.tooltipBtn === b.id) this.tooltipBtn = null;
      });
      card.appendChild(cell);
    });
  }

  updateTooltip(): void {
    const tip = $('tooltip');
    const id = this.tooltipBtn;
    const b = id && this.input.buttons.find((x) => x.id === id);
    if (b) {
      tip.innerHTML = `<div class="tt-name">${esc(b.name)}${b.hotkey ? ` <span class="tt-key">(${esc(b.keyLabel ?? b.hotkey)})</span>` : ''}</div>${b.cost ? `<div class="tt-cost">${b.cost}</div>` : ''}${b.tooltip ? `<div class="tt-body">${b.tooltip}</div>` : ''}`;
      tip.classList.remove('hidden');
      return;
    }
    if (this.invTip !== undefined && this.invTip !== null) {
      tip.innerHTML = this.invTip;
      tip.classList.remove('hidden');
      return;
    }
    tip.classList.add('hidden');
  }

  // ---------------------------------------------------------------- info
  updateInfo(unit: Unit | null): void {
    const g = this.game;
    const info = $('info');
    const sel = this.input.selection.filter((u) => !u.dead);
    const hpEl = $('portrait-hp');
    const mpEl = $('portrait-mp');
    if (!unit) {
      info.innerHTML = '<div class="info-empty">Heroes &amp; Empires</div>';
      hpEl.textContent = '';
      mpEl.textContent = '';
      this.infoSig = '';
      return;
    }
    hpEl.textContent = unit.def.invulnerable ? '' : `${Math.ceil(unit.hp)} / ${unit.maxHp}`;
    hpEl.style.color = unit.hp / unit.maxHp > 0.66 ? '#4cff4c' : unit.hp / unit.maxHp > 0.33 ? '#ffe14c' : '#ff4c4c';
    mpEl.textContent = unit.maxMana ? `${Math.floor(unit.mana)} / ${unit.maxMana}` : '';

    if (sel.length > 1) {
      const sig = `multi|${sel.map((u) => `${u.id}:${Math.round((u.hp / u.maxHp) * 10)}`).join(',')}|${this.input.activeType}`;
      if (sig === this.infoSig) return;
      this.infoSig = sig;
      info.innerHTML = `<div class="multi">${sel
        .map(
          (u) => `<div class="mu ${u.type === this.input.activeType ? 'active' : ''}" data-id="${u.id}">
            <img src="${this.icon(u.def.model, u.owner.color, u.isBuilding)}" alt="">
            <div class="mhp"><i style="width:${(u.hp / u.maxHp) * 100}%;background:${u.hp / u.maxHp > 0.66 ? '#2fd12f' : u.hp / u.maxHp > 0.33 ? '#e8d22a' : '#e8352a'}"></i></div>
          </div>`,
        )
        .join('')}</div>`;
      info.querySelectorAll<HTMLElement>('.mu').forEach((el) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const u = g.unitById.get(Number(el.dataset['id']));
          if (!u) return;
          if (e.shiftKey) {
            u.selected = false;
            this.input.selection = this.input.selection.filter((s) => s !== u);
            this.input.sortSelection();
          } else this.input.setSelection([u]);
          this.infoSig = '';
        });
      });
      return;
    }

    // Single unit.
    const u = unit;
    const parts: string[] = [];
    const title = u.name;
    let sub = '';
    if (u.isHero) {
      sub = `Level ${u.level} ${u.def.title ?? ''}${u.isIllusion ? ' (Illusion)' : ''}`;
    } else if (u.def.boss) sub = u.def.title!;
    else if (u.isBuilding) sub = u.owner.general ? `${u.owner.name}` : '';
    else sub = u.owner.general ? u.owner.name : u.owner === g.creeps ? `Level ${u.def.level} Creep` : u.owner === g.legion ? "Kalenden's Legion" : '';

    if (u.underConstruction) {
      parts.push(`<div class="progress"><div class="pl">Constructing</div><div class="bar"><i style="width:${u.buildProgress * 100}%"></i></div></div>`);
    } else if (u.isBuilding && (u.trainQueue.length || u.upgrading || u.researching)) {
      if (u.upgrading) {
        const what = u.upgrading.age ? `Advancing to the ${AGE_NAMES[u.upgrading.age]!}` : `Upgrading to ${UNITS[u.upgrading.to!]!.name}`;
        parts.push(`<div class="progress"><div class="pl">${what}</div><div class="bar"><i style="width:${(u.upgrading.time / u.upgrading.total) * 100}%"></i></div></div>`);
      }
      if (u.researching) {
        const up = UPGRADES[u.researching.upg]!;
        parts.push(`<div class="progress"><div class="pl">Researching ${up.name} level ${(u.owner.upgrades[u.researching.upg] ?? 0) + 1}</div><div class="bar"><i style="width:${(u.researching.time / u.researching.total) * 100}%"></i></div></div>`);
      }
      if (u.trainQueue.length) {
        const q0 = u.trainQueue[0]!;
        parts.push(`<div class="queue">${u.trainQueue
          .map((q, i) => `<div class="qi" data-i="${i}"><img src="${this.icon(UNITS[q.type]!.model, u.owner.color)}" alt=""></div>`)
          .join('')}</div><div class="progress small"><div class="bar"><i style="width:${(q0.time / q0.total) * 100}%"></i></div></div>`);
      }
    } else {
      const stats: string[] = [];
      const dmg = u.damageRange;
      if (dmg) stats.push(`<div class="stat"><span class="si">⚔</span>Damage: <b>${dmg[0]} - ${dmg[1]}</b></div>`);
      if (!u.def.invulnerable) stats.push(`<div class="stat"><span class="si">🛡</span>Armor: <b>${Math.round(u.armor * 10) / 10}</b> <span class="dim">(${u.def.armorType})</span></div>`);
      if (u.isHero) {
        const pr = u.heroDef!.primary;
        stats.push(`<div class="attrs">
          <span class="${pr === 'str' ? 'prim' : ''}">Str ${u.str}</span>
          <span class="${pr === 'agi' ? 'prim' : ''}">Agi ${u.agi}</span>
          <span class="${pr === 'int' ? 'prim' : ''}">Int ${u.int}</span></div>`);
        if (!u.isIllusion) {
          const next = u.xpForNext;
          const cur = u.xpForCurrent;
          const xp = u.xp!;
          stats.push(`<div class="xp"><div class="bar"><i style="width:${next ? ((xp - cur) / (next - cur)) * 100 : 100}%"></i></div><span>${next ? `XP ${Math.floor(xp)} / ${next}` : 'Max level'}</span></div>`);
        }
      }
      if (u.type === 'goldmine') stats.push(`<div class="stat"><span class="si">◉</span>Gold: <b>${u.goldLeft}</b></div>`);
      if (u.carry) stats.push(`<div class="stat dim">Carrying ${u.carry.amount} ${u.carry.kind}</div>`);
      if (u.def.foodProvided && !u.underConstruction && !u.def.tier) stats.push(`<div class="stat dim">Provides ${u.def.foodProvided} army supply</div>`);
      if (u.def.housingByAge && !u.underConstruction) {
        stats.push(
          u.roadConnected
            ? `<div class="stat ok">Shelters ${u.def.housingByAge[u.ageLevel - 1]} citizens (+${u.def.housingByAge[u.ageLevel - 1]} supply)</div>`
            : '<div class="stat warn">Not connected to your town center by road: nobody can live here. Lay a road linking it.</div>',
        );
      }
      if (u.def.foodRateByAge && !u.underConstruction) {
        stats.push(`<div class="stat ok">Grows ${Math.round(u.def.foodRateByAge[u.ageLevel - 1]! * 60 * (g.events?.harvestMult(u.owner) ?? 1))} food per minute</div>`);
      }
      if (u.def.tier && isEmpire(u.owner)) {
        const o = u.owner;
        stats.push(`<div class="stat">Age: <b>${AGE_NAMES[Math.max(1, o.tier)]!}</b></div>`);
        if (o === g.human) {
          const mood = moodOf(o.happiness);
          stats.push(`<div class="stat">Citizens: <b>${Math.floor(o.citizens)}/${o.housing}</b> · Mood: <b style="color:${mood.color}">${mood.icon} ${mood.name}</b></div>`);
          stats.push(`<div class="stat dim">Tax ${o.tax} → ${Math.round(o.taxRate * 60)} gold/min · Rations ${o.rations} → ${Math.round(o.foodEaten * 60)} food/min · Farms ${Math.round(o.foodProduced * 60)} food/min</div>`);
          if (o.starving) stats.push('<div class="stat warn">Your people are starving: no taxes are paid.</div>');
        }
      }
      if (u.def.researches && !u.underConstruction && u.owner === g.human) {
        const lv = u.def.researches.map((id) => `<span title="${UPGRADES[id]!.name}: ${UPGRADES[id]!.effect}">${UPGRADES[id]!.icon}${u.owner.upgrades[id] ?? 0}</span>`).join(' ');
        stats.push(`<div class="stat research-levels">${lv}</div>`);
      }
      if (u.def.nukes && !u.underConstruction) {
        stats.push(`<div class="stat ${u.nukeReady ? 'warn' : 'dim'}">${u.nukeReady ? '☢️ Nuclear missile armed' : u.nukeBuild ? 'Building a nuclear missile…' : 'No missile armed'}</div>`);
      }
      if (u.rebel) stats.push('<div class="stat warn">Rebel: an angry citizen in open revolt.</div>');
      if (u.def.caravan) stats.push('<div class="stat ok">Carries a fortune in gold. Stop it to claim the treasure!</div>');
      if (u.def.gate) stats.push('<div class="stat dim">Opens for you and your allies.</div>');
      if (u.def.shop) {
        const cust = g.shopCustomer(g.human, u);
        stats.push(`<div class="stat ${cust ? 'ok' : 'dim'}">${cust ? `${cust.def.name} may trade here.` : 'Bring your Hero close to trade.'}</div>`);
      }
      if (u.def.mercenaries) stats.push('<div class="stat dim">Hire with a unit nearby.</div>');
      if (u.type === 'fountain') stats.push('<div class="stat dim">Restores health and mana to nearby units.</div>');
      if (u.lifetime !== null && u.lifetime !== undefined) stats.push(`<div class="stat dim">Expires in ${Math.ceil(u.lifetime)}s</div>`);
      const buffs = [...u.buffs.values()].filter((b) => !b.aura || true).map((b) => b.id);
      if (buffs.length) {
        const names: Record<string, string> = {
          stun: 'Stunned', slow: 'Slowed', thunder_slow: 'Thunder Clap', divine_shield: 'Divine Shield', wind_walk: 'Wind Walk',
          avatar: 'Avatar', entangle: 'Entangled', bladestorm: 'Bladestorm', aura_devotion_aura: 'Devotion Aura',
          aura_brilliance_aura: 'Brilliance Aura', aura_trueshot_aura: 'Trueshot Aura', elemental_power: '', tyrant_might: '', veteran: 'Veteran', dominion: "Kalenden's Dominion",
        };
        const list = buffs.map((b) => names[b] ?? b).filter(Boolean);
        if (list.length) stats.push(`<div class="buffs">${list.map((n) => `<span>${n}</span>`).join('')}</div>`);
      }
      parts.push(`<div class="stats">${stats.join('')}</div>`);
    }
    const html = `<div class="info-title">${esc(title)}</div><div class="info-sub">${esc(sub)}</div>${parts.join('')}`;
    if (html === this.infoSig) return;
    this.infoSig = html;
    info.innerHTML = html;
    info.querySelectorAll<HTMLElement>('.qi').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (u.owner === g.human) g.cancelTrain(u, Number(el.dataset['i']));
        this.infoSig = '';
      });
    });
  }

  // ----------------------------------------------------------- inventory
  buildInventory(): void {
    const grid = $('inv-grid');
    grid.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.dataset['i'] = String(i);
      s.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.inventoryClick(i, e);
      });
      s.addEventListener('contextmenu', (e) => e.preventDefault());
      s.addEventListener('mouseenter', () => (this.invHover = i));
      s.addEventListener('mouseleave', () => {
        if (this.invHover === i) this.invHover = null;
      });
      grid.appendChild(s);
    }
  }

  inventoryClick(slot: number, e?: ButtonEvent): void {
    const g = this.game;
    const u = this.input.activeUnit();
    if (!u || !u.isHero || u.owner !== g.human || u.isIllusion) return;
    if (e?.shiftKey || (e && 'button' in e && e.button === 2)) {
      g.sellItem(u, slot);
    } else if (!g.useItem(u, slot)) {
      const it = u.inventory![slot];
      if (it && !ITEMS[it.id]!.use) g.message('That item is passive.', '#ccc');
    }
    this.invSig = '';
  }

  updateInventory(unit: Unit | null): void {
    const inv = $('inventory');
    const show = unit && unit.isHero;
    inv.classList.toggle('inactive', !show);
    const items: (InventoryItem | null)[] = show ? unit.inventory! : [null, null, null, null, null, null];
    const sig = items.map((it) => (it ? `${it.id}:${it.charges}` : '-')).join(',');
    if (sig !== this.invSig) {
      this.invSig = sig;
      const slots = inv.querySelectorAll('.slot');
      items.forEach((it, i) => {
        const s = slots[i]!;
        if (!it) {
          s.innerHTML = `<span class="hk">${['7', '8', '4', '5', '1', '2'][i]}</span>`;
          s.classList.remove('full');
          return;
        }
        const d = ITEMS[it.id]!;
        s.classList.add('full');
        s.innerHTML = `<div class="glyph" style="background:radial-gradient(circle at 35% 30%, ${d.color}, #111 85%)">${d.icon}</div>${d.use && it.charges > 1 ? `<span class="cnt">${it.charges}</span>` : ''}`;
      });
    }
    // Item tooltip.
    if (this.invHover !== null && this.invHover !== undefined && show) {
      const it = items[this.invHover];
      if (it) {
        const d = ITEMS[it.id]!;
        this.invTip = `<div class="tt-name">${esc(d.name)}</div><div class="tt-body">${d.description}${d.use ? '<br><span class="dim">Click to use.</span>' : ''}<br><span class="dim">Shift-click near a shop to sell.</span></div>`;
      } else this.invTip = null;
    } else this.invTip = null;
  }

  // ------------------------------------------------------------ messages
  updateMessages(): void {
    const now = performance.now();
    const list = this.game.messages.filter((m) => now - m.time < 9000);
    const html = list.map((m) => `<div class="msg" style="color:${m.color};opacity:${Math.min(1, (9000 - (now - m.time)) / 1500)}">${esc(m.text)}</div>`).join('');
    if (html !== this.msgHtml) {
      this.msgHtml = html;
      $('messages').innerHTML = html;
    }
  }
}

