import { Enemy } from './Enemy.js';
import { ENEMY_TYPES } from './EnemyTypes.js';
import { WORLD_SIZE_X, WORLD_SIZE_Z } from '../world/World.js';

const MAX_ENEMIES = 6;
const SPAWN_INTERVAL_MIN = 4;
const SPAWN_INTERVAL_MAX = 9;
const MIN_SPAWN_DIST = 10;
const MAX_SPAWN_DIST = 28;

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

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.enemies.length < MAX_ENEMIES) {
      this.trySpawn(playerPos);
      this.spawnTimer = SPAWN_INTERVAL_MIN + Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);
    }

    return attackers;
  }

  trySpawn(playerPos) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = MIN_SPAWN_DIST + Math.random() * (MAX_SPAWN_DIST - MIN_SPAWN_DIST);
      const x = Math.floor(playerPos.x + Math.cos(angle) * dist);
      const z = Math.floor(playerPos.z + Math.sin(angle) * dist);
      if (x < 1 || x >= WORLD_SIZE_X - 1 || z < 1 || z >= WORLD_SIZE_Z - 1) continue;
      const top = this.world.heightMap.get(`${x},${z}`);
      if (top === undefined || top < 0) continue;
      const kind = KIND_LIST[Math.floor(Math.random() * KIND_LIST.length)];
      const spawnY = kind.flies ? top + 1 + kind.hoverHeight : top + 1;
      this.enemies.push(new Enemy(this.scene, { x: x + 0.5, y: spawnY, z: z + 0.5 }, kind));
      return;
    }
  }
}
