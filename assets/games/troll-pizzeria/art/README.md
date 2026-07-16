# Papa Troll's Pizzeria — art manifest (PixelLab)

All sprites generated with PixelLab, rendered in-game with
`image-rendering: pixelated`. Every sprite has an emoji/CSS fallback in
game.js, so a missing PNG never breaks the game.

## Characters (south rotation used at the counter)

The three trollface characters are **states of the approved Meme Metro
Trollface Runner v3** (`f77ed74f-87d7-40f6-9bdb-6136f72459e3`) so the head
is the real classic trollface — plain text-to-character attempts came out
as fantasy goblins and were deleted. Re-roll outfits with
`create_character_state` on the runner, not `create_character`.

| File | Who | PixelLab character id |
|---|---|---|
| char-chef.png | Papa Troll (chef state) | 828218db-8385-49c7-a8b9-83a6d2f352ca |
| char-trollio.png | Trollio (grey hoodie state) | ca0e9271-fa53-4370-9044-584414e8c7ea |
| char-nana.png | Nana Troll (granny state) | c040fc6b-3067-4865-8af5-14dff755b78b |
| char-pepe.png | Pepe | 243c5cfd-b5b4-4d8d-8e2c-6389ca92aad5 |
| char-doge.png | Doge | 0ba10194-57c0-4d15-bc61-fc53697aab6f |
| char-wojak.png | Wojak | 8677c24a-1373-47f0-a6b2-18f2d3860ada |
| char-chad.png | Chad | 9b0e6228-f683-4df0-99e3-f0ce214cf66b |
| char-grumpy.png | Grumpy (critic) | 6c504f78-349f-446e-bbd5-f0fd9eceac25 |
| char-harold.png | Harold | 7e83b331-04fd-4373-ac1e-79b58134ca53 |

## Food + props (1-direction objects)

Pizza stages came from one 4-candidate job (497a8231…), toppings from one
64-candidate job (7fc57157…) — indices 0-7 matched the 8 descriptions.

- pizza-dough / pizza-sauce / pizza-cheese / pizza-baked (128px, top-down):
  c3bd6001…, beaca810…, 66259adf…, f34685bf…
- top-pepperoni / mushrooms / olives / peppers / sausage / onions / basil /
  pineapple (32px, top-down): 1e94db50…, 7211bdf0…, 561e1f5f…, 100b7368…,
  7e4cfc94…, 900772dd…, 7dd2f000…, e83e03be…
- oven.png (160px, sidescroller): aa2dfc3c-1f20-40b0-be90-979037c3776d

## Scenes (map objects — these auto-delete server-side, PNGs are the source of truth)

- bg-lobby.png — 400×240 pizzeria dining room (order-station backdrop)
- storefront.png — 400×224 pizzeria storefront at dusk
- pizzeria-card.jpg — storefront upscaled 4× nearest-neighbor (hub card)
