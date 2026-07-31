import { Enemy } from './Enemy.js';
import { ENEMY_TYPES } from './EnemyTypes.js';
import { CHUNK_Y } from '../world/Chunk.js';
import { BLOCKS } from '../world/blocks.js';

const MAX_ENEMIES = 6;
const MAX_ENEMIES_HARDMODE = 9;
const SPAWN_INTERVAL_MIN = 4;
const SPAWN_INTERVAL_MAX = 9;
const HARDMODE_INTERVAL_SCALE = 0.6; // faster spawns once hardmode hits
const MIN_SPAWN_DIST = 10;
const MAX_SPAWN_DIST = 28;
const HARDMODE_STAT_SCALE = { hp: 1.5, damage: 1.4 };
// Caves are tight, so mobs spawn much closer than on the surface (a 10-28
// unit ring might not have ANY reachable air pocket in a narrow tunnel).
// Cap is deliberately lower than the surface — caves should feel sparse
// and tense, not crowded; density isn't the point, darkness+surprise is.
const CAVE_MIN_SPAWN_DIST = 6;
const CAVE_MAX_SPAWN_DIST = 16;
const CAVE_MAX_ENEMIES = 3;
// A calm window at the start of every run (both "New Island" and
// "Continue") — Minecraft/Terraria both spare a fresh spawn from instant
// hostile pressure. No mobs spawn AND no existing mob can aggro while this
// is counting down, so the player gets their bearings first.
export const SPAWN_GRACE_SECONDS = 25;

const KIND_LIST = Object.values(ENEMY_TYPES).filter((k) => !k.summonOnly);

// Owns the live mob list: periodic spawning up to a cap, per-frame update,
// and cleanup of dead mobs. Game.js just calls update() and reads
// spawner.enemies for raycasting/rendering.
export class Spawner {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.enemies = [];
    this.spawnTimer = SPAWN_GRACE_SECONDS;
    this.graceTimer = SPAWN_GRACE_SECONDS;
    // Set by Game.js from difficulty + New Game+ prestige level — stacks
    // on top of the hardmode scale below rather than replacing it.
    this.statScale = { hp: 1, damage: 1 };
  }

  update(dt, playerPos) {
    // Drop anything that died last frame (kept alive one extra frame so
    // Game.handleDig's raycast can still see it die() this frame).
    this.enemies = this.enemies.filter((e) => {
      if (e.alive) return true;
      e.dispose(this.scene);
      return false;
    });

    if (this.graceTimer > 0) this.graceTimer -= dt;
    const peaceful = this.graceTimer > 0;

    const attackers = [];
    for (const enemy of this.enemies) {
      if (enemy.update(dt, this.world, playerPos, peaceful) === 'attack') attackers.push(enemy);
    }

    const undergroundPlayer = this.world.isUnderground(Math.floor(playerPos.x), Math.floor(playerPos.y), Math.floor(playerPos.z));
    const cap = undergroundPlayer ? CAVE_MAX_ENEMIES : (this.world.hardmode ? MAX_ENEMIES_HARDMODE : MAX_ENEMIES);
    this.spawnTimer -= dt;
    if (!peaceful && this.spawnTimer <= 0 && this.enemies.length < cap) {
      this.trySpawn(playerPos, undergroundPlayer);
      const scale = this.world.hardmode ? HARDMODE_INTERVAL_SCALE : 1;
      this.spawnTimer = (SPAWN_INTERVAL_MIN + Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN)) * scale;
    }

    return attackers;
  }

  trySpawn(playerPos, underground = false) {
    const hardmode = this.world.hardmode;
    const pool = hardmode ? KIND_LIST : KIND_LIST.filter((k) => !k.hardmodeOnly);
    const minDist = underground ? CAVE_MIN_SPAWN_DIST : MIN_SPAWN_DIST;
    const maxDist = underground ? CAVE_MAX_SPAWN_DIST : MAX_SPAWN_DIST;

    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = minDist + Math.random() * (maxDist - minDist);
      const x = Math.floor(playerPos.x + Math.cos(angle) * dist);
      const z = Math.floor(playerPos.z + Math.sin(angle) * dist);

      let kind = pool[Math.floor(Math.random() * pool.length)];
      const hpScale = (hardmode && !kind.hardmodeOnly ? HARDMODE_STAT_SCALE.hp : 1) * this.statScale.hp;
      const dmgScale = (hardmode && !kind.hardmodeOnly ? HARDMODE_STAT_SCALE.damage : 1) * this.statScale.damage;
      if (hpScale !== 1 || dmgScale !== 1) {
        kind = { ...kind, hp: Math.round(kind.hp * hpScale), damage: Math.round(kind.damage * dmgScale) };
      }

      let spawnY;
      if (underground) {
        // Caves have no single "surface" — hunt for a nearby air pocket at
        // roughly the player's own depth instead of defaulting to the
        // column's ground-level heightmap entry (which would place the mob
        // way up at the outdoor surface, not in the cave at all).
        spawnY = this.findCaveSpawnY(x, z, playerPos.y, !kind.flies);
        if (spawnY === null) continue;
      } else {
        const top = this.world.heightMap.get(`${x},${z}`);
        if (top === undefined || top < 0) continue;
        spawnY = kind.flies ? top + 1 + kind.hoverHeight : top + 1;
      }
      this.enemies.push(new Enemy(this.scene, { x: x + 0.5, y: spawnY, z: z + 0.5 }, kind));
      return;
    }
  }

  // Searches outward (both up and down) from the player's own Y for an air
  // pocket with headroom — and, for ground mobs, a solid floor beneath it.
  findCaveSpawnY(x, z, aroundY, needsFloor) {
    const centerY = Math.round(aroundY);
    for (let dy = 0; dy <= 6; dy++) {
      const candidates = dy === 0 ? [centerY] : [centerY - dy, centerY + dy];
      for (const y of candidates) {
        if (y < 2 || y > CHUNK_Y - 3) continue;
        if (this.world.getBlock(x, y, z) !== BLOCKS.AIR) continue;
        if (this.world.getBlock(x, y + 1, z) !== BLOCKS.AIR) continue;
        if (needsFloor && this.world.getBlock(x, y - 1, z) === BLOCKS.AIR) continue;
        return y;
      }
    }
    return null;
  }
}
