# Troll Casino — scene art drop-in

Drop the five cinematic renders into THIS folder with EXACTLY these names
(scenes.js preloads them; until a file exists, that scene shows a styled
neon-gradient fallback, so partial drops are fine):

| File | Scene | Shot |
|---|---|---|
| `scene-01-lobby.png` | 1 · Arrival | Grand entrance: TROLL CASINO sign, glowing floor logo, characters at the far table |
| `scene-02-approach-table.png` | 2 · Moving closer | Medium shot of the main wheel table, all four characters |
| `scene-03-side-angle.png` | 3 · Circling | Cinematic side angle on the table + wager zones |
| `scene-04-trollface-closeup.png` | 4 · The host | Trollface close-up, hand reaching toward the player |
| `scene-05-first-person-wheel.png` | 5 · Seated | First-person view over the wheel (becomes the blurred gameplay backdrop) |

Guidelines:

- **16:9 or wider, ~1920px+** — images render `background-size: cover`
  full-viewport, and get ±6% bleed for parallax/Ken Burns drift.
- **Keep critical detail centered.** Edges crop on tall phone screens.
- **No baked-in UI text.** Balances, buttons, results are real HTML on top.
  Environmental signage inside the art (TROLL CASINO neon etc.) is fine.
- Scene 5 is dimmed + blurred behind the game table during play, so it can
  be busy — it only needs to read as atmosphere.

To change captions/copy per scene, edit `SCENES` at the top of `../scenes.js`.
