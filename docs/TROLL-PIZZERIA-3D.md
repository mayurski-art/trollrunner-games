# Papa Troll's Pizzeria — full 3D version (design doc)

Status: Decisions locked 2026-07-29. Free-walk movement, replaces
troll-pizzeria.html in place, all 5 phases greenlit, new PixelLab
environment art. Sections below are updated to match.

v1-v3 (docs/TROLL-PIZZERIA*.md) built and shipped a complete DOM game:
four stations (order/build/bake/cut) as flat divs you tab between, plus
one genuine 3D object already living inside it — the Pizza Cam
(pizza3d.js), a vendored Three.js pie that mounts into whichever
station's canvas slot needs it. Everything else (lobby, oven, cutting
table, HUD, tickets, Troll Events, Grin Combo, Til Jar/Upgrades) is
DOM/CSS/pixel-art.

The ask: make the whole game 3D, carrying over every system already
shipped. This doc is the plan for that, before any code gets written.

---

## 1. What "3D version" means here

Not a rebuild from scratch, and not a from-nothing new engine. The pie
is already real Three.js. The move is to **stop mounting/unmounting a
small 3D canvas per station** and instead have **one persistent 3D
kitchen scene** you walk around in — order counter, build table, oven,
cutting table are four physical locations in the *same* room, not four
separate DOM sections. **Locked: free first-person movement**, Troll-
Burger/Trollrreria-3D-style (WASD + mouse-look on desktop, virtual
joystick + drag-look on mobile), not a fixed camera hop.

That means the station-tab click goes away as the primary navigation —
you walk to a station instead. But the fiddly precision work (painting
sauce, placing toppings, sweeping the cutter) still needs the same
stable, predictable camera-to-table relationship it has today, so:
**walking up to a station and interacting locks the camera into a
close working view over that table** (same fixed angle the raycasting/
paint code already assumes), and stepping back or finishing the action
returns you to free-walk. This is a hybrid — walk freely between
stations, work with a locked camera at each one — not a full "aim your
mouse to paint sauce" simulator. It keeps the moment-to-moment build/
bake/cut precision exactly as good as it is today while adding real
traversal between stations.

The DOM layer doesn't go away — HUD, tickets, buttons, bins, the
Upgrades shop, all overlays — stays exactly as it is today, positioned
on top of the 3D canvas the way it already sits on top of the Pizza
Cam's canvas at the Build/Cut stations. Those are menus and readouts,
not gameplay geometry; 3D-ing them buys nothing and risks a lot
(accessibility, mobile input, aria-labels all already work today).

**What actually goes 3D that isn't already:**
- The lobby: customers become PixelLab billboard sprites (flat
  textured planes that face the camera — the same cheap technique
  proven in Meme Metro/Trollrreria-3D) standing/walking in a real 3D
  room, instead of a flat CSS scene.
- The oven: a real 3D oven mesh with a rack of slots, each showing an
  actual low-poly pie (reusing the Pizza Cam's pie-building code,
  extended to render several pies at once at different bake stages)
  instead of 96px DOM thumbnails.
- The build table and cutting table: literally today's Pizza Cam pie,
  but now it's sitting on a real 3D counter/table in the room the
  camera is looking at, instead of centered alone in its own canvas.
- Troll Events' hidden Grin Hunt icon: hides somewhere in actual 3D
  space (on a shelf, behind the oven, on a customer) instead of a
  random CSS percentage position — this is strictly more interesting
  in 3D and costs nothing extra to build once the room exists.

**What stays exactly as-is (no reason to touch):**
scoring, save format, Til Jar/Upgrades data and shop UI, ticket
generation, Grin Combo math, troll-event effects, day/shift flow,
leaderboard. This is a rendering-layer project, not an economy or
systems rewrite.

## 2. Technical foundation

- **Reuse the vendored Three.js pattern.** pizza3d.js already vendors
  `assets/vendor/three.module.min.js` (no CDN — the smoke test blocks
  external requests and the 3D layer still has to work). The 3D
  kitchen module follows the same import and the same
  `window.TrollPizzaKitchen3D`-style boundary: game.js stays a plain
  script talking to one small interface (`mount`, `goToStation(name)`,
  `sync(state)`, `unmount`), never touching THREE directly. Coordinates
  crossing the boundary stay the game's own 0..1 pie/scoring coords —
  the 3D layer never becomes a source of truth for anything scored.
- **pizza3d.js becomes a sub-module of the kitchen scene**, not a
  parallel canvas. Its pie-building functions (dough/sauce/cheese/
  topping/cut-wedge geometry) get reused as-is; what changes is *where*
  the pie root gets parented (into the persistent kitchen scene's
  build-table anchor or oven-slot anchor, instead of its own mounted
  canvas) and that multiple pies can exist at once (oven rack).
