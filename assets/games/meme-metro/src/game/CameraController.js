import * as THREE from 'three';

// Third-person chase camera: slightly elevated, laggy follow, crash shake,
// and a subtle FOV widen at high speed to sell velocity.
export class CameraController {
  constructor(camera, storage) {
    this.camera = camera;
    this.storage = storage;
    this.shakeTime = 0;
    this.shakeIntensity = 0;
    this.baseFov = camera.fov;
    this.lookTarget = new THREE.Vector3(0, 1.1, -10);
    camera.position.set(0, 3.2, 6.4);
  }

  shake(intensity = 0.5, duration = 0.55) {
    if (!this.storage.settings.cameraShake) return;
    this.shakeIntensity = intensity;
    this.shakeTime = duration;
  }

  update(dt, player, speedT = 0) {
    const targetFov = this.baseFov + 9 * speedT;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 3 * dt);
      this.camera.updateProjectionMatrix();
    }

    const k = Math.min(1, 6.5 * dt);
    const target = new THREE.Vector3(
      player.x * 0.55,
      3.15 + player.y * 0.14,
      6.4,
    );
    this.camera.position.lerp(target, k);

    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const s = this.shakeIntensity * Math.max(0, this.shakeTime);
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }

    this.lookTarget.set(player.x * 0.75, 1.15 + player.y * 0.2, -10);
    this.camera.lookAt(this.lookTarget);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
