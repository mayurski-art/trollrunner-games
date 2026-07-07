/* Trollrreria — the four world bosses added post-launch: The Archtroll
   (Rage Comic Ruins), Rarepepe the Last Feel (Pepe Swamp), The Elder Shibe
   (Doge Moon Mines), and Anon the Keyboard Warrior (Going Viral). All four
   are optional superbosses -- none gate a quest, they're loot/spectacle.

   Each uses two real PixelLab images (calm + enrage) instead of the
   procedural canvas art the earlier enemies use; drawBossSprite() below is
   the one shared anchor-at-feet/mirror/hit-flash routine all four call. */

import { T, TILE, GRAVITY, MAX_FALL } from "./defs.js";
import { Entity, Projectile, Enemy, burst } from "./entities.js";
import { clamp, aabb } from "./util.js";

const ART = "assets/games/trollrreria/bosses/";
function loadImg(file) {
  const img = new Image();
  img.src = ART + file;
  return img;
}

/* Shared draw: anchor the image's bottom edge to the boss's feet, mirror
   by facing direction, flash white on hit. targetH is the world-px height
   to scale the sprite to. */
function drawBossSprite(ctx, boss, img, targetH) {
  if (!img || !img.complete || !img.naturalWidth) return;
  const scale = targetH / img.naturalHeight;
  const w = img.naturalWidth * scale, h = targetH;
  const feetX = boss.cx, feetY = boss.y + boss.h;
  ctx.save();
  if (boss.hitFlash > 0) ctx.filter = "brightness(2)";
  ctx.translate(feetX, feetY);
  if (boss.dir < 0) ctx.scale(-1, 1);
  ctx.drawImage(img, -w / 2, -h, w, h);
  ctx.restore();
}

/* ============================================================ THE ARCHTROLL
   Warden of the Rage Comic Ruins. Ground-bound, hits hard and slow.
   Gimmick -- Tantrum Break: land enough hits in a short window and he goes
   briefly invulnerable ("triggered"), ranting; a RANGED hit (bow) cuts the
   tantrum short, a melee hit during it does nothing. Rewards carrying a
   bow instead of pure melee. */
export class Archtroll extends Entity {
  constructor(x, y) {
    super(x - 34, y - 74, 68, 74);
    this.boss = true;
    this.name = "THE ARCHTROLL";
    this.hp = this.maxHp = 1800;
    this.defense = 16;
    this.hitFlash = 0;
    this.dir = 1;
    this.wobble = 0;
    this.attackT = 2;
    this.tantrumT = 0;
    this.hitCount = 0;
    this.hitWindow = 0;
    this.imgCalm = loadImg("archtroll-calm.png");
    this.imgEnrage = loadImg("archtroll-enrage.png");
    this.light = 40;
  }

  get enraged() { return this.hp < this.maxHp * 0.5; }

  update(dt, game) {
    const p = game.player;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.wobble += dt;
    this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);

    if (this.tantrumT > 0) {
      this.tantrumT -= dt;
      this.vx *= 0.8;
    } else if (p && !p.dead) {
      const toward = Math.sign(p.cx - this.cx) || 1;
      this.dir = toward;
      const spd = this.enraged ? 62 : 42;
      this.vx = clamp(this.vx + toward * 500 * dt, -spd, spd);
      this.attackT -= dt;
      if (this.attackT <= 0) {
        this.attackT = this.enraged ? 1.6 + Math.random() * 0.6 : 2.4 + Math.random() * 0.8;
        this.attack(game, p);
      }
    }

    const hit = this.moveCollide(game.world, dt);
    if (hit.hitX && this.onGround) this.vy = -360;

