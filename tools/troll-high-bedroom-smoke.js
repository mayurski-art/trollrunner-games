/* Troll High personal bedroom smoke test (design doc §21): decorations
   unlock off stats the game already tracks (no separate grind), can be
   equipped into slots, equipping persists across reload, and a
   still-locked decoration can't be equipped. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8980;
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
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors') && !isExpectedAuthNoise(m.text())) issues.push(m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));

  await stubAuth(page);
  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');
  await dismissOrientation(page);

  await page.click('#th-btn-bedroom');
  await page.waitForFunction('window.__th.bedroomOpen === true', { timeout: 3000 });
  const emptyUnlocked = await page.$eval('#th-bedroom-unlocked', el => el.textContent);
  log(/Nothing unlocked yet/.test(emptyUnlocked), `starts with nothing unlocked (${JSON.stringify(emptyUnlocked)})`);
  const lockedCount = await page.$$eval('#th-bedroom-locked .item', els => els.length);
  log(lockedCount === 8, `all 8 decorations show as locked with their hints (${lockedCount})`);
  await page.click('#th-bedroom-close');
  await page.waitForFunction('window.__th.bedroomOpen === false', { timeout: 3000 });

  // Unlock the card binder (needs 3 cards) via the debug hook
  await page.evaluate(() => {
    window.__th.addCard('trollface');
    window.__th.addCard('mp3-player');
    window.__th.addCard('gum');
  });
  await page.click('#th-btn-bedroom');
  await page.waitForFunction('window.__th.bedroomOpen === true', { timeout: 3000 });
  const unlockedNow = await page.$eval('#th-bedroom-unlocked', el => el.textContent);
  log(/Card Binder/.test(unlockedNow), `card binder becomes unlocked after collecting 3 cards (${JSON.stringify(unlockedNow)})`);

  // Equip it into the first (wall) slot
  await page.click('#th-bedroom-slots .th-bedroom-slot');
  await new Promise(r => setTimeout(r, 100));
  const equipped = await page.evaluate(() => window.__th.bedroomEquipped);
  log(equipped.wall === 'card-binder', `clicking the wall slot equips the card binder (${JSON.stringify(equipped)})`);
  const slotFilled = await page.$eval('#th-bedroom-slots .th-bedroom-slot', el => el.classList.contains('is-filled'));
  log(slotFilled, 'the wall slot visually shows as filled');

  // Cycling past the only unlocked decoration returns to empty
  await page.click('#th-bedroom-slots .th-bedroom-slot');
  await new Promise(r => setTimeout(r, 100));
  const equippedAfterCycle = await page.evaluate(() => window.__th.bedroomEquipped);
  log(!equippedAfterCycle.wall, `clicking again cycles back to empty (${JSON.stringify(equippedAfterCycle)})`);

  // Re-equip, then verify persistence across reload
  await page.click('#th-bedroom-slots .th-bedroom-slot');
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(() => window.__th.persist());
  await new Promise(r => setTimeout(r, 300));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 10000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true', { timeout: 10000 });
  await dismissOrientation(page);
  const equippedAfterReload = await page.evaluate(() => window.__th.bedroomEquipped);
  log(equippedAfterReload.wall === 'card-binder', `equipped decoration persists across reload (${JSON.stringify(equippedAfterReload)})`);

  // Movement freezes while the bedroom overlay is open
  await page.click('#th-btn-bedroom');
  await page.waitForFunction('window.__th.bedroomOpen === true', { timeout: 3000 });
  const p0 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  await page.keyboard.down('ArrowRight');
  await new Promise(r => setTimeout(r, 400));
  await page.keyboard.up('ArrowRight');
  const p1 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  log(p0.x === p1.x && p0.y === p1.y, 'player movement is frozen while the bedroom is open');
  await page.click('#th-bedroom-close');
  await page.waitForFunction('window.__th.bedroomOpen === false', { timeout: 3000 });

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
