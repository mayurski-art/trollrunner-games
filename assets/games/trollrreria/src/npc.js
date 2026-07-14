/* Trollrreria — town NPCs. Every NPC wears a REAL rig of its own -- Doge
   and Pepe reuse the Troll Kombat fighter sheets (they're shared with that
   game), and the six town/quest NPCs below (Blacksmith, Alchemist, Tavern
   Keeper, Butcher, Whale Oracle, Rocket Tinkerer) each got a dedicated
   PixelLab rig of their own, living under this game's own npcs/ folder
   since they're Trollrreria-only (generate -> animate idle/walk -> stitch
   into a strip, same pipeline as Gladiator/Doge/Pepe) instead of a
   hue-shifted copy of the player, which used to read as a mysterious
   second player in solo games. */

import {
  TILE, GRAVITY, MAX_FALL,
  BLACKSMITH_OFFERS, ALCHEMIST_OFFERS, TAVERN_OFFERS, BUTCHER_OFFERS, CHEF_OFFERS,
} from "./defs.js";
import { Entity } from "./entities.js";
import { skyState } from "./render.js";

const FIGHTERS = "assets/games/troll-kombat/fighters/";
const NPCS = "assets/games/trollrreria/npcs/";

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
  blacksmith: {
    dir: NPCS + "blacksmith-grump/anims/", cell: 132,
    idle: { frames: 8, fps: 8 }, walk: { frames: 6, fps: 11 },
    portrait: NPCS + "blacksmith-grump/portrait.png",
  },
  alchemist: {
    dir: NPCS + "alchemist-fizzwick/anims/", cell: 132,
    idle: { frames: 8, fps: 8 }, walk: { frames: 6, fps: 11 },
    portrait: NPCS + "alchemist-fizzwick/portrait.png",
  },
  tavernKeeper: {
    dir: NPCS + "tavern-keeper-bramble/anims/", cell: 132,
    idle: { frames: 8, fps: 8 }, walk: { frames: 6, fps: 11 },
    portrait: NPCS + "tavern-keeper-bramble/portrait.png",
  },
  butcher: {
    dir: NPCS + "butcher-cleaverson/anims/", cell: 132,
    idle: { frames: 8, fps: 8 }, walk: { frames: 6, fps: 11 },
    portrait: NPCS + "butcher-cleaverson/portrait.png",
  },
  whaleOracle: {
    dir: NPCS + "whale-oracle/anims/", cell: 132,
    idle: { frames: 8, fps: 8 }, walk: { frames: 6, fps: 11 },
    portrait: NPCS + "whale-oracle/portrait.png",
  },
  rocketTinkerer: {
    dir: NPCS + "rocket-tinkerer/anims/", cell: 132,
    idle: { frames: 8, fps: 8 }, walk: { frames: 6, fps: 11 },
    portrait: NPCS + "rocket-tinkerer/portrait.png",
  },
};

/* Carved into the weathered sign near spawn (see main.js placeQuestSign) --
   onboarding hints that used to be the Guide Troll's dialogue, kept here
   now that a static signpost replaces the walking NPC. */
export const SIGN_TIPS = [
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
  "Hungry? Hunt a boar or hen, then cook the meat at a campfire. Raw works too. Regret comes free.",
];

