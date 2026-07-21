/* Troll High yearbook / disposable camera smoke test (design doc §21).
   The troll_high_yearbook.sql migration has been run — real end-to-end
   capture was separately verified with a real signed-up account (not
   the stub this file uses): a genuine JPEG of the actual game view
   uploaded to the right per-user folder, publicly fetchable, valid
   image/jpeg. This file uses the fast getCachedProfile stub instead
   (th-test-auth-stub.js), which has no real Supabase JWT behind it —
   same as troll_game_saves' RLS, storage RLS also rejects the stub's
   upload, so this test exercises the *graceful-failure* path (a human
   status message, not a crash) rather than a real upload. That's
   intentional, not a sign anything is broken; see troll-high-gate-smoke.js
   for the pattern this project uses when a test needs a real JWT. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8981;
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
  // Capture failures against a not-yet-created bucket log a real network
  // error to the console — that's expected right now, not a bug, so it's
  // filtered the same way other "known, explained" noise is in this suite.
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors') && !isExpectedAuthNoise(m.text()) && !/troll-high-photos|storage/i.test(m.text())) issues.push(m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));

  await stubAuth(page);
  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');
  await dismissOrientation(page);

  await page.click('#th-btn-yearbook');
  await page.waitForFunction('window.__th.yearbookOpen === true', { timeout: 3000 });
  const emptyGrid = await page.$eval('#th-yearbook-grid', el => el.children.length);
  log(emptyGrid === 0, 'starts with an empty photo grid');
  const btnLabel = await page.$eval('#th-yearbook-capture', el => el.textContent);
  log(btnLabel === 'Take a photo', `capture button reads "Take a photo" (${JSON.stringify(btnLabel)})`);

  // Movement frozen while open
  const p0 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  await page.keyboard.down('ArrowRight');
  await new Promise(r => setTimeout(r, 400));
  await page.keyboard.up('ArrowRight');
  const p1 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  log(p0.x === p1.x && p0.y === p1.y, 'player movement is frozen while the yearbook is open');

  // Capture: real upload attempt against Supabase Storage. Pre-migration
  // (bucket doesn't exist yet) this fails gracefully; the test accepts
  // either outcome as long as it's handled, not thrown.
  await page.click('#th-yearbook-capture');
  await page.waitForFunction(
    '!document.getElementById("th-yearbook-status").hidden || window.__th.photos.length > 0',
    { timeout: 8000 }
  );
  const statusHidden = await page.$eval('#th-yearbook-status', el => el.hidden);
  const photoCount = await page.evaluate(() => window.__th.photos.length);
  if (photoCount > 0) {
    log(true, `capture succeeded — the troll_high_yearbook.sql migration has already been run (photos=${photoCount})`);
    const gridCount = await page.$eval('#th-yearbook-grid', el => el.children.length);
    log(gridCount === photoCount, `yearbook grid reflects the captured photo (${gridCount})`);
  } else {
    const statusText = await page.$eval('#th-yearbook-status', el => el.textContent);
    log(!statusHidden && statusText.length > 0, `capture with no real JWT (stub session) fails gracefully with a human status message, not a crash (${JSON.stringify(statusText)})`);
  }

  // Shared Class Yearbook tab (design doc §23 Phase 6) — reads are public
  // (RLS `using (true)`), so this succeeds even under the stub session
  // once docs/troll_high_shared_yearbook.sql has been run — it may come
  // back either empty or populated with real photos from other real-
  // account test runs (troll-high-shared-yearbook-smoke.js). Either way
  // it must fail soft, never crash. WRITES still need a real JWT — that
  // half is what the stub session can't do, covered separately there.
  await page.click('#th-yearbook-tab-class');
  await page.waitForFunction(
    () => {
      const status = document.getElementById('th-yearbook-class-status');
      const grid = document.getElementById('th-yearbook-class-grid');
      return !status.hidden || grid.querySelector('.th-yearbook-photo');
    },
    { timeout: 8000 }
  );
  const classPhotoCount = await page.$eval('#th-yearbook-class-grid', el => el.querySelectorAll('.th-yearbook-photo').length);
  if (classPhotoCount === 0) {
    const classStatusText = await page.$eval('#th-yearbook-class-status', el => el.textContent);
    log(/No class photos yet/i.test(classStatusText), `Class Yearbook tab fails soft to an empty state (${JSON.stringify(classStatusText)})`);
  } else {
    log(true, `Class Yearbook tab shows real shared photos from other accounts (count=${classPhotoCount})`);
  }
  const classTabActive = await page.evaluate(() => document.getElementById('th-yearbook-tab-class').classList.contains('is-active'));
  log(classTabActive, 'Class Yearbook tab shows as active after switching to it');
  await page.click('#th-yearbook-tab-mine');
  const mineTabActive = await page.evaluate(() => document.getElementById('th-yearbook-tab-mine').classList.contains('is-active'));
  log(mineTabActive, 'switching back to My Roll re-activates that tab');

  await page.click('#th-yearbook-close');
  await page.waitForFunction('window.__th.yearbookOpen === false', { timeout: 3000 });

  log(issues.length === 0, 'no unexpected console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
