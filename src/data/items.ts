// Items sold by shops or dropped by creeps. `stats` are passive bonuses while
// carried; `use` items are consumed (or have charges). Every item has a tier (1 common ... 6 a
// boss's own treasure): creep camps drop items of the tier their strength earns, and the
// Marketplace stocks tiers 1-4.
import type { ItemDef } from './types.ts';

export const ITEMS: Record<string, ItemDef> = {
  potion_healing: {
    name: 'Potion of Healing', icon: '🧪', color: '#c0392b', cost: 150, use: 'heal', amount: 300, charges: 1, tier: 1,
    description: 'Restores 300 hit points.',
  },
  potion_mana: {
    name: 'Potion of Mana', icon: '🧪', color: '#2c6fd6', cost: 120, use: 'mana', amount: 175, charges: 1, tier: 1,
    description: 'Restores 175 mana.',
  },
  scroll_tp: {
    name: 'Scroll of Town Portal', icon: '📜', color: '#8e6d3a', cost: 200, use: 'townPortal', charges: 1, tier: 2,
    description: 'Teleports your Hero and nearby units back to your base.',
  },
  boots: {
    name: 'Boots of Speed', icon: '👢', color: '#7b5a2e', cost: 250, stats: { speed: 0.6 }, tier: 2,
    description: 'Increases movement speed.',
  },
  claws6: {
    name: 'Claws of Attack +6', icon: '🐾', color: '#a33', cost: 300, stats: { damage: 6 }, tier: 2,
    description: 'Increases attack damage by 6.',
  },
  ring2: {
    name: 'Ring of Protection +2', icon: '💍', color: '#999', cost: 150, stats: { armor: 2 }, tier: 1,
    description: 'Increases armor by 2.',
  },
  gauntlets: {
    name: 'Gauntlets of Ogre Strength', icon: '🧤', color: '#b34', cost: 200, stats: { str: 3 }, tier: 2,
    description: 'Increases Strength by 3.',
  },
  slippers: {
    name: 'Slippers of Agility', icon: '🥿', color: '#3a6', cost: 200, stats: { agi: 3 }, tier: 2,
    description: 'Increases Agility by 3.',
  },
  mantle: {
    name: 'Mantle of Intelligence', icon: '🧣', color: '#36c', cost: 200, stats: { int: 3 }, tier: 2,
    description: 'Increases Intelligence by 3.',
  },
  periapt: {
    name: 'Periapt of Vitality', icon: '📿', color: '#c55', cost: 350, stats: { hp: 150 }, tier: 3,
    description: 'Increases maximum hit points by 150.',
  },
  ring_regen: {
    name: 'Ring of Regeneration', icon: '💚', color: '#2a2', cost: 250, stats: { hpRegen: 2 }, tier: 2,
    description: 'Regenerates 2 hit points per second.',
  },
  sobi_mask: {
    name: 'Sobi Mask', icon: '🎭', color: '#46a', cost: 250, stats: { manaRegen: 1 }, tier: 2,
    description: 'Increases mana regeneration by 1 per second.',
  },
  // ---------------------------------------------------------- Arcane Vault
  claws12: {
    name: 'Claws of Attack +12', icon: '🐉', color: '#d22', cost: 650, stats: { damage: 12 }, tier: 4,
    description: 'Increases attack damage by 12.',
  },
  ring5: {
    name: 'Ring of Protection +5', icon: '💎', color: '#aac', cost: 500, stats: { armor: 5 }, tier: 4,
    description: 'Increases armor by 5.',
  },
  belt: {
    name: 'Belt of Giant Strength +6', icon: '🥋', color: '#c44', cost: 500, stats: { str: 6 }, tier: 4,
    description: 'Increases Strength by 6.',
  },
  boots_agi: {
    name: 'Boots of Quel’Thalas +6', icon: '🥾', color: '#2a8', cost: 500, stats: { agi: 6 }, tier: 4,
    description: 'Increases Agility by 6.',
  },
  robe: {
    name: 'Robe of the Magi +6', icon: '👘', color: '#44c', cost: 500, stats: { int: 6 }, tier: 4,
    description: 'Increases Intelligence by 6.',
  },
  crown: {
    name: 'Crown of Kings +5', icon: '👑', color: '#db3', cost: 1000, stats: { str: 5, agi: 5, int: 5 }, tier: 5,
    description: 'Increases all attributes by 5.',
  },
  mask_death: {
    name: 'Mask of Death', icon: '💀', color: '#555', cost: 900, stats: { lifesteal: 0.15 }, tier: 5,
    description: 'Attacks steal 15% of damage dealt as life.',
  },
  greater_healing: {
    name: 'Potion of Greater Healing', icon: '❤️', color: '#e33', cost: 300, use: 'heal', amount: 700, charges: 1, tier: 3,
    description: 'Restores 700 hit points.',
  },
  helm_valor: {
    name: 'Helm of Valor', icon: '⛑️', color: '#a83', cost: 450, stats: { str: 4, agi: 4 }, tier: 4,
    description: 'Increases Strength and Agility by 4.',
  },
  staff_tp: {
    name: 'Staff of Teleportation', icon: '🪄', color: '#86c', cost: 300, use: 'townPortal', charges: 3, tier: 3,
    description: 'Teleports your Hero back to base. 3 charges.',
  },
  pendant: {
    name: 'Pendant of Energy', icon: '🔷', color: '#3a8ad8', cost: 550, stats: { int: 4, manaRegen: 1.5 }, tier: 4,
    description: 'Increases Intelligence by 4 and mana regeneration by 1.5 per second.',
  },
  // ---------------------------------------------------- Goblin Laboratory
  goblin_bomb: {
    name: 'Goblin Blasting Charge', icon: '💣', color: '#c86a1a', cost: 200, use: 'bomb', amount: 280, radius: 3.5, charges: 2, tier: 2,
    description: 'Blows up everything hostile within 3.5 paces of your Hero for 280 damage (full damage to buildings). 2 charges.',
  },
  potion_speed: {
    name: 'Potion of Speed', icon: '⚗️', color: '#2ab0a0', cost: 100, use: 'haste', amount: 1.6, duration: 15, radius: 6, charges: 1, tier: 1,
    description: 'Your Hero and nearby units move 60% faster for 15 seconds.',
  },
  goblin_flare: {
    name: 'Goblin Flare Gun', icon: '🎆', color: '#e8503a', cost: 75, use: 'reveal', radius: 26, duration: 20, charges: 2, tier: 1,
    description: 'Lights up the land within 26 paces of your Hero for 20 seconds. 2 charges.',
  },
  // ------------------------------------------------------------ Drops only
  tome_xp: {
    name: 'Tome of Experience', icon: '📘', color: '#36a', use: 'xp', amount: 200, charges: 1, dropOnly: true, tier: 2,
    autoUse: true, description: 'Grants 200 experience.',
  },
  tome_str: {
    name: 'Tome of Strength', icon: '📕', color: '#a33', use: 'str', amount: 1, charges: 1, dropOnly: true, tier: 3,
    autoUse: true, description: 'Permanently increases Strength by 1.',
  },
  tome_agi: {
    name: 'Tome of Agility', icon: '📗', color: '#3a3', use: 'agi', amount: 1, charges: 1, dropOnly: true, tier: 3,
    autoUse: true, description: 'Permanently increases Agility by 1.',
  },
  tome_int: {
    name: 'Tome of Intelligence', icon: '📒', color: '#33a', use: 'int', amount: 1, charges: 1, dropOnly: true, tier: 3,
    autoUse: true, description: 'Permanently increases Intelligence by 1.',
  },
  tome_knowledge: {
    name: 'Tome of Knowledge', icon: '📚', color: '#a8862a', use: 'allStats', amount: 1, charges: 1, dropOnly: true, tier: 4,
    autoUse: true, description: 'Permanently increases all attributes by 1.',
  },
  rune_healing: {
    name: 'Rune of Healing', icon: '✳️', color: '#3c3', use: 'areaHeal', amount: 250, charges: 1, dropOnly: true, tier: 1,
    autoUse: true, description: 'Heals nearby friendly units for 250 hit points.',
  },
  rune_mana: {
    name: 'Rune of Mana', icon: '🔹', color: '#4a7aff', use: 'areaMana', amount: 150, charges: 1, dropOnly: true, tier: 1,
    autoUse: true, description: 'Restores 150 mana to nearby friendly units.',
  },
  rune_speed: {
    name: 'Rune of Speed', icon: '💨', color: '#e8e070', use: 'haste', amount: 1.5, duration: 20, radius: 6, charges: 1, dropOnly: true,
    tier: 2, autoUse: true, description: 'Your Hero and nearby units move 50% faster for 20 seconds.',
  },
  rune_gold: {
    name: 'Bag of Gold', icon: '💰', color: '#db3', use: 'gold', amount: 150, charges: 1, dropOnly: true, tier: 1,
    autoUse: true, description: 'Gives 150 gold.',
  },
  chest_gold: {
    name: 'Treasure Chest', icon: '🧰', color: '#c8962a', use: 'gold', amount: 450, charges: 1, dropOnly: true, tier: 4,
    autoUse: true, description: 'A chest of looted gold: 450 gold.',
  },
  // Tier 5: the finest artifacts (bosses and the strongest camps).
  flamebrand: {
    name: 'Flamebrand', icon: '🗡️', color: '#e8501a', cost: 1200, stats: { damage: 18 }, dropOnly: true, tier: 5,
    description: 'A sword wreathed in fire: +18 damage.',
  },
  aegis: {
    name: 'Aegis of the Ancients', icon: '🛡️', color: '#c8b46a', cost: 1200, stats: { armor: 7, hp: 200 }, dropOnly: true, tier: 5,
    description: 'Increases armor by 7 and maximum hit points by 200.',
  },
  // Tier 6: each boss's own treasure.
  dragonscale: {
    name: 'Dragonscale Mail', icon: '🐲', color: '#b8261c', cost: 2000, stats: { armor: 8, hp: 300, hpRegen: 2 }, dropOnly: true, tier: 6,
    description: 'Scales of Vyrnax the Red: +8 armor, +300 hit points and +2 hit point regeneration.',
  },
  hydra_fang: {
    name: 'Hydra Fang', icon: '🦷', color: '#7ac83a', cost: 2000, stats: { damage: 20, hpRegen: 4 }, dropOnly: true, tier: 6,
    description: 'Still dripping with venom: +20 damage and +4 hit point regeneration.',
  },
  cutlass: {
    name: 'Varrok’s Cutlass', icon: '⚔️', color: '#d8c070', cost: 2000, stats: { damage: 16, agi: 6, speed: 0.4 }, dropOnly: true, tier: 6,
    description: 'The Bandit Lord’s blade: +16 damage, +6 Agility and faster movement.',
  },
  brood_cloak: {
    name: 'Broodsilk Cloak', icon: '🕸️', color: '#7a4a9a', cost: 2000, stats: { agi: 8, armor: 3, lifesteal: 0.1 }, dropOnly: true, tier: 6,
    description: 'Woven from the Broodmother’s silk: +8 Agility, +3 armor and attacks steal 10% of damage as life.',
  },
};

