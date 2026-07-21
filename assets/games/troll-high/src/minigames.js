/* Troll High — recess minigames (design doc §11) plus classes-as-
   minigames (design doc §21, "every class should be an enjoyable
   minigame"): four square, tetherball, hopscotch, kickball, pop quiz,
   mental math, word scramble, lab mix, PACER test. Original in-world
   games, not embeds — each is a small self-contained canvas loop with
   its own keyboard handling (arrow keys / digits / space), independent
   of the main game's Input class. Movement is frozen by main.js while
   one is open, same as the arcade overlay. */

const W = 320, H = 220;

const KINDS = {
  foursquare: { title: "Four Square", help: "Press the number that lights up. 3 misses and you're out." },
  tetherball: { title: "Tetherball", help: "Press SPACE when the ball crosses the glow. 15 seconds." },
  hopscotch: { title: "Hopscotch", help: "Repeat the sequence with the arrow keys." },
  kickball: { title: "Kickball", help: "Press SPACE to stop each bar. 3 kicks." },
  "pop-quiz": { title: "Pop Quiz", help: "Press the number for the right answer before time's up." },
  "mental-math": { title: "Mental Math", help: "Press the number matching the answer. Gets faster." },
  "word-scramble": { title: "Word Scramble", help: "Press the numbered letters in order to spell the word." },
  "lab-mix": { title: "Lab Mix", help: "Press two reagents that combine into the target color." },
  "pacer-test": { title: "PACER Test", help: "Press SPACE right on each beep. It speeds up every lap." },
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
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space",
      "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"].includes(e.code)) {
      e.preventDefault();
    }
    if (this.finished) return;
    const fn = this[`_key_${methodKind(this.kind)}`];
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
      case "pop-quiz":
        return { round: 0, misses: 0, qi: rndQuestion(-1), timer: 5, timeLimit: 5 };
      case "mental-math":
        return { round: 0, misses: 0, timeLimit: 4, timer: 4, ...genMathQuestion() };
      case "word-scramble": {
        const wi = Math.floor(Math.random() * WORDS.length);
        return { wi, ...scrambleWord(WORDS[wi]), round: 0, misses: 0 };
      }
      case "lab-mix":
        return { round: 0, misses: 0, timer: 6, timeLimit: 6, first: -1, ...pickMixTarget() };
      case "pacer-test":
        return { lap: 0, interval: 1.5, beepAt: 1.5, windowOpen: false, hitWindowStart: 0 };
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

  // -------------------------------------------------------- pop quiz
  _key_pop_quiz(code) {
    const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[code];
    if (digit === undefined) return;
    const s = this._state, q = QUIZ[s.qi];
    if (digit === q.correct) this.score += 10;
    else s.misses++;
    if (s.misses >= 3 || s.round >= 5) { this.finished = true; return; }
    s.round++;
    s.qi = rndQuestion(s.qi);
    s.timer = s.timeLimit;
  }
  _update_pop_quiz(dt) {
    const s = this._state;
    s.timer -= dt;
    if (s.timer <= 0) {
      s.misses++;
      if (s.misses >= 3 || s.round >= 5) { this.finished = true; return; }
      s.round++;
      s.qi = rndQuestion(s.qi);
      s.timer = s.timeLimit;
    }
  }
  _draw_pop_quiz() {
    const ctx = this.ctx, s = this._state, q = QUIZ[s.qi];
    ctx.fillStyle = "#0c3b16"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#cfd6e0"; ctx.font = "11px DM Mono, monospace";
    ctx.fillText(`Round ${s.round + 1}/5 — misses ${s.misses}/3`, 10, 16);
    ctx.fillStyle = "#ffd23f"; ctx.font = "bold 13px DM Mono, monospace";
    wrapText(ctx, q.q, 10, 40, W - 20, 16);
    q.choices.forEach((c, i) => {
      const y = 100 + i * 26;
      ctx.fillStyle = "#e9e2c8"; ctx.font = "12px DM Mono, monospace";
      ctx.fillText(`${i + 1}. ${c}`, 16, y);
    });
    const barW = ((W - 20) * Math.max(0, s.timer)) / s.timeLimit;
    ctx.fillStyle = "#4dc9ff"; ctx.fillRect(10, H - 14, barW, 6);
    if (this.finished) drawEnd(ctx, this.score);
  }

  // ----------------------------------------------------- mental math
  _key_mental_math(code) {
    const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[code];
    if (digit === undefined) return;
    const s = this._state;
    if (digit === s.correctIdx) { this.score += 10; s.timeLimit = Math.max(1.5, s.timeLimit - 0.15); }
    else s.misses++;
    s.round++;
    if (s.misses >= 3 || s.round >= 10) { this.finished = true; return; }
    Object.assign(s, genMathQuestion());
    s.timer = s.timeLimit;
  }
  _update_mental_math(dt) {
    const s = this._state;
    s.timer -= dt;
    if (s.timer <= 0) {
      s.misses++; s.round++;
      if (s.misses >= 3 || s.round >= 10) { this.finished = true; return; }
      Object.assign(s, genMathQuestion());
      s.timer = s.timeLimit;
    }
  }
  _draw_mental_math() {
    const ctx = this.ctx, s = this._state;
    ctx.fillStyle = "#0c3b16"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#cfd6e0"; ctx.font = "11px DM Mono, monospace";
    ctx.fillText(`Round ${s.round + 1}/10 — misses ${s.misses}/3`, 10, 16);
    ctx.fillStyle = "#ffd23f"; ctx.font = "bold 22px DM Mono, monospace"; ctx.textAlign = "center";
    ctx.fillText(`${s.a} ${s.op} ${s.b} = ?`, W / 2, 60);
    ctx.textAlign = "left";
    s.choices.forEach((c, i) => {
      const x = 30 + (i % 2) * 150, y = 110 + Math.floor(i / 2) * 40;
      ctx.fillStyle = "#e9e2c8"; ctx.font = "14px DM Mono, monospace";
      ctx.fillText(`${i + 1}. ${c}`, x, y);
    });
    const barW = ((W - 20) * Math.max(0, s.timer)) / s.timeLimit;
    ctx.fillStyle = "#4dc9ff"; ctx.fillRect(10, H - 14, barW, 6);
    if (this.finished) drawEnd(ctx, this.score);
  }

  // -------------------------------------------------- word scramble
  _key_word_scramble(code) {
    const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5 }[code];
    if (digit === undefined) return;
    const s = this._state;
    if (digit >= s.order.length || s.picked.includes(digit)) return;
    const expectedLetterIdx = s.order[digit];
    const nextCorrectIdx = s.picked.length;
    if (s.letters[expectedLetterIdx] === s.word[nextCorrectIdx]) {
      s.picked.push(digit);
      if (s.picked.length === s.letters.length) {
        this.score += 10;
        s.round++;
        if (s.round >= 5) { this.finished = true; return; }
        s.wi = (s.wi + 1) % WORDS.length;
        Object.assign(s, scrambleWord(WORDS[s.wi]), { round: s.round });
      }
    } else {
      s.misses++;
      if (s.misses >= 3) { this.finished = true; return; }
      s.picked = [];
    }
  }
  _draw_word_scramble() {
    const ctx = this.ctx, s = this._state;
    ctx.fillStyle = "#0c3b16"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#cfd6e0"; ctx.font = "11px DM Mono, monospace";
    ctx.fillText(`Word ${s.round + 1}/5 — misses ${s.misses}/3`, 10, 16);
    const cell = 40, gap = 6, total = s.order.length * (cell + gap) - gap;
    const ox = (W - total) / 2, oy = 90;
    s.order.forEach((letterIdx, tileIdx) => {
      const x = ox + tileIdx * (cell + gap);
      const picked = s.picked.includes(tileIdx);
      ctx.fillStyle = picked ? "#1f5c2c" : "#ffd23f";
      ctx.fillRect(x, oy, cell, cell);
      ctx.fillStyle = picked ? "#7a8a7a" : "#0c3b16";
      ctx.font = "bold 18px DM Mono, monospace"; ctx.textAlign = "center";
      ctx.fillText(s.letters[letterIdx], x + cell / 2, oy + 26);
      ctx.font = "9px DM Mono, monospace";
      ctx.fillText(String(tileIdx + 1), x + cell / 2, oy + cell + 12);
    });
    ctx.textAlign = "center"; ctx.fillStyle = "#e9e2c8"; ctx.font = "13px DM Mono, monospace";
    ctx.fillText(s.word.split("").map((_, i) => (i < s.picked.length ? s.word[i] : "_")).join(" "), W / 2, 60);
    ctx.textAlign = "left";
    if (this.finished) drawEnd(ctx, this.score);
  }

  // ------------------------------------------------------------ lab mix
  _key_lab_mix(code) {
    const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[code];
    if (digit === undefined) return;
    const s = this._state;
    if (s.first === -1) { s.first = digit; return; }
    const pair = [s.first, digit].sort();
    const match = pair[0] === s.target.pair[0] && pair[1] === s.target.pair[1];
    if (match) this.score += 10;
    else s.misses++;
    s.first = -1;
    s.round++;
    if (s.misses >= 3 || s.round >= 6) { this.finished = true; return; }
    Object.assign(s, pickMixTarget());
    s.timer = s.timeLimit;
  }
  _update_lab_mix(dt) {
    const s = this._state;
    s.timer -= dt;
    if (s.timer <= 0) {
      s.misses++; s.first = -1; s.round++;
      if (s.misses >= 3 || s.round >= 6) { this.finished = true; return; }
      Object.assign(s, pickMixTarget());
      s.timer = s.timeLimit;
    }
  }
  _draw_lab_mix() {
    const ctx = this.ctx, s = this._state;
    ctx.fillStyle = "#0c3b16"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#cfd6e0"; ctx.font = "11px DM Mono, monospace";
    ctx.fillText(`Mix ${s.round + 1}/6 — misses ${s.misses}/3`, 10, 16);
    ctx.fillStyle = "#e9e2c8"; ctx.font = "13px DM Mono, monospace";
    ctx.fillText("Make:", 10, 44);
    ctx.fillStyle = s.target.color; ctx.fillRect(70, 32, 60, 16);
    ctx.fillStyle = "#e9e2c8"; ctx.fillText(s.target.name, 140, 44);
    REAGENTS.forEach((r, i) => {
      const x = 30 + i * 70, y = 90;
      const selected = s.first === i;
      ctx.fillStyle = r.color; ctx.fillRect(x, y, 50, 50);
      ctx.strokeStyle = selected ? "#ffd23f" : "rgba(255,255,255,0.4)";
      ctx.lineWidth = selected ? 3 : 1;
      ctx.strokeRect(x, y, 50, 50);
      ctx.lineWidth = 1;
      ctx.fillStyle = "#0c3b16"; ctx.font = "10px DM Mono, monospace"; ctx.textAlign = "center";
      ctx.fillText(String(i + 1), x + 25, y + 64);
      ctx.textAlign = "left";
    });
    const barW = ((W - 20) * Math.max(0, s.timer)) / s.timeLimit;
    ctx.fillStyle = "#4dc9ff"; ctx.fillRect(10, H - 14, barW, 6);
    if (this.finished) drawEnd(ctx, this.score);
  }

  // -------------------------------------------------------- PACER test
  _key_pacer_test(code) {
    if (code !== "Space") return;
    const s = this._state;
    const dt = this.t - s.beepAt;
    if (dt < -0.15) return; // pressed too early, before the window even opens
    if (Math.abs(dt) <= 0.35) {
      this.score = s.lap + 1;
      s.lap++;
      s.interval = Math.max(0.6, s.interval - 0.05);
      s.beepAt = this.t + s.interval;
    } else {
      this.finished = true;
    }
  }
  _update_pacer_test() {
    const s = this._state;
    if (this.t - s.beepAt > 0.35) this.finished = true; // missed the beep entirely
  }
  _draw_pacer_test() {
    const ctx = this.ctx, s = this._state;
    ctx.fillStyle = "#0c3b16"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#cfd6e0"; ctx.font = "12px DM Mono, monospace";
    ctx.fillText(`Lap ${s.lap}`, 10, 18);
    const untilBeep = s.beepAt - this.t;
    const pulse = Math.abs(untilBeep) < 0.35;
    ctx.fillStyle = pulse ? "#ffd23f" : "#1f5c2c";
    ctx.beginPath(); ctx.arc(W / 2, H / 2, pulse ? 60 : 46, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#0c3b16"; ctx.font = "bold 13px DM Mono, monospace"; ctx.textAlign = "center";
    ctx.fillText(pulse ? "SPACE!" : "…", W / 2, H / 2 + 5);
    ctx.textAlign = "left";
    if (this.finished) drawEnd(ctx, this.score);
  }

  _update(dt) {
    const fn = this[`_update_${methodKind(this.kind)}`];
    if (fn) fn.call(this, dt);
  }
  _draw() {
    const fn = this[`_draw_${methodKind(this.kind)}`];
    if (fn) fn.call(this);
  }
}

