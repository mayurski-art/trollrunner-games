/* Trollrreria — the player: physics, mining/placing/using, health, breath,
   fall damage. Sprite = the Troll Kombat gladiator rig (trollface approved),
   feet-anchored, with a drawn fallback while sheets load. */

import {
  T, TILES, ITEMS, TILE, GRAVITY, MAX_FALL, PLAYER_W, PLAYER_H, REACH,
} from "./defs.js";
import { Entity } from "./entities.js";
import { getIcon } from "./icons.js";
import { clamp } from "./util.js";

const RIG_DIR = "assets/games/troll-kombat/fighters/gladiator/anims/";
const RIG = {
  idle: { frames: 8, fps: 9 },
  walk: { frames: 6, fps: 12 },
  jump: { frames: 9, fps: 14 },
  hit:  { frames: 6, fps: 16 },
  ko:   { frames: 7, fps: 10 },
};
const CELL = 136;
const BODY_H = 58;            // drawn height in world px

export class Player extends Entity {
  static _swingSeq = 0;          // unique id per melee swing (hit dedup)

  constructor(tx, ty) {
    super(tx * TILE + (TILE - PLAYER_W) / 2, ty * TILE - PLAYER_H, PLAYER_W, PLAYER_H);
    this.dir = 1;
    this.melee = null;           // live swing: { def, t, id }
    this.hp = 100; this.maxHp = 100;
    this.breath = 8; this.maxBreath = 8;
    this.dead = false;
    this.invuln = 0;
    this.regenWait = 0;
    this.coyote = 0; this.jumpBuf = 0;
    this.fallDist = 0;
    this.useTimer = 0;         // seconds until next use allowed
    this.swing = 0;            // 0..1 swing progress (visual)
    this.swingDur = 0.28;
    this.potionCd = 0;
    this.animTime = 0;
    this.anim = "idle";
    this.hitFlash = 0;
    this.loadRig();
  }

  loadRig() {
    this.rig = {};
    this.rigReady = false;
    let pending = 0;
    for (const key in RIG) {
      pending++;
      const img = new Image();
      img.onload = () => {
        this.rig[key] = { img, frames: RIG[key].frames, fps: RIG[key].fps };
        if (key === "idle") this.measureRig(img);
        if (--pending === 0) this.rigReady = true;
      };
      img.onerror = () => { if (--pending === 0) this.rigReady = Object.keys(this.rig).length > 0; };
      img.src = RIG_DIR + key + ".png";
    }
  }

