/* Grin Halls — weekly leaderboard config.
   Uses the shared arcade engine (assets/js/troll-leaderboard.js); see
   assets/games/LEADERBOARD.md. Prizes are display-only mock — the engine
   enforces live:false. game.js reports one event per run (escape or
   caught). The engine only ranks descending, so `score` is a composite
   that rewards levels cleared first and finish time second: escaping
   always outranks any partial run, and among full escapes a faster time
   scores higher. */
(() => {
  const LB = window.TrollLeaderboard;
  if (!LB) return;

  LB.register({
    gameId: "grin-halls",
    gameName: "Backrooms",

    blank: () => ({ score: 0, bestLevel: 0, bestTimeSeconds: null, runs: 0 }),
    reduce: (you, ev) => {
      you.score = Math.max(you.score, ev.score || 0);
      you.bestLevel = Math.max(you.bestLevel, ev.levelsCleared || 0);
      you.runs += 1;
      if (ev.escaped && (you.bestTimeSeconds == null || ev.timeSeconds < you.bestTimeSeconds)) {
        you.bestTimeSeconds = ev.timeSeconds;
      }
    },

    columns: [
      { key: "bestLevel", label: "Deepest level", align: "num", accent: "gold" },
      { key: "bestTimeSeconds", label: "Fastest escape", align: "num", accent: "green",
        format: (v) => (v == null ? "—" : `${v.toFixed(1)}s`) },
      { key: "runs", label: "Runs", align: "num", accent: "muted", hideSm: true },
    ],
    rankBy: ["score"],

    player: { dotColor: () => "#d8c377", sublabel: () => "grin hunter" },

    mockRival: (rng) => {
      const bestLevel = Math.floor(rng() * 4); // 0-3 (3 = escaped)
      const escaped = bestLevel >= 3;
      const timeSeconds = escaped ? 90 + rng() * 240 : null;
      const score = bestLevel * 100000 + (escaped ? Math.max(0, 100000 - Math.floor(timeSeconds * 10)) : 0);
      return { score, bestLevel, bestTimeSeconds: timeSeconds, runs: 1 + Math.floor(rng() * 8) };
    },

    prizes: { poolLabel: "Mock prize pool · Backrooms", pool: "100 USDC + 1M $TROLL" },
  });
})();
