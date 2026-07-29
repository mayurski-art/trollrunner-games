import * as THREE from 'three';

const SIZE = 1.0;

// A stationary, non-hostile trader — spawned once near the player's first
// placed bed. No movement/AI needed; just a raycast-able body to interact
// with (see Game.handlePlace's right-click-on-NPC check).
export class Merchant {
  constructor(scene, pos) {
    this.pos = { ...pos };
    this.radius = 0.55;
    this.alive = true; // performRaycast's entity filter requires this

    const geo = new THREE.BoxGeometry(SIZE, SIZE * 1.4, SIZE);
    const mat = new THREE.MeshLambertMaterial({ color: 0x2dd4bf });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(pos.x, pos.y + (SIZE * 1.4) / 2, pos.z);
    scene.add(this.mesh);

    const hatGeo = new THREE.ConeGeometry(0.4, 0.5, 8);
    const hatMat = new THREE.MeshLambertMaterial({ color: 0xf59e0b });
    this.hat = new THREE.Mesh(hatGeo, hatMat);
    this.hat.position.set(pos.x, pos.y + SIZE * 1.4 + 0.25, pos.z);
    scene.add(this.hat);
  }

  centerPos() {
    return { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z };
  }

  // Merchant never takes damage or dies — present so it can share the
  // raycast entity list with real Enemy instances.
  hit() {
    return false;
  }
}
