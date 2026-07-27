# The Rusty Troll — design doc (game 009)

A fry-cook shift simulator that recreates the fantasy of working at the
Krusty Krab: you are the trollface fry cook at a greasy burger shack
under a bridge, surviving shifts on the grill while a money-obsessed
crab-troll boss watches every penny, a dead-inside cashier slides
tickets through the order window, and a tiny rival keeps trying to
steal the secret sauce recipe.

This is NOT another Papa's-style station-tab game (that's Pizzeria).
The whole kitchen is one continuous side-view scene — grill on the
left, assembly counter in the middle, order window + register on the
right — and your fry cook sprite walks to whichever station you click.
The feel is "I am standing in this kitchen during a rush."

**IP note:** we capture the *fantasy* (fry cook, cheapskate boss,
miserable cashier, formula thief), never the property. No SpongeBob
names, characters, designs, or assets anywhere — the cast is our own
troll/meme roster and the under-the-sea setting becomes under-the-bridge.

- Launcher: `troll-burger.html` (repo root, same pattern as other games)
- Code: `assets/games/troll-burger/` — `style.css`, `game.js`, `leaderboard.js`, `art/`
- No real money anywhere. No wallet scripts loaded.
- Standard arcade stack: shared weekly leaderboard, troll-accounts (XP),
  site-lock, TrollNotis, coming-soon gate, feature flag `game_troll_burger`.

## The shift loop

Clock in → orders trickle, then rush, then wind down → closing cleanup
→ payday screen → next shift. A shift is ~4–6 real minutes.

1. **Order window** — Wojak at the register takes orders and slides
   tickets through the little window with a bell ding. Tickets stack on
   a rail (max 5 visible). Each customer waits in the dining room with
   a patience/mood meter (drains → affects tip multiplier, pizzeria-style).
2. **Grill** — the skill core. Up to 6 patty slots; each patty has
   **per-side doneness** (raw → seared → perfect → burnt). Click a patty
   to flip it, click-drag to pull it off. Patties keep cooking while you
   work elsewhere. Grease builds up over the shift; at high grease a
   **grease fire** can ignite — smack it with the spatula (rapid taps)
   before it spreads to neighboring patties.
3. **Assembly counter** — build the stack in the ticket's exact order:
   bottom bun → patty → cheese → toppings → sauces → top bun. Tap
   ingredient bins in sequence (or drag). Wrong layer order = accuracy
   penalty; the ticket shows the stack as a diagram, not text.
4. **Fry station** — side items: fries + onion rings in two baskets.
   Drop the basket, pull at the golden moment (raw → golden → charcoal).
   Drinks are a hold-to-fill meter with an overflow fail.
5. **Serve** — tray to the window, ring the bell. Score screen per
   order: Stack / Grill / Sides meters + tip + customer reaction line.

## Shift events (the workplace drama)

- **Boss walk-through** — Mr. Grabs strolls the kitchen 1–2× per shift.
  While he watches, every trashed patty or burnt basket docks pay and
  he snaps a money line ("That patty cost me 4 cents!!").
- **Rush hour** — a tour bus of identical customers floods the queue
  (the anchovy-horde moment). 60 seconds of the same order on repeat;
  survival % feeds a rush bonus.
- **The formula thief** — Gremlin, the pint-size owner of the failing
  Slop Bucket across the road, sneaks toward the office safe holding
  the **Grin Sauce** recipe. Tap him 3 times to yeet him out before he
  reaches it; fail = he swipes a chunk of the tip jar.
- **Health inspector** — rare; a clipboard troll appears for 45s. Serve
  nothing burnt and do one quick wipe-the-counter swipe minigame or the
  shift score takes a hit.
- **Closing time** — after the last customer: scrub the grill (swipe),
  mop the floor (drag), flip the sign. Speed = closing bonus.
- **Payday** — end-of-shift comedy screen: gross pay minus Mr. Grabs's
  deductions (hat rental, spatula depreciation, "griddle ambience fee")
  = net $2.75. Pure flavor; real score/tips are untouched.

## Scoring

- **Stack %** — right ingredients, right order (longest-common-subsequence
  vs the ticket), right patty count.
- **Grill %** — 100 when both patty sides are in the perfect band,
  falling off per side; burnt caps at 15%.
- **Sides %** — basket doneness + drink fill accuracy.
- Order score = weighted mean (Stack 45%, Grill 35%, Sides 20%) × mood
  multiplier (0.8–1.15). Tips scale with score and customer type.
- Shift score = sum of orders + rush bonus + closing bonus − event
  penalties. Leaderboard reports the best shift.

## Cast

