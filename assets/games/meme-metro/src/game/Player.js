import * as THREE from 'three';
import { LANES } from '../core/constants.js';

const GRAVITY = -34;
const JUMP_VELOCITY = 11.8;
const FAST_FALL_VELOCITY = -22;
const SLIDE_DURATION = 0.75;
const LANE_LERP = 13;
// An action pressed slightly too early (e.g. jump just before landing)
// fires automatically within this window instead of being dropped.
const INPUT_BUFFER = 0.16;

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
    this.addAccessories(def, { headMat, accentMat, trimMat });

    // Diamond Hands shield bubble, toggled by PowerupManager state.
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 20, 14),
      new THREE.MeshBasicMaterial({
        color: 0x35d6ff, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }),
    );
    this.shieldMesh.position.y = 1.0;
    this.shieldMesh.visible = false;
    this.group.add(this.shieldMesh);
  }

  // Per-character silhouette accessories so each runner reads instantly
  // even on the placeholder rig. Final models replace all of this.
  addAccessories(def, { accentMat, trimMat }) {
    switch (def.id) {
      case 'pepe': {
        // Red scarf + hoodie bump.
        const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.09, 8, 14), trimMat);
        scarf.rotation.x = Math.PI / 2;
        scarf.position.y = 1.24;
        const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshStandardMaterial({ color: 0x2b4faa, roughness: 0.8 }));
        hood.position.set(0, 1.4, -0.28);
        this.group.add(scarf, hood);
        break;
      }
      case 'doge': {
        // Shiba ears + cap brim + shades bar.
        const earGeo = new THREE.ConeGeometry(0.11, 0.26, 8);
        const earMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.7 });
        for (const x of [-0.2, 0.2]) {
          const ear = new THREE.Mesh(earGeo, earMat);
          ear.position.set(x, 1.9, -0.04);
          this.group.add(ear);
        }
        const brim = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.3), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }));
        brim.position.set(0, 1.72, 0.24);
        const shades = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.06), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.25 }));
        shades.position.set(0, 1.58, 0.32);
        this.group.add(brim, shades);
        break;
      }
      case 'skyrunner': {
        // Sunglasses + rocket boots with cyan thrusters.
        const shades = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.11, 0.06), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2 }));
        shades.position.set(0, 1.58, 0.32);
        this.group.add(shades);
        const thrustGeo = new THREE.CylinderGeometry(0.07, 0.11, 0.16, 10);
        for (const leg of [this.legL, this.legR]) {
          const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.3), new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.4, metalness: 0.5 }));
          boot.position.set(0, -0.24, 0.03);
          leg.add(boot);
          const thrust = new THREE.Mesh(thrustGeo, accentMat);
          thrust.position.set(0, -0.36, 0.03);
          leg.add(thrust);
        }
        break;
      }
      case 'laserexec': {
        // Gold tie + red laser eyes.
        const tie = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.05), accentMat);
        tie.position.set(0, 0.95, 0.23);
        this.group.add(tie);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2038, toneMapped: false });
        for (const x of [-0.13, 0.13]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat);
          eye.position.set(x, 1.6, 0.33);
          this.group.add(eye);
        }
        break;
      }
      default: {
        // Trollface: wide white grin plate on the head front.
        const grin = new THREE.Mesh(
          new THREE.BoxGeometry(0.34, 0.1, 0.05),
          new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4 }),
        );
        grin.position.set(0, 1.42, 0.32);
        this.group.add(grin);
      }
    }
  }

  reset() {
    this.lane = 1;
    this.x = LANES[1];
    this.y = 0;
    this.vy = 0;
    this.state = 'running'; // running | jumping | sliding | dead
    this.slideTimer = 0;
    this.runTime = 0;
    this.buffered = null; // { action: 'jump' | 'slide', t }
    this.flying = false; // Rocket Boost: hover above the track
    if (this.shieldMesh) this.shieldMesh.visible = false;
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
    if (this.state === 'dead') return false;
    if (!this.grounded) {
      this.buffered = { action: 'jump', t: INPUT_BUFFER };
      return false;
    }
    this.state = 'jumping';
    this.slideTimer = 0;
    this.buffered = null;
    this.vy = JUMP_VELOCITY;
    return true;
  }

  slide() {
    if (this.state === 'dead') return false;
    if (!this.grounded) {
      // Air slam: cancel the jump, drop fast, then roll on landing.
      this.vy = FAST_FALL_VELOCITY;
      this.buffered = { action: 'slide', t: INPUT_BUFFER * 2 };
      return true;
    }
    this.state = 'sliding';
    this.slideTimer = SLIDE_DURATION;
    this.buffered = null;
    return true;
  }

  die() {
    this.state = 'dead';
  }

  update(dt, speed) {
    // Lane tween.
    const targetX = LANES[this.lane];
    this.x += (targetX - this.x) * Math.min(1, LANE_LERP * dt);

    // Vertical physics. Rocket flight overrides gravity with a hover lerp.
    if (this.flying && this.state !== 'dead') {
      this.vy = 0;
      if (this.state === 'sliding') this.state = 'running';
      this.y += (2.7 - this.y) * Math.min(1, 6 * dt);
    } else if (!this.grounded || this.vy > 0) {
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

    // Fire a buffered action the moment it becomes legal.
    if (this.buffered && this.state !== 'dead') {
      this.buffered.t -= dt;
      if (this.buffered.t <= 0) {
        this.buffered = null;
      } else if (this.grounded) {
        const { action } = this.buffered;
        this.buffered = null;
        if (action === 'jump') this.jump();
        else this.slide();
      }
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
