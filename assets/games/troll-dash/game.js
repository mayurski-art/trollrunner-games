(() => {
  "use strict";

  const REVIVE_COST = 6.9;
  const TREASURY_WALLET = "79vVRZ7qnZfj9xCto5d9Kwf4eAimqMDrQysZjHBbFbsA";
  const TROLL_MINT_ADDRESS = "REPLACE_WITH_VERIFIED_TROLL_SPL_MINT_ADDRESS";
  const HIGH_SCORE_KEY = "troll_dash_high_score_v1";
  const MOCK_WALLET_START_BALANCE = 42;
  const LANES = [-1, 0, 1];
  const DEATH_MESSAGES = [
    "RUGGED",
    "LIQUIDATED",
    "THE NPCs GOT YOU",
    "CHART FAILED TO HOLD SUPPORT",
  ];

  const OBSTACLE_TYPES = [
    { id: "red-candle", label: "RED CANDLE", color: "#ff314f", clear: "jump", weight: 4 },
    { id: "rug-hole", label: "RUGPULL", color: "#111111", clear: "jump", weight: 3 },
    { id: "npc", label: "NPC", color: "#9a5cff", clear: "slide", weight: 3 },
    { id: "bear", label: "BEAR", color: "#ff314f", clear: "dodge", weight: 2 },
    { id: "chart-wall", label: "SUPPORT?", color: "#4deeff", clear: "dodge", weight: 2 },
    { id: "scam-barrel", label: "SCAM", color: "#ffd84d", clear: "jump", weight: 2 },
    { id: "fud-sign", label: "FUD", color: "#ffffff", clear: "slide", weight: 2 },
  ];

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
  };

  const ctx = dom.canvas.getContext("2d");
  const playerImage = new Image();
  // Background-removed buff guy cutout. The rig below animates cropped regions from this single preserved source.
  playerImage.src = "assets/games/troll-dash/sprites/troll-buffguyfigure-cutout.png";

  const BUFF_RIG = {
    origin: { x: 705, y: 830 },
    scale: 0.16,
    parts: {
      backArm: { sx: 80, sy: 180, sw: 585, sh: 390, px: 520, py: 420 },
      leg: { sx: 505, sy: 555, sw: 350, sh: 350, px: 650, py: 665 },
      torso: { sx: 390, sy: 210, sw: 610, sh: 555, px: 710, py: 525 },
      frontArm: { sx: 830, sy: 290, sw: 440, sh: 360, px: 940, py: 415 },
      head: { sx: 625, sy: 235, sw: 370, sh: 280, px: 810, py: 375 },
    },
  };

  const state = {
    mode: "ready",
    view: { w: 960, h: 540 },
    lastTime: 0,
    elapsed: 0,
    speed: 305,
    spawnTimer: 0,
    coinSpawnTimer: 0,
    score: 0,
    coins: 0,
    highScore: Number(localStorage.getItem(HIGH_SCORE_KEY) || 0),
    walletBalance: MOCK_WALLET_START_BALANCE,
    revivedThisRun: false,
    invincibleUntil: 0,
    flashTimer: 0,
    chartPhase: 0,
    shake: 0,
    obstacles: [],
    pickups: [],
    particles: [],
    player: {
      lane: 0,
      laneFloat: 0,
      jumpTime: 0,
      slideTime: 0,
    },
  };

  const audio = {
    enabled: false,
    context: null,
    beep(frequency = 520, duration = 0.06, type = "square") {
      // Replace these synthesized bleeps with arcade sound files when final audio assets are ready.
      if (!this.enabled || !window.AudioContext && !window.webkitAudioContext) return;
      if (!this.context) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        this.context = new AudioCtor();
      }
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      oscillator.connect(gain).connect(this.context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    },
  };

  class MockRevivePaymentProvider {
    constructor(gameState) {
      this.gameState = gameState;
      this.mode = "mock";
    }

    createReviveSession() {
      return {
        id: window.crypto?.randomUUID ? window.crypto.randomUUID() : `mock-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        cost: REVIVE_COST,
        treasuryWallet: TREASURY_WALLET,
        mint: TROLL_MINT_ADDRESS,
        memo: `troll-dash-revive-${Date.now()}`,
      };
    }

    async payForRevive() {
      const session = this.createReviveSession();
      if (this.gameState.walletBalance < REVIVE_COST) {
        return { ok: false, reason: "Insufficient mock $TROLL balance.", session };
      }
      this.gameState.walletBalance = roundTroll(this.gameState.walletBalance - REVIVE_COST);
      return { ok: true, signature: `mock-${session.id}`, session };
    }
  }

  class FutureSolanaPaymentProvider {
    // Replace this mock provider with wallet-adapter + Solana Pay/direct SPL token transfer.
    // Real paid revives must:
    // 1. Create a unique revive session id/reference/memo server-side.
    // 2. Send exactly 6.9 $TROLL to TREASURY_WALLET using the verified TROLL_MINT_ADDRESS.
    // 3. Wait for confirmed/finalized transaction status.
    // 4. Call a backend/serverless endpoint that verifies signature, destination, mint, amount,
    //    memo/reference, and one-time transaction usage before granting the revive.
    async payForRevive() {
      throw new Error("Real Solana payment flow is intentionally disabled until backend verification exists.");
    }
  }

  const revivePayments = new MockRevivePaymentProvider(state);
  void FutureSolanaPaymentProvider;

  function roundTroll(value) {
    return Math.round(value * 10) / 10;
  }

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

  function updateHud() {
    dom.score.textContent = Math.floor(state.score).toLocaleString();
    dom.coins.textContent = state.coins.toLocaleString();
    dom.high.textContent = Math.floor(state.highScore).toLocaleString();
    dom.walletBalance.textContent = `${state.walletBalance.toFixed(1)} $TROLL`;
    dom.treasuryWallet.textContent = TREASURY_WALLET;
    dom.reviveButton.disabled = state.revivedThisRun || state.walletBalance < REVIVE_COST;
    dom.reviveButton.textContent = state.revivedThisRun ? "Revive Used" : "Revive for 6.9 $TROLL";
  }

  function resetRun() {
    state.mode = "running";
    state.elapsed = 0;
    state.speed = 305;
    state.spawnTimer = 0.55;
    state.coinSpawnTimer = 0.4;
    state.score = 0;
    state.coins = 0;
    state.revivedThisRun = false;
    state.invincibleUntil = 0;
    state.flashTimer = 0;
    state.shake = 0;
    state.obstacles = [];
    state.pickups = [];
    state.particles = [];
    state.player.lane = 0;
    state.player.laneFloat = 0;
    state.player.jumpTime = 0;
    state.player.slideTime = 0;
    hideOverlay(dom.startOverlay);
    hideOverlay(dom.deathOverlay);
    updateHud();
  }

  function showOverlay(node) {
    node.classList.add("is-visible");
  }

  function hideOverlay(node) {
    node.classList.remove("is-visible");
  }

  function die() {
    if (state.mode !== "running") return;
    if (state.elapsed < state.invincibleUntil) {
      state.flashTimer = 0.12;
      return;
    }
    state.mode = "dead";
    state.shake = 18;
    state.highScore = Math.max(state.highScore, Math.floor(state.score));
    localStorage.setItem(HIGH_SCORE_KEY, String(state.highScore));
    dom.deathMessage.textContent = randomChoice(DEATH_MESSAGES);
    showOverlay(dom.deathOverlay);
    updateHud();
    burst(laneToX(state.player.lane), groundY(), "#ff314f", 28);
    audio.beep(110, 0.22, "sawtooth");
  }

  async function revive() {
    if (state.mode !== "dead" || state.revivedThisRun) return;
    dom.reviveButton.disabled = true;
    dom.reviveButton.textContent = "Mock paying...";
    const payment = await revivePayments.payForRevive();
    if (!payment.ok) {
      dom.reviveButton.textContent = payment.reason || "Revive failed";
      updateHud();
      return;
    }
    state.revivedThisRun = true;
    state.mode = "running";
    state.invincibleUntil = state.elapsed + 3;
    state.flashTimer = 3;
    state.obstacles = state.obstacles.filter(item => Math.abs(item.y - groundY()) > 220);
    state.pickups = state.pickups.filter(item => item.y < groundY() - 80);
    hideOverlay(dom.deathOverlay);
    dom.revivedBanner.classList.remove("is-visible");
    void dom.revivedBanner.offsetWidth;
    dom.revivedBanner.classList.add("is-visible");
    burst(laneToX(state.player.lane), groundY() - 45, "#4dff73", 42);
    audio.beep(740, 0.1, "square");
    setTimeout(() => audio.beep(980, 0.12, "square"), 110);
    updateHud();
  }

  function moveLane(direction) {
    if (state.mode !== "running") return;
    state.player.lane = clamp(state.player.lane + direction, -1, 1);
    audio.beep(380 + state.player.lane * 80, 0.04);
  }

  function jump() {
    if (state.mode !== "running") return;
    if (state.player.jumpTime <= 0.02) {
      state.player.jumpTime = 0.72;
      state.player.slideTime = 0;
      audio.beep(620, 0.06);
    }
  }

  function slide() {
    if (state.mode !== "running") return;
    state.player.slideTime = 0.62;
    state.player.jumpTime = 0;
    audio.beep(230, 0.05, "sawtooth");
  }

  function update(dt) {
    if (state.mode !== "running") {
      state.chartPhase += dt * 0.26;
      state.shake = Math.max(0, state.shake - dt * 24);
      return;
    }

    state.elapsed += dt;
    state.chartPhase += dt * (0.34 + state.speed / 900);
    state.speed = Math.min(620, 305 + state.elapsed * 5.8);
    state.score += dt * (18 + state.speed * 0.12);
    state.spawnTimer -= dt;
    state.coinSpawnTimer -= dt;
    state.flashTimer = Math.max(0, state.flashTimer - dt);
    state.shake = Math.max(0, state.shake - dt * 38);

    const player = state.player;
    player.laneFloat += (player.lane - player.laneFloat) * Math.min(1, dt * 13);
    player.jumpTime = Math.max(0, player.jumpTime - dt);
    player.slideTime = Math.max(0, player.slideTime - dt);

    if (state.spawnTimer <= 0) {
      spawnObstacle();
      state.spawnTimer = Math.max(0.48, random(0.82, 1.34) - state.elapsed * 0.006);
    }

    if (state.coinSpawnTimer <= 0) {
      spawnCoinRow();
      state.coinSpawnTimer = random(0.74, 1.18);
    }

    const travel = state.speed * dt;
    for (const obstacle of state.obstacles) obstacle.y += travel;
    for (const pickup of state.pickups) pickup.y += travel;
    for (const particle of state.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life -= dt;
      particle.size *= 0.986;
    }

    state.obstacles = state.obstacles.filter(item => item.y < state.view.h + 120);
    state.pickups = state.pickups.filter(item => item.y < state.view.h + 80 && !item.collected);
    state.particles = state.particles.filter(item => item.life > 0);

    checkCollisions();
    updateHud();
  }

  function spawnObstacle() {
    const type = weightedObstacle();
    const lane = randomChoice(LANES);
    state.obstacles.push({
      id: `${type.id}-${Date.now()}-${Math.random()}`,
      type,
      lane,
      y: -70,
      wobble: random(0, Math.PI * 2),
      size: random(0.88, 1.12),
    });
  }

  function spawnCoinRow() {
    const lane = randomChoice(LANES);
    const count = Math.random() > 0.68 ? 3 : 2;
    for (let i = 0; i < count; i += 1) {
      state.pickups.push({
        lane,
        y: -90 - i * 58,
        spin: random(0, Math.PI * 2),
        collected: false,
      });
    }
  }

  function checkCollisions() {
    const px = laneToX(state.player.laneFloat);
    const py = groundY() - jumpOffset();
    const sliding = state.player.slideTime > 0;
    const jumping = jumpOffset() > 42;

    for (const pickup of state.pickups) {
      if (pickup.collected) continue;
      if (Math.abs(laneToX(pickup.lane) - px) < 46 && Math.abs(pickup.y - py) < 54) {
        pickup.collected = true;
        state.coins += 1;
        state.score += 25;
        burst(laneToX(pickup.lane), pickup.y, "#ffd84d", 8);
        audio.beep(880, 0.045, "triangle");
      }
    }

    for (const obstacle of state.obstacles) {
      if (Math.abs(laneToX(obstacle.lane) - px) > 48 || Math.abs(obstacle.y - groundY()) > 50) continue;
      const clear = obstacle.type.clear;
      const avoided = clear === "jump" && jumping || clear === "slide" && sliding;
      if (!avoided) {
        die();
        break;
      }
      if (!obstacle.cleared) {
        obstacle.cleared = true;
        state.score += 45;
        burst(laneToX(obstacle.lane), obstacle.y, "#4deeff", 10);
      }
    }
  }

  function render() {
    const { w, h } = state.view;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (state.shake > 0) {
      ctx.translate(random(-state.shake, state.shake), random(-state.shake, state.shake));
    }
    drawBackground(w, h);
    drawRunway(w, h);
    drawPickups();
    drawObstacles();
    drawPlayer();
    drawParticles();
    drawVignette(w, h);
    ctx.restore();
  }

  function drawBackground(w, h) {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "#07000b");
    gradient.addColorStop(0.5, "#13071b");
    gradient.addColorStop(1, "#030105");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.lineWidth = 2;
    drawChartLine(w, h * 0.24, "#4dff73", 0);
    drawChartLine(w, h * 0.38, "#ff314f", 1.7);
    drawChartLine(w, h * 0.56, "#9a5cff", 3.2);
    ctx.restore();

    const candleCount = Math.ceil(w / 42) + 4;
    for (let i = -2; i < candleCount; i += 1) {
      const x = ((i * 42 - state.chartPhase * 96) % (w + 168)) - 84;
      const base = 62 + (Math.sin(i * 1.8 + state.chartPhase * 4) + 1) * 56;
      const height = 18 + Math.abs(Math.sin(i * 2.3)) * 58;
      const green = Math.sin(i + state.chartPhase * 2) > -0.1;
      ctx.fillStyle = green ? "rgba(77,255,115,0.24)" : "rgba(255,49,79,0.28)";
      ctx.fillRect(x, base, 10, height);
      ctx.strokeStyle = green ? "rgba(77,255,115,0.46)" : "rgba(255,49,79,0.5)";
      ctx.beginPath();
      ctx.moveTo(x + 5, base - 16);
      ctx.lineTo(x + 5, base + height + 16);
      ctx.stroke();
    }

    ctx.font = "700 13px 'DM Mono', monospace";
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let y = 38; y < h; y += 54) {
      ctx.fillText("FAKE PUMP", 18 + (y % 3) * 34, y);
      ctx.fillText("DODGE THE RUGS", w - 178 - (y % 2) * 48, y + 22);
    }
  }

  function drawChartLine(w, centerY, color, offset) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let x = -20; x <= w + 20; x += 18) {
      const y = centerY
        + Math.sin(x * 0.018 + state.chartPhase * 5 + offset) * 28
        + Math.sin(x * 0.044 - state.chartPhase * 2.5) * 13;
      if (x === -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawRunway(w, h) {
    const topY = h * 0.22;
    const bottomY = h * 0.96;
    const topW = w * 0.28;
    const bottomW = w * 0.92;
    const cx = w / 2;

    const runway = ctx.createLinearGradient(0, topY, 0, bottomY);
    runway.addColorStop(0, "rgba(77,255,115,0.08)");
    runway.addColorStop(0.48, "rgba(154,92,255,0.13)");
    runway.addColorStop(1, "rgba(255,49,79,0.18)");

    ctx.fillStyle = runway;
    ctx.strokeStyle = "rgba(77,255,115,0.58)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - topW / 2, topY);
    ctx.lineTo(cx + topW / 2, topY);
    ctx.lineTo(cx + bottomW / 2, bottomY);
    ctx.lineTo(cx - bottomW / 2, bottomY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    for (const laneLine of [-0.5, 0.5]) {
      ctx.strokeStyle = "rgba(77,238,255,0.28)";
      ctx.beginPath();
      ctx.moveTo(interpolate(cx - topW / 2, cx + topW / 2, (laneLine + 1.5) / 3), topY);
      ctx.lineTo(interpolate(cx - bottomW / 2, cx + bottomW / 2, (laneLine + 1.5) / 3), bottomY);
      ctx.stroke();
    }

    for (let y = topY; y < bottomY + 80; y += 46) {
      const yy = ((y + state.chartPhase * 160 - topY) % (bottomY - topY + 80)) + topY - 40;
      const scale = (yy - topY) / (bottomY - topY);
      const half = interpolate(topW, bottomW, scale) / 2;
      ctx.strokeStyle = Math.sin(yy * 0.08) > 0 ? "rgba(77,255,115,0.22)" : "rgba(255,49,79,0.22)";
      ctx.beginPath();
      ctx.moveTo(cx - half, yy);
      ctx.lineTo(cx + half, yy);
      ctx.stroke();
    }
  }

  function drawPickups() {
    for (const pickup of state.pickups) {
      const x = laneToX(pickup.lane);
      const y = pickup.y;
      const pulse = 1 + Math.sin(state.elapsed * 8 + pickup.spin) * 0.08;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(pulse, pulse);
      ctx.shadowBlur = 20;
      ctx.shadowColor = "#ffd84d";
      ctx.fillStyle = "#ffd84d";
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#4dff73";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#190b05";
      ctx.font = "900 12px 'DM Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("$T", 0, 1);
      ctx.restore();
    }
  }

  function drawObstacles() {
    for (const obstacle of state.obstacles) {
      const x = laneToX(obstacle.lane);
      const y = obstacle.y;
      const scale = obstacle.size;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      if (obstacle.type.id === "red-candle") drawRedCandle(obstacle);
      else if (obstacle.type.id === "rug-hole") drawRugHole();
      else if (obstacle.type.id === "npc") drawNpc(obstacle);
      else if (obstacle.type.id === "bear") drawBear();
      else if (obstacle.type.id === "chart-wall") drawChartWall();
      else if (obstacle.type.id === "scam-barrel") drawScamBarrel();
      else drawFudSign();
      ctx.restore();
    }
  }

  function drawRedCandle(obstacle) {
    ctx.shadowBlur = 18;
    ctx.shadowColor = "#ff314f";
    ctx.fillStyle = obstacle.cleared ? "rgba(255,49,79,0.35)" : "#ff314f";
    ctx.fillRect(-16, -54, 32, 82);
    ctx.fillStyle = "#140006";
    ctx.fillRect(-9, -46, 18, 66);
    ctx.strokeStyle = "#ffb0bd";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -72);
    ctx.lineTo(0, 42);
    ctx.stroke();
    labelText("SELL");
  }

  function drawRugHole() {
    ctx.shadowBlur = 24;
    ctx.shadowColor = "#9a5cff";
    ctx.fillStyle = "#010101";
    ctx.beginPath();
    ctx.ellipse(0, 8, 43, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#9a5cff";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#ff314f";
    ctx.font = "900 12px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("RUG", 0, 12);
  }

  function drawNpc(obstacle) {
    const bob = Math.sin(state.elapsed * 9 + obstacle.wobble) * 3;
    ctx.translate(0, bob);
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#9a5cff";
    ctx.fillStyle = "#9a5cff";
    ctx.fillRect(-23, -42, 46, 58);
    ctx.fillStyle = "#f7fff8";
    ctx.beginPath();
    ctx.arc(0, -54, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#08010a";
    ctx.fillRect(-8, -58, 5, 5);
    ctx.fillRect(5, -58, 5, 5);
    labelText("NPC");
  }

  function drawBear() {
    ctx.shadowBlur = 18;
    ctx.shadowColor = "#ff314f";
    ctx.fillStyle = "#2b1014";
    ctx.beginPath();
    ctx.arc(0, -18, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff314f";
    ctx.beginPath();
    ctx.arc(-22, -45, 13, 0, Math.PI * 2);
    ctx.arc(22, -45, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd84d";
    ctx.font = "900 22px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("BEAR", 0, -11);
  }

  function drawChartWall() {
    ctx.shadowBlur = 18;
    ctx.shadowColor = "#4deeff";
    ctx.fillStyle = "#12202a";
    for (let i = 0; i < 4; i += 1) {
      ctx.fillRect(-40 + i * 20, -58 + (i % 2) * 8, 18, 78);
    }
    ctx.strokeStyle = "#4deeff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-42, -18);
    ctx.lineTo(-16, -34);
    ctx.lineTo(8, -4);
    ctx.lineTo(35, -44);
    ctx.stroke();
  }

  function drawScamBarrel() {
    ctx.shadowBlur = 16;
    ctx.shadowColor = "#ffd84d";
    ctx.fillStyle = "#d89b18";
    ctx.fillRect(-30, -48, 60, 66);
    ctx.fillStyle = "#ff314f";
    ctx.fillRect(-30, -26, 60, 18);
    ctx.fillStyle = "#08020a";
    ctx.font = "900 13px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("SCAM", 0, -12);
  }

  function drawFudSign() {
    ctx.shadowBlur = 16;
    ctx.shadowColor = "#ffffff";
    ctx.fillStyle = "#f7fff8";
    ctx.fillRect(-34, -62, 68, 40);
    ctx.fillStyle = "#ff314f";
    ctx.font = "900 18px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("FUD", 0, -36);
    ctx.strokeStyle = "#f7fff8";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(0, 24);
    ctx.stroke();
  }

  function labelText(text) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#f7fff8";
    ctx.font = "900 11px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(text, 0, 50);
  }

  function drawPlayer() {
    const x = laneToX(state.player.laneFloat);
    const y = groundY() - jumpOffset();
    const sliding = state.player.slideTime > 0;
    const invincible = state.elapsed < state.invincibleUntil;
    const runCycle = state.elapsed * (state.mode === "running" ? 9.5 : 2.2);
    const stride = Math.sin(runCycle);
    const counterStride = Math.cos(runCycle);
    ctx.save();
    ctx.translate(x, y);
    if (sliding) {
      ctx.translate(0, 14);
      ctx.scale(1.18, 0.62);
    }
    if (invincible && Math.floor(state.elapsed * 16) % 2 === 0) ctx.globalAlpha = 0.48;
    ctx.shadowBlur = invincible ? 28 : 18;
    ctx.shadowColor = invincible ? "#4dff73" : "#9a5cff";

    if (playerImage.complete && playerImage.naturalWidth > 0) {
      ctx.save();
      ctx.translate(0, Math.sin(runCycle * 2) * 2);
      drawBuffPart(BUFF_RIG.parts.backArm, -0.16 - stride * 0.08, 0, 0);
      drawBuffPart(BUFF_RIG.parts.leg, stride * 0.13, 0, 0);
      drawBuffPart(BUFF_RIG.parts.torso, Math.sin(runCycle * 0.5) * 0.025, 0, 0);
      drawBuffPart(BUFF_RIG.parts.frontArm, 0.14 + counterStride * 0.08, 0, 0);
      drawBuffPart(BUFF_RIG.parts.head, Math.sin(runCycle * 0.7) * 0.035, 0, -1);
      drawBuffExpression(invincible ? "revived" : sliding ? "sneak" : state.mode === "dead" ? "rugged" : "grin");
      ctx.restore();
    } else {
      ctx.fillStyle = "#4dff73";
      ctx.beginPath();
      ctx.arc(0, -42, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#08020a";
      ctx.font = "900 15px 'DM Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(":T", 0, -38);
    }

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffd84d";
    ctx.font = "900 11px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("$TROLL", 0, 18);
    ctx.restore();
  }

  function drawBuffPart(part, rotation, offsetX, offsetY) {
    const { origin, scale } = BUFF_RIG;
    ctx.save();
    ctx.translate((part.px - origin.x) * scale + offsetX, (part.py - origin.y) * scale + offsetY);
    ctx.rotate(rotation);
    ctx.drawImage(
      playerImage,
      part.sx,
      part.sy,
      part.sw,
      part.sh,
      (part.sx - part.px) * scale,
      (part.sy - part.py) * scale,
      part.sw * scale,
      part.sh * scale
    );
    ctx.restore();
  }

  function drawBuffExpression(expression) {
    const { origin, scale } = BUFF_RIG;
    const faceX = (812 - origin.x) * scale;
    const faceY = (382 - origin.y) * scale;
    ctx.save();
    ctx.translate(faceX, faceY);
    ctx.scale(scale, scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = 0;
    ctx.strokeStyle = expression === "revived" ? "#4dff73" : "#08020a";
    ctx.fillStyle = expression === "rugged" ? "#ff314f" : "#08020a";
    ctx.lineWidth = 13;

    if (expression === "revived") {
      ctx.strokeStyle = "#4dff73";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(-58, -24, 23, 0, Math.PI * 2);
      ctx.arc(55, -24, 23, 0, Math.PI * 2);
      ctx.stroke();
    } else if (expression === "sneak") {
      ctx.beginPath();
      ctx.moveTo(-78, -42);
      ctx.lineTo(-18, -32);
      ctx.moveTo(23, -32);
      ctx.lineTo(74, -48);
      ctx.stroke();
    } else if (expression === "rugged") {
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(-72, -48);
      ctx.lineTo(-35, -16);
      ctx.moveTo(-35, -48);
      ctx.lineTo(-72, -16);
      ctx.moveTo(34, -48);
      ctx.lineTo(72, -16);
      ctx.moveTo(72, -48);
      ctx.lineTo(34, -16);
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(-75, -52);
      ctx.quadraticCurveTo(-45, -65, -12, -50);
      ctx.moveTo(22, -50);
      ctx.quadraticCurveTo(52, -65, 80, -50);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawParticles() {
    for (const particle of state.particles) {
      ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawVignette(w, h) {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, h * 0.12, w / 2, h / 2, h * 0.72);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,0.52)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    if (state.flashTimer > 0) {
      ctx.fillStyle = `rgba(77,255,115,${Math.min(0.18, state.flashTimer * 0.08)})`;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.font = "900 12px 'DM Mono', monospace";
    ctx.fillText("PAY THE TROLL TOLL", 18, h - 18);
  }

  function burst(x, y, color, count) {
    for (let i = 0; i < count; i += 1) {
      state.particles.push({
        x,
        y,
        vx: random(-140, 140),
        vy: random(-170, 80),
        size: random(2, 6),
        life: random(0.28, 0.72),
        maxLife: 0.72,
        color,
      });
    }
  }

  function jumpOffset() {
    if (state.player.jumpTime <= 0) return 0;
    const progress = 1 - state.player.jumpTime / 0.72;
    return Math.sin(progress * Math.PI) * state.view.h * 0.2;
  }

  function laneToX(lane) {
    return state.view.w / 2 + lane * Math.min(138, state.view.w * 0.18);
  }

  function groundY() {
    return state.view.h * 0.78;
  }

  function weightedObstacle() {
    const total = OBSTACLE_TYPES.reduce((sum, item) => sum + item.weight, 0);
    let cursor = Math.random() * total;
    for (const item of OBSTACLE_TYPES) {
      cursor -= item.weight;
      if (cursor <= 0) return item;
    }
    return OBSTACLE_TYPES[0];
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function randomChoice(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function interpolate(a, b, t) {
    return a + (b - a) * t;
  }

  function handleKeydown(event) {
    const key = event.key.toLowerCase();
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", " ", "a", "d", "w", "s"].includes(key)) {
      event.preventDefault();
    }
    if (key === "a" || key === "arrowleft") moveLane(-1);
    else if (key === "d" || key === "arrowright") moveLane(1);
    else if (key === "w" || key === "arrowup" || key === " ") jump();
    else if (key === "s" || key === "arrowdown") slide();
  }

  function bindSwipeControls() {
    let startX = 0;
    let startY = 0;
    let tracking = false;

    dom.canvas.addEventListener("touchstart", event => {
      const touch = event.changedTouches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    }, { passive: true });

    dom.canvas.addEventListener("touchmove", event => {
      if (tracking) event.preventDefault();
    }, { passive: false });

    dom.canvas.addEventListener("touchend", event => {
      if (!tracking) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      tracking = false;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 26) return;
      if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
      else if (dy < 0) jump();
      else slide();
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
    drawBackground(state.view.w, state.view.h);
    drawRunway(state.view.w, state.view.h);
    bindSwipeControls();
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("keydown", handleKeydown);
    dom.startButton.addEventListener("click", resetRun);
    dom.restartButton.addEventListener("click", resetRun);
    dom.reviveButton.addEventListener("click", revive);
    dom.soundToggle.addEventListener("click", () => {
      audio.enabled = !audio.enabled;
      dom.soundToggle.setAttribute("aria-pressed", String(audio.enabled));
      if (audio.enabled) audio.beep(660, 0.06);
    });
    document.documentElement.dataset.trollDashReady = "true";
    requestAnimationFrame(loop);
  }

  init();
})();
