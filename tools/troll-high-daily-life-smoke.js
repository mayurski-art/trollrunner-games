/* Troll High daily-life habits smoke test (design doc §23 Phase 3 —
   "the game reflects your own routine back at you"). Verifies
   zoneVisitCounts drives a "usually found in" favorite-spot readout on
   the profile, and that the first locker/park-bench you interact with
   becomes personally "claimed" — a different memory title/text on every
   later visit to that exact object, while every OTHER locker/bench of
   the same type stays generic. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8998;
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

async function openMemoryAt(page, x, y, holdKey, holdMs) {
  await page.evaluate(([x, y]) => window.__th.warpTo(x, y), [x, y]);
  await hold(page, holdKey, holdMs);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  const title = await page.$eval('#th-memory h3', el => el.textContent);
  const text = await page.$eval('#th-memory p', el => el.textContent);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-memory")', { timeout: 3000 });
  return { title, text };
}

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

  // --- Claimed locker ----------------------------------------------------
  // The very first locker you ever interact with is claimed immediately.
  const first = await openMemoryAt(page, 7, 3, 'ArrowUp', 120);
  log(first.title.startsWith('Your locker'), `first-ever locker interaction claims it immediately ("Your locker") (${JSON.stringify(first)})`);

  const claimedSpots1 = await page.evaluate(() => window.__th.claimedSpots);
  log(claimedSpots1.lockers === 'hallway-a:lockers:6:0', `claimedSpots records the exact zone+object key (${JSON.stringify(claimedSpots1)})`);

  // A 3rd visit to the SAME locker still shows "Your locker" (persists).
  const claimedAgain = await openMemoryAt(page, 7, 3, 'ArrowUp', 120);
  log(claimedAgain.title === 'Your locker', `claimed locker stays personalized on repeat visits (${JSON.stringify(claimedAgain)})`);

  // A DIFFERENT locker (x=18..21) stays generic — it's not the claimed one.
  const otherLocker = await openMemoryAt(page, 19, 3, 'ArrowUp', 120);
  log(/lockers/i.test(otherLocker.title) && otherLocker.title !== 'Your locker', `a different locker stays generic, doesn't get claimed too (${JSON.stringify(otherLocker)})`);

  // --- Claimed park bench --------------------------------------------------
  await page.evaluate(() => window.__th.warpTo(94, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  await page.evaluate(() => window.__th.warpTo(110, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "bus-loop"', { timeout: 5000 });
  await page.evaluate(() => window.__th.warpTo(17, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "main-street"', { timeout: 5000 });
  await page.evaluate(() => window.__th.warpTo(50, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "park"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));

  const benchFirst = await openMemoryAt(page, 10, 9, 'ArrowUp', 60);
  log(benchFirst.title.startsWith('Your bench'), `first-ever park-bench interaction claims it immediately ("Your bench") (${JSON.stringify(benchFirst)})`);
  const benchClaimedAgain = await openMemoryAt(page, 10, 9, 'ArrowUp', 60);
  log(benchClaimedAgain.title === 'Your bench', `claimed bench stays personalized on repeat visits (${JSON.stringify(benchClaimedAgain)})`);

  // --- Favorite zone / profile readout -------------------------------------
  // Bounce out to Forest Trail and back twice so Park's visit count is
  // unambiguously ahead of Main Street/Bus Loop (each only entered once
  // passing through on the way here) rather than tied.
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => window.__th.warpTo(14, 5));
    await hold(page, 'ArrowUp', 700);
    await page.waitForFunction('window.__th.zone.id === "forest-trail"', { timeout: 5000 });
    await page.evaluate(() => window.__th.warpTo(2, 5));
    await hold(page, 'ArrowUp', 700);
    await page.waitForFunction('window.__th.zone.id === "park"', { timeout: 5000 });
  }
  const favorite = await page.evaluate(() => window.__th.favoriteZoneName());
  log(favorite === 'Park', `favoriteZoneName() reads back the most-visited non-hallway room (${JSON.stringify(favorite)})`);

  await page.click('#th-btn-profile');
  await page.waitForFunction('window.__th.profileOpen === true', { timeout: 3000 });
  const dailyLifeText = await page.$eval('#th-profile-daily-life', el => el.textContent);
  log(/Usually found in: Park/.test(dailyLifeText), `profile shows "Usually found in: Park" (${JSON.stringify(dailyLifeText)})`);
  log(/Has a locker/.test(dailyLifeText), `profile shows the claimed locker (${JSON.stringify(dailyLifeText)})`);
  log(/Has a bench/.test(dailyLifeText), `profile shows the claimed bench (${JSON.stringify(dailyLifeText)})`);
  await page.click('#th-profile-close');

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