function rnd4() { return Math.floor(Math.random() * 4); }
// Kind ids like "pop-quiz" aren't valid JS method-name fragments, so the
// dispatcher looks up "_key_pop_quiz" etc. — this is the only place that
// needs to know about the substitution.
function methodKind(kind) { return kind.replace(/-/g, "_"); }

// -------------------------------------------------------------- pop quiz
const QUIZ = [
  { q: "What does P.E. stand for?", choices: ["Physical Education", "Pizza Enthusiasts", "Please Excuse", "Public Events"], correct: 0 },
  { q: "Which of these is NOT a real school subject?", choices: ["Math", "Interpretive Lunch", "Science", "English"], correct: 1 },
  { q: "Who patrols the hallway with a mop?", choices: ["Principal Grimface", "Janitor Gus", "Ms. Quietly", "Eldon Tusk"], correct: 1 },
  { q: "Where would you find Gerald the fish?", choices: ["The library", "Room 5A", "The gym", "The cafeteria"], correct: 1 },
  { q: "What's the forbidden classroom snack?", choices: ["Gum", "Water", "Pencils", "Erasers"], correct: 0 },
  { q: "Which kid is starting a mystery club?", choices: ["Marcus Vale", "Wendell", "Priya", "Marnie"], correct: 2 },
  { q: "What do you need to buy lunch?", choices: ["A hall pass", "Your student ID", "A permission slip", "A library card"], correct: 1 },
  { q: "Who hangs out by the bike racks?", choices: ["Pep", "Wendell", "Ms. Quietly", "Marcus Vale"], correct: 0 },
];
function rndQuestion(excludeIdx) {
  let i = Math.floor(Math.random() * QUIZ.length);
  if (QUIZ.length > 1) while (i === excludeIdx) i = Math.floor(Math.random() * QUIZ.length);
  return i;
}

