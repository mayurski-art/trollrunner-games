/* Troll High — ambience: room-tone drone + period-driven hall chatter +
   the bell. Synthesized, no licensed audio (matching Trollrreria's house
   style). Everything here reads the shared clock (src/clock.js), which is
   itself a pure function of wall-clock time — so the bell rings and the
   halls fill with chatter at the same moment for every player, with zero
   network traffic. */

export class Ambience {
  constructor() {
    this.ctx = null;
    this.gain = null;
    this.chatterGain = null;
    this.started = false;
  }

  /* Must be called from a user-gesture handler (autoplay policy). */
  start() {
    if (this.started) return;
    this.started = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 340;
    filter.connect(this.gain);

    // two slightly detuned oscillators = a warm, faintly humming room tone
    for (const [freq, gain] of [[60, 0.5], [120.5, 0.22]]) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      osc.connect(g);
      g.connect(filter);
      osc.start();
    }

    this.gain.gain.linearRampToValueAtTime(0.05, this.ctx.currentTime + 2.5);

    // hall-chatter bed: filtered noise, silent until chatter() ramps it up
    const bufSize = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const chatterFilter = this.ctx.createBiquadFilter();
    chatterFilter.type = "bandpass";
    chatterFilter.frequency.value = 500;
    chatterFilter.Q.value = 0.6;
    this.chatterGain = this.ctx.createGain();
    this.chatterGain.gain.value = 0;
    noise.connect(chatterFilter);
    chatterFilter.connect(this.chatterGain);
    this.chatterGain.connect(this.ctx.destination);
    noise.start();
  }

  /* Indoor rooms hum a little louder/duller than the open hallway. */
  setIndoor(indoor) {
    if (!this.gain) return;
    const target = indoor ? 0.07 : 0.045;
    this.gain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 1.2);
  }

  /* amount 0..1 — swells during passing periods (clock.isPassingPeriod()),
     louder in the hallway than inside a classroom. */
  setChatter(amount, indoor) {
    if (!this.chatterGain) return;
    const target = amount * (indoor ? 0.02 : 0.045);
    this.chatterGain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 1.5);
  }

  /* One-shot two-tone bell chime, fired once per period change. */
  ringBell() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (const [freq, delay] of [[880, 0], [660, 0.18]]) {
      const osc = this.ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t0 + delay);
      g.gain.linearRampToValueAtTime(0.06, t0 + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.9);
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(t0 + delay);
      osc.stop(t0 + delay + 1);
    }
  }

  suspend() { this.ctx && this.ctx.suspend(); }
  resume() { this.ctx && this.ctx.state === "suspended" && this.ctx.resume(); }

  /* Dances (design doc §23 Phase 6) — a small synthesized four-on-the-floor
     beat, same house style as everything else here (no licensed audio):
     a kick (short low sine thump) on every beat, a hi-hat (filtered noise
     tick) on the off-beats. Self-scheduling via setTimeout chained off
     ctx.currentTime rather than setInterval, so it can't drift or stack
     up extra beats if the tab was backgrounded. setDancing(false) tears
     the whole chain down; safe to call repeatedly. */
  setDancing(on) {
    if (!this.ctx) return;
    if (on) {
      if (this._danceTimer) return; // already playing
      const bpm = 128;
      const beatSec = 60 / bpm;
      let beat = 0;
      const scheduleBeat = () => {
        const t0 = this.ctx.currentTime;
        // kick on every beat
        const kick = this.ctx.createOscillator();
        kick.type = "sine";
        kick.frequency.setValueAtTime(120, t0);
        kick.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
        const kg = this.ctx.createGain();
        kg.gain.setValueAtTime(0.16, t0);
        kg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
        kick.connect(kg);
        kg.connect(this.ctx.destination);
        kick.start(t0);
        kick.stop(t0 + 0.2);
        // hi-hat on the off-beat
        if (beat % 2 === 1) {
          const hatBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate);
          const d = hatBuf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          const hat = this.ctx.createBufferSource();
          hat.buffer = hatBuf;
          const hf = this.ctx.createBiquadFilter();
          hf.type = "highpass";
          hf.frequency.value = 6000;
          const hg = this.ctx.createGain();
          hg.gain.setValueAtTime(0.05, t0);
          hg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
          hat.connect(hf);
          hf.connect(hg);
          hg.connect(this.ctx.destination);
          hat.start(t0);
        }
        beat++;
        this._danceTimer = setTimeout(scheduleBeat, beatSec * 1000);
      };
      scheduleBeat();
    } else if (this._danceTimer) {
      clearTimeout(this._danceTimer);
      this._danceTimer = null;
    }
  }

  /* Fire drills (design doc §21/§23 "Living MMO" — unscripted daily
     moments) — a synthesized two-tone alarm klaxon, same self-scheduling
     setTimeout-chain pattern as setDancing so it can't drift or stack.
     School-wide for the whole real day it's active, not zone-gated —
     matches a real fire alarm being audible throughout the building. */
  setFireDrill(on) {
    if (!this.ctx) return;
    if (on) {
      if (this._drillTimer) return;
      const toneMs = 500;
      let high = true;
      const scheduleTone = () => {
        const t0 = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        osc.type = "square";
        osc.frequency.value = high ? 960 : 720;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.05, t0);
        g.gain.setValueAtTime(0.05, t0 + toneMs / 1000 - 0.03);
        g.gain.linearRampToValueAtTime(0.0001, t0 + toneMs / 1000);
        osc.connect(g);
        g.connect(this.ctx.destination);
        osc.start(t0);
        osc.stop(t0 + toneMs / 1000);
        high = !high;
        this._drillTimer = setTimeout(scheduleTone, toneMs);
      };
      scheduleTone();
    } else if (this._drillTimer) {
      clearTimeout(this._drillTimer);
      this._drillTimer = null;
    }
  }
}
