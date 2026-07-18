/* ============================================================================
   TROLL RUNNER ARCADE  —  Wallet module (Phase 10)   →  window.TrollWallet

   The single source of truth for wallet state. Detects/connects Phantom,
   exposes the connected address, and renders a status chip. Wallet state is
   kept ENTIRELY here — gameplay never reads or mutates it directly.

   SAFETY
   - Connecting a wallet moves no money. Real connect still requires
     TROLL_FLAGS.ENABLE_WALLET_CONNECT. With it OFF, `connect()` runs a MOCK
     connect (a clearly-fake address) so the UX can be tested with no extension.
   - This module never builds or sends transactions — that's payments.js.
   - Designed so other providers (Backpack, Solflare, WalletConnect) can be
     added behind the same interface later.
   ============================================================================ */
(() => {
  "use strict";
  if (window.TrollWallet) return;   // singleton

  const FLAGS = () => window.TROLL_FLAGS || {};
  const realConnectAllowed = () => FLAGS().ENABLE_WALLET_CONNECT === true;

  // --- state (isolated) ------------------------------------------------------
  const state = {
    connected: false,
    address: null,
    provider: null,     // "phantom" | "mock"
    mock: true,
    balances: null,     // { troll, usdc } once loaded — null while unknown/loading
  };
  const listeners = new Set();
  function emit() {
    const snap = getState();
    listeners.forEach(fn => { try { fn(snap); } catch (_) {} });
  }

  // Real balances only mean anything for a real, connected address — mock
  // mode has nothing on-chain to read. Fetched via TrollPay (plain RPC reads,
  // no signature/approval needed) so this works independent of whether the
  // page ever calls TrollPay.connect() itself.
  let _balanceReq = 0;
  async function refreshBalances() {
    if (state.mock || !state.address || !window.TrollPay || !window.TrollPay.getBalances) {
      state.balances = null;
      return;
    }
    const reqId = ++_balanceReq;
    try {
      const bal = await window.TrollPay.getBalances(state.address);
      if (reqId === _balanceReq && state.address) { state.balances = bal; emit(); }
    } catch (_) {}
  }

  // --- Phantom detection -----------------------------------------------------
  function getPhantom() {
    return (window.phantom && window.phantom.solana) || (window.solana && window.solana.isPhantom ? window.solana : null);
  }
  function isAvailable() { return !!(getPhantom() && getPhantom().isPhantom); }

  // --- helpers ---------------------------------------------------------------
  function shortAddress(addr) {
    if (!addr) return "";
    return addr.length <= 10 ? addr : addr.slice(0, 4) + "…" + addr.slice(-4);
  }
  function getState() {
    return { connected: state.connected, address: state.address, provider: state.provider,
             mock: state.mock, short: shortAddress(state.address), balances: state.balances };
  }
  const isConnected = () => state.connected;
  const getAddress  = () => state.address;
  const mode = () => (realConnectAllowed() ? "real" : "mock");

  // Deterministic-ish fake address so mock UI looks real (clearly labelled mock).
  function mockAddress() {
    const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
    let s = "Mock";
    for (let i = 0; i < 36; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }

  // --- connect / disconnect --------------------------------------------------
  let _phantomListener = false;
  async function connectReal() {
    const phantom = getPhantom();
    if (!phantom || !phantom.isPhantom) {
      const err = new Error("Phantom wallet is not installed.");
      err.code = "NO_PROVIDER"; throw err;
    }
    let resp;
    try {
      resp = await phantom.connect();
    } catch (e) {
      // Phantom rejection → code 4001
      const err = new Error(e && e.code === 4001 ? "You rejected the wallet connection." : "Wallet connection failed.");
      err.code = e && e.code === 4001 ? "USER_REJECTED" : "CONNECT_FAILED";
      throw err;
    }
    state.connected = true;
    state.address = resp.publicKey.toString();
    state.provider = "phantom";
    state.mock = false;
    state.balances = null;
    if (phantom.on && !_phantomListener) {
      _phantomListener = true;
      phantom.on("accountChanged", (pk) => {
        state.address = pk ? pk.toString() : null;
        state.connected = !!pk;
        state.balances = null;
        if (!pk) state.provider = null;
        emit();
        if (pk) refreshBalances();
      });
      phantom.on("disconnect", () => { _reset(); emit(); });
    }
    return getState();
  }
  function connectMock() {
    state.connected = true;
    state.address = mockAddress();
    state.provider = "mock";
    state.mock = true;
    state.balances = null;
    return getState();
  }
  function _reset() {
    state.connected = false; state.address = null; state.provider = null; state.mock = true;
    state.balances = null;
  }

  async function connect() {
    let result;
    if (realConnectAllowed()) result = await connectReal();
    else result = connectMock();         // mock connect — no extension, no money
    if (window.TrollBackend) { try { await window.TrollBackend.verifyWalletSession({ address: state.address }); } catch (_) {} }
    emit();
    refreshBalances();
    return result;
  }
  async function disconnect() {
    try {
      const phantom = getPhantom();
      if (state.provider === "phantom" && phantom && phantom.disconnect) await phantom.disconnect();
    } catch (_) {}
    _reset();
    emit();
    return getState();
  }

  // --- events ----------------------------------------------------------------
  function onChange(fn) { if (typeof fn === "function") { listeners.add(fn); fn(getState()); } return () => listeners.delete(fn); }

  /* ==========================================================================
     UI  —  a self-contained status chip: Connect / Connected+short addr /
     Disconnect, plus a clear "Phantom not installed" warning.
     ========================================================================== */
  function mountStatus(elOrSel, opts = {}) {
    const root = typeof elOrSel === "string" ? document.querySelector(elOrSel) : elOrSel;
    if (!root) return () => {};
    function balancesHtml(s) {
      if (s.mock || !s.balances) return "";
      const parts = [];
      if (s.balances.troll != null) parts.push(`${s.balances.troll.toLocaleString("en-US", { maximumFractionDigits: 0 })} $TROLL`);
      if (s.balances.usdc != null) parts.push(`${s.balances.usdc.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`);
      return parts.length ? `<span class="tw-balances">${parts.join(" · ")}</span>` : "";
    }
    function render(s) {
      const installLink = '<a href="https://phantom.app/" target="_blank" rel="noopener">Get Phantom</a>';
      if (s.connected) {
        root.innerHTML =
          `<span class="tw-chip tw-connected">` +
            `<span class="tw-dot"></span>` +
            `<span class="tw-addr" title="${s.address || ""}">${s.short}</span>` +
            (s.mock ? `<span class="tw-badge tw-mock">MOCK</span>` : `<span class="tw-badge tw-real">PHANTOM</span>`) +
          `</span>` +
          balancesHtml(s) +
          `<button type="button" class="tw-btn tw-disconnect">Disconnect</button>`;
        root.querySelector(".tw-disconnect").addEventListener("click", () => disconnect());
      } else {
        const realOn = realConnectAllowed();
        const noProv = realOn && !isAvailable();
        root.innerHTML =
          `<button type="button" class="tw-btn tw-connect"${noProv ? " disabled" : ""}>` +
            `${realOn ? "Connect Phantom Wallet" : "Connect Wallet (mock)"}` +
          `</button>` +
          (noProv ? `<span class="tw-warn">⚠ Phantom not detected. ${installLink}</span>`
                  : (!realOn ? `<span class="tw-note">Mock mode — no real wallet</span>` : ``));
        const btn = root.querySelector(".tw-connect");
        if (btn && !noProv) btn.addEventListener("click", async () => {
          btn.disabled = true; btn.textContent = "Connecting…";
          try { await connect(); }
          catch (e) {
            render(getState());
            const warn = document.createElement("span");
            warn.className = "tw-warn"; warn.textContent = "⚠ " + (e.message || "Connection failed");
            root.appendChild(warn);
            if (typeof opts.onError === "function") opts.onError(e);
          }
        });
      }
    }
    const off = onChange(render);
    return off;   // call to unsubscribe
  }

  window.TrollWallet = {
    isAvailable, connect, disconnect, isConnected, getAddress, getState,
    shortAddress, onChange, mountStatus, mode,
  };
})();
