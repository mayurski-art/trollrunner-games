# Implementation Prompt — Real $TROLL Payments (Phantom) for Troll Dash

> Hand this to an implementer (agent or human). It is a complete brief.
> Review the **Decisions** and **Treasury / ops checklist** first — a few
> real-world values must be filled in before coding can finish.

---

## 1. Context

`trollrunner-games` is a static, no-build, vanilla-JS site on GitHub Pages
(`games.trollrunner.net`). The flagship game `assets/games/troll-dash/game.js`
is a client-side endless runner. On death the player can **revive for 6.9
$TROLL**. Today that revive is faked by `MockRevivePaymentProvider` against a
pretend wallet balance; `FutureSolanaPaymentProvider` is a disabled stub.

We want the revive (and a new standalone Donate button) to send **real $TROLL
SPL tokens** from the player's **Phantom** wallet into the project **treasury
wallet** on Solana.

**Honest threat model (important, do not "fix"):** the whole game runs in the
browser. A real payment *triggers* the revive, but a technical user can always
grant themselves a free revive by editing JS in their console. We are NOT
building DRM. This is a **trust-based "donate to continue"** flow for a meme
community. So: no backend, no anti-replay database — we just confirm on-chain
that the tokens actually landed in the treasury, then grant the revive. If
server-authoritative scoring is ever added later, revisit this (see §11).

---

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Verification | **Client-only**, confirmed on-chain via RPC. No backend/DB. |
| Build target | **Devnet first** (test mint), then flip config to **mainnet-beta**. |
| Scope | One reusable **`payTroll(amount)`** module → powers revive (6.9) **and** a standalone **Donate** button. |
| Platforms | **Desktop + mobile.** Injected Phantom provider (desktop extension + Phantom in-app browser) **and** a **Solana Pay** QR / deep-link fallback (external mobile browsers, desktop QR). |
| Constraint | **No build step.** Load `@solana/web3.js` + `@solana/spl-token` from an ESM CDN in a `<script type="module">`. No npm, no bundler. |

---

## 3. Required real-world values (fill these in — blockers)

Put these in a single `PAY_CONFIG` object at the top of the new module.

```js
const PAY_CONFIG = {
  NETWORK: "devnet",                      // "devnet" | "mainnet-beta"
  RPC: {
    "devnet":       "https://api.devnet.solana.com",
    "mainnet-beta": "https://<your-helius-or-quicknode-rpc>",  // public mainnet RPCs rate-limit; use a keyed endpoint
  },
  TROLL_MINT: {
    "devnet":       "<DEVNET_TEST_MINT_ADDRESS>",   // a test SPL mint you create (see ops checklist)
    "mainnet-beta": "<REAL_TROLL_SPL_MINT_ADDRESS>", // ⚠️ confirm the canonical $TROLL mint
  },
  TROLL_DECIMALS: { "devnet": 9, "mainnet-beta": 9 }, // ⚠️ MUST match each mint on-chain
  TREASURY_WALLET: "79vVRZ7qnZfj9xCto5d9Kwf4eAimqMDrQysZjHBbFbsA", // ⚠️ confirm you control this
  REVIVE_COST: 6.9,
  COMMITMENT: "confirmed",                // "confirmed" is fine for UX; "finalized" is stricter/slower
  POLL_TIMEOUT_MS: 90000,                 // Solana Pay reference-poll budget
};
```

**You must supply before mainnet:** the real $TROLL mint address, its decimals
(read from chain — do NOT guess), a reliable mainnet RPC (Helius/QuickNode/
Triton free tier recommended), and confirmation that you own the treasury
wallet and have created its $TROLL token account (see §9).

---

## 4. Architecture overview

```
                 ┌───────────────────────────────┐
   Death overlay │  Revive · 6.9 $TROLL  (button) │
   Arcade header │  Donate $TROLL        (button) │
                 └───────────────┬───────────────┘
                                 │ payTroll(amount, {label, message})
                 ┌───────────────▼───────────────────────────────┐
                 │  payments.js  (new ES module)                  │
                 │                                                │
                 │  detect Phantom (window.phantom.solana)        │
                 │   ├─ YES → injected flow:                      │
                 │   │     build SPL transferChecked tx           │
                 │   │     provider.signTransaction()             │
                 │   │     OUR Connection.sendRawTransaction()    │
                 │   │     confirmTransaction()                   │
                 │   └─ NO  → Solana Pay flow:                    │
                 │         build solana: URL w/ unique reference  │
                 │         show QR (desktop) / deep link (mobile) │
                 │         poll getSignaturesForAddress(reference)│
                 │                                                │
                 │  verifyTx(signature): err==null AND treasury   │
                 │     ATA balance delta ≥ amount → {ok:true,sig} │
                 └────────────────────────────────────────────────┘
```

