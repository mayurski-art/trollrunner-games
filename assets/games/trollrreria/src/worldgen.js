/* Trollrreria — procedural world generation.
   Layout (y grows downward, world 1600x800):
     ~0-230   sky
     ~230-300 surface terrain (biomes: snow | forest | desert by x)
     ~300-650 stone underground with caves + ores
     ~650-780 deep zone: more gold, lava pools, obsidian
     ~780+    trollrock (unbreakable floor)                                */

import { T, W, WORLD_W, WORLD_H } from "./defs.js";
import { World } from "./world.js";
import { mulberry32, hash2, octave1, octave2, clamp } from "./util.js";

export const SURFACE_BASE = 260;
export const STONE_START = 310;
export const DEEP_START = 650;
export const BEDROCK_START = WORLD_H - 14;

export function biomeAt(x, w) {
  /* ocean at both map edges, then snow | forest (Meme Meadow / spawn,
     centered) | jungle | Pepe Swamp | desert. Spawn sits at w/2, well
     inside the forest band so a fresh world never starts in the swamp.
     Borders get a smooth low-frequency wobble (seedless, so render/
     spawn/gen all agree) so biome edges wander over ~±15 tiles instead
     of falling on a razor-straight vertical line. */
  const f = x / w;
  const wob = (octave1(x, 424242, 1 / 40, 2) - 0.5) * 0.02;
  const g = f + wob;
  if (g < 0.05) return "ocean";
  if (g < 0.18) return "snow";
  if (g < 0.55) return "forest";
  if (g < 0.68) return "jungle";
  if (g < 0.82) return "swamp";
  if (g < 0.95) return "desert";
  return "ocean";
}

/* Player-facing zone names for the area-title popup. forest + swamp are
   confirmed per the expansion doc; snow/desert keep generic placeholder
   names until their own biome passes give them real meme identities. */
export const BIOME_NAMES = {
  forest: "Meme Meadow",
  swamp: "Pepe Swamp",
  snow: "Frostbite Reach",
  desert: "Sunbaked Wastes",
  jungle: "Kek Jungle",
  ocean: "The Normie Sea",
  moonMines: "Doge Moon Mines",
  deepweb: "The Deep Web",
};

/* Depth-layered zone at a tile position: the mid-depth stone band reads
   as the Doge Moon Mines, the deepest band as The Deep Web, regardless of
   which surface biome is overhead -- same way real caves don't care what's
   growing up top. Falls back to the surface biome above both bands. */
export function zoneAt(tx, ty, w) {
  if (ty >= DEEP_START) return "deepweb";
  if (ty >= STONE_START) return "moonMines";
  return biomeAt(tx, w);
}

