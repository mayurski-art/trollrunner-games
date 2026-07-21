/* Troll High "Hidden World, expanded further" smoke test (design doc
   §23 Phase 7 — explicitly "expand the mystery, don't resolve it").
   Walks the full secrets chain down to the Underground HQ, then through
   a NEW third unmarked door into a brand new dead-end zone
   (flooded-passage) with its own unique graffiti/props. Also checks the
   new above-ground rumor lines (Wendell, Marnie) and Trollface's new
   memoryLine for having found this deeper room. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8992;
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

async function go(page, doorX, expectZoneId) {
  await page.evaluate((x) => window.__th.warpTo(x, 5), doorX);
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction((id) => window.__th.zone.id === id, { timeout: 5000 }, expectZoneId);
  await new Promise(r => setTimeout(r, 200));
}

async function checkMemory(page, warp, titleRe, label, holdMs = 120) {
  await page.evaluate(([x, y]) => window.__th.warpTo(x, y), warp);
  await hold(page, 'ArrowUp', holdMs);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  const title = await page.$eval('#th-memory h3', el => el.textContent);
  const text = await page.$eval('#th-memory p', el => el.textContent);
  log(titleRe.test(title), `${label} memory matches (${JSON.stringify(title)})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-memory")');
  return text;
}

async function talkOnce(page) {
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-dialogue', { timeout: 3000 });
  const text = await page.$eval('#th-dialogue p', el => el.textContent);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-dialogue")', { timeout: 3000 });
  return text;
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

  // --- Rumor lines above ground, before finding anything -----------------
  // Wendell (office)
  await go(page, 2, 'office');
  const wendell = await page.evaluate(() => { const n = window.__th.npcs.find(n => n.def.id === 'wendell'); return { x: n.x, y: n.y }; });
  await page.evaluate(([x, y]) => window.__th.warpTo(Math.floor(x / 16) + 1, Math.round(y / 16)), [wendell.x, wendell.y]);
  await new Promise(r => setTimeout(r, 200));
  // Wendell's dialogue array has 4 lines now (3 original + the new rumor
  // line appended last). firstLine (t=0), dialogue[0] (t=1), dialogue[1]
  // (t=2), familiarLine (t=3, FAMILIAR_AT — doesn't advance
  // dialogueIndex), dialogue[2] (t=4), dialogue[3] (t=5) — the new line.
  await talkOnce(page);
  const wendellLines = [await talkOnce(page), await talkOnce(page), await talkOnce(page), await talkOnce(page), await talkOnce(page)];
  log(wendellLines.some(l => /door under this school/i.test(l)), `Wendell's dialogue cycle includes the new rumor line (${JSON.stringify(wendellLines)})`);

  // --- Full secrets chain down to the Underground HQ ----------------------
  await page.evaluate(() => window.__th.warpTo(6, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-a"', { timeout: 5000 });
  await go(page, 94, 'hallway-b');
  await go(page, 110, 'bus-loop');
  await go(page, 18, 'main-street');
  await go(page, 50, 'park');
  await go(page, 14, 'forest-trail');
  await go(page, 48, 'storm-drains');
  await page.evaluate(() => window.__th.warpTo(6, 5));
  await hold(page, 'ArrowDown', 700);
  await page.waitForFunction('window.__th.zone.id === "caves"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => window.__th.warpTo(9, 7));
  await hold(page, 'ArrowDown', 700);
  await page.waitForFunction('window.__th.zone.id === "underground-hq"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));

  // --- The new THIRD unmarked door ----------------------------------------
  await page.evaluate(() => window.__th.warpTo(14, 10));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "flooded-passage"', { timeout: 5000 });
  log(true, 'the new third unmarked door in the Underground HQ reaches flooded-passage');
  await new Promise(r => setTimeout(r, 300));
  const zoneName = await page.$eval('#th-zone-name', el => el.textContent);
  log(zoneName === '???', `zone name reads "???" (${JSON.stringify(zoneName)})`);

  await checkMemory(page, [3, 5], /graffiti/i, 'First graffiti', 60);
  await checkMemory(page, [10, 6], /the rocks/i, 'Cave rocks');
  await checkMemory(page, [6, 9], /nailed-shut crate/i, 'Nailed-shut crate');
  await checkMemory(page, [10, 8], /graffiti/i, 'Second graffiti', 60);

  const visited = await page.evaluate(() => window.__th.zone.id === 'flooded-passage' && [...document.querySelectorAll('*')].length > 0); // sanity, always true
  log(visited, 'still in flooded-passage after checking all 4 mystery objects');

  // Confirm it's genuinely a dead end — only one door, back the way we came.
  const doorCount = await page.evaluate(() => window.__th.zone.doors.length);
  log(doorCount === 1, `flooded-passage has exactly one door — a real dead end (${doorCount})`);

  // --- Trollface's new memoryLine for finding this deeper room -----------
  // flooded-passage's own door lands one tile south of underground-hq's
  // THIRD door's own trigger — holding ArrowUp for a fixed duration risks
  // walking straight back through it the moment the zone switches (the
  // key is still held). Release the instant the zone actually changes
  // instead of holding for a fixed span.
  await page.evaluate(() => window.__th.warpTo(7, 7));
  await page.keyboard.down('ArrowUp');
  try {
    await page.waitForFunction('window.__th.zone.id === "underground-hq"', { timeout: 5000 });
  } catch (e) {
    const diag = await page.evaluate(() => ({ zoneId: window.__th.zone.id, player: { x: window.__th.player.x, y: window.__th.player.y } }));
    console.log('DIAG (return from flooded-passage):', JSON.stringify(diag));
    await page.keyboard.up('ArrowUp');
    throw e;
  }
  await page.keyboard.up('ArrowUp');
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => window.__th.warpTo(6, 7));
  await new Promise(r => setTimeout(r, 150));
  await talkOnce(page); // firstLine
  await talkOnce(page); // secondLine
  const tfLine = await talkOnce(page); // t=2 -> first unseen memoryLine in array order; "club" likely false, "flooded-passage" true
  log(/past my room/i.test(tfLine), `Trollface's new memoryLine references the deeper room (${JSON.stringify(tfLine)})`);

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
