/* ============================================================================
   TROLL RUNNER ARCADE  —  Token rewards module (Phase 10)  → window.TrollRewards

   Pending/claimable reward flow for weekly leaderboard prizes, rare drops,
   events, achievements. Designed around VERIFICATION: the frontend never
   decides who gets a real reward — the backend does.

   HARD SAFETY RULES
   - Eligibility + claim availability ALWAYS come from TrollBackend, never from
     local stats. Local data cannot qualify anyone for a real reward.
   - Real claims require ENABLE_REAL_CLAIMS + a real backend. Without both,
     claiming is mock-only (or disabled) and pays out nothing.
   - Claim has explicit states so the UI can never imply value that isn't real.

   Claim states: not_eligible | eligible | pending | available | completed | failed
   ============================================================================ */
(() => {
  "use strict";
  if (window.TrollRewards) return;   // singleton

  const FLAGS = () => window.TROLL_FLAGS || {};
  const realRewardsLive = () => FLAGS().ENABLE_REAL_REWARDS === true;
  const realClaimsLive  = () => FLAGS().ENABLE_REAL_CLAIMS === true;
  const mockEnabled     = () => FLAGS().ENABLE_MOCK_REWARDS !== false;
  const mode = () => (realRewardsLive() ? "real" : "mock");

  const STATES = {
    NOT_ELIGIBLE: "not_eligible", ELIGIBLE: "eligible", PENDING: "pending",
    AVAILABLE: "available", COMPLETED: "completed", FAILED: "failed",
  };

  // Sandbox/demo seed (clearly mock). A real backend would return the truth.
  const MOCK_REWARDS = [
    { id: "wk-troll-1", title: "Weekly Ladder · 1st", token: "TROLL", amount: 1000000, kind: "leaderboard" },
    { id: "rare-coin-1", title: "Rare Trollface Coin", token: "TROLL", amount: 6900, kind: "rare-drop" },
    { id: "usdc-event-1", title: "Event Prize", token: "USDC", amount: 50, kind: "event" },
  ];

  /* --- query pending rewards (always backend-sourced) --------------------- */
  async function getPending({ wallet = null, gameId = null } = {}) {
    if (realRewardsLive()) {
      if (!window.TrollBackend || !window.TrollBackend.isReal()) return { ok: false, reason: "no-backend", items: [] };
      const hist = await window.TrollBackend.getRewardHistory({ wallet });
      return { ok: !!(hist && hist.ok), real: true, items: (hist && hist.items) || [] };
    }
    if (!mockEnabled()) return { ok: true, items: [] };
    // Mock: present seed rewards as PENDING verification (nothing claimable for real).
    const items = MOCK_REWARDS.map(r => ({ ...r, mock: true, state: STATES.PENDING }));
    return { ok: true, mock: true, items };
  }

  /* --- resolve a reward's current claim state (backend-gated) ------------- */
  async function getClaimState(reward, { wallet = null } = {}) {
    if (!reward) return STATES.NOT_ELIGIBLE;
    if (realClaimsLive()) {
      if (!window.TrollBackend || !window.TrollBackend.isReal()) return STATES.PENDING;
      const e = await window.TrollBackend.getClaimEligibility({ rewardId: reward.id, wallet });
      if (!e || !e.ok) return STATES.PENDING;
      return e.eligible ? STATES.AVAILABLE : STATES.NOT_ELIGIBLE;
    }
    // Mock: eligible-looking but explicitly mock; cannot pay out real value.
    return mockEnabled() ? STATES.ELIGIBLE : STATES.NOT_ELIGIBLE;
  }

  /* --- claim a reward ----------------------------------------------------- */
  async function claim(reward, { wallet = null, onProgress = null } = {}) {
    if (!reward) return { ok: false, state: STATES.FAILED, reason: "no-reward" };

    // REAL claim: must be flagged AND verified by a real backend. Fails closed.
    if (realClaimsLive()) {
      if (!window.TrollBackend || !window.TrollBackend.isReal())
        return { ok: false, state: STATES.FAILED, reason: "no-backend",
                 message: "Real claims require backend verification (unavailable)." };
      if (!window.TrollWallet || !window.TrollWallet.isConnected())
        return { ok: false, state: STATES.FAILED, reason: "no-wallet", message: "Connect a wallet to claim." };
      const ab = await window.TrollBackend.antiAbuseCheck({ type: "claim", wallet, ctx: { rewardId: reward.id } });
      if (!ab || !ab.allowed) return { ok: false, state: STATES.FAILED, reason: "blocked" };
      const elig = await window.TrollBackend.getClaimEligibility({ rewardId: reward.id, wallet });
      if (!elig || !elig.ok || !elig.eligible)
        return { ok: false, state: STATES.NOT_ELIGIBLE, reason: "not-eligible" };
      if (onProgress) onProgress({ stage: "claiming" });
      const status = await window.TrollBackend.getClaimStatus({ claimId: elig.claimId });
      const okReal = status && status.ok && status.status === "completed";
      return okReal
        ? { ok: true, state: STATES.COMPLETED, reward, txSig: status.txSig }
        : { ok: false, state: STATES.FAILED, reason: "claim-failed" };
    }

    // MOCK claim: simulate, pay out NOTHING real.
    if (!mockEnabled()) return { ok: false, state: STATES.FAILED, reason: "disabled" };
    if (onProgress) onProgress({ stage: "claiming" });
    await new Promise(r => setTimeout(r, 700));
    if (window.TrollBackend) window.TrollBackend.record("reward_mock_claim", { rewardId: reward.id });
    return { ok: true, mock: true, state: STATES.COMPLETED, reward };
  }

  /* ==========================================================================
     UI helper — render a pending-rewards panel with claim states. Optional.
     ========================================================================== */
  function mountPanel(elOrSel, { wallet = null, gameId = null } = {}) {
    const root = typeof elOrSel === "string" ? document.querySelector(elOrSel) : elOrSel;
    if (!root) return () => {};
    const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const fmt = n => Number(n || 0).toLocaleString();

    async function render() {
      const res = await getPending({ wallet, gameId });
      const tag = realRewardsLive() ? `<span class="tr-tag tr-real">REAL</span>` : `<span class="tr-tag tr-mock">MOCK</span>`;
      if (!res.items.length) { root.innerHTML = `<p class="tr-empty">No pending rewards. ${tag}</p>`; return; }
      const rows = await Promise.all(res.items.map(async (r) => {
        const state = r.state || await getClaimState(r, { wallet });
        const claimable = state === STATES.AVAILABLE || (state === STATES.ELIGIBLE && !realClaimsLive());
        return `<li class="tr-row" data-id="${esc(r.id)}">
          <div class="tr-info"><strong>${esc(r.title)}</strong>
            <span class="tr-amt">${fmt(r.amount)} ${esc(r.token)}</span></div>
          <div class="tr-claim">
            <span class="tr-state tr-${state}">${state.replace("_", " ")}</span>
            <button type="button" class="tr-btn"${claimable ? "" : " disabled"}>Claim</button>
          </div></li>`;
      }));
      root.innerHTML = `<div class="tr-head">Pending rewards ${tag}</div><ul class="tr-list">${rows.join("")}</ul>
        <p class="tr-note">Claims are verified by the backend. ${realRewardsLive() ? "" : "Mock mode — nothing real is paid out."}</p>`;
      root.querySelectorAll(".tr-row").forEach(li => {
        const r = res.items.find(x => x.id === li.dataset.id);
        const btn = li.querySelector(".tr-btn");
        if (btn && !btn.disabled) btn.addEventListener("click", async () => {
          btn.disabled = true; btn.textContent = "Claiming…";
          const out = await claim(r, { wallet });
          const stEl = li.querySelector(".tr-state");
          stEl.className = "tr-state tr-" + out.state;
          stEl.textContent = out.state.replace("_", " ");
          btn.textContent = out.ok ? "Claimed" : "Failed";
        });
      });
    }
    render();
    return render;   // call to refresh
  }

  window.TrollRewards = { STATES, getPending, getClaimState, claim, mountPanel, mode };
})();
