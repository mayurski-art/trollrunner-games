import * as THREE from 'three';
import { LANES, SPAWN_Z, DESPAWN_Z } from '../core/constants.js';
import { OBSTACLE_TYPES } from '../data/obstacles.js';
import { makeCoinFaceTexture } from './textures.js';

const COIN_RADIUS = 0.34;

// Troll Coin spawning, motion (spin + bob), pickup detection and the
// collect pop effect. Magnet support (Phase 5) hooks into update().
export class CoinManager {
  constructor(scene) {
    this.scene = scene;
    this.coins = [];
    this.geo = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, 0.08, 18);
    const rim = new THREE.MeshStandardMaterial({
      color: 0xffc233, emissive: 0xff9500, emissiveIntensity: 0.55,
      roughness: 0.25, metalness: 0.7,
    });
    // Troll emoji face on both caps; rim stays metallic gold.
    const face = new THREE.MeshStandardMaterial({
      map: makeCoinFaceTexture(), emissive: 0xff9500, emissiveIntensity: 0.22,
      roughness: 0.3, metalness: 0.4,
    });
    this.mat = [rim, face, face]; // Cylinder groups: side, top, bottom.
    this.time = 0;
  }

  reset() {
    for (const c of this.coins) this.scene.remove(c.group);
    this.coins = [];
  }

  spawnCoin(x, y, z) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.rotation.x = Math.PI / 2; // Flat face toward the player, spins on y.
    group.add(mesh);
    group.position.set(x, y, z);
    this.scene.add(group);
    this.coins.push({ group, x, baseY: y, z, popping: false, popT: 0, phase: Math.random() * 6.28 });
  }

  spawnLine(lane, zStart, count = 6, spacing = 1.7) {
    for (let i = 0; i < count; i++) {
      this.spawnCoin(LANES[lane], 0.95, zStart - i * spacing);
    }
  }

  // Parabolic arc over a jump obstacle at zCenter.
  spawnArc(lane, zCenter) {
    for (let i = 0; i < 7; i++) {
      const dz = -3.9 + i * 1.3;
      const y = Math.max(0.95, 2.35 - 0.135 * dz * dz);
      this.spawnCoin(LANES[lane], y, zCenter + dz);
    }
  }

  // Called with each freshly spawned obstacle pattern: lay coins on the free
  // lane between patterns, or arc them over a jumpable obstacle (risk/reward).
  decoratePattern(pattern) {
    if (Math.random() < 0.18) return; // Occasional dry stretch keeps coins special.
    const used = new Set(pattern.entries.map((e) => e.lane));
    const jumpables = pattern.entries.filter((e) => OBSTACLE_TYPES[e.type].action === 'jump');
    if (jumpables.length && Math.random() < 0.5) {
      const target = jumpables[Math.floor(Math.random() * jumpables.length)];
      this.spawnArc(target.lane, SPAWN_Z - (target.dz || 0));
      return;
    }
    const free = [0, 1, 2].filter((l) => !used.has(l));
    if (free.length) {
      const lane = free[Math.floor(Math.random() * free.length)];
      this.spawnLine(lane, SPAWN_Z - pattern.depth - 4, 6);
    }
  }

  update(dt, speed) {
    this.time += dt;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.z += speed * dt;
      if (c.popping) {
        // Collect pop: quick rise + shrink, then remove.
        c.popT += dt;
        const t = c.popT / 0.16;
        c.group.scale.setScalar(Math.max(0.001, 1 - t));
        c.group.position.set(c.x, c.baseY + t * 0.7, c.z);
        if (t >= 1) {
          this.scene.remove(c.group);
          this.coins.splice(i, 1);
        }
        continue;
      }
      c.group.rotation.y += dt * 3.4;
      c.group.position.set(c.x, c.baseY + Math.sin(this.time * 3 + c.phase) * 0.07, c.z);
      if (c.z > DESPAWN_Z) {
        this.scene.remove(c.group);
        this.coins.splice(i, 1);
      }
    }
  }

  // Magnet powerup: pull nearby coins (any lane) toward the player.
  attract(px, py, dt) {
    const k = Math.min(1, 9 * dt);
    for (const c of this.coins) {
      if (c.popping) continue;
      if (c.z < -14 || c.z > 4) continue;
      c.x += (px - c.x) * k;
      c.baseY += (py - c.baseY) * k;
    }
  }

  // Returns how many coins the player grabbed this frame. onGrab(x, y, z)
  // fires per coin so effects can burst at the pickup point.
  collect(playerBox, onGrab) {
    let got = 0;
    for (const c of this.coins) {
      if (c.popping) continue;
      if (c.z < playerBox.minZ - COIN_RADIUS || c.z > playerBox.maxZ + COIN_RADIUS) continue;
      if (c.x < playerBox.minX - COIN_RADIUS || c.x > playerBox.maxX + COIN_RADIUS) continue;
      if (c.baseY + COIN_RADIUS < playerBox.minY || c.baseY - COIN_RADIUS > playerBox.maxY) continue;
      c.popping = true;
      got++;
      if (onGrab) onGrab(c.x, c.baseY, c.z);
    }
    return got;
  }
}
