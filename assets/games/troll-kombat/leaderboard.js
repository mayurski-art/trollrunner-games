/* ============================================================================
   TROLL KOMBAT  —  leaderboard CONFIG for the shared arcade engine.

   The engine (assets/js/troll-leaderboard.js) does all the work; this file only
   describes Troll Kombat's stats. game.js feeds results via:
       TrollLeaderboard.record("troll-kombat", { char, won, kos, damage, mode })
   ============================================================================ */
(() => {
  "use strict";
  const LB = window.TrollLeaderboard;
  if (!LB) { console.warn("[troll-kombat] leaderboard engine not loaded"); return; }

  // Character display data (kept local so the module is self-contained).
  const CHAR = {
    pepe:      { short: "Pepe",      color: "#3dff5e" },
    doge:      { short: "Doge",      color: "#ffcf33" },
    gladiator: { short: "Gladiator", color: "#dfe6ef" },
  };
  const charShort = id => (CHAR[id] && CHAR[id].short) || (id || "—");
  const charColor = id => (CHAR[id] && CHAR[id].color) || "#9a5cff";
  const favChar = counts => {
    let best = null, n = -1;
    for (const id in counts) if (counts[id] > n) { n = counts[id]; best = id; }
    return best;
  };
  const CHAR_IDS = Object.keys(CHAR);

  LB.register({
    gameId: "troll-kombat",
    gameName: "Troll Kombat",

    // local player's stored aggregate
    blank: () => ({ wins: 0, losses: 0, kos: 0, damage: 0, streak: 0, charCounts: {} }),
    reduce: (you, ev) => {
      if (ev.won) { you.wins++; you.streak = Math.max(0, you.streak) + 1; }
      else        { you.losses++; you.streak = 0; }
      you.kos += ev.kos || 0;
      you.damage += Math.max(0, Math.round(ev.damage || 0));
      if (ev.char) you.charCounts[ev.char] = (you.charCounts[ev.char] || 0) + 1;
    },

    // computed fields available to columns/rank/player (runs on rivals + you)
    derive: e => {
      const fights = (e.wins || 0) + (e.losses || 0);
      const char = e.char || (e.charCounts ? favChar(e.charCounts) : null);
      return { fights, winRate: fights ? e.wins / fights : 0, char, charName: char ? charShort(char) : "—" };
    },

    columns: [
      { key: "wins",    label: "W",      align: "num", accent: "green" },
      { key: "losses",  label: "L",      align: "num", accent: "muted" },
      { key: "winRate", label: "Win%",   align: "num", percent: true },
      { key: "fights",  label: "Fights", align: "num", hideSm: true },
      { key: "kos",     label: "KOs",    align: "num" },
      { key: "damage",  label: "Damage", align: "num", hideSm: true },
      { key: "streak",  label: "Streak", align: "num", accent: "gold", format: v => v > 0 ? "🔥" + v : "—" },
    ],
    rankBy: ["wins", "winRate", "damage", "kos"],

    player: {
      dotColor: e => charColor(e.char),
      sublabel: e => e.charName || "—",
    },

    mockRival: rng => {
      const char = CHAR_IDS[Math.floor(rng() * CHAR_IDS.length)];
      const fights = 10 + Math.floor(rng() * 32);
      const wins = Math.round(fights * (0.4 + rng() * 0.5));
      return {
        char, charName: charShort(char),
        wins, losses: fights - wins,
        kos: Math.round(wins * (0.35 + rng() * 0.45)),
        damage: Math.round(fights * (120 + rng() * 140)),
        streak: Math.floor(rng() * Math.min(9, wins + 1)),
      };
    },

    prizes: {
      poolLabel: "Mock prize pool · Troll Kombat",
      pool: "750 USDC  +  1.75M $TROLL",
    },
  });
})();
