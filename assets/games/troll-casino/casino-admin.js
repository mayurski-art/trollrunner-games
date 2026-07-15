/* ============================================================================
   TROLL CASINO  —  admin redemption review panel

   Opened by visiting troll-casino.html?admin=1. Gated by TWO independent
   layers:
   1. A client-side password prompt (UI friction only — trivially bypassable
      by anyone who reads this file, so it is NOT the real security boundary).
   2. The real boundary: troll_profiles.is_admin for the CURRENTLY LOGGED IN
      account, enforced by Postgres row-level security and by the
      troll_casino_admin_* SECURITY DEFINER functions in troll_casino.sql.
      Only an account you've flipped is_admin=true for (by hand, in the
      Supabase dashboard) can ever read other players' redemption requests
      or mark them paid/rejected — the password prompt below cannot grant
      that on its own.
   ============================================================================ */
(() => {
  "use strict";
  if (new URLSearchParams(location.search).get("admin") !== "1") return;

  // SHA-256 of the admin password. Changing the password means recomputing
  // this hash (e.g. crypto.subtle.digest in a console) — never store it in
  // plaintext here.
  const PASSWORD_HASH = "b7a672077873aaa3c28913aff52652c3340dbe7c1e87d6a0c78bc7af30a537bc";

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function openBackdrop(bodyHtml) {
    const backdrop = document.createElement("div");
    backdrop.className = "tc-modal-backdrop";
    backdrop.innerHTML = `<div class="tc-modal" role="dialog" aria-modal="true">${bodyHtml}</div>`;
    document.body.appendChild(backdrop);
    return { backdrop, modal: backdrop.querySelector(".tc-modal") };
  }

  async function promptPassword() {
    return new Promise((resolve) => {
      const { backdrop, modal } = openBackdrop(`
        <h2>Admin access</h2>
        <p class="tc-sub">This is a UI convenience gate — the real access control is your
           account's is_admin flag, checked server-side.</p>
        <div class="tc-field">
          <label>Password</label>
          <input type="password" id="tc-admin-pw">
        </div>
        <button type="button" class="tc-btn" id="tc-admin-pw-go">Continue</button>
        <p class="tc-status" id="tc-admin-pw-status"></p>`);
      const input = modal.querySelector("#tc-admin-pw");
      const status = modal.querySelector("#tc-admin-pw-status");
      const go = async () => {
        const hash = await sha256(input.value);
        if (hash === PASSWORD_HASH) { backdrop.remove(); resolve(true); }
        else { status.className = "tc-status is-bad"; status.textContent = "Wrong password."; }
      };
      modal.querySelector("#tc-admin-pw-go").addEventListener("click", go);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      input.focus();
    });
  }

  async function checkIsAdmin() {
    const a = window.TrollrunnerAccounts;
    if (!a) return false;
    const session = a.getCachedProfile() || await a.getSession();
    if (!session) return false;
    const c = a.getClient();
    if (!c) return false;
    try {
      const { data } = await c.from("troll_profiles").select("is_admin").eq("id", session.userId).maybeSingle();
      return !!(data && data.is_admin);
    } catch (_) { return false; }
  }

  function statusClass(s) { return s === "paid" ? "paid" : s === "rejected" ? "rejected" : "pending"; }

  // Sanity check for the reviewer: does this request's token add up against
  // what this player has actually put in (deposits) and already been paid
  // (prior paid redemptions)? Flags when the gap looks implausible given the
  // per-call delta cap now enforced in troll_casino_adjust_balance — this is
  // a visual nudge to look closer, not an automatic block.
  function summaryLine(r, s) {
    if (!s) return "<span class=\"tc-sub\">Player summary unavailable.</span>";
    const isTroll = r.token === "TROLL";
    const balance = isTroll ? s.troll_balance : s.usdc_balance;
    const deposited = isTroll ? s.troll_deposited : s.usdc_deposited;
    const paidOut = isTroll ? s.troll_paid_out : s.usdc_paid_out;
    // Balance was already debited by this pending request, so add it back
    // to see the gameplay position at the moment this request was filed.
    const netGameplay = (balance + paidOut + Number(r.token_amount)) - deposited;
    const suspiciousBar = isTroll ? Math.max(deposited * 3, 100000) : Math.max(deposited * 3, 1000);
    const flagged = netGameplay > suspiciousBar;
    const fmt = (n) => Number(n).toLocaleString();
    return `
      <p class="tc-sub" style="font-family:var(--tc-font-mono);font-size:12px;">
        deposited: ${fmt(deposited)} ${r.token} · paid out so far: ${fmt(paidOut)} ${r.token} ·
        current balance: ${fmt(balance)} ${r.token} · deposit count: ${s.deposit_count}<br>
        net gameplay P&amp;L (incl. this request): <strong>${fmt(netGameplay)} ${r.token}</strong>
        ${flagged ? "<span class=\"tc-req-status rejected\">⚠ check before paying — far above deposits</span>" : ""}
      </p>`;
  }

  async function renderPanel() {
    const c = window.TrollrunnerAccounts.getClient();
    const { backdrop, modal } = openBackdrop(`
      <h2>Redemption requests</h2>
      <p class="tc-sub">Pay the player from your own wallet outside this app, then mark the request
         Paid (with the tx signature) or Rejected (auto-refunds their balance).</p>
      <div id="tc-admin-list">Loading…</div>`);
    backdrop.style.zIndex = "1100";

    async function load() {
      const list = modal.querySelector("#tc-admin-list");
      const { data, error } = await c.from("troll_casino_redemptions").select("*")
        .eq("status", "pending").order("created_at", { ascending: true });
      if (error) { list.textContent = "Could not load requests: " + error.message; return; }
      if (!data || !data.length) { list.innerHTML = "<p class=\"tc-sub\">No pending requests.</p>"; return; }

      const summaries = await Promise.all(data.map(r =>
        c.rpc("troll_casino_admin_player_summary", { p_user_id: r.user_id })
          .then(({ data: s, error: e }) => (e || !s || !s.length) ? null : s[0])
          .catch(() => null)
      ));

      list.innerHTML = data.map((r, i) => {
        const hrsOld = (Date.now() - new Date(r.created_at).getTime()) / 3600000;
        const overdue = hrsOld > 24;
        return `
        <div class="tc-modal" style="padding:14px;margin-bottom:10px;border:0.5px solid ${overdue ? "var(--tc-red, #ff3358)" : "var(--tc-line)"};">
          <p style="font-family:var(--tc-font-mono);font-size:13px;margin-bottom:8px;">
            <strong>${Number(r.token_amount).toLocaleString()} ${r.token}</strong>
            <span class="tc-req-status ${statusClass(r.status)}">${r.status}</span>
            ${overdue ? `<span class="tc-req-status rejected">⏰ ${Math.round(hrsOld)}h — past 24h SLA</span>` : ""}<br>
            wallet: ${r.wallet}<br>
            requested: ${new Date(r.created_at).toLocaleString()}
          </p>
          ${summaryLine(r, summaries[i])}
          <div class="tc-field"><label>Payout tx signature</label><input type="text" data-tx-for="${r.id}"></div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="tc-btn" data-paid="${r.id}">Mark paid</button>
            <button type="button" class="tc-btn tc-btn--ghost" data-reject="${r.id}">Reject (refund)</button>
          </div>
        </div>`;
      }).join("");

      list.querySelectorAll("[data-paid]").forEach(btn => btn.addEventListener("click", async () => {
        const id = btn.dataset.paid;
        const tx = list.querySelector(`[data-tx-for="${id}"]`).value.trim();
        if (!tx) { alert("Enter the payout transaction signature first."); return; }
        btn.disabled = true;
        const { error } = await c.rpc("troll_casino_admin_mark_paid", { p_id: id, p_tx: tx, p_note: null });
        if (error) alert(error.message); else load();
      }));
      list.querySelectorAll("[data-reject]").forEach(btn => btn.addEventListener("click", async () => {
        const id = btn.dataset.reject;
        if (!confirm("Reject this request and refund the player's balance?")) return;
        btn.disabled = true;
        const { error } = await c.rpc("troll_casino_admin_reject_redemption", { p_id: id, p_note: null });
        if (error) alert(error.message); else load();
      }));
    }
    load();
  }

  async function boot() {
    const ok = await promptPassword();
    if (!ok) return;
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) {
      alert("Password accepted, but your logged-in account is not flagged as admin (troll_profiles.is_admin). Log in as your admin account first.");
      return;
    }
    renderPanel();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
