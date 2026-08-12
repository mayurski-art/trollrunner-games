/* ============================================================================
   TROLL CASINO  —  money UI: hard login gate + deposit/redeem modals

   Real money moves in this game, so guests are hard-blocked at the door:
   TrollCasinoGate covers the whole viewport with a login/signup form until
   a real session exists, and troll-casino.html's boot script awaits
   TrollCasinoGate.ready before starting the walkthrough/game engine at all.

   TrollCasinoMoneyUI.openDeposit()/openRedeem() are the modals the "＋ Add
   chips" / "Redeem" buttons in game.js open. Both talk to
   window.TrollCasinoWallet — this file owns no balance state itself.
   ============================================================================ */
(() => {
  "use strict";

  const accounts = () => window.TrollrunnerAccounts;

  /* ================= GATE ================= */
  if (!window.TrollCasinoGate) {
    let resolveReady;
    const ready = new Promise(res => { resolveReady = res; });

    function buildGate() {
      const host = document.getElementById("casino-viewport");
      if (!host || document.getElementById("tc-gate")) return;
      const gate = document.createElement("div");
      gate.className = "tc-gate";
      gate.id = "tc-gate";
      gate.innerHTML = `
        <div class="tc-gate-card">
          <h2>Troll Casino</h2>
          <p>Real $TROLL and USDC only — log in or create a free account to play.
             Guests can't enter since real money moves here.</p>
          <div class="tc-tab-row">
            <button type="button" data-tab="login" class="is-active">Log in</button>
            <button type="button" data-tab="signup">Create account</button>
          </div>
          <form id="tc-gate-form">
            <div class="tc-field" id="tc-gate-username-field" hidden>
              <label>Username</label>
              <input type="text" id="tc-gate-username" autocomplete="username">
            </div>
            <div class="tc-field" id="tc-gate-id-field">
              <label id="tc-gate-id-label">Username or email</label>
              <input type="text" id="tc-gate-identifier" autocomplete="username">
            </div>
            <div class="tc-field" id="tc-gate-email-field" hidden>
              <label>Email (optional, for password recovery)</label>
              <input type="email" id="tc-gate-email" autocomplete="email">
            </div>
            <div class="tc-field">
              <label>Password</label>
              <input type="password" id="tc-gate-password" autocomplete="current-password">
            </div>
            <button type="submit" class="tc-btn" id="tc-gate-submit">Log in</button>
          </form>
          <p class="tc-status" id="tc-gate-status" aria-live="polite"></p>
          <a href="/" class="tc-btn tc-btn--ghost" style="display:inline-block;text-decoration:none;text-align:center;">← Back to Arcade</a>
        </div>`;
      host.appendChild(gate);

      let mode = "login";
      const tabs = gate.querySelectorAll(".tc-tab-row button");
      const idLabel = gate.querySelector("#tc-gate-id-label");
      const usernameField = gate.querySelector("#tc-gate-username-field");
      const emailField = gate.querySelector("#tc-gate-email-field");
      const submitBtn = gate.querySelector("#tc-gate-submit");
      const statusEl = gate.querySelector("#tc-gate-status");

      function setMode(next) {
        mode = next;
        tabs.forEach(t => t.classList.toggle("is-active", t.dataset.tab === mode));
        const isSignup = mode === "signup";
        usernameField.hidden = !isSignup;
        emailField.hidden = !isSignup;
        idLabel.textContent = isSignup ? "Username" : "Username or email";
        submitBtn.textContent = isSignup ? "Create account" : "Log in";
        statusEl.textContent = "";
      }
      tabs.forEach(t => t.addEventListener("click", () => setMode(t.dataset.tab)));

      gate.querySelector("#tc-gate-form").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        submitBtn.disabled = true;
        statusEl.className = "tc-status";
        statusEl.textContent = mode === "signup" ? "Creating account…" : "Logging in…";
        try {
          if (mode === "signup") {
            const username = gate.querySelector("#tc-gate-username").value.trim();
            const email = gate.querySelector("#tc-gate-email").value.trim();
            const password = gate.querySelector("#tc-gate-password").value;
            await accounts().register({ username, email, password });
          } else {
            const identifier = gate.querySelector("#tc-gate-identifier").value.trim();
            const password = gate.querySelector("#tc-gate-password").value;
            await accounts().login({ identifier, password });
          }
          statusEl.className = "tc-status is-ok";
          statusEl.textContent = "Welcome — loading the casino…";
          unlock();
        } catch (e) {
          statusEl.className = "tc-status is-bad";
          statusEl.textContent = (e && e.message) || "Something went wrong.";
          submitBtn.disabled = false;
        }
      });
    }

    function unlock() {
      const gate = document.getElementById("tc-gate");
      if (gate) gate.remove();
      resolveReady();
    }

    async function check() {
      const a = accounts();
      if (!a) { setTimeout(check, 150); return; } // accounts script not parsed yet
      const session = a.getCachedProfile() || await a.getSession();
      if (session) { unlock(); return; }
      buildGate();
    }

    window.addEventListener("trollrunner:auth-changed", (e) => { if (e.detail) unlock(); });

    window.TrollCasinoGate = { ready, check };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", check);
    else check();
  }

  /* ================= DEPOSIT / REDEEM MODALS ================= */
  if (window.TrollCasinoMoneyUI) return;

  function wallet() { return window.TrollCasinoWallet; }

  function openBackdrop(bodyHtml) {
    const backdrop = document.createElement("div");
    backdrop.className = "tc-modal-backdrop";
    backdrop.innerHTML = `<div class="tc-modal" role="dialog" aria-modal="true">
        <button type="button" class="tc-modal-close" aria-label="Close">✕</button>
        ${bodyHtml}
      </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector(".tc-modal-close").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    return { backdrop, modal: backdrop.querySelector(".tc-modal"), close };
  }

  // USD preset amounts shown per currency — TROLL's top preset is lower than
  // USDC's since it's the "cheap fun money" side of the till.
  const DEPOSIT_PRESETS = { USDC: [1, 4.20, 20, 69], TROLL: [1, 4.20, 6.9] };

  function openDeposit() {
    if (!wallet() || !wallet().isReady()) { alert("Log in first to deposit."); return; }
    let token = wallet().getCurrency();
    const { modal, close } = openBackdrop(`
      <h2>Add funds</h2>
      <p class="tc-sub">Pay real $TROLL or USDC via Phantom. It's converted 1:1 into your casino balance —
         redeem it back to your wallet any time from the Redeem screen.</p>
      <div class="tc-token-toggle" id="tc-dep-tok">
        <button type="button" data-t="TROLL">$TROLL</button>
        <button type="button" data-t="USDC">USDC</button>
      </div>
      <div class="tc-preset-row" id="tc-dep-presets"></div>
      <div class="tc-field">
        <label>Amount (USD)</label>
        <input type="number" id="tc-dep-amount" min="1" step="0.01" placeholder="10.00">
      </div>
      <p class="tc-sub" id="tc-dep-preview"></p>
      <button type="button" class="tc-btn" id="tc-dep-submit">Deposit</button>
      <p class="tc-status" id="tc-dep-status" aria-live="polite"></p>`);

    const tokBtns = modal.querySelectorAll("#tc-dep-tok button");
    const presetsEl = modal.querySelector("#tc-dep-presets");
    const amountInput = modal.querySelector("#tc-dep-amount");
    const previewEl = modal.querySelector("#tc-dep-preview");

    function renderPresets() {
      presetsEl.innerHTML = DEPOSIT_PRESETS[token].map(v => `
        <button type="button" class="tc-preset-btn" data-v="${v}">$${v.toFixed(2).replace(/\.00$/, "")}</button>`
      ).join("") + `<button type="button" class="tc-preset-btn" data-v="custom">Custom</button>`;
      presetsEl.querySelectorAll(".tc-preset-btn").forEach(b => b.addEventListener("click", () => {
        presetsEl.querySelectorAll(".tc-preset-btn").forEach(x => x.classList.remove("is-active"));
        b.classList.add("is-active");
        if (b.dataset.v === "custom") { amountInput.value = ""; amountInput.focus(); }
        else amountInput.value = b.dataset.v;
        updatePreview();
      }));
    }

    async function updatePreview() {
      const amount = Number(amountInput.value);
      if (!(amount > 0)) { previewEl.textContent = ""; return; }
      if (token === "USDC") { previewEl.textContent = `= $${amount.toFixed(2)} USDC`; return; }
      previewEl.textContent = "Pricing in $TROLL…";
      const price = await (window.TrollPayments && window.TrollPayments.trollUsdPrice());
      previewEl.textContent = price ? `≈ ${Math.round(amount / price).toLocaleString()} $TROLL` : "";
    }
    amountInput.addEventListener("input", updatePreview);

    function setTok(t) {
      token = t;
      tokBtns.forEach(b => b.classList.toggle("is-active", b.dataset.t === t));
      renderPresets();
      updatePreview();
    }
    tokBtns.forEach(b => b.addEventListener("click", () => setTok(b.dataset.t)));
    setTok(token);

    const btn = modal.querySelector("#tc-dep-submit");
    const status = modal.querySelector("#tc-dep-status");
    btn.addEventListener("click", async () => {
      const amount = Number(modal.querySelector("#tc-dep-amount").value);
      if (!(amount > 0)) { status.className = "tc-status is-bad"; status.textContent = "Enter an amount."; return; }
      btn.disabled = true;
      status.className = "tc-status";
      status.textContent = "Connecting…";
      const res = await wallet().deposit(amount, token, (ev) => {
        if (ev.stage === "connecting") status.textContent = "Connect wallet…";
        else if (ev.stage === "building") status.textContent = "Building transaction…";
        else if (ev.stage === "awaiting") status.textContent = "Confirm in Phantom…";
        else if (ev.stage === "confirming") status.textContent = "Confirming on-chain…";
      });
      if (res.ok) {
        status.className = "tc-status is-ok";
        status.textContent = `Deposited! +${wallet().fmt(res.credited, token)}`;
        setTimeout(close, 1400);
      } else {
        status.className = "tc-status is-bad";
        status.textContent = res.message || "Deposit failed.";
        btn.disabled = false;
      }
    });
  }

  async function openRedeem() {
    if (!wallet() || !wallet().isReady()) { alert("Log in first to redeem."); return; }
    let token = wallet().getCurrency();
    const { modal, close } = openBackdrop(`
      <h2>Redeem</h2>
      <p class="tc-sub">Cash out your balance to a real wallet. Requests are reviewed manually,
         typically within 24 hours — you'll see a Pending status until it's paid.</p>
      <div class="tc-token-toggle" id="tc-red-tok">
        <button type="button" data-t="TROLL">$TROLL</button>
        <button type="button" data-t="USDC">USDC</button>
      </div>
      <p class="tc-sub" id="tc-red-bal"></p>
      <div class="tc-field">
        <label>Amount</label>
        <input type="number" id="tc-red-amount" min="0" step="any">
      </div>
      <div class="tc-field">
        <label>Payout wallet (Solana address)</label>
        <input type="text" id="tc-red-wallet" placeholder="Your Phantom address">
      </div>
      <button type="button" class="tc-btn" id="tc-red-submit">Request redemption</button>
      <p class="tc-status" id="tc-red-status" aria-live="polite"></p>
      <ul class="tc-req-list" id="tc-red-list"></ul>`);

    const tokBtns = modal.querySelectorAll("#tc-red-tok button");
    const balEl = modal.querySelector("#tc-red-bal");
    function setTok(t) {
      token = t;
      tokBtns.forEach(b => b.classList.toggle("is-active", b.dataset.t === t));
      balEl.textContent = `Balance: ${wallet().fmt(wallet().getBalance(t), t)}`;
    }
    tokBtns.forEach(b => b.addEventListener("click", () => setTok(b.dataset.t)));
    setTok(token);

    const walletInput = modal.querySelector("#tc-red-wallet");
    // Prefer the address linked to the account (persists across devices, no
    // live wallet connection needed) over the session-only connected wallet.
    (async () => {
      let addr = null;
      if (window.TrollrunnerAccounts && window.TrollrunnerAccounts.getWalletAddress) {
        try { addr = await window.TrollrunnerAccounts.getWalletAddress(); } catch (_) {}
      }
      if (!addr && window.TrollWallet && window.TrollWallet.getAddress && window.TrollWallet.isConnected()) {
        addr = window.TrollWallet.getAddress();
      }
      if (addr && !walletInput.value) walletInput.value = addr;
    })();

    const btn = modal.querySelector("#tc-red-submit");
    const status = modal.querySelector("#tc-red-status");
    const listEl = modal.querySelector("#tc-red-list");

    function ageLabel(iso) {
      const hrs = (Date.now() - new Date(iso).getTime()) / 3600000;
      if (hrs < 1) return "just now";
      if (hrs < 24) return `${Math.round(hrs)}h ago`;
      return `${Math.round(hrs / 24)}d ago`;
    }
    async function renderList() {
      const rows = await wallet().listMyRedemptions();
      listEl.innerHTML = rows.length ? rows.slice(0, 10).map(r => `
        <li>
          <span>${wallet().fmt(Number(r.token_amount), r.token)}</span>
          <span class="tc-req-status ${r.status}">${r.status}${r.status === "pending" ? ` · ${ageLabel(r.created_at)}` : ""}</span>
        </li>`).join("") : "";
    }
    renderList();

    btn.addEventListener("click", async () => {
      const amount = Number(modal.querySelector("#tc-red-amount").value);
      const walletAddr = walletInput.value.trim();
      btn.disabled = true;
      status.className = "tc-status";
      status.textContent = "Submitting…";
      const res = await wallet().requestRedemption({ amount, token, wallet: walletAddr });
      if (res.ok) {
        status.className = "tc-status is-ok";
        status.textContent = "Redemption requested — pending review.";
        setTok(token);
        renderList();
      } else {
        status.className = "tc-status is-bad";
        status.textContent = res.message || "Could not submit — check the amount and wallet address.";
      }
      btn.disabled = false;
    });
  }

  /* ================= FULL STATEMENT (server ledger) ================= */
  // The "Activity" rail on the floor only shows the current session. This
  // reads assets/supabase/troll_casino_v2.sql's troll_casino_adjustments —
  // an append-only audit row per bet/win, RLS-scoped to the caller — so a
  // player can see every real-money movement on their account, forever.
  async function openStatement() {
    if (!wallet() || !wallet().isReady()) { alert("Log in first."); return; }
    const { modal } = openBackdrop(`
      <h2>Full statement</h2>
      <p class="tc-sub">Every balance change on your account, most recent first.</p>
      <ul class="tc-req-list" id="tc-stmt-list">Loading…</ul>`);
    const c = window.TrollrunnerAccounts && window.TrollrunnerAccounts.getClient();
    const listEl = modal.querySelector("#tc-stmt-list");
    if (!c) { listEl.textContent = "Unavailable."; return; }
    try {
      const { data, error } = await c.from("troll_casino_adjustments")
        .select("delta,currency,reason,balance_after,created_at")
        .order("created_at", { ascending: false }).limit(100);
      if (error) { listEl.textContent = "Could not load statement: " + error.message; return; }
      listEl.innerHTML = (data && data.length) ? data.map(r => `
        <li>
          <span>${new Date(r.created_at).toLocaleString()} · ${r.reason || "adjustment"}</span>
          <span class="${r.delta > 0 ? "amt-win" : r.delta < 0 ? "amt-loss" : ""}">
            ${r.delta > 0 ? "+" : ""}${Number(r.delta).toLocaleString()} ${r.currency}
          </span>
        </li>`).join("") : "<li>No activity yet.</li>";
    } catch (e) { listEl.textContent = "Could not load statement: " + ((e && e.message) || e); }
  }

  /* ================= RESPONSIBLE-GAMBLING LIMITS ================= */
  // Backed by troll_casino_set_limits() (troll_casino_v2.sql): a daily loss
  // cap and/or self-exclusion window, enforced server-side inside
  // troll_casino_adjust_balance — not just a client-side checkbox. Both can
  // only be tightened/extended once set, by design (see that function).
  async function openLimits() {
    if (!wallet() || !wallet().isReady()) { alert("Log in first."); return; }
    const c = window.TrollrunnerAccounts && window.TrollrunnerAccounts.getClient();
    const { modal } = openBackdrop(`
      <h2>Play limits</h2>
      <p class="tc-sub">Optional, self-imposed guardrails. A loss cap can only be lowered once
         set, and self-exclusion can only be extended — never shortened — so a losing streak
         can't talk you out of your own limit.</p>
      <p class="tc-sub" id="tc-lim-current">Loading current limits…</p>
      <div class="tc-field">
        <label>Daily loss cap ($TROLL — leave blank for none)</label>
        <input type="number" id="tc-lim-cap" min="1" step="1">
      </div>
      <div class="tc-field">
        <label>Self-exclude for (hours — leave blank to skip)</label>
        <input type="number" id="tc-lim-hours" min="1" step="1">
      </div>
      <button type="button" class="tc-btn" id="tc-lim-save">Save limits</button>
      <p class="tc-status" id="tc-lim-status" aria-live="polite"></p>`);

    const currentEl = modal.querySelector("#tc-lim-current");
    async function loadCurrent() {
      if (!c) { currentEl.textContent = ""; return; }
      try {
        const { data } = await c.from("troll_casino_limits").select("*").maybeSingle();
        if (data && (data.daily_loss_cap || (data.self_exclude_until && new Date(data.self_exclude_until) > new Date()))) {
          currentEl.textContent = [
            data.daily_loss_cap ? `Daily loss cap: ${Number(data.daily_loss_cap).toLocaleString()} TROLL` : null,
            data.self_exclude_until && new Date(data.self_exclude_until) > new Date()
              ? `Self-excluded until ${new Date(data.self_exclude_until).toLocaleString()}` : null,
          ].filter(Boolean).join(" · ");
        } else {
          currentEl.textContent = "No limits currently set.";
        }
      } catch (_) { currentEl.textContent = ""; }
    }
    loadCurrent();

    const status = modal.querySelector("#tc-lim-status");
    modal.querySelector("#tc-lim-save").addEventListener("click", async () => {
      if (!c) return;
      const cap = Number(modal.querySelector("#tc-lim-cap").value) || null;
      const hours = Number(modal.querySelector("#tc-lim-hours").value) || null;
      status.className = "tc-status";
      status.textContent = "Saving…";
      try {
        const { error } = await c.rpc("troll_casino_set_limits", {
          p_daily_loss_cap: cap, p_self_exclude_hours: hours,
        });
        if (error) { status.className = "tc-status is-bad"; status.textContent = error.message; return; }
        status.className = "tc-status is-ok";
        status.textContent = "Saved.";
        loadCurrent();
      } catch (e) {
        status.className = "tc-status is-bad";
        status.textContent = (e && e.message) || "Could not save.";
      }
    });
  }

  window.TrollCasinoMoneyUI = { openDeposit, openRedeem, openStatement, openLimits };
})();
