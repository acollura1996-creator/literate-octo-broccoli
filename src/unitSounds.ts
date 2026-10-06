// What every unit sounds like, and the game events that play it.
//
// The simulation only names generic sounds through hooks.sound ('swordHit' at a target, 'arrowShoot'
// at a shooter, 'death' where something fell). UnitSounds sits between the game and the audio: the
// sounds the simulation asks for during a frame's steps are held back, and once the steps are done
// it plays what happened in terms of the units involved: a Clubman's club thudding into flesh, a
// Footman's sword ringing off a Knight's plate, a musket's boom, a trebuchet's creak and the crash
// of its boulder, a wolf's yelp, a tank brewing up. Generic sounds an event explains are dropped;
// anything else plays as before.
//
// Where the events come from:
//  - blows and missiles that land: the effects' hit spark (Effects.onHit), with the target's
//    lastAttacker as the attacker;
//  - missiles: caught the moment the simulation names a shot's sound (the newest projectile is that
//    shot), then followed until they land, so even a bullet that lands within the frame is heard;
//  - shots, deaths, creep camps and moving vehicles: the game's state after the steps.
//
// Read-only towards the game, and it never touches Math.random (headless runs seed it).
import { MOVE_LOOPS, barkVoice, hasSfx } from './audio.ts';
import type { BarkKind, Material, Missile, MoveLoop, Weapon } from './audio.ts';
import type { UnitDef } from './data/types.ts';
import type { Game } from './game/game.ts';
import type { Projectile, Shot } from './game/projectiles.ts';
import type { CampState } from './game/types.ts';
import type { Unit } from './game/unit.ts';

/** Where the sounds go (main.ts: the Babylon.js spatial backend, or the live synth). */
export interface SoundSink {
  /** Effect `name` at a map position (fading with distance from the camera), or centred; `rate` scales its pitch. */
  sfx(name: string, volume: number, x?: number, z?: number, rate?: number): void;
  /** A unit's voice line. */
  bark(voice: string, kind: BarkKind, volume?: number): void;
  /** Level (0 = silent) and centre of a movement loop. */
  movement?(loop: MoveLoop, level: number, x: number, z: number): void;
}

// --------------------------------------------------------------------------------------------
// Unit types -> sounds. Explicit tables for the known types; anything new (more creeps, bosses,
// neutral buildings) falls back on its definition (age, armour, size, flags).
// --------------------------------------------------------------------------------------------

const WEAPON_OF: Record<string, Weapon> = {
  peasant: 'tool', caveman: 'club', hoplite: 'spear', spearman: 'spear', chariot: 'blade', legionary: 'sword',
  war_elephant: 'tusk', footman: 'sword', scout_rider: 'saber', knight: 'sword', champion: 'blade', royal_knight: 'hammer',
  dragoon: 'saber', exo_trooper: 'energy', paladin: 'hammer', blademaster: 'katana', mountainking: 'hammer',
  kobold: 'club', gnoll: 'club', wolf: 'bite', spider: 'fang', ogre: 'maul', ogre_lord: 'maul', rock_golem: 'fist',
  kalenden: 'blade', dark_knight: 'blade', skeleton: 'sword', cargo_wagon: 'club',
  // The map's creeps and lair bosses.
  murloc: 'spear', brigand: 'sword', bandit_lord: 'axe', broodmother: 'fang',
};

/** A melee unit's weapon. */
export function weaponOf(def: UnitDef): Weapon {
  const w = WEAPON_OF[def.id];
  if (w) return w;
  if (def.creep) return def.radius >= 0.65 ? 'maul' : 'claw';
  if (def.vehicle) return 'fist';
  if ((def.age ?? 0) >= 10) return 'energy';
  if (def.cavalry) return 'saber';
  if (def.age === 1) return 'club';
  if (def.radius >= 0.8) return 'maul';
  return def.armorType === 'heavy' ? 'sword' : 'axe';
}

