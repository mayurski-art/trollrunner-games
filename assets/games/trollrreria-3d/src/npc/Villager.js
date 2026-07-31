import { createBillboard } from '../render/SpriteTextures.js';

const WANDER_SPEED = 0.7;
const LEASH_RADIUS = 4; // won't wander farther than this from home
const SPRITE_HEIGHT = 1.7;

// A gently-wandering, non-hostile townsperson — cosmetic + a one-line
// greeting on interact (see Game.handlePlace). Unlike Enemy, never chases
// or attacks the player; stays near its home point around the village.
export class Villager {
  constructor(scene, world, home, name, line, sprite, role = null) {
    this.world = world;
    this.home = { ...home };
    this.pos = { ...home };
    this.name = name;
    this.line = line;
    this.role = role; // 'farmer' | 'guard' | null — see Game._tickFarmerVillager/_tickGuardVillager
    this.radius = 0.5;
    this.alive = true; // performRaycast's entity filter requires this
    this.wanderTarget = null;
    this.wanderTimer = Math.random() * 2;
    this.directedTarget = null; // set externally by role behavior; overrides wander when present
    this.attackCooldown = 0;

    this.mesh = createBillboard(sprite.file, sprite.w, sprite.h, SPRITE_HEIGHT);
    this.mesh.position.set(home.x, home.y, home.z);
    scene.add(this.mesh);
  }

  centerPos() {
    return { x: this.mesh.position.x, y: this.mesh.position.y + SPRITE_HEIGHT / 2, z: this.mesh.position.z };
  }

  hit() {
    return false; // can't be hurt, same as the Merchant
  }

  update(dt) {
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    if (!this.directedTarget) {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * LEASH_RADIUS;
        this.wanderTarget = { x: this.home.x + Math.cos(angle) * dist, z: this.home.z + Math.sin(angle) * dist };
        this.wanderTimer = 3 + Math.random() * 4;
      }
    }
    const target = this.directedTarget || this.wanderTarget;
    if (target) {
      const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.2) {
        const nextX = this.pos.x + (dx / d) * WANDER_SPEED * dt;
        const nextZ = this.pos.z + (dz / d) * WANDER_SPEED * dt;
        const groundY = this.findGround(nextX, nextZ);
        if (groundY !== null) {
          this.pos.x = nextX;
          this.pos.z = nextZ;
          this.pos.y = groundY;
        }
      }
    }
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
  }

  findGround(x, z) {
    let by = Math.round(this.pos.y);
    for (let i = 0; i < 4; i++) {
      if (this.world.getBlock(Math.floor(x), by, Math.floor(z)) !== 0) return by + 1;
      if (this.world.getBlock(Math.floor(x), by - 1, Math.floor(z)) === 0) { by -= 1; continue; }
      return by;
    }
    return by;
  }

  dispose(scene) {
    scene.remove(this.mesh); // material/texture are shared+cached — don't dispose here
  }
}
