/* ============================================================================
   TROLL CASINO  —  Whale Launch Crash  (room module)

   Elon hosts a crash game: stake $TROLL or USDC, LAUNCH, watch the whale
   climb from 1.00×, and CASH OUT before the hidden crash point rugs the
   round. Optional auto-exit cashes out at a target multiplier.

   THE MATH (between the MODEL markers, node-testable)
   - Crash point ~ classic crash distribution: P(crash ≥ m) = (1 - edge) / m
     with a 4% house edge, so ~4% of rounds rug instantly at 1.00× and the
     median round crashes just under 2×.
   - The crash point is decided by crypto RNG BEFORE the whale moves — the
     animation is presentation, exactly like the wheel.
   - PROVABLY-FAIR SEAM: to make this verifiable later, replace sampleCrash's
     RNG with a committed server seed + client seed hash reveal. One function.

   Money moves only via TrollCasinoWallet; results go through reportRound.
   ============================================================================ */
(() => {
  "use strict";

  /* ==========================================================================
     CRASH MODEL  (pure — keep DOM out of this block)
     ========================================================================== */
  /* MODEL:BEGIN */
  const CR_EDGE = 0.04;          // house edge → instant-rug probability
  const CR_GROWTH = 0.16;        // m(t) = e^(0.16·t) → ~2× at 4.3s, 10× at 14.4s

  function crRand01() {
    const c = (typeof globalThis !== "undefined" && globalThis.crypto) || null;
    if (c && c.getRandomValues) {
      const b = new Uint32Array(1);
      c.getRandomValues(b);
      return b[0] / 4294967296;
    }
    return Math.random();
  }

  // Hidden crash multiplier for one round (≥ 1.00, 2 decimals). Local
  // fallback only — the live game prefers the server-derived, provably-fair
  // point from troll_casino_crash_round (see PROVABLY-FAIR below) and only
  // falls back to this when that RPC is unreachable.
  function sampleCrash(rand = crRand01) {
    const u = rand();
    if (u < CR_EDGE) return 1.00;
    return Math.max(1, Math.floor(100 * (1 - CR_EDGE) / (1 - u)) / 100);
  }

  const multAt = (seconds) => Math.exp(CR_GROWTH * seconds);
  const timeToMult = (m) => Math.log(Math.max(1, m)) / CR_GROWTH;
  /* MODEL:END */

  /* ==========================================================================
     CONSOLE — DOM, chart, round loop.
     ========================================================================== */
  const $ = (sel) => document.querySelector(sel);
  const wallet = () => window.TrollCasinoWallet;
  const audio = () => window.TrollCasino.audio;
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ==========================================================================
     PROVABLY-FAIR — troll_casino_crash_round() (assets/supabase/
     troll_casino_v2.sql) commits a fresh server seed, HMACs it with our
     client seed + a per-user nonce, and hands back the crash point plus the
     seed itself in one call — the seed's hash could only have come from a
     value fixed before it saw our client seed, so nothing here lets the
     server pick a point after the fact. We prefetch the next round while the
     current one plays so LAUNCH never waits on a network round trip; if the
     RPC is ever unreachable we fall back to the local sampleCrash() above
     and label the round "unverified" rather than blocking play.
     ========================================================================== */
  const CLIENT_SEED_KEY = "troll-casino-crash-client-seed";
  function clientSeed() {
    let s = localStorage.getItem(CLIENT_SEED_KEY);
    if (!s) {
      s = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(CLIENT_SEED_KEY, s);
    }
    return s;
  }
  function rerollClientSeed() {
    localStorage.removeItem(CLIENT_SEED_KEY);
    return clientSeed();
  }
  function supa() {
    const a = window.TrollrunnerAccounts;
    return a && a.getClient && a.getClient();
  }
  async function fetchServerRound() {
    const c = supa();
    if (!c) return null;
    try {
      const { data, error } = await c.rpc("troll_casino_crash_round", { p_client_seed: clientSeed() });
      if (error || !data) return null;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !(row.crash_point >= 1)) return null;
      return row;
    } catch (_) { return null; }
  }
  function prefetchRound() { C.nextRound = fetchServerRound(); }

  const ELON = {
    idle: "Launch window is open.",
    counting: "Ignition sequence start.",
    running: "Throttle up. Watch the curve.",
    cashed: "Acceptable exit.",
    bigCash: "To the moon. Literally.",
    crash: "Concerning.",
    instant: "Rapid unscheduled disassembly.",
  };

  const C = {
    phase: "idle",        // idle | counting | running | crashed | cashed
    wager: 0,
    crashPoint: 1,
    mult: 1,
    t0: 0,
    raf: 0,
    points: [],           // [t, m] samples for the curve
    history: [],
    fx: null,
    canvas: null, ctx: null,
    nextRound: null,   // Promise<server round> | null — prefetched provably-fair round
    lastFair: null,    // last round's { server_seed, server_seed_hash, client_seed, nonce } for the Verify link
  };

  /* --- room registration --------------------------------------------------------- */
  window.TrollCasino.registerGame({
    id: "crash", room: "room-crash",
    name: "Whale Launch Crash", emoji: "🚀", color: "#9a5cff",
    host: "Hosted by Elon", tagline: "Ride the whale up. Exit before the rug. Simple.",
    cta: "Approach the console",
    art: "assets/games/troll-casino/art/whale-launch-hero.webp",
    onEnter: () => { setLine(ELON.idle); sizeCanvas(); drawIdle(); prefetchRound(); },
  });

  /* --- markup ----------------------------------------------------------------------- */
  function buildRoom() {
    const room = document.getElementById("room-crash");
    if (!room) return;
    room.innerHTML = `
      <div class="room-hero">
        <div class="rh-art" data-art="assets/games/troll-casino/art/whale-launch-hero.webp"></div>
        <div class="rh-body">
          <span class="rh-kicker">Elon presents</span>
          <h2>Whale Launch Crash</h2>
          <p>A holographic whale, an exponential curve, and one decision: cash out, or get rugged. The crash point is decided before ignition.</p>
          <button type="button" class="rh-enter" data-act="sit">🚀 Approach Console</button>
        </div>
      </div>
      <div class="room-play">
        <div class="room-panel">
          <div class="room-title">
            <h2>🐳 Whale Launch Crash</h2>
            <span class="table-tag">4% edge · median rug ≈ 1.9×</span>
          </div>
          <div class="host-line" style="--hl:#9a5cff">
            <span class="host-face">🚀</span>
            <q id="cr-line">${ELON.idle}</q>
          </div>

          <div class="cr-stage" id="cr-stage">
            <canvas id="crash-canvas" aria-label="Multiplier curve"></canvas>
            <span class="cr-mult" id="cr-mult">1.00×</span>
            <span class="cr-countdown" id="cr-countdown">3</span>
          </div>

          <div class="cr-controls">
            <label class="field-label">Wager
              <input class="num-input" id="cr-wager" type="number" min="1" step="1" inputmode="numeric">
            </label>
            <label class="field-label">Auto exit (×)
              <input class="num-input" id="cr-auto" type="number" min="1.01" step="0.01" placeholder="off">
            </label>
            <button type="button" class="cr-launch" id="cr-button" data-act="launch">🚀 LAUNCH</button>
            <p class="sl-status" id="cr-status">Set a wager, then launch</p>
          </div>

          <div class="cr-history" id="cr-history"><span class="crh-empty">No launches yet</span></div>
          <p class="cr-fair" id="cr-fair"></p>
          <div class="result-banner" id="cr-banner" role="status" aria-live="assertive"></div>
          <canvas id="cr-fx" aria-hidden="true" style="position:absolute;inset:0;pointer-events:none"></canvas>
        </div>
      </div>`;

    const art = room.querySelector(".rh-art");
    const probe = new Image();
    probe.onload = () => { art.style.backgroundImage = `url("${art.dataset.art}")`; art.classList.add("has-art"); };
    probe.src = art.dataset.art;

    C.fx = window.TrollCasino.makeFX(room.querySelector("#cr-fx"));
    C.canvas = room.querySelector("#crash-canvas");
    C.ctx = C.canvas.getContext("2d");
    new ResizeObserver(() => { sizeCanvas(); if (C.phase !== "running") drawIdle(); }).observe(C.canvas);

    room.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn || btn.disabled) return;
      if (btn.dataset.act === "sit") {
        room.classList.add("is-playing");
        seedWagerInput();
        sizeCanvas(); drawIdle();
        if (!(wallet().getBalance() > 0)) showBalanceHint();
      }
      if (btn.dataset.act === "launch") launch();
      if (btn.dataset.act === "cashout") cashOut();
      if (btn.dataset.act === "deposit") window.TrollCasinoMoneyUI?.openDeposit();
    });
  }

  // The #1 confusion at this table: bets spend your DEPOSITED casino balance,
  // not the coins sitting in Phantom — say so instead of a vague "not enough".
  function showBalanceHint() {
    setStatus(`Casino balance: <strong>${wallet().fmt(wallet().getBalance())}</strong> — bets spend deposits,
      not the coins in your Phantom wallet.
      <button type="button" class="cr-add-funds" data-act="deposit">＋ Add funds</button>`);
  }

  function seedWagerInput() {
    const cur = wallet().list().find(c => c.code === wallet().getCurrency());
    const input = $("#cr-wager");
    if (input && !input.value) input.value = cur.chips[1];
  }

  /* --- round flow ---------------------------------------------------------------------- */
  async function launch() {
    if (C.phase !== "idle" && C.phase !== "crashed" && C.phase !== "cashed") return;
    const wager = Math.floor(Number($("#cr-wager").value));
    if (!(wager > 0)) { setStatus("Enter a wager first"); return; }
    if (!wallet().canAfford(wager)) { showBalanceHint(); return; }
    if (!wallet().debit(wager, "Whale Launch wager")) return;

    C.phase = "counting";  // set synchronously so a double-click can't race the await below
    C.wager = wager;
    setButton("counting");
    setStatus(`Wager <strong>${wallet().fmt(wager)}</strong> — ignition…`);

    // Prefer the server-derived provably-fair round prefetched on room
    // entry / after the last round; fall back to local RNG (and say so)
    // only if the RPC never came back.
    const round = C.nextRound ? await C.nextRound : null;
    if (round) {
      C.crashPoint = round.crash_point;
      C.lastFair = round;
    } else {
      C.crashPoint = sampleCrash();
      C.lastFair = null;
    }
    prefetchRound(); // line up the next round while this one plays

    C.mult = 1;
    C.points = [];
    hideBanner();
    audio().ensure();
    setLine(ELON.counting);

    // 3·2·1 countdown, then the whale flies.
    C.phase = "counting";
    const stage = $("#cr-stage");
    stage.classList.remove("is-crashed");
    stage.classList.add("is-counting");
    const counts = REDUCED ? ["GO"] : ["3", "2", "1"];
    let i = 0;
    $("#cr-countdown").textContent = counts[0];
    audio().tick();
    const tick = setInterval(() => {
      if (++i >= counts.length) {
        clearInterval(tick);
        stage.classList.remove("is-counting");
        startRun();
        return;
      }
      $("#cr-countdown").textContent = counts[i];
      audio().tick();
    }, REDUCED ? 350 : 800);
  }

  function startRun() {
    C.phase = "running";
    C.t0 = performance.now();
    setButton("cashout");
    setLine(ELON.running);
    loop();
  }

  function loop() {
    C.raf = requestAnimationFrame(loop);
    const t = (performance.now() - C.t0) / 1000;
    C.mult = multAt(t);
    C.points.push([t, C.mult]);

    const autoAt = Number($("#cr-auto").value);

    // Auto-exit wins any frame-quantization race: if the target sits below the
    // crash point, the player exits there even when one frame jumps past both.
    if (autoAt >= 1.01 && C.mult >= autoAt && autoAt < C.crashPoint) {
      C.mult = autoAt;
      return cashOut(true);
    }
    if (C.mult >= C.crashPoint) {
      C.mult = C.crashPoint;
      return crash();
    }
    $("#cr-mult").textContent = C.mult.toFixed(2) + "×";
    drawCurve(false);
  }

  function cashOut(auto) {
    if (C.phase !== "running") return;
    cancelAnimationFrame(C.raf);
    C.phase = "cashed";
    const m = Math.floor(C.mult * 100) / 100;
    const payout = Math.round(C.wager * m * 100) / 100;
    wallet().credit(payout, `Whale Launch ${m.toFixed(2)}× cashout`);

    $("#cr-mult").textContent = m.toFixed(2) + "×";
    drawCurve(false);
    showBanner("CASHED OUT" + (auto ? " · AUTO" : ""), `+${wallet().fmt(payout)} @ ${m.toFixed(2)}×`, "#3dff8a", true);
    setLine(m >= 10 ? ELON.bigCash : ELON.cashed);
    setStatus(`Cashed <strong>${wallet().fmt(payout)}</strong> — the whale crashed later at ${C.crashPoint.toFixed(2)}×`);
    renderFairness();
    if (m >= 10) { audio().whale(); C.fx.burst(["#3dff8a", "#ffc94d", "#fff"], 70); }
    else { audio().win(); C.fx.burst(["#3dff8a", "#ffc94d"]); }

    pushHistory(C.crashPoint, true);
    window.TrollCasino.reportRound("crash", {
      won: true, mult: Math.round(m * 10) / 10,
      meta: { wager: C.wager, payout, cashedAt: m, crashPoint: C.crashPoint, auto: !!auto },
    });
    setTimeout(() => setButton("launch"), 900);
  }

  function crash() {
    cancelAnimationFrame(C.raf);
    C.phase = "crashed";
    const instant = C.crashPoint <= 1;

    $("#cr-mult").textContent = C.crashPoint.toFixed(2) + "×";
    $("#cr-stage").classList.add("is-crashed");
    drawCurve(true);
    showBanner("RUGGED @ " + C.crashPoint.toFixed(2) + "×", `-${wallet().fmt(C.wager)}`, "#ff3358", false);
    setLine(instant ? ELON.instant : ELON.crash);
    setStatus(`Crashed at <strong>${C.crashPoint.toFixed(2)}×</strong> — wager lost`);
    renderFairness();
    audio().rug();

    pushHistory(C.crashPoint, false);
    window.TrollCasino.reportRound("crash", {
      won: false, mult: 0,
      meta: { wager: C.wager, crashPoint: C.crashPoint, instant },
    });
    setTimeout(() => setButton("launch"), 1100);
  }

  /* --- chart ------------------------------------------------------------------------------ */
  function sizeCanvas() {
    if (!C.canvas) return;
    const rect = C.canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    C.canvas.width = Math.round(rect.width * dpr);
    C.canvas.height = Math.round(rect.height * dpr);
    C.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function chartFrame() {
    const rect = C.canvas.getBoundingClientRect();
    return { w: rect.width, h: rect.height, pad: 26 };
  }

  function drawGrid(w, h, pad, mMax, tMax) {
    const g = C.ctx;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(154, 92, 255, 0.14)";
    g.fillStyle = "rgba(154, 163, 192, 0.6)";
    g.font = '10px "DM Mono", monospace';
    g.lineWidth = 1;
    [1, 1.5, 2, 3, 5, 10, 20, 50, 100].filter(m => m <= mMax).forEach(m => {
      const y = h - pad - ((m - 1) / (mMax - 1)) * (h - pad * 2);
      g.beginPath(); g.moveTo(pad, y); g.lineTo(w - pad, y); g.stroke();
      g.fillText(m + "×", 4, y + 3);
    });
    for (let s = 0; s <= tMax; s += Math.max(1, Math.ceil(tMax / 8))) {
      const x = pad + (s / tMax) * (w - pad * 2);
      g.beginPath(); g.moveTo(x, pad); g.lineTo(x, h - pad); g.stroke();
    }
  }

  function drawIdle() {
    if (!C.ctx) return;
    const { w, h, pad } = chartFrame();
    drawGrid(w, h, pad, 3, 8);
    C.ctx.fillStyle = "rgba(154, 92, 255, 0.8)";
    C.ctx.font = '13px "DM Mono", monospace';
    C.ctx.fillText("awaiting launch…", pad + 8, h / 2);
  }

  function drawCurve(crashed) {
    const { w, h, pad } = chartFrame();
    const t = C.points.length ? C.points[C.points.length - 1][0] : 0;
    const tMax = Math.max(6, t * 1.15);
    const mMax = Math.max(2, C.mult * 1.3);
    drawGrid(w, h, pad, mMax, tMax);

    const X = (tt) => pad + (tt / tMax) * (w - pad * 2);
    const Y = (mm) => h - pad - ((mm - 1) / (mMax - 1)) * (h - pad * 2);

    const g = C.ctx;
    g.beginPath();
    g.moveTo(X(0), Y(1));
    for (const [tt, mm] of C.points) g.lineTo(X(tt), Y(mm));
    g.strokeStyle = crashed ? "#ff3358" : "#3dff8a";
    g.lineWidth = 3;
    g.shadowColor = crashed ? "#ff3358" : "#3dff8a";
    g.shadowBlur = 14;
    g.stroke();
    g.shadowBlur = 0;

    // whale at the tip (burst if crashed)
    const tipX = X(t), tipY = Y(C.mult);
    g.font = "22px serif";
    g.textAlign = "center";
    g.fillText(crashed ? "💥" : "🐳", tipX, tipY - 6);
    g.textAlign = "left";
  }

  /* --- small renderers ---------------------------------------------------------------------- */
  function setButton(mode) {
    const btn = $("#cr-button");
    if (mode === "launch") {
      C.phase = C.phase === "running" ? C.phase : "idle";
      btn.dataset.act = "launch";
      btn.textContent = "🚀 LAUNCH";
      btn.classList.remove("is-cashout");
      btn.disabled = false;
      $("#cr-wager").disabled = false;
    } else if (mode === "counting") {
      btn.disabled = true;
      $("#cr-wager").disabled = true;
    } else if (mode === "cashout") {
      btn.dataset.act = "cashout";
      btn.textContent = "💰 CASH OUT";
      btn.classList.add("is-cashout");
      btn.disabled = false;
    }
  }

  function pushHistory(point, cashed) {
    C.history.unshift({ point, cashed });
    C.history.length = Math.min(C.history.length, 12);
    $("#cr-history").innerHTML = C.history.map(hh =>
      `<span class="${hh.point >= 10 ? "is-great" : hh.point >= 2 ? "is-good" : ""}"
             title="${hh.cashed ? "you cashed out" : "rugged"}">${hh.point.toFixed(2)}×</span>`).join("");
  }

  function setLine(text) { const el = $("#cr-line"); if (el) el.textContent = text; }
  function setStatus(html) { const el = $("#cr-status"); if (el) el.innerHTML = html; }

  function renderFairness() {
    const el = $("#cr-fair");
    if (!el) return;
    if (!C.lastFair) { el.textContent = "This launch used local fallback RNG — the fairness log was unreachable."; return; }
    const f = C.lastFair;
    el.innerHTML = `Provably fair · seed hash <code>${f.server_seed_hash.slice(0, 12)}…</code> ·
      <button type="button" class="cr-fair-toggle" data-act="fair">show seed to verify</button>`;
    el.querySelector("[data-act=fair]")?.addEventListener("click", () => {
      el.innerHTML = `Server seed <code>${f.server_seed}</code> hashes (SHA-256) to
        <code>${f.server_seed_hash}</code> · client seed <code>${f.client_seed}</code> ·
        nonce <code>${f.nonce}</code> → HMAC-SHA256(client:nonce, server) → ${f.crash_point.toFixed(2)}×.
        <button type="button" class="cr-fair-toggle" data-act="reroll">reroll my client seed</button>`;
      el.querySelector("[data-act=reroll]")?.addEventListener("click", () => { rerollClientSeed(); prefetchRound(); renderFairness(); });
    });
  }

  function showBanner(title, sub, color, isWin) {
    const el = $("#cr-banner");
    el.style.setProperty("--rb", color);
    el.innerHTML = `<span class="rb-zone">${title}</span>
      <span class="rb-payout ${isWin ? "is-win" : "is-loss"}">${sub}</span>`;
    el.classList.add("is-shown");
    clearTimeout(el._t);
    el._t = setTimeout(hideBanner, 2600);
  }
  function hideBanner() { $("#cr-banner")?.classList.remove("is-shown"); }

  document.addEventListener("DOMContentLoaded", buildRoom);

  window.TrollCasinoCrash = { CR_EDGE, CR_GROWTH, sampleCrash, multAt, timeToMult };
})();