    if (p && !p.dead && this.tantrumT <= 0 && aabb(this.box, p.box)) {
      p.hurt(game, 24, "the Archtroll", this.cx);
    }
    if (this.hitWindow > 0) {
      this.hitWindow -= dt;
      if (this.hitWindow <= 0) this.hitCount = 0;
    }
  }

  attack(game, p) {
    if (p.onGround && Math.abs(p.cx - this.cx) < 80) {
      game.floatText(this.cx, this.y - 10, "SLAM", "#c9432a");
      game.triggerShake && game.triggerShake(5, 0.2);
      p.hurt(game, this.enraged ? 26 : 18, "a ground slam", this.cx);
    }
    if (this.enraged) {
      for (let k = -1; k <= 1; k++) {
        const ang = Math.atan2(p.cy - this.cy, p.cx - this.cx) + k * 0.25;
        game.entities.push(new Projectile(
          this.cx, this.cy - 10, Math.cos(ang) * 260, Math.sin(ang) * 260,
          { dmg: 16, hostile: true, kind: "tear", gravity: 0.4, life: 3 }
        ));
      }
    }
  }

  /* ranged: true when this hit came from a Projectile (bow), not melee --
     see the 5th arg Projectile.update passes in entities.js */
  hurt(game, dmg, fromX, knock = 0, ranged = false) {
    if (this.tantrumT > 0) {
      if (ranged) this.tantrumT = Math.min(this.tantrumT, 0.15);
      return;
    }
    const final = Math.max(1, Math.round(dmg - this.defense / 2 + (Math.random() * 2 - 1)));
    this.hp -= final;
    this.hitFlash = 0.12;
    game.floatText(this.cx, this.y - 6, final, "#ffb300");
    game.sfx && game.sfx.squish();
    game.triggerHitPause && game.triggerHitPause(0.035);
    game.triggerShake && game.triggerShake(2.5, 0.1);
    this.hitCount++; this.hitWindow = 1.2;
    if (this.hitCount >= 5) {
      this.tantrumT = 1.3;
      this.hitCount = 0;
      game.floatText(this.cx, this.y - 20, "TRIGGERED", "#c9432a");
    }
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    burst(game, this.cx, this.cy, "#8a8f9c", 30, { spread: 340 });
    game.spawnDrop(this.cx, this.cy - 10, "banhammer", 1);
    game.spawnDrop(this.cx, this.cy - 10, "ancientGrinFragment", 3 + Math.floor(Math.random() * 3));
    game.stats.bossKills++;
    game.sfx && game.sfx.fanfare();
    game.triggerHitPause && game.triggerHitPause(0.09);
    game.triggerShake && game.triggerShake(9, 0.35);
    game.announce("The Archtroll's rage finally... buffers out.");
    game.recordProgress && game.recordProgress("boss");
    void window.TrollrunnerAccounts?.awardXp?.("boss_kill", "trollrreria");
  }

  draw(ctx) { drawBossSprite(ctx, this, this.enraged ? this.imgEnrage : this.imgCalm, 110); }
}

/* ================================================== RAREPEPE, THE LAST FEEL
   Pepe Swamp. Gimmick: this isn't a timer-gated enrage, it's PROVOKED --
   sustained aggression (hits landed in a short window) wakes the Smug
   phase early; a patient player keeps it Sad (defensive, easier, slower)
   much longer. HP < 50% still force-wakes it as a fallback either way. */
export class Rarepepe extends Entity {
  constructor(x, y) {
    super(x - 30, y - 64, 60, 64);
    this.boss = true;
    this.name = "RAREPEPE, THE LAST FEEL";
    this.hp = this.maxHp = 1500;
    this.defense = 10;
    this.hitFlash = 0;
    this.dir = 1;
    this.wobble = 0;
    this.smug = false;
    this.dashing = 0;
    this.provokeMeter = 0;
    this.summonT = 3;
    this.wailT = 4;
    this.dashT = 1.6;
    this.imgCalm = loadImg("rarepepe-calm.png");
    this.imgEnrage = loadImg("rarepepe-enrage.png");
    this.light = 30;
  }

  update(dt, game) {
    const p = game.player;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.wobble += dt;
    this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);

