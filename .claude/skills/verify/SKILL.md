---
name: verify
description: How to run and verify games in this repo end-to-end with headless Chrome.
---

# Verifying trollrunner-games changes

All games are static HTML+JS at the repo root (no build step). Verify by
serving the repo and driving the real page in headless Chrome.

## Recipe

1. Serve the repo root over HTTP (any static server). Don't use file:// —
   the CSP meta tags and script paths assume an origin.
2. Drive with puppeteer-core against the installed system Chrome
   (`C:/Program Files/Google/Chrome/Application/chrome.exe`) — no browser
   download needed. `npm i puppeteer-core` in a scratch dir.
3. **CRITICAL — pass these launch args** or `requestAnimationFrame` is
   throttled to ~4fps (or frozen) in headless Chrome on Windows and every
   rAF-driven game loop appears dead while event handlers still work:

   ```
   --disable-background-timer-throttling
   --disable-renderer-backgrounding
   --disable-backgrounding-occluded-windows
   --disable-features=CalculateNativeWinOcclusion
   ```

4. Bridge Patrol exposes `window.__bp = { G, startWave, gameOver, buildWave }`
   for state assertions and to force game-over without a full run.
   A ready-made smoke test lives at `tools/bridge-patrol-smoke.js`
   (`node tools/bridge-patrol-smoke.js` after `npm i puppeteer-core`).

## Gotchas learned the hard way

- CSS that sets `display: flex` on a container overrides the `hidden`
  attribute's UA `display: none` — hidden overlays then sit on top and
  swallow clicks. Game stylesheets need `[hidden] { display: none !important; }`.
- After hiding a popover, its focused button can keep focus for a beat;
  blur it explicitly or keyboard shortcuts get eaten by the button.
- The `frame-ancestors` CSP console warning is expected — that directive
  is ignored in `<meta>` tags; the other games emit it too.
