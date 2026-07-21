/* Troll High student elections smoke test (design doc §23 Phase 6,
   second "Multiplayer Memories" slice). Like the club system, no new
   Supabase table: candidacy broadcasts over the existing presence
   channel (net.js) and votes are a lightweight broadcast message each
   connected client tallies for itself — a real, live, session-scoped
   poll rather than a persisted ballot. Two real isolated browser
   contexts: Alice runs for Student Council, Bob sees her as a
   candidate and votes for her, Alice's own tally updates from the
   broadcast vote. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8972;
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

async function reachAuditorium(page) {
  await go(page, 94, 'hallway-b');
  await go(page, 26, 'auditorium');
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1040,760', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });

  const a = await newVisitor(browser, 'VoteAlice');
  const b = await newVisitor(browser, 'VoteBob');

  await reachAuditorium(a.page);
  await reachAuditorium(b.page);
  await new Promise(r => setTimeout(r, 2500));

  // --- Alice opens the ballot box and runs for office --------------------
  await a.page.evaluate(() => window.__th.warpTo(12, 15));
  await hold(a.page, 'ArrowUp', 120);
  await a.page.keyboard.press('KeyE');
  await a.page.waitForFunction('window.__th.electionOpen === true', { timeout: 3000 });
  const noCandidatesYet = await a.page.evaluate(() => document.querySelector('.th-election-list').textContent);
  log(/No declared candidates/.test(noCandidatesYet), `no candidates yet, before anyone's run (${JSON.stringify(noCandidatesYet)})`);

  await a.page.click('#th-election-run-btn');
  const aRunning = await a.page.evaluate(() => window.__th.myRunning);
  log(aRunning === true, 'clicking "Run for Student Council" sets myRunning=true');
  const aNetRunning = await a.page.evaluate(() => window.__th.net.running);
  log(aNetRunning === true, 'Alice\'s candidacy is broadcast over presence (net.running=true)');
  await a.page.click('.th-mem-close');
  await a.page.waitForFunction('window.__th.electionOpen === false', { timeout: 3000 });

  // Move away from the ballot box so Bob isn't blocked by trade-range
  // priority when he approaches (same gotcha as the club charter test).
  await a.page.evaluate(() => window.__th.warpTo(1, 2));

  // --- Bob sees Alice as a candidate and votes for her --------------------
  await new Promise(r => setTimeout(r, 2000));
  const bobGhosts = await b.page.evaluate(() => [...window.__th.ghosts.values()].map(g => ({ name: g.name, running: g.running })));
  log(bobGhosts.some(g => g.running === true), `Bob's ghost view of Alice shows her as a running candidate (${JSON.stringify(bobGhosts)})`);

  await b.page.evaluate(() => window.__th.warpTo(12, 15));
  await hold(b.page, 'ArrowUp', 120);
  await b.page.keyboard.press('KeyE');
  await b.page.waitForFunction('window.__th.electionOpen === true', { timeout: 3000 });
  const bAliceId = await b.page.evaluate(() => {
    const g = [...window.__th.ghosts.values()].find(g => g.running);
    return g && g.id;
  });
  log(!!bAliceId, `Bob can resolve Alice's ghost id to vote for (${JSON.stringify(bAliceId)})`);

  const voteBtnText = await b.page.evaluate(() => {
    const btn = document.querySelector('.th-election-vote-btn');
    return btn ? btn.closest('.th-election-row').textContent : null;
  });
  log(voteBtnText && /VoteAlice/.test(voteBtnText), `Bob's ballot lists Alice as a candidate (${JSON.stringify(voteBtnText)})`);

  await b.page.evaluate((id) => window.__th.castVote(id), bAliceId);
  const bTallyAfterOwnVote = await b.page.evaluate((id) => window.__th.voteTally(id), bAliceId);
  log(bTallyAfterOwnVote === 1, `Bob's own vote is tallied locally immediately (${bTallyAfterOwnVote})`);

  const voteBtnDisabled = await b.page.evaluate(() => document.querySelector('.th-election-vote-btn').disabled);
  log(voteBtnDisabled === true, 'the vote button for who Bob already voted for is now disabled ("Voted")');

  // --- Alice's own client receives Bob's broadcast vote -------------------
  await new Promise(r => setTimeout(r, 2000));
  const aOwnId = await a.page.evaluate(() => window.__th.net.id);
  const aTallyForSelf = await a.page.evaluate((id) => window.__th.voteTally(id), aOwnId);
  log(aTallyForSelf === 1, `Alice's own client received Bob's vote via broadcast and tallied it (votes for her = ${aTallyForSelf})`);

  log(a.issues.length === 0, 'Alice: no console errors' + (a.issues.length ? ':\n  ' + a.issues.join('\n  ') : ''));
  log(b.issues.length === 0, 'Bob: no console errors' + (b.issues.length ? ':\n  ' + b.issues.join('\n  ') : ''));

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