export function generateWorld(seed, width = WORLD_W) {
  const world = new World(width, WORLD_H);
  const rng = mulberry32(seed);
  const w = world.w, h = world.h;
  const tiles = world.tiles;
  const walls = world.walls;
  const spawnX = Math.floor(w / 2);
  /* absolute feature counts below were tuned on a 1600-wide world --
     scale them with width so density (ore per screen, cave frequency)
     stays constant instead of thinning out as the world grows */
  const SC = w / 1600;
  const sc = n => Math.round(n * SC);

  /* ------------------------------------------------ 1. surface heightmap */
  const surface = new Int16Array(w);
  for (let x = 0; x < w; x++) {
    const n = octave1(x, seed, 1 / 90, 4);         // rolling hills
    const n2 = octave1(x, seed + 999, 1 / 22, 2);  // small bumps
    let y = SURFACE_BASE + (n - 0.5) * 90 + (n2 - 0.5) * 10;
    /* flatten the spawn area in the middle of the forest */
    const mid = w / 2, flat = clamp(1 - Math.abs(x - mid) / 60, 0, 1);
    y = y * (1 - flat * 0.7) + SURFACE_BASE * flat * 0.7;
    /* ocean basins: sink the terrain toward the sea floor at both map
       edges so fillOceans() has an actual bowl to pour water into */
    const edgeF = Math.min(x, w - 1 - x) / w;
    if (edgeF < 0.06) y += (1 - edgeF / 0.06) * 34;
    surface[x] = Math.round(y);
  }

  /* ------------------------------------------------ 2. base strata + walls */
  for (let x = 0; x < w; x++) {
    const biome = biomeAt(x, w);
    const sy = surface[x];
    const dirtDepth = 24 + Math.round(octave1(x, seed + 5, 1 / 30, 2) * 22);
    const stoneY = Math.max(sy + 6, STONE_START + Math.round((octave1(x, seed + 7, 1 / 60, 2) - 0.5) * 30));
    for (let y = sy; y < h; y++) {
      const i = y * w + x;
      if (y >= BEDROCK_START) { tiles[i] = T.BEDROCK; continue; }
      let t;
      if (y < sy + dirtDepth && y < stoneY) {
        t = biome === "desert" || biome === "ocean" ? T.SAND
          : biome === "snow" ? T.SNOW
          : biome === "swamp" || biome === "jungle" ? T.MUD : T.DIRT;
        /* snow biome gets an ice shelf under the snow */
        if (biome === "snow" && y > sy + 8) t = T.ICE;
      } else {
        t = T.STONE;
        /* dirt pockets inside stone */
        if (octave2(x, y, seed + 11, 1 / 26, 2) > 0.72) t = T.DIRT;
      }
      tiles[i] = t;
      /* natural background walls start a few tiles under the surface */
      if (y > sy + 3) walls[i] = y < stoneY + 6 ? W.DIRT : W.STONE;
    }
  }

  /* ------------------------------------------------ 3. caves */
  /* 3a. worm tunnels */
  const wormCount = sc(230);
  for (let n = 0; n < wormCount; n++) {
    let x = rng() * w;
    let y = STONE_START - 40 + rng() * (BEDROCK_START - STONE_START);
    let dir = rng() * Math.PI * 2;
    const len = 40 + rng() * 160;
    const rBase = 1.6 + rng() * 2.2;
    for (let s = 0; s < len; s++) {
      dir += (rng() - 0.5) * 0.8;
      /* bias tunnels to stay underground */
      if (y < surface[clamp(Math.round(x), 0, w - 1)] + 12) dir = Math.abs(dir) < Math.PI / 2 ? dir + 0.3 : dir - 0.3;
      x += Math.cos(dir) * 1.6;
      y += Math.sin(dir) * 1.2;
      const r = rBase * (0.7 + rng() * 0.6);
      carve(world, Math.round(x), Math.round(y), r);
      if (x < 2 || x > w - 3 || y > BEDROCK_START - 2 || y < 40) break;
    }
  }
  /* 3b. blobby noise caves, denser with depth -- tightened vs. the original
     0.76-0.66 range so shallow caves read less like Swiss cheese for players
     still learning the game; deep caves stay close to as dangerous. */
  for (let y = STONE_START; y < BEDROCK_START; y++) {
    const depthFrac = (y - STONE_START) / (BEDROCK_START - STONE_START);
    const thr = 0.80 - depthFrac * 0.08;
    for (let x = 1; x < w - 1; x++) {
      if (octave2(x, y, seed + 23, 1 / 14, 3) > thr) {
        tiles[y * w + x] = T.AIR;
      }
    }
  }
  /* 3c. (removed) used to punch a few surface cave mouths down into the
     worm-tunnel network. The surface is now kept unbroken -- every player
     digs their own way down instead of finding a pre-cut hole, so there's
     no free entrance straight into the dark. */

  /* ------------------------------------------------ 3d. Rage Comic Ruins
     A single hand-shaped room (not proc-noise like the caves above) so it
     reads as a built structure: stone-brick perimeter, background wall,
     a few loot chests. Carved AFTER the cave passes so tunnel noise can't
     eat into its walls. Anchored under the swamp/desert boundary. */
  const ruinsBounds = carveRuins(world, rng, w);

  /* ------------------------------------------------ 3e. Whale Vault
     Sealed with a VAULT_DOOR that only opens for a Whale Key (Quest 5).
     Deep, near the world's edge -- the game's actual late-game corner. */
  const vaultBounds = carveVault(world, rng, w);

  /* ------------------------------------------------ 3f. Frostbite Bunker
     A frozen hand-shaped room under the snow biome (the one starting zone
     without its own underground structure) -- ice-walled, silver-heavy
     loot, the first real reason to dig deep under the snow instead of
     just passing through it on the surface. */
  const bunkerBounds = carveBunker(world, rng, w);

  /* 3g. seal the crust: belt-and-suspenders on top of removing the surface
     cave mouths above -- if a worm tunnel's downward drift ever happened
     to breach close to the surface, re-solidify a shallow band right below
     ground level so there is never a free hole into the dark. Players dig
     their own way down. */
  const CRUST = 5;
  for (let x = 0; x < w; x++) {
    const biome = biomeAt(x, w);
    const sy = surface[x];
    const fill = biome === "desert" || biome === "ocean" ? T.SAND
      : biome === "snow" ? T.SNOW
      : biome === "swamp" || biome === "jungle" ? T.MUD : T.DIRT;
    for (let y = sy; y < sy + CRUST; y++) {
      const i = y * w + x;
      if (tiles[i] === T.AIR) tiles[i] = fill;
    }
  }

  /* ------------------------------------------------ 4. ores */
  scatterOre(world, rng, T.COPPER, sc(950), STONE_START - 30, 560, 4, 9);
  scatterOre(world, rng, T.IRON, sc(700), 380, DEEP_START, 4, 8);
  scatterOre(world, rng, T.SILVER, sc(460), 480, BEDROCK_START - 20, 3, 7);
  scatterOre(world, rng, T.GOLD, sc(320), DEEP_START - 60, BEDROCK_START - 10, 3, 6);
  /* Doge Moon Mines -- the mid-depth stone band (STONE_START..DEEP_START),
     reframed with its own glowing ore rather than a whole new x-restricted
     zone, since the depth tier already has the right shape (dangerous,
     cave-dwelling enemies, worth digging toward). */
  scatterOre(world, rng, T.MOONROCK, sc(520), STONE_START + 10, DEEP_START, 3, 7);

  /* unstable debris in the Moon Mines: sits flush in a cave wall (so it's
     discoverable, like ore) but falls the moment whatever's under it gets
     mined out -- world.set()'s wake-on-edit already handles that once
     it's tagged fallable, nothing bespoke needed here. */
  let debris = 0, dguard = 0;
  const debrisMax = sc(140), dguardMax = sc(6000);
  while (debris < debrisMax && dguard++ < dguardMax) {
    const x = 4 + Math.floor(rng() * (w - 8));
    const y = STONE_START + 20 + Math.floor(rng() * (DEEP_START - STONE_START - 30));
    const i = y * w + x;
    const exposed = world.tiles[i - 1] === T.AIR || world.tiles[i + 1] === T.AIR || world.tiles[i - w] === T.AIR;
    if (world.tiles[i] === T.STONE && exposed) {
      world.tiles[i] = T.MOON_DEBRIS;
      debris++;
    }
  }

  /* ------------------------------------------------ 5. lava + obsidian deep down */
  for (let n = 0; n < sc(60); n++) {
    const x = 20 + Math.floor(rng() * (w - 40));
    const y = DEEP_START + Math.floor(rng() * (BEDROCK_START - DEEP_START - 20));
    poolLiquid(world, x, y, 3 + Math.floor(rng() * 6), 1);
  }
  /* 5b. a scatter of smaller, shallower pockets starting partway into the
     stone band (not just the deep zone) -- gives mid-depth mining some
     natural light and hazard before the player has proper gear, matching
     how Minecraft players run into lava well before full depth. */
  for (let n = 0; n < sc(22); n++) {
    const x = 20 + Math.floor(rng() * (w - 40));
    const y = STONE_START + 100 + Math.floor(rng() * Math.max(1, DEEP_START - STONE_START - 110));
    poolLiquid(world, x, y, 2 + Math.floor(rng() * 3), 1);
  }

  /* 5c. break up any tall open shaft left by the worm/blobby/lava passes
     above -- run last (after every AIR-carving step) so it catches lava
     pool cavities too, but skip the Ruins/Vault interiors since those are
     built rooms, not organic hazards. */
  plugLongDrops(world, [ruinsBounds, vaultBounds, bunkerBounds]);

  /* ------------------------------------------------ 6. surface water pools */
  fillSurfaceWater(world, surface);
  fillOceans(world, surface);

  /* ------------------------------------------------ 7. troll hearts + glowshrooms */
  let hearts = 0;
  const heartMax = sc(26);
  while (hearts < heartMax) {
    const x = 20 + Math.floor(rng() * (w - 40));
    const y = STONE_START + 30 + Math.floor(rng() * (BEDROCK_START - STONE_START - 60));
    const i = y * w + x;
    if (tiles[i] === T.STONE && tiles[i - w] === T.AIR) { tiles[i] = T.HEART; hearts++; }
  }
  /* glowshrooms grow in small patches (like real mushroom clusters) rather
     than uniform single-tile scatter, so the underground has real pockets
     of natural light instead of one dim tile every so often. */
  for (let n = 0; n < sc(130); n++) {
    const cx = 10 + Math.floor(rng() * (w - 20));
    const cy = STONE_START + Math.floor(rng() * (BEDROCK_START - STONE_START - 10));
    const clusterSize = 3 + Math.floor(rng() * 5);
    for (let k = 0; k < clusterSize; k++) {
      const x = clamp(cx + Math.floor((rng() - 0.5) * 8), 10, w - 11);
      const y = clamp(cy + Math.floor((rng() - 0.5) * 3), STONE_START, BEDROCK_START - 2);
      const i = y * w + x;
      if (tiles[i] === T.AIR && (tiles[i + w] === T.DIRT || tiles[i + w] === T.STONE)) {
        tiles[i] = T.SHROOM;
      }
    }
  }

  /* ------------------------------------------------ 8. trees + surface plants */
  let lastTree = -10;
  let lastGrin = -30;
  for (let x = 8; x < w - 8; x++) {
    if (biomeAt(x, w) !== "forest") continue;
    const sy = surface[x];
    if (tiles[sy * w + x] !== T.DIRT) continue;
    if (tiles[(sy - 1) * w + x] !== T.AIR) continue;
    if (x - lastTree >= 4 && hash2(x, 77, seed) < 0.24) {
      const th = 7 + Math.floor(hash2(x, 78, seed) * 8);
      if (sy - th < 4) continue;
      for (let ty = sy - 1; ty > sy - 1 - th; ty--) tiles[ty * w + x] = T.TREE;
      world.trees.push({ x, yBase: sy - 1, h: th, seed: (seed + x) >>> 0 });
      lastTree = x;
    } else if (hash2(x, 79, seed) < 0.3) {
      tiles[(sy - 1) * w + x] = T.PLANT;
    } else if (x - lastGrin >= 26 && hash2(x, 81, seed) < 0.12) {
      /* Grin Core relic fragments -- Meme Meadow starter quest bait,
         scattered generously (well over the 5 needed) so nobody has to
         comb the whole starting zone for the last one */
      tiles[(sy - 1) * w + x] = T.GRIN_FRAG;
      lastGrin = x;
    }
  }

  /* ------------------------------------------------ 8a2. jungle canopy
     Denser and taller than the forest's -- the Kek Jungle should read as
     thick the moment you walk in. Grows on mud, same tree machinery. */
  let lastJTree = -10;
  for (let x = 8; x < w - 8; x++) {
    if (biomeAt(x, w) !== "jungle") continue;
    const sy = surface[x];
    if (tiles[sy * w + x] !== T.MUD) continue;
    if (tiles[(sy - 1) * w + x] !== T.AIR) continue;
    if (x - lastJTree >= 3 && hash2(x, 87, seed) < 0.34) {
      const th = 9 + Math.floor(hash2(x, 88, seed) * 9);
      if (sy - th < 4) continue;
      for (let ty = sy - 1; ty > sy - 1 - th; ty--) tiles[ty * w + x] = T.TREE;
      world.trees.push({ x, yBase: sy - 1, h: th, seed: (seed + x) >>> 0 });
      lastJTree = x;
    } else if (hash2(x, 89, seed) < 0.42) {
      tiles[(sy - 1) * w + x] = T.PLANT;
    }
  }

  /* ------------------------------------------------ 8b. swamp scrolls */
  let lastScroll = -30;
  for (let x = 8; x < w - 8; x++) {
    if (biomeAt(x, w) !== "swamp") continue;
    const sy = surface[x];
    if (tiles[sy * w + x] !== T.MUD) continue;
    if (tiles[(sy - 1) * w + x] !== T.AIR) continue;
    if (x - lastScroll >= 22 && hash2(x, 83, seed) < 0.16) {
      tiles[(sy - 1) * w + x] = T.PEPE_SCROLL;
      lastScroll = x;
    }
  }

  /* ------------------------------------------------ 8b2. the Grin Core altar
     A few tiles from spawn (opposite the rocket ground pad) -- the finale
     turn-in point for Quest 6, always reachable from the very first
     minute of a new world. */
  {
    const ax = spawnX + 6;
    const ay = surface[ax] - 1;
    tiles[ay * w + ax] = T.GRIN_ALTAR;
  }

  /* ------------------------------------------------ 8c. Rocketyard parts */
  let lastPart = -30;
  for (let x = 8; x < w - 8; x++) {
    if (biomeAt(x, w) !== "desert") continue;
    const sy = surface[x];
    if (tiles[sy * w + x] !== T.SAND) continue;
    if (tiles[(sy - 1) * w + x] !== T.AIR) continue;
    if (x - lastPart >= 24 && hash2(x, 85, seed) < 0.15) {
      tiles[(sy - 1) * w + x] = T.ROCKET_PART;
      lastPart = x;
    }
  }

  /* ------------------------------------------------ 9. underground loot chests */
  let placedChests = 0, guard = 0;
  const chestMax = sc(22), chestGuardMax = sc(4000);
  while (placedChests < chestMax && guard++ < chestGuardMax) {
    const x = 20 + Math.floor(rng() * (w - 40));
    const y = STONE_START + Math.floor(rng() * (BEDROCK_START - STONE_START - 30));
    const i = y * w + x;
    if (tiles[i] === T.AIR && world.liquid[i] === 0 &&
        tiles[i + w] !== T.AIR && tiles[i + w] !== T.TREE && tiles[i + w] !== T.SHROOM) {
      tiles[i] = T.CHEST;
      world.addChest(x, y, lootChest(rng, y > DEEP_START));
      placedChests++;
    }
  }

  /* ------------------------------------------------ 10. sky islands + pads
     One guaranteed island above spawn (the rocket pad's arrival point --
     built before rebuildTopSolid so its platform counts as solid ground)
     plus a scatter of unguaranteed ones with loot, for verticality. */
  const skyPad = buildSkyIslands(world, rng, w, surface, spawnX);

  world.rebuildTopSolid();

  const spawn = { x: spawnX, y: surface[spawnX] - 1 };
  return {
    world, spawn, surface, skyPad, ruinsBounds,
    groundPad: { x: spawnX - 6, y: surface[spawnX - 6] - 1 },
  };
}