const MATERIAL_OF: Record<string, Material> = {
  water_elemental: 'water', rock_golem: 'stone', skeleton: 'bone', skeleton_archer: 'bone', ballista: 'wood', catapult: 'wood',
  trebuchet: 'wood', cargo_wagon: 'wood', cannon: 'metal', howitzer: 'metal', paladin: 'metal', mountainking: 'metal',
  kalenden: 'metal', dark_knight: 'metal', ogre: 'flesh', ogre_lord: 'flesh', farm: 'wood', war_elephant: 'flesh',
};

/** What a unit sounds like when it is struck (its "armour sound"). */
export function materialOf(u: Unit): Material {
  const def = u.def;
  const m = MATERIAL_OF[def.id];
  if (m) return m;
  if (u.isBuilding) {
    if (def.neutral) return 'stone';
    const age = u.ageLevel || u.owner?.tier || 1;
    return age <= 2 ? 'wood' : age <= 6 ? 'stone' : 'metal';
  }
  if (def.vehicle) return 'metal';
  if (def.undead) return def.armorType === 'heavy' ? 'metal' : 'bone';
  if (def.creep || def.hero) return 'flesh';
  if (def.minRange) return (def.age ?? 0) <= 5 ? 'wood' : 'metal';
  return def.armorType === 'heavy' ? 'metal' : 'flesh';
}

const DEATH_OF: Record<string, string> = {
  war_elephant: 'dieElephant', water_elemental: 'dieWater', wolf: 'dieWolf', spider: 'dieSpider', ogre: 'dieOgre',
  ogre_lord: 'dieOgre', rock_golem: 'dieGolem', drake: 'dieDrake', kobold: 'dieKobold', gnoll: 'dieGnoll',
  gnoll_archer: 'dieGnoll', forest_troll: 'dieTroll', skeleton: 'dieSkeleton', skeleton_archer: 'dieSkeleton',
  dark_knight: 'dieUndead', kalenden: 'dieBoss', combat_drone: 'dieDrone', mech_walker: 'dieMech', titan: 'dieMech',
  ranger: 'dieWoman', sorceress: 'dieWoman', caveman: 'dieBrute', cargo_wagon: 'dieSiege', paladin: 'dieKnight',
  mountainking: 'dieKnight', murloc: 'dieMurloc', brigand: 'dieBrute', harpy: 'dieHarpy', troll_shaman: 'dieTroll',
  naga_siren: 'dieNaga', dragon: 'dieDragon', hydra: 'dieHydra', bandit_lord: 'dieKnight', broodmother: 'dieSpider',
  merchant_wagon: 'dieSiege',
};
/** Voice pitch of a death cry (playback rate) where it isn't 1. */
const PITCH_OF: Record<string, number> = {
  peasant: 1.06, mountainking: 0.84, archmage: 0.92, rock_thrower: 0.95, ogre_lord: 0.85, javelineer: 1.04, bandit_lord: 0.8,
  broodmother: 0.62, troll_shaman: 1.08,
};

/** A unit's death. */
export function deathOf(def: UnitDef): string {
  const d = DEATH_OF[def.id];
  if (d) return d;
  if (def.boss) return 'dieBoss';
  if (def.vehicle) return 'dieVehicle';
  // Siege engines: timber breaking up, or (gunpowder pieces) the powder going up.
  if (def.minRange) return (def.age ?? 0) <= 5 ? 'dieSiege' : 'dieVehicle';
  if (def.cavalry) return 'dieHorse';
  if (def.undead) return def.armorType === 'heavy' ? 'dieUndead' : 'dieSkeleton';
  if (def.creep || def.legion) return def.radius >= 0.65 ? 'dieOgre' : 'dieGnoll';
  if ((def.age ?? 0) >= 11) return 'dieCyborg';
  if (def.armorType === 'heavy') return 'dieKnight';
  return 'dieMan';
}

/** A building falling: by what it's built of; bigger ones are deeper. */
function collapseOf(u: Unit): string {
  if (u.def.legion) return 'collapseStone';
  const age = u.ageLevel || 1;
  if (age >= 10 && (u.def.wall || u.def.gate)) return 'collapseEnergy';
  const m = materialOf(u);
  return m === 'wood' ? 'collapseWood' : m === 'metal' ? (age >= 11 ? 'collapseEnergy' : 'collapseMetal') : 'collapseStone';
}

