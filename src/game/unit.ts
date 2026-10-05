// A Unit is any entity on the map: soldiers, heroes, creeps and buildings
// (as in Warcraft III, buildings are units too).
import { UNITS, HERO_XP, MAX_HERO_LEVEL, MAX_AGE } from '../data/units.ts';
import { HEROES } from '../data/heroes.ts';
import { ITEMS } from '../data/items.ts';
import type { Attribute, HeroDef, ItemStat, ProjectileDef, Range2, UnitDef } from '../data/types.ts';
import type { Game } from './game.ts';
import type { UnitViewHandle } from './hooks.ts';
import type {
  AdditiveMod, Buff, BuffData, CampState, Carry, Channel, GuardPos, HarvestState, InventoryItem, Mods, Order, OrderOf,
  Player, Progress, Rally, Researching, TrainItem, Upgrading,
} from './types.ts';

let nextId = 1;

export interface SpawnOptions {
  facing?: number;
  /** Age style of a structure (defaults to its owner's age). */
  ageLevel?: number;
  illusion?: boolean;
  summoned?: boolean;
  /** Seconds a summon lasts. */
  lifetime?: number;
  /** Gold in a gold mine. */
  gold?: number;
  /** Place a building as a construction site. */
  construction?: boolean;
}

export type AnimName = 'stand' | 'walk' | 'attack' | 'cast' | 'work' | 'death';

const ADDITIVE_MODS: readonly AdditiveMod[] = ['armor', 'damage', 'hp', 'hpRegen', 'manaRegen', 'rangedPct', 'str', 'agi', 'int'];

export class Unit {
  readonly id: number;
  readonly game: Game;
  def: UnitDef;
  type: string;
  owner: Player;
  x: number;
  z: number;
  facing: number;
  readonly isBuilding: boolean;
  readonly isHero: boolean;
  radius: number;
  dead: boolean;
  deathTime: number;
  removed: boolean;

  // Heroes only.
  heroDef?: HeroDef;
  level?: number;
  xp?: number;
  skillPoints?: number;
  abilityLevels?: Record<string, number>;
  tomes?: Record<Attribute, number>;
  inventory?: (InventoryItem | null)[];
  /** Game time a fallen hero returns at the altar. */
  reviveAt?: number | null;
  itemCooldown?: number;

  /** Age style of a structure. */
  ageLevel: number;
  isIllusion: boolean;
  summoned: boolean;
  /** Seconds left for summons and illusions. */
  lifetime: number | null;

  buffs: Map<string, Buff>;
  mods: Mods;
  cooldowns: Record<string, number>;
  autocast: Record<string, boolean>;
  hp: number;
  mana: number;

  // Orders / movement
  order: Order;
  orderQueue: Order[];
  path: { x: number; z: number }[] | null;
  pathIndex: number;
  pathGoal: { x: number; z: number } | null;
  pathVersion: number;
  stuckTime: number;
  waitPath: boolean;
  moving: boolean;
  lastProgressDist?: number;
  progressTimer?: number;
  noProgress?: number;
  failedPaths?: number;
  exhausted?: number;
  attackTimer: number;
  windup: number;
  windupTarget: Unit | null;
  windWalkStrike?: boolean;
  lastShotAt?: number;
  /** Alternates twin barrels. */
  shotIndex?: number;
  castTimer: number;
  castOrder?: OrderOf<'cast'> | null;
  channel: Channel | null;
  autoTimer?: number;
  lastAttackedAt: number;
  lastAttacker: Unit | null;
  acquireTimer: number;
  /** Creeps and Legion guards return here. */
  guardPos: GuardPos | null;
  camp: CampState | null;
  /** Kalenden's wave units: the general they march on. */
  wave?: { target: Player };
  raider?: boolean;
  rebel?: boolean;
  caravan?: boolean;
  onDeath?: (killer: Unit | null | undefined) => void;

  // Buildings
  underConstruction: boolean;
  buildProgress: number;
  builders: Set<Unit>;
  buildFrame?: number;
  buildersThisFrame?: number;
  trainQueue: TrainItem[];
  upgrading: Upgrading | null;
  researching: Researching | null;
  rally: Rally | null;
  /** Bottom-left cell of a building's footprint. */
  cell!: { x: number; z: number };
  goldLeft: number;
  /** The Peasant inside a gold mine. */
  occupant?: Unit | null;
  /** Houses: connected to a town center by road. */
  roadConnected?: boolean;
  nukeBuild?: Progress | null;
  nukeReady?: boolean;
  /** Mercenary camps: hires left per type, and the restock timer. */
  stock?: Record<string, number>;
  stockTimer?: number;

