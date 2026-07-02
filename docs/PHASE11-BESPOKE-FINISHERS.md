# Phase 11 — Bespoke Finishers Planning

This is an inspection/planning note only. Do **not** wire new bespoke finisher
logic into the live fight loop until the engine has a small, isolated finisher
sequencer that can be tested without changing normal attacks, round flow, wallet
flows, or leaderboard/payout hooks.

## Current finisher-related code found

### Troll Kombat roster metadata

- `ROSTER[].moves.finisher` stores per-fighter finisher **names** only, such as
  Pepe Samurai's `Feels Bad, Man` and Doge Drip's `Very Rekt. Much Wow.`.
- These names are flavor metadata. They do not currently select animation strips,
  spawn character-specific effects, or run per-character cinematic steps.

### KO animation system

- Each fighter's animation set may define a `ko` strip in
  `ROSTER[].anims.defs.ko`.
- `Fighter.update()` routes fighters in `state === "ko"` through `updateKO(dt)` and
  then physics. This is a normal defeated-state animation, not a bespoke finisher
  system.
- Round-end update calls `win.update(..., "roundend")` and
  `lose.update(..., "roundend")`, so the winner/loser continue to animate while
  the round-end timer runs.

### Generic match-ending finisher flourish

- The match object has a boolean `finisher` flag reset each round.
- On a match-winning KO only, the round-end phase announces `FINISH!` after a
  delay, then fires a cosmetic `coinBurst(...)`, coin sounds, and screen shake.
- This flourish is global and generic. It does not branch by winner character,
  loser character, stage, input sequence, or finisher name.

### Result-screen fatality badge

- `showResult(...)` displays `FATALITY` for match-ending KOs, or `FLAWLESS` if the
  winner took no damage.
- This is a result overlay badge, not an end-of-match cinematic or character
  finisher sequence.

## Asset status (2026-07-01)

Bespoke `finisher` pixel-art strips now exist for all three roster fighters,
generated via PixelLab (v3 custom mode, east direction only, 9 frames each —
frame 0 is a neutral reference frame, frames 1-8 are the animated pose, same
pattern as the existing `jumping-1` strips):

- Pepe Samurai — katana sheath-slash, `fighters/pepe-rig/anims/finisher.png`
- Doge Drip — cocky point-and-taunt, `fighters/doge-rig/anims/finisher.png`
- Gladiator — bare-fisted victory roar, `fighters/gladiator/anims/finisher.png`

Each roster entry's `anims.defs` in `game.js` now includes
`finisher: { frames: 9, fps: 12, loop: false }`, so the strip preloads
automatically (the preload loop iterates `Object.keys(d.anims.defs)` and is
asset-generic — no engine code changed beyond the data entry).

**This art is inert.** No code path sets `state === "finisher"`, reads the new
strip, or triggers it from `roundend`/`matchend`. The generic `FINISH!` +
`coinBurst` flourish and `FATALITY`/`FLAWLESS` badge described below are still
the only things that happen on a match-ending KO. Wiring this art into a real
per-character cinematic still requires the `FinisherSequencer` scaffold
(Phase 11B) described below — do not gate `roundend` on `state === "finisher"`
without it.

## Current verdict

Troll Kombat has a **safe generic KO flourish**, a **KO animation state**, and a
**result badge**, but it does **not** have a clean bespoke finisher system yet.
There is no fatality input parser, no per-character cinematic timeline, no
finisher asset registry, and no isolated sequencer that can run independently of
normal combat.

Because of that, bespoke finishers should **not** be implemented directly inside
`match.update()` or normal attack handling in the next pass. The current fight
engine should stay stable.

## Future design goals

1. **Separate finishers from normal attacks**
   - Finishers should never reuse punch/kick/special input handling as live combat
     attacks.
   - Normal hitboxes, stamina, meter, blocking, AI decisions, and projectiles
     should be frozen or ignored while a finisher cinematic is running.

2. **Trigger only from explicit end-of-match conditions**
   - Candidate gate:
     - `matchWon === true`
     - `byKO === true`
     - loser is already in `state === "ko"`
     - match phase is `roundend`
     - no payout/leaderboard/result overlay work has started yet
   - Optional future gates can include player input, meter state, stage rules, or
     difficulty, but the default should remain deterministic and safe.

3. **Use a small isolated sequencer**
   - Add a future module-like object, for example `FinisherSequencer`, with a
     minimal API:
     - `canStart(ctx)`
     - `start(ctx)`
     - `update(dt)`
     - `draw(ctx)` or `drawOverlay(ctx)`
     - `isDone()`
     - `cancel(reason)`
   - The match loop should only ask the sequencer whether it is active/done; the
     sequencer should own cinematic timing.

