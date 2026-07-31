import { Chunk, CHUNK_X, CHUNK_Y, CHUNK_Z } from './Chunk.js';
import { BLOCKS, MINEABLE } from './blocks.js';
import { makeFractalNoise2D, makeNoise2D } from './noise.js';
import { placeVillage, OUTPOST_OFFSETS, CAMP_OFFSET_SETS } from './Village.js';
import { placeDungeon } from './Dungeon.js';
import { placeVault } from './Vault.js';

const NEIGHBOR_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// True infinite terrain: chunks generate on demand as the player walks
// (streamChunks, called from Game._loop) and their MESH gets dropped once
// far enough away — block data is kept forever once generated so an edit
// persists and walking back doesn't regenerate differently. This replaced
// an earlier "one big fixed grid" approach (5x5 -> 9x9 -> 25x25 -> 21x21)
// that kept reading as small/bounded no matter how big the grid got: it
// was still finite, so there was always an edge to eventually walk into.
export const CHUNK_LOAD_RADIUS = 6; // chunks kept generated+meshed around the player
export const CHUNK_UNLOAD_RADIUS = 9; // farther than this, a chunk's mesh gets dropped (data kept)
const MAX_NEW_CHUNKS_PER_TICK = 3; // throttled so fast movement/teleport doesn't stutter

const BASE_HEIGHT = 20;
const AMPLITUDE = 14;
const CROP_GROWTH_SECONDS = 45;

// The village/outpost/dungeon/vault/camp cluster (and spawn) live in a
// fixed "home region" around a fixed origin rather than being scattered
// across infinite terrain — keeps the whole quest/merchant/villager/
// leaderboard system (which assumes ONE known village etc.) unchanged.
// Terrain OUTSIDE this region is fully infinite/streamed like everywhere
// else; the home region is just where the hand-placed landmarks happen to
// live, not a special terrain shape (no falloff/island concept anymore).
const HOME_ORIGIN_X = 0;
const HOME_ORIGIN_Z = 0;
const HOME_REGION_RADIUS = 130; // covers the vault's farthest ring candidate (108) + margin

export const BIOMES = { FOREST: 'forest', DESERT: 'desert', SNOW: 'snow' };

export class World {
  constructor(scene, seed = 1337) {
    this.scene = scene;
    this.seed = seed;
    this.heightNoise = makeFractalNoise2D(seed);
    this.treeNoise = makeNoise2D(seed + 501);
    this.biomeNoise = makeNoise2D(seed + 2003);
    this._resetState();
  }

  // Clears every chunk/derived-map/structure-position back to a blank
  // slate. The World instance itself lives for the whole page session
  // (see Game.js), reused across "New Island" clicks — without this, a
  // second generateHomeRegion() call would find the home region's chunks
  // already marked generated (from the FIRST island) and skip regenerating
  // them, leaving the "new" island built on the old one's leftover terrain.
  _resetState() {
    for (const chunk of this.chunks?.values() ?? []) {
      if (chunk.mesh) {
        this.scene.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
      }
    }
    this.chunks = new Map(); // "cx,cz" -> Chunk, created lazily as the player explores
    this.generatedChunks = new Set(); // "cx,cz" whose terrain/veins/caves/vegetation are already filled in
    this.meshedChunks = new Set(); // "cx,cz" currently built + in the scene
    this.heightMap = new Map(); // "x,z" -> topmost solid y (only populated for generated chunks)
    this.biomeMap = new Map(); // "x,z" -> BIOMES.*
    this.chests = new Map(); // "x,y,z" -> Array(27) of {id,count}|null
    this.leverStates = new Map(); // "x,y,z" -> boolean (on/off)
    this.lamps = new Set(); // "x,y,z" of placed lamps (either state)
    this._inPowerRecompute = false;
    this.hardmode = false;
    this.villagePos = null;
    this.outpostPos = null;
    this.dungeonPos = null;
    this.vaultPos = null;
    this.campPositions = []; // small far-out single-hut camps — found by exploring, not fast-travel waypoints
    this.spawnPoint = null;
    this.crops = new Map(); // "x,y,z" -> seconds remaining until WHEAT_CROP_MATURE
    this.lightSources = new Set(); // "x,y,z" of every placed TORCH/LAVA block
    this.lightMap = new Map(); // "x,y,z" -> 0-15 propagated light level (see recomputeLight)
  }

