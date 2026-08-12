/* ============================================================================
   TROLL CASINO  —  Troll Wheel (core game)  →  window.TrollCasino

   A custom 24-segment money wheel, not a roulette clone. Players stake $TROLL
   or USDC (via TrollCasinoWallet) on zones; one crypto-RNG spin decides all.

   THE WHEEL (counts are computed from SEGMENTS at render time — the paytable
   can never drift from reality):
     TROLL        ×2   · 11 segments
     DOUBLE TROLL ×3   ·  7 segments
     TRIPLE TROLL ×5   ·  4 segments
     WHALE        ×20  ·  1 segment
     RUG PULL     house·  1 segment  (not bettable — every stake gets rugged)

   "Pays ×N" returns stake × N total (stake is debited up front), so the wheel
   keeps a house edge of ~8–17% per zone. The house always trolls.

   MODULE MAP (this file only — scenes/wallet/leaderboard live in siblings):
     WHEEL MODEL   pure math, no DOM (node-testable between MODEL markers)
     AudioFX       tiny WebAudio synth — no audio files needed
     WheelRenderer offscreen static wheel, rotated blit + rim LEDs
     FX            canvas coin-burst particles on wins
     TABLE         bet staging, controls, spin flow, results, integrations

   ADDING A GAME MODE LATER (slots / blackjack / crash):
     TrollCasino.registerGame({ id, name, live:false }) lists it under "More
     tables". When it's real: give it its own panel + module file, register
     with live:true and a mount() callback. See docs/TROLL-CASINO.md.
   ============================================================================ */
