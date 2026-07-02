import * as THREE from 'three';
import { LANES, SPAWN_Z, DESPAWN_Z } from '../core/constants.js';
import { OBSTACLE_TYPES, PATTERNS } from '../data/obstacles.js';

// Spawns, scrolls and recycles obstacles. Visual builders here are
// placeholder primitives shaped/colored per the concept sheets; each is a
// self-contained function so final models can replace them one at a time.
export class ObstacleManager {
  constructor(scene) {
    this.scene = scene;
    this.active = [];
    this.mats = {
      dark: new THREE.MeshStandardMaterial({ color: 0x1d1730, roughness: 0.8 }),
      trainBody: new THREE.MeshStandardMaterial({ color: 0x191521, roughness: 0.6, metalness: 0.3 }),
      redGlow: new THREE.MeshStandardMaterial({ color: 0xb3122e, emissive: 0xff2038, emissiveIntensity: 0.8, roughness: 0.4 }),
      laser: new THREE.MeshBasicMaterial({ color: 0xff2038, toneMapped: false }),
      goldTrim: new THREE.MeshStandardMaterial({ color: 0xffb300, emissive: 0xffb300, emissiveIntensity: 0.5, roughness: 0.35 }),
      rug: new THREE.MeshStandardMaterial({ color: 0x7a1024, roughness: 0.9 }),
      neonPurple: new THREE.MeshBasicMaterial({ color: 0xb84dff, toneMapped: false }),
    };
    this.reset();
  }

  reset() {
    for (const o of this.active) this.scene.remove(o.mesh);
    this.active = [];
    this.distSinceSpawn = 0;
    this.nextGap = 26;
  }

  update(dt, speed, difficulty) {
    let spawned = null;
    this.distSinceSpawn += speed * dt;
    if (this.distSinceSpawn >= this.nextGap) {
      spawned = this.spawnPattern(difficulty);
      this.distSinceSpawn = 0;
      this.nextGap = difficulty.gapDistance + Math.random() * 8 + spawned.depth;
    }

    for (let i = this.active.length - 1; i >= 0; i--) {
      const o = this.active[i];
      o.z += speed * dt;
      o.mesh.position.z = o.z;
      if (o.z - o.def.collider.d / 2 > DESPAWN_Z) {
        this.scene.remove(o.mesh);
        this.active.splice(i, 1);
      }
    }
    return spawned;
  }

  spawnPattern(difficulty) {
    const pool = PATTERNS.filter((p) => p.tier <= difficulty.level);
    const pattern = pool[Math.floor(Math.random() * pool.length)];
    const entries = pattern.build();
    let depth = 0;
    for (const e of entries) {
      const def = OBSTACLE_TYPES[e.type];
      const mesh = this.buildMesh(def);
      const z = SPAWN_Z - (e.dz || 0);
      mesh.position.set(LANES[e.lane], 0, z);
      this.scene.add(mesh);
      this.active.push({ def, lane: e.lane, z, mesh });
      depth = Math.max(depth, (e.dz || 0) + def.collider.d);
    }
    return { entries, depth, z: SPAWN_Z };
  }

  buildMesh(def) {
    const g = new THREE.Group();
    switch (def.id) {
      case 'tollGate': {
        const gate = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.4, 0.5), this.mats.dark);
        gate.position.y = 1.2;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.16, 0.55), this.mats.neonPurple);
        bar.position.y = 2.45;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5), this.mats.goldTrim);
        sign.position.set(0, 1.6, 0.28);
        g.add(gate, bar, sign);
        break;
      }
      case 'rugPull': {
        const rug = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.22, 2.2), this.mats.rug);
        rug.position.y = 0.11;
        const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.9, 12), this.mats.rug);
        roll.rotation.z = Math.PI / 2;
        roll.position.set(0, 0.3, -0.9);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.02, 2.2), this.mats.goldTrim);
        trim.position.y = 0.23;
        g.add(rug, roll, trim);
        break;
      }
      case 'redCandle': {
        // Row of crypto candles on a base.
        const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 0.7), this.mats.dark);
        base.position.y = 0.09;
        g.add(base);
        for (let i = 0; i < 4; i++) {
          const h = 0.5 + Math.random() * 0.35;
          const candle = new THREE.Mesh(new THREE.BoxGeometry(0.3, h, 0.3), this.mats.redGlow);
          candle.position.set(-0.72 + i * 0.48, 0.18 + h / 2, 0);
          g.add(candle);
        }
        break;
      }
      case 'laserGate': {
        const postGeo = new THREE.BoxGeometry(0.22, 1.8, 0.22);
        const postL = new THREE.Mesh(postGeo, this.mats.dark);
        postL.position.set(-1.05, 0.9, 0);
        const postR = new THREE.Mesh(postGeo, this.mats.dark);
        postR.position.set(1.05, 0.9, 0);
        const beam = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.09, 0.09), this.mats.laser);
        beam.position.y = 1.33;
        const beam2 = beam.clone();
        beam2.position.y = 1.5;
        g.add(postL, postR, beam, beam2);
        break;
      }
      case 'bearTrain': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.9, 16), this.mats.trainBody);
        body.position.y = 1.45;
        const face = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.6), this.mats.dark);
        face.position.set(0, 1.5, 8.01);
        const lightGeo = new THREE.CircleGeometry(0.18, 12);
        const lampL = new THREE.Mesh(lightGeo, this.mats.laser);
        lampL.position.set(-0.7, 0.7, 8.02);
        const lampR = lampL.clone();
        lampR.position.x = 0.7;
        const chart = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8), this.mats.redGlow);
        chart.position.set(0, 2.0, 8.02);
        g.add(body, face, lampL, lampR, chart);
        break;
      }
    }
    return g;
  }
}
