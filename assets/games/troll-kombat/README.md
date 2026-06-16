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

## The art
Fighters with a sprite in `fighters/` (`troll.png`, `pepe.png`, `doge.png`)
render as that green-screened 3D render — feet-anchored, mirrored by facing,
with state "flavour" transforms (lunge/tilt/squash) since a single still can't
articulate limbs. The procedural muscular rig remains available for future
fighters without sprites: cel-shaded base → shadow → highlight → bold ink
outline, so the face shares the body palette and body art direction.

### Sprites
Source renders are full-body, ~3/4 facing RIGHT, on a flat green screen. Cut
them out with `tools/remove-greenscreen.ps1` (border flood-fill chroma key, so
an interior region matching the key — e.g. Pepe's green belly — survives because
the flood can't reach it without crossing the darker silhouette):

```
powershell -File tools/remove-greenscreen.ps1 `
  -In  assets/games/troll-kombat/fighters/src/troll-fighter.png `
  -Out assets/games/troll-kombat/fighters/troll.png -GThresh 22 -Spill -DespillAll 16 -Crop
```

Raw green-screen renders live in `fighters/src/`. Settings used: troll
`-GThresh 22 -DespillAll 16`, doge `-GThresh 30 -DespillAll 16`, pepe
`-GThresh 72` (green body — no despill, relies on connectivity).

Use a low `-GThresh` + `-DespillAll` for non-green bodies (troll/doge: also eats
the ground shadow and green spill); a higher `-GThresh` and no `-DespillAll` for
green bodies (pepe). Register a sprite by adding `spriteSrc` + `footFrac` (the
fraction of image height where the feet rest) to its `ROSTER` entry; everything
else — scale, select portrait, mirroring — is automatic.

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
