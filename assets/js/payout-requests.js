/* ============================================================================
   TROLL RUNNER ARCADE  —  Payout requests  →  window.TrollPayouts

   A player who won a manually reviewed wager can submit the result for approval.
   This submits match + declared wager details to a dev-only Supabase table
   (`payout_requests`) so the developer can review the match and handle any
   settlement MANUALLY. There are NO automated payouts (a treasury signer must
   never live in the browser — see docs/PHASE10-WALLET-UTILITY.md).

   ACCESS MODEL (row-level security): the public anon key can INSERT a claim but
   has NO read access — players can't see anyone's claims. The developer reviews
   via the Supabase dashboard (Table Editor) or a service-role tool. Run
   docs/payout_requests.sql once to create the table + policy.

   This is the SAME Supabase project the arcade already uses for TrollNotis/chat;
   the anon key is public by design and safe to ship (security is the RLS policy).
   ============================================================================ */
(() => {
  "use strict";
  if (window.TrollPayouts) return;   // singleton

  const SUPABASE_URL = "https://tjsyhfplxjtakdfkpdtg.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqc3loZnBseGp0YWtkZmtwZHRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzOTc0ODksImV4cCI6MjA5MTk3MzQ4OX0.xLUcPUUguRBQttNwiIRWJHxjJjLqrQDMu4Ubsk5yZoQ";
  const TABLE = "payout_requests";
  const LS_BACKUP = "troll_payout_requests_backup";

  // Exact columns the table accepts. Anything else would make the insert fail,
  // so submit() whitelists to these keys.
  const COLUMNS = [
    "game", "match_id", "wallet",
    "stake_token", "stake_amount", "stake_usd", "stake_tx", "network",
    "mode", "difficulty", "player_fighter", "opponent_fighter", "stage",
    "won", "winner", "rounds_won", "rounds_lost", "kos", "damage",
    "claim_nonce", "app_version", "user_agent",
  ];

  let client = null;
  function getClient() {
    if (client) return client;
    if (!window.supabase || !window.supabase.createClient) return null;
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return client;
  }

  function clean(record) {
    const out = {};
    COLUMNS.forEach(k => { if (record[k] !== undefined) out[k] = record[k]; });
    return out;
  }
  // Local backup so a claim is never silently lost if the network/DB hiccups.
  function backup(rec) {
    try {
      const a = JSON.parse(localStorage.getItem(LS_BACKUP) || "[]");
      a.push({ ...rec, _ts: new Date().toISOString() });
      localStorage.setItem(LS_BACKUP, JSON.stringify(a.slice(-50)));
    } catch (_) {}
  }

  async function submit(record) {
    const rec = clean(record);
    if (!rec.claim_nonce) rec.claim_nonce = "clm_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    if (!rec.user_agent && typeof navigator !== "undefined") rec.user_agent = navigator.userAgent;
    backup(rec);

    const c = getClient();
    if (!c) return { ok: false, reason: "offline", message: "Submission service unavailable.", payload: rec };
    try {
      const { error } = await c.from(TABLE).insert([rec]);   // no .select(): RLS allows insert only
      if (error) return { ok: false, reason: "db", message: error.message, payload: rec };
      return { ok: true, ref: rec.claim_nonce };
    } catch (e) {
      return { ok: false, reason: "network", message: String((e && e.message) || e), payload: rec };
    }
  }

  // Dev convenience: the locally-kept copies (the canonical record is in Supabase).
  function localBackups() {
    try { return JSON.parse(localStorage.getItem(LS_BACKUP) || "[]"); } catch (_) { return []; }
  }

  window.TrollPayouts = { submit, localBackups, COLUMNS };
})();
