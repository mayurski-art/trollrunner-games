/* Troll High push-mechanic smoke test: the TV cart is a Sokoban-style
   pushable object (walk into it to shove it one tile) plus a "see inside
   the TV" screen popup. Verifies the push actually moves the object and
   its collision footprint, that it stops at walls rather than embedding
   into them (a real bug caught during development — the object's own
   solid check only covers its "feet" row, so a naive bounds check let a
   push shove the cart's visible top into the wall band even though the
   feet stayed on a legal tile), that it can never land on a door tile,
   and that the animated screen canvas actually renders. Run from anywhere
   after `npm i puppeteer-core`. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8948;
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
  await page.waitForFunction('window.__th', { timeout: 20000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running');

  await page.evaluate(() => window.__th.warpTo(15, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "classroom-3b"');
  await new Promise(r => setTimeout(r, 400));

  const cart0 = await page.evaluate(() => {
    const o = window.__th.zone.objectAt(17, 2);
    return o && { x: o.x, y: o.y };
  });
  log(cart0 && cart0.x === 17 && cart0.y === 2, `TV cart starts at (17,2): ${JSON.stringify(cart0)}`);

  // Push north, toward the thick top wall band — must refuse (this is the
  // exact case that exposed the bug: the object's feet stay on a legal
  // tile even though its visible top would land inside the wall).
  const northPush = await page.evaluate(() => {
    const z = window.__th.zone;
    const cart = z.objects.find(o => o.type === 'tv-cart');
    const before = { x: cart.x, y: cart.y };
    z.tryPush(cart, 0, -1);
    return { before, after: { x: cart.x, y: cart.y } };
  });
  log(northPush.after.y === northPush.before.y, `push toward the top wall band is refused (y stayed ${northPush.after.y})`);

  // Push east via real input — walk into it, confirm it actually moves and
  // the collision grid moves with it (vacated cell no longer solid).
  await page.evaluate(() => window.__th.warpTo(15, 3));
  await hold(page, 'ArrowRight', 1200);
  const cart1 = await page.evaluate(() => {
    const o = window.__th.zone.objects.find(o => o.type === 'tv-cart');
    return { x: o.x, y: o.y };
  });
  log(cart1.x > cart0.x, `pushing east (real input) moves the cart (x: ${cart0.x} -> ${cart1.x})`);
  const oldSpotSolid = await page.evaluate(() => window.__th.zone.solid[4][17]);
  log(oldSpotSolid === false, 'vacated cell is no longer solid after the push');

  // Push it all the way to the east wall — must stop clear of it, not overlap.
  for (let i = 0; i < 30; i++) await hold(page, 'ArrowRight', 300);
  const cartFinal = await page.evaluate(() => {
    const o = window.__th.zone.objects.find(o => o.type === 'tv-cart');
    return { x: o.x, y: o.y, roomW: window.__th.zone.w };
  });
  log(cartFinal.x + 2 <= cartFinal.roomW - 1, `cart stops before the east wall (x=${cartFinal.x}, roomW=${cartFinal.roomW})`);

  // Never lands on a door tile, however it's pushed.
  const doorSafe = await page.evaluate(() => {
    const z = window.__th.zone;
    const cart = z.objects.find(o => o.type === 'tv-cart');
    cart.x = 10; cart.y = 5;
    for (let i = 0; i < 5; i++) z.tryPush(cart, 0, -1);
    return !z.doorAt(cart.x, cart.y) && !z.doorAt(cart.x + 1, cart.y);
  });
  log(doorSafe, 'repeated pushes toward the door never land the cart on the door trigger tile');

  // "See inside the TV": the memory popup gets an animated screen canvas.
  await page.evaluate(() => {
    const o = window.__th.zone.objects.find(o => o.type === 'tv-cart');
    window.__th.warpTo(o.x, o.y + 3);
  });
  await hold(page, 'ArrowUp', 150);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-memory', { timeout: 3000 });
  const hasScreen = await page.$('.th-mem-screen');
  log(!!hasScreen, 'TV cart memory popup includes the animated screen canvas');
  const pixelsChanged = await page.evaluate(() => {
    const c = document.querySelector('.th-mem-screen');
    const ctx = c.getContext('2d');
    const a = ctx.getImageData(0, 0, 10, 10).data.slice();
    return new Promise(resolve => {
      setTimeout(() => {
        const b = ctx.getImageData(0, 0, 10, 10).data;
        resolve(!a.every((v, i) => v === b[i]));
      }, 150);
    });
  });
  log(pixelsChanged, 'screen canvas is actually animating (pixels change over time)');
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-memory")');

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
