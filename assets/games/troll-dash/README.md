# Troll Dash: Rugpull Run

A pseudo-3D endless runner (Temple Run-style) for the Troll Runner Arcade.
Vanilla JS + canvas, no build step.

## How it plays
The troll runs in place facing the camera while the cursed temple-chart
corridor rushes toward it. Swap lanes, jump, and slide to survive; grab
$TROLL coins; pay the troll toll (6.9 $TROLL) to revive once per run.

Controls: A/D or arrows for lanes, W/Up/Space jump, S/Down roll, plus
Subway-Surfers-style swipes on touch (mid-gesture detection + re-arm, so a
quick flick chains; tap = hop). A 3rd-person follow camera trails the lane
you're in. Deep links: `index.html#play` skips the cabinet intro to the
preview screen; `#autostart` begins a run immediately (handy for embeds/tests).

## Rendering
`game.js` is a self-contained pseudo-3D engine:

- **Projection** — every entity has world coords `(z depth, laneX, worldY)`
  projected to screen by `project()` from a camera depth/height/horizon.
  Objects scale and slide down-and-out as they approach.
- **World** — parallax dusk sky + temple ridge + chart skyline, green
  vanishing-point glow, a checkerboard stone path with distance fog and
  glowing edges, and torch-lit temple pillars rushing past for depth.
- **Player** — a single transparent sprite (`sprites/troll-runner.png`)
  drawn with run-bob, lane-banking lean, jump squash/stretch, roll, ground
  shadow, foot dust, and speed-lines at high velocity.
- **Obstacles** — three clear mechanics, themed:
  - `barrier` (red-candle gate) -> jump
  - `beam` (FUD overhang) -> roll
  - `pit` (rugpull hole) -> jump
  Painter's algorithm sorts everything by depth each frame.

## Assets
- `sprites/troll-runner.png` — tight, transparent player cutout (the
  charging buff troll), produced from `troll-buffguyfigure-cutout.png`.
- `sprites/troll-buffguyfigure-cutout.png` — original transparent source.

Background removal is scripted in `tools/remove-bg.ps1` (border flood-fill,
so interior white troll muscles survive). Replace the placeholder synth
audio in the `audio` object with real files later.

## Payments
`MockRevivePaymentProvider` simulates the 6.9 $TROLL revive against a mock
wallet balance. `FutureSolanaPaymentProvider` is the integration stub and
stays disabled until a backend verifies destination, mint, amount,
memo/reference, and one-time transaction usage. Treasury + mint constants
live at the top of `game.js`.
