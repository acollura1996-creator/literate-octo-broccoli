// Empire systems from the original map: citizens who pay taxes and eat rations, their happiness
// (from Love down to Hate, when they riot), advancing through the ages at the town center,
// hiring Heroes, and nuclear missiles.
import { UNITS, AGES, MAX_AGE, AGE_NAMES, ECONOMY } from '../data/units.js';
import { findNearestTree } from './behavior.js';

export function moodOf(h) {
  return ECONOMY.moods.find((m) => h >= m.min) ?? ECONOMY.moods[ECONOMY.moods.length - 1];
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Empires {
  constructor(game) {
    this.game = game;
    this.timer = 0;
    this.nukes = [];
    this.offers = [];
  }

  init(p) {
    p.food = 150;
    p.citizens = 5;
    p.housing = 5;
    p.tax = 3;
    p.rations = 10;
    p.happiness = 60;
    p.happinessTarget = 60;
    p.unrest = 0;
    p.riotTimer = 60;
    p.foodRate = 0;
    p.foodProduced = 0;
    p.foodEaten = 0;
    p.taxRate = 0;
    p.starving = false;
    p.stats.taxCollected = 0;
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const g = this.game;
    this.timer += dt;
    while (this.timer >= 0.5) {
      this.timer -= 0.5;
      for (const p of g.generals) {
        if (p.defeated) continue;
        if (p.mode === 'empire') this.economy(p, 0.5);
        if (p.hiredBy && (g.time >= p.contractEnds || p.hiredBy.defeated)) this.endContract(p);
      }
      this.offers = this.offers.filter((o) => {
        if (g.time < o.expires && !o.to.hiredBy && !o.from.defeated) return true;
        g.hooks.onOffersChanged?.();
        return false;
      });
      this.silos(0.5);
    }
    this.updateNukes(dt);
  }

  housesOf(p) {
    return p.buildings.filter((b) => !b.dead && b.def.needsRoad && !b.underConstruction);
  }

  economy(p, dt) {
    const g = this.game;
    // Food: farms grow it, citizens eat their rations.
    let produced = 0;
    for (const b of p.buildings) {
      if (b.dead || b.underConstruction || !b.def.foodRateByAge) continue;
      produced += b.def.foodRateByAge[b.ageLevel - 1];
    }
    produced *= g.events?.harvestMult(p) ?? 1;
    const eaten = p.citizens * p.rations * ECONOMY.foodPerRation;
    p.foodProduced = produced;
    p.foodEaten = eaten;
    p.foodRate = produced - eaten;
    p.food += p.foodRate * dt;
    const wasStarving = p.starving;
    p.starving = p.food <= 0 && eaten > produced;
    if (p.food < 0) p.food = 0;
    if (p.starving && !wasStarving && p.isHuman) {
      g.message('Your people are starving! Build Farms or lower their rations — no taxes are paid while they starve.', '#ff6b6b');
      g.sound('error');
    }

    // Happiness: rations, taxes, roads, hunger and recent troubles.
    const houses = this.housesOf(p).filter((b) => b.roadConnected).length;
    const roads = g.roads.countOf(p);
    const roadBonus = clamp((roads / Math.max(3, houses)) * 3 - 6, -6, 18);
    let target = 55 + (p.rations - 10) * 3 - (p.tax - 3) * 7 + roadBonus - p.unrest;
    if (p.starving) target -= 35;
    if (p.citizens > p.housing + 0.5) target -= 10;
    // Big cities are harder to keep content (roads help).
    p.crowding = Math.min(15, Math.max(0, (p.citizens - 80) / 25));
    target -= p.crowding;
    p.roadBonus = roadBonus;
    p.happinessTarget = clamp(target, 0, 100);
    const rate = p.starving ? 4 : 2;
    const before = moodOf(p.happiness);
    p.happiness += clamp(p.happinessTarget - p.happiness, -rate * dt, rate * dt);
    const mood = moodOf(p.happiness);
    if (mood !== before && p.isHuman) {
      const worse = ECONOMY.moods.indexOf(mood) > ECONOMY.moods.indexOf(before);
      g.message(`Your people's mood: ${mood.icon} ${mood.name}.${mood.name === 'Hate' ? ' They pay no taxes and will riot!' : mood.name === 'Unhappy' ? ' Riots may break out.' : ''}`, worse ? '#ffae5a' : '#9fe89f');
    }
    p.unrest = Math.max(0, p.unrest - dt * 0.25);

    // Citizens move into free homes while the people are content, and leave when they starve.
    if (p.starving) p.citizens = Math.max(0, p.citizens - Math.max(0.15, p.citizens * 0.01) * dt);
    else if (p.citizens < p.housing && mood.growth > 0) {
      p.citizens = Math.min(p.housing, p.citizens + (0.2 + 0.012 * p.citizens) * mood.growth * dt);
    }
    if (p.citizens > p.housing) p.citizens = Math.max(p.housing, p.citizens - 0.5 * dt);
    if (mood.name === 'Hate') p.citizens = Math.max(0, p.citizens - 0.08 * dt);

    // Taxes: no income while the people starve or hate you.
    const mult = p.starving ? 0 : mood.income * (g.events?.incomeMult(p) ?? 1) * (p.isHuman ? 1 : p.handicap ?? 1);
    p.taxRate = p.citizens * p.tax * ECONOMY.taxPerCitizen * mult;
    const gold = p.taxRate * dt;
    p.gold += gold;
    p.stats.taxCollected += gold;

    // Riots when the people are unhappy.
    if (mood.name === 'Unhappy' || mood.name === 'Hate') {
      p.riotTimer -= dt;
      if (p.riotTimer <= 0) {
        p.riotTimer = mood.name === 'Hate' ? 30 : 75;
        if (mood.name === 'Hate' || Math.random() < 0.5) this.riot(p);
      }
    } else p.riotTimer = Math.max(p.riotTimer, 40);
  }

  /** Infantry type of an age (used for rebels and as a sensible default). */
  footSoldier(age) {
    const list = UNITS.barracks.trains.filter((t) => UNITS[t].age === age);
    return list[0] ?? 'caveman';
  }

  riot(p) {
    const g = this.game;
    if (p.citizens < 4) return;
    const homes = this.housesOf(p);
    const at = homes.length ? homes[Math.floor(Math.random() * homes.length)] : p.buildings.find((b) => !b.dead && b.def.tier);
    if (!at) return;
    const n = Math.min(6, 1 + Math.floor(p.citizens / 25));
    const type = this.footSoldier(Math.max(1, p.tier));
    const hall = p.buildings.find((b) => !b.dead && b.def.tier) ?? at;
    for (let i = 0; i < n; i++) {
      const pos = g.grid.nearestWalkable(at.x + (Math.random() - 0.5) * 3, at.z + (Math.random() - 0.5) * 3, 6);
      if (!pos) continue;
      const u = g.spawnUnit(type, g.creeps, pos.x, pos.z);
      u.rebel = true;
      g.issueOrder(u, { type: 'attackMove', point: { x: hall.x, z: hall.z } });
    }
    p.citizens = Math.max(0, p.citizens - n);
    if (p.isHuman) {
      g.message(`Riot! ${n} angry citizens have taken up arms. Lower taxes, raise rations or build roads to calm your people.`, '#ff6b6b');
      g.ping(at.x, at.z, '#ff4040');
      g.sound('error');
    } else g.notify(p, `Riots have broken out in ${p.name}'s empire.`);
  }

  // ------------------------------------------------------------ settings
  setTax(p, v) {
    p.tax = clamp(Math.round(v), 0, ECONOMY.taxMax);
  }
  setRations(p, v) {
    p.rations = clamp(Math.round(v), 0, ECONOMY.rationsMax);
  }

  // ---------------------------------------------------------------- ages
  nextAge(p) {
    return p.tier < MAX_AGE ? AGES[p.tier + 1] : null;
  }
  ageMissing(p) {
    const a = this.nextAge(p);
    if (!a) return [];
    return (a.requires ?? []).filter((r) => !this.game.hasRequirement(p, r));
  }
  /** Begin researching the next age at a town center. */
  startAgeUp(b) {
    const g = this.game;
    const p = b.owner;
    const a = this.nextAge(p);
    if (!a || b.upgrading || b.underConstruction || b.trainQueue.length) return false;
    if (p.buildings.some((o) => !o.dead && o.upgrading?.age)) return false;
    const missing = this.ageMissing(p);
    if (missing.length) {
      if (p.isHuman) g.message(`Requires: ${missing.map((m) => g.requirementName(m)).join(', ')}.`, '#ff8080');
      return false;
    }
    if (!g.spend(p, a.cost)) return false;
    b.upgrading = { age: p.tier + 1, time: 0, total: a.time * (p.isHuman ? 1 : [1.15, 1, 0.9][g.difficulty]) };
    return true;
  }

  // ---------------------------------------------------------------- hiring
  hireFee(hg) {
    return Math.round(ECONOMY.hireFee(hg.hero?.level ?? 1));
  }
  canHire(emp, hg) {
    return (
      hg && hg !== emp && hg.mode === 'hero' && !hg.defeated && !hg.hiredBy && hg.hero && !hg.hero.dead &&
      hg.team !== emp.team && !emp.defeated
    );
  }
  heroesForHire(emp) {
    return this.game.generals.filter((hg) => this.canHire(emp, hg));
  }
  /** An empire asks a Hero to fight for it. AI Heroes take the gold; the player is asked. */
  hire(emp, hg) {
    const g = this.game;
    if (!this.canHire(emp, hg)) return false;
    const fee = this.hireFee(hg);
    if (!g.canAfford(emp, { gold: fee, lumber: 0 })) {
      if (emp.isHuman) {
        g.message('Not enough gold.', '#ff8080');
        g.sound('error');
      }
      return false;
    }
    if (hg.isHuman) {
      if (this.offers.some((o) => o.from === emp)) return false;
      this.offers.push({ from: emp, to: hg, fee, expires: g.time + 30 });
      g.message(`${emp.name} offers you ${fee} gold to fight for them for ${ECONOMY.hireTime / 60} minutes.`, g.nameColor(emp));
      g.sound('horn');
      g.hooks.onOffersChanged?.();
      return true;
    }
    this.startContract(emp, hg, fee);
    return true;
  }
  acceptOffer(o) {
    this.offers = this.offers.filter((x) => x !== o);
    this.game.hooks.onOffersChanged?.();
    if (!this.canHire(o.from, o.to) || o.from.gold < o.fee) {
      this.game.message('The offer is no longer available.', '#ff8080');
      return;
    }
    this.startContract(o.from, o.to, o.fee);
  }
  declineOffer(o) {
    this.offers = this.offers.filter((x) => x !== o);
    this.game.hooks.onOffersChanged?.();
  }
  startContract(emp, hg, fee) {
    const g = this.game;
    emp.gold -= fee;
    hg.gold += fee;
    hg.hiredBy = emp;
    hg.contractEnds = g.time + ECONOMY.hireTime;
    g.setTeam(hg, emp.team);
    const text = `${hg.name}'s ${hg.hero.def.name} has been hired by ${emp.name} for ${fee} gold.`;
    if (hg.isHuman) g.message(`You are now fighting for ${emp.name} for ${ECONOMY.hireTime / 60} minutes (+${fee} gold). Their enemies are your enemies.`, '#ffe680');
    else if (emp.isHuman) g.message(`${hg.name}'s ${hg.hero.def.name} now fights for you for ${ECONOMY.hireTime / 60} minutes.`, '#9fe89f');
    else g.notify(emp, text);
    if (hg.isHuman || emp.isHuman) g.sound('buildComplete');
  }
  endContract(hg) {
    const g = this.game;
    const emp = hg.hiredBy;
    hg.hiredBy = null;
    hg.contractEnds = 0;
    g.setTeam(hg, hg.homeTeam ?? hg.team);
    if (hg.isHuman) g.message(`Your contract with ${emp.name} has ended.`, '#ffe680');
    else if (emp.isHuman) g.message(`${hg.name}'s ${hg.hero?.def.name ?? 'Hero'} has finished serving you.`, '#ffe680');
  }

  // ----------------------------------------------------------------- nukes
  startNuke(b) {
    const g = this.game;
    const p = b.owner;
    if (!b.def.nukes || b.underConstruction || b.nukeReady || b.nukeBuild) return false;
    if (!g.spend(p, ECONOMY.nuke.cost)) return false;
    b.nukeBuild = { time: 0, total: ECONOMY.nuke.time };
    return true;
  }
  cancelNuke(b) {
    if (!b.nukeBuild) return;
    this.game.refund(b.owner, ECONOMY.nuke.cost);
    b.nukeBuild = null;
  }
  silos(dt) {
    const g = this.game;
    for (const p of g.generals) {
      for (const b of p.buildings) {
        if (!b.nukeBuild || b.dead) continue;
        b.nukeBuild.time += dt;
        if (b.nukeBuild.time >= b.nukeBuild.total) {
          b.nukeBuild = null;
          b.nukeReady = true;
          if (p.isHuman) {
            g.message('Nuclear missile ready. Select the Missile Silo to launch it.', '#ffe680');
            g.sound('buildComplete');
          }
        }
      }
    }
  }
  launchNuke(b, x, z) {
    const g = this.game;
    if (!b.nukeReady || b.dead) return false;
    b.nukeReady = false;
    const n = { x, z, owner: b.owner, silo: b, t: 0, flight: ECONOMY.nuke.flight };
    this.nukes.push(n);
    g.message(b.owner.isHuman ? 'Nuclear missile launched.' : 'Nuclear launch detected!', '#ff5a5a');
    g.sound('nukeSiren');
    g.hooks.fx?.nukeLaunch?.(b, x, z, n.flight);
    return true;
  }
  updateNukes(dt) {
    if (!this.nukes.length) return;
    const keep = [];
    for (const n of this.nukes) {
      n.t += dt;
      if (n.t >= n.flight) this.detonate(n);
      else keep.push(n);
    }
    this.nukes = keep;
  }
  detonate(n) {
    const g = this.game;
    const { radius: R, damage: D } = ECONOMY.nuke;
    const src = n.silo;
    for (const u of g.unitsNear(n.x, n.z, R + 3)) {
      if (u.dead || u.def.invulnerable) continue;
      const d = Math.max(0, Math.hypot(u.x - n.x, u.z - n.z) - u.radius);
      if (d > R) continue;
      const dmg = D * Math.pow(1 - d / R, 0.8) + 150;
      g.dealDamage(src, u, dmg, 'chaos', { pure: true });
    }
    // Flatten the forest at the heart of the blast.
    for (let i = 0; i < 40; i++) {
      const t = findNearestTree(g, n.x, n.z, R * 0.6);
      if (!t) break;
      g.terrain.fellTree(t);
    }
    for (const p of g.generals) {
      if (p.mode !== 'empire' || p.defeated) continue;
      if (p.buildings.some((b) => !b.dead && Math.hypot(b.x - n.x, b.z - n.z) < R * 1.5)) {
        p.unrest += 25;
        p.citizens *= 0.75;
      }
    }
    g.hooks.fx?.nukeBlast?.(n.x, n.z, R);
    g.shake(2.5);
    g.sound('nukeBlast');
    g.message('A nuclear blast has scorched the land!', '#ff8a5a');
  }

  ageName(p) {
    return AGE_NAMES[Math.max(1, p.tier)];
  }
}
