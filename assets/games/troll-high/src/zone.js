/* Troll High — zones: load, autotile, collide, prerender.

   A zone JSON is hand-crafted (later: via tools/troll-high-editor.html):
   {
     id, name, tileset, w, h,            // size in CELLS
     terrain: [ "(w+1) chars" x (h+1) ], // VERTEX grid: '#'=wall, '.'=floor
     objects: [{ type, x, y }],          // tile coords (top-left of sprite)
     doors:   [{ x, y, w, h, to, tx, ty, label }],
     spawn:   { x, y }
   }
   Wall faces render in the cells south of a '#' region (the band consumes
   one row of floor), so maps leave breathing room below wall blocks. */

import { TILE } from "./util.js";
import { OBJECT_DEFS } from "./objects.js";

export class Zone {
  constructor(data, tileset, objectSprites) {
    this.id = data.id;
    this.name = data.name;
    this.w = data.w;
    this.h = data.h;
    this.doors = data.doors || [];
    this.spawn = data.spawn;
    this.tileset = tileset;
    this.objectSprites = objectSprites;

    // -------- vertex grid (h+1 rows x w+1 cols): 0 floor, 1 wall, 2 face band
    this.v = data.terrain.map(row =>
      [...row].map(ch => (ch === "#" ? 1 : 0))
    );
    for (let r = this.v.length - 1; r >= 1; r--) {
      for (let c = 0; c < this.v[0].length; c++) {
        if (this.v[r][c] === 0 && this.v[r - 1][c] === 1) this.v[r][c] = 2;
      }
    }

    // -------- objects with defs attached
    this.objects = (data.objects || []).map(o => ({
      ...o,
      def: OBJECT_DEFS[o.type],
    })).filter(o => o.def);

    // -------- solid grid (cells)
    this.solid = [];
    for (let r = 0; r < this.h; r++) {
      this.solid[r] = [];
      for (let c = 0; c < this.w; c++) {
        const corners = [this.v[r][c], this.v[r][c + 1], this.v[r + 1][c], this.v[r + 1][c + 1]];
        this.solid[r][c] = corners.some(x => x !== 0);
      }
    }
    for (const o of this.objects) {
      if (o.def.walkable) continue;
      const top = o.y + o.def.h - o.def.footRows;
      for (let r = top; r < o.y + o.def.h; r++) {
        for (let c = o.x; c < o.x + o.def.w; c++) {
          if (r >= 0 && r < this.h && c >= 0 && c < this.w) this.solid[r][c] = true;
        }
      }
    }

    this.floorCanvas = this._prerender();
  }

  _prerender() {
    const cv = document.createElement("canvas");
    cv.width = this.w * TILE;
    cv.height = this.h * TILE;
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    const ts = this.tileset;
    for (let r = 0; r < this.h; r++) {
      for (let c = 0; c < this.w; c++) {
        if (ts && ts.ready) {
          const tile = ts.select(this.v, r, c);
          if (tile) { ts.drawTile(ctx, tile, c * TILE, r * TILE); continue; }
        }
        // flat-color fallback so the game runs before art lands
        const center = this.v[r][c] + this.v[r][c + 1] + this.v[r + 1][c] + this.v[r + 1][c + 1];
        ctx.fillStyle = center === 0 ? "#cfc4a8"
          : this.v[r][c] === 2 || this.v[r + 1][c] === 2 ? "#8d7f61" : "#5d5340";
        ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
      }
    }
    return cv;
  }

  solidAt(px, py) {
    const c = Math.floor(px / TILE), r = Math.floor(py / TILE);
    if (r < 0 || c < 0 || r >= this.h || c >= this.w) return true;
    return this.solid[r][c];
  }

  /* Door rect containing the tile, if any. */
  doorAt(tileX, tileY) {
    return this.doors.find(d =>
      tileX >= d.x && tileX < d.x + (d.w || 1) &&
      tileY >= d.y && tileY < d.y + (d.h || 1)
    ) || null;
  }

  /* Object whose footprint contains the tile, if any. */
  objectAt(tileX, tileY) {
    return this.objects.find(o =>
      tileX >= o.x && tileX < o.x + o.def.w &&
      tileY >= o.y && tileY < o.y + o.def.h
    ) || null;
  }

  /* Draw floor + y-sorted sprites. entities: [{y (baseline px), draw(ctx)}] */
  draw(ctx, extraEntities) {
    ctx.drawImage(this.floorCanvas, 0, 0);
    const sprites = this.objects.map(o => ({
      y: (o.y + o.def.h) * TILE,
      draw: c2 => this.objectSprites.draw(c2, o, o.def),
    })).concat(extraEntities);
    sprites.sort((a, b) => a.y - b.y);
    for (const s of sprites) s.draw(ctx);
  }
}
