/* ============================================================================
   TROLL CASINO  —  Doge Jackpot Reels  (room module)

   A 5×3 slot hosted by Doge: 10 fixed paylines, weighted symbols, Doge-in-
   sunglasses WILD, rocket SCATTER (pays anywhere, on total bet), and a
   tiered progressive jackpot fed by every spin (Gold Doge, scatter-style):
       3 × 🐕 anywhere → MINOR  (25% of the meter)
       4 × 🐕 anywhere → MAJOR  (60% of the meter)
       5 × 🐕 anywhere → GRAND  (the whole meter, meter reseeds)

   The meter is a REAL shared progressive (troll_casino_jackpot in Supabase,
   per currency) — every player's spin feeds the same pool, and a win pays
   real balance. Money moves only via TrollCasinoWallet; results go through
   reportRound.

   The math sits between the MODEL markers (pure, node-testable). Line pays
   are multiples of the LINE bet (total bet / 10); scatter pays multiply the
   TOTAL bet. RTP is held in the high-80s/low-90s — verified by simulation
   in the repo's harness, same spirit as the wheel's computed paytable.
   ============================================================================ */
(() => {
  "use strict";

  /* ==========================================================================
     SLOT MODEL  (pure — keep DOM out of this block)
     ========================================================================== */
  /* MODEL:BEGIN */
  const REELS = 5, ROWS = 3, LINE_COUNT = 10;

  // pays: line-bet multiples for 3/4/5 consecutive from reel 1.
  // Pays tuned by Monte Carlo (see repo harness): line+scatter RTP ≈ 90%.
  const SL_SYMBOLS = [
    { id: "candle",  glyph: "📈", weight: 24, pays: { 3: 10, 4: 25,  5: 75 } },
    { id: "usdc",    glyph: "💠", weight: 22, pays: { 3: 15, 4: 40,  5: 125 } },
    { id: "troll",   glyph: "😏", weight: 20, pays: { 3: 20, 4: 50,  5: 175 } },
    { id: "rug",     glyph: "🧻", weight: 18, pays: {} },                        // dead symbol
    { id: "pepe",    glyph: "🐸", weight: 14, pays: { 3: 25, 4: 75,  5: 250 } },
    { id: "diamond", glyph: "💎", weight: 10, pays: { 3: 35, 4: 100, 5: 350 } },
    { id: "whale",   glyph: "🐳", weight: 6,  pays: { 3: 50, 4: 175, 5: 700 } },
    { id: "rocket",  glyph: "🚀", weight: 6,  pays: {}, scatter: true },          // pays on TOTAL bet
    { id: "wild",    glyph: "😎", weight: 4,  pays: { 3: 75, 4: 250, 5: 1000 }, wild: true },
    { id: "gold",    glyph: "🐕", weight: 2,  pays: {}, jackpot: true },          // meter symbol
  ];
  const SCATTER_PAYS = { 3: 2, 4: 10, 5: 50 };        // × total bet
  const JACKPOT_TIERS = { 3: ["MINOR", 0.25], 4: ["MAJOR", 0.6], 5: ["GRAND", 1] };

  const PAYLINES = [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 2],
  ];

  const TOTAL_WEIGHT = SL_SYMBOLS.reduce((a, s) => a + s.weight, 0);
  const symById = Object.fromEntries(SL_SYMBOLS.map(s => [s.id, s]));

  function slRand01() {
    const c = (typeof globalThis !== "undefined" && globalThis.crypto) || null;
    if (c && c.getRandomValues) {
      const b = new Uint32Array(1);
      c.getRandomValues(b);
      return b[0] / 4294967296;
    }
    return Math.random();
  }

  function drawSymbol(rand = slRand01) {
    let roll = rand() * TOTAL_WEIGHT;
    for (const s of SL_SYMBOLS) { roll -= s.weight; if (roll < 0) return s.id; }
    return SL_SYMBOLS[0].id;
  }

  // grid[reel][row] = symbol id
  function spinGrid(rand = slRand01) {
    return Array.from({ length: REELS }, () =>
      Array.from({ length: ROWS }, () => drawSymbol(rand)));
  }

  function evalSpin(grid, totalBet) {
    const lineBet = totalBet / LINE_COUNT;
    const lineWins = [];

    PAYLINES.forEach((line, li) => {
      // The paying symbol is the first non-wild on the line; all-wild runs pay as wild.
      let paySym = null, count = 0;
      const cells = [];
      for (let r = 0; r < REELS; r++) {
        const id = grid[r][line[r]];
        const s = symById[id];
        if (s.scatter || s.jackpot) break;                    // never on lines
        if (s.wild) { count++; cells.push([r, line[r]]); continue; }
        if (!paySym) { paySym = id; count++; cells.push([r, line[r]]); continue; }
        if (id === paySym) { count++; cells.push([r, line[r]]); continue; }
        break;
      }
      const sym = symById[paySym || "wild"];
      const pay = sym.pays[count];
      if (pay) {
        lineWins.push({ line: li, symbol: sym.id, glyph: sym.glyph, count,
                        win: Math.round(pay * lineBet * 100) / 100, cells });
      }
    });

    let scatters = 0, golds = 0;
    const scatterCells = [], goldCells = [];
    grid.forEach((col, r) => col.forEach((id, row) => {
      if (symById[id].scatter) { scatters++; scatterCells.push([r, row]); }
      if (symById[id].jackpot) { golds++; goldCells.push([r, row]); }
    }));
    const scatterWin = SCATTER_PAYS[Math.min(scatters, 5)]
      ? Math.round(SCATTER_PAYS[Math.min(scatters, 5)] * totalBet * 100) / 100 : 0;
    const jackpotTier = JACKPOT_TIERS[Math.min(golds, 5)] || null;

    const lineTotal = lineWins.reduce((a, w) => a + w.win, 0);
    return {
      lineWins, scatters, scatterWin, scatterCells,
      golds, goldCells, jackpotTier,                      // [name, meterShare] | null
      nearMiss: scatters === 2 || golds === 2,
      total: Math.round((lineTotal + scatterWin) * 100) / 100,
    };
  }
  /* MODEL:END */

  /* ==========================================================================
     CABINET — DOM, reels animation, jackpot meter, autoplay.
     ========================================================================== */
  const $ = (sel) => document.querySelector(sel);
  const wallet = () => window.TrollCasinoWallet;
  const audio = () => window.TrollCasino.audio;
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const DOGE = {
    idle: "Much casino. Very jackpot. Wow.",
    win: "wow. such payout.",
    big: "😎 MUCH WIN. VERY IMPRESS.",
    jackpot: "🏆 SUCH JACKPOT. VERY RICH. WOW.",
    nearMiss: "so close. much almost.",
    lose: "much rug. very house.",
  };

  const JACKPOT_SEED = { TROLL: 500000, USDC: 2000 };

  const S = {
    bet: 0,
    grid: null,
    spinning: false,
    autoplay: false,
    autoTimer: 0,
    fx: null,
    recent: [],
  };

  /* --- progressive meter — a REAL shared jackpot in troll_casino_jackpot.
     jackpotCache is a display-only local mirror; the pot itself only ever
     changes via troll_casino_slots_spin (see troll_casino.sql) as part of
     the atomic spin, so every player's bet feeds the same real pot and a
     win pays real balance. This module only ever READS the pot to display
     it — it no longer contributes to or draws from it directly. */
  const jackpotCache = { ...JACKPOT_SEED };
  function dbClient() { return window.TrollrunnerAccounts && window.TrollrunnerAccounts.getClient(); }
  async function refreshJackpot() {
    const c = dbClient();
    if (!c) return;
    try {
      const { data } = await c.from("troll_casino_jackpot").select("troll_amount,usdc_amount").eq("id", 1).maybeSingle();
      if (data) {
        jackpotCache.TROLL = Number(data.troll_amount) || jackpotCache.TROLL;
        jackpotCache.USDC = Number(data.usdc_amount) || jackpotCache.USDC;
        renderMeter();
      }
    } catch (_) {}
  }
  function meterLoad() { return { ...jackpotCache }; }

  /* --- public jackpot-win feed — anyone can read troll_casino_jackpot_wins
     (see troll_casino_v2.sql), so the pot's payouts are visible, not just
     its running total. Shows the last few hits across ALL players. */
  async function refreshJackpotFeed() {
    const c = dbClient();
    const el = document.getElementById("sl-jackpot-feed");
    if (!c || !el) return;
    try {
      const { data } = await c.from("troll_casino_jackpot_wins")
        .select("currency,amount,tier,created_at").order("created_at", { ascending: false }).limit(5);
      el.innerHTML = (data && data.length)
        ? data.map(w => `<li>${w.tier || "JACKPOT"} · ${Number(w.amount).toLocaleString()} ${w.currency}
            <span class="sl-jackpot-ago">${timeAgo(w.created_at)}</span></li>`).join("")
        : "<li class=\"sl-jackpot-empty\">No jackpot hits yet — be the first.</li>";
    } catch (_) {}
  }
  function timeAgo(iso) {
    const m = (Date.now() - new Date(iso).getTime()) / 60000;
    if (m < 1) return "just now";
    if (m < 60) return `${Math.round(m)}m ago`;
    if (m < 1440) return `${Math.round(m / 60)}h ago`;
    return `${Math.round(m / 1440)}d ago`;
  }

  /* --- room registration -------------------------------------------------------- */
  window.TrollCasino.registerGame({
    id: "slots", room: "room-slots",
    name: "Doge Jackpot Reels", emoji: "🎰", color: "#ffc94d",
    host: "Hosted by Doge", tagline: "5 reels, 10 lines, one very gold dog. Wow.",
    cta: "Pull the handle",
    art: "assets/games/troll-casino/art/doge-jackpot-hero.webp",
    onEnter: () => { setLine(DOGE.idle); renderMeter(); refreshJackpot(); refreshJackpotFeed(); },
    onLeave: () => stopAutoplay(),
  });

  /* --- markup --------------------------------------------------------------------- */
  function buildRoom() {
    const room = document.getElementById("room-slots");
    if (!room) return;
    room.innerHTML = `
      <div class="room-hero">
        <div class="rh-art" data-art="assets/games/troll-casino/art/doge-jackpot-hero.webp"></div>
        <div class="rh-body">
          <span class="rh-kicker">Doge presents</span>
          <h2>Doge Jackpot Reels</h2>
          <p>Five reels of coins, rockets and rugs. Doge in sunglasses is wild, and the gold dog feeds a growing jackpot. Wow.</p>
          <button type="button" class="rh-enter" data-act="sit">🎰 Take the Handle</button>
        </div>
      </div>
      <div class="room-play">
        <div class="room-panel">
          <div class="room-title">
            <h2>🎰 Doge Jackpot Reels</h2>
            <span class="table-tag">10 lines · scatter 🚀 pays anywhere</span>
          </div>
          <div class="host-line" style="--hl:#ffc94d">
            <span class="host-face">😎</span>
            <q id="sl-line">${DOGE.idle}</q>
          </div>

          <div class="sl-cabinet" id="sl-cabinet">
            <div class="sl-jackpot">
              <span class="sj-label">Grand jackpot · 3🐕 minor · 4🐕 major · 5🐕 grand</span>
              <strong id="sl-meter">—</strong>
              <ul class="sl-jackpot-feed" id="sl-jackpot-feed" aria-label="Recent jackpot wins, all players"></ul>
            </div>

            <div class="sl-reels" id="sl-reels" aria-label="Slot reels"></div>

            <div class="sl-controls">
              <div class="sl-bets" id="sl-bets" aria-label="Total bet"></div>
              <button type="button" class="ghost-btn" id="sl-auto" aria-pressed="false">Auto: off</button>
              <p class="sl-status" id="sl-status">Pick a bet, press spin</p>
              <span class="topbar-spacer"></span>
              <button type="button" class="spin-btn" data-act="spin" id="sl-spin">SPIN</button>
            </div>

            <details class="sl-paytable">
              <summary>Paytable</summary>
              <table id="sl-paytable"></table>
            </details>

            <div class="cr-history" id="sl-recent"><span class="crh-empty">No spins yet</span></div>
          </div>

          <div class="result-banner" id="sl-banner" role="status" aria-live="assertive"></div>
          <canvas id="sl-fx" aria-hidden="true" style="position:absolute;inset:0;pointer-events:none"></canvas>
        </div>
      </div>`;

    const art = room.querySelector(".rh-art");
    const probe = new Image();
    probe.onload = () => { art.style.backgroundImage = `url("${art.dataset.art}")`; art.classList.add("has-art"); };
    probe.src = art.dataset.art;

    S.fx = window.TrollCasino.makeFX(room.querySelector("#sl-fx"));
    buildBets();
    buildPaytable();
    renderReels(spinGrid());          // idle grid so the cabinet never looks empty
    renderMeter();

    room.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act], .sl-bet-btn, #sl-auto");
      if (!btn || btn.disabled) return;
      if (btn.id === "sl-auto") return toggleAutoplay();
      if (btn.classList.contains("sl-bet-btn")) return selectBet(Number(btn.dataset.value));
      if (btn.dataset.act === "sit") { room.classList.add("is-playing"); buildBets(); renderMeter(); }
      if (btn.dataset.act === "spin") spin();
    });
  }

  function buildBets() {
    const cur = wallet().list().find(c => c.code === wallet().getCurrency());
    if (!S.bet || !cur.chips.includes(S.bet)) S.bet = cur.chips[1];
    $("#sl-bets").innerHTML = cur.chips.map(v => `
      <button type="button" class="sl-bet-btn${v === S.bet ? " is-selected" : ""}" data-value="${v}"
              aria-label="Total bet ${v} ${cur.label}">${v >= 1000 ? v / 1000 + "K" : v}</button>`).join("");
    setStatus(`Bet <strong>${wallet().fmt(S.bet)}</strong> across ${LINE_COUNT} lines`);
  }
  function selectBet(v) {
    if (S.spinning) return;
    S.bet = v;
    audio().ensure(); audio().chip();
    buildBets();
  }

  function buildPaytable() {
    const rows = SL_SYMBOLS
      .filter(s => Object.keys(s.pays).length || s.scatter || s.jackpot)
      .map(s => {
        const cell = n => s.scatter ? (SCATTER_PAYS[n] ? SCATTER_PAYS[n] + "×bet" : "—")
                       : s.jackpot ? (JACKPOT_TIERS[n] ? JACKPOT_TIERS[n][0] : "—")
                       : (s.pays[n] || "—");
        const note = s.wild ? "WILD" : s.scatter ? "SCATTER" : s.jackpot ? "JACKPOT" : "";
        return `<tr><td><span class="sym">${s.glyph}</span> ${note}</td><td>${cell(3)}</td><td>${cell(4)}</td><td>${cell(5)}</td></tr>`;
      }).join("");
    $("#sl-paytable").innerHTML =
      `<tr><th>Symbol</th><th>×3</th><th>×4</th><th>×5</th></tr>${rows}
       <tr><td colspan="4" style="text-align:left;color:var(--tc-dim)">Line pays × line bet (bet÷10) · 😎 substitutes all but 🚀/🐕</td></tr>`;
  }

  /* --- reels rendering ------------------------------------------------------------- */
  function cellHeight() {
    const probe = document.querySelector(".sl-cell");
    return probe ? probe.getBoundingClientRect().height : 74;
  }

  function renderReels(grid, winCells) {
    const winKey = new Set((winCells || []).map(([r, row]) => r + ":" + row));
    $("#sl-reels").innerHTML = grid.map((col, r) => `
      <div class="sl-reel"><div class="sl-strip">
        ${col.map((id, row) => `
          <span class="sl-cell${winKey.has(r + ":" + row) ? " is-win" : ""}">${symById[id].glyph}</span>`).join("")}
      </div></div>`).join("");
  }

  // Spin presentation: each reel gets a strip of filler symbols above its final
  // three; we animate translateY so the finals land, staggered left→right.
  function animateReels(grid) {
    return new Promise(resolve => {
      const FILL = REDUCED ? 3 : 14;
      const reels = $("#sl-reels");
      reels.innerHTML = grid.map(col => `
        <div class="sl-reel"><div class="sl-strip" style="transform:translateY(0)">
          ${Array.from({ length: FILL }, () => `<span class="sl-cell">${symById[drawSymbol()].glyph}</span>`).join("")}
          ${col.map(id => `<span class="sl-cell">${symById[id].glyph}</span>`).join("")}
        </div></div>`).join("");

      const h = cellHeight();
      const strips = [...reels.querySelectorAll(".sl-strip")];
      let settled = 0;
      strips.forEach((strip, i) => {
        const dur = (REDUCED ? 250 : 950) + i * (REDUCED ? 60 : 230);
        strip.style.transition = `transform ${dur}ms cubic-bezier(0.16, 0.9, 0.28, 1.04)`;
        requestAnimationFrame(() => { strip.style.transform = `translateY(${-FILL * h}px)`; });
        setTimeout(() => { audio().tick(); if (++settled === strips.length) resolve(); }, dur);
      });
    });
  }

  /* --- the spin ----------------------------------------------------------------
     Bet debit + grid draw + payline/scatter eval + jackpot draw + win credit
     all happen atomically server-side (troll_casino_slots_spin) — the reels
     only animate to whatever grid the server already decided and already
     paid out. evalSpin()/spinGrid() above stay for node-testing the model in
     isolation; this module no longer calls either of them at runtime. */
  async function spin() {
    if (S.spinning) return;
    const cur = wallet().getCurrency();
    if (!wallet().canAfford(S.bet)) {
      stopAutoplay();
      setLine("Much empty wallet. Add funds first.");
      showBanner("Add funds to spin", "Not enough chips", "#ffc94d", false);
      window.TrollCasinoMoneyUI?.openDeposit();
      return;
    }

    S.spinning = true;
    $("#sl-spin").disabled = true;
    hideBanner();
    audio().ensure();

    const res = await wallet().playSlots(S.bet, cur);
    if (!res.ok) {
      S.spinning = false;
      $("#sl-spin").disabled = false;
      setLine(res.message || "Spin failed — try again.");
      return;
    }

    await animateReels(res.grid);
    await settle(res.grid, res, cur);

    S.spinning = false;
    $("#sl-spin").disabled = false;
    if (S.autoplay) queueAuto();
  }

  async function settle(grid, result, cur) {
    // Balance, jackpot contribution, and any jackpot draw already happened
    // server-side inside wallet().playSlots() — this only renders the
    // outcome, it must not credit again.
    const jackpotWon = Number(result.jackpotWon) || 0;
    const credited = Number(result.total) + jackpotWon;
    const tierName = result.jackpotTier ? result.jackpotTier[0] : null;

    refreshJackpot();               // pot moved (this spin's contribution, maybe a draw)
    if (jackpotWon > 0) refreshJackpotFeed();

    const winCells = [
      ...result.lineWins.flatMap(w => w.cells),
      ...result.scatterCells.length >= 3 ? result.scatterCells : [],
      ...result.goldCells.length >= 3 ? result.goldCells : [],
    ];
    renderReels(grid, winCells);

    const mult = S.bet ? Math.round((credited / S.bet) * 10) / 10 : 0;
    if (jackpotWon) {
      showBanner(`${tierName} JACKPOT 🐕`, `+${wallet().fmt(jackpotWon + result.total)}`, "#ffc94d", true);
      setLine(DOGE.jackpot);
      audio().whale(); S.fx.burst(["#ffc94d", "#3dff8a", "#fff"], 90);
    } else if (credited > 0 && mult >= 10) {
      showBanner("MUCH WIN", `+${wallet().fmt(credited)}`, "#ffc94d", true);
      setLine(DOGE.big);
      audio().whale(); S.fx.burst(["#ffc94d", "#3dff8a"], 60);
    } else if (credited > 0) {
      showBanner("WIN", `+${wallet().fmt(credited)}`, "#3dff8a", true);
      setLine(DOGE.win);
      audio().win(); S.fx.burst(["#3dff8a", "#ffc94d"]);
    } else if (result.nearMiss) {
      $("#sl-cabinet").classList.remove("is-shake");
      void $("#sl-cabinet").offsetWidth;
      $("#sl-cabinet").classList.add("is-shake");
      setLine(DOGE.nearMiss);
      audio().rug();
    } else {
      setLine(DOGE.lose);
      audio().rug();
    }
    setStatus(credited > 0
      ? `Won <strong>${wallet().fmt(credited)}</strong> on ${result.lineWins.length || "scatter"} line${result.lineWins.length === 1 ? "" : "s"}`
      : `No win — bet <strong>${wallet().fmt(S.bet)}</strong>`);

    pushRecent(mult);
    window.TrollCasino.reportRound("slots", {
      won: credited > 0, mult,
      meta: { bet: S.bet, payout: credited, lines: result.lineWins.length,
              scatters: result.scatters, jackpot: tierName },
    });
  }

  /* --- autoplay ------------------------------------------------------------------------ */
  function toggleAutoplay() {
    S.autoplay = !S.autoplay;
    const btn = $("#sl-auto");
    btn.setAttribute("aria-pressed", String(S.autoplay));
    btn.textContent = S.autoplay ? "Auto: on" : "Auto: off";
    if (S.autoplay && !S.spinning) queueAuto();
    if (!S.autoplay) clearTimeout(S.autoTimer);
  }
  function stopAutoplay() {
    if (!S.autoplay) return;
    S.autoplay = false;
    clearTimeout(S.autoTimer);
    const btn = $("#sl-auto");
    if (btn) { btn.setAttribute("aria-pressed", "false"); btn.textContent = "Auto: off"; }
  }
  function queueAuto() {
    clearTimeout(S.autoTimer);
    S.autoTimer = setTimeout(() => { if (S.autoplay && !S.spinning) spin(); }, REDUCED ? 700 : 1500);
  }

  /* --- small renderers ------------------------------------------------------------------ */
  function renderMeter() {
    const el = $("#sl-meter");
    if (el) el.textContent = wallet().fmt(meterLoad()[wallet().getCurrency()]);
  }
  function setLine(text) { const el = $("#sl-line"); if (el) el.textContent = text; }
  function setStatus(html) { const el = $("#sl-status"); if (el) el.innerHTML = html; }

  function showBanner(title, sub, color, isWin) {
    const el = $("#sl-banner");
    el.style.setProperty("--rb", color);
    el.innerHTML = `<span class="rb-zone">${title}</span>
      <span class="rb-payout ${isWin ? "is-win" : "is-loss"}">${sub}</span>`;
    el.classList.add("is-shown");
    clearTimeout(el._t);
    el._t = setTimeout(hideBanner, 2200);
  }
  function hideBanner() { $("#sl-banner")?.classList.remove("is-shown"); }

  function pushRecent(mult) {
    S.recent.unshift(mult);
    S.recent.length = Math.min(S.recent.length, 12);
    $("#sl-recent").innerHTML = S.recent.map(m =>
      `<span class="${m >= 10 ? "is-great" : m > 0 ? "is-good" : ""}">${m > 0 ? "×" + m : "—"}</span>`).join("");
  }

  // Currency changes while in the room: refresh bets + meter display.
  document.addEventListener("DOMContentLoaded", () => {
    buildRoom();
    wallet().onChange(() => { if (!S.spinning) { buildBets(); renderMeter(); } });
  });

  window.TrollCasinoSlots = { SL_SYMBOLS, PAYLINES, SCATTER_PAYS, JACKPOT_TIERS, spinGrid, evalSpin, drawSymbol };
})();
