/* Trollrreria — game data: constants, tiles, walls, items, recipes, enemies.
   Everything here is plain data; systems live in the other modules. */

/* ---------------------------------------------------------------- constants */
export const TILE = 16;               // world px per tile
export const ZOOM = 2;                // screen px per world px
/* New worlds are half again wider than the original 1600 -- more biomes
   need more room, and "there's always more map" is most of the Terraria
   feel. Old 1600-wide saves keep their own dims: the save records w/h
   and world construction honors them (see Game.applySave), so nothing
   is ever decoded into a grid of the wrong size. Height stays fixed --
   depth tiers (STONE_START/DEEP_START/BEDROCK) are tuned around it. */
export const WORLD_W = 2400;          // tiles
export const WORLD_H = 800;
export const CHUNK = 32;              // tiles per chunk side
export const DAY_LEN = 600;           // seconds of daylight
export const NIGHT_LEN = 360;         // seconds of night
export const CYCLE = DAY_LEN + NIGHT_LEN;

export const GRAVITY = 1700;          // px/s^2
export const MAX_FALL = 620;          // terminal velocity px/s
export const PLAYER_W = 22;           // hitbox world px
export const PLAYER_H = 44;
export const REACH = 6.5;             // tiles

export const SAVE_KEY = "trollrreria:world1";
export const SETTINGS_KEY = "trollrreria:settings";

/* ------------------------------------------------------------------- tiles */
export const T = {
  AIR: 0, DIRT: 1, STONE: 2, SAND: 3, SNOW: 4, ICE: 5, WOOD: 6,
  STONE_BRICK: 7, GLASS: 8, TREE: 9, COPPER: 10, IRON: 11, SILVER: 12,
  GOLD: 13, TORCH: 14, WORKBENCH: 15, FURNACE: 16, ANVIL: 17, CHEST: 18,
  DOOR_C: 19, DOOR_O: 20, PLATFORM: 21, HEART: 22, SHROOM: 23,
  BEDROCK: 24, OBSIDIAN: 25, PLANT: 26, BED: 27,
  LEVER: 28, PLATE: 29, DART_L: 30, DART_R: 31, TORCH_OFF: 32,
  TROLLIUM: 33, GRIN_FRAG: 34, MUD: 35, PEPE_SCROLL: 36,
  MOONROCK: 37, MOON_DEBRIS: 38, ROCKET_PART: 39, ROCKET_PAD: 40,
  VAULT_DOOR: 41, GRIN_ALTAR: 42,
  CAMPFIRE: 43, FARMLAND: 44, CROP1: 45, CROP2: 46, CROP3: 47, SIGN: 48,
  ROPE: 49, ENCHANT_TABLE: 50,
  /* building-set variants (append-only past this point -- save data is
     keyed on these numeric ids, never renumber the above) */
  PLANKS: 51, CLAY: 52, CLAY_BRICK: 53, POLISHED_STONE: 54, CHISELED_BRICK: 55,
  GLASS_RED: 56, GLASS_GREEN: 57, GLASS_BLUE: 58,
  WOOD_RED: 59, WOOD_GREEN: 60, WOOD_BLUE: 61,
  FENCE: 62, METEORITE: 63,
  REPEATER_L: 64, REPEATER_R: 65, TIMER_TORCH: 66, TIMER_TORCH_OFF: 67,
  TRAPDOOR_C: 68, TRAPDOOR_O: 69,
  PYLON: 70,
  COOKING_POT: 71,
  RAIL: 72,
  /* wires live on their own layer, not in T */
};

/* pal: [dark, mid, light] used by the procedural texture atlas.
   hp: mining damage to break. pow: minimum tool power. tool: pick|axe|hammer.
   solid: blocks movement + light. drop: item id granted on break.        */
