/* Troll High classes-as-minigames smoke test (design doc §21: "every
   class should be an enjoyable minigame"). Reuses the same Minigame
   overlay/class from Phase 7's recess games — Pop Quiz (Homeroom),
   Mental Math (Math), Word Scramble (English), Lab Mix (Science), and
   PACER Test (P.E.), each attached to an existing classroom object via
   per-instance play/playName fields. Verifies each launches with the
   right title, and that the actual scoring logic works (not just that
   the overlay opens) by forcing known state via the debug hook and
   checking a correct vs. wrong answer, matching the rigor of the
   original recess-minigame smoke test. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8983;
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
  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');
  await dismissOrientation(page);

  async function enterClassroom(doorX, zoneId) {
    await page.evaluate((x) => window.__th.warpTo(x, 5), doorX);
    await hold(page, 'ArrowUp', 700);
    await page.waitForFunction((id) => window.__th.zone.id === id, { timeout: 5000 }, zoneId);
    await new Promise(r => setTimeout(r, 400));
  }
  async function backToHallway(expectedZoneId = 'hallway-a') {
    const back = await page.evaluate(() => { const d = window.__th.zone.doors[0]; return { tx: d.x, ty: d.y }; });
    await page.evaluate(([tx, ty]) => window.__th.warpTo(tx, ty + 2), [back.tx, back.ty]);
    await hold(page, 'ArrowUp', 700);
    await page.waitForFunction((id) => window.__th.zone.id === id, { timeout: 5000 }, expectedZoneId);
  }

  // Chalkboard is at (6,1) in every core classroom; approach from below,
  // face up (matches the same convention as every other object test here).
  async function faceChalkboard() {
    // chalkboard is w4h2 at (6,1), footRows 1 -> solid row is row 2
    await page.evaluate(() => window.__th.warpTo(7, 3));
    await hold(page, 'ArrowUp', 120);
  }

  // --- Pop Quiz (Homeroom / classroom-3b) ---
  await enterClassroom(14, 'classroom-3b');
  await faceChalkboard();
  const hint1 = await page.$eval('#th-hint', el => el.textContent);
  log(/Pop Quiz/.test(hint1), `hint offers Pop Quiz in Homeroom: ${JSON.stringify(hint1)}`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === true', { timeout: 3000 });
  const title1 = await page.$eval('#th-minigame-title', el => el.textContent);
  log(title1 === 'Pop Quiz', `overlay titles as Pop Quiz (${JSON.stringify(title1)})`);
  await page.evaluate(() => { window.__th.minigame._state.qi = 0; }); // "What does P.E. stand for?" correct=0
  await page.keyboard.press('Digit1');
  await new Promise(r => setTimeout(r, 50));
  const scoreAfterRight = await page.evaluate(() => window.__th.minigameScore);
  log(scoreAfterRight === 10, `correct quiz answer scores (score=${scoreAfterRight})`);
  await page.evaluate(() => { window.__th.minigame._state.qi = 0; });
  await page.keyboard.press('Digit4'); // wrong on purpose
  await new Promise(r => setTimeout(r, 50));
  const scoreAfterWrong = await page.evaluate(() => window.__th.minigameScore);
  log(scoreAfterWrong === 10, `wrong quiz answer does not score (score=${scoreAfterWrong})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === false', { timeout: 3000 });
  await backToHallway();

  // --- Mental Math (Room 5A / classroom-3c) ---
  await enterClassroom(26, 'classroom-3c');
  await faceChalkboard();
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === true', { timeout: 3000 });
  const title2 = await page.$eval('#th-minigame-title', el => el.textContent);
  log(title2 === 'Mental Math', `overlay titles as Mental Math (${JSON.stringify(title2)})`);
  await page.evaluate(() => { window.__th.minigame._state.correctIdx = 0; window.__th.minigame._state.choices = [42, 1, 2, 3]; });
  await page.keyboard.press('Digit1');
  await new Promise(r => setTimeout(r, 50));
  const mathScore = await page.evaluate(() => window.__th.minigameScore);
  log(mathScore === 10, `correct math answer scores (score=${mathScore})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === false', { timeout: 3000 });
  await backToHallway();

  // --- Word Scramble (Room 7A / classroom-3d) ---
  await enterClassroom(38, 'classroom-3d');
  await faceChalkboard();
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === true', { timeout: 3000 });
  const title3 = await page.$eval('#th-minigame-title', el => el.textContent);
  log(title3 === 'Word Scramble', `overlay titles as Word Scramble (${JSON.stringify(title3)})`);
  // Force a known, trivially-solvable scramble: identity order for "BUS"
  await page.evaluate(() => {
    const s = window.__th.minigame._state;
    Object.assign(s, { wi: 7, letters: ['B', 'U', 'S'], order: [0, 1, 2], picked: [], word: 'BUS' });
  });
  await page.keyboard.press('Digit1');
  await page.keyboard.press('Digit2');
  await page.keyboard.press('Digit3');
  await new Promise(r => setTimeout(r, 50));
  const wordScore = await page.evaluate(() => window.__th.minigameScore);
  log(wordScore === 10, `spelling the word in order scores (score=${wordScore})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === false', { timeout: 3000 });
  await backToHallway();

  // --- Lab Mix (Science Lab, off hallway-b) ---
  await enterClassroom(94, 'hallway-b');
  await enterClassroom(62, 'science-lab');
  // Science lab has no chalkboard — the lab-table at (3,6), w3h2 footRows1,
  // is the trigger; solid row is row 7, approach from row 8.
  await page.evaluate(() => window.__th.warpTo(4, 8));
  await hold(page, 'ArrowUp', 120);
  const hint4 = await page.$eval('#th-hint', el => el.textContent);
  log(/Lab Mix/.test(hint4), `hint offers Lab Mix in the science lab: ${JSON.stringify(hint4)}`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === true', { timeout: 3000 });
  const title4 = await page.$eval('#th-minigame-title', el => el.textContent);
  log(title4 === 'Lab Mix', `overlay titles as Lab Mix (${JSON.stringify(title4)})`);
  await page.evaluate(() => { window.__th.minigame._state.target = { pair: [0, 1], name: 'Orange', color: '#e8862e' }; });
  await page.keyboard.press('Digit1');
  await page.keyboard.press('Digit2');
  await new Promise(r => setTimeout(r, 50));
  const mixScore = await page.evaluate(() => window.__th.minigameScore);
  log(mixScore === 10, `combining the correct reagent pair scores (score=${mixScore})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === false', { timeout: 3000 });
  await backToHallway('hallway-b'); // science-lab's door returns to hallway-b, not hallway-a

  // --- PACER Test (Gym, also off hallway-b — already there) ---
  await page.evaluate(() => window.__th.warpTo(15, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "gym"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  // Bleachers at (1,3), w6h3 -> rows 3-5 (objectAt uses the whole bounding
  // box, not just the solid footRows band) — approach from row 6, face up.
  await page.evaluate(() => window.__th.warpTo(2, 6));
  await hold(page, 'ArrowUp', 120);
  const hint5 = await page.$eval('#th-hint', el => el.textContent);
  log(/PACER/.test(hint5), `hint offers the PACER Test in the gym: ${JSON.stringify(hint5)}`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === true', { timeout: 3000 });
  const title5 = await page.$eval('#th-minigame-title', el => el.textContent);
  log(title5 === 'PACER Test', `overlay titles as PACER Test (${JSON.stringify(title5)})`);
  // Force the beep to be "now" and press SPACE right on it
  await page.evaluate(() => { window.__th.minigame._state.beepAt = window.__th.minigame.t; });
  await page.keyboard.press('Space');
  await new Promise(r => setTimeout(r, 50));
  const pacerScore = await page.evaluate(() => window.__th.minigameScore);
  log(pacerScore === 1, `pressing SPACE on the beep completes a lap (score=${pacerScore})`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('window.__th.minigameOpen === false', { timeout: 3000 });

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
