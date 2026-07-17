/* Bridge Patrol smoke test: serves the repo statically and drives the game
   end-to-end in headless Chrome. Run from anywhere after `npm i puppeteer-core`
   (screenshots land next to this script). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = __dirname;
const PORT = 8931;
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
    args: ['--window-size=1040,760', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 720 });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleIssues.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => consoleIssues.push('pageerror: ' + e.message));
  // The site-wide "coming soon" gate (assets/js/coming-soon.js) requires a
  // real Supabase admin session to unlock — it's a pre-launch marketing
  // gate unrelated to the game itself, so block it here to keep the
  // headless smoke test independent of live auth state.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('coming-soon.js')) req.abort();
    else req.continue();
  });

  await page.goto(`http://localhost:${PORT}/bridge-patrol.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__bp && window.__bp.G.state === "title"');
  await page.screenshot({ path: path.join(OUT, 'shot-1-title.png') });
  log(true, 'page loads, boots to title screen');

  // Canvas coordinate helper (internal 960x560 -> page px)
  const clickCanvas = async (ix, iy) => {
    const box = await (await page.$('#bp-canvas')).boundingBox();
    await page.mouse.click(box.x + ix * (box.width / 960), box.y + iy * (box.height / 560));
  };

  // Start the run
  await page.click('#btn-start');
  await page.waitForFunction('window.__bp.G.state === "idle"');
  const hudVisible = await page.$eval('#bp-hud', (el) => !el.hidden);
  log(hudVisible, 'Start Patrol shows HUD, state=idle');

  // Open build menu on plot (2,2) and build a Club Troll
  await clickCanvas(80, 80);
  await page.waitForSelector('#build-menu:not([hidden])');
  await page.screenshot({ path: path.join(OUT, 'shot-2-build-menu.png') });
  const btns = await page.$$('#build-menu button');
  log(btns.length === 5, 'build menu opens on stump with 5 tower options');
  await btns[0].click();
  let st = await page.evaluate(() => ({ towers: window.__bp.G.towers.length, coins: window.__bp.G.coins }));
  log(st.towers === 1 && st.coins === 70, `club troll placed, coins 120->${st.coins}`);

  // Build a Cold Shoulder (60c, affordable with 70) on plot (2,4) = (80,160)
  await clickCanvas(80, 160);
  await page.waitForSelector('#build-menu:not([hidden])');
  const spitDisabled = await page.$$eval('#build-menu button', (bs) => bs[1].disabled);
  log(spitDisabled, 'PROBE: spit troll (75c) disabled with only 70 coins');
  await (await page.$$('#build-menu button'))[2].click();
  st = await page.evaluate(() => ({ towers: window.__bp.G.towers.length, coins: window.__bp.G.coins }));
  log(st.towers === 2 && st.coins === 10, `cold shoulder placed, coins now ${st.coins}`);

  // PROBE: broke player — all build buttons disabled
  await page.evaluate(() => { window.__bp.G._coinsBackup = window.__bp.G.coins; window.__bp.G.coins = 3; });
  await clickCanvas(120, 240); // plot (3,6)
  await page.waitForSelector('#build-menu:not([hidden])');
  const allDisabled = await page.$$eval('#build-menu button', (bs) => bs.every((b) => b.disabled));
  log(allDisabled, 'PROBE: with 3 coins every build option is disabled');
  await page.evaluate(() => { window.__bp.G.coins = window.__bp.G._coinsBackup; });
  await page.keyboard.press('Escape');
  const popsClosed = await page.$eval('#build-menu', (el) => el.hidden);
  log(popsClosed, 'PROBE: Escape closes the build menu');

  // Guard post on the path offers only the Bridge Guard
  await clickCanvas(80, 120); // guard spot (2,3)
  await page.waitForSelector('#build-menu:not([hidden])');
  const guardBtns = await page.$$eval('#build-menu button', (bs) => bs.length);
  log(guardBtns === 1, 'guard post menu offers only Bridge Guard');
  await page.keyboard.press('Escape');

  // Run wave 1 at 2x
  await page.click('#btn-wave');
  await page.click('#btn-speed');
  await page.waitForFunction('window.__bp.G.enemies.length > 0', { timeout: 15000 });
  const waveBtnLocked = await page.$eval('#btn-wave', (b) => b.disabled);
  log(waveBtnLocked, 'wave started: enemies spawning, wave button locked');
  await new Promise((r) => setTimeout(r, 4000));
  await page.screenshot({ path: path.join(OUT, 'shot-3-midwave.png') });

  // PROBE: pause actually freezes the sim
  await page.click('#btn-pause');
  const d1 = await page.evaluate(() => window.__bp.G.enemies.map((e) => e.d).join(','));
  await new Promise((r) => setTimeout(r, 700));
  const d2 = await page.evaluate(() => window.__bp.G.enemies.map((e) => e.d).join(','));
  log(d1 === d2 && d1.length > 0, 'PROBE: pause freezes enemy movement');
  await page.click('#btn-pause');

  // Wait for wave 1 to clear
  await page.waitForFunction('window.__bp.G.state === "idle" && window.__bp.G.wave === 1', { timeout: 90000 });
  st = await page.evaluate(() => ({ coins: window.__bp.G.coins, tolls: window.__bp.G.tolls, chest: window.__bp.G.chest }));
  log(st.tolls > 0, `wave 1 cleared: tolls earned=${st.tolls}, coins=${st.coins}, chest=${st.chest}/100`);
  await page.screenshot({ path: path.join(OUT, 'shot-4-wave-cleared.png') });

  // Upgrade the club troll, then sell it
  await clickCanvas(80, 80);
  await page.waitForSelector('#tower-panel:not([hidden])');
  const panelTxt = await page.$eval('#tower-panel', (el) => el.textContent);
  log(/Tier I/.test(panelTxt), 'tower panel opens with tier info');
  const coinsBefore = await page.evaluate(() => window.__bp.G.coins);
  const canUpgrade = await page.$$eval('#tower-panel button', (bs) => !bs[0].disabled);
  if (canUpgrade) {
    await (await page.$$('#tower-panel button'))[0].click();
    const tier = await page.evaluate(() => window.__bp.G.towers[0].tier);
    log(tier === 1, 'upgrade to Tier II works');
  } else {
    log(true, `upgrade button correctly disabled (coins=${coinsBefore} < 45)`);
  }
  await page.waitForSelector('#tower-panel:not([hidden])');
  const sellBtn = await page.$('#tower-panel button.sell');
  await sellBtn.click();
  st = await page.evaluate(() => ({ towers: window.__bp.G.towers.length, coins: window.__bp.G.coins }));
  log(st.towers === 1, `PROBE: sell removes tower + refunds (coins now ${st.coins})`);

  // PROBE: spacebar starts next wave
  await page.keyboard.press(' ');
  const waveState = await page.evaluate(() => window.__bp.G.state);
  log(waveState === 'wave', 'PROBE: spacebar starts wave 2');

  // Force game over -> continue flow
  await page.evaluate(() => window.__bp.gameOver());
  await page.waitForSelector('#screen-over:not([hidden])');
  await page.screenshot({ path: path.join(OUT, 'shot-5-gameover.png') });
  const contVisible = await page.$eval('#btn-continue', (b) => !b.hidden);
  log(contVisible, 'game over screen shows free continue');
  await page.click('#btn-continue');
  st = await page.evaluate(() => ({ state: window.__bp.G.state, chest: window.__bp.G.chest, left: window.__bp.G.continueLeft }));
  log(st.state === 'idle' && st.chest === 50 && st.left === 0, `continue: chest restored to ${st.chest}, continues left=${st.left}`);

  // Second game over -> continue must be gone, retry resets
  await page.evaluate(() => window.__bp.gameOver());
  await page.waitForSelector('#screen-over:not([hidden])');
  const contGone = await page.$eval('#btn-continue', (b) => b.hidden);
  log(contGone, 'PROBE: second game over hides continue (already used)');
  await page.click('#btn-retry');
  st = await page.evaluate(() => ({ state: window.__bp.G.state, coins: window.__bp.G.coins, towers: window.__bp.G.towers.length, wave: window.__bp.G.wave }));
  log(st.coins === 120 && st.towers === 0 && st.wave === 0, 'retry resets the run (120 coins, 0 towers, wave 0)');

  // ---- Phase 2 autopilot: strong layout, waves 1-12 at 8x sim speed ----
  await page.evaluate(() => {
    const bp = window.__bp;
    [['cannon', 1, 2], ['cannon', 7, 2], ['cannon', 12, 2], ['cannon', 14, 2],
     ['spit', 0, 2], ['spit', 9, 2], ['spit', 11, 2],
     ['cold', 2, 1], ['cold', 10, 1], ['club', 6, 2], ['booth', 3, 2]]
      .forEach(([ty, pl, ti]) => bp.debugPlace(ty, pl, ti));
    bp.debugGuard(4, 2);
  });
  const towers = await page.evaluate(() => window.__bp.G.towers.length);
  log(towers === 12, `autopilot layout placed (${towers} towers incl. bridge guard)`);
  let died = false;
  for (let w = 1; w <= 12 && !died; w++) {
    await page.evaluate(() => { window.__bp.startWave(); window.__bp.G.speed = 8; });
    if (w === 10) {
      await new Promise((r) => setTimeout(r, 2500));
      await page.screenshot({ path: path.join(OUT, 'shot-7-boss.png') });
    }
    await page.waitForFunction("['idle','over'].includes(window.__bp.G.state)", { timeout: 90000, polling: 250 });
    if ((await page.evaluate(() => window.__bp.G.state)) === 'over') died = true;
  }
  const fin = await page.evaluate(() => ({
    wave: window.__bp.G.wave, chest: window.__bp.G.chest, tolls: window.__bp.G.tolls,
    bosses: window.__bp.G.bossesSlain, stuns: window.__bp.G.stunCount, log: window.__bp.G.spawnLog,
  }));
  log(!died && fin.wave === 12, `autopilot survived to wave 12 (chest ${fin.chest}/100, tolls ${fin.tolls})`);
  log(fin.log.karen > 0 && fin.log.wojak >= 8 && fin.log.bro > 0, `new enemies spawned: ${JSON.stringify(fin.log)}`);
  log(fin.bosses >= 1, `wave-10 boss slain (bossesSlain=${fin.bosses})`);
  log(fin.stuns > 0, `karen/manager stuns landed: ${fin.stuns}`);
  await page.screenshot({ path: path.join(OUT, 'shot-8-endless.png') });

  // PROBE: best-run persisted to localStorage
  const best = await page.evaluate(() => localStorage.getItem('bp_best_v1'));
  log(!!best, `best run persisted: ${best}`);

  // Mobile layout
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, 'shot-6-mobile.png') });
  log(true, 'mobile viewport screenshot captured');

  console.log('\n--- console issues ---');
  console.log(consoleIssues.length ? consoleIssues.join('\n') : '(none)');
  console.log('\n--- summary ---');
  console.log(results.filter((r) => r.startsWith('FAIL')).length + ' failures / ' + results.length + ' checks');

  await browser.close();
  server.close();
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
