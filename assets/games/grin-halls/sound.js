/* Grin Halls — Phase 3 sound design.
   Everything is synthesized with WebAudio (oscillators, filtered noise) —
   no audio files to fetch, matching the hermetic/no-CDN approach the rest
   of the game uses for its procedural textures. AudioContext is created
   lazily on the first call after a user gesture (browsers block audio
   autoplay otherwise); every public method is a safe no-op before that. */

export class GrinHallsSound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.ambientNodes = null;
    this._footstepTimer = 0;
    this._lastChaseState = "patrol";
  }

  unlock() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(this.ctx.destination);
    this._startAmbient();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.7;
  }

  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _startAmbient() {
    const ctx = this.ctx;
    const hum = ctx.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 54;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.05;
    hum.connect(humGain).connect(this.master);
    hum.start();

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this._noiseBuffer(2);
    noiseSrc.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 400;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.025;
    noiseSrc.connect(noiseFilter).connect(noiseGain).connect(this.master);
    noiseSrc.start();

    this.ambientNodes = { hum, humGain, noiseFilter, noiseGain };
  }

  setDistortion(level) {
    if (!this.ambientNodes) return;
    this.ambientNodes.hum.frequency.setTargetAtTime(54 - level * 3, this.ctx.currentTime, 0.5);
    this.ambientNodes.noiseGain.gain.setTargetAtTime(0.025 + level * 0.01, this.ctx.currentTime, 0.5);
  }

  footstep() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.08);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 180 + Math.random() * 60;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
  }

  pickup() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1040, ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.22, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
  }

  levelAdvance() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    [0, 0.12, 0.24].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 260 * Math.pow(1.26, i);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.16, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.5);
      osc.connect(gain).connect(this.master);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.55);
    });
  }

  escapeFanfare() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    [0, 0.15, 0.3, 0.5].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = [392, 494, 587, 784][i];
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.7);
      osc.connect(gain).connect(this.master);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.75);
    });
  }

  chaseStinger() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(140, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.6);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.28, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.75);
  }

  caughtBuzz() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.6);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 800;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.65);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
  }

  /** Call once per frame with movement state + entity chase state. */
  tick(dt, { moving, sprinting, entityState }) {
    if (!this.ctx) return;
    if (moving) {
      this._footstepTimer -= dt;
      if (this._footstepTimer <= 0) {
        this.footstep();
        this._footstepTimer = sprinting ? 0.26 : 0.42;
      }
    } else {
      this._footstepTimer = 0;
    }
    if (entityState === "chase" && this._lastChaseState !== "chase") this.chaseStinger();
    this._lastChaseState = entityState;
  }
}
