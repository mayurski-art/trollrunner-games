const HALF_W = 0.3;
const HEIGHT = 1.7;
const EYE_HEIGHT = 1.55;
const GRAVITY = 24;
const JUMP_SPEED = 8.2;
const MOVE_SPEED = 5.2;
const MAX_HP = 100;
const MAX_HUNGER = 100;

// Feet-anchored AABB voxel collision: axis-separated resolve (move X, clamp
// on overlap; then Y; then Z) — simple and stable enough for a small world.
function aabbHitsSolid(world, x, y, z) {
  const minX = Math.floor(x - HALF_W), maxX = Math.floor(x + HALF_W);
  const minY = Math.floor(y), maxY = Math.floor(y + HEIGHT);
  const minZ = Math.floor(z - HALF_W), maxZ = Math.floor(z + HALF_W);
  for (let bx = minX; bx <= maxX; bx++) {
    for (let by = minY; by <= maxY; by++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        if (world.getBlock(bx, by, bz) !== 0) return true;
      }
    }
  }
  return false;
}

export class Player {
  constructor(world, spawn) {
    this.world = world;
    this.pos = { x: spawn.x, y: spawn.y, z: spawn.z };
    this.spawn = { ...spawn };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = Math.PI;
    this.pitch = 0;
    this.grounded = false;
    this.hp = MAX_HP;
    this.maxHp = MAX_HP;
    this.invulnT = 0;
    this.hunger = MAX_HUNGER;
    this.maxHunger = MAX_HUNGER;
  }

  eat(amount) {
    this.hunger = Math.min(this.maxHunger, this.hunger + amount);
  }

  get eyePos() {
    return { x: this.pos.x, y: this.pos.y + EYE_HEIGHT, z: this.pos.z };
  }

  lookDelta(dx, dy) {
    this.yaw -= dx;
    this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch - dy));
  }

  forwardVector() {
    return { x: -Math.sin(this.yaw) * Math.cos(this.pitch), y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * Math.cos(this.pitch) };
  }

  takeDamage(amount) {
    if (this.invulnT > 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.invulnT = 0.8;
    return this.hp <= 0;
  }

  respawn() {
    this.pos = { ...this.spawn };
    this.vel = { x: 0, y: 0, z: 0 };
    this.hp = this.maxHp;
    this.hunger = this.maxHunger;
    this.invulnT = 1.2;
  }

  update(dt, moveX, moveZ, wantsJump) {
    if (this.invulnT > 0) this.invulnT -= dt;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // moveZ: forward(+1)/back(-1) relative to facing; moveX: strafe right(+1)/left(-1)
    const dirX = -sin * moveZ + cos * moveX;
    const dirZ = -cos * moveZ - sin * moveX;

    this.vel.x = dirX * MOVE_SPEED;
    this.vel.z = dirZ * MOVE_SPEED;

    if (wantsJump && this.grounded) {
      this.vel.y = JUMP_SPEED;
      this.grounded = false;
    }
    this.vel.y -= GRAVITY * dt;
    if (this.vel.y < -40) this.vel.y = -40;

    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);
    this.grounded = false;
    this.moveAxis('y', this.vel.y * dt);

    // Fell into a cave/pit deep enough to be unrecoverable.
    if (this.pos.y < -20) return 'fell';
    return null;
  }

  moveAxis(axis, delta) {
    if (delta === 0) return;
    const next = { ...this.pos };
    next[axis] += delta;
    if (!aabbHitsSolid(this.world, next.x, next.y, next.z)) {
      this.pos = next;
      return;
    }
    if (axis === 'y') {
      if (delta < 0) this.grounded = true;
      this.vel.y = 0;
    } else {
      this.vel[axis] = 0;
    }
  }
}

export { EYE_HEIGHT, MOVE_SPEED };
