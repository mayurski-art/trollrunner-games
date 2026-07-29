import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { World } from '../world/World.js';
import { Player, EYE_HEIGHT } from '../player/Player.js';
import { Enemy } from '../enemy/Enemy.js';
import { performRaycast } from '../player/Interaction.js';
import { Inventory } from '../ui/Inventory.js';
import { BLOCKS } from '../world/blocks.js';

const REACH = 6;
const ATTACK_DAMAGE = 12;

// Owns the renderer, scene, world/player/enemy state and the per-frame loop.
// States: menu | running | paused | respawn.
export class Game {
  constructor(canvas, touchRoot, hud, { onStateChange } = {}) {
    this.canvas = canvas;
    this.hud = hud; // { hpFill, hotbar }
    this.onStateChange = onStateChange || (() => {});
    this.state = 'menu';

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fd6ff);
    this.scene.fog = new THREE.Fog(0x9fd6ff, 30, 90);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.rotation.order = 'YXZ';

    this._setupLights();

    this.world = new World(this.scene);
    this.world.generate();

    const spawn = this.world.findSpawn();
    this.player = new Player(this.world, spawn);
    this.enemy = new Enemy(this.scene, { x: spawn.x + 5, y: spawn.y, z: spawn.z + 3 });

    this.inventory = new Inventory(hud.hotbar);

    this.input = new InputManager(canvas, touchRoot, {
      onDig: () => this.handleDig(),
      onPlace: () => this.handlePlace(),
      onHotbar: (i) => this.inventory.selectByIndex(i),
      onPause: () => this.togglePause(),
    });

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'running') this.pause();
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.canvas && this.state === 'running') this.pause();
    });

    this.clock = new THREE.Clock();
  }

  _setupLights() {
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4a3a2a, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.0);
    sun.position.set(40, 60, 20);
    this.scene.add(sun);
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.state = 'running';
    this.player.respawn();
    this.hud.hud.hidden = false;
    this.input.requestPointerLock();
    this.clock.getDelta();
    this._loop();
  }

  resume() {
    this.state = 'running';
    this.input.requestPointerLock();
  }

  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.input.exitPointerLock();
    this.onStateChange('paused');
  }

  togglePause() {
    if (this.state === 'running') { this.pause(); return; }
    if (this.state === 'paused') { this.resume(); this.onStateChange('running'); }
  }

  respawnPlayer() {
    this.player.respawn();
    this.state = 'running';
    this.input.requestPointerLock();
    this.onStateChange('running');
  }

  handleDig() {
    if (this.state !== 'running') return;
    const hit = performRaycast(this.world, this.player.eyePos, this.player.forwardVector(), REACH, [this.enemy]);
    if (!hit) return;
    if (hit.type === 'entity') {
      const died = hit.entity.hit(1);
      return;
    }
    if (hit.type === 'block' && this.world.isMineable(hit.x, hit.y, hit.z)) {
      const id = this.world.getBlock(hit.x, hit.y, hit.z);
      this.world.setBlock(hit.x, hit.y, hit.z, BLOCKS.AIR);
      this.inventory.add(id, 1);
    }
  }

  handlePlace() {
    if (this.state !== 'running') return;
    const hit = performRaycast(this.world, this.player.eyePos, this.player.forwardVector(), REACH, [this.enemy]);
    if (!hit || hit.type !== 'block') return;
    const px = hit.x + hit.normal.x, py = hit.y + hit.normal.y, pz = hit.z + hit.normal.z;
    if (this.world.getBlock(px, py, pz) !== BLOCKS.AIR) return;
    // Don't let the player wall themselves in.
    const p = this.player.pos;
    if (Math.floor(p.x) === px && (Math.floor(p.y) === py || Math.floor(p.y + 1) === py) && Math.floor(p.z) === pz) return;
    if (!this.inventory.consumeSelected()) return;
    this.world.setBlock(px, py, pz, this.inventory.selected);
  }

  _loop() {
    if (this.state === 'menu') return;
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.state !== 'running') {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const look = this.input.consumeLook();
    this.player.lookDelta(look.dx, look.dy);

    const move = this.input.moveVector;
    const fellOff = this.player.update(dt, move.x, move.z, this.input.jumpHeld);

    const enemyResult = this.enemy.update(dt, this.world, this.player.pos);
    let died = false;
    if (enemyResult === 'attack') died = !!this.player.takeDamage(ATTACK_DAMAGE);
    if (fellOff === 'fell') died = true;

    this.hud.hpFill.style.width = `${Math.max(0, (this.player.hp / this.player.maxHp) * 100)}%`;

    if (died) {
      this.state = 'respawn';
      this.input.exitPointerLock();
      this.onStateChange('respawn');
    }

    const eye = this.player.eyePos;
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0);

    this.renderer.render(this.scene, this.camera);
  }
}
