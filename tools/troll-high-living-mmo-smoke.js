/* Troll High "Living MMO" unscripted-moments smoke test (design doc
   §21/§23 — the cheap version of world simulation: a rare deterministic
   daily roll off the same clock as everything else, no new backend).
   Three real calendar dates found via the same findDate() scan pattern
   as the other event tests, each frozen with the FakeDate technique.
   Covers: the fire-drill alarm's brief real-time window (not all-day),
   finding the hamster once (awards the card, one-time-per-day), joining
   the food fight (broadcasts live to a second real player), and each
   event's NPC eventLine. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8993;
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

async function newVisitor(browser, name, dateArgs, periodHour) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1024, height: 720 });
  const issues = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors') && !isExpectedAuthNoise(m.text())) issues.push(m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  await stubAuth(page, { userId: 'test-' + name.toLowerCase(), username: name });
  await freezeDateAndPeriod(page, dateArgs, periodHour);
  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');
  await dismissOrientation(page);
  return { ctx, page, issues };
}

async function go(page, doorX, expectZoneId) {
  await page.evaluate((x) => window.__th.warpTo(x, 5), doorX);
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction((id) => window.__th.zone.id === id, { timeout: 5000 }, expectZoneId);
  await new Promise(r => setTimeout(r, 200));
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
  const fireDrillDate = findDate(activeEvent, 'fire-drill');
  const hamsterDate = findDate(activeEvent, 'lost-hamster');
  const foodFightDate = findDate(activeEvent, 'food-fight');
  log(fireDrillDate !== null, `found a real Fire Drill date (${fireDrillDate && fireDrillDate.toDateString()})`);
  log(hamsterDate !== null, `found a real Lost Hamster date (${hamsterDate && hamsterDate.toDateString()})`);
  log(foodFightDate !== null, `found a real Food Fight date (${foodFightDate && foodFightDate.toDateString()})`);

  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1040,760', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });

  // === Fire Drill: brief real-time alarm window, not all-day ==============
  if (fireDrillDate) {
    const d = { year: fireDrillDate.getFullYear(), month: fireDrillDate.getMonth(), day: fireDrillDate.getDate() };
    const { ctx, page, issues } = await newVisitor(browser, 'DrillAlice', d, 9); // Period 2
    log(await page.evaluate(() => window.__th.todaysEventId) === 'fire-drill', 'game recognizes today as a Fire Drill');
    // We're already inside the drill's 90s window (locked to the middle
    // of Period 2's real-time span) — the alarm should be audible.
    const alarmOn = await page.evaluate(() => new Promise(resolve => setTimeout(() => resolve(!!window.__th.ambience._drillTimer), 1200)));
    log(alarmOn, 'the fire alarm is actually sounding during the drill window');

    // Principal Grimface's fire-drill eventLine (office, patrol)
    await go(page, 2, 'office');
    const principal = await page.evaluate(() => { const n = window.__th.npcs.find(n => n.def.id === 'principal-grimface'); return n && { x: n.x, y: n.y }; });
    if (principal) {
      await page.evaluate(([x, y]) => window.__th.warpTo(Math.round(x / 16), Math.round(y / 16) - 1), [principal.x, principal.y]);
      await new Promise(r => setTimeout(r, 200));
      await talkOnce(page); // firstLine
      const line = await talkOnce(page); // no secondLine -> falls through to eventLines
      log(/drill/i.test(line), `Principal Grimface's fire-drill eventLine fires (${JSON.stringify(line)})`);
    } else {
      log(false, 'could not locate Principal Grimface to test his eventLine');
    }
    log(issues.length === 0, 'Fire Drill: no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
    await ctx.close();
  }

  // === Lost Hamster: one-time-per-day card award ===========================
  if (hamsterDate) {
    const d = { year: hamsterDate.getFullYear(), month: hamsterDate.getMonth(), day: hamsterDate.getDate() };
    const { ctx, page, issues } = await newVisitor(browser, 'HamsterAlice', d, 9); // Period 2
    log(await page.evaluate(() => window.__th.todaysEventId) === 'lost-hamster', 'game recognizes today as Lost Hamster day');

    await go(page, 38, 'classroom-3d');
    // reading-corner at (16,10), w3h2 footRows1 -> solid row 11, approach row 12.
    await page.evaluate(() => window.__th.warpTo(17, 12));
    await hold(page, 'ArrowUp', 60);
    const hint = await page.$eval('#th-hint', el => el.textContent);
    log(/rustling/i.test(hint), `hint offers the hamster-in-hiding interaction (${JSON.stringify(hint)})`);

    const cardsBefore = await page.evaluate(() => window.__th.cards.hamster || 0);
    await page.keyboard.press('KeyE');
    await new Promise(r => setTimeout(r, 200));
    const cardsAfter = await page.evaluate(() => window.__th.cards.hamster || 0);
    log(cardsAfter === cardsBefore + 1, `finding the hamster awards the Class Hamster card (${cardsBefore} -> ${cardsAfter})`);

    // Interacting again the same day does nothing further (one-time) —
    // it falls through to the reading-corner's own ordinary memory card
    // instead (hamsterHere is now false), so close that before moving on.
    await page.keyboard.press('KeyE');
    await new Promise(r => setTimeout(r, 200));
    const cardsThird = await page.evaluate(() => window.__th.cards.hamster || 0);
    log(cardsThird === cardsAfter, `finding it again the same day doesn't award a second card (${cardsThird})`);
    const memoryOpen = await page.evaluate(() => !!document.getElementById('th-memory'));
    if (memoryOpen) {
      await page.keyboard.press('KeyE');
      await page.waitForFunction('!document.getElementById("th-memory")', { timeout: 3000 });
    }

    // Mrs. Petrova's lost-hamster eventLine
    const petrova = await page.evaluate(() => { const n = window.__th.npcs.find(n => n.def.id === 'mrs-petrova'); return { x: n.x, y: n.y }; });
    // Stationary NPCs draw at ((defX+0.5)*16, (defY+1)*16) — solving
    // placeAtTile's own offset backward for the nearest tile lands
    // almost exactly on (defX, defY) itself, well within the 26px
    // nearNPC radius regardless of facing (nearNPC is pure distance).
    await page.evaluate(([x, y]) => window.__th.warpTo(Math.round(x / 16 - 0.5), Math.round(y / 16 - 1)), [petrova.x, petrova.y]);
    await new Promise(r => setTimeout(r, 200));
    await talkOnce(page); // firstLine
    const line = await talkOnce(page); // no secondLine -> eventLines
    log(/hamster|bean bags/i.test(line), `Mrs. Petrova's lost-hamster eventLine fires (${JSON.stringify(line)})`);

    log(issues.length === 0, 'Lost Hamster: no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
    await ctx.close();
  }

  // === Food Fight: live broadcast to a second real player =================
  if (foodFightDate) {
    const d = { year: foodFightDate.getFullYear(), month: foodFightDate.getMonth(), day: foodFightDate.getDate() };
    const a = await newVisitor(browser, 'FightAlice', d, 12); // Lunch
    const b = await newVisitor(browser, 'FightBob', d, 12);
    log(await a.page.evaluate(() => window.__th.todaysEventId) === 'food-fight', 'game recognizes today as a Food Fight');

    await go(a.page, 62, 'cafeteria');
    await go(b.page, 62, 'cafeteria');
    // food-bar at (18,5), same approach coords as the cafeteria-smoke test.
    await a.page.evaluate(() => window.__th.warpTo(19, 7));
    await hold(a.page, 'ArrowUp', 120);
    const hint = await a.page.$eval('#th-hint', el => el.textContent);
    log(/food fight/i.test(hint), `hint offers to join the food fight (${JSON.stringify(hint)})`);

    await new Promise(r => setTimeout(r, 2500)); // let both join the room channel
    await a.page.keyboard.press('KeyE');
    await new Promise(r => setTimeout(r, 200));
    const aFlag = await a.page.evaluate(() => window.__th.dailyFlags.foodFight);
    log(aFlag === true, 'joining the food fight sets the one-time daily flag');

    const bobToast = await b.page.waitForFunction(
      () => {
        const el = document.getElementById('th-gift-toast');
        return !el.hidden && /food fight/i.test(el.textContent) ? el.textContent : false;
      },
      { timeout: 5000 }
    ).then(h => h.jsonValue()).catch(() => null);
    log(bobToast && /FightAlice/.test(bobToast), `Bob sees a live "food fight" toast naming Alice (${JSON.stringify(bobToast)})`);

    // Lunch Lady Doris's food-fight eventLine
    const doris = await a.page.evaluate(() => { const n = window.__th.npcs.find(n => n.def.id === 'lunch-lady-doris'); return { x: n.x, y: n.y }; });
    await a.page.evaluate(([x, y]) => window.__th.warpTo(Math.round(x / 16 - 0.5), Math.round(y / 16 - 1)), [doris.x, doris.y]);
    await new Promise(r => setTimeout(r, 200));
    await talkOnce(a.page); // firstLine
    const line = await talkOnce(a.page); // no secondLine -> eventLines
    log(/started it|cleanup/i.test(line), `Lunch Lady Doris's food-fight eventLine fires (${JSON.stringify(line)})`);

    log(a.issues.length === 0, 'Food Fight Alice: no console errors' + (a.issues.length ? ':\n  ' + a.issues.join('\n  ') : ''));
    log(b.issues.length === 0, 'Food Fight Bob: no console errors' + (b.issues.length ? ':\n  ' + b.issues.join('\n  ') : ''));
    await a.ctx.close();
    await b.ctx.close();
  }

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
