import { BLOCKS } from './blocks.js';

const HUT_SIZE = 5; // footprint, walls on the outer ring
const HUT_HEIGHT = 3;
const HALL_SIZE = 7; // the [0,0] building in a 4+ hut settlement
const HALL_HEIGHT = 4;

// Builds one hut/hall: hollow plank box with a door gap on the +z side, a
// torch inside, and a stepped stone-brick roof (each tier insets by one
// block, "wedding cake" style — reads as an actual pitched roof rather than
// a flat plank lid). Anchored to the ground height at its own footprint
// (terrain isn't flattened first, so buildings follow the local slope a
// little — reads as rustic rather than perfectly plopped-down).
function placeHut(world, cx, cz, isHall = false) {
  const size = isHall ? HALL_SIZE : HUT_SIZE;
  const height = isHall ? HALL_HEIGHT : HUT_HEIGHT;
  const top = world.heightMap.get(`${cx},${cz}`);
  if (top === undefined || top < 3) return null;
  const baseY = top + 1;
  const half = Math.floor(size / 2);

  for (let lx = -half; lx <= half; lx++) {
    for (let lz = -half; lz <= half; lz++) {
      const isEdge = Math.abs(lx) === half || Math.abs(lz) === half;
      if (!isEdge) continue;
      const isDoor = lz === half && Math.abs(lx) <= (isHall ? 1 : 0);
      for (let y = 0; y < height; y++) {
        if (isDoor && y < 2) continue; // 2-tall door gap
        world.setBlockRaw(cx + lx, baseY + y, cz + lz, BLOCKS.PLANK);
      }
    }
  }
  // Stepped pyramid roof: each tier is a hollow stone-brick ring resting on
  // the one below, insetting by 1 block until it closes to a single peak.
  let roofHalf = half;
  let ry = baseY + height;
  while (roofHalf >= 0) {
    for (let lx = -roofHalf; lx <= roofHalf; lx++) {
      for (let lz = -roofHalf; lz <= roofHalf; lz++) {
        const isEdge = roofHalf === 0 || Math.abs(lx) === roofHalf || Math.abs(lz) === roofHalf;
        if (!isEdge) continue;
        world.setBlockRaw(cx + lx, ry, cz + lz, BLOCKS.STONE_BRICK);
      }
    }
    roofHalf -= 1;
    ry += 1;
  }
  world.setBlockRaw(cx - half + 1, baseY + 1, cz - half + 1, BLOCKS.TORCH);
  if (isHall) world.setBlockRaw(cx + half - 1, baseY + 1, cz + half - 1, BLOCKS.TORCH);
  return { x: cx + 0.5, y: baseY, z: cz + 0.5 };
}

// Dirt-path trail from the settlement center out to each building's door —
// Minecraft villages read as "connected" mainly through these paths.
function placePaths(world, centerX, centerZ, hutOffsets) {
  for (const [hx, hz] of hutOffsets) {
    if (hx === 0 && hz === 0) continue; // the hall IS the center, nothing to connect it to itself
    const steps = Math.max(Math.abs(hx), Math.abs(hz));
    for (let i = 0; i <= steps; i++) {
      const px = Math.round(centerX + (hx * i) / steps);
      const pz = Math.round(centerZ + (hz * i) / steps);
      const top = world.heightMap.get(`${px},${pz}`);
      if (top === undefined || top < 0) continue;
      world.setBlockRaw(px, top, pz, BLOCKS.PATH);
    }
  }
}

// A small stone-ringed well with a dug-out pit — the classic village-square
// centerpiece, purely decorative (no water block in this game's block set).
function placeWell(world, cx, cz) {
  const top = world.heightMap.get(`${cx},${cz}`);
  if (top === undefined || top < 3) return;
  for (let lx = -1; lx <= 1; lx++) {
    for (let lz = -1; lz <= 1; lz++) {
      const isEdge = Math.abs(lx) === 1 || Math.abs(lz) === 1;
      if (isEdge) {
        world.setBlockRaw(cx + lx, top, cz + lz, BLOCKS.STONE_BRICK);
        world.setBlockRaw(cx + lx, top + 1, cz + lz, BLOCKS.STONE_BRICK);
      } else {
        world.setBlockRaw(cx + lx, top, cz + lz, BLOCKS.AIR);
        world.setBlockRaw(cx + lx, top - 1, cz + lz, BLOCKS.AIR);
      }
    }
  }
  world.setBlockRaw(cx - 1, top + 2, cz - 1, BLOCKS.TORCH);
  world.setBlockRaw(cx + 1, top + 2, cz + 1, BLOCKS.TORCH);
}