function carve(world, cx, cy, r) {
  const w = world.w;
  const ri = Math.ceil(r);
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 1 || y < 1 || x >= w - 1 || y >= BEDROCK_START) continue;
      world.tiles[y * w + x] = T.AIR;
    }
  }
}

/* Interrupt any vertical air run longer than maxDrop tiles with a short
   stone shelf every ~9 tiles, so mining/exploring straight down (or
   stumbling into a lava pool's open cavity) can't open into a blind
   multi-cavern freefall. Column-local (not a full connected-component
   flood fill) because the thing we're actually fixing is fall distance,
   which is a per-column measure -- a shelf a player can catch themselves
   on. Widened a tile either side so it reads as a ledge rather than a
   single floating block. `exclude` skips built rooms (Ruins/Vault) so
   their intentional open interiors are never touched. */
function plugLongDrops(world, exclude) {
  const w = world.w, tiles = world.tiles;
  const maxDrop = 9;
  const regions = (exclude || []).filter(Boolean);
  const inExcluded = (x, y) => regions.some(r =>
    x >= r.x - 1 && x <= r.x + r.w + 1 && y >= r.y - 1 && y <= r.y + r.h + 1);
  for (let x = 2; x < w - 2; x++) {
    let runStart = -1;
    for (let y = STONE_START; y < BEDROCK_START; y++) {
      if (inExcluded(x, y)) { runStart = -1; continue; }
      const i = y * w + x;
      if (tiles[i] === T.AIR) {
        if (runStart === -1) runStart = y;
        if (y - runStart + 1 >= maxDrop) {
          for (const dx of [-1, 0, 1]) {
            const j = i + dx;
            if (tiles[j] === T.AIR) { tiles[j] = T.STONE; world.setLiquid(x + dx, y, 0); }
          }
          runStart = -1;
        }
      } else {
        runStart = -1;
      }
    }
  }
}

