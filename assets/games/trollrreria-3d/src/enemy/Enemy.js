import * as THREE from 'three';

const KNOCKBACK_DECAY = 6; // per second, exponential-ish falloff

// A wandering/chasing mob whose stats/behavior come from an EnemyTypes
// config, so ground mobs and flyers share one implementation. Player
// "attacks" it by pointing the crosshair at it and using the dig/interact
// button used for mining blocks (see Game.handleDig).
export class Enemy {
  constructor(scene, spawn, type) {
    this.type = type;
    this.pos = { ...spawn };
    this.hp = type.hp;
    this.alive = true;
    this.radius = type.radius;
    this.attackCooldown = 0;
    this.wanderTarget = null;
    this.wanderTimer = 0;
    this.knockbackVel = { x: 0, z: 0 };

    const geo = new THREE.BoxGeometry(type.size, type.size, type.size);
    const mat = new THREE.MeshLambertMaterial({ color: type.color });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(spawn.x, spawn.y + type.size / 2, spawn.z);
    scene.add(this.mesh);
  }

  centerPos() {
    return { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z };
  }

  hit(damage, sourcePos) {
    this.hp -= damage;
    if (sourcePos) {
      const dx = this.pos.x - sourcePos.x, dz = this.pos.z - sourcePos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.knockbackVel = { x: (dx / d) * 6, z: (dz / d) * 6 };
    }
    if (this.hp <= 0) this.die();
    return this.hp <= 0;
  }

  die() {
    this.alive = false;
    this.mesh.visible = false;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  update(dt, world, playerPos) {
    if (!this.alive) return null;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    const dx = playerPos.x - this.pos.x;
    const dz = playerPos.z - this.pos.z;
    const distToPlayer = Math.hypot(dx, dz);
    const t = this.type;

    let moveX = 0, moveZ = 0, speed = t.wanderSpeed;
    const aggro = distToPlayer < t.aggroRange;
    if (aggro) {
      speed = t.chaseSpeed;
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

    const decay = Math.exp(-KNOCKBACK_DECAY * dt);
    this.knockbackVel.x *= decay;
    this.knockbackVel.z *= decay;

    const nextX = this.pos.x + moveX * speed * dt + this.knockbackVel.x * dt;
    const nextZ = this.pos.z + moveZ * speed * dt + this.knockbackVel.z * dt;

    if (t.flies) {
      this.pos.x = nextX;
      this.pos.z = nextZ;
      const targetY = aggro ? playerPos.y + 1 : this.groundHeight(world, nextX, nextZ) + t.hoverHeight;
      this.pos.y += (targetY - this.pos.y) * Math.min(1, dt * 2);
    } else {
      const groundY = this.findGround(world, nextX, this.pos.y, nextZ);
      if (groundY !== null) {
        this.pos.x = nextX;
        this.pos.z = nextZ;
        this.pos.y = groundY;
      }
    }

    this.mesh.position.set(this.pos.x, this.pos.y + t.size / 2, this.pos.z);

    if (distToPlayer < t.attackRange && this.attackCooldown <= 0) {
      this.attackCooldown = t.attackCooldown;
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

  groundHeight(world, x, z) {
    for (let y = 40; y >= 0; y--) {
      if (world.getBlock(Math.floor(x), y, Math.floor(z)) !== 0) return y + 1;
    }
    return 14;
  }
}
