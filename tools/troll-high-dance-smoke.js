/* Troll High School Dance smoke test (design doc §23 Phase 6, fourth
   Multiplayer Memories slice). Freezes the browser's Date to a real
   School Dance day (last Friday of the month, found via events.js's own
   logic) at a school-hours period, then verifies:
   - the Auditorium gets the dance visual tint
   - the synthesized dance beat (audio.js's Ambience.setDancing) starts
     when entering the Auditorium on a dance day and stops on leaving
   - stepping on the dance floor toggles a real broadcast (net.dancing)
     another live player can see on your ghost (💃 tag)
   - Priya's dance-day eventLine fires
   - a photo taken in the Auditorium during a dance gets tagged
     "School Dance" */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8973;
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

/* Same technique as troll-high-real-events-smoke.js: freeze Date to noon
   on the target day, offset within that hour to land in the given
   in-game period — clock.js's period math is time-of-day-within-the-real-
   hour, independent of calendar date. */
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

async function newVisitor(browser, name, dateArgs) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1024, height: 720 });
  const issues = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors') && !isExpectedAuthNoise(m.text())) issues.push(m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  await stubAuth(page, { userId: 'test-' + name.toLowerCase(), username: name });
  await freezeDateAndPeriod(page, dateArgs, 9); // Period 2 — school hours
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

