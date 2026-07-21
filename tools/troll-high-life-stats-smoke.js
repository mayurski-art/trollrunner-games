/* Troll High life-story profile stats smoke test (design doc §21) —
   progression as "what did I do at this school," not levels. Verifies
   rooms-explored, days-attended, and lunches-bought actually track real
   in-world actions rather than just existing as static UI. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8972;
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

  const initial = await page.evaluate(() => window.__th.lifeStats);
  log(initial.roomsExplored === 1 && initial.daysAttended === 1, `starts with the spawn room + today counted (${JSON.stringify(initial)})`);
  log(initial.lunchesBought === 0 && initial.tradesCompleted === 0 && initial.giftsGiven === 0 && initial.giftsReceived === 0, 'everything else starts at zero');

  // Walking into a new zone should bump roomsExplored
  await page.evaluate(() => window.__th.warpTo(2, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "office"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  const afterOffice = await page.evaluate(() => window.__th.lifeStats);
  log(afterOffice.roomsExplored === 2, `entering the office bumps rooms explored to 2 (${afterOffice.roomsExplored})`);

  // Re-entering an already-visited room should NOT double count
  await page.evaluate(() => {
    const d = window.__th.zone.doors[0];
    window.__th.warpTo(d.x, d.y + 2);
  });
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-a"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  const backInHallway = await page.evaluate(() => window.__th.lifeStats);
  log(backInHallway.roomsExplored === 2, `revisiting the hallway doesn't double-count (${backInHallway.roomsExplored})`);

  // Buying lunch should bump lunchesBought and show up on the profile
  await page.evaluate(() => window.__th.warpTo(62, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "cafeteria"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => window.__th.warpTo(19, 7));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.cafeteriaOpen === true', { timeout: 3000 });
  await page.click('.th-cafeteria-item[data-id="pizza"]');
  await page.click('#th-cafeteria-checkout');
  await page.waitForSelector('#th-cafeteria-id-step:not([hidden])', { timeout: 3000 });
  const myId = await page.evaluate(() => window.__th.studentId);
  await page.type('#th-cafeteria-id-input', myId);
  await page.click('#th-cafeteria-id-form button[type="submit"]');
  await page.waitForSelector('#th-cafeteria-done-step:not([hidden])', { timeout: 3000 });
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.cafeteriaOpen === false', { timeout: 3000 });

  const afterLunch = await page.evaluate(() => window.__th.lifeStats);
  log(afterLunch.lunchesBought === 1, `buying lunch bumps lunchesBought (${afterLunch.lunchesBought})`);

  await page.click('#th-btn-profile');
  await page.waitForFunction('window.__th.profileOpen === true', { timeout: 3000 });
  const shownRooms = await page.$eval('#th-profile-rooms-explored', el => el.textContent);
  const shownLunches = await page.$eval('#th-profile-lunches', el => el.textContent);
  const shownCards = await page.$eval('#th-profile-cards-collected', el => el.textContent);
  const totalRooms = await page.evaluate(() => window.__th.lifeStats.totalRooms);
  log(shownRooms === `3 / ${totalRooms}`, `profile card shows rooms explored (${JSON.stringify(shownRooms)})`);
  log(shownLunches === '1', `profile card shows lunches bought (${JSON.stringify(shownLunches)})`);
  log(shownCards === '0 / 14', `profile card shows cards collected out of the full set (${JSON.stringify(shownCards)})`);

  // Persistence: reload and confirm stats survive
  await page.evaluate(() => window.__th.persist());
  await new Promise(r => setTimeout(r, 300));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 10000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true', { timeout: 10000 });
  const afterReload = await page.evaluate(() => window.__th.lifeStats);
  log(afterReload.roomsExplored === 3 && afterReload.lunchesBought === 1, `stats persist across reload (${JSON.stringify(afterReload)})`);

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
