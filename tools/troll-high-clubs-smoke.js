/* Troll High real multi-club system smoke test (design doc §23 Phase 6,
   "Multiplayer Memories" — first slice). No new Supabase table: "which
   clubs exist" is just whichever names other live players are currently
   broadcasting over the existing zone presence channel. Verifies:
   - reading the club charter shows a real founding/joining form, not an
     auto-join
   - founding a club sets club={name, founded:true}, persists, and
     broadcasts the name over presence (net.setClub)
   - a second real player reaching the charter sees a "Join <name>"
     button sourced from the first player's live ghost, and joining sets
     club={name, founded:false} with the SAME name
   - the profile card and Priya's reactive dialogue line both reflect it */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8971;
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

/* Full secrets chain (same route as troll-high-meta-smoke.js) down to the
   Underground HQ, ending right in front of the club charter. */
async function reachClubCharter(page) {
  await go(page, 94, 'hallway-b');
  await go(page, 110, 'bus-loop');
  await go(page, 18, 'main-street');
  await go(page, 50, 'park');
  await go(page, 14, 'forest-trail');
  await go(page, 48, 'storm-drains');
  await page.evaluate(() => window.__th.warpTo(6, 5));
  await hold(page, 'ArrowDown', 700);
  await page.waitForFunction('window.__th.zone.id === "caves"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 200));
  await page.evaluate(() => window.__th.warpTo(9, 7));
  await hold(page, 'ArrowDown', 700);
  await page.waitForFunction('window.__th.zone.id === "underground-hq"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
}

async function openCharter(page) {
  await page.evaluate(() => window.__th.warpTo(3, 4));
  await hold(page, 'ArrowUp', 120);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1040,760', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });

  const a = await newVisitor(browser, 'ClubAlice');
  const b = await newVisitor(browser, 'ClubBob');

  await reachClubCharter(a.page);
  await reachClubCharter(b.page);

  // Give the presence channel a moment to actually sync between the two
  // real contexts before relying on either seeing the other.
  await new Promise(r => setTimeout(r, 2500));

  // --- Alice founds a club --------------------------------------------
  await openCharter(a.page);
  const formVisible = await a.page.evaluate(() => !!document.getElementById('th-club-name-input'));
  log(formVisible, 'reading the charter (not yet a member) shows the real founding/joining form, not an auto-join');

  await a.page.type('#th-club-name-input', 'Chess Club');
  await a.page.click('#th-club-found-btn');
  await a.page.waitForFunction('!document.getElementById("th-memory")', { timeout: 3000 });
  const aClub = await a.page.evaluate(() => window.__th.club);
  log(aClub && aClub.name === 'Chess Club' && aClub.founded === true, `Alice's club record shows she founded "Chess Club" (${JSON.stringify(aClub)})`);
  const aNetClub = await a.page.evaluate(() => window.__th.netClub);
  log(aNetClub === 'Chess Club', `Alice's club is broadcast over presence (net.club=${JSON.stringify(aNetClub)})`);

  // Move Alice away from the charter tile — otherwise Bob's approach to
  // read it lands within trade range of her ghost, and nearPeer outranks
  // the facing-tile memory interaction (same priority chain as Trade).
  await a.page.evaluate(() => window.__th.warpTo(1, 1));

  // --- Bob sees Alice's club and joins it -----------------------------
  // Let position/presence broadcasts actually propagate before Bob looks.
  await new Promise(r => setTimeout(r, 2000));
  const bobGhosts = await b.page.evaluate(() => [...window.__th.ghosts.values()].map(g => ({ name: g.name, club: g.club })));
  log(bobGhosts.some(g => g.club === 'Chess Club'), `Bob's ghost view of Alice shows her club via presence (${JSON.stringify(bobGhosts)})`);

  try {
    await openCharter(b.page);
  } catch (e) {
    const diag = await b.page.evaluate(() => ({
      zoneId: window.__th.zone.id, player: { x: window.__th.player.x, y: window.__th.player.y },
      hint: document.getElementById('th-hint')?.textContent,
    }));
    console.log('DIAG (Bob openCharter):', JSON.stringify(diag));
    throw e;
  }
  const joinBtnText = await b.page.evaluate(() => {
    const btn = document.querySelector('.th-club-join-btn');
    return btn ? btn.textContent : null;
  });
  log(joinBtnText && /Chess Club/.test(joinBtnText), `Bob's charter form offers to join "Chess Club" (${JSON.stringify(joinBtnText)})`);
  await b.page.click('.th-club-join-btn');
  await b.page.waitForFunction('!document.getElementById("th-memory")', { timeout: 3000 });
  const bClub = await b.page.evaluate(() => window.__th.club);
  log(bClub && bClub.name === 'Chess Club' && bClub.founded === false, `Bob's club record shows he JOINED (not founded) "Chess Club" (${JSON.stringify(bClub)})`);

  // --- Profile + Priya reaction ----------------------------------------
  await a.page.click('#th-btn-profile');
  await a.page.waitForFunction('window.__th.profileOpen === true', { timeout: 3000 });
  const aProfileText = await a.page.$eval('#th-profile-daily-life', el => el.textContent);
  log(/Club: Chess Club \(founder\)/.test(aProfileText), `Alice's profile shows "Club: Chess Club (founder)" (${JSON.stringify(aProfileText)})`);
  await a.page.click('#th-profile-close');

  await b.page.click('#th-btn-profile');
  await b.page.waitForFunction('window.__th.profileOpen === true', { timeout: 3000 });
  const bProfileText = await b.page.$eval('#th-profile-daily-life', el => el.textContent);
  log(/Club: Chess Club$/.test(bProfileText.trim()) || /Club: Chess Club ·/.test(bProfileText), `Bob's profile shows "Club: Chess Club" without "(founder)" (${JSON.stringify(bProfileText)})`);
  await b.page.click('#th-profile-close');

  // Priya (art-room) reacts to the player's real club name once they have
  // one — Bob is deep in the Underground HQ, so retrace the whole secrets
  // chain back out (each zone's own door, reverse order) before heading
  // to the art room.
  await b.page.evaluate(() => window.__th.warpTo(9, 5));
  await hold(b.page, 'ArrowUp', 700);
  await b.page.waitForFunction('window.__th.zone.id === "caves"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 200));
  await go(b.page, 9, 'storm-drains');
  await go(b.page, 6, 'forest-trail');
  await go(b.page, 2, 'park');
  await go(b.page, 11, 'main-street');
  await go(b.page, 2, 'bus-loop');
  await go(b.page, 9, 'hallway-b');
  await go(b.page, 38, 'art-room');
  const priya = await b.page.evaluate(() => { const n = window.__th.npcs.find(n => n.def.id === 'priya'); return { x: n.x, y: n.y }; });
  await b.page.evaluate(([x, y]) => window.__th.warpTo(Math.floor(x / 16) + 1, Math.round(y / 16)), [priya.x, priya.y]);
  await new Promise(r => setTimeout(r, 200));
  // Priya has no secondLine, so it's the 2nd interaction (t=1 going in)
  // that first falls through to the memoryLine.
  await b.page.keyboard.press('KeyE');
  await b.page.waitForSelector('#th-dialogue', { timeout: 3000 });
  await b.page.keyboard.press('KeyE');
  await b.page.waitForFunction('!document.getElementById("th-dialogue")', { timeout: 3000 });
  await b.page.keyboard.press('KeyE');
  await b.page.waitForSelector('#th-dialogue', { timeout: 3000 });
  const priyaLine = await b.page.$eval('#th-dialogue p', el => el.textContent);
  log(/Chess Club/.test(priyaLine), `Priya's reaction line references Bob's real club name (${JSON.stringify(priyaLine)})`);
  await b.page.keyboard.press('KeyE');

  log(a.issues.length === 0, 'Alice: no console errors' + (a.issues.length ? ':\n  ' + a.issues.join('\n  ') : ''));
  log(b.issues.length === 0, 'Bob: no console errors' + (b.issues.length ? ':\n  ' + b.issues.join('\n  ') : ''));

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
