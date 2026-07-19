# Troll Kombat — Online Multiplayer via Invite Code

Design doc, drafted 2026-07-18. Goal: two players on different devices fight
each other by sharing a short invite code, the same way Trollrreria co-op
works today. Local hot-seat versus stays exactly as it is.

## Player experience

1. On the match-type screen, **Multiplayer** now leads to a new choice:
   **Local** (same keyboard, today's behavior) or **Online**.
2. Online opens a lobby overlay:
   - **Host match** → shows a 5-character code (e.g. `TR8XK`) + "Waiting
     for challenger…". Code alphabet drops confusable chars (no I/L/O/0/1),
     same as Trollrreria.
   - **Join match** → type the code, hit Join.
3. When both are in, both screens jump to fighter select. Host is P1,
   joiner is P2. Each player picks their own fighter on their own screen;
   the other side's pick locks live (the existing "taken" ring + badge UI).
   Duplicate fighters stay disallowed, as in local versus.
4. Host picks the stage + random-map toggle; the joiner sees the host's
   live selection mirrored with a "Host is choosing…" hint.
5. Countdown → fight. Rematch / change-fighter flows work over the wire.
6. If the other player vanishes (tab closed, network drop), a "Connection
   lost" overlay appears with a quit-to-menu button.

## Netcode model: host-authoritative (the only viable option)

The fight engine is **not deterministic**: variable `requestAnimationFrame`
timestep and `Math.random()` inside the sim (AI, map shifts, particles,
random stage). Lockstep/rollback would need a full engine rewrite, so:

- **Host runs the one true simulation.** The joiner ("guest") is a thin
  client: it sends its inputs up and renders the host's state back.
- **Guest → host, ~30 Hz + on key change:** compact intent packet — held
  directions/block plus tap counters for punch/kick/special/dash (counters,
  not booleans, so a quick tap between packets is never lost).
- **Host → guest, ~20 Hz:** snapshot of both fighters (x, y, vy, facing,
  state, state timer, hp, meter, stamina, rounds), projectiles, round
  timer/phase/round number, current stage id. Guest interpolates between
  snapshots so movement looks smooth.
- **One-shot events** (not in snapshots): announcements (ROUND 2 / K.O. /
  SUDDEN DEATH / MAP SHIFTING), hit + block impacts (so the guest plays
  sfx/hitsparks/shake), stage shifts, round end, match end, finisher
  start, pause votes, rematch, quit.

Input plumbing is already netplay-shaped: controllers are
`{type:"human", slot}` per fighter and `readIntent(slot)` reads a per-slot
input context. Online adds a `{type:"remote"}` controller whose input
context is filled from network packets instead of the keyboard. On the
guest, `match.update()` is replaced by "apply latest snapshot +
interpolate" — rendering, HUD and audio code stay untouched.

**Latency honesty:** the guest feels roughly one round-trip (~80–150 ms via
Supabase Realtime) between pressing a button and seeing the result; the
host feels none. That's fine for this game's casual pace, and the generous
hitboxes + hitstop already mask small delays. No prediction in v1.

## Transport

Modeled on `assets/games/trollrreria/src/net.js` (proven in production):

- Supabase Realtime broadcast channel `kombat:CODE`, `self: false`,
  `eventsPerSecond` raised to ~30. Own client with `persistSession: false`
  (isolated from the accounts client, like Trollrreria). No new tables, no
  SQL to run — broadcast only.
- `BroadcastChannel` fallback so two tabs in the same browser can play
  (free local testing path).
- Room is 2 players max; a third joiner gets a "room full" rejection.
  Handshake: guest sends `hello`, host replies `welcome` (or `full`),
  then both enter fighter select. Codes aren't reserved anywhere — a code
  is "taken" only while its host channel is open, which is fine at this
  scale (Trollrreria works the same way).
- Liveness: input/snapshot traffic doubles as heartbeat; 5 s of silence →
  connection-lost overlay.
- The Troll Kombat page's CSP already allows
  `wss://tjsyhfplxjtakdfkpdtg.supabase.co` and supabase-js is already
  loaded — no HTML security changes needed.

## Synced flows beyond the fight

- **Fighter select:** pick messages broadcast both ways; the continue gate
  waits for both picks. Reset/back notifies the other side.
- **Pause votes:** the existing majority-vote pause maps 1:1 — press/
  approve/cancel/resume become events. The host owns the actual freeze
  (guest's sim is already just a view). Guest's pause key = its own slot.
- **Rematch / change fighter:** result-screen buttons broadcast; both
  clients re-enter the same state. Either side quitting notifies the other.
- **Leaderboard/XP:** unchanged — each side records its own local result
  with `mode: "mp"`, exactly like local versus today.

## Explicitly out of v1

- **Wagers online — disabled.** The manual-review wager module assumes both
  players share one machine; two remote strangers need the Part 2 escrow
  systems (docs/PART2-SYSTEMS.md). Online mode shows "wagers are
  local-only for now."
- Spectators, 3–4 players, matchmaking/quick-match, reconnection to a
  match in progress (drop = match over), guest-side input prediction.

## Files touched

| File | Change |
| --- | --- |
| `assets/games/troll-kombat/net.js` | **New.** Lobby, transport, protocol, snapshot codec (~350 lines, modeled on Trollrreria's net.js) |
| `troll-kombat.html` | Local/Online choice + lobby overlay + connection-lost overlay markup; load net.js |
| `assets/games/troll-kombat/game.js` | Remote controller type; guest snapshot-apply path; event hooks (announce/hits/pause/rematch); flow screens for lobby |
| `assets/games/troll-kombat/style.css` | Lobby + code display + connection-lost styles |

## Build phases

1. **Lobby** — Local/Online screen, host/join with code, handshake,
   connection-lost detection. Verify: two browser tabs pair up.
2. **Synced select** — fighter picks + stage choice mirrored both ways.
3. **Netplay** — inputs up, snapshots + events down, guest interpolation;
   full match playable end-to-end including sudden death + finishers.
4. **Hardening** — pause votes, rematch/quit flows, disconnect mid-round,
   mobile touch input for the guest, headless verify pass, cache-bust
   versions.
