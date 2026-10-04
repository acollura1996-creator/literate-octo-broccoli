// Computer-controlled rival generals. Each plays either the Hero path
// (level up on creeps, buy items, hire mercenaries, raid and hunt Kalenden)
// or the Empire path (gather, build a base, train an army and attack).
import { UNITS, UPGRADES } from '../data/units.js';
import { ITEMS } from '../data/items.js';
import { ABILITIES } from '../game/abilities.js';
import { canCast, findNearestTree } from '../game/behavior.js';
import { CENTER, CITADEL } from '../world/layout.js';
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
      const d = Math.hypot(b.x - h.x, b.z - h.z);
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
        this.retreat(h);
        return;
      }
    } else if (hpR < 0.3) {
      this.state = 'retreat';
      if (!this.useItemOfType(h, 'townPortal')) this.retreat(h);
      return;
    }

    // Fight whatever is close.
    const foes = this.enemiesNear(h.x, h.z, 9);
    if (foes.length) {
      this.heroCombat(h, foes);
      for (const m of mercs) {
        if (m.order.type === 'idle' || m.order.type === 'follow') g.issueOrder(m, { type: 'attackMove', point: { x: h.x, z: h.z } });
      }
      return;
    }

    // Defend home (portal back if far away).
    if (g.time < this.defendUntil && this.defendPos) {
      if (h.distTo(this.defendPos) > 35 && this.useItemOfType(h, 'townPortal')) return;
      this.go(h, this.defendPos, true);
      this.rallyMercs(mercs, h);
      return;
    }

    // Shopping.
    if (this.shop(h)) return;

    // Hire mercenaries with spare gold.
    this.hireMercs(h);

    // Objective: creep, raid, or hunt Kalenden.
    if (h.order.type === 'attackMove' && g.time - this.lastObjective < 25) {
      this.rallyMercs(mercs, h);
      return;
    }
    const obj = this.heroObjective(h, mercs);
    if (obj) {
      this.lastObjective = g.time;
      this.go(h, obj, true);
    }
    this.rallyMercs(mercs, h);
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

  heroObjective(h, mercs) {
    const g = this.g;
    const power = this.heroPower(h, mercs);
    // Endgame: go for Kalenden.
    const k = g.legionMgr.kalenden;
    const ready = h.level >= 10 || (h.level >= 9 && mercs.length >= 2) || (g.allied && h.level >= 8 && g.time > 16 * 60) || g.time > 45 * 60;
    if (!k.dead && ready && h.hp > h.maxHp * 0.8) {
      return { x: k.x, z: k.z };
    }
    // Occasionally raid a rival.
    if (!g.allied && h.level >= 6 && Math.random() < 0.18) {
      const base = this.nearestEnemyBase();
      if (base) return base;
    }
    // Creep the best camp we can handle.
    let best = null;
    let bestScore = Infinity;
    for (const c of g.creepMgr.aliveCamps()) {
      if (c.power > power * 1.15) continue;
      const d = Math.hypot(c.at.x - h.x, c.at.z - h.z);
      const score = d - c.power * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) return best.at;
    // Nothing to do: go to the closest fountain or home.
    const base = this.nearestEnemyBase();
    if (base && h.level >= 5 && !g.allied) return base;
    return this.home();
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

  hireMercs(h) {
    const g = this.g;
    const p = this.p;
    if (p.gold < 650) return;
    g.computeFood(p);
    const free = p.foodCap - p.foodUsed;
    if (free < 2) return;
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
    if (!camp || bd > 30) return;
    const pick = ['rock_golem', 'ogre', 'forest_troll', 'gnoll'].find(
      (t) => UNITS[t].food <= free && camp.stock[t] > 0 && p.gold >= UNITS[t].cost.gold + 300,
    );
    if (!pick) return;
    if (h.distTo(camp) > camp.radius + 6) {
      this.go(h, camp, false);
      return;
    }
    g.hireMerc(p, camp, pick);
  }

  // =============================================================== EMPIRE
  thinkEmpire() {
    const g = this.g;
    const p = this.p;
    const halls = p.buildings.filter((b) => !b.dead && b.def.dropOff && !b.underConstruction);
    const hall = halls.find((h) => this.mainMine(h)?.goldLeft > 0) ?? halls[0];
    const peasants = p.units.filter((u) => !u.dead && u.type === 'peasant');
    if (!hall && !p.buildings.some((b) => !b.dead && b.def.dropOff)) {
      // Lost the town hall: rebuild if possible.
      if (peasants.length && g.canAfford(p, UNITS.townhall.cost)) this.build('townhall', peasants);
      this.militaryEmpire();
      return;
    }
    if (hall) this.economy(hall, peasants);
    if (hall) this.expand(hall, peasants);
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
    if (p.buildings.some((b) => !b.dead && b.def.dropOff && b.underConstruction) || this.pendingBuild('townhall')) return;
    const halls = p.buildings.filter((b) => !b.dead && b.def.dropOff);
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
    const woodTarget = p.lumber > 1200 ? 1 : p.lumber > 600 ? 3 : g.time > 360 ? 5 : 4;
    for (const u of idle) {
      if (mine && onGold.length < 5) {
        g.issueOrder(u, { type: 'harvest', target: mine });
        onGold.push(u);
      } else {
        const tree = findNearestTree(g, hall.x, hall.z, 24);
        if (tree) {
          g.issueOrder(u, { type: 'harvest', target: tree });
          onWood.push(u);
        }
      }
    }
    // Too much lumber banked: move a woodcutter back to gold.
    if (onWood.length > woodTarget && mine && onGold.length < 6) {
      const u = onWood.find((x) => !x.carry);
      if (u) g.issueOrder(u, { type: 'harvest', target: mine });
    }
    // Rebalance: too many on gold → move one to wood.
    if (onGold.length > 6) {
      const u = onGold.find((x) => !x.harvest?.inside && !x.carry);
      const tree = findNearestTree(g, hall.x, hall.z, 24);
      if (u && tree) g.issueOrder(u, { type: 'harvest', target: tree });
    }
    const wanted = (mine ? 5 : 0) + woodTarget + 1;
    if (peasants.length < Math.min(wanted, 13) && hall.trainQueue.length === 0 && !hall.upgrading) g.trainUnit(hall, 'peasant');
  }

  count(type, includeUnfinished = true) {
    return this.p.buildings.filter((b) => !b.dead && (b.type === type || (type === 'townhall' && b.def.tier)) && (includeUnfinished || !b.underConstruction)).length;
  }

  construction(hall, peasants) {
    const g = this.g;
    const p = this.p;
    if (!peasants.length) return;
    const t = g.time;
    // Supply
    g.computeFood(p);
    const farmsBuilding = p.buildings.some((b) => !b.dead && b.type === 'farm' && b.underConstruction) || this.pendingBuild('farm');
    if (p.foodCap < 100 && p.foodCap - p.foodUsed <= 5 && !farmsBuilding) {
      if (this.build('farm', peasants, hall)) return;
    }
    const plan = [
      { type: 'barracks', n: 1, at: 25 },
      { type: 'blacksmith', n: 1, at: 150 },
      { upgrade: 'keep', at: 260 },
      { type: 'scouttower', n: 1, at: 200 },
      { type: 'barracks', n: 2, at: 330 },
      { type: 'sanctum', n: 1, at: 400 },
      { type: 'scouttower', n: 2, at: 420 },
      { type: 'workshop', n: 1, at: 600 },
      { upgrade: 'castle', at: 840 },
      { type: 'barracks', n: 3, at: 900 },
    ];
    for (const step of plan) {
      if (t < step.at) continue;
      if (step.upgrade) {
        if (!hall) continue;
        const want = step.upgrade;
        const have = want === 'keep' ? p.tier >= 2 : p.tier >= 3;
        if (have || hall.upgrading) continue;
        if (hall.def.upgradesTo === want && g.canAfford(p, UNITS[want].cost) && hall.trainQueue.length === 0) {
          g.startUpgrade(hall);
          return;
        }
        if (hall.def.upgradesTo === want) return; // save up for it
        continue;
      }
      const have = p.buildings.filter((b) => !b.dead && (b.type === step.type || (step.type === 'scouttower' && b.type === 'guardtower'))).length + (this.pendingBuild(step.type) ? 1 : 0);
      if (have >= step.n) continue;
      if (g.missingRequirements(p, UNITS[step.type]).length) continue;
      if (!g.canAfford(p, UNITS[step.type].cost)) return; // save up
      this.build(step.type, peasants, hall);
      return;
    }
    // Upgrade scout towers.
    for (const b of p.buildings) {
      if (b.type === 'scouttower' && !b.dead && !b.underConstruction && !b.upgrading && g.canAfford(p, UNITS.guardtower.cost)) {
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
    for (let r = 5; r <= 16; r += 1) {
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
    for (const s of tries) {
      const x = g.snap(s.x, fp);
      const z = g.snap(s.z, fp);
      if (!g.canPlace(type, x, z)) continue;
      // Leave a margin around buildings so we never wall ourselves in.
      const cx = Math.round(x - fp / 2) - 1;
      const cz = Math.round(z - fp / 2) - 1;
      if (!g.grid.rectFree(cx, cz, fp + 2, fp + 2)) continue;
      if (mine && distToSegment(x, z, hall.x, hall.z, mine.x, mine.z) < fp / 2 + 2.5) continue;
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
    for (const b of p.buildings) {
      if (b.dead || b.underConstruction || b.trainQueue.length >= 2) continue;
      if (b.type === 'barracks') {
        let pick = (counts.footman || 0) <= (counts.archer || 0) ? 'footman' : 'archer';
        if (!g.missingRequirements(p, UNITS.knight).length && Math.random() < 0.4) pick = 'knight';
        if (g.canAfford(p, UNITS[pick].cost)) g.trainUnit(b, pick);
      } else if (b.type === 'sanctum') {
        const pick = (counts.priest || 0) <= (counts.sorceress || 0) ? 'priest' : 'sorceress';
        if ((counts[pick] || 0) < 1 + Math.floor(food / 14) && g.canAfford(p, UNITS[pick].cost)) g.trainUnit(b, pick);
      } else if (b.type === 'workshop') {
        if ((counts.catapult || 0) < 2 && g.canAfford(p, UNITS.catapult.cost)) g.trainUnit(b, 'catapult');
      } else if (b.type === 'blacksmith' && !b.researching) {
        const upg = p.upgrades.weapons <= p.upgrades.armor ? 'weapons' : 'armor';
        const lvl = p.upgrades[upg];
        if (lvl < 3 && food >= 10 && g.canAfford(p, UPGRADES[upg].cost[lvl]) && p.lumber > 200) g.startResearch(b, upg);
      }
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
      return;
    }
    if (this.state === 'defend') this.state = 'gather';

    if (this.state === 'attack') {
      if (food < this.armyStart * 0.35 || !this.target) {
        this.state = 'gather';
        for (const u of army) g.issueOrder(u, { type: 'move', point: rally });
        return;
      }
      // Re-target when the objective is gone.
      const tgt = this.target;
      for (const u of army) {
        if (u.order.type === 'idle') {
          const next = this.attackObjective(true);
          if (next) {
            this.target = next;
            g.issueOrder(u, { type: 'attackMove', point: next });
          }
        } else if (u.order.type === 'move' && !u.moving) g.issueOrder(u, { type: 'attackMove', point: tgt });
      }
      return;
    }

    // Gather near the base.
    for (const u of army) {
      if (u.order.type === 'idle' && Math.hypot(u.x - rally.x, u.z - rally.z) > 6) g.issueOrder(u, { type: 'attackMove', point: rally });
    }
    const threshold = Math.min(44, 14 + this.attacks * 6) * [1.15, 1, 0.9][g.difficulty];
    if (food >= threshold || (this.expansionGuard && food >= 16)) {
      const obj = this.attackObjective(false);
      if (!obj) return;
      this.state = 'attack';
      this.target = obj;
      this.armyStart = food;
      this.attacks++;
      for (const u of army) g.issueOrder(u, { type: 'attackMove', point: obj });
    }
  }

  attackObjective(continuing) {
    const g = this.g;
    const food = this.armyFood();
    if (this.expansionGuard && food >= 16) return this.expansionGuard;
    const k = g.legionMgr.kalenden;
    const late = g.time > 26 * 60 || (g.allied && g.time > 16 * 60);
    if (!k.dead && late && food >= (g.allied ? 30 : 40)) return { x: k.x, z: k.z };
    if (!g.allied) {
      const base = this.nearestEnemyBase();
      if (base && (this.attacks >= 2 || continuing)) {
        const near = base.player.buildings.filter((b) => !b.dead).sort((a, b) => Math.hypot(a.x - base.x, a.z - base.z) - Math.hypot(b.x - base.x, b.z - base.z))[0];
        return near ? { x: near.x, z: near.z } : base;
      }
    }
    // Early: clear nearby creep camps for bounty.
    const h = this.home();
    const camps = g.creepMgr
      .aliveCamps()
      .filter((c) => c.tier <= (this.attacks >= 3 ? 3 : 2))
      .sort((a, b) => Math.hypot(a.at.x - h.x, a.at.z - h.z) - Math.hypot(b.at.x - h.x, b.at.z - h.z));
    if (camps[0]) return camps[0].at;
    if (!k.dead && food >= 34) return { x: CENTER, z: CENTER + CITADEL.half - 3 };
    return null;
  }
}
