// Voxel DDA raycast — walks the grid cell-by-cell along the look vector,
// which is both cheaper and more reliable here than raycasting against the
// merged chunk meshes (no per-triangle intersection needed).
export function raycastVoxel(world, origin, dir, maxDist = 6) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x) || 0;
  const stepY = Math.sign(dir.y) || 0;
  const stepZ = Math.sign(dir.z) || 0;

  const deltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const deltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const deltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;

  let tMaxX = dir.x !== 0 ? ((stepX > 0 ? x + 1 - origin.x : origin.x - x) * deltaX) : Infinity;
  let tMaxY = dir.y !== 0 ? ((stepY > 0 ? y + 1 - origin.y : origin.y - y) * deltaY) : Infinity;
  let tMaxZ = dir.z !== 0 ? ((stepZ > 0 ? z + 1 - origin.z : origin.z - z) * deltaZ) : Infinity;

  let normal = { x: 0, y: 0, z: 0 };
  let dist = 0;

  while (dist < maxDist) {
    if (world.getBlock(x, y, z) !== 0) {
      return { x, y, z, normal, dist };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; dist = tMaxX; tMaxX += deltaX; normal = { x: -stepX, y: 0, z: 0 };
    } else if (tMaxY < tMaxZ) {
      y += stepY; dist = tMaxY; tMaxY += deltaY; normal = { x: 0, y: -stepY, z: 0 };
    } else {
      z += stepZ; dist = tMaxZ; tMaxZ += deltaZ; normal = { x: 0, y: 0, z: -stepZ };
    }
  }
  return null;
}

// Ray-sphere test for hitting the enemy (kept separate from voxel geometry).
function raySphereDist(origin, dir, center, radius) {
  const ox = origin.x - center.x, oy = origin.y - center.y, oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

// Returns { type: 'block', x,y,z, normal, dist } | { type: 'entity', entity, dist } | null
export function performRaycast(world, eyePos, forward, reach, entities = []) {
  const blockHit = raycastVoxel(world, eyePos, forward, reach);
  let best = blockHit ? { type: 'block', ...blockHit } : null;

  for (const entity of entities) {
    if (!entity.alive) continue;
    const t = raySphereDist(eyePos, forward, entity.centerPos(), entity.radius);
    if (t === null || t > reach) continue;
    if (!best || t < best.dist) best = { type: 'entity', entity, dist: t };
  }
  return best;
}
