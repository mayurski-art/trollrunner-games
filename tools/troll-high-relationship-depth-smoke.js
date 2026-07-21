/* Troll High relationship-depth smoke test (design doc §23 Phase 2 —
   "deepen relationships beyond the current 2-tier system"). Verifies
   relations.js's new tiers on Ms. Quietly (library): firstLine ->
   secondLine -> a one-time "remember when" memoryLine once its condition
   (5 cards collected) becomes true -> familiarLine at the usual threshold
   -> closeLine at the deeper threshold -> a time-aware returningLine after
   a simulated real-time gap. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation, lockClockToHour } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8997;
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
  // Ms. Quietly is school-hours-only (Phase 1 schedule) — pin the clock so
  // the library isn't empty when this test runs.
  await lockClockToHour(page, 9);
  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');
  await dismissOrientation(page);

  // Into the library
  await page.evaluate(() => window.__th.warpTo(74, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "library"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));

  const quietly = await page.evaluate(() => {
    const n = window.__th.npcs.find(n => n.def.id === 'ms-quietly');
    return { x: n.x, y: n.y };
  });
  await page.evaluate(([x, y]) => window.__th.warpTo(Math.floor(x / 16) + 1, Math.round(y / 16)), [quietly.x, quietly.y]);
  await new Promise(r => setTimeout(r, 200));

  const line1 = await talkOnce(page);
  log(line1 === "New here? Then you especially need to be quiet.", `firstLine on the 1st interaction (${JSON.stringify(line1)})`);

  const line2 = await talkOnce(page);
  log(line2 === "You're back. Good. Quietly, though.", `secondLine on the 2nd interaction, distinct from firstLine (${JSON.stringify(line2)})`);

  // Unlock the "5 cards collected" memory condition before the 3rd chat —
  // addCard is exposed on window.__th for exactly this kind of test.
  await page.evaluate(() => {
    for (let i = 1; i <= 5; i++) window.__th.addCard('test-card-' + i);
  });
  const line3 = await talkOnce(page);
  log(/collecting cards/i.test(line3), `3rd interaction fires the one-time "cards" memoryLine now that its condition is true (${JSON.stringify(line3)})`);

  // 4th interaction lands on timesTalked===3 (FAMILIAR_AT) going in.
  const line4 = await talkOnce(page);
  log(line4 === "You're becoming a regular. Quietly, of course.", `familiarLine fires at the usual threshold, unaffected by the new tiers (${JSON.stringify(line4)})`);

  const line5 = await talkOnce(page);
  log(line5 !== line4 && !/collecting cards/i.test(line5), `5th interaction falls back to normal cycling, doesn't repeat familiarLine or the consumed memoryLine (${JSON.stringify(line5)})`);

  // Push on to CLOSE_AT (timesTalked === 8 going in, our 9th talkOnce
  // overall) — interactions 6,7,8 are normal cycling.
  let lastLine = line5;
  for (let i = 0; i < 4; i++) lastLine = await talkOnce(page);
  log(lastLine === "You've basically got a reserved seat in here now. Quietly earned.", `closeLine fires at the deeper CLOSE_AT threshold (${JSON.stringify(lastLine)})`);

  const relationBefore = await page.evaluate(() => window.__th.npcRelations['ms-quietly']);
  log(relationBefore.timesTalked === 9, `relationship record shows 9 real interactions so far (${JSON.stringify(relationBefore)})`);

  // Time-aware returningLine: jump the clock forward >3 real hours (the
  // "it's been a few days" gap) and confirm the next interaction uses it
  // instead of normal cycling dialogue.
  await page.evaluate(() => {
    const fourHoursMs = 4 * 60 * 60 * 1000;
    const realNow = window.__realDateNow || Date.now;
    window.__realDateNow = realNow;
    const patched = Date.now;
    Date.now = () => patched() + fourHoursMs;
  });
  const returningLine = await talkOnce(page);
  log(returningLine === "Been a few days. The books missed you. I did not say that out loud.", `returningLine fires after a simulated real-time gap (${JSON.stringify(returningLine)})`);

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
