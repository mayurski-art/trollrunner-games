/* Troll High science fair smoke test (design doc §23 Phase 6, sixth and
   lightest Multiplayer Memories slice — "temporary player-submitted
   project displays"). No calendar gating, no vote — just a live list at
   the science lab's spare table. Two real browser contexts: Alice
   presents a project, Bob sees it in the live list via presence, and a
   photo taken while a project is set up gets tagged "Science Fair". */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8977;
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

  const a = await newVisitor(browser, 'FairAlice');
  const b = await newVisitor(browser, 'FairBob');

  await go(a.page, 94, 'hallway-b');
  await go(a.page, 62, 'science-lab');
  await go(b.page, 94, 'hallway-b');
  await go(b.page, 62, 'science-lab');

  // The plain (no-play-field) lab-table is at (13,6), w3h2 footRows1 ->
  // solid row 7, approach row 8.
  await a.page.evaluate(() => window.__th.warpTo(14, 8));
  await hold(a.page, 'ArrowUp', 60);
  const hintBefore = await a.page.$eval('#th-hint', el => el.textContent);
  log(/Science fair table/i.test(hintBefore), `hint offers the science fair table (${JSON.stringify(hintBefore)})`);

  await a.page.keyboard.press('KeyE');
  await a.page.waitForFunction('window.__th.scienceFairOpen === true', { timeout: 3000 });
  const emptyList = await a.page.evaluate(() => document.querySelector('.th-election-list').textContent);
  log(/No projects set up/i.test(emptyList), `no projects yet, before anyone's presented (${JSON.stringify(emptyList)})`);

  await a.page.click('#th-sciencefair-present-btn');
  const aProject = await a.page.evaluate(() => window.__th.myProject);
  log(typeof aProject === 'string' && aProject.length > 0, `Alice presents a project — a real title was assigned (${JSON.stringify(aProject)})`);
  const aNetProject = await a.page.evaluate(() => window.__th.net.project);
  log(aNetProject === aProject, `Alice's project is broadcast over presence (net.project matches: ${JSON.stringify(aNetProject)})`);
  await a.page.click('.th-mem-close');
  await a.page.waitForFunction('window.__th.scienceFairOpen === false', { timeout: 3000 });
  // Move Alice away from the table — otherwise Bob's approach lands
  // within trade range of her ghost, and nearPeer outranks the
  // facing-tile interaction (same gotcha as the club charter test).
  await a.page.evaluate(() => window.__th.warpTo(1, 1));

  // Bob sees Alice's project via presence
  await new Promise(r => setTimeout(r, 2000));
  const bobGhosts = await b.page.evaluate(() => [...window.__th.ghosts.values()].map(g => ({ name: g.name, project: g.project })));
  log(bobGhosts.some(g => g.project === aProject), `Bob's ghost view of Alice shows her project (${JSON.stringify(bobGhosts)})`);

  await b.page.evaluate(() => window.__th.warpTo(14, 8));
  await hold(b.page, 'ArrowUp', 60);
  await b.page.keyboard.press('KeyE');
  await b.page.waitForFunction('window.__th.scienceFairOpen === true', { timeout: 3000 });
  const bobListText = await b.page.evaluate(() => document.querySelector('.th-election-list').textContent);
  log(bobListText.includes('FairAlice') && bobListText.includes(aProject), `Bob's science fair list shows Alice's real project (${JSON.stringify(bobListText)})`);
  await b.page.click('.th-mem-close');
  await b.page.waitForFunction('window.__th.scienceFairOpen === false', { timeout: 3000 });

  // A photo taken while a project is set up gets tagged "Science Fair"
  // (or fails soft under the stub session, same as every other capture
  // test — real tagging is covered by the shared-yearbook pattern).
  await b.page.click('#th-btn-yearbook');
  await b.page.waitForFunction('window.__th.yearbookOpen === true', { timeout: 3000 });
  await b.page.click('#th-yearbook-capture');
  await b.page.waitForFunction(
    '!document.getElementById("th-yearbook-status").hidden || window.__th.photos.length > 0',
    { timeout: 8000 }
  );
  const bobLastPhoto = await b.page.evaluate(() => window.__th.photos[window.__th.photos.length - 1]);
  if (bobLastPhoto) {
    log(bobLastPhoto.eventTag === 'Science Fair', `Bob's photo (Alice's project nearby) is tagged "Science Fair" (${JSON.stringify(bobLastPhoto)})`);
  } else {
    const status = await b.page.$eval('#th-yearbook-status', el => el.textContent);
    log(status.length > 0, `capture failed gracefully under the stub session, as expected (${JSON.stringify(status)})`);
  }
  await b.page.click('#th-yearbook-close');
  // Move Bob away from the table too, for the same reason Alice moved
  // away earlier — otherwise Alice's return trip lands in trade range.
  // Position sync is real (throttled) network traffic, so give the new
  // position time to actually propagate before Alice approaches.
  await b.page.evaluate(() => window.__th.warpTo(1, 1));
  await new Promise(r => setTimeout(r, 1500));

  // Alice withdraws her project
  await a.page.evaluate(() => window.__th.warpTo(14, 8));
  await hold(a.page, 'ArrowUp', 60);
  await a.page.keyboard.press('KeyE');
  try {
    await a.page.waitForFunction('window.__th.scienceFairOpen === true', { timeout: 3000 });
  } catch (e) {
    const diag = await a.page.evaluate(() => ({
      zoneId: window.__th.zone.id, player: { x: window.__th.player.x, y: window.__th.player.y },
      hint: document.getElementById('th-hint')?.textContent,
      myProject: window.__th.myProject, issues: [],
    }));
    console.log('DIAG (Alice withdraw re-approach):', JSON.stringify(diag), 'consoleIssues:', a.issues);
    throw e;
  }
  await a.page.click('#th-sciencefair-withdraw-btn');
  const aProjectAfter = await a.page.evaluate(() => window.__th.myProject);
  log(aProjectAfter === null, 'withdrawing clears myProject back to null');
  const aNetProjectAfter = await a.page.evaluate(() => window.__th.net.project);
  log(aNetProjectAfter === null, "Alice's presence broadcast reflects withdrawing (net.project=null)");
  await a.page.click('.th-mem-close');

  log(a.issues.length === 0, 'Alice: no console errors' + (a.issues.length ? ':\n  ' + a.issues.join('\n  ') : ''));
  log(b.issues.length === 0, 'Bob: no console errors' + (b.issues.length ? ':\n  ' + b.issues.join('\n  ') : ''));

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