- **Player controller**: reuse the shape of Trollrreria-3D's
  `Player.js` (yaw/pitch look, velocity-based movement, axis-separated
  collision resolve) but swap its voxel-grid `aabbHitsSolid` for a
  handful of static AABBs (counter, oven housing, cutting table, walls)
  — a fixed small room needs box-vs-box collision, not a voxel query.
  No gravity/jump needed (flat kitchen floor), so the controller is
  simpler than the voxel game's: just planar movement + collision.
- **Station interaction zones**: each station has a trigger volume; in
  range, an "Interact" prompt appears (same idea as Trollrreria-3D's
  look-and-interact, simplified from its voxel raycast to a plain
  distance/facing check against a few known station anchors — no DDA
  needed for four fixed objects). Interacting tweens the camera to that
  station's locked working angle and hands off to the same DOM/raycast
  code that runs the station today; stepping back (a "done"/"step
  away" control, or auto-return when a ticket's fully handled at that
  station) tweens the camera back out to free-look/free-walk.
- **Input model unchanged**: today's raycasting for topping placement
  and sauce/cheese painting (pizza3d.js already raycasts screen→pie
  surface) extends naturally — the pie's world position just isn't
  always at the canvas center anymore, which raycasting already
  handles since it works in camera/world space, not screen-center
  assumptions.
- **Flat/no-WebGL fallback stays the existing 2D game, unchanged.**
  `?flat=1` and WebGL-detection-fails today fall back to the DOM pizza
  at Build/Cut. In the 3D version, the equivalent fallback is: **the
  entire existing v1-v3 DOM game, verbatim** (station divs, CSS lobby,
  DOM oven grid). This avoids building and maintaining a second
  "flat 3D-lite" fallback path — there's already a complete, working,
  accessible fallback sitting in git history/the current file, so the
  fallback is "don't 3D-ify," not "build a simpler 3D."

## 3. World & art direction

