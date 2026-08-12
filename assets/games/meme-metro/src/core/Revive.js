// Real on-chain revive payment — ported from Troll Dash's game.js so both
// games share the same TrollPay flow: Phantom desktop connect, mobile
// Solana Pay deep link, USDC or $TROLL, confirmed against the treasury.
// Decoupled from Game: constructed with onResume/onDecline callbacks and
// wired to it as `game.revive` by main.js (see Game.onCrash).

const REVIVE_PENDING_KEY = "meme_metro_revive_pending";
const REVIVE_MEMO = "TR|game|Meme Metro revive";

export class ReviveController {
  constructor({ audio, onResume, onDecline }) {
    this.audio = audio;
    this.onResume = onResume;
    this.onDecline = onDecline;

    this.dom = {
      prompt: document.getElementById('revive-prompt'),
      ready: document.getElementById('revive-ready'),
      button: document.getElementById('btn-revive'),
      declineButton: document.getElementById('btn-revive-no'),
      confirmButton: document.getElementById('btn-revive-confirm'),
      status: document.getElementById('revive-status'),
      cost: document.getElementById('revive-cost'),
      payTokenPicker: document.getElementById('pay-token-picker'),
      banner: document.getElementById('revived-banner'),
    };

    this.phase = 'idle'; // idle | paying | ready | confirming
    this.mobileUrl = null;
    this.mobileToken = 'USDC';
    this.mobileSig = null;
    this.mobileConfirmRunning = false;
    this.active = false; // true while the revive screen is open

    this.dom.button?.addEventListener('click', () => this.onButtonClick());
    this.dom.declineButton?.addEventListener('click', () => this.decline());
    this.dom.confirmButton?.addEventListener('click', () => this.confirmResume());

    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.checkPendingMobile(); });
    window.addEventListener('pageshow', () => this.checkPendingMobile());
    window.addEventListener('focus', () => this.checkPendingMobile());

    const TP = this.TP();
    if (TP) {
      TP.setToken('TROLL'); // games default to $TROLL (falls back to USDC if unavailable)
      TP.warmTrollPrice && TP.warmTrollPrice();
      if (this.dom.payTokenPicker) {
        TP.mountTokenPicker(this.dom.payTokenPicker, () => { this.refreshCost(); this.prepareMobile(); });
      }
    }
    this.refreshCost();
  }

  TP() { return window.TrollPay; }
  isAdmin() { const TP = this.TP(); return !!(TP && TP.isAdminBypass && TP.isAdminBypass()); }
  mobilePay() { const TP = this.TP(); return !!(TP && TP.shouldUseSolanaPay && TP.shouldUseSolanaPay()); }
  token() { const TP = this.TP(); return (TP && TP.getToken()) || 'USDC'; }
  priceUsd() { return (window.TROLL_PAY_CONFIG && window.TROLL_PAY_CONFIG.REVIVE_PRICE_USD) || 0.69; }
  taxRate() { return (window.TROLL_PAY_CONFIG && window.TROLL_PAY_CONFIG.TAX_RATE) || 0.069; }
  totalUsd() { return this.priceUsd() * (1 + this.taxRate()); }
  // The owner's account never sees a price or token choice — just a free revive.
  costText() {
    if (this.isAdmin()) return '';
    const total = this.totalUsd();
    return this.token() === 'TROLL' ? `$${total.toFixed(2)} in $TROLL` : `${total.toFixed(2)} USDC`;
  }
  setStatus(msg) { if (this.dom.status) this.dom.status.textContent = msg || ''; }
  refreshCost() { if (this.dom.cost) this.dom.cost.textContent = this.costText(); }

  // Called by Game when the death screen offers a revive.
  open() {
    this.active = true;
    this.phase = 'idle';
    this.mobileConfirmRunning = false;
    if (this.dom.prompt) this.dom.prompt.hidden = false;
    if (this.dom.ready) this.dom.ready.hidden = true;
    this.setStatus('');
    this.refreshCost();
    if (this.dom.payTokenPicker) this.dom.payTokenPicker.hidden = this.isAdmin();
    if (this.dom.button) {
      if (this.mobilePay()) { this.dom.button.disabled = false; this.dom.button.textContent = 'Preparing…'; }
      else { this.dom.button.disabled = false; this.dom.button.textContent = 'Revive'; }
    }
    this.prepareMobile();
  }

  // Pre-build the Solana Pay URL while the death screen is up, so the tap
  // can navigate to Phantom SYNCHRONOUSLY — iOS blocks custom-scheme links
  // fired after an await (the user-gesture is lost).
  async prepareMobile() {
    if (!this.mobilePay() || !this.active) return;
    const TP = this.TP();
    if (!TP) return;
    const token = this.token();
    if (this.dom.button && this.phase === 'idle') this.dom.button.textContent = 'Preparing…';

    this.mobileSig = null;
    TP.latestTreasurySig(token).then(s => { this.mobileSig = s; }).catch(() => {});

    let url = null, payToken = 'USDC';
    try {
      url = await TP.solanaPayUrl({
        amountUsd: this.totalUsd(), token: 'USDC',
        label: 'Meme Metro Revive', message: 'Revive in Meme Metro', memo: REVIVE_MEMO,
      });
    } catch (_) {}

    if (token === 'TROLL') {
      try {
        url = await TP.solanaPayUrl({
          amountUsd: this.totalUsd(), token: 'TROLL',
          label: 'Meme Metro Revive', message: 'Revive in Meme Metro', memo: REVIVE_MEMO,
        });
        payToken = 'TROLL';
        this.setStatus('');
      } catch (_) {
        this.setStatus('$TROLL price slow — tap to pay in USDC (or retry for $TROLL).');
      }
    }

    this.mobileUrl = url;
    this.mobileToken = payToken;
    if (this.dom.button && this.phase === 'idle' && this.active) this.dom.button.textContent = 'Revive';
  }

  onButtonClick() {
    if (this.phase === 'confirming') { this.manualMobileResume(); return; }
    this.start();
  }

  async start() {
    if (!this.active || this.phase !== 'idle') return;
    const TP = this.TP();
    if (!TP) { this.setStatus('Payments unavailable — reload the page.'); return; }
    const token = this.token();

    // Mobile (no injected wallet): hand off to Phantom via the PRE-BUILT
    // Solana Pay URL, navigating synchronously to keep the user-gesture.
    if (this.mobilePay()) {
      if (!this.mobileUrl) {
        this.setStatus('Preparing payment — tap Revive again in a moment.');
        this.prepareMobile();
        return;
      }
      this.phase = 'paying';
      sessionStorage.setItem(REVIVE_PENDING_KEY, JSON.stringify({ token: this.mobileToken, sinceSig: this.mobileSig, ts: Date.now() }));
      this.dom.button.textContent = 'Opening Phantom…';
      this.setStatus('Approve in Phantom, then come back to the game.');
      window.location.href = this.mobileUrl;
      return;
    }

    const admin = this.isAdmin();
    this.phase = 'paying';
    this.dom.button.disabled = true;
    this.dom.button.textContent = admin ? 'Reviving…' : 'Connect wallet…';
    this.setStatus('');
    const res = await TP.pay({
      amountUsd: this.priceUsd(), taxRate: this.taxRate(), token, memo: REVIVE_MEMO,
      onProgress: admin ? null : (ev) => {
        if (ev.stage === 'connecting') this.dom.button.textContent = 'Connect wallet…';
        else if (ev.stage === 'building') this.dom.button.textContent = 'Building tx…';
        else if (ev.stage === 'awaiting') this.dom.button.textContent = 'Confirm in Phantom…';
        else if (ev.stage === 'confirming') this.dom.button.textContent = 'Confirming…';
      },
    });
    if (!res.ok) {
      this.phase = 'idle';
      this.dom.button.disabled = false; this.dom.button.textContent = 'Revive';
      this.setStatus('⚠ ' + (res.reason || 'Payment failed'));
      return;
    }
    this.onPaid();
  }

  // Mobile: on return from Phantom, confirm the payment landed by polling
  // the treasury. Always leaves a manual "I paid" fallback so a player who
  // paid is never stuck.
  async checkPendingMobile() {
    const raw = sessionStorage.getItem(REVIVE_PENDING_KEY);
    if (!raw) return;
    const TP = this.TP();
    if (!TP || !this.active) { sessionStorage.removeItem(REVIVE_PENDING_KEY); return; }
    if (this.phase === 'ready' || this.mobileConfirmRunning) return;
    let pending;
    try { pending = JSON.parse(raw); } catch (e) { sessionStorage.removeItem(REVIVE_PENDING_KEY); return; }
    this.mobileConfirmRunning = true;
    this.phase = 'confirming';
    if (this.dom.button) { this.dom.button.disabled = false; this.dom.button.textContent = 'I paid — Resume'; }
    this.setStatus('Confirming your payment…');
    const result = await TP.waitForNewTreasuryPayment(pending.token, pending.sinceSig, 70000, null);
    this.mobileConfirmRunning = false;
    if (this.phase !== 'confirming') return;
    if (result.ok) { sessionStorage.removeItem(REVIVE_PENDING_KEY); this.onPaid(); return; }
    this.setStatus("Couldn't auto-confirm. If you completed the payment, tap \"I paid — Resume\".");
    if (this.dom.button) { this.dom.button.disabled = false; this.dom.button.textContent = 'I paid — Resume'; }
  }

  // Fallback for when auto-detection (checkPendingMobile) gave up before
  // seeing the payment land. This must re-check the treasury itself rather
  // than trust the tap — otherwise opening Phantom and cancelling/backing
  // out, then tapping "I paid — Resume", grants a free revive with nothing
  // ever paid.
  async manualMobileResume() {
    if (this.mobileConfirmRunning) return;
    const raw = sessionStorage.getItem(REVIVE_PENDING_KEY);
    const TP = this.TP();
    if (!raw || !TP) { sessionStorage.removeItem(REVIVE_PENDING_KEY); this.setStatus('Nothing pending — tap Revive to pay.'); return; }
    let pending;
    try { pending = JSON.parse(raw); } catch (e) { sessionStorage.removeItem(REVIVE_PENDING_KEY); return; }

    this.mobileConfirmRunning = true;
    if (this.dom.button) { this.dom.button.disabled = true; this.dom.button.textContent = 'Checking payment…'; }
    this.setStatus('Confirming your payment…');
    const result = await TP.waitForNewTreasuryPayment(pending.token, pending.sinceSig, 20000, null);
    this.mobileConfirmRunning = false;
    if (this.phase !== 'confirming') return;

    if (result.ok) {
      sessionStorage.removeItem(REVIVE_PENDING_KEY);
      this.onPaid();
      return;
    }
    this.setStatus("Still can't find that payment. Wait a moment and tap \"I paid — Resume\" again, or Decline and pay fresh.");
    if (this.dom.button) { this.dom.button.disabled = false; this.dom.button.textContent = 'I paid — Resume'; }
  }

  onPaid() {
    if (this.phase === 'ready') return;
    this.phase = 'ready';
    if (this.dom.prompt) this.dom.prompt.hidden = true;
    if (this.dom.ready) this.dom.ready.hidden = false;
    this.audio.play('powerup');
  }

  confirmResume() {
    if (this.phase !== 'ready') return;
    this.active = false;
    if (this.dom.banner) {
      this.dom.banner.textContent = this.token() === 'TROLL' ? 'REVIVED BY $TROLL' : 'REVIVED BY USDC';
      this.dom.banner.classList.remove('is-visible');
      void this.dom.banner.offsetWidth;
      this.dom.banner.classList.add('is-visible');
    }
    this.onResume();
  }

  decline() {
    this.active = false;
    this.onDecline();
  }
}
