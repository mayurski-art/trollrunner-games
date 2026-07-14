/* Trollrreria — world persistence: RLE + base64, saved to a real
   per-account cloud save when logged in. A full 1600x800 world
   compresses to a few hundred KB.

   Account scoping (fixes worlds bleeding between accounts / guests):
     - Logged in  -> cloud save in troll_game_saves (RLS: owner-only),
                     mirrored into a local per-account cache key as a
                     synchronous backup for beforeunload, where an async
                     network write may not finish in time.
     - Logged out -> guest progress is intentionally NEVER persisted --
                     every boot as a guest starts a fresh world. Games.js
                     shows a confirm-or-create-account gate before a
                     guest actually loses a run (closing the window,
                     quitting to title) via TrollrunnerAccounts.confirmGuestExit.
     - The old pre-account global key (SAVE_KEY) is migrated into the
       first real account that logs in and then deleted, so it can never
       leak into guest mode again. */

import { SAVE_KEY, SETTINGS_KEY } from "./defs.js";
import { rleEncode, rleDecode, u16ToB64, b64ToU16 } from "./util.js";
import { serializeQuests } from "./quests.js";

const GAME_ID = "trollrreria";
const cloudCacheKey = userId => `${SAVE_KEY}:cloud-cache:${userId}`;

function packLayer(arr) {
  return u16ToB64(rleEncode(arr));
}

function unpackLayer(b64, outLen, into) {
  const decoded = rleDecode(b64ToU16(b64), outLen);
  into.set(decoded);
}

/* Cached synchronously so beforeunload can decide guest-vs-account without
   an async round trip (TrollrunnerAccounts.getSession() also fetches the
   profile over the network, which is too slow for a page-unload window --
   the browser can kill the page before that promise ever resolves). Kept
   in sync via the auth-changed event dispatched on login/logout. */
let cachedUserId = null;
window.addEventListener("trollrunner:auth-changed", e => {
  cachedUserId = e.detail?.userId || null;
});

async function getSessionSafe() {
  try {
    const session = await window.TrollrunnerAccounts?.getSession?.();
    cachedUserId = session?.userId || null;
    return session;
  } catch {
    return null;
  }
}

// Synchronous -- reflects whichever session state was last resolved (at
// boot, or via the auth-changed event). Used to decide whether to gate an
// exit with "this won't be saved" without an async round trip.
export function isGuest() {
  return !cachedUserId;
}

function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !data.tiles) return null;
    return data;
  } catch (e) {
    console.warn("[trollrreria] corrupt save discarded:", key, e);
    return null;
  }
}

function writeLocal(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn("[trollrreria] local save failed:", key, e);
    return false;
  }
}

async function loadCloudSave(userId) {
  const sb = window.TrollrunnerAccounts?.getClient?.();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("troll_game_saves")
      .select("data, updated_at")
      .eq("user_id", userId)
      .eq("game_id", GAME_ID)
      .maybeSingle();
    if (error) { console.warn("[trollrreria] cloud load failed:", error); return null; }
    if (!data) return null;
    return { save: data.data, updatedAt: new Date(data.updated_at).getTime() };
  } catch (e) {
    console.warn("[trollrreria] cloud load threw:", e);
    return null;
  }
}

async function saveCloudSave(userId, data) {
  const sb = window.TrollrunnerAccounts?.getClient?.();
  if (!sb) return false;
  try {
    const { error } = await sb.from("troll_game_saves").upsert({
      user_id: userId,
      game_id: GAME_ID,
      data,
      updated_at: new Date().toISOString(),
    });
    if (error) console.warn("[trollrreria] cloud save failed:", error);
    return !error;
  } catch (e) {
    console.warn("[trollrreria] cloud save threw:", e);
    return false;
  }
}

