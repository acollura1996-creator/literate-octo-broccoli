// Items sold by shops or dropped by creeps. `stats` are passive bonuses while
// carried; `use` items are consumed (or have charges).
import type { ItemDef } from './types.ts';

export const ITEMS: Record<string, ItemDef> = {
  potion_healing: {
    name: 'Potion of Healing', icon: '🧪', color: '#c0392b', cost: 150, use: 'heal', amount: 300, charges: 1,
    description: 'Restores 300 hit points.',
  },
  potion_mana: {
    name: 'Potion of Mana', icon: '🧪', color: '#2c6fd6', cost: 120, use: 'mana', amount: 175, charges: 1,
    description: 'Restores 175 mana.',
  },
  scroll_tp: {
    name: 'Scroll of Town Portal', icon: '📜', color: '#8e6d3a', cost: 200, use: 'townPortal', charges: 1,
    description: 'Teleports your Hero and nearby units back to your base.',
  },
  boots: {
    name: 'Boots of Speed', icon: '👢', color: '#7b5a2e', cost: 250, stats: { speed: 0.6 },
    description: 'Increases movement speed.',
  },
  claws6: {
    name: 'Claws of Attack +6', icon: '🐾', color: '#a33', cost: 300, stats: { damage: 6 },
    description: 'Increases attack damage by 6.',
  },
  ring2: {
    name: 'Ring of Protection +2', icon: '💍', color: '#999', cost: 150, stats: { armor: 2 },
    description: 'Increases armor by 2.',
  },
  gauntlets: {
    name: 'Gauntlets of Ogre Strength', icon: '🧤', color: '#b34', cost: 200, stats: { str: 3 },
    description: 'Increases Strength by 3.',
  },
  slippers: {
    name: 'Slippers of Agility', icon: '🥿', color: '#3a6', cost: 200, stats: { agi: 3 },
    description: 'Increases Agility by 3.',
  },
  mantle: {
    name: 'Mantle of Intelligence', icon: '🧣', color: '#36c', cost: 200, stats: { int: 3 },
    description: 'Increases Intelligence by 3.',
  },
  periapt: {
    name: 'Periapt of Vitality', icon: '📿', color: '#c55', cost: 350, stats: { hp: 150 },
    description: 'Increases maximum hit points by 150.',
  },
  ring_regen: {
    name: 'Ring of Regeneration', icon: '💚', color: '#2a2', cost: 250, stats: { hpRegen: 2 },
    description: 'Regenerates 2 hit points per second.',
  },
  sobi_mask: {
    name: 'Sobi Mask', icon: '🎭', color: '#46a', cost: 250, stats: { manaRegen: 1 },
    description: 'Increases mana regeneration by 1 per second.',
  },
  // ---------------------------------------------------------- Arcane Vault
  claws12: {
    name: 'Claws of Attack +12', icon: '🐉', color: '#d22', cost: 650, stats: { damage: 12 },
    description: 'Increases attack damage by 12.',
  },
  ring5: {
    name: 'Ring of Protection +5', icon: '💎', color: '#aac', cost: 500, stats: { armor: 5 },
    description: 'Increases armor by 5.',
  },
  belt: {
    name: 'Belt of Giant Strength +6', icon: '🥋', color: '#c44', cost: 500, stats: { str: 6 },
    description: 'Increases Strength by 6.',
  },
  boots_agi: {
    name: 'Boots of Quel’Thalas +6', icon: '🥾', color: '#2a8', cost: 500, stats: { agi: 6 },
    description: 'Increases Agility by 6.',
  },
  robe: {
    name: 'Robe of the Magi +6', icon: '👘', color: '#44c', cost: 500, stats: { int: 6 },
    description: 'Increases Intelligence by 6.',
  },
  crown: {
    name: 'Crown of Kings +5', icon: '👑', color: '#db3', cost: 1000, stats: { str: 5, agi: 5, int: 5 },
    description: 'Increases all attributes by 5.',
  },
  mask_death: {
    name: 'Mask of Death', icon: '💀', color: '#555', cost: 900, stats: { lifesteal: 0.15 },
    description: 'Attacks steal 15% of damage dealt as life.',
  },
  greater_healing: {
    name: 'Potion of Greater Healing', icon: '❤️', color: '#e33', cost: 300, use: 'heal', amount: 700, charges: 1,
    description: 'Restores 700 hit points.',
  },
  helm_valor: {
    name: 'Helm of Valor', icon: '⛑️', color: '#a83', cost: 450, stats: { str: 4, agi: 4 },
    description: 'Increases Strength and Agility by 4.',
  },
  staff_tp: {
    name: 'Staff of Teleportation', icon: '🪄', color: '#86c', cost: 300, use: 'townPortal', charges: 3,
    description: 'Teleports your Hero back to base. 3 charges.',
  },
  // ------------------------------------------------------------ Drops only
  tome_xp: {
    name: 'Tome of Experience', icon: '📘', color: '#36a', use: 'xp', amount: 200, charges: 1, dropOnly: true,
    autoUse: true, description: 'Grants 200 experience.',
  },
  tome_str: {
    name: 'Tome of Strength', icon: '📕', color: '#a33', use: 'str', amount: 1, charges: 1, dropOnly: true,
    autoUse: true, description: 'Permanently increases Strength by 1.',
  },
  tome_agi: {
    name: 'Tome of Agility', icon: '📗', color: '#3a3', use: 'agi', amount: 1, charges: 1, dropOnly: true,
    autoUse: true, description: 'Permanently increases Agility by 1.',
  },
  tome_int: {
    name: 'Tome of Intelligence', icon: '📒', color: '#33a', use: 'int', amount: 1, charges: 1, dropOnly: true,
    autoUse: true, description: 'Permanently increases Intelligence by 1.',
  },
  rune_healing: {
    name: 'Rune of Healing', icon: '✳️', color: '#3c3', use: 'areaHeal', amount: 250, charges: 1, dropOnly: true,
    autoUse: true, description: 'Heals nearby friendly units for 250 hit points.',
  },
  rune_gold: {
    name: 'Bag of Gold', icon: '💰', color: '#db3', use: 'gold', amount: 150, charges: 1, dropOnly: true,
    autoUse: true, description: 'Gives 150 gold.',
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
    'crown', 'mask_death',
  ],
};

/** Item drop tables by creep camp tier. */
export const DROP_TABLES: Record<number, string[]> = {
  1: ['potion_healing', 'potion_mana', 'rune_gold', 'tome_xp'],
  2: ['potion_healing', 'tome_xp', 'rune_healing', 'ring2', 'rune_gold', 'potion_mana'],
  3: ['tome_str', 'tome_agi', 'tome_int', 'tome_xp', 'periapt', 'claws6', 'greater_healing'],
  4: ['tome_str', 'tome_agi', 'tome_int', 'helm_valor', 'claws12', 'ring5', 'mask_death', 'crown'],
};