Both paths converge on the same `verifyTx()` and return
`{ ok, signature, explorerUrl, reason }`. The game grants the revive only when
`ok === true`.

---

## 5. Files to change / add

- **NEW** `assets/games/troll-dash/payments.js` — ES module, the whole flow.
  Exports `createTrollPayments(config)` returning an object with:
  - `isPhantomAvailable()`
  - `connect()` → `{ publicKey }` (injected flow only)
  - `payTroll(amount, { label, message })` → `{ ok, signature, explorerUrl, reason }`
  - internal: `buildTransferTx`, `sendInjected`, `sendViaSolanaPay`, `verifyTx`
- **EDIT** `assets/games/troll-dash/game.js`
  - Delete `MockRevivePaymentProvider` + `FutureSolanaPaymentProvider` + the
    mock `walletBalance` bookkeeping in the HUD/death panel.
  - Import the payments module (the page must load `payments.js` as
    `type="module"`; `game.js` can stay a classic script and call a global
    set up by the module, **or** convert the revive call to read a
    `window.TrollPayments` the module assigns — keep it simple, no bundler).
  - `revive()` → `const r = await TrollPayments.payTroll(REVIVE_COST, {label:"Troll Dash Revive"})`. On `r.ok`, run the existing grant-revive logic and show the explorer link; else show `r.reason`.
- **EDIT** `index.html`
  - Add `<script type="module" src="assets/games/troll-dash/payments.js?v=...">`.
  - Death overlay: replace "Mock Mode" badge + mock wallet balance row with a
    real **Connect Wallet** affordance, the live connected address (truncated),
    a network badge (DEVNET/MAINNET), and a post-pay **"View transaction ↗"**
    link. Keep the cost + non-refundable disclaimer (update wording to "real").
  - Add a **Donate $TROLL** button (arcade header or cabinet footer) with a
    small amount picker (e.g. 1 / 6.9 / 42 / custom).
- **EDIT** `assets/games/troll-dash/style.css` — styles for connect button,
  address chip, network badge, donate modal, QR container, pay states.
- **EDIT** README — document config, the devnet→mainnet flip, and ops checklist.

---

## 6. Injected-provider flow (desktop extension + Phantom in-app browser)

1. **Detect:** `const provider = window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : null)`. If null → show "Install Phantom" CTA (`https://phantom.app/`) and offer the Solana Pay QR instead.
2. **Connect:** `await provider.connect()` → `provider.publicKey`. Cache it; show truncated address. Handle user-rejected connect.
3. **Build tx (use OUR Connection so we control the cluster):**
   - `const connection = new Connection(PAY_CONFIG.RPC[NETWORK], COMMITMENT)`
   - `mint = new PublicKey(TROLL_MINT[NETWORK])`, `treasury = new PublicKey(TREASURY_WALLET)`
   - `senderATA = getAssociatedTokenAddressSync(mint, provider.publicKey)`
   - `treasuryATA = getAssociatedTokenAddressSync(mint, treasury)`
   - amount in base units: `BigInt(Math.round(amount * 10 ** decimals))`
   - instruction: `createTransferCheckedInstruction(senderATA, mint, treasuryATA, provider.publicKey, amountBaseUnits, decimals)`
   - If treasury ATA may not exist, prepend `createAssociatedTokenAccountIdempotentInstruction(payer=provider.publicKey, treasuryATA, treasury, mint)` — **but prefer pre-creating it (§9)** so the payer doesn't eat ~0.002 SOL rent.
   - `tx.feePayer = provider.publicKey`; `tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash` (keep `lastValidBlockHeight`).
