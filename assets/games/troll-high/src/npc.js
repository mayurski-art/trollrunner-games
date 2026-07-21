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
  /* Real School Events (design doc §23 Phase 4) — on a day one of this
     NPC's eventLines applies, cycle through that set instead of the
     normal dialogue, same index/modulo mechanics either way. Falls
     straight back to normal dialogue on an ordinary day or for NPCs
     that don't react to that particular event. */
  speak(eventId) {
    const lines = (eventId && this.def.eventLines && this.def.eventLines[eventId]) || this.def.dialogue;
    const text = lines[this.dialogueIndex % lines.length];
    this.dialogueIndex++;
    return text;
  }

  distanceTo(px, py) {
    return Math.hypot(px - this.x, py - this.y);
  }

  /* A gold name tag + "NPC" suffix, same font/outline technique as
     Ghost's real-player name tag (ghost.js) but visually distinct — so
     while walking around, a floating name is unambiguous at a glance:
     white = a real player, gold + "NPC" = scripted. */
  entity() {
    return {
      y: this.y,
      draw: ctx => {
        this.sprites.draw(ctx, this.dir, this.moving, this.animT, this.x, this.y);
        const label = `${this.name} · NPC`;
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillText(label, this.x + 0.5, this.y - 30.5);
        ctx.fillStyle = "#ffd23f";
        ctx.fillText(label, this.x, this.y - 31);
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
    firstLine: "New face. Sit anywhere that isn't Marcus's usual spot.",
    familiarLine: "You again. I like that. Sit down.",
    dialogue: [
      "Quiz Friday. No excuses.",
      "Have you seen my red pen? I swear it grows legs.",
      "Homework's due whether you believe in it or not.",
    ],
  }],
  "classroom-3c": [{
    id: "mr-fenwick", name: "Mr. Fenwick", sprite: "npc-teacher-2",
    type: "stationary", x: 17, y: 5, facing: "west",
    firstLine: "Oh, a new one. Come meet Gerald.",
    familiarLine: "Gerald remembers you. Probably.",
    dialogue: [
      "Gerald the fish is doing great, thanks for asking.",
      "Nobody's fed the fish today. Someone's feeding the fish today.",
      "This class has the best fish tank in the whole school. Fact.",
    ],
  }],
  "classroom-3d": [{
    id: "mrs-petrova", name: "Mrs. Petrova", sprite: "npc-teacher-3",
    type: "stationary", x: 14, y: 9, facing: "south",
    firstLine: "Welcome. The bean bags are first-come, first-served, by the way.",
    familiarLine: "Back for the bean bags, I bet.",
    // "Living MMO" unscripted moments (§21/§23) — the hamster escaped
    // into HER room's bean bags, so she gets the reaction line.
    eventLines: {
      "lost-hamster": [
        "If you find that hamster before I do, I did not see anything. Good luck.",
        "Someone's checking the bean bags every five minutes today. Wonder why.",
      ],
    },
    dialogue: [
      "Free reading time is sacred. Guard it with your life.",
      "The bean bags are first-come, first-served. Rules are rules.",
      "I love this job. Don't tell the principal I said that.",
    ],
  }],
  "computer-lab": [{
    id: "eldon-tusk", name: "Eldon Tusk", sprite: "npc-eldon",
    type: "stationary", x: 18, y: 9, facing: "west",
    firstLine: "New investor? No? Fine, just a kid then.",
    familiarLine: "You're back. Good. I need a test subject anyway.",
    dialogue: [
      "I'm building a rocket in my garage. It's going great, probably.",
      "This computer runs my crypto side project. Don't tell the teacher.",
      "I'd buy this school if my allowance came through faster.",
    ],
  }],
  cafeteria: [{
    id: "lunch-lady-doris", name: "Lunch Lady Doris", sprite: "npc-doris",
    type: "stationary", x: 9, y: 3, facing: "south",
    // kitchen's only open around lunch — cafeteria reads as empty otherwise.
    activePeriods: ["Period 4", "Lunch", "Period 5"],
    firstLine: "First time through the line? Take the good tray, not the bent one.",
    familiarLine: "The usual, sweetie?",
    // Real School Events (design doc §23 Phase 4) — Pizza Friday already
    // swaps the actual cafeteria special (see PIZZA_FRIDAY_SPECIAL in
    // main.js); this is the dialogue half of the same real happening.
    eventLines: {
      "pizza-friday": [
        "It's Pizza Friday, sweetie. The good pizza, not the Tuesday pizza.",
        "I make extra on Fridays. People notice when I don't.",
        "Chocolate milk AND pizza today. Don't tell the other lunch ladies I let you have both.",
      ],
      // "Living MMO" unscripted moments (§21/§23) — the food fight
      // happens on her turf.
      "food-fight": [
        "I saw who started it. I'm not saying. I'm also not that upset about it.",
        "Cleanup's on you kids today, sweetie. All of you.",
      ],
    },
    dialogue: [
      "Pizza Friday is this Friday. It's also every Friday. You're welcome.",
      "One scoop each. I see you eyeing a second scoop.",
      "Chocolate milk's in the back cooler, sweetie.",
    ],
  }, {
    // Janitor Gus's after-hours spot — same person, different room, tracked
    // under the same id so relationship/dialogue progress carries over.
    id: "janitor-gus", name: "Janitor Gus", sprite: "npc-gus",
    // open aisle between the two blocks of lunch tables — clear of furniture.
    type: "stationary", x: 10, y: 10, facing: "south",
    activePeriods: ["After school", "Evening", "Night"],
    firstLine: "Haven't seen you before. Watch where you step, mop's still wet.",
    secondLine: "Back again already? Most kids don't come find me twice.",
    familiarLine: "Back again, huh? You're alright, kid.",
    closeLine: "You know what, kid — you're basically staff at this point.",
    memoryLines: [
      { id: "tunnels", condition: c => c.visitedZones.has("tunnels"),
        line: "You actually went down in the tunnels, huh? Told you not to. Knew you would anyway." },
      { id: "caves", condition: c => c.visitedZones.has("caves"),
        line: "Caves too? Kid, at some point you're gonna find something you can't un-find." },
      { id: "club", condition: c => c.clubMember,
        line: "Heard you're in that club now. Don't ask me what it's about. I already know." },
    ],
    returningLine: "Haven't seen you in a few days. Floors missed you. I didn't say that.",
    dialogue: [
      "Trays don't stack themselves after last lunch. Well — actually.",
      "Quietest the building ever gets is right about now.",
      "Kid, you don't want to know what's down in the tunnels.",
      "Even I don't know where that third door under the school goes. And I've got a key for everything.",
    ],
  }],
  library: [{
    id: "ms-quietly", name: "Ms. Quietly", sprite: "npc-quietly",
    type: "stationary", x: 5, y: 5, facing: "north",
    // gone home outside school hours (design doc "make it feel alive"
    // Phase 1) — the library should read as quiet/empty at night.
    activePeriods: ["Homeroom", "Period 1", "Period 2", "Period 3", "Period 4", "Lunch", "Period 5", "Period 6", "After school"],
    firstLine: "New here? Then you especially need to be quiet.",
    secondLine: "You're back. Good. Quietly, though.",
    familiarLine: "You're becoming a regular. Quietly, of course.",
    closeLine: "You've basically got a reserved seat in here now. Quietly earned.",
    memoryLines: [
      { id: "cards", condition: c => c.cardsCollected >= 5,
        line: "I hear you've been collecting cards. Very on-brand for someone who's always in my library. Quietly noted." },
    ],
    returningLine: "Been a few days. The books missed you. I did not say that out loud.",
    eventLines: {
      "book-fair": [
        "The book fair's set up in the corner. Browsing is allowed. Enthusiasm is allowed. Volume is not.",
        "Careful with the fair copies — those aren't library property, they're for sale. Quietly consider your budget.",
        "Best week of my year, if I'm honest. Don't tell anyone I said that either.",
      ],
    },
    dialogue: [
      "SHHHH.",
      "This is a library. Act like it.",
      "The book fair's coming. I can already tell you're excited. Quietly.",
    ],
  }],
  "hallway-a": [{
    id: "janitor-gus", name: "Janitor Gus", sprite: "npc-gus",
    type: "patrol", a: { x: 22, y: 8 }, b: { x: 45, y: 8 },
    // mops the cafeteria after hours instead — see the second entry below.
    activePeriods: ["Homeroom", "Period 1", "Period 2", "Period 3", "Period 4", "Lunch", "Period 5", "Period 6"],
    firstLine: "Haven't seen you before. Watch where you step, mop's still wet.",
    secondLine: "Back again already? Most kids don't come find me twice.",
    familiarLine: "Back again, huh? You're alright, kid.",
    closeLine: "You know what, kid — you're basically staff at this point.",
    // "deepen relationships" (design doc §23) — one-time callbacks tied to
    // real shared history, not just interaction count.
    memoryLines: [
      { id: "tunnels", condition: c => c.visitedZones.has("tunnels"),
        line: "You actually went down in the tunnels, huh? Told you not to. Knew you would anyway." },
      { id: "caves", condition: c => c.visitedZones.has("caves"),
        line: "Caves too? Kid, at some point you're gonna find something you can't un-find." },
      { id: "club", condition: c => c.clubMember,
        line: "Heard you're in that club now. Don't ask me what it's about. I already know." },
    ],
    returningLine: "Haven't seen you in a few days. Floors missed you. I didn't say that.",
    dialogue: [
      "These floors don't mop themselves. Well — actually.",
      "I've got a key for every door in this building. Every one.",
      "Kid, you don't want to know what's down in the tunnels.",
      "Even I don't know where that third door under the school goes. And I've got a key for everything.",
    ],
  }],
  // 5 new peer/kid NPCs (design doc §21) — the original 8 were all staff;
  // these round out actual "friend" characters. Pep was named in the
  // original cast list (§9) but never actually built until now.
  "bus-loop": [{
    id: "pep", name: "Pep", sprite: "npc-pep",
    type: "stationary", x: 10, y: 9, facing: "south",
    // only actually waiting for the bus after school lets out.
    activePeriods: ["After school"],
    firstLine: "Oh hey, new face. Feels good, man.",
    secondLine: "Oh, hey, you came back. Feels good, man. For real this time.",
    familiarLine: "Hey, it's you again. Feels good, man.",
    closeLine: "You're basically part of the bike rack crew now. Feels good, man.",
    memoryLines: [
      { id: "club", condition: c => c.clubMember,
        line: "Heard you joined a club. Feels good, man. Very on-brand for you, honestly." },
      { id: "traded", condition: c => c.tradesCompleted >= 1,
        line: "You've been trading cards with people. Feels good, man. Very ecosystem of you." },
    ],
    returningLine: "Whoa, been a minute. Buses kept running without you. Feels weird, man.",
    eventLines: {
      "spirit-week": [
        "Spirit Week, man. I'm not wearing the colors but I'm feeling the colors. That's participation.",
        "Bus driver's got spirit ribbons on the mirror. Whole vibe shifted this week.",
      ],
      dance: [
        "Bus after the dance is a whole different energy, man. Everyone's still buzzing.",
        "I'm not going in, I just like watching people show up dressed different than usual. Feels good, man.",
      ],
    },
    dialogue: [
      "Bus is always five minutes early or ten minutes late. Never on time. Kind of beautiful, honestly.",
      "You ever just stand here and watch the buses turn around? No? Just me?",
      "Feels good, man.",
    ],
  }],
  gym: [{
    id: "marcus-vale", name: "Marcus Vale", sprite: "npc-marcus",
    type: "stationary", x: 12, y: 9, facing: "south",
    // court's his during P.E. and pickup games after school.
    activePeriods: ["Period 5", "After school"],
    firstLine: "New kid? I haven't raced you yet. We should fix that.",
    secondLine: "Back for round two? I like that. Most people give up after one loss.",
    familiarLine: "You're back. Ready to lose again?",
    closeLine: "Real talk — you're one of the only people who keeps showing up here. Respect.",
    memoryLines: [
      { id: "pacer", condition: c => c.highScores?.["pacer-test"] != null,
        line: "I saw your PACER score. Not bad. Not better than mine. But not bad." },
    ],
    returningLine: "Where've you been? The court got boring without someone to beat.",
    eventLines: {
      "pacer-day": [
        "Today's the real one. Official PACER Day. Don't choke.",
        "Everyone's PR is on the line today. Including mine. Especially mine.",
        "Whatever your best is — beat it today and I'll actually admit it in front of people.",
      ],
    },
    dialogue: [
      "Oh, it's you. I beat your PACER time. Just thought you should know.",
      "Rematch. Anytime. I'm serious.",
      "I'm not showing off. This is just how I dribble.",
    ],
  }],
  office: [{
    id: "principal-grimface", name: "Principal Grimface", sprite: "npc-principal",
    type: "patrol", a: { x: 9, y: 3 }, b: { x: 9, y: 7 },
    firstLine: "New student. I'll be watching. Closely.",
    familiarLine: "You again. Still watching.",
    // "Living MMO" unscripted moments (§21/§23) — he's the one who
    // actually knows if it's a drill or the real thing.
    eventLines: {
      "fire-drill": [
        "It's a drill. Probably. Walk, don't run.",
        "Every single time, someone thinks this is optional. It is not optional.",
      ],
    },
    dialogue: [
      "Shouldn't you be in class?",
      "My office door is always open. Please don't test that.",
      "I've seen the security footage. I see everything.",
    ],
  }, {
    id: "wendell", name: "Wendell", sprite: "npc-wendell",
    type: "stationary", x: 7, y: 8, facing: "north",
    firstLine: "Oh — hi. Sorry, are you lost too?",
    familiarLine: "Oh, hey, it's you! I remember you.",
    eventLines: {
      "spirit-week": [
        "I wore the wrong color today. I wear the wrong color every day of Spirit Week. It's a pattern now.",
        "Someone told me today's theme and I already forgot. Is it too late to ask again?",
      ],
      "picture-day": [
        "Picture Day. I've already sneezed twice and it's not even Period 2.",
        "Do I look okay? Don't answer that. Actually — answer that.",
      ],
    },
    dialogue: [
      "Is... is this the office? I think I'm lost. Again.",
      "I don't really know anyone here yet. It's fine. It's totally fine.",
      "Do you know where Room 5A is? I've asked like four people today.",
      "Someone told me there's a door under this school that leads to another door. I didn't ask what's past that one.",
    ],
  }],
  "art-room": [{
    id: "priya", name: "Priya", sprite: "npc-priya",
    type: "stationary", x: 8, y: 9, facing: "south",
    firstLine: "New person! Want to join my club? I still don't know what it is.",
    familiarLine: "You're back! Still thinking about that club.",
    eventLines: {
      "spirit-week": [
        "I painted my face for Spirit Week and now I can't get it off before art. Worth it.",
        "This is basically a week-long excuse for banners. I love banners.",
      ],
      dance: [
        "I made the decorations. The banner's crooked. I know. I'm choosing not to fix it.",
        "Nobody's on the dance floor yet and it's making me anxious. Go dance. Please.",
      ],
    },
    // Real multi-club system (§23 Phase 6) — Priya's whole arc was "I'm
    // starting a club, don't know what kind yet"; once the player's
    // actually founded or joined a real one, she reacts to it by name.
    memoryLines: [
      { id: "player-club", condition: c => !!c.club,
        line: c => `Wait, "${c.club.name}"? That's so much better than whatever I was going to call mine. Can I join?` },
    ],
    dialogue: [
      "I'm starting a club. I don't know what kind yet, but it's going to be great.",
      "Sign-up sheet's coming soon. Very soon. Soon-ish.",
      "Every great club starts with one person and a folding table. This is that folding table.",
    ],
  }],
  roof: [{
    id: "marnie", name: "Marnie", sprite: "npc-marnie",
    type: "stationary", x: 7, y: 9, facing: "north",
    firstLine: "Huh. Didn't expect anyone up here.",
    familiarLine: "You found your way back up here. Interesting.",
    eventLines: {
      "picture-day": [
        "Everyone's lined up by the gym in their nicest shirt. I can see the whole line from up here. Nobody can see me.",
        "I'm skipping mine. They'll just use last year's. Nobody checks.",
      ],
    },
    dialogue: [
      "You can see the whole school from up here. Some nights it looks... different.",
      "Don't ask about the tunnels. Actually — do. Just not to a teacher.",
      "I heard laughing down by the boiler room once. Nobody else heard it.",
      "There's a room past the room everyone whispers about. I don't believe it. I definitely don't believe it.",
    ],
  }],
  // The legendary NPC (design doc §9/§21 layer 4) — almost never seen,
  // graffiti and rumors first. Finding him at all requires the full
  // secrets chain (basement -> tunnels AND caves -> storm drains ->
  // this room), so reaching the underground HQ genuinely is the "event."
  "underground-hq": [{
    id: "trollface", name: "Trollface", sprite: "npc-trollface",
    type: "stationary", x: 6, y: 6, facing: "south",
    firstLine: "...you actually found it. Huh. Didn't think anyone would.",
    secondLine: "You came back down here. Remember when you found the basement door? Same feeling, isn't it.",
    familiarLine: "Back again? Not many people bother coming back down here.",
    closeLine: "You know this place better than most people who've never left it. That's saying something.",
    memoryLines: [
      { id: "club", condition: c => c.clubMember,
        line: "You signed the charter too, huh. Guess that makes it official. Welcome." },
      // §23 Phase 7 — the mystery goes one door deeper than even
      // Trollface himself will explain. Deliberately no resolution here.
      { id: "flooded-passage", condition: c => c.visitedZones.has("flooded-passage"),
        line: "You went past my room. I don't go in there. I'm not going to tell you why." },
    ],
    returningLine: "It's been a while. Down here, you kind of lose track. Good to see you again, though.",
    dialogue: [
      "Everyone hears the rumors before they ever find the room. That's kind of the point.",
      "The graffiti's not vandalism. It's a trail. You just followed it further than most.",
      "Problem?",
    ],
  }],
};
