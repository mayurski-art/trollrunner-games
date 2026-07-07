/* Trollrreria — World: tile/wall/liquid layers, chunk invalidation, chests,
   trees, tile damage, and the per-column "first solid" cache for sky light. */

import { T, TILES, WORLD_W, WORLD_H, CHUNK, CROP_GROW_TIME } from "./defs.js";

/* Any tile whose def opts into falling when unsupported (sand, moon
   debris, ...) -- generalized so new fallable materials don't need
   world.js changes, just `falls: true` on the tile def. */
function fallable(id) {
  const d = TILES[id];
  return !!(d && d.falls);
}

export class World {
  constructor(w = WORLD_W, h = WORLD_H) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint16Array(w * h);
    this.walls = new Uint8Array(w * h);
    this.liquid = new Uint8Array(w * h);      // 0..8 volume
    this.liquidType = new Uint8Array(w * h);  // 0 water, 1 lava
    this.wires = new Uint8Array(w * h);       // 1 = wire on this tile
    this.topSolid = new Int16Array(w);        // y of first light-blocking tile per column
    this.chests = new Map();                  // "x,y" -> { items: Array(24) of {id,n}|null }
    this.trees = [];                          // { x, yBase, h, seed } — canopy render + felling
    this.damage = new Map();                  // tileIndex -> remaining hp
    this.dirtyChunks = new Set();             // chunk keys needing re-render
    this.liquidActive = new Set();            // tile indices with settling liquid
    this.sandActive = new Set();              // sand tiles that may fall
    this.growth = new Map();                  // tileIndex -> seconds left until next crop stage
    this._liquidTick = 0;
    this.onEdit = null;                       // co-op hook: (kind, x, y, v)
    this._simming = false;                    // sim writes are not broadcast
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

  getWire(x, y) {
    if (!this.inBounds(x, y)) return 0;
    return this.wires[y * this.w + x];
  }

  setWire(x, y, on) {
    if (!this.inBounds(x, y)) return;
    this.wires[y * this.w + x] = on ? 1 : 0;
    if (this.onEdit && !this._simming) this.onEdit("wire", x, y, on ? 1 : 0);
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
    /* wake fallable tiles (sand, moon debris, ...) that may now be
       unsupported -- this cell and the one above it */
    if (fallable(id)) this.sandActive.add(i);
    if (y > 0 && fallable(this.tiles[i - this.w])) this.sandActive.add(i - this.w);
    if (this.onEdit && !this._simming) this.onEdit("tile", x, y, id);
  }

  /* Crops: tile-id swap through CROP1 -> CROP2 -> CROP3 (ripe), timed via
     this.growth (tileIndex -> seconds left). Registered when seeds are
     planted (main.js tryPlace); self-prunes if the tile stops being a crop
     (mined, buried, etc). */
  plantCrop(x, y, seconds) {
    this.growth.set(this.idx(x, y), seconds);
  }

  tickGrowth(dt) {
    if (!this.growth.size) return;
    for (const [i, t] of this.growth) {
      const id = this.tiles[i];
      if (id !== T.CROP1 && id !== T.CROP2) { this.growth.delete(i); continue; }
      const left = t - dt;
      if (left > 0) { this.growth.set(i, left); continue; }
      const x = i % this.w, y = (i / this.w) | 0;
      if (id === T.CROP1) { this.set(x, y, T.CROP2); this.growth.set(i, CROP_GROW_TIME); }
      else { this.set(x, y, T.CROP3); this.growth.delete(i); }
    }
  }