4. **Sign + send via our RPC** (so devnet/mainnet is OUR choice, not Phantom's selected network):
   - `const signed = await provider.signTransaction(tx)`
   - `const sig = await connection.sendRawTransaction(signed.serialize())`
   - `await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, COMMITMENT)`
   - (Note: `provider.signAndSendTransaction` is simpler but broadcasts on *Phantom's* selected cluster — avoid it so devnet testing doesn't depend on the user's Phantom network setting.)
5. **Verify** (`verifyTx`, §8) → grant.

## 7. Solana Pay flow (external mobile browsers; desktop QR fallback)

1. Generate a throwaway reference: `const reference = Keypair.generate().publicKey` (the secret is discarded — reference is just a unique on-chain marker).
2. Build the request URL:
   `solana:<TREASURY_WALLET>?spl-token=<MINT>&amount=<amount>&reference=<reference>&label=<label>&message=<message>`
   (Use the `@solana/pay` `encodeURL` helper, or hand-build — note `amount` here is in **decimal tokens**, not base units.)
3. **Desktop:** render the URL as a **QR code** ("Scan with Phantom mobile").
   **Mobile:** render a big "Open in Phantom" button linking to the same
   `solana:` URI (Phantom registers the scheme); also offer the QR.
4. **Poll** `connection.getSignaturesForAddress(reference, { limit: 1 })` every
   ~1.5s until found or `POLL_TIMEOUT_MS`. On hit, take the signature.
5. **Verify** (`verifyTx`, §8) → grant. Show timeout/cancel affordances.

> The Solana Pay path also works as a universal desktop fallback if Phantom
> isn't injected. Same `verifyTx`, same grant.

## 8. On-chain verification (`verifyTx(signature)`)

```
tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
assert tx && tx.meta && tx.meta.err == null;                  // succeeded
// find treasury ATA balance change for our mint
pre  = tx.meta.preTokenBalances.find(b => b.mint===MINT && b.owner===TREASURY);
post = tx.meta.postTokenBalances.find(b => b.mint===MINT && b.owner===TREASURY);
delta = post.uiTokenAmount.amount - (pre?.uiTokenAmount.amount ?? 0);   // base units
assert delta >= amountBaseUnits;                              // enough landed
return { ok:true, signature, explorerUrl: explorer(signature, NETWORK) };
```

This blocks the obvious "wrong/short amount" cases in the happy path. It does
**not** (and is not meant to) stop console cheating — accepted per §1.

## 9. Treasury / ops checklist (do before mainnet)

- [ ] Confirm you control `TREASURY_WALLET` (sign a test message / send from it).
- [ ] Get the **canonical $TROLL mint address** and read its **decimals** on-chain (e.g. `spl-token display <mint>` or an explorer). Put both in config.
- [ ] **Create the treasury's Associated Token Account** for the $TROLL mint on **mainnet** (and the test mint on **devnet**) so payers never pay ATA rent. (`spl-token create-account <mint>` from the treasury, or send it a dust amount once.)
- [ ] Keep a little SOL in payer test wallets for fees.
- [ ] Pick a **mainnet RPC** with headroom (Helius/QuickNode/Triton free tier). Public `api.mainnet-beta.solana.com` will rate-limit confirmation polling.
- [ ] **Devnet test mint:** `spl-token create-token --decimals 9`, `create-account`, `mint` some to a test wallet; set Phantom to devnet to click through.

## 10. UX states & error handling (map each to a clear message)

Phantom not installed · connect rejected · **wrong cluster** (devnet token vs
mainnet config — detect by mint-account-not-found / empty balance and explain)
· insufficient $TROLL · insufficient SOL for fee · user rejects signature ·
blockhash expired (rebuild + retry) · send failed · confirm timeout · Solana
Pay poll timeout / user cancels · success (show amount + truncated treasury +
explorer link). Disable the pay button while pending; never leave it spinning.

Disclosures: "Real transaction — sends actual $TROLL on `<network>`.
Non-refundable. Network fees apply. We never see your keys." First real pay
shows a one-time confirm.

## 11. Out of scope / later

- No backend, no anti-replay DB (accepted trust model).
- No leaderboard. If one is added later, scores must become
  server-authoritative before payments can mean anything anti-cheat-wise.
- No fiat on-ramp; player must already hold $TROLL + a little SOL.

## 12. Acceptance criteria

- [ ] No build step added; web3/spl loaded from CDN; site still works on GitHub Pages.
- [ ] Devnet: revive sends 6.9 test-$TROLL to treasury ATA, confirms, grants revive, shows explorer link. Donate sends a chosen amount. All §10 errors handled gracefully.
- [ ] Desktop extension, Phantom in-app browser, and external-mobile (Solana Pay QR/deep link) all reach a successful grant.
- [ ] Flipping `NETWORK` + filling mainnet mint/RPC switches to real $TROLL with **no other code changes**.
- [ ] One small real mainnet donate verified end-to-end before launch.
- [ ] No private keys or secrets in client code. Reference keypair secret discarded.
```
```

---

### Quick reference — libraries

```html
<script type="module">
  import { Connection, PublicKey, Transaction, Keypair } from "https://esm.sh/@solana/web3.js@1";
  import {
    getAssociatedTokenAddressSync,
    createTransferCheckedInstruction,
    createAssociatedTokenAccountIdempotentInstruction,
  } from "https://esm.sh/@solana/spl-token@0.4";
  // (optional) import { encodeURL, findReference } from "https://esm.sh/@solana/pay@0.2";
</script>
```

**Known gotcha:** `@solana/spl-token` references Node `Buffer`. esm.sh usually
shims it, but if you hit `Buffer is not defined`, add a tiny polyfill
(`import { Buffer } from "https://esm.sh/buffer"; window.Buffer ??= Buffer;`)
before importing spl-token. Pin versions once a working combo is found.