| Name | Role | Notes |
|---|---|---|
| You (Trollface) | Fry cook | Paper hat, spatula; walks between stations |
| Mr. Grabs | Boss | Crab-clawed troll, money-obsessed, pay-dock events |
| Wojak | Cashier | Dead inside at the register; reused rig from Pizzeria |
| Gremlin | Rival | Tiny scheming troll from the Slop Bucket; thief event |
| Customers | Diners | Reuse the Pizzeria meme roster: Trollio, Pepe, Doge, Chad, Nana Troll, Harold, Grumpy (weekly closer) |

## Progression & persistence

- Shifts advance like Pizzeria days; roster and ticket complexity grow
  (shift 1 = single patty + 2 toppings; later = double/triple stacks,
  sauces, combo meals with sides + drink).
- **Promotion track** (by lifetime score): Trainee → Fry Cook → Grill
  Master → Employee of the Month (portrait on the wall) → Assistant to
  Mr. Grabs. Each rank = title on the leaderboard + small perk (e.g.
  +1 grill slot, second fry basket, grease builds slower).
- Unlocks by shift: toppings (cheese/lettuce/tomato start; pickles,
  onions, jalapeños, mystery "Grin Sauce" last), menu items (onion
  rings s3, drinks s4, double patty s5).
- Save: `localStorage["troll-burger-save-v1"]` — shift, promotion, stats,
  unlocks. XP reported to troll-accounts when signed in (non-blocking).

## Weekly leaderboard (shared engine)

`assets/games/troll-burger/leaderboard.js` registers:

```js
gameId: "troll-burger",
blank: () => ({ score: 0, tips: 0, served: 0 }),
reduce: (you, ev) => { you.served += ev.served; you.tips += ev.tips;
                       you.score = Math.max(you.score, ev.score); },
columns: best shift score (green) · tips (gold) · burgers served (muted, hideSm)
rankBy: ["score", "tips"]
```

`game.js` calls `TrollLeaderboard.record("troll-burger", { score, tips, served })`
at the end of each shift. Prizes stay display-only mock (engine enforces it).

## Art (PixelLab) — pixel sprites, `image-rendering: pixelated`

| Asset | Tool | Notes |
|---|---|---|
| Fry cook (paper hat + spatula) | create_character_state on Trollface Runner v3 | never a fresh prompt; walk + idle + flip pose |
| Mr. Grabs, Gremlin, inspector | create_character v3, side view, 64px | new rigs (not trollface-derived) |
| Wojak cashier + customers | reuse Pizzeria rigs via create_character_state | new "at register" / "in booth" states only |
| Patty (per-side stages), buns, toppings ×8 | create_1_direction_object, top-down 32–64 | one job, item_descriptions |
| Kitchen backdrop (grill/counter/window/register) | create_map_object, side 480×240 | upscaled nearest-neighbor |
| Fry baskets, soda machine, safe, bell | create_1_direction_object, sidescroller | |
| Hub card art | kitchen scene at golden hour, 16:9 jpg | `art/burger-card.jpg` |

Doneness = CSS filter ramp per patty side over the base sprite. Grease
fire = CSS/canvas particles, no art job. All art has emoji/CSS-shape
fallbacks if a PNG is missing, casino-style. Type: Pixelify Sans + DM
Sans/DM Mono. SFX: WebAudio synth (sizzle = filtered noise, bell ding,
register cha-ching). No audio files, no new CSP entries.

## Out of scope (deliberately)

- Real-money anything, revives, $TROLL.
- Networked play or backend leaderboard (provider seam ready).
- Dining-room management (seating, waiting tables) — v2 candidate along
  with a Slop Bucket "sabotage week" event and combo-meal photo tickets.

## Locked decisions (signed off 2026-07-27)

1. **Names** — restaurant "The Rusty Troll", burger "Trolly Patty",
   sauce "Grin Sauce" (Grin Core lore tie-in).
2. **Register double-duty** — v2. v1 keeps Wojak on the register full time.
3. **Events** — all five ship in v1.
4. **Grill** — per-side doneness with flip timing.

## Build phases

1. Cabinet shell + kitchen scene + core loop (grill w/ per-side flip,
   assembly, serve, scoring) with CSS/emoji fallback art. Save file.
2. Fry station + drinks, customers/patience/mood, ticket complexity
   ramp, shift progression, payday + promotion track.
3. All five shift events.
4. Arcade standard wiring: weekly leaderboard, troll-accounts XP,
   site-lock, TrollNotis, feature flag + coming-soon gate, hub card.
5. PixelLab art pass, WebAudio SFX, mobile/touch polish.
