/* Trollrreria — renderer: procedural tile atlas, cached chunk canvases,
   sky/sun/moon/stars, parallax hills, tree canopies, liquid + light overlays.
   World-space methods assume the caller has already applied the camera
   transform (ZOOM scale + translate); screen-space methods reset it.     */

import { T, TILES, W, WALLS, TILE, CHUNK, ZOOM, DAY_LEN, NIGHT_LEN, CYCLE } from "./defs.js";
import { hash2, clamp, lerp, octave1 } from "./util.js";
import { biomeAt } from "./worldgen.js";

const CHUNK_PX = CHUNK * TILE;
const MAX_CHUNKS = 96;
const VARIANTS = 3;

/* ------------------------------------------------------- time of day */
export function skyState(t) {
  t = ((t % CYCLE) + CYCLE) % CYCLE;
  const isNight = t >= DAY_LEN;
  let bright;              // 0..1 sky brightness
  if (!isNight) {
    const dawn = clamp(t / 50, 0, 1);                    // sunrise ramp
    const dusk = clamp((DAY_LEN - t) / 70, 0, 1);        // sunset ramp
    bright = Math.min(dawn, dusk) * 0.88 + 0.12;
  } else {
    const nt = t - DAY_LEN;
    const edge = Math.min(clamp(nt / 40, 0, 1), clamp((NIGHT_LEN - nt) / 40, 0, 1));
    bright = lerp(0.12, 0.1, edge);
  }
  const skyLight = Math.round(30 + bright * 225);
  const sunFrac = isNight ? 0 : t / DAY_LEN;
  const moonFrac = isNight ? (t - DAY_LEN) / NIGHT_LEN : 0;
  /* warm tint near dawn/dusk */
  const warm = !isNight ? clamp(1 - Math.min(t / 90, (DAY_LEN - t) / 110), 0, 1) : 0;
  return { isNight, bright, skyLight, sunFrac, moonFrac, warm };
}

