/* Kitchen3D (Papa Troll's Pizzeria 3D, phase 1) smoke test: serves the repo
   statically and drives the scaffold — boot, movement, collision, station
   triggers, dock/undock — in headless Chrome. Mirrors the pattern in
   troll-pizzeria-smoke.js. Movement/collision are driven through the
   __debug handle (setKeys/tick) rather than real pointer-lock + key events,
   since pointer lock requires a user gesture headless Chrome can't grant. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = __dirname;
const PORT = 8945;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };

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
const consoleIssues = [];
function log(ok, msg) { results.push((ok ? 'PASS' : 'FAIL') + ' | ' + msg); console.log(results[results.length - 1]); }

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1180,860', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1160, height: 840 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().startsWith(`http://localhost:${PORT}`)) req.continue();
    else req.abort();
  });
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type())) return;
    const t = m.text();
    if (/ERR_FAILED|net::|Failed to load resource/.test(t)) return;
    consoleIssues.push(m.type() + ': ' + t);
  });
  page.on('pageerror', (e) => consoleIssues.push('pageerror: ' + e.message));

  await page.goto(`http://localhost:${PORT}/troll-pizzeria-3d-preview.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.TrollKitchen3D !== undefined', { timeout: 10000 });
  const ok = await page.evaluate(() => window.TrollKitchen3D.ok);
  log(ok, 'Kitchen3D initialized (WebGL available)');
  if (!ok) { await browser.close(); server.close(); process.exit(1); }

  await page.waitForSelector('.k3d-canvas', { timeout: 5000 });
  await page.screenshot({ path: path.join(OUT, 'k3d-1-spawn.png') });

  const spawn = await page.evaluate(() => window.TrollKitchen3D.__debug.getPlayer());
  log(Math.abs(spawn.x) < 0.01 && spawn.z > 2, `player spawns at a sane default (${spawn.x.toFixed(2)}, ${spawn.z.toFixed(2)})`);

  // Movement: hold "w" (forward, given spawn yaw) for a few ticks, confirm position changes
  const moved = await page.evaluate(() => {
    const k = window.TrollKitchen3D.__debug;
    k.setKeys(['w']);
    for (let i = 0; i < 30; i++) k.tick(1 / 60);
    k.setKeys([]);
    return k.getPlayer();
  });
  const dist = Math.hypot(moved.x - spawn.x, moved.z - spawn.z);
  log(dist > 0.3, `walking forward moves the player (moved ${dist.toFixed(2)} units)`);
  await page.screenshot({ path: path.join(OUT, 'k3d-2-walked.png') });

  // Collision: try to walk straight into the build table's footprint from
  // right in front of it — position must not penetrate the furniture box.
  const collisionOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D.__debug;
    const build = k.stations.find(s => s.id === 'build');
    k.setPlayer(build.x, build.triggerZ);           // stand right in front of it
    k.setKeys(['w']);                                // walk toward the counter (facing -z)
    for (let i = 0; i < 120; i++) k.tick(1 / 60);
    k.setKeys([]);
    const p = k.getPlayer();
    return { insideFurniture: k.isBlocked(p.x, p.z), z: p.z, furnitureFrontZ: build.z + 0.45 };
  });
  log(!collisionOk.insideFurniture && collisionOk.z > collisionOk.furnitureFrontZ - 0.4,
    `collision stops the player at the build table instead of clipping through (z=${collisionOk.z.toFixed(2)})`);

  // Wall collision: open floor near spawn, walk backward into the front
  // wall (no furniture between here and there, so this isolates wall
  // collision from the station-footprint collision tested above).
  const wallOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D.__debug;
    k.setPlayer(0, 2.5);
    k.setKeys(['s']);
    for (let i = 0; i < 300; i++) k.tick(1 / 60);
    k.setKeys([]);
    return k.getPlayer().z;
  });
  log(wallOk < 3.4, `front wall stops the player (final z=${wallOk.toFixed(2)}, wall at 3.4)`);

  // Station trigger: standing at a station's trigger point reports it as near.
  const nearOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D.__debug;
    const cut = k.stations.find(s => s.id === 'cut');
    k.setPlayer(cut.triggerX, cut.triggerZ);
    k.tick(1 / 60);
    return k.getNearStation();
  });
  log(nearOk === 'cut', `standing at the cutting table's trigger point reports it as near (got "${nearOk}")`);

  // Far from every station: nothing should be reported as near.
  const farOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D.__debug;
    k.setPlayer(0, 3);
    k.tick(1 / 60);
    return k.getNearStation();
  });
  log(farOk === null, `standing away from all stations reports none as near (got "${farOk}")`);

  // Dock / undock via interact().
  const dockOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D.__debug;
    const order = k.stations.find(s => s.id === 'order');
    k.setPlayer(order.triggerX, order.triggerZ);
    k.tick(1 / 60);
    k.interact();
    const dockedId = k.getDocked();
    k.interact();
    const afterStepBack = k.getDocked();
    return { dockedId, afterStepBack };
  });
  log(dockOk.dockedId === 'order' && dockOk.afterStepBack === null,
    `interacting docks into the station ("${dockOk.dockedId}") and stepping away undocks (now "${dockOk.afterStepBack}")`);
  await page.screenshot({ path: path.join(OUT, 'k3d-3-docked.png') });

  if (consoleIssues.length) {
    console.log('\nConsole issues:');
    consoleIssues.forEach(i => console.log('  ' + i));
  } else console.log('\nNo console errors.');

  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(1); });
