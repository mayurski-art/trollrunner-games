/* ============================================================================
   TROLL TD — flagship tower defense (game 011). All 5 build phases in one
   pass: core sim, full 12-unit roster + 2x3 upgrades, enemy depth + 3 maps,
   Boss Troll hero + meta wiring, juice pass. Canvas 2D, vanilla JS, fixed
   timestep. Real PixelLab trollface art (assets/games/troll-td/src/) with a
   procedural circle+emoji fallback for anything that fails to load.
   ============================================================================ */
(() => {
  'use strict';

  const W = 1000, H = 600;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const rnd = (a, b) => a + Math.random() * (b - a);

  // Real trollface art, PixelLab-generated (docs/art/troll-td-pixellab-ids.md).
  // Loaded best-effort; render code falls back to the emoji/circle icon
  // whenever an image hasn't loaded (naturalWidth === 0).
  const UNIT_IMAGES = {};
  ['thrower', 'sticky', 'sniper', 'explosive', 'hacker', 'ninja', 'ice', 'fire', 'medic', 'gold', 'mechanic', 'laser'].forEach((id) => {
    const img = new Image();
    img.src = 'assets/games/troll-td/src/' + id + '.png';
    UNIT_IMAGES[id] = img;
  });
  const HERO_IMAGE = new Image();
  HERO_IMAGE.src = 'assets/games/troll-td/src/hero.png';
  const imgReady = (img) => img && img.complete && img.naturalWidth > 0;

  /* --------------------------------------------------------------------
     DATA — units, enemies, maps
     -------------------------------------------------------------------- */

  // Generic upgrade tier factory: cost + additive/multiplicative deltas.
  function tier(name, cost, delta) { return { name, cost, delta: delta || {} }; }

  const UNITS = [
    {
      id: 'thrower', name: 'Basic Troll Thrower', icon: '🎯', color: '#5cd66c',
      cost: 120, base: { dmg: 4, range: 130, rate: 1.6, splash: 0, pierce: false, camo: false, projSpeed: 520 },
      paths: [
        [tier('Sharper Cards', 90, { dmg: 3 }), tier('Card Barrage', 220, { rate: 0.7 }), tier('Meme Flurry', 520, { dmg: 5, rate: 0.6 })],
        [tier('Longer Reach', 80, { range: 35 }), tier('Twin Toss', 240, { dmg: 4, pierce: true }), tier('Viral Spread', 540, { splash: 40 })],
      ],
    },
    {
      id: 'sticky', name: 'Sticky Troll', icon: '🧴', color: '#f5c542',
      cost: 200, base: { dmg: 0, range: 110, rate: 1.0, splash: 34, slow: 0.35, slowDur: 1.6, camo: false, projSpeed: 380 },
      paths: [
        [tier('Thicker Goo', 120, { slow: 0.12 }), tier('Wide Nozzle', 260, { splash: 20 }), tier('Copypasta Cloud', 560, { slowDur: 1.4, splash: 24 })],
        [tier('Faster Pump', 110, { rate: 0.5 }), tier('Pressure Tank', 250, { range: 30 }), tier('Industrial Spray', 540, { rate: 0.6, splash: 16 })],
      ],
    },
    {
      id: 'sniper', name: 'Sniper Troll', icon: '🏹', color: '#8aa0ff',
      cost: 380, base: { dmg: 55, range: 9999, rate: 0.35, splash: 0, pierce: true, camo: false, projSpeed: 0 },
      paths: [
        [tier('Hollow Points', 260, { dmg: 25 }), tier('Match Grade', 480, { dmg: 35 }), tier('One Shot', 900, { dmg: 90 })],
        [tier('Quick Bolt', 240, { rate: 0.15 }), tier('Semi-Auto', 460, { rate: 0.2 }), tier('Full Auto Meme', 920, { rate: 0.4, dmg: -10 })],
      ],
    },
    {
      id: 'explosive', name: 'Explosives Troll', icon: '💣', color: '#ff8a3d',
      cost: 340, base: { dmg: 22, range: 120, rate: 0.7, splash: 55, pierce: false, camo: false, projSpeed: 300 },
      paths: [
        [tier('More TNT', 200, { dmg: 12, splash: 10 }), tier('Armor Piercing Fuse', 380, { pierceUnlock: true }), tier('Chain Reaction', 760, { dmg: 20, splash: 20 })],
        [tier('Faster Fuse', 180, { rate: 0.3 }), tier('Bigger Blast', 360, { splash: 25 }), tier('Carpet Bomb', 780, { rate: 0.3, splash: 25 })],
      ],
    },
    {
      id: 'hacker', name: 'Hacker Troll', icon: '💻', color: '#64d2ff',
      cost: 420, base: { dmg: 16, range: 140, rate: 1.1, splash: 0, pierce: true, camo: false, chain: 2, chainRange: 90, chainFalloff: 0.65, projSpeed: 0 },
      paths: [
        [tier('Overclock', 220, { dmg: 10 }), tier('Botnet', 420, { chain: 2 }), tier('DDoS Storm', 860, { dmg: 14, chain: 2 })],
        [tier('Wider Ping', 200, { range: 30 }), tier('Faster Packets', 400, { rate: 0.4 }), tier('Zero-Day Exploit', 840, { rate: 0.4, dmg: 12 })],
      ],
    },
    {
      id: 'ninja', name: 'Ninja Troll', icon: '🥷', color: '#3d3d46',
      cost: 300, base: { dmg: 10, range: 115, rate: 2.4, splash: 0, pierce: false, camo: true, projSpeed: 700 },
      paths: [
        [tier('Honed Shuriken', 180, { dmg: 6 }), tier('Twin Blades', 360, { rate: 0.9 }), tier('Shadow Clone', 700, { dmg: 8, rate: 0.6 })],
        [tier('Silent Steps', 170, { range: 25 }), tier('Poisoned Edge', 350, { dmg: 4, pierce: true }), tier('Assassinate', 720, { dmg: 20 })],
      ],
    },
    {
      id: 'ice', name: 'Ice Troll', icon: '❄️', color: '#8ce6ff',
      cost: 260, base: { dmg: 3, range: 100, rate: 1.0, splash: 45, freeze: true, freezeDur: 1.0, camo: false, projSpeed: 340 },
      paths: [
        [tier('Deep Freeze', 160, { freezeDur: 0.6 }), tier('Frost Nova', 320, { splash: 20 }), tier('Absolute Zero', 640, { freezeDur: 0.8, dmg: 6 })],
        [tier('Wider Chill', 150, { range: 25 }), tier('Rapid Frost', 300, { rate: 0.5 }), tier('Blizzard', 660, { rate: 0.5, splash: 24 })],
      ],
    },
    {
      id: 'fire', name: 'Fire Troll', icon: '🔥', color: '#ff5a3d',
      cost: 280, base: { dmg: 6, range: 105, rate: 1.3, splash: 30, pierce: true, burn: 4, burnDur: 3, camo: false, projSpeed: 360 },
      paths: [
        [tier('Hotter Flame', 170, { burn: 3 }), tier('Napalm Hammer', 340, { dmg: 6, splash: 12 }), tier('Inferno', 680, { burn: 5, burnDur: 1 })],
        [tier('Faster Swing', 160, { rate: 0.4 }), tier('Wider Arc', 320, { range: 25 }), tier('Wildfire', 700, { rate: 0.4, splash: 16 })],
      ],
    },
    {
      id: 'medic', name: 'Medic Troll', icon: '➕', color: '#7dffb0',
      cost: 320, base: { dmg: 0, range: 150, rate: 0, buffRange: 0.15, buffRate: 0.15, camo: false }, special: 'support',
      paths: [
        [tier('Better Bandages', 200, { buffRange: 0.08 }), tier('Field Hospital', 380, { buffRate: 0.1 }), tier('Chief Medic', 760, { buffRange: 0.12, buffRate: 0.12 })],
        [tier('Wider Coverage', 190, { range: 40 }), tier('Life Support', 360, { healOnUpgrade: 1 }), tier('Miracle Cure', 780, { healOnUpgrade: 2, range: 30 })],
      ],
    },
    {
      id: 'gold', name: 'Gold Troll', icon: '💰', color: '#ffd60a',
      cost: 400, base: { dmg: 0, range: 0, rate: 0, income: 22, incomeEvery: 6, camo: false }, special: 'economy',
      paths: [
        [tier('Money Printer', 260, { income: 14 }), tier('Crypto Pump', 500, { income: 20 }), tier('Diamond Hands', 1000, { income: 34 })],
        [tier('Faster Payouts', 240, { incomeEveryMul: -0.15 }), tier('Passive Yield', 480, { incomeEveryMul: -0.15 }), tier('Hedge Fund', 1020, { income: 40, incomeEveryMul: -0.1 })],
      ],
    },
    {
      id: 'mechanic', name: 'Mechanic Troll', icon: '🔧', color: '#c68cff',
      cost: 360, base: { dmg: 9, range: 120, rate: 1.2, splash: 0, pierce: false, camo: false, projSpeed: 480, droneEvery: 5, droneDmg: 18 }, special: 'mechanic',
      paths: [
        [tier('Extra Drone', 240, { droneEveryMul: -0.15 }), tier('Reinforced Chassis', 440, { dmg: 6 }), tier('Sentry Swarm', 880, { droneDmg: 20, droneEveryMul: -0.15 })],
        [tier('Precision Tools', 220, { range: 25 }), tier('Auto-Loader', 420, { rate: 0.4 }), tier('Overclocked Rig', 900, { rate: 0.4, dmg: 8 })],
      ],
    },
    {
      id: 'laser', name: 'Laser Troll', icon: '⚡', color: '#4dd0ff',
      cost: 900, base: { dmg: 40, range: 160, rate: 1.4, splash: 18, pierce: true, camo: true, projSpeed: 0 },
      paths: [
        [tier('Focused Beam', 400, { dmg: 20 }), tier('Twin Cannons', 800, { dmg: 25, rate: 0.4 }), tier('Gigachad Overdrive', 1600, { dmg: 50, splash: 12 })],
        [tier('Wider Sweep', 380, { range: 40, splash: 10 }), tier('Faster Charge', 760, { rate: 0.6 }), tier('Legendary Status', 1650, { dmg: 30, rate: 0.5 })],
      ],
    },
  ];
  const UNIT_BY_ID = Object.fromEntries(UNITS.map((u) => [u.id, u]));

  const GRADES = [
    { id: 'gray', name: 'Gray NPC', hp: 9, speed: 62, cash: 1, color: '#9aa0a6', next: null },
    { id: 'blue', name: 'Blue NPC', hp: 18, speed: 78, cash: 2, color: '#4d9dff', next: 'gray', spawn: 2 },
    { id: 'green', name: 'Green NPC', hp: 32, speed: 92, cash: 3, color: '#3ddc6a', next: 'blue', spawn: 2 },
    { id: 'yellow', name: 'Yellow NPC', hp: 52, speed: 118, cash: 4, color: '#ffd93d', next: 'green', spawn: 2 },
    { id: 'red', name: 'Red NPC', hp: 82, speed: 142, cash: 6, color: '#ff5a4d', next: 'yellow', spawn: 2 },
  ];
  const GRADE_BY_ID = Object.fromEntries(GRADES.map((g) => [g.id, g]));
  const BLIMPS = {
    algorithm: { id: 'algorithm', name: 'The Algorithm', hp: 1900, speed: 36, cash: 45, radius: 22, color: '#b04dff', spawnOnDeath: { grade: 'red', count: 4 }, blimp: true },
    mainCharacter: { id: 'mainCharacter', name: 'The Main Character', hp: 6500, speed: 26, cash: 180, radius: 30, color: '#ff2d8a', spawnOnDeath: { blimp: 'algorithm', count: 2 }, blimp: true, isFinalBoss: true },
  };

  function pathLen(path) {
    let total = [0];
    for (let i = 1; i < path.length; i++) total.push(total[i - 1] + dist(path[i - 1], path[i]));
    return total;
  }
  function pointAtDist(path, cum, d) {
    d = clamp(d, 0, cum[cum.length - 1]);
    let i = 1;
    while (i < cum.length && cum[i] < d) i++;
    i = clamp(i, 1, path.length - 1);
    const segLen = cum[i] - cum[i - 1] || 1;
    const t = (d - cum[i - 1]) / segLen;
    const a = path[i - 1], b = path[i];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  const MAPS = [
    {
      id: 'beach', name: 'Grin Beach', tag: 'Easy layout · long shoreline', accent: '#5cd66c',
      path: [{ x: -20, y: 90 }, { x: 180, y: 90 }, { x: 220, y: 260 }, { x: 480, y: 260 }, { x: 520, y: 110 }, { x: 760, y: 110 }, { x: 800, y: 400 }, { x: 1020, y: 400 }],
      buildSpots: [
        { x: 130, y: 170 }, { x: 300, y: 200 }, { x: 340, y: 330 }, { x: 460, y: 190 },
        { x: 600, y: 200 }, { x: 640, y: 60 }, { x: 700, y: 260 }, { x: 860, y: 330 },
        { x: 900, y: 470 }, { x: 940, y: 210 },
      ],
      heroSpot: { x: 60, y: 90 },
    },
    {
      id: 'jungle', name: 'Meme Jungle', tag: 'Medium · twin paths merge', accent: '#ffd60a',
      pathA: [{ x: -20, y: 60 }, { x: 260, y: 60 }, { x: 300, y: 300 }, { x: 500, y: 300 }],
      pathB: [{ x: -20, y: 540 }, { x: 260, y: 540 }, { x: 300, y: 320 }, { x: 500, y: 300 }],
      path: [{ x: 500, y: 300 }, { x: 560, y: 150 }, { x: 760, y: 150 }, { x: 800, y: 460 }, { x: 1020, y: 460 }],
      buildSpots: [
        { x: 140, y: 150 }, { x: 140, y: 460 }, { x: 380, y: 200 }, { x: 380, y: 420 },
        { x: 640, y: 260 }, { x: 700, y: 60 }, { x: 900, y: 340 }, { x: 900, y: 540 },
      ],
      heroSpot: { x: 500, y: 380 },
    },
    {
      id: 'kek', name: 'Mount Kek', tag: 'Hard · tight volcano spiral', accent: '#ff5a4d',
      path: [
        { x: -20, y: 300 }, { x: 220, y: 300 }, { x: 220, y: 120 }, { x: 620, y: 120 },
        { x: 620, y: 480 }, { x: 340, y: 480 }, { x: 340, y: 220 }, { x: 500, y: 220 },
        { x: 500, y: 360 }, { x: 780, y: 360 }, { x: 780, y: 60 }, { x: 1020, y: 60 },
      ],
      buildSpots: [
        { x: 120, y: 220 }, { x: 420, y: 60 }, { x: 700, y: 240 }, { x: 260, y: 400 },
        { x: 620, y: 540 }, { x: 900, y: 200 },
      ],
      heroSpot: { x: -20 + 60, y: 300 },
    },
  ];
  // Precompute cumulative path lengths (merge twin-path maps into one lookup).
  MAPS.forEach((m) => {
    m.cum = pathLen(m.path);
    m.totalLen = m.cum[m.cum.length - 1];
    if (m.pathA) { m.cumA = pathLen(m.pathA); m.totalA = m.cumA[m.cumA.length - 1]; }
    if (m.pathB) { m.cumB = pathLen(m.pathB); m.totalB = m.cumB[m.cumB.length - 1]; }
  });

  const DIFFICULTIES = [
    { id: 'easy', name: 'Easy', rounds: 40, cash: 650, hpMul: 0.85, speedMul: 0.95 },
    { id: 'medium', name: 'Medium', rounds: 60, cash: 550, hpMul: 1.0, speedMul: 1.0 },
    { id: 'hard', name: 'Hard', rounds: 80, cash: 450, hpMul: 1.25, speedMul: 1.08 },
  ];

  /* --------------------------------------------------------------------
     GAME STATE
     -------------------------------------------------------------------- */
  const G = {
    state: 'title', // title | mapSelect | diffSelect | playing | roundClear | over | ladder
    map: null, diff: null,
    cash: 0, lives: 0, livesMax: 0, round: 0, roundTarget: 0, freeplay: false,
    towers: [], enemies: [], projectiles: [], fx: [], drones: [],
    hero: null, heroAbilityCd: 0,
    spawnQueue: [], spawnTimer: 0, roundActive: false,
    speed: 1, paused: false,
    selectedTower: null, selectedSpot: null,
    totalPops: 0, sessionStart: 0,
  };

  const SAVE_KEY = 'trolltd_best_v1';
  function loadBest() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; } }
  function saveBest(mapId, diffId, round) {
    const b = loadBest();
    const key = mapId + ':' + diffId;
    if (!b[key] || round > b[key]) { b[key] = round; localStorage.setItem(SAVE_KEY, JSON.stringify(b)); }
    return b;
  }
  function bestFor(mapId, diffId) { const b = loadBest(); return b[mapId + ':' + diffId] || 0; }

  /* --------------------------------------------------------------------
     ROUND GENERATION
     -------------------------------------------------------------------- */
  // `round` here is the 1-indexed round shown to the player (Round 1, 2, …).
  function buildRoundQueue(round, diff) {
    const q = [];
    let t = 0;
    const gap = clamp(0.75 - round * 0.006, 0.16, 0.75);
    const gradeIdx = clamp(Math.floor(round / 6), 0, GRADES.length - 1);
    const count = Math.round(8 + round * 2.1);
    for (let i = 0; i < count; i++) {
      const gi = clamp(gradeIdx - (Math.random() < 0.3 ? 1 : 0), 0, GRADES.length - 1);
      const mods = {};
      if (round > 8 && Math.random() < clamp(0.05 + round * 0.003, 0, 0.22)) mods.camo = true;
      if (round > 12 && Math.random() < clamp(0.04 + round * 0.003, 0, 0.2)) mods.armored = true;
      if (round > 18 && Math.random() < clamp(0.03 + round * 0.002, 0, 0.15)) mods.regen = true;
      q.push({ t, grade: GRADES[gi].id, mods });
      t += gap;
    }
    if (round % 10 === 0) q.push({ t: t + 1.2, blimp: 'algorithm', mods: {} });
    if (round === diff.rounds) q.push({ t: t + 2, blimp: 'mainCharacter', mods: {} });
    return q;
  }

  function scaledStat(base, round, diff, mul) {
    const growth = 1 + round * 0.045;
    return base * growth * (mul || 1) * (diff ? diff.hpMul : 1);
  }

  function spawnEnemy(spec, round, diff, onMerged) {
    const isBlimp = !!spec.blimp;
    const src = isBlimp ? BLIMPS[spec.blimp] : GRADE_BY_ID[spec.grade];
    const mods = spec.mods || {};
    const hp = isBlimp ? scaledStat(src.hp, round, diff, 1) : scaledStat(src.hp, round, diff, mods.armored ? 1.4 : 1);
    const speed = (src.speed) * (diff ? diff.speedMul : 1) * (mods.armored ? 0.85 : 1);
    let onPath = 'main';
    if (G.map.pathA && Math.random() < 0.5) onPath = 'a';
    else if (G.map.pathB) onPath = 'b';
    const e = {
      id: Math.random().toString(36).slice(2),
      kind: isBlimp ? 'blimp' : 'grade', gradeId: spec.grade || null, blimpId: spec.blimp || null,
      name: src.name, color: src.color, radius: isBlimp ? src.radius : (7 + GRADES.findIndex((g) => g.id === spec.grade) * 1.6),
      hp, hpMax: hp, speed, baseSpeed: speed, cash: src.cash,
      camo: !!mods.camo, armored: !!mods.armored, regen: !!mods.regen,
      d: 0, onPath, dead: false,
      slowUntil: 0, slowMul: 1, freezeUntil: 0, burnUntil: 0, burnDps: 0, lastBurnTick: 0, lastDamagedAt: 0,
      spawnOnDeath: src.spawnOnDeath || null,
    };
    return e;
  }

  function currentPointFor(e) {
    if (e.onPath === 'a') return pointAtDist(G.map.pathA, G.map.cumA, e.d);
    if (e.onPath === 'b') return pointAtDist(G.map.pathB, G.map.cumB, e.d);
    return pointAtDist(G.map.path, G.map.cum, e.d);
  }
  function totalLenFor(e) {
    if (e.onPath === 'a') return G.map.totalA;
    if (e.onPath === 'b') return G.map.totalB;
    return G.map.totalLen;
  }

  /* --------------------------------------------------------------------
     TOWERS
     -------------------------------------------------------------------- */
  function effectiveStats(t) {
    const u = UNIT_BY_ID[t.unitId];
    const s = Object.assign({ dmg: 0, range: 0, rate: 0, splash: 0, pierce: false, camo: false, slow: 0, slowDur: 0, freeze: false, freezeDur: 0, burn: 0, burnDur: 0, chain: 0, chainRange: 0, chainFalloff: 1, projSpeed: 0, buffRange: 0, buffRate: 0, income: 0, incomeEvery: 999, droneEvery: 999, droneDmg: 0, pierceUnlock: false }, u.base);
    for (let p = 0; p < 2; p++) {
      for (let ti = 0; ti < t.tiers[p]; ti++) {
        const d = u.paths[p][ti].delta;
        for (const k in d) {
          if (k === 'incomeEveryMul') s.incomeEvery *= (1 + d[k]);
          else if (k === 'droneEveryMul') s.droneEvery *= (1 + d[k]);
          else if (k === 'pierceUnlock') s.pierce = true;
          else if (k === 'healOnUpgrade') { /* applied at purchase time */ }
          else s[k] = (s[k] || 0) + d[k];
        }
      }
    }
    // Buff aura from nearby Medic Trolls.
    let rangeBuff = 1, rateBuff = 1;
    for (const other of G.towers) {
      if (other === t || UNIT_BY_ID[other.unitId].special !== 'support') continue;
      const os = other._rawSupportStats || medicStats(other);
      if (dist(other, t) <= os.range) { rangeBuff += os.buffRange; rateBuff += os.buffRate; }
    }
    s.range *= rangeBuff;
    s.rate *= rateBuff;
    return s;
  }
  function medicStats(t) {
    const u = UNIT_BY_ID[t.unitId];
    const s = Object.assign({}, u.base);
    for (let p = 0; p < 2; p++) for (let ti = 0; ti < t.tiers[p]; ti++) {
      const d = u.paths[p][ti].delta;
      for (const k in d) if (k !== 'healOnUpgrade') s[k] = (s[k] || 0) + d[k];
    }
    return s;
  }

  function placeTower(unitId, spot) {
    const u = UNIT_BY_ID[unitId];
    if (!u || G.cash < u.cost || spot.occupied) return false;
    G.cash -= u.cost;
    const t = {
      id: Math.random().toString(36).slice(2), unitId, x: spot.x, y: spot.y, spot,
      tiers: [0, 0], cd: 0, targetMode: 'first', angle: 0, incomeTimer: 0, droneTimer: 0, spentTotal: u.cost,
    };
    spot.occupied = t;
    G.towers.push(t);
    return true;
  }
  function sellTower(t) {
    const refund = Math.round(t.spentTotal * 0.65);
    G.cash += refund;
    t.spot.occupied = null;
    G.towers = G.towers.filter((x) => x !== t);
    closePanels();
  }
  function upgradeTower(t, path) {
    const u = UNIT_BY_ID[t.unitId];
    const otherPath = path === 0 ? 1 : 0;
    if (t.tiers[otherPath] > 1) return false; // locked once other path passes tier 1
    const tierIdx = t.tiers[path];
    if (tierIdx >= 3) return false;
    const def = u.paths[path][tierIdx];
    if (G.cash < def.cost) return false;
    G.cash -= def.cost;
    t.spentTotal += def.cost;
    t.tiers[path] += 1;
    if (def.delta.healOnUpgrade) G.lives = Math.min(G.livesMax, G.lives + def.delta.healOnUpgrade);
    addFx({ kind: 'text', str: '⬆ ' + def.name, x: t.x, y: t.y - 26, life: 1.1, color: '#ffd60a' });
    return true;
  }

  /* --------------------------------------------------------------------
     COMBAT
     -------------------------------------------------------------------- */
  function pickTarget(t, stats) {
    let best = null, bestScore = -Infinity;
    for (const e of G.enemies) {
      if (e.dead) continue;
      if (e.camo && !stats.camo) continue;
      if (dist(t, e) > stats.range) continue;
      let score;
      const traveled = e.d + (e.onPath === 'a' || e.onPath === 'b' ? 0 : 0);
      if (t.targetMode === 'first') score = traveled;
      else if (t.targetMode === 'last') score = -traveled;
      else if (t.targetMode === 'strong') score = e.hp;
      else score = -dist(t, e); // close
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  function applyDamage(e, dmg, opts) {
    opts = opts || {};
    if (e.armored && !opts.pierce) dmg *= 0.15;
    e.hp -= dmg;
    e.lastDamagedAt = performance.now();
    if (opts.slow) { e.slowUntil = Math.max(e.slowUntil, performance.now() + opts.slowDur * 1000); e.slowMul = Math.min(e.slowMul, 1 - opts.slow); }
    if (opts.freeze) e.freezeUntil = Math.max(e.freezeUntil, performance.now() + opts.freezeDur * 1000);
    if (opts.burn) { e.burnUntil = Math.max(e.burnUntil, performance.now() + opts.burnDur * 1000); e.burnDps = Math.max(e.burnDps, opts.burn); }
    if (e.hp <= 0 && !e.dead) killEnemy(e);
  }

  function killEnemy(e) {
    e.dead = true;
    G.totalPops += 1;
    earn(e.cash);
    if (G.hero) heroGainXp(e.blimpId ? 25 : 2);
    addFx({ kind: 'pop', x: currentPointFor(e).x, y: currentPointFor(e).y, color: e.color });
    if (e.spawnOnDeath) {
      const p = currentPointFor(e);
      for (let i = 0; i < e.spawnOnDeath.count; i++) {
        let child;
        if (e.spawnOnDeath.grade) child = spawnEnemy({ t: 0, grade: e.spawnOnDeath.grade, mods: {} }, G.round + 1, G.diff);
        else child = spawnEnemy({ t: 0, blimp: e.spawnOnDeath.blimp, mods: {} }, G.round + 1, G.diff);
        child.d = Math.max(0, e.d - 14 - i * 10);
        child.onPath = e.onPath;
        G.enemies.push(child);
      }
    } else if (e.kind === 'grade') {
      const grade = GRADE_BY_ID[e.gradeId];
      if (grade.next) {
        for (let i = 0; i < grade.spawn; i++) {
          const child = spawnEnemy({ t: 0, grade: grade.next, mods: { camo: e.camo, regen: false } }, G.round + 1, G.diff);
          child.d = Math.max(0, e.d - 10 - i * 8);
          child.onPath = e.onPath;
          G.enemies.push(child);
        }
      }
    }
  }

  function earn(n) { G.cash += n; }

  function fireTower(t, stats, target) {
    const p1 = { x: t.x, y: t.y };
    const opts = { pierce: stats.pierce, slow: stats.slow, slowDur: stats.slowDur, freeze: stats.freeze, freezeDur: stats.freezeDur, burn: stats.burn, burnDur: stats.burnDur };
    if (stats.projSpeed > 0) {
      G.projectiles.push({ x: p1.x, y: p1.y, target, dmg: stats.dmg, speed: stats.projSpeed, splash: stats.splash, color: UNIT_BY_ID[t.unitId].color, opts, chain: stats.chain, chainRange: stats.chainRange, chainFalloff: stats.chainFalloff });
    } else {
      // Hitscan (sniper, laser)
      applyDamage(target, stats.dmg, opts);
      if (stats.splash > 0) splashDamage(target, stats.splash, stats.dmg * 0.5, opts);
      if (stats.chain > 0) chainDamage(target, stats.dmg, stats.chain, stats.chainRange, stats.chainFalloff, opts);
      addFx({ kind: 'beam', x1: p1.x, y1: p1.y, x2: currentPointFor(target).x, y2: currentPointFor(target).y, color: UNIT_BY_ID[t.unitId].color, life: 0.12 });
    }
  }

  function splashDamage(center, radius, dmg, opts) {
    const cp = currentPointFor(center);
    for (const e of G.enemies) {
      if (e.dead || e === center) continue;
      const ep = currentPointFor(e);
      if (dist(cp, ep) <= radius) applyDamage(e, dmg, opts);
    }
  }
  function chainDamage(from, dmg, hops, range, falloff, opts) {
    let cur = from, remaining = hops, d = dmg;
    const hit = new Set([from]);
    while (remaining > 0) {
      const cp = currentPointFor(cur);
      let next = null, nd = Infinity;
      for (const e of G.enemies) {
        if (e.dead || hit.has(e)) continue;
        const ep = currentPointFor(e);
        const dd = dist(cp, ep);
        if (dd <= range && dd < nd) { nd = dd; next = e; }
      }
      if (!next) break;
      d *= falloff;
      applyDamage(next, d, opts);
      hit.add(next);
      cur = next;
      remaining--;
    }
  }

  /* --------------------------------------------------------------------
     HERO — Boss Troll
     -------------------------------------------------------------------- */
  function initHero() {
    G.hero = { x: G.map.heroSpot.x, y: G.map.heroSpot.y, level: 1, xp: 0, xpNext: 60, cd: 0, range: 170, abilityCd: 0 };
  }
  function heroGainXp(n) {
    if (!G.hero) return;
    G.hero.xp += n;
    while (G.hero.xp >= G.hero.xpNext) {
      G.hero.xp -= G.hero.xpNext;
      G.hero.level += 1;
      G.hero.xpNext = Math.round(60 * Math.pow(1.35, G.hero.level - 1));
      addFx({ kind: 'text', str: '👑 Boss Troll Lv.' + G.hero.level, x: G.hero.x, y: G.hero.y - 30, life: 1.6, color: '#ffd60a', big: true });
    }
  }
  function heroUpdate(dt) {
    if (!G.hero) return;
    G.hero.cd -= dt;
    G.hero.abilityCd = Math.max(0, G.hero.abilityCd - dt);
    if (G.hero.cd <= 0) {
      let target = null, best = -1;
      for (const e of G.enemies) { if (e.dead) continue; const p = currentPointFor(e); const d = dist(G.hero, p); if (d <= G.hero.range && e.d > best) { best = e.d; target = e; } }
      if (target) {
        applyDamage(target, 8 + G.hero.level * 5, { pierce: true });
        addFx({ kind: 'beam', x1: G.hero.x, y1: G.hero.y, x2: currentPointFor(target).x, y2: currentPointFor(target).y, color: '#ffd60a', life: 0.15 });
      }
      G.hero.cd = 1.8;
    }
  }
  function heroAbility() {
    if (!G.hero || G.hero.level < 3 || G.hero.abilityCd > 0) return;
    G.hero.abilityCd = 20;
    const dmg = 30 + G.hero.level * 12;
    for (const e of G.enemies) { if (!e.dead) applyDamage(e, dmg, { pierce: true }); if (!e.dead) e.slowUntil = performance.now() + 1500, e.slowMul = 0.4; }
    addFx({ kind: 'text', str: '💥 Hero Slam!', x: W / 2, y: H / 2, life: 1.4, color: '#ff2d8a', big: true });
  }

  /* --------------------------------------------------------------------
     FX
     -------------------------------------------------------------------- */
  function addFx(f) { f.t = 0; G.fx.push(f); }

  /* --------------------------------------------------------------------
     UPDATE
     -------------------------------------------------------------------- */
  function update(dt) {
    if (G.paused || G.state !== 'playing') return;
    dt *= G.speed;
    const now = performance.now();

    // Spawn queue
    if (G.roundActive) {
      G.spawnTimer += dt;
      while (G.spawnQueue.length && G.spawnQueue[0].t <= G.spawnTimer) {
        const spec = G.spawnQueue.shift();
        G.enemies.push(spawnEnemy(spec, G.round + 1, G.diff));
      }
      if (!G.spawnQueue.length && G.enemies.every((e) => e.dead)) finishRound();
    }

    // Enemies
    for (const e of G.enemies) {
      if (e.dead) continue;
      let mul = 1;
      if (now < e.freezeUntil) mul = 0;
      else if (now < e.slowUntil) mul = e.slowMul;
      if (now < e.burnUntil && now - e.lastBurnTick > 400) { e.lastBurnTick = now; applyDamage(e, e.burnDps * 0.4, {}); }
      if (e.regen && now - e.lastDamagedAt > 2500) e.hp = Math.min(e.hpMax, e.hp + e.hpMax * 0.01);
      if (e.dead) continue;
      e.d += e.speed * mul * dt;
      if (e.d >= totalLenFor(e)) {
        e.dead = true;
        G.lives -= e.kind === 'blimp' ? 5 : 1;
        addFx({ kind: 'text', str: '-' + (e.kind === 'blimp' ? 5 : 1), x: currentPointFor(e).x, y: currentPointFor(e).y, life: 0.8, color: '#ff453a' });
        if (G.lives <= 0) { G.lives = 0; gameOver(); return; }
      }
    }
    G.enemies = G.enemies.filter((e) => !e.dead);

    // Towers
    for (const t of G.towers) {
      const u = UNIT_BY_ID[t.unitId];
      if (u.special === 'economy') {
        const s = effectiveStats(t);
        t.incomeTimer += dt;
        if (t.incomeTimer >= s.incomeEvery) { t.incomeTimer = 0; earn(s.income); addFx({ kind: 'text', str: '+🪙' + s.income, x: t.x, y: t.y - 20, life: 0.9, color: '#ffd60a' }); }
        continue;
      }
      if (u.special === 'support') { t._rawSupportStats = medicStats(t); continue; }
      const stats = effectiveStats(t);
      t.cd -= dt;
      if (u.special === 'mechanic') {
        t.droneTimer += dt;
        if (t.droneTimer >= stats.droneEvery) {
          t.droneTimer = 0;
          const target = pickTarget(t, Object.assign({}, stats, { range: stats.range * 1.3 }));
          if (target) { applyDamage(target, stats.droneDmg, { pierce: true }); addFx({ kind: 'beam', x1: t.x, y1: t.y - 20, x2: currentPointFor(target).x, y2: currentPointFor(target).y, color: '#c68cff', life: 0.2 }); }
        }
      }
      if (t.cd > 0) continue;
      const target = pickTarget(t, stats);
      if (!target) continue;
      t.angle = Math.atan2(currentPointFor(target).y - t.y, currentPointFor(target).x - t.x);
      fireTower(t, stats, target);
      t.cd = 1 / Math.max(0.05, stats.rate);
    }

    // Projectiles
    for (const p of G.projectiles) {
      if (p.dead) continue;
      if (p.target.dead) { p.dead = true; continue; }
      const tp = currentPointFor(p.target);
      const dx = tp.x - p.x, dy = tp.y - p.y, d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (d <= step) {
        applyDamage(p.target, p.dmg, p.opts);
        if (p.splash > 0) splashDamage(p.target, p.splash, p.dmg * 0.5, p.opts);
        if (p.chain > 0) chainDamage(p.target, p.dmg, p.chain, p.chainRange, p.chainFalloff, p.opts);
        p.dead = true;
      } else { p.x += (dx / d) * step; p.y += (dy / d) * step; }
    }
    G.projectiles = G.projectiles.filter((p) => !p.dead);

    heroUpdate(dt);

    for (const f of G.fx) f.t += dt;
    G.fx = G.fx.filter((f) => f.t < f.life);

    syncHud();
  }

  function finishRound() {
    G.roundActive = false;
    const displayedRound = G.round + 1; // round just cleared
    if (!G.freeplay && displayedRound >= G.diff.rounds) { winCampaign(); return; }
    G.round += 1;
    saveBest(G.map.id, G.diff.id, G.round);
    $('btn-round').disabled = false;
    $('btn-round').textContent = 'Start Round ' + (G.round + 1) + ' ▶';
  }

  /* --------------------------------------------------------------------
     STATE TRANSITIONS
     -------------------------------------------------------------------- */
  function startRound() {
    if (G.roundActive) return;
    G.spawnQueue = buildRoundQueue(G.round + 1, G.diff);
    G.spawnTimer = 0;
    G.roundActive = true;
    $('btn-round').disabled = true;
    $('btn-round').textContent = 'Round ' + (G.round + 1) + ' in progress…';
  }

  function beginRun(map, diff) {
    G.map = map; G.diff = diff;
    G.cash = diff.cash; G.lives = 20; G.livesMax = 20;
    G.round = 0; G.freeplay = false;
    G.towers = []; G.enemies = []; G.projectiles = []; G.fx = [];
    for (const s of map.buildSpots) s.occupied = null;
    initHero();
    G.totalPops = 0;
    G.sessionStart = performance.now();
    G.state = 'playing';
    G.paused = false; G.speed = 1;
    closePanels();
    screenTitle.hidden = true; screenMapSelect.hidden = true; screenDiffSelect.hidden = true;
    screenOver.hidden = true; screenWin.hidden = true; screenLadder.hidden = true;
    hud.hidden = false;
    $('btn-round').disabled = false;
    $('btn-round').textContent = 'Start Round 1 ▶';
    syncHud();
  }

  function winCampaign() {
    G.state = 'roundClear';
    saveBest(G.map.id, G.diff.id, G.diff.rounds);
    if (window.TrollNotis && typeof window.TrollNotis.push === 'function') {
      window.TrollNotis.push({ icon: '🏆', title: 'Troll TD', body: G.map.name + ' (' + G.diff.name + ') cleared! Freeplay unlocked.' });
    }
    $('win-stats').innerHTML = 'You cleared <b>' + G.map.name + '</b> on <b>' + G.diff.name + '</b>.<br>Pops: <b>' + fmt(G.totalPops) + '</b> · Hero level: <b>' + (G.hero ? G.hero.level : 1) + '</b>';
    screenWin.hidden = false;
  }
  function continueFreeplay() {
    G.freeplay = true;
    G.round += 1;
    $('btn-round').disabled = false;
    $('btn-round').textContent = 'Start Round ' + (G.round + 1) + ' ▶';
    G.state = 'playing';
    screenWin.hidden = true;
  }

  function gameOver() {
    G.state = 'over';
    closePanels();
    saveBest(G.map.id, G.diff.id, G.round);
    if (window.TrollLeaderboard) {
      window.TrollLeaderboard.record('troll-td', { round: G.round, pops: G.totalPops, mapId: G.map.id, diffId: G.diff.id, heroLevel: G.hero ? G.hero.level : 1 });
    }
    if (window.TrollNotis && typeof window.TrollNotis.push === 'function') {
      window.TrollNotis.push({ icon: '🦂', title: 'Troll TD', body: 'Island overrun on round ' + (G.round + 1) + ' — ' + fmt(G.totalPops) + ' pops.' });
    }
    $('over-stats').innerHTML = 'The Corps fell on <b>round ' + (G.round + 1) + '</b> (' + G.map.name + ' · ' + G.diff.name + ').<br>Total pops: <b>' + fmt(G.totalPops) + '</b>';
    screenOver.hidden = false;
  }

  /* --------------------------------------------------------------------
     RENDER
     -------------------------------------------------------------------- */
  const canvas = $('td-canvas');
  const ctx = canvas.getContext('2d');

  function drawPath(path, color) {
    ctx.strokeStyle = color || '#3a4a3d';
    ctx.lineWidth = 46;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 46;
    ctx.stroke();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#182a1d';
    ctx.fillRect(0, 0, W, H);
    if (!G.map) return;

    if (G.map.pathA) drawPath(G.map.pathA);
    if (G.map.pathB) drawPath(G.map.pathB);
    drawPath(G.map.path);

    // Build spots
    for (const s of G.map.buildSpots) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 24, 0, Math.PI * 2);
      ctx.fillStyle = s.occupied ? 'rgba(255,255,255,0.03)' : 'rgba(255,214,10,0.14)';
      ctx.fill();
      ctx.strokeStyle = s.occupied ? 'rgba(255,255,255,0.08)' : 'rgba(255,214,10,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Hero
    if (G.hero) {
      ctx.save();
      ctx.globalAlpha = 0.95;
      if (imgReady(HERO_IMAGE)) {
        const s = 44;
        ctx.drawImage(HERO_IMAGE, G.hero.x - s / 2, G.hero.y - s / 2, s, s);
      } else {
        ctx.font = '38px serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('👑', G.hero.x, G.hero.y);
      }
      ctx.restore();
      ctx.fillStyle = '#ffd60a';
      ctx.font = '700 10px "DM Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Lv.' + G.hero.level, G.hero.x, G.hero.y + 26);
    }

    // Towers
    for (const t of G.towers) {
      const u = UNIT_BY_ID[t.unitId];
      const img = UNIT_IMAGES[u.id];
      ctx.save();
      ctx.translate(t.x, t.y);
      if (t === G.selectedTower) {
        const stats = effectiveStats(t);
        if (stats.range < 9999) { ctx.beginPath(); ctx.arc(0, 0, stats.range, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.stroke(); }
      }
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fillStyle = u.color;
      ctx.globalAlpha = 0.25;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (imgReady(img)) {
        const s = 34;
        ctx.drawImage(img, -s / 2, -s / 2, s, s);
      } else {
        ctx.font = '26px serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(u.icon, 0, 0);
      }
      if (t.tiers[0] + t.tiers[1] > 0) {
        ctx.font = '700 9px "DM Mono", monospace';
        ctx.fillStyle = '#ffd60a';
        ctx.textAlign = 'center';
        ctx.fillText(t.tiers[0] + '•' + t.tiers[1], 0, 20);
      }
      ctx.restore();
    }

    // Enemies
    for (const e of G.enemies) {
      if (e.dead) continue;
      const p = currentPointFor(e);
      ctx.save();
      ctx.globalAlpha = e.camo ? 0.55 : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, e.radius, 0, Math.PI * 2);
      ctx.fillStyle = e.color;
      ctx.fill();
      if (e.armored) { ctx.strokeStyle = '#dcdcdc'; ctx.lineWidth = 2.5; ctx.stroke(); }
      if (performance.now() < e.freezeUntil) { ctx.strokeStyle = '#8ce6ff'; ctx.lineWidth = 2; ctx.stroke(); }
      if (performance.now() < e.burnUntil) { ctx.strokeStyle = '#ff5a3d'; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.restore();
      // HP bar
      const w = e.radius * 2.1;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(p.x - w / 2, p.y - e.radius - 9, w, 4);
      ctx.fillStyle = e.hp / e.hpMax > 0.5 ? '#34c759' : (e.hp / e.hpMax > 0.2 ? '#ffd60a' : '#ff453a');
      ctx.fillRect(p.x - w / 2, p.y - e.radius - 9, w * clamp(e.hp / e.hpMax, 0, 1), 4);
    }

    // Projectiles
    for (const p of G.projectiles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }

    // FX
    for (const f of G.fx) {
      const a = 1 - f.t / f.life;
      if (f.kind === 'text') {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = f.color || '#fff';
        ctx.font = (f.big ? '700 18px' : '700 12px') + ' "DM Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(f.str, f.x, f.y - f.t * 24);
        ctx.restore();
      } else if (f.kind === 'pop') {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 6 + f.t * 40, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (f.kind === 'beam') {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(f.x1, f.y1);
        ctx.lineTo(f.x2, f.y2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /* --------------------------------------------------------------------
     UI wiring
     -------------------------------------------------------------------- */
  const hud = $('td-hud');
  const screenTitle = $('screen-title');
  const screenMapSelect = $('screen-map-select');
  const screenDiffSelect = $('screen-diff-select');
  const screenOver = $('screen-over');
  const screenWin = $('screen-win');
  const screenLadder = $('screen-ladder');
  const buildMenu = $('build-menu');
  const towerPanel = $('tower-panel');

  let pendingMap = null;

  function syncHud() {
    if (G.state !== 'playing') return;
    $('hud-cash').textContent = '🪙 ' + fmt(G.cash);
    $('hud-lives').textContent = '❤️ ' + fmt(G.lives);
    $('hud-round').textContent = 'Round ' + (G.round + 1) + (G.freeplay ? ' (Freeplay)' : ' / ' + G.diff.rounds);
    $('hud-hero').textContent = G.hero ? '👑 Lv.' + G.hero.level : '';
    const ab = $('btn-hero-ability');
    if (G.hero && G.hero.level >= 3) { ab.hidden = false; ab.disabled = G.hero.abilityCd > 0; ab.textContent = G.hero.abilityCd > 0 ? '⏳ ' + Math.ceil(G.hero.abilityCd) + 's' : '💥 Hero Slam'; }
    else ab.hidden = true;
  }

  function closePanels() { buildMenu.hidden = true; towerPanel.hidden = true; G.selectedTower = null; G.selectedSpot = null; }

  function popAt(el, x, y) {
    const box = canvas.getBoundingClientRect();
    const px = (x / W) * box.width;
    const py = (y / H) * box.height;
    el.style.left = clamp(px, 4, box.width - 210) + 'px';
    el.style.top = clamp(py, 4, box.height - 240) + 'px';
  }

  function openBuildMenu(spot) {
    closePanels();
    G.selectedSpot = spot;
    buildMenu.innerHTML = '<h3>Build a Troll</h3>' + UNITS.map((u) =>
      '<button data-unit="' + u.id + '" ' + (G.cash < u.cost ? 'disabled' : '') + '>' +
      '<span>' + u.icon + ' ' + u.name + '</span><span class="cost">🪙' + u.cost + '</span></button>').join('');
    buildMenu.hidden = false;
    popAt(buildMenu, spot.x, spot.y);
  }

  function openTowerPanel(t) {
    closePanels();
    G.selectedTower = t;
    const u = UNIT_BY_ID[t.unitId];
    const stats = effectiveStats(t);
    let html = '<h3>' + u.icon + ' ' + u.name + '</h3>';
    if (u.special !== 'support' && u.special !== 'economy') html += '<p class="pop-sub">DMG ' + Math.round(stats.dmg) + ' · RNG ' + (stats.range > 9999 ? '∞' : Math.round(stats.range)) + ' · RATE ' + stats.rate.toFixed(1) + '/s</p>';
    else if (u.special === 'economy') html += '<p class="pop-sub">+🪙' + Math.round(stats.income) + ' every ' + stats.incomeEvery.toFixed(1) + 's</p>';
    else html += '<p class="pop-sub">Buffs range +' + Math.round(stats.buffRange * 100) + '% / rate +' + Math.round(stats.buffRate * 100) + '% nearby</p>';

    if (u.special !== 'support' && u.special !== 'economy') {
      html += '<div class="target-row">' + ['first', 'last', 'strong', 'close'].map((m) =>
        '<button data-target="' + m + '" aria-pressed="' + (t.targetMode === m) + '">' + m + '</button>').join('') + '</div>';
    }

    html += '<div class="path-row">';
    for (let p = 0; p < 2; p++) {
      const idx = t.tiers[p];
      const locked = t.tiers[p === 0 ? 1 : 0] > 1;
      if (idx >= 3) html += '<button disabled><span>Path ' + (p === 0 ? 'A' : 'B') + ' maxed</span></button>';
      else {
        const def = u.paths[p][idx];
        const canAfford = G.cash >= def.cost && !locked;
        html += '<button data-path="' + p + '" ' + (canAfford ? '' : 'disabled') + '><span>' + def.name + '</span><span class="cost">🪙' + def.cost + '</span></button>';
      }
    }
    html += '</div>';
    html += '<button class="sell" data-sell="1"><span>Sell</span><span class="cost">+🪙' + Math.round(t.spentTotal * 0.65) + '</span></button>';

    towerPanel.innerHTML = html;
    towerPanel.hidden = false;
    popAt(towerPanel, t.x, t.y);
  }

  buildMenu.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-unit]');
    if (!btn || !G.selectedSpot) return;
    if (placeTower(btn.dataset.unit, G.selectedSpot)) closePanels();
  });

  towerPanel.addEventListener('click', (ev) => {
    const t = G.selectedTower;
    if (!t) return;
    const tb = ev.target.closest('button[data-target]');
    if (tb) { t.targetMode = tb.dataset.target; openTowerPanel(t); return; }
    const pb = ev.target.closest('button[data-path]');
    if (pb) { if (upgradeTower(t, Number(pb.dataset.path))) openTowerPanel(t); return; }
    const sb = ev.target.closest('button[data-sell]');
    if (sb) sellTower(t);
  });

  function canvasPoint(clientX, clientY) {
    const box = canvas.getBoundingClientRect();
    return { x: ((clientX - box.left) / box.width) * W, y: ((clientY - box.top) / box.height) * H };
  }

  canvas.addEventListener('click', (ev) => {
    if (G.state !== 'playing') return;
    const p = canvasPoint(ev.clientX, ev.clientY);
    for (const t of G.towers) { if (dist(t, p) < 22) { openTowerPanel(t); return; } }
    for (const s of G.map.buildSpots) { if (!s.occupied && dist(s, p) < 26) { openBuildMenu(s); return; } }
    closePanels();
  });

  $('btn-round').addEventListener('click', startRound);
  $('btn-speed').addEventListener('click', () => { G.speed = G.speed === 1 ? 2 : 1; $('btn-speed').setAttribute('aria-pressed', G.speed === 2); $('btn-speed').textContent = G.speed + '×'; });
  $('btn-pause').addEventListener('click', () => { G.paused = !G.paused; $('btn-pause').setAttribute('aria-pressed', G.paused); });
  $('btn-hero-ability').addEventListener('click', heroAbility);
  $('btn-quit').addEventListener('click', () => { G.state = 'title'; hud.hidden = true; closePanels(); screenTitle.hidden = false; });

  $('btn-start').addEventListener('click', () => {
    screenTitle.hidden = true;
    renderMapSelect();
    screenMapSelect.hidden = false;
  });
  function renderMapSelect() {
    $('map-grid').innerHTML = MAPS.map((m) =>
      '<button class="td-pick" data-map="' + m.id + '" style="border-left:3px solid ' + m.accent + '"><strong>' + m.name + '</strong><span>' + m.tag + '</span></button>').join('');
  }
  $('map-grid').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-map]');
    if (!btn) return;
    pendingMap = MAPS.find((m) => m.id === btn.dataset.map);
    renderDiffSelect();
    screenMapSelect.hidden = true;
    screenDiffSelect.hidden = false;
  });
  function renderDiffSelect() {
    $('diff-grid').innerHTML = DIFFICULTIES.map((d) => {
      const best = bestFor(pendingMap.id, d.id);
      return '<button class="td-pick" data-diff="' + d.id + '"><strong>' + d.name + '</strong><span>' + d.rounds + ' rounds · 🪙' + d.cash + '</span>' + (best ? '<span>Best: round ' + best + '</span>' : '') + '</button>';
    }).join('');
  }
  $('diff-grid').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-diff]');
    if (!btn) return;
    const diff = DIFFICULTIES.find((d) => d.id === btn.dataset.diff);
    screenDiffSelect.hidden = true;
    beginRun(pendingMap, diff);
  });
  $('btn-diff-back').addEventListener('click', () => { screenDiffSelect.hidden = true; screenMapSelect.hidden = false; });
  $('btn-map-back').addEventListener('click', () => { screenMapSelect.hidden = true; screenTitle.hidden = false; });

  $('btn-retry').addEventListener('click', () => beginRun(G.map, G.diff));
  $('btn-quit2').addEventListener('click', () => { screenOver.hidden = true; hud.hidden = true; G.state = 'title'; screenTitle.hidden = false; });
  $('btn-freeplay').addEventListener('click', continueFreeplay);
  $('btn-win-quit').addEventListener('click', () => { screenWin.hidden = true; hud.hidden = true; G.state = 'title'; screenTitle.hidden = false; });

  [['btn-ladder', screenTitle], ['btn-ladder2', screenOver]].forEach(([id, from]) => {
    $(id).addEventListener('click', () => { screenLadder.hidden = false; });
  });
  $('btn-ladder-close').addEventListener('click', () => { screenLadder.hidden = true; });

  const bestAny = Math.max(0, ...Object.values(loadBest()));
  if (bestAny) { $('title-best').hidden = false; $('title-best').textContent = 'Best round reached: ' + bestAny; }

  /* --------------------------------------------------------------------
     LOOP
     -------------------------------------------------------------------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Debug/smoke-test hooks
  window.__td = { G, UNITS, MAPS, DIFFICULTIES, beginRun, startRound, placeTower, upgradeTower, sellTower, heroAbility, gameOver, winCampaign };
})();
