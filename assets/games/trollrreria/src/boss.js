/* Trollrreria — THE TROLL KING. Summoned by a Troll Totem at night.
   Hops in huge arcs, spawns kingling slimes, and once he's tilted
   (below half HP) he spits troll tears. Flees at dawn. */

import { TILE, BOSS, BOSS2, GRAVITY, MAX_FALL } from "./defs.js";
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
    this.dropsTable = BOSS.drops;
    this.questId = "trollKing";
    this.deathLine = "👑 The Troll King has been trolled!";
    this.baseFilter = null;
    this.enrageFilter = "sepia(0.4) hue-rotate(-28deg) saturate(2.2)";
    this.crownScale = 1;
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
    game.triggerHitPause && game.triggerHitPause(0.035);
    game.triggerShake && game.triggerShake(2.5, 0.1);
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    burst(game, this.cx, this.cy, "#e8e4da", 40, { spread: 420, up: 300 });
    burst(game, this.cx, this.cy, "#ffb300", 24, { spread: 340 });
    game.triggerHitPause && game.triggerHitPause(0.09);
    game.triggerShake && game.triggerShake(9, 0.35);
    for (const [id, min, max, chance] of this.dropsTable) {
      if (Math.random() < chance) {
        const n = min + Math.floor(Math.random() * (max - min + 1));
        game.spawnDrop(this.cx, this.cy - 20, id, n);
      }
    }
    game.stats.bossKills++;
    game.sfx && game.sfx.fanfare();
    game.announce(this.deathLine);
    if (this.questId) game.progressQuest && game.progressQuest("defeat", this.questId, 1);
    this.onDefeat(game);
    game.recordProgress && game.recordProgress("boss");
    void window.TrollrunnerAccounts?.awardXp?.("boss_kill", "trollrreria");
  }

  onDefeat(game) {
    game.flags.bossDown = true;
    if (!game.flags.hardmode && game.enterHardmode) game.enterHardmode();
  }

  /* shared by both bosses */
  draw(ctx) {
    const squash = this.onGround ? 1 + Math.sin(this.wobble * 6) * 0.02 : clamp(1 - this.vy / 2400, 0.9, 1.12);
    const drawH = 104 * squash, drawW = 88 / squash;
    const x = this.cx - drawW / 2, y = this.y + this.h - drawH;
    ctx.save();
    if (this.hitFlash > 0) ctx.filter = "brightness(2)";
    else if (this.enraged) ctx.filter = this.enrageFilter;
    else if (this.baseFilter) ctx.filter = this.baseFilter;
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
    const cw = 34 * this.crownScale, chh = 16 * this.crownScale;
    const cx0 = this.cx - cw / 2, cy0 = y - chh + 6;
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

/* ============================================================ THE EMPEROR
   Hardmode boss. He does not hop — he floats, he judges, he dashes.
   Cycle: hover above the player -> telegraph flash -> dash. Every third
   cycle he emits a radial ring of troll tears; enraged (<40%) he adds a
   dart ring and dashes harder. Flees at dawn like his cousin.          */
export class TrollEmperor extends TrollKing {
  constructor(x, y) {
    super(x, y);
    this.name = "TROLL EMPEROR";
    this.hp = this.maxHp = BOSS2.hp;
    this.defense = BOSS2.def;
    this.dropsTable = BOSS2.drops;
    this.questId = "trollEmperor";
    this.deathLine = "👑👑 The Troll Emperor has abdicated!";
    this.baseFilter = "hue-rotate(235deg) saturate(1.5) brightness(0.92)";
    this.enrageFilter = "hue-rotate(280deg) saturate(2.4) brightness(1.05)";
    this.crownScale = 1.5;
    this.light = 110;
    this.phase = "hover";        // hover | telegraph | dash
    this.phaseT = 2;
    this.cycles = 0;
  }

  get enraged() { return this.hp < this.maxHp * 0.4; }

  update(dt, game) {
    const p = game.player;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.wobble += dt;

    const st = skyState(game.time);
    if (!st.isNight && this.state !== "flee") {
      this.state = "flee";
      game.announce("The Troll Emperor departs with the stars…");
    }
    if (this.state === "flee") {
      this.vy -= 900 * dt;
      this.y += this.vy * dt;
      if (this.y < -400) this.dead = true;
      return;
    }
    if (!p || p.dead) {
      this._boredom = (this._boredom || 0) + dt;
      if (this._boredom > 6) this.state = "flee";
      this.y += Math.sin(this.wobble * 2) * 12 * dt;
      return;
    }
    this._boredom = 0;

    this.phaseT -= dt;
    const enr = this.enraged;
    switch (this.phase) {
      case "hover": {
        /* float toward a perch above the player; no tile collision — he's royalty */
        const tx = p.cx + Math.sin(this.wobble * 1.4) * 90;
        const ty = p.cy - 150;
        this.vx += clamp(tx - this.cx, -600, 600) * 1.6 * dt;
        this.vy += clamp(ty - this.cy, -600, 600) * 1.6 * dt;
        this.vx *= 0.94; this.vy *= 0.94;
        this.dir = Math.sign(p.cx - this.cx) || 1;
        if (this.phaseT <= 0) {
          this.phase = "telegraph";
          this.phaseT = enr ? 0.3 : 0.5;
          this.vx = this.vy = 0;
          game.sfx && game.sfx.summon();
        }
        break;
      }
      case "telegraph": {
        /* shiver in place, then commit */
        this.x += Math.sin(this.wobble * 60) * 1.5;
        if (this.phaseT <= 0) {
          this.phase = "dash";
          this.phaseT = 0.55;
          const ang = Math.atan2(p.cy - this.cy, p.cx - this.cx);
          const spd = enr ? 620 : 470;
          this.vx = Math.cos(ang) * spd;
          this.vy = Math.sin(ang) * spd;
          game.sfx && game.sfx.roar();
        }
        break;
      }
      case "dash": {
        if (this.phaseT <= 0) {
          this.phase = "hover";
          this.phaseT = enr ? 1.1 : 1.8;
          this.cycles++;
          if (this.cycles % 3 === 0) this.tearRing(game, enr);
          if (this.cycles % 4 === 0) {
            game.enemies.push(new Enemy("eye", this.cx - 30, this.cy));
            game.enemies.push(new Enemy("eye", this.cx + 30, this.cy));
          }
        }
        break;
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    /* stay inside the world, above the floor */
    this.x = clamp(this.x, TILE * 2, (game.world.w - 8) * TILE);
    this.y = clamp(this.y, TILE * 4, (game.world.h - 20) * TILE);

    if (p && !p.dead && aabb(this.box, p.box)) {
      p.hurt(game, BOSS2.contactDmg, "the Troll Emperor", this.cx);
    }
  }

  tearRing(game, enraged) {
    const n = enraged ? 12 : 8;
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2;
      game.entities.push(new Projectile(
        this.cx, this.cy, Math.cos(ang) * 240, Math.sin(ang) * 240,
        { dmg: BOSS2.tearDmg, hostile: true, kind: "tear", gravity: 0.08, life: 3.2 }
      ));
    }
    game.sfx && game.sfx.splash();
  }

  onDefeat(game) {
    game.flags.emperorDown = true;
  }
}

/* ============================================================ THE RICKROLLER
   Deep Web miniboss. A permanent, one-per-world guardian (not a night-only
   summon) -- spawns once when the player first crosses into the Deep Web,
   then sticks around until killed. Its gimmick: try to leave its arena
   and it teleports YOU back, not the other way around. Never gonna let
   you go. Drops the Whale Key (Quest 5) and an Anti-Bot Flame. */
export class Rickroller extends Entity {
  constructor(x, y) {
    super(x - 26, y - 46, 52, 46);
    this.boss = true;
    this.name = "THE RICKROLLER";
    this.questId = "whaleKey";
    this.hp = this.maxHp = 900;
    this.defense = 12;
    this.hitFlash = 0;
    this.dir = 1;
    this.wobble = 0;
    this.arena = { x, y };
    this.arenaR = TILE * 22;
    this.light = 70;
  }

  update(dt, game) {
    const p = game.player;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.wobble += dt;
    this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);

    if (p && !p.dead) {
      /* never gonna let you go: wandering too far from the arena warps
         the PLAYER back to its edge instead of the boss giving chase */
      const d = Math.hypot(p.cx - this.arena.x, p.cy - this.arena.y);
      if (d > this.arenaR) {
        const ang = Math.atan2(p.cy - this.arena.y, p.cx - this.arena.x);
        p.x = this.arena.x + Math.cos(ang) * this.arenaR * 0.7 - p.w / 2;
        p.y = this.arena.y + Math.sin(ang) * this.arenaR * 0.7 - p.h / 2;
        p.vx = p.vy = 0;
        game.floatText(p.cx, p.y - 10, "never gonna let you go", "#ff2d78");
        game.sfx && game.sfx.summon();
      }
      this.dir = Math.sign(p.cx - this.cx) || 1;
      const toward = Math.sign(p.cx - this.cx) || 1;
      this.vx = clamp(this.vx + toward * 700 * dt, -80, 80);
      if (this.onGround && Math.random() < 0.01) this.vy = -420;
    }

    const hit = this.moveCollide(game.world, dt);
    if (hit.hitX && this.onGround) this.vy = -380;

    if (p && !p.dead && aabb(this.box, p.box)) {
      p.hurt(game, 22, "the Rickroller", this.cx);
    }
  }

  hurt(game, dmg, fromX, knock = 0) {
    const final = Math.max(1, Math.round(dmg - this.defense / 2 + (Math.random() * 2 - 1)));
    this.hp -= final;
    this.hitFlash = 0.12;
    game.floatText(this.cx, this.y - 6, final, "#ff2d78");
    game.sfx && game.sfx.squish();
    game.triggerHitPause && game.triggerHitPause(0.035);
    game.triggerShake && game.triggerShake(2.5, 0.1);
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    burst(game, this.cx, this.cy, "#ff2d78", 30, { spread: 340 });
    game.triggerHitPause && game.triggerHitPause(0.09);
    game.triggerShake && game.triggerShake(9, 0.35);
    game.spawnDrop(this.cx, this.cy - 10, "whaleKey", 1);
    game.spawnDrop(this.cx, this.cy - 10, "antiBotFlame", 1);
    game.spawnDrop(this.cx, this.cy - 10, "trolliumBar", 4 + Math.floor(Math.random() * 6));
    game.stats.bossKills++;
    game.sfx && game.sfx.fanfare();
    game.announce("📼 The Rickroller buffers... and dissolves. Never gonna give you up, though.");
    if (this.questId) game.progressQuest && game.progressQuest("defeat", this.questId, 1);
    game.recordProgress && game.recordProgress("boss");
    void window.TrollrunnerAccounts?.awardXp?.("boss_kill", "trollrreria");
  }

  draw(ctx) {
    ctx.save();
    if (this.hitFlash > 0) ctx.filter = "brightness(2)";
    const x = this.x, y = this.y, w = this.w, h = this.h;
    /* a corrupted "video window" body -- glitchy screen with a play triangle */
    ctx.fillStyle = "#1c1424";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#ff2d78"; ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    /* scanline glitch offset */
    const glitch = Math.sin(this.wobble * 11) * 3;
    ctx.fillStyle = "rgba(255,45,120,0.25)";
    ctx.fillRect(x + glitch, y + h * 0.4, w, 3);
    ctx.fillStyle = "#5ec8d8";
    ctx.beginPath();
    ctx.moveTo(this.cx - 8, this.cy - 10);
    ctx.lineTo(this.cx - 8, this.cy + 10);
    ctx.lineTo(this.cx + 10, this.cy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
