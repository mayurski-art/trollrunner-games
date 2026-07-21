# Troll High — design doc (v1)

**Status: APPROVED 2026-07-19 — all 4 decisions locked (§20). Building from Phase 0.**

Game 007 in the Troll Runner Arcade. A 2D multiplayer nostalgic-school MMO:
log in after school, walk the halls of Troll High, poke every object in every
room, and each one hands you back a memory from 2000–2015 — TV carts, book
fairs, dial-up sounds, rectangle pizza. Friends are the gameplay; the world is
the content.

---

## 1. Design pillars

1. **The world is the entertainment.** No quests forced on you, no grind, no
   pay-to-win. Exploration, roleplay, humor, secrets.
2. **"I haven't thought about that in years."** Every room is dense with
   interactable memory objects. Density beats size — one handcrafted hallway
   beats ten empty streets.
3. **Alive, not procedural.** NPCs run daily routines on the school clock;
   ambient audio layers; weather and seasons; something is always happening.
4. **Social first.** Chat bubbles, emotes, sitting together at lunch, trading
   stickers. Presence of other real players is the killer feature.
5. **Trollface was always here.** Seeded through graffiti, posters, secrets,
   and a slow-burn meta-arc, never oversaturated.

## 2. Scope honesty & release strategy

The full vision (school + a whole neighborhood + forest + caves + events) is
several games' worth of content. We ship it **as a living world that grows**,
the same way Trollrreria shipped in 13 mergeable phases:

- **v1 launch = Troll High School, complete.** Every school room from the
  prompt, fully interactable, multiplayer, NPCs on routines, collectibles,
  first secrets. A tight, dense, finished-feeling place.
- **Then the neighborhood arrives in waves** (streets/arcade/pizza → lake/
  forest/drains/warehouse), each wave a phase merged to main.
- **Then events** (book fair, spirit week, dances, snow day) as clock-driven
  content that makes the world feel alive across weeks.

Nothing placeholder ships: a zone either exists finished or its door says
something cheeky ("Field trip forms not signed yet").

## 3. Where it lives

`trollrunner-games` repo, following the established layout:

```
troll-high.html                      ← game page (hub card links here)
assets/games/troll-high/
  styles.css
  leaderboard.js                     ← shared-ladder config (see §14)
  src/                               ← ES modules, no build step
    main.js      boot, game loop, state machine
    zone.js      zone loading/streaming, transitions, collision
    render.js    layered canvas renderer, camera, lighting
    clock.js     deterministic world clock (see §5)
    player.js    avatar movement, emotes, outfit layers
    net.js       Supabase Realtime presence/ghosts/chat (see §6)
    npc.js       routines, A* pathfinding, dialogue
    memory.js    Childhood Memory Engine (see §8)
    objects.js   interactable registry + behaviors
    inventory.js collectibles, sticker book UI
    audio.js     layered ambience + SFX (WebAudio)
    weather.js   rain/snow/leaves/fireflies particles + seasons
    ui.js        Flash-era chrome, dialogs, notebook menus
    save.js      Supabase persistence + local fallback
    input.js     keyboard + touch (virtual stick, tap-to-interact)
    util.js
  zones/*.json                       ← one file per room/area (hand-crafted)
  data/                              ← memories.json, npcs.json, collectibles.json,
                                       dialogue.json, events.json
  sprites/  tiles/  audio/           ← PixelLab exports + SFX
tools/troll-high-editor.html         ← in-repo zone editor (see §7)
```

No dedicated SQL migration — persistence reuses the already-deployed
`troll_game_saves` table (see §13). Same page scaffolding as Trollrreria:
CSP already allows Supabase; `supabase-js` + `troll-accounts.js` +
leaderboard engine loaded the standard way (not `troll-notis.js` — see
§14). New hub card on `index.html` (accent: **school-bus gold**,
category: `mmo`), still hidden until Phase 7 per decision 1.

## 4. Engine

- **Canvas 2D, layered.** Static zone layers (floor, walls, furniture)
  pre-rendered once per zone to offscreen canvases; dynamic layer (players,
  NPCs, particles) redrawn per frame; lighting layer (day/night tint, lamp
  glows, CRT flicker) composited with `globalCompositeOperation`. Integer
  pixel scaling, `image-rendering: pixelated`.
- **16px tiles.** Zones are tile grids (typ. 40×30 to 80×50) with a collision
  mask, walk-behind mask (so you walk behind desks/trees), and an object layer.
- **Zone-based world.** Each room/area is its own zone JSON; doors/edges
  declare targets. Adjacent zones preload in idle time so transitions are a
  quick fade, GBA-style. No giant single map — this is what keeps 20+ areas
  performant on phones.
- **Performance budget:** 60fps on a mid-range phone; < 3s to first walkable
  frame on cable; zone JSON + its art < 1.5 MB.
- **Input:** WASD/arrows + `E`/tap to interact, `Enter` chat, `Tab` emote
  wheel. Touch: virtual stick + context button, same pattern as Trollrreria's
  `touch.js`.
- **Accessibility:** all interactions keyboard-reachable, focus outlines,
  reduced-motion mode (kills screen shake/particles), memory popups are real
  text (screen-readable), audio cues have visual counterparts.

## 5. The clock — the trick that makes it feel alive

One **deterministic world clock**, computed from wall-clock UTC — no sync
traffic, every client agrees to the millisecond:

- **1 real hour = 1 school day.** ~6 min per class period: bell rings,
  hallways flood, classes fill, recess happens, buses come at 3pm, night falls,
  the school gets spooky. Log in at different real times → different vibe.
- **Bell schedule** drives NPC routines, ambient audio (hall chatter vs.
  classroom quiet), and which doors are open.
