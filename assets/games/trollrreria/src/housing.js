/* Trollrreria — housing: is this hole in the ground a HOME?
   A valid house is an enclosed air region (bounded by solid tiles and
   closed doors), 18–140 tiles big, mostly backed by walls, containing a
   torch (light), a comfort item (bed or workbench), with a door on the
   boundary. Sky-open regions fail (the flood fill escaping the cap). */

import { T, TILES, W } from "./defs.js";

const MIN_CELLS = 18;
const MAX_CELLS = 140;

function passable(world, x, y) {
  const id = world.get(x, y);
  const d = TILES[id];
  if (!d) return false;
  if (id === T.DOOR_C || id === T.DOOR_O) return false;   // doors bound the room
  return !d.solid;
}

/* Flood fill from an interior tile. Returns a report or { valid:false }. */
export function checkHouse(world, sx, sy) {
  if (!passable(world, sx, sy)) return { valid: false, reason: "start blocked" };
  const seen = new Set();
  const queue = [[sx, sy]];
  seen.add(sy * world.w + sx);
  let cells = 0, walled = 0, hasTorch = false, hasComfort = false, hasDoor = false;

  while (queue.length) {
    if (cells > MAX_CELLS) return { valid: false, reason: "too big (or open air)" };
    const [x, y] = queue.pop();
    cells++;
    const id = world.get(x, y);
    if (id === T.TORCH) hasTorch = true;
    if (id === T.BED || id === T.WORKBENCH) hasComfort = true;
    if (world.getWall(x, y) !== W.NONE) walled++;

    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (!world.inBounds(nx, ny)) return { valid: false, reason: "world edge" };
      const nid = world.get(nx, ny);
      if (nid === T.DOOR_C || nid === T.DOOR_O) { hasDoor = true; continue; }
      if (passable(world, nx, ny)) {
        const k = ny * world.w + nx;
        if (!seen.has(k)) { seen.add(k); queue.push([nx, ny]); }
      }
    }
  }

  if (cells < MIN_CELLS) return { valid: false, reason: "too small" };
  if (!hasDoor) return { valid: false, reason: "needs a door" };
  if (!hasTorch) return { valid: false, reason: "needs a torch" };
  if (!hasComfort) return { valid: false, reason: "needs a bed or workbench" };
  if (walled / cells < 0.55) return { valid: false, reason: "needs background walls" };
  return { valid: true, cells, cx: sx, cy: sy };
}

/* Scan doors near a point and test the rooms behind them.
   Returns the first valid house { cx, cy } or null. */
export function findHouseNear(world, ptx, pty, radius = 60) {
  const x0 = Math.max(1, ptx - radius), x1 = Math.min(world.w - 2, ptx + radius);
  const y0 = Math.max(1, pty - radius), y1 = Math.min(world.h - 2, pty + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const id = world.get(x, y);
      if (id !== T.DOOR_C && id !== T.DOOR_O) continue;
      /* only test the door's top tile to avoid double work */
      if (world.get(x, y - 1) === id) continue;
      for (const dx of [-1, 1]) {
        const r = checkHouse(world, x + dx, y + 1);
        if (r.valid) return r;
      }
    }
  }
  return null;
}
