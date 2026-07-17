# Bridge Patrol — Tower Defense (game 006)

**Status: phases 1–4 COMPLETE on branch bridge-patrol-phase1 (2026-07-16/17).**
Decisions locked: top-down perspective, single endless mode, name
"Bridge Patrol" (the toll-paying theme stays — Toll Coins, toll chest,
Toll Booth tower). Game number moved 005 → 006 after Papa Troll's
Pizzeria shipped as 005. Verified by tools/bridge-patrol-smoke.js
(27 checks incl. a 12-wave autopilot campaign).

Real PixelLab art is wired in with graceful emoji/procedural fallback
for anything not yet generated: all 6 towers (3 tiers each, states of
the Trollface Runner v3 base), 8 of 9 enemies (Normie, Jogger, Chad,
Karen, Wojak, Crypto Bro, The Manager, The Landlord — Giga Chad stays
on emoji since its generated state came back in the wrong "side" view
and wasn't worth a costly regenerate), a Wang-autotiled dirt/grass
tileset for the ground, plus bridge/chest/stump props. Leaderboard,
TrollNotis, hub card (Defense category), and fs-launcher are wired
per the arcade-standard pattern. Remaining: phase 5 (balance pass,
mobile touch verification, final polish).

## Pitch
You are the bridge troll. Waves of normies march toward your bridge trying to
cross without paying. Place troll towers along the path to bonk, spit at, and
shake down every last one of them. Anyone who makes it across raids your toll
chest — when the chest hits zero, the run is over. Endless scaling waves make
it a natural fit for the weekly leaderboard.

Tagline on the hub card: **"Pay the toll. Or else. 🧌"**

## Why this game
- Most on-brand concept available: trolls literally live under bridges.
- Fills the tower-defense slot — no overlap with Dash/Metro (runners),
  Kombat (fighter), Trollrreria (sandbox), Casino (gambling).
- Naturally leaderboard-friendly: highest wave reached + total tolls collected.
- Sessions are 5–20 minutes — good daily-play loop between the bigger games.

## Core loop
1. **Build phase** — see a preview of the incoming wave, spend Toll Coins to
   place or upgrade towers on build plots beside the path.
2. **Wave phase** — normies walk the path; towers auto-attack. Each kill drops
   Toll Coins. Enemies that reach the bridge exit steal coins from the chest.
3. **Payout** — wave-clear bonus, then back to build phase.
4. Boss wave every 10 waves. After wave 30 the waves scale endlessly
   (HP/speed multipliers) for leaderboard chasing.

Run ends when the toll chest is empty. Game-over screen shows wave reached,
tolls collected, and leaderboard placement.

## Perspective & map
**Top-down, single map for v1**: a winding dirt path through a mossy forest
(matches the main-site mossy forest palette) that crosses a ravine over a
wooden bridge — the bridge is the exit the normies are trying to reach. The
troll's chest sits at the bridge mouth. Fixed path (no maze-building) keeps
v1 simple; build plots are hand-placed beside the path.

Second map ("Grin Chasm" — deeper, lava-lit, harder) is a v2 stretch goal.
No IRL city names anywhere, per the Trollrreria expansion rule.

## Towers (all trollface-style, PixelLab-generated)
| Tower | Role | Notes |
|---|---|---|
| Club Troll | Cheap melee bonker | Starter tower, short range, solid DPS |
| Spit Troll | Ranged single-target | Arcs spitballs, medium range |
| Cold Shoulder Troll | Slower | Ignores enemies so hard they slow down (AoE slow aura) |
| Meme Cannon | AoE splash | Launches giant trollface heads, long cooldown |
| Toll Booth | Economy | No damage; every enemy that walks past pays extra coins |
| Bridge Guard | Blocker/tank | Placed ON the path; taunts and holds a segment until it breaks |

Each tower has 3 upgrade tiers with visible art changes (bigger club, gold
booth, etc.). Six towers × 3 tiers is the v1 roster — enough for real
strategy without ballooning the art budget.

## Enemies (the normie invasion)
| Enemy | Gimmick |
|---|---|
| Normie Walker | Baseline stats |
| Jogger NPC | Fast, fragile |
| Chad | Slow, very tanky |
| Karen | Support — periodically "calls the manager," briefly stunning the nearest tower |
| Wojak Horde | Swarm — spawns in packs of 8, individually weak |
| Crypto Bro | Carries extra coins (bonus drop) but sprints erratically |

**Bosses** (every 10th wave): **The Manager** (Karen's final form, disables
towers in a moving aura), **Giga Chad** (massive HP, knocks Bridge Guards off
the path), **The Landlord** (endless-mode recurring boss; steals double toll).

## Controls
Mouse/touch only: tap a build plot → radial build menu → tap tower to place.
Tap a placed tower → upgrade/sell panel. Wave-start button + 2× speed toggle.
Fully playable on mobile; no keyboard required.

## Tech plan
- `bridge-patrol.html` at repo root (slim shell) + assets under
  `assets/games/bridge-patrol/` (styles.css, game.js) — same pattern as
  Trollrreria. Vanilla JS + canvas, no frameworks.
- Fixed waypoint path (no runtime pathfinding needed for v1).
- Deterministic wave tables in a plain data array so balancing is easy to tweak.
- Integrations, same as the other games:
  - `troll-leaderboard.js` — weekly ladder entry; per-game stats:
    `{wave, tolls, bossesSlain}`. Prizes stay DISPLAY-ONLY, `live=false`.
  - TrollNotis toasts — wave cleared, boss incoming, leaderboard placement.
  - Hub card in `index.html` with `data-fs="Bridge Patrol"` for the
    fullscreen launcher; new key art thumbnail.
- Future hook (not in v1): "Bribe the Reaper" paid continue via TrollPay,
  following the pay→confirm→revive→countdown flow used by Dash. v1 ships with
  one free continue per run instead.

## Art plan (PixelLab)
- 1 top-down tileset: mossy forest ground, dirt path, ravine edge, wooden
  bridge planks, water/chasm.
- 6 tower trolls × 3 tiers, idle + attack animations. Must read as the
  classic trollface — same bar as the Kombat fighters.
- 6 enemies + 3 bosses with walk (and boss ability) animations.
- UI kit: Toll Coin icon, wave banner, radial build menu, chest health bar.
- 1 piece of hub key art (troll under bridge, normie mob approaching).

## Build phases
1. **Core sim** — path, waves, 3 towers (Club Troll, Spit Troll, Cold
   Shoulder Troll), coins, chest, game over. Placeholder art.
2. **Full roster** — all 6 towers + tiers, 6 enemies, 3 bosses, endless scaling.
3. **Art & audio pass** — PixelLab assets in, music + SFX.
4. **Integration** — leaderboard, TrollNotis, hub card, fullscreen launcher.
5. **Polish** — mobile touch pass, balance tuning, juice (coin bursts, screen
   shake, boss intro banners).
