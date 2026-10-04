// Unit and building definitions. Numbers are loosely modelled on Warcraft III
// (1 world unit ~ one Warcraft III pathing tile of 128 game units, scaled
// so units read well).
//
// armorType: light | medium | heavy | fortified | hero | unarmored
// attackType: normal | pierce | siege | magic | hero | chaos

const U = {};

function def(id, d) {
  U[id] = {
    id,
    kind: 'unit',
    model: id,
    hp: 100,
    hpRegen: 0.25,
    mana: 0,
    manaRegen: 0,
    armor: 0,
    armorType: 'medium',
    damage: null,
    attackType: 'normal',
    attackCooldown: 1.5,
    range: 0.6,
    projectile: null,
    speed: 3,
    turnRate: 10,
    sight: 9,
    radius: 0.45,
    cost: { gold: 0, lumber: 0 },
    food: 0,
    buildTime: 20,
    bounty: null,
    level: 1,
    abilities: [],
    ...d,
  };
  return U[id];
}

// ---------------------------------------------------------------- Empire units
def('peasant', {
  name: 'Peasant', hp: 220, armor: 0, damage: [5, 6], attackCooldown: 2, speed: 2.6, radius: 0.38,
  cost: { gold: 75, lumber: 0 }, food: 1, buildTime: 15, worker: true, hotkey: 'P', level: 1,
  sight: 8, description: 'Basic worker. Gathers gold and lumber and constructs buildings.',
  builds: ['farm', 'barracks', 'blacksmith', 'sanctum', 'workshop', 'scouttower', 'townhall'],
});
def('footman', {
  name: 'Footman', hp: 420, armor: 2, armorType: 'heavy', damage: [12, 13], attackCooldown: 1.35,
  speed: 3.0, cost: { gold: 135, lumber: 0 }, food: 2, buildTime: 20, hotkey: 'F', level: 2,
  description: 'Versatile foot soldier. Strong against archers.',
});
def('archer', {
  name: 'Archer', hp: 330, armor: 0, armorType: 'medium', damage: [15, 18], attackType: 'pierce',
  attackCooldown: 1.5, range: 6, projectile: { kind: 'arrow', speed: 18 }, speed: 3.0, radius: 0.4,
  cost: { gold: 150, lumber: 20 }, food: 3, buildTime: 22, hotkey: 'R', level: 2,
  description: 'Ranged attacker. Strong against light and unarmored units.',
});
def('knight', {
  name: 'Knight', hp: 835, armor: 5, armorType: 'heavy', damage: [25, 30], attackCooldown: 1.4,
  speed: 3.5, radius: 0.6, cost: { gold: 245, lumber: 60 }, food: 4, buildTime: 35, hotkey: 'K', level: 4,
  requires: ['keep', 'blacksmith'], description: 'Powerful mounted warrior. Requires Keep and Blacksmith.',
});
def('priest', {
  name: 'Priest', hp: 290, armor: 0, armorType: 'unarmored', damage: [8, 9], attackType: 'magic',
  attackCooldown: 2, range: 5, projectile: { kind: 'bolt', color: 0xfff2a8, speed: 14 }, speed: 2.7,
  radius: 0.38, mana: 200, manaRegen: 0.67, cost: { gold: 135, lumber: 10 }, food: 2, buildTime: 25,
  hotkey: 'P', level: 2, abilities: ['heal'], description: 'Support caster. Automatically heals wounded allies.',
});
def('sorceress', {
  name: 'Sorceress', hp: 325, armor: 0, armorType: 'unarmored', damage: [10, 12], attackType: 'magic',
  attackCooldown: 1.75, range: 5, projectile: { kind: 'bolt', color: 0xd27bff, speed: 14 }, speed: 2.7,
  radius: 0.38, mana: 200, manaRegen: 0.67, cost: { gold: 155, lumber: 20 }, food: 2, buildTime: 28,
  hotkey: 'S', level: 2, abilities: ['slow'], description: 'Caster. Automatically casts Slow on enemies.',
});
def('catapult', {
  name: 'Catapult', hp: 450, armor: 2, armorType: 'heavy', damage: [55, 70], attackType: 'siege',
  attackCooldown: 3.5, range: 10, minRange: 2.5, projectile: { kind: 'rock', speed: 11, arc: true },
  splash: 1.6, speed: 2.2, radius: 0.7, turnRate: 4, cost: { gold: 220, lumber: 60 }, food: 3, buildTime: 35,
  hotkey: 'C', level: 3, attackGround: true, description: 'Long range siege engine. Devastating against buildings.',
});

