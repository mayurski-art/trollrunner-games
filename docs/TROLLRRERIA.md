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
- **World**: 1600×800 tiles, seeded procedural gen — snow/forest/desert
  biomes, worm + noise caves, depth-tiered ore veins, surface lakes, deep
  lava (+obsidian shells), loot chests, glowshrooms, troll hearts.
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
  bed/workbench + door). A valid house attracts the **Merchant Troll**
  (barter shop, 7 offers, no currency). Troll cots set your spawn, and
  sleeping in one at night (with no threats nearby) skips straight to
  morning and tops up your HP.
- **Survival**: a hunger bar drains over time (faster while sprinting) and
  starves you once empty — passive regen needs a fed troll. Passive
  animals (troll boars/hens) roam the surface by day, drop raw meat, and
  never fight back. A **Campfire** (wood + stone, no gate) cooks raw meat
  into a safer, bigger hunger refill; eating it raw risks a queasy HP hit.
  **Farmland** (tilled from dirt) grows planted seeds — pulled from wild
  surface grass — into troll berries over two timed stages.
- **Trollrreria Town**: four specialist barter NPCs camped near spawn —
  Blacksmith (ore → bars/gear), Alchemist (Troll Brew), Tavern Keeper
  (cooked food), Butcher (meat, raw and cooked). Same no-currency barter
  system as the Merchant Troll, each with its own offer table. A static
  **weathered sign** (not a walking NPC) stands in for the old Guide
  Troll — right-click it for onboarding tips and the Lost Grin questline.
- **Wiring**: wrench + wire layer, levers, pressure plates, dart traps;
  pulses toggle torches/doors and fire traps. Wires visible while
  holding the wrench.
- **Hardmode**: post-King trollium tier, elite enemy variants (1.8× HP,
  aura, double drops), and the Troll Emperor (hover/telegraph/dash AI,
  radial tear rings, enrage).
- **Co-op (v1)**: host/join with a 5-char room code from the title
  screen. Supabase Realtime online (BroadcastChannel fallback between
  tabs). Syncs: exact world snapshot on join (chunked), live tile/wall/
  wire edits, chests, host clock + hardmode flag, player ghosts.
  **Local per player**: enemies, bosses, drops, liquid settling — each
  troll fights their own monsters. Guests never overwrite their own save.

## Art
Player = Troll Kombat gladiator rig (`fighters/gladiator/anims/*.png`),
feet-anchored strips, 136 px cells. Every town/quest NPC has its own
dedicated PixelLab rig at 132 px cells (Blacksmith, Alchemist, Tavern
Keeper, Butcher, Whale Oracle, Rocket Tinkerer), plus Doge and Pepe —
no two NPCs share a sprite. Troll King = `fighters/troll.png` + drawn
crown. Everything else (tiles, items, enemies) is drawn procedurally at
boot — no image assets.

## Deliberately out of scope (for now)
Authoritative server netcode (co-op is trust-based shared-world sync),
synced enemies/bosses in co-op, PvP, events beyond the Troll Moon, and
biome spread. The leaderboard uses the engine's mock rivals; only "you"
is real (same as other games).
