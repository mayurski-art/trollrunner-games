/* Troll High NPC smoke test: verifies the Phase 4 systems in isolation —
   pathfinding-driven patrol NPCs actually move over time, stationary NPCs
   don't, proximity dialogue cycles through lines, and the bell/chatter
   hooks fire. Run from anywhere after `npm i puppeteer-core`. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const PORT = 8940;
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
  const consoleIssues = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('frame-ancestors') && !m.text().includes('404')) consoleIssues.push(m.text()); });
  page.on('pageerror', e => consoleIssues.push('pageerror: ' + e.message));

  await page.goto(`http://localhost:${PORT}/troll-high.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__th && !window.__th.running', { timeout: 20000 });
  await page.click('#th-start');
  await page.waitForFunction('window.__th.running === true');

  // Hallway: Janitor Gus is a patrol NPC — confirm findPath actually built
  // a real multi-tile path and that his position changes over real time.
  const gus0 = await page.evaluate(() => {
    const n = window.__th.npcs.find(n => n.def.id === 'janitor-gus');
    return n && { pathLen: n.path.length, x: n.x, y: n.y };
  });
  log(gus0 && gus0.pathLen > 10, `Janitor Gus has a real BFS path across the hallway (${gus0 && gus0.pathLen} tiles)`);
  // Gus now pauses for PATROL_IDLE_SEC (6s) at each end of his route, so a
  // short sample can land entirely inside an idle window. 8s is longer
  // than any idle block, guaranteeing overlap with a moving phase.
  await new Promise(r => setTimeout(r, 8000));
  const gus1 = await page.evaluate(() => {
    const n = window.__th.npcs.find(n => n.def.id === 'janitor-gus');
    return { x: n.x, y: n.y };
  });
  log(Math.abs(gus1.x - gus0.x) > 1 || Math.abs(gus1.y - gus0.y) > 1, `Gus's position actually changes over time (${gus0.x.toFixed(0)},${gus0.y.toFixed(0)} -> ${gus1.x.toFixed(0)},${gus1.y.toFixed(0)})`);

  // Proximity dialogue: walk up to Gus and talk
  await page.evaluate(() => {
    const n = window.__th.npcs.find(n => n.def.id === 'janitor-gus');
    window.__th.warpTo(Math.round(n.x / 16), Math.round(n.y / 16) - 1);
  });
  await new Promise(r => setTimeout(r, 200));
  const hintText = await page.$eval('#th-hint', el => el.textContent);
  log(/Janitor Gus/i.test(hintText), `hint shows "Talk to Janitor Gus" when nearby: ${JSON.stringify(hintText)}`);
  // Dialogue now shows in a reliable DOM popup (like memory cards) rather
  // than an in-world canvas bubble that could get clipped or be unreadable
  // depending on camera zoom / where the NPC stands. E opens it, E again
  // closes it (movement is frozen while it's open) — so getting the next
  // line takes an open/close/open cycle, not just two presses.
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-dialogue', { timeout: 3000 });
  const dTitle1 = await page.$eval('#th-dialogue h3', el => el.textContent);
  const line1 = await page.$eval('#th-dialogue p', el => el.textContent);
  log(dTitle1 === 'Janitor Gus' && !!line1, `dialogue popup shows Janitor Gus's line: ${JSON.stringify(line1)}`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-dialogue")', { timeout: 3000 });
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#th-dialogue', { timeout: 3000 });
  const line2 = await page.$eval('#th-dialogue p', el => el.textContent);
  log(line1 !== line2, `next interaction cycles to a different line ("${line1}" -> "${line2}")`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction('!document.getElementById("th-dialogue")', { timeout: 3000 });

  // Stationary NPC in a room: enter Room 3B, confirm Ms. Chalke never moves
  await page.evaluate(() => window.__th.warpTo(15, 5));
  await hold(page, 'ArrowUp', 700);
  await page.waitForFunction('window.__th.zone.id === "classroom-3b"', { timeout: 5000 });
  const chalke0 = await page.evaluate(() => {
    const n = window.__th.npcs.find(n => n.def.id === 'ms-chalke');
    return n && { x: n.x, y: n.y };
  });
  await new Promise(r => setTimeout(r, 1500));
  const chalke1 = await page.evaluate(() => {
    const n = window.__th.npcs.find(n => n.def.id === 'ms-chalke');
    return { x: n.x, y: n.y };
  });
  log(chalke0 && chalke0.x === chalke1.x && chalke0.y === chalke1.y, 'stationary NPC (Ms. Chalke) holds a fixed position');

  // Bell: ringBell() is exposed and callable without throwing
  const bellOk = await page.evaluate(() => { try { window.__th.ringBell(); return true; } catch (e) { return false; } });
  log(bellOk, 'ambience.ringBell() fires without error');

  log(consoleIssues.length === 0, 'no unexpected console errors' + (consoleIssues.length ? ':\n  ' + consoleIssues.join('\n  ') : ''));

  console.log('\n' + results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILURES` : '\nALL PASS');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
