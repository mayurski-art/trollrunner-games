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
| `assets/games/troll-casino/casino-wallet.js` | `TrollCasinoWallet` | REAL $TROLL/USDC balances (Supabase, per account), history, deposit()/requestRedemption() |
| `assets/games/troll-casino/casino-money-ui.js` | `TrollCasinoGate`, `TrollCasinoMoneyUI` | Hard login gate (guests blocked) + deposit/redeem modals |
| `assets/games/troll-casino/casino-admin.js` | — | `?admin=1` manual redemption review panel (password UI gate + server-side `is_admin` RLS) |
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
  a REAL shared progressive pool (`troll_casino_jackpot` in Supabase, per
  currency, fed 1.5% of each bet — every player feeds the same pot).
- **Crash** — P(crash ≥ m) = 0.96/m (4% edge, ~4% instant rugs, median ≈1.9×);
  crash point sampled by crypto RNG before ignition. Auto-exit beats frame
  quantization by design. Provably-fair seam: swap `sampleCrash`'s RNG for a
  committed server-seed reveal.

Separation rules the code follows (keep them):
- Scene logic never touches gameplay; it emits `"gameplay"` and game.js reacts.
- Gameplay never mutates balances; it calls `TrollCasinoWallet.debit/credit`.
- Deposits (money IN) go through TrollPay/Phantom directly, confirmed
  server-side and idempotent on the tx signature — see
  `troll_casino_confirm_deposit` in `assets/supabase/troll_casino.sql`
  (in the main site repo). Redemptions (money OUT) debit immediately and
  file a request a human reviews and pays by hand — there is no automatic
  payout. In-round bet/win deltas stay client-trusted, like every other
  game's score submission in this schema; the money rails (deposit/redeem)
  are the parts that are actually guarded server-side.
- This page is hard-gated behind login (`TrollCasinoGate` in
  casino-money-ui.js) — guests never reach the game engine at all.

## The scene system

`scenes.js` holds a `SCENES` array (image, kicker, title, sub). Transition
helpers — `fadeToScene / zoomToScene / slideToScene / focusCharacter /
enterGameplayMode` — set a transition class on the stage and CSS animates the
incoming layer. `playWalkthrough()` runs arrival → approach → circle → host
close-up → seated, skippable and tap-advancing; `replayIntro()` re-runs it
from the table. Scenes are reusable for future intros/loading/mode
transitions: call `show(n, "zoom")` etc. from any new mode.

**Video loops.** A same-named `.mp4` beside each scene PNG upgrades it to
looping footage (PNG stays as the poster; only the active scene decodes).
Audio follows the page's single sound toggle via
`TrollCasinoScenes.setAudio(on)` — game.js calls it; gameplay stays muted so
ambience never fights table SFX. `#room-ambient` accepts `.mp4` URLs too
(game.js mounts a muted looping `<video>` under its blur/dim filter): the
floor loops scene 1, the wheel room loops scene 5.

**Fewer clicks.** `?boot=1` (how the hub launches the page) skips the Enter
button: first-ever visit auto-plays the walkthrough, repeats jump straight to
the floor (`tc-intro-seen` in localStorage). `openRoom()` also auto-clicks the
room hero's sit CTA, so one tap on a floor card lands in the game.

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

## Real money (live)

Balances are real, per-account, and live in Supabase
(`assets/supabase/troll_casino.sql`, main site repo) — `troll_casino_wallet`,
`troll_casino_deposits`, `troll_casino_redemptions`, `troll_casino_jackpot`.
Run that SQL once (and flip your own `troll_profiles.is_admin` to `true` by
hand) before this page can work.

**Deliberately still manual:** redemptions are NOT auto-paid. A request
debits the player's balance and sits `pending`; you review it at
`troll-casino.html?admin=1`, send the payout yourself, then mark it paid
(or reject it, which auto-refunds). Automating that leg would need a
server-held treasury signer — a real infra/security project of its own,
not something bolted on here. See `docs/PHASE10-WALLET-UTILITY.md` for why
that's intentionally out of scope.