// ----------------------------------------------------------- mental math
function genMathQuestion() {
  const ops = ["+", "-", "×"];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a = 1 + Math.floor(Math.random() * 12), b = 1 + Math.floor(Math.random() * 12);
  if (op === "-" && b > a) [a, b] = [b, a];
  const answer = op === "+" ? a + b : op === "-" ? a - b : a * b;
  const choices = new Set([answer]);
  while (choices.size < 4) choices.add(Math.max(0, answer + (Math.floor(Math.random() * 9) - 4)));
  const arr = [...choices].sort(() => Math.random() - 0.5);
  return { a, b, op, answer, choices: arr, correctIdx: arr.indexOf(answer) };
}

// -------------------------------------------------------- word scramble
const WORDS = ["LOCKER", "PIZZA", "RECESS", "PENCIL", "SCHOOL", "HOMEWORK", "CHALK", "BUS"];
function scrambleWord(word) {
  const letters = word.split("");
  let order;
  do { order = letters.map((_, i) => i).sort(() => Math.random() - 0.5); }
  while (order.every((v, i) => v === i) && letters.length > 1);
  return { letters, order, picked: [], word };
}

// ------------------------------------------------------------- lab mix
const REAGENTS = [
  { name: "Red", color: "#e14b4b" },
  { name: "Yellow", color: "#e8d23f" },
  { name: "Blue", color: "#4d8fe8" },
  { name: "White", color: "#e8e8e8" },
];
const MIXES = [
  { pair: [0, 1], name: "Orange", color: "#e8862e" },
  { pair: [1, 2], name: "Green", color: "#4bb85c" },
  { pair: [0, 2], name: "Purple", color: "#9a4be0" },
  { pair: [0, 3], name: "Pink", color: "#e88ec9" },
];
function pickMixTarget() {
  const mix = MIXES[Math.floor(Math.random() * MIXES.length)];
  return { target: mix };
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "", ly = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, ly);
      line = w; ly += lineHeight;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, ly);
}

function drawEnd(ctx, score) {
  ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffd23f"; ctx.font = "bold 18px DM Mono, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`Final score: ${score}`, W / 2, H / 2 - 6);
  ctx.font = "12px DM Mono, monospace"; ctx.fillStyle = "#cfd6e0";
  ctx.fillText("Press E to close", W / 2, H / 2 + 16);
  ctx.textAlign = "left";
}
