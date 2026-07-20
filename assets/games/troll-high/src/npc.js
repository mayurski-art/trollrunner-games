/* Troll High — NPCs: BFS pathfinding, two behavior types, dialogue.
   Fully deterministic from wall-clock time (no network sync needed, same
   as the world clock): patrol NPCs ping-pong along a precomputed path at
   a fixed speed, so every client's Date.now() puts them in the same spot.
   "stationary" NPCs just stand at a fixed point with occasional idle life. */

import { TILE, dirFromVector } from "./util.js";
import { drawBubble } from "./ghost.js";

const BUBBLE_MS = 3800;

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

const PATROL_SPEED = 2; // tiles/sec — a calmer pace than the player

export class NPC {
  constructor(def, zone, sprites) {
    this.def = def;
    this.sprites = sprites;
    this.name = def.name;
    this.dialogueIndex = 0;
    this.dir = def.facing || "south";
    this.moving = false;
    this.animT = 0;
    this.bubble = null;

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
    const cycle = (path.length - 1) * 2;
    const raw = (Date.now() / 1000 * PATROL_SPEED) % cycle;
    const t = raw <= path.length - 1 ? raw : cycle - raw; // ping-pong
    const i = Math.min(Math.floor(t), path.length - 2);
    const frac = t - i;
    const a = path[i], b = path[i + 1];
    const ax = (a.x + 0.5) * TILE, ay = (a.y + 1) * TILE;
    const bx = (b.x + 0.5) * TILE, by = (b.y + 1) * TILE;
    this.x = ax + (bx - ax) * frac;
    this.y = ay + (by - ay) * frac;
    this.moving = frac > 0.02 && frac < 0.98;
    if (this.moving) { this.dir = dirFromVector(bx - ax, by - ay); this.animT += dt; }
    else this.animT = 0;
  }

  speak() {
    const lines = this.def.dialogue;
    const text = lines[this.dialogueIndex % lines.length];
    this.dialogueIndex++;
    this.bubble = { text, until: performance.now() + BUBBLE_MS };
    return text;
  }

  distanceTo(px, py) {
    return Math.hypot(px - this.x, py - this.y);
  }

  entity() {
    if (this.bubble && performance.now() > this.bubble.until) this.bubble = null;
    return {
      y: this.y,
      draw: ctx => {
        this.sprites.draw(ctx, this.dir, this.moving, this.animT, this.x, this.y);
        if (this.bubble) drawBubble(ctx, this.x, this.y, this.bubble.text);
      },
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
    type: "stationary", x: 15, y: 7, facing: "north",
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
  office: [{
    id: "principal-grimface", name: "Principal Grimface", sprite: "npc-principal",
    type: "patrol", a: { x: 9, y: 3 }, b: { x: 9, y: 7 },
    dialogue: [
      "Shouldn't you be in class?",
      "My office door is always open. Please don't test that.",
      "I've seen the security footage. I see everything.",
    ],
  }],
  "hallway-a": [{
    id: "janitor-gus", name: "Janitor Gus", sprite: "npc-gus",
    type: "patrol", a: { x: 15, y: 8 }, b: { x: 55, y: 8 },
    dialogue: [
      "These floors don't mop themselves. Well — actually.",
      "I've got a key for every door in this building. Every one.",
      "Kid, you don't want to know what's down in the tunnels.",
    ],
  }],
};
