# Papa Troll's Pizzeria v3 — "The Rush" (design doc)

Status: Decisions locked 2026-07-29. Building all 4 phases in order.

v1 (docs/TROLL-PIZZERIA.md) shipped the core order→build→bake→cut→serve
loop. v2 (docs/TROLL-PIZZERIA-V2.md) added the Pizza Cam (3D pie) and the
uniqueness layer (Troll Events, Grin Hunt, Grin Combo). Both are live.

v3 goes wide across all four axes the game hasn't touched yet: menu
variety, a harder loop, meta progression between shifts, and more depth
in one existing station. Nothing here removes existing systems — same
pattern as v2, additive and phased, each phase merges to main on its own.

---

## Part 1 — Menu variety

Current menu: cheese/sauce amount + up to ~3 topping kinds (8 total,
gated by day) + 3 bake levels + slice count. Additions:

- **New toppings, days 8–10**: extra cheese (a 4th "amount" layer, not a
  topping bin — melts differently, scored like sauce/cheese), jalapeños,
  bacon bits. Keeps the existing `TOPPINGS`/`day` gating, just extends it
  past day 7.
- **Specialty tickets** (fixed-recipe orders, no half/half chaos): a
  named "Meme Special" pizza per unlocked city-tier customer — ticket
  shows a fixed topping layout instead of a build-to-spec list. These
  score on speed + accuracy-to-template rather than the usual scoring
  formula, and pay a flat bonus tip. Low build complexity, adds variety
  without new stations.
- **Sides**: breadsticks and soda, prepared as a *parallel mini-task* at
  the order counter (not a new full station) — breadsticks: bake
  alongside pizzas in a 5th oven slot reserved for sides, pull at the
  right doneness; soda: single click-to-fill-to-the-line bar, instant.
  Some tickets from day 5+ include "+ side" and pay extra tip for
  getting both right.

## Part 2 — Harder gameplay loop

- **Rush hour**: once per shift (day 4+), a ~45s window where arrivals
  come back-to-back (nextArrivalIn floor drops hard) and lobby cap rises
  from 4 to 6. Telegraphed with a HUD banner + jingle so it reads as an
  event, not a difficulty cliff. Surviving it clean (no storm-outs) is
  its own small score bonus.
- **Escalating troll events**: event frequency already scales with day;
  v3 adds a second, harder-tier event pool unlocked day 10+ (two events
  can be "live" — i.e. queued — at once, forcing a real choice about
  which Grin Hunt to chase).
- **Kitchen fire (mistake penalty)**: leaving a pizza in the oven past
  doneness 1.0 for too long now has a small chance to catch fire (visual
  only — smoke + alarm sfx), forcing an immediate pull with a hard score
  floor instead of just "burnt". Makes ignoring the oven properly
  punishing rather than a soft doneness penalty.
- **Day length scaling**: roster size already grows with day
  (`3 + day`, capped 9); v3 uncaps it slightly further (up to 12) past
  day 10 so late-game shifts are genuinely longer, not just faster.

## Part 3 — Meta progression (between shifts)

New spendable currency, separate from the `lifetimeTips` *stat*: a
**Til Jar** — 10% of each day's tips are banked into it automatically
(the rest is flavor/score as today). Spend it from a new "Upgrades" tab
on the title screen:

| Upgrade | Effect | Cost curve |
|---|---|---|
| Faster oven | -3s off `BAKE_SECONDS` per level (3 levels) | rising |
| 5th oven slot | permanent extra `OVEN_SLOTS` | one-time, expensive |
| Thicker skin | customer patience +15% (all tiers) | rising |
| Steady hands | topping placement scoring more forgiving | rising |
| Grin insurance | one bad station per day doesn't reset Grin Combo | one-time |

Upgrades are permanent, account-tied (rides the existing cloud-save
snapshot — just a few more integer fields, no schema migration since
`troll_game_saves.data` is a JSON blob). Purely additive to `snapshot()`/
`applySnapshot()`.

Rank names (`RANKS`) already give a sense of XP progression; this adds a
second, player-chosen progression axis on top of the automatic one.

## Part 4 — Station depth: Build station sauce/cheese

Pick **one** existing station to deepen (per your answer, this is meant
to compound with the above, not replace it). Recommendation: **Build
station's sauce/cheese step**, because it's currently the least tactile
part of the loop (a button cycling through 4 fixed amounts) while
toppings and cutting already have real interaction.

- Replace the amount-cycle buttons with a **paint gesture**: drag across
  the pie to spread sauce/cheese; coverage is tracked continuously
  (0–100%) instead of snapping to `none/light/normal/extra`. Tickets
  now ask for a coverage band (e.g. "60–75%") instead of a discrete
  amount.
- Uneven painting is visible on the pie (patchy sauce = patchy 3D shader
  wipe, reusing the Pizza Cam's existing radial-wipe from v2) and scores
  worse — rewards actually covering the pie evenly, not just clicking
  a button 3 times.
- Backward-compatible scoring: `scoreOrder()`'s sauce/cheese term
  swaps from exact-match-on-4-buckets to distance-from-target-band;
  everything else in scoring is untouched.

---

## Phasing (each phase merges + pushes to main when done, per repo convention)

1. **Menu variety** — days 8–10 toppings/extra-cheese layer, specialty
   tickets, sides (breadsticks + soda). No new stations, additive to
   `TOPPINGS`/`CUSTOMERS`/ticket generation.
2. **Harder loop** — rush hour, kitchen fire, second troll-event tier,
   day-length uncap.
3. **Meta progression** — Til Jar currency, Upgrades tab + 5 upgrades,
   cloud-save field additions.
4. **Build-station depth** — sauce/cheese paint gesture replacing the
   amount buttons, coverage-band scoring, 3D shader tie-in.

Phases are independent — order above is easiest-to-hardest, but any can
ship standalone if you want to reprioritize mid-way.

## Out of scope (unchanged from v1/v2)

Real money, revives, $TROLL purchases, networked play, backend
leaderboard schema changes (`{score, tips, served}` stays as-is —
Til Jar and upgrades are save-data only, never touch the leaderboard).

## Decisions (locked 2026-07-29)

1. **Sides** — share the 5th oven slot with pizzas (real contention,
   not a free-standing timer). ✅
2. **Til Jar bank rate** — 10% of daily tips, as scoped. ✅
3. **Kitchen fire** — cosmetic + forced pull only; doneness score hit is
   the only penalty, no extra flat dock. ✅
4. **Scope** — all 4 phases, in order (menu variety → harder loop →
   meta progression → build-station depth). ✅
