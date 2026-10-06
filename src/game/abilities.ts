// Hero and unit abilities.
//
// target: 'unit' | 'point' | 'none' | 'passive' | 'aura'
// filter (for unit targets): 'ally' | 'enemy' | 'any' | 'allyOrUndead'
import type { Game } from './game.ts';
import type { Unit } from './unit.ts';
import type { BuffData, Point } from './types.ts';

export type AbilityTarget = 'unit' | 'point' | 'none' | 'passive' | 'aura';
export type AbilityFilter = 'ally' | 'enemy' | 'any' | 'allyOrUndead';

/** An ability as written below; each also keeps its own numbers (heal, dmg, duration, ...). */
export interface AbilitySpec {
  name: string;
  icon: string;
  color: string;
  hotkey: string;
  levels: number;
  target: AbilityTarget;
  filter?: AbilityFilter;
  ultimate?: boolean;
  autocast?: boolean;
  /** How computer generals use it. */
  ai?: string;
  /**
   * How creeps and bosses use it: 'aoeSelf' with enemies close by (the default), 'heal' on a
   * wounded friend, 'target' on the enemy being fought, 'summon' once a fight starts.
   */
  creepAi?: 'aoeSelf' | 'heal' | 'target' | 'summon';
  range?: number;
  /** Area of effect radius (point targets). */
  aoe?: number;
  /** Radius of auras and self-centred spells. */
  radius?: number;
  mana?: number[];
  cooldown?: number[];
  tooltip(level: number): string;
  cast?(game: Game, caster: Unit, level: number, target?: Unit | null, point?: Point | null): void;
  aura?(level: number): BuffData;
}
/** A registered ability: its spec plus `id` and any numbers it carries. */
export interface AbilityDef extends AbilitySpec {
  id: string;
  /** Critical Strike: a fixed chance; Bash: chance per level. */
  chance?: number | number[];
  /** Critical Strike damage multiplier per level. */
  mult?: number[];
}

const L = (arr: readonly number[], lvl: number): number => arr[Math.max(0, Math.min(arr.length - 1, lvl - 1))]!;

/** Types an ability's own numbers for its `cast`/`aura` (as `this`). */
function ab<T extends AbilitySpec>(spec: T & ThisType<T>): T {
  return spec;
}

