// Shapes of the game's data tables (units, heroes, items, ages, research). Engine-free.

export type ArmorType = 'light' | 'medium' | 'heavy' | 'fortified' | 'hero' | 'unarmored';
export type AttackType = 'normal' | 'pierce' | 'siege' | 'magic' | 'hero' | 'chaos' | 'spell';
export type Attribute = 'str' | 'agi' | 'int';
/** [min, max] */
export type Range2 = [number, number];

export interface Cost {
  gold: number;
  lumber: number;
}

/** What a ranged attack fires (the renderers draw it by `kind`). */
export interface ProjectileDef {
  kind: string;
  speed?: number;
  /** Lobbed rather than flown straight. */
  arc?: boolean;
  color?: number;
}

/** A unit or building type. Fields after `abilities` are optional extras. */
export interface UnitDef {
  id: string;
  kind: 'unit' | 'building';
  name: string;
  model: string;
  hp: number;
  hpRegen: number;
  mana: number;
  manaRegen: number;
  armor: number;
  armorType: ArmorType;
  damage: Range2 | null;
  attackType: AttackType;
  attackCooldown: number;
  range: number;
  projectile: ProjectileDef | null;
  speed: number;
  turnRate: number;
  sight: number;
  radius: number;
  cost: Cost;
  food: number;
  buildTime: number;
  bounty: Range2 | null;
  level: number;
  abilities: string[];

  title?: string;
  description?: string;
  hotkey?: string;
  /** Age (1-12) an empire unit belongs to. */
  age?: number;
  /** Buildings or ages needed before this can be built or trained. */
  requires?: string[];
  worker?: boolean;
  hero?: boolean;
  summoned?: boolean;
  creep?: boolean;
  legion?: boolean;
  boss?: boolean;
  undead?: boolean;
  caravan?: boolean;
  neutral?: boolean;
  invulnerable?: boolean;
  cavalry?: boolean;
  vehicle?: boolean;
  firearm?: boolean;
  bonusVsCavalry?: number;
  cleave?: number;
  splash?: number;
  minRange?: number;
  attackGround?: boolean;
  /** Shots per attack. */
  salvo?: number;
  /** Buildings: side of the square footprint, in cells. */
  footprint?: number;
  ageNames?: string[];
  ageModels?: string[];
  hpByAge?: number[];
  armorByAge?: number[];
  damageByAge?: Range2[];
  cooldownByAge?: number[];
  projectileByAge?: ProjectileDef[];
  foodProvided?: number;
  housing?: number;
  housingByAge?: number[];
  foodRateByAge?: number[];
  needsRoad?: boolean;
  /** Accepts gold and lumber (true), or one kind of resource. */
  dropOff?: boolean | 'gold' | 'lumber';
  trains?: string[];
  researches?: string[];
  tier?: number;
  nukes?: boolean;
  upgradesTo?: string;
  wall?: boolean;
  gate?: boolean;
  revivesHeroes?: boolean;
  sanctuary?: boolean;
  shop?: string;
  modelColor?: number;
  mercenaries?: string[];
}

export interface HeroDef {
  primary: Attribute;
  /** [base, growth per level] */
  str: Range2;
  agi: Range2;
  int: Range2;
  abilities: string[];
  blurb: string;
  icon: string;
}

export type ItemStat = 'speed' | 'damage' | 'armor' | 'str' | 'agi' | 'int' | 'hp' | 'hpRegen' | 'manaRegen' | 'lifesteal';
export type ItemUse = 'heal' | 'mana' | 'townPortal' | 'xp' | 'str' | 'agi' | 'int' | 'areaHeal' | 'gold';

export interface ItemDef {
  name: string;
  icon: string;
  /** CSS colour of the item on the ground and in the inventory. */
  color: string;
  description: string;
  cost?: number;
  stats?: Partial<Record<ItemStat, number>>;
  use?: ItemUse;
  amount?: number;
  charges?: number;
  dropOnly?: boolean;
  autoUse?: boolean;
}

export interface AgeDef {
  name: string;
  icon: string;
  cost?: Cost;
  /** Research time in seconds. */
  time?: number;
  requires?: string[];
}

export interface UpgradeDef {
  name: string;
  icon: string;
  base: Cost;
  time: number;
  effect: string;
}

export interface Mood {
  min: number;
  name: string;
  icon: string;
  color: string;
  income: number;
  growth: number;
}
