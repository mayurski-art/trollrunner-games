/*
 * Troll Runner Arcade — shared payment config (single source of truth).
 * Used by both Troll Dash (revive) and Troll Kombat (continue).
 * Pay-per-action: each revive/continue is one on-chain SPL transfer to the
 * treasury. No backend — the confirmed transaction is the authorization.
 */
(function () {
  'use strict';

  // ── DEVNET MODE ──────────────────────────────────────────────────────────
  // true  = devnet (fake money, safe for testing)
  // false = mainnet (real money — flip before going live)
  var DEVNET = true;

  window.TROLL_PAY_CONFIG = {

    DEVNET_MODE: DEVNET,

    // ── Solana ──────────────────────────────────────────────────────────────
    SOLANA_NETWORK:  DEVNET ? 'devnet' : 'mainnet-beta',
    SOLANA_RPC:      DEVNET ? 'https://api.devnet.solana.com'
                            : 'https://api.mainnet-beta.solana.com',
    EXPLORER_BASE:   'https://solscan.io/tx/',
    EXPLORER_SUFFIX: DEVNET ? '?cluster=devnet' : '',

    // All payments go here. Single transfer — no splits.
    TREASURY_WALLET: '79vVRZ7qnZfj9xCto5d9Kwf4eAimqMDrQysZjHBbFbsA',

    // ── Token mints ───────────────────────────────────────────────────────────
    // Devnet USDC (Circle's devnet mint). Get test tokens at spl-token-faucet.com
    // Mainnet USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
    USDC_MINT:     DEVNET ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
                          : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDC_DECIMALS: 6,
    // $TROLL has no devnet equivalent. While this is 'FILL_ME_IN' (or in devnet
    // mode) the $TROLL pay option is hidden and everything runs on USDC.
    // TODO: fill in the real $TROLL SPL mint address before enabling on mainnet.
    TROLL_MINT:     'FILL_ME_IN',
    TROLL_DECIMALS: 9,

    // ── Price feed ($TROLL → USD) ─────────────────────────────────────────────
    // Jupiter price API (free, no key). Used to convert the USD price into a
    // $TROLL amount at pay time.
    PRICE_FEED_URL: 'https://api.jup.ag/price/v2?ids=',

    // ── Pricing ────────────────────────────────────────────────────────────────
    // Base price in USD; the 6.9% treasury tax is added on top at checkout.
    // 0.69 + 6.9% = 0.737610  →  shown as "0.74 USDC".
    REVIVE_PRICE_USD: 0.69,
    TAX_RATE:         0.069,
  };
})();