  /* Content bbox of idle frame 0 — used to anchor feet + scale all anims. */
  measureRig(img) {
    const c = document.createElement("canvas");
    c.width = CELL; c.height = CELL;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, CELL, CELL, 0, 0, CELL, CELL);
    const d = g.getImageData(0, 0, CELL, CELL).data;
    let x0 = CELL, y0 = CELL, x1 = 0, y1 = 0;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        if (d[(y * CELL + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 > x0) this.rigBox = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /* ------------------------------------------------------------ update */
  update(dt, game) {
    if (this.dead) return;
    const input = game.input, world = game.world;

    this.invuln = Math.max(0, this.invuln - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.useTimer = Math.max(0, this.useTimer - dt);
    this.potionCd = Math.max(0, this.potionCd - dt);
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt / this.swingDur);
    this.animTime += dt;

    /* live melee sweep: resolve hits across the swing's active window */
    if (this.melee) {
      game.meleeSweep && game.meleeSweep(this.melee);
      this.melee.t -= dt;
      if (this.melee.t <= 0) this.melee = null;
    }

    /* -------- movement input */
    const left = input.down("KeyA") || input.down("ArrowLeft");
    const right = input.down("KeyD") || input.down("ArrowRight");
    const jumpKey = input.down("Space") || input.down("KeyW") || input.down("ArrowUp");
    const jumpHit = input.hit("Space") || input.hit("KeyW") || input.hit("ArrowUp");
    const drop = input.down("KeyS") || input.down("ArrowDown");

    const water = this.inLiquid(world, 0);
    const lava = this.inLiquid(world, 1);
    const belowTy = Math.floor((this.y + this.h + 2) / TILE);
    const tileBelow = TILES[world.get(Math.floor(this.cx / TILE), belowTy)];
    const icy = this.onGround && tileBelow && tileBelow.slippery;

    const accel = water ? 700 : 1250;
    const fric = water ? 320 : icy ? 190 : this.onGround ? 1350 : 260;
    const maxSpd = water ? 88 : 152;

    if (left && !right) { this.vx = Math.max(this.vx - accel * dt, -maxSpd); this.dir = -1; }
    else if (right && !left) { this.vx = Math.min(this.vx + accel * dt, maxSpd); this.dir = 1; }
    else {
      const s = Math.sign(this.vx);
      this.vx -= s * fric * dt;
      if (Math.sign(this.vx) !== s) this.vx = 0;
    }

    /* -------- jumping / swimming */
    this.coyote = this.onGround ? 0.09 : Math.max(0, this.coyote - dt);
    this.jumpBuf = jumpHit ? 0.09 : Math.max(0, this.jumpBuf - dt);
    if (water) {
      if (jumpKey) this.vy = Math.max(this.vy - 900 * dt, -130);
      this.vy = Math.min(this.vy + GRAVITY * 0.32 * dt, 120);
    } else {
      if (this.jumpBuf > 0 && this.coyote > 0) {
        this.vy = -548;
        this.coyote = 0; this.jumpBuf = 0;
        game.sfx && game.sfx.jump();
      }
      /* variable jump height (floor keeps tap-jumps useful on touch) */
      if (this.vy < -240 && !jumpKey) this.vy = -240;
      this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);
    }

    /* -------- fall tracking + move */
    const fallingBefore = this.vy > 0 ? this.vy : 0;
    if (this.vy > 0 && !water) this.fallDist += this.vy * dt;
    if (water || lava) this.fallDist = 0;
    this.moveCollide(world, dt, true, drop);
    if (this.onGround) {
      if (this.fallDist > 9.5 * TILE && fallingBefore > 320) {
        const dmg = Math.round((this.fallDist / TILE - 9.5) * 5.5);
        if (dmg > 0) this.hurt(game, dmg, "gravity", null, true);
      }
      this.fallDist = 0;
    }

    /* -------- breath + hazards */
    const headTx = Math.floor(this.cx / TILE), headTy = Math.floor((this.y + 6) / TILE);
    const headIdx = headTy * world.w + headTx;
    const submerged = world.inBounds(headTx, headTy) &&
      world.liquid[headIdx] >= 6 && world.liquidType[headIdx] === 0;
    if (submerged) {
      this.breath -= dt / 1.3;
      if (this.breath <= 0) { this.breath = 0; this._drown = (this._drown || 0) + dt; }
      if (this._drown > 0.8) { this._drown = 0; this.hurt(game, 12, "the deep", null, true); }
    } else {
      this.breath = Math.min(this.maxBreath, this.breath + dt * 3);
      this._drown = 0;
    }
    if (lava) this.hurt(game, 24, "lava", this.cx - this.dir * 10);

    /* -------- regen */
    this.regenWait += dt;
    if (this.regenWait > 6 && this.hp < this.maxHp) {
      this._regenAcc = (this._regenAcc || 0) + dt;
      if (this._regenAcc >= 1.6) { this._regenAcc = 0; this.hp = Math.min(this.maxHp, this.hp + 1); game.ui && game.ui.dirtyHud(); }
    }

    /* -------- hotbar selection */
    for (let k = 0; k < 10; k++) {
      if (input.hit("Digit" + ((k + 1) % 10))) { game.inventory.sel = k; game.ui && game.ui.dirtyHud(); }
    }
    if (input.wheel !== 0) {
      game.inventory.sel = (game.inventory.sel + input.wheel + 10) % 10;
      game.ui && game.ui.dirtyHud();
    }
    if (input.hit("KeyQ")) this.tossSelected(game);

    /* -------- use / interact */
    if (!game.pointerOverUI) {
      if (input.mouse.left) this.useHeld(game, input.clicked.left);
      if (input.clicked.right) game.interact();
    }

    /* -------- animation state */
    if (!this.onGround && !water) this.anim = "jump";
    else if (Math.abs(this.vx) > 12) this.anim = "walk";
    else this.anim = "idle";
  }

  /* Use the selected item (mouse held; fresh = clicked this frame). */
  useHeld(game, fresh) {
    const sel = game.inventory.selected;
    const m = game.mouseWorld();
    const inReach = this.tileInReach(m.tx, m.ty);
    /* face the cursor while using anything (so swings hit either side) */
    this.dir = m.x >= this.cx ? 1 : -1;

    if (!sel) {
      /* bare fists: punch-mine soft tiles slowly */
      const fist = { tool: "pick", power: 20, speed: 2 };
      const t = game.input.coarseAim ? game.snapMineTarget(m, fist) : m;
      if (t && this.tileInReach(t.tx, t.ty)) game.mineTick(t.tx, t.ty, fist, this);
      return;
    }
    const def = ITEMS[sel.id];
    switch (def.type) {
      case "tool":
        if (def.tool === "wrench") {
          if (inReach) game.wireTick(m.tx, m.ty);
        } else {
          /* touch taps snap to the nearest breakable neighbour tile */
          const t = game.input.coarseAim && def.tool !== "hammer"
            ? game.snapMineTarget(m, def) : m;
          if (t && this.tileInReach(t.tx, t.ty)) game.mineTick(t.tx, t.ty, def, this);
          else this.startSwing(0.3);
        }
        break;
      case "weapon":
        if (this.useTimer <= 0) {
          this.useTimer = 1 / def.speed;
          this.startSwing(1 / def.speed * 0.8);
          /* the swing stays "live" for its visible arc — hits resolve over
             the whole window (in update), not just this first frame, so an
             enemy walking into the blade mid-swing still gets clipped */
          this.melee = { def, t: this.swingDur * 0.9, id: ++Player._swingSeq };
          game.sfx && game.sfx.swing();
        }
        break;
      case "bow":
        if (this.useTimer <= 0 && game.shootArrow && game.shootArrow(def)) {
          this.useTimer = 1 / def.speed;
        }
        break;
      case "block":
        if (this.useTimer <= 0 && inReach && game.tryPlace(m.tx, m.ty, sel.id)) {
          this.useTimer = 0.12;
        }
        break;
      case "wall":
        if (this.useTimer <= 0 && inReach && game.tryPlaceWall(m.tx, m.ty, sel.id)) {
          this.useTimer = 0.1;
        }
        break;
      case "potion":
        if (fresh && this.potionCd <= 0 && this.hp < this.maxHp) {
          game.inventory.useSelected();
          this.hp = Math.min(this.maxHp, this.hp + def.heal);
          this.potionCd = 18;
          this.regenWait = 99;
          game.sfx && game.sfx.potion();
          game.ui && game.ui.dirtyHud();
          game.floatText(this.cx, this.y - 6, "+" + def.heal, "#57bd5c");
        }
        break;
      case "summon":
        if (fresh && game.trySummonBoss) game.trySummonBoss(sel.id);
        break;
    }
  }

  startSwing(dur) {
    if (this.swing <= 0) { this.swingDur = Math.max(0.16, dur); this.swing = 1; }
  }

  tileInReach(tx, ty) {
    const dx = (tx + 0.5) * TILE - this.cx;
    const dy = (ty + 0.5) * TILE - this.cy;
    return dx * dx + dy * dy <= REACH * TILE * REACH * TILE;
  }

  tossSelected(game) {
    const s = game.inventory.selected;
    if (!s) return;
    const id = game.inventory.useSelected();
    if (!id) return;
    game.spawnDrop(this.cx + this.dir * 14, this.cy - 6, id, 1, this.dir * 190);
    game.ui && game.ui.dirtyHud();
  }

  /* ------------------------------------------------------------ damage */
  hurt(game, dmg, cause, fromX, pierce = false) {
    if (this.dead || (this.invuln > 0 && !pierce)) return;
    if (this.invuln > 0 && pierce) return;   // env damage also respects i-frames
    const def = game.inventory.totalDefense();
    const final = Math.max(1, Math.round(dmg - def / 2 + (Math.random() * 2 - 1)));
    this.hp -= final;
    this.invuln = 0.75;
    this.hitFlash = 0.22;
    this.regenWait = 0;
    game.floatText(this.cx, this.y - 4, final, "#ff4d5e");
    game.sfx && game.sfx.hurt();
    if (fromX !== null && fromX !== undefined) {
      this.vx = Math.sign(this.cx - fromX) * 210;
      this.vy = Math.min(this.vy, -170);
    }
    game.ui && game.ui.dirtyHud();
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      game.onPlayerDeath(cause);
    }
  }

