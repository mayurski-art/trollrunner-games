/* Troll High weather/particles smoke test (design doc Phase 12). Snow
   Day is the one event (of the six in events.js) with a real visual
   particle effect. Since today's REAL event is whatever it is, this
   test drives the renderer directly (exposed via window.__th.renderer)
   with weather forced to "snow-day" and checks actual pixel output on
   the backbuffer canvas — not just that the function didn't throw — and
   that particles move between frames rather than being static. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8994;
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

  // No weather: draw a frame and count white-ish pixels (should be ~none
  // beyond incidental sprite colors)
  const baseline = await page.evaluate(() => {
    const r = window.__th.renderer, z = window.__th.zone;
    r.frame(z, [window.__th.player.entity()], 0, null, null);
    const img = r.bctx.getImageData(0, 0, r.back.width, r.back.height).data;
    let white = 0;
    for (let i = 0; i < img.length; i += 4) {
      if (img[i] > 240 && img[i + 1] > 240 && img[i + 2] > 240 && img[i + 3] > 200) white++;
    }
    return white;
  });
  log(typeof baseline === 'number', `baseline frame (no weather) renders without throwing (${baseline} near-white px)`);

  // Force snow-day weather and confirm real white particle pixels appear
  const snowFrame1 = await page.evaluate(() => {
    const r = window.__th.renderer, z = window.__th.zone;
    r.frame(z, [window.__th.player.entity()], 0, null, 'snow-day');
    const img = r.bctx.getImageData(0, 0, r.back.width, r.back.height).data;
    let white = 0;
    for (let i = 0; i < img.length; i += 4) {
      if (img[i] > 240 && img[i + 1] > 240 && img[i + 2] > 240 && img[i + 3] > 200) white++;
    }
    return white;
  });
  log(snowFrame1 > baseline, `forcing weather="snow-day" adds real white particle pixels (${snowFrame1} vs baseline ${baseline})`);

  // Snapshot particle positions, advance several frames, confirm they moved
  const positionsBefore = await page.evaluate(() => window.__th.renderer._snow.map(p => ({ x: p.x, y: p.y })));
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => {
    const r = window.__th.renderer, z = window.__th.zone;
    for (let i = 0; i < 10; i++) r.frame(z, [window.__th.player.entity()], 0, null, 'snow-day');
  });
  const positionsAfter = await page.evaluate(() => window.__th.renderer._snow.map(p => ({ x: p.x, y: p.y })));
  const moved = positionsBefore.some((p, i) => Math.abs(p.y - positionsAfter[i].y) > 0.5);
  log(moved, 'snow particles actually move between frames, not static decals');

  // Halloween tint: confirm the tint color actually gets composited
  const tintFrame = await page.evaluate(() => {
    const r = window.__th.renderer, z = window.__th.zone;
    r.frame(z, [window.__th.player.entity()], 0, 'rgba(255, 120, 20, 0.16)', null);
    const img = r.bctx.getImageData(0, 0, 1, 1).data;
    return [img[0], img[1], img[2]];
  });
  log(tintFrame[0] > 0, `event tint actually composites onto the backbuffer (sampled pixel rgb=${JSON.stringify(tintFrame)})`);

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