const DEFS = {
  // ------------------------------------------------------------- Paladin
  holy_light: ab({
    name: 'Holy Light', icon: '✨', color: '#e8c547', hotkey: 'Q', levels: 3, target: 'unit', filter: 'allyOrUndead',
    range: 8, mana: [65, 65, 65], cooldown: [5, 5, 5], heal: [200, 400, 600],
    ai: 'heal',
    tooltip: (l) => `A holy light that heals a friendly unit for ${L([200, 400, 600], l)} hit points, or deals half that damage to an undead enemy.`,
    cast(game, c, lvl, target: Unit) {
      const amt = L(this.heal, lvl);
      if (game.isEnemy(c.owner, target.owner)) {
        game.dealDamage(c, target, amt / 2, 'spell', { spell: true });
      } else {
        game.heal(target, amt, c);
      }
      game.fx.holyLight(target);
      game.sound('heal', target.x, target.z);
    },
  }),
  divine_shield: ab({
    name: 'Divine Shield', icon: '🔆', color: '#f0e68c', hotkey: 'W', levels: 3, target: 'none',
    mana: [25, 25, 25], cooldown: [35, 50, 65], duration: [10, 15, 20], ai: 'defensive',
    tooltip: (l) => `An impenetrable holy shield surrounds the Paladin for ${L([10, 15, 20], l)} seconds, protecting him from all damage.`,
    cast(game, c, lvl) {
      c.addBuff('divine_shield', L(this.duration, lvl), { invulnerable: true, visual: 'shield', replace: true });
      game.sound('magicCast', c.x, c.z);
    },
  }),
  devotion_aura: ab({
    name: 'Devotion Aura', icon: '🛡️', color: '#c9b46b', hotkey: 'E', levels: 3, target: 'aura', radius: 9,
    armor: [1.5, 3, 4.5],
    tooltip: (l) => `Gives nearby friendly units +${L([1.5, 3, 4.5], l)} armor.`,
    aura(lvl): BuffData {
      return { armor: L(this.armor, lvl) };
    },
  }),
  resurrection: ab({
    name: 'Resurrection', icon: '👼', color: '#fff3b0', hotkey: 'R', levels: 1, ultimate: true, target: 'none',
    mana: [200], cooldown: [180], ai: 'resurrect',
    tooltip: () => 'Brings back to life up to 6 of your fallen non-Hero units that died nearby.',
    cast(game, c) {
      const n = game.resurrect(c, 10, 6);
      game.fx.ring(c.x, c.z, 0xfff3b0, 10, 1.2);
      game.sound('heal', c.x, c.z);
      if (n === 0 && c.owner.isHuman) game.message('There are no corpses nearby.', '#ccc');
    },
  }),

  // ------------------------------------------------------------ Archmage
  blizzard: ab({
    name: 'Blizzard', icon: '❄️', color: '#9fd8ff', hotkey: 'Q', levels: 3, target: 'point', range: 9, aoe: 3,
    mana: [75, 75, 75], cooldown: [6, 6, 6], waves: [6, 8, 10], dmg: [30, 40, 50], ai: 'aoe',
    tooltip: (l) => `Calls down ${L([6, 8, 10], l)} waves of freezing ice shards that deal ${L([30, 40, 50], l)} damage per wave to enemies in an area. Channeled.`,
    cast(game, c, lvl, target, point: Point) {
      const dmg = L(this.dmg, lvl);
      const aoe = this.aoe;
      game.startChannel(c, {
        id: 'blizzard', duration: L(this.waves, lvl), interval: 1, point,
        tick() {
          game.fx.blizzard(point.x, point.z, aoe);
          game.later(0.45, () => {
            for (const u of game.enemiesInRadius(c.owner, point.x, point.z, aoe)) {
              game.dealDamage(c, u, dmg, 'spell', { spell: true });
            }
          });
          game.sound('frost', point.x, point.z);
        },
      });
    },
  }),
  water_elemental: ab({
    name: 'Summon Water Elemental', icon: '💧', color: '#4fa8ff', hotkey: 'W', levels: 3, target: 'none',
    mana: [125, 125, 125], cooldown: [20, 20, 20], ai: 'summon',
    hp: [525, 675, 900], dmg: [0, 12, 24],
    tooltip: (l) => `Summons a level ${l} Water Elemental (${L([525, 675, 900], l)} HP) to fight for the Archmage. Lasts 60 seconds.`,
    cast(game, c, lvl) {
      const a = c.facing;
      const p = game.grid.nearestWalkable(c.x + Math.sin(a) * 1.6, c.z + Math.cos(a) * 1.6, 6) ?? { x: c.x, z: c.z };
      const u = game.spawnUnit('water_elemental', c.owner, p.x, p.z, { lifetime: 60, summoned: true, facing: a });
      u.addBuff('elemental_power', 9999, { hp: L(this.hp, lvl) - 525, damage: L(this.dmg, lvl) });
      u.hp = u.maxHp;
      game.fx.burst(p.x, 0.8, p.z, 0x4fa8ff, 18);
      game.sound('magicCast', p.x, p.z);
      if (c.order.type === 'attack' && c.order.target) game.issueOrder(u, { type: 'attack', target: c.order.target });
    },
  }),
  brilliance_aura: ab({
    name: 'Brilliance Aura', icon: '🌀', color: '#8a7dff', hotkey: 'E', levels: 3, target: 'aura', radius: 9,
    regen: [0.75, 1.5, 2.25],
    tooltip: (l) => `Gives nearby friendly units +${L([0.75, 1.5, 2.25], l)} mana regeneration per second.`,
    aura(lvl): BuffData {
      return { manaRegen: L(this.regen, lvl) };
    },
  }),
  meteor_shower: ab({
    name: 'Meteor Shower', icon: '☄️', color: '#ff7b2e', hotkey: 'R', levels: 1, ultimate: true, target: 'point',
    range: 10, aoe: 4, mana: [175], cooldown: [90], ai: 'aoe',
    tooltip: () => 'Calls down 7 blazing meteors over an area. Each deals 140 damage and stuns enemies for 1 second.',
    cast(game, c, lvl, target, point: Point) {
      for (let i = 0; i < 7; i++) {
        game.later(0.35 * i, () => {
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * 3;
          const x = point.x + Math.cos(a) * r;
          const z = point.z + Math.sin(a) * r;
          // The meteor falls for 0.7 s (drawn by the renderer); the impact is game time.
          game.fx.meteor(x, z);
          game.later(0.7, () => {
            for (const u of game.enemiesInRadius(c.owner, x, z, 2.2)) {
              game.dealDamage(c, u, 140, 'spell', { spell: true });
              game.stun(u, 1);
            }
            game.sound('explosion', x, z);
            game.shake(0.2);
          });
        });
      }
      game.sound('fire', point.x, point.z);
    },
  }),

  // --------------------------------------------------------- Blademaster
  wind_walk: ab({
    name: 'Wind Walk', icon: '💨', color: '#b8f0d0', hotkey: 'Q', levels: 3, target: 'none',
    mana: [75, 75, 75], cooldown: [5, 5, 5], duration: [20, 30, 40], speed: [1.1, 1.4, 1.7], bonus: [40, 70, 100],
    ai: 'escape',
    tooltip: (l) => `Turns invisible and moves ${Math.round((L([1.1, 1.4, 1.7], l) - 1) * 100)}% faster for ${L([20, 30, 40], l)} seconds. Attacking breaks invisibility and deals ${L([40, 70, 100], l)} bonus damage.`,
    cast(game, c, lvl) {
      c.addBuff('wind_walk', L(this.duration, lvl), {
        invisible: true, speedMul: L(this.speed, lvl), bonusDamage: L(this.bonus, lvl), visual: 'windwalk', replace: true,
      });
      game.fx.burst(c.x, 0.6, c.z, 0xd8fff0, 14);
      game.sound('teleport', c.x, c.z);
    },
  }),
  mirror_image: ab({
    name: 'Mirror Image', icon: '👥', color: '#9ab8ff', hotkey: 'W', levels: 3, target: 'none',
    mana: [125, 125, 125], cooldown: [3, 3, 3], images: [1, 2, 3], ai: 'summon',
    tooltip: (l) => `Confuses the enemy by creating ${L([1, 2, 3], l)} illusion${l > 1 ? 's' : ''} of the Blademaster. Illusions deal no damage and take double damage. Lasts 60 seconds.`,
    cast(game, c, lvl) {
      game.mirrorImage(c, L(this.images, lvl));
      game.sound('teleport', c.x, c.z);
    },
  }),
  critical_strike: ab({
    name: 'Critical Strike', icon: '🗡️', color: '#e85d5d', hotkey: 'E', levels: 3, target: 'passive',
    chance: 0.15, mult: [2, 3, 4],
    tooltip: (l) => `Gives a 15% chance to deal ${L([2, 3, 4], l)} times normal damage on an attack.`,
  }),
  bladestorm: ab({
    name: 'Bladestorm', icon: '🌪️', color: '#ffb347', hotkey: 'R', levels: 1, ultimate: true, target: 'none',
    mana: [200], cooldown: [120], ai: 'aoeSelf', radius: 3,
    tooltip: () => 'Becomes a whirling vortex of blades for 5 seconds, dealing 110 damage per second to nearby enemies. The Blademaster is immune to magic while spinning but cannot attack.',
    cast(game, c) {
      c.addBuff('bladestorm', 5, {
        spellImmune: true, visual: 'bladestorm', replace: true, acc: 0,
        tick(u, dt, b) {
          b.acc! += dt;
          while (b.acc! >= 0.25) {
            b.acc! -= 0.25;
            for (const e of game.enemiesInRadius(u.owner, u.x, u.z, 3)) {
              game.dealDamage(u, e, 27.5, 'spell', { spell: true, quiet: true });
            }
          }
        },
      });
      game.sound('bladestorm', c.x, c.z);
    },
  }),

  // ------------------------------------------------------- Mountain King
  storm_bolt: ab({
    name: 'Storm Bolt', icon: '⚡', color: '#6fb7ff', hotkey: 'Q', levels: 3, target: 'unit', filter: 'enemy',
    range: 7, mana: [75, 75, 75], cooldown: [9, 9, 9], dmg: [100, 225, 350], stun: [5, 5, 5], ai: 'nuke',
    tooltip: (l) => `A magical hammer is thrown at an enemy unit, dealing ${L([100, 225, 350], l)} damage and stunning it for 5 seconds (3 seconds on Heroes).`,
    cast(game, c, lvl, target: Unit) {
      const dmg = L(this.dmg, lvl);
      game.projectiles.spawn({
        kind: 'hammer', from: c, target, speed: 14, color: 0x9fd0ff,
        onHit(t) {
          if (!t) return;
          game.dealDamage(c, t, dmg, 'spell', { spell: true });
          game.stun(t, t.isHero ? 3 : 5);
          game.sound('stun', t.x, t.z);
        },
      });
      game.sound('magicCast', c.x, c.z);
    },
  }),
  thunder_clap: ab({
    name: 'Thunder Clap', icon: '💥', color: '#c7a0ff', hotkey: 'W', levels: 3, target: 'none',
    mana: [90, 90, 90], cooldown: [6, 6, 6], dmg: [60, 100, 140], radius: 3.5, ai: 'aoeSelf',
    tooltip: (l) => `Slams the ground, dealing ${L([60, 100, 140], l)} damage to nearby enemies and slowing their movement and attacks by 50% for 5 seconds.`,
    cast(game, c, lvl) {
      const dmg = L(this.dmg, lvl);
      for (const u of game.enemiesInRadius(c.owner, c.x, c.z, this.radius)) {
        game.dealDamage(c, u, dmg, 'spell', { spell: true });
        if (!u.isBuilding && !u.spellImmune) u.addBuff('thunder_slow', u.isHero ? 3 : 5, { speedMul: 0.5, attackSpeed: 0.5, visual: 'slow', replace: true });
      }
      game.fx.ring(c.x, c.z, 0xd8c8ff, this.radius + 0.5, 0.6);
      game.fx.burst(c.x, 0.3, c.z, 0xc7a0ff, 20);
      game.shake(0.25);
      game.sound('thunder', c.x, c.z);
    },
  }),
  bash: ab({
    name: 'Bash', icon: '🔨', color: '#b08850', hotkey: 'E', levels: 3, target: 'passive', chance: [0.2, 0.3, 0.4],
    tooltip: (l) => `Gives a ${Math.round(L([0.2, 0.3, 0.4], l) * 100)}% chance that an attack deals 25 bonus damage and stuns the target for 2 seconds (1 second on Heroes).`,
  }),
  avatar: ab({
    name: 'Avatar', icon: '🗿', color: '#d4a373', hotkey: 'R', levels: 1, ultimate: true, target: 'none',
    mana: [150], cooldown: [180], ai: 'combatBuff',
    tooltip: () => 'Grows to giant size for 60 seconds: +5 armor, +500 hit points, +20 damage and immunity to magic.',
    cast(game, c) {
      c.addBuff('avatar', 60, { armor: 5, hp: 500, damage: 20, spellImmune: true, scale: 1.35, replace: true });
      game.fx.ring(c.x, c.z, 0xd4a373, 3, 0.8);
      game.sound('roar', c.x, c.z);
    },
  }),

  // -------------------------------------------------------------- Ranger
  volley: ab({
    name: 'Volley', icon: '🎯', color: '#9be08f', hotkey: 'Q', levels: 3, target: 'point', range: 9, aoe: 3,
    mana: [70, 70, 70], cooldown: [8, 8, 8], dmg: [80, 150, 220], ai: 'aoe',
    tooltip: (l) => `Fires a rain of arrows into an area, dealing ${L([80, 150, 220], l)} damage to enemies there.`,
    cast(game, c, lvl, target, point: Point) {
      const dmg = L(this.dmg, lvl);
      game.fx.volley(c, point.x, point.z, this.aoe);
      game.later(0.65, () => {
        for (const u of game.enemiesInRadius(c.owner, point.x, point.z, this.aoe)) {
          game.dealDamage(c, u, dmg, 'spell', { spell: true });
        }
        game.sound('arrowHit', point.x, point.z);
      });
      game.sound('arrowShoot', c.x, c.z);
    },
  }),
  entangle: ab({
    name: 'Entangling Roots', icon: '🌿', color: '#5fa84a', hotkey: 'W', levels: 3, target: 'unit', filter: 'enemy',
    range: 7, mana: [75, 75, 75], cooldown: [8, 8, 8], duration: [3, 5, 7], dps: 15, ai: 'nuke',
    tooltip: (l) => `Roots an enemy to the ground for ${L([3, 5, 7], l)} seconds, preventing it from moving or attacking and dealing 15 damage per second. Half duration on Heroes.`,
    cast(game, c, lvl, target: Unit) {
      if (target.isBuilding || target.spellImmune) return;
      const dur = L(this.duration, lvl) * (target.isHero ? 0.5 : 1);
      target.addBuff('entangle', dur, {
        root: true, visual: 'roots', replace: true,
        tick(u, dt) {
          game.dealDamage(c, u, 15 * dt, 'spell', { spell: true, quiet: true });
        },
      });
      game.sound('magicHit', target.x, target.z);
    },
  }),
  trueshot_aura: ab({
    name: 'Trueshot Aura', icon: '🏹', color: '#cfe8a8', hotkey: 'E', levels: 3, target: 'aura', radius: 9,
    pct: [0.1, 0.2, 0.3],
    tooltip: (l) => `Increases the ranged attack damage of nearby friendly units by ${Math.round(L([0.1, 0.2, 0.3], l) * 100)}%.`,
    aura(lvl): BuffData {
      return { rangedPct: L(this.pct, lvl) };
    },
  }),
  starfall: ab({
    name: 'Starfall', icon: '🌠', color: '#d4c2ff', hotkey: 'R', levels: 1, ultimate: true, target: 'none',
    mana: [200], cooldown: [150], radius: 8, ai: 'aoeSelf',
    tooltip: () => 'Calls down waves of falling stars for 12 seconds, each dealing 55 damage to nearby enemies. Channeled.',
    cast(game, c) {
      const radius = this.radius;
      game.startChannel(c, {
        id: 'starfall', duration: 12, interval: 1, point: { x: c.x, z: c.z },
        tick() {
          const foes = game.enemiesInRadius(c.owner, c.x, c.z, radius);
          for (const u of foes) {
            game.fx.star(u.x, u.z);
            game.later(0.5, () => {
              if (!u.dead) game.dealDamage(c, u, 55, 'spell', { spell: true });
            });
          }
          if (foes.length) game.sound('magicHit', c.x, c.z);
        },
      });
    },
  }),

  // ------------------------------------------------------- Unit spells
  heal: ab({
    name: 'Heal', icon: '💖', color: '#ffd1dc', hotkey: 'E', levels: 1, target: 'unit', filter: 'ally', range: 6,
    mana: [5], cooldown: [1.5], autocast: true,
    tooltip: () => 'Heals a wounded friendly unit for 25 hit points. Autocast.',
    cast(game, c, lvl, target: Unit) {
      game.heal(target, 25, c);
      game.fx.burst(target.x, 0.8, target.z, 0xfff3b0, 6);
    },
  }),
  slow: ab({
    name: 'Slow', icon: '🐌', color: '#c08bff', hotkey: 'W', levels: 1, target: 'unit', filter: 'enemy', range: 7,
    mana: [40], cooldown: [2], autocast: true,
    tooltip: () => 'Slows an enemy unit’s movement by 40% and attack rate by 25%. Lasts 20 seconds (8 on Heroes). Autocast.',
    cast(game, c, lvl, target: Unit) {
      if (target.spellImmune || target.isBuilding) return;
      target.addBuff('slow', target.isHero ? 8 : 20, { speedMul: 0.6, attackSpeed: 0.75, visual: 'slow', replace: true });
      game.sound('magicHit', target.x, target.z);
    },
  }),
  creep_stomp: ab({
    name: 'War Stomp', icon: '💢', color: '#a88', hotkey: 'Q', levels: 1, target: 'none', mana: [0], cooldown: [12],
    radius: 3, ai: 'aoeSelf',
    tooltip: () => 'Stuns and damages nearby enemies.',
    cast(game, c) {
      for (const u of game.enemiesInRadius(c.owner, c.x, c.z, this.radius)) {
        game.dealDamage(c, u, 50, 'spell', { spell: true });
        game.stun(u, u.isHero ? 1 : 2);
      }
      game.fx.ring(c.x, c.z, 0xc8a070, this.radius, 0.5);
      game.sound('thunder', c.x, c.z);
    },
  }),
  war_stomp: ab({
    name: 'Tyrant’s Stomp', icon: '💢', color: '#a33', hotkey: 'Q', levels: 1, target: 'none', mana: [0],
    cooldown: [11], radius: 5, ai: 'aoeSelf',
    tooltip: () => 'Kalenden slams the earth, dealing 160 damage and stunning nearby enemies.',
    cast(game, c) {
      for (const u of game.enemiesInRadius(c.owner, c.x, c.z, this.radius)) {
        game.dealDamage(c, u, 160, 'spell', { spell: true });
        game.stun(u, u.isHero ? 1.5 : 2.5);
      }
      game.fx.ring(c.x, c.z, 0xff3a2a, this.radius, 0.7);
      game.fx.burst(c.x, 0.4, c.z, 0x553322, 26);
      game.shake(0.5);
      game.sound('thunder', c.x, c.z);
    },
  }),
  raise_dead: ab({
    name: 'Raise the Fallen', icon: '💀', color: '#9dff6a', hotkey: 'W', levels: 1, target: 'none', mana: [0],
    cooldown: [24], ai: 'summon',
    tooltip: () => 'Kalenden raises skeletal warriors from the earth.',
    cast(game, c) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.random();
        const p = game.grid.nearestWalkable(c.x + Math.cos(a) * 2.5, c.z + Math.sin(a) * 2.5, 5);
        if (!p) continue;
        const u = game.spawnUnit(i % 2 ? 'skeleton_archer' : 'skeleton', c.owner, p.x, p.z, { lifetime: 45, summoned: true });
        u.guardPos = { x: c.guardPos?.x ?? c.x, z: c.guardPos?.z ?? c.z, leash: 20 };
        game.fx.burst(p.x, 0.3, p.z, 0x9dff6a, 10);
      }
      game.sound('roar', c.x, c.z);
    },
  }),

  // ------------------------------------------------- Creep and boss spells
  creep_heal: ab({
    name: 'Healing Wave', icon: '💚', color: '#6ad88a', hotkey: 'Q', levels: 1, target: 'unit', filter: 'ally', range: 6,
    mana: [60], cooldown: [6], creepAi: 'heal',
    tooltip: () => 'Heals a wounded ally for 80 hit points.',
    cast(game, c, lvl, target: Unit) {
      game.heal(target, 80, c);
      game.fx.burst(target.x, 0.8, target.z, 0x8affa0, 10);
      game.sound('heal', target.x, target.z, 0.5);
    },
  }),
  frost_nova: ab({
    name: 'Frost Nova', icon: '❄️', color: '#8ae8ff', hotkey: 'Q', levels: 1, target: 'none', mana: [0], cooldown: [10],
    radius: 3.5, creepAi: 'aoeSelf',
    tooltip: () => 'Blasts nearby enemies with frost: 90 damage, and they move and attack 40% slower for 5 seconds.',
    cast(game, c) {
      for (const u of game.enemiesInRadius(c.owner, c.x, c.z, this.radius)) {
        game.dealDamage(c, u, 90, 'spell', { spell: true });
        if (!u.isBuilding && !u.spellImmune) u.addBuff('frost_slow', 5, { speedMul: 0.6, attackSpeed: 0.6, visual: 'slow', replace: true });
      }
      game.fx.ring(c.x, c.z, 0x9ae8ff, this.radius, 0.6);
      game.fx.burst(c.x, 0.5, c.z, 0xc8f4ff, 18);
      game.sound('frostNova', c.x, c.z);
    },
  }),
  dragon_breath: ab({
    name: 'Dragonfire', icon: '🔥', color: '#ff6a1a', hotkey: 'Q', levels: 1, target: 'unit', filter: 'enemy', range: 7,
    mana: [0], cooldown: [9], aoe: 3.2, creepAi: 'target',
    tooltip: () => 'Breathes fire on an area, burning everything there for 220 damage over a few seconds.',
    cast(game, c, lvl, target: Unit) {
      const x = target.x;
      const z = target.z;
      const r = this.aoe;
      game.fx.explosion(x, z, 1.6);
      game.fx.burst(x, 0.6, z, 0xff7a20, 28, 3, 0.12, 0.8);
      game.sound('dragonFire', x, z);
      for (let i = 0; i < 4; i++) {
        game.later(i * 0.5, () => {
          if (c.dead) return;
          for (const u of game.enemiesInRadius(c.owner, x, z, r)) game.dealDamage(c, u, 55, 'spell', { spell: true, quiet: true });
          game.fx.burst(x, 0.3, z, 0xff4a10, 8, 2, 0.1, 0.5);
        });
      }
      game.shake(0.3);
    },
  }),
  acid_spray: ab({
    name: 'Acid Spray', icon: '🧪', color: '#9aff3a', hotkey: 'Q', levels: 1, target: 'none', mana: [0], cooldown: [8],
    radius: 4, creepAi: 'aoeSelf',
    tooltip: () => 'Sprays acid on nearby enemies: 120 damage and -4 armor for 10 seconds.',
    cast(game, c) {
      for (const u of game.enemiesInRadius(c.owner, c.x, c.z, this.radius)) {
        game.dealDamage(c, u, 120, 'spell', { spell: true });
        if (!u.isBuilding && !u.spellImmune) u.addBuff('acid', 10, { armor: -4, visual: 'slow', replace: true });
      }
      game.fx.ring(c.x, c.z, 0x9aff3a, this.radius, 0.6);
      game.fx.burst(c.x, 0.8, c.z, 0x9aff3a, 22);
      game.sound('acidSpray', c.x, c.z);
    },
  }),
  bandit_call: ab({
    name: 'Call to Arms', icon: '📯', color: '#c8a04a', hotkey: 'W', levels: 1, target: 'none', mana: [0], cooldown: [25],
    creepAi: 'summon',
    tooltip: () => 'Calls two brigands to fight at his side for 40 seconds.',
    cast(game, c) {
      summonGuards(game, c, 'brigand', 2, 40);
      game.sound('banditLaugh', c.x, c.z, 0.8);
    },
  }),
  brood_spawn: ab({
    name: 'Spawn Brood', icon: '🥚', color: '#8a5aaa', hotkey: 'Q', levels: 1, target: 'none', mana: [0], cooldown: [18],
    creepAi: 'summon',
    tooltip: () => 'Hatches three giant spiders that fight for 30 seconds.',
    cast(game, c) {
      summonGuards(game, c, 'spider', 3, 30);
      game.sound('spiderScreech', c.x, c.z, 0.7);
    },
  }),
  web: ab({
    name: 'Web', icon: '🕸️', color: '#ddd', hotkey: 'W', levels: 1, target: 'unit', filter: 'enemy', range: 7, mana: [0],
    cooldown: [12], creepAi: 'target',
    tooltip: () => 'Pins an enemy to the ground for 3 seconds.',
    cast(game, c, lvl, target: Unit) {
      if (target.isBuilding || target.spellImmune) return;
      target.addBuff('web', 3, { root: true, visual: 'roots', replace: true });
      game.fx.burst(target.x, 0.5, target.z, 0xf0f0f0, 12);
      game.sound('magicHit', target.x, target.z);
    },
  }),
};

