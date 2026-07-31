import * as THREE from 'three';
import { BLOCK_COLOR, MINEABLE, BLOCKS } from '../world/blocks.js';

const ART_BASE = new URL('../../art/tiles/', import.meta.url).href;
const GRID = 8; // 8x8 = 64 slots, comfortably covers every world block id
const TILE_PX = 64;
const SIZE = GRID * TILE_PX; // 512 — power-of-two, avoids any NPOT texture quirks

// Every block id that can actually appear in Chunk.data. MINEABLE already
// covers all player-facing world blocks; BEDROCK and LAVA are the two
// additions — neither is mineable, but both are real world blocks that
// need their own atlas cell (without this, LAVA would silently fall back
// to whatever occupies cell 0 — grass — instead of looking like lava).
const WORLD_BLOCK_IDS = [...new Set([...MINEABLE, BLOCKS.BEDROCK, BLOCKS.LAVA])];

// Real PixelLab tile art for the blocks that cover the most visible surface
// area. Anything else in WORLD_BLOCK_IDS (chest, bed, wiring, crops, ...)
// gets an auto-generated flat-color tile from BLOCK_COLOR instead — every
// block still gets a texture, just not bespoke art for the less-common ones.
const TILE_ART = {
  [BLOCKS.GRASS]: 'grass.png',
  [BLOCKS.DIRT]: 'dirt.png',
  [BLOCKS.STONE]: 'stone.png',
  [BLOCKS.WOOD]: 'wood.png',
  [BLOCKS.ORE]: 'ore.png',
  [BLOCKS.SAND]: 'sand.png',
  [BLOCKS.LEAVES]: 'leaves.png',
  [BLOCKS.SNOW]: 'snow.png',
  [BLOCKS.CACTUS]: 'cactus.png',
  [BLOCKS.GEMSTONE]: 'gemstone.png',
  [BLOCKS.PLANK]: 'plank.png',
  [BLOCKS.STONE_BRICK]: 'stone_brick.png',
  [BLOCKS.BEDROCK]: 'bedrock.png',
};

const cellIndex = new Map();
WORLD_BLOCK_IDS.forEach((id, i) => cellIndex.set(id, i));

function cellOf(id) {
  const i = cellIndex.get(id);
  return i === undefined ? 0 : i;
}

// UV rect (u0,v0,u1,v1) for a block id, inset half a texel to avoid
// neighboring-tile bleed at the edges under linear-ish sampling.
export function uvRectFor(id) {
  const i = cellOf(id);
  const col = i % GRID, row = Math.floor(i / GRID);
  const pad = 0.5 / SIZE;
  return {
    u0: col / GRID + pad,
    v0: row / GRID + pad,
    u1: (col + 1) / GRID - pad,
    v1: (row + 1) / GRID - pad,
  };
}

function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  // Flat-color fallback for every block, drawn synchronously so the atlas
  // (and every chunk mesh built against it) is immediately usable — real
  // art layers on top asynchronously as each image loads.
  for (const id of WORLD_BLOCK_IDS) {
    const i = cellIndex.get(id);
    const col = i % GRID, row = Math.floor(i / GRID);
    ctx.fillStyle = '#' + (BLOCK_COLOR[id] ?? 0xffffff).toString(16).padStart(6, '0');
    ctx.fillRect(col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX);
  }

  const texture = new THREE.CanvasTexture(canvas);
  // uvRectFor() computes rows assuming row 0 = top of the canvas (standard
  // 2D drawing order); disable Three's default vertical flip so GL samples
  // match that addressing instead of mirroring it.
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  for (const [idStr, file] of Object.entries(TILE_ART)) {
    const id = Number(idStr);
    const i = cellIndex.get(id);
    if (i === undefined) continue;
    const col = i % GRID, row = Math.floor(i / GRID);
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX);
      ctx.drawImage(img, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX);
      texture.needsUpdate = true; // already-built chunk meshes pick this up automatically
    };
    img.onerror = () => { /* flat-color tile stays as the fallback */ };
    img.src = ART_BASE + file;
  }

  return texture;
}

export const atlasTexture = buildAtlas();
