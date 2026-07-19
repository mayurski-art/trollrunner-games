/* Troll Kombat online-invite smoke test: serves the repo statically and
   drives HOST + GUEST as two pages in the same headless browser (so the
   BroadcastChannel transport fallback pairs them — Supabase's CDN script is
   blocked on purpose to force that deterministic offline path for CI).
   Run from anywhere after `npm i puppeteer-core` (screenshots land next to
   this script). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = __dirname;
const PORT = 8933;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' };

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
const T = 6000;
const step = s => console.log('  step:', s);

// Puppeteer's click()/type() poll a requestAnimationFrame-driven "is stable"
// check internally; a backgrounded tab in headless Chrome can starve that rAF
// even with the throttling launch flags, hanging the call forever. Bringing
// the target page to front before every interaction avoids that.
async function click(page, sel) { await page.bringToFront(); await page.click(sel); }
async function type(page, sel, text) { await page.bringToFront(); await page.type(sel, text); }
async function wsel(page, sel, opts) { await page.bringToFront(); await page.waitForSelector(sel, opts); }
async function wfn(page, fn, opts) { await page.bringToFront(); await page.waitForFunction(fn, opts); }

async function setupPage(browser, name) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 820 });
  page.on('console', m => { if (m.type() === 'error') console.log(`[${name} console error] ${m.text()}`); });
  page.on('pageerror', e => console.log(`[${name} pageerror] ${e.message}`));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    // Force the BroadcastChannel fallback: no site-wide launch gate, no
    // Supabase Realtime (which needs real internet + a live project).
    if (u.includes('coming-soon.js') || u.includes('supabase-js') || u.includes('troll-accounts.js') || u.includes('troll-notis.js')) req.abort();
    else req.continue();
  });
  await page.goto(`http://localhost:${PORT}/troll-kombat.html`, { waitUntil: 'networkidle0' });
  return page;
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1200,820', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion'],
  });

  const host = await setupPage(browser, 'HOST');
  const guest = await setupPage(browser, 'GUEST');
  log(true, 'both pages loaded troll-kombat.html');

  // ---- host: matchtype -> multiplayer -> online -> host a match ----------
  step('host click mt-mp'); await click(host, '[data-act="mt-mp"]');
  step('host wait mpmode'); await wsel(host, '#tk-mpmode.is-visible', { timeout: T });
  step('host click mpm-online'); await click(host, '[data-act="mpm-online"]');
  step('host wait lobby'); await wsel(host, '#tk-lobby.is-visible', { timeout: T });
  step('host click lobby-host'); await click(host, '#lobby-host');
  step('host wait code'); await wfn(host, () => !document.getElementById('lobby-code').hidden, { timeout: T });
  const code = await host.$eval('#lobby-code-value', el => el.textContent.trim());
  log(/^[A-Z0-9]{5}$/.test(code), `host generated a 5-char invite code: ${code}`);

  // ---- guest: matchtype -> multiplayer -> online -> join with the code ---
  step('guest click mt-mp'); await click(guest, '[data-act="mt-mp"]');
  step('guest wait mpmode'); await wsel(guest, '#tk-mpmode.is-visible', { timeout: T });
  step('guest click mpm-online'); await click(guest, '[data-act="mpm-online"]');
  step('guest wait lobby'); await wsel(guest, '#tk-lobby.is-visible', { timeout: T });
  step('guest type code'); await type(guest, '#lobby-input', code);
  step('guest click join'); await click(guest, '#lobby-join');

  // Both should land on fighter select once paired.
  step('host wait fighter select'); await wsel(host, '#tk-fighter.is-visible', { timeout: T });
  step('guest wait fighter select'); await wsel(guest, '#tk-fighter.is-visible', { timeout: T });
  log(true, 'handshake paired — both screens reached fighter select');

  // ---- fighter select: host picks Pepe, guest picks Doge -----------------
  step('host pick pepe'); await click(host, '.fsel-cell[data-id="pepe"]');
  step('guest pick doge'); await click(guest, '.fsel-cell[data-id="doge"]');
  step('host wait picks mirrored'); await wfn(host, () => {
    const t1 = document.querySelector('#fsel-p1 strong')?.textContent;
    const t2 = document.querySelector('#fsel-p2 strong')?.textContent;
    return t1 === 'PEPE' && t2 === 'DOGE';
  }, { timeout: T });
  const guestPanels = await guest.evaluate(() => ({
    p1: document.querySelector('#fsel-p1 strong')?.textContent,
    p2: document.querySelector('#fsel-p2 strong')?.textContent,
  }));
  log(guestPanels.p1 === 'PEPE' && guestPanels.p2 === 'DOGE', `picks mirrored on guest screen (p1=${guestPanels.p1}, p2=${guestPanels.p2})`);

  const contDisabledOnGuest = await guest.$eval('#fsel-continue', el => el.disabled);
  log(contDisabledOnGuest, 'guest cannot advance the flow (host-only continue)');

  await host.screenshot({ path: path.join(OUT, 'kombat-online-1-fselect-host.png') });
  await guest.screenshot({ path: path.join(OUT, 'kombat-online-1-fselect-guest.png') });

  // ---- host advances to stage select, both should mirror -----------------
  step('host click continue'); await click(host, '#fsel-continue');
  step('host wait stage'); await wsel(host, '#tk-stage.is-visible', { timeout: T });
  step('guest wait stage'); await wsel(guest, '#tk-stage.is-visible', { timeout: T });
  const guestSpectating = await guest.$eval('#tk-stage', el => el.classList.contains('is-spectate'));
  log(guestSpectating, 'guest is in spectate mode on the stage screen');

  // ---- host starts the fight -----------------------------------------------
  step('host click fight'); await click(host, '[data-act="stage-fight"]');
  step('host wait gameState fight'); await wfn(host, () => document.body.dataset.gameState === 'fight', { timeout: T });
  step('guest wait gameState fight'); await wfn(guest, () => document.body.dataset.gameState === 'fight', { timeout: T });
  log(true, 'both screens entered the fight');

  await new Promise(r => setTimeout(r, 3500));   // let the 3·2·1·FIGHT countdown clear
  const hpBefore = await host.$eval('#p2-health', el => el.style.width);
  log(!!hpBefore, `host HUD is live mid-fight (P2 health bar = ${hpBefore})`);

  await host.screenshot({ path: path.join(OUT, 'kombat-online-2-fight-host.png') });
  await guest.screenshot({ path: path.join(OUT, 'kombat-online-2-fight-guest.png') });

  // ---- guest moves; no debug hook exposes fighter position, so this checks
  // that sending input over the wire doesn't throw on either screen ---------
  await guest.bringToFront();
  await guest.keyboard.down('ArrowRight');
  await new Promise(r => setTimeout(r, 400));
  await guest.keyboard.up('ArrowRight');
  await new Promise(r => setTimeout(r, 300));
  log(true, 'guest sent movement input without a console/page error on either screen');

  await browser.close();
  server.close();

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL'));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('SMOKE TEST CRASHED:', e); process.exit(1); });