/* A single hand-shaped underground room: stone-brick perimeter, wired
   background walls, three loot chests. Anchored just under the swamp,
   spanning into the desert-side stone so it never needs the swamp's own
   surface tiles to exist. */
function carveRuins(world, rng, w) {
  const bandX0 = Math.floor(w * 0.60), bandX1 = Math.floor(w * 0.80);
  const rw = 26, rh = 13;
  const x0 = bandX0 + Math.floor(rng() * Math.max(1, bandX1 - bandX0 - rw));
  const y0 = STONE_START + 50 + Math.floor(rng() * 50);
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      const edge = x === x0 || x === x0 + rw - 1 || y === y0 || y === y0 + rh - 1;
      world.tiles[y * w + x] = edge ? T.STONE_BRICK : T.AIR;
    }
  }
  for (let y = y0 + 1; y < y0 + rh - 1; y++) {
    for (let x = x0 + 1; x < x0 + rw - 1; x++) world.walls[y * w + x] = W.STONE_BRICK;
  }
  for (let k = 0; k < 3; k++) {
    const cx = x0 + 3 + Math.floor(rng() * (rw - 6));
    const cy = y0 + rh - 2;
    const i = cy * w + cx;
    if (world.tiles[i] === T.AIR) {
      world.tiles[i] = T.CHEST;
      world.addChest(cx, cy, ruinsLootChest(rng));
    }
  }
  return { x: x0, y: y0, w: rw, h: rh };
}

