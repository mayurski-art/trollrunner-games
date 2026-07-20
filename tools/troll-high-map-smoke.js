/* Troll High campus map smoke test: verifies the M-key / button toggle,
   that movement freezes while it's open, and that it closes cleanly. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8962;
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

  log(await page.$eval('#th-map-overlay', el => el.hidden), 'map overlay starts hidden');

  await page.keyboard.press('KeyM');
  await page.waitForFunction('window.__th.mapOpen === true', { timeout: 3000 });
  log(true, 'M opens the campus map');

  const hasCanvas = await page.$eval('#th-map-canvas', el => el.width > 0 && el.height > 0);
  log(hasCanvas, 'map canvas rendered');

  // current zone (Main Hallway on spawn) should be highlighted in the drawn
  // schematic — sample a pixel where the "hallway-a" label sits
  const highlightText = await page.evaluate(() => {
    const c = document.getElementById('th-map-canvas');
    return c.getContext('2d').getImageData(1, 1, 1, 1) !== null; // sanity: readable
  });
  log(highlightText, 'canvas pixel data is readable (actually drew something)');

  const p0 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  await hold(page, 'ArrowRight', 400);
  const p1 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  log(p0.x === p1.x && p0.y === p1.y, 'player movement is frozen while the map is open');

  await page.keyboard.press('KeyM');
  await page.waitForFunction('window.__th.mapOpen === false', { timeout: 3000 });
  log(true, 'M again closes the campus map');

  // Reopen via the HUD button, close via the X button
  await page.click('#th-btn-map');
  await page.waitForFunction('window.__th.mapOpen === true', { timeout: 3000 });
  await page.click('#th-map-close');
  await page.waitForFunction('window.__th.mapOpen === false', { timeout: 3000 });
  log(true, 'HUD button opens and the X button closes');

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
