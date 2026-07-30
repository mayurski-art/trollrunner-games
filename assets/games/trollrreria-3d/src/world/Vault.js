import { BLOCKS } from './blocks.js';

const CHAMBER_SIZE = 5;
const CHAMBER_HEIGHT = 4;
const SHAFT_DEPTH_BELOW_SURFACE = 6;
const MIN_DIST_FROM_LANDMARKS = 15;

// A second, deliberately different structure from the Ruins: entirely
// buried, reached by digging/climbing an open 2x2 vertical shaft rather
// than walking in at ground level. No ladder blocks exist in this game, so
// getting back out means placing blocks to climb — a real (if small) extra
// challenge for the better loot inside, not just a reskinned Ruins.
function buildVault(world, cx, cz) {
  const top = world.heightMap.get(`${cx},${cz}`);
  if (top === undefined || top < SHAFT_DEPTH_BELOW_SURFACE + 4) return null;
  const chamberTopY = top - SHAFT_DEPTH_BELOW_SURFACE;
  const chamberBaseY = chamberTopY - CHAMBER_HEIGHT;
  if (chamberBaseY < 2) return null;
  const half = Math.floor(CHAMBER_SIZE / 2);

  // Vertical shaft down from the surface.
  for (let y = chamberTopY; y <= top; y++) {
    world.setBlockRaw(cx, y, cz, BLOCKS.AIR);
    world.setBlockRaw(cx + 1, y, cz, BLOCKS.AIR);
  }

  // Enclosed chamber, stone-brick lined (fully walled, unlike Ruins' open top).
  for (let lx = -half; lx <= half; lx++) {
    for (let lz = -half; lz <= half; lz++) {
      const isEdge = Math.abs(lx) === half || Math.abs(lz) === half;
      for (let y = 0; y <= CHAMBER_HEIGHT; y++) {
        const isFloorOrCeil = y === 0 || y === CHAMBER_HEIGHT;
        if (isEdge || isFloorOrCeil) {
          world.setBlockRaw(cx + lx, chamberBaseY + y, cz + lz, BLOCKS.STONE_BRICK);
        } else {
          world.setBlockRaw(cx + lx, chamberBaseY + y, cz + lz, BLOCKS.AIR);
        }
      }
    }
  }
  // Re-open the shaft opening through the new ceiling.
  world.setBlockRaw(cx, chamberTopY, cz, BLOCKS.AIR);
  world.setBlockRaw(cx + 1, chamberTopY, cz, BLOCKS.AIR);

  world.setBlockRaw(cx - half + 1, chamberBaseY + 1, cz - half + 1, BLOCKS.TORCH);
  world.setBlockRaw(cx + half - 1, chamberBaseY + 1, cz + half - 1, BLOCKS.TORCH);
  world.setBlockRaw(cx - half + 1, chamberBaseY + 1, cz + half - 1, BLOCKS.TORCH);

  const chestPositions = [
    { x: cx - half + 1, y: chamberBaseY + 1, z: cz },
    { x: cx + half - 1, y: chamberBaseY + 1, z: cz },
    { x: cx, y: chamberBaseY + 1, z: cz - half + 1 },
  ];
  for (const pos of chestPositions) world.setBlockRaw(pos.x, pos.y, pos.z, BLOCKS.CHEST);

  return { center: { x: cx + 1, y: chamberBaseY + 1, z: cz }, chestPositions };
}

function fillLoot(world, chestPositions) {
  const loot = chestPositions.map(() => []);
  loot[0].push({ id: BLOCKS.ARCANE_DUST, count: 3 }, { id: BLOCKS.GEMSTONE, count: 6 });
  loot[1].push({ id: BLOCKS.REAPER_SHARD, count: 10 }, { id: BLOCKS.COOKED_MEAT, count: 3 });
  loot[2].push({ id: BLOCKS.TROLL_CROWN, count: 1 });
  chestPositions.forEach((pos, i) => {
    const slots = world.getChest(pos.x, pos.y, pos.z);
    loot[i].forEach((item, slotIndex) => { slots[slotIndex] = item; });
  });
}

export function placeVault(world, worldSizeX, worldSizeZ, avoidPositions = []) {
  const cx = Math.floor(worldSizeX / 2);
  const cz = Math.floor(worldSizeZ / 2);
  const offsets = [
    [8, -22], [-8, 22], [22, 8], [-22, -8], [26, -2],
    [0, -14], [-14, 0], [0, 14], [14, 0], [-10, -10], [10, -10], [-10, 10], [10, 10],
    [4, -6], [-4, 6], [6, 4], [-6, -4],
  ];
  const avoid = avoidPositions.filter(Boolean);

  for (const [ox, oz] of offsets) {
    const centerX = cx + ox, centerZ = cz + oz;
    if (avoid.some((p) => Math.hypot(centerX - p.x, centerZ - p.z) < MIN_DIST_FROM_LANDMARKS)) continue;
    const result = buildVault(world, centerX, centerZ);
    if (result) {
      fillLoot(world, result.chestPositions);
      return result.center;
    }
  }
  return null;
}