4. **Use per-character data, not conditionals scattered through the engine**
   - Extend roster data later with a dedicated `finisher` object instead of only a
     name string, for example:

     ```js
     finisher: {
       id: "pepe-feels-bad",
       title: "Feels Bad, Man",
       duration: 2.8,
       paletteFx: "green-red-candles",
       strips: { winner: "finisher", loser: "ko" },
       beats: [
         { t: 0.0, type: "announce", text: "FINISH!" },
         { t: 0.4, type: "pose", actor: "winner", state: "special" },
         { t: 1.2, type: "fx", kind: "coinBurst", actor: "loser" },
         { t: 2.6, type: "done" }
       ]
     }
     ```

   - Character-specific code should live in data-driven beats or small helper
     functions registered by finisher id, not in the normal attack code path.

5. **Keep the 2D pixel-art direction**
   - Prefer short pixel-art strips, palette flashes, silhouettes, coin/candle
     particles, screen-space overlays, and stage lighting pulses.
   - Avoid expensive new systems that require 3D, physics ragdolls, or random
     gameplay side effects.

6. **Do not interfere with match flow**
   - The sequencer should run after the final KO and before `endMatch()`.
   - When the sequencer finishes, normal flow resumes into existing
     leaderboard/result/wager hooks.
   - If the sequencer fails or an asset is missing, it should gracefully fall back
     to the existing generic `FINISH!` + `coinBurst(...)` flourish.

## Suggested implementation phases later

### Phase 11A — Data shape only

- Add `finisher` objects to roster definitions with ids/titles/durations.
- Keep the existing generic flourish active.
- No new match-loop behavior beyond reading the data for debug output.

### Phase 11B — Sequencer scaffold behind a flag (DONE, 2026-07-01)

- Added `ENABLE_BESPOKE_FINISHERS: false` to `assets/js/troll-arcade-flags.js`
  (default off; every other flag/behavior in that file untouched).
- Implemented `FinisherSequencer` as its own file,
  `assets/games/troll-kombat/finisher-sequencer.js`, loaded in
  `troll-kombat.html` between `leaderboard.js` and `game.js`. Public API
  matches the design above: `canStart(roundCtx)`, `start(roundCtx)`,
  `update(dt)`, `draw(ctx)`, `isDone()`, `cancel(reason)`.
- Wired three minimal call sites in `game.js`, all no-ops when the flag is off:
  - `startRound()` calls `FinisherSequencer.cancel("round-reset")` so nothing
    can bleed into the next round or a rematch.
  - `roundend`'s existing `matchWon && byKO && !this.finisher` branch now
    tries `seq.canStart({winner, loser})` first; only on `true` does it call
    `seq.start(...)` instead of the original `announce("FINISH!", ...)`. The
    `coinBurst`/shake flourish a beat later is untouched and still fires
    either way.
  - `loop()` calls `FinisherSequencer.update(simDt)` alongside `match.update`
    (same freeze/hitstop gating) and `FinisherSequencer.draw(ctx)` right after
    `match.draw(dt)`, inside the existing shake-transformed `ctx.save/restore`
    block.
- The sequencer never touches `fighter.state`; `draw()` only overlay-paints the
  winner's `finisher` strip on top of whatever the normal fighter render
  already drew at the same `x`/`feetY`/`facing`, reading `fighter.def` only.
  Nothing it does can affect hitboxes, AI, physics, pause, wallet, wager, or
  leaderboard code.
- Verified: `node --check` passes on `game.js`, `finisher-sequencer.js`, and
  `troll-arcade-flags.js`. Flag is still `false` by default, so live behavior
  (generic `FINISH!` + `coinBurst`) is unchanged until a page opts in via
  `window.TROLL_FLAGS_OVERRIDE = { ENABLE_BESPOKE_FINISHERS: true }` — that
  opt-in and its manual test pass belong to Phase 11C below, not this one.

### Phase 11C — Proof of concept + live verification (DONE, 2026-07-01)

