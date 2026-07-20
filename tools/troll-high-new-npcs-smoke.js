/* Troll High: the 5 new peer NPCs (design doc §21) smoke test — Pep,
   Marcus Vale, Wendell, Priya, Marnie. Verifies each one loads in the
   right zone, is reachable (not embedded in furniture), and that talking
   to them shows their actual dialogue. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { stubAuth, isExpectedAuthNoise, dismissOrientation } = require('./th-test-auth-stub');

const ROOT = path.join(__dirname, '..');
const PORT = 8975;
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
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');
  await dismissOrientation(page);

  // NPC proximity (nearNPC) is pure distance, not facing-tile like object
  // interactions — no "face the right way" step needed, just get close.
  async function checkNPC({ zoneId, entryDoorX, entryDir, holdMs, npcId, name, approachX, approachY }) {
    await page.evaluate((x) => window.__th.warpTo(x, 5), entryDoorX);
    await hold(page, entryDir, holdMs);
    await page.waitForFunction((id) => window.__th.zone.id === id, { timeout: 5000 }, zoneId);
    await new Promise(r => setTimeout(r, 400));

    const npcs = await page.evaluate(() => window.__th.npcs.map(n => ({ id: n.def.id, name: n.name, x: n.x, y: n.y })));
    const found = npcs.find(n => n.id === npcId);
    log(!!found && found.name === name, `${name} exists in ${zoneId} (${JSON.stringify(found)})`);

    await page.evaluate(([x, y]) => window.__th.warpTo(x, y), [approachX, approachY]);
    await new Promise(r => setTimeout(r, 150));
    const hint = await page.$eval('#th-hint', el => el.textContent);
    log(hint.includes(name), `hint offers to talk to ${name} from the approach tile: ${JSON.stringify(hint)}`);

    await page.keyboard.press('KeyE');
    await page.waitForSelector('.th-dialogue-card, #th-dialogue', { timeout: 3000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 100));
    const dialogueText = await page.evaluate(() => {
      const el = document.querySelector('.th-dialogue-card, #th-dialogue, .th-popup-card');
      return el ? el.textContent : null;
    });
    log(dialogueText && dialogueText.length > name.length, `talking to ${name} shows real dialogue text (${JSON.stringify(dialogueText)})`);
    await page.keyboard.press('KeyE'); // close dialogue

    // back to the hallway via that zone's own door
    const back = await page.evaluate((id) => {
      const d = window.__th.zone.doors[0];
      return { tx: d.x, ty: d.y };
    }, zoneId);
    await page.evaluate(([tx, ty]) => window.__th.warpTo(tx, ty + 2), [back.tx, back.ty]);
    await hold(page, 'ArrowUp', 700);
  }

  // Pep — Bus Loop (hallway-b, door x=110), stationary at (10,9)
  await page.evaluate(() => window.__th.warpTo(94, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  await checkNPC({
    zoneId: 'bus-loop', entryDoorX: 110, entryDir: 'ArrowUp', holdMs: 700,
    npcId: 'pep', name: 'Pep', approachX: 10, approachY: 10,
  });

  // Marcus Vale — Gym, stationary at (12,9)
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  await checkNPC({
    zoneId: 'gym', entryDoorX: 14, entryDir: 'ArrowUp', holdMs: 700,
    npcId: 'marcus-vale', name: 'Marcus Vale', approachX: 12, approachY: 10,
  });

  // Wendell — Office (alongside Principal Grimface), stationary at (7,8).
  // We're in hallway-b after the gym check — go back through hallway-b's
  // own door (x=2) to hallway-a first.
  await page.evaluate(() => window.__th.warpTo(2, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-a"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  await checkNPC({
    // Wendell sits at (7,8), the last interior row before Office's bottom
    // wall (h=10) — approach from row 7, one tile north, not row 9 (wall).
    zoneId: 'office', entryDoorX: 2, entryDir: 'ArrowUp', holdMs: 700,
    npcId: 'wendell', name: 'Wendell', approachX: 7, approachY: 7,
  });

  // Priya — Art Room, stationary at (8,9)
  await page.evaluate(() => window.__th.warpTo(94, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  await checkNPC({
    zoneId: 'art-room', entryDoorX: 38, entryDir: 'ArrowUp', holdMs: 700,
    npcId: 'priya', name: 'Priya', approachX: 8, approachY: 10,
  });

  // Marnie — Roof (secret zone via Gym's hidden ladder), stationary at (7,9)
  await page.evaluate(() => window.__th.warpTo(94, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "hallway-b"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => window.__th.warpTo(15, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "gym"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => window.__th.warpTo(12, 10));
  await hold(page, 'ArrowDown', 900);
  await page.waitForFunction('window.__th.zone.id === "roof"', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  const npcsOnRoof = await page.evaluate(() => window.__th.npcs.map(n => ({ id: n.def.id, name: n.name })));
  const marnie = npcsOnRoof.find(n => n.id === 'marnie');
  log(!!marnie && marnie.name === 'Marnie', `Marnie exists on the (secret) roof (${JSON.stringify(marnie)})`);
  await page.evaluate(() => window.__th.warpTo(7, 10));
  await new Promise(r => setTimeout(r, 150));
  const roofHint = await page.$eval('#th-hint', el => el.textContent);
  log(roofHint.includes('Marnie'), `hint offers to talk to Marnie on the roof: ${JSON.stringify(roofHint)}`);

  log(issues.length === 0, 'no console errors' + (issues.length ? ':\n  ' + issues.join('\n  ') : ''));
  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