/* The Whale Vault: same hand-shaped-room trick as the Ruins, but sealed --
   one wall tile is a VAULT_DOOR instead of stone brick, and it only opens
   for someone holding a Whale Key (see Game.useVaultDoor). Anchored deep
   and far out near the map edge, past the desert, so reaching it is its
   own late-game trek. */
function carveVault(world, rng, w) {
  const rw = 22, rh = 12;
  const x0 = w - 60 - Math.floor(rng() * 20);
  const y0 = BEDROCK_START - 40 - rh;
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      const edge = x === x0 || x === x0 + rw - 1 || y === y0 || y === y0 + rh - 1;
      world.tiles[y * w + x] = edge ? T.STONE_BRICK : T.AIR;
    }
  }
  for (let y = y0 + 1; y < y0 + rh - 1; y++) {
    for (let x = x0 + 1; x < x0 + rw - 1; x++) world.walls[y * w + x] = W.STONE_BRICK;
  }
  /* the door sits in the left wall, mid-height */
  world.tiles[(y0 + Math.floor(rh / 2)) * w + x0] = T.VAULT_DOOR;
  for (let k = 0; k < 4; k++) {
    const cx = x0 + 3 + Math.floor(rng() * (rw - 6));
    const cy = y0 + rh - 2;
    const i = cy * w + cx;
    if (world.tiles[i] === T.AIR) {
      world.tiles[i] = T.CHEST;
      world.addChest(cx, cy, vaultLootChest(rng));
    }
  }
  return { x: x0, y: y0, w: rw, h: rh };
}

