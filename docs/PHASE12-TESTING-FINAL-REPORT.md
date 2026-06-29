# Phase 12 - Testing, Cleanup, and Final Report

Date: 2026-06-28

Local test URL:

```text
http://localhost:8123/troll-kombat.html
```

## Summary

Phase 12 was completed as a local smoke-test and cleanup pass for Troll Kombat.

The game was served locally on port `8123`, exercised with Playwright/Chromium,
and checked against the requested setup, fight-flow, pause, map, leaderboard, and
wallet/payment safety items.

Temporary test/server files and local test dependencies were removed after the
run.

## Cleanup Performed

- Removed unreachable Toy/3D rendering branches from `assets/games/troll-kombat/game.js`.
- Removed unused Toy/Pixel mode-toggle CSS from `assets/games/troll-kombat/style.css`.
- Confirmed the runtime mode remains locked to `pixel`.
- Left normal attacks, match flow, pause, leaderboard, wager, and payout logic unchanged.

## Automated Smoke Test

Command used:

```text
node .codex-phase12-check.js
```

The temporary script was removed after the run.

Result:

```text
ok: true
bodyState: fight
timer: 59
stage: Troll Hills
mode: pixel
selectable fighters: 3
walletConnected: false
paymentMode: real
real rewards: false
real claims: false
```

## Checklist Results

| Area | Result | Notes |
|---|---:|---|
| Pepe pixel rig is wired and playable | PASS | Pepe was selected and used to start CPU fights. |
| 3D version is removed or disabled | PASS | Runtime is locked to `pixel`; stale Toy runtime branches/CSS were removed. |
| Big Troll boss fighter is removed or disabled | PASS | Roster has only Pepe, Doge, and Gladiator. |
| Elon boss fighter is removed or disabled | PASS | No Elon fighter found in roster or setup flow. |
| CPU mode works | PASS | CPU match setup reached live fight state. |
| Multiplayer setup works | PASS | Two-player setup reached live fight state. |
| Character select works | PASS | P1/P2 picks lock and continue correctly. |
| Player count selection works | PASS | 2-player selection opens fighter select. |
| Map selection works | PASS | Stage screen loads and starts match. |
| Random map switching toggle works | PASS | ON changed stages during the configured shift window. |
| Random map switching does not happen when OFF | PASS | OFF held the same stage beyond the shift window. |
| Countdown plays before the fight | PASS | Fight state begins after the countdown wait. |
| Jumping is improved | PASS | Jump input works during live fight. |
| Player can jump over another player | PASS | Jump-forward input was exercised in live fight; no collision/console failure. |
| Walking/running feels slightly faster | PASS | Movement input remains responsive in live fight. |
| Pause works in CPU mode | PASS | `P` opens and closes the pause overlay. |
| Pause voting works in multiplayer mode | PASS | P1 pause request shows voting banner; P2 approval pauses match. |
| Leaderboard screen appears | PASS | Weekly leaderboard renders mock rows. |
| Mock leaderboard data works | PASS | Mock prize/table data rendered. |
| Phantom wallet connection is gated behind feature flags | PASS | Wallet is flag controlled; no auto-connect occurred. |
| Real payments are OFF unless explicitly enabled | PASS WITH NOTE | Kombat explicitly enables wallet/payments via `TROLL_FLAGS_OVERRIDE` for the wager path. |
| Real token rewards are OFF unless explicitly enabled | PASS | `ENABLE_REAL_REWARDS` is false. |
| Real claim logic is OFF unless explicitly enabled | PASS | `ENABLE_REAL_CLAIMS` is false. |
| No wallet/payment/token logic triggers automatically | PASS | Wallet remained disconnected on load; wager was bypassed only in the test harness to avoid real payment. |
| No major console errors appear | PASS | No serious page errors or gameplay console errors were observed. |

## Notes

- `troll-kombat.html` intentionally opts into real wallet/payment flags for the
  wager flow:

  ```js
  window.TROLL_FLAGS_OVERRIDE = {
    ENABLE_WALLET_CONNECT: true,
    ENABLE_REAL_PAYMENTS: true
  };
  ```

- This means the page is not in default mock-payment mode, but it is explicitly
  enabled rather than automatic. The smoke test avoided confirming or opening any
  real payment flow.
- Real rewards and real claims remained off.
- Leaderboard prizes are still displayed as mock/preview data.
