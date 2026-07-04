# TrollTerra — 2D sandbox survival

Original Terraria-genre sandbox for the Troll Runner arcade. Vanilla JS +
Canvas 2D, ES modules, no frameworks, no build step. Launcher:
`trollterra.html` · source: `assets/games/trollterra/`.

## Controls
| Key | Action |
|---|---|
| A / D (or ←/→) | Move |
| Space / W | Jump (hold for higher; swim up in water) |
| S | Drop through platforms |
| LMB | Use held item — mine / place / swing / shoot |
| RMB | Interact — doors, chests, Guide Troll |
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
**Troll King** → claim the Troll Blade.

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
  (`trollterra:world1`), autosave every 60 s + on unload, explored-map fog,
  minimap + full map.
- **Arcade wiring**: shared weekly leaderboard (`leaderboard.js` config —
  depth / blocks mined / boss kills), TrollNotis toasts for boss events.

## Art
Player = Troll Kombat gladiator rig (`fighters/gladiator/anims/*.png`),
feet-anchored strips, 136 px cells. Guide Troll = same rig hue-rotated.
Troll King = `fighters/troll.png` + drawn crown. Everything else (tiles,
items, enemies) is drawn procedurally at boot — no image assets.

## Deliberately out of scope (for now)
Networked multiplayer, touch controls, wiring (logic circuits), NPC
housing checks, events beyond the Troll Moon, music. The leaderboard uses
the engine's mock rivals; only "you" is real (same as other games).
