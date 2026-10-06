// Shared simulation types: players, orders, buffs and the small records units carry. The unit
// itself is the `Unit` class (unit.ts); the game is the `Game` class (game.ts).
import type { Unit } from './unit.ts';
import type { Point } from './hooks.ts';
import type { Base } from '../world/layout.ts';
import type { Tree } from '../world/terrain.ts';
import type { GeneralAI } from '../ai/general.ts';

export type { Point };

// ------------------------------------------------------------------ players
export type GeneralMode = 'hero' | 'empire';
/** Generals play a Hero or an Empire; the other three players are the map's own factions. */
export type PlayerMode = GeneralMode | 'creep' | 'legion' | 'passive';

export interface PlayerStats {
  kills: number;
  unitsLost: number;
  goldMined: number;
  lumberHarvested: number;
  unitsTrained: number;
  creepsKilled: number;
  /** Empires only. */
  taxCollected?: number;
}

/** Citizens, food, taxes and mood (empire generals; set up by Empires.init). */
export interface EmpireEconomy {
  food: number;
  citizens: number;
  tax: number;
  rations: number;
  happiness: number;
  happinessTarget: number;
  unrest: number;
  riotTimer: number;
  foodRate: number;
  foodProduced: number;
  foodEaten: number;
  taxRate: number;
  starving: boolean;
  /** Unhappiness from a big city (0-15; set on the first economy tick). */
  crowding?: number;
  /** Happiness from a well-paved city (-6 to 18; set on the first economy tick). */
  roadBonus?: number;
}

export interface Player extends Partial<EmpireEconomy> {
  /** 0-3 generals (0 is the human), 10 creeps, 11 the Legion, 12 neutral passive. */
  index: number;
  name: string;
  colorName: string;
  color: number;
  mode: PlayerMode;
  isHuman: boolean;
  /** One of the (up to) four generals, as opposed to creeps, the Legion and neutrals. */
  general: boolean;
  /** Generals on the same team are allies (undefined for the map's factions). */
  team?: number;
  /** Team at the start (a hired Hero returns to it). */
  homeTeam?: number;
  heroType?: string | null;
  /** Corner of the map (index into the layout's bases). */
  slot?: number;
  base?: Base;
  /** Health multiplier for computer generals (difficulty). */
  handicap: number;
  damageMult: number;
  gold: number;
  lumber: number;
  foodUsed: number;
  foodCap: number;
  /** Housing for citizens (computed with the food). */
  housing?: number;
  /** Age (1-12) for empires, 0 for hero generals. */
  tier: number;
  /** Research levels by upgrade id. */
  upgrades: Record<string, number>;
  researchingUpg?: Record<string, boolean>;
  units: Unit[];
  buildings: Unit[];
  hero: Unit | null;
  defeated: boolean;
  stats: PlayerStats;
  /** Fractional gold from tribute (hero generals). */
  incomeAcc: number;
  /** A computer general's brain. */
  ai?: GeneralAI;
  lastFight?: { time: number; x: number; z: number; vs: Player };
  underAttack?: { time: number; x: number; z: number; by: Player };
  lastCitadelNotice?: number;
  /** Food reserved for heroes being revived. */
  pendingRevives?: number[];
  /** Time the last town center fell (empires fall 20 s later). */
  hallLostAt?: number | null;
  /** The empire a hero general is fighting for. */
  hiredBy?: Player | null;
  contractEnds?: number;
}

export type EmpirePlayer = Player & EmpireEconomy;

export function isEmpire(p: Player): p is EmpirePlayer {
  return p.mode === 'empire';
}

// ------------------------------------------------------------------- orders
interface OrderVariants {
  idle: object;
  stop: object;
  hold: object;
  channel: object;
  /** `gate`: the unit is on its way to step through this waygate (the order it carries out next is queued). */
  move: { point: Point; range?: number; then?: Order; gate?: Unit };
  attack: { target: Unit; auto?: boolean; anchor?: Point; leash?: number; resume?: Order };
  attackMove: { point: Point };
  patrol: { point: Point; origin?: Point };
  follow: { target: Unit };
  harvest: { target?: Unit | Tree | null };
  returnRes: { resume?: Order | null };
  build: { building: string; x: number; z: number; paid?: boolean };
  construct: { target: Unit };
  cast: { ability: string; target?: Unit | null; point?: Point | null };
  guardReturn: { point: Point };
  pickup: { item: GroundItem };
}
export type OrderType = keyof OrderVariants;
/**
 * A unit's current order. Any order can carry `engage`, the enemy a unit picked to fight while
 * carrying it out (attack-move, patrol, hold, follow, and towers).
 */
