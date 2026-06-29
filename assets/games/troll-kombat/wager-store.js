/* ============================================================================
   TROLL KOMBAT - wager approval storage

   Stores manual wager approval requests in browser localStorage first, then
   optionally mirrors them to the shared TrollPayouts/Supabase insert path when
   that module is available.

   This file intentionally does not connect wallets or move tokens.
   ============================================================================ */
(() => {
  "use strict";
  if (window.KombatWagerStore) return;

  const KEY = "troll_kombat_wager_approval_queue_v1";
  const MAX_ITEMS = 100;
  const uid = prefix => prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function readQueue() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeQueue(queue) {
    localStorage.setItem(KEY, JSON.stringify(queue.slice(-MAX_ITEMS)));
  }

  function normalize(record) {
    const now = new Date().toISOString();
    return {
      ...record,
      claim_nonce: record.claim_nonce || uid("wager_review"),
      created_at_client: record.created_at_client || now,
      review_status: record.review_status || "pending_manual_review",
      stake_tx: record.stake_tx || null,
      stake_usd: record.stake_usd == null ? null : record.stake_usd,
      user_agent: record.user_agent || (typeof navigator !== "undefined" ? navigator.userAgent : ""),
    };
  }

  function saveLocal(record) {
    const normalized = normalize(record);
    const queue = readQueue().filter(item => item.claim_nonce !== normalized.claim_nonce);
    queue.push(normalized);
    writeQueue(queue);
    return normalized;
  }

  function asPayoutRecord(record) {
    const allowed = window.TrollPayouts && Array.isArray(window.TrollPayouts.COLUMNS)
      ? window.TrollPayouts.COLUMNS
      : null;
    if (!allowed) return record;
    const out = {};
    allowed.forEach(key => {
      if (record[key] !== undefined) out[key] = record[key];
    });
    return out;
  }

  async function submit(record) {
    const local = saveLocal(record);
    if (!window.TrollPayouts || !window.TrollPayouts.submit) {
      return { ok: true, local: true, remote: false, localRef: local.claim_nonce, payload: local };
    }

    const remote = await window.TrollPayouts.submit(asPayoutRecord(local));
    if (remote && remote.ok) {
      const queue = readQueue().map(item => item.claim_nonce === local.claim_nonce
        ? { ...item, remote_status: "submitted", remote_ref: remote.ref || local.claim_nonce }
        : item);
      writeQueue(queue);
      return { ok: true, local: true, remote: true, localRef: local.claim_nonce, ref: remote.ref, payload: local };
    }

    const queue = readQueue().map(item => item.claim_nonce === local.claim_nonce
      ? { ...item, remote_status: "failed", remote_error: remote && (remote.message || remote.reason) }
      : item);
    writeQueue(queue);
    return {
      ok: true,
      local: true,
      remote: false,
      localRef: local.claim_nonce,
      reason: remote && remote.reason,
      message: remote && remote.message,
      payload: local,
    };
  }

  function clearLocal() {
    localStorage.removeItem(KEY);
  }

  function exportJson() {
    return JSON.stringify(readQueue(), null, 2);
  }

  window.KombatWagerStore = {
    KEY,
    submit,
    saveLocal,
    readQueue,
    clearLocal,
    exportJson,
  };
})();
