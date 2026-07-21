/* Troll High — remote player rendering: smooths raw 10Hz network updates
   into motion, draws with the same CharacterSprites the local player uses
   (everyone's a student for now — outfit customization is later scope),
   plus a name tag and floating chat/emote bubbles above the head. */

import { lerp } from "./util.js";

const BUBBLE_MS = 3200;

/* Shared by remote ghosts and the local player's own chat/emote echo. */
export function drawBubble(ctx, x, y, text) {
  ctx.font = "9px sans-serif";
  const w = ctx.measureText(text).width + 10;
  const bx = x, by = y - 44;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.roundRect(bx - w / 2, by - 10, w, 16, 4);
  ctx.fill();
  ctx.fillStyle = "#1b1b1f";
  ctx.textAlign = "center";
  ctx.fillText(text, bx, by + 1);
}

export class Ghost {
  constructor(id, sprites) {
    this.id = id;
    this.sprites = sprites;
    this.x = null; this.y = null;   // rendered (smoothed) position
    this.targetX = 0; this.targetY = 0;
    this.dir = "south";
    this.moving = false;
    this.name = "";
    this.club = null; // real multi-club system (§23 Phase 6)
    this.running = false; // student elections (§23 Phase 6) — declared candidate?
    this.dancing = false; // dances (§23 Phase 6) — currently on the dance floor?
    this.performing = false; // talent show (§23 Phase 6) — currently on stage?
    this.project = null; // science fair (§23 Phase 6) — active project title, or null
    this.graduated = false; // graduation (§23 Phase 6 capstone) — persisted trait
    this.animT = 0;
    this.bubble = null;             // { text, until }
  }

  applyUpdate(p) {
    this.targetX = p.x; this.targetY = p.y;
    this.dir = p.dir; this.moving = p.moving; this.name = p.name || this.name;
    this.club = p.club || null;
    this.running = !!p.running;
    this.dancing = !!p.dancing;
    this.performing = !!p.performing;
    this.project = p.project || null;
    this.graduated = !!p.graduated;
    if (this.x === null) { this.x = p.x; this.y = p.y; } // snap on first sighting
  }

  say(text) { this.bubble = { text, until: performance.now() + BUBBLE_MS }; }

  update(dt) {
    if (this.x === null) return;
    // critically-damped-ish smoothing toward the last known network position
    const k = Math.min(1, dt * 10);
    this.x = lerp(this.x, this.targetX, k);
    this.y = lerp(this.y, this.targetY, k);
    if (this.moving) this.animT += dt; else this.animT = 0;
    if (this.bubble && performance.now() > this.bubble.until) this.bubble = null;
  }

  entity() {
    if (this.x === null) return null;
    return {
      y: this.y,
      draw: ctx => {
        this.sprites.draw(ctx, this.dir, this.moving, this.animT, this.x, this.y);
        // White + "Player" — the NPC equivalent (npc.js entity()) is gold
        // + "NPC", so a floating name is unambiguous at a glance.
        // 🗳/💃/🎤/🧪 suffixes flag a declared election candidate /
        // dance-floor participant / stage performer / science fair
        // presenter (§23 Phase 6) without needing a whole extra label
        // line per status; 🎓 is the one persisted trait among them —
        // it shows every session once earned, not just while toggled.
        const label = `${this.name} · Player${this.running ? " 🗳" : ""}${this.dancing ? " 💃" : ""}${this.performing ? " 🎤" : ""}${this.project ? " 🧪" : ""}${this.graduated ? " 🎓" : ""}`;
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillText(label, this.x + 0.5, this.y - 30.5);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, this.x, this.y - 31);
        // Real multi-club system (§23 Phase 6) — a second small line so
        // another player's club affiliation is visible at a glance, same
        // spirit as the name tag above it.
        if (this.club) {
          const clubLabel = `🏷 ${this.club}`;
          ctx.font = "7px monospace";
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillText(clubLabel, this.x + 0.5, this.y - 21.5);
          ctx.fillStyle = "#ffd23f";
          ctx.fillText(clubLabel, this.x, this.y - 22);
        }
        if (this.bubble) drawBubble(ctx, this.x, this.y, this.bubble.text);
      },
    };
  }
}
