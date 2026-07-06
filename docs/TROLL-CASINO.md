# Troll Casino — architecture

A futuristic neon crypto casino inside the Troll Runner Arcade. First game
mode: **Troll Wheel**, a custom 24-segment money wheel. Built to grow into a
multi-game casino (slots, blackjack, crash, VIP room) without restructuring.

Live page: `troll-casino.html` · Hub card: `index.html` (004).

## Module map

| File | Global | Owns |
|---|---|---|
| `troll-casino.html` | — | All UI markup (real HTML — no baked-in image text), script order, page glue |
| `assets/games/troll-casino/style.css` | — | Design tokens, scene stage + transitions, game UI, responsive |
| `assets/games/troll-casino/scenes.js` | `TrollCasinoScenes` | The 5-scene cinematic walkthrough, transitions, parallax, gameplay handoff |
| `assets/games/troll-casino/casino-wallet.js` | `TrollCasinoWallet` | $TROLL/USDC balances (mock, localStorage), history, deposit/withdraw stubs |
| `assets/games/troll-casino/game.js` | `TrollCasino` | Troll Wheel model + renderer + spin flow, audio synth, FX, game-mode registry |
| `assets/games/troll-casino/leaderboard.js` | — | Config for the shared `TrollLeaderboard` engine |
| `assets/games/troll-casino/scenes/` | — | Scene art drop-in (see its README) |

Separation rules the code follows (keep them):
- Scene logic never touches gameplay; it emits `"gameplay"` and game.js reacts.
- Gameplay never mutates balances; it calls `TrollCasinoWallet.debit/credit`.
- Money movement (real or mock) only ever routes through the shared Phase 10
  stack (`TrollWallet` → `TrollPayments`), which fails closed behind
  `TROLL_FLAGS`. This page ships with everything real OFF.

## The scene system

`scenes.js` holds a `SCENES` array (image, kicker, title, sub). Transition
helpers — `fadeToScene / zoomToScene / slideToScene / focusCharacter /
enterGameplayMode` — set a transition class on the stage and CSS animates the
incoming layer. `playWalkthrough()` runs arrival → approach → circle → host
close-up → seated, skippable and tap-advancing; `replayIntro()` re-runs it
from the table. Scenes are reusable for future intros/loading/mode
transitions: call `show(n, "zoom")` etc. from any new mode.

## The Troll Wheel

24 segments, defined once in `SEGMENTS` (game.js). Zone counts, odds shown in
the paytable, and bet-board labels are all **computed from that array** — edit
the array and the whole table stays truthful.

| Zone | Segments | Pays | Player EV |
|---|---|---|---|
| TROLL | 11 | ×2 | 91.7% |
| DOUBLE TROLL | 7 | ×3 | 87.5% |
| TRIPLE TROLL | 4 | ×5 | 83.3% |
| WHALE | 1 | ×20 | 83.3% |
| RUG PULL | 1 | house | — |

"Pays ×N" returns stake × N (stake debited up front). RNG is
`crypto.getRandomValues` with rejection sampling (exactly uniform). The spin
animation eases to a pre-chosen segment; the result is decided before the
wheel moves, never by where pixels stop.

## Wiring (same stack as every arcade game)

- **Leaderboard**: `TrollLeaderboard.record("troll-casino", { won, mult, zone })`
  per spin. Stats are currency-neutral (spins/hits/best multiplier) so
  $TROLL and USDC play ranks together. Prizes display-only, mock.
- **XP / accounts**: `TrollrunnerAccounts.reportGameResult("troll-casino",
  mult*100, meta)` per spin — no-op for guests.
- **TrollNotis + site-lock + Supabase**: loaded page-bottom, arcade standard.

## Adding the next casino game (slots / blackjack / crash)

1. New module: `assets/games/troll-casino/<game>.js`, own the new panel's DOM.
2. Register it: `TrollCasino.registerGame({ id, name, live: true, mount })` —
   until then, register with `live:false` to list it under "More tables".
3. Reuse `TrollCasinoWallet` for stakes (never touch balances directly) and
   the scene engine for its intro (`show(n, "zoom")` or new scenes appended
   to `SCENES` with their own art files).
4. Record results to the shared leaderboard under the same `troll-casino`
   gameId (add columns in leaderboard.js) or a new gameId if it needs its
   own ladder.
5. New scene art sets follow the scenes/README.md rules (no baked-in UI text).

## Going real later (deliberately not done)

Mock chips live in localStorage (`troll-casino-wallet-v1`). To make balances
real: swap `load/save/debit/credit` in casino-wallet.js for backend calls
(`assets/js/backend-api.js`) keyed to the signed-in account, and move spin
settlement server-side (stake escrow → verified result → payout). Wallet
connect stays `TrollWallet`; on-chain movement stays `TrollPayments`;
withdrawals need the Part 2 payout backend (`docs/PART2-SYSTEMS.md`). All of
it stays behind `TROLL_FLAGS` — which ship OFF.