/** Creature calls: [idle call near its camp, roar when the camp is attacked]. */
const CALLS_OF: Record<string, [string, string]> = {
  wolf: ['wolfHowl', 'wolfSnarl'], spider: ['spiderChitter', 'spiderHiss'], ogre: ['ogreGrumble', 'ogreRoar'],
  ogre_lord: ['ogreGrumble', 'ogreRoar'], kobold: ['koboldChatter', 'koboldYell'], gnoll: ['gnollCackle', 'gnollYell'],
  gnoll_archer: ['gnollCackle', 'gnollYell'], forest_troll: ['trollMutter', 'trollYell'], rock_golem: ['golemGrind', 'golemRumble'],
  drake: ['drakeGrowl', 'drakeRoar'], skeleton: ['undeadMoan', 'undeadMoan'], skeleton_archer: ['undeadMoan', 'undeadMoan'],
  dark_knight: ['undeadMoan', 'undeadMoan'], murloc: ['murlocGurgle', 'murlocYell'], brigand: ['brigandMutter', 'brigandShout'],
  harpy: ['harpyCall', 'harpyScreech'], troll_shaman: ['shamanChant', 'trollYell'], naga_siren: ['nagaHiss', 'nagaHiss'],
  dragon: ['dragonGrowl', 'dragonRoar'], hydra: ['hydraHiss', 'hydraHiss'], bandit_lord: ['brigandMutter', 'banditLaugh'],
  broodmother: ['spiderChitter', 'spiderScreech'],
};

function callsOf(def: UnitDef): [string, string] | null {
  const c = CALLS_OF[def.id];
  if (c) return c;
  if (def.boss || !(def.creep || def.legion)) return null;
  if (def.undead) return ['undeadMoan', 'undeadMoan'];
  return def.radius >= 0.65 ? ['ogreGrumble', 'ogreRoar'] : ['gnollCackle', 'gnollYell'];
}

const LOOP_OF: Record<string, MoveLoop> = {
  steam_tank: 'tracks', half_track: 'tracks', tank: 'tracks', rocket_artillery: 'tracks', stealth_tank: 'tracks',
  hover_tank: 'hover', starfighter: 'hover', combat_drone: 'hover', graviton: 'hover', mech_walker: 'mech', titan: 'mech',
  ballista: 'wheels', catapult: 'wheels', trebuchet: 'wheels', cannon: 'wheels', howitzer: 'wheels', cargo_wagon: 'wheels',
};

/** The movement loop a unit adds to while it moves (null: none). */
export function moveLoopOf(def: UnitDef): MoveLoop | null {
  const l = LOOP_OF[def.id];
  if (l) return l;
  if (def.vehicle) return (def.age ?? 0) >= 10 ? 'hover' : 'tracks';
  if (def.cavalry && def.id !== 'war_elephant') return 'hooves';
  if (def.minRange) return 'wheels';
  return null;
}

