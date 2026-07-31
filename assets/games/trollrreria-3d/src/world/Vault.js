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
  // Needs enough clearance for the shaft AND the full chamber height below
  // it with 2 blocks to spare above bedrock — the old "+4" threshold let
  // through spots where chamberBaseY went negative and the whole thing
  // silently failed to place (only ever masked by luck on the smaller
  // original island, where enough candidates happened to be tall enough).
  if (top === undefined || top < SHAFT_DEPTH_BELOW_SURFACE + CHAMBER_HEIGHT + 2) return null;
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

// Requires taller terrain than the Ruins/Village (it's buried, not
// ground-level), so a fixed hand-tuned offset list tends to run dry —
// rings of candidates at increasing radius cover it far more reliably.
// Fixed absolute radii (the world itself is unbounded now, nothing left to
// scale against — see Village.js/Dungeon.js for the same reasoning).
function ringCandidates() {
  const candidates = [];
  const maxR = 108;
  for (let r = 27; r <= maxR; r += 20) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      candidates.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]);
    }
  }
  return candidates;
}

export function placeVault(world, originX, originZ, avoidPositions = []) {
  const cx = originX;
  const cz = originZ;
  const minDist = MIN_DIST_FROM_LANDMARKS;
  const offsets = ringCandidates();
  const avoid = avoidPositions.filter(Boolean);

  for (const [ox, oz] of offsets) {
    const centerX = Math.round(cx + ox), centerZ = Math.round(cz + oz);
    if (avoid.some((p) => Math.hypot(centerX - p.x, centerZ - p.z) < minDist)) continue;
    const result = buildVault(world, centerX, centerZ);
    if (result) {
      fillLoot(world, result.chestPositions);
      return result.center;
    }
  }
  return null;
}
