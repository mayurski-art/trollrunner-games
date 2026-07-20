/* Troll High Phase 5 smoke test: School wave 2 (East Wing) + secrets
   tier 1. Confirms the hallway-a -> hallway-b junction works, sweeps a
   representative sample of the 9 new rooms, and walks the hidden
   basement -> tunnels -> ??? chain plus the gym -> roof ladder. Run from
   anywhere after `npm i puppeteer-core`. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = __dirname;
const PORT = 8949;
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

async function enterRoom(page, { doorX, roomId, roomName, memWarp, memTitleRe, label }) {
  await page.evaluate(x => window.__th.warpTo(x, 5), doorX + 1);
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction(id => window.__th.zone.id === id, { timeout: 5000 }, roomId);
  log(true, `${label}: door (x=${doorX}) enters ${roomId}`);
  log(await page.$eval('#th-zone-name', el => el.textContent) === roomName, `${label}: zone name reads "${roomName}"`);
  await new Promise(r => setTimeout(r, 400));
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
  const back = await page.evaluate(id => {
    const d = window.__th.zone.doors[0];
    return { tx: d.x, ty: d.y };
  }, roomId);
  await page.evaluate(([tx, ty]) => window.__th.warpTo(tx, ty + 2), [back.tx, back.ty]);
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  log(true, `${label}: door returns to the East Wing`);
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
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors')) issues.push(m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));

  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');

  // Main Hallway -> East Wing junction (hallway-a door at x=94)
  await page.evaluate(() => window.__th.warpTo(95, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  log(true, 'Main Hallway connects into the East Wing (hallway-b)');
  await page.screenshot({ path: path.join(OUT, 'th-p5-shot-1-eastwing.png') });

  await enterRoom(page, { doorX: 14, roomId: 'gym', roomName: 'Gym', memWarp: [3, 5], memTitleRe: /bleachers/i, label: 'Gym' });
  await enterRoom(page, { doorX: 26, roomId: 'auditorium', roomName: 'Auditorium', memWarp: [10, 5], memTitleRe: /stage curtain/i, label: 'Auditorium' });
  await enterRoom(page, { doorX: 110, roomId: 'bus-loop', roomName: 'Bus Loop', memWarp: [4, 7], memTitleRe: /bus 12/i, label: 'Bus Loop' });
  await page.screenshot({ path: path.join(OUT, 'th-p5-shot-2-busloop.png') });

  // Secrets: gym -> roof ladder, then all the way back to hallway-b
  await page.evaluate(() => window.__th.warpTo(15, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "gym"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => window.__th.warpTo(12, 10));
  await hold(page, 'ArrowDown', 900);
  await page.waitForFunction('window.__th.zone.id === "roof"', { timeout: 5000 });
  log(true, 'Gym maintenance ladder reaches the Roof secret');
  await page.screenshot({ path: path.join(OUT, 'th-p5-shot-3-roof.png') });

  await page.evaluate(() => window.__th.warpTo(8, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "gym"', { timeout: 5000 });
  await page.evaluate(() => window.__th.warpTo(13, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  log(true, 'Roof -> gym -> hallway-b return chain all lands correctly');

  // Secrets: hallway-b -> basement -> tunnels chain
  await page.evaluate(() => window.__th.warpTo(123, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "basement"', { timeout: 5000 });
  log(true, 'Hidden East Wing door reaches the Basement');
  await new Promise(r => setTimeout(r, 400));
  // basement's own door to tunnels is a south-wall door (sprite at rows
  // 7-9, trigger at row 6, north of it) — approach from the room interior
  // (smaller row numbers) walking south, same as the earlier roof case
  await page.evaluate(() => window.__th.warpTo(7, 4));
  await hold(page, 'ArrowDown', 500);
  await page.waitForFunction('window.__th.zone.id === "tunnels"', { timeout: 5000 });
  log(true, 'Basement passage reaches the Maintenance Tunnels');
  await page.screenshot({ path: path.join(OUT, 'th-p5-shot-4-tunnels.png') });

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