  // Workers
  carry: Carry | null;
  harvest: HarvestState | null;
  buildSoundTimer?: number;

  // Animation
  anim: AnimName;
  animTime: number;
  walkCycle: number;
  /** The renderer's object for this unit. */
  view: UnitViewHandle | null;
  seenByHuman: boolean;
  selected: boolean;

  constructor(game: Game, typeId: string, owner: Player, x: number, z: number, opts: SpawnOptions = {}) {
    const def = UNITS[typeId];
    if (!def) throw new Error(`Unknown unit type ${typeId}`);
    this.id = nextId++;
    this.game = game;
    this.def = def;
    this.type = typeId;
    this.owner = owner; // player object
    this.x = x;
    this.z = z;
    this.facing = opts.facing ?? Math.PI;
    this.isBuilding = def.kind === 'building';
    this.isHero = !!def.hero;
    this.radius = def.radius;
    this.dead = false;
    this.deathTime = 0;
    this.removed = false;

    // Hero state (must exist before maxHp is read).
    if (this.isHero) {
      const heroDef = HEROES[typeId]!;
      this.heroDef = heroDef;
      this.level = 1;
      this.xp = 0;
      this.skillPoints = 1;
      this.abilityLevels = {};
      for (const a of heroDef.abilities) this.abilityLevels[a] = 0;
      this.tomes = { str: 0, agi: 0, int: 0 };
      this.inventory = [null, null, null, null, null, null];
    }
    // Age-styled structures remember the age they were built (or rebuilt) in.
    this.ageLevel = Math.max(1, Math.min(MAX_AGE, opts.ageLevel ?? owner?.tier ?? 1));
    this.isIllusion = !!opts.illusion;
    this.summoned = !!def.summoned || !!opts.summoned;
    this.lifetime = opts.lifetime ?? null; // seconds remaining for summons

    this.buffs = new Map();
    this.mods = emptyMods();
    this.cooldowns = {};
    this.autocast = {};
    for (const a of def.abilities) this.autocast[a] = true;

    this.hp = this.maxHp;
    this.mana = this.maxMana;

    // Orders / movement
    this.order = { type: 'idle' };
    this.orderQueue = [];
    this.path = null;
    this.pathIndex = 0;
    this.pathGoal = null;
    this.pathVersion = -1;
    this.stuckTime = 0;
    this.waitPath = false;
    this.moving = false;
    this.attackTimer = 0;
    this.windup = 0;
    this.windupTarget = null;
    this.castTimer = 0;
    this.channel = null;
    this.lastAttackedAt = -999;
    this.lastAttacker = null;
    this.acquireTimer = Math.random() * 0.4;
    this.guardPos = null; // creeps & legion guards return here
    this.camp = null;

    // Buildings
    this.underConstruction = false;
    this.buildProgress = 1;
    this.builders = new Set();
    this.trainQueue = [];
    this.upgrading = null;
    this.researching = null;
    this.rally = null;
    this.goldLeft = def.id === 'goldmine' ? (opts.gold ?? 12500) : 0;

    // Workers
    this.carry = null; // { kind: 'gold'|'lumber', amount }
    this.harvest = null;

    // Animation
    this.anim = 'stand';
    this.animTime = 0;
    this.walkCycle = 0;
    this.view = null; // render-side object
    this.seenByHuman = false;
    this.selected = false;
  }

  get name(): string {
    return this.def.ageNames?.[this.ageLevel - 1] ?? this.def.name;
  }
  /** Model for this unit (houses, walls and gates change with the age). */
  get modelId(): string {
    return this.def.ageModels?.[this.ageLevel - 1] ?? this.def.model;
  }

  // ------------------------------------------------------------- attributes
  heroAttr(attr: Attribute): number {
    if (!this.isHero) return 0;
    const [base, growth] = this.heroDef![attr];
    let v = Math.floor(base + growth * (this.level! - 1)) + this.tomes![attr];
    for (const it of this.inventory!) if (it && ITEMS[it.id]!.stats?.[attr]) v += ITEMS[it.id]!.stats![attr]!;
    v += this.mods[attr] || 0;
    return v;
  }
  get str(): number {
    return this.heroAttr('str');
  }
  get agi(): number {
    return this.heroAttr('agi');
  }
  get int(): number {
    return this.heroAttr('int');
  }