export const TILES = [];
TILES[T.AIR]      = { name: "Air", solid: false };
TILES[T.DIRT]     = { name: "Dirt", solid: true, hp: 50, pow: 0, tool: "pick", drop: "dirt", pal: ["#5d4326", "#7a5a33", "#8f6c40"] };
TILES[T.STONE]    = { name: "Stone", solid: true, hp: 100, pow: 0, tool: "pick", drop: "stone", pal: ["#565a63", "#6e737d", "#848a94"] };
TILES[T.SAND]     = { name: "Sand", solid: true, hp: 40, pow: 0, tool: "pick", drop: "sand", falls: true, pal: ["#b99b57", "#d3b46b", "#e5c87e"] };
TILES[T.SNOW]     = { name: "Snow", solid: true, hp: 40, pow: 0, tool: "pick", drop: "snow", pal: ["#b9c7d4", "#dbe6ef", "#f2f8fd"] };
TILES[T.ICE]      = { name: "Ice", solid: true, hp: 70, pow: 0, tool: "pick", drop: "ice", slippery: true, pal: ["#6fa3c9", "#93c4e4", "#bde0f5"] };
TILES[T.WOOD]     = { name: "Wood", solid: true, hp: 70, pow: 0, tool: "pick", drop: "wood", pal: ["#6b4a26", "#855e31", "#9a7040"] };
TILES[T.STONE_BRICK] = { name: "Stone brick", solid: true, hp: 120, pow: 0, tool: "pick", drop: "stoneBrick", pal: ["#4e525a", "#686d77", "#7e848e"] };
TILES[T.GLASS]    = { name: "Glass", solid: true, hp: 30, pow: 0, tool: "pick", drop: "glass", glass: true, pal: ["#7fb4c9", "#a8d4e4", "#d3edf7"] };
TILES[T.TREE]     = { name: "Troll oak", solid: false, hp: 160, pow: 0, tool: "axe", drop: "wood", pal: ["#4e3418", "#66451f", "#7c5527"] };
TILES[T.COPPER]   = { name: "Copper ore", solid: true, hp: 140, pow: 0, tool: "pick", drop: "copperOre", ore: "#e28448", pal: ["#565a63", "#6e737d", "#848a94"] };
TILES[T.IRON]     = { name: "Iron ore", solid: true, hp: 170, pow: 40, tool: "pick", drop: "ironOre", ore: "#c9b7a6", pal: ["#565a63", "#6e737d", "#848a94"] };
TILES[T.SILVER]   = { name: "Silver ore", solid: true, hp: 200, pow: 50, tool: "pick", drop: "silverOre", ore: "#d9e2ea", pal: ["#565a63", "#6e737d", "#848a94"] };
TILES[T.GOLD]     = { name: "Gold ore", solid: true, hp: 230, pow: 60, tool: "pick", drop: "goldOre", ore: "#f4c64c", pal: ["#565a63", "#6e737d", "#848a94"] };
TILES[T.TORCH]    = { name: "Torch", solid: false, hp: 5, pow: 0, tool: "pick", drop: "torch", light: 255, noVariant: true };
TILES[T.WORKBENCH] = { name: "Workbench", solid: false, hp: 60, pow: 0, tool: "pick", drop: "workbench", station: "workbench", noVariant: true };
TILES[T.FURNACE]  = { name: "Furnace", solid: false, hp: 90, pow: 0, tool: "pick", drop: "furnace", station: "furnace", light: 120, noVariant: true };
TILES[T.ANVIL]    = { name: "Anvil", solid: false, hp: 90, pow: 0, tool: "pick", drop: "anvil", station: "anvil", noVariant: true };
TILES[T.CHEST]    = { name: "Chest", solid: false, hp: 80, pow: 0, tool: "pick", drop: "chest", noVariant: true };
TILES[T.DOOR_C]   = { name: "Door", solid: true, hp: 70, pow: 0, tool: "pick", drop: "door", noVariant: true };
TILES[T.DOOR_O]   = { name: "Door (open)", solid: false, hp: 70, pow: 0, tool: "pick", drop: "door", noVariant: true };
TILES[T.PLATFORM] = { name: "Platform", solid: false, oneWay: true, hp: 40, pow: 0, tool: "pick", drop: "platform", noVariant: true };
TILES[T.HEART]    = { name: "Troll heart", solid: true, hp: 220, pow: 50, tool: "pick", drop: null, light: 70, heart: true, pal: ["#8c2440", "#c23a60", "#e85f86"] };
TILES[T.SHROOM]   = { name: "Glowshroom", solid: false, hp: 5, pow: 0, tool: "pick", drop: "mushroom", light: 90, noVariant: true };
TILES[T.BEDROCK]  = { name: "Trollrock", solid: true, hp: Infinity, pow: 999, tool: "pick", drop: null, pal: ["#26282e", "#33363e", "#41454f"] };
TILES[T.OBSIDIAN] = { name: "Obsidian", solid: true, hp: 260, pow: 60, tool: "pick", drop: "obsidian", pal: ["#231d33", "#352c4d", "#4a3e6b"] };
TILES[T.PLANT]    = { name: "Plant", solid: false, hp: 1, pow: 0, tool: "pick", drop: "seeds", noVariant: true };
TILES[T.BED]      = { name: "Troll cot", solid: false, hp: 70, pow: 0, tool: "pick", drop: "bed", noVariant: true };
TILES[T.LEVER]    = { name: "Lever", solid: false, hp: 40, pow: 0, tool: "pick", drop: "lever", noVariant: true };
TILES[T.PLATE]    = { name: "Pressure plate", solid: false, hp: 40, pow: 0, tool: "pick", drop: "plate", noVariant: true };
TILES[T.DART_L]   = { name: "Dart trap", solid: true, hp: 160, pow: 0, tool: "pick", drop: "dartTrap", noVariant: true };
TILES[T.DART_R]   = { name: "Dart trap", solid: true, hp: 160, pow: 0, tool: "pick", drop: "dartTrap", noVariant: true };
TILES[T.TORCH_OFF] = { name: "Torch (out)", solid: false, hp: 5, pow: 0, tool: "pick", drop: "torch", noVariant: true };
TILES[T.TROLLIUM] = { name: "Trollium ore", solid: true, hp: 300, pow: 80, tool: "pick", drop: "trolliumOre", ore: "#57e87a", light: 95, pal: ["#565a63", "#6e737d", "#848a94"] };
TILES[T.GRIN_FRAG] = { name: "Grin fragment", solid: false, hp: 1, pow: 0, tool: "pick", drop: "grinFragment", light: 55, noVariant: true };
TILES[T.MUD]      = { name: "Mud", solid: true, hp: 45, pow: 0, tool: "pick", drop: "dirt", pal: ["#3a3220", "#4a4028", "#5a4f30"] };
TILES[T.PEPE_SCROLL] = { name: "Rare Pepe scroll", solid: false, hp: 1, pow: 0, tool: "pick", drop: "pepeScroll", light: 35, noVariant: true };
TILES[T.MOONROCK] = { name: "Moon rock", solid: true, hp: 190, pow: 45, tool: "pick", drop: "moonShard", ore: "#cfe8ff", light: 85, pal: ["#3a3f52", "#4d5468", "#616a80"] };
TILES[T.MOON_DEBRIS] = { name: "Moon debris", solid: true, hp: 35, pow: 0, tool: "pick", drop: "stone", falls: true, light: 20, pal: ["#4d5468", "#616a80", "#7a84a0"] };
TILES[T.ROCKET_PART] = { name: "Rocket part", solid: false, hp: 1, pow: 0, tool: "pick", drop: "rocketPart", light: 25, noVariant: true };
TILES[T.ROCKET_PAD] = { name: "Rocket pad", solid: false, hp: Infinity, noVariant: true, light: 60 };
TILES[T.VAULT_DOOR] = { name: "Vault door", solid: true, hp: Infinity, noVariant: true, light: 30 };
TILES[T.GRIN_ALTAR] = { name: "Grin Core altar", solid: true, hp: Infinity, noVariant: true, light: 90 };
TILES[T.CAMPFIRE] = { name: "Campfire", solid: false, hp: 50, pow: 0, tool: "pick", drop: "campfire", station: "campfire", light: 150, noVariant: true };
TILES[T.FARMLAND] = { name: "Farmland", solid: true, hp: 45, pow: 0, tool: "pick", drop: "dirt", pal: ["#4a3820", "#5c4726", "#6d5730"] };
TILES[T.CROP1]    = { name: "Seedling", solid: false, hp: 1, pow: 0, tool: "pick", drop: "seeds", noVariant: true };
TILES[T.CROP2]    = { name: "Crop (growing)", solid: false, hp: 1, pow: 0, tool: "pick", drop: "seeds", noVariant: true };
TILES[T.CROP3]    = { name: "Crop (ripe)", solid: false, hp: 1, pow: 0, tool: "pick", drop: "berry", noVariant: true };
TILES[T.SIGN]     = { name: "Weathered sign", solid: false, hp: Infinity, noVariant: true };
TILES[T.ROPE]     = { name: "Rope", solid: false, hp: 8, pow: 0, tool: "pick", drop: "rope", climbable: true, needsSupport: true, noVariant: true };
TILES[T.ENCHANT_TABLE] = { name: "Enchant table", solid: false, hp: 120, pow: 0, tool: "pick", drop: "enchantTable", station: "enchant", light: 70, needsFloor: true, noVariant: true };

/* Building-set variants: pure decoration, no new mechanics. Colored glass
   reuses the .glass render path but with its own tint (glassColor) instead
   of the default pale blue. */
TILES[T.PLANKS]     = { name: "Planks", solid: true, hp: 70, pow: 0, tool: "pick", drop: "planks", pal: ["#8a6236", "#a8814a", "#c49c60"] };
TILES[T.CLAY]       = { name: "Clay", solid: true, hp: 45, pow: 0, tool: "pick", drop: "clay", pal: ["#8a7a68", "#a4927c", "#b8a891"] };
TILES[T.CLAY_BRICK] = { name: "Clay brick", solid: true, hp: 110, pow: 0, tool: "pick", drop: "clayBrick", pal: ["#7a3f2e", "#9c5138", "#b86648"] };
TILES[T.POLISHED_STONE] = { name: "Polished stone", solid: true, hp: 130, pow: 0, tool: "pick", drop: "polishedStone", pal: ["#6b707a", "#868c97", "#a3aab5"] };
TILES[T.CHISELED_BRICK] = { name: "Chiseled brick", solid: true, hp: 130, pow: 0, tool: "pick", drop: "chiseledBrick", pal: ["#5a5e68", "#767c87", "#939aa6"] };
TILES[T.GLASS_RED]   = { name: "Red glass", solid: true, hp: 30, pow: 0, tool: "pick", drop: "glassRed", glass: true, glassColor: "rgba(233,90,90,0.35)", pal: ["#7fb4c9", "#a8d4e4", "#d3edf7"] };
TILES[T.GLASS_GREEN] = { name: "Green glass", solid: true, hp: 30, pow: 0, tool: "pick", drop: "glassGreen", glass: true, glassColor: "rgba(95,191,58,0.35)", pal: ["#7fb4c9", "#a8d4e4", "#d3edf7"] };
TILES[T.GLASS_BLUE]  = { name: "Blue glass", solid: true, hp: 30, pow: 0, tool: "pick", drop: "glassBlue", glass: true, glassColor: "rgba(79,143,211,0.35)", pal: ["#7fb4c9", "#a8d4e4", "#d3edf7"] };
TILES[T.WOOD_RED]    = { name: "Red painted wood", solid: true, hp: 70, pow: 0, tool: "pick", drop: "woodRed", pal: ["#7a3a30", "#a04c3e", "#c05f4d"] };
TILES[T.WOOD_GREEN]  = { name: "Green painted wood", solid: true, hp: 70, pow: 0, tool: "pick", drop: "woodGreen", pal: ["#3a6b2e", "#4f8f3d", "#63ab4d"] };
TILES[T.WOOD_BLUE]   = { name: "Blue painted wood", solid: true, hp: 70, pow: 0, tool: "pick", drop: "woodBlue", pal: ["#2e4f7a", "#3d6aa0", "#4d82c2"] };
TILES[T.FENCE] = { name: "Fence", solid: true, hp: 60, pow: 0, tool: "pick", drop: "fence", needsFloor: true, noVariant: true };
TILES[T.METEORITE] = { name: "Meteorite", solid: true, hp: 240, pow: 55, tool: "pick", drop: "meteorite", ore: "#ff8f6b", light: 60, pal: ["#4a1f3a", "#6b2f52", "#8f4570"] };
/* Wiring depth: a directional Repeater that delays a pulse instead of
   passing it through instantly, a Timer Torch that auto-reverts a few
   seconds after being pulsed (so it re-pulses its own network without a
   second lever click), and an auto-closing Trapdoor. See Game.pulseWire
   / Game._pendingPulses (main.js) for how the delay is actually timed. */
