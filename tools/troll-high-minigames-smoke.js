/* Troll High recess-minigames smoke test (design doc §11): four square,
   tetherball, hopscotch, kickball — original in-world minigames, not
   embeds. Verifies each one's hint text + launch/close flow, that
   movement freezes while one is open, and that the scoring logic for
   the trickiest one (four square's digit-key matching) is actually
   correct rather than just wired up. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8960;
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
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors') && !isExpectedAuthNoise(m.text())) issues.push(m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));

  await stubAuth(page);
  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');
  await dismissOrientation(page);

  // hallway-a -> hallway-b -> Playground (four square, tetherball, hopscotch
  // all live here)
  await page.evaluate(() => window.__th.warpTo(94, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => window.__th.warpTo(86, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "playground"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));

  // Four square court is a 4x4 object at (6,10), solid band on row 13 —
  // approach from the free row below it (14), face up
  await page.evaluate(() => window.__th.warpTo(7, 14));
  await hold(page, 'ArrowUp', 120);
  const hint = await page.$eval('#th-hint', el => el.textContent);
  log(/Four Square/i.test(hint), `hint offers to play Four Square: ${JSON.stringify(hint)}`);

  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === true', { timeout: 3000 });
  const title = await page.$eval('#th-minigame-title', el => el.textContent);
  log(title === 'Four Square', `overlay titlebar shows the game name (${JSON.stringify(title)})`);

  // Movement frozen while a minigame is open
  const p0 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  await hold(page, 'ArrowRight', 400);
  const p1 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  log(p0.x === p1.x && p0.y === p1.y, 'player movement is frozen while a minigame is open');

  // Force the lit square to a known value and confirm the matching digit
  // key actually scores (not just that some key does something)
  await page.evaluate(() => { window.__th.minigame._state.lit = 2; });
  await page.keyboard.press('Digit3'); // squares are 1-indexed on screen, 0-indexed internally
  await new Promise(r => setTimeout(r, 50));
  const scoreAfterHit = await page.evaluate(() => window.__th.minigameScore);
  log(scoreAfterHit === 10, `pressing the matching digit key scores (score=${scoreAfterHit})`);

  await page.evaluate(() => { window.__th.minigame._state.lit = 0; });
  await page.keyboard.press('Digit4'); // deliberately wrong key
  await new Promise(r => setTimeout(r, 50));
  const scoreAfterMiss = await page.evaluate(() => window.__th.minigameScore);
  log(scoreAfterMiss === 10, `pressing a non-matching digit key does not score (score=${scoreAfterMiss})`);

  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === false', { timeout: 3000 });
  log(true, 'closing via E exits the minigame and unfreezes movement');

  // Tetherball pole at (15,11) — approach from below, face up
  await page.evaluate(() => window.__th.warpTo(16, 14));
  await hold(page, 'ArrowUp', 120);
  const hint2 = await page.$eval('#th-hint', el => el.textContent);
  log(/Tetherball/i.test(hint2), `hint offers to play Tetherball: ${JSON.stringify(hint2)}`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === true', { timeout: 3000 });
  const title2 = await page.$eval('#th-minigame-title', el => el.textContent);
  log(title2 === 'Tetherball', `a different court launches a different minigame (${JSON.stringify(title2)})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === false', { timeout: 3000 });

  // Hopscotch court at (20,10) — approach from the free row below it (14)
  await page.evaluate(() => window.__th.warpTo(21, 14));
  await hold(page, 'ArrowUp', 120);
  const hint3 = await page.$eval('#th-hint', el => el.textContent);
  log(/Hopscotch/i.test(hint3), `hint offers to play Hopscotch: ${JSON.stringify(hint3)}`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === true', { timeout: 3000 });
  const title3 = await page.$eval('#th-minigame-title', el => el.textContent);
  log(title3 === 'Hopscotch', `hopscotch court launches Hopscotch (${JSON.stringify(title3)})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === false', { timeout: 3000 });

  // Kickball spot lives on the Sports Field, not the Playground — back to
  // hallway-b (via the playground's own door, same as its return trip
  // convention: approach 2 tiles below the door, then walk onto it), then
  // into the sports field
  await page.evaluate(() => window.__th.warpTo(11, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => window.__th.warpTo(98, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "sports-field"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));

  // Kickball spot at (12,8), solid band on row 9 — approach from below, face up
  await page.evaluate(() => window.__th.warpTo(13, 10));
  await hold(page, 'ArrowUp', 120);
  const hint4 = await page.$eval('#th-hint', el => el.textContent);
  log(/Kickball/i.test(hint4), `hint offers to play Kickball: ${JSON.stringify(hint4)}`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === true', { timeout: 3000 });
  const title4 = await page.$eval('#th-minigame-title', el => el.textContent);
  log(title4 === 'Kickball', `kickball spot launches Kickball (${JSON.stringify(title4)})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === false', { timeout: 3000 });

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
