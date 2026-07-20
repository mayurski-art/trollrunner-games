/* Troll High — player/NPC character sprites.
   Expects per-direction horizontal strips exported from PixelLab:
     sprites/<name>/meta.json  { frameW, frameH, anchorX, anchorY, walkFrames, fps }
     sprites/<name>/idle-<dir>.png   (single frame)
     sprites/<name>/walk-<dir>.png   (walkFrames frames side by side)
   Falls back to a drawn capsule so the engine runs before art lands. */

import { DIRS, loadImage, loadJSON } from "./util.js";

export class CharacterSprites {
  constructor(name) {
    this.name = name;
    this.meta = null;
    this.idle = {};
    this.walk = {};
  }

  async load(base) {
    const dir = `${base}/${this.name}`;
    this.meta = await loadJSON(`${dir}/meta.json`);
    if (this.meta) {
      // walkFrames <= 1 means no walk strip was generated for this
      // character (most NPCs, for now) — skip the fetch rather than
      // 404-ing 8 requests every load just to fall back to idle anyway.
      const hasWalk = this.meta.walkFrames > 1;
      await Promise.all(DIRS.map(async d => {
        this.idle[d] = await loadImage(`${dir}/idle-${d}.png`);
        this.walk[d] = hasWalk ? await loadImage(`${dir}/walk-${d}.png`) : null;
      }));
    }
    return this;
  }

  get ready() { return !!this.meta; }

  /* (x, y) is the character's feet center in world px. */
  draw(ctx, dir, moving, t, x, y) {
    if (this.ready) {
      const m = this.meta;
      const strip = moving && this.walk[dir] ? this.walk[dir] : this.idle[dir];
      if (strip) {
        const frames = moving && this.walk[dir] ? m.walkFrames : 1;
        const frame = Math.floor(t * (m.fps || 8)) % frames;
        ctx.drawImage(
          strip,
          frame * m.frameW, 0, m.frameW, m.frameH,
          Math.round(x - m.anchorX), Math.round(y - m.anchorY),
          m.frameW, m.frameH
        );
        return;
      }
    }
    // fallback capsule with a facing dot
    ctx.fillStyle = "#e8862e";
    ctx.beginPath();
    ctx.ellipse(x, y - 9, 6, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2b2417";
    const a = { east: [5, 0], "south-east": [4, 3], south: [0, 4], "south-west": [-4, 3], west: [-5, 0], "north-west": [-4, -3], north: [0, -4], "north-east": [4, -3] }[dir] || [0, 4];
    ctx.beginPath();
    ctx.arc(x + a[0], y - 12 + a[1], 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}