  key(cx, cz) {
    return `${cx},${cz}`;
  }

  chunkAt(cx, cz) {
    return this.chunks.get(this.key(cx, cz));
  }

  worldToChunk(x, z) {
    return { cx: Math.floor(x / CHUNK_X), cz: Math.floor(z / CHUNK_Z) };
  }

  // Low-frequency regions so biomes read as continuous patches, not noise.
  getBiome(x, z) {
    const n = this.biomeNoise(x * 0.012, z * 0.012);
    if (n < 0.35) return BIOMES.DESERT;
    if (n > 0.65) return BIOMES.SNOW;
    return BIOMES.FOREST;
  }

  // Pure noise-based height — no falloff/center/void concept, so terrain is
  // the same continuous rolling hills everywhere, forever, in every
  // direction. Real mountains come from the noise amplitude itself now,
  // not from a "closer to the center = taller" shape.
  columnHeight(x, z) {
    const n = this.heightNoise(x, z); // 0..1
    const h = Math.round(BASE_HEIGHT + (n - 0.5) * AMPLITUDE * 2);
    return Math.max(2, Math.min(CHUNK_Y - 6, h));
  }

  // Creates an empty Chunk object at (cx,cz) if one doesn't exist yet —
  // does NOT fill in terrain (see ensureChunkGenerated for that). Used so
  // a cave/vein carve reaching into a not-yet-generated neighbor always
  // has somewhere real to write, instead of throwing.
  ensureChunkObject(cx, cz) {
    const key = this.key(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz, this);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  // Fills terrain/ore veins/caves/vegetation for one chunk, if not already
  // done. Marks itself generated BEFORE actually generating so a cave worm
  // that reaches back into this same chunk mid-generation (rare, but
  // possible near the edge of the area a worm can reach) can't recurse.
  ensureChunkGenerated(cx, cz) {
    const key = this.key(cx, cz);
    if (this.generatedChunks.has(key)) return this.chunkAt(cx, cz);
    this.generatedChunks.add(key);
    const chunk = this.ensureChunkObject(cx, cz);
    this._generateChunkTerrain(chunk);
    this._generateChunkOreVeins(chunk);
    this._generateChunkCaves(chunk);
    this._generateChunkVegetation(chunk);
    return chunk;
  }

  _generateChunkTerrain(chunk) {
    const wx = chunk.cx * CHUNK_X, wz = chunk.cz * CHUNK_Z;
    for (let lx = 0; lx < CHUNK_X; lx++) {
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        const x = wx + lx, z = wz + lz;
        const top = this.columnHeight(x, z);
        this.heightMap.set(`${x},${z}`, top);
        const biome = this.getBiome(x, z);
        this.biomeMap.set(`${x},${z}`, biome);
        const topBlock = top <= 4 ? BLOCKS.SAND
          : biome === BIOMES.DESERT ? BLOCKS.SAND
          : biome === BIOMES.SNOW ? BLOCKS.SNOW
          : BLOCKS.GRASS;

        for (let y = 0; y <= top; y++) {
          let id;
          if (y === 0) id = BLOCKS.BEDROCK;
          else if (y === top) id = topBlock;
          else if (y > top - 3) id = biome === BIOMES.DESERT && top > 4 ? BLOCKS.SAND : BLOCKS.DIRT;
          else id = BLOCKS.STONE; // ore/gemstone come from placeOreVeins, not per-block noise
          chunk.setLocal(lx, y, lz, id);
        }
      }
    }
  }

  // Vein clusters scoped to just this chunk — the per-world "N attempts
  // across the whole map" approach doesn't work once the map has no edge,
  // so each chunk rolls its own small handful of attempts as it streams in.
  _generateChunkOreVeins(chunk) {
    const wx = chunk.cx * CHUNK_X, wz = chunk.cz * CHUNK_Z;
    for (let i = 0; i < 2; i++) {
      const x = wx + Math.floor(Math.random() * CHUNK_X);
      const z = wz + Math.floor(Math.random() * CHUNK_Z);
      const top = this.heightMap.get(`${x},${z}`);
      if (top === undefined || top < 8) continue;
      const isGem = Math.random() < 0.28; // gemstone is the deeper, rarer tier
      const minBelowSurface = isGem ? 6 : 3;
      const range = top - minBelowSurface - 2;
      if (range < 1) continue;
      const y = 2 + Math.floor(Math.random() * range);
      const size = isGem ? 3 + Math.floor(Math.random() * 3) : 4 + Math.floor(Math.random() * 5);
      this.carveVein(x, y, z, isGem ? BLOCKS.GEMSTONE : BLOCKS.ORE, size);
    }
  }

