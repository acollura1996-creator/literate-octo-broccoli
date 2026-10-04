// Neutral hostile creep camps: guard their spot, leash back home, drop
// treasure when wiped out and respawn after a while.
import { DROP_TABLES } from '../data/items.js';
import { UNITS } from '../data/units.js';
import { ABILITIES } from '../game/abilities.js';
import { CENTER } from '../world/layout.js';

const DROP_CHANCE = { 1: 0.55, 2: 0.75, 3: 0.9, 4: 1 };

export class CreepManager {
  constructor(game) {
    this.game = game;
    this.camps = [];
    this.castTimer = 0;
  }

  setup() {
    for (const c of this.game.layout.camps) {
      const camp = { at: { x: c.at[0], z: c.at[1] }, tier: c.tier, types: c.units, units: [], cleared: false, respawn: 0 };
      camp.power = c.units.reduce((s, t) => s + UNITS[t].level, 0);
      this.spawnCamp(camp);
      this.camps.push(camp);
    }
  }

  spawnCamp(camp) {
    const g = this.game;
    camp.units = [];
    const n = camp.types.length;
    const face = Math.atan2(CENTER - camp.at.x, CENTER - camp.at.z) + Math.PI;
    camp.types.forEach((type, i) => {
      // Strongest creep in the middle, the rest around it.
      const sorted = i === 0 && n > 2;
      const a = (i / n) * Math.PI * 2 + 0.6;
      const r = sorted ? 0 : 1.7;
      const p = g.grid.nearestWalkable(camp.at.x + Math.cos(a) * r, camp.at.z + Math.sin(a) * r, 5) ?? { x: camp.at.x, z: camp.at.z };
      const u = g.spawnUnit(type, g.creeps, p.x, p.z, { facing: face + (Math.random() - 0.5) });
      u.camp = camp;
      u.guardPos = { x: p.x, z: p.z, facing: u.facing, leash: 11 };
      camp.units.push(u);
    });
    camp.cleared = false;
  }

  aggro(camp, target) {
    for (const u of camp.units) {
      if (u.dead || u.order.type === 'guardReturn') continue;
      if (u.order.type === 'attack' && u.order.target && !u.order.target.dead) continue;
      u.order = { type: 'attack', target, auto: true, anchor: u.guardPos, leash: 12 };
      u.path = null;
    }
  }

  onCreepDied(u) {
    const camp = u.camp;
    if (camp.units.some((c) => !c.dead)) return;
    camp.cleared = true;
    camp.respawn = 150 + camp.tier * 40;
    if (Math.random() < DROP_CHANCE[camp.tier]) {
      const table = DROP_TABLES[camp.tier];
      const id = table[Math.floor(Math.random() * table.length)];
      this.game.dropItem(u.x, u.z, id);
    }
  }

  update(dt) {
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
    }
    // Creep spell casting (War Stomp for golems and ogre lords).
    this.castTimer -= dt;
    if (this.castTimer <= 0) {
      this.castTimer = 0.5;
      for (const camp of this.camps) {
        for (const u of camp.units) {
          if (u.dead || !u.def.abilities.length || u.order.type !== 'attack') continue;
          for (const id of u.def.abilities) {
            const ab = ABILITIES[id];
            if ((u.cooldowns[id] || 0) > 0) continue;
            if (g.enemiesInRadius(u.owner, u.x, u.z, ab.radius ?? 3).length >= 1) {
              u.cooldowns[id] = ab.cooldown[0];
              u.anim = 'cast';
              u.animTime = 0;
              ab.cast(g, u, 1);
            }
          }
        }
      }
    }
  }

  /** Camps that are currently alive (for the AI). */
  aliveCamps() {
    return this.camps.filter((c) => !c.cleared);
  }
}
