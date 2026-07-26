# Trollrreria — 2D sandbox survival

Original Terraria-genre sandbox for the Troll Runner arcade. Vanilla JS +
Canvas 2D, ES modules, no frameworks, no build step. Launcher:
`trollrreria.html` · source: `assets/games/trollrreria/`.

## Controls
| Key | Action |
|---|---|
| A / D (or ←/→) | Move |
| Space / W | Jump (hold for higher; swim up in water) |
| S | Drop through platforms |
| LMB | Use held item — mine / place / swing / shoot |
| RMB | Interact — doors, chests, NPCs, the spawn sign |
| E | Inventory + crafting |
| M | Full map |
| Q | Toss one of the held item |
| 1–0 / wheel | Hotbar |
| Esc | Close panels → pause |
| F3 / F4 | Debug overlay / free camera |

## The loop
Chop trees → workbench → wooden tools → dig for copper/iron/silver/gold →
furnace + anvil → better gear + armor → mine troll hearts (+20 max HP, cap
200) → collect eyeball lenses from troll eyes at night → craft a **Troll
Totem** (6 lenses + 5 gold bars @ anvil) → use it at night → beat the
**Troll King** → claim the Troll Blade → **HARDMODE**: trollium erupts in
the deep (golden pick required), elite enemies stalk the night → forge
trollium gear → craft an **Emperor Sigil** (8 trollium bars + 10 bones +
4 lenses) → face the flying **Troll Emperor** → the Emperor's Edge.

## Systems
- **World**: 2400×800 tiles (older saves keep their original 1600 width —
  dims are recorded in the save and honored on load), seeded procedural
  gen — ocean/snow/forest/jungle/swamp/desert biomes with noise-wobbled
  borders, worm + noise caves, depth-tiered ore veins, surface lakes +
  edge oceans, deep lava (+obsidian shells), loot chests, glowshrooms,
  troll hearts. Feature density scales with world width.
- **Engine**: 32×32-tile chunk canvases (LRU-cached, dirty-tracked),
  flood-fill lighting recomputed per frame over the viewport (sky light by
  time of day + emissive tiles + dynamic sources), fixed 60 Hz timestep.
- **Liquids**: cellular water/lava (8 levels per cell), lava at half speed,
  water+lava → obsidian, falling sand with chain reactions.
- **Combat**: slime/walker/flyer AI families, off-screen spawner with
  depth/time tables, Troll Moon event nights, melee arcs, bows + (flaming)
  arrows, knockback, i-frames, armor defense.
- **Boss**: Troll King — hop-charge AI, kingling adds, enrage at 50% with
  troll-tear volleys, flees at dawn.
- **Persistence**: RLE+base64 world saves in localStorage
  (`trollrreria:world1`), autosave every 60 s + on unload, explored-map fog,
  minimap + full map.
- **Arcade wiring**: shared weekly leaderboard (`leaderboard.js` config —
  depth / blocks mined / boss kills), TrollNotis toasts for boss events.
- **Touch**: coarse-pointer overlay (move/jump/drop buttons, canvas
  hold-to-mine, interact/inventory/map), auto-shown on the first touch.
- **Music**: original generative chiptune — five themes (day/night/cave/
  boss/title) as chord progressions with seeded random-walk leads,
  crossfading with context; separate music volume slider.
- **Housing + NPCs**: flood-fill room validation (bounded, walled, torch +
  bed/workbench + door). Each valid house attracts the next un-housed
  NPC on the roster: **Merchant Troll** → **Troll Chef** (ranch-goods
  shop) → **Troll Historian** (lore). Troll cots set your spawn, and
  sleeping in one at night (with no threats nearby) skips straight to
  morning and tops up your HP.
- **Stations**: workbench/furnace/anvil/campfire are right-clickable —
  opens the crafting panel straight to that station's recipes instead of
  requiring the player to already know "stand near it and press E." A HUD
  chip row shows which stations are in range even with the panel closed,
  and hovering any interactable tile in reach (stations, doors, chests,
  beds) shows an "RMB" hint.
- **Villages**: one procedurally sited village per snow/desert/jungle
  biome band (`src/villages.js`), each with four houses — Smith, Cook,
  Trader, Farmer — around a campfire plaza and public loot chest, built
  from the same house-stamper the spawn Town uses. A villager's
  profession comes from the decor tile in their house (anvil/campfire/
  chest). Villages get meme-flavored procedural names and flash a
  discovery toast the first time you wander into one. Deterministic from
  the world seed, so saves from before this shipped get one retrofitted
  in on load.
