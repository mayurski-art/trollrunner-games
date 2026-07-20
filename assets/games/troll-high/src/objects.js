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
    sprite: "tv-cart", w: 2, h: 3, footRows: 1, pushable: true, screen: true,
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
  bleachers: {
    sprite: "bleachers", w: 6, h: 3, footRows: 1,
    memory: {
      title: "The bleachers",
      text: "Third row, far left — the good seats. Somebody's initials are scratched into every plank.",
    },
  },
  "basketball-hoop": {
    sprite: "basketball-hoop", w: 2, h: 3, footRows: 1,
    memory: {
      title: "The hoop",
      text: "The net's been torn since October. It still counts if it goes in. It has never gone in.",
    },
  },
  "stage-curtain": {
    sprite: "stage-curtain", w: 4, h: 4, footRows: 1,
    memory: {
      title: "The stage curtain",
      text: "Heavy, red, and smells faintly of dust and stage fright. Someone's name is safety-pinned to the inside hem.",
    },
  },
  "auditorium-seats": {
    sprite: "auditorium-seats", w: 4, h: 2, footRows: 1,
    memory: {
      title: "Auditorium seats",
      text: "One of them squeaks if you so much as look at it. Everyone knows which one. Nobody sits in it.",
    },
  },
  easel: {
    sprite: "easel", w: 2, h: 3, footRows: 1,
    memory: {
      title: "The easel",
      text: "A half-finished painting of what might be a dog, or possibly a house. Signed, proudly, in crayon.",
    },
  },
  "art-shelf": {
    sprite: "art-shelf", w: 3, h: 2, footRows: 1,
    memory: {
      title: "Art supplies",
      text: "The good scissors are hidden behind the tempera paint. Everyone knows. Nobody tells the new kid.",
    },
  },
  "drum-set": {
    sprite: "drum-set", w: 3, h: 3, footRows: 1,
    memory: {
      title: "The drum kit",
      text: "One cymbal is cracked from a talent show incident nobody will explain to you in full.",
    },
  },
  "music-stand": {
    sprite: "music-stand", w: 2, h: 2, footRows: 1,
    memory: {
      title: "Music stand",
      text: "Sheet music for a song that's been on there so long it's basically a fossil now.",
    },
  },
  "lab-table": {
    sprite: "lab-table", w: 3, h: 2, footRows: 1,
    memory: {
      title: "The lab table",
      text: "A faint burn mark from the baking soda volcano incident. It has its own legend now.",
    },
  },
  "nurse-cot": {
    sprite: "nurse-cot", w: 2, h: 3, footRows: 1,
    memory: {
      title: "The nurse's cot",
      text: "Crinkly paper on top, a thin blanket folded at the end. Best nap spot in the building, if you can fake it right.",
    },
  },
  "first-aid-cabinet": {
    sprite: "first-aid-cabinet", w: 2, h: 3, footRows: 1,
    memory: {
      title: "First aid cabinet",
      text: "Band-Aids in every pattern a nine-year-old could ask for. The good ones are always out of stock.",
    },
  },
  "swing-set": {
    sprite: "swing-set", w: 4, h: 3, footRows: 1,
    memory: {
      title: "The swings",
      text: "Someone's trying to go all the way around. Someone is always trying to go all the way around.",
    },
  },
  slide: {
    sprite: "slide", w: 4, h: 3, footRows: 1,
    memory: {
      title: "The slide",
      text: "Scorching in direct sun, terrifying in winter. A rite of passage either way.",
    },
  },
  "goal-post": {
    sprite: "goal-post", w: 4, h: 3, footRows: 1,
    memory: {
      title: "The goal",
      text: "The net's got a hole in the top corner exactly where the good shots go. Coincidence? Nobody's sure.",
    },
  },
  "foursquare-court": {
    sprite: "foursquare-court", w: 4, h: 4, footRows: 1,
    play: "foursquare", playName: "Four Square",
    memory: {
      title: "The four square court",
      text: "Faded yellow paint, house rules only, and a king's square nobody can hold for more than two rounds.",
    },
  },
  "tetherball-pole": {
    sprite: "tetherball-pole", w: 2, h: 3, footRows: 1,
    play: "tetherball", playName: "Tetherball",
    memory: {
      title: "The tetherball pole",
      text: "The rope's been re-tied so many times it's shorter than it should be. Somebody's always winding up for a wrap-around.",
    },
  },
  "hopscotch-court": {
    sprite: "hopscotch-court", w: 3, h: 4, footRows: 1,
    play: "hopscotch", playName: "Hopscotch",
    memory: {
      title: "The hopscotch squares",
      text: "Chalk numbers 1 through 8, redrawn every week whether it rains or not.",
    },
  },
  "kickball-spot": {
    sprite: "kickball-spot", w: 3, h: 2, footRows: 1,
    play: "kickball", playName: "Kickball",
    memory: {
      title: "Home plate",
      text: "A rubber mat worn smooth in the shape of a hundred nervous first kicks.",
    },
  },
  "school-bus": {
    sprite: "school-bus", w: 4, h: 6, footRows: 1,
    memory: {
      title: "Bus 12",
      text: "The seat in the very back is sacred ground. You do not sit there unless you have been formally invited.",
    },
  },
  "bus-stop-sign": {
    sprite: "bus-stop-sign", w: 2, h: 3, footRows: 1,
    memory: {
      title: "Bus stop sign",
      text: "Someone's carved a trollface into the pole. Been there for years. Nobody's ever seen who did it.",
    },
  },
  pipes: {
    sprite: "pipes", w: 3, h: 4, footRows: 1,
    memory: {
      title: "The pipes",
      text: "They groan like something's alive in the walls. It's just the boiler. Probably.",
    },
  },
  "ac-unit": {
    sprite: "ac-unit", w: 3, h: 3, footRows: 1,
    memory: {
      title: "The AC unit",
      text: "The whole roof hums with it. From up here you can see the entire student parking lot. And the whole town, sort of.",
    },
  },
};

const FALLBACK_COLORS = {
  lockers: "#27408b", "student-desk": "#a97a4a", "teacher-desk": "#7a5230",
  chalkboard: "#2e5d43", "tv-cart": "#555b66", fountain: "#8fa6b8",
  "trash-can": "#6b7078", door: "#8a5a2b", "filing-cabinet": "#4b4f57",
  "reception-counter": "#7a5230", "computer-desk": "#5c6570",
  "reading-corner": "#a13a3a", bookshelf: "#7a5230", "lunch-table": "#828a92",
  "sink-counter": "#9fb2c2", "fish-tank": "#3d7fa3", bleachers: "#8a6a4a",
  "basketball-hoop": "#c2743a", "stage-curtain": "#8a1f2b",
  "auditorium-seats": "#7a2530", easel: "#8a6a4a", "art-shelf": "#7a5230",
  "drum-set": "#a13a3a", "music-stand": "#3a3a3a", "lab-table": "#3a3a3a",
  "nurse-cot": "#c8d4dc", "first-aid-cabinet": "#d8dce0", "swing-set": "#5a6a7a",
  slide: "#e8c22e", "goal-post": "#dfe4e8", "school-bus": "#e8b22e",
  "bus-stop-sign": "#e8c22e", pipes: "#8a3a3a", "ac-unit": "#5a5a62",
  "foursquare-court": "#c2b46a", "tetherball-pole": "#6b4a2a",
  "hopscotch-court": "#b8ac82", "kickball-spot": "#a13a3a",
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
