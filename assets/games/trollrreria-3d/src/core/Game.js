import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { World } from '../world/World.js';
import { Player } from '../player/Player.js';
import { Spawner, SPAWN_GRACE_SECONDS } from '../enemy/Spawner.js';
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
import { Animal, BREED_COOLDOWN } from '../npc/Animal.js';
import { VILLAGER_DEFS, OUTPOST_VILLAGER_DEFS } from '../world/villagers.js';
import { DayNightCycle } from './DayNightCycle.js';
import { MusicManager } from './MusicManager.js';
import { Weather } from './Weather.js';
import { Minimap } from '../ui/Minimap.js';
import { HeldItem } from '../render/HeldItem.js';
import { Net } from '../net/Net.js';
import * as Save from '../world/Save.js';
import { BLOCKS, PLACEABLE, UNARMED, WEAPON_STATS, DROP_OVERRIDE, SUMMON_ITEMS, FOOD_STATS, MINE_TIER, TOOL_STATS, BLOCK_NAME, mineSeconds, ICON_MAP } from '../world/blocks.js';
import { Enemy } from '../enemy/Enemy.js';
import { ENEMY_TYPES } from '../enemy/EnemyTypes.js';

const REACH = 6;
const AUTOSAVE_INTERVAL = 60;
const HARDMODE_TRIGGER_DAY = 5;
const HUNGER_DRAIN_INTERVAL = 20; // seconds per -1 hunger
const STARVE_DAMAGE_INTERVAL = 3; // seconds per tick of damage at 0 hunger
const LAVA_DAMAGE_INTERVAL = 0.5; // seconds per tick of damage while touching lava
const LAVA_DAMAGE = 8;
const FOOTSTEP_INTERVAL = 0.38;

