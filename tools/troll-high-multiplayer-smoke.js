/* Troll High multiplayer smoke test: two isolated browser contexts (real
   separate guest identities, matching the verify skill's "one context per
   simulated visitor" pattern) both join the Main Hallway and confirm they
   actually see each other — ghost appears, position updates, chat and
   emote bubbles propagate, and leaving a zone/tab removes the peer. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = __dirname;
const PORT = 8938;
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
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors')) issues.push(m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
  await page.evaluate(n => { document.getElementById('th-name').value = n; }, name);
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');
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

  const a = await newVisitor(browser, 'AliceTest');
  const b = await newVisitor(browser, 'BobTest');
  log(true, 'two isolated visitors (separate localStorage/identity) both booted and started');

  // Give both a moment to finish joining trollhigh:hallway-a (Supabase
  // subscribe or BroadcastChannel fallback — whichever this env resolves).
  await new Promise(r => setTimeout(r, 2500));
  const [connA, connB] = await Promise.all([
    a.page.evaluate(() => window.__th.net.connected),
    b.page.evaluate(() => window.__th.net.connected),
  ]);
  log(connA && connB, `both joined the hallway channel (A connected=${connA}, B connected=${connB})`);

  // Walk both around a bit so position broadcasts actually fire (sendPosition
  // is throttled to 10Hz and only sends while dt has accumulated).
  await Promise.all([hold(a.page, 'ArrowRight', 400), hold(b.page, 'ArrowLeft', 400)]);
  await new Promise(r => setTimeout(r, 1500)); // let broadcasts + timeouts settle

  const aSeesB = await a.page.evaluate(() => [...window.__th.ghosts.values()].some(g => g.name === 'BobTest'));
  const bSeesA = await b.page.evaluate(() => [...window.__th.ghosts.values()].some(g => g.name === 'AliceTest'));
  log(aSeesB, 'Alice sees Bob as a ghost');
  log(bSeesA, 'Bob sees Alice as a ghost');

  const rosterA = await a.page.$eval('#th-roster', el => el.textContent);
  log(rosterA === '👥 2', `Alice's roster pill shows both players (${rosterA})`);

  // Chat: Alice sends, Bob should receive it in his log + see it as a bubble
  await a.page.keyboard.press('Enter'); // open chat
  await new Promise(r => setTimeout(r, 150));
  await a.page.type('#th-chat-input', 'hi from alice');
  await a.page.keyboard.press('Enter'); // send
  await new Promise(r => setTimeout(r, 800));
  const bLog = await b.page.evaluate(() => document.getElementById('th-chat-log').textContent);
  log(bLog.includes('AliceTest') && bLog.includes('hi from alice'), `Bob's chat log received Alice's message: ${JSON.stringify(bLog)}`);
  const bobGhostBubble = await b.page.evaluate(() => {
    const g = [...window.__th.ghosts.values()].find(x => x.name === 'AliceTest');
    return g && g.bubble ? g.bubble.text : null;
  });
  log(bobGhostBubble === 'hi from alice', `Bob's ghost of Alice is showing her chat bubble (${JSON.stringify(bobGhostBubble)})`);

  // Emote: Bob waves, Alice should see the emoji as Bob's ghost bubble
  await b.page.click('#th-emotes button[data-emoji="👋"]');
  await new Promise(r => setTimeout(r, 800));
  const aliceGhostEmote = await a.page.evaluate(() => {
    const g = [...window.__th.ghosts.values()].find(x => x.name === 'BobTest');
    return g && g.bubble ? g.bubble.text : null;
  });
  log(aliceGhostEmote === '👋', `Alice's ghost of Bob shows his wave emote (${JSON.stringify(aliceGhostEmote)})`);

  // Leaving: close Bob's tab entirely, Alice's ghost of Bob should time out
  // and be pruned (GHOST_TIMEOUT_MS = 8s in net.js)
  await b.ctx.close();
  await new Promise(r => setTimeout(r, 9000));
  const bobGoneFromAlice = await a.page.evaluate(() => ![...window.__th.ghosts.values()].some(g => g.name === 'BobTest'));
  log(bobGoneFromAlice, "Bob's ghost is pruned from Alice's view ~8s after he disconnects");

  const realIssuesA = a.issues.filter(t => !t.includes('frame-ancestors'));
  log(realIssuesA.length === 0, 'no console errors on Alice\'s tab' + (realIssuesA.length ? ':\n  ' + realIssuesA.join('\n  ') : ''));

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await a.ctx.close().catch(() => {});
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
