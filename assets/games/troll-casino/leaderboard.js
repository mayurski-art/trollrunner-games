/* ============================================================================
   TROLL CASINO  —  leaderboard CONFIG for the shared arcade engine.

   The engine (assets/js/troll-leaderboard.js) does all the work; this file
   only describes Troll Casino's stats. game.js feeds one event per spin:
       TrollLeaderboard.record("troll-casino", { won, mult, zone })

   Stats are deliberately CURRENCY-NEUTRAL (spin counts + multipliers, not
   amounts) so mixed $TROLL/USDC sessions rank on the same ladder honestly.
   Prizes shown are display-only mock data, same as every other game.
   ============================================================================ */
(() => {
  "use strict";
  const LB = window.TrollLeaderboard;
  if (!LB) { console.warn("[troll-casino] leaderboard engine not loaded"); return; }

  const ZONE = {
    troll:  { short: "Troll",  color: "#3dff8a" },
    double: { short: "Double", color: "#9a5cff" },
    triple: { short: "Triple", color: "#3ea8ff" },
    whale:  { short: "Whale",  color: "#ffc94d" },
    rug:    { short: "Rugged", color: "#ff3358" },
  };

  LB.register({
    gameId: "troll-casino",
    gameName: "Troll Casino",

    // local player's stored aggregate
    blank: () => ({ spins: 0, hits: 0, bestMult: 0, streak: 0, rugs: 0 }),
    reduce: (you, ev) => {
      you.spins++;
      if (ev.zone === "rug") you.rugs++;
      if (ev.won) {
        you.hits++;
        you.streak = Math.max(0, you.streak) + 1;
        you.bestMult = Math.max(you.bestMult, ev.mult || 0);
      } else {
        you.streak = 0;
      }
    },

    derive: e => ({
      hitRate: e.spins ? (e.hits || 0) / e.spins : 0,
    }),

    columns: [
      { key: "spins",    label: "Spins",  align: "num" },
      { key: "hits",     label: "Hits",   align: "num", accent: "green" },
      { key: "hitRate",  label: "Hit%",   align: "num", percent: true },
      { key: "bestMult", label: "Best ×", align: "num", accent: "gold", format: v => v ? "×" + v : "—" },
      { key: "rugs",     label: "Rugs",   align: "num", accent: "muted", hideSm: true },
      { key: "streak",   label: "Streak", align: "num", format: v => v > 0 ? "🔥" + v : "—" },
    ],
    rankBy: ["bestMult", "hitRate", "hits", "spins"],

    player: {
      dotColor: e => (e.bestMult >= 20 ? ZONE.whale.color : e.bestMult >= 5 ? ZONE.triple.color : ZONE.troll.color),
      sublabel: e => e.bestMult ? `best ×${e.bestMult}` : "no wins yet",
    },

    mockRival: rng => {
      const spins = 12 + Math.floor(rng() * 60);
      const hits = Math.round(spins * (0.3 + rng() * 0.35));
      const mults = [2, 2, 2, 3, 3, 5, 5, 20];
      return {
        spins, hits,
        bestMult: hits ? mults[Math.floor(rng() * mults.length)] : 0,
        rugs: Math.floor(spins / 24 + rng() * 2),
        streak: Math.floor(rng() * Math.min(7, hits + 1)),
      };
    },

    prizes: {
      poolLabel: "Mock prize pool · Troll Casino",
      pool: "500 USDC  +  2.5M $TROLL",
    },
  });
})();
