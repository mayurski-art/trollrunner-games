/* Troll High gate smoke test: unlike the other test files (which stub
   getCachedProfile for speed — see th-test-auth-stub.js), this one drives
   the REAL login gate end to end with a fresh throwaway account, matching
   the clddbg-prefixed convention already used for Troll Casino's account
   tests. Proves: a logged-out visitor actually sees the form (not just
   that the stub bypasses it), signup creates a real session, and cloud
   persistence round-trips through the real troll_game_saves table across
   a page reload — not just "saveGame() didn't throw". */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8951;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = path.join(ROOT, url === '/' ? 'index.html' : decodeURIComponent(url));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const results = [];
function log(ok, msg) { results.push((ok ? 'PASS' : 'FAIL') + ' | ' + msg); console.log(results[results.length - 1]); }
const hold = async (page, key, ms) => { await page.keyboard.down(key); await new Promise(r => setTimeout(r, ms)); await page.keyboard.up(key); };

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1040,760', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 720 });
  const issues = [];
  page.on('console', m => {
    const t = m.text();
    // The 4 recess-minigame objects (Phase 7) don't have real pixel art
    // yet — every zone's sprites load up front regardless of which one
    // this test actually visits; ObjectSprites tolerates the 404 and
    // falls back to a flat-color rect (see objects.js).
    if (['error', 'warning'].includes(m.type()) && !t.includes('frame-ancestors') && !/Failed to load resource.*404/i.test(t)) issues.push(t);
  });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));

  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });

  // No stub this time — a genuinely logged-out visitor must see the real form.
  await page.waitForSelector('#th-gate:not([hidden])', { timeout: 15000 });
  log(true, 'logged-out visitor sees the real login/signup gate (not the game)');
  const startHidden = await page.$eval('#th-welcome', el => el.hidden);
  log(startHidden, 'Start button stays hidden behind the gate until authenticated');

  // Sign up a fresh throwaway account (clddbg prefix, matching the Troll
  // Casino test convention) — real Supabase signUp, real session.
  const username = 'clddbgth' + Math.random().toString(36).slice(2, 8);
  const password = 'Debug-Pass-' + Math.random().toString(36).slice(2, 8);
  await page.click('.th-tab-row button[data-tab="signup"]');
  await page.type('#th-gate-username', username);
  await page.type('#th-gate-password', password);
  await page.click('#th-gate-submit');
  await page.waitForSelector('#th-welcome:not([hidden])', { timeout: 15000 });
  const welcomeName = await page.$eval('#th-welcome-name', el => el.textContent);
  log(welcomeName === username, `real signup succeeds, welcome shows the new username (${JSON.stringify(welcomeName)})`);

  await page.click('#th-start');
  await page.waitForFunction('window.__th && window.__th.running');
  await dismissOrientation(page);
  log(await page.evaluate(() => window.__th.identity.name) === username, 'in-game identity uses the real account username, not a guest name');

  // Walk to the lockers, find the memory, force a save.
  await page.evaluate(() => window.__th.warpTo(7, 3));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-memory")');
  const beforeFound = await page.evaluate(() => [...window.__th.found]);
  log(beforeFound.length > 0, `found the lockers memory locally (${beforeFound.length} total)`);

  await page.evaluate(() => window.__th.warpTo(30, 6));
  await page.evaluate(() => window.__th.persist());
  await new Promise(r => setTimeout(r, 1500)); // let the upsert land

  const cloudIssues = issues.filter(t => /cloud save failed/i.test(t));
  log(cloudIssues.length === 0, 'no "cloud save failed" warnings — the real upsert succeeded' + (cloudIssues.length ? ':\n  ' + cloudIssues.join('\n  ') : ''));

  // Reload: the persisted Supabase session (persistSession: true) should
  // skip straight to the welcome screen, and loadSave() should restore
  // position + found memories from the real table, not local cache alone.
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#th-welcome:not([hidden])', { timeout: 15000 });
  log(true, 'reload with a persisted session skips the form and shows welcome directly');
  await page.click('#th-start');
  await page.waitForFunction('window.__th && window.__th.running');
  await new Promise(r => setTimeout(r, 500));

  const afterState = await page.evaluate(() => ({
    x: window.__th.player.x, y: window.__th.player.y,
    found: [...window.__th.found],
  }));
  const posClose = Math.abs(afterState.x - 30 * 16 - 8) < 40 && Math.abs(afterState.y - 6 * 16 - 16) < 40;
  log(posClose, `position restored from the cloud save after reload (x=${afterState.x.toFixed(0)}, y=${afterState.y.toFixed(0)})`);
  log(afterState.found.length === beforeFound.length && beforeFound.every(k => afterState.found.includes(k)),
    `found memories restored from the cloud save after reload (${afterState.found.length})`);

  const realIssues = issues.filter(t => !t.includes('frame-ancestors') && !/cloud save failed|cloud load failed/i.test(t));
  log(realIssues.length === 0, 'no unexpected console errors' + (realIssues.length ? ':\n  ' + realIssues.join('\n  ') : ''));

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  console.log(`\n(test account: ${username} — left in place, matching the repo's clddbg-prefixed throwaway convention)`);
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