const SHOT_OF: Record<string, string> = {
  rock_thrower: 'slingShot', bowman: 'bowShot', gnoll_archer: 'bowShot', skeleton_archer: 'bowShot', ranger: 'bowShot',
  archer: 'longbowShot', crossbowman: 'crossbowShot', javelineer: 'javelinThrow', ballista: 'ballistaShot',
  catapult: 'catapultLaunch', trebuchet: 'trebuchetLaunch', musketeer: 'musketShot', grenadier: 'grenadeThrow',
  cannon: 'cannonShot', rifleman: 'rifleShot', machine_gunner: 'machineGun', steam_tank: 'tankShot', howitzer: 'howitzerShot',
  flamethrower: 'flameRoar', sniper: 'sniperShot', half_track: 'machineGun', infantry: 'assaultBurst', bazooka: 'rocketLaunch',
  tank: 'tankShot', rocket_artillery: 'rocketArty', railgunner: 'railShot', combat_drone: 'droneGun', stealth_tank: 'railShot',
  laser_trooper: 'laserShot', hover_tank: 'plasmaShot', mech_walker: 'plasmaHeavy', void_trooper: 'plasmaShot',
  starfighter: 'laserTwin', titan: 'plasmaHeavy', graviton: 'gravitonShot', priest: 'holyBolt', sorceress: 'arcaneBolt',
  battlemage: 'fireballCast', archmage: 'frostBolt', water_elemental: 'waterBolt', forest_troll: 'axeThrow',
  drake: 'drakeBreath', altar: 'holyBolt', dark_tower: 'felBolt', harpy: 'harpyShot', troll_shaman: 'shamanBolt',
  naga_siren: 'frostBolt', dragon: 'drakeBreath', hydra: 'acidSpit',
};
const SHOT_OF_KIND: Record<string, string> = {
  stone: 'slingShot', arrow: 'bowShot', javelin: 'javelinThrow', bolt: 'arcaneBolt', fireball: 'fireballCast', rock: 'catapultLaunch',
  bullet: 'rifleShot', grenade: 'grenadeThrow', cannonball: 'cannonShot', shell: 'tankShot', flame: 'flameRoar', rocket: 'rocketLaunch',
  rail: 'railShot', laser: 'laserShot', plasma: 'plasmaShot', axe: 'axeThrow',
};
/** Heavy guns are heard from further off. */
const LOUD_SHOTS = new Set(['cannonShot', 'howitzerShot', 'tankShot', 'catapultLaunch', 'trebuchetLaunch', 'sniperShot', 'plasmaHeavy', 'gravitonShot', 'musketShot']);

/** The sound of a unit firing its current missile (towers change weapons with the ages). */
export function shotOf(u: Unit): string | null {
  const p = u.projectile;
  if (!p) return null;
  if (u.type === 'guardtower') {
    if (p.kind === 'arrow') return 'longbowShot';
    if (p.kind === 'bullet') return u.ageLevel <= 6 ? 'musketShot' : 'machineGun';
    return 'laserTwin';
  }
  return SHOT_OF[u.type] ?? SHOT_OF_KIND[p.kind] ?? null;
}

/** Bolts: each caster's magic lands differently. */
const BOLT_IMPACT: Record<string, string> = {
  priest: 'impHoly', altar: 'impHoly', sorceress: 'impArcane', archmage: 'impFrost', water_elemental: 'impWater', dark_tower: 'impFel',
  harpy: 'impArcane', troll_shaman: 'impFel', naga_siren: 'impFrost', hydra: 'impAcid',
};
/** Splash by attacker, where its missile's kind isn't enough. */
const SPLASH_OF: Record<string, string> = { graviton: 'boomGraviton', hydra: 'impAcid', dragon: 'boomFire' };
const MISSILE_OF_KIND: Record<string, Missile> = { arrow: 'arrow', axe: 'arrow', javelin: 'arrow', stone: 'blunt', bullet: 'bullet', laser: 'beam', plasma: 'beam', rail: 'rail' };
const SPLASH_OF_KIND: Record<string, string> = {
  rock: 'boomRock', grenade: 'boomGrenade', cannonball: 'boomCannon', shell: 'boomShell', rocket: 'boomRocket', plasma: 'boomPlasma',
  fireball: 'boomFire', flame: 'flameLick', stone: 'boomRock', bolt: 'impArcane',
};

