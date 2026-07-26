/* Trollrreria — world entities: item drops, particles, damage text,
   enemies, projectiles. (The Troll King boss lives in boss.js.) */

import { T, TILE, ITEMS, ENEMIES, GRAVITY, MAX_FALL } from "./defs.js";
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
            game.progressQuest && game.progressQuest("collect", this.item, this.n - left);
            burst(game, this.cx, this.cy, "#ffe08a", 5, { life: 0.25, spread: 90, up: 40, glow: true });
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

/* ---------------------------------------------------------------- enemies */
export class Enemy extends Entity {
  constructor(type, x, y) {
    const d = ENEMIES[type];
    super(x - d.w / 2, y - d.h, d.w, d.h);
    this.type = type;
    this.def = d;
    this.hp = d.hp;
    this.maxHp = d.hp;
    this.hitFlash = 0;
    this.aiTimer = Math.random() * 1.4;
    this.wobble = Math.random() * 7;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.hitBy = -1;          // last melee swing id that connected
  }

  update(dt, game) {
    const p = game.player;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.aiTimer -= dt;
    this.wobble += dt;

    const flyer = this.def.ai === "flyer";
    if (!flyer) {
      const water = this.inLiquid(game.world, 0);
      this.vy = Math.min(this.vy + GRAVITY * (water ? 0.35 : 1) * dt, water ? 130 : MAX_FALL);
    }

    if (p && !p.dead) this.runAI(dt, game, p);

    const hit = this.moveCollide(game.world, dt);
    if (this.def.ai === "walker" && hit.hitX && this.onGround) this.vy = -370;

    /* Town safe zones (main.js addSafeZone): hostiles hit an invisible
       border and get pushed back out, so NPCs can be traded with in
       peace. Bosses ignore it -- you summoned them, that's on you --
       and passive/tamed animals are welcome in town. */
    if (!this.boss && !this.def.passive && !this.tamed && game.inSafeZone) {
      const z = game.inSafeZone(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE));
      if (z) {
        const zx0 = z.x0 * TILE, zx1 = (z.x1 + 1) * TILE;
        const away = this.cx < (zx0 + zx1) / 2 ? -1 : 1;
        /* slide toward the nearer border (never past it) faster than any
           AI walks inward -- reads as bumping into a wall, not a teleport */
        if (away < 0) this.x = Math.max(zx0 - this.w, this.x - 300 * dt);
        else this.x = Math.min(zx1, this.x + 300 * dt);
        this.vx = away * Math.abs(this.vx);
        this.dir = away;
      }
    }

    /* lava hurts everything */
    if (this.inLiquid(game.world, 1)) this.hurt(game, 12, null, 0);

    /* contact damage (passive animals never hurt the player) */
    if (!this.def.passive && p && !p.dead && aabb(this.box, p.box)) {
      p.hurt(game, this.contactDmg, (this.elite ? "an elite " : "") + this.def.name, this.cx);
    }

    /* Ranching: tamed animals grow up, cool down from breeding, and lay
       ranch products on a timer -- see Game.tryFeedAnimal/tryBreed for how
       taming/breeding itself gets triggered (right-click with the right
       food, main.js interact()). */
    if (this.tamed) {
      if (this.loveCd > 0) this.loveCd -= dt;
      if (this.baby) {
        this.growTimer -= dt;
        if (this.growTimer <= 0) {
          this.baby = false;
          this.hp = this.maxHp = this.def.hp;
          game.floatText(this.cx, this.y - 10, this.def.name + " grew up!", "#57bd5c");
        }
      } else if (this.def.lays) {
        this.layTimer = this.layTimer ?? (60 + Math.random() * 40);
        this.layTimer -= dt;
        if (this.layTimer <= 0) {
          this.layTimer = 70 + Math.random() * 40;
          game.spawnDrop(this.cx, this.y, this.def.lays, 1);
        }
      }
    }

