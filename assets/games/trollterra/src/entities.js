/* TrollTerra — world entities: item drops, particles, damage text.
   (Enemies, projectiles and the boss are added by later sections.) */

import { TILE, ITEMS, GRAVITY, MAX_FALL } from "./defs.js";
import { getIcon } from "./icons.js";
import { clamp, aabb, dist2 } from "./util.js";

let NEXT_ID = 1;

export class Entity {
  constructor(x, y, w, h) {
    this.id = NEXT_ID++;
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.vx = 0; this.vy = 0;
    this.dead = false;
    this.onGround = false;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  get box() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

  /* Axis-separated tile collision. Returns {hitX, hitY}. */
  moveCollide(world, dt, oneWayFeet = false, dropThrough = false) {
    const res = { hitX: false, hitY: false };
    /* X */
    let nx = this.x + this.vx * dt;
    if (this.vx !== 0) {
      const dir = Math.sign(this.vx);
      const edge = dir > 0 ? nx + this.w : nx;
      const tx = Math.floor(edge / TILE);
      const y0 = Math.floor(this.y / TILE), y1 = Math.floor((this.y + this.h - 0.01) / TILE);
      for (let ty = y0; ty <= y1; ty++) {
        if (world.isSolid(tx, ty)) {
          nx = dir > 0 ? tx * TILE - this.w - 0.01 : (tx + 1) * TILE + 0.01;
          this.vx = 0; res.hitX = true;
          break;
        }
      }
    }
    this.x = nx;

    /* Y */
    let ny = this.y + this.vy * dt;
    this.onGround = false;
    if (this.vy !== 0) {
      const dir = Math.sign(this.vy);
      const edge = dir > 0 ? ny + this.h : ny;
      const ty = Math.floor(edge / TILE);
      const x0 = Math.floor(this.x / TILE), x1 = Math.floor((this.x + this.w - 0.01) / TILE);
      for (let tx = x0; tx <= x1; tx++) {
        const solid = world.isSolid(tx, ty);
        const platform = !solid && dir > 0 && oneWayFeet && !dropThrough &&
          world.isOneWay(tx, ty) && (this.y + this.h) <= ty * TILE + 0.5;
        if (solid || platform) {
          if (dir > 0) { ny = ty * TILE - this.h - 0.01; this.onGround = true; }
          else ny = (ty + 1) * TILE + 0.01;
          this.vy = 0; res.hitY = true;
          break;
        }
      }
    }
    this.y = ny;
    return res;
  }

  inLiquid(world, type) {
    const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
    if (!world.inBounds(tx, ty)) return false;
    const i = ty * world.w + tx;
    return world.liquid[i] >= 3 && (type === undefined || world.liquidType[i] === type);
  }
}

/* ------------------------------------------------------------ item drops */
export class ItemDrop extends Entity {
  constructor(x, y, itemId, n) {
    super(x - 7, y - 7, 14, 14);
    this.item = itemId;
    this.n = n;
    this.vx = (Math.random() - 0.5) * 90;
    this.vy = -110 - Math.random() * 60;
    this.age = 0;
    this.noPickup = 0.35;    // grace so freshly tossed items don't insta-return
  }

  update(dt, game) {
    this.age += dt;
    if (this.noPickup > 0) this.noPickup -= dt;
    const water = this.inLiquid(game.world, 0);
    this.vy = Math.min(this.vy + GRAVITY * (water ? 0.25 : 1) * dt, water ? 90 : MAX_FALL);
    this.vx *= this.onGround ? 0.82 : 0.995;

    /* magnet toward player */
    const p = game.player;
    if (p && !p.dead && this.noPickup <= 0) {
      const d2 = dist2(this.cx, this.cy, p.cx, p.cy);
      const R = TILE * 3.2;
      if (d2 < R * R) {
        const d = Math.sqrt(d2) || 1;
        this.vx += ((p.cx - this.cx) / d) * 900 * dt;
        this.vy += ((p.cy - this.cy) / d) * 900 * dt;
        if (aabb(this.box, p.box)) {
          const left = game.inventory.add(this.item, this.n);
          if (left < this.n) {
            game.sfx && game.sfx.pickup();
            game.ui && game.ui.dirtyInv();
          }
          if (left <= 0) { this.dead = true; return; }
          this.n = left;
        }
      }
    }
    this.moveCollide(game.world, dt);
    /* lava burns drops */
    if (this.inLiquid(game.world, 1)) this.dead = true;
    if (this.age > 300) this.dead = true;
  }

  draw(ctx) {
    const icon = getIcon(this.item);
    const bob = Math.sin(this.age * 3 + this.id) * 1.5;
    ctx.drawImage(icon, this.x - 1, this.y - 1 + bob, 16, 16);
  }
}

/* -------------------------------------------------------------- particles */
export class Particle extends Entity {
  constructor(x, y, color, opts = {}) {
    super(x, y, 2, 2);
    this.color = color;
    this.vx = (Math.random() - 0.5) * (opts.spread || 160);
    this.vy = -Math.random() * (opts.up || 140) - 20;
    this.life = this.maxLife = opts.life || 0.5 + Math.random() * 0.35;
    this.size = opts.size || 2 + Math.random() * 2;
    this.gravity = opts.gravity !== undefined ? opts.gravity : 1;
    this.glow = opts.glow || false;
  }

  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.vy += GRAVITY * 0.55 * this.gravity * dt;
    this.moveCollide(game.world, dt);
    if (this.onGround) this.vx *= 0.8;
  }

  draw(ctx) {
    ctx.globalAlpha = clamp(this.life / this.maxLife, 0, 1);
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.size, this.size);
    ctx.globalAlpha = 1;
  }
}

export function burst(game, x, y, color, count = 8, opts) {
  for (let i = 0; i < count; i++) game.entities.push(new Particle(x, y, color, opts));
}

/* ------------------------------------------------------------ damage text */
export class DamageText {
  constructor(x, y, text, color = "#ffb300") {
    this.x = x + (Math.random() - 0.5) * 10;
    this.y = y;
    this.text = String(text);
    this.color = color;
    this.life = 0.9;
    this.dead = false;
  }

  update(dt) {
    this.life -= dt;
    this.y -= 34 * dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    ctx.globalAlpha = clamp(this.life / 0.35, 0, 1);
    ctx.font = "bold 10px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 2.5;
    ctx.strokeText(this.text, this.x, this.y);
    ctx.fillStyle = this.color;
    ctx.fillText(this.text, this.x, this.y);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }
}