- **The pie stays smooth low-poly, unchanged** — that look was
  deliberately locked in v2 as a contrast highlight (the "money shot"
  object reads as premium against the rest of the game's pixel art) and
  nothing here touches it.
- **Locked: new PixelLab-generated art for the kitchen environment.**
  Rather than modeling the counter/oven housing/cutting table/shelves/
  walls as bare flat-shaded primitives, PixelLab generates pixel-art
  textures for them (in the same style as the game's existing sprites/
  topping icons), applied to simple box/plane geometry — a textured box
  for the counter front, a textured plane for walls/floor, etc. This is
  the same "2D art on simple 3D shapes" technique already proven for
  customers-as-billboards, just extended to furniture, and it keeps the
  whole room visually consistent with the rest of the arcade (pixel art
  world, one smooth-low-poly hero object at its center) instead of
  introducing a third visual language.
- **Customers stay PixelLab pixel art on camera-facing billboards**
  (unchanged from the original plan) — re-modeling 8 characters as 3D
  would be a large new cost for a style mismatch; billboards are the
  proven, cheap, correct choice here (see Trollrreria-3D, Meme Metro).
- **One continuous room**, four zones: order counter (lobby behind it),
  build table, oven wall, cutting table. Small enough to stay a single
  scene graph with modest draw calls (this is a kitchen, not an open
  world — Trollrreria-3D's chunked voxel terrain doesn't apply here).

## 4. Systems mapping (every v1-v3 feature, carried over)

| System | 2D today | 3D version |
|---|---|---|
| Lobby queue + patience bars | CSS row of customer cards | Billboard sprites queued near the order counter; patience bars as screen-projected DOM labels anchored to each sprite's world position (no new mechanic — same projection math the Grin Hunt icon already needs) |
| Getting from station to station | Tab click, instant | Walk there (free-move + collision); entering a station's trigger zone shows "Interact," which locks the camera to the working angle |
| Build: sauce/cheese paint | Raycast onto Pizza Cam pie | Unchanged — same raycast, pie now sits on a 3D table |
| Build: toppings drag/place | Raycast onto pie | Unchanged |
| Bake: oven slots + doneness | DOM grid, mini pie thumbnails | Real 3D oven rack; each slot shows an actual pie object baking (reuses Pizza Cam bake-tint shader) |
| Breadsticks sharing a slot | Second doneness bar in DOM slot | Second small 3D object baking alongside the pie in the same slot |
| Kitchen fire | Cosmetic force-pull | Same trigger/logic; visual is a real smoke particle + light flicker in 3D instead of a CSS class |
| Cut: sweeping cutter + cleave | Pizza Cam wheel + wedge split | Unchanged — already 3D, just relocated into the shared scene |
| Serve: box-close + spin | Pizza Cam serve spin | Unchanged |
| Grin Combo meter | HUD chip | Unchanged (DOM HUD) |
| Troll Events + Grin Hunt | Hidden CSS-positioned grin | Hidden object in real 3D space — same click-to-cancel logic |
| Rush hour | Lobby cap raised, banner | More billboard customers in the room; same banner |
| Specialty tickets / sides | Ticket text + DOM side button | Unchanged (DOM ticket + soda/breadsticks mechanic) |
| Til Jar + Upgrades shop | Title-screen DOM overlay | Unchanged — a menu, not a gameplay space |
| Save/score/leaderboard | localStorage + Supabase | Untouched |

The table is the point: **almost nothing about how the game scores,
saves, or teaches you to play changes.** The delta is concentrated in
rendering the room and relocating the pie into it.

## 5. Phasing (each phase merges + pushes to main when done)

1. **Kitchen scaffold + player movement** — persistent Three.js scene
   with placeholder-textured room geometry, the player controller
   (WASD/joystick + mouse/drag-look, box collision against the 4
   station volumes + walls), and station trigger zones showing an
   "Interact" prompt. No gameplay hookup yet — this phase is walk-
   around-the-empty-room feel, tuned so any station is ~1-2s of
   walking from any other (small kitchen, frantic pace preserved).
2. **Build + Bake in the shared scene** — pie relocated onto the 3D
   build table, working-camera lock-in on interact verified against
   the existing raycast/paint/topping-place code; oven rack modeled
   with real per-slot pies baking (breadsticks sharing a slot, kitchen
   fire visual).
3. **Order/lobby + Cut/Serve in the shared scene** — billboard customer
   queue with projected patience-bar labels, cutting table + serve
   box-spin relocated in; first point the whole loop plays start-to-
   finish while walking a continuous room.
4. **Troll Events in 3D + polish/perf pass** — Grin Hunt hides in real
   3D space, rush hour crowds the room, mobile perf pass (draw calls,
   pixel ratio cap, billboard/texture memory), fallback parity check
   (flat/no-WebGL still boots the untouched 2D game).
5. **Kitchen environment art pass** — PixelLab-generated textures for
   counter/oven housing/cutting table/shelves/walls/floor replace the
   placeholder textures from phase 1, matched to the game's existing
   pixel-art style; lighting/atmosphere polish now that the final art
   is in.

Each phase is independently shippable and the flat fallback means the
game is never broken mid-migration — worst case, players without WebGL
(or before a phase lands) just keep playing the 2D version they have
today.

## 6. Risks

- **Permanent WebGL context** (scene mounted for the whole session, not
  per-station) costs more GPU/battery than today's mount-on-station-
  entry Pizza Cam. Mitigate with capped pixel ratio, frustum culling
  (small scene, likely moot), and pausing the render loop when the tab/
  game is backgrounded.
- **Raycasting across a bigger scene** — today's pie-surface raycast
  assumes the pie is the only interactive object in view; the 3D
  kitchen adds furniture geometry that must be excluded from hit-tests
  (tag the pie/topping-bin meshes, raycast only against that layer).
- **Two fallback paths to keep honest** (2D DOM game + 3D kitchen) —
  mitigated by making the fallback *the actual existing game*, not a
  parallel simplified 3D-lite build, so there's no second thing to
  maintain in lockstep.
- **Mobile input** — dragging to paint/place toppings from an angled
  camera (not straight-down) needs the same real-device testing Pizza
  Cam already required for its raycast drag; budget time for it.
- **Pace**: walking between stations must not slow the core loop down
  versus today's instant tab-switch, or the frantic multitasking feel
  (the whole point of the game) breaks. Mitigate by keeping the kitchen
  small (every station within ~1-2s walk of every other) and by making
  the working-camera lock-in fast to enter/exit — this is the single
  most important playtest question in phase 1, before any station
  logic is even hooked up.
- **Mobile movement controls**: a virtual joystick + drag-look adds a
  control scheme the 2D/DOM game never needed. Needs real-device
  testing the same way Pizza Cam's drag-to-paint did, budgeted into
  phase 1 rather than left to the polish pass.
- **New art budget**: environment textures (counter, oven housing,
  cutting table, shelves, walls, floor) are net-new PixelLab
  generations, not reuse — budget generation + iteration time in phase
  5, and ship phases 1-4 on placeholder textures so gameplay isn't
  blocked on art.

## 7. Out of scope

Real money/revives/$TROLL changes, networked play, backend leaderboard
schema changes, re-modeling customers as 3D characters, jumping/
vertical traversal (flat kitchen floor, no platforming), new economy or
scoring systems beyond what v1-v3 already shipped.

## Decisions (locked 2026-07-29)

1. **Movement** — free first-person walking (WASD/joystick + look),
   hybrid with a locked working camera on station interact. ✅
2. **Deployment** — replaces `troll-pizzeria.html` in place;
   `?flat=1`/no-WebGL falls back to the exact current 2D game. ✅
3. **Rollout** — all 5 phases greenlit now, building straight through. ✅
4. **Art scope** — new PixelLab-generated textures for the kitchen
   environment (phase 5), pie stays smooth low-poly unchanged. ✅
