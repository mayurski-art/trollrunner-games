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
  // `ctx` is a `let` so portrait() can temporarily swap in an offscreen context
  // and reuse the same head-drawing helpers (they close over this binding).
  let ctx = canvas.getContext("2d");
  const W = canvas.width;   // 960
  const H = canvas.height;  // 540

  // --- Stage geometry ---------------------------------------------------------
  const FLOOR_Y = 486;          // y of the ground line (feet rest here)
  const WALL_L = 128;           // left fighter bound (fighter centre)
  const WALL_R = W - 128;       // right fighter bound
  const FIGHTER_SCALE = 1.18;   // rig is ~190px tall before scale

  // --- Match tuning -----------------------------------------------------------
  const ROUND_TIME = 60;        // seconds
  const ROUNDS_TO_WIN = 2;      // best of 3
  const MAX_HP = 100;
  const MAX_METER = 100;

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
      id: "troll", name: "BIG TROLL", tag: "Problem?",
      blurb: "The OG. A swole slab of pure trollface energy. His specials are just a smug grin weaponised.",
      special: { name: "PROBLEM?", kind: "projectile", cost: 100, color: "#eaf2ff", text: "?" },
      pal: { base: "#e7eef6", dark: "#9bb1c8", light: "#ffffff", ink: "#161d2b", face: "#f4f8fc", accent: "#7fd0ff", accent2: "#ff3d6e" },
      drawHead: drawTrollHead,
      spriteSrc: "troll.png", footFrac: 1.0,
    },
    {
      id: "pepe", name: "PEPE", tag: "Feels good",
      blurb: "Rare amphibian heavyweight. Hits with the weight of a thousand sad reaction images.",
      special: { name: "FEELS BLAST", kind: "projectile", cost: 100, color: "#7dff52", text: "feels" },
      pal: { base: "#5fae33", dark: "#2f6e1f", light: "#9fe05f", ink: "#10250a", face: "#5fae33", accent: "#9dff52", accent2: "#ff5dab" },
      drawHead: drawPepeHead,
      spriteSrc: "pepe.png", footFrac: 0.955,
    },
    {
      id: "doge", name: "DOGE", tag: "Much fight",
      blurb: "Such muscle. Very brawl. Pelts you with 1000x coins until you are, in fact, rugged.",
      special: { name: "1000x BONK", kind: "barrage", cost: 100, color: "#ffd84d", text: "wow" },
      pal: { base: "#e3ad4f", dark: "#a9762a", light: "#f7d98a", ink: "#3a2406", face: "#e8b85a", accent: "#ffd84d", accent2: "#6fd0ff" },
      drawHead: drawDogeHead,
      spriteSrc: "doge.png", footFrac: 1.0,
    },
  ];
  const byId = id => ROSTER.find(r => r.id === id);

  // Preload fighter sprites. A fighter with a loaded image renders as that
  // image (feet-anchored, mirrored by facing); one without falls back to the
  // procedural muscle rig. `spriteScale` maps the source top->feet span to
  // TARGET_BODY so every fighter is the same on-screen height.
  const SPRITE_DIR = "assets/games/troll-kombat/fighters/";
  const TARGET_BODY = 272;   // on-screen feet->top height, px
  ROSTER.forEach(d => {
    if (!d.spriteSrc) return;
    const img = new Image();
    img.onload = () => { d.img = img; d.spriteScale = TARGET_BODY / (img.height * (d.footFrac || 1)); };
    img.src = SPRITE_DIR + d.spriteSrc;
  });

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
      this.rounds = 0;
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
    }
    get grounded() { return this.y <= 0.01; }
    get feetY() { return FLOOR_Y - this.y; }

    canAct() {
      return this.state !== "ko" && this.state !== "win" &&
        this.hitstun <= 0 && this.blockStun <= 0 &&
        !(this.attack && this.attack.t < this.attack.def.startup + this.attack.def.active + this.attack.def.recovery);
    }

    startAttack(type) {
      if (type === "special") {
        if (this.meter < this.def.special.cost) { audio.whiff(); return; }
        this.meter = 0;
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
      this.facing = fromX < this.x ? 1 : -1;
      if (blocked) {
        this.hp = Math.max(0, this.hp - dmg * 0.18);
        this.blockStun = 0.16;
        this.vx = (this.x < fromX ? -1 : 1) * push * 0.4;
        this.meter = Math.min(MAX_METER, this.meter + dmg * 0.4);
        audio.block();
        spark(this.x + this.facing * 50, this.feetY - 150, this.pal.accent, 6, true);
        return;
      }
      this.hp = Math.max(0, this.hp - dmg);
      this.hitstun = 0.30;
      this.flash = 0.16;
      this.hurtFace = 0.6;
      this.state = "hit";
      this.attack = null;
      this.vx = (this.x < fromX ? -1 : 1) * push;
      this.meter = Math.min(MAX_METER, this.meter + dmg * 1.1);
      audio.hitSpark();
      spark(this.x + (fromX < this.x ? 44 : -44), this.feetY - 150, "#fff2a8", 12, false);
      shake(Math.min(10, dmg * 0.7));
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
      this.vx = (this.vx || 0);

      // blink
      this.blinkT -= dt;
      if (this.blinkT <= 0) { this.blink = 0.12; this.blinkT = rand(1.6, 4.5); }
      this.blink = Math.max(0, this.blink - dt);

      // face the opponent when neutral
      if (this.canAct() && phase === "fight" && this.grounded) {
        this.facing = opp.x < this.x ? -1 : 1;
      }

      if (this.state === "ko") { this.updateKO(dt); this.physics(dt); return; }
      if (this.state === "win") { this.winT += dt; this.physics(dt); this.animate(dt, intent); return; }
      if (phase !== "fight") { this.physics(dt); this.animate(dt, intent); return; }

      // resolve attack lifecycle
      if (this.attack) {
        this.attack.t += dt;
        const A = this.attack.def;
        const inActive = this.attack.t >= A.startup && this.attack.t < A.startup + A.active;
        if (this.attack.type === "special" && this.attack.t >= A.startup && !this.attack.fired) {
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
      // movement / actions only when free
      if (!acting) {
        if (intent.special) this.startAttack("special");
        else if (intent.kick) this.startAttack("kick");
        else if (intent.punch) this.startAttack("punch");
        else if (intent.up && this.grounded) { this.vy = 520; this.state = "jump"; audio.jump(); }
        else {
          const blocking = intent.block && this.grounded;
          if (blocking) { this.state = "block"; this.vx *= 0.6; }
          else if (intent.crouch && this.grounded) { this.state = "crouch"; }
          else if (this.grounded) {
            const move = (intent.right ? 1 : 0) - (intent.left ? 1 : 0);
            if (move !== 0) {
              this.x += move * 230 * dt;
              this.state = "walk";
              this.walkDir = move * this.facing; // +1 forward, -1 back
            } else { this.state = "idle"; }
          }
        }
      }
      this.physics(dt);
      this.animate(dt, intent);
    }

    physics(dt) {
      // gravity / jump
      if (!this.grounded || this.vy > 0) {
        this.vy -= 1500 * dt;
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
        opp.hurt(A.dmg, A.push, this.x, blocking);
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
      const shW = Math.max(16, 46 - this.y * 0.06) * (this.def.img ? 1.5 : 1.0);
      ctx.beginPath();
      ctx.ellipse(this.x, FLOOR_Y, shW, 9, 0, 0, 7);
      ctx.fillStyle = "rgba(0,0,0,0.32)"; ctx.fill();

      if (this.def.img && this.def.spriteScale) { this.drawSprite(); return; }
      this.drawProcedural();
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
          opp.hurt(p.dmg, 360, p.owner.x, blocking);
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
      const grd = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.r);
      grd.addColorStop(0, "#fff"); grd.addColorStop(0.4, p.color); grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fillStyle = grd; ctx.fill();
      if (p.text) {
        ctx.fillStyle = "#0a0a0a"; ctx.font = `900 ${p.kind === "coin" ? 16 : 18}px DM Mono, monospace`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(p.text, p.x, p.y + 1);
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
        ctx.fillStyle = "#6b4a07"; ctx.font = "900 9px DM Mono, monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("$", p.x, p.y + 1);
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fillStyle = p.color; ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ==========================================================================
     STAGE BACKGROUND  —  cursed dusk meme-coin arena, parallax + chart skyline.
     ========================================================================== */
  let bgT = 0;
  function drawStage(dt) {
    bgT += dt;
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
     AI  —  light FSM opponent. Difficulty 0 chill / 1 normal / 2 sweaty.
     ========================================================================== */
  class AI {
    constructor(diff) { this.diff = diff; this.t = 0; this.decideIn = 0; this.plan = "approach"; }
    think(self, opp, dt) {
      const intent = { left: false, right: false, up: false, crouch: false, block: false, punch: false, kick: false, special: false };
      if (self.state === "ko" || self.state === "win" || !self.canAct()) return intent;
      this.t += dt; this.decideIn -= dt;
      const dist = Math.abs(opp.x - self.x);
      const dir = opp.x < self.x ? -1 : 1;
      const aggr = [0.55, 0.8, 1.0][this.diff];
      const react = [0.42, 0.26, 0.13][this.diff];

      // block incoming melee / projectiles
      const oppAttacking = opp.state === "attack" && opp.attack && opp.attack.t < opp.attack.def.startup + opp.attack.def.active;
      const projNear = projectiles.some(p => p.owner === opp && Math.abs(p.x - self.x) < 150 && Math.sign(p.vx) === dir * -1);
      if ((oppAttacking && dist < 150) || projNear) {
        if (Math.random() < aggr) { intent.block = true; return intent; }
      }

      if (this.decideIn <= 0) {
        this.decideIn = rand(react, react + 0.5);
        const r = Math.random();
        if (self.meter >= self.def.special.cost && dist > 220 && r < 0.5 * aggr) this.plan = "special";
        else if (dist > 150) this.plan = r < 0.2 ? "jump" : "approach";
        else if (dist > 70) this.plan = r < 0.6 * aggr ? "attack" : "approach";
        else this.plan = r < 0.5 ? "retreat" : "attack";
      }

      switch (this.plan) {
        case "approach": dir > 0 ? intent.right = true : intent.left = true; break;
        case "retreat": dir > 0 ? intent.left = true : intent.right = true; intent.block = Math.random() < 0.3; break;
        case "jump": intent.up = true; dir > 0 ? intent.right = true : intent.left = true; this.plan = "approach"; break;
        case "special": intent.special = true; this.plan = "approach"; this.decideIn = 0.6; break;
        case "attack":
          if (dist < 130) {
            if (Math.random() < 0.4) intent.kick = true; else intent.punch = true;
            this.plan = "approach"; this.decideIn = rand(0.2, 0.5);
          } else { dir > 0 ? intent.right = true : intent.left = true; }
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
    p1hp: document.getElementById("p1-health"), p2hp: document.getElementById("p2-health"),
    p1chip: document.getElementById("p1-health-chip"), p2chip: document.getElementById("p2-health-chip"),
    p1pips: document.getElementById("p1-pips"), p2pips: document.getElementById("p2-pips"),
    p1meter: document.getElementById("p1-meter"), p2meter: document.getElementById("p2-meter"),
    timer: document.getElementById("round-timer"), roundLabel: document.getElementById("round-label"),
    announce: document.getElementById("tk-announce"),
  };

  const match = {
    phase: "select",         // select intro fight roundend matchend
    round: 1,
    timer: ROUND_TIME,
    phaseT: 0,
    fighters: [],
    ai: null,
    diff: 1,
    finisher: false,
    init(p1Def, p2Def, diff) {
      this.diff = diff;
      this.fighters = [
        new Fighter(p1Def, 320, 1, false),
        new Fighter(p2Def, 640, -1, true),
      ];
      this.fighters[0].rounds = 0; this.fighters[1].rounds = 0;
      this.ai = new AI(diff);
      this.round = 1;
      els.p1name.textContent = p1Def.name;
      els.p2name.textContent = p2Def.name;
      this.startRound();
    },
    startRound() {
      const [a, b] = this.fighters;
      a.reset(320, 1); b.reset(640, -1);   // HP resets each round; meter carries over
      this.timer = ROUND_TIME;
      this.phase = "intro"; this.phaseT = 0;
      this.finisher = false;
      projectiles = []; particles = [];
      announce(`ROUND ${this.round}`, 1.0);
      els.roundLabel.textContent = `Round ${this.round}`;
    },
    beginFight() {
      this.phase = "fight"; this.phaseT = 0;
      announce("FIGHT!", 0.7, true);
      audio.bell();
    },
    endRound(winnerIdx, byKO) {
      if (this.phase === "roundend" || this.phase === "matchend") return;
      this.fighters[winnerIdx].rounds++;
      const winner = this.fighters[winnerIdx];
      const loser = this.fighters[1 - winnerIdx];
      const matchWon = winner.rounds >= ROUNDS_TO_WIN;
      this.phase = "roundend"; this.phaseT = 0;
      this.matchWon = matchWon; this.winnerIdx = winnerIdx; this.byKO = byKO;
      if (byKO) { announce("K.O.", 1.4, true); shake(12); }
      else announce("TIME", 1.2, true);
      winner.win();
    },
    update(dt) {
      const [p1, p2] = this.fighters;
      this.phaseT += dt;

      if (this.phase === "intro") {
        // hold fighters; advance to fight
        p1.update(dt, NEUTRAL, p2, "intro");
        p2.update(dt, NEUTRAL, p1, "intro");
        if (this.phaseT > 1.1) this.beginFight();
        return;
      }

      if (this.phase === "fight") {
        this.timer = Math.max(0, this.timer - dt);
        const p1Intent = readPlayerIntent();
        const p2Intent = this.ai.think(p2, p1, dt);
        p1.update(dt, p1Intent, p2, "fight");
        p2.update(dt, p2Intent, p1, "fight");
        // separation: stop overlap
        separate(p1, p2);
        // win checks
        if (p1.hp <= 0 && p1.state === "ko") this.endRound(1, true);
        else if (p2.hp <= 0 && p2.state === "ko") this.endRound(0, true);
        else if (this.timer <= 0) {
          const w = p1.hp === p2.hp ? (Math.random() < 0.5 ? 0 : 1) : (p1.hp > p2.hp ? 0 : 1);
          this.endRound(w, false);
        }
        return;
      }

      if (this.phase === "roundend") {
        const win = this.fighters[this.winnerIdx], lose = this.fighters[1 - this.winnerIdx];
        win.update(dt, NEUTRAL, lose, "roundend");
        lose.update(dt, NEUTRAL, win, "roundend");
        // match-ending KO -> finisher flourish
        if (this.matchWon && this.byKO && !this.finisher && this.phaseT > 1.1) {
          this.finisher = true;
          announce("FINISH!", 1.2, true);
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
      showResult(this.winnerIdx, this.byKO, this.fighters);
    },
    // Arcade continue: after a paid toll, reset the standings to a single
    // sudden-death round so the player fights on with the same matchup.
    continueMatch() {
      const [a, b] = this.fighters;
      a.rounds = ROUNDS_TO_WIN - 1;
      b.rounds = ROUNDS_TO_WIN - 1;
      this.matchWon = false;
      document.body.dataset.gameState = "fight";
      this.startRound();
    },
    draw(dt) {
      const [p1, p2] = this.fighters;
      // draw by x for simple depth (further fighter behind)
      if (p1.x <= p2.x) { p1.draw(); p2.draw(); } else { p2.draw(); p1.draw(); }
    },
  };
  const NEUTRAL = { left: false, right: false, up: false, crouch: false, block: false, punch: false, kick: false, special: false };

  function separate(a, b) {
    const minGap = 100;
    const dx = b.x - a.x;
    if (Math.abs(dx) < minGap && a.grounded && b.grounded) {
      const overlap = (minGap - Math.abs(dx)) / 2;
      const s = dx >= 0 ? 1 : -1;
      a.x -= s * overlap; b.x += s * overlap;
      a.x = clamp(a.x, WALL_L, WALL_R); b.x = clamp(b.x, WALL_L, WALL_R);
    }
  }

  function announce(text, dur, big) {
    els.announce.textContent = text;
    els.announce.className = "tk-announce is-show" + (big ? " is-big" : "");
    clearTimeout(announce._t);
    announce._t = setTimeout(() => { els.announce.className = "tk-announce"; }, dur * 1000);
  }

  /* ==========================================================================
     HUD
     ========================================================================== */
  function updateHUD() {
    const [p1, p2] = match.fighters;
    if (!p1) return;
    els.p1hp.style.width = (p1.hp / MAX_HP * 100) + "%";
    els.p2hp.style.width = (p2.hp / MAX_HP * 100) + "%";
    els.p1chip.style.width = (p1.hp / MAX_HP * 100) + "%";
    els.p2chip.style.width = (p2.hp / MAX_HP * 100) + "%";
    els.p1meter.style.width = (p1.meter / MAX_METER * 100) + "%";
    els.p2meter.style.width = (p2.meter / MAX_METER * 100) + "%";
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
     INPUT  —  keyboard + on-screen touch buttons feed a shared intent object.
     ========================================================================== */
  const held = {};   // continuous keys
  const edge = {};   // one-shot (consumed) buttons: punch/kick/special
  const KEYMAP = {
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right",
    ArrowUp: "up", w: "up", W: "up",
    ArrowDown: "crouch", s: "crouch", S: "crouch",
    j: "punch", J: "punch",
    k: "kick", K: "kick",
    l: "special", L: "special",
    " ": "block",
  };
  function readPlayerIntent() {
    const i = {
      left: !!held.left, right: !!held.right, up: !!held.up, crouch: !!held.crouch,
      block: !!held.block,
      punch: !!edge.punch, kick: !!edge.kick, special: !!edge.special,
    };
    edge.punch = edge.kick = edge.special = false;
    return i;
  }
  window.addEventListener("keydown", e => {
    const tag = e.target && e.target.tagName;
    if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
    const a = KEYMAP[e.key]; if (!a) return;
    e.preventDefault();
    audio.ensure();
    if (a === "punch" || a === "kick" || a === "special") { if (!held[a]) edge[a] = true; }
    held[a] = true;
  });
  window.addEventListener("keyup", e => {
    const a = KEYMAP[e.key]; if (!a) return;
    held[a] = false;
  });
  // touch buttons
  document.querySelectorAll(".tbtn").forEach(btn => {
    const key = btn.dataset.key;
    const map = { left: "left", right: "right", up: "up", crouch: "crouch", block: "block" };
    const down = e => {
      e.preventDefault(); audio.ensure();
      if (key === "punch" || key === "kick" || key === "special") { edge[key] = true; held[key] = true; }
      else held[map[key]] = true;
      btn.classList.add("is-down");
    };
    const up = e => {
      e.preventDefault();
      if (map[key]) held[map[key]] = false; else held[key] = false;
      btn.classList.remove("is-down");
    };
    btn.addEventListener("touchstart", down, { passive: false });
    btn.addEventListener("touchend", up, { passive: false });
    btn.addEventListener("touchcancel", up, { passive: false });
    btn.addEventListener("mousedown", down);
    window.addEventListener("mouseup", up);
  });

  /* ==========================================================================
     CHARACTER SELECT  +  page roster cards
     ========================================================================== */
  let selectedId = null;
  const rosterGrid = document.getElementById("roster-grid");
  const fightBtn = document.getElementById("tk-fight-button");
  const selYou = document.getElementById("select-you");
  const selCpu = document.getElementById("select-cpu");
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
  // Thumbnail: the real sprite art if the fighter has one, else a procedural head.
  function portraitEl(def, size) {
    if (def.spriteSrc) {
      const im = document.createElement("img");
      im.src = SPRITE_DIR + def.spriteSrc;
      im.alt = def.name; im.className = "portrait";
      return im;
    }
    return portrait(def, size);
  }

  ROSTER.forEach(def => {
    const card = document.createElement("button");
    card.type = "button"; card.className = "roster-pick"; card.dataset.id = def.id;
    card.setAttribute("role", "option");
    card.style.setProperty("--accent", def.pal.accent);
    const port = portraitEl(def, 96);
    card.appendChild(port);
    const nm = document.createElement("strong"); nm.textContent = def.name; card.appendChild(nm);
    const tg = document.createElement("span"); tg.className = "pick-tag"; tg.textContent = def.tag; card.appendChild(tg);
    card.addEventListener("click", () => selectFighter(def.id));
    rosterGrid.appendChild(card);
  });

  function selectFighter(id) {
    selectedId = id;
    document.querySelectorAll(".roster-pick").forEach(c => c.classList.toggle("is-active", c.dataset.id === id));
    selYou.textContent = byId(id).name;
    fightBtn.disabled = false;
    audio.ensure(); audio.blip(660, 0.08, "square", 0.08, 880);
  }

  fightBtn.addEventListener("click", () => {
    if (!selectedId) return;
    audio.ensure(); audio.on = true; soundBtn.classList.add("is-on"); soundBtn.setAttribute("aria-pressed", "true");
    const p1 = byId(selectedId);
    const pool = ROSTER.filter(r => r.id !== selectedId);
    const p2 = pool[Math.floor(Math.random() * pool.length)];
    selCpu.textContent = p2.name;
    document.getElementById("tk-select").classList.remove("is-visible");
    document.body.dataset.gameState = "fight";
    fightBtn.blur();   // so Space (block) can't re-activate the focused button
    match.init(p1, p2, parseInt(diffSel.value, 10));
  });

  // page roster cards (the "Know Your Memes" section)
  const rosterCards = document.getElementById("roster-cards");
  ROSTER.forEach((def, i) => {
    const card = document.createElement("article");
    card.className = "coming-card roster-card";
    card.style.setProperty("--accent", def.pal.accent);
    const port = portraitEl(def, 110);
    port.classList.add("roster-card-art");
    card.appendChild(port);
    card.insertAdjacentHTML("beforeend",
      `<span>00${i + 1}</span><h3>${def.name}</h3><p>${def.blurb}</p>` +
      `<p class="special-line">Special · <strong>${def.special.name}</strong></p>`);
    rosterCards.appendChild(card);
  });

  /* ==========================================================================
     RESULT OVERLAY
     ========================================================================== */
  const resultOverlay = document.getElementById("tk-result");
  function showResult(winnerIdx, byKO, fighters) {
    const winner = fighters[winnerIdx];
    const youWon = winnerIdx === 0;
    document.getElementById("result-kicker").textContent = youWon ? "You win" : "You lose";
    document.getElementById("result-message").textContent = winner.def.name + " WINS";
    const finishBadge = document.getElementById("finish-badge");
    if (byKO && winner.rounds >= ROUNDS_TO_WIN) {
      finishBadge.textContent = "FATALITY";
      finishBadge.style.display = "";
    } else finishBadge.style.display = "none";
    document.getElementById("result-detail").textContent = youWon
      ? `${winner.def.name} stands. "${winner.def.tag}"`
      : `Rugged by the CPU's ${winner.def.name}. Run it back?`;
    resultOverlay.classList.toggle("is-loss", !youWon);
    resultOverlay.classList.add("is-visible");

    // Continue (paid) is only offered when the player lost.
    const contRow = document.getElementById("tk-continue-row");
    const contBtn = document.getElementById("tk-continue");
    if (contRow && contBtn) {
      contRow.style.display = youWon ? "none" : "";
      if (!youWon) {
        contBtn.disabled = false;
        contBtn.textContent = "Continue · " + (window.TrollPay ? window.TrollPay.costLabel() : "USDC");
      }
    }
    (!youWon && contBtn ? contBtn : document.getElementById("tk-rematch")).focus();
  }
  document.getElementById("tk-rematch").addEventListener("click", e => {
    resultOverlay.classList.remove("is-visible");
    e.currentTarget.blur();
    const p1 = match.fighters[0].def, p2 = match.fighters[1].def;
    match.init(p1, p2, parseInt(diffSel.value, 10));
  });

  // Paid continue — one on-chain toll (base + 6.9% tax) resumes the match.
  const continueBtn = document.getElementById("tk-continue");
  if (continueBtn) {
    if (window.TrollPay) window.TrollPay.mountTokenPicker(document.getElementById("tk-pay-token-picker"));
    continueBtn.addEventListener("click", async e => {
      const btn = e.currentTarget;
      if (!window.TrollPay) { btn.textContent = "Payments unavailable"; return; }
      btn.disabled = true;
      const set = t => { btn.textContent = t; };
      set("Connect wallet…");
      const res = await window.TrollPay.payForRevive(ev => {
        if (ev.stage === "connecting")      set("Connect wallet…");
        else if (ev.stage === "building")   set("Building tx…");
        else if (ev.stage === "awaiting")   set("Confirm in Phantom…");
        else if (ev.stage === "confirming") set("Confirming…");
      });
      if (!res.ok) {
        set(res.reason || "Payment failed");
        setTimeout(() => { btn.disabled = false; set("Continue · " + window.TrollPay.costLabel()); }, 1800);
        return;
      }
      btn.blur();
      resultOverlay.classList.remove("is-visible");
      match.continueMatch();
    });
  }
  document.getElementById("tk-change").addEventListener("click", () => {
    resultOverlay.classList.remove("is-visible");
    document.getElementById("tk-select").classList.add("is-visible");
    document.body.dataset.gameState = "select";
    match.phase = "select";
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
     MAIN LOOP
     ========================================================================== */
  let lastT = performance.now();
  function loop(now) {
    let dt = (now - lastT) / 1000;
    lastT = now;
    dt = Math.min(dt, 0.05);

    // hitstop freezes sim but not rendering
    let simDt = dt;
    if (hitstopT > 0) { hitstopT -= dt; simDt = 0.0005; }

    if (match.phase !== "select") {
      match.update(simDt);
      updateProjectiles(simDt, match.fighters);
    }
    updateParticles(dt);

    // camera shake
    ctx.save();
    if (shakeAmt > 0) {
      ctx.translate(rand(-shakeAmt, shakeAmt), rand(-shakeAmt, shakeAmt));
      shakeAmt = Math.max(0, shakeAmt - dt * 60);
    }
    drawStage(dt);
    if (match.fighters.length) {
      match.draw(dt);
      drawProjectiles();
    }
    drawParticles();
    ctx.restore();

    if (match.phase !== "select") updateHUD();

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
