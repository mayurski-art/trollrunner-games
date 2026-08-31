/* Papa Troll's Pizzeria — weekly leaderboard config.
   Uses the shared arcade engine (assets/js/troll-leaderboard.js); see
   assets/games/LEADERBOARD.md. Prizes are display-only mock — the engine
   enforces live:false. game.js reports one event per completed day. */
(() => {
  const LB = window.TrollLeaderboard;
  if (!LB) return;

  LB.register({
    gameId: "troll-pizzeria",
    gameName: "Papa Troll's Pizzeria",

    blank: () => ({ score: 0, tips: 0, served: 0 }),
    reduce: (you, ev) => {
      you.score = Math.max(you.score, ev.score || 0);
      you.tips += ev.tips || 0;
      you.served += ev.served || 0;
    },

    columns: [
      { key: "score",  label: "Best day", align: "num", accent: "green" },
      { key: "tips",   label: "Tips",     align: "num", accent: "gold", format: v => "🪙 " + v },
      { key: "served", label: "Served",   align: "num", accent: "muted", hideSm: true },
    ],
    rankBy: ["score", "tips"],

    player: { dotColor: () => "#cf3b28", sublabel: () => "head chef" },

    mockRival: (rng) => {
      const days = 1 + Math.floor(rng() * 6);
      const served = days * (4 + Math.floor(rng() * 5));
      return {
        score: 250 + Math.floor(rng() * 620),
        tips: served * (4 + Math.floor(rng() * 8)),
        served,
      };
    },

    prizes: { poolLabel: "Mock prize pool · Papa Troll's Pizzeria", pool: "100 USDC + 1M $TROLL" },
  });
})();