// ------------------------------------------------------------ Empire buildings
function building(id, d) {
  return def(id, {
    kind: 'building',
    armorType: 'fortified',
    armor: 5,
    hpRegen: 0,
    speed: 0,
    sight: 9,
    footprint: 2,
    ...d,
    radius: (d.footprint ?? 2) * 0.5,
  });
}

building('townhall', {
  name: 'Town Hall', hp: 1500, footprint: 4, cost: { gold: 385, lumber: 205 }, buildTime: 100,
  foodProvided: 12, dropOff: true, trains: ['peasant'], upgradesTo: 'keep', tier: 1, hotkey: 'H', sight: 11,
  description: 'Trains Peasants and receives harvested resources. Provides 12 food.',
});
building('keep', {
  name: 'Keep', hp: 2000, footprint: 4, cost: { gold: 320, lumber: 210 }, buildTime: 70, foodProvided: 12,
  dropOff: true, trains: ['peasant'], upgradesTo: 'castle', tier: 2, hotkey: 'U', sight: 12,
  description: 'Upgraded Town Hall. Unlocks advanced structures and units.',
});
building('castle', {
  name: 'Castle', hp: 2500, armor: 6, footprint: 4, cost: { gold: 360, lumber: 210 }, buildTime: 90,
  foodProvided: 12, dropOff: true, trains: ['peasant'], tier: 3, hotkey: 'U', sight: 13,
  description: 'Fully upgraded seat of your empire.',
});
building('farm', {
  name: 'Farm', hp: 500, footprint: 2, cost: { gold: 80, lumber: 20 }, buildTime: 25, foodProvided: 6,
  hotkey: 'F', armor: 0, sight: 6, description: 'Provides 6 food.',
});
building('barracks', {
  name: 'Barracks', hp: 1200, footprint: 3, cost: { gold: 160, lumber: 60 }, buildTime: 45,
  trains: ['footman', 'archer', 'knight'], hotkey: 'B', description: 'Trains Footmen, Archers and Knights.',
});
building('blacksmith', {
  name: 'Blacksmith', hp: 1000, footprint: 3, cost: { gold: 140, lumber: 60 }, buildTime: 45,
  researches: ['weapons', 'armor'], hotkey: 'S', description: 'Researches weapon and armor upgrades.',
});
building('sanctum', {
  name: 'Arcane Sanctum', hp: 1000, footprint: 3, cost: { gold: 150, lumber: 140 }, buildTime: 50,
  trains: ['priest', 'sorceress'], requires: ['keep'], hotkey: 'A',
  description: 'Trains Priests and Sorceresses. Requires Keep.',
});
building('workshop', {
  name: 'Workshop', hp: 1000, footprint: 3, cost: { gold: 140, lumber: 140 }, buildTime: 50,
  trains: ['catapult'], requires: ['keep'], hotkey: 'W', description: 'Builds Catapults. Requires Keep.',
});
building('scouttower', {
  name: 'Scout Tower', hp: 300, footprint: 2, cost: { gold: 30, lumber: 20 }, buildTime: 20, sight: 14,
  upgradesTo: 'guardtower', hotkey: 'T', armor: 0, description: 'Lookout tower. Can be upgraded to a Guard Tower.',
});
building('guardtower', {
  name: 'Guard Tower', hp: 500, footprint: 2, cost: { gold: 70, lumber: 50 }, buildTime: 25, sight: 14,
  damage: [22, 26], attackType: 'pierce', attackCooldown: 1.0, range: 8,
  projectile: { kind: 'arrow', speed: 20 }, hotkey: 'U', description: 'Defensive tower that fires arrows.',
});
building('altar', {
  name: 'Altar of Heroes', hp: 1800, armor: 6, footprint: 3, cost: { gold: 180, lumber: 50 }, buildTime: 60,
  foodProvided: 16, revivesHeroes: true, sanctuary: true, hotkey: 'A', sight: 10,
  description: 'Revives your fallen Hero and slowly heals your units nearby. Provides 16 food for your Hero and mercenaries.',
});

