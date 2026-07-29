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

  dispose() {
    clearTimeout(this.noteTimer);
    this.ctx?.close();
  }
}
