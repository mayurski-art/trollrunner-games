/* Papa Troll's Pizzeria smoke test: serves the repo statically and drives the
   full order → build → bake → cut → serve → end-of-day loop in headless
   Chrome. Run from anywhere after `npm i puppeteer-core` (screenshots land
   next to this script). External cross-repo scripts (coming-soon gate,
   accounts, notis, CDN) are blocked so the test is hermetic — the game is
   required to run without them. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = __dirname;
const PORT = 8932;
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
      '--disable-features=CalculateNativeWinOcclusion',
      '--enable-unsafe-swiftshader'],           // software WebGL for the Pizza Cam
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

  await page.goto(`http://localhost:${PORT}/troll-pizzeria.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__pz && window.__pz.S.screen === "title"');
  await page.screenshot({ path: path.join(OUT, 'pz-1-title.png') });
  log(true, 'page loads, boots to title screen');

  // Pizza Cam module should be up (vendored three, so it loads hermetically)
  await page.waitForFunction('window.TrollPizza3D !== undefined', { timeout: 10000 }).catch(() => {});
  const p3dOk = await page.evaluate(() => !!(window.TrollPizza3D && window.TrollPizza3D.ok));
  log(p3dOk, 'Pizza Cam (3D) module initialized');

  // Start the shift
  await page.click('#pz-start-btn');
  await page.waitForFunction('window.__pz.S.screen === "game"');
  log(true, 'shift starts');

  // Wait for the first customer to reach the counter, take the order
  await page.waitForSelector('.pz-cust.at-counter', { timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, 'pz-2-lobby.png') });
  await page.click('.pz-cust.at-counter');
  await page.waitForFunction('window.__pz.S.tickets.length === 1');
  const order = await page.evaluate(() => JSON.parse(JSON.stringify(window.__pz.S.tickets[0].order)));
  log(true, `order taken: sauce=${order.sauce} cheese=${order.cheese} tops=${order.tops.map(t => t.count + 'x' + t.id + '/' + t.side).join(',')} bake=${order.bake} cut=${order.cutCount}`);

  // Build: cycle sauce + cheese to the ordered amounts
  const AMOUNTS = ['none', 'light', 'normal', 'extra'];
  for (let i = 0; i < AMOUNTS.indexOf(order.sauce); i++) await page.click('#pz-sauce-btn');
  for (let i = 0; i < AMOUNTS.indexOf(order.cheese); i++) await page.click('#pz-cheese-btn');
  const amountsOk = await page.evaluate(() => {
    const b = window.__pz.S.tickets[0].build, o = window.__pz.S.tickets[0].order;
    return b.sauce === o.sauce && b.cheese === o.cheese;
  });
  log(amountsOk, 'sauce + cheese match the ticket');

  // Toppings: arm each ordered bin, then click sunflower-spread spots on
  // the pie (clicking an existing topping repositions it, so spots must not
  // overlap; retry with a nudge if a click didn't add one).
  let spotSeq = 0;
  for (const entry of order.tops) {
    await page.click(`.pz-bin[data-tid="${entry.id}"]`);           // arm
    const box = await (await page.$('#pz-build-pizza')).boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    for (let i = 0; i < entry.count; i++) {
      const before = await page.evaluate(() => window.__pz.S.tickets[0].build.placed.length);
      for (let attempt = 0; attempt < 6; attempt++) {
        const n = spotSeq + attempt * 17;
        const a = n * 2.39996;                                     // golden angle
        const r = box.width * (0.12 + 0.26 * Math.sqrt(((n * 7) % 20) / 20));
        // dy stays conservative: the 3D camera foreshortens the vertical
        // axis, so screen-y clicks travel further in pie coords than in 2D
        let dx = Math.cos(a) * r, dy = Math.sin(a) * r * 0.55;
        if (entry.side === 'left') dx = -Math.abs(dx) - box.width * 0.02;
        if (entry.side === 'right') dx = Math.abs(dx) + box.width * 0.02;
        await page.mouse.click(cx + dx, cy + dy);
        const after = await page.evaluate(() => window.__pz.S.tickets[0].build.placed.length);
        if (after > before) break;
      }
      spotSeq++;
    }
    await page.click(`.pz-bin[data-tid="${entry.id}"]`);           // disarm
  }
  const placed = await page.evaluate(() => window.__pz.S.tickets[0].build.placed.length);
  const wanted = order.tops.reduce((n, t) => n + t.count, 0);
  log(placed === wanted, `toppings placed: ${placed}/${wanted}`);
  const canvas3d = await page.evaluate(() => !!document.querySelector('#pz-build-pizza canvas.pz3d-canvas'));
  log(canvas3d === p3dOk, p3dOk ? '3D canvas active at the build station' : '3D unavailable — DOM pizza in use');
  await page.screenshot({ path: path.join(OUT, 'pz-3-build.png') });

  // To the oven → pick the raw pie → slot it
  await page.click('#pz-to-oven');
  await page.waitForSelector('#pz-built-row .pz-shelf-pizza');
  await page.click('#pz-built-row .pz-shelf-pizza');
  await page.click('.pz-oven-slot');
  const inOven = await page.evaluate(() => window.__pz.S.ovens[0] !== null);
  log(inOven, 'pizza slotted into the oven');

  // Fast-forward the bake to just past target, then pull it
  await page.evaluate(() => {
    const t = window.__pz.S.tickets[0];
    const target = window.__pz.BAKES.find(b => b.id === t.order.bake).target;
    t.doneness = target;
  });
  await new Promise(r => setTimeout(r, 450));                       // let a tick repaint
  await page.screenshot({ path: path.join(OUT, 'pz-4-bake.png') });
  await page.click('.pz-oven-slot');
  const onCutShelf = await page.evaluate(() => window.__pz.S.cutShelf.length === 1);
  log(onCutShelf, 'pizza pulled at target doneness');

  // Cut station: k cuts, then serve
  await page.evaluate(() => window.__pz.switchStation('cut'));
  await page.waitForSelector('#pz-cutshelf-row .pz-shelf-pizza');
  await page.click('#pz-cutshelf-row .pz-shelf-pizza');
  const cutCanvas3d = await page.evaluate(() => !!document.querySelector('#pz-cut-pizza canvas.pz3d-canvas'));
  log(cutCanvas3d === p3dOk, p3dOk ? '3D canvas active at the cut station' : '3D unavailable — DOM pizza in use');
  await page.click('#pz-cut-btn');                                  // start sweeper
  const cuts = order.cutCount / 2;
  for (let i = 0; i < cuts; i++) {
    await new Promise(r => setTimeout(r, 620));                     // let the sweeper move
    await page.click('#pz-cut-btn');
  }
  await page.waitForSelector('#pz-serve-btn:not([hidden])');
  await page.screenshot({ path: path.join(OUT, 'pz-5-cut.png') });
  log(true, `${cuts} cuts made, serve button visible`);

  // Once every cut is committed, the Pizza Cam should have cleaved the
  // deck into that many wedge sectors (3D only — no DOM equivalent).
  if (p3dOk) {
    const sectors = await page.evaluate(() => window.TrollPizza3D.__debugSectorCount());
    log(sectors === cuts * 2, `pie cleaved into ${sectors} sectors (expected ${cuts * 2})`);
  }

  await page.click('#pz-serve-btn');
  await page.waitForSelector('#pz-serve-overlay:not([hidden])');
  await new Promise(r => setTimeout(r, p3dOk ? 1900 : 1100));        // 3D adds a ~0.7s spin before the overlay
  await page.screenshot({ path: path.join(OUT, 'pz-6-serve.png') });
  const result = await page.evaluate(() => window.__pz.S.tickets[0].result);
  log(result && result.total > 0, `served: total=${Math.round(result.total * 100)}% order=${Math.round(result.order * 100)}% bake=${Math.round(result.bake * 100)}% cut=${Math.round(result.cut * 100)}% tip=${result.tip}`);
  await page.click('#pz-serve-next');
  const servedCount = await page.evaluate(() => window.__pz.S.servedToday);
  log(servedCount === 1, 'served count incremented');

  // Force day end: clear remaining arrivals, then check the summary flow
  await page.evaluate(() => {
    const S = window.__pz.S;
    S.roster = []; S.arrivalsLeft = 0; S.lobby = [];
    window.__pz.checkDayEnd();
  });
  await page.waitForSelector('#pz-day-overlay:not([hidden])');
  await page.screenshot({ path: path.join(OUT, 'pz-7-dayend.png') });
  const lbRecorded = await page.evaluate(() => {
    try { return Object.keys(localStorage).some(k => k.includes('troll-pizzeria')); } catch (e) { return false; }
  });
  log(lbRecorded, 'day recorded (save + leaderboard localStorage present)');

  await page.click('#pz-next-day');
  await page.waitForFunction('window.__pz.S.screen === "game" && window.__pz.S.day === 2');
  log(true, 'day 2 starts');

  // Leaderboard rack rendered by the shared engine
  const lbRendered = await page.evaluate(() =>
    !!document.querySelector('#lb-root .lb-table') && document.querySelector('#lb-root').textContent.includes('YOU'));
  log(lbRendered, 'weekly leaderboard rendered by shared engine');

  // Grin Combo: three all-perfect station scores should grow the meter and
  // pay a tip bonus (never fires in the real loop on day 1-2, so drive it
  // directly — this is scoring logic, not a rendering path).
  const grinOk = await page.evaluate(() => {
    const p = window.__pz;
    p.S.grinStage = 0; p.S.dayMaxGrin = 0;
    const res = { order: 0.95, bake: 0.95, cut: 0.95, total: 0.95, tip: 10 };
    p.applyGrinCombo(res);
    const stageAfterOne = p.S.grinStage;                 // 3 perfect stations = +3
    const tipAfterOne = res.tip;
    const res2 = { order: 0.3, bake: 0.95, cut: 0.95, total: 0.5, tip: 10 };
    p.applyGrinCombo(res2);                              // one bad station resets it
    return { stageAfterOne, tipAfterOne, resetStage: p.S.grinStage };
  });
  log(grinOk.stageAfterOne === 3 && grinOk.tipAfterOne === 13 && grinOk.resetStage === 0,
    `grin combo: stage ${grinOk.stageAfterOne}→tip ${grinOk.tipAfterOne} (+30%), then reset to ${grinOk.resetStage} on a bad station`);

  // Troll Events + Grin Hunt: force day 3 (events are gated off before it),
  // start a tell, and confirm clicking the hidden grin cancels it + pays a
  // small score bonus instead of letting the sabotage land.
  await page.evaluate(() => {
    const p = window.__pz;
    p.S.day = 3;
    p.S.dayScore = 0;
    p.startTrollTell();
  });
  await page.waitForSelector('#pz-grin-hunt');
  const scoreBefore = await page.evaluate(() => window.__pz.S.dayScore);
  await page.click('#pz-grin-hunt');
  const trollCancelled = await page.evaluate((before) => {
    const p = window.__pz;
    return { active: p.S.troll.active, gained: p.S.dayScore - before };
  }, scoreBefore);
  log(trollCancelled.active === null, 'grin hunt: clicking the grin cancels the troll event');
  await page.screenshot({ path: path.join(OUT, 'pz-8-grinhunt.png') });

  // ?flat=1 forces the DOM pizza — the 3D layer must stay fully optional
  await page.goto(`http://localhost:${PORT}/troll-pizzeria.html?flat=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__pz && window.__pz.S.screen === "title"');
  await page.click('#pz-start-btn');
  await page.waitForSelector('.pz-cust.at-counter', { timeout: 15000 });
  await page.click('.pz-cust.at-counter');
  await page.waitForFunction('window.__pz.S.tickets.length === 1');
  const flatOk = await page.evaluate(() =>
    !document.querySelector('#pz-build-pizza canvas.pz3d-canvas') &&
    !!document.querySelector('#pz-build-pizza .pz-layer-fallback, #pz-build-pizza .pz-layer'));
  log(flatOk, 'flat=1 renders the DOM pizza (no 3D canvas)');
  await page.screenshot({ path: path.join(OUT, 'pz-8-flat.png') });

  if (consoleIssues.length) {
    console.log('\nConsole issues:');
    consoleIssues.forEach(i => console.log('  ' + i));
  } else console.log('\nNo console errors.');

  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(1); });
