import * as THREE from 'three';

const LERP_SPEED = 10;

// A remote player's body — smoothly interpolated toward the last position
// it broadcast, rather than snapping, so movement reads as continuous
// even at the ~8Hz update rate.
export class PeerGhost {
  constructor(scene) {
    this.target = { x: 0, y: 0, z: 0, yaw: 0 };
    const geo = new THREE.CapsuleGeometry(0.3, 1.1, 4, 8);
    const mat = new THREE.MeshLambertMaterial({ color: 0x38bdf8 });
    this.mesh = new THREE.Mesh(geo, mat);
    scene.add(this.mesh);
  }

  setTarget(x, y, z, yaw) {
    this.target = { x, y: y + 0.85, z, yaw };
  }

  update(dt) {
    const t = Math.min(1, dt * LERP_SPEED);
    this.mesh.position.x += (this.target.x - this.mesh.position.x) * t;
    this.mesh.position.y += (this.target.y - this.mesh.position.y) * t;
    this.mesh.position.z += (this.target.z - this.mesh.position.z) * t;
    this.mesh.rotation.y = this.target.yaw;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
