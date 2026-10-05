// Hero attribute progression and ability loadouts.
// Derived stats follow Warcraft III conventions:
//   HP = 100 + 25*STR, HP regen = 0.25 + 0.05*STR
//   Mana = 15*INT, mana regen = 0.05*INT
//   Armor = base + 0.3*AGI, attack speed +2% per AGI
//   Damage = base damage + primary attribute
import type { HeroDef } from './types.ts';

export const HEROES: Record<string, HeroDef> = {
  paladin: {
    primary: 'str',
    str: [22, 2.7], agi: [13, 1.5], int: [17, 1.8],
    abilities: ['holy_light', 'divine_shield', 'devotion_aura', 'resurrection'],
    blurb: 'A stalwart warrior of the Light. Heals allies, shrugs off harm and raises the fallen.',
    icon: '🛡️',
  },
  archmage: {
    primary: 'int',
    str: [14, 1.8], agi: [17, 1.0], int: [19, 3.2],
    abilities: ['blizzard', 'water_elemental', 'brilliance_aura', 'meteor_shower'],
    blurb: 'A master of arcane magic. Rains ice and fire upon his foes and summons elementals.',
    icon: '🔮',
  },
  blademaster: {
    primary: 'agi',
    str: [19, 2.0], agi: [23, 2.75], int: [16, 1.75],
    abilities: ['wind_walk', 'mirror_image', 'critical_strike', 'bladestorm'],
    blurb: 'A deadly orcish swordsman. Strikes from the shadows with devastating critical blows.',
    icon: '⚔️',
  },
  mountainking: {
    primary: 'str',
    str: [24, 3.0], agi: [11, 1.5], int: [15, 1.5],
    abilities: ['storm_bolt', 'thunder_clap', 'bash', 'avatar'],
    blurb: 'A mighty dwarven warrior. Stuns and shatters enemies with hammer and thunder.',
    icon: '🔨',
  },
  ranger: {
    primary: 'agi',
    str: [18, 1.9], agi: [22, 2.5], int: [15, 2.4],
    abilities: ['volley', 'entangle', 'trueshot_aura', 'starfall'],
    blurb: 'An elven archer of unmatched skill. Pins foes with roots and calls down the stars.',
    icon: '🏹',
  },
};

export const HERO_IDS = Object.keys(HEROES);

export const AI_GENERAL_NAMES = [
  'General Aldric',
  'Warlord Grukk',
  'Lady Sylvara',
  'Thane Borin',
  'Marshal Edwyn',
  'Archon Velis',
];