  respawn(game) {
    this.hp = this.maxHp;
    this.breath = this.maxBreath;
    this.dead = false;
    this.invuln = 2;
    this.fallDist = 0;
    this.vx = this.vy = 0;
    this.x = game.spawn.x * TILE + (TILE - this.w) / 2;
    this.y = game.spawn.y * TILE - this.h;
    game.ui && game.ui.dirtyHud();
  }

  /* -------------------------------------------------------------- draw */
  draw(ctx, game) {
    if (this.dead) return;
    if (this.invuln > 0 && Math.floor(this.invuln * 14) % 2 === 0 && this.hitFlash <= 0) return;

    const a = this.rig && this.rig[this.anim];
    const feetX = this.cx, feetY = this.y + this.h;
    if (a && this.rigBox) {
      let fi;
      if (this.anim === "jump") {
        /* map vertical velocity onto the jump strip */
        const t = clamp((this.vy + 550) / 1100, 0, 0.999);
        fi = Math.floor(t * a.frames);
      } else {
        fi = Math.floor(this.animTime * a.fps) % a.frames;
      }
      const b = this.rigBox;
      const scale = BODY_H / b.h;
      const dw = b.w * scale, dh = BODY_H;
      ctx.save();
      ctx.translate(feetX, feetY);
      if (this.dir < 0) ctx.scale(-1, 1);
      if (this.hitFlash > 0) ctx.filter = "brightness(1.9) saturate(0.4)";
      ctx.drawImage(a.img, fi * CELL + b.x, b.y, b.w, b.h, -dw / 2, -dh, dw, dh);
      ctx.restore();
    } else {
      /* fallback: chunky troll silhouette with a grin */
      ctx.fillStyle = this.hitFlash > 0 ? "#fff" : "#b9b3a8";
      ctx.fillRect(this.x, this.y + 14, this.w, this.h - 14);
      ctx.fillStyle = "#e8e4da";
      ctx.fillRect(this.x - 2, this.y - 4, this.w + 4, 20);
      ctx.fillStyle = "#1c1424";
      ctx.fillRect(this.x + (this.dir > 0 ? 12 : 2), this.y + 2, 3, 3);
      ctx.beginPath();
      ctx.arc(this.cx, this.y + 9, 7, 0.2, Math.PI - 0.2);
      ctx.strokeStyle = "#1c1424"; ctx.lineWidth = 1.6; ctx.stroke();
    }

    /* held item swing */
    const sel = game.inventory.selected;
    if (sel && this.swing > 0) {
      const def = ITEMS[sel.id];
      if (def.type === "tool" || def.type === "weapon") {
        const prog = 1 - this.swing;
        const ang = (-1.9 + prog * 2.4) * this.dir;
        ctx.save();
        ctx.translate(feetX + this.dir * 4, this.y + 16);
        ctx.rotate(ang);
        const icon = getIcon(sel.id);
        const s = def.type === "weapon" && def.rare ? 34 : 26;
        if (this.dir < 0) ctx.scale(-1, 1);
        ctx.drawImage(icon, 2, -s - 2, s, s);
        ctx.restore();
      }
    }
  }
}
