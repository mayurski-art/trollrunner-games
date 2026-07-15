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

const SPRITE_BASE = new URL('../../assets/sprites/', import.meta.url).href;
const SPRITE_WIDTH = 1.5;
const SPRITE_HEIGHT = 1.9;
const RUN_FRAME_COUNT = 8;
const JUMP_FRAME_COUNT = 8;
const SLIDE_FRAME_COUNT = 6;
const DEATH_FRAME_COUNT = 7;
const JUMP_FPS = 12;
const DEATH_FPS = 10;

// Only the "north" (back-facing) frames are ever shown in-game: the chase
// camera sits behind the runner the whole time. "south" frames exist on
// disk for a future front-facing menu/character-select screen.
const frameCache = new Map();

function loadFrames(charId, anim, count) {
  const key = `${charId}:${anim}`;
  if (frameCache.has(key)) return frameCache.get(key);
  const loader = new THREE.TextureLoader();
  const frames = Array.from({ length: count }, (_, i) => {
    const idx = String(i).padStart(2, '0');
    const tex = loader.load(`${SPRITE_BASE}${charId}/${anim}_north_${idx}.png`);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
  frameCache.set(key, frames);
  return frames;
}

// Sprite-based runner: a single camera-facing billboard whose texture swaps
// between pre-rendered PixelLab frames depending on state (run/jump/slide/death).
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
    this.frames = {
      run: loadFrames(def.id, 'run', RUN_FRAME_COUNT),
      jump: loadFrames(def.id, 'jump', JUMP_FRAME_COUNT),
      slide: loadFrames(def.id, 'slide', SLIDE_FRAME_COUNT),
      death: loadFrames(def.id, 'death', DEATH_FRAME_COUNT),
    };

    const spriteMat = new THREE.SpriteMaterial({
      map: this.frames.run[0],
      transparent: true,
      alphaTest: 0.05,
    });
    this.sprite = new THREE.Sprite(spriteMat);
    this.sprite.scale.set(SPRITE_WIDTH, SPRITE_HEIGHT, 1);
    // Sprites are centered on their position by default; lift so the
    // feet (bottom of the frame) sit on the ground reference instead.
    this.sprite.position.y = SPRITE_HEIGHT / 2;
    this.group.add(this.sprite);

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

  reset() {
    this.lane = 1;
    this.x = LANES[1];
    this.y = 0;
    this.vy = 0;
    this.state = 'running'; // running | jumping | sliding | dead
    this.slideTimer = 0;
    this.runTime = 0;
    this.animTime = 0;
    this.buffered = null; // { action: 'jump' | 'slide', t }
    this.flying = false; // Rocket Boost: hover above the track
    if (this.shieldMesh) this.shieldMesh.visible = false;
    if (this.sprite) {
      this.sprite.material.map = this.frames.run[0];
      this.sprite.material.rotation = 0;
    }
    this.group.position.set(this.x, 0, 0);
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
    this.animTime = 0;
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
    this.animTime = 0;
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

    // Run-cycle phase (also drives the idle ground bob).
    this.runTime += dt * Math.max(6, speed * 0.62);
    const grounded = this.grounded;
    const bob = grounded && this.state === 'running' ? Math.abs(Math.cos(this.runTime)) * 0.07 : 0;

    // Lean into lane changes via a screen-plane sprite roll.
    const lean = this.state === 'dead' ? 0 : (this.x - targetX) * 0.28;
    this.sprite.material.rotation += (-lean - this.sprite.material.rotation) * Math.min(1, 10 * dt);

    this.animTime += dt;
    this.sprite.material.map = this.pickFrame();

    this.group.position.set(this.x, this.y + bob, 0);
  }

  pickFrame() {
    if (this.state === 'dead') {
      const idx = Math.min(DEATH_FRAME_COUNT - 1, Math.floor(this.animTime * DEATH_FPS));
      return this.frames.death[idx];
    }
    if (this.state === 'sliding') {
      const progress = 1 - Math.max(0, this.slideTimer) / SLIDE_DURATION;
      const idx = Math.min(SLIDE_FRAME_COUNT - 1, Math.floor(progress * SLIDE_FRAME_COUNT));
      return this.frames.slide[idx];
    }
    if (this.state === 'jumping' && !this.flying) {
      const idx = Math.floor(this.animTime * JUMP_FPS) % JUMP_FRAME_COUNT;
      return this.frames.jump[idx];
    }
    const idx = Math.floor((this.runTime / (Math.PI * 2)) * RUN_FRAME_COUNT) % RUN_FRAME_COUNT;
    return this.frames.run[idx];
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
