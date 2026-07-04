/* Trollrreria — generative chiptune music. All material is procedural and
   original: each theme is a chord progression + mood knobs, and the lead
   line is a seeded random walk over the scale, regenerated every loop.
   Shares the SFX AudioContext; its own gain so music/SFX mix separately. */

import { mulberry32 } from "./util.js";

const THEMES = {
  /* prog = chord roots as scale degrees; scale = semitones from root */
  day: {
    bpm: 96, root: 57, scale: [0, 2, 4, 5, 7, 9, 11],      // A major-ish stroll
    prog: [0, 5, 3, 4], leadOct: 12, density: 0.55, hats: true, kick: false,
    leadType: "square", bassType: "triangle", leadVol: 0.05, bassVol: 0.075,
  },
  night: {
    bpm: 72, root: 57, scale: [0, 2, 3, 5, 7, 8, 10],      // A minor, sparse
    prog: [0, 3, 5, 4], leadOct: 12, density: 0.3, hats: false, kick: false,
    leadType: "triangle", bassType: "triangle", leadVol: 0.05, bassVol: 0.06,
  },
  cave: {
    bpm: 62, root: 52, scale: [0, 1, 3, 5, 7, 8, 10],      // E phrygian drips
    prog: [0, 1, 0, 5], leadOct: 24, density: 0.22, hats: false, kick: false,
    leadType: "sine", bassType: "triangle", leadVol: 0.055, bassVol: 0.05,
    echo: true,
  },
  boss: {
    bpm: 132, root: 50, scale: [0, 2, 3, 5, 7, 8, 10],     // D minor panic
    prog: [0, 0, 5, 6], leadOct: 12, density: 0.75, hats: true, kick: true,
    leadType: "square", bassType: "sawtooth", leadVol: 0.045, bassVol: 0.055,
    bassEighths: true,
  },
  title: {
    bpm: 84, root: 57, scale: [0, 2, 3, 5, 7, 8, 10],
    prog: [0, 5, 3, 4], leadOct: 12, density: 0.4, hats: false, kick: false,
    leadType: "triangle", bassType: "triangle", leadVol: 0.045, bassVol: 0.055,
  },
};

const STEPS_PER_BAR = 16;   // 16th notes
const BARS_PER_LOOP = 4;    // one chord per bar

export class Music {
  constructor(sfx, volume = 0.5) {
    this.sfx = sfx;             // provides the shared AudioContext once unlocked
    this.volume = volume;
    this.context = "title";
    this.gain = null;
    this.delay = null;
    this.step = 0;
    this.nextTime = 0;
    this.melody = [];
    this.melodySeed = 1;
    this.timer = setInterval(() => this.pump(), 90);
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain) this.gain.gain.setTargetAtTime(v, this.sfx.ctx.currentTime, 0.05);
  }

  /* Fade out, switch theme, fade back in. */
  setContext(name) {
    if (name === this.context || !THEMES[name]) return;
    this.context = name;
    this.step = 0;
    this.melody = [];
    if (this.gain && this.sfx.ctx) {
      const t = this.sfx.ctx.currentTime;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setValueAtTime(this.gain.gain.value, t);
      this.gain.gain.linearRampToValueAtTime(0, t + 0.5);
      this.gain.gain.linearRampToValueAtTime(this.volume, t + 1.4);
    }
  }

  ensureNodes() {
    const ctx = this.sfx.ctx;
    if (!ctx || this.gain) return !!this.gain;
    this.gain = ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.sfx.master ? ctx.destination : ctx.destination);
    this.delay = ctx.createDelay(1.0);
    this.delay.delayTime.value = 0.28;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    this.delay.connect(fb); fb.connect(this.delay);
    this.delay.connect(this.gain);
    return true;
  }

  /* Lookahead scheduler: keep ~0.25 s of steps queued. */
  pump() {
    if (this.volume <= 0) return;
    if (!this.sfx.ctx) return;                 // waits for the user-gesture unlock
    if (!this.ensureNodes()) return;
    const ctx = this.sfx.ctx;
    if (ctx.state === "suspended") return;
    const theme = THEMES[this.context];
    const spb = 60 / theme.bpm / 4;            // seconds per 16th
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.25) {
      this.scheduleStep(theme, this.step, this.nextTime, spb);
      this.step = (this.step + 1) % (STEPS_PER_BAR * BARS_PER_LOOP);
      this.nextTime += spb;
    }
  }

  /* Regenerate the lead line for a loop: seeded walk over the scale. */
  makeMelody(theme) {
    const rng = mulberry32(this.melodySeed++ * 2654435761 >>> 0);
    const total = STEPS_PER_BAR * BARS_PER_LOOP;
    const mel = new Array(total).fill(null);
    let deg = Math.floor(rng() * 7);
    for (let s = 0; s < total; s++) {
      if (s % 2 !== 0) continue;                       // 8th-note grid
      if (rng() > theme.density) continue;             // rests keep it airy
      const bar = Math.floor(s / STEPS_PER_BAR);
      const chordRoot = theme.prog[bar % theme.prog.length];
      /* drift stepwise, snap toward chord tones on strong beats */
      deg += Math.floor(rng() * 3) - 1;
      if (s % 8 === 0) deg = chordRoot + [0, 2, 4][Math.floor(rng() * 3)];
      deg = ((deg % 7) + 7) % 7;
      const oct = rng() < 0.18 ? 12 : 0;
      mel[s] = theme.root + theme.scale[deg] + theme.leadOct + oct;
    }
    return mel;
  }

  scheduleStep(theme, step, t, spb) {
    const bar = Math.floor(step / STEPS_PER_BAR);
    const inBar = step % STEPS_PER_BAR;
    const chordDeg = theme.prog[bar % theme.prog.length];
    const bassNote = theme.root - 12 + theme.scale[chordDeg % 7];

    /* bass: whole/half notes normally, driving 8ths for the boss */
    if (theme.bassEighths ? inBar % 2 === 0 : (inBar === 0 || inBar === 8)) {
      this.note(theme.bassType, bassNote, t, spb * (theme.bassEighths ? 1.6 : 7), theme.bassVol);
    }
    /* lead */
    if (inBar === 0 && bar === 0 && this.melody.length === 0) this.melody = this.makeMelody(theme);
    if (step === 0) this.melody = this.makeMelody(theme);
    const n = this.melody[step];
    if (n !== null && n !== undefined) {
      this.note(theme.leadType, n, t, spb * 1.8, theme.leadVol, theme.echo);
    }
    /* percussion */
    if (theme.hats && inBar % 4 === 2) this.hat(t, 0.02);
    if (theme.kick && inBar % 8 === 0) this.kick(t);
  }

  note(type, midi, t, dur, vol, echo) {
    const ctx = this.sfx.ctx;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g);
      g.connect(this.gain);
      if (echo && this.delay) g.connect(this.delay);
      o.start(t); o.stop(t + dur + 0.05);
    } catch (e) { /* music must never crash the game */ }
  }

  hat(t, vol) {
    const ctx = this.sfx.ctx;
    try {
      const n = Math.floor(ctx.sampleRate * 0.03);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = "highpass"; f.frequency.value = 6000;
      const g = ctx.createGain(); g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(this.gain);
      src.start(t);
    } catch (e) { /* ignore */ }
  }

  kick(t) {
    const ctx = this.sfx.ctx;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.11);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      o.connect(g); g.connect(this.gain);
      o.start(t); o.stop(t + 0.15);
    } catch (e) { /* ignore */ }
  }
}
