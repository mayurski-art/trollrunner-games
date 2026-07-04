/* TrollTerra — bootstrap + game loop + world-interaction rules.
   Draw order per frame:
     sky -> parallax -> [world transform: tiles -> canopies -> entities ->
     player -> particles -> cracks -> liquids] -> light overlay -> HUD (DOM)
*/

import {
  T, TILES, W, ITEMS, TILE, ZOOM, CYCLE, DAY_LEN, WORLD_W, REACH,
  STATION_SCAN, STARTER_ITEMS,
} from "./defs.js";
import { hashStr, clamp, lerp, fmtClock } from "./util.js";
import { generateWorld, biomeAt } from "./worldgen.js";
import { Renderer, skyState } from "./render.js";
import { Lighting } from "./lighting.js";
import { Input } from "./input.js";
import { Player } from "./player.js";
import { Inventory } from "./inventory.js";
import { ItemDrop, DamageText, burst } from "./entities.js";
import { UI } from "./ui.js";

const FIXED_DT = 1 / 60;

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    this.input = new Input(canvas);

    this.state = "play";           // menu | play | pause (menus arrive in phase 7)
    this.time = 60;                // seconds into the day/night cycle
    this.dayCount = 1;
    this.trollMoon = false;

    this.entities = [];            // drops, projectiles, particles, damage text
    this.enemies = [];
    this.npcs = [];
    this.freeCam = false;          // F4 debug flight
    this.debug = false;
    this.pointerOverUI = false;
    this.deathTimer = 0;

    this.stats = { blocksMined: 0, deepest: 0, bossKills: 0, playSec: 0 };

    this.cam = { x: 0, y: 0 };
    this.lighting = new Lighting();
    this.fps = 0;
    this._fpsAcc = 0; this._fpsN = 0;
    this._wallProg = { idx: -1, t: 0 };

    this.newWorld("troll-runner-" + Math.floor(Math.random() * 1e9));
    this.ui = new UI(this);
    this.resize();
    window.addEventListener("resize", () => this.resize());

    this._last = performance.now();
    this._acc = 0;
    requestAnimationFrame(t => this.frame(t));
  }

  newWorld(seedStr) {
    this.seedStr = seedStr;
    this.seed = hashStr(seedStr);
    const { world, spawn, surface } = generateWorld(this.seed);
    this.world = world;
    this.spawn = spawn;
    this.surface = surface;
    this.renderer = new Renderer(world, this.seed);
    this.entities = [];
    this.enemies = [];
    this.npcs = [];
    this.inventory = new Inventory();
    for (const s of STARTER_ITEMS) this.inventory.add(s.id, s.n);
    this.player = new Player(spawn.x, spawn.y + 1);
    this.cam.x = this.player.cx - 400;
    this.cam.y = this.player.cy - 260;
    if (this.ui) this.ui.dirtyInv();
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.ctx.imageSmoothingEnabled = false;
  }

  get viewW() { return this.canvas.width / ZOOM; }
  get viewH() { return this.canvas.height / ZOOM; }

  /* ------------------------------------------------------------- loop */
  frame(now) {
    const raw = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    this._acc += raw;
    while (this._acc >= FIXED_DT) {
      this.update(FIXED_DT);
      this._acc -= FIXED_DT;
    }
    this.render();
    this.input.flush();

    this._fpsAcc += raw; this._fpsN++;
    if (this._fpsAcc >= 0.5) { this.fps = Math.round(this._fpsN / this._fpsAcc); this._fpsAcc = 0; this._fpsN = 0; }
    requestAnimationFrame(t => this.frame(t));
  }

  update(dt) {
    if (this.state !== "play") return;

    /* time of day */
    this.time += dt;
    if (this.time >= CYCLE) {
      this.time -= CYCLE;
      this.dayCount++;
      this.trollMoon = false;
    }
    this.stats.playSec += dt;

    if (this.input.hit("F3")) this.debug = !this.debug;
    if (this.input.hit("F4")) this.freeCam = !this.freeCam;

    this.pointerOverUI = this.ui ? this.ui.pointerOver : false;

    /* player */
    if (this.player) {
      if (this.player.dead) {
        this.deathTimer -= dt;
        if (this.deathTimer <= 0) this.player.respawn(this);
      } else {
        this.player.update(dt, this);
        this.stats.deepest = Math.max(
          this.stats.deepest,
          (Math.floor(this.player.y / TILE) - 260) * 2
        );
      }
    }

    /* entities */
    for (const e of this.entities) e.update(dt, this);
    for (const e of this.enemies) e.update(dt, this);
    for (const e of this.npcs) e.update(dt, this);
    if (this.entities.some(e => e.dead)) this.entities = this.entities.filter(e => !e.dead);
    if (this.enemies.some(e => e.dead)) this.enemies = this.enemies.filter(e => !e.dead);

    /* camera */
    if (this.freeCam) {
      this.updateFreeCam(dt);
    } else if (this.player) {
      const k = 1 - Math.exp(-9 * dt);
      this.cam.x = lerp(this.cam.x, this.player.cx - this.viewW / 2, k);
      this.cam.y = lerp(this.cam.y, this.player.cy - this.viewH * 0.55, k);
      this.clampCam();
    }

    if (this.ui) this.ui.update(dt);
  }

  updateFreeCam(dt) {
    const sp = (this.input.down("ShiftLeft") ? 1400 : 520) * dt;
    if (this.input.down("KeyA") || this.input.down("ArrowLeft")) this.cam.x -= sp;
    if (this.input.down("KeyD") || this.input.down("ArrowRight")) this.cam.x += sp;
    if (this.input.down("KeyW") || this.input.down("ArrowUp")) this.cam.y -= sp;
    if (this.input.down("KeyS") || this.input.down("ArrowDown")) this.cam.y += sp;
    this.clampCam();
  }

  clampCam() {
    this.cam.x = clamp(this.cam.x, 0, this.world.w * TILE - this.viewW);
    this.cam.y = clamp(this.cam.y, 0, this.world.h * TILE - this.viewH);
  }

  /* Mouse position in world px / tiles. */
  mouseWorld() {
    const wx = this.cam.x + this.input.mouse.x / ZOOM;
    const wy = this.cam.y + this.input.mouse.y / ZOOM;
    return { x: wx, y: wy, tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE) };
  }

  /* ==================================================== world editing */
  /* One tick of mining at (tx,ty) with a tool def. */
  mineTick(tx, ty, tool, player) {
    const world = this.world;
    const id = world.get(tx, ty);
    const def = TILES[id];

    /* hammer: strip background walls where there's no tile in the way */
    if (tool.tool === "hammer") {
      if (id === T.AIR && world.getWall(tx, ty) !== W.NONE) {
        player.startSwing(1 / tool.speed);
        const idx = world.idx(tx, ty);
        if (this._wallProg.idx !== idx) this._wallProg = { idx, t: 0 };
        this._wallProg.t += tool.power * tool.speed * FIXED_DT;
        if (this._wallProg.t >= 90) {
          const wDef = world.getWall(tx, ty);
          const dropId = wDef ? (this.wallDrop(wDef)) : null;
          world.setWall(tx, ty, W.NONE);
          if (dropId) this.spawnDrop(tx * TILE + 8, ty * TILE + 8, dropId, 1);
          this._wallProg = { idx: -1, t: 0 };
          this.sfx && this.sfx.dig();
        }
      }
      return;
    }

    if (id === T.AIR || !def || def.hp === Infinity) return;
    /* soft deco breaks with anything */
    const soft = id === T.PLANT || id === T.SHROOM || id === T.TORCH;
    if (!soft) {
      if (def.tool === "axe" && tool.tool !== "axe") return;
      if (def.tool === "pick" && tool.tool !== "pick") return;
      if (tool.power < (def.pow || 0)) {
        player.startSwing(1 / tool.speed);
        burst(this, tx * TILE + 8, ty * TILE + 8, "#c9c2b8", 1, { life: 0.25, spread: 60 });
        return;
      }
    }
    player.startSwing(1 / tool.speed);
    const dmg = tool.power * tool.speed * FIXED_DT * (soft ? 30 : 1);
    if (world.damageTile(tx, ty, dmg)) this.breakTileAt(tx, ty);
    else if (Math.random() < 0.2) {
      this.sfx && this.sfx.tink(def.tool === "axe");
      if (def.pal) burst(this, tx * TILE + 8, ty * TILE + 8, def.pal[1], 2, { life: 0.3, spread: 90 });
    }
  }

  wallDrop(wallId) {
    for (const id in ITEMS) if (ITEMS[id].type === "wall" && ITEMS[id].wall === wallId) return id;
    return null;
  }

  breakTileAt(tx, ty) {
    const world = this.world;
    const id = world.get(tx, ty);
    if (id === T.AIR) return;
    const def = TILES[id];
    const px = tx * TILE + TILE / 2, py = ty * TILE + TILE / 2;

    if (id === T.TREE) {
      const tree = world.treeAt(tx, ty);
      if (tree) {
        world.removeTree(tree);
        this.spawnDrop(px, (tree.yBase - tree.h / 2) * TILE, "wood", Math.max(4, tree.h * 2));
        burst(this, px, (tree.yBase - tree.h) * TILE, "#3e9e44", 14, { spread: 220 });
        burst(this, px, py, "#66451f", 8);
      } else {
        world.set(tx, ty, T.AIR);
        this.spawnDrop(px, py, "wood", 1);
      }
      this.sfx && this.sfx.chop();
    } else if (id === T.HEART) {
      world.set(tx, ty, T.AIR);
      const p = this.player;
      if (p.maxHp < 200) {
        p.maxHp += 20;
        p.hp = Math.min(p.maxHp, p.hp + 20);
        this.floatText(px, py - 8, "+20 MAX HP", "#ff6d95");
      } else {
        this.floatText(px, py - 8, "MAX TROLL VITALITY", "#ff6d95");
      }
      burst(this, px, py, "#e85f86", 16, { spread: 240, glow: true });
      this.sfx && this.sfx.powerup();
      this.ui && this.ui.dirtyHud();
    } else if (id === T.CHEST) {
      const key = world.chestKey(tx, ty);
      const chest = world.chests.get(key);
      if (chest) {
        for (const s of chest.items) if (s) this.spawnDrop(px, py, s.id, s.n);
        world.chests.delete(key);
      }
      if (this.ui && this.ui.closeChestIf) this.ui.closeChestIf(key);
      world.set(tx, ty, T.AIR);
      this.spawnDrop(px, py, "chest", 1);
    } else if (id === T.DOOR_C || id === T.DOOR_O) {
      const other = world.get(tx, ty - 1) === id ? ty - 1 : ty + 1;
      world.set(tx, ty, T.AIR);
      if (world.get(tx, other) === id) world.set(tx, other, T.AIR);
      this.spawnDrop(px, py, "door", 1);
    } else {
      world.set(tx, ty, T.AIR);
      if (def.drop) this.spawnDrop(px, py, def.drop, 1);
    }

    if (def.pal) burst(this, px, py, def.pal[1], 7);
    this.sfx && this.sfx.dig();
    this.stats.blocksMined++;

    /* knock loose anything that needed this tile */
    this.checkSupport(tx, ty - 1);
    this.checkSupport(tx - 1, ty);
    this.checkSupport(tx + 1, ty);
  }

  /* Break tiles that lost their support (furniture, torches, deco). */
  checkSupport(tx, ty) {
    const world = this.world;
    const id = world.get(tx, ty);
    if (id === T.AIR) return;
    const def = TILES[id];
    const below = world.get(tx, ty + 1);
    const belowSolid = TILES[below] && (TILES[below].solid || TILES[below].oneWay);

    if ((id === T.PLANT || id === T.SHROOM) && !belowSolid) {
      world.set(tx, ty, T.AIR);
      if (def.drop) this.spawnDrop(tx * TILE + 8, ty * TILE + 8, def.drop, 1);
      return;
    }
    if (id === T.TORCH && !this.torchSupported(tx, ty)) {
      world.set(tx, ty, T.AIR);
      this.spawnDrop(tx * TILE + 8, ty * TILE + 8, "torch", 1);
      return;
    }
    const item = def.drop ? ITEMS[def.drop] : null;
    if (item && item.needsFloor && !belowSolid) {
      this.breakTileAt(tx, ty);
    }
  }

  torchSupported(tx, ty) {
    const world = this.world;
    if (world.getWall(tx, ty) !== W.NONE) return true;
    return world.isSolid(tx - 1, ty) || world.isSolid(tx + 1, ty) || world.isSolid(tx, ty + 1);
  }

  /* Place the selected block item at (tx,ty). Returns success. */
  tryPlace(tx, ty, itemId) {
    const world = this.world;
    const def = ITEMS[itemId];
    const tdef = TILES[def.tile];
    const cur = world.get(tx, ty);
    const replaceable = cur === T.AIR || cur === T.PLANT;
    if (!replaceable) return false;

    /* don't entomb yourself or the mobs */
    if (tdef.solid) {
      const box = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
      const bodies = [this.player, ...this.enemies, ...this.npcs];
      for (const b of bodies) {
        if (b && !b.dead &&
            box.x < b.x + b.w && box.x + box.w > b.x &&
            box.y < b.y + b.h && box.y + box.h > b.y) return false;
      }
    }

    const belowSolid = world.isSolid(tx, ty + 1) || world.isOneWay(tx, ty + 1);
    if (def.needsFloor && !belowSolid) return false;
    if (def.needsSupport && !this.torchSupported(tx, ty)) return false;
    if (def.tall === 2) {
      if (world.get(tx, ty - 1) !== T.AIR || !belowSolid) return false;
    }
    /* generic support: neighbour tile or wall behind */
    if (!def.needsFloor && !def.needsSupport) {
      const support =
        world.isSolid(tx - 1, ty) || world.isSolid(tx + 1, ty) ||
        world.isSolid(tx, ty - 1) || world.isSolid(tx, ty + 1) ||
        world.isOneWay(tx - 1, ty) || world.isOneWay(tx + 1, ty) ||
        world.get(tx - 1, ty) === T.TREE || world.get(tx + 1, ty) === T.TREE ||
        world.getWall(tx, ty) !== W.NONE;
      if (!support) return false;
    }

    this.inventory.useSelected();
    world.set(tx, ty, def.tile);
    if (tdef.solid) world.setLiquid(tx, ty, 0);
    if (def.tall === 2) world.set(tx, ty - 1, def.tile);
    if (def.tile === T.CHEST) world.addChest(tx, ty);
    this.sfx && this.sfx.place();
    this.ui && this.ui.dirtyHud();
    return true;
  }

  tryPlaceWall(tx, ty, itemId) {
    const world = this.world;
    const def = ITEMS[itemId];
    if (world.getWall(tx, ty) !== W.NONE) return false;
    if (world.isSolid(tx, ty)) return false;
    const support =
      world.getWall(tx - 1, ty) || world.getWall(tx + 1, ty) ||
      world.getWall(tx, ty - 1) || world.getWall(tx, ty + 1) ||
      world.isSolid(tx - 1, ty) || world.isSolid(tx + 1, ty) ||
      world.isSolid(tx, ty - 1) || world.isSolid(tx, ty + 1);
    if (!support) return false;
    this.inventory.useSelected();
    world.setWall(tx, ty, def.wall);
    this.sfx && this.sfx.place();
    this.ui && this.ui.dirtyHud();
    return true;
  }

  /* Right-click: doors, chests, NPCs. */
  interact() {
    const m = this.mouseWorld();
    const world = this.world;
    if (!this.player || !this.player.tileInReach(m.tx, m.ty)) return;
    const id = world.get(m.tx, m.ty);

    if (id === T.DOOR_C) {
      const otherY = world.get(m.tx, m.ty - 1) === T.DOOR_C ? m.ty - 1 : m.ty + 1;
      world.set(m.tx, m.ty, T.DOOR_O);
      if (world.get(m.tx, otherY) === T.DOOR_C) world.set(m.tx, otherY, T.DOOR_O);
      this.sfx && this.sfx.door();
      return;
    }
    if (id === T.DOOR_O) {
      const otherY = world.get(m.tx, m.ty - 1) === T.DOOR_O ? m.ty - 1 : m.ty + 1;
      const y0 = Math.min(m.ty, otherY);
      const box = { x: m.tx * TILE, y: y0 * TILE, w: TILE, h: TILE * 2 };
      const bodies = [this.player, ...this.enemies, ...this.npcs];
      for (const b of bodies) {
        if (b && !b.dead &&
            box.x < b.x + b.w && box.x + box.w > b.x &&
            box.y < b.y + b.h && box.y + box.h > b.y) return;
      }
      world.set(m.tx, m.ty, T.DOOR_C);
      if (world.get(m.tx, otherY) === T.DOOR_O) world.set(m.tx, otherY, T.DOOR_C);
      this.sfx && this.sfx.door();
      return;
    }
    if (id === T.CHEST && this.ui && this.ui.openChest) {
      this.ui.openChest(m.tx, m.ty);
      return;
    }
    /* NPC chat */
    for (const n of this.npcs) {
      if (Math.abs(n.cx - m.x) < 24 && Math.abs(n.cy - m.y) < 30 && this.ui && this.ui.openDialog) {
        this.ui.openDialog(n);
        return;
      }
    }
  }

  /* ========================================================== helpers */
  spawnDrop(x, y, itemId, n, vx) {
    const d = new ItemDrop(x, y, itemId, n);
    if (vx !== undefined) { d.vx = vx; d.vy = -60; }
    this.entities.push(d);
    return d;
  }

  floatText(x, y, text, color) {
    this.entities.push(new DamageText(x, y, text, color));
  }

  onPlayerDeath(cause) {
    this.deathTimer = 4;
    burst(this, this.player.cx, this.player.cy, "#e8e4da", 18, { spread: 260 });
    this.floatText(this.player.cx, this.player.y - 10, "YOU GOT TROLLED", "#ff4d5e");
    this.sfx && this.sfx.death();
  }

  /* Dynamic light sources: held torch, glowing entities. */
  lightSources() {
    const out = [];
    const p = this.player;
    if (p && !p.dead) {
      const sel = this.inventory.selected;
      if (sel && sel.id === "torch") {
        out.push({ tx: Math.floor(p.cx / TILE), ty: Math.floor(p.cy / TILE), level: 200 });
      }
    }
    for (const e of this.entities) {
      if (e.light) out.push({ tx: Math.floor(e.cx / TILE), ty: Math.floor(e.cy / TILE), level: e.light });
    }
    for (const e of this.enemies) {
      if (e.light) out.push({ tx: Math.floor(e.cx / TILE), ty: Math.floor(e.cy / TILE), level: e.light });
    }
    return out;
  }

  /* ----------------------------------------------------------- render */
  render() {
    const ctx = this.ctx;
    const sw = this.canvas.width, sh = this.canvas.height;
    const cam = this.cam;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const camMidX = Math.floor((cam.x + this.viewW / 2) / TILE);
    const biome = biomeAt(clamp(camMidX, 0, WORLD_W - 1), this.world.w);
    this.renderer.drawSky(ctx, sw, sh, this.time, cam.y, this.trollMoon);
    this.renderer.drawParallax(ctx, sw, sh, cam, this.time, biome);

    /* world space */
    ctx.setTransform(ZOOM, 0, 0, ZOOM, -Math.round(cam.x * ZOOM), -Math.round(cam.y * ZOOM));
    ctx.imageSmoothingEnabled = false;
    this.renderer.drawWorld(ctx, cam, this.viewW, this.viewH);
    this.renderer.drawCanopies(ctx, cam, this.viewW, this.viewH);

    for (const e of this.npcs) if (e.draw) e.draw(ctx, this);
    for (const e of this.enemies) if (e.draw) e.draw(ctx, this);
    if (this.player) this.player.draw(ctx, this);
    for (const e of this.entities) if (e.draw) e.draw(ctx, this);

    this.renderer.drawCracks(ctx);
    this.renderer.drawLiquids(ctx, cam, this.viewW, this.viewH);

    /* lighting */
    const st = skyState(this.time);
    const pad = 14;
    const tx0 = Math.floor(cam.x / TILE) - pad;
    const ty0 = Math.floor(cam.y / TILE) - pad;
    const tw = Math.ceil(this.viewW / TILE) + pad * 2;
    const th = Math.ceil(this.viewH / TILE) + pad * 2;
    this.lighting.compute(this.world, tx0, ty0, tw, th, st.skyLight, this.lightSources());
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.renderer.drawLight(ctx, this.lighting, cam, sw, sh);

    if (this.trollMoon && st.isNight) {
      ctx.fillStyle = "rgba(160,20,28,0.10)";
      ctx.fillRect(0, 0, sw, sh);
    }

    this.drawHover(ctx);
    if (this.debug) this.drawDebug(ctx);
  }

  drawHover(ctx) {
    if (this.pointerOverUI) return;
    const m = this.mouseWorld();
    if (!this.world.inBounds(m.tx, m.ty)) return;
    const inReach = this.player && !this.player.dead && this.player.tileInReach(m.tx, m.ty);
    ctx.setTransform(ZOOM, 0, 0, ZOOM, -Math.round(this.cam.x * ZOOM), -Math.round(this.cam.y * ZOOM));
    ctx.strokeStyle = inReach ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(m.tx * TILE + 0.5, m.ty * TILE + 0.5, TILE - 1, TILE - 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawDebug(ctx) {
    const m = this.mouseWorld();
    const st = skyState(this.time);
    const lines = [
      `fps ${this.fps} · chunks ${this.renderer.chunks.size} · ent ${this.entities.length} · foes ${this.enemies.length}`,
      `cam ${Math.round(this.cam.x)},${Math.round(this.cam.y)} · tile ${m.tx},${m.ty} · freecam(F4) ${this.freeCam}`,
      `day ${this.dayCount} · ${fmtClock(this.time, DAY_LEN, CYCLE - DAY_LEN)} · ${st.isNight ? "night" : "day"} · sky ${st.skyLight}`,
      `seed ${this.seedStr} · mined ${this.stats.blocksMined} · deepest ${this.stats.deepest}ft`,
    ];
    ctx.font = "12px monospace";
    ctx.textBaseline = "top";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(8, 8 + i * 16, ctx.measureText(lines[i]).width + 10, 15);
      ctx.fillStyle = "#9fe870";
      ctx.fillText(lines[i], 13, 10 + i * 16);
    }
  }
}

/* ------------------------------------------------------------------ boot */
function boot() {
  const canvas = document.getElementById("tt-canvas");
  if (!canvas) { console.error("[trollterra] canvas missing"); return; }
  window.TT = new Game(canvas);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