  itemStat(key: ItemStat): number {
    if (!this.isHero) return 0;
    let v = 0;
    for (const it of this.inventory!) if (it && ITEMS[it.id]!.stats?.[key]) v += ITEMS[it.id]!.stats![key]!;
    return v;
  }

  get maxHp(): number {
    let hp = this.isHero ? 100 + 25 * this.str : (this.def.hpByAge?.[this.ageLevel - 1] ?? this.def.hp);
    const up = this.owner?.upgrades;
    if (up && !this.isHero) hp *= this.isBuilding ? 1 + 0.1 * (up['masonry'] || 0) : 1 + 0.06 * (up['vitality'] || 0);
    hp += this.itemStat('hp') + (this.mods.hp || 0);
    if (this.owner?.handicap && !this.isBuilding) hp *= this.owner.handicap;
    return Math.round(hp);
  }
  get maxMana(): number {
    if (this.isHero) return Math.round(15 * this.int);
    return this.def.mana;
  }
  get hpRegen(): number {
    let r = this.isHero ? 0.25 + 0.05 * this.str : this.def.hpRegen;
    if (!this.isHero && !this.isBuilding && this.owner?.upgrades?.['medicine']) r += 0.4 * this.owner.upgrades['medicine'];
    return r + this.itemStat('hpRegen') + (this.mods.hpRegen || 0);
  }
  get manaRegen(): number {
    const r = this.isHero ? 0.01 + 0.05 * this.int : this.def.manaRegen;
    return r + this.itemStat('manaRegen') + (this.mods.manaRegen || 0);
  }
  get armor(): number {
    let a = this.def.armorByAge?.[this.ageLevel - 1] ?? this.def.armor;
    if (this.isHero) a += this.agi * 0.3;
    else if (!this.isBuilding && this.owner?.upgrades) a += this.owner.upgrades['armor'] || 0;
    return a + this.itemStat('armor') + (this.mods.armor || 0);
  }
  /** Projectile fired by this unit (towers change ammunition with the ages). */
  get projectile(): ProjectileDef | null {
    return this.def.projectileByAge?.[this.ageLevel - 1] ?? this.def.projectile;
  }
  get damageRange(): Range2 | null {
    const d = this.def.damageByAge?.[this.ageLevel - 1] ?? this.def.damage;
    if (!d) return null;
    let bonus = this.itemStat('damage') + (this.mods.damage || 0);
    if (this.isHero) bonus += this[this.heroDef!.primary];
    let mult = 1;
    if (!this.isHero && this.owner?.upgrades?.['weaponry']) mult *= 1 + 0.06 * this.owner.upgrades['weaponry'];
    if (this.projectile && this.mods.rangedPct) mult += this.mods.rangedPct;
    if (this.owner?.damageMult && !this.isBuilding) mult *= this.owner.damageMult;
    return [Math.round((d[0] + bonus) * mult), Math.round((d[1] + bonus) * mult)];
  }
  get attackCooldown(): number {
    let cd = this.def.cooldownByAge?.[this.ageLevel - 1] ?? this.def.attackCooldown;
    if (this.isHero) cd /= 1 + 0.02 * this.agi;
    cd /= this.mods.attackSpeed || 1;
    return cd;
  }
  get speed(): number {
    let s = this.def.speed + this.itemStat('speed');
    s *= this.mods.speedMul || 1;
    if (!this.isHero && this.owner?.upgrades?.['mobility']) s *= 1 + 0.04 * this.owner.upgrades['mobility'];
    return Math.min(7, s);
  }
  get range(): number {
    return this.def.range;
  }
  get sight(): number {
    let s = this.def.sight;
    if (!this.isBuilding && this.game.isNight) s *= 0.8;
    return s;
  }
  get canAttack(): boolean {
    return !!this.def.damage && !this.underConstruction;
  }
  get canMove(): boolean {
    return !this.isBuilding && this.def.speed > 0;
  }
  get xpLevel(): number {
    return this.isHero ? this.level! : this.def.level;
  }

