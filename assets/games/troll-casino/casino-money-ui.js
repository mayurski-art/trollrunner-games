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
          <h2>🧌 Troll Casino</h2>
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
      <div class="tc-field">
        <label>Amount (USD)</label>
        <input type="number" id="tc-dep-amount" min="1" step="0.01" placeholder="10.00">
      </div>
      <button type="button" class="tc-btn" id="tc-dep-submit">Deposit</button>
      <p class="tc-status" id="tc-dep-status" aria-live="polite"></p>`);

    const tokBtns = modal.querySelectorAll("#tc-dep-tok button");
    function setTok(t) { token = t; tokBtns.forEach(b => b.classList.toggle("is-active", b.dataset.t === t)); }
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
      <p class="tc-sub">Cash out your balance to a real wallet. Requests are reviewed manually —
         you'll see a Pending status until it's paid.</p>
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

    async function renderList() {
      const rows = await wallet().listMyRedemptions();
      listEl.innerHTML = rows.length ? rows.slice(0, 10).map(r => `
        <li>
          <span>${wallet().fmt(Number(r.token_amount), r.token)}</span>
          <span class="tc-req-status ${r.status}">${r.status}</span>
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

  window.TrollCasinoMoneyUI = { openDeposit, openRedeem };
})();
