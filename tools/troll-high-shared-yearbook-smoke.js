/* Troll High SHARED yearbook end-to-end smoke test (design doc §23 Phase 6).
   Unlike troll-high-yearbook-smoke.js (which uses the fast stub session and
   only proves the graceful-failure path), this drives two REAL signed-up
   throwaway accounts (clddbg-prefixed, matching the repo's Troll Casino /
   gate-smoke convention) — real Supabase JWTs, so RLS actually allows the
   writes. Alice takes a photo; it should both land in her own roll AND
   show up in Bob's Class Yearbook tab, proving the shared table + policies
   in docs/troll_high_shared_yearbook.sql actually work end to end.

   REQUIRES docs/troll_high_shared_yearbook.sql to have been run in the
   Supabase SQL editor first — same one-time setup as the personal
   yearbook's own migration. Without it, Alice's capture still succeeds
   (personal storage bucket already exists) but the shared insert 400s and
   this test's "Bob sees Alice's photo" assertion fails. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8952;
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

async function signUpVisitor(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1024, height: 720 });
  const issues = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors') && !/Failed to load resource.*404/i.test(m.text())) issues.push(m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));

  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#th-gate:not([hidden])', { timeout: 15000 });

  const username = 'clddbgthsy' + Math.random().toString(36).slice(2, 8);
  const password = 'Debug-Pass-' + Math.random().toString(36).slice(2, 8);
  await page.click('.th-tab-row button[data-tab="signup"]');
  await page.type('#th-gate-username', username);
  await page.type('#th-gate-password', password);
  await page.click('#th-gate-submit');
  await page.waitForSelector('#th-welcome:not([hidden])', { timeout: 15000 });
  await page.click('#th-start');
  try {
    await page.waitForFunction('window.__th && window.__th.running', { timeout: 15000 });
  } catch (e) {
    const diag = await page.evaluate(() => ({
      hasTh: !!window.__th,
      running: window.__th && window.__th.running,
      titleHidden: document.getElementById('th-title')?.hidden,
      hudHidden: document.getElementById('th-hud')?.hidden,
    }));
    console.log('DIAG (signUpVisitor boot):', JSON.stringify(diag), 'issues so far:', issues);
    throw e;
  }
  await dismissOrientation(page);
  return { ctx, page, issues, username };
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1040,760', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });

  const alice = await signUpVisitor(browser);
  const bob = await signUpVisitor(browser);

  // Alice takes a real photo — real capture + real personal-roll save +
  // real shared-table insert.
  await alice.page.click('#th-btn-yearbook');
  await alice.page.waitForFunction('window.__th.yearbookOpen === true', { timeout: 3000 });
  await alice.page.click('#th-yearbook-capture');
  await alice.page.waitForFunction(
    '!document.getElementById("th-yearbook-status").hidden || window.__th.photos.length > 0',
    { timeout: 10000 }
  );
  const aliceCaptured = await alice.page.evaluate(() => window.__th.photos.length > 0);
  log(aliceCaptured, `Alice's real capture succeeded and landed in her own roll (photos=${aliceCaptured})`);
  if (!aliceCaptured) {
    const status = await alice.page.$eval('#th-yearbook-status', el => el.textContent);
    console.log('DIAG: Alice capture status:', status);
  }
  await alice.page.click('#th-yearbook-close');

  // Give the shared-table insert a moment to land, then Bob checks the
  // Class Yearbook tab for a fresh, unauthenticated Supabase client (or,
  // in this app's case, the shared table doesn't need the fetching
  // player to be the owner — that's the whole point of the public-read
  // policy).
  await new Promise(r => setTimeout(r, 1500));
  await bob.page.click('#th-btn-yearbook');
  await bob.page.waitForFunction('window.__th.yearbookOpen === true', { timeout: 3000 });
  await bob.page.click('#th-yearbook-tab-class');
  await bob.page.waitForFunction(
    () => {
      const status = document.getElementById('th-yearbook-class-status');
      const grid = document.getElementById('th-yearbook-class-grid');
      // The grid starts with a "Loading..." <p>, which is itself a child —
      // wait for either the empty-state status text or an actual photo.
      return !status.hidden || grid.querySelector('.th-yearbook-photo');
    },
    { timeout: 8000 }
  );
  const classGridCount = await bob.page.$eval('#th-yearbook-class-grid', el => el.querySelectorAll('.th-yearbook-photo').length);
  log(classGridCount > 0, `Bob's Class Yearbook tab shows at least one shared photo (count=${classGridCount})`);
  if (classGridCount > 0) {
    const captions = await bob.page.evaluate(() => [...document.querySelectorAll('#th-yearbook-class-grid .cap')].map(el => el.textContent));
    if (captions.length === 0) {
      const html = await bob.page.$eval('#th-yearbook-class-grid', el => el.innerHTML);
      console.log('DIAG: class grid innerHTML:', html);
    }
    log(captions.some(c => c.includes(alice.username)), `one of the shared photos is credited to Alice's real username (${JSON.stringify(captions)})`);
  } else {
    const status = await bob.page.$eval('#th-yearbook-class-status', el => el.textContent);
    log(false, `Class Yearbook came back empty — likely means docs/troll_high_shared_yearbook.sql hasn't been run yet (status: ${JSON.stringify(status)})`);
  }

  log(alice.issues.length === 0, 'Alice: no unexpected console errors' + (alice.issues.length ? ':\n  ' + alice.issues.join('\n  ') : ''));
  log(bob.issues.length === 0, 'Bob: no unexpected console errors' + (bob.issues.length ? ':\n  ' + bob.issues.join('\n  ') : ''));

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  console.log(`\n(test accounts: ${alice.username}, ${bob.username} — left in place, matching the repo's clddbg-prefixed throwaway convention)`);
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