// Enemy hp/damage multipliers, stacked with the existing hardmode scale
// (see Spawner.js). New Game+ prestige adds +15% per level on top of these.
const DIFFICULTY_SCALE = {
  easy: { hp: 0.8, damage: 0.6, hunger: 1.4 },
  normal: { hp: 1, damage: 1, hunger: 1 },
  hard: { hp: 1.3, damage: 1.5, hunger: 0.7 },
};
const PRESTIGE_STAT_STEP = 0.15;

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
    // Pushed out from the original (30, 90)/far=200 now that the island is
    // 400x400 — a bigger map doesn't read as bigger if fog still caps
    // visibility at the same distance as the old small one.
    this.scene.fog = new THREE.Fog(0x9fd6ff, 60, 220);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 300);
    this.camera.rotation.order = 'YXZ';
    // The held-item viewmodel is parented to the camera (see HeldItem.js) —
    // for that child to actually render, the camera itself needs to be in
    // the scene graph the renderer traverses, not just passed to render().
    this.scene.add(this.camera);
    this.heldItem = new HeldItem(this.camera);

    const lights = this._setupLights();
    this.dayNight = new DayNightCycle(this.scene, lights);
    this.music = new MusicManager();
    this.weather = new Weather(this.scene, hud.rainOverlay);

    // World/player are populated in start() — either procedurally generated
    // (new island) or restored from a save (continue) — not here, so the
    // menu can offer both without doing the work twice.
    this.world = new World(this.scene);
    this.player = null;
    this.minimap = new Minimap(hud.minimapCanvas, this.world);
    this.spawner = new Spawner(this.scene, this.world);
    this.attackCooldownTimer = 0;
    this.mineTarget = null;
    this.mineProgress = 0;
    this.autosaveTimer = AUTOSAVE_INTERVAL;
    this.hungerDrainTimer = HUNGER_DRAIN_INTERVAL;
    this.starveTimer = STARVE_DAMAGE_INTERVAL;
    this.lavaTimer = LAVA_DAMAGE_INTERVAL;
    this.footstepTimer = 0;
    this.difficulty = 'normal';
    this.prestigeLevel = Save.getPrestige();
    this.stats = { blocksMined: 0, bossKills: 0 };
    this._recorded = { blocksMined: 0, bossKills: 0 };

    this.inventory = new Inventory(hud.hotbar);
    this.invScreen = new InventoryScreen(hud.invGrid, hud.recipeList, hud.armorSlot, this.inventory);
    this.chestScreen = new ChestScreen(hud.chestGrid, hud.chestPlayerGrid, this.inventory);
    this.openChestPos = null;
    this.merchantScreen = new MerchantScreen(hud.tradeList, this.inventory);
    this.merchant = null;
    this.quests = new QuestManager(this.inventory);
    this.questScreen = new QuestScreen(hud.questPanel, this.quests, this);
    this.questScreen.onClaim = () => this.music.playQuestComplete();
    this.villagers = [];
    this.animals = [];
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
      onToggleCursor: () => this.toggleCursorLock(),
    });

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'running') this.pause();
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === this.canvas) return;
      // toggleCursorLock()'s own exit shouldn't trip this safety pause —
      // only an unexpected loss (native Escape, alt-tab, ...) should.
      if (this._cursorFreedIntentionally) { this._cursorFreedIntentionally = false; return; }
      if (this.state === 'running') this.pause();
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
  // (falls back to 'new' if there isn't one). difficulty only applies to
  // 'new' — continuing restores whatever the save was started with.
  start(mode = 'new', difficulty = 'normal') {
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
      this.difficulty = saveData.difficulty || 'normal';
      if (saveData.quests) {
        this.quests.index = saveData.quests.index;
        this.quests.kills = saveData.quests.kills;
      }
    } else {
      this.difficulty = DIFFICULTY_SCALE[difficulty] ? difficulty : 'normal';
      this.world.generateHomeRegion();
      this.player = new Player(this.world, this.world.spawnPoint);
    }
    this._applyStatScale();
    this.minimap.reset();
    this.spawner.enemies.forEach((e) => e.dispose(this.scene));
    this.spawner.enemies = [];
    this.spawner.spawnTimer = this.spawner.graceTimer = SPAWN_GRACE_SECONDS;

    if (this.hud.hardmodeBadge) this.hud.hardmodeBadge.hidden = !this.world.hardmode;
    if (this.hud.safestartBadge) {
      this.hud.safestartBadge.hidden = false;
      this.hud.safestartBadge.style.opacity = '1';
    }
    if (this.hud.cursorHint) {
      this.hud.cursorHint.hidden = false;
      this.hud.cursorHint.style.opacity = '1';
      clearTimeout(this._cursorHintTimer);
      this._cursorHintTimer = setTimeout(() => {
        if (!this.hud.cursorHint) return;
        this.hud.cursorHint.style.opacity = '0';
        setTimeout(() => { this.hud.cursorHint.hidden = true; }, 600);
      }, 12000);
    }
    this.spawnVillagers();
    this.spawnRuinsGuardians();
    this.spawnVaultGuardians();
    this.spawnAnimals();

    this.state = 'running';
    this.hud.hud.hidden = false;
    this.input.requestPointerLock();
    this.music.init(); // first call must happen from this user-gesture handler
    this.clock.getDelta();
    this._loop();
    // Redundant (but harmless) when called from the main menu, which already
    // hides its own screen — necessary when start() is called mid-game, e.g.
    // Game.prestige() firing while the merchant/quest screen is still open.
    this.onStateChange('running');
  }

  _applyStatScale() {
    const diff = DIFFICULTY_SCALE[this.difficulty] || DIFFICULTY_SCALE.normal;
    const prestigeMult = 1 + PRESTIGE_STAT_STEP * this.prestigeLevel;
    this.spawner.statScale = { hp: diff.hp * prestigeMult, damage: diff.damage * prestigeMult };
  }

  // New Game+: available once the questline is fully done. Bumps the
  // persistent prestige level (survives "New Island", unlike everything
  // else) and starts a completely fresh island at the same difficulty.
  prestige() {
    if (!this.quests.done) return false;
    this.prestigeLevel += 1;
    Save.setPrestige(this.prestigeLevel);
    Save.clearSave();
    this.quests.index = 0;
    this.quests.kills = {};
    this.start('new', this.difficulty);
    return true;
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

  // Frees/re-locks the mouse cursor without pausing the sim — lets the
  // player click HUD icons (backpack, waypoints) mid-run instead of having
  // to go through the full pause menu just to move the mouse.
  toggleCursorLock() {
    if (this.state !== 'running') return;
    if (document.pointerLockElement === this.canvas) {
      this._cursorFreedIntentionally = true;
      this.input.exitPointerLock();
    } else {
      this.input.requestPointerLock();
    }
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

  // Report session progress to the shared arcade leaderboard (deltas, like
  // every other game — see assets/js/troll-leaderboard.js).
  recordProgress(reason) {
    const lb = window.TrollLeaderboard;
    if (!lb || !lb.record) return;
    const s = this.stats;
    const ev = {
      day: Math.max(0, Math.round(this.dayNight ? this.dayNight.day : 0)),
      blocks: Math.max(0, s.blocksMined - this._recorded.blocksMined),
      bossKills: Math.max(0, s.bossKills - this._recorded.bossKills),
    };
    try { lb.record('trollrreria-3d', ev); } catch (e) { /* engine hiccups are non-fatal */ }
    this._recorded = { blocksMined: s.blocksMined, bossKills: s.bossKills };
    void window.TrollrunnerAccounts?.reportGameResult?.('trollrreria-3d', ev.day, {
      blocksMined: s.blocksMined, bossKills: s.bossKills, reason,
    });
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
    extras.push(...this.villagers, ...this.animals);
    return extras.length ? [...this.spawner.enemies, ...extras] : this.spawner.enemies;
  }

  spawnVillagers() {
    for (const v of this.villagers) v.dispose(this.scene);
    this.villagers = [];
    const offsets = [[2, -2], [-2, 3], [3, 1], [-6, 5], [6, 5]];
    this._spawnVillagerSet(this.world.villagePos, VILLAGER_DEFS, offsets);
    this._spawnVillagerSet(this.world.outpostPos, OUTPOST_VILLAGER_DEFS, offsets);
  }

  _spawnVillagerSet(center, defs, offsets) {
    if (!center) return;
    const { x, z } = center;
    defs.forEach((def, i) => {
      const [ox, oz] = offsets[i];
      const hx = Math.round(x + ox), hz = Math.round(z + oz);
      const top = this.world.heightMap.get(`${hx},${hz}`);
      if (top === undefined || top < 0) return;
      this.villagers.push(new Villager(this.scene, this.world, { x: hx + 0.5, y: top + 1, z: hz + 0.5 }, def.name, def.lines, def.sprite, def.role));
    });
  }

  // A small wild herd near the village — grazing on any nearby grass tile
  // (not tied to the village center precisely, just biased toward it).
  spawnAnimals() {
    for (const a of this.animals) a.dispose(this.scene);
    this.animals = [];
    const center = this.world.villagePos || this.player?.spawn;
    if (!center) return;
    for (let i = 0; i < 5; i++) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const ax = Math.round(center.x + (Math.random() - 0.5) * 30);
        const az = Math.round(center.z + (Math.random() - 0.5) * 30);
        const top = this.world.heightMap.get(`${ax},${az}`);
        if (top === undefined || top < 0) continue;
        if (this.world.getBlock(ax, top, az) !== BLOCKS.GRASS) continue;
        this.animals.push(new Animal(this.scene, this.world, { x: ax + 0.5, y: top + 1, z: az + 0.5 }));
        break;
      }
    }
  }

  // Farmer villager: walks to the nearest planted crop within range and
  // tends it, tripling its natural growth rate while standing close.
  _tickFarmerVillager(v) {
    let nearestKey = null, nearestDist = 10;
    for (const key of this.world.crops.keys()) {
      const [x, , z] = key.split(',').map(Number);
      const d = Math.hypot(x + 0.5 - v.pos.x, z + 0.5 - v.pos.z);
      if (d < nearestDist) { nearestDist = d; nearestKey = key; }
    }
    if (!nearestKey) { v.directedTarget = null; return; }
    const [cx, , cz] = nearestKey.split(',').map(Number);
    v.directedTarget = { x: cx + 0.5, z: cz + 0.5 };
    if (nearestDist < 1.5) {
      const remaining = this.world.crops.get(nearestKey);
      if (remaining !== undefined) this.world.crops.set(nearestKey, Math.max(0, remaining - 0.05));
    }
  }

  // Guard villager: engages the nearest live enemy within range, dealing
  // modest melee damage on contact — a real (if fragile) village defender.
  _tickGuardVillager(v) {
    let nearest = null, nearestDist = 9;
    for (const e of this.spawner.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - v.pos.x, e.pos.z - v.pos.z);
      if (d < nearestDist) { nearestDist = d; nearest = e; }
    }
    if (!nearest) { v.directedTarget = null; return; }
    v.directedTarget = { x: nearest.pos.x, z: nearest.pos.z };
    if (nearestDist < 1.4 && v.attackCooldown <= 0) {
      v.attackCooldown = 1.0;
      nearest.hit(3, v.pos);
    }
  }

  // Pairs up two nearby `fed` animals (not on cooldown) into a new baby —
  // the "husbandry" half of the loop; killing animals for guaranteed meat
  // is the other half (see handleDig).
  _tickAnimalBreeding(dt) {
    for (const a of this.animals) {
      if (a.breedCooldown > 0) a.breedCooldown -= dt;
    }
    for (let i = 0; i < this.animals.length; i++) {
      const a = this.animals[i];
      if (!a.alive || !a.fed || a.breedCooldown > 0) continue;
      for (let j = i + 1; j < this.animals.length; j++) {
        const b = this.animals[j];
        if (!b.alive || !b.fed || b.breedCooldown > 0) continue;
        const dist = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
        if (dist > 3) continue;
        a.fed = false; b.fed = false;
        a.breedCooldown = BREED_COOLDOWN; b.breedCooldown = BREED_COOLDOWN;
        const bx = Math.round((a.pos.x + b.pos.x) / 2), bz = Math.round((a.pos.z + b.pos.z) / 2);
        const top = this.world.heightMap.get(`${bx},${bz}`);
        if (top !== undefined && top >= 0) {
          this.animals.push(new Animal(this.scene, this.world, { x: bx + 0.5, y: top + 1, z: bz + 0.5 }));
        }
        break;
      }
    }
  }

  // Two guardians posted at the ruins on every load — like the merchant and
  // villagers, mob state isn't part of the save file, so clearing the ruins
  // doesn't stay cleared between sessions (same trade-off as everywhere else
  // enemies aren't persisted).
  // Difficulty + prestige scaling for enemies spawned outside the normal
  // random pool (bosses, ruin guardians) — Spawner.trySpawn applies the
  // same statScale to everything else.
  _scaledKind(kind) {
    const { hp, damage } = this.spawner.statScale;
    if (hp === 1 && damage === 1) return kind;
    return { ...kind, hp: Math.round(kind.hp * hp), damage: Math.round(kind.damage * damage) };
  }

  spawnRuinsGuardians() {
    if (!this.world.dungeonPos) return;
    const { x, z } = this.world.dungeonPos;
    for (const [ox, oz] of [[-2, 0], [2, 0]]) {
      const gx = Math.round(x + ox), gz = Math.round(z + oz);
      const top = this.world.heightMap.get(`${gx},${gz}`);
      if (top === undefined || top < 0) continue;
      this.spawner.enemies.push(new Enemy(this.scene, { x: gx + 0.5, y: top + 1, z: gz + 0.5 }, this._scaledKind(ENEMY_TYPES.TROLL_REAPER)));
    }
  }

  // The Vault is buried (vaultPos is the chamber floor, not a surface
  // point), so guardians spawn directly there rather than via heightMap —
  // one more guardian than the Ruins, matching its better loot.
  spawnVaultGuardians() {
    if (!this.world.vaultPos) return;
    const { x, y, z } = this.world.vaultPos;
    for (const [ox, oz] of [[-1.5, -1], [1.5, -1], [0, 1.5]]) {
      this.spawner.enemies.push(new Enemy(this.scene, { x: x + ox, y, z: z + oz }, this._scaledKind(ENEMY_TYPES.TROLL_REAPER)));
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
    this.spawner.enemies.push(new Enemy(this.scene, { x: x + 0.5, y: top + 1, z: z + 0.5 }, this._scaledKind(kind)));
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
    if (this.world.outpostPos) points.push({ name: 'Outpost', pos: this.world.outpostPos });
    if (this.world.dungeonPos) points.push({ name: 'Ruins', pos: this.world.dungeonPos });
    if (this.world.vaultPos) points.push({ name: 'Vault', pos: this.world.vaultPos });
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
      this.heldItem.triggerSwing();

      if (this.animals.includes(hit.entity)) {
        const animalDied = hit.entity.hit(stats.damage);
        this.music.playHit();
        if (animalDied) this.inventory.add(BLOCKS.TROLL_MEAT, 2); // guaranteed — the husbandry payoff
        return;
      }

      const died = hit.entity.hit(stats.damage, this.player.pos);
      this.music.playHit();
      if (died) {
        this.quests.recordKill(hit.entity.type.name);
        if (hit.entity.type.name === 'Archtroll') {
          this.inventory.add(BLOCKS.REAPER_SHARD, 15);
          this.inventory.add(BLOCKS.TROLL_CROWN, 1); // sustains the totem->crown->totem loop
          this.inventory.add(BLOCKS.REAPER_ARMOR, 1);
          this.inventory.add(BLOCKS.ARCANE_DUST, 2); // premium boss loot toward enchanting
          this.stats.bossKills += 1;
        } else if (hit.entity.type.isBoss) {
          this.inventory.add(BLOCKS.REAPER_SHARD, 10);
          this.inventory.add(BLOCKS.TROLL_CROWN, 1);
          this.stats.bossKills += 1;
        } else if (this.world.hardmode && Math.random() < 0.5) {
          this.inventory.add(BLOCKS.REAPER_SHARD, 1);
        }
        if (hit.entity.type.name === 'Troll Grub' && Math.random() < 0.4) this.inventory.add(BLOCKS.TROLL_MEAT, 1);
      }
      return;
    }
    // Block breaking is handled by _tickMining (hold-to-break with
    // progress, see below) — this handler only covers entity attacks now.
  }

  // Hold-to-break mining, Minecraft-style: called every frame while
  // input.digHeld is true. Progress accumulates against whatever block is
  // currently under the crosshair; looking away or releasing resets it.
  _tickMining(dt) {
    if (!this.input.digHeld || this.state !== 'running') { this._resetMining(); return; }
    const hit = performRaycast(this.world, this.player.eyePos, this.player.forwardVector(), REACH, this.entities());
    if (!hit || hit.type !== 'block' || !this.world.isMineable(hit.x, hit.y, hit.z)) { this._resetMining(); return; }

    const id = this.world.getBlock(hit.x, hit.y, hit.z);
    const held = this.inventory.selectedItem();
    const requiredTier = MINE_TIER[id];
    if (requiredTier) {
      const tool = held && TOOL_STATS[held.id];
      if (!tool || tool.kind !== 'pickaxe' || tool.tier < requiredTier) {
        this._resetMining();
        if (Date.now() - (this._lastToolDeniedAt || 0) > 2000) {
          this._lastToolDeniedAt = Date.now();
          this.showDialogue('Tool needed', `Needs a better pickaxe to mine ${BLOCK_NAME[id] || 'this'}.`);
        }
        return;
      }
    }

    const key = `${hit.x},${hit.y},${hit.z}`;
    if (this.mineTarget !== key) {
      this.mineTarget = key;
      this.mineProgress = 0;
    }
    this.mineProgress += dt / mineSeconds(id, held?.id);
    if (this.heldItem.swingT <= 0) this.heldItem.triggerSwing(); // repeating chop while held down
    if (this.hud.mineProgress) {
      this.hud.mineProgress.hidden = false;
      this.hud.mineProgress.style.setProperty('--mine-progress', String(Math.min(1, this.mineProgress)));
    }

    if (this.mineProgress >= 1) {
      this.world.setBlock(hit.x, hit.y, hit.z, BLOCKS.AIR);
      const dropId = DROP_OVERRIDE[id] ?? id;
      const tool = held && TOOL_STATS[held.id];
      // A wood/leaves bonus drop is the axe's whole purpose beyond speed.
      const bonus = (id === BLOCKS.WOOD || id === BLOCKS.LEAVES) && tool && tool.kind === 'axe' ? 1 : 0;
      this.inventory.add(dropId, 1 + bonus);
      this.music.playMine();
      this.stats.blocksMined += 1;
      this._resetMining();
    }
  }

  _resetMining() {
    this.mineTarget = null;
    this.mineProgress = 0;
    if (this.hud.mineProgress) this.hud.mineProgress.hidden = true;
  }

  handlePlace() {
    if (this.state !== 'running') return;
    const hit = performRaycast(this.world, this.player.eyePos, this.player.forwardVector(), REACH, this.entities());
    if (!hit) return;

    // Right-clicking the merchant opens the trade screen; a villager gives
    // a random one-line greeting; an animal gets fed if you're holding wheat.
    if (hit.type === 'entity') {
      if (hit.entity === this.merchant) this.openMerchant();
      else if (this.villagers.includes(hit.entity)) {
        const line = hit.entity.line[Math.floor(Math.random() * hit.entity.line.length)];
        this.showDialogue(hit.entity.name, line);
      } else if (this.animals.includes(hit.entity)) {
        const slot = this.inventory.selectedItem();
        if (slot && slot.id === BLOCKS.WHEAT && this.inventory.consumeSelected()) {
          hit.entity.feed();
          this.music.playPickup();
        }
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
    this._tickMining(dt);
    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0) {
      this.autosaveTimer = AUTOSAVE_INTERVAL;
      this.saveNow();
      this.recordProgress('autosave');
    }
    this.weather.update(dt);
    this.world.tickCrops(dt, this.weather.cropGrowthMultiplier());

    this.hungerDrainTimer -= dt;
    if (this.hungerDrainTimer <= 0) {
      this.hungerDrainTimer = HUNGER_DRAIN_INTERVAL * (DIFFICULTY_SCALE[this.difficulty] || DIFFICULTY_SCALE.normal).hunger;
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

    // Lava contact — checks the block the player's feet/body occupy, not
    // just what they're standing on, so wading into a pool from the side
    // hurts too, not just standing on top of it.
    const p = this.player.pos;
    const inLava = this.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) === BLOCKS.LAVA
      || this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z)) === BLOCKS.LAVA;
    if (inLava) {
      this.lavaTimer -= dt;
      if (this.lavaTimer <= 0) {
        this.lavaTimer = LAVA_DAMAGE_INTERVAL;
        const reduction = this.inventory.armorReduction();
        if (this.player.takeDamage(Math.max(1, Math.round(LAVA_DAMAGE * (1 - reduction))))) died = true;
        else this.music.playHurt();
      }
    } else {
      this.lavaTimer = LAVA_DAMAGE_INTERVAL;
    }

    if (this.hud.hungerFill) this.hud.hungerFill.style.width = `${Math.max(0, (this.player.hunger / this.player.maxHunger) * 100)}%`;

    this.dayNight.update(dt);
    this.music.setMode(this.dayNight.isNight() ? 'night' : 'day');
    if (this.hud.clock) this.hud.clock.textContent = `Day ${this.dayNight.day} · ${this.dayNight.clockString()}`;
    if (!this.world.hardmode && this.dayNight.day >= HARDMODE_TRIGGER_DAY) {
      this.world.hardmode = true;
      if (this.hud.hardmodeBadge) this.hud.hardmodeBadge.hidden = false;
    }
    if (this.hud.safestartBadge && !this.hud.safestartBadge.hidden) {
      const remaining = Math.ceil(this.spawner.graceTimer);
      if (remaining > 0) {
        if (this.hud.safestartTimer) this.hud.safestartTimer.textContent = String(remaining);
      } else if (this.hud.safestartBadge.style.opacity !== '0') {
        this.hud.safestartBadge.style.opacity = '0';
        setTimeout(() => { this.hud.safestartBadge.hidden = true; }, 600);
      }
    }

    // Keeps terrain generated+meshed in a radius around the player and
    // drops the mesh (not the data) for anything too far away — called
    // before movement so the ground the player is about to step onto is
    // never one frame behind having been generated.
    this.world.streamChunks(this.player.pos.x, this.player.pos.z);

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

    for (const v of this.villagers) {
      if (v.role === 'farmer') this._tickFarmerVillager(v);
      else if (v.role === 'guard') this._tickGuardVillager(v);
      v.update(dt);
    }
    this.animals = this.animals.filter((a) => {
      if (a.alive) { a.update(dt); return true; }
      a.dispose(this.scene);
      return false;
    });
    this._tickAnimalBreeding(dt);
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
      this.recordProgress('death');
    }

    const eye = this.player.eyePos;
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0);

    this.heldItem.setItem(this.inventory.selectedItem()?.id ?? null);
    this.heldItem.update(dt, this.player.grounded && (move.x !== 0 || move.z !== 0));

    this.minimap.update(this.player.pos, this.player.yaw);
    this.renderer.render(this.scene, this.camera);
  }
}
