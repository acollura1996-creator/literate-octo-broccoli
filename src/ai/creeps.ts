// Neutral hostile creep camps: guard their spot, leash back home, drop
// treasure when wiped out and respawn after a while. Boss lairs respawn slowly and drop the
// boss's own treasure the first time it falls; creeps and bosses cast their spells in a fight.
import { BOSS_TREASURE, dropTier, randomDrop } from '../data/items.ts';
import { UNITS } from '../data/units.ts';
import { ABILITIES } from '../game/abilities.ts';
import { CENTER } from '../world/layout.ts';
import type { Game } from '../game/game.ts';
import type { Unit } from '../game/unit.ts';
import type { CampState } from '../game/types.ts';

const DROP_CHANCE: Record<number, number> = { 1: 0.55, 2: 0.75, 3: 0.9, 4: 1, 5: 1 };
/** Danger of a boss lair relative to the levels of its creeps (for the computer generals). */
const BOSS_DANGER = 3.2;

export class CreepManager {
  readonly game: Game;
  camps: CampState[];
  castTimer: number;

  constructor(game: Game) {
    this.game = game;
    this.camps = [];
    this.castTimer = 0;
  }

  setup(): void {
    for (const c of this.game.layout.camps) {
      const camp: CampState = {
        at: { x: c.at[0], z: c.at[1] }, tier: c.tier, types: c.units, units: [], cleared: false, respawn: 0, power: 0,
        region: c.region, boss: c.boss ? c.units[0] : undefined, captives: !!c.captives, clears: 0,
      };
      const levels = c.units.reduce((s, t) => s + UNITS[t]!.level, 0);
      camp.level = levels;
      camp.power = c.boss ? levels * BOSS_DANGER : levels;
      this.spawnCamp(camp);
      this.camps.push(camp);
    }
  }

  spawnCamp(camp: CampState): void {
    const g = this.game;
    camp.units = [];
    const n = camp.types.length;
    const face = Math.atan2(CENTER - camp.at.x, CENTER - camp.at.z) + Math.PI;
    camp.types.forEach((type, i) => {
      // Strongest creep (or the boss) in the middle, the rest around it.
      const sorted = i === 0 && (n > 2 || !!camp.boss);
      const a = (i / n) * Math.PI * 2 + 0.6;
      const r = sorted ? 0 : camp.boss ? 2.6 : 1.7;
      const p = g.grid.nearestWalkable(camp.at.x + Math.cos(a) * r, camp.at.z + Math.sin(a) * r, 5) ?? { x: camp.at.x, z: camp.at.z };
      const u = g.spawnUnit(type, g.creeps, p.x, p.z, { facing: face + (Math.random() - 0.5) });
      u.camp = camp;
      u.guardPos = { x: p.x, z: p.z, facing: u.facing, leash: camp.boss ? 14 : 11 };
      this.empower(u);
      camp.units.push(u);
    });
    camp.cleared = false;
  }

  /** Creeps grow stronger as the game goes on (+15% health and damage every 10 minutes). */
  empower(u: Unit): void {
    const k = Math.min(2, (this.game.time / 600) * 0.15);
    if (k < 0.01) return;
    const [d0, d1] = u.def.damage ?? [0, 0];
    u.addBuff('veteran', Infinity, { hp: Math.round(u.def.hp * k), damage: Math.round(((d0 + d1) / 2) * k), armor: Math.floor(this.game.time / 900) });
    u.hp = u.maxHp;
  }

  aggro(camp: CampState, target: Unit): void {
    for (const u of camp.units) {
      if (u.dead || u.order.type === 'guardReturn') continue;
      if (u.order.type === 'attack' && u.order.target && !u.order.target.dead) continue;
      u.order = { type: 'attack', target, auto: true, anchor: u.guardPos!, leash: camp.boss ? 15 : 12 };
      u.path = null;
    }
  }