  carveVein(cx, cy, cz, blockId, size) {
    let x = cx, y = cy, z = cz;
    for (let i = 0; i < size; i++) {
      const bx = Math.round(x), by = Math.round(y), bz = Math.round(z);
      if (this.getBlock(bx, by, bz) === BLOCKS.STONE) this.setBlockRaw(bx, by, bz, blockId);
      x += Math.random() * 2 - 1;
      y += (Math.random() * 2 - 1) * 0.6;
      z += Math.random() * 2 - 1;
    }
  }

  // A short worm-style tunnel scoped to roughly this chunk's own footprint
  // (most chunks get none — see the coin-flip below). May carve into an
  // already-loaded neighbor chunk (setBlockRaw handles that safely) but
  // won't force-generate one that doesn't exist yet, so generation can
  // never cascade outward unboundedly. Neighbors streamed in later get
  // their own independent worms, so cave coverage stays reasonable without
  // needing every tunnel to perfectly connect across chunk boundaries.
  _generateChunkCaves(chunk) {
    if (Math.random() < 0.6) return;
    const wx = chunk.cx * CHUNK_X, wz = chunk.cz * CHUNK_Z;
    let x = wx + Math.random() * CHUNK_X;
    let z = wz + Math.random() * CHUNK_Z;
    const top = this.heightMap.get(`${Math.round(x)},${Math.round(z)}`);
    if (top === undefined || top < 9) return;
    let y = 2 + Math.random() * Math.max(1, top - 8);
    let dx = Math.random() * 2 - 1, dy = (Math.random() * 2 - 1) * 0.3, dz = Math.random() * 2 - 1;
    let len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    let radius = 1.5 + Math.random() * 1.5;
    const steps = 20 + Math.floor(Math.random() * 40);

    for (let s = 0; s < steps; s++) {
      this.carveBlob(x, y, z, radius);
      if (y < 8 && Math.random() < 0.04) this.placeLavaSplash(Math.round(x), Math.round(y), Math.round(z));

      dx += (Math.random() * 2 - 1) * 0.3;
      dy += (Math.random() * 2 - 1) * 0.15;
      dz += (Math.random() * 2 - 1) * 0.3;
      len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      x += dx; y += dy; z += dz;
      radius = Math.max(1, Math.min(3, radius + (Math.random() * 2 - 1) * 0.2));

      const colTop = this.heightMap.get(`${Math.round(x)},${Math.round(z)}`);
      if (colTop === undefined) break; // wandered into an ungenerated chunk — stop rather than force it
      if (y < 2 || y > colTop - 4) break; // never breach bedrock or the surface
    }
  }

