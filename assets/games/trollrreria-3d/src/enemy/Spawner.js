import { Enemy } from './Enemy.js';
import { ENEMY_TYPES } from './EnemyTypes.js';
import { WORLD_SIZE_X, WORLD_SIZE_Z } from '../world/World.js';

const MAX_ENEMIES = 6;
const MAX_ENEMIES_HARDMODE = 9;
const SPAWN_INTERVAL_MIN = 4;
const SPAWN_INTERVAL_MAX = 9;
const HARDMODE_INTERVAL_SCALE = 0.6; // faster spawns once hardmode hits
const MIN_SPAWN_DIST = 10;
const MAX_SPAWN_DIST = 28;
const HARDMODE_STAT_SCALE = { hp: 1.5, damage: 1.4 };

const KIND_LIST = Object.values(ENEMY_TYPES);

// Owns the live mob list: periodic spawning up to a cap, per-frame update,
// and cleanup of dead mobs. Game.js just calls update() and reads
// spawner.enemies for raycasting/rendering.
export class Spawner {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.enemies = [];
    this.spawnTimer = 2;
  }

  update(dt, playerPos) {
    // Drop anything that died last frame (kept alive one extra frame so
    // Game.handleDig's raycast can still see it die() this frame).
    this.enemies = this.enemies.filter((e) => {
      if (e.alive) return true;
      e.dispose(this.scene);
      return false;
    });

    const attackers = [];
    for (const enemy of this.enemies) {
      if (enemy.update(dt, this.world, playerPos) === 'attack') attackers.push(enemy);
    }

    const cap = this.world.hardmode ? MAX_ENEMIES_HARDMODE : MAX_ENEMIES;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.enemies.length < cap) {
      this.trySpawn(playerPos);
      const scale = this.world.hardmode ? HARDMODE_INTERVAL_SCALE : 1;
      this.spawnTimer = (SPAWN_INTERVAL_MIN + Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN)) * scale;
    }

    return attackers;
  }

  trySpawn(playerPos) {
    const hardmode = this.world.hardmode;
    const pool = hardmode ? KIND_LIST : KIND_LIST.filter((k) => !k.hardmodeOnly);

    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = MIN_SPAWN_DIST + Math.random() * (MAX_SPAWN_DIST - MIN_SPAWN_DIST);
      const x = Math.floor(playerPos.x + Math.cos(angle) * dist);
      const z = Math.floor(playerPos.z + Math.sin(angle) * dist);
      if (x < 1 || x >= WORLD_SIZE_X - 1 || z < 1 || z >= WORLD_SIZE_Z - 1) continue;
      const top = this.world.heightMap.get(`${x},${z}`);
      if (top === undefined || top < 0) continue;

      let kind = pool[Math.floor(Math.random() * pool.length)];
      if (hardmode && !kind.hardmodeOnly) {
        kind = { ...kind, hp: Math.round(kind.hp * HARDMODE_STAT_SCALE.hp), damage: Math.round(kind.damage * HARDMODE_STAT_SCALE.damage) };
      }
      const spawnY = kind.flies ? top + 1 + kind.hoverHeight : top + 1;
      this.enemies.push(new Enemy(this.scene, { x: x + 0.5, y: spawnY, z: z + 0.5 }, kind));
      return;
    }
  }
}
