/*
 * TROLL_PAY_CONFIG for the arcade games (revive / continue payments).
 * Canonical TrollPay lib + template live at trollrunner.net/assets/js/.
 * Load BEFORE the cross-origin troll-pay.js, which loads before game.js.
 */
(function () {
  'use strict';

  // false = mainnet (real money + real $TROLL). This is the live mode.
  // true  = devnet (fake USDC, no $TROLL, flaky confirmation) — testing only.
  var DEVNET = false;

  window.TROLL_PAY_CONFIG = {

    DEVNET_MODE: DEVNET,

    SOLANA_NETWORK:  DEVNET ? 'devnet' : 'mainnet-beta',
    // api.mainnet-beta.solana.com 403s browser apps — use PublicNode (free, no key).
    SOLANA_RPC:      DEVNET ? 'https://api.devnet.solana.com'
                            : 'https://solana-rpc.publicnode.com',
    EXPLORER_BASE:   'https://solscan.io/tx/',
    EXPLORER_SUFFIX: DEVNET ? '?cluster=devnet' : '',

    // The Troll Fund treasury — every revive payment lands here.
    TREASURY_WALLET: '79vVRZ7qnZfj9xCto5d9Kwf4eAimqMDrQysZjHBbFbsA',

    // Mainnet USDC. Devnet USDC: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
    USDC_MINT:     DEVNET ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
                          : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDC_DECIMALS: 6,
    // $TROLL — Solana mainnet, 6 decimals (verified). No devnet equivalent.
    TROLL_MINT:     DEVNET ? 'FILL_ME_IN'
                          : '5UUH9RTDiSpq6HKS6bp4NdU9PNJpXRXuiw6ShBTBhgH2',
    TROLL_DECIMALS: 6,

    // Jupiter Price API v3 (free lite tier) → { "<mint>": { "usdPrice": … } }
    PRICE_FEED_URL: 'https://lite-api.jup.ag/price/v3?ids=',

    // Revive price: $0.69 base + 6.9% tax (TrollPay applies the tax at pay time).
    REVIVE_PRICE_USD: 0.69,
    TAX_RATE:         0.069,
  };
})();
