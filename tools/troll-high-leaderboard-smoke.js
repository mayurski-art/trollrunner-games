/* Troll High leaderboard smoke test: the overlay panel opens and closes,
   freezes player movement while open, and a new memory discovery actually
   calls through to TrollLeaderboard.record() with sane arguments —
   verified by spying on the global (installed via evaluateOnNewDocument,
   so the spy wraps whatever the real script defines, same technique as
   the auth stub).

   Note: TrollNotis was NOT wired here despite an earlier plan to use it
   for "rare find" toasts — its real API (troll-notis.js) turned out to be
   a specific social-media cross-post announcer (X/Instagram, with
   platform badges and a CTA link out), not a generic achievement-toast
   system. Forcing memory discoveries through it would have been a
   mismatch; the ✨ sparkle on the memory card is the discovery feedback. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8953;
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

/* Same setter-trap trick as the auth stub: wraps .record()/.push() the
   instant each global gets assigned, so there's no race with when the
   real script defines it. Calls collect into window.__thSpy. */
const SPY_JS = `
  window.__thSpy = { records: [] };
  function trap(name, methodName, sink) {
    let real;
    Object.defineProperty(window, name, {
      configurable: true,
      get() { return real; },
      set(v) {
        if (v && v[methodName] && !v.__thSpied) {
          const orig = v[methodName].bind(v);
          v[methodName] = (...args) => { sink.push(args); return orig(...args); };
          v.__thSpied = true;
        }
        real = v;
      },
    });
  }
  trap('TrollLeaderboard', 'record', window.__thSpy.records);
`;

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
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors') && !isExpectedAuthNoise(m.text())) issues.push(m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));

  await stubAuth(page);
  await page.evaluateOnNewDocument(SPY_JS);
  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');
  await dismissOrientation(page);

  // Overlay open/close + movement freeze
  const p0 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  await page.click('#th-btn-leaderboard');
  await new Promise(r => setTimeout(r, 200));
  log(await page.evaluate(() => !document.getElementById('th-leaderboard-overlay').hidden), 'leaderboard overlay opens on button click');
  await hold(page, 'ArrowRight', 400);
  const p1 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  log(p0.x === p1.x && p0.y === p1.y, 'player movement is frozen while the leaderboard is open');
  await page.click('#th-leaderboard-close');
  await new Promise(r => setTimeout(r, 100));
  log(await page.evaluate(() => document.getElementById('th-leaderboard-overlay').hidden), 'leaderboard overlay closes on the close button');
  const lbRootHasContent = await page.evaluate(() => document.getElementById('lb-root').children.length > 0);
  log(lbRootHasContent, 'the leaderboard engine actually rendered something into #lb-root');

  // Finding a new memory reports to both the leaderboard and TrollNotis
  await page.evaluate(() => window.__th.warpTo(7, 3));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-memory")');

  const spy = await page.evaluate(() => window.__thSpy);
  log(spy.records.length === 1 && spy.records[0][0] === 'troll-high' && spy.records[0][1].memories === 1,
    `TrollLeaderboard.record() called with the right gameId + count: ${JSON.stringify(spy.records)}`);

  // Finding the SAME memory again must not double-report (isNew guard)
  await page.evaluate(() => window.__th.warpTo(7, 3));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-memory")');
  const spy2 = await page.evaluate(() => window.__thSpy);
  log(spy2.records.length === 1, 're-finding the same memory does not re-report to the leaderboard');

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
