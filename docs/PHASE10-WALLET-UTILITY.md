# Phase 10 — Real wallet / payment / reward utility layer

Builds the **modular, flag-gated, mock-default** utility layer that *can* power
real Phantom wallet connection, USDC/$TROLL payments, and token-reward claims —
**without activating any of it**. Everything real is OFF by default and fails
closed. The live games are untouched and remain fully playable.

> Builds on the Phase 9 inventory in [PART2-SYSTEMS.md](PART2-SYSTEMS.md).
> The existing real on-chain lib is **TrollPay** (`troll-pay.js`, main repo); this
> layer wraps/coordinates it behind safety gates rather than replacing it.

## Modules (all in `assets/js/`, vanilla globals)

| File | Global | Role |
|------|--------|------|
| `troll-arcade-flags.js` | `TROLL_FLAGS` | Central ON/OFF switches. Real OFF, mock ON. |
| `backend-api.js` | `TrollBackend` | Verification seam (mock). `isReal()===false` → real paths can't finalize. |
| `wallet.js` | `TrollWallet` | Phantom detect/connect/disconnect/address/state/events + status chip UI. |
| `payments.js` | `TrollPayments` | Confirmation screen + mock/real payment; real path delegates to `TrollPay`. |
| `tokenRewards.js` | `TrollRewards` | Pending/eligibility/claim states; backend-gated; mock/real. |
| `assets/css/troll-wallet.css` | — | Wallet chip, confirmation modal, rewards panel styles. |
| `wallet-lab.html` | — | **Isolated sandbox** exercising the full flow in mock mode. |

Open **`wallet-lab.html`** to try: connect (mock) wallet, "Pay 6.9 TROLL to
Revive" (confirmation → mock result), claim mock rewards, flip flags, watch the
backend event log.

## Safety model (enforced, verified)

- **Default OFF.** `ENABLE_WALLET_CONNECT`, `ENABLE_REAL_PAYMENTS`,
  `ENABLE_REAL_REWARDS`, `ENABLE_REAL_CLAIMS` are `false`. `ENABLE_MOCK_PAYMENTS`,
  `ENABLE_MOCK_REWARDS` are `true`.
- **Fails closed.** A real payment needs ALL of: flag ON + connected wallet +
  `window.TrollPay` loaded + a real backend (`TrollBackend.isReal()`). Missing any
  → it aborts (never transacts). A stray `true` flag alone does nothing.
- **Confirmation first.** `TrollPayments.requestPayment()` always shows the
  in-game confirmation screen (action, token, amount, destination, network,
  real-vs-mock warning) and only continues on **Confirm**. Phantom is opened only
  after that, only in real mode.
- **No auto-transactions / no gameplay coupling.** Gameplay never builds or sends
  a tx; it calls `requestPayment()` / `claim()` and reacts to the result. Wallet
  state lives only in `TrollWallet`.
- **Backend decides money.** Reward eligibility and claim availability come from
  `TrollBackend`, never local stats. Local leaderboard data can't qualify anyone
  for a real prize (mock returns `eligible:false` for real prizes).
- **Duplicate guard.** `requestPayment` has an in-flight lock + `dedupeKey` to
  prevent double-charge (e.g. double-tapping Revive).
- **Games untouched.** No live game loads these modules; turning everything OFF
  leaves the arcade exactly as it is.

Verified headlessly: mock pay succeeds, cancel/failure handled, **real pay & real
claim fail closed**, backend marks real tx unverified and local-stat prizes
ineligible.

## Feature flags

```js
// assets/js/troll-arcade-flags.js  (window.TROLL_FLAGS)
ENABLE_WALLET_CONNECT = false  // real Phantom connect (no money by itself)
ENABLE_REAL_PAYMENTS  = false  // real on-chain payments
ENABLE_REAL_REWARDS   = false  // real reward issuance (needs backend)
ENABLE_REAL_CLAIMS    = false  // real claim transactions (needs backend)
ENABLE_MOCK_PAYMENTS  = true   // simulate payments, no wallet/money
ENABLE_MOCK_REWARDS   = true   // simulate rewards/claims, no wallet/money
```

## Phantom flow & confirmation screen

1. Player clicks **Connect Phantom Wallet** (`TrollWallet.mountStatus`).
2. `connect()` → real Phantom (if `ENABLE_WALLET_CONNECT`) or a labeled mock.
3. UI shows a status chip with the **shortened address** + MOCK/PHANTOM badge +
   Disconnect; clear "Phantom not detected" warning when applicable.
4. Player triggers a paid action → `TrollPayments.requestPayment(...)`.
5. **Confirmation screen** shows action / token / amount / receiving address /
   network / real-vs-mock warning with **Confirm** + **Cancel**.
6. Only on Confirm (and only in real mode) does Phantom open, via `TrollPay.pay`.
7. Backend verifies the tx; UI updates only after `verified === true`.

## First utility use case — Pay 6.9 TROLL to Revive

