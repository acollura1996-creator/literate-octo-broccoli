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

// ------------------------------------------------------------------- Ages
// The Empire path advances through four ages by upgrading its town center.
// Units and structures unlock by age (`requires: ['age2']` etc.), and houses,
// walls and gates rebuild themselves in the style of each new age.
export const AGE_NAMES = ['', 'Tribal Age', 'Feudal Age', 'Kingdom Age', 'Imperial Age'];

// ---------------------------------------------------------------- Empire units
def('peasant', {
  name: 'Peasant', hp: 220, armor: 0, damage: [5, 6], attackCooldown: 2, speed: 2.6, radius: 0.38,
  cost: { gold: 75, lumber: 0 }, food: 1, buildTime: 15, worker: true, hotkey: 'P', level: 1,
  sight: 8, description: 'Basic worker. Gathers gold and lumber, lays roads and constructs buildings.',
});
// Tribal Age
def('militia', {
  name: 'Militia', hp: 300, armor: 1, armorType: 'medium', damage: [8, 10], attackCooldown: 1.4,
  speed: 2.9, radius: 0.4, cost: { gold: 60, lumber: 15 }, food: 1, buildTime: 14, hotkey: 'M', level: 1,
  description: 'Cheap levied infantry.',
});
def('hunter', {
  name: 'Hunter', hp: 230, armor: 0, armorType: 'medium', damage: [9, 11], attackType: 'pierce',
  attackCooldown: 1.6, range: 5, projectile: { kind: 'arrow', speed: 16 }, speed: 3.0, radius: 0.38,
  cost: { gold: 55, lumber: 25 }, food: 1, buildTime: 15, hotkey: 'H', level: 1,
  description: 'Cheap ranged skirmisher.',
});
// Feudal Age
def('footman', {
  name: 'Footman', hp: 420, armor: 2, armorType: 'heavy', damage: [12, 13], attackCooldown: 1.35,
  speed: 3.0, cost: { gold: 135, lumber: 0 }, food: 2, buildTime: 20, hotkey: 'F', level: 2,
  requires: ['age2'], description: 'Versatile foot soldier. Strong against archers.',
});
def('spearman', {
  name: 'Spearman', hp: 400, armor: 2, armorType: 'heavy', damage: [11, 13], attackType: 'pierce',
  attackCooldown: 1.5, range: 0.9, speed: 2.9, radius: 0.42, bonusVsCavalry: 2.5,
  cost: { gold: 90, lumber: 40 }, food: 2, buildTime: 20, hotkey: 'S', level: 2, requires: ['age2'],
  description: 'Pikeman. Deals triple damage to cavalry.',
});
def('archer', {
  name: 'Archer', hp: 330, armor: 0, armorType: 'medium', damage: [15, 18], attackType: 'pierce',
  attackCooldown: 1.5, range: 6, projectile: { kind: 'arrow', speed: 18 }, speed: 3.0, radius: 0.4,
  cost: { gold: 150, lumber: 20 }, food: 2, buildTime: 22, hotkey: 'R', level: 2, requires: ['age2'],
  description: 'Ranged attacker. Strong against light and unarmored units.',
});
def('scout_rider', {
  name: 'Scout Rider', hp: 420, armor: 1, armorType: 'medium', damage: [10, 12], attackCooldown: 1.3,
  speed: 4.3, sight: 13, radius: 0.55, cavalry: true, cost: { gold: 110, lumber: 30 }, food: 2,
  buildTime: 20, hotkey: 'C', level: 2, requires: ['age2'], description: 'Fast light cavalry with long sight.',
});
// Kingdom Age
def('crossbowman', {
  name: 'Crossbowman', hp: 430, armor: 2, armorType: 'medium', damage: [22, 26], attackType: 'pierce',
  attackCooldown: 1.6, range: 6.5, projectile: { kind: 'arrow', speed: 22 }, speed: 2.9, radius: 0.4,
  cost: { gold: 170, lumber: 50 }, food: 3, buildTime: 24, hotkey: 'X', level: 3, requires: ['age3'],
  description: 'Heavy ranged infantry.',
});
def('knight', {
  name: 'Knight', hp: 835, armor: 5, armorType: 'heavy', damage: [25, 30], attackCooldown: 1.4,
  speed: 3.6, radius: 0.6, cavalry: true, cost: { gold: 245, lumber: 60 }, food: 4, buildTime: 35, hotkey: 'K',
  level: 4, requires: ['age3'], description: 'Powerful mounted warrior.',
});
def('priest', {
  name: 'Priest', hp: 290, armor: 0, armorType: 'unarmored', damage: [8, 9], attackType: 'magic',
  attackCooldown: 2, range: 5, projectile: { kind: 'bolt', color: 0xfff2a8, speed: 14 }, speed: 2.7,
  radius: 0.38, mana: 200, manaRegen: 0.67, cost: { gold: 135, lumber: 10 }, food: 2, buildTime: 25,
  hotkey: 'P', level: 2, abilities: ['heal'], requires: ['age3'],
  description: 'Support caster. Automatically heals wounded allies.',
});
def('sorceress', {
  name: 'Sorceress', hp: 325, armor: 0, armorType: 'unarmored', damage: [10, 12], attackType: 'magic',
  attackCooldown: 1.75, range: 5, projectile: { kind: 'bolt', color: 0xd27bff, speed: 14 }, speed: 2.7,
  radius: 0.38, mana: 200, manaRegen: 0.67, cost: { gold: 155, lumber: 20 }, food: 2, buildTime: 28,
  hotkey: 'S', level: 2, abilities: ['slow'], requires: ['age3'],
  description: 'Caster. Automatically casts Slow on enemies.',
});
def('catapult', {
  name: 'Catapult', hp: 450, armor: 2, armorType: 'heavy', damage: [55, 70], attackType: 'siege',
  attackCooldown: 3.5, range: 10, minRange: 2.5, projectile: { kind: 'rock', speed: 11, arc: true },
  splash: 1.6, speed: 2.2, radius: 0.7, turnRate: 4, cost: { gold: 220, lumber: 60 }, food: 3, buildTime: 35,
  hotkey: 'C', level: 3, attackGround: true, requires: ['age3'],
  description: 'Long range siege engine. Devastating against buildings and walls.',
});
// Imperial Age
def('champion', {
  name: 'Champion', hp: 950, armor: 6, armorType: 'heavy', damage: [32, 38], attackCooldown: 1.3,
  speed: 3.0, radius: 0.48, cost: { gold: 220, lumber: 60 }, food: 3, buildTime: 30, hotkey: 'O', level: 5,
  requires: ['age4'], description: 'Elite heavy infantry.',
});
def('royal_knight', {
  name: 'Royal Knight', hp: 1350, armor: 8, armorType: 'heavy', damage: [40, 48], attackCooldown: 1.4,
  speed: 3.7, radius: 0.65, cavalry: true, cost: { gold: 330, lumber: 110 }, food: 5, buildTime: 45, hotkey: 'R',
  level: 6, requires: ['age4'], description: 'The finest heavy cavalry of the realm.',
});
def('battlemage', {
  name: 'Battle Mage', hp: 480, armor: 1, armorType: 'unarmored', damage: [28, 34], attackType: 'magic',
  attackCooldown: 2.0, range: 6, projectile: { kind: 'fireball', speed: 13 }, splash: 1.3, speed: 2.8,
  radius: 0.42, mana: 250, manaRegen: 0.8, cost: { gold: 240, lumber: 90 }, food: 3, buildTime: 32, hotkey: 'B',
  level: 4, requires: ['age4'], description: 'War-wizard whose fireballs burn groups of enemies.',
});
def('trebuchet', {
  name: 'Trebuchet', hp: 700, armor: 3, armorType: 'heavy', damage: [120, 150], attackType: 'siege',
  attackCooldown: 5, range: 14, minRange: 4, projectile: { kind: 'rock', speed: 12, arc: true }, splash: 2,
  speed: 1.8, radius: 1.0, turnRate: 3, cost: { gold: 360, lumber: 200 }, food: 4, buildTime: 50, hotkey: 'T',
  level: 5, attackGround: true, requires: ['age4'], description: 'Huge siege engine that shatters walls and keeps.',
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

// Town center: each upgrade advances the empire to the next age.
building('townhall', {
  name: 'Town Hall', hp: 1500, footprint: 4, cost: { gold: 385, lumber: 205 }, buildTime: 100,
  foodProvided: 10, dropOff: true, trains: ['peasant'], upgradesTo: 'keep', tier: 1, hotkey: 'N', sight: 11,
  description: 'Seat of a Tribal Age settlement. Trains Peasants and receives resources. Provides 10 population.',
});
building('keep', {
  name: 'Keep', hp: 2000, footprint: 4, cost: { gold: 300, lumber: 300 }, buildTime: 60, foodProvided: 10,
  dropOff: true, trains: ['peasant'], upgradesTo: 'castle', tier: 2, hotkey: 'U', sight: 12,
  requires: ['barracks', 'lumberyard'],
  description: 'Advance to the Feudal Age: footmen, spearmen, archers, cavalry, the Blacksmith and the Stable.',
});
building('castle', {
  name: 'Castle', hp: 2500, armor: 6, footprint: 4, cost: { gold: 500, lumber: 600 }, buildTime: 80,
  foodProvided: 10, dropOff: true, trains: ['peasant'], upgradesTo: 'palace', tier: 3, hotkey: 'U', sight: 13,
  requires: ['blacksmith', 'stable'],
  description: 'Advance to the Kingdom Age: knights, crossbowmen, casters and siege.',
});
building('palace', {
  name: 'Imperial Palace', hp: 3200, armor: 7, footprint: 4, cost: { gold: 800, lumber: 1000 }, buildTime: 110,
  foodProvided: 10, dropOff: true, trains: ['peasant'], tier: 4, hotkey: 'U', sight: 14,
  requires: ['sanctum', 'workshop'],
  description: 'Advance to the Imperial Age: champions, royal knights, battle mages and trebuchets.',
});
building('house', {
  name: 'House', model: 'house_1', ageNames: ['Hut', 'Cottage', 'Townhouse', 'Manor'],
  ageModels: ['house_1', 'house_2', 'house_3', 'house_4'], hpByAge: [300, 450, 650, 850],
  foodByAge: [4, 6, 8, 10], needsRoad: true, footprint: 2, cost: { gold: 50, lumber: 30 }, buildTime: 18,
  armor: 1, sight: 6, hotkey: 'H',
  description: 'Houses your people. Must be built next to a road and connected to your Town Hall by road. Grows with each age.',
});
building('lumberyard', {
  name: 'Lumber Yard', hp: 900, footprint: 3, cost: { gold: 120, lumber: 0 }, buildTime: 35, dropOff: 'lumber',
  researches: ['lumber'], hotkey: 'L', description: 'Peasants can return lumber here. Researches better lumber harvesting.',
});
building('barracks', {
  name: 'Barracks', hp: 1200, footprint: 3, cost: { gold: 160, lumber: 60 }, buildTime: 45,
  trains: ['militia', 'hunter', 'footman', 'spearman', 'archer', 'crossbowman', 'champion'], hotkey: 'B',
  description: 'Trains infantry and archers. More troops unlock with each age.',
});
building('stable', {
  name: 'Stable', hp: 1100, footprint: 3, cost: { gold: 170, lumber: 90 }, buildTime: 45, requires: ['age2'],
  trains: ['scout_rider', 'knight', 'royal_knight'], hotkey: 'E', description: 'Trains cavalry. Requires the Feudal Age.',
});
building('blacksmith', {
  name: 'Blacksmith', hp: 1000, footprint: 3, cost: { gold: 140, lumber: 60 }, buildTime: 45, requires: ['age2'],
  researches: ['weapons', 'armor'], hotkey: 'S', description: 'Researches weapon and armor upgrades. Requires the Feudal Age.',
});
building('sanctum', {
  name: 'Arcane Sanctum', hp: 1000, footprint: 3, cost: { gold: 150, lumber: 140 }, buildTime: 50,
  trains: ['priest', 'sorceress', 'battlemage'], requires: ['age3'], hotkey: 'A',
  description: 'Trains Priests, Sorceresses and Battle Mages. Requires the Kingdom Age.',
});
building('workshop', {
  name: 'Workshop', hp: 1000, footprint: 3, cost: { gold: 140, lumber: 140 }, buildTime: 50,
  trains: ['catapult', 'trebuchet'], requires: ['age3'], hotkey: 'K',
  description: 'Builds Catapults and Trebuchets. Requires the Kingdom Age.',
});
building('scouttower', {
  name: 'Scout Tower', hp: 300, footprint: 2, cost: { gold: 30, lumber: 20 }, buildTime: 20, sight: 14,
  upgradesTo: 'guardtower', hotkey: 'T', armor: 0, description: 'Lookout tower. Can be upgraded to a Guard Tower.',
});
building('guardtower', {
  name: 'Guard Tower', hp: 500, footprint: 2, cost: { gold: 70, lumber: 50 }, buildTime: 25, sight: 14,
  damage: [22, 26], attackType: 'pierce', attackCooldown: 1.0, range: 8,
  projectile: { kind: 'arrow', speed: 20 }, hotkey: 'U', requires: ['age2'],
  description: 'Defensive tower that fires arrows. Requires the Feudal Age.',
});
building('wall', {
  name: 'Wall', model: 'wall_palisade', ageNames: ['Palisade', 'Stone Wall', 'Fortified Wall', 'Fortified Wall'],
  ageModels: ['wall_palisade', 'wall_stone', 'wall_fortified', 'wall_fortified'], hpByAge: [300, 700, 1200, 1500],
  armorByAge: [4, 8, 12, 12], footprint: 1, cost: { gold: 2, lumber: 6 }, buildTime: 5, sight: 4, hotkey: 'W',
  wall: true, description: 'Drag to build a line of wall. Walls grow stronger with each age.',
});
building('gate', {
  name: 'Gate', model: 'gate_wood', ageNames: ['Wooden Gate', 'Stone Gate', 'Fortified Gate', 'Fortified Gate'],
  ageModels: ['gate_wood', 'gate_stone', 'gate_fortified', 'gate_fortified'], hpByAge: [600, 1300, 2200, 2600],
  armorByAge: [4, 8, 12, 12], footprint: 2, cost: { gold: 20, lumber: 40 }, buildTime: 15, sight: 6, hotkey: 'G',
  gate: true, description: 'Lets you and your allies through a wall and keeps enemies out. Can be placed over your walls.',
});
building('altar', {
  name: 'Altar of Heroes', hp: 1800, armor: 6, footprint: 3, cost: { gold: 180, lumber: 50 }, buildTime: 60,
  foodProvided: 16, revivesHeroes: true, sanctuary: true, hotkey: 'A', sight: 10,
  damage: [26, 32], attackType: 'normal', attackCooldown: 1.4, range: 7,
  projectile: { kind: 'bolt', color: 0xfff0a0, speed: 16 },
  description: 'Revives your fallen Hero, smites nearby enemies and slowly heals your units. Provides 16 food for your Hero and mercenaries.',
});

/** Structures a Peasant can build, split into the two build menus. */
export const BUILD_MENUS = {
  basic: ['house', 'road', 'wall', 'gate', 'lumberyard', 'barracks', 'scouttower', 'townhall'],
  advanced: ['blacksmith', 'stable', 'sanctum', 'workshop'],
};
/** Roads are laid tile by tile (not units). */
export const ROAD = {
  name: 'Road', cost: { gold: 2, lumber: 0 }, hotkey: 'R', speedBonus: 1.3,
  description: 'Drag to lay a road. Houses must touch a road connected to your Town Hall. Units move faster on roads.',
};

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
  name: 'Arcane Vault', model: 'shop', modelColor: 0x6a3ad0, hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0,
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
    tier: [2, 3, 4],
    hotkey: 'W',
    icon: '🗡️',
    description: 'Increases the attack damage of your units by 2 per level.',
  },
  armor: {
    name: ['Iron Plating', 'Steel Plating', 'Mithril Plating'],
    cost: [{ gold: 125, lumber: 75 }, { gold: 150, lumber: 175 }, { gold: 175, lumber: 275 }],
    time: [40, 55, 70],
    tier: [2, 3, 4],
    hotkey: 'A',
    icon: '🛡️',
    description: 'Increases the armor of your units by 2 per level.',
  },
  lumber: {
    name: ['Improved Lumber Harvesting', 'Advanced Lumber Harvesting'],
    cost: [{ gold: 100, lumber: 0 }, { gold: 175, lumber: 50 }],
    time: [35, 50],
    tier: [1, 2],
    levels: 2,
    hotkey: 'L',
    icon: '🪓',
    description: 'Peasants carry 2 more lumber per trip for each level.',
  },
};

/** Experience granted for killing a unit of a given level (Warcraft III-like table). */
export const XP_BY_LEVEL = [0, 25, 40, 60, 85, 115, 150, 190, 235, 285, 340, 400, 460, 520, 600, 700];
/** Total experience needed to reach each hero level (index = level). */
export const HERO_XP = [0, 0, 200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5400];
export const MAX_HERO_LEVEL = 10;
