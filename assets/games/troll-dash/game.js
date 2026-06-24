(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Troll Dash: Rugpull Run  —  pseudo-3D temple runner
   * Subway-Surfers-style swipe controls, 3rd-person follow camera,
   * tiled temple corridor. The buff troll charges the cursed chart.
   * ------------------------------------------------------------------ */

  // --- Economy / persistence -----------------------------------------
  const REVIVE_COST = 6.9;
  const TREASURY_WALLET = "79vVRZ7qnZfj9xCto5d9Kwf4eAimqMDrQysZjHBbFbsA";
  const TROLL_MINT_ADDRESS = "REPLACE_WITH_VERIFIED_TROLL_SPL_MINT_ADDRESS";
  const HIGH_SCORE_KEY = "troll_dash_high_score_v2";
  const MOCK_WALLET_START_BALANCE = 42;
  const DEATH_MESSAGES = ["RUGGED", "LIQUIDATED", "REKT", "PAPER HANDS", "SUPPORT BROKE", "GG NO RE"];

  // Iconic trollface, stamped on the collectible coins instead of a plain "T".
  const TROLL_COIN_IMG = new Image();
  TROLL_COIN_IMG.src = "https://media.tenor.com/kkkBm71bkRcAAAAi/trollface-troll-face-terror-png.gif";

  // --- Pseudo-3D camera ----------------------------------------------
  const CAM = { depth: 1.62, height: 1.02, horizon: 0.4 };
  const CAM_FOLLOW = 0.6;        // how much the camera trails the player's lane (0..1)
  const LANE_W = 0.82;
  const ROAD_HALF = 1.4;
  const WALL_X = 1.92;
  const PLAYER_Z = 3.1;
  const SPAWN_Z = 160;
  const DESPAWN_Z = 1.0;
  const HIT_BAND = 2.0;
  const LANES = [-1, 0, 1];

  const OB_BARRIER = { id: "barrier", clear: "jump" };   // red-candle gate
  const OB_BEAM    = { id: "beam",    clear: "roll" };   // FUD overhang
  const OB_PIT     = { id: "pit",     clear: "jump" };   // rugpull hole

  const dom = {
    canvas: document.getElementById("troll-dash-canvas"),
    screen: document.querySelector(".screen-wrap"),
    score: document.getElementById("score-value"),
    coins: document.getElementById("coin-value"),
    high: document.getElementById("high-score-value"),
    startOverlay: document.getElementById("start-overlay"),
    deathOverlay: document.getElementById("death-overlay"),
    deathMessage: document.getElementById("death-message"),
    walletBalance: document.getElementById("wallet-balance"),
    treasuryWallet: document.getElementById("treasury-wallet"),
    reviveButton: document.getElementById("revive-button"),
    restartButton: document.getElementById("restart-button"),
    startButton: document.getElementById("start-button"),
    revivedBanner: document.getElementById("revived-banner"),
    soundToggle: document.getElementById("sound-toggle"),
    coinFinal: document.getElementById("coin-final"),
    scoreFinal: document.getElementById("score-final"),
    payTokenPicker: document.getElementById("pay-token-picker"),
    reviveCost: document.getElementById("revive-cost"),
    reviveStatus: document.getElementById("revive-status"),
    revivePrompt: document.getElementById("revive-prompt"),
    reviveReady: document.getElementById("revive-ready"),
    reviveConfirmButton: document.getElementById("revive-confirm-button"),
    reviveCountdown: document.getElementById("revive-countdown"),
  };

  const ctx = dom.canvas.getContext("2d");
  const playerImage = new Image();
  playerImage.src = "assets/animations/troll_playable_character.PNG";
  // Offscreen canvas with black background removed (built once on load).
  let playerImageClean = null;
  playerImage.onload = () => { playerImageClean = stripBlackBg(playerImage, 40); };

  // Strip pixels below an RGB threshold → alpha = 0, returns an offscreen canvas.
  function stripBlackBg(img, threshold) {
    const oc = document.createElement("canvas");
    oc.width = img.naturalWidth; oc.height = img.naturalHeight;
    const oc2 = oc.getContext("2d");
    oc2.drawImage(img, 0, 0);
    const id = oc2.getImageData(0, 0, oc.width, oc.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < threshold && d[i + 1] < threshold && d[i + 2] < threshold) d[i + 3] = 0;
    }
    oc2.putImageData(id, 0, 0);
    return oc;
  }

  const state = {
    mode: "ready",
    view: { w: 960, h: 540 },
    isPhone: false,
    lastTime: 0,
    elapsed: 0,
    speed: 30,
    distance: 0,
    coins: 0,
    highScore: Number(localStorage.getItem(HIGH_SCORE_KEY) || 0),
    walletBalance: MOCK_WALLET_START_BALANCE,
    revivedThisRun: false,
    invincibleUntil: 0,
    scroll: 0,
    cameraX: 0,
    spawnZCursor: 40,
    coinTimer: 0,
    flash: 0,
    shake: 0,
    hitFlash: 0,
    speedLine: 0,
    obstacles: [],
    coinsArr: [],
    particles: [],
    jumpBuffer: 0,
    player: {
      lane: 0, laneFloat: 0, worldY: 0, vy: 0, onGround: true,
      rollT: 0, runPhase: 0, lean: 0, bank: 0,
    },
  };

  // --- Audio ----------------------------------------------------------
  const audio = {
    enabled: false, context: null,
    beep(f = 520, d = 0.06, type = "square", vol = 0.07) {
      if (!this.enabled) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.context) this.context = new AC();
      const now = this.context.currentTime;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = type; osc.frequency.setValueAtTime(f, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(vol, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + d);
      osc.connect(gain).connect(this.context.destination);
      osc.start(now); osc.stop(now + d + 0.02);
    },
    chord(freqs, d = 0.16, type = "square") { freqs.forEach((f, i) => setTimeout(() => this.beep(f, d, type), i * 55)); },
  };

  // --- Revive payments (real Phantom flow via the shared TrollPay lib) --
  const REVIVE_PRICE_USD = (window.TROLL_PAY_CONFIG && window.TROLL_PAY_CONFIG.REVIVE_PRICE_USD) || 0.69;
  const REVIVE_TAX       = (window.TROLL_PAY_CONFIG && window.TROLL_PAY_CONFIG.TAX_RATE) || 0.069;
  const REVIVE_PENDING_KEY = "troll_dash_revive_pending";
  let revivePhase = "idle";        // idle | paying | ready | countdown
  let reviveCountdownTimer = null;
  let mobileReviveUrl = null;      // pre-built Solana Pay URL (mobile)
  let mobileReviveSig = null;      // treasury sig snapshot at pre-build time
  let mobileConfirmRunning = false;

  const TP = () => window.TrollPay;
  function mobilePay() { return !!(TP() && TP().shouldUseSolanaPay && TP().shouldUseSolanaPay()); }
  function reviveToken()   { return (TP() && TP().getToken()) || "USDC"; }
  function reviveTotalUsd() { return REVIVE_PRICE_USD * (1 + REVIVE_TAX); }
  function reviveCostText() {
    const total = reviveTotalUsd();
    return reviveToken() === "TROLL" ? `$${total.toFixed(2)} in $TROLL` : `${total.toFixed(2)} USDC`;
  }
  function setReviveStatus(msg) { if (dom.reviveStatus) dom.reviveStatus.textContent = msg || ""; }
  function refreshReviveCost()  { if (dom.reviveCost) dom.reviveCost.textContent = reviveCostText(); }
  function friendlyReviveErr(e) {
    const m = (e && e.message) || String(e);
    return "⚠ " + (m.length > 60 ? m.slice(0, 60) : m);
  }

  // Pre-build the Solana Pay URL (price + treasury snapshot) while the death
  // screen is up, so the Revive tap can navigate to Phantom SYNCHRONOUSLY — iOS
  // blocks custom-scheme links fired after an await (the user-gesture is lost).
  async function prepareMobileRevive() {
    if (!mobilePay() || state.mode !== "dead" || state.revivedThisRun) return;
    mobileReviveUrl = null;
    const token = reviveToken();
    // Never disable the button — user must always be able to tap even while fetching.
    if (dom.reviveButton && revivePhase === "idle") { dom.reviveButton.textContent = "Preparing…"; }
    try {
      mobileReviveSig = await TP().latestTreasurySig(token);
      mobileReviveUrl = await TP().solanaPayUrl({
        amountUsd: reviveTotalUsd(), token,
        label: "Troll Dash Revive", message: "Revive in Troll Dash",
      });
    } catch (e) {
      setReviveStatus(friendlyReviveErr(e));
    }
    if (dom.reviveButton && revivePhase === "idle" && state.mode === "dead" && !state.revivedThisRun) {
      dom.reviveButton.textContent = "Revive";
    }
  }

  // --- Math helpers ---------------------------------------------------
  const round1 = v => Math.round(v * 10) / 10;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];

  // Project world (z depth, laneX, worldY height) to screen, with the
  // camera trailing the player laterally (cameraX) for a 3rd-person feel.
  function project(z, laneX, worldY) {
    const { w, h } = state.view;
    const horizonY = h * CAM.horizon;
    const scale = CAM.depth / Math.max(0.35, z);
    const groundY = horizonY + scale * CAM.height * h;
    return {
      x: w / 2 + scale * (laneX - state.cameraX) * (w / 2),
      y: groundY - scale * worldY * h,
      scale,
    };
  }
  const laneToX = lane => lane * LANE_W;

  // --- Resize ---------------------------------------------------------
  function resizeCanvas() {
    const rect = dom.canvas.getBoundingClientRect();
    state.isPhone = Math.min(window.innerWidth, window.innerHeight) < 760 || "ontouchstart" in window;
    const dpr = Math.min(window.devicePixelRatio || 1, state.isPhone ? 2 : 2);
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(180, Math.floor(rect.height));
    dom.canvas.width = Math.floor(width * dpr);
    dom.canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.view.w = width; state.view.h = height;
  }

  // --- HUD ------------------------------------------------------------
  function updateHud() {
    dom.score.textContent = Math.floor(state.distance).toLocaleString();
    dom.coins.textContent = state.coins.toLocaleString();
    dom.high.textContent = Math.floor(state.highScore).toLocaleString();
    if (dom.treasuryWallet) dom.treasuryWallet.textContent = TREASURY_WALLET;
  }

  // --- Run lifecycle --------------------------------------------------
  function resetRun() {
    state.mode = "running";
    state.elapsed = 0; state.speed = 30; state.distance = 0; state.coins = 0;
    state.revivedThisRun = false; state.invincibleUntil = 0;
    state.spawnZCursor = 38; state.coinTimer = 0.6;
    state.flash = 0; state.shake = 0; state.hitFlash = 0; state.cameraX = 0; state.jumpBuffer = 0;
    state.obstacles = []; state.coinsArr = []; state.particles = [];
    Object.assign(state.player, { lane: 0, laneFloat: 0, worldY: 0, vy: 0, onGround: true, rollT: 0, runPhase: 0, lean: 0, bank: 0 });
    hide(dom.startOverlay); hide(dom.deathOverlay);
    updateHud();
  }
  const show = n => n && n.classList.add("is-visible");
  const hide = n => n && n.classList.remove("is-visible");

  function die() {
    if (state.mode !== "running") return;
    if (state.elapsed < state.invincibleUntil) { state.hitFlash = 0.12; return; }
    state.mode = "dead";
    state.shake = 18; state.hitFlash = 0.32;
    state.highScore = Math.max(state.highScore, Math.floor(state.distance));
    localStorage.setItem(HIGH_SCORE_KEY, String(state.highScore));
    if (dom.deathMessage) dom.deathMessage.textContent = pick(DEATH_MESSAGES);
    if (dom.scoreFinal) dom.scoreFinal.textContent = Math.floor(state.distance).toLocaleString();
    if (dom.coinFinal) dom.coinFinal.textContent = state.coins.toLocaleString();
    const p = project(PLAYER_Z, laneToX(state.player.laneFloat), 0.4);
    burst(p.x, p.y, "#ff314f", 34, 240);
    resetReviveUI();
    show(dom.deathOverlay); updateHud();
    audio.beep(120, 0.3, "sawtooth", 0.09);
  }

  // --- Revive flow: pay -> confirm -> "+1 REVIVE" -> 5s countdown -> resume
  function resetReviveUI() {
    revivePhase = "idle";
    mobileConfirmRunning = false;
    if (reviveCountdownTimer) { clearInterval(reviveCountdownTimer); reviveCountdownTimer = null; }
    if (dom.revivePrompt) dom.revivePrompt.hidden = false;
    if (dom.reviveReady) dom.reviveReady.hidden = true;
    if (dom.reviveCountdown) { dom.reviveCountdown.hidden = true; dom.reviveCountdown.textContent = ""; }
    if (dom.reviveConfirmButton) { dom.reviveConfirmButton.hidden = false; dom.reviveConfirmButton.disabled = false; }
    setReviveStatus("");
    refreshReviveCost();
    if (dom.reviveButton) {
      if (state.revivedThisRun) { dom.reviveButton.disabled = true; dom.reviveButton.textContent = "Revive used this run"; }
      else if (mobilePay()) { dom.reviveButton.disabled = false; dom.reviveButton.textContent = "Preparing…"; }
      else { dom.reviveButton.disabled = false; dom.reviveButton.textContent = "Revive"; }
    }
    if (!state.revivedThisRun) prepareMobileRevive();   // mobile: pre-build the Solana Pay URL
  }

  function onReviveButtonClick() {
    // While awaiting mobile confirmation, the button is the manual "I paid" fallback.
    if (revivePhase === "confirming") { manualMobileResume(); return; }
    startRevive();
  }

  async function startRevive() {
    if (state.mode !== "dead" || state.revivedThisRun || revivePhase !== "idle") return;
    if (!TP()) { setReviveStatus("Payments unavailable — reload the page."); return; }
    const token = reviveToken();

    // Mobile (no injected wallet): hand off to Phantom via the PRE-BUILT Solana Pay
    // URL, navigating SYNCHRONOUSLY so iOS keeps the user-gesture (custom-scheme
    // links are silently blocked when fired after an await).
    if (mobilePay()) {
      if (!mobileReviveUrl) {                       // not ready — rebuild, tap again
        setReviveStatus("Preparing payment — tap Revive again in a moment.");
        prepareMobileRevive();
        return;
      }
      revivePhase = "paying";
      sessionStorage.setItem(REVIVE_PENDING_KEY, JSON.stringify({ token, sinceSig: mobileReviveSig, ts: Date.now() }));
      dom.reviveButton.textContent = "Opening Phantom…";
      setReviveStatus("Approve in Phantom, then come back to the game.");
      window.location.href = mobileReviveUrl;       // synchronous — within the tap gesture
      return;
    }

    revivePhase = "paying";
    dom.reviveButton.disabled = true;

    // Desktop / Phantom in-app browser: injected, confirmed payment.
    dom.reviveButton.textContent = "Connect wallet…";
    setReviveStatus("");
    const res = await TP().pay({
      amountUsd: REVIVE_PRICE_USD, taxRate: REVIVE_TAX, token,
      onProgress: (ev) => {
        if (ev.stage === "connecting") dom.reviveButton.textContent = "Connect wallet…";
        else if (ev.stage === "building") dom.reviveButton.textContent = "Building tx…";
        else if (ev.stage === "awaiting") dom.reviveButton.textContent = "Confirm in Phantom…";
        else if (ev.stage === "confirming") dom.reviveButton.textContent = "Confirming…";
      },
    });
    if (!res.ok) {
      revivePhase = "idle";
      dom.reviveButton.disabled = false; dom.reviveButton.textContent = "Revive";
      setReviveStatus("⚠ " + (res.reason || "Payment failed"));
      return;
    }
    onRevivePaid();
  }

  // Mobile: on return from Phantom, confirm the payment landed by polling the
  // treasury. ALWAYS leave a manual "I paid — Resume" path so a player who paid is
  // never stuck (the $TROLL is already in the treasury either way).
  async function checkPendingMobileRevive() {
    const raw = sessionStorage.getItem(REVIVE_PENDING_KEY);
    if (!raw) return;
    if (!TP() || state.mode !== "dead" || state.revivedThisRun) { sessionStorage.removeItem(REVIVE_PENDING_KEY); return; }
    if (revivePhase === "ready" || revivePhase === "countdown" || mobileConfirmRunning) return;
    let pending;
    try { pending = JSON.parse(raw); } catch (e) { sessionStorage.removeItem(REVIVE_PENDING_KEY); return; }
    mobileConfirmRunning = true;
    revivePhase = "confirming";
    // The revive button is now the manual fallback (handled by onReviveButtonClick).
    if (dom.reviveButton) { dom.reviveButton.disabled = false; dom.reviveButton.textContent = "I paid — Resume"; }
    setReviveStatus("Confirming your payment…");
    const result = await TP().waitForNewTreasuryPayment(pending.token, pending.sinceSig, 70000, null);
    mobileConfirmRunning = false;
    if (revivePhase !== "confirming") return;       // user forced it / moved on
    if (result.ok) { sessionStorage.removeItem(REVIVE_PENDING_KEY); onRevivePaid(); return; }
    setReviveStatus("Couldn't auto-confirm. If you completed the payment, tap “I paid — Resume”.");
    if (dom.reviveButton) { dom.reviveButton.disabled = false; dom.reviveButton.textContent = "I paid — Resume"; }
  }

  function manualMobileResume() {
    sessionStorage.removeItem(REVIVE_PENDING_KEY);
    onRevivePaid();
  }

  function onRevivePaid() {
    if (revivePhase === "ready" || revivePhase === "countdown") return;
    revivePhase = "ready";
    if (dom.revivePrompt) dom.revivePrompt.hidden = true;
    if (dom.reviveReady) dom.reviveReady.hidden = false;
    if (dom.reviveConfirmButton) { dom.reviveConfirmButton.hidden = false; dom.reviveConfirmButton.disabled = false; }
    if (dom.reviveCountdown) dom.reviveCountdown.hidden = true;
    audio.chord([660, 880, 1180], 0.12);
  }

  function confirmReviveResume() {
    if (revivePhase !== "ready") return;
    revivePhase = "countdown";
    if (dom.reviveConfirmButton) dom.reviveConfirmButton.hidden = true;
    let n = 5;
    if (dom.reviveCountdown) { dom.reviveCountdown.hidden = false; dom.reviveCountdown.textContent = String(n); }
    audio.beep(880, 0.08);
    reviveCountdownTimer = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(reviveCountdownTimer); reviveCountdownTimer = null;
        doResume();
      } else {
        if (dom.reviveCountdown) dom.reviveCountdown.textContent = String(n);
        audio.beep(880, 0.08);
      }
    }, 1000);
  }

  function doResume() {
    revivePhase = "idle";
    state.revivedThisRun = true; state.mode = "running";
    state.invincibleUntil = state.elapsed + 2.6; state.flash = 0.6;
    state.obstacles = state.obstacles.filter(o => o.z > PLAYER_Z + HIT_BAND + 6);
    Object.assign(state.player, { worldY: 0, vy: 0, onGround: true, rollT: 0 });
    hide(dom.deathOverlay);
    if (dom.reviveReady) dom.reviveReady.hidden = true;
    if (dom.revivedBanner) {
      dom.revivedBanner.textContent = reviveToken() === "TROLL" ? "REVIVED BY $TROLL" : "REVIVED BY USDC";
      dom.revivedBanner.classList.remove("is-visible");
      void dom.revivedBanner.offsetWidth;
      dom.revivedBanner.classList.add("is-visible");
    }
    const p = project(PLAYER_Z, laneToX(state.player.laneFloat), 0.4);
    burst(p.x, p.y, "#4dff73", 46, 260);
    audio.chord([660, 880, 1180], 0.12);
    updateHud();
  }

  // --- Actions --------------------------------------------------------
  function moveLane(dir) {
    if (state.mode !== "running") return;
    const next = clamp(state.player.lane + dir, -1, 1);
    if (next !== state.player.lane) {
      state.player.lane = next;
      state.player.bank = clamp(state.player.bank + dir * 0.9, -1, 1);
      audio.beep(420 + next * 70, 0.04, "square", 0.05);
    }
  }
  function jump() {
    if (state.mode !== "running") { state.jumpBuffer = 0; return; }
    if (state.player.onGround) {
      state.player.vy = 3.05; state.player.onGround = false; state.player.rollT = 0;
      audio.beep(560, 0.08, "square", 0.06); dust();
    } else {
      state.jumpBuffer = 0.16;  // buffer: fire the instant we land
    }
  }
  function roll() {
    if (state.mode !== "running") return;
    if (!state.player.onGround) state.player.vy = Math.min(state.player.vy, -3.4); // slam down
    state.player.rollT = 0.6;
    audio.beep(240, 0.07, "sawtooth", 0.05);
  }

  // --- Update ---------------------------------------------------------
  function update(dt) {
    const p = state.player;
    p.runPhase += dt * (state.mode === "running" ? 16 : 4);
    p.lean = lerp(p.lean, p.bank * 0.6, Math.min(1, dt * 9));
    p.bank = lerp(p.bank, 0, Math.min(1, dt * 5));
    state.flash = Math.max(0, state.flash - dt);
    state.hitFlash = Math.max(0, state.hitFlash - dt * 3);
    state.shake = Math.max(0, state.shake - dt * 40);

    // camera trails the player laterally
    state.cameraX = lerp(state.cameraX, laneToX(p.laneFloat) * CAM_FOLLOW, Math.min(1, dt * 7));

    if (state.mode !== "running") { state.scroll += dt * 7; stepParticles(dt); return; }

    state.elapsed += dt;
    state.speed = Math.min(72, 30 + state.elapsed * 1.5);
    state.distance += state.speed * dt * 0.6;
    state.scroll += dt * state.speed;
    state.speedLine = clamp((state.speed - 46) / 26, 0, 1);

    // lane + vertical physics
    p.laneFloat = lerp(p.laneFloat, p.lane, Math.min(1, dt * 14));
    if (!p.onGround) {
      p.vy -= 9.6 * dt; p.worldY += p.vy * dt;
      if (p.worldY <= 0) {
        p.worldY = 0; p.vy = 0; p.onGround = true; dust();
        if (state.jumpBuffer > 0) { state.jumpBuffer = 0; jump(); }
      }
    }
    p.rollT = Math.max(0, p.rollT - dt);
    state.jumpBuffer = Math.max(0, state.jumpBuffer - dt);

    const travel = state.speed * dt;
    for (const o of state.obstacles) o.z -= travel;
    for (const c of state.coinsArr) c.z -= travel;
    state.obstacles = state.obstacles.filter(o => o.z > DESPAWN_Z);
    state.coinsArr = state.coinsArr.filter(c => c.z > DESPAWN_Z && !c.got);

    state.spawnZCursor -= travel;
    if (state.spawnZCursor <= SPAWN_Z) {
      spawnObstacleRow();
      state.spawnZCursor = SPAWN_Z + clamp(rand(22, 32) - state.elapsed * 0.2, 12, 32);
    }
    state.coinTimer -= dt;
    if (state.coinTimer <= 0) { spawnCoinRun(); state.coinTimer = rand(0.9, 1.7); }

    stepParticles(dt);
    checkCollisions();
    updateHud();
  }

  function stepParticles(dt) {
    for (const pt of state.particles) {
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += (pt.grav ?? 320) * dt;
      pt.life -= dt; pt.size *= 0.98;
    }
    state.particles = state.particles.filter(pt => pt.life > 0);
  }

  function spawnObstacleRow() {
    const kind = pick([OB_BARRIER, OB_BEAM, OB_PIT, OB_BARRIER, OB_BEAM]);
    const blockCount = Math.random() < 0.36 && state.elapsed > 12 ? 2 : 1;
    const lanesCopy = [...LANES]; const blocked = [];
    for (let i = 0; i < blockCount; i++) blocked.push(lanesCopy.splice((Math.random() * lanesCopy.length) | 0, 1)[0]);
    for (const lane of blocked) state.obstacles.push({ kind, lane, z: SPAWN_Z, cleared: false });
  }
  function spawnCoinRun() {
    const lane = pick(LANES);
    const count = 4 + ((Math.random() * 4) | 0);
    const arc = Math.random() < 0.4;
    for (let i = 0; i < count; i++) {
      state.coinsArr.push({
        lane, z: SPAWN_Z + i * 3.0,
        worldY: arc ? Math.sin((i / (count - 1)) * Math.PI) * 0.72 : 0.16,
        got: false, spin: rand(0, 6.28),
      });
    }
  }

  function checkCollisions() {
    const p = state.player; const pLane = p.laneFloat;
    const rolling = p.rollT > 0;
    for (const c of state.coinsArr) {
      if (c.got) continue;
      if (c.z < PLAYER_Z + 1.7 && c.z > PLAYER_Z - 1.3 && Math.abs(c.lane - pLane) < 0.5) {
        if (Math.abs(c.worldY - (p.worldY + 0.4)) < 0.62) {
          c.got = true; state.coins += 1; state.distance += 6;
          const sp = project(c.z, laneToX(c.lane), c.worldY + 0.4);
          burst(sp.x, sp.y, "#ffd84d", 8, 130);
          audio.beep(900 + (state.coins % 6) * 40, 0.05, "triangle", 0.045);
        }
      }
    }
    for (const o of state.obstacles) {
      if (o.z > PLAYER_Z + HIT_BAND || o.z < PLAYER_Z - HIT_BAND) continue;
      if (Math.abs(o.lane - pLane) > 0.5) continue;
      let safe = false;
      if (o.kind.clear === "jump") safe = p.worldY > (o.kind === OB_PIT ? 0.18 : 0.34);
      else if (o.kind.clear === "roll") safe = rolling && p.onGround;
      if (!safe) { die(); return; }
      if (!o.cleared) {
        o.cleared = true; state.distance += 12;
        const sp = project(o.z, laneToX(o.lane), 0.5);
        burst(sp.x, sp.y, "#4deeff", 9, 150);
      }
    }
  }

  // --- Render ---------------------------------------------------------
  function render() {
    const { w, h } = state.view;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (state.shake > 0) ctx.translate(rand(-state.shake, state.shake), rand(-state.shake, state.shake));

    drawSky(w, h);
    drawFloor(w, h);
    drawPillars(w, h);

    const items = [];
    for (const o of state.obstacles) items.push({ z: o.z, t: "ob", ref: o });
    for (const c of state.coinsArr) if (!c.got) items.push({ z: c.z, t: "coin", ref: c });
    items.push({ z: PLAYER_Z, t: "player", ref: null });
    items.sort((a, b) => b.z - a.z);
    for (const it of items) {
      if (it.t === "ob") drawObstacle(it.ref);
      else if (it.t === "coin") drawCoin(it.ref);
      else drawPlayer();
    }

    drawParticles();
    if (state.speedLine > 0) drawSpeedLines(w, h);
    drawAtmosphere(w, h);
    ctx.restore();
  }

  function drawSky(w, h) {
    const horizonY = h * CAM.horizon;
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY + 50);
    sky.addColorStop(0, "#05161f");
    sky.addColorStop(0.5, "#0a2730");
    sky.addColorStop(1, "#15463f");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, horizonY + 70);

    // parallax temple ridge (shifts opposite the camera)
    const par = -state.cameraX * w * 0.16;
    ctx.fillStyle = "rgba(4,16,16,0.7)";
    const ridgeY = horizonY + 3, seg = w / 9;
    ctx.beginPath(); ctx.moveTo(-seg, ridgeY);
    for (let i = -1; i <= 10; i++) {
      const x = i * seg + par;
      ctx.lineTo(x, ridgeY - (28 + (Math.sin(i * 2.1) * 0.5 + 0.5) * h * 0.13));
      ctx.lineTo(x + seg / 2, ridgeY - (14 + (Math.cos(i * 1.3) * 0.5 + 0.5) * h * 0.06));
    }
    ctx.lineTo(w + seg, ridgeY); ctx.closePath(); ctx.fill();

    // cursed green sun glow at vanishing point
    const cx = w / 2 - state.cameraX * (CAM.depth / SPAWN_Z) * (w / 2);
    const glow = ctx.createRadialGradient(cx, horizonY, 6, cx, horizonY, h * 0.55);
    glow.addColorStop(0, "rgba(77,255,115,0.46)");
    glow.addColorStop(0.4, "rgba(77,255,115,0.12)");
    glow.addColorStop(1, "rgba(77,255,115,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, horizonY + h * 0.32);

    // chart-bar skyline
    ctx.fillStyle = "rgba(3,11,12,0.9)";
    const barW = w / 30;
    for (let i = -1; i <= 30; i++) {
      const x = i * barW + par * 1.6;
      ctx.fillRect(x, ridgeY - (6 + (Math.sin(i * 1.7) * 0.5 + 0.5) * h * 0.08), barW - 2, h * 0.1);
    }
    ctx.fillStyle = "#060f0d"; ctx.fillRect(0, horizonY, w, h - horizonY);
  }

  // Checkerboard stone path projected in perspective — sells motion + depth.
  function drawFloor(w, h) {
    const nearZ = 1.2, farZ = SPAWN_Z * 0.62;
    const tile = 2.2;                       // world depth per tile band
    const startZ = nearZ + (state.scroll % (tile * 2));
    for (let z = farZ; z > startZ - tile; z -= tile) {
      const z2 = z + tile;
      const band = Math.floor((z + state.scroll) / tile);
      const fog = clamp(1 - z / farZ, 0, 1);     // near = 1, far = 0
      // tiles across the road
      const cols = 6;
      for (let c = 0; c < cols; c++) {
        const x1 = -ROAD_HALF + (c / cols) * ROAD_HALF * 2;
        const x2 = -ROAD_HALF + ((c + 1) / cols) * ROAD_HALF * 2;
        const a = project(z, x1, 0), b = project(z, x2, 0);
        const d = project(z2, x1, 0), e = project(z2, x2, 0);
        const dark = (band + c) % 2 === 0;
        const base = dark ? 22 : 33;
        const r = Math.round(base * (0.4 + fog * 0.6));
        ctx.fillStyle = `rgb(${r},${r + 10},${r + 6})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(e.x, e.y); ctx.lineTo(d.x, d.y);
        ctx.closePath(); ctx.fill();
      }
    }
    // glowing edges + lane seams
    for (const sgn of [-1, 1]) {
      const f = project(farZ, sgn * ROAD_HALF, 0), n = project(nearZ, sgn * ROAD_HALF, 0);
      ctx.strokeStyle = "rgba(77,255,115,0.5)"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(n.x, n.y); ctx.stroke();
    }
    for (const lx of [-LANE_W / 2, LANE_W / 2]) {
      const f = project(farZ, lx, 0), n = project(nearZ, lx, 0);
      ctx.strokeStyle = "rgba(150,210,255,0.12)"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(n.x, n.y); ctx.stroke();
    }
    // distance fog over the far floor
    const horizonY = h * CAM.horizon;
    const fg = ctx.createLinearGradient(0, horizonY, 0, horizonY + h * 0.22);
    fg.addColorStop(0, "rgba(13,40,38,0.85)");
    fg.addColorStop(1, "rgba(13,40,38,0)");
    ctx.fillStyle = fg; ctx.fillRect(0, horizonY, w, h * 0.24);
  }

  function drawPillars(w) {
    const spacing = 8;
    const startZ = 2 + (state.scroll % spacing);
    const list = [];
    for (let z = startZ; z < SPAWN_Z * 0.7; z += spacing) list.push(z);
    list.sort((a, b) => b - a);
    for (const z of list) { drawPillar(-WALL_X, z); drawPillar(WALL_X, z); }
  }
  function drawPillar(laneX, z) {
    const base = project(z, laneX, 0), top = project(z, laneX, 2.5);
    if (base.scale < 0.01) return;
    const wpx = clamp(base.scale * (state.view.w * 0.38), 1, 90);
    const g = ctx.createLinearGradient(base.x - wpx / 2, 0, base.x + wpx / 2, 0);
    g.addColorStop(0, "#0a1714"); g.addColorStop(0.5, "#284b40"); g.addColorStop(1, "#0a1714");
    ctx.fillStyle = g; ctx.fillRect(base.x - wpx / 2, top.y, wpx, base.y - top.y);
    ctx.fillStyle = "#31564a";
    ctx.fillRect(base.x - wpx * 0.62, top.y - wpx * 0.16, wpx * 1.24, wpx * 0.28);
    ctx.fillRect(base.x - wpx * 0.6, base.y - wpx * 0.1, wpx * 1.2, wpx * 0.18);
    if (Math.floor(z / 8) % 2 === 0) {
      const flick = 0.6 + Math.sin(state.elapsed * 12 + z) * 0.2 + Math.random() * 0.08;
      const ty = lerp(top.y, base.y, 0.3), r = wpx * 1.7;
      const tg = ctx.createRadialGradient(base.x, ty, 1, base.x, ty, r);
      tg.addColorStop(0, `rgba(140,255,170,${0.5 * flick})`);
      tg.addColorStop(0.5, `rgba(77,255,115,${0.16 * flick})`);
      tg.addColorStop(1, "rgba(77,255,115,0)");
      ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(base.x, ty, r, 0, 6.2832); ctx.fill();
    }
  }

  function drawCoin(c) {
    const p = project(c.z, laneToX(c.lane), c.worldY + 0.4);
    if (p.scale < 0.01) return;
    const r = clamp(p.scale * 95, 3, 28);
    const squish = Math.abs(Math.cos(state.elapsed * 5 + c.spin));
    const rx = Math.max(2, r * (0.34 + squish * 0.66));   // horizontal radius (spin)
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.shadowBlur = 16; ctx.shadowColor = "#ffd84d"; ctx.fillStyle = "#ffd84d";
    ctx.beginPath(); ctx.ellipse(0, 0, rx, r, 0, 0, 6.2832); ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = Math.max(1, r * 0.14); ctx.strokeStyle = "#b6831a"; ctx.stroke();
    // Stamp the trollface on the coin face, squished with the spin so it reads
    // like a minted 3D coin. Falls back to nothing until the image loads.
    if (r > 6 && TROLL_COIN_IMG.complete && TROLL_COIN_IMG.naturalWidth) {
      ctx.save();
      ctx.beginPath(); ctx.ellipse(0, 0, rx * 0.84, r * 0.84, 0, 0, 6.2832); ctx.clip();
      ctx.drawImage(TROLL_COIN_IMG, -rx * 0.92, -r * 0.92, rx * 1.84, r * 1.84);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawObstacle(o) {
    const laneX = laneToX(o.lane);
    if (o.kind === OB_PIT) return drawPit(o, laneX);
    const p = project(o.z, laneX, 0);
    if (p.scale < 0.01) return;
    const halfW = LANE_W * 0.46;
    const lEdge = project(o.z, laneX - halfW, 0), rEdge = project(o.z, laneX + halfW, 0);
    const wpx = Math.max(4, rEdge.x - lEdge.x);
    const cx = (lEdge.x + rEdge.x) / 2;

    if (o.kind === OB_BARRIER) {
      const topB = project(o.z, laneX, 0.64); const hgt = p.y - topB.y;
      ctx.save();
      ctx.shadowBlur = clamp(p.scale * 120, 2, 22); ctx.shadowColor = "#ff314f";
      const g = ctx.createLinearGradient(0, topB.y, 0, p.y);
      g.addColorStop(0, "#ff5c73"); g.addColorStop(1, "#b3092a");
      ctx.fillStyle = g; ctx.fillRect(cx - wpx / 2, topB.y, wpx, hgt);
      ctx.shadowBlur = 0; ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(cx - wpx / 2, topB.y + hgt * 0.34, wpx, hgt * 0.16);
      ctx.strokeStyle = "#ffd0d8"; ctx.lineWidth = Math.max(1, wpx * 0.05);
      const wick = project(o.z, laneX, 0.9);
      ctx.beginPath(); ctx.moveTo(cx, topB.y); ctx.lineTo(wick.x, wick.y); ctx.stroke();
      if (wpx > 30) label(cx, topB.y - 7, "JUMP", "#ffd0d8", wpx);
      ctx.restore();
    } else { // beam (roll under)
      const lo = project(o.z, laneX, 0.66), hi = project(o.z, laneX, 1.2);
      ctx.save();
      ctx.shadowBlur = clamp(p.scale * 110, 2, 20); ctx.shadowColor = "#4deeff";
      ctx.fillStyle = "#0e3a44"; ctx.fillRect(cx - wpx / 2, hi.y, wpx, lo.y - hi.y);
      ctx.strokeStyle = "#4deeff"; ctx.lineWidth = Math.max(1, wpx * 0.04);
      ctx.strokeRect(cx - wpx / 2, hi.y, wpx, lo.y - hi.y);
      ctx.shadowBlur = 0;
      if (wpx > 34) {
        ctx.fillStyle = "#bff4ff"; ctx.font = `900 ${clamp(wpx * 0.26, 8, 26)}px 'DM Mono', monospace`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("FUD", cx, (hi.y + lo.y) / 2);
      }
      ctx.fillStyle = "#0e3a44";
      ctx.fillRect(cx - wpx / 2, hi.y, Math.max(2, wpx * 0.08), p.y - hi.y);
      ctx.fillRect(cx + wpx / 2 - Math.max(2, wpx * 0.08), hi.y, Math.max(2, wpx * 0.08), p.y - hi.y);
      ctx.restore();
    }
  }
  function drawPit(o, laneX) {
    const half = LANE_W * 0.5;
    const nearZ = o.z - 1.5, farZ = o.z + 1.5;
    const fl = project(farZ, laneX - half, 0), fr = project(farZ, laneX + half, 0);
    const nl = project(nearZ, laneX - half, 0), nr = project(nearZ, laneX + half, 0);
    if (nl.scale < 0.01) return;
    ctx.save(); ctx.fillStyle = "#01060a";
    ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(fr.x, fr.y); ctx.lineTo(nr.x, nr.y); ctx.lineTo(nl.x, nl.y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(154,92,255,0.7)"; ctx.lineWidth = clamp(nl.scale * 40, 1, 3); ctx.stroke();
    const cx = (nl.x + nr.x) / 2, cy = (nl.y + fl.y) / 2;
    if (nr.x - nl.x > 36) label(cx, cy, "RUG", "#c9a8ff", nr.x - nl.x);
    ctx.restore();
  }
  function label(x, y, text, color, wpx) {
    ctx.fillStyle = color; ctx.font = `900 ${clamp(wpx * 0.2, 8, 18)}px 'DM Mono', monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, x, y);
  }

  function drawPlayer() {
    const p = state.player;
    const laneX = laneToX(p.laneFloat);
    const base = project(PLAYER_Z, laneX, 0);
    const rolling = p.rollT > 0 && p.onGround;
    const bob = p.onGround && !rolling ? Math.abs(Math.sin(p.runPhase)) * 6 : 0;
    const liftPx = base.y - project(PLAYER_Z, laneX, p.worldY).y;

    // contact shadow shrinks/fades with jump height
    const shW = base.scale * state.view.w * 0.34;
    const shrink = clamp(1 - p.worldY * 0.7, 0.32, 1);
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.42 * shrink})`;
    ctx.beginPath(); ctx.ellipse(base.x, base.y - 4, shW * shrink, shW * 0.26 * shrink, 0, 0, 6.2832); ctx.fill();
    ctx.restore();

    const drawSrc = playerImageClean || (playerImage.complete && playerImage.naturalWidth ? playerImage : null);
    if (!drawSrc) {
      ctx.fillStyle = "#4dff73"; ctx.beginPath(); ctx.arc(base.x, base.y - 40, 26, 0, 6.2832); ctx.fill(); return;
    }

    const aspect = playerImage.naturalWidth / playerImage.naturalHeight;
    let drawH = base.scale * state.view.h * 0.78;
    let drawW = drawH * aspect;
    const maxW = state.view.w * 0.46;
    if (drawW > maxW) { drawW = maxW; drawH = drawW / aspect; }

    // squash/stretch on jump; barrel-roll spin when rolling
    let sx = 1, sy = 1, rollAngle = 0;
    if (!p.onGround) { sy = 1 + clamp(p.vy * 0.04, -0.12, 0.14); sx = 2 - sy; }
    if (rolling) { rollAngle = p.rollT * Math.PI * 4; sx = 1; sy = 1; }

    const invincible = state.elapsed < state.invincibleUntil;
    ctx.save();
    ctx.translate(base.x, base.y - bob - liftPx);
    ctx.rotate(rolling ? rollAngle : p.lean * 0.16);
    ctx.scale(sx, sy);
    if (rolling) ctx.translate(0, drawH * 0.32);
    if (invincible && Math.floor(state.elapsed * 14) % 2 === 0) ctx.globalAlpha = 0.5;
    // glow drawn separately so it doesn't need canvas shadow on the image rect
    if (invincible) {
      ctx.shadowBlur = 28; ctx.shadowColor = "#4dff73";
      ctx.fillStyle = "rgba(0,0,0,0)"; ctx.fillRect(-drawW / 2, -drawH, drawW, drawH);
      ctx.shadowBlur = 0;
    }
    ctx.drawImage(drawSrc, -drawW / 2, -drawH, drawW, drawH);
    ctx.restore();
  }

  function drawParticles() {
    for (const pt of state.particles) {
      ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawSpeedLines(w, h) {
    ctx.save();
    ctx.globalAlpha = state.speedLine * 0.5;
    ctx.strokeStyle = "rgba(200,240,255,0.5)"; ctx.lineWidth = 2;
    const cx = w / 2, cy = h * CAM.horizon;
    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * 6.2832 + state.elapsed;
      const r1 = h * 0.32, r2 = h * (0.5 + (Math.sin(state.elapsed * 20 + i) * 0.5 + 0.5) * 0.3);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAtmosphere(w, h) {
    const v = ctx.createRadialGradient(w / 2, h * 0.54, h * 0.2, w / 2, h * 0.54, h * 0.82);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.52)");
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    if (state.flash > 0) { ctx.fillStyle = `rgba(77,255,115,${Math.min(0.2, state.flash * 0.32)})`; ctx.fillRect(0, 0, w, h); }
    if (state.hitFlash > 0) { ctx.fillStyle = `rgba(255,49,79,${Math.min(0.34, state.hitFlash)})`; ctx.fillRect(0, 0, w, h); }
  }

  function burst(x, y, color, count, spread) {
    for (let i = 0; i < count; i++) state.particles.push({
      x, y, vx: rand(-spread, spread), vy: rand(-spread, spread * 0.4),
      size: rand(2, 6), life: rand(0.3, 0.7), maxLife: 0.7, color,
    });
  }
  function dust() {
    const p = project(PLAYER_Z, laneToX(state.player.laneFloat), 0);
    for (let i = 0; i < 9; i++) state.particles.push({
      x: p.x + rand(-22, 22), y: p.y - 2, vx: rand(-80, 80), vy: rand(-130, -30),
      size: rand(2, 5), life: rand(0.2, 0.45), maxLife: 0.45, grav: 360, color: "rgba(180,210,200,0.7)",
    });
  }

  // --- Input: keyboard + Subway-Surfers swipe ------------------------
  function handleKeydown(e) {
    const k = e.key.toLowerCase();
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", " ", "a", "d", "w", "s"].includes(k)) e.preventDefault();
    if (k === "a" || k === "arrowleft") moveLane(-1);
    else if (k === "d" || k === "arrowright") moveLane(1);
    else if (k === "w" || k === "arrowup" || k === " ") jump();
    else if (k === "s" || k === "arrowdown") roll();
  }

  // Fires the action mid-gesture the instant a flick crosses threshold,
  // then re-arms so a continuous drag can chain a second swipe (SS feel).
  function bindSwipe() {
    const surface = dom.screen || dom.canvas;
    let active = false, ox = 0, oy = 0, lastFire = 0, moved = false;
    const THRESH = 22, COOLDOWN = 110;

    const down = e => {
      if (state.mode !== "running") return;   // let overlay buttons get touches
      active = true; moved = false;
      ox = e.clientX; oy = e.clientY;
      try { surface.setPointerCapture(e.pointerId); } catch (_) {}
      if (e.pointerType !== "mouse") e.preventDefault();
    };
    const move = e => {
      if (!active) return;
      const dx = e.clientX - ox, dy = e.clientY - oy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < THRESH) return;
      const now = performance.now();
      if (now - lastFire < COOLDOWN) return;
      if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
      else if (dy < 0) jump(); else roll();
      lastFire = now; ox = e.clientX; oy = e.clientY;   // re-arm from here
      if (e.pointerType !== "mouse") e.preventDefault();
    };
    const up = e => {
      if (active && !moved && state.mode === "running") jump(); // tap = hop
      active = false;
    };
    surface.addEventListener("pointerdown", down, { passive: false });
    surface.addEventListener("pointermove", move, { passive: false });
    surface.addEventListener("pointerup", up);
    surface.addEventListener("pointercancel", () => { active = false; });
    surface.addEventListener("contextmenu", e => e.preventDefault());
  }

  function loop(time) {
    if (!state.lastTime) state.lastTime = time;
    const dt = Math.min(0.033, (time - state.lastTime) / 1000);
    state.lastTime = time;
    update(dt); render();
    requestAnimationFrame(loop);
  }

  function init() {
    resizeCanvas();
    updateHud();
    bindSwipe();
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("keydown", handleKeydown);
    dom.startButton && dom.startButton.addEventListener("click", resetRun);
    dom.restartButton && dom.restartButton.addEventListener("click", resetRun);
    dom.reviveButton && dom.reviveButton.addEventListener("click", onReviveButtonClick);
    dom.reviveConfirmButton && dom.reviveConfirmButton.addEventListener("click", confirmReviveResume);
    if (TP()) {
      TP().setToken("TROLL");   // games default to $TROLL (falls back to USDC if unavailable)
      if (dom.payTokenPicker) TP().mountTokenPicker(dom.payTokenPicker, () => { refreshReviveCost(); prepareMobileRevive(); });
    }
    refreshReviveCost();
    // Confirm the mobile payment on return from Phantom — bind several events since
    // mobile browsers are inconsistent about which fires (and bfcache restores).
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkPendingMobileRevive(); });
    window.addEventListener("pageshow", () => { checkPendingMobileRevive(); });
    window.addEventListener("focus", () => { checkPendingMobileRevive(); });
    dom.soundToggle && dom.soundToggle.addEventListener("click", () => {
      audio.enabled = !audio.enabled;
      dom.soundToggle.setAttribute("aria-pressed", String(audio.enabled));
      dom.soundToggle.classList.toggle("is-on", audio.enabled);
      if (audio.enabled) audio.beep(680, 0.06);
    });
    document.documentElement.dataset.trollDashReady = "true";
    if (/(?:^|[#&])autostart/.test(window.location.hash)) {
      const begin = () => resetRun();
      if (playerImage.complete) begin(); else playerImage.addEventListener("load", begin, { once: true });
    }
    requestAnimationFrame(loop);
  }

  init();
})();
