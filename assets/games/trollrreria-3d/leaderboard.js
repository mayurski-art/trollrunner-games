/* ============================================================================
   TROLLRRERIA 3D — leaderboard CONFIG for the shared arcade engine.

   The engine (assets/js/troll-leaderboard.js) does all the work; this file
   only describes Trollrreria 3D's stats. The game feeds sessions via:
       TrollLeaderboard.record("trollrreria-3d", { day, blocks, bossKills })
   ============================================================================ */
(() => {
  "use strict";
  const LB = window.TrollLeaderboard;
  if (!LB) { console.warn("[trollrreria-3d] leaderboard engine not loaded"); return; }
  const fInt = LB.fmt.int;

  LB.register({
    gameId: "trollrreria-3d",
    gameName: "Trollrreria 3D",
    mount: "#lb-root",

    blank: () => ({ sessions: 0, longestSurvival: 0, blocksMined: 0, bossKills: 0 }),
    reduce: (you, ev) => {
      you.sessions = (you.sessions || 0) + 1;
      you.longestSurvival = Math.max(you.longestSurvival || 0, Math.round(ev.day || 0));
      you.blocksMined = (you.blocksMined || 0) + Math.max(0, Math.round(ev.blocks || 0));
      you.bossKills = (you.bossKills || 0) + Math.max(0, Math.round(ev.bossKills || 0));
    },

    columns: [
      { key: "longestSurvival", label: "Day", align: "num", accent: "green" },
      { key: "blocksMined", label: "Mined", align: "num", accent: "gold" },
      { key: "bossKills", label: "Bosses", align: "num", accent: "muted", hideSm: true },
    ],
    rankBy: ["bossKills", "longestSurvival", "blocksMined"],

    player: {
      dotColor: () => "#5856d6",
      sublabel: e => e.sessions ? ("Day " + fInt(e.longestSurvival) + " · " + fInt(e.bossKills)) : "Fresh island",
    },

    mockRival: rng => ({
      longestSurvival: 1 + Math.floor(rng() * 25),
      blocksMined: 100 + Math.floor(rng() * 20000),
      bossKills: rng() < 0.55 ? 0 : 1 + Math.floor(rng() * 5),
      sessions: 1 + Math.floor(rng() * 20),
    }),

    footNote: "Every row here is a real player — longest island survived, blocks mined and bosses (Troll King + Archtroll) slain, reset every Monday.",

    prizes: {
      poolLabel: "Mock prize pool · Trollrreria 3D",
      pool: "500 USDC  +  1M $TROLL",
    },
  });
})();
