// Computer-controlled rival generals. Each plays either the Hero path
// (level up on creeps, buy items, hire mercenaries, raid and hunt Kalenden)
// or the Empire path (gather, build a base, train an army and attack).
import { UNITS, UPGRADES, ROAD, AGES, ECONOMY } from '../data/units.js';
import { Roads } from '../game/roads.js';
import { ITEMS } from '../data/items.js';
import { ABILITIES } from '../game/abilities.js';
import { canCast, findNearestTree } from '../game/behavior.js';
import { CENTER, CITADEL, MAP_SIZE } from '../world/layout.js';
import { distToSegment } from '../world/noise.js';

const WISHLIST = {
  str: ['claws6', 'ring2', 'gauntlets', 'boots', 'periapt', 'claws12', 'belt', 'ring5', 'crown', 'mask_death'],
  agi: ['claws6', 'slippers', 'ring2', 'boots', 'periapt', 'claws12', 'boots_agi', 'ring5', 'mask_death', 'crown'],
  int: ['mantle', 'ring2', 'sobi_mask', 'boots', 'periapt', 'robe', 'claws12', 'ring5', 'crown', 'mask_death'],
};
const REPLACES = {
  claws12: 'claws6', ring5: 'ring2', belt: 'gauntlets', boots_agi: 'slippers', robe: 'mantle', crown: 'sobi_mask',
  mask_death: 'periapt',
};

