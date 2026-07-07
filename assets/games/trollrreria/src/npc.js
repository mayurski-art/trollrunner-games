/* Trollrreria — town NPCs. Each one wears a REAL rig of their own (Doge and
   Pepe reuse the Troll Kombat fighter sheets — zero new art generations)
   instead of a hue-shifted copy of the player, which used to read as a
   mysterious second player in solo games. */

import { TILE, GRAVITY, MAX_FALL } from "./defs.js";
import { Entity } from "./entities.js";

const FIGHTERS = "assets/games/troll-kombat/fighters/";

/* rig: { dir, cell, idle:{frames,fps}, walk:{frames,fps}, portrait } */
const RIGS = {
  gladiator: {
    dir: FIGHTERS + "gladiator/anims/", cell: 136,
    idle: { frames: 8, fps: 8 }, walk: { frames: 6, fps: 11 },
    portrait: FIGHTERS + "gladiator/portrait.png",
  },
  doge: {
    dir: FIGHTERS + "doge-rig/anims/", cell: 180,
    idle: { frames: 8, fps: 9 }, walk: { frames: 6, fps: 13 },
    portrait: FIGHTERS + "doge-rig/portrait.png",
  },
  pepe: {
    dir: FIGHTERS + "pepe-rig/anims/", cell: 92,
    idle: { frames: 8, fps: 9 }, walk: { frames: 6, fps: 14 },
    portrait: FIGHTERS + "pepe-rig/anims/portrait.png",
  },
  /* No dedicated Rocket Tinkerer rig exists yet (budgeted for a future
     PixelLab pass per the expansion doc) -- tints the gladiator sheet
     cyan/silver so he doesn't read as the Guide's twin in the meantime. */
  gladiatorTinkerer: {
    dir: FIGHTERS + "gladiator/anims/", cell: 136,
    idle: { frames: 8, fps: 8 }, walk: { frames: 6, fps: 11 },
    portrait: FIGHTERS + "gladiator/portrait.png",
  },
};

