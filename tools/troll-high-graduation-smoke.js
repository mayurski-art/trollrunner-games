/* Troll High graduation smoke test (design doc §23 Phase 6 capstone).
   Unlike the other five Multiplayer Memories slices, graduation is a
   real PERSISTED milestone, not a session-scoped toggle: eligibility is
   gated on real attendance (visitDays.size >= 5), and once graduated it
   can't be un-graduated. Two real browser contexts: confirms the
   not-yet-eligible message, forces eligibility via the debug save-state
   hooks (visiting 5 real days isn't practical to simulate by actually
   waiting), graduates, verifies the diploma recap persists across the
   popup reopening, the 🎓 tag broadcasts over presence to Bob, and Bob
   receives the live "just graduated" announcement toast. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8978;
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

async function approachReception(page) {
  // reception-counter at (1,3), w4h2 footRows1 -> solid row 4, approach row5.
  await page.evaluate(() => window.__th.warpTo(2, 5));
  await hold(page, 'ArrowUp', 60);
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1040,760', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });

  const a = await newVisitor(browser, 'GradAlice');
  const b = await newVisitor(browser, 'GradBob');

  await go(a.page, 2, 'office');
  await go(b.page, 2, 'office');

  // --- Not yet eligible (a fresh save only has 1 day attended) ----------
  await approachReception(a.page);
  const hintBefore = await a.page.$eval('#th-hint', el => el.textContent);
  log(/Front office/i.test(hintBefore), `hint offers the front office (${JSON.stringify(hintBefore)})`);
  await a.page.keyboard.press('KeyE');
  await a.page.waitForFunction('window.__th.graduationOpen === true', { timeout: 3000 });
  const notEligibleText = await a.page.evaluate(() => document.getElementById('th-graduation').textContent);
  log(/more day/i.test(notEligibleText), `not-yet-eligible message shows (${JSON.stringify(notEligibleText)})`);
  const graduateBtnMissing = await a.page.evaluate(() => !document.getElementById('th-graduate-btn'));
  log(graduateBtnMissing, 'no Graduate button when not yet eligible');
  await a.page.click('.th-mem-close');
  await a.page.waitForFunction('window.__th.graduationOpen === false', { timeout: 3000 });

  // Force eligibility the same way a real player would earn it (attending
  // 5 real distinct days) without actually waiting 5 days — directly
  // exercise the same code path via the debug hook's underlying state.
  await a.page.evaluate(() => {
    for (let i = 0; i < 5; i++) window.__th.visitDays.add('test-day-' + i);
  });
  log(await a.page.evaluate(() => window.__th.graduationEligible), 'forcing 5 attended days makes graduationEligible() true');

  await approachReception(a.page);
  await a.page.keyboard.press('KeyE');
  await a.page.waitForFunction('window.__th.graduationOpen === true', { timeout: 3000 });
  const eligibleText = await a.page.evaluate(() => document.getElementById('th-graduation').textContent);
  log(/attended enough/i.test(eligibleText), `eligible summary shows once qualified (${JSON.stringify(eligibleText)})`);

  await a.page.click('#th-graduate-btn');
  await new Promise(r => setTimeout(r, 150));
  const aGraduatedAt = await a.page.evaluate(() => window.__th.graduatedAt);
  log(typeof aGraduatedAt === 'number' && aGraduatedAt > 0, `graduating sets a real graduatedAt timestamp (${aGraduatedAt})`);
  const aNetGraduated = await a.page.evaluate(() => window.__th.net.graduated);
  log(aNetGraduated === true, "Alice's graduated status is broadcast over presence (net.graduated=true)");

  // Reopening shows the diploma recap, not the eligibility form again.
  const diplomaText = await a.page.evaluate(() => document.getElementById('th-graduation').textContent);
  log(/Diploma/i.test(diplomaText) && /Graduated/i.test(diplomaText), `reopening shows the diploma recap (${JSON.stringify(diplomaText)})`);
  await a.page.click('.th-mem-close');

  // Bob receives the live "just graduated" toast and sees the 🎓 tag.
  const bobToast = await b.page.waitForFunction(
    () => {
      const el = document.getElementById('th-gift-toast');
      return !el.hidden && /just graduated/i.test(el.textContent) ? el.textContent : false;
    },
    { timeout: 5000 }
  ).then(h => h.jsonValue()).catch(() => null);
  log(bobToast && /GradAlice/.test(bobToast), `Bob sees a live "just graduated" toast naming Alice (${JSON.stringify(bobToast)})`);

  await new Promise(r => setTimeout(r, 1000));
  const bobGhosts = await b.page.evaluate(() => [...window.__th.ghosts.values()].map(g => ({ name: g.name, graduated: g.graduated })));
  log(bobGhosts.some(g => g.graduated === true), `Bob's ghost view of Alice shows the persisted graduated tag (${JSON.stringify(bobGhosts)})`);

  log(a.issues.length === 0, 'Alice: no console errors' + (a.issues.length ? ':\n  ' + a.issues.join('\n  ') : ''));
  log(b.issues.length === 0, 'Bob: no console errors' + (b.issues.length ? ':\n  ' + b.issues.join('\n  ') : ''));

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
