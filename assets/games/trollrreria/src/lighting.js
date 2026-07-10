/* Trollrreria — viewport lighting.
   Every frame we flood-fill light over the visible tile region (+ margin):
   sources are sky-exposed air (scaled by time of day), light-emitting tiles
   (torch, furnace, glowshroom, troll heart) and lava. Light decays fast
   through solids, slowly through air. The result is written into a small
   RGBA buffer (1 px per tile) that the renderer scales up smoothly.      */

import { T, TILES } from "./defs.js";

const AIR_DECAY = 12;    // per tile through air (0..255) -- was 26, then 20;
                          // still read as too dark underground even next to
                          // a lit torch, so this drops it further for a much
                          // bigger visible radius around any light source
const SOLID_DECAY = 58;  // per tile through solids

export class Lighting {
  constructor() {
    this.buf = null;      // Uint8ClampedArray region light values
    this.rw = 0; this.rh = 0;
    this.x0 = 0; this.y0 = 0;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.img = null;
    this.queue = new Int32Array(0);
  }

  /* skyLight 0..255; extra: array of {tx, ty, level} dynamic sources. */
  compute(world, x0, y0, rw, rh, skyLight, extra) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    if (x0 + rw > world.w) rw = world.w - x0;
    if (y0 + rh > world.h) rh = world.h - y0;
    this.x0 = x0; this.y0 = y0; this.rw = rw; this.rh = rh;

    const n = rw * rh;
    if (!this.buf || this.buf.length < n) {
      this.buf = new Uint8ClampedArray(n);
      this.queue = new Int32Array(n * 4);
      this.canvas.width = rw; this.canvas.height = rh;
      this.img = this.ctx.createImageData(rw, rh);
    } else {
      this.buf.fill(0);
    }
    if (this.canvas.width !== rw || this.canvas.height !== rh) {
      this.canvas.width = rw; this.canvas.height = rh;
      this.img = this.ctx.createImageData(rw, rh);
    }

    const buf = this.buf, q = this.queue;
    const tiles = world.tiles, liquid = world.liquid, liquidType = world.liquidType;
    const topSolid = world.topSolid, ww = world.w;
    let qn = 0;

    /* seed: sky light + emissive tiles + lava */
    for (let ry = 0; ry < rh; ry++) {
      const wy = y0 + ry;
      for (let rx = 0; rx < rw; rx++) {
        const wx = x0 + rx;
        const i = wy * ww + wx;
        const def = TILES[tiles[i]];
        let lv = 0;
        if (wy < topSolid[wx]) lv = skyLight;
        if (def && def.light && def.light > lv) lv = def.light;
        if (liquid[i] > 2 && liquidType[i] === 1) lv = Math.max(lv, 210);
        if (lv > 0) {
          const ri = ry * rw + rx;
          buf[ri] = lv;
          q[qn++] = ri;
        }
      }
    }
    /* dynamic sources (player torch glow, flame arrows, boss, etc.) */
    if (extra) {
      for (const s of extra) {
        const rx = s.tx - x0, ry = s.ty - y0;
        if (rx < 0 || ry < 0 || rx >= rw || ry >= rh) continue;
        const ri = ry * rw + rx;
        if (s.level > buf[ri]) { buf[ri] = s.level; q[qn++] = ri; }
      }
    }

    /* BFS flood */
    let head = 0;
    while (head < qn) {
      const ri = q[head++];
      const lv = buf[ri];
      if (lv <= AIR_DECAY) continue;
      const rx = ri % rw, ry = (ri / rw) | 0;
      const wx = x0 + rx, wy = y0 + ry;
      /* 4-neighbours */
      if (rx > 0) qn = this.spread(buf, q, qn, ri - 1, lv, tiles[wy * ww + wx - 1]);
      if (rx < rw - 1) qn = this.spread(buf, q, qn, ri + 1, lv, tiles[wy * ww + wx + 1]);
      if (ry > 0) qn = this.spread(buf, q, qn, ri - rw, lv, tiles[(wy - 1) * ww + wx]);
      if (ry < rh - 1) qn = this.spread(buf, q, qn, ri + rw, lv, tiles[(wy + 1) * ww + wx]);
      if (qn > q.length - 8) break;  // safety: never overrun the queue
    }

    /* write darkness into the RGBA image (alpha = 1 - light) */
    const data = this.img.data;
    for (let i = 0; i < rw * rh; i++) {
      data[i * 4] = 0; data[i * 4 + 1] = 0; data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 255 - buf[i];
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  spread(buf, q, qn, ri, lv, tileId) {
    const def = TILES[tileId];
    const decay = def && def.solid && !def.glass ? SOLID_DECAY : AIR_DECAY;
    const nv = lv - decay;
    if (nv > buf[ri]) {
      buf[ri] = nv;
      q[qn++] = ri;
    }
    return qn;
  }

  /* Light level (0..1) at a world tile — for spawn checks / UI. */
  levelAt(tx, ty) {
    const rx = tx - this.x0, ry = ty - this.y0;
    if (!this.buf || rx < 0 || ry < 0 || rx >= this.rw || ry >= this.rh) return 0;
    return this.buf[ry * this.rw + rx] / 255;
  }
}