/* Frostbite Bunker: same hand-shaped-room trick again, but iced over and
   anchored under the snow biome (x fraction < 0.18) -- the one starting
   zone that had a surface identity (Frostbite Reach) but no underground
   structure of its own. Silver-heavy loot gives the new silver armor
   tier somewhere to actually drop from. */
function carveBunker(world, rng, w) {
  /* band starts past the ocean edge (biome band 0-0.05) so the bunker
     always sits under snow proper, not under the Normie Sea */
  const bandX0 = Math.floor(w * 0.07), bandX1 = Math.floor(w * 0.16);
  const rw = 22, rh = 11;
  const x0 = bandX0 + Math.floor(rng() * Math.max(1, bandX1 - rw - bandX0));
  const y0 = STONE_START + 30 + Math.floor(rng() * 60);
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      const edge = x === x0 || x === x0 + rw - 1 || y === y0 || y === y0 + rh - 1;
      world.tiles[y * w + x] = edge ? T.ICE : T.AIR;
    }
  }
  for (let y = y0 + 1; y < y0 + rh - 1; y++) {
    for (let x = x0 + 1; x < x0 + rw - 1; x++) world.walls[y * w + x] = W.STONE_BRICK;
  }
  for (let k = 0; k < 3; k++) {
    const cx = x0 + 3 + Math.floor(rng() * (rw - 6));
    const cy = y0 + rh - 2;
    const i = cy * w + cx;
    if (world.tiles[i] === T.AIR) {
      world.tiles[i] = T.CHEST;
      world.addChest(cx, cy, bunkerLootChest(rng));
    }
  }
  return { x: x0, y: y0, w: rw, h: rh };
}

