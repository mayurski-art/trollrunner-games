/* ============================================================================
   TROLL DASH: MEME METRO  —  leaderboard CONFIG for the shared arcade engine.

   The engine (assets/js/troll-leaderboard.js) does all the work; this file only
   describes Meme Metro's stats. Game.js feeds runs via:
       TrollLeaderboard.record("meme-metro", { score, coins })
   ============================================================================ */
(() => {
  "use strict";
  const LB = window.TrollLeaderboard;
  if (!LB) { console.warn("[meme-metro] leaderboard engine not loaded"); return; }
  const fInt = LB.fmt.int;

  LB.register({
    gameId: "meme-metro",
    gameName: "Meme Metro",

    // local player's stored aggregate (best-of, so paid revives never double-count)
    blank: () => ({ runs: 0, bestScore: 0, bestCoins: 0, totalCoins: 0 }),
    reduce: (you, ev) => {
      you.runs = (you.runs || 0) + 1;
      you.bestScore = Math.max(you.bestScore || 0, Math.round(ev.score || 0));
      you.bestCoins = Math.max(you.bestCoins || 0, Math.round(ev.coins || 0));
      you.totalCoins = (you.totalCoins || 0) + Math.max(0, Math.round(ev.coins || 0));
    },

    columns: [
      { key: "bestScore", label: "Best",   align: "num", accent: "green" },
      { key: "bestCoins", label: "$TROLL", align: "num", accent: "gold" },
      { key: "runs",      label: "Runs",   align: "num", accent: "muted", hideSm: true },
    ],
    rankBy: ["bestScore", "bestCoins", "runs"],

    player: {
      dotColor: () => "#ffb300",
      sublabel: e => e.runs ? ("Best " + fInt(e.bestScore)) : "New runner",
    },

    mockRival: rng => {
      const score = 400 + Math.floor(rng() * 42000);
      return {
        bestScore: score,
        bestCoins: 8 + Math.floor(rng() * 360),
        runs: 3 + Math.floor(rng() * 38),
      };
    },

    footNote: "Every row here is a real player — tracks your best run this week and resets every Monday.",

    prizes: {
      poolLabel: "Mock prize pool · Meme Metro",
      pool: "500 USDC  +  1M $TROLL",
    },
  });
})();
