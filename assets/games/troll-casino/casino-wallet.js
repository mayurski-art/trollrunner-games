/* ============================================================================
   TROLL CASINO  —  wallet facade  →  window.TrollCasinoWallet

   The ONE place gameplay touches balances. No game ever mutates a number
   directly — it asks this module to debit/credit and re-renders from events.

   REAL MONEY. Two live balances per logged-in account (troll_balance,
   usdc_balance), held server-side in Supabase (assets/supabase/troll_casino.sql):
   - deposit() charges a real on-chain payment via TrollPay/Phantom, then
     confirms it server-side (idempotent on the tx signature) to credit
     the balance. This is the ONLY door money enters through.
   - requestRedemption() debits the balance immediately and files a pending
     payout request that a human (you) reviews and pays by hand — see
     casino-admin.js. This is the ONLY door money leaves through.
   - debit()/credit() (in-round bets/wins) stay synchronous for the game
     code, backed by an optimistic local balance that is queued and synced
     to the server in the background — same trust model every other game's
     score submission already uses (see troll_casino.sql header comment).

   Requires the player to be logged in (TrollrunnerAccounts). Troll Casino
   is hard-gated behind login at the page level (see the inline gate script
   in troll-casino.html) — this module simply refuses to move money for a
   guest (isReady() stays false, debit/credit/deposit/requestRedemption all
   fail closed) as a second line of defense.
   ============================================================================ */
