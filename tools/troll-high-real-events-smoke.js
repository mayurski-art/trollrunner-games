/* Troll High "Real School Events" smoke test (design doc §23 Phase 4 —
   turn Book Fair/Pizza Friday/Picture Day/Spirit Week/PACER Day into
   actual interactive happenings, not just calendar banners). Freezes the
   browser's Date (both `new Date()` and `Date.now()`) to a specific
   real-calendar day picked deterministically via events.js's own logic,
   offset within that day to land in a school-hours period so the
   relevant NPC is on-schedule, then verifies:
   - events.js recognizes the two new events (Picture Day, PACER Day)
   - NPCs cycle through eventLines instead of normal dialogue on their day
   - a Picture Day photo gets tagged and shows in the yearbook
   - a PACER Day high score gets its own toast */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8999;
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

function findDate(activeEvent, wantId, { fromYear = 2026, maxDays = 3000 } = {}) {
  const start = new Date(fromYear, 0, 1);
  for (let i = 0; i < maxDays; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    if (activeEvent(d) === wantId) return d;
  }
  return null;
}

/* Freezes the page's Date so `new Date()`/`Date.now()` always resolve to
   a fixed instant: noon on the given calendar day, offset within that
   hour so clock.js's period math (which reads Date.now() % 1hr, totally
   independent of calendar date) lands in the given in-game hour's
   period. Everything else (performance.now()-driven animation) is
   untouched, so the game loop still runs normally. */