/** A building answering a click, Warcraft III style (by type and, for most, by age). */
export function buildingSound(u: Unit): string {
  const age = u.ageLevel || 1;
  const tier = u.owner?.tier ?? age;
  if (u.underConstruction) return 'build';
  switch (u.type) {
    case 'townhall': return age <= 2 ? 'selTribal' : age <= 7 ? 'selBell' : age <= 9 ? 'selCityHall' : 'selNexus';
    case 'house': return age <= 6 ? 'selHouse' : 'selHouseModern';
    case 'farm': return age <= 6 ? 'selFarm' : age <= 9 ? 'selTractor' : 'selHydro';
    case 'lumberyard': return 'selLumber';
    case 'barracks': return tier <= 5 ? 'selBarracks' : tier <= 9 ? 'selBarracksGun' : 'selBarracksFuture';
    case 'stable': return 'selStable';
    case 'research_center': return age <= 6 ? 'selAcademy' : age <= 9 ? 'selLab' : 'selComputer';
    case 'workshop': return 'selWorkshop';
    case 'sanctum': return 'selArcane';
    case 'factory': return 'selFactory';
    case 'missile_silo': return 'selSilo';
    case 'scouttower': return 'selTower';
    case 'guardtower': return age <= 5 ? 'selTower' : age <= 9 ? 'selBunker' : 'selTurret';
    case 'wall': return age >= 10 ? 'selForce' : 'selWall';
    case 'gate': return age >= 10 ? 'selForce' : 'selGate';
    case 'altar': return 'selAltar';
    case 'kalenden_keep': return 'selKeep';
    case 'dark_tower': return 'selSpire';
    case 'goldmine': return 'selMine';
    case 'shop': return 'selShop';
    case 'vault': return 'selVault';
    case 'mercenary_camp': return 'selMercs';
    case 'fountain':
    case 'fountain_mana':
      return 'selFountain';
    case 'tavern': return 'selTavern';
    case 'goblin_lab': return 'selGoblinLab';
    case 'waygate': return 'selWaygate';
    case 'shrine': return 'selShrine';
    case 'cage': return 'selCage';
    default:
      if (u.def.shop) return 'selShop';
      if (u.def.mercenaries) return 'selMercs';
      if (u.def.legion) return 'selSpire';
      return 'selBuilding';
  }
}

// --------------------------------------------------------------------------------------------
// The director
// --------------------------------------------------------------------------------------------

/** Base volumes (before the fall-off with distance). */
const VOL = { melee: 0.5, shot: 0.5, loudShot: 0.65, impact: 0.42, boom: 0.6, death: 0.5, collapse: 0.75, idle: 0.45, roar: 0.75, select: 0.7, ready: 0.8 };
/** Creature calls are heard within this distance of the camera target. */
const CALL_RANGE = 24;
/** Movement loops gather units within this distance. */
const LOOP_RANGE = 30;

/** Generic sounds the simulation names, and the event that explains (replaces) each. */
const SHOT_NAMES = new Set(['arrowShoot', 'gunshot', 'cannon', 'rocket', 'laser', 'fire', 'magicCast', 'explosion']);

interface Queued {
  name: string;
  vol: number;
  x?: number;
  z?: number;
}

interface Hit {
  target: Unit;
  attacker: Unit | null;
  /** Where the target was when it was hit. */
  x: number;
  z: number;
}

/** A private random source (Math.random belongs to the simulation). */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const near = (ax: number, az: number, bx: number | undefined, bz: number | undefined, r: number): boolean =>
  bx !== undefined && bz !== undefined && Math.abs(ax - bx) <= r && Math.abs(az - bz) <= r;

export class UnitSounds {
  private game: Game | null = null;
  private stepping = false;
  private queue: Queued[] = [];
  private added: Unit[] = [];
  /** Game time at the end of the last scan. */
  private lastTime = 0;
  private hits: Hit[] = [];
  private readonly seenDead = new WeakSet<Unit>();
  /** Missiles in flight (caught at their launch, or seen in the list). */
  private inFlight = new Set<Projectile>();
  private readonly campCalm = new Map<CampState, boolean>();
  private readonly roaredAt = new WeakMap<object, number>();
  private nextCall = 0;
  private nextLoops = 0;
  private readonly rnd = makeRng(Date.now() ^ 0x51ed);

  constructor(
    private readonly out: SoundSink,
    /** The camera's target on the ground. */
    private readonly camera: () => { x: number; z: number },
  ) {}

  /** Follow a new game (or none). */
  attach(game: Game | null): void {
    this.silence();
    this.game = game;
    this.queue = [];
    this.added = [];
    this.hits = [];
    this.campCalm.clear();
    this.inFlight = new Set(game?.projectiles.list ?? []);
    this.lastTime = game?.time ?? 0;
    for (const u of game?.units ?? []) if (u.dead) this.seenDead.add(u);
  }

