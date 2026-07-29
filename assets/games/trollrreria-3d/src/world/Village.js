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

// Places a small 3-hut cluster on flat-ish forest ground, away from the
// island edge and not right on top of spawn. Returns the village center
// (used for the fast-travel waypoint) or null if no suitable spot found.
export function placeVillage(world, worldSizeX, worldSizeZ) {
  const cx = Math.floor(worldSizeX / 2);
  const cz = Math.floor(worldSizeZ / 2);
  const offsets = [[10, 10], [-14, 8], [12, -12], [-10, -14], [16, 2]];

  for (const [ox, oz] of offsets) {
    const centerX = cx + ox, centerZ = cz + oz;
    const top = world.heightMap.get(`${centerX},${centerZ}`);
    if (top === undefined || top < 3) continue;

    const hutOffsets = [[0, 0], [7, 3], [-3, 7]];
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