  onCreepDied(u: Unit, killer: Unit | null | undefined): void {
    const camp = u.camp!;
    if (camp.units.some((c) => !c.dead)) return;
    camp.cleared = true;
    camp.clears++;
    camp.respawn = camp.boss ? 600 : 150 + camp.tier * 40;
    const g = this.game;
    // Treasure: the tier the camp's strength earns; strong camps drop a second, lesser item.
    const tier = dropTier(camp.level ?? camp.power);
    const drops: string[] = [];
    if (camp.boss) {
      const own = BOSS_TREASURE[camp.boss];
      drops.push(camp.clears === 1 && own ? own : randomDrop(5), randomDrop(4), 'chest_gold');
    } else {
      if (Math.random() < DROP_CHANCE[Math.min(5, tier)]!) drops.push(randomDrop(tier));
      if (tier >= 3 && Math.random() < 0.5) drops.push(randomDrop(tier - 2));
    }
    drops.forEach((id, i) => {
      const a = (i / Math.max(1, drops.length)) * Math.PI * 2;
      const p = g.grid.nearestWalkable(u.x + Math.cos(a) * (i ? 1.2 : 0), u.z + Math.sin(a) * (i ? 1.2 : 0), 3) ?? { x: u.x, z: u.z };
      g.dropItem(p.x, p.z, id);
    });
    if (camp.boss) {
      const who = killer?.owner;
      const name = UNITS[camp.boss]!.name;
      if (who?.general) g.message(`${who.isHuman ? 'You have' : `${who.name} has`} slain ${name}! Its treasure lies for the taking.`, who.isHuman ? '#ffd700' : g.nameColor(who));
      else g.message(`${name} has fallen.`, '#ffd27a');
      g.sound('roar', u.x, u.z);
    }
    g.quests?.onCampCleared(camp, killer ?? null);
  }

  update(dt: number): void {
    const g = this.game;
    for (const camp of this.camps) {
      if (!camp.cleared) continue;
      camp.respawn -= dt;
      if (camp.respawn > 0) continue;
      const watched = g.unitsNear(camp.at.x, camp.at.z, 14).some((u) => u.owner.general);
      if (watched) {
        camp.respawn = 10;
        continue;
      }
      this.spawnCamp(camp);
      if (camp.boss) g.message(`${UNITS[camp.boss]!.name} has returned to its lair.`, '#ffd27a');
    }
    // Creep spell casting: stomps and novas, heals, breath on the enemy being fought, summons.
    this.castTimer -= dt;
    if (this.castTimer <= 0) {
      this.castTimer = 0.5;
      for (const camp of this.camps) {
        if (camp.cleared) continue;
        for (const u of camp.units) {
          if (u.dead || !u.def.abilities.length || u.stunned) continue;
          for (const id of u.def.abilities) {
            if ((u.cooldowns[id] || 0) > 0) continue;
            if (this.tryCast(u, id, camp)) break;
          }
        }
      }
    }
  }

  /** Cast a creep spell if the moment is right. */
  tryCast(u: Unit, id: string, camp: CampState): boolean {
    const g = this.game;
    const ab = ABILITIES[id]!;
    const mana = ab.mana?.[0] ?? 0;
    if (u.mana < mana) return false;
    const fighting = u.order.type === 'attack';
    let target: Unit | null = null;
    switch (ab.creepAi ?? 'aoeSelf') {
      case 'aoeSelf':
        if (!fighting || !g.enemiesInRadius(u.owner, u.x, u.z, ab.radius ?? 3).length) return false;
        break;
      case 'heal': {
        let worst = 0.7;
        for (const f of camp.units) {
          if (f.dead || f.distTo(u) > (ab.range ?? 6) + 1) continue;
          const r = f.hp / f.maxHp;
          if (r < worst) {
            worst = r;
            target = f;
          }
        }
        if (!target) return false;
        break;
      }
      case 'target': {
        const t = u.order.type === 'attack' ? u.order.target : null;
        if (!t || t.dead || t.isBuilding || u.distTo(t) > (ab.range ?? 6) + 1 || !t.targetableBy(u)) return false;
        target = t;
        break;
      }
      case 'summon':
        if (!fighting) return false;
        break;
      default:
        return false;
    }
    u.cooldowns[id] = ab.cooldown![0]!;
    u.mana -= mana;
    u.anim = 'cast';
    u.animTime = 0;
    ab.cast!(g, u, 1, target);
    return true;
  }

  /** Camps that are currently alive (for the AI). */
  aliveCamps(): CampState[] {
    return this.camps.filter((c) => !c.cleared);
  }
}
