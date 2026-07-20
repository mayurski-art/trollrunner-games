/* Troll High arcade-launcher smoke test: computer lab CRTs boot the real
   arcade games in-world (design doc decision 4) via a same-origin iframe.
   Verifies the launch/close flow, that the right game actually loads
   (checking the iframe's own document title), that player movement
   freezes while a game is open, and that closing clears the iframe src
   (stops the embedded game rather than leaving it running behind the
   overlay) instead of just hiding the overlay. Also confirms a
   flavor-only desk still shows its own per-instance memory text instead
   of the shared generic one. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8956;
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
    if (!['error', 'warning'].includes(m.type())) return;
    if (m.text().includes('frame-ancestors') || isExpectedAuthNoise(m.text())) return;
    // Embedded arcade games run in their own iframe and are independently
    // tested by their own smoke suites; a resource hiccup inside one isn't
    // a Troll High bug. Only the top frame's own console noise counts here.
    if (m.location().url && m.location().url !== page.url() && m.text().includes('Failed to load resource')) return;
    issues.push(m.text());
  });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));

  await stubAuth(page);
  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');
  await dismissOrientation(page);

  // Into the Computer Lab
  await page.evaluate(() => window.__th.warpTo(51, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "computer-lab"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));

  // Bridge Patrol desk is at (3,5) — face it and read the hint first
  await page.evaluate(() => window.__th.warpTo(4, 7));
  await hold(page, 'ArrowUp', 120);
  const hint = await page.$eval('#th-hint', el => el.textContent);
  log(/Bridge Patrol/i.test(hint), `hint offers to play Bridge Patrol: ${JSON.stringify(hint)}`);

  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.arcadeOpen === true', { timeout: 3000 });
  log(true, 'pressing E on a game desk opens the arcade overlay');
  const title = await page.$eval('#th-crt-title', el => el.textContent);
  log(title === 'Bridge Patrol', `CRT titlebar shows the game name (${JSON.stringify(title)})`);

  // Confirm the IFRAME actually loaded the real game, not just an empty shell
  await new Promise(r => setTimeout(r, 1500));
  const frameLoaded = await page.evaluate(() => {
    const f = document.getElementById('th-arcade-iframe');
    try { return f.contentDocument && f.contentDocument.title; } catch (e) { return null; }
  });
  log(/Bridge Patrol/i.test(frameLoaded || ''), `iframe actually loaded Bridge Patrol's real page (title: ${JSON.stringify(frameLoaded)})`);

  // Movement frozen while open
  const p0 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  await hold(page, 'ArrowRight', 400);
  const p1 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  log(p0.x === p1.x && p0.y === p1.y, 'player movement is frozen while a game is open');

  // Close via E (matches the memory/dialogue close convention) and confirm
  // the iframe is actually cleared, not just hidden
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.arcadeOpen === false', { timeout: 3000 });
  const srcAfterClose = await page.$eval('#th-arcade-iframe', el => el.src);
  log(srcAfterClose.includes('about:blank'), `closing clears the iframe src, stopping the embedded game (${srcAfterClose})`);

  // A different desk launches a different game
  await page.evaluate(() => window.__th.warpTo(16, 7));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.arcadeOpen === true', { timeout: 3000 });
  const title2 = await page.$eval('#th-crt-title', el => el.textContent);
  log(title2 === 'Troll Kombat', `a different desk launches a different game (${JSON.stringify(title2)})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.arcadeOpen === false', { timeout: 3000 });

  // Flavor-only desk shows its own per-instance memory, not the shared
  // generic "Computer 7" text every other room's computer-desk uses
  await page.evaluate(() => window.__th.warpTo(4, 10));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  const memTitle = await page.$eval('#th-memory h3', el => el.textContent);
  log(/Computer 5/i.test(memTitle), `flavor-only desk shows its own per-instance memory (${JSON.stringify(memTitle)}), not the shared generic one`);
  await page.keyboard.press('KeyE');

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
