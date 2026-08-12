/* The Rusty Troll — game 009, phases 1-2 + VR-feel camera.
   First-person fry cook: three facings (griddle / counter / window) on a
   sliding world strip, turned by a JS-owned spring camera that also drives
   head-look parallax and idle sway (see updateCamera). Per-side patty
   doneness with flip timing, exact-order stack assembly scored by LCS,
   fry baskets + hold-to-fill drinks, customer patience/mood/quirks,
   promotion track, comedic payday screen, localStorage save.
   No external calls — the game must run with every cross-repo script blocked. */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const SAVE_KEY = "troll-burger-save-v1";
  const ART = "assets/games/troll-burger/art/";
  /* PixelLab top-down sprites for the burger layers — see art/README.md.
     Every use goes through layerDiv()'s fallback-first swap (matches the
     Pizzeria pattern): the CSS color bar renders immediately and stays as
     the permanent 404 fallback; the sprite fades in on top once loaded. */
  const LAYER_SPRITE = {
    bun_b: "bun-bottom.png", bun_t: "bun-top.png", patty: "patty.png",
    cheese: "top-cheese.png", lettuce: "top-lettuce.png", tomato: "top-tomato.png",
    ketchup: "top-ketchup.png", pickles: "top-pickles.png", onions: "top-onions.png",
    mustard: "top-mustard.png", jalapeno: "top-jalapeno.png",
  };
  /* PixelLab full-body customer sprites (queue walk-in/wait/leave + the
     Wojak cashier's idle loop) — see art/README.md's customer-sprite batch
     section. Same fallback-first pattern as LAYER_SPRITE: the emoji face
     in .tb-cust/.tb-wojak-face renders immediately and stays the permanent
     404 fallback (this is what the hermetic smoke test exercises, since it
     blocks all non-localhost requests); the sprite image fades in on top
     only once its frame has actually loaded. PixelLab's animate_character
     returns each frame as a separately-numbered PNG, not one spritesheet,
     so frames are stepped with a small setInterval instead of a CSS
     steps() spritesheet animation. */
  const CUST_ART = ART + "customers/";
  const CUST_SPRITE = {
    Trollio: { key: "trollio", frames: 8 },
    Pepe:    { key: "pepe",    frames: 8 },
    Doge:    { key: "doge",    frames: 8 },
    Chad:    { key: "chad",    frames: 8 },
    Nana:    { key: "nana",    frames: 8 },
    Harold:  { key: "harold",  frames: 8 },
    Grumpy:  { key: "grumpy",  frames: 8 },
  };
  const WOJAK_SPRITE = { key: "wojak", frames: 4 };
  const WALK_FRAME_MS = 110;   // ~90 SPF-ish gait for the 8-frame walk cycle
  const IDLE_FRAME_MS = 260;   // slower breathing-idle loop for the cashier

  const custAnimTimers = new WeakMap();
  function custWalkSrc(key, i) { return `${CUST_ART}${key}-walk-${i}.png`; }
  function custStandSrc(key) { return `${CUST_ART}${key}-stand.png`; }
  function stopCustAnim(node) {
    const t = custAnimTimers.get(node);
    if (t) { clearInterval(t); custAnimTimers.delete(node); }
  }
  function attachCustSprite(node, custName) {
    const sprite = CUST_SPRITE[custName];
    if (!sprite) return; // no sprite generated for this cast member — emoji-only fallback
    const img = document.createElement("img");
    img.className = "tb-cust-art";
    img.alt = ""; img.draggable = false;
    img.onload = () => img.classList.add("has-art");
    node.appendChild(img);
    node.dataset.custKey = sprite.key;
    node.dataset.custFrames = sprite.frames;
    playCustWalk(node, img);
  }
  function playCustWalk(node, img) {
    stopCustAnim(node);
    const key = node.dataset.custKey, frames = +node.dataset.custFrames;
    if (!key) return;
    let i = 0;
    img.src = custWalkSrc(key, i);
    custAnimTimers.set(node, setInterval(() => {
      i = (i + 1) % frames;
      img.src = custWalkSrc(key, i);
    }, WALK_FRAME_MS));
  }
  function freezeCustStand(node, img) {
    stopCustAnim(node);
    const key = node.dataset.custKey;
    if (!key) return;
    img.src = custStandSrc(key);
  }
  function initWojakSprite() {
    const face = document.querySelector(".tb-wojak-face");
    if (!face) return;
    const img = document.createElement("img");
    img.className = "tb-wojak-art";
    img.alt = ""; img.draggable = false;
    img.onload = () => img.classList.add("has-art");
    face.appendChild(img);
    let i = 0;
    img.src = `${CUST_ART}${WOJAK_SPRITE.key}-idle-${i}.png`;
    setInterval(() => {
      i = (i + 1) % WOJAK_SPRITE.frames;
      img.src = `${CUST_ART}${WOJAK_SPRITE.key}-idle-${i}.png`;
    }, IDLE_FRAME_MS);
  }

  /* ---- tuning ----------------------------------------------------------- */
  const COOK_MAX = 110;          // bar length in cook units; > COOK_MAX = burnt
  const COOK_RATE = 7.5;         // units per second on the down side
  const PERFECT = { lo: 60, hi: 90, target: 75 };
  const RAIL_MAX = 5;

  const BASKET_MAX = 100;
  const BASKET_RATE = 11;
  const BASKET_PERFECT = { lo: 50, hi: 82, target: 64 };

  const DRINK_MAX = 100;
  const DRINK_OVERFLOW = 122;
  const DRINK_RATE = 60;         // fill units/sec while held
  const DRINK_PERFECT = { lo: 66, hi: 96 };

  const PANTRY_CAP = { patty: 4, fries: 3, rings: 3, drink: 3 };
  const SIDES_START_SHIFT = 2;   // fries become orderable
  const RINGS_START_SHIFT = 3;   // onion rings unlock
  const DRINK_START_SHIFT = 4;   // soda machine unlocks

  /* slot spots on the griddle: back row smaller (farther away). Up to 6 —
     rank perks unlock the last two. */
  const SLOT_POS = [
    { x: 37, y: 30, w: 104 }, { x: 63, y: 30, w: 104 },
    { x: 30, y: 68, w: 134 }, { x: 70, y: 68, w: 134 },
    { x: 12, y: 48, w: 82 },  { x: 88, y: 48, w: 82 },
  ];

  /* ---- ingredients ------------------------------------------------------ */
  const LAYERS = {
    bun_b:   { label: "Bottom bun", short: "Bun",      c: "#e6a94f", w: 160, h: 20, r: "8px 8px 5px 5px",  emoji: "🍞" },
    bun_t:   { label: "Top bun",    short: "Bun",      c: "#e6a94f", w: 160, h: 26, r: "60% 60% 8px 8px",  emoji: "🍞" },
    patty:   { label: "Patty",      short: "Patty",    c: "#6b4426", w: 152, h: 16, r: "7px",              emoji: "🥩" },
    cheese:  { label: "Cheese",     short: "Cheese",   c: "#ffd23e", w: 158, h: 8,  r: "3px",              emoji: "🧀" },
    lettuce: { label: "Lettuce",    short: "Lettuce",  c: "#63c04f", w: 164, h: 9,  r: "5px",              emoji: "🥬" },
    tomato:  { label: "Tomato",     short: "Tomato",   c: "#e04434", w: 146, h: 9,  r: "5px",              emoji: "🍅" },
    ketchup: { label: "Ketchup",    short: "Ketchup",  c: "#c92a1e", w: 122, h: 6,  r: "3px",              emoji: "🥫" },
    pickles: { label: "Pickles",    short: "Pickles",  c: "#7fae3e", w: 120, h: 8,  r: "4px",              emoji: "🥒" },
    onions:  { label: "Onions",     short: "Onions",   c: "#e8d8f0", w: 140, h: 7,  r: "4px",              emoji: "🧅" },
    mustard: { label: "Mustard",    short: "Mustard",  c: "#e3b505", w: 122, h: 6,  r: "3px",              emoji: "🌭" },
    jalapeno:{ label: "Jalapeños",  short: "Jalapeño", c: "#2f9e44", w: 112, h: 8,  r: "4px",              emoji: "🌶" },
  };
  const SIDE_META = {
    fries: { emoji: "🍟", label: "Fries",        short: "Fries" },
    rings: { emoji: "🧅", label: "Onion rings",  short: "Rings" },
    drink: { emoji: "🥤", label: "Drink",        short: "Drink" },
  };

  function toppingPool(shift) {
    const pool = ["cheese", "lettuce", "tomato"];
    if (shift >= 2) pool.push("ketchup");
    if (shift >= 3) pool.push("pickles");
    if (shift >= 4) pool.push("onions");
    if (shift >= 5) pool.push("mustard");
    if (shift >= 6) pool.push("jalapeno");
    return pool;
  }

  /* customers — patience (windowMult) + tip lean + Grumpy's extra score
     weight, reusing the Pizzeria meme roster & quirks per the design doc. */
  const CUSTS = [
    { n: "Trollio", e: "😏", tip: 1.1,  windowMult: 0.8 },
    { n: "Pepe",    e: "🐸", tip: 1.25, windowMult: 1.3 },
    { n: "Doge",    e: "🐶", tip: 1.0,  windowMult: 1.0 },
    { n: "Chad",    e: "🗿", tip: 0.9,  windowMult: 0.8 },
    { n: "Nana",    e: "👵", tip: 1.2,  windowMult: 1.5 },
    { n: "Harold",  e: "🙂", tip: 1.0,  windowMult: 1.0 },
  ];
  const GRUMPY = { n: "Grumpy", e: "😾", tip: 0.7, windowMult: 0.75, scoreWeight: 2 };

  const REACTIONS = [
    [95, "PERFECT. Problem?"],
    [80, "Pretty good, fry troll."],
    [60, "Edible. Barely."],
    [40, "My disappointment is immeasurable."],
    [0,  "I'm telling Mr. Grabs about this."],
  ];

  /* ---- promotion track ---------------------------------------------------- */
  const RANKS = [
    { title: "Trainee",                threshold: 0,     grillSlots: 4, baskets: 1, tipBonus: 1.00 },
    { title: "Fry Cook",                threshold: 700,   grillSlots: 5, baskets: 1, tipBonus: 1.00 },
    { title: "Grill Master",            threshold: 2200,  grillSlots: 5, baskets: 2, tipBonus: 1.05 },
    { title: "Employee of the Month",   threshold: 5500,  grillSlots: 6, baskets: 2, tipBonus: 1.10 },
    { title: "Assistant to Mr. Grabs",  threshold: 11000, grillSlots: 6, baskets: 2, tipBonus: 1.15 },
  ];
  function rankFor(totalScore) {
    let r = RANKS[0], idx = 0;
    for (let i = 0; i < RANKS.length; i++) if (totalScore >= RANKS[i].threshold) { r = RANKS[i]; idx = i; }
    return { ...r, index: idx };
  }

  /* ---- shift events (the workplace drama) --------------------------------- */
  const EVENT_META = {
    boss:      { icon: "🦀", label: "Mr. Grabs is walking the floor" },
    rush:      { icon: "🚌", label: "Rush hour" },
    thief:     { icon: "🕵️", label: "Formula thief" },
    inspector: { icon: "📋", label: "Health inspection" },
  };
  const BOSS_LINES = [
    "That patty cost me FOUR CENTS!!",
    "You call that portion control?!",
    "I'm docking that from your paycheck.",
    "Waste is a CHOICE, fry troll.",
  ];
  const THIEF_NEEDED = 3;
  const INSPECTOR_WIPES_NEEDED = 5;
  const CLOSING_TASKS = [
    { key: "grill", label: "Scrub the grill", needed: 6, icon: "🧽" },
    { key: "floor", label: "Mop the floor",   needed: 6, icon: "🪣" },
    { key: "sign",  label: "Flip the sign",   needed: 1, icon: "🔌" },
  ];

  /* ---- payday flavor (never touches real score/tips) --------------------- */
  const DEDUCTIONS = [
    ["Paper hat rental", 0.75],
    ["Spatula depreciation", 0.50],
    ["Griddle ambience fee", 1.25],
    ["Grease trap surcharge", 0.60],
    ["Mandatory fun tax", 0.40],
    ["Mr. Grabs's ‘processing fee’", 0.90],
    ["Uniform dry cleaning (theoretical)", 0.35],
    ["Bell maintenance levy", 0.45],
  ];
  function paydayBreakdown(tips) {
    const gross = Math.round((tips * 0.08 + 2) * 100) / 100;
    const picks = sample(DEDUCTIONS, 2 + rnd(2));
    let ded = 0;
    const lines = picks.map(([label, amt]) => { ded += amt; return { label, amt }; });
    const net = Math.max(0.15, Math.round((gross - ded) * 100) / 100);
    return { gross, lines, net };
  }

  /* ---- state ------------------------------------------------------------ */
  const S = {
    screen: "title",           // title | shift | between
    face: 0,                   // 0 griddle · 1 counter · 2 window
    shift: 1,
    rank: RANKS[0],
    quota: 5,
    spawned: 0,
    served: 0,
    score: 0,
    tips: 0,
    waste: 0,
    tickets: [],               // open tickets (max RAIL_MAX on the rail)
    nextTicket: 1,
    activeTicketId: null,
    grill: [],
    baskets: [],
    pantry: { patty: [], fries: [], rings: [], drink: [] },
    build: null,               // {layers:[key], patties:[], sides:[], log:[]}
    selectedItem: null,        // {kind:'patty'|'fries'|'rings'|'drink', id}
    drinkFill: 0,
    drinkHolding: false,
    orders: [],                // completed order results this shift
    eventSchedule: [],          // [{type, atSpawn}], consumed as tickets spawn
    event: null,                 // active event state, see startEvent()
    eventBonus: 0,               // running total of event score deltas this shift
    toastMsg: "", toastIcon: "💬", toastUntil: 0,
    closing: null,               // {task, tasks, counts, startedAt, bonus} once quota is hit
    soundOn: true,
    running: false,
    spawnAt: 0,                // clock time of next spawn
    clock: 0,                  // seconds since shift start
    save: null,
  };
  let nextPattyId = 1;
  let nextBasketId = 1;

  /* ---- save ------------------------------------------------------------- */
  function loadSave() {
    try { S.save = JSON.parse(localStorage.getItem(SAVE_KEY)) || null; }
    catch { S.save = null; }
    if (!S.save) S.save = { shift: 1, best: 0, totalScore: 0, lifetime: { shifts: 0, served: 0, tips: 0, waste: 0 } };
    if (S.save.totalScore === undefined) S.save.totalScore = 0; // upgrade older saves
    S.shift = S.save.shift || 1;
  }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S.save)); } catch { /* private mode */ }
  }

  /* ---- tiny WebAudio synth ---------------------------------------------- */
  let AC = null;
  function ac() {
    if (!S.soundOn) return null;
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (AC.state === "suspended") AC.resume();
    return AC;
  }
  function tone(freq, dur, type, gain, when) {
    const a = ac(); if (!a) return;
    const t = a.currentTime + (when || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || "square"; o.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur);
  }
  function noise(dur, gain) {
    const a = ac(); if (!a) return;
    const n = a.sampleRate * dur, buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1400;
    const g = a.createGain(); g.gain.value = gain || 0.08;
    src.connect(f).connect(g).connect(a.destination); src.start();
  }
  const SFX = {
    ding: () => { tone(1180, 0.28, "sine", 0.07); tone(1760, 0.4, "sine", 0.05, 0.03); },
    bell: () => { tone(1560, 0.5, "sine", 0.09); tone(2140, 0.6, "sine", 0.05, 0.02); },
    flip: () => { tone(300, 0.06, "square", 0.05); noise(0.12, 0.05); },
    sizzle: () => noise(0.35, 0.09),
    drop: () => tone(180, 0.08, "square", 0.06),
    buzz: () => { tone(120, 0.18, "sawtooth", 0.07); },
    coin: () => { tone(920, 0.08, "square", 0.05); tone(1380, 0.16, "square", 0.05, 0.07); },
    pour: () => { tone(420, 0.07, "sine", 0.045); tone(640, 0.09, "sine", 0.04, 0.06); },
  };

  /* ---- funny audio dialogue -----------------------------------------------
     Browser-native speech synthesis reads out the game's flavor lines —
     Mr. Grabs's money lines, Gremlin's taunts, customer reactions — without
     any audio files (keeps the CSP/asset story identical to the WebAudio
     SFX above: nothing fetched, nothing to fail to load). Silently no-ops
     wherever unsupported (headless test runners, some mobile browsers) —
     never throws, never blocks the game if it can't speak. Cancels any
     still-playing line first so a rush of quick events (rush hour, a fast
     order streak) can't pile up a backlog of overlapping speech. */
  function speak(text, pitch, rate) {
    if (!S.soundOn) return;
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = pitch == null ? 1 : pitch;
      u.rate = rate == null ? 1.05 : rate;
      u.volume = 0.85;
      window.speechSynthesis.speak(u);
    } catch (_) { /* speech synthesis unsupported/blocked */ }
  }
  const VOICE_PITCH = { "🦀": 0.72, "🕵️": 1.45 };   // Mr. Grabs gruff, Gremlin squeaky
  const VOICE_RATE  = { "🦀": 0.92, "🕵️": 1.25 };
  function custPitch(cust) {
    // stable per-character "voice" rather than random each line
    let h = 0;
    for (const ch of cust.n) h = (h * 31 + ch.charCodeAt(0)) % 97;
    return 0.85 + (h / 97) * 0.5;
  }

  /* ---- helpers ---------------------------------------------------------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (n) => Math.floor(Math.random() * n);
  function sample(arr, n) {
    const c = arr.slice(), out = [];
    while (out.length < n && c.length) out.push(c.splice(rnd(c.length), 1)[0]);
    return out;
  }
  function shuffle(arr) {
    const c = arr.slice();
    for (let i = c.length - 1; i > 0; i--) { const j = rnd(i + 1); [c[i], c[j]] = [c[j], c[i]]; }
    return c;
  }
  function lcsLen(a, b) {
    const m = a.length, n = b.length;
    let prev = new Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
      const cur = [0];
      for (let j = 1; j <= n; j++)
        cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
      prev = cur;
    }
    return prev[n];
  }

  /* ---- grill math -------------------------------------------------------- */
  function sideScore(c) {
    if (c > COOK_MAX) return 0;
    return Math.max(0, Math.round(100 - Math.abs(PERFECT.target - c) * 2.6));
  }
  function pattyPct(p) {
    let pct = Math.round((sideScore(p.up) + sideScore(p.down)) / 2);
    if (p.burnt) pct = Math.min(15, pct);
    return pct;
  }
  function pattyGrade(p) {
    if (p.burnt) return "BURNT";
    const pct = pattyPct(p);
    if (pct >= 85) return "PERFECT";
    if (pct >= 55) return "GOOD";
    if (pct >= 25) return "MEH";
    return "RAW";
  }
  function cookColor(c) {
    // raw pink → cooked brown → charred
    const stops = [[0, 212, 119, 107], [55, 158, 96, 58], [95, 107, 68, 38], [COOK_MAX + 20, 36, 29, 24]];
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++)
      if (c >= stops[i][0] && c <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
    const t = clamp((c - a[0]) / (b[0] - a[0] || 1), 0, 1);
    const mix = (i) => Math.round(a[i] + (b[i] - a[i]) * t);
    return `rgb(${mix(1)},${mix(2)},${mix(3)})`;
  }

  /* ---- fry basket + drink math -------------------------------------------- */
  function basketPct(b) {
    if (b.burnt) return 8;
    return Math.max(0, Math.round(100 - Math.abs(BASKET_PERFECT.target - b.cook) * 2.2));
  }
  function basketGrade(b) {
    if (b.burnt) return "BURNT";
    const pct = basketPct(b);
    if (pct >= 85) return "GOLDEN";
    if (pct >= 55) return "GOOD";
    if (pct >= 25) return "MEH";
    return "RAW";
  }
  function drinkPct(fill) {
    if (fill < 18) return 0;
    if (fill > DRINK_MAX) return 10;
    const mid = (DRINK_PERFECT.lo + DRINK_PERFECT.hi) / 2;
    return Math.max(0, Math.round(100 - Math.abs(mid - fill) * 1.6));
  }
  function drinkGrade(pct) {
    if (pct >= 85) return "PERFECT";
    if (pct >= 50) return "GOOD";
    if (pct > 0) return "FLAT";
    return "FLAT";
  }

  /* ---- tickets ----------------------------------------------------------- */
  function genTicket(shift, forceGrumpy) {
    const nTop = Math.min(2 + Math.floor((shift - 1) / 2), 6);
    const tops = shuffle(sample(toppingPool(shift), Math.min(nTop, toppingPool(shift).length)));
    const mid = ["patty", ...tops];
    if (shift >= 5 && Math.random() < 0.3) mid.splice(1 + rnd(mid.length), 0, "patty");
    const cust = forceGrumpy ? GRUMPY : CUSTS[rnd(CUSTS.length)];
    const layers = ["bun_b", ...mid, "bun_t"];

    const sides = [];
    if (shift >= SIDES_START_SHIFT && Math.random() < 0.55) {
      sides.push(shift >= RINGS_START_SHIFT && Math.random() < 0.4 ? "rings" : "fries");
    }
    if (shift >= DRINK_START_SHIFT && Math.random() < 0.5) sides.push("drink");

    return {
      id: S.nextTicket++,
      cust,
      layers,
      sides,
      bornAt: S.clock,
      window: (55 + layers.length * 9 + sides.length * 8) * (cust.windowMult || 1),
    };
  }
  function genRushTicket() {
    return {
      id: S.nextTicket++,
      cust: CUSTS[rnd(CUSTS.length)],
      layers: ["bun_b", "patty", "cheese", "bun_t"],
      sides: [],
      isRush: true,
      bornAt: S.clock,
      window: 26,
    };
  }
  function ticketById(id) { return S.tickets.find((t) => t.id === id) || null; }
  function moodMult(t) {
    const age = S.clock - t.bornAt;
    return Math.round((1.15 - 0.35 * clamp(age / t.window, 0, 1)) * 100) / 100;
  }

  /* ---- DOM refs ---------------------------------------------------------- */
  const el = {};
  function grabRefs() {
    ["tb-title", "tb-start-btn", "tb-howto-btn", "tb-howto", "tb-howto-close", "tb-title-stats",
     "tb-game", "tb-hud-shift", "tb-hud-coins", "tb-hud-score", "tb-hud-waste", "tb-hud-rank", "tb-sound-toggle",
     "tb-fullscreen-toggle", "tb-cabinet",
     "tb-pov", "tb-world", "tb-hand", "tb-turn-left", "tb-turn-right", "tb-slots", "tb-patty-tub", "tb-plate-rack",
     "tb-trash", "tb-spatula", "tb-fries-tub", "tb-rings-tub", "tb-baskets",
     "tb-pinned-ticket", "tb-build-stack", "tb-build-sides", "tb-undo", "tb-scrap",
     "tb-bins", "tb-counter-hint", "tb-soda-machine", "tb-soda-fill",
     "tb-queue", "tb-ticket-rail", "tb-serve-spot", "tb-bell",
     "tb-event-banner", "tb-event-icon", "tb-event-label", "tb-event-sub", "tb-event-timer", "tb-event-action",
     "tb-order-overlay", "tb-shift-overlay", "tb-closing-overlay"]
      .forEach((id) => { el[id.replace(/^tb-/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });
    el.facingTabs = [...document.querySelectorAll(".tb-facing-tab")];
  }

  /* ---- facing / camera ------------------------------------------------------
     The world strip's transform is owned entirely by updateCamera(), which
     runs every animation frame and blends three things into one spring-eased
     3D transform: (1) which facing you're turned to, (2) head-look tilt
     from the mouse position (VR-style parallax + a subtle perspective tilt
     on .tb-world, matched by translate parallax on individual background
     layers via --tb-look-x/--tb-look-y), and (3) a small idle sway so
     standing still doesn't look frozen. face() only updates target state;
     it never touches el.world.style directly. */
  const FINE_POINTER = !window.matchMedia || matchMedia("(pointer: fine)").matches;
  const cam = {
    faceCur: 0,                 // eased % translateX offset (target = -S.face*33.3333)
    lookX: 0, lookY: 0,         // eased look direction, -1..1
    lookTX: 0, lookTY: 0,       // raw pointer-driven target
    t: 0,                       // idle-sway clock
    handX: 0, handY: 0,         // eased reticle position (px, relative to .tb-pov)
    handTX: 0, handTY: 0,
  };

  function face(i, opts) {
    S.face = clamp(i, 0, 2);
    el.world.classList.add("is-turning");
    setTimeout(() => el.world.classList.remove("is-turning"), 380);
    el.facingTabs.forEach((tab, k) => {
      tab.classList.toggle("is-active", k === S.face);
      tab.setAttribute("aria-selected", k === S.face ? "true" : "false");
      if (k === S.face) tab.classList.remove("has-new");
    });
    el.turnLeft.disabled = S.face === 0;
    el.turnRight.disabled = S.face === 2;
    if (!opts || !opts.quiet) SFX.drop();
  }

  function updateCamera(dt) {
    cam.t += dt;

    // ease the look vector toward wherever the pointer currently is
    const lookRate = Math.min(1, dt * 6);
    cam.lookX += (cam.lookTX - cam.lookX) * lookRate;
    cam.lookY += (cam.lookTY - cam.lookY) * lookRate;
    el.pov.style.setProperty("--tb-look-x", cam.lookX.toFixed(3));
    el.pov.style.setProperty("--tb-look-y", cam.lookY.toFixed(3));

    // ease the facing offset toward its target (replaces the old CSS transition)
    const faceTarget = -S.face * 33.3333;
    cam.faceCur += (faceTarget - cam.faceCur) * Math.min(1, dt * 12);

    const bobY = Math.sin(cam.t * 0.9) * 2.2;          // idle standing sway
    const bobR = Math.sin(cam.t * 0.6) * 0.32;
    const lookShiftPct = cam.lookX * -1.1;              // subtle in-facing look drift
    el.world.style.transform =
      `translateX(${(cam.faceCur + lookShiftPct).toFixed(3)}%) translateY(${bobY.toFixed(2)}px) ` +
      `rotateY(${(cam.lookX * 3.4).toFixed(2)}deg) rotateX(${(-cam.lookY * 1.7).toFixed(2)}deg) rotateZ(${bobR.toFixed(2)}deg)`;

    if (FINE_POINTER && el.hand) {
      const handRate = Math.min(1, dt * 16);
      cam.handX += (cam.handTX - cam.handX) * handRate;
      cam.handY += (cam.handTY - cam.handY) * handRate;
      el.hand.style.transform = `translate(${cam.handX.toFixed(1)}px, ${cam.handY.toFixed(1)}px)`;
    }
  }

  /* ---- grill rendering + actions ----------------------------------------- */
  function buildSlots() {
    el.slots.innerHTML = "";
    for (let i = 0; i < S.rank.grillSlots; i++) {
      const p = SLOT_POS[i];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tb-slot";
      b.dataset.slot = i;
      b.style.left = p.x + "%";
      b.style.top = p.y + "%";
      b.style.setProperty("--slot-w", p.w + "px");
      b.setAttribute("aria-label", `Griddle spot ${i + 1} — empty`);
      b.addEventListener("click", () => onSlotClick(i));
      el.slots.appendChild(b);
    }
  }
  function slotEl(i) { return el.slots.children[i]; }

  function renderSlot(i) {
    const btn = slotEl(i), p = S.grill[i];
    btn.classList.toggle("is-burnt", !!(p && p.burnt));
    btn.classList.toggle("has-patty", !!p);
    if (!p) {
      btn.innerHTML = "";
      btn.setAttribute("aria-label", `Griddle spot ${i + 1} — empty. Click to lay a raw patty.`);
      return;
    }
    if (!btn.querySelector(".tb-patty")) {
      btn.innerHTML =
        `<span class="tb-patty"></span>
         <span class="tb-patty-bars">
           <span class="tb-bar tb-bar-up"><span class="tb-bar-fill"></span></span>
           <span class="tb-bar tb-bar-down"><span class="tb-bar-fill"></span></span>
         </span>
         <span class="tb-slot-plate" role="button" tabindex="0" aria-label="Plate this patty" title="Plate this patty">🍽</span>`;
      const plateBtn = btn.querySelector(".tb-slot-plate");
      plateBtn.addEventListener("click", (ev) => { ev.stopPropagation(); plateSlot(i); });
      plateBtn.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); plateSlot(i); }
      });
    }
    updateSlotVisual(i);
    btn.setAttribute("aria-label",
      `Griddle spot ${i + 1} — patty, top side ${Math.round(p.up)}, bottom side ${Math.round(p.down)} of ${COOK_MAX}${p.burnt ? ", burnt" : ""}. Click to flip.`);
  }
  function updateSlotVisual(i) {
    const btn = slotEl(i), p = S.grill[i];
    if (!p || !btn.querySelector(".tb-patty")) return;
    const patty = btn.querySelector(".tb-patty");
    patty.style.setProperty("--patty-color", cookColor(p.up));
    patty.style.setProperty("--sear", clamp(p.up / COOK_MAX, 0, 1) * 0.55);
    const bars = [[".tb-bar-up", p.up], [".tb-bar-down", p.down]];
    for (const [sel, v] of bars) {
      const bar = btn.querySelector(sel), fill = bar.querySelector(".tb-bar-fill");
      fill.style.width = clamp(v / COOK_MAX * 100, 0, 100) + "%";
      bar.classList.toggle("is-perfect", v >= PERFECT.lo && v <= PERFECT.hi);
      bar.classList.toggle("is-burnt", v > COOK_MAX);
    }
  }

  function onSlotClick(i) {
    if (S.grill[i]) flipSlot(i); else layPatty(i);
  }
  function layPatty(i) {
    if (S.grill[i]) return;
    S.grill[i] = { id: nextPattyId++, up: 0, down: 0, burnt: false };
    SFX.sizzle(); workSpatula();
    renderSlot(i);
  }
  function flipSlot(i) {
    const p = S.grill[i]; if (!p) return;
    [p.up, p.down] = [p.down, p.up];
    const btn = slotEl(i);
    btn.classList.remove("is-flipping"); void btn.offsetWidth;
    btn.classList.add("is-flipping");
    SFX.flip(); workSpatula();
    renderSlot(i);
  }
  function plateSlot(i) {
    const p = S.grill[i]; if (!p) return;
    if (S.pantry.patty.length >= PANTRY_CAP.patty) { SFX.buzz(); hint("Tray is full — use or trash a patty."); return; }
    S.grill[i] = null;
    const rec = { id: p.id, up: p.up, down: p.down, burnt: p.burnt, pct: pattyPct(p), grade: pattyGrade(p) };
    S.pantry.patty.push(rec);
    SFX.drop(); workSpatula();
    renderSlot(i); renderPantry(); renderBins();
  }
  function workSpatula() {
    el.spatula.classList.remove("is-working"); void el.spatula.offsetWidth;
    el.spatula.classList.add("is-working");
  }

  /* ---- fry baskets --------------------------------------------------------- */
  function buildBaskets() {
    el.baskets.innerHTML = "";
    for (let i = 0; i < S.rank.baskets; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tb-basket";
      b.dataset.basket = i;
      b.setAttribute("aria-label", `Fry basket ${i + 1} — empty`);
      b.addEventListener("click", () => { if (S.baskets[i]) pullBasket(i); });
      el.baskets.appendChild(b);
    }
  }
  function renderBasket(i) {
    const btn = el.baskets.children[i]; if (!btn) return;
    const item = S.baskets[i];
    btn.classList.toggle("is-burnt", !!(item && item.burnt));
    btn.classList.toggle("has-item", !!item);
    if (!item) {
      btn.innerHTML = "";
      btn.setAttribute("aria-label", `Fry basket ${i + 1} — empty`);
      return;
    }
    if (!btn.querySelector(".tb-basket-bar")) {
      btn.innerHTML = `<span class="tb-basket-art">${SIDE_META[item.type].emoji}</span>
        <span class="tb-basket-bar"><span class="tb-basket-fill"></span></span>`;
    }
    const fill = btn.querySelector(".tb-basket-fill");
    fill.style.width = clamp(item.cook / BASKET_MAX * 100, 0, 100) + "%";
    fill.classList.toggle("is-perfect", item.cook >= BASKET_PERFECT.lo && item.cook <= BASKET_PERFECT.hi);
    fill.classList.toggle("is-burnt", item.cook > BASKET_MAX);
    btn.setAttribute("aria-label",
      `Fry basket ${i + 1} — ${SIDE_META[item.type].label}, ${Math.round(item.cook)} of ${BASKET_MAX}${item.burnt ? ", burnt" : ""}. Click to pull.`);
  }
  function dropBasket(type) {
    const free = S.baskets.findIndex((b) => !b);
    if (free === -1) { SFX.buzz(); hint("Baskets are full."); return; }
    S.baskets[free] = { id: nextBasketId++, type, cook: 0, burnt: false };
    SFX.sizzle();
    renderBasket(free);
  }
  function pullBasket(i) {
    const item = S.baskets[i]; if (!item) return;
    if (S.pantry[item.type].length >= PANTRY_CAP[item.type]) { SFX.buzz(); hint("Tray is full — use or trash one."); return; }
    S.baskets[i] = null;
    S.pantry[item.type].push({ id: item.id, type: item.type, pct: basketPct(item), grade: basketGrade(item) });
    SFX.drop();
    if (item.burnt && S.event && S.event.type === "boss") applyBossPenalty();
    renderBasket(i); renderPantry(); renderBins();
  }

  /* ---- drink machine -------------------------------------------------------- */
  function updateSodaVisual() {
    if (!el.sodaFill) return;
    const pct = clamp(S.drinkFill, 0, DRINK_OVERFLOW) / DRINK_OVERFLOW * 100;
    el.sodaFill.style.height = pct + "%";
    el.sodaFill.classList.toggle("is-perfect", S.drinkFill >= DRINK_PERFECT.lo && S.drinkFill <= DRINK_PERFECT.hi);
    el.sodaFill.classList.toggle("is-over", S.drinkFill > DRINK_MAX);
    el.sodaMachine.classList.toggle("is-filling", S.drinkHolding);
  }
  function releaseSoda() {
    if (!S.drinkHolding) return;
    S.drinkHolding = false;
    if (S.drinkFill < 18) { S.drinkFill = 0; updateSodaVisual(); return; }        // let go too early — no penalty
    if (S.pantry.drink.length >= PANTRY_CAP.drink) {
      SFX.buzz(); hint("Tray is full — use or trash one.");
      S.drinkFill = 0; updateSodaVisual(); return;
    }
    const pct = drinkPct(S.drinkFill);
    S.pantry.drink.push({ id: nextBasketId++, type: "drink", pct, grade: drinkGrade(pct) });
    S.drinkFill = 0;
    SFX.pour();
    updateSodaVisual(); renderPantry(); renderBins();
  }

  /* ---- shared pantry (patty / fries / rings / drink) ----------------------- */
  function appendPattyChip(p) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tb-plate" + (p.grade === "PERFECT" ? " is-perfect" : p.grade === "BURNT" ? " is-burnt" : "");
    if (S.selectedItem && S.selectedItem.kind === "patty" && S.selectedItem.id === p.id) b.classList.add("is-selected");
    b.setAttribute("aria-label", `Plated patty — ${p.grade} (${p.pct}%). Click to select for the trash.`);
    b.innerHTML = `<span class="tb-plate-meat" style="--patty-color:${cookColor(p.up)}"></span><span class="tb-plate-grade">${p.grade}</span>`;
    b.addEventListener("click", () => {
      S.selectedItem = (S.selectedItem && S.selectedItem.kind === "patty" && S.selectedItem.id === p.id)
        ? null : { kind: "patty", id: p.id };
      el.trash.classList.toggle("is-armed", S.selectedItem !== null);
      renderPantry();
    });
    el.plateRack.appendChild(b);
  }
  function appendSideChip(type, item) {
    const meta = SIDE_META[type];
    const b = document.createElement("button");
    b.type = "button";
    const good = type === "drink" ? "PERFECT" : "GOLDEN";
    b.className = "tb-side-chip" + (item.grade === good ? " is-perfect" : (item.grade === "BURNT" ? " is-burnt" : ""));
    if (S.selectedItem && S.selectedItem.kind === type && S.selectedItem.id === item.id) b.classList.add("is-selected");
    b.innerHTML = `<span class="tb-side-chip-art">${meta.emoji}</span><span class="tb-side-chip-grade">${item.grade}</span>`;
    b.setAttribute("aria-label", `${meta.label} — ${item.grade} (${item.pct}%). Click to select for the trash.`);
    b.addEventListener("click", () => {
      S.selectedItem = (S.selectedItem && S.selectedItem.kind === type && S.selectedItem.id === item.id)
        ? null : { kind: type, id: item.id };
      el.trash.classList.toggle("is-armed", S.selectedItem !== null);
      renderPantry();
    });
    el.plateRack.appendChild(b);
  }
  function renderPantry() {
    el.plateRack.innerHTML = "";
    S.pantry.patty.forEach(appendPattyChip);
    S.pantry.fries.forEach((p) => appendSideChip("fries", p));
    S.pantry.rings.forEach((p) => appendSideChip("rings", p));
    S.pantry.drink.forEach((p) => appendSideChip("drink", p));
    el.trash.classList.toggle("is-armed", S.selectedItem !== null);
  }
  function trashSelected() {
    if (!S.selectedItem) { hint("Click a plated item first, then the trash."); return; }
    const { kind, id } = S.selectedItem;
    const arr = S.pantry[kind];
    const idx = arr.findIndex((p) => p.id === id);
    if (idx >= 0) {
      arr.splice(idx, 1);
      S.waste++;
      SFX.buzz();
      if (S.event && S.event.type === "boss") applyBossPenalty();
    }
    S.selectedItem = null;
    renderPantry(); renderBins(); updateHud();
  }

  /* ---- counter: bins + build --------------------------------------------- */
  function unlockedBins(shift) {
    const bins = ["patty", "bun", ...toppingPool(shift)];
    if (shift >= SIDES_START_SHIFT) bins.push("fries");
    if (shift >= RINGS_START_SHIFT) bins.push("rings");
    if (shift >= DRINK_START_SHIFT) bins.push("drink");
    return bins;
  }
  function renderBins() {
    el.bins.innerHTML = "";
    for (const key of unlockedBins(S.shift)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tb-bin";
      b.dataset.bin = key;
      if (key === "patty") {
        const n = S.pantry.patty.length;
        b.innerHTML = `<span class="tb-bin-art">🥩</span><span class="tb-bin-label">Patty ×${n}</span>`;
        b.disabled = n === 0;
        b.setAttribute("aria-label", `Add a plated patty to the build (${n} available)`);
        b.addEventListener("click", addPattyToBuild);
      } else if (key === "bun") {
        b.innerHTML = `<span class="tb-bin-art">🍞</span><span class="tb-bin-label">Bun</span>`;
        b.setAttribute("aria-label", "Bun — bottom bun on an empty plate, top bun to finish");
        b.addEventListener("click", addBun);
      } else if (key === "fries" || key === "rings" || key === "drink") {
        const meta = SIDE_META[key], n = S.pantry[key].length;
        b.innerHTML = `<span class="tb-bin-art">${meta.emoji}</span><span class="tb-bin-label">${meta.short} ×${n}</span>`;
        b.disabled = n === 0;
        b.setAttribute("aria-label", `Add ${meta.label} to the tray (${n} available)`);
        b.addEventListener("click", () => addSideToBuild(key));
      } else {
        const d = LAYERS[key];
        b.innerHTML = `<span class="tb-bin-art">${d.emoji}</span><span class="tb-bin-label">${d.short}</span>`;
        b.setAttribute("aria-label", `Add ${d.label}`);
        b.addEventListener("click", () => addLayer(key));
      }
      el.bins.appendChild(b);
    }
    highlightNextBin();
  }
  function highlightNextBin() {
    const t = ticketById(S.activeTicketId);
    [...el.bins.children].forEach((b) => b.classList.remove("is-next"));
    if (!t) return;
    const idx = S.build ? S.build.layers.length : 0;
    const next = t.layers[idx];
    if (!next) return;
    const key = next === "bun_b" || next === "bun_t" ? "bun" : next;
    const bin = [...el.bins.children].find((b) => b.dataset.bin === key);
    if (bin) bin.classList.add("is-next");
  }

  function buildClosed() { return !!(S.build && S.build.layers.includes("bun_t")); }
  function ensureBuild() {
    if (!S.build) S.build = { layers: [], patties: [], sides: [], log: [] };
    return S.build;
  }

  function addBun() {
    const b = ensureBuild();
    if (b.layers.length === 0) { b.layers.push("bun_b"); b.log.push({ t: "layer", key: "bun_b" }); }
    else if (buildClosed()) { SFX.buzz(); hint("It already has a top bun. Serve it or scrap it."); return; }
    else { b.layers.push("bun_t"); b.log.push({ t: "layer", key: "bun_t" }); }
    SFX.drop(); renderBuild();
  }
  function addLayer(key) {
    if (!S.build || S.build.layers.length === 0) { SFX.buzz(); hint("Bottom bun first — tap the bun."); return; }
    if (buildClosed()) { SFX.buzz(); hint("It already has a top bun. Serve it or scrap it."); return; }
    S.build.layers.push(key);
    S.build.log.push({ t: "layer", key });
    SFX.drop(); renderBuild();
  }
  function addPattyToBuild() {
    if (!S.build || S.build.layers.length === 0) { SFX.buzz(); hint("Bottom bun first — tap the bun."); return; }
    if (buildClosed()) { SFX.buzz(); hint("It already has a top bun."); return; }
    if (!S.pantry.patty.length) { SFX.buzz(); hint("No plated patties — the griddle is behind you."); return; }
    let best = 0;
    S.pantry.patty.forEach((p, i) => { if (p.pct > S.pantry.patty[best].pct) best = i; });
    const patty = S.pantry.patty.splice(best, 1)[0];
    if (S.selectedItem && S.selectedItem.kind === "patty" && S.selectedItem.id === patty.id) S.selectedItem = null;
    S.build.layers.push("patty");
    S.build.patties.push(patty);
    S.build.log.push({ t: "layer", key: "patty" });
    SFX.drop(); renderBuild(); renderPantry(); renderBins();
  }
  function addSideToBuild(type) {
    if (!S.pantry[type].length) {
      SFX.buzz();
      hint(`No ${SIDE_META[type].label.toLowerCase()} ready — check the griddle${type === "drink" ? " or the soda machine" : ""}.`);
      return;
    }
    let best = 0;
    S.pantry[type].forEach((p, i) => { if (p.pct > S.pantry[type][best].pct) best = i; });
    const item = S.pantry[type].splice(best, 1)[0];
    if (S.selectedItem && S.selectedItem.kind === type && S.selectedItem.id === item.id) S.selectedItem = null;
    const b = ensureBuild();
    b.sides.push(item);
    b.log.push({ t: "side", type });
    SFX.drop(); renderBuild(); renderPantry(); renderBins();
  }
  function undoLayer() {
    if (!S.build || !S.build.log.length) return;
    const entry = S.build.log.pop();
    if (entry.t === "side") {
      const item = S.build.sides.pop();
      if (item && S.pantry[entry.type].length < PANTRY_CAP[entry.type]) S.pantry[entry.type].push(item);
      else if (item) S.waste++;
    } else {
      const key = S.build.layers.pop();
      if (key === "patty") {
        const patty = S.build.patties.pop();
        if (patty && S.pantry.patty.length < PANTRY_CAP.patty) S.pantry.patty.push(patty);
        else if (patty) S.waste++;
      }
    }
    if (!S.build.layers.length && !S.build.sides.length) S.build = null;
    SFX.flip(); renderBuild(); renderPantry(); renderBins(); updateHud();
  }
  function scrapBuild() {
    if (!S.build) return;
    S.waste += 1 + S.build.patties.length + S.build.sides.length;
    S.build = null;
    SFX.buzz(); renderBuild(); renderBins(); updateHud();
  }

  function layerDiv(key, mini) {
    const d = LAYERS[key], s = document.createElement("span");
    s.className = mini ? "tb-mini-layer" : "tb-layer";
    s.style.setProperty("--layer-c", d.c);
    if (mini) {
      s.style.setProperty("--mini-w", Math.round(d.w * 0.36) + "px");
      s.style.setProperty("--mini-h", Math.max(4, Math.round(d.h * 0.55)) + "px");
      s.style.setProperty("--mini-r", d.r.startsWith("60%") ? "60% 60% 3px 3px" : "3px");
    } else {
      s.style.setProperty("--layer-w", d.w + "px");
      s.style.setProperty("--layer-h", d.h + "px");
      s.style.setProperty("--layer-r", d.r);
      s.title = d.label;
    }
    const file = LAYER_SPRITE[key];
    if (file) {
      const img = new Image();
      img.className = "tb-layer-art";
      img.alt = "";
      img.draggable = false;
      img.onload = () => s.classList.add("has-art");
      img.src = ART + file;
      s.appendChild(img);
    }
    return s;
  }
  function sideChipSpan(item) {
    const s = document.createElement("span");
    s.className = "tb-mini-side";
    s.textContent = SIDE_META[item.type].emoji;
    s.title = `${SIDE_META[item.type].label} — ${item.grade}`;
    return s;
  }
  function renderBuild() {
    el.buildStack.innerHTML = "";
    if (S.build) for (const key of S.build.layers) el.buildStack.appendChild(layerDiv(key));
    if (el.buildSides) {
      el.buildSides.innerHTML = "";
      if (S.build) for (const item of S.build.sides) el.buildSides.appendChild(sideChipSpan(item));
    }
    highlightNextBin();
    updateBell();
  }

  function hint(msg) {
    el.counterHint.textContent = msg;
    clearTimeout(hint.t);
    hint.t = setTimeout(() => { el.counterHint.textContent = ""; }, 3200);
  }

  /* ---- window: rail + queue + serve --------------------------------------- */
  function renderRail() {
    el.ticketRail.innerHTML = "";
    for (const t of S.tickets) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tb-ticket" + (t.id === S.activeTicketId ? " is-pinned" : "");
      b.dataset.ticket = t.id;
      b.setAttribute("aria-label", `Order ${t.id} for ${t.cust.n}, ${t.layers.length} layers. ${t.id === S.activeTicketId ? "Pinned." : "Click to pin."}`);
      const mini = document.createElement("span");
      mini.className = "tb-mini-stack";
      for (const key of t.layers) mini.appendChild(layerDiv(key, true));
      b.innerHTML = `<span class="tb-ticket-head"><span>#${t.id}</span><span class="tb-ticket-cust">${t.cust.e}</span></span>
        <span class="tb-patience"><span class="tb-patience-fill" style="width:100%"></span></span>`;
      b.appendChild(mini);
      if (t.sides.length) {
        const row = document.createElement("span");
        row.className = "tb-mini-side-row";
        row.textContent = t.sides.map((s) => SIDE_META[s].emoji).join(" ");
        b.appendChild(row);
      }
      b.addEventListener("click", () => pinTicket(t.id));
      el.ticketRail.appendChild(b);
    }
    renderPinned();
    updateBell();
  }
  function pinTicket(id) {
    S.activeTicketId = S.activeTicketId === id ? null : id;
    SFX.drop();
    renderRail(); renderPinned(); highlightNextBin(); updateBell();
  }
  function renderPinned() {
    const t = ticketById(S.activeTicketId);
    if (!t) {
      el.pinnedTicket.innerHTML = `<p class="tb-pinned-empty">Pin a ticket at the window →</p>`;
      return;
    }
    el.pinnedTicket.innerHTML = `<span class="tb-ticket-head"><span>#${t.id} · ${t.cust.n}</span><span class="tb-ticket-cust">${t.cust.e}</span></span>`;
    const mini = document.createElement("span");
    mini.className = "tb-mini-stack";
    for (const key of t.layers) mini.appendChild(layerDiv(key, true));
    el.pinnedTicket.appendChild(mini);
    const list = document.createElement("ol");
    list.style.cssText = "margin:6px 0 0;padding-left:18px;font-size:11px;font-family:var(--mono)";
    for (const key of t.layers) {
      const li = document.createElement("li");
      li.textContent = LAYERS[key].label;
      list.appendChild(li);
    }
    for (const s of t.sides) {
      const li = document.createElement("li");
      li.textContent = SIDE_META[s].label;
      list.appendChild(li);
    }
    el.pinnedTicket.appendChild(list);
  }
  function renderQueue() {
    // Diffed, not rebuilt: a full innerHTML wipe would replay the walk-in
    // animation for every customer already in line each time one more
    // arrives. Existing customers keep their DOM node untouched; only new
    // arrivals get the walk-in, only departures (served) get a walk-out.
    const existing = new Map([...el.queue.children].map((c) => [+c.dataset.ticket, c]));
    const currentIds = new Set(S.tickets.map((t) => t.id));

    for (const [id, node] of existing) {
      if (currentIds.has(id)) continue;
      node.classList.add("is-leaving");
      // reuse the same west-walk sheet mirrored, rather than generating a
      // separate east animation — cheaper and reads correctly for walking
      // back out the door.
      const img = node.querySelector(".tb-cust-art");
      if (img) { img.classList.add("is-mirrored"); playCustWalk(node, img); }
      node.addEventListener("animationend", () => { stopCustAnim(node); node.remove(); }, { once: true });
    }

    for (const t of S.tickets) {
      if (existing.has(t.id)) continue;
      const d = document.createElement("span");
      d.className = "tb-cust is-arriving";
      d.dataset.ticket = t.id;
      d.style.setProperty("--idle-delay", (Math.random() * 1.6).toFixed(2) + "s");
      d.innerHTML = `${t.cust.e}<small>${t.cust.n}</small>`;
      attachCustSprite(d, t.cust.n);
      d.addEventListener("animationend", () => {
        d.classList.replace("is-arriving", "is-waiting");
        const img = d.querySelector(".tb-cust-art");
        if (img) freezeCustStand(d, img);
      }, { once: true });
      el.queue.appendChild(d);
    }
  }

  function updateBell() {
    el.bell.disabled = !(ticketById(S.activeTicketId) && buildClosed());
  }

  function updatePatience() {
    [...el.ticketRail.children].forEach((tEl) => {
      const t = ticketById(+tEl.dataset.ticket);
      if (!t) return;
      const left = clamp(1 - (S.clock - t.bornAt) / t.window, 0, 1);
      const fill = tEl.querySelector(".tb-patience-fill");
      fill.style.width = left * 100 + "%";
      fill.classList.toggle("is-mid", left < 0.55 && left >= 0.25);
      fill.classList.toggle("is-low", left < 0.25);
    });
  }

  /* ---- shift events --------------------------------------------------------
     A schedule of {type, atSpawn} is built at shift start; checkEventSchedule
     (called every tick) fires the next one once S.spawned reaches its
     checkpoint. Only one event runs at a time. The banner lives outside the
     3D world (below the HUD) so it's visible regardless of which facing
     you're turned to — events shouldn't require camera gymnastics. */
  function scheduleEvents() {
    const sched = [];
    const q = S.quota;
    if (S.shift >= 1) {
      sched.push({ type: "boss", atSpawn: Math.min(2, q) });
      if (q >= 4) sched.push({ type: "boss", atSpawn: Math.max(1, q - 1) });
    }
    if (S.shift >= 2 && Math.random() < 0.9) sched.push({ type: "rush", atSpawn: Math.max(1, Math.round(q * 0.4)) });
    if (S.shift >= 2 && Math.random() < 0.55) sched.push({ type: "thief", atSpawn: 1 + rnd(Math.max(1, q - 1)) });
    if (S.shift >= 3 && Math.random() < 0.35) sched.push({ type: "inspector", atSpawn: 1 + rnd(Math.max(1, q - 1)) });
    sched.sort((a, b) => a.atSpawn - b.atSpawn);
    for (let i = 1; i < sched.length; i++) if (sched[i].atSpawn <= sched[i - 1].atSpawn) sched[i].atSpawn = sched[i - 1].atSpawn + 1;
    return sched;
  }
  function checkEventSchedule() {
    if (S.event || !S.eventSchedule.length) return;
    if (S.spawned >= S.eventSchedule[0].atSpawn) startEvent(S.eventSchedule.shift().type);
  }
  function startEvent(type) {
    if (type === "boss") {
      S.event = { type, until: S.clock + 12 };
      toast("Mr. Grabs is walking the floor. Don't waste anything.", "🦀", 3);
    } else if (type === "rush") {
      S.event = { type, until: S.clock + 60, spawnedR: 0, servedR: 0, nextSpawn: S.clock + 1.5 };
      toast("A busload just walked in. RUSH!", "🚌", 3);
    } else if (type === "thief") {
      S.event = { type, until: S.clock + 9, hits: 0 };
      toast("Gremlin is creeping toward the safe!", "🕵️", 3);
    } else if (type === "inspector") {
      S.event = { type, until: S.clock + 45, wipes: 0, clean: true };
      toast("Health inspector! Nothing burnt, and wipe that counter.", "📋", 3);
    }
    renderEventBanner();
  }
  function endEvent(msg, icon) {
    S.event = null;
    toast(msg, icon || "💬", 4);
    updateHud();
    if (S.served >= S.quota && !S.closing && el.orderOverlay.hidden) startClosing();
  }
  function applyBossPenalty() {
    S.tips = Math.max(0, S.tips - 2);
    S.score = Math.max(0, S.score - 15);
    S.eventBonus -= 15;
    toast(BOSS_LINES[rnd(BOSS_LINES.length)], "🦀", 3);
    updateHud();
  }
  function hitThief() {
    if (!S.event || S.event.type !== "thief") return;
    S.event.hits++;
    SFX.flip();
    if (S.event.hits >= THIEF_NEEDED) {
      S.score += 20; S.tips += 3; S.eventBonus += 20;
      endEvent("Yeeted the Gremlin! +20 pts, +3 tips", "🥾");
    } else {
      renderEventBanner();
    }
  }
  function wipeCounter() {
    if (!S.event || S.event.type !== "inspector") return;
    S.event.wipes = Math.min(INSPECTOR_WIPES_NEEDED, S.event.wipes + 1);
    SFX.drop();
    renderEventBanner();
  }
  function updateEvents(dt) {
    if (!S.event) return;
    if (S.event.type === "rush" && S.clock >= S.event.nextSpawn && S.tickets.length < RAIL_MAX) {
      S.event.nextSpawn = S.clock + 3.4;
      S.event.spawnedR++;
      S.tickets.push(genRushTicket());
      SFX.ding();
      renderRail(); renderQueue();
      if (S.face !== 2) el.facingTabs[2].classList.add("has-new");
    }
    if (S.clock < S.event.until) return;
    if (S.event.type === "boss") { endEvent("Mr. Grabs wandered off.", "🦀"); return; }
    if (S.event.type === "rush") {
      const survival = S.event.spawnedR ? S.event.servedR / S.event.spawnedR : 1;
      const bonus = Math.round(survival * 50);
      S.score += bonus; S.eventBonus += bonus;
      endEvent(`Rush survived: ${S.event.servedR}/${S.event.spawnedR} (+${bonus} pts)`, "🚌");
      return;
    }
    if (S.event.type === "thief") {
      const steal = Math.max(3, Math.round(S.tips * 0.15));
      S.tips = Math.max(0, S.tips - steal);
      endEvent(`Gremlin swiped 🪙${steal} from the tip jar.`, "🕵️");
      return;
    }
    if (S.event.type === "inspector") {
      const pass = S.event.clean && S.event.wipes >= INSPECTOR_WIPES_NEEDED;
      if (pass) { S.score += 25; S.eventBonus += 25; endEvent("Passed inspection! +25 pts", "✅"); }
      else { S.score = Math.max(0, S.score - 25); S.eventBonus -= 25; endEvent("Failed inspection. -25 pts", "⚠️"); }
      return;
    }
  }
  function toast(msg, icon, seconds) {
    S.toastMsg = msg; S.toastIcon = icon || "💬"; S.toastUntil = S.clock + (seconds || 3.5);
    renderEventBanner();
    speak(msg, VOICE_PITCH[icon], VOICE_RATE[icon]);
  }
  function renderEventBanner() {
    if (S.event) {
      const meta = EVENT_META[S.event.type];
      el.eventBanner.hidden = false;
      el.eventBanner.classList.remove("is-toast");
      el.eventIcon.textContent = meta.icon;
      el.eventLabel.textContent = meta.label;
      el.eventTimer.textContent = Math.max(0, Math.ceil(S.event.until - S.clock)) + "s";
      if (S.event.type === "rush") {
        el.eventSub.textContent = `${S.event.servedR}/${S.event.spawnedR} served`;
        el.eventAction.hidden = true;
      } else if (S.event.type === "thief") {
        el.eventSub.textContent = `${S.event.hits}/${THIEF_NEEDED} hits`;
        el.eventAction.hidden = false;
        el.eventAction.textContent = "👊 Yeet him";
      } else if (S.event.type === "inspector") {
        el.eventSub.textContent = `wipe ${S.event.wipes}/${INSPECTOR_WIPES_NEEDED}${S.event.clean ? "" : " · burnt served!"}`;
        el.eventAction.hidden = false;
        el.eventAction.textContent = "🧽 Wipe";
      } else {
        el.eventSub.textContent = "Don't waste anything.";
        el.eventAction.hidden = true;
      }
      el.eventBanner.classList.toggle("is-bad", S.event.type === "inspector" && !S.event.clean);
      return;
    }
    if (S.clock < S.toastUntil) {
      el.eventBanner.hidden = false;
      el.eventBanner.classList.add("is-toast");
      el.eventIcon.textContent = S.toastIcon;
      el.eventLabel.textContent = S.toastMsg;
      el.eventSub.textContent = "";
      el.eventTimer.textContent = "";
      el.eventAction.hidden = true;
      return;
    }
    el.eventBanner.hidden = true;
  }

  /* ---- closing time --------------------------------------------------------
     Fires once the last non-rush order is served (and no event is holding
     things up). Three quick tap tasks; total elapsed time feeds a bonus. */
  function startClosing() {
    S.closing = { taskIdx: 0, counts: CLOSING_TASKS.map(() => 0), startedAt: S.clock };
    renderClosing();
  }
  function renderClosing() {
    const c = S.closing; if (!c) return;
    const task = CLOSING_TASKS[c.taskIdx];
    const n = c.counts[c.taskIdx];
    el.closingOverlay.innerHTML = `<div class="tb-overlay-card">
      <h2>Closing time</h2>
      <p class="tb-reaction">Last ticket's out. Button it up before Mr. Grabs locks the door on you.</p>
      <button type="button" class="tb-btn tb-btn-primary tb-closing-btn" id="tb-closing-tap">
        <span style="font-size:28px">${task.icon}</span><br>${task.label} (${n}/${task.needed})
      </button>
    </div>`;
    el.closingOverlay.hidden = false;
    $("#tb-closing-tap").addEventListener("click", tapClosing);
    $("#tb-closing-tap").focus();
  }
  function tapClosing() {
    const c = S.closing; if (!c) return;
    const task = CLOSING_TASKS[c.taskIdx];
    c.counts[c.taskIdx]++;
    SFX.drop();
    if (c.counts[c.taskIdx] >= task.needed) {
      c.taskIdx++;
      if (c.taskIdx >= CLOSING_TASKS.length) { finishClosing(); return; }
    }
    renderClosing();
  }
  function finishClosing() {
    const c = S.closing;
    const elapsed = S.clock - c.startedAt;
    const bonus = Math.max(0, Math.round(40 - elapsed * 3));
    S.score += bonus; S.eventBonus += bonus;
    S.closing = null;
    el.closingOverlay.hidden = true;
    endShift(bonus);
  }

  /* ---- scoring + serve ---------------------------------------------------- */
  function scoreOrder(t, build) {
    const lcs = lcsLen(build.layers, t.layers);
    const extras = build.layers.length - lcs;
    const stack = clamp(Math.round((lcs / t.layers.length) * 100 - extras * 8), 0, 100);
    const need = t.layers.filter((k) => k === "patty").length;
    let grill = 0;
    if (build.patties.length) {
      grill = Math.round(build.patties.reduce((s, p) => s + p.pct, 0) / Math.max(build.patties.length, need));
    }

    let sidesScore = null;
    if (t.sides.length) {
      const avail = build.sides.slice();
      let sum = 0;
      for (const want of t.sides) {
        const idx = avail.findIndex((s) => s.type === want);
        if (idx >= 0) { sum += avail[idx].pct; avail.splice(idx, 1); }
      }
      sidesScore = Math.round(sum / t.sides.length);
    }

    const mood = moodMult(t);
    const raw = sidesScore === null
      ? 0.5625 * stack + 0.4375 * grill               // 45/35 renormalized to 100 when no sides ordered
      : 0.45 * stack + 0.35 * grill + 0.20 * sidesScore;
    const total = clamp(Math.round(raw * mood), 0, 115);
    const tipBonus = S.rank ? S.rank.tipBonus : 1;
    const tip = Math.max(0, Math.round((total / 100) * (3 + t.layers.length * 0.7 + t.sides.length) * t.cust.tip * tipBonus));
    return { stack, grill, sides: sidesScore, mood, total, tip };
  }

  function doServe() {
    const t = ticketById(S.activeTicketId);
    if (!t || !buildClosed()) { SFX.buzz(); return; }
    const build = S.build;
    S.build = null;
    const r = scoreOrder(t, build);
    S.tickets = S.tickets.filter((x) => x.id !== t.id);
    S.activeTicketId = null;

    const servedBurnt = build.patties.some((p) => p.grade === "BURNT") || build.sides.some((s) => s.grade === "BURNT");
    if (servedBurnt && S.event && S.event.type === "inspector") S.event.clean = false;

    if (t.isRush) {
      if (S.event && S.event.type === "rush") S.event.servedR++;
      S.tips += r.tip;
      S.score += Math.round(r.total * 0.3);
    } else {
      S.served++;
      S.score += Math.round(r.total * (t.cust.scoreWeight || 1));
      S.tips += r.tip;
      S.orders.push({ ticket: t, r });
    }

    el.bell.classList.add("is-ringing");
    setTimeout(() => el.bell.classList.remove("is-ringing"), 450);
    SFX.bell();

    // tray flies out through the window
    el.serveSpot.innerHTML = "";
    for (const key of build.layers) el.serveSpot.appendChild(layerDiv(key));
    for (const item of build.sides) el.serveSpot.appendChild(sideChipSpan(item));
    el.serveSpot.classList.remove("is-serving"); void el.serveSpot.offsetWidth;
    el.serveSpot.classList.add("is-serving");

    renderRail(); renderQueue(); renderBuild(); renderBins(); updateHud();
    if (t.isRush) {
      setTimeout(() => { el.serveSpot.innerHTML = ""; }, 620);
    } else {
      setTimeout(() => { el.serveSpot.innerHTML = ""; showOrderScore(t, r); }, 620);
    }
  }

  function reaction(total) {
    for (const [min, line] of REACTIONS) if (total >= min) return line;
    return REACTIONS[REACTIONS.length - 1][1];
  }
  function meterRow(label, val) {
    const cls = val >= 75 ? "" : val >= 45 ? " is-mid" : " is-low";
    return `<div class="tb-meter"><span>${label}</span>
      <span class="tb-meter-track"><span class="tb-meter-fill${cls}" style="width:${clamp(val, 0, 100)}%"></span></span>
      <span class="tb-meter-num">${val}%</span></div>`;
  }
  function showOrderScore(t, r) {
    SFX.coin();
    speak(reaction(r.total), custPitch(t.cust), 1 + (custPitch(t.cust) - 1) * 0.4);
    const sidesRow = r.sides !== null ? meterRow("Sides", r.sides) : "";
    el.orderOverlay.innerHTML = `<div class="tb-overlay-card">
      <h2>Order #${t.id} · ${t.cust.e} ${t.cust.n}</h2>
      <div class="tb-score-grid">
        ${meterRow("Stack", r.stack)}
        ${meterRow("Grill", r.grill)}
        ${sidesRow}
      </div>
      <p class="tb-reaction">“${reaction(r.total)}” <span style="font-style:normal;color:var(--rt-ink-soft)">· mood ×${r.mood.toFixed(2)}</span></p>
      <div class="tb-order-total"><span>+${r.total} pts</span><span class="tb-tip">🪙 ${r.tip} tip</span></div>
      <button type="button" class="tb-btn tb-btn-primary" id="tb-order-next">${S.served >= S.quota && !S.event ? "Clock out" : "Next order"}</button>
    </div>`;
    el.orderOverlay.hidden = false;
    $("#tb-order-next").addEventListener("click", () => {
      el.orderOverlay.hidden = true;
      if (S.served >= S.quota && !S.event) startClosing();
    });
    $("#tb-order-next").focus();
  }

  /* ---- shift lifecycle ---------------------------------------------------- */
  function updateFryUnlocks() {
    el.friesTub.hidden = S.shift < SIDES_START_SHIFT;
    el.ringsTub.hidden = S.shift < RINGS_START_SHIFT;
    el.sodaMachine.hidden = S.shift < DRINK_START_SHIFT;
  }

  function startShift() {
    S.screen = "shift";
    S.rank = rankFor(S.save.totalScore || 0);
    S.quota = Math.min(4 + S.shift, 9);
    S.spawned = 0; S.served = 0; S.score = 0; S.tips = 0; S.waste = 0;
    S.tickets = []; S.activeTicketId = null; S.nextTicket = 1;
    S.grill = new Array(S.rank.grillSlots).fill(null);
    S.baskets = new Array(S.rank.baskets).fill(null);
    S.pantry = { patty: [], fries: [], rings: [], drink: [] };
    S.build = null; S.selectedItem = null; S.orders = [];
    S.drinkFill = 0; S.drinkHolding = false;
    S.eventSchedule = scheduleEvents(); S.event = null; S.eventBonus = 0; S.toastUntil = 0; S.closing = null;
    S.clock = 0; S.spawnAt = 1.2;
    el.title.hidden = true;
    el.game.hidden = false;
    buildSlots(); buildBaskets(); updateFryUnlocks();
    renderPantry(); renderBins(); renderBuild(); renderRail(); renderQueue();
    updateSodaVisual();
    renderEventBanner();
    updateHud();
    face(0, { quiet: true });
    S.running = true;
    lastT = 0;
    requestAnimationFrame(tick);
  }

  function spawnInterval() { return Math.max(6.5, 13 - S.shift * 0.8); }

  function maybeSpawn() {
    if (S.spawned >= S.quota || S.tickets.length >= RAIL_MAX) return;
    if (S.clock < S.spawnAt) return;
    S.spawnAt = S.clock + spawnInterval();
    const isLast = S.spawned === S.quota - 1;
    S.spawned++;
    const forceGrumpy = isLast && S.shift % 7 === 0;
    S.tickets.push(genTicket(S.shift, forceGrumpy));
    SFX.ding();
    renderRail(); renderQueue();
    if (S.face !== 2) el.facingTabs[2].classList.add("has-new");
  }

  function endShift(closingBonus) {
    S.running = false;
    S.screen = "between";
    const sv = S.save;
    const prevRank = S.rank;
    sv.lifetime.shifts++; sv.lifetime.served += S.served;
    sv.lifetime.tips += S.tips; sv.lifetime.waste += S.waste;
    sv.best = Math.max(sv.best || 0, S.score);
    sv.totalScore = (sv.totalScore || 0) + S.score;
    sv.shift = ++S.shift;
    persist();

    // shared weekly ladder — engine is display-only/mock, see docs/LEADERBOARD.md
    try {
      if (window.TrollLeaderboard) window.TrollLeaderboard.record("troll-burger", {
        score: S.score, tips: S.tips, served: S.served,
      });
    } catch (_) {}
    try {
      if (window.TrollNotis && typeof window.TrollNotis.push === "function")
        window.TrollNotis.push({ icon: "🍔", title: "The Rusty Troll", body: `Shift ${S.shift - 1} done — ⭐ ${S.score} and 🪙 ${S.tips} in tips.` });
    } catch (_) {}

    const newRank = rankFor(sv.totalScore);
    const promoted = newRank.index > prevRank.index;
    const pay = paydayBreakdown(S.tips);

    const avg = S.orders.length ? Math.round(S.orders.reduce((s, o) => s + o.r.total, 0) / S.orders.length) : 0;
    const best = S.orders.reduce((b, o) => (o.r.total > (b ? b.r.total : -1) ? o : b), null);
    el.shiftOverlay.innerHTML = `<div class="tb-overlay-card">
      <h2>Shift ${S.shift - 1} — clocked out</h2>
      <p class="tb-shift-big">⭐ ${S.score}</p>
      ${promoted ? `<p class="tb-promo-banner">🎉 Promoted to <strong>${newRank.title}</strong>!</p>` : ""}
      <table class="tb-shift-table">
        <tr><td>Orders served</td><td>${S.served}</td></tr>
        <tr><td>Average order</td><td>${avg}%</td></tr>
        <tr><td>Best order</td><td>${best ? `#${best.ticket.id} ${best.ticket.cust.e} · ${best.r.total}` : "—"}</td></tr>
        <tr><td>Event bonus</td><td>${S.eventBonus >= 0 ? "+" : ""}${S.eventBonus} pts</td></tr>
        <tr><td>Closing bonus</td><td>+${closingBonus || 0} pts</td></tr>
        <tr><td>Tips</td><td>🪙 ${S.tips}</td></tr>
        <tr><td>Food wasted</td><td>🗑 ${S.waste}</td></tr>
        <tr><td>Personal best shift</td><td>⭐ ${sv.best}</td></tr>
      </table>
      <h3 style="margin:2px 0 0;font-family:var(--pixel);font-size:16px">Paycheck (flavor only)</h3>
      <table class="tb-shift-table">
        <tr><td>Gross pay</td><td>$${pay.gross.toFixed(2)}</td></tr>
        ${pay.lines.map((l) => `<tr><td>− ${l.label}</td><td>-$${l.amt.toFixed(2)}</td></tr>`).join("")}
        <tr><td><strong>Net pay</strong></td><td><strong>$${pay.net.toFixed(2)}</strong></td></tr>
      </table>
      <p class="tb-reaction">Mr. Grabs counted the register twice. You may keep working here.</p>
      <div style="display:flex;gap:10px;justify-content:flex-end;width:100%">
        <button type="button" class="tb-btn tb-btn-ghost" id="tb-shift-quit">Go home</button>
        <button type="button" class="tb-btn tb-btn-primary" id="tb-shift-next">Next shift →</button>
      </div>
    </div>`;
    el.shiftOverlay.hidden = false;
    $("#tb-shift-next").addEventListener("click", () => { el.shiftOverlay.hidden = true; startShift(); });
    $("#tb-shift-quit").addEventListener("click", () => {
      el.shiftOverlay.hidden = true;
      el.game.hidden = true;
      el.title.hidden = false;
      S.screen = "title";
      renderTitleStats();
    });
    $("#tb-shift-next").focus();
  }

  /* ---- HUD ---------------------------------------------------------------- */
  function updateHud() {
    el.hudShift.textContent = `Shift ${S.shift} · ${S.served}/${S.quota}`;
    el.hudCoins.textContent = `🪙 ${S.tips}`;
    el.hudScore.textContent = `⭐ ${S.score}`;
    el.hudWaste.textContent = `🗑 ${S.waste}`;
    if (el.hudRank) el.hudRank.textContent = S.rank.title;
  }
  function renderTitleStats() {
    const lt = S.save.lifetime;
    if (!lt.shifts) { el.titleStats.hidden = true; return; }
    el.titleStats.hidden = false;
    const rank = rankFor(S.save.totalScore || 0);
    el.titleStats.textContent =
      `${rank.title} · Shift ${S.save.shift} · best shift ⭐ ${S.save.best} · lifetime 🪙 ${lt.tips} · ${lt.served} served`;
  }

  /* ---- main loop ---------------------------------------------------------- */
  let lastT = 0, patienceAcc = 0, visualAcc = 0;
  function tick(t) {
    if (!S.running) return;
    if (!lastT) lastT = t;
    const dt = Math.min((t - lastT) / 1000, 0.25);
    lastT = t;
    S.clock += dt;

    for (let i = 0; i < S.grill.length; i++) {
      const p = S.grill[i];
      if (!p) continue;
      p.down += COOK_RATE * dt;
      if (p.down > COOK_MAX && !p.burnt) { p.burnt = true; renderSlot(i); }
    }
    for (let i = 0; i < S.baskets.length; i++) {
      const b = S.baskets[i];
      if (!b) continue;
      b.cook += BASKET_RATE * dt;
      if (b.cook > BASKET_MAX && !b.burnt) { b.burnt = true; renderBasket(i); }
    }
    if (S.drinkHolding) {
      S.drinkFill += DRINK_RATE * dt;
      updateSodaVisual();
      if (S.drinkFill >= DRINK_OVERFLOW) {
        S.drinkHolding = false;
        S.waste++;
        S.drinkFill = 0;
        SFX.buzz();
        updateSodaVisual(); updateHud();
      }
    }
    visualAcc += dt;
    if (visualAcc > 0.12) {
      visualAcc = 0;
      for (let i = 0; i < S.grill.length; i++) updateSlotVisual(i);
      for (let i = 0; i < S.baskets.length; i++) if (S.baskets[i]) renderBasket(i);
    }
    patienceAcc += dt;
    if (patienceAcc > 0.5) { patienceAcc = 0; updatePatience(); renderEventBanner(); }

    updateCamera(dt);
    maybeSpawn();
    checkEventSchedule();
    updateEvents(dt);
    requestAnimationFrame(tick);
  }

  /* ---- input wiring ------------------------------------------------------- */
  function wire() {
    el.startBtn.addEventListener("click", startShift);
    el.howtoBtn.addEventListener("click", () => { el.howto.hidden = false; el.howtoClose.focus(); });
    el.howtoClose.addEventListener("click", () => { el.howto.hidden = true; });

    el.turnLeft.addEventListener("click", () => face(S.face - 1));
    el.turnRight.addEventListener("click", () => face(S.face + 1));
    el.facingTabs.forEach((tab, i) => tab.addEventListener("click", () => face(i)));

    el.pattyTub.addEventListener("click", () => {
      const free = S.grill.findIndex((p) => !p);
      if (free === -1) { SFX.buzz(); hint("Griddle is full."); return; }
      layPatty(free);
    });
    el.friesTub.addEventListener("click", () => dropBasket("fries"));
    el.ringsTub.addEventListener("click", () => dropBasket("rings"));
    el.trash.addEventListener("click", trashSelected);
    el.undo.addEventListener("click", undoLayer);
    el.scrap.addEventListener("click", scrapBuild);
    el.bell.addEventListener("click", doServe);

    el.eventAction.addEventListener("click", () => {
      if (!S.event) return;
      if (S.event.type === "thief") hitThief();
      else if (S.event.type === "inspector") wipeCounter();
    });

    el.sodaMachine.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      S.drinkHolding = true;
      updateSodaVisual();
    });
    el.sodaMachine.addEventListener("pointerup", releaseSoda);
    el.sodaMachine.addEventListener("pointerleave", releaseSoda);
    el.sodaMachine.addEventListener("pointercancel", releaseSoda);

    el.soundToggle.addEventListener("click", () => {
      S.soundOn = !S.soundOn;
      el.soundToggle.setAttribute("aria-pressed", String(S.soundOn));
    });

    if (el.fullscreenToggle && el.cabinet && (el.cabinet.requestFullscreen || el.cabinet.webkitRequestFullScreen)) {
      el.fullscreenToggle.addEventListener("click", () => {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else (el.cabinet.requestFullscreen || el.cabinet.webkitRequestFullScreen).call(el.cabinet);
      });
      const syncFsBtn = () => {
        const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
        el.fullscreenToggle.setAttribute("aria-pressed", String(on));
      };
      document.addEventListener("fullscreenchange", syncFsBtn);
      document.addEventListener("webkitfullscreenchange", syncFsBtn);
    } else if (el.fullscreenToggle) {
      el.fullscreenToggle.hidden = true; // Fullscreen API unsupported (rare) — don't show a dead button
    }

    document.addEventListener("keydown", (ev) => {
      if (S.screen !== "shift" || !el.orderOverlay.hidden || !el.shiftOverlay.hidden || !el.howto.hidden) return;
      if (ev.key === "ArrowLeft" || ev.key === "a") face(S.face - 1);
      else if (ev.key === "ArrowRight" || ev.key === "d") face(S.face + 1);
      else if (ev.key === "1") face(0);
      else if (ev.key === "2") face(1);
      else if (ev.key === "3") face(2);
    });

    // VR reticle: spring-follows the mouse, squeezes on grab, widens over
    // anything reachable. Mouse/pen only — touch has its own finger.
    if (FINE_POINTER && el.hand && el.pov) {
      const REACHABLE = ".tb-slot, .tb-slot-plate, .tb-tub, .tb-basket, .tb-soda, .tb-plate, .tb-side-chip, " +
        ".tb-trash, .tb-bin, .tb-ticket, .tb-bell, .tb-turn, .tb-facing-tab, .tb-btn, .tb-icon-btn";
      el.pov.classList.add("has-hand");
      el.pov.addEventListener("pointermove", (ev) => {
        if (ev.pointerType === "touch") return;
        const r = el.pov.getBoundingClientRect();
        cam.handTX = ev.clientX - r.left;
        cam.handTY = ev.clientY - r.top;
        cam.lookTX = clamp((cam.handTX / r.width - 0.5) * 2, -1, 1);
        cam.lookTY = clamp((cam.handTY / r.height - 0.5) * 2, -1, 1);
        el.hand.classList.add("is-active");
        el.hand.classList.toggle("is-over", !!ev.target.closest(REACHABLE));
      });
      el.pov.addEventListener("pointerleave", (ev) => {
        if (ev.pointerType === "touch") return;
        el.hand.classList.remove("is-active");
        cam.lookTX = 0; cam.lookTY = 0;
      });
      el.pov.addEventListener("pointerdown", (ev) => {
        if (ev.pointerType === "touch") return;
        el.hand.classList.add("is-grab");
      });
      window.addEventListener("pointerup", () => el.hand.classList.remove("is-grab"));
    }

    // swipe to turn (the POV is pan-y so vertical scroll still works)
    let touchX = null;
    el.world.parentElement.addEventListener("touchstart", (ev) => { touchX = ev.touches[0].clientX; }, { passive: true });
    el.world.parentElement.addEventListener("touchend", (ev) => {
      if (touchX === null) return;
      const dx = ev.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 44) face(S.face + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }

  /* ---- boot --------------------------------------------------------------- */
  function boot() {
    grabRefs();
    loadSave();
    renderTitleStats();
    wire();
    initWojakSprite();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* smoke-test / debug hook */
  window.__tb = {
    S, LAYERS, SIDE_META, RANKS, genTicket, genRushTicket, rankFor, face, layPatty, flipSlot, plateSlot,
    addBun, addLayer, addPattyToBuild, addSideToBuild, dropBasket, pullBasket,
    pinTicket, doServe, endShift, startShift, scoreOrder, lcsLen,
    pattyGrade, pattyPct, basketGrade, basketPct, drinkPct, drinkGrade,
    updateSodaVisual, releaseSoda,
    startEvent, endEvent, hitThief, wipeCounter, startClosing, tapClosing,
    COOK_MAX, PERFECT, BASKET_MAX, BASKET_PERFECT, DRINK_MAX, DRINK_PERFECT,
  };
})();
