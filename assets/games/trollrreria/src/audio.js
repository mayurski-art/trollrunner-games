/* Trollrreria — synthesized sound effects (WebAudio, no assets).
   The context unlocks on the first user gesture; every call is fail-safe. */

export class SFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
    const unlock = () => {
      this.init();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /* --- building blocks ------------------------------------------------ */
  tone(freq, dur, { type = "square", vol = 0.25, slide = 0, delay = 0 } = {}) {
    if (!this.ctx || this.volume <= 0) return;
    try {
      const t0 = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* never break the game for a blip */ }
  }

  noise(dur, { vol = 0.2, freq = 800, q = 1, delay = 0, slide = 0 } = {}) {
    if (!this.ctx || this.volume <= 0) return;
    try {
      const t0 = this.ctx.currentTime + delay;
      const n = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.setValueAtTime(freq, t0);
      if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq + slide), t0 + dur);
      f.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t0); src.stop(t0 + dur);
    } catch (e) { /* ignore */ }
  }

  /* --- game sounds ----------------------------------------------------- */
  dig() { this.noise(0.09, { vol: 0.22, freq: 420, slide: -220 }); }
  tink(wood) { this.noise(0.05, { vol: 0.14, freq: wood ? 700 : 1600, q: 3 }); }
  chop() { this.noise(0.14, { vol: 0.3, freq: 520, slide: -300 }); this.tone(140, 0.1, { type: "triangle", vol: 0.2 }); }
  place() { this.tone(300, 0.06, { type: "triangle", vol: 0.22, slide: 90 }); }
  pickup() { this.tone(660, 0.05, { vol: 0.12 }); this.tone(990, 0.07, { vol: 0.1, delay: 0.05 }); }
  jump() { this.tone(240, 0.12, { type: "triangle", vol: 0.12, slide: 220 }); }
  hurt() { this.tone(180, 0.16, { type: "sawtooth", vol: 0.25, slide: -90 }); }
  squish() { this.noise(0.08, { vol: 0.2, freq: 300, slide: -140, q: 2 }); }
  kill() { this.noise(0.2, { vol: 0.24, freq: 260, slide: -180 }); this.tone(120, 0.18, { type: "triangle", vol: 0.16, slide: -60 }); }
  swing() { this.noise(0.09, { vol: 0.1, freq: 1900, slide: -900, q: 0.7 }); }
  bow() { this.tone(880, 0.07, { type: "triangle", vol: 0.12, slide: -420 }); this.noise(0.05, { vol: 0.08, freq: 2400 }); }
  door() { this.noise(0.09, { vol: 0.16, freq: 240, q: 4 }); }
  craft() { this.tone(520, 0.06, { vol: 0.14 }); this.tone(780, 0.08, { vol: 0.12, delay: 0.06 }); }
  click() { this.tone(900, 0.03, { type: "triangle", vol: 0.07 }); }
  potion() { this.tone(420, 0.1, { type: "sine", vol: 0.16, slide: 260 }); this.tone(840, 0.12, { type: "sine", vol: 0.1, delay: 0.08 }); }
  powerup() {
    this.tone(392, 0.09, { vol: 0.16 });
    this.tone(523, 0.09, { vol: 0.16, delay: 0.08 });
    this.tone(784, 0.16, { vol: 0.18, delay: 0.16 });
  }
  death() { this.tone(220, 0.5, { type: "sawtooth", vol: 0.26, slide: -170 }); this.noise(0.5, { vol: 0.16, freq: 220, slide: -140 }); }
  splash() { this.noise(0.22, { vol: 0.2, freq: 900, slide: -500, q: 0.8 }); }
  roar() {
    this.noise(0.7, { vol: 0.3, freq: 160, slide: -80, q: 0.6 });
    this.tone(70, 0.65, { type: "sawtooth", vol: 0.24, slide: 26 });
  }
  summon() { this.tone(160, 0.4, { type: "sawtooth", vol: 0.2, slide: -60 }); this.tone(80, 0.6, { type: "triangle", vol: 0.22, delay: 0.2 }); }
  fanfare() {
    this.tone(523, 0.12, { vol: 0.18 });
    this.tone(659, 0.12, { vol: 0.18, delay: 0.12 });
    this.tone(784, 0.12, { vol: 0.18, delay: 0.24 });
    this.tone(1046, 0.3, { vol: 0.2, delay: 0.36 });
  }
}
