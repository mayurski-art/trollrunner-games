/* Troll High student profile smoke test: the always-visible profile
   button, the cosmetic in-game student ID (persisted, not the real
   account ID), and that a minigame high score actually shows up on the
   card after playing. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8964;
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

  await stubAuth(page, { userId: 'profile-test-user', username: 'ProfileTester' });
  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');
  await dismissOrientation(page);

  log(await page.$eval('#th-btn-profile', el => !el.hidden), 'profile button is visible once the game starts');

  const id1 = await page.evaluate(() => window.__th.studentId);
  log(/^[A-Z]{2}-\d{6}$/.test(id1), `a cosmetic student ID was generated (${id1})`);
  log(id1 !== 'profile-test-user', 'the student ID is not the real account userId');

  await page.click('#th-btn-profile');
  await page.waitForFunction('window.__th.profileOpen === true', { timeout: 3000 });
  const shownName = await page.$eval('#th-profile-name', el => el.textContent);
  log(shownName === 'ProfileTester', `profile card shows the account username (${JSON.stringify(shownName)})`);
  const shownId = await page.$eval('#th-profile-id', el => el.textContent);
  log(shownId.includes(id1), `profile card shows the student ID (${JSON.stringify(shownId)})`);
  const emptyScores = await page.$eval('#th-profile-scores', el => el.textContent);
  log(/no recess games/i.test(emptyScores), 'no high scores yet before playing anything');

  const p0 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  await hold(page, 'ArrowRight', 400);
  const p1 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  log(p0.x === p1.x && p0.y === p1.y, 'player movement is frozen while the profile is open');

  await page.click('#th-profile-close');
  await page.waitForFunction('window.__th.profileOpen === false', { timeout: 3000 });

  // Play (fake-win) Four Square and confirm it lands on the profile as a
  // high score
  await page.evaluate(() => window.__th.warpTo(94, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => window.__th.warpTo(86, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "playground"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => window.__th.warpTo(7, 14));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === true', { timeout: 3000 });
  await page.evaluate(() => { window.__th.minigame._state.lit = 1; });
  await page.keyboard.press('Digit2');
  await new Promise(r => setTimeout(r, 50));
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === false', { timeout: 3000 });

  const scores = await page.evaluate(() => window.__th.highScores);
  log(scores.foursquare === 10, `high score recorded on close (${JSON.stringify(scores)})`);

  await page.click('#th-btn-profile');
  await page.waitForFunction('window.__th.profileOpen === true', { timeout: 3000 });
  const scoresText = await page.$eval('#th-profile-scores', el => el.textContent);
  log(/Four Square/.test(scoresText) && /10/.test(scoresText), `profile card now lists the Four Square high score (${JSON.stringify(scoresText)})`);
  await page.keyboard.press('KeyE'); // profile has no E-close binding — sanity it doesn't do anything weird
  await page.click('#th-profile-close');

  // Persistence: reload and confirm the same student ID + high score come back
  await page.evaluate(() => window.__th.persist());
  await new Promise(r => setTimeout(r, 300));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 10000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true', { timeout: 10000 });
  const id2 = await page.evaluate(() => window.__th.studentId);
  log(id2 === id1, `student ID persists across reload (${id2})`);
  const scores2 = await page.evaluate(() => window.__th.highScores);
  log(scores2.foursquare === 10, `high score persists across reload (${JSON.stringify(scores2)})`);

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