function bunkerLootChest(rng) {
  const items = new Array(24).fill(null);
  let slot = 0;
  const add = (id, n) => { if (slot < 24) items[slot++] = { id, n }; };
  add("silverBar", 8 + Math.floor(rng() * 10));
  if (rng() < 0.6) add("silverSword", 1);
  if (rng() < 0.5) add("silverChest", 1);
  add("torch", 4 + Math.floor(rng() * 6));
  if (rng() < 0.4) add("trollBrew", 1 + Math.floor(rng() * 2));
  return items;
}

function vaultLootChest(rng) {
  const items = new Array(24).fill(null);
  let slot = 0;
  const add = (id, n) => { if (slot < 24) items[slot++] = { id, n }; };
  add("trolliumBar", 6 + Math.floor(rng() * 8));
  add("goldBar", 8 + Math.floor(rng() * 10));
  if (rng() < 0.6) add("trolliumSword", 1);
  if (rng() < 0.5) add("trolliumChest", 1);
  add("trollBrew", 2 + Math.floor(rng() * 3));
  return items;
}

function ruinsLootChest(rng) {
  const items = lootChest(rng, true);
  if (rng() < 0.5) {
    const slot = items.findIndex(s => !s);
    if (slot >= 0) items[slot] = { id: "pepeScroll", n: 1 };
  }
  return items;
}

/* Sky islands: small floating stone-brick platforms in the open air above
   the surface. One is guaranteed directly above spawn and carries the
   sky-side rocket pad (Quest 4's fast-travel reward); the ground-side pad
   sits a few tiles from spawn. Everything else is unguaranteed loot bait.
   Returns the sky pad's {x, y} (tile coords, y = the walkable surface). */
function buildSkyIslands(world, rng, w, surface, spawnX) {
  const islandY = 90;
  placeIsland(world, rng, spawnX - 3, islandY, 7, false); // pad goes here instead of a chest
  const skyPadY = islandY - 1;
  world.tiles[skyPadY * w + spawnX] = T.ROCKET_PAD;

  const gx = spawnX - 6;
  const gy = surface[gx] - 1;
  world.tiles[gy * w + gx] = T.ROCKET_PAD;

  let placed = 0, guard = 0;
  const islandMax = Math.round(10 * (w / 1600));
  while (placed < islandMax && guard++ < 400) {
    const ix = 30 + Math.floor(rng() * (w - 60));
    if (Math.abs(ix - spawnX) < 40) continue;
    const iy = 50 + Math.floor(rng() * 110);
    placeIsland(world, rng, ix, iy, 5 + Math.floor(rng() * 4), rng() < 0.6);
    placed++;
  }
  return { x: spawnX, y: skyPadY };
}

function placeIsland(world, rng, x0, y0, iw, withChest) {
  const w = world.w;
  for (let x = x0; x < x0 + iw; x++) {
    if (x < 1 || x >= w - 1) continue;
    world.tiles[y0 * w + x] = T.STONE_BRICK;
    world.walls[y0 * w + x] = W.STONE_BRICK;
  }
  if (withChest) {
    const cx = x0 + Math.floor(iw / 2);
    const i = (y0 - 1) * w + cx;
    world.tiles[i] = T.CHEST;
    world.addChest(cx, y0 - 1, lootChest(rng, true));
  }
}

