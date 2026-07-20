/* Troll High — NPCs: BFS pathfinding, two behavior types, dialogue.
   Fully deterministic from wall-clock time (no network sync needed, same
   as the world clock): patrol NPCs ping-pong along a precomputed path at
   a fixed speed, so every client's Date.now() puts them in the same spot.
   "stationary" NPCs just stand at a fixed point with occasional idle life. */

import { TILE, dirFromVector } from "./util.js";

/* Breadth-first search over the zone's solid grid (uniform cost, so BFS
   is exact — no heuristic needed at these room sizes). Falls back to
   [start] if no path exists rather than throwing. */
export function findPath(zone, start, end) {
  const key = (x, y) => y * zone.w + x;
  if (start.x === end.x && start.y === end.y) return [start];
  const visited = new Set([key(start.x, start.y)]);
  const prev = new Map();
  const queue = [start];
  let found = false;
  while (queue.length) {
    const cur = queue.shift();
    if (cur.x === end.x && cur.y === end.y) { found = true; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= zone.w || ny >= zone.h) continue;
      if (zone.solid[ny][nx]) continue;
      const k = key(nx, ny);
      if (visited.has(k)) continue;
      visited.add(k);
      prev.set(k, cur);
      queue.push({ x: nx, y: ny });
    }
  }
  if (!found) return [start];
  const path = [end];
  let ck = key(end.x, end.y);
  while (ck !== key(start.x, start.y)) {
    const p = prev.get(ck);
    path.push(p);
    ck = key(p.x, p.y);
  }
  return path.reverse();
}

const PATROL_SPEED = 1.2; // tiles/sec — an unhurried pace, well under the player's
const PATROL_IDLE_SEC = 6; // pause at each end of the route before turning back

export class NPC {
  constructor(def, zone, sprites) {
    this.def = def;
    this.sprites = sprites;
    this.name = def.name;
    this.dialogueIndex = 0;
    this.dir = def.facing || "south";
    this.moving = false;
    this.animT = 0;

    if (def.type === "patrol") {
      this.path = findPath(zone, def.a, def.b);
    }
  }

  /* Pure function of wall-clock time — no per-frame state needed, so a
     freshly-created NPC (e.g. after a zone reload) is instantly correct. */
  update(dt) {
    if (this.def.type === "stationary") {
      this.x = (this.def.x + 0.5) * TILE;
      this.y = (this.def.y + 1) * TILE;
      this.moving = false;
      return;
    }
    const path = this.path;
    if (path.length < 2) {
      this.x = (path[0].x + 0.5) * TILE;
      this.y = (path[0].y + 1) * TILE;
      this.moving = false;
      return;
    }
    // Cycle: walk to B, pause, walk back to A, pause — so there's always a
    // real window where the NPC is standing still and easy to approach,
    // not endlessly pacing. Still a pure function of wall-clock time.
    const travelSec = (path.length - 1) / PATROL_SPEED;
    const cycleSec = travelSec * 2 + PATROL_IDLE_SEC * 2;
    const t = (Date.now() / 1000) % cycleSec;
    let travelT, moving;
    if (t < travelSec) { travelT = t * PATROL_SPEED; moving = true; }
    else if (t < travelSec + PATROL_IDLE_SEC) { travelT = path.length - 1; moving = false; }
    else if (t < travelSec * 2 + PATROL_IDLE_SEC) { travelT = (path.length - 1) - (t - travelSec - PATROL_IDLE_SEC) * PATROL_SPEED; moving = true; }
    else { travelT = 0; moving = false; }

    const i = Math.min(Math.floor(travelT), path.length - 2);
    const frac = travelT - i;
    const a = path[i], b = path[i + 1];
    const ax = (a.x + 0.5) * TILE, ay = (a.y + 1) * TILE;
    const bx = (b.x + 0.5) * TILE, by = (b.y + 1) * TILE;
    this.x = ax + (bx - ax) * frac;
    this.y = ay + (by - ay) * frac;
    this.moving = moving;
    if (this.moving) { this.dir = dirFromVector(bx - ax, by - ay); this.animT += dt; }
    else this.animT = 0;
  }

  /* Returns the next line; the caller shows it in a reliable DOM popup
     (see main.js showDialogue) rather than a tiny in-world canvas bubble,
     which could end up clipped by the camera or hard to read depending on
     zoom and where the NPC happens to be standing. */
  speak() {
    const lines = this.def.dialogue;
    const text = lines[this.dialogueIndex % lines.length];
    this.dialogueIndex++;
    return text;
  }

  distanceTo(px, py) {
    return Math.hypot(px - this.x, py - this.y);
  }

  entity() {
    return {
      y: this.y,
      draw: ctx => this.sprites.draw(ctx, this.dir, this.moving, this.animT, this.x, this.y),
    };
  }
}

/* One NPC per named school personality (design doc §9), scoped to the
   rooms that exist as of Phase 4. Coordinates are hand-picked clear of
   each room's furniture (see docs/TROLL-HIGH.md room layouts). */
