import { LANES } from '../core/constants.js';

// AABB player-vs-obstacle checks. Geometry alone resolves actions: a jumping
// player's box is above low barriers, a sliding player's box is below lasers,
// a dodging player is in another lane — so no special-case action logic.
export class CollisionManager {
  // Returns the first obstacle whose box intersects the player box, or null.
  // sweep = distance obstacles moved this frame; extends each box backward
  // along z so a large low-fps step can't tunnel through the player.
  check(playerBox, obstacles, sweep = 0) {
    for (const o of obstacles) {
      const c = o.def.collider;
      const x = LANES[o.lane];
      if (playerBox.maxZ < o.z - c.d / 2 - sweep || playerBox.minZ > o.z + c.d / 2) continue;
      if (playerBox.maxX < x - c.w / 2 || playerBox.minX > x + c.w / 2) continue;
      if (playerBox.maxY < c.y || playerBox.minY > c.y + c.h) continue;
      return o;
    }
    return null;
  }
}
