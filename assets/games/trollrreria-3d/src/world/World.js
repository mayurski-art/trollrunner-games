import { Chunk, CHUNK_X, CHUNK_Y, CHUNK_Z } from './Chunk.js';
import { BLOCKS, MINEABLE } from './blocks.js';
import { makeFractalNoise2D, makeNoise2D } from './noise.js';
import { placeVillage, OUTPOST_OFFSETS } from './Village.js';
import { placeDungeon } from './Dungeon.js';
import { placeVault } from './Vault.js';

const NEIGHBOR_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Floating island, generated once at load — no infinite chunk streaming.
// Went 5x5 (80x80, original MVP) -> 9x9 (144x144) -> still felt small on
// playtest, so bumped again to 25x25 (400x400, ~25x the original area).
// Chunk.buildMesh skips fully-empty chunks (the square grid's corners
// outside the island's circular falloff) so this doesn't cost a draw call
// per empty chunk — verified via headless FPS sampling before landing on
// this size (33x33 measurably worse, 25x25 held up fine).
export const WORLD_CHUNKS = 25; // 25x25 chunks -> 400x400 blocks
export const WORLD_SIZE_X = WORLD_CHUNKS * CHUNK_X;
export const WORLD_SIZE_Z = WORLD_CHUNKS * CHUNK_Z;
const ISLAND_RADIUS = WORLD_SIZE_X * 0.42;
// Raised from 14/8 — the falloff multiplier (0 at the edge, 1 only at the
// exact center) means MOST of the island ends up far shorter than the raw
// BASE_HEIGHT±AMPLITUDE range suggests (measured avg surface height was
// only ~5 blocks above bedrock at the old values — barely enough room for
// a cave anywhere except the small central peak). This gives real
// mountains near the center and enough vertical room for caves/ore veins
// to exist across a meaningful fraction of the map, not just a sliver.
const BASE_HEIGHT = 18;
const AMPLITUDE = 12;
const CROP_GROWTH_SECONDS = 45;

export const BIOMES = { FOREST: 'forest', DESERT: 'desert', SNOW: 'snow' };

