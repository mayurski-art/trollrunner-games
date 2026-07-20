/* Troll High — interactable object registry.
   Phase 0 carries a starter set; Phase 2 moves interaction copy out to
   data/memories.json so content grows without code. Sizes are in tiles;
   footRows is the solid band at the bottom of the sprite (the rest is
   walk-behind). */

import { TILE, loadImage } from "./util.js";

export const OBJECT_DEFS = {
  lockers: {
    sprite: "lockers", w: 4, h: 3, footRows: 1,
    memory: {
      title: "The lockers",
      text: "Locker 213 still smells like somebody's forgotten gym clothes. The combination was your best friend's birthday.",
    },
  },
  "student-desk": {
    sprite: "student-desk", w: 2, h: 2, footRows: 1,
    memory: {
      title: "That desk",
      text: "Someone carved a trollface into the corner with a mechanical pencil. It's older than you are.",
    },
  },
  "teacher-desk": {
    sprite: "teacher-desk", w: 3, h: 2, footRows: 1,
    memory: {
      title: "The teacher's desk",
      text: "A red apple, forty ungraded quizzes, and a mug that says WORLD'S OKAYEST TEACHER.",
    },
  },
  chalkboard: {
    sprite: "chalkboard", w: 4, h: 2, footRows: 1,
    memory: {
      title: "The chalkboard",
      text: "\"QUIZ FRIDAY — NO EXCUSES\" has been up there since September. Nobody has the heart to erase the doodle next to it.",
    },
  },
  "tv-cart": {
    sprite: "tv-cart", w: 2, h: 3, footRows: 1,
    memory: {
      title: "The TV cart",
      text: "The door opens. The TV cart rolls in. No work today. The greatest sound a classroom door ever made.",
    },
  },
  fountain: {
    sprite: "fountain", w: 2, h: 2, footRows: 1,
    memory: {
      title: "Water fountain",
      text: "Lukewarm, slightly metallic, pressed all the way down with your thumb. An icon.",
    },
  },
  "trash-can": {
    sprite: "trash-can", w: 1, h: 2, footRows: 1,
    memory: {
      title: "The trash can",
      text: "Kobe. (You missed.)",
    },
  },
  door: {
    sprite: "door", w: 2, h: 3, footRows: 0, walkable: true,
    memory: null, // doors teleport instead (zone JSON "to")
  },
  "filing-cabinet": {
    sprite: "filing-cabinet", w: 2, h: 3, footRows: 1,
    memory: {
      title: "The filing cabinet",
      text: "Drawer three is labeled \"MISC\" and contains every permission slip since 1998. Nobody has ever opened it on purpose.",
    },
  },
  "reception-counter": {
    sprite: "reception-counter", w: 4, h: 2, footRows: 1,
    memory: {
      title: "The front desk",
      text: "A little silver bell that says PLEASE RING FOR SERVICE. You always want to ring it twice, and you never do.",
    },
  },
  "computer-desk": {
    sprite: "computer-desk", w: 2, h: 2, footRows: 1,
    memory: {
      title: "Computer 7",
      text: "The mouse ball needs cleaning again. Someone's Neopet is definitely starving in a tab behind the typing program.",
    },
  },
  "reading-corner": {
    sprite: "reading-corner", w: 3, h: 2, footRows: 1,
    memory: {
      title: "The reading corner",
      text: "Two bean bags, one slightly deflated. Whoever calls it first during free reading wins the whole period.",
    },
  },
  bookshelf: {
    sprite: "bookshelf", w: 3, h: 2, footRows: 1,
    memory: {
      title: "The bookshelf",
      text: "The choose-your-own-adventure section is missing page 47 in every copy. Someone did that on purpose.",
    },
  },
  "lunch-table": {
    sprite: "lunch-table", w: 4, h: 2, footRows: 1,
    memory: {
      title: "Lunch table",
      text: "Someone's initials are carved into the corner next to a very confident, very wrong math equation.",
    },
  },
  "sink-counter": {
    sprite: "sink-counter", w: 4, h: 2, footRows: 1,
    memory: {
      title: "The sink",
      text: "The soap smells like pink and nothing else. The mirror has a crack shaped like Ohio.",
    },
  },
  "fish-tank": {
    sprite: "fish-tank", w: 2, h: 3, footRows: 1,
    memory: {
      title: "The class fish",
      text: "Gerald the fish has survived four substitute teachers and one very close call with the radiator.",
    },
  },
};

const FALLBACK_COLORS = {
  lockers: "#27408b", "student-desk": "#a97a4a", "teacher-desk": "#7a5230",
  chalkboard: "#2e5d43", "tv-cart": "#555b66", fountain: "#8fa6b8",
  "trash-can": "#6b7078", door: "#8a5a2b", "filing-cabinet": "#4b4f57",
  "reception-counter": "#7a5230", "computer-desk": "#5c6570",
  "reading-corner": "#a13a3a", bookshelf: "#7a5230", "lunch-table": "#828a92",
  "sink-counter": "#9fb2c2", "fish-tank": "#3d7fa3",
};

export class ObjectSprites {
  constructor() { this.images = {}; }

  async load(base) {
    await Promise.all(
      Object.values(OBJECT_DEFS).map(async def => {
        this.images[def.sprite] = await loadImage(`${base}/${def.sprite}.png`);
      })
    );
    return this;
  }

  /* Draws with the sprite's bottom edge on the object's baseline. */
  draw(ctx, obj, def) {
    const img = this.images[def.sprite];
    const px = obj.x * TILE, py = obj.y * TILE;
    const wpx = def.w * TILE, hpx = def.h * TILE;
    if (img) {
      ctx.drawImage(img, px, py, wpx, hpx);
    } else {
      ctx.fillStyle = FALLBACK_COLORS[def.sprite] || "#888";
      ctx.fillRect(px + 1, py + 1, wpx - 2, hpx - 2);
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.strokeRect(px + 1.5, py + 1.5, wpx - 3, hpx - 3);
    }
  }
}
