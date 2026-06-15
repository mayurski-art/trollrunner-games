(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Troll Dash: Rugpull Run
   * A pseudo-3D endless runner. The troll runs in place facing the
   * camera while the cursed temple-chart rushes toward it. Lane swap,
   * jump, and slide to survive. Pay the troll toll to revive.
   * ------------------------------------------------------------------ */

  // --- Economy / persistence -----------------------------------------
  const REVIVE_COST = 6.9;
  const TREASURY_WALLET = "79vVRZ7qnZfj9xCto5d9Kwf4eAimqMDrQysZjHBbFbsA";
  const TROLL_MINT_ADDRESS = "REPLACE_WITH_VERIFIED_TROLL_SPL_MINT_ADDRESS";
  const HIGH_SCORE_KEY = "troll_dash_high_score_v2";
  const MOCK_WALLET_START_BALANCE = 42;

  const DEATH_MESSAGES = [
    "RUGGED", "LIQUIDATED", "REKT", "PAPER HANDS",
    "SUPPORT BROKE", "GG NO RE",
  ];

  // --- Pseudo-3D camera ----------------------------------------------
  // World units: z = depth ahead of camera (>0). laneX = lateral offset.
  // worldY = height above the road (0 = on the road).
  const CAM = { depth: 1.56, height: 1.0, horizon: 0.34 };
  const LANE_W = 0.8;          // world distance between lanes
  const ROAD_HALF = 1.34;      // road edge (world units from center)
  const WALL_X = 1.78;         // pillar lateral offset
  const PLAYER_Z = 3.0;        // depth the troll sits at
  const SPAWN_Z = 150;         // depth where obstacles appear
  const DESPAWN_Z = 1.2;       // depth where things leave the screen
  const HIT_BAND = 2.1;        // collision depth half-window around player

  const LANES = [-1, 0, 1];

  // --- Obstacle kinds -------------------------------------------------
  // clear: how the player avoids it. lanes spawn pattern handled below.
  const OB_BARRIER = { id: "barrier", clear: "jump" };   // red candle gate
  const OB_BEAM    = { id: "beam",    clear: "slide" };  // FUD overhang
  const OB_PIT     = { id: "pit",     clear: "jump" };   // rugpull hole

  const dom = {
    canvas: document.getElementById("troll-dash-canvas"),
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
  };

  const ctx = dom.canvas.getContext("2d");
  const playerImage = new Image();
  playerImage.src = "assets/games/troll-dash/sprites/troll-runner.png?v=2";

  const state = {
    mode: "ready",                 // ready | running | dead
    view: { w: 960, h: 540 },
    lastTime: 0,
    elapsed: 0,
    speed: 26,                     // world-z units per second
    distance: 0,
    coins: 0,
    highScore: Number(localStorage.getItem(HIGH_SCORE_KEY) || 0),
    walletBalance: MOCK_WALLET_START_BALANCE,
    revivedThisRun: false,
    invincibleUntil: 0,
    scroll: 0,                     // texture scroll for road/pillars
    spawnZCursor: SPAWN_Z,         // next obstacle spawn distance
    coinTimer: 0,
    flash: 0,
    shake: 0,
    hitFlash: 0,
    obstacles: [],
    coinsArr: [],
    particles: [],
    player: {
      lane: 0,
      laneFloat: 0,
      worldY: 0,
      vy: 0,
      onGround: true,
      slideT: 0,
      runPhase: 0,
      lean: 0,
    },
  };

  // --- Audio (synth bleeps; swap for files later) --------------------
  const audio = {
    enabled: false,
    context: null,
    beep(frequency = 520, duration = 0.06, type = "square", vol = 0.07) {
      if (!this.enabled) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.context) this.context = new AC();
      const now = this.context.currentTime;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(vol, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain).connect(this.context.destination);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    },
    chord(freqs, duration = 0.16, type = "square") {
      freqs.forEach((f, i) => setTimeout(() => this.beep(f, duration, type), i * 55));
    },
  };

  // --- Mock revive payment (Solana integration stub) -----------------
  class MockRevivePaymentProvider {
    constructor(gs) { this.gs = gs; this.mode = "mock"; }
    createReviveSession() {
      return {
        id: window.crypto?.randomUUID ? crypto.randomUUID() : `mock-${Date.now()}`,
        cost: REVIVE_COST, treasuryWallet: TREASURY_WALLET, mint: TROLL_MINT_ADDRESS,
        memo: `troll-dash-revive-${Date.now()}`,
      };
    }
    async payForRevive() {
      const session = this.createReviveSession();
      if (this.gs.walletBalance < REVIVE_COST) return { ok: false, reason: "Not enough $TROLL", session };
      this.gs.walletBalance = round1(this.gs.walletBalance - REVIVE_COST);
      return { ok: true, signature: `mock-${session.id}`, session };
    }
  }
  // Real flow stays disabled until a backend verifies destination, mint,
  // amount, memo/reference and one-time tx usage. See README.
  class FutureSolanaPaymentProvider {
    async payForRevive() { throw new Error("Real Solana payment disabled until backend verification exists."); }
  }
  const revivePayments = new MockRevivePaymentProvider(state);
  void FutureSolanaPaymentProvider;

  // --- Math helpers ---------------------------------------------------
  const round1 = v => Math.round(v * 10) / 10;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];

  // Project a world point to screen. Returns {x, y, scale}.
  function project(z, laneX, worldY) {
    const { w, h } = state.view;
    const horizonY = h * CAM.horizon;
    const scale = CAM.depth / Math.max(0.35, z);
    const groundY = horizonY + scale * CAM.height * h;
    return {
      x: w / 2 + scale * laneX * (w / 2),
      y: groundY - scale * worldY * h,
      scale,
    };
  }

  function laneToX(lane) { return lane * LANE_W; }

  // --- Resize ---------------------------------------------------------
  function resizeCanvas() {
    const rect = dom.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(180, Math.floor(rect.height));
    dom.canvas.width = Math.floor(width * dpr);
    dom.canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.view.w = width;
    state.view.h = height;
  }

  // --- HUD ------------------------------------------------------------
  function updateHud() {
    dom.score.textContent = Math.floor(state.distance).toLocaleString();
    dom.coins.textContent = state.coins.toLocaleString();
    dom.high.textContent = Math.floor(state.highScore).toLocaleString();
    if (dom.walletBalance) dom.walletBalance.textContent = `${state.walletBalance.toFixed(1)} $TROLL`;
    if (dom.treasuryWallet) dom.treasuryWallet.textContent = TREASURY_WALLET;
    if (dom.reviveButton) {
      dom.reviveButton.disabled = state.revivedThisRun || state.walletBalance < REVIVE_COST;
      dom.reviveButton.textContent = state.revivedThisRun ? "Revive used" : "Revive · 6.9 $TROLL";
    }
  }

  // --- Run lifecycle --------------------------------------------------
  function resetRun() {
    state.mode = "running";
    state.elapsed = 0;
    state.speed = 26;
    state.distance = 0;
    state.coins = 0;
    state.revivedThisRun = false;
    state.invincibleUntil = 0;
    state.spawnZCursor = 40;
    state.coinTimer = 0.6;
    state.flash = 0;
    state.shake = 0;
    state.hitFlash = 0;
    state.obstacles = [];
    state.coinsArr = [];
    state.particles = [];
    Object.assign(state.player, {
      lane: 0, laneFloat: 0, worldY: 0, vy: 0, onGround: true,
      slideT: 0, runPhase: 0, lean: 0,
    });
    hide(dom.startOverlay);
    hide(dom.deathOverlay);
    updateHud();
  }

  const show = n => n && n.classList.add("is-visible");
  const hide = n => n && n.classList.remove("is-visible");

  function die() {
    if (state.mode !== "running") return;
    if (state.elapsed < state.invincibleUntil) { state.hitFlash = 0.12; return; }
    state.mode = "dead";
    state.shake = 16;
    state.hitFlash = 0.3;
    state.highScore = Math.max(state.highScore, Math.floor(state.distance));
    localStorage.setItem(HIGH_SCORE_KEY, String(state.highScore));
    if (dom.deathMessage) dom.deathMessage.textContent = pick(DEATH_MESSAGES);
    if (dom.scoreFinal) dom.scoreFinal.textContent = Math.floor(state.distance).toLocaleString();
    if (dom.coinFinal) dom.coinFinal.textContent = state.coins.toLocaleString();
    const p = project(PLAYER_Z, laneToX(state.player.laneFloat), 0.4);
    burst(p.x, p.y, "#ff314f", 30, 220);
    show(dom.deathOverlay);
    updateHud();
    audio.beep(120, 0.3, "sawtooth", 0.09);
  }

  async function revive() {
    if (state.mode !== "dead" || state.revivedThisRun) return;
    dom.reviveButton.disabled = true;
    dom.reviveButton.textContent = "Paying toll…";
    const payment = await revivePayments.payForRevive();
    if (!payment.ok) { dom.reviveButton.textContent = payment.reason || "Revive failed"; updateHud(); return; }
    state.revivedThisRun = true;
    state.mode = "running";
    state.invincibleUntil = state.elapsed + 2.6;
    state.flash = 0.6;
    // clear the immediate danger zone
    state.obstacles = state.obstacles.filter(o => o.z > PLAYER_Z + HIT_BAND + 6);
    Object.assign(state.player, { worldY: 0, vy: 0, onGround: true, slideT: 0 });
    hide(dom.deathOverlay);
    dom.revivedBanner.classList.remove("is-visible");
    void dom.revivedBanner.offsetWidth;
    dom.revivedBanner.classList.add("is-visible");
    const p = project(PLAYER_Z, laneToX(state.player.laneFloat), 0.4);
    burst(p.x, p.y, "#4dff73", 44, 260);
    audio.chord([660, 880, 1180], 0.12);
    updateHud();
  }

  // --- Input ----------------------------------------------------------
  function moveLane(dir) {
    if (state.mode !== "running") return;
    const next = clamp(state.player.lane + dir, -1, 1);
    if (next !== state.player.lane) {
      state.player.lane = next;
      state.player.lean = clamp(state.player.lean + dir * 0.5, -1, 1);
      audio.beep(420 + next * 70, 0.04, "square", 0.05);
    }
  }
  function jump() {
    if (state.mode !== "running") return;
    if (state.player.onGround) {
      state.player.vy = 3.0;
      state.player.onGround = false;
      state.player.slideT = 0;
      audio.beep(560, 0.08, "square", 0.06);
      dust();
    }
  }
  function slide() {
    if (state.mode !== "running") return;
    if (!state.player.onGround) { state.player.vy = Math.min(state.player.vy, -3.2); } // fast-fall into slide
    state.player.slideT = 0.62;
    audio.beep(240, 0.07, "sawtooth", 0.05);
  }

  // --- Update ---------------------------------------------------------
  function update(dt) {
    const p = state.player;
    p.runPhase += dt * (state.mode === "running" ? 15 : 4);
    p.lean = lerp(p.lean, 0, Math.min(1, dt * 6));
    state.flash = Math.max(0, state.flash - dt);
    state.hitFlash = Math.max(0, state.hitFlash - dt * 3);
    state.shake = Math.max(0, state.shake - dt * 36);

    if (state.mode !== "running") {
      state.scroll += dt * 6;
      stepParticles(dt);
      return;
    }

    state.elapsed += dt;
    state.speed = Math.min(64, 26 + state.elapsed * 1.35);
    state.distance += state.speed * dt * 0.6;
    state.scroll += dt * state.speed;

    // lane / vertical physics
    p.laneFloat = lerp(p.laneFloat, p.lane, Math.min(1, dt * 12));
    if (!p.onGround) {
      p.vy -= 9.2 * dt;             // gravity (world units)
      p.worldY += p.vy * dt;
      if (p.worldY <= 0) { p.worldY = 0; p.vy = 0; p.onGround = true; dust(); }
    }
    p.slideT = Math.max(0, p.slideT - dt);

    // advance world toward camera
    const travel = state.speed * dt;
    for (const o of state.obstacles) o.z -= travel;
    for (const c of state.coinsArr) c.z -= travel;
    state.obstacles = state.obstacles.filter(o => o.z > DESPAWN_Z);
    state.coinsArr = state.coinsArr.filter(c => c.z > DESPAWN_Z && !c.got);

    // spawn obstacles by distance cursor
    state.spawnZCursor -= travel;
    if (state.spawnZCursor <= SPAWN_Z) {
      spawnObstacleRow();
      const gap = clamp(rand(20, 30) - state.elapsed * 0.18, 11, 30);
      state.spawnZCursor = SPAWN_Z + gap;
    }

    // spawn coin arcs
    state.coinTimer -= dt;
    if (state.coinTimer <= 0) {
      spawnCoinRun();
      state.coinTimer = rand(0.9, 1.7);
    }

    stepParticles(dt);
    checkCollisions();
    updateHud();
  }

  function stepParticles(dt) {
    for (const pt of state.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 320 * dt;
      pt.life -= dt;
      pt.size *= 0.98;
    }
    state.particles = state.particles.filter(pt => pt.life > 0);
  }

  function spawnObstacleRow() {
    const kind = pick([OB_BARRIER, OB_BEAM, OB_PIT, OB_BARRIER, OB_BEAM]);
    // Leave at least one safe lane. Block 1 or 2 lanes.
    const blockCount = Math.random() < 0.34 && state.elapsed > 12 ? 2 : 1;
    const lanesCopy = [...LANES];
    const blocked = [];
    for (let i = 0; i < blockCount; i++) blocked.push(lanesCopy.splice((Math.random() * lanesCopy.length) | 0, 1)[0]);
    for (const lane of blocked) {
      state.obstacles.push({ kind, lane, z: SPAWN_Z, cleared: false, wob: rand(0, 6.28) });
    }
  }

  function spawnCoinRun() {
    const lane = pick(LANES);
    const count = 4 + ((Math.random() * 4) | 0);
    const arc = Math.random() < 0.4;     // arc invites a jump
    for (let i = 0; i < count; i++) {
      state.coinsArr.push({
        lane,
        z: SPAWN_Z + i * 3.0,
        worldY: arc ? Math.sin((i / (count - 1)) * Math.PI) * 0.7 : 0.15,
        got: false,
        spin: rand(0, 6.28),
      });
    }
  }

  function checkCollisions() {
    const p = state.player;
    const pLane = p.laneFloat;
    const sliding = p.slideT > 0;

    for (const c of state.coinsArr) {
      if (c.got) continue;
      if (c.z < PLAYER_Z + 1.6 && c.z > PLAYER_Z - 1.2 && Math.abs(c.lane - pLane) < 0.45) {
        const dy = Math.abs(c.worldY - (p.worldY + 0.4));
        if (dy < 0.6) {
          c.got = true;
          state.coins += 1;
          state.distance += 6;
          const sp = project(c.z, laneToX(c.lane), c.worldY + 0.4);
          burst(sp.x, sp.y, "#ffd84d", 7, 120);
          audio.beep(900 + (state.coins % 6) * 40, 0.05, "triangle", 0.045);
        }
      }
    }

    for (const o of state.obstacles) {
      if (o.z > PLAYER_Z + HIT_BAND || o.z < PLAYER_Z - HIT_BAND) continue;
      if (Math.abs(o.lane - pLane) > 0.5) continue;
      let safe = false;
      if (o.kind.clear === "jump") safe = p.worldY > (o.kind === OB_PIT ? 0.18 : 0.34);
      else if (o.kind.clear === "slide") safe = sliding && p.onGround;
      if (!safe) { die(); return; }
      if (!o.cleared) {
        o.cleared = true;
        state.distance += 12;
        const sp = project(o.z, laneToX(o.lane), 0.5);
        burst(sp.x, sp.y, "#4deeff", 8, 140);
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
    drawRoad(w, h);
    drawPillars(w, h);

    // depth-sorted scene objects (painter's algorithm, far first)
    const items = [];
    for (const o of state.obstacles) items.push({ z: o.z, kind: "ob", ref: o });
    for (const c of state.coinsArr) if (!c.got) items.push({ z: c.z, kind: "coin", ref: c });
    items.push({ z: PLAYER_Z, kind: "player", ref: state.player });
    items.sort((a, b) => b.z - a.z);
    for (const it of items) {
      if (it.kind === "ob") drawObstacle(it.ref);
      else if (it.kind === "coin") drawCoin(it.ref);
      else drawPlayer();
    }

    drawParticles();
    drawAtmosphere(w, h);
    ctx.restore();
  }

  function drawSky(w, h) {
    const horizonY = h * CAM.horizon;
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY + 40);
    sky.addColorStop(0, "#06121a");
    sky.addColorStop(0.55, "#0b2630");
    sky.addColorStop(1, "#123f3a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizonY + 60);

    // cursed green sun glow at the vanishing point
    const glow = ctx.createRadialGradient(w / 2, horizonY, 8, w / 2, horizonY, h * 0.5);
    glow.addColorStop(0, "rgba(77,255,115,0.42)");
    glow.addColorStop(0.4, "rgba(77,255,115,0.12)");
    glow.addColorStop(1, "rgba(77,255,115,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, horizonY + h * 0.3);

    // distant chart skyline silhouette
    ctx.fillStyle = "rgba(3,10,12,0.85)";
    const baseY = horizonY + 2;
    const barW = w / 26;
    for (let i = 0; i <= 26; i++) {
      const x = i * barW;
      const hgt = 8 + (Math.sin(i * 1.7) * 0.5 + 0.5) * (h * 0.09);
      ctx.fillRect(x, baseY - hgt, barW - 2, hgt);
    }
    // floor fills below horizon edges (dark temple ground)
    ctx.fillStyle = "#070d0c";
    ctx.fillRect(0, horizonY, w, h - horizonY);
  }

  function drawRoad(w, h) {
    const nearZ = 1.5, farZ = SPAWN_Z;
    const nl = project(nearZ, -ROAD_HALF, 0), nr = project(nearZ, ROAD_HALF, 0);
    const fl = project(farZ, -ROAD_HALF, 0), fr = project(farZ, ROAD_HALF, 0);

    // road surface
    const grad = ctx.createLinearGradient(0, fl.y, 0, nl.y);
    grad.addColorStop(0, "#0a1614");
    grad.addColorStop(1, "#16201d");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(fl.x, fl.y); ctx.lineTo(fr.x, fr.y);
    ctx.lineTo(nr.x, nr.y); ctx.lineTo(nl.x, nl.y); ctx.closePath();
    ctx.fill();

    // glowing road edges
    ctx.lineWidth = 2;
    for (const sgn of [-1, 1]) {
      const f = project(farZ, sgn * ROAD_HALF, 0), n = project(nearZ, sgn * ROAD_HALF, 0);
      ctx.strokeStyle = "rgba(77,255,115,0.5)";
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(n.x, n.y); ctx.stroke();
    }

    // lane dividers
    for (const lx of [-LANE_W / 2, LANE_W / 2]) {
      const f = project(farZ, lx, 0), n = project(nearZ, lx, 0);
      ctx.strokeStyle = "rgba(120,200,255,0.16)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(n.x, n.y); ctx.stroke();
    }

    // scrolling rungs (sells forward motion)
    const spacing = 4;
    const startZ = nearZ + (state.scroll % spacing);
    for (let z = startZ; z < farZ; z += spacing) {
      const l = project(z, -ROAD_HALF, 0), r = project(z, ROAD_HALF, 0);
      const a = clamp(0.42 - z / farZ * 0.4, 0.03, 0.42);
      ctx.strokeStyle = (Math.floor(z) % 8 < 4) ? `rgba(77,255,115,${a})` : `rgba(255,49,79,${a * 0.8})`;
      ctx.lineWidth = clamp(l.scale * 60, 0.6, 3);
      ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y); ctx.stroke();
    }
  }

  function drawPillars(w, h) {
    const spacing = 9;
    const startZ = 2 + (state.scroll % spacing);
    const list = [];
    for (let z = startZ; z < SPAWN_Z; z += spacing) list.push(z);
    list.sort((a, b) => b - a); // far first
    for (const z of list) {
      for (const sgn of [-1, 1]) {
        drawPillar(sgn * WALL_X, z);
      }
    }
  }

  function drawPillar(laneX, z) {
    const base = project(z, laneX, 0);
    const top = project(z, laneX, 2.3);
    if (base.scale < 0.012) return;
    const wpx = clamp(base.scale * (state.view.w * 0.34), 1, 80);
    const torchOn = Math.floor(z / 9) % 2 === 0;

    // column body
    const colGrad = ctx.createLinearGradient(base.x - wpx / 2, 0, base.x + wpx / 2, 0);
    colGrad.addColorStop(0, "#0c1a17");
    colGrad.addColorStop(0.5, "#27433b");
    colGrad.addColorStop(1, "#0c1a17");
    ctx.fillStyle = colGrad;
    ctx.fillRect(base.x - wpx / 2, top.y, wpx, base.y - top.y);
    // cap
    ctx.fillStyle = "#2f4f45";
    ctx.fillRect(base.x - wpx * 0.62, top.y - wpx * 0.18, wpx * 1.24, wpx * 0.3);

    // torch glow
    if (torchOn) {
      const flick = 0.6 + Math.sin(state.elapsed * 12 + z) * 0.18 + Math.random() * 0.08;
      const ty = lerp(top.y, base.y, 0.28);
      const r = wpx * 1.5;
      const tg = ctx.createRadialGradient(base.x, ty, 1, base.x, ty, r);
      tg.addColorStop(0, `rgba(120,255,150,${0.5 * flick})`);
      tg.addColorStop(0.5, `rgba(77,255,115,${0.18 * flick})`);
      tg.addColorStop(1, "rgba(77,255,115,0)");
      ctx.fillStyle = tg;
      ctx.beginPath(); ctx.arc(base.x, ty, r, 0, 6.2832); ctx.fill();
    }
  }

  function drawCoin(c) {
    const p = project(c.z, laneToX(c.lane), c.worldY + 0.4);
    if (p.scale < 0.012) return;
    const r = clamp(p.scale * 90, 3, 26);
    const squish = Math.abs(Math.cos(state.elapsed * 5 + c.spin)); // spinning coin
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.shadowBlur = 16; ctx.shadowColor = "#ffd84d";
    ctx.fillStyle = "#ffd84d";
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(2, r * (0.35 + squish * 0.65)), r, 0, 0, 6.2832);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.strokeStyle = "#b6831a";
    ctx.stroke();
    if (r > 9 && squish > 0.4) {
      ctx.fillStyle = "#6b4a07";
      ctx.font = `900 ${Math.floor(r * 0.9)}px 'DM Mono', monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("T", 0, r * 0.06);
    }
    ctx.restore();
  }

  function drawObstacle(o) {
    const laneX = laneToX(o.lane);
    if (o.kind === OB_PIT) { drawPit(o, laneX); return; }
    const p = project(o.z, laneX, 0);
    if (p.scale < 0.012) return;
    const halfW = LANE_W * 0.46;
    const lEdge = project(o.z, laneX - halfW, 0);
    const rEdge = project(o.z, laneX + halfW, 0);
    const wpx = Math.max(4, rEdge.x - lEdge.x);

    if (o.kind === OB_BARRIER) {
      // red-candle gate: jump it
      const topB = project(o.z, laneX, 0.62);
      const h = p.y - topB.y;
      ctx.save();
      ctx.shadowBlur = clamp(p.scale * 120, 2, 22); ctx.shadowColor = "#ff314f";
      const g = ctx.createLinearGradient(0, topB.y, 0, p.y);
      g.addColorStop(0, "#ff5c73"); g.addColorStop(1, "#b3092a");
      ctx.fillStyle = g;
      ctx.fillRect(p.x - wpx / 2, topB.y, wpx, h);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(p.x - wpx / 2, topB.y + h * 0.32, wpx, h * 0.16);
      // wick
      ctx.strokeStyle = "#ffd0d8"; ctx.lineWidth = Math.max(1, wpx * 0.05);
      const wick = project(o.z, laneX, 0.85);
      ctx.beginPath(); ctx.moveTo(p.x, topB.y); ctx.lineTo(wick.x, wick.y); ctx.stroke();
      if (wpx > 30) label(p.x, topB.y - 6, "JUMP", "#ffd0d8", wpx);
      ctx.restore();
    } else if (o.kind === OB_BEAM) {
      // FUD overhang: slide under it
      const lo = project(o.z, laneX, 0.62);
      const hi = project(o.z, laneX, 1.16);
      ctx.save();
      ctx.shadowBlur = clamp(p.scale * 110, 2, 20); ctx.shadowColor = "#4deeff";
      ctx.fillStyle = "#0e3a44";
      ctx.fillRect(p.x - wpx / 2, hi.y, wpx, lo.y - hi.y);
      ctx.strokeStyle = "#4deeff"; ctx.lineWidth = Math.max(1, wpx * 0.04);
      ctx.strokeRect(p.x - wpx / 2, hi.y, wpx, lo.y - hi.y);
      ctx.shadowBlur = 0;
      if (wpx > 34) {
        ctx.fillStyle = "#bff4ff";
        ctx.font = `900 ${clamp(wpx * 0.26, 8, 26)}px 'DM Mono', monospace`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("FUD", p.x, (hi.y + lo.y) / 2);
      }
      // support posts
      ctx.fillStyle = "#0e3a44";
      ctx.fillRect(p.x - wpx / 2, hi.y, Math.max(2, wpx * 0.08), p.y - hi.y);
      ctx.fillRect(p.x + wpx / 2 - Math.max(2, wpx * 0.08), hi.y, Math.max(2, wpx * 0.08), p.y - hi.y);
      ctx.restore();
    }
  }

  function drawPit(o, laneX) {
    const half = LANE_W * 0.5;
    const nearZ = o.z - 1.4, farZ = o.z + 1.4;
    const fl = project(farZ, laneX - half, 0), fr = project(farZ, laneX + half, 0);
    const nl = project(nearZ, laneX - half, 0), nr = project(nearZ, laneX + half, 0);
    if (nl.scale < 0.012) return;
    ctx.save();
    ctx.fillStyle = "#01060a";
    ctx.beginPath();
    ctx.moveTo(fl.x, fl.y); ctx.lineTo(fr.x, fr.y); ctx.lineTo(nr.x, nr.y); ctx.lineTo(nl.x, nl.y);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(154,92,255,0.7)"; ctx.lineWidth = clamp(nl.scale * 40, 1, 3);
    ctx.stroke();
    const cx = (nl.x + nr.x) / 2, cy = (nl.y + fl.y) / 2;
    if (nr.x - nl.x > 36) label(cx, cy, "RUG", "#c9a8ff", nr.x - nl.x);
    ctx.restore();
  }

  function label(x, y, text, color, wpx) {
    ctx.fillStyle = color;
    ctx.font = `900 ${clamp(wpx * 0.2, 8, 18)}px 'DM Mono', monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  }

  function drawPlayer() {
    const p = state.player;
    const laneX = laneToX(p.laneFloat);
    const base = project(PLAYER_Z, laneX, 0);
    const bob = Math.abs(Math.sin(p.runPhase)) * (p.onGround && p.slideT <= 0 ? 6 : 0);
    const groundProj = project(PLAYER_Z, laneX, 0);
    const liftPx = groundProj.y - project(PLAYER_Z, laneX, p.worldY).y;

    // ground shadow (shrinks with jump height)
    const shW = base.scale * state.view.w * 0.32;
    const shrink = clamp(1 - p.worldY * 0.7, 0.35, 1);
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.4 * shrink})`;
    ctx.beginPath();
    ctx.ellipse(base.x, base.y - 4, shW * shrink, shW * 0.26 * shrink, 0, 0, 6.2832);
    ctx.fill();
    ctx.restore();

    if (!(playerImage.complete && playerImage.naturalWidth)) {
      ctx.fillStyle = "#4dff73";
      ctx.beginPath(); ctx.arc(base.x, base.y - 40, 26, 0, 6.2832); ctx.fill();
      return;
    }

    const sliding = p.slideT > 0 && p.onGround;
    const targetH = base.scale * state.view.h * 0.74;     // sprite height in px (~38% of canvas)
    const aspect = playerImage.naturalWidth / playerImage.naturalHeight;
    let drawH = targetH;
    let drawW = drawH * aspect;

    ctx.save();
    ctx.translate(base.x, base.y - bob - liftPx);
    ctx.rotate(p.lean * 0.12);
    if (sliding) { ctx.scale(1.16, 0.6); ctx.translate(0, drawH * 0.3); }
    const invincible = state.elapsed < state.invincibleUntil;
    if (invincible && Math.floor(state.elapsed * 14) % 2 === 0) ctx.globalAlpha = 0.5;
    ctx.shadowBlur = invincible ? 26 : 16;
    ctx.shadowColor = invincible ? "#4dff73" : "rgba(120,200,255,0.5)";
    ctx.drawImage(playerImage, -drawW / 2, -drawH, drawW, drawH);
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

  function drawAtmosphere(w, h) {
    // vignette
    const v = ctx.createRadialGradient(w / 2, h * 0.52, h * 0.18, w / 2, h * 0.52, h * 0.8);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(77,255,115,${Math.min(0.2, state.flash * 0.32)})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (state.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,49,79,${Math.min(0.34, state.hitFlash)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function burst(x, y, color, count, spread) {
    for (let i = 0; i < count; i++) {
      state.particles.push({
        x, y,
        vx: rand(-spread, spread),
        vy: rand(-spread, spread * 0.4),
        size: rand(2, 6),
        life: rand(0.3, 0.7), maxLife: 0.7,
        color,
      });
    }
  }
  function dust() {
    const p = project(PLAYER_Z, laneToX(state.player.laneFloat), 0);
    for (let i = 0; i < 8; i++) {
      state.particles.push({
        x: p.x + rand(-20, 20), y: p.y - 2,
        vx: rand(-70, 70), vy: rand(-120, -30),
        size: rand(2, 5), life: rand(0.2, 0.45), maxLife: 0.45,
        color: "rgba(180,210,200,0.7)",
      });
    }
  }

  // --- Input wiring ---------------------------------------------------
  function handleKeydown(e) {
    const k = e.key.toLowerCase();
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", " ", "a", "d", "w", "s"].includes(k)) e.preventDefault();
    if (k === "a" || k === "arrowleft") moveLane(-1);
    else if (k === "d" || k === "arrowright") moveLane(1);
    else if (k === "w" || k === "arrowup" || k === " ") jump();
    else if (k === "s" || k === "arrowdown") slide();
  }

  function bindSwipe() {
    let sx = 0, sy = 0, tracking = false;
    dom.canvas.addEventListener("touchstart", e => {
      const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; tracking = true;
    }, { passive: true });
    dom.canvas.addEventListener("touchmove", e => { if (tracking) e.preventDefault(); }, { passive: false });
    dom.canvas.addEventListener("touchend", e => {
      if (!tracking) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      tracking = false;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) { jump(); return; } // tap = jump
      if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
      else if (dy < 0) jump(); else slide();
    }, { passive: true });
  }

  function loop(time) {
    if (!state.lastTime) state.lastTime = time;
    const dt = Math.min(0.033, (time - state.lastTime) / 1000);
    state.lastTime = time;
    update(dt);
    render();
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
    dom.reviveButton && dom.reviveButton.addEventListener("click", revive);
    dom.soundToggle && dom.soundToggle.addEventListener("click", () => {
      audio.enabled = !audio.enabled;
      dom.soundToggle.setAttribute("aria-pressed", String(audio.enabled));
      dom.soundToggle.classList.toggle("is-on", audio.enabled);
      if (audio.enabled) audio.beep(680, 0.06);
    });
    document.documentElement.dataset.trollDashReady = "true";
    // Dev deep-link: #autostart begins a run immediately (used for previews/tests).
    if (/(?:^|[#&])autostart/.test(window.location.hash)) {
      const begin = () => resetRun();
      if (playerImage.complete) begin(); else playerImage.addEventListener("load", begin, { once: true });
    }
    requestAnimationFrame(loop);
  }

  init();
})();
