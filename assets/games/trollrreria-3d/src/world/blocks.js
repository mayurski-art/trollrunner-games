// Block/item registry. id 0 is always air/empty. Ids 1-8 are natural
// terrain blocks; 9+ are craftable items (some placeable, some not).
export const BLOCKS = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  WOOD: 4,
  ORE: 5,
  SAND: 6,
  LEAVES: 7,
  BEDROCK: 8,
  PLANK: 9,
  STICK: 10,
  TORCH: 11,
  CHEST: 12,
  STONE_BRICK: 13,
  WOOD_SWORD: 14,
  STONE_SWORD: 15,
  SNOW: 16,
  CACTUS: 17,
  GEMSTONE: 18,
  GEM_SWORD: 19,
  WOOD_ARMOR: 20,
  STONE_ARMOR: 21,
  GEM_ARMOR: 22,
  BED: 23,
  LEVER: 24,
  WIRE: 25,
  LAMP_OFF: 26,
  LAMP_ON: 27,
  REAPER_SHARD: 28,
  REAPER_SWORD: 29,
  REAPER_ARMOR: 30,
};

// Per-face color so a merged mesh can use vertex colors instead of textures.
export const BLOCK_COLOR = {
  [BLOCKS.GRASS]: 0x5fb349,
  [BLOCKS.DIRT]: 0x8a5a3c,
  [BLOCKS.STONE]: 0x8a8a92,
  [BLOCKS.WOOD]: 0x6b4423,
  [BLOCKS.ORE]: 0xffb300,
  [BLOCKS.SAND]: 0xe3cf8a,
  [BLOCKS.LEAVES]: 0x3f8f3f,
  [BLOCKS.BEDROCK]: 0x2a2a30,
  [BLOCKS.PLANK]: 0xc79a5f,
  [BLOCKS.STICK]: 0x8a6a42,
  [BLOCKS.TORCH]: 0xffd166,
  [BLOCKS.CHEST]: 0x9a6a2f,
  [BLOCKS.STONE_BRICK]: 0x6f6f78,
  [BLOCKS.WOOD_SWORD]: 0xd8a05c,
  [BLOCKS.STONE_SWORD]: 0xb9b9c2,
  [BLOCKS.SNOW]: 0xf2f7fb,
  [BLOCKS.CACTUS]: 0x4d8a4a,
  [BLOCKS.GEMSTONE]: 0xd946ef,
  [BLOCKS.GEM_SWORD]: 0xe879f9,
  [BLOCKS.WOOD_ARMOR]: 0x9a6a3c,
  [BLOCKS.STONE_ARMOR]: 0x7a7a84,
  [BLOCKS.GEM_ARMOR]: 0xc026d3,
  [BLOCKS.BED]: 0xef4444,
  [BLOCKS.LEVER]: 0x57534e,
  [BLOCKS.WIRE]: 0xb91c1c,
  [BLOCKS.LAMP_OFF]: 0x4b4b52,
  [BLOCKS.LAMP_ON]: 0xffe066,
  [BLOCKS.REAPER_SHARD]: 0x1f2937,
  [BLOCKS.REAPER_SWORD]: 0x374151,
  [BLOCKS.REAPER_ARMOR]: 0x0f172a,
};

