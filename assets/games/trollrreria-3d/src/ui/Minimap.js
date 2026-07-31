import { BLOCK_COLOR } from '../world/blocks.js';

// A live, rotating top-down minimap. The world is infinite now (see
// World.js's chunk streaming), so unlike the old "pre-render the whole
// fixed map once" version, this samples a WINDOW of heightMap centered on
// the player into a cache canvas, rebuilt only when the player has moved
// far enough from where that window was centered — every frame just
// crops/rotates/scales that cached window, the same cheap technique the
// old version used, just re-centered periodically instead of built once.
const VIEW_RADIUS = 40; // world units visible across the minimap's radius
const WINDOW_RADIUS = 72; // half-size of the cached sample window — bigger than VIEW_RADIUS so panning/rotating never shows its edge
const REBUILD_MOVE_THRESHOLD = 28; // rebuild once the player drifts this far from the window's center
const PLAYER_DOT_COLOR = '#ffffff';

export class Minimap {
  constructor(canvasEl, world) {
    this.canvas = canvasEl;
    this.world = world;
    this.ctx = canvasEl ? canvasEl.getContext('2d') : null;
    this.window = null; // cached local canvas
    this.windowCenter = null; // { x, z } the cache was last built around
  }

  // Call whenever the world changes out from under an already-built map
  // (new island / continue) — lazily rebuilt on the next update().
  reset() {
    this.window = null;
    this.windowCenter = null;
  }

  // Resamples a WINDOW_RADIUS-sized square of heightMap centered on
  // (centerX, centerZ) into this.window. Only columns whose chunk has
  // already streamed in will have data — everything else stays
  // transparent, same as it would on the real (still-loading) terrain.
  _rebuildWindow(centerX, centerZ) {
    const world = this.world;
    const size = WINDOW_RADIUS * 2;
    const win = document.createElement('canvas');
    win.width = size;
    win.height = size;
    const ctx = win.getContext('2d');
    const img = ctx.createImageData(size, size);
    const ox = Math.round(centerX) - WINDOW_RADIUS, oz = Math.round(centerZ) - WINDOW_RADIUS;
    for (let ix = 0; ix < size; ix++) {
      for (let iz = 0; iz < size; iz++) {
        const x = ox + ix, z = oz + iz;
        const top = world.heightMap.get(`${x},${z}`);
        if (top === undefined) continue; // not generated yet — leave transparent
        const blockId = world.getBlock(x, top, z);
        const color = BLOCK_COLOR[blockId] ?? 0x333333;
        const idx = (iz * size + ix) * 4;
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
      const mx = Math.round(pos.x) - ox, mz = Math.round(pos.z) - oz;
      if (mx < -2 || mx > size + 2 || mz < -2 || mz > size + 2) continue; // outside this window, skip
      ctx.fillStyle = color;
      ctx.fillRect(mx - 2, mz - 2, 5, 5);
    }

    this.window = win;
    this.windowCenter = { x: centerX, z: centerZ };
    // World-space top-left corner of this.window, so update() can map
    // player/world coordinates into cache-local pixel coordinates.
    this.windowOrigin = { x: ox, z: oz };
  }

  update(playerPos, playerYaw) {
    if (!this.canvas || !this.ctx) return;
    if (!this.window || Math.hypot(playerPos.x - this.windowCenter.x, playerPos.z - this.windowCenter.z) > REBUILD_MOVE_THRESHOLD) {
      this._rebuildWindow(playerPos.x, playerPos.z);
    }

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

    if (this.window) {
      const scale = half / VIEW_RADIUS;
      const localX = playerPos.x - this.windowOrigin.x, localZ = playerPos.z - this.windowOrigin.z;
      ctx.translate(half, half);
      ctx.rotate(playerYaw); // rotates the world opposite to the player's turn, so "up" always = facing direction
      ctx.scale(scale, scale);
      ctx.translate(-localX, -localZ);
      ctx.drawImage(this.window, 0, 0);
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
