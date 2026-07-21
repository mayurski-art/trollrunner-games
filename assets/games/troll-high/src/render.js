/* Troll High — camera + compositing. World renders at native pixel scale
   into a small backbuffer, then blits integer-scaled to the screen. */

import { TILE, clamp } from "./util.js";
import { nightAmount } from "./clock.js";

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.back = document.createElement("canvas");
    this.bctx = this.back.getContext("2d");
    this.scale = 3;
    this.camX = 0; this.camY = 0;
    this._resize();
    addEventListener("resize", () => this._resize());
  }

  _resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    // aim for ~26-32 tiles across; integer scale keeps pixels crisp. Most
    // classrooms are ~20 tiles wide, so this leaves visible margin around
    // the room instead of the walls nearly touching the viewport edges.
    this.scale = clamp(Math.round(this.canvas.width / (TILE * 27)), 1, 3);
    this.back.width = Math.ceil(this.canvas.width / this.scale);
    this.back.height = Math.ceil(this.canvas.height / this.scale);
    this.bctx.imageSmoothingEnabled = false;
    this.ctx.imageSmoothingEnabled = false;
  }

  /* Center on (x, y) clamped to zone bounds (small zones center themselves). */
  follow(x, y, zone) {
    const vw = this.back.width, vh = this.back.height;
    const ww = zone.w * TILE, wh = zone.h * TILE;
    this.camX = ww <= vw ? (ww - vw) / 2 : clamp(x - vw / 2, 0, ww - vw);
    this.camY = wh <= vh ? (wh - vh) / 2 : clamp(y - vh / 2, 0, wh - vh);
  }

  /* Weather particles (design doc Phase 12 "weather/particles pass") —
     only wired up for Snow Day so far (events.js), since that's the one
     event with enough visual weight to justify it for v1. Self-tracks
     dt so frame()'s signature doesn't need to change for callers that
     don't care about weather. */
  _updateSnow() {
    const now = performance.now();
    const dt = this._snowLastT ? Math.min(0.05, (now - this._snowLastT) / 1000) : 0;
    this._snowLastT = now;
    if (!this._snow) {
      this._snow = Array.from({ length: 50 }, () => ({
        x: Math.random() * this.back.width, y: Math.random() * this.back.height,
        speed: 14 + Math.random() * 18, drift: (Math.random() - 0.5) * 10, size: 1 + Math.random() * 1.5,
      }));
    }
    for (const p of this._snow) {
      p.y += p.speed * dt; p.x += p.drift * dt;
      if (p.y > this.back.height) { p.y = -4; p.x = Math.random() * this.back.width; }
      if (p.x > this.back.width) p.x = 0; else if (p.x < 0) p.x = this.back.width;
    }
  }
  _drawSnow(b) {
    this._updateSnow();
    b.fillStyle = "rgba(255, 255, 255, 0.85)";
    for (const p of this._snow) { b.beginPath(); b.arc(p.x, p.y, p.size, 0, Math.PI * 2); b.fill(); }
  }

  frame(zone, entities, fade, eventTint, weather) {
    const b = this.bctx;
    b.fillStyle = "#14110c";
    b.fillRect(0, 0, this.back.width, this.back.height);

    b.save();
    b.translate(-Math.round(this.camX), -Math.round(this.camY));
    zone.draw(b, entities);
    b.restore();

    // day/night tint from the shared clock
    const night = nightAmount();
    if (night > 0) {
      b.fillStyle = `rgba(18, 22, 54, ${0.42 * night})`;
      b.fillRect(0, 0, this.back.width, this.back.height);
    }

    // seasonal event tint (Halloween/Snow Day — events.js), same technique
    // as the day/night tint, layered on top of it
    if (eventTint) {
      b.fillStyle = eventTint;
      b.fillRect(0, 0, this.back.width, this.back.height);
    }

    if (weather === "snow-day") this._drawSnow(b);

    // zone-transition fade
    if (fade > 0) {
      b.fillStyle = `rgba(10, 8, 5, ${fade})`;
      b.fillRect(0, 0, this.back.width, this.back.height);
    }

    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(
      this.back,
      0, 0, this.back.width, this.back.height,
      0, 0, this.back.width * this.scale, this.back.height * this.scale
    );
  }
}
