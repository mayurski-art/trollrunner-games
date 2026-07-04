/* TrollTerra — bootstrap + game loop.
   Draw order per frame:
     sky -> parallax -> [world transform: tiles -> canopies -> entities ->
     player -> particles -> cracks -> liquids] -> light overlay -> HUD (DOM)
*/

import { TILE, ZOOM, CYCLE, DAY_LEN, WORLD_W } from "./defs.js";
import { hashStr, mulberry32, clamp, lerp, fmtClock } from "./util.js";
import { generateWorld, biomeAt } from "./worldgen.js";
import { Renderer, skyState } from "./render.js";
import { Lighting } from "./lighting.js";
import { Input } from "./input.js";

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

    this.player = null;            // phase 2
    this.entities = [];            // drops, projectiles, particles, damage text
    this.enemies = [];
    this.freeCam = true;           // phase 1 debug flight; player takes over later
    this.debug = false;

    this.cam = { x: 0, y: 0 };
    this.lighting = new Lighting();
    this.fps = 0;
    this._fpsAcc = 0; this._fpsN = 0;

    this.newWorld("troll-runner-" + Math.floor(Math.random() * 1e9));
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
    this.cam.x = spawn.x * TILE - 400;
    this.cam.y = spawn.y * TILE - 260;
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

    if (this.input.hit("F3")) this.debug = !this.debug;

    if (this.freeCam) this.updateFreeCam(dt);
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

    for (const e of this.entities) if (e.draw) e.draw(ctx, this);
    for (const e of this.enemies) if (e.draw) e.draw(ctx, this);
    if (this.player) this.player.draw(ctx, this);

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

  /* Dynamic light sources (extended by later phases). */
  lightSources() {
    return [];
  }

  drawHover(ctx) {
    const m = this.mouseWorld();
    if (!this.world.inBounds(m.tx, m.ty)) return;
    ctx.setTransform(ZOOM, 0, 0, ZOOM, -Math.round(this.cam.x * ZOOM), -Math.round(this.cam.y * ZOOM));
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(m.tx * TILE + 0.5, m.ty * TILE + 0.5, TILE - 1, TILE - 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawDebug(ctx) {
    const m = this.mouseWorld();
    const st = skyState(this.time);
    const lines = [
      `fps ${this.fps} · chunks ${this.renderer.chunks.size} · entities ${this.entities.length + this.enemies.length}`,
      `cam ${Math.round(this.cam.x)},${Math.round(this.cam.y)} · tile ${m.tx},${m.ty}`,
      `day ${this.dayCount} · ${fmtClock(this.time, DAY_LEN, CYCLE - DAY_LEN)} · ${st.isNight ? "night" : "day"} · sky ${st.skyLight}`,
      `seed ${this.seedStr}`,
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
