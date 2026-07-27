/* The Rusty Troll — game 009, phase 1 core loop.
   First-person fry cook: three facings (griddle / counter / window) on a
   sliding world strip. Per-side patty doneness with flip timing, exact-order
   stack assembly scored by LCS, bell serve, shift quota, localStorage save.
   No external calls — the game must run with every cross-repo script blocked. */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const SAVE_KEY = "troll-burger-save-v1";

  /* ---- tuning ----------------------------------------------------------- */
  const COOK_MAX = 110;          // bar length in cook units; > COOK_MAX = burnt
  const COOK_RATE = 7.5;         // units per second on the down side
  const PERFECT = { lo: 60, hi: 90, target: 75 };
  const GRILL_SLOTS = 4;
  const RACK_MAX = 4;
  const RAIL_MAX = 5;

  /* slot spots on the griddle: back row smaller (farther away) */
  const SLOT_POS = [
    { x: 37, y: 30, w: 104 }, { x: 63, y: 30, w: 104 },
    { x: 30, y: 68, w: 134 }, { x: 70, y: 68, w: 134 },
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

  function toppingPool(shift) {
    const pool = ["cheese", "lettuce", "tomato"];
    if (shift >= 2) pool.push("ketchup");
    if (shift >= 3) pool.push("pickles");
    if (shift >= 4) pool.push("onions");
    if (shift >= 5) pool.push("mustard");
    if (shift >= 6) pool.push("jalapeno");
    return pool;
  }

  /* customers — flavor only in phase 1; quirks land in phase 2 */
  const CUSTS = [
    { n: "Trollio", e: "🧌", tip: 1.1 },
    { n: "Pepe",    e: "🐸", tip: 1.25 },
    { n: "Doge",    e: "🐶", tip: 1.0 },
    { n: "Chad",    e: "🗿", tip: 0.9 },
    { n: "Nana",    e: "👵", tip: 1.2 },
    { n: "Harold",  e: "🙂", tip: 1.0 },
  ];

  const REACTIONS = [
    [95, "PERFECT. Problem?"],
    [80, "Pretty good, fry troll."],
    [60, "Edible. Barely."],
    [40, "My disappointment is immeasurable."],
    [0,  "I'm telling Mr. Grabs about this."],
  ];

  /* ---- state ------------------------------------------------------------ */
  const S = {
    screen: "title",           // title | shift | between
    face: 0,                   // 0 griddle · 1 counter · 2 window
    shift: 1,
    quota: 5,
    spawned: 0,
    served: 0,
    score: 0,
    tips: 0,
    waste: 0,
    tickets: [],               // open tickets (max RAIL_MAX on the rail)
    nextTicket: 1,
    activeTicketId: null,
    grill: new Array(GRILL_SLOTS).fill(null),
    rack: [],                  // plated patties {id, up, down, burnt, grade, pct}
    build: null,               // {layers:[key], patties:[pattyRec]}
    selectedPlate: null,
    orders: [],                // completed order results this shift
    soundOn: true,
    running: false,
    spawnAt: 0,                // clock time of next spawn
    clock: 0,                  // seconds since shift start
    save: null,
  };
  let nextPattyId = 1;

  /* ---- save ------------------------------------------------------------- */
  function loadSave() {
    try { S.save = JSON.parse(localStorage.getItem(SAVE_KEY)) || null; }
    catch { S.save = null; }
    if (!S.save) S.save = { shift: 1, best: 0, lifetime: { shifts: 0, served: 0, tips: 0, waste: 0 } };
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
  };

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

  /* ---- tickets ----------------------------------------------------------- */
  function genTicket(shift) {
    const nTop = Math.min(2 + Math.floor((shift - 1) / 2), 6);
    const tops = shuffle(sample(toppingPool(shift), Math.min(nTop, toppingPool(shift).length)));
    const mid = ["patty", ...tops];
    if (shift >= 5 && Math.random() < 0.3) mid.splice(1 + rnd(mid.length), 0, "patty");
    const cust = CUSTS[rnd(CUSTS.length)];
    const layers = ["bun_b", ...mid, "bun_t"];
    return {
      id: S.nextTicket++,
      cust,
      layers,
      bornAt: S.clock,
      window: 55 + layers.length * 9,   // seconds until mood bottoms out
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
     "tb-game", "tb-hud-shift", "tb-hud-coins", "tb-hud-score", "tb-hud-waste", "tb-sound-toggle",
     "tb-pov", "tb-world", "tb-hand", "tb-turn-left", "tb-turn-right", "tb-slots", "tb-patty-tub", "tb-plate-rack",
     "tb-trash", "tb-spatula", "tb-pinned-ticket", "tb-build-stack", "tb-undo", "tb-scrap",
     "tb-bins", "tb-counter-hint", "tb-queue", "tb-ticket-rail", "tb-serve-spot", "tb-bell",
     "tb-order-overlay", "tb-shift-overlay"]
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
    for (let i = 0; i < GRILL_SLOTS; i++) {
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
         <span class="tb-slot-plate" title="Plate this patty">🍽</span>`;
      btn.querySelector(".tb-slot-plate").addEventListener("click", (ev) => { ev.stopPropagation(); plateSlot(i); });
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
    if (S.rack.length >= RACK_MAX) { SFX.buzz(); hint("Plate rack is full — use or trash a patty."); return; }
    S.grill[i] = null;
    const rec = { ...p, pct: pattyPct(p), grade: pattyGrade(p) };
    S.rack.push(rec);
    SFX.drop(); workSpatula();
    renderSlot(i); renderRack(); renderBins();
  }
  function workSpatula() {
    el.spatula.classList.remove("is-working"); void el.spatula.offsetWidth;
    el.spatula.classList.add("is-working");
  }

  function renderRack() {
    el.plateRack.innerHTML = "";
    S.rack.forEach((p, idx) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tb-plate" + (p.grade === "PERFECT" ? " is-perfect" : p.grade === "BURNT" ? " is-burnt" : "");
      if (S.selectedPlate === p.id) b.classList.add("is-selected");
      b.setAttribute("aria-label", `Plated patty — ${p.grade} (${p.pct}%). Click to select for the trash.`);
      b.innerHTML = `<span class="tb-plate-meat" style="--patty-color:${cookColor(p.up)}"></span><span class="tb-plate-grade">${p.grade}</span>`;
      b.addEventListener("click", () => {
        S.selectedPlate = S.selectedPlate === p.id ? null : p.id;
        el.trash.classList.toggle("is-armed", S.selectedPlate !== null);
        renderRack();
      });
      el.plateRack.appendChild(b);
    });
    el.trash.classList.toggle("is-armed", S.selectedPlate !== null);
  }
  function trashSelected() {
    if (S.selectedPlate === null) { hint("Click a plated patty first, then the trash."); return; }
    const idx = S.rack.findIndex((p) => p.id === S.selectedPlate);
    if (idx >= 0) { S.rack.splice(idx, 1); S.waste++; SFX.buzz(); }
    S.selectedPlate = null;
    renderRack(); renderBins(); updateHud();
  }

  /* ---- counter: bins + build --------------------------------------------- */
  function unlockedBins(shift) {
    return ["patty", "bun", ...toppingPool(shift)];
  }
  function renderBins() {
    el.bins.innerHTML = "";
    for (const key of unlockedBins(S.shift)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tb-bin";
      b.dataset.bin = key;
      if (key === "patty") {
        const n = S.rack.length;
        b.innerHTML = `<span class="tb-bin-art">🥩</span><span class="tb-bin-label">Patty ×${n}</span>`;
        b.disabled = n === 0;
        b.setAttribute("aria-label", `Add a plated patty to the build (${n} available)`);
        b.addEventListener("click", addPattyToBuild);
      } else if (key === "bun") {
        b.innerHTML = `<span class="tb-bin-art">🍞</span><span class="tb-bin-label">Bun</span>`;
        b.setAttribute("aria-label", "Bun — bottom bun on an empty plate, top bun to finish");
        b.addEventListener("click", addBun);
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

  function addBun() {
    if (!S.build || S.build.layers.length === 0) {
      S.build = { layers: ["bun_b"], patties: [] };
    } else if (buildClosed()) { SFX.buzz(); hint("It already has a top bun. Serve it or scrap it."); return; }
    else S.build.layers.push("bun_t");
    SFX.drop(); renderBuild();
  }
  function addLayer(key) {
    if (!S.build || S.build.layers.length === 0) { SFX.buzz(); hint("Bottom bun first — tap the bun."); return; }
    if (buildClosed()) { SFX.buzz(); hint("It already has a top bun. Serve it or scrap it."); return; }
    S.build.layers.push(key);
    SFX.drop(); renderBuild();
  }
  function addPattyToBuild() {
    if (!S.build || S.build.layers.length === 0) { SFX.buzz(); hint("Bottom bun first — tap the bun."); return; }
    if (buildClosed()) { SFX.buzz(); hint("It already has a top bun."); return; }
    if (!S.rack.length) { SFX.buzz(); hint("No plated patties — the griddle is behind you."); return; }
    let best = 0;
    S.rack.forEach((p, i) => { if (p.pct > S.rack[best].pct) best = i; });
    const patty = S.rack.splice(best, 1)[0];
    if (S.selectedPlate === patty.id) S.selectedPlate = null;
    S.build.layers.push("patty");
    S.build.patties.push(patty);
    SFX.drop(); renderBuild(); renderRack(); renderBins();
  }
  function undoLayer() {
    if (!S.build || !S.build.layers.length) return;
    const key = S.build.layers.pop();
    if (key === "patty") {
      const patty = S.build.patties.pop();
      if (patty && S.rack.length < RACK_MAX) S.rack.push(patty);
      else if (patty) S.waste++;
    }
    if (!S.build.layers.length) S.build = null;
    SFX.flip(); renderBuild(); renderRack(); renderBins(); updateHud();
  }
  function scrapBuild() {
    if (!S.build) return;
    S.waste += 1 + S.build.patties.length;
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
    return s;
  }
  function renderBuild() {
    el.buildStack.innerHTML = "";
    if (S.build) for (const key of S.build.layers) el.buildStack.appendChild(layerDiv(key));
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
    el.pinnedTicket.appendChild(list);
  }
  function renderQueue() {
    el.queue.innerHTML = "";
    for (const t of S.tickets) {
      const d = document.createElement("span");
      d.className = "tb-cust";
      d.innerHTML = `${t.cust.e}<small>${t.cust.n}</small>`;
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
    const mood = moodMult(t);
    const raw = 0.55 * stack + 0.45 * grill;
    const total = clamp(Math.round(raw * mood), 0, 115);
    const tip = Math.max(0, Math.round((total / 100) * (3 + t.layers.length * 0.7) * t.cust.tip));
    return { stack, grill, mood, total, tip };
  }

  function doServe() {
    const t = ticketById(S.activeTicketId);
    if (!t || !buildClosed()) { SFX.buzz(); return; }
    const build = S.build;
    S.build = null;
    const r = scoreOrder(t, build);
    S.tickets = S.tickets.filter((x) => x.id !== t.id);
    S.activeTicketId = null;
    S.served++;
    S.score += r.total;
    S.tips += r.tip;
    S.orders.push({ ticket: t, r });

    el.bell.classList.add("is-ringing");
    setTimeout(() => el.bell.classList.remove("is-ringing"), 450);
    SFX.bell();

    // tray flies out through the window
    el.serveSpot.innerHTML = "";
    for (const key of build.layers) el.serveSpot.appendChild(layerDiv(key));
    el.serveSpot.classList.remove("is-serving"); void el.serveSpot.offsetWidth;
    el.serveSpot.classList.add("is-serving");

    renderRail(); renderQueue(); renderBuild(); renderBins(); updateHud();
    setTimeout(() => { el.serveSpot.innerHTML = ""; showOrderScore(t, r); }, 620);
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
    el.orderOverlay.innerHTML = `<div class="tb-overlay-card">
      <h2>Order #${t.id} · ${t.cust.e} ${t.cust.n}</h2>
      <div class="tb-score-grid">
        ${meterRow("Stack", r.stack)}
        ${meterRow("Grill", r.grill)}
      </div>
      <p class="tb-reaction">“${reaction(r.total)}” <span style="font-style:normal;color:var(--rt-ink-soft)">· mood ×${r.mood.toFixed(2)}</span></p>
      <div class="tb-order-total"><span>+${r.total} pts</span><span class="tb-tip">🪙 ${r.tip} tip</span></div>
      <button type="button" class="tb-btn tb-btn-primary" id="tb-order-next">${S.served >= S.quota ? "Clock out" : "Next order"}</button>
    </div>`;
    el.orderOverlay.hidden = false;
    $("#tb-order-next").addEventListener("click", () => {
      el.orderOverlay.hidden = true;
      if (S.served >= S.quota) endShift();
    });
    $("#tb-order-next").focus();
  }

  /* ---- shift lifecycle ---------------------------------------------------- */
  function startShift() {
    S.screen = "shift";
    S.quota = Math.min(4 + S.shift, 9);
    S.spawned = 0; S.served = 0; S.score = 0; S.tips = 0; S.waste = 0;
    S.tickets = []; S.activeTicketId = null; S.nextTicket = 1;
    S.grill = new Array(GRILL_SLOTS).fill(null);
    S.rack = []; S.build = null; S.selectedPlate = null; S.orders = [];
    S.clock = 0; S.spawnAt = 1.2;
    el.title.hidden = true;
    el.game.hidden = false;
    buildSlots(); renderRack(); renderBins(); renderBuild(); renderRail(); renderQueue();
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
    S.spawned++;
    S.tickets.push(genTicket(S.shift));
    SFX.ding();
    renderRail(); renderQueue();
    if (S.face !== 2) el.facingTabs[2].classList.add("has-new");
  }

  function endShift() {
    S.running = false;
    S.screen = "between";
    const sv = S.save;
    sv.lifetime.shifts++; sv.lifetime.served += S.served;
    sv.lifetime.tips += S.tips; sv.lifetime.waste += S.waste;
    sv.best = Math.max(sv.best || 0, S.score);
    sv.shift = ++S.shift;
    persist();

    const avg = S.orders.length ? Math.round(S.orders.reduce((s, o) => s + o.r.total, 0) / S.orders.length) : 0;
    const best = S.orders.reduce((b, o) => (o.r.total > (b ? b.r.total : -1) ? o : b), null);
    el.shiftOverlay.innerHTML = `<div class="tb-overlay-card">
      <h2>Shift ${S.shift - 1} — clocked out</h2>
      <p class="tb-shift-big">⭐ ${S.score}</p>
      <table class="tb-shift-table">
        <tr><td>Orders served</td><td>${S.served}</td></tr>
        <tr><td>Average order</td><td>${avg}%</td></tr>
        <tr><td>Best order</td><td>${best ? `#${best.ticket.id} ${best.ticket.cust.e} · ${best.r.total}` : "—"}</td></tr>
        <tr><td>Tips</td><td>🪙 ${S.tips}</td></tr>
        <tr><td>Food wasted</td><td>🗑 ${S.waste}</td></tr>
        <tr><td>Personal best shift</td><td>⭐ ${sv.best}</td></tr>
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
  }
  function renderTitleStats() {
    const lt = S.save.lifetime;
    if (!lt.shifts) { el.titleStats.hidden = true; return; }
    el.titleStats.hidden = false;
    el.titleStats.textContent =
      `Shift ${S.save.shift} · best shift ⭐ ${S.save.best} · lifetime 🪙 ${lt.tips} · ${lt.served} served`;
  }

  /* ---- main loop ---------------------------------------------------------- */
  let lastT = 0, patienceAcc = 0, visualAcc = 0;
  function tick(t) {
    if (!S.running) return;
    if (!lastT) lastT = t;
    const dt = Math.min((t - lastT) / 1000, 0.25);
    lastT = t;
    S.clock += dt;

    for (let i = 0; i < GRILL_SLOTS; i++) {
      const p = S.grill[i];
      if (!p) continue;
      p.down += COOK_RATE * dt;
      if (p.down > COOK_MAX && !p.burnt) { p.burnt = true; renderSlot(i); }
    }
    visualAcc += dt;
    if (visualAcc > 0.12) {
      visualAcc = 0;
      for (let i = 0; i < GRILL_SLOTS; i++) updateSlotVisual(i);
    }
    patienceAcc += dt;
    if (patienceAcc > 0.5) { patienceAcc = 0; updatePatience(); }

    updateCamera(dt);
    maybeSpawn();
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
    el.trash.addEventListener("click", trashSelected);
    el.undo.addEventListener("click", undoLayer);
    el.scrap.addEventListener("click", scrapBuild);
    el.bell.addEventListener("click", doServe);

    el.soundToggle.addEventListener("click", () => {
      S.soundOn = !S.soundOn;
      el.soundToggle.setAttribute("aria-pressed", String(S.soundOn));
    });

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
      const REACHABLE = ".tb-slot, .tb-slot-plate, .tb-tub, .tb-plate, .tb-trash, .tb-bin, " +
        ".tb-ticket, .tb-bell, .tb-turn, .tb-facing-tab, .tb-btn, .tb-icon-btn";
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
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* smoke-test / debug hook */
  window.__tb = {
    S, LAYERS, genTicket, face, layPatty, flipSlot, plateSlot, addBun, addLayer,
    addPattyToBuild, pinTicket, doServe, endShift, startShift, scoreOrder, lcsLen,
    pattyGrade, pattyPct, COOK_MAX, PERFECT,
  };
})();
