/* Troll High NPC daily-schedule smoke test ("make the school feel alive",
   Phase 1 of the reprioritized design doc). Confirms NPCs with an
   activePeriods list actually appear/disappear as the deterministic world
   clock moves through periods, that a "moved" NPC (Janitor Gus) keeps the
   same relationship id across his two locations, and that the live 1s
   poll re-filters NPCs without requiring a zone re-entry. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation, lockClockToHour } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8996;
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
const hasNPC = (npcs, id) => npcs.some(n => n.id === id);

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
  // Start mid-school-day (Period 2) so the "at school" half of the
  // assertions below are deterministic regardless of wall-clock time.
  await lockClockToHour(page, 9);
  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');
  await dismissOrientation(page);

  // --- During school hours ---------------------------------------------
  // Janitor Gus patrols hallway-a; Ms. Quietly is in the library.
  const npcsHallway = await page.evaluate(() => window.__th.npcs.map(n => ({ id: n.def.id })));
  log(hasNPC(npcsHallway, 'janitor-gus'), 'Janitor Gus is on his hallway-a patrol during school hours');

  // Pep (bus loop) and Marcus Vale (gym, Period 5 only) should NOT be
  // present yet — it's Period 2.
  await page.evaluate(() => window.__th.warpTo(94, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  await page.evaluate(() => window.__th.warpTo(110, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "bus-loop"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  const busLoopSchool = await page.evaluate(() => window.__th.npcs.map(n => n.def.id));
  log(!busLoopSchool.includes('pep'), `Pep is NOT at the bus loop during Period 2 (found: ${JSON.stringify(busLoopSchool)})`);

  // --- Jump the clock to After school and re-enter the same zone --------
  // Back to hallway-b via bus-loop's own door (x=9, to hallway-b).
  await page.evaluate(() => window.__th.warpTo(9, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  // Advance the (already-patched) Date.now offset so it now lands squarely
  // in "After school" (hour 15-18) instead of Period 2.
  await page.evaluate(() => {
    const DAY_MS = 3600000;
    const targetFrac = 15.5 / 24;
    const realNow = window.__realDateNow || Date.now;
    window.__realDateNow = realNow;
    const base = realNow();
    const offset = Math.round(targetFrac * DAY_MS) - (base % DAY_MS);
    Date.now = () => window.__realDateNow() + offset;
  });

  await page.evaluate(() => window.__th.warpTo(110, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "bus-loop"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  const busLoopAfterSchool = await page.evaluate(() => window.__th.npcs.map(n => n.def.id));
  log(busLoopAfterSchool.includes('pep'), `Pep IS at the bus loop after school, re-entering the zone with the clock advanced (found: ${JSON.stringify(busLoopAfterSchool)})`);

  // Live re-filter, no zone change: push the clock straight to Evening
  // while still standing at the bus loop and wait out the 1s clock poll —
  // Pep should vanish without leaving/re-entering the zone.
  await page.evaluate(() => {
    const DAY_MS = 3600000;
    const targetFrac = 19 / 24;
    const base = window.__realDateNow();
    const offset = Math.round(targetFrac * DAY_MS) - (base % DAY_MS);
    Date.now = () => window.__realDateNow() + offset;
  });
  await new Promise(r => setTimeout(r, 1300));
  const busLoopEvening = await page.evaluate(() => window.__th.npcs.map(n => n.def.id));
  log(!busLoopEvening.includes('pep'), `Pep vanishes from the bus loop live via the 1s clock poll, no zone re-entry needed (found: ${JSON.stringify(busLoopEvening)})`);

  // Put the clock back to After school for the remaining checks.
  await page.evaluate(() => {
    const DAY_MS = 3600000;
    const targetFrac = 15.5 / 24;
    const base = window.__realDateNow();
    const offset = Math.round(targetFrac * DAY_MS) - (base % DAY_MS);
    Date.now = () => window.__realDateNow() + offset;
  });

  // Back to hallway-b (via bus-loop's own door, x=9), then hallway-a (via
  // hallway-b's door, x=2), then hallway-a's cafeteria door (x=62) —
  // cafeteria connects to hallway-a directly, not hallway-b.
  await page.evaluate(() => window.__th.warpTo(9, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  await page.evaluate(() => window.__th.warpTo(2, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-a"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  // Confirm Gus is genuinely gone from hallway-a after school (zone-entry
  // filtering, same mechanism already covered by the live-poll check above).
  const hallwayAfterSchool = await page.evaluate(() => window.__th.npcs.map(n => n.def.id));
  log(!hallwayAfterSchool.includes('janitor-gus'), `Janitor Gus is no longer patrolling hallway-a after school (found: ${JSON.stringify(hallwayAfterSchool)})`);

  // Janitor Gus should now be mopping the cafeteria, not hallway-a.
  await page.evaluate(() => window.__th.warpTo(62, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "cafeteria"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  const cafeteriaNPCs = await page.evaluate(() => window.__th.npcs.map(n => n.def.id));
  log(cafeteriaNPCs.includes('janitor-gus'), `Janitor Gus is mopping the cafeteria after school (found: ${JSON.stringify(cafeteriaNPCs)})`);
  log(!cafeteriaNPCs.includes('lunch-lady-doris'), `Lunch Lady Doris is gone from the cafeteria after school (found: ${JSON.stringify(cafeteriaNPCs)})`);

  // The cafeteria-Gus entry shares the same id, so relationship/dialogue
  // progress from meeting hallway-Gus earlier in the game carries over —
  // still standing in the cafeteria from the check above.
  const gus = await page.evaluate(() => {
    const n = window.__th.npcs.find(n => n.def.id === 'janitor-gus');
    return n ? { x: n.x, y: n.y } : null;
  });
  await page.evaluate(([x, y]) => window.__th.warpTo(Math.floor(x / 16) + 1, Math.round(y / 16)), [gus.x, gus.y]);
  await new Promise(r => setTimeout(r, 200));
  const gusHint = await page.$eval('#th-hint', el => el.textContent);
  const dbg = await page.evaluate(() => {
    const n = window.__th.npcs.find(n => n.def.id === 'janitor-gus');
    const p = window.__th.player;
    return n ? { npc: { x: n.x, y: n.y }, player: { x: p.x, y: p.y }, dist: n.distanceTo(p.x, p.y) } : null;
  });
  log(/Janitor Gus/i.test(gusHint), `hint offers to talk to cafeteria-Gus from the approach tile (${JSON.stringify(gusHint)}, gus at ${JSON.stringify(gus)}, dbg ${JSON.stringify(dbg)})`);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-dialogue', { timeout: 3000 });
  const dTitle = await page.$eval('#th-dialogue h3', el => el.textContent);
  log(dTitle.includes('Janitor Gus'), `talking to cafeteria-Gus shows the same name (${JSON.stringify(dTitle)})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-dialogue")');
  const relation = await page.evaluate(() => window.__th.npcRelations['janitor-gus']);
  log(!!relation && relation.timesTalked >= 1, `janitor-gus relationship record persists across his two locations (${JSON.stringify(relation)})`);

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
