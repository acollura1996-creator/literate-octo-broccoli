// Which Warcraft III model draws each of the game's units and buildings (by model id), and which of
// its sequences play for each animation state.
//
// Models are named by file (searched for anywhere in the game's files, first match wins) or by full
// path. Units without a fitting model (the modern and future ages' vehicles and troopers) keep the
// game's own models.

export interface CatalogEntry {
  /** File names without extension (searched for) or full paths, in order of preference. */
  files: string[];
  kind: 'unit' | 'building';
  /** Size multiplier on top of the model's own scale. */
  scale?: number;
  /** World units above the ground (fliers). */
  lift?: number;
  /** Keep additively drawn geosets (spirits, elementals). */
  keepEffects?: boolean;
  /** The unit fires in bursts: the attack loops while shooting. */
  rapid?: boolean;
}

const unit = (files: string[], extra: Partial<CatalogEntry> = {}): CatalogEntry => ({ files, kind: 'unit', ...extra });
const building = (files: string[], extra: Partial<CatalogEntry> = {}): CatalogEntry => ({ files, kind: 'building', ...extra });

export const CATALOG: Record<string, CatalogEntry> = {
  // Workers and the early ages.
  peasant: unit(['Peasant']),
  caveman: unit(['Grunt'], { scale: 0.85 }),
  rock_thrower: unit(['HeadHunter'], { scale: 0.9 }),
  hoplite: unit(['Militia', 'Footman']),
  hunter: unit(['Archer']),
  chariot: unit(['WolfRider']),
  legionary: unit(['Footman'], { scale: 1.05 }),
  javelineer: unit(['BanditSpearThrower', 'HeadHunter']),
  war_elephant: unit(['KotoBeast', 'Kodo']),
  ballista: unit(['Ballista']),
  // Dark and Medieval Ages.
  footman: unit(['Footman']),
  spearman: unit(['Footman'], { scale: 1.05 }),
  archer: unit(['Archer'], { scale: 1.05 }),
  scout_rider: unit(['Knight'], { scale: 0.9 }),
  knight: unit(['Knight']),
  catapult: unit(['Catapult']),
  priest: unit(['Priest']),
  crossbowman: unit(['HighElfArcher', 'Archer']),
  champion: unit(['BloodElfSpellThief', 'Footman'], { scale: 1.1 }),
  royal_knight: unit(['Knight'], { scale: 1.12 }),
  trebuchet: unit(['MeatWagon', 'Catapult']),
  sorceress: unit(['Sorceress']),
  battlemage: unit(['RogueWizard', 'Sorceress'], { scale: 1.08 }),
  // Gunpowder and industry.
  musketeer: unit(['Rifleman']),
  grenadier: unit(['MortarTeam']),
  dragoon: unit(['Knight'], { scale: 1.05 }),
  cannon: unit(['MortarTeam'], { scale: 1.1 }),
  rifleman: unit(['Rifleman'], { scale: 1.05 }),
  machine_gunner: unit(['Rifleman'], { scale: 1.08, rapid: true }),
  steam_tank: unit(['WarWagon', 'SiegeEngine']),
  howitzer: unit(['MortarTeam'], { scale: 1.25 }),
  sniper: unit(['Rifleman']),
  mech_walker: unit(['GoblinShredder']),
  combat_drone: unit(['Gyrocopter'], { lift: 1.6 }),
  titan: unit(['Infernal'], { scale: 1.2 }),
  // Heroes.
  paladin: unit(['HeroPaladin']),
  archmage: unit(['HeroArchMage']),
  blademaster: unit(['HeroBladeMaster']),
  mountainking: unit(['HeroMountainKing']),
  ranger: unit(['SylvanusWindrunner', 'SylvanasWindrunner', 'HeroMoonPriestess']),
  water_elemental: unit(['WaterElemental'], { keepEffects: true }),
  // Creeps and bosses.
  kobold: unit(['Kobold']),
  gnoll: unit(['GnollBrute', 'Gnoll']),
  gnoll_archer: unit(['GnollArcher', 'Gnoll']),
  wolf: unit(['TimberWolf', 'Wolf']),
  murloc: unit(['MurlocTiderunner', 'Murloc']),
  brigand: unit(['Bandit']),
  harpy: unit(['HarpyWitch', 'Harpy'], { lift: 0.9 }),
  troll_shaman: unit(['ForestTrollShadowPriest', 'IceTrollShadowPriest', 'ForestTroll']),
  naga_siren: unit(['NagaSiren']),
  forest_troll: unit(['ForestTroll']),
  spider: unit(['Spider', 'SpiderBlack', 'GiantSpider']),
  ogre: unit(['Ogre']),
  rock_golem: unit(['RockGolem']),
  ogre_lord: unit(['OgreLord', 'Ogre'], { scale: 1.1 }),
  drake: unit(['BlackDrake', 'BlackDragon'], { scale: 0.7, lift: 1.6 }),
  dragon: unit(['RedDragon'], { scale: 1.1, lift: 2 }),
  hydra: unit(['Hydra'], { scale: 1.25 }),
  bandit_lord: unit(['BanditLord'], { scale: 1.3 }),
  broodmother: unit(['NerubianQueen', 'SpiderBlack', 'Spider'], { scale: 1.6 }),
  kalenden: unit(['HeroLich', 'Lich'], { scale: 1.5 }),
  dark_knight: unit(['SkeletonOrcChampion', 'SkeletalOrcChampion', 'HeroDeathKnight']),
  skeleton: unit(['Skeleton']),
  skeleton_archer: unit(['SkeletonArcher']),
  // Buildings (the town hall and houses change with the ages: orcish huts, then human halls).
  stone_camp: building(['GreatHall', 'TownHall'], { scale: 0.9 }),
  bronze_hall: building(['GreatHall', 'TownHall']),
  iron_forum: building(['TownHall']),
  townhall: building(['TownHall']),
  castle: building(['Keep', 'TownHall']),
  palace: building(['Castle', 'Keep', 'TownHall']),
  house_stone: building(['TrollBurrow', 'Farm']),
  house_1: building(['TrollBurrow', 'Farm']),
  house_iron: building(['Farm']),
  house_2: building(['Farm']),
  house_3: building(['Farm']),
  house_4: building(['Farm']),
  farm_1: building(['Farm']),
  lumberyard: building(['HumanLumberMill']),
  barracks: building(['HumanBarracks']),
  stable: building(['GryphonAviary', 'Beastiary', 'Bestiary']),
  research_1: building(['Blacksmith']),
  workshop: building(['Workshop']),
  sanctum: building(['ArcaneSanctum']),
  factory: building(['Workshop'], { scale: 1.1 }),
  scouttower: building(['HumanTower', 'ScoutTower']),
  guardtower: building(['GuardTower', 'HumanTower']),
  altar: building(['AltarofKings', 'AltarOfKings']),
  kalenden_keep: building(['Necropolis']),
  dark_tower: building(['NerubianTower', 'ZigguratTower', 'Ziggurat']),
  goldmine: building(['GoldMine']),
  shop: building(['GoblinMerchant']),
  mercenary_camp: building(['MercenaryCamp', 'MercenaryCampLordaeronSummer']),
  fountain: building(['FountainOfHealth']),
  fountain_mana: building(['FountainOfMana']),
  tavern: building(['Tavern']),
  marketplace: building(['Marketplace']),
  goblin_lab: building(['GoblinLaboratory', 'GoblinLab']),
  waygate: building(['WayGate', 'Waygate']),
};