  setWall(x, y, id) {
    if (!this.inBounds(x, y)) return;
    const i = y * this.w + x;
    if (this.walls[i] === id) return;
    this.walls[i] = id;
    this.markDirty(x, y);
    if (this.onEdit && !this._simming) this.onEdit("wall", x, y, id);
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

  /* ------------------------------------------------------ simulations */
  /* One cellular pass over settling liquids. Amounts are 0..8 per cell.
     Water flows every pass; lava every other pass (it's sluggish).
     Water touching lava quenches it into obsidian. Returns cells moved. */
  simLiquids(budget = 3000) {
    this._simming = true;
    try { return this._simLiquids(budget); } finally { this._simming = false; }
  }

  _simLiquids(budget = 3000) {
    this._liquidTick++;
    const w = this.w, tiles = this.tiles, liq = this.liquid, typ = this.liquidType;
    const active = Array.from(this.liquidActive);
    if (active.length > budget) active.length = budget;
    let moved = 0;

    const solidAt = i => {
      const d = TILES[tiles[i]];
      return !!(d && d.solid);
    };

    for (const i of active) {
      const a = liq[i];
      if (a === 0) { this.liquidActive.delete(i); continue; }
      const isLava = typ[i] === 1;
      if (isLava && (this._liquidTick & 1)) continue;   // lava at half speed

      const x = i % w, y = (i / w) | 0;

      /* lava + adjacent water -> obsidian right here */
      if (isLava) {
        let quench = false;
        for (const j of [i - 1, i + 1, i - w, i + w]) {
          if (j >= 0 && j < liq.length && liq[j] > 0 && typ[j] === 0) {
            liq[j] = Math.max(0, liq[j] - 2);
            quench = true;
          }
        }
        if (quench) {
          liq[i] = 0;
          this.liquidActive.delete(i);
          this.set(x, y, T.OBSIDIAN);
          moved++;
          continue;
        }
      }

      let changed = false;

      /* pour down */
      if (y + 1 < this.h) {
        const b = i + w;
        if (!solidAt(b) && (liq[b] === 0 || typ[b] === typ[i])) {
          const space = 8 - liq[b];
          if (space > 0) {
            const mv = Math.min(a, space);
            liq[b] += mv;
            typ[b] = typ[i];
            liq[i] -= mv;
            this.liquidActive.add(b);
            changed = true;
          }
        } else if (liq[b] > 0 && typ[b] !== typ[i]) {
          /* water lands on lava -> obsidian below */
          const lavaIdx = typ[b] === 1 ? b : i;
          liq[lavaIdx] = 0;
          liq[typ[b] === 1 ? i : b] = Math.max(0, liq[typ[b] === 1 ? i : b] - 2);
          this.set(lavaIdx % w, (lavaIdx / w) | 0, T.OBSIDIAN);
          changed = true;
        }
      }

      /* spread sideways */
      if (liq[i] > 1) {
        const first = (x + this._liquidTick) & 1 ? 1 : -1;
        for (const dx of [first, -first]) {
          const s = i + dx;
          const sx = x + dx;
          if (sx < 0 || sx >= w) continue;
          if (solidAt(s)) continue;
          if (liq[s] > 0 && typ[s] !== typ[i]) {
            /* sideways lava/water contact -> obsidian at the lava cell */
            const lavaIdx = typ[s] === 1 ? s : i;
            liq[lavaIdx] = 0;
            this.set(lavaIdx % w, (lavaIdx / w) | 0, T.OBSIDIAN);
            changed = true;
            break;
          }
          if (liq[s] < liq[i] - 1 || (liq[s] < liq[i] && ((this._liquidTick + x) & 3) === 0)) {
            liq[s]++;
            typ[s] = typ[i];
            liq[i]--;
            this.liquidActive.add(s);
            changed = true;
          }
          if (liq[i] <= 1) break;
        }
      }

      if (changed) {
        moved++;
        this.liquidActive.add(i);
        if (i - w >= 0 && liq[i - w] > 0) this.liquidActive.add(i - w);
      } else {
        this.liquidActive.delete(i);
      }
    }
    return moved;
  }

  /* Falling tiles (sand, moon debris, ...): unsupported ones drop one
     cell per pass. */
  simSand() {
    if (this.sandActive.size === 0) return;
    this._simming = true;
    try { this._simSand(); } finally { this._simming = false; }
  }

  _simSand() {
    const w = this.w;
    for (const i of Array.from(this.sandActive)) {
      const id = this.tiles[i];
      if (!fallable(id)) { this.sandActive.delete(i); continue; }
      const x = i % w, y = (i / w) | 0;
      if (y + 1 >= this.h) { this.sandActive.delete(i); continue; }
      const b = i + w;
      const belowDef = TILES[this.tiles[b]];
      const canFall = this.tiles[b] === T.AIR || this.tiles[b] === T.PLANT ||
        (belowDef && !belowDef.solid && !belowDef.oneWay && !belowDef.station &&
         this.tiles[b] !== T.TORCH && this.tiles[b] !== T.CHEST &&
         this.tiles[b] !== T.DOOR_C && this.tiles[b] !== T.DOOR_O);
      if (!canFall) { this.sandActive.delete(i); continue; }
      /* swap any liquid upward as the tile sinks */
      const liqAmt = this.liquid[b], liqTyp = this.liquidType[b];
      this.set(x, y + 1, id);
      this.set(x, y, T.AIR);
      this.liquid[i] = liqAmt;
      this.liquidType[i] = liqTyp;
      this.liquid[b] = 0;
      if (liqAmt > 0) this.liquidActive.add(i);
      this.sandActive.add(b);
    }
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