export async function saveGame(game) {
  const w = game.world;
  let data;
  try {
    data = {
      v: 1,
      w: w.w, h: w.h,
      seedStr: game.seedStr,
      time: game.time,
      dayCount: game.dayCount,
      trollMoon: game.trollMoon,
      tiles: packLayer(w.tiles),
      walls: packLayer(w.walls),
      liquid: packLayer(w.liquid),
      liquidType: packLayer(w.liquidType),
      wires: packLayer(w.wires),
      explored: game.explored ? packLayer(game.explored) : null,
      chests: [...w.chests.entries()].map(([k, c]) => [k, c.items]),
      trees: w.trees,
      spawn: game.spawn,
      stats: game.stats,
      flags: game.flags,
      quests: serializeQuests(game.quests),
      player: game.player ? {
        x: game.player.x, y: game.player.y,
        hp: game.player.hp, maxHp: game.player.maxHp,
        hunger: game.player.hunger, maxHunger: game.player.maxHunger,
      } : null,
      inv: game.inventory ? game.inventory.serialize() : null,
      animals: game.enemies
        ? game.enemies.filter(e => e.tamed && !e.dead).map(e => ({
            type: e.type, x: e.cx, y: e.y + e.h, baby: !!e.baby, growTimer: e.growTimer, hp: e.hp,
          }))
        : [],
      savedAt: Date.now(),
    };
  } catch (e) {
    console.warn("[trollrreria] save serialize failed:", e);
    return false;
  }

  // Uses the synchronously-cached user id (kept fresh via boot + the
  // auth-changed event) rather than re-awaiting getSession() here -- an
  // async round trip is too slow to trust during beforeunload.
  if (cachedUserId) {
    // synchronous local backup first -- covers beforeunload, where the
    // async cloud write below may get killed mid-flight by the browser.
    writeLocal(cloudCacheKey(cachedUserId), data);
    return saveCloudSave(cachedUserId, data);
  }
  // Guests are never persisted -- see confirmGuestExit in main.js, which
  // gates any action that would actually discard this run.
  return false;
}

/* One-time migration of the pre-account global save into whichever real
   account first logs in after this update, so nobody loses progress --
   then the legacy key is deleted so it can never leak into guest mode. */
async function migrateLegacySave(userId) {
  const legacy = readLocal(SAVE_KEY);
  if (!legacy) return null;
  await saveCloudSave(userId, legacy);
  writeLocal(cloudCacheKey(userId), legacy);
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  return legacy;
}

export async function loadSaveData() {
  const session = await getSessionSafe();
  if (!session) return null; // guests always start fresh -- never persisted

  const migrated = await migrateLegacySave(session.userId);
  if (migrated) return migrated;

  const cloud = await loadCloudSave(session.userId);
  const cached = readLocal(cloudCacheKey(session.userId));
  // prefer whichever is newer -- covers a beforeunload cloud write that
  // never finished, where the local cache is ahead of what's in Supabase.
  if (cloud && (!cached || cloud.updatedAt >= (cached.savedAt || 0))) return cloud.save;
  if (cached) {
    if (!cloud || cached.savedAt > cloud.updatedAt) void saveCloudSave(session.userId, cached);
    return cached;
  }
  return null;
}

/* Restore layers into an existing world instance (same dimensions). */
export function applyWorldLayers(world, data) {
  const n = world.w * world.h;
  unpackLayer(data.tiles, n, world.tiles);
  unpackLayer(data.walls, n, world.walls);
  unpackLayer(data.liquid, n, world.liquid);
  unpackLayer(data.liquidType, n, world.liquidType);
  if (data.wires) unpackLayer(data.wires, n, world.wires);
  world.chests = new Map((data.chests || []).map(([k, items]) => [k, { items }]));
  world.trees = data.trees || [];
  world.damage.clear();
  world.dirtyChunks.clear();
  world.liquidActive.clear();
  world.sandActive.clear();
  world.rebuildTopSolid();
}

export async function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  const session = await getSessionSafe();
  if (!session) return; // nothing persisted for guests to clear
  try { localStorage.removeItem(cloudCacheKey(session.userId)); } catch { /* ignore */ }
  const sb = window.TrollrunnerAccounts?.getClient?.();
  if (sb) {
    try {
      await sb.from("troll_game_saves").delete().eq("user_id", session.userId).eq("game_id", GAME_ID);
    } catch { /* ignore */ }
  }
}

/* -------------------------------------------------------------- settings */
export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch (e) { return {}; }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}
