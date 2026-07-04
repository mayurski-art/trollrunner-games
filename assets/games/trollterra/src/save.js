/* TrollTerra — world persistence: RLE + base64 into localStorage.
   A full 1600x800 world compresses to a few hundred KB, well under quota. */

import { SAVE_KEY, SETTINGS_KEY } from "./defs.js";
import { rleEncode, rleDecode, u16ToB64, b64ToU16 } from "./util.js";

function packLayer(arr) {
  return u16ToB64(rleEncode(arr));
}

function unpackLayer(b64, outLen, into) {
  const decoded = rleDecode(b64ToU16(b64), outLen);
  into.set(decoded);
}

export function saveGame(game) {
  const w = game.world;
  try {
    const data = {
      v: 1,
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
      player: game.player ? {
        x: game.player.x, y: game.player.y,
        hp: game.player.hp, maxHp: game.player.maxHp,
      } : null,
      inv: game.inventory ? game.inventory.serialize() : null,
      savedAt: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn("[trollterra] save failed:", e);
    return false;
  }
}

export function loadSaveData() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !data.tiles) return null;
    return data;
  } catch (e) {
    console.warn("[trollterra] corrupt save discarded:", e);
    return null;
  }
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

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
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
