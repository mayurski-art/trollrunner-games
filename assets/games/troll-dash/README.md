# Troll Dash Assets

This folder is reserved for Troll Dash: Rugpull Run assets.

Current MVP uses canvas-drawn placeholder obstacles and the background-removed buff guy player cutout:

- `sprites/troll-buffguyfigure-cutout.png`

The player is animated in `game.js` as a lightweight canvas rig. It crops the preserved cutout into logical body regions at render time, then pivots the arms, leg, torso, and head separately. Facial-expression overlays are also drawn on top for running, sliding, revive, and death states.

Replace or add production art and sounds here later:

- `sprites/troll-buffguyfigure-cutout.png`
- `placeholders/player.png`
- `placeholders/troll-coin.png`
- `placeholders/red-candle.png`
- `placeholders/rug-hole.png`
- `placeholders/npc.png`
- `placeholders/bear.png`
- `placeholders/chart-wall.png`
- `placeholders/scam-barrel.png`
- `placeholders/fud-sign.png`
- `placeholders/jump.wav`
- `placeholders/coin.wav`
- `placeholders/revive.wav`
- `placeholders/death.wav`

The code comments in `game.js` mark the future Solana wallet/payment integration path. Real paid revives should stay disabled until a backend or serverless verification endpoint exists.
