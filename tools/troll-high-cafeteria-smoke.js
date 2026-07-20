/* Troll High cafeteria smoke test: pick food, then confirm the order by
   typing your OWN student ID — wrong ID must be rejected, right ID (case-
   insensitive) must go through. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8966;
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

  // Into the Cafeteria — food bar is a 4x2 object at (18,5)
  await page.evaluate(() => window.__th.warpTo(62, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "cafeteria"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => window.__th.warpTo(19, 7));
  await hold(page, 'ArrowUp', 120);
  const hint = await page.$eval('#th-hint', el => el.textContent);
  log(/lunch/i.test(hint), `hint offers to get lunch: ${JSON.stringify(hint)}`);

  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.cafeteriaOpen === true', { timeout: 3000 });
  log(true, 'E opens the cafeteria menu');

  log(await page.$eval('#th-cafeteria-checkout', el => el.disabled), 'checkout is disabled with nothing selected');

  await page.click('.th-cafeteria-item[data-id="pizza"]');
  await page.click('.th-cafeteria-item[data-id="milk"]');
  const count = await page.$eval('#th-cafeteria-count', el => el.textContent);
  log(count === '2 items selected', `picking 2 items updates the count (${JSON.stringify(count)})`);
  log(await page.$eval('#th-cafeteria-checkout', el => !el.disabled), 'checkout enables once something is selected');

  // Movement should be frozen the whole time
  const p0 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  await hold(page, 'ArrowRight', 400);
  const p1 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  log(p0.x === p1.x && p0.y === p1.y, 'player movement is frozen while the cafeteria is open');

  await page.click('#th-cafeteria-checkout');
  await page.waitForSelector('#th-cafeteria-id-step:not([hidden])', { timeout: 3000 });
  log(true, 'checkout moves to the student ID step');

  // Wrong ID must be rejected
  await page.type('#th-cafeteria-id-input', 'ZZ-000000');
  await page.click('#th-cafeteria-id-form button[type="submit"]');
  await new Promise(r => setTimeout(r, 100));
  const errText = await page.$eval('#th-cafeteria-id-status', el => el.textContent);
  const stillOnIdStep = await page.$eval('#th-cafeteria-id-step', el => !el.hidden);
  log(errText.length > 0 && stillOnIdStep, `wrong student ID is rejected (${JSON.stringify(errText)})`);

  // Own ID (lowercase, to check case-insensitivity) must succeed
  const realId = await page.evaluate(() => window.__th.studentId);
  await page.evaluate(() => { document.getElementById('th-cafeteria-id-input').value = ''; });
  await page.type('#th-cafeteria-id-input', realId.toLowerCase());
  await page.click('#th-cafeteria-id-form button[type="submit"]');
  await page.waitForSelector('#th-cafeteria-done-step:not([hidden])', { timeout: 3000 });
  const doneMsg = await page.$eval('#th-cafeteria-done-msg', el => el.textContent);
  log(/2 items/.test(doneMsg), `own ID (case-insensitive) is accepted and order confirms (${JSON.stringify(doneMsg)})`);

  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.cafeteriaOpen === false', { timeout: 3000 });
  log(true, 'E closes the cafeteria from the done screen');

  // Reopening resets state (no stale selection/messages leak between visits)
  await hold(page, 'ArrowUp', 60);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.cafeteriaOpen === true', { timeout: 3000 });
  const freshCount = await page.$eval('#th-cafeteria-count', el => el.textContent);
  const onOrderStep = await page.$eval('#th-cafeteria-order-step', el => !el.hidden);
  log(freshCount === '0 items selected' && onOrderStep, 'reopening resets the menu to a clean state');

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
