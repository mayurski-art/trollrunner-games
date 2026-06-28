/* ============================================================================
   TROLL RUNNER ARCADE  —  Shared Weekly Leaderboard engine

   ONE engine for EVERY game in the arcade. Each game registers a small config
   describing its own stats; the engine handles weekly rotation, mock rivals,
   the local player's real stats, ranking, rendering and the (placeholder)
   prize panel. Adding a leaderboard to a new game = write a ~30-line config
   and call register(). See LEADERBOARD.md.

   BACKEND-READY: the UI only talks to a per-game `provider` exposing
   `getBoard()` (async) and `recordEvent(ev)`. The default MockProvider is built
   from the config. Swap in a real backend with setProvider(gameId, provider).

   SAFETY: prizes are DISPLAY-ONLY placeholders. No wallet code, no claim flow,
   no payouts live here. `prizes.live` is a guard kept false. Do not wire real
   USDC / $TROLL payouts in this file without a separate, audited money path.
   ============================================================================ */
(() => {
  "use strict";
  if (window.TrollLeaderboard && window.TrollLeaderboard.__engine) return;   // singleton

  /* ---------- weekly rotation (ISO-week id + Monday→Monday window) -------- */
  function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
    return { year: d.getUTCFullYear(), week };
  }
  function weekId(date = new Date()) {
    const { year, week } = isoWeek(date);
    return `${year}-W${String(week).padStart(2, "0")}`;
  }
  function weekWindow(date = new Date()) {
    const start = new Date(date);
    const day = (start.getDay() + 6) % 7;
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - day);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    return { start, end };
  }
  function weekLabel(date = new Date()) {
    const { start, end } = weekWindow(date);
    const last = new Date(end); last.setDate(last.getDate() - 1);
    const fmt = d => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `Week of ${fmt(start)} – ${fmt(last)}`;
  }
  function timeLeft(date = new Date()) {
    const ms = Math.max(0, weekWindow(date).end - date);
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
  }

  /* ---------- prng + display helpers ------------------------------------- */
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const PALETTE = ["#4dff73", "#ffd84d", "#4deeff", "#9a5cff", "#ff7ad9", "#ff9f45", "#7bdcff", "#b6ff5c"];
  const hashColor = s => PALETTE[hashStr(String(s)) % PALETTE.length];
  // Generic troll-flavoured rival names (games may override via cfg.rivalNames).
  const RIVAL_NAMES = [
    "GigaChadTroll", "MoonBoiDoge", "ZoomerWojak", "DiamondHandz", "RugSurvivor",
    "SerWenLambo", "CopiumKing", "BasedBrad", "NgmiNancy", "PaperHandPete",
    "VibeMarshal", "FudBuster", "WagmiWanda", "SaltyShiba", "ApeOutAndy",
  ];

  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtInt = n => Number(n || 0).toLocaleString();
  const fmtPct = r => Math.round((r || 0) * 100) + "%";

  /* ---------- default (placeholder, inert) prize config ------------------ */
  const DEFAULT_PRIZES = {
    enabled: true,
    live: false,   // HARD GUARD — true would imply real payouts. Keep false.
    poolLabel: "Mock prize pool",
    pool: "750 USDC  +  1.75M $TROLL",
    disclaimer: "Preview only — prizes are illustrative mock values. No real money or " +
                "$TROLL payouts, wallet transfers, or claims are active.",
    tiers: [
      { rank: 1, medal: "🥇", usdc: "500 USDC", troll: "1,000,000 $TROLL" },
      { rank: 2, medal: "🥈", usdc: "200 USDC", troll: "500,000 $TROLL" },
      { rank: 3, medal: "🥉", usdc: "100 USDC", troll: "250,000 $TROLL" },
    ],
  };

  /* ---------- storage (per-game, current week only) ---------------------- */
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const keyFor = cfg => cfg.storageKey || ("tk_lb_" + cfg.gameId + "_v1");

  function loadYou(cfg) {
    const wid = weekId();
    let d = lsGet(keyFor(cfg));
    if (!d || d.weekId !== wid) d = Object.assign({ weekId: wid, name: cfg.playerName || "YOU" }, cfg.blank ? cfg.blank() : {});
    if (cfg.playerName && cfg.playerName !== "YOU") d.name = cfg.playerName;
    return d;
  }
  const saveYou = (cfg, d) => lsSet(keyFor(cfg), d);
  const youEntry = cfg => Object.assign({}, loadYou(cfg), { id: "you", you: true });

  /* ---------- default mock provider (built from the config) -------------- */
  function makeMockProvider(cfg) {
    return {
      name: "mock",
      async getBoard() {
        const wid = weekId();
        const rng = mulberry32(hashStr(cfg.gameId + "|" + wid));
        const names = (cfg.rivalNames || RIVAL_NAMES).slice().sort((a, b) => hashStr(wid + a) - hashStr(wid + b));
        const count = Math.min(cfg.rivalCount || 9, names.length);
        const entries = [];
        for (let i = 0; i < count; i++) {
          const base = cfg.mockRival ? cfg.mockRival(rng, i, wid) : {};
          entries.push(Object.assign({ id: "rival-" + i, name: base.name || names[i], you: false }, base));
        }
        entries.push(youEntry(cfg));
        return { weekId: wid, weekLabel: weekLabel(), resetsIn: timeLeft(), source: "mock", entries };
      },
      recordEvent(ev) {
        const y = loadYou(cfg);
        if (cfg.reduce) cfg.reduce(y, ev);
        saveYou(cfg, y);
      },
    };
  }

  /* ---------- ranking ---------------------------------------------------- */
  const derive = (cfg, e) => Object.assign({}, e, cfg.derive ? cfg.derive(e) : {});
  function rankEntries(cfg, entries) {
    const keys = cfg.rankBy || (cfg.columns[0] ? [cfg.columns[0].key] : []);
    return entries.map(e => derive(cfg, e)).sort((a, b) => {
      for (const k of keys) { const d = (Number(b[k]) || 0) - (Number(a[k]) || 0); if (d) return d; }
      return 0;
    }).map((e, i) => Object.assign(e, { rank: i + 1 }));
  }

  /* ---------- render ----------------------------------------------------- */
  function colText(col, e) {
    const v = col.get ? col.get(e) : e[col.key];
    if (col.format) return col.format(v, e);
    if (col.percent) return fmtPct(v);
    if (typeof v === "number") return fmtInt(v) + (col.unit || "");
    return v == null ? "—" : esc(String(v));
  }
  const colClass = col =>
    (col.align === "num" ? "lb-num" : "") +
    (col.accent ? " lb-acc-" + col.accent : "") +
    (col.hideSm ? " lb-hide-sm" : "");

  function prizeMarkup(cfg) {
    const p = cfg.prizes;
    if (!p || !p.enabled) return "";
    const tiers = p.tiers.map(t => `
      <li class="lb-prize-tier lb-prize-r${t.rank}">
        <span class="lb-medal" aria-hidden="true">${t.medal}</span>
        <span class="lb-prize-rank">${t.rank === 1 ? "1st" : t.rank === 2 ? "2nd" : t.rank === 3 ? "3rd" : t.rank + "th"}</span>
        <strong class="lb-prize-usdc">${esc(t.usdc)}</strong>
        <span class="lb-prize-troll">${esc(t.troll)}</span>
      </li>`).join("");
    return `
      <div class="lb-prizes" role="group" aria-label="Prize preview (not active)">
        <div class="lb-prize-head">
          <div><p class="lb-prize-kicker">${esc(p.poolLabel)}</p><strong class="lb-prize-pool">${esc(p.pool)}</strong></div>
          <span class="lb-prize-badge">${p.live ? "LIVE" : "NOT LIVE · PREVIEW"}</span>
        </div>
        <ul class="lb-prize-tiers">${tiers}</ul>
        <p class="lb-prize-note">⚠ ${esc(p.disclaimer)}</p>
      </div>`;
  }

  function rowMarkup(cfg, e) {
    const medal = e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : "";
    const dot = (cfg.player && cfg.player.dotColor && cfg.player.dotColor(e)) || hashColor(e.name);
    const sub = (cfg.player && cfg.player.sublabel && cfg.player.sublabel(e)) || "";
    const cells = cfg.columns.map(c => `<td class="${colClass(c)}">${colText(c, e)}</td>`).join("");
    return `
      <tr class="${e.you ? "lb-you" : ""}">
        <td class="lb-rank"><span class="lb-rank-n">${e.rank}</span>${medal ? `<span class="lb-rank-medal">${medal}</span>` : ""}</td>
        <td class="lb-player">
          <span class="lb-dot" style="background:${dot}"></span>
          <span class="lb-name">${esc(e.name)}${e.you ? '<span class="lb-tag">YOU</span>' : ""}</span>
          ${sub ? `<span class="lb-char">${esc(sub)}</span>` : ""}
        </td>${cells}
      </tr>`;
  }

  function render(g, board) {
    const cfg = g.config;
    if (!g.rootEl) return;
    const headCols = cfg.columns.map(c => `<th class="${colClass(c)}">${esc(c.label)}</th>`).join("");
    const rows = rankEntries(cfg, board.entries).slice(0, cfg.boardSize || 10).map(e => rowMarkup(cfg, e)).join("");
    const foot = cfg.footNote ||
      "Rivals are simulated for now. <strong>Your</strong> row is real — it tracks what you play this week and resets every Monday.";
    g.rootEl.innerHTML = `
      <div class="lb-bar">
        <div class="lb-week">
          <span class="lb-week-label">${esc(board.weekLabel)}</span>
          <span class="lb-week-id">${esc(board.weekId)}</span>
        </div>
        <div class="lb-reset"><span class="lb-reset-label">Resets in</span><strong class="lb-reset-time" data-lb-reset>${esc(board.resetsIn)}</strong></div>
        <span class="lb-source">${board.source === "mock" ? "MOCK DATA" : "LIVE"}</span>
      </div>
      ${prizeMarkup(cfg)}
      <div class="lb-table-wrap">
        <table class="lb-table">
          <thead><tr><th class="lb-rank">#</th><th class="lb-player">Player</th>${headCols}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="lb-foot">${foot}</p>`;
  }

  async function refresh(g) {
    if (!g || !g.rootEl) return;
    try { render(g, await g.provider.getBoard()); }
    catch (err) {
      g.rootEl.innerHTML = `<p class="lb-foot">Leaderboard unavailable right now.</p>`;
      console.warn("[leaderboard] getBoard failed for " + g.config.gameId + ":", err);
    }
  }

  function startCountdown(g) {
    if (g.timer) clearInterval(g.timer);
    let lastWeek = weekId();
    g.timer = setInterval(() => {
      if (!g.rootEl) return;
      const el = g.rootEl.querySelector("[data-lb-reset]");
      if (el) el.textContent = timeLeft();
      if (weekId() !== lastWeek) { lastWeek = weekId(); refresh(g); }   // weekly rotation flip
    }, 60000);
  }

  /* ---------- registry + public API ------------------------------------- */
  const games = {};   // gameId -> { config, provider, rootEl, timer }
  const get = id => games[id];

  function register(cfg) {
    if (!cfg || !cfg.gameId) throw new Error("TrollLeaderboard.register needs a gameId");
    cfg.prizes = cfg.prizes === undefined ? Object.assign({}, DEFAULT_PRIZES)
               : (cfg.prizes && Object.assign({}, DEFAULT_PRIZES, cfg.prizes, { live: false }));  // never allow live:true
    const g = games[cfg.gameId] = { config: cfg, provider: makeMockProvider(cfg), rootEl: null, timer: null };
    if (cfg.mount) {
      const el = typeof cfg.mount === "string" ? document.querySelector(cfg.mount) : cfg.mount;
      if (el) mount(cfg.gameId, el);
    }
    return {
      record: ev => record(cfg.gameId, ev),
      mount: sel => mount(cfg.gameId, sel),
      refresh: () => refresh(g),
      configure: p => configure(cfg.gameId, p),
      setProvider: p => setProvider(cfg.gameId, p),
    };
  }
  function mount(gameId, sel) {
    const g = get(gameId); if (!g) return;
    g.rootEl = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (!g.rootEl) return;
    refresh(g); startCountdown(g);
  }
  function record(gameId, ev) {
    const g = get(gameId); if (!g) return;
    try { g.provider.recordEvent(ev); } catch (_) { /* never break a game */ }
    refresh(g);
  }
  function setProvider(gameId, p) { const g = get(gameId); if (g && p) { g.provider = p; refresh(g); } }
  function configure(gameId, partial) {
    const g = get(gameId); if (!g || !partial) return;
    if (partial.prizes) partial.prizes = Object.assign({}, g.config.prizes, partial.prizes, { live: false });
    Object.assign(g.config, partial);
    refresh(g);
  }
  function setPlayerName(gameId, name) {
    const g = get(gameId); if (!g || !name) return;
    g.config.playerName = name;
    const y = loadYou(g.config); y.name = name; saveYou(g.config, y);
    refresh(g);
  }

  window.TrollLeaderboard = {
    __engine: true,
    register, mount, record, refresh: id => refresh(get(id)),
    setProvider, configure, setPlayerName,
    // shared helpers exposed for configs / tests
    weekId, weekLabel, weekWindow, timeLeft, hashStr, rng: mulberry32, hashColor,
    fmt: { int: fmtInt, pct: fmtPct }, RIVAL_NAMES, DEFAULT_PRIZES,
  };
})();
