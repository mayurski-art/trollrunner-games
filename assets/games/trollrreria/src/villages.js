/* Trollrreria — procedurally sited villages. Reuses the exact same
   house-stamping trick as the hand-placed spawn Town (Game.buildTownHouse
   in main.js), just scattered one per biome band instead of hand-glued
   next to spawn. Kept as its own module since the siting/naming math is
   pure data + functions, no Game state -- Game.spawnVillages() (main.js)
   is what actually calls buildTownHouse and drops NPCs in. */

import { T, W } from "./defs.js";
import { biomeAt } from "./worldgen.js";

/* One village per band. Swamp/forest are left alone: the spawn Town
   already sits in the forest, and Pepe Hermit's swamp lore predates this
   feature (see npc.js). Ocean has no buildable shoreline width to rely on. */
export const VILLAGE_BIOMES = ["snow", "desert", "jungle"];

export const VILLAGE_STYLE = {
  snow: { wallTile: T.POLISHED_STONE, wallBg: W.STONE },
  desert: { wallTile: T.CLAY_BRICK, wallBg: W.STONE },
  jungle: { wallTile: T.WOOD, wallBg: W.WOOD },
};

const NAME_PREFIX = ["Grin", "Kek", "Meme", "Rug", "Gel", "Moon", "Ratio", "Ded", "Ngmi", "Ape", "Wojak", "Diamond"];
const NAME_SUFFIX = ["hollow", "burg", "stead", "dale", "reach", "fen", "ville", "hearth", "gulch", "mire", "shire", "post"];

export function villageName(rng) {
  return NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)] +
    NAME_SUFFIX[Math.floor(rng() * NAME_SUFFIX.length)];
}

/* Picks an x column deep inside the largest contiguous run of `biome`,
   staying clear of the ~25% nearest either edge so the site can't land
   right on the low-frequency biome-border wobble (see biomeAt in
   worldgen.js). Null if that biome doesn't appear at all -- e.g. a
   narrow legacy 1600-wide world clipping a band short. */
export function siteBiomeX(biome, w, rng) {
  const runs = [];
  let start = -1;
  for (let x = 30; x < w - 30; x++) {
    const match = biomeAt(x, w) === biome;
    if (match && start === -1) start = x;
    if (!match && start !== -1) { runs.push([start, x - 1]); start = -1; }
  }
  if (start !== -1) runs.push([start, w - 31]);
  if (!runs.length) return null;
  runs.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  const [lo, hi] = runs[0];
  const pad = Math.round((hi - lo) * 0.25);
  const a = lo + pad, b = hi - pad;
  if (b <= a) return Math.round((lo + hi) / 2);
  return a + Math.floor(rng() * (b - a));
}

/* Flavor loot for the village's public chest -- coins + common reagents,
   nothing rare (the underground chests already own that job). Same
   {id,n} slot shape as worldgen.js's internal lootChest(). */
export function villageLoot(rng) {
  const items = new Array(24).fill(null);
  let slot = 0;
  const add = (id, n) => { if (slot < 24) items[slot++] = { id, n }; };
  add("trollCoin", 8 + Math.floor(rng() * 12));
  if (rng() < 0.7) add("torch", 4 + Math.floor(rng() * 6));
  if (rng() < 0.5) add("seeds", 3 + Math.floor(rng() * 4));
  if (rng() < 0.4) add("berry", 4 + Math.floor(rng() * 6));
  if (rng() < 0.3) add("rope", 4 + Math.floor(rng() * 4));
  return items;
}