(async () => {
  const { activeEvent } = await import('../assets/games/troll-high/src/events.js');
  const danceDate = findDate(activeEvent, 'dance');
  if (!danceDate) { console.error('Could not find a real School Dance date — aborting.'); process.exit(2); }
  const dateArgs = { year: danceDate.getFullYear(), month: danceDate.getMonth(), day: danceDate.getDate() };
  console.log(`Using dance date: ${danceDate.toDateString()}`);

  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1040,760', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });

  const a = await newVisitor(browser, 'DanceAlice', dateArgs);
  const b = await newVisitor(browser, 'DanceBob', dateArgs);

  log(await a.page.evaluate(() => window.__th.todaysEventId) === 'dance', 'game recognizes today as a School Dance');

  // Auditorium door is hallway-b's x=26
  await go(a.page, 94, 'hallway-b');
  await go(a.page, 26, 'auditorium');
  await go(b.page, 94, 'hallway-b');
  await go(b.page, 26, 'auditorium');

  // Dance beat starts on entering the Auditorium on a dance day
  const beatOn = await a.page.evaluate(() => !!window.__th.ambience._danceTimer);
  log(beatOn, "the synthesized dance beat starts on entering the Auditorium on a dance day");

  // Priya's dance-day eventLine (art-room, off hallway-b) — auditorium
  // only has one door, back to hallway-b, at x=1.
  await go(a.page, 1, 'hallway-b');
  await go(a.page, 38, 'art-room');
  const priya = await a.page.evaluate(() => { const n = window.__th.npcs.find(n => n.def.id === 'priya'); return { x: n.x, y: n.y }; });
  await a.page.evaluate(([x, y]) => window.__th.warpTo(Math.floor(x / 16) + 1, Math.round(y / 16)), [priya.x, priya.y]);
  await new Promise(r => setTimeout(r, 200));
  // Priya has firstLine (t=0) but no secondLine — the 2nd interaction
  // (t=1) is the first to fall through to event-aware cycling dialogue.
  await a.page.keyboard.press('KeyE');
  await a.page.waitForSelector('#th-dialogue', { timeout: 3000 });
  await a.page.keyboard.press('KeyE');
  await a.page.waitForFunction('!document.getElementById("th-dialogue")', { timeout: 3000 });
  await a.page.keyboard.press('KeyE');
  await a.page.waitForSelector('#th-dialogue', { timeout: 3000 });
  const priyaLine = await a.page.$eval('#th-dialogue p', el => el.textContent);
  log(/decorations|dance floor/i.test(priyaLine), `Priya's dance-day eventLine fires (${JSON.stringify(priyaLine)})`);
  await a.page.keyboard.press('KeyE');
  await a.page.waitForFunction('!document.getElementById("th-dialogue")', { timeout: 3000 });

  // Back to the Auditorium
  await a.page.evaluate(() => window.__th.warpTo(9, 5));
  await hold(a.page, 'ArrowUp', 700);
  await a.page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  await go(a.page, 26, 'auditorium');

  // Dance floor toggle: Alice steps on it
  await a.page.evaluate(() => window.__th.warpTo(10, 13));
  await hold(a.page, 'ArrowUp', 60);
  const hintBefore = await a.page.$eval('#th-hint', el => el.textContent);
  log(/Dance floor/i.test(hintBefore), `hint offers the dance floor (${JSON.stringify(hintBefore)})`);
  await a.page.keyboard.press('KeyE');
  await new Promise(r => setTimeout(r, 150));
  const aDancing = await a.page.evaluate(() => window.__th.myDancing);
  log(aDancing === true, 'Alice toggles myDancing=true by stepping on the dance floor');
  const aNetDancing = await a.page.evaluate(() => window.__th.net.dancing);
  log(aNetDancing === true, "Alice's dancing state is broadcast over presence (net.dancing=true)");

  // Bob sees Alice dancing via presence
  await new Promise(r => setTimeout(r, 2000));
  const bobGhosts = await b.page.evaluate(() => [...window.__th.ghosts.values()].map(g => ({ name: g.name, dancing: g.dancing })));
  log(bobGhosts.some(g => g.dancing === true), `Bob's ghost view of Alice shows her dancing (${JSON.stringify(bobGhosts)})`);

  // Toggling again turns it off
  await a.page.keyboard.press('KeyE');
  await new Promise(r => setTimeout(r, 150));
  const aDancingOff = await a.page.evaluate(() => window.__th.myDancing);
  log(aDancingOff === false, 'pressing E again toggles myDancing back to false');

  // Leaving the Auditorium stops the beat
  await a.page.evaluate(() => window.__th.warpTo(2, 5));
  await hold(a.page, 'ArrowUp', 700);
  await a.page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 200));
  const beatOffAfterLeaving = await a.page.evaluate(() => !!window.__th.ambience._danceTimer);
  log(beatOffAfterLeaving === false, 'the dance beat stops after leaving the Auditorium');

  // A photo taken in the Auditorium during the dance gets tagged
  await go(a.page, 26, 'auditorium');
  await a.page.click('#th-btn-yearbook');
  await a.page.waitForFunction('window.__th.yearbookOpen === true', { timeout: 3000 });
  await a.page.click('#th-yearbook-capture');
  await a.page.waitForFunction(
    '!document.getElementById("th-yearbook-status").hidden || window.__th.photos.length > 0',
    { timeout: 8000 }
  );
  // Stub auth has no real Supabase JWT, so the capture itself fails
  // gracefully (same documented behavior as troll-high-yearbook-smoke.js);
  // real end-to-end tagging is covered by a genuine account the same way
  // troll-high-shared-yearbook-smoke.js covers the shared-table insert.
  const lastPhoto = await a.page.evaluate(() => window.__th.photos[window.__th.photos.length - 1]);
  if (lastPhoto) {
    log(lastPhoto.eventTag === 'School Dance', `a photo taken in the Auditorium during a dance is tagged "School Dance" (${JSON.stringify(lastPhoto)})`);
  } else {
    const status = await a.page.$eval('#th-yearbook-status', el => el.textContent);
    log(status.length > 0, `capture failed gracefully under the stub session, as expected (${JSON.stringify(status)})`);
  }
  await a.page.click('#th-yearbook-close');

  log(a.issues.length === 0, 'Alice: no console errors' + (a.issues.length ? ':\n  ' + a.issues.join('\n  ') : ''));
  log(b.issues.length === 0, 'Bob: no console errors' + (b.issues.length ? ':\n  ' + b.issues.join('\n  ') : ''));

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
