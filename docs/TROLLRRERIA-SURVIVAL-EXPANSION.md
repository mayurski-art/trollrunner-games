# Trollrreria — Survival Expansion

Status: **built** (all 5 phases). Written to scope a large ask before
touching code, per usual practice on big builds; kept here as the map of
what shipped and where.

## Why phased
This request bundles six systems. Shipping them as one PR would be hard to
review and hard to roll back if one part misbehaves. Each phase below is
independently playable and buildable on its own branch.

---

## Phase 1 — Hunger, animals, cooking (the core ask)
- **Hunger stat**: new `player.hunger` (0–100), alongside existing `hp`/`maxHp`
  (`src/player.js:31`). Drains slowly over time, faster while sprinting/mining/
  swimming. At 0, hp starts draining on a tick — **can starve to death**
  (per your answer), same as Minecraft Normal/Hard.
- **Animals**: new passive `Animal` class parallel to `Enemy`
  (`src/entities.js:163`), same AI-switch pattern but with a `flee` behavior
  instead of attack. 2–3 types (e.g. troll-boar, troll-hen) spawn in daylight
  on grass biomes, wander, run from the player, die in a couple hits, drop
  raw meat (`drops` array, same mechanic enemies already use).
- **Cooking station**: new `CAMPFIRE` tile, craftable from wood + stone with
  **no gate** (matches your "craftable immediately" answer) — separate from
  the existing `WORKBENCH`/`FURNACE`/`ANVIL` stations. Standing near it lets
  you cook raw meat → cooked meat (restores more hunger, raw meat restores
  less and has a small chance of an "upset stomach" debuff, MC-style).
  Recipes reuse the existing `craft()`/`canCraft()` system (`src/inventory.js:79`).
- **HUD**: hunger bar mirrors the existing heart-icon pattern
  (`paintHearts()`, `src/ui.js:969`) — icons draining left to right, sitting
  under the heart row.
- **Eating**: right-click a food item in the hotbar to consume it and restore
  hunger (+ a small hp tick, like MC's saturation).

## Phase 2 — Farming
- Hoe tool (new craftable), tills grass/dirt into farmland.
- Seeds drop from tall grass (already decorative in worldgen) or from
  animals. Crops advance through 3–4 growth stages on a timer, harvest for
  more food than raw meat but slower to acquire — a renewable alternative to
  hunting.

## Phase 3 — Tool tiers
- Already exists in spirit: wood → copper → iron → silver → gold → trollium
  progression is in the current design (`docs/TROLLRRERIA.md:23-30`). No new
  system needed here — just confirming this stays as-is rather than adding a
  second parallel tier system.

## Phase 4 — Sleep / skip night
- The `BED` tile already exists and sets spawn (`src/defs.js:68`). Add a
  "sleep" interaction: right-click a bed at night with no enemies nearby
  fast-forwards the clock to morning, same gate Minecraft uses (monsters
  nearby block sleep).

## Phase 5 — Trollrreria Town (biggest item)
- The game already has a barter-shop NPC framework: `TownNPC`/`MerchantTroll`
  (`src/npc.js:54`, `:198`) and a housing validator (`src/housing.js`) that
  recognizes valid rooms (walled, torch, bed/workbench, door).
- Plan: extend this into a proper town with **one shop-flavored NPC per
  role** — Blacksmith (tool/armor upgrades), Alchemist (potions/brews),
  Tavern Keeper (cooked food, buffs), Butcher (sells raw/cooked meat, buys
  your surplus). Each reuses the existing `shop`/`openShop` UI
  (`src/main.js:935`) with its own offer list — no new UI system needed.
- Art: reuse existing Troll Kombat rigs with hue-tints, same trick already
  used for Guide/Whale Oracle/Rocket Tinkerer, to avoid burning PixelLab
  budget (per your standing "minimize generations" preference).
- Open question: fixed pre-built town near spawn (like the current Guide's
  spawn area) vs. a player-built town that "activates" once enough valid
  houses cluster together. Recommend fixed town first — simpler, guaranteed
  discoverable — with player-built expansion as a stretch goal.

---

## Suggested build order
Phase 1 → 4 → 2 → 5, with Phase 3 needing no work. Phase 1 stands alone and
delivers the original ask; each later phase layers on without touching
earlier ones.
