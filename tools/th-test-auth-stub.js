/* Shared helper for Troll High smoke tests: Phase 6 made login required, so
   every test now needs a session before #th-start becomes clickable.
   Stubs TrollrunnerAccounts.getCachedProfile (same technique the main
   site's own verify skill uses) rather than driving a real Supabase
   signup on every test run — gate.js's awaitAuth() accepts whatever
   getCachedProfile() returns, and save.js degrades gracefully to its
   local-cache fallback when the stub session has no real Supabase JWT
   behind it (RLS rejects the writes, already caught + logged there).

   For a real end-to-end signup/login test, see troll-high-gate-smoke.js,
   which drives the actual form with a throwaway account instead. */

const STUB_JS = (userId, username) => `
  (function () {
    // A poll-and-patch here would race gate.js's own poll for
    // window.TrollrunnerAccounts — sometimes gate.js reads the real
    // (unpatched) getCachedProfile first and shows the login form instead
    // of skipping straight to the game. A property-setter trap patches
    // synchronously in the same tick troll-accounts.js assigns the global,
    // before any other polling code can observe the unpatched version.
    let real;
    Object.defineProperty(window, 'TrollrunnerAccounts', {
      configurable: true,
      get() { return real; },
      set(v) {
        if (v && !v.__thStubbed) {
          v.getCachedProfile = () => ({
            userId: ${JSON.stringify(userId)}, username: ${JSON.stringify(username)},
            level: 1, xp: 0, avatarUrl: null, avatar: "🧌",
          });
          v.__thStubbed = true;
        }
        real = v;
      },
    });
  })();
`;

/* Call before page.goto() so the stub is present before troll-accounts.js
   (and gate.js's polling check()) ever run. */
async function stubAuth(page, { userId = 'test-' + Math.random().toString(36).slice(2, 10), username = 'TestTroll' } = {}) {
  await page.evaluateOnNewDocument(STUB_JS(userId, username));
  return { userId, username };
}

/* The stub session has no real Supabase JWT behind it, so any REST call
   against an RLS-protected table (troll_game_saves) comes back 400/401 —
   expected and already handled gracefully (save.js falls back to its local
   cache, logging a console.warn). Filter that specific noise out of a
   test's console-error assertions; a genuine bug still shows through. */
/* Chrome's own "Failed to load resource" console text never includes the
   URL (that only shows up via the network events, not m.text()), so this
   can't be scoped to specific filenames — same reason troll-high-npc-
   smoke.js already filters bare 404s wholesale. Currently the only source
   is the 4 recess-minigame court/pole objects (Phase 7) not having real
   pixel art yet — objects.js's ObjectSprites loads every OBJECT_DEFS
   sprite up front regardless of which zones a test visits, and falls back
   to a flat-color rect (existing, intentional tolerance — see objects.js). */
function isExpectedAuthNoise(text) {
  return /Failed to load resource.*(400|401|404)/i.test(text)
    || /\[troll-high\] cloud (load|save) (failed|threw)/i.test(text);
}

module.exports = { stubAuth, isExpectedAuthNoise };
