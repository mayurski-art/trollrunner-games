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
docs/troll_high.sql                  ← run-once Supabase schema (see §13)
```

Same page scaffolding as Trollrreria: CSP already allows Supabase;
`supabase-js` + `troll-accounts.js` + `troll-notis.js` + leaderboard engine
loaded the standard way. New hub card on `index.html` (accent: **school-bus
gold**, category: `mmo`).

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
- Some fire **TrollNotis** toasts on rare finds ("🧌 You found the dial-up
  modem. Screeeech.").

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

## 13. Persistence (Supabase)

New run-once schema `docs/troll_high.sql` (same flow as `troll_accounts.sql`):

- `troll_high_profiles` — user_id, appearance (outfit layers/colors), last
  zone + position, created/updated.
- `troll_high_unlocks` — (user_id, kind, item_id, found_at); kind ∈ memory |
  sticker | card | item | secret. Covers Memory Book, sticker book, binder.
- `troll_high_trades` — append-only trade log (both parties, items, ts) so
  trades are auditable and restorable.
- RLS: own-row read/write; leaderboard visibility comes from the existing
  `troll_leaderboard` path, not these tables.
- **Login required** (decision 3): playing needs a TrollRunner account. The
  title screen doubles as a friendly login/signup gate (via `troll-accounts.js`);
  everything — position, Memory Book, inventory, trades, ladder — is cloud-first
  with localStorage only as an offline cache. The gate ships with Phase 6;
  pre-launch phases run ungated for development.

## 14. Shared arcade systems (mandatory wiring)

- **Weekly ladder** (per standing rule, every game gets it): `gameId:
  "troll-high"`, columns **Memories** / **Secrets** / **Stickers** / **Days
  attended**, `rankBy: ["memories","secrets","stickers"]`; `record()` fires on
  each first-discovery. Prizes stay display-only, `live:false`.
- **TrollNotis** for rare finds, event starts ("📚 The Book Fair is HERE"),
  and friend-joined pings.
- **troll-accounts.js** for identity; player display name above avatar comes
  from the account handle.

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
| 5 | School wave 2 | Gym, auditorium, art/music/science, nurse, lockers, playground, sports fields, bus loop + secrets tier 1 (roof, tunnels, basement). ~200 memory objects total. |
| 6 | Persistence | `troll_high.sql`, accounts sync, inventory + sticker book + Memory Book, **leaderboard + TrollNotis wiring**. |
| 7 | Lab & recess | CRT computers launch arcade games; recess minigames v1; trading + gifting. **← v1 LAUNCH: hub card flips live** |
| 8 | Neighborhood 1 | Streets, cul-de-sacs, arcade, pizza place, convenience store, park, bus stop, ice cream truck. |
| 9 | Neighborhood 2 | Skate park, lake, forest + trail, tree houses, storm drains, warehouse, caves; secrets tier 2. |
| 10 | Events | Event engine + book fair, pizza friday, spirit week, dance, Halloween, snow day; seasonal art variants. |
| 11 | Troll meta | Graffiti hunt, Troll TCG set, secret club, underground HQ, legendary NPC, golden statues. |
| 12 | Polish | Audio full layering, weather/particles pass, perf audit, a11y pass, mobile pass, developer room. |

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
