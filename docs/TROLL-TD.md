# Troll TD (game 011) — Design Doc

**Status: APPROVED 2026-08-03 — all 4 decisions locked (see bottom).
Ready to build (implementation in a Sonnet session).**

## Pitch
The flagship tower defense of the TrollRunner arcade: a premium, BTD6-scale
TD where the **Troll Defense Corps** — an army of trollface warriors —
defends **Troll Island** from endless waves of invading NPCs. Bridge Patrol
(game 006) stays as the quick 5–20 minute endless TD; Troll TD is the deep
one: multiple maps, upgrade paths, a large tower roster, and a proper
campaign.

Hub card tagline: **"The Corps always delivers. 🧌"** (Defense category)

## Relationship to Bridge Patrol
- Different scale, different fantasy: BP is "one troll under one bridge";
  Troll TD is "an army defends the island."
- No shared code beyond arcade-standard libs (leaderboard.js, TrollNotis,
  fs-launcher). BP is untouched.
- Cross-promo later: BP game-over screen can advertise Troll TD and vice
  versa.

## Core loop (BTD6-style)
1. Pick a map + difficulty → start with base cash.
2. Between rounds: place/upgrade/sell Corps units on build spots beside a
   fixed enemy path. Set targeting priority (first/last/strong/close).
3. Press GO → a scripted round of NPC waves marches the path; units
   auto-attack; kills pay cash; leaks cost lives.
4. Survive the map's final round to win (campaign star) → optional
   **Freeplay** endless scaling for the weekly leaderboard.
5. Lose all lives → game over screen: round reached, pops, leaderboard rank.

## The Corps — tower roster (v1: 12 units + 1 hero)
Literal names (locked by Decision 2); each unit maps 1:1 to a master art
prompt from the concept sheet (kept verbatim in
`docs/art/troll-td-prompts.md` during the build).

| Unit | Name | Role |
|---|---|---|
| 1 | **Basic Troll Thrower** | Cheap fast starter, single-target sharpened meme cards |
| 2 | **Sticky Troll** | Slows with glue-cannon goo, no damage |
| 3 | **Sniper Troll** | Long-range marksman, hits anywhere on screen |
| 4 | **Explosives Troll** | AoE explosions, can't pop certain armored types until upgraded |
| 5 | **Hacker Troll** | Cyber energy attacks, chains between enemies |
| 6 | **Ninja Troll** | Very fast throwing attacks, sees camo/stealth NPCs |
| 7 | **Ice Troll** | Freezes groups in place briefly |
| 8 | **Fire Troll** | Burn DoT + melts frozen/armored |
| 9 | **Medic Troll** | Support: buffs range/speed of nearby units, heals lives on upgrade |
| 10 | **Gold Troll** | Economy: generates cash each round |
| 11 | **Mechanic Troll** | Builds drones + auto-sentries near itself |
| 12 | **Laser Troll** | Late-game powerhouse, laser beams, very expensive |
| Hero | **Boss Troll** | One-per-map hero, levels up during the match, activatable ability |

### Upgrades
**2 paths × 3 tiers per unit** (24 upgrade art states + 12 bases = 36 tower
sprites; BTD6's 3×5 would be 180+ and is out of scope for v1). Choosing a
tier-2 upgrade in one path locks the other path at tier 1, so builds matter.
Every tier has a visible art change (bigger weapon, glow, gold trim).

## Enemies — the NPC invasion
Bloon-equivalent graded swarm, no IRL names (Trollrreria rule applies):

- **Gray NPC** → **Blue** → **Green** → **Yellow** → **Red**: speed/HP ladder;
  higher grades spawn lower grades when popped (bloon-style layering).
- **Camo Lurker** — invisible to most units (Ninja Troll + upgrades see it).
- **Armored Bot** — immune to sharp attacks (needs explosive/energy/fire).
- **Regen Karen** — regrows grades over time.
- **Blimp-class**: **The Algorithm** (MOAB equivalent, spawns swarms when
  destroyed) and **The Main Character** (BFB equivalent, campaign finale
  boss).

## Maps (v1: 3, all on Troll Island)
1. **Grin Beach** — easy; long S-curve shoreline path, wide open spots.
2. **Meme Jungle** — medium; two paths that merge, line-of-sight blockers.
3. **Mount Kek** — hard; short spiral volcano path, few build spots.

Each map: Easy/Medium/Hard difficulty (rounds 40/60/80 to win) + Freeplay
endless after victory. Single fixed path(s) per map, hand-placed build spots
(same approach that worked in Bridge Patrol — no maze building).

## Meta / arcade-standard wiring
- **Leaderboard**: leaderboard.js weekly ladder; stat = furthest Freeplay
  round (per map, hardest counts) + total pops. Prizes display-only.
- **TrollNotis** toasts, **fs-launcher**, hub card in games.html (Defense).
- **Accounts**: optional login → XP per round survived, campaign stars saved
  to profile; guests keep localStorage progress.
- **No real money** anywhere in v1 (revive/credit packs remain future work).

## Tech
- Follows the repo pattern: `troll-td.html` self-contained page in
  trollrunner-games, canvas 2D renderer, vanilla JS, requestAnimationFrame
  fixed-timestep sim. No new dependencies.
- Sprite assets under `assets/games/troll-td/`; every unit renders with a
  procedural/emoji fallback until its real art lands (Bridge Patrol
  pattern), so the game is playable end-to-end before any art exists.
- Mobile: touch place/drag, pinch zoom on larger maps, rotate-to-landscape
  hint (reuse BP's).
- Smoke test: `tools/troll-td-smoke.js` autopilot (place-build-run N
  rounds, assert economy/pathing/upgrade/boss mechanics), Bridge Patrol
  style.

## Art pipeline (Decision 3: external hi-res gen)
The master prompts are written for a **high-res illustration generator**
(2048×2048, vector-like, gradients) — not PixelLab's pixel-art style. The
user generates unit art externally with the concept-sheet prompts
(Grok/ChatGPT image gen etc.) and drops PNGs into
`assets/games/troll-td/src/`; a build-side script trims/scales them into
game sprites. In-game animation is done with transform tweens (recoil, bob,
muzzle flash, particles) on the static art — no skeletal rigging in v1.
Procedural fallback keeps every phase shippable without art.

## Phases (merge + push each to main immediately when done)
- **Phase 1 — Core sim**: Grin Beach map, pathing, round scripting, cash/
  lives, 3 units (Basic Troll Thrower, Sticky Troll, Explosives Troll),
  place/sell/targeting UI, win/lose. Playable with placeholder art.
- **Phase 2 — Full roster + upgrades**: all 12 units + upgrade path system
  (2×3), Medic Troll buffs, Gold Troll economy, Mechanic Troll
  sub-entities.
- **Phase 3 — Enemy depth + maps**: full NPC ladder, camo/armored/regen,
  blimps, Meme Jungle + Mount Kek, difficulties, Freeplay scaling.
- **Phase 4 — Hero + meta**: Boss Troll hero leveling/ability, leaderboard,
  TrollNotis, accounts XP, hub card, mobile/touch pass.
- **Phase 5 — Art + juice**: real art integration, particles, screen shake,
  SFX/music, polish; smoke test hardening + balance pass.

## Decisions — LOCKED 2026-08-03
1. **Game slot**: standalone game 011, titled **Troll TD**. Bridge Patrol
   untouched.
2. **Unit naming**: literal names (Basic Troll Thrower, Sniper Troll, ...).
3. **Art pipeline**: external hi-res generation by the user from the
   concept-sheet prompts; procedural fallback until each PNG lands.
4. **Upgrade depth**: 2 paths × 3 tiers.
