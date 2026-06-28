# Phase 9 — Part 2 Systems: inspection report

**Status: INSPECTION ONLY. Nothing in this pass was activated, wired, or
scaffolded.** This document records what exists, what is partial, and what is
missing for the larger / money-adjacent "Part 2" systems, plus the safe path to
build them later. Part 2 is deliberately **not** being rushed in.

> ⚠️ Money-adjacent rule: do **not** activate real wallet connections, real
> payment flows, real token rewards, or any claim functionality. The one real
> payment surface that already exists (TrollPay revive) is described below so it
> can be kept isolated — not extended.

_Last inspected: 2026-06-28._

> **Phase 10 update:** the missing modules below (wallet / payments / tokenRewards
> / backend stubs / mock mode) now exist as a **flag-gated, mock-default
> foundation** — see [PHASE10-WALLET-UTILITY.md](PHASE10-WALLET-UTILITY.md). All
> real-money behaviour remains OFF and fails closed; the statuses below describe
> the pre-Phase-10 baseline.

## Summary

| # | System | Status | Where |
|---|--------|--------|-------|
| 1 | Pickups, 5 types | ❌ Missing (1 type exists) | Dash coins; Kombat flavor names only |
| 2 | Rare trollface-coin pending → claim | ❌ Missing | — (no reward/claim path anywhere) |
| 3 | Backend API stubs | 🟡 Partial | Leaderboard provider seam; TROLLCHAT Supabase (chat only) |
| 4 | Mock mode | 🟡 Partial | Leaderboard MockProvider; dead Dash mock-wallet remnants; TrollPay devnet |
| 5 | Shared `wallet.js` module | 🟡 Partial | Wallet logic embedded in `troll-pay.js` (no standalone module) |
| 6 | Shared `payments.js` module | ✅ Exists (REAL/LIVE) | `troll-pay.js` (main repo → trollrunner.net) |
| 7 | Shared `tokenRewards.js` module | ❌ Missing (by design) | — (payouts need a backend; intentionally absent) |
| 8 | Bespoke finishers | 🟡 Partial | Kombat generic finisher flourish; per-fighter names only |

Legend: ✅ exists · 🟡 partial/seam only · ❌ missing.

---

## The only real-money surface today: TrollPay

There is exactly one live money path in the arcade, and it predates Part 2:

- **Library:** `troll-pay.js` — canonical copy in the **main repo**
  (`mayurski-art.github.io/assets/js/troll-pay.js`), served at
  `https://trollrunner.net/assets/js/troll-pay.js`, with per-repo working copies.
  Docs: `mayurski-art.github.io/assets/js/PAYMENTS.md`. Brief:
  `trollrunner-games/docs/troll-payments-prompt.md`.
- **Config (this repo):** `assets/js/troll-pay-config.js` — currently
  `DEVNET = false`, i.e. **mainnet / real USDC + real $TROLL**, real treasury
  wallet `79vVRZ7…FbsA`.
- **What it does:** one SPL token transfer to the treasury, signed in Phantom,
  confirmed on-chain. `connect()`, `pay()`, `payForRevive()`, token picker,
  Solana Pay mobile fallback. No backend — the confirmed tx is the authorization.
- **Used by:** Troll Dash **Revive** (`assets/games/troll-dash/game.js`) and the
  trollrunner-finance **Tip Jar**.
- **Isolation:** all wallet/payment logic is inside `troll-pay.js`; gameplay only
  calls `window.TrollPay.*` and only ever after an explicit user tap. Troll
  **Kombat loads no payment library at all** (see its `<script>` tags) — so there
  is currently no money path in Kombat. Keep it that way unless intentionally
  building "Continue".

> PAYMENTS.md lists Kombat "Continue" as a user of TrollPay — that is
> **aspirational/stale**; the code does not load TrollPay in Kombat today.

**Do not extend this surface in Part 2.** Anything new (claims, rewards, more
games) must be mock-only and isolated until a reviewed, server-verified money
path exists.

---

## Per-system detail

### 1. Pickups (5 types) — ❌ Missing
- **Troll Dash:** one collectible type — `$TROLL` coins (`state.coinsArr`,
  `spawnCoinRow`). Hazards are separate and not pickups: 3 obstacle kinds
  `OB_BARRIER` / `OB_BEAM` / `OB_PIT` (`game.js:34–36`). No power-ups
  (magnet / shield / multiplier / etc.).
- **Troll Kombat:** each stage has a `pickup:` **name** ("Green Candle Smoothie",
  "Stamina Rocket", "Tidal Liquidity", …) in `STAGES` (`game.js:1258–1263`), but
  these are **flavor text only** — there is no spawn or collection logic.
- **Verdict:** a real 5-type pickup system does not exist. Flavor names are a good
  design seed. Building it is pure gameplay (no money) and safe to do later.

### 2. Rare trollface-coin pending → claim flow — ❌ Missing
- No reward/claim path exists in any game.
- The only "pending" today is a **payment** pending (Dash mobile Solana Pay
  round-trip: `REVIVE_PENDING_KEY = "troll_dash_revive_pending"`,
  `checkPendingMobileRevive()`), i.e. the user *pays out* and we confirm — the
  opposite of earning/claiming.