// --------------------------------------------------------------------- Heroes
// Hero stats: base damage + primary attribute. See data/heroes.js for
// attributes and abilities.
function hero(id, d) {
  return def(id, {
    kind: 'unit',
    hero: true,
    armorType: 'hero',
    attackType: 'hero',
    hpRegen: 0,
    sight: 11,
    radius: 0.55,
    food: 5,
    level: 1,
    ...d,
  });
}

hero('paladin', {
  name: 'Paladin', title: 'Champion of the Light', damage: [2, 12], attackCooldown: 2.2, speed: 3.0, armor: 1,
});
hero('archmage', {
  name: 'Archmage', title: 'Master of the Arcane', damage: [2, 8], attackCooldown: 2.13, speed: 3.0, armor: 0,
  range: 6, projectile: { kind: 'bolt', color: 0x8fd3ff, speed: 15 }, radius: 0.5,
});
hero('blademaster', {
  name: 'Blademaster', title: 'Sword of the Horde', damage: [1, 11], attackCooldown: 1.77, speed: 3.25, armor: 0,
  radius: 0.5,
});
hero('mountainking', {
  name: 'Mountain King', title: 'Thane of the Mountain', damage: [1, 11], attackCooldown: 2.22, speed: 3.0, armor: 2,
});
hero('ranger', {
  name: 'Ranger', title: 'Warden of the Glade', damage: [2, 10], attackCooldown: 1.85, speed: 3.15, armor: 0,
  range: 6.5, projectile: { kind: 'arrow', speed: 20, color: 0xbfe8ff }, radius: 0.5,
});

def('water_elemental', {
  name: 'Water Elemental', hp: 525, armor: 0, armorType: 'heavy', damage: [18, 22], attackCooldown: 1.5,
  range: 5, projectile: { kind: 'bolt', color: 0x4fa8ff, speed: 13 }, speed: 2.8, radius: 0.55,
  summoned: true, level: 2, hpRegen: 0,
});

