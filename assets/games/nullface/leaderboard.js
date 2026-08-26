/* NULLFACE — weekly leaderboard config.
   Uses the shared arcade engine (assets/js/troll-leaderboard.js); see
   assets/games/LEADERBOARD.md. NULLFACE's CSP is locked down (no external
   hosts), so troll-accounts.js isn't loaded here and this board stays
   local-only per device — the engine falls back to that silently.
   nullface.html reports one event per completed run (resolveEnding /
   crashOut) via reportRun(). */
(() => {
  const LB = window.TrollLeaderboard;
  if (!LB) return;

  LB.register({
    gameId: "nullface",
    gameName: "NULLFACE",
    mount: "#lb-root",

    blank: () => ({ layer: 0, runs: 0, endings: 0 }),
    reduce: (you, ev) => {
      you.layer = Math.max(you.layer, ev.layer || 0);
      you.runs += 1;
      you.endings += ev.newEnding || 0;
    },

    columns: [
      { key: "layer",   label: "Deepest layer", align: "num", accent: "green" },
      { key: "endings", label: "Endings",       align: "num", accent: "gold" },
      { key: "runs",    label: "Runs",          align: "num", accent: "muted", hideSm: true },
    ],
    rankBy: ["layer", "endings"],

    player: { dotColor: () => "#33ff66", sublabel: () => "operator" },

    mockRival: (rng) => ({
      layer: Math.floor(rng() * 4),
      runs: 1 + Math.floor(rng() * 8),
      endings: Math.floor(rng() * 4),
    }),

    prizes: { poolLabel: "Mock prize pool · NULLFACE", pool: "100 USDC + 1M $TROLL" },
  });
})();
