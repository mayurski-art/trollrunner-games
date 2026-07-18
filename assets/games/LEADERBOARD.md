# Arcade Weekly Leaderboard — integration guide

**Every game in the arcade gets a weekly leaderboard.** It is a shared system, so
adding it to a new game is small: write a config, mount a container, and report
results. Do **not** copy/rewrite the leaderboard per game.

- Engine: [`assets/js/troll-leaderboard.js`](../js/troll-leaderboard.js) — `window.TrollLeaderboard`
- Styles: [`assets/css/troll-leaderboard.css`](../css/troll-leaderboard.css)
- Live examples: `troll-kombat/leaderboard.js` (fighter), `meme-metro/leaderboard.js` (runner)

## ⚠️ Safety (do not break)
Prizes are **display-only placeholders**. There is **no** wallet code, claim flow,
or payout anywhere in the engine, and `prizes.live` is forced `false` (the engine
strips `live:true` if a config sets it). Do not add real USDC / $TROLL payouts here
without a separate, audited money path.

## No bots — and real sync across players/devices
The engine does **not** generate fake rivals. Boards start empty and only ever
show real recorded plays (`cfg.mockRival` / `cfg.rivalNames` / `cfg.rivalCount`
are accepted for backward compat but ignored).

Every registered game gets the same **live provider** automatically — no
per-game code needed. It talks to the real Supabase backend from
[troll_accounts.sql](https://github.com/mayurski-art/mayurski-art.github.io/blob/main/assets/supabase/troll_accounts.sql)
(table `troll_leaderboard`, RPC `troll_record_game_result`, view
`troll_leaderboard_view`) via `window.TrollrunnerAccounts.getClient()`:

- **Reading** the board works for everyone, logged in or not (RLS grants
  `select` to `anon`).
- **Writing** (`record()`) requires a logged-in session — the RPC is
  `security definer` and rejects `auth.uid() is null`. If the viewer isn't
  logged in, their play still updates the local-only cache (so their own
  device shows it) but doesn't sync to other players until they log in. The
  footer shows "Log in to add your own score to the board" in that case.
- The backend score column is just `cfg.rankBy[0]` (or the first column key)
  — a coarse sort hint for the DB row. **Final on-page ranking always uses the
  full `rankBy` tuple**, computed client-side from `meta` after fetching, so
  the single numeric backend score never has to be a perfect encoding of a
  multi-key sort.
- `getBoard()` pulls this ISO week's rows (`achieved_at` between Monday
  00:00 and next Monday), newest first, and keeps only the first (=freshest)
  row per `user_id` — since `reduce()` sends the full cumulative aggregate on
  every call, that freshest row already *is* the player's current weekly
  stat line.
- If the backend/client/session isn't available for any reason, everything
  falls back to the local-only provider silently — a game never breaks
  because of this.

No new SQL, script tags, or per-game config changes are needed — `troll_accounts.sql`
was already run project-wide, and every game page already loads `supabase-js`
+ `troll-accounts.js`. To point a game at a *different* backend entirely, call
`TrollLeaderboard.setProvider(gameId, provider)` with your own
`{ getBoard(), recordEvent(ev) }` implementation.

## Add it to a new game (4 steps)

**1. Load the shared engine + styles** in the game's HTML:
```html
<link rel="stylesheet" href="assets/css/troll-leaderboard.css?v=lb-engine-v1">
...
<script src="assets/js/troll-leaderboard.js?v=lb-engine-v1" defer></script>
<script src="assets/games/<your-game>/leaderboard.js?v=<your-game>-lb-v1" defer></script>
<script src="assets/games/<your-game>/game.js?v=..." defer></script>
```

**2. Add a mount container** in the page:
```html
<section class="arcade-rack leaderboard-rack" aria-labelledby="lb-title">
  <div class="section-heading"><p class="eyebrow">Weekly ladder</p><h2 id="lb-title">Top Players</h2></div>
  <div id="lb-root" class="lb-root"><p class="lb-foot">Loading leaderboard…</p></div>
</section>
```

**3. Write `assets/games/<your-game>/leaderboard.js`** — the config:
```js
(() => {
  const LB = window.TrollLeaderboard; if (!LB) return;
  LB.register({
    gameId: "your-game",            // unique; namespaces localStorage
    gameName: "Your Game",
    mount: "#lb-root",              // auto-mounts on register

    blank: () => ({ score: 0, runs: 0 }),       // the local player's stored shape
    reduce: (you, ev) => {                        // fold one result into the aggregate
      you.runs++; you.score = Math.max(you.score, ev.score || 0);
    },

    // columns drive the table; align:"num" right-aligns + monospaces.
    columns: [
      { key: "score", label: "Best", align: "num", accent: "green" },
      { key: "runs",  label: "Runs", align: "num", accent: "muted", hideSm: true },
    ],
    rankBy: ["score", "runs"],                    // sort keys, descending

    // optional: derived fields, player cell dot/sub-label, mock rivals, prizes
    derive: e => ({ /* extra computed fields */ }),
    player: { dotColor: e => "#4dff73", sublabel: e => "" },
    mockRival: (rng, i, weekId) => ({ score: 100 + Math.floor(rng()*900), runs: 1+Math.floor(rng()*30) }),
    prizes: { poolLabel: "Mock prize pool · Your Game", pool: "100 USDC + 1M $TROLL" },
  });
})();
```

**4. Report results from the game** when a match/run ends:
```js
if (window.TrollLeaderboard) window.TrollLeaderboard.record("your-game", { score: finalScore });
```

That's it — weekly rotation (ISO week, Monday reset), countdown, "YOU" row,
mock rivals, ranking and the prize preview all come from the engine.

### Column options
`key`, `label`, `align:"num"`, `accent:"green|gold|cyan|red|purple|muted"`,
`hideSm` (hide on phones), `percent:true` (format 0–1 as %), `unit:" m"`
(suffix), `format:(v,entry)=>string`, `get:(entry)=>value`.

## Backend later (the engine is ready)
The UI only calls a per-game `provider` with `getBoard()` (async) and
`recordEvent(ev)`. The default is a `MockProvider` built from your config. To go
live, implement those two methods (e.g. Supabase/HTTP) and:
```js
TrollLeaderboard.setProvider("your-game", myProvider);
```
No game or UI code changes.

## Other API
- `TrollLeaderboard.configure(gameId, { prizes:{...} })` — update config + re-render
- `TrollLeaderboard.setPlayerName(gameId, name)` — set the "YOU" handle
- `TrollLeaderboard.refresh(gameId)` — force re-render

## Non-web games
Godot/native titles (e.g. Subway Surfer) can't use this DOM module directly.
When such a game ships a web build, expose a JS bridge that calls
`TrollLeaderboard.record(gameId, ev)`, or post results to the (future) backend.