export class GeneralAI {
  constructor(game, p) {
    this.g = game;
    this.p = p;
    this.timer = Math.random();
    this.state = 'start';
    this.attacks = 0;
    this.defendUntil = 0;
    this.defendPos = null;
    this.target = null;
    this.armyStart = 0;
    this.lastObjective = 0;
    this.buildRetry = {};
    this.status = p.mode === 'hero' ? 'Setting out' : 'Founding its empire';
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.p.mode === 'hero') {
      this.timer = 0.4;
      this.thinkHero();
    } else {
      this.timer = 1.0;
      this.thinkEmpire();
    }
  }

  // ----------------------------------------------------------- callbacks
  onAttacked(unit, attacker) {
    if (!unit.isBuilding && !unit.def.worker) return;
    if (attacker.owner === this.g.creeps) return;
    if (this.g.time < this.defendUntil - 10) return;
    this.defendUntil = this.g.time + 20;
    this.defendPos = { x: unit.x, z: unit.z };
  }

  // ---------------------------------------------------------------- shared
  army() {
    return this.p.units.filter((u) => !u.dead && !u.def.worker && !u.isHero && u.canAttack);
  }

  armyFood(list = this.army()) {
    return list.reduce((s, u) => s + (u.def.food || 1), 0);
  }

  home() {
    const [x, z] = this.p.base.hall;
    return { x, z };
  }

  nearestEnemyBase() {
    let best = null;
    let bd = Infinity;
    const h = this.home();
    for (const o of this.g.generals) {
      if (o === this.p || o.defeated || !this.g.isEnemy(this.p, o)) continue;
      const b = o.buildings.find((x) => !x.dead) ?? (o.hero && !o.hero.dead ? o.hero : null);
      if (!b) continue;
      // Empires prefer rival empires; small hero-path camps are left alone until late.
      const penalty = this.p.mode === 'empire' && o.mode === 'hero' && this.g.time < 25 * 60 ? 80 : 0;
      const d = Math.hypot(b.x - h.x, b.z - h.z) + penalty;
      if (d < bd) {
        bd = d;
        best = { x: b.x, z: b.z, player: o };
      }
    }
    return best;
  }

  enemiesNear(x, z, r) {
    return this.g.enemiesInRadius(this.p, x, z, r).filter((u) => !u.def.invulnerable);
  }

  // ================================================================= HERO
  thinkHero() {
    const g = this.g;
    const p = this.p;
    const h = p.hero;
    // Mercenaries follow the hero.
    const mercs = this.army().filter((u) => !u.summoned && !u.isIllusion);
    if (!h || h.dead) {
      this.status = h?.reviveAt ? 'Hero reviving at the Altar' : 'Hero has fallen';
      const altar = p.buildings.find((b) => !b.dead && b.def.revivesHeroes);
      for (const m of mercs) if (m.order.type !== 'attackMove' && altar) g.issueOrder(m, { type: 'attackMove', point: { x: altar.x, z: altar.z } });
      return;
    }
    this.learnSkills(h);

    // Potions
    const hpR = h.hp / h.maxHp;
    if (hpR < 0.4) this.useItemOfType(h, 'heal');
    if (h.maxMana && h.mana / h.maxMana < 0.15) this.useItemOfType(h, 'mana');

    // Retreat when badly hurt.
    if (this.state === 'retreat') {
      if (hpR > 0.85) this.state = 'idle';
      else {
        this.status = 'Retreating to heal';
        this.retreat(h);
        return;
      }
    } else if (hpR < 0.3) {
      this.state = 'retreat';
      this.status = 'Retreating to heal';
      if (!this.useItemOfType(h, 'townPortal')) this.retreat(h);
      return;
    }

    // Fight whatever is close.
    const foes = this.enemiesNear(h.x, h.z, 9);
    if (foes.length) {
      const general = foes.find((f) => f.owner.general);
      const legion = foes.find((f) => f.owner === g.legion);
      this.status = general ? `Fighting ${general.owner.isHuman ? 'you' : general.owner.name}` : legion ? (Math.hypot(h.x - CENTER, h.z - CENTER) < 30 ? 'Assaulting Kalenden' : "Fighting Kalenden's Legion") : 'Fighting creeps';
      this.heroCombat(h, foes);
      for (const m of mercs) {
        if (m.order.type === 'idle' || m.order.type === 'follow') g.issueOrder(m, { type: 'attackMove', point: { x: h.x, z: h.z } });
      }
      return;
    }

    // Defend home (portal back if far away).
    if (g.time < this.defendUntil && this.defendPos) {
      this.status = 'Defending its base';
      if (h.distTo(this.defendPos) > 35 && this.useItemOfType(h, 'townPortal')) return;
      this.go(h, this.defendPos, true);
      this.rallyMercs(mercs, h);
      return;
    }

    // Help allies that are under attack or storming the citadel.
    const call = this.allyCall();
    const answer = call && (call.kind === 'defend' ? h.distTo(call) < 75 : call.kind === 'skirmish' ? hpR > 0.5 : h.level >= 6 && hpR > 0.6);
    if (answer) {
      this.status = this.callLabel(call);
      this.go(h, call, true);
      this.rallyMercs(mercs, h);
      return;
    }

    // A hired Hero guards its employer's lands between fights.
    if (p.hiredBy && !p.hiredBy.defeated) {
      const emp = p.hiredBy;
      const home = emp.buildings.find((b) => !b.dead && (b.def.tier || b.def.revivesHeroes));
      const target = emp.ai?.state === 'attack' && emp.ai.target ? emp.ai.target : null;
      if (target && hpR > 0.6) {
        this.status = `Fighting for ${emp.isHuman ? 'you' : emp.name}`;
        this.go(h, target, true);
        this.rallyMercs(mercs, h);
        return;
      }
      if (home && h.distTo(home) > 40) {
        this.status = `Guarding ${emp.isHuman ? 'your' : `${emp.name}'s`} lands`;
        this.go(h, { x: home.x, z: home.z }, true);
        this.rallyMercs(mercs, h);
        return;
      }
    }

    // Shopping.
    if (this.shop(h)) {
      this.status = 'Shopping for items';
      return;
    }

    // Hire mercenaries with spare gold.
    if (this.hireMercs(h)) {
      this.status = 'Hiring mercenaries';
      return;
    }

    // Objective: creep, raid, or hunt Kalenden.
    if (h.order.type === 'attackMove' && g.time - this.lastObjective < 25) {
      this.rallyMercs(mercs, h);
      return;
    }
    const obj = this.heroObjective(h, mercs);
    if (obj) {
      this.lastObjective = g.time;
      this.status = obj.label;
      this.go(h, obj, true);
    }
    this.rallyMercs(mercs, h);
  }

  /** An ally who needs help: their base under attack, or an assault on Kalenden in progress. */
  allyCall() {
    const g = this.g;
    for (const o of g.generals) {
      if (o === this.p || o.defeated || o.team !== this.p.team) continue;
      const ua = o.underAttack;
      if (ua && g.time - ua.time < 6) return { x: ua.x, z: ua.z, kind: 'defend', ally: o };
      const f = o.lastFight;
      if (f && g.time - f.time < 5 && f.vs === g.legion && Math.hypot(f.x - CENTER, f.z - CENTER) < 30) {
        return { x: f.x, z: f.z, kind: 'assault', ally: o };
      }
      // An ally's hero skirmishing with a rival general nearby.
      if (f && g.time - f.time < 4 && f.vs?.general && g.isEnemy(this.p, f.vs) && this.p.hero && !this.p.hero.dead) {
        if (Math.hypot(f.x - this.p.hero.x, f.z - this.p.hero.z) < 35) return { x: f.x, z: f.z, kind: 'skirmish', ally: o, vs: f.vs };
      }
    }
    return null;
  }

  callLabel(call) {
    const who = call.ally.isHuman ? 'you' : call.ally.name;
    if (call.kind === 'defend') return `Defending ${call.ally.isHuman ? 'your' : `${call.ally.name}'s`} base`;
    if (call.kind === 'skirmish') return `Helping ${who} fight ${call.vs.isHuman ? 'you' : call.vs.name}`;
    return `Assaulting Kalenden with ${who}`;
  }

  rallyMercs(mercs, h) {
    for (const m of mercs) {
      if (m.distTo(h) > 7 && m.order.type !== 'attack') this.g.issueOrder(m, { type: 'attackMove', point: { x: h.x, z: h.z } });
    }
  }

  heroPower(h, mercs) {
    let pw = h.level * 4.2 + (h.damageRange[0] / 6) + h.armor * 0.5;
    pw += mercs.reduce((s, m) => s + m.def.level * 0.9, 0);
    return pw;
  }

  hasAllies() {
    return this.g.generals.some((o) => o !== this.p && !o.defeated && o.team === this.p.team);
  }

  raidsAllowed() {
    return this.g.time > [16, 12, 8][this.g.difficulty] * 60;
  }

  heroObjective(h, mercs) {
    const g = this.g;
    const power = this.heroPower(h, mercs);
    // Endgame: go for Kalenden.
    const k = g.legionMgr.kalenden;
    const ready = h.level >= 10 || (h.level >= 9 && mercs.length >= 2) || (this.hasAllies() && h.level >= 8 && g.time > 16 * 60) || g.time > 45 * 60;
    if (!k.dead && ready && h.hp > h.maxHp * 0.8) {
      return { x: k.x, z: k.z, label: 'Marching on Kalenden' };
    }
    // Occasionally raid a rival.
    if (h.level >= 6 && this.raidsAllowed() && Math.random() < 0.18) {
      const base = this.nearestEnemyBase();
      if (base) return { ...base, label: `Raiding ${base.player.isHuman ? 'you' : base.player.name}` };
    }
    // Creep the best camp we can handle (carefully while low level).
    let best = null;
    let bestScore = Infinity;
    const margin = h.level <= 2 ? 0.85 : h.level <= 4 ? 1.0 : 1.15;
    for (const c of g.creepMgr.aliveCamps()) {
      if (c.power > power * margin) continue;
      const d = Math.hypot(c.at.x - h.x, c.at.z - h.z);
      const score = d - c.power * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) return { ...best.at, label: `Hunting creeps (level ${h.level})` };
    // Nothing to do: raid a rival, or guard home.
    const base = this.raidsAllowed() ? this.nearestEnemyBase() : null;
    if (base && h.level >= 5) return { ...base, label: `Raiding ${base.player.isHuman ? 'you' : base.player.name}` };
    return { ...this.home(), label: 'Guarding its base' };
  }

  heroCombat(h, foes) {
    const g = this.g;
    // Prefer heroes, then the weakest unit.
    let target = null;
    let best = Infinity;
    for (const f of foes) {
      if (!f.targetableBy(h)) continue;
      let s = f.hp + h.distTo(f) * 40;
      if (f.isHero) s -= 300;
      if (f.isBuilding) s += 2000;
      if (s < best) {
        best = s;
        target = f;
      }
    }
    if (this.castHeroSpells(h, foes, target)) return;
    if (target && (h.order.type !== 'attack' || h.order.target !== target) && h.order.type !== 'cast' && h.order.type !== 'channel') {
      if (h.order.type === 'attack' && h.order.target && !h.order.target.dead && h.distTo(h.order.target) < h.range + 2) return;
      g.issueOrder(h, { type: 'attack', target });
    }
  }

  castHeroSpells(h, foes, target) {
    const g = this.g;
    if (h.order.type === 'cast' || h.order.type === 'channel' || h.castTimer > 0) return true;
    for (const id of h.heroDef.abilities) {
      if (!canCast(g, h, id)) continue;
      const ab = ABILITIES[id];
      const close = foes.filter((f) => h.distTo(f) < 6);
      switch (ab.ai) {
        case 'heal': {
          const ally = this.p.units
            .filter((u) => !u.dead && u.distTo(h) < ab.range + 2 && u.hp / u.maxHp < 0.6)
            .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
          if (ally) return this.cast(h, id, { target: ally });
          const undead = foes.find((f) => f.def.undead && h.distTo(f) < ab.range);
          if (undead && h.mana > 150) return this.cast(h, id, { target: undead });
          break;
        }
        case 'defensive':
          if (h.hp / h.maxHp < 0.45 && close.length) return this.cast(h, id, {});
          break;
        case 'escape':
          if (h.hp / h.maxHp < 0.35) {
            this.cast(h, id, {});
            this.state = 'retreat';
            return true;
          }
          break;
        case 'nuke':
          if (target && (target.isHero || target.hp > 300 || target.def.level >= 4) && h.distTo(target) < ab.range + 3) {
            return this.cast(h, id, { target });
          }
          break;
        case 'aoe': {
          const cluster = this.bestCluster(foes, ab.aoe ?? 3);
          if (cluster && (cluster.count >= 2 || (cluster.count >= 1 && ab.ultimate))) return this.cast(h, id, { point: cluster.point });
          break;
        }
        case 'aoeSelf': {
          const r = ab.radius ?? 3.5;
          const n = foes.filter((f) => h.distTo(f) < r).length;
          if (n >= 2 || (n >= 1 && foes.some((f) => f.isHero))) return this.cast(h, id, {});
          break;
        }
        case 'summon':
          if (close.length) return this.cast(h, id, {});
          break;
        case 'combatBuff':
          if (close.length >= 2 || close.some((f) => f.isHero || f.def.boss)) return this.cast(h, id, {});
          break;
        case 'resurrect':
          if (g.corpses.filter((c) => c.owner === this.p && Math.hypot(c.x - h.x, c.z - h.z) < 10).length >= 3) {
            return this.cast(h, id, {});
          }
          break;
        default:
      }
    }
    return false;
  }

  bestCluster(foes, r) {
    let best = null;
    for (const f of foes) {
      const count = foes.filter((o) => Math.hypot(o.x - f.x, o.z - f.z) < r).length;
      if (!best || count > best.count) best = { count, point: { x: f.x, z: f.z } };
    }
    return best;
  }

  cast(h, ability, { target = null, point = null }) {
    this.g.issueOrder(h, { type: 'cast', ability, target, point });
    return true;
  }

  learnSkills(h) {
    let guard = 0;
    while (h.skillPoints > 0 && guard++ < 6) {
      const abs = h.heroDef.abilities;
      const ult = abs[3];
      if (this.g.learnAbility(h, ult)) continue;
      // Level the first two abilities first, then the passive/aura.
      const order = [abs[0], abs[1], abs[2]].sort((a, b) => (h.abilityLevels[a] - h.abilityLevels[b]) || abs.indexOf(a) - abs.indexOf(b));
      let learned = false;
      for (const a of order) {
        if (this.g.learnAbility(h, a)) {
          learned = true;
          break;
        }
      }
      if (!learned) break;
    }
  }

  useItemOfType(h, use) {
    const slot = h.inventory.findIndex((it) => it && ITEMS[it.id].use === use);
    if (slot < 0) return false;
    return this.g.useItem(h, slot);
  }

  retreat(h) {
    const g = this.g;
    // Nearest of home altar or fountains.
    const spots = [];
    const altar = this.p.buildings.find((b) => !b.dead && b.def.revivesHeroes);
    if (altar) spots.push({ x: altar.x, z: altar.z });
    for (const f of g.passive.buildings) if (f.type === 'fountain') spots.push({ x: f.x, z: f.z });
    spots.sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z));
    // Shop on the way home if we can.
    if (this.p.gold >= 250) this.shop(h, true);
    const s = spots[0];
    if (!s) return;
    if (Math.hypot(s.x - h.x, s.z - h.z) > 3.5) {
      if (h.order.type !== 'move' || Math.hypot(h.order.point.x - s.x, h.order.point.z - s.z) > 1) {
        g.issueOrder(h, { type: 'move', point: s, range: 2.5 });
      }
    } else if (h.order.type !== 'hold') g.issueOrder(h, { type: 'hold' });
  }

  go(h, pt, attack) {
    const o = h.order;
    if (o.point && Math.hypot(o.point.x - pt.x, o.point.z - pt.z) < 2 && (o.type === 'attackMove' || o.type === 'move')) return;
    this.g.issueOrder(h, { type: attack ? 'attackMove' : 'move', point: { x: pt.x, z: pt.z } });
  }

  /** Inventory slot to sell to make room for `wish`, or -1 if there is a free slot, or null if nothing fits. */
  slotFor(h, wish) {
    if (h.inventoryFreeSlot() >= 0) return -1;
    const worse = REPLACES[wish];
    let slot = h.inventory.findIndex((it) => it && it.id === worse);
    if (slot >= 0) return slot;
    // Otherwise replace the cheapest passive item if the wish is much better.
    let cheapest = null;
    h.inventory.forEach((it, i) => {
      if (!it || ITEMS[it.id].use) return;
      if (cheapest === null || ITEMS[it.id].cost < ITEMS[h.inventory[cheapest].id].cost) cheapest = i;
    });
    if (cheapest !== null && (ITEMS[h.inventory[cheapest].id].cost ?? 0) < ITEMS[wish].cost * 0.6) return cheapest;
    return null;
  }

  nextWish(h) {
    const list = WISHLIST[h.heroDef.primary];
    for (const id of list) {
      if (h.inventory.some((it) => it && it.id === id)) continue;
      // Skip items superseded by something we own.
      if (Object.entries(REPLACES).some(([better, worse]) => worse === id && h.inventory.some((it) => it && it.id === better))) continue;
      if (this.slotFor(h, id) === null) continue;
      return id;
    }
    return null;
  }

  shop(h, passing = false) {
    const g = this.g;
    const p = this.p;
    const potions = h.inventory.filter((it) => it && ITEMS[it.id].use === 'heal').reduce((s, it) => s + it.charges, 0);
    const wish = this.nextWish(h);
    const potionRoom = potions > 0 || h.inventoryFreeSlot() >= 0;
    // Keep a Scroll of Town Portal for emergencies once the core items are in.
    const hasTp = h.inventory.some((it) => it && ITEMS[it.id].use === 'townPortal');
    if (!hasTp && !wish && p.gold >= 500 && h.inventoryFreeSlot() >= 0 && h.level >= 4) {
      const merchant = g.passive.buildings.filter((s) => s.def.shop === 'merchant').sort((a, b) => a.distTo(h) - b.distTo(h))[0];
      if (merchant && h.distTo(merchant) <= merchant.radius + 6) g.buyItem(p, merchant, 'scroll_tp');
    }
    const wantPotion = potionRoom && ((potions < 1 && p.gold >= 250) || (potions < 2 && p.gold >= 700));
    const wishAffordable = wish && p.gold >= ITEMS[wish].cost + 100;
    if ((!wantPotion && !wishAffordable) || (this.shopCooldown ?? 0) > g.time) {
      this.shopping = null;
      return false;
    }
    // Which shop sells what we want?
    const kind = wishAffordable && !['claws6', 'ring2', 'gauntlets', 'slippers', 'mantle', 'boots', 'periapt', 'sobi_mask', 'ring_regen'].includes(wish) ? 'vault' : 'merchant';
    let shop = this.shopping;
    if (!shop || shop.def.shop !== kind) {
      shop = null;
      let bd = Infinity;
      for (const s of g.passive.buildings) {
        if (s.def.shop !== kind) continue;
        const d = s.distTo(h);
        if (d < bd) {
          bd = d;
          shop = s;
        }
      }
      if (!shop) return false;
      this.shopping = shop;
    }
    if (h.distTo(shop) > shop.radius + 5) {
      if (passing) return false;
      this.go(h, shop, false);
      return true;
    }
    // Buy.
    if (wishAffordable && shop.def.shop === kind) {
      const slot = this.slotFor(h, wish);
      if (slot !== null && slot >= 0) g.sellItem(h, slot);
      g.buyItem(p, shop, wish);
    }
    const potionSlot = h.inventory.some((it) => it && ITEMS[it.id].use === 'heal') || h.inventoryFreeSlot() >= 0;
    if (wantPotion && potionSlot && shop.def.shop === 'merchant') g.buyItem(p, shop, 'potion_healing');
    else if (wantPotion && potionSlot && shop.def.shop === 'vault' && p.gold >= 300) g.buyItem(p, shop, 'greater_healing');
    this.shopping = null;
    // Don't walk back to a shop immediately if nothing could be bought.
    this.shopCooldown = g.time + 20;
    return false;
  }

  /** Returns true while on the way to (or at) a mercenary camp. */
  hireMercs(h) {
    const g = this.g;
    const p = this.p;
    if (p.gold < 450 || h.level < 3 || (this.hireCooldown ?? 0) > g.time) return false;
    g.computeFood(p);
    const free = p.foodCap - p.foodUsed;
    if (free < 2) return false;
    let camp = null;
    let bd = Infinity;
    for (const s of g.passive.buildings) {
      if (s.type !== 'mercenary_camp') continue;
      const d = s.distTo(h);
      if (d < bd) {
        bd = d;
        camp = s;
      }
    }
    if (!camp) return false;
    const pick = ['rock_golem', 'ogre', 'forest_troll', 'gnoll'].find(
      (t) => UNITS[t].food <= free && camp.stock[t] > 0 && p.gold >= UNITS[t].cost.gold + 200,
    );
    if (!pick) return false;
    // Only make a long trip when well funded.
    if (bd > 30 && p.gold < 800) return false;
    if (h.distTo(camp) > camp.radius + 6) {
      this.go(h, camp, false);
      return true;
    }
    g.hireMerc(p, camp, pick);
    this.hireCooldown = g.time + 4;
    return true;
  }

  // =============================================================== EMPIRE
  thinkEmpire() {
    const g = this.g;
    const p = this.p;
    const halls = p.buildings.filter((b) => !b.dead && b.def.dropOff === true && !b.underConstruction);
    const hall = halls.find((h) => this.mainMine(h)?.goldLeft > 0) ?? halls[0];
    const peasants = p.units.filter((u) => !u.dead && u.type === 'peasant');
    if (!hall && !p.buildings.some((b) => !b.dead && b.def.dropOff === true)) {
      // Lost the town hall: rebuild if possible.
      if (peasants.length && g.canAfford(p, UNITS.townhall.cost)) this.build('townhall', peasants);
      this.militaryEmpire();
      return;
    }
    if (hall) this.economy(hall, peasants);
    if (hall) this.expand(hall, peasants);
    if (hall) this.city(hall, peasants);
    if (hall) this.civic(hall, peasants);
    this.construction(hall, peasants);
    this.production();
    this.militaryEmpire();
  }

  /** Take a new gold mine when the current one runs low. */
  expand(hall, peasants) {
    const g = this.g;
    const p = this.p;
    const mine = this.mainMine(hall);
    this.expansionGuard = null;
    if (mine && mine.goldLeft > 4000) return;
    if (p.buildings.some((b) => !b.dead && b.def.dropOff === true && b.underConstruction) || this.pendingBuild('townhall')) return;
    const halls = p.buildings.filter((b) => !b.dead && b.def.dropOff === true);
    const candidates = g.passive.buildings
      .filter((m) => m.type === 'goldmine' && !m.dead && m.goldLeft > 2000)
      .filter((m) => !halls.some((h) => h.distTo(m) < 14))
      .filter((m) => !g.generals.some((o) => o !== p && !o.defeated && o.buildings.some((b) => !b.dead && b.distTo(m) < 18)))
      .sort((a, b) => a.distTo(hall) - b.distTo(hall));
    const target = candidates[0];
    if (!target) return;
    const guards = g.unitsNear(target.x, target.z, 15).filter((u) => u.owner === g.creeps && !u.dead);
    if (guards.length) {
      this.expansionGuard = { x: guards[0].x, z: guards[0].z };
      return;
    }
    if (g.canAfford(p, UNITS.townhall.cost)) this.build('townhall', peasants, target);
  }

  mainMine(hall) {
    let best = null;
    let bd = Infinity;
    for (const m of this.g.passive.buildings) {
      if (m.type !== 'goldmine' || m.dead || m.goldLeft <= 0) continue;
      const d = m.distTo(hall);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return bd < 20 ? best : null;
  }

  economy(hall, peasants) {
    const g = this.g;
    const p = this.p;
    const mine = this.mainMine(hall);
    const onGold = peasants.filter((u) => u.harvest?.kind === 'gold' && u.order.type !== 'build' && u.order.type !== 'construct');
    const onWood = peasants.filter((u) => u.harvest?.kind === 'lumber' && u.order.type !== 'build' && u.order.type !== 'construct');
    const idle = peasants.filter((u) => u.order.type === 'idle');
    // Taxes bring in most of the gold, so once the treasury is full the Peasants cut wood.
    const taxed = (p.taxRate ?? 0) * 60 > 350;
    const goldTarget = !mine ? 0 : p.gold > 1500 ? 1 : p.lumber > 1000 ? 5 : taxed ? (p.gold > 500 ? 1 : 3) : p.gold > 700 ? 3 : 5;
    for (const u of idle) {
      if (mine && onGold.length < goldTarget) {
        g.issueOrder(u, { type: 'harvest', target: mine });
        onGold.push(u);
      } else {
        const tree = this.woodTree(hall);
        if (tree) {
          g.issueOrder(u, { type: 'harvest', target: tree });
          onWood.push(u);
        }
      }
    }
    if (onGold.length > goldTarget) {
      const u = onGold.find((x) => !x.harvest?.inside && !x.carry);
      const tree = this.woodTree(hall);
      if (u && tree) g.issueOrder(u, { type: 'harvest', target: tree });
    } else if (onGold.length < goldTarget && onWood.length > 2 && p.lumber > 300) {
      const u = onWood.find((x) => !x.carry);
      if (u) g.issueOrder(u, { type: 'harvest', target: mine });
    }
    const wanted = Math.min(26, 9 + p.tier * 2 + (p.gold > 2500 ? 4 : 0));
    // Don't tie up the town center with Peasants when the next age is affordable.
    if (peasants.length < wanted && hall.trainQueue.length === 0 && !hall.upgrading && !this.ageReady) g.trainUnit(hall, 'peasant');
  }

  /** Trees near the Lumber Yard if there is one, otherwise near the hall. */
  woodTree(hall) {
    const yard = this.p.buildings.find((b) => !b.dead && !b.underConstruction && b.def.dropOff === 'lumber');
    const from = yard ?? hall;
    return findNearestTree(this.g, from.x, from.z, 30);
  }

  // ---------------------------------------------------------------- city
  /**
   * Plan a grid of streets around the town hall (every 7 cells, inside the
   * city radius, avoiding the lane to the gold mine), then lay it out as
   * houses are needed.
   */
  planStreets(hall) {
    const g = this.g;
    const mine = this.mainMine(hall);
    const hx = Math.round(hall.x);
    const hz = Math.round(hall.z);
    const R = 23;
    const plan = new Set();
    const ok = (x, z) => {
      if (x < 2 || z < 2 || x >= MAP_SIZE - 2 || z >= MAP_SIZE - 2) return false;
      if (Math.hypot(x + 0.5 - hall.x, z + 0.5 - hall.z) > R) return false;
      if (mine && distToSegment(x + 0.5, z + 0.5, hall.x, hall.z, mine.x, mine.z) < 3.5) return false;
      if (mine && Math.hypot(x + 0.5 - mine.x, z + 0.5 - mine.z) < 4) return false;
      return g.terrain.heightAt(x + 0.5, z + 0.5) > -0.2;
    };
    for (let k = -3; k <= 3; k++) {
      for (let t = -R; t <= R; t++) {
        const a = hx + k * 7;
        if (ok(a, hz + t)) plan.add((hz + t) * MAP_SIZE + a);
        if (ok(hx + t, hz + k * 7)) plan.add((hz + k * 7) * MAP_SIZE + hx + t);
      }
    }
    this.streets = plan;
  }

  /** Lay the next stretch of planned street that joins the existing network. */
  extendStreets(n = 10) {
    const g = this.g;
    const p = this.p;
    const S = MAP_SIZE;
    const R = g.roads;
    const cells = [];
    // Grow out from the current network over planned cells.
    const seen = new Set();
    const queue = [];
    for (const k of this.streets) {
      const x = k % S;
      const z = (k - x) / S;
      if (R.isRoad(x, z)) continue;
      const touching = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => R.isRoad(x + dx, z + dz) && R.ownerAt(x + dx, z + dz) === p);
      if (touching) queue.push(k);
    }
    while (queue.length && cells.length < n) {
      const k = queue.shift();
      if (seen.has(k)) continue;
      seen.add(k);
      const x = k % S;
      const z = (k - x) / S;
      if (!R.canPlace(x, z, p, true)) continue;
      cells.push([x, z]);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = (z + dz) * S + x + dx;
        if (this.streets.has(nk) && !seen.has(nk)) queue.push(nk);
      }
    }
    if (!cells.length || p.gold < cells.length * ROAD.cost.gold + 60) return 0;
    return R.place(cells, p);
  }

  /** A free 2x2 spot touching one of our connected roads, off the planned streets. */
  findHouseSpot(hall) {
    const g = this.g;
    const p = this.p;
    const S = MAP_SIZE;
    const R = g.roads;
    const mine = this.mainMine(hall);
    const cands = [];
    for (let k = 0; k < R.owner.length; k++) {
      if (R.owner[k] !== p.index || !R.connected[k]) continue;
      const x = k % S;
      const z = (k - x) / S;
      cands.push([x, z, Math.hypot(x - hall.x, z - hall.z)]);
    }
    cands.sort((a, b) => a[2] - b[2]);
    for (const [x, z] of cands) {
      // House cell origins that put the 2x2 footprint edge-adjacent to (x, z).
      for (const [ox, oz] of [[1, 0], [1, -1], [-2, 0], [-2, -1], [0, 1], [-1, 1], [0, -2], [-1, -2]]) {
        const cx = x + ox;
        const cz = z + oz;
        let clash = false;
        for (let dz = 0; dz < 2 && !clash; dz++) for (let dx = 0; dx < 2; dx++) if (this.streets?.has((cz + dz) * S + cx + dx)) clash = true;
        if (clash) continue;
        const wx = cx + 1;
        const wz = cz + 1;
        if (mine && distToSegment(wx, wz, hall.x, hall.z, mine.x, mine.z) < 3.5) continue;
        if (!g.canPlace('house', wx, wz, p)) continue;
        if (!R.touchesRoad(cx, cz, 2, p, true)) continue;
        return { x: wx, z: wz };
      }
    }
    return null;
  }

  city(hall, peasants) {
    const g = this.g;
    const p = this.p;
    if (!this.streets || this.streetsHall !== hall.id) {
      this.planStreets(hall);
      this.streetsHall = hall.id;
    }
    g.computeFood(p);
    // Houses whenever population runs short.
    const building = p.buildings.filter((b) => !b.dead && b.def.needsRoad && b.underConstruction).length + (this.pendingBuild('house') ? 1 : 0);
    const fed = p.foodRate > 0.05 && p.food > 100 && p.lumber > 120 && p.citizens < 80 + 40 * p.tier;
    const short = (p.foodCap < 200 && p.foodCap - p.foodUsed <= (p.foodUsed > 40 ? 9 : 5)) || (fed && p.citizens >= p.housing - 2 && p.happiness >= 40);
    const supplyShort = p.foodCap < 200 && p.foodCap - p.foodUsed <= (p.foodUsed > 40 ? 9 : 5);
    const r = this.reserve;
    const saving = !supplyShort && r && (p.gold - UNITS.house.cost.gold < (r.gold ?? 0) || p.lumber - UNITS.house.cost.lumber < (r.lumber ?? 0));
    if (short && !saving && building < (p.foodUsed > 40 ? 2 : 1) && g.canAfford(p, UNITS.house.cost)) {
      const spot = this.findHouseSpot(hall);
      if (spot) this.buildAt('house', spot, peasants);
      else this.extendStreets(12);
    } else if (g.time - (this.lastStreet ?? 0) > 45 && p.gold > 300) {
      // Keep a little road ahead of demand.
      this.lastStreet = g.time;
      this.extendStreets(6);
    }
    // A wall across the approach to the town, with a gate, once in the Feudal Age.
    if (p.tier >= 3 && !this.wallPlanned && g.time > 400 && p.lumber > 260 && p.gold > 90) this.planFrontWall(hall, peasants);
  }

  /**
   * Run the people: farms to feed them, taxes and rations to keep them happy, nuclear missiles,
   * and Heroes for hire.
   */
  civic(hall, peasants) {
    const g = this.g;
    const p = this.p;
    if (g.time - (this.lastCivic ?? 0) < 4) return;
    this.lastCivic = g.time;
    const E = g.empires;
    // Food: enough farms for the citizens we will soon have.
    const farmsBuilding = p.buildings.filter((b) => !b.dead && b.type === 'farm' && b.underConstruction).length + (this.pendingBuild('farm') ? 1 : 0);
    const need = Math.max(p.citizens, p.housing * 0.9) * Math.max(p.rations, 8) * ECONOMY.foodPerRation;
    const perFarm = UNITS.farm.foodRateByAge[Math.max(1, p.tier) - 1];
    const farmsWanted = Math.ceil((need * 1.1 - p.foodProduced) / perFarm);
    this.hungry = p.starving || (p.foodRate < 0 && p.food < -p.foodRate * 90);
    if (farmsWanted > 0 && farmsBuilding < Math.min(3, farmsWanted)) {
      if (g.canAfford(p, UNITS.farm.cost)) this.build('farm', peasants, hall);
    }
    // Rations: tighten them while hungry, be generous with a full granary.
    if ((p.starving || (p.food < 60 && p.foodRate < 0)) && p.rations > 4) E.setRations(p, p.rations - 1);
    else if (p.food > 350 && p.foodRate > 0 && p.rations < (p.food > 1500 ? 17 : 13)) E.setRations(p, p.rations + 1);
    else if (p.food < 150 && p.foodRate < 0 && p.rations > 10) E.setRations(p, p.rations - 1);
    // Taxes: as high as the people will happily bear.
    if (p.happiness < 45 && p.tax > 1) E.setTax(p, p.tax - 1);
    else if (p.happinessTarget < 58 && p.tax > 2) E.setTax(p, p.tax - 1);
    else if (p.happinessTarget > 70 && p.happiness > 62 && p.tax < 8) E.setTax(p, p.tax + 1);
    // Nuclear missiles.
    for (const b of p.buildings) {
      if (b.dead || b.underConstruction || !b.def.nukes) continue;
      if (!b.nukeReady && !b.nukeBuild && p.gold > ECONOMY.nuke.cost.gold + 250 && p.lumber > ECONOMY.nuke.cost.lumber + 200 && this.armyFood(this.army()) >= 20) E.startNuke(b);
      if (b.nukeReady) {
        const t = this.nukeTarget();
        if (t) E.launchNuke(b, t.x, t.z);
      }
    }
    // Hire a Hero when rich, or when in trouble.
    if (g.time - (this.lastHire ?? 0) > 60 && p.tier >= 2) {
      this.lastHire = g.time;
      const troubled = p.underAttack && g.time - p.underAttack.time < 20;
      const options = E.heroesForHire(p).sort((a, b) => b.hero.level - a.hero.level);
      const hg = options.find((o) => p.gold > E.hireFee(o) + (troubled ? 150 : 700));
      if (hg && (troubled || Math.random() < 0.35)) E.hire(p, hg);
    }
  }

  /** Where to drop a nuke: the most valuable enemy town, never near our own buildings. */
  nukeTarget() {
    const g = this.g;
    const p = this.p;
    const R = ECONOMY.nuke.radius + 4;
    let best = null;
    let bestScore = 0;
    for (const o of g.generals) {
      if (o.defeated || !g.isEnemy(p, o)) continue;
      for (const b of o.buildings) {
        if (b.dead || (!b.def.tier && !b.def.revivesHeroes && !b.def.trains)) continue;
        if (p.buildings.some((m) => !m.dead && Math.hypot(m.x - b.x, m.z - b.z) < R)) continue;
        if (p.units.some((u) => !u.dead && Math.hypot(u.x - b.x, u.z - b.z) < R)) continue;
        let score = 0;
        for (const u of g.unitsNear(b.x, b.z, ECONOMY.nuke.radius)) if (!u.dead && g.isEnemy(p, u.owner)) score += u.isBuilding ? 3 : u.def.food || 1;
        if (score > bestScore) {
          bestScore = score;
          best = { x: b.x, z: b.z };
        }
      }
    }
    return bestScore >= 8 ? best : null;
  }

  /** Wall line across the side of the town that faces the map center, gate in the middle. */
  planFrontWall(hall, peasants) {
    const g = this.g;
    const p = this.p;
    this.wallPlanned = true;
    const [tx, tz] = p.base.toCenter;
    const cx = hall.x + tx * 26;
    const cz = hall.z + tz * 26;
    const px = -tz;
    const pz = tx;
    const a = [Math.floor(cx + px * 13), Math.floor(cz + pz * 13)];
    const b = [Math.floor(cx - px * 13), Math.floor(cz - pz * 13)];
    const line = Roads.line(a[0], a[1], b[0], b[1]);
    const workers = peasants.filter((u) => u.harvest?.kind === 'lumber' && !u.carry).slice(0, 2);
    if (!workers.length) return;
    // Gate in the middle first; the wall pieces skip its cells.
    const mid = line[Math.floor(line.length / 2)];
    const gx = mid[0] + 1;
    const gz = mid[1] + 1;
    if (g.canPlace('gate', gx, gz, p) && g.spend(p, UNITS.gate.cost)) {
      g.issueOrder(workers[0], { type: 'build', building: 'gate', x: gx, z: gz, paid: true });
    }
    const gateCells = new Set([`${mid[0]},${mid[1]}`, `${mid[0] + 1},${mid[1]}`, `${mid[0]},${mid[1] + 1}`, `${mid[0] + 1},${mid[1] + 1}`]);
    const pieces = line.filter(([x, z]) => !gateCells.has(`${x},${z}`) && g.canPlace('wall', x + 0.5, z + 0.5, p));
    const half = Math.ceil(pieces.length / workers.length);
    workers.forEach((w, wi) => {
      const tree = w.harvest?.tree;
      // The gate builder queues its wall after the gate; the others start right away.
      let first = !(wi === 0 && w.order.type === 'build');
      pieces.slice(wi * half, (wi + 1) * half).forEach(([x, z]) => {
        if (!g.canAfford(p, UNITS.wall.cost)) return;
        g.spend(p, UNITS.wall.cost);
        g.issueOrder(w, { type: 'build', building: 'wall', x: x + 0.5, z: z + 0.5, paid: true }, !first);
        first = false;
      });
      if (tree) w.orderQueue.push({ type: 'harvest', target: tree });
    });
  }

  /** Forest-edge trees near `from`, best first (dense stands that are not too far). */
  woodsCandidates(from, maxR = 45) {
    const g = this.g;
    const T = g.terrain;
    const out = [];
    const fx = Math.floor(from.x);
    const fz = Math.floor(from.z);
    for (let dz = -maxR; dz <= maxR; dz += 2) {
      for (let dx = -maxR; dx <= maxR; dx += 2) {
        const tr = T.treeAtCell(fx + dx, fz + dz);
        if (!tr) continue;
        const d = Math.hypot(dx, dz);
        if (d > maxR) continue;
        // Reachable edge tree with open ground on at least one side.
        let open = 0;
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g.grid.walkable(tr.cx + ox * 2, tr.cz + oz * 2) && g.grid.walkable(tr.cx + ox, tr.cz + oz)) open++;
        if (!open) continue;
        let n = 0;
        for (let z = -4; z <= 4; z++) for (let x = -4; x <= 4; x++) if (T.treeAtCell(tr.cx + x, tr.cz + z)) n++;
        if (n < 12) continue;
        out.push({ tr, score: Math.min(n, 45) - d * 1.3 });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out.map((c) => c.tr);
  }

  /** Lumber Yard at the edge of good woods, on the side facing the town. */
  lumberYardSpot(hall) {
    const g = this.g;
    for (const tree of this.woodsCandidates(hall).slice(0, 40)) {
      for (let r = 3; r <= 6; r++) {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const x = g.snap(tree.x + Math.cos(a) * r, 3);
          const z = g.snap(tree.z + Math.sin(a) * r, 3);
          if (!g.canPlace('lumberyard', x, z, this.p)) continue;
          if (this.offStreets(x, z, 3)) return { x, z };
        }
      }
    }
    return null;
  }

  offStreets(x, z, fp) {
    if (!this.streets) return true;
    const cx = Math.round(x - fp / 2) - 1;
    const cz = Math.round(z - fp / 2) - 1;
    for (let dz = 0; dz < fp + 2; dz++) for (let dx = 0; dx < fp + 2; dx++) if (this.streets.has((cz + dz) * MAP_SIZE + cx + dx)) return false;
    return true;
  }

  /** Send a builder to construct `type` at a chosen spot. */
  buildAt(type, spot, peasants) {
    const g = this.g;
    const p = this.p;
    const builder =
      peasants.find((u) => u.harvest?.kind === 'lumber' && !u.carry && u.order.type === 'harvest') ??
      peasants.find((u) => u.order.type === 'idle') ??
      peasants.find((u) => !u.harvest?.inside && u.order.type !== 'build' && u.order.type !== 'construct');
    if (!builder || !g.spend(p, UNITS[type].cost)) return false;
    const resume = builder.harvest?.kind ? { type: 'harvest', target: builder.harvest.kind === 'gold' ? builder.harvest.mine : builder.harvest.tree } : null;
    g.issueOrder(builder, { type: 'build', building: type, x: spot.x, z: spot.z, paid: true });
    if (resume?.target) builder.orderQueue.push(resume);
    return true;
  }

  count(type, includeUnfinished = true) {
    return this.p.buildings.filter((b) => !b.dead && (b.type === type || (type === 'townhall' && b.def.tier)) && (includeUnfinished || !b.underConstruction)).length;
  }

  construction(hall, peasants) {
    const g = this.g;
    const p = this.p;
    const t = g.time;
    this.reserve = null;
    this.ageReady = false;
    const plan = [
      { type: 'lumberyard', n: 1, at: 25 },
      { type: 'farm', n: 1, at: 35 },
      { type: 'barracks', n: 1, at: 60 },
      { age: 2, at: 150 },
      { type: 'stable', n: 1, at: 190 },
      { type: 'blacksmith', n: 1, at: 230 },
      { type: 'scouttower', n: 1, at: 260 },
      { age: 3, at: 300 },
      { type: 'workshop', n: 1, at: 340 },
      { type: 'barracks', n: 2, at: 380 },
      { type: 'sanctum', n: 1, at: 420 },
      { age: 4, at: 460 },
      { age: 5, at: 620 },
      { type: 'scouttower', n: 2, at: 660 },
      { age: 6, at: 800 },
      { type: 'factory', n: 1, at: 820 },
      { age: 7, at: 980 },
      { type: 'missile_silo', n: 1, at: 1020 },
      { type: 'factory', n: 2, at: 1150 },
      { age: 8, at: 1200 },
      { type: 'barracks', n: 3, at: 1300 },
    ];
    for (const step of plan) {
      if (t < step.at) continue;
      if (step.age) {
        if (!hall || p.tier >= step.age) continue;
        if (p.buildings.some((b) => !b.dead && b.upgrading?.age)) return;
        if (step.age > p.tier + 1) continue;
        if (g.empires.ageMissing(p).length) continue;
        const cost = AGES[step.age].cost;
        this.ageReady = g.canAfford(p, cost);
        if (this.ageReady && hall.trainQueue.length === 0 && !hall.upgrading) {
          g.empires.startAgeUp(hall);
          this.ageReady = false;
          return;
        }
        this.reserve = cost; // save up for the next age
        return;
      }
      if (!peasants.length) continue; // ages can still be researched without workers
      const have = p.buildings.filter((b) => !b.dead && (b.type === step.type || (step.type === 'scouttower' && b.type === 'guardtower'))).length + (this.pendingBuild(step.type) ? 1 : 0);
      if (have >= step.n) continue;
      if (g.missingRequirements(p, UNITS[step.type]).length) continue;
      if (!g.canAfford(p, UNITS[step.type].cost)) {
        this.reserve = UNITS[step.type].cost; // save up
        return;
      }
      let started;
      if (step.type === 'lumberyard') {
        const spot = this.lumberYardSpot(hall);
        started = spot ? this.buildAt('lumberyard', spot, peasants) : this.build(step.type, peasants, hall);
      } else started = this.build(step.type, peasants, hall);
      if (started) return;
      // No room or no free worker: move on rather than stall the whole plan.
    }
    // Another Lumber Yard when the woods have receded from every drop-off.
    if (t > 300 && !this.pendingBuild('lumberyard') && g.canAfford(p, UNITS.lumberyard.cost) && p.gold > 300) {
      const drops = p.buildings.filter((b) => !b.dead && b.def.dropOff);
      const yards = drops.filter((b) => b.def.dropOff === 'lumber').length;
      const near = drops.some((b) => {
        const tr = findNearestTree(g, b.x, b.z, 12);
        return tr && Math.hypot(tr.x - b.x, tr.z - b.z) < 12;
      });
      if (!near && yards < 3) {
        const spot = this.lumberYardSpot(hall);
        if (spot) this.buildAt('lumberyard', spot, peasants);
      }
    }
    // Upgrade scout towers once allowed.
    for (const b of p.buildings) {
      if (b.type === 'scouttower' && !b.dead && !b.underConstruction && !b.upgrading && g.canAfford(p, UNITS.guardtower.cost) && !g.missingRequirements(p, UNITS.guardtower).length) {
        g.startUpgrade(b);
      }
    }
  }

  pendingBuild(type) {
    return this.p.units.some((u) => !u.dead && u.order.type === 'build' && u.order.building === type);
  }

  findSpot(type, hall) {
    const g = this.g;
    const fp = UNITS[type].footprint;
    const mine = this.mainMine(hall);
    const [tcx, tcz] = this.p.base.toCenter;
    const tries = [];
    for (let r = 5; r <= 34; r += 1) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + r * 0.37;
        tries.push({ x: hall.x + Math.cos(a) * r, z: hall.z + Math.sin(a) * r, r });
      }
    }
    // Towers go toward the center.
    if (type === 'scouttower') {
      tries.unshift(
        { x: hall.x + tcx * 8 + tcz * 3, z: hall.z + tcz * 8 - tcx * 3 },
        { x: hall.x + tcx * 8 - tcz * 3, z: hall.z + tcz * 8 + tcx * 3 },
      );
    }
    for (const relaxed of [false, true]) for (const s of tries) {
      const x = g.snap(s.x, fp);
      const z = g.snap(s.z, fp);
      if (!g.canPlace(type, x, z)) continue;
      // Leave a margin around buildings so we never wall ourselves in.
      const cx = Math.round(x - fp / 2) - 1;
      const cz = Math.round(z - fp / 2) - 1;
      if (!g.grid.rectFree(cx, cz, fp + 2, fp + 2)) continue;
      if (mine && distToSegment(x, z, hall.x, hall.z, mine.x, mine.z) < fp / 2 + 2.5) continue;
      if (!relaxed && !this.offStreets(x, z, fp)) continue;
      return { x, z };
    }
    return null;
  }

  build(type, peasants, hall = null) {
    const g = this.g;
    const p = this.p;
    if (!g.canAfford(p, UNITS[type].cost)) return false;
    const center = hall ?? peasants[0];
    const spot = this.findSpot(type, center);
    if (!spot) return false;
    const builder =
      peasants.find((u) => u.harvest?.kind === 'lumber' && !u.carry) ??
      peasants.find((u) => u.order.type === 'idle') ??
      peasants.find((u) => !u.harvest?.inside && u.order.type !== 'build' && u.order.type !== 'construct');
    if (!builder) return false;
    if (!g.spend(p, UNITS[type].cost)) return false;
    g.issueOrder(builder, { type: 'build', building: type, x: spot.x, z: spot.z, paid: true });
    // Go back to work afterwards.
    if (builder.harvest?.kind) builder.orderQueue.push({ type: 'harvest', target: builder.harvest.kind === 'gold' ? builder.harvest.mine : builder.harvest.tree });
    return true;
  }

  production() {
    const g = this.g;
    const p = this.p;
    const army = this.army();
    const food = this.armyFood(army);
    const counts = {};
    for (const u of army) counts[u.type] = (counts[u.type] || 0) + 1;
    const unlocked = (t) => !g.missingRequirements(p, UNITS[t]).length;
    // The newest units this building offers (current and previous age), best first;
    // pick among the top two for variety, preferring whichever we have fewer of.
    const choose = (b) => {
      const ok = (b.def.trains ?? [])
        .filter((t) => t !== 'peasant' && unlocked(t) && (UNITS[t].age ?? 1) >= p.tier - 1)
        .sort((a, c) => (UNITS[c].age ?? 1) - (UNITS[a].age ?? 1) || UNITS[c].cost.gold - UNITS[a].cost.gold);
      if (!ok.length) return null;
      const top = ok.slice(0, 2);
      top.sort((a, c) => (counts[a] || 0) - (counts[c] || 0));
      return top[0];
    };
    // Feed the people before the army (unless the town is under attack).
    const holdTroops = this.hungry && g.time > this.defendUntil && food >= 8;
    for (const b of p.buildings) {
      if (b.dead || b.underConstruction || b.trainQueue.length >= 2 || b.upgrading) continue;
      let pick = null;
      if (holdTroops && b.def.trains) continue;
      if (b.type === 'barracks' || b.type === 'stable' || b.type === 'factory') pick = choose(b);
      else if (b.type === 'sanctum') {
        pick = choose(b);
        if (pick && (counts[pick] || 0) >= 1 + Math.floor(food / 14)) pick = null;
      } else if (b.type === 'workshop') {
        pick = choose(b);
        if (pick && (counts[pick] || 0) >= 2) pick = null;
      } else if (b.type === 'blacksmith' && !b.researching) {
        const upg = p.upgrades.weapons <= p.upgrades.armor ? 'weapons' : 'armor';
        const lvl = p.upgrades[upg];
        if (lvl < UPGRADES[upg].levels && food >= 10 && p.tier >= UPGRADES[upg].tier[lvl] && g.canAfford(p, UPGRADES[upg].cost[lvl]) && p.lumber > 200) g.startResearch(b, upg);
      } else if (b.def.dropOff === 'lumber' && !b.researching) {
        const lvl = p.upgrades.lumber;
        if (lvl < 2 && p.tier >= UPGRADES.lumber.tier[lvl] && p.gold > UPGRADES.lumber.cost[lvl].gold + 250) g.startResearch(b, 'lumber');
      }
      if (!pick || !g.canAfford(p, UNITS[pick].cost)) continue;
      // Keep money aside for the next age or building, unless the army is tiny or we are under attack.
      const r = this.reserve;
      const c = UNITS[pick].cost;
      const keep = r && food >= 8 && g.time > this.defendUntil && (p.gold - (c.gold || 0) < (r.gold || 0) || p.lumber - (c.lumber || 0) < (r.lumber || 0));
      if (!keep) g.trainUnit(b, pick);
    }
  }

  militaryEmpire() {
    const g = this.g;
    const army = this.army();
    const food = this.armyFood(army);
    const h = this.home();
    const [tcx, tcz] = this.p.base.toCenter;
    const rally = { x: h.x + tcx * 9, z: h.z + tcz * 9 };

    // Defense takes priority.
    if (g.time < this.defendUntil && this.defendPos) {
      for (const u of army) {
        if (u.order.type !== 'attackMove' || Math.hypot(u.order.point.x - this.defendPos.x, u.order.point.z - this.defendPos.z) > 3) {
          if (u.order.type !== 'attack') g.issueOrder(u, { type: 'attackMove', point: this.defendPos });
        }
      }
      this.state = 'defend';
      this.status = `Defending its base (${army.length} units)`;
      return;
    }
    if (this.state === 'defend' || this.state === 'assist') this.state = 'gather';

    // Break off an attack to defend an ally, or to join an assault instead of clearing creeps.
    const call = this.allyCall();
    if (this.state === 'attack' && call && call.kind !== 'skirmish' && this.target && (call.kind === 'defend' || !this.target.player)) {
      if ((call.kind === 'defend' && food >= 8) || (call.kind === 'assault' && food >= 20)) this.state = 'gather';
    }

    if (this.state === 'attack') {
      if (food < this.armyStart * 0.35 || !this.target) {
        this.state = 'gather';
        this.status = 'Retreating to regroup';
        for (const u of army) g.issueOrder(u, { type: 'move', point: rally });
        return;
      }
      this.status = `${this.target.label} (${army.length} units)`;
      // Re-target when the objective is gone.
      const tgt = this.target;
      for (const u of army) {
        if (u.order.type === 'idle') {
          const next = this.attackObjective(true);
          if (next) {
            if (next.label !== this.target.label) this.announceAttack(next, army.length);
            this.target = next;
            g.issueOrder(u, { type: 'attackMove', point: next });
          }
        } else if (u.order.type === 'move' && !u.moving) g.issueOrder(u, { type: 'attackMove', point: tgt });
      }
      return;
    }

    // Answer an ally's call for help.
    if (call && call.kind !== 'skirmish' && ((call.kind === 'defend' && food >= 8) || (call.kind === 'assault' && food >= 20))) {
      this.state = 'assist';
      this.status = `${this.callLabel(call)} (${army.length} units)`;
      for (const u of army) {
        if (u.order.type === 'attack') continue;
        if (u.order.type !== 'attackMove' || Math.hypot(u.order.point.x - call.x, u.order.point.z - call.z) > 6) {
          g.issueOrder(u, { type: 'attackMove', point: { x: call.x, z: call.z } });
        }
      }
      return;
    }

    // Gather near the base.
    for (const u of army) {
      if (u.order.type === 'idle' && Math.hypot(u.x - rally.x, u.z - rally.z) > 6) g.issueOrder(u, { type: 'attackMove', point: rally });
    }
    const threshold = Math.round(Math.min(44, 14 + this.attacks * 6) * [1.15, 1, 0.9][g.difficulty]);
    this.status = `Building an army (${food}/${threshold} food)`;
    if (food >= threshold || (this.expansionGuard && food >= 16)) {
      const obj = this.attackObjective(false);
      if (!obj) return;
      this.state = 'attack';
      this.target = obj;
      this.armyStart = food;
      this.attacks++;
      this.status = `${obj.label} (${army.length} units)`;
      for (const u of army) g.issueOrder(u, { type: 'attackMove', point: { x: obj.x, z: obj.z } });
      this.announceAttack(obj, army.length);
    }
  }

  announceAttack(obj, count) {
    const g = this.g;
    const p = this.p;
    if (obj.player?.isHuman) {
      g.message(`${p.name}'s army (${count} units) is marching on your base!`, g.nameColor(p));
      g.sound('warning');
      g.ping(obj.x, obj.z, g.nameColor(p));
    } else if (obj.player) {
      g.notify(p, `${p.name}'s army marches on ${obj.player.name}.`);
    } else if (obj.kalenden) {
      g.notify(p, `${p.name}'s army marches on Kalenden's citadel!`);
    }
  }

  attackObjective(continuing) {
    const g = this.g;
    const food = this.armyFood();
    if (this.expansionGuard && food >= 16) return { ...this.expansionGuard, label: 'Clearing a gold mine to expand' };
    const k = g.legionMgr.kalenden;
    const teamPlay = this.hasAllies();
    const late = g.time > 26 * 60 || (teamPlay && g.time > 16 * 60);
    if (!k.dead && late && food >= (teamPlay ? 30 : 40)) return { x: k.x, z: k.z, label: 'Assaulting Kalenden', kalenden: true };
    // Rival bases are only raided after a grace period that depends on difficulty.
    if (this.raidsAllowed()) {
      const base = this.nearestEnemyBase();
      if (base && (this.attacks >= 2 || continuing)) {
        const near = base.player.buildings.filter((b) => !b.dead).sort((a, b) => Math.hypot(a.x - base.x, a.z - base.z) - Math.hypot(b.x - base.x, b.z - base.z))[0];
        const label = `Attacking ${base.player.isHuman ? 'you' : base.player.name}`;
        return near ? { x: near.x, z: near.z, label, player: base.player } : { ...base, label };
      }
    }
    // Early: clear nearby creep camps for bounty.
    const h = this.home();
    const camps = g.creepMgr
      .aliveCamps()
      .filter((c) => c.tier <= (this.attacks >= 3 ? 3 : 2))
      .sort((a, b) => Math.hypot(a.at.x - h.x, a.at.z - h.z) - Math.hypot(b.at.x - h.x, b.at.z - h.z));
    if (camps[0]) return { ...camps[0].at, label: 'Clearing creep camps' };
    if (!k.dead && food >= 34) return { x: CENTER, z: CENTER + CITADEL.half - 3, label: 'Assaulting Kalenden', kalenden: true };
    return null;
  }
}
