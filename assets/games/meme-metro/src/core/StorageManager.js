// localStorage persistence: high score, coin bank, unlocks, settings.

const KEY = 'trollDashMemeMetroSave_v1';

const DEFAULTS = {
  highScore: 0,
  totalCoins: 0,
  selectedCharacter: 'trollface',
  unlocked: ['trollface'],
  settings: {
    music: true,
    sfx: true,
    cameraShake: true,
    quality: 'high',
    controlHints: true,
  },
};

export class StorageManager {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULTS);
      const parsed = JSON.parse(raw);
      return {
        ...structuredClone(DEFAULTS),
        ...parsed,
        settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
      };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Private mode / quota — play on without persistence.
    }
  }

  get highScore() { return this.data.highScore; }
  get totalCoins() { return this.data.totalCoins; }
  get settings() { return this.data.settings; }
  get selectedCharacter() { return this.data.selectedCharacter; }

  isUnlocked(id) { return this.data.unlocked.includes(id); }

  // Deducts the price and unlocks; false if already owned or short on coins.
  unlockCharacter(id, price) {
    if (this.isUnlocked(id) || this.data.totalCoins < price) return false;
    this.data.totalCoins -= price;
    this.data.unlocked.push(id);
    this.save();
    return true;
  }

  selectCharacter(id) {
    if (!this.isUnlocked(id)) return false;
    this.data.selectedCharacter = id;
    this.save();
    return true;
  }

  // Returns true when the run set a new best.
  recordRun({ score, coins }) {
    const newBest = score > this.data.highScore;
    if (newBest) this.data.highScore = score;
    this.data.totalCoins += coins;
    this.save();
    return newBest;
  }

  resetAll() {
    this.data = structuredClone(DEFAULTS);
    this.save();
  }
}
