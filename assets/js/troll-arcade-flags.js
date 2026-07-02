/* ============================================================================
   TROLL RUNNER ARCADE  —  Feature flags (Phase 10)

   Central ON/OFF switches for the real-money utility layer. EVERYTHING real
   defaults to OFF; mock paths default ON. Nothing here, by itself, moves money.

   SAFETY MODEL
   - Real flags must be explicitly set true to even be *considered*. On top of
     that, each module ALSO requires a real backend + connected wallet + an
     on-chain library before anything real can happen, so a stray `true` here
     still can't complete a real transaction on its own.
   - Keep mainnet OFF until dev/test (mock) mode works cleanly.
   - To experiment safely, leave real flags false and use mock mode.
   ============================================================================ */
(() => {
  "use strict";
  if (window.TROLL_FLAGS) return;   // singleton

  const flags = {
    // --- real-money switches (DEFAULT OFF) ---------------------------------
    ENABLE_WALLET_CONNECT: false,   // allow real Phantom connect (no money by itself)
    ENABLE_REAL_PAYMENTS:  false,   // allow real on-chain payments
    ENABLE_REAL_REWARDS:   false,   // allow real reward issuance (needs backend)
    ENABLE_REAL_CLAIMS:    false,   // allow real claim transactions (needs backend)

    // --- mock switches (DEFAULT ON) ----------------------------------------
    ENABLE_MOCK_PAYMENTS:  true,    // simulate payments with no wallet/money
    ENABLE_MOCK_REWARDS:   true,    // simulate rewards/claims with no wallet/money

    // --- gameplay/cosmetic switches (DEFAULT OFF, no money involved) -------
    // Troll Kombat bespoke per-character finisher cinematics (Phase 11). Off
    // by default so the existing generic FINISH!/coinBurst flourish keeps
    // playing until the sequencer has been proven out per-character. See
    // trollrunner-games/docs/PHASE11-BESPOKE-FINISHERS.md.
    ENABLE_BESPOKE_FINISHERS: true,

    // --- helpers (read-only intent) ----------------------------------------
    // A real path is only "live" if its flag is on AND mock isn't forcing sim.
    walletConnectLive() { return this.ENABLE_WALLET_CONNECT === true; },
    realPaymentsLive()  { return this.ENABLE_REAL_PAYMENTS === true; },
    realRewardsLive()   { return this.ENABLE_REAL_REWARDS === true; },
    realClaimsLive()    { return this.ENABLE_REAL_CLAIMS === true; },
    // Convenience: is ANY real-money behaviour switched on at all?
    anyRealLive() {
      return this.realPaymentsLive() || this.realRewardsLive() || this.realClaimsLive();
    },

    // Merge overrides in code (e.g. a staging page). Never auto-enabled from URL.
    configure(partial) { if (partial) Object.assign(this, partial); return this; },
  };

  // Per-page opt-in: a page may set `window.TROLL_FLAGS_OVERRIDE = {...}` in an
  // inline <head> script BEFORE this module loads to enable real features on
  // that page only (shared defaults above stay OFF for every other page).
  if (window.TROLL_FLAGS_OVERRIDE) flags.configure(window.TROLL_FLAGS_OVERRIDE);

  // Loud console note so it's obvious in any deployment what's active.
  try {
    if (flags.anyRealLive() || flags.walletConnectLive()) {
      console.warn("[TROLL_FLAGS] A real-money/wallet flag is ON:", {
        wallet: flags.ENABLE_WALLET_CONNECT, payments: flags.ENABLE_REAL_PAYMENTS,
        rewards: flags.ENABLE_REAL_REWARDS, claims: flags.ENABLE_REAL_CLAIMS,
      });
    } else {
      console.info("[TROLL_FLAGS] Mock mode — all real-money features OFF.");
    }
  } catch (_) {}

  window.TROLL_FLAGS = flags;
})();
