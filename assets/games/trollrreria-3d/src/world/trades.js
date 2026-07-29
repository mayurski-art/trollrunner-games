import { BLOCKS } from './blocks.js';

// The merchant's fixed barter list — converts common surplus materials
// into rarer tiers at a "tax", so exploring/mining still pays off even
// once your inventory is full of dirt/stone. No currency system yet.
export const TRADES = [
  { id: 'dirt_for_stone', inputs: [{ id: BLOCKS.DIRT, count: 30 }], output: { id: BLOCKS.STONE, count: 5 } },
  { id: 'stone_for_ore', inputs: [{ id: BLOCKS.STONE, count: 15 }], output: { id: BLOCKS.ORE, count: 3 } },
  { id: 'ore_for_gem', inputs: [{ id: BLOCKS.ORE, count: 8 }], output: { id: BLOCKS.GEMSTONE, count: 1 } },
  { id: 'wood_for_plank', inputs: [{ id: BLOCKS.WOOD, count: 5 }], output: { id: BLOCKS.PLANK, count: 12 } },
];
