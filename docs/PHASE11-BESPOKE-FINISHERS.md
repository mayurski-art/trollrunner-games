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

### Phase 11B — Sequencer scaffold behind a flag

- Add `ENABLE_BESPOKE_FINISHERS: false` to arcade flags.
- Implement `FinisherSequencer` in its own isolated section/file.
- When the flag is off, keep the current generic flourish.

### Phase 11C — One character proof of concept

- Implement one safe, short finisher for one character.
- Use existing states/effects first, then add a dedicated pixel strip only if the
  asset pipeline is ready.
- Verify timeout KOs, non-KO match wins, rematch, pause reset, wager approval,
  leaderboard recording, and result overlay still work.

### Phase 11D — Expand per character

- Add one bespoke finisher per character via the data format.
- Keep a shared fallback for characters without bespoke assets.
- Document asset requirements for each finisher strip.

## Non-goals for this pass

- No new fatality input parser.
- No new finisher hitboxes or damage.
- No changes to normal attacks, specials, AI, pause, wallet, payouts, leaderboard,
  or result flow.
- No automated payout or reward logic tied to finishers.
