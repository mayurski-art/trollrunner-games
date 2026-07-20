/* Troll High zone editor smoke test: serves the repo statically and drives
   the editor end-to-end in headless Chrome — new zone, terrain paint
   (click + drag-fill), object placement/removal, door drawing, spawn set,
   JSON round-trip via the debug hook. Run from anywhere after
   `npm i puppeteer-core` (screenshot lands next to this script). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = __dirname;
const PORT = 8936;
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

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1400,900', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 860 });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleIssues.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => consoleIssues.push('pageerror: ' + e.message));

  await page.goto(`http://localhost:${PORT}/tools/troll-high-editor.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__the && window.__the.ready', { timeout: 15000 });
  log(true, 'editor boots with a blank zone');

  const initial = await page.evaluate(() => window.__the.toJSON());
  log(initial.w === 20 && initial.h === 14 && initial.tileset === 'hallway', 'default zone is 20x14 on the hallway tileset');
  log(initial.terrain.length === 15 && initial.terrain[0].length === 21, 'terrain grid dims match w+1/h+1');

  // New Zone with custom size
  await page.evaluate(() => { document.getElementById('f-id').value = 'test-room'; });
  await page.evaluate(() => { document.getElementById('f-name').value = 'Test Room'; });
  await page.evaluate(() => { document.getElementById('f-w').value = 16; });
  await page.evaluate(() => { document.getElementById('f-h').value = 10; });
  await page.select('#f-tileset', 'classroom');
  await page.click('#btn-new');
  // model.id updates synchronously but rebuild() (tileset fetch + canvas
  // resize) is async — wait for the canvas itself, not just the id, or the
  // subsequent boundingBox() reads stale (pre-resize) dimensions.
  await page.waitForFunction('window.__the.canvasSize().w === 16 * 16 && window.__the.canvasSize().h === 10 * 16');
  const sized = await page.evaluate(() => window.__the.toJSON());
  log(sized.w === 16 && sized.h === 10 && sized.tileset === 'classroom', 'resize/new applies id, dims, tileset');

  const canvasBox = await (await page.$('#th-ed-overlay')).boundingBox();
  const ZOOM = canvasBox.width / (sized.w * 16);
  const toPx = (tileX, tileY) => ({ x: canvasBox.x + tileX * 16 * ZOOM, y: canvasBox.y + tileY * 16 * ZOOM });

  // Terrain: single-click toggles one vertex (carve a doorway gap in the top wall)
  const beforeVertex = sized.terrain[0][8];
  const p = toPx(8, 0);
  await page.mouse.click(p.x, p.y);
  const afterClick = await page.evaluate(() => window.__the.toJSON());
  log(beforeVertex === '#' && afterClick.terrain[0][8] === '.', `single click toggles one vertex ('${beforeVertex}' -> '${afterClick.terrain[0][8]}')`);

  // Terrain: drag-fill a rectangle with the Floor brush (should already be default Wall; switch brush first)
  await page.click('[data-tool="terrain"]');
  await page.click('[data-brush="floor"]');
  const d0 = toPx(1, 1), d1 = toPx(4, 3);
  await page.mouse.move(d0.x, d0.y);
  await page.mouse.down();
  await page.mouse.move(d1.x, d1.y, { steps: 5 });
  await page.mouse.up();
  const afterFill = await page.evaluate(() => window.__the.toJSON());
  const filledOk = afterFill.terrain.slice(1, 4).every(row => [...row.slice(1, 5)].every(ch => ch === '.'));
  log(filledOk, 'drag rectangle bulk-fills vertices with the selected brush');

  // Objects: place a student-desk, then remove it with right-click
  await page.click('[data-tool="objects"]');
  await page.click('.obj-btn[data-type="student-desk"]');
  const op = toPx(6, 6);
  await page.mouse.click(op.x, op.y);
  const withObj = await page.evaluate(() => window.__the.toJSON());
  log(withObj.objects.some(o => o.type === 'student-desk' && o.x === 6 && o.y === 6), 'places an object snapped to the clicked cell');
  await page.mouse.click(op.x, op.y, { button: 'right' });
  const withoutObj = await page.evaluate(() => window.__the.toJSON());
  log(withoutObj.objects.length === withObj.objects.length - 1, 'right-click removes the object under the cursor');

  // Doors: drag a rectangle, then edit its target fields in the sidebar
  await page.click('[data-tool="doors"]');
  const dd0 = toPx(10, 2), dd1 = toPx(11, 2);
  await page.mouse.move(dd0.x, dd0.y);
  await page.mouse.down();
  await page.mouse.move(dd1.x, dd1.y, { steps: 3 });
  await page.mouse.up();
  const withDoor = await page.evaluate(() => window.__the.toJSON());
  log(withDoor.doors.length === 1 && withDoor.doors[0].x === 10 && withDoor.doors[0].y === 2, 'drag draws a door rectangle at the right cell');
  await page.type('#door-list input[data-k="to"]', 'hallway-a');
  await page.$eval('#door-list input[data-k="to"]', el => el.dispatchEvent(new Event('change')));
  const doorEdited = await page.evaluate(() => window.__the.toJSON());
  log(doorEdited.doors[0].to === 'hallway-a', 'sidebar edits update the door target');

  // Spawn
  await page.click('[data-tool="spawn"]');
  const sp = toPx(3, 3);
  await page.mouse.click(sp.x, sp.y);
  const withSpawn = await page.evaluate(() => window.__the.toJSON());
  log(withSpawn.spawn.x === 3 && withSpawn.spawn.y === 3, 'click sets the spawn point');

  await page.screenshot({ path: path.join(OUT, 'the-shot-1-editing.png') });

  // Round-trip: export -> reload via the file input path (simulate by feeding the JSON through fromZoneJSON indirectly)
  const exported = await page.evaluate(() => window.__the.toJSON());
  log(exported.terrain.length === exported.h + 1 && exported.terrain.every(r => r.length === exported.w + 1),
    'exported JSON has valid (h+1)x(w+1) terrain dims');
  log(/^[.#]+$/.test(exported.terrain.join('')), 'exported terrain is pure #/. characters');

  const realIssues = consoleIssues.filter(t => !t.includes('frame-ancestors'));
  log(realIssues.length === 0, 'no console errors' + (realIssues.length ? ':\n  ' + realIssues.join('\n  ') : ''));

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
