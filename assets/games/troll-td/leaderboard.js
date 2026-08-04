/* ============================================================================
   TROLL TD — leaderboard CONFIG for the shared arcade engine.

   The engine (assets/js/troll-leaderboard.js) does all the work; this file
   only describes Troll TD's stats. The game feeds sessions via:
       TrollLeaderboard.record("troll-td", { round, pops, mapId, diffId, heroLevel })
   ============================================================================ */
(() => {
  'use strict';
  const LB = window.TrollLeaderboard;
  if (!LB) { console.warn('[troll-td] leaderboard engine not loaded'); return; }
  const fInt = LB.fmt.int;

  LB.register({
    gameId: 'troll-td',
    gameName: 'Troll TD',
    mount: '#lb-root',

    blank: () => ({ sessions: 0, bestRound: 0, pops: 0, heroLevel: 0 }),
    reduce: (you, ev) => {
      you.sessions = (you.sessions || 0) + 1;
      you.bestRound = Math.max(you.bestRound || 0, Math.round(ev.round || 0) + 1);
      you.pops = (you.pops || 0) + Math.max(0, Math.round(ev.pops || 0));
      you.heroLevel = Math.max(you.heroLevel || 0, Math.round(ev.heroLevel || 0));
    },

    columns: [
      { key: 'bestRound', label: 'Round', align: 'num', accent: 'green' },
      { key: 'pops', label: 'Pops', align: 'num', accent: 'gold' },
      { key: 'heroLevel', label: 'Hero Lv', align: 'num', accent: 'muted', hideSm: true },
    ],
    rankBy: ['bestRound', 'pops', 'heroLevel'],

    player: {
      dotColor: () => '#5cd66c',
      sublabel: (e) => (e.sessions ? ('Round ' + fInt(e.bestRound) + ' · 💥 ' + fInt(e.pops)) : 'Island unguarded'),
    },

    mockRival: (rng) => ({
      bestRound: 1 + Math.floor(rng() * 82),
      pops: 40 + Math.floor(rng() * 30000),
      heroLevel: 1 + Math.floor(rng() * 14),
      sessions: 1 + Math.floor(rng() * 40),
    }),

    footNote: 'Every row here is a real player — furthest round reached, total pops, and Boss Troll hero level, reset every Monday.',

    prizes: {
      poolLabel: 'Mock prize pool · Troll TD',
      pool: '750 USDC  +  1.5M $TROLL',
    },
  });
})();