  carveBlob(cx, cy, cz, radius) {
    const r = Math.ceil(radius);
    const r2 = radius * radius;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          const x = Math.round(cx + dx), y = Math.round(cy + dy), z = Math.round(cz + dz);
          if (y < 2) continue; // never touch bedrock
          const id = this.getBlock(x, y, z);
          if (id === BLOCKS.AIR || id === BLOCKS.BEDROCK) continue;
          this.setBlockRaw(x, y, z, BLOCKS.AIR);
        }
      }
    }
  }

  // A small puddle of lava at the bottom of a deep cave pocket — real
  // hazard, not just decoration (see Game._loop's lava contact-damage
  // check). Sparse and low-elevation-only so it never turns up somewhere
  // the player can stumble into blind on their first trip underground.
  placeLavaSplash(cx, cy, cz) {
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1]]) {
      const x = cx + dx, y = cy - 1, z = cz + dz;
      if (this.getBlock(x, y, z) === BLOCKS.AIR && this.getBlock(x, y - 1, z) !== BLOCKS.AIR) {
        this.setBlockRaw(x, y, z, BLOCKS.LAVA);
        this.lightSources.add(this.posKey(x, y, z)); // registered directly — scattered everywhere, not near a single structure site
      }
    }
  }

  _generateChunkVegetation(chunk) {
    const wx = chunk.cx * CHUNK_X, wz = chunk.cz * CHUNK_Z;
    for (let lx = 0; lx < CHUNK_X; lx++) {
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        const x = wx + lx, z = wz + lz;
        const top = this.heightMap.get(`${x},${z}`);
        if (top === undefined || top < 6) continue;
        const biome = this.biomeMap.get(`${x},${z}`);
        const surface = this.getBlock(x, top, z);
        if (biome === BIOMES.DESERT) {
          if (surface !== BLOCKS.SAND) continue;
          if (this.treeNoise(x * 0.9, z * 0.9) < 0.96) continue;
          this.placeCactus(x, top + 1, z);
        } else {
          const threshold = biome === BIOMES.SNOW ? 0.97 : 0.93;
          if (surface !== BLOCKS.GRASS && surface !== BLOCKS.SNOW) continue;
          if (this.treeNoise(x * 0.9, z * 0.9) < threshold) continue;
          this.placeTree(x, top + 1, z);
        }
      }
    }
  }

  // One-time setup at game start: the fixed home region (spawn + every
  // hand-placed landmark), generated eagerly and synchronously — same as
  // the old whole-world generate() used to do, just scoped to a bounded
  // area instead of the entire (now unbounded) world. Terrain streaming
  // (see streamChunks) takes over for everywhere else once the player
  // starts walking.
  generateHomeRegion() {
    this._resetState(); // safe to call repeatedly — see _resetState's own comment ("New Island" reuses this same World instance)
    const half = Math.ceil(HOME_REGION_RADIUS / CHUNK_X) + 1;
    const { cx: originCx, cz: originCz } = this.worldToChunk(HOME_ORIGIN_X, HOME_ORIGIN_Z);
    for (let cx = originCx - half; cx <= originCx + half; cx++) {
      for (let cz = originCz - half; cz <= originCz + half; cz++) {
        this.ensureChunkGenerated(cx, cz);
      }
    }

    // A small hut cluster for the fast-travel waypoint + villagers.
    this.villagePos = placeVillage(this, HOME_ORIGIN_X, HOME_ORIGIN_Z);

    // A second, smaller settlement elsewhere in the home region.
    this.outpostPos = placeVillage(this, HOME_ORIGIN_X, HOME_ORIGIN_Z, {
      avoidPos: this.villagePos, offsets: OUTPOST_OFFSETS, hutCount: 2,
    });

    // A ruined chamber with guarded loot, away from both settlements.
    this.dungeonPos = placeDungeon(this, HOME_ORIGIN_X, HOME_ORIGIN_Z, [this.villagePos, this.outpostPos]);

    // A second, buried structure — different silhouette (enclosed, reached
    // by digging down) and better loot than the open-air Ruins.
    this.vaultPos = placeVault(this, HOME_ORIGIN_X, HOME_ORIGIN_Z, [this.villagePos, this.outpostPos, this.dungeonPos]);

    // Small single-hut "camps" scattered much farther out than the two
    // main settlements — there so exploring past the main cluster of
    // landmarks still keeps turning up something new. Not fast-travel
    // waypoints on purpose — meant to be found, not looked up.
    this.campPositions = [];
    const placedSoFar = [this.villagePos, this.outpostPos, this.dungeonPos, this.vaultPos];
    for (const offsetSet of CAMP_OFFSET_SETS) {
      const pos = placeVillage(this, HOME_ORIGIN_X, HOME_ORIGIN_Z, {
        avoidPos: [...placedSoFar, ...this.campPositions],
        offsets: offsetSet,
        hutCount: 1,
      });
      if (pos) {
        this.campPositions.push(pos);
        const cx = Math.round(pos.x), cz = Math.round(pos.z), cy = Math.round(pos.y);
        this.setBlockRaw(cx + 2, cy, cz, BLOCKS.CHEST);
        const slots = this.getChest(cx + 2, cy, cz);
        slots[0] = { id: BLOCKS.BREAD, count: 2 };
        slots[1] = { id: BLOCKS.GEMSTONE, count: Math.random() < 0.5 ? 2 : 0 };
      }
    }

    // A road network — every landmark (incl. camps) gets a straight
    // dirt-path road back to spawn, so the home region reads as connected
    // infrastructure rather than a scatter of unrelated structures.
    this.spawnPoint = this.findSpawn();
    const spawn = this.spawnPoint;
    for (const dest of [this.villagePos, this.outpostPos, this.dungeonPos, this.vaultPos, ...this.campPositions]) {
      if (dest) this.layRoad(Math.round(spawn.x), Math.round(spawn.z), Math.round(dest.x), Math.round(dest.z));
    }

    // Collect every torch baked into a structure above as a light source,
    // then propagate light from all of them before the first mesh build.
    for (const site of [this.villagePos, this.outpostPos, this.dungeonPos, this.vaultPos, ...this.campPositions]) {
      if (site) this.scanLightSourcesNear(Math.round(site.x), Math.round(site.z), 20);
    }
    this.recomputeLight();

    for (const chunk of this.chunks.values()) {
      chunk.buildMesh(this.scene);
      this.meshedChunks.add(this.key(chunk.cx, chunk.cz));
    }
  }

  // Called every frame from Game._loop: keeps chunks within CHUNK_LOAD_RADIUS
  // of the player generated+meshed, and drops the mesh (data stays, so an
  // edit persists) for anything farther than CHUNK_UNLOAD_RADIUS. New chunk
  // generation is throttled per call so running fast — or teleporting —
  // never has to generate a whole ring of chunks in a single frame.
  streamChunks(playerX, playerZ) {
    const { cx: pcx, cz: pcz } = this.worldToChunk(playerX, playerZ);
    let budget = MAX_NEW_CHUNKS_PER_TICK;
    for (let dz = -CHUNK_LOAD_RADIUS; dz <= CHUNK_LOAD_RADIUS && budget > 0; dz++) {
      for (let dx = -CHUNK_LOAD_RADIUS; dx <= CHUNK_LOAD_RADIUS && budget > 0; dx++) {
        if (dx * dx + dz * dz > CHUNK_LOAD_RADIUS * CHUNK_LOAD_RADIUS) continue;
        const cx = pcx + dx, cz = pcz + dz;
        const key = this.key(cx, cz);
        if (!this.generatedChunks.has(key)) {
          this.ensureChunkGenerated(cx, cz);
          budget--;
        }
        if (!this.meshedChunks.has(key)) {
          const chunk = this.chunkAt(cx, cz);
          if (chunk) {
            chunk.buildMesh(this.scene);
            this.meshedChunks.add(key);
          }
        }
      }
    }

    const unloadR2 = CHUNK_UNLOAD_RADIUS * CHUNK_UNLOAD_RADIUS;
    for (const key of this.meshedChunks) {
      const [cx, cz] = key.split(',').map(Number);
      const ddx = cx - pcx, ddz = cz - pcz;
      if (ddx * ddx + ddz * ddz <= unloadR2) continue;
      const chunk = this.chunkAt(cx, cz);
      if (chunk?.mesh) {
        this.scene.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
        chunk.mesh = null;
      }
      this.meshedChunks.delete(key);
    }
  }

  // After loading chunk data from a save, recompute heightMap/biomeMap for
  // every saved chunk by scanning its actual blocks — biome itself is
  // still just a function of position/seed.
  rebuildDerivedMapsFromChunks() {
    for (const chunk of this.chunks.values()) {
      const wx = chunk.cx * CHUNK_X, wz = chunk.cz * CHUNK_Z;
      for (let lx = 0; lx < CHUNK_X; lx++) {
        for (let lz = 0; lz < CHUNK_Z; lz++) {
          const x = wx + lx, z = wz + lz;
          let top = -1;
          for (let y = CHUNK_Y - 1; y >= 0; y--) {
            if (chunk.getLocal(lx, y, lz) !== BLOCKS.AIR) { top = y; break; }
          }
          this.heightMap.set(`${x},${z}`, top);
          this.biomeMap.set(`${x},${z}`, this.getBiome(x, z));
        }
      }
      this.generatedChunks.add(this.key(chunk.cx, chunk.cz));
    }
  }

  // Scans a bounded region around one structure site for the TORCH blocks
  // it baked in (village/ruins/vault each place a handful) — bounded
  // rather than a blind full-map scan, since structure torches only ever
  // exist near a known site (cave lava registers itself directly instead,
  // see placeLavaSplash, since it's scattered everywhere).
  scanLightSourcesNear(cx, cz, radius) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      for (let z = cz - radius; z <= cz + radius; z++) {
        const top = this.heightMap.get(`${x},${z}`);
        if (top === undefined) continue;
        for (let y = 1; y <= Math.min(top + 6, CHUNK_Y - 1); y++) {
          if (this.getBlock(x, y, z) === BLOCKS.TORCH) this.lightSources.add(this.posKey(x, y, z));
        }
      }
    }
  }

  // Standard voxel light propagation (BFS from every source, -1 per air
  // block traveled through, blocked by anything solid) — same technique
  // Minecraft's own block-light system uses, just recomputed from scratch
  // each time rather than incrementally, which is fine given how few light
  // sources typically exist. Only underground blocks actually consult this
  // at render time (see Chunk.buildMesh) — the surface stays lit by the
  // normal day/night scene lighting regardless of what this computes.
  recomputeLight() {
    this.lightMap.clear();
    const queue = [];
    for (const key of this.lightSources) {
      const [x, y, z] = key.split(',').map(Number);
      const level = this.getBlock(x, y, z) === BLOCKS.LAVA ? 12 : 14;
      this.lightMap.set(key, level);
      queue.push(key);
    }
    let head = 0;
    while (head < queue.length) {
      const key = queue[head++];
      const level = this.lightMap.get(key);
      if (level <= 1) continue;
      const [x, y, z] = key.split(',').map(Number);
      for (const [dx, dy, dz] of NEIGHBOR_DIRS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        const nid = this.getBlock(nx, ny, nz);
        if (nid !== BLOCKS.AIR) continue; // light only travels through open air
        const nkey = `${nx},${ny},${nz}`;
        const next = level - 1;
        if ((this.lightMap.get(nkey) || 0) >= next) continue;
        this.lightMap.set(nkey, next);
        queue.push(nkey);
      }
    }
  }

  getLightLevel(x, y, z) {
    return this.lightMap.get(this.posKey(x, y, z)) || 0;
  }

  // A block counts as "underground" once it's a few cells below its
  // column's surface — keeps the visible topsoil layer lit normally by
  // the day/night cycle instead of going dark the instant you're one
  // block under grass.
  isUnderground(x, y, z) {
    const top = this.heightMap.get(`${x},${z}`);
    return top !== undefined && y < top - 2;
  }

  placeTree(x, baseY, z) {
    const trunkH = 3 + Math.floor(this.treeNoise(x * 3, z * 3) * 2);
    for (let i = 0; i < trunkH; i++) this.setBlockRaw(x, baseY + i, z, BLOCKS.WOOD);
    const topY = baseY + trunkH;
    for (let ly = -1; ly <= 1; ly++) {
      for (let lx = -2; lx <= 2; lx++) {
        for (let lz = -2; lz <= 2; lz++) {
          if (Math.abs(lx) + Math.abs(lz) + Math.abs(ly) * 1.5 > 3.2) continue;
          const bx = x + lx, by = topY + ly, bz = z + lz;
          if (this.getBlock(bx, by, bz) === BLOCKS.AIR) this.setBlockRaw(bx, by, bz, BLOCKS.LEAVES);
        }
      }
    }
  }

  // Straight-line dirt-path road at ground level between two points — the
  // same technique Village.js uses for its internal paths, just over a
  // longer distance. Only ever used within the (bounded) home region.
  layRoad(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const steps = Math.max(Math.abs(dx), Math.abs(dz));
    if (steps < 1) return;
    for (let i = 0; i <= steps; i++) {
      const px = Math.round(x0 + (dx * i) / steps);
      const pz = Math.round(z0 + (dz * i) / steps);
      const top = this.heightMap.get(`${px},${pz}`);
      if (top === undefined) continue;
      this.setBlockRaw(px, top, pz, BLOCKS.PATH);
    }
  }

  placeCactus(x, baseY, z) {
    const h = 2 + Math.floor(this.treeNoise(x * 4, z * 4) * 2);
    for (let i = 0; i < h; i++) this.setBlockRaw(x, baseY + i, z, BLOCKS.CACTUS);
  }

  // Sets data without triggering a remesh — used only during generation.
  // Safely no-ops if the target chunk hasn't been created yet (e.g. a cave
  // worm or tree canopy reaching just past a chunk that hasn't streamed in
  // — see _generateChunkCaves) rather than throwing.
  setBlockRaw(x, y, z, id) {
    if (y < 0 || y >= CHUNK_Y) return;
    const { cx, cz } = this.worldToChunk(x, z);
    const chunk = this.chunkAt(cx, cz);
    if (!chunk) return;
    chunk.setLocal(x - cx * CHUNK_X, y, z - cz * CHUNK_Z, id);
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return BLOCKS.AIR;
    const { cx, cz } = this.worldToChunk(x, z);
    const chunk = this.chunkAt(cx, cz);
    if (!chunk) return BLOCKS.AIR;
    return chunk.getLocal(x - cx * CHUNK_X, y, z - cz * CHUNK_Z);
  }

  isMineable(x, y, z) {
    return MINEABLE.includes(this.getBlock(x, y, z));
  }

  posKey(x, y, z) {
    return `${x},${y},${z}`;
  }

  // Chest contents are lost if the chest block is mined — acceptable for
  // this MVP phase (matches "instant-click" simplicity elsewhere).
  getChest(x, y, z) {
    const key = this.posKey(x, y, z);
    if (!this.chests.has(key)) this.chests.set(key, new Array(27).fill(null));
    return this.chests.get(key);
  }

  plantCrop(x, y, z) {
    this.setBlock(x, y, z, BLOCKS.WHEAT_CROP);
    this.crops.set(this.posKey(x, y, z), CROP_GROWTH_SECONDS);
  }

  // Advances every planted crop; matures it once its timer runs out. Growth
  // progress isn't part of the save file (only the block itself is) — a
  // reload just restarts a still-growing crop's timer, which is an
  // acceptable trade-off for the scope here.
  tickCrops(dt, speedMult = 1) {
    for (const [key, remaining] of this.crops) {
      const next = remaining - dt * speedMult;
      if (next > 0) { this.crops.set(key, next); continue; }
      this.crops.delete(key);
      const [x, y, z] = key.split(',').map(Number);
      if (this.getBlock(x, y, z) === BLOCKS.WHEAT_CROP) this.setBlock(x, y, z, BLOCKS.WHEAT_CROP_MATURE);
    }
  }

  // Edits during play: update the block and remesh the chunk (+ any
  // neighboring chunk whose face-culling depends on this block).
  setBlock(x, y, z, id) {
    const { cx, cz } = this.worldToChunk(x, z);
    const chunk = this.chunkAt(cx, cz);
    if (!chunk) return;
    const lx = x - cx * CHUNK_X, lz = z - cz * CHUNK_Z;
    const prevId = chunk.getLocal(lx, y, lz);
    const key = this.posKey(x, y, z); // "x,y,z" — shared key format
    if (prevId === BLOCKS.CHEST && id !== BLOCKS.CHEST) this.chests.delete(key);
    if (prevId === BLOCKS.LEVER && id !== BLOCKS.LEVER) this.leverStates.delete(key);
    if ((prevId === BLOCKS.LAMP_OFF || prevId === BLOCKS.LAMP_ON) && id !== BLOCKS.LAMP_OFF && id !== BLOCKS.LAMP_ON) {
      this.lamps.delete(key);
    }
    if (prevId === BLOCKS.WHEAT_CROP && id !== BLOCKS.WHEAT_CROP) this.crops.delete(key);

    // Torches are the only player-placeable/mineable light source (lava
    // isn't placeable or mineable) — track it and recompute the lightmap
    // BEFORE meshing so the rebuild below already reflects the new light.
    const wasLightSource = prevId === BLOCKS.TORCH;
    const isLightSource = id === BLOCKS.TORCH;
    if (wasLightSource !== isLightSource) {
      if (isLightSource) this.lightSources.add(key); else this.lightSources.delete(key);
      this.recomputeLight();
    }

    chunk.setLocal(lx, y, lz, id);

    if (wasLightSource !== isLightSource) {
      // Light can reach ~14 blocks — rebuild everything in that radius,
      // not just the edited block's own chunk.
      this._rebuildChunksNear(x, z, 16);
    } else {
      chunk.buildMesh(this.scene);
      if (lx === 0) this.chunkAt(cx - 1, cz)?.buildMesh(this.scene);
      if (lx === CHUNK_X - 1) this.chunkAt(cx + 1, cz)?.buildMesh(this.scene);
      if (lz === 0) this.chunkAt(cx, cz - 1)?.buildMesh(this.scene);
      if (lz === CHUNK_Z - 1) this.chunkAt(cx, cz + 1)?.buildMesh(this.scene);
    }

    const isNetworkEdge = prevId === BLOCKS.LEVER || prevId === BLOCKS.WIRE || id === BLOCKS.LEVER || id === BLOCKS.WIRE;
    if (isNetworkEdge && !this._inPowerRecompute) this.recomputePower();

    this.onEdit?.(x, y, z, id); // hooked by Net.js to broadcast to co-op peers
  }

  _rebuildChunksNear(x, z, radius) {
    const { cx: cx0, cz: cz0 } = this.worldToChunk(x - radius, z - radius);
    const { cx: cx1, cz: cz1 } = this.worldToChunk(x + radius, z + radius);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) this.chunkAt(cx, cz)?.buildMesh(this.scene);
    }
  }

  registerLever(x, y, z) {
    this.leverStates.set(this.posKey(x, y, z), false);
  }

  registerLamp(x, y, z) {
    this.lamps.add(this.posKey(x, y, z));
  }

  toggleLever(x, y, z) {
    const key = this.posKey(x, y, z);
    this.leverStates.set(key, !this.leverStates.get(key));
    this.recomputePower();
  }

  // Flood-fills power outward from every "on" lever through connected wire,
  // then lights any lamp adjacent to a powered wire/lever.
  recomputePower() {
    this._inPowerRecompute = true;
    const powered = new Set();
    const queue = [];
    for (const [key, on] of this.leverStates) if (on) { powered.add(key); queue.push(key); }

    while (queue.length) {
      const [x, y, z] = queue.shift().split(',').map(Number);
      for (const [dx, dy, dz] of NEIGHBOR_DIRS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        const nkey = `${nx},${ny},${nz}`;
        if (powered.has(nkey)) continue;
        if (this.getBlock(nx, ny, nz) === BLOCKS.WIRE) {
          powered.add(nkey);
          queue.push(nkey);
        }
      }
    }

    for (const lampKey of this.lamps) {
      const [x, y, z] = lampKey.split(',').map(Number);
      let isPowered = false;
      for (const [dx, dy, dz] of NEIGHBOR_DIRS) {
        if (powered.has(`${x + dx},${y + dy},${z + dz}`)) { isPowered = true; break; }
      }
      const curId = this.getBlock(x, y, z);
      const wantId = isPowered ? BLOCKS.LAMP_ON : BLOCKS.LAMP_OFF;
      if (curId !== wantId) this.setBlock(x, y, z, wantId);
    }
    this._inPowerRecompute = false;
  }

  // Finds a safe spawn point near the home region's origin (topmost solid
  // block + 2, skipping columns where a tree trunk/canopy occupies that
  // headroom).
  findSpawn() {
    const cx = HOME_ORIGIN_X;
    const cz = HOME_ORIGIN_Z;
    for (let r = 0; r < HOME_REGION_RADIUS; r++) {
      const x = cx + r, z = cz;
      const top = this.heightMap.get(`${x},${z}`);
      if (top === undefined) continue;
      let clear = true;
      for (let dy = 1; dy <= 4; dy++) {
        if (this.getBlock(x, top + dy, z) !== BLOCKS.AIR) { clear = false; break; }
      }
      if (!clear) continue;
      return { x: x + 0.5, y: top + 2, z: z + 0.5 };
    }
    return { x: cx + 0.5, y: BASE_HEIGHT + 2, z: cz + 0.5 };
  }
}
