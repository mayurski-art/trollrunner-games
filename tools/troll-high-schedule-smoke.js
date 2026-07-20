/* Troll High orientation + class schedule + daily tasks smoke test.
   Feedback-driven addition (not in the original design doc): first-time
   elective pick, a schedule tied to the real bell-period clock, and
   daily tasks that auto-check off as the player does the underlying
   action (find a memory, play a minigame, get lunch, open the map). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8968;
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

  // Orientation shows automatically on a brand-new account, deliberately
  // NOT dismissed here (unlike every other test) — this is the one test
  // that verifies it.
  log(await page.evaluate(() => window.__th.orientationOpen), 'orientation shows automatically on a first-ever Start');

  const p0 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  await hold(page, 'ArrowRight', 400);
  const p1 = await page.evaluate(() => ({ x: window.__th.player.x, y: window.__th.player.y }));
  log(p0.x === p1.x && p0.y === p1.y, 'player movement is frozen during orientation');

  await page.click('.th-orientation-elective:nth-child(2)'); // Band
  await page.click('#th-orientation-start');
  await page.waitForFunction('window.__th.orientationOpen === false', { timeout: 3000 });
  const elective = await page.evaluate(() => window.__th.elective);
  log(elective === 'band', `picked elective is saved (${elective})`);

  // Reload: orientation must NOT show again for the same account
  await page.evaluate(() => window.__th.persist());
  await new Promise(r => setTimeout(r, 300));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 10000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true', { timeout: 10000 });
  const orientationAgain = await page.evaluate(() => window.__th.orientationOpen);
  log(orientationAgain === false, 'orientation does not show again on a returning session');
  const electiveAfterReload = await page.evaluate(() => window.__th.elective);
  log(electiveAfterReload === 'band', 'elective choice persisted across reload');

  // Schedule
  await page.click('#th-btn-schedule');
  await page.waitForFunction('window.__th.scheduleOpen === true', { timeout: 3000 });
  const rows = await page.$$eval('#th-schedule-table tbody tr', trs => trs.map(tr => tr.textContent));
  log(rows.length === 8, `schedule has 8 periods (${rows.length})`);
  log(rows.some(r => /Band/.test(r) && /Music Room/.test(r)), `chosen elective appears in the schedule (${JSON.stringify(rows.find(r => /Band/.test(r)))})`);
  // Only a real class period (Homeroom..Period 6/Lunch) has a matching row
  // to highlight — the clock also cycles through non-school times (night,
  // weekends), where correctly nothing should be highlighted, so this just
  // checks it never highlights more than one row.
  const highlightCount = await page.$$eval('#th-schedule-table tr.is-current', els => els.length);
  log(highlightCount <= 1, `at most one schedule row is highlighted as current (${highlightCount})`);

  // Daily tasks all start unchecked
  const tasksBefore = await page.$$eval('#th-schedule-tasks li', els => els.map(e => e.textContent));
  log(tasksBefore.every(t => t.startsWith('☐')), `all daily tasks start unchecked (${JSON.stringify(tasksBefore)})`);
  await page.click('#th-schedule-close');

  // Doing the underlying action (finding a memory) checks off the task
  await page.evaluate(() => window.__th.warpTo(7, 3));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-memory")');

  const flags = await page.evaluate(() => window.__th.dailyFlags);
  log(flags.memory === true, `finding a memory checks off its daily task (${JSON.stringify(flags)})`);

  await page.click('#th-btn-schedule');
  await page.waitForFunction('window.__th.scheduleOpen === true', { timeout: 3000 });
  const tasksAfter = await page.$$eval('#th-schedule-tasks li', els => els.map(e => ({ text: e.textContent, done: e.className.includes('is-done') })));
  const memoryTask = tasksAfter.find(t => /memory/i.test(t.text));
  log(memoryTask && memoryTask.done && memoryTask.text.startsWith('☑'), `schedule card shows the memory task checked (${JSON.stringify(memoryTask)})`);
  await page.click('#th-schedule-close');

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
