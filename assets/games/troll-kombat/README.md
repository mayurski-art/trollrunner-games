# Troll Kombat

A Mortal Kombat–style 2D fighter for the Troll Runner Arcade. Vanilla JS +
canvas, no build step, no deps. Lives at `/troll-kombat.html`.

## How it plays
Pick a meme champion, the CPU grabs a random other one, then brawl in a cursed
meme-coin arena. Best of 3 rounds, 60s each (most HP wins on timeout). Land a
match-ending K.O. and you get a cheeky **FATALITY** coin-burst finisher.

Controls (keyboard): A/D move · W jump · S crouch · J punch · K kick ·
L special · Space block. Touch layouts get an on-screen d-pad + action buttons.
Block also works by holding away from the opponent.

Specials cost a full meter (the cyan bar). Meter builds by dealing and taking
damage. Each fighter has a signature special:

- **Big Troll** — `PROBLEM?` smug-grin energy orb
- **Pepe** — `FEELS BLAST` green projectile
- **Doge** — `1000x BONK` coin barrage (multi-hit spread)
- **Elon** — `ROCKET` high-damage rocket

## The art (no image assets)
There are **no sprite files**. Every fighter is drawn live on the canvas by one
shared muscular rig, cel-shaded in the order base → shadow → highlight → bold
ink outline, so the face shares the body's palette and "blends in" — the look of
the dino-riding trollface in `assets/games/troll-dinosaur.jpg`. A character is
just a palette + a `drawHead()` function + a special, so adding to the roster is
cheap.

`game.js` structure:
- **Rig** — `Fighter.draw()` composes torso (gradient + pecs/abs ink lines),
  FK arms (`drawArm`/`chain`), IK legs (`drawLeg`, knee = midpoint pushed
  forward), and a per-character head. `drawTube` renders each muscular limb.
- **Animation** — per-state pose *targets* (idle/walk/jump/crouch/block/hit/
  attack/win/ko) that the fighter's angles lerp toward each frame, so motion is
  smooth without keyframe sprites.
- **Combat** — frame-data attacks (`ATTACKS`: startup/active/recovery) with a
  hand/foot-derived hitbox vs the opponent's hurtbox; blocking, hitstun,
  knockback, hitstop, screen shake, and spark/coin particles.
- **Flow** — a `match` object runs select → intro → fight → roundend →
  matchend; `AI` is a light FSM with three difficulty tiers.
- **Audio** — tiny WebAudio synth (no files), same approach as Troll Dash.

## Adding a fighter
Append to `ROSTER` with `{ id, name, tag, blurb, special, pal, drawHead }` and
write a `drawHead(r, pal, opts)` that paints the face in `pal` (centre at 0,0,
radius `r`, facing +x). The select screen, roster cards, and portraits pick it
up automatically.
