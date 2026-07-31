import { BLOCKS } from '../world/blocks.js';

const HALF_W = 0.3;
const HEIGHT = 1.7;
const EYE_HEIGHT = 1.55;
const GRAVITY = 24;
const JUMP_SPEED = 8.2;
const MOVE_SPEED = 5.2;
const MAX_HP = 100;
const MAX_HUNGER = 100;
const WATER_GRAVITY_MULT = 0.35; // gentle sink instead of falling through water at full speed — see Player.update

// Phase 6 — combat overhaul: dodge roll (a brief dash + invulnerability
// window, on a cooldown so it can't be spammed), block (halves move speed
// while held — the damage reduction itself is applied by Game.js at the
// hit site, same place armor reduction already is), and a snow-mob slow
// status effect.
const DODGE_SPEED = 13;
const DODGE_DURATION = 0.18;
const DODGE_INVULN = 0.35;
const DODGE_COOLDOWN = 1.2;
const BLOCK_MOVE_MULT = 0.5;
const SLOW_MOVE_MULT = 0.55;

// Feet-anchored AABB voxel collision: axis-separated resolve (move X, clamp
// on overlap; then Y; then Z) — simple and stable enough for a small world.
// WATER is solid for rendering/meshing (see Chunk.js) but deliberately NOT
// solid here — static water (phase 3) is walk/fall-through, not a wall.
function aabbHitsSolid(world, x, y, z) {
  const minX = Math.floor(x - HALF_W), maxX = Math.floor(x + HALF_W);
  const minY = Math.floor(y), maxY = Math.floor(y + HEIGHT);
  const minZ = Math.floor(z - HALF_W), maxZ = Math.floor(z + HALF_W);
  for (let bx = minX; bx <= maxX; bx++) {
    for (let by = minY; by <= maxY; by++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        const id = world.getBlock(bx, by, bz);
        if (id !== BLOCKS.AIR && id !== BLOCKS.WATER) return true;
      }
    }
  }
  return false;
}

function isInWater(world, pos) {
  return world.getBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)) === BLOCKS.WATER;
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
    this.dashTimer = 0;
    this.dashVel = { x: 0, z: 0 };
    this.dodgeCooldownTimer = 0;
    this.slowTimer = 0; // snow-mob freeze status — see Game._tickWorldEvents-adjacent attacker handling
  }

  // Dodge roll: a short fixed-velocity dash in the current move direction
  // (falls back to facing direction if not moving) with a brief i-frame
  // window, on its own cooldown. moveX/moveZ are the same raw WASD-space
  // values Player.update takes, not world-space.
  dodge(moveX, moveZ) {
    if (this.dodgeCooldownTimer > 0) return false;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let dirX, dirZ;
    if (moveX === 0 && moveZ === 0) {
      dirX = -sin; dirZ = -cos; // facing direction
    } else {
      dirX = -sin * moveZ + cos * moveX;
      dirZ = -cos * moveZ - sin * moveX;
      const len = Math.hypot(dirX, dirZ) || 1;
      dirX /= len; dirZ /= len;
    }
    this.dashVel = { x: dirX * DODGE_SPEED, z: dirZ * DODGE_SPEED };
    this.dashTimer = DODGE_DURATION;
    this.invulnT = Math.max(this.invulnT, DODGE_INVULN);
    this.dodgeCooldownTimer = DODGE_COOLDOWN;
    return true;
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
    this.dashTimer = 0;
    this.slowTimer = 0;
  }

  update(dt, moveX, moveZ, wantsJump, blocking = false) {
    if (this.invulnT > 0) this.invulnT -= dt;
    if (this.dodgeCooldownTimer > 0) this.dodgeCooldownTimer -= dt;
    if (this.slowTimer > 0) this.slowTimer -= dt;

    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      this.vel.x = this.dashVel.x;
      this.vel.z = this.dashVel.z;
    } else {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // moveZ: forward(+1)/back(-1) relative to facing; moveX: strafe right(+1)/left(-1)
      const dirX = -sin * moveZ + cos * moveX;
      const dirZ = -cos * moveZ - sin * moveX;
      let speed = MOVE_SPEED;
      if (blocking) speed *= BLOCK_MOVE_MULT;
      if (this.slowTimer > 0) speed *= SLOW_MOVE_MULT;

      this.vel.x = dirX * speed;
      this.vel.z = dirZ * speed;
    }

    const inWater = isInWater(this.world, this.pos);
    if (wantsJump && (this.grounded || inWater)) {
      this.vel.y = inWater ? JUMP_SPEED * WATER_GRAVITY_MULT * 2 : JUMP_SPEED;
      this.grounded = false;
    }
    this.vel.y -= GRAVITY * (inWater ? WATER_GRAVITY_MULT : 1) * dt;
    const terminal = inWater ? -6 : -40;
    if (this.vel.y < terminal) this.vel.y = terminal;

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