  /** The game's sound hook: held back during simulation steps, played at once otherwise. */
  simSound(name: string, vol: number, x?: number, z?: number): void {
    if (!this.stepping || !this.game) {
      this.out.sfx(name, vol, x, z);
      return;
    }
    // A basic attack's shot: the unit's own shot sound plays after the steps.
    if (SHOT_NAMES.has(name) && x !== undefined && z !== undefined && this.catchShot(x, z)) return;
    this.queue.push({ name, vol, x, z });
  }

  /** An attack landed on `target` (from the effects' hit spark). */
  hitLanded(target: Unit): void {
    this.hits.push({ target, attacker: target.lastAttacker, x: target.x, z: target.z });
  }

  /**
   * The simulation names a shot's sound right after launching it, so the newest projectile is that
   * shot when it was launched from (x, z) and is the shooter's own missile (not an ability's).
   */
  private catchShot(x: number, z: number): boolean {
    const list = this.game!.projectiles.list;
    const p = list[list.length - 1];
    if (!p || this.inFlight.has(p)) return false;
    if (p.beam) return p.t === 0 && near(p.sx, p.sz, x, z, 3);
    if (!p.from || p.kind !== p.from.projectile?.kind || !near(p.from.x, p.from.z, x, z, 0.01)) return false;
    this.inFlight.add(p);
    return true;
  }

  /** The game added a unit (a trained unit answers 'ready'; a revived hero can die again). */
  unitAdded(u: Unit): void {
    this.seenDead.delete(u);
    if (this.stepping) this.added.push(u);
  }

  /** Stop the movement loops (the game is paused, or over). */
  silence(): void {
    if (!this.out.movement) return;
    for (const l of MOVE_LOOPS) this.out.movement(l, 0, 0, 0);
    this.nextLoops = 0;
  }

  /** Call before the frame's simulation steps. */
  beginStep(): void {
    this.stepping = true;
  }

  /** Call after them: read what happened and play it. */
  endStep(): void {
    this.stepping = false;
    const g = this.game;
    const queue = this.queue;
    const added = this.added;
    const hits = this.hits;
    this.queue = [];
    this.added = [];
    this.hits = [];
    if (!g) {
      for (const q of queue) this.out.sfx(q.name, q.vol, q.x, q.z);
      return;
    }
    if (g.time === this.lastTime && !queue.length) return; // paused
    try {
      this.frame(g, queue, added, hits);
    } catch (e) {
      // Never let sound break the game loop; fall back to what the simulation asked for.
      console.error(e);
      for (const q of queue) this.out.sfx(q.name, q.vol, q.x, q.z);
    }
    this.lastTime = g.time;
  }

  /** A click on a building, or on a unit that isn't the player's (creeps answer with their calls). */
  selected(u: Unit): void {
    if (u.isBuilding) {
      this.out.sfx(buildingSound(u), VOL.select);
      return;
    }
    const voice = barkVoice(u.def);
    if (voice && (u.def.creep || u.def.legion || u.def.caravan || voice === 'wagon')) this.out.bark(voice, 'select', 0.6);
  }

  // ------------------------------------------------------------------------------------------