Implemented **in the sandbox** (`wallet-lab.html`), mock mode:
- "You got rekt" → **Continue without revive** | **Pay 6.9 TROLL to Revive**.
- Revive → confirmation → mock payment → revive only on success; on
  cancel/fail/reject it does **not** revive and shows a clear message.
- The real path is wired but dormant (needs flags + `TrollPay` + backend).

> Note: Troll Dash already has a separate, live revive via TrollPay (Phase 8/9).
> This module is **not** wired into it yet — adopting it there is a deliberate
> later step, not done in this pass.

## Anti-abuse plan (for when real is enabled)

Client-side here is convenience only; the **server** must enforce:
- Reject replayed tx signatures; bind each tx to a single-use payment intent.
- Prevent duplicate claims and duplicate revive payments (intent + idempotency).
- Decide leaderboard eligibility server-side (don't trust local stats).
- Verify the claiming wallet (no spoofing); rate-limit; log payment/claim events
  with tx IDs for review (`TrollBackend.getLog()` is a client-side aid only).

## ACTIVATED: Troll Kombat wager (real mainnet, money-IN only)

The first real use case is live on the **Troll Kombat** page: a **Wager** control
in stage-select (mirrors the random-map ON/OFF toggle).

- Files: `assets/games/troll-kombat/wager.js` + CSS in the Kombat stylesheet.
  `troll-kombat.html` loads `troll-pay.js` + the Phase 10 stack and enables real
  flags **for that page only** via `window.TROLL_FLAGS_OVERRIDE` (every other page
  stays mock/OFF). The fight engine is untouched — `game.js` only calls
  `KombatWager.beforeFight()` from the stage→Fight launcher.
- Flow: turn Wager ON → type a custom **USDC** or **$TROLL** amount → Connect
  Phantom → hit Fight → **confirmation screen** → Phantom → real transfer to the
  treasury → match starts only on success (cancel/fail/reject ⇒ no match, clear
  message). Duplicate-guard prevents double-charge.
- Pricing: USDC is 1:1; $TROLL is converted to USD via the Jupiter price feed,
  then paid through `TrollPay`.

### ⚠️ Money-OUT (winnings/payouts) is NOT built — on purpose

This wager pays money **IN** (player → treasury) only. It does **not** pay
winners. Two hard reasons:

1. **Security:** sending tokens *from* the treasury requires the treasury's
   private key to sign. In a static site that key would have to live in browser
   JS — anyone could read it and drain the wallet. It must never be client-side.
   Payouts require a **server-held signer / backend escrow**.
2. **Legal:** staking real crypto to win real crypto on a game outcome is
   **gambling**, which carries licensing/jurisdiction/age-verification
   obligations. That's a product+legal decision, not a code toggle.

So today the wager is effectively a **real stake/entry payment**; any settlement
to winners is **manual / off-platform** until a backend escrow + compliance exist.
The UI says winnings are not automatic. Do not wire automated payouts without
that backend and a deliberate legal review.

### Manual winnings approval queue (dev-only)

A wagered **winner** sees a **"Send win for approval"** button on the result
screen. It submits the match + stake details to a dev-only Supabase table so the
developer can verify and pay the winner **by hand**.

- Module: `assets/js/payout-requests.js` (`TrollPayouts.submit`). Uses the same
  Supabase project as TrollNotis/chat. Run **`docs/payout_requests.sql`** once to
  create the table.
- **Access:** row-level security lets the public anon key **INSERT only** — no one
  can read claims with the public key. You review them in the **Supabase
  dashboard → Table Editor → `payout_requests`** (or via a service-role tool).
- **Stored per claim:** `game`, `match_id`, `wallet` (payout address), the stake
  (`stake_token`, `stake_amount`, `stake_usd`, **`stake_tx`** = the on-chain
  signature to verify, `network`), match context (`mode`, `difficulty`,
  `player_fighter`, `opponent_fighter`, `stage`), outcome (`won`, `winner`,
  `rounds_won`, `rounds_lost`, `kos`, `damage`), and bookkeeping (`claim_nonce`,
  `app_version`, `user_agent`, `created_at`, `status` default `pending`).
- **Your review flow:** open a `pending` row → check `stake_tx` on Solscan landed
  in the treasury for `stake_amount` → confirm `won` → pay `wallet` manually →
  set `status` to `paid`. The `stake_tx` unique index helps de-dupe replays; the
  client also keeps a local backup so a claim is never silently lost.

This is a manual queue, **not** an automated payout — no treasury key is ever in
the browser.

## Turning real ON later (checklist — do not do casually)

1. Stand up a real backend implementing every `TrollBackend` endpoint with real
   on-chain/DB checks; set `TrollBackend.config.baseUrl`.
2. Load `troll-pay.js` on the page and confirm `troll-pay-config.js` (devnet
   first).
3. Flip flags incrementally: wallet connect → mock-verify everything → devnet
   payments → mainnet. Keep mock mode available throughout.
4. Adopt into one game behind a confirmation screen; keep wallet/pay/reward code
   out of the game loop.
