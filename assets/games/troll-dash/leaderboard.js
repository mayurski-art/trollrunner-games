/* ============================================================================
   TROLL DASH: RUGPULL RUN  —  leaderboard CONFIG for the shared arcade engine.

   The engine (assets/js/troll-leaderboard.js) does all the work; this file only
   describes Troll Dash's stats. game.js feeds runs via:
       TrollLeaderboard.record("troll-dash", { distance, coins })
   ============================================================================ */
(() => {
  "use strict";
  const LB = window.TrollLeaderboard;
  if (!LB) { console.warn("[troll-dash] leaderboard engine not loaded"); return; }
  const fInt = LB.fmt.int;

  LB.register({
    gameId: "troll-dash",
    gameName: "Troll Dash",
    mount: "#lb-root",

    // local player's stored aggregate (best-of, so paid revives never double-count)
    blank: () => ({ runs: 0, bestDistance: 0, bestCoins: 0, totalCoins: 0 }),
    reduce: (you, ev) => {
      you.runs = (you.runs || 0) + 1;
      you.bestDistance = Math.max(you.bestDistance || 0, Math.round(ev.distance || 0));
      you.bestCoins = Math.max(you.bestCoins || 0, Math.round(ev.coins || 0));
      you.totalCoins = (you.totalCoins || 0) + Math.max(0, Math.round(ev.coins || 0));
    },

    columns: [
      { key: "bestDistance", label: "Best",   align: "num", accent: "green", unit: " m" },
      { key: "bestCoins",    label: "$TROLL", align: "num", accent: "gold" },
      { key: "runs",         label: "Runs",   align: "num", accent: "muted", hideSm: true },
    ],
    rankBy: ["bestDistance", "bestCoins", "runs"],

    player: {
      dotColor: () => "#4dff73",
      sublabel: e => e.runs ? ("Best " + fInt(e.bestDistance) + " m") : "New runner",
    },

    mockRival: rng => {
      const dist = 600 + Math.floor(rng() * 8800);
      return {
        bestDistance: dist,
        bestCoins: 8 + Math.floor(rng() * 360),
        runs: 3 + Math.floor(rng() * 38),
      };
    },

    footNote: "Rivals are simulated for now. <strong>Your</strong> row is real — it tracks your best run this week and resets every Monday.",

    prizes: {
      poolLabel: "Mock prize pool · Troll Dash",
      pool: "500 USDC  +  1M $TROLL",
    },
  });
})();
