/* Trollrreria — the player: physics, mining/placing/using, health, breath,
   fall damage. Sprite = the trollface prospector rig (trollface approved),
   feet-anchored, with a drawn fallback while sheets load. */

import {
  T, TILES, ITEMS, TILE, GRAVITY, MAX_FALL, PLAYER_W, PLAYER_H, REACH,
} from "./defs.js";
import { Entity, burst, Bobber } from "./entities.js";
import { SKINS } from "./store.js";
import { getIcon } from "./icons.js";
import { clamp } from "./util.js";

/* Every selectable character shares the same animation set + frame counts
   (idle/walk/jump/hit/ko/mine/attack) so the rest of the class doesn't need
   to know which one is active -- only the sprite folder changes. */
export const CHARACTERS = {
  prospector: { name: "Trollface Prospector", dir: "assets/games/trollrreria/sprites/prospector/anims/" },
  gladiator:  { name: "Troll Gladiator", dir: "assets/games/troll-kombat/fighters/gladiator/anims/" },
};
const DEFAULT_CHARACTER = "prospector";
const RIG = {
  idle:   { frames: 8, fps: 9 },
  walk:   { frames: 6, fps: 12 },
  jump:   { frames: 9, fps: 14 },
  hit:    { frames: 6, fps: 16 },
  ko:     { frames: 7, fps: 10 },
  /* swing-progress-driven, not looped -- see draw() */
  mine:   { frames: 9, fps: 24 },
  attack: { frames: 9, fps: 24 },
};
const CELL = 136;
const BODY_H = 58;            // drawn height in world px

/* Merge an item's static def with whatever enchantment its stack is
   carrying (stack.ench, from the enchant table) -- tool power/speed and
   weapon dmg/knock bonuses apply wherever the def is read (mining,
   melee), armor's own def bonus is applied directly in totalDefense(). */
function withEnchant(def, ench) {
  if (!ench) return def;
  const out = { ...def };
  if (ench.power) out.power = (out.power || 0) + ench.power;
  if (ench.speed) out.speed = (out.speed || 0) + ench.speed;
  if (ench.dmg) out.dmg = (out.dmg || 0) + ench.dmg;
  if (ench.knock) out.knock = (out.knock || 0) + ench.knock;
  return out;
}

export class Player extends Entity {
  static _swingSeq = 0;          // unique id per melee swing (hit dedup)

  constructor(tx, ty, character = DEFAULT_CHARACTER) {
    super(tx * TILE + (TILE - PLAYER_W) / 2, ty * TILE - PLAYER_H, PLAYER_W, PLAYER_H);
    this.dir = 1;
    this.melee = null;           // live swing: { def, t, id }
    this.hp = 100; this.maxHp = 100;
    this.hunger = 100; this.maxHunger = 100;
    this.breath = 8; this.maxBreath = 8;
    this.dead = false;
    this.invuln = 0;
    this.regenWait = 0;
    this.coyote = 0; this.jumpBuf = 0;
    this.airJumps = 0;         // Frog Legs unlock (game.flags.doubleJump)
    this.atkDebuff = 0;        // seconds remaining; Rarepepe's sorrowful wail
    this.fallDist = 0;
    this.useTimer = 0;         // seconds until next use allowed
    this.swing = 0;            // 0..1 swing progress (visual)
    this.swingDur = 0.28;
    this.potionCd = 0;
    this.dashCd = 0;           // Dash Boots cooldown
    this._tapLeftT = -99; this._tapRightT = -99;   // double-tap timestamps (dash)
    this.animTime = 0;
    this.anim = "idle";
    this.hitFlash = 0;
    this.character = CHARACTERS[character] ? character : DEFAULT_CHARACTER;
    /* Timed food buffs (Phase 4): keyed by buff.key so eating a second
       different meal stacks rather than overwriting, but re-eating the
       SAME meal just refreshes its timer instead of stacking regen/speed
       -- see applyBuff() and the "food" case in useHeld() below. */
    this.buffs = new Map();
    this.fishing = null;      // { tx, ty, wx, wy, state: cast|waiting|biting, timer }
    this.grapple = null;      // { x, y, t } -- world point being reeled toward
    this.grappleCd = 0;
    this.loadRig();
  }

  /* Swap character mid-game (e.g. loading a save whose choice differs from
     the default one used while the world was still being constructed). */
  setCharacter(character) {
    if (!character || character === this.character || !CHARACTERS[character]) return;
    this.character = character;
    this.loadRig();
  }

