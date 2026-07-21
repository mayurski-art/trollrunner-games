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
    // memKey is captured once, at load, from the ORIGINAL position — pushable
    // objects (the TV cart) can move, but their memory/found-state identity
    // must not, or "isNew" tracking would think a shoved cart is a new object.
    this.objects = (data.objects || []).map(o => ({
      ...o,
      def: OBJECT_DEFS[o.type],
      memKey: `${o.type}:${o.x}:${o.y}`,
    })).filter(o => o.def);

    // -------- solid grid (cells): wall-solidity is immutable (from terrain),
    // object-solidity is recomputed per-cell when an object moves (see
    // tryPush) so pushing a piece of furniture doesn't corrupt the wall data
    // it happens to share a cell with.
    this.wallSolid = [];
    for (let r = 0; r < this.h; r++) {
      this.wallSolid[r] = [];
      for (let c = 0; c < this.w; c++) {
        const corners = [this.v[r][c], this.v[r][c + 1], this.v[r + 1][c], this.v[r + 1][c + 1]];
        this.wallSolid[r][c] = corners.some(x => x !== 0);
      }
    }
    this.solid = this.wallSolid.map(row => row.slice());
    for (const o of this.objects) {
      if (o.def.walkable) continue;
      for (const [c, r] of this._footprint(o)) this.solid[r][c] = true;
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

  /* Solid (footRows) cells of an object's footprint, as [c, r] pairs. */
  _footprint(o) {
    const top = o.y + o.def.h - o.def.footRows;
    const cells = [];
    for (let r = top; r < o.y + o.def.h; r++) {
      for (let c = o.x; c < o.x + o.def.w; c++) {
        if (r >= 0 && r < this.h && c >= 0 && c < this.w) cells.push([c, r]);
      }
    }
    return cells;
  }

  /* Recomputes this.solid at (c, r) from scratch: wall OR any object's
     footprint. Cheap — only ever called for a handful of cells at a time. */
  _recomputeCell(c, r) {
    this.solid[r][c] = this.wallSolid[r][c] ||
      this.objects.some(o => !o.def.walkable && this._footprint(o).some(([fc, fr]) => fc === c && fr === r));
  }

  /* Attempts to push a movable object one tile in (dx, dy) — exactly one of
     which should be -1/0/1, the other 0. Refuses to leave the zone, cross a
     wall, overlap another solid object, or land on a door tile (so a pushed
     object can never end up blocking — or escaping through — a doorway).
     Returns true and mutates the object's position on success. */
  tryPush(obj, dx, dy) {
    const def = obj.def;
    const nx = obj.x + dx, ny = obj.y + dy;
    // Same margins every hand-placed object in this project follows (see
    // docs/TROLL-HIGH.md's room-authoring notes): clear of the thick
    // double-row top wall band, clear of the wall-adjacent bottom row, and
    // off the side wall columns. Collision alone isn't enough here — the
    // object's own solid check only covers its footRows "feet" row (by
    // design, for walk-behind), so without this a push can shove an
    // object's TOP visually into the wall band while the feet stay legal.
    if (nx < 1 || ny < 2 || nx + def.w > this.w - 1 || ny + def.h > this.h - 1) return false;

    const oldFootprint = new Set(this._footprint(obj).map(([c, r]) => `${c},${r}`));
    const top = ny + def.h - def.footRows;
    for (let r = ny; r < ny + def.h; r++) {
      for (let c = nx; c < nx + def.w; c++) {
        if (this.doorAt(c, r)) return false;
      }
    }
    for (let r = top; r < ny + def.h; r++) {
      for (let c = nx; c < nx + def.w; c++) {
        if (oldFootprint.has(`${c},${r}`)) continue; // the object's own current spot
        if (this.solid[r][c]) return false;
      }
    }

    const affected = new Set([...oldFootprint, ...this._footprint({ ...obj, x: nx, y: ny }).map(([c, r]) => `${c},${r}`)]);
    obj.x = nx; obj.y = ny;
    for (const key of affected) {
      const [c, r] = key.split(",").map(Number);
      this._recomputeCell(c, r);
    }
    return true;
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
    this._drawDoorLabels(ctx);
  }

  /* A little floating sign over each door naming where it leads — so many
     look-alike doors down a hallway were otherwise unlabeled until you
     stepped through one and found out the hard way. Drawn last (on top of
     everything, unsorted) since it's a UI readout, not a world object. */
  _drawDoorLabels(ctx) {
    ctx.save();
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    for (const d of this.doors) {
      if (!d.label) continue;
      const cx = (d.x + (d.w || 1) / 2) * TILE;
      const topY = d.y * TILE;
      const textW = ctx.measureText(d.label).width;
      const boxW = textW + 6, boxH = 9;
      const boxX = cx - boxW / 2, boxY = topY - boxH - 3;
      ctx.fillStyle = "rgba(10, 8, 5, 0.72)";
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.fillStyle = "#ffe9a8";
      ctx.fillText(d.label, cx, boxY + boxH - 2.5);
    }
    ctx.restore();
  }
}
