/* ============================================================================
   TROLL KOMBAT  —  a cursed meme-coin fighter for the Troll Runner Arcade.
   Vanilla JS + canvas, no build step, no deps.

   Every fighter is drawn LIVE on the canvas as a muscular cel-shaded troll-body
   (base -> shadow -> highlight -> bold ink outline) so the face shares the body
   palette and "blends in" — the look of the dino-riding trollface. Swap the head
   + palette + signature special and you get a whole roster from one rig.
   ============================================================================ */
(() => {
  "use strict";

  const canvas = document.getElementById("tk-canvas");
  if (!canvas) return;
  // Iconic trollface, stamped on the meme-coins instead of a plain "$".
  const TROLL_COIN_IMG = new Image();
  TROLL_COIN_IMG.src = "https://media.tenor.com/kkkBm71bkRcAAAAi/trollface-troll-face-terror-png.gif";
  // `ctx` is a `let` so portrait() can temporarily swap in an offscreen context
  // and reuse the same head-drawing helpers (they close over this binding).
  let ctx = canvas.getContext("2d");
  const W = canvas.width;   // 960
  const H = canvas.height;  // 540

  // --- Stage geometry ---------------------------------------------------------
  const FLOOR_Y = H - 56;       // y of the ground line (feet rest here)
  const WALL_L = 70;            // left fighter bound (fighter centre) — roomy arena
  const WALL_R = W - 70;        // right fighter bound
  const FIGHTER_SCALE = 1.18;   // rig is ~190px tall before scale
  const SPAWN_L = Math.round(W * 0.30), SPAWN_R = Math.round(W * 0.70);

  // --- Match tuning -----------------------------------------------------------
  const ROUND_TIME = 60;        // seconds
  const ROUNDS_TO_WIN = 2;      // best of 3
  const SUDDEN_DEATH_TIME = 15; // seconds; tied HP at time-out -> next hit wins
  const MAX_HP = 100;
  // Random map switching (Phase 6): when the setting is ON, the arena re-rolls
  // mid-fight on this interval. Tweak the range/lead-time here to taste.
  const MAP_SHIFT_MIN = 12;     // sec — soonest a mid-fight shift can fire
  const MAP_SHIFT_MAX = 20;     // sec — longest gap between shifts
  const MAP_SHIFT_WARN = 1.3;   // sec — "MAP SHIFTING…" warning before the swap
  const MAX_METER = 100;
  const MAX_STAM = 100;         // stamina pool

  // --- Movement tuning (kept together so it's easy to tweak) -----------------
  const WALK_SPEED = 330;       // px/s ground movement
  const AIR_SPEED = 300;        // px/s horizontal air control (drift while jumping)
  const JUMP_V = 760;           // initial jump velocity — high enough to clear a body
  const GRAVITY = 1500;         // px/s^2 fall accel
  const JUMP_CUT = 0.5;         // releasing jump while rising cuts ascent (variable height)

  // Render mode is locked to 2D pixel — the 3D "toy" mode was removed.
  let MODE = "pixel";
  const SHEET_DIR = "assets/games/troll-kombat/characters/";
  let currentStage = null;      // chosen STAGES entry (set at fight start)

  /* ==========================================================================
     AUDIO  —  tiny WebAudio synth (no asset files). Mirrors troll-dash's style.
     ========================================================================== */
  const audio = {
    ctx: null, on: false,
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },
    blip(freq, dur, type = "square", gain = 0.16, slideTo = null) {
      if (!this.on || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t); osc.stop(t + dur);
    },
    noise(dur, gain = 0.18) {
      if (!this.on || !this.ctx) return;
      const t = this.ctx.currentTime;
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(g).connect(this.ctx.destination);
      src.start(t);
    },
    punch() { this.noise(0.08, 0.14); this.blip(140, 0.09, "square", 0.12, 70); },
    kick()  { this.noise(0.12, 0.2);  this.blip(90, 0.16, "sawtooth", 0.16, 48); },
    block() { this.blip(320, 0.07, "square", 0.1, 260); this.noise(0.05, 0.08); },
    whiff() { this.blip(600, 0.06, "sine", 0.05, 360); },
    special(){ this.blip(220, 0.34, "sawtooth", 0.16, 880); this.noise(0.14, 0.12); },
    hitSpark(){ this.noise(0.06, 0.1); this.blip(520, 0.05, "triangle", 0.08, 380); },
    jump()  { this.blip(300, 0.16, "sine", 0.08, 620); },
    ko()    { this.blip(160, 0.5, "sawtooth", 0.2, 40); this.noise(0.3, 0.16); },
    bell()  { this.blip(880, 0.18, "triangle", 0.12); this.blip(1320, 0.22, "triangle", 0.09); },
    coin()  { this.blip(1180, 0.07, "square", 0.07, 1760); },
  };

  /* ==========================================================================
     ROSTER  —  palette + head drawing + signature special per meme champion.
     Palette: base / dark (shadow) / light (highlight) / ink (outline) plus a
     face tone and an accent used for the special FX. Faces share the body
     palette so they read as one sculpted body, like the dino trollface.
     ========================================================================== */
  const ROSTER = [
    {
      id: "pepe", name: "PEPE SAMURAI", title: "Samurai Warrior", tag: "Feels good, man", bar: "#3dff5e",
      blurb: "Tall samurai Pepe in a kabuto helmet with a cope katana. Cuts you down, then mints your loss as a red candle.",
      special: { name: "KATANA COPE SLASH", kind: "orb", cost: 100, color: "#9dff52", text: "" },
      pal: { base: "#5fae33", dark: "#2f6e1f", light: "#9fe05f", ink: "#10250a", face: "#5fae33", accent: "#9dff52", accent2: "#ff5dab" },
      drawHead: drawPepeHead,   // portrait/pre-load fallback only
      moves: { punch: "Cope Jab", kick: "Green Candle Kick", block: "Diamond Hands Guard", special: "Katana Cope Slash", finisher: "Feels Bad, Man" },
      portraitSrc: "pepe-rig/anims/portrait.png",
      splashSrc: "pepe-samurai-portrait.png",   // big pixel-bust portrait for select screens (same rig as in-fight sprite)
      // PixelLab pixel rig — east-facing animation strips, mirrored by facing.
      anims: {
        dir: "pepe-rig/anims/", cell: 92, scale: 3.6, footFrac: 0.978,
        defs: {
          idle:    { frames: 8, fps: 9,  loop: true },
          walk:    { frames: 6, fps: 14, loop: true },
          punch:   { frames: 6, fps: 18, loop: false },
          kick:    { frames: 7, fps: 16, loop: false },
          crouch:  { frames: 5, fps: 14, loop: false },
          jump:    { frames: 9, fps: 13, loop: false },
          special: { frames: 7, fps: 14, loop: false },
          hit:     { frames: 6, fps: 16, loop: false },
          ko:      { frames: 7, fps: 10, loop: false },
          finisher:{ frames: 9, fps: 12, loop: false },
        },
      },
    },
    {
      id: "doge", name: "DOGE DRIP", title: "Drip Master", tag: "Very fight. Much wow.", bar: "#ffcf33",
      blurb: "Tall Doge in a pink mink coat, black cap and square shades. Slides in, deal-with-it, pelts you with 1000x coins.",
      special: { name: "DEAL-WITH-IT DASH", kind: "barrage", cost: 100, color: "#ffd84d", text: "$" },
      pal: { base: "#e3ad4f", dark: "#a9762a", light: "#f7d98a", ink: "#3a2406", face: "#e8b85a", accent: "#ff6fd0", accent2: "#ffd84d" },
      drawHead: drawDogeHead,   // portrait/pre-load fallback only
      portraitSrc: "doge-rig/portrait.png",
      splashSrc: "doge-drip-portrait.png",   // big pixel-bust portrait for select screens (same rig as in-fight sprite)
      moves: { punch: "Much Punch", kick: "Such Kick", block: "Mink Coat Guard", special: "Deal-With-It Dash", finisher: "Very Rekt. Much Wow." },
      // PixelLab pixel rig — east-facing animation strips, mirrored by facing.
      // 180px cells; feet measured at y156 → footFrac 0.872; scale matches Pepe height.
      anims: {
        dir: "doge-rig/anims/", cell: 180, scale: 2.5, footFrac: 0.872,
        defs: {
          idle:    { frames: 8, fps: 9,  loop: true },
          walk:    { frames: 6, fps: 13, loop: true },
          punch:   { frames: 3, fps: 16, loop: false },
          kick:    { frames: 7, fps: 16, loop: false },
          crouch:  { frames: 5, fps: 14, loop: false },
          jump:    { frames: 7, fps: 13, loop: false },
          special: { frames: 4, fps: 14, loop: false },
          hit:     { frames: 6, fps: 16, loop: false },
          ko:      { frames: 7, fps: 10, loop: false },
          finisher:{ frames: 9, fps: 12, loop: false },
        },
      },
    },
    {
      id: "gladiator", name: "GLADIATOR", title: "Troll Gladiator", tag: "Spartan, problem?", bar: "#dfe6ef",
      blurb: "A swole troll in a Spartan cape. Lobs his spear with a smug grin, then finishes the job bare-fisted just to rub it in.",
      special: { name: "TROLL SPEAR", kind: "spear", cost: 100, color: "#c9ced6", text: "", fireProgress: 0.78 },
      pal: { base: "#e9e9ee", dark: "#9aa0ad", light: "#ffffff", ink: "#15151c", face: "#f2f2f5", accent: "#d23b3b", accent2: "#c8962a" },
      drawHead: drawTrollHead,   // fallback only — used until the anim strips finish loading
      portraitSrc: "gladiator/portrait.png",
      splashSrc: "troll-gladiator-portrait.png",   // big pixel-bust portrait for select screens (same rig as in-fight sprite)
      // Frame-based PixelLab animation set (east-facing; mirrored by facing).
      anims: {
        dir: "gladiator/anims/", cell: 136, scale: 2.5, footFrac: 0.99,
        defs: {
          idle:    { frames: 8, fps: 9,  loop: true },
          walk:    { frames: 6, fps: 12, loop: true },
          punch:   { frames: 4, fps: 16, loop: false },
          kick:    { frames: 7, fps: 14, loop: false },
          jump:    { frames: 9, fps: 14, loop: false },
          special: { frames: 6, fps: 13, loop: false },
          hit:     { frames: 6, fps: 16, loop: false },
          ko:      { frames: 7, fps: 10, loop: false },
          finisher:{ frames: 9, fps: 12, loop: false },
        },
      },
    },
  ];
  const byId = id => ROSTER.find(r => r.id === id);

  // Preload fighter sprites. A fighter with a loaded image renders as that
  // image (feet-anchored, mirrored by facing); one without falls back to the
  // procedural muscle rig. `spriteScale` maps the source top->feet span to
  // TARGET_BODY so every fighter is the same on-screen height.
  const SPRITE_DIR = "assets/games/troll-kombat/fighters/";
  const TARGET_BODY = 300;   // on-screen feet->top height, px

  // Strip near-black pixels → transparent. Returns an offscreen canvas.
  function stripBlackBg(img, threshold) {
    const oc = document.createElement("canvas");
    oc.width = img.naturalWidth; oc.height = img.naturalHeight;
    const oc2 = oc.getContext("2d");
    oc2.drawImage(img, 0, 0);
    const id = oc2.getImageData(0, 0, oc.width, oc.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < threshold && d[i + 1] < threshold && d[i + 2] < threshold) d[i + 3] = 0;
    }
    oc2.putImageData(id, 0, 0);
    return oc;
  }

  ROSTER.forEach(d => {
    if (!d.spriteSrc) return;
    const img = new Image();
    img.onload = () => {
      // Strip black bg for sprites that have one (flagged with needsBgStrip).
      d.img = d.needsBgStrip ? stripBlackBg(img, 40) : img;
      d.spriteScale = TARGET_BODY / (img.height * (d.footFrac || 1));
    };
    img.src = d.spriteFullPath || (SPRITE_DIR + d.spriteSrc);
  });

  // Preload frame-based animation strips (one horizontal strip per state).
  // A fighter with `anims` renders via drawAnimated once every strip is loaded.
  ROSTER.forEach(d => {
    if (!d.anims) return;
    d.animImg = {};
    const keys = Object.keys(d.anims.defs);
    let loaded = 0;
    const done = () => { if (++loaded === keys.length) d.animReady = true; };
    keys.forEach(k => {
      const img = new Image();
      img.onload = done;
      img.onerror = done;   // a missing strip shouldn't block the whole rig
      img.src = SPRITE_DIR + d.anims.dir + k + ".png";
      d.animImg[k] = img;
    });
  });

  /* ==========================================================================
     GRID SHEET FIGHTERS  —  Pepe Samurai / Doge Drip each ship as one grid
     legacy single-sheet pixel sprites. We measure each named frame's true
     content box so each pose is feet-anchored to the floor at one shared scale,
     no matter the cell padding.
     The pixel variant loads eagerly for the default mode and portraits.
     ========================================================================== */
  function contentBBox(sctx, ox, oy, cw, ch) {
    const data = sctx.getImageData(ox, oy, cw, ch).data;
    let minX = cw, minY = ch, maxX = 0, maxY = 0, found = false;
    for (let y = 0; y < ch; y += 2) {
      for (let x = 0; x < cw; x += 2) {
        if (data[(y * cw + x) * 4 + 3] > 24) {
          found = true;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) return { sx: ox, sy: oy, w: cw, h: ch };
    return { sx: ox + minX, sy: oy + minY, w: (maxX - minX) || 2, h: (maxY - minY) || 2 };
  }

  function buildSheetVariant(def, img) {
    // Sheets ship with real alpha (offline-cleaned), so just rasterise and
    // measure each grid cell's content box by alpha — no colour keying (which
    // would eat the dark armor / black cap + shades).
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const sctx = canvas.getContext("2d");
    sctx.drawImage(img, 0, 0);
    const S = def.sheet;
    const frames = {};
    for (const key in S.frames) {
      const [c, r] = S.frames[key];
      const x0 = Math.round(c * canvas.width / S.cols), x1 = Math.round((c + 1) * canvas.width / S.cols);
      const y0 = Math.round(r * canvas.height / S.rows), y1 = Math.round((r + 1) * canvas.height / S.rows);
      frames[key] = contentBBox(sctx, x0, y0, x1 - x0, y1 - y0);
    }
    const idle = frames.idle || frames[Object.keys(frames)[0]];
    return { canvas, frames, scale: TARGET_BODY / idle.h, ready: true };
  }

  function loadSheetVariant(def, which) {
    def.sheetImg = def.sheetImg || {};
    if (def.sheetImg[which] || def["_loading_" + which]) return;
    def["_loading_" + which] = true;
    const img = new Image();
    img.onload = () => {
      try { def.sheetImg[which] = buildSheetVariant(def, img); } catch (e) {}
      def["_loading_" + which] = false;
      redrawPortraits(def);
    };
    img.src = SHEET_DIR + def.sheet[which];
  }
  ROSTER.forEach(d => { if (d.sheet) loadSheetVariant(d, "pixel"); });

  // Portrait redraw hooks: select-screen thumbnails repaint when art finishes.
  const _portraitHooks = new Map();
  function registerPortrait(def, fn) {
    if (!_portraitHooks.has(def)) _portraitHooks.set(def, []);
    _portraitHooks.get(def).push(fn);
  }
  function redrawPortraits(def) {
    (_portraitHooks.get(def) || []).forEach(fn => { try { fn(); } catch (e) {} });
  }

  /* ==========================================================================
     LOW-LEVEL DRAWING HELPERS
     ========================================================================== */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function approach(cur, target, rate) { return cur + (target - cur) * Math.min(1, rate); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // A tapered muscular tube along a polyline: ink outline, base fill, top highlight.
  function drawTube(pts, w, pal, taper = 1) {
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    // outline
    ctx.strokeStyle = pal.ink; ctx.lineWidth = w + 4;
    strokePts(pts);
    // base
    ctx.strokeStyle = pal.base; ctx.lineWidth = w;
    strokePts(pts);
    // shadow underside
    ctx.strokeStyle = pal.dark; ctx.lineWidth = w * 0.5;
    strokePtsOffset(pts, 0, w * 0.22);
    // highlight topside
    ctx.strokeStyle = pal.light; ctx.lineWidth = w * 0.34;
    strokePtsOffset(pts, -w * 0.04, -w * 0.26);
  }
  function strokePts(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  function strokePtsOffset(pts, dx, dy) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x + dx, pts[0].y + dy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + dx, pts[i].y + dy);
    ctx.stroke();
  }
  // FK chain from origin: angle1 (upper) then +angle2 (fore). 0 = straight down, +x forward.
  function chain(ox, oy, a1, a2, l1, l2) {
    const j = { x: ox + Math.sin(a1) * l1, y: oy + Math.cos(a1) * l1 };
    const e = { x: j.x + Math.sin(a1 + a2) * l2, y: j.y + Math.cos(a1 + a2) * l2 };
    return { joint: j, end: e };
  }

  /* ==========================================================================
     HEADS  —  each drawn in local forward space (+x = facing). Centre at (0,0),
     radius r. Faces share the body palette so they sit on the body cleanly.
     ========================================================================== */
  function headBase(r, pal, squash = 1) {
    // common rounded skull blob with ink outline + shading, slightly forward-leaning
    ctx.save();
    ctx.scale(1, squash);
    ctx.beginPath();
    ctx.ellipse(2, 0, r * 1.02, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = pal.ink; ctx.fill();
    ctx.beginPath();
    ctx.ellipse(2, 0, r * 0.94, r * 0.92, 0, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, pal.light); g.addColorStop(0.5, pal.face); g.addColorStop(1, pal.dark);
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
  }
  // The signature troll grin — reusable so other heads can flash it on a hit.
  function trollGrin(x, y, s, ink) {
    ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1.4, s * 0.16); ctx.lineJoin = "round";
    ctx.fillStyle = "#fbfdff";
    ctx.beginPath();
    ctx.moveTo(x - s, y);
    ctx.quadraticCurveTo(x, y + s * 1.5, x + s, y);
    ctx.quadraticCurveTo(x, y + s * 0.5, x - s, y);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // teeth
    ctx.lineWidth = Math.max(1, s * 0.1);
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * s * 0.34, y + s * 0.1);
      ctx.lineTo(x + i * s * 0.34, y + s * 0.55);
      ctx.stroke();
    }
  }

  function drawTrollHead(r, pal, o) {
    headBase(r, pal, 1);
    const ink = pal.ink;
    ctx.lineCap = "round";
    // brows / squint eyes (classic troll)
    ctx.strokeStyle = ink; ctx.lineWidth = r * 0.12;
    ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.34); ctx.quadraticCurveTo(-r * 0.1, -r * 0.5, r * 0.18, -r * 0.28); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r * 0.3, -r * 0.36); ctx.quadraticCurveTo(r * 0.6, -r * 0.48, r * 0.82, -r * 0.26); ctx.stroke();
    // eyes
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.arc(-r * 0.16, -r * 0.18, r * 0.07, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.5, -r * 0.2, r * 0.07, 0, 7); ctx.fill();
    // the grin
    trollGrin(r * 0.12, r * 0.16, r * 0.52, ink);
  }

  function drawPepeHead(r, pal, o) {
    // frog skull + two big bulgy eyes on top
    headBase(r * 0.96, pal, 0.96);
    const ink = pal.ink;
    // eye bulges
    for (const ex of [-r * 0.42, r * 0.5]) {
      ctx.beginPath(); ctx.arc(ex, -r * 0.62, r * 0.42, 0, 7);
      ctx.fillStyle = ink; ctx.fill();
      ctx.beginPath(); ctx.arc(ex, -r * 0.62, r * 0.34, 0, 7);
      ctx.fillStyle = pal.light; ctx.fill();
      ctx.beginPath(); ctx.arc(ex + r * 0.08, -r * 0.6, r * 0.13, 0, 7);
      ctx.fillStyle = ink; ctx.fill();
    }
    // wide frog mouth with red lips
    ctx.strokeStyle = ink; ctx.lineWidth = r * 0.12; ctx.lineCap = "round";
    ctx.beginPath();
    if (o && o.hurt) { ctx.arc(r * 0.05, r * 0.18, r * 0.5, 0.15, Math.PI - 0.15); }
    else { ctx.moveTo(-r * 0.6, r * 0.3); ctx.quadraticCurveTo(r * 0.05, r * 0.62, r * 0.7, r * 0.28); }
    ctx.stroke();
    ctx.strokeStyle = pal.accent2; ctx.lineWidth = r * 0.06;
    ctx.stroke();
  }

  function drawDogeHead(r, pal, o) {
    const ink = pal.ink;
    // pointy ears
    ctx.fillStyle = ink;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.5, -r * 0.7);
      ctx.lineTo(s * r * 0.86, -r * 1.25);
      ctx.lineTo(s * r * 0.98, -r * 0.55);
      ctx.closePath(); ctx.fill();
    }
    headBase(r, pal, 1.02);
    // inner ears
    ctx.fillStyle = pal.dark;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.58, -r * 0.72);
      ctx.lineTo(s * r * 0.82, -r * 1.08);
      ctx.lineTo(s * r * 0.86, -r * 0.62);
      ctx.closePath(); ctx.fill();
    }
    // snout
    ctx.beginPath(); ctx.ellipse(r * 0.55, r * 0.22, r * 0.5, r * 0.38, 0, 0, 7);
    ctx.fillStyle = pal.light; ctx.fill();
    ctx.strokeStyle = ink; ctx.lineWidth = r * 0.08; ctx.stroke();
    // nose
    ctx.beginPath(); ctx.arc(r * 0.95, r * 0.12, r * 0.13, 0, 7); ctx.fillStyle = ink; ctx.fill();
    // doge eyebrows + eyes
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.arc(-r * 0.12, -r * 0.18, r * 0.09, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.42, -r * 0.2, r * 0.09, 0, 7); ctx.fill();
    ctx.strokeStyle = ink; ctx.lineWidth = r * 0.07;
    ctx.beginPath(); ctx.moveTo(-r * 0.28, -r * 0.4); ctx.lineTo(-r * 0.02, -r * 0.34); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r * 0.28, -r * 0.42); ctx.lineTo(r * 0.54, -r * 0.36); ctx.stroke();
    // smug doge smile
    ctx.beginPath(); ctx.moveTo(r * 0.2, r * 0.34); ctx.quadraticCurveTo(r * 0.55, r * 0.5, r * 0.9, r * 0.3); ctx.stroke();
  }

  /* ==========================================================================
     FIGHTER
     ========================================================================== */
  // attack frame data (seconds): startup / active / recovery, damage, reach, push
  const ATTACKS = {
    punch:   { startup: 0.07, active: 0.07, recovery: 0.17, dmg: 6,  reach: 118, push: 150, knock: 0.0, meter: 7,  sfx: "punch" },
    kick:    { startup: 0.15, active: 0.10, recovery: 0.30, dmg: 12, reach: 150, push: 330, knock: 0.0, meter: 10, sfx: "kick" },
    special: { startup: 0.22, active: 0.12, recovery: 0.34, dmg: 0,  reach: 0,   push: 0,   knock: 0,   meter: 0,  sfx: "special" },
  };

  class Fighter {
    constructor(def, x, facing, isCPU) {
      this.def = def;
      this.pal = def.pal;
      this.x = x;
      this.facing = facing;       // 1 = faces right, -1 = faces left
      this.isCPU = isCPU;
      this.y = 0;                 // vertical offset above floor (jump height, >=0)
      this.vy = 0;
      this.hp = MAX_HP;
      this.meter = 0;
      this.stamina = MAX_STAM;
      this.rounds = 0;
      this.dmgDealt = 0;          // cumulative damage dealt this match (leaderboard stat)
      this.kos = 0;               // rounds won by KO this match (leaderboard stat)
      this.reset(x, facing);
      // animation angle state (lerped toward targets each frame)
      this.a = this.restAngles();
      this.walkPhase = 0;
      this.blinkT = rand(1, 4);
      this.blink = 0;
    }
    restAngles() {
      return {
        torso: -0.05, head: 0,
        bArmSh: -0.5, bArmEl: 0.7, fArmSh: 0.55, fArmEl: 0.95,
        footFx: 20, footFy: 0, footBx: -24, footBy: 0,
        hipY: -78, kneeBend: 11,
      };
    }
    reset(x, facing) {
      this.x = x; this.facing = facing;
      this.y = 0; this.vy = 0;
      this.hp = MAX_HP;
      this.state = "idle";        // idle walk jump crouch block attack hit ko win intro
      this.stateT = 0;
      this.attack = null;         // {type, def, t, hasHit}
      this.hitstun = 0;
      this.blockStun = 0;
      this.koFall = 0;
      this.winT = 0;
      this.flash = 0;             // white hit flash
      this.hurtFace = 0;
      this.stamina = MAX_STAM;
      this.rektStun = 0;          // "rekt" vulnerable stun when stamina bottoms out
      this.dashT = 0;             // active dash timer
      this.jumpCut = false;       // SSB variable-jump: ascent already cut?
      this.tookDamage = false;    // for FLAWLESS detection
    }
    get grounded() { return this.y <= 0.01; }
    get feetY() { return FLOOR_Y - this.y; }

    canAct() {
      return this.state !== "ko" && this.state !== "win" &&
        this.hitstun <= 0 && this.blockStun <= 0 && this.rektStun <= 0 &&
        !(this.attack && this.attack.t < this.attack.def.startup + this.attack.def.active + this.attack.def.recovery);
    }

    // Stamina bottomed out → drop guard, brief vulnerable stagger.
    enterRekt() {
      if (this.rektStun > 0 || this.state === "ko") return;
      this.rektStun = 0.8;
      this.state = "hit";
      this.attack = null;
      this.stamina = 0;
      audio.whiff();
      spark(this.x, this.feetY - 150, "#ff5a5a", 10, true);
    }

    startAttack(type) {
      if (type === "special") {
        if (this.meter < this.def.special.cost) { audio.whiff(); return; }
        this.meter = 0;
        this.stamina = Math.max(0, this.stamina - 28);
        this.attack = { type, def: ATTACKS.special, t: 0, hasHit: false, fired: false };
        this.state = "attack";
        audio.special();
        return;
      }
      this.attack = { type, def: ATTACKS[type], t: 0, hasHit: false };
      this.state = "attack";
      audio[ATTACKS[type].sfx]();
    }

    hurt(dmg, push, fromX, blocked) {
      if (this.state === "ko") return;
      if (this.rektStun > 0 && !blocked) dmg *= 1.25;   // rekt = extra vulnerable
      this.facing = fromX < this.x ? 1 : -1;
      if (blocked) {
        this.hp = Math.max(0, this.hp - dmg * 0.1);     // light chip only
        this.blockStun = 0.12;
        this.vx = (this.x < fromX ? -1 : 1) * push * 0.32;
        this.meter = Math.min(MAX_METER, this.meter + dmg * 0.4);
        audio.block();
        spark(this.x + this.facing * 50, this.feetY - 150, this.pal.accent, 12, true);
        return;
      }
      this.hp = Math.max(0, this.hp - dmg);
      this.tookDamage = true;
      this.meter = Math.min(MAX_METER, this.meter + dmg * 1.1);
      this.flash = 0.16;
      this.hurtFace = 0.6;
      audio.hitSpark();
      spark(this.x + (fromX < this.x ? 44 : -44), this.feetY - 150, "#fff2a8", 12, false);
      shake(Math.min(10, dmg * 0.7));
      // Super-armor: a special in progress powers through incoming hits.
      if (this.attack && this.attack.type === "special") {
        this.vx = (this.x < fromX ? -1 : 1) * push * 0.25;
      } else {
        this.hitstun = 0.30;
        this.state = "hit";
        this.attack = null;
        this.vx = (this.x < fromX ? -1 : 1) * push;
      }
      if (this.hp <= 0) this.ko();
    }
    ko() {
      this.state = "ko"; this.koFall = 0; this.attack = null; this.hitstun = 0;
      audio.ko();
    }
    win() { this.state = "win"; this.winT = 0; }

    update(dt, intent, opp, phase) {
      this.stateT += dt;
      this.hitstun = Math.max(0, this.hitstun - dt);
      this.blockStun = Math.max(0, this.blockStun - dt);
      this.flash = Math.max(0, this.flash - dt);
      this.hurtFace = Math.max(0, this.hurtFace - dt);
      this.dashT = Math.max(0, this.dashT - dt);
      const wasRekt = this.rektStun > 0;
      this.rektStun = Math.max(0, this.rektStun - dt);
      if (wasRekt && this.rektStun === 0) this.stamina = 45;   // recover after the stagger
      this.vx = (this.vx || 0);

      // blink
      this.blinkT -= dt;
      if (this.blinkT <= 0) { this.blink = 0.12; this.blinkT = rand(1.6, 4.5); }
      this.blink = Math.max(0, this.blink - dt);

      // Facing: while actively walking, turn the body to your movement direction
      // (so you can spin around without having to jump across the opponent);
      // when idle, default to facing the opponent. Works for every fighter.
      if (this.canAct() && phase === "fight") {
        const moveDir = (intent.right ? 1 : 0) - (intent.left ? 1 : 0);
        this.facing = moveDir !== 0 ? moveDir : (opp.x < this.x ? -1 : 1);
      }

      if (this.state === "ko") { this.updateKO(dt); this.physics(dt); return; }
      if (this.state === "win") { this.winT += dt; this.physics(dt); this.animate(dt, intent); return; }
      if (phase !== "fight") { this.physics(dt); this.animate(dt, intent); return; }

      // resolve attack lifecycle
      if (this.attack) {
        this.attack.t += dt;
        const A = this.attack.def;
        const inActive = this.attack.t >= A.startup && this.attack.t < A.startup + A.active;
        const fireAt = this.def.special.fireProgress != null
          ? this.def.special.fireProgress * (A.startup + A.active + A.recovery)
          : A.startup;
        if (this.attack.type === "special" && this.attack.t >= fireAt && !this.attack.fired) {
          this.attack.fired = true;
          fireSpecial(this, opp);
        }
        if (inActive && this.attack.type !== "special" && !this.attack.hasHit) {
          this.tryMeleeHit(opp);
        }
        if (this.attack.t >= A.startup + A.active + A.recovery) {
          this.attack = null;
          this.state = "idle";
        }
      }

      const acting = !this.canAct();
      let regen = true;
      const move = (intent.right ? 1 : 0) - (intent.left ? 1 : 0);
      if (!acting) {
        const grounded0 = this.grounded;
        // Jump is its own action (not in the attack chain) so you can leap AND
        // punch/kick on the same press, and combine with left/right (W+D, W+A).
        if (intent.up && grounded0) {
          this.vy = JUMP_V; this.state = "jump"; this.jumpCut = false;
          this.stamina = Math.max(0, this.stamina - 8); audio.jump(); regen = false;
        }
        // Attacks (one at a time) — fire grounded OR airborne (air normals).
        if (intent.special) this.startAttack("special");
        else if (intent.kick) this.startAttack("kick");
        else if (intent.punch) this.startAttack("punch");
        else if (intent.dash && grounded0 && this.dashT <= 0 && this.stamina >= 16) {
          const d = move !== 0 ? move : this.facing;
          this.vx = d * 560; this.dashT = 0.26; this.stamina -= 16;
          this.state = "walk"; this.walkDir = d * this.facing;
          audio.blip(440, 0.12, "sawtooth", 0.1, 700); regen = false;
        }
        else if (this.state !== "jump" && grounded0) {
          // grounded ground states (block / crouch / walk / idle)
          if (intent.block) {
            this.state = "block"; this.vx *= 0.6;
            this.stamina -= 12 * dt; regen = false;
            if (this.stamina <= 0) { this.stamina = 0; this.enterRekt(); }
          }
          else if (intent.crouch) { this.state = "crouch"; }
          else if (move !== 0) {
            this.x += move * WALK_SPEED * dt;
            this.state = "walk";
            this.walkDir = move * this.facing; // +1 forward, -1 back
          } else { this.state = "idle"; }
        }
      }
      // Air control: drift horizontally while airborne (during jumps AND air
      // attacks), so W+D / W+A give diagonal jumps and you can reposition mid-air.
      if (!this.grounded && move !== 0) {
        this.x = clamp(this.x + move * AIR_SPEED * dt, WALL_L, WALL_R);
        this.walkDir = move * this.facing;
      }
      // keep the airborne pose if a mid-air action just ended
      if (!this.grounded && (this.state === "idle" || this.state === "walk")) this.state = "jump";

      // Variable jump height (SSB short-hop): releasing jump while rising cuts ascent.
      if (this.state === "jump" && this.vy > 0 && !intent.up && !this.jumpCut) {
        this.vy *= JUMP_CUT; this.jumpCut = true;
      }
      // stamina regenerates whenever it isn't being spent
      if (regen && this.rektStun <= 0) this.stamina = Math.min(MAX_STAM, this.stamina + 17 * dt);
      this.physics(dt);
      this.animate(dt, intent);
    }

    physics(dt) {
      // gravity / jump
      if (!this.grounded || this.vy > 0) {
        this.vy -= GRAVITY * dt;
        this.y += this.vy * dt;
        if (this.y <= 0) { this.y = 0; this.vy = 0; if (this.state === "jump") this.state = "idle"; }
      }
      // knockback / sliding
      if (Math.abs(this.vx) > 1) {
        this.x += this.vx * dt;
        this.vx *= Math.pow(0.0025, dt); // strong damping
      } else this.vx = 0;
      this.x = clamp(this.x, WALL_L, WALL_R);
    }

    updateKO(dt) {
      this.koFall = Math.min(1, this.koFall + dt * 2.4);
    }

    tryMeleeHit(opp) {
      const A = this.attack.def;
      const reach = A.reach;
      const hx = this.x + this.facing * reach * 0.62;
      const hy = this.feetY - (this.attack.type === "kick" ? 95 : 150);
      if (opp.state === "ko") return;
      // opponent hurt box (centred mid-body, ~full sprite height)
      const dx = Math.abs(opp.x - hx);
      const dy = Math.abs((opp.feetY - 140) - hy);
      if (dx < 76 && dy < 130 && Math.sign(opp.x - this.x) === this.facing) {
        const blocking = (opp.state === "block") && (opp.facing !== this.facing);
        this.attack.hasHit = true;
        const before = opp.hp;
        opp.hurt(A.dmg, A.push, this.x, blocking);
        this.dmgDealt += before - opp.hp;   // attribute actual HP lost to the attacker
        this.meter = Math.min(MAX_METER, this.meter + A.meter);
        if (!blocking) hitstop(0.06);
      }
    }

    // ---- pose targets per state, lerped for smooth animation ----
    animate(dt, intent) {
      const r = this.restAngles();
      const t = this.a;
      const rate = dt * 16;
      let tgt = { ...r };

      if (this.state === "walk") {
        this.walkPhase += dt * 11 * (this.walkDir < 0 ? 0.8 : 1);
        const s = Math.sin(this.walkPhase);
        tgt.footFx = 20 + s * 18; tgt.footFy = Math.max(0, -s) * -16;
        tgt.footBx = -24 + s * 18; tgt.footBy = Math.max(0, s) * -16;
        tgt.fArmSh = 0.5 + s * 0.3; tgt.bArmSh = -0.5 - s * 0.3;
        tgt.torso = -0.08;
      } else if (this.state === "crouch") {
        tgt.hipY = -50; tgt.kneeBend = 22; tgt.torso = 0.12;
        tgt.fArmSh = 0.8; tgt.fArmEl = 1.2; tgt.bArmSh = 0.7; tgt.bArmEl = 1.2;
        tgt.footFx = 26; tgt.footBx = -28;
      } else if (this.state === "jump") {
        tgt.footFx = 12; tgt.footFy = -26; tgt.footBx = -14; tgt.footBy = -30;
        tgt.kneeBend = 24; tgt.fArmSh = 1.1; tgt.bArmSh = 0.9; tgt.torso = 0.05;
      } else if (this.state === "block") {
        tgt.fArmSh = 0.95; tgt.fArmEl = 1.7; tgt.bArmSh = 1.0; tgt.bArmEl = 1.7;
        tgt.torso = -0.12; tgt.hipY = -70; tgt.kneeBend = 16; tgt.footFx = 16;
      } else if (this.state === "hit") {
        tgt.torso = -0.4; tgt.head = -0.3; tgt.fArmSh = -0.4; tgt.bArmSh = -0.6;
        tgt.fArmEl = 0.4; tgt.footFx = 14; tgt.footBx = -30;
      } else if (this.state === "win") {
        const b = Math.sin(this.winT * 6) * 0.12;
        tgt.fArmSh = -2.2 + b; tgt.fArmEl = 0.3; tgt.bArmSh = -2.0 - b; tgt.bArmEl = 0.3;
        tgt.torso = -0.06; tgt.head = -0.05;
      } else if (this.state === "attack" && this.attack) {
        const A = this.attack.def; const at = this.attack.t;
        const phase = at < A.startup ? at / A.startup
          : at < A.startup + A.active ? 1
          : 1 - (at - A.startup - A.active) / A.recovery;
        const p = clamp(phase, 0, 1);
        if (this.attack.type === "punch") {
          tgt.fArmSh = lerp(0.5, 1.57, p); tgt.fArmEl = lerp(0.9, 0.04, p);
          tgt.torso = lerp(-0.05, 0.16, p); tgt.bArmSh = -0.7;
        } else if (this.attack.type === "kick") {
          tgt.footFx = lerp(20, 96, p); tgt.footFy = lerp(0, -70, p);
          tgt.torso = lerp(-0.05, -0.26, p); tgt.fArmSh = -0.4; tgt.bArmSh = -1.0;
          tgt.footBx = -22;
        } else { // special — both arms thrust forward
          tgt.fArmSh = lerp(0.5, 1.5, p); tgt.fArmEl = lerp(0.9, 0.06, p);
          tgt.bArmSh = lerp(-0.5, 1.4, p); tgt.bArmEl = lerp(0.7, 0.12, p);
          tgt.torso = lerp(-0.05, 0.2, p);
        }
      }
      // idle breathing
      if (this.state === "idle") {
        tgt.torso = -0.05 + Math.sin(this.stateT * 2.4) * 0.02;
      }
      for (const k in tgt) t[k] = approach(t[k], tgt[k], rate);
    }

    // ---- draw: world shadow, then sprite (if loaded) or procedural rig ----
    draw() {
      // world-space ground shadow — stays on the floor, shrinks with jump height
      const shW = Math.max(16, 46 - this.y * 0.06) * (this.def.img || this.def.anims || this.def.sheet ? 1.5 : 1.0);
      ctx.beginPath();
      ctx.ellipse(this.x, FLOOR_Y, shW, 9, 0, 0, 7);
      ctx.fillStyle = "rgba(0,0,0,0.32)"; ctx.fill();

      if (this.def.sheet && this.def.sheetImg && this.def.sheetImg.pixel) { this.drawSheet(); return; }
      if (this.def.anims && this.def.animReady) { this.drawAnimated(); return; }
      if (this.def.img && this.def.spriteScale) { this.drawSprite(); return; }
      this.drawProcedural();
    }

    // Which named grid frame fits the current state.
    sheetFrameKey() {
      const F = this.def.sheet.frames;
      const st = this.state;
      if (st === "attack" && this.attack) {
        const A = this.attack.def, at = this.attack.t;
        const second = at > (A.startup + A.active + A.recovery) * 0.4;   // wind-up -> extend
        const t = this.attack.type;
        if (t === "special") return (second && F.special2) ? "special2" : (F.special ? "special" : "punch");
        if (t === "punch")   return (second && F.punch2) ? "punch2" : "punch";
        if (t === "kick")    return (second && F.kick2) ? "kick2" : "kick";
        return F[t] ? t : "punch";
      }
      if (st === "ko") return F.ko ? "ko" : (F.hit ? "hit" : "idle");
      if (st === "hit") return F.hit ? "hit" : "idle";
      if (st === "block") return F.block ? "block" : "idle";
      if (st === "crouch") return F.crouch ? "crouch" : "idle";
      if (st === "jump") return F.jump ? "jump" : "idle";
      if (st === "win") return F.win ? "win" : "idle";
      if (st === "walk") return (F.walk2 && Math.floor(this.walkPhase / 0.32) % 2) ? "walk2"
                              : (F.walk1 ? "walk1" : "idle");
      return (F.idle2 && Math.floor(this.stateT * 1.6) % 2) ? "idle2" : "idle";
    }

    // Grid-sheet sprite: feet-anchored via measured content box, mirrored by
    // facing, with state "flavour" transforms (a single frame can't articulate).
    drawSheet() {
      const v = this.def.sheetImg.pixel && this.def.sheetImg.pixel.ready ? this.def.sheetImg.pixel : null;
      if (!v) { this.drawProcedural(); return; }
      const f = v.frames[this.sheetFrameKey()] || v.frames.idle;
      const sc = v.scale, dw = f.w * sc, dh = f.h * sc;

      let rot = 0, tx = 0, ty = 0, alpha = 1;
      if (this.state === "attack" && this.attack) {
        const A = this.attack.def, at = this.attack.t;
        const ph = at < A.startup ? at / A.startup
          : at < A.startup + A.active ? 1
          : 1 - (at - A.startup - A.active) / A.recovery;
        const k = clamp(ph, 0, 1);
        if (this.attack.type === "kick") tx = 26 * k;
        else if (this.attack.type === "special") ty = -4 * k;
        else tx = 30 * k;                       // punch lunge
      } else if (this.state === "hit") { rot = -0.18; tx = -10; }
      else if (this.state === "walk") { ty = Math.abs(Math.sin(this.walkPhase)) * -4; }
      else if (this.state === "idle") { ty = Math.sin(this.stateT * 2.4) * 2; }
      else if (this.state === "win") { ty = Math.abs(Math.sin(this.winT * 5)) * -14; rot = Math.sin(this.winT * 3) * 0.05; }
      else if (this.state === "ko") { rot = this.koFall * -1.1; ty = this.koFall * 30; alpha = 1 - this.koFall * 0.1; }
      if (this.rektStun > 0) rot += Math.sin(this.stateT * 30) * 0.04;   // dizzy shudder

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = false;
      ctx.translate(this.x, this.feetY);
      ctx.scale(this.facing, 1);
      ctx.translate(tx, ty);
      ctx.rotate(rot);
      if (this.flash > 0) ctx.filter = "brightness(2.4) saturate(0.5)";
      ctx.drawImage(v.canvas, f.sx, f.sy, f.w, f.h, -dw / 2, -dh, dw, dh);
      ctx.filter = "none";
      ctx.restore();

      if (this.flash > 0) {
        ctx.save();
        ctx.globalAlpha = this.flash * 2;
        ctx.globalCompositeOperation = "overlay";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(this.x - dw / 2, this.feetY - dh, dw, dh);
        ctx.restore();
      }
    }

    // Static sprite: feet-anchored, mirrored by facing, with state "flavour"
    // transforms (lunge/tilt/squash) since a single image can't articulate limbs.
    drawSprite() {
      const img = this.def.img, sc = this.def.spriteScale;
      const dw = img.width * sc, dh = img.height * sc;
      const feetTop = img.height * (this.def.footFrac || 1) * sc; // feet dist from sprite top

      let rot = 0, sx = this.facing, sy = 1, tx = 0, ty = 0, alpha = 1;
      if (this.state === "attack" && this.attack) {
        const A = this.attack.def, at = this.attack.t;
        const ph = at < A.startup ? at / A.startup
          : at < A.startup + A.active ? 1
          : 1 - (at - A.startup - A.active) / A.recovery;
        const k = clamp(ph, 0, 1);
        if (this.attack.type === "kick") { tx = 30 * k; rot = -0.13 * k; }
        else if (this.attack.type === "special") { sy = 1 + 0.05 * k; ty = -6 * k; }
        else { tx = 34 * k; rot = 0.11 * k; }            // punch lunge
      } else if (this.state === "crouch") { sy = 0.76; }
      else if (this.state === "block") { tx = -8; rot = -0.06; }
      else if (this.state === "hit") { rot = -0.24; tx = -12; }
      else if (this.state === "walk") { ty = Math.abs(Math.sin(this.walkPhase)) * -5; }
      else if (this.state === "idle") { ty = Math.sin(this.stateT * 2.4) * 2.2; }
      else if (this.state === "win") { ty = Math.abs(Math.sin(this.winT * 5)) * -16; rot = Math.sin(this.winT * 3) * 0.05; }
      else if (this.state === "ko") { rot = this.koFall * -1.2; ty = this.koFall * 34; alpha = 1 - this.koFall * 0.12; }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(this.x, this.feetY);   // origin = feet on the floor
      ctx.scale(sx, sy);
      ctx.rotate(rot);
      ctx.translate(tx, ty);
      if (this.state !== "ko") {            // clip below the feet line (hide leftover shadow)
        ctx.beginPath();
        ctx.rect(-dw, -dh - 60, dw * 2, dh + 62);
        ctx.clip();
      }
      if (this.flash > 0) ctx.filter = "brightness(2.6) saturate(0.4)";
      ctx.drawImage(img, -dw / 2, -feetTop, dw, dh);
      ctx.filter = "none";
      ctx.restore();
    }

    drawProcedural() {
      const pal = this.pal, a = this.a;
      ctx.save();
      ctx.translate(this.x, this.feetY);
      ctx.scale(this.facing * FIGHTER_SCALE, FIGHTER_SCALE);

      let koRot = 0, koDrop = 0;
      if (this.state === "ko") { koRot = this.koFall * 1.5; koDrop = this.koFall * 18; }

      ctx.save();
      ctx.translate(0, koDrop);
      ctx.rotate(koRot);

      const hip = { x: 0, y: a.hipY };
      const shoulder = { x: 2, y: a.hipY - 58 + a.torso * 6 };
      const headC = { x: shoulder.x + Math.sin(a.torso) * -2, y: shoulder.y - 30 };

      // legs (IK: knee = midpoint pushed forward)
      drawLeg(hip, { x: a.footBx, y: a.footBy }, a.kneeBend + 2, shade(pal, 0.78)); // back leg
      // back arm
      drawArm(shoulder, a.bArmSh + a.torso, a.bArmEl, shade(pal, 0.82));

      // torso
      drawTorso(hip, shoulder, a.torso, pal, this.flash);

      // front leg
      drawLeg(hip, { x: a.footFx, y: a.footFy }, a.kneeBend, pal);

      // head
      ctx.save();
      ctx.translate(headC.x, headC.y);
      ctx.rotate(a.head + a.torso * 0.5);
      this.def.drawHead(20, this.pal, { hurt: this.hurtFace > 0, blink: this.blink > 0 });
      // hit flash overlay on head
      if (this.flash > 0) {
        ctx.globalAlpha = this.flash * 3;
        ctx.beginPath(); ctx.arc(2, 0, 22, 0, 7);
        ctx.fillStyle = "#fff"; ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.restore();

      // front arm (over body)
      drawArm(shoulder, a.fArmSh + a.torso, a.fArmEl, pal);

      ctx.restore(); // ko transform
      ctx.restore(); // fighter transform

      // full-body hit flash
      if (this.flash > 0) {
        ctx.save();
        ctx.globalAlpha = this.flash * 2.2;
        ctx.globalCompositeOperation = "overlay";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(this.x - 60, this.feetY - 200, 120, 210);
        ctx.restore();
      }
    }

    // Frame-based animated sprite (PixelLab strips). Reuses this.state + the
    // engine's existing timers to pick an animation + frame, feet-anchored and
    // mirrored by facing. East art faces right, so facing 1 draws as-is.
    drawAnimated() {
      const A = this.def.anims, cell = A.cell, sc = A.scale;
      let key = "idle", loop = true, prog = 0;
      const st = this.state;
      if (st === "walk") { key = "walk"; loop = true; }
      else if (st === "crouch" && A.defs.crouch) { key = "crouch"; loop = false; prog = 1; }   // hold crouched pose
      else if (st === "jump") { key = "jump"; loop = false; prog = clamp((JUMP_V - this.vy) / (JUMP_V * 2), 0, 1); }
      else if (st === "hit")  { key = "hit";  loop = false; prog = clamp(1 - this.hitstun / 0.30, 0, 1); }
      else if (st === "ko")   { key = A.defs.ko ? "ko" : "hit"; loop = false; prog = A.defs.ko ? this.koFall : 1; }
      else if (st === "attack" && this.attack) {
        const t = this.attack.type;
        key = (t === "punch" || t === "kick" || t === "special") ? t : "punch";
        const ad = this.attack.def, dur = ad.startup + ad.active + ad.recovery;
        loop = false; prog = clamp(this.attack.t / dur, 0, 1);
      }
      // block / win / intro → idle stance

      // Fall back to idle if the chosen strip isn't loaded yet (e.g. KO pending).
      const ready = k => A.defs[k] && this.def.animImg[k] && this.def.animImg[k].complete && this.def.animImg[k].naturalWidth;
      if (!ready(key)) { key = "idle"; loop = true; prog = 0; }

      const def = A.defs[key] || A.defs.idle;
      const n = def.frames;
      const idx = loop ? (Math.floor(this.stateT * def.fps) % n)
                       : clamp(Math.floor(prog * n), 0, n - 1);

      const img = this.def.animImg[key] || this.def.animImg.idle;
      if (!img || !img.complete) return;

      const dw = cell * sc, dh = cell * sc;
      const feetTop = cell * A.footFrac * sc;   // cell-top → feet, scaled
      ctx.save();
      ctx.imageSmoothingEnabled = false;        // keep pixels crisp
      ctx.translate(this.x, this.feetY);
      ctx.scale(this.facing, 1);
      if (this.flash > 0) ctx.filter = "brightness(2.4) saturate(0.5)";
      ctx.drawImage(img, idx * cell, 0, cell, cell, -dw / 2, -feetTop, dw, dh);
      ctx.filter = "none";
      ctx.restore();
    }
  }

  function shade(pal, f) {
    return { base: mix(pal.base, "#000", 1 - f), dark: mix(pal.dark, "#000", 1 - f),
      light: mix(pal.light, "#000", 1 - f), ink: pal.ink, face: pal.face, accent: pal.accent };
  }
  function mix(hex, hex2, t) {
    const a = hx(hex), b = hx(hex2);
    return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
  }
  function hx(h) {
    if (h[0] === "r") { const m = h.match(/\d+/g); return [+m[0], +m[1], +m[2]]; }
    const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function drawArm(sh, a1, a2, pal) {
    const c = chain(sh.x, sh.y, a1, a2, 28, 28);
    drawTube([sh, c.joint, c.end], 15, pal);
    // bicep bulge highlight
    ctx.beginPath();
    ctx.ellipse((sh.x + c.joint.x) / 2, (sh.y + c.joint.y) / 2, 7, 5, a1, 0, 7);
    ctx.fillStyle = pal.light; ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
    // fist
    ctx.beginPath(); ctx.arc(c.end.x, c.end.y, 9, 0, 7);
    ctx.fillStyle = pal.ink; ctx.fill();
    ctx.beginPath(); ctx.arc(c.end.x, c.end.y, 7, 0, 7);
    ctx.fillStyle = pal.base; ctx.fill();
  }

  function drawLeg(hip, foot, kneeOut, pal) {
    const mid = { x: (hip.x + foot.x) / 2 + kneeOut, y: (hip.y + foot.y) / 2 };
    drawTube([hip, mid, foot], 18, pal);
    // thigh highlight
    ctx.beginPath();
    ctx.ellipse((hip.x + mid.x) / 2, (hip.y + mid.y) / 2, 6, 9, 0, 0, 7);
    ctx.fillStyle = pal.light; ctx.globalAlpha = 0.45; ctx.fill(); ctx.globalAlpha = 1;
    // foot
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(foot.x + 6, foot.y - 2, 14, 7, 0, 0, 7);
    ctx.fillStyle = pal.ink; ctx.fill();
    ctx.beginPath();
    ctx.ellipse(foot.x + 6, foot.y - 3, 12, 5, 0, 0, 7);
    ctx.fillStyle = pal.dark; ctx.fill();
    ctx.restore();
  }

  function drawTorso(hip, sh, lean, pal, flash) {
    const topW = 40, botW = 22;
    const dx = Math.sin(lean) * 18; // shoulder shift from lean
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(hip.x - botW, hip.y);
    ctx.quadraticCurveTo(-topW - 4 + dx * 0.4, (hip.y + sh.y) / 2, sh.x - topW + dx, sh.y);
    ctx.quadraticCurveTo(sh.x + dx, sh.y - 16, sh.x + topW + dx, sh.y);  // shoulders/traps
    ctx.quadraticCurveTo(topW + 4 + dx * 0.4, (hip.y + sh.y) / 2, hip.x + botW, hip.y);
    ctx.quadraticCurveTo(hip.x, hip.y + 14, hip.x - botW, hip.y);
    ctx.closePath();
    // outline
    ctx.lineJoin = "round"; ctx.strokeStyle = pal.ink; ctx.lineWidth = 4; ctx.stroke();
    // body gradient
    const g = ctx.createLinearGradient(0, sh.y, 0, hip.y);
    g.addColorStop(0, pal.light); g.addColorStop(0.45, pal.base); g.addColorStop(1, pal.dark);
    ctx.fillStyle = g; ctx.fill();
    ctx.clip();
    // pecs
    ctx.strokeStyle = pal.ink; ctx.globalAlpha = 0.6; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(sh.x + dx, sh.y + 4); ctx.lineTo(sh.x + dx, sh.y + 26); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sh.x - 26 + dx, sh.y + 22);
    ctx.quadraticCurveTo(sh.x + dx, sh.y + 30, sh.x + 26 + dx, sh.y + 22);
    ctx.stroke();
    // abs
    const abTop = sh.y + 30, abBot = hip.y - 6;
    ctx.beginPath(); ctx.moveTo(0, abTop); ctx.lineTo(0, abBot); ctx.stroke();
    for (let i = 1; i <= 3; i++) {
      const yy = lerp(abTop, abBot, i / 3.4);
      ctx.beginPath(); ctx.moveTo(-15, yy); ctx.lineTo(15, yy); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // chest highlight
    ctx.beginPath();
    ctx.ellipse(sh.x - 12 + dx, sh.y + 12, 9, 7, -0.3, 0, 7);
    ctx.fillStyle = pal.light; ctx.globalAlpha = 0.4; ctx.fill(); ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ==========================================================================
     PROJECTILES + PARTICLES + SCREEN FX
     ========================================================================== */
  let projectiles = [];
  let particles = [];
  let shakeAmt = 0, hitstopT = 0;
  function shake(n) { shakeAmt = Math.max(shakeAmt, n); }
  function hitstop(t) { hitstopT = Math.max(hitstopT, t); }
  function spark(x, y, color, n, ring) {
    for (let i = 0; i < n; i++) {
      const ang = ring ? (i / n) * 7 : rand(0, 7);
      const sp = rand(60, 260);
      particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40,
        life: rand(0.25, 0.5), max: 0.5, color, r: rand(2, 5), g: 1 });
    }
  }
  function coinBurst(x, y) {
    for (let i = 0; i < 22; i++) {
      particles.push({ x, y: y - 60, vx: rand(-220, 220), vy: rand(-420, -120),
        life: rand(0.7, 1.4), max: 1.4, color: "#ffd84d", r: rand(4, 8), g: 1, coin: true });
    }
  }

  function fireSpecial(f, opp) {
    const sp = f.def.special;
    const ox = f.x + f.facing * 64, oy = f.feetY - 150;
    shake(6);
    if (sp.kind === "barrage") {
      for (let i = 0; i < 5; i++) {
        projectiles.push({ owner: f, x: ox, y: oy + rand(-18, 18), vx: f.facing * rand(360, 520),
          vy: rand(-40, 40), r: 16, dmg: 5, life: 2.4, color: sp.color, text: "$", hit: false, kind: "coin" });
      }
    } else if (sp.kind === "spear") { // thrown spear
      projectiles.push({ owner: f, x: ox, y: oy, vx: f.facing * 640, vy: 0, r: 13, dmg: 16,
        life: 2.6, color: sp.color, hit: false, kind: "spear", facing: f.facing });
    } else { // projectile orb
      projectiles.push({ owner: f, x: ox, y: oy, vx: f.facing * 440, vy: 0, r: 24, dmg: 16,
        life: 2.4, color: sp.color, text: sp.text, hit: false, kind: "orb" });
    }
  }

  function updateProjectiles(dt, fighters) {
    for (const p of projectiles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.kind === "coin") p.vy += 320 * dt;
      const opp = p.owner === fighters[0] ? fighters[1] : fighters[0];
      if (!p.hit && opp.state !== "ko") {
        const dx = Math.abs(opp.x - p.x), dy = Math.abs((opp.feetY - 140) - p.y);
        if (dx < 54 + p.r && dy < 120) {
          p.hit = true;
          const blocking = opp.state === "block" && opp.facing !== p.owner.facing;
          const before = opp.hp;
          opp.hurt(p.dmg, 360, p.owner.x, blocking);
          if (p.owner) p.owner.dmgDealt += before - opp.hp;   // credit the projectile's owner
          spark(p.x, p.y, p.color, 16, true); shake(7);
          p.life = 0;
        }
      }
      if (p.x < -40 || p.x > W + 40) p.life = 0;
    }
    projectiles = projectiles.filter(p => p.life > 0);
  }

  function drawProjectiles() {
    for (const p of projectiles) {
      ctx.save();
      if (p.kind === "spear") {
        // Thrown spear — wood shaft, gold collar, steel leaf head (matches the render).
        ctx.translate(p.x, p.y); ctx.scale(p.facing, 1);
        ctx.fillStyle = "#6b4a2b"; ctx.fillRect(-34, -3, 54, 6);   // wooden shaft
        ctx.fillStyle = "#54381f"; ctx.fillRect(-34, 1, 54, 2);    // underside shadow
        ctx.fillStyle = "#8a623a"; ctx.fillRect(-34, -3, 54, 1.5); // top highlight
        ctx.fillStyle = "#c8962a"; ctx.fillRect(17, -4, 6, 8);     // gold collar
        ctx.fillStyle = "#a87a1e"; ctx.fillRect(17, 1, 6, 3);
        ctx.beginPath(); ctx.moveTo(23, -7); ctx.lineTo(43, 0); ctx.lineTo(23, 7); ctx.closePath();
        ctx.fillStyle = "#cdd2da"; ctx.fill();                      // steel head
        ctx.lineWidth = 1.5; ctx.strokeStyle = "#3a3f47"; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(23, -7); ctx.lineTo(43, 0); ctx.lineTo(25, 0); ctx.closePath();
        ctx.fillStyle = "#eef1f5"; ctx.fill();                      // bevel highlight
        ctx.fillStyle = "#9aa0ad"; ctx.fillRect(-37, -2, 4, 4);     // butt spike
        ctx.restore(); continue;
      }
      if (p.kind === "coin" && TROLL_COIN_IMG.complete && TROLL_COIN_IMG.naturalWidth) {
        // Gold disc with the trollface minted on it.
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fillStyle = "#ffd84d"; ctx.fill();
        ctx.save();
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.86, 0, 7); ctx.clip();
        ctx.drawImage(TROLL_COIN_IMG, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
        ctx.restore();
        ctx.lineWidth = Math.max(1, p.r * 0.16); ctx.strokeStyle = "#b6831a";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.stroke();
      } else {
        const grd = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.r);
        grd.addColorStop(0, "#fff"); grd.addColorStop(0.4, p.color); grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fillStyle = grd; ctx.fill();
        if (p.text) {
          ctx.fillStyle = "#0a0a0a"; ctx.font = `900 ${p.kind === "coin" ? 16 : 18}px DM Mono, monospace`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(p.text, p.x, p.y + 1);
        }
      }
      ctx.restore();
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * dt; p.life -= dt;
      p.vx *= 0.98;
    }
    particles = particles.filter(p => p.life > 0);
  }
  function drawParticles() {
    for (const p of particles) {
      const al = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = al;
      if (p.coin) {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7);
        const g = ctx.createRadialGradient(p.x - 2, p.y - 2, 1, p.x, p.y, p.r);
        g.addColorStop(0, "#ffe88a"); g.addColorStop(1, "#b6831a");
        ctx.fillStyle = g; ctx.fill();
        if (TROLL_COIN_IMG.complete && TROLL_COIN_IMG.naturalWidth) {
          ctx.save();
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.9, 0, 7); ctx.clip();
          ctx.drawImage(TROLL_COIN_IMG, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
          ctx.restore();
        }
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fillStyle = p.color; ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ==========================================================================
     STAGES  —  image arenas from the zone art with a parallax camera (follows
     the fighters' midpoint + slow time drift), a readability scrim, and a
     stage-accent floor glow. Falls back to the procedural dusk arena until the
     chosen background finishes loading.
     ========================================================================== */
  const STAGE_DIR = "assets/games/troll-kombat/stages/";
  const STAGES = [
    { id: "hills",  name: "Troll Hills",     img: "zone-1.png", accent: "#4dff73", hazard: "Rolling troll boulder", pickup: "Green Candle Smoothie",   groundFrac: 0.88, desc: "Peaceful hills watched over by ancient memes." },
    { id: "market", name: "Floating Market", img: "zone-2.png", accent: "#7fd0ff", hazard: "Airship wind blast",    pickup: "Stamina Rocket",          groundFrac: 0.82, desc: "Sky bazaar of airships and floating islands." },
    { id: "lake",   name: "Lakeside Town",   img: "zone-3.png", accent: "#34c759", hazard: "Rogue wave",            pickup: "Tidal Liquidity",         groundFrac: 0.86, desc: "Sunlit harbor town on the meme lake." },
    { id: "palace", name: "Meme Palace",     img: "zone-4.png", accent: "#c79bff", hazard: "Fountain burst",        pickup: "Royal Liquidity Potion",  groundFrac: 0.86, desc: "Moonlit palace of the meme dynasty." },
    { id: "ruins",  name: "Sunset Ruins",    img: "zone-5.png", accent: "#ff9f43", hazard: "Crumbling pillar",      pickup: "Relic Bag",               groundFrac: 0.87, desc: "Golden-hour ruins of a forgotten chain." },
    { id: "cyber",  name: "Cyber Rain City", img: "zone-6.png", accent: "#27e0ff", hazard: "Lightning zap lane",    pickup: "Blue Glow Shield",        groundFrac: 0.84, desc: "Neon downpour over a sleepless metropolis." },
  ];
  const stageById = id => STAGES.find(s => s.id === id);
  function loadStageImage(s) {
    if (!s || s.image || s._loading) return;
    s._loading = true;
    const img = new Image();
    img.onload = () => { s.image = img; };
    img.src = STAGE_DIR + s.img;
  }
  loadStageImage(STAGES[0]);
  currentStage = STAGES[0];

  function hexA(h, a) { const c = hx(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

  let bgT = 0;
  function drawStage(dt) {
    bgT += dt;
    const s = currentStage;
    if (!s || !s.image) { drawProceduralStage(dt); return; }
    const img = s.image;
    let mid = W / 2;
    if (match.fighters.length === 2) mid = (match.fighters[0].x + match.fighters[1].x) / 2;
    const camX = (mid - W / 2) * 0.10 + Math.sin(bgT * 0.12) * 14;   // follow + slow drift
    const camY = Math.sin(bgT * 0.08) * 6;
    const scale = Math.max(W / img.width, H / img.height) * 1.06;
    const dw = img.width * scale, dh = img.height * scale;
    const groundPx = img.height * s.groundFrac * scale;             // align art ground to FLOOR_Y
    const ox = (W - dw) / 2 - camX;
    const oy = FLOOR_Y - groundPx + camY * 0.5;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, ox, oy, dw, dh);
    // readability scrim toward the floor so fighters pop against busy art
    const scrim = ctx.createLinearGradient(0, H * 0.42, 0, H);
    scrim.addColorStop(0, "rgba(4,2,8,0)"); scrim.addColorStop(1, "rgba(4,2,8,0.55)");
    ctx.fillStyle = scrim; ctx.fillRect(0, 0, W, H);
    // stage-accent floor glow
    const glow = ctx.createRadialGradient(W / 2, FLOOR_Y, 10, W / 2, FLOOR_Y, 460);
    glow.addColorStop(0, hexA(s.accent, 0.20)); glow.addColorStop(1, hexA(s.accent, 0));
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    // playable ground band + footing line
    const fg = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
    fg.addColorStop(0, "rgba(8,4,14,0.55)"); fg.addColorStop(1, "rgba(4,2,8,0.85)");
    ctx.fillStyle = fg; ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    ctx.strokeStyle = hexA(s.accent, 0.6); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, FLOOR_Y); ctx.lineTo(W, FLOOR_Y); ctx.stroke();
    ctx.strokeStyle = hexA(s.accent, 0.10); ctx.lineWidth = 1;
    for (let i = 0; i < 18; i++) {
      const t = i / 18, yy = FLOOR_Y + t * t * (H - FLOOR_Y);
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
    }
  }

  function drawProceduralStage(dt) {
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#1a0b2e"); sky.addColorStop(0.5, "#3a1247"); sky.addColorStop(1, "#0a0510");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // green vanishing glow
    const glow = ctx.createRadialGradient(W / 2, FLOOR_Y, 10, W / 2, FLOOR_Y, 420);
    glow.addColorStop(0, "rgba(77,255,115,0.22)"); glow.addColorStop(1, "rgba(77,255,115,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    // moon / token
    ctx.beginPath(); ctx.arc(W * 0.8, 110, 52, 0, 7);
    const m = ctx.createRadialGradient(W * 0.8 - 14, 96, 5, W * 0.8, 110, 52);
    m.addColorStop(0, "#ffe88a"); m.addColorStop(1, "#caa23a");
    ctx.fillStyle = m; ctx.fill();
    ctx.fillStyle = "#6b4a07"; ctx.font = "900 30px DM Mono, monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("$", W * 0.8, 112);
    // distant chart skyline (parallax)
    ctx.fillStyle = "rgba(20,8,32,0.85)";
    const baseY = FLOOR_Y - 60;
    let y = baseY;
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 40) {
      y = baseY - 60 - 50 * Math.sin(x * 0.02 + bgT * 0.1) - (x / W) * 40;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    // candle sticks row
    for (let i = 0; i < 16; i++) {
      const x = 30 + i * 60;
      const up = Math.sin(i * 1.7 + bgT * 0.4) > 0;
      const h = 30 + Math.abs(Math.sin(i * 2.3 + bgT * 0.5)) * 60;
      ctx.fillStyle = up ? "rgba(77,255,115,0.5)" : "rgba(255,49,79,0.5)";
      ctx.fillRect(x, FLOOR_Y - 64 - h, 14, h);
      ctx.fillRect(x + 5, FLOOR_Y - 64 - h - 14, 4, 14);
    }
    // floor
    const fg = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
    fg.addColorStop(0, "#241038"); fg.addColorStop(1, "#0a0510");
    ctx.fillStyle = fg; ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    ctx.strokeStyle = "rgba(77,255,115,0.55)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, FLOOR_Y); ctx.lineTo(W, FLOOR_Y); ctx.stroke();
    // floor grid
    ctx.strokeStyle = "rgba(154,92,255,0.18)"; ctx.lineWidth = 1;
    for (let i = 0; i < 22; i++) {
      const t = i / 22, yy = FLOOR_Y + t * t * (H - FLOOR_Y);
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
    }
  }

  /* ==========================================================================
     AI  —  three-tier difficulty FSM.
     0 = Easy   slow, predictable, rarely blocks, forgets to use special
     1 = Medium  balanced, blocks sometimes, mixes attacks, uses specials
     2 = Hard   fast, combos, smart spacing, blocks nearly everything
     ========================================================================== */

  // Per-difficulty profile table. All behaviour is derived from these numbers
  // so adding a 4th difficulty or tuning values is a one-line change.
  const AI_PROFILES = [
    // 0 · Easy ---------------------------------------------------------------
    {
      react: 0.55,        // seconds between decisions (slow = feels drunk)
      reactSpread: 0.7,   // + rand(0..spread) added to react window
      blockChance: 0.15,  // chance to block when opponent is attacking
      kickRatio: 0.18,    // fraction of attacks that are kicks (rest = punch)
      specialChance: 0.08,// chance to use special when meter is full
      retreatBlock: 0.05, // chance to hold block while retreating
      comboDelay: 0.55,   // seconds before re-attacking after a hit lands
      jumpChance: 0.04,   // chance per decision to jump (often ill-timed)
      approachDist: 200,  // switches from approach to attack at this dist
      retreatDist: 50,    // retreats if closer than this (gets overcrowded)
      smartRetreat: false,// retreats to build meter for special
    },
    // 1 · Medium -------------------------------------------------------------
    {
      react: 0.26,
      reactSpread: 0.4,
      blockChance: 0.55,
      kickRatio: 0.45,
      specialChance: 0.38,
      retreatBlock: 0.35,
      comboDelay: 0.28,
      jumpChance: 0.10,
      approachDist: 170,
      retreatDist: 60,
      smartRetreat: false,
    },
    // 2 · Hard ---------------------------------------------------------------
    {
      react: 0.08,
      reactSpread: 0.14,
      blockChance: 0.88,
      kickRatio: 0.50,
      specialChance: 0.62,
      retreatBlock: 0.72,
      comboDelay: 0.12,
      jumpChance: 0.08,
      approachDist: 155,
      retreatDist: 65,
      smartRetreat: true, // retreats to charge meter when low, then punishes
    },
  ];

  class AI {
    constructor(diff) {
      this.p = AI_PROFILES[Math.min(diff, AI_PROFILES.length - 1)];
      this.t = 0;
      this.decideIn = 0;
      this.plan = "approach";
      this.justHit = false;    // true for one frame after we landed an attack
      this.comboTimer = 0;     // cooldown after landing a hit
    }

    think(self, opp, dt) {
      const intent = { left: false, right: false, up: false, crouch: false, block: false, punch: false, kick: false, special: false, dash: false };
      if (self.state === "ko" || self.state === "win" || !self.canAct()) return intent;

      const p = this.p;
      this.t += dt;
      this.decideIn -= dt;
      this.comboTimer = Math.max(0, this.comboTimer - dt);

      const dist = Math.abs(opp.x - self.x);
      const dir = opp.x < self.x ? -1 : 1;   // +1 = opp is to our right

      // --- Reactive blocking: check BEFORE plan logic so it overrides --------
      const oppAttacking = opp.state === "attack" && opp.attack &&
        opp.attack.t < (opp.attack.def.startup + opp.attack.def.active);
      const projNear = projectiles.some(q =>
        q.owner === opp && Math.abs(q.x - self.x) < 180 && Math.sign(q.vx) === -dir);

      if ((oppAttacking && dist < 160) || projNear) {
        if (Math.random() < p.blockChance) {
          intent.block = true;
          // Hard: also step back while blocking for safety
          if (p.smartRetreat && Math.random() < 0.5) {
            dir > 0 ? intent.left = true : intent.right = true;
          }
          return intent;
        }
      }

      // --- Decide new plan when timer expires --------------------------------
      if (this.decideIn <= 0) {
        this.decideIn = p.react + Math.random() * p.reactSpread;
        const r = Math.random();

        // Smart retreat: low on HP + meter ready → retreat until ready then punish
        if (p.smartRetreat && self.hp < 40 && self.meter >= self.def.special.cost) {
          this.plan = dist > 200 ? "special" : "retreat";
        }
        // Special: meter full and opponent in good range
        else if (self.meter >= self.def.special.cost && dist > 140 && dist < 380 && r < p.specialChance) {
          this.plan = "special";
        }
        // Far: approach or occasionally jump-in
        else if (dist > p.approachDist) {
          this.plan = r < p.jumpChance ? "jump" : "approach";
        }
        // Mid range: attack or approach
        else if (dist > p.retreatDist) {
          this.plan = r < 0.65 ? "attack" : "approach";
        }
        // Too close: retreat a little or keep attacking
        else {
          this.plan = r < 0.45 ? "retreat" : "attack";
        }
      }

      // --- Execute plan ------------------------------------------------------
      switch (this.plan) {
        case "approach":
          dir > 0 ? intent.right = true : intent.left = true;
          break;

        case "retreat":
          dir > 0 ? intent.left = true : intent.right = true;
          intent.block = Math.random() < p.retreatBlock;
          break;

        case "jump":
          intent.up = true;
          dir > 0 ? intent.right = true : intent.left = true;
          this.plan = "approach";
          break;

        case "special":
          if (dist < 300) {
            intent.special = true;
            this.plan = "approach";
            this.decideIn = 0.5;
          } else {
            // Close the gap first
            dir > 0 ? intent.right = true : intent.left = true;
          }
          break;

        case "attack":
          if (dist < p.approachDist + 20) {
            // Attack mix based on difficulty: harder = more kicks
            if (Math.random() < p.kickRatio) intent.kick = true;
            else intent.punch = true;
            // After landing a hit, Hard combos quickly; Easy waits a long time
            this.plan = "approach";
            this.decideIn = p.comboDelay + Math.random() * 0.2;
          } else {
            // Close the gap
            dir > 0 ? intent.right = true : intent.left = true;
          }
          break;
      }

      return intent;
    }
  }

  /* ==========================================================================
     MATCH STATE
     ========================================================================== */
  const els = {
    p1name: document.getElementById("p1-name"), p2name: document.getElementById("p2-name"),
    p1label: document.getElementById("p1-label"), p2label: document.getElementById("p2-label"),
    p1icon: document.getElementById("p1-icon"), p2icon: document.getElementById("p2-icon"),
    p1panel: document.getElementById("hud-p1"), p2panel: document.getElementById("hud-p2"),
    p1hp: document.getElementById("p1-health"), p2hp: document.getElementById("p2-health"),
    p1chip: document.getElementById("p1-health-chip"), p2chip: document.getElementById("p2-health-chip"),
    p1pips: document.getElementById("p1-pips"), p2pips: document.getElementById("p2-pips"),
    p1meter: document.getElementById("p1-meter"), p2meter: document.getElementById("p2-meter"),
    p1stam: document.getElementById("p1-stamina"), p2stam: document.getElementById("p2-stamina"),
    timer: document.getElementById("round-timer"), roundLabel: document.getElementById("round-label"),
    stageName: document.getElementById("stage-name"),
    announce: document.getElementById("tk-announce"),
  };

  const match = {
    phase: "select",         // select countdown intro fight roundend matchend
    round: 1,
    timer: ROUND_TIME,
    phaseT: 0,
    fighters: [],
    controllers: [],         // per-fighter: {type:"human", slot} | {type:"ai"}
    mode: "cpu",             // "cpu" | "mp"
    diff: 1,
    finisher: false,
    randomStage: false,      // mirror of setup.randomStage for this match
    mapShiftT: 0,            // countdown (sec) to the next mid-fight map shift
    mapShiftWarned: false,   // has the "MAP SHIFTING…" warning fired this cycle?
    // The opponent of a given fighter (2-player today; nearest-other later).
    other(f) { return this.fighters[0] === f ? this.fighters[1] : this.fighters[0]; },
    // defs[] = fighter definitions, controllers[] = input owner per slot.
    // Kept array-driven (not p1/p2 hardcoded) so 3+ players slot in later.
    init(defs, controllers, diff) {
      pause.reset();
      if (pauseEls.btn) pauseEls.btn.hidden = false;   // pause is available in-match
      this.diff = diff;
      this.controllers = controllers;
      this.mode = controllers.some(c => c.type === "ai") ? "cpu" : "mp";
      // Online: each device only has ONE local human (the other fighter's
      // input arrives over the network), so both host and guest use the solo
      // WASD+arrows layout on slot 0 — never the split local-versus keymaps.
      const humans = online.active ? 1 : controllers.filter(c => c.type === "human").length;
      setupInputs(humans);
      this.fighters = defs.map((def, i) => {
        const c = controllers[i];
        const f = new Fighter(def, i === 0 ? SPAWN_L : SPAWN_R, i === 0 ? 1 : -1, c.type === "ai");
        f.rounds = 0;
        f.inputSlot = c.type === "human" ? c.slot : -1;     // -1 = AI-controlled
        f.ai = c.type === "ai" ? new AI(diff) : null;
        return f;
      });
      this.round = 1;
      this.firstRound = true;   // round 1 gets the 3·2·1 countdown
      setHudFighter(0, defs[0], controllers[0]);
      setHudFighter(1, defs[1], controllers[1]);
      this.startRound();
    },
    startRound() {
      const [a, b] = this.fighters;
      a.reset(SPAWN_L, 1); b.reset(SPAWN_R, -1);   // HP resets each round; meter carries over
      this.timer = ROUND_TIME;
      this.suddenDeath = false;
      this.finisher = false;
      if (window.FinisherSequencer) window.FinisherSequencer.cancel("round-reset");
      projectiles = []; particles = [];
      // Random map switching: re-roll the stage between rounds when enabled
      // (silent — the round intro covers it; no mid-fight warning needed here).
      if (!this.firstRound && this.randomStage) this.shiftStage(false);
      els.roundLabel.textContent = `Round ${this.round}`;
      if (this.firstRound) {
        this.phase = "countdown"; this.phaseT = 0; this._cd = 4;
      } else {
        this.phase = "intro"; this.phaseT = 0;
        announce(`ROUND ${this.round}`, 1.0);
      }
    },
    beginFight() {
      this.phase = "fight"; this.phaseT = 0;
      announce("FIGHT!", 0.7, true);
      audio.bell();
      if (this.randomStage) this.scheduleMapShift();   // arm the mid-fight timer
    },
    // Pick the next mid-fight shift time (sec) and re-arm the warning.
    scheduleMapShift() {
      this.mapShiftT = MAP_SHIFT_MIN + Math.random() * (MAP_SHIFT_MAX - MAP_SHIFT_MIN);
      this.mapShiftWarned = false;
    },
    // Swap to a different arena. Floor/walls are stage-independent constants, so
    // positions, collisions, health and match state are untouched — we only swap
    // the backdrop and clamp fighters back inside the (unchanged) arena bounds.
    shiftStage(announceIt) {
      const pool = STAGES.filter(s => s !== currentStage);
      if (!pool.length) return;
      currentStage = pool[Math.floor(Math.random() * pool.length)];
      loadStageImage(currentStage);
      if (els.stageName) els.stageName.textContent = currentStage.name;
      for (const f of this.fighters) f.x = clamp(f.x, WALL_L, WALL_R);  // safe re-anchor
      if (announceIt) {
        announce(currentStage.name.toUpperCase(), 1.0, true);
        shake(8);
        audio.blip(330, 0.18, "sawtooth", 0.1);
      }
    },
    endRound(winnerIdx, byKO) {
      if (this.phase === "roundend" || this.phase === "matchend") return;
      this.fighters[winnerIdx].rounds++;
      if (byKO) this.fighters[winnerIdx].kos++;   // count KO finishes for the leaderboard
      const winner = this.fighters[winnerIdx];
      const loser = this.fighters[1 - winnerIdx];
      const matchWon = winner.rounds >= ROUNDS_TO_WIN;
      this.phase = "roundend"; this.phaseT = 0;
      this.matchWon = matchWon; this.winnerIdx = winnerIdx; this.byKO = byKO;
      if (byKO) { announce("K.O.", 1.4, true); shake(12); }
      else announce("TIME", 1.2, true);
      winner.win();
    },
    // Equal HP at time-out: instead of a coin flip deciding the round (and
    // possibly the match), drop both fighters to 1 HP and keep the clock
    // running — next hit landed wins the round outright. If nobody connects
    // before the sudden-death clock runs out, it just re-arms and continues.
    startSuddenDeath() {
      if (!this.suddenDeath) { announce("SUDDEN DEATH", 1.3, true); shake(8); }
      this.suddenDeath = true;
      this.timer = SUDDEN_DEATH_TIME;
      for (const f of this.fighters) f.hp = 1;
    },
    update(dt) {
      const [p1, p2] = this.fighters;
      this.phaseT += dt;

      // Animated 3 · 2 · 1 · FIGHT! before the match begins. Fighters stand
      // ready (spawned on the chosen stage) until control is handed over.
      if (this.phase === "countdown") {
        for (const f of this.fighters) f.update(dt, NEUTRAL, this.other(f), "intro");
        const n = 3 - Math.floor(this.phaseT / 0.75);   // 3,2,1, then 0
        if (n < this._cd && n > 0) { this._cd = n; announce(String(n), 0.7, true); audio.blip(440, 0.14, "square", 0.12); }
        if (this.phaseT >= 2.25) { this.firstRound = false; this.beginFight(); }
        return;
      }

      if (this.phase === "intro") {
        // hold fighters; advance to fight
        p1.update(dt, NEUTRAL, p2, "intro");
        p2.update(dt, NEUTRAL, p1, "intro");
        if (this.phaseT > 1.1) this.beginFight();
        return;
      }

      if (this.phase === "fight") {
        this.timer = Math.max(0, this.timer - dt);
        // Mid-fight random map switching (Phase 6). Only runs in the "fight"
        // phase, so it never fires during countdown/intro/round-end/match-end
        // (and there is no pause to collide with). We also leave the final
        // seconds alone so a swap never overlaps an incoming TIME/KO.
        if (this.randomStage) {
          this.mapShiftT -= dt;
          const canShift = this.timer > 3.5;
          if (canShift && !this.mapShiftWarned && this.mapShiftT <= MAP_SHIFT_WARN) {
            this.mapShiftWarned = true;
            announce("MAP SHIFTING…", MAP_SHIFT_WARN, true);
          }
          if (this.mapShiftT <= 0) {
            if (canShift) this.shiftStage(true);
            this.scheduleMapShift();   // re-arm regardless, so the cycle continues
          }
        }
        // Each fighter pulls intent from its own controller (human slot or AI),
        // so input/state ownership stays cleanly per-player.
        const fs = this.fighters;
        const intents = fs.map((f, i) => f.ai ? f.ai.think(f, this.other(f), dt)
          : this.controllers[i].remote ? online.remoteIntent()
          : readIntent(f.inputSlot));
        fs.forEach((f, i) => f.update(dt, intents[i], this.other(f), "fight"));
        // separation: stop overlap
        separate(p1, p2);
        // win checks
        if (p1.hp <= 0 && p1.state === "ko") this.endRound(1, true);
        else if (p2.hp <= 0 && p2.state === "ko") this.endRound(0, true);
        else if (this.timer <= 0) {
          if (p1.hp === p2.hp) this.startSuddenDeath();
          else this.endRound(p1.hp > p2.hp ? 0 : 1, false);
        }
        return;
      }

      if (this.phase === "roundend") {
        const win = this.fighters[this.winnerIdx], lose = this.fighters[1 - this.winnerIdx];
        win.update(dt, NEUTRAL, lose, "roundend");
        lose.update(dt, NEUTRAL, win, "roundend");
        // match-ending KO -> finisher flourish. Bespoke per-character cinematic
        // (Phase 11) is attempted first, behind ENABLE_BESPOKE_FINISHERS; when
        // the flag is off or the asset isn't ready, canStart() returns false
        // and this falls back to the original generic FINISH! banner.
        if (this.matchWon && this.byKO && !this.finisher && this.phaseT > 1.1) {
          this.finisher = true;
          const seq = window.FinisherSequencer;
          const roundCtx = { winner: win, loser: lose };
          if (seq && seq.canStart(roundCtx)) seq.start(roundCtx);
          else announce("FINISH!", 1.2, true);
        }
        if (this.matchWon && this.byKO && this.finisher && this.phaseT > 1.7 && !this.finBurst) {
          this.finBurst = true;
          coinBurst(lose.x, lose.feetY);
          for (let i = 0; i < 3; i++) setTimeout(() => audio.coin(), i * 90);
          shake(14);
        }
        const wait = this.matchWon && this.byKO ? 3.0 : 1.8;
        if (this.phaseT > wait) {
          this.finBurst = false;
          if (this.matchWon) this.endMatch();
          else { this.round++; this.startRound(); }
        }
        return;
      }
    },
    endMatch() {
      this.phase = "matchend";
      // Feed the local player's result to the shared arcade leaderboard.
      // Slot 0 is "you" on this device; no-op if the engine isn't loaded.
      const you = this.fighters[0];
      if (you && window.TrollLeaderboard) {
        window.TrollLeaderboard.record("troll-kombat", {
          char: you.def.id,
          won: this.winnerIdx === 0,
          kos: you.kos,
          damage: Math.round(you.dmgDealt),
          mode: this.mode,
        });
      }
      void window.TrollrunnerAccounts?.awardXp?.("versus_match", "troll-kombat");
      // Real per-account stats + XP (game_run/high_score/game_first_daily) --
      // separate from the mock weekly leaderboard above. No-ops for guests.
      if (you) {
        void window.TrollrunnerAccounts?.reportGameResult?.("troll-kombat", Math.round(you.dmgDealt), {
          char: you.def.id, won: this.winnerIdx === 0, kos: you.kos, mode: this.mode,
        });
      }
      showResult(this.winnerIdx, this.byKO, this.fighters, this.mode);
    },
    draw(dt) {
      const [p1, p2] = this.fighters;
      // draw by x for simple depth (further fighter behind)
      if (p1.x <= p2.x) { p1.draw(); p2.draw(); } else { p2.draw(); p1.draw(); }
    },
  };
  const NEUTRAL = { left: false, right: false, up: false, crouch: false, block: false, punch: false, kick: false, special: false };

  // Soft, passable separation: a gentle nudge when nearly overlapping so you can
  // still push through an opponent (no more getting cornered against a wall).
  function separate(a, b) {
    const minGap = 46;
    const dx = b.x - a.x;
    if (Math.abs(dx) < minGap && a.grounded && b.grounded) {
      const overlap = (minGap - Math.abs(dx)) / 2 * 0.28;
      const s = dx >= 0 ? 1 : -1;
      a.x -= s * overlap; b.x += s * overlap;
      a.x = clamp(a.x, WALL_L, WALL_R); b.x = clamp(b.x, WALL_L, WALL_R);
    }
  }

  // Tracked so the online host can tell a guest "this exact announcement fired"
  // without re-triggering on every unrelated snapshot (see online.hostBroadcast).
  const lastAnnounce = { text: "", seq: 0 };
  function announce(text, dur, big) {
    els.announce.textContent = text;
    els.announce.className = "tk-announce is-show" + (big ? " is-big" : "");
    clearTimeout(announce._t);
    announce._t = setTimeout(() => { els.announce.className = "tk-announce"; }, dur * 1000);
    lastAnnounce.text = text; lastAnnounce.seq++;
  }

  /* ==========================================================================
     HUD
     ========================================================================== */
  // Paint a fighter's HUD slot at match start: bar colour follows the fighter
  // (Pepe green / Doge gold / Troll silver), icon = its glossy splash render,
  // top label = PLAYER n (or CPU for an AI slot), sub label = the fighter name.
  function setHudFighter(i, def, ctrl) {
    const panel = i === 0 ? els.p1panel : els.p2panel;
    const icon = i === 0 ? els.p1icon : els.p2icon;
    const label = i === 0 ? els.p1label : els.p2label;
    const nameEl = i === 0 ? els.p1name : els.p2name;
    if (panel) panel.style.setProperty("--bar", def.bar || def.pal.accent);
    if (icon) { icon.src = SHEET_DIR + (def.splashSrc || def.portraitSrc); icon.alt = def.name; }
    if (label) label.textContent = ctrl && ctrl.type === "ai" ? "CPU" : "PLAYER " + (i + 1);
    if (nameEl) nameEl.textContent = def.name;
  }

  function updateHUD() {
    const [p1, p2] = match.fighters;
    if (!p1) return;
    els.p1hp.style.width = (p1.hp / MAX_HP * 100) + "%";
    els.p2hp.style.width = (p2.hp / MAX_HP * 100) + "%";
    els.p1chip.style.width = (p1.hp / MAX_HP * 100) + "%";
    els.p2chip.style.width = (p2.hp / MAX_HP * 100) + "%";
    els.p1meter.style.width = (p1.meter / MAX_METER * 100) + "%";
    els.p2meter.style.width = (p2.meter / MAX_METER * 100) + "%";
    if (els.p1stam) {
      els.p1stam.style.width = (p1.stamina / MAX_STAM * 100) + "%";
      els.p2stam.style.width = (p2.stamina / MAX_STAM * 100) + "%";
      els.p1stam.parentElement.classList.toggle("is-rekt", p1.rektStun > 0);
      els.p2stam.parentElement.classList.toggle("is-rekt", p2.rektStun > 0);
    }
    els.timer.textContent = Math.ceil(match.timer);
    renderPips(els.p1pips, p1.rounds);
    renderPips(els.p2pips, p2.rounds);
  }
  function renderPips(el, n) {
    if (el._n === n) return; el._n = n;
    el.innerHTML = "";
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      const d = document.createElement("span");
      d.className = "pip" + (i < n ? " is-won" : "");
      el.appendChild(d);
    }
  }

  /* ==========================================================================
     INPUT  —  one {held, edge} context PER PLAYER SLOT so each fighter owns its
     own keys cleanly. `keymaps[slot]` maps a key → action for that slot; it's
     rebuilt at match start from the human count (1 = solo CPU, 2 = local versus).
     Adding a 3rd slot later is just another keymap entry — no engine rewrite.
     ========================================================================== */
  const inputs = [{ held: {}, edge: {} }, { held: {}, edge: {} }, { held: {}, edge: {} }, { held: {}, edge: {} }];
  const ATK = a => a === "punch" || a === "kick" || a === "special" || a === "dash";

  // P1 cluster. In solo (CPU) play the arrows also drive P1 for comfort; in local
  // versus the arrows belong to P2, so we use the WASD-only variant.
  const P1_KEYS = {
    a: "left", A: "left", d: "right", D: "right", w: "up", W: "up", s: "crouch", S: "crouch",
    j: "punch", J: "punch", k: "kick", K: "kick", l: "special", L: "special", " ": "block", Shift: "dash",
  };
  const P1_KEYS_SOLO = {
    ...P1_KEYS, ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "crouch",
  };
  // P2 cluster: arrows to move + the number cluster for attacks.
  const P2_KEYS = {
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "crouch",
    "1": "punch", "2": "kick", "3": "special", "0": "block", "5": "dash",
  };
  let keymaps = [];   // active key→action maps, one per human slot

  function setupInputs(humanCount) {
    inputs.forEach(s => { s.held = {}; s.edge = {}; });
    keymaps = humanCount >= 2 ? [P1_KEYS, P2_KEYS] : [P1_KEYS_SOLO];
  }
  function readIntent(slot) {
    const s = inputs[slot] || inputs[0];
    const i = {
      left: !!s.held.left, right: !!s.held.right, up: !!s.held.up, crouch: !!s.held.crouch,
      block: !!s.held.block,
      punch: !!s.edge.punch, kick: !!s.edge.kick, special: !!s.edge.special, dash: !!s.edge.dash,
    };
    s.edge.punch = s.edge.kick = s.edge.special = s.edge.dash = false;
    return i;
  }
  window.addEventListener("keydown", e => {
    const tag = e.target && e.target.tagName;
    if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
    if (window.TrollrunnerSiteLock?.getComputedRecord?.()?.mode === "locked") return;
    if (pause.active) return;   // frozen: ignore fight input (keyup still clears held keys)
    for (let slot = 0; slot < keymaps.length; slot++) {
      const a = keymaps[slot][e.key]; if (!a) continue;
      e.preventDefault(); audio.ensure();
      const s = inputs[slot];
      if (ATK(a)) { if (!s.held[a]) s.edge[a] = true; }
      s.held[a] = true;
      return;   // a key belongs to exactly one slot
    }
  });
  window.addEventListener("keyup", e => {
    for (let slot = 0; slot < keymaps.length; slot++) {
      const a = keymaps[slot][e.key];
      if (a) { inputs[slot].held[a] = false; return; }
    }
  });
  // touch buttons drive slot 0 (P1) — mobile is single-player / CPU.
  document.querySelectorAll(".tbtn").forEach(btn => {
    const key = btn.dataset.key;
    const map = { left: "left", right: "right", up: "up", crouch: "crouch", block: "block" };
    const s = inputs[0];
    const down = e => {
      e.preventDefault(); audio.ensure();
      if (pause.active) return;   // frozen: swallow touch input too
      if (key === "punch" || key === "kick" || key === "special") { s.edge[key] = true; s.held[key] = true; }
      else s.held[map[key]] = true;
      btn.classList.add("is-down");
    };
    const up = e => {
      e.preventDefault();
      if (map[key]) s.held[map[key]] = false; else s.held[key] = false;
      btn.classList.remove("is-down");
    };
    btn.addEventListener("touchstart", down, { passive: false });
    btn.addEventListener("touchend", up, { passive: false });
    btn.addEventListener("touchcancel", up, { passive: false });
    btn.addEventListener("mousedown", down);
    window.addEventListener("mouseup", up);
  });

  /* ==========================================================================
     PAUSE  (Phase 7)
     Solo / CPU: a pause key freezes the match instantly. Local versus: one
     player REQUESTS, the others must agree — gameplay keeps running until the
     vote passes, then the match freezes for everyone. The approval bar is a
     majority of the human players, which is naturally unanimous at 2 players
     and a true majority at 3+. Requests expire on a timer and each requester
     gets a short cooldown so pause can't be spammed. The original requester
     (or a resume majority at 3+) lifts the pause.

     On one shared keyboard, the only unambiguous way to attribute a vote to a
     specific player is "press YOUR own key", so each slot owns a pause key and
     the same key requests / approves / resumes depending on the current state.
     ========================================================================== */
  const PAUSE_REQ_TIMEOUT = 8;   // sec a pending request lives before expiring
  const PAUSE_COOLDOWN    = 5;   // sec before the same player can ask again
  // Pause key per slot (mirrors the fight keymaps). Slots 2/3 are wired for the
  // future 3–4 player roster; only 0/1 are reachable today.
  const PAUSE_KEYS = [
    { Escape: 1, p: 1, P: 1 },   // P1 / solo
    { Enter: 1 },                // P2
    { "/": 1, "?": 1 },          // P3 (future)
    { End: 1 },                  // P4 (future)
  ];

  const pauseEls = {
    btn:       document.getElementById("tk-pause"),
    req:       document.getElementById("tk-pause-req"),
    reqWho:    document.getElementById("pb-requester"),
    reqNeed:   document.getElementById("pb-need"),
    reqVotes:  document.getElementById("pb-votes"),
    reqHint:   document.getElementById("pb-hint"),
    reqTimer:  document.getElementById("pb-timer-fill"),
    reqCancel: document.getElementById("pb-cancel"),
    overlay:   document.getElementById("tk-paused"),
    by:        document.getElementById("pause-by"),
    resumeHint:document.getElementById("pause-resume-hint"),
    resumeBtn: document.getElementById("pause-resume"),
    quitBtn:   document.getElementById("pause-quit"),
  };
  // Friendly key label per slot, for on-screen prompts.
  const PAUSE_KEY_LABEL = ["Esc / P", "Enter", "/", "End"];
  const playerLabel = slot => "Player " + (slot + 1);

  const pause = {
    active: false,        // approved pause — the sim is frozen
    pending: false,       // versus request awaiting votes
    requester: -1,        // slot that asked
    approvals: new Set(), // slots that approved (the requester counts as one)
    resumes: new Set(),   // slots voting to resume (3+ player override)
    needed: 0,            // approvals required for this request
    reqT: 0,              // pending request countdown (sec)
    cooldownUntil: {},    // slot -> performance.now() ms it can ask again

    // Human-controlled slots for the current match (AI slots can't vote).
    humans() { return match.controllers.filter(c => c.type === "human").map(c => c.slot); },
    isMP() { return match.mode === "mp"; },
    // Pause is only meaningful during a live round (not menus / result screen).
    canControl() { return match.phase !== "select" && match.phase !== "matchend"; },

    // A pause key (or the on-screen button) was triggered by `slot`.
    press(slot) {
      if (!this.canControl()) return;
      if (this.active)  return this.tryResume(slot);
      if (this.pending) return this.approve(slot);
      this.request(slot);
    },

    request(slot) {
      const now = performance.now();
      if ((this.cooldownUntil[slot] || 0) > now) {   // spam guard
        announce("PAUSE ON COOLDOWN", 0.9);
        audio.blip(180, 0.1, "square", 0.08, 120);
        return;
      }
      const n = this.humans().length;
      this.requester = slot;
      this.approvals = new Set([slot]);              // asking == approving
      this.resumes = new Set();
      this.needed = Math.floor(n / 2) + 1;           // majority (unanimous at 2P)
      // Solo / CPU, or a one-player majority — pause immediately.
      if (!this.isMP() || this.approvals.size >= this.needed) { this.activate(); return; }
      this.pending = true;
      this.reqT = PAUSE_REQ_TIMEOUT;
      announce("PAUSE?", 0.6);
      audio.blip(440, 0.1, "square", 0.1, 660);
      this.renderReq();
    },

    approve(slot) {
      if (!this.pending || this.approvals.has(slot)) return;
      this.approvals.add(slot);
      audio.blip(620, 0.08, "square", 0.1, 880);
      if (this.approvals.size >= this.needed) { this.activate(); return; }
      this.renderReq();
    },

    activate() {
      this.pending = false;
      this.active = true;
      this.reqT = 0;
      // Drop any buffered fight input so nothing fires on resume.
      inputs.forEach(s => { s.held = {}; s.edge = {}; });
      this.hideReq();
      this.renderPaused();
      document.body.dataset.paused = "1";
      audio.bell();
    },

    tryResume(slot) {
      // CPU/solo, or the original requester, can always resume.
      if (!this.isMP() || slot === this.requester) return this.resume();
      // 3+ players: a resume majority can override a stalling requester.
      this.resumes.add(slot);
      if (this.resumes.size >= this.needed) return this.resume();
      this.renderPaused();
    },

    // Unconditional lift used by the on-screen Resume button (single shared screen).
    resume() {
      const who = this.requester;
      this.active = false;
      this.pending = false;
      this.approvals.clear();
      this.resumes.clear();
      if (who >= 0) this.cooldownUntil[who] = performance.now() + PAUSE_COOLDOWN * 1000;
      this.requester = -1;
      document.body.dataset.paused = "";
      this.hidePaused();
      if (this.canControl()) { announce("RESUME", 0.5); audio.bell(); }
    },

    // A pending request expired or was cancelled.
    cancel(reason) {
      if (!this.pending) return;
      const who = this.requester;
      this.pending = false;
      if (who >= 0) this.cooldownUntil[who] = performance.now() + PAUSE_COOLDOWN * 1000;
      this.requester = -1;
      this.approvals.clear();
      this.hideReq();
      if (reason) announce(reason, 1.0);
      audio.blip(200, 0.12, "sawtooth", 0.1, 90);
    },

    // Wipe all pause state (match (re)start or returning to a menu).
    reset() {
      this.active = this.pending = false;
      this.requester = -1; this.needed = 0; this.reqT = 0;
      this.approvals.clear(); this.resumes.clear();
      this.hideReq(); this.hidePaused();
      document.body.dataset.paused = "";
    },

    // Real-time tick (runs even while the sim is frozen) — only the request timer.
    tick(dt) {
      if (!this.pending) return;
      this.reqT -= dt;
      if (this.reqT <= 0) { this.cancel("PAUSE DENIED"); return; }
      if (pauseEls.reqTimer) pauseEls.reqTimer.style.width = Math.max(0, this.reqT / PAUSE_REQ_TIMEOUT * 100) + "%";
    },

    /* ---- UI ------------------------------------------------------------- */
    renderReq() {
      if (!pauseEls.req) return;
      pauseEls.reqWho.textContent = `${playerLabel(this.requester)} wants to pause`;
      const have = this.approvals.size;
      pauseEls.reqNeed.textContent = `${have} / ${this.needed} approved`;
      // one chip per human: requester = gold, approved = green, waiting = grey
      pauseEls.reqVotes.innerHTML = "";
      this.humans().forEach(slot => {
        const li = document.createElement("li");
        li.textContent = playerLabel(slot) + (slot === this.requester ? " ✦" : this.approvals.has(slot) ? " ✓" : " …");
        li.className = slot === this.requester ? "is-req" : this.approvals.has(slot) ? "is-yes" : "";
        pauseEls.reqVotes.appendChild(li);
      });
      const waiting = this.humans().filter(s => !this.approvals.has(s));
      pauseEls.reqHint.textContent = waiting.length
        ? "To approve: " + waiting.map(s => `${playerLabel(s)} press ${PAUSE_KEY_LABEL[s]}`).join(" · ")
        : "Approved!";
      pauseEls.reqTimer.style.width = "100%";
      pauseEls.req.hidden = false;
    },
    hideReq() { if (pauseEls.req) pauseEls.req.hidden = true; },

    renderPaused() {
      if (!pauseEls.overlay) return;
      pauseEls.by.textContent = this.requester >= 0 ? `Paused by ${playerLabel(this.requester)}` : "Match paused";
      if (this.isMP()) {
        const lbl = this.requester >= 0 ? PAUSE_KEY_LABEL[this.requester] : "their key";
        pauseEls.resumeHint.innerHTML = this.humans().length > 2
          ? `${playerLabel(this.requester)} resumes (<kbd>${lbl}</kbd>), or a majority can vote to resume`
          : `${playerLabel(this.requester)} resumes — press <kbd>${lbl}</kbd>`;
      } else {
        pauseEls.resumeHint.innerHTML = `Press <kbd>Esc</kbd> / <kbd>P</kbd> to resume`;
      }
      pauseEls.overlay.hidden = false;
      if (pauseEls.resumeBtn) pauseEls.resumeBtn.focus();
    },
    hidePaused() { if (pauseEls.overlay) pauseEls.overlay.hidden = true; },
  };

  // Pause key listener — separate from the fight input so it works mid-freeze.
  window.addEventListener("keydown", e => {
    const tag = e.target && e.target.tagName;
    if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
    if (window.TrollrunnerSiteLock?.getComputedRecord?.()?.mode === "locked") return;
    if (!pause.canControl()) return;
    // Online: each device has only one local player, so any of the pause keys
    // means "my own pause action" — the host's `pause` object is authoritative
    // either way, this just routes the press to it (locally or over the wire).
    if (online.active) {
      if (e.key === "Escape" || e.key === "p" || e.key === "P" || e.key === "Enter") {
        e.preventDefault();
        if (online.isHost) pause.press(0); else online.send("pauseReq", {});
      }
      return;
    }
    const live = new Set(pause.humans());
    for (let slot = 0; slot < PAUSE_KEYS.length; slot++) {
      if (!PAUSE_KEYS[slot][e.key]) continue;
      if (!live.has(slot)) continue;          // only real players for this match
      e.preventDefault();
      pause.press(slot);
      return;                                 // a key belongs to exactly one slot
    }
  });

  // On-screen / touch pause button acts as P1 (slot 0 — the local/solo player).
  if (pauseEls.btn) pauseEls.btn.addEventListener("click", e => {
    e.currentTarget.blur();
    if (online.active) { if (online.isHost) pause.press(0); else online.send("pauseReq", {}); return; }
    pause.press(0);
  });
  if (pauseEls.reqCancel) pauseEls.reqCancel.addEventListener("click", () => {
    if (online.active) { if (online.isHost) pause.cancel("PAUSE CANCELLED"); else online.send("pauseCancel", {}); return; }
    pause.cancel("PAUSE CANCELLED");
  });
  if (pauseEls.resumeBtn) pauseEls.resumeBtn.addEventListener("click", e => {
    e.currentTarget.blur();
    if (online.active) { if (online.isHost) pause.press(0); else online.send("pauseReq", {}); return; }
    pause.resume();
  });
  if (pauseEls.quitBtn) pauseEls.quitBtn.addEventListener("click", () => {
    pause.reset();
    match.phase = "select";
    match.fighters = [];
    if (online.active) { online.net && online.net.leave(false); online.active = false; }
    flow.go("matchtype");
  });

  /* ==========================================================================
     PRE-MATCH FLOW  +  portraits  +  page roster cards
     Screen order: matchtype → (playercount) → fighter → stage → countdown.
     `setup` holds the choices; `flow` swaps the overlays.
     ========================================================================== */
  const diffSel = document.getElementById("cpu-difficulty");

  function portrait(def, size) {
    const c = document.createElement("canvas");
    c.width = size; c.height = size; c.className = "portrait";
    const pctx = c.getContext("2d");
    const real = ctx; ctx = pctx;        // borrow the head drawers
    ctx.save();
    ctx.translate(size / 2, size * 0.56); ctx.scale(size / 70, size / 70);
    def.drawHead(20, def.pal, {});
    ctx.restore();
    ctx = real;
    return c;
  }
  // Sheet fighters: draw the idle frame to a canvas, repaint when art loads,
  // procedural head as the pre-load fallback so the card never shows empty.
  function makeSheetPortrait(def, size) {
    const c = document.createElement("canvas");
    c.width = size; c.height = size; c.className = "portrait";
    const p = c.getContext("2d");
    const paint = () => {
      p.clearRect(0, 0, size, size);
      const v = def.sheetImg && def.sheetImg.pixel;
      if (v && v.ready) {
        const f = v.frames.idle;
        const s = Math.min(size / f.w, size / f.h) * 0.94;
        const dw = f.w * s, dh = f.h * s;
        p.imageSmoothingEnabled = false;
        p.drawImage(v.canvas, f.sx, f.sy, f.w, f.h, (size - dw) / 2, size - dh - 2, dw, dh);
      } else if (def.drawHead) {
        const real = ctx; ctx = p;
        p.save(); p.translate(size / 2, size * 0.56); p.scale(size / 70, size / 70);
        def.drawHead(20, def.pal, {}); p.restore();
        ctx = real;
      }
    };
    paint();
    registerPortrait(def, paint);
    return c;
  }

  // Big pixel-bust portrait (PixelLab, same rig as the in-fight sprite) used on
  // the pre-match SELECT screens only. Falls back to the pixel portrait if a
  // fighter has no splash yet.
  function splashEl(def, cls) {
    if (!def.splashSrc) return portraitEl(def, cls === "is-thumb" ? 72 : 130);
    const im = document.createElement("img");
    im.src = SHEET_DIR + def.splashSrc;
    im.alt = def.name;
    im.className = "fighter-splash" + (cls ? " " + cls : "");
    return im;
  }

  // Thumbnail: sheet art / sprite / procedural head, whichever the fighter has.
  function portraitEl(def, size) {
    if (def.sheet) return makeSheetPortrait(def, size);
    const src = def.portraitSrc || def.spriteSrc;
    if (src) {
      const im = document.createElement("img");
      im.src = SPRITE_DIR + src;
      im.alt = def.name; im.className = "portrait";
      return im;
    }
    return portrait(def, size);
  }

  // (3D "Toy Mode" removed — the game is locked to 2D pixel art.)
  document.body.dataset.mode = MODE;

  /* --- setup state: every choice the pre-match flow collects ---------------- */
  const setup = {
    mode: "cpu",            // "cpu" | "mp"
    playerCount: 1,         // number of HUMAN players (cpu=1, mp=2…)
    picks: [],              // fighter id per human slot
    current: 0,             // slot currently choosing (-1 = all done)
    stage: STAGES[0],
    randomStage: false,
    diff: 1,
  };
  const humanCount = () => setup.mode === "mp" ? setup.playerCount : 1;
  const SLOT_LABEL = ["P1", "P2", "P3", "P4"];

  /* --- flow controller: shows exactly one screen overlay at a time ---------- */
  const flow = {
    screens: {
      matchtype: document.getElementById("tk-matchtype"),
      difficulty: document.getElementById("tk-difficulty"),
      mpmode: document.getElementById("tk-mpmode"),
      lobby: document.getElementById("tk-lobby"),
      playercount: document.getElementById("tk-playercount"),
      fighter: document.getElementById("tk-fighter"),
      stage: document.getElementById("tk-stage"),
    },
    current: "matchtype",
    go(name) {
      pause.reset();
      if (pauseEls.btn) pauseEls.btn.hidden = true;   // no pausing on the menus
      Object.values(this.screens).forEach(el => el && el.classList.remove("is-visible"));
      if (this.screens[name]) this.screens[name].classList.add("is-visible");
      this.current = name;
      document.body.dataset.gameState = "select";
      match.phase = "select";
    },
    hideAll() { Object.values(this.screens).forEach(el => el && el.classList.remove("is-visible")); },
  };
  const blip = (f, to) => { audio.ensure(); audio.blip(f, 0.08, "square", 0.08, to); };

  /* --- 1 & 2 · MATCH TYPE + PLAYER COUNT (flat retro pixel-screen chrome) ---
     Real DOM/CSS cards dispatch on data-act. CPU difficulty defaults to Normal
     (this screen has no selector) — `diffSel` is read when present. */
  document.querySelectorAll(".flow-overlay .hot, .flow-overlay .mt-card, .flow-overlay .pc-card[data-act], .flow-overlay .retro-back, .flow-overlay .retro-confirm, #tk-difficulty .diff-btn, #tk-difficulty .diff-back, #tk-mpmode .diff-btn, #tk-mpmode .diff-back").forEach(el => {
    el.addEventListener("click", () => {
      const act = el.dataset.act;
      blip(660, 880);
      switch (act) {
        case "mt-cpu":
          setup.mode = "cpu"; setup.playerCount = 1;
          flow.go("difficulty"); break;
        case "mt-mp":
          flow.go("mpmode"); break;
        case "mpm-local":
          setup.mode = "mp"; setup.playerCount = 2; flow.go("playercount"); break;
        case "mpm-online":
          online.enterLobby(); break;
        case "diff-easy": case "diff-med": case "diff-hard":
          setup.diff = parseInt(el.dataset.diff, 10);
          enterFighterSelect(); break;
        case "pc-2":
        case "pc-confirm":
          setup.playerCount = 2; enterFighterSelect(); break;
        case "back-matchtype":
          flow.go("matchtype"); break;
      }
    });
  });

  /* --- 3 · FIGHTER SELECT (synced locking in multiplayer) ------------------- */
  // roster = transparent hotspots over the baked mockup thumbnails (Pepe·Doge·Troll).
  // Each cell carries its own thumbnail image + name (flat retro chrome — no
  // baked art to rely on) plus hover/selected/locked rings.
  const fselGrid = document.getElementById("fsel-grid");
  ROSTER.forEach(def => {
    const cell = document.createElement("button");
    cell.type = "button"; cell.className = "fsel-cell"; cell.dataset.id = def.id;
    cell.setAttribute("role", "option");
    cell.setAttribute("aria-label", def.name);
    const thumb = document.createElement("img");
    thumb.className = "fsel-cell-img"; thumb.alt = "";
    thumb.src = SHEET_DIR + (def.splashSrc || def.portraitSrc);
    const label = document.createElement("span");
    label.className = "fsel-cell-name"; label.textContent = def.name.split(" ")[0];
    cell.append(thumb, label);
    cell.addEventListener("click", () => { online.active ? pickFighterOnline(def.id) : pickFighter(def.id); });
    fselGrid.appendChild(cell);
  });

  function enterFighterSelect() {
    setup.picks = [];
    setup.current = 0;
    document.getElementById("fsel-p2").hidden = humanCount() < 2;
    if (!online.active) {
      document.getElementById("fsel-back").hidden = false;
    }
    renderFighterSelect();
    flow.go("fighter");
  }
  // advance `current` to the next human slot without a pick (-1 when all chosen).
  function advanceCurrent() {
    setup.current = -1;
    for (let i = 0; i < humanCount(); i++) {
      if (!setup.picks[i]) { setup.current = i; break; }
    }
  }
  function pickFighter(id) {
    if (setup.picks.includes(id)) { blip(180, 120); return; }   // locked by another player
    // once every slot is filled, re-picking swaps the last slot instead of
    // requiring Reset — lets a player change their mind without wiping others.
    const slot = setup.current >= 0 ? setup.current : humanCount() - 1;
    setup.picks[slot] = id;
    advanceCurrent();
    blip(720, 940);
    renderFighterSelect();
  }
  // Online: each device picks only its OWN slot (host=0, guest=1) — no shared
  // "current" turn order, since the two players are on separate screens.
  function pickFighterOnline(id) {
    const slot = online.mySlot;
    if (setup.picks[slot] === id) return;
    if (setup.picks[1 - slot] === id) { blip(180, 120); return; }   // opponent already has it
    setup.picks[slot] = id;
    online.send("pick", { slot, id });
    blip(720, 940);
    renderFighterSelect();
  }
  function renderFighterSelect() {
    const mp = humanCount() >= 2;
    document.getElementById("fsel-kicker").textContent = mp ? `Multiplayer · ${humanCount()} players` : "Select your fighter";
    // grid: lock taken fighters, badge them with the owning player
    document.querySelectorAll(".fsel-cell").forEach(cell => {
      const owner = setup.picks.indexOf(cell.dataset.id);
      const taken = owner >= 0;
      cell.classList.toggle("is-locked", taken);
      cell.classList.toggle("taken-1", owner === 0);
      cell.classList.toggle("taken-2", owner === 1);
      if (taken) cell.dataset.by = SLOT_LABEL[owner]; else cell.removeAttribute("data-by");
    });
    // per-player panels
    setPanel(0, "fsel-p1");
    if (mp) setPanel(1, "fsel-p2");
    // hint + continue gate
    const hint = document.getElementById("fsel-hint");
    const contBtn = document.getElementById("fsel-continue");
    if (online.active) {
      const mine = setup.picks[online.mySlot], theirs = setup.picks[1 - online.mySlot];
      if (!mine) hint.textContent = "Pick your fighter";
      else if (!theirs) hint.textContent = "Waiting for opponent…";
      else hint.textContent = online.isHost ? "Ready — choose your stage." : "Ready — waiting for host…";
      contBtn.disabled = !(mine && theirs) || !online.isHost;
      contBtn.textContent = online.isHost ? "Choose Stage →" : "Waiting for host…";
    } else {
      const allPicked = setup.current < 0;
      hint.textContent = allPicked ? "Ready — choose your stage." : `${SLOT_LABEL[setup.current]}, pick your fighter`;
      contBtn.disabled = !allPicked;
      contBtn.textContent = "Choose Stage →";
    }
  }
  function setPanel(slot, panelId) {
    const panel = document.getElementById(panelId);
    const id = setup.picks[slot];
    const def = id ? byId(id) : null;
    panel.classList.toggle("is-current", setup.current === slot);
    panel.classList.toggle("is-picked", !!def);
    // panel border/glow is SLOT-coloured (P1 green / P2 gold) per the mockup —
    // handled entirely in CSS via .is-p1 / .is-p2, no per-fighter override here.
    const art = panel.querySelector(".fsel-portrait");
    art.innerHTML = "";
    if (def) art.appendChild(splashEl(def));
    const nameEl = panel.querySelector("strong");
    // big name = first word (PEPE / DOGE / GLADIATOR), matches the mockup
    if (nameEl) nameEl.textContent = def ? def.name.split(" ")[0] : "—";
    const tagEl = panel.querySelector(".fsel-tag");
    if (tagEl) tagEl.textContent = def ? (def.title || def.tag || "") : "";
    const statusEl = panel.querySelector(".fsel-status");
    if (statusEl) statusEl.textContent =
      def ? "✓  Selected" : (setup.current === slot ? "Selecting…" : "Waiting…");
  }
  // Clicking your own already-picked panel re-opens that slot for reselection
  // (useful in multiplayer to swap an earlier player's pick without Reset).
  [["fsel-p1", 0], ["fsel-p2", 1]].forEach(([panelId, slot]) => {
    document.getElementById(panelId).addEventListener("click", () => {
      if (online.active || !setup.picks[slot]) return;
      setup.current = slot;
      renderFighterSelect();
      blip(300, 200);
    });
  });
  document.getElementById("fsel-back").addEventListener("click", () =>
    flow.go(setup.mode === "mp" ? "playercount" : "matchtype"));
  document.getElementById("fsel-continue").addEventListener("click", () => {
    if (online.active) {
      if (!online.isHost) return;   // guest's button is disabled; belt & suspenders
      online.send("advance", { screen: "stage" });
    }
    enterStageSelect();
  });

  /* --- 4 · STAGE SELECT (mockup art + live hero preview overlay) ------------ */
  const stageHeroLive = document.getElementById("stage-hero-live");
  const stageNameLive = document.getElementById("stage-name-live");
  const stageDescLive = document.getElementById("stage-desc-live");
  function showStageHero(s) {
    stageHeroLive.src = STAGE_DIR + s.img;
    stageHeroLive.alt = s.name;
    stageNameLive.textContent = s.name;
    stageDescLive.textContent = s.desc || "";
    stageNameLive.style.color = s.accent;
  }
  function markSelectedThumb(s) {
    document.querySelectorAll("#tk-stage .stage-thumb").forEach(t =>
      t.classList.toggle("is-sel", STAGES[+t.dataset.stage] === s));
  }
  document.querySelectorAll("#tk-stage .stage-thumb").forEach(thumb => {
    const s = STAGES[+thumb.dataset.stage];
    if (!s) return;
    thumb.addEventListener("mouseenter", () => { if (online.isGuest) return; loadStageImage(s); showStageHero(s); });
    thumb.addEventListener("mouseleave", () => { if (online.isGuest) return; showStageHero(setup.stage); });
    thumb.addEventListener("click", () => {
      if (online.isGuest) return;   // spectate-only; CSS also blocks pointer events
      setup.stage = s; loadStageImage(s); showStageHero(s); markSelectedThumb(s); blip(680, 880);
      if (online.isHost) online.send("stage", { id: s.id, random: setup.randomStage });
    });
  });
  // random-map toggle (two pills over the baked OFF/ON)
  function setRandom(on) {
    setup.randomStage = on;
    document.querySelectorAll("#tk-stage .rand-opt").forEach(o =>
      o.classList.toggle("is-active", (o.dataset.rand === "on") === on));
  }
  document.querySelectorAll("#tk-stage .rand-opt").forEach(o =>
    o.addEventListener("click", () => {
      if (online.isGuest) return;
      setRandom(o.dataset.rand === "on"); blip(520, 640);
      if (online.isHost) online.send("stage", { id: setup.stage.id, random: setup.randomStage });
    }));
  function enterStageSelect() {
    showStageHero(setup.stage);
    markSelectedThumb(setup.stage);
    flow.go("stage");
  }
  document.querySelector("#tk-stage [data-act='stage-back']").addEventListener("click", () => {
    if (online.isGuest) return;
    if (online.isHost) online.send("advance", { screen: "fighter" });
    enterFighterSelect();
  });
  document.querySelector("#tk-stage [data-act='stage-fight']").addEventListener("click", async e => {
    e.currentTarget.blur();
    if (online.isGuest) return;
    if (online.isHost) { online.hostStartFight(); return; }   // wagers are local-only; no wager flow online
    // Optional wager (isolated module): validate manual-review terms before the match
    // starts; abort the launch if the terms are incomplete.
    // No wallet, payment, or settlement logic lives in the fight engine.
    if (window.KombatWager && KombatWager.isEnabled()) {
      const ok = await KombatWager.beforeFight();
      if (!ok) return;
    }
    startMatch();
  });

  /* --- launch: build fighter defs + controllers, then start the match ------- */
  function buildDefs() {
    if (setup.mode === "cpu") {
      const p1 = byId(setup.picks[0]);
      const pool = ROSTER.filter(r => r.id !== p1.id);
      const cpu = pool[Math.floor(Math.random() * pool.length)];
      return [p1, cpu];
    }
    return setup.picks.slice(0, setup.playerCount).map(byId);
  }
  function buildControllers() {
    if (setup.mode === "cpu") return [{ type: "human", slot: 0 }, { type: "ai" }];
    // Online: fighter 1 is driven by network input, not a local key slot. Both
    // screens build this identically from the host's "fight" message so HUD
    // labels/corners match on both devices.
    if (online.active) return [{ type: "human", slot: 0 }, { type: "human", slot: 1, remote: true }];
    return setup.picks.slice(0, setup.playerCount).map((_, i) => ({ type: "human", slot: i }));
  }
  function startMatch() {
    audio.ensure(); audio.on = true;
    soundBtn.classList.add("is-on"); soundBtn.setAttribute("aria-pressed", "true");
    if (setup.randomStage) setup.stage = STAGES[Math.floor(Math.random() * STAGES.length)];
    currentStage = setup.stage;
    loadStageImage(currentStage);
    if (els.stageName) els.stageName.textContent = currentStage.name;
    flow.hideAll();
    document.body.dataset.gameState = "fight";
    match.randomStage = setup.randomStage;
    match.init(buildDefs(), buildControllers(), setup.diff);
    // The pre-fight flow (match type -> difficulty -> fighter -> stage) is
    // tall enough that players scroll down to reach "Fight" — bring the
    // cabinet back into view so the HUD isn't left above the fold.
    canvas.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ==========================================================================
     RESULT OVERLAY
     ========================================================================== */
  const resultOverlay = document.getElementById("tk-result");
  function showResult(winnerIdx, byKO, fighters, mode) {
    pause.reset();
    if (pauseEls.btn) pauseEls.btn.hidden = true;   // match's over — no pause on the result screen
    const winner = fighters[winnerIdx];
    const isMP = mode === "mp";
    // In CPU mode, "you" are P1. In versus, frame it by player number.
    const youWon = winnerIdx === 0;
    document.getElementById("result-kicker").textContent =
      isMP ? `Player ${winnerIdx + 1} wins` : (youWon ? "You win" : "You lose");
    document.getElementById("result-message").textContent = winner.def.name + " WINS";
    const finishBadge = document.getElementById("finish-badge");
    if (byKO && winner.rounds >= ROUNDS_TO_WIN) {
      finishBadge.textContent = winner.tookDamage ? "FATALITY" : "FLAWLESS";
      finishBadge.style.display = "";
    } else finishBadge.style.display = "none";
    document.getElementById("result-detail").textContent =
      isMP ? `Player ${winnerIdx + 1}'s ${winner.def.name} stands. "${winner.def.tag}"`
      : youWon ? `${winner.def.name} stands. "${winner.def.tag}"`
      : `Rugged by the CPU's ${winner.def.name}. Run it back?`;
    resultOverlay.classList.toggle("is-loss", !isMP && !youWon);
    resultOverlay.classList.add("is-visible");
    const rematchBtn = document.getElementById("tk-rematch"), changeBtn = document.getElementById("tk-change");
    if (online.isGuest) {
      rematchBtn.hidden = true; changeBtn.hidden = true;
      document.getElementById("result-detail").textContent += " Waiting for the host to choose what's next…";
    } else {
      rematchBtn.hidden = false; changeBtn.hidden = false;
      rematchBtn.focus();
    }
    // Wager payout hook (isolated): lets a wagered winner submit for manual
    // approval. No money logic here — wager.js owns it.
    if (window.KombatWager && window.KombatWager.onResult) {
      window.KombatWager.onResult({
        mode, winnerIdx, byKO, diff: match.diff,
        p1char: fighters[0].def.id, p2char: fighters[1].def.id,
        p1rounds: fighters[0].rounds, p2rounds: fighters[1].rounds,
        p1kos: fighters[0].kos, p2kos: fighters[1].kos,
        p1damage: Math.round(fighters[0].dmgDealt),
        p2damage: Math.round(fighters[1].dmgDealt),
        stage: currentStage && currentStage.name,
      });
    }
  }
  document.getElementById("tk-rematch").addEventListener("click", e => {
    if (online.isGuest) return;   // guest's button is hidden; host drives rematches
    resultOverlay.classList.remove("is-visible");
    e.currentTarget.blur();
    if (online.isHost) {
      online.send("fight", { p1: setup.picks[0], p2: setup.picks[1], stage: currentStage.id, random: setup.randomStage, diff: match.diff });
    }
    // Re-run the same matchup with the same controllers (same defs + slots).
    match.init(match.fighters.map(f => f.def), match.controllers, match.diff);
  });
  document.getElementById("tk-change").addEventListener("click", () => {
    if (online.isGuest) return;   // guest's button is hidden; host drives this
    resultOverlay.classList.remove("is-visible");
    if (online.isHost) online.send("advance", { screen: "fighter" });
    // Jump straight to fighter select — same mode/difficulty/player count,
    // just re-pick who's fighting. Use "fsel-back" to fall back to matchtype
    // for a full setup change instead.
    enterFighterSelect();
  });

  // sound toggle
  const soundBtn = document.getElementById("tk-sound");
  soundBtn.addEventListener("click", () => {
    audio.ensure();
    audio.on = !audio.on;
    soundBtn.classList.toggle("is-on", audio.on);
    soundBtn.setAttribute("aria-pressed", String(audio.on));
    if (audio.on) audio.bell();
  });

  /* ==========================================================================
     ONLINE MULTIPLAYER  —  invite-code lobby + host-authoritative netplay.
     The host runs the one true simulation (see match.update's intent line and
     the loop() branch below); the guest never calls match.update() at all —
     it applies the host's snapshots and interpolated pose animation instead.
     Session/transport lives in net.js (window.KombatNet). Design doc:
     docs/TROLL-KOMBAT-ONLINE.md
     ========================================================================== */
  const lobbyEls = {
    hostBtn: document.getElementById("lobby-host"),
    joinBtn: document.getElementById("lobby-join"),
    input: document.getElementById("lobby-input"),
    codeBox: document.getElementById("lobby-code"),
    codeVal: document.getElementById("lobby-code-value"),
    copyBtn: document.getElementById("lobby-copy"),
    status: document.getElementById("lobby-status"),
    back: document.getElementById("lobby-back"),
  };
  const netlostEls = {
    overlay: document.getElementById("tk-netlost"),
    detail: document.getElementById("netlost-detail"),
    quit: document.getElementById("netlost-quit"),
  };
  const stageEl = document.getElementById("tk-stage");
  const stageMockup = stageEl && stageEl.querySelector(".mockup-screen");
  const stageSpectateHint = document.createElement("div");
  stageSpectateHint.className = "stage-spectate-hint";
  stageSpectateHint.textContent = "Host is choosing the stage…";
  stageSpectateHint.hidden = true;
  if (stageMockup) stageMockup.appendChild(stageSpectateHint);

  const online = {
    net: window.KombatNet,
    active: false,         // paired & running an online session (lobby through match)
    isHost: false,
    mySlot: 0,              // 0 = host, 1 = guest — fixed for the whole session
    heldIntent: { left: false, right: false, up: false, crouch: false, block: false },
    remoteTap: { punch: false, kick: false, special: false, dash: false },
    _pendingTap: { punch: false, kick: false, special: false, dash: false },
    _lastSentHeld: "",
    _sendAcc: 0,
    _snapAcc: 0,
    _lastSnap: null,
    _resultShown: false,

    get isGuest() { return this.active && !this.isHost; },

    setStatus(text, cls) {
      if (!lobbyEls.status) return;
      lobbyEls.status.textContent = text || "";
      lobbyEls.status.className = "lobby-status" + (cls ? " is-" + cls : "");
    },

    enterLobby() {
      this.active = false; this.isHost = false;
      if (lobbyEls.codeBox) lobbyEls.codeBox.hidden = true;
      if (lobbyEls.input) lobbyEls.input.value = "";
      this.setStatus("");
      flow.go("lobby");
    },

    async hostMatch() {
      if (!this.net) { this.setStatus("Online play isn't available right now.", "error"); return; }
      this.setStatus("Opening a room…");
      const code = this.net.makeCode();
      const kind = await this.net.host(code);
      if (!kind) { this.setStatus("Couldn't reach the network. Try again.", "error"); return; }
      if (lobbyEls.codeBox) lobbyEls.codeBox.hidden = false;
      if (lobbyEls.codeVal) lobbyEls.codeVal.textContent = code;
      this.setStatus("Waiting for a challenger…", "live");
    },

    async joinMatch() {
      if (!this.net) { this.setStatus("Online play isn't available right now.", "error"); return; }
      const code = ((lobbyEls.input && lobbyEls.input.value) || "").trim().toUpperCase();
      if (code.length < 4) { this.setStatus("Enter the invite code first.", "error"); return; }
      this.setStatus("Joining…");
      const result = await this.net.join(code);
      if (result === "ok") { this.setStatus("Connected!", "live"); return; }   // onPaired() takes it from here
      if (result === "full") this.setStatus("That room already has two players.", "error");
      else if (result === "timeout") this.setStatus("No one's hosting that code.", "error");
      else this.setStatus("Couldn't reach the network. Try again.", "error");
    },

    leaveLobby() {
      if (this.net) this.net.leave(false);
      this.active = false;
      flow.go("mpmode");
    },

    /* --------------------------------------------------------- handshake */
    onPaired() {
      this.active = true;
      this.isHost = this.net.role === "host";
      this.mySlot = this.isHost ? 0 : 1;
      setup.mode = "mp"; setup.playerCount = 2;
      setup.picks = []; setup.current = 0;
      this._sendAcc = 0; this._snapAcc = 0; this._lastSnap = null; this._resultShown = false;
      document.getElementById("fsel-p2").hidden = false;
      document.getElementById("fsel-back").hidden = true;
      renderFighterSelect();
      flow.go("fighter");
    },

    onPeerLeft(why) {
      if (!this.active) return;
      const midMatch = document.body.dataset.gameState === "fight";
      if (netlostEls.detail) {
        netlostEls.detail.textContent = why === "timeout"
          ? "Your opponent's connection dropped."
          : "Your opponent left the match.";
      }
      if (netlostEls.overlay) netlostEls.overlay.hidden = false;
      if (midMatch) { pauseEls.btn && (pauseEls.btn.hidden = true); pause.reset(); }
      this.active = false;
    },

    onMessage(t, m) {
      switch (t) {
        case "pick":
          setup.picks[m.slot] = m.id;
          renderFighterSelect();
          blip(720, 940);
          return;
        case "advance":
          if (m.screen === "stage") {
            enterStageSelect();
            if (this.isGuest) { stageEl.classList.add("is-spectate"); stageSpectateHint.hidden = false; }
          } else if (m.screen === "fighter") {
            setup.picks = []; setup.current = 0; enterFighterSelect();
          }
          return;
        case "stage": {
          const s = stageById(m.id);
          if (!s) return;
          setup.stage = s; loadStageImage(s); showStageHero(s); markSelectedThumb(s);
          setRandom(!!m.random);
          return;
        }
        case "fight":
          if (this.isGuest) this._startGuestMatch(m);
          return;
        case "input":
          if (this.isHost) this._applyRemoteInput(m);
          return;
        case "snap":
          if (this.isGuest) this._applySnapshot(m);
          return;
        case "pauseReq":
          if (this.isHost) pause.press(1);
          return;
        case "pauseCancel":
          if (this.isHost) pause.cancel("PAUSE CANCELLED");
          return;
      }
    },

    /* -------------------------------------------------------- match start */
    // Host calls this to launch (or relaunch) a match on both screens.
    hostStartFight() {
      const p1 = byId(setup.picks[0]), p2 = byId(setup.picks[1]);
      this.send("fight", { p1: p1.id, p2: p2.id, stage: setup.stage.id, random: setup.randomStage, diff: setup.diff });
      startMatch();
    },
    _startGuestMatch(m) {
      stageEl.classList.remove("is-spectate"); stageSpectateHint.hidden = true;
      setup.picks = [m.p1, m.p2];
      setup.stage = stageById(m.stage) || STAGES[0];
      setup.randomStage = !!m.random;
      setup.diff = m.diff;
      audio.ensure(); audio.on = true;
      soundBtn.classList.add("is-on"); soundBtn.setAttribute("aria-pressed", "true");
      currentStage = setup.stage;
      loadStageImage(currentStage);
      if (els.stageName) els.stageName.textContent = currentStage.name;
      flow.hideAll();
      document.body.dataset.gameState = "fight";
      match.randomStage = setup.randomStage;
      match.init(buildDefs(), buildControllers(), setup.diff);
      canvas.scrollIntoView({ behavior: "smooth", block: "center" });
    },

    /* ----------------------------------------------------------- transport */
    send(t, payload) { if (this.net) this.net.send(t, payload); },

    /* --------------------------------------------------- per-frame (guest) */
    // Samples local input every frame and ships it upstream. Taps latch until
    // consumed, mirroring the local edge-trigger semantics in readIntent().
    sendInput(dt) {
      const s = inputs[0];
      this._pendingTap.punch   = this._pendingTap.punch   || s.edge.punch;
      this._pendingTap.kick    = this._pendingTap.kick    || s.edge.kick;
      this._pendingTap.special = this._pendingTap.special || s.edge.special;
      this._pendingTap.dash    = this._pendingTap.dash    || s.edge.dash;
      s.edge.punch = s.edge.kick = s.edge.special = s.edge.dash = false;
      this._sendAcc += dt;
      const heldKey = s.held.left + "," + s.held.right + "," + s.held.up + "," + s.held.crouch + "," + s.held.block;
      const dueTap = this._pendingTap.punch || this._pendingTap.kick || this._pendingTap.special || this._pendingTap.dash;
      if (this._sendAcc >= 0.05 || heldKey !== this._lastSentHeld || dueTap) {
        this._sendAcc = 0;
        this._lastSentHeld = heldKey;
        this.send("input", {
          left: !!s.held.left, right: !!s.held.right, up: !!s.held.up,
          crouch: !!s.held.crouch, block: !!s.held.block,
          punch: this._pendingTap.punch, kick: this._pendingTap.kick,
          special: this._pendingTap.special, dash: this._pendingTap.dash,
        });
        this._pendingTap = { punch: false, kick: false, special: false, dash: false };
      }
    },
    _applyRemoteInput(m) {
      this.heldIntent = { left: !!m.left, right: !!m.right, up: !!m.up, crouch: !!m.crouch, block: !!m.block };
      if (m.punch) this.remoteTap.punch = true;
      if (m.kick) this.remoteTap.kick = true;
      if (m.special) this.remoteTap.special = true;
      if (m.dash) this.remoteTap.dash = true;
    },
    // Read by match.update() for the controller flagged `remote: true`.
    remoteIntent() {
      const i = {
        left: this.heldIntent.left, right: this.heldIntent.right, up: this.heldIntent.up,
        crouch: this.heldIntent.crouch, block: this.heldIntent.block,
        punch: this.remoteTap.punch, kick: this.remoteTap.kick,
        special: this.remoteTap.special, dash: this.remoteTap.dash,
      };
      this.remoteTap = { punch: false, kick: false, special: false, dash: false };
      return i;
    },

    /* ---------------------------------------------------- per-frame (host) */
    hostBroadcast(dt) {
      this._snapAcc += dt;
      if (this._snapAcc < 0.05) return;
      this._snapAcc = 0;
      const fs = match.fighters;
      if (!fs.length) return;
      this.send("snap", {
        ph: match.phase, timer: match.timer, round: match.round,
        stage: currentStage && currentStage.id,
        winnerIdx: (match.phase === "roundend" || match.phase === "matchend") ? match.winnerIdx : -1,
        byKO: !!match.byKO,
        ann: lastAnnounce.text, annSeq: lastAnnounce.seq,
        p: fs.map(f => ({
          x: Math.round(f.x), y: Math.round(f.y), vy: Math.round(f.vy), facing: f.facing,
          state: f.state, atk: f.attack ? f.attack.type : null, atkT: f.attack ? +f.attack.t.toFixed(2) : 0,
          hp: Math.round(f.hp), meter: Math.round(f.meter), stamina: Math.round(f.stamina),
          rounds: f.rounds, dmgDealt: Math.round(f.dmgDealt), kos: f.kos, tookDamage: f.tookDamage,
        })),
        proj: projectiles.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), r: p.r, color: p.color, kind: p.kind, text: p.text, facing: p.facing })),
        pause: { active: pause.active, pending: pause.pending, requester: pause.requester, approvals: [...pause.approvals], needed: pause.needed, reqT: pause.reqT },
      });
    },

    /* --------------------------------------------------------- guest apply */
    _applySnapshot(m) {
      if (!match.fighters.length) return;
      const prevAnnSeq = this._lastSnap ? this._lastSnap.annSeq : -1;
      this._lastSnap = m;

      // stage swap (random map mid-fight)
      if (m.stage && (!currentStage || currentStage.id !== m.stage)) {
        const s = stageById(m.stage);
        if (s) { currentStage = s; loadStageImage(s); if (els.stageName) els.stageName.textContent = s.name; }
      }

      match.fighters.forEach((f, i) => {
        const d = m.p[i]; if (!d) return;
        const wasState = f.state;
        f.x = d.x; f.y = d.y; f.vy = d.vy; f.facing = d.facing;
        f.state = d.state; f.hp = d.hp; f.meter = d.meter; f.stamina = d.stamina;
        f.rounds = d.rounds; f.dmgDealt = d.dmgDealt; f.kos = d.kos; f.tookDamage = d.tookDamage;
        if (d.atk) {
          if (!f.attack || f.attack.type !== d.atk) f.attack = { type: d.atk, def: ATTACKS[d.atk], t: d.atkT, hasHit: true, fired: true };
          else f.attack.t = d.atkT;
        } else f.attack = null;
        // Light local feedback on transitions the guest didn't simulate itself.
        if (wasState !== "hit" && d.state === "hit") { f.flash = 0.16; audio.hitSpark(); }
        if (wasState !== "ko" && d.state === "ko") audio.ko();
      });

      match.phase = m.ph; match.timer = m.timer; match.round = m.round;
      match.winnerIdx = m.winnerIdx; match.byKO = m.byKO;
      projectiles = (m.proj || []).map(p => Object.assign({ life: 1, hit: true, owner: null }, p));

      if (m.annSeq !== prevAnnSeq && m.ann) announce(m.ann, 1.0, true);
      if (m.ph === "matchend" && !this._resultShown) {
        this._resultShown = true;
        // The host's match.endMatch() records ITS OWN leaderboard/XP result;
        // do the same here for the guest's account (mirrors local mp, where
        // only "you" — slot 0 on that device — gets recorded).
        const you = match.fighters[this.mySlot];
        if (you && window.TrollLeaderboard) {
          window.TrollLeaderboard.record("troll-kombat", {
            char: you.def.id, won: m.winnerIdx === this.mySlot, kos: you.kos,
            damage: Math.round(you.dmgDealt), mode: "mp",
          });
        }
        void window.TrollrunnerAccounts?.awardXp?.("versus_match", "troll-kombat");
        if (you) {
          void window.TrollrunnerAccounts?.reportGameResult?.("troll-kombat", Math.round(you.dmgDealt), {
            char: you.def.id, won: m.winnerIdx === this.mySlot, kos: you.kos, mode: "mp",
          });
        }
        showResult(m.winnerIdx, m.byKO, match.fighters, "mp");
      }
      if (m.ph !== "matchend") this._resultShown = false;

      this.applyPause(m.pause);
      updateHUD();
    },

    // Mirrors the host's authoritative pause object onto the guest's local one
    // (which never runs its own vote logic) so the existing render code works
    // unmodified on both screens.
    applyPause(p) {
      if (!p) return;
      pause.active = p.active; pause.pending = p.pending; pause.requester = p.requester;
      pause.approvals = new Set(p.approvals || []); pause.needed = p.needed || 0; pause.reqT = p.reqT || 0;
      if (pause.pending) pause.renderReq(); else pause.hideReq();
      if (pause.active) { pause.renderPaused(); document.body.dataset.paused = "1"; }
      else { pause.hidePaused(); document.body.dataset.paused = ""; }
    },

    /* ----------------------------------------------------- per-frame tick */
    // Called from the main loop every frame regardless of screen.
    tick(dt) {
      if (!this.net) return;
      this.net.tick();
      if (!this.active || document.body.dataset.gameState !== "fight") return;
      if (this.isHost) this.hostBroadcast(dt);
      else this.sendInput(dt);
    },

    /* -------------------------------------------------- guest render tick */
    // The guest never calls match.update(); this drives fighter pose lerps
    // + particles/projectile motion so the interpolated snapshot still reads
    // as a living scene between snap packets.
    guestVisualTick(dt) {
      for (const f of match.fighters) f.animate(dt, NEUTRAL);
    },
  };

  if (online.net) {
    online.net.on({
      paired: () => online.onPaired(),
      peerLeft: why => online.onPeerLeft(why),
      message: (t, m) => online.onMessage(t, m),
    });
  }

  if (lobbyEls.hostBtn) lobbyEls.hostBtn.addEventListener("click", () => { blip(660, 880); online.hostMatch(); });
  if (lobbyEls.joinBtn) lobbyEls.joinBtn.addEventListener("click", () => { blip(660, 880); online.joinMatch(); });
  if (lobbyEls.input) lobbyEls.input.addEventListener("keydown", e => { if (e.key === "Enter") online.joinMatch(); });
  if (lobbyEls.copyBtn) lobbyEls.copyBtn.addEventListener("click", () => {
    const code = lobbyEls.codeVal && lobbyEls.codeVal.textContent;
    if (code && navigator.clipboard) navigator.clipboard.writeText(code).catch(() => {});
  });
  if (lobbyEls.back) lobbyEls.back.addEventListener("click", () => online.leaveLobby());
  if (netlostEls.quit) netlostEls.quit.addEventListener("click", () => {
    if (netlostEls.overlay) netlostEls.overlay.hidden = true;
    document.body.dataset.paused = "";
    if (online.net) online.net.leave(true);
    online.active = false;
    match.phase = "select"; match.fighters = [];
    if (pauseEls.btn) pauseEls.btn.hidden = true;
    resultOverlay.classList.remove("is-visible");
    flow.go("matchtype");
  });

  /* ==========================================================================
     MAIN LOOP
     ========================================================================== */
  let lastT = performance.now();
  function loop(now) {
    let dt = (now - lastT) / 1000;
    lastT = now;
    dt = Math.min(dt, 0.05);

    online.tick(dt);

    // The pause request timer ticks in real time, even while the sim is frozen.
    // (Online guest: pause.active/pending mirror the host's state via snapshots,
    // so this no-ops harmlessly — the guest's own pending timer isn't authoritative.)
    if (!online.isGuest) pause.tick(dt);

    // An approved pause freezes the whole simulation (movement, attacks, timers,
    // map switching, CPU behaviour) — we keep rendering the last frame so the
    // arena stays on screen behind the PAUSED overlay.
    const live = match.phase !== "select";
    const frozen = live && pause.active;

    // hitstop freezes sim but not rendering
    let simDt = dt;
    if (!frozen && hitstopT > 0) { hitstopT -= dt; simDt = 0.0005; }

    if (online.isGuest) {
      // Thin client: never simulate — just lerp fighter poses toward the
      // state the last snapshot set, so movement/attacks read as animated
      // between the ~20 Hz packets from the host.
      if (live) online.guestVisualTick(dt);
    } else if (live && !frozen) {
      match.update(simDt);
      updateProjectiles(simDt, match.fighters);
      if (window.FinisherSequencer) window.FinisherSequencer.update(simDt);
    }
    if (!frozen) updateParticles(dt);

    // camera shake (held still while frozen)
    ctx.save();
    if (!frozen && shakeAmt > 0) {
      ctx.translate(rand(-shakeAmt, shakeAmt), rand(-shakeAmt, shakeAmt));
      shakeAmt = Math.max(0, shakeAmt - dt * 60);
    }
    drawStage(frozen ? 0 : dt);
    if (match.fighters.length) {
      match.draw(dt);
      drawProjectiles();
      if (window.FinisherSequencer) window.FinisherSequencer.draw(ctx);
    }
    drawParticles();
    ctx.restore();

    if (live) updateHUD();

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