    if (!this.smug) {
      this.summonT -= dt;
      if (this.summonT <= 0 && p && !p.dead) {
        this.summonT = 8 + Math.random() * 4;
        const active = game.enemies.filter(e => e.type === "copeSlime" && !e.dead).length;
        if (active < 3) game.enemies.push(new Enemy("copeSlime", this.cx + (Math.random() - 0.5) * 80, this.y));
      }
      this.wailT -= dt;
      if (this.wailT <= 0 && p && !p.dead && Math.abs(p.cx - this.cx) < 160) {
        this.wailT = 6;
        p.atkDebuff = 4;
        game.floatText(p.cx, p.y - 10, "feels bad, man...", "#4a9b5e");
        burst(game, this.cx, this.cy, "#4a9b5e", 12, { spread: 200 });
      }
      if (p && !p.dead) {
        const toward = Math.sign(p.cx - this.cx) || 1;
        this.dir = toward;
        this.vx = clamp(this.vx + toward * 180 * dt, -30, 30);
      }
      if (this.hp < this.maxHp * 0.5) this.awaken(game);
    } else {
      this.dashT -= dt;
      if (this.dashT <= 0 && p && !p.dead) {
        this.dashT = 1.6;
        const toward = Math.sign(p.cx - this.cx) || 1;
        this.dir = toward;
        this.vx = toward * 260;
        this.dashing = 0.35;
      }
      if (this.dashing > 0) this.dashing -= dt;
      else this.vx *= 0.9;
    }

    const hit = this.moveCollide(game.world, dt);
    if (hit.hitX && this.onGround) this.vy = -320;

    if (p && !p.dead && aabb(this.box, p.box)) {
      p.hurt(game, this.smug ? (this.dashing > 0 ? 24 : 14) : 10, "Rarepepe", this.cx);
    }
    if (this.provokeMeter > 0) this.provokeMeter = Math.max(0, this.provokeMeter - dt * 0.5);
  }

  awaken(game) {
    if (this.smug) return;
    this.smug = true;
    game.announce("😏 Rarepepe smirks. The feels are over.");
    game.triggerShake && game.triggerShake(6, 0.25);
  }

  hurt(game, dmg, fromX, knock = 0) {
    const final = Math.max(1, Math.round(dmg - this.defense / 2 + (Math.random() * 2 - 1)));
    this.hp -= final;
    this.hitFlash = 0.12;
    game.floatText(this.cx, this.y - 6, final, this.smug ? "#8effa3" : "#4a9b5e");
    game.sfx && game.sfx.squish();
    game.triggerHitPause && game.triggerHitPause(0.035);
    game.triggerShake && game.triggerShake(2.5, 0.1);
    /* provoked: hits landed in quick succession wake Smug early */
    this.provokeMeter += 1;
    if (this.provokeMeter > 6 && !this.smug) this.awaken(game);
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    burst(game, this.cx, this.cy, this.smug ? "#8effa3" : "#4a9b5e", 30, { spread: 340 });
    game.spawnDrop(this.cx, this.cy - 10, "pepeScroll", 1);
    game.spawnDrop(this.cx, this.cy - 10, "smugCloak", 1);
    game.stats.bossKills++;
    game.sfx && game.sfx.fanfare();
    game.triggerHitPause && game.triggerHitPause(0.09);
    game.triggerShake && game.triggerShake(9, 0.35);
    game.announce("Rarepepe dissolves. feels... okay now, actually.");
    game.recordProgress && game.recordProgress("boss");
    void window.TrollrunnerAccounts?.awardXp?.("boss_kill", "trollrreria");
  }

  draw(ctx) { drawBossSprite(ctx, this, this.smug ? this.imgEnrage : this.imgCalm, 100); }
}

/* ==================================================== THE ELDER SHIBE
   Doge Moon Mines abyss floor. Gimmick: his signature attack reuses the
   EXACT fallable-tile system Moon Debris already runs on -- no new
   physics, just his ceiling firing on a pattern instead of scattered
   randomly. Floats, no gravity, same hover-lerp trick TrollEmperor uses. */
export class ElderShibe extends Entity {
  constructor(x, y) {
    super(x - 34, y - 70, 68, 70);
    this.boss = true;
    this.name = "THE ELDER SHIBE";
    this.hp = this.maxHp = 1700;
    this.defense = 14;
    this.hitFlash = 0;
    this.dir = 1;
    this.wobble = 0;
    this.debrisT = 3;
    this.imgCalm = loadImg("shibe-calm.png");
    this.imgEnrage = loadImg("shibe-enrage.png");
    this.light = 50;
  }

  get enraged() { return this.hp < this.maxHp * 0.5; }