TILES[T.REPEATER_L] = { name: "Repeater", solid: false, hp: 40, pow: 0, tool: "pick", drop: "repeater", needsFloor: true, noVariant: true };
TILES[T.REPEATER_R] = { name: "Repeater", solid: false, hp: 40, pow: 0, tool: "pick", drop: "repeater", needsFloor: true, noVariant: true };
TILES[T.TIMER_TORCH]     = { name: "Timer torch", solid: false, hp: 5, pow: 0, tool: "pick", drop: "timerTorch", light: 200, needsSupport: true, noVariant: true };
TILES[T.TIMER_TORCH_OFF] = { name: "Timer torch (cooling)", solid: false, hp: 5, pow: 0, tool: "pick", drop: "timerTorch", needsSupport: true, noVariant: true };
TILES[T.TRAPDOOR_C] = { name: "Trapdoor", solid: true, hp: 60, pow: 0, tool: "pick", drop: "trapdoor", needsFloor: true, noVariant: true };
TILES[T.TRAPDOOR_O] = { name: "Trapdoor (open)", solid: false, hp: 60, pow: 0, tool: "pick", drop: "trapdoor", needsFloor: true, noVariant: true };
/* Troll Pylon (parity Phase 3): right-click warps between every placed
   pylon (Game.listPylons/usePylon, main.js) -- Terraria's fast-travel
   network, unlocked from a village Trader once ≥2 of their neighbors are
   happy (see npc.js TownNPC.mood + ui.js paintShop). */
TILES[T.PYLON] = { name: "Troll Pylon", solid: false, hp: 120, pow: 0, tool: "pick", drop: "pylon", light: 130, needsFloor: true, noVariant: true };
/* Cooking Pot (parity Phase 4): a "pot" station, so it gets the generic
   right-click-opens-crafting behavior from Phase 1 for free (TILES[].
   station is the hook Game.interact()/stationsNear() key off). Must sit
   directly above a lit campfire to place (see tryPlace's needsCampfireBelow
   check, main.js) -- the default the parity prompt's design doc called for. */
TILES[T.COOKING_POT] = { name: "Cooking Pot", solid: false, hp: 70, pow: 0, tool: "pick", drop: "cookingPot", station: "pot", noVariant: true };
/* Rail (parity Phase 6, simplified): a one-way platform tile the player's
   own body rides directly -- low friction, higher top speed -- rather
   than a separate cart entity with junction-switching. See Player.onRail
   in player.js for the ride mechanic. */
TILES[T.RAIL] = { name: "Rail", solid: false, hp: 40, pow: 0, tool: "pick", drop: "rail", oneWay: true, noVariant: true };

/* Tiles Game.interact() actually handles on right-click -- used to decide
   whether to show the hover "RMB" hint, so the list stays in sync with
   interact() itself instead of drifting into its own copy. */
export function isInteractableTile(id) {
  const def = TILES[id];
  if (def && def.station) return true;
  return id === T.DOOR_C || id === T.DOOR_O || id === T.SIGN || id === T.CHEST ||
    id === T.LEVER || id === T.TIMER_TORCH || id === T.TIMER_TORCH_OFF ||
    id === T.TRAPDOOR_C || id === T.TRAPDOOR_O || id === T.ROCKET_PAD ||
    id === T.VAULT_DOOR || id === T.GRIN_ALTAR || id === T.BED || id === T.PYLON;
}

export const CROP_GROW_TIME = 45;   // seconds per growth stage

/* Furnace fuel: real burn time instead of free/instant smelting. Wood is
   the only fuel for now (nothing else combustible exists yet). Burns down
   in real time whether or not you're actively smelting, same as a real
   fire; each individual smelt also takes SMELT_TIME to finish so output
   isn't instant even with fuel loaded. */
export const FUEL = { wood: 8 };     // seconds of burn per unit consumed
export const SMELT_TIME = 2;         // seconds per craft at a furnace

/* ------------------------------------------------------------------- walls */
export const W = { NONE: 0, DIRT: 1, STONE: 2, WOOD: 3, STONE_BRICK: 4 };
export const WALLS = [];
WALLS[W.NONE]  = { name: "" };
WALLS[W.DIRT]  = { name: "Dirt wall", drop: null, pal: ["#3a2a17", "#463320"] };        // natural, no drop
WALLS[W.STONE] = { name: "Stone wall", drop: null, pal: ["#33363d", "#3d4149"] };       // natural, no drop
WALLS[W.WOOD]  = { name: "Wood wall", drop: "woodWall", pal: ["#42301a", "#4e3920"] };
WALLS[W.STONE_BRICK] = { name: "Stone brick wall", drop: "stoneBrickWall", pal: ["#2f323a", "#3a3e47"] };

/* ------------------------------------------------------------------- items */
/* type: block | wall | tool | weapon | bow | ammo | armor | potion | material | summon
   tools: power (mining strength), speed (uses/sec), dmg
   weapons: dmg, knock, arc (swing size scalar)
   armor: slot head|chest|legs, def                                          */
