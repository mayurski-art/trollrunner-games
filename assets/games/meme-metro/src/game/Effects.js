import * as THREE from 'three';

const SPARKLE_POOL = 48;
const DUST_POOL = 26;
const STREAK_COUNT = 14;

// Lightweight juice layer: coin sparkle bursts, dust under the runner and
// speed streaks at high speed. Everything is pooled — nothing allocates
// per frame — and all of it is cosmetic, so gameplay code only calls in.
export class Effects {
  constructor(scene) {
    this.scene = scene;

    // Sparkles: tiny additive gold quads that fly outward and fade.
    this.sparkles = [];
    const sparkGeo = new THREE.PlaneGeometry(0.13, 0.13);
    for (let i = 0; i < SPARKLE_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd257, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });
      const mesh = new THREE.Mesh(sparkGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.sparkles.push({ mesh, life: 0, vel: new THREE.Vector3() });
    }

    // Dust: soft dark puffs kicked up behind the runner's feet.
    this.dust = [];
    const dustGeo = new THREE.PlaneGeometry(0.3, 0.3);
    for (let i = 0; i < DUST_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x8f86a8, transparent: true, opacity: 0, depthWrite: false,
      });
      const mesh = new THREE.Mesh(dustGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.dust.push({ mesh, life: 0 });
    }
    this.dustTimer = 0;

    // Speed streaks: long thin lines beside the track that only show at
    // high speed, selling velocity without cluttering the play area.
    this.streaks = [];
    const streakGeo = new THREE.BoxGeometry(0.05, 0.05, 7);
    this.streakMat = new THREE.MeshBasicMaterial({
      color: 0xbfd8ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    for (let i = 0; i < STREAK_COUNT; i++) {
      const mesh = new THREE.Mesh(streakGeo, this.streakMat);
      const side = i % 2 === 0 ? -1 : 1;
      mesh.position.set(
        side * (4.6 + Math.random() * 2.2),
        0.6 + Math.random() * 4.2,
        -120 + Math.random() * 130,
      );
      scene.add(mesh);
      this.streaks.push(mesh);
    }
  }

  reset() {
    for (const s of this.sparkles) { s.life = 0; s.mesh.visible = false; }
    for (const d of this.dust) { d.life = 0; d.mesh.visible = false; }
    this.streakMat.opacity = 0;
  }

  // Gold burst at a collected coin's position.
  coinBurst(x, y, z) {
    let spawned = 0;
    for (const s of this.sparkles) {
      if (s.life > 0) continue;
      s.life = 0.42;
      s.mesh.visible = true;
      s.mesh.position.set(x, y, z);
      s.mesh.scale.setScalar(0.7 + Math.random() * 0.9);
      const a = Math.random() * Math.PI * 2;
      s.vel.set(Math.cos(a) * 2.6, 1.6 + Math.random() * 2.4, Math.sin(a) * 1.4);
      if (++spawned >= 7) break;
    }
  }

  spawnDustPuff(x, z) {
    for (const d of this.dust) {
      if (d.life > 0) continue;
      d.life = 0.5;
      d.mesh.visible = true;
      d.mesh.position.set(x + (Math.random() - 0.5) * 0.3, 0.08, z + 0.4);
      d.mesh.scale.setScalar(0.6 + Math.random() * 0.5);
      return;
    }
  }

  // speedT is 0..1 (currentSpeed normalized between base and max).
  update(dt, speed, speedT, player, camera) {
    for (const s of this.sparkles) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0 || s.mesh.position.z > 4) {
        s.life = 0;
        s.mesh.visible = false;
        continue;
      }
      s.vel.y -= 7 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.position.z += speed * dt;
      s.mesh.material.opacity = Math.min(1, s.life / 0.28);
      s.mesh.quaternion.copy(camera.quaternion); // billboard
    }

    // Dust puffs drift back with the world and dissolve.
    this.dustTimer -= dt;
    if (player && player.grounded && player.state === 'running' && this.dustTimer <= 0 && speed > 1) {
      this.spawnDustPuff(player.x, 0);
      this.dustTimer = 0.085;
    }
    for (const d of this.dust) {
      if (d.life <= 0) continue;
      d.life -= dt;
      // Kill puffs before they billboard into the camera at high speed.
      if (d.life <= 0 || d.mesh.position.z > 3.5) {
        d.life = 0;
        d.mesh.visible = false;
        continue;
      }
      d.mesh.position.z += speed * dt * 0.9;
      d.mesh.position.y += dt * 0.55;
      d.mesh.scale.multiplyScalar(1 + dt * 2.4);
      d.mesh.material.opacity = d.life * 0.5;
      d.mesh.quaternion.copy(camera.quaternion);
    }

    // Streaks fade in past ~55% speed and fly by faster than the world.
    const streakAlpha = Math.max(0, (speedT - 0.55) / 0.45) * 0.55;
    this.streakMat.opacity += (streakAlpha - this.streakMat.opacity) * Math.min(1, 4 * dt);
    if (this.streakMat.opacity > 0.01) {
      for (const m of this.streaks) {
        m.position.z += speed * 2.4 * dt;
        if (m.position.z > 12) {
          m.position.z = -125 - Math.random() * 25;
          m.position.y = 0.6 + Math.random() * 4.2;
        }
      }
    }
  }
}
