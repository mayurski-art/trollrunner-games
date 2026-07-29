import { Chunk, CHUNK_X, CHUNK_Y, CHUNK_Z } from './Chunk.js';
import { BLOCKS, MINEABLE } from './blocks.js';
import { makeFractalNoise2D, makeNoise2D } from './noise.js';

const NEIGHBOR_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Small floating island, generated once at load — no infinite chunk
// streaming for the v1 MVP (see design doc: "small procedurally generated island").
export const WORLD_CHUNKS = 5; // 5x5 chunks -> 80x80 blocks
export const WORLD_SIZE_X = WORLD_CHUNKS * CHUNK_X;
export const WORLD_SIZE_Z = WORLD_CHUNKS * CHUNK_Z;
const ISLAND_RADIUS = WORLD_SIZE_X * 0.42;
const BASE_HEIGHT = 14;
const AMPLITUDE = 8;

export const BIOMES = { FOREST: 'forest', DESERT: 'desert', SNOW: 'snow' };

export class World {
  constructor(scene, seed = 1337) {
    this.scene = scene;
    this.seed = seed;
    this.heightNoise = makeFractalNoise2D(seed);
    this.treeNoise = makeNoise2D(seed + 501);
    this.oreNoise = makeNoise2D(seed + 907);
    this.gemNoise = makeNoise2D(seed + 1609);
    this.biomeNoise = makeNoise2D(seed + 2003);
    this.chunks = new Map(); // "cx,cz" -> Chunk
    this.heightMap = new Map(); // "x,z" -> topmost solid y (or -1 if void column)
    this.biomeMap = new Map(); // "x,z" -> BIOMES.*
    this.chests = new Map(); // "x,y,z" -> Array(27) of {id,count}|null
    this.leverStates = new Map(); // "x,y,z" -> boolean (on/off)
    this.lamps = new Set(); // "x,y,z" of placed lamps (either state)
    this._inPowerRecompute = false;
    this.hardmode = false;

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
  // tuned so a handful of full patches fit across the island's ~34-block
  // radius rather than sampling only a sliver of the noise grid.
  getBiome(x, z) {
    const n = this.biomeNoise(x * 0.06, z * 0.06);
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
          else {
            id = BLOCKS.STONE;
            if (y < top - 5 && this.oreNoise(x * 0.3, (z + y) * 0.3) > 0.82) id = BLOCKS.ORE;
            // Gemstone: deeper and rarer than regular ore — the progression tier.
            if (y < top - 9 && this.gemNoise(x * 0.3, (z + y) * 0.3) > 0.9) id = BLOCKS.GEMSTONE;
          }
          chunk.setLocal(lx, y, lz, id);
        }
      }
    }

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

    // Pass 3: build meshes now that all chunk data (incl. neighbors) is ready.
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
    chunk.setLocal(lx, y, lz, id);
    chunk.buildMesh(this.scene);

    if (lx === 0) this.chunkAt(cx - 1, cz)?.buildMesh(this.scene);
    if (lx === CHUNK_X - 1) this.chunkAt(cx + 1, cz)?.buildMesh(this.scene);
    if (lz === 0) this.chunkAt(cx, cz - 1)?.buildMesh(this.scene);
    if (lz === CHUNK_Z - 1) this.chunkAt(cx, cz + 1)?.buildMesh(this.scene);

    const isNetworkEdge = prevId === BLOCKS.LEVER || prevId === BLOCKS.WIRE || id === BLOCKS.LEVER || id === BLOCKS.WIRE;
    if (isNetworkEdge && !this._inPowerRecompute) this.recomputePower();

    this.onEdit?.(x, y, z, id); // hooked by Net.js to broadcast to co-op peers
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
