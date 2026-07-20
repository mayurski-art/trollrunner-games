/* Troll High smoke test: serves the repo statically and drives Phase 0
   end-to-end in headless Chrome — boot, title, movement + collision, zone
   transition through the door, memory interaction. Run from anywhere after
   `npm i puppeteer-core` (screenshots land next to this script). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = __dirname;
const PORT = 8934;
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
const consoleIssues = [];
function log(ok, msg) { results.push((ok ? 'PASS' : 'FAIL') + ' | ' + msg); console.log(results[results.length - 1]); }

const hold = async (page, key, ms) => {
  await page.keyboard.down(key);
  await new Promise(r => setTimeout(r, ms));
  await page.keyboard.up(key);
};

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1040,760', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 720 });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleIssues.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => consoleIssues.push('pageerror: ' + e.message));

  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running');
  const assets = await page.evaluate(() => ({
    tilesets: window.__th.tilesetReady,
    sprites: window.__th.spritesReady,
  }));
  log(assets.tilesets.hallway && assets.tilesets.classroom, 'both Wang tilesets loaded: ' + JSON.stringify(assets.tilesets));
  log(assets.sprites, 'student character sprites loaded');
  await page.screenshot({ path: path.join(OUT, 'th-shot-1-title.png') });
  log(true, 'boots to title screen');

  // Start
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');
  const hudVisible = await page.$eval('#th-hud', (el) => !el.hidden);
  log(hudVisible, 'Start shows HUD, loop running');
  log(await page.$eval('#th-zone-name', el => el.textContent) === 'Main Hallway', 'spawns in Main Hallway');

  // Movement east + collision against the south wall
  const p0 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  await hold(page, 'ArrowRight', 600);
  const p1 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  log(p1.x > p0.x + 20, `walks east (${p0.x.toFixed(0)} -> ${p1.x.toFixed(0)})`);
  await hold(page, 'ArrowDown', 2500); // hallway is 12 tiles tall — this must hit the wall
  const p2 = await page.evaluate(() => ({ y: window.__th.player.y, ty: window.__th.player.tileY }));
  await hold(page, 'ArrowDown', 400);
  const p3 = await page.evaluate(() => ({ y: window.__th.player.y }));
  log(Math.abs(p3.y - p2.y) < 1 && p2.ty <= 10, `south wall stops the player (rests at tile row ${p2.ty})`);
  await page.screenshot({ path: path.join(OUT, 'th-shot-2-hallway.png') });

  // Interact with the lockers (warp in front of the bank at x=12..15, face north)
  await page.evaluate(() => window.__th.warpTo(13, 3));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  const memTitle = await page.$eval('#th-memory h3', el => el.textContent);
  log(/lockers/i.test(memTitle), 'locker memory card opens: ' + JSON.stringify(memTitle));
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-memory")');
  log(true, 'memory card closes');

  // Door: walk into Room 3B
  await page.evaluate(() => window.__th.warpTo(18, 5));
  await hold(page, 'ArrowUp', 900);
  await page.waitForFunction('window.__th.zone.id === "classroom-3b"', { timeout: 5000 });
  log(true, 'north door teleports into Room 3B');
  await new Promise(r => setTimeout(r, 500)); // fade in
  await page.screenshot({ path: path.join(OUT, 'th-shot-3-classroom.png') });

  // TV cart memory in the classroom
  await page.evaluate(() => window.__th.warpTo(17, 5));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  log(/TV cart/i.test(await page.$eval('#th-memory h3', el => el.textContent)), 'TV cart memory pops');
  await page.keyboard.press('KeyE');

  // Back through the door to the hallway
  await page.evaluate(() => window.__th.warpTo(10, 5));
  await hold(page, 'ArrowUp', 900);
  await page.waitForFunction('window.__th.zone.id === "hallway-a"', { timeout: 5000 });
  log(true, 'door returns to the hallway');

  // Memory persistence
  const foundCount = await page.evaluate(() => JSON.parse(localStorage.getItem('th_memories') || '[]').length);
  log(foundCount >= 2, `memories persisted to localStorage (${foundCount})`);

  const realIssues = consoleIssues.filter(t => !t.includes('frame-ancestors'));
  log(realIssues.length === 0, 'no console errors' + (realIssues.length ? ':\n  ' + realIssues.join('\n  ') : ''));

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
