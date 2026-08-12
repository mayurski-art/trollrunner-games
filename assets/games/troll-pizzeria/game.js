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

  /* Pizza Cam (pizza3d.js) / Kitchen3D (kitchen3d.js): big pies render in
     3D when a 3D module initialized; everything falls back to the DOM
     pizza otherwise. ?flat=1 forces the fallback (docs/TROLL-PIZZERIA-V2.md,
     docs/TROLL-PIZZERIA-3D.md). Kitchen3D supersedes the old Pizza-Cam-in-
     a-small-canvas experience whenever it's available — same WebGL gate,
     so in practice it's "3D kitchen, or flat DOM," never both. p3d() picks
     whichever pie backend is actually live for the currently-active
     station, so all the existing build/cut code that already calls
     p3d().sync(view), p3d().mount(...), etc. keeps working unchanged. */
  const FLAT_MODE = /[?&]flat=1/.test(location.search);
  const k3d = () => (!FLAT_MODE && window.TrollKitchen3D && window.TrollKitchen3D.ok ? window.TrollKitchen3D : null);
  const p3d = () => {
    const k = k3d();
    if (k) return k.pieBackend(S.station === "cut" ? "cut" : "build");
    return (!FLAT_MODE && window.TrollPizza3D && window.TrollPizza3D.ok) ? window.TrollPizza3D : null;
  };
  const view3d = (t, opts) => ({
    sauce: quantizeCoverage(t.build.sauce), cheese: quantizeCoverage(t.build.cheese), placed: t.build.placed,
    doneness: t.doneness, cutAngles: t.cutAngles, halfGuide: !!(opts && opts.halfGuide),
  });

  const BAKE_SECONDS = 46;          // 0 → 1.0 doneness in the oven
  const OVEN_SLOTS = 5;              // v3: 5th slot added alongside the sides system
  const PIZZA_RADIUS = 0.44;        // max topping distance from center (0..1)

  const AMOUNTS = ["none", "light", "normal", "extra"];

  /* Sauce/cheese coverage (v3): tickets still ask in familiar buckets, but
     the build side is a continuous 0..1 painted amount, not a 4-step
     cycle. COVERAGE_TARGET anchors the old bucket semantics to a point on
     that continuum so scoring/tuning didn't need to change shape. */
  const COVERAGE_TARGET = { light: 0.35, normal: 0.6, extra: 0.85 };
  const COVERAGE_BAND = 0.12;
  const PAINT_STEP = 0.02;
  // Pizza Cam (pizza3d.js) still renders 4 fixed radii — quantize the
  // continuous coverage down to its nearest bucket rather than reworking
  // the 3D mesh for a continuum the player mostly judges by eye anyway.
  const quantizeCoverage = (c) => (c < 0.15 ? "none" : c < 0.475 ? "light" : c < 0.725 ? "normal" : "extra");

  const TOPPINGS = [
    { id: "pepperoni", name: "Pepperoni",    emoji: "🍕", color: "#c0392b", day: 1 },
    { id: "mushrooms", name: "Mushrooms",    emoji: "🍄", color: "#d7ccc8", day: 1 },
    { id: "olives",    name: "Olives",       emoji: "🫒", color: "#3e2723", day: 2 },
    { id: "peppers",   name: "Green pepper", emoji: "🫑", color: "#2e7d32", day: 3 },
    { id: "sausage",   name: "Sausage",      emoji: "🍖", color: "#8d5524", day: 4 },
    { id: "onions",    name: "Onions",       emoji: "🧅", color: "#e1bee7", day: 5 },
    { id: "basil",     name: "Basil",        emoji: "🌿", color: "#43a047", day: 6 },
    { id: "pineapple", name: "Pineapple",    emoji: "🍍", color: "#fbc02d", day: 7 },
    { id: "bacon",     name: "Bacon",        emoji: "🥓", color: "#a8452f", day: 8 },
    { id: "jalapeno",  name: "Jalapeño",     emoji: "🌶️", color: "#4c8c2e", day: 9 },
    { id: "anchovy",   name: "Anchovy",      emoji: "🐟", color: "#6f7f96", day: 10 },
  ];

  /* Specialty tickets (v3): fixed-recipe orders instead of the usual
     procedural spec. Same order shape as genOrder() output, so scoring
     and ticket rendering need no special cases — just a flat tip bonus
     and a badge. Unlocked gradually, chance rises with day. */
  const SPECIALTIES = [
    { name: "Meme Special", day: 5, sauce: "normal", cheese: "extra",
      tops: [{ id: "pepperoni", count: 8, side: "whole" }, { id: "mushrooms", count: 6, side: "whole" }],
      bake: "regular", cutCount: 8, tipMult: 1.3 },
    { name: "Trollio's Chaos Pie", day: 6, sauce: "extra", cheese: "light",
      tops: [{ id: "pineapple", count: 6, side: "left" }, { id: "olives", count: 6, side: "right" }],
      bake: "regular", cutCount: 6, tipMult: 1.35 },
    { name: "Grumpy's Grumble", day: 8, sauce: "light", cheese: "normal",
      tops: [{ id: "anchovy", count: 8, side: "whole" }, { id: "peppers", count: 4, side: "whole" }],
      bake: "well", cutCount: 8, tipMult: 1.4 },
  ];
  const unlockedSpecialties = (day) => SPECIALTIES.filter(s => s.day <= day);

  /* Sides (v3): a light second task riding along on the same ticket.
     Soda is an instant build-station tap; breadsticks bake in the SAME
     oven slot as the pizza (shares the slot, doesn't reserve one) on
     their own doneness clock — the player pulls once for both. */
  const SIDES = {
    soda: { name: "Soda", emoji: "🥤" },
    breadsticks: { name: "Breadsticks", emoji: "🥖", target: 0.5, speed: 1.7 },
  };

  /* Meta progression (v3): permanent upgrades bought with the Til Jar
     (10% of each day's tips, banked automatically at day end — separate
     from lifetimeTips, which stays a pure stat). Each id maps 1:1 to an
     S.upgrades field, so buying just flips/increments that field. */
  const UPGRADES = [
    { id: "oven1", name: "Faster oven I", desc: "-3s bake time", cost: 40 },
    { id: "oven2", name: "Faster oven II", desc: "-3s more bake time", cost: 90, requires: "oven1" },
    { id: "oven3", name: "Faster oven III", desc: "-3s more bake time", cost: 160, requires: "oven2" },
    { id: "slot6", name: "6th oven slot", desc: "one more pie (or breadsticks) baking at once", cost: 220 },
    { id: "patience", name: "Thicker skin", desc: "+15% customer patience", cost: 70 },
    { id: "steady", name: "Steady hands", desc: "topping placement scoring is more forgiving", cost: 80 },
    { id: "grinInsurance", name: "Grin insurance", desc: "one bad station a day won't reset your Grin Combo", cost: 120 },
  ];
  const ovenLevelIds = ["oven1", "oven2", "oven3"];
  const upgradeOwned = (id) => id === "oven1" ? S.upgrades.ovenLevel >= 1
    : id === "oven2" ? S.upgrades.ovenLevel >= 2
    : id === "oven3" ? S.upgrades.ovenLevel >= 3
    : !!S.upgrades[id];
  const ovenSlotsCount = () => OVEN_SLOTS + (S.upgrades.slot6 ? 1 : 0);
  const bakeSeconds = () => BAKE_SECONDS - S.upgrades.ovenLevel * 3;
  const patienceMult = () => (S.upgrades.patience ? 1.15 : 1);

  const BAKES = [
    { id: "light",   name: "Light bake",   target: 0.45 },
    { id: "regular", name: "Regular bake", target: 0.62 },
    { id: "well",    name: "Well done",    target: 0.8  },
  ];

  const CUSTOMERS = [
    { id: "trollio", name: "Trollio", sprite: "char-trollio.png", emoji: "😏", patience: 75,  tip: 1.0, day: 1, quirk: "chaos",
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
      gotcha(){ tone(700, 0.06, "square", 0.05, 0, 500); tone(1400, 0.1, "square", 0.045, 0.05); },
      trollHeh(){ [900, 700, 500].forEach((f, i) => tone(f, 0.09, "sawtooth", 0.045, i * 0.06, -80)); },
      grin()  { tone(660, 0.08, "triangle", 0.05, 0, 260); tone(990, 0.14, "triangle", 0.05, 0.07, 260); },
      alarm() { [0, 0.18, 0.36].forEach(t => { tone(1200, 0.12, "square", 0.05, t); tone(900, 0.12, "square", 0.05, t + 0.09); }); },
      rush()  { [660, 880, 1046, 1318].forEach((f, i) => tone(f, 0.1, "square", 0.045, i * 0.08)); },
    };
  })();

  /* ============================== state =============================== */

  const S = {
    screen: "title",
    station: "order",
    // persistent
    day: 1, xp: 0, lifetimeTips: 0, bestDay: 0, daysWorked: 0, servedTotal: 0,
    // meta progression (v3): Til Jar is a spendable currency, separate from
    // lifetimeTips (which stays a pure lifetime stat, never spent)
    tilJar: 0,
    upgrades: { ovenLevel: 0, slot6: false, patience: false, steady: false, grinInsurance: false },
    grinInsuranceUsedToday: false,
    // shift
    roster: [], arrivalsLeft: 0, nextArrivalIn: 0, stormedOut: 0,
    lobby: [], waiting: [], tickets: [],
    activeTicketId: null,
    ovens: Array(OVEN_SLOTS).fill(null),   // ticket ids
    builtShelf: [], cutShelf: [],          // ticket ids
    bakeSelect: null,                       // ticket id picked up at bake station
    dayScore: 0, dayTips: 0, servedToday: 0,
    armedBin: null, paintTool: null,
    cut: { ticketId: null, needed: 0, done: [], sweeping: false, angle: 0, raf: 0 },
    lastTick: 0, ticketSeq: 1,
    // Grin Combo: chained perfect stations grow tips, any bad station resets it
    grinStage: 0, dayMaxGrin: 0,
    // Troll Events + Grin Hunt (docs/TROLL-PIZZERIA-V2.md) — mid-shift
    // sabotage the player can cancel by spotting a hidden grin in time
    troll: { nextIn: 0, active: null, binSwapPair: null, binSwapUntil: 0, pineappleRaidLeft: 0,
             dialScrambleUntil: 0, quakeUntil: 0, tipBonusNext: 1, coldSnapUntil: 0, jamSlot: -1, jamUntil: 0 },
    // Rush hour (v3): one scripted back-to-back-arrivals window per shift
    shiftElapsed: 0,
    rush: { at: 0, active: false, done: false, until: 0, clean: true },
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
      tilJar: S.tilJar, upgrades: S.upgrades,
    };
  }
  function applySnapshot(d) {
    if (!d) return;
    Object.assign(S, {
      day: d.day || 1, xp: d.xp || 0, lifetimeTips: d.lifetimeTips || 0,
      bestDay: d.bestDay || 0, daysWorked: d.daysWorked || 0, servedTotal: d.servedTotal || 0,
      tilJar: d.tilJar || 0,
      upgrades: Object.assign({ ovenLevel: 0, slot6: false, patience: false, steady: false, grinInsurance: false }, d.upgrades || {}),
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

  function genSide(day) {
    if (day < 5 || Math.random() > 0.35) return null;
    return Math.random() < 0.5 ? "soda" : "breadsticks";
  }

  function genOrder(cust, day) {
    const specialties = unlockedSpecialties(day);
    if (specialties.length && Math.random() < clamp(0.1 + day * 0.015, 0.1, 0.3)) {
      const spec = pick(specialties);
      return {
        sauce: COVERAGE_TARGET[spec.sauce], sauceBand: COVERAGE_BAND,
        cheese: COVERAGE_TARGET[spec.cheese], cheeseBand: COVERAGE_BAND,
        tops: spec.tops.map(t => ({ ...t })), bake: spec.bake, cutCount: spec.cutCount,
        specialtyName: spec.name, tipMult: spec.tipMult, side: genSide(day),
      };
    }
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
    const sauceBucket = cust.quirk === "light" ? "light" : amount();
    const cheeseBucket = cust.quirk === "light" ? "light" : amount();
    return {
      sauce: COVERAGE_TARGET[sauceBucket], sauceBand: COVERAGE_BAND,
      cheese: COVERAGE_TARGET[cheeseBucket], cheeseBand: COVERAGE_BAND,
      tops, bake: bake.id, cutCount, side: genSide(day),
    };
  }

  /* ============================== scoring ============================= */

  const sideOf = (p) => (p.x < 0.5 ? "left" : "right");

  // Quadrant-variance evenness, 0..1 (1 = perfectly even). Shared shape
  // with the topping evenness bonus further down.
  function evenness(hits) {
    if (!hits || hits.length < 6) return 1;
    const q = [0, 0, 0, 0];
    for (const p of hits) q[(p.x < 0.5 ? 0 : 1) + (p.y < 0.5 ? 0 : 2)]++;
    const mean = hits.length / 4;
    const varc = q.reduce((s, n) => s + (n - mean) ** 2, 0) / 4;
    return clamp(1 - Math.sqrt(varc) / (mean + 1), 0, 1);
  }

  function coverageScore(target, band, build, hits) {
    const err = Math.abs(build - target);
    const base = clamp(1 - err / (band * 3), 0, 1);
    return base * (0.7 + 0.3 * evenness(hits));
  }

  function scoreOrder(t) {
    const o = t.order, b = t.build;
    let parts = 0, total = 0;
    // sauce + cheese coverage: distance from the target band, plus an
    // evenness penalty for patchy painting (mirrors the topping evenness
    // bonus below — a splotchy pie scores worse even at the right average)
    total += 1; parts += coverageScore(o.sauce, o.sauceBand, b.sauce, b.sauceHits);
    total += 1; parts += coverageScore(o.cheese, o.cheeseBand, b.cheese, b.cheeseHits);
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
      const countTolerance = S.upgrades.steady ? entry.count * 1.4 : entry.count;
      const countScore = Math.max(0, 1 - Math.abs(good - entry.count) / countTolerance);
      const wrongSidePenalty = S.upgrades.steady ? 0.07 : 0.12;
      parts += 2 * clamp(countScore - wrongSide * wrongSidePenalty, 0, 1);
    }
    // toppings that don't belong at all
    const strays = Object.values(placedByType).reduce((n, arr) => n + arr.length, 0);
    parts -= strays * (S.upgrades.steady ? 0.15 : 0.25);
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

  // Side score is a separate axis from the pizza itself — it nudges the
  // tip up or down but never touches the headline order/bake/cut total.
  function scoreSide(t) {
    const side = t.order.side;
    if (!side) return null;
    if (side === "soda") return t.sideDone ? 1 : 0.2;
    const d = t.sideDoneness;
    if (d >= 0.95) return 0.15;                        // burnt breadsticks
    return clamp(1 - Math.abs(d - SIDES.breadsticks.target) / 0.3, 0.05, 1);
  }

  function scoreTicket(t) {
    const order = scoreOrder(t), bake = scoreBake(t), cut = scoreCut(t);
    const total = clamp((order * 0.45 + bake * 0.3 + cut * 0.25) * moodMult(t), 0, 1);
    let tip = Math.max(1, Math.round(total * t.cust.tip * rand(9, 14)));
    const side = scoreSide(t);
    if (side !== null) tip = Math.round(tip * (0.9 + 0.2 * side));
    if (t.order.tipMult) tip = Math.round(tip * t.order.tipMult);
    return { order, bake, cut, side, total, tip };
  }

  /* ============================== grin combo ============================ */
  /* Chain "perfect" (≥90%) station grades into a growing trollface grin;
     any station under 60% wipes it. Up to +50% tips at max stage. Purely
     a scoring layer — no station gameplay changes. */

  const GRIN_MAX = 5;
  const GRIN_BONUS_PER_STAGE = 0.1;

  function applyGrinCombo(res) {
    const stations = [res.order, res.bake, res.cut];
    if (stations.some(v => v < 0.6)) {
      if (S.upgrades.grinInsurance && !S.grinInsuranceUsedToday) {
        S.grinInsuranceUsedToday = true;              // one bad station spared, once per day
      } else {
        S.grinStage = 0;                              // any bad station wipes the whole combo
      }
    } else {
      for (const v of stations) if (v >= 0.9) S.grinStage = Math.min(GRIN_MAX, S.grinStage + 1);
    }
    S.dayMaxGrin = Math.max(S.dayMaxGrin, S.grinStage);
    const bonus = 1 + S.grinStage * GRIN_BONUS_PER_STAGE;
    res.tip = Math.max(1, Math.round(res.tip * bonus));
    return res;
  }

  function renderGrinMeter() {
    const el = $("#pz-hud-grin");
    if (!el) return;
    el.textContent = "😏".repeat(S.grinStage) + "·".repeat(GRIN_MAX - S.grinStage);
    el.title = S.grinStage
      ? `Grin combo ×${S.grinStage} — tips +${S.grinStage * GRIN_BONUS_PER_STAGE * 100}%`
      : "Grin combo — chain perfect stations for bonus tips";
    el.classList.toggle("is-maxed", S.grinStage >= GRIN_MAX);
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

  // Continuous coverage → inset%: 0 paint = a sliver at the center,
  // 1.0 = spread almost to the crust. Anchored so the old light/normal/
  // extra buckets land close to their pre-v3 fixed insets.
  const coverageInset = (coverage) => Math.max(2, 22 - 15 * coverage);

  function renderPizza(container, t, opts = {}) {
    container.innerHTML = "";
    container.classList.add("pz-pizza");
    // dough
    pizzaLayer(container, "pizza-dough.png", { background: "radial-gradient(circle, #f4d9a4 62%, #e8b96b 78%, #c99a52 100%)", boxShadow: "inset 0 -6px 12px rgba(0,0,0,0.12)" }, 2);
    // sauce — opacity ramps in with coverage so a thin first pass reads
    // as a light coat rather than snapping straight to full-strength red
    if (t.build.sauce > 0.03) {
      const sauceLayer = pizzaLayer(container, "pizza-sauce.png", { background: "radial-gradient(circle, #d94f36 0%, #cf3b28 82%, #b02e1e 100%)" }, coverageInset(t.build.sauce) + 2);
      sauceLayer.setOpacity(clamp(0.45 + t.build.sauce * 0.55, 0, 1).toFixed(2));
    }
    // cheese
    if (t.build.cheese > 0.03) {
      const cheeseLayer = pizzaLayer(container, "pizza-cheese.png", { background: "radial-gradient(circle, #fbe294 0%, #f6d365 78%, #eec14e 100%)" }, coverageInset(t.build.cheese) + 4);
      cheeseLayer.setOpacity(clamp(0.45 + t.build.cheese * 0.55, 0, 1).toFixed(2));
    }
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
      build: { sauce: 0, cheese: 0, sauceHits: [], cheeseHits: [], placed: [] },
      doneness: 0, cutAngles: [],
      sideDoneness: 0, sideDone: false,
      overCooked: 0, onFire: false,
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
    const coverageRow = (label, target, band, build) => {
      const lo = Math.round(clamp(target - band, 0, 1) * 100), hi = Math.round(clamp(target + band, 0, 1) * 100);
      const diff = build - target;
      const cls = live ? (Math.abs(diff) <= band ? "done" : diff > 0 ? "over" : "") : "";
      const live_pct = live ? ` <span class="tk-side">(${Math.round(build * 100)}%)</span>` : "";
      return `<li class="${cls}">${label}: ${lo}-${hi}%${live_pct}</li>`;
    };
    rows.push(coverageRow("Sauce", o.sauce, o.sauceBand, b.sauce));
    rows.push(coverageRow("Cheese", o.cheese, o.cheeseBand, b.cheese));
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
    if (o.side) {
      const side = SIDES[o.side];
      const cls = live && o.side === "soda" ? (t.sideDone ? "done" : "") : "";
      rows.push(`<li class="${cls}">+ ${side.emoji} ${side.name}</li>`);
    }
    const badge = o.specialtyName ? `<span class="pz-specialty-badge">⭐ ${o.specialtyName}</span>` : "";
    return `<h4>${t.cust.emoji} ${t.cust.name} · #${String(t.id).padStart(2, "0")}</h4>${badge}<ul>${rows.join("")}</ul>`;
  }

  /* =============================== HUD ================================ */

  const STATE_LABEL = { building: "build", built: "to oven", baking: "baking", baked: "cut", cutting: "cut", served: "done" };
  const STATE_STATION = { building: "build", built: "bake", baking: "bake", baked: "cut", cutting: "cut" };

  function renderHud() {
    $("#pz-hud-day").textContent = "Day " + S.day;
    $("#pz-hud-coins").textContent = "🪙 " + S.dayTips;
    $("#pz-hud-score").textContent = "⭐ " + Math.round(S.dayScore);
    renderGrinMeter();
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
    c.patience = c.patience * patienceMult();
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
    if (k3d()) k3d().lobby.sync(S.lobby.filter(c => !c.walking).map(c => ({ uid: c.uid, name: c.name, emoji: c.emoji, sprite: c.sprite })));
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
    $("#pz-build-hint").textContent = S.paintTool
      ? `Painting ${S.paintTool} — drag across the pie, click the button again to stop.`
      : hasHalf
      ? "Half orders: left half is the LEFT side of the pie as you look at it."
      : "Drag toppings from the bins, or tap Sauce/Cheese and paint the pie.";
    $("#pz-to-oven").disabled = false;
    renderBins(t);
    updateAmountButtons(t);
  }

  function updateAmountButtons(t) {
    const sauceBtn = $("#pz-sauce-btn"), cheeseBtn = $("#pz-cheese-btn");
    sauceBtn.querySelector("strong").textContent = t ? Math.round(t.build.sauce * 100) + "%" : "—";
    cheeseBtn.querySelector("strong").textContent = t ? Math.round(t.build.cheese * 100) + "%" : "—";
    sauceBtn.classList.toggle("is-armed", S.paintTool === "sauce");
    cheeseBtn.classList.toggle("is-armed", S.paintTool === "cheese");
    const sideBtn = $("#pz-side-btn");
    sideBtn.hidden = !(t && t.order.side === "soda");
    if (t && t.order.side === "soda") {
      sideBtn.textContent = t.sideDone ? "🥤 Soda filled ✓" : "🥤 Fill soda";
      sideBtn.classList.toggle("is-done", t.sideDone);
    }
  }

  function renderBins(t) {
    const bins = $("#pz-bins");
    bins.innerHTML = "";
    let order = unlockedToppings(S.day);
    const swap = S.troll.binSwapPair;
    if (swap) {                                    // troll event: two bins trade places
      const ia = order.findIndex(x => x.id === swap[0]), ib = order.findIndex(x => x.id === swap[1]);
      if (ia !== -1 && ib !== -1) { order = order.slice(); [order[ia], order[ib]] = [order[ib], order[ia]]; }
    }
    for (const top of order) {
      const b = el("button", "pz-bin" + (S.armedBin === top.id ? " is-armed" : "") + (swap && swap.includes(top.id) ? " pz-bin-swapped" : ""));
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
    let painting = false;

    function ghostAt(x, y, tid, emoji) {
      const g = el("div", "pz-drag-ghost");
      g.appendChild(sprite("top-" + tid + ".png", emoji));
      g.style.left = x + "px"; g.style.top = y + "px";
      document.body.appendChild(g);
      return g;
    }
    const topOf = (tid) => TOPPINGS.find(x => x.id === tid);

    function hitPie(ev) {
      if (p3d() && p3d().isMounted(pizzaBox)) return p3d().pointToPie(ev.clientX, ev.clientY);
      const rect = pizzaBox.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width, y = (ev.clientY - rect.top) / rect.height;
      return Math.hypot(x - 0.5, y - 0.5) > PIZZA_RADIUS ? null : { x, y };
    }

    bins.addEventListener("pointerdown", (ev) => {
      const bin = ev.target.closest(".pz-bin");
      if (!bin || !activeTicket()) return;
      ev.preventDefault();
      drag = { tid: bin.dataset.tid, ghost: null, sx: ev.clientX, sy: ev.clientY, moved: false };
    });

    pizzaBox.addEventListener("pointerdown", (ev) => {
      const t = activeTicket();
      if (!t) return;
      if (S.paintTool) {
        const hit = hitPie(ev);
        if (hit) { ev.preventDefault(); painting = true; applyPaint(S.paintTool, hit.x, hit.y); }
        return;
      }
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
      if (S.armedBin) placeAt(ev, null, true);
    });

    document.addEventListener("pointermove", (ev) => {
      if (painting) {
        const hit = hitPie(ev);
        if (hit) applyPaint(S.paintTool, hit.x, hit.y);
        return;
      }
      if (!drag) return;
      if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 7) {
        drag.moved = true;
        drag.ghost = ghostAt(ev.clientX, ev.clientY, drag.tid, topOf(drag.tid).emoji);
      }
      if (drag.ghost) { drag.ghost.style.left = ev.clientX + "px"; drag.ghost.style.top = ev.clientY + "px"; }
    });

    document.addEventListener("pointerup", (ev) => {
      if (painting) { painting = false; return; }
      if (!drag) return;
      const d = drag; drag = null;
      if (d.ghost) d.ghost.remove();
      const t = activeTicket();
      if (!d.moved) {
        // plain click on a bin: toggle armed mode
        S.armedBin = S.armedBin === d.tid ? null : d.tid;
        S.paintTool = null;
        syncArmedTool();
        renderBuild();
        return;
      }
      if (t && placeAt(ev, d.tid, !d.repositioning)) return;
      if (d.repositioning) { Sfx.plop(); renderBuild(); } // dropped off the pie = removed
    });

    function placeAt(ev, tid, fresh) {
      const hit = hitPie(ev);
      if (!hit) return false;
      return commitPlacement(tid, hit.x, hit.y, fresh);
    }
  }

  /* Shared by the DOM drag path (placeAt, above) and Kitchen3D's
     onBuildPlace handler (boot(), below) — either way we already have
     pie-space (x,y), just commit it to the active ticket. */
  function commitPlacement(tid, x, y, fresh) {
    const t = activeTicket();
    if (!t) return false;
    let placeTid = tid || S.armedBin;
    // troll event: a pineapple raid can hijack the next few fresh drags
    if (fresh && S.troll.pineappleRaidLeft > 0) {
      S.troll.pineappleRaidLeft--;
      if (Math.random() < 0.3 && unlockedToppings(S.day).some(x => x.id === "pineapple")) placeTid = "pineapple";
    }
    t.build.placed.push({ tid: placeTid, x: clamp(x, 0.06, 0.94), y: clamp(y, 0.06, 0.94) });
    Sfx.plop();
    renderBuild(); renderHud();
    return true;
  }

  // Paint tool arming (v3): clicking Sauce/Cheese arms a drag-to-paint
  // tool over the pie, mutually exclusive with an armed topping bin.
  function armPaint(kind) {
    if (!activeTicket()) return;
    S.paintTool = S.paintTool === kind ? null : kind;
    S.armedBin = null;
    syncArmedTool();
    renderBuild();
  }

  // Kitchen3D needs to know what's "in hand" to route its own raw pointer
  // drags on the 3D pie (paint vs. place vs. ignore) — mirrors the DOM
  // bins/paint-button state game.js already owns.
  function syncArmedTool() {
    if (k3d()) k3d().build.setArmedTool(S.paintTool || S.armedBin || null);
  }

  function applyPaint(tool, x, y) {
    const t = activeTicket();
    if (!t) return;
    t.build[tool] = clamp(t.build[tool] + PAINT_STEP, 0, 1);
    const hits = tool === "sauce" ? t.build.sauceHits : t.build.cheeseHits;
    hits.push({ x, y });
    if (hits.length > 80) hits.shift();
    schedulePaintRender();
  }

  let paintRaf = null;
  function schedulePaintRender() {
    if (paintRaf) return;
    paintRaf = requestAnimationFrame(() => { paintRaf = null; renderBuild(); renderHud(); });
  }

  function sendToOven() {
    const t = activeTicket();
    if (!t) return;
    t.state = "built";
    S.builtShelf.push(t.id);
    S.activeTicketId = null;
    S.armedBin = null;
    syncArmedTool();
    Sfx.whoosh();
    renderBuild(); renderHud(); renderBadges(); renderBake();
    switchStation("bake");
  }

  /* ============================ bake station =========================== */

  // Troll event: "dial scramble" flips the doneness bars upside-down for a
  // stretch — visual only, the real doneness value used for scoring/pull
  // timing never changes.
  const dialScrambled = () => performance.now() < S.troll.dialScrambleUntil;
  const dialPct = (v) => dialScrambled() ? 100 - pct(v) : pct(v);

  function renderBake() {
    if (k3d()) {
      // Kitchen3D's physical rack has 6 slots, matching ovenSlotsCount()'s
      // max once the 6th-oven-slot upgrade is bought; the guard below just
      // protects against a future mismatch, not an expected one today.
      S.ovens.forEach((id, i) => {
        if (i >= k3d().oven.slotCount) return;
        k3d().oven.setSlot(i, id ? view3d(ticketById(id)) : null);
        k3d().oven.setFire(i, !!(id && ticketById(id).onFire));
      });
    }
    const slots = $("#pz-oven-slots");
    slots.innerHTML = "";
    const jammed = (i) => i === S.troll.jamSlot && performance.now() < S.troll.jamUntil;
    S.ovens.forEach((id, i) => {
      const slot = el("button", "pz-oven-slot" + (id ? "" : " is-empty")
        + (S.bakeSelect && !id ? " slot-target" : "") + (jammed(i) ? " is-jammed" : ""));
      slot.type = "button";
      const t = id ? ticketById(id) : null;
      slot.setAttribute("aria-label", t ? `Oven slot ${i + 1}: ${t.cust.name}'s pizza — click to pull out`
        : jammed(i) ? `Oven slot ${i + 1}: jammed` : `Oven slot ${i + 1}: empty`);
      const pie = el("div", "slot-pizza");
      if (t) renderPizza(pie, t);
      slot.appendChild(pie);
      const bar = el("div", "pz-doneness" + (dialScrambled() ? " pz-dial-scrambled" : ""));
      const fill = el("i");
      if (t) {
        fill.style.width = dialPct(t.doneness) + "%";
        const tgt = el("span", "tgt");
        tgt.style.left = dialPct(BAKES.find(b => b.id === t.order.bake).target) + "%";
        bar.appendChild(tgt);
      }
      bar.appendChild(fill);
      slot.appendChild(bar);
      if (t && t.order.side === "breadsticks") {
        const sideBar = el("div", "pz-doneness pz-side-doneness");
        const sideFill = el("i");
        sideFill.style.width = pct(t.sideDoneness) + "%";
        const sideTgt = el("span", "tgt");
        sideTgt.style.left = pct(SIDES.breadsticks.target) + "%";
        sideBar.appendChild(sideTgt);
        sideBar.appendChild(sideFill);
        slot.appendChild(sideBar);
        slot.appendChild(el("span", "pz-slot-label", "🥖 breadsticks"));
      }
      slot.appendChild(el("span", "pz-slot-label", t ? bakeName(t.order.bake) : jammed(i) ? "🔒 jammed" : "empty"));
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
    } else if (i === S.troll.jamSlot && performance.now() < S.troll.jamUntil) {
      Sfx.grr();                                        // jammed — can't slot a pie here
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
      b.appendChild(el("span", "who", (t.onFire ? "🔥 " : "") + t.cust.emoji + " #" + t.id));
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
    applyGrinCombo(res);
    if (S.troll.tipBonusNext > 1) {                    // Nana's coupon
      res.tip = Math.round(res.tip * S.troll.tipBonusNext);
      S.troll.tipBonusNext = 1;
    }
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
        ${res.side !== null ? meter(SIDES[t.order.side].name, res.side) : ""}
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
    const n = Math.min(3 + S.day, 12);
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
    S.ovens = Array(ovenSlotsCount()).fill(null);
    S.grinInsuranceUsedToday = false;
    S.builtShelf = []; S.cutShelf = [];
    S.activeTicketId = null; S.bakeSelect = null; S.armedBin = null; S.paintTool = null; S.stormedOut = 0;
    syncArmedTool();
    S.dayScore = 0; S.dayTips = 0; S.servedToday = 0; S.ticketSeq = 1;
    S.cut = { ticketId: null, needed: 0, done: [], sweeping: false, angle: 0, raf: 0 };
    S.grinStage = 0; S.dayMaxGrin = 0;
    resetTrollEvent();
    scheduleNextTrollEvent();
    S.troll.binSwapPair = null; S.troll.pineappleRaidLeft = 0;
    S.troll.dialScrambleUntil = 0; S.troll.quakeUntil = 0; S.troll.tipBonusNext = 1;
    S.troll.coldSnapUntil = 0; S.troll.jamSlot = -1; S.troll.jamUntil = 0;
    S.shiftElapsed = 0;
    S.rush = { at: rand(20, 45), active: false, done: S.day < 4, until: 0, clean: true, happened: false };
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
    const tilJarGain = Math.round(S.dayTips * 0.1);
    S.tilJar += tilJarGain;

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
    const rushLine = S.rush.happened
      ? `<p class="pz-serve-line">Rush hour: ${S.rush.clean ? "survived clean — ⭐ +40" : "a few slipped away"}</p>` : "";
    const grinLine = S.dayMaxGrin
      ? `<p class="pz-serve-line">Best grin combo: ${"😏".repeat(S.dayMaxGrin)} (×${S.dayMaxGrin * GRIN_BONUS_PER_STAGE * 100}% tips)</p>` : "";
    const unlocks = (newTops.length || newCusts.length)
      ? `<div class="pz-unlock">Tomorrow: ${[...newTops.map(t => t.emoji + " " + t.name), ...newCusts.map(c => c.emoji + " " + c.name)].join(" · ")}</div>`
      : "";

    const ov = $("#pz-day-overlay");
    ov.innerHTML = `<div class="pz-overlay-card">
      <h2>Day ${S.day} complete!</h2>
      <table class="pz-day-table"><tbody>${rows}</tbody></table>
      ${stormed}
      ${rushLine}
      ${grinLine}
      <p class="pz-serve-total">⭐ ${Math.round(S.dayScore)}${newBest ? " · new best!" : ""}</p>
      <p class="pz-serve-tip">Tips: 🪙 ${S.dayTips} · XP +${xpGain} · rank: ${rankName(S.xp)}</p>
      <p class="pz-serve-tip">🫙 Til Jar +${tilJarGain} (${S.tilJar} banked)</p>
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

  /* ============================ troll events ============================ */
  /* Mid-shift sabotage: "the kitchen trolls back" (docs/TROLL-PIZZERIA-V2.md).
     Every fired event has a ~2s tell where a hidden grin appears somewhere
     on screen — click it in time to cancel the event and bank a small
     score bonus; miss it and the chaos lands. Never fires before day 3. */

  const TROLL_TELL_SECONDS = 2;
  const TROLL_EVENTS = ["problem", "binswap", "pineapple", "dial", "quake", "coupon"];
  // Tier 2 (v3): meaner events, day 10+ only. "doubletrouble" doesn't do
  // anything itself — it just queues the next tell almost immediately,
  // so a missed Grin Hunt is followed by another one before you can breathe.
  const TROLL_EVENTS_TIER2 = ["coldsnap", "slotjam", "doubletrouble"];

  const LOBBY_CAP_NORMAL = 4;
  const LOBBY_CAP_RUSH = 6;
  const lobbyCap = () => (S.rush.active ? LOBBY_CAP_RUSH : LOBBY_CAP_NORMAL);

  function scheduleNextTrollEvent() {
    S.troll.nextIn = rand(Math.max(22, 55 - S.day * 1.5), Math.max(34, 80 - S.day * 1.5));
  }

  function startTrollTell() {
    // pineapple raid only makes sense once pineapple is unlocked
    let pool = S.day >= 7 ? TROLL_EVENTS : TROLL_EVENTS.filter(e => e !== "pineapple");
    if (S.day >= 10) pool = pool.concat(TROLL_EVENTS_TIER2);
    const type = pick(pool);
    S.troll.active = { type, tellLeft: TROLL_TELL_SECONDS };
    renderGrinHunt();
  }

  function renderGrinHunt() {
    if (k3d()) { k3d().trollEvent.spawnGrinHunt(); return; }
    const stage = $(".pz-stage");
    if (!stage) return;
    let btn = document.getElementById("pz-grin-hunt");
    if (!S.troll.active) { if (btn) btn.remove(); return; }
    if (!btn) {
      btn = el("button", "pz-grin-hunt");
      btn.type = "button";
      btn.id = "pz-grin-hunt";
      btn.textContent = "😏";
      btn.setAttribute("aria-label", "Something's off — click quick!");
      btn.style.left = rand(8, 84) + "%";
      btn.style.top = rand(14, 78) + "%";
      btn.addEventListener("click", (ev) => { ev.stopPropagation(); resolveTrollEvent(true); });
      stage.appendChild(btn);
    }
  }

  function resolveTrollEvent(cancelled) {
    if (!S.troll.active) return;
    const type = S.troll.active.type;
    S.troll.active = null;
    const btn = document.getElementById("pz-grin-hunt");
    if (btn) btn.remove();
    if (k3d()) k3d().trollEvent.clearGrinHunt();
    if (cancelled) {
      S.dayScore += 15;
      Sfx.gotcha();
      renderHud();
    } else {
      fireTrollEvent(type);
      Sfx.trollHeh();
    }
    scheduleNextTrollEvent();
  }

  // Silent reset for day/shift boundaries — no score bonus, no chaos fired.
  function resetTrollEvent() {
    S.troll.active = null;
    const btn = document.getElementById("pz-grin-hunt");
    if (btn) btn.remove();
    if (k3d()) k3d().trollEvent.clearGrinHunt();
  }

  function fireTrollEvent(type) {
    switch (type) {
      case "problem": {                          // Trollio edits a live ticket
        const building = S.tickets.filter(t => t.state === "building" && t.order.tops.length);
        const t = pick(building);
        if (!t) return;
        const entry = pick(t.order.tops);
        const pool = unlockedToppings(S.day).filter(x => !t.order.tops.some(e => e.id === x.id));
        const swap = pick(pool);
        if (!swap) return;
        entry.id = swap.id;
        if (S.activeTicketId === t.id) {
          renderBuild();
          const card = $("#pz-build-ticket .pz-ticket");
          if (card) card.classList.add("pz-ticket-rattle");
        }
        renderHud();
        break;
      }
      case "binswap": {                          // two bins trade places
        const pool = unlockedToppings(S.day);
        if (pool.length < 2) return;
        const a = pick(pool);
        const b = pick(pool.filter(x => x.id !== a.id));
        if (!b) return;
        S.troll.binSwapPair = [a.id, b.id];
        S.troll.binSwapUntil = performance.now() + 15000;
        if (S.station === "build") renderBins(activeTicket());
        break;
      }
      case "pineapple":                          // next few toppings roll pineapple
        S.troll.pineappleRaidLeft = 3;
        break;
      case "dial":                               // oven bars read upside-down
        S.troll.dialScrambleUntil = performance.now() + 20000;
        if (S.station === "bake") renderBake();
        break;
      case "quake": {                             // build table trembles
        S.troll.quakeUntil = performance.now() + 8000;
        const box = $("#pz-build-pizza");
        if (box) {
          box.classList.add("pz-quake");
          setTimeout(() => box.classList.remove("pz-quake"), 8000);
        }
        break;
      }
      case "coupon":                              // Nana's coupon — next tip x2
        S.troll.tipBonusNext = 2;
        break;
      case "coldsnap":                            // tier 2: lobby patience drains harder
        S.troll.coldSnapUntil = performance.now() + 20000;
        break;
      case "slotjam": {                           // tier 2: an empty slot locks up for a while
        const empties = S.ovens.map((id, i) => (id ? -1 : i)).filter(i => i !== -1);
        if (!empties.length) return;
        S.troll.jamSlot = pick(empties);
        S.troll.jamUntil = performance.now() + 25000;
        if (S.station === "bake") renderBake();
        break;
      }
      case "doubletrouble":                       // tier 2: the next tell comes almost immediately
        S.troll.nextIn = rand(2, 4);
        break;
    }
  }

  /* =============================== ticking ============================= */

  function tick(dt) {
    if (S.screen !== "game") return;
    S.shiftElapsed += dt;

    // rush hour (v3): one telegraphed back-to-back-arrivals window per shift
    if (!S.rush.done && !S.rush.active && S.shiftElapsed >= S.rush.at) {
      S.rush.active = true; S.rush.happened = true; S.rush.until = S.shiftElapsed + 45; S.rush.clean = true;
      Sfx.rush();
      renderRushBanner();
    } else if (S.rush.active && S.shiftElapsed >= S.rush.until) {
      S.rush.active = false; S.rush.done = true;
      if (S.rush.clean) { S.dayScore += 40; renderHud(); }
      renderRushBanner();
    }

    // arrivals
    if (S.arrivalsLeft > 0 && S.lobby.length < lobbyCap()) {
      S.nextArrivalIn -= dt;
      if (S.nextArrivalIn <= 0) {
        S.arrivalsLeft--;
        S.nextArrivalIn = S.rush.active
          ? rand(3, 6)
          : rand(Math.max(8, 22 - S.day * 1.4), Math.max(13, 30 - S.day * 1.4));
        spawnCustomer();
        renderBadges();
      }
    }
    // patience: lobby customers can storm out; waiting customers just sulk
    const coldSnap = performance.now() < S.troll.coldSnapUntil;
    let lobbyChanged = false;
    for (const c of [...S.lobby]) {
      c.patienceLeft -= dt * (coldSnap ? 1.6 : 1);
      if (c.patienceLeft <= 0) {
        S.lobby = S.lobby.filter(x => x !== c);
        S.stormedOut++;
        lobbyChanged = true;
        if (S.rush.active) S.rush.clean = false;
        Sfx.grr();
      }
    }
    for (const c of S.waiting) c.patienceLeft = Math.max(0, c.patienceLeft - dt * 0.5);
    // ovens
    let baking = false, firePulled = false;
    S.ovens.forEach((id, i) => {
      if (!id) return;
      const t = ticketById(id);
      t.doneness = clamp(t.doneness + dt / bakeSeconds(), 0, 1);
      if (t.order.side === "breadsticks")
        t.sideDoneness = clamp(t.sideDoneness + (dt * SIDES.breadsticks.speed) / bakeSeconds(), 0, 1);
      // kitchen fire (v3): left too long past done, small per-second chance
      // to catch fire — cosmetic + a forced pull, no extra score penalty
      // beyond the doneness hit it already has from being overcooked.
      if (t.doneness >= 1) {
        t.overCooked += dt;
        if (t.overCooked > 2 && Math.random() < dt * 0.15) {
          t.onFire = true;
          if (k3d()) k3d().oven.setFire(i, true);   // one-frame flash at the instant it ignites
          S.ovens[i] = null;
          t.state = "baked";
          S.cutShelf.push(t.id);
          Sfx.alarm();
          firePulled = true;
        }
      }
      baking = true;
    });
    if (S.troll.jamUntil && performance.now() > S.troll.jamUntil) {
      S.troll.jamSlot = -1; S.troll.jamUntil = 0;
      if (S.station === "bake") renderBake();
    }
    // lightweight re-renders only where things move
    if (lobbyChanged) { renderLobby(); checkDayEnd(); }
    else if (S.lobby.length) updatePatienceBars();
    if (firePulled) { renderBake(); renderCutShelf(); renderHud(); }
    else if (baking && S.station === "bake") renderBakeBarsOnly();
    renderBadges();

    // troll events: never before day 3
    if (S.day >= 3) {
      if (S.troll.active) {
        S.troll.active.tellLeft -= dt;
        if (S.troll.active.tellLeft <= 0) resolveTrollEvent(false);
      } else {
        S.troll.nextIn -= dt;
        if (S.troll.nextIn <= 0) startTrollTell();
      }
    }
    if (S.troll.binSwapPair && performance.now() > S.troll.binSwapUntil) {
      S.troll.binSwapPair = null;
      if (S.station === "build") renderBins(activeTicket());
    }
  }

  function renderRushBanner() {
    const banner = $("#pz-rush-banner");
    if (!banner) return;
    banner.hidden = !S.rush.active;
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
    if (k3d()) {
      S.ovens.forEach((id, i) => {
        if (id && i < k3d().oven.slotCount) k3d().oven.setSlot(i, view3d(ticketById(id)));
      });
    }
    document.querySelectorAll("#pz-oven-slots .pz-oven-slot").forEach((slot, i) => {
      const id = S.ovens[i];
      if (!id) return;
      const t = ticketById(id);
      const bar = slot.querySelector(".pz-doneness");
      if (bar) bar.classList.toggle("pz-dial-scrambled", dialScrambled());
      const fill = slot.querySelector(".pz-doneness i");
      if (fill) fill.style.width = dialPct(t.doneness) + "%";
      if (t.order.side === "breadsticks") {
        const sideFill = slot.querySelector(".pz-side-doneness i");
        if (sideFill) sideFill.style.width = pct(t.sideDoneness) + "%";
      }
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

  /* Updates S.station + the DOM/render side of things. Called directly by
     Kitchen3D's onDockChange (the player walked to a station themselves —
     the camera is already there, nothing to teleport) and, via
     switchStation() below, by tab/keyboard/ticket-rack fast travel. Kept
     separate so fast travel's teleportTo() → dock() → onDockChange loop
     doesn't recurse back into itself. */
  function applyStationChange(name) {
    const prev = S.station;
    S.station = name;
    if (k3d()) {
      // build/cut are independent pies in the room (not one shared canvas
      // like the old Pizza Cam) — hide whichever one we're leaving.
      if (prev === "build" && name !== "build") k3d().pieBackend("build").unmount();
      if (prev === "cut" && name !== "cut") k3d().pieBackend("cut").unmount();
    } else if (name !== "build" && name !== "cut" && p3d()) {
      p3d().unmount();  // legacy Pizza Cam: stop the 3D loop off-station
    }
    document.querySelectorAll(".pz-station").forEach(s => s.classList.remove("is-active"));
    $("#st-" + name).classList.add("is-active");
    document.querySelectorAll(".pz-tab").forEach(t => t.classList.toggle("is-active", t.dataset.station === name));
    if (name === "build") renderBuild();
    if (name === "bake") renderBake();
    if (name === "cut") { renderCutShelf(); renderCutTable(); }
    if (name === "order") renderLobby();
  }

  function switchStation(name) {
    applyStationChange(name);
    // Tab/keyboard/ticket-rack station switches are "fast travel": the
    // camera walks-and-docks there instantly instead of only toggling a
    // DOM class (docs/TROLL-PIZZERIA-3D.md decision 1). Free-walking to a
    // station yourself and interacting reaches the same place, just
    // without the shortcut — that path calls applyStationChange directly
    // via onDockChange, not this function, so it never re-teleports.
    if (k3d()) k3d().teleportTo(name);
  }

  /* =============================== title =============================== */

  function showTitle() {
    S.screen = "title";
    $("#pz-game").hidden = true;
    $("#pz-title").style.display = "";
    const stats = $("#pz-title-stats");
    if (S.daysWorked > 0) {
      stats.hidden = false;
      stats.textContent = `Day ${S.day} · ${rankName(S.xp)} · best day ⭐ ${S.bestDay} · lifetime tips 🪙 ${S.lifetimeTips} · 🫙 ${S.tilJar}`;
      $("#pz-start-btn").textContent = `Continue — Day ${S.day}`;
    } else {
      $("#pz-start-btn").textContent = "Start shift";
    }
  }

  /* =============================== upgrades ============================= */

  function buyUpgrade(id) {
    const u = UPGRADES.find(x => x.id === id);
    if (!u || upgradeOwned(id) || S.tilJar < u.cost) return;
    if (u.requires && !upgradeOwned(u.requires)) return;
    S.tilJar -= u.cost;
    if (ovenLevelIds.includes(id)) S.upgrades.ovenLevel++;
    else S.upgrades[id] = true;
    Sfx.coin(3);
    save();
    renderUpgrades();
  }

  function renderUpgrades() {
    $("#pz-upgrades-balance").textContent = `🫙 ${S.tilJar} banked — 10% of each day's tips`;
    const list = $("#pz-upgrades-list");
    list.innerHTML = "";
    for (const u of UPGRADES) {
      const owned = upgradeOwned(u.id);
      const lockedByPrereq = u.requires && !upgradeOwned(u.requires);
      const row = el("div", "pz-upgrade-row" + (owned ? " is-owned" : ""));
      row.innerHTML = `<div class="pz-upgrade-info"><strong>${u.name}</strong><span>${u.desc}</span></div>`;
      const btn = el("button", "pz-btn pz-btn-small");
      btn.type = "button";
      if (owned) { btn.textContent = "Owned"; btn.disabled = true; }
      else if (lockedByPrereq) { btn.textContent = "Locked"; btn.disabled = true; }
      else { btn.textContent = `🫙 ${u.cost}`; btn.disabled = S.tilJar < u.cost; }
      btn.addEventListener("click", () => buyUpgrade(u.id));
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  /* ================================ boot =============================== */

  function boot() {
    load();
    void initCloudSync();

    // .pizzeria-cabinet is sized to 100vh so the game fills the browser
    // window (style.css); the sticky header above it isn't part of that
    // viewport unit, so without this it'd push the cabinet's bottom (the
    // station tab bar) off-screen by exactly the header's height.
    const header = document.querySelector(".site-header");
    const setHeaderH = () => document.documentElement.style.setProperty("--pz-header-h", header.offsetHeight + "px");
    setHeaderH();
    window.addEventListener("resize", setHeaderH);

    // title chef sprite + lobby backdrop + oven art (all with fallbacks)
    $("#pz-title-chef").appendChild(sprite("char-chef.png", "😏"));
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
    $("#pz-upgrades-btn").addEventListener("click", () => { renderUpgrades(); $("#pz-upgrades").hidden = false; });
    $("#pz-upgrades-close").addEventListener("click", () => { $("#pz-upgrades").hidden = true; });
    $("#pz-take-order").addEventListener("click", orderFromCounter);
    $("#pz-sauce-btn").addEventListener("click", () => armPaint("sauce"));
    $("#pz-cheese-btn").addEventListener("click", () => armPaint("cheese"));
    $("#pz-side-btn").addEventListener("click", () => {
      const t = activeTicket();
      if (!t || t.order.side !== "soda") return;
      t.sideDone = true;
      Sfx.plop();
      updateAmountButtons(t);
    });
    $("#pz-clear-btn").addEventListener("click", () => {
      const t = activeTicket();
      if (!t) return;
      t.build = { sauce: 0, cheese: 0, sauceHits: [], cheeseHits: [], placed: [] };
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

    // Kitchen3D (docs/TROLL-PIZZERIA-3D.md) loads async too — mount it and
    // register handlers as soon as it's ready. game.js keeps owning all
    // state/scoring; Kitchen3D is a renderer + input source, same boundary
    // pizza3d.js always had (see kitchen3d.js's own header comment).
    function initKitchen3D() {
      const k = k3d();   // respects FLAT_MODE, unlike window.TrollKitchen3D.ok directly
      if (!k) return;
      document.body.classList.add("k3d-mode");
      const mount = $("#pz-3d-mount");
      if (mount) k.mount(mount);
      k.setHandlers({
        onDockChange(id) { if (id) applyStationChange(id); },
        onBuildPaint: applyPaint,
        onBuildPlace: (tid, x, y) => commitPlacement(tid, x, y, true),
        onGrinResolve: resolveTrollEvent,
      });
      if (S.screen === "game") { renderLobby(); renderBake(); renderBuild(); renderCutTable(); }
    }
    window.addEventListener("kitchen3d:ready", initKitchen3D);
    initKitchen3D(); // in case the module (and its own ready event) already fired

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
  window.__pz = {
    S, ticketById, switchStation, checkDayEnd, BAKES, TOPPINGS,
    startTrollTell, resolveTrollEvent, applyGrinCombo, GRIN_MAX,
    genOrder, SPECIALTIES, SIDES, tick, fireTrollEvent, buildRoster,
    UPGRADES, buyUpgrade, upgradeOwned, ovenSlotsCount, bakeSeconds, renderUpgrades,
    COVERAGE_TARGET, COVERAGE_BAND, coverageScore, applyPaint, armPaint,
    k3d, p3d, applyStationChange, commitPlacement, syncArmedTool,
  };
})();
