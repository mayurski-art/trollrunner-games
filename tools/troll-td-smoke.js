/* Troll TD smoke test: serves the repo statically and drives the game
   end-to-end in headless Chrome. Run from anywhere after `npm i puppeteer-core`
   (screenshots land next to this script). */
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

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const results = [];
const consoleIssues = [];
function log(ok, msg) { results.push((ok ? 'PASS' : 'FAIL') + ' | ' + msg); console.log(results[results.length - 1]); }

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1080,780', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1064, height: 740 });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleIssues.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => consoleIssues.push('pageerror: ' + e.message));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('coming-soon.js')) req.abort();
    else req.continue();
  });

  await page.goto(`http://localhost:${PORT}/troll-td.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__td && window.__td.G.state === "title"');
  await page.screenshot({ path: path.join(OUT, 'shot-1-title.png') });
  log(true, 'page loads, boots to title screen');

  // Title -> map select -> difficulty select -> begin run (Grin Beach / Easy)
  await page.click('#btn-start');
  await page.waitForSelector('#screen-map-select:not([hidden])');
  const mapBtns = await page.$$('#map-grid button[data-map]');
  log(mapBtns.length === 3, `map select shows 3 maps (${mapBtns.length})`);
  await mapBtns[0].click();
  await page.waitForSelector('#screen-diff-select:not([hidden])');
  const diffBtns = await page.$$('#diff-grid button[data-diff]');
  log(diffBtns.length === 3, `difficulty select shows 3 options (${diffBtns.length})`);
  await diffBtns[0].click();
  await page.waitForFunction('window.__td.G.state === "playing"');
  const hudVisible = await page.$eval('#td-hud', (el) => !el.hidden);
  log(hudVisible, 'run begins, HUD visible, state=playing');

  // Place a few towers via the debug API (mirrors manual build-menu placement)
  const placeRes = await page.evaluate(() => {
    const G = window.__td.G;
    const spots = G.map.buildSpots;
    const ok1 = window.__td.placeTower('thrower', spots[0]);
    const ok2 = window.__td.placeTower('sticky', spots[1]);
    const ok3 = window.__td.placeTower('ninja', spots[2]);
    return { ok1, ok2, ok3, towers: G.towers.length, cash: G.cash };
  });
  log(placeRes.ok1 && placeRes.ok2 && placeRes.ok3 && placeRes.towers === 3, `3 towers placed (cash now ${placeRes.cash})`);

  // Canvas click opens the build menu on an empty spot
  const clickCanvas = async (ix, iy) => {
    const box = await (await page.$('#td-canvas')).boundingBox();
    await page.mouse.click(box.x + ix * (box.width / 1000), box.y + iy * (box.height / 600));
  };
  const spot4 = await page.evaluate(() => { const s = window.__td.G.map.buildSpots[3]; return { x: s.x, y: s.y }; });
  await clickCanvas(spot4.x, spot4.y);
  await page.waitForSelector('#build-menu:not([hidden])');
  const menuBtns = await page.$$('#build-menu button[data-unit]');
  log(menuBtns.length === 12, `build menu lists all 12 units (${menuBtns.length})`);
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.click(10, 10); // canvas click elsewhere doesn't apply; close via clicking a spot again is fine
  await page.evaluate(() => { document.getElementById('build-menu').hidden = true; });

  // Tower panel: open, cycle targeting, upgrade a path
  const t0 = await page.evaluate(() => { const t = window.__td.G.towers[0]; return { x: t.x, y: t.y }; });
  await clickCanvas(t0.x, t0.y);
  await page.waitForSelector('#tower-panel:not([hidden])');
  const panelHtml = await page.$eval('#tower-panel', (el) => el.innerHTML);
  log(/target-row/.test(panelHtml), 'tower panel shows targeting controls');
  await page.evaluate(() => { window.__td.G.cash += 500; }); // ensure affordable for the upgrade probe below
  const upgraded = await page.evaluate(() => window.__td.upgradeTower(window.__td.G.towers[0], 0));
  log(upgraded === true, 'path-A upgrade purchased on Basic Troll Thrower');
  const lockedOtherPath = await page.evaluate(() => {
    const t = window.__td.G.towers[0];
    t.tiers[0] = 2; // simulate 2 tiers spent on path A
    return window.__td.upgradeTower(t, 1); // path B should now be locked
  });
  log(lockedOtherPath === false, 'PROBE: opposite path locks once a path passes tier 1');

  // Sell a tower and confirm refund + removal
  const sellRes = await page.evaluate(() => {
    const before = window.__td.G.towers.length;
    const t = window.__td.G.towers[1];
    const cashBefore = window.__td.G.cash;
    window.__td.sellTower(t);
    return { before, after: window.__td.G.towers.length, cashBefore, cashAfter: window.__td.G.cash };
  });
  log(sellRes.after === sellRes.before - 1 && sellRes.cashAfter > sellRes.cashBefore, `sell removes tower + refunds (cash ${sellRes.cashBefore}->${sellRes.cashAfter})`);

  // Run round 1 at 8x sim speed and confirm it clears
  await page.evaluate(() => { window.__td.startRound(); window.__td.G.speed = 8; });
  await page.waitForFunction('window.__td.G.enemies.length > 0', { timeout: 10000 });
  const roundLocked = await page.$eval('#btn-round', (b) => b.disabled);
  log(roundLocked, 'round started: enemies spawning, round button locked');
  await page.waitForFunction('window.__td.G.roundActive === false', { timeout: 60000, polling: 250 });
  const afterRound1 = await page.evaluate(() => ({ round: window.__td.G.round, cash: window.__td.G.cash, pops: window.__td.G.totalPops }));
  log(afterRound1.round === 1 && afterRound1.pops > 0, `round 1 cleared -> round index ${afterRound1.round}, pops ${afterRound1.pops}`);
  await page.screenshot({ path: path.join(OUT, 'shot-2-round1-clear.png') });

  // PROBE: pause freezes enemy movement mid-round
  await page.evaluate(() => { window.__td.startRound(); });
  await page.waitForFunction('window.__td.G.enemies.length > 0', { timeout: 10000 });
  await page.click('#btn-pause');
  const d1 = await page.evaluate(() => window.__td.G.enemies.map((e) => e.d).join(','));
  await new Promise((r) => setTimeout(r, 500));
  const d2 = await page.evaluate(() => window.__td.G.enemies.map((e) => e.d).join(','));
  log(d1 === d2 && d1.length > 0, 'PROBE: pause freezes enemy movement');
  await page.click('#btn-pause');
  await page.evaluate(() => { window.__td.G.speed = 8; });
  await page.waitForFunction('window.__td.G.roundActive === false', { timeout: 60000, polling: 250 });

  // Autopilot: fast-forward through remaining rounds toward the round-10 blimp
  // and the campaign boss, checking hero leveling + blimp/boss mechanics.
  let overOrWin = false;
  for (let i = 0; i < 10 && !overOrWin; i++) {
    const state = await page.evaluate(() => window.__td.G.state);
    if (state !== 'playing') { overOrWin = true; break; }
    await page.evaluate(() => { window.__td.startRound(); window.__td.G.speed = 8; });
    await page.waitForFunction("window.__td.G.roundActive === false || window.__td.G.state !== 'playing'", { timeout: 60000, polling: 250 });
  }
  const midState = await page.evaluate(() => ({ round: window.__td.G.round, state: window.__td.G.state, heroLevel: window.__td.G.hero ? window.__td.G.hero.level : 0 }));
  log(midState.round >= 5 || midState.state !== 'playing', `autopilot advanced rounds (round index ${midState.round}, state ${midState.state})`);
  log(midState.heroLevel >= 1, `hero leveling active (Lv.${midState.heroLevel})`);
  await page.screenshot({ path: path.join(OUT, 'shot-3-autopilot.png') });

  // PROBE: hero ability fires once level 3+ (force level for determinism)
  const abilityRes = await page.evaluate(() => {
    if (window.__td.G.state !== 'playing') return { skipped: true };
    window.__td.G.hero.level = 3;
    window.__td.G.hero.abilityCd = 0;
    const enemyHpBefore = window.__td.G.enemies.filter((e) => !e.dead).map((e) => e.hp);
    window.__td.heroAbility();
    const enemyHpAfter = window.__td.G.enemies.filter((e) => !e.dead).map((e) => e.hp);
    return { skipped: false, before: enemyHpBefore.length, after: enemyHpAfter.length, cd: window.__td.G.hero.abilityCd };
  });
  if (abilityRes.skipped) log(true, 'hero ability probe skipped (run already ended)');
  else log(abilityRes.cd === 20, `PROBE: Hero Slam sets a 20s cooldown (cd=${abilityRes.cd})`);

  // Force game over and confirm leaderboard/over-screen wiring
  await page.evaluate(() => {
    if (window.__td.G.state === 'playing') window.__td.gameOver();
  });
  await new Promise((r) => setTimeout(r, 300));
  const overScreenShown = await page.$eval('#screen-over', (el) => !el.hidden).catch(() => false);
  const winScreenShown = await page.$eval('#screen-win', (el) => !el.hidden).catch(() => false);
  log(overScreenShown || winScreenShown, `run concluded with a screen shown (over=${overScreenShown}, win=${winScreenShown})`);
  await page.screenshot({ path: path.join(OUT, 'shot-4-conclusion.png') });

  // Mobile layout
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, 'shot-5-mobile.png') });
  log(true, 'mobile viewport screenshot captured');

  console.log('\n--- console issues ---');
  console.log(consoleIssues.length ? consoleIssues.join('\n') : '(none)');
  console.log('\n--- summary ---');
  console.log(results.filter((r) => r.startsWith('FAIL')).length + ' failures / ' + results.length + ' checks');

  await browser.close();
  server.close();
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
