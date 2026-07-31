import { buildFullSaveData } from '../world/Save.js';

// Phase 9 — cloud saves. Reuses the exact same Supabase project Net.js's
// co-op already talks to (see Net.js's own comment) and the exact same
// save payload shape localStorage saves use (Save.buildFullSaveData) — a
// cloud save is a save.js payload with a different destination, not a new
// format. No accounts/auth: a player picks/enters a 5-letter code (same
// UX as a co-op room code) that becomes the row key. Requires the
// tr3_cloud_saves table — see docs/trollrreria3d-cloud-saves.sql, which
// the site owner runs once in the Supabase SQL editor.
const SUPABASE_URL = 'https://tjsyhfplxjtakdfkpdtg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqc3loZnBseGp0YWtkZmtwZHRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzOTc0ODksImV4cCI6MjA5MTk3MzQ4OX0.xLUcPUUguRBQttNwiIRWJHxjJjLqrQDMu4Ubsk5yZoQ';
const TABLE = 'tr3_cloud_saves';

export function makeCloudCode() {
  const abc = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

// Upsert-by-code via PostgREST directly (no window.supabase JS client
// dependency — Net.js's SupabaseTransport needs realtime channels, this
// only needs a single REST call either way).
export async function cloudSaveGame(game, code) {
  const data = buildFullSaveData(game);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ code: code.toUpperCase(), data, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch (err) {
    console.warn('Trollrreria 3D: cloud save failed', err);
    return false;
  }
}

// Returns the raw save-data object (same shape Save.loadSaveData() would
// return locally) or null — caller decides what to do with it (see
// Game.cloudLoadGame, which writes it into localStorage and reuses the
// existing 'continue' restore flow rather than duplicating it).
export async function cloudLoadGame(code) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE}?code=eq.${encodeURIComponent(code.toUpperCase())}&select=data`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.data ?? null;
  } catch (err) {
    console.warn('Trollrreria 3D: cloud load failed', err);
    return null;
  }
}