    /* despawn far from the player -- tamed animals are a player investment
       and shouldn't vanish just because the player wandered off the farm */
    if (!this.tamed && p && dist2(this.cx, this.cy, p.cx, p.cy) > (TILE * 110) ** 2) this.dead = true;
  }

  runAI(dt, game, p) {
    const d = this.def;
    const toward = Math.sign(p.cx - this.cx) || 1;
    switch (d.ai) {
      case "slime":
        if (this.onGround) {
          this.vx *= 0.82;
          if (this.aiTimer <= 0) {
            this.aiTimer = 0.9 + Math.random() * 1.4;
            this.vy = -(240 + Math.random() * 120);
            this.vx = toward * (60 + Math.random() * 50);
            this.dir = toward;
          }
        }
        break;
      case "walker": {
        const spd = this.type === "skeleton" ? 46 : 54;
        this.dir = toward;
        this.vx = clamp(this.vx + toward * 900 * dt, -spd, spd);
        break;
      }
      /* Rug Pull Rat: scurries in, yanks the ground tile out from under
         the player, then flees for a couple seconds before it'll try
         again. Never touches stone/bedrock -- only soft surface ground. */
      case "ratRunner": {
        if (this._fleeT > 0) {
          this._fleeT -= dt;
          this.dir = -toward;
          this.vx = clamp(this.vx - toward * 1100 * dt, -95, 95);
          if (this._fleeT <= 0) this._pulled = false;
          break;
        }
        this.dir = toward;
        this.vx = clamp(this.vx + toward * 700 * dt, -55, 55);
        if (this.onGround && !this._pulled &&
            Math.abs(p.cx - this.cx) < 18 && Math.abs(p.cy - this.cy) < 26) {
          this._pulled = true;
          this._fleeT = 2.2;
          const tx = Math.floor(p.cx / TILE), ty = Math.floor((p.y + p.h + 2) / TILE);
          const id = game.world.get(tx, ty);
          if (id === T.MUD || id === T.DIRT) {
            game.world.set(tx, ty, T.AIR);
            game.floatText(p.cx, p.y - 10, "Rug pulled!", "#ff2d55");
            game.sfx && game.sfx.tink(false);
          }
        }
        break;
      }
      /* Passive animals: wander idly, bolt away once the player gets close
         -- unless tamed, in which case they're calm around their owner. */
      case "flee": {
        if (this.tamed) {
          if (this.aiTimer <= 0) {
            this.aiTimer = 1.2 + Math.random() * 2;
            this.vx = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 10);
            this.dir = Math.sign(this.vx) || this.dir;
          } else this.vx *= 0.92;
          break;
        }
        const d2 = dist2(this.cx, this.cy, p.cx, p.cy);
        if (d2 < (TILE * 5) ** 2) {
          this.dir = -toward;
          this.vx = clamp(this.vx - toward * 800 * dt, -70, 70);
          if (this.onGround && this.aiTimer <= 0) { this.vy = -260; this.aiTimer = 0.5; }
        } else if (this.aiTimer <= 0) {
          this.aiTimer = 1.2 + Math.random() * 2;
          this.vx = (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 18);
          this.dir = Math.sign(this.vx) || this.dir;
        } else {
          this.vx *= 0.92;
        }
        break;
      }
      case "flyer": {
        if (d.erratic && this.aiTimer <= 0) {
          this.aiTimer = 0.5 + Math.random() * 0.7;
          this._tx = p.cx + (Math.random() - 0.5) * 220;
          this._ty = p.cy + (Math.random() - 0.5) * 160;
        }
        const tx = d.erratic ? (this._tx ?? p.cx) : p.cx;
        const ty = d.erratic ? (this._ty ?? p.cy) : p.cy - 6;
        const dx = tx - this.cx, dy = ty - this.cy;
        const len = Math.hypot(dx, dy) || 1;
        const acc = d.erratic ? 560 : 420;
        const max = d.erratic ? 150 : 118;
        this.vx = clamp(this.vx + (dx / len) * acc * dt, -max, max);
        this.vy = clamp(this.vy + ((dy / len) * acc + Math.sin(this.wobble * 3) * 130) * dt, -max, max);
        this.dir = Math.sign(this.vx) || this.dir;
        break;
      }
      /* Grin Creeper: shuffles in close, then arms a short fuse and pops
         in an AOE burst -- backing off doesn't disarm it once it's lit,
         same tension as the thing it's riffing on. */
      case "exploder": {
        const armRange = TILE * 1.8;
        if (this._fuse > 0) {
          this.vx *= 0.7;
          this._fuse -= dt;
          if (this._fuse <= 0) {
            const R = TILE * 2.6;
            if (dist2(this.cx, this.cy, p.cx, p.cy) < R * R) {
              p.hurt(game, this.elite ? 45 : 30, "a " + this.def.name, this.cx);
            }
            burst(game, this.cx, this.cy, "#8fd14f", 26, { spread: 260, up: 160, glow: true });
            game.triggerShake && game.triggerShake(9, 0.25);
            game.sfx && game.sfx.hurt && game.sfx.hurt();
            this.die(game);
          }
        } else if (dist2(this.cx, this.cy, p.cx, p.cy) < armRange * armRange) {
          this._fuse = 0.85;
        } else {
          this.dir = toward;
          this.vx = clamp(this.vx + toward * 500 * dt, -46, 46);
        }
        break;
      }
      /* Bone Archer: holds a preferred range and lobs arrows instead of
         closing to melee -- the walker's ranged counterpart. */
      case "archer": {
        const distX = Math.abs(p.cx - this.cx);
        const preferred = TILE * 6;
        this.dir = toward;
        if (distX < preferred - 20) this.vx = clamp(this.vx - toward * 500 * dt, -50, 50);
        else if (distX > preferred + 20) this.vx = clamp(this.vx + toward * 500 * dt, -50, 50);
        else this.vx *= 0.85;
        if (this.aiTimer <= 0 && distX < TILE * 10 && Math.abs(p.cy - this.cy) < TILE * 5) {
          this.aiTimer = 1.6 + Math.random() * 0.7;
          const dx = p.cx - this.cx, dy = (p.cy - 6) - this.cy;
          const len = Math.hypot(dx, dy) || 1;
          const spd = 280;
          game.entities.push(new Projectile(
            this.cx + this.dir * 10, this.cy - 6, (dx / len) * spd, (dy / len) * spd,
            { dmg: this.elite ? 16 : 10, hostile: true, gravity: 0.2 }
          ));
          game.sfx && game.sfx.swing && game.sfx.swing();
        }
        break;
      }
      /* Shadow Stalker: hardmode-night only. Blinks near the player every
         couple seconds instead of pathing over -- unsettling more than
         hard, since it still just wants a normal melee hit once it's close. */
      case "teleporter": {
        if (this.aiTimer <= 0) {
          this.aiTimer = 2.4 + Math.random() * 1.6;
          const ang = Math.random() * Math.PI * 2;
          const dist = TILE * (3 + Math.random() * 2);
          const nx = p.cx + Math.cos(ang) * dist;
          const ny = p.cy + Math.sin(ang) * dist - 20;
          const tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
          if (!game.world.isSolid(tx, ty) && !game.world.isSolid(tx, ty + 1)) {
            burst(game, this.cx, this.cy, "#2a1f3d", 14, { spread: 160, glow: true });
            this.x = nx - this.w / 2;
            this.y = ny - this.h;
            burst(game, this.cx, this.cy, "#8a6fb0", 14, { spread: 160, glow: true });
          }
        }
        this.dir = toward;
        this.vx = clamp(this.vx + toward * 700 * dt, -70, 70);
        break;
      }
    }
  }

  /* Hardmode spice: tougher, meaner, faintly glowing. */
  makeElite() {
    this.elite = true;
    this.hp = this.maxHp = Math.round(this.hp * 1.8);
    this.eliteDmg = Math.round(this.def.dmg * 1.5);
    this.light = 46;
  }

  get contactDmg() { return this.elite ? this.eliteDmg : this.def.dmg; }

  hurt(game, dmg, fromX, knock = 1) {
    const final = Math.max(1, Math.round(dmg - this.def.def / 2 + (Math.random() * 2 - 1)));
    this.hp -= final;
    this.hitFlash = 0.15;
    game.floatText(this.cx, this.y - 4, final, "#ffb300");
    game.sfx && game.sfx.squish();
    game.triggerHitPause && game.triggerHitPause(0.025);
    if (fromX !== null && fromX !== undefined) {
      this.vx = Math.sign(this.cx - fromX) * 190 * this.def.kb * knock;
      this.vy = Math.min(this.vy, -150 * this.def.kb);
    }
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    burst(game, this.cx, this.cy, this.def.color, 12, { spread: 220 });
    game.sfx && game.sfx.kill();
    for (const [id, min, max, chance] of this.def.drops) {
      if (Math.random() < chance) {
        let n = min + Math.floor(Math.random() * (max - min + 1));
        if (this.elite) n *= 2;
        if (n > 0) game.spawnDrop(this.cx, this.cy, id, n);
      }
    }
    /* coin purse: anything hostile pays out on death, scaled by toughness
       -- passive animals don't, so farming your own ranch isn't an
       economy exploit. Payouts feed the coin rows in the shop offers. */
    if (!this.def.passive) {
      let coins = Math.max(1, Math.round(this.maxHp / 10 + Math.random() * 3));
      if (this.elite) coins *= 2;
      game.spawnDrop(this.cx, this.cy, "trollCoin", coins);
    }
    game.onKill && game.onKill(this);
  }

  /* ------------------------------------------------- procedural sprites */
  draw(ctx) {
    if (this.elite) {
      /* faint royal aura so elites read at a glance */
      const pulse = 0.16 + Math.sin(this.wobble * 5) * 0.05;
      ctx.fillStyle = `rgba(87,232,122,${pulse.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, Math.max(this.w, this.h) * 0.85, 0, 7);
      ctx.fill();
    }
    ctx.save();
    if (this.hitFlash > 0) { ctx.globalAlpha = 0.85; ctx.filter = "brightness(2.2)"; }
    if (this.baby) { ctx.translate(this.cx, this.y + this.h); ctx.scale(0.6, 0.6); ctx.translate(-this.cx, -(this.y + this.h)); }
    const d = this.def;
    switch (d.ai) {
      case "slime": this.drawSlime(ctx, d); break;
      case "walker": this.drawWalker(ctx, d); break;
      case "flyer": d.erratic ? this.drawBat(ctx, d) : this.drawEye(ctx, d); break;
      case "ratRunner": this.drawRat(ctx, d); break;
      case "flee": this.drawCritter(ctx, d); break;
      case "exploder": this.drawSlime(ctx, d); break;
      case "archer": this.drawWalker(ctx, d); break;
      case "teleporter": this.drawEye(ctx, d); break;
    }
    ctx.restore();
  }

  drawSlime(ctx, d) {
    const squash = clamp(1 - this.vy / 900, 0.72, 1.28);
    const w = this.w * (2 - squash), h = this.h * squash;
    const x = this.cx - w / 2, y = this.y + this.h - h;
    ctx.fillStyle = d.color + "cc";
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.quadraticCurveTo(x, y, x + w / 2, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + h);
    ctx.closePath();
    ctx.fill();
    /* troll grin */
    ctx.fillStyle = "rgba(10,25,12,0.85)";
    const ex = this.cx + this.dir * 3;
    ctx.fillRect(ex - 5, y + h * 0.32, 3, 3);
    ctx.fillRect(ex + 3, y + h * 0.32, 3, 3);
    ctx.strokeStyle = "rgba(10,25,12,0.85)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(ex, y + h * 0.52, 5.5, 0.25, Math.PI - 0.25);
    ctx.stroke();
  }

  drawWalker(ctx, d) {
    const step = Math.sin(this.wobble * 9) * (Math.abs(this.vx) > 6 ? 3.5 : 0);
    const skel = this.type === "skeleton";
    /* legs */
    ctx.fillStyle = skel ? "#b8b2a4" : "#4e6b3a";
    ctx.fillRect(this.x + 3, this.y + this.h - 14 + Math.max(0, step), 6, 14 - Math.max(0, step));
    ctx.fillRect(this.x + this.w - 9, this.y + this.h - 14 + Math.max(0, -step), 6, 14 - Math.max(0, -step));
    /* torso */
    ctx.fillStyle = d.color;
    ctx.fillRect(this.x + 1, this.y + 12, this.w - 2, this.h - 26);
    if (skel) { ctx.fillStyle = "rgba(0,0,0,0.35)"; for (let r = 0; r < 3; r++) ctx.fillRect(this.x + 3, this.y + 16 + r * 5, this.w - 6, 2); }
    /* arms reaching forward */
    ctx.fillStyle = d.color;
    ctx.fillRect(this.cx + this.dir * 4 - 2, this.y + 14 + Math.sin(this.wobble * 5) * 1.5, this.dir * 10, 4);
    /* head with troll grin */
    ctx.fillStyle = skel ? "#e8e4da" : "#8fb573";
    ctx.fillRect(this.x + 2, this.y - 2, this.w - 4, 15);
    ctx.fillStyle = "#141414";
    const ex = this.cx + this.dir * 3;
    ctx.fillRect(ex - 4, this.y + 2, 3, 3);
    ctx.fillRect(ex + 3, this.y + 2, 3, 3);
    ctx.strokeStyle = "#141414";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(ex, this.y + 7, 4.5, 0.2, Math.PI - 0.2);
    ctx.stroke();
    /* grin teeth */
    ctx.fillStyle = "#fff";
    ctx.fillRect(ex - 3, this.y + 9, 2, 2);
    ctx.fillRect(ex + 1, this.y + 9, 2, 2);
  }

  drawEye(ctx, d) {
    const flap = Math.sin(this.wobble * 14) * 5;
    /* wings */
    ctx.fillStyle = "#6b4a5e";
    ctx.beginPath();
    ctx.moveTo(this.cx - 4, this.cy);
    ctx.lineTo(this.cx - 16, this.cy - 8 - flap);
    ctx.lineTo(this.cx - 8, this.cy + 2);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(this.cx + 4, this.cy);
    ctx.lineTo(this.cx + 16, this.cy - 8 - flap);
    ctx.lineTo(this.cx + 8, this.cy + 2);
    ctx.closePath(); ctx.fill();
    /* eyeball */
    ctx.fillStyle = d.color;
    ctx.beginPath(); ctx.arc(this.cx, this.cy, this.w / 2, 0, 7); ctx.fill();
    ctx.strokeStyle = "#c96a6a"; ctx.lineWidth = 1;
    for (let v = 0; v < 3; v++) {
      ctx.beginPath();
      ctx.moveTo(this.cx - 8 + v * 5, this.cy - 9);
      ctx.lineTo(this.cx - 5 + v * 5, this.cy - 2);
      ctx.stroke();
    }
    ctx.fillStyle = "#8c2440";
    ctx.beginPath(); ctx.arc(this.cx + this.dir * 4, this.cy, 5.5, 0, 7); ctx.fill();
    ctx.fillStyle = "#141414";
    ctx.beginPath(); ctx.arc(this.cx + this.dir * 5, this.cy, 2.6, 0, 7); ctx.fill();
  }

  drawRat(ctx, d) {
    const scurry = Math.sin(this.wobble * 16) * 1.2;
    /* low quadruped body + tail, always scuttling */
    ctx.fillStyle = d.color;
    ctx.fillRect(this.x + 2, this.y + 4 + scurry * 0.3, this.w - 4, this.h - 6);
    ctx.fillStyle = "#8a6f4a";
    const tailX = this.dir > 0 ? this.x : this.x + this.w;
    ctx.beginPath();
    ctx.moveTo(tailX, this.y + this.h - 5);
    ctx.lineTo(tailX - this.dir * 10, this.y + this.h - 9 + scurry);
    ctx.lineTo(tailX - this.dir * 10, this.y + this.h - 7 + scurry);
    ctx.closePath();
    ctx.fill();
    /* legs */
    ctx.fillStyle = "#6b5636";
    ctx.fillRect(this.x + 3, this.y + this.h - 4, 3, 4 + Math.abs(scurry));
    ctx.fillRect(this.x + this.w - 6, this.y + this.h - 4, 3, 4 - Math.abs(scurry));
    /* troll grin, tiny */
    const ex = this.cx + this.dir * 6;
    ctx.fillStyle = "#1c1424";
    ctx.fillRect(ex - 2, this.y + 3, 2, 2);
    ctx.strokeStyle = "#1c1424"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ex, this.y + 7, 3, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }

  /* Passive animals: stubby quadruped body, snout (boar) or beak+comb (hen). */
  drawCritter(ctx, d) {
    const step = Math.sin(this.wobble * 9) * (Math.abs(this.vx) > 6 ? 2.5 : 0);
    const hen = this.type === "trollHen";
    ctx.fillStyle = "#7a6248";
    ctx.fillRect(this.x + 3, this.y + this.h - 6 + Math.max(0, step), 3, 6 - Math.max(0, step));
    ctx.fillRect(this.x + this.w - 6, this.y + this.h - 6 + Math.max(0, -step), 3, 6 - Math.max(0, -step));
    ctx.fillStyle = d.color;
    ctx.fillRect(this.x, this.y + 4, this.w, this.h - 8);
    if (hen) {
      /* comb + beak */
      ctx.fillStyle = "#d94f4f";
      ctx.fillRect(this.cx - 2, this.y - 2, 4, 4);
      ctx.fillStyle = "#e8a23c";
      ctx.fillRect(this.cx + this.dir * (this.w / 2 - 1), this.y + 5, this.dir * 4, 3);
    } else {
      /* snout */
      ctx.fillStyle = "#b06a5a";
      ctx.fillRect(this.cx + this.dir * (this.w / 2 - 2), this.y + this.h / 2 - 3, this.dir * 5, 5);
    }
    /* small dark eye */
    ctx.fillStyle = "#1c1424";
    ctx.fillRect(this.cx + this.dir * 4 - 1, this.y + 6, 2, 2);
  }

  drawBat(ctx, d) {
    const flap = Math.sin(this.wobble * 18) * 7;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.moveTo(this.cx - 2, this.cy);
    ctx.lineTo(this.cx - 14, this.cy - 4 + flap);
    ctx.lineTo(this.cx - 5, this.cy + 3);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(this.cx + 2, this.cy);
    ctx.lineTo(this.cx + 14, this.cy - 4 + flap);
    ctx.lineTo(this.cx + 5, this.cy + 3);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(this.cx, this.cy, 6, 0, 7); ctx.fill();
    ctx.fillStyle = "#ffd23c";
    ctx.fillRect(this.cx - 3, this.cy - 2, 2, 2);
    ctx.fillRect(this.cx + 1, this.cy - 2, 2, 2);
    ctx.strokeStyle = "#1c1424"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(this.cx, this.cy + 1.5, 3, 0.3, Math.PI - 0.3); ctx.stroke();
  }
}

/* -------------------------------------------------------------- projectiles */
export class Projectile extends Entity {
  constructor(x, y, vx, vy, opts = {}) {
    super(x - 2, y - 2, 4, 4);
    this.vx = vx; this.vy = vy;
    this.dmg = opts.dmg || 8;
    this.hostile = !!opts.hostile;   // hurts the player instead of enemies
    this.both = !!opts.both;         // trap darts hurt everyone
    this.flame = !!opts.flame;
    this.kind = opts.kind || "arrow";
    this.light = this.flame ? 150 : (opts.light || 0);
    this.life = opts.life || 5;
    this.gravity = opts.gravity !== undefined ? opts.gravity : 1;
  }

  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.vy += GRAVITY * 0.52 * this.gravity * dt;
    const px = this.x, py = this.y;
    const hit = this.moveCollide(game.world, dt);
    if (hit.hitX || hit.hitY) {
      this.dead = true;
      burst(game, this.cx, this.cy, this.flame ? "#ff7a1a" : "#cfc9bd", 4, { spread: 90, life: 0.3 });
      if (this.kind === "arrow" && !this.hostile && Math.random() < 0.5) {
        game.spawnDrop(this.cx, this.cy, this.flame ? "flameArrow" : "arrow", 1);
      }
      if (this.kind === "tear") {
        burst(game, this.cx, this.cy, "#7fd4e8", 6, { spread: 140, life: 0.35 });
      }
      return;
    }
    if (this.flame && Math.random() < 0.3) {
      game.entities.push(new Particle(this.cx, this.cy, "#ffb300", { spread: 30, up: 20, life: 0.25, gravity: 0 }));
    }

    if (this.hostile || this.both) {
      const p = game.player;
      if (p && !p.dead && aabb(this.box, p.box)) {
        p.hurt(game, this.dmg, this.kind === "dart" ? "a dart trap" : "troll tears", this.cx);
        this.dead = true;
      }
    }
    if (!this.hostile || this.both) {
      for (const e of game.enemies) {
        if (!e.dead && aabb(this.box, e.box)) {
          e.hurt(game, this.dmg, this.cx, 0.6, true); // 5th arg: this hit was ranged
          this.dead = true;
          break;
        }
      }
    }
  }

  draw(ctx) {
    const ang = Math.atan2(this.vy, this.vx);
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(ang);
    if (this.kind === "tear") {
      ctx.fillStyle = "#7fd4e8";
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(-2, -3, 2, 2);
    } else if (this.kind === "dart") {
      ctx.fillStyle = "#9aa2ad"; ctx.fillRect(-5, -1, 10, 2);
      ctx.fillStyle = "#141414";
      ctx.beginPath(); ctx.moveTo(5, -2.5); ctx.lineTo(8, 0); ctx.lineTo(5, 2.5); ctx.fill();
    } else {
      ctx.fillStyle = "#8a5a2b"; ctx.fillRect(-7, -1, 12, 2);
      ctx.fillStyle = this.flame ? "#ff7a1a" : "#cfc9bd";
      ctx.beginPath(); ctx.moveTo(5, -3); ctx.lineTo(9, 0); ctx.lineTo(5, 3); ctx.fill();
      ctx.fillStyle = "#e8e4da"; ctx.fillRect(-8, -2, 2, 4);
    }
    ctx.restore();
  }
}

/* ------------------------------------------------------------- fishing */
/* Purely visual: the actual cast/wait/bite state machine lives on
   Player.fishing (player.js useRod/update) -- this just mirrors it each
   frame (position is fixed at cast time, but the bob animation and "!"
   cue read player.fishing.state live) and self-removes the moment
   fishing stops, whether that's a catch, a miss, or reeling in early. */
export class Bobber extends Entity {
  constructor(x, y) {
    super(x - 3, y - 3, 6, 6);
    this.t = 0;
  }

  update(dt, game) {
    const f = game.player && game.player.fishing;
    if (!f) { this.dead = true; return; }
    this.t += dt * (f.state === "biting" ? 10 : 2.4);
  }

  draw(ctx, game) {
    const f = game.player && game.player.fishing;
    if (!f) return;
    const bob = Math.sin(this.t) * (f.state === "biting" ? 4 : 1.5);
    const x = this.cx, y = this.cy + bob;
    ctx.strokeStyle = "rgba(230,230,230,0.5)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(game.player.cx, game.player.y + 10); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = f.state === "biting" ? "#ff4d5e" : "#e8e4da";
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill();
    if (f.state === "biting") {
      ctx.fillStyle = "#ffd23c"; ctx.font = "bold 12px 'DM Mono', monospace";
      ctx.fillText("!", x + 5, y - 6);
    }
  }
}

/* ---------------------------------------------------------- quest marker */
/* A floating "!" over static world fixtures (the spawn sign) that hand out
   a quest -- same bounce + color NPCs already use for their own quest
   marker, so the affordance reads the same whether you're looking at a
   person or a signpost. Self-removes once its quest is done. */
export class QuestMarker {
  constructor(x, y, questId) {
    this.x = x; this.y = y;
    this.questId = questId;
    this.animTime = Math.random() * 6;
    this.dead = false;
  }

  update(dt, game) {
    this.animTime += dt;
    if (game.questIsDone(this.questId)) this.dead = true;
  }

  draw(ctx) {
    ctx.fillStyle = "#57e87a";
    ctx.font = "bold 12px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 2.5;
    const y = this.y + Math.sin(this.animTime * 3) * 3;
    ctx.strokeText("!", this.x, y);
    ctx.fillText("!", this.x, y);
    ctx.textAlign = "left";
  }
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
