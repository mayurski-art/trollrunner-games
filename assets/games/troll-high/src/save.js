/* Troll High — cloud persistence via the shared troll_game_saves table
   (assets/supabase/troll_game_saves.sql in the main site repo — already
   deployed, already used by Trollrreria). One row per (user_id, game_id),
   RLS owner-only, so no new migration is needed for this project.

   Simpler than Trollrreria's save.js: login is required here (design doc
   decision 3), so there's no guest-mode branching or legacy-key migration
   to carry. */

const GAME_ID = "troll-high";
const LOCAL_CACHE_KEY_PREFIX = "th_cloud_cache:";

function client() {
  return window.TrollrunnerAccounts?.getClient?.();
}

function writeLocalCache(userId, data) {
  try { localStorage.setItem(LOCAL_CACHE_KEY_PREFIX + userId, JSON.stringify(data)); }
  catch (e) { /* ignore — best-effort backup only */ }
}
function readLocalCache(userId) {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY_PREFIX + userId);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

export async function loadSave(userId) {
  const sb = client();
  if (!sb) return readLocalCache(userId);
  try {
    const { data, error } = await sb
      .from("troll_game_saves")
      .select("data, updated_at")
      .eq("user_id", userId)
      .eq("game_id", GAME_ID)
      .maybeSingle();
    if (error) { console.warn("[troll-high] cloud load failed:", error); return readLocalCache(userId); }
    if (!data) return readLocalCache(userId);
    const cached = readLocalCache(userId);
    // prefer whichever is newer — covers a beforeunload write that never
    // finished, where the local cache is ahead of what made it to Supabase
    const cloudTime = new Date(data.updated_at).getTime();
    if (cached && (cached.savedAt || 0) > cloudTime) return cached;
    return data.data;
  } catch (e) {
    console.warn("[troll-high] cloud load threw:", e);
    return readLocalCache(userId);
  }
}

/* Fire-and-forget is fine for periodic autosave; awaited on real exit
   points (visibilitychange) where we still want the local cache written
   synchronously first in case the network write gets killed mid-flight. */
export async function saveGame(userId, {
  zoneId, x, y, foundKeys, studentId, enrolledAt, highScores, orientationDone, elective, dailyTasksDay, dailyFlags, cards,
  visitedZones, visitDays, lunchesBought, tradesCompleted, giftsGiven, giftsReceived, npcRelations, bedroomEquipped, photos, clubMember,
  zoneVisitCounts, claimedSpots, club, graduatedAt,
}) {
  const data = {
    v: 1, zoneId, x, y, foundKeys, studentId, enrolledAt, highScores, orientationDone, elective, dailyTasksDay, dailyFlags, cards,
    visitedZones, visitDays, lunchesBought, tradesCompleted, giftsGiven, giftsReceived, npcRelations, bedroomEquipped, photos, clubMember,
    zoneVisitCounts, claimedSpots, club, graduatedAt, savedAt: Date.now(),
  };
  writeLocalCache(userId, data);
  const sb = client();
  if (!sb) return false;
  try {
    const { error } = await sb.from("troll_game_saves").upsert({
      user_id: userId,
      game_id: GAME_ID,
      data,
      updated_at: new Date().toISOString(),
    });
    if (error) console.warn("[troll-high] cloud save failed:", error);
    return !error;
  } catch (e) {
    console.warn("[troll-high] cloud save threw:", e);
    return false;
  }
}
