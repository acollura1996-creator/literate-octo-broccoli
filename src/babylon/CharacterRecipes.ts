// Which units are drawn as rigged KayKit characters (Characters.ts), and how: the body, the props
// they wear and carry (any prop fits any body), their height in the world, and the clips they play
// for each of the simulation's animation states. Units without a recipe keep their baked
// procedural model.

/** Atlas swatches (column, row of the packs' 8 × 4 palette grid) that take the team colour. */
export type TeamCells = ReadonlyArray<readonly [number, number]>;

/** The usual team swatches of each atlas: the Knight's red, the Barbarian's blue, and so on. */
export const TEAM_CELLS: Record<string, TeamCells> = {
  'knight_texture.png': [[0, 1], [2, 2]],
  'barbarian_texture.png': [[0, 1], [1, 1], [2, 2]],
  'mage_texture.png': [[0, 1], [1, 1], [2, 1], [1, 2]],
  'rogue_texture.png': [[0, 1], [1, 1], [1, 2]],
  'skeleton_texture.png': [[7, 1], [1, 2], [2, 2]],
};

/** A prop by piece name, or with its own team swatches. */
export type PropSpec = string | { p: string; team: TeamCells };

export interface CharacterRecipe {
  /** Body piece (a character of the packs). */
  body: string;
  /** The body's team swatches, when not the atlas's usual ones. */
  bodyTeam?: TeamCells;
  /** Props: "Character/Prop" for props worn in the packs, or loose props by name. */
  props: PropSpec[];
  /** Height in world units (feet to the top of the head or hat). */
  height: number;
  /** Idle clips (the first is the usual one; others play now and then). */
  idle: string[];
  /** Idle shortly after fighting. */
  combatIdle?: string;
  walk: string;
  /** Run cycle, used above `runAbove` world units a second. */
  run?: string;
  runAbove?: number;
  /** Attack clips, alternated. */
  attack: string[];
  /** Spell casting. */
  cast: string;
  /** Building and harvesting (workers). */
  work?: string;
  death: string[];
  /** Played once when the unit appears (raised skeletons climb out of the ground). */
  spawn?: string;
  /** Whirlwind (Bladestorm). */
  spin?: string;
  /** Rapid fire: the attack clip loops while the unit keeps shooting. */
  rapid?: boolean;
}

/** The Knight's shields show the team colour on their metal face. */
const SHIELD: TeamCells = [[3, 1]];
const DEATHS = ['Death_A', 'Death_B'];
const SLASHES = ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Horizontal'];
const CLEAVES = ['2H_Melee_Attack_Slice', '2H_Melee_Attack_Chop'];

/** A sword-and-shield soldier. */
function soldier(body: string, props: PropSpec[], height: number, extra: Partial<CharacterRecipe> = {}): CharacterRecipe {
  return { body, props, height, idle: ['Idle'], combatIdle: '2H_Melee_Idle', walk: 'Walking_A', run: 'Running_A', runAbove: 3.6, attack: SLASHES, cast: 'Spellcast_Raise', death: DEATHS, ...extra };
}
/** A two-handed fighter. */
function heavy(body: string, props: PropSpec[], height: number, extra: Partial<CharacterRecipe> = {}): CharacterRecipe {
  return { body, props, height, idle: ['2H_Melee_Idle', 'Idle'], combatIdle: '2H_Melee_Idle', walk: 'Walking_A', run: 'Running_A', runAbove: 3.6, attack: CLEAVES, cast: 'Spellcast_Raise', death: DEATHS, spin: '2H_Melee_Attack_Spinning', ...extra };
}
/** A crossbow or thrown-weapon skirmisher. */
function shooter(body: string, props: PropSpec[], height: number, attack: string, extra: Partial<CharacterRecipe> = {}): CharacterRecipe {
  return { body, props, height, idle: ['Idle'], walk: 'Walking_B', run: 'Running_B', runAbove: 3.6, attack: [attack], cast: 'Spellcast_Raise', death: DEATHS, ...extra };
}
/** A spellcaster. */
function caster(body: string, props: PropSpec[], height: number, extra: Partial<CharacterRecipe> = {}): CharacterRecipe {
  return { body, props, height, idle: ['Idle'], walk: 'Walking_C', run: 'Running_A', runAbove: 3.6, attack: ['Spellcast_Shoot'], cast: 'Spellcast_Raise', death: DEATHS, ...extra };
}
/** A soldier with a firearm (gunpowder to galactic ages): aims between shots. */
function gunner(body: string, props: PropSpec[], height: number, extra: Partial<CharacterRecipe> = {}): CharacterRecipe {
  return { body, props, height, idle: ['Idle'], combatIdle: '2H_Ranged_Aiming', walk: 'Walking_B', run: 'Running_B', runAbove: 3.6, attack: ['2H_Ranged_Shoot'], cast: 'Spellcast_Raise', death: DEATHS, ...extra };
}
/** One of Kalenden's undead. */
function undead(body: string, props: PropSpec[], height: number, attack: string[], extra: Partial<CharacterRecipe> = {}): CharacterRecipe {
  return { body, props, height, idle: ['Idle', 'Idle_B'], combatIdle: 'Idle_Combat', walk: 'Walking_D_Skeletons', run: 'Running_C', runAbove: 3.6, attack, cast: 'Spellcast_Raise', death: ['Death_C_Skeletons', 'Death_A'], spawn: 'Skeletons_Awaken_Floor', ...extra };
}

