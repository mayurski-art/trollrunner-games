/* ============================================================================
   BRIDGE PATROL — leaderboard CONFIG for the shared arcade engine.

   The engine (assets/js/troll-leaderboard.js) does all the work; this file
   only describes Bridge Patrol's stats. The game feeds sessions via:
       TrollLeaderboard.record("bridge-patrol", { wave, tolls, bosses })
   ============================================================================ */
(() => {
  "use strict";
  const LB = window.TrollLeaderboard;
  if (!LB) { console.warn("[bridge-patrol] leaderboard engine not loaded"); return; }
  const fInt = LB.fmt.int;

  LB.register({
    gameId: "bridge-patrol",
    gameName: "Bridge Patrol",

    blank: () => ({ sessions: 0, bestWave: 0, tolls: 0, bossesSlain: 0 }),
    reduce: (you, ev) => {
      you.sessions = (you.sessions || 0) + 1;
      you.bestWave = Math.max(you.bestWave || 0, Math.round(ev.wave || 0));
      you.tolls = (you.tolls || 0) + Math.max(0, Math.round(ev.tolls || 0));
      you.bossesSlain = (you.bossesSlain || 0) + Math.max(0, Math.round(ev.bosses || 0));
    },

    columns: [
      { key: "bestWave", label: "Wave", align: "num", accent: "green" },
      { key: "tolls", label: "Tolls", align: "num", accent: "gold" },
      { key: "bossesSlain", label: "Bosses", align: "num", accent: "muted", hideSm: true },
    ],
    rankBy: ["bestWave", "tolls", "bossesSlain"],

    player: {
      dotColor: () => "#34c759",
      sublabel: e => e.sessions ? ("Wave " + fInt(e.bestWave) + " · 🪙 " + fInt(e.tolls)) : "Bridge unguarded",
    },

    mockRival: rng => ({
      bestWave: 1 + Math.floor(rng() * 34),
      tolls: 50 + Math.floor(rng() * 12000),
      bossesSlain: rng() < 0.5 ? 0 : 1 + Math.floor(rng() * 4),
      sessions: 1 + Math.floor(rng() * 25),
    }),

    footNote: "Every row here is a real player — deepest wave, tolls collected and bosses slain, reset every Monday.",

    prizes: {
      poolLabel: "Mock prize pool · Bridge Patrol",
      pool: "500 USDC  +  1M $TROLL",
    },
  });
})();
