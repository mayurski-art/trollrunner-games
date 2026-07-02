// Audio hook layer. Every game event calls play(name); events map to files
// in assets/games/meme-metro/audio/ once real assets exist. Until a file is
// registered the call is a silent no-op, so gameplay code never checks.

const EVENTS = [
  'coin', 'jump', 'slide', 'laneSwitch', 'powerup',
  'shieldBreak', 'crash', 'click', 'gameOver', 'music',
];

export class AudioManager {
  constructor(storage) {
    this.storage = storage;
    this.sources = {}; // eventName -> HTMLAudioElement, registered later
    for (const name of EVENTS) this.sources[name] = null;
  }

  register(name, url) {
    const el = new Audio(url);
    el.preload = 'auto';
    this.sources[name] = el;
  }

  play(name) {
    if (!this.storage.settings.sfx) return;
    const el = this.sources[name];
    if (!el) return;
    el.currentTime = 0;
    el.play().catch(() => {});
  }
}
