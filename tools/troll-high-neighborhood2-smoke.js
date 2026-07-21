/* Troll High Phase 9 (Neighborhood 2) smoke test: Park -> Forest Trail ->
   {Skate Park, Lake, Warehouse}, plus secrets tier 2 (an unmarked grate
   in Forest Trail -> Storm Drains -> Caves, mirroring the Phase 5
   basement -> tunnels chain). Verifies the whole navigation chain and
   real flavor text on the new objects. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8988;
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

  async function go(doorX, expectZoneId, dir = 'ArrowUp') {
    await page.evaluate((x) => window.__th.warpTo(x, 5), doorX);
    await hold(page, dir, 700);
    await page.waitForFunction((id) => window.__th.zone.id === id, { timeout: 5000 }, expectZoneId);
    await new Promise(r => setTimeout(r, 300));
  }

  // hallway-a -> hallway-b -> bus-loop -> main-street -> park -> forest-trail
  await go(94, 'hallway-b');
  await go(110, 'bus-loop');
  await go(18, 'main-street');
  await go(50, 'park');
  await go(14, 'forest-trail');
  log(true, 'Park -> Forest Trail chain lands correctly');
  const zoneName = await page.$eval('#th-zone-name', el => el.textContent);
  log(zoneName === 'Forest Trail', `zone name reads "Forest Trail" (${JSON.stringify(zoneName)})`);

  async function enterAndReturn(doorX, zoneId, zoneName, memWarp, memTitleRe, label) {
    await page.evaluate((x) => window.__th.warpTo(x, 5), doorX);
    await hold(page, 'ArrowUp', 700);
    await page.waitForFunction((id) => window.__th.zone.id === id, { timeout: 5000 }, zoneId);
    log(true, `${label}: Forest Trail door (x=${doorX}) enters ${zoneId}`);
    const name = await page.$eval('#th-zone-name', el => el.textContent);
    log(name === zoneName, `${label}: zone name reads "${zoneName}" (${JSON.stringify(name)})`);
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(([x, y]) => window.__th.warpTo(x, y), memWarp);
    await hold(page, 'ArrowUp', 120);
    await page.keyboard.press('KeyE');
    await page.waitForSelector('#th-memory', { timeout: 3000 });
    const title = await page.$eval('#th-memory h3', el => el.textContent);
    log(memTitleRe.test(title), `${label}: memory matches (${JSON.stringify(title)})`);
    await page.keyboard.press('KeyE');
    await page.waitForFunction('!document.getElementById("th-memory")');
    const back = await page.evaluate(() => { const d = window.__th.zone.doors[0]; return { tx: d.x, ty: d.y }; });
    await page.evaluate(([tx, ty]) => window.__th.warpTo(tx, ty + 2), [back.tx, back.ty]);
    await hold(page, 'ArrowUp', 700);
    await page.waitForFunction('window.__th.zone.id === "forest-trail"', { timeout: 5000 });
    log(true, `${label}: door returns to Forest Trail`);
  }

  // half-pipe at (3,3), solid row 5 -> approach row 6
  await enterAndReturn(14, 'skate-park', 'Skate Park', [4, 6], /half-pipe/i, 'Skate Park');
  // dock at (4,6), solid row 7 -> approach row 8
  await enterAndReturn(26, 'lake', 'Lake', [5, 8], /the dock/i, 'Lake');
  // crates at (2,3), solid row 5 -> approach row 6
  await enterAndReturn(38, 'warehouse', 'Warehouse', [3, 6], /stacked crates/i, 'Warehouse');

  // Secrets tier 2: unmarked grate at x=47 in Forest Trail -> Storm Drains -> Caves
  await page.evaluate(() => window.__th.warpTo(48, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "storm-drains"', { timeout: 5000 });
  log(true, 'the unmarked grate in Forest Trail reaches Storm Drains');
  await new Promise(r => setTimeout(r, 300));

  // pipes at (2,3), w3h4 footRows1 -> solid row 6, cols 2-4 -> approach row 7, col 3
  await page.evaluate(() => window.__th.warpTo(3, 7));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  const pipesTitle = await page.$eval('#th-memory h3', el => el.textContent);
  log(/the pipes/i.test(pipesTitle), `Storm Drains memory matches (${JSON.stringify(pipesTitle)})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-memory")');

  // The room's second door (to Caves) sits mid-room at (6,7) — approach
  // from above (row 5, off both doors) and walk down onto it.
  await page.evaluate(() => window.__th.warpTo(6, 5));
  await hold(page, 'ArrowDown', 700);
  await page.waitForFunction('window.__th.zone.id === "caves"', { timeout: 5000 });
  log(true, 'Storm Drains passage reaches the Caves');
  await new Promise(r => setTimeout(r, 300));

  await page.evaluate(() => window.__th.warpTo(4, 6));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  const rocksTitle = await page.$eval('#th-memory h3', el => el.textContent);
  log(/cave rocks/i.test(rocksTitle), `Caves memory matches (${JSON.stringify(rocksTitle)})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-memory")');

  // Full return chain: caves -> storm-drains -> forest-trail. Each step
  // starts from a tile OFF the target door (doorArmed only fires once the
  // player has been off any door since the last transition).
  await page.evaluate(() => window.__th.warpTo(9, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "storm-drains"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => window.__th.warpTo(6, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "forest-trail"', { timeout: 5000 });
  log(true, 'Caves -> Storm Drains -> Forest Trail return chain all lands correctly');

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