function parseCol(c) {
  if (c[0] === "#") {
    const p = parseInt(c.slice(1), 16);
    return [p >> 16, (p >> 8) & 255, p & 255];
  }
  const m = c.match(/(\d+)[^\d]+(\d+)[^\d]+(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : [255, 0, 255];
}

function mixHex(a, b, t) {
  const pa = parseCol(a), pb = parseCol(b);
  const r = Math.round(lerp(pa[0], pb[0], t));
  const g = Math.round(lerp(pa[1], pb[1], t));
  const bl = Math.round(lerp(pa[2], pb[2], t));
  return `rgb(${r},${g},${bl})`;
}

export class Renderer {
  constructor(world, seed) {
    this.world = world;
    this.seed = seed;
    this.chunks = new Map();                 // chunkKey -> canvas (LRU via Map order)
    this.atlas = this.buildAtlas();
    this.wallTex = this.buildWallTex();
  }

  /* ============================================== procedural tile atlas */
  buildAtlas() {
    const ids = TILES.length;
    const c = document.createElement("canvas");
    c.width = ids * VARIANTS * TILE;
    c.height = TILE;
    const g = c.getContext("2d");
    for (let id = 1; id < ids; id++) {
      const def = TILES[id];
      if (!def || !def.pal) continue;
      for (let v = 0; v < VARIANTS; v++) {
        const ox = (id * VARIANTS + v) * TILE;
        for (let py = 0; py < TILE; py++) {
          for (let px = 0; px < TILE; px++) {
            const n = hash2(px + v * 31, py + id * 17, this.seed + id);
            const k = n < 0.24 ? 0 : n < 0.78 ? 1 : 2;
            g.fillStyle = def.pal[k];
            g.fillRect(ox + px, py, 1, 1);
          }
        }
        if (def.ore) this.drawNuggets(g, ox, def.ore, id * 7 + v);
        if (def.heart) this.drawHeart(g, ox);
        if (id === T.TREE) this.drawBark(g, ox, v);
        if (def.glass) { g.clearRect(ox + 3, 3, TILE - 6, TILE - 6); g.fillStyle = def.glassColor || "rgba(200,235,250,0.25)"; g.fillRect(ox + 3, 3, TILE - 6, TILE - 6); }
      }
    }
    return c;
  }

  drawNuggets(g, ox, color, seed) {
    g.fillStyle = color;
    for (let n = 0; n < 5; n++) {
      const x = 1 + Math.floor(hash2(n, 1, seed) * (TILE - 4));
      const y = 1 + Math.floor(hash2(n, 2, seed) * (TILE - 4));
      g.fillRect(ox + x, y, 2, 2);
      if (hash2(n, 3, seed) > 0.5) g.fillRect(ox + x + 1, y + 1, 2, 2);
    }
  }

  drawHeart(g, ox) {
    g.fillStyle = "#ff6d95";
    g.fillRect(ox + 4, 5, 3, 3); g.fillRect(ox + 9, 5, 3, 3);
    g.fillRect(ox + 4, 7, 8, 3); g.fillRect(ox + 6, 10, 4, 2); g.fillRect(ox + 7, 12, 2, 1);
    g.fillStyle = "#ffc2d4";
    g.fillRect(ox + 5, 6, 1, 1);
  }

  drawBark(g, ox, v) {
    g.fillStyle = "rgba(0,0,0,0.28)";
    for (let n = 0; n < 3; n++) {
      const x = 2 + Math.floor(hash2(n, v, 91) * 11);
      g.fillRect(ox + x, 0, 1, TILE);
    }
    g.fillStyle = "rgba(255,255,255,0.07)";
    g.fillRect(ox + 1, 0, 1, TILE);
  }

  buildWallTex() {
    const c = document.createElement("canvas");
    c.width = WALLS.length * TILE; c.height = TILE;
    const g = c.getContext("2d");
    for (let id = 1; id < WALLS.length; id++) {
      const def = WALLS[id];
      const ox = id * TILE;
      for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          g.fillStyle = def.pal[hash2(px, py + id * 37, 5) < 0.5 ? 0 : 1];
          g.fillRect(ox + px, py, 1, 1);
        }
      }
    }
    return c;
  }

  /* ==================================================== chunk rendering */
  chunkKey(cx, cy) { return cy * this.world.chunksX + cx; }

  ensureChunk(cx, cy) {
    const key = this.chunkKey(cx, cy);
    let canvas = this.chunks.get(key);
    const dirty = this.world.dirtyChunks.has(key);
    if (canvas && !dirty) {
      /* refresh LRU position */
      this.chunks.delete(key); this.chunks.set(key, canvas);
      return canvas;
    }
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = CHUNK_PX; canvas.height = CHUNK_PX;
    } else {
      this.chunks.delete(key);
    }
    this.renderChunk(canvas, cx, cy);
    this.world.dirtyChunks.delete(key);
    this.chunks.set(key, canvas);
    if (this.chunks.size > MAX_CHUNKS) {
      const oldest = this.chunks.keys().next().value;
      this.chunks.delete(oldest);
    }
    return canvas;
  }

  renderChunk(canvas, cx, cy) {
    const g = canvas.getContext("2d");
    g.clearRect(0, 0, CHUNK_PX, CHUNK_PX);
    const world = this.world;
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    for (let ly = 0; ly < CHUNK; ly++) {
      const wy = y0 + ly;
      if (wy >= world.h) break;
      for (let lx = 0; lx < CHUNK; lx++) {
        const wx = x0 + lx;
        if (wx >= world.w) break;
        const id = world.tiles[wy * world.w + wx];
        const px = lx * TILE, py = ly * TILE;
        const def = TILES[id];
        const solidHere = def && def.solid;
        /* wall behind, when tile doesn't fully cover */
        const wall = world.walls[wy * world.w + wx];
        if (wall && (!solidHere || def.glass)) {
          g.drawImage(this.wallTex, wall * TILE, 0, TILE, TILE, px, py, TILE, TILE);
          g.fillStyle = "rgba(0,0,0,0.22)";
          g.fillRect(px, py, TILE, TILE);
        }
        if (id === T.AIR) continue;
        if (def.noVariant) { this.drawSpecial(g, id, px, py, wx, wy); continue; }
        const v = Math.floor(hash2(wx, wy, this.seed) * VARIANTS);
        g.drawImage(this.atlas, (id * VARIANTS + v) * TILE, 0, TILE, TILE, px, py, TILE, TILE);
        if (solidHere || id === T.TREE) this.edgeShade(g, world, wx, wy, px, py, id);
      }
    }
  }

  edgeShade(g, world, wx, wy, px, py, id) {
    const openU = !world.isSolid(wx, wy - 1), openD = !world.isSolid(wx, wy + 1);
    const openL = !world.isSolid(wx - 1, wy), openR = !world.isSolid(wx + 1, wy);
    g.fillStyle = "rgba(0,0,0,0.28)";
    if (openD) g.fillRect(px, py + TILE - 2, TILE, 2);
    if (openL) g.fillRect(px, py, 2, TILE);
    if (openR) g.fillRect(px + TILE - 2, py, 2, TILE);
    if (openU) {
      g.fillStyle = "rgba(255,255,255,0.14)";
      g.fillRect(px, py, TILE, 2);
      /* grass cap on forest dirt / jungle mud */
      const capBiome = biomeAt(wx, world.w);
      if (id === T.DIRT && capBiome === "forest") {
        g.fillStyle = "#3e9e44";
        g.fillRect(px, py, TILE, 4);
        g.fillStyle = "#57bd5c";
        for (let n = 0; n < 4; n++) {
          const bx = Math.floor(hash2(wx * 4 + n, wy, 13) * (TILE - 1));
          g.fillRect(px + bx, py - (hash2(n, wx, 17) > 0.5 ? 2 : 1), 1, 3);
        }
      } else if (id === T.MUD && capBiome === "jungle") {
        /* deeper, thicker jungle green so Kek Jungle mud reads as lush,
           not swampy -- swamp mud stays bare */
        g.fillStyle = "#1f7a3d";
        g.fillRect(px, py, TILE, 5);
        g.fillStyle = "#35a85a";
        for (let n = 0; n < 6; n++) {
          const bx = Math.floor(hash2(wx * 4 + n, wy, 19) * (TILE - 1));
          g.fillRect(px + bx, py - (hash2(n, wx, 23) > 0.4 ? 3 : 1), 1, 4);
        }
      }
    }
  }

  /* Furniture / markers drawn as little sprites instead of noise tiles. */
  drawSpecial(g, id, px, py, wx, wy) {
    switch (id) {
      case T.TORCH: {
        g.fillStyle = "#8a5a2b"; g.fillRect(px + 7, py + 6, 2, 9);
        g.fillStyle = "#ffb300"; g.fillRect(px + 6, py + 3, 4, 4);
        g.fillStyle = "#ffe08a"; g.fillRect(px + 7, py + 3, 2, 2);
        break;
      }
      case T.WORKBENCH: {
        g.fillStyle = "#7a5a33"; g.fillRect(px, py + 6, TILE, 4);
        g.fillStyle = "#5d4326"; g.fillRect(px + 2, py + 10, 3, 6); g.fillRect(px + 11, py + 10, 3, 6);
        break;
      }
      case T.FURNACE: {
        g.fillStyle = "#565a63"; g.fillRect(px + 1, py + 2, 14, 14);
        g.fillStyle = "#33363e"; g.fillRect(px + 1, py + 2, 14, 3);
        g.fillStyle = "#ff7a1a"; g.fillRect(px + 5, py + 9, 6, 5);
        g.fillStyle = "#ffd23c"; g.fillRect(px + 7, py + 11, 2, 3);
        break;
      }
      case T.ANVIL: {
        g.fillStyle = "#3d4149"; g.fillRect(px + 2, py + 8, 12, 4);
        g.fillRect(px + 5, py + 12, 6, 4);
        g.fillStyle = "#565a63"; g.fillRect(px + 2, py + 8, 12, 2);
        break;
      }
      case T.CHEST: {
        g.fillStyle = "#8a5a2b"; g.fillRect(px + 1, py + 4, 14, 12);
        g.fillStyle = "#6b4a26"; g.fillRect(px + 1, py + 4, 14, 4);
        g.fillStyle = "#ffb300"; g.fillRect(px + 7, py + 8, 3, 4);
        g.strokeStyle = "#4e3418"; g.strokeRect(px + 1.5, py + 4.5, 13, 11);
        break;
      }
      case T.DOOR_C: {
        g.fillStyle = "#6b4a26"; g.fillRect(px + 3, py, 10, TILE);
        g.fillStyle = "#4e3418"; g.fillRect(px + 3, py, 2, TILE);
        g.fillStyle = "#ffb300";
        if (this.world.get(wx, wy - 1) === T.DOOR_C) g.fillRect(px + 10, py + 6, 2, 3);
        break;
      }
      case T.DOOR_O: {
        g.fillStyle = "#6b4a26"; g.fillRect(px, py, 3, TILE);
        g.fillStyle = "rgba(107,74,38,0.35)"; g.fillRect(px + 3, py, 9, TILE);
        break;
      }
      case T.PLATFORM: {
        g.fillStyle = "#7a5a33"; g.fillRect(px, py, TILE, 5);
        g.fillStyle = "#5d4326"; g.fillRect(px, py + 3, TILE, 2);
        break;
      }
      case T.SHROOM: {
        g.fillStyle = "#c9d86a"; g.fillRect(px + 7, py + 9, 2, 6);
        g.fillStyle = "#8fd14f"; g.fillRect(px + 4, py + 6, 8, 4);
        g.fillStyle = "#c7f08a"; g.fillRect(px + 6, py + 7, 2, 2);
        break;
      }
      case T.TORCH_OFF: {
        g.fillStyle = "#8a5a2b"; g.fillRect(px + 7, py + 6, 2, 9);
        g.fillStyle = "#3a3a3e"; g.fillRect(px + 6, py + 3, 4, 4);
        break;
      }
      case T.LEVER: {
        g.fillStyle = "#565a63"; g.fillRect(px + 4, py + 9, 8, 6);
        g.fillStyle = "#c9302c"; g.fillRect(px + 7, py + 2, 2, 8);
        g.fillStyle = "#ffd23c"; g.fillRect(px + 6, py + 1, 4, 3);
        break;
      }
      case T.PLATE: {
        g.fillStyle = "#8f8f96"; g.fillRect(px + 2, py + 13, 12, 2);
        g.fillStyle = "#c9c9cf"; g.fillRect(px + 3, py + 12, 10, 1);
        break;
      }
      case T.DART_L:
      case T.DART_R: {
        g.fillStyle = "#4e525a"; g.fillRect(px, py, TILE, TILE);
        g.fillStyle = "#33363e";
        const mx = id === T.DART_L ? px + 1 : px + 9;
        g.fillRect(mx, py + 6, 6, 4);
        g.fillStyle = "#141414";
        g.fillRect(id === T.DART_L ? px : px + 13, py + 7, 3, 2);
        break;
      }
      case T.SIGN: {
        g.fillStyle = "#5d4326"; g.fillRect(px + 6, py + 5, 3, 11);
        g.fillStyle = "#7a5a33"; g.fillRect(px + 1, py, 14, 8);
        g.strokeStyle = "#4e3418"; g.lineWidth = 1; g.strokeRect(px + 1.5, py + 0.5, 13, 7);
        g.fillStyle = "#ffb300"; g.fillRect(px + 7, py + 2, 2, 4);
        break;
      }
      case T.CAMPFIRE: {
        g.fillStyle = "#5d4326"; g.fillRect(px + 2, py + 13, 3, 3); g.fillRect(px + 11, py + 13, 3, 3);
        const flick = Math.sin(wx * 1.3 + wy * 0.7 + performance.now() * 0.006) * 1.2;
        g.fillStyle = "#ff7a1a";
        g.beginPath();
        g.moveTo(px + 8, py + 3 + flick); g.quadraticCurveTo(px + 13, py + 9, px + 8, py + 14);
        g.quadraticCurveTo(px + 3, py + 9, px + 8, py + 3 + flick);
        g.fill();
        g.fillStyle = "#ffd23c";
        g.beginPath();
        g.moveTo(px + 8, py + 7 + flick * 0.6); g.quadraticCurveTo(px + 11, py + 10, px + 8, py + 14);
        g.quadraticCurveTo(px + 5, py + 10, px + 8, py + 7 + flick * 0.6);
        g.fill();
        break;
      }
      case T.CROP1: {
        g.fillStyle = "#6b8f3a"; g.fillRect(px + 6, py + 11, 2, 5); g.fillRect(px + 9, py + 12, 2, 4);
        break;
      }
      case T.CROP2: {
        g.fillStyle = "#5f8f3a"; g.fillRect(px + 4, py + 7, 2, 9); g.fillRect(px + 10, py + 8, 2, 8);
        g.fillStyle = "#8fb573"; g.fillRect(px + 7, py + 9, 2, 7);
        break;
      }
      case T.CROP3: {
        g.fillStyle = "#5f8f3a"; g.fillRect(px + 4, py + 6, 2, 10); g.fillRect(px + 10, py + 7, 2, 9);
        g.fillStyle = "#8fb573"; g.fillRect(px + 7, py + 8, 2, 8);
        g.fillStyle = "#8c2440";
        g.beginPath(); g.arc(px + 5, py + 6, 2, 0, 7); g.fill();
        g.beginPath(); g.arc(px + 11, py + 7, 2, 0, 7); g.fill();
        g.beginPath(); g.arc(px + 8, py + 8, 2, 0, 7); g.fill();
        break;
      }
      case T.BED: {
        g.fillStyle = "#5d4326";
        g.fillRect(px, py + 12, 2, 4); g.fillRect(px + 14, py + 12, 2, 4);
        g.fillStyle = "#8a5a2b"; g.fillRect(px, py + 10, TILE, 3);
        g.fillStyle = "#c23a60"; g.fillRect(px + 1, py + 7, 14, 4);
        g.fillStyle = "#f2f8fd"; g.fillRect(px + 1, py + 6, 5, 3);
        break;
      }
      case T.GRIN_FRAG: {
        /* a small floating grin-shaped shard, always a little brighter
           than its surroundings so it reads as "pick this up" */
        const bob = Math.sin(wx * 0.7 + wy) * 1.2;
        g.fillStyle = "#ffe08a";
        g.beginPath();
        g.arc(px + 8, py + 8 + bob, 5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#1c1424";
        g.beginPath();
        g.arc(px + 8, py + 9 + bob, 3, 0.15, Math.PI - 0.15);
        g.fill();
        g.fillStyle = "#fff7d6";
        g.fillRect(px + 6, py + 5 + bob, 1, 1);
        break;
      }
      case T.PEPE_SCROLL: {
        /* a small rolled scroll, faint green glow so it reads in swamp fog */
        g.fillStyle = "#d8c98a";
        g.fillRect(px + 4, py + 6, 8, 5);
        g.fillStyle = "#8a7a4a";
        g.fillRect(px + 3, py + 6, 1, 5);
        g.fillRect(px + 12, py + 6, 1, 5);
        g.fillStyle = "#5f8f3a";
        g.fillRect(px + 6, py + 8, 4, 1);
        break;
      }
      case T.ROCKET_PART: {
        g.fillStyle = "#8a94a8";
        g.fillRect(px + 5, py + 5, 6, 8);
        g.fillStyle = "#5ec8d8";
        g.fillRect(px + 6, py + 6, 4, 3);
        g.fillStyle = "#e8b23c";
        g.fillRect(px + 6, py + 11, 4, 2);
        break;
      }
      case T.ROCKET_PAD: {
        g.fillStyle = "#3a3f52";
        g.fillRect(px, py + 12, TILE, 4);
        g.fillStyle = "#5ec8d8";
        g.fillRect(px + 2, py + 12, TILE - 4, 1);
        for (let n = 0; n < 3; n++) {
          g.fillStyle = n === (Math.floor(wx * 0.5 + wy) % 3) ? "#ffe08a" : "#5ec8d8";
          g.fillRect(px + 3 + n * 4, py + 13, 2, 2);
        }
        break;
      }
      case T.VAULT_DOOR: {
        g.fillStyle = "#2a2f42";
        g.fillRect(px, py, TILE, TILE);
        g.strokeStyle = "#7a8cff"; g.lineWidth = 1;
        g.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
        g.fillStyle = "#7a8cff";
        g.fillRect(px + 7, py + 6, 2, 2);
        g.fillRect(px + 7, py + 9, 2, 5);
        break;
      }
      case T.GRIN_ALTAR: {
        g.fillStyle = "#4a3f6b";
        g.fillRect(px + 1, py + 8, TILE - 2, 8);
        g.fillStyle = "#6b5a8f";
        g.fillRect(px + 2, py + 8, TILE - 4, 2);
        g.fillStyle = "#ffe08a";
        g.fillRect(px + 5, py + 2, 6, 5);
        g.fillStyle = "#1c1424";
        g.fillRect(px + 6, py + 3, 1, 1);
        g.fillRect(px + 9, py + 3, 1, 1);
        g.strokeStyle = "#1c1424"; g.lineWidth = 1;
        g.beginPath(); g.arc(px + 8, py + 5, 2, 0.2, Math.PI - 0.2); g.stroke();
        break;
      }
      case T.PLANT: {
        g.fillStyle = "#4faf54";
        const h1 = 4 + Math.floor(hash2(wx, wy, 3) * 6);
        for (let n = 0; n < 4; n++) {
          const bx = 2 + Math.floor(hash2(wx + n, wy, 7) * 12);
          g.fillRect(px + bx, py + TILE - h1 + (n % 2), 1, h1 - (n % 2) * 2);
        }
        if (hash2(wx, wy, 9) > 0.72) { g.fillStyle = "#ffd23c"; g.fillRect(px + 7, py + TILE - h1 - 2, 3, 3); }
        break;
      }
      case T.ROPE: {
        g.fillStyle = "#8a6d3a"; g.fillRect(px + 7, py, 2, TILE);
        g.fillStyle = "#6b5228";
        for (let n = 0; n < 3; n++) g.fillRect(px + 5, py + 2 + n * 5, 6, 1);
        break;
      }
      case T.FENCE: {
        g.fillStyle = "#6b4a26";
        g.fillRect(px + 2, py, 2, TILE); g.fillRect(px + 12, py, 2, TILE);
        g.fillStyle = "#8a5a2b";
        g.fillRect(px, py + 3, TILE, 2); g.fillRect(px, py + 10, TILE, 2);
        break;
      }
      case T.REPEATER_L:
      case T.REPEATER_R: {
        g.fillStyle = "#4e525a"; g.fillRect(px + 1, py + 10, TILE - 2, 5);
        g.fillStyle = "#e28448";
        g.fillRect(px + 3, py + 12, 3, 2); g.fillRect(px + 10, py + 12, 3, 2);
        g.fillStyle = "#ffb300";
        g.fillRect(id === T.REPEATER_L ? px + 2 : px + 11, py + 7, 3, 3);
        break;
      }
      case T.TIMER_TORCH: {
        g.fillStyle = "#8a5a2b"; g.fillRect(px + 7, py + 6, 2, 9);
        g.fillStyle = "#5ec8d8"; g.fillRect(px + 6, py + 3, 4, 4);
        g.fillStyle = "#c8f0f7"; g.fillRect(px + 7, py + 3, 2, 2);
        break;
      }
      case T.TIMER_TORCH_OFF: {
        g.fillStyle = "#8a5a2b"; g.fillRect(px + 7, py + 6, 2, 9);
        g.fillStyle = "#2a3a3e"; g.fillRect(px + 6, py + 3, 4, 4);
        break;
      }
      case T.TRAPDOOR_C: {
        g.fillStyle = "#6b4a26"; g.fillRect(px, py + 12, TILE, 4);
        g.fillStyle = "#4e3418"; g.fillRect(px, py + 12, TILE, 1);
        g.fillStyle = "#3d4149"; g.fillRect(px + 2, py + 14, 2, 1); g.fillRect(px + 12, py + 14, 2, 1);
        break;
      }
      case T.TRAPDOOR_O: {
        g.fillStyle = "#6b4a26"; g.fillRect(px, py + 12, 4, TILE - 12);
        g.fillStyle = "#4e3418"; g.fillRect(px, py + 12, 1, TILE - 12);
        break;
      }
      case T.ENCHANT_TABLE: {
        g.fillStyle = "#2f2347"; g.fillRect(px + 1, py + 9, TILE - 2, 6);
        g.fillStyle = "#4a3a70"; g.fillRect(px + 2, py + 9, TILE - 4, 2);
        g.fillStyle = "#8a6fd9"; g.fillRect(px + 5, py + 3, 6, 5);
        g.fillStyle = "#d9c8ff"; g.fillRect(px + 7, py + 4, 2, 3);
        break;
      }
      default: {
        g.fillStyle = "#f0f"; g.fillRect(px, py, TILE, TILE);
      }
    }
  }

  /* ================================================== per-frame passes */
  /* World tiles (camera transform must already be applied). */
  drawWorld(ctx, cam, vw, vh) {
    const c0x = Math.max(0, Math.floor(cam.x / CHUNK_PX));
    const c0y = Math.max(0, Math.floor(cam.y / CHUNK_PX));
    const c1x = Math.min(this.world.chunksX - 1, Math.floor((cam.x + vw) / CHUNK_PX));
    const c1y = Math.min(this.world.chunksY - 1, Math.floor((cam.y + vh) / CHUNK_PX));
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        ctx.drawImage(this.ensureChunk(cx, cy), cx * CHUNK_PX, cy * CHUNK_PX);
      }
    }
  }

  /* Tree canopies drawn above the tile layer. */
  drawCanopies(ctx, cam, vw, vh) {
    const x0 = cam.x - 64, x1 = cam.x + vw + 64;
    for (const tr of this.world.trees) {
      const wx = tr.x * TILE + TILE / 2;
      if (wx < x0 || wx > x1) continue;
      const topY = (tr.yBase - tr.h + 1) * TILE;
      const r = 20 + (tr.seed % 12);
      const g1 = "#2f7c3a", g2 = "#3e9e44", g3 = "#57bd5c";
      ctx.fillStyle = g1;
      ctx.beginPath(); ctx.arc(wx, topY, r, 0, 7); ctx.fill();
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(wx - r * 0.55, topY + r * 0.28, r * 0.72, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(wx + r * 0.55, topY + r * 0.24, r * 0.7, 0, 7); ctx.fill();
      ctx.fillStyle = g3;
      ctx.beginPath(); ctx.arc(wx - r * 0.2, topY - r * 0.3, r * 0.5, 0, 7); ctx.fill();
    }
  }

  /* Water / lava overlay (world space, after entities). */
  drawLiquids(ctx, cam, vw, vh) {
    const world = this.world;
    const tx0 = Math.max(0, Math.floor(cam.x / TILE));
    const ty0 = Math.max(0, Math.floor(cam.y / TILE));
    const tx1 = Math.min(world.w - 1, Math.ceil((cam.x + vw) / TILE));
    const ty1 = Math.min(world.h - 1, Math.ceil((cam.y + vh) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * world.w + tx;
        const amt = world.liquid[i];
        if (!amt) continue;
        const type = world.liquidType[i];
        const lava = type === 1, sludge = type === 2;
        const hpx = (amt / 8) * TILE;
        const y = ty * TILE + (TILE - hpx);
        ctx.fillStyle = lava ? "rgba(255,94,20,0.88)" : sludge ? "rgba(95,143,58,0.72)" : "rgba(38,108,220,0.55)";
        ctx.fillRect(tx * TILE, y, TILE, hpx);
        /* surface shimmer when the cell above is empty */
        if (amt >= 2 && (ty === 0 || world.liquid[i - world.w] === 0)) {
          ctx.fillStyle = lava ? "rgba(255,214,90,0.8)" : sludge ? "rgba(180,214,120,0.6)" : "rgba(160,208,255,0.5)";
          ctx.fillRect(tx * TILE, y, TILE, 1.5);
        }
      }
    }
  }

  /* Wire overlay — drawn only while the player holds the wrench or wire. */
  drawWires(ctx, cam, vw, vh) {
    const world = this.world;
    const tx0 = Math.max(0, Math.floor(cam.x / TILE));
    const ty0 = Math.max(0, Math.floor(cam.y / TILE));
    const tx1 = Math.min(world.w - 1, Math.ceil((cam.x + vw) / TILE));
    const ty1 = Math.min(world.h - 1, Math.ceil((cam.y + vh) / TILE));
    ctx.strokeStyle = "rgba(255,60,60,0.9)";
    ctx.lineWidth = 1.6;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!world.wires[ty * world.w + tx]) continue;
        const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
        let linked = false;
        ctx.beginPath();
        if (world.getWire(tx - 1, ty)) { ctx.moveTo(cx, cy); ctx.lineTo(cx - TILE / 2, cy); linked = true; }
        if (world.getWire(tx + 1, ty)) { ctx.moveTo(cx, cy); ctx.lineTo(cx + TILE / 2, cy); linked = true; }
        if (world.getWire(tx, ty - 1)) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - TILE / 2); linked = true; }
        if (world.getWire(tx, ty + 1)) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + TILE / 2); linked = true; }
        ctx.stroke();
        if (!linked) { ctx.fillStyle = "rgba(255,60,60,0.9)"; ctx.fillRect(cx - 2, cy - 2, 4, 4); }
      }
    }
  }

  /* Mining cracks for currently damaged tiles. */
  drawCracks(ctx) {
    const world = this.world;
    for (const [i, hp] of world.damage) {
      const def = TILES[world.tiles[i]];
      if (!def || !def.hp || def.hp === Infinity) continue;
      const frac = 1 - hp / def.hp;
      const tx = i % world.w, ty = (i / world.w) | 0;
      const px = tx * TILE, py = ty * TILE;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 1;
      const n = 1 + Math.floor(frac * 4);
      for (let k = 0; k < n; k++) {
        const sx = px + 2 + hash2(i, k, 3) * 12, sy = py + 2 + hash2(i, k, 5) * 12;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (hash2(i, k, 7) - 0.5) * 10, sy + (hash2(i, k, 9) - 0.5) * 10);
        ctx.stroke();
      }
    }
  }

  /* ===================================================== screen passes */
  drawSky(ctx, sw, sh, t, camY, trollMoon) {
    const st = skyState(t);
    const b = st.bright;
    /* deeper underground -> darker sky backdrop (cave backdrop) */
    const depthFade = clamp((camY / TILE - 320) / 200, 0, 1);
    let top = mixHex("#0b1026", "#4a94d8", b);
    let bot = mixHex("#141a33", "#a8d4ee", b);
    if (st.warm > 0) {
      top = mixHex(top, "#c96a3a", st.warm * 0.55);
      bot = mixHex(bot, "#f0a05a", st.warm * 0.6);
    }
    if (trollMoon && st.isNight) { top = mixHex(top, "#4a0f16", 0.55); bot = mixHex(bot, "#71121d", 0.45); }
    const grad = ctx.createLinearGradient(0, 0, 0, sh);
    grad.addColorStop(0, mixHex(top, "#08080c", depthFade));
    grad.addColorStop(1, mixHex(bot, "#0d0d12", depthFade));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, sw, sh);

    if (depthFade > 0.95) return;

    /* stars */
    if (st.bright < 0.45) {
      const alpha = (1 - st.bright / 0.45) * (1 - depthFade);
      ctx.fillStyle = `rgba(255,255,255,${(0.85 * alpha).toFixed(3)})`;
      for (let n = 0; n < 110; n++) {
        const x = hash2(n, 1, 42) * sw, y = hash2(n, 2, 42) * sh * 0.7;
        const tw = hash2(n, 3, 42) > 0.9 ? 2 : 1;
        ctx.fillRect(x, y, tw, tw);
      }
    }

    /* sun / moon travel an arc */
    const orb = (frac, rise) => {
      const x = lerp(-40, sw + 40, frac);
      const y = sh * 0.72 - Math.sin(frac * Math.PI) * sh * 0.55;
      return { x, y };
    };
    if (!st.isNight) {
      const p = orb(st.sunFrac);
      const glow = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 70);
      glow.addColorStop(0, "rgba(255,214,90,0.9)");
      glow.addColorStop(1, "rgba(255,214,90,0)");
      ctx.fillStyle = glow; ctx.fillRect(p.x - 70, p.y - 70, 140, 140);
      ctx.fillStyle = "#ffd23c";
      ctx.beginPath(); ctx.arc(p.x, p.y, 18, 0, 7); ctx.fill();
    } else {
      const p = orb(st.moonFrac);
      ctx.fillStyle = trollMoon ? "#e0533f" : "#e8e6da";
      ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, 7); ctx.fill();
      /* cheeky grin on the moon */
      ctx.strokeStyle = trollMoon ? "#5a100e" : "#9a988c";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y + 2, 8, 0.25, Math.PI - 0.25); ctx.stroke();
      ctx.fillStyle = trollMoon ? "#5a100e" : "#9a988c";
      ctx.fillRect(p.x - 6, p.y - 4, 2, 2); ctx.fillRect(p.x + 4, p.y - 4, 2, 2);
    }
  }

  /* Parallax hills, biome-tinted (screen space, after sky). */
  drawParallax(ctx, sw, sh, cam, t, biome) {
    const st = skyState(t);
    const depthFade = clamp((cam.y / TILE - 300) / 160, 0, 1);
    if (depthFade >= 1) return;
    const base = biome === "desert" ? ["#8f7a4a", "#6e5d38"]
      : biome === "snow" ? ["#7d95ab", "#5c7286"]
      : biome === "jungle" ? ["#2e6b3d", "#1f4d2c"]
      : biome === "ocean" ? ["#3d5b8f", "#2c4268"]
      : ["#3d6b4b", "#2c5039"];
    const layers = [
      { col: base[0], amp: 60, speed: 0.18, yOff: 0.62 },
      { col: base[1], amp: 90, speed: 0.34, yOff: 0.74 },
    ];
    for (const L of layers) {
      ctx.fillStyle = mixHex(mixHex(L.col, "#0a0d18", 1 - st.bright), "#0a0d18", depthFade);
      ctx.beginPath();
      ctx.moveTo(0, sh);
      for (let x = 0; x <= sw; x += 16) {
        const wx = (cam.x * L.speed + x);
        const y = sh * L.yOff - octave1(wx / 16, 900 + L.amp, 1 / 26, 3) * L.amp - cam.y * 0.04;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(sw, sh);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* Smoothed light overlay (screen space). */
  drawLight(ctx, lighting, cam, sw, sh) {
    if (!lighting.buf) return;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    const s = TILE * ZOOM;
    ctx.drawImage(
      lighting.canvas,
      0, 0, lighting.rw, lighting.rh,
      (lighting.x0 * TILE - cam.x) * ZOOM,
      (lighting.y0 * TILE - cam.y) * ZOOM,
      lighting.rw * s, lighting.rh * s
    );
    ctx.restore();
  }
}
