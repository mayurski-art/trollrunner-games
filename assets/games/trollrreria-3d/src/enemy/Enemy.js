import { createBillboard } from '../render/SpriteTextures.js';
import { createProceduralBillboard } from '../render/ProceduralArt.js';
import { CHUNK_Y } from '../world/Chunk.js';

const KNOCKBACK_DECAY = 6; // per second, exponential-ish falloff

// A wandering mob whose stats/behavior come from an EnemyTypes config, so
// ground mobs and flyers share one implementation. Neutral by default —
// it only chases/attacks once the player has hit it at least once (see
// `provoked`); until then it just wanders harmlessly, matching
// Minecraft/Terraria's "you start it" convention rather than aggroing on
// sight. Player "attacks" it by pointing the crosshair at it and using the
// dig/interact button used for mining blocks (see Game.handleDig).
// Rendered as a camera-facing PixelLab billboard sprite rather than a 3D
// model — see render/SpriteTextures.js for why (this is a voxel-mesh
// world, not a textured one).
export class Enemy {
  constructor(scene, spawn, type) {
    this.type = type;
    this.pos = { ...spawn };
    this.hp = type.hp;
    this.maxHp = type.hp;
    this.alive = true;
    this.radius = type.radius;
    this.attackCooldown = 0;
    this.wanderTarget = null;
    this.wanderTimer = 0;
    this.knockbackVel = { x: 0, z: 0 };
    this.enraged = false;
    // Neutral until the player attacks it — mobs wander harmlessly and
    // never approach/attack on their own, only after being hit at least
    // once (bosses are the one exception: summoning one is provocation
    // enough by itself). Persists until it dies; leaving aggroRange just
    // makes it give up the chase, not forget the grudge.
    this.provoked = false;

    this.mesh = type.sprite.procedural
      ? createProceduralBillboard(type.sprite.kind, type.sprite.accent, type.size)
      : createBillboard(type.sprite.file, type.sprite.w, type.sprite.h, type.size);
    this.mesh.position.set(spawn.x, spawn.y, spawn.z);
    scene.add(this.mesh);
  }

  centerPos() {
    return { x: this.mesh.position.x, y: this.mesh.position.y + this.type.size / 2, z: this.mesh.position.z };
  }

  hit(damage, sourcePos) {
    this.provoked = true;
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

  effectiveDamage() {
    return this.enraged ? Math.round(this.type.damage * this.type.enrageDamageMult) : this.type.damage;
  }

  dispose(scene) {
    scene.remove(this.mesh); // material/texture are shared+cached — don't dispose here
  }

  update(dt, world, playerPos, peaceful = false) {
    if (!this.alive) return null;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    const t = this.type;
    if (t.enrageAt && !this.enraged && this.hp / this.maxHp <= t.enrageAt) this.enraged = true;

    const dx = playerPos.x - this.pos.x;
    const dz = playerPos.z - this.pos.z;
    const distToPlayer = Math.hypot(dx, dz);

    let moveX = 0, moveZ = 0, speed = t.wanderSpeed;
    // Neutral-mob model: only a provoked (already-attacked) mob or a boss
    // ever chases/attacks — plain proximity never triggers it. `peaceful`
    // (the post-spawn-in grace window) additionally suppresses even a
    // provoked non-boss mob, covering the edge case of a save/continue
    // where something was already provoked before the window started.
    const aggro = (this.provoked || t.isBoss) && !(peaceful && !t.isBoss) && distToPlayer < t.aggroRange;
    if (aggro) {
      speed = this.enraged ? t.chaseSpeed * t.enrageSpeedMult : t.chaseSpeed;
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
      const targetY = aggro ? playerPos.y + 1 : this.groundHeight(world, nextX, nextZ, this.pos.y) + t.hoverHeight;
      this.pos.y += (targetY - this.pos.y) * Math.min(1, dt * 2);
    } else {
      const groundY = this.findGround(world, nextX, this.pos.y, nextZ);
      if (groundY !== null) {
        this.pos.x = nextX;
        this.pos.z = nextZ;
        this.pos.y = groundY;
      }
    }

    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);

    const canAttack = (this.provoked || t.isBoss) && !(peaceful && !t.isBoss);
    if (canAttack && distToPlayer < t.attackRange && this.attackCooldown <= 0) {
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

  // Bounded local search around the mob's current height first, so a bat
  // wandering in a cave hovers near the cave floor/ceiling around it
  // rather than trying to fly all the way up to the distant outdoor
  // surface (there's no collision check on flying movement, so that would
  // otherwise mean levitating straight through solid rock). Falls back to
  // the old always-hits-something full downward scan if nothing's found
  // nearby (e.g. genuinely floating in open outdoor air).
  groundHeight(world, x, z, nearY = 40) {
    const startY = Math.min(CHUNK_Y - 1, Math.round(nearY) + 6);
    const endY = Math.max(0, Math.round(nearY) - 20);
    for (let y = startY; y >= endY; y--) {
      if (world.getBlock(Math.floor(x), y, Math.floor(z)) !== 0) return y + 1;
    }
    for (let y = CHUNK_Y - 1; y >= 0; y--) {
      if (world.getBlock(Math.floor(x), y, Math.floor(z)) !== 0) return y + 1;
    }
    return 14;
  }
}
