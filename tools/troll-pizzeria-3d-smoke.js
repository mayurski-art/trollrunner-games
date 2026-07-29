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

  // --- Phase 2: build table + oven rack ---

  // Dock at the build table, then paint sauce dead-center (build pie sits
  // at screen center once docked, by construction of the dock look-at).
  await page.evaluate(() => {
    const k = window.TrollKitchen3D.__debug;
    const build = k.stations.find(s => s.id === 'build');
    k.setPlayer(build.triggerX, build.triggerZ);
    k.tick(1 / 60);
    k.interact();
  });
  await new Promise(r => setTimeout(r, 500)); // let the dock tween finish
  await page.screenshot({ path: path.join(OUT, 'k3d-4-build-dock.png') });

  const paintOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D.__debug;
    let hit = null;
    for (let i = 0; i < 20; i++) hit = k.paintAtNDC(0, 0, 'sauce');
    return { hit, state: k.getBuildState() };
  });
  log(!!paintOk.hit && paintOk.state.sauce > 0.1,
    `painting the build pie raises sauce coverage (sauce=${(paintOk.state.sauce * 100).toFixed(0)}%, hit=${JSON.stringify(paintOk.hit)})`);
  await page.screenshot({ path: path.join(OUT, 'k3d-5-painted.png') });

  const placeOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D.__debug;
    const hit = k.placeAtNDC(0.15, 0, 'pepperoni');
    return { hit, placedCount: k.getBuildState().placed.length };
  });
  log(placeOk.placedCount === 1, `placing a topping adds it to the build state (placed=${placeOk.placedCount})`);

  const resetOk = await page.evaluate(() => {
    window.TrollKitchen3D.build.reset();
    return window.TrollKitchen3D.build.getState();
  });
  log(resetOk.sauce === 0 && resetOk.placed.length === 0, 'resetting the build clears sauce and toppings');

  // Oven rack: bake a demo pie in slot 0, then clear it; fire slot 2.
  const ovenOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D;
    k.oven.setSlot(0, { sauce: 0.6, cheese: 0.6, doneness: 0.5, placed: [{ tid: 'pepperoni', x: 0.5, y: 0.5 }], cutAngles: [] });
    const afterBake = k.__debug.getOvenSlot(0);
    k.oven.setSlot(0, null);
    const afterClear = k.__debug.getOvenSlot(0);
    return { afterBake, afterClear };
  });
  log(ovenOk.afterBake.hasPie && !ovenOk.afterClear.hasPie,
    `oven slot shows a pie while baking (${ovenOk.afterBake.hasPie}) and clears when pulled (${ovenOk.afterClear.hasPie})`);

  const fireOk = await page.evaluate(async () => {
    const k = window.TrollKitchen3D;
    k.oven.setFire(2, true);
    for (let i = 0; i < 10; i++) k.__debug.tick(1 / 60);
    const firing = k.__debug.getOvenSlot(2);
    k.oven.setFire(2, false);
    return firing;
  });
  log(fireOk.firing && fireOk.fireIntensity > 0, `kitchen fire visual activates on a slot (intensity=${fireOk.fireIntensity.toFixed(2)})`);

  // Step back from build-dock before starting the phase-3 full-loop test.
  await page.evaluate(() => window.TrollKitchen3D.__debug.interact());

  // --- Phase 3: full demo loop — order -> build -> bake -> cut -> serve ---

  const lobbyBefore = await page.evaluate(() => window.TrollKitchen3D.demo.getLobbyCount());
  log(lobbyBefore > 0, `lobby starts with demo customers waiting (${lobbyBefore})`);

  // Order: dock at the counter, take the order.
  const orderOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D;
    const order = k.__debug.stations.find(s => s.id === 'order');
    k.__debug.setPlayer(order.triggerX, order.triggerZ);
    k.__debug.tick(1 / 60);
    k.__debug.interact();
    const took = k.demo.action();
    return { took, ticket: k.demo.getTicket(), lobbyAfter: k.demo.getLobbyCount() };
  });
  log(orderOk.took && orderOk.ticket?.stage === 'building' && orderOk.lobbyAfter === lobbyBefore - 1,
    `taking an order starts a building ticket for ${orderOk.ticket?.cust?.name} (lobby ${lobbyBefore}→${orderOk.lobbyAfter})`);
  await page.evaluate(() => window.TrollKitchen3D.__debug.interact()); // step back

  // Build: dock at the build table, paint + place, then send to the oven.
  // The dock camera tween (~420ms) must finish before raycasting from the
  // build angle will actually hit the pie — wait in real time (driven by
  // the module's own rAF loop) rather than painting mid-tween.
  await page.evaluate(() => {
    const k = window.TrollKitchen3D;
    const build = k.__debug.stations.find(s => s.id === 'build');
    k.__debug.setPlayer(build.triggerX, build.triggerZ);
    k.__debug.tick(1 / 60);
    k.__debug.interact();
  });
  await new Promise(r => setTimeout(r, 500));
  const buildOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D;
    for (let i = 0; i < 15; i++) k.__debug.paintAtNDC(0, 0, 'sauce');
    k.__debug.placeAtNDC(0.15, 0, 'pepperoni');
    const sent = k.demo.action();
    return { sent, ticket: k.demo.getTicket() };
  });
  log(buildOk.sent && buildOk.ticket?.stage === 'baking' && buildOk.ticket.sauce > 0.1 && buildOk.ticket.placed.length === 1,
    `sending the built pie to the oven carries the painted/placed state along (stage=${buildOk.ticket?.stage}, sauce=${(buildOk.ticket?.sauce * 100).toFixed(0)}%)`);
  await page.evaluate(() => window.TrollKitchen3D.__debug.interact()); // step back

  // Bake: doneness rises automatically while docked elsewhere, then pull it.
  const bakeOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D;
    for (let i = 0; i < 400; i++) k.__debug.tick(1 / 60);   // ~6.7s of bake time
    const donenessMidbake = k.demo.getTicket().doneness;
    const bake = k.__debug.stations.find(s => s.id === 'bake');
    k.__debug.setPlayer(bake.triggerX, bake.triggerZ);
    k.__debug.tick(1 / 60);
    k.__debug.interact();
    const pulled = k.demo.action();
    return { donenessMidbake, pulled, ticket: k.demo.getTicket() };
  });
  log(bakeOk.donenessMidbake > 0 && bakeOk.pulled && bakeOk.ticket?.stage === 'ready',
    `doneness rises while baking (${(bakeOk.donenessMidbake * 100).toFixed(0)}%) and pulling moves the ticket to "ready"`);
  await page.evaluate(() => window.TrollKitchen3D.__debug.interact()); // step back

  // Cut: dock at the cutting table, load, sweep, commit 4 cuts, then serve.
  const cutOk = await page.evaluate(async () => {
    const k = window.TrollKitchen3D;
    const cut = k.__debug.stations.find(s => s.id === 'cut');
    k.__debug.setPlayer(cut.triggerX, cut.triggerZ);
    k.__debug.tick(1 / 60);
    k.__debug.interact();
    const loaded = k.demo.action();                 // ready -> cutting, starts sweep-armed
    const pieVisible = k.__debug.isCutPieVisible();
    k.demo.action();                                 // arms the sweep
    for (let n = 0; n < 4; n++) {
      for (let i = 0; i < 20; i++) k.__debug.tick(1 / 60);  // let the sweeper move
      k.demo.action();                               // commit a cut
    }
    const ticketAfterCuts = k.demo.getTicket();
    const served = k.demo.action();                  // now serves
    return { loaded, pieVisible, cutsCommitted: ticketAfterCuts.cutAngles.length, served };
  });
  log(cutOk.loaded && cutOk.pieVisible && cutOk.cutsCommitted === 4 && cutOk.served,
    `cutting table: loads the pulled pie (visible=${cutOk.pieVisible}), takes 4 cuts, and serves`);

  // Poll rather than a fixed sleep — the serve-spin tween duration is a
  // rendering-feel constant, not a contract; don't let smoke-test timing
  // race it.
  let afterServe = 'pending';
  for (let i = 0; i < 20 && afterServe !== null; i++) {
    await new Promise(r => setTimeout(r, 150));
    afterServe = await page.evaluate(() => window.TrollKitchen3D.demo.getTicket());
  }
  log(afterServe === null, 'serving clears the demo ticket');
  await page.evaluate(() => window.TrollKitchen3D.__debug.interact()); // step back
  await page.screenshot({ path: path.join(OUT, 'k3d-7-fullloop.png') });

  // --- Phase 4: Grin Hunt + rush hour + perf pass ---

  const grinOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D;
    k.trollEvent.spawnGrinHunt();
    const activeAfterSpawn = k.trollEvent.isGrinHuntActive();
    const pos = k.__debug.getGrinPosition();
    const caught = k.__debug.clickCenter(); // crosshair almost certainly misses a random position
    return { activeAfterSpawn, pos, caught, tally: k.trollEvent.getGrinTally() };
  });
  log(grinOk.activeAfterSpawn && !!grinOk.pos, `Grin Hunt spawns somewhere in the room (${JSON.stringify(grinOk.pos)})`);

  // Expiry is wall-clock based (like the dock-camera tween), not dt-driven,
  // so this needs a real wait — the module's own rAF loop (already running
  // since mount()) ticks it down in the background.
  await new Promise(r => setTimeout(r, 2900));
  const grinMissOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D;
    return { active: k.trollEvent.isGrinHuntActive(), tally: k.trollEvent.getGrinTally() };
  });
  log(!grinMissOk.active && grinMissOk.tally.missed >= 1, `an un-caught Grin Hunt expires and counts as missed (tally=${JSON.stringify(grinMissOk.tally)})`);

  // Catch one for real: stand a couple units back and aim the camera's
  // yaw/pitch straight at wherever it spawns, then click dead-center.
  const grinCatchOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D;
    k.trollEvent.spawnGrinHunt();
    const pos = k.__debug.getGrinPosition();
    const eyeX = 0, eyeZ = pos.z + 2, eyeY = 1.6; // stand back from the grin's z, facing it
    const dx = pos.x - eyeX, dz = pos.z - eyeZ, dy = pos.y - eyeY;
    const yaw = Math.atan2(-dx, -dz);
    const horizDist = Math.hypot(dx, dz);
    const pitch = Math.atan2(dy, horizDist);
    k.__debug.setPlayer(eyeX, eyeZ, yaw, pitch);
    k.__debug.tick(1 / 60);
    const caught = k.__debug.clickCenter();
    return { caught, pos, tally: k.trollEvent.getGrinTally() };
  });
  log(grinCatchOk.caught && grinCatchOk.tally.caught >= 1, `aiming at and clicking the grin catches it (tally=${JSON.stringify(grinCatchOk.tally)})`);

  const rushOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D;
    const before = k.demo.getLobbyCount();
    const added = k.trollEvent.triggerRushHour();
    return { before, added, after: k.demo.getLobbyCount() };
  });
  log(rushOk.added > 0 && rushOk.after === rushOk.before + rushOk.added,
    `rush hour adds extra customers to the lobby (${rushOk.before}→${rushOk.after})`);

  // Perf: the render loop pauses when the tab is backgrounded and resumes
  // when it's foregrounded again (battery/GPU, not just a visual nicety).
  const perfOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D;
    const runningBefore = k.__debug.isLoopRunning();
    k.__debug.simulateVisibility(true);
    const runningHidden = k.__debug.isLoopRunning();
    k.__debug.simulateVisibility(false);
    const runningAgain = k.__debug.isLoopRunning();
    return { runningBefore, runningHidden, runningAgain };
  });
  log(perfOk.runningBefore && !perfOk.runningHidden && perfOk.runningAgain,
    `render loop pauses when backgrounded and resumes when foregrounded (${JSON.stringify(perfOk)})`);

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
