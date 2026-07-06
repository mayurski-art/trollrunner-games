/* ============================================================================
   TROLL CASINO  —  wallet facade  →  window.TrollCasinoWallet

   The ONE place gameplay touches balances. The wheel never mutates a number
   directly — it asks this module to debit/credit and re-renders from events.

   TODAY (mock mode — the default, and the only mode until flags flip):
   - $TROLL and USDC balances are LOCAL mock chips in localStorage.
   - deposit() routes through the shared TrollPayments confirm screen (which is
     itself mock unless ENABLE_REAL_PAYMENTS is on) and credits mock chips.
   - withdraw() is mock-only and refuses to pretend in real mode (needs a
     payout backend — see docs/PART2-SYSTEMS.md). Fails closed.

   LATER (real money — DO NOT wire casually):
   - Replace load()/save() with balance reads from the accounts backend
     (assets/js/backend-api.js) keyed to the signed-in TrollrunnerAccounts user.
   - debit()/credit() become server calls; keep the same signatures and the
     whole game keeps working.
   - Wallet connect stays TrollWallet's job; on-chain moves stay TrollPayments'.

   Every real path in the chain (flags → wallet → payments → backend) already
   fails closed, so shipping this file moves no money anywhere.
   ============================================================================ */
(() => {
  "use strict";
  if (window.TrollCasinoWallet) return;   // singleton

  const LS_KEY = "troll-casino-wallet-v1";
  const HISTORY_CAP = 50;

  // Currency registry. To add a token later: add an entry here + a chip color
  // in style.css (.balance-chip[data-cur=...]) — everything else is generic.
  const CURRENCIES = {
    TROLL: { code: "TROLL", label: "$TROLL", decimals: 0, start: 250000,
             chips: [500, 1000, 5000, 25000], color: "#3dff8a" },
    USDC:  { code: "USDC",  label: "USDC",   decimals: 2, start: 500,
             chips: [1, 5, 25, 100], color: "#3ea8ff" },
  };

  const state = {
    currency: "TROLL",
    balances: { TROLL: CURRENCIES.TROLL.start, USDC: CURRENCIES.USDC.start },
    history: [],          // { ts, label, amount (signed), currency }
  };

  /* --- persistence (mock chips only) --------------------------------------- */
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (!raw) return;
      if (raw.currency in CURRENCIES) state.currency = raw.currency;
      for (const c in CURRENCIES) {
        if (typeof raw.balances?.[c] === "number" && raw.balances[c] >= 0) {
          state.balances[c] = raw.balances[c];
        }
      }
      if (Array.isArray(raw.history)) state.history = raw.history.slice(0, HISTORY_CAP);
    } catch (_) { /* corrupted store → fresh mock balances */ }
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) {}
  }

  /* --- events ---------------------------------------------------------------- */
  const listeners = new Set();
  function emit() { const s = snapshot(); listeners.forEach(fn => { try { fn(s); } catch (_) {} }); }
  function onChange(fn) { if (typeof fn === "function") { listeners.add(fn); fn(snapshot()); } return () => listeners.delete(fn); }
  function snapshot() {
    return {
      currency: state.currency,
      balances: { ...state.balances },
      history: state.history.slice(0, HISTORY_CAP),
    };
  }

  /* --- reads ------------------------------------------------------------------ */
  const getCurrency = () => state.currency;
  const def = (cur) => CURRENCIES[cur || state.currency];
  const list = () => Object.values(CURRENCIES).map(c => ({ ...c }));
  const getBalance = (cur) => state.balances[cur || state.currency] || 0;
  const canAfford = (amount, cur) => amount > 0 && getBalance(cur) >= amount;

  function fmt(amount, cur) {
    const d = def(cur);
    const n = Number(amount) || 0;
    const s = n.toLocaleString("en-US", {
      minimumFractionDigits: 0, maximumFractionDigits: d.decimals,
    });
    return d.code === "TROLL" ? `${s} $TROLL` : `${s} ${d.label}`;
  }

  /* --- writes ------------------------------------------------------------------
     Amounts are always positive; direction comes from the method. Returns
     false (and changes nothing) when the debit doesn't cover. */
  function record(label, signedAmount, cur) {
    state.history.unshift({ ts: Date.now(), label, amount: signedAmount, currency: cur || state.currency });
    if (state.history.length > HISTORY_CAP) state.history.length = HISTORY_CAP;
  }
  function debit(amount, label, cur) {
    cur = cur || state.currency;
    if (!(amount > 0) || state.balances[cur] < amount) return false;
    state.balances[cur] -= amount;
    record(label || "Debit", -amount, cur);
    save(); emit();
    return true;
  }
  function credit(amount, label, cur) {
    cur = cur || state.currency;
    if (!(amount > 0)) return false;
    state.balances[cur] += amount;
    record(label || "Credit", +amount, cur);
    save(); emit();
    return true;
  }
  function setCurrency(cur) {
    if (!(cur in CURRENCIES) || cur === state.currency) return state.currency;
    state.currency = cur;
    save(); emit();
    return cur;
  }
  function resetMock() {
    for (const c in CURRENCIES) state.balances[c] = CURRENCIES[c].start;
    state.history = [];
    record("Mock balances reset", 0, state.currency);
    save(); emit();
  }

  /* --- mode + money-movement stubs --------------------------------------------
     mode() reports what the flag stack would allow; the casino UI shows it so
     nobody mistakes mock chips for chain balances. */
  function mode() {
    const f = window.TROLL_FLAGS;
    return f && f.realPaymentsLive && f.realPaymentsLive() ? "real" : "mock";
  }

  // Deposit: hand the request to TrollPayments (it owns confirm screens and the
  // mock/real decision), then credit table chips on success. In mock mode this
  // is a safe, clearly-labelled simulation end to end.
  async function deposit(amount, cur) {
    cur = cur || state.currency;
    if (!(amount > 0)) return { ok: false, reason: "invalid" };
    const pay = window.TrollPayments;
    if (!pay) return { ok: false, reason: "unavailable", message: "Payments module not loaded." };
    const res = await pay.requestPayment({
      action: "Deposit to Troll Casino",
      token: cur, amount,
      dedupeKey: `casino-deposit-${cur}-${Date.now()}`,
    });
    if (res && res.ok) credit(amount, res.mock ? "Deposit (mock)" : "Deposit", cur);
    return res;
  }

  // Withdraw: mock refund only. Real withdrawals need the Part 2 claims/payout
  // backend, which is deliberately not built — so real mode refuses (closed).
  async function withdraw(amount, cur) {
    cur = cur || state.currency;
    if (!(amount > 0) || !canAfford(amount, cur)) return { ok: false, reason: "insufficient" };
    if (mode() === "real") {
      return { ok: false, reason: "unavailable",
               message: "Real withdrawals need the payout backend (docs/PART2-SYSTEMS.md)." };
    }
    debit(amount, "Withdraw (mock)", cur);
    return { ok: true, mock: true };
  }

  // Wallet connect chip — delegated wholesale to the shared Phase 10 module.
  function mountWalletChip(elOrSel) {
    if (window.TrollWallet?.mountStatus) return window.TrollWallet.mountStatus(elOrSel);
    return () => {};
  }

  load();

  window.TrollCasinoWallet = {
    list, getCurrency, setCurrency, getBalance, canAfford, fmt,
    debit, credit, onChange, getHistory: () => snapshot().history,
    deposit, withdraw, resetMock, mode, mountWalletChip,
  };
})();