export const ITEMS = {
  /* placeable blocks */
  dirt:        { name: "Dirt", type: "block", tile: T.DIRT, max: 999 },
  stone:       { name: "Stone", type: "block", tile: T.STONE, max: 999 },
  sand:        { name: "Sand", type: "block", tile: T.SAND, max: 999 },
  snow:        { name: "Snow", type: "block", tile: T.SNOW, max: 999 },
  ice:         { name: "Ice", type: "block", tile: T.ICE, max: 999 },
  wood:        { name: "Wood", type: "block", tile: T.WOOD, max: 999 },
  stoneBrick:  { name: "Stone brick", type: "block", tile: T.STONE_BRICK, max: 999 },
  glass:       { name: "Glass", type: "block", tile: T.GLASS, max: 999 },
  obsidian:    { name: "Obsidian", type: "block", tile: T.OBSIDIAN, max: 999 },
  torch:       { name: "Torch", type: "block", tile: T.TORCH, max: 99, needsSupport: true },
  workbench:   { name: "Workbench", type: "block", tile: T.WORKBENCH, max: 99, needsFloor: true },
  furnace:     { name: "Furnace", type: "block", tile: T.FURNACE, max: 99, needsFloor: true },
  anvil:       { name: "Anvil", type: "block", tile: T.ANVIL, max: 99, needsFloor: true },
  campfire:    { name: "Campfire", type: "block", tile: T.CAMPFIRE, max: 99, needsFloor: true, desc: "Cook raw meat here." },
  farmland:    { name: "Farmland", type: "block", tile: T.FARMLAND, max: 99, needsFloor: true, desc: "Tilled soil. Plant seeds on top." },
  seeds:       { name: "Seeds", type: "block", tile: T.CROP1, max: 99, needsFarmland: true, desc: "Plant on farmland. Grows into troll berries." },
  chest:       { name: "Chest", type: "block", tile: T.CHEST, max: 99, needsFloor: true },
  door:        { name: "Door", type: "block", tile: T.DOOR_C, max: 99, tall: 2, needsFloor: true },
  bed:         { name: "Troll cot", type: "block", tile: T.BED, max: 99, needsFloor: true, desc: "Right-click to set your spawn." },
  lever:       { name: "Lever", type: "block", tile: T.LEVER, max: 99, needsSupport: true, desc: "Right-click to pulse connected wires." },
  plate:       { name: "Pressure plate", type: "block", tile: T.PLATE, max: 99, needsFloor: true, desc: "Pulses wires when stepped on." },
  dartTrap:    { name: "Dart trap", type: "block", tile: T.DART_L, rTile: T.DART_R, max: 99, faces: true, desc: "Fires darts when pulsed. Darts hurt everyone." },
  repeater:    { name: "Repeater", type: "block", tile: T.REPEATER_L, rTile: T.REPEATER_R, max: 99, faces: true, needsFloor: true, desc: "Delays a pulse by half a second before passing it on. Faces away from you." },
  timerTorch:  { name: "Timer torch", type: "block", tile: T.TIMER_TORCH, max: 99, needsSupport: true, desc: "Pulsing it goes dark for a few seconds, then it re-pulses its own wire network on its own." },
  trapdoor:    { name: "Trapdoor", type: "block", tile: T.TRAPDOOR_C, max: 99, needsFloor: true, desc: "Pulse to open -- swings shut on its own a few seconds later." },
  wrench:      { name: "Wrench", type: "tool", tool: "wrench", power: 0, speed: 6, dmg: 3, desc: "Lays wire (LMB) — needs Wire in your bag. Click a wired tile to cut." },
  trollRod:    { name: "Troll Rod", type: "tool", tool: "rod", desc: "Cast into open water (LMB). Wait for a bite, then reel it in." },
  wire:        { name: "Wire", type: "material", max: 999 },
  platform:    { name: "Platform", type: "block", tile: T.PLATFORM, max: 999 },
  rope:        { name: "Rope", type: "block", tile: T.ROPE, max: 999, needsSupport: true, desc: "Climb it with W/S — or grab it mid-fall to stop taking fall damage." },
  enchantTable: { name: "Enchant table", type: "block", tile: T.ENCHANT_TABLE, max: 99, needsFloor: true, desc: "Right-click to enchant a tool, weapon, or armor piece." },
  pylon: { name: "Troll Pylon", type: "block", tile: T.PYLON, max: 9, needsFloor: true, desc: "Right-click to warp to any other placed pylon." },
  /* building-set variants */
  planks:         { name: "Planks", type: "block", tile: T.PLANKS, max: 999 },
  clay:           { name: "Clay", type: "block", tile: T.CLAY, max: 999 },
  clayBrick:      { name: "Clay brick", type: "block", tile: T.CLAY_BRICK, max: 999 },
  polishedStone:  { name: "Polished stone", type: "block", tile: T.POLISHED_STONE, max: 999 },
  chiseledBrick:  { name: "Chiseled brick", type: "block", tile: T.CHISELED_BRICK, max: 999 },
  glassRed:       { name: "Red glass", type: "block", tile: T.GLASS_RED, max: 999 },
  glassGreen:     { name: "Green glass", type: "block", tile: T.GLASS_GREEN, max: 999 },
  glassBlue:      { name: "Blue glass", type: "block", tile: T.GLASS_BLUE, max: 999 },
  woodRed:        { name: "Red painted wood", type: "block", tile: T.WOOD_RED, max: 999 },
  woodGreen:      { name: "Green painted wood", type: "block", tile: T.WOOD_GREEN, max: 999 },
  woodBlue:       { name: "Blue painted wood", type: "block", tile: T.WOOD_BLUE, max: 999 },
  fence:          { name: "Fence", type: "block", tile: T.FENCE, max: 999, needsFloor: true, desc: "Blocks animals in (and out). Break it to make a gate." },
  /* walls */
  woodWall:       { name: "Wood wall", type: "wall", wall: W.WOOD, max: 999 },
  stoneBrickWall: { name: "Stone brick wall", type: "wall", wall: W.STONE_BRICK, max: 999 },
  /* materials */
  copperOre:  { name: "Copper ore", type: "material", max: 999 },
  ironOre:    { name: "Iron ore", type: "material", max: 999 },
  silverOre:  { name: "Silver ore", type: "material", max: 999 },
  goldOre:    { name: "Gold ore", type: "material", max: 999 },
  copperBar:  { name: "Copper bar", type: "material", max: 999 },
  ironBar:    { name: "Iron bar", type: "material", max: 999 },
  silverBar:  { name: "Silver bar", type: "material", max: 999 },
  goldBar:    { name: "Gold bar", type: "material", max: 999 },
  trolliumOre: { name: "Trollium ore", type: "material", max: 999 },
  trolliumBar: { name: "Trollium bar", type: "material", max: 999 },
  gel:        { name: "Troll gel", type: "material", max: 999 },
  lens:       { name: "Eyeball lens", type: "material", max: 999 },
  bone:       { name: "Troll bone", type: "material", max: 999 },
  mushroom:   { name: "Glowshroom", type: "material", max: 999 },
  grinFragment: { name: "Grin fragment", type: "material", max: 99, desc: "A shard of the Grin Core. Someone's collecting these." },
  pepeScroll: { name: "Rare Pepe scroll", type: "material", max: 99, desc: "Rare. Once. Before the screenshots." },
  moonShard: { name: "Doge Moon Shard", type: "material", max: 99, desc: "Glows faintly. Smells like the moon. Very ore." },
  rocketPart: { name: "Rocket part", type: "material", max: 99, desc: "Salvaged from a prototype. Probably fine." },
  meteorite: { name: "Meteorite", type: "material", max: 99, desc: "Still warm. Fell from somewhere important." },
  trollCoin: { name: "Troll Coin", type: "material", max: 999, desc: "Minted by nobody, accepted by everybody. Drops off anything hostile." },
  whaleKey: { name: "Whale Key", type: "material", max: 5, desc: "Only diamond hands may enter the vault. Opens the Whale Vault door." },
  antiBotFlame: { name: "Anti-Bot Flame", type: "material", max: 5, desc: "Burns cleaner than any real fire. Doesn't like bots." },
  /* tools */
  woodPick:   { name: "Wooden pick", type: "tool", tool: "pick", power: 35, speed: 3.4, dmg: 5 },
  copperPick: { name: "Copper pick", type: "tool", tool: "pick", power: 45, speed: 3.8, dmg: 6 },
  ironPick:   { name: "Iron pick", type: "tool", tool: "pick", power: 55, speed: 4.2, dmg: 7 },
  silverPick: { name: "Silver pick", type: "tool", tool: "pick", power: 65, speed: 4.6, dmg: 8 },
  goldPick:   { name: "Golden pick", type: "tool", tool: "pick", power: 80, speed: 5.2, dmg: 10 },
  trolliumPick: { name: "Trollium pick", type: "tool", tool: "pick", power: 100, speed: 6, dmg: 14 },
  woodAxe:    { name: "Wooden axe", type: "tool", tool: "axe", power: 40, speed: 3.0, dmg: 6 },
  copperAxe:  { name: "Copper axe", type: "tool", tool: "axe", power: 55, speed: 3.4, dmg: 8 },
  ironAxe:    { name: "Iron axe", type: "tool", tool: "axe", power: 70, speed: 3.8, dmg: 10 },
  goldAxe:    { name: "Golden axe", type: "tool", tool: "axe", power: 95, speed: 4.4, dmg: 13 },
  woodHammer: { name: "Wooden hammer", type: "tool", tool: "hammer", power: 40, speed: 3.0, dmg: 7 },
  ironHammer: { name: "Iron hammer", type: "tool", tool: "hammer", power: 70, speed: 3.6, dmg: 12 },
  /* weapons */
  woodSword:   { name: "Wooden sword", type: "weapon", dmg: 9, knock: 190, speed: 3.6, arc: 1.0 },
  copperSword: { name: "Copper sword", type: "weapon", dmg: 13, knock: 210, speed: 3.8, arc: 1.0 },
  ironSword:   { name: "Iron sword", type: "weapon", dmg: 18, knock: 230, speed: 4.0, arc: 1.05 },
  silverSword: { name: "Silver sword", type: "weapon", dmg: 23, knock: 250, speed: 4.2, arc: 1.1 },
  goldSword:   { name: "Golden sword", type: "weapon", dmg: 29, knock: 270, speed: 4.4, arc: 1.15 },
  trollBlade:  { name: "Troll Blade", type: "weapon", dmg: 39, knock: 340, speed: 4.2, arc: 1.5, rare: true },
  trolliumSword: { name: "Trollium sword", type: "weapon", dmg: 48, knock: 300, speed: 4.4, arc: 1.3 },
  emperorEdge: { name: "Emperor's Edge", type: "weapon", dmg: 62, knock: 380, speed: 4.4, arc: 1.7, rare: true },
  starforgeBlade: { name: "Starforge Blade", type: "weapon", dmg: 54, knock: 320, speed: 4.3, arc: 1.35, rare: true, desc: "Struck from the sky. Still faintly warm." },
  trolliumBow: { name: "Trollium bow", type: "bow", dmg: 24, speed: 3.6 },
  woodBow:     { name: "Wooden bow", type: "bow", dmg: 9, speed: 2.6 },
  goldBow:     { name: "Golden bow", type: "bow", dmg: 17, speed: 3.2 },
  arrow:       { name: "Arrow", type: "ammo", dmg: 5, max: 999 },
  flameArrow:  { name: "Flaming arrow", type: "ammo", dmg: 10, max: 999, flame: true },
  /* armor */
  copperHelm:  { name: "Copper helmet", type: "armor", slot: "head", def: 1 },
  copperChest: { name: "Copper chestplate", type: "armor", slot: "chest", def: 2 },
  copperLegs:  { name: "Copper greaves", type: "armor", slot: "legs", def: 1 },
  ironHelm:    { name: "Iron helmet", type: "armor", slot: "head", def: 2 },
  ironChest:   { name: "Iron chestplate", type: "armor", slot: "chest", def: 3 },
  ironLegs:    { name: "Iron greaves", type: "armor", slot: "legs", def: 2 },
  silverHelm:  { name: "Silver helmet", type: "armor", slot: "head", def: 3 },
  silverChest: { name: "Silver chestplate", type: "armor", slot: "chest", def: 4 },
  silverLegs:  { name: "Silver greaves", type: "armor", slot: "legs", def: 3 },
  goldHelm:    { name: "Golden helmet", type: "armor", slot: "head", def: 4 },
  goldChest:   { name: "Golden chestplate", type: "armor", slot: "chest", def: 5 },
  goldLegs:    { name: "Golden greaves", type: "armor", slot: "legs", def: 4 },
  trolliumHelm:  { name: "Trollium helmet", type: "armor", slot: "head", def: 6 },
  trolliumChest: { name: "Trollium chestplate", type: "armor", slot: "chest", def: 8 },
  trolliumLegs:  { name: "Trollium greaves", type: "armor", slot: "legs", def: 7 },
  /* accessories: a 4th/5th/6th equip slot on top of armor (ring/back/feet),
     each granting a real moveset perk rather than just a stat stick --
     see Inventory.accessoryPerks() for how these fields get read. */
  ringVigor: { name: "Ring of Vigor", type: "accessory", slot: "ring", def: 2, regen: 0.6, desc: "Slow, steady grit. +2 defense, faster regen." },
  ringHaste: { name: "Signet of Haste", type: "accessory", slot: "ring", speedMult: 1.12, desc: "A restless ring. +12% move speed." },
  ringGrapple: { name: "Grapple Ring", type: "accessory", slot: "ring", grapple: true, desc: "Press G to fire a troll tongue at the nearest solid tile in range and reel yourself in." },
  wingsTroll: { name: "Troll Wings", type: "accessory", slot: "back", doubleJump: true, glide: true, desc: "Molted from something enormous. Extra jump, plus a slow glide while airborne." },
  capeSwift: { name: "Swift Cape", type: "accessory", slot: "back", speedMult: 1.18, desc: "Billows dramatically. +18% move speed." },
  bootsDash: { name: "Dash Boots", type: "accessory", slot: "feet", dash: true, desc: "Double-tap A or D to dash." },
  bootsSpring: { name: "Spring Boots", type: "accessory", slot: "feet", jumpBoost: 70, desc: "Coiled soles. Noticeably higher jump." },
  /* consumables + special */
  trollBrew:   { name: "Troll brew", type: "potion", heal: 50, max: 30 },
  rawMeat:     { name: "Raw meat", type: "food", hunger: 12, max: 99, raw: true, desc: "Edible. Risky. Cook it if you can." },
  cookedMeat:  { name: "Cooked meat", type: "food", hunger: 32, hpBonus: 4, max: 99, desc: "Proper troll cooking. Restores hunger and a little grit." },
  berry:       { name: "Troll berry", type: "food", hunger: 10, max: 99, desc: "Tart little thing, farmed on tilled soil." },
  egg:         { name: "Egg", type: "food", hunger: 8, max: 99, desc: "Laid by a tamed troll hen." },
  omelette:    { name: "Omelette", type: "food", hunger: 28, hpBonus: 3, max: 99, desc: "Ranch cooking. A proper breakfast." },
  cookingPot:  { name: "Cooking Pot", type: "block", tile: T.COOKING_POT, max: 9, needsCampfireBelow: true, desc: "Place above a lit campfire. Cooks multi-ingredient meals." },
  rail:        { name: "Rail", type: "block", tile: T.RAIL, max: 999, desc: "Frictionless fast track. Stand on it and go; press S to drop through." },
  /* Cooking Pot meals (Phase 4): bigger hunger refill than any single-
     ingredient food, plus a timed Well Fed buff (see Player.applyBuff) --
     the payoff for having gathered a proper spread instead of just
     grilling one thing at a campfire. */
  trollStew:   { name: "Troll Stew", type: "food", hunger: 55, hpBonus: 6, max: 99,
    buff: { key: "wellFed", dur: 240, regenBonus: 0.6, speedMult: 1.08, label: "Well Fed" },
    desc: "Meat, berry, egg, all in one pot. Restores plenty, and it lingers." },
  berryPie:    { name: "Berry Pie", type: "food", hunger: 40, max: 99,
    buff: { key: "wellFed", dur: 150, regenBonus: 0.3, speedMult: 1.05, label: "Well Fed" },
    desc: "Berries and egg, baked together. Lighter than stew, still lingers." },
  /* Fishing (Phase 5): cast a Troll Rod into open water (Player.useRod) --
     catchFish() (main.js) rolls this table. Raw fish carries the same
     small "queasy" risk raw meat does (def.raw, see the food case in
     Player.useHeld); cooking it at a campfire removes that risk. */
  trollFish:   { name: "Troll Fish", type: "food", hunger: 20, max: 99, raw: true, desc: "Fresh catch. Cook it at a campfire, or risk it raw." },
  cookedFish:  { name: "Cooked Fish", type: "food", hunger: 38, hpBonus: 4, max: 99, desc: "Cooked at a campfire. Reliable, filling." },
  goldenTrollFish: { name: "Golden Troll Fish", type: "material", max: 20, desc: "A rare glimmering catch. Traders pay well for these." },
  trollTotem:  { name: "Troll totem", type: "summon", max: 5, desc: "Wakes the Troll King. Use at night." },
  emperorSigil: { name: "Emperor sigil", type: "summon", max: 5, desc: "Calls the Troll Emperor. Hardmode, night, regrets." },
  /* Grin Core relics — quest rewards, kept in the bag as trophies/keys */
  lostGrin:    { name: "The Lost Grin", type: "relic", max: 1, desc: "First of six. The Grin Core is starting to remember its shape." },
  /* world boss drops */
  banhammer:      { name: "The Banhammer", type: "weapon", dmg: 70, knock: 420, speed: 3.0, arc: 1.6, rare: true, desc: "Forged from a thousand rejected replies." },
  ancientGrinFragment: { name: "Ancient Grin Fragment", type: "material", max: 10, desc: "Older than the forums themselves." },
  smugCloak:      { name: "Smug Cloak", type: "material", max: 1, desc: "Cosmetic trophy. Insufferably smug." },
  dogeSweaterToken: { name: "Doge Sweater", type: "material", max: 1, desc: "Such warm. Very cozy. Cosmetic trophy." },
  moonCoreShard:  { name: "Moon Core Shard", type: "material", max: 10, desc: "Hums faintly. Might be worth something later." },
  rgbBlade:       { name: "RGB Keyboard Blade", type: "weapon", dmg: 66, knock: 380, speed: 3.4, arc: 1.5, rare: true, desc: "Mechanical. Loud. Devastating." },
  corruptedCore:  { name: "Corrupted Core", type: "material", max: 10, desc: "Still warm from the botnet." },
};
for (const id in ITEMS) { ITEMS[id].id = id; if (!ITEMS[id].max) ITEMS[id].max = 1; }

