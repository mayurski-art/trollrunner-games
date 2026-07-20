/* Troll High — tiny shared helpers */

export const TILE = 16;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // tolerant: caller falls back to flat colors
    img.src = src;
  });
}

export async function loadJSON(src) {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

/* 8 directions, PixelLab naming. Index = atan2 sector. */
export const DIRS = [
  "east", "south-east", "south", "south-west",
  "west", "north-west", "north", "north-east",
];

export function dirFromVector(dx, dy) {
  const a = Math.atan2(dy, dx); // canvas y-down
  const sector = Math.round(a / (Math.PI / 4));
  return DIRS[(sector + 8) % 8];
}
