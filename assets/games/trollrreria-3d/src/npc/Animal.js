import { createBillboard } from '../render/SpriteTextures.js';
import { createProceduralBillboard } from '../render/ProceduralArt.js';

const WANDER_SPEED = 0.8;
const WANDER_RADIUS = 6;
const SPRITE_HEIGHT = 0.8;
const MAX_HP = 6;
const BREED_COOLDOWN = 60;
// How many feedings a wild Trike needs before it tames — deliberately more
// than the single feed that just marks a boar `fed` for breeding, so taming
// reads as a real investment (ARK-style) rather than a free instant pet.
const TAME_FEEDS_REQUIRED = 3;
const FOLLOW_SPEED = 2.6;
const FOLLOW_DIST = 2.5;
const GUARD_RANGE = 9;
const TAME_HP = 16;

// A passive, killable wild animal (the "husbandry" half of the survival
// loop — a reliable meat source you can feed and breed, unlike the RNG
// drop from killing Troll Grubs). Wanders freely, never attacks. Feeding
// it Wheat marks it `fed`; Game._loop pairs up two nearby fed animals into
// a new baby (see Game._tickAnimalBreeding).
//
// `kind: 'trike'` additionally makes it tameable: repeated feeding (see
// `feed()`) builds up `tameProgress`, and at TAME_FEEDS_REQUIRED it becomes
// `tamed` — follows the player and gores the nearest aggroed enemy instead
// of wandering. Plain boars (`kind: 'boar'`, the default) never tame.
export class Animal {
  constructor(scene, world, spawn, kind = 'boar') {
    this.world = world;
    this.kind = kind;
    this.pos = { ...spawn };
    this.hp = MAX_HP;
    this.maxHp = MAX_HP;
    this.alive = true;
    this.radius = 0.45;
    this.wanderTarget = null;
    this.wanderTimer = Math.random() * 2;
    this.fed = false;
    this.breedCooldown = 0;
    this.tameProgress = 0;
    this.tamed = false;
    this.attackCooldown = 0;

    this.mesh = kind === 'trike'
      ? createProceduralBillboard('trike', '#ffb703', SPRITE_HEIGHT)
      : createBillboard('troll-boar.png', 64, 48, SPRITE_HEIGHT);
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

  // Called on right-click-with-wheat. A tamed animal is done taming (marks
  // `fed` for breeding like a boar always did); an untamed Trike instead
  // advances toward taming and only becomes `fed`-for-breeding afterward.
  feed() {
    if (this.kind === 'trike' && !this.tamed) {
      this.tameProgress += 1;
      if (this.tameProgress >= TAME_FEEDS_REQUIRED) {
        this.tamed = true;
        this.hp = TAME_HP;
        this.maxHp = TAME_HP;
      }
      return;
    }
    this.fed = true;
  }

  update(dt, opts = {}) {
    if (!this.alive) return;
    if (this.breedCooldown > 0) this.breedCooldown -= dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    if (this.tamed) {
      this._updateTamed(dt, opts);
    } else {
      this._updateWander(dt);
    }
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
  }

  // Tamed behavior: stay near the player (teleport-free, walk-follow), and
  // gore the nearest enemy inside GUARD_RANGE — a real ARK-style tamed
  // companion, not just a cosmetic follower.
  _updateTamed(dt, { playerPos, enemies } = {}) {
    if (!playerPos) return this._updateWander(dt);

    let nearestEnemy = null, nearestDist = GUARD_RANGE;
    for (const e of enemies || []) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (d < nearestDist) { nearestDist = d; nearestEnemy = e; }
    }

    if (nearestEnemy) {
      const dx = nearestEnemy.pos.x - this.pos.x, dz = nearestEnemy.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d > 1.0) {
        const nextX = this.pos.x + (dx / d) * FOLLOW_SPEED * dt;
        const nextZ = this.pos.z + (dz / d) * FOLLOW_SPEED * dt;
        this._moveTo(nextX, nextZ);
      } else if (this.attackCooldown <= 0) {
        this.attackCooldown = 0.9;
        nearestEnemy.hit(4, this.pos);
      }
      return;
    }

    const dx = playerPos.x - this.pos.x, dz = playerPos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > FOLLOW_DIST) {
      const nextX = this.pos.x + (dx / d) * FOLLOW_SPEED * dt;
      const nextZ = this.pos.z + (dz / d) * FOLLOW_SPEED * dt;
      this._moveTo(nextX, nextZ);
    }
  }

  _updateWander(dt) {
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
        this._moveTo(nextX, nextZ);
      }
    }
  }

  _moveTo(nextX, nextZ) {
    const groundY = this.findGround(nextX, nextZ);
    if (groundY !== null) {
      this.pos.x = nextX;
      this.pos.z = nextZ;
      this.pos.y = groundY;
    }
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

export { BREED_COOLDOWN, TAME_FEEDS_REQUIRED };
