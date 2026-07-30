import { BLOCKS } from './blocks.js';

// Simple click-to-craft recipe list (no crafting-grid layout) — matches the
// 2D game's original inventory/crafting/chests phase before it later grew
// a real 3x3 grid.
export const RECIPES = [
  { id: 'plank', inputs: [{ id: BLOCKS.WOOD, count: 1 }], output: { id: BLOCKS.PLANK, count: 4 } },
  { id: 'stick', inputs: [{ id: BLOCKS.PLANK, count: 2 }], output: { id: BLOCKS.STICK, count: 4 } },
  { id: 'torch', inputs: [{ id: BLOCKS.STICK, count: 1 }, { id: BLOCKS.ORE, count: 1 }], output: { id: BLOCKS.TORCH, count: 2 } },
  { id: 'chest', inputs: [{ id: BLOCKS.PLANK, count: 4 }], output: { id: BLOCKS.CHEST, count: 1 } },
  { id: 'stone_brick', inputs: [{ id: BLOCKS.STONE, count: 4 }], output: { id: BLOCKS.STONE_BRICK, count: 4 } },
  { id: 'wood_sword', inputs: [{ id: BLOCKS.PLANK, count: 3 }, { id: BLOCKS.STICK, count: 2 }], output: { id: BLOCKS.WOOD_SWORD, count: 1 } },
  { id: 'stone_sword', inputs: [{ id: BLOCKS.STONE, count: 3 }, { id: BLOCKS.STICK, count: 2 }], output: { id: BLOCKS.STONE_SWORD, count: 1 } },
  { id: 'gem_sword', inputs: [{ id: BLOCKS.GEMSTONE, count: 3 }, { id: BLOCKS.STICK, count: 2 }], output: { id: BLOCKS.GEM_SWORD, count: 1 } },
  { id: 'wood_armor', inputs: [{ id: BLOCKS.PLANK, count: 6 }], output: { id: BLOCKS.WOOD_ARMOR, count: 1 } },
  { id: 'stone_armor', inputs: [{ id: BLOCKS.STONE, count: 6 }], output: { id: BLOCKS.STONE_ARMOR, count: 1 } },
  { id: 'gem_armor', inputs: [{ id: BLOCKS.GEMSTONE, count: 6 }], output: { id: BLOCKS.GEM_ARMOR, count: 1 } },
  { id: 'bed', inputs: [{ id: BLOCKS.PLANK, count: 4 }, { id: BLOCKS.STICK, count: 2 }], output: { id: BLOCKS.BED, count: 1 } },
  { id: 'lever', inputs: [{ id: BLOCKS.STONE, count: 2 }, { id: BLOCKS.STICK, count: 1 }], output: { id: BLOCKS.LEVER, count: 1 } },
  { id: 'wire', inputs: [{ id: BLOCKS.ORE, count: 1 }], output: { id: BLOCKS.WIRE, count: 8 } },
  { id: 'lamp', inputs: [{ id: BLOCKS.ORE, count: 2 }, { id: BLOCKS.PLANK, count: 1 }], output: { id: BLOCKS.LAMP_OFF, count: 1 } },
  { id: 'reaper_sword', inputs: [{ id: BLOCKS.REAPER_SHARD, count: 5 }, { id: BLOCKS.STICK, count: 2 }], output: { id: BLOCKS.REAPER_SWORD, count: 1 } },
  { id: 'reaper_armor', inputs: [{ id: BLOCKS.REAPER_SHARD, count: 8 }], output: { id: BLOCKS.REAPER_ARMOR, count: 1 } },
  { id: 'summoning_horn', inputs: [{ id: BLOCKS.REAPER_SHARD, count: 10 }, { id: BLOCKS.GEMSTONE, count: 5 }], output: { id: BLOCKS.SUMMONING_HORN, count: 1 } },
];
