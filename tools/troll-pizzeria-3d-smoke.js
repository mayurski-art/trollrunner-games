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

  // Raw raycast hit-test (no ticket needed yet — just confirms the pie
  // surface is where the camera is looking once docked).
  const rayOk = await page.evaluate(() => window.TrollKitchen3D.__debug.paintAtNDC(0, 0));
  log(!!rayOk, `build pie raycast hits dead-center once docked (hit=${JSON.stringify(rayOk)})`);
  await page.evaluate(() => window.TrollKitchen3D.__debug.interact()); // step back before the full loop below

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

  // --- Full demo loop — order -> build -> bake -> cut -> serve, now driven
  // through the real handler-based API (window.__demo is the reference
  // driver from the preview page, standing in for game.js). ---

  const lobbyBefore = await page.evaluate(() => window.__demo.getLobbyCount());
  log(lobbyBefore > 0, `lobby starts with demo customers waiting (${lobbyBefore})`);

  // Order: dock at the counter, take the order.
  const orderOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D;
    const order = k.__debug.stations.find(s => s.id === 'order');
    k.__debug.setPlayer(order.triggerX, order.triggerZ);
    k.__debug.tick(1 / 60);
    k.__debug.interact();
    const took = window.__demo.action();
    return { took, ticket: window.__demo.getTicket(), lobbyAfter: window.__demo.getLobbyCount() };
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
    for (let i = 0; i < 15; i++) window.__demo.paintAtNDC(0, 0, 'sauce');
    window.__demo.placeAtNDC(0.15, 0, 'pepperoni');
    const beforeSend = window.__demo.getTicket();     // snapshot before it leaves "in hand"
    const sent = window.__demo.action();
    // sendToOven nils the "in hand" ticket (it now lives in the oven, not
    // at the build table) — same as a real ticket changing station, so
    // the carried-over state is verified via the pre-send snapshot + the
    // oven actually showing a pie, not via getTicket() after the fact.
    return { beforeSend, sent, afterSend: window.__demo.getTicket(), oven0: window.TrollKitchen3D.__debug.getOvenSlot(0) };
  });
  log(buildOk.sent && buildOk.afterSend === null && buildOk.oven0.hasPie &&
    buildOk.beforeSend.sauce > 0.1 && buildOk.beforeSend.placed.length === 1,
    `sending the built pie to the oven carries the painted/placed state along (pre-send sauce=${(buildOk.beforeSend.sauce * 100).toFixed(0)}%, oven has pie=${buildOk.oven0.hasPie})`);
  await page.evaluate(() => window.TrollKitchen3D.__debug.interact()); // step back

  // Bake: doneness now rises via the demo driver's own real-time rAF loop
  // (BAKE_SECONDS=10), not kitchen3d's dt-driven tick — matching how
  // game.js will own its own bake timer exactly like it did with the old
  // Pizza Cam. Real wait, same reasoning as the grin-hunt expiry below.
  await new Promise(r => setTimeout(r, 3000));
  const bakeOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D;
    const donenessMidbake = window.__demo.getBakingTicket().doneness;
    const bake = k.__debug.stations.find(s => s.id === 'bake');
    k.__debug.setPlayer(bake.triggerX, bake.triggerZ);
    k.__debug.tick(1 / 60);
    k.__debug.interact();
    const pulled = window.__demo.action();
    return { donenessMidbake, pulled, ticket: window.__demo.getTicket() };
  });
  log(bakeOk.donenessMidbake > 0 && bakeOk.pulled && bakeOk.ticket?.stage === 'ready',
    `doneness rises while baking (${(bakeOk.donenessMidbake * 100).toFixed(0)}%) and pulling moves the ticket to "ready"`);
  await page.evaluate(() => window.TrollKitchen3D.__debug.interact()); // step back

  // Cut: dock at the cutting table, load, sweep, commit 4 cuts, then serve.
  // Sweep-angle progression is likewise the driver's own rAF loop now, so
  // this needs a real wait per cut instead of manual ticks.
  await page.evaluate(() => {
    const k = window.TrollKitchen3D;
    const cut = k.__debug.stations.find(s => s.id === 'cut');
    k.__debug.setPlayer(cut.triggerX, cut.triggerZ);
    k.__debug.tick(1 / 60);
    k.__debug.interact();
  });
  const loaded = await page.evaluate(() => window.__demo.action());       // ready -> cutting
  const pieVisible = await page.evaluate(() => window.TrollKitchen3D.__debug.isCutPieVisible());
  await page.evaluate(() => window.__demo.action());                     // arms the sweep
  for (let n = 0; n < 4; n++) {
    await new Promise(r => setTimeout(r, 350));                          // let the sweeper move
    await page.evaluate(() => window.__demo.action());                   // commit a cut
  }
  const ticketAfterCuts = await page.evaluate(() => window.__demo.getTicket());
  const served = await page.evaluate(() => window.__demo.action());      // now serves
  log(loaded && pieVisible && ticketAfterCuts.cutAngles.length === 4 && served,
    `cutting table: loads the pulled pie (visible=${pieVisible}), takes 4 cuts, and serves`);

  // Poll rather than a fixed sleep — the serve-spin tween duration is a
  // rendering-feel constant, not a contract; don't let smoke-test timing
  // race it.
  let afterServe = 'pending';
  for (let i = 0; i < 20 && afterServe !== null; i++) {
    await new Promise(r => setTimeout(r, 150));
    afterServe = await page.evaluate(() => window.__demo.getTicket());
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
    return { activeAfterSpawn, pos, caught, tally: window.__demo.getGrinTally() };
  });
  log(grinOk.activeAfterSpawn && !!grinOk.pos, `Grin Hunt spawns somewhere in the room (${JSON.stringify(grinOk.pos)})`);

  // Expiry is wall-clock based (like the dock-camera tween), not dt-driven,
  // so this needs a real wait — the module's own rAF loop (already running
  // since mount()) ticks it down in the background.
  await new Promise(r => setTimeout(r, 2900));
  const grinMissOk = await page.evaluate(() => {
    const k = window.TrollKitchen3D;
    return { active: k.trollEvent.isGrinHuntActive(), tally: window.__demo.getGrinTally() };
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
    return { caught, pos, tally: window.__demo.getGrinTally() };
  });
  log(grinCatchOk.caught && grinCatchOk.tally.caught >= 1, `aiming at and clicking the grin catches it (tally=${JSON.stringify(grinCatchOk.tally)})`);

  const rushOk = await page.evaluate(() => {
    const before = window.__demo.getLobbyCount();
    const added = window.__demo.rush();
    return { before, added, after: window.__demo.getLobbyCount() };
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
