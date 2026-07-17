# Troll Casino — scene art drop-in

Drop the five cinematic renders into THIS folder with EXACTLY these names
(scenes.js preloads them; until a file exists, that scene shows a styled
neon-gradient fallback, so partial drops are fine):

**Video loops:** a same-named `.mp4` next to a PNG (e.g. `scene-01-lobby.mp4`)
upgrades that scene to looping footage — the PNG stays underneath as the
instant-paint poster. Only the active scene's video plays; audio follows the
casino's one sound toggle (muted by default). Reduced-motion visitors get the
stills. All five scenes only ever appear inside the framed cinematic screen
(`.scene-frame`, ~860px wide) — none of them play as a fullscreen or
gameplay backdrop, so keep detail readable at that smaller size.

| File | Scene | Shot |
|---|---|---|
| `scene-01-lobby.png` | 1 · Arrival | Grand entrance: TROLL CASINO sign, glowing floor logo, characters at the far table |
| `scene-02-approach-table.png` | 2 · Moving closer | Medium shot of the main wheel table, all four characters |
| `scene-03-side-angle.png` | 3 · Circling | Cinematic side angle on the table + wager zones |
| `scene-04-trollface-closeup.png` | 4 · The host | Trollface close-up, hand reaching toward the player |
| `scene-05-first-person-wheel.png` | 5 · Seated | First-person view over the wheel, the last beat before the floor |

Guidelines:

- **16:9 or wider.** Native res doesn't need to hit 1920px anymore since
  the frame renders at ~860px wide — but sharper source art still upscales
  better under the ±6% bleed for parallax/Ken Burns drift.
- **Keep critical detail centered.** Edges crop on tall phone screens.
- **No baked-in UI text.** Balances, buttons, results are real HTML on top.
  Environmental signage inside the art (TROLL CASINO neon etc.) is fine.
- The whole cinematic (frame + all five scenes) disappears the moment
  gameplay starts — the casino floor and game rooms carry no video backdrop.

To change captions/copy per scene, edit `SCENES` at the top of `../scenes.js`.
