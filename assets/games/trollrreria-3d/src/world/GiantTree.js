import { BLOCKS } from './blocks.js';

const TRUNK_RADIUS = 2; // 5x5 trunk footprint
const TRUNK_HEIGHT = 14;
const MIN_DIST_FROM_OTHER = 24;

// A landmark-scale tree: a thick trunk with a hollow room carved into its
// base (loot chest + torch, 1-block-thick wood walls all around) and a
// wide layered canopy — a bigger, rarer sibling to the ordinary trees
// World._generateChunkVegetation scatters everywhere, meant to read as a
// "found it" moment rather than background scenery. FOREST-only (see
// World._maybeSpawnRegionSettlement) since a giant tree in a desert or
// snowfield would read as a generation bug, not a landmark.
export function placeGiantTree(world, originX, originZ, avoidPositions = [], offsets = [[0, 0]]) {
  const avoid = avoidPositions.filter(Boolean);
  for (const [ox, oz] of offsets) {
    const cx = Math.round(originX + ox), cz = Math.round(originZ + oz);
    if (avoid.some((p) => Math.hypot(cx - p.x, cz - p.z) < MIN_DIST_FROM_OTHER)) continue;
    const top = world.heightMap.get(`${cx},${cz}`);
    if (top === undefined || top < 3) continue;
    const baseY = top + 1;

    for (let dx = -TRUNK_RADIUS; dx <= TRUNK_RADIUS; dx++) {
      for (let dz = -TRUNK_RADIUS; dz <= TRUNK_RADIUS; dz++) {
        for (let y = 0; y < TRUNK_HEIGHT; y++) {
          world.setBlockRaw(cx + dx, baseY + y, cz + dz, BLOCKS.WOOD);
        }
      }
    }

    // Hollow 3x3 room in the trunk's base (1-block wood wall left all
    // around, since the trunk footprint is 5x5), with a door gap on +z.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let y = 0; y < 3; y++) world.setBlockRaw(cx + dx, baseY + y, cz + dz, BLOCKS.AIR);
      }
    }
    world.setBlockRaw(cx, baseY, cz + 2, BLOCKS.AIR);
    world.setBlockRaw(cx, baseY + 1, cz + 2, BLOCKS.AIR);
    world.setBlockRaw(cx - 1, baseY + 1, cz - 1, BLOCKS.TORCH);
    world.setBlockRaw(cx + 1, baseY, cz - 1, BLOCKS.CHEST);
    const slots = world.getChest(cx + 1, baseY, cz - 1);
    slots[0] = { id: BLOCKS.WHEAT_SEED, count: 4 };
    slots[1] = { id: BLOCKS.GEMSTONE, count: 2 };

    // Wide layered canopy at the top — bigger and taller than a normal tree's.
    const topY = baseY + TRUNK_HEIGHT;
    for (let ly = -2; ly <= 2; ly++) {
      const ringHalf = 4 - Math.abs(ly);
      for (let lx = -ringHalf; lx <= ringHalf; lx++) {
        for (let lz = -ringHalf; lz <= ringHalf; lz++) {
          if (Math.abs(lx) + Math.abs(lz) > ringHalf + 1) continue;
          const bx = cx + lx, by = topY + ly, bz = cz + lz;
          if (world.getBlock(bx, by, bz) === BLOCKS.AIR) world.setBlockRaw(bx, by, bz, BLOCKS.LEAVES);
        }
      }
    }

    return { x: cx + 0.5, y: baseY, z: cz + 0.5 };
  }
  return null;
}