Since Phase 11A already gave all three fighters real bespoke `finisher` art
(not just one), 11C's scope narrowed to verifying the flag-on path is safe
under real gameplay, in an actual browser (headless Chromium via Playwright —
`chromium-cli` wasn't available in this environment), with
`window.TROLL_FLAGS_OVERRIDE = { ENABLE_BESPOKE_FINISHERS: true }`:

- **Timeout (non-KO) wins**: not live-tested — provably unreachable by
  inspection, since `game.js`'s `roundend` block only calls
  `FinisherSequencer.canStart()`/`.start()` inside the existing
  `this.matchWon && this.byKO` condition. A timeout win can't set `byKO`, so
  the sequencer is structurally never invoked for it.
- **Pause mid-fight**: `Escape` correctly shows `#tk-paused`; `Escape` again
  correctly hides it and gameplay resumes. No interference from the
  sequencer being loaded.
- **Pause on the result screen**: correctly a no-op (`pause.canControl()`
  already excludes `phase === "matchend"`; unrelated to this feature, still
  verified unaffected).
- **Real KO → cinematic path → result overlay**: played a full CPU match to
  an actual `FATALITY` finish with the flag on. Zero console/page errors
  through the entire `roundend` → `matchend` → result-overlay pipeline.
- **Rematch**: clicking `#tk-rematch` after a bespoke-path win starts a clean
  new match; `FinisherSequencer` reads back `{ active: false, hasWinner:
  false }` immediately after — confirms `cancel("round-reset")` in
  `startRound()` actually prevents state bleed between matches, not just in
  theory.
- **Second match after rematch**: hammered a second CPU match to another real
  `FATALITY` finish on the same page load — same clean result, still zero
  errors, confirming the sequencer is safe to trigger repeatedly in one
  session, not just once.
- **Wager/leaderboard code paths**: not touched by this feature (confirmed by
  code review — `FinisherSequencer` never references `wager.js`,
  `leaderboard.js`, or `payout-requests.js`), and no errors surfaced from
  those systems while `endMatch()` ran during either verified match.

All of the above passed with the flag left at its default `false` in the
codebase — the override was only ever set from the *test's* init script, so
none of this changes production behavior on its own.

### Phase 11D — Expand per character (DONE, 2026-07-01)

- **Bespoke finisher per character**: already complete as of Phase 11A — all
  three current roster fighters (Pepe Samurai, Doge Drip, Gladiator) have a
  `finisher` strip and `anims.defs.finisher` entry.
- **Shared fallback for characters without bespoke assets**: already true by
  construction, verified by code read (no new code needed). A future
  character added to `ROSTER` without a `finisher` entry, or with one whose
  image hasn't finished loading, makes
  `FinisherSequencer.canStart()` return `false` (`anim`/`img` guard in
  `finisher-sequencer.js`), so `game.js`'s `roundend` block falls through to
  the original `announce("FINISH!", 1.2, true)` banner automatically. No
  per-character opt-in list or extra branching is required — silence in the
  data is the fallback.
- **Asset requirements, documented here** so a future character's finisher
  can be added without re-deriving the pattern:
  1. Character must already exist in PixelLab with a completed rotation set
     (same character ID used for its other Troll Kombat anims).
  2. Generate one more animation via `animate_character`: `mode: "v3"`,
     `directions: ["east"]` only (matches every other strip in this rig —
     mirrored by facing in-engine, so only east is ever needed),
     `frame_count: 8`, a short `action_description` of the finishing pose,
     `animation_name: "finisher"`. Cost is ~1-4 gens depending on character
     complexity — check `get_balance` first per
     [[feedback-minimize-pixellab-generations]].
  3. The returned strip is 9 frames (frame 0 is PixelLab's neutral reference
     frame, frames 1-8 are the animated pose — same shape as this rig's
     existing `jumping-1` strips). Download all 9 `east/*.png` frames and
     stitch them into one horizontal strip, cell width/height equal to the
     character's existing `anims.cell` (92 for Pepe-sized rigs, 180 for
     Doge-sized, 136 for Gladiator-sized — whatever that character's other
     strips already use), saved as
     `assets/games/troll-kombat/fighters/<rig>/anims/finisher.png`.
  4. Add `finisher: { frames: 9, fps: 12, loop: false }` to that character's
     `anims.defs` in `game.js`. Nothing else needs to change — the preload
     loop, `FinisherSequencer.canStart()`, and the `roundend` trigger are all
     already generic over `Object.keys(anims.defs)` / whichever fighter won.
  5. Re-run the Phase 11C verification pass (pause mid-fight, real KO to
     result, rematch, second match) with
     `window.TROLL_FLAGS_OVERRIDE = { ENABLE_BESPOKE_FINISHERS: true }`
     before considering the new character's finisher shippable.

## Live status

`ENABLE_BESPOKE_FINISHERS` is now `true` in `assets/js/troll-arcade-flags.js`
(flipped 2026-07-01, by explicit user decision after the Phase 11C
verification pass). Real players on a match-ending KO now see the winning
character's bespoke finisher pose in place of the generic "FINISH!" text
banner; the `coinBurst`/shake beat still fires on the same timer either way,
since that branch in `roundend` was left untouched. If a regression ever
needs to be ruled out fast, setting the flag back to `false` restores the
original generic-only flourish with no other code changes required.

## Non-goals for this pass

- No new fatality input parser.
- No new finisher hitboxes or damage.
- No changes to normal attacks, specials, AI, pause, wallet, payouts, leaderboard,
  or result flow.
- No automated payout or reward logic tied to finishers.
