import * as THREE from 'three';

const WANDER_SPEED = 0.7;
const LEASH_RADIUS = 4; // won't wander farther than this from home

// A gently-wandering, non-hostile townsperson — cosmetic + a one-line
// greeting on interact (see Game.handlePlace). Unlike Enemy, never chases
// or attacks the player; stays near its home point around the village.
export class Villager {
  constructor(scene, world, home, name, line, color) {
    this.world = world;
    this.home = { ...home };
    this.pos = { ...home };
    this.name = name;
    this.line = line;
    this.radius = 0.5;
    this.alive = true; // performRaycast's entity filter requires this
    this.wanderTarget = null;
    this.wanderTimer = Math.random() * 2;

    const geo = new THREE.CapsuleGeometry(0.3, 1.0, 4, 8);
    const mat = new THREE.MeshLambertMaterial({ color });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(home.x, home.y + 0.8, home.z);
    scene.add(this.mesh);
  }

  centerPos() {
    return { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z };
  }

  hit() {
    return false; // can't be hurt, same as the Merchant
  }

  update(dt) {
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * LEASH_RADIUS;
      this.wanderTarget = { x: this.home.x + Math.cos(angle) * dist, z: this.home.z + Math.sin(angle) * dist };
      this.wanderTimer = 3 + Math.random() * 4;
    }
    if (this.wanderTarget) {
      const dx = this.wanderTarget.x - this.pos.x, dz = this.wanderTarget.z - this.pos.z;
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
    this.mesh.position.set(this.pos.x, this.pos.y + 0.8, this.pos.z);
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
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