  private frame(g: Game, queue: Queued[], added: Unit[], hits: Hit[]): void {
    const since = this.lastTime;
    const fog = g.fog;
    const cam = this.camera();
    const deaths: Unit[] = [];
    const shooters: Unit[] = [];
    const callers: Unit[] = [];
    const loops = new Map<MoveLoop, { n: number; x: number; z: number }>();
    const wantLoops = !!this.out.movement && g.time >= this.nextLoops;

    for (const u of g.units) {
      if (u.dead) {
        if (!this.seenDead.has(u)) {
          this.seenDead.add(u);
          if (!u.isIllusion && fog.isVisible(u.x, u.z)) deaths.push(u);
        }
        continue;
      }
      if (u.lastShotAt !== undefined && u.lastShotAt > since) shooters.push(u);
      const dx = u.x - cam.x;
      const dz = u.z - cam.z;
      if ((u.def.creep || u.def.legion) && !u.isBuilding && dx * dx + dz * dz < CALL_RANGE * CALL_RANGE) callers.push(u);
      if (wantLoops && u.moving && dx * dx + dz * dz < LOOP_RANGE * LOOP_RANGE) {
        const l = moveLoopOf(u.def);
        if (l && fog.isVisible(u.x, u.z)) {
          const e = loops.get(l) ?? { n: 0, x: 0, z: 0 };
          e.n++;
          e.x += u.x;
          e.z += u.z;
          loops.set(l, e);
        }
      }
    }

    // Missiles that came down since the last frame.
    const landed: Shot[] = [];
    const now = new Set<Projectile>();
    for (const p of g.projectiles.list) if (!p.beam) now.add(p);
    for (const p of this.inFlight) if (!now.has(p) && !p.beam) landed.push(p);
    this.inFlight = now;

    // What the simulation asked for: drop what the events above explain, play the rest.
    for (const q of queue) {
      if (!this.explained(q, deaths, shooters, hits, added)) this.out.sfx(q.name, q.vol, q.x, q.z);
    }
    // A hero the player hired or revived announces itself.
    for (const u of added) {
      const voice = u.isHero && u.owner === g.human ? barkVoice(u.def) : null;
      if (voice) this.out.bark(voice, 'ready', VOL.ready);
    }

    for (const u of deaths) this.death(u);
    for (const u of shooters) {
      const s = shotOf(u);
      if (s && fog.isVisible(u.x, u.z)) this.out.sfx(s, LOUD_SHOTS.has(s) ? VOL.loudShot : VOL.shot, u.x, u.z);
    }
    for (const h of hits) this.hit(g, h);
    for (const p of landed) this.landing(g, p, hits);
    this.creatures(g, callers);
    if (wantLoops) {
      this.nextLoops = g.time + 0.25;
      for (const l of MOVE_LOOPS) {
        const e = loops.get(l);
        this.out.movement!(l, e ? Math.min(1, 0.45 + 0.12 * e.n) : 0, e ? e.x / e.n : cam.x, e ? e.z / e.n : cam.z);
      }
    }
  }

  /** Is a generic sound covered by a richer event? (A trained unit's 'unitReady' becomes its ready line.) */
  private explained(q: Queued, deaths: Unit[], shooters: Unit[], hits: Hit[], added: Unit[]): boolean {
    const { name, x, z } = q;
    if (name === 'death') return deaths.some((u) => !u.isBuilding && near(u.x, u.z, x, z, 0.5));
    // The simulation names a blow's sound right before its hit spark, at the target.
    if (name === 'swordHit' || name === 'heavyHit' || (name === 'arrowHit' && q.vol < 0.5)) return hits.some((h) => h.attacker && near(h.x, h.z, x, z, 0.01));
    if (name === 'explosion' && deaths.some((u) => u.isBuilding && near(u.x, u.z, x, z, 0.5))) return true;
    if (SHOT_NAMES.has(name) && shooters.some((u) => near(u.x, u.z, x, z, 1.5) && shotOf(u))) return true;
    if (name === 'unitReady') {
      const i = added.findIndex((a) => !a.isBuilding && a.owner === this.game!.human && near(a.x, a.z, x, z, 8));
      const voice = i >= 0 ? barkVoice(added[i]!.def) : null;
      if (i >= 0) added.splice(i, 1); // each trained unit answers once
      if (voice) {
        this.out.bark(voice, 'ready', VOL.ready);
        return true;
      }
    }
    return false;
  }

  private death(u: Unit): void {
    if (u.isBuilding) {
      const fp = u.def.footprint ?? 2;
      this.out.sfx(collapseOf(u), Math.min(0.95, VOL.collapse * (0.55 + 0.15 * fp)), u.x, u.z, Math.max(0.75, 1.12 - 0.07 * fp));
      return;
    }
    const name = deathOf(u.def);
    // Each soldier has a voice of his own: the type's pitch, varied a little by the unit.
    const rate = (PITCH_OF[u.type] ?? 1) * (0.94 + ((u.id * 0.618034) % 1) * 0.12);
    this.out.sfx(hasSfx(name) ? name : 'death', u.def.boss ? 1 : VOL.death, u.x, u.z, rate);
  }

