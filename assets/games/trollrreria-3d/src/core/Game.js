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
import { WaypointsScreen } from '../ui/WaypointsScreen.js';
import { QuestScreen } from '../ui/QuestScreen.js';
import { QuestManager } from '../world/QuestManager.js';
import { Merchant } from '../npc/Merchant.js';
import { Villager } from '../npc/Villager.js';
import { VILLAGER_DEFS } from '../world/villagers.js';
import { DayNightCycle } from './DayNightCycle.js';
import { MusicManager } from './MusicManager.js';
import { Weather } from './Weather.js';
import { Net } from '../net/Net.js';
import * as Save from '../world/Save.js';
import { BLOCKS, PLACEABLE, UNARMED, WEAPON_STATS, DROP_OVERRIDE, SUMMON_ITEMS, FOOD_STATS } from '../world/blocks.js';
import { Enemy } from '../enemy/Enemy.js';
import { ENEMY_TYPES } from '../enemy/EnemyTypes.js';

const REACH = 6;
const AUTOSAVE_INTERVAL = 60;
const HARDMODE_TRIGGER_DAY = 5;
const HUNGER_DRAIN_INTERVAL = 20; // seconds per -1 hunger
const STARVE_DAMAGE_INTERVAL = 3; // seconds per tick of damage at 0 hunger
const FOOTSTEP_INTERVAL = 0.38;

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
    this.weather = new Weather(this.scene, hud.rainOverlay);

    // World/player are populated in start() — either procedurally generated
    // (new island) or restored from a save (continue) — not here, so the
    // menu can offer both without doing the work twice.
    this.world = new World(this.scene);
    this.player = null;
    this.spawner = new Spawner(this.scene, this.world);
    this.attackCooldownTimer = 0;
    this.autosaveTimer = AUTOSAVE_INTERVAL;
    this.hungerDrainTimer = HUNGER_DRAIN_INTERVAL;
    this.starveTimer = STARVE_DAMAGE_INTERVAL;
    this.footstepTimer = 0;

    this.inventory = new Inventory(hud.hotbar);
    this.invScreen = new InventoryScreen(hud.invGrid, hud.recipeList, hud.armorSlot, this.inventory);
    this.chestScreen = new ChestScreen(hud.chestGrid, hud.chestPlayerGrid, this.inventory);
    this.openChestPos = null;
    this.merchantScreen = new MerchantScreen(hud.tradeList, this.inventory);
    this.merchant = null;
    this.quests = new QuestManager(this.inventory);
    this.questScreen = new QuestScreen(hud.questPanel, this.quests);
    this.questScreen.onClaim = () => this.music.playQuestComplete();
    this.villagers = [];
    this.dialogueTimer = 0;
    this.waypointsScreen = new WaypointsScreen(hud.waypointList, this);
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
      this.player.hunger = saveData.player.hunger ?? this.player.maxHunger;
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
    this.spawnVillagers();
    this.spawnRuinsGuardians();

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
    if (['inventory', 'chest', 'merchant', 'coop', 'waypoints'].includes(this.state)) {
      this.closeMenus();
      return;
    }
    this.togglePause();
  }

  toggleWaypoints() {
    if (this.state === 'running') {
      this.state = 'waypoints';
      this.input.exitPointerLock();
      this.waypointsScreen.render();
      this.onStateChange('waypoints');
    } else if (this.state === 'waypoints') {
      this.closeMenus();
    }
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
    if (this.dayNight.isNight()) {
      this.dayNight.timeOfDay = 0.28;
      this.player.hp = this.player.maxHp;
      this.player.eat(30);
    }
  }

  entities() {
    const extras = [];
    if (this.merchant) extras.push(this.merchant);
    extras.push(...this.villagers);
    return extras.length ? [...this.spawner.enemies, ...extras] : this.spawner.enemies;
  }

  spawnVillagers() {
    for (const v of this.villagers) v.dispose(this.scene);
    this.villagers = [];
    if (!this.world.villagePos) return;
    const { x, z } = this.world.villagePos;
    const offsets = [[2, -2], [-2, 3], [3, 1]];
    VILLAGER_DEFS.forEach((def, i) => {
      const [ox, oz] = offsets[i];
      const hx = Math.round(x + ox), hz = Math.round(z + oz);
      const top = this.world.heightMap.get(`${hx},${hz}`);
      if (top === undefined || top < 0) return;
      this.villagers.push(new Villager(this.scene, this.world, { x: hx + 0.5, y: top + 1, z: hz + 0.5 }, def.name, def.lines, def.sprite));
    });
  }

  // Two guardians posted at the ruins on every load — like the merchant and
  // villagers, mob state isn't part of the save file, so clearing the ruins
  // doesn't stay cleared between sessions (same trade-off as everywhere else
  // enemies aren't persisted).
  spawnRuinsGuardians() {
    if (!this.world.dungeonPos) return;
    const { x, z } = this.world.dungeonPos;
    for (const [ox, oz] of [[-2, 0], [2, 0]]) {
      const gx = Math.round(x + ox), gz = Math.round(z + oz);
      const top = this.world.heightMap.get(`${gx},${gz}`);
      if (top === undefined || top < 0) continue;
      this.spawner.enemies.push(new Enemy(this.scene, { x: gx + 0.5, y: top + 1, z: gz + 0.5 }, ENEMY_TYPES.TROLL_REAPER));
    }
  }

  // Spawns a world boss a few blocks in front of the player. Bosses live in
  // spawner.enemies like any other mob (raycast/cleanup/attack handling all
  // shared) but never enter the random spawn pool — see EnemyTypes.TROLL_KING.
  summonBoss(kindName) {
    const kind = ENEMY_TYPES[kindName];
    if (!kind) return;
    const forward = this.player.forwardVector();
    const x = Math.round(this.player.pos.x + forward.x * 5);
    const z = Math.round(this.player.pos.z + forward.z * 5);
    const top = this.world.heightMap.get(`${x},${z}`) ?? Math.floor(this.player.pos.y);
    this.spawner.enemies.push(new Enemy(this.scene, { x: x + 0.5, y: top + 1, z: z + 0.5 }, kind));
  }

  showDialogue(name, line) {
    if (!this.hud.dialogue) return;
    this.hud.dialogue.textContent = `${name}: "${line}"`;
    this.hud.dialogue.hidden = false;
    this.dialogueTimer = 4;
  }

  // Known fast-travel points: world spawn (well, the player's own last bed/
  // spawn point) plus the village, if one generated.
  waypoints() {
    const points = [{ name: 'Home', pos: this.player.spawn }];
    if (this.world.villagePos) points.push({ name: 'Village', pos: this.world.villagePos });
    if (this.world.dungeonPos) points.push({ name: 'Ruins', pos: this.world.dungeonPos });
    return points;
  }

  travelTo(pos) {
    Object.assign(this.player.pos, { x: pos.x, y: pos.y + 2, z: pos.z });
    this.player.vel = { x: 0, y: 0, z: 0 };
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
      if (hit.entity === this.merchant || this.villagers.includes(hit.entity)) return; // can't be hurt
      if (this.attackCooldownTimer > 0) return;
      const weapon = this.inventory.selectedItem();
      const stats = (weapon && WEAPON_STATS[weapon.id]) || UNARMED;
      this.attackCooldownTimer = stats.cooldown;
      const died = hit.entity.hit(stats.damage, this.player.pos);
      this.music.playHit();
      if (died) {
        this.quests.recordKill(hit.entity.type.name);
        if (hit.entity.type.name === 'Archtroll') {
          this.inventory.add(BLOCKS.REAPER_SHARD, 15);
          this.inventory.add(BLOCKS.TROLL_CROWN, 1); // sustains the totem->crown->totem loop
          this.inventory.add(BLOCKS.REAPER_ARMOR, 1);
        } else if (hit.entity.type.isBoss) {
          this.inventory.add(BLOCKS.REAPER_SHARD, 10);
          this.inventory.add(BLOCKS.TROLL_CROWN, 1);
        } else if (this.world.hardmode && Math.random() < 0.5) {
          this.inventory.add(BLOCKS.REAPER_SHARD, 1);
        }
        if (hit.entity.type.name === 'Troll Grub' && Math.random() < 0.4) this.inventory.add(BLOCKS.TROLL_MEAT, 1);
      }
      return;
    }
    if (hit.type === 'block' && this.world.isMineable(hit.x, hit.y, hit.z)) {
      const id = this.world.getBlock(hit.x, hit.y, hit.z);
      this.world.setBlock(hit.x, hit.y, hit.z, BLOCKS.AIR);
      const dropId = DROP_OVERRIDE[id] ?? id;
      this.inventory.add(dropId, 1);
      this.music.playMine();
    }
  }

  handlePlace() {
    if (this.state !== 'running') return;
    const hit = performRaycast(this.world, this.player.eyePos, this.player.forwardVector(), REACH, this.entities());
    if (!hit) return;

    // Right-clicking the merchant opens the trade screen; a villager gives
    // a random one-line greeting instead.
    if (hit.type === 'entity') {
      if (hit.entity === this.merchant) this.openMerchant();
      else if (this.villagers.includes(hit.entity)) {
        const line = hit.entity.line[Math.floor(Math.random() * hit.entity.line.length)];
        this.showDialogue(hit.entity.name, line);
      }
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
    if (!slot) return;

    if (SUMMON_ITEMS[slot.id]) {
      this.inventory.consumeSelected();
      this.summonBoss(SUMMON_ITEMS[slot.id]);
      this.music.playBossRoar();
      return;
    }
    if (FOOD_STATS[slot.id]) {
      const food = FOOD_STATS[slot.id];
      if (!this.inventory.consumeSelected()) return;
      this.player.eat(food.hunger);
      if (food.heal) this.player.hp = Math.min(this.player.maxHp, this.player.hp + food.heal);
      this.music.playPickup();
      return;
    }

    const px = hit.x + hit.normal.x, py = hit.y + hit.normal.y, pz = hit.z + hit.normal.z;
    if (this.world.getBlock(px, py, pz) !== BLOCKS.AIR) return;
    // Don't let the player wall themselves in.
    const p = this.player.pos;
    if (Math.floor(p.x) === px && (Math.floor(p.y) === py || Math.floor(p.y + 1) === py) && Math.floor(p.z) === pz) return;

    if (slot.id === BLOCKS.WHEAT_SEED) {
      if (targetId !== BLOCKS.GRASS && targetId !== BLOCKS.DIRT) return;
      if (!this.inventory.consumeSelected()) return;
      this.world.plantCrop(px, py, pz);
      this.music.playPlace();
      return;
    }
    if (!PLACEABLE.includes(slot.id)) return;

    const placeId = slot.id;
    if (!this.inventory.consumeSelected()) return;
    this.world.setBlock(px, py, pz, placeId);
    if (placeId === BLOCKS.CHEST) this.world.getChest(px, py, pz);
    if (placeId === BLOCKS.BED) this.spawnMerchantNear(px, py, pz);
    if (placeId === BLOCKS.LEVER) this.world.registerLever(px, py, pz);
    if (placeId === BLOCKS.LAMP_OFF) this.world.registerLamp(px, py, pz);
    this.music.playPlace();
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
    this.weather.update(dt);
    this.world.tickCrops(dt, this.weather.cropGrowthMultiplier());

    this.hungerDrainTimer -= dt;
    if (this.hungerDrainTimer <= 0) {
      this.hungerDrainTimer = HUNGER_DRAIN_INTERVAL;
      this.player.hunger = Math.max(0, this.player.hunger - 1);
    }
    let died = false;
    if (this.player.hunger <= 0) {
      this.starveTimer -= dt;
      if (this.starveTimer <= 0) {
        this.starveTimer = STARVE_DAMAGE_INTERVAL;
        if (this.player.takeDamage(3)) died = true;
      }
    } else {
      this.starveTimer = STARVE_DAMAGE_INTERVAL;
    }
    if (this.hud.hungerFill) this.hud.hungerFill.style.width = `${Math.max(0, (this.player.hunger / this.player.maxHunger) * 100)}%`;

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

    if (this.player.grounded && (move.x !== 0 || move.z !== 0)) {
      this.footstepTimer -= dt;
      if (this.footstepTimer <= 0) {
        this.footstepTimer = FOOTSTEP_INTERVAL;
        this.music.playFootstep();
      }
    } else {
      this.footstepTimer = 0;
    }

    for (const v of this.villagers) v.update(dt);
    if (this.dialogueTimer > 0) {
      this.dialogueTimer -= dt;
      if (this.dialogueTimer <= 0 && this.hud.dialogue) this.hud.dialogue.hidden = true;
    }

    const attackers = this.spawner.update(dt, this.player.pos);
    const reduction = this.inventory.armorReduction();
    for (const attacker of attackers) {
      const dmg = Math.max(1, Math.round(attacker.effectiveDamage() * (1 - reduction)));
      if (this.player.takeDamage(dmg)) died = true;
      else this.music.playHurt();
      if (attacker.type.isBoss) {
        const dx = this.player.pos.x - attacker.pos.x, dz = this.player.pos.z - attacker.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        this.player.moveAxis('x', (dx / d) * 3);
        this.player.moveAxis('z', (dz / d) * 3);
      }
    }
    if (fellOff === 'fell') died = true;

    this.net.update(dt, this.player.pos, this.player.yaw);
    if (this.hud.peerCount) this.hud.peerCount.textContent = this.net.active ? `🌐 ${this.net.peerCount}` : '';

    this.hud.hpFill.style.width = `${Math.max(0, (this.player.hp / this.player.maxHp) * 100)}%`;

    if (this.hud.bossBar) {
      const boss = this.spawner.enemies.find((e) => e.type.isBoss);
      this.hud.bossBar.hidden = !boss;
      if (boss) {
        this.hud.bossName.textContent = boss.type.name;
        this.hud.bossFill.style.width = `${Math.max(0, (boss.hp / boss.type.hp) * 100)}%`;
      }
    }

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
