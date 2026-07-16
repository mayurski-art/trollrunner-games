# Papa Troll's Pizzeria — design doc (game 005)

A nostalgic time-management cooking game in the spirit of Papa's Pizzeria
(Flipline, 2007): take orders, build pizzas, bake them, cut them, serve
them — juggling several customers at once. Troll Runner flavor: the
customers are meme legends, the boss is Papa Troll, and pineapple is the
forbidden topping.

- Launcher: `troll-pizzeria.html` (repo root, same pattern as the other games)
- Code: `assets/games/troll-pizzeria/` — `style.css`, `game.js`, `leaderboard.js`, `art/`
- No real money anywhere in this game. No wallet scripts loaded.
- Standard arcade stack: shared weekly leaderboard, troll-accounts (XP),
  site-lock, TrollNotis, coming-soon gate, feature flag `game_troll_pizzeria`.

## The loop (one customer)

1. **Order station** — customers walk into the lobby and queue. Click the
   customer at the counter to take their order; a ticket slides onto the
   ticket rack. Each waiting customer has a patience meter that drains and
   sets their mood (affects final tip multiplier).
2. **Build station** — pick a ticket, then build on the dough: ladle sauce,
   spread cheese (both are 3-step meters: none → light → normal → extra),
   then drag toppings from bins onto the pie. Placement matters: orders can
   be whole-pie or half-and-half ("8 pepperoni on the left half").
3. **Bake station** — drag the built pizza into one of 4 oven slots. A
   doneness bar fills: raw → light → perfect → well-done → burnt. Pull it
   at the ticket's target doneness. Pizzas keep baking while you work other
   stations (the multitasking heart of the game).
4. **Cut station** — the ticket asks for 2, 4, 6 or 8 slices. Swipe the
   roller cutter along the guide; accuracy of each cut is scored.
5. **Serve** — score screen with three meters (Order / Bake / Cut), a tip,
   and the customer's reaction line.

## Scoring

- **Order %** — toppings: right kind, right count, right side, plus an
  evenness bonus (pie is scored in quadrants; low variance = bonus).
  Sauce/cheese amount correct = full marks each.
- **Bake %** — 100 at the target doneness, falling off linearly on both
  sides; burnt caps at 15%.
- **Cut %** — right slice count, then mean angular error of the cuts.
- Ticket score = weighted mean (Order 45%, Bake 30%, Cut 25%) × waiting
  mood multiplier (0.8–1.15). Tips scale with score and customer type.
- Day score = sum of ticket scores; leaderboard reports the best day.

## Customers (meme cast)

| Name | Who | Patience | Quirk |
|---|---|---|---|
| Trollio | Classic trollface in a hoodie | Low | Chaotic half/half orders |
| Pepe | Sad frog | High | Simple orders, tips big when happy |
| Doge | Standing shiba in a sweater | Med | Much pepperoni. Very topping. |
| Wojak | Feels guy | Med | Plain cheese, exact bake |
| Chad | Gigachad | Low | Everything pizza, 8 slices, perfection |
| Nana Troll | Troll granny | Very high | Light everything, 4 slices |
| Grumpy | Grumpy-cat food critic | Low | Weekly closer; huge score weight |
| Harold | Hide-the-pain smile guy | Med | Always well-done bakes |

Customers walk in on a timer that tightens as days go on. Day roster grows:
day 1 = 4 customers, +1 per day, cap 9. Grumpy shows up as the last
customer whenever `day % 7 == 0`.

## Progression & persistence

- Days advance after the last customer is served; end-of-day screen shows
  earnings, best ticket, XP gained, unlocks.
- Unlock track (by day): toppings start with pepperoni + mushrooms; then
  olives (d2), green peppers (d3), sausage (d4), onions (d5), basil (d6),
  pineapple (d7, the forbidden one — trolls love it). New customers unlock
  alongside (Trollio, Pepe first; roster order above).
- Save: `localStorage["troll-pizzeria-save-v1"]` — day, XP/rank, lifetime
  stats, unlocks. No backend.
- XP also reported to troll-accounts when signed in (same call the other
  games make — non-blocking, optional).

## Weekly leaderboard (shared engine)

`assets/games/troll-pizzeria/leaderboard.js` registers:

```js
gameId: "troll-pizzeria",
blank: () => ({ score: 0, tips: 0, served: 0 }),
reduce: (you, ev) => { you.served += ev.served; you.tips += ev.tips;
                       you.score = Math.max(you.score, ev.score); },
columns: best day score (green) · tips (gold) · served (muted, hideSm)
rankBy: ["score", "tips"]
```

`game.js` calls `TrollLeaderboard.record("troll-pizzeria", { score, tips, served })`
at the end of each day. Prizes stay display-only mock (engine enforces it).

## Art (PixelLab) — pixel sprites, `image-rendering: pixelated`

| Asset | Tool | Notes |
|---|---|---|
| Papa Troll chef + 8 customers | create_character v3, side view, 64px | front (south) frame used at the counter |
| Pizza stages ×4 (dough / sauce / cheese / baked) | create_1_direction_object, top-down 128 | one job, item_descriptions |
| Toppings ×8 | create_1_direction_object, top-down 32 | one job, multi-candidate review |
| Brick oven | create_1_direction_object, sidescroller 160 | |
| Lobby + kitchen backdrops | create_map_object, side 400×240 | upscaled nearest-neighbor |
| Hub card art | lobby scene upscaled to 16:9 jpg | `art/pizzeria-card.jpg` |

Burnt/doneness is a CSS filter ramp over the baked stage. Sauce/cheese
half-pie masks are CSS clip-paths over the stage sprites. All art has a
graceful fallback (emoji/CSS shapes) if a PNG is missing, casino-style.

Type: Google Fonts (CSP already allows) — "Pixelify Sans" display + DM Sans
body. SFX: tiny WebAudio synth blips (no audio files, no new CSP entries).

## Out of scope (deliberately)

- Real-money anything, revives, $TROLL — nothing to buy here yet.
- Networked/multiplayer, backend leaderboard (provider seam ready).
- Papa's-style shop upgrades — v2 candidate along with photo-real order
  tickets, drink station, and seasonal toppings.