  loadRig() {
    const dir = CHARACTERS[this.character].dir;
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
      img.src = dir + key + ".png";
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
    this.atkDebuff = Math.max(0, this.atkDebuff - dt);
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt / this.swingDur);
    this.animTime += dt;

    for (const [key, b] of this.buffs) {
      b.timeLeft -= dt;
      if (b.timeLeft <= 0) this.buffs.delete(key);
    }

    /* fishing: ticks every frame regardless of input, same as the buffs
       loop just above -- useRod() (below) only handles the click edges
       (cast / reel-in-early / catch), this is what actually advances the
       wait between casting and getting a bite. */
    if (this.fishing) {
      const f = this.fishing;
      f.timer -= dt;
      if (f.state === "cast" && f.timer <= 0) {
        f.state = "waiting"; f.timer = 2 + Math.random() * 5;
      } else if (f.state === "waiting" && f.timer <= 0) {
        f.state = "biting"; f.timer = 0.8;
      } else if (f.state === "biting" && f.timer <= 0) {
        f.state = "waiting"; f.timer = 2 + Math.random() * 4;
        game.floatText(this.cx, this.y - 10, "The fish got away...", "#8fb573");
      }
    }

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

    const perks = game.inventory.accessoryPerks();
    for (const b of this.buffs.values()) {
      if (b.speedMult) perks.speedMult *= b.speedMult;
      if (b.regenBonus) perks.regenBonus += b.regenBonus;
    }
    this.dashCd = Math.max(0, this.dashCd - dt);

    const water = this.inLiquid(world, 0);
    const lava = this.inLiquid(world, 1);
    const sludge = this.inLiquid(world, 2);
    const wet = water || sludge;     // swamp sludge swims like water, just toxic
    const onRope = this.onRope(world);
    const belowTy = Math.floor((this.y + this.h + 2) / TILE);
    const belowId = world.get(Math.floor(this.cx / TILE), belowTy);
    const tileBelow = TILES[belowId];
    const icy = this.onGround && tileBelow && tileBelow.slippery;
    /* Rail (Phase 6, simplified): a low-friction, higher-top-speed ride
       rather than a separate cart entity -- the player's own body is the
       "cart". No slope-acceleration or junction switching in this pass. */
    const onRail = this.onGround && belowId === T.RAIL;

    const accel = wet ? 700 : 1250;
    const fric = wet ? 320 : onRail ? 40 : icy ? 190 : this.onGround ? 1350 : 260;
    const maxSpd = (wet ? 88 : onRail ? 152 * 1.6 : 152) * perks.speedMult;

    if (left && !right) { this.vx = Math.max(this.vx - accel * dt, -maxSpd); this.dir = -1; }
    else if (right && !left) { this.vx = Math.min(this.vx + accel * dt, maxSpd); this.dir = 1; }
    else {
      const s = Math.sign(this.vx);
      this.vx -= s * fric * dt;
      if (Math.sign(this.vx) !== s) this.vx = 0;
    }

    /* Dash Boots: double-tap A/D within 0.3s for a burst of speed, on a
       cooldown so it's a movement tool rather than a permanent speed mult. */
    if (perks.dash) {
      if (input.hit("KeyA") || input.hit("ArrowLeft")) {
        if (this.animTime - this._tapLeftT < 0.3 && this.dashCd <= 0) {
          this.vx = -420; this.dashCd = 0.9;
          burst(game, this.cx, this.cy, "#e8e4da", 10, { spread: 140, life: 0.25 });
        }
        this._tapLeftT = this.animTime;
      }
      if (input.hit("KeyD") || input.hit("ArrowRight")) {
        if (this.animTime - this._tapRightT < 0.3 && this.dashCd <= 0) {
          this.vx = 420; this.dashCd = 0.9;
          burst(game, this.cx, this.cy, "#e8e4da", 10, { spread: 140, life: 0.25 });
        }
        this._tapRightT = this.animTime;
      }
    }

    /* Grapple Ring: press G to fire a troll tongue toward the cursor,
       latching the first solid tile in range and reeling the player in
       (see fireGrapple() / the pull override before moveCollide, below)
       -- an instant pull-in rather than a simulated rope swing, simpler
       to tune and plenty punchy for a platformer this size. */
    this.grappleCd = Math.max(0, this.grappleCd - dt);
    if (perks.grapple && input.hit("KeyG") && this.grappleCd <= 0 && !this.grapple) {
      this.fireGrapple(game, game.mouseWorld());
    }