/** Summoned guards around a creep or boss (they return to its lair when they lose their prey). */
function summonGuards(game: Game, c: Unit, type: string, n: number, lifetime: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random();
    const p = game.grid.nearestWalkable(c.x + Math.cos(a) * 2.2, c.z + Math.sin(a) * 2.2, 5);
    if (!p) continue;
    const u = game.spawnUnit(type, c.owner, p.x, p.z, { lifetime, summoned: true, facing: c.facing });
    u.guardPos = { x: c.guardPos?.x ?? c.x, z: c.guardPos?.z ?? c.z, leash: 16 };
    if (c.order.type === 'attack' && c.order.target) u.order = { type: 'attack', target: c.order.target, auto: true, anchor: u.guardPos, leash: 16 };
    game.fx.burst(p.x, 0.4, p.z, 0xc8b080, 8);
  }
}

/** Every ability by id. */
export const ABILITIES: Record<string, AbilityDef> = DEFS as unknown as Record<string, AbilityDef>;
for (const [id, a] of Object.entries(ABILITIES)) a.id = id;

/** Hero level required to learn level `n` (1-based) of an ability. */
export function requiredHeroLevel(ability: AbilitySpec, n: number): number {
  if (ability.ultimate) return 6;
  return [1, 3, 5][n - 1] ?? 99;
}

export function abilityValue(arr: readonly number[], lvl: number): number {
  return L(arr, lvl);
}
