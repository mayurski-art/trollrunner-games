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
};

// Melee weapons: held item id -> { damage, cooldown (seconds) }. Anything
// not listed here (including bare hands) falls back to UNARMED.
export const UNARMED = { damage: 1, cooldown: 0.5 };
export const WEAPON_STATS = {
  [BLOCKS.WOOD_SWORD]: { damage: 2, cooldown: 0.4 },
  [BLOCKS.STONE_SWORD]: { damage: 4, cooldown: 0.35 },
};

// World blocks that give a drop when mined (bedrock/air excluded).
export const MINEABLE = [
  BLOCKS.GRASS, BLOCKS.DIRT, BLOCKS.STONE, BLOCKS.WOOD, BLOCKS.ORE,
  BLOCKS.SAND, BLOCKS.LEAVES, BLOCKS.PLANK, BLOCKS.TORCH, BLOCKS.CHEST,
  BLOCKS.STONE_BRICK, BLOCKS.SNOW, BLOCKS.CACTUS,
];

// Items the player can right-click place as a world block. STICK is
// craft-only and deliberately excluded.
export const PLACEABLE = [
  BLOCKS.DIRT, BLOCKS.STONE, BLOCKS.WOOD, BLOCKS.SAND, BLOCKS.ORE,
  BLOCKS.LEAVES, BLOCKS.PLANK, BLOCKS.TORCH, BLOCKS.CHEST, BLOCKS.STONE_BRICK,
  BLOCKS.SNOW, BLOCKS.CACTUS,
];

export const MAX_STACK = 64;

export function isSolid(id) {
  return id !== BLOCKS.AIR;
}
