/* Troll High — recess minigames v1 (design doc §11): four square,
   tetherball, hopscotch, kickball. Original in-world games, not embeds —
   each is a small self-contained canvas loop with its own keyboard
   handling (arrow keys / digits / space), independent of the main game's
   Input class. Movement is frozen by main.js while one is open, same as
   the arcade overlay. */

const W = 320, H = 220;

const KINDS = {
  foursquare: { title: "Four Square", help: "Press the number that lights up. 3 misses and you're out." },
  tetherball: { title: "Tetherball", help: "Press SPACE when the ball crosses the glow. 15 seconds." },
  hopscotch: { title: "Hopscotch", help: "Repeat the sequence with the arrow keys." },
  kickball: { title: "Kickball", help: "Press SPACE to stop each bar. 3 kicks." },
};

export function minigameInfo(kind) {
  return KINDS[kind] || { title: kind, help: "" };
}

export class Minigame {
  constructor(canvas, kind) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.kind = kind;
    this.score = 0;
    this.finished = false;
    this.t = 0;
    this._raf = null;
    this._last = 0;
    this._keydown = e => this._onKey(e);
    this._state = this._initState(kind);
  }

  start() {
    addEventListener("keydown", this._keydown);
    this._last = performance.now();
    const loop = now => {
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      this.t += dt;
      this._update(dt);
      this._draw();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    removeEventListener("keydown", this._keydown);
  }

  _onKey(e) {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Digit1", "Digit2", "Digit3", "Digit4"].includes(e.code)) {
      e.preventDefault();
    }
    if (this.finished) return;
    const fn = this[`_key_${this.kind}`];
    if (fn) fn.call(this, e.code);
  }

  _initState(kind) {
    switch (kind) {
      case "foursquare":
        return { lit: -1, misses: 0, window: 1.1, timer: 1.1 };
      case "tetherball":
        return { angle: 0, speed: 2.4, hits: 0, sweetAt: Math.random() * Math.PI * 2, cooldown: 0 };
      case "hopscotch":
        return { seq: [rnd4()], showIdx: 0, showT: 0, phase: "show", inputIdx: 0 };
      case "kickball":
        return { phase: "power", bar: 0, dir: 1, power: 0, accuracy: 0, kicks: 0, total: 0 };
      default:
        return {};
    }
  }

  // ------------------------------------------------------- four square
  _key_foursquare(code) {
    const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[code];
    if (digit === undefined) return;
    const s = this._state;
    if (digit === s.lit) {
      this.score += 10;
      s.lit = -1;
      s.window = Math.max(0.5, s.window - 0.03);
    }
  }
  _update_foursquare(dt) {
    const s = this._state;
    s.timer -= dt;
    if (s.lit === -1 && s.timer <= 0) {
      s.lit = Math.floor(Math.random() * 4);
      s.timer = s.window;
    } else if (s.lit !== -1 && s.timer <= 0) {
      s.misses++;
      s.lit = -1;
      s.timer = s.window;
      if (s.misses >= 3) this.finished = true;
    }
  }
  _draw_foursquare() {
    const ctx = this.ctx, s = this._state;
    ctx.fillStyle = "#0c3b16"; ctx.fillRect(0, 0, W, H);
    const cell = 90, gap = 10, ox = W / 2 - cell - gap / 2, oy = H / 2 - cell - gap / 2;
    for (let i = 0; i < 4; i++) {
      const x = ox + (i % 2) * (cell + gap), y = oy + Math.floor(i / 2) * (cell + gap);
      ctx.fillStyle = i === s.lit ? "#ffd23f" : "#1f5c2c";
      ctx.fillRect(x, y, cell, cell);
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.strokeRect(x, y, cell, cell);
      ctx.fillStyle = "#0c3b16"; ctx.font = "bold 20px DM Mono, monospace";
      ctx.fillText(String(i + 1), x + cell / 2 - 6, y + cell / 2 + 7);
    }
    if (this.finished) drawEnd(ctx, this.score);
  }

  // ------------------------------------------------------- tetherball
  _key_tetherball(code) {
    if (code !== "Space") return;
    const s = this._state;
    const diff = Math.min(
      Math.abs(s.angle - s.sweetAt),
      Math.PI * 2 - Math.abs(s.angle - s.sweetAt)
    );
    if (diff < 0.35) {
      this.score += 10;
      s.speed = Math.min(6, s.speed + 0.2);
      s.sweetAt = (s.angle + Math.PI * (0.6 + Math.random() * 0.8)) % (Math.PI * 2);
    }
  }
  _update_tetherball(dt) {
    const s = this._state;
    s.angle = (s.angle + s.speed * dt) % (Math.PI * 2);
    if (this.t >= 15) this.finished = true;
  }
  _draw_tetherball() {
    const ctx = this.ctx, s = this._state;
    ctx.fillStyle = "#0c3b16"; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, r = 70;
    ctx.strokeStyle = "#6b4a2a"; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy + 90); ctx.stroke();
    ctx.lineWidth = 1;
    // sweet-spot arc
    ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(cx, cy, r, s.sweetAt - 0.35, s.sweetAt + 0.35); ctx.stroke();
    ctx.lineWidth = 1;
    // ball
    const bx = cx + Math.cos(s.angle) * r, by = cy + Math.sin(s.angle) * r;
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(bx, by, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#cfd6e0"; ctx.font = "12px DM Mono, monospace";
    ctx.fillText(`${Math.max(0, (15 - this.t)).toFixed(1)}s`, 10, 18);
    if (this.finished) drawEnd(ctx, this.score);
  }

  // -------------------------------------------------------- hopscotch
  _key_hopscotch(code) {
    const dir = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 }[code];
    if (dir === undefined) return;
    const s = this._state;
    if (s.phase !== "input") return;
    if (dir === s.seq[s.inputIdx]) {
      s.inputIdx++;
      if (s.inputIdx >= s.seq.length) {
        this.score = s.seq.length;
        s.seq.push(rnd4());
        s.inputIdx = 0;
        s.phase = "show"; s.showIdx = 0; s.showT = 0;
      }
    } else {
      this.finished = true;
    }
  }
  _update_hopscotch(dt) {
    const s = this._state;
    if (s.phase !== "show") return;
    s.showT += dt;
    if (s.showT > 0.55) {
      s.showT = 0;
      s.showIdx++;
      if (s.showIdx >= s.seq.length) s.phase = "input";
    }
  }
  _draw_hopscotch() {
    const ctx = this.ctx, s = this._state;
    ctx.fillStyle = "#0c3b16"; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, r = 60;
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const active = s.phase === "show" ? s.seq[s.showIdx] : -1;
    dirs.forEach(([dx, dy], i) => {
      const x = cx + dx * r, y = cy + dy * r;
      ctx.fillStyle = i === active ? "#ffd23f" : "#e9e2c8";
      ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.stroke();
    });
    ctx.fillStyle = "#cfd6e0"; ctx.font = "12px DM Mono, monospace";
    ctx.fillText(s.phase === "show" ? "Watch…" : "Your turn", 10, 18);
    if (this.finished) drawEnd(ctx, this.score);
  }

  // --------------------------------------------------------- kickball
  _key_kickball(code) {
    if (code !== "Space") return;
    const s = this._state;
    if (s.phase === "power") {
      s.power = s.bar;
      s.bar = 0; s.dir = 1;
      s.phase = "accuracy";
    } else if (s.phase === "accuracy") {
      s.accuracy = 100 - Math.abs(50 - s.bar) * 2;
      const kickScore = Math.round((s.power / 100) * (s.accuracy / 100) * 100);
      this.score += kickScore;
      s.total += kickScore;
      s.kicks++;
      if (s.kicks >= 3) { this.finished = true; return; }
      s.bar = 0; s.dir = 1; s.phase = "power";
    }
  }
  _update_kickball(dt) {
    const s = this._state;
    if (this.finished) return;
    const speed = s.phase === "power" ? 90 : 140;
    s.bar += s.dir * speed * dt;
    if (s.bar >= 100) { s.bar = 100; s.dir = -1; }
    if (s.bar <= 0) { s.bar = 0; s.dir = 1; }
  }
  _draw_kickball() {
    const ctx = this.ctx, s = this._state;
    ctx.fillStyle = "#0c3b16"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#cfd6e0"; ctx.font = "12px DM Mono, monospace";
    ctx.fillText(`Kick ${Math.min(s.kicks + 1, 3)}/3 — ${s.phase === "power" ? "power" : "accuracy"}`, 10, 18);
    const bx = 30, by = 90, bw = 260, bh = 22;
    ctx.strokeStyle = "#cfd6e0"; ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = s.phase === "power" ? "#ffd23f" : "#4dc9ff";
    ctx.fillRect(bx, by, (bw * s.bar) / 100, bh);
    if (s.phase === "accuracy") {
      const cx = bx + bw / 2;
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath(); ctx.moveTo(cx, by - 6); ctx.lineTo(cx, by + bh + 6); ctx.stroke();
    }
    ctx.fillText(`Total: ${s.total}`, 10, 140);
    if (this.finished) drawEnd(ctx, this.score);
  }

  _update(dt) {
    const fn = this[`_update_${this.kind}`];
    if (fn) fn.call(this, dt);
  }
  _draw() {
    const fn = this[`_draw_${this.kind}`];
    if (fn) fn.call(this);
  }
}

function rnd4() { return Math.floor(Math.random() * 4); }

function drawEnd(ctx, score) {
  ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffd23f"; ctx.font = "bold 18px DM Mono, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`Final score: ${score}`, W / 2, H / 2 - 6);
  ctx.font = "12px DM Mono, monospace"; ctx.fillStyle = "#cfd6e0";
  ctx.fillText("Press E to close", W / 2, H / 2 + 16);
  ctx.textAlign = "left";
}
