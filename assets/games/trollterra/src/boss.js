/* TrollTerra — THE TROLL KING. Summoned by a Troll Totem at night.
   Hops in huge arcs, spawns kingling slimes, and once he's tilted
   (below half HP) he spits troll tears. Flees at dawn. */

import { TILE, BOSS, GRAVITY, MAX_FALL } from "./defs.js";
import { Entity, Projectile, Enemy, burst } from "./entities.js";
import { skyState } from "./render.js";
import { clamp, aabb } from "./util.js";

const ART = "assets/games/troll-kombat/fighters/troll.png";

export class TrollKing extends Entity {
  constructor(x, y) {
    super(x - 40, y - 84, 80, 84);
    this.boss = true;
    this.name = "TROLL KING";
    this.hp = BOSS.hp;
    this.maxHp = BOSS.hp;
    this.defense = BOSS.def;
    this.hitFlash = 0;
    this.state = "hop";          // hop | rest | flee
    this.hops = 0;
    this.restT = 0;
    this.wobble = 0;
    this.dir = 1;
    this.light = 60;             // menacing glow
    this.img = new Image();
    this.imgReady = false;
    this.img.onload = () => { this.imgReady = true; };
    this.img.src = ART;
  }

  get enraged() { return this.hp < this.maxHp * 0.5; }

  update(dt, game) {
    const p = game.player;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.wobble += dt;

    const st = skyState(game.time);
    if (!st.isNight && this.state !== "flee") {
      this.state = "flee";
      game.announce("The Troll King flees the sunrise…");
    }
    if (this.state === "flee") {
      this.vy -= 900 * dt;
      this.y += this.vy * dt;
      if (this.y < -400) this.dead = true;
      return;
    }
    if (!p || p.dead) {
      /* nobody to troll: lose interest */
      this._boredom = (this._boredom || 0) + dt;
      if (this._boredom > 6) { this.state = "flee"; }
    } else {
      this._boredom = 0;
    }

    this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);

    if (this.onGround) {
      this.vx *= 0.8;
      this.restT -= dt;
      if (this.restT <= 0 && p && !p.dead) {
        this.hops++;
        this.dir = Math.sign(p.cx - this.cx) || 1;
        const enr = this.enraged;
        const far = Math.abs(p.cx - this.cx) > 320;
        this.vx = this.dir * (far ? 330 : enr ? 280 : 210);
        this.vy = -(far ? 560 : 460 + Math.random() * 120);
        this.restT = enr ? 0.5 + Math.random() * 0.4 : 0.9 + Math.random() * 0.6;
        game.sfx && game.sfx.squish();

        /* every third hop: royal decree (spawn kinglings) */
        if (this.hops % 3 === 0) {
          for (let k = 0; k < 2; k++) {
            game.enemies.push(new Enemy("slimeKing", this.cx + (k ? 40 : -40), this.y + this.h));
          }
          game.sfx && game.sfx.roar();
        }
        /* enraged: spit troll tears on every launch */
        if (enr) this.spit(game, p);
      }
    }

    this.moveCollide(game.world, dt);

    /* contact damage */
    if (p && !p.dead && aabb(this.box, p.box)) {
      p.hurt(game, BOSS.contactDmg, "the Troll King", this.cx);
    }
  }

  spit(game, p) {
    const ox = this.cx, oy = this.y + 26;
    for (let k = -1; k <= 1; k++) {
      const ang = Math.atan2(p.cy - oy, p.cx - ox) + k * 0.22;
      const spd = 300;
      game.entities.push(new Projectile(
        ox, oy, Math.cos(ang) * spd, Math.sin(ang) * spd,
        { dmg: BOSS.tearDmg, hostile: true, kind: "tear", gravity: 0.35, life: 4 }
      ));
    }
  }

  hurt(game, dmg, fromX, knock = 0) {
    const final = Math.max(1, Math.round(dmg - this.defense / 2 + (Math.random() * 2 - 1)));
    this.hp -= final;
    this.hitFlash = 0.12;
    game.floatText(this.cx + (Math.random() - 0.5) * 30, this.y - 6, final, "#ff9500");
    game.sfx && game.sfx.squish();
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    burst(game, this.cx, this.cy, "#e8e4da", 40, { spread: 420, up: 300 });
    burst(game, this.cx, this.cy, "#ffb300", 24, { spread: 340 });
    for (const [id, min, max, chance] of BOSS.drops) {
      if (Math.random() < chance) {
        const n = min + Math.floor(Math.random() * (max - min + 1));
        game.spawnDrop(this.cx, this.cy - 20, id, n);
      }
    }
    game.stats.bossKills++;
    game.flags.bossDown = true;
    game.sfx && game.sfx.fanfare();
    game.announce("👑 The Troll King has been trolled!");
    game.recordProgress && game.recordProgress("boss");
  }

  draw(ctx) {
    const squash = this.onGround ? 1 + Math.sin(this.wobble * 6) * 0.02 : clamp(1 - this.vy / 2400, 0.9, 1.12);
    const drawH = 104 * squash, drawW = 88 / squash;
    const x = this.cx - drawW / 2, y = this.y + this.h - drawH;
    ctx.save();
    if (this.hitFlash > 0) ctx.filter = "brightness(2)";
    else if (this.enraged) ctx.filter = "sepia(0.4) hue-rotate(-28deg) saturate(2.2)";
    if (this.dir < 0) { ctx.translate(this.cx, 0); ctx.scale(-1, 1); ctx.translate(-this.cx, 0); }
    if (this.imgReady) {
      ctx.drawImage(this.img, x, y, drawW, drawH);
    } else {
      ctx.fillStyle = "#d9d4c8";
      ctx.fillRect(x, y, drawW, drawH);
      ctx.fillStyle = "#141414";
      ctx.fillRect(x + 16, y + 22, 10, 10);
      ctx.fillRect(x + drawW - 26, y + 22, 10, 10);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#141414";
      ctx.beginPath();
      ctx.arc(this.cx, y + 52, 24, 0.25, Math.PI - 0.25);
      ctx.stroke();
    }
    ctx.restore();

    /* crown (always upright) */
    ctx.save();
    if (this.hitFlash > 0) ctx.filter = "brightness(2)";
    const cw = 34, chh = 16, cx0 = this.cx - cw / 2, cy0 = y - chh + 6;
    ctx.fillStyle = "#f4c64c";
    ctx.beginPath();
    ctx.moveTo(cx0, cy0 + chh);
    ctx.lineTo(cx0, cy0 + 4);
    ctx.lineTo(cx0 + cw * 0.2, cy0 + 10);
    ctx.lineTo(cx0 + cw * 0.38, cy0);
    ctx.lineTo(cx0 + cw * 0.55, cy0 + 10);
    ctx.lineTo(cx0 + cw * 0.75, cy0 + 2);
    ctx.lineTo(cx0 + cw, cy0 + 8);
    ctx.lineTo(cx0 + cw, cy0 + chh);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ff2d55";
    ctx.fillRect(this.cx - 3, cy0 + 8, 5, 5);
    ctx.restore();
  }
}
