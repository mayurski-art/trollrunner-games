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
    cannon: {
      name: 'Meme Cannon', badge: '💣', hue: '#af52de', cost: 110,
      desc: 'Lobs giant troll heads, splash damage',
      tiers: [
        { dmg: 18, range: 2.8, rate: 2.2, splash: 1.2, cost: 0 },
        { dmg: 30, range: 3.2, rate: 2.0, splash: 1.35, cost: 90 },
        { dmg: 50, range: 3.6, rate: 1.8, splash: 1.5, cost: 140 },
      ],
    },
    booth: {
      name: 'Toll Booth', badge: '🎟️', hue: '#ffd60a', cost: 70,
      desc: 'No damage — passing normies pay up',
      tiers: [
        { toll: 3, range: 1.6, cost: 0 },
        { toll: 5, range: 1.8, cost: 55 },
        { toll: 8, range: 2.0, cost: 85 },
      ],
    },
    guard: {
      name: 'Bridge Guard', badge: '🛡️', hue: '#8e8e93', cost: 65,
      desc: 'Stands ON the path and holds the line',
      tiers: [
        { hp: 150, dmg: 4, cost: 0 },
        { hp: 280, dmg: 8, cost: 50 },
        { hp: 450, dmg: 14, cost: 80 },
      ],
    },
  };
  const MENU_TOWERS = ['club', 'spit', 'cold', 'cannon', 'booth'];  // plot menu; guard is spot-only

  const ENEMIES = {
    normie: { name: 'Normie', emoji: '🚶', hp: 20, speed: 1.1, bounty: 4, steal: 5, r: 11, hue: '#8e8e93', dps: 6 },
    jogger: { name: 'Jogger', emoji: '🏃', hp: 14, speed: 2.0, bounty: 5, steal: 4, r: 10, hue: '#ffd60a', dps: 5 },
    chad:   { name: 'Chad',   emoji: '💪', hp: 95, speed: 0.65, bounty: 14, steal: 12, r: 14, hue: '#ff453a', dps: 20 },
    karen:  { name: 'Karen',  emoji: '💁‍♀️', hp: 40, speed: 0.9, bounty: 10, steal: 8, r: 12, hue: '#ff9500', dps: 6, stuns: true },
    wojak:  { name: 'Wojak',  emoji: '😐', hp: 8, speed: 1.3, bounty: 2, steal: 2, r: 8, hue: '#c7c7cc', dps: 3 },
    bro:    { name: 'Crypto Bro', emoji: '🤑', hp: 30, speed: 1.0, bounty: 20, steal: 8, r: 11, hue: '#30d158', dps: 8, sprints: true },
    manager:  { name: 'The Manager', emoji: '👔', hp: 550, speed: 0.5, bounty: 100, steal: 25, r: 17, hue: '#5e5ce6', dps: 35, boss: true, aura: 2.2 },
    gigachad: { name: 'Giga Chad', emoji: '🗿', hp: 1300, speed: 0.45, bounty: 150, steal: 30, r: 19, hue: '#a2845e', dps: 0, boss: true, smashes: true },
    landlord: { name: 'The Landlord', emoji: '🎩', hp: 1000, speed: 0.55, bounty: 200, steal: 40, r: 18, hue: '#ffd60a', dps: 45, boss: true },
  };

  function buildWave(n) {
    const scale = Math.pow(1.13, n - 1);
    const spawns = [];
    let t = 0.5;
    const add = (type, gap) => { t += gap; spawns.push({ type, at: t, scale }); };
    const boss = n % 10 === 0;
    const count = boss ? 4 + Math.floor(n * 0.8) : 6 + Math.floor(n * 1.6);
    for (let i = 0; i < count; i++) {
      let type = 'normie';
      if (n >= 7 && i % 6 === 3) type = 'karen';
      else if (n >= 6 && i % 7 === 5) type = 'bro';
      else if (n >= 5 && i % 5 === 4) type = 'chad';
      else if (n >= 3 && i % 3 === 2) type = 'jogger';
      add(type, type === 'jogger' ? 0.55 : 0.95);
    }
    // Wojak hordes: packs of 8 weaklings shuffling in shoulder to shoulder.
    if (n >= 9) {
      const packs = n >= 15 ? 2 : 1;
      for (let p = 0; p < packs; p++) {
        t += 1.6;
        for (let j = 0; j < 8; j++) add('wojak', 0.22);
      }
    }
    // Late waves: a chad squad marches in at the end.
    if (n >= 8 && !boss) {
      for (let j = 0; j < Math.floor((n - 6) / 2); j++) add('chad', 1.4);
    }
    // Every 10th wave a boss brings up the rear.
    if (boss) {
      t += 2.5;
      const type = n === 10 ? 'manager' : n === 20 ? 'gigachad' : 'landlord';
      spawns.push({ type, at: t, scale });
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

  // Guard spots: reinforced grates ON the path where a Bridge Guard can
  // stand. d = distance along the path, precomputed by scanning.
  const GUARD_SPOTS = [[2, 3], [6, 9], [12, 3], [17, 10], [19, 7]].map(([gx, gy]) => {
    const pos = { x: gx * TILE, y: gy * TILE };
    let bestD = 0, bestDist = 1e9;
    for (let d = 0; d <= PATH_LEN; d += 4) {
      const p = pointAt(d);
      const dist = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (dist < bestDist) { bestDist = dist; bestD = d; }
    }
    return { x: pos.x, y: pos.y, d: bestD };
  });

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
    G.simT = 0;                  // running sim clock (stun timers)
    G.continueLeft = 1;
    G.selected = null;           // { kind:'plot'|'tower'|'spot', idx }
    G.chestShake = 0;
    G.towerSeq = 0;
    G.bossesSlain = 0;
    G.stunCount = 0;             // Karen/Manager stuns landed (debug + stats)
    G.spawnLog = {};             // type -> count spawned this run (balancing)
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

  // ---------- Art (PixelLab renders; emoji/procedural fallback if unloaded) ----------
  const ART_ROOT = 'assets/games/bridge-patrol/art/';
  function loadArt(src) {
    const o = { img: new Image(), ready: false };
    o.img.onload = () => { o.ready = true; onArtLoaded(); };
    o.img.src = ART_ROOT + src;
    return o;
  }
  const TOWER_ART = {
    club: loadArt('towers/club.png'), spit: loadArt('towers/spit.png'),
    cold: loadArt('towers/cold.png'), cannon: loadArt('towers/cannon.png'),
    booth: loadArt('towers/booth.png'), guard: loadArt('towers/guard.png'),
  };
  const ENEMY_ART = {
    normie: loadArt('enemies/normie.png'), jogger: loadArt('enemies/jogger.png'),
    karen: loadArt('enemies/karen.png'), bro: loadArt('enemies/bro.png'),
    chad: loadArt('enemies/chad.png'), wojak: loadArt('enemies/wojak.png'),
    manager: loadArt('enemies/manager.png'), gigachad: loadArt('enemies/gigachad.png'),
    landlord: loadArt('enemies/landlord.png'),
  };
  const PROP_ART = { bridge: loadArt('props/bridge.png'), chest: loadArt('props/chest.png'), stump: loadArt('props/stump.png') };
  const TILESET = loadArt('tiles/dirt-grass-wang.png');
  // Wang tile lookup: 32px source tiles keyed by NE+NW+SE+SW corner terrain
  // (L=lower/dirt, U=upper/grass). Positions come from the generated tileset metadata.
  const WANG = {
    UUUL: { x: 0, y: 0 }, LULU: { x: 32, y: 0 }, ULLL: { x: 64, y: 0 }, UULL: { x: 96, y: 0 },
    ULLU: { x: 0, y: 32 }, LULL: { x: 32, y: 32 }, LLLL: { x: 64, y: 32 }, LLUL: { x: 96, y: 32 },
    LUUU: { x: 0, y: 64 }, LLUU: { x: 32, y: 64 }, LLLU: { x: 64, y: 64 }, ULUL: { x: 96, y: 64 },
    UUUU: { x: 0, y: 96 }, UULU: { x: 32, y: 96 }, LUUL: { x: 64, y: 96 }, ULUU: { x: 96, y: 96 },
  };
  function onArtLoaded() { if (TILESET.ready) drawGround(); }

  // ---------- Ground pre-render ----------
  const ground = document.createElement('canvas');
  ground.width = W; ground.height = H;
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }
  function isPathVertex(vx, vy) {
    return pathTiles.has((vx - 1) + ',' + (vy - 1)) || pathTiles.has(vx + ',' + (vy - 1)) ||
      pathTiles.has((vx - 1) + ',' + vy) || pathTiles.has(vx + ',' + vy);
  }
  function drawGround() {
    const g = ground.getContext('2d');
    const useWang = TILESET.ready;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = hash(x, y);
        if (RAVINE_COLS.includes(x)) {
          // Chasm — nearly black, faint depth banding.
          g.fillStyle = v > 0.5 ? '#0a0e13' : '#0d1218';
          g.fillRect(x * TILE, y * TILE, TILE, TILE);
          continue;
        }
        if (useWang) {
          const code = (vx, vy) => (isPathVertex(vx, vy) ? 'L' : 'U');
          const key = code(x + 1, y) + code(x, y) + code(x + 1, y + 1) + code(x, y + 1);
          const tile = WANG[key] || WANG.UUUU;
          g.drawImage(TILESET.img, tile.x, tile.y, 32, 32, x * TILE, y * TILE, TILE, TILE);
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
    // Bridge crossing the ravine.
    const bx = RAVINE_COLS[0] * TILE, by = (BRIDGE_ROW - 0.5) * TILE;
    if (PROP_ART.bridge.ready) {
      g.drawImage(PROP_ART.bridge.img, bx - 4, by, 2 * TILE + 8, TILE);
    } else {
      g.fillStyle = '#9c6b3f';
      g.fillRect(bx - 4, by, 2 * TILE + 8, TILE);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      for (let i = 0; i < 8; i++) g.fillRect(bx - 4 + i * 11, by, 3, TILE);
      g.fillStyle = '#6f4a28';
      g.fillRect(bx - 4, by - 4, 2 * TILE + 8, 4);
      g.fillRect(bx - 4, by + TILE, 2 * TILE + 8, 4);
    }
    // Build plots — tree stumps.
    for (const [px, py] of PLOTS) {
      const cx = px * TILE, cy = py * TILE;
      if (PROP_ART.stump.ready) {
        g.drawImage(PROP_ART.stump.img, cx - 20, cy - 20, 40, 40);
        continue;
      }
      g.fillStyle = '#5d4126';
      g.beginPath(); g.arc(cx, cy, 15, 0, 7); g.fill();
      g.fillStyle = '#7a5733';
      g.beginPath(); g.arc(cx, cy, 11, 0, 7); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.beginPath(); g.arc(cx, cy, 6, 0, 7); g.stroke();
    }
    // Guard posts — reinforced grates set into the path.
    for (const s of GUARD_SPOTS) {
      g.fillStyle = 'rgba(40, 32, 22, 0.9)';
      g.fillRect(s.x - 14, s.y - 14, 28, 28);
      g.strokeStyle = '#a08054';
      g.strokeRect(s.x - 14, s.y - 14, 28, 28);
      g.fillStyle = '#6f5a38';
      for (let i = -1; i <= 1; i++) g.fillRect(s.x - 12, s.y + i * 8 - 2, 24, 4);
    }
  }
  drawGround();

  // ---------- Helpers ----------
  const fmt = (n) => Math.floor(n).toLocaleString('en-US');
  function towerStat(t) { return TOWERS[t.type].tiers[t.tier]; }
  function towerPos(t) {
    if (t.spot !== undefined) return { x: GUARD_SPOTS[t.spot].x, y: GUARD_SPOTS[t.spot].y };
    return { x: PLOTS[t.plot][0] * TILE, y: PLOTS[t.plot][1] * TILE };
  }
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

  const isStunned = (t) => (t.stunnedUntil || 0) > G.simT;
  function stun(t, secs) {
    if (!isStunned(t)) G.stunCount += 1;
    t.stunnedUntil = Math.max(t.stunnedUntil || 0, G.simT + secs);
  }
  function killGuard(t, str) {
    const i = G.towers.indexOf(t);
    if (i === -1) return;
    G.towers.splice(i, 1);
    const gp = towerPos(t);
    addFx({ kind: 'text', str, x: gp.x, y: gp.y - 16, life: 1.2, color: '#ff453a' });
    if (G.selected && G.selected.kind === 'tower') closePops();
  }

  function update(dt) {
    if (G.state !== 'wave' && G.state !== 'idle') return;
    G.simT += dt;
    G.chestShake = Math.max(0, G.chestShake - dt * 3);

    // Spawning
    if (G.state === 'wave') {
      G.waveT += dt;
      while (G.spawnQueue.length && G.spawnQueue[0].at <= G.waveT) {
        const s = G.spawnQueue.shift();
        const spec = ENEMIES[s.type];
        G.spawnLog[s.type] = (G.spawnLog[s.type] || 0) + 1;
        G.enemies.push({
          type: s.type, d: 0,
          hp: spec.hp * s.scale, hpMax: spec.hp * s.scale,
          wobble: Math.random() * 7,
          paid: {},              // booth ids already tolled
          abT: 2,                // Karen: seconds until next manager call
          sprintT: Math.random() * 2.4,
        });
        if (spec.boss) {
          addFx({ kind: 'text', str: '⚠️ ' + spec.name + ' incoming!', x: W / 2, y: H / 2 - 60, life: 2, color: '#ff453a', big: true });
        }
      }
    }

    // Enemy movement + abilities (cold slow, guard blocks, karen stuns,
    // manager aura, bro sprints, booth tolls — all recomputed per frame)
    const colds = G.towers.filter((t) => t.type === 'cold' && !isStunned(t));
    const booths = G.towers.filter((t) => t.type === 'booth' && !isStunned(t));
    const guards = G.towers.filter((t) => t.type === 'guard');
    for (const e of G.enemies) {
      const spec = ENEMIES[e.type];
      const p = pointAt(e.d);
      let slow = 0;
      for (const t of colds) {
        const st = towerStat(t), tp = towerPos(t);
        if (Math.hypot(p.x - tp.x, p.y - tp.y) <= st.range * TILE) slow = Math.max(slow, st.slow);
      }
      // Toll booths shake down everyone walking past (once per booth).
      for (const t of booths) {
        const st = towerStat(t), tp = towerPos(t);
        if (!e.paid[t.id] && Math.hypot(p.x - tp.x, p.y - tp.y) <= st.range * TILE) {
          e.paid[t.id] = 1;
          earn(st.toll, p.x, p.y - 18);
        }
      }
      // Karen periodically calls the manager on the nearest tower.
      if (spec.stuns) {
        e.abT -= dt;
        if (e.abT <= 0) {
          e.abT = 6;
          let best = null, bestDist = 4 * TILE;
          for (const t of G.towers) {
            const tp = towerPos(t);
            const dist = Math.hypot(p.x - tp.x, p.y - tp.y);
            if (dist < bestDist) { best = t; bestDist = dist; }
          }
          if (best) {
            stun(best, 2.5);
            addFx({ kind: 'text', str: '📢 MANAGER!!', x: p.x, y: p.y - 24, life: 1, color: '#ff9500' });
          }
        }
      }
      // The Manager's aura disables every tower he lumbers past.
      if (spec.aura) {
        for (const t of G.towers) {
          const tp = towerPos(t);
          if (Math.hypot(p.x - tp.x, p.y - tp.y) <= spec.aura * TILE) stun(t, 0.25);
        }
      }
      // Crypto bros sprint in erratic bursts.
      let mult = 1;
      if (spec.sprints) {
        e.sprintT += dt;
        mult = (e.sprintT % 2.4) < 0.7 ? 2.4 : 0.8;
      }
      let move = spec.speed * (1 - slow) * mult * TILE * dt;
      // Bridge Guards physically block the path (Giga Chad smashes through).
      e.blocked = null;
      for (const g of guards) {
        const stopAt = g.spotD - 13;
        if (e.d <= g.spotD && e.d + move >= stopAt) {
          if (spec.smashes) {
            killGuard(g, '🗿 SMASHED!');
          } else {
            move = Math.max(0, stopAt - e.d);
            e.blocked = g;
            g.hp -= spec.dps * dt;
            if (g.hp <= 0) killGuard(g, '💥 Guard down!');
          }
          break;
        }
      }
      e.d += move;
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
      if (isStunned(t) || t.type === 'booth') continue;
      if (t.type === 'cold') { t.pulse = (t.pulse || 0) + dt; continue; }
      const st = towerStat(t), tp = towerPos(t);
      // Guards swing continuously at whoever is beating on them.
      if (t.type === 'guard') {
        for (const e of G.enemies.slice()) {
          if (e.blocked === t) hit(e, st.dmg * dt);
        }
        continue;
      }
      t.cd = (t.cd || 0) - dt;
      if (t.cd > 0) continue;
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
        G.shots.push({ x: tp.x, y: tp.y - 14, target: best, dmg: st.dmg, splash: st.splash || 0 });
      }
    }

    // Projectiles (homing): spitballs hit one enemy, troll heads splash.
    for (let i = G.shots.length - 1; i >= 0; i--) {
      const s = G.shots[i];
      if (!G.enemies.includes(s.target)) { G.shots.splice(i, 1); continue; }
      const p = pointAt(s.target.d);
      const dx = p.x - s.x, dy = p.y - s.y;
      const dist = Math.hypot(dx, dy);
      const step = (s.splash ? 5.5 : 7.5) * TILE * dt;
      if (dist <= step) {
        if (s.splash) {
          addFx({ kind: 'text', str: '💥', x: p.x, y: p.y - 6, life: 0.4, color: '#fff', big: true });
          for (const e of G.enemies.slice()) {
            const ep = pointAt(e.d);
            if (Math.hypot(ep.x - p.x, ep.y - p.y) <= s.splash * TILE) hit(e, s.dmg);
          }
        } else {
          hit(s.target, s.dmg);
        }
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
      saveBest(G.wave, G.tolls);
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
        const spec = ENEMIES[e.type];
        const p = pointAt(e.d);
        earn(spec.bounty, p.x, p.y - 14);
        if (spec.boss) {
          G.bossesSlain += 1;
          addFx({ kind: 'text', str: '👑 ' + spec.name + ' slain!', x: W / 2, y: H / 2 - 40, life: 2, color: '#ffd60a', big: true });
        }
      }
    }
  }

  function gameOver() {
    G.state = 'over';
    closePops();
    const waveReached = G.wave + 1;
    saveBest(G.wave, G.tolls);
    // Arcade-standard integrations (no-ops when scripts are absent)
    if (window.TrollLeaderboard) {
      window.TrollLeaderboard.record('bridge-patrol', { wave: G.wave, tolls: G.tolls, bosses: G.bossesSlain });
    }
    if (window.TrollNotis && typeof window.TrollNotis.push === 'function') {
      window.TrollNotis.push({
        icon: '😏', title: 'Bridge Patrol',
        body: 'Chest looted on wave ' + waveReached + ' — 🪙 ' + fmt(G.tolls) + ' tolls collected.',
      });
    }
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
    addFx({ kind: 'text', str: 'The troll regroups…', x: W / 2, y: H / 2 - 40, life: 1.6, color: '#5ac8fa', big: true });
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

  function makeBuildButton(key, onBuild) {
    const spec = TOWERS[key];
    const b = document.createElement('button');
    b.type = 'button';
    b.disabled = G.coins < spec.cost;
    b.innerHTML = '<span>' + spec.badge + ' ' + spec.name + '<br><span class="pop-sub">' + spec.desc +
      '</span></span><span class="cost">🪙 ' + spec.cost + '</span>';
    b.addEventListener('click', () => {
      if (G.coins < spec.cost) return;
      G.coins -= spec.cost;
      onBuild(spec);
      closePops();
      syncHud();
    });
    return b;
  }

  function openBuildMenu(plotIdx) {
    closePops();
    G.selected = { kind: 'plot', idx: plotIdx };
    const [px, py] = PLOTS[plotIdx];
    buildMenu.innerHTML = '<h3>Build tower</h3>';
    for (const key of MENU_TOWERS) {
      buildMenu.appendChild(makeBuildButton(key, () => {
        G.towers.push({ id: ++G.towerSeq, type: key, plot: plotIdx, tier: 0, cd: 0, bump: 0 });
      }));
    }
    placePop(buildMenu, px * TILE, py * TILE);
    buildMenu.querySelector('button:not(:disabled)')?.focus();
  }

  function openGuardMenu(spotIdx) {
    closePops();
    G.selected = { kind: 'spot', idx: spotIdx };
    const spot = GUARD_SPOTS[spotIdx];
    buildMenu.innerHTML = '<h3>Guard post</h3><span class="pop-sub">Blocks the path itself</span>';
    buildMenu.appendChild(makeBuildButton('guard', (spec) => {
      G.towers.push({
        id: ++G.towerSeq, type: 'guard', spot: spotIdx, spotD: spot.d,
        tier: 0, hp: spec.tiers[0].hp, cd: 0, bump: 0,
      });
    }));
    placePop(buildMenu, spot.x, spot.y);
    buildMenu.querySelector('button:not(:disabled)')?.focus();
  }

  function openTowerPanel(towerIdx) {
    closePops();
    G.selected = { kind: 'tower', idx: towerIdx };
    const t = G.towers[towerIdx];
    const spec = TOWERS[t.type];
    const tp = towerPos(t);
    const tierLabel = ['I', 'II', 'III'][t.tier];
    const hpLine = t.type === 'guard'
      ? '<br>HP ' + Math.ceil(t.hp) + ' / ' + towerStat(t).hp
      : '';
    towerPanel.innerHTML = '<h3>' + spec.badge + ' ' + spec.name + ' · Tier ' + tierLabel + '</h3>' +
      '<span class="pop-sub">' + spec.desc + hpLine + '</span>';
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
        // Guards heal by the tier's HP delta when reinforced.
        if (t.type === 'guard') {
          t.hp = Math.min(next.hp, t.hp + (next.hp - spec.tiers[t.tier - 1].hp));
        }
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
    // …then empty plots…
    for (let i = 0; i < PLOTS.length; i++) {
      if (G.towers.some((t) => t.plot === i)) continue;
      if (Math.hypot(x - PLOTS[i][0] * TILE, y - PLOTS[i][1] * TILE) <= 22) { openBuildMenu(i); return; }
    }
    // …then empty guard posts on the path.
    for (let i = 0; i < GUARD_SPOTS.length; i++) {
      if (G.towers.some((t) => t.spot === i)) continue;
      if (Math.hypot(x - GUARD_SPOTS[i].x, y - GUARD_SPOTS[i].y) <= 22) { openGuardMenu(i); return; }
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

  // Weekly ladder overlay (stacks above title/game-over screens)
  const screenLadder = $('screen-ladder');
  const openLadder = () => { screenLadder.hidden = false; };
  $('btn-ladder').addEventListener('click', openLadder);
  $('btn-ladder2').addEventListener('click', openLadder);
  $('btn-ladder-close').addEventListener('click', () => { screenLadder.hidden = true; });

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
      } else if (G.selected.kind === 'spot') {
        cx = GUARD_SPOTS[G.selected.idx].x; cy = GUARD_SPOTS[G.selected.idx].y;
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
    if (PROP_ART.chest.ready) {
      ctx.drawImage(PROP_ART.chest.img, CHEST.x + shake - 24, CHEST.y - 28, 48, 48);
    } else {
      emoji('💰', CHEST.x + shake, CHEST.y - 4, 30);
    }

    // Towers
    for (const t of G.towers) {
      const spec = TOWERS[t.type];
      const art = TOWER_ART[t.type];
      const tp = towerPos(t);
      const s = 1 + (t.bump || 0) * 0.25;
      // Cold aura pulse
      if (t.type === 'cold') {
        const r = towerStat(t).range * TILE;
        const ph = ((t.pulse || 0) % 1.6) / 1.6;
        ctx.strokeStyle = 'rgba(90,200,250,' + (0.35 * (1 - ph)) + ')';
        ctx.beginPath(); ctx.arc(tp.x, tp.y, r * ph, 0, 7); ctx.stroke();
      }
      if (art.ready) {
        const size = 46 * s;
        ctx.drawImage(art.img, tp.x - size / 2, tp.y - size * 0.62, size, size);
      } else {
        ctx.fillStyle = spec.hue;
        ctx.beginPath(); ctx.arc(tp.x, tp.y, 16, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.arc(tp.x, tp.y, 16, 0, 7); ctx.stroke();
        emoji('😏', tp.x, tp.y - 6, Math.round(24 * s));
        emoji(spec.badge, tp.x + 12, tp.y + 10, 12);
      }
      // Tier pips
      ctx.fillStyle = '#ffd60a';
      for (let i = 0; i < t.tier; i++) {
        ctx.beginPath(); ctx.arc(tp.x - 10 + i * 8, tp.y + 14, 2.5, 0, 7); ctx.fill();
      }
      // Guard HP bar
      if (t.type === 'guard') {
        const maxHp = towerStat(t).hp, w = 28;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(tp.x - w / 2, tp.y + 18, w, 4);
        ctx.fillStyle = t.hp / maxHp > 0.35 ? '#34c759' : '#ff453a';
        ctx.fillRect(tp.x - w / 2, tp.y + 18, w * Math.max(0, t.hp / maxHp), 4);
      }
      // Stunned by a Karen or the Manager
      if (isStunned(t)) emoji('💤', tp.x - 12, tp.y - 20, 14);
    }

    // Enemies
    for (const e of G.enemies) {
      const spec = ENEMIES[e.type];
      const art = ENEMY_ART[e.type];
      const p = pointAt(e.d);
      const bob = Math.sin(e.wobble) * 2;
      if (art.ready) {
        const size = spec.r * (spec.boss ? 3.6 : 2.8);
        ctx.drawImage(art.img, p.x - size / 2, p.y + bob - size * 0.58, size, size);
      } else {
        ctx.fillStyle = spec.hue;
        ctx.beginPath(); ctx.arc(p.x, p.y + bob, spec.r, 0, 7); ctx.fill();
        emoji(spec.emoji, p.x, p.y + bob - 2, spec.r * 1.6);
      }
      if (e.slowed) {
        ctx.strokeStyle = 'rgba(90,200,250,0.9)';
        ctx.beginPath(); ctx.arc(p.x, p.y + bob, spec.r + 2, 0, 7); ctx.stroke();
      }
      // HP bar once damaged (bosses always show one, wider, plus a name)
      if (e.hp < e.hpMax || spec.boss) {
        const w = spec.boss ? 42 : 24;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(p.x - w / 2, p.y + bob - spec.r - 9, w, 4);
        ctx.fillStyle = spec.boss ? '#ffd60a' : '#34c759';
        ctx.fillRect(p.x - w / 2, p.y + bob - spec.r - 9, w * Math.max(0, e.hp / e.hpMax), 4);
      }
      if (spec.boss) {
        ctx.fillStyle = '#fff';
        ctx.font = '700 11px "DM Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(spec.name, p.x, p.y + bob - spec.r - 18);
      }
    }

    // Projectiles: green spitballs, flying troll heads for the cannon
    for (const s of G.shots) {
      if (s.splash) {
        emoji('😏', s.x, s.y, 18);
      } else {
        ctx.fillStyle = '#7be382';
        ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, 7); ctx.fill();
      }
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
  function debugPlace(type, plotIdx, tier) {
    const t = { id: ++G.towerSeq, type, plot: plotIdx, tier: tier || 0, cd: 0, bump: 0 };
    G.towers.push(t);
    return t;
  }
  function debugGuard(spotIdx, tier) {
    const tr = tier || 0;
    const t = {
      id: ++G.towerSeq, type: 'guard', spot: spotIdx, spotD: GUARD_SPOTS[spotIdx].d,
      tier: tr, hp: TOWERS.guard.tiers[tr].hp, cd: 0, bump: 0,
    };
    G.towers.push(t);
    return t;
  }
  window.__bp = { G, startWave, gameOver, buildWave, debugPlace, debugGuard };
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
