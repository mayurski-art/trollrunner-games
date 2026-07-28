# The Rusty Troll — art manifest (PixelLab)

All sprites generated with PixelLab, rendered in-game with
`image-rendering: pixelated`. Every sprite has a CSS fallback in game.js
(the colored layer bar renders first and stays the permanent 404
fallback; the sprite fades in on top once loaded), so a missing PNG
never breaks the game.

The design doc originally planned a third-person walking fry-cook
sprite with idle/walk/flip states — that's obsolete. The game shipped
**first-person POV** instead (you never see your own body except the
spatula), so there's no character rig for the player. Live grill
cooking visualization also stays CSS-driven (continuous color
interpolation a static PNG can't do); sprites are used for the
assembled stack (build/tickets/serve tray), not the in-progress patty.

## Burger layers (1-direction objects, one 11-item batch job)

One job (c3936209…), size 56 top-down, 16 candidates returned —
indices 0-10 matched the 11 requested descriptions in order:

| File | Layer key | Description |
|---|---|---|
| bun-bottom.png | bun_b | sesame seed burger bun bottom half |
| bun-top.png | bun_t | sesame seed burger bun top dome |
| patty.png | patty | grilled beef burger patty, seared |
| top-cheese.png | cheese | melted square slice of cheddar |
| top-lettuce.png | lettuce | curly lettuce leaf piece |
| top-tomato.png | tomato | round red tomato slice |
| top-ketchup.png | ketchup | squiggle of red ketchup |
| top-pickles.png | pickles | green pickle spear slices |
| top-onions.png | onions | raw white onion rings sliced |
| top-mustard.png | mustard | squiggle of yellow mustard |
| top-jalapeno.png | jalapeno | sliced green jalapeno rings |

Indices 11-15 from that job (bacon, fried egg, extra sauce, olives)
were bonus candidates beyond the 11 requested — not used, could seed a
future menu expansion (bacon/egg combo items).

## Scene (map object)

- storefront.png — 400×224 side view, "The Rusty Troll" burger shack
  under a rusty steel bridge at dusk (7b42d1d7…). Used as the title
  screen hero backdrop (dimmed under gradients for text legibility)
  and copied as-is to burger-card.png for the arcade hub card — no
  separate upscale pass; the source is already ≥ the hub card's
  display size, so downscaling via `object-fit: cover` doesn't blur
  it the way upscaling smaller source art would.

## Customers (full-body characters, `customers/` subfolder)

The order-window dining room queue (`.tb-cust` in `renderQueue()`) used to
be a floating emoji + name label with pure-CSS walk transforms. It now
plays a real PixelLab walk cycle: full-body 8-direction characters,
animated west (screen-left, toward the register) for walk-in, frozen to
a standing pose while waiting, and the same west sheet mirrored via
`scale: -1 1` for walking back out — cheaper than generating an east
animation and reads correctly for a door on the right side of the room.
The Wojak cashier gets a `breathing-idle` loop instead, facing south
(toward the player). Fallback-first, same convention as the ingredient
layers: the emoji renders first and is never removed; the sprite fades
in (`.has-art`) only once its current frame image has loaded. PixelLab's
`animate_character` returns each animation frame as its own numbered PNG
(not one spritesheet), so frames are stepped with a small `setInterval`
in game.js (`playCustWalk`/`initWojakSprite`) rather than a CSS
`steps()` spritesheet animation — noted here since that's a deviation
from the naive assumption of a single sheet file.

6 of the 7 queue characters + the cashier were **existing PixelLab
characters reused as-is** (built for a sibling game, Papa Troll's
Pizzeria, with matching names) — no new generations spent on them,
only new animations:

| Customer | Character ID | Size |
|---|---|---|
| Harold  | `7e83b331-04fd-4373-ac1e-79b58134ca53` | 124×124 |
| Grumpy  | `6c504f78-349f-446e-bbd5-f0fd9eceac25` (Grumpy Critic) | 116×116 |
| Chad    | `9b0e6228-f683-4df0-99e3-f0ce214cf66b` | 120×120 |
| Doge    | `0ba10194-57c0-4d15-bc61-fc53697aab6f` | 120×120 |
| Pepe    | `243c5cfd-b5b4-4d8d-8e2c-6389ca92aad5` | 124×124 |
| Wojak (cashier) | `8677c24a-1373-47f0-a6b2-18f2d3860ada` | 120×120 |

**Trollio and Nana were newly created** (standard mode, humanoid, side
view, single color black outline, basic shading, 8 directions, 120px
requested — PixelLab expanded the canvas to 168×168 to make room for
animation, larger than the reused set's 116-124px but visually
proportionate at in-game scale):

- Trollio Customer — `bc74f4ca-f257-4e65-bfa6-69466daaea3e`. Bald head,
  big gap-tooth grin, arched eyebrows — built to read as the classic
  internet trollface meme (this project's hard style rule for anything
  troll-branded), on a plain green-tee/jeans body. Approved on first
  generation, no retry needed.
- Nana Customer — `4ce364de-a869-46aa-b954-43d03dccfb52`. Gray hair in
  a bun, round glasses, pink cardigan over a floral dress, wooden cane.
  Approved on first generation.

All 7 queue members got a `walking-8-frames` template animation,
direction `west` only (the scene only needs walking screen-left, so
the other 7 directions were skipped to not burn generations on unused
art). Wojak got `breathing-idle`, direction `south` only. Standing-still
poses reuse each character's existing `west` (queue) / `south` (Wojak)
rotation image — no extra generation needed for that.

## Not yet done (v2 candidates)

- Character portraits for Mr. Grabs, Gremlin, and the health inspector
  — currently emoji in the event banner. Low payoff right now since
  first-person POV means none of them get real screen time beyond a
  small icon.
- Interior kitchen backdrops (griddle/counter/window) — currently CSS
  gradients, already read clearly; real backdrop art would be a bigger
  job (3 large side-view map objects) for a smaller marginal gain than
  the ingredient sprites were.