export class TownNPC extends Entity {
  constructor(tx, ty, opts = {}) {
    super(tx * TILE + 2, ty * TILE - 46, 22, 46);
    this.name = opts.name || "Troll";
    this.rigDef = RIGS[opts.rig || "gladiator"];
    this.tint = opts.tint || null;
    this.bodyH = opts.bodyH || 54;
    this.homeX = this.x;
    /* Town NPCs living in a stamped house (see main.js buildTownHouse)
       get a hard wander fence at the interior walls instead of the
       generic 10-tile drift -- otherwise once a player opens their door
       to trade, nothing stops them wandering out into the street. Wild
       NPCs (Pepe Hermit, Whale Oracle, ...) don't get one and keep the
       old roam-and-drift-home behavior. */
    this.homeBounds = opts.homeBounds || null;
    this.dir = 1;
    this.walkT = 0;
    this.idleT = 2;
    this.animTime = 0;
    this.tips = opts.tips || [];
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

    /* Settled town NPCs stop wandering at night -- just stand in place
       rather than pace behind a shut door until morning. Wild NPCs (no
       homeBounds) are unaffected, they were never confined to begin with. */
    const settled = this.homeBounds && skyState(game.time).isNight;

    if (this.idleT > 0) {
      this.idleT -= dt;
      this.vx *= 0.8;
      if (this.idleT <= 0) {
        if (settled) {
          this.idleT = 2 + Math.random() * 2;   // re-arm idle, never start walking
        } else {
          this.walkT = 1 + Math.random() * 2.5;
          if (this.homeBounds) {
            /* hard-fenced to the building interior: pick a direction that
               can't walk them into (or through) a wall */
            if (this.x <= this.homeBounds.minX) this.dir = 1;
            else if (this.x + this.w >= this.homeBounds.maxX) this.dir = -1;
            else this.dir = Math.random() < 0.5 ? -1 : 1;
          } else {
            /* wander, but drift back toward home */
            const drift = this.x - this.homeX;
            this.dir = Math.abs(drift) > 10 * TILE ? -Math.sign(drift) : (Math.random() < 0.5 ? -1 : 1);
          }
        }
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

    /* hard fence: clamp position regardless of how it got out of bounds
       (a door left open mid-wander, physics edge cases, etc.) */
    if (this.homeBounds) {
      if (this.x < this.homeBounds.minX) { this.x = this.homeBounds.minX; this.vx = 0; this.dir = 1; }
      else if (this.x + this.w > this.homeBounds.maxX) { this.x = this.homeBounds.maxX - this.w; this.vx = 0; this.dir = -1; }
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
  constructor(tx, ty, homeBounds) {
    super(tx, ty, {
      name: "Pepe Hermit",
      rig: "pepe",
      bodyH: 48,
      homeBounds,
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
  constructor(tx, ty, homeBounds) {
    super(tx, ty, {
      name: "Whale Oracle",
      rig: "whaleOracle",
      bodyH: 52,
      homeBounds,
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

/* --------------------------------------------------------- Town shops --
   Four specialist stalls for the Trollrreria town hub. Same barter
   pattern as the Doge Merchant, just with their own wares (per-NPC
   offers, wired through TownNPC.shop + .offers -> ui.paintShop()). Each
   has its own dedicated PixelLab rig. */
export class Blacksmith extends TownNPC {
  constructor(tx, ty, homeBounds) {
    super(tx, ty, {
      name: "Blacksmith Grump",
      rig: "blacksmith",
      bodyH: 54,
      homeBounds,
      tips: [
        "Ore in, bars and blades out. That's the whole pitch.",
        "Bring copper, iron, gold. I don't ask where you dug it.",
        "A sword's only as sharp as the troll swinging it. Still, take the sword.",
        "Helmets don't stop bad decisions. They do stop rocks.",
      ],
    });
    this.shop = true;
    this.offers = BLACKSMITH_OFFERS;
    this.tipIdx = 0;
  }
}

export class Alchemist extends TownNPC {
  constructor(tx, ty, homeBounds) {
    super(tx, ty, {
      name: "Alchemist Fizzwick",
      rig: "alchemist",
      bodyH: 54,
      homeBounds,
      tips: [
        "Mushroom, gel, a little patience -- Troll Brew practically makes itself.",
        "Lenses make a fine reagent. Don't ask what they used to look at.",
        "Bulk discount for bulk mushrooms. I'm not proud, I'm efficient.",
        "Drink it fast. It gets weirder the longer it sits.",
      ],
    });
    this.shop = true;
    this.offers = ALCHEMIST_OFFERS;
    this.tipIdx = 0;
  }
}

export class TavernKeeper extends TownNPC {
  constructor(tx, ty, homeBounds) {
    super(tx, ty, {
      name: "Tavern Keeper Bramble",
      rig: "tavernKeeper",
      bodyH: 54,
      homeBounds,
      tips: [
        "Cook it here or cook it yourself -- I'm not precious about it.",
        "Berries in bulk, meals in bulk. That's the whole menu.",
        "Nothing cures a bad dig like a hot meal and a worse joke.",
        "Wood buys a hot plate. Don't ask why. House recipe.",
      ],
    });
    this.shop = true;
    this.offers = TAVERN_OFFERS;
    this.tipIdx = 0;
  }
}

export class Butcher extends TownNPC {
  constructor(tx, ty, homeBounds) {
    super(tx, ty, {
      name: "Butcher Cleaverson",
      rig: "butcher",
      bodyH: 54,
      homeBounds,
      tips: [
        "Boar, hen, whatever wandered too close. I don't discriminate.",
        "Bones and gel get you meat wholesale. Everyone wins but the boar.",
        "Cooked costs more. Cooking is a service. Respect the craft.",
        "Silver bar for ten cooked meals? Only for regulars. You're a regular now.",
      ],
    });
    this.shop = true;
    this.offers = BUTCHER_OFFERS;
    this.tipIdx = 0;
  }
}

/* The Rocket Tinkerer: eccentric engineer camped out in the Rocketyard.
   Gives the Fix the Rocket questline; completing it unlocks the pad
   pair (ground + sky island) for fast travel. */
export class RocketTinkerer extends TownNPC {
  constructor(tx, ty, homeBounds) {
    super(tx, ty, {
      name: "Rocket Tinkerer",
      rig: "rocketTinkerer",
      bodyH: 52,
      homeBounds,
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

/* Housing-gated roster: like the Merchant, these only appear once the
   player builds a qualifying house (housing.js checkHouse) -- Game's
   housing tick (main.js) works down HOUSE_ROSTER in order, one new
   arrival per house built. Reuse existing rigs with a tint (same
   mechanism as store.js cosmetic skins) instead of commissioning new
   art for NPCs that only exist to reward player building. */
export class TrollChef extends TownNPC {
  constructor(tx, ty) {
    super(tx, ty, {
      name: "Troll Chef",
      rig: "doge",
      tint: "hue-rotate(130deg) saturate(1.4)",
      bodyH: 50,
      tips: [
        "Bring me ranch goods. I'll make it worth your while.",
        "An egg a day keeps the Rug Pull Rat away. Unproven, but I believe it.",
        "Cooking is just chemistry you're allowed to eat.",
      ],
    });
    this.shop = true;
    this.offers = CHEF_OFFERS;
    this.tipIdx = 0;
  }
}

export class TrollHistorian extends TownNPC {
  constructor(tx, ty) {
    super(tx, ty, {
      name: "Troll Historian",
      rig: "pepe",
      tint: "grayscale(0.5) sepia(0.3)",
      bodyH: 48,
      tips: [
        "Before the Grin Core, there was just... a grin. No core. Simpler times.",
        "I've catalogued every meme this world has ever forgotten. Nobody asked.",
        "The Troll King wasn't always a boss. He used to just heckle from the sidelines.",
        "History is written by whoever's still standing when the raid ends.",
      ],
    });
    this.tipIdx = 0;
  }
}

/* Traveling Trader: a world-event NPC, not a stamped-house resident --
   Game.spawnTravelingTrader() (main.js) places it in the open near the
   player at dawn with a rotating slice of TRADER_POOL and despawns it at
   dusk, so `.offers` is always set by the caller rather than defaulting. */
export class TravelingTrader extends TownNPC {
  constructor(tx, ty) {
    super(tx, ty, {
      name: "Traveling Trader",
      rig: "gladiator",
      bodyH: 54,
      tips: [
        "Rare goods, fair-ish prices. Won't be here long.",
        "Picked this up three biomes over. Don't ask how.",
        "Gone by nightfall -- literally, I don't do dark.",
      ],
    });
    this.shop = true;
    this.offers = [];
    this.tipIdx = 0;
  }
}