(() => {
  "use strict";
  if (window.TrollCasinoWallet) return;   // singleton

  const HISTORY_CAP = 50;
  const SYNC_KEY = "troll-casino-sync-queue-v1";

  // Currency registry. To add a token later: add an entry here + a chip
  // color in style.css (.balance-chip[data-cur=...]) — everything else is generic.
  const CURRENCIES = {
    TROLL: { code: "TROLL", label: "$TROLL", decimals: 0,
             chips: [500, 1000, 5000, 25000], color: "#3dff8a" },
    USDC:  { code: "USDC",  label: "USDC",   decimals: 2,
             chips: [1, 4.2, 6.9, 20], color: "#3ea8ff" },
  };

  const state = {
    currency: "TROLL",
    balances: { TROLL: 0, USDC: 0 },
    history: [],
    userId: null,
    ready: false,      // true once a real balance has loaded for a logged-in user
  };

  const accounts = () => window.TrollrunnerAccounts;
  const client = () => { const a = accounts(); return a && a.getClient(); };

  /* --- events ---------------------------------------------------------------- */
  const listeners = new Set();
  function emit() { const s = snapshot(); listeners.forEach(fn => { try { fn(s); } catch (_) {} }); }
  function onChange(fn) { if (typeof fn === "function") { listeners.add(fn); fn(snapshot()); } return () => listeners.delete(fn); }
  function snapshot() {
    return {
      currency: state.currency,
      balances: { ...state.balances },
      history: state.history.slice(0, HISTORY_CAP),
      ready: state.ready,
    };
  }

  /* --- reads ------------------------------------------------------------------ */
  const getCurrency = () => state.currency;
  const def = (cur) => CURRENCIES[cur || state.currency];
  const list = () => Object.values(CURRENCIES).map(c => ({ ...c }));
  const getBalance = (cur) => state.balances[cur || state.currency] || 0;
  // Round to the currency's own precision so float drift (e.g. repeated
  // 4.2/6.9 USDC chip bets) can't leave a balance like 0.9999999999999998
  // sitting one epsilon under a whole-number wager.
  const roundCur = (n, cur) => {
    const d = def(cur).decimals;
    const f = 10 ** d;
    return Math.round((Number(n) + Number.EPSILON) * f) / f;
  };
  const canAfford = (amount, cur) => amount > 0 && state.ready && roundCur(getBalance(cur), cur) >= roundCur(amount, cur);
  const isReady = () => state.ready;

  function fmt(amount, cur) {
    const d = def(cur);
    const n = Number(amount) || 0;
    const s = n.toLocaleString("en-US", {
      minimumFractionDigits: 0, maximumFractionDigits: d.decimals,
    });
    return d.code === "TROLL" ? `${s} $TROLL` : `${s} ${d.label}`;
  }

  /* --- local history + optimistic writes -------------------------------------- */
  function record(label, signedAmount, cur) {
    state.history.unshift({ ts: Date.now(), label, amount: signedAmount, currency: cur || state.currency });
    if (state.history.length > HISTORY_CAP) state.history.length = HISTORY_CAP;
  }

  function setCurrency(cur) {
    if (!(cur in CURRENCIES) || cur === state.currency) return state.currency;
    state.currency = cur;
    emit();
    return cur;
  }

  /* --- background sync queue: gameplay deltas are applied locally first (so
     the UI never blocks on a network round trip), then drained into the
     server-side troll_casino_adjust_balance RPC. A refresh mid-flight just
     resumes draining from localStorage — nothing is lost. -------------------- */
  function loadQueue() { try { return JSON.parse(localStorage.getItem(SYNC_KEY) || "[]"); } catch (_) { return []; } }
  function saveQueue(q) { try { localStorage.setItem(SYNC_KEY, JSON.stringify(q.slice(-200))); } catch (_) {} }

  let syncing = false;
  let staleNotified = false;
  async function flushQueue() {
    if (syncing || !state.userId) return;
    const c = client();
    if (!c) return;
    syncing = true;
    try {
      let queue = loadQueue();
      while (queue.length) {
        const item = queue[0];
        try {
          const { error } = await c.rpc("troll_casino_adjust_balance", {
            p_delta: item.delta, p_currency: item.currency, p_reason: item.reason || null,
          });
          if (error) {
            // The server reached and REJECTED this delta (rate limit, loss
            // cap, self-exclusion, range check) — retrying it forever would
            // wedge every item queued behind it. Park it and pull the real
            // balance from the server so the local optimistic number can't
            // silently drift from truth for the rest of the session.
            queue.shift();
            saveQueue(queue);
            await reconcileFromServer(`Blocked: ${error.message || "balance update rejected"}`);
            continue;
          }
          queue.shift();
          saveQueue(queue);
        } catch (_) { break; } // thrown = network/offline — stop, retry next flush, keep the item
      }
      // Anything still queued after 2 minutes is either offline for a long
      // stretch or stuck — resync from server truth so the visible balance
      // never silently diverges, then keep draining on the next flush.
      const oldest = queue[0];
      if (oldest && Date.now() - oldest.ts > 120000 && !staleNotified) {
        staleNotified = true;
        await reconcileFromServer("Reconnected after a delay — balance re-synced from the server.");
      } else if (!queue.length) {
        staleNotified = false;
      }
    } finally { syncing = false; }
  }

  async function reconcileFromServer(note) {
    const c = client();
    if (!c) return;
    try {
      const { data, error } = await c.rpc("troll_casino_ensure_wallet");
      if (!error && data) {
        state.balances.TROLL = Number(data.troll_balance) || 0;
        state.balances.USDC = Number(data.usdc_balance) || 0;
        if (note) record(note, 0, state.currency);
        emit();
      }
    } catch (_) {}
  }
  function queueDelta(delta, currency, reason) {
    const q = loadQueue();
    q.push({ delta, currency, reason: reason || null, ts: Date.now() });
    saveQueue(q);
    flushQueue();
  }

  /* --- writes ------------------------------------------------------------------
     Amounts are always positive; direction comes from the method. Returns
     false (and changes nothing) when not logged in or the debit doesn't cover. */
  function debit(amount, label, cur) {
    cur = cur || state.currency;
    if (!canAfford(amount, cur)) return false;
    state.balances[cur] = roundCur(state.balances[cur] - amount, cur);
    record(label || "Debit", -amount, cur);
    queueDelta(-amount, cur, label);
    emit();
    return true;
  }
  function credit(amount, label, cur) {
    cur = cur || state.currency;
    if (!state.ready || !(amount > 0)) return false;
    state.balances[cur] = roundCur(state.balances[cur] + amount, cur);
    record(label || "Credit", +amount, cur);
    queueDelta(amount, cur, label);
    emit();
    return true;
  }

  function mode() { return "real"; }

  /* --- session lifecycle -------------------------------------------------------- */
  async function trollUsdPrice() {
    try {
      if (window.TrollPayments && window.TrollPayments.trollUsdPrice) {
        const p = await window.TrollPayments.trollUsdPrice();
        if (p > 0) return p;
      }
    } catch (_) {}
    return null;
  }

  async function init() {
    const a = accounts();
    if (!a) return;
    const session = a.getCachedProfile() || await a.getSession();
    if (!session) {
      state.ready = false; state.userId = null;
      state.balances = { TROLL: 0, USDC: 0 };
      emit();
      return;
    }
    state.userId = session.userId;
    const c = client();
    if (!c) return;
    try {
      const { data, error } = await c.rpc("troll_casino_ensure_wallet");
      if (!error && data) {
        state.balances.TROLL = Number(data.troll_balance) || 0;
        state.balances.USDC = Number(data.usdc_balance) || 0;
      }
    } catch (_) {}
    state.ready = true;
    emit();
    flushQueue();
  }

  window.addEventListener("trollrunner:auth-changed", (e) => { init(); });

  /* --- deposit: real payment in, via TrollPay + Phantom ------------------------- */
  async function deposit(usdAmount, cur, onProgress) {
    cur = cur || state.currency;
    usdAmount = Number(usdAmount);
    if (!state.userId) return { ok: false, reason: "login-required", message: "Log in to deposit." };
    if (!(usdAmount > 0)) return { ok: false, reason: "invalid" };
    const TP = window.TrollPay;
    if (!TP) return { ok: false, reason: "unavailable", message: "Payment library not loaded." };
    const TW = window.TrollWallet;
    if (TW && !TW.isConnected()) {
      const conn = await TW.connect();
      if (!conn || !conn.connected) return { ok: false, reason: "wallet", message: "Connect Phantom to deposit." };
    }

    let tokenAmount = usdAmount;
    if (cur === "TROLL") {
      const price = await trollUsdPrice();
      if (!price) return { ok: false, reason: "price", message: "$TROLL price unavailable — try again shortly." };
      tokenAmount = usdAmount / price;
    }

    const res = await TP.pay({ amountUsd: usdAmount, taxRate: 0, token: cur, memo: "TR|casino|Deposit", onProgress });
    if (!res || !res.ok) return res || { ok: false, reason: "failed" };

    const c = client();
    if (!c) return { ok: false, reason: "unavailable" };
    try {
      const wallet = TW && TW.getAddress ? TW.getAddress() : null;
      const { data, error } = await c.rpc("troll_casino_confirm_deposit", {
        p_token: cur, p_amount_usd: usdAmount, p_token_amount: tokenAmount,
        p_tx_sig: res.txSig, p_wallet: wallet,
      });
      if (error) return { ok: false, reason: "db", message: error.message, txSig: res.txSig };
      state.balances[cur] = Number(data);
      record("Deposit", tokenAmount, cur);
      emit();
      try {
        a_logSpend(cur, tokenAmount, wallet, res.txSig);
      } catch (_) {}
      return { ok: true, txSig: res.txSig, credited: tokenAmount };
    } catch (e) {
      return { ok: false, reason: "db", message: String((e && e.message) || e), txSig: res.txSig };
    }
  }
  function a_logSpend(token, amount, wallet, signature) {
    const a = accounts();
    if (a && a.logPendingSpend) {
      a.logPendingSpend({ token, amount, wallet, signature, purpose: "casino_deposit", feature: "troll-casino" }).catch(() => {});
    }
  }

  /* --- Troll Wheel: stake debit + segment pick + payout credit, atomic and
     server-side (troll_casino_wheel_spin). Replaces the old pattern of the
     game module picking its own RNG target and calling debit()/credit()
     directly — that let anyone credit their own balance from devtools
     without a spin ever happening. ------------------------------------- */
  async function playWheel(bets, cur) {
    cur = cur || state.currency;
    if (!state.userId) return { ok: false, reason: "login-required" };
    const c = client();
    if (!c) return { ok: false, reason: "unavailable" };
    try {
      const { data, error } = await c.rpc("troll_casino_wheel_spin", { p_bets: bets, p_currency: cur });
      if (error) return { ok: false, reason: "db", message: error.message };
      const row = Array.isArray(data) ? data[0] : data;
      state.balances[cur] = Number(row.new_balance);
      record(row.won ? "Troll Wheel win" : "Troll Wheel stake", Number(row.payout) - Number(row.total_staked), cur);
      emit();
      return {
        ok: true,
        segmentIndex: row.segment_index,
        zoneId: row.zone_id,
        totalStaked: Number(row.total_staked),
        payout: Number(row.payout),
        won: row.won,
      };
    } catch (e) { return { ok: false, reason: "db", message: String((e && e.message) || e) }; }
  }

  /* --- Doge Jackpot Reels: bet debit + grid draw + payline/scatter eval +
     jackpot draw + win credit, atomic and server-side
     (troll_casino_slots_spin). Replaces the old pattern of the game module
     drawing its own grid, evaluating its own paylines, and calling
     debit()/credit() (plus the shared jackpot RPCs) directly with
     client-chosen amounts. ------------------------------------------- */
  async function playSlots(bet, cur) {
    cur = cur || state.currency;
    if (!state.userId) return { ok: false, reason: "login-required" };
    const c = client();
    if (!c) return { ok: false, reason: "unavailable" };
    try {
      const { data, error } = await c.rpc("troll_casino_slots_spin", { p_bet: bet, p_currency: cur });
      if (error) return { ok: false, reason: "db", message: error.message };
      const credited = Number(data.total) + Number(data.jackpotWon);
      state.balances[cur] = Number(data.newBalance);
      record(credited > 0 ? "Doge Reels win" : "Doge Reels spin", credited - Number(bet), cur);
      emit();
      return { ok: true, ...data };
    } catch (e) { return { ok: false, reason: "db", message: String((e && e.message) || e) }; }
  }

  /* --- redemption: real payout out, manual admin review ------------------------- */
  async function requestRedemption({ amount, token, wallet }) {
    token = token || state.currency;
    amount = Number(amount);
    if (!state.userId) return { ok: false, reason: "login-required" };
    if (!(amount > 0) || !canAfford(amount, token)) return { ok: false, reason: "insufficient" };
    if (!wallet || String(wallet).trim().length < 20) return { ok: false, reason: "bad-wallet", message: "Enter a valid payout wallet address." };
    const c = client();
    if (!c) return { ok: false, reason: "unavailable" };
    try {
      const { data, error } = await c.rpc("troll_casino_request_redemption", {
        p_wallet: String(wallet).trim(), p_token: token, p_token_amount: amount,
      });
      if (error) return { ok: false, reason: "db", message: error.message };
      state.balances[token] -= amount;
      record("Redeem requested", -amount, token);
      emit();
      return { ok: true, id: data };
    } catch (e) { return { ok: false, reason: "db", message: String((e && e.message) || e) }; }
  }

  async function listMyRedemptions() {
    const c = client();
    if (!c || !state.userId) return [];
    try {
      const { data } = await c.from("troll_casino_redemptions").select("*")
        .eq("user_id", state.userId).order("created_at", { ascending: false });
      return data || [];
    } catch (_) { return []; }
  }

  // Wallet connect chip — delegated wholesale to the shared Phase 10 module.
  function mountWalletChip(elOrSel) {
    if (window.TrollWallet?.mountStatus) return window.TrollWallet.mountStatus(elOrSel);
    return () => {};
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.TrollCasinoWallet = {
    list, getCurrency, setCurrency, getBalance, canAfford, fmt,
    debit, credit, onChange, getHistory: () => snapshot().history,
    deposit, requestRedemption, listMyRedemptions, mode, mountWalletChip, isReady,
    playWheel, playSlots,
  };
})();
