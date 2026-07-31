import { BLOCKS } from './blocks.js';

const RUIN_SIZE = 7;
const RUIN_HEIGHT = 4;
const MIN_DIST_FROM_VILLAGE = 20;

// A one-time explorable "ruins" structure: a roofless stone-brick chamber
// (reads as decayed, unlike the village's intact plank huts) with two
// loot chests and a couple of guardian mobs — see Game.spawnRuinsGuardians.
// Chest contents are set directly here at generation time, not via
// World.getChest's empty-array default.
function buildChamber(world, cx, cz) {
  const top = world.heightMap.get(`${cx},${cz}`);
  if (top === undefined || top < 3) return null;
  const baseY = top + 1;
  const half = Math.floor(RUIN_SIZE / 2);

  for (let lx = -half; lx <= half; lx++) {
    for (let lz = -half; lz <= half; lz++) {
      const isEdge = Math.abs(lx) === half || Math.abs(lz) === half;
      if (!isEdge) continue;
      const isDoor = lz === half && lx === 0;
      // Uneven, partially-collapsed wall height for a ruined look.
      const wallHeight = RUIN_HEIGHT - (Math.abs(lx + lz) % 2);
      for (let y = 0; y < wallHeight; y++) {
        if (isDoor && y < 2) continue;
        world.setBlockRaw(cx + lx, baseY + y, cz + lz, BLOCKS.STONE_BRICK);
      }
    }
  }
  world.setBlockRaw(cx - half + 1, baseY + 1, cz - half + 1, BLOCKS.TORCH);
  world.setBlockRaw(cx + half - 1, baseY + 1, cz + half - 1, BLOCKS.TORCH);

  const chestPositions = [
    { x: cx - half + 2, y: baseY, z: cz - half + 2 },
    { x: cx + half - 2, y: baseY, z: cz + half - 2 },
  ];
  for (const pos of chestPositions) {
    world.setBlockRaw(pos.x, pos.y, pos.z, BLOCKS.CHEST);
  }
  return { center: { x: cx + 0.5, y: baseY, z: cz + 0.5 }, chestPositions };
}

function fillLoot(world, chestPositions) {
  const [chestA, chestB] = chestPositions;
  const lootA = world.getChest(chestA.x, chestA.y, chestA.z);
  lootA[0] = { id: BLOCKS.GEMSTONE, count: 8 };
  lootA[1] = { id: BLOCKS.REAPER_SHARD, count: 6 };
  lootA[2] = { id: BLOCKS.BREAD, count: 4 };

  const lootB = world.getChest(chestB.x, chestB.y, chestB.z);
  lootB[0] = { id: BLOCKS.REAPER_SWORD, count: 1 };
  lootB[1] = { id: BLOCKS.STONE_ARMOR, count: 1 };
}

// Fixed absolute offsets around the home region's origin (see Village.js —
// same reasoning: the world is unbounded now, nothing left to scale against).

// Placed far enough from both settlements that all three landmarks read as
// separate points of interest rather than crowding one corner of the island.
export function placeDungeon(world, originX, originZ, avoidPositions = []) {
  const cx = originX;
  const cz = originZ;
  const minDist = MIN_DIST_FROM_VILLAGE;
  const offsets = [[-16, -16], [16, 16], [-18, 12], [18, -12], [0, -20]];
  const avoid = avoidPositions.filter(Boolean);

  for (const [ox, oz] of offsets) {
    const centerX = cx + ox, centerZ = cz + oz;
    if (avoid.some((p) => Math.hypot(centerX - p.x, centerZ - p.z) < minDist)) continue;
    const result = buildChamber(world, centerX, centerZ);
    if (result) {
      fillLoot(world, result.chestPositions);
      return result.center;
    }
  }
  return null;
}