export const NPC_DEFS = {
  "classroom-3b": [{
    id: "ms-chalke", name: "Ms. Chalke", sprite: "npc-teacher-1",
    type: "stationary", x: 4, y: 3, facing: "south",
    dialogue: [
      "Quiz Friday. No excuses.",
      "Have you seen my red pen? I swear it grows legs.",
      "Homework's due whether you believe in it or not.",
    ],
  }],
  "classroom-3c": [{
    id: "mr-fenwick", name: "Mr. Fenwick", sprite: "npc-teacher-2",
    type: "stationary", x: 17, y: 5, facing: "west",
    dialogue: [
      "Gerald the fish is doing great, thanks for asking.",
      "Nobody's fed the fish today. Someone's feeding the fish today.",
      "This class has the best fish tank in the whole school. Fact.",
    ],
  }],
  "classroom-3d": [{
    id: "mrs-petrova", name: "Mrs. Petrova", sprite: "npc-teacher-3",
    type: "stationary", x: 14, y: 9, facing: "south",
    dialogue: [
      "Free reading time is sacred. Guard it with your life.",
      "The bean bags are first-come, first-served. Rules are rules.",
      "I love this job. Don't tell the principal I said that.",
    ],
  }],
  "computer-lab": [{
    id: "eldon-tusk", name: "Eldon Tusk", sprite: "npc-eldon",
    type: "stationary", x: 18, y: 9, facing: "west",
    dialogue: [
      "I'm building a rocket in my garage. It's going great, probably.",
      "This computer runs my crypto side project. Don't tell the teacher.",
      "I'd buy this school if my allowance came through faster.",
    ],
  }],
  cafeteria: [{
    id: "lunch-lady-doris", name: "Lunch Lady Doris", sprite: "npc-doris",
    type: "stationary", x: 9, y: 3, facing: "south",
    dialogue: [
      "Pizza Friday is this Friday. It's also every Friday. You're welcome.",
      "One scoop each. I see you eyeing a second scoop.",
      "Chocolate milk's in the back cooler, sweetie.",
    ],
  }],
  library: [{
    id: "ms-quietly", name: "Ms. Quietly", sprite: "npc-quietly",
    type: "stationary", x: 5, y: 5, facing: "north",
    dialogue: [
      "SHHHH.",
      "This is a library. Act like it.",
      "The book fair's coming. I can already tell you're excited. Quietly.",
    ],
  }],
  "hallway-a": [{
    id: "janitor-gus", name: "Janitor Gus", sprite: "npc-gus",
    type: "patrol", a: { x: 22, y: 8 }, b: { x: 45, y: 8 },
    dialogue: [
      "These floors don't mop themselves. Well — actually.",
      "I've got a key for every door in this building. Every one.",
      "Kid, you don't want to know what's down in the tunnels.",
    ],
  }],
  // 5 new peer/kid NPCs (design doc §21) — the original 8 were all staff;
  // these round out actual "friend" characters. Pep was named in the
  // original cast list (§9) but never actually built until now.
  "bus-loop": [{
    id: "pep", name: "Pep", sprite: "npc-pep",
    type: "stationary", x: 10, y: 9, facing: "south",
    dialogue: [
      "Bus is always five minutes early or ten minutes late. Never on time. Kind of beautiful, honestly.",
      "You ever just stand here and watch the buses turn around? No? Just me?",
      "Feels good, man.",
    ],
  }],
  gym: [{
    id: "marcus-vale", name: "Marcus Vale", sprite: "npc-marcus",
    type: "stationary", x: 12, y: 9, facing: "south",
    dialogue: [
      "Oh, it's you. I beat your PACER time. Just thought you should know.",
      "Rematch. Anytime. I'm serious.",
      "I'm not showing off. This is just how I dribble.",
    ],
  }],
  office: [{
    id: "principal-grimface", name: "Principal Grimface", sprite: "npc-principal",
    type: "patrol", a: { x: 9, y: 3 }, b: { x: 9, y: 7 },
    dialogue: [
      "Shouldn't you be in class?",
      "My office door is always open. Please don't test that.",
      "I've seen the security footage. I see everything.",
    ],
  }, {
    id: "wendell", name: "Wendell", sprite: "npc-wendell",
    type: "stationary", x: 7, y: 8, facing: "north",
    dialogue: [
      "Is... is this the office? I think I'm lost. Again.",
      "I don't really know anyone here yet. It's fine. It's totally fine.",
      "Do you know where Room 5A is? I've asked like four people today.",
    ],
  }],
  "art-room": [{
    id: "priya", name: "Priya", sprite: "npc-priya",
    type: "stationary", x: 8, y: 9, facing: "south",
    dialogue: [
      "I'm starting a club. I don't know what kind yet, but it's going to be great.",
      "Sign-up sheet's coming soon. Very soon. Soon-ish.",
      "Every great club starts with one person and a folding table. This is that folding table.",
    ],
  }],
  roof: [{
    id: "marnie", name: "Marnie", sprite: "npc-marnie",
    type: "stationary", x: 7, y: 9, facing: "north",
    dialogue: [
      "You can see the whole school from up here. Some nights it looks... different.",
      "Don't ask about the tunnels. Actually — do. Just not to a teacher.",
      "I heard laughing down by the boiler room once. Nobody else heard it.",
    ],
  }],
};
