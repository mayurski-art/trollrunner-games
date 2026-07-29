import * as THREE from 'three';

const WANDER_SPEED = 1.1;
const CHASE_SPEED = 2.4;
const AGGRO_RANGE = 8;
const ATTACK_RANGE = 1.1;
const ATTACK_COOLDOWN = 1.1;
const MAX_HP = 3;

// A single wandering/chasing mob ("Troll Grub") — v1 MVP has exactly one.
// Player "attacks" it by pointing the crosshair at it and using the same
// dig/interact button used for mining blocks.
export class Enemy {
  constructor(scene, spawn) {
    this.pos = { ...spawn };
    this.vel = { x: 0, y: 0, z: 0 };
    this.hp = MAX_HP;
    this.alive = true;
    this.radius = 0.5;
    this.attackCooldown = 0;
    this.wanderTarget = null;
    this.wanderTimer = 0;

    const geo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    const mat = new THREE.MeshLambertMaterial({ color: 0x7a2ea6 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(spawn.x, spawn.y + 0.45, spawn.z);
    scene.add(this.mesh);
  }

  centerPos() {
    return { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z };
  }

  hit(damage = 1) {
    this.hp -= damage;
    if (this.hp <= 0) this.die();
    return this.hp <= 0;
  }

  die() {
    this.alive = false;
    this.mesh.visible = false;
  }

  update(dt, world, playerPos) {
    if (!this.alive) return null;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    const dx = playerPos.x - this.pos.x;
    const dz = playerPos.z - this.pos.z;
    const distToPlayer = Math.hypot(dx, dz);

    let moveX = 0, moveZ = 0, speed = WANDER_SPEED;
    if (distToPlayer < AGGRO_RANGE) {
      speed = CHASE_SPEED;
      moveX = dx / (distToPlayer || 1);
      moveZ = dz / (distToPlayer || 1);
    } else {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        const angle = Math.random() * Math.PI * 2;
        this.wanderTarget = { x: this.pos.x + Math.cos(angle) * 4, z: this.pos.z + Math.sin(angle) * 4 };
        this.wanderTimer = 2 + Math.random() * 2;
      }
      if (this.wanderTarget) {
        const wx = this.wanderTarget.x - this.pos.x;
        const wz = this.wanderTarget.z - this.pos.z;
        const wd = Math.hypot(wx, wz) || 1;
        moveX = wx / wd;
        moveZ = wz / wd;
      }
    }

    const nextX = this.pos.x + moveX * speed * dt;
    const nextZ = this.pos.z + moveZ * speed * dt;
    const groundY = this.findGround(world, nextX, this.pos.y, nextZ);
    if (groundY !== null) {
      this.pos.x = nextX;
      this.pos.z = nextZ;
      this.pos.y = groundY;
    }

    this.mesh.position.set(this.pos.x, this.pos.y + 0.45, this.pos.z);

    if (distToPlayer < ATTACK_RANGE && this.attackCooldown <= 0) {
      this.attackCooldown = ATTACK_COOLDOWN;
      return 'attack';
    }
    return null;
  }

  // Simple ground-following: drop/rise the mob onto the top solid block below it.
  findGround(world, x, y, z) {
    let by = Math.round(y);
    for (let i = 0; i < 4; i++) {
      if (world.getBlock(Math.floor(x), by, Math.floor(z)) !== 0) return by + 1;
      if (world.getBlock(Math.floor(x), by - 1, Math.floor(z)) === 0) { by -= 1; continue; }
      return by;
    }
    return by;
  }
}