(() => {
  "use strict";
  if (window.TrollCasino) return;   // singleton

  /* ==========================================================================
     WHEEL MODEL  (pure — keep DOM out of this block)
     ========================================================================== */
  /* MODEL:BEGIN */
  const ZONES = {
    troll:  { id: "troll",  label: "TROLL",        pays: 2,  color: "#3dff8a", ink: "#04120a", bettable: true },
    double: { id: "double", label: "DOUBLE TROLL", pays: 3,  color: "#9a5cff", ink: "#f4edff", bettable: true },
    triple: { id: "triple", label: "TRIPLE TROLL", pays: 5,  color: "#3ea8ff", ink: "#eaf6ff", bettable: true },
    whale:  { id: "whale",  label: "WHALE",        pays: 20, color: "#ffc94d", ink: "#241500", bettable: true },
    rug:    { id: "rug",    label: "RUG PULL",     pays: 0,  color: "#ff3358", ink: "#fff", bettable: false },
  };

  // 24 segments, no two identical neighbours (including the 23→0 wrap).
  const SEGMENTS = [
    "troll", "double", "troll", "double", "troll", "triple", "troll", "double",
    "triple", "double", "troll", "triple", "troll", "double", "troll", "whale",
    "troll", "double", "troll", "triple", "troll", "double", "troll", "rug",
  ];

  function zoneCounts() {
    const c = {};
    for (const z of SEGMENTS) c[z] = (c[z] || 0) + 1;
    return c;
  }

  // bets: { zoneId: stake } → outcome for a landed segment index.
  function resolveSpin(bets, segmentIndex) {
    const zoneId = SEGMENTS[segmentIndex];
    const zone = ZONES[zoneId];
    const totalStaked = Object.values(bets).reduce((a, b) => a + (b || 0), 0);
    const winningStake = zone.bettable ? (bets[zoneId] || 0) : 0;
    const payout = winningStake * zone.pays;
    return {
      zoneId, zone, segmentIndex, totalStaked, payout,
      net: payout - totalStaked,
      won: payout > 0,
    };
  }

  // Shared secure RNG — same shape as blackjack.js's rand01, slots.js's
  // slRand01, crash.js's crRand01. Kept duplicated on purpose (each MODEL
  // block stays a dependency-free, node-testable unit) — if you touch the
  // algorithm here, mirror the change in the other three files' RNG helper.
  function secureRandom01() {
    const c = (typeof globalThis !== "undefined" && globalThis.crypto) || null;
    if (c && c.getRandomValues) {
      const buf = new Uint32Array(1);
      c.getRandomValues(buf);
      return buf[0] / 4294967296;
    }
    return Math.random();
  }
  function secureRandomInt(n) {
    const c = (typeof globalThis !== "undefined" && globalThis.crypto) || null;
    if (c && c.getRandomValues && n > 0 && n <= 256) {
      // Rejection sampling keeps the distribution exactly uniform over n.
      const limit = Math.floor(256 / n) * n;
      const buf = new Uint8Array(1);
      do { c.getRandomValues(buf); } while (buf[0] >= limit);
      return buf[0] % n;
    }
    return Math.floor(secureRandom01() * n);
  }
  function secureRandomSegment() {
    return secureRandomInt(SEGMENTS.length);
  }
  /* MODEL:END */

  const SEG_COUNT = SEGMENTS.length;
  const SEG_ANGLE = (Math.PI * 2) / SEG_COUNT;
  const REDUCED = typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ==========================================================================
     AudioFX — oscillator bleeps so the table is sound-ready with zero assets.
     Real SFX later: swap each cue's body for an <audio>/buffer play call.
     ========================================================================== */
  const AudioFX = {
    ctx: null,
    muted: localStorage.getItem("tc-sound") === "off",
    ensure() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },
    blip(freq, dur = 0.06, type = "square", gain = 0.05, when = 0) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type; osc.frequency.value = freq;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t); osc.stop(t + dur + 0.02);
    },
    tick()  { this.blip(1500, 0.03, "square", 0.03); },
    chip()  { this.blip(420, 0.05, "triangle", 0.06); this.blip(640, 0.04, "triangle", 0.04, 0.03); },
    win()   { [523, 659, 784, 1047].forEach((f, i) => this.blip(f, 0.14, "triangle", 0.07, i * 0.09)); },
    whale() { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => this.blip(f, 0.18, "sawtooth", 0.06, i * 0.08)); },
    rug()   { [330, 262, 196, 131].forEach((f, i) => this.blip(f, 0.16, "sawtooth", 0.05, i * 0.1)); },
    toggle() {
      this.muted = !this.muted;
      localStorage.setItem("tc-sound", this.muted ? "off" : "on");
      return !this.muted;
    },
  };

  /* ==========================================================================
     WheelRenderer — draws the static wheel once per resize into an offscreen
     canvas, then blits it rotated every frame. Rim ring + LEDs stay fixed.
     ========================================================================== */
  function makeRenderer(canvas) {
    const ctx = canvas.getContext("2d");
    let size = 0, dpr = 1, wheelBmp = null;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = Math.round(rect.width * dpr);
      canvas.width = size; canvas.height = size;
      wheelBmp = buildWheel();
    }

    function buildWheel() {
      const off = document.createElement("canvas");
      off.width = size; off.height = size;
      const c = off.getContext("2d");
      const cx = size / 2, r = size / 2;
      const rimW = r * 0.085;
      const inner = r * 0.30;

      c.translate(cx, cx);
      // Segment 0's CENTER points up when rotation is 0.
      c.rotate(-Math.PI / 2 - SEG_ANGLE / 2);

      for (let i = 0; i < SEG_COUNT; i++) {
        const zone = ZONES[SEGMENTS[i]];
        const a0 = i * SEG_ANGLE, a1 = a0 + SEG_ANGLE;

        c.beginPath();
        c.moveTo(0, 0);
        c.arc(0, 0, r - rimW, a0, a1);
        c.closePath();
        const grad = c.createRadialGradient(0, 0, inner, 0, 0, r - rimW);
        grad.addColorStop(0, shade(zone.color, -0.45));
        grad.addColorStop(1, zone.color);
        c.fillStyle = grad;
        c.fill();
        c.strokeStyle = "rgba(3,0,6,0.85)";
        c.lineWidth = Math.max(1, size * 0.004);
        c.stroke();

        // Label along the segment's center radius, reading outward.
        const mid = a0 + SEG_ANGLE / 2;
        c.save();
        c.rotate(mid);
        c.textAlign = "right";
        c.textBaseline = "middle";
        c.fillStyle = zone.ink;
        const px = Math.max(10, size * 0.032);
        c.font = `700 ${px}px "DM Mono", monospace`;
        c.fillText(zone.pays ? `×${zone.pays}` : "RUG", r - rimW - size * 0.02, 0);
        if (SEGMENTS[i] === "whale") {
          c.font = `${px * 1.1}px serif`;
          c.fillText("🐳", r - rimW - size * 0.085, 0);
        }
        c.restore();
      }

      // Hub — dark disc, neon edge, the mascot.
      c.rotate(Math.PI / 2 + SEG_ANGLE / 2);   // undo, so hub text is upright
      c.beginPath(); c.arc(0, 0, inner, 0, Math.PI * 2);
      c.fillStyle = "#0a0614"; c.fill();
      c.lineWidth = Math.max(2, size * 0.006);
      c.strokeStyle = "#3dff8a"; c.stroke();
      c.textAlign = "center"; c.textBaseline = "middle";
      c.font = `${inner * 0.7}px serif`;
      c.fillText("😏", 0, -inner * 0.12);
      c.fillStyle = "#9aa3c0";
      c.font = `700 ${Math.max(8, size * 0.024)}px "DM Mono", monospace`;
      c.fillText("TROLL WHEEL", 0, inner * 0.52);
      return off;
    }

    function shade(hex, amt) {   // darken (-) / lighten (+) a #rrggbb color
      const n = parseInt(hex.slice(1), 16);
      const ch = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
      return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
    }

    function draw(rotation) {
      if (!wheelBmp) return;
      const cx = size / 2, r = size / 2;
      ctx.clearRect(0, 0, size, size);

      ctx.save();
      ctx.translate(cx, cx);
      ctx.rotate(rotation);
      ctx.drawImage(wheelBmp, -cx, -cx);
      ctx.restore();

      // Fixed rim: dark ring + LED dots (one per segment boundary).
      ctx.save();
      ctx.translate(cx, cx);
      ctx.beginPath(); ctx.arc(0, 0, r - r * 0.042, 0, Math.PI * 2);
      ctx.lineWidth = r * 0.085;
      ctx.strokeStyle = "#0c0716";
      ctx.stroke();
      for (let i = 0; i < SEG_COUNT; i++) {
        const a = i * SEG_ANGLE;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * (r - r * 0.042), Math.sin(a) * (r - r * 0.042), r * 0.014, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 ? "#3dff8a" : "#ffc94d";
        ctx.fill();
      }
      ctx.restore();
    }

    return { resize, draw, get size() { return size; } };
  }

  /* ==========================================================================
     FX — coin-burst particles over the wheel on a win.
     ========================================================================== */
  function makeFX(canvas) {
    const ctx = canvas.getContext("2d");
    let parts = [], raf = 0;

    function burst(colors, n = 42) {
      if (REDUCED) return;
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width; canvas.height = rect.height;
      const cx = rect.width / 2, cy = rect.height / 2;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 3 + Math.random() * 6;
        parts.push({
          x: cx, y: cy,
          vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3,
          r: 3 + Math.random() * 5,
          color: colors[i % colors.length],
          life: 1,
        });
      }
      if (!raf) loop();
    }
    function loop() {
      raf = requestAnimationFrame(loop);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      parts = parts.filter(p => p.life > 0);
      if (!parts.length) { cancelAnimationFrame(raf); raf = 0; return; }
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.life -= 0.016;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.r, p.r * 0.65, p.vx * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    return { burst };
  }

  /* ==========================================================================
     TABLE — DOM wiring, bet staging, the spin flow, integrations.
     ========================================================================== */
  const $ = (sel) => document.querySelector(sel);
  const wallet = () => window.TrollCasinoWallet;

  const table = {
    staged: {},          // zoneId -> stake (in current currency)
    lastBets: null,
    chipValue: 0,
    spinning: false,
    rotation: 0,
    renderer: null,
    fx: null,
    statusTimer: 0,
  };

  const stakedTotal = () => Object.values(table.staged).reduce((a, b) => a + b, 0);

  function init() {
    const canvas = $("#wheel-canvas");
    if (!canvas || !wallet()) return;

    table.renderer = makeRenderer(canvas);
    table.fx = makeFX($("#fx-canvas"));
    new ResizeObserver(() => { table.renderer.resize(); table.renderer.draw(table.rotation); })
      .observe(canvas);

    buildBetBoard();
    buildChipRack();
    buildPaytable();
    renderFloor();
    renderMoreTables();
    bindControls();
    $("#back-to-floor")?.addEventListener("click", backToFloor);

    wallet().onChange(renderWallet);
    wallet().mountWalletChip("#wallet-mount");
    renderStakes();

    // Idle drift so the table feels alive between spins.
    if (!REDUCED) idleDrift();

    // Scene engine handoff: the walkthrough always lands on the casino floor.
    window.TrollCasinoScenes?.on("gameplay", () => {
      if (activeRoom) backToFloor();
      requestAnimationFrame(() => { table.renderer.resize(); table.renderer.draw(table.rotation); });
    });
  }

  function idleDrift() {
    let last = performance.now();
    (function tick(now) {
      requestAnimationFrame(tick);
      const dt = now - last; last = now;
      if (table.spinning || document.hidden) return;
      table.rotation += dt * 0.00004;
      table.renderer.draw(table.rotation);
    })(last);
  }

  /* --- build UI from the model (counts/odds computed, never hardcoded) ------ */
  function bettableZones() { return Object.values(ZONES).filter(z => z.bettable); }

  function buildBetBoard() {
    const counts = zoneCounts();
    const board = $("#bet-board");
    board.innerHTML = bettableZones().map(z => `
      <button type="button" class="bet-zone" data-zone="${z.id}"
              aria-label="Bet on ${z.label} — pays ${z.pays} times, ${counts[z.id]} of ${SEG_COUNT} segments">
        <span class="bz-name">${z.label}</span>
        <span class="bz-pays">×${z.pays}</span>
        <span class="bz-odds">${counts[z.id]}/${SEG_COUNT} segments</span>
        <span class="bz-stake" data-stake>—</span>
      </button>`).join("");
    board.addEventListener("click", (e) => {
      const btn = e.target.closest(".bet-zone");
      if (btn) placeBet(btn.dataset.zone);
    });
  }

  function buildChipRack() {
    const cur = wallet().list().find(c => c.code === wallet().getCurrency());
    table.chipValue = cur.chips[1];
    const rack = $("#chip-rack");
    rack.innerHTML = cur.chips.map(v => `
      <button type="button" class="chip-btn${v === table.chipValue ? " is-selected" : ""}"
              style="--chip:${cur.color}" data-value="${v}"
              aria-label="Select ${v} ${cur.label} chip" aria-pressed="${v === table.chipValue}">
        ${v >= 1000 ? (v / 1000) + "K" : v}
      </button>`).join("");
    rack.querySelectorAll(".chip-btn").forEach(btn => btn.addEventListener("click", () => {
      table.chipValue = Number(btn.dataset.value);
      rack.querySelectorAll(".chip-btn").forEach(b => {
        b.classList.toggle("is-selected", b === btn);
        b.setAttribute("aria-pressed", String(b === btn));
      });
      AudioFX.ensure(); AudioFX.chip();
    }));
  }

  function buildPaytable() {
    const counts = zoneCounts();
    $("#paytable").innerHTML = Object.values(ZONES).map(z => `
      <li>
        <span class="pt-dot" style="background:${z.color};box-shadow:0 0 8px ${z.color}"></span>
        <span class="pt-name">${z.label}</span>
        <span class="pt-odds">${counts[z.id]}/${SEG_COUNT}</span>
        <span class="pt-pays" style="color:${z.color}">${z.bettable ? "×" + z.pays : "house"}</span>
      </li>`).join("");
  }

  /* --- bet staging ------------------------------------------------------------ */
  function placeBet(zoneId) {
    if (table.spinning) return;
    AudioFX.ensure();
    const add = table.chipValue;
    if (!wallet().canAfford(stakedTotal() + add)) {
      const label = wallet().list().find(c => c.code === wallet().getCurrency()).label;
      flashStatus(`Not enough ${label} — lower the stake or add funds`);
      AudioFX.rug();
      return;
    }
    table.staged[zoneId] = (table.staged[zoneId] || 0) + add;
    AudioFX.chip();
    renderStakes();
  }

  function clearBets(silent) {
    table.staged = {};
    renderStakes();
    if (!silent) flashStatus("Bets cleared");
  }

  function rebet() {
    if (table.spinning || !table.lastBets) return;
    const total = Object.values(table.lastBets).reduce((a, b) => a + b, 0);
    if (!wallet().canAfford(total)) { flashStatus("Can't rebet — balance too low"); return; }
    table.staged = { ...table.lastBets };
    AudioFX.ensure(); AudioFX.chip();
    renderStakes();
  }

  /* --- the spin ----------------------------------------------------------------
     Stake debit + segment pick + payout credit happen atomically server-side
     (troll_casino_wheel_spin) — the wheel only animates to whatever segment
     the server already decided and already paid out. resolveSpin() below is
     still used, but purely to re-derive the same zone/payout display values
     from data the server returned, not to decide anything itself. */
  async function spin() {
    if (table.spinning) return;
    const total = stakedTotal();
    if (!total) { flashStatus("Place a bet first — tap a zone"); return; }
    if (!wallet().canAfford(total, wallet().getCurrency())) { flashStatus("Not enough balance"); return; }

    table.spinning = true;
    setControlsLocked(true);
    hideBanner();
    AudioFX.ensure();

    const res = await wallet().playWheel({ ...table.staged }, wallet().getCurrency());
    if (!res.ok) {
      table.spinning = false;
      setControlsLocked(false);
      flashStatus(res.message || "Spin failed — try again.");
      return;
    }

    await animateTo(res.segmentIndex);

    const result = resolveSpin(table.staged, res.segmentIndex);
    settle(result);

    table.lastBets = { ...table.staged };
    table.staged = {};
    table.spinning = false;
    setControlsLocked(false);
    renderStakes();
  }

  function animateTo(target) {
    return new Promise(resolve => {
      // Land the target segment's center under the pointer, ± a natural jitter.
      const jitter = (Math.random() - 0.5) * SEG_ANGLE * 0.7;
      const base = -(target * SEG_ANGLE) - jitter;
      const turns = REDUCED ? 1 : 5 + Math.floor(Math.random() * 2);
      const twoPi = Math.PI * 2;
      const start = table.rotation;
      // Normalize so we always travel forward `turns` full rotations to base.
      const delta = ((base - start) % twoPi + twoPi) % twoPi + turns * twoPi;
      const dur = REDUCED ? 900 : 5200 + Math.random() * 600;
      const t0 = performance.now();
      let lastSeg = -1;

      (function frame(now) {
        const t = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - t, 4);          // fast launch, long dramatic settle
        table.rotation = start + delta * eased;
        table.renderer.draw(table.rotation);

        const seg = Math.round(((-table.rotation / SEG_ANGLE) % SEG_COUNT + SEG_COUNT)) % SEG_COUNT;
        if (seg !== lastSeg) { AudioFX.tick(); lastSeg = seg; }

        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      })(t0);
    });
  }

  /* --- settlement + integrations ----------------------------------------------- */
  function settle(result) {
    const { zone, zoneId, payout, totalStaked, won } = result;

    // Balance already changed server-side inside wallet().playWheel() —
    // this only renders the outcome, it must not credit again.

    // Banner + zone flash + sound + coins.
    showBanner(result);
    const zoneBtn = document.querySelector(`.bet-zone[data-zone="${zoneId}"]`);
    if (zoneBtn) {
      zoneBtn.classList.remove("is-hit");
      void zoneBtn.offsetWidth;                        // restart the animation
      zoneBtn.classList.add("is-hit");
    }
    if (zoneId === "rug") AudioFX.rug();
    else if (won && zoneId === "whale") { AudioFX.whale(); table.fx.burst([zone.color, "#ffc94d", "#fff"], 80); }
    else if (won) { AudioFX.win(); table.fx.burst([zone.color, "#ffc94d"]); }
    else AudioFX.rug();

    pushOutcome(zone);

    // Shared ladder + XP, same call every casino game makes.
    reportRound("wheel", { won, mult: zone.pays, zone: zoneId, meta: { staked: totalStaked, payout } });
  }

  function showBanner(result) {
    const el = $("#result-banner");
    const { zone, payout, totalStaked } = result;
    const msg = result.zoneId === "rug"
      ? `Rugged. ${wallet().fmt(totalStaked)} gone. Problem?`
      : result.won
        ? `+${wallet().fmt(payout)}`
        : `No hit — ${wallet().fmt(totalStaked)} to the house`;
    el.style.setProperty("--rb", zone.color);
    el.innerHTML =
      `<span class="rb-zone">${zone.label}</span>` +
      `<span class="rb-payout ${result.won ? "is-win" : "is-loss"}">${msg}</span>`;
    el.classList.add("is-shown");
    clearTimeout(el._t);
    el._t = setTimeout(hideBanner, 3400);
  }
  function hideBanner() { $("#result-banner").classList.remove("is-shown"); }

  function pushOutcome(zone) {
    const strip = $("#outcome-strip");
    strip.querySelector(".os-empty")?.remove();
    const dot = document.createElement("span");
    dot.style.setProperty("--o", zone.color);
    dot.title = zone.label;
    strip.prepend(dot);
    while (strip.children.length > 14) strip.lastChild.remove();
  }

  /* --- rendering ----------------------------------------------------------------- */
  function renderWallet(s) {
    document.querySelectorAll(".balance-chip").forEach(chip => {
      const cur = chip.dataset.cur;
      chip.querySelector("strong").textContent =
        (s.balances[cur] ?? 0).toLocaleString("en-US", { maximumFractionDigits: cur === "USDC" ? 2 : 0 });
      chip.classList.toggle("is-active", cur === s.currency);
    });
    document.querySelectorAll(".cur-toggle button").forEach(b =>
      b.setAttribute("aria-pressed", String(b.dataset.cur === s.currency)));

    const list = $("#activity-list");
    if (list) {
      list.innerHTML = s.history.length
        ? s.history.slice(0, 12).map(h => `
            <li><span>${h.label}</span>
                <span class="${h.amount > 0 ? "amt-win" : h.amount < 0 ? "amt-loss" : ""}">
                  ${h.amount > 0 ? "+" : ""}${wallet().fmt(h.amount, h.currency)}
                </span></li>`).join("")
        : `<li><span>No plays yet</span><span>—</span></li>`;
    }
  }

  function renderStakes() {
    document.querySelectorAll(".bet-zone").forEach(btn => {
      const stake = table.staged[btn.dataset.zone] || 0;
      btn.classList.toggle("has-stake", stake > 0);
      btn.querySelector("[data-stake]").textContent = stake > 0 ? wallet().fmt(stake) : "—";
    });
    updateStatus();
    $("#rebet-btn").disabled = table.spinning || !table.lastBets;
    $("#clear-btn").disabled = table.spinning || !stakedTotal();
  }

  function updateStatus() {
    $("#table-status").innerHTML = `Total staked: <strong>${wallet().fmt(stakedTotal())}</strong>`;
  }
  function flashStatus(msg) {
    const el = $("#table-status");
    el.textContent = msg;
    clearTimeout(table.statusTimer);
    table.statusTimer = setTimeout(updateStatus, 2200);
  }

  function setControlsLocked(locked) {
    $("#spin-btn").disabled = locked;
    $("#clear-btn").disabled = locked || !stakedTotal();
    $("#rebet-btn").disabled = locked || !table.lastBets;
    document.querySelectorAll(".bet-zone, .chip-btn, .cur-toggle button")
      .forEach(b => { b.disabled = locked; });
  }

  /* --- controls --------------------------------------------------------------- */
  function bindControls() {
    $("#spin-btn").addEventListener("click", spin);
    $("#clear-btn").addEventListener("click", () => clearBets());
    $("#rebet-btn").addEventListener("click", rebet);

    document.querySelectorAll(".cur-toggle button").forEach(btn =>
      btn.addEventListener("click", () => {
        if (btn.dataset.cur === wallet().getCurrency()) return;
        clearBets(true);
        wallet().setCurrency(btn.dataset.cur);
        buildChipRack();
        renderStakes();
        flashStatus(`Now betting in ${btn.dataset.cur === "TROLL" ? "$TROLL" : "USDC"}`);
      }));

    // Balance chips double as currency shortcuts.
    document.querySelectorAll(".balance-chip").forEach(chip =>
      chip.addEventListener("click", () => {
        if (chip.dataset.cur === wallet().getCurrency() || table.spinning) return;
        clearBets(true);
        wallet().setCurrency(chip.dataset.cur);
        buildChipRack();
        renderStakes();
      }));

    // One sound state for the whole page: the synth SFX and the scene-video
    // ambience both follow this toggle.
    const sound = $("#sound-toggle");
    sound.setAttribute("aria-pressed", String(!AudioFX.muted));
    window.TrollCasinoScenes?.setAudio(!AudioFX.muted);
    sound.addEventListener("click", () => {
      AudioFX.ensure();
      const on = AudioFX.toggle();
      sound.setAttribute("aria-pressed", String(on));
      window.TrollCasinoScenes?.setAudio(on);
    });

    $("#replay-intro").addEventListener("click", () => window.TrollCasinoScenes?.replayIntro());

    $("#deposit-btn")?.addEventListener("click", () => window.TrollCasinoMoneyUI?.openDeposit());
    $("#redeem-btn")?.addEventListener("click", () => window.TrollCasinoMoneyUI?.openRedeem());
    $("#statement-btn")?.addEventListener("click", () => window.TrollCasinoMoneyUI?.openStatement());
    $("#limits-btn")?.addEventListener("click", () => window.TrollCasinoMoneyUI?.openLimits());
  }

  /* ==========================================================================
     CASINO FLOOR + GAME ROOMS
     Every game — this wheel included — registers itself here. The floor view
     is the lobby the walkthrough lands on; openRoom()/backToFloor() swap
     between it and a game's <section class="game-room">. Sibling modules
     (blackjack.js / slots.js / crash.js) call TrollCasino.registerGame at
     script-eval time (before DOMContentLoaded), so the floor renders complete.

     def shape: { id, room, name, emoji, color, host, tagline, cta, art,
                  onEnter?(), onLeave?() }
     ========================================================================== */
  const gameRegistry = new Map();
  let activeRoom = null;

  function registerGame(def) {
    if (!def?.id) return;
    gameRegistry.set(def.id, def);
  }

  function renderFloor() {
    const floor = $("#floor-view");
    if (!floor) return;
    floor.innerHTML =
      `<div class="floor-head">
         <p class="floor-kicker">Casino floor</p>
         <h2>Pick a table</h2>
       </div>` +
      `<div class="floor-grid">` +
      [...gameRegistry.values()].map(g => `
        <button type="button" class="floor-card" data-game="${g.id}" style="--fc:${g.color}">
          <span class="fc-art" data-art aria-hidden="true"><span class="fc-emoji">${g.emoji}</span></span>
          <span class="fc-body">
            <span class="fc-host">${g.host}</span>
            <strong class="fc-name">${g.name}</strong>
            <span class="fc-tag">${g.tagline}</span>
            <span class="fc-boot">▶ ${g.cta || "Play"}</span>
          </span>
        </button>`).join("") +
      `</div>`;

    // Hero-art probes — cards keep their gradient+emoji tile until art exists.
    gameRegistry.forEach(g => {
      if (!g.art) return;
      const tile = floor.querySelector(`[data-game="${g.id}"] [data-art]`);
      const probe = new Image();
      probe.onload = () => { tile.style.backgroundImage = `url("${g.art}")`; tile.classList.add("has-art"); };
      probe.src = g.art;
    });

    floor.addEventListener("click", (e) => {
      const card = e.target.closest(".floor-card");
      if (card) openRoom(card.dataset.game);
    });
  }

  function roomEl(def) { return def && def.room ? document.getElementById(def.room) : null; }

  function openRoom(id) {
    const def = gameRegistry.get(id);
    const el = roomEl(def);
    if (!el) return;
    if (activeRoom) backToFloor();
    $("#floor-view").hidden = true;
    el.hidden = false;
    el.classList.add("is-active");
    const back = $("#back-to-floor");
    if (back) back.hidden = false;
    activeRoom = id;
    AudioFX.ensure(); AudioFX.chip();
    try { def.onEnter && def.onEnter(); } catch (_) {}
    // One click on the floor card means "play" — auto-sit past the room's
    // hero CTA so nobody has to scroll down and click a second button.
    if (!el.classList.contains("is-playing")) {
      el.querySelector('.room-hero [data-act="sit"]')?.click();
    }
  }

  function backToFloor() {
    const def = gameRegistry.get(activeRoom);
    const el = roomEl(def);
    if (el) { el.hidden = true; el.classList.remove("is-active"); }
    try { def && def.onLeave && def.onLeave(); } catch (_) {}
    activeRoom = null;
    $("#floor-view").hidden = false;
    const back = $("#back-to-floor");
    if (back) back.hidden = true;
  }

  // Side-rail quick links from the wheel room to the other tables.
  function renderMoreTables() {
    const el = $("#more-tables");
    if (!el) return;
    el.innerHTML = [...gameRegistry.values()]
      .filter(g => g.id !== "wheel")
      .map(g => `<button type="button" class="mt-link" data-room="${g.id}">${g.emoji} ${g.name}</button>`)
      .join("") || `<span>More tables soon</span>`;
    el.addEventListener("click", (e) => {
      const btn = e.target.closest(".mt-link");
      if (btn) openRoom(btn.dataset.room);
    });
  }

  /* --------------------------------------------------------------------------
     reportRound — the ONE integration call for every casino game's finished
     round. Feeds the shared weekly ladder + real per-account XP identically
     for wheel/blackjack/slots/crash. mult = payout multiple (0 on a loss).
     -------------------------------------------------------------------------- */
  function reportRound(game, { won, mult, zone, meta }) {
    window.TrollLeaderboard?.record("troll-casino", {
      won: !!won, mult: won ? mult : 0, zone: zone || game,
    });
    void window.TrollrunnerAccounts?.reportGameResult?.("troll-casino",
      won ? Math.round(mult * 100) : 0,
      Object.assign({ game, won, currency: wallet().getCurrency() }, meta || {}));
  }

  // The wheel is a room like any other game.
  registerGame({
    id: "wheel", room: "room-wheel",
    name: "Troll Wheel", emoji: "😏", color: "#3dff8a",
    host: "Hosted by Trollface", tagline: "24 segments. One rug. The house always trolls.",
    cta: "Spin the wheel",
    art: "assets/games/troll-casino/scenes/scene-05-first-person-wheel.png",
    onEnter: () => requestAnimationFrame(() => { table.renderer.resize(); table.renderer.draw(table.rotation); }),
  });

  /* --- boot ---------------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", init);

  window.TrollCasino = {
    registerGame, openRoom, backToFloor, reportRound,
    audio: AudioFX, makeFX,
    rng: { random01: secureRandom01, randomInt: secureRandomInt },
    spin,
    model: { ZONES, SEGMENTS, zoneCounts, resolveSpin },
  };
})();
