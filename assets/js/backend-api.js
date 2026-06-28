/* ============================================================================
   TROLL RUNNER ARCADE  —  Backend API (Phase 10 stubs)

   The verification seam for real-money features. The frontend must NOT be
   trusted to decide winners, reward amounts, claim eligibility, payment
   confirmation, or prize distribution — those go through here.

   STATE TODAY: there is NO real backend. `isReal()` is false, so every "real"
   verification returns "unavailable" and real money paths cannot finalize.
   The mock responses below let the sandbox/mock mode exercise the full UX
   without any server or wallet.

   To go live later: set `config.baseUrl` to a real API and implement these
   endpoints server-side (each must do real on-chain / DB checks).
   ============================================================================ */
(() => {
  "use strict";
  if (window.TrollBackend) return;   // singleton

  const config = {
    baseUrl: null,        // null = no real backend (mock only)
    timeoutMs: 12000,
  };
  const isReal = () => !!config.baseUrl;

  const uid = (p) => p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const NO_BACKEND = { ok: false, reason: "no-backend", message: "Backend verification is not available." };

  // Real call helper (only used when isReal()); fails closed.
  async function call(path, body) {
    if (!isReal()) return NO_BACKEND;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), config.timeoutMs);
      const res = await fetch(config.baseUrl.replace(/\/$/, "") + path, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}), signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) return { ok: false, reason: "http-" + res.status };
      return await res.json();
    } catch (e) {
      return { ok: false, reason: "network", message: String(e && e.message || e) };
    }
  }

  // Append-only client log (for review/debugging; not a security control).
  const log = [];
  function record(event, data) {
    const entry = { event, data: data || {}, ts: Date.now() };
    log.push(entry);
    try { console.info("[TrollBackend:event]", event, data || ""); } catch (_) {}
    return entry;
  }

  window.TrollBackend = {
    config,
    isReal,
    getLog: () => log.slice(),
    record,

    // --- wallet session ----------------------------------------------------
    async verifyWalletSession({ address } = {}) {
      record("wallet_session_verify", { address });
      if (isReal()) return call("/wallet/session", { address });
      return { ok: true, mock: true, session: uid("mocksess"), address };
    },

    // --- payments ----------------------------------------------------------
    // The server should mint a single-use intent (id + nonce + expiry) tied to
    // the action/amount/token/destination so a tx can be matched + de-duped.
    async createPaymentIntent({ action, token, amount, amountUsd, wallet, destination } = {}) {
      record("payment_intent_create", { action, token, amount, amountUsd, wallet, destination });
      if (isReal()) return call("/payments/intent", { action, token, amount, amountUsd, wallet, destination });
      return {
        ok: true, mock: true,
        intentId: uid("intent"), nonce: uid("nonce"),
        action, token, amount, amountUsd, destination,
        expiresAt: Date.now() + 5 * 60 * 1000,
      };
    },
    // REAL verification of an on-chain tx against an intent. No backend = not verified.
    async verifyTransaction({ intentId, txSig, wallet, token, amount } = {}) {
      record("payment_verify", { intentId, txSig, wallet, token, amount });
      if (isReal()) return call("/payments/verify", { intentId, txSig, wallet, token, amount });
      return { ok: false, verified: false, reason: "no-backend",
               message: "Real payments require backend on-chain verification (not available)." };
    },

    // --- leaderboard / rewards eligibility ---------------------------------
    async getLeaderboardEligibility({ gameId, wallet, weekId } = {}) {
      record("lb_eligibility", { gameId, wallet, weekId });
      if (isReal()) return call("/leaderboard/eligibility", { gameId, wallet, weekId });
      // Mock: never qualifies for REAL prizes from local stats alone.
      return { ok: true, mock: true, eligible: false, reason: "mock-no-server-rank",
               message: "Real prize eligibility is decided server-side (mock: not eligible)." };
    },
    async getClaimEligibility({ rewardId, wallet } = {}) {
      record("claim_eligibility", { rewardId, wallet });
      if (isReal()) return call("/rewards/claim-eligibility", { rewardId, wallet });
      return { ok: true, mock: true, eligible: true, mockOnly: true };
    },
    async getClaimStatus({ claimId } = {}) {
      if (isReal()) return call("/rewards/claim-status", { claimId });
      return { ok: true, mock: true, status: "completed", claimId };
    },
    async getRewardHistory({ wallet } = {}) {
      if (isReal()) return call("/rewards/history", { wallet });
      return { ok: true, mock: true, items: [] };
    },

    // --- anti-abuse --------------------------------------------------------
    // Server-side checks: replayed sigs, duplicate claims, wallet spoofing, rate.
    async antiAbuseCheck({ type, wallet, ctx } = {}) {
      record("anti_abuse_check", { type, wallet });
      if (isReal()) return call("/anti-abuse/check", { type, wallet, ctx });
      return { ok: true, mock: true, allowed: true };
    },
  };
})();