  update(dt, game) {
    const p = game.player;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.wobble += dt;

    if (p && !p.dead) {
      const tx = p.cx + Math.sin(this.wobble * 1.2) * 70;
      const ty = p.cy - 90;
      this.vx += clamp(tx - this.cx, -500, 500) * 1.2 * dt;
      this.vy += clamp(ty - this.cy, -500, 500) * 1.2 * dt;
      this.vx *= 0.94; this.vy *= 0.94;
      this.dir = Math.sign(p.cx - this.cx) || 1;
      this.debrisT -= dt;
      if (this.debrisT <= 0) {
        this.debrisT = this.enraged ? 3 + Math.random() * 1.5 : 5 + Math.random() * 2;
        this.rainDebris(game, p);
      }
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x = clamp(this.x, TILE * 2, (game.world.w - 8) * TILE);
    this.y = clamp(this.y, TILE * 4, (game.world.h - 20) * TILE);

    if (p && !p.dead && aabb(this.box, p.box)) {
      p.hurt(game, this.enraged ? 22 : 16, "the Elder Shibe", this.cx);
    }
  }

  /* Telegraphs with a Comic Sans word, then converts the first stone
     ceiling tile in each lane (that already has open air below it) into
     Moon Debris -- world.set()'s existing wake-on-edit logic starts it
     falling immediately, same as if a miner had knocked its support out. */
  rainDebris(game, p) {
    game.floatText(p.cx, p.y - 30, this.enraged ? "VERY DAMAGE" : "such attack", "#e8c44c");
    const world = game.world;
    const n = this.enraged ? 7 : 4;
    const ptx = Math.floor(p.cx / TILE);
    for (let k = 0; k < n; k++) {
      const tx = ptx + (k - Math.floor(n / 2)) * 2;
      for (let ty = Math.floor(p.y / TILE) - 14; ty < Math.floor(p.y / TILE) - 2; ty++) {
        if (world.get(tx, ty) === T.STONE && !world.isSolid(tx, ty + 1)) {
          world.set(tx, ty, T.MOON_DEBRIS);
          break;
        }
      }
    }
    game.sfx && game.sfx.roar();
  }

  hurt(game, dmg, fromX, knock = 0) {
    const final = Math.max(1, Math.round(dmg - this.defense / 2 + (Math.random() * 2 - 1)));
    this.hp -= final;
    this.hitFlash = 0.12;
    game.floatText(this.cx, this.y - 6, final, "#6fd6ff");
    game.sfx && game.sfx.squish();
    game.triggerHitPause && game.triggerHitPause(0.035);
    game.triggerShake && game.triggerShake(2.5, 0.1);
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    burst(game, this.cx, this.cy, "#6fd6ff", 30, { spread: 340 });
    game.spawnDrop(this.cx, this.cy - 10, "moonShard", 12 + Math.floor(Math.random() * 8));
    game.spawnDrop(this.cx, this.cy - 10, "dogeSweaterToken", 1);
    game.spawnDrop(this.cx, this.cy - 10, "moonCoreShard", 2 + Math.floor(Math.random() * 3));
    game.stats.bossKills++;
    game.sfx && game.sfx.fanfare();
    game.triggerHitPause && game.triggerHitPause(0.09);
    game.triggerShake && game.triggerShake(9, 0.35);
    game.announce("The Elder Shibe drifts back to sleep. much rest.");
    game.recordProgress && game.recordProgress("boss");
    void window.TrollrunnerAccounts?.awardXp?.("boss_kill", "trollrreria");
  }

  draw(ctx) { drawBossSprite(ctx, this, this.enraged ? this.imgEnrage : this.imgCalm, 108); }
}

/* ============================================== ANON, THE KEYBOARD WARRIOR
   Going Viral's own boss -- the botnet's lone human defender. Gimmick --
   RGB Tells: instead of a wind-up animation, his keyboard's backlight
   color IS the telegraph. Red -> wide slash. Green -> overhead slam.
   Blue -> keycap projectile barrage (enraged only). Read the light, not
   the body. */
export class Anon extends Entity {
  constructor(x, y) {
    super(x - 30, y - 64, 60, 64);
    this.boss = true;
    this.name = "ANON, THE KEYBOARD WARRIOR";
    this.hp = this.maxHp = 1600;
    this.defense = 12;
    this.hitFlash = 0;
    this.dir = 1;
    this.wobble = 0;
    this.rgb = "red";
    this.rgbT = 2.2;
    this.slashActive = 0;
    this.imgCalm = loadImg("anon-calm.png");
    this.imgEnrage = loadImg("anon-enrage.png");
    this.light = 30;
  }

