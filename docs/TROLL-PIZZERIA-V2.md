# Papa Troll's Pizzeria v2 — "The Pie Dimension" (design doc)

Status: SHIPPED 2026-07-27 — phases 1-3 all merged to main. Stretch phase
(delivery run + Midnight Order) remains parked, unscheduled.

v1 (docs/TROLL-PIZZERIA.md) shipped a faithful Papa's-style loop with a
meme skin. It plays well but it *is* a clone. v2 has two goals:

1. **Make it unique** — mechanics no Papa's game has, built around the
   one thing our brand owns: *the customers are trolls, so they troll you.*
2. **Add a real 3D aspect** — the pizza itself becomes a live 3D object.

Everything below keeps the working v1 loop as the skeleton. Nothing is
thrown away; the four stations, tickets, scoring, save, XP, and the
weekly ladder all stay.

---

## Part 1 — Uniqueness: "the kitchen trolls back"

Papa's games are pure execution under time pressure. Our twist: the
pressure fights dirty. Three systems, layered on the existing loop:

### 1a. Troll Events (mid-shift sabotage)

Random events fire while you work (freq scales with day number; never in
the first two days). Each has a visual tell ~2s before it lands:

| Event | What happens | Tell |
|---|---|---|
| "PROBLEM?" | Trollio edits his ticket AFTER you take it (one topping swaps) | ticket rattles on the rack |
| Bin swap | Two topping bins silently trade places | bins wiggle |
| Pineapple raid | Next 3 topping drags have a 30% chance to come out pineapple | 🍍 rolls across the floor |
| Dial scramble | Oven doneness bars display upside-down for 20s | lights flicker |
| Grease quake | Build-table pizza slowly rotates while you place toppings | table creaks |
| Nana's coupon | Surprise: next serve's tip doubles (good event, keeps players honest) | sparkle at the counter |

**Counter-play — the Grin Hunt:** when an event's tell starts, a tiny
translucent trollface grin hides somewhere in the current station's
scenery. Click it before the event lands to cancel it and bank a small
score bonus. Miss it, deal with the chaos. This turns "waiting on ovens"
into vigilance gameplay — the multitasking heart of v1 gets a second
layer that is 100% troll-brand.

### 1b. Grin Combo (risk/reward scoring)

Chain station grades to feed one meter: every station scored ≥90%
("Perfect") grows a trollface grin across the bottom HUD (5 stages).
Each stage = +10% tips, up to +50%. Any station under 60% resets it.
The grin is the brand mascot literally taking over the screen — visible,
legible, and it makes "perfect play" a run-long streak rather than a
per-ticket stat. Max grin stage shows on the end-of-day screen.
(Leaderboard schema unchanged — combo feeds tips/score, no migration.)

### 1c. The Midnight Order (rare cursed ticket)