export const GUIDE_TIPS = [
  "Welcome to Trollrreria. The grin is broken. The bots are thriving. This is unacceptable.",
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

export class TownNPC extends Entity {
  constructor(tx, ty, opts = {}) {
    super(tx * TILE + 2, ty * TILE - 46, 22, 46);
    this.name = opts.name || "Guide Troll";
    this.rigDef = RIGS[opts.rig || "gladiator"];
    this.tint = opts.tint || null;
    this.bodyH = opts.bodyH || 54;
    this.homeX = this.x;
    this.dir = 1;
    this.walkT = 0;
    this.idleT = 2;
    this.animTime = 0;
    this.tips = opts.tips || GUIDE_TIPS;
    this.tipIdx = Math.floor(Math.random() * this.tips.length);
    this.dead = false;
    this.marker = opts.marker || "?";
    this.loadRig();
  }

  get portrait() { return this.rigDef.portrait; }
  get portraitFilter() { return this.tint || ""; }

  loadRig() {
    this.rig = {};
    this.rigBox = null;
    for (const key of ["idle", "walk"]) {
      const img = new Image();
      img.onload = () => {
        this.rig[key] = { img, frames: this.rigDef[key].frames, fps: this.rigDef[key].fps };
        if (key === "idle") this.measureRig(img);
      };
      img.src = this.rigDef.dir + key + ".png";
    }
  }

  /* Content bbox of idle frame 0 — anchors feet + scales any cell size. */
  measureRig(img) {
    const cell = this.rigDef.cell;
    const c = document.createElement("canvas");
    c.width = cell; c.height = cell;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, cell, cell, 0, 0, cell, cell);
    const d = g.getImageData(0, 0, cell, cell).data;
    let x0 = cell, y0 = cell, x1 = 0, y1 = 0;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        if (d[(y * cell + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 > x0) this.rigBox = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
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
    if (this.tint) ctx.filter = this.tint;
    if (a && this.rigBox) {
      const cell = this.rigDef.cell;
      const fi = Math.floor(this.animTime * a.fps) % a.frames;
      const b = this.rigBox;
      const scale = this.bodyH / b.h;
      const dw = b.w * scale, dh = this.bodyH;
      ctx.translate(feetX, feetY);
      if (this.dir < 0) ctx.scale(-1, 1);
      ctx.drawImage(a.img, fi * cell + b.x, b.y, b.w, b.h, -dw / 2, -dh, dw, dh);
    } else {
      ctx.fillStyle = "#8fb573";
      ctx.fillRect(this.x, this.y + 12, this.w, this.h - 12);
      ctx.fillStyle = "#cfe0b8";
      ctx.fillRect(this.x - 2, this.y - 4, this.w + 4, 18);
    }
    ctx.restore();

    /* floating marker so players notice him: "?" chat, "$" shop, "!" quest */
    ctx.fillStyle = this.quest ? "#57e87a" : "#ffb300";
    ctx.font = "bold 10px 'DM Mono', monospace";
    ctx.fillText(this.quest ? "!" : this.shop ? "$" : this.marker,
      feetX - 2, this.y - 8 + Math.sin(this.animTime * 3) * 2);
  }
}

/* The Guide: loiters near spawn, dispenses questionable wisdom, and hands
   out the first quest. Keeps the tinted gladiator until he gets his own
   rig — the tint is fine for him; he IS a troll like the player. */
export class GuideTroll extends TownNPC {
  constructor(tx, ty) {
    super(tx, ty, {
      name: "Trollface Guide",
      rig: "gladiator",
      tint: "hue-rotate(105deg) saturate(0.8) brightness(0.96)",
    });
  }
}

/* Doge: moves into the first valid house and barters — no coins, just an
   economy of vibes. Wears the real Troll Kombat Doge rig. */
export class MerchantTroll extends TownNPC {
  constructor(tx, ty) {
    super(tx, ty, {
      name: "Doge Miner",
      rig: "doge",
      bodyH: 50,
      tips: [
        "Many dig. Much moon. Very danger.",
        "Everything's for trade. Bring materials, leave happy. Probably.",
        "Gel for brews, lenses for gold. The market has spoken.",
        "I once sold a rock to a zombie. Great customer. No complaints.",
        "Nice house. Would be a shame if someone... moved in. Oh wait, I did.",
        "The moon shards glow. So shiny. Such value. Don't eat them.",
      ],
    });
    this.shop = true;
    this.tipIdx = 0;
  }
}

/* Pepe: melancholic swamp mystic. Placed by worldgen next to his hut in
   the swamp; gives the Rare Pepe Recovery questline. */
export class PepeHermit extends TownNPC {
  constructor(tx, ty) {
    super(tx, ty, {
      name: "Pepe Hermit",
      rig: "pepe",
      bodyH: 48,
      tips: [
        "The scrolls were rare once. Then everyone screenshotted them.",
        "feels bad, man. the swamp remembers when memes were art.",
        "Three scrolls survived the screenshots. Find them. Feel good again.",
        "The phantoms out here at night? Pure FUD. Ignore the discourse.",
        "This bog? Toxic. The vibes? Also toxic. I stay anyway.",
      ],
    });
    this.tipIdx = 0;
  }
}

/* The Whale Oracle: Saylor-coded vault guardian. Camped near the desert's
   far edge, close to (but safely above) the Whale Vault below. Gives the
   Whale Key questline. */
export class WhaleOracle extends TownNPC {
  constructor(tx, ty) {
    super(tx, ty, {
      name: "Whale Oracle",
      rig: "gladiatorTinkerer",
      tint: "hue-rotate(230deg) saturate(1.3) brightness(0.95)",
      tips: [
        "Only diamond hands may enter the vault.",
        "The Rickroller guards the key. It will not let you go easily.",
        "I've held for cycles longer than you've been digging.",
        "The vault doesn't care about your feelings. Neither do I.",
      ],
    });
    this.tipIdx = 0;
  }
}

/* The Rocket Tinkerer: eccentric engineer camped out in the Rocketyard.
   Gives the Fix the Rocket questline; completing it unlocks the pad
   pair (ground + sky island) for fast travel. */
export class RocketTinkerer extends TownNPC {
  constructor(tx, ty) {
    super(tx, ty, {
      name: "Rocket Tinkerer",
      rig: "gladiatorTinkerer",
      tint: "hue-rotate(190deg) saturate(1.4) brightness(1.02)",
      tips: [
        "I built a rocket to restore the memes. It exploded. Twice. Good data.",
        "Bring me parts. I bring you the sky. Fair trade, honestly.",
        "The pad works on vibes and moon shards. Mostly vibes.",
        "Every crash is just a launch that hasn't finished yet.",
      ],
    });
    this.tipIdx = 0;
  }
}
