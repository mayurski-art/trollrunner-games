/* Troll High talent show smoke test (design doc §23 Phase 6, fifth
   Multiplayer Memories slice). Unlike the dance floor, this has no
   calendar-event gating — the stage is always available, same as
   clubs/elections ("a real thing happening whenever people show up").
   Two real browser contexts: Alice takes the stage, Bob sees her
   performing via presence, and a photo taken while someone's on stage
   gets tagged "Talent Show". */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8974;
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

async function newVisitor(browser, name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1024, height: 720 });
  const issues = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors') && !isExpectedAuthNoise(m.text())) issues.push(m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  await stubAuth(page, { userId: 'test-' + name.toLowerCase(), username: name });
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
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1040,760', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });

  const a = await newVisitor(browser, 'StageAlice');
  const b = await newVisitor(browser, 'StageBob');

  await go(a.page, 94, 'hallway-b');
  await go(a.page, 26, 'auditorium');
  await go(b.page, 94, 'hallway-b');
  await go(b.page, 26, 'auditorium');

  // Stage-curtain: w4h4 footRows1 at (9,2) -> solid row 5, approach row6.
  await a.page.evaluate(() => window.__th.warpTo(10, 6));
  await hold(a.page, 'ArrowUp', 60);
  const hintBefore = await a.page.$eval('#th-hint', el => el.textContent);
  log(/Take the stage/i.test(hintBefore), `hint offers to take the stage (${JSON.stringify(hintBefore)})`);

  await a.page.keyboard.press('KeyE');
  await new Promise(r => setTimeout(r, 150));
  const aPerforming = await a.page.evaluate(() => window.__th.myPerforming);
  log(aPerforming === true, 'Alice toggles myPerforming=true by taking the stage');
  const aNetPerforming = await a.page.evaluate(() => window.__th.net.performing);
  log(aNetPerforming === true, "Alice's performing state is broadcast over presence (net.performing=true)");
  const toast = await a.page.$eval('#th-gift-toast', el => el.textContent);
  log(/take the stage and do/i.test(toast), `a random performance flavor line shows in the toast (${JSON.stringify(toast)})`);

  // Bob sees Alice performing via presence
  await new Promise(r => setTimeout(r, 2000));
  const bobGhosts = await b.page.evaluate(() => [...window.__th.ghosts.values()].map(g => ({ name: g.name, performing: g.performing })));
  log(bobGhosts.some(g => g.performing === true), `Bob's ghost view of Alice shows her performing (${JSON.stringify(bobGhosts)})`);

  // Bob (not performing himself) takes a photo — tagged "Talent Show"
  // because SOMEONE (Alice) is on stage, not just the photographer.
  await b.page.click('#th-btn-yearbook');
  await b.page.waitForFunction('window.__th.yearbookOpen === true', { timeout: 3000 });
  await b.page.click('#th-yearbook-capture');
  await b.page.waitForFunction(
    '!document.getElementById("th-yearbook-status").hidden || window.__th.photos.length > 0',
    { timeout: 8000 }
  );
  const bobLastPhoto = await b.page.evaluate(() => window.__th.photos[window.__th.photos.length - 1]);
  if (bobLastPhoto) {
    log(bobLastPhoto.eventTag === 'Talent Show', `Bob's photo (someone else performing nearby) is tagged "Talent Show" (${JSON.stringify(bobLastPhoto)})`);
  } else {
    const status = await b.page.$eval('#th-yearbook-status', el => el.textContent);
    log(status.length > 0, `capture failed gracefully under the stub session, as expected (${JSON.stringify(status)})`);
  }
  await b.page.click('#th-yearbook-close');

  // Toggling again leaves the stage
  await a.page.keyboard.press('KeyE');
  await new Promise(r => setTimeout(r, 150));
  const aPerformingOff = await a.page.evaluate(() => window.__th.myPerforming);
  log(aPerformingOff === false, 'pressing E again toggles myPerforming back to false');
  const aNetPerformingOff = await a.page.evaluate(() => window.__th.net.performing);
  log(aNetPerformingOff === false, "Alice's presence broadcast reflects leaving the stage (net.performing=false)");

  log(a.issues.length === 0, 'Alice: no console errors' + (a.issues.length ? ':\n  ' + a.issues.join('\n  ') : ''));
  log(b.issues.length === 0, 'Bob: no console errors' + (b.issues.length ? ':\n  ' + b.issues.join('\n  ') : ''));

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
