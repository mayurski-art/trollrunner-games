/* Troll High Phase 8 (Neighborhood 1) smoke test: hallway-a -> hallway-b
   -> bus-loop -> Main Street -> {Arcade, Pizza Place, Corner Store, Park}
   and back. Verifies the whole navigation chain lands correctly, that
   Main Street's own memory objects show real flavor text, and that the
   arcade cabinets actually boot the real embedded games (same rigor as
   Phase 7's computer-lab arcade smoke test) rather than just opening an
   empty overlay. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8984;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

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

  // hallway-a -> hallway-b -> bus-loop -> Main Street
  await page.evaluate(() => window.__th.warpTo(94, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => window.__th.warpTo(110, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "bus-loop"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => window.__th.warpTo(18, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "main-street"', { timeout: 5000 });
  log(true, 'hallway-a -> hallway-b -> bus-loop -> Main Street chain lands correctly');
  const zoneName = await page.$eval('#th-zone-name', el => el.textContent);
  log(zoneName === 'Main Street', `zone name reads "Main Street" (${JSON.stringify(zoneName)})`);
  await new Promise(r => setTimeout(r, 300));

  // Main Street's own flavor object
  await page.evaluate(() => window.__th.warpTo(7, 4));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  const busStopMem = await page.$eval('#th-memory h3', el => el.textContent);
  log(/Bus stop sign/i.test(busStopMem), `Main Street's bus stop sign shows real flavor text (${JSON.stringify(busStopMem)})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-memory")');

  async function enterAndReturn(doorX, zoneId, zoneName, memWarp, memTitleRe, label) {
    await page.evaluate((x) => window.__th.warpTo(x, 5), doorX);
    await hold(page, 'ArrowUp', 700);
    await page.waitForFunction((id) => window.__th.zone.id === id, { timeout: 5000 }, zoneId);
    log(true, `${label}: Main Street door (x=${doorX}) enters ${zoneId}`);
    const name = await page.$eval('#th-zone-name', el => el.textContent);
    log(name === zoneName, `${label}: zone name reads "${zoneName}" (${JSON.stringify(name)})`);
    await new Promise(r => setTimeout(r, 300));
    if (memWarp) {
      await page.evaluate(([x, y]) => window.__th.warpTo(x, y), memWarp);
      await hold(page, 'ArrowUp', 120);
      await page.keyboard.press('KeyE');
      await page.waitForSelector('#th-memory', { timeout: 3000 });
      const title = await page.$eval('#th-memory h3', el => el.textContent);
      log(memTitleRe.test(title), `${label}: memory matches (${JSON.stringify(title)})`);
      await page.keyboard.press('KeyE');
      await page.waitForFunction('!document.getElementById("th-memory")');
    }
    const back = await page.evaluate(() => { const d = window.__th.zone.doors[0]; return { tx: d.x, ty: d.y }; });
    await page.evaluate(([tx, ty]) => window.__th.warpTo(tx, ty + 2), [back.tx, back.ty]);
    await hold(page, 'ArrowUp', 700);
    await page.waitForFunction('window.__th.zone.id === "main-street"', { timeout: 5000 });
    log(true, `${label}: door returns to Main Street`);
  }

  // Approach tiles are each object's row *after* its solid (footRows)
  // band, matching every other room's authoring convention in this repo.
  await enterAndReturn(14, 'arcade', 'Arcade', [13, 9], /arcade cabinet/i, 'Arcade'); // flavor cabinet at (12,6), solid row 8
  await enterAndReturn(26, 'pizza-place', 'Pizza Place', [3, 5], /pizza oven/i, 'Pizza Place'); // oven at (2,2), solid row 4
  await enterAndReturn(38, 'convenience-store', 'Corner Store', [3, 4], /corner store counter/i, 'Corner Store'); // counter at (2,2), solid row 3
  await enterAndReturn(50, 'park', 'Park', [3, 6], /big tree/i, 'Park'); // tree at (2,3), solid row 5

  // Arcade cabinet actually boots a real game (Troll Kombat), not just an
  // empty overlay — same rigor as the Phase 7 computer-lab arcade test.
  await page.evaluate(() => window.__th.warpTo(14, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "arcade"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => window.__th.warpTo(3, 6));
  await hold(page, 'ArrowUp', 120);
  const hint = await page.$eval('#th-hint', el => el.textContent);
  log(/Troll Kombat/i.test(hint), `arcade cabinet hint offers Troll Kombat: ${JSON.stringify(hint)}`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.arcadeOpen === true', { timeout: 3000 });
  await new Promise(r => setTimeout(r, 1500));
  const frameLoaded = await page.evaluate(() => {
    const f = document.getElementById('th-arcade-iframe');
    try { return f.contentDocument && f.contentDocument.title; } catch (e) { return null; }
  });
  log(/Troll Kombat/i.test(frameLoaded || ''), `arcade cabinet iframe actually loaded Troll Kombat's real page (title: ${JSON.stringify(frameLoaded)})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.arcadeOpen === false', { timeout: 3000 });

  // Papa Troll's Pizzeria cabinet in the Pizza Place — a different real
  // game at a different location, confirming the launcher isn't hardcoded.
  await page.evaluate(() => window.__th.warpTo(9, 5)); // arcade's own door back to Main Street is at x=9
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "main-street"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => window.__th.warpTo(26, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "pizza-place"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => window.__th.warpTo(3, 8)); // cabinet at (2,5), solid row 7
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.arcadeOpen === true', { timeout: 3000 });
  await new Promise(r => setTimeout(r, 1500));
  const pizzaFrameLoaded = await page.evaluate(() => {
    const f = document.getElementById('th-arcade-iframe');
    try { return f.contentDocument && f.contentDocument.title; } catch (e) { return null; }
  });
  log(/Pizzeria/i.test(pizzaFrameLoaded || ''), `pizza place cabinet loaded Papa Troll's Pizzeria (title: ${JSON.stringify(pizzaFrameLoaded)})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.arcadeOpen === false', { timeout: 3000 });

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
