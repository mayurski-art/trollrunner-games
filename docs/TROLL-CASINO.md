# Troll Casino — architecture

A futuristic neon crypto casino inside the Troll Runner Arcade. Four live
games behind one cinematic entrance: **Troll Wheel** (Trollface), **Diamond
Hands Blackjack** (Pepe), **Doge Jackpot Reels** (Doge), and **Whale Launch
Crash** (Elon). The walkthrough lands on a casino-floor lobby; each game is
a self-registering room.

Live page: `troll-casino.html` · Hub card: `index.html` (004).

## Module map

| File | Global | Owns |
|---|---|---|
| `troll-casino.html` | — | UI skeleton (real HTML — no baked-in image text), script order, page glue |
| `assets/games/troll-casino/style.css` | — | Design tokens, scene stage + transitions, wheel UI, shared chrome |
| `assets/games/troll-casino/rooms.css` | — | Casino floor, room hero pattern, blackjack/slots/crash UI |
| `assets/games/troll-casino/scenes.js` | `TrollCasinoScenes` | The 5-scene cinematic walkthrough, transitions, parallax, gameplay handoff |
| `assets/games/troll-casino/casino-wallet.js` | `TrollCasinoWallet` | $TROLL/USDC balances (mock, localStorage), history, deposit/withdraw stubs |
| `assets/games/troll-casino/game.js` | `TrollCasino` | Casino core: floor + room registry, shared audio/FX/reportRound — plus the Troll Wheel |
| `assets/games/troll-casino/blackjack.js` | `TrollCasinoBlackjack` | Pepe's Diamond Hands Blackjack (room module) |
| `assets/games/troll-casino/slots.js` | `TrollCasinoSlots` | Doge Jackpot Reels (room module) |
| `assets/games/troll-casino/crash.js` | `TrollCasinoCrash` | Whale Launch Crash (room module) |
| `assets/games/troll-casino/leaderboard.js` | — | Config for the shared `TrollLeaderboard` engine (one ladder, all rooms) |
| `assets/games/troll-casino/scenes/` | — | Walkthrough scene art drop-in (see its README) |
| `assets/games/troll-casino/art/` | — | Game-room hero art drop-in (see its README) |

## The room system

`game.js` owns a registry. Each room module calls
`TrollCasino.registerGame({ id, room, name, emoji, color, host, tagline, cta,
art, onEnter?, onLeave? })` at script-eval time and builds its interior into
its `<section class="game-room">` on DOMContentLoaded. The floor view renders
cards from the registry; `openRoom(id)` / `backToFloor()` swap views. Every
room follows the same two-state pattern from the art prompts: a cinematic
`.room-hero` (art or gradient) with one CTA, then `.room-play` with the real
HTML game. Shared services on `TrollCasino`: `audio` (WebAudio synth, one
mute state), `makeFX(canvas)` (coin bursts), and `reportRound(game, …)` (the
single leaderboard + XP integration point).

## Game math (all pure, node-tested, decided before animation)

- **Blackjack** — 6-deck crypto-shuffled shoe, dealer hits soft 17, BJ pays
  3:2, double any first two, one split (aces get one card), insurance 2:1.
- **Slots** — 5×3, 10 fixed paylines, weighted symbols, 😎 wild, 🚀 scatter
  (pays on total bet), 🐕 gold-doge jackpot: 3/4/5 anywhere = 25%/60%/100% of
  a LOCAL mock progressive meter (localStorage per currency, fed 1.5% of each
  bet). A real progressive needs a server-held pool.
- **Crash** — P(crash ≥ m) = 0.96/m (4% edge, ~4% instant rugs, median ≈1.9×);
  crash point sampled by crypto RNG before ignition. Auto-exit beats frame
  quantization by design. Provably-fair seam: swap `sampleCrash`'s RNG for a
  committed server-seed reveal.

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

## Adding the next casino game (VIP room, poker, …)

1. New module: `assets/games/troll-casino/<game>.js` — copy the shape of
   crash.js (smallest room): pure model between `/* MODEL:BEGIN/END */`
   markers, then DOM.
2. Add `<section class="game-room" id="room-<game>" hidden>` to the page and
   a `<script>` tag AFTER game.js.
3. Register with `TrollCasino.registerGame({...})`; build a `.room-hero` +
   `.room-play` interior (rooms.css already styles the pattern).
4. Stake through `TrollCasinoWallet` only; finish every round with
   `TrollCasino.reportRound(gameId, { won, mult, meta })`.
5. Hero art goes in `art/` per its README (no baked-in UI text).

## Going real later (deliberately not done)

Mock chips live in localStorage (`troll-casino-wallet-v1`). To make balances
real: swap `load/save/debit/credit` in casino-wallet.js for backend calls
(`assets/js/backend-api.js`) keyed to the signed-in account, and move spin
settlement server-side (stake escrow → verified result → payout). Wallet
connect stays `TrollWallet`; on-chain movement stays `TrollPayments`;
withdrawals need the Part 2 payout backend (`docs/PART2-SYSTEMS.md`). All of
it stays behind `TROLL_FLAGS` — which ship OFF.
