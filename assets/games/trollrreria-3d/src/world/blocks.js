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
  SUMMONING_HORN: 31,
  TROLL_CROWN: 32,
  WHEAT_SEED: 33,
  WHEAT_CROP: 34,
  WHEAT_CROP_MATURE: 35,
  WHEAT: 36,
  BREAD: 37,
  TROLL_MEAT: 38,
  COOKED_MEAT: 39,
  DARK_TOTEM: 40,
  ARCANE_DUST: 41,
  ENCHANTED_SWORD: 42,
  ENCHANTED_ARMOR: 43,
  WOOD_PICKAXE: 44,
  STONE_PICKAXE: 45,
  GEM_PICKAXE: 46,
  WOOD_AXE: 47,
  STONE_AXE: 48,
  GEM_AXE: 49,
  PATH: 50,
  LAVA: 51,
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
  [BLOCKS.SUMMONING_HORN]: 0xea580c,
  [BLOCKS.TROLL_CROWN]: 0xfacc15,
  [BLOCKS.WHEAT_SEED]: 0xa3b18a,
  [BLOCKS.WHEAT_CROP]: 0x84a35c,
  [BLOCKS.WHEAT_CROP_MATURE]: 0xe3c46a,
  [BLOCKS.WHEAT]: 0xe9d18b,
  [BLOCKS.BREAD]: 0xc99a53,
  [BLOCKS.TROLL_MEAT]: 0xc0645a,
  [BLOCKS.COOKED_MEAT]: 0x8a4a2f,
  [BLOCKS.DARK_TOTEM]: 0x4c1d95,
  [BLOCKS.ARCANE_DUST]: 0x60a5fa,
  [BLOCKS.ENCHANTED_SWORD]: 0x38bdf8,
  [BLOCKS.ENCHANTED_ARMOR]: 0x0ea5e9,
  [BLOCKS.WOOD_PICKAXE]: 0xc79a5f,
  [BLOCKS.STONE_PICKAXE]: 0x9a9aa2,
  [BLOCKS.GEM_PICKAXE]: 0xe879f9,
  [BLOCKS.WOOD_AXE]: 0xb5854a,
  [BLOCKS.STONE_AXE]: 0x86868f,
  [BLOCKS.GEM_AXE]: 0xd946ef,
  [BLOCKS.PATH]: 0xb8a06a,
  [BLOCKS.LAVA]: 0xff5a1f,
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
  [BLOCKS.SUMMONING_HORN]: 'Summoning Horn',
  [BLOCKS.TROLL_CROWN]: 'Troll Crown',
  [BLOCKS.WHEAT_SEED]: 'Wheat Seed',
  [BLOCKS.WHEAT_CROP]: 'Wheat (growing)',
  [BLOCKS.WHEAT_CROP_MATURE]: 'Wheat (ripe)',
  [BLOCKS.WHEAT]: 'Wheat',
  [BLOCKS.BREAD]: 'Bread',
  [BLOCKS.TROLL_MEAT]: 'Troll Meat',
  [BLOCKS.COOKED_MEAT]: 'Cooked Troll Meat',
  [BLOCKS.DARK_TOTEM]: 'Dark Totem',
  [BLOCKS.ARCANE_DUST]: 'Arcane Dust',
  [BLOCKS.ENCHANTED_SWORD]: 'Enchanted Sword',
  [BLOCKS.ENCHANTED_ARMOR]: 'Enchanted Armor',
  [BLOCKS.WOOD_PICKAXE]: 'Wood Pickaxe',
  [BLOCKS.STONE_PICKAXE]: 'Stone Pickaxe',
  [BLOCKS.GEM_PICKAXE]: 'Gem Pickaxe',
  [BLOCKS.WOOD_AXE]: 'Wood Axe',
  [BLOCKS.STONE_AXE]: 'Stone Axe',
  [BLOCKS.GEM_AXE]: 'Gem Axe',
  [BLOCKS.PATH]: 'Path',
  [BLOCKS.LAVA]: 'Lava',
};