  // ------------------------------------------------------------------ state
  get alive(): boolean {
    return !this.dead;
  }
  get stunned(): boolean {
    return !!this.mods.stunned;
  }
  get rooted(): boolean {
    return !!this.mods.rooted;
  }
  get invulnerable(): boolean {
    return !!this.def.invulnerable || !!this.mods.invulnerable;
  }
  get invisible(): boolean {
    return !!this.mods.invisible;
  }
  get spellImmune(): boolean {
    return !!this.mods.spellImmune;
  }
  get hidden(): boolean {
    return !!this.harvest?.inside;
  }

  /** Can this unit be targeted by `viewer`'s owner? */
  targetableBy(viewer: { owner: Player }): boolean {
    if (this.dead || this.hidden || this.removed) return false;
    if (this.invisible && this.game.isEnemy(viewer.owner, this.owner)) return false;
    return true;
  }

  // ------------------------------------------------------------------ buffs
  addBuff(id: string, duration: number, data: BuffData = {}): Buff {
    const existing = this.buffs.get(id);
    if (existing && existing.time > duration && !data.replace) return existing;
    const b: Buff = { id, time: duration, total: duration, ...data };
    this.buffs.set(id, b);
    this.recomputeMods();
    return b;
  }
  removeBuff(id: string): void {
    if (this.buffs.delete(id)) this.recomputeMods();
  }
  hasBuff(id: string): boolean {
    return this.buffs.has(id);
  }
  recomputeMods(): void {
    const hpBefore = this.maxHp;
    const m = emptyMods();
    for (const b of this.buffs.values()) {
      for (const k of ADDITIVE_MODS) {
        const v = b[k];
        if (v) m[k] += v;
      }
      if (b.speedMul) m.speedMul *= b.speedMul;
      if (b.attackSpeed) m.attackSpeed *= b.attackSpeed;
      if (b.stun) m.stunned = true;
      if (b.root) m.rooted = true;
      if (b.invulnerable) m.invulnerable = true;
      if (b.invisible) m.invisible = true;
      if (b.spellImmune) m.spellImmune = true;
      if (b.scale) m.scale *= b.scale;
    }
    this.mods = m;
    // Keep current HP when max HP changes (e.g. Avatar adds/removes HP).
    const hpAfter = this.maxHp;
    if (hpAfter !== hpBefore && !this.dead) {
      if (hpAfter > hpBefore) this.hp += hpAfter - hpBefore;
      this.hp = Math.min(this.hp, hpAfter);
      if (this.hp <= 0) this.hp = 1;
    }
  }

  updateBuffs(dt: number): void {
    let changed = false;
    for (const b of this.buffs.values()) {
      if (b.tick) b.tick(this, dt, b);
      b.time -= dt;
      if (b.time <= 0) {
        this.buffs.delete(b.id);
        if (b.onEnd) b.onEnd(this, b);
        changed = true;
      }
    }
    if (changed) this.recomputeMods();
  }

  // ------------------------------------------------------------------- hero
  get xpForNext(): number | null {
    return this.level! >= MAX_HERO_LEVEL ? null : HERO_XP[this.level! + 1]!;
  }
  get xpForCurrent(): number {
    return HERO_XP[this.level!] ?? 0;
  }

  abilityLevel(id: string): number {
    if (this.isHero) return this.abilityLevels![id] ?? 0;
    return this.def.abilities.includes(id) ? 1 : 0;
  }

  get abilityIds(): string[] {
    return this.isHero ? this.heroDef!.abilities : this.def.abilities;
  }

  inventoryFreeSlot(): number {
    if (!this.isHero) return -1;
    return this.inventory!.findIndex((s) => s === null);
  }

  distTo(other: { x: number; z: number }): number {
    return Math.hypot(other.x - this.x, other.z - this.z);
  }
  /** Edge-to-edge distance. */
  edgeDist(other: { x: number; z: number; radius: number }): number {
    return Math.hypot(other.x - this.x, other.z - this.z) - this.radius - other.radius;
  }
}

function emptyMods(): Mods {
  return {
    armor: 0, damage: 0, hp: 0, hpRegen: 0, manaRegen: 0, rangedPct: 0, str: 0, agi: 0, int: 0,
    speedMul: 1, attackSpeed: 1, stunned: false, rooted: false, invulnerable: false, invisible: false,
    spellImmune: false, scale: 1,
  };
}