// --------------------------------------------------------------------- Creeps
function creep(id, d) {
  return def(id, { creep: true, hpRegen: 0.5, sight: 8, ...d });
}
creep('kobold', {
  name: 'Kobold', hp: 240, armor: 1, damage: [7, 8], attackCooldown: 1.35, speed: 2.7, radius: 0.35,
  level: 1, bounty: [8, 12], food: 1, cost: { gold: 0 },
});
creep('gnoll', {
  name: 'Gnoll Brute', hp: 330, armor: 1, damage: [11, 13], attackCooldown: 1.35, speed: 2.8,
  level: 2, bounty: [12, 16], food: 2, cost: { gold: 120, lumber: 0 }, hotkey: 'G',
  description: 'Hardy gnoll mercenary.',
});
creep('gnoll_archer', {
  name: 'Gnoll Poacher', hp: 240, armor: 0, damage: [10, 12], attackType: 'pierce', attackCooldown: 1.5,
  range: 5, projectile: { kind: 'arrow', speed: 16 }, speed: 2.8, radius: 0.4, level: 2, bounty: [12, 16],
});
creep('wolf', {
  name: 'Timber Wolf', hp: 340, armor: 1, damage: [14, 16], attackCooldown: 1.2, speed: 3.6, radius: 0.5,
  level: 3, bounty: [14, 18],
});
creep('forest_troll', {
  name: 'Forest Troll', hp: 350, armor: 1, damage: [15, 18], attackType: 'pierce', attackCooldown: 1.6,
  range: 5, projectile: { kind: 'axe', speed: 14 }, speed: 2.9, level: 3, bounty: [15, 20], food: 2,
  cost: { gold: 170, lumber: 0 }, hotkey: 'T', description: 'Ranged mercenary that hurls axes.',
});
creep('spider', {
  name: 'Giant Spider', hp: 400, armor: 2, damage: [16, 19], attackCooldown: 1.2, speed: 3.2, radius: 0.5,
  level: 3, bounty: [15, 20],
});
creep('ogre', {
  name: 'Ogre Mauler', hp: 650, armor: 2, armorType: 'heavy', damage: [22, 27], attackCooldown: 1.5,
  speed: 2.8, radius: 0.65, level: 4, bounty: [20, 26], food: 3, cost: { gold: 280, lumber: 0 }, hotkey: 'O',
  description: 'Brutish ogre mercenary.',
});
creep('rock_golem', {
  name: 'Rock Golem', hp: 1000, armor: 5, armorType: 'heavy', damage: [34, 40], attackCooldown: 1.8,
  speed: 2.5, radius: 0.7, level: 6, bounty: [30, 40], food: 4, cost: { gold: 500, lumber: 0 }, hotkey: 'R',
  abilities: ['creep_stomp'], description: 'Hulking stone construct mercenary.',
});
creep('ogre_lord', {
  name: 'Ogre Lord', hp: 1400, armor: 4, armorType: 'heavy', damage: [45, 55], attackCooldown: 1.6,
  speed: 2.8, radius: 0.75, level: 7, bounty: [40, 55], abilities: ['creep_stomp'],
});
creep('drake', {
  name: 'Black Drake', hp: 900, armor: 3, armorType: 'light', damage: [35, 42], attackType: 'magic',
  attackCooldown: 1.7, range: 4, projectile: { kind: 'fireball', speed: 12 }, speed: 3.2, radius: 0.7,
  level: 6, bounty: [30, 40],
});

// -------------------------------------------------------- Kalenden's Legion
function legion(id, d) {
  return def(id, { legion: true, hpRegen: 0.25, ...d });
}
legion('kalenden', {
  name: 'Kalenden', title: 'Tyrant of the Land', hp: 6500, hpRegen: 4, armor: 8, armorType: 'hero',
  damage: [80, 95], attackType: 'chaos', attackCooldown: 1.6, range: 1.0, cleave: 0.5, speed: 2.8,
  radius: 0.95, sight: 12, level: 15, bounty: [0, 0], boss: true, mana: 1000, manaRegen: 5,
  abilities: ['war_stomp', 'raise_dead'],
});
legion('dark_knight', {
  name: 'Death Guard', hp: 900, armor: 6, armorType: 'heavy', damage: [28, 34], attackCooldown: 1.5,
  speed: 3.1, radius: 0.55, level: 5, bounty: [25, 32],
});
legion('skeleton', {
  name: 'Skeleton Warrior', hp: 300, armor: 1, armorType: 'medium', damage: [11, 14], attackCooldown: 1.4,
  speed: 2.8, radius: 0.4, level: 1, bounty: [6, 9], undead: true,
});
legion('skeleton_archer', {
  name: 'Skeleton Archer', hp: 260, armor: 0, armorType: 'medium', damage: [12, 15], attackType: 'pierce',
  attackCooldown: 1.6, range: 5.5, projectile: { kind: 'arrow', speed: 16, color: 0xb7ffb0 }, speed: 2.8,
  radius: 0.4, level: 2, bounty: [8, 11], undead: true,
});
U.dark_knight.undead = true;
U.kalenden.undead = true;