/* ----------------------------------------------------------------- recipes */
/* { out, n, ing: [[itemId, count]...], station: null|workbench|furnace|anvil } */
export const RECIPES = [
  { out: "workbench", n: 1, ing: [["wood", 10]], station: null },
  { out: "torch", n: 3, ing: [["wood", 1], ["gel", 1]], station: null },
  { out: "platform", n: 2, ing: [["wood", 1]], station: null },
  { out: "rope", n: 8, ing: [["wood", 1]], station: null },
  { out: "woodPick", n: 1, ing: [["wood", 12]], station: "workbench" },
  { out: "woodAxe", n: 1, ing: [["wood", 9]], station: "workbench" },
  { out: "woodHammer", n: 1, ing: [["wood", 8]], station: "workbench" },
  { out: "woodSword", n: 1, ing: [["wood", 7]], station: "workbench" },
  { out: "woodBow", n: 1, ing: [["wood", 10]], station: "workbench" },
  { out: "arrow", n: 5, ing: [["wood", 1], ["stone", 1]], station: "workbench" },
  { out: "flameArrow", n: 5, ing: [["arrow", 5], ["torch", 1]], station: "workbench" },
  { out: "door", n: 1, ing: [["wood", 6]], station: "workbench" },
  { out: "bed", n: 1, ing: [["wood", 15], ["gel", 5]], station: "workbench" },
  { out: "chest", n: 1, ing: [["wood", 8], ["copperBar", 2]], station: "workbench" },
  { out: "woodWall", n: 4, ing: [["wood", 1]], station: "workbench" },
  { out: "stoneBrickWall", n: 4, ing: [["stoneBrick", 1]], station: "workbench" },
  { out: "stoneBrick", n: 2, ing: [["stone", 2]], station: "workbench" },
  { out: "furnace", n: 1, ing: [["stone", 20], ["wood", 4], ["torch", 3]], station: "workbench" },
  { out: "campfire", n: 1, ing: [["wood", 8], ["stone", 4]], station: null },
  { out: "cookedMeat", n: 1, ing: [["rawMeat", 1]], station: "campfire" },
  { out: "farmland", n: 2, ing: [["dirt", 4]], station: null },
  { out: "glass", n: 1, ing: [["sand", 2]], station: "furnace" },
  { out: "copperBar", n: 1, ing: [["copperOre", 3]], station: "furnace" },
  { out: "ironBar", n: 1, ing: [["ironOre", 3]], station: "furnace" },
  { out: "silverBar", n: 1, ing: [["silverOre", 3]], station: "furnace" },
  { out: "goldBar", n: 1, ing: [["goldOre", 3]], station: "furnace" },
  { out: "trollBrew", n: 1, ing: [["mushroom", 1], ["gel", 1]], station: "furnace" },
  { out: "anvil", n: 1, ing: [["ironBar", 5]], station: "workbench" },
  { out: "copperPick", n: 1, ing: [["copperBar", 8], ["wood", 3]], station: "anvil" },
  { out: "copperAxe", n: 1, ing: [["copperBar", 7], ["wood", 3]], station: "anvil" },
  { out: "copperSword", n: 1, ing: [["copperBar", 6]], station: "anvil" },
  { out: "ironPick", n: 1, ing: [["ironBar", 8], ["wood", 3]], station: "anvil" },
  { out: "ironAxe", n: 1, ing: [["ironBar", 7], ["wood", 3]], station: "anvil" },
  { out: "ironHammer", n: 1, ing: [["ironBar", 6], ["wood", 3]], station: "anvil" },
  { out: "ironSword", n: 1, ing: [["ironBar", 6]], station: "anvil" },
  { out: "silverPick", n: 1, ing: [["silverBar", 8], ["wood", 3]], station: "anvil" },
  { out: "silverSword", n: 1, ing: [["silverBar", 6]], station: "anvil" },
  { out: "goldPick", n: 1, ing: [["goldBar", 8], ["wood", 3]], station: "anvil" },
  { out: "goldAxe", n: 1, ing: [["goldBar", 7], ["wood", 3]], station: "anvil" },
  { out: "goldSword", n: 1, ing: [["goldBar", 6]], station: "anvil" },
  { out: "goldBow", n: 1, ing: [["goldBar", 8]], station: "anvil" },
  { out: "copperHelm", n: 1, ing: [["copperBar", 10]], station: "anvil" },
  { out: "copperChest", n: 1, ing: [["copperBar", 15]], station: "anvil" },
  { out: "copperLegs", n: 1, ing: [["copperBar", 12]], station: "anvil" },
  { out: "ironHelm", n: 1, ing: [["ironBar", 10]], station: "anvil" },
  { out: "ironChest", n: 1, ing: [["ironBar", 15]], station: "anvil" },
  { out: "ironLegs", n: 1, ing: [["ironBar", 12]], station: "anvil" },
  { out: "silverHelm", n: 1, ing: [["silverBar", 10]], station: "anvil" },
  { out: "silverChest", n: 1, ing: [["silverBar", 15]], station: "anvil" },
  { out: "silverLegs", n: 1, ing: [["silverBar", 12]], station: "anvil" },
  { out: "goldHelm", n: 1, ing: [["goldBar", 10]], station: "anvil" },
  { out: "goldChest", n: 1, ing: [["goldBar", 15]], station: "anvil" },
  { out: "goldLegs", n: 1, ing: [["goldBar", 12]], station: "anvil" },
  { out: "trollTotem", n: 1, ing: [["lens", 6], ["goldBar", 5]], station: "anvil" },
  { out: "trolliumBar", n: 1, ing: [["trolliumOre", 4]], station: "furnace" },
  { out: "trolliumPick", n: 1, ing: [["trolliumBar", 10], ["wood", 4]], station: "anvil" },
  { out: "trolliumSword", n: 1, ing: [["trolliumBar", 8]], station: "anvil" },
  { out: "trolliumBow", n: 1, ing: [["trolliumBar", 9]], station: "anvil" },
  { out: "trolliumHelm", n: 1, ing: [["trolliumBar", 12]], station: "anvil" },
  { out: "trolliumChest", n: 1, ing: [["trolliumBar", 18]], station: "anvil" },
  { out: "trolliumLegs", n: 1, ing: [["trolliumBar", 14]], station: "anvil" },
  { out: "emperorSigil", n: 1, ing: [["trolliumBar", 8], ["bone", 10], ["lens", 4]], station: "anvil" },
  { out: "wrench", n: 1, ing: [["ironBar", 6]], station: "anvil" },
  { out: "wire", n: 4, ing: [["copperBar", 1]], station: "anvil" },
  { out: "lever", n: 1, ing: [["stone", 3], ["ironBar", 1]], station: "workbench" },
  { out: "plate", n: 1, ing: [["stone", 2], ["copperBar", 1]], station: "workbench" },
  { out: "dartTrap", n: 1, ing: [["stone", 10], ["copperBar", 3]], station: "workbench" },
  { out: "enchantTable", n: 1, ing: [["trolliumBar", 4], ["lens", 4], ["goldBar", 3]], station: "anvil" },
  /* building-set variants */
  { out: "planks", n: 4, ing: [["wood", 2]], station: "workbench" },
  { out: "clay", n: 2, ing: [["dirt", 2], ["sand", 2]], station: null },
  { out: "clayBrick", n: 1, ing: [["clay", 2]], station: "furnace" },
  { out: "polishedStone", n: 2, ing: [["stone", 3]], station: "workbench" },
  { out: "chiseledBrick", n: 2, ing: [["stoneBrick", 2]], station: "anvil" },
  { out: "glassRed", n: 2, ing: [["glass", 2], ["berry", 2]], station: "furnace" },
  { out: "glassGreen", n: 2, ing: [["glass", 2], ["mushroom", 2]], station: "furnace" },
  { out: "glassBlue", n: 2, ing: [["glass", 2], ["ice", 2]], station: "furnace" },
  { out: "woodRed", n: 2, ing: [["planks", 2], ["berry", 2]], station: "workbench" },
  { out: "woodGreen", n: 2, ing: [["planks", 2], ["mushroom", 2]], station: "workbench" },
  { out: "woodBlue", n: 2, ing: [["planks", 2], ["ice", 2]], station: "workbench" },
  /* accessories */
  { out: "ringVigor", n: 1, ing: [["silverBar", 8], ["gel", 6]], station: "anvil" },
  { out: "ringHaste", n: 1, ing: [["goldBar", 6], ["lens", 4]], station: "anvil" },
  { out: "wingsTroll", n: 1, ing: [["trolliumBar", 10], ["bone", 8], ["moonShard", 4]], station: "anvil" },
  { out: "capeSwift", n: 1, ing: [["silverBar", 10], ["ironBar", 6]], station: "anvil" },
  { out: "bootsDash", n: 1, ing: [["goldBar", 8], ["gel", 8]], station: "anvil" },
  { out: "bootsSpring", n: 1, ing: [["ironBar", 10], ["gel", 4]], station: "anvil" },
  { out: "ringGrapple", n: 1, ing: [["silverBar", 8], ["rope", 10], ["gel", 6]], station: "anvil" },
  /* ranching */
  { out: "fence", n: 6, ing: [["wood", 3]], station: "workbench" },
  { out: "omelette", n: 1, ing: [["egg", 2]], station: "campfire" },
  /* world events */
  { out: "starforgeBlade", n: 1, ing: [["meteorite", 6], ["trolliumBar", 4]], station: "anvil" },
  /* wiring depth */
  { out: "repeater", n: 2, ing: [["copperBar", 4], ["stone", 4]], station: "workbench" },
  { out: "timerTorch", n: 2, ing: [["torch", 2], ["gel", 3]], station: "workbench" },
  { out: "trapdoor", n: 1, ing: [["wood", 6], ["ironBar", 2]], station: "anvil" },
  /* cooking pot (Phase 4) */
  { out: "cookingPot", n: 1, ing: [["stone", 10], ["ironBar", 1]], station: "workbench" },
  { out: "trollStew", n: 1, ing: [["rawMeat", 1], ["berry", 2], ["egg", 1]], station: "pot" },
  { out: "berryPie", n: 1, ing: [["berry", 4], ["egg", 2]], station: "pot" },
  /* fishing (Phase 5) */
  { out: "trollRod", n: 1, ing: [["wood", 10], ["rope", 4], ["ironBar", 1]], station: "workbench" },
  { out: "cookedFish", n: 1, ing: [["trollFish", 1]], station: "campfire" },
  /* rails (Phase 6) */
  { out: "rail", n: 6, ing: [["ironBar", 1], ["wood", 2]], station: "workbench" },
];

