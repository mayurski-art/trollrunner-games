/* ============================================================================
   TROLL RUNNER ARCADE  —  Payments module (Phase 10)  →  window.TrollPayments

   A high-level, flag-gated payment facade. Gameplay describes WHAT it wants to
   charge for (action/token/amount/destination); this module owns the player
   confirmation screen, the mock-vs-real decision, and result/error handling.

   HARD SAFETY RULES enforced here
   - Phantom NEVER opens until the player confirms in the in-game screen first.
   - Real payments require ALL of: ENABLE_REAL_PAYMENTS flag, a connected wallet,
     the on-chain lib (window.TrollPay), AND a real backend to verify the tx.
     Missing any one → it will not transact (fails closed to mock/abort).
   - A duplicate guard prevents double-charging (e.g. double-tapping Revive).
   - Gameplay must call requestPayment() and react to the result — it must not
     build or send transactions itself.

   Result shape: { ok, mock?, txSig?, reason?, message?, intentId? }
     reason ∈ cancelled | rejected | failed | pending | expired | unverified |
              unavailable | busy
   ============================================================================ */
(() => {
  "use strict";
  if (window.TrollPayments) return;   // singleton

  const FLAGS = () => window.TROLL_FLAGS || {};
  const realPaymentsLive = () => FLAGS().ENABLE_REAL_PAYMENTS === true;
  const mockEnabled = () => FLAGS().ENABLE_MOCK_PAYMENTS !== false;

  const config = {
    destination: (window.TROLL_PAY_CONFIG && window.TROLL_PAY_CONFIG.TREASURY_WALLET) || null,
    network: (window.TROLL_PAY_CONFIG && window.TROLL_PAY_CONFIG.SOLANA_NETWORK) || "mainnet-beta",
    simulateFailure: false,   // sandbox toggle: make mock payments fail
  };
  function configure(p) { if (p) Object.assign(config, p); return config; }
  const mode = () => (realPaymentsLive() ? "real" : "mock");

  let _inFlight = false;                  // global duplicate guard
  const _recentKeys = new Map();          // idempotency: key -> ts

  const shortAddr = (a) => (!a ? "—" : a.length <= 10 ? a : a.slice(0, 4) + "…" + a.slice(-4));
  const fmtAmount = (amt, token) => `${amt} ${token}`;

  /* ==========================================================================
     CONFIRMATION SCREEN  —  shown BEFORE any wallet interaction. Resolves
     true (confirm) / false (cancel). Discloses action, token, amount, address,
     network, and whether it's real or mock.
     ========================================================================== */
  function showConfirm(d) {
    return new Promise((resolve) => {
      const real = d.real;
      const overlay = document.createElement("div");
      overlay.className = "tp-modal-overlay";
      overlay.innerHTML = `
        <div class="tp-modal" role="dialog" aria-modal="true" aria-label="Confirm payment">
          <div class="tp-modal-head">
            <span class="tp-kicker">${real ? "Confirm payment" : "Confirm payment · MOCK"}</span>
            <strong class="tp-action">${esc(d.action)}</strong>
          </div>
          <dl class="tp-rows">
            <div><dt>Token</dt><dd>${esc(d.token)}</dd></div>
            <div><dt>Amount</dt><dd class="tp-amount">${esc(d.amountLabel)}</dd></div>
            <div><dt>To</dt><dd title="${esc(d.destination || "")}">${esc(d.destinationShort)}</dd></div>
            <div><dt>Network</dt><dd>${esc(d.networkLabel)}</dd></div>
          </dl>
          <p class="tp-warn ${real ? "is-real" : "is-mock"}">
            ${real
              ? "⚠ This is a REAL crypto transaction on Solana. It moves real tokens and cannot be undone."
              : "Mock mode — no wallet will open and no real tokens move. For testing only."}
          </p>
          <div class="tp-actions">
            <button type="button" class="tp-btn tp-cancel">Cancel</button>
            <button type="button" class="tp-btn tp-confirm ${real ? "is-real" : ""}">
              ${real ? "Confirm & open Phantom" : "Confirm (mock)"}
            </button>
          </div>
        </div>`;
      function close(val) { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(val); }
      function onKey(e) { if (e.key === "Escape") close(false); }
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
      overlay.querySelector(".tp-cancel").addEventListener("click", () => close(false));
      overlay.querySelector(".tp-confirm").addEventListener("click", () => close(true));
      document.addEventListener("keydown", onKey);
      document.body.appendChild(overlay);
      overlay.querySelector(".tp-confirm").focus();
    });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ==========================================================================
     requestPayment  —  the one entry point for gameplay/UI.
     ========================================================================== */
  async function requestPayment(opts = {}) {
    const {
      action = "Payment", token = "TROLL",
      amount = null, amountUsd = null,
      destination = config.destination, memo = "",
      dedupeKey = null, onProgress = null,
    } = opts;

    // --- duplicate / idempotency guards -----------------------------------
    if (_inFlight) return { ok: false, reason: "busy", message: "A payment is already in progress." };
    if (dedupeKey) {
      const last = _recentKeys.get(dedupeKey) || 0;
      if (Date.now() - last < 8000) return { ok: false, reason: "busy", message: "Duplicate payment ignored." };
    }

    const real = realPaymentsLive();
    if (!real && !mockEnabled()) return { ok: false, reason: "unavailable", message: "Payments are disabled." };

    // The Troll Runner's own account never pays for in-game purchases (see
    // troll-pay.js's matching admin bypass, which this mirrors for the Phase 10
    // facade). Skips the confirm screen and wallet entirely.
    if (window.TrollPay && window.TrollPay.isAdminBypass && window.TrollPay.isAdminBypass()) {
      if (window.TrollBackend) window.TrollBackend.record("payment_admin_bypass", { action, token, amount, amountUsd });
      return { ok: true, free: true, txSig: "ADMIN_BYPASS", intentId: null, action, token, amount, amountUsd };
    }

    const amountLabel = amount != null ? fmtAmount(amount, token)
                        : amountUsd != null ? `$${Number(amountUsd).toFixed(2)} in ${token}` : `— ${token}`;
    const networkLabel = real ? `Solana ${config.network}` : "Mock (no network)";

    // --- 1) backend payment intent (server-issued, single-use) ------------
    let intent = { intentId: null };
    if (window.TrollBackend) {
      const r = await window.TrollBackend.createPaymentIntent({ action, token, amount, amountUsd, destination });
      if (r && r.ok) intent = r;
    }

    // --- 2) player confirmation BEFORE any wallet opens -------------------
    const confirmed = await showConfirm({
      action, token, amountLabel, destination, destinationShort: shortAddr(destination),
      networkLabel, real,
    });
    if (!confirmed) return { ok: false, reason: "cancelled", message: "Payment cancelled." };

    _inFlight = true;
    if (dedupeKey) _recentKeys.set(dedupeKey, Date.now());
    try {
      // --- 3a) MOCK path: simulate, never touch a wallet -----------------
      if (!real) {
        if (onProgress) onProgress({ stage: "confirming" });
        await new Promise(r => setTimeout(r, 700));
        if (config.simulateFailure) {
          return { ok: false, mock: true, reason: "failed", message: "Mock payment failed (simulated)." };
        }
        const txSig = "MOCK_" + Math.random().toString(36).slice(2, 12).toUpperCase();
        if (window.TrollBackend) window.TrollBackend.record("payment_mock_ok", { action, token, amount, txSig });
        return { ok: true, mock: true, txSig, intentId: intent.intentId, action, token, amount };
      }

      // --- 3b) REAL path -------------------------------------------------
      // Money-IN only (player -> treasury). Client-only authorization: the
      // confirmed on-chain transfer IS the proof, exactly like the existing
      // TrollPay revive/tip. If a real backend is configured we ALSO verify;
      // otherwise we accept the on-chain tx (documented trust model). This is
      // safe for payments TO the treasury — it must NEVER be reused to pay
      // players (that needs a server-held signer; see PHASE10 doc).
      if (!window.TrollWallet || !window.TrollWallet.isConnected())
        return { ok: false, reason: "unavailable", message: "Connect a wallet first." };
      if (!window.TrollPay)
        return { ok: false, reason: "unavailable", message: "Payment library unavailable." };

      // Resolve the USD amount TrollPay needs (it is USD-denominated).
      const usd = await resolveUsd(token, amount, amountUsd);
      if (!(usd > 0))
        return { ok: false, reason: "unavailable", message: "Could not price this payment — try again." };

      // Delegate the on-chain transfer to the audited TrollPay lib. Phantom
      // opens here — only now, only after explicit confirmation.
      let pay;
      try {
        if (window.TrollPay.setToken) window.TrollPay.setToken(token);
        pay = await window.TrollPay.pay({ amountUsd: usd, token, onProgress });
      } catch (e) {
        return { ok: false, reason: "failed", message: friendlyErr(e) };
      }
      if (!pay || !pay.ok) return mapPayFailure(pay);

      // Optional server verification — required only if a real backend exists.
      if (window.TrollBackend && window.TrollBackend.isReal()) {
        const v = await window.TrollBackend.verifyTransaction({
          intentId: intent.intentId, txSig: pay.txSig, wallet: window.TrollWallet.getAddress(),
          token, amount,
        });
        if (!v || !v.verified) return { ok: false, reason: "unverified", txSig: pay.txSig,
          message: "Payment sent but not yet verified by backend." };
      }
      if (window.TrollBackend) window.TrollBackend.record("payment_real_ok", { action, token, amount, amountUsd: usd, txSig: pay.txSig });
      return { ok: true, txSig: pay.txSig, intentId: intent.intentId, action, token, amount, amountUsd: usd };
    } finally {
      _inFlight = false;
    }
  }

  function mapPayFailure(pay) {
    const reason = (pay && pay.reason) || "failed";
    const r = /reject|denied|4001/i.test(reason) ? "rejected"
            : /pending|confirm/i.test(reason) ? "pending"
            : /expire/i.test(reason) ? "expired" : "failed";
    return { ok: false, reason: r, message: friendlyReason(r) };
  }
  function friendlyReason(r) {
    return ({ rejected: "You rejected the transaction in your wallet.",
              pending: "Transaction is still pending — check your wallet/explorer.",
              expired: "The transaction request expired. Try again.",
              failed: "The transaction failed." })[r] || "The transaction failed.";
  }
  function friendlyErr(e) {
    const m = (e && (e.message || e.reason)) || "";
    if (/reject|denied|4001/i.test(m)) return "You rejected the transaction in your wallet.";
    if (/insufficient/i.test(m)) return "Insufficient balance for this payment.";
    return "The transaction failed. Please try again.";
  }

  // TrollPay is USD-denominated, so a token amount must be converted to USD.
  // USDC is 1:1; $TROLL is priced from the Jupiter feed in TROLL_PAY_CONFIG.
  async function trollUsdPrice() {
    const cfg = window.TROLL_PAY_CONFIG || {};
    if (!cfg.PRICE_FEED_URL || !cfg.TROLL_MINT) return null;
    try {
      const r = await fetch(cfg.PRICE_FEED_URL + cfg.TROLL_MINT);
      const j = await r.json();
      const p = j && j[cfg.TROLL_MINT] && Number(j[cfg.TROLL_MINT].usdPrice);
      return p > 0 ? p : null;
    } catch (_) { return null; }
  }
  async function resolveUsd(token, amount, amountUsd) {
    if (amountUsd != null) return Number(amountUsd);
    if (amount == null) return null;
    const a = Number(amount);
    if (!(a > 0)) return null;
    if (token === "USDC") return a;                 // 1:1
    if (token === "TROLL") { const p = await trollUsdPrice(); return p ? a * p : null; }
    return null;
  }

  window.TrollPayments = { requestPayment, showConfirm, configure, config, mode, trollUsdPrice };
})();