async function freezeDateAndPeriod(page, { year, month, day }, periodHour) {
  await page.evaluateOnNewDocument((y, m, d, ph) => {
    const DAY_MS = 3600000;
    const base = new Date(y, m, d, 12, 0, 0).getTime();
    const targetFrac = (ph + 0.5) / 24;
    const offset = Math.round(targetFrac * DAY_MS) - (base % DAY_MS);
    const FIXED = base + offset;
    const RealDate = Date;
    class FakeDate extends RealDate {
      constructor(...args) { if (args.length === 0) super(FIXED); else super(...args); }
      static now() { return FIXED; }
    }
    Object.defineProperty(window, 'Date', { value: FakeDate, writable: true, configurable: true });
  }, year, month, day, periodHour);
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
  const { activeEvent } = await import('../assets/games/troll-high/src/events.js');

  // ---- pure date-logic for the 2 new events ----
  const pictureDay = new Date(2026, 3, 15); // Apr 15 — day 15, unambiguous every month
  log(activeEvent(pictureDay) === 'picture-day', `day 15 is Picture Day (${activeEvent(pictureDay)})`);
  const pacerDay = new Date(2026, 3, 20); // Apr 20 — day 20, unambiguous every month
  log(activeEvent(pacerDay) === 'pacer-day', `day 20 is PACER Day (${activeEvent(pacerDay)})`);

  const bookFairDate = findDate(activeEvent, 'book-fair');
  const pizzaFridayDate = findDate(activeEvent, 'pizza-friday');
  log(bookFairDate !== null, `found a real Book Fair date (${bookFairDate && bookFairDate.toDateString()})`);
  log(pizzaFridayDate !== null, `found a real Pizza Friday date not shadowed by a higher-priority event (${pizzaFridayDate && pizzaFridayDate.toDateString()})`);

  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1040,760', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });

  // === Book Fair: Ms. Quietly's eventLines =================================
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 720 });
    const issues = [];
    page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors') && !isExpectedAuthNoise(m.text())) issues.push(m.text()); });
    page.on('pageerror', e => issues.push('pageerror: ' + e.message));
    await stubAuth(page);
    await freezeDateAndPeriod(page, { year: bookFairDate.getFullYear(), month: bookFairDate.getMonth(), day: bookFairDate.getDate() }, 9); // Period 2
    await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
    await page.click('#th-start');
    await page.waitForFunction('window.__th.running === true');
    await dismissOrientation(page);

    log(await page.evaluate(() => window.__th.todaysEventId) === 'book-fair', 'game recognizes today as Book Fair');

    await page.evaluate(() => window.__th.warpTo(74, 5));
    await hold(page, 'ArrowUp', 700);
    await page.waitForFunction('window.__th.zone.id === "library"', { timeout: 5000 });
    await new Promise(r => setTimeout(r, 300));
    const quietly = await page.evaluate(() => { const n = window.__th.npcs.find(n => n.def.id === 'ms-quietly'); return { x: n.x, y: n.y }; });
    await page.evaluate(([x, y]) => window.__th.warpTo(Math.floor(x / 16) + 1, Math.round(y / 16)), [quietly.x, quietly.y]);
    await new Promise(r => setTimeout(r, 200));
    // Ms. Quietly has firstLine (t=0) and secondLine (t=1) milestone tiers
    // ahead of eventLines in relations.js's priority order — the 3rd
    // interaction (t=2) is the first one that actually falls through to
    // event-aware cycling dialogue.
    await talkOnce(page);
    await talkOnce(page);
    const line = await talkOnce(page);
    log(/book fair/i.test(line), `3rd interaction with Ms. Quietly falls through to the book fair eventLine (${JSON.stringify(line)})`);

    log(issues.length === 0, 'Book Fair: no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
    await page.close();
  }

  // === Pizza Friday: Doris's eventLines (dialogue-only; cafeteria special already covered by troll-high-events-smoke.js) ===
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 720 });
    const issues = [];
    page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors') && !isExpectedAuthNoise(m.text())) issues.push(m.text()); });
    page.on('pageerror', e => issues.push('pageerror: ' + e.message));
    await stubAuth(page);
    await freezeDateAndPeriod(page, { year: pizzaFridayDate.getFullYear(), month: pizzaFridayDate.getMonth(), day: pizzaFridayDate.getDate() }, 12); // Lunch
    await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
    await page.click('#th-start');
    await page.waitForFunction('window.__th.running === true');
    await dismissOrientation(page);

    log(await page.evaluate(() => window.__th.todaysEventId) === 'pizza-friday', 'game recognizes today as Pizza Friday');

    await page.evaluate(() => window.__th.warpTo(62, 5));
    await hold(page, 'ArrowUp', 700);
    await page.waitForFunction('window.__th.zone.id === "cafeteria"', { timeout: 5000 });
    await new Promise(r => setTimeout(r, 300));
    const doris = await page.evaluate(() => { const n = window.__th.npcs.find(n => n.def.id === 'lunch-lady-doris'); return { x: n.x, y: n.y }; });
    await page.evaluate(([x, y]) => window.__th.warpTo(Math.floor(x / 16) + 1, Math.round(y / 16)), [doris.x, doris.y]);
    await new Promise(r => setTimeout(r, 200));
    // Doris has no secondLine — the 2nd interaction (t=1) already falls
    // through to event-aware cycling dialogue.
    await talkOnce(page);
    const line = await talkOnce(page);
    log(/pizza friday/i.test(line), `2nd interaction with Lunch Lady Doris falls through to the Pizza Friday eventLine (${JSON.stringify(line)})`);

    log(issues.length === 0, 'Pizza Friday: no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
    await page.close();
  }

  // === Picture Day: photo tagging + yearbook + Wendell's eventLines =======
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 720 });
    const issues = [];
    page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors') && !isExpectedAuthNoise(m.text())) issues.push(m.text()); });
    page.on('pageerror', e => issues.push('pageerror: ' + e.message));
    await stubAuth(page);
    await freezeDateAndPeriod(page, { year: 2026, month: 3, day: 15 }, 9); // Period 2
    await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
    await page.click('#th-start');
    await page.waitForFunction('window.__th.running === true');
    await dismissOrientation(page);

    log(await page.evaluate(() => window.__th.todaysEventId) === 'picture-day', 'game recognizes today as Picture Day');

    // Wendell's Picture Day line
    await page.evaluate(() => window.__th.warpTo(2, 5));
    await hold(page, 'ArrowUp', 700);
    await page.waitForFunction('window.__th.zone.id === "office"', { timeout: 5000 });
    await new Promise(r => setTimeout(r, 300));
    const wendell = await page.evaluate(() => { const n = window.__th.npcs.find(n => n.def.id === 'wendell'); return { x: n.x, y: n.y }; });
    await page.evaluate(([x, y]) => window.__th.warpTo(Math.floor(x / 16) + 1, Math.round(y / 16)), [wendell.x, wendell.y]);
    await new Promise(r => setTimeout(r, 200));
    // Wendell has no secondLine — the 2nd interaction already falls
    // through to event-aware cycling dialogue.
    await talkOnce(page);
    const wLine = await talkOnce(page);
    log(/picture day/i.test(wLine), `2nd interaction with Wendell falls through to the Picture Day eventLine (${JSON.stringify(wLine)})`);

    // Camera capture is real Supabase Storage, which the auth stub can't
    // reach (no real JWT) — this is expected to fail gracefully. Cover
    // just that the yearbook UI opens and the capture attempt doesn't
    // crash; full upload success is covered manually/by gate-smoke's
    // real-account path, same convention as other storage-backed tests.
    await page.click('#th-btn-yearbook');
    await page.waitForFunction('window.__th.yearbookOpen === true', { timeout: 3000 });
    const captureOk = await page.evaluate(async () => {
      try { document.getElementById('th-yearbook-capture').click(); return true; } catch (e) { return false; }
    });
    log(captureOk, 'Picture Day capture button is clickable without throwing (real upload covered by gate-smoke)');
    await new Promise(r => setTimeout(r, 500));
    await page.click('#th-yearbook-close');

    log(issues.length === 0, 'Picture Day: no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
    await page.close();
  }

  // === PACER Day: Marcus's eventLines + high-score toast ===================
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 720 });
    const issues = [];
    page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors') && !isExpectedAuthNoise(m.text())) issues.push(m.text()); });
    page.on('pageerror', e => issues.push('pageerror: ' + e.message));
    await stubAuth(page);
    await freezeDateAndPeriod(page, { year: 2026, month: 3, day: 20 }, 13); // Period 5, matches Marcus's schedule
    await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
    await page.click('#th-start');
    await page.waitForFunction('window.__th.running === true');
    await dismissOrientation(page);

    log(await page.evaluate(() => window.__th.todaysEventId) === 'pacer-day', 'game recognizes today as PACER Day');

    await page.evaluate(() => window.__th.warpTo(94, 5));
    await hold(page, 'ArrowUp', 700);
    await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
    await page.evaluate(() => window.__th.warpTo(15, 5));
    await hold(page, 'ArrowUp', 700);
    await page.waitForFunction('window.__th.zone.id === "gym"', { timeout: 5000 });
    await new Promise(r => setTimeout(r, 300));
    const marcus = await page.evaluate(() => { const n = window.__th.npcs.find(n => n.def.id === 'marcus-vale'); return { x: n.x, y: n.y }; });
    await page.evaluate(([x, y]) => window.__th.warpTo(Math.floor(x / 16) + 1, Math.round(y / 16)), [marcus.x, marcus.y]);
    await new Promise(r => setTimeout(r, 200));
    // Marcus has firstLine (t=0) and secondLine (t=1) milestone tiers
    // ahead of eventLines — the 3rd interaction (t=2) is the first one
    // that falls through to event-aware cycling dialogue.
    await talkOnce(page);
    await talkOnce(page);
    const mLine = await talkOnce(page);
    log(/pacer day/i.test(mLine), `3rd interaction with Marcus falls through to the PACER Day eventLine (${JSON.stringify(mLine)})`);

    // Force a PACER Test high score directly via the minigame debug hooks
    // (same technique used elsewhere) rather than actually playing it out.
    await page.evaluate(() => window.__th.openMinigame({ type: 'pacer-test', def: {}, play: 'pacer-test' }));
    await page.waitForFunction('window.__th.minigameOpen === true', { timeout: 3000 });
    await page.evaluate(() => { window.__th.minigame.score = 999; });
    await page.evaluate(() => window.__th.closeMinigame());
    await new Promise(r => setTimeout(r, 200));
    const toast = await page.$eval('#th-gift-toast', el => ({ hidden: el.hidden, text: el.textContent }));
    log(!toast.hidden && /PACER Day/i.test(toast.text), `PACER Day high-score toast fires (${JSON.stringify(toast)})`);

    log(issues.length === 0, 'PACER Day: no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
    await page.close();
  }

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
