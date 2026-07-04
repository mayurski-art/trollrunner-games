/* TrollTerra — World: tile/wall/liquid layers, chunk invalidation, chests,
   trees, tile damage, and the per-column "first solid" cache for sky light. */

import { T, TILES, WORLD_W, WORLD_H, CHUNK } from "./defs.js";

export class World {
  constructor(w = WORLD_W, h = WORLD_H) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint16Array(w * h);
    this.walls = new Uint8Array(w * h);
    this.liquid = new Uint8Array(w * h);      // 0..8 volume
    this.liquidType = new Uint8Array(w * h);  // 0 water, 1 lava
    this.topSolid = new Int16Array(w);        // y of first light-blocking tile per column
    this.chests = new Map();                  // "x,y" -> { items: Array(24) of {id,n}|null }
    this.trees = [];                          // { x, yBase, h, seed } — canopy render + felling
    this.damage = new Map();                  // tileIndex -> remaining hp
    this.dirtyChunks = new Set();             // chunk keys needing re-render
    this.liquidActive = new Set();            // tile indices with settling liquid
    this.growth = [];                         // future use (regrowth timers)
    this.chunksX = Math.ceil(w / CHUNK);
    this.chunksY = Math.ceil(h / CHUNK);
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  get(x, y) {
    if (!this.inBounds(x, y)) return T.BEDROCK;   // out of world acts solid
    return this.tiles[y * this.w + x];
  }

  getWall(x, y) {
    if (!this.inBounds(x, y)) return 0;
    return this.walls[y * this.w + x];
  }

  isSolid(x, y) {
    const d = TILES[this.get(x, y)];
    return !!(d && d.solid);
  }

  /* One-way platforms are handled separately by physics. */
  isOneWay(x, y) {
    const d = TILES[this.get(x, y)];
    return !!(d && d.oneWay);
  }

  set(x, y, id) {
    if (!this.inBounds(x, y)) return;
    const i = y * this.w + x;
    if (this.tiles[i] === id) return;
    this.tiles[i] = id;
    this.damage.delete(i);
    this.markDirty(x, y);
    this.updateTopSolid(x);
    this.wakeLiquids(x, y);
  }

  setWall(x, y, id) {
    if (!this.inBounds(x, y)) return;
    const i = y * this.w + x;
    if (this.walls[i] === id) return;
    this.walls[i] = id;
    this.markDirty(x, y);
  }

  setLiquid(x, y, amount, type) {
    if (!this.inBounds(x, y)) return;
    const i = y * this.w + x;
    this.liquid[i] = amount;
    if (type !== undefined) this.liquidType[i] = type;
    this.markDirty(x, y);
    if (amount > 0) this.liquidActive.add(i);
  }

  /* Mark this tile's chunk (and neighbors when on a chunk edge) for redraw. */
  markDirty(x, y) {
    const cx = (x / CHUNK) | 0, cy = (y / CHUNK) | 0;
    this.dirtyChunks.add(cy * this.chunksX + cx);
    const lx = x % CHUNK, ly = y % CHUNK;
    if (lx === 0 && cx > 0) this.dirtyChunks.add(cy * this.chunksX + cx - 1);
    if (lx === CHUNK - 1 && cx < this.chunksX - 1) this.dirtyChunks.add(cy * this.chunksX + cx + 1);
    if (ly === 0 && cy > 0) this.dirtyChunks.add((cy - 1) * this.chunksX + cx);
    if (ly === CHUNK - 1 && cy < this.chunksY - 1) this.dirtyChunks.add((cy + 1) * this.chunksX + cx);
  }

  updateTopSolid(x) {
    let y = 0;
    const w = this.w, tiles = this.tiles;
    while (y < this.h) {
      const d = TILES[tiles[y * w + x]];
      if (d && d.solid) break;
      y++;
    }
    this.topSolid[x] = y;
  }

  rebuildTopSolid() {
    for (let x = 0; x < this.w; x++) this.updateTopSolid(x);
  }

  /* Wake liquid cells around a changed tile so flow resumes. */
  wakeLiquids(x, y) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const i = ny * this.w + nx;
        if (this.liquid[i] > 0) this.liquidActive.add(i);
      }
    }
  }

  /* Damage a tile; returns true when it breaks. */
  damageTile(x, y, amount) {
    const i = this.idx(x, y);
    const def = TILES[this.tiles[i]];
    if (!def || def.hp === undefined || def.hp === Infinity) return false;
    let hp = this.damage.has(i) ? this.damage.get(i) : def.hp;
    hp -= amount;
    if (hp <= 0) { this.damage.delete(i); return true; }
    this.damage.set(i, hp);
    return false;
  }

  tileDamageFrac(x, y) {
    const i = this.idx(x, y);
    if (!this.damage.has(i)) return 0;
    const def = TILES[this.tiles[i]];
    if (!def || !def.hp || def.hp === Infinity) return 0;
    return 1 - this.damage.get(i) / def.hp;
  }

  /* Find the tree record containing a trunk tile, if any. */
  treeAt(x, y) {
    for (let t = 0; t < this.trees.length; t++) {
      const tr = this.trees[t];
      if (tr.x === x && y <= tr.yBase && y > tr.yBase - tr.h) return tr;
    }
    return null;
  }

  removeTree(tree) {
    const k = this.trees.indexOf(tree);
    if (k >= 0) this.trees.splice(k, 1);
    for (let y = tree.yBase; y > tree.yBase - tree.h; y--) {
      if (this.get(tree.x, y) === T.TREE) this.set(tree.x, y, T.AIR);
    }
  }

  chestKey(x, y) { return x + "," + y; }

  addChest(x, y, items) {
    this.chests.set(this.chestKey(x, y), { items: items || new Array(24).fill(null) });
  }

  /* Nearby crafting stations within radius r tiles of tile coords (px, py). */
  stationsNear(px, py, r) {
    const out = new Set();
    const x0 = Math.max(0, px - r), x1 = Math.min(this.w - 1, px + r);
    const y0 = Math.max(0, py - r), y1 = Math.min(this.h - 1, py + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = TILES[this.tiles[y * this.w + x]];
        if (d && d.station) out.add(d.station);
      }
    }
    return out;
  }
}
