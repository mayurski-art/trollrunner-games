/* ============================================================================
   TROLL KOMBAT - Manual wager approval flow

   A pre-match "Wager" toggle in the stage-select screen lets players declare
   the amount/token they are willing to wager. It DOES NOT charge a wallet and it
   DOES NOT move tokens automatically.

   At match end, the winner can submit the match + wager details for manual
   approval. The request is saved by KombatWagerStore (local browser queue first,
   optional Supabase insert through TrollPayouts when available).

   Settlement remains manual: the developer reviews the match, confirms the
   wager terms, and handles any token movement outside the browser.
   ============================================================================ */
(() => {
  "use strict";

  const state = {
    enabled: false,
    amount: "",
    token: "USDC",
    termsAccepted: false,
    mounted: false,
  };
  let activeWager = null;

  const uid = prefix => prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function mount() {
    if (state.mounted) return;
    const host = document.querySelector("#tk-stage .mockup-screen");
    if (!host) return;
    state.mounted = true;

    const wrap = document.createElement("div");
    wrap.className = "kombat-wager";
    wrap.innerHTML = `
      <div class="kw-topline">
        <span class="kw-kicker">Manual review</span>
        <span class="kw-mode is-manual">NO AUTO PAY</span>
      </div>
      <div class="kw-row">
        <span class="kw-label"><span class="kw-coin">$</span> Kombat wager</span>
        <div class="kw-toggle" role="group" aria-label="Wager on or off">
          <button type="button" class="kw-opt is-active" data-w="off">OFF</button>
          <button type="button" class="kw-opt" data-w="on">ON</button>
        </div>
      </div>
      <div class="kw-body" hidden>
        <div class="kw-field">
          <label class="kw-field-label" for="kw-input">Wager amount</label>
          <div class="kw-amount">
            <input type="number" id="kw-input" min="0" step="any" inputmode="decimal" placeholder="0.00" aria-label="Wager amount">
            <div class="kw-tokens" role="group" aria-label="Token">
              <button type="button" class="kw-tok is-active" data-t="USDC">USDC</button>
              <button type="button" class="kw-tok" data-t="TROLL">$TROLL</button>
            </div>
          </div>
        </div>
        <label class="kw-check">
          <input type="checkbox" id="kw-terms">
          <span>Both players agree this wager is for manual approval after the match.</span>
        </label>
        <div class="kw-safety">
          <span>No wallet opens</span>
          <span>No tokens move now</span>
          <span>Submit after match</span>
        </div>
        <p class="kw-note">When Fight starts, the wager is only recorded for this match. The winner sends it for approval on the result screen.</p>
        <p class="kw-status" id="kw-status" aria-live="polite"></p>
      </div>`;
    host.appendChild(wrap);

    const body = wrap.querySelector(".kw-body");
    wrap.querySelectorAll(".kw-opt").forEach(button => button.addEventListener("click", () => {
      state.enabled = button.dataset.w === "on";
      wrap.querySelectorAll(".kw-opt").forEach(option => option.classList.toggle("is-active", option === button));
      body.hidden = !state.enabled;
      status(state.enabled ? "Enter wager terms before starting." : "", "");
    }));
    wrap.querySelectorAll(".kw-tok").forEach(button => button.addEventListener("click", () => {
      state.token = button.dataset.t;
      wrap.querySelectorAll(".kw-tok").forEach(option => option.classList.toggle("is-active", option === button));
    }));
    wrap.querySelector("#kw-input").addEventListener("input", event => { state.amount = event.target.value; });
    wrap.querySelector("#kw-terms").addEventListener("change", event => { state.termsAccepted = event.target.checked; });
  }

  function status(message, cls) {
    const el = document.getElementById("kw-status");
    if (!el) return;
    el.textContent = message || "";
    el.className = "kw-status " + (cls || "");
  }

  const isEnabled = () => state.enabled;

  async function beforeFight() {
    if (!state.enabled) {
      activeWager = null;
      return true;
    }

    const amount = Number(state.amount);
    if (!(amount > 0)) {
      status("Enter a wager amount, or switch Wager OFF.", "bad");
      return false;
    }
    if (!state.termsAccepted) {
      status("Confirm both players agree to manual review.", "bad");
      return false;
    }

    activeWager = {
      matchId: uid("match"),
      wagerId: uid("wager"),
      token: state.token,
      amount,
      createdAt: new Date().toISOString(),
      paymentStatus: "not_collected",
      settlement: "manual_approval",
    };
    status(`Wager recorded: ${amount} ${state.token}. No tokens moved.`, "ok");
    return true;
  }

  function resultWinnerLabel(r) {
    if (!r) return "unknown";
    if (r.mode === "mp") return "p" + (r.winnerIdx + 1);
    return r.winnerIdx === 0 ? "player" : "cpu";
  }

  function buildApprovalRecord(wager, r, payoutWallet) {
    const winnerIsP1 = r.winnerIdx === 0;
    const winnerRounds = winnerIsP1 ? r.p1rounds : r.p2rounds;
    const loserRounds = winnerIsP1 ? r.p2rounds : r.p1rounds;
    return {
      game: "troll-kombat",
      match_id: wager.matchId,
      wallet: payoutWallet || null,
      stake_token: wager.token,
      stake_amount: wager.amount,
      stake_usd: null,
      stake_tx: null,
      network: "manual-review",
      mode: r.mode,
      difficulty: r.mode === "cpu" ? r.diff : null,
      player_fighter: winnerIsP1 ? r.p1char : r.p2char,
      opponent_fighter: winnerIsP1 ? r.p2char : r.p1char,
      stage: r.stage,
      won: true,
      winner: resultWinnerLabel(r),
      rounds_won: winnerRounds,
      rounds_lost: loserRounds,
      kos: winnerIsP1 ? r.p1kos : r.p2kos,
      damage: winnerIsP1 ? r.p1damage : r.p2damage,
      app_version: "kombat-manual-wager-v1",
      wager_id: wager.wagerId,
      payment_status: wager.paymentStatus,
      settlement: wager.settlement,
    };
  }

  function onResult(r) {
    const card = document.querySelector("#tk-result .overlay-card");
    if (card) {
      const old = card.querySelector(".kw-claim");
      if (old) old.remove();
    }
    const wager = activeWager;
    activeWager = null;
    if (!card || !wager) return;

    const cpuWon = r && r.mode === "cpu" && r.winnerIdx !== 0;
    const winnerLabel = resultWinnerLabel(r).toUpperCase();
    const panel = document.createElement("div");
    panel.className = "kw-claim";

    if (cpuWon) {
      panel.innerHTML = `
        <p class="kw-claim-lost">CPU won. The ${wager.amount} ${wager.token} wager was not submitted for payout.</p>
        <p class="kw-claim-status">No tokens moved.</p>`;
      card.appendChild(panel);
      return;
    }

    panel.innerHTML = `
      <p class="kw-claim-win">${winnerLabel} won a ${wager.amount} ${wager.token} manual wager.</p>
      <label class="kw-claim-field">
        <span>Winner payout wallet or note</span>
        <input type="text" class="kw-claim-input" placeholder="Wallet address, Discord name, or review note">
      </label>
      <button type="button" class="kw-claim-btn">Submit for approval</button>
      <p class="kw-claim-status" aria-live="polite">This saves a review request. It does not transfer tokens.</p>`;
    card.appendChild(panel);

    const btn = panel.querySelector(".kw-claim-btn");
    const input = panel.querySelector(".kw-claim-input");
    const out = panel.querySelector(".kw-claim-status");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Submitting...";
      const record = buildApprovalRecord(wager, r, input.value.trim());
      const store = window.KombatWagerStore;
      const result = store && store.submit
        ? await store.submit(record)
        : { ok: false, reason: "missing-store", message: "Approval storage is unavailable." };

      if (result.ok) {
        out.textContent = result.remote
          ? `Saved for approval. Ref ${result.ref || result.localRef}.`
          : `Saved locally for approval. Ref ${result.localRef}.`;
        out.className = "kw-claim-status ok";
        btn.textContent = "Submitted";
      } else {
        out.textContent = `Could not save approval request: ${result.message || result.reason}.`;
        out.className = "kw-claim-status bad";
        btn.disabled = false;
        btn.textContent = "Retry";
      }
    });
  }

  window.KombatWager = { mount, isEnabled, beforeFight, onResult };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
