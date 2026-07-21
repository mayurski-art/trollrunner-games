/* Troll High Phase 11 (Troll meta) smoke test: the full secrets chain
   down to the Underground HQ (Caves' own second unmarked door), meeting
   the legendary NPC (Trollface), the golden statue + club charter
   flavor objects, a couple of the new graffiti collectibles scattered
   through the hidden zones, and that meeting Trollface actually unlocks
   the matching bedroom decoration — not just that a dialogue box opened. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8991;
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

async function checkMemory(page, warp, titleRe, label, holdMs = 120) {
  await page.evaluate(([x, y]) => window.__th.warpTo(x, y), warp);
  await hold(page, 'ArrowUp', holdMs);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  const title = await page.$eval('#th-memory h3', el => el.textContent);
  log(titleRe.test(title), `${label} memory matches (${JSON.stringify(title)})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-memory")');
}

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

  async function go(doorX, expectZoneId) {
    await page.evaluate((x) => window.__th.warpTo(x, 5), doorX);
    await hold(page, 'ArrowUp', 700);
    await page.waitForFunction((id) => window.__th.zone.id === id, { timeout: 5000 }, expectZoneId);
    await new Promise(r => setTimeout(r, 300));
  }

  // Graffiti in the Restrooms — no secrets needed, just off hallway-a
  await go(87, 'bathroom');
  // graffiti (2,1 w3h2) is non-solid (walkable), so a longer hold risks
  // drifting past it — start one row below its bbox, short hold.
  await checkMemory(page, [4, 3], /graffiti/i, 'Restrooms graffiti', 60);
  await page.evaluate(() => window.__th.warpTo(6, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-a"', { timeout: 5000 });

  // Full chain: hallway-a -> hallway-b -> bus-loop -> main-street -> park
  // -> forest-trail -> [grate] -> storm-drains -> [passage] -> caves ->
  // [unmarked door] -> Underground HQ
  await go(94, 'hallway-b');
  await go(110, 'bus-loop');
  await go(18, 'main-street');
  await go(50, 'park');
  await go(14, 'forest-trail');
  await go(48, 'storm-drains');
  // graffiti at (10,3) w3h2 -> rows3-4; start one row below, short hold
  await checkMemory(page, [11, 5], /graffiti/i, 'Storm Drains graffiti', 60);
  await page.evaluate(() => window.__th.warpTo(6, 5));
  await hold(page, 'ArrowDown', 700);
  await page.waitForFunction('window.__th.zone.id === "caves"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  // graffiti at (13,1) w3h2 -> rows1-2; start one row below, short hold
  await checkMemory(page, [14, 3], /graffiti/i, 'Caves graffiti', 60);

  await page.evaluate(() => window.__th.warpTo(9, 7));
  await hold(page, 'ArrowDown', 700);
  await page.waitForFunction('window.__th.zone.id === "underground-hq"', { timeout: 5000 });
  log(true, 'the unmarked door in Caves reaches the Underground HQ');
  await new Promise(r => setTimeout(r, 300));
  const zoneName = await page.$eval('#th-zone-name', el => el.textContent);
  log(zoneName === 'The Underground HQ', `zone name reads "The Underground HQ" (${JSON.stringify(zoneName)})`);

  await checkMemory(page, [3, 4], /club charter/i, 'Club charter');
  await checkMemory(page, [11, 6], /golden statue/i, 'Golden statue');

  // Meet Trollface
  await page.evaluate(() => window.__th.warpTo(6, 7));
  await new Promise(r => setTimeout(r, 150));
  const hint = await page.$eval('#th-hint', el => el.textContent);
  log(/Trollface/i.test(hint), `hint offers to talk to Trollface: ${JSON.stringify(hint)}`);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-dialogue', { timeout: 3000 });
  const dTitle = await page.$eval('#th-dialogue h3', el => el.textContent);
  const dLine = await page.$eval('#th-dialogue p', el => el.textContent);
  log(dTitle.includes('Trollface') && dTitle.includes('NPC'), `dialogue header shows Trollface + NPC tag (${JSON.stringify(dTitle)})`);
  log(dLine === "...you actually found it. Huh. Didn't think anyone would.", `first-ever meeting shows the special firstLine (${JSON.stringify(dLine)})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-dialogue")');

  const metTrollface = await page.evaluate(() => !!window.__th.npcRelations['trollface']);
  log(metTrollface, 'npcRelations records meeting Trollface');

  // Bedroom decoration unlock
  await page.click('#th-btn-bedroom');
  await page.waitForFunction('window.__th.bedroomOpen === true', { timeout: 3000 });
  const unlockedText = await page.$eval('#th-bedroom-unlocked', el => el.textContent);
  log(/Trollface's Autograph/.test(unlockedText), `meeting Trollface unlocks the matching bedroom decoration (${JSON.stringify(unlockedText)})`);
  await page.click('#th-bedroom-close');

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