function scatterOre(world, rng, ore, veins, yMin, yMax, minSize, maxSize) {
  const w = world.w;
  for (let v = 0; v < veins; v++) {
    let x = Math.floor(rng() * w);
    let y = yMin + Math.floor(rng() * Math.max(1, yMax - yMin));
    const size = minSize + Math.floor(rng() * (maxSize - minSize + 1));
    for (let s = 0; s < size; s++) {
      if (x >= 1 && x < w - 1 && y >= 1 && y < BEDROCK_START) {
        const i = y * w + x;
        if (world.tiles[i] === T.STONE) world.tiles[i] = ore;
      }
      x += Math.floor(rng() * 3) - 1;
      y += Math.floor(rng() * 3) - 1;
    }
  }
}

function poolLiquid(world, cx, cy, r, type) {
  const w = world.w;
  for (let dy = 0; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 1 || y < 1 || x >= w - 1 || y >= BEDROCK_START) continue;
      const i = y * w + x;
      world.tiles[i] = T.AIR;
      world.liquid[i] = 8;
      world.liquidType[i] = type;
      world.liquidActive.add(i);
      /* lava pools get obsidian shells underneath */
      if (type === 1 && dy === r) {
        const bi = (y + 1) * w + x;
        if (world.tiles[bi] === T.STONE) world.tiles[bi] = T.OBSIDIAN;
      }
    }
  }
}

/* Fill surface depressions with water: scan local minima, flood sideways.
   Puddles in the swamp are toxic sludge (liquidType 2) instead of water --
   same flow sim (only lava, type 1, gets special-cased), just a different
   color and a poison tick on the player instead of buoyancy-only. */
function fillSurfaceWater(world, surface) {
  const w = world.w;
  for (let x = 2; x < w - 2; x++) {
    const sy = surface[x];
    /* a dip: both sides higher ground (smaller y = higher) */
    if (surface[x - 1] < sy - 2 && findRightWall(surface, x, w)) {
      const level = Math.min(surface[x - 1], findRightWall(surface, x, w)) + 1;
      const liquidType = biomeAt(x, w) === "swamp" ? 2 : 0;
      for (let y = level; y <= sy; y++) {
        for (let fx = x; fx < w - 2 && surface[fx] >= y; fx++) {
          const i = y * w + fx;
          if (world.tiles[i] === T.AIR && y >= level) {
            world.liquid[i] = 8;
            world.liquidType[i] = liquidType;
            world.liquidActive.add(i);
          }
        }
      }
    }
  }
}

/* Oceans: fillSurfaceWater's dip detector needs higher ground on the
   LEFT of a depression, which an edge basin sloping toward the map
   boundary never has -- so the two ocean bands get filled explicitly,
   down from a fixed sea level to whatever floor the basin carved. */
function fillOceans(world, surface) {
  const w = world.w;
  const seaLevel = SURFACE_BASE + 6;
  for (let x = 1; x < w - 1; x++) {
    if (biomeAt(x, w) !== "ocean") continue;
    for (let y = seaLevel; y < surface[x]; y++) {
      const i = y * w + x;
      if (world.tiles[i] === T.AIR) {
        world.liquid[i] = 8;
        world.liquidType[i] = 0;
        world.liquidActive.add(i);
      }
    }
  }
}

function findRightWall(surface, x, w) {
  const sy = surface[x];
  for (let fx = x + 1; fx < Math.min(w - 1, x + 60); fx++) {
    if (surface[fx] < sy - 2) return surface[fx];
  }
  return 0;
}

function lootChest(rng, deep) {
  const items = new Array(24).fill(null);
  let slot = 0;
  const add = (id, n) => { if (slot < 24) items[slot++] = { id, n }; };
  add("torch", 4 + Math.floor(rng() * 8));
  if (rng() < 0.7) add("arrow", 10 + Math.floor(rng() * 20));
  if (rng() < 0.6) add("trollBrew", 1 + Math.floor(rng() * 2));
  if (rng() < 0.5) add(deep ? "goldBar" : "ironBar", 2 + Math.floor(rng() * 4));
  if (rng() < 0.4) add(deep ? "silverBar" : "copperBar", 3 + Math.floor(rng() * 5));
  if (deep && rng() < 0.25) add("flameArrow", 15 + Math.floor(rng() * 15));
  if (rng() < 0.3) add("gel", 3 + Math.floor(rng() * 6));
  return items;
}