/* Traveling Trader (world event, main.js spawnTravelingTrader): picks 4
   random offers from this pool per visit, same give/get barter shape as
   every other shop. Deliberately pricier/rarer than the settled shops. */
export const TRADER_POOL = [
  { give: [["goldBar", 10]], get: ["moonShard", 3] },
  { give: [["moonShard", 5]], get: ["trolliumBar", 3] },
  { give: [["bone", 10]], get: ["lens", 6] },
  { give: [["gel", 15]], get: ["goldBar", 4] },
  { give: [["silverBar", 14]], get: ["trolliumBar", 2] },
  { give: [["ironBar", 20]], get: ["silverBar", 8] },
  { give: [["berry", 20]], get: ["mushroom", 20] },
  { give: [["pepeScroll", 1]], get: ["lens", 10] },
  { give: [["rocketPart", 1]], get: ["goldBar", 6] },
  { give: [["meteorite", 3]], get: ["trolliumBar", 3] },
  { give: [["trollCoin", 60]], get: ["moonShard", 2] },
  { give: [["trollCoin", 40]], get: ["goldBar", 3] },
];

/* ----------------------------------------------------------------- enchanting */
/* One enchant per item, re-rolling replaces whatever was there before --
   no stacking multiple enchants for v1. Cost is a flat reagent price
   regardless of item type or rarity, paid at the enchant table. */