  /** A blow or a missile landed: the attacker's weapon on the target's material, or the missile's impact. */
  private hit(g: Game, h: Hit): void {
    const a = h.attacker;
    if (!a || !g.fog.isVisible(h.x, h.z)) return;
    const p = a.projectile;
    if (!p) {
      this.out.sfx(`melee.${weaponOf(a.def)}.${materialOf(h.target)}`, VOL.melee, h.x, h.z);
      return;
    }
    this.out.sfx(this.impactOf(a, p.kind, h.target), a.type === 'ballista' ? VOL.impact * 1.4 : VOL.impact, h.x, h.z);
  }

  private impactOf(a: Unit, kind: string, t: Unit): string {
    if (kind === 'bolt') return BOLT_IMPACT[a.type] ?? 'impArcane';
    if (kind === 'fireball') return 'impFire';
    return `impact.${MISSILE_OF_KIND[kind] ?? 'arrow'}.${materialOf(t)}`;
  }

  /** A missile came down: a splash, or (when it didn't land on anyone) a thud in the ground. */
  private landing(g: Game, p: Shot, hits: Hit[]): void {
    const from = p.from;
    if (!from || p.kind !== from.projectile?.kind) return; // abilities' missiles have their own sounds
    const x = p.dest.x;
    const z = p.dest.z;
    if (!g.fog.isVisible(x, z)) return;
    if (from.def.splash) {
      const s = SPLASH_OF[from.type] ?? SPLASH_OF_KIND[p.kind] ?? 'boomCannon';
      this.out.sfx(s, VOL.boom, x, z);
      return;
    }
    if (hits.some((h) => h.target === p.target && h.attacker === from)) return; // its hit was heard
    const t = p.target;
    // A lobbed stone or javelin coming down on its target (the game deals no damage for those).
    if (p.arc && t && !t.dead && near(t.x, t.z, x, z, 1.2)) this.out.sfx(this.impactOf(from, p.kind, t), VOL.impact, x, z);
    else if (p.kind !== 'bolt' && p.kind !== 'fireball') this.out.sfx('missGround', VOL.impact * 0.8, x, z);
  }

  /** Creep camps near the camera: now and then a call; a roar when a camp wakes up to fight. */
  private creatures(g: Game, callers: Unit[]): void {
    const t = g.time;
    for (const camp of g.creepMgr?.camps ?? []) {
      if (camp.cleared) {
        this.campCalm.delete(camp);
        continue;
      }
      const fighting = camp.units.some((u) => !u.dead && u.order.type === 'attack');
      const wasCalm = this.campCalm.get(camp) ?? true;
      this.campCalm.set(camp, !fighting);
      if (!fighting || !wasCalm || t < (this.roaredAt.get(camp) ?? -1e9) + 12) continue;
      // The strongest creep of the camp roars.
      let best: Unit | null = null;
      for (const u of camp.units) if (!u.dead && (!best || u.def.level > best.def.level)) best = u;
      const calls = best ? callsOf(best.def) : null;
      if (best && calls && g.fog.isVisible(best.x, best.z)) {
        this.roaredAt.set(camp, t);
        this.out.sfx(calls[1], VOL.roar, best.x, best.z);
      }
    }
    // Lone guards (the Legion's, at the citadel) roar when they engage.
    for (const u of callers) {
      if (u.camp || !u.guardPos || u.order.type !== 'attack' || t < (this.roaredAt.get(u) ?? -1e9) + 15) continue;
      const calls = callsOf(u.def);
      if (!calls || !g.fog.isVisible(u.x, u.z)) continue;
      this.roaredAt.set(u, t);
      this.out.sfx(calls[1], VOL.roar * 0.8, u.x, u.z);
    }
    if (t < this.nextCall) return;
    this.nextCall = t + 2.5 + this.rnd() * 4;
    const idle = callers.filter((u) => u.order.type === 'idle' && callsOf(u.def) && g.fog.isVisible(u.x, u.z));
    if (!idle.length) return;
    const u = idle[(this.rnd() * idle.length) | 0]!;
    this.out.sfx(callsOf(u.def)![0], VOL.idle, u.x, u.z, 0.94 + this.rnd() * 0.12);
  }
}