// A walled 5x5 farm plot, pre-planted with ripe wheat — the "villagers grow
// food" read even before the player plants anything themselves.
function placeFarm(world, cx, cz) {
  const centerTop = world.heightMap.get(`${cx},${cz}`);
  if (centerTop === undefined || centerTop < 3) return;
  const half = 2;
  for (let lx = -half; lx <= half; lx++) {
    for (let lz = -half; lz <= half; lz++) {
      const gx = cx + lx, gz = cz + lz;
      const gtop = world.heightMap.get(`${gx},${gz}`);
      if (gtop === undefined || gtop < 3) continue;
      const isEdge = Math.abs(lx) === half || Math.abs(lz) === half;
      if (isEdge) {
        world.setBlockRaw(gx, gtop + 1, gz, BLOCKS.STONE_BRICK);
      } else {
        world.setBlockRaw(gx, gtop, gz, BLOCKS.DIRT);
        world.setBlockRaw(gx, gtop + 1, gz, BLOCKS.WHEAT_CROP_MATURE);
      }
    }
  }
}

// Fixed absolute offsets around the home region's origin — the world
// itself is unbounded/infinite now (see World.js), so there's no "world
// size" left to scale these against; the home region is just a fixed-size
// cluster wherever the origin is, same absolute spread regardless.
const MAIN_OFFSETS = [[10, 10], [-14, 8], [12, -12], [-10, -14], [16, 2]];
const OUTPOST_OFFSETS = [[-16, -6], [16, -16], [-6, 16], [18, 14], [-18, -2]];
// Reach much farther out than the two main settlements — now that the
// world has no hard edge to worry about (see World.js MIN_FALLOFF), these
// are meant to land near the far reaches of the map, so there's still
// something new to find well past where the two main settlements are.
// Each inner array is a handful of candidate spots for ONE camp (tried in
// order, first one that clears terrain/distance checks wins).
const CAMP_OFFSET_SETS = [
  [[34, -30], [30, -34], [-34, -28]],
  [[-32, 26], [-28, 30], [32, 24]],
  [[8, 36], [4, 38], [-6, 36]],
];
const MIN_DIST_FROM_OTHER_VILLAGE = 18;

// Places a hut cluster on flat-ish ground, away from the island edge and
// not right on top of spawn (or another settlement, if avoidPos is given).
// Returns the settlement center (used for the fast-travel waypoint) or
// null if no suitable spot found. hutCount=2 gives the second "outpost"
// settlement a visibly smaller footprint than the main village.
export function placeVillage(world, originX, originZ, { avoidPos = null, offsets = MAIN_OFFSETS, hutCount = 5 } = {}) {
  const cx = originX;
  const cz = originZ;
  const minDist = MIN_DIST_FROM_OTHER_VILLAGE;
  const allHutOffsets = [[0, 0], [9, 4], [-9, 4], [-5, 10], [5, 10]];
  const hutOffsets = allHutOffsets.slice(0, hutCount);

  const avoidList = (Array.isArray(avoidPos) ? avoidPos : [avoidPos]).filter(Boolean);
  for (const [ox, oz] of offsets) {
    const centerX = cx + ox, centerZ = cz + oz;
    if (avoidList.some((p) => Math.hypot(centerX - p.x, centerZ - p.z) < minDist)) continue;
    const top = world.heightMap.get(`${centerX},${centerZ}`);
    if (top === undefined || top < 3) continue;

    const placed = [];
    // Hut 0 (offset [0,0]) is the larger town-hall-style building; the
    // rest are ordinary houses — only meaningful for hutCount>=4 (the
    // main village), the 2-hut outpost is just two plain houses.
    for (let i = 0; i < hutOffsets.length; i++) {
      const [hx, hz] = hutOffsets[i];
      const isHall = i === 0 && hutOffsets.length >= 4;
      const pos = placeHut(world, centerX + hx, centerZ + hz, isHall);
      if (pos) placed.push(pos);
    }
    if (placed.length !== hutOffsets.length) continue;

    if (hutOffsets.length >= 4) {
      placePaths(world, centerX, centerZ, hutOffsets);
      placeWell(world, centerX, centerZ + 6);
      placeFarm(world, centerX - 8, centerZ - 2);
    }
    return { x: centerX + 0.5, y: top + 1, z: centerZ + 0.5 };
  }
  return null;
}

export { OUTPOST_OFFSETS, CAMP_OFFSET_SETS };