export const ENCHANT_COST = [["lens", 3], ["gel", 4]];
export const ENCHANTS = {
  tool: [
    { key: "efficiency", name: "Efficiency", power: 15 },
    { key: "haste", name: "Haste", speed: 0.6 },
  ],
  weapon: [
    { key: "sharpness", name: "Sharpness", dmg: 6 },
    { key: "brutality", name: "Brutality", knock: 60 },
  ],
  armor: [
    { key: "protection", name: "Protection", def: 2 },
  ],
};

/* ----------------------------------------------------------------- enemies */
/* ai: slime | walker | flyer  ·  ctx: when/where it spawns */
export const ENEMIES = {
  /* Passive animals: never attack, flee when the player closes in, die in
     a couple hits, drop raw meat for the hunger/cooking loop. Spawned by
     updateAnimalSpawns() (main.js), not the hostile spawn tables. */
  trollBoar: { name: "Troll Boar", ai: "flee", hp: 24, dmg: 0, def: 0, w: 24, h: 18, color: "#c98a72", drops: [["rawMeat", 1, 2, 1]], kb: 1.0, passive: true, tameFood: "berry" },
  trollHen:  { name: "Troll Hen", ai: "flee", hp: 14, dmg: 0, def: 0, w: 18, h: 16, color: "#d9c9a3", drops: [["rawMeat", 1, 1, 1]], kb: 1.1, passive: true, tameFood: "mushroom", lays: "egg" },
  slimeGreen: { name: "Green troll slime", ai: "slime", hp: 16, dmg: 8, def: 0, w: 26, h: 18, color: "#4fd35f", drops: [["gel", 1, 2, 1]], kb: 1.0 },
  slimeBlue:  { name: "Blue troll slime", ai: "slime", hp: 26, dmg: 10, def: 2, w: 28, h: 20, color: "#4f9fd3", drops: [["gel", 1, 3, 1]], kb: 1.0 },
  zombie:     { name: "Troll zombie", ai: "walker", hp: 46, dmg: 15, def: 4, w: 22, h: 42, color: "#7ba05b", drops: [["gel", 0, 1, 0.2]], kb: 0.8 },
  eye:        { name: "Wandering troll eye", ai: "flyer", hp: 40, dmg: 13, def: 2, w: 26, h: 26, color: "#e8e4da", drops: [["lens", 1, 2, 0.6]], kb: 0.9 },
  bat:        { name: "Cave troll bat", ai: "flyer", hp: 22, dmg: 11, def: 1, w: 22, h: 16, color: "#8a6fb0", drops: [], kb: 1.1, erratic: true },
  skeleton:   { name: "Troll skeleton", ai: "walker", hp: 72, dmg: 19, def: 8, w: 22, h: 42, color: "#cfc9bd", drops: [["bone", 1, 3, 0.8]], kb: 0.6 },
  slimeKing:  { name: "Kingling slime", ai: "slime", hp: 30, dmg: 12, def: 3, w: 26, h: 18, color: "#e8b23c", drops: [["gel", 1, 2, 1]], kb: 0.9, noNatural: true },
  grinCreeper: { name: "Grin Creeper", ai: "exploder", hp: 20, dmg: 30, def: 0, w: 24, h: 24, color: "#5fbf3a", drops: [["gel", 1, 3, 1]], kb: 0.5 },
  boneArcher: { name: "Bone Archer", ai: "archer", hp: 50, dmg: 10, def: 4, w: 22, h: 42, color: "#cfc9bd", drops: [["bone", 1, 2, 0.7]], kb: 0.5 },
  shadowStalker: { name: "Shadow Stalker", ai: "teleporter", hp: 60, dmg: 18, def: 5, w: 24, h: 30, color: "#3a2a4d", drops: [["lens", 1, 2, 0.5]], kb: 0.7, noNatural: true },
  /* Kek Jungle */
  kekLizard: { name: "Kek Lizard", ai: "walker", hp: 34, dmg: 12, def: 2, w: 24, h: 20, color: "#6bbf3a", drops: [["gel", 1, 2, 0.8], ["berry", 0, 2, 0.4]], kb: 1.1 },
  jungleWasp: { name: "Jungle Wasp", ai: "flyer", hp: 20, dmg: 12, def: 0, w: 20, h: 16, color: "#d8b23c", drops: [["gel", 0, 1, 0.4]], kb: 1.2, erratic: true },
  /* Pepe Swamp */
  copeSlime:  { name: "Cope Slime", ai: "slime", hp: 20, dmg: 9, def: 1, w: 26, h: 18, color: "#5f8f3a", drops: [["gel", 1, 2, 1]], kb: 1.0 },
  fudPhantom: { name: "FUD Phantom", ai: "flyer", hp: 30, dmg: 13, def: 1, w: 24, h: 24, color: "#8a7fa8", drops: [["lens", 0, 1, 0.3]], kb: 0.9, erratic: true },
  rugPullRat: { name: "Rug Pull Rat", ai: "ratRunner", hp: 18, dmg: 7, def: 0, w: 20, h: 14, color: "#a8875f", drops: [["gel", 0, 1, 0.3]], kb: 1.2 },
  /* Rage Comic Ruins */
  paperHandSkeleton: { name: "Paper Hand Skeleton", ai: "walker", hp: 55, dmg: 16, def: 3, w: 22, h: 42, color: "#e8e0c8", drops: [["bone", 1, 3, 0.8]], kb: 1.4 },
  /* Going Viral: the botnet counterattack, unlocked once the Grin Core is
     restored. Creeps into spawn tables across every earlier biome rather
     than owning a zone of its own -- the corruption is the point. */
  botGoblin: { name: "Bot Goblin", ai: "walker", hp: 60, dmg: 17, def: 5, w: 22, h: 40, color: "#5a6b7a", drops: [["gel", 1, 2, 0.6]], kb: 0.9 },
  engagementFarmer: { name: "Engagement Farmer", ai: "walker", hp: 50, dmg: 14, def: 2, w: 22, h: 40, color: "#7a5a8a", drops: [["lens", 0, 1, 0.4]], kb: 0.7 },
  cloutLeech: { name: "Clout Leech", ai: "flyer", hp: 44, dmg: 16, def: 2, w: 24, h: 22, color: "#a83a5a", drops: [["gel", 0, 2, 0.5]], kb: 1.0, erratic: true },
};

