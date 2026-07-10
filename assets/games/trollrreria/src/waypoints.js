/* Trollrreria — fast-travel destinations. Admin-only (troll_runner) for
   now, see Game.isAdmin() in main.js. Add more entries here as spots get
   picked out; `at(game)` resolves tile coords lazily since some
   destinations (like the village) track another dynamic point rather
   than a fixed map location. */
export const WAYPOINTS = [
  {
    id: "market", name: "Market Row",
    at: game => (game.hamlets?.market
      ? { tx: game.hamlets.market.x, ty: game.hamlets.market.y }
      : { tx: game.spawn.x, ty: game.spawn.y - 2 }),
  },
  {
    id: "hearth", name: "The Hearth",
    at: game => (game.hamlets?.hearth
      ? { tx: game.hamlets.hearth.x, ty: game.hamlets.hearth.y }
      : { tx: game.spawn.x + 90, ty: game.spawn.y - 2 }),
  },
];
