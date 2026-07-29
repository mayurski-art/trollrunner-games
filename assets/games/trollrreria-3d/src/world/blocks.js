// Block registry. id 0 is always air/empty.
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
};

// Blocks the player can mine and carry. Bedrock and air are excluded.
export const MINEABLE = [BLOCKS.GRASS, BLOCKS.DIRT, BLOCKS.STONE, BLOCKS.WOOD, BLOCKS.ORE, BLOCKS.SAND, BLOCKS.LEAVES];

// Hotbar order for the placeable inventory UI.
export const HOTBAR_ORDER = [BLOCKS.DIRT, BLOCKS.STONE, BLOCKS.WOOD, BLOCKS.SAND, BLOCKS.ORE];

export const BLOCK_NAME = {
  [BLOCKS.GRASS]: 'Grass',
  [BLOCKS.DIRT]: 'Dirt',
  [BLOCKS.STONE]: 'Stone',
  [BLOCKS.WOOD]: 'Wood',
  [BLOCKS.ORE]: 'Ore',
  [BLOCKS.SAND]: 'Sand',
  [BLOCKS.LEAVES]: 'Leaves',
};

export function isSolid(id) {
  return id !== BLOCKS.AIR;
}
