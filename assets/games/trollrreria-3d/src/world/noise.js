// Tiny dependency-free 2D value noise (smoothed hash grid), seedable.
// Good enough for a small island heightmap — not aiming for Perlin-quality continuity.
export function makeNoise2D(seed = 1337) {
  const rand = mulberry32(seed);
  const gridSize = 256;
  const grid = new Float32Array(gridSize * gridSize);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();

  function sample(gx, gy) {
    const x = ((gx % gridSize) + gridSize) % gridSize;
    const y = ((gy % gridSize) + gridSize) % gridSize;
    return grid[y * gridSize + x];
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  return function noise2D(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const v00 = sample(x0, y0), v10 = sample(x0 + 1, y0);
    const v01 = sample(x0, y0 + 1), v11 = sample(x0 + 1, y0 + 1);
    const a = v00 + (v10 - v00) * fx;
    const b = v01 + (v11 - v01) * fx;
    return a + (b - a) * fy;
  };
}

// Fractal sum of a couple octaves for a less uniform-looking island.
export function makeFractalNoise2D(seed) {
  const n1 = makeNoise2D(seed);
  const n2 = makeNoise2D(seed + 91);
  return function fractal(x, y) {
    return n1(x * 0.05, y * 0.05) * 0.7 + n2(x * 0.15, y * 0.15) * 0.3;
  };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