    /* -------- jumping / swimming */
    this.coyote = this.onGround ? 0.09 : Math.max(0, this.coyote - dt);
    this.jumpBuf = jumpHit ? 0.09 : Math.max(0, this.jumpBuf - dt);
    if (this.onGround) this.airJumps = (game.flags.doubleJump || perks.doubleJump) ? 1 : 0;
    if (game.creative) {
      /* free flight: no gravity, jump/drop move straight up/down, hovers
         in place with no input instead of falling */
      if (jumpKey) this.vy = Math.max(this.vy - 900 * dt, -260);
      else if (drop) this.vy = Math.min(this.vy + 900 * dt, 260);
      else this.vy -= this.vy * Math.min(1, 8 * dt);
    } else if (wet) {
      if (jumpKey) this.vy = Math.max(this.vy - 900 * dt, -130);
      this.vy = Math.min(this.vy + GRAVITY * 0.32 * dt, 120);
    } else if (onRope) {
      /* climb, or just grab on to arrest a fall -- no input holds you in place */
      if (jumpKey) this.vy = Math.max(this.vy - 1400 * dt, -110);
      else if (drop) this.vy = Math.min(this.vy + 1400 * dt, 110);
      else this.vy -= this.vy * Math.min(1, 10 * dt);
    } else {
      if (this.jumpBuf > 0 && this.coyote > 0) {
        this.vy = (game.flags.moonBoots ? -600 : -548) - perks.jumpBoost;
        this.coyote = 0; this.jumpBuf = 0;
        game.sfx && game.sfx.jump();
      } else if (this.jumpBuf > 0 && this.airJumps > 0 && this.coyote <= 0) {
        /* Frog Legs / Troll Wings: one extra jump once coyote time is spent */
        this.airJumps--;
        this.vy = -500 - perks.jumpBoost * 0.6;
        this.jumpBuf = 0;
        game.sfx && game.sfx.jump();
        burst(game, this.cx, this.y + this.h, "#5f8f3a", 8, { spread: 120, life: 0.3, gravity: 0.3 });
      }
      /* variable jump height (floor keeps tap-jumps useful on touch) */
      if (this.vy < -240 && !jumpKey) this.vy = -240;
      if (perks.glide && jumpKey && this.vy > 40) {
        /* Troll Wings glide: cap descent speed instead of free-falling */
        this.vy = Math.min(this.vy + GRAVITY * 0.16 * dt, 95);
      } else {
        this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);
      }
    }

    /* Grapple pull: overrides normal vx/vy for the frame while active,
       same "just win the tug of war" approach as swimming/rope-climbing
       above rather than layering in yet another physics mode. Releases
       on arrival, timeout, or (implicitly) a wall stopping the player in
       moveCollide just below -- momentum carries through either way. */
    if (this.grapple) {
      const gr = this.grapple;
      gr.t -= dt;
      const gdx = gr.x - this.cx, gdy = gr.y - this.cy;
      const gdist = Math.hypot(gdx, gdy) || 1;
      if (gdist < 18 || gr.t <= 0) {
        this.grapple = null;
        this.grappleCd = 0.6;
      } else {
        const pullSpeed = 560;
        this.vx = (gdx / gdist) * pullSpeed;
        this.vy = (gdy / gdist) * pullSpeed;
      }
    }

    /* -------- fall tracking + move */
    const fallingBefore = this.vy > 0 ? this.vy : 0;
    if (this.vy > 0 && !wet) this.fallDist += this.vy * dt;
    if (wet || lava || onRope || game.creative || this.grapple) this.fallDist = 0;
    this.moveCollide(world, dt, true, drop);
    if (this.onGround) {
      /* Moon Boots: higher safe-fall threshold + softer landings */
      const safeTiles = game.flags.moonBoots ? 13 : 9.5;
      if (this.fallDist > safeTiles * TILE && fallingBefore > 320) {
        const dmg = Math.round((this.fallDist / TILE - safeTiles) * (game.flags.moonBoots ? 3.5 : 5.5));
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
    if (sludge) this.hurt(game, 4, "the sludge", null);

    /* -------- hunger: drains from activity, not idle time -- standing
       still barely costs anything, walking costs more, sprinting costs
       the most (matches Minecraft's exhaustion-from-actions model, where
       a stationary player's hunger bar practically never moves). Starves
       you once empty; passive regen needs a well-fed troll (also matches
       Minecraft's "regen needs hunger" gate). */
    const sprinting = this.onGround && Math.abs(this.vx) > maxSpd * 0.7;
    const walking = this.onGround && Math.abs(this.vx) > 12;
    const hungerRate = sprinting ? 0.075 : walking ? 0.035 : 0.012;
    this.hunger = Math.max(0, this.hunger - dt * hungerRate);
    if (this.hunger <= 0) {
      this._starveAcc = (this._starveAcc || 0) + dt;
      if (this._starveAcc >= 4) {
        this._starveAcc = 0;
        this.hp = Math.max(0, this.hp - 3);
        this.hitFlash = 0.22;
        game.floatText(this.cx, this.y - 4, 3, "#ff4d5e");
        game.ui && game.ui.dirtyHud();
        if (this.hp <= 0 && !this.dead) { this.dead = true; game.onPlayerDeath("starvation"); }
      }
    } else {
      this._starveAcc = 0;
    }

    /* -------- regen */
    this.regenWait += dt;
    if (this.regenWait > 6 && this.hp < this.maxHp && this.hunger > 20) {
      this._regenAcc = (this._regenAcc || 0) + dt * (1 + perks.regenBonus);
      if (this._regenAcc >= 1.6) { this._regenAcc = 0; this.hp = Math.min(this.maxHp, this.hp + 1); game.ui && game.ui.dirtyHud(); }
    }

    /* -------- hotbar selection (hitting the already-selected slot's key
       again unequips it -- bare hands -- same as clicking that slot) */
    for (let k = 0; k < 10; k++) {
      if (input.hit("Digit" + ((k + 1) % 10))) {
        const inv = game.inventory;
        if (inv.sel === k && !inv.unequipped) inv.unequipped = true;
        else { inv.sel = k; inv.unequipped = false; }
        game.ui && game.ui.dirtyHud();
      }
    }
    if (input.wheel !== 0) {
      game.inventory.sel = (game.inventory.sel + input.wheel + 10) % 10;
      game.inventory.unequipped = false;
      game.ui && game.ui.dirtyHud();
    }
    if (input.hit("KeyQ")) this.tossSelected(game);

    /* -------- cursor: crosshair while something is equipped (aiming a
       tool/weapon), default arrow when bare-handed/unequipped */
    game.canvas.classList.toggle("tt-equipped", !!game.inventory.selected);

    /* -------- use / interact */
    if (!game.pointerOverUI) {
      if (input.mouse.left) this.useHeld(game, input.clicked.left);
      if (input.clicked.right) game.interact();
    }

    /* -------- animation state */
    if (!this.onGround && !water) this.anim = "jump";
    else if (this.swing > 0) {
      const sel = game.inventory.selected;
      const swingDef = sel && ITEMS[sel.id];
      this.anim = swingDef && swingDef.type === "weapon" ? "attack" : "mine";
    } else if (Math.abs(this.vx) > 12) this.anim = "walk";
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
    const def = withEnchant(ITEMS[sel.id], sel.ench);
    switch (def.type) {
      case "tool":
        if (def.tool === "wrench") {
          if (inReach) game.wireTick(m.tx, m.ty);
        } else if (def.tool === "rod") {
          this.useRod(game, fresh, m);
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
      case "food":
        if (fresh && this.hunger < this.maxHunger) {
          game.inventory.useSelected();
          this.hunger = Math.min(this.maxHunger, this.hunger + def.hunger);
          if (def.hpBonus) this.hp = Math.min(this.maxHp, this.hp + def.hpBonus);
          /* raw meat: small chance of a queasy gut-punch, cooked is always safe */
          if (def.raw && Math.random() < 0.2) {
            this.hp = Math.max(1, this.hp - 4);
            game.floatText(this.cx, this.y - 14, "queasy...", "#8fb573");
          }
          if (def.buff) this.applyBuff(def.buff, game);
          game.sfx && game.sfx.potion();
          game.ui && game.ui.dirtyHud();
          game.floatText(this.cx, this.y - 6, "+" + def.hunger, "#e8b23c");
        }
        break;
    }
  }

  /* Cooking-pot meals (Phase 4) grant a timed buff on top of the usual
     hunger refill -- speed/regen multipliers folded into accessoryPerks'
     output each frame (see the buffs loop in update() above), same one
     system a future Alchemist migration could plug into rather than
     inventing a second. Re-eating the same meal just refreshes the
     timer; a different meal stacks alongside it. */
  applyBuff(buff, game) {
    this.buffs.set(buff.key, { ...buff, timeLeft: buff.dur });
    game.floatText(this.cx, this.y - 22, buff.label || "Well Fed", "#ffd23c");
  }

  /* Steps outward from the player toward `m` in small increments, looking
     for the first solid tile within range -- a cheap raycast, adequate at
     this tile scale without needing a proper line-tile intersection test. */
  fireGrapple(game, m) {
    const world = game.world;
    const dx = m.x - this.cx, dy = m.y - this.cy;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist, ny = dy / dist;
    const maxDist = TILE * 11, step = TILE * 0.4;
    let hit = null;
    for (let d = step; d <= maxDist; d += step) {
      const wx = this.cx + nx * d, wy = this.cy + ny * d;
      if (world.isSolid(Math.floor(wx / TILE), Math.floor(wy / TILE))) { hit = { x: wx, y: wy }; break; }
    }
    if (!hit) {
      game.floatText(this.cx, this.y - 10, "No anchor in range", "#8fb573");
      return;
    }
    this.grapple = { x: hit.x, y: hit.y, t: 0.45 };
    game.sfx && game.sfx.swing();
  }

  /* Troll Rod (Phase 5): one click starts the cast, the next click either
     catches (if a fish is biting) or reels in early with nothing. The
     wait-then-bite timing itself is ticked every frame in update() above,
     not here -- this only ever reacts to the click edge (fresh). */
  useRod(game, fresh, m) {
    if (!fresh) return;
    if (!this.fishing) {
      if (!this.tileInReach(m.tx, m.ty) || !game.isFishableWater(m.tx, m.ty)) return;
      this.fishing = {
        tx: m.tx, ty: m.ty,
        wx: m.tx * TILE + 8, wy: m.ty * TILE + 4,
        state: "cast", timer: 0.35,
      };
      game.entities.push(new Bobber(this.fishing.wx, this.fishing.wy));
      game.sfx && game.sfx.swing();
      return;
    }
    if (this.fishing.state === "biting") {
      const caught = game.catchFish(this.fishing.tx, this.fishing.ty);
      game.floatText(this.cx, this.y - 10, `Caught a ${ITEMS[caught].name}!`, "#57bd5c");
      game.sfx && game.sfx.powerup();
      this.fishing = null;
      return;
    }
    game.floatText(this.cx, this.y - 10, "Reeled in.", "#8fb573");
    this.fishing = null;
  }

  startSwing(dur) {
    if (this.swing <= 0) { this.swingDur = Math.max(0.16, dur); this.swing = 1; }
  }

  /* Rope check spans the player's hitbox (not just the center tile, like
     inLiquid) so brushing a rope edge mid-fall is enough to grab it. */
  onRope(world) {
    const tx0 = Math.floor(this.x / TILE), tx1 = Math.floor((this.x + this.w) / TILE);
    const ty0 = Math.floor(this.y / TILE), ty1 = Math.floor((this.y + this.h) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (world.inBounds(tx, ty) && world.get(tx, ty) === T.ROPE) return true;
      }
    }
    return false;
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
    game.triggerHitPause && game.triggerHitPause(0.04);
    game.triggerShake && game.triggerShake(3 + Math.min(4, final / 6), 0.15);
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
    this.hunger = this.maxHunger;
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
      } else if (this.anim === "mine" || this.anim === "attack") {
        /* play through the swing once, synced to swing progress (1..0) */
        const prog = clamp(1 - this.swing, 0, 0.999);
        fi = Math.floor(prog * a.frames);
      } else {
        fi = Math.floor(this.animTime * a.fps) % a.frames;
      }
      const b = this.rigBox;
      const scale = BODY_H / b.h;
      const dw = b.w * scale, dh = BODY_H;
      ctx.save();
      ctx.translate(feetX, feetY);
      if (this.dir < 0) ctx.scale(-1, 1);
      /* hit-flash always wins (brief + needs to read clearly); otherwise a
         purchased cosmetic skin, same exclusive-priority pattern the boss
         classes already use for their own tint/enrage filters */
      const skinDef = game.flags.skin && SKINS[game.flags.skin];
      if (this.hitFlash > 0) ctx.filter = "brightness(1.9) saturate(0.4)";
      else if (skinDef) ctx.filter = skinDef.tint;
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

    /* held item swing — the mine/attack body animation already shows the
       tool in hand, so only overlay the rotating icon when that rig is
       unavailable (fallback silhouette) or the anim didn't get picked up. */
    const sel = game.inventory.selected;
    const bodyShowsSwing = a && this.rigBox && (this.anim === "mine" || this.anim === "attack");
    if (sel && this.swing > 0 && !bodyShowsSwing) {
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

    if (this.grapple) {
      ctx.strokeStyle = "#c9302c"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(feetX, this.y + 10); ctx.lineTo(this.grapple.x, this.grapple.y); ctx.stroke();
      ctx.fillStyle = "#565a63";
      ctx.beginPath(); ctx.arc(this.grapple.x, this.grapple.y, 3, 0, 7); ctx.fill();
    }
  }
}
