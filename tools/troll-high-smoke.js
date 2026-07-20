/* Troll High smoke test: serves the repo statically and drives the game
   end-to-end in headless Chrome — boot, title, movement + collision, the
   widened Phase 2 hallway's door network (office / classroom-3b /
   computer-lab / cafeteria), memory interactions, ambience start, and
   memory persistence. Run from anywhere after `npm i puppeteer-core`
   (screenshots land next to this script). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

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

/* Walk from a hallway spot up onto a north-wall door trigger and confirm
   the target zone loads, then read one memory inside it. */
async function enterRoom(page, { doorX, roomId, roomName, warpX, memWarp, memTitleRe, label }) {
  await page.evaluate((x) => window.__th.warpTo(x, 5), warpX);
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction((id) => window.__th.zone.id === id, { timeout: 5000 }, roomId);
  log(true, `${label}: hallway door (x=${doorX}) enters ${roomId}`);
  log(await page.$eval('#th-zone-name', el => el.textContent) === roomName, `${label}: zone name reads "${roomName}"`);
  await new Promise(r => setTimeout(r, 450)); // fade in

  if (memWarp) {
    await page.evaluate(([x, y]) => window.__th.warpTo(x, y), memWarp);
    await hold(page, 'ArrowUp', 120);
    await page.keyboard.press('KeyE');
    await page.waitForSelector('#th-memory', { timeout: 3000 });
    const title = await page.$eval('#th-memory h3', el => el.textContent);
    log(memTitleRe.test(title), `${label}: memory card matches (${JSON.stringify(title)})`);
    await page.keyboard.press('KeyE');
    await page.waitForFunction('!document.getElementById("th-memory")');
  }

  // back to the hallway via that room's own door
  const back = await page.evaluate((id) => {
    const d = window.__th.zone.doors[0];
    return { tx: d.x, ty: d.y };
  }, roomId);
  await page.evaluate(([tx, ty]) => window.__th.warpTo(tx, ty + 2), [back.tx, back.ty]);
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-a"', { timeout: 5000 });
  log(true, `${label}: door returns to the hallway`);
}

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
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !isExpectedAuthNoise(m.text())) consoleIssues.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => consoleIssues.push('pageerror: ' + e.message));

  const { userId } = await stubAuth(page);
  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
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
  await dismissOrientation(page);
  const hudVisible = await page.$eval('#th-hud', (el) => !el.hidden);
  log(hudVisible, 'Start shows HUD, loop running');
  log(await page.$eval('#th-zone-name', el => el.textContent) === 'Main Hallway', 'spawns in Main Hallway');
  log(await page.evaluate(() => window.__th.ambienceStarted), 'ambience starts on Start click');

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

  // Interact with the lockers (bank at x=6..9)
  await page.evaluate(() => window.__th.warpTo(7, 3));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  const memTitle = await page.$eval('#th-memory h3', el => el.textContent);
  log(/lockers/i.test(memTitle), 'locker memory card opens: ' + JSON.stringify(memTitle));
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-memory")');
  log(true, 'memory card closes');

  // Sweep the widened hallway's door network — a representative sample of
  // the 8 rooms (not exhaustive; door round-trip math is cross-checked
  // offline by a Node script over all 9 zone JSONs before this ever runs).
  await enterRoom(page, {
    doorX: 2, roomId: 'office', roomName: 'Front Office', warpX: 3,
    memWarp: [2, 5], memTitleRe: /front desk/i, label: 'Office',
  });
  await enterRoom(page, {
    doorX: 14, roomId: 'classroom-3b', roomName: 'Room 3B', warpX: 15,
    memWarp: [17, 5], memTitleRe: /TV cart/i, label: 'Room 3B',
  });
  await enterRoom(page, {
    doorX: 50, roomId: 'computer-lab', roomName: 'Computer Lab', warpX: 51,
    // (3,8)/(6,8)/(15,8) are now arcade-launcher or flavor-override desks
    // (Phase 7); (12,8) is the one desk left with the shared generic memory.
    memWarp: [12, 9], memTitleRe: /Computer 7/i, label: 'Computer Lab',
  });
  await page.screenshot({ path: path.join(OUT, 'th-shot-3-computer-lab.png') });
  await enterRoom(page, {
    doorX: 62, roomId: 'cafeteria', roomName: 'Cafeteria', warpX: 63,
    memWarp: [4, 7], memTitleRe: /Lunch table/i, label: 'Cafeteria',
  });
  await page.screenshot({ path: path.join(OUT, 'th-shot-4-cafeteria.png') });

  // Memory persistence
  // Persistence now goes through save.js's cloud save (debounced — writes
  // on interval/visibilitychange/zone-switch, not synchronously on every
  // find), with a local cache mirror keyed per account. Force a flush via
  // the debug hook rather than waiting out the real interval.
  await page.evaluate(() => window.__th.persist());
  const foundCount = await page.evaluate(uid => {
    const raw = localStorage.getItem('th_cloud_cache:' + uid);
    return raw ? (JSON.parse(raw).foundKeys || []).length : 0;
  }, userId);
  log(foundCount >= 5, `memories persisted to the local save cache (${foundCount})`);
  log(await page.evaluate(() => window.__th.found.size) === foundCount, 'in-memory found set matches the persisted cache count');

  const realIssues = consoleIssues.filter(t => !t.includes('frame-ancestors'));
  log(realIssues.length === 0, 'no console errors' + (realIssues.length ? ':\n  ' + realIssues.join('\n  ') : ''));

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