building('kalenden_keep', {
  name: "Kalenden's Keep", hp: 6000, armor: 8, footprint: 6, sight: 12, legion: true, hpRegen: 5,
  description: 'Seat of the tyrant. His Legion marches from here.',
});
building('dark_tower', {
  name: 'Dark Spire', hp: 1100, armor: 6, footprint: 2, damage: [38, 46], attackType: 'magic', attackCooldown: 1.4,
  range: 8, projectile: { kind: 'bolt', color: 0x9dff6a, speed: 16 }, sight: 11, legion: true,
});

// ----------------------------------------------------------- Neutral buildings
building('goldmine', {
  name: 'Gold Mine', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0, sight: 0,
  description: 'Peasants can harvest gold here.',
});
building('shop', {
  name: 'Goblin Merchant', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0, sight: 0,
  shop: 'merchant', description: 'Sells items to Heroes within range.',
});
building('vault', {
  name: 'Arcane Vault', model: 'shop', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0,
  sight: 0, shop: 'vault', description: 'Sells powerful artifacts to Heroes within range.',
});
building('mercenary_camp', {
  name: 'Mercenary Camp', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0, sight: 0,
  mercenaries: ['gnoll', 'forest_troll', 'ogre', 'rock_golem'],
  description: 'Hire mercenaries when one of your units is nearby.',
});
building('fountain', {
  name: 'Fountain of Health', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0, sight: 0,
  description: 'Heals nearby units.',
});

export const UNITS = U;

export const ATTACK_TABLE = {
  //          light medium heavy fortified hero unarmored
  normal: { light: 1.0, medium: 1.5, heavy: 1.0, fortified: 0.7, hero: 1.0, unarmored: 1.0 },
  pierce: { light: 2.0, medium: 0.75, heavy: 1.0, fortified: 0.35, hero: 0.5, unarmored: 1.5 },
  siege: { light: 1.0, medium: 0.5, heavy: 1.0, fortified: 1.5, hero: 0.5, unarmored: 1.5 },
  magic: { light: 1.25, medium: 0.75, heavy: 2.0, fortified: 0.35, hero: 0.5, unarmored: 1.0 },
  hero: { light: 1.0, medium: 1.0, heavy: 1.0, fortified: 0.5, hero: 1.0, unarmored: 1.0 },
  chaos: { light: 1.0, medium: 1.0, heavy: 1.0, fortified: 1.0, hero: 1.0, unarmored: 1.0 },
  spell: { light: 1.0, medium: 1.0, heavy: 1.0, fortified: 0.5, hero: 0.75, unarmored: 1.0 },
};

export const UPGRADES = {
  weapons: {
    name: ['Iron Forged Swords', 'Steel Forged Swords', 'Mithril Forged Swords'],
    cost: [{ gold: 100, lumber: 50 }, { gold: 175, lumber: 175 }, { gold: 250, lumber: 300 }],
    time: [40, 55, 70],
    tier: [1, 2, 3],
    hotkey: 'W',
    icon: '🗡️',
    description: 'Increases the attack damage of your units by 2 per level.',
  },
  armor: {
    name: ['Iron Plating', 'Steel Plating', 'Mithril Plating'],
    cost: [{ gold: 125, lumber: 75 }, { gold: 150, lumber: 175 }, { gold: 175, lumber: 275 }],
    time: [40, 55, 70],
    tier: [1, 2, 3],
    hotkey: 'A',
    icon: '🛡️',
    description: 'Increases the armor of your units by 2 per level.',
  },
};

/** Experience granted for killing a unit of a given level (Warcraft III-like table). */
export const XP_BY_LEVEL = [0, 25, 40, 60, 85, 115, 150, 190, 235, 285, 340, 400, 460, 520, 600, 700];
/** Total experience needed to reach each hero level (index = level). */
export const HERO_XP = [0, 0, 200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5400];
export const MAX_HERO_LEVEL = 10;
