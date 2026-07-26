# Trollrreria v3 — Terraria/Minecraft Parity Expansion (prompt)

Status: **draft — awaiting go-ahead.** This is a build prompt: hand it to a
fresh session working in `trollrunner-games` and it should be able to start
Phase 1 without re-deriving anything.

---

## Context for the implementing session

The game is **Trollrreria**, a 2D Terraria-genre survival sandbox. Vanilla JS
ES modules + Canvas 2D, no frameworks, no build step, no deps. Launcher
`trollrreria.html`, source `assets/games/trollrreria/src/` (23 modules,
~11k lines). Read before coding:

- `docs/TROLLRRERIA.md` — full systems overview (what shipped)
- `docs/TROLLRRERIA-SURVIVAL-EXPANSION.md` — previous expansion doc
  (hunger, cooking, farming, town — all 5 phases built)
- `src/defs.js` — tile enum `T` (append-only, never renumber), `TILES`,
  `ITEMS`, `RECIPES`, `ENEMIES`, `FUEL`/`SMELT_TIME`, `STATION_SCAN`
- `src/main.js` — game loop, `interact()` (RMB dispatch, ~line 973), town
  stamping (`spawnTownShops`/`buildTownHouse`, ~1551–1642), housing check
  loop (~604–622), traveling trader (~1674)
- `src/npc.js` (`TownNPC` + roles), `src/housing.js` (flood-fill room
  validator), `src/quests.js`, `src/worldgen.js`, `src/ui.js` (crafting
  panel, `refreshStations` ~961), `src/world.js` (`stationsNear` ~354)

## The two complaints driving this

1. **Stations feel dead.** Workbench / furnace / anvil / campfire have no
   entry in `interact()` — right-clicking them does nothing, with no hint
   that the real flow is "stand within 8 tiles, press E." Terraria gets away
   with silent proximity because recipes visibly appear in an always-there
   list; Minecraft makes every station a clickable block with its own UI.
   Right now we have Terraria's mechanic with neither game's feedback.
2. **NPCs read as "wandering the open world," not living in a village.**
   The Trollrreria Town is one row of stamped huts glued next to spawn,
   created **only at `newWorld()`** — worlds saved before that update never
   get a town at all. The housing-roster NPCs move into whatever single
   room the player builds, and the Traveling Trader roams by design. There
   is no village: no clustered settlement to discover, no sense that NPCs
   belong somewhere.

## Already exists — do NOT rebuild

Hunger + starvation, campfire cooking (raw meat → cooked, eggs → omelette),
furnace with real fuel/burn timers, farming (hoe/farmland/berries),
ranching (tame/breed/eggs), beds + sleep-to-morning, wiring layer,
tool/armor tiers through trollium, Troll King → hardmode → Troll Emperor,
enchant table, accessories (wings/dash/rings), Troll Coins economy +
barter shop UI, quest chain (`QUEST_ORDER`: lostGrin → … → grinCore),
Troll Moon / meteors / Traveling Trader events, co-op world sync, PvP,
touch controls, generative music, weekly leaderboard + TrollNotis wiring.

---

## Phase 1 — Stations you can actually touch

Smallest phase, biggest feel improvement. Minecraft's lesson: a station is
a *place you use*, not an invisible aura.

- **Right-click opens crafting.** Add `T.WORKBENCH`, `T.FURNACE`,
  `T.ANVIL`, `T.CAMPFIRE` cases to `interact()` that open the existing
  inventory/craft panel **pre-filtered to that station's recipes** (plus
  no-station recipes). Reuse the panel — no new UI system.
- **Proximity chips.** While the panel is closed, show small HUD chips for
  stations in `STATION_SCAN` range ("🔨 Workbench" "🔥 Campfire"), so the
  aura mechanic becomes visible. Reuse the existing HUD row styling.
- **Reach hint.** When the cursor hovers any interactable tile in reach
  (doors, chests, stations, beds, signs), draw the existing tile outline
  plus a tiny "RMB" glyph. One generic mechanism, applied to every
  interactable — this also fixes discoverability for chests/beds/signs.
- **Campfire status line.** The furnace already shows "🔥 lit — Ns fuel
  left" in the craft list (`ui.js` ~978); give the campfire an equivalent
  ("🔥 crackling — ready to cook") so cooking has visible state.
- **Touch parity:** tap-on-station triggers the same interact path.

*Accept when:* a new player who has never read the docs can place a
workbench, right-click it, and craft — without being told about E.

## Phase 2 — Villages (the headline feature)

Minecraft-style **generated villages**, built on the existing stamping and
NPC machinery rather than a new system.

- **Worldgen:** during `generateWorld`, site 2–3 villages at
  biome-appropriate surface spots well away from spawn (e.g. forest,
  desert, snow — pick flat-ish ground the way structure placement already
  does). Each village: 4–7 buildings generated from the `buildTownHouse`
  stamper (parameterize size/materials per biome — snow huts use different
  block palette than desert), connected by a path tile, plus a well or
  campfire plaza, a small farm plot (existing farmland + crops), lamp
  posts (torch on fence), and one loot chest.