- **Weather & seasons** are a seeded PRNG over the day index: everyone sees
  the same rain on the same afternoon. Real-world seasons map to in-game ones
  (December = snow on the field, October = Halloween decorations).
- **Events** (§12) are calendar entries over this clock: "Book Fair this
  Friday" is true for every player simultaneously.

NPCs are fully deterministic from the clock (schedule + A* on static grids),
so they need **zero network traffic** — every client simulates identical NPCs.
Only real players use the network.

## 6. Multiplayer

Simpler than Trollrreria's co-op because there is no shared simulation to
host — no terrain edits, no combat. Each client owns only its avatar.

- **Transport:** Supabase Realtime broadcast + presence, per-zone channel
  `trollhigh:<zoneId>` (BroadcastChannel fallback for same-browser tabs, as in
  `trollrreria/src/net.js`). Join a zone → subscribe; leave → unsubscribe.
- **Ghosts:** position/direction/anim/emote/outfit broadcast at 8–10 Hz,
  interpolated client-side. Presence API gives the roster (respecting the
  untrack-before-retrack gotcha from the who's-online work).
- **Chat:** per-zone speech bubbles above heads + a small scrolling log.
  Lightweight client-side profanity soften, same posture as TROLLCHAT.
- **Emotes/actions:** sit (snaps to chair/bench tiles), wave, dance, laugh,
  jump; trade + gift flows come with inventory (§10).
- **Capacity:** soft cap ~40 avatars per zone; beyond that new arrivals render
  the 40 nearest. No host, so there is no host-bottleneck cliff; the school
  having many rooms naturally shards load across channels.
- **NPCs/weather/clock need no sync** (§5) — the "MMO feel" costs only avatar
  ghost traffic.

## 7. Handcrafted zones — authoring pipeline

"Nothing copy-pasted" requires a real authoring tool, not hand-typed JSON:

- **`tools/troll-high-editor.html`** — in-repo, no-dependency editor page:
  paint tiles from the loaded tilesets, stamp furniture/objects, draw
  collision + walk-behind masks, place doors/NPC waypoints/memory objects,
  export zone JSON. (Repo already has a `tools/` dir; this is dev-only, not
  linked from the arcade.)
- Zone JSON schema: `{ id, name, size, tilesetRefs, layers: {floor, deco,
  overhead}, collision, objects: [...], doors: [...], npcs: [...], ambience,
  lightmap }`.

## 8. Childhood Memory Engine

The heart of the game. Fully **data-driven** so content grows without code:

```json
{ "id": "mem-tv-cart", "zone": "classroom-3b", "sprite": "obj_tv_cart",
  "interact": "inspect", "title": "The TV cart",
  "text": "The door opens. The TV cart rolls in. No work today.",
  "sfx": "crt_click", "rarity": "common", "tags": ["classroom", "2004"] }
```

- **Interaction types:** `inspect` (popup card), `use` (animates + sound:
  light switch, pencil sharpener, sink), `sit`, `play` (launches a minigame),
  `collect` (one-time pickup), `secret` (hidden until condition met).
- **Memory popups** are styled like a Polaroid/notebook card — object pixel
  art + one or two lines of copy (short, sentence case, slightly cheeky, per
  house style). First discovery stamps it into your **Memory Book** and counts
  on the ladder (§14).
- **Content targets:** launch with **~200 memory objects** across the school
  (prompt's full list — smelly markers, gel pens, chocolate milk, dial-up
  easter egg, XP startup sound, all of it), growing every phase.
- Rare finds get the ✨ sparkle + a leaderboard tick (see §14). TrollNotis
  was considered for this but turned out to be a social-media cross-post
  announcer, not an achievement-toast system — see §14.

## 9. NPCs & cast

- **Systems:** schedule table per NPC (`period → zone + behavior`), A* on the
  zone grid, wander/idle behaviors inside rooms, proximity dialogue with
  branching lines that vary by period/season/weather, rare 1-in-N interactions.
- **Starting cast (~14, all original-but-inspired, no literal copies):**
  - **Trollface** — legendary NPC. Almost never seen; graffiti, posters and
    rumors first, actual sightings are an event (§15).
  - **Eldon Tusk** — kid tech-billionaire; hogs the computer lab, sells
    questionable gadgets from his locker, launches model rockets at recess.
  - **Pep** — laid-back green frog kid; feels-good-man energy, hangs by the
    bike racks, rare "feels bad, man" rain dialogue.
  - Principal Grimace-face, the janitor who knows every secret (literally —
    he gates tunnel access), lunch lady legend, gym coach, art teacher,
    librarian who shushes you in ALL CAPS, the substitute (random days!),
    school nurse, band kid, book-fair lady (event-only), ice-cream-truck
    driver (3pm only).
- Each gets: distinct portrait + sprite, routine, favorite spot, dialogue
  pool, seasonal outfit variants, one hidden easter egg.

## 10. Collectibles, inventory, trading

- **Notebook-style inventory** (§16): sticker book pages, card binder, "stuff"
  pouch. Everything from the prompt's list — trading cards (a Troll TCG set),
  yo-yos, marbles, tech decks, gel pens, funny erasers, glow sticks, school
  IDs, yearbook.
- **Sources:** hidden around zones (respawn on a clock), book fair stock,
  cafeteria lunch-toy rares, NPC gifts, event exclusives, secret-only items.
- **Trading & gifting** player-to-player via a confirm-both-sides dialog over
  the zone channel; writes to both inventories (§13). No money anywhere near
  this — collectibles are never purchasable ($-free per pillar 1; TrollPay
  stays out of this game entirely).

## 11. Computer lab & minigames

- The lab is a showpiece: beige CRTs, ball mice, wheeled chairs, one machine
  that's "broken", one that boots painfully slowly (XP sound), one that hides
  a secret.
- **Working computers boot into the actual Troll Runner Arcade** — a CRT-
  framed in-world window that launches our existing games (decision 4). The
  arcade building downtown does the same with cabinets in a later phase.
- **Recess games v1** (original in-world minigames, not embeds): four square,
  tetherball, hopscotch, kickball; hide-and-seek and freeze tag as player-run
  activities with light system support (countdowns, "found" tags).

## 12. Events

Clock/calendar-driven (§5), all deterministic so every player sees the same
event: **Pizza Friday** (weekly), **Book Fair** (the gym transforms; biggest
collectible drop), **Spirit Week**, **school dance**, **Halloween parade**
(October), **Snow Day** (school locked, playground open, snowmen buildable),
**Field Day**, **Movie Day** (TV cart!), talent show. Each event is a data
entry + a zone-variant, so new events don't need engine work.

## 13. Persistence (Supabase) — IMPLEMENTED Phase 6, simpler than planned

No new schema needed. The original plan called for a dedicated
`docs/troll_high.sql` with `troll_high_profiles` / `troll_high_unlocks` /
`troll_high_trades` tables — but `assets/supabase/troll_game_saves.sql`
(main site repo) already exists, is already deployed, and is already used
by Trollrreria for exactly this shape of problem: one JSONB blob per
`(user_id, game_id)`, owner-only RLS, no shared-row complexity. Troll High
just registers as `game_id: "troll-high"` and stores
`{ zoneId, x, y, foundKeys, savedAt }` — see `src/save.js`. Simpler,
reuses a proven path, and needed zero manual Supabase setup from the user.
Per-item unlock rows (sticker/card/item/secret, for a future inventory) and
a trade log can still be added later either as more `troll_game_saves`
JSON shape, or as real tables if querying/joining across players turns out
to matter — not decided yet, not needed until Phase 7's collectibles exist.

- RLS: owner-only (`auth.uid() = user_id`), already enforced by the shared
  table's existing policies.
- **Login required** (decision 3): playing needs a TrollRunner account —
  implemented as a real gate at the title screen (`src/gate.js`), reusing
  Troll Casino's `#tc-gate` pattern. SSO-aware: a session from any other
  *.trollrunner.net game skips the form via `TrollrunnerAccounts`' shared
  cookie. Position + Memory Book are cloud-first, with a local cache
  mirror (`src/save.js`) as a synchronous fallback for page-unload timing
  and as an offline cache.

## 14. Shared arcade systems (mandatory wiring) — DONE Phase 6

- **Weekly ladder**: `gameId: "troll-high"`, live via the shared
  `troll-leaderboard.js` engine, shown in an in-game 🏆 overlay panel
  (no page chrome exists outside the canvas to mount a page-section
  version in, unlike Troll Kombat). Column is **Memories Found** for now
  — Secrets/Stickers/Days-attended columns from the original plan need
  systems (inventory, a real secrets tier) that don't exist yet; adding
  the columns before the data would just be decoration. `record()` fires
  on each first-discovery. Prizes stay display-only, `live:false`
  (enforced by the shared engine itself).
- **TrollNotis** — evaluated, NOT wired. Its real API
  (`assets/js/troll-notis.js`) is a specific social-media cross-post
  announcer (X/Instagram, platform badges, a CTA link out to the post),
  not a generic achievement-toast system. The "🍕 day complete" call in
  Papa Troll's Pizzeria's `game.js` references a `.push()` method that
  doesn't exist on the real object — it's silently swallowed by that
  code's own `typeof === "function"` guard, so it's already a no-op
  there too. Memory discoveries use the ✨ sparkle on the popup card +
  the leaderboard tick as their feedback instead.
- **troll-accounts.js** for identity; player display name (in chat, over
  the avatar, everywhere) comes straight from the account's real
  username, not a made-up guest name.

## 15. Trollface meta-arc & secrets

Secrets tiering (nothing marked, nothing obvious):

1. **Curiosity tier:** roof access, maintenance tunnels, teacher's lounge,
   basement, the one bathroom stall, storm-drain grate behind the gym.
2. **Puzzle tier:** the broken lab computer, library book cipher, janitor's
   key routine, time capsule (opens on a real calendar date).
3. **Meta-arc:** collect Trollface graffiti sightings → unlock the secret
   club → underground Troll HQ → meet the legendary NPC → golden troll
   statue + rarest card in the TCG. Designed to take the community weeks.
4. **Developer room**, naturally.

## 16. Art & audio direction

- **Art:** GBA/DS-era pixel look (FireRed / EarthBound / Mother 3 warmth),
  16px tiles, modern lighting on top (day/night tint curves, window light
  shafts, CRT glow, firefly particles, rain/snow, wind-animated grass and
  trees). Warm palette; the school at 3pm sun should feel like a memory.
- **PixelLab pipeline** (established in this repo):
  - `create_topdown_tileset` per environment theme (hallway, classroom,
    cafeteria, gym, outdoors-fall, outdoors-winter…), `create_map_object` for
    furniture/props, `create_ui_asset` for the notebook/sticker UI.
  - **Trollface faces reuse the established rigs** — `create_character_state`
    on Trollface Runner v3 for trollface characters (house rule: never fresh
    trollface prompts; must read as the classic trollface). New top-down
    student/NPC bodies are new 8-direction characters with trollface-style
    heads, checked against that rule.
  - Player avatars: one base 8-dir walk rig + palette-swap skin/outfit layers
    for customization (cheap variety, no per-outfit generation explosion).
- **Audio:** WebAudio layered ambience — base room tone (CRT hum, rain on
  windows) + clock-driven layers (hall chatter at passing period, distant
  basketballs, lawn mower at 3pm, ice cream truck) + one-shot SFX (bell,
  locker slam, keyboard clicks). Synthesized/self-made like Trollrreria's
  `music.js`/`audio.js` — no licensed audio.

## 17. UI

Early-Flash-game chrome: chunky rounded buttons, soft gradients, `retro.ttf`
or a PixelLab font for headings, notebook/binder inventory, sticker-sheet
aesthetics, school-supply color accents. Menus feel like customizing your
binder in 2006. Mobile: bottom-sheet versions of the same panels.

## 18. Phase plan (each phase = merged to main + playable)

| # | Phase | Ships |
|---|-------|-------|
| 0 | Proof — **DONE** | Hallway + 1 classroom walkable in-browser: tileset, avatar 8-dir walk, camera, collision, zone transition. Validates the whole art pipeline before mass content. |
| 1 | Engine core — **DONE (v1)** | Zone system, editor tool (`tools/troll-high-editor.html`), touch controls, walk-behind, base ambience audio (`src/audio.js`), day/night tint. Deferred to later polish: lamp glow / CRT flicker lighting. |
| 2 | School wave 1 — **DONE** | 8 rooms live: office, 3 classrooms (3B/5A/7A, each with a distinct prop twist — TV cart / fish tank / reading corner), computer lab, cafeteria, library, restrooms. All wired off a widened Main Hallway (8 doors). 16 object types (8 new this phase), 71 placed memory-bearing instances across all zones. Base ambience hooked to indoor/outdoor. |
| 3 | Multiplayer — **DONE (v1)** | Per-zone ghosts (`src/net.js`, `src/ghost.js`) over Supabase Realtime broadcast+presence with the BroadcastChannel same-tab fallback, 10Hz position sync with client-side interpolation, roster pill, chat bubbles + scrolling log, 4 emoji emotes (wave/dance/laugh/heart). **The "it's an MMO" moment — confirmed working across real separate browser contexts.** Guest identity (random name, editable, persisted to localStorage) — real accounts arrive in Phase 6. Deferred: literal sit-on-furniture (needs a seated-pose sprite we haven't generated) and the ~40-avatar soft cap (not yet enforced). |
| 4 | School alive — **DONE (v1)** | Bell (`Ambience.ringBell()`, fires once per period change — deterministic from the shared clock, zero network traffic like everything else clock-driven). NPC system (`src/npc.js`): real BFS pathfinding over each zone's solid grid, two behaviors (stationary / patrol, ping-ponging deterministically off wall-clock time), proximity dialogue (distance-triggered, cycling line pools, floating bubbles). First 8 NPCs: Ms. Chalke, Mr. Fenwick, Mrs. Petrova (the 3 classroom teachers), Eldon Tusk (computer lab), Lunch Lady Doris (cafeteria), Ms. Quietly (library), Principal Grimface (patrols the office), Janitor Gus (patrols the hallway). Period-driven hall-chatter noise bed, louder during passing periods and in the hallway than indoors. Deferred: walk-cycle sprites for the 2 patrol NPCs (they glide in their idle pose — noted, not hidden), NPC-specific cross-zone routines (all 8 are zone-bound for now). `sprites.js` now skips fetching walk strips entirely when a character's meta declares none exist (`walkFrames <= 1`), so this doesn't cost 64 wasted 404s per page load. |
| 5 | School wave 2 — **DONE** | Gym, auditorium, art room, music room, science lab, nurse's office, playground, sports field, bus loop — 9 new rooms off a second hallway wing (East Wing / hallway-b), branched off Main Hallway rather than one absurdly long corridor. Secrets tier 1: a hidden basement (unmarked East Wing door) chains into the maintenance tunnels, and an unmarked gym door leads up to the roof — 2 new tilesets (outdoor schoolyard w/ chain-link fence, gravel rooftop w/ parapet), 18 new furniture pieces. 121 memory-bearing instances across all 22 zones. |
| 6 | Persistence — **DONE** | Real account gate at the title screen (login/signup, SSO-aware via `TrollrunnerAccounts` — a session from any other *.trollrunner.net game skips the form). Cloud saves reuse the existing shared `troll_game_saves` table (no new SQL needed — same table Trollrreria already uses; a per-game `troll_high.sql` was in the original plan but turned out unnecessary). Position + every found memory round-trip through a real account across reloads. Weekly leaderboard wired via the shared `troll-leaderboard.js` engine, shown in an in-game overlay panel (🏆 button) since Troll High has no page chrome outside the canvas to mount a page-section leaderboard in, unlike Troll Kombat. **TrollNotis was evaluated and NOT wired** — its real API turned out to be a specific social-media cross-post announcer (X/Instagram, platform badges, CTA links), not a generic achievement toast system; forcing memory discoveries through it would misuse it. Deferred to a later phase: inventory + sticker book (needs Phase 7's collectible systems to exist first). |
| 7 | Lab & recess — **DONE** | CRT computers launch the real arcade games in an iframe overlay (`openArcade`/`closeArcade`); 4 original recess minigames (`src/minigames.js`: four square, tetherball, hopscotch, kickball) with high scores tracked on the profile; trading + gifting (`src/cards.js`, `net.js` trade-offer/trade-accept/trade-decline/gift messages) — a 14-card set, earned as a side chance on existing milestones, negotiated live over the existing per-zone broadcast channel with no server-arbitrated ledger. **v1 LAUNCH: hub card flipped live on games.trollrunner.net (new "Social" category).** Also shipped in this window, from direct player feedback rather than the original plan: a full campus map screen (M key, `src/mapview.js`), a student profile panel with a cosmetic student ID (`src/profile.js`), a cafeteria food-bar ordering flow gated on that ID (`src/cafeteria.js`), and first-login orientation + elective pick + a class schedule + auto-checking daily tasks (`src/schedule.js`). See §19 for the larger post-Phase-7 design direction these and Phase 7's card set now feed into. |
| 8 | Neighborhood 1 — **DONE (v1)** | Main Street (reached via the Bus Loop), Arcade, Pizza Place, Corner Store, Park — 5 new zones. Arcade and Pizza Place have real working cabinets (`arcade-cabinet` objects reusing Phase 7's `openArcade` launcher verbatim): Troll Kombat, Meme Metro, Troll Casino downtown; Papa Troll's Pizzeria at the pizza place. Bus stop and ice cream truck folded in as Main Street flavor objects rather than their own zones; cul-de-sacs not built. Campus map (M) gained a "Downtown" row. Found and fixed a real bug while building this: zone terrain must be a (h+1)×(w+1) vertex grid, not h×w — see §22. |
| 9 | Neighborhood 2 — **DONE (v1)** | Forest Trail (off the Park), Skate Park, Lake, Warehouse — 6 new zones (33 total). Secrets tier 2: an unmarked grate on the Forest Trail chains into Storm Drains, which has its own second unmarked passage into the Caves — mirrors the Phase 5 basement → tunnels pattern exactly. Tree houses folded in as a Forest Trail flavor object. Campus map (M) gained a "The Woods" row. |
| 10 | Events — **DONE (v1)** | `events.js`: deterministic from the REAL calendar date (not the in-game day), one active event at a time — Halloween, Snow Day, School Dance, Spirit Week, Book Fair, Pizza Friday. Schedule-overlay banner for all six; Halloween/Snow Day also get a renderer tint (same technique as the day/night tint); Pizza Friday forces the cafeteria special. Seasonal ART variants not built — no new art pipeline yet. |
| 11 | Troll meta — **DONE (v1)** | Underground HQ (secret club) reachable only via Caves' own second unmarked door — the full hidden route (storm drains → caves → HQ) makes reaching it itself "the event." Trollface (legendary NPC) lives there; meeting him unlocks a matching bedroom decoration. Golden statue + club charter flavor objects. Graffiti hunt: a scattered collectible across the hidden zones, unique text per spot, plugs into the existing memory system. Troll TCG set (already built in Phase 7) expanded by 2 cards. |
| 12 | Polish — **DONE (v1)** | A11y: 6 icon-only HUD buttons gained `aria-label` (had `title` only). Weather: real snow particles for Snow Day, layered on the event-tint system, self-contained in `Renderer`. Mobile: HUD bar now wraps instead of overflowing on narrow viewports (verified at 390px). Developer room: a second unmarked door inside the Underground HQ. Perf audit: reviewed, no changes — the one known cost (all zone sprites loaded upfront) is an accepted Phase-0 tradeoff. Audio full layering and seasonal art variants deferred — no sample-based audio or new-art pipeline exists yet. |

Phases 0–7 are the launch arc; 8–12 are the "world keeps growing" arc.

## 19. Risks

- **Content volume is the real cost**, not engineering. The editor tool (§7)
  and data-driven memory/NPC/event systems exist to make content cheap; if
  either turns out clunky, phases 5+ drag. Phase 0/2 will tell us early.
- **PixelLab top-down consistency** across many tilesets — mitigate with a
  fixed style prompt block reused verbatim, and re-roll freely (cost-gating
  is explicitly off).
- **Realtime message quotas** at scale — per-zone channels + 8 Hz ghosts keep
  usage modest; if the free-tier ceiling is hit, drop to 5 Hz + delta-only.
- **Trademark/likeness:** cast stays parody-original (Eldon Tusk, Pep);
  trollface itself is established brand practice for this project.

## 20. Decisions — LOCKED 2026-07-19

1. **v1 scope: school-first.** Launch at Phase 7 with the complete school;
   neighborhood arrives in post-launch waves.
2. **Multiplayer: one shared world.** Per-zone Supabase channels, everyone in
   the same world, ~40 visible avatars per zone.
3. **Accounts: login required.** TrollRunner account gate at the title screen
   (§13). Cloud-first persistence.
4. **Computer lab: real arcade games.** Working CRTs boot the actual Troll
   Runner Arcade in a CRT-framed in-world window.

## 21. Post-Phase-7 design direction — the Five Layers

Set 2026-07-20, after Phase 7 shipped, from a joint design pass (this
project's own review + a ChatGPT-authored creative-director brief the
player brought back). Full source briefs live in chat history, not
reproduced verbatim here — this is the durable summary to build against.

**Core stance:** not a grind-XP MMO. A "persistent online childhood" —
every mechanic should answer "does this recreate a real childhood
memory?", not "what feature can we add?"

**Five layers every future system should reinforce** (best mechanics hit
several at once):
1. **Daily Life** — routines players form on their own (check locker,
   grab lunch, one recess game), not quest-forced. Mostly built already
   (schedule, daily tasks, cafeteria, recess games).
2. **Growing Up** — progression as life story, not levels. Profile
   already has enrolled-since/memories/high scores; extend with
   clubs-joined, dances-attended, detentions, etc. — same save payload,
   cheap to add.
3. **Living MMO** — the shared world creating unscripted social moments
   (fire drills, lost hamster, food fights) rather than forced
   grouping. Cheap version: pick a pseudo-random daily event off the
   same deterministic clock already driving the bell schedule — no new
   backend.
4. **Hidden World** — the Trollface mystery (already seeded via the
   basement/tunnels/roof secrets). Slow-drip only; don't over-invest
   here until the visible layers have daily-return traffic.
5. **Nostalgia objects** — content, not systems. Keep feeding the
   existing object/memory registry (`src/objects.js`) with 2000s-era
   flavor text; cheapest category to continuously invest in.

**Explicitly deferred, not rejected:** NPC memory of players (needs a
per-player relationship record per NPC, stored in the save payload —
real subsystem, not a quick add), full world/crowd simulation (skipped
for now given low concurrent player counts — NPCs instead just shift
rooms on period boundaries, reusing the existing clock), yearbook +
disposable camera (wants image upload/storage — the one idea here that
needs new infra, specifically a Supabase storage bucket; explicitly
wanted by the player, just gated on that infra decision).

**5 new NPCs approved** (current roster is 8, all staff — this rounds
out actual peer/friend characters): Pep (named in the original cast list
in §9 but never built — bike racks, "feels bad man" rain dialogue), a
rival/frenemy kid, a shy new-kid (fits a "help a newer student" beat),
a future club-leader type (seeds Phase 11-ish club content early), and
one NPC that drops occasional cryptic Trollface-adjacent lines (seeds
layer 4 without spoiling it).

**Agreed near-term build order** (not strict — player said order doesn't
matter): trading/gifting (done, closed out Phase 7) → profile life-story
stats → daily rotating flavor (lunch menu/announcements/random event) →
the 5 NPCs → NPC memory/relationships → bedroom personal space → then
re-evaluate against Phases 8–12 and yearbook/cameras.

Note: Phase 7's trading-card set (`src/cards.js`, 14 cards) is the same
idea §18's Phase 11 called "Troll TCG set" — already exists now, ahead
of schedule; Phase 11 becomes "expand the existing card set" rather than
building one from scratch.

**Status 2026-07-20: the entire near-term queue above is done** — trading/
gifting, profile life-story stats, daily rotating flavor, the 5 NPCs,
NPC memory/relationships, bedroom, and yearbook/camera (real Supabase
Storage bucket, `docs/troll_high_yearbook.sql`, verified end-to-end with
a real account). Also shipped from the doc's "Classes" section (§9-ish
mention, "every class should be an enjoyable minigame"): 5 classes-as-
minigames (Pop Quiz, Mental Math, Word Scramble, Lab Mix, PACER Test),
reusing Phase 7's Minigame overlay with zero new UI. Also fixed a real
bug this surfaced: Space had been a second universal interact/close key
in `input.js` alongside E, which silently closed any minigame using
Space as its own action key (tetherball, kickball) the instant it was
pressed — removed, E is now the sole interact key everywhere. Next up:
Phases 8-12 (neighborhoods, events, Troll meta, polish), plus Clubs
(flagged as its own phase-sized chunk, not yet scheduled).

## 22. Zone authoring gotcha: terrain is a vertex grid, not a cell grid

Every existing zone file already gets this right, but it's easy to get
wrong writing a new one from scratch (as Phase 8 did, the first time),
and the failure mode is nasty: **`terrain` must be `(h+1)` rows of
`(w+1)` characters**, not `h` rows of `w` characters, even though `w`/
`h` are declared as the room size in *cells*. `zone.js`'s `this.v` is a
vertex grid (`h+1` rows × `w+1` cols) used for wall-face autotiling —
undersizing it doesn't throw at load time (the `Zone` constructor
doesn't validate), it throws lazily the first time that zone is actually
switched into (`this.v[r-1][c]` goes out of bounds inside the
`for`-loop at the bottom of the constructor). Because `switchZone()`
doesn't clear `pendingDoor` until *after* the throwing line, the
exception recurs every single frame — the fade-out visually completes
and then nothing happens, forever, with no error surfaced anywhere a
player would see it (only in the console, buried in a print loop).

The fix is mechanical: for a room of `w`×`h` cells, `terrain` needs a
1-or-2-row top wall band + floor rows + a 1-row bottom wall band,
totaling `h+1` rows, each exactly `w+1` characters (`#`/`.`) wide. See
any existing zone file, or generate it programmatically (Phase 8's
zones were fixed this way) rather than hand-typing `#`/`.` strings.
Double-check with: `terrain.length === h + 1 && terrain.every(r =>
r.length === w + 1)`.

## 23. Reprioritization 2026-07-20 — "make the school feel alive"

After §21's near-term queue shipped in full (trading, profile stats,
daily flavor, 5 NPCs, NPC memory, bedroom, yearbook, classes-as-
minigames) plus Phases 8-12 (neighborhoods, events, Troll meta, dev
room) and Clubs, the player brought back a second ChatGPT-authored
creative-director brief that explicitly **reorders** priorities rather
than adding to the pile. Its governing rule: *"If a feature doesn't
create a story that someone might tell another player tomorrow, it
probably isn't a priority."* Explicitly deprioritized: more
collectibles, more furniture, more minigames.

New priority order (highest first): **1. School Feel Alive** (NPC
daily schedules, hallway traffic tied to bell timing, ambient
conversation by time of day) → 2. deepen NPC relationships beyond the
current 2-tier firstLine/familiarLine system → 3. daily-life habit
loops (favorite locker/bench/NPC framing) → 4. turn Book Fair/Pizza
Friday/Picture Day/Spirit Week/PACER Day into real interactive
happenings, not calendar banners → 5. Town expansion, explicitly not
rushed → 6. multiplayer memories (shared yearbooks, dances, talent
shows, elections) → 7. expand (don't resolve) the Trollface mystery.

**Phase 1 shipped 2026-07-20 — NPC daily schedules.** Reuses the
existing deterministic world clock (`clock.js`), zero new backend, per
§21's "explicitly deferred" full-world-simulation call — this is the
cheap version that call anticipated. `npc.js`'s `NPC_DEFS` entries can
now carry an optional `activePeriods: [...]` array of `clock.js` period
labels (undefined = always present, fully backward-compatible); the
*same* NPC `id` can appear in multiple zones' entries, since
`npcRelations` keys off `id` not zone, so relationship/dialogue
progress survives an NPC "moving" between locations by period.
`main.js`'s `getNPCs(zn)` filters the cached per-zone NPC list against
`clock.now().period`; this re-runs both on zone entry and live inside
the existing 1s clock-poll block (on every period change), so presence
updates even if the player stays in one room across a period boundary.

Shipped for v1: **Janitor Gus** patrols hallway-a during school hours,
mops the cafeteria (same `id`, second `NPC_DEFS` entry) after school/
evening/night. **Ms. Quietly** is in the library only during school
hours (empty/quiet at night). **Lunch Lady Doris** is only at the
cafeteria counter around lunch (periods 4-5 + Lunch). **Pep** is only
at the bus loop "After school" — the doc's own example ("Pep is by the
bike racks" after school). **Marcus Vale** is in the gym during Period
5 (P.E.) and After school. Teachers stayed fixed in v1 (already
period-appropriate in their own rooms). Test: `tools/troll-high-npc-
schedule-smoke.js` — covers zone-entry filtering, the live 1s-poll
re-filter with no zone re-entry, and relationship continuity across an
NPC's two locations. Existing tests that assumed always-present
schedule-restricted NPCs (`troll-high-npc-smoke.js`,
`troll-high-new-npcs-smoke.js`) now pin the clock via
`th-test-auth-stub.js`'s new `lockClockToHour(page, hour)` helper so
they're deterministic regardless of wall-clock time when they run.

**Phase 2 shipped 2026-07-20 — deepen NPC relationships beyond the
2-tier system.** `relations.js`'s `pickDialogueLine()` grew three new
tiers on top of the original firstLine/familiarLine: an optional
`secondLine` (timesTalked===1, an "oh, you're back already" beat),
`closeLine` (timesTalked===8, a deeper "actual friend" tier for NPCs
that define one), and — the doc's own example, "Remember when we found
the basement?" — one-time `memoryLines`: `{id, condition, line}`
entries checked against a `relationContext()` snapshot (visited zones,
club membership, cards collected, high scores, trades, gifts, etc.),
firing once the first interaction after their condition becomes true
and never repeating (tracked via `relation.seenMemories`). Also a
time-aware `returningLine`: if real wall-clock time since
`relation.lastTalkedAt` exceeds 3 real hours (3 in-game days, on the
same clock as everything else), the next interaction uses it instead
of normal cycling dialogue — still fully deterministic, just reading
elapsed `Date.now()`. Shipped on 5 NPCs so far: Janitor Gus (both his
hallway and cafeteria entries, same memoryLines since it's the same
person), Pep, Marcus Vale, Ms. Quietly, and Trollface. Relation records
already lived in the existing `npcRelations` save field (an opaque
object), so no save-schema or `save.js` changes were needed — the new
fields (`lastTalkedAt`, `seenMemories`) just ride along. Test:
`tools/troll-high-relationship-depth-smoke.js`, using Ms. Quietly and
the `addCard()` debug hook to force her "cards" memoryLine condition
true mid-test; walks the full tier sequence through closeLine, then
simulates a 4-real-hour gap to verify returningLine.

**Phase 3 shipped 2026-07-21 — daily-life habits.** "The game reflects
your own routine back at you," not new stats to grind. Two pieces:

1. `zoneVisitCounts` (new save field, `{zoneId: count}`) increments on
   every zone entry — `visitedZones` was already tracked but only as
   presence, not frequency. `favoriteZoneName()` reads the highest
   count, excluding `hallway-a`/`hallway-b` (everyone passes through
   those constantly; that's not a "favorite," just the way through),
   and surfaces as "Usually found in: X" on the profile card.
2. `claimedSpots` (new save field, `{lockers: key|null, "park-bench":
   key|null}`) — the very first locker or park bench you ever interact
   with is claimed as yours immediately (`showMemory()` in `main.js`),
   keyed by `${zone.id}:${obj.memKey}` so it's one specific instance,
   not every locker in the school. From then on that exact object's
   memory card shows personalized title/text ("Your locker" / "Your
   bench") every time, via a shared `personalizeMemory()` helper used
   both for the hint text and the memory-card popup; every other
   locker/bench of the same type stays generic. Profile shows "Has a
   locker" / "Has a bench" once claimed.

Both fields are plain new keys on the existing save row — `save.js`
now threads `zoneVisitCounts`/`claimedSpots` through same as any other
field, no migration needed. Test: `tools/troll-high-daily-life-smoke.js`
— covers immediate-claim-on-first-interaction, persistence across
repeat visits, that a second locker/bench of the same type stays
generic, the favorite-zone tie-break via a Forest Trail bounce, and the
profile readout string.

**Phase 4 shipped 2026-07-21 — Real School Events.** Turns Book Fair/
Pizza Friday/Picture Day/Spirit Week/PACER Day into actual interactive
happenings instead of just a schedule-overlay banner. Deliberately
reuses existing systems rather than adding new collectibles (the doc's
own "don't prioritize hundreds of collectibles" guidance) — no new
decorations or cards, just behavior/dialogue that changes on the day:

- Two new events added to `events.js`: **Picture Day** (day 15 of any
  month) and **PACER Day** (day 20) — both previously missing from
  `EVENTS`/`activeEvent()` entirely, unambiguous against every other
  window (spirit-week 1-5, book-fair 8-12, dance's last-Friday-22-28).
- `NPC.speak(eventId)` (`npc.js`) now takes the event id and, if the
  NPC's `def.eventLines[eventId]` exists, cycles through that array
  instead of normal `dialogue` — same index/modulo mechanics either
  way. `showDialogue()` in `main.js` passes `todaysEventId` through;
  Phase 2's milestone tiers (firstLine/secondLine/familiarLine/
  closeLine/memoryLines/returningLine) still take priority, so
  eventLines only surface on an NPC's ordinary cycling turns.
  Wired up: Lunch Lady Doris (pizza-friday — the cafeteria's real
  `PIZZA_FRIDAY_SPECIAL` swap already existed from Phase 1/daily.js,
  this is the dialogue half), Ms. Quietly (book-fair), Marcus Vale
  (pacer-day), Wendell (spirit-week + picture-day), Priya
  (spirit-week), Pep (spirit-week), Marnie (picture-day).
- Picture Day + yearbook: capturing a photo on Picture Day tags
  `photo.eventTag = "Picture Day"` (camera.js's photo object already
  had room for extra fields) and shows a toast; the yearbook grid
  renders the tag in each photo's caption.
- PACER Day: beating your own `pacer-test` high score specifically
  while `todaysEventId === "pacer-day"` gets its own toast, taking
  priority over the ordinary (chance-based, `maybeAwardCard()`) card
  toast so the two don't race — the card is still silently awarded
  either way, just not announced that turn.

Test: `tools/troll-high-real-events-smoke.js` — finds real calendar
dates for all 4 non-Halloween/Snow-Day/Dance events via the same
`findDate()` scan as the original events smoke test, then freezes the
browser's `Date` (both `new Date()` and `Date.now()`, via a `FakeDate`
subclass installed through `evaluateOnNewDocument`) to noon on the
target day plus an offset landing in a school-hours period — clock.js's
period math is pure time-of-day-within-the-hour and totally
independent of calendar date, so freezing `Date` doesn't disturb NPC
scheduling, and `performance.now()`-driven animation is untouched
since nothing in the render loop reads `Date`. Verifies each NPC's
eventLine actually fires (accounting for Phase 2 milestone tiers
consuming the first 1-2 interactions first), the Picture Day photo tag
+ yearbook caption, and the PACER Day toast.

**Phase 6 (first slice) shipped 2026-07-21 — the real multi-club
system.** "Multiplayer Memories" is a big phase (shared yearbooks,
class photos, dances, talent shows, science fairs, graduation, clubs,
elections); asked which slice to build first, chose clubs specifically
because it needs **no new Supabase table** — "which clubs exist" is
genuinely just whichever names other live players are currently
broadcasting over the existing zone presence channel (`net.js`), the
same ephemeral mechanism that already shows real players' names. That
also makes it honestly multiplayer-native rather than a fake shared
list: a club is "real" exactly as long as someone's around
representing it.

- `net.js`: `Net` gained `this.club` + `setClub(name)`; `sendPosition()`
  now broadcasts `club` alongside `name`, and incoming `"pos"` messages
  populate `club` on the peer record.
- `ghost.js`: `Ghost.applyUpdate()` stores `club`; `entity()` draws a
  second small gold line (`🏷 ClubName`) under a nearby real player's
  name tag when they have one — same visual language as the existing
  NPC/Player tag.
- `club.js` (new file): just `sanitizeClubName()` — trim/length-cap,
  default to "The Club" if empty. No moderation; out of scope.
- Reading the club charter in the Underground HQ (`main.js`'s
  `showMemory()`) no longer auto-joins. If `!clubMember`, it renders a
  real form inline in the memory card: a "Join" button for every
  distinct club name currently visible among live `ghosts` in the zone
  (sourced straight from their `.club`, i.e. real players actually
  representing that club right now), plus a name input + "Found this
  club" button. The form's own click handler calls `stopPropagation()`
  so interacting with it doesn't trigger the card's existing
  click-anywhere-to-close behavior; `KeyE` still closes without
  choosing (gated on `!clubMember`, not `isNew`, so it re-prompts next
  visit rather than only once ever). Founding sets
  `club = {name, founded: true}`; joining sets `{name, founded: false}`.
  Either way: `clubMember` (still a plain derived boolean — bedroom.js/
  relations.js/relationContext() already keyed off it) flips true,
  `net.setClub(name)` broadcasts it, and it's persisted.
- `save.js`/`main.js`: new `club` save field. Old saves that only had
  `clubMember: true` (pre-Phase-6) synthesize `{name: "The Club",
  founded: true}` on load rather than losing membership.
- Priya's (art-room) whole existing arc was "I'm starting a club, don't
  know what kind yet" — now has a `memoryLines` callback (relations.js's
  `line` field can be a function of context, not just a string, added
  for exactly this) that reacts to the player's own real club name once
  they have one: `` `Wait, "${c.club.name}"? ...` ``.
- Profile card shows `Club: Name (founder)` or `Club: Name`.

Test: `tools/troll-high-clubs-smoke.js` — two real isolated browser
contexts (same pattern as trading-smoke), both run the full secrets
chain into the Underground HQ. Alice founds "Chess Club"; verifies it's
broadcasting over presence by reading Bob's live `ghosts` map directly.
Bob's own charter form is asserted to actually offer "Join Chess Club"
sourced from that presence data, joins it, and both profile cards +
Priya's reactive line are checked. (One navigation gotcha hit while
writing it: landing back near Alice's still-parked position put Bob
within trade range, and `nearPeer` outranks the facing-tile memory
interaction in the same priority chain as everything else — Alice
has to step away from the charter tile before Bob can read it.)
