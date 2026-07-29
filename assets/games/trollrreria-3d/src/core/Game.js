import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { World } from '../world/World.js';
import { Player } from '../player/Player.js';
import { Spawner } from '../enemy/Spawner.js';
import { performRaycast } from '../player/Interaction.js';
import { Inventory } from '../ui/Inventory.js';
import { InventoryScreen } from '../ui/InventoryScreen.js';
import { ChestScreen } from '../ui/ChestScreen.js';
import { MerchantScreen } from '../ui/MerchantScreen.js';
import { QuestScreen } from '../ui/QuestScreen.js';
import { QuestManager } from '../world/QuestManager.js';
import { Merchant } from '../npc/Merchant.js';
import { DayNightCycle } from './DayNightCycle.js';
import { MusicManager } from './MusicManager.js';
import { Net } from '../net/Net.js';
import * as Save from '../world/Save.js';
import { BLOCKS, PLACEABLE, UNARMED, WEAPON_STATS, DROP_OVERRIDE } from '../world/blocks.js';

const REACH = 6;
const AUTOSAVE_INTERVAL = 60;
const HARDMODE_TRIGGER_DAY = 5;

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
    this.music = new MusicManager();

    // World/player are populated in start() — either procedurally generated
    // (new island) or restored from a save (continue) — not here, so the
    // menu can offer both without doing the work twice.
    this.world = new World(this.scene);
    this.player = null;
    this.spawner = new Spawner(this.scene, this.world);
    this.attackCooldownTimer = 0;
    this.autosaveTimer = AUTOSAVE_INTERVAL;

    this.inventory = new Inventory(hud.hotbar);
    this.invScreen = new InventoryScreen(hud.invGrid, hud.recipeList, hud.armorSlot, this.inventory);
    this.chestScreen = new ChestScreen(hud.chestGrid, hud.chestPlayerGrid, this.inventory);
    this.openChestPos = null;
    this.merchantScreen = new MerchantScreen(hud.tradeList, this.inventory);
    this.merchant = null;
    this.quests = new QuestManager(this.inventory);
    this.questScreen = new QuestScreen(hud.questPanel, this.quests);
    this.net = new Net(this);

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
    window.addEventListener('beforeunload', () => { this.saveNow(); this.net.stop(); });

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

  // mode: 'new' generates a fresh island; 'continue' restores the last save
  // (falls back to 'new' if there isn't one).
  start(mode = 'new') {
    const saveData = mode === 'continue' ? Save.loadSaveData() : null;
    if (saveData) {
      Save.applyWorldSave(this.world, saveData);
      this.player = new Player(this.world, saveData.player.spawn);
      Object.assign(this.player.pos, saveData.player.pos);
      this.player.hp = saveData.player.hp;
      this.player.yaw = saveData.player.yaw;
      this.player.pitch = saveData.player.pitch;
      this.inventory.slots = saveData.inventory.slots;
      this.inventory.armor = saveData.inventory.armor;
      this.inventory.selectedHotbar = saveData.inventory.selectedHotbar;
      this.inventory.refresh();
      this.dayNight.timeOfDay = saveData.dayNight.timeOfDay;
      this.dayNight.day = saveData.dayNight.day;
      if (saveData.quests) {
        this.quests.index = saveData.quests.index;
        this.quests.kills = saveData.quests.kills;
      }
    } else {
      this.world.generate();
      this.player = new Player(this.world, this.world.findSpawn());
    }

    if (this.hud.hardmodeBadge) this.hud.hardmodeBadge.hidden = !this.world.hardmode;

    this.state = 'running';
    this.hud.hud.hidden = false;
    this.input.requestPointerLock();
    this.music.init(); // first call must happen from this user-gesture handler
    this.clock.getDelta();
    this._loop();
  }

  saveNow() {
    if (!this.player || this.state === 'menu') return;
    Save.saveGame(this);
  }

  resume() {
    this.state = 'running';
    this.input.requestPointerLock();
    this.music.resumeCtx();
  }

  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.input.exitPointerLock();
    this.saveNow();
    this.music.suspend();
    this.onStateChange('paused');
  }

  togglePause() {
    if (this.state === 'running') { this.pause(); return; }
    if (this.state === 'paused') { this.resume(); this.onStateChange('running'); }
  }

  // Escape closes whichever menu screen is open; otherwise it pauses.
  handleEscape() {
    if (this.state === 'inventory' || this.state === 'chest' || this.state === 'merchant' || this.state === 'coop') {
      this.closeMenus();
      return;
    }
    this.togglePause();
  }

  toggleCoop() {
    if (this.state === 'running') {
      this.state = 'coop';
      this.input.exitPointerLock();
      this.onStateChange('coop');
    } else if (this.state === 'coop') {
      this.closeMenus();
    }
  }

  toggleMusic() {
    return this.music.toggle();
  }

  // Returns { kind: 'online'|'tabs' } on success, or null if both
  // transports failed to connect (offline / room unreachable).
  async startCoop(room, asHost) {
    return this.net.start(room, asHost);
  }

  stopCoop() {
    this.net.stop();
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

  openMerchant() {
    this.state = 'merchant';
    this.input.exitPointerLock();
    this.merchantScreen.render();
    this.questScreen.render();
    this.onStateChange('merchant');
  }

  closeMenus() {
    this.openChestPos = null;
    this.state = 'running';
    this.input.requestPointerLock();
    this.onStateChange('running');
  }

  // Right-clicking a bed: at night it skips straight to morning; either
  // way it sets your respawn point here (Terraria-style).
  useBed(x, y, z) {
    this.player.spawn = { x: x + 0.5, y: y + 1, z: z + 0.5 };
    if (this.dayNight.isNight()) this.dayNight.timeOfDay = 0.28;
  }

  entities() {
    return this.merchant ? [...this.spawner.enemies, this.merchant] : this.spawner.enemies;
  }

  // Merchants appear once you've put down a bed — spawned just beside it.
  spawnMerchantNear(x, y, z) {
    if (this.merchant) return;
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const mx = x + dx, mz = z + dz;
      const top = this.world.heightMap.get(`${mx},${mz}`);
      if (top === undefined || top < 0) continue;
      this.merchant = new Merchant(this.scene, { x: mx + 0.5, y: top + 1, z: mz + 0.5 });
      return;
    }
  }

  respawnPlayer() {
    this.player.respawn();
    this.state = 'running';
    this.input.requestPointerLock();
    this.onStateChange('running');
  }

  handleDig() {
    if (this.state !== 'running') return;
    const hit = performRaycast(this.world, this.player.eyePos, this.player.forwardVector(), REACH, this.entities());
    if (!hit) return;
    if (hit.type === 'entity') {
      if (hit.entity === this.merchant) return; // can't be hurt
      if (this.attackCooldownTimer > 0) return;
      const weapon = this.inventory.selectedItem();
      const stats = (weapon && WEAPON_STATS[weapon.id]) || UNARMED;
      this.attackCooldownTimer = stats.cooldown;
      const died = hit.entity.hit(stats.damage, this.player.pos);
      if (died) {
        this.quests.recordKill(hit.entity.type.name);
        if (this.world.hardmode && Math.random() < 0.5) this.inventory.add(BLOCKS.REAPER_SHARD, 1);
      }
      return;
    }
    if (hit.type === 'block' && this.world.isMineable(hit.x, hit.y, hit.z)) {
      const id = this.world.getBlock(hit.x, hit.y, hit.z);
      this.world.setBlock(hit.x, hit.y, hit.z, BLOCKS.AIR);
      const dropId = DROP_OVERRIDE[id] ?? id;
      this.inventory.add(dropId, 1);
    }
  }

  handlePlace() {
    if (this.state !== 'running') return;
    const hit = performRaycast(this.world, this.player.eyePos, this.player.forwardVector(), REACH, this.entities());
    if (!hit) return;

    // Right-clicking the merchant opens the trade screen.
    if (hit.type === 'entity') {
      if (hit.entity === this.merchant) this.openMerchant();
      return;
    }
    if (hit.type !== 'block') return;

    // Right-clicking an existing chest/bed interacts instead of placing.
    const targetId = this.world.getBlock(hit.x, hit.y, hit.z);
    if (targetId === BLOCKS.CHEST) {
      this.openChest(hit.x, hit.y, hit.z);
      return;
    }
    if (targetId === BLOCKS.BED) {
      this.useBed(hit.x, hit.y, hit.z);
      return;
    }
    if (targetId === BLOCKS.LEVER) {
      this.world.toggleLever(hit.x, hit.y, hit.z);
      this.net.broadcastLever(hit.x, hit.y, hit.z);
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
    if (placeId === BLOCKS.BED) this.spawnMerchantNear(px, py, pz);
    if (placeId === BLOCKS.LEVER) this.world.registerLever(px, py, pz);
    if (placeId === BLOCKS.LAMP_OFF) this.world.registerLamp(px, py, pz);
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
    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0) {
      this.autosaveTimer = AUTOSAVE_INTERVAL;
      this.saveNow();
    }
    this.dayNight.update(dt);
    this.music.setMode(this.dayNight.isNight() ? 'night' : 'day');
    if (this.hud.clock) this.hud.clock.textContent = `Day ${this.dayNight.day} · ${this.dayNight.clockString()}`;
    if (!this.world.hardmode && this.dayNight.day >= HARDMODE_TRIGGER_DAY) {
      this.world.hardmode = true;
      if (this.hud.hardmodeBadge) this.hud.hardmodeBadge.hidden = false;
    }

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

    this.net.update(dt, this.player.pos, this.player.yaw);
    if (this.hud.peerCount) this.hud.peerCount.textContent = this.net.active ? `🌐 ${this.net.peerCount}` : '';

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
