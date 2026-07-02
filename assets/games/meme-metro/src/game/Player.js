import * as THREE from 'three';
import { LANES } from '../core/constants.js';

const GRAVITY = -34;
const JUMP_VELOCITY = 11.8;
const FAST_FALL_VELOCITY = -22;
const SLIDE_DURATION = 0.75;
const LANE_LERP = 13;

// Placeholder runner built from primitives (body, head, limbs, coin chain).
// Final character models swap in via buildMesh without touching state logic.
export class Player {
  constructor(scene, characterDef) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.buildMesh(characterDef);
    scene.add(this.group);
    this.reset();
  }

  buildMesh(def) {
    this.group.clear();
    const c = def.colors;
    const bodyMat = new THREE.MeshStandardMaterial({ color: c.body, roughness: 0.7 });
    const headMat = new THREE.MeshStandardMaterial({ color: c.head, roughness: 0.5 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: c.accent, emissive: c.accent, emissiveIntensity: 0.45, roughness: 0.3,
    });
    const trimMat = new THREE.MeshStandardMaterial({ color: c.trim, roughness: 0.6 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.4), bodyMat);
    body.position.y = 0.86;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 16), headMat);
    head.position.y = 1.52;
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 16), accentMat);
    chain.rotation.x = Math.PI / 2;
    chain.position.set(0, 1.02, 0.22);

    this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), bodyMat);
    this.armL.position.set(-0.45, 0.98, 0);
    this.armR = this.armL.clone();
    this.armR.position.x = 0.45;
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), trimMat);
    this.legL.position.set(-0.16, 0.28, 0);
    this.legR = this.legL.clone();
    this.legR.position.x = 0.16;

    this.group.add(body, head, chain, this.armL, this.armR, this.legL, this.legR);
  }

  reset() {
    this.lane = 1;
    this.x = LANES[1];
    this.y = 0;
    this.vy = 0;
    this.state = 'running'; // running | jumping | sliding | dead
    this.slideTimer = 0;
    this.runTime = 0;
    this.group.position.set(this.x, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.group.scale.set(1, 1, 1);
  }

  get grounded() { return this.y <= 0.001; }

  moveLeft() {
    if (this.state === 'dead') return false;
    if (this.lane === 0) return false;
    this.lane -= 1;
    return true;
  }

  moveRight() {
    if (this.state === 'dead') return false;
    if (this.lane === 2) return false;
    this.lane += 1;
    return true;
  }

  jump() {
    if (this.state === 'dead' || !this.grounded) return false;
    this.state = 'jumping';
    this.slideTimer = 0;
    this.vy = JUMP_VELOCITY;
    return true;
  }

  slide() {
    if (this.state === 'dead') return false;
    if (!this.grounded) {
      // Air slam: cancel the jump and drop fast.
      this.vy = FAST_FALL_VELOCITY;
      return true;
    }
    this.state = 'sliding';
    this.slideTimer = SLIDE_DURATION;
    return true;
  }

  die() {
    this.state = 'dead';
  }

  update(dt, speed) {
    // Lane tween.
    const targetX = LANES[this.lane];
    this.x += (targetX - this.x) * Math.min(1, LANE_LERP * dt);

    // Vertical physics.
    if (!this.grounded || this.vy > 0) {
      this.vy += GRAVITY * dt;
      this.y = Math.max(0, this.y + this.vy * dt);
      if (this.y === 0) {
        this.vy = 0;
        if (this.state === 'jumping') this.state = 'running';
      }
    }

    // Slide timer.
    if (this.state === 'sliding') {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) this.state = 'running';
    }

    // Run-cycle animation.
    this.runTime += dt * Math.max(6, speed * 0.62);
    const swing = Math.sin(this.runTime);
    const grounded = this.grounded;
    if (this.state !== 'dead') {
      this.armL.rotation.x = grounded ? swing * 0.9 : -0.6;
      this.armR.rotation.x = grounded ? -swing * 0.9 : -0.6;
      this.legL.rotation.x = grounded ? -swing * 0.9 : 0.5;
      this.legR.rotation.x = grounded ? swing * 0.9 : 0.5;
    }
    const bob = grounded && this.state === 'running' ? Math.abs(Math.cos(this.runTime)) * 0.07 : 0;

    // Slide pose: squash down; lean into lane changes.
    const targetScaleY = this.state === 'sliding' ? 0.5 : 1;
    this.group.scale.y += (targetScaleY - this.group.scale.y) * Math.min(1, 16 * dt);
    const lean = this.state === 'dead' ? 0 : (this.x - targetX) * 0.28;
    this.group.rotation.z += (lean - this.group.rotation.z) * Math.min(1, 10 * dt);

    if (this.state === 'dead') {
      // Fall backward.
      this.group.rotation.x = Math.max(this.group.rotation.x - dt * 4, -Math.PI / 2.2);
    }

    this.group.position.set(this.x, this.y + bob, 0);
  }

  // Idle running-in-place for the menu backdrop.
  idle(dt) {
    this.update(dt, 12);
  }

  getCollider() {
    const h = this.state === 'sliding' ? 0.88 : 1.78;
    return {
      minX: this.x - 0.38, maxX: this.x + 0.38,
      minY: this.y + 0.06, maxY: this.y + h,
      minZ: -0.34, maxZ: 0.34,
    };
  }
}