- **Money-adjacent & must stay mock:** "earn a rare coin → pending → claim" means
  paying tokens *to* the player. The client-only TrollPay pattern explicitly
  **cannot** authorize that (PAYMENTS.md: a server handing out a paid credit needs
  server-side on-chain verification). There is no such backend. Do not build the
  claim half until that exists. A mock-only "pending balance" UI (never touching a
  wallet) would be safe if desired.

### 3. Backend API stubs — 🟡 Partial
- **Leaderboard provider seam** (`assets/js/troll-leaderboard.js`): the UI talks
  only to `provider.getBoard()` / `provider.recordEvent()`; default is a
  `MockProvider`; `setProvider(gameId, p)` swaps in a real backend later. This is
  the cleanest existing "stub seam."
- **TROLLCHAT** uses Supabase Realtime — a real backend, but scoped to chat only.
- No API stubs exist for pickups, rewards, claims, or payments (payments are
  intentionally backend-less).
- **Verdict:** only the leaderboard seam is a ready integration point.

### 4. Mock mode — 🟡 Partial
- **Leaderboard:** proper mock mode (`MockProvider`, deterministic per-week
  rivals) — solid.
- **Dash:** legacy **dead** mock-wallet remnants — `MOCK_WALLET_START_BALANCE = 42`
  (`game.js:15`) and `state.walletBalance` (`game.js:97`). These are leftovers of
  the old `MockRevivePaymentProvider` (see `docs/troll-payments-prompt.md`); the
  live code uses real TrollPay and there is **no `#wallet-balance` element**, so
  the mock balance is never shown. Candidate for cleanup (or revival as a true
  offline mock).
- **TrollPay:** has a `DEVNET` switch, but devnet is still real on-chain, not a
  no-op mock.
- **Verdict:** no unified "mock mode" flag across the arcade. The leaderboard
  pattern (mock provider by default, swap later) is the model to follow.

### 5. Shared `wallet.js` module — 🟡 Partial (embedded)
- Wallet connection exists but is **inside** `troll-pay.js`: `connect()` (opens
  Phantom), `accountChanged` listener, `isConnected()`, `getWallet()`,
  `getPhantom()`.
- There is **no standalone `wallet.js`**. If a separate module is ever wanted,
  factor these out of `troll-pay.js` — but that is a refactor of live payment
  code; do it carefully and not in an "inspect" pass.

### 6. Shared `payments.js` module — ✅ Exists (real/live)
- This is `troll-pay.js` (named differently). Real, mainnet, in use. See the
  TrollPay section above. **Already done — do not rebuild or duplicate.**

### 7. Shared `tokenRewards.js` module — ❌ Missing (intentionally)
- No reward/payout issuance module exists. Issuing tokens *to* players requires a
  treasury-side signer + server verification, which is explicitly out of the
  current trust model (PAYMENTS.md). Correctly absent. Any future version is
  money-critical and must be server-side + audited — not a client module.

### 8. Bespoke finishers — 🟡 Partial
- **Kombat** has a generic finisher flourish on a match-ending KO: `FINISH!`
  announce → `coinBurst(...)` (cosmetic) → screen shake (`game.js:~1707–1715`,
  `coinBurst` at `game.js:1132`).
- Per-fighter finisher **names** exist (`ROSTER[].moves.finisher`, e.g.
  "Feels Bad, Man", "Very Rekt. Much Wow.") but there is **no per-character
  finisher animation/sequence**.
- **Verdict:** generic finisher works; **bespoke** finishers are missing. Pure
  gameplay/art work (no money) and safe to build later. Note the limited PixelLab
  generation budget if new finisher art is involved.

---

## If/when Part 2 is built — safe defaults

These are recommendations, **not** done in this pass:

1. **Keep money logic isolated.** Gameplay should only call thin facades
   (`TrollPay.*`, a future `TokenRewards.*`) — never embed wallet/tx code in a
   game loop.
2. **Mock-by-default, swap later.** Follow the leaderboard provider pattern: every
   new system ships with a mock provider and a `setProvider()` seam; real
   backends/wallets are opt-in and added last.
3. **No client-issued payouts.** Claims / token rewards require server-side
   on-chain verification + a treasury signer. Until that exists, any "claim" or
   "reward" UI must be a labeled mock that cannot touch a wallet (mirror the
   leaderboard's `prizes.live = false` guard).
4. **Don't auto-load wallet/payment libs** into games that don't need them
   (Kombat currently loads none — good).

### Recommended (not yet added) TODO anchor points
- `troll-dash/game.js:15` & `:97` — mark/remove dead `MOCK_WALLET_START_BALANCE`
  / `state.walletBalance` remnants.
- `troll-kombat/game.js` `STAGES[].pickup` (~1258) — note these are flavor names,
  not a pickup system (see this doc, §1).
- `troll-kombat/game.js` finisher flourish (~1707) — note per-fighter finishers
  are not yet bespoke (§8).
- `assets/js/PAYMENTS.md` — correct the stale "Kombat Continue" claim.
