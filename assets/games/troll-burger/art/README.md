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

## Not yet done (v2 candidates)

- Character portraits for Mr. Grabs, Gremlin, the health inspector,
  and Wojak — currently emoji in the event banner / register scene.
  Low payoff for the effort right now since first-person POV means
  none of them get real screen time beyond a small icon.
- Interior kitchen backdrops (griddle/counter/window) — currently CSS
  gradients, already read clearly; real backdrop art would be a bigger
  job (3 large side-view map objects) for a smaller marginal gain than
  the ingredient sprites were.
