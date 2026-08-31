/* ============================================================================
   TROLL RUNNER ARCADE  —  Shared Weekly Leaderboard engine

   ONE engine for EVERY game in the arcade. Each game registers a small config
   describing its own stats; the engine handles weekly rotation, mock rivals,
   the local player's real stats, ranking, rendering and the (placeholder)
   prize panel. Adding a leaderboard to a new game = write a ~30-line config
   and call register(). See LEADERBOARD.md.

   BACKEND-READY: the UI only talks to a per-game `provider` exposing
   `getBoard()` (async) and `recordEvent(ev)`. The default LiveProvider talks to
   the real Supabase backend (window.TrollrunnerAccounts / troll_accounts.sql —
   table troll_leaderboard, RPC troll_record_game_result) when the viewer is
   logged in, and falls back to a local-only cache otherwise. Swap in a
   different backend entirely with setProvider(gameId, provider).

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

  /* ---------- local-only provider (this browser's cache, no bots) -------- */
  // No bot/rival generation: the board starts empty and fills in only with
  // real recorded plays. cfg.mockRival / cfg.rivalNames / cfg.rivalCount are
  // intentionally ignored here.
  function makeLocalProvider(cfg) {
    return {
      name: "local",
      async getBoard() {
        const wid = weekId();
        const you = loadYou(cfg);
        const entries = you._played ? [Object.assign({}, you, { id: "you", you: true })] : [];
        return { weekId: wid, weekLabel: weekLabel(), resetsIn: timeLeft(), source: "local", entries, loggedIn: false };
      },
      recordEvent(ev) {
        const y = loadYou(cfg);
        if (cfg.reduce) cfg.reduce(y, ev);
        y._played = true;
        saveYou(cfg, y);
      },
    };
  }

  /* ---------- primary rank key (used as the backend's sortable score) ---- */
  const primaryKey = cfg => (cfg.rankBy && cfg.rankBy[0]) || (cfg.columns[0] && cfg.columns[0].key);

  /* ---------- live provider: real Supabase sync across players/devices --- */
  // Reads/writes through window.TrollrunnerAccounts (assets/js/troll-accounts.js,
  // schema in assets/supabase/troll_accounts.sql — table `troll_leaderboard`,
  // RPC `troll_record_game_result`, view `troll_leaderboard_view`). That RPC
  // requires a logged-in session; anonymous visitors can still READ the live
  // board but their own plays stay local-only until they log in. Falls back to
  // the local provider whenever the backend, client, or session isn't ready —
  // never breaks a game.
  function makeLiveProvider(cfg) {
    const local = makeLocalProvider(cfg);
    const client = () => {
      const a = window.TrollrunnerAccounts;
      return a && a.getClient ? a.getClient() : null;
    };
    const session = () => {
      const a = window.TrollrunnerAccounts;
      if (!a) return null;
      return (a.getCachedProfile && a.getCachedProfile()) || null;
    };
    return {
      name: "live",
      async getBoard() {
        const sb = client();
        if (!sb) return local.getBoard();
        const wid = weekId();
        const { start, end } = weekWindow();
        let rows;
        try {
          const { data, error } = await sb
            .from("troll_leaderboard_view")
            .select("user_id,username,score,meta,achieved_at")
            .eq("game_id", cfg.gameId)
            .gte("achieved_at", start.toISOString())
            .lt("achieved_at", end.toISOString())
            .order("achieved_at", { ascending: false })
            .limit(500);
          if (error) throw error;
          rows = data || [];
        } catch (err) {
          console.warn("[leaderboard] live fetch failed for " + cfg.gameId + ", showing local cache:", err);
          return local.getBoard();
        }
        const me = session();
        const myId = me && me.userId;
        const seen = new Set();
        const entries = [];
        for (const r of rows) {
          if (seen.has(r.user_id)) continue;   // first hit per user = most recent (order desc) = current weekly aggregate
          seen.add(r.user_id);
          entries.push(Object.assign({ id: r.user_id, name: r.username, you: r.user_id === myId }, r.meta || {}));
        }
        if (myId) {
          // keep the logged-in viewer's own row on their freshest local write —
          // covers the gap between an optimistic local update and the RPC insert landing.
          const you = loadYou(cfg);
          if (you._played) {
            const row = Object.assign({}, you, { id: myId, name: me.username || you.name, you: true });
            const idx = entries.findIndex(e => e.id === myId);
            if (idx >= 0) entries[idx] = row; else entries.push(row);
          }
        }
        return { weekId: wid, weekLabel: weekLabel(), resetsIn: timeLeft(), source: "live", entries, loggedIn: !!myId };
      },
      recordEvent(ev) {
        local.recordEvent(ev);   // always keep the local optimistic cache current, logged in or not
        const sb = client();
        const me = session();
        if (!sb || !me) return;   // not logged in: local-only for now
        const you = loadYou(cfg);
        const score = Number(you[primaryKey(cfg)]) || 0;
        sb.rpc("troll_record_game_result", { p_game_id: cfg.gameId, p_score: score, p_meta: you })
          .then(({ error }) => { if (error) console.warn("[leaderboard] sync failed for " + cfg.gameId + ":", error.message); })
          .catch(err => console.warn("[leaderboard] sync failed for " + cfg.gameId + ":", err));
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
    const ranked = rankEntries(cfg, board.entries).slice(0, cfg.boardSize || 10);
    const rows = ranked.map(e => rowMarkup(cfg, e)).join("") ||
      `<tr class="lb-empty"><td class="lb-empty-cell" colspan="${cfg.columns.length + 2}">No plays yet this week — be the first on the board.</td></tr>`;
    const foot = (cfg.footNote || (board.source === "live"
      ? "Live — synced across every player and device. Resets every Monday."
      : "Scores here are real. The board fills in as people play this week and resets every Monday."))
      + (board.source === "live" && !board.loggedIn ? " <strong>Log in</strong> to add your own score to the board." : "");
    g.rootEl.innerHTML = `
      <div class="lb-bar">
        <div class="lb-week">
          <span class="lb-week-label">${esc(board.weekLabel)}</span>
          <span class="lb-week-id">${esc(board.weekId)}</span>
        </div>
        <div class="lb-reset"><span class="lb-reset-label">Resets in</span><strong class="lb-reset-time" data-lb-reset>${esc(board.resetsIn)}</strong></div>
        <span class="lb-source">${board.source === "live" ? "LIVE" : "LOCAL"}</span>
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
    const g = games[cfg.gameId] = { config: cfg, provider: makeLiveProvider(cfg), rootEl: null, timer: null };
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

  // Logging in/out changes whose row is "you" and whether recordEvent can
  // sync at all — re-render every mounted board when it happens.
  window.addEventListener("trollrunner:auth-changed", () => {
    for (const id in games) refresh(games[id]);
  });

  /* ---------- arcade-wide board: games played this week, across every game -
     Reads the same troll_leaderboard_view (all game_ids, no .eq filter) and
     ranks by distinct game_id count per user — the RPC upserts one row per
     user per game per week, so a distinct game_id count is "games played."
     Local/offline visitors just don't appear (no cross-game local cache). */
  async function getArcadeBoard() {
    const wid = weekId();
    const a = window.TrollrunnerAccounts;
    const sb = a && a.getClient ? a.getClient() : null;
    if (!sb) return { weekId: wid, weekLabel: weekLabel(), resetsIn: timeLeft(), source: "local", entries: [], loggedIn: false };
    const { start, end } = weekWindow();
    const me = (a.getCachedProfile && a.getCachedProfile()) || null;
    const myId = me && me.userId;
    try {
      const { data, error } = await sb
        .from("troll_leaderboard_view")
        .select("user_id,username,game_id,achieved_at")
        .gte("achieved_at", start.toISOString())
        .lt("achieved_at", end.toISOString())
        .limit(2000);
      if (error) throw error;
      const byUser = new Map();
      for (const r of (data || [])) {
        let u = byUser.get(r.user_id);
        if (!u) { u = { id: r.user_id, name: r.username, games: new Set(), you: r.user_id === myId }; byUser.set(r.user_id, u); }
        u.games.add(r.game_id);
      }
      const entries = [...byUser.values()].map(u => ({ id: u.id, name: u.name, you: u.you, gamesPlayed: u.games.size }));
      return { weekId: wid, weekLabel: weekLabel(), resetsIn: timeLeft(), source: "live", entries, loggedIn: !!myId };
    } catch (err) {
      console.warn("[leaderboard] arcade board fetch failed:", err);
      return { weekId: wid, weekLabel: weekLabel(), resetsIn: timeLeft(), source: "live", entries: [], loggedIn: !!myId };
    }
  }

  const ARCADE_CFG = {
    gameId: "__arcade__",
    columns: [{ key: "gamesPlayed", label: "Games played", align: "num", accent: "green" }],
    rankBy: ["gamesPlayed"],
    boardSize: 10,
    prizes: { enabled: false },
    footNote: "Ranked by distinct games played this week across the whole arcade. Resets every Monday.",
  };
  let arcadeState = null;
  async function mountArcadeBoard(sel) {
    const rootEl = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (!rootEl) return;
    arcadeState = { rootEl, timer: null };
    const g = { rootEl, config: ARCADE_CFG };
    const doRefresh = async () => {
      try { render(g, await getArcadeBoard()); }
      catch (err) { rootEl.innerHTML = `<p class="lb-foot">Leaderboard unavailable right now.</p>`; console.warn("[leaderboard] arcade render failed:", err); }
    };
    await doRefresh();
    if (arcadeState.timer) clearInterval(arcadeState.timer);
    arcadeState.timer = setInterval(() => {
      const el = rootEl.querySelector("[data-lb-reset]");
      if (el) el.textContent = timeLeft();
    }, 60000);
    window.addEventListener("trollrunner:auth-changed", doRefresh);
  }

  window.TrollLeaderboard = {
    __engine: true,
    register, mount, record, refresh: id => refresh(get(id)),
    setProvider, configure, setPlayerName, mountArcadeBoard,
    // shared helpers exposed for configs / tests
    weekId, weekLabel, weekWindow, timeLeft, hashStr, rng: mulberry32, hashColor,
    fmt: { int: fmtInt, pct: fmtPct }, RIVAL_NAMES, DEFAULT_PRIZES,
  };
})();
