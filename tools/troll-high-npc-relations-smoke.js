/* Troll High NPC memory smoke test (design doc §21, explicitly-deferred
   item now built): each NPC remembers YOU specifically, via a per-player
   relationship record in your own save — a first-meeting line, then
   normal cycling dialogue, then a one-time "you're a regular" line at
   the familiarity threshold. Verifies the actual line sequence, that the
   relationship persists across reload, and that it's genuinely per-NPC
   (talking to one doesn't affect another). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8976;
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

async function talkOnce(page) {
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-dialogue', { timeout: 3000 });
  const text = await page.$eval('#th-dialogue p', el => el.textContent);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-dialogue")', { timeout: 3000 });
  return text;
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

  // Ms. Chalke is in Room 3B — stand right next to her
  await page.evaluate(() => window.__th.warpTo(15, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "classroom-3b"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => window.__th.warpTo(4, 4));
  await new Promise(r => setTimeout(r, 150));

  const line1 = await talkOnce(page);
  log(line1 === "New face. Sit anywhere that isn't Marcus's usual spot.", `first-ever meeting shows the special firstLine (${JSON.stringify(line1)})`);

  const line2 = await talkOnce(page);
  log(line1 !== line2 && !/New face/.test(line2), `second interaction moves on to normal cycling dialogue, not firstLine again (${JSON.stringify(line2)})`);

  const relationAfter2 = await page.evaluate(() => window.__th.npcRelations['ms-chalke']);
  log(relationAfter2.timesTalked === 2, `relationship record tracks 2 interactions (${JSON.stringify(relationAfter2)})`);

  // relation.timesTalked is checked BEFORE incrementing, so FAMILIAR_AT=3
  // fires on the interaction where timesTalked reads 3 going in — the 4th
  // call overall (0,1,2 already happened above), not literally "the 3rd."
  const line3 = await talkOnce(page);
  log(!/You again/.test(line3), `3rd interaction is still normal cycling, not the familiarLine yet (${JSON.stringify(line3)})`);

  const line4 = await talkOnce(page);
  log(line4 === "You again. I like that. Sit down.", `4th interaction (timesTalked hits the FAMILIAR_AT threshold) shows the one-time familiarLine (${JSON.stringify(line4)})`);

  const line5 = await talkOnce(page);
  log(!/You again. I like that/.test(line5) && line5 !== "New face. Sit anywhere that isn't Marcus's usual spot.",
    `5th interaction goes back to normal cycling, familiarLine doesn't repeat (${JSON.stringify(line5)})`);

  // A DIFFERENT NPC should have its own independent, untouched relationship.
  // classroom-3b's own door back to hallway-a is at (10,3) — approach 2
  // tiles below it, same convention as every other room-exit in this suite.
  await page.evaluate(() => window.__th.warpTo(10, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-a"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));

  const gusRelationBefore = await page.evaluate(() => window.__th.npcRelations['janitor-gus']);
  log(!gusRelationBefore, `a different NPC (Gus) has no relationship record yet — talking to Chalke didn't touch it (${JSON.stringify(gusRelationBefore)})`);

  // Persistence: reload and confirm the relationship (and that we're past
  // the firstLine) survives
  await page.evaluate(() => window.__th.persist());
  await new Promise(r => setTimeout(r, 300));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 10000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true', { timeout: 10000 });
  await dismissOrientation(page);

  const relationAfterReload = await page.evaluate(() => window.__th.npcRelations['ms-chalke']);
  log(relationAfterReload && relationAfterReload.timesTalked === 5, `relationship persists across reload (${JSON.stringify(relationAfterReload)})`);

  await page.evaluate(() => window.__th.warpTo(15, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "classroom-3b"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => window.__th.warpTo(4, 4));
  await new Promise(r => setTimeout(r, 150));
  const line6 = await talkOnce(page);
  log(line6 !== "New face. Sit anywhere that isn't Marcus's usual spot.", `after reload, she still doesn't re-greet you as a stranger (${JSON.stringify(line6)})`);

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
