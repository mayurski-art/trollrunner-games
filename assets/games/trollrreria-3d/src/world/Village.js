import { BLOCKS } from './blocks.js';

const HUT_SIZE = 5; // footprint, walls on the outer ring
const HUT_HEIGHT = 3;

// Builds one simple hut: hollow plank box with a door gap on the +z side
// and a torch inside, anchored to the ground height at its own footprint
// (terrain isn't flattened first, so huts follow the local slope a little
// — reads as rustic rather than perfectly plopped-down).
function placeHut(world, cx, cz) {
  const top = world.heightMap.get(`${cx},${cz}`);
  if (top === undefined || top < 3) return null;
  const baseY = top + 1;
  const half = Math.floor(HUT_SIZE / 2);

  for (let lx = -half; lx <= half; lx++) {
    for (let lz = -half; lz <= half; lz++) {
      const isEdge = Math.abs(lx) === half || Math.abs(lz) === half;
      if (!isEdge) continue;
      const isDoor = lz === half && lx === 0;
      for (let y = 0; y < HUT_HEIGHT; y++) {
        if (isDoor && y < 2) continue; // 2-tall door gap
        world.setBlockRaw(cx + lx, baseY + y, cz + lz, BLOCKS.PLANK);
      }
    }
  }
  // Flat roof.
  for (let lx = -half; lx <= half; lx++) {
    for (let lz = -half; lz <= half; lz++) {
      world.setBlockRaw(cx + lx, baseY + HUT_HEIGHT, cz + lz, BLOCKS.PLANK);
    }
  }
  world.setBlockRaw(cx - half + 1, baseY + 1, cz - half + 1, BLOCKS.TORCH);
  return { x: cx + 0.5, y: baseY, z: cz + 0.5 };
}

const MAIN_OFFSETS = [[10, 10], [-14, 8], [12, -12], [-10, -14], [16, 2]];
const OUTPOST_OFFSETS = [[-16, -6], [16, -16], [-6, 16], [18, 14], [-18, -2]];
const MIN_DIST_FROM_OTHER_VILLAGE = 18;

// Places a hut cluster on flat-ish ground, away from the island edge and
// not right on top of spawn (or another settlement, if avoidPos is given).
// Returns the settlement center (used for the fast-travel waypoint) or
// null if no suitable spot found. hutCount=2 gives the second "outpost"
// settlement a visibly smaller footprint than the 3-hut main village.
export function placeVillage(world, worldSizeX, worldSizeZ, { avoidPos = null, offsets = MAIN_OFFSETS, hutCount = 3 } = {}) {
  const cx = Math.floor(worldSizeX / 2);
  const cz = Math.floor(worldSizeZ / 2);
  const allHutOffsets = [[0, 0], [7, 3], [-3, 7]];
  const hutOffsets = allHutOffsets.slice(0, hutCount);

  for (const [ox, oz] of offsets) {
    const centerX = cx + ox, centerZ = cz + oz;
    if (avoidPos) {
      const d = Math.hypot(centerX - avoidPos.x, centerZ - avoidPos.z);
      if (d < MIN_DIST_FROM_OTHER_VILLAGE) continue;
    }
    const top = world.heightMap.get(`${centerX},${centerZ}`);
    if (top === undefined || top < 3) continue;

    const placed = [];
    for (const [hx, hz] of hutOffsets) {
      const pos = placeHut(world, centerX + hx, centerZ + hz);
      if (pos) placed.push(pos);
    }
    if (placed.length === hutOffsets.length) {
      return { x: centerX + 0.5, y: top + 1, z: centerZ + 0.5 };
    }
  }
  return null;
}

export { OUTPOST_OFFSETS };
