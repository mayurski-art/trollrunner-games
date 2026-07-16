/* Bridge Patrol — phase 1 core sim (placeholder art).
   You are the bridge troll: place troll towers beside the path, stop the
   normie waves, protect the toll chest at the bridge. Endless scaling. */
(function () {
  'use strict';

  // ---------- Board ----------
  const TILE = 40, COLS = 24, ROWS = 14;          // canvas: 960 x 560
  const W = COLS * TILE, H = ROWS * TILE;

  // Waypoints in tile coords (centers). Spawn walks in from off-screen left,
  // winds through the forest, crosses the ravine bridge, ends at the chest.
  const WAYPOINTS = [
    [-1, 3], [4, 3], [4, 9], [9, 9], [9, 3], [14, 3],
    [14, 10], [19, 10], [19, 6], [22.5, 6],
  ];
  const RAVINE_COLS = [20, 21];                   // vertical chasm strip
  const BRIDGE_ROW = 6;                           // planks where path crosses
  const CHEST = { x: 22.5 * TILE, y: 6 * TILE };

  // Build plots (tile coords) — hand-placed stumps beside the path.
  const PLOTS = [
    [2, 2], [2, 4], [3, 6], [5, 7], [6, 8], [7, 10], [8, 5], [10, 6],
    [11, 2], [12, 4], [13, 6], [15, 6], [16, 9], [17, 11], [18, 7], [18, 5],
  ];

  // ---------- Content ----------
  const TOWERS = {
    club: {
      name: 'Club Troll', badge: '🏏', hue: '#b4552d', cost: 50,
      desc: 'Cheap melee bonker',
      tiers: [
        { dmg: 8, range: 1.6, rate: 0.7, cost: 0 },
        { dmg: 15, range: 1.8, rate: 0.6, cost: 45 },
        { dmg: 28, range: 2.0, rate: 0.5, cost: 70 },
      ],
    },
    spit: {
      name: 'Spit Troll', badge: '💦', hue: '#34c759', cost: 75,
      desc: 'Long-range spitballs',
      tiers: [
        { dmg: 7, range: 3.4, rate: 0.9, cost: 0 },
        { dmg: 12, range: 3.8, rate: 0.8, cost: 60 },
        { dmg: 21, range: 4.2, rate: 0.65, cost: 95 },
      ],
    },
    cold: {
      name: 'Cold Shoulder', badge: '❄️', hue: '#5ac8fa', cost: 60,
      desc: 'Ignores normies so hard they slow down',
      tiers: [
        { slow: 0.35, range: 2.2, cost: 0 },
        { slow: 0.45, range: 2.5, cost: 50 },
        { slow: 0.55, range: 2.8, cost: 75 },
      ],
    },
  };

  const ENEMIES = {
    normie: { name: 'Normie', emoji: '🚶', hp: 20, speed: 1.1, bounty: 4, steal: 5, r: 11, hue: '#8e8e93' },
    jogger: { name: 'Jogger', emoji: '🏃', hp: 14, speed: 2.0, bounty: 5, steal: 4, r: 10, hue: '#ffd60a' },
    chad:   { name: 'Chad',   emoji: '💪', hp: 95, speed: 0.65, bounty: 14, steal: 12, r: 14, hue: '#ff453a' },
  };

  function buildWave(n) {
    const scale = Math.pow(1.13, n - 1);
    const spawns = [];
    let t = 0.5;
    const count = 6 + Math.floor(n * 1.6);
    for (let i = 0; i < count; i++) {
      let type = 'normie';
      if (n >= 5 && i % 5 === 4) type = 'chad';
      else if (n >= 3 && i % 3 === 2) type = 'jogger';
      t += type === 'jogger' ? 0.55 : 0.95;
      spawns.push({ type, at: t, scale });
    }
    // Late waves: a chad squad marches in at the end.
    if (n >= 8) {
      for (let j = 0; j < Math.floor((n - 6) / 2); j++) {
        t += 1.4;
        spawns.push({ type: 'chad', at: t, scale });
      }
    }
    return spawns;
  }
  const waveBonus = (n) => 15 + 5 * n;

  // ---------- Path geometry ----------
  const PTS = WAYPOINTS.map(([x, y]) => ({ x: x * TILE, y: y * TILE }));
  const SEGS = [];
  let PATH_LEN = 0;
  for (let i = 0; i < PTS.length - 1; i++) {
    const a = PTS[i], b = PTS[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    SEGS.push({ a, b, len, start: PATH_LEN });
    PATH_LEN += len;
  }
  function pointAt(d) {
    if (d <= 0) { return { x: PTS[0].x, y: PTS[0].y }; }
    for (const s of SEGS) {
      if (d <= s.start + s.len) {
        const t = (d - s.start) / s.len;
        return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
      }
    }
    return { x: CHEST.x, y: CHEST.y };
  }

  // Integer tiles covered by the path (for drawing the dirt).
  const pathTiles = new Set();
  for (let d = 0; d <= PATH_LEN; d += TILE / 4) {
    const p = pointAt(d);
    const cx = Math.round(p.x / TILE), cy = Math.round(p.y / TILE);
    if (cx >= 0 && cx < COLS) pathTiles.add(cx + ',' + cy);
  }

  // ---------- State ----------
  const G = {};
  function resetRun() {
    G.state = 'idle';            // idle (build) | wave | over
    G.coins = 120;
    G.chestMax = 100;
    G.chest = G.chestMax;
    G.wave = 0;                  // waves completed; next wave = G.wave + 1
    G.tolls = 0;                 // cumulative coins earned this run
    G.speed = 1;
    G.paused = false;
    G.towers = [];
    G.enemies = [];
    G.shots = [];
    G.fx = [];
    G.spawnQueue = [];
    G.waveT = 0;
    G.continueLeft = 1;
    G.selected = null;           // { kind:'plot'|'tower', idx }
    G.chestShake = 0;
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('bp-canvas'), ctx = canvas.getContext('2d');
  const stage = $('bp-stage');
  const hud = $('bp-hud');
  const hudCoins = $('hud-coins'), hudWave = $('hud-wave'), hudLeft = $('hud-left');
  const chestFill = $('chest-fill'), chestNum = $('chest-num');
  const btnWave = $('btn-wave'), btnSpeed = $('btn-speed'), btnPause = $('btn-pause');
  const buildMenu = $('build-menu'), towerPanel = $('tower-panel');
  const screenTitle = $('screen-title'), screenOver = $('screen-over');

  const BEST_KEY = 'bp_best_v1';
  function loadBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)) || null; } catch (e) { return null; }
  }
  function saveBest(wave, tolls) {
    const b = loadBest();
    if (!b || wave > b.wave || (wave === b.wave && tolls > b.tolls)) {
      try { localStorage.setItem(BEST_KEY, JSON.stringify({ wave, tolls })); } catch (e) { /* private mode */ }
    }
  }

  // ---------- Ground pre-render (placeholder art) ----------
  const ground = document.createElement('canvas');
  ground.width = W; ground.height = H;
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }
  function drawGround() {
    const g = ground.getContext('2d');
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = hash(x, y);
        if (RAVINE_COLS.includes(x)) {
          // Chasm — nearly black, faint depth banding.
          g.fillStyle = v > 0.5 ? '#0a0e13' : '#0d1218';
          g.fillRect(x * TILE, y * TILE, TILE, TILE);
          continue;
        }
        if (pathTiles.has(x + ',' + y)) {
          g.fillStyle = v > 0.66 ? '#93744b' : v > 0.33 ? '#8a6b42' : '#81633c';
        } else {
          g.fillStyle = v > 0.66 ? '#395733' : v > 0.33 ? '#33502f' : '#2e492c';
        }
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
        // Sparse placeholder foliage on grass.
        if (!pathTiles.has(x + ',' + y) && v > 0.9) {
          g.fillStyle = '#4a6b3a';
          g.beginPath();
          g.arc(x * TILE + TILE * 0.5, y * TILE + TILE * 0.5, 5, 0, 7);
          g.fill();
        }
      }
    }
    // Ravine rim highlight.
    g.fillStyle = 'rgba(120,160,120,0.25)';
    g.fillRect(RAVINE_COLS[0] * TILE - 2, 0, 2, H);
    g.fillRect((RAVINE_COLS[1] + 1) * TILE, 0, 2, H);
    // Bridge planks across the ravine.
    const bx = RAVINE_COLS[0] * TILE, by = (BRIDGE_ROW - 0.5) * TILE;
    g.fillStyle = '#9c6b3f';
    g.fillRect(bx - 4, by, 2 * TILE + 8, TILE);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (let i = 0; i < 8; i++) g.fillRect(bx - 4 + i * 11, by, 3, TILE);
    g.fillStyle = '#6f4a28';
    g.fillRect(bx - 4, by - 4, 2 * TILE + 8, 4);
    g.fillRect(bx - 4, by + TILE, 2 * TILE + 8, 4);
    // Build plots — tree stumps.
    for (const [px, py] of PLOTS) {
      const cx = px * TILE, cy = py * TILE;
      g.fillStyle = '#5d4126';
      g.beginPath(); g.arc(cx, cy, 15, 0, 7); g.fill();
      g.fillStyle = '#7a5733';
      g.beginPath(); g.arc(cx, cy, 11, 0, 7); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.beginPath(); g.arc(cx, cy, 6, 0, 7); g.stroke();
    }
  }
  drawGround();

  // ---------- Helpers ----------
  const fmt = (n) => Math.floor(n).toLocaleString('en-US');
  function towerStat(t) { return TOWERS[t.type].tiers[t.tier]; }
  function towerPos(t) { return { x: PLOTS[t.plot][0] * TILE, y: PLOTS[t.plot][1] * TILE }; }
  function invested(t) {
    const spec = TOWERS[t.type];
    let sum = spec.cost;
    for (let i = 1; i <= t.tier; i++) sum += spec.tiers[i].cost;
    return sum;
  }
  function earn(n, x, y) {
    G.coins += n;
    G.tolls += n;
    if (x !== undefined) addFx({ kind: 'text', str: '+' + n + ' 🪙', x, y, life: 0.9, color: '#ffd60a' });
  }
  function addFx(f) { f.t = 0; G.fx.push(f); }

  function waveComp(n) {
    const c = {};
    for (const s of buildWave(n)) c[s.type] = (c[s.type] || 0) + 1;
    return Object.keys(c).map((k) => ENEMIES[k].emoji + '×' + c[k]).join(' ');
  }

  // ---------- Sim ----------
  function startWave() {
    if (G.state !== 'idle') return;
    G.state = 'wave';
    G.waveT = 0;
    G.spawnQueue = buildWave(G.wave + 1);
    closePops();
    syncHud();
  }

  function update(dt) {
    if (G.state !== 'wave' && G.state !== 'idle') return;
    G.chestShake = Math.max(0, G.chestShake - dt * 3);

    // Spawning
    if (G.state === 'wave') {
      G.waveT += dt;
      while (G.spawnQueue.length && G.spawnQueue[0].at <= G.waveT) {
        const s = G.spawnQueue.shift();
        const spec = ENEMIES[s.type];
        G.enemies.push({
          type: s.type, d: 0,
          hp: spec.hp * s.scale, hpMax: spec.hp * s.scale,
          wobble: Math.random() * 7,
        });
      }
    }

    // Enemy movement (cold towers recompute slow every frame)
    const colds = G.towers.filter((t) => t.type === 'cold');
    for (const e of G.enemies) {
      const spec = ENEMIES[e.type];
      let slow = 0;
      const p = pointAt(e.d);
      for (const t of colds) {
        const st = towerStat(t), tp = towerPos(t);
        if (Math.hypot(p.x - tp.x, p.y - tp.y) <= st.range * TILE) slow = Math.max(slow, st.slow);
      }
      e.d += spec.speed * (1 - slow) * TILE * dt;
      e.slowed = slow > 0;
      e.wobble += dt * 10;
    }

    // Leaks — normies reaching the chest steal tolls.
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (e.d >= PATH_LEN) {
        G.chest = Math.max(0, G.chest - ENEMIES[e.type].steal);
        G.chestShake = 1;
        addFx({ kind: 'text', str: '−' + ENEMIES[e.type].steal + ' 💰', x: CHEST.x, y: CHEST.y - 26, life: 1, color: '#ff453a' });
        G.enemies.splice(i, 1);
        if (G.chest <= 0) { gameOver(); return; }
      }
    }

    // Towers attack
    for (const t of G.towers) {
      if (t.type === 'cold') { t.pulse = (t.pulse || 0) + dt; continue; }
      t.cd = (t.cd || 0) - dt;
      if (t.cd > 0) continue;
      const st = towerStat(t), tp = towerPos(t);
      // Target the enemy furthest along the path within range.
      let best = null;
      for (const e of G.enemies) {
        const p = pointAt(e.d);
        if (Math.hypot(p.x - tp.x, p.y - tp.y) <= st.range * TILE && (!best || e.d > best.d)) best = e;
      }
      if (!best) continue;
      t.cd = st.rate;
      t.bump = 1;
      if (t.type === 'club') {
        hit(best, st.dmg);
        const p = pointAt(best.d);
        addFx({ kind: 'text', str: '💥', x: p.x, y: p.y - 8, life: 0.35, color: '#fff' });
      } else {
        G.shots.push({ x: tp.x, y: tp.y - 14, target: best, dmg: st.dmg });
      }
    }

    // Spitball projectiles (homing)
    for (let i = G.shots.length - 1; i >= 0; i--) {
      const s = G.shots[i];
      if (!G.enemies.includes(s.target)) { G.shots.splice(i, 1); continue; }
      const p = pointAt(s.target.d);
      const dx = p.x - s.x, dy = p.y - s.y;
      const dist = Math.hypot(dx, dy);
      const step = 7.5 * TILE * dt;
      if (dist <= step) {
        hit(s.target, s.dmg);
        G.shots.splice(i, 1);
      } else {
        s.x += (dx / dist) * step;
        s.y += (dy / dist) * step;
      }
    }

    // Towers bump animation decay
    for (const t of G.towers) t.bump = Math.max(0, (t.bump || 0) - dt * 4);

    // FX aging
    for (let i = G.fx.length - 1; i >= 0; i--) {
      G.fx[i].t += dt;
      if (G.fx[i].t >= G.fx[i].life) G.fx.splice(i, 1);
    }

    // Wave cleared?
    if (G.state === 'wave' && !G.spawnQueue.length && !G.enemies.length) {
      G.wave += 1;
      const bonus = waveBonus(G.wave);
      earn(bonus, CHEST.x, CHEST.y - 44);
      addFx({ kind: 'text', str: 'Wave ' + G.wave + ' cleared!', x: W / 2, y: H / 2 - 40, life: 1.4, color: '#34c759', big: true });
      G.state = 'idle';
      syncHud();
    }
  }

  function hit(e, dmg) {
    e.hp -= dmg;
    if (e.hp <= 0) {
      const i = G.enemies.indexOf(e);
      if (i !== -1) {
        G.enemies.splice(i, 1);
        const p = pointAt(e.d);
        earn(ENEMIES[e.type].bounty, p.x, p.y - 14);
      }
    }
  }

  function gameOver() {
    G.state = 'over';
    closePops();
    const waveReached = G.wave + 1;
    saveBest(G.wave, G.tolls);
    $('over-stats').innerHTML =
      'The normies looted your chest on <b>wave ' + waveReached + '</b>.<br>' +
      'Tolls collected: <b>🪙 ' + fmt(G.tolls) + '</b>';
    $('btn-continue').hidden = G.continueLeft <= 0;
    screenOver.hidden = false;
    syncHud();
  }

  function useContinue() {
    if (G.continueLeft <= 0) return;
    G.continueLeft -= 1;
    G.chest = Math.floor(G.chestMax / 2);
    G.enemies = [];
    G.shots = [];
    G.spawnQueue = [];
    G.state = 'idle';
    screenOver.hidden = true;
    addFx({ kind: 'text', str: 'The troll regroups… 🧌', x: W / 2, y: H / 2 - 40, life: 1.6, color: '#5ac8fa', big: true });
    syncHud();
  }

  // ---------- HUD ----------
  function syncHud() {
    hudCoins.textContent = '🪙 ' + fmt(G.coins);
    chestFill.style.width = (G.chest / G.chestMax * 100) + '%';
    chestFill.style.background = G.chest / G.chestMax > 0.35 ? '#ffd60a' : '#ff453a';
    chestNum.textContent = fmt(G.chest);
    if (G.state === 'wave') {
      hudWave.textContent = 'Wave ' + (G.wave + 1);
      hudLeft.textContent = (G.enemies.length + G.spawnQueue.length) + ' left';
      btnWave.disabled = true;
      btnWave.textContent = 'Wave ' + (G.wave + 1) + ' incoming…';
    } else {
      hudWave.textContent = G.wave === 0 ? 'Get ready' : 'Wave ' + G.wave + ' ✓';
      hudLeft.textContent = 'next: ' + waveComp(G.wave + 1);
      btnWave.disabled = G.state !== 'idle';
      btnWave.textContent = 'Start Wave ' + (G.wave + 1) + ' ▶';
    }
  }

  // ---------- Popovers ----------
  function closePops() {
    const focused = document.activeElement;
    if (focused && (buildMenu.contains(focused) || towerPanel.contains(focused))) focused.blur();
    buildMenu.hidden = true;
    towerPanel.hidden = true;
    G.selected = null;
  }

  function placePop(pop, px, py) {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / W, sy = rect.height / H;
    pop.hidden = false;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = px * sx + 20, top = py * sy - ph / 2;
    if (left + pw > rect.width - 6) left = px * sx - pw - 20;
    top = Math.max(6, Math.min(rect.height - ph - 6, top));
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function openBuildMenu(plotIdx) {
    closePops();
    G.selected = { kind: 'plot', idx: plotIdx };
    const [px, py] = PLOTS[plotIdx];
    buildMenu.innerHTML = '<h3>Build tower</h3>';
    for (const key of Object.keys(TOWERS)) {
      const spec = TOWERS[key];
      const b = document.createElement('button');
      b.type = 'button';
      b.disabled = G.coins < spec.cost;
      b.innerHTML = '<span>🧌 ' + spec.name + '<br><span class="pop-sub">' + spec.desc +
        '</span></span><span class="cost">🪙 ' + spec.cost + '</span>';
      b.addEventListener('click', () => {
        if (G.coins < spec.cost) return;
        G.coins -= spec.cost;
        G.towers.push({ type: key, plot: plotIdx, tier: 0, cd: 0, bump: 0 });
        closePops();
        syncHud();
      });
      buildMenu.appendChild(b);
    }
    placePop(buildMenu, px * TILE, py * TILE);
    buildMenu.querySelector('button:not(:disabled)')?.focus();
  }

  function openTowerPanel(towerIdx) {
    closePops();
    G.selected = { kind: 'tower', idx: towerIdx };
    const t = G.towers[towerIdx];
    const spec = TOWERS[t.type];
    const tp = towerPos(t);
    const tierLabel = ['I', 'II', 'III'][t.tier];
    towerPanel.innerHTML = '<h3>🧌 ' + spec.name + ' · Tier ' + tierLabel + '</h3>' +
      '<span class="pop-sub">' + spec.desc + '</span>';
    if (t.tier < 2) {
      const next = spec.tiers[t.tier + 1];
      const up = document.createElement('button');
      up.type = 'button';
      up.disabled = G.coins < next.cost;
      up.innerHTML = '<span>Upgrade to ' + ['I', 'II', 'III'][t.tier + 1] +
        '</span><span class="cost">🪙 ' + next.cost + '</span>';
      up.addEventListener('click', () => {
        if (G.coins < next.cost) return;
        G.coins -= next.cost;
        t.tier += 1;
        openTowerPanel(towerIdx);
        syncHud();
      });
      towerPanel.appendChild(up);
    }
    const refund = Math.floor(invested(t) * 0.7);
    const sell = document.createElement('button');
    sell.type = 'button';
    sell.className = 'sell';
    sell.innerHTML = '<span>Sell</span><span class="cost">+🪙 ' + refund + '</span>';
    sell.addEventListener('click', () => {
      G.coins += refund;
      G.towers.splice(towerIdx, 1);
      closePops();
      syncHud();
    });
    towerPanel.appendChild(sell);
    placePop(towerPanel, tp.x, tp.y);
    towerPanel.querySelector('button:not(:disabled)')?.focus();
  }

  // ---------- Input ----------
  canvas.addEventListener('pointerdown', (ev) => {
    if (G.state === 'over') return;
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (W / rect.width);
    const y = (ev.clientY - rect.top) * (H / rect.height);
    // Placed tower first…
    for (let i = 0; i < G.towers.length; i++) {
      const tp = towerPos(G.towers[i]);
      if (Math.hypot(x - tp.x, y - tp.y) <= 20) { openTowerPanel(i); return; }
    }
    // …then empty plots.
    for (let i = 0; i < PLOTS.length; i++) {
      if (G.towers.some((t) => t.plot === i)) continue;
      if (Math.hypot(x - PLOTS[i][0] * TILE, y - PLOTS[i][1] * TILE) <= 22) { openBuildMenu(i); return; }
    }
    closePops();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closePops();
    if (G.state === 'over' || !screenTitle.hidden) return;
    const onControl = ev.target.closest && ev.target.closest('button, input, textarea, select');
    if (ev.key === ' ' && !onControl) { ev.preventDefault(); startWave(); }
    if (ev.key === 'p' || ev.key === 'P') togglePause();
  });

  btnWave.addEventListener('click', startWave);
  btnSpeed.addEventListener('click', () => {
    G.speed = G.speed === 1 ? 2 : 1;
    btnSpeed.textContent = G.speed + '×';
    btnSpeed.setAttribute('aria-pressed', String(G.speed === 2));
  });
  function togglePause() {
    G.paused = !G.paused;
    btnPause.setAttribute('aria-pressed', String(G.paused));
    btnPause.textContent = G.paused ? '▶' : '⏸';
  }
  btnPause.addEventListener('click', togglePause);

  $('btn-start').addEventListener('click', () => {
    screenTitle.hidden = true;
    hud.hidden = false;
    resetRun();
    syncHud();
  });
  $('btn-continue').addEventListener('click', useContinue);
  $('btn-retry').addEventListener('click', () => {
    screenOver.hidden = true;
    resetRun();
    syncHud();
  });

  // ---------- Render ----------
  function emoji(str, x, y, size) {
    ctx.font = size + 'px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }

  function render(now) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(ground, 0, 0);

    // Spawn arrow
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    emoji('➡️', 14, 3 * TILE, 20);

    // Selected range ring
    if (G.selected) {
      let cx, cy, range = null;
      if (G.selected.kind === 'tower' && G.towers[G.selected.idx]) {
        const t = G.towers[G.selected.idx];
        const tp = towerPos(t);
        cx = tp.x; cy = tp.y; range = towerStat(t).range * TILE;
      } else if (G.selected.kind === 'plot') {
        cx = PLOTS[G.selected.idx][0] * TILE; cy = PLOTS[G.selected.idx][1] * TILE;
      }
      if (cx !== undefined) {
        if (range) {
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.beginPath(); ctx.arc(cx, cy, range, 0, 7); ctx.fill(); ctx.stroke();
        }
        ctx.strokeStyle = '#ffd60a';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, 20 + Math.sin(now / 150) * 2, 0, 7); ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    // Chest
    const shake = G.chestShake > 0 ? Math.sin(now / 25) * 3 * G.chestShake : 0;
    emoji('💰', CHEST.x + shake, CHEST.y - 4, 30);

    // Towers
    for (const t of G.towers) {
      const spec = TOWERS[t.type];
      const tp = towerPos(t);
      const s = 1 + (t.bump || 0) * 0.25;
      // Cold aura pulse
      if (t.type === 'cold') {
        const r = towerStat(t).range * TILE;
        const ph = ((t.pulse || 0) % 1.6) / 1.6;
        ctx.strokeStyle = 'rgba(90,200,250,' + (0.35 * (1 - ph)) + ')';
        ctx.beginPath(); ctx.arc(tp.x, tp.y, r * ph, 0, 7); ctx.stroke();
      }
      ctx.fillStyle = spec.hue;
      ctx.beginPath(); ctx.arc(tp.x, tp.y, 16, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.arc(tp.x, tp.y, 16, 0, 7); ctx.stroke();
      emoji('🧌', tp.x, tp.y - 6, Math.round(24 * s));
      emoji(spec.badge, tp.x + 12, tp.y + 10, 12);
      // Tier pips
      ctx.fillStyle = '#ffd60a';
      for (let i = 0; i < t.tier; i++) {
        ctx.beginPath(); ctx.arc(tp.x - 10 + i * 8, tp.y + 14, 2.5, 0, 7); ctx.fill();
      }
    }

    // Enemies
    for (const e of G.enemies) {
      const spec = ENEMIES[e.type];
      const p = pointAt(e.d);
      const bob = Math.sin(e.wobble) * 2;
      ctx.fillStyle = spec.hue;
      ctx.beginPath(); ctx.arc(p.x, p.y + bob, spec.r, 0, 7); ctx.fill();
      if (e.slowed) {
        ctx.strokeStyle = 'rgba(90,200,250,0.9)';
        ctx.beginPath(); ctx.arc(p.x, p.y + bob, spec.r + 2, 0, 7); ctx.stroke();
      }
      emoji(spec.emoji, p.x, p.y + bob - 2, spec.r * 1.6);
      // HP bar once damaged
      if (e.hp < e.hpMax) {
        const w = 24;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(p.x - w / 2, p.y + bob - spec.r - 9, w, 4);
        ctx.fillStyle = '#34c759';
        ctx.fillRect(p.x - w / 2, p.y + bob - spec.r - 9, w * Math.max(0, e.hp / e.hpMax), 4);
      }
    }

    // Spitballs
    ctx.fillStyle = '#7be382';
    for (const s of G.shots) {
      ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, 7); ctx.fill();
    }

    // FX
    for (const f of G.fx) {
      const k = f.t / f.life;
      ctx.globalAlpha = 1 - k;
      if (f.kind === 'text') {
        ctx.fillStyle = f.color;
        ctx.font = (f.big ? '900 26px' : '700 14px') + ' "DM Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.str, f.x, f.y - k * 24);
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const raw = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!G.paused && (G.state === 'idle' || G.state === 'wave')) {
      update(raw * G.speed);
      if (G.state === 'wave') syncHud();     // live "N left" counter
    }
    render(now);
    requestAnimationFrame(frame);
  }

  // ---------- Boot ----------
  // Debug handle for balancing + automated smoke tests.
  window.__bp = { G, startWave, gameOver, buildWave };
  resetRun();
  G.state = 'title';
  const best = loadBest();
  if (best) {
    const el = $('title-best');
    el.hidden = false;
    el.textContent = 'Best patrol: wave ' + (best.wave + 1) + ' · 🪙 ' + fmt(best.tolls);
  }
  requestAnimationFrame(frame);
})();