// Icon art for the UI (hotbar/inventory/crafting/trade/quest swatches) —
// item id -> filename under art/icons/. Anything not listed here falls back
// to a flat color swatch (BLOCK_COLOR) — most raw terrain blocks never got
// dedicated icon art, only equipment/key items did.
export const ICON_MAP = {
  [BLOCKS.WOOD_SWORD]: 'wood-sword.png',
  [BLOCKS.STONE_SWORD]: 'stone-sword.png',
  [BLOCKS.GEM_SWORD]: 'gem-sword.png',
  [BLOCKS.REAPER_SWORD]: 'reaper-sword.png',
  [BLOCKS.WOOD_ARMOR]: 'wood-armor.png',
  [BLOCKS.STONE_ARMOR]: 'stone-armor.png',
  [BLOCKS.GEM_ARMOR]: 'gem-armor.png',
  [BLOCKS.REAPER_ARMOR]: 'reaper-armor.png',
  [BLOCKS.GEMSTONE]: 'gemstone.png',
  [BLOCKS.REAPER_SHARD]: 'reaper-shard.png',
  [BLOCKS.TROLL_CROWN]: 'troll-crown.png',
  [BLOCKS.BREAD]: 'bread.png',
  [BLOCKS.COOKED_MEAT]: 'cooked-meat.png',
  [BLOCKS.SUMMONING_HORN]: 'summoning-horn.png',
  [BLOCKS.DARK_TOTEM]: 'dark-totem.png',
  [BLOCKS.ARCANE_DUST]: 'arcane-dust.png',
  [BLOCKS.ENCHANTED_SWORD]: 'enchanted-sword.png',
  [BLOCKS.ENCHANTED_ARMOR]: 'enchanted-armor.png',
  [BLOCKS.WOOD_PICKAXE]: 'wood-pickaxe.png',
  [BLOCKS.STONE_PICKAXE]: 'stone-pickaxe.png',
  [BLOCKS.GEM_PICKAXE]: 'gem-pickaxe.png',
  [BLOCKS.WOOD_AXE]: 'wood-axe.png',
  [BLOCKS.STONE_AXE]: 'stone-axe.png',
  [BLOCKS.GEM_AXE]: 'gem-axe.png',
};

// Consumable food: held item id -> { hunger, heal? }. Eaten via right-click
// when nothing else is interactable, same "use item" flow as the horn.
export const FOOD_STATS = {
  [BLOCKS.WHEAT]: { hunger: 8 },
  [BLOCKS.BREAD]: { hunger: 25 },
  [BLOCKS.TROLL_MEAT]: { hunger: 10 },
  [BLOCKS.COOKED_MEAT]: { hunger: 30, heal: 5 },
};

// Consumable items that summon a world boss when used (right-click with no
// other interaction target) — see Game.handlePlace.
export const SUMMON_ITEMS = {
  [BLOCKS.SUMMONING_HORN]: 'TROLL_KING',
  [BLOCKS.DARK_TOTEM]: 'ARCHTROLL',
};

// Melee weapons: held item id -> { damage, cooldown (seconds) }. Anything
// not listed here (including bare hands) falls back to UNARMED.
export const UNARMED = { damage: 1, cooldown: 0.5 };
export const WEAPON_STATS = {
  [BLOCKS.WOOD_SWORD]: { damage: 2, cooldown: 0.4 },
  [BLOCKS.STONE_SWORD]: { damage: 4, cooldown: 0.35 },
  [BLOCKS.GEM_SWORD]: { damage: 7, cooldown: 0.3 },
  [BLOCKS.REAPER_SWORD]: { damage: 10, cooldown: 0.28 },
  [BLOCKS.ENCHANTED_SWORD]: { damage: 14, cooldown: 0.22 },
};

// Armor: a single equipped item id -> fraction of incoming damage blocked.
export const ARMOR_STATS = {
  [BLOCKS.WOOD_ARMOR]: { reduction: 0.15 },
  [BLOCKS.STONE_ARMOR]: { reduction: 0.3 },
  [BLOCKS.GEM_ARMOR]: { reduction: 0.5 },
  [BLOCKS.REAPER_ARMOR]: { reduction: 0.65 },
  [BLOCKS.ENCHANTED_ARMOR]: { reduction: 0.78 },
};

// Tools: held item id -> { kind: 'pickaxe'|'axe', tier: 1/2/3 }. Tier gates
// which MINE_TIER blocks below can be broken at all (Minecraft's
// wood<stone<gem progression) rather than just changing speed, since mining
// here is already an instant single hit. Axes don't gate anything — they
// just give a bonus wood drop (see Game.handleDig).
export const TOOL_STATS = {
  [BLOCKS.WOOD_PICKAXE]: { kind: 'pickaxe', tier: 1 },
  [BLOCKS.STONE_PICKAXE]: { kind: 'pickaxe', tier: 2 },
  [BLOCKS.GEM_PICKAXE]: { kind: 'pickaxe', tier: 3 },
  [BLOCKS.WOOD_AXE]: { kind: 'axe', tier: 1 },
  [BLOCKS.STONE_AXE]: { kind: 'axe', tier: 2 },
  [BLOCKS.GEM_AXE]: { kind: 'axe', tier: 3 },
};

// Blocks that require a pickaxe of at least this tier to break — mining
// without one (or with too low a tier) does nothing, same as Minecraft's
// tool-tier gate. Anything not listed here can always be mined bare-handed
// (dirt, wood, sand, plants, ...). Gemstone is deliberately NOT gated here:
// it's the material the tier-3 (gem) pickaxe itself is crafted from, so
// gating it behind that same pickaxe would be a softlock — a stone
// pickaxe (tier 2) is enough to reach it, same as ore.
export const MINE_TIER = {
  [BLOCKS.STONE]: 1,
  [BLOCKS.STONE_BRICK]: 1,
  [BLOCKS.ORE]: 2,
};

