/* ============================================================================
   TROLLRRERIA — leaderboard CONFIG for the shared arcade engine.

   The engine (assets/js/troll-leaderboard.js) does all the work; this file
   only describes Trollrreria's stats. The game feeds sessions via:
       TrollLeaderboard.record("trollrreria", { depth, blocks, bossKills })
   ============================================================================ */
(() => {
  "use strict";
  const LB = window.TrollLeaderboard;
  if (!LB) { console.warn("[trollrreria] leaderboard engine not loaded"); return; }
  const fInt = LB.fmt.int;

  LB.register({
    gameId: "trollrreria",
    gameName: "Trollrreria",
    mount: "#lb-root",

    blank: () => ({ sessions: 0, deepest: 0, blocksMined: 0, bossKills: 0 }),
    reduce: (you, ev) => {
      you.sessions = (you.sessions || 0) + 1;
      you.deepest = Math.max(you.deepest || 0, Math.round(ev.depth || 0));
      you.blocksMined = (you.blocksMined || 0) + Math.max(0, Math.round(ev.blocks || 0));
      you.bossKills = (you.bossKills || 0) + Math.max(0, Math.round(ev.bossKills || 0));
    },

    columns: [
      { key: "deepest", label: "Depth", align: "num", accent: "green" },
      { key: "blocksMined", label: "Mined", align: "num", accent: "gold" },
      { key: "bossKills", label: "Kings", align: "num", accent: "muted", hideSm: true },
    ],
    rankBy: ["bossKills", "deepest", "blocksMined"],

    player: {
      dotColor: () => "#57bd5c",
      sublabel: e => e.sessions ? ("Depth " + fInt(e.deepest) + "ft") : "Fresh spawn",
    },

    mockRival: rng => ({
      deepest: 50 + Math.floor(rng() * 1500),
      blocksMined: 200 + Math.floor(rng() * 40000),
      bossKills: rng() < 0.6 ? 0 : 1 + Math.floor(rng() * 6),
      sessions: 1 + Math.floor(rng() * 30),
    }),

    footNote: "Every row here is a real player — deepest dig, blocks mined and Troll King takedowns, reset every Monday.",

    prizes: {
      poolLabel: "Mock prize pool · Trollrreria",
      pool: "500 USDC  +  1M $TROLL",
    },
  });
})();
