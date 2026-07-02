import * as THREE from 'three';
import { LANES, SPAWN_Z, DESPAWN_Z } from '../core/constants.js';
import { POWERUPS } from '../data/powerups.js';
import { makePowerupTexture } from './textures.js';

const PICKUP_RADIUS = 0.55;
const MIN_SPAWN_GAP = 260; // world units of track between powerup pickups
const ROCKET_SPEED_MULT = 1.35;
const POST_HIT_GRACE = 0.9; // seconds of invulnerability after a shield break

// Spawns powerup pickups on the track and runs the active-powerup state:
// magnet (coin attraction), shield (absorbs one crash), rocket (fly over
// everything at boosted speed). Game.tick asks this manager for the
// current modifiers each frame.
export class PowerupManager {
  constructor(scene) {
    this.scene = scene;
    this.textures = {};
    for (const def of Object.values(POWERUPS)) {
      this.textures[def.id] = makePowerupTexture(def.emoji, def.color);
    }
    this.pickups = [];
    this.reset();
  }

  reset() {
    for (const p of this.pickups) this.scene.remove(p.group);
    this.pickups = [];
    this.distSinceSpawn = 0;
    this.magnetTimer = 0;
    this.rocketTimer = 0;
    this.shielded = false;
    this.graceTimer = 0;
    this.time = 0;
  }

  get rocketActive() { return this.rocketTimer > 0; }
  get magnetActive() { return this.magnetTimer > 0; }
  get invincible() { return this.rocketActive || this.graceTimer > 0; }
  get speedMultiplier() { return this.rocketActive ? ROCKET_SPEED_MULT : 1; }

  // Chips for the HUD, most urgent first.
  hudStatus() {
    const out = [];
    if (this.rocketActive) out.push({ emoji: '🚀', remain: this.rocketTimer });
    if (this.magnetActive) out.push({ emoji: '🧲', remain: this.magnetTimer });
    if (this.shielded) out.push({ emoji: '🛡️', remain: null });
    return out;
  }

  // Called when an obstacle pattern spawns: occasionally drop a pickup on a
  // lane the pattern leaves free, past the pattern itself.
  maybeSpawn(pattern, difficulty) {
    if (this.distSinceSpawn < MIN_SPAWN_GAP) return;
    if (Math.random() < 0.45) return; // Keep pickups feeling like finds.
    const pool = Object.values(POWERUPS).filter((d) => d.tier <= difficulty.level);
    const def = pool[Math.floor(Math.random() * pool.length)];
    const used = new Set(pattern.entries.map((e) => e.lane));
    const free = [0, 1, 2].filter((l) => !used.has(l));
    const lane = free.length
      ? free[Math.floor(Math.random() * free.length)]
      : Math.floor(Math.random() * 3);
    this.spawnPickup(def, lane, SPAWN_Z - pattern.depth - 12);
    this.distSinceSpawn = 0;
  }

  spawnPickup(def, lane, z) {
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34),
      new THREE.MeshStandardMaterial({
        color: def.color, emissive: def.color, emissiveIntensity: 0.75, roughness: 0.3,
      }),
    );
    const icon = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.62),
      new THREE.MeshBasicMaterial({
        map: this.textures[def.id], transparent: true, toneMapped: false, depthWrite: false,
      }),
    );
    icon.position.z = 0.05;
    group.add(core, icon);
    group.position.set(LANES[lane], 1.15, z);
    this.scene.add(group);
    this.pickups.push({ def, group, core, icon, z, x: LANES[lane] });
  }

  activate(def, audio) {
    if (def.id === 'magnet') this.magnetTimer = def.duration;
    else if (def.id === 'rocket') this.rocketTimer = def.duration;
    else if (def.id === 'shield') this.shielded = true;
    audio.play('powerup');
  }

  // A hard hit landed: absorb it if shielded. Returns true when absorbed.
  absorbHit(audio) {
    if (this.graceTimer > 0) return true;
    if (!this.shielded) return false;
    this.shielded = false;
    this.graceTimer = POST_HIT_GRACE;
    audio.play('shieldBreak');
    return true;
  }

  // Returns the picked-up def (if any) this frame.
  update(dt, speed, playerBox) {
    this.time += dt;
    this.distSinceSpawn += speed * dt;
    if (this.magnetTimer > 0) this.magnetTimer -= dt;
    if (this.rocketTimer > 0) {
      this.rocketTimer -= dt;
      // Rocket just ended: brief grace so the player doesn't land inside
      // an obstacle they were flying over.
      if (this.rocketTimer <= 0) this.graceTimer = POST_HIT_GRACE;
    }
    if (this.graceTimer > 0) this.graceTimer -= dt;

    let picked = null;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.z += speed * dt;
      p.core.rotation.y += dt * 2.6;
      p.group.position.set(p.x, 1.15 + Math.sin(this.time * 2.5) * 0.09, p.z);
      const gone = p.z > DESPAWN_Z;
      const hit = playerBox
        && p.z > playerBox.minZ - PICKUP_RADIUS && p.z < playerBox.maxZ + PICKUP_RADIUS
        && p.x > playerBox.minX - PICKUP_RADIUS && p.x < playerBox.maxX + PICKUP_RADIUS
        && 1.15 > playerBox.minY - PICKUP_RADIUS && 1.15 < playerBox.maxY + PICKUP_RADIUS;
      if (hit) picked = p.def;
      if (gone || hit) {
        this.scene.remove(p.group);
        this.pickups.splice(i, 1);
      }
    }
    return picked;
  }
}
