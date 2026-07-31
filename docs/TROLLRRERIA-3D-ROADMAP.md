# Trollrreria 3D — Locked Roadmap

Baseline: `trollrreria-3d-work` branch (22 commits ahead of `main`, pushed to
origin), current head `d806243` — true infinite chunk streaming, hand-placed
"home region" (radius 130 around 0,0) with one village/outpost/dungeon/vault
each, `FOREST`/`DESERT`/`SNOW` biomes, no water, billboard-sprite mobs,
partial (position + block-edit) realtime co-op via Supabase, localStorage-only
saves.

Order is locked. Each phase ships and merges to `main` before the next
starts, per [[feedback-merge-phases-to-main]]. Don't start a phase's code
until this doc's entry for it is confirmed — the point of listing details
now is so later phases don't get relitigated mid-build.

---

## Phase 1 — Region-based settlements (procedural, not just home region)

**Problem being solved:** everything past the home region (radius 130) is
empty procedural terrain. Streaming makes the world infinite; it doesn't
make it interesting.

**Approach:** generalize the pattern already used for the home region
(`generateHomeRegion` in `World.js`, plus `Village.js` / `Dungeon.js` /
`Vault.js`) into a deterministic, seed-based placement function that runs
per-chunk during `streamChunks`, not just once at origin.

- Add a low-frequency placement noise/hash keyed on chunk coords (reuse
  `noise.js`) that decides, per chunk-region cell (e.g. every ~8x8 chunks),
  whether a settlement spawns and which template.
- Structure placement must be **fully deterministic from world seed +
  coords** — no runtime RNG — so the same world always generates the same
  settlement in the same spot, which is required for multiplayer (co-op
  players must see the same structures without syncing them over the wire)
  and for save/reload consistency.
- Reuse `Village.js`, `Dungeon.js`, `Vault.js` as-is for now; they're
  already template generators, just currently invoked once. Phase 4
  (structure variety) is where new templates get added — phase 1 is purely
  "make the existing templates spawn repeatedly across the infinite world."
- Density target: rare enough that finding one feels like an event, not
  wallpaper. Rough target: one settlement roughly every 3-5 minutes of
  walking at normal speed. Tune after playtesting rather than guessing a
  final number now.
- Villagers (`villagers.js`, `trades.js`) and quests (`QuestManager.js`,
  `quests.js`) currently assume the single home-region village — audit
  whether they're keyed by a village ID/position already or hardcoded to
  one instance; if hardcoded, generalize to support N villages.

**Explicitly out of scope for phase 1:** new structure types (phase 4),
water-adjacent placement logic like beaches/harbors (depends on phase 3),
world events tied to structures (phase 5).

---

## Phase 2 — Greedy meshing / performance

**Problem being solved:** every future phase (more structures, more mobs,
bigger draw distance) is gated by how expensive chunk meshing currently is.
Doing this second (not first) is deliberate — settlements are shippable
without it, and profiling after phase 1 will show real hotspots instead of
guessed ones.

- Current mesh generation (in `Chunk.js`) is presumably per-face-per-block;
  confirm this by reading the mesh-build path before assuming.
  Greedy meshing merges adjacent same-block-type, same-facing quads into
  single larger quads — this is the standard voxel-engine win and should
  cut triangle count by 10-50x on flat/solid regions.
  - Also good practice: replace hardcoded voxel arrays with typed arrays and use for-loops over map/filter for chunk generation.
- Secondary target: `CHUNK_LOAD_RADIUS` / `MAX_NEW_CHUNKS_PER_TICK` are
  currently tuned for the pre-meshing-optimization cost. Re-tune upward
  once meshing is cheaper — this is the payoff that lets phase 1's denser
  settlement world stay smooth.
- Measure before/after with a fixed benchmark (same seed, same flythrough
  path, frame time logged) so the win is provable, not just felt.

