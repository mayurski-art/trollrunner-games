/* Troll High — Wang tileset loader + runtime autotiler.

   PixelLab transition tilesets (transition_size=1.0) ship 25 tiles in a
   4x8 sheet. Tiles are selected by scoring each tile's pattern_4x4 from the
   metadata against the zone's vertex terrain (0=floor, 1=wall-top,
   2=wall-face band, 255=wildcard). The wall face renders in the cells south
   of a wall region, so rooms leave a row of floor below every wall block —
   the face consumes it. Algorithm follows pixellab://docs/godot/wang-tilesets. */

import { TILE, loadImage, loadJSON } from "./util.js";

const CENTER = [[1, 1], [1, 2], [2, 1], [2, 2]];

export class Tileset {
  constructor(name) {
    this.name = name;
    this.image = null;
    this.tiles = null; // [{pattern: [4][4], bbox: {x,y,width,height}}]
  }

  async load(base) {
    const [img, meta] = await Promise.all([
      loadImage(`${base}/${this.name}.png`),
      loadJSON(`${base}/${this.name}.json`),
    ]);
    this.image = img;
    const raw = meta && meta.tileset_data && meta.tileset_data.tiles;
    if (raw) {
      this.tiles = raw.map(t => ({
        pattern: [
          t.pattern_4x4.row_0, t.pattern_4x4.row_1,
          t.pattern_4x4.row_2, t.pattern_4x4.row_3,
        ],
        bbox: t.bounding_box,
      }));
    }
    return this;
  }

  get ready() { return !!(this.image && this.tiles); }

  /* Best-scoring tile for cell (r, c) against vertex grid v.
     Scoring, not exact matching: the 25-tile vocabulary doesn't cover every
     shape, so near-misses on the outer ring are tolerated. */
  select(v, r, c) {
    let best = null, bestScore = -Infinity;
    for (const tile of this.tiles) {
      let score = 0;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          const want = tile.pattern[i][j];
          const rr = r - 1 + i, cc = c - 1 + j;
          const have =
            rr >= 0 && rr < v.length && cc >= 0 && cc < v[0].length ? v[rr][cc] : -1;
          if (want === 255 || have === -1) continue;
          const isCenter = CENTER.some(([a, b]) => a === i && b === j);
          if (have === want) score += isCenter ? 10 : 1;
          else score -= isCenter ? 30 : 1;
        }
      }
      if (score > bestScore) { bestScore = score; best = tile; }
    }
    return best;
  }

  drawTile(ctx, tile, dx, dy) {
    const b = tile.bbox;
    ctx.drawImage(this.image, b.x, b.y, b.width, b.height, dx, dy, TILE, TILE);
  }
}