From day 7+, ~once per real-time week a final customer arrives after
close: NULLFACE. Screen dims, ticket text is corrupted and *changes when
you're not looking at it* (it re-rolls whenever the build station loses
focus). Serve it well: big score + a one-line lore fragment (ties into
NULLFACE's ARG). It's a cameo, not a dependency — a single scripted
customer with a gimmick ticket.

---

## Part 2 — The 3D aspect: options considered

Precedent: Meme Metro already ships Three.js `three@0.160` via jsdelivr
importmap, and troll-pizzeria.html's CSP already allows jsdelivr
script-src. No CSP or infra changes needed.

| Option | What | Verdict |
|---|---|---|
| A. CSS 2.5D | perspective transforms on existing DOM (tilted pizza, parallax lobby, station-swivel transitions) | Cheap polish; fold the best bits in, but it's not a real 3D "aspect" |
| **B. Pizza Cam (RECOMMENDED)** | the pizza itself is a real Three.js object at Build/Bake/Cut/Serve; rest of the game stays DOM | Big payoff, contained scope, graceful fallback possible |
| C. Full 3D kitchen | first-person Cooking-Simulator rebuild | Rejected: months, kills a working game, mobile perf risk |
| D. 3D delivery run | low-poly moped delivery mini-game between days (Meme Metro tech reuse) | Great uniqueness hook; propose as a stretch phase, not core |

### Option B in detail — the Pizza Cam

One WebGL canvas, embedded where the flat pizza div sits today. The
pizza is the only 3D thing — the HUD, tickets, bins, lobby all stay DOM.

- **Dough**: low-poly disc + raised crust rim (lathe geometry). Slowly
  idles/rotates; drag to spin it yourself.
- **Sauce/cheese**: painted on radially with an animated radial-wipe
  shader as you tap the amount buttons — you watch the ladle coverage
  grow. Half-and-half masks become actual halves of the mesh.
- **Toppings**: drag from the DOM bins; on drop we raycast the cursor
  onto the pie surface and the topping falls the last few cm with a
  bounce. Placement/evenness scoring is unchanged (same 2D coords —
  we just project them).
- **Bake**: the oven slot shows the pie through the door, browning via
  a shader tint ramp (same curve as today's CSS filter), plus heat
  shimmer. Pull it and it slides out on the peel.
- **Cut**: the money feature. The cutter is a 3D wheel; each cut cleaves
  the mesh and the slices physically separate a few degrees. Bad angles
  are *visible* as lopsided slices.
- **Serve**: box closes over the pie, spins to camera, lid stamp =
  score. This is the screenshot people share.

**Art direction (LOCKED: smooth low-poly)**: the pie and toppings are
flat-shaded, vertex-colored low-poly meshes — the classic "low poly"
look (think Monument Valley / Poly Bridge food). No textures and no new
art generations needed: every ingredient is procedural geometry with
slight per-instance jitter so pies look organic. The DOM game around
the canvas keeps its PixelLab pixel art unchanged.

**Three.js delivery**: vendored locally (`assets/vendor/three.module.js`,
r160) rather than jsdelivr — the smoke test is hermetic (blocks CDNs) and
players in CDN-blocked regions keep the 3D path. Meme Metro keeps its CDN
importmap; only this game vendors.

**Scope note**: oven-slot and shelf thumbnails stay DOM minis (they're
96px; a second WebGL context isn't worth it). One shared canvas serves
the big pie at Build and Cut/Serve.

**Fallback**: feature-detect WebGL; if absent (or `?flat=1`), the
current DOM pizza renders exactly as today. The 3D layer is additive —
v1 never breaks. Mobile: capped pixel ratio, single canvas, no shadows;
the scene is one pie + ≤40 topping meshes, well within phone budgets.

---

## Phasing (each phase merges + pushes to main when done)

1. **Pizza Cam core** — Three.js scaffold behind WebGL detect; 3D dough/
   sauce/cheese/toppings at the Build station; DOM fallback intact.
2. **3D bake + cut + serve** — oven door view, cleaving cutter, box-spin
   serve shot.
3. **Troll Events + Grin Hunt + Grin Combo** — the uniqueness layer
   (pure DOM/JS, no 3D dependency; can land even if 3D slips).
4. *(stretch)* **Midnight Order** cameo + **3D delivery run** between
   days (reuses Meme Metro street tech).

## Out of scope (unchanged from v1)

Real money, revives, $TROLL purchases, networked play, backend
leaderboard. Leaderboard schema stays `{score, tips, served}`.

## Risks

- Three.js module import is `type="module"` — game.js today is a plain
  IIFE. The 3D layer will be a separate module file (`pizza3d.js`) that
  game.js talks to through a tiny interface (`Pizza3D.setStage()`,
  `.addTopping()`, `.cut()` …), so the existing code keeps its shape.
- Raycast drag on touch needs testing on real phones (Meme Metro solved
  similar input; borrow its handlers).
- Cleaving geometry: we fake it — the pie is pre-built as 16 hidden
  wedge segments; "cutting" just separates groups. No CSG library.

## Decisions (locked 2026-07-27)

1. **3D scope** — Pizza Cam (option B). ✅
2. **Uniqueness package** — Troll Events + Grin Hunt + Grin Combo are
   in. Midnight Order (NULLFACE cameo) is OUT for now — parked with the
   stretch phase.
3. **3D art direction** — new smooth low-poly (flat-shaded, procedural,
   no new art gens).
4. **Stretch phase** — parked. Revisit delivery run + Midnight Order
   after phases 1–3 ship.
