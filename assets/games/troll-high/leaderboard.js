(() => {
  const LB = window.TrollLeaderboard; if (!LB) return;
  LB.register({
    gameId: "troll-high",
    gameName: "Troll High",

    // Only "memories found" is real right now — secrets/stickers/inventory
    // are later-phase systems (see docs/TROLL-HIGH.md §14); adding those
    // columns before the data exists would just be decoration.
    blank: () => ({ memories: 0 }),
    reduce: (you, ev) => {
      you.memories = Math.max(you.memories, ev.memories || 0);
    },

    columns: [
      { key: "memories", label: "Memories Found", align: "num", accent: "gold" },
    ],
    rankBy: ["memories"],

    prizes: { poolLabel: "Mock prize pool · Troll High", pool: "TBD" },
  });
})();
