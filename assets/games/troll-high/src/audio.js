/* Troll High — base ambience layer (Phase 2 v1).
   A single soft room-tone drone, synthesized (no licensed audio, matching
   Trollrreria's house style). Full layered ambience — hall chatter, bells,
   period-driven layers — is later phase scope (§16 of the design doc);
   this just proves the hook exists and doesn't leave the world silent. */

export class Ambience {
  constructor() {
    this.ctx = null;
    this.gain = null;
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
  }

  /* Indoor rooms hum a little louder/duller than the open hallway. */
  setIndoor(indoor) {
    if (!this.gain) return;
    const target = indoor ? 0.07 : 0.045;
    this.gain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 1.2);
  }

  suspend() { this.ctx && this.ctx.suspend(); }
  resume() { this.ctx && this.ctx.state === "suspended" && this.ctx.resume(); }
}