export const CHARACTER_RECIPES: Record<string, CharacterRecipe> = {
  // Workers and the Stone Age.
  peasant: { body: 'Barbarian', props: ['Barbarian/1H_Axe'], height: 1.2, idle: ['Idle'], walk: 'Walking_A', attack: ['1H_Melee_Attack_Chop'], cast: 'Interact', work: '1H_Melee_Attack_Chop', death: DEATHS },
  caveman: heavy('Barbarian', ['Barbarian/2H_Axe'], 1.35),
  rock_thrower: shooter('Rogue', ['Rogue/Throwable'], 1.3, 'Throw'),
  // Bronze and Iron Ages.
  hoplite: soldier('Knight', ['Knight/Knight_Helmet', { p: 'Knight/Round_Shield', team: SHIELD }, 'Knight/1H_Sword'], 1.42, { attack: ['1H_Melee_Attack_Stab'] }),
  hunter: shooter('Rogue_Hooded', ['Rogue_Hooded/1H_Crossbow'], 1.3, '1H_Ranged_Shoot'),
  legionary: soldier('Knight', ['Knight/Knight_Helmet', 'Knight/Knight_Cape', { p: 'Knight/Rectangle_Shield', team: SHIELD }, 'Knight/1H_Sword'], 1.45),
  javelineer: shooter('Rogue', ['Rogue/Rogue_Cape', 'Rogue/Throwable'], 1.35, 'Throw'),
  // Dark Age.
  footman: soldier('Knight', ['Knight/Knight_Helmet', 'Knight/Knight_Cape', { p: 'Knight/Badge_Shield', team: SHIELD }, 'Knight/1H_Sword'], 1.45),
  spearman: soldier('Knight', ['Knight/Knight_Helmet', { p: 'Knight/Spike_Shield', team: SHIELD }, 'Knight/1H_Sword'], 1.45, { attack: ['1H_Melee_Attack_Stab'] }),
  archer: shooter('Rogue_Hooded', ['Rogue_Hooded/Rogue_Cape', 'Rogue_Hooded/2H_Crossbow'], 1.35, '2H_Ranged_Shoot'),
  priest: caster('Mage', ['Mage/Spellbook_open', 'Mage/1H_Wand'], 1.35),
  // Medieval Age.
  crossbowman: shooter('Rogue', ['Rogue/Rogue_Cape', 'Rogue/2H_Crossbow'], 1.42, '2H_Ranged_Shoot'),
  champion: heavy('Knight', ['Knight/Knight_Helmet', 'Knight/Knight_Cape', 'Knight/2H_Sword'], 1.6),
  sorceress: caster('Mage', ['Mage/Mage_Hat', 'Mage/2H_Staff'], 1.42),
  battlemage: caster('Mage', ['Mage/Mage_Hat', 'Mage/Mage_Cape', 'Mage/2H_Staff'], 1.5, { attack: ['Spellcast_Shoot', 'Spellcast_Long'] }),
  // Gunpowder to Galactic infantry, with firearms made in the packs' style (CharacterProps.ts).
  musketeer: gunner('Rogue', ['Rogue/Rogue_Cape', '@musket'], 1.42),
  grenadier: shooter('Rogue_Hooded', ['Rogue_Hooded/Rogue_Cape', 'Rogue/Throwable'], 1.42, 'Throw'),
  rifleman: gunner('Rogue', ['@rifle'], 1.42),
  machine_gunner: gunner('Barbarian', ['@mg'], 1.5, { attack: ['2H_Ranged_Shooting'], rapid: true }),
  flamethrower: gunner('Barbarian', ['@flamer', '@flamerTanks'], 1.5, { attack: ['2H_Ranged_Shooting'], rapid: true }),
  sniper: gunner('Rogue_Hooded', ['Rogue_Hooded/Rogue_Cape', '@sniper'], 1.42),
  infantry: gunner('Knight', ['Knight/Knight_Helmet', '@assault'], 1.45, { attack: ['2H_Ranged_Shooting'], rapid: true }),
  bazooka: gunner('Knight', ['Knight/Knight_Helmet', '@bazooka'], 1.45),
  railgunner: gunner('Knight', ['Knight/Knight_Helmet', 'Knight/Knight_Cape', '@railgun'], 1.5),
  laser_trooper: gunner('Knight', ['Knight/Knight_Helmet', '@laser'], 1.5),
  exo_trooper: heavy('Knight', ['Knight/Knight_Helmet', 'Knight/Knight_Cape', '@energyBlade'], 1.85),
  void_trooper: gunner('Knight', ['Knight/Knight_Helmet', 'Knight/Knight_Cape', '@plasma'], 1.55),
  // Heroes: bigger, as in Warcraft III.
  paladin: soldier('Knight', ['Knight/Knight_Helmet', 'Knight/Knight_Cape', { p: 'Knight/Badge_Shield', team: SHIELD }, 'Knight/1H_Sword'], 1.9),
  archmage: caster('Mage', ['Mage/Mage_Hat', 'Mage/Mage_Cape', 'Mage/2H_Staff'], 1.9, { cast: 'Spellcast_Long' }),
  blademaster: heavy('Rogue', ['Rogue/Rogue_Cape', 'Knight/2H_Sword'], 1.9, { attack: ['2H_Melee_Attack_Slice', '2H_Melee_Attack_Chop', '2H_Melee_Attack_Stab'], walk: 'Running_A', runAbove: 0 }),
  mountainking: heavy('Barbarian', ['Barbarian/Barbarian_Hat', 'Barbarian/Barbarian_Cape', 'Barbarian/2H_Axe'], 1.8),
  ranger: shooter('Rogue_Hooded', ['Rogue_Hooded/Rogue_Cape', 'Rogue_Hooded/2H_Crossbow'], 1.85, '2H_Ranged_Shoot'),
  // Kalenden's Legion.
  skeleton: undead('Skeleton_Warrior', ['Skeleton_Blade', 'Skeleton_Shield_Small_A'], 1.35, SLASHES),
  skeleton_archer: undead('Skeleton_Rogue', ['Skeleton_Rogue/Skeleton_Rogue_Hood', 'Skeleton_Crossbow'], 1.35, ['1H_Ranged_Shoot']),
  dark_knight: undead('Skeleton_Warrior', ['Skeleton_Warrior/Skeleton_Warrior_Helmet', 'Skeleton_Axe', 'Skeleton_Shield_Large_A'], 1.8, SLASHES),
  kalenden: undead('Skeleton_Warrior', ['Skeleton_Warrior/Skeleton_Warrior_Helmet', 'Skeleton_Rogue/Skeleton_Rogue_Cape', 'Skeleton_Axe', 'Skeleton_Shield_Large_B'], 3.1, ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal'], { spawn: undefined, cast: 'Taunt' }),
};
