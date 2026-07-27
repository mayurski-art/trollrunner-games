/* Papa Troll's Pizzeria — game 005 in the Troll Runner Arcade.
   Papa's-Pizzeria-style time management: order → build → bake → cut → serve,
   with several customers in flight at once. Pure DOM + a little SVG, no
   frameworks. All sprite art is PixelLab pixel art with emoji/CSS fallbacks,
   so the game is fully playable before/without the PNGs.
   Design doc: docs/TROLL-PIZZERIA.md */
(() => {
  "use strict";

  /* ============================== config ============================== */

  const ART = "assets/games/troll-pizzeria/art/";
  const SAVE_KEY = "troll-pizzeria-save-v1";
  const GAME_ID = "troll-pizzeria";

  /* Pizza Cam (pizza3d.js module): big pies render in 3D when the module
     initialized; everything falls back to the DOM pizza otherwise.
     ?flat=1 forces the fallback (docs/TROLL-PIZZERIA-V2.md). */
  const FLAT_MODE = /[?&]flat=1/.test(location.search);
  const p3d = () => (!FLAT_MODE && window.TrollPizza3D && window.TrollPizza3D.ok ? window.TrollPizza3D : null);
  const view3d = (t, opts) => ({
    sauce: t.build.sauce, cheese: t.build.cheese, placed: t.build.placed,
    doneness: t.doneness, cutAngles: t.cutAngles, halfGuide: !!(opts && opts.halfGuide),
  });

  const BAKE_SECONDS = 46;          // 0 → 1.0 doneness in the oven
  const OVEN_SLOTS = 4;
  const PIZZA_RADIUS = 0.44;        // max topping distance from center (0..1)

  const AMOUNTS = ["none", "light", "normal", "extra"];

  const TOPPINGS = [
    { id: "pepperoni", name: "Pepperoni",    emoji: "🍕", color: "#c0392b", day: 1 },
    { id: "mushrooms", name: "Mushrooms",    emoji: "🍄", color: "#d7ccc8", day: 1 },
    { id: "olives",    name: "Olives",       emoji: "🫒", color: "#3e2723", day: 2 },
    { id: "peppers",   name: "Green pepper", emoji: "🫑", color: "#2e7d32", day: 3 },
    { id: "sausage",   name: "Sausage",      emoji: "🍖", color: "#8d5524", day: 4 },
    { id: "onions",    name: "Onions",       emoji: "🧅", color: "#e1bee7", day: 5 },
    { id: "basil",     name: "Basil",        emoji: "🌿", color: "#43a047", day: 6 },
    { id: "pineapple", name: "Pineapple",    emoji: "🍍", color: "#fbc02d", day: 7 },
  ];

  const BAKES = [
    { id: "light",   name: "Light bake",   target: 0.45 },
    { id: "regular", name: "Regular bake", target: 0.62 },
    { id: "well",    name: "Well done",    target: 0.8  },
  ];

  const CUSTOMERS = [
    { id: "trollio", name: "Trollio", sprite: "char-trollio.png", emoji: "🧌", patience: 75,  tip: 1.0, day: 1, quirk: "chaos",
      lines: { great: "Problem? None found. NONE.", ok: "Hmm. Acceptable. For now.", bad: "Congratulations. You trolled yourself." } },
    { id: "pepe",    name: "Pepe",    sprite: "char-pepe.png",    emoji: "🐸", patience: 115, tip: 1.2, day: 1, quirk: "simple",
      lines: { great: "Feels good man.", ok: "It's ok I guess...", bad: "Feels bad man." } },
    { id: "doge",    name: "Doge",    sprite: "char-doge.png",    emoji: "🐶", patience: 95,  tip: 1.0, day: 2, quirk: "pepperoni",
      lines: { great: "Wow. Much pizza. Very topping.", ok: "Such medium. Many okay.", bad: "No pizza. Only sad." } },
    { id: "wojak",   name: "Wojak",   sprite: "char-wojak.png",   emoji: "😔", patience: 95,  tip: 0.9, day: 3, quirk: "plain",
      lines: { great: "For once... something good happened to me.", ok: "Yeah. That's about what I expected.", bad: "It's over." } },
    { id: "chad",    name: "Chad",    sprite: "char-chad.png",    emoji: "🗿", patience: 68,  tip: 1.5, day: 4, quirk: "everything",
      lines: { great: "Yes. This is what peak pizza looks like.", ok: "Average slice for average people.", bad: "Weak. Utterly weak." } },
    { id: "nana",    name: "Nana Troll", sprite: "char-nana.png", emoji: "👵", patience: 150, tip: 1.1, day: 5, quirk: "light",
      lines: { great: "Sweetie, Papa Troll raised you well.", ok: "Grandma still loves you anyway.", bad: "Back in my day we baked with pride." } },
    { id: "harold",  name: "Harold",  sprite: "char-harold.png",  emoji: "😅", patience: 100, tip: 1.0, day: 6, quirk: "well",
      lines: { great: "This smile is genuine. For once.", ok: "It's... fine. Everything is fine.", bad: "*smiles through the pain*" } },
    { id: "grumpy",  name: "Grumpy",  sprite: "char-grumpy.png",  emoji: "😾", patience: 65,  tip: 2.2, day: 7, quirk: "critic",
      lines: { great: "It was awful. (That means good.)", ok: "I've had worse. Barely.", bad: "NO. Just... no." } },
  ];

  const RANKS = [
    [0, "Dough Trainee"], [150, "Sauce Cadet"], [400, "Cheese Sergeant"],
    [800, "Topping Wizard"], [1400, "Oven Warlock"], [2200, "Slice Samurai"],
    [3200, "Pizza Trollmaster"],
  ];

  /* ============================== helpers ============================== */

  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const pct = (v) => Math.round(v * 100);

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  /* Pixel sprite with graceful emoji fallback: shows the emoji immediately,
     swaps in the PNG only once it actually loads. */
  function sprite(file, emoji, cls) {
    const wrap = el("span", cls || "");
    const fb = el("span", "pz-fallback", emoji);
    wrap.appendChild(fb);
    const img = new Image();
    img.className = "px-art";
    img.alt = "";
    img.draggable = false;
    img.onload = () => fb.replaceWith(img);   // swap in place: keeps z-order
    img.src = ART + file;
    return wrap;
  }

  /* ============================== audio =============================== */

  const Sfx = (() => {
    let ctx = null, on = true;
    try { on = localStorage.getItem("pz-sound") !== "0"; } catch (_) {}
    const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
    function tone(freq, dur, type = "square", gain = 0.04, when = 0, slide = 0) {
      if (!on) return;
      try {
        const c = ac(), t = c.currentTime + when;
        const o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
        o.connect(g).connect(c.destination);
        o.start(t); o.stop(t + dur + 0.02);
      } catch (_) {}
    }
    return {
      get on() { return on; },
      toggle() { on = !on; try { localStorage.setItem("pz-sound", on ? "1" : "0"); } catch (_) {} return on; },
      bell()  { tone(880, 0.12, "triangle", 0.06); tone(1320, 0.3, "triangle", 0.05, 0.09); },
      plop()  { tone(300, 0.08, "sine", 0.06, 0, -140); },
      splat() { tone(140, 0.12, "sawtooth", 0.03, 0, -60); },
      whoosh(){ tone(200, 0.35, "sawtooth", 0.02, 0, 320); },
      pull()  { tone(520, 0.18, "triangle", 0.05, 0, -220); },
      cut()   { tone(1600, 0.06, "square", 0.035, 0, -900); },
      ding()  { tone(1174, 0.4, "triangle", 0.06); tone(1760, 0.5, "triangle", 0.045, 0.12); },
      coin(n = 3) { for (let i = 0; i < n; i++) tone(1046 + i * 180, 0.09, "square", 0.035, i * 0.07); },
      grr()   { tone(160, 0.3, "sawtooth", 0.05, 0, -60); },
      jingle(){ [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, "triangle", 0.05, i * 0.11)); },
    };
  })();

  /* ============================== state =============================== */

  const S = {
    screen: "title",
    station: "order",
    // persistent
    day: 1, xp: 0, lifetimeTips: 0, bestDay: 0, daysWorked: 0, servedTotal: 0,
    // shift
    roster: [], arrivalsLeft: 0, nextArrivalIn: 0, stormedOut: 0,
    lobby: [], waiting: [], tickets: [],
    activeTicketId: null,
    ovens: Array(OVEN_SLOTS).fill(null),   // ticket ids
    builtShelf: [], cutShelf: [],          // ticket ids
    bakeSelect: null,                       // ticket id picked up at bake station
    dayScore: 0, dayTips: 0, servedToday: 0,
    armedBin: null,
    cut: { ticketId: null, needed: 0, done: [], sweeping: false, angle: 0, raf: 0 },
    lastTick: 0, ticketSeq: 1,
  };

  /* Cross-device progress: when logged in, mirrored into the shared
     troll_game_saves table (same table/pattern Trollrreria uses) so a
     shift picked up on another device resumes with the right day/XP/tips.
     Guests keep the old device-local SAVE_KEY only. */
  const cloudCacheKey = (uid) => `${SAVE_KEY}:cloud-cache:${uid}`;
  let cachedUserId = null;

  function snapshot() {
    return {
      day: S.day, xp: S.xp, lifetimeTips: S.lifetimeTips, bestDay: S.bestDay,
      daysWorked: S.daysWorked, servedTotal: S.servedTotal,
    };
  }
  function applySnapshot(d) {
    if (!d) return;
    Object.assign(S, {
      day: d.day || 1, xp: d.xp || 0, lifetimeTips: d.lifetimeTips || 0,
      bestDay: d.bestDay || 0, daysWorked: d.daysWorked || 0, servedTotal: d.servedTotal || 0,
    });
  }
  function readLocal(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (_) { return null; }
  }

  async function loadCloudSave(userId) {
    const sb = window.TrollrunnerAccounts?.getClient?.();
    if (!sb) return null;
    try {
      const { data, error } = await sb.from("troll_game_saves")
        .select("data, updated_at").eq("user_id", userId).eq("game_id", GAME_ID).maybeSingle();
      if (error) { console.warn("[pizzeria] cloud load failed:", error); return null; }
      if (!data) return null;
      return { save: data.data, updatedAt: new Date(data.updated_at).getTime() };
    } catch (e) { console.warn("[pizzeria] cloud load threw:", e); return null; }
  }

  async function saveCloudSave(userId, data) {
    const sb = window.TrollrunnerAccounts?.getClient?.();
    if (!sb) return false;
    try {
      const { error } = await sb.from("troll_game_saves").upsert({
        user_id: userId, game_id: GAME_ID, data, updated_at: new Date().toISOString(),
      });
      if (error) console.warn("[pizzeria] cloud save failed:", error);
      return !error;
    } catch (e) { console.warn("[pizzeria] cloud save threw:", e); return false; }
  }

  function save() {
    const data = snapshot();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (_) {}
    if (cachedUserId) {
      try { localStorage.setItem(cloudCacheKey(cachedUserId), JSON.stringify({ ...data, savedAt: Date.now() })); } catch (_) {}
      void saveCloudSave(cachedUserId, data);
    }
  }
  function load() {
    applySnapshot(readLocal(SAVE_KEY));
  }

  /* Reconciles local progress against the cloud once a session resolves:
     prefers whichever of (cloud row, this device's cloud cache) is newer,
     and seeds the cloud from local play the first time an account logs in
     on a device that already has unsynced progress. */
  async function reconcileCloudSave() {
    if (!cachedUserId) return;
    const cloud = await loadCloudSave(cachedUserId);
    const cached = readLocal(cloudCacheKey(cachedUserId));
    if (cloud && (!cached || cloud.updatedAt >= (cached.savedAt || 0))) {
      applySnapshot(cloud.save);
    } else if (cached) {
      applySnapshot(cached);
      if (!cloud || cached.savedAt > cloud.updatedAt) void saveCloudSave(cachedUserId, snapshot());
    } else {
      const legacy = readLocal(SAVE_KEY);
      if (legacy && legacy.daysWorked > 0) {
        applySnapshot(legacy);
        void saveCloudSave(cachedUserId, legacy);
      }
    }
    if (S.screen === "title") showTitle();
  }

  window.addEventListener("trollrunner:auth-changed", (e) => {
    const uid = e.detail?.userId || null;
    cachedUserId = uid;
    if (uid) void reconcileCloudSave();
    else { load(); if (S.screen === "title") showTitle(); }
  });

  async function initCloudSync() {
    try {
      const session = await window.TrollrunnerAccounts?.getSession?.();
      cachedUserId = session?.userId || null;
    } catch (_) { cachedUserId = null; }
    if (cachedUserId) await reconcileCloudSave();
  }

  const rankName = (xp) => { let r = RANKS[0][1]; for (const [need, name] of RANKS) if (xp >= need) r = name; return r; };
  const unlockedToppings = (day) => TOPPINGS.filter(t => t.day <= day);
  const unlockedCustomers = (day) => CUSTOMERS.filter(c => c.day <= day);
  const ticketById = (id) => S.tickets.find(t => t.id === id);

  /* ============================ order generator ======================== */

  function genOrder(cust, day) {
    const pool = unlockedToppings(day);
    const bake = cust.quirk === "well" ? BAKES[2] : pick(BAKES);
    const cutCount = cust.quirk === "critic" ? 8 : pick([4, 6, 8, 8]);
    const amount = () => pick(["light", "normal", "normal", "extra"]);
    const tops = [];
    const used = new Set();
    const addTop = (t, count, side) => { if (t && !used.has(t.id)) { used.add(t.id); tops.push({ id: t.id, count, side: side || "whole" }); } };
    const maybeHalf = (p) => (Math.random() < p ? pick(["left", "right"]) : "whole");

    switch (cust.quirk) {
      case "plain":                                   // Wojak: cheese only, exact bake
        break;
      case "simple":                                  // Pepe: one easy topping
        addTop(pick(pool), pick([4, 6]), "whole");
        break;
      case "pepperoni": {                             // Doge: much pepperoni
        addTop(TOPPINGS[0], pick([8, 10, 12]), "whole");
        if (Math.random() < 0.5) addTop(pick(pool), 4, maybeHalf(0.3));
        break;
      }
      case "light":                                   // Nana: a little of two things
        addTop(pick(pool), 4, "whole");
        if (Math.random() < 0.6) addTop(pick(pool), 4, "whole");
        break;
      case "everything": {                            // Chad: loaded pie
        const kinds = Math.min(pool.length, pick([3, 4]));
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        for (let i = 0; i < kinds; i++) addTop(shuffled[i], pick([4, 6]), "whole");
        break;
      }
      case "chaos": {                                 // Trollio: cursed half/half
        addTop(pick(pool), pick([6, 8]), pick(["left", "right"]));
        addTop(pick(pool), pick([4, 6]), pick(["left", "right", "whole"]));
        break;
      }
      case "critic": {                                // Grumpy: demanding, precise
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        addTop(shuffled[0], 8, "whole");
        if (shuffled[1]) addTop(shuffled[1], 6, maybeHalf(0.5));
        break;
      }
      default:
        addTop(pick(pool), pick([4, 6, 8]), maybeHalf(0.15));
        if (Math.random() < 0.4) addTop(pick(pool), pick([4, 6]), maybeHalf(0.15));
    }
    const sauce = cust.quirk === "light" ? "light" : amount();
    const cheese = cust.quirk === "light" ? "light" : amount();
    return { sauce, cheese, tops, bake: bake.id, cutCount };
  }

  /* ============================== scoring ============================= */

  const sideOf = (p) => (p.x < 0.5 ? "left" : "right");

  function scoreOrder(t) {
    const o = t.order, b = t.build;
    let parts = 0, total = 0;
    // sauce + cheese amounts
    total += 1; parts += o.sauce === b.sauce ? 1 : (Math.abs(AMOUNTS.indexOf(o.sauce) - AMOUNTS.indexOf(b.sauce)) === 1 ? 0.5 : 0);
    total += 1; parts += o.cheese === b.cheese ? 1 : (Math.abs(AMOUNTS.indexOf(o.cheese) - AMOUNTS.indexOf(b.cheese)) === 1 ? 0.5 : 0);
    // toppings: right kind, right count, right side
    const placedByType = {};
    for (const p of b.placed) (placedByType[p.tid] ||= []).push(p);
    for (const entry of o.tops) {
      total += 2;
      const placed = placedByType[entry.id] || [];
      delete placedByType[entry.id];
      let good;
      if (entry.side === "whole") good = placed.length;
      else good = placed.filter(p => sideOf(p) === entry.side).length;
      const wrongSide = placed.length - good;
      const countScore = Math.max(0, 1 - Math.abs(good - entry.count) / entry.count) ;
      parts += 2 * clamp(countScore - wrongSide * 0.12, 0, 1);
    }
    // toppings that don't belong at all
    const strays = Object.values(placedByType).reduce((n, arr) => n + arr.length, 0);
    parts -= strays * 0.25;
    // evenness bonus: quadrant spread of everything placed
    if (b.placed.length >= 4) {
      const q = [0, 0, 0, 0];
      for (const p of b.placed) q[(p.x < 0.5 ? 0 : 1) + (p.y < 0.5 ? 0 : 2)]++;
      const mean = b.placed.length / 4;
      const varc = q.reduce((s, n) => s + (n - mean) ** 2, 0) / 4;
      total += 0.5;
      parts += 0.5 * clamp(1 - Math.sqrt(varc) / (mean + 1), 0, 1);
    }
    return clamp(parts / Math.max(total, 1), 0, 1);
  }

  function scoreBake(t) {
    const target = BAKES.find(b => b.id === t.order.bake).target;
    const d = t.doneness;
    if (d >= 0.95) return 0.15;                       // burnt to a crisp
    const err = Math.abs(d - target);
    return clamp(1 - err / 0.3, 0.05, 1);
  }

  function scoreCut(t) {
    if (!t.cutAngles.length) return 0.1;
    const k = t.order.cutCount / 2;
    const ideal = Array.from({ length: k }, (_, i) => (i * 180) / k);
    const used = new Set();
    let err = 0;
    for (const a of t.cutAngles) {
      let best = 1e9, bi = -1;
      ideal.forEach((g, i) => {
        if (used.has(i)) return;
        const d = Math.min(Math.abs(a - g), 180 - Math.abs(a - g));
        if (d < best) { best = d; bi = i; }
      });
      used.add(bi); err += best;
    }
    const mean = err / t.cutAngles.length;
    const halfGuide = 90 / k;                          // worst sensible miss
    return clamp(1 - mean / halfGuide, 0.05, 1);
  }

  function moodMult(t) { return clamp(0.8 + 0.35 * t.mood, 0.8, 1.15); }

  function scoreTicket(t) {
    const order = scoreOrder(t), bake = scoreBake(t), cut = scoreCut(t);
    const total = clamp((order * 0.45 + bake * 0.3 + cut * 0.25) * moodMult(t), 0, 1);
    const tip = Math.max(1, Math.round(total * t.cust.tip * rand(9, 14)));
    return { order, bake, cut, total, tip };
  }

  /* ============================ pizza rendering ======================== */

  /* Layer stack inside a .pz-pizza-wrap. Fallback CSS discs render first;
     the PNG replaces its own disc when it loads. */
  function pizzaLayer(container, file, fallbackCss, inset) {
    const fb = el("div", "pz-layer-fallback");
    Object.assign(fb.style, fallbackCss, { inset: inset + "%" });
    container.appendChild(fb);
    const img = new Image();
    img.className = "pz-layer px-art";
    img.alt = "";
    img.style.inset = inset + "%";
    img.style.width = (100 - inset * 2) + "%";
    img.style.height = (100 - inset * 2) + "%";
    // swap in place — appending on load would paint the layer OVER toppings
    img.onload = () => fb.replaceWith(img);
    img.src = ART + file;
    return { fb, img, setOpacity(v) { fb.style.opacity = v; img.style.opacity = v; } };
  }

  const AMOUNT_INSET = { light: 16, normal: 11, extra: 7 };

  function renderPizza(container, t, opts = {}) {
    container.innerHTML = "";
    container.classList.add("pz-pizza");
    // dough
    pizzaLayer(container, "pizza-dough.png", { background: "radial-gradient(circle, #f4d9a4 62%, #e8b96b 78%, #c99a52 100%)", boxShadow: "inset 0 -6px 12px rgba(0,0,0,0.12)" }, 2);
    // sauce
    if (t.build.sauce !== "none")
      pizzaLayer(container, "pizza-sauce.png", { background: "radial-gradient(circle, #d94f36 0%, #cf3b28 82%, #b02e1e 100%)" }, AMOUNT_INSET[t.build.sauce] + 2);
    // cheese
    if (t.build.cheese !== "none")
      pizzaLayer(container, "pizza-cheese.png", { background: "radial-gradient(circle, #fbe294 0%, #f6d365 78%, #eec14e 100%)" }, AMOUNT_INSET[t.build.cheese] + 4);
    // bake overlay: golden cheese art cross-fades in as it bakes
    if (t.doneness > 0.05) {
      const baked = pizzaLayer(container, "pizza-baked.png", { background: "radial-gradient(circle, rgba(214,143,60,0.9) 0%, rgba(190,120,45,0.85) 80%, rgba(150,90,35,0.9) 100%)" }, 4);
      baked.setOpacity(clamp(t.doneness * 1.15, 0, 1).toFixed(2));
    }
    // half guide while building a half/half order
    if (opts.halfGuide) container.appendChild(el("div", "pz-half-guide"));
    // toppings
    for (const p of t.build.placed) {
      const top = TOPPINGS.find(x => x.id === p.tid);
      const n = sprite("top-" + p.tid + ".png", top.emoji, "pz-topping");
      n.style.left = p.x * 100 + "%";
      n.style.top = p.y * 100 + "%";
      n.dataset.idx = t.build.placed.indexOf(p);
      container.appendChild(n);
    }
    // cut lines
    if (t.cutAngles.length) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      for (const a of t.cutAngles) svg.appendChild(cutLine(a, "pz-cutline"));
      container.appendChild(svg);
    }
    // burnt look
    const burn = Math.max(0, (t.doneness - 0.85) / 0.15);
    container.style.filter = burn > 0 ? `saturate(${1 - burn * 0.5}) brightness(${1 - burn * 0.45})` : "";
  }

  function cutLine(angleDeg, cls) {
    const a = (angleDeg * Math.PI) / 180, r = 46;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", 50 - r * Math.cos(a)); line.setAttribute("y1", 50 - r * Math.sin(a));
    line.setAttribute("x2", 50 + r * Math.cos(a)); line.setAttribute("y2", 50 + r * Math.sin(a));
    line.setAttribute("class", cls);
    return line;
  }

  /* ============================== tickets ============================== */

  function takeOrder(cust) {
    const t = {
      id: S.ticketSeq++,
      cust,
      order: genOrder(cust, S.day),
      build: { sauce: "none", cheese: "none", placed: [] },
      doneness: 0, cutAngles: [],
      state: "building",
      mood: cust.patienceLeft / cust.patience,
    };
    S.tickets.push(t);
    S.waiting.push(cust);
    if (S.activeTicketId === null) S.activeTicketId = t.id;
    Sfx.bell();
    return t;
  }

  const bakeName = (id) => BAKES.find(b => b.id === id).name;

  function ticketHtml(t, live) {
    const o = t.order;
    const rows = [];
    const b = t.build;
    const amountRow = (label, want, have) => {
      const cls = live ? (have === want ? "done" : (AMOUNTS.indexOf(have) > AMOUNTS.indexOf(want) ? "over" : "")) : "";
      return `<li class="${cls}">${label}: ${want}</li>`;
    };
    rows.push(amountRow("Sauce", o.sauce, b.sauce));
    rows.push(amountRow("Cheese", o.cheese, b.cheese));
    for (const e of o.tops) {
      const top = TOPPINGS.find(x => x.id === e.id);
      let have = 0;
      for (const p of b.placed) if (p.tid === e.id && (e.side === "whole" || sideOf(p) === e.side)) have++;
      const cls = live ? (have === e.count ? "done" : (have > e.count ? "over" : "")) : "";
      const side = e.side === "whole" ? "" : ` <span class="tk-side">· ${e.side} half</span>`;
      rows.push(`<li class="${cls}">${e.count}× ${top.name}${side}${live ? ` <span class="tk-side">(${have})</span>` : ""}</li>`);
    }
    rows.push(`<li>${bakeName(o.bake)}</li>`);
    rows.push(`<li>${o.cutCount} slices</li>`);
    return `<h4>${t.cust.emoji} ${t.cust.name} · #${String(t.id).padStart(2, "0")}</h4><ul>${rows.join("")}</ul>`;
  }

  /* =============================== HUD ================================ */

  const STATE_LABEL = { building: "build", built: "to oven", baking: "baking", baked: "cut", cutting: "cut", served: "done" };
  const STATE_STATION = { building: "build", built: "bake", baking: "bake", baked: "cut", cutting: "cut" };

  function renderHud() {
    $("#pz-hud-day").textContent = "Day " + S.day;
    $("#pz-hud-coins").textContent = "🪙 " + S.dayTips;
    $("#pz-hud-score").textContent = "⭐ " + Math.round(S.dayScore);
    const rack = $("#pz-ticket-rack");
    rack.innerHTML = "";
    for (const t of S.tickets) {
      if (t.state === "served") continue;
      const m = el("button", "pz-mini-ticket" + (t.id === S.activeTicketId && t.state === "building" ? " is-active" : ""));
      m.type = "button";
      m.innerHTML = `<strong>${t.cust.emoji} #${String(t.id).padStart(2, "0")}</strong><span class="st">${STATE_LABEL[t.state]}</span>`;
      m.setAttribute("aria-label", `Ticket ${t.id} for ${t.cust.name}, status: ${STATE_LABEL[t.state]}`);
      m.addEventListener("click", () => {
        if (t.state === "building") { S.activeTicketId = t.id; switchStation("build"); }
        else switchStation(STATE_STATION[t.state] || "order");
      });
      rack.appendChild(m);
    }
  }

  function renderBadges() {
    const counts = {
      order: S.lobby.filter(c => !c.walking).length,
      build: S.tickets.filter(t => t.state === "building").length,
      bake: S.builtShelf.length + S.ovens.filter(Boolean).length,
      cut: S.cutShelf.length + (S.cut.ticketId ? 1 : 0),
    };
    let ovenUrgent = false;
    for (const id of S.ovens) {
      if (!id) continue;
      const t = ticketById(id);
      const target = BAKES.find(b => b.id === t.order.bake).target;
      if (t.doneness >= target - 0.04) ovenUrgent = true;
    }
    document.querySelectorAll(".pz-tab").forEach(tab => {
      const st = tab.dataset.station;
      const badge = tab.querySelector(".pz-tab-badge");
      const n = counts[st];
      badge.hidden = !n;
      badge.textContent = n;
      badge.classList.toggle("pulse", st === "bake" && ovenUrgent);
    });
  }

  /* ============================ order station ========================== */

  function spawnCustomer() {
    const c = Object.assign({}, pickArrival());
    c.patienceLeft = c.patience;
    c.walking = true;
    S.lobby.push(c);
    renderLobby();
    // walk-in: rendered off-screen left, then slides to its queue spot
    requestAnimationFrame(() => requestAnimationFrame(() => {
      c.walking = false;
      const node = document.querySelector(`.pz-cust[data-cid="${c.uid}"]`);
      if (node) node.style.transform = "translateX(0)";
      setTimeout(renderLobby, 1150);
    }));
  }

  function pickArrival() {
    const c = S.roster.shift();
    c.uid = "u" + Math.random().toString(36).slice(2, 8);
    return c;
  }

  function renderLobby() {
    const q = $("#pz-lobby-queue");
    q.innerHTML = "";
    S.lobby.forEach((c, i) => {
      const node = el("button", "pz-cust" + (i === 0 && !c.walking ? " at-counter" : "") + (c.walking ? " walking" : ""));
      node.type = "button";
      node.dataset.cid = c.uid;
      node.setAttribute("aria-label", (i === 0 ? "Take order from " : "") + c.name);
      const bar = el("div", "pz-patience");
      const fill = el("i");
      const frac = c.patienceLeft / c.patience;
      fill.style.width = pct(frac) + "%";
      fill.style.background = frac > 0.5 ? "var(--pz-good)" : frac > 0.25 ? "#e8a013" : "var(--pz-bad)";
      bar.appendChild(fill);
      node.appendChild(bar);
      node.appendChild(sprite(c.sprite, c.emoji));
      node.appendChild(el("span", "pz-cust-name", c.name));
      if (c.walking) node.style.transform = "translateX(-70vw)";
      if (i === 0 && !c.walking) node.addEventListener("click", () => orderFromCounter());
      q.appendChild(node);
    });
    const first = S.lobby[0];
    $("#pz-take-order").hidden = !first || first.walking;
    $("#pz-lobby-hint").textContent = first
      ? `${first.name} is at the counter.`
      : S.arrivalsLeft > 0 || S.roster.length
        ? "Waiting for customers…"
        : "No more customers today — finish the open tickets!";
    renderWaitingRow();
  }

  function renderWaitingRow() {
    const row = $("#pz-waiting-row");
    row.innerHTML = "";
    for (const c of S.waiting) {
      const chip = el("span", "pz-wait-chip");
      chip.appendChild(sprite(c.sprite, c.emoji));
      chip.appendChild(el("span", "", c.name));
      row.appendChild(chip);
    }
  }

  function orderFromCounter() {
    const c = S.lobby.shift();
    if (!c) return;
    takeOrder(c);
    renderLobby(); renderHud(); renderBadges(); renderBuild();
    switchStation("build");
  }

  /* ============================ build station ========================== */

  function activeTicket() {
    let t = ticketById(S.activeTicketId);
    if (!t || t.state !== "building") {
      t = S.tickets.find(x => x.state === "building") || null;
      S.activeTicketId = t ? t.id : null;
    }
    return t;
  }

  function renderBuild() {
    const t = activeTicket();
    const ticketBox = $("#pz-build-ticket");
    const pizzaBox = $("#pz-build-pizza");
    const hasHalf = t && t.order.tops.some(e => e.side !== "whole");
    if (!t) {
      if (p3d()) p3d().unmount();
      ticketBox.innerHTML = "";
      pizzaBox.innerHTML = "";
      $("#pz-build-hint").textContent = "No open ticket — take an order first.";
      $("#pz-to-oven").disabled = true;
      renderBins(null);
      updateAmountButtons(null);
      return;
    }
    ticketBox.innerHTML = `<div class="pz-ticket">${ticketHtml(t, true)}</div>`;
    if (p3d()) {
      p3d().mount(pizzaBox);
      p3d().sync(view3d(t, { halfGuide: hasHalf }));
    } else {
      renderPizza(pizzaBox, t, { halfGuide: hasHalf });
    }
    $("#pz-build-hint").textContent = hasHalf
      ? "Half orders: left half is the LEFT side of the pie as you look at it."
      : "Drag toppings from the bins — or click a bin, then click the pie.";
    $("#pz-to-oven").disabled = false;
    renderBins(t);
    updateAmountButtons(t);
  }

  function updateAmountButtons(t) {
    const s = $("#pz-sauce-btn strong"), c = $("#pz-cheese-btn strong");
    s.textContent = t ? t.build.sauce : "—";
    c.textContent = t ? t.build.cheese : "—";
  }

  function renderBins(t) {
    const bins = $("#pz-bins");
    bins.innerHTML = "";
    for (const top of unlockedToppings(S.day)) {
      const b = el("button", "pz-bin" + (S.armedBin === top.id ? " is-armed" : ""));
      b.type = "button";
      b.dataset.tid = top.id;
      b.setAttribute("aria-label", "Topping bin: " + top.name);
      b.appendChild(sprite("top-" + top.id + ".png", top.emoji));
      b.appendChild(el("span", "", top.name));
      let have = 0;
      if (t) for (const p of t.build.placed) if (p.tid === top.id) have++;
      b.appendChild(el("small", "", have ? have + " on pie" : " "));
      bins.appendChild(b);
    }
  }

  /* Pointer interactions: drag from bin → pie, drag topping off pie to
     remove, or click-to-arm a bin then click the pie (touch friendly +
     keyboard reachable). */
  function setupBuildPointer() {
    const bins = $("#pz-bins");
    const pizzaBox = $("#pz-build-pizza");
    let drag = null; // { tid, ghost, fromIdx }

    function ghostAt(x, y, tid, emoji) {
      const g = el("div", "pz-drag-ghost");
      g.appendChild(sprite("top-" + tid + ".png", emoji));
      g.style.left = x + "px"; g.style.top = y + "px";
      document.body.appendChild(g);
      return g;
    }
    const topOf = (tid) => TOPPINGS.find(x => x.id === tid);

    bins.addEventListener("pointerdown", (ev) => {
      const bin = ev.target.closest(".pz-bin");
      if (!bin || !activeTicket()) return;
      ev.preventDefault();
      drag = { tid: bin.dataset.tid, ghost: null, sx: ev.clientX, sy: ev.clientY, moved: false };
    });

    pizzaBox.addEventListener("pointerdown", (ev) => {
      const t = activeTicket();
      if (!t) return;
      // picking up a topping already on the pie (3D: raycast, DOM: node hit)
      let idx = null;
      if (p3d() && p3d().isMounted(pizzaBox)) {
        idx = p3d().toppingAt(ev.clientX, ev.clientY);
      } else {
        const topNode = ev.target.closest(".pz-topping");
        if (topNode) idx = +topNode.dataset.idx;
      }
      if (idx !== null && t.build.placed[idx]) {
        ev.preventDefault();
        const p = t.build.placed[idx];
        t.build.placed.splice(idx, 1);
        drag = { tid: p.tid, ghost: ghostAt(ev.clientX, ev.clientY, p.tid, topOf(p.tid).emoji), moved: true, repositioning: true };
        renderBuild();
        return;
      }
      // click-to-place with an armed bin
      if (S.armedBin) placeAt(ev);
    });

    document.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 7) {
        drag.moved = true;
        drag.ghost = ghostAt(ev.clientX, ev.clientY, drag.tid, topOf(drag.tid).emoji);
      }
      if (drag.ghost) { drag.ghost.style.left = ev.clientX + "px"; drag.ghost.style.top = ev.clientY + "px"; }
    });

    document.addEventListener("pointerup", (ev) => {
      if (!drag) return;
      const d = drag; drag = null;
      if (d.ghost) d.ghost.remove();
      const t = activeTicket();
      if (!d.moved) {
        // plain click on a bin: toggle armed mode
        S.armedBin = S.armedBin === d.tid ? null : d.tid;
        renderBins(t);
        return;
      }
      if (t && placeAt(ev, d.tid)) return;
      if (d.repositioning) { Sfx.plop(); renderBuild(); } // dropped off the pie = removed
    });

    function placeAt(ev, tid) {
      const t = activeTicket();
      if (!t) return false;
      let x, y;
      if (p3d() && p3d().isMounted(pizzaBox)) {
        const hit = p3d().pointToPie(ev.clientX, ev.clientY);
        if (!hit) return false;
        x = hit.x; y = hit.y;
      } else {
        const rect = pizzaBox.getBoundingClientRect();
        x = (ev.clientX - rect.left) / rect.width;
        y = (ev.clientY - rect.top) / rect.height;
      }
      const dist = Math.hypot(x - 0.5, y - 0.5);
      if (dist > PIZZA_RADIUS) return false;
      t.build.placed.push({ tid: tid || S.armedBin, x: clamp(x, 0.06, 0.94), y: clamp(y, 0.06, 0.94) });
      Sfx.plop();
      renderBuild(); renderHud();
      return true;
    }
  }

  function cycleAmount(kind) {
    const t = activeTicket();
    if (!t) return;
    const cur = AMOUNTS.indexOf(t.build[kind]);
    t.build[kind] = AMOUNTS[(cur + 1) % AMOUNTS.length];
    Sfx.splat();
    renderBuild();
  }

  function sendToOven() {
    const t = activeTicket();
    if (!t) return;
    t.state = "built";
    S.builtShelf.push(t.id);
    S.activeTicketId = null;
    S.armedBin = null;
    Sfx.whoosh();
    renderBuild(); renderHud(); renderBadges(); renderBake();
    switchStation("bake");
  }

  /* ============================ bake station =========================== */

  function renderBake() {
    const slots = $("#pz-oven-slots");
    slots.innerHTML = "";
    S.ovens.forEach((id, i) => {
      const slot = el("button", "pz-oven-slot" + (id ? "" : " is-empty") + (S.bakeSelect && !id ? " slot-target" : ""));
      slot.type = "button";
      const t = id ? ticketById(id) : null;
      slot.setAttribute("aria-label", t ? `Oven slot ${i + 1}: ${t.cust.name}'s pizza — click to pull out` : `Oven slot ${i + 1}: empty`);
      const pie = el("div", "slot-pizza");
      if (t) renderPizza(pie, t);
      slot.appendChild(pie);
      const bar = el("div", "pz-doneness");
      const fill = el("i");
      if (t) {
        fill.style.width = pct(t.doneness) + "%";
        const tgt = el("span", "tgt");
        tgt.style.left = pct(BAKES.find(b => b.id === t.order.bake).target) + "%";
        bar.appendChild(tgt);
      }
      bar.appendChild(fill);
      slot.appendChild(bar);
      slot.appendChild(el("span", "pz-slot-label", t ? bakeName(t.order.bake) : "empty"));
      slot.addEventListener("click", () => bakeSlotClick(i));
      slots.appendChild(slot);
    });

    const row = $("#pz-built-row");
    row.innerHTML = "";
    for (const id of S.builtShelf) {
      const t = ticketById(id);
      const b = el("button", "pz-shelf-pizza" + (S.bakeSelect === id ? " is-selected" : ""));
      b.type = "button";
      b.setAttribute("aria-label", `Raw pizza for ${t.cust.name} — click to pick up`);
      const pie = el("div", "slot-pizza");
      pie.style.width = "100%"; pie.style.height = "100%"; pie.style.position = "relative";
      renderPizza(pie, t);
      b.appendChild(pie);
      b.appendChild(el("span", "who", t.cust.emoji + " #" + t.id));
      b.addEventListener("click", () => {
        S.bakeSelect = S.bakeSelect === id ? null : id;
        renderBake();
      });
      row.appendChild(b);
    }
    $("#pz-bake-hint").textContent = S.bakeSelect
      ? "Now click an empty oven slot."
      : "Click a raw pie, then an empty slot. Click a baking pie to pull it out.";
  }

  function bakeSlotClick(i) {
    const id = S.ovens[i];
    if (id) {                                          // pull it out
      const t = ticketById(id);
      S.ovens[i] = null;
      t.state = "baked";
      S.cutShelf.push(t.id);
      Sfx.pull();
      renderBake(); renderHud(); renderBadges(); renderCutShelf();
    } else if (S.bakeSelect) {                         // slide one in
      const t = ticketById(S.bakeSelect);
      S.builtShelf = S.builtShelf.filter(x => x !== t.id);
      S.ovens[i] = t.id;
      t.state = "baking";
      S.bakeSelect = null;
      Sfx.whoosh();
      renderBake(); renderHud(); renderBadges();
    }
  }

  /* ============================= cut station =========================== */

  function renderCutShelf() {
    const row = $("#pz-cutshelf-row");
    row.innerHTML = "";
    for (const id of S.cutShelf) {
      const t = ticketById(id);
      const b = el("button", "pz-shelf-pizza" + (S.cut.ticketId === id ? " is-selected" : ""));
      b.type = "button";
      b.setAttribute("aria-label", `Baked pizza for ${t.cust.name} — click to cut`);
      const pie = el("div", "slot-pizza");
      pie.style.width = "100%"; pie.style.height = "100%"; pie.style.position = "relative";
      renderPizza(pie, t);
      b.appendChild(pie);
      b.appendChild(el("span", "who", t.cust.emoji + " #" + t.id));
      b.addEventListener("click", () => pickForCut(id));
      row.appendChild(b);
    }
  }

  function pickForCut(id) {
    stopSweeper();
    S.cut = { ticketId: id, needed: ticketById(id).order.cutCount / 2, done: [], sweeping: false, angle: 0, raf: 0 };
    const t = ticketById(id);
    t.state = "cutting";
    renderCutShelf(); renderCutTable();
  }

  function renderCutTable() {
    const box = $("#pz-cut-pizza");
    const t = S.cut.ticketId ? ticketById(S.cut.ticketId) : null;
    if (!t) {
      if (p3d()) p3d().unmount();
      box.innerHTML = "";
      $("#pz-cut-hint").textContent = "Pick a baked pie from the shelf.";
      $("#pz-cut-btn").hidden = true;
      $("#pz-serve-btn").hidden = true;
      return;
    }
    const k = t.order.cutCount / 2;
    if (p3d()) {
      p3d().mount(box);
      p3d().sync(Object.assign(view3d(t), {
        cutNeeded: k, sweeping: S.cut.sweeping, sweepAngle: S.cut.angle,
      }));
    } else {
      renderPizza(box, t);
      // guide + sweeper overlay
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.id = "pz-cut-svg";
      for (let i = 0; i < k; i++) svg.appendChild(cutLine((i * 180) / k, "pz-guide"));
      for (const a of S.cut.done) svg.appendChild(cutLine(a, "pz-cutline"));
      if (S.cut.sweeping) {
        const sweep = cutLine(S.cut.angle, "pz-sweeper");
        sweep.id = "pz-sweep-line";
        svg.appendChild(sweep);
      }
      box.appendChild(svg);
    }

    const left = S.cut.needed - S.cut.done.length;
    if (left > 0) {
      $("#pz-cut-hint").textContent = S.cut.sweeping
        ? `Click CUT when the roller lines up — ${left} cut${left > 1 ? "s" : ""} to go.`
        : `${t.cust.name} wants ${t.order.cutCount} slices (${S.cut.needed} cuts). Ready?`;
      $("#pz-cut-btn").hidden = false;
      $("#pz-cut-btn").textContent = S.cut.sweeping ? "🔪 Cut!" : "🔪 Start cutting";
      $("#pz-serve-btn").hidden = true;
    } else {
      $("#pz-cut-hint").textContent = "Looking sharp. Ring the bell!";
      $("#pz-cut-btn").hidden = true;
      $("#pz-serve-btn").hidden = false;
    }
  }

  function cutButton() {
    if (!S.cut.ticketId) return;
    if (!S.cut.sweeping) { startSweeper(); renderCutTable(); return; }
    doCut();
  }

  function startSweeper() {
    S.cut.sweeping = true;
    const speed = 55 + Math.min(S.day * 3, 35);        // deg/sec, creeps up over days
    let last = performance.now();
    const step = (now) => {
      if (!S.cut.sweeping) return;
      S.cut.angle = (S.cut.angle + speed * (now - last) / 1000) % 180;
      last = now;
      if (p3d()) {
        p3d().updateSweep(S.cut.angle);
      } else {
        const lineEl = document.getElementById("pz-sweep-line");
        if (lineEl) {
          const rep = cutLine(S.cut.angle, "pz-sweeper");
          rep.id = "pz-sweep-line";
          lineEl.replaceWith(rep);
        }
      }
      S.cut.raf = requestAnimationFrame(step);
    };
    S.cut.raf = requestAnimationFrame(step);
  }

  function stopSweeper() {
    S.cut.sweeping = false;
    if (S.cut.raf) cancelAnimationFrame(S.cut.raf);
  }

  function doCut() {
    const t = ticketById(S.cut.ticketId);
    S.cut.done.push(S.cut.angle);
    t.cutAngles.push(S.cut.angle);
    Sfx.cut();
    if (S.cut.done.length >= S.cut.needed) stopSweeper();
    renderCutTable();
  }

  /* ================================ serve ============================== */

  function serve() {
    const t = ticketById(S.cut.ticketId);
    if (!t) return;
    stopSweeper();
    const res = scoreTicket(t);
    t.state = "served";
    t.result = res;
    S.cutShelf = S.cutShelf.filter(x => x !== t.id);
    S.cut = { ticketId: null, needed: 0, done: [], sweeping: false, angle: 0, raf: 0 };
    S.waiting = S.waiting.filter(c => c.uid !== t.cust.uid);
    S.servedToday++;
    S.servedTotal++;
    S.dayScore += res.total * 100;
    S.dayTips += res.tip;
    S.lifetimeTips += res.tip;

    const mood = res.total >= 0.85 ? "great" : res.total >= 0.6 ? "ok" : "bad";
    if (mood === "bad") Sfx.grr(); else Sfx.ding();
    setTimeout(() => Sfx.coin(Math.min(6, Math.ceil(res.tip / 3))), 500);

    // Pizza Cam money shot: one quick spin of the finished pie, then the
    // score overlay pops. Falls straight through to the overlay without 3D.
    if (p3d() && p3d().isMounted($("#pz-cut-pizza"))) p3d().serveSpin(() => showServeOverlay(t, res, mood));
    else showServeOverlay(t, res, mood);
  }

  function showServeOverlay(t, res, mood) {
    const ov = $("#pz-serve-overlay");
    const meter = (label, v) => `
      <div class="pz-meter"><label><span>${label}</span><span>${pct(v)}%</span></label>
      <div class="pz-meter-bar"><i data-w="${pct(v)}" class="${v >= 0.8 ? "" : v >= 0.5 ? "mid" : "low"}"></i></div></div>`;
    ov.innerHTML = `<div class="pz-overlay-card">
      <div class="pz-serve-cust"></div>
      <h2>${t.cust.name}'s pizza</h2>
      <p class="pz-serve-line">“${t.cust.lines[mood]}”</p>
      <div class="pz-meters">
        ${meter("Order", res.order)}${meter("Bake", res.bake)}${meter("Cut", res.cut)}
      </div>
      <p class="pz-serve-total">${pct(res.total)}<small>%</small></p>
      <p class="pz-serve-tip">Tip: 🪙 ${res.tip} · mood ×${moodMult(t).toFixed(2)}</p>
      <button type="button" class="pz-btn pz-btn-primary" id="pz-serve-next">Next!</button>
    </div>`;
    ov.querySelector(".pz-serve-cust").appendChild(sprite(t.cust.sprite, t.cust.emoji));
    ov.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ov.querySelectorAll(".pz-meter-bar i").forEach(i => { i.style.width = i.dataset.w + "%"; });
    }));
    $("#pz-serve-next").addEventListener("click", () => {
      ov.hidden = true;
      renderHud(); renderBadges(); renderCutShelf(); renderCutTable(); renderLobby();
      checkDayEnd();
    });
  }

  /* ============================== day flow ============================= */

  function buildRoster() {
    const n = Math.min(3 + S.day, 9);
    const pool = unlockedCustomers(S.day).filter(c => c.quirk !== "critic");
    const roster = [];
    for (let i = 0; i < n; i++) roster.push(Object.assign({}, pool[i % pool.length]));
    roster.sort(() => Math.random() - 0.5);
    if (S.day % 7 === 0) {
      const critic = CUSTOMERS.find(c => c.quirk === "critic");
      if (critic && critic.day <= S.day) roster.push(Object.assign({}, critic));
    }
    return roster;
  }

  function startShift() {
    S.roster = buildRoster();
    S.arrivalsLeft = S.roster.length;
    S.nextArrivalIn = 1.2;
    S.lobby = []; S.waiting = []; S.tickets = [];
    S.ovens = Array(OVEN_SLOTS).fill(null);
    S.builtShelf = []; S.cutShelf = [];
    S.activeTicketId = null; S.bakeSelect = null; S.armedBin = null; S.stormedOut = 0;
    S.dayScore = 0; S.dayTips = 0; S.servedToday = 0; S.ticketSeq = 1;
    S.cut = { ticketId: null, needed: 0, done: [], sweeping: false, angle: 0, raf: 0 };
    S.screen = "game";
    $("#pz-title").style.display = "none";
    $("#pz-game").hidden = false;
    switchStation("order");
    renderHud(); renderBadges(); renderLobby(); renderBuild(); renderBake(); renderCutShelf(); renderCutTable();
    Sfx.jingle();
  }

  function checkDayEnd() {
    const open = S.tickets.filter(t => t.state !== "served").length;
    if (S.arrivalsLeft > 0 || S.lobby.length > 0 || open > 0) return;
    endDay();
  }

  function endDay() {
    const xpGain = Math.round(S.dayScore / 10);
    S.xp += xpGain;
    S.daysWorked++;
    const newBest = S.dayScore > S.bestDay;
    if (newBest) S.bestDay = Math.round(S.dayScore);

    // shared weekly ladder — engine is display-only/mock, see docs/LEADERBOARD.md
    try {
      if (window.TrollLeaderboard) window.TrollLeaderboard.record(GAME_ID, {
        score: Math.round(S.dayScore), tips: S.dayTips, served: S.servedToday,
      });
    } catch (_) {}
    try {
      if (window.TrollNotis && typeof window.TrollNotis.push === "function")
        window.TrollNotis.push({ icon: "🍕", title: "Papa Troll's Pizzeria", body: `Day ${S.day} done — ⭐ ${Math.round(S.dayScore)} and 🪙 ${S.dayTips} in tips.` });
    } catch (_) {}

    const nextDay = S.day + 1;
    const newTops = TOPPINGS.filter(t => t.day === nextDay);
    const newCusts = CUSTOMERS.filter(c => c.day === nextDay);
    const rows = S.tickets.map(t =>
      `<tr><td>${t.cust.emoji} ${t.cust.name}</td><td>${pct(t.result.total)}%</td><td>🪙 ${t.result.tip}</td></tr>`).join("");
    const stormed = S.stormedOut ? `<p class="pz-serve-line">${S.stormedOut} customer${S.stormedOut > 1 ? "s" : ""} stormed out. Trolled.</p>` : "";
    const unlocks = (newTops.length || newCusts.length)
      ? `<div class="pz-unlock">Tomorrow: ${[...newTops.map(t => t.emoji + " " + t.name), ...newCusts.map(c => c.emoji + " " + c.name)].join(" · ")}</div>`
      : "";

    const ov = $("#pz-day-overlay");
    ov.innerHTML = `<div class="pz-overlay-card">
      <h2>Day ${S.day} complete!</h2>
      <table class="pz-day-table"><tbody>${rows}</tbody></table>
      ${stormed}
      <p class="pz-serve-total">⭐ ${Math.round(S.dayScore)}${newBest ? " · new best!" : ""}</p>
      <p class="pz-serve-tip">Tips: 🪙 ${S.dayTips} · XP +${xpGain} · rank: ${rankName(S.xp)}</p>
      ${unlocks}
      <button type="button" class="pz-btn pz-btn-primary" id="pz-next-day">Start day ${nextDay}</button>
      <button type="button" class="pz-btn pz-btn-ghost" id="pz-to-title">Back to title</button>
    </div>`;
    ov.hidden = false;
    Sfx.jingle();

    S.day = nextDay;
    save();

    $("#pz-next-day").addEventListener("click", () => { ov.hidden = true; startShift(); });
    $("#pz-to-title").addEventListener("click", () => { ov.hidden = true; showTitle(); });
  }

  /* =============================== ticking ============================= */

  function tick(dt) {
    if (S.screen !== "game") return;
    // arrivals
    if (S.arrivalsLeft > 0 && S.lobby.length < 4) {
      S.nextArrivalIn -= dt;
      if (S.nextArrivalIn <= 0) {
        S.arrivalsLeft--;
        S.nextArrivalIn = rand(Math.max(8, 22 - S.day * 1.4), Math.max(13, 30 - S.day * 1.4));
        spawnCustomer();
        renderBadges();
      }
    }
    // patience: lobby customers can storm out; waiting customers just sulk
    let lobbyChanged = false;
    for (const c of [...S.lobby]) {
      c.patienceLeft -= dt;
      if (c.patienceLeft <= 0) {
        S.lobby = S.lobby.filter(x => x !== c);
        S.stormedOut++;
        lobbyChanged = true;
        Sfx.grr();
      }
    }
    for (const c of S.waiting) c.patienceLeft = Math.max(0, c.patienceLeft - dt * 0.5);
    // ovens
    let baking = false;
    for (const id of S.ovens) {
      if (!id) continue;
      const t = ticketById(id);
      t.doneness = clamp(t.doneness + dt / BAKE_SECONDS, 0, 1);
      baking = true;
    }
    // lightweight re-renders only where things move
    if (lobbyChanged) { renderLobby(); checkDayEnd(); }
    else if (S.lobby.length) updatePatienceBars();
    if (baking && S.station === "bake") renderBakeBarsOnly();
    renderBadges();
  }

  function updatePatienceBars() {
    document.querySelectorAll("#pz-lobby-queue .pz-cust").forEach((node, i) => {
      const c = S.lobby[i];
      if (!c) return;
      const fill = node.querySelector(".pz-patience i");
      const frac = c.patienceLeft / c.patience;
      fill.style.width = pct(frac) + "%";
      fill.style.background = frac > 0.5 ? "var(--pz-good)" : frac > 0.25 ? "#e8a013" : "var(--pz-bad)";
    });
  }

  function renderBakeBarsOnly() {
    document.querySelectorAll("#pz-oven-slots .pz-oven-slot").forEach((slot, i) => {
      const id = S.ovens[i];
      if (!id) return;
      const t = ticketById(id);
      const fill = slot.querySelector(".pz-doneness i");
      if (fill) fill.style.width = pct(t.doneness) + "%";
      const burn = Math.max(0, (t.doneness - 0.85) / 0.15);
      const pie = slot.querySelector(".slot-pizza");
      if (pie && t.doneness > 0.05) {
        // cheap doneness repaint: refresh the whole mini pie once per second-ish
        if (!slot.dataset.lastPaint || +slot.dataset.lastPaint < Date.now() - 1000) {
          slot.dataset.lastPaint = Date.now();
          renderPizza(pie, t);
        }
        if (burn > 0) pie.style.filter = `saturate(${1 - burn * 0.5}) brightness(${1 - burn * 0.45})`;
      }
    });
  }

  /* ============================== stations ============================= */

  function switchStation(name) {
    S.station = name;
    if (name !== "build" && name !== "cut" && p3d()) p3d().unmount();  // stop the 3D loop off-station
    document.querySelectorAll(".pz-station").forEach(s => s.classList.remove("is-active"));
    $("#st-" + name).classList.add("is-active");
    document.querySelectorAll(".pz-tab").forEach(t => t.classList.toggle("is-active", t.dataset.station === name));
    if (name === "build") renderBuild();
    if (name === "bake") renderBake();
    if (name === "cut") { renderCutShelf(); renderCutTable(); }
    if (name === "order") renderLobby();
  }

  /* =============================== title =============================== */

  function showTitle() {
    S.screen = "title";
    $("#pz-game").hidden = true;
    $("#pz-title").style.display = "";
    const stats = $("#pz-title-stats");
    if (S.daysWorked > 0) {
      stats.hidden = false;
      stats.textContent = `Day ${S.day} · ${rankName(S.xp)} · best day ⭐ ${S.bestDay} · lifetime tips 🪙 ${S.lifetimeTips}`;
      $("#pz-start-btn").textContent = `Continue — Day ${S.day}`;
    } else {
      $("#pz-start-btn").textContent = "Start shift";
    }
  }

  /* ================================ boot =============================== */

  function boot() {
    load();
    void initCloudSync();

    // title chef sprite + lobby backdrop + oven art (all with fallbacks)
    $("#pz-title-chef").appendChild(sprite("char-chef.png", "🧌"));
    const lobbyBg = new Image();
    lobbyBg.className = "pz-lobby-bg px-art";
    lobbyBg.alt = "";
    lobbyBg.onload = () => $("#pz-lobby-scene").prepend(lobbyBg);
    lobbyBg.src = ART + "bg-lobby.png";
    const ovenArt = new Image();
    ovenArt.className = "px-art";
    ovenArt.alt = "";
    ovenArt.onload = () => $("#pz-oven-art").appendChild(ovenArt);
    ovenArt.src = ART + "oven.png";

    // controls
    $("#pz-start-btn").addEventListener("click", startShift);
    $("#pz-howto-btn").addEventListener("click", () => { $("#pz-howto").hidden = false; });
    $("#pz-howto-close").addEventListener("click", () => { $("#pz-howto").hidden = true; });
    $("#pz-take-order").addEventListener("click", orderFromCounter);
    $("#pz-sauce-btn").addEventListener("click", () => cycleAmount("sauce"));
    $("#pz-cheese-btn").addEventListener("click", () => cycleAmount("cheese"));
    $("#pz-clear-btn").addEventListener("click", () => {
      const t = activeTicket();
      if (!t) return;
      t.build = { sauce: "none", cheese: "none", placed: [] };
      Sfx.splat();
      renderBuild(); renderHud();
    });
    $("#pz-to-oven").addEventListener("click", sendToOven);
    $("#pz-cut-btn").addEventListener("click", cutButton);
    $("#pz-serve-btn").addEventListener("click", serve);
    document.querySelectorAll(".pz-tab").forEach(tab =>
      tab.addEventListener("click", () => switchStation(tab.dataset.station)));

    const soundBtn = $("#pz-sound-toggle");
    soundBtn.setAttribute("aria-pressed", String(Sfx.on));
    soundBtn.addEventListener("click", () => soundBtn.setAttribute("aria-pressed", String(Sfx.toggle())));

    document.addEventListener("keydown", (ev) => {
      if (S.screen !== "game" || ev.target.matches("input, textarea")) return;
      if (ev.key >= "1" && ev.key <= "4") switchStation(["order", "build", "bake", "cut"][+ev.key - 1]);
      if ((ev.key === " " || ev.key === "Enter") && S.station === "cut" && S.cut.sweeping) {
        ev.preventDefault();
        doCut();
      }
    });

    // Pizza Cam module loads async (ES module) — swap the big pie to 3D
    // whenever it comes up while the build station is showing.
    window.addEventListener("pizza3d:ready", () => {
      if (S.screen === "game" && S.station === "build") renderBuild();
    });

    setupBuildPointer();
    showTitle();

    // main clock
    S.lastTick = performance.now();
    setInterval(() => {
      const now = performance.now();
      tick((now - S.lastTick) / 1000);
      S.lastTick = now;
    }, 200);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // Debug/smoke-test handle (same pattern as Bridge Patrol's __bp)
  window.__pz = { S, ticketById, switchStation, checkDayEnd, BAKES, TOPPINGS };
})();
