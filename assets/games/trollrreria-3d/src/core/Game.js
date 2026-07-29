import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { World } from '../world/World.js';
import { Player } from '../player/Player.js';
import { Spawner } from '../enemy/Spawner.js';
import { performRaycast } from '../player/Interaction.js';
import { Inventory } from '../ui/Inventory.js';
import { InventoryScreen } from '../ui/InventoryScreen.js';
import { ChestScreen } from '../ui/ChestScreen.js';
import { DayNightCycle } from './DayNightCycle.js';
import { BLOCKS, PLACEABLE, UNARMED, WEAPON_STATS } from '../world/blocks.js';

const REACH = 6;

// Owns the renderer, scene, world/player/enemy state and the per-frame loop.
// States: menu | running | paused | respawn | inventory | chest.
export class Game {
  constructor(canvas, touchRoot, hud, { onStateChange } = {}) {
    this.canvas = canvas;
    this.hud = hud; // { hud, hpFill, hotbar, invGrid, recipeList, chestGrid, chestPlayerGrid }
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

    const lights = this._setupLights();
    this.dayNight = new DayNightCycle(this.scene, lights);

    this.world = new World(this.scene);
    this.world.generate();

    const spawn = this.world.findSpawn();
    this.player = new Player(this.world, spawn);
    this.spawner = new Spawner(this.scene, this.world);
    this.attackCooldownTimer = 0;

    this.inventory = new Inventory(hud.hotbar);
    this.invScreen = new InventoryScreen(hud.invGrid, hud.recipeList, hud.armorSlot, this.inventory);
    this.chestScreen = new ChestScreen(hud.chestGrid, hud.chestPlayerGrid, this.inventory);
    this.openChestPos = null;

    this.input = new InputManager(canvas, touchRoot, {
      onDig: () => this.handleDig(),
      onPlace: () => this.handlePlace(),
      onHotbar: (i) => this.inventory.selectHotbar(i),
      onEscape: () => this.handleEscape(),
      onInventory: () => this.toggleInventory(),
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
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x9a8262, 1.0);
    this.scene.add(hemi);
    const sunLight = new THREE.DirectionalLight(0xfff2d9, 0.7);
    sunLight.position.set(40, 60, 20);
    this.scene.add(sunLight);
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambient);
    return { hemi, sunLight, ambient };
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

  // Escape closes whichever menu screen is open; otherwise it pauses.
  handleEscape() {
    if (this.state === 'inventory' || this.state === 'chest') {
      this.closeMenus();
      return;
    }
    this.togglePause();
  }

  toggleInventory() {
    if (this.state === 'running') {
      this.state = 'inventory';
      this.input.exitPointerLock();
      this.invScreen.render();
      this.onStateChange('inventory');
    } else if (this.state === 'inventory') {
      this.closeMenus();
    }
  }

  openChest(x, y, z) {
    this.openChestPos = { x, y, z };
    this.state = 'chest';
    this.input.exitPointerLock();
    this.chestScreen.open(this.world.getChest(x, y, z));
    this.onStateChange('chest');
  }

  closeMenus() {
    this.openChestPos = null;
    this.state = 'running';
    this.input.requestPointerLock();
    this.onStateChange('running');
  }

  respawnPlayer() {
    this.player.respawn();
    this.state = 'running';
    this.input.requestPointerLock();
    this.onStateChange('running');
  }

  handleDig() {
    if (this.state !== 'running') return;
    const hit = performRaycast(this.world, this.player.eyePos, this.player.forwardVector(), REACH, this.spawner.enemies);
    if (!hit) return;
    if (hit.type === 'entity') {
      if (this.attackCooldownTimer > 0) return;
      const weapon = this.inventory.selectedItem();
      const stats = (weapon && WEAPON_STATS[weapon.id]) || UNARMED;
      this.attackCooldownTimer = stats.cooldown;
      hit.entity.hit(stats.damage, this.player.pos);
      return;
    }
    if (hit.type === 'block' && this.world.isMineable(hit.x, hit.y, hit.z)) {
      const id = this.world.getBlock(hit.x, hit.y, hit.z);
      this.world.setBlock(hit.x, hit.y, hit.z, BLOCKS.AIR);
      // Grass top drops dirt (no separate grass hotbar slot); leaves drop nothing.
      const dropId = id === BLOCKS.GRASS ? BLOCKS.DIRT : id;
      this.inventory.add(dropId, 1);
    }
  }

  handlePlace() {
    if (this.state !== 'running') return;
    const hit = performRaycast(this.world, this.player.eyePos, this.player.forwardVector(), REACH, this.spawner.enemies);
    if (!hit || hit.type !== 'block') return;

    // Right-clicking an existing chest opens it instead of placing.
    if (this.world.getBlock(hit.x, hit.y, hit.z) === BLOCKS.CHEST) {
      this.openChest(hit.x, hit.y, hit.z);
      return;
    }

    const slot = this.inventory.selectedItem();
    if (!slot || !PLACEABLE.includes(slot.id)) return;

    const px = hit.x + hit.normal.x, py = hit.y + hit.normal.y, pz = hit.z + hit.normal.z;
    if (this.world.getBlock(px, py, pz) !== BLOCKS.AIR) return;
    // Don't let the player wall themselves in.
    const p = this.player.pos;
    if (Math.floor(p.x) === px && (Math.floor(p.y) === py || Math.floor(p.y + 1) === py) && Math.floor(p.z) === pz) return;

    const placeId = slot.id;
    if (!this.inventory.consumeSelected()) return;
    this.world.setBlock(px, py, pz, placeId);
    if (placeId === BLOCKS.CHEST) this.world.getChest(px, py, pz);
  }

  _loop() {
    if (this.state === 'menu') return;
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.state !== 'running') {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.attackCooldownTimer > 0) this.attackCooldownTimer -= dt;
    this.dayNight.update(dt);
    if (this.hud.clock) this.hud.clock.textContent = `Day ${this.dayNight.day} · ${this.dayNight.clockString()}`;

    const look = this.input.consumeLook();
    this.player.lookDelta(look.dx, look.dy);

    const move = this.input.moveVector;
    const fellOff = this.player.update(dt, move.x, move.z, this.input.jumpHeld);

    const attackers = this.spawner.update(dt, this.player.pos);
    let died = false;
    const reduction = this.inventory.armorReduction();
    for (const attacker of attackers) {
      const dmg = Math.max(1, Math.round(attacker.type.damage * (1 - reduction)));
      if (this.player.takeDamage(dmg)) died = true;
    }
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
