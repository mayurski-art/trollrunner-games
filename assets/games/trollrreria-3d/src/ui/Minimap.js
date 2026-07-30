import { BLOCK_COLOR } from '../world/blocks.js';
import { WORLD_SIZE_X, WORLD_SIZE_Z } from '../world/World.js';

// A live, rotating top-down minimap — pre-renders the whole island's
// surface (topmost block color per column, same palette the world itself
// uses) to one big offscreen canvas ONCE at load, then every frame just
// crops/rotates/scales a small viewport of that pre-rendered image around
// the player's position, rather than re-walking heightMap 400x400 times
// per frame. Landmarks get small colored dot markers baked into the same
// offscreen image.
const VIEW_RADIUS = 40; // world units visible across the minimap's radius
const PLAYER_DOT_COLOR = '#ffffff';

export class Minimap {
  constructor(canvasEl, world) {
    this.canvas = canvasEl;
    this.world = world;
    this.ctx = canvasEl ? canvasEl.getContext('2d') : null;
    this.full = null;
  }

  // Called once world generation (incl. landmark placement) has finished —
  // building this any earlier would bake an empty/wrong map.
  // Call whenever the world changes out from under an already-built map
  // (new island / continue) — lazily rebuilt on the next update().
  reset() {
    this.full = null;
  }

  build() {
    if (!this.canvas) return;
    const world = this.world;
    const w = WORLD_SIZE_X, h = WORLD_SIZE_Z;
    const full = document.createElement('canvas');
    full.width = w;
    full.height = h;
    const ctx = full.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < h; z++) {
        const top = world.heightMap.get(`${x},${z}`);
        const idx = (z * w + x) * 4;
        if (top === undefined || top < 0) continue; // leave transparent (void)
        const blockId = world.getBlock(x, top, z);
        const color = BLOCK_COLOR[blockId] ?? 0x333333;
        img.data[idx] = (color >> 16) & 255;
        img.data[idx + 1] = (color >> 8) & 255;
        img.data[idx + 2] = color & 255;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const markers = [
      [world.villagePos, '#5856d6'],
      [world.outpostPos, '#ff9500'],
      [world.dungeonPos, '#a855f7'],
      [world.vaultPos, '#22d3ee'],
    ];
    for (const [pos, color] of markers) {
      if (!pos) continue;
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(pos.x) - 2, Math.round(pos.z) - 2, 5, 5);
    }
    this.full = full;
  }

  update(playerPos, playerYaw) {
    if (!this.canvas || !this.ctx) return;
    if (!this.full) this.build();
    const ctx = this.ctx;
    const size = this.canvas.width;
    const half = size / 2;

    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(half, half, half - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0a0616';
    ctx.fillRect(0, 0, size, size);

    if (this.full) {
      const scale = half / VIEW_RADIUS;
      ctx.translate(half, half);
      ctx.rotate(playerYaw); // rotates the world opposite to the player's turn, so "up" always = facing direction
      ctx.scale(scale, scale);
      ctx.translate(-playerPos.x, -playerPos.z);
      ctx.drawImage(this.full, 0, 0);
    }
    ctx.restore();

    // Fixed player arrow, always centered and pointing up.
    ctx.save();
    ctx.fillStyle = PLAYER_DOT_COLOR;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(half, half - 7);
    ctx.lineTo(half - 5, half + 6);
    ctx.lineTo(half, half + 3);
    ctx.lineTo(half + 5, half + 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.stroke();
  }
}
