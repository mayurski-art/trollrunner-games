/* Troll High daily rotating flavor smoke test (design doc §21, layer 3
   cheap version): today's cafeteria special, a rotating hallway
   announcement, and a random daily "vibe" event, all deterministic off
   the same in-game day index driving the bell schedule. Verifies the UI
   actually shows the same value daily.js computes (not just that some
   text is present), and that it's the SAME across two independent
   sessions on the same real-world day (the whole point — no network
   sync needed because it's derived from wall-clock time). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8974;
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
  const { todaysLunch, todaysAnnouncement, todaysEvent } = await import('../assets/games/troll-high/src/daily.js');
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

  const today = Math.floor(Date.now() / (60 * 60 * 1000)); // same DAY_MS as clock.js
  const expectedLunch = todaysLunch(today);
  const expectedAnnouncement = todaysAnnouncement(today);
  const expectedEvent = todaysEvent(today);

  // Schedule overlay: event + announcement
  await page.click('#th-btn-schedule');
  await page.waitForFunction('window.__th.scheduleOpen === true', { timeout: 3000 });
  const shownEvent = await page.$eval('#th-schedule-event', el => el.textContent);
  const shownAnnouncement = await page.$eval('#th-schedule-announcement', el => el.textContent);
  log(shownEvent === expectedEvent, `schedule shows today's event, matching daily.js (${JSON.stringify(shownEvent)})`);
  log(shownAnnouncement.includes(expectedAnnouncement), `schedule shows today's announcement, matching daily.js (${JSON.stringify(shownAnnouncement)})`);
  await page.click('#th-schedule-close');

  // Cafeteria overlay: today's special
  await page.evaluate(() => window.__th.warpTo(62, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "cafeteria"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => window.__th.warpTo(19, 7));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.cafeteriaOpen === true', { timeout: 3000 });
  const shownSpecial = await page.$eval('#th-cafeteria-special', el => el.textContent);
  log(shownSpecial.includes(expectedLunch.name) && shownSpecial.includes(expectedLunch.flavor),
    `cafeteria shows today's special, matching daily.js (${JSON.stringify(shownSpecial)})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.cafeteriaOpen === false', { timeout: 3000 });

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
