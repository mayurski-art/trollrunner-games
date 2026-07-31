import { Chunk, CHUNK_X, CHUNK_Y, CHUNK_Z } from './Chunk.js';
import { BLOCKS } from './blocks.js';

const SAVE_KEY = 'tr3-save-v1';
const SAVE_VERSION = 1;
const CHUNK_LEN = CHUNK_X * CHUNK_Y * CHUNK_Z;
const PRESTIGE_KEY = 'tr3-prestige-v1';

// Prestige (New Game+ level) lives in its own key, separate from the main
// save, so starting a fresh island doesn't reset it.
export function getPrestige() {
  try {
    return Number(localStorage.getItem(PRESTIGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function setPrestige(level) {
  try { localStorage.setItem(PRESTIGE_KEY, String(level)); } catch { /* ignore */ }
}

// Run-length encode a chunk's flat block-id array — mostly-solid terrain
// compresses very well this way. Runs longer than 255 split into more pairs.
function rleEncode(bytes) {
  const pairs = [];
  let i = 0;
  while (i < bytes.length) {
    const value = bytes[i];
    let run = 1;
    while (i + run < bytes.length && bytes[i + run] === value && run < 255) run++;
    pairs.push(value, run);
    i += run;
  }
  return new Uint8Array(pairs);
}

function rleDecode(pairs, expectedLength) {
  const out = new Uint8Array(expectedLength);
  let o = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    const value = pairs[i], run = pairs[i + 1];
    out.fill(value, o, o + run);
    o += run;
  }
  return out;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function hasSave() {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

// The world-only slice (terrain + chests + wiring + hardmode) — shared by
// local saveGame() and Net.js's host->joiner snapshot handoff, since both
// need to hand a peer/future-session an exact copy of the live world.
export function buildWorldSnapshot(world) {
  const chunks = {};
  for (const [key, chunk] of world.chunks) {
    chunks[key] = bytesToBase64(rleEncode(chunk.data));
  }
  const chests = {};
  for (const [key, slots] of world.chests) chests[key] = slots;
  const levers = {};
  for (const [key, on] of world.leverStates) levers[key] = on;

  return {
    version: SAVE_VERSION,
    seed: world.seed,
    chunks,
    chests,
    levers,
    lamps: [...world.lamps],
    hardmode: world.hardmode,
    villagePos: world.villagePos,
    outpostPos: world.outpostPos,
    dungeonPos: world.dungeonPos,
    vaultPos: world.vaultPos,
    campPositions: world.campPositions,
  };
}

// Captures everything needed to resume: terrain (per-chunk RLE), chests,
// player state, inventory, and the day/night clock.
export function saveGame(game) {
  const data = {
    ...buildWorldSnapshot(game.world),
    savedAt: Date.now(),
    player: {
      pos: game.player.pos,
      spawn: game.player.spawn,
      hp: game.player.hp,
      hunger: game.player.hunger,
      yaw: game.player.yaw,
      pitch: game.player.pitch,
    },
    inventory: {
      slots: game.inventory.slots,
      armor: game.inventory.armor,
      selectedHotbar: game.inventory.selectedHotbar,
    },
    dayNight: {
      timeOfDay: game.dayNight.timeOfDay,
      day: game.dayNight.day,
    },
    quests: {
      index: game.quests.index,
      kills: game.quests.kills,
    },
    difficulty: game.difficulty,
  };

  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('Trollrreria 3D: save failed', err);
    return false;
  }
}

export function loadSaveData() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Trollrreria 3D: save data unreadable, ignoring', err);
    return null;
  }
}

// Populates a World's chunks from saved data instead of procedurally
// generating them — creates each saved chunk fresh rather than assuming it
// already exists, since chunks are no longer pre-created upfront (see
// World.js's chunk-streaming rewrite). Caller still needs to build meshes
// (rebuildDerivedMapsFromChunks + this function's own mesh pass do that).
export function applyWorldSave(world, saveData) {
  // Same defensive reset generateHomeRegion() does — the World instance is
  // reused across the page session, so any chunks streamed in during a
  // prior playthrough (without a page reload in between) shouldn't leak
  // into a freshly-loaded save.
  world._resetState();
  for (const [key, b64] of Object.entries(saveData.chunks)) {
    const [cx, cz] = key.split(',').map(Number);
    let chunk = world.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz, world);
      world.chunks.set(key, chunk);
    }
    chunk.data = rleDecode(base64ToBytes(b64), CHUNK_LEN);
  }
  world.chests = new Map(Object.entries(saveData.chests || {}).map(([k, v]) => [k, v]));
  world.leverStates = new Map(Object.entries(saveData.levers || {}));
  world.lamps = new Set(saveData.lamps || []);
  world.hardmode = !!saveData.hardmode;
  world.villagePos = saveData.villagePos || null;
  world.outpostPos = saveData.outpostPos || null;
  world.dungeonPos = saveData.dungeonPos || null;
  world.vaultPos = saveData.vaultPos || null;
  world.campPositions = saveData.campPositions || [];
  world.spawnPoint = saveData.player?.spawn || null;
  world.rebuildDerivedMapsFromChunks();
  // Lights/lava placed underground need their propagated levels BEFORE the
  // one real mesh build below (Chunk.buildMesh reads light per-face), same
  // as a fresh generateHomeRegion() would.
  world.lightSources.clear();
  for (const chunk of world.chunks.values()) {
    const wx = chunk.cx * CHUNK_X, wz = chunk.cz * CHUNK_Z;
    for (let lx = 0; lx < CHUNK_X; lx++) {
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        for (let y = 1; y < CHUNK_Y; y++) {
          const id = chunk.getLocal(lx, y, lz);
          if (id === BLOCKS.TORCH || id === BLOCKS.LAVA) {
            world.lightSources.add(world.posKey(wx + lx, y, wz + lz));
          }
        }
      }
    }
  }
  world.recomputeLight();
  for (const chunk of world.chunks.values()) {
    chunk.buildMesh(world.scene);
    world.meshedChunks.add(world.key(chunk.cx, chunk.cz));
    world.generatedChunks.add(world.key(chunk.cx, chunk.cz));
  }
}
