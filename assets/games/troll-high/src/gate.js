/* Troll High — account gate. Login is required (design doc decision 3),
   unlike most arcade games here which let guests play. Mirrors Troll
   Casino's #tc-gate pattern (assets/games/troll-casino/casino-money-ui.js)
   since that's the only other "hard" gate in this repo, just restyled and
   wired to resolve a promise instead of unhiding a canvas.

   SSO note: TrollrunnerAccounts shares a session cookie across all
   *.trollrunner.net origins, so a player already logged into another game
   on this domain skips the form entirely — see troll-accounts.js's
   adoptSsoCookie(). */

const $ = id => document.getElementById(id);

function accounts() { return window.TrollrunnerAccounts; }

/* Resolves with {userId, username, ...} once a real session exists.
   Drives the #th-title DOM: loading -> gate form -> welcome -> (caller
   hides #th-title and starts the game on the Start click). */
export function awaitAuth() {
  return new Promise(resolve => {
    const loading = $("th-gate-loading"), gate = $("th-gate"), welcome = $("th-welcome");
    const nameEl = $("th-welcome-name");
    let mode = "login";
    let resolved = false;

    function showWelcome(session) {
      loading.hidden = true;
      gate.hidden = true;
      welcome.hidden = false;
      nameEl.textContent = session.username || "troll";
      if (!resolved) { resolved = true; resolve(session); }
    }

    function buildForm() {
      loading.hidden = true;
      gate.hidden = false;

      const tabs = gate.querySelectorAll(".th-tab-row button");
      const idLabel = $("th-gate-id-label");
      const usernameField = $("th-gate-username-field");
      const emailField = $("th-gate-email-field");
      const submitBtn = $("th-gate-submit");
      const statusEl = $("th-gate-status");

      function setMode(next) {
        mode = next;
        tabs.forEach(t => t.classList.toggle("is-active", t.dataset.tab === mode));
        const isSignup = mode === "signup";
        usernameField.hidden = !isSignup;
        emailField.hidden = !isSignup;
        idLabel.textContent = isSignup ? "Username" : "Username or email";
        submitBtn.textContent = isSignup ? "Create account" : "Log in";
        statusEl.textContent = "";
      }
      tabs.forEach(t => t.addEventListener("click", () => setMode(t.dataset.tab)));

      $("th-gate-form").addEventListener("submit", async ev => {
        ev.preventDefault();
        submitBtn.disabled = true;
        statusEl.className = "th-gate-status";
        statusEl.textContent = mode === "signup" ? "Creating account…" : "Logging in…";
        try {
          let session;
          if (mode === "signup") {
            const username = $("th-gate-username").value.trim();
            const email = $("th-gate-email").value.trim();
            const password = $("th-gate-password").value;
            session = await accounts().register({ username, email, password });
          } else {
            const identifier = $("th-gate-identifier").value.trim();
            const password = $("th-gate-password").value;
            session = await accounts().login({ identifier, password });
          }
          showWelcome(session);
        } catch (e) {
          statusEl.className = "th-gate-status is-bad";
          statusEl.textContent = (e && e.message) || "Something went wrong.";
          submitBtn.disabled = false;
        }
      });
    }

    async function check() {
      const a = accounts();
      if (!a) { setTimeout(check, 150); return; } // troll-accounts.js not parsed yet
      const session = a.getCachedProfile() || await a.getSession();
      if (session) { showWelcome(session); return; }
      buildForm();
    }

    window.addEventListener("trollrunner:auth-changed", e => { if (e.detail) showWelcome(e.detail); });

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", check);
    else check();
  });
}
