// Unit and building definitions. Numbers are loosely modelled on Warcraft III
// (1 world unit ~ one Warcraft III pathing tile of 128 game units, scaled
// so units read well).
//
// armorType: light | medium | heavy | fortified | hero | unarmored
// attackType: normal | pierce | siege | magic | hero | chaos
import type { AgeDef, ArmorType, AttackType, Cost, Mood, UnitDef, UpgradeDef } from './types.ts';

/** A definition as written below: anything not given takes the defaults in `def`. */
type DefInit = Partial<UnitDef> & { name: string };

const U: Record<string, UnitDef> = {};

function def(id: string, d: DefInit): UnitDef {
  const u: UnitDef = {
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
  U[id] = u;
  return u;
}

// ------------------------------------------------------------------- Ages
// Empires advance from the Stone Age to the Future Age by researching the next age at their
// town center. Every unit belongs to an age (`age`), and production buildings offer the units
// of the current and the previous age. Town centers, houses, farms, walls, gates and towers
// rebuild themselves in the style of each new age.
export const AGES: (AgeDef | null)[] = [
  null,
  { name: 'Stone Age', icon: '🪨' },
  { name: 'Bronze Age', icon: '🏺', cost: { gold: 200, lumber: 150 }, time: 40, requires: ['barracks'] },
  { name: 'Iron Age', icon: '⚔️', cost: { gold: 300, lumber: 200 }, time: 45, requires: ['farm', 'research_center'] },
  { name: 'Dark Age', icon: '🛡️', cost: { gold: 400, lumber: 250 }, time: 55, requires: ['stable', 'workshop'] },
  { name: 'Medieval Age', icon: '🏰', cost: { gold: 550, lumber: 320 }, time: 60, requires: ['sanctum'] },
  { name: 'Gunpowder Age', icon: '💥', cost: { gold: 700, lumber: 380 }, time: 65, requires: ['workshop'] },
  { name: 'Industrial Age', icon: '🏭', cost: { gold: 850, lumber: 450 }, time: 75, requires: ['research_center'] },
  { name: 'Atomic Age', icon: '⚛️', cost: { gold: 1000, lumber: 520 }, time: 80, requires: ['factory'] },
  { name: 'Modern Age', icon: '☢️', cost: { gold: 1200, lumber: 600 }, time: 90, requires: ['factory'] },
  { name: 'Digital Age', icon: '💾', cost: { gold: 1400, lumber: 680 }, time: 95, requires: ['missile_silo'] },
  { name: 'Future Age', icon: '🛸', cost: { gold: 1650, lumber: 780 }, time: 105, requires: ['research_center'] },
  { name: 'Galactic Age', icon: '🌌', cost: { gold: 2000, lumber: 900 }, time: 120, requires: ['missile_silo'] },
];
export const MAX_AGE = AGES.length - 1;
export const AGE_NAMES = AGES.map((a) => a?.name ?? '');

// ---------------------------------------------------------------- Empire units
def('peasant', {
  name: 'Peasant', hp: 220, armor: 0, damage: [5, 6], attackCooldown: 2, speed: 2.6, radius: 0.38,
  cost: { gold: 75, lumber: 0 }, food: 1, buildTime: 15, worker: true, hotkey: 'P', level: 1, age: 1,
  sight: 8, description: 'Basic worker. Gathers gold and lumber, lays roads and constructs buildings.',
});
// 1. Stone Age
def('caveman', {
  name: 'Clubman', age: 1, hp: 280, armor: 0, damage: [8, 10], attackCooldown: 1.4, speed: 2.9, radius: 0.4,
  cost: { gold: 50, lumber: 10 }, food: 1, buildTime: 13, hotkey: 'C', level: 1,
  description: 'Caveman with a heavy club.',
});
def('rock_thrower', {
  name: 'Rock Thrower', age: 1, hp: 210, armor: 0, damage: [8, 10], attackCooldown: 1.6, range: 4.5,
  projectile: { kind: 'stone', speed: 13, arc: true }, speed: 3.0, radius: 0.38,
  cost: { gold: 45, lumber: 20 }, food: 1, buildTime: 14, hotkey: 'T', level: 1,
  description: 'Hurls stones from a distance.',
});
// 2. Bronze Age
def('hoplite', {
  name: 'Hoplite', age: 2, hp: 420, armor: 3, armorType: 'heavy', damage: [11, 13], attackType: 'pierce',
  attackCooldown: 1.5, range: 0.9, speed: 2.8, radius: 0.42, bonusVsCavalry: 2.5,
  cost: { gold: 85, lumber: 30 }, food: 2, buildTime: 18, hotkey: 'H', level: 2,
  description: 'Bronze-armored spearman behind a great shield. Deals extra damage to cavalry.',
});
def('bowman', {
  name: 'Bowman', model: 'hunter', age: 2, hp: 260, armor: 0, damage: [12, 14], attackType: 'pierce',
  attackCooldown: 1.5, range: 5.5, projectile: { kind: 'arrow', speed: 17 }, speed: 3.0, radius: 0.38,
  cost: { gold: 70, lumber: 30 }, food: 1, buildTime: 16, hotkey: 'B', level: 2,
  description: 'Archer with a composite bow.',
});
def('chariot', {
  name: 'War Chariot', age: 2, hp: 540, armor: 2, damage: [14, 17], attackCooldown: 1.4, speed: 4.0,
  radius: 0.75, turnRate: 6, cavalry: true, cost: { gold: 140, lumber: 60 }, food: 3, buildTime: 24, hotkey: 'C',
  level: 3, description: 'Fast horse-drawn chariot that runs down skirmishers.',
});
// 3. Iron Age
def('legionary', {
  name: 'Legionary', age: 3, hp: 520, armor: 4, armorType: 'heavy', damage: [15, 18], attackCooldown: 1.3,
  speed: 2.9, radius: 0.42, cost: { gold: 100, lumber: 30 }, food: 2, buildTime: 20, hotkey: 'L', level: 3,
  description: 'Disciplined heavy infantry with a great shield and a short sword.',
});
def('javelineer', {
  name: 'Javelineer', age: 3, hp: 300, armor: 1, damage: [16, 19], attackType: 'pierce', attackCooldown: 1.7,
  range: 5, projectile: { kind: 'javelin', speed: 15, arc: true }, speed: 3.1, radius: 0.38,
  cost: { gold: 85, lumber: 35 }, food: 1, buildTime: 17, hotkey: 'J', level: 3,
  description: 'Light skirmisher who hurls javelins.',
});
def('war_elephant', {
  name: 'War Elephant', age: 3, hp: 1400, armor: 4, armorType: 'heavy', damage: [30, 36], attackCooldown: 1.8,
  cleave: 0.4, speed: 2.6, radius: 0.9, turnRate: 4, cavalry: true, cost: { gold: 260, lumber: 100 }, food: 5,
  buildTime: 40, hotkey: 'E', level: 5, description: 'Armored elephant that tramples everything around it.',
});
def('ballista', {
  name: 'Ballista', age: 3, hp: 400, armor: 2, armorType: 'heavy', damage: [45, 55], attackType: 'siege',
  attackCooldown: 3, range: 10, minRange: 2, projectile: { kind: 'javelin', speed: 24 }, speed: 2.2, radius: 0.75,
  turnRate: 4, cost: { gold: 180, lumber: 80 }, food: 3, buildTime: 32, hotkey: 'B', level: 3,
  description: 'Torsion bolt-thrower. Pierces walls and big targets.',
});
// 4. Dark Age
def('footman', {
  name: 'Footman', age: 4, hp: 450, armor: 3, armorType: 'heavy', damage: [13, 15], attackCooldown: 1.35,
  speed: 3.0, cost: { gold: 110, lumber: 20 }, food: 2, buildTime: 20, hotkey: 'F', level: 3,
  description: 'Versatile swordsman. Strong against archers.',
});
def('spearman', {
  name: 'Pikeman', age: 4, hp: 420, armor: 2, armorType: 'heavy', damage: [12, 14], attackType: 'pierce',
  attackCooldown: 1.5, range: 0.9, speed: 2.9, radius: 0.42, bonusVsCavalry: 2.5,
  cost: { gold: 90, lumber: 40 }, food: 2, buildTime: 20, hotkey: 'S', level: 3,
  description: 'Long pike. Deals extra damage to cavalry.',
});
def('archer', {
  name: 'Archer', age: 4, hp: 340, armor: 0, damage: [16, 19], attackType: 'pierce',
  attackCooldown: 1.5, range: 6, projectile: { kind: 'arrow', speed: 18 }, speed: 3.0, radius: 0.4,
  cost: { gold: 120, lumber: 30 }, food: 2, buildTime: 22, hotkey: 'A', level: 3,
  description: 'Longbow archer. Strong against light and unarmored units.',
});
def('scout_rider', {
  name: 'Light Cavalry', age: 4, hp: 480, armor: 1, damage: [12, 14], attackCooldown: 1.3,
  speed: 4.3, sight: 13, radius: 0.55, cavalry: true, cost: { gold: 120, lumber: 40 }, food: 2,
  buildTime: 20, hotkey: 'L', level: 3, description: 'Fast horsemen with long sight.',
});
def('knight', {
  name: 'Knight', age: 4, hp: 900, armor: 5, armorType: 'heavy', damage: [25, 30], attackCooldown: 1.4,
  speed: 3.6, radius: 0.6, cavalry: true, cost: { gold: 230, lumber: 60 }, food: 4, buildTime: 35, hotkey: 'K',
  level: 4, description: 'Powerful mounted warrior.',
});
def('catapult', {
  name: 'Catapult', age: 4, hp: 450, armor: 2, armorType: 'heavy', damage: [55, 70], attackType: 'siege',
  attackCooldown: 3.5, range: 10, minRange: 2.5, projectile: { kind: 'rock', speed: 11, arc: true },
  splash: 1.6, speed: 2.2, radius: 0.7, turnRate: 4, cost: { gold: 220, lumber: 60 }, food: 3, buildTime: 35,
  hotkey: 'C', level: 3, attackGround: true, description: 'Siege engine. Devastating against buildings and walls.',
});
def('priest', {
  name: 'Priest', age: 4, hp: 290, armor: 0, armorType: 'unarmored', damage: [8, 9], attackType: 'magic',
  attackCooldown: 2, range: 5, projectile: { kind: 'bolt', color: 0xfff2a8, speed: 14 }, speed: 2.7,
  radius: 0.38, mana: 200, manaRegen: 0.67, cost: { gold: 135, lumber: 10 }, food: 2, buildTime: 25,
  hotkey: 'P', level: 2, abilities: ['heal'], description: 'Support caster. Automatically heals wounded allies.',
});
// 5. Medieval Age
def('crossbowman', {
  name: 'Crossbowman', age: 5, hp: 450, armor: 2, damage: [24, 28], attackType: 'pierce',
  attackCooldown: 1.6, range: 6.5, projectile: { kind: 'arrow', speed: 22 }, speed: 2.9, radius: 0.4,
  cost: { gold: 150, lumber: 50 }, food: 2, buildTime: 24, hotkey: 'X', level: 4, description: 'Heavy ranged infantry.',
});
def('champion', {
  name: 'Champion', age: 5, hp: 950, armor: 6, armorType: 'heavy', damage: [30, 36], attackCooldown: 1.3,
  speed: 3.0, radius: 0.48, cost: { gold: 190, lumber: 50 }, food: 3, buildTime: 30, hotkey: 'O', level: 5,
  description: 'Elite heavy infantry.',
});
def('royal_knight', {
  name: 'Royal Knight', age: 5, hp: 1350, armor: 8, armorType: 'heavy', damage: [40, 48], attackCooldown: 1.4,
  speed: 3.7, radius: 0.65, cavalry: true, cost: { gold: 320, lumber: 110 }, food: 5, buildTime: 45, hotkey: 'R',
  level: 6, description: 'The finest heavy cavalry of the realm.',
});
def('trebuchet', {
  name: 'Trebuchet', age: 5, hp: 700, armor: 3, armorType: 'heavy', damage: [120, 150], attackType: 'siege',
  attackCooldown: 5, range: 14, minRange: 4, projectile: { kind: 'rock', speed: 12, arc: true }, splash: 2,
  speed: 1.8, radius: 1.0, turnRate: 3, cost: { gold: 360, lumber: 200 }, food: 4, buildTime: 50, hotkey: 'T',
  level: 5, attackGround: true, description: 'Huge siege engine that shatters walls and keeps.',
});
def('sorceress', {
  name: 'Sorceress', age: 5, hp: 325, armor: 0, armorType: 'unarmored', damage: [10, 12], attackType: 'magic',
  attackCooldown: 1.75, range: 5, projectile: { kind: 'bolt', color: 0xd27bff, speed: 14 }, speed: 2.7,
  radius: 0.38, mana: 200, manaRegen: 0.67, cost: { gold: 155, lumber: 20 }, food: 2, buildTime: 28,
  hotkey: 'S', level: 3, abilities: ['slow'], description: 'Caster. Automatically casts Slow on enemies.',
});
def('battlemage', {
  name: 'Battle Mage', age: 5, hp: 480, armor: 1, armorType: 'unarmored', damage: [28, 34], attackType: 'magic',
  attackCooldown: 2.0, range: 6, projectile: { kind: 'fireball', speed: 13 }, splash: 1.3, speed: 2.8,
  radius: 0.42, mana: 250, manaRegen: 0.8, cost: { gold: 240, lumber: 90 }, food: 3, buildTime: 32, hotkey: 'B',
  level: 4, description: 'War-wizard whose fireballs burn groups of enemies.',
});
// 6. Gunpowder Age
def('musketeer', {
  name: 'Musketeer', age: 6, hp: 480, armor: 1, damage: [30, 36], attackType: 'pierce', attackCooldown: 2.2,
  range: 6.5, projectile: { kind: 'bullet', speed: 40 }, firearm: true, speed: 2.9, radius: 0.4,
  cost: { gold: 160, lumber: 40 }, food: 2, buildTime: 24, hotkey: 'M', level: 5,
  description: 'Infantry with a flintlock musket. Slow to reload, hard-hitting.',
});
def('grenadier', {
  name: 'Grenadier', age: 6, hp: 460, armor: 1, damage: [34, 40], attackType: 'siege', attackCooldown: 2.4,
  range: 5.5, projectile: { kind: 'grenade', speed: 11, arc: true }, splash: 1.4, speed: 2.9, radius: 0.4,
  cost: { gold: 180, lumber: 60 }, food: 2, buildTime: 26, hotkey: 'G', level: 5,
  description: 'Throws black-powder bombs that blast groups and buildings.',
});
def('dragoon', {
  name: 'Dragoon', age: 6, hp: 950, armor: 3, damage: [30, 36], attackCooldown: 1.3, speed: 4.2, radius: 0.6,
  cavalry: true, cost: { gold: 220, lumber: 70 }, food: 3, buildTime: 30, hotkey: 'D', level: 5,
  description: 'Mounted saber cavalry.',
});
def('cannon', {
  name: 'Cannon', age: 6, hp: 650, armor: 3, armorType: 'heavy', damage: [110, 130], attackType: 'siege',
  attackCooldown: 4, range: 12, minRange: 2.5, projectile: { kind: 'cannonball', speed: 24, arc: true }, firearm: true,
  splash: 1.5, speed: 2.2, radius: 0.75, turnRate: 4, cost: { gold: 300, lumber: 120 }, food: 3, buildTime: 38,
  hotkey: 'N', level: 5, attackGround: true, description: 'Field cannon. Smashes walls and massed troops.',
});
// 7. Industrial Age
def('rifleman', {
  name: 'Rifleman', age: 7, hp: 560, armor: 2, damage: [36, 42], attackType: 'pierce', attackCooldown: 1.7,
  range: 7.5, projectile: { kind: 'bullet', speed: 45 }, firearm: true, speed: 3.0, radius: 0.4,
  cost: { gold: 170, lumber: 30 }, food: 2, buildTime: 24, hotkey: 'R', level: 6,
  description: 'Bolt-action rifle infantry.',
});
def('machine_gunner', {
  name: 'Machine Gunner', age: 7, hp: 600, armor: 2, damage: [12, 14], attackType: 'pierce', attackCooldown: 0.35,
  range: 6.5, projectile: { kind: 'bullet', speed: 45 }, firearm: true, speed: 2.6, radius: 0.42,
  cost: { gold: 220, lumber: 60 }, food: 3, buildTime: 28, hotkey: 'G', level: 6,
  description: 'Hoses enemies with a heavy machine gun. Shreds infantry.',
});
def('steam_tank', {
  name: 'Landship', age: 7, hp: 1800, armor: 6, armorType: 'heavy', damage: [55, 65], attackType: 'siege',
  attackCooldown: 2.2, range: 6, projectile: { kind: 'shell', speed: 30 }, firearm: true, vehicle: true,
  speed: 2.3, radius: 0.95, turnRate: 3, cost: { gold: 380, lumber: 110 }, food: 5, buildTime: 45, hotkey: 'L',
  level: 7, description: 'Lumbering armored landship. Shrugs off rifle fire.',
});
def('howitzer', {
  name: 'Howitzer', age: 7, hp: 700, armor: 3, armorType: 'heavy', damage: [160, 190], attackType: 'siege',
  attackCooldown: 5, range: 16, minRange: 4, projectile: { kind: 'shell', speed: 22, arc: true }, firearm: true,
  splash: 2, speed: 2.0, radius: 0.8, turnRate: 3, cost: { gold: 380, lumber: 100 }, food: 4, buildTime: 45,
  hotkey: 'H', level: 6, attackGround: true, description: 'Long-range artillery.',
});
// 8. Atomic Age
def('flamethrower', {
  name: 'Flamethrower', age: 8, hp: 700, armor: 3, damage: [26, 30], attackType: 'magic', attackCooldown: 0.9,
  range: 3.5, projectile: { kind: 'flame', speed: 18 }, splash: 1.4, firearm: true, speed: 2.9, radius: 0.42,
  cost: { gold: 210, lumber: 50 }, food: 2, buildTime: 24, hotkey: 'F', level: 7,
  description: 'Burns groups of infantry and buildings at close range.',
});
def('sniper', {
  name: 'Sniper', age: 8, hp: 450, armor: 1, damage: [95, 110], attackType: 'pierce', attackCooldown: 3.5,
  range: 11, sight: 13, projectile: { kind: 'bullet', speed: 60 }, firearm: true, speed: 3.0, radius: 0.38,
  cost: { gold: 240, lumber: 40 }, food: 2, buildTime: 26, hotkey: 'S', level: 7,
  description: 'Long-range marksman. Picks off soldiers and heroes from afar.',
});
def('half_track', {
  name: 'Half-track', age: 8, hp: 1500, armor: 5, armorType: 'heavy', damage: [16, 19], attackType: 'pierce',
  attackCooldown: 0.35, range: 7, projectile: { kind: 'bullet', speed: 50 }, firearm: true, vehicle: true,
  speed: 4.2, radius: 0.85, turnRate: 5, cost: { gold: 320, lumber: 90 }, food: 4, buildTime: 40, hotkey: 'H',
  level: 7, description: 'Fast armored carrier with a heavy machine gun.',
});
// 9. Modern Age
def('infantry', {
  name: 'Infantry', age: 9, hp: 650, armor: 3, damage: [20, 24], attackType: 'pierce', attackCooldown: 0.8,
  range: 7.5, projectile: { kind: 'bullet', speed: 50 }, firearm: true, speed: 3.1, radius: 0.38,
  cost: { gold: 180, lumber: 30 }, food: 2, buildTime: 22, hotkey: 'I', level: 7,
  description: 'Modern soldier with an assault rifle.',
});
def('bazooka', {
  name: 'Rocket Trooper', age: 9, hp: 600, armor: 2, damage: [90, 110], attackType: 'siege', attackCooldown: 3,
  range: 7, projectile: { kind: 'rocket', speed: 20 }, firearm: true, speed: 2.9, radius: 0.4,
  cost: { gold: 240, lumber: 80 }, food: 2, buildTime: 26, hotkey: 'R', level: 7,
  description: 'Shoulder-fired rockets. Strong against vehicles and buildings.',
});
def('tank', {
  name: 'Battle Tank', age: 9, hp: 2600, armor: 8, armorType: 'heavy', damage: [90, 105], attackType: 'siege',
  attackCooldown: 2.5, range: 8, projectile: { kind: 'shell', speed: 40 }, firearm: true, vehicle: true, splash: 0.8,
  speed: 3.0, radius: 0.95, turnRate: 4, cost: { gold: 500, lumber: 120 }, food: 6, buildTime: 50, hotkey: 'T',
  level: 8, description: 'Main battle tank.',
});
def('rocket_artillery', {
  name: 'Rocket Artillery', age: 9, hp: 1200, armor: 3, armorType: 'heavy', damage: [70, 85], attackType: 'siege',
  attackCooldown: 6, range: 18, minRange: 4, projectile: { kind: 'rocket', speed: 18, arc: true }, salvo: 4,
  firearm: true, vehicle: true, splash: 2.2, speed: 2.6, radius: 0.9, turnRate: 4, cost: { gold: 470, lumber: 130 },
  food: 5, buildTime: 50, hotkey: 'A', level: 7, attackGround: true, description: 'Fires salvos of rockets from long range.',
});
// 10. Digital Age
def('railgunner', {
  name: 'Railgunner', age: 10, hp: 900, armor: 4, damage: [80, 95], attackType: 'pierce', attackCooldown: 2.2,
  range: 10, projectile: { kind: 'rail', color: 0x9fd8ff }, firearm: true, speed: 3.1, radius: 0.4,
  cost: { gold: 260, lumber: 60 }, food: 2, buildTime: 26, hotkey: 'R', level: 8,
  description: 'Soldier with a magnetic railgun that punches through armor.',
});
def('combat_drone', {
  name: 'Combat Drone', age: 10, hp: 900, armor: 3, armorType: 'light', damage: [22, 26], attackType: 'pierce',
  attackCooldown: 0.6, range: 7, projectile: { kind: 'bullet', speed: 55 }, firearm: true, vehicle: true,
  speed: 5.0, radius: 0.6, turnRate: 8, cost: { gold: 240, lumber: 80 }, food: 3, buildTime: 30, hotkey: 'D',
  level: 8, description: 'Fast hovering gun drone.',
});
def('stealth_tank', {
  name: 'Stealth Tank', age: 10, hp: 2800, armor: 9, armorType: 'heavy', damage: [110, 125], attackType: 'siege',
  attackCooldown: 2.3, range: 8.5, projectile: { kind: 'rail', color: 0x9fd8ff }, firearm: true, vehicle: true,
  speed: 3.4, radius: 0.95, turnRate: 4, cost: { gold: 560, lumber: 150 }, food: 6, buildTime: 50, hotkey: 'T',
  level: 9, description: 'Faceted stealth tank with a railgun.',
});
// 11. Future Age
def('laser_trooper', {
  name: 'Laser Trooper', age: 11, hp: 900, armor: 5, damage: [48, 56], attackType: 'magic', attackCooldown: 1.2,
  range: 8, projectile: { kind: 'laser', color: 0x5ff2ff }, firearm: true, speed: 3.2, radius: 0.4,
  cost: { gold: 260, lumber: 80 }, food: 2, buildTime: 26, hotkey: 'L', level: 8,
  description: 'Power-armored soldier with a laser rifle.',
});
def('exo_trooper', {
  name: 'Exo Trooper', age: 11, hp: 1700, armor: 10, armorType: 'heavy', damage: [60, 72], attackCooldown: 1.1,
  speed: 3.4, radius: 0.5, cost: { gold: 320, lumber: 120 }, food: 3, buildTime: 30, hotkey: 'E', level: 9,
  description: 'Exoskeleton warrior with an energy blade.',
});
def('hover_tank', {
  name: 'Hover Tank', age: 11, hp: 3000, armor: 10, armorType: 'heavy', damage: [110, 130], attackType: 'magic',
  attackCooldown: 2.2, range: 8.5, projectile: { kind: 'plasma', color: 0x6af7ff, speed: 30 }, firearm: true,
  vehicle: true, splash: 1.2, speed: 4.0, radius: 0.9, turnRate: 6, cost: { gold: 600, lumber: 150 }, food: 6,
  buildTime: 50, hotkey: 'H', level: 9, description: 'Anti-gravity tank with twin plasma cannons.',
});
def('mech_walker', {
  name: 'Mech Walker', age: 11, hp: 4500, armor: 12, armorType: 'heavy', damage: [140, 170], attackType: 'siege',
  attackCooldown: 2.6, range: 9, projectile: { kind: 'plasma', color: 0xff8a3a, speed: 26 }, firearm: true,
  vehicle: true, splash: 1.5, speed: 2.7, radius: 0.85, turnRate: 4, cost: { gold: 800, lumber: 200 }, food: 8,
  buildTime: 60, hotkey: 'M', level: 10, description: 'Towering bipedal war machine.',
});

// 12. Galactic Age
def('void_trooper', {
  name: 'Void Trooper', age: 12, hp: 1400, armor: 8, damage: [70, 82], attackType: 'magic', attackCooldown: 1.1,
  range: 8, projectile: { kind: 'plasma', color: 0xc77bff, speed: 34 }, firearm: true, speed: 3.4, radius: 0.42,
  cost: { gold: 320, lumber: 90 }, food: 2, buildTime: 26, hotkey: 'V', level: 10,
  description: 'Elite soldier of the stars with a plasma lance.',
});
def('starfighter', {
  name: 'Starfighter', age: 12, hp: 2200, armor: 7, armorType: 'light', damage: [60, 70], attackType: 'magic',
  attackCooldown: 0.8, range: 8, projectile: { kind: 'laser', color: 0xff6bf0 }, firearm: true, vehicle: true,
  speed: 5.2, radius: 0.95, turnRate: 8, cost: { gold: 520, lumber: 140 }, food: 4, buildTime: 40, hotkey: 'S',
  level: 10, description: 'Antigravity attack craft. Very fast.',
});
def('titan', {
  name: 'War Titan', age: 12, hp: 9000, armor: 15, armorType: 'heavy', damage: [220, 260], attackType: 'chaos',
  attackCooldown: 2.8, range: 10, projectile: { kind: 'plasma', color: 0xc77bff, speed: 26 }, splash: 2,
  firearm: true, vehicle: true, speed: 2.4, radius: 1.3, turnRate: 3, sight: 13, cost: { gold: 1400, lumber: 400 },
  food: 12, buildTime: 90, hotkey: 'T', level: 12, description: 'Colossal walking war machine.',
});
def('graviton', {
  name: 'Graviton Lance', age: 12, hp: 1600, armor: 6, armorType: 'heavy', damage: [260, 300], attackType: 'chaos',
  attackCooldown: 6, range: 20, minRange: 5, projectile: { kind: 'plasma', color: 0xe0a0ff, speed: 22, arc: true },
  splash: 3, firearm: true, vehicle: true, speed: 2.3, radius: 1.0, turnRate: 3, cost: { gold: 750, lumber: 220 },
  food: 6, buildTime: 60, hotkey: 'G', level: 10, attackGround: true, description: 'Antigravity artillery that crushes whole armies.',
});

// ------------------------------------------------------------ Empire buildings
function building(id: string, d: DefInit): UnitDef {
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

// The town center keeps one identity and changes with each age.
building('townhall', {
  name: 'Town Center', model: 'stone_camp', footprint: 4, cost: { gold: 385, lumber: 205 }, buildTime: 100,
  ageNames: ['Tribal Camp', 'Chiefdom Hall', 'Forum', 'Town Hall', 'Castle', 'Palace', 'City Hall', 'Ministry', 'Capitol', 'Smart Hub', 'Nexus', 'Star Citadel'],
  ageModels: ['stone_camp', 'bronze_hall', 'iron_forum', 'townhall', 'castle', 'palace', 'city_hall', 'atomic_hall', 'capitol', 'digital_hub', 'nexus', 'galactic_citadel'],
  hpByAge: [1300, 1600, 1800, 2000, 2400, 2800, 3200, 3500, 3800, 4200, 4600, 5200], armorByAge: [3, 4, 4, 5, 6, 7, 8, 8, 9, 10, 10, 12],
  foodProvided: 10, housing: 5, dropOff: true, trains: ['peasant'], tier: 1, hotkey: 'N', sight: 12,
  description: 'Heart of your empire. Trains Peasants, receives resources, sets taxes and rations, hires Heroes and advances your empire to the next age.',
});
building('house', {
  name: 'House', model: 'house_stone',
  ageNames: ['Hide Hut', 'Round Hut', 'Domus', 'Cottage', 'Townhouse', 'Manor', 'Rowhouse', 'Bungalow', 'Apartments', 'Smart Home', 'Habitat Pod', 'Sky Habitat'],
  ageModels: ['house_stone', 'house_1', 'house_iron', 'house_2', 'house_3', 'house_4', 'house_ind', 'house_atomic', 'house_mod', 'house_digital', 'house_fut', 'house_galactic'],
  hpByAge: [250, 300, 350, 400, 550, 700, 850, 900, 1000, 1100, 1200, 1400], housingByAge: [4, 5, 5, 6, 7, 8, 10, 11, 12, 13, 14, 16],
  needsRoad: true, footprint: 2, cost: { gold: 50, lumber: 30 }, buildTime: 18, armor: 1, sight: 6, hotkey: 'H',
  description: 'Shelters citizens, who pay taxes and let you field a bigger army. Must touch a road that leads to your town center.',
});
building('farm', {
  name: 'Farm', model: 'farm_1',
  ageNames: ['Gathering Field', 'Field', 'Field', 'Farm', 'Farm', 'Farm', 'Industrial Farm', 'Industrial Farm', 'Industrial Farm', 'Hydroponic Farm', 'Hydroponic Farm', 'Hydroponic Farm'],
  ageModels: ['farm_1', 'farm_1', 'farm_1', 'farm_1', 'farm_1', 'farm_1', 'farm_2', 'farm_2', 'farm_2', 'farm_3', 'farm_3', 'farm_3'],
  hpByAge: [300, 350, 380, 400, 450, 500, 650, 720, 800, 900, 1000, 1150], foodRateByAge: [0.4, 0.5, 0.55, 0.6, 0.7, 0.8, 1.0, 1.1, 1.2, 1.35, 1.5, 1.7],
  footprint: 3, cost: { gold: 40, lumber: 50 }, buildTime: 20, armor: 0, sight: 6, hotkey: 'F',
  description: 'Grows food to feed your citizens their rations. Better farming comes with each age.',
});
building('lumberyard', {
  name: 'Lumber Yard', hp: 900, footprint: 3, cost: { gold: 120, lumber: 0 }, buildTime: 35, dropOff: 'lumber',
  hotkey: 'L', description: 'Peasants can return lumber here, so they spend less time walking.',
});
building('barracks', {
  name: 'Barracks', hp: 1200, footprint: 3, cost: { gold: 160, lumber: 60 }, buildTime: 45,
  trains: ['caveman', 'rock_thrower', 'hoplite', 'bowman', 'legionary', 'javelineer', 'footman', 'spearman', 'archer',
    'crossbowman', 'champion', 'musketeer', 'grenadier', 'rifleman', 'machine_gunner', 'flamethrower', 'sniper', 'infantry',
    'bazooka', 'railgunner', 'laser_trooper', 'exo_trooper', 'void_trooper'],
  hotkey: 'B', description: 'Trains infantry of your current and previous age.',
});
building('stable', {
  name: 'Stable', hp: 1100, footprint: 3, cost: { gold: 170, lumber: 90 }, buildTime: 45, age: 2,
  trains: ['chariot', 'war_elephant', 'scout_rider', 'knight', 'royal_knight', 'dragoon'], hotkey: 'E',
  description: 'Trains chariots, war elephants and cavalry. Requires the Bronze Age.',
});
building('research_center', {
  name: 'Research Center', model: 'research_1', hp: 1000, footprint: 3, cost: { gold: 120, lumber: 80 }, buildTime: 40,
  ageNames: ['Academy', 'Academy', 'Academy', 'Academy', 'Academy', 'Academy', 'Laboratory', 'Laboratory', 'Laboratory', 'Research Complex', 'Research Complex', 'Research Complex'],
  ageModels: ['research_1', 'research_1', 'research_1', 'research_1', 'research_1', 'research_1', 'research_2', 'research_2', 'research_2', 'research_3', 'research_3', 'research_3'],
  hpByAge: [800, 900, 1000, 1100, 1200, 1300, 1500, 1600, 1700, 1900, 2000, 2300],
  researches: ['weaponry', 'armor', 'vitality', 'mobility', 'forestry', 'mining', 'housing', 'agriculture', 'masonry', 'commerce', 'civics', 'medicine'],
  hotkey: 'C', description: 'Researches upgrades for your whole empire: damage, armor, health, speed, gathering, housing, farming and more. Each age unlocks higher levels.',
});
building('workshop', {
  name: 'Workshop', hp: 1000, footprint: 3, cost: { gold: 140, lumber: 140 }, buildTime: 50, age: 3,
  trains: ['ballista', 'catapult', 'trebuchet', 'cannon', 'howitzer', 'graviton'], hotkey: 'K',
  description: 'Builds siege engines and artillery. Requires the Iron Age.',
});
building('sanctum', {
  name: 'Arcane Sanctum', hp: 1000, footprint: 3, cost: { gold: 150, lumber: 140 }, buildTime: 50, age: 4,
  trains: ['priest', 'sorceress', 'battlemage'], hotkey: 'A',
  description: 'Trains Priests, Sorceresses and Battle Mages. Requires the Dark Age.',
});
building('factory', {
  name: 'Factory', hp: 2000, armor: 7, footprint: 3, cost: { gold: 450, lumber: 180 }, buildTime: 60, age: 7,
  trains: ['steam_tank', 'half_track', 'tank', 'rocket_artillery', 'combat_drone', 'stealth_tank', 'hover_tank', 'mech_walker', 'starfighter', 'titan'], hotkey: 'Y',
  description: 'Builds armored vehicles, drones and war machines. Requires the Industrial Age.',
});
building('missile_silo', {
  name: 'Missile Silo', hp: 2500, armor: 9, footprint: 3, cost: { gold: 700, lumber: 250 }, buildTime: 80, age: 9,
  nukes: true, hotkey: 'M', sight: 10,
  description: 'Builds and launches nuclear missiles. Requires the Modern Age.',
});
building('scouttower', {
  name: 'Scout Tower', hp: 300, footprint: 2, cost: { gold: 30, lumber: 20 }, buildTime: 20, sight: 14,
  upgradesTo: 'guardtower', hotkey: 'T', armor: 0, description: 'Lookout tower. Can be upgraded to a defensive tower.',
});
building('guardtower', {
  name: 'Guard Tower', hp: 500, footprint: 2, cost: { gold: 70, lumber: 50 }, buildTime: 25, sight: 14,
  ageNames: ['Watchtower', 'Watchtower', 'Watchtower', 'Guard Tower', 'Guard Tower', 'Musket Tower', 'MG Bunker', 'MG Bunker', 'MG Bunker', 'Laser Turret', 'Laser Turret', 'Laser Turret'],
  ageModels: ['guardtower', 'guardtower', 'guardtower', 'guardtower', 'guardtower', 'guardtower', 'tower_bunker', 'tower_bunker', 'tower_bunker', 'tower_laser', 'tower_laser', 'tower_laser'],
  hpByAge: [450, 500, 550, 600, 750, 850, 1100, 1200, 1300, 1500, 1600, 1900], armorByAge: [3, 4, 4, 5, 6, 7, 8, 8, 9, 10, 10, 12],
  damageByAge: [[16, 19], [18, 21], [20, 23], [22, 26], [26, 30], [34, 40], [14, 16], [16, 18], [18, 21], [52, 60], [60, 70], [75, 85]],
  cooldownByAge: [1.1, 1.0, 1.0, 1.0, 1.0, 1.4, 0.35, 0.32, 0.3, 1.2, 1.2, 1.1],
  projectileByAge: [
    { kind: 'arrow', speed: 20 }, { kind: 'arrow', speed: 20 }, { kind: 'arrow', speed: 20 }, { kind: 'arrow', speed: 20 },
    { kind: 'arrow', speed: 22 }, { kind: 'bullet', speed: 40 }, { kind: 'bullet', speed: 45 }, { kind: 'bullet', speed: 48 },
    { kind: 'bullet', speed: 50 }, { kind: 'laser', color: 0x5ff2ff }, { kind: 'laser', color: 0x5ff2ff }, { kind: 'laser', color: 0xff6bf0 },
  ],
  damage: [22, 26], attackType: 'pierce', attackCooldown: 1.0, range: 8,
  projectile: { kind: 'arrow', speed: 20 }, hotkey: 'U', age: 2,
  description: 'Defensive tower. Fires arrows, then bullets, then lasers as the ages advance. Requires the Bronze Age.',
});
building('wall', {
  name: 'Wall', model: 'wall_palisade',
  ageNames: ['Palisade', 'Palisade', 'Stone Wall', 'Stone Wall', 'Castle Wall', 'Bastion Wall', 'Concrete Wall', 'Concrete Wall', 'Reinforced Wall', 'Energy Wall', 'Energy Wall', 'Force Field'],
  ageModels: ['wall_palisade', 'wall_palisade', 'wall_stone', 'wall_stone', 'wall_fortified', 'wall_fortified', 'wall_concrete', 'wall_concrete', 'wall_concrete', 'wall_energy', 'wall_energy', 'wall_force'],
  hpByAge: [250, 350, 550, 650, 900, 1200, 1500, 1700, 1900, 2200, 2400, 3000], armorByAge: [3, 4, 6, 7, 9, 10, 11, 11, 12, 13, 14, 16],
  footprint: 1, cost: { gold: 2, lumber: 6 }, buildTime: 5, sight: 4, hotkey: 'W',
  wall: true, description: 'Drag to build a line of wall. Walls are rebuilt stronger in each age.',
});
building('gate', {
  name: 'Gate', model: 'gate_wood',
  ageNames: ['Wooden Gate', 'Wooden Gate', 'Stone Gate', 'Stone Gate', 'Castle Gate', 'Bastion Gate', 'Checkpoint Gate', 'Checkpoint Gate', 'Checkpoint Gate', 'Energy Gate', 'Energy Gate', 'Force Gate'],
  ageModels: ['gate_wood', 'gate_wood', 'gate_stone', 'gate_stone', 'gate_fortified', 'gate_fortified', 'gate_concrete', 'gate_concrete', 'gate_concrete', 'gate_energy', 'gate_energy', 'gate_force'],
  hpByAge: [500, 650, 1100, 1300, 1800, 2300, 2700, 3000, 3200, 3700, 4000, 5000], armorByAge: [3, 4, 6, 7, 9, 10, 11, 11, 12, 13, 14, 16],
  footprint: 2, cost: { gold: 20, lumber: 40 }, buildTime: 15, sight: 6, hotkey: 'G',
  gate: true, description: 'Lets you and your allies through a wall and keeps enemies out. Can be placed over your walls.',
});
building('altar', {
  name: 'Altar of Heroes', hp: 1800, armor: 6, footprint: 3, cost: { gold: 180, lumber: 50 }, buildTime: 60,
  foodProvided: 16, revivesHeroes: true, sanctuary: true, hotkey: 'A', sight: 10,
  damage: [26, 32], attackType: 'normal', attackCooldown: 1.4, range: 7,
  projectile: { kind: 'bolt', color: 0xfff0a0, speed: 16 },
  description: 'Revives your fallen Hero, smites nearby enemies and slowly heals your units. Provides 16 food for your Hero and mercenaries.',
});

// Unlocks: a unit or structure of age N requires that age.
for (const d of Object.values(U)) {
  if (d.age && d.age > 1) d.requires = [`age${d.age}`, ...(d.requires ?? []).filter((r) => !/^age\d+$/.test(r))];
}

/** Structures a Peasant can build, split into the two build menus. */
export const BUILD_MENUS: Record<'basic' | 'advanced', string[]> = {
  basic: ['house', 'road', 'farm', 'wall', 'gate', 'lumberyard', 'barracks', 'scouttower', 'townhall'],
  advanced: ['research_center', 'stable', 'workshop', 'sanctum', 'factory', 'missile_silo'],
};
/** Roads are laid tile by tile (not units). */
export const ROAD: { name: string; cost: Cost; hotkey: string; speedBonus: number; description: string } = {
  name: 'Road', cost: { gold: 2, lumber: 0 }, hotkey: 'R', speedBonus: 1.3,
  description: 'Drag to lay a road. Houses must touch a road connected to your town center. Units move faster on roads, and a well-paved city keeps its people happy.',
};

// ------------------------------------------------------------------ Economy
// Gold comes mostly from taxing your citizens; farms feed them their rations.
export const ECONOMY = {
  // Taxes and rations have no upper limit: the people's mood keeps them in check.
  taxPerCitizen: 0.02, // gold per second per citizen per point of tax
  foodPerRation: 0.0033, // food per second per citizen per ration point
  moods: [
    { min: 200, name: 'Utopia', icon: '🌟', color: '#ffe066', income: 1.6, growth: 2.2 },
    { min: 150, name: 'Ecstatic', icon: '🤩', color: '#9effc8', income: 1.45, growth: 1.9 },
    { min: 110, name: 'Devoted', icon: '🥰', color: '#8affa0', income: 1.35, growth: 1.7 },
    { min: 80, name: 'Love', icon: '😍', color: '#7dff8a', income: 1.25, growth: 1.5 },
    { min: 60, name: 'Happy', icon: '🙂', color: '#b8ff7d', income: 1.1, growth: 1.15 },
    { min: 40, name: 'Normal', icon: '😐', color: '#ffe680', income: 1, growth: 1 },
    { min: 20, name: 'Unhappy', icon: '🙁', color: '#ffae5a', income: 0.6, growth: 0 },
    { min: -Infinity, name: 'Hate', icon: '😡', color: '#ff5a5a', income: 0, growth: 0 },
  ] satisfies Mood[],
  maxHappiness: 250,
  hireFee: (level: number) => 120 + 45 * level,
  hireTime: 180,
  nuke: { cost: { gold: 800, lumber: 150 }, time: 90, radius: 9, damage: 1800, flight: 7 },
};

// --------------------------------------------------------------------- Heroes
// Hero stats: base damage + primary attribute. See data/heroes.js for
// attributes and abilities.
function hero(id: string, d: DefInit): UnitDef {
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
function creep(id: string, d: DefInit): UnitDef {
  return def(id, { creep: true, hpRegen: 0.5, sight: 8, ...d });
}
creep('kobold', {
  name: 'Kobold', hp: 240, armor: 1, damage: [7, 8], attackCooldown: 1.35, speed: 2.7, radius: 0.35,
  level: 1, bounty: [8, 12], food: 1, cost: { gold: 0, lumber: 0 },
});
creep('gnoll', {
  name: 'Gnoll Brute', hp: 330, armor: 1, damage: [11, 13], attackCooldown: 1.35, speed: 2.8,
  level: 2, bounty: [12, 16], food: 2, cost: { gold: 120, lumber: 0 }, hotkey: 'G',
  description: 'Hardy gnoll mercenary.',
});
creep('gnoll_archer', {
  name: 'Gnoll Poacher', hp: 240, armor: 0, damage: [10, 12], attackType: 'pierce', attackCooldown: 1.5,
  range: 5, projectile: { kind: 'arrow', speed: 16 }, speed: 2.8, radius: 0.4, level: 2, bounty: [12, 16],
  food: 2, cost: { gold: 130, lumber: 0 }, hotkey: 'P', description: 'Gnoll archer for hire. Fragile but quick to shoot.',
});
creep('wolf', {
  name: 'Timber Wolf', hp: 340, armor: 1, damage: [14, 16], attackCooldown: 1.2, speed: 3.6, radius: 0.5,
  level: 3, bounty: [14, 18], food: 2, cost: { gold: 140, lumber: 0 }, hotkey: 'W', description: 'A swift wolf of the deep woods.',
});
creep('murloc', {
  name: 'Murloc Tiderunner', hp: 270, armor: 0, armorType: 'light', damage: [10, 12], attackCooldown: 1.3, speed: 3.0,
  radius: 0.36, level: 2, bounty: [10, 14], food: 1, cost: { gold: 90, lumber: 0 }, hotkey: 'M',
  description: 'Cheap, quick little fish-man from the lakeshore.',
});
creep('brigand', {
  name: 'Brigand', hp: 360, armor: 2, damage: [12, 15], attackCooldown: 1.3, speed: 2.9, radius: 0.42,
  level: 2, bounty: [13, 17], food: 2, cost: { gold: 130, lumber: 0 }, hotkey: 'B', description: 'A hooded cutthroat who fights for coin.',
});
creep('harpy', {
  name: 'Harpy Windwitch', hp: 330, armor: 1, armorType: 'light', damage: [15, 18], attackType: 'pierce',
  attackCooldown: 1.6, range: 4.5, projectile: { kind: 'bolt', color: 0xa8ff8a, speed: 14 }, speed: 3.3, radius: 0.45,
  level: 3, bounty: [15, 20], food: 2, cost: { gold: 160, lumber: 0 }, hotkey: 'H', description: 'A shrieking harpy that strikes from range.',
});
creep('troll_shaman', {
  name: 'Troll Shaman', hp: 320, armor: 0, mana: 300, manaRegen: 1, damage: [12, 15], attackType: 'magic',
  attackCooldown: 1.8, range: 5.5, projectile: { kind: 'bolt', color: 0x7ad8ff, speed: 14 }, speed: 2.9, radius: 0.42,
  level: 3, bounty: [15, 20], abilities: ['creep_heal'], food: 2, cost: { gold: 180, lumber: 0 }, hotkey: 'S',
  description: 'Troll witch doctor who mends the wounds of his allies.',
});
creep('naga_siren', {
  name: 'Naga Siren', hp: 560, armor: 2, armorType: 'light', mana: 400, manaRegen: 1, damage: [22, 27],
  attackType: 'magic', attackCooldown: 1.7, range: 5.5, projectile: { kind: 'bolt', color: 0x6af0ff, speed: 14 },
  speed: 2.8, radius: 0.5, level: 5, bounty: [24, 30], abilities: ['frost_nova'], food: 3, cost: { gold: 260, lumber: 0 },
  hotkey: 'N', description: 'Sea witch whose frost nova chills and slows her foes.',
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

// Bosses of the four lairs: named, immune to stuns, slow to respawn, and guarding a treasure.
function boss(id: string, d: DefInit): UnitDef {
  return creep(id, { boss: true, armorType: 'hero', sight: 10, hpRegen: 2, ...d });
}
boss('dragon', {
  name: 'Vyrnax the Red', title: 'Elder Dragon of the North', hp: 4200, armor: 5, damage: [60, 72], attackType: 'chaos',
  attackCooldown: 1.9, range: 4.5, projectile: { kind: 'fireball', speed: 12 }, splash: 1.6, speed: 3.0, radius: 1.1,
  level: 12, bounty: [260, 320], abilities: ['dragon_breath'],
  description: 'An ancient red dragon brooding on a hoard of gold.',
});
boss('hydra', {
  name: 'The Ancient Hydra', title: 'Terror of the Eastern Pool', hp: 3800, armor: 4, hpRegen: 10, damage: [42, 52],
  attackType: 'chaos', attackCooldown: 1.5, range: 4, projectile: { kind: 'bolt', color: 0x9aff3a, speed: 12 }, splash: 1.4,
  speed: 2.4, radius: 1.0, level: 11, bounty: [240, 300], abilities: ['acid_spray'],
  description: 'Three heads, each hungrier than the last. Its wounds close almost as fast as they open.',
});
boss('bandit_lord', {
  name: 'Varrok the Bandit Lord', title: 'King of Thieves', hp: 3200, armor: 7, damage: [55, 66], attackType: 'hero',
  attackCooldown: 1.4, cleave: 0.4, speed: 3.1, radius: 0.65, level: 10, bounty: [220, 280], abilities: ['bandit_call', 'creep_stomp'],
  description: 'Lord of the southern brigands, who calls his cutthroats to his side.',
});
boss('broodmother', {
  name: 'The Broodmother', title: 'Queen of the Webs', hp: 3600, armor: 5, damage: [50, 60], attackType: 'normal',
  attackCooldown: 1.3, speed: 3.0, radius: 1.0, level: 10, bounty: [220, 280], abilities: ['brood_spawn', 'web'],
  description: 'A monstrous spider queen whose brood swarms any intruder.',
});

// -------------------------------------------------------- Kalenden's Legion
function legion(id: string, d: DefInit): UnitDef {
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
U['dark_knight']!.undead = true;
U['kalenden']!.undead = true;

building('kalenden_keep', {
  name: "Kalenden's Keep", hp: 6000, armor: 8, footprint: 6, sight: 12, legion: true, hpRegen: 5,
  description: 'Seat of the tyrant. His Legion marches from here.',
});
building('dark_tower', {
  name: 'Dark Spire', hp: 1100, armor: 6, footprint: 2, damage: [38, 46], attackType: 'magic', attackCooldown: 1.4,
  range: 8, projectile: { kind: 'bolt', color: 0x9dff6a, speed: 16 }, sight: 11, legion: true,
});

// ----------------------------------------------------------- Neutral buildings
def('cargo_wagon', {
  name: 'Merchant Caravan', hp: 1400, armor: 3, armorType: 'heavy', speed: 2.1, radius: 0.8, turnRate: 4, sight: 6,
  level: 5, bounty: [450, 550], caravan: true, description: 'A wagon loaded with gold. Whoever stops it keeps the treasure.',
});
def('merchant_wagon', {
  name: 'Merchant’s Wagon', model: 'cargo_wagon', hp: 1200, armor: 3, armorType: 'heavy', speed: 2.2, radius: 0.8, turnRate: 4,
  sight: 6, level: 4, description: 'A merchant bound for the next outpost. Keep it alive until it arrives.',
});
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
// The themed camps of the four edges.
building('merc_highland', {
  name: 'Highland Camp', model: 'mercenary_camp', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0, sight: 0,
  mercenaries: ['gnoll', 'harpy', 'ogre', 'rock_golem'],
  description: 'Hill ogres, harpies and stone golems of the north. Hire them when one of your units is nearby.',
});
building('merc_lake', {
  name: 'Lakeside Hut', model: 'mercenary_camp', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0, sight: 0,
  mercenaries: ['murloc', 'troll_shaman', 'naga_siren', 'ogre'],
  description: 'Murlocs, shamans and naga of the eastern waters. Hire them when one of your units is nearby.',
});
building('merc_bandit', {
  name: 'Brigand Hideout', model: 'mercenary_camp', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0, sight: 0,
  mercenaries: ['brigand', 'gnoll_archer', 'forest_troll', 'ogre'],
  description: 'Cutthroats and poachers of the south, loyal to whoever pays. Hire them when one of your units is nearby.',
});
building('merc_forest', {
  name: 'Troll Encampment', model: 'mercenary_camp', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0, sight: 0,
  mercenaries: ['wolf', 'forest_troll', 'troll_shaman', 'rock_golem'],
  description: 'Trolls and wolves of the western forests. Hire them when one of your units is nearby.',
});
building('fountain', {
  name: 'Fountain of Health', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0, sight: 0,
  fountain: 'health', description: 'Heals nearby units.',
});
building('fountain_mana', {
  name: 'Fountain of Mana', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0, sight: 0,
  fountain: 'mana', description: 'Restores mana to nearby units.',
});
building('tavern', {
  name: 'Tavern', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0, sight: 0, tavern: true,
  description: 'Recruit a Hero to lead your armies, or hire a Hero general for a while. One of your units must be nearby.',
});
building('marketplace', {
  name: 'Marketplace', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0, sight: 0, shop: 'market',
  description: 'Traders sell a changing stock of treasures (one of each) to Heroes within range.',
});
building('goblin_lab', {
  name: 'Goblin Laboratory', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0, sight: 0, shop: 'lab',
  description: 'Goblin gadgets for Heroes within range: blasting charges, speed potions and flares.',
});
building('waygate', {
  name: 'Waygate', hp: 99999, footprint: 3, invulnerable: true, neutral: true, armor: 0, sight: 0, walkable: true,
  description: 'Units sent onto a Waygate step out of its twin across the land.',
});
building('shrine', {
  name: 'Shrine of the Ancients', hp: 99999, footprint: 2, invulnerable: true, neutral: true, armor: 0, sight: 0, shrine: true,
  description: 'Bring a Hero to the shrine: your nearby units are blessed with +4 armor, +12 damage and swift regeneration for 90 seconds. It recharges in four minutes.',
});
building('cage', {
  name: 'Bandit Cage', hp: 99999, footprint: 2, invulnerable: true, neutral: true, armor: 0, sight: 0,
  description: 'Captives of the brigands. Defeat their guards and bring a unit here to set them free.',
});

export const UNITS = U;

export const ATTACK_TABLE: Record<AttackType, Record<ArmorType, number>> = {
  //          light medium heavy fortified hero unarmored
  normal: { light: 1.0, medium: 1.5, heavy: 1.0, fortified: 0.7, hero: 1.0, unarmored: 1.0 },
  pierce: { light: 2.0, medium: 0.75, heavy: 1.0, fortified: 0.35, hero: 0.5, unarmored: 1.5 },
  siege: { light: 1.0, medium: 0.5, heavy: 1.0, fortified: 1.5, hero: 0.5, unarmored: 1.5 },
  magic: { light: 1.25, medium: 0.75, heavy: 2.0, fortified: 0.35, hero: 0.5, unarmored: 1.0 },
  hero: { light: 1.0, medium: 1.0, heavy: 1.0, fortified: 0.5, hero: 1.0, unarmored: 1.0 },
  chaos: { light: 1.0, medium: 1.0, heavy: 1.0, fortified: 1.0, hero: 1.0, unarmored: 1.0 },
  spell: { light: 1.0, medium: 1.0, heavy: 1.0, fortified: 0.5, hero: 0.75, unarmored: 1.0 },
};

// Research Center upgrades. Every research has many levels; each age you reach unlocks two more
// levels of each (RESEARCH_PER_AGE), and every level costs a little more than the last.
export const UPGRADES: Record<string, UpgradeDef> = {
  weaponry: { name: 'Weaponry', icon: '🗡️', base: { gold: 90, lumber: 40 }, time: 30, effect: '+6% damage for your units and towers' },
  armor: { name: 'Armor Plating', icon: '🛡️', base: { gold: 90, lumber: 50 }, time: 30, effect: '+1 armor for your units' },
  vitality: { name: 'Vitality', icon: '❤️', base: { gold: 100, lumber: 40 }, time: 30, effect: '+6% health for your units' },
  mobility: { name: 'Mobility', icon: '👟', base: { gold: 80, lumber: 40 }, time: 30, effect: '+4% movement speed for your units' },
  forestry: { name: 'Forestry', icon: '🪓', base: { gold: 70, lumber: 20 }, time: 25, effect: '+2 lumber per trip and 10% faster chopping' },
  mining: { name: 'Mining', icon: '⛏️', base: { gold: 60, lumber: 40 }, time: 25, effect: '+2 gold per trip from gold mines' },
  housing: { name: 'Housing', icon: '🏠', base: { gold: 80, lumber: 60 }, time: 30, effect: '+1 citizen and +1 supply in every house' },
  agriculture: { name: 'Agriculture', icon: '🌾', base: { gold: 70, lumber: 40 }, time: 25, effect: '+10% food from every farm' },
  masonry: { name: 'Masonry', icon: '🧱', base: { gold: 80, lumber: 60 }, time: 30, effect: '+10% building health and 10% faster construction' },
  commerce: { name: 'Commerce', icon: '💰', base: { gold: 100, lumber: 30 }, time: 30, effect: '+5% income from taxes' },
  civics: { name: 'Civics', icon: '🎭', base: { gold: 90, lumber: 40 }, time: 30, effect: '+3 happiness' },
  medicine: { name: 'Medicine', icon: '⚕️', base: { gold: 80, lumber: 30 }, time: 25, effect: '+0.4 health regeneration for your units, and plague kills 15% fewer' },
};
export const RESEARCH_IDS = Object.keys(UPGRADES);
export const RESEARCH_PER_AGE = 2;
/** Highest research level a general may reach in their current age. */
export const researchCap = (p: { tier: number }): number => Math.max(1, p.tier) * RESEARCH_PER_AGE;
/** Cost of researching level `lvl + 1` (lvl = levels already researched). */
export function researchCost(id: string, lvl: number): Cost {
  const b = UPGRADES[id]!.base;
  const k = 1 + 0.6 * lvl;
  return { gold: Math.round((b.gold * k) / 5) * 5, lumber: Math.round((b.lumber * k) / 5) * 5 };
}
export const researchTime = (id: string, lvl: number): number => Math.round(UPGRADES[id]!.time * (1 + 0.12 * lvl));

/** Experience granted for killing a unit of a given level (Warcraft III-like table). */
export const XP_BY_LEVEL = [0, 25, 40, 60, 85, 115, 150, 190, 235, 285, 340, 400, 460, 520, 600, 700];
/** Total experience needed to reach each hero level (index = level). */
export const HERO_XP = [0, 0, 200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5400];
export const MAX_HERO_LEVEL = 10;