- **Economy**: hostile kills drop **Troll Coins** (HP-scaled, elites ×2,
  bosses drop purses). Coins are a normal item that appears on both
  sides of shop offer tables — buy rows and sell rows render through
  the same barter UI. Ranch animals drop no coins.
- **Equipment**: 3 armor slots + 3 accessory slots (ring/back/feet) —
  Troll Wings (extra jump + glide), Dash Boots (double-tap dash), Spring
  Boots, speed/regen/defense rings and capes. Crafted at the anvil.
- **Ranching**: feed a boar (berry) or hen (glowshroom) to tame it; feed
  two tamed adults near each other to breed a baby that grows up. Tamed
  hens lay eggs (→ omelettes at a campfire). Fences pen them in, and
  tamed animals persist in the save.
- **World events**: Troll Moon nights (tougher spawn tables), dawn
  meteor strikes (crater + Meteorite ore → Starforge Blade), and a
  Traveling Trader who camps for a day with 4 rotating rare offers.
- **Survival**: a hunger bar drains over time (faster while sprinting) and
  starves you once empty — passive regen needs a fed troll. Passive
  animals (troll boars/hens) roam the surface by day, drop raw meat, and
  never fight back. A **Campfire** (wood + stone, no gate) cooks raw meat
  into a safer, bigger hunger refill; eating it raw risks a queasy HP hit.
  **Farmland** (tilled from dirt) grows planted seeds — pulled from wild
  surface grass — into troll berries over two timed stages.
- **Trollrreria Town**: four specialist barter NPCs camped near spawn —
  Blacksmith (ore → bars/gear), Alchemist (Troll Brew), Tavern Keeper
  (cooked food), Butcher (meat, raw and cooked). Same offer-table system
  as the Merchant Troll (item barter + Troll Coin rows), each with its
  own offer table. A static
  **weathered sign** (not a walking NPC) stands in for the old Guide
  Troll — right-click it for onboarding tips and the Lost Grin questline.
- **Wiring**: wrench + wire layer, levers, pressure plates, dart traps;
  pulses toggle torches/doors and fire traps. Wires visible while
  holding the wrench. Timing devices: **Repeaters** (directional 0.5s
  pulse delay), **Timer Torches** (pulse once to start a self-repulsing
  3s clock, again to stop it), **Trapdoors** (pulse open, auto-slam).
- **Hardmode**: post-King trollium tier, elite enemy variants (1.8× HP,
  aura, double drops), and the Troll Emperor (hover/telegraph/dash AI,
  radial tear rings, enrage).
- **Co-op (v1)**: host/join with a 5-char room code from the title
  screen. Supabase Realtime online (BroadcastChannel fallback between
  tabs). Syncs: exact world snapshot on join (chunked, dims included),
  live tile/wall/wire edits, chests, host clock + hardmode/PvP flags,
  player ghosts. **Local per player**: enemies, bosses, drops, liquid
  settling — each troll fights their own monsters. Guests never
  overwrite their own save.
- **PvP (opt-in)**: host presses P to flip it for the room (rides the
  time broadcast, shown in the HUD badge). Melee swings sweep peer
  ghosts and broadcast hits the target applies to itself — trust-based
  like the rest of the mesh. Arrows stay PvE.

## Art
Player = Troll Kombat gladiator rig (`fighters/gladiator/anims/*.png`),
feet-anchored strips, 136 px cells. Every town/quest NPC has its own
dedicated PixelLab rig at 132 px cells (Blacksmith, Alchemist, Tavern
Keeper, Butcher, Whale Oracle, Rocket Tinkerer), plus Doge and Pepe —
no two NPCs share a sprite. Troll King = `fighters/troll.png` + drawn
crown. Everything else (tiles, items, enemies) is drawn procedurally at
boot — no image assets.

## Deliberately out of scope (for now)
Authoritative server netcode (co-op and PvP are trust-based shared-world
sync), synced enemies/bosses in co-op, biome spread/corruption, and
infinite chunk-streamed worlds (worlds are bounded grids; width is a
save-recorded parameter instead). The leaderboard uses the engine's mock
rivals; only "you" is real (same as other games).
