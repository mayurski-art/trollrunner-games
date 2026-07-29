import { Chunk, CHUNK_X, CHUNK_Y, CHUNK_Z } from './Chunk.js';
import { BLOCKS, MINEABLE } from './blocks.js';
import { makeFractalNoise2D, makeNoise2D } from './noise.js';

// Small floating island, generated once at load — no infinite chunk
// streaming for the v1 MVP (see design doc: "small procedurally generated island").
export const WORLD_CHUNKS = 5; // 5x5 chunks -> 80x80 blocks
export const WORLD_SIZE_X = WORLD_CHUNKS * CHUNK_X;
export const WORLD_SIZE_Z = WORLD_CHUNKS * CHUNK_Z;
const ISLAND_RADIUS = WORLD_SIZE_X * 0.42;
const BASE_HEIGHT = 14;
const AMPLITUDE = 8;

export class World {
  constructor(scene, seed = 1337) {
    this.scene = scene;
    this.heightNoise = makeFractalNoise2D(seed);
    this.treeNoise = makeNoise2D(seed + 501);
    this.oreNoise = makeNoise2D(seed + 907);
    this.chunks = new Map(); // "cx,cz" -> Chunk
    this.heightMap = new Map(); // "x,z" -> topmost solid y (or -1 if void column)
    this.chests = new Map(); // "x,y,z" -> Array(27) of {id,count}|null

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
        const { cx, cz } = this.worldToChunk(x, z);
        const chunk = this.chunkAt(cx, cz);
        const lx = x - cx * CHUNK_X;
        const lz = z - cz * CHUNK_Z;

        for (let y = 0; y <= top; y++) {
          let id;
          if (y === 0) id = BLOCKS.BEDROCK;
          else if (y === top) id = top <= 4 ? BLOCKS.SAND : BLOCKS.GRASS;
          else if (y > top - 3) id = BLOCKS.DIRT;
          else {
            id = BLOCKS.STONE;
            if (y < top - 5 && this.oreNoise(x * 0.3, (z + y) * 0.3) > 0.82) id = BLOCKS.ORE;
          }
          chunk.setLocal(lx, y, lz, id);
        }
      }
    }

    // Pass 2: sprinkle a few trees on grass columns away from the island edge.
    for (let x = 2; x < WORLD_SIZE_X - 2; x++) {
      for (let z = 2; z < WORLD_SIZE_Z - 2; z++) {
        const top = this.heightMap.get(`${x},${z}`);
        if (top < 6) continue;
        if (this.getBlock(x, top, z) !== BLOCKS.GRASS) continue;
        if (this.treeNoise(x * 0.9, z * 0.9) < 0.93) continue;
        this.placeTree(x, top + 1, z);
      }
    }

    // Pass 3: build meshes now that all chunk data (incl. neighbors) is ready.
    for (const chunk of this.chunks.values()) chunk.buildMesh(this.scene);
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

  chestKey(x, y, z) {
    return `${x},${y},${z}`;
  }

  // Chest contents are lost if the chest block is mined — acceptable for
  // this MVP phase (matches "instant-click" simplicity elsewhere).
  getChest(x, y, z) {
    const key = this.chestKey(x, y, z);
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
    if (prevId === BLOCKS.CHEST && id !== BLOCKS.CHEST) this.chests.delete(this.chestKey(x, y, z));
    chunk.setLocal(lx, y, lz, id);
    chunk.buildMesh(this.scene);

    if (lx === 0) this.chunkAt(cx - 1, cz)?.buildMesh(this.scene);
    if (lx === CHUNK_X - 1) this.chunkAt(cx + 1, cz)?.buildMesh(this.scene);
    if (lz === 0) this.chunkAt(cx, cz - 1)?.buildMesh(this.scene);
    if (lz === CHUNK_Z - 1) this.chunkAt(cx, cz + 1)?.buildMesh(this.scene);
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