/* Boss knobs (classes live in boss.js). */
export const BOSS = {
  hp: 2600, contactDmg: 26, def: 10, tearDmg: 16,
  drops: [["trollBlade", 1, 1, 1], ["goldBar", 15, 25, 1], ["trollCoin", 120, 180, 1]],
};
export const BOSS2 = {
  hp: 5200, contactDmg: 38, def: 18, tearDmg: 24,
  drops: [["emperorEdge", 1, 1, 1], ["trolliumBar", 10, 16, 1], ["trollCoin", 250, 350, 1]],
};

export const STATION_SCAN = 8;  // tiles radius for crafting-station detection

/* Merchant Troll offers: give -> get. Coin rows use the exact same
   barter shape (trollCoin is just an item), so the shop UI renders a
   money economy and an item economy through one code path -- rows with
   coins in `get` are "sell", rows with coins in `give` are "buy". */
export const MERCHANT_OFFERS = [
  { give: [["wood", 10]], get: ["arrow", 15] },
  { give: [["gel", 3]], get: ["trollBrew", 1] },
  { give: [["mushroom", 8]], get: ["trollBrew", 3] },
  { give: [["sand", 20]], get: ["glass", 10] },
  { give: [["bone", 5]], get: ["silverBar", 1] },
  { give: [["lens", 3]], get: ["goldBar", 2] },
  { give: [["ironBar", 1]], get: ["flameArrow", 20] },
  { give: [["trollCoin", 10]], get: ["trollBrew", 1] },
  { give: [["trollCoin", 14]], get: ["arrow", 25] },
  { give: [["gel", 5]], get: ["trollCoin", 6] },
  { give: [["bone", 5]], get: ["trollCoin", 10] },
  { give: [["goldenTrollFish", 3]], get: ["trollCoin", 20] },
];

/* Trollrreria Town: four specialist barter shops, same no-currency hustle
   as the Merchant Troll -- each just deals in its own lane so a proper
   town has a reason to have more than one stall. */
export const BLACKSMITH_OFFERS = [
  { give: [["copperOre", 6]], get: ["copperBar", 2] },
  { give: [["ironOre", 6]], get: ["ironBar", 2] },
  { give: [["wood", 6], ["copperBar", 4]], get: ["copperSword", 1] },
  { give: [["wood", 6], ["ironBar", 5]], get: ["ironSword", 1] },
  { give: [["ironBar", 8]], get: ["ironHelm", 1] },
  { give: [["goldOre", 6]], get: ["goldBar", 2] },
  { give: [["trollCoin", 25]], get: ["ironBar", 2] },
  { give: [["copperOre", 8]], get: ["trollCoin", 8] },
  { give: [["ironOre", 8]], get: ["trollCoin", 14] },
];

export const ALCHEMIST_OFFERS = [
  { give: [["mushroom", 4]], get: ["trollBrew", 2] },
  { give: [["gel", 6]], get: ["trollBrew", 3] },
  { give: [["mushroom", 10], ["gel", 5]], get: ["trollBrew", 8] },
  { give: [["lens", 2]], get: ["gel", 6] },
  { give: [["bone", 4]], get: ["mushroom", 6] },
  { give: [["trollCoin", 12]], get: ["trollBrew", 2] },
  { give: [["mushroom", 8]], get: ["trollCoin", 10] },
];

export const TAVERN_OFFERS = [
  { give: [["rawMeat", 3]], get: ["cookedMeat", 3] },
  { give: [["berry", 4]], get: ["cookedMeat", 1] },
  { give: [["wood", 12]], get: ["cookedMeat", 4] },
  { give: [["gel", 4]], get: ["berry", 10] },
  { give: [["trollCoin", 8]], get: ["cookedMeat", 3] },
];

export const BUTCHER_OFFERS = [
  { give: [["gel", 2]], get: ["rawMeat", 4] },
  { give: [["bone", 3]], get: ["rawMeat", 6] },
  { give: [["rawMeat", 1]], get: ["cookedMeat", 1] },
  { give: [["silverBar", 1]], get: ["cookedMeat", 10] },
  { give: [["rawMeat", 5]], get: ["trollCoin", 8] },
];

/* Troll Chef: housing-gated (see HOUSE_ROSTER, main.js) -- trades ranch
   products (eggs/omelettes from tamed animals) for crafting reagents,
   giving the taming/breeding loop a reason to sell surplus instead of
   just eating it. */
export const CHEF_OFFERS = [
  { give: [["berry", 10]], get: ["egg", 4] },
  { give: [["egg", 4]], get: ["gel", 3] },
  { give: [["omelette", 2]], get: ["lens", 2] },
  { give: [["rawMeat", 6]], get: ["bone", 3] },
  { give: [["egg", 6]], get: ["trollCoin", 10] },
  { give: [["trollCoin", 15]], get: ["omelette", 2] },
];

/* Village happiness unlock (Phase 3): a village Trader adds this extra
   barter row once ≥2 of their neighbors are happy (ui.js paintShop) --
   pricier than a normal offer since it's a fast-travel network node, not
   a consumable. */
export const PYLON_OFFER = { give: [["goldBar", 10], ["gel", 5]], get: ["pylon", 1] };

/* Starter kit (fresh worlds). */
export const STARTER_ITEMS = [
  { id: "woodPick", n: 1 }, { id: "woodAxe", n: 1 }, { id: "woodSword", n: 1 },
  { id: "torch", n: 10 }, { id: "rope", n: 8 },
];