**Explicitly out of scope:** LOD / mesh simplification at distance, web
worker offloading — only pursue these if greedy meshing alone doesn't hit
target frame times.

---

## Phase 3 — Water

**Problem being solved:** `blocks.js` has no WATER block id at all; terrain
generation (`_generateChunkTerrain` in `World.js`) has no concept of sea
level. This is a generation-layer feature, not just a new block type.

- Add a `WATER` block id to `blocks.js`. Non-mineable, non-solid for
  movement (swim/wade), but blocks line-of-sight/particle differently —
  check how `MINEABLE`/`PLACEABLE` arrays gate this and add a third
  category if needed rather than overloading existing ones.
- Introduce a sea-level constant in terrain generation: any generated
  column below sea level and above the height-noise surface fills with
  water instead of air. This is the same noise pass already producing
  biome height, so it's an addition to `_generateChunkTerrain`, not a new
  pass.
- Visual: simple flat semi-transparent plane/blocks at v1 — do not build
  wave shaders or flow simulation now. Static water is explicitly enough
  per the pasted roadmap's own framing ("even static water adds beaches,
  lakes, rivers...").
- Biome interaction: coastlines should bias toward `FOREST`-adjacent sand
  beaches; this is a natural place to introduce a `BEACH`/sand transition
  band, but keep it minimal (a block-type swap in the existing biome
  logic, not a fourth full biome).
- Settlement placement (phase 1) should be revisited after this ships —
  coastal village variants become possible, but that's a phase-4 follow-up,
  not something to retrofit into phase 1's initial version.

---

## Phase 4 — Procedural structure variety

Expand the template pool beyond the current village/outpost/dungeon/vault
set, using the deterministic per-region placement machinery from phase 1.

- New templates as data + light procedural assembly (same pattern as
  `Village.js`), not one-off hardcoded structures: snowy village (SNOW
  biome), desert camp (DESERT biome), a fortress/ruin variant, a
  mushroom/giant-tree structure for FOREST.
- Biome-gate templates so structure type correlates with biome — this is
  what makes exploration feel varied rather than same-village-different-
  coords.
- Reuse `Dungeon.js`/`Vault.js` scaffolding for any new "delve" structures
  rather than writing new dungeon-generation code from scratch.

---

## Phase 5 — Dynamic world events

Time-based or trigger-based events layered on top of the now-populated
world, using `Spawner.js`'s existing timed-spawn pattern as the mechanical
base.

- Start with 2-3 events, not the full brainstormed list: a "blood moon"
  (spawn-rate + mob-strength multiplier for a night cycle, reusing
  `EnemyTypes.js` hardmode-style scaling already built for hardmode mode),
  a traveling merchant (reuse `villagers.js`/`trades.js` trade UI, just a
  mobile spawn instead of settlement-bound), and a meteor/dungeon-seed
  event (spawns a small one-off `Dungeon.js` structure near the player).
