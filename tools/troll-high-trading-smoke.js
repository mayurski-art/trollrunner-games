/* Troll High trading + gifting smoke test (Phase 7 close-out): two real
   isolated browser contexts, same pattern as troll-high-multiplayer-smoke.
   Verifies a full trade negotiation (offer -> counter-offer -> both sides'
   inventories update correctly), a decline, and a one-way gift. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8970;
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

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1040,760', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });

  const a = await newVisitor(browser, 'AliceCard');
  const b = await newVisitor(browser, 'BobCard');

  // Seed known inventories via the debug hook, rather than relying on the
  // random award chance, so the trade itself is what's under test.
  await a.page.evaluate(() => window.__th.addCard('trollface'));
  await b.page.evaluate(() => window.__th.addCard('mp3-player'));

  // Move both away from Janitor Gus's hallway-a patrol route (x22-45,
  // row 8) — nearNPC correctly outranks nearPeer, but that means his
  // patrol would otherwise steal every trade interaction in this test.
  await a.page.evaluate(() => window.__th.warpTo(3, 5));
  await b.page.evaluate(() => window.__th.warpTo(3, 5));

  await new Promise(r => setTimeout(r, 2500));
  const [connA, connB] = await Promise.all([
    a.page.evaluate(() => window.__th.net.connected),
    b.page.evaluate(() => window.__th.net.connected),
  ]);
  log(connA && connB, `both joined the hallway channel (A connected=${connA}, B connected=${connB})`);

  // Both warped to the identical tile, so no movement nudge is needed —
  // sendPosition() fires periodically regardless of movement (throttled
  // to 10Hz), and nudging them in opposite directions (as an earlier
  // version of this test did) pushed them ~29px apart, just over the
  // 26px trade range, which was the real source of this test's flakiness.
  // Position sync is still real Supabase Realtime traffic, so poll for it
  // rather than a single check after a fixed sleep.
  const NEAR_PEER_FN = `(() => {
    for (const [, p] of window.__th.net.liveGhosts()) {
      if (Math.hypot(p.x - window.__th.player.x, p.y - window.__th.player.y) < 26) return true;
    }
    return false;
  })()`;
  try {
    await a.page.waitForFunction(NEAR_PEER_FN, { timeout: 8000, polling: 200 });
  } catch (e) {
    const diag = await a.page.evaluate(() => ({
      me: { x: window.__th.player.x, y: window.__th.player.y },
      ghosts: [...window.__th.net.liveGhosts()].map(([id, p]) => ({ id, x: p.x, y: p.y, name: p.name })),
      connected: window.__th.net.connected, zoneId: window.__th.zone.id,
    }));
    console.log('DIAG (initial near-peer wait):', JSON.stringify(diag));
    throw e;
  }

  const nearPeerCheck = await a.page.evaluate(() => {
    for (const [, p] of window.__th.net.liveGhosts()) {
      if (Math.hypot(p.x - window.__th.player.x, p.y - window.__th.player.y) < 26) return p.name;
    }
    return null;
  });
  log(nearPeerCheck === 'BobCard', `Alice detects Bob as a nearby trade partner (${nearPeerCheck})`);

  const hint = await a.page.$eval('#th-hint', el => el.textContent);
  log(/Trade with BobCard/.test(hint), `hint offers to trade with Bob: ${JSON.stringify(hint)}`);

  // --- Full trade: Alice offers her Trollface card, Bob counters with his MP3 player ---
  await a.page.keyboard.press('KeyE');
  await a.page.waitForFunction('window.__th.tradeOpen === true', { timeout: 3000 });
  await a.page.click('.th-trade-card'); // only one card in Alice's inventory: trollface
  await a.page.click('#th-trade-send');
  await a.page.waitForSelector('#th-trade-waiting:not([hidden])', { timeout: 3000 });
  log(true, 'Alice sends a trade offer and sees the waiting screen');

  await b.page.waitForFunction('window.__th.tradeOpen === true', { timeout: 5000 });
  const incomingMsg = await b.page.$eval('#th-trade-incoming-msg', el => el.textContent);
  log(/AliceCard/.test(incomingMsg), `Bob sees the incoming offer from Alice: ${JSON.stringify(incomingMsg)}`);
  const offerShown = await b.page.$eval('#th-trade-incoming-offer', el => el.textContent);
  log(/Trollface/.test(offerShown), `Bob sees what Alice is offering (${JSON.stringify(offerShown)})`);

  await b.page.click('#th-trade-counter-cards .th-trade-card'); // Bob's only card: mp3-player
  await b.page.click('#th-trade-accept');
  await b.page.waitForFunction('window.__th.tradeOpen === true && document.getElementById("th-trade-done") && !document.getElementById("th-trade-done").hidden', { timeout: 3000 });
  log(true, 'Bob accepts the trade');

  await a.page.waitForFunction('!document.getElementById("th-trade-done").hidden', { timeout: 5000 });

  const [aCards, bCards] = await Promise.all([
    a.page.evaluate(() => window.__th.cards),
    b.page.evaluate(() => window.__th.cards),
  ]);
  log(aCards['mp3-player'] === 1 && !aCards.trollface, `Alice now has Bob's card and not her own (${JSON.stringify(aCards)})`);
  log(bCards.trollface === 1 && !bCards['mp3-player'], `Bob now has Alice's card and not his own (${JSON.stringify(bCards)})`);

  await a.page.keyboard.press('KeyE'); // close Alice's done screen
  await a.page.waitForFunction('window.__th.tradeOpen === false', { timeout: 3000 });
  await b.page.keyboard.press('KeyE'); // close Bob's done screen
  await b.page.waitForFunction('window.__th.tradeOpen === false', { timeout: 3000 });

  // --- Decline: Bob offers, Alice declines, nobody's inventory changes ---
  await b.page.evaluate(() => window.__th.warpTo(window.__th.player.tileX, window.__th.player.tileY));
  await hold(b.page, 'ArrowLeft', 60);
  await new Promise(r => setTimeout(r, 1000));
  await b.page.keyboard.press('KeyE');
  try {
    await b.page.waitForFunction('window.__th.tradeOpen === true', { timeout: 5000 });
  } catch (e) {
    const diag = await b.page.evaluate(() => ({
      bx: window.__th.player.x, by: window.__th.player.y,
      hint: document.getElementById('th-hint').textContent,
      ghosts: [...window.__th.net.liveGhosts()].map(([id, p]) => ({ id, x: p.x, y: p.y, name: p.name })),
    }));
    console.log('DIAG:', JSON.stringify(diag));
    throw e;
  }
  const bobCardBtn = await b.page.$('.th-trade-card');
  if (bobCardBtn) {
    await bobCardBtn.click();
    await b.page.click('#th-trade-send');
    await a.page.waitForFunction('window.__th.tradeOpen === true', { timeout: 5000 });
    await a.page.click('#th-trade-decline');
    await b.page.waitForFunction('!document.getElementById("th-trade-done").hidden', { timeout: 5000 });
    const doneMsg = await b.page.$eval('#th-trade-done-msg', el => el.textContent);
    log(/declined/i.test(doneMsg), `Bob sees the decline message (${JSON.stringify(doneMsg)})`);
    await b.page.keyboard.press('KeyE');
    await b.page.waitForFunction('window.__th.tradeOpen === false', { timeout: 3000 });
  } else {
    log(false, 'Bob had no card left to test decline with (unexpected inventory state)');
  }

  // --- Gift: Alice gifts her mp3-player to Bob, one-way, no confirmation needed ---
  await a.page.keyboard.press('KeyE');
  await a.page.waitForFunction('window.__th.tradeOpen === true', { timeout: 3000 });
  await a.page.click('#th-trade-mode-gift');
  await a.page.click('.th-trade-card');
  await a.page.click('#th-trade-send');
  await a.page.waitForFunction('!document.getElementById("th-trade-done").hidden', { timeout: 3000 });
  await new Promise(r => setTimeout(r, 500));

  const bobToast = await b.page.$eval('#th-gift-toast', el => ({ hidden: el.hidden, text: el.textContent }));
  log(!bobToast.hidden && /gave you a/.test(bobToast.text), `Bob sees the gift toast (${JSON.stringify(bobToast)})`);
  const [aCardsAfterGift, bCardsAfterGift] = await Promise.all([
    a.page.evaluate(() => window.__th.cards),
    b.page.evaluate(() => window.__th.cards),
  ]);
  log(!aCardsAfterGift['mp3-player'], `Alice no longer has the gifted card (${JSON.stringify(aCardsAfterGift)})`);
  log(bCardsAfterGift['mp3-player'] === 1, `Bob received the gifted card (${JSON.stringify(bCardsAfterGift)})`);

  const realIssuesA = a.issues.filter(t => !t.includes('frame-ancestors'));
  const realIssuesB = b.issues.filter(t => !t.includes('frame-ancestors'));
  log(realIssuesA.length === 0 && realIssuesB.length === 0, 'no console errors on either tab' +
    (realIssuesA.length ? ':\n  A: ' + realIssuesA.join('\n  ') : '') +
    (realIssuesB.length ? ':\n  B: ' + realIssuesB.join('\n  ') : ''));

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await a.ctx.close().catch(() => {});
  await b.ctx.close().catch(() => {});
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