- **Villagers:** each building houses one `TownNPC` villager whose
  profession is read from the **workstation tile stamped in their house**
  (Minecraft's block-defines-profession rule): anvil → smith, campfire →
  cook, farmland → farmer, chest → trader. Professions reuse the existing
  offer-table barter UI with per-biome stock variations. New villager
  rigs via PixelLab — every NPC keeps its own dedicated rig (house style:
  no two NPCs share a sprite).
- **Discovery:** first time a player walks into a village's bounds: name
  toast via TrollNotis ("You found Grinhollow"), map marker, and an
  auto-added waypoint (extend `waypoints.js`). Village names are
  meme-flavored, procedurally combined — **no IRL city names** (standing
  lore rule).
- **Old-save retrofit:** on load, if the save has no `villagesPlaced`
  flag, run village siting on unexplored, unmodified terrain (skip any
  column the player has edited — the `damage`/tile-diff info and explored
  fog make this checkable), stamp them, set the flag. Old worlds get
  villages without losing builds. In co-op this runs host-side only and
  syncs via the existing snapshot/tile-edit broadcast.
- Keep the spawn Town as-is — it becomes "the capital" — and leave the
  quest-giver NPCs (Pepe Hermit etc.) in it so `QUEST_ORDER` is untouched.

*Accept when:* exploring in either direction finds a village with working
shops within a few in-game days, on both fresh and pre-update saves.

## Phase 3 — Housing 2.0: scoring, happiness, pylons

Terraria's layer: NPCs don't just exist, they have *opinions*.

- **Room scoring:** extend `checkHouse` from pass/fail to a score (size,
  light, decor tiles, wall coverage). Furnace/campfire should count as
  "comfort" alongside bed/workbench (today they don't — `housing.js:34`).
- **Happiness:** each NPC gets a preferred biome + a liked/disliked
  neighbor. Happiness scales shop prices ±20% and shows as a mood line in
  their dialog ("The Butcher hates living next to the Alchemist's smell").
- **Pylons:** a village (or player settlement) where ≥2 NPCs are happy
  unlocks a **Troll Pylon** for sale — place one per biome, right-click to
  teleport between pylons (extends the waypoint/map system into Terraria's
  fast-travel network).
- **Housing query tool:** a UI toggle that highlights valid rooms and lets
  the player assign a roster NPC to a specific house.

## Phase 4 — Kitchen depth: cooking pot + food buffs

- **Cooking pot** station (crafted at workbench; placed over a campfire):
  multi-ingredient meals — meat + berry + egg combos → named troll dishes.
- **Well Fed buff system:** cooked food grants a timed buff (minor regen +
  speed, Terraria-style) on top of hunger refill; fancier dishes = longer
  buff. This introduces a small generic timed-buff framework the Alchemist's
  brews should be migrated onto (one buff system, not two).
- More recipes from existing items only — no new farm content needed.

## Phase 5 — Fishing

Water bodies and the liquid sim already exist; Terraria's calmest loop is
missing entirely.

- Craftable **troll rod**, cast into ≥ some threshold of connected water
  cells, bobber + bite timing minigame (LMB to reel).
- Catch tables by biome/depth: fish (new food, cookable), crates
  (loot), and rare **quest fish** the Troll Chef requests daily
  (Terraria's Angler, reusing the existing quest plumbing in `quests.js`).

## Phase 6 (stretch) — Movement & logistics

- **Grapple tongue:** Terraria's grappling hook as a troll tongue — fires,
  latches to tiles, reels you in. Accessory-slot item, crafted at anvil.
- **Minecart rails:** rail tile + cart; ride accelerates on slopes. Wire
  pulses can switch junctions (plays with the existing wiring layer).

## Deferred backlog (explicitly out of scope)

Extra dimensions/portals (belongs to the meme-expansion doc), biome
spread/corruption, mounts & pets, paint/deco system, banners/trophies,
authoritative co-op netcode, infinite worlds.

---

## Hard constraints

1. Vanilla JS, Canvas 2D, ES modules. No frameworks, no build step, no deps.
2. `T` tile ids are **append-only** — never renumber (saves store raw ids).
   Same for item string ids. Old saves must always load; gate new features
   behind save-migration flags like `villagesPlaced`.
3. Everything except NPC/player rigs is drawn procedurally (`icons.js`) —
   new tiles/items need procedural icons, not image assets.
4. Every NPC gets its own dedicated PixelLab rig (no sprite sharing).
5. New interactables must work with touch controls and must not break
   co-op sync (tile changes ride the existing edit broadcast; NPCs and
   drops stay client-local like enemies).
6. Wire new stats into the weekly leaderboard config and TrollNotis where
   it makes sense (e.g. villages discovered, fish caught).
7. Meme lore only — no IRL place names; village/dish/item names follow the
   Grin Core universe tone.

## Workflow

One phase per feature branch; **merge + push each phase to main as soon as
it's playable and verified** — don't stack phases on one branch. Update
`docs/TROLLRRERIA.md` at the end of each phase. Suggested order:
1 → 2 → 4 → 3 → 5 → 6 (1 is instant QoL, 2 is the headline, 4 pays off
cooking before 3 makes NPCs opinionated, 5–6 are gravy).

## Open decisions (defaults chosen — override before starting)

1. **Villages per world:** default 2–3. More = more PixelLab villager rigs.
2. **Happiness affects prices only** (default), or also gates pylons — the
   default already gates pylons on happiness; say if that feels too strict.
3. **Fishing minigame difficulty:** timing-window default; could be
   auto-catch for touch players.
4. **Cooking pot placement rule:** must sit above a lit campfire (default,
   more Minecraft-y) vs. standalone station.
