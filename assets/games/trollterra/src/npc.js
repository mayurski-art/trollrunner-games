/* TrollTerra — Guide Troll: a friendly local who loiters near spawn and
   dispenses questionable wisdom. Reuses the gladiator rig, hue-shifted
   so he reads as his own troll. He cannot be hurt (he's seen worse). */

import { TILE, GRAVITY, MAX_FALL } from "./defs.js";
import { Entity } from "./entities.js";

const RIG_DIR = "assets/games/troll-kombat/fighters/gladiator/anims/";
const CELL = 136;
const BODY_H = 54;

export const GUIDE_TIPS = [
  "Chop trees, build a workbench, craft a wooden pick. The ancient troll way.",
  "Troll gel + wood = torches. Caves are 100% less deadly when lit.",
  "Ores get shinier the deeper you dig. So do the residents.",
  "A furnace melts ore into bars. An anvil turns bars into pointy opinions.",
  "Pink troll hearts grow in the caves. Mine one, get beefier. Simple.",
  "Doors keep zombies out. Mostly. Don't quote me.",
  "Six eyeball lenses and five gold bars at an anvil make a Troll Totem.",
  "Use the Troll Totem at NIGHT to wake the Troll King. Bad idea. Do it.",
  "Falling hurts. Water doesn't. Plan your descents accordingly.",
  "The Troll Moon turns the night up to eleven. Hide or fight, your call.",
  "Armor is crafted at the anvil. Fashion AND function.",
  "Platforms! Great for bases, terrible for keeping slimes out.",
];

export class GuideTroll extends Entity {
  constructor(tx, ty) {
    super(tx * TILE + 2, ty * TILE - 46, 22, 46);
    this.name = "Guide Troll";
    this.homeX = this.x;
    this.dir = 1;
    this.walkT = 0;
    this.idleT = 2;
    this.animTime = 0;
    this.tips = GUIDE_TIPS;
    this.tipIdx = Math.floor(Math.random() * GUIDE_TIPS.length);
    this.dead = false;
    this.loadRig();
  }

  loadRig() {
    this.rig = {};
    for (const key of ["idle", "walk"]) {
      const img = new Image();
      img.onload = () => {
        this.rig[key] = { img, frames: key === "idle" ? 8 : 6, fps: key === "idle" ? 8 : 11 };
      };
      img.src = RIG_DIR + key + ".png";
    }
  }

  nextTip() {
    this.tipIdx = (this.tipIdx + 1) % this.tips.length;
    return this.tips[this.tipIdx];
  }

  update(dt, game) {
    this.animTime += dt;
    this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);

    if (this.idleT > 0) {
      this.idleT -= dt;
      this.vx *= 0.8;
      if (this.idleT <= 0) {
        this.walkT = 1 + Math.random() * 2.5;
        /* wander, but drift back toward home */
        const drift = this.x - this.homeX;
        this.dir = Math.abs(drift) > 10 * TILE ? -Math.sign(drift) : (Math.random() < 0.5 ? -1 : 1);
      }
    } else {
      this.walkT -= dt;
      this.vx = this.dir * 34;
      if (this.walkT <= 0) this.idleT = 1.5 + Math.random() * 3;
    }

    const hit = this.moveCollide(game.world, dt);
    if (hit.hitX && this.onGround) {
      /* one-tile steps are fine; walls turn him around */
      const tx = Math.floor((this.cx + this.dir * 14) / TILE);
      const ty = Math.floor((this.y + this.h - 4) / TILE);
      if (!game.world.isSolid(tx, ty - 1)) this.vy = -300;
      else { this.dir *= -1; this.idleT = 0.8; }
    }
    /* don't wander off cliffs */
    if (this.onGround && this.walkT > 0) {
      const aheadX = Math.floor((this.cx + this.dir * 12) / TILE);
      const footY = Math.floor((this.y + this.h + 4) / TILE);
      if (!game.world.isSolid(aheadX, footY) && !game.world.isSolid(aheadX, footY + 1)) {
        this.dir *= -1;
        this.idleT = 1;
      }
    }
  }

  draw(ctx) {
    const anim = Math.abs(this.vx) > 5 ? "walk" : "idle";
    const a = this.rig[anim];
    const feetX = this.cx, feetY = this.y + this.h;
    ctx.save();
    /* hue-shift: our guide is a mossy sage, not a gladiator */
    ctx.filter = "hue-rotate(105deg) saturate(0.8) brightness(0.96)";
    if (a) {
      const fi = Math.floor(this.animTime * a.fps) % a.frames;
      const scale = BODY_H / 96;      // gladiator content is ~96px tall in a 136 cell
      const dw = CELL * scale, dh = CELL * scale;
      ctx.translate(feetX, feetY + 6 * scale);
      if (this.dir < 0) ctx.scale(-1, 1);
      ctx.drawImage(a.img, fi * CELL, 0, CELL, CELL, -dw / 2, -dh, dw, dh);
    } else {
      ctx.fillStyle = "#8fb573";
      ctx.fillRect(this.x, this.y + 12, this.w, this.h - 12);
      ctx.fillStyle = "#cfe0b8";
      ctx.fillRect(this.x - 2, this.y - 4, this.w + 4, 18);
    }
    ctx.restore();

    /* tiny "!" so players notice him */
    ctx.fillStyle = "#ffb300";
    ctx.font = "bold 10px 'DM Mono', monospace";
    ctx.fillText("?", feetX - 2, this.y - 8 + Math.sin(this.animTime * 3) * 2);
  }
}