  get enraged() { return this.hp < this.maxHp * 0.5; }

  update(dt, game) {
    const p = game.player;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.wobble += dt;
    this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);

    if (p && !p.dead) {
      const toward = Math.sign(p.cx - this.cx) || 1;
      this.dir = toward;
      const spd = this.enraged ? 70 : 48;
      this.vx = clamp(this.vx + toward * 550 * dt, -spd, spd);
      this.rgbT -= dt;
      if (this.rgbT <= 0) {
        this.rgbT = this.enraged ? 1.4 + Math.random() * 0.5 : 2.2 + Math.random() * 0.6;
        const pool = this.enraged ? ["red", "green", "blue"] : ["red", "green"];
        this.rgb = pool[Math.floor(Math.random() * pool.length)];
        this.executeAttack(game, p);
      }
    }

    const hit = this.moveCollide(game.world, dt);
    if (hit.hitX && this.onGround) this.vy = -340;

    if (p && !p.dead && this.slashActive > 0 && aabb(this.box, p.box)) {
      p.hurt(game, this.enraged ? 22 : 16, "Anon", this.cx);
    }
    if (this.slashActive > 0) this.slashActive -= dt;
  }

  executeAttack(game, p) {
    if (this.rgb === "red") {
      this.slashActive = 0.3;
      game.floatText(this.cx, this.y - 10, "SLASH", "#ff4d5e");
    } else if (this.rgb === "green") {
      game.floatText(this.cx, this.y - 10, "SLAM", "#57bd5c");
      game.triggerShake && game.triggerShake(5, 0.2);
      if (Math.abs(p.cx - this.cx) < 70 && p.onGround) {
        p.hurt(game, this.enraged ? 26 : 18, "a keyboard slam", this.cx);
      }
    } else {
      game.floatText(this.cx, this.y - 10, "BARRAGE", "#5ec8d8");
      for (let k = -1; k <= 1; k++) {
        const ang = Math.atan2(p.cy - this.cy, p.cx - this.cx) + k * 0.3;
        game.entities.push(new Projectile(
          this.cx, this.cy - 10, Math.cos(ang) * 300, Math.sin(ang) * 300,
          { dmg: 14, hostile: true, kind: "dart", gravity: 0.2, life: 2.5 }
        ));
      }
    }
  }

  hurt(game, dmg, fromX, knock = 0) {
    const final = Math.max(1, Math.round(dmg - this.defense / 2 + (Math.random() * 2 - 1)));
    this.hp -= final;
    this.hitFlash = 0.12;
    game.floatText(this.cx, this.y - 6, final, "#5ec8d8");
    game.sfx && game.sfx.squish();
    game.triggerHitPause && game.triggerHitPause(0.035);
    game.triggerShake && game.triggerShake(2.5, 0.1);
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    burst(game, this.cx, this.cy, "#5ec8d8", 30, { spread: 340 });
    game.spawnDrop(this.cx, this.cy - 10, "rgbBlade", 1);
    game.spawnDrop(this.cx, this.cy - 10, "corruptedCore", 3 + Math.floor(Math.random() * 3));
    game.stats.bossKills++;
    game.sfx && game.sfx.fanfare();
    game.triggerHitPause && game.triggerHitPause(0.09);
    game.triggerShake && game.triggerShake(9, 0.35);
    game.announce("Anon's keyboard finally disconnects. o7, soldier.");
    game.recordProgress && game.recordProgress("boss");
    void window.TrollrunnerAccounts?.awardXp?.("boss_kill", "trollrreria");
  }

  draw(ctx) { drawBossSprite(ctx, this, this.enraged ? this.imgEnrage : this.imgCalm, 100); }
}
