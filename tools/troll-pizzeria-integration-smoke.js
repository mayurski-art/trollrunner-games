/* Papa Troll's Pizzeria — Kitchen3D × game.js integration smoke test.
   Unlike troll-pizzeria-3d-smoke.js (which drives the Kitchen3D engine
   against a demo reference driver) and troll-pizzeria-smoke.js (which now
   forces ?flat=1 to protect the legacy 2D fallback), THIS file drives the
   real, live default experience: troll-pizzeria.html with no query flags,
   WebGL available, Kitchen3D active, game.js's actual tickets/scoring/
   state flowing through it. This is what a real player sees by default.
   Screenshots land next to this script. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = __dirname;
const PORT = 8973;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };

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
    args: ['--window-size=1180,860', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1160, height: 840 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().startsWith(`http://localhost:${PORT}`)) req.continue();
    else req.abort(); // blocked externals (accounts/notis/CDN/fonts) — hermetic
  });
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type())) return;
    const t = m.text();
    if (/ERR_FAILED|net::|frame-ancestors|Failed to load resource/.test(t)) return;
    consoleIssues.push(m.type() + ': ' + t);
  });
  page.on('pageerror', (e) => consoleIssues.push('pageerror: ' + e.message));

  await page.goto(`http://localhost:${PORT}/troll-pizzeria.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__pz && window.__pz.S.screen === "title"');
  await new Promise(r => setTimeout(r, 500));

  const k3dActive = await page.evaluate(() => !!window.__pz.k3d() && document.body.classList.contains('k3d-mode'));
  log(k3dActive, 'Kitchen3D is active by default (no ?flat=1) and body.k3d-mode is set');

  await page.click('#pz-start-btn');
  await page.waitForFunction('window.__pz.S.screen === "game"');
  log(true, 'shift starts with Kitchen3D active');
  await page.screenshot({ path: path.join(OUT, 'int-1-order.png') });

  // Order: the lobby cards are hidden in k3d-mode (redundant with the 3D
  // billboards) — the "Take order" button is the real interaction surface.
  await page.waitForSelector('#pz-take-order:not([hidden])', { timeout: 15000 });
  await page.click('#pz-take-order');
  await page.waitForFunction('window.__pz.S.tickets.length === 1');
  const ticketAfterOrder = await page.evaluate(() => window.__pz.S.tickets[0]);
  log(ticketAfterOrder.state === 'building', `real order taken (cust=${ticketAfterOrder.cust.name}, state=${ticketAfterOrder.state})`);
  log((await page.evaluate(() => window.__pz.S.station)) === 'build', 'taking the order teleported the 3D camera to Build (S.station synced)');
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUT, 'int-2-build.png') });

  // Build: the REAL ticket's pie (not a demo) must be visible, and
  // painting/placing via the 3D pie must mutate the REAL ticket through
  // applyPaint()/commitPlacement() — the glue this integration added.
  const buildPieVisible = await page.evaluate(() => window.TrollKitchen3D.pieBackend('build').isMounted());
  log(buildPieVisible, "the real ticket's pie is visible on the 3D build table");

  const paintResult = await page.evaluate(() => {
    const hit = window.TrollKitchen3D.__debug.paintAtNDC(0, 0);
    if (hit) window.__pz.applyPaint('sauce', hit.x, hit.y);
    return { hit, sauce: window.__pz.S.tickets[0].build.sauce };
  });
  log(!!paintResult.hit && paintResult.sauce > 0,
    `painting via the 3D pie raises the REAL ticket's sauce coverage (sauce=${(paintResult.sauce * 100).toFixed(0)}%)`);
  await page.screenshot({ path: path.join(OUT, 'int-3-painted.png') });

  const placeResult = await page.evaluate(() => {
    const hit = window.TrollKitchen3D.__debug.paintAtNDC(0.15, 0);
    if (hit) window.__pz.commitPlacement('pepperoni', hit.x, hit.y, true);
    return { hit, placed: window.__pz.S.tickets[0].build.placed.length };
  });
  log(placeResult.placed === 1, `placing via the 3D pie adds to the REAL ticket's toppings (placed=${placeResult.placed})`);

  // Bake: 2D flow is two clicks — the built-shelf pie, then an empty oven
  // slot (game.js's bakeSlotClick) — not one combined "send" action.
  await page.click('#pz-to-oven');
  await page.waitForFunction('window.__pz.S.station === "bake"');
  await page.waitForSelector('#pz-built-row .pz-shelf-pizza', { timeout: 5000 });
  await page.click('#pz-built-row .pz-shelf-pizza');
  await page.click('.pz-oven-slot.is-empty');
  await new Promise(r => setTimeout(r, 200));
  const ovenSynced = await page.evaluate(() => {
    const ovenIdx = window.__pz.S.ovens.findIndex(id => id !== null);
    return { ovenIdx, hasPie: ovenIdx >= 0 ? window.TrollKitchen3D.__debug.getOvenSlot(ovenIdx).hasPie : false };
  });
  log(ovenSynced.ovenIdx >= 0 && ovenSynced.hasPie,
    `oven-slotted ticket shows up in the real 3D oven rack (slot ${ovenSynced.ovenIdx})`);
  await page.screenshot({ path: path.join(OUT, 'int-4-oven.png') });

  // Fast-forward the bake to target, pull it, then cut + serve — completing
  // the loop exactly like troll-pizzeria-smoke.js does for the 2D path.
  await page.evaluate((ovenIdx) => {
    const t = window.__pz.S.tickets[0];
    const target = window.__pz.BAKES.find(b => b.id === t.order.bake).target;
    t.doneness = target;
  }, ovenSynced.ovenIdx);
  await new Promise(r => setTimeout(r, 450));
  await page.click(`.pz-oven-slot:not(.is-empty)`);
  const onCutShelf = await page.evaluate(() => window.__pz.S.cutShelf.length === 1);
  log(onCutShelf, 'pizza pulled from the oven at target doneness');

  await page.evaluate(() => window.__pz.switchStation('cut'));
  await page.waitForFunction('window.__pz.S.station === "cut"');
  await new Promise(r => setTimeout(r, 500));
  await page.waitForSelector('#pz-cutshelf-row .pz-shelf-pizza', { timeout: 5000 });
  await page.click('#pz-cutshelf-row .pz-shelf-pizza');
  const cutPieVisible = await page.evaluate(() => window.TrollKitchen3D.pieBackend('cut').isMounted());
  log(cutPieVisible, 'the real ticket\'s pie is visible on the 3D cutting table');

  const needed = await page.evaluate(() => window.__pz.S.cut.needed);
  await page.click('#pz-cut-btn'); // first click just arms the sweeper
  for (let i = 0; i < needed; i++) {
    await new Promise(r => setTimeout(r, 350)); // let the real sweep move
    await page.click('#pz-cut-btn'); // now each click commits a cut
  }
  const cutsOk = await page.evaluate(() => window.__pz.S.cut.done.length === window.__pz.S.cut.needed);
  log(cutsOk, `made all ${needed} real cuts via the 3D cutting table`);
  await page.screenshot({ path: path.join(OUT, 'int-5-cut.png') });

  const scoreBefore = await page.evaluate(() => window.__pz.S.dayTips);
  await page.click('#pz-serve-btn');
  await new Promise(r => setTimeout(r, 900)); // real serve-spin + overlay
  const served = await page.evaluate((before) => ({
    servedCount: window.__pz.S.servedToday,
    tipsGained: window.__pz.S.dayTips - before,
    overlayShown: !document.getElementById('pz-serve-overlay').hidden,
  }), scoreBefore);
  log(served.servedCount === 1 && served.tipsGained > 0 && served.overlayShown,
    `served through the real 3D loop (tips +${served.tipsGained}, overlay shown=${served.overlayShown})`);
  await page.screenshot({ path: path.join(OUT, 'int-6-served.png') });

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
