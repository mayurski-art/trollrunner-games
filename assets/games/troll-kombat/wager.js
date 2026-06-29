/* ============================================================================
   TROLL KOMBAT  —  Wager control (real payment to the treasury)

   A pre-match "Wager" toggle in the stage-select screen (mirrors the random-map
   ON/OFF control). When ON, the player types a custom USDC / $TROLL amount; on
   Fight it runs the shared payment flow (confirmation screen → Phantom → real
   on-chain transfer to the treasury).

   SCOPE / SAFETY
   - This pays money IN (player → treasury) only, via the audited TrollPay lib
     and the Phase 10 TrollPayments flow (always shows a confirmation screen
     first; Phantom never opens until the player confirms).
   - Winnings/payouts are NOT automated here. Paying a player from the treasury
     needs a server-held signer (a private key must never live in the browser),
     and is out of scope for this client. The wager is a real payment; any
     settlement is handled separately. See docs/PHASE10-WALLET-UTILITY.md.
   - Isolated from the fight engine: game.js only calls beforeFight() from the
     stage→Fight launcher, and reacts to the boolean result.
   ============================================================================ */
(() => {
  "use strict";

  const state = { enabled: false, amount: "", token: "USDC", mounted: false };
  let activeWager = null;   // the paid stake for the current match (consumed at result)
  const uid = (p) => p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function ready() {
    return !!(window.TrollPayments && window.TrollWallet && window.TROLL_FLAGS);
  }

  function mount() {
    if (state.mounted) return;
    const host = document.querySelector("#tk-stage .mockup-screen");
    if (!host || !ready()) return;
    state.mounted = true;

    const modeReal = window.TrollPayments.mode() === "real";
    const wrap = document.createElement("div");
    wrap.className = "kombat-wager";
    wrap.innerHTML = `
      <div class="kw-topline">
        <span class="kw-kicker">Optional stake</span>
        <span class="kw-mode ${modeReal ? "is-real" : "is-mock"}">${modeReal ? "REAL MAINNET" : "MOCK MODE"}</span>
      </div>
      <div class="kw-row">
        <span class="kw-label"><span class="kw-coin">¤</span> Kombat wager</span>
        <div class="kw-toggle" role="group" aria-label="Wager on or off">
          <button type="button" class="kw-opt is-active" data-w="off">OFF</button>
          <button type="button" class="kw-opt" data-w="on">ON</button>
        </div>
      </div>
      <div class="kw-body" hidden>
        <div class="kw-field">
          <label class="kw-field-label" for="kw-input">Stake amount</label>
          <div class="kw-amount">
            <input type="number" id="kw-input" min="0" step="any" inputmode="decimal" placeholder="0.00" aria-label="Wager amount">
            <div class="kw-tokens" role="group" aria-label="Token">
              <button type="button" class="kw-tok is-active" data-t="USDC">USDC</button>
              <button type="button" class="kw-tok" data-t="TROLL">$TROLL</button>
            </div>
          </div>
        </div>
        <div class="kw-safety">
          <span>Confirm screen first</span>
          <span>Phantom approval required</span>
          <span>Manual payout review</span>
        </div>
        <div class="kw-wallet" id="kw-wallet"></div>
        <p class="kw-note">${modeReal
          ? "You approve a real transfer to the treasury only after the confirmation screen. Winnings are <strong>manual</strong>: send your win for dev approval after the match."
          : "Mock mode — test the wager dashboard with no real payment."}</p>
        <p class="kw-status" id="kw-status" aria-live="polite"></p>
      </div>`;
    host.appendChild(wrap);

    const body = wrap.querySelector(".kw-body");
    wrap.querySelectorAll(".kw-opt").forEach(b => b.addEventListener("click", () => {
      state.enabled = b.dataset.w === "on";
      wrap.querySelectorAll(".kw-opt").forEach(o => o.classList.toggle("is-active", o === b));
      body.hidden = !state.enabled;
    }));
    wrap.querySelectorAll(".kw-tok").forEach(b => b.addEventListener("click", () => {
      state.token = b.dataset.t;
      wrap.querySelectorAll(".kw-tok").forEach(o => o.classList.toggle("is-active", o === b));
    }));
    wrap.querySelector("#kw-input").addEventListener("input", e => { state.amount = e.target.value; });
    window.TrollWallet.mountStatus("#kw-wallet");
  }

  function status(msg, cls) {
    const el = document.getElementById("kw-status");
    if (el) { el.textContent = msg || ""; el.className = "kw-status " + (cls || ""); }
  }

  const isEnabled = () => state.enabled;

  // Called by game.js before a match starts. Returns true to proceed, false to abort.
  async function beforeFight() {
    if (!state.enabled || !ready()) return true;
    const amt = Number(state.amount);
    if (!(amt > 0)) { status("Enter a wager amount, or switch Wager OFF.", "bad"); return false; }

    // Real mode needs a connected wallet first (mock connect is a no-op fake).
    if (window.TrollPayments.mode() === "real" && !window.TrollWallet.isConnected()) {
      try { await window.TrollWallet.connect(); }
      catch (e) { status("Wallet not connected — " + (e.message || "rejected"), "bad"); return false; }
    }

    status("Opening confirmation…", "");
    const res = await window.TrollPayments.requestPayment({
      action: "Troll Kombat Wager", token: state.token, amount: amt,
      memo: "TR|game|Troll Kombat wager", dedupeKey: "kombat-wager",
    });
    if (res.ok) {
      // Remember the paid stake so a win can be submitted for manual approval.
      activeWager = {
        matchId: uid("match"), token: state.token, amount: amt, usd: res.amountUsd != null ? res.amountUsd : null,
        txSig: res.txSig, mock: !!res.mock,
        wallet: (window.TrollWallet.getAddress && window.TrollWallet.getAddress()) || null,
        network: (window.TROLL_PAY_CONFIG && window.TROLL_PAY_CONFIG.SOLANA_NETWORK) || "mainnet-beta",
      };
      status(`✅ Wager placed: ${amt} ${state.token}${res.mock ? " (mock)" : ""}.`, "ok");
      return true;
    }
    status(`❌ Wager not placed — ${res.message || res.reason}.`, res.reason === "cancelled" ? "" : "bad");
    return false;   // do NOT start the match if payment didn't succeed
  }

  /* ==========================================================================
     RESULT → "Send win for approval"
     Called by game.js when a match ends. If this match had a paid wager and the
     local player won, show a button that submits the match + stake details to
     the dev-only payout queue (TrollPayouts). Winners are paid MANUALLY.
     ========================================================================== */
  function onResult(r) {
    const card = document.querySelector("#tk-result .overlay-card");
    if (card) { const old = card.querySelector(".kw-claim"); if (old) old.remove(); }
    const aw = activeWager;
    activeWager = null;                 // consume — a rematch is a fresh (unwagered) match
    if (!card || !aw) return;

    const won = r && r.winnerIdx === 0; // local player is slot 0
    const panel = document.createElement("div");
    panel.className = "kw-claim";
    if (!won) {
      panel.innerHTML = `<p class="kw-claim-lost">Wager lost — ${aw.amount} ${aw.token} staked. No payout.</p>`;
      card.appendChild(panel);
      return;
    }
    panel.innerHTML = `
      <p class="kw-claim-win">🏆 You won your ${aw.amount} ${aw.token} wager!</p>
      <button type="button" class="kw-claim-btn">Send win for approval</button>
      <p class="kw-claim-status" aria-live="polite"></p>`;
    card.appendChild(panel);
    const btn = panel.querySelector(".kw-claim-btn");
    const st = panel.querySelector(".kw-claim-status");
    btn.addEventListener("click", async () => {
      if (!window.TrollPayouts) { st.textContent = "Approval service unavailable."; st.className = "kw-claim-status bad"; return; }
      btn.disabled = true; btn.textContent = "Submitting…";
      const winnerLabel = r.mode === "mp" ? "p" + (r.winnerIdx + 1) : "player";
      const out = await window.TrollPayouts.submit({
        game: "troll-kombat", match_id: aw.matchId, wallet: aw.wallet,
        stake_token: aw.token, stake_amount: aw.amount, stake_usd: aw.usd, stake_tx: aw.txSig, network: aw.network,
        mode: r.mode, difficulty: r.mode === "cpu" ? r.diff : null,
        player_fighter: r.p1char, opponent_fighter: r.p2char, stage: r.stage,
        won: true, winner: winnerLabel, rounds_won: r.p1rounds, rounds_lost: r.p2rounds,
        kos: r.p1kos, damage: r.p1damage,
        app_version: "kombat-wager-v1",
      });
      if (out.ok) {
        st.textContent = `✅ Sent for approval (ref ${out.ref}). The dev will verify your stake and pay you manually.`;
        st.className = "kw-claim-status ok"; btn.textContent = "Submitted ✓";
      } else {
        st.textContent = `❌ Could not submit (${out.message || out.reason}). Your stake tx: ${aw.txSig || "—"}. Keep it as proof.`;
        st.className = "kw-claim-status bad"; btn.disabled = false; btn.textContent = "Retry";
      }
    });
  }

  window.KombatWager = { mount, isEnabled, beforeFight, onResult };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
