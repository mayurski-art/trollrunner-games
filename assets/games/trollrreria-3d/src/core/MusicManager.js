// Procedural ambient music via the Web Audio API — no audio files needed,
// matches the 2D game's "generative music" phase. A quiet two-note drone
// plus sparse randomly-timed melodic notes drawn from a day/night scale.
const DAY_SCALE = [261.63, 293.66, 329.63, 392.0, 440.0]; // C major pentatonic
const NIGHT_SCALE = DAY_SCALE.map((f) => f * 0.66); // lower + slightly darker

export class MusicManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.mode = 'day';
    this.noteTimer = null;
  }

  // Must be called from a user-gesture handler (browser autoplay policy).
  init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.25 : 0;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.enabled ? 0.35 : 0;
    this.sfxGain.connect(this.ctx.destination);
    this._startDrone();
    this._scheduleNextNote();
  }

  setMode(mode) {
    this.mode = mode;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(on ? 0.25 : 0, this.ctx.currentTime + 0.4);
    }
    if (this.sfxGain) {
      this.sfxGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.sfxGain.gain.linearRampToValueAtTime(on ? 0.35 : 0, this.ctx.currentTime + 0.1);
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  suspend() {
    this.ctx?.suspend();
  }

  resumeCtx() {
    this.ctx?.resume();
  }

  _startDrone() {
    for (const freq of [55, 82.5]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.035;
      osc.connect(gain).connect(this.master);
      osc.start();
    }
  }

  _scale() {
    return this.mode === 'night' ? NIGHT_SCALE : DAY_SCALE;
  }

  _playNote() {
    const scale = this._scale();
    const octaveDown = Math.random() < 0.3 ? 0.5 : 1;
    const freq = scale[Math.floor(Math.random() * scale.length)] * octaveDown;

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 1.2);
    gain.gain.linearRampToValueAtTime(0, now + 4);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 4.2);
  }

  _scheduleNextNote() {
    const delay = 2200 + Math.random() * 3200;
    this.noteTimer = setTimeout(() => {
      if (this.enabled && this.ctx?.state === 'running') this._playNote();
      this._scheduleNextNote();
    }, delay);
  }

  // --- SFX: short synthesized one-shots, same no-audio-files approach as
  // the ambient music. Silently no-ops if the context isn't ready yet
  // (e.g. called before the user-gesture init()).

  _tone(freq, duration, { type = 'sine', volume = 0.25, glideTo = null } = {}) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (glideTo) osc.frequency.linearRampToValueAtTime(glideTo, now + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  _noiseBurst(duration, filterFreq, volume = 0.3) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const bufferSize = Math.ceil(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    noise.connect(filter).connect(gain).connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + duration);
  }

  playMine() {
    this._noiseBurst(0.09, 900, 0.25);
  }

  playPlace() {
    this._tone(320, 0.06, { type: 'square', volume: 0.15, glideTo: 480 });
  }

  playHit() {
    this._noiseBurst(0.05, 1800, 0.3);
    this._tone(180, 0.08, { type: 'sawtooth', volume: 0.18, glideTo: 90 });
  }

  playHurt() {
    this._tone(400, 0.18, { type: 'sawtooth', volume: 0.22, glideTo: 160 });
  }

  playPickup() {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    this._tone(520, 0.06, { type: 'triangle', volume: 0.15 });
    setTimeout(() => this._tone(780, 0.08, { type: 'triangle', volume: 0.15 }), 60);
  }

  playQuestComplete() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => setTimeout(() => this._tone(f, 0.25, { type: 'triangle', volume: 0.2 }), i * 90));
  }

  playBossRoar() {
    this._noiseBurst(0.5, 300, 0.3);
    this._tone(90, 0.6, { type: 'sawtooth', volume: 0.25, glideTo: 55 });
  }

  playFootstep() {
    this._noiseBurst(0.05, 500, 0.08);
  }

  dispose() {
    clearTimeout(this.noteTimer);
    this.ctx?.close();
  }
}