- Events should be locally-simulated per player in co-op for now (each
  player's own event timer), consistent with the existing "enemies not
  synced" tradeoff in `Net.js` — full shared-event sync is a
  phase-10-multiplayer concern, not phase 5.

---

## Phase 6 — Combat overhaul

- Extend `EnemyTypes.js`/`Enemy.js` and player combat with: dodge/roll,
  block/shield, a ranged weapon (bow), and 1-2 status effects (burn from
  lava-adjacent, freeze from SNOW biome mobs).
- Gate on `WEAPON_STATS`/`ARMOR_STATS` in `blocks.js` already having
  tiered gear — this phase is about moves/verbs, not new gear tiers.

---

## Phase 7 — World seeds / modifiers

High replay value for low content cost, per the pasted roadmap's own
framing — cheap enough to slot in without a bloated content phase.

- World seed is presumably already an input to `noise.js`/`World.js`
  given deterministic generation is required by phase 1 anyway — confirm,
  then add named "modifier" presets that scale existing noise parameters
  (e.g. "Giant World" = amplitude multiplier, "Tiny Islands" = shrink
  landmass threshold, "Endless Winter" = force SNOW biome weight to 100%).
- No new systems required — this is parameter presets over generation
  code that phases 1-4 will have already built out.

---

## Phase 8 — Building expansion (stairs, slabs, decorative blocks)

- Additive to `blocks.js` + placement logic. Low risk, low design
  ambiguity — sequenced late because it's polish, not because it's hard.

---

**Follow-up (not yet scheduled):** true stairs/slabs. Shipped decorative
full-cube variants instead (Polished Stone, Carved Plank, Roof Tile, Glass
Block) — partial-height geometry needs matching changes to both the
greedy mesher (phase 2, currently full-cell-only) and Player.js's AABB
collision (also full-cell-only), not just a new block id.

## Phase 9 — Cloud saves

Currently `Save.js` is localStorage-only (RLE-encoded chunks, base64,
`tr3-save-v1` key). This phase ports that to the same Supabase project
already used for realtime co-op (`Net.js`), so a save survives a lost
browser/device.

- Reuse the existing RLE + base64 chunk encoding — the wire format doesn't
  need to change, only the storage backend (Supabase table instead of/in
  addition to localStorage).
- Sequenced after combat/structures/seeds so the save schema is stable
  before it needs to survive across devices — changing chunk/block data
  shape after cloud saves exist means writing a migration.

---

## Phase 10 — Persistent multiplayer

Current `Net.js` already does realtime position sync + block-edit sync
(SupabaseTransport / BroadcastTransport fallback) but is explicitly
session-based (host sends full snapshot to joiner on hello) with mobs
deliberately unsynced. "Persistent" means: worlds survive between
sessions and are rejoinable, not real-time sync improvements (that already
works).

- Depends on phase 9 (cloud saves) — a persistent multiplayer world is a
  cloud save with multiple writers, so the storage layer needs to exist
  first.
- **Resolved when this phase actually started:** the room code IS the
  persistent world's identity — Net.js auto-saves the host's world to
  CloudSave.js under the room code every 60s and once more on stop().
  Resuming later is just loading that same code from the (phase 9) Cloud
  Save screen before hosting again. No separate schema, no auto-load-on-
  host (that would silently overwrite whatever the host is currently
  playing the moment they open a room — an explicit load is the safer
  default). This answers "shared vs per-player world" as "one world per
  room code, shared by whoever hosts+joins it."

---

## Phase 11 — 3D characters

**Evaluated when this phase started; no change made.** Confirmed mobs still
render as PixelLab billboard sprites (`Enemy.js` via `SpriteTextures.js`)
and this is a deliberate style choice, not a placeholder, per
[[feedback-sprites-must-match-trollface-style]]. The roadmap's own
condition for touching this — "only if billboard sprites become a
demonstrated problem" — was never met during phases 1-10 (no readability
or gameplay complaint surfaced), and a real 3D character conversion needs
actual rigged 3D assets that don't exist for this game, not just an engine
change. Revisit only if a concrete problem shows up in play, not on
aesthetic grounds alone.

---

## Sequencing rationale (why this order and not another)

1-2: make the world worth exploring and able to run smoothly while doing
so — both are prerequisites for everything else landing well.
3-4: water and structure variety compound with phase 1's placement system
that already exists by then — sequencing them right after avoids
retrofitting placement logic twice.
5-6: events and combat need a populated world (1-4) to have stakes.
7: seeds are cheap and slot in anywhere once generation is stable; placed
here because generation code is most fully-baked by this point.
8: pure polish, no dependencies — could technically move anywhere, kept
late so it doesn't distract from higher-leverage phases.
9-10: cloud saves before persistent multiplayer because persistent
multiplayer *is* multi-writer cloud save.
11: last because it's the highest-cost, lowest-certainty item, and the
current billboard style already works.