export type Order = { [K in OrderType]: { type: K; engage?: Unit | null } & OrderVariants[K] }[OrderType];
export type OrderOf<K extends OrderType> = Extract<Order, { type: K }>;

// -------------------------------------------------------------------- units
/** Stat changes from buffs, summed per unit. */
export interface Mods {
  armor: number;
  damage: number;
  hp: number;
  hpRegen: number;
  manaRegen: number;
  rangedPct: number;
  str: number;
  agi: number;
  int: number;
  speedMul: number;
  attackSpeed: number;
  stunned: boolean;
  rooted: boolean;
  invulnerable: boolean;
  invisible: boolean;
  spellImmune: boolean;
  scale: number;
}
export type AdditiveMod = 'armor' | 'damage' | 'hp' | 'hpRegen' | 'manaRegen' | 'rangedPct' | 'str' | 'agi' | 'int';

/** What a buff does: stat changes, flags, a per-tick effect, and its look (`visual`). */
export interface BuffData extends Partial<Record<AdditiveMod, number>> {
  speedMul?: number;
  attackSpeed?: number;
  scale?: number;
  stun?: boolean;
  root?: boolean;
  invulnerable?: boolean;
  invisible?: boolean;
  spellImmune?: boolean;
  /** Effect the renderers show (shield, slow, roots, ...). */
  visual?: string;
  /** Replace an existing buff with the same id even if it lasts longer. */
  replace?: boolean;
  aura?: boolean;
  /** Wind Walk: damage added to the next attack. */
  bonusDamage?: number;
  /** Bladestorm: time accumulated toward the next damage tick. */
  acc?: number;
  /** Dominion: the age bonus applied. */
  k?: number;
  tick?(u: Unit, dt: number, b: Buff): void;
  onEnd?(u: Unit, b: Buff): void;
}
export interface Buff extends BuffData {
  id: string;
  /** Seconds left. */
  time: number;
  total: number;
}

/** Where creeps and guards stand, and how far they chase. */
export interface GuardPos extends Point {
  facing?: number;
  leash?: number;
}

export interface Channel {
  id: string;
  duration: number;
  interval: number;
  point: Point;
  tick(): void;
  elapsed: number;
  timer: number;
}
export type ChannelSpec = Omit<Channel, 'elapsed' | 'timer'>;

export type Resource = 'gold' | 'lumber';
export interface Carry {
  kind: Resource;
  amount: number;
}
export interface HarvestState {
  phase: 'goto' | 'wait' | 'inside' | 'chop';
  timer: number;
  kind?: Resource;
  mine?: Unit | null;
  tree?: Tree | null;
  /** Inside a gold mine (hidden and untargetable). */
  inside?: boolean;
}

export interface TrainItem {
  type: string;
  time: number;
  total: number;
}
/** A building turning into another (`to`) or researching the next age (`age`). */
export interface Upgrading {
  to?: string;
  age?: number;
  time: number;
  total: number;
}
export interface Researching {
  upg: string;
  time: number;
  total: number;
}
export interface Progress {
  time: number;
  total: number;
}
/** Rally point of a production building; trained units go there (or to its target). */
export interface Rally extends Point {
  target?: Unit | Tree | null;
}

export interface InventoryItem {
  id: string;
  charges: number;
}

// -------------------------------------------------------------------- world
export interface GroundItem {
  id: string;
  x: number;
  z: number;
  taken: boolean;
  spawnTime: number;
}
/** An item for sale at a Marketplace (one of each). */
export interface Ware {
  id: string;
  stock: number;
}
export interface Corpse {
  type: string;
  owner: Player;
  x: number;
  z: number;
  facing: number;
  time: number;
}
export interface CampState {
  at: Point;
  tier: number;
  types: string[];
  units: Unit[];
  cleared: boolean;
  /** Seconds until it respawns once cleared. */
  respawn: number;
  /** How dangerous the camp is for the computer generals (the creeps' levels; more for a boss). */
  power: number;
  /** Sum of the creeps' levels (picks the tier of its treasure). */
  level?: number;
  /** Quadrant (0-3), or -1 on an edge midline. */
  region: number;
  /** Unit type of the boss, in a lair. */
  boss?: string;
  /** Captives are caged here. */
  captives: boolean;
  /** Times it has been wiped out. */
  clears: number;
}

export interface GameMessage {
  text: string;
  color: string;
  time: number;
}
export interface FloatText {
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  size: number;
  t: number;
}
export interface Ping {
  x: number;
  z: number;
  color: string;
  t: number;
}
export interface GameOver {
  victory: boolean;
  text: string;
  time: number;
}