// ------------------------------------------------------------------ sequences → animation states
/** Sequence names that belong to other states of a unit (carrying, alternate forms, portraits). */
const OTHER = /\b(gold|lumber|alternate|swim|defend|upgrade|portrait|decay|dissipate|morph|channel|first|second|third|fourth|fifth|flesh|bone)\b/i;

export interface Roles {
  idle: string[];
  combatIdle?: string;
  walk: string;
  run?: string;
  attack: string[];
  cast: string;
  work?: string;
  death: string[];
  spawn?: string;
  cheer?: string;
  spin?: string;
}

/** The sequences a model plays for each state, from their names (Stand, Walk, Attack - 2, ...). */
export function rolesOf(names: string[], kind: 'unit' | 'building'): Roles {
  const plain = names.filter((n) => !OTHER.test(n));
  const all = (re: RegExp, list = plain): string[] => list.filter((n) => re.test(n));
  const first = (...res: RegExp[]): string | undefined => {
    for (const re of res) {
      const hit = plain.find((n) => re.test(n));
      if (hit) return hit;
    }
    return undefined;
  };
  const stands = all(/^stand(\s*-\s*\d+)?$/i).slice(0, 4);
  const idle = stands.length ? stands : [first(/^stand/i) ?? names[0] ?? 'Stand'];
  if (kind === 'building') {
    return {
      idle,
      walk: idle[0]!,
      attack: all(/^attack/i).slice(0, 2),
      cast: idle[0]!,
      work: first(/^stand work$/i),
      death: [first(/^death$/i, /^death/i) ?? idle[0]!],
      spawn: first(/^birth$/i, /^birth/i),
    };
  }
  const walk = first(/^walk$/i, /^walk fast$/i, /^walk/i) ?? idle[0]!;
  const attacks = all(/^attack(\s*-\s*\d+)?$/i).slice(0, 3);
  const attack = attacks.length ? attacks : all(/^attack/i).slice(0, 2);
  return {
    idle,
    combatIdle: first(/^stand ready$/i),
    walk,
    run: walk.toLowerCase() === 'walk' ? first(/^walk fast$/i) : undefined,
    attack: attack.length ? attack : [first(/^spell/i) ?? idle[0]!],
    cast: first(/^spell$/i, /^spell throw$/i, /^spell slam$/i, /^spell/i) ?? attack[0] ?? idle[0]!,
    work: first(/^stand work$/i, /^attack work$/i),
    death: [first(/^death$/i, /^death/i) ?? idle[0]!],
    spawn: first(/^birth$/i),
    cheer: first(/^stand victory$/i, /^victory/i),
    spin: first(/spin/i),
  };
}

/** The sequences worth converting: every one a role uses. */
export function sequencesFor(roles: Roles): Set<string> {
  const out = new Set<string>([...roles.idle, roles.walk, ...roles.attack, roles.cast, ...roles.death]);
  for (const s of [roles.combatIdle, roles.run, roles.work, roles.spawn, roles.cheer, roles.spin]) if (s) out.add(s);
  return out;
}