export class World {
  constructor(scene, seed = 1337) {
    this.scene = scene;
    this.seed = seed;
    this.heightNoise = makeFractalNoise2D(seed);
    this.treeNoise = makeNoise2D(seed + 501);
    this.biomeNoise = makeNoise2D(seed + 2003);
    this.chunks = new Map(); // "cx,cz" -> Chunk
    this.heightMap = new Map(); // "x,z" -> topmost solid y (or -1 if void column)
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
    this.crops = new Map(); // "x,y,z" -> seconds remaining until WHEAT_CROP_MATURE
    this.lightSources = new Set(); // "x,y,z" of every placed TORCH/LAVA block
    this.lightMap = new Map(); // "x,y,z" -> 0-15 propagated light level (see recomputeLight)

    for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
      for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
        this.chunks.set(this.key(cx, cz), new Chunk(cx, cz, this));
      }
    }
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

  // Low-frequency regions so biomes read as continuous patches, not noise —
  // tuned so a handful of full patches fit across the island's ~168-block
  // radius (400x400 world) rather than sampling only a sliver of the noise
  // grid. Scales down from the original 0.06 (tuned for an ~34-radius
  // island) by the same ~5x the radius grew, so biome regions stay a
  // believably large, walkable size instead of shrinking into confetti.
  getBiome(x, z) {
    const n = this.biomeNoise(x * 0.012, z * 0.012);
    if (n < 0.35) return BIOMES.DESERT;
    if (n > 0.65) return BIOMES.SNOW;
    return BIOMES.FOREST;
  }

  columnHeight(x, z) {
    const dx = x - WORLD_SIZE_X / 2;
    const dz = z - WORLD_SIZE_Z / 2;
    const dist = Math.sqrt(dx * dx + dz * dz);
    let falloff = 1 - dist / ISLAND_RADIUS;
    falloff = Math.max(0, Math.min(1, falloff));
    falloff = falloff * falloff * (3 - 2 * falloff); // smoothstep edge
    if (falloff <= 0.02) return -1; // void column, no island here
    const n = this.heightNoise(x, z); // 0..1
    const h = Math.round((BASE_HEIGHT + (n - 0.5) * AMPLITUDE * 2) * falloff);
    return Math.max(2, Math.min(CHUNK_Y - 6, h));
  }

  generate() {
    // Pass 1: fill column data (grass/dirt/stone/bedrock + ore) into each chunk's array directly.
    for (let x = 0; x < WORLD_SIZE_X; x++) {
      for (let z = 0; z < WORLD_SIZE_Z; z++) {
        const top = this.columnHeight(x, z);
        this.heightMap.set(`${x},${z}`, top);
        if (top < 0) continue;
        const biome = this.getBiome(x, z);
        this.biomeMap.set(`${x},${z}`, biome);
        const { cx, cz } = this.worldToChunk(x, z);
        const chunk = this.chunkAt(cx, cz);
        const lx = x - cx * CHUNK_X;
        const lz = z - cz * CHUNK_Z;
        const topBlock = top <= 4 ? BLOCKS.SAND
          : biome === BIOMES.DESERT ? BLOCKS.SAND
          : biome === BIOMES.SNOW ? BLOCKS.SNOW
          : BLOCKS.GRASS;

        for (let y = 0; y <= top; y++) {
          let id;
          if (y === 0) id = BLOCKS.BEDROCK;
          else if (y === top) id = topBlock;
          else if (y > top - 3) id = biome === BIOMES.DESERT && top > 4 ? BLOCKS.SAND : BLOCKS.DIRT;
          else id = BLOCKS.STONE; // ore/gemstone come later as veins (placeOreVeins), not per-block noise
          chunk.setLocal(lx, y, lz, id);
        }
      }
    }

    // Pass 1a: ore/gemstone veins — clustered blobs instead of independent
    // per-block noise, so mining actually means finding and following a
    // deposit rather than a single lucky block. Runs before cave carving
    // so tunnels can cut through and expose veins on their walls.
    this.placeOreVeins();

    // Pass 1b: cave tunnels — a worm-style random walk carves winding
    // tunnels through the solid stone mass, occasionally dropping a small
    // lava pool at the bottom once it's deep enough. Runs before every
    // structure placement pass below so village/dungeon/vault carving
    // always has the last word and can't be undermined by a cave.
    this.carveCaves();

    // Pass 2: sprinkle vegetation — trees in forest/snow, cacti in desert.
    for (let x = 2; x < WORLD_SIZE_X - 2; x++) {
      for (let z = 2; z < WORLD_SIZE_Z - 2; z++) {
        const top = this.heightMap.get(`${x},${z}`);
        if (top < 6) continue;
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

    // Pass 3: a small hut cluster for the fast-travel waypoint + villagers.
    this.villagePos = placeVillage(this, WORLD_SIZE_X, WORLD_SIZE_Z);

    // Pass 3a: a second, smaller settlement elsewhere on the island.
    this.outpostPos = placeVillage(this, WORLD_SIZE_X, WORLD_SIZE_Z, {
      avoidPos: this.villagePos, offsets: OUTPOST_OFFSETS, hutCount: 2,
    });

    // Pass 3b: a ruined chamber with guarded loot, away from both settlements.
    this.dungeonPos = placeDungeon(this, WORLD_SIZE_X, WORLD_SIZE_Z, [this.villagePos, this.outpostPos]);

    // Pass 3c: a second, buried structure — different silhouette (enclosed,
    // reached by digging down) and better loot than the open-air Ruins.
    this.vaultPos = placeVault(this, WORLD_SIZE_X, WORLD_SIZE_Z, [this.villagePos, this.outpostPos, this.dungeonPos]);

    // Pass 3d: a road network — every landmark gets a straight dirt-path
    // road back to spawn, so the island reads as connected infrastructure
    // rather than a scatter of unrelated structures dropped at random.
    const spawn = this.findSpawn();
    for (const dest of [this.villagePos, this.outpostPos, this.dungeonPos, this.vaultPos]) {
      if (dest) this.layRoad(Math.round(spawn.x), Math.round(spawn.z), Math.round(dest.x), Math.round(dest.z));
    }

    // Pass 3e: collect every torch baked into a structure above as a light
    // source (only near the known structure sites, not a blind full-map
    // scan — torches only ever come from those at gen time), then
    // propagate light from all of them before the first mesh build.
    for (const site of [this.villagePos, this.outpostPos, this.dungeonPos, this.vaultPos]) {
      if (site) this.scanLightSourcesNear(Math.round(site.x), Math.round(site.z), 20);
    }
    this.recomputeLight();

    // Pass 4: build meshes now that all chunk data (incl. neighbors) is ready.
    for (const chunk of this.chunks.values()) chunk.buildMesh(this.scene);
  }

  // After loading chunk data from a save (which skips procedural
  // generation), recompute heightMap/biomeMap by scanning the actual
  // blocks — biome itself is still just a function of position/seed.
  rebuildDerivedMapsFromChunks() {
    for (let x = 0; x < WORLD_SIZE_X; x++) {
      for (let z = 0; z < WORLD_SIZE_Z; z++) {
        let top = -1;
        for (let y = CHUNK_Y - 1; y >= 0; y--) {
          if (this.getBlock(x, y, z) !== BLOCKS.AIR) { top = y; break; }
        }
        this.heightMap.set(`${x},${z}`, top);
        this.biomeMap.set(`${x},${z}`, this.getBiome(x, z));
      }
    }
  }

  // Scatters ore/gemstone as vein clusters (a short random walk of a
  // handful of blocks, replacing STONE only) rather than one block at a
  // time — mining now means noticing a vein and following it, not just
  // getting individually lucky. Count scales with island area.
  placeOreVeins() {
    // Attempt count and depth requirements are tuned against this island's
    // ACTUAL height distribution, not the raw BASE_HEIGHT±AMPLITUDE range —
    // the falloff multiplier means most columns end up far shorter than
    // that range suggests (measured: avg surface height only ~6 above
    // bedrock, with just ~23% of columns reaching 10+). Gating on top>=12
    // like an early draft did meant ~85% of attempts wasted on columns too
    // short to ever qualify. Lower requirements + more attempts compensate.
    const veinCount = Math.floor((WORLD_SIZE_X * WORLD_SIZE_Z) / 600);
    for (let i = 0; i < veinCount; i++) {
      const x = Math.floor(Math.random() * WORLD_SIZE_X);
      const z = Math.floor(Math.random() * WORLD_SIZE_Z);
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

  // Worm-style cave carving: random-walks a handful of tunnels through the
  // solid stone mass, carving a small sphere of air at every step (radius
  // drifts a little each step so tunnels don't read as perfectly uniform
  // pipes). Stays well below the surface and away from bedrock so it never
  // breaches into open air or the world floor. Occasionally drops a small
  // lava pool once deep enough — cave hazard, not just empty tunnels.
  carveCaves() {
    // Same recalibration as placeOreVeins — top>=16 (an early draft's
    // guess against the raw BASE_HEIGHT±AMPLITUDE range) meant only ~1%
    // of columns on the real, falloff-shortened island ever qualified,
    // so caves only ever existed in a sliver near the exact center. top>=9
    // matches the actual distribution far better, and the attempt count
    // is upped to compensate for shallower (shorter, still real) tunnels.
    const wormCount = Math.floor((WORLD_SIZE_X * WORLD_SIZE_Z) / 1000);
    for (let w = 0; w < wormCount; w++) {
      let x = Math.floor(Math.random() * WORLD_SIZE_X);
      let z = Math.floor(Math.random() * WORLD_SIZE_Z);
      const top = this.heightMap.get(`${x},${z}`);
      if (top === undefined || top < 9) continue;
      let y = 2 + Math.random() * Math.max(1, top - 8);
      let dx = Math.random() * 2 - 1, dy = (Math.random() * 2 - 1) * 0.3, dz = Math.random() * 2 - 1;
      let len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      let radius = 1.5 + Math.random() * 1.5;
      const steps = 40 + Math.floor(Math.random() * 90);

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
        if (colTop === undefined || colTop < 0) break; // wandered off the island
        if (y < 2 || y > colTop - 4) break; // never breach bedrock or the surface
      }
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
        this.lightSources.add(this.posKey(x, y, z)); // registered directly — scattered across the whole map, not near any single structure site scanLightSourcesNear covers
      }
    }
  }

  // Scans a bounded region around one structure site for the TORCH blocks
  // it baked in (village/ruins/vault each place a handful) — bounded
  // rather than a blind full-map scan, since structure torches only ever
  // exist near a known site (cave lava registers itself directly instead,
  // see placeLavaSplash, since it's scattered across the whole map).
  scanLightSourcesNear(cx, cz, radius) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(WORLD_SIZE_X - 1, cx + radius); x++) {
      for (let z = Math.max(0, cz - radius); z <= Math.min(WORLD_SIZE_Z - 1, cz + radius); z++) {
        const top = this.heightMap.get(`${x},${z}`);
        if (top === undefined || top < 0) continue;
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
    return top !== undefined && top >= 0 && y < top - 2;
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
  // much longer distance. Deliberately naive (no pathfinding around water/
  // hills): Minecraft village paths are similarly straight-line, and at
  // this scale a perfectly planned road reads less "organic" anyway.
  layRoad(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const steps = Math.max(Math.abs(dx), Math.abs(dz));
    if (steps < 1) return;
    for (let i = 0; i <= steps; i++) {
      const px = Math.round(x0 + (dx * i) / steps);
      const pz = Math.round(z0 + (dz * i) / steps);
      const top = this.heightMap.get(`${px},${pz}`);
      if (top === undefined || top < 0) continue; // void gap — leave it
      this.setBlockRaw(px, top, pz, BLOCKS.PATH);
    }
  }

  placeCactus(x, baseY, z) {
    const h = 2 + Math.floor(this.treeNoise(x * 4, z * 4) * 2);
    for (let i = 0; i < h; i++) this.setBlockRaw(x, baseY + i, z, BLOCKS.CACTUS);
  }

  // Sets data without triggering a remesh — used only during generation.
  setBlockRaw(x, y, z, id) {
    if (y < 0 || y >= CHUNK_Y) return;
    if (x < 0 || x >= WORLD_SIZE_X || z < 0 || z >= WORLD_SIZE_Z) return;
    const { cx, cz } = this.worldToChunk(x, z);
    const chunk = this.chunkAt(cx, cz);
    chunk.setLocal(x - cx * CHUNK_X, y, z - cz * CHUNK_Z, id);
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return BLOCKS.AIR;
    if (x < 0 || x >= WORLD_SIZE_X || z < 0 || z >= WORLD_SIZE_Z) return BLOCKS.AIR;
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

  // Finds a safe spawn point near the island center (topmost solid block + 2,
  // skipping columns where a tree trunk/canopy occupies that headroom).
  findSpawn() {
    const cx = Math.floor(WORLD_SIZE_X / 2);
    const cz = Math.floor(WORLD_SIZE_Z / 2);
    for (let r = 0; r < WORLD_SIZE_X / 2; r++) {
      const x = cx + r, z = cz;
      const top = this.heightMap.get(`${x},${z}`);
      if (top < 0) continue;
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
