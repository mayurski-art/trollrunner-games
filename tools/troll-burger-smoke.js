/* The Rusty Troll smoke test: serves the repo statically and drives the
   full clock-in → griddle → counter → window → serve → shift-end loop,
   plus phase-2 fry basket / drink / promotion mechanics, in headless
   Chrome. Run from anywhere after `npm i puppeteer-core` (screenshots
   land next to this script). External cross-repo scripts (coming-soon
   gate, accounts, notis, CDN) are blocked so the test is hermetic — the
   game is required to run without them. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = __dirname;
const PORT = 8933;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' };

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = path.join(ROOT, url === '/' ? 'index.html' : decodeURIComponent(url));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
server.unref();

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const results = [];
const consoleIssues = [];
function log(ok, msg) { results.push((ok ? 'PASS' : 'FAIL') + ' | ' + msg); console.log(results[results.length - 1]); }

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1180,860', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1160, height: 840 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().startsWith(`http://localhost:${PORT}`)) req.continue();
    else req.abort();                        // gate/accounts/notis/CDN/fonts
  });
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type())) return;
    const t = m.text();
    if (/ERR_FAILED|net::|frame-ancestors|Failed to load resource/.test(t)) return; // blocked externals
    consoleIssues.push(m.type() + ': ' + t);
  });
  page.on('pageerror', (e) => consoleIssues.push('pageerror: ' + e.message));

  await page.goto(`http://localhost:${PORT}/troll-burger.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__tb && window.__tb.S.screen === "title"');
  await page.screenshot({ path: path.join(OUT, 'tb-1-title.png') });
  log(true, 'page loads, boots to title screen');

  // Clock in
  await page.click('#tb-start-btn');
  await page.waitForFunction('window.__tb.S.screen === "shift"');
  log(true, `shift starts, rank ${await page.evaluate(() => window.__tb.S.rank.title)}, ${await page.evaluate(() => window.__tb.S.grill.length)} grill slots`);

  // ---- shift 1: pure-burger ticket (sides don't start until shift 2) ----
  await page.waitForFunction('window.__tb.S.tickets.length === 1', { timeout: 20000 });
  const ticket = await page.evaluate(() => JSON.parse(JSON.stringify(window.__tb.S.tickets[0])));
  log(ticket.sides.length === 0, `ticket #${ticket.id} for ${ticket.cust.n}: ${ticket.layers.join(' > ')} (sides: ${ticket.sides.join(',') || 'none'})`);

  const needPatties = ticket.layers.filter((k) => k === 'patty').length;
  await page.screenshot({ path: path.join(OUT, 'tb-2-griddle-empty.png') });
  for (let i = 0; i < needPatties; i++) await page.click('#tb-patty-tub');
  const laid = await page.evaluate(() => window.__tb.S.grill.filter(Boolean).length);
  log(laid === needPatties, `${laid}/${needPatties} patties laid`);

  await page.evaluate((target) => {
    for (const p of window.__tb.S.grill) if (p) p.down = target;
  }, 75 /* PERFECT.target */);
  await new Promise((r) => setTimeout(r, 200));
  const slotButtons = await page.$$('.tb-slot.has-patty');
  for (const btn of slotButtons) await btn.click();  // flip: cooked side becomes "up", raw "down" starts cooking
  await page.evaluate((target) => {
    for (const p of window.__tb.S.grill) if (p) p.down = target;
  }, 75);
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: path.join(OUT, 'tb-3-griddle-cooked.png') });
  const grades = await page.evaluate(() =>
    window.__tb.S.grill.filter(Boolean).map((p) => window.__tb.pattyGrade(p)));
  const plateBtns = await page.$$('.tb-slot-plate');
  for (const b of plateBtns.slice(0, needPatties)) await b.click();
  const racked = await page.evaluate(() => window.__tb.S.pantry.patty.length);
  log(racked === needPatties, `${racked}/${needPatties} patties plated (grades: ${JSON.stringify(grades)})`);

  await page.evaluate(() => window.__tb.face(2));
  await new Promise((r) => setTimeout(r, 450));
  await page.click(`.tb-ticket[data-ticket="${ticket.id}"]`);
  const pinned = await page.evaluate((id) => window.__tb.S.activeTicketId === id, ticket.id);
  log(pinned, 'ticket pinned from the window rail');

  await page.evaluate(() => window.__tb.face(1));
  await new Promise((r) => setTimeout(r, 450));
  await page.screenshot({ path: path.join(OUT, 'tb-4-counter.png') });

  for (const key of ticket.layers) {
    if (key === 'bun_b' || key === 'bun_t') await page.click('.tb-bin[data-bin="bun"]');
    else if (key === 'patty') await page.click('.tb-bin[data-bin="patty"]');
    else await page.click(`.tb-bin[data-bin="${key}"]`);
  }
  const built = await page.evaluate(() => JSON.parse(JSON.stringify(window.__tb.S.build.layers)));
  const matches = JSON.stringify(built) === JSON.stringify(ticket.layers);
  log(matches, `stack built: ${built.join(' > ')} (exact match: ${matches})`);
  await page.screenshot({ path: path.join(OUT, 'tb-5-built.png') });

  await page.evaluate(() => window.__tb.face(2));
  await new Promise((r) => setTimeout(r, 450));
  const bellReady = await page.evaluate(() => !document.getElementById('tb-bell').disabled);
  log(bellReady, 'bell enabled once ticket pinned + build closed');
  await page.click('#tb-bell');
  await page.waitForSelector('#tb-order-overlay:not([hidden])');
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: path.join(OUT, 'tb-6-order-score.png') });
  const result = await page.evaluate(() => window.__tb.S.orders[0].r);
  log(result && result.total > 0 && result.sides === null, `served: total=${result.total} stack=${result.stack}% grill=${result.grill}% sides=${result.sides} tip=${result.tip}`);

  await page.click('#tb-order-next');
  const servedCount = await page.evaluate(() => window.__tb.S.served);
  log(servedCount === 1, 'served count incremented');

  // Force shift end, check payday flavor screen + rank-based save
  await page.evaluate(() => {
    const S = window.__tb.S;
    S.served = S.quota;
    S.score = 900; // push lifetime totalScore comfortably past the Fry Cook threshold (700)
    window.__tb.endShift();
  });
  await page.waitForSelector('#tb-shift-overlay:not([hidden])');
  await page.screenshot({ path: path.join(OUT, 'tb-7-shiftend.png') });
  const paydayShown = await page.evaluate(() => document.getElementById('tb-shift-overlay').textContent.includes('Paycheck'));
  log(paydayShown, 'payday flavor screen shown (real score/tips untouched)');
  const saved = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('troll-burger-save-v1')); } catch (e) { return null; }
  });
  log(!!saved && saved.totalScore >= 900, `shift recorded (save totalScore=${saved && saved.totalScore})`);

  await page.click('#tb-shift-next');
  await page.waitForFunction('window.__tb.S.screen === "shift" && window.__tb.S.shift === 2');
  await new Promise((r) => setTimeout(r, 500));  // let the camera pan back to the griddle facing
  const rank2 = await page.evaluate(() => window.__tb.S.rank.title);
  log(rank2 === 'Fry Cook', `promoted into shift 2 as ${rank2} (5 grill slots)`);

  // ---- shift 2: fry basket + drink mechanics (unlocked this shift) ----
  const friesVisible = await page.evaluate(() => !document.getElementById('tb-fries-tub').hidden);
  const ringsHidden = await page.evaluate(() => document.getElementById('tb-rings-tub').hidden);
  log(friesVisible && ringsHidden, 'fries tub unlocked at shift 2, rings still locked (unlocks shift 3)');

  await page.click('#tb-fries-tub');
  const dropped = await page.evaluate(() => window.__tb.S.baskets.some(Boolean));
  log(dropped, 'fry basket dropped');
  // Set cook right before pulling (real clicks/screenshots have IPC latency —
  // the basket keeps cooking in the background tick loop the whole time, so
  // aim inside the band rather than dead-center and don't add extra waits
  // between setting cook and pulling).
  await page.evaluate((target) => { const b = window.__tb.S.baskets.find(Boolean); if (b) b.cook = target; }, 60 /* BASKET_PERFECT: 50-82 */);
  await page.click('.tb-basket.has-item');
  await page.screenshot({ path: path.join(OUT, 'tb-8-basket.png') });
  const friesItem = await page.evaluate(() => window.__tb.S.pantry.fries[0] || null);
  log(!!friesItem && friesItem.grade !== 'BURNT', `fries pulled from the basket (grade: ${friesItem && friesItem.grade})`);

  // drink: real hold-to-fill via pointer down/up on the soda machine (unlocks
  // shift 4 — forced here to test the mechanic). The soda machine lives on
  // the counter facing, so turn there first or its real (but off-screen)
  // bounding box won't line up with the viewport. Hold time is generous but
  // well under the ~2s overflow budget at DRINK_RATE=60/s, so IPC jitter
  // can't push it into a spill.
  await page.evaluate(() => { document.getElementById('tb-soda-machine').hidden = false; window.__tb.face(1); });
  await new Promise((r) => setTimeout(r, 500));
  const soda = await page.$('#tb-soda-machine');
  const box = await soda.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 650));
  await page.mouse.up();
  const drinkItem = await page.evaluate(() => window.__tb.S.pantry.drink[0] || null);
  log(!!drinkItem, `drink filled and committed to the tray (grade: ${drinkItem && drinkItem.grade})`);

  if (consoleIssues.length) {
    console.log('\nConsole issues:');
    consoleIssues.forEach((c) => console.log('  ' + c));
  }
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) process.exitCode = 1;

  await browser.close();
  server.closeAllConnections?.();
  server.close();
  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  try { server.closeAllConnections?.(); server.close(); } catch { /* noop */ }
  process.exit(1);
});