export const SHOP_STOCK: Record<string, string[]> = {
  merchant: [
    'potion_healing', 'potion_mana', 'scroll_tp', 'boots',
    'claws6', 'ring2', 'gauntlets', 'slippers',
    'mantle', 'periapt', 'ring_regen', 'sobi_mask',
  ],
  vault: [
    'greater_healing', 'staff_tp', 'claws12', 'ring5',
    'belt', 'boots_agi', 'robe', 'helm_valor',
    'crown', 'mask_death', 'pendant',
  ],
  lab: ['goblin_bomb', 'potion_speed', 'goblin_flare', 'potion_healing', 'scroll_tp'],
};

/** Each boss's own treasure (dropped the first time it falls). */
export const BOSS_TREASURE: Record<string, string> = {
  dragon: 'dragonscale',
  hydra: 'hydra_fang',
  bandit_lord: 'cutlass',
  broodmother: 'brood_cloak',
};

/** Items by tier that creep camps can drop (consumables and artifacts, not gadgets or boss treasure). */
export const DROP_TABLES: Record<number, string[]> = {};
for (const [id, it] of Object.entries(ITEMS)) {
  if (it.tier >= 6 || id === 'chest_gold' || ['goblin_bomb', 'potion_speed', 'goblin_flare'].includes(id)) continue;
  (DROP_TABLES[it.tier] ??= []).push(id);
}

/** Tier of item a camp drops, from the sum of its creeps' levels. */
export function dropTier(power: number): number {
  return power <= 5 ? 1 : power <= 9 ? 2 : power <= 14 ? 3 : power <= 22 ? 4 : 5;
}

/** A random drop of the given tier. */
export function randomDrop(tier: number): string {
  const t = DROP_TABLES[Math.max(1, Math.min(5, tier))]!;
  return t[Math.floor(Math.random() * t.length)]!;
}

/** Price at a shop: the item's cost, or a tier price for items that are otherwise only found. */
export function itemPrice(id: string): number {
  const it = ITEMS[id]!;
  return it.cost ?? [0, 100, 200, 350, 600, 1100, 2000][it.tier]!;
}