export const BLOCK_NAME = {
  [BLOCKS.GRASS]: 'Grass',
  [BLOCKS.DIRT]: 'Dirt',
  [BLOCKS.STONE]: 'Stone',
  [BLOCKS.WOOD]: 'Wood',
  [BLOCKS.ORE]: 'Ore',
  [BLOCKS.SAND]: 'Sand',
  [BLOCKS.LEAVES]: 'Leaves',
  [BLOCKS.PLANK]: 'Plank',
  [BLOCKS.STICK]: 'Stick',
  [BLOCKS.TORCH]: 'Torch',
  [BLOCKS.CHEST]: 'Chest',
  [BLOCKS.STONE_BRICK]: 'Stone Brick',
  [BLOCKS.WOOD_SWORD]: 'Wood Sword',
  [BLOCKS.STONE_SWORD]: 'Stone Sword',
  [BLOCKS.SNOW]: 'Snow',
  [BLOCKS.CACTUS]: 'Cactus',
  [BLOCKS.GEMSTONE]: 'Gemstone',
  [BLOCKS.GEM_SWORD]: 'Gem Sword',
  [BLOCKS.WOOD_ARMOR]: 'Wood Armor',
  [BLOCKS.STONE_ARMOR]: 'Stone Armor',
  [BLOCKS.GEM_ARMOR]: 'Gem Armor',
  [BLOCKS.BED]: 'Bed',
  [BLOCKS.LEVER]: 'Lever',
  [BLOCKS.WIRE]: 'Wire',
  [BLOCKS.LAMP_OFF]: 'Lamp',
  [BLOCKS.LAMP_ON]: 'Lamp',
  [BLOCKS.REAPER_SHARD]: 'Reaper Shard',
  [BLOCKS.REAPER_SWORD]: 'Reaper Sword',
  [BLOCKS.REAPER_ARMOR]: 'Reaper Armor',
};

// Melee weapons: held item id -> { damage, cooldown (seconds) }. Anything
// not listed here (including bare hands) falls back to UNARMED.
export const UNARMED = { damage: 1, cooldown: 0.5 };
export const WEAPON_STATS = {
  [BLOCKS.WOOD_SWORD]: { damage: 2, cooldown: 0.4 },
  [BLOCKS.STONE_SWORD]: { damage: 4, cooldown: 0.35 },
  [BLOCKS.GEM_SWORD]: { damage: 7, cooldown: 0.3 },
  [BLOCKS.REAPER_SWORD]: { damage: 10, cooldown: 0.28 },
};

// Armor: a single equipped item id -> fraction of incoming damage blocked.
export const ARMOR_STATS = {
  [BLOCKS.WOOD_ARMOR]: { reduction: 0.15 },
  [BLOCKS.STONE_ARMOR]: { reduction: 0.3 },
  [BLOCKS.GEM_ARMOR]: { reduction: 0.5 },
  [BLOCKS.REAPER_ARMOR]: { reduction: 0.65 },
};

// World blocks that give a drop when mined (bedrock/air excluded).
export const MINEABLE = [
  BLOCKS.GRASS, BLOCKS.DIRT, BLOCKS.STONE, BLOCKS.WOOD, BLOCKS.ORE,
  BLOCKS.SAND, BLOCKS.LEAVES, BLOCKS.PLANK, BLOCKS.TORCH, BLOCKS.CHEST,
  BLOCKS.STONE_BRICK, BLOCKS.SNOW, BLOCKS.CACTUS, BLOCKS.GEMSTONE, BLOCKS.BED,
  BLOCKS.LEVER, BLOCKS.WIRE, BLOCKS.LAMP_OFF, BLOCKS.LAMP_ON,
];

// Items the player can right-click place as a world block. STICK is
// craft-only and deliberately excluded. LAMP_ON is a runtime-only state
// (see World.recomputePower), never placed directly.
export const PLACEABLE = [
  BLOCKS.DIRT, BLOCKS.STONE, BLOCKS.WOOD, BLOCKS.SAND, BLOCKS.ORE,
  BLOCKS.LEAVES, BLOCKS.PLANK, BLOCKS.TORCH, BLOCKS.CHEST, BLOCKS.STONE_BRICK,
  BLOCKS.SNOW, BLOCKS.CACTUS, BLOCKS.BED, BLOCKS.LEVER, BLOCKS.WIRE, BLOCKS.LAMP_OFF,
];

// Mining these gives back a different item than the block itself (grass ->
// dirt; a lit lamp always drops its unlit form).
export const DROP_OVERRIDE = {
  [BLOCKS.GRASS]: BLOCKS.DIRT,
  [BLOCKS.LAMP_ON]: BLOCKS.LAMP_OFF,
};

export const MAX_STACK = 64;

export function isSolid(id) {
  return id !== BLOCKS.AIR;
}
