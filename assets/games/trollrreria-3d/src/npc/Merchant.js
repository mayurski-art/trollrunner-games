import { createBillboard } from '../render/SpriteTextures.js';

const SPRITE_HEIGHT = 1.8;

// A stationary, non-hostile trader — spawned once near the player's first
// placed bed. No movement/AI needed; just a raycast-able body to interact
// with (see Game.handlePlace's right-click-on-NPC check).
export class Merchant {
  constructor(scene, pos) {
    this.pos = { ...pos };
    this.radius = 0.55;
    this.alive = true; // performRaycast's entity filter requires this

    this.mesh = createBillboard('merchant.png', 64, 80, SPRITE_HEIGHT);
    this.mesh.position.set(pos.x, pos.y, pos.z);
    scene.add(this.mesh);
  }

  centerPos() {
    return { x: this.mesh.position.x, y: this.mesh.position.y + SPRITE_HEIGHT / 2, z: this.mesh.position.z };
  }

  // Merchant never takes damage or dies — present so it can share the
  // raycast entity list with real Enemy instances.
  hit() {
    return false;
  }
}