// Base seconds to break a block bare-handed — mining is now Minecraft-style
// hold-to-break-with-progress (see Game._tickMining) instead of an instant
// single click. Anything not listed falls back to DEFAULT_HARDNESS.
export const MINE_HARDNESS = {
  [BLOCKS.GRASS]: 0.4, [BLOCKS.DIRT]: 0.4, [BLOCKS.SAND]: 0.4, [BLOCKS.SNOW]: 0.4,
  [BLOCKS.LEAVES]: 0.3, [BLOCKS.WOOD]: 0.8, [BLOCKS.PLANK]: 0.6,
  [BLOCKS.STONE]: 1.2, [BLOCKS.STONE_BRICK]: 1.2,
  [BLOCKS.ORE]: 2.0, [BLOCKS.GEMSTONE]: 2.5,
  [BLOCKS.CACTUS]: 0.5, [BLOCKS.PATH]: 0.4,
  [BLOCKS.TORCH]: 0.15, [BLOCKS.CHEST]: 0.6, [BLOCKS.BED]: 0.6,
  [BLOCKS.LEVER]: 0.3, [BLOCKS.WIRE]: 0.2, [BLOCKS.LAMP_OFF]: 0.4, [BLOCKS.LAMP_ON]: 0.4,
  [BLOCKS.TROLL_CROWN]: 0.3,
  [BLOCKS.WHEAT_CROP]: 0.2, [BLOCKS.WHEAT_CROP_MATURE]: 0.2,
};
const DEFAULT_HARDNESS = 0.5;

// Tier multiplier applied when the held tool's kind matches the block's
// material family (pickaxe -> stone family, axe -> wood family) — same
// wood<stone<gem progression MINE_TIER already gates existence on, just
// applied to speed too now instead of only an all-or-nothing gate.
const TOOL_SPEED_MULT = { 1: 2, 2: 3.2, 3: 4.5 };
const STONE_FAMILY = new Set([BLOCKS.STONE, BLOCKS.STONE_BRICK, BLOCKS.ORE, BLOCKS.GEMSTONE]);
const WOOD_FAMILY = new Set([BLOCKS.WOOD, BLOCKS.LEAVES, BLOCKS.PLANK]);

// Seconds to break `id` with `heldItemId` currently selected (undefined/
// unrecognized = bare hands, multiplier 1).
export function mineSeconds(id, heldItemId) {
  const hardness = MINE_HARDNESS[id] ?? DEFAULT_HARDNESS;
  const tool = TOOL_STATS[heldItemId];
  if (!tool) return hardness;
  const matches = (tool.kind === 'pickaxe' && STONE_FAMILY.has(id)) || (tool.kind === 'axe' && WOOD_FAMILY.has(id));
  return matches ? hardness / (TOOL_SPEED_MULT[tool.tier] || 1) : hardness;
}

// World blocks that give a drop when mined (bedrock/air excluded).
export const MINEABLE = [
  BLOCKS.GRASS, BLOCKS.DIRT, BLOCKS.STONE, BLOCKS.WOOD, BLOCKS.ORE,
  BLOCKS.SAND, BLOCKS.LEAVES, BLOCKS.PLANK, BLOCKS.TORCH, BLOCKS.CHEST,
  BLOCKS.STONE_BRICK, BLOCKS.SNOW, BLOCKS.CACTUS, BLOCKS.GEMSTONE, BLOCKS.BED,
  BLOCKS.LEVER, BLOCKS.WIRE, BLOCKS.LAMP_OFF, BLOCKS.LAMP_ON, BLOCKS.TROLL_CROWN,
  BLOCKS.WHEAT_CROP, BLOCKS.WHEAT_CROP_MATURE, BLOCKS.PATH,
];

// Items the player can right-click place as a world block. STICK is
// craft-only and deliberately excluded. LAMP_ON is a runtime-only state
// (see World.recomputePower), never placed directly.
export const PLACEABLE = [
  BLOCKS.DIRT, BLOCKS.STONE, BLOCKS.WOOD, BLOCKS.SAND, BLOCKS.ORE,
  BLOCKS.LEAVES, BLOCKS.PLANK, BLOCKS.TORCH, BLOCKS.CHEST, BLOCKS.STONE_BRICK,
  BLOCKS.SNOW, BLOCKS.CACTUS, BLOCKS.BED, BLOCKS.LEVER, BLOCKS.WIRE, BLOCKS.LAMP_OFF,
  BLOCKS.TROLL_CROWN, BLOCKS.PATH,
];

// Mining these gives back a different item than the block itself (grass ->
// dirt; a lit lamp always drops its unlit form).
export const DROP_OVERRIDE = {
  [BLOCKS.GRASS]: BLOCKS.DIRT,
  [BLOCKS.LAMP_ON]: BLOCKS.LAMP_OFF,
  [BLOCKS.WHEAT_CROP]: BLOCKS.WHEAT_SEED, // harvested early -> just get the seed back
  [BLOCKS.WHEAT_CROP_MATURE]: BLOCKS.WHEAT,
};

export const MAX_STACK = 64;

export function isSolid(id) {
  return id !== BLOCKS.AIR;
}
