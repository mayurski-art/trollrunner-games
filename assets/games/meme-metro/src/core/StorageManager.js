// Persistence: high score, coin bank, unlocks, settings.
//
// Account scoping (fixes progress bleeding between accounts / guests):
//   - Logged in  -> cloud save in troll_game_saves (RLS: owner-only),
//                   mirrored into a local per-account cache key as a
//                   synchronous backup for beforeunload.
//   - Logged out -> guest progress is intentionally NEVER persisted --
//                   every boot as a guest starts from defaults. main.js
//                   shows a confirm-or-create-account gate before a guest
//                   actually loses a session (closing the window) via
//                   TrollrunnerAccounts.confirmGuestExit.
//   - The old pre-account global key (KEY) is migrated into the first
//     real account that logs in and then deleted.
//
// The constructor loads synchronous defaults so the game can boot
// immediately; call hydrate() right after construction to resolve the
// real account save once login state is known, then refresh anything
// already rendered with the synchronous defaults.

const KEY = 'trollDashMemeMetroSave_v1';
const GAME_ID = 'meme-metro';
const cloudCacheKey = userId => `${KEY}:cloud-cache:${userId}`;

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
    this.userId = null;
    this.data = structuredClone(DEFAULTS);
  }

  get isGuest() { return !this.userId; }
  // True once real progress exists worth confirming before it's discarded.
  get hasProgress() { return this.data.totalCoins > 0 || this.data.unlocked.length > 1 || this.data.highScore > 0; }

  loadLocal(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return {
        ...structuredClone(DEFAULTS),
        ...parsed,
        settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
      };
    } catch {
      return null;
    }
  }

  saveLocal(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // Private mode / quota — play on without persistence.
    }
  }

  async getSessionSafe() {
    try {
      return await window.TrollrunnerAccounts?.getSession?.();
    } catch {
      return null;
    }
  }

  async loadCloud(userId) {
    const sb = window.TrollrunnerAccounts?.getClient?.();
    if (!sb) return null;
    try {
      const { data, error } = await sb
        .from('troll_game_saves')
        .select('data, updated_at')
        .eq('user_id', userId)
        .eq('game_id', GAME_ID)
        .maybeSingle();
      if (error || !data) return null;
      return { save: data.data, updatedAt: new Date(data.updated_at).getTime() };
    } catch {
      return null;
    }
  }

  async saveCloud(userId, data) {
    const sb = window.TrollrunnerAccounts?.getClient?.();
    if (!sb) return false;
    try {
      const { error } = await sb.from('troll_game_saves').upsert({
        user_id: userId,
        game_id: GAME_ID,
        data,
        updated_at: new Date().toISOString(),
      });
      return !error;
    } catch {
      return false;
    }
  }

  async migrateLegacy(userId) {
    const legacy = this.loadLocal(KEY);
    if (!legacy) return null;
    await this.saveCloud(userId, legacy);
    this.saveLocal(cloudCacheKey(userId), legacy);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    return legacy;
  }

  // Resolves the real account/guest save. Call once after construction;
  // storage getters read live from this.data, so anything already
  // rendered with the synchronous guest-key defaults should be
  // re-rendered once this resolves.
  async hydrate() {
    const session = await this.getSessionSafe();
    if (!session) {
      this.userId = null;
      return this.data; // guests keep whatever's in memory -- never persisted
    }
    this.userId = session.userId;

    const migrated = await this.migrateLegacy(session.userId);
    if (migrated) {
      this.data = migrated;
      return this.data;
    }

    const cloud = await this.loadCloud(session.userId);
    const cached = this.loadLocal(cloudCacheKey(session.userId));
    if (cloud && (!cached || cloud.updatedAt >= (cached.savedAt || 0))) {
      this.data = cloud.save;
    } else if (cached) {
      this.data = cached;
      if (!cloud || cached.savedAt > cloud.updatedAt) void this.saveCloud(session.userId, cached);
    } else {
      this.data = structuredClone(DEFAULTS);
    }
    return this.data;
  }

  save() {
    this.data.savedAt = Date.now();
    if (!this.userId) return; // guests are never persisted
    // synchronous local backup first -- covers beforeunload, where the
    // async cloud write below may get killed mid-flight by the browser.
    this.saveLocal(cloudCacheKey(this.userId), this.data);
    void this.saveCloud(this.userId, this.data);
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

  async resetAll() {
    this.data = structuredClone(DEFAULTS);
    if (!this.userId) return;
    try { localStorage.removeItem(cloudCacheKey(this.userId)); } catch { /* ignore */ }
    const sb = window.TrollrunnerAccounts?.getClient?.();
    if (sb) {
      try {
        await sb.from('troll_game_saves').delete().eq('user_id', this.userId).eq('game_id', GAME_ID);
      } catch { /* ignore */ }
    }
  }
}
