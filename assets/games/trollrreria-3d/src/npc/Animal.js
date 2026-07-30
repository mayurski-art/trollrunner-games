import { createBillboard } from '../render/SpriteTextures.js';

const WANDER_SPEED = 0.8;
const WANDER_RADIUS = 6;
const SPRITE_HEIGHT = 0.8;
const MAX_HP = 6;
const BREED_COOLDOWN = 60;

// A passive, killable wild animal (the "husbandry" half of the survival
// loop — a reliable meat source you can feed and breed, unlike the RNG
// drop from killing Troll Grubs). Wanders freely, never attacks. Feeding
// it Wheat marks it `fed`; Game._loop pairs up two nearby fed animals into
// a new baby (see Game._tickAnimalBreeding).
export class Animal {
  constructor(scene, world, spawn) {
    this.world = world;
    this.pos = { ...spawn };
    this.hp = MAX_HP;
    this.alive = true;
    this.radius = 0.45;
    this.wanderTarget = null;
    this.wanderTimer = Math.random() * 2;
    this.fed = false;
    this.breedCooldown = 0;

    this.mesh = createBillboard('troll-boar.png', 64, 48, SPRITE_HEIGHT);
    this.mesh.position.set(spawn.x, spawn.y, spawn.z);
    scene.add(this.mesh);
  }

  centerPos() {
    return { x: this.mesh.position.x, y: this.mesh.position.y + SPRITE_HEIGHT / 2, z: this.mesh.position.z };
  }

  hit(damage) {
    this.hp -= damage;
    if (this.hp <= 0) this.die();
    return this.hp <= 0;
  }

  die() {
    this.alive = false;
    this.mesh.visible = false;
  }

  feed() {
    this.fed = true;
  }

  update(dt) {
    if (!this.alive) return;
    if (this.breedCooldown > 0) this.breedCooldown -= dt;

    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * WANDER_RADIUS;
      this.wanderTarget = { x: this.pos.x + Math.cos(angle) * dist, z: this.pos.z + Math.sin(angle) * dist };
      this.wanderTimer = 2 + Math.random() * 3;
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
    scene.remove(this.mesh);
  }
}

export { BREED_COOLDOWN };
