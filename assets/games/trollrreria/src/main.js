/* Trollrreria — bootstrap + game loop + world-interaction rules.
   Draw order per frame:
     sky -> parallax -> [world transform: tiles -> canopies -> entities ->
     player -> particles -> cracks -> liquids] -> light overlay -> HUD (DOM)
*/

import {
  T, TILES, W, ITEMS, ENEMIES, TILE, ZOOM, CYCLE, DAY_LEN, WORLD_W, WORLD_H, CROP_GROW_TIME,
  REACH, STATION_SCAN, STARTER_ITEMS, TRADER_POOL, PLAYER_W, PLAYER_H, isInteractableTile,
} from "./defs.js";
import { hashStr, clamp, lerp, fmtClock, aabb, dist2, mulberry32 } from "./util.js";
import { generateWorld, biomeAt, zoneAt, BIOME_NAMES, STONE_START, DEEP_START } from "./worldgen.js";
import { Renderer, skyState } from "./render.js";
import { Lighting } from "./lighting.js";
import { Input } from "./input.js";
import { Player } from "./player.js";
import { Inventory } from "./inventory.js";
import { ItemDrop, DamageText, burst, Enemy, Projectile, QuestMarker } from "./entities.js";
import { UI } from "./ui.js";
import { SFX } from "./audio.js";
import { TrollKing, TrollEmperor, Rickroller } from "./boss.js";
import { Archtroll, Rarepepe, ElderShibe, Anon } from "./worldbosses.js";
import {
  MerchantTroll, PepeHermit, RocketTinkerer, WhaleOracle,
  Blacksmith, Alchemist, TavernKeeper, Butcher, SIGN_TIPS, TravelingTrader,
  TrollChef, TrollHistorian,
  VillageSmith, VillageCook, VillageTrader, VillageFarmer,
} from "./npc.js";
import { VILLAGE_BIOMES, VILLAGE_STYLE, siteBiomeX, villageName, villageLoot } from "./villages.js";

/* Housing-gated arrivals, in order: build one qualifying house (see
   housing.js checkHouse) and the next un-housed NPC on this list moves
   in. Checked every 8s in Game.update() against `this.npcs`. */
const HOUSE_ROSTER = [
  { cls: MerchantTroll, msg: "🐕 Doge the Miner moved into your house!" },
  { cls: TrollChef, msg: "👨‍🍳 A Troll Chef moved into your house!" },
  { cls: TrollHistorian, msg: "📜 A Troll Historian moved into your house!" },
];
import { findHouseNear } from "./housing.js";
import {
  saveGame, loadSaveData, applyWorldLayers, clearSave,
  loadSettings, saveSettings, isGuest,
} from "./save.js";
import {
  createQuestState, startQuest, progressQuest, questFor, isDone, loadQuests, serializeQuests,
} from "./quests.js";
import { TouchControls } from "./touch.js";
import { Music } from "./music.js";
import { rleDecode, b64ToU16, rleEncode, u16ToB64 } from "./util.js";
import { Net } from "./net.js";
import { WAYPOINTS } from "./waypoints.js";

const FIXED_DT = 1 / 60;

class Game {
  constructor(canvas, initialSaveData) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    this.input = new Input(canvas);

    this.state = "title";          // title | play | pause
    this.time = 60;                // seconds into the day/night cycle
    this.dayCount = 1;
    this.trollMoon = false;

    this.entities = [];            // drops, projectiles, particles, damage text
    this.enemies = [];
    this.npcs = [];
    this.freeCam = false;          // F4 debug flight
    this.debug = false;
    this.creative = false;         // build mode: infinite blocks, no fall dmg, fly -- never saved
    this.pointerOverUI = false;
    this.deathTimer = 0;

    this.stats = { blocksMined: 0, deepest: 0, bossKills: 0, playSec: 0 };
    this.flags = { bossDown: false };

    this.cam = { x: 0, y: 0 };
    this.lighting = new Lighting();
    this.sfx = new SFX();
    this.net = new Net(this);
    this._fluidAcc = 0;
    this.fps = 0;
    this._fpsAcc = 0; this._fpsN = 0;
    this._wallProg = { idx: -1, t: 0 };
    this.hitPause = 0;              // seconds of freeze-frame remaining
    this.shake = { t: 0, mag: 0 };  // screen shake: remaining time + magnitude

    this._autosaveAcc = 0;
    this._exploreAcc = 0;
    this._recorded = { blocksMined: 0, bossKills: 0 };
    this.settings = loadSettings();
    this.sfx.setVolume(this.settings.volume !== undefined ? this.settings.volume : 0.6);
    this.music = new Music(this.sfx, this.settings.music !== undefined ? this.settings.music : 0.5);

    /* boot into the last save if there is one, else a fresh world.
       Resolved asynchronously (account-aware) before construction -- see
       boot() at the bottom of this file. */
    this.saveData = initialSaveData || null;
    if (this.saveData) {
      this.applySave(this.saveData);
    } else {
      this.newWorld("troll-runner-" + Math.floor(Math.random() * 1e9));
    }
    this.ui = new UI(this);
    this.ui.dirtyInv();
    this.ui.showTitle(!!this.saveData);
    this.touch = new TouchControls(this);
    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("beforeunload", e => {
      const midRun = this.state === "play" || this.state === "pause";
      /* guests never overwrite their own world with the host's */
      if (midRun && (!this.net.active || this.net.isHost)) saveGame(this);
      this.net.stop();
      /* This fires for ANY way of leaving the page -- closing the tab,
         browser back, typing a new URL -- not just the in-game quit
         button or the desktop-shell's postMessage handshake (which only
         works when embedded in an iframe the parent controls). Direct
         visits/popups of this origin never get that handshake, so this
         native "leave site?" prompt is the one save-warning guaranteed to
         show up regardless of how the game was opened. The saveGame()
         call above is fire-and-forget (async cloud write); this native
         dialog buys it time to finish, or lets the player cancel and use
         Pause -> Save world instead. Browsers ignore custom messages here
         and show their own fixed text, but showing *a* prompt at all is
         the point. */
      if (midRun && !this._gracefulClosePending) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    });
    /* the parent desktop shell (mayurski-art.github.io) asks permission
       before it actually closes this window and resets the iframe back to
       the arcade home screen -- see twClose()/requestGameClose() in that
       repo's index.html. A logged-in mid-run save is quick (ack right
       away); a guest gets a real confirm-or-create-account gate first,
       since guest progress is never persisted -- reply "pending" so the
       parent knows to wait instead of assuming this page ignored it. */
    window.addEventListener("message", e => {
      const allowed = ["https://mayurski-art.github.io", "https://www.trollrunner.net", "https://trollrunner.net"];
      if (!allowed.includes(e.origin) || e.data?.type !== "trollrunner:request-close") return;
      // The desktop shell already runs its own graceful-close confirm/save
      // handshake (below) -- skip the native beforeunload prompt too, or an
      // embedded close would show two "are you sure" prompts back to back.
      this._gracefulClosePending = true;
      const reply = type => { try { e.source?.postMessage({ type }, e.origin); } catch {} };
      const midRun = this.state === "play" || this.state === "pause";
      const canSave = !this.net.active || this.net.isHost;
      if (!midRun || !isGuest() || !canSave) {
        if (midRun && canSave) saveGame(this);
        reply("trollrunner:close-ack");
        return;
      }
      reply("trollrunner:close-pending");
      window.TrollrunnerAccounts?.confirmGuestExit?.({
        message: "You're not logged in — this world will not be saved if you close this window.",
        onAccountCreated: () => saveGame(this),
      }).then(choice => {
        reply(choice === "cancel" ? "trollrunner:close-cancel" : "trollrunner:close-ack");
      });
    });

    this._last = performance.now();
    this._acc = 0;
    requestAnimationFrame(t => this.frame(t));

    /* background tabs freeze rAF; this keeps the clock + co-op alive
       (intervals still tick ~1/s in background, which is plenty) */
    setInterval(() => {
      const now = performance.now();
      if (now - this._last > 700 && this.state === "play") {
        this._last = now;
        this.update(FIXED_DT);
        this.input.flush();
      }
    }, 500);
  }

  /* `width` lets saved worlds keep the dimensions they were generated
     with (old saves were 1600 wide; the current default is WORLD_W) --
     decoding a saved layer into a grid of a different size would shear
     every row, so dims always follow the save, never the constant. */
  newWorld(seedStr, character, width) {
    this.seedStr = seedStr;
    this.seed = hashStr(seedStr);
    const { world, spawn, surface, skyPad, groundPad, ruinsBounds } = generateWorld(this.seed, width || WORLD_W);
    this.world = world;
    this.spawn = spawn;
    this.skyPad = skyPad;
    this.groundPad = groundPad;
    this.ruinsBounds = ruinsBounds;
    this.surface = surface;
    this.renderer = new Renderer(world, this.seed);
    this.entities = [];
    this.enemies = [];
    this.npcs = [];
    this.safeZones = [];
    this.travelingTrader = null;
    this.pvp = false;
    this.time = 60;
    this.dayCount = 1;
    this.trollMoon = false;
    this.stats = { blocksMined: 0, deepest: 0, bossKills: 0, playSec: 0 };
    this.flags = { bossDown: false, character: character || "prospector", furnaceFuel: 0 };
    this.smeltCooldown = 0;
    this.quests = createQuestState();
    this._recorded = { blocksMined: 0, bossKills: 0 };
    this.explored = new Uint8Array((this.world.w >> 2) * (this.world.h >> 2));
    this.inventory = new Inventory();
    for (const s of STARTER_ITEMS) this.inventory.add(s.id, s.n);
    this.player = new Player(spawn.x, spawn.y + 1, this.flags.character);
    this.cam.x = this.player.cx - 400;
    this.cam.y = this.player.cy - 260;
    this.placeQuestSign();
    this.spawnTownShops();
    this.spawnVillages();
    this.flags.villagesPlaced = true;
    this.revealAround(this.player.cx, this.player.cy);
    if (this.ui) this.ui.dirtyInv();
  }

  /* Restore a saved world on top of a re-generated one (same seed).
     Old saves predate the w/h fields and were all 1600x800. */
  applySave(data) {
    this.newWorld(data.seedStr, undefined, data.w || 1600);
    applyWorldLayers(this.world, data);
    this.renderer.chunks.clear();
    this.world.dirtyChunks.clear();
    this.time = data.time || 60;
    this.dayCount = data.dayCount || 1;
    this.trollMoon = !!data.trollMoon;
    this.spawn = data.spawn || this.spawn;
    this.stats = Object.assign(this.stats, data.stats);
    this.flags = Object.assign(this.flags, data.flags);
    this.player.setCharacter(this.flags.character);
    this.quests = loadQuests(data.quests);
    this._recorded = { blocksMined: this.stats.blocksMined, bossKills: this.stats.bossKills };
    if (data.explored) {
      try {
        this.explored.set(rleDecode(b64ToU16(data.explored), this.explored.length));
      } catch (e) { /* old save — explored resets */ }
    }
    this.inventory = Inventory.from(data.inv);
    if (data.player) {
      this.player.x = data.player.x;
      this.player.y = data.player.y;
      this.player.hp = data.player.hp;
      this.player.maxHp = data.player.maxHp;
      if (typeof data.player.hunger === "number") {
        this.player.hunger = data.player.hunger;
        this.player.maxHunger = data.player.maxHunger || 100;
      }
    }
    this.cam.x = this.player.cx - this.viewW / 2;
    this.cam.y = this.player.cy - this.viewH / 2;
    if (Array.isArray(data.animals)) this.restoreAnimals(data.animals);
    /* Villages retrofit: newWorld() above already ran spawnVillages() once
       against a throwaway pre-overlay world, and applyWorldLayers() just
       clobbered those tiles with whatever the save actually had -- for a
       save from before this feature existed, that erases them for real.
       Detect that from the SAVE's own flags (not this.flags, which the
       throwaway regen may have already set true) and, if so, re-site and
       re-stamp on top of the real restored terrain, steering clear of
       ground the player has already explored where possible. */
    if (!(data.flags && data.flags.villagesPlaced)) {
      this.spawnVillages();
      this.flags.villagesPlaced = true;
    }
    if (this.ui) this.ui.dirtyInv();
  }

  /* Tamed/bred animals are the only enemies that persist across a save --
     everything wild is deterministically respawned, but a ranch is player
     investment and shouldn't vanish on reload. */
  restoreAnimals(list) {
    for (const a of list) {
      if (!ENEMIES[a.type]) continue;
      const e = new Enemy(a.type, a.x, a.y);
      e.tamed = true;
      e.baby = !!a.baby;
      if (e.baby) e.growTimer = typeof a.growTimer === "number" ? a.growTimer : 60;
      if (typeof a.hp === "number") e.hp = Math.min(e.maxHp, Math.max(1, a.hp));
      this.enemies.push(e);
    }
  }

  startNewWorld(character) {
    clearSave();
    this.newWorld("troll-runner-" + Math.floor(Math.random() * 1e9), character);
    if (this.ui) this.ui.dirtyInv();
    this.enterPlay();
  }

  enterPlay() {
    this.state = "play";
    if (this.ui) this.ui.showScreens({});
  }

  /* Build mode: infinite blocks (see tryPlace/tryPlaceWall), instant
     mining (mineTick), no fall damage + free flight (player.js) -- never
     persisted, always starts off, fully separate from survival saves. */
  toggleCreative() {
    this.creative = !this.creative;
    this.announce(this.creative ? "🛠️ Creative mode ON" : "🛠️ Creative mode OFF");
  }

  async quitToTitle() {
    // Guests are never persisted -- confirm before actually discarding
    // this run, with a one-click way to create an account and keep it.
    if (isGuest()) {
      const choice = await window.TrollrunnerAccounts?.confirmGuestExit?.({
        message: "You're not logged in — this world will not be saved if you quit.",
        onAccountCreated: () => saveGame(this),
      });
      if (choice === "cancel") return;
    }
    saveGame(this);
    this.recordProgress("quit");
    this.state = "title";
    if (this.music) this.music.setContext("title");
    if (this.ui) {
      this.ui.toggleInventory(false);
      this.ui.showTitle(true);
    }
  }

  /* Mark map cells (quarter resolution) explored around a world point. */
  revealAround(wx, wy) {
    if (!this.explored) return;
    const cx = Math.floor(wx / TILE / 4), cy = Math.floor(wy / TILE / 4);
    const R = 11;
    const w4 = this.world.w >> 2, h4 = this.world.h >> 2;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && y >= 0 && x < w4 && y < h4) this.explored[y * w4 + x] = 1;
      }
    }
  }

  /* ============================================================ co-op */
  packLayersForNet() {
    const w = this.world;
    const pack = a => u16ToB64(rleEncode(a));
    return {
      tiles: pack(w.tiles), walls: pack(w.walls),
      liquid: pack(w.liquid), liquidType: pack(w.liquidType),
      wires: pack(w.wires),
      trees: w.trees,
    };
  }

  /* Guest side: replace the local world with the host's snapshot.
     Hosts on older builds don't send dims -- their worlds were 1600. */
  adoptRemoteWorld(m) {
    this.newWorld(m.seedStr, undefined, m.w || 1600);
    const w = this.world, n = w.w * w.h;
    const L = m.layers;
    w.tiles.set(rleDecode(b64ToU16(L.tiles), n));
    w.walls.set(rleDecode(b64ToU16(L.walls), n));
    w.liquid.set(rleDecode(b64ToU16(L.liquid), n));
    w.liquidType.set(rleDecode(b64ToU16(L.liquidType), n));
    w.wires.set(rleDecode(b64ToU16(L.wires), n));
    w.trees = L.trees || [];
    w.chests = new Map((m.chests || []).map(([k, items]) => [k, { items }]));
    w.damage.clear();
    w.dirtyChunks.clear();
    w.liquidActive.clear();
    w.sandActive.clear();
    w.rebuildTopSolid();
    this.renderer.chunks.clear();
    this.time = m.time;
    this.dayCount = m.day;
    this.trollMoon = !!m.moon;
    this.flags = Object.assign(this.flags, m.flags);
    this.spawn = m.spawn || this.spawn;
    this.player.x = this.spawn.x * TILE + 5;
    this.player.y = this.spawn.y * TILE - this.player.h;
    this.cam.x = this.player.cx - this.viewW / 2;
    this.cam.y = this.player.cy - this.viewH / 2;
    this.clampCam();
    this.net.hookWorld();          // re-attach to the fresh world instance
    if (this.ui) this.ui.dirtyInv();
    this.enterPlay();
    this.announce("🌐 Synced with the host — dig together!");
  }

  async hostCoop() {
    const code = this.net.makeCode();
    const ok = await this.net.start(code, true);
    if (!ok) { this.announce("Co-op unavailable (no transport)"); return; }
    this.enterPlay();
    if (this.ui) this.ui.setCoopCode(code);
  }

  async joinCoop(code) {
    code = (code || "").trim().toUpperCase();
    if (code.length < 3) { this.announce("Enter the host's room code first."); return; }
    const ok = await this.net.start(code, false);
    if (!ok) { this.announce("Co-op unavailable (no transport)"); return; }
    if (this.ui) this.ui.setCoopCode(code);
    /* world arrives from the host via adoptRemoteWorld */
  }

  /* ========================================================== quests */
  startQuest(id) { return startQuest(this, id); }
  progressQuest(type, id, amount) { progressQuest(this, type, id, amount); }
  questForNpc(npc) { return questFor(npc.name); }
  questIsDone(id) { return isDone(this.quests, id); }

  /* Report session progress to the shared arcade leaderboard (deltas). */
  recordProgress(reason) {
    const lb = window.TrollLeaderboard;
    if (!lb || !lb.record) return;
    const s = this.stats;
    const ev = {
      depth: Math.max(0, Math.round(s.deepest)),
      blocks: Math.max(0, s.blocksMined - this._recorded.blocksMined),
      bossKills: Math.max(0, s.bossKills - this._recorded.bossKills),
    };
    try { lb.record("trollrreria", ev); } catch (e) { /* engine hiccups are non-fatal */ }
    this._recorded = { blocksMined: s.blocksMined, bossKills: s.bossKills };
    // Real per-account stats + XP (game_run/high_score/game_first_daily) --
    // separate from the mock weekly leaderboard above, which this doesn't
    // touch. No-ops for guests.
    void window.TrollrunnerAccounts?.reportGameResult?.("trollrreria", Math.round(s.deepest), {
      blocksMined: s.blocksMined, bossKills: s.bossKills, reason,
    });
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.ctx.imageSmoothingEnabled = false;
  }

  get viewW() { return this.canvas.width / ZOOM; }
  get viewH() { return this.canvas.height / ZOOM; }

  /* ------------------------------------------------------------- loop */
  frame(now) {
    const raw = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    /* hit-pause: a brief freeze-frame on impactful hits. Skips physics
       for its duration but keeps rendering, so the game visibly holds on
       the hit instead of just continuing -- kept short (tens of ms) and
       gated to real impacts (see triggerHitPause callers) so it reads as
       weight, not lag. */
    if (this.hitPause > 0) {
      this.hitPause = Math.max(0, this.hitPause - raw);
    } else {
      this._acc += raw;
      while (this._acc >= FIXED_DT) {
        this.update(FIXED_DT);
        this._acc -= FIXED_DT;
        /* one-shot input (pressed/clicked/wheel) must not repeat across
           multiple fixed steps within a single frame */
        this.input.flush();
      }
    }
    if (this.shake.t > 0) this.shake.t = Math.max(0, this.shake.t - raw);
    this.render();

    this._fpsAcc += raw; this._fpsN++;
    if (this._fpsAcc >= 0.5) { this.fps = Math.round(this._fpsN / this._fpsAcc); this._fpsAcc = 0; this._fpsN = 0; }
    requestAnimationFrame(t => this.frame(t));
  }

  update(dt) {
    /* pause toggling is on B, not Escape -- Escape is reserved for closing
       panels (inventory/dialog/map/shop, see ui.js), so sharing it with the
       pause toggle meant a panel-close eating the first Escape press and
       pause needing a second. B has no other binding. */
    if (this.input.hit("KeyB")) {
      if (this.state === "pause") {
        this.enterPlay();
      } else if (this.state === "play" && this.ui &&
                 !this.ui.invOpen && !this.ui.dialogNpc && !this.ui.bigMapOpen) {
        this.state = "pause";
        this.ui.showScreens({ pause: true });
      }
    }
    if (this.state !== "play") return;

    /* PvP toggle (host only, co-op only) */
    if (this.input.hit("KeyP") && this.net.active) this.togglePvp();

    /* time of day */
    const prevTime = this.time;
    this.time += dt;
    if (this.time >= CYCLE) {
      this.time -= CYCLE;
      this.dayCount++;
      this.trollMoon = false;
      /* dawn world events: independent rolls, both gated a couple days in
         so a fresh world has time to breathe first */
      if (this.dayCount >= 3 && Math.random() < 0.12) this.spawnMeteor();
      if (this.dayCount >= 2 && !this.travelingTrader && Math.random() < 0.3) this.spawnTravelingTrader();
    } else if (prevTime < DAY_LEN && this.time >= DAY_LEN) {
      /* nightfall: occasionally the Troll Moon rises */
      if (this.dayCount >= 2 && Math.random() < 0.15) {
        this.trollMoon = true;
        this.announce("The Troll Moon rises… problem?");
      }
      /* the trader packs up at dusk -- a rotating visitor, not a resident */
      if (this.travelingTrader) this.despawnTravelingTrader();
    }
    this.stats.playSec += dt;
    /* a lit furnace keeps burning in real time, whether or not you're
       actively smelting -- same as a real fire */
    if (this.flags.furnaceFuel > 0) this.flags.furnaceFuel = Math.max(0, this.flags.furnaceFuel - dt);
    if (this.smeltCooldown > 0) this.smeltCooldown = Math.max(0, this.smeltCooldown - dt);
    this.updateSpawns(dt);
    this.updateAnimalSpawns(dt);
    this.world.tickGrowth(dt);

    /* liquids + falling sand tick at 12.5 Hz */
    this._fluidAcc += dt;
    while (this._fluidAcc >= 0.08) {
      this._fluidAcc -= 0.08;
      this.world.simLiquids();
      this.world.simSand();
    }

    /* autosave + map exploration (guests don't save the host's world) */
    this._autosaveAcc += dt;
    if (this._autosaveAcc >= 60) {
      this._autosaveAcc = 0;
      if (!this.net.active || this.net.isHost) saveGame(this);
      this.recordProgress("autosave");
    }
    /* idle autosave: catches players who wander off mid-session instead of
       exiting outright -- saves once per idle stretch, not every frame. */
    if (this.input.idleMs() >= 20000) {
      if (!this._idleSaved) {
        this._idleSaved = true;
        if (!this.net.active || this.net.isHost) saveGame(this);
      }
    } else {
      this._idleSaved = false;
    }
    this.net.update(dt);
    this._exploreAcc += dt;
    if (this._exploreAcc >= 0.4 && this.player && !this.player.dead) {
      this._exploreAcc = 0;
      this.revealAround(this.player.cx, this.player.cy);
      /* area-title popup on crossing into a new zone (surface biome or
         depth-layered band, e.g. surfacing out of the Moon Mines) */
      /* safe-zone crossing notice -- the borders are invisible, so tell
         the player when they step over one */
      const inSafe = !!this.inSafeZone(Math.floor(this.player.cx / TILE), Math.floor(this.player.cy / TILE));
      if (inSafe !== this._inSafeZone) {
        if (this._inSafeZone !== undefined) {
          this.announce(inSafe ? "🛡 Safe zone — enemies keep out" : "🛡 You left the safe zone");
        }
        this._inSafeZone = inSafe;
      }
      const zone = zoneAt(Math.floor(this.player.cx / TILE), Math.floor(this.player.cy / TILE), this.world.w);
      if (zone !== this._lastBiome) {
        this._lastBiome = zone;
        if (this._announcedBiome) this.ui && this.ui.showAreaTitle(BIOME_NAMES[zone] || zone);
        this._announcedBiome = true;
      }
      /* Village discovery: first time the player wanders within range of
         a generated village, flash its name (same area-title popup the
         biome crossing above uses) and announce it once. */
      if (this.villages) {
        const ptx = Math.floor(this.player.cx / TILE), pty = Math.floor(this.player.cy / TILE);
        for (const v of this.villages) {
          if (!v.discovered && Math.abs(ptx - v.x) < 45 && Math.abs(pty - v.y) < 24) {
            v.discovered = true;
            if (!this.flags.villagesDiscovered) this.flags.villagesDiscovered = [];
            if (!this.flags.villagesDiscovered.includes(v.name)) this.flags.villagesDiscovered.push(v.name);
            this.ui && this.ui.showAreaTitle(v.name);
            this.announce(`🏘 You found ${v.name}!`);
          }
        }
      }
      /* the Rickroller guards the Deep Web -- one permanent spawn per
         world, the first time anyone actually reaches that depth. Searches
         for solid footing near the player rather than dropping it blind,
         same idea as debugSpawn(). */
      if (zone === "deepweb" && !this.flags.rickrollerSpawned) {
        this.flags.rickrollerSpawned = true;
        const spot = this.findGroundNear(Math.floor(this.player.cx / TILE), Math.floor(this.player.cy / TILE));
        if (spot) {
          this.enemies.push(new Rickroller(spot.tx * TILE + 8, (spot.ty + 1) * TILE));
          this.announce("📼 Something's buffering in the dark...");
        }
      }
      /* The Archtroll wakes the first time anyone actually walks into the
         Rage Comic Ruins room (not just nearby -- the carved room's own
         bounds from worldgen). */
      if (this.ruinsBounds && !this.flags.archtrollSpawned) {
        const r = this.ruinsBounds;
        const ptx = Math.floor(this.player.cx / TILE), pty = Math.floor(this.player.cy / TILE);
        if (ptx >= r.x && ptx < r.x + r.w && pty >= r.y && pty < r.y + r.h) {
          this.flags.archtrollSpawned = true;
          this.enemies.push(new Archtroll(this.player.cx + (this.player.dir > 0 ? 90 : -90), this.player.cy));
          this.announce("🏛 Something ancient stirs in the Ruins...");
        }
      }
      /* Rarepepe sleeps at the bottom of Pepe Swamp -- wakes once the
         player reaches real depth while still inside the swamp's x-band. */
      if (zone === "moonMines" && biomeAt(Math.floor(this.player.cx / TILE), this.world.w) === "swamp" &&
          !this.flags.rarepepeSpawned) {
        this.flags.rarepepeSpawned = true;
        const spot = this.findGroundNear(Math.floor(this.player.cx / TILE), Math.floor(this.player.cy / TILE));
        if (spot) {
          this.enemies.push(new Rarepepe(spot.tx * TILE + 8, (spot.ty + 1) * TILE));
          this.announce("🐸 Something in the deep swamp is crying...");
        }
      }
      /* The Elder Shibe wakes at the floor of the Doge Moon Mines proper --
         guarded off from the swamp's x-band so he doesn't overlap with
         Rarepepe's spot. */
      if (zone === "moonMines" &&
          biomeAt(Math.floor(this.player.cx / TILE), this.world.w) !== "swamp" &&
          Math.floor(this.player.cy / TILE) > (STONE_START + DEEP_START) / 2 &&
          !this.flags.shibeSpawned) {
        this.flags.shibeSpawned = true;
        this.enemies.push(new ElderShibe(this.player.cx, this.player.cy - 100));
        this.announce("🐕 Something ancient opens one eye...");
      }
    }

    this.checkPlates();
    this.tickPendingPulses(dt);
    this.tickDeviceReverts(dt);

    /* housing: every 8s, see if a valid player-built house (housing.js
       checkHouse) attracts the next un-housed NPC on the roster -- one
       arrival per house, in order, same as the original single-Merchant
       hook just generalized to more than one resident. */
    this._houseAcc = (this._houseAcc || 0) + dt;
    if (this._houseAcc >= 8 && this.player && !this.player.dead) {
      this._houseAcc = 0;
      const next = HOUSE_ROSTER.find(r => !this.npcs.some(n => n instanceof r.cls));
      if (next) {
        const ptx = Math.floor(this.player.cx / TILE), pty = Math.floor(this.player.cy / TILE);
        const house = findHouseNear(this.world, ptx, pty, 50);
        if (house) {
          this.npcs.push(new next.cls(house.cx, house.cy + 1));
          /* a settled resident makes the player's base a safe zone too */
          this.addSafeZone(house.cx, house.cy, 24);
          this.announce(next.msg);
        }
      }
    }

    /* music follows the situation */
    if (this.music) {
      const st2 = skyState(this.time);
      let ctxName = "day";
      if (this.enemies.some(e => e.boss && !e.dead)) ctxName = "boss";
      else if (this.player && this.player.y / TILE > 330) ctxName = "cave";
      else if (st2.isNight) ctxName = "night";
      this.music.setContext(ctxName);
    }

    if (this.input.hit("F3")) this.debug = !this.debug;
    if (this.input.hit("F4")) this.freeCam = !this.freeCam;

    this.pointerOverUI = this.ui ? this.ui.pointerOver : false;

    /* player */
    if (this.player) {
      if (this.player.dead) {
        this.deathTimer -= dt;
        if (this.deathTimer <= 0) {
          this.player.respawn(this);
          this.ui && this.ui.showScreens({});
        }
      } else {
        this.player.update(dt, this);
        this.stats.deepest = Math.max(
          this.stats.deepest,
          (Math.floor(this.player.y / TILE) - 260) * 2
        );
      }
    }

    /* entities */
    for (const e of this.entities) e.update(dt, this);
    for (const e of this.enemies) e.update(dt, this);
    for (const e of this.npcs) {
      e.update(dt, this);
      /* "!" marker: this NPC has a live, un-done quest to hand out */
      const qid = questFor(e.name);
      e.quest = !!(qid && !this.questIsDone(qid));
    }
    if (this.entities.some(e => e.dead)) this.entities = this.entities.filter(e => !e.dead);
    if (this.enemies.some(e => e.dead)) this.enemies = this.enemies.filter(e => !e.dead);

    /* camera */
    if (this.freeCam) {
      this.updateFreeCam(dt);
    } else if (this.player) {
      const k = 1 - Math.exp(-9 * dt);
      this.cam.x = lerp(this.cam.x, this.player.cx - this.viewW / 2, k);
      this.cam.y = lerp(this.cam.y, this.player.cy - this.viewH * 0.55, k);
      this.clampCam();
    }

    if (this.ui) this.ui.update(dt);
  }

  updateFreeCam(dt) {
    const sp = (this.input.down("ShiftLeft") ? 1400 : 520) * dt;
    if (this.input.down("KeyA") || this.input.down("ArrowLeft")) this.cam.x -= sp;
    if (this.input.down("KeyD") || this.input.down("ArrowRight")) this.cam.x += sp;
    if (this.input.down("KeyW") || this.input.down("ArrowUp")) this.cam.y -= sp;
    if (this.input.down("KeyS") || this.input.down("ArrowDown")) this.cam.y += sp;
    this.clampCam();
  }

  clampCam() {
    this.cam.x = clamp(this.cam.x, 0, this.world.w * TILE - this.viewW);
    this.cam.y = clamp(this.cam.y, 0, this.world.h * TILE - this.viewH);
  }

  /* Mouse position in world px / tiles. */
  mouseWorld() {
    const wx = this.cam.x + this.input.mouse.x / ZOOM;
    const wy = this.cam.y + this.input.mouse.y / ZOOM;
    return { x: wx, y: wy, tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE) };
  }

  /* ==================================================== world editing */
  /* Touch-assist: taps aren't tile-precise, so when the tapped tile is
     empty, snap to the nearest breakable tile in the 8 neighbours (still
     reach-checked by the caller). Returns {tx,ty} or null. */
  snapMineTarget(m, tool) {
    const world = this.world;
    const breakable = (tx, ty) => {
      const def = TILES[world.get(tx, ty)];
      if (!def || def.hp === undefined || def.hp === Infinity) return false;
      /* respect tool gating so the snap never "helpfully" bonks the wrong
         material (axes snap to trees, picks skip them) */
      if (def.tool === "axe" && tool && tool.tool !== "axe") return false;
      if (def.tool === "pick" && tool && tool.tool === "axe") return false;
      return true;
    };
    if (breakable(m.tx, m.ty)) return m;
    let best = null, bestD = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const tx = m.tx + dx, ty = m.ty + dy;
        if (!breakable(tx, ty)) continue;
        const d = ((tx + 0.5) * TILE - m.x) ** 2 + ((ty + 0.5) * TILE - m.y) ** 2;
        if (d < bestD) { bestD = d; best = { tx, ty }; }
      }
    }
    return best;
  }

  /* One tick of mining at (tx,ty) with a tool def. */
  mineTick(tx, ty, tool, player) {
    const world = this.world;
    const id = world.get(tx, ty);
    const def = TILES[id];

    /* hammer: strip background walls where there's no tile in the way */
    if (tool.tool === "hammer") {
      if (id === T.AIR && world.getWall(tx, ty) !== W.NONE) {
        player.startSwing(1 / tool.speed);
        const idx = world.idx(tx, ty);
        if (this._wallProg.idx !== idx) this._wallProg = { idx, t: 0 };
        this._wallProg.t += tool.power * tool.speed * FIXED_DT;
        if (this._wallProg.t >= 90) {
          const wDef = world.getWall(tx, ty);
          const dropId = wDef ? (this.wallDrop(wDef)) : null;
          world.setWall(tx, ty, W.NONE);
          if (dropId) this.spawnDrop(tx * TILE + 8, ty * TILE + 8, dropId, 1);
          this._wallProg = { idx: -1, t: 0 };
          this.sfx && this.sfx.dig();
        }
      }
      return;
    }

    if (id === T.AIR || !def || def.hp === Infinity) return;
    /* creative: instant-break anything, any tool, no power gate */
    if (this.creative) {
      player.startSwing(0.1);
      if (world.damageTile(tx, ty, def.hp)) this.breakTileAt(tx, ty);
      return;
    }
    /* soft deco breaks with anything */
    const soft = id === T.PLANT || id === T.SHROOM || id === T.TORCH || id === T.GRIN_FRAG || id === T.PEPE_SCROLL || id === T.ROCKET_PART;
    if (!soft) {
      /* wrong tool equipped (e.g. sword out) used to fail completely
         silently -- furniture like beds/workbenches/chests only mine with
         a pick, and with no feedback that read as "can't pick it back up" */
      if ((def.tool === "axe" && tool.tool !== "axe") || (def.tool === "pick" && tool.tool !== "pick")) {
        const now = performance.now();
        if (!this._weakToolAt || now - this._weakToolAt > 1500) {
          this._weakToolAt = now;
          this.floatText(tx * TILE + 8, ty * TILE - 6,
            `Need ${def.tool === "axe" ? "an axe" : "a pickaxe"} equipped`, "#9a92b8");
        }
        return;
      }
      if (tool.power < (def.pow || 0)) {
        player.startSwing(1 / tool.speed);
        burst(this, tx * TILE + 8, ty * TILE + 8, "#c9c2b8", 1, { life: 0.25, spread: 60 });
        /* say WHY nothing is happening — a plain particle puff reads as
           "broken", not "underpowered" (throttled so it doesn't spam) */
        const now = performance.now();
        if (!this._weakToolAt || now - this._weakToolAt > 1500) {
          this._weakToolAt = now;
          this.floatText(tx * TILE + 8, ty * TILE - 6,
            tool.tool === "axe" ? "Need a stronger axe" : "Need a stronger pick", "#9a92b8");
        }
        return;
      }
    }
    player.startSwing(1 / tool.speed);
    const dmg = tool.power * tool.speed * FIXED_DT * (soft ? 30 : 1);
    if (world.damageTile(tx, ty, dmg)) this.breakTileAt(tx, ty);
    else if (Math.random() < 0.2) {
      this.sfx && this.sfx.tink(def.tool === "axe");
      if (def.pal) burst(this, tx * TILE + 8, ty * TILE + 8, def.pal[1], 2, { life: 0.3, spread: 90 });
    }
  }

  wallDrop(wallId) {
    for (const id in ITEMS) if (ITEMS[id].type === "wall" && ITEMS[id].wall === wallId) return id;
    return null;
  }

  breakTileAt(tx, ty) {
    const world = this.world;
    const id = world.get(tx, ty);
    if (id === T.AIR) return;
    const def = TILES[id];
    const px = tx * TILE + TILE / 2, py = ty * TILE + TILE / 2;

    if (id === T.TREE) {
      const tree = world.treeAt(tx, ty);
      if (tree) {
        world.removeTree(tree);
        this.spawnDrop(px, (tree.yBase - tree.h / 2) * TILE, "wood", Math.max(4, tree.h * 2));
        burst(this, px, (tree.yBase - tree.h) * TILE, "#3e9e44", 14, { spread: 220 });
        burst(this, px, py, "#66451f", 8);
      } else {
        world.set(tx, ty, T.AIR);
        this.spawnDrop(px, py, "wood", 1);
      }
      this.sfx && this.sfx.chop();
    } else if (id === T.HEART) {
      world.set(tx, ty, T.AIR);
      const p = this.player;
      if (p.maxHp < 200) {
        p.maxHp += 20;
        p.hp = Math.min(p.maxHp, p.hp + 20);
        this.floatText(px, py - 8, "+20 MAX HP", "#ff6d95");
      } else {
        this.floatText(px, py - 8, "MAX TROLL VITALITY", "#ff6d95");
      }
      burst(this, px, py, "#e85f86", 16, { spread: 240, glow: true });
      this.sfx && this.sfx.powerup();
      this.ui && this.ui.dirtyHud();
    } else if (id === T.CHEST) {
      const key = world.chestKey(tx, ty);
      const chest = world.chests.get(key);
      if (chest) {
        for (const s of chest.items) if (s) this.spawnDrop(px, py, s.id, s.n);
        world.chests.delete(key);
      }
      if (this.ui && this.ui.closeChestIf) this.ui.closeChestIf(key);
      world.set(tx, ty, T.AIR);
      this.spawnDrop(px, py, "chest", 1);
    } else if (id === T.DOOR_C || id === T.DOOR_O) {
      const other = world.get(tx, ty - 1) === id ? ty - 1 : ty + 1;
      world.set(tx, ty, T.AIR);
      if (world.get(tx, other) === id) world.set(tx, other, T.AIR);
      this.spawnDrop(px, py, "door", 1);
    } else {
      world.set(tx, ty, T.AIR);
      if (def.drop) this.spawnDrop(px, py, def.drop, 1);
    }

    if (def.pal) burst(this, px, py, def.pal[1], 7);
    this.sfx && this.sfx.dig();
    this.stats.blocksMined++;

    /* knock loose anything that needed this tile */
    this.checkSupport(tx, ty - 1);
    this.checkSupport(tx - 1, ty);
    this.checkSupport(tx + 1, ty);
  }

  /* Break tiles that lost their support (furniture, torches, deco). */
  checkSupport(tx, ty) {
    const world = this.world;
    const id = world.get(tx, ty);
    if (id === T.AIR) return;
    const def = TILES[id];
    const below = world.get(tx, ty + 1);
    const belowSolid = TILES[below] && (TILES[below].solid || TILES[below].oneWay);

    if ((id === T.PLANT || id === T.SHROOM) && !belowSolid) {
      world.set(tx, ty, T.AIR);
      if (def.drop) this.spawnDrop(tx * TILE + 8, ty * TILE + 8, def.drop, 1);
      return;
    }
    if (id === T.TORCH && !this.torchSupported(tx, ty)) {
      world.set(tx, ty, T.AIR);
      this.spawnDrop(tx * TILE + 8, ty * TILE + 8, "torch", 1);
      return;
    }
    const item = def.drop ? ITEMS[def.drop] : null;
    if (item && item.needsFloor && !belowSolid) {
      this.breakTileAt(tx, ty);
    }
  }

  torchSupported(tx, ty) {
    const world = this.world;
    if (world.getWall(tx, ty) !== W.NONE) return true;
    return world.isSolid(tx - 1, ty) || world.isSolid(tx + 1, ty) || world.isSolid(tx, ty + 1);
  }

  /* Place the selected block item at (tx,ty). Returns success. */
  tryPlace(tx, ty, itemId) {
    const world = this.world;
    const def = ITEMS[itemId];
    const tdef = TILES[def.tile];
    const cur = world.get(tx, ty);
    const replaceable = cur === T.AIR || cur === T.PLANT;
    if (!replaceable) return false;

    /* don't entomb yourself or the mobs */
    if (tdef.solid) {
      const box = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
      const bodies = [this.player, ...this.enemies, ...this.npcs];
      for (const b of bodies) {
        if (b && !b.dead &&
            box.x < b.x + b.w && box.x + box.w > b.x &&
            box.y < b.y + b.h && box.y + box.h > b.y) return false;
      }
    }

    const belowSolid = world.isSolid(tx, ty + 1) || world.isOneWay(tx, ty + 1);
    if (def.needsFloor && !belowSolid) return false;
    if (def.needsFarmland && world.get(tx, ty + 1) !== T.FARMLAND) return false;
    if (def.needsCampfireBelow && world.get(tx, ty + 1) !== T.CAMPFIRE) return false;
    if (def.needsSupport && !this.torchSupported(tx, ty)) return false;
    if (def.tall === 2) {
      if (world.get(tx, ty - 1) !== T.AIR || !belowSolid) return false;
    }
    /* generic support: neighbour tile or wall behind -- skipped for the
       cooking pot, whose campfire-below check just above IS its support
       (a campfire isn't solid, so this generic check would otherwise
       block placing one in the open with no walls around it) */
    if (!def.needsFloor && !def.needsSupport && !def.needsCampfireBelow) {
      const support =
        world.isSolid(tx - 1, ty) || world.isSolid(tx + 1, ty) ||
        world.isSolid(tx, ty - 1) || world.isSolid(tx, ty + 1) ||
        world.isOneWay(tx - 1, ty) || world.isOneWay(tx + 1, ty) ||
        world.get(tx - 1, ty) === T.TREE || world.get(tx + 1, ty) === T.TREE ||
        world.getWall(tx, ty) !== W.NONE;
      if (!support) return false;
    }

    if (!this.creative) this.inventory.useSelected();
    /* directional placement (dart traps, repeaters): faces away from the
       player. def.tile is the "left" id, def.rTile the "right" id. */
    let placeId = def.tile;
    if (def.faces && this.player) {
      placeId = (tx + 0.5) * TILE >= this.player.cx ? (def.rTile || def.tile) : def.tile;
    }
    world.set(tx, ty, placeId);
    if (tdef.solid) world.setLiquid(tx, ty, 0);
    if (def.tall === 2) world.set(tx, ty - 1, def.tile);
    if (def.tile === T.CHEST) world.addChest(tx, ty);
    if (def.tile === T.CROP1) world.plantCrop(tx, ty, CROP_GROW_TIME);
    this.sfx && this.sfx.place();
    this.ui && this.ui.dirtyHud();
    return true;
  }

  tryPlaceWall(tx, ty, itemId) {
    const world = this.world;
    const def = ITEMS[itemId];
    if (world.getWall(tx, ty) !== W.NONE) return false;
    if (world.isSolid(tx, ty)) return false;
    const support =
      world.getWall(tx - 1, ty) || world.getWall(tx + 1, ty) ||
      world.getWall(tx, ty - 1) || world.getWall(tx, ty + 1) ||
      world.isSolid(tx - 1, ty) || world.isSolid(tx + 1, ty) ||
      world.isSolid(tx, ty - 1) || world.isSolid(tx, ty + 1);
    if (!support) return false;
    if (!this.creative) this.inventory.useSelected();
    world.setWall(tx, ty, def.wall);
    this.sfx && this.sfx.place();
    this.ui && this.ui.dirtyHud();
    return true;
  }

  /* Right-click: doors, chests, NPCs. */
  interact() {
    const m = this.mouseWorld();
    const world = this.world;
    if (!this.player || !this.player.tileInReach(m.tx, m.ty)) return;
    if (this.tryFeedAnimal(m)) return;
    const id = world.get(m.tx, m.ty);

    if (id === T.DOOR_C) {
      const otherY = world.get(m.tx, m.ty - 1) === T.DOOR_C ? m.ty - 1 : m.ty + 1;
      world.set(m.tx, m.ty, T.DOOR_O);
      if (world.get(m.tx, otherY) === T.DOOR_C) world.set(m.tx, otherY, T.DOOR_O);
      this.sfx && this.sfx.door();
      return;
    }
    if (id === T.DOOR_O) {
      const otherY = world.get(m.tx, m.ty - 1) === T.DOOR_O ? m.ty - 1 : m.ty + 1;
      const y0 = Math.min(m.ty, otherY);
      const box = { x: m.tx * TILE, y: y0 * TILE, w: TILE, h: TILE * 2 };
      const bodies = [this.player, ...this.enemies, ...this.npcs];
      for (const b of bodies) {
        if (b && !b.dead &&
            box.x < b.x + b.w && box.x + box.w > b.x &&
            box.y < b.y + b.h && box.y + box.h > b.y) return;
      }
      world.set(m.tx, m.ty, T.DOOR_C);
      if (world.get(m.tx, otherY) === T.DOOR_O) world.set(m.tx, otherY, T.DOOR_C);
      this.sfx && this.sfx.door();
      return;
    }
    if (id === T.SIGN) {
      this.readSign(m.tx, m.ty);
      return;
    }
    if (id === T.PYLON && this.ui && this.ui.openPylonTravel) {
      this.ui.openPylonTravel(m.tx, m.ty);
      return;
    }
    if (id === T.CHEST && this.ui && this.ui.openChest) {
      this.ui.openChest(m.tx, m.ty);
      return;
    }
    if (id === T.ENCHANT_TABLE && this.ui && this.ui.openEnchant) {
      this.ui.openEnchant(m.tx, m.ty);
      return;
    }
    /* Any other station tile (workbench/furnace/anvil/campfire): open the
       crafting panel straight away instead of leaving the player to
       discover on their own that standing nearby and pressing E is what
       actually unlocks its recipes. */
    if (TILES[id] && TILES[id].station && this.ui && this.ui.toggleInventory) {
      this.ui.toggleInventory(true);
      return;
    }
    if (id === T.LEVER) {
      this.pulseWire(m.tx, m.ty);
      return;
    }
    if (id === T.TIMER_TORCH || id === T.TIMER_TORCH_OFF || id === T.TRAPDOOR_C || id === T.TRAPDOOR_O) {
      /* right-click acts like a pulse arriving at the device, so timers
         and trapdoors work standalone before any wire is laid */
      this.activateDevice(m.tx, m.ty);
      return;
    }
    if (id === T.ROCKET_PAD) {
      this.useRocketPad(m.tx, m.ty);
      return;
    }
    if (id === T.VAULT_DOOR) {
      this.useVaultDoor(m.tx, m.ty);
      return;
    }
    if (id === T.GRIN_ALTAR) {
      this.useGrinAltar(m.tx, m.ty);
      return;
    }
    if (id === T.BED) {
      this.spawn = { x: m.tx, y: m.ty - 1 };
      const st = skyState(this.time);
      const nearbyThreat = this.enemies.some(e =>
        !e.dead && (!e.def || !e.def.passive) && dist2(e.cx, e.cy, this.player.cx, this.player.cy) < (TILE * 22) ** 2);
      if (st.isNight && !nearbyThreat) {
        this.time = DAY_LEN;
        this.dayCount++;
        this.trollMoon = false;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 20);
        this.floatText(m.tx * TILE + 8, m.ty * TILE - 8, "Slept till morning 🛏", "#57bd5c");
        this.ui && this.ui.dirtyHud();
      } else if (st.isNight) {
        this.floatText(m.tx * TILE + 8, m.ty * TILE - 8, "Too dangerous to sleep!", "#ff4d5e");
      } else {
        this.floatText(m.tx * TILE + 8, m.ty * TILE - 8, "Spawn set 🛏", "#57bd5c");
      }
      this.sfx && this.sfx.potion();
      return;
    }
    /* NPC chat / shop */
    for (const n of this.npcs) {
      if (Math.abs(n.cx - m.x) < 24 && Math.abs(n.cy - m.y) < 30 && this.ui) {
        /* a shop NPC with a fresh quest to hand out leads with dialog --
           otherwise Doge (a shop NPC) could never actually give his quest,
           since the shop would swallow every interaction first */
        const qid = this.questForNpc(n);
        const questFresh = qid && !this.questIsDone(qid) && !this.quests.progress[qid];
        if (n.shop && this.ui.openShop && !questFresh) this.ui.openShop(n);
        else if (this.ui.openDialog) this.ui.openDialog(n);
        return;
      }
    }
  }

  /* Right-click a passive animal while holding its favorite food: tames it
     if wild, or (once tamed and adult) tries to pair it with a nearby
     tamed mate of the same species to breed. Returns true if it handled
     the click, so interact() can fall through to normal tile logic
     otherwise. */
  tryFeedAnimal(m) {
    const sel = this.inventory.selected;
    if (!sel) return false;
    for (const e of this.enemies) {
      if (e.dead || !e.def.passive || !e.def.tameFood || e.def.tameFood !== sel.id) continue;
      if (Math.abs(e.cx - m.x) > 20 || Math.abs(e.cy - m.y) > 24) continue;
      this.inventory.useSelected();
      this.ui && this.ui.dirtyHud();
      if (!e.tamed) {
        e.tamed = true;
        e.loveCd = 0;
        this.floatText(e.cx, e.y - 10, e.def.name + " tamed!", "#57bd5c");
        this.sfx && this.sfx.potion();
      } else if (e.baby) {
        e.growTimer = Math.max(0, e.growTimer - 20);
        this.floatText(e.cx, e.y - 10, "growing faster!", "#8fb573");
      } else {
        this.tryBreed(e);
      }
      return true;
    }
    return false;
  }

  tryBreed(e) {
    if (e.loveCd > 0) { this.floatText(e.cx, e.y - 10, "not hungry", "#8fb573"); return; }
    const mate = this.enemies.find(o => o !== e && !o.dead && o.type === e.type &&
      o.tamed && !o.baby && (o.loveCd || 0) <= 0 && dist2(o.cx, o.cy, e.cx, e.cy) < (TILE * 6) ** 2);
    if (!mate) {
      e.loveCd = 8;
      this.floatText(e.cx, e.y - 10, "needs a mate nearby", "#c23a60");
      return;
    }
    e.loveCd = 45; mate.loveCd = 45;
    const baby = new Enemy(e.type, (e.cx + mate.cx) / 2, Math.max(e.y + e.h, mate.y + mate.h));
    baby.tamed = true; baby.baby = true; baby.growTimer = 90;
    baby.hp = baby.maxHp = Math.max(1, Math.round(ENEMIES[e.type].hp * 0.4));
    this.enemies.push(baby);
    burst(this, (e.cx + mate.cx) / 2, (e.cy + mate.cy) / 2, "#ff6d95", 14, { spread: 140, up: 60, glow: true });
    this.floatText((e.cx + mate.cx) / 2, Math.min(e.y, mate.y) - 14, "❤", "#ff6d95");
    this.sfx && this.sfx.potion();
  }

  /* ========================================================== wiring */
  /* Wrench click: lay wire (consumes Wire) or cut existing wire (refund). */
  wireTick(tx, ty) {
    const world = this.world;
    const i = world.idx(tx, ty);
    if (this._lastWired === i && this.input.mouse.left && !this.input.clicked.left) return;
    this._lastWired = i;
    if (world.getWire(tx, ty)) {
      world.setWire(tx, ty, 0);
      this.inventory.add("wire", 1);
      this.sfx && this.sfx.tink(false);
      this.ui && this.ui.dirtyHud();
    } else if (this.inventory.count("wire") > 0) {
      this.inventory.consume("wire", 1);
      world.setWire(tx, ty, 1);
      this.sfx && this.sfx.click();
      this.ui && this.ui.dirtyHud();
    }
  }

  /* Pulse a signal from (tx,ty): flood along wires, toggle devices. */
  pulseWire(tx, ty) {
    const world = this.world;
    if (!world.getWire(tx, ty)) {
      /* a lever with no wire still clunks, so builders get feedback */
      this.sfx && this.sfx.door();
      return;
    }
    const seen = new Set();
    const queue = [world.idx(tx, ty)];
    seen.add(queue[0]);
    let guard = 0;
    while (queue.length && guard++ < 400) {
      const i = queue.pop();
      const x = i % world.w, y = (i / world.w) | 0;
      this.activateDevice(x, y);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (!world.inBounds(nx, ny) || !world.getWire(nx, ny)) continue;
        const nid = world.get(nx, ny);
        if (nid === T.REPEATER_L || nid === T.REPEATER_R) {
          /* Repeater: absorbs the pulse instead of conducting it instantly
             -- re-emits one tile further in its facing direction after a
             delay (ticked in update() via _pendingPulses). Doesn't join
             the normal flood, so it genuinely gates timing rather than
             just reacting alongside everything else. */
          const outX = nx + (nid === T.REPEATER_L ? -1 : 1);
          (this._pendingPulses ||= []).push({ x: outX, y: ny, t: 0.5 });
          continue;
        }
        const k = world.idx(nx, ny);
        if (!seen.has(k)) { seen.add(k); queue.push(k); }
      }
    }
    this.sfx && this.sfx.click();
  }

  /* Delayed re-pulses: Repeaters (forward hop after 0.5s) and Timer
     Torches / Trapdoors (self re-pulse after they auto-revert) both just
     schedule a {x,y,t} here instead of needing their own separate timer
     system. */
  tickPendingPulses(dt) {
    if (!this._pendingPulses || !this._pendingPulses.length) return;
    const ready = [];
    this._pendingPulses = this._pendingPulses.filter(p => {
      p.t -= dt;
      if (p.t > 0) return true;
      ready.push(p);
      return false;
    });
    for (const p of ready) {
      if (this.world.getWire(p.x, p.y)) this.pulseWire(p.x, p.y);
    }
  }

  activateDevice(x, y) {
    const world = this.world;
    const id = world.get(x, y);
    switch (id) {
      case T.TORCH: world.set(x, y, T.TORCH_OFF); break;
      case T.TORCH_OFF: world.set(x, y, T.TORCH); break;
      case T.DOOR_C:
      case T.DOOR_O: {
        const other = world.get(x, y - 1) === id ? y - 1 : y + 1;
        const to = id === T.DOOR_C ? T.DOOR_O : T.DOOR_C;
        world.set(x, y, to);
        if (world.get(x, other) === id) world.set(x, other, to);
        break;
      }
      case T.DART_L:
      case T.DART_R: {
        this._trapCd = this._trapCd || new Map();
        const i = world.idx(x, y);
        const now = performance.now();
        if ((this._trapCd.get(i) || 0) > now) break;
        this._trapCd.set(i, now + 900);
        const dir = id === T.DART_L ? -1 : 1;
        this.entities.push(new Projectile(
          x * TILE + 8 + dir * 10, y * TILE + 8, dir * 420, 0,
          { dmg: 15, both: true, kind: "dart", gravity: 0.12, life: 2.5 }
        ));
        this.sfx && this.sfx.bow();
        break;
      }
      /* Timer torch: a pulse starts a clock -- goes dark, then relights
         a few seconds later and re-pulses its own network, which darkens
         it again, and so on. Pulsing it while dark cancels the pending
         relight, so one pulse starts the clock and the next stops it. */
      case T.TIMER_TORCH: {
        world.set(x, y, T.TIMER_TORCH_OFF);
        (this._pendingReverts ||= []).push({ x, y, t: 3, kind: "timer" });
        break;
      }
      case T.TIMER_TORCH_OFF: {
        if (this._pendingReverts) {
          this._pendingReverts = this._pendingReverts.filter(r => !(r.kind === "timer" && r.x === x && r.y === y));
        }
        world.set(x, y, T.TIMER_TORCH);
        break;
      }
      case T.TRAPDOOR_C: {
        world.set(x, y, T.TRAPDOOR_O);
        this.sfx && this.sfx.door();
        (this._pendingReverts ||= []).push({ x, y, t: 3, kind: "trapdoor" });
        break;
      }
      case T.TRAPDOOR_O: {
        this.tryCloseTrapdoor(x, y);
        break;
      }
    }
  }

  /* Auto-reverting devices (timer relight, trapdoor slam) scheduled by
     activateDevice; ticked from update() alongside tickPendingPulses. */
  tickDeviceReverts(dt) {
    if (!this._pendingReverts || !this._pendingReverts.length) return;
    const ready = [];
    this._pendingReverts = this._pendingReverts.filter(r => {
      r.t -= dt;
      if (r.t > 0) return true;
      ready.push(r);
      return false;
    });
    for (const r of ready) {
      const id = this.world.get(r.x, r.y);
      if (r.kind === "timer" && id === T.TIMER_TORCH_OFF) {
        this.world.set(r.x, r.y, T.TIMER_TORCH);
        if (this.world.getWire(r.x, r.y)) (this._pendingPulses ||= []).push({ x: r.x, y: r.y, t: 0.05 });
      } else if (r.kind === "trapdoor" && id === T.TRAPDOOR_O) {
        if (!this.tryCloseTrapdoor(r.x, r.y)) {
          /* something's standing in it -- try again shortly instead of
             entombing whoever's mid-fall through the hatch */
          r.t = 1;
          this._pendingReverts.push(r);
        }
      }
    }
  }

  tryCloseTrapdoor(x, y) {
    const box = { x: x * TILE, y: y * TILE, w: TILE, h: TILE };
    for (const b of [this.player, ...this.enemies, ...this.npcs]) {
      if (b && !b.dead &&
          box.x < b.x + b.w && box.x + box.w > b.x &&
          box.y < b.y + b.h && box.y + box.h > b.y) return false;
    }
    this.world.set(x, y, T.TRAPDOOR_C);
    this.sfx && this.sfx.door();
    return true;
  }

  /* Pressure plates: anything standing on one fires it (with a cooldown). */
  checkPlates() {
    const world = this.world;
    this._plateCd = this._plateCd || new Map();
    const now = performance.now();
    const bodies = [this.player, ...this.enemies, ...this.npcs];
    for (const b of bodies) {
      if (!b || b.dead) continue;
      const tx = Math.floor(b.cx / TILE);
      const ty = Math.floor((b.y + b.h - 2) / TILE);
      if (world.get(tx, ty) !== T.PLATE) continue;
      const i = world.idx(tx, ty);
      if ((this._plateCd.get(i) || 0) > now) continue;
      this._plateCd.set(i, now + 800);
      this.pulseWire(tx, ty);
    }
  }

  /* ========================================================== combat */
  /* Melee sweep: called every frame while a swing is live (player.melee).
     Each swing has an id; an enemy is only hurt once per swing, so holding
     the blade through a crowd clips everyone exactly once per arc. */
  meleeSweep(swing) {
    const p = this.player;
    if (!p) return;
    const def = swing.def;
    const reach = 46 * (def.arc || 1);
    const box = {
      x: p.dir > 0 ? p.x + p.w - 8 : p.x - reach + 8,
      y: p.y - 10, w: reach, h: p.h + 16,
    };
    const dmg = def.dmg * (p.atkDebuff > 0 ? 0.6 : 1); // Rarepepe's sorrowful wail
    for (const e of this.enemies) {
      if (!e.dead && e._swingHit !== swing.id && aabb(box, e.box)) {
        e._swingHit = swing.id;
        e.hurt(this, dmg, p.cx, (def.knock || 200) / 200);
      }
    }
    /* PvP: opt-in and host-controlled. Peers are trust-based ghosts (no
       authoritative server anywhere in the mesh), so a hit is just a
       broadcast the target applies to itself -- same honor system as
       every other message. Melee only for now; arrows stay PvE. */
    if (this.pvp && this.net.connected) {
      for (const [id, peer] of this.net.peers) {
        if (peer._swingHit === swing.id) continue;
        if (aabb(box, { x: peer.x, y: peer.y, w: PLAYER_W, h: PLAYER_H })) {
          peer._swingHit = swing.id;
          this.net.send({ t: "pvpHit", target: id, dmg: Math.round(dmg), fromX: p.cx });
        }
      }
    }
  }

  /* Host flips PvP for the whole room; guests just get told. The flag
     rides the host's 5s time broadcast (like hardmode) so late joiners
     and droppers re-sync automatically. */
  togglePvp() {
    if (this.net.active && !this.net.isHost) {
      this.announce("Only the host can toggle PvP.");
      return;
    }
    this.pvp = !this.pvp;
    this.announce(this.pvp ? "⚔️ PvP enabled — trolls can hurt trolls!" : "🕊 PvP disabled.");
    if (this.net.connected) {
      this.net.send({ t: "note", text: this.pvp ? "⚔️ The host enabled PvP!" : "🕊 The host disabled PvP." });
    }
  }

  /* Bow: consumes one arrow, fires toward the mouse. Returns success. */
  shootArrow(def) {
    const inv = this.inventory;
    const idx = inv.slots.findIndex(s => s && (s.id === "arrow" || s.id === "flameArrow"));
    if (idx < 0) return false;
    const s = inv.slots[idx];
    const ammo = ITEMS[s.id];
    s.n--;
    if (s.n <= 0) inv.slots[idx] = null;
    const p = this.player;
    const m = this.mouseWorld();
    const ang = Math.atan2(m.y - (p.cy - 4), m.x - p.cx);
    p.dir = Math.cos(ang) >= 0 ? 1 : -1;
    p.startSwing(0.22);
    const spd = 540;
    const arrowDmg = (def.dmg + ammo.dmg) * (p.atkDebuff > 0 ? 0.6 : 1);
    this.entities.push(new Projectile(
      p.cx + Math.cos(ang) * 14, p.cy - 4 + Math.sin(ang) * 14,
      Math.cos(ang) * spd, Math.sin(ang) * spd,
      { dmg: arrowDmg, flame: !!ammo.flame }
    ));
    this.sfx && this.sfx.bow();
    this.ui && this.ui.dirtyInv();
    return true;
  }

  /* Enemy spawner: off-screen, tables by depth + time of day. */
  updateSpawns(dt) {
    if (this.noSpawn) return;
    this._spawnAcc = (this._spawnAcc || 0) + dt;
    const st = skyState(this.time);
    /* cut hard from the original 0.7/0.7 + 7/7 cap -- a first pass to
       0.95/7-day,5-night still read as "way too many," so this drops
       density by roughly half again on top of that. */
    const interval = this.trollMoon ? 0.5 : (st.isNight ? 1.6 : 1.1);
    if (this._spawnAcc < interval) return;
    this._spawnAcc = 0;
    const p = this.player;
    if (!p || p.dead) return;
    const cap = this.trollMoon && st.isNight ? 8 : (st.isNight ? 3 : 4);
    if (this.enemies.filter(e => !e.boss && !e.def.passive).length >= cap) return;

    const ptx = Math.floor(p.cx / TILE), pty = Math.floor(p.cy / TILE);
    const world = this.world;
    const vx0 = Math.floor(this.cam.x / TILE) - 3, vx1 = vx0 + Math.ceil(this.viewW / TILE) + 6;
    const vy0 = Math.floor(this.cam.y / TILE) - 3, vy1 = vy0 + Math.ceil(this.viewH / TILE) + 6;

    for (let attempt = 0; attempt < 14; attempt++) {
      const tx = ptx + Math.round((28 + Math.random() * 26) * (Math.random() < 0.5 ? -1 : 1));
      const ty = pty + Math.round((Math.random() - 0.5) * 36);
      if (!world.inBounds(tx, ty)) continue;
      /* must be off-screen */
      if (tx >= vx0 && tx <= vx1 && ty >= vy0 && ty <= vy1) continue;
      /* never inside a town/NPC safe zone */
      if (this.inSafeZone(tx, ty)) continue;

      const type = this.pickSpawnType(ty, st.isNight, biomeAt(clamp(tx, 0, world.w - 1), world.w));
      if (!type) continue;
      const d = ENEMIES[type];
      const flyer = d.ai === "flyer";

      if (flyer) {
        if (world.isSolid(tx, ty) || world.isSolid(tx, ty - 1) || world.isSolid(tx + 1, ty)) continue;
        const e = new Enemy(type, tx * TILE + 8, ty * TILE + d.h);
        if (this.flags.hardmode && Math.random() < 0.4) e.makeElite();
        this.enemies.push(e);
        return;
      }
      /* grounded: walk down to a floor */
      for (let y = ty; y < Math.min(world.h - 2, ty + 14); y++) {
        const tallOk = !world.isSolid(tx, y) && !world.isSolid(tx, y - 1) &&
          (d.h <= 24 || !world.isSolid(tx, y - 2));
        if (tallOk && world.isSolid(tx, y + 1)) {
          const i = y * world.w + tx;
          if (world.liquid[i] > 3) break;
          if (this.inSafeZone(tx, y)) break;   // walked down into a safe zone
          const e = new Enemy(type, tx * TILE + 8, (y + 1) * TILE);
          if (this.flags.hardmode && Math.random() < 0.4) e.makeElite();
          this.enemies.push(e);
          return;
        }
      }
    }
  }

  pickSpawnType(ty, isNight, biome) {
    /* Going Viral: the botnet counterattack creeps into every biome's
       spawn table instead of owning a zone of its own -- the corruption
       IS the point, not a new place to visit. */
    if (this.flags.viral && Math.random() < 0.25) {
      return ["botGoblin", "engagementFarmer", "cloutLeech"][Math.floor(Math.random() * 3)];
    }
    /* Shadow Stalker: hardmode nights only, creeps into any underground
       roll the same way -- never a natural surface spawn, never daytime. */
    if (this.flags.hardmode && isNight && ty >= 310 && Math.random() < 0.12) {
      return "shadowStalker";
    }
    const r = Math.random();
    if (biome === "swamp" && ty < 310) {
      /* Pepe Swamp gets its own surface roster instead of the generic one */
      if (!isNight) return r < 0.75 ? "copeSlime" : r < 0.95 ? "rugPullRat" : "slimeGreen";
      return r < 0.5 ? "fudPhantom" : r < 0.8 ? "copeSlime" : "rugPullRat";
    }
    if (biome === "jungle" && ty < 310) {
      /* Kek Jungle: lizards underfoot, wasps in the canopy */
      if (!isNight) return r < 0.55 ? "kekLizard" : r < 0.9 ? "jungleWasp" : "slimeGreen";
      return r < 0.45 ? "kekLizard" : r < 0.75 ? "jungleWasp" : "zombie";
    }
    if (ty < 310) {
      /* surface */
      if (!isNight) return r < 0.8 ? "slimeGreen" : "slimeBlue";
      if (this.trollMoon) return r < 0.5 ? "zombie" : r < 0.85 ? "eye" : "grinCreeper";
      return r < 0.42 ? "zombie" : r < 0.75 ? "eye" : r < 0.9 ? "slimeBlue" : "grinCreeper";
    }
    /* Rage Comic Ruins live in the stone under the swamp/desert boundary --
       reskin the mid-depth skeleton roll to match whoever's down there */
    if (ty < 650) {
      if (r < 0.4) return "bat";
      if (r < 0.65) return "slimeBlue";
      if (r < 0.85) return biome === "swamp" || biome === "desert" ? "paperHandSkeleton" : "skeleton";
      return "boneArcher";
    }
    if (r < 0.35) return "skeleton";
    if (r < 0.6) return "bat";
    if (r < 0.8) return "slimeBlue";
    return "boneArcher";
  }

  /* Animal spawner: passive food source, daylight + surface only, off-screen. */
  updateAnimalSpawns(dt) {
    if (this.noSpawn) return;
    this._animalAcc = (this._animalAcc || 0) + dt;
    if (this._animalAcc < 2.5) return;
    this._animalAcc = 0;
    const p = this.player;
    if (!p || p.dead) return;
    const st = skyState(this.time);
    if (st.isNight) return;
    if (this.enemies.filter(e => e.def && e.def.passive && !e.tamed).length >= 4) return;

    const world = this.world;
    const ptx = Math.floor(p.cx / TILE), pty = Math.floor(p.cy / TILE);
    const vx0 = Math.floor(this.cam.x / TILE) - 3, vx1 = vx0 + Math.ceil(this.viewW / TILE) + 6;
    const vy0 = Math.floor(this.cam.y / TILE) - 3, vy1 = vy0 + Math.ceil(this.viewH / TILE) + 6;

    for (let attempt = 0; attempt < 10; attempt++) {
      const tx = ptx + Math.round((22 + Math.random() * 24) * (Math.random() < 0.5 ? -1 : 1));
      const ty = pty + Math.round((Math.random() - 0.5) * 20);
      if (!world.inBounds(tx, ty) || ty >= 310) continue;   // surface only
      if (tx >= vx0 && tx <= vx1 && ty >= vy0 && ty <= vy1) continue;   // off-screen

      const type = Math.random() < 0.6 ? "trollBoar" : "trollHen";
      const d = ENEMIES[type];
      for (let y = ty; y < Math.min(world.h - 2, ty + 10); y++) {
        if (!world.isSolid(tx, y) && !world.isSolid(tx, y - 1) && world.isSolid(tx, y + 1)) {
          const i = y * world.w + tx;
          if (world.liquid[i] > 3) break;
          this.enemies.push(new Enemy(type, tx * TILE + 8, (y + 1) * TILE));
          return;
        }
      }
    }
  }

  onKill(enemy) {
    /* hook for boss + future stats */
  }

  /* A static signpost near spawn replaces the old walking Guide Troll --
     no character sprite to confuse with the player, just a carved sign
     that hands out the Lost Grin questline + onboarding tips (right-click,
     see interact() below). Placed directly into the world, not the NPC
     list, so it never wanders and never needs a rig. */
  placeQuestSign() {
    const sx = this.spawn.x + 4;
    for (let y = this.spawn.y - 6; y < this.spawn.y + 10; y++) {
      if (!this.world.isSolid(sx, y) && !this.world.isSolid(sx, y - 1) && this.world.isSolid(sx, y + 1)) {
        this.world.set(sx, y, T.SIGN);
        this.entities.push(new QuestMarker(sx * TILE + 8, y * TILE - 6, "lostGrin"));
        return;
      }
    }
    this.world.set(this.spawn.x, this.spawn.y, T.SIGN);
    this.entities.push(new QuestMarker(this.spawn.x * TILE + 8, this.spawn.y * TILE - 6, "lostGrin"));
  }

  /* One town, one row: every NPC (shops + the three wild wanderers who
     used to be scattered off in the swamp/desert) lives in its own
     stamped house side by side at spawn, for now -- simpler to find,
     one safe zone to defend, no cross-map treks for a quest chat.
     Hamlet keys are kept (`market`/`hearth`) so waypoints.js and
     anything else keying off them still resolves, just both pointing
     into the same row now. */
  spawnTownShops() {
    const roles = [
      { dx: -84, make: (tx, ty, hb) => new Butcher(tx, ty, hb), wallTile: T.STONE_BRICK, wallBg: W.STONE_BRICK, decorTile: T.CHEST },
      { dx: -56, make: (tx, ty, hb) => new Blacksmith(tx, ty, hb), wallTile: T.STONE_BRICK, wallBg: W.STONE_BRICK, decorTile: T.ANVIL },
      { dx: -28, make: (tx, ty, hb) => new Alchemist(tx, ty, hb), wallTile: T.WOOD, wallBg: W.WOOD, decorTile: T.FURNACE },
      { dx: 28, make: (tx, ty, hb) => new TavernKeeper(tx, ty, hb), wallTile: T.WOOD, wallBg: W.WOOD, decorTile: T.CAMPFIRE },
      { dx: 56, make: (tx, ty, hb) => new PepeHermit(tx, ty, hb), wallTile: T.WOOD, wallBg: W.WOOD, rw: 7, interiorH: 4 },
      { dx: 84, make: (tx, ty, hb) => new RocketTinkerer(tx, ty, hb), wallTile: T.STONE_BRICK, wallBg: W.STONE_BRICK, rw: 7, interiorH: 4 },
      { dx: 112, make: (tx, ty, hb) => new WhaleOracle(tx, ty, hb), wallTile: T.STONE_BRICK, wallBg: W.STONE_BRICK, rw: 7, interiorH: 4 },
    ];
    let minX = Infinity, maxX = -Infinity, anchorY = this.spawn.y - 2;
    for (const role of roles) {
      const sx = this.spawn.x + role.dx;
      const doorSide = role.dx < 0 ? 1 : -1;   // door faces spawn
      let placed = false;
      const groundY = this.world.topSolid[sx] ?? this.spawn.y;
      for (let y = groundY - 6; y < groundY + 10; y++) {
        if (!this.world.isSolid(sx, y) && !this.world.isSolid(sx, y - 1) && this.world.isSolid(sx, y + 1)) {
          const bounds = this.buildTownHouse(sx, y, {
            wallTile: role.wallTile, wallBg: role.wallBg, decorTile: role.decorTile,
            doorSide, rw: role.rw, interiorH: role.interiorH,
          });
          this.npcs.push(role.make(sx, y + 1, bounds));
          minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
          anchorY = y - 2;
          placed = true;
          break;
        }
      }
      if (!placed) this.npcs.push(role.make(this.spawn.x, this.spawn.y + 1, null));
    }
    const anchor = Number.isFinite(minX) ? { x: Math.round((minX + maxX) / 2), y: anchorY } : { x: this.spawn.x, y: this.spawn.y - 2 };
    this.hamlets = { market: anchor, hearth: anchor };
    /* single safe zone wide enough to cover the whole row */
    this.addSafeZone(anchor.x, anchor.y, 130);
  }

  /* Safe zones: invisible borders around settled NPCs. `radius` is in
     tiles; the vertical band is fixed and generous so cave entrances
     right under town are covered without shielding the deep mines. */
  addSafeZone(tx, ty, radius = 24) {
    this.safeZones.push({ x0: tx - radius, x1: tx + radius, y0: ty - 24, y1: ty + 16 });
  }

  inSafeZone(tx, ty) {
    if (!this.safeZones) return null;
    for (const z of this.safeZones) {
      if (tx >= z.x0 && tx <= z.x1 && ty >= z.y0 && ty <= z.y1) return z;
    }
    return null;
  }

  /* Stamp a small single-room shop house: solid shell + roof, background
     wall inside, a lit 2-tile ground-level door on one side, a themed
     decor tile opposite it. `feetY` is the open-air tile the NPC's feet
     rest on (ground floor is feetY+1, already solid terrain -- we don't
     touch it, just guarantee it via the stamped floor row so uneven
     terrain under the footprint can't leave a gap). Bulldozes whatever
     was there before, same as the hand-carved underground rooms do. */
  buildTownHouse(sx, feetY, opts = {}) {
    const world = this.world, w = world.w;
    const rw = opts.rw || 9, interiorH = opts.interiorH || 5;
    const wallTile = opts.wallTile || T.WOOD;
    const wallBg = opts.wallBg || W.WOOD;
    const doorSide = opts.doorSide || 1;   // 1 = door on right wall, -1 = left wall
    const x0 = sx - Math.floor(rw / 2), x1 = x0 + rw - 1;
    const floorRow = feetY + 1;
    const roofRow = feetY - interiorH;
    const doorX = doorSide === 1 ? x1 : x0;
    const doorRows = [feetY, feetY - 1];

    for (let y = roofRow; y <= floorRow; y++) {
      for (let x = x0; x <= x1; x++) {
        if (y === floorRow || y === roofRow || x === x0 || x === x1) {
          if (x === doorX && doorRows.includes(y)) world.set(x, y, T.DOOR_C);
          else world.set(x, y, wallTile);
        } else {
          world.set(x, y, T.AIR);
          world.setWall(x, y, wallBg);
        }
      }
    }
    const torchX = doorSide === 1 ? x0 + 1 : x1 - 1;
    world.set(torchX, feetY, T.TORCH);
    if (opts.decorTile) {
      const decorX = doorSide === 1 ? x1 - 2 : x0 + 2;
      if (decorX !== torchX) world.set(decorX, feetY, opts.decorTile);
    }
    /* interior wander fence for the NPC living here, one tile in from
       each side wall so the sprite doesn't clip into it */
    return { minX: (x0 + 1) * TILE, maxX: x1 * TILE };
  }

  /* One procedurally sited village per biome band (snow/desert/jungle,
     see villages.js) -- four houses (Smith/Cook/Trader/Farmer) around a
     small campfire plaza with a public loot chest, using the exact same
     buildTownHouse stamper as the hand-placed spawn Town. Deterministic
     from the world seed, so calling this twice (see applySave's retrofit
     below) reproduces the same sites and names; safe to re-run because it
     clears any previously spawned village NPCs first. */
  spawnVillages() {
    this.npcs = this.npcs.filter(n => !n.isVillager);
    this.villages = [];
    const rng = mulberry32(hashStr(this.seedStr + ":villages"));
    for (const biome of VILLAGE_BIOMES) {
      const cx = this.siteVillage(biome, rng);
      if (cx != null) this.buildVillage(cx, biome, rng);
    }
  }

  /* Re-rolls a candidate site up to 5 times, preferring one the player
     hasn't explored yet (via this.explored, the same fog-of-war bitmap
     the minimap uses) -- matters only for the old-save retrofit, where
     the world is the player's real, already-explored one; on a brand
     new world nothing is explored yet, so the first candidate always
     wins. Falls back to the last candidate rolled if every try lands on
     explored ground -- a village slightly spoiled beats no village. */
  siteVillage(biome, rng) {
    let cx = null;
    for (let i = 0; i < 5; i++) {
      cx = siteBiomeX(biome, this.world.w, rng);
      if (cx == null) return null;
      const groundY = this.world.topSolid[cx];
      if (groundY == null || !this.isExploredTile(cx, groundY)) return cx;
    }
    return cx;
  }

  isExploredTile(tx, ty) {
    if (!this.explored) return false;
    const w4 = this.world.w >> 2, h4 = this.world.h >> 2;
    const x = tx >> 2, y = ty >> 2;
    if (x < 0 || y < 0 || x >= w4 || y >= h4) return false;
    return !!this.explored[y * w4 + x];
  }

  buildVillage(cx, biome, rng) {
    const style = VILLAGE_STYLE[biome] || VILLAGE_STYLE.jungle;
    const name = villageName(rng);
    const groundY = this.world.topSolid[cx] ?? this.spawn.y;
    const roles = [
      { dx: -20, decorTile: T.ANVIL, make: (tx, ty, hb) => new VillageSmith(tx, ty, hb, name, biome) },
      { dx: -7, decorTile: T.CAMPFIRE, make: (tx, ty, hb) => new VillageCook(tx, ty, hb, name, biome) },
      { dx: 7, decorTile: T.CHEST, make: (tx, ty, hb) => new VillageTrader(tx, ty, hb, name, biome) },
      { dx: 20, decorTile: null, farm: true, make: (tx, ty, hb) => new VillageFarmer(tx, ty, hb, name, biome) },
    ];
    let minX = Infinity, maxX = -Infinity, anchorY = groundY - 2, built = 0;
    for (const role of roles) {
      const sx = cx + role.dx;
      const doorSide = role.dx < 0 ? 1 : -1;
      const colGround = this.world.topSolid[sx] ?? groundY;
      for (let y = colGround - 6; y < colGround + 10; y++) {
        if (!this.world.isSolid(sx, y) && !this.world.isSolid(sx, y - 1) && this.world.isSolid(sx, y + 1)) {
          const bounds = this.buildTownHouse(sx, y, {
            wallTile: style.wallTile, wallBg: style.wallBg, decorTile: role.decorTile, doorSide,
          });
          const npc = role.make(sx, y + 1, bounds);
          npc.isVillager = true;
          this.npcs.push(npc);
          minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
          anchorY = y - 2;
          built++;
          if (role.farm) this.plantVillageFarm(sx, colGround);
          break;
        }
      }
    }
    if (!built) return;
    /* plaza: a public campfire + loot chest between the two middle houses */
    const plazaY = this.world.topSolid[cx] ?? groundY;
    for (let y = plazaY - 4; y < plazaY + 6; y++) {
      if (!this.world.isSolid(cx, y) && this.world.isSolid(cx, y + 1)) {
        this.world.set(cx, y, T.CAMPFIRE);
        if (!this.world.isSolid(cx + 1, y) && this.world.isSolid(cx + 1, y + 1)) {
          this.world.set(cx + 1, y, T.CHEST);
          this.world.addChest(cx + 1, y, villageLoot(rng));
        }
        break;
      }
    }
    const anchor = { x: Math.round((minX + maxX) / 2), y: anchorY };
    this.addSafeZone(anchor.x, anchor.y, 40);
    const discovered = !!(this.flags.villagesDiscovered && this.flags.villagesDiscovered.includes(name));
    this.villages.push({ name, biome, x: anchor.x, y: anchor.y, discovered });
  }

  /* A small pre-grown farm patch beside the village Farmer's house so
     there's something to harvest on first arrival, not just an empty
     tilled row -- a few ripe berries plus open farmland to plant on. */
  plantVillageFarm(sx, groundY) {
    for (let i = 0; i < 5; i++) {
      const x = sx + 3 + i;
      const y = this.world.topSolid[x] ?? groundY;
      if (this.world.isSolid(x, y) && !this.world.isSolid(x, y - 1)) {
        this.world.set(x, y, T.FARMLAND);
        if (i < 3) this.world.set(x, y - 1, T.CROP3);
      }
    }
  }

  /* World event: a meteor crashes near the player at dawn, carving a
     small crater and salting it with Meteorite -- a rare ore worth
     leaving the base for, tucked into a spot the player will stumble
     across rather than a message telling them to go dig somewhere. */
  spawnMeteor() {
    const p = this.player;
    if (!p) return;
    const dir = Math.random() < 0.5 ? -1 : 1;
    let tx = Math.floor(p.cx / TILE) + Math.round(dir * (30 + Math.random() * 50));
    tx = Math.max(20, Math.min(this.world.w - 20, tx));
    const groundY = this.world.topSolid[tx];
    if (groundY == null || groundY < 0) return;
    const cx = tx, cy = groundY;
    const R = 4 + Math.floor(Math.random() * 2);
    for (let y = cy - R; y <= cy + R; y++) {
      for (let x = cx - R; x <= cx + R; x++) {
        if (!this.world.inBounds(x, y)) continue;
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 > R * R) continue;
        if (d2 > (R - 1.4) ** 2 && Math.random() < 0.65) this.world.set(x, y, T.METEORITE);
        else this.world.set(x, y, T.AIR);
      }
    }
    this.world.set(cx, cy, T.METEORITE);
    this.announce("☄️ A meteor crashed nearby! Look for the crater.");
  }

  /* World event: a Traveling Trader camps near the player for one day
     with a rotating slice of rare offers, then leaves at dusk. Not a
     stamped-house resident -- see TravelingTrader in npc.js. */
  spawnTravelingTrader() {
    const p = this.player;
    if (!p) return;
    const spot = this.findGroundNear(Math.floor(p.cx / TILE), Math.floor(p.cy / TILE), 24);
    if (!spot) return;
    const trader = new TravelingTrader(spot.tx, spot.ty + 1);
    const pool = [...TRADER_POOL].sort(() => Math.random() - 0.5).slice(0, 4);
    trader.offers = pool;
    this.npcs.push(trader);
    this.travelingTrader = trader;
    this.announce("🎪 A Traveling Trader has set up camp nearby.");
  }

  despawnTravelingTrader() {
    this.travelingTrader.dead = true;
    this.npcs = this.npcs.filter(n => n !== this.travelingTrader);
    this.travelingTrader = null;
    this.announce("The Traveling Trader packed up and left.");
  }

  /* Shared search: find open footing near a tile position (walker-height
     clearance, solid floor). Returns {tx,ty} or null. Used to place
     boss spawns without embedding them in solid rock. */
  findGroundNear(ptx, pty, maxDx = 16) {
    for (let dx = 6; dx <= maxDx; dx++) {
      for (const dir of [1, -1]) {
        const tx = ptx + dir * dx;
        for (let y = pty - 6; y < pty + 10; y++) {
          if (!this.world.isSolid(tx, y) && !this.world.isSolid(tx, y - 1) &&
              !this.world.isSolid(tx, y - 2) && this.world.isSolid(tx, y + 1)) {
            return { tx, ty: y };
          }
        }
      }
    }
    return null;
  }

  /* Rocket pad: hop between the ground pad near spawn and the sky-island
     pad above it. Locked until Quest 4 (Fix the Rocket) is complete --
     both pads physically exist from world-gen either way, so there's
     nothing to place/unplace, just a flag check. */
  useRocketPad(tx, ty) {
    if (!this.flags.rocketPad) {
      this.floatText(tx * TILE + 8, ty * TILE - 10, "Locked — finish 'Fix the Rocket'", "#9a92b8");
      return;
    }
    const p = this.player;
    if (!p) return;
    const atGround = Math.abs(tx - this.groundPad.x) < 2 && Math.abs(ty - this.groundPad.y) < 2;
    const target = atGround ? this.skyPad : this.groundPad;
    p.x = target.x * TILE - p.w / 2;
    p.y = target.y * TILE - p.h;
    p.vx = 0; p.vy = 0;
    this.cam.x = p.cx - this.viewW / 2;
    this.cam.y = p.cy - this.viewH / 2;
    this.clampCam();
    burst(this, p.cx, p.y + p.h, "#5ec8d8", 16, { spread: 260, up: 160 });
    this.sfx && this.sfx.summon();
    this.announce(atGround ? "🚀 To the sky!" : "🚀 Touchdown!");
  }

  /* The weathered sign near spawn: a static stand-in for the old walking
     Guide Troll. Hands out the Lost Grin questline (via ui.openDialog's
     existing questFor() lookup, matched on this "name") and otherwise
     cycles the same onboarding one-liners the Guide used to say. */
  readSign(tx, ty) {
    if (!this._signNpc) {
      this._signNpc = {
        name: "Weathered Sign",
        emoji: "🪧",
        tips: SIGN_TIPS,
        tipIdx: Math.floor(Math.random() * SIGN_TIPS.length),
        nextTip() {
          this.tipIdx = (this.tipIdx + 1) % this.tips.length;
          return this.tips[this.tipIdx];
        },
      };
    }
    this._signNpc.cx = tx * TILE + 8;
    this._signNpc.cy = ty * TILE - 8;
    this.ui && this.ui.openDialog && this.ui.openDialog(this._signNpc);
  }

  /* Whale Vault door: needs a Whale Key (Quest 5's reward from the
     Rickroller). Opens once, permanently -- no reason to re-lock it. */
  useVaultDoor(tx, ty) {
    if (this.inventory.count("whaleKey") < 1) {
      this.floatText(tx * TILE + 8, ty * TILE - 10, "Needs a Whale Key", "#9a92b8");
      return;
    }
    this.inventory.consume("whaleKey", 1);
    this.world.set(tx, ty, T.AIR);
    this.floatText(tx * TILE + 8, ty * TILE - 10, "Vault opened", "#7a8cff");
    this.sfx && this.sfx.door();
    this.ui && this.ui.dirtyInv();
  }

  /* Grin Core altar: the finale turn-in. Needs quests 1-5 done first;
     completing it here (not via an NPC) is what starts + finishes
     Quest 6 in one interaction. */
  useGrinAltar(tx, ty) {
    const prereqs = ["lostGrin", "pepeRecovery", "dogeMoon", "fixRocket", "whaleKey"];
    if (this.questIsDone("grinCore")) {
      this.floatText(tx * TILE + 8, ty * TILE - 10, "The grin is already restored", "#57bd5c");
      return;
    }
    if (!prereqs.every(id => this.questIsDone(id))) {
      this.floatText(tx * TILE + 8, ty * TILE - 10, "The altar needs the other relics first", "#9a92b8");
      return;
    }
    if (!this.quests.progress.grinCore) this.startQuest("grinCore");
    this.progressQuest("altar", "grinCore", 1);
  }

  /* Use a summon item: wake a boss (night only, one at a time). */
  trySummonBoss(itemId = "trollTotem") {
    const st = skyState(this.time);
    const p = this.player;
    if (!p) return;
    if (this.enemies.some(e => e.boss && !e.dead)) {
      this.floatText(p.cx, p.y - 12, "One royal at a time!", "#ff9500");
      return;
    }
    if (!st.isNight) {
      this.floatText(p.cx, p.y - 12, "Royals only wake at night…", "#9a92b8");
      return;
    }
    if (itemId === "emperorSigil" && !this.flags.hardmode) {
      this.floatText(p.cx, p.y - 12, "The sigil is silent… defeat the King first.", "#9a92b8");
      return;
    }
    this.inventory.useSelected();
    this.ui && this.ui.dirtyHud();
    this.sfx && this.sfx.summon();
    const side = Math.random() < 0.5 ? -1 : 1;
    const tx = Math.floor(p.cx / TILE) + side * 24;
    const sy = this.world.topSolid[clamp(tx, 0, this.world.w - 1)];
    if (itemId === "emperorSigil") {
      this.announce("👑👑 THE TROLL EMPEROR DESCENDS!");
      this.enemies.push(new TrollEmperor(tx * TILE + 8, (sy - 12) * TILE));
    } else {
      this.announce("👑 THE TROLL KING HAS AWOKEN!");
      this.enemies.push(new TrollKing(tx * TILE + 8, sy * TILE));
    }
  }

  /* First King kill: the world hardens. Trollium erupts through deep stone. */
  enterHardmode() {
    if (this.flags.hardmode) return;
    this.flags.hardmode = true;
    const world = this.world;
    let veins = 0, guard = 0;
    while (veins < 240 && guard++ < 6000) {
      let x = 20 + Math.floor(Math.random() * (world.w - 40));
      let y = 480 + Math.floor(Math.random() * (world.h - 500));
      let placed = 0;
      const size = 3 + Math.floor(Math.random() * 5);
      for (let s = 0; s < size; s++) {
        if (world.inBounds(x, y) && world.get(x, y) === T.STONE) {
          world.set(x, y, T.TROLLIUM);
          placed++;
        }
        x += Math.floor(Math.random() * 3) - 1;
        y += Math.floor(Math.random() * 3) - 1;
      }
      if (placed > 0) veins++;
    }
    this.announce("⛏ The world hums… TROLLIUM erupts in the deep!");
  }

  /* Going Viral: the botnet's counterattack once the Grin Core is
     restored (Quest 6). Layers onto hardmode rather than replacing its
     trigger -- trollium progression still opens up on the first King
     kill same as always, this just adds a second, later escalation so
     the finale actually changes something instead of just narrating. */
  goingViral() {
    if (this.flags.viral) return;
    this.flags.viral = true;
    this.announce("🦠 GOING VIRAL: the botnet has noticed you.");
    /* Anon, the botnet's lone human defender, shows up right where the
       Core was restored -- one permanent spawn, same as the other three
       world bosses. */
    if (this.player && !this.flags.anonSpawned) {
      this.flags.anonSpawned = true;
      const spot = this.findGroundNear(Math.floor(this.player.cx / TILE), Math.floor(this.player.cy / TILE));
      if (spot) this.enemies.push(new Anon(spot.tx * TILE + 8, (spot.ty + 1) * TILE));
    }
  }

  /* Console/testing helper: spawn an enemy near the player. */
  debugSpawn(type, dxTiles = 6) {
    if (!ENEMIES[type] || !this.player) return null;
    const d = ENEMIES[type];
    const tx = Math.floor(this.player.cx / TILE) + dxTiles;
    for (let y = Math.floor(this.player.cy / TILE) - 8; y < Math.floor(this.player.cy / TILE) + 12; y++) {
      if (!this.world.isSolid(tx, y) && !this.world.isSolid(tx, y - 1) && this.world.isSolid(tx, y + 1)) {
        const e = new Enemy(type, tx * TILE + 8, (y + 1) * TILE);
        this.enemies.push(e);
        return e;
      }
    }
    const e = new Enemy(type, tx * TILE + 8, this.player.y);
    this.enemies.push(e);
    return e;
  }

  announce(text) {
    if (this.player) this.floatText(this.player.cx, this.player.y - 24, text, "#ffb300");
    if (window.TrollNotis && window.TrollNotis.show) {
      try { window.TrollNotis.show({ platform: "x", summary: "Trollrreria — " + text }); }
      catch (e) { /* non-fatal */ }
    }
  }

  /* ========================================================== helpers */
  spawnDrop(x, y, itemId, n, vx) {
    const d = new ItemDrop(x, y, itemId, n);
    if (vx !== undefined) { d.vx = vx; d.vy = -60; }
    this.entities.push(d);
    return d;
  }

  floatText(x, y, text, color) {
    this.entities.push(new DamageText(x, y, text, color));
  }

  /* Fishing (Phase 5): a tile is castable if it's a near-full water cell
     (liquid >= 6/8, matches the "real body of water" feel rather than a
     shallow puddle) with the tile directly above it NOT also full water --
     i.e. this IS the surface, not a submerged cell deeper in the pool.
     Cheaper than a full connected-component flood fill and good enough:
     you can't cast into a two-tile puddle, but you don't need to prove
     the whole lake is connected either. */
  isFishableWater(tx, ty) {
    const w = this.world;
    if (!w.inBounds(tx, ty)) return false;
    const i = ty * w.w + tx;
    if (w.liquid[i] < 6 || w.liquidType[i] !== 0) return false;
    if (w.inBounds(tx, ty - 1)) {
      const ai = (ty - 1) * w.w + tx;
      if (w.liquid[ai] >= 6 && w.liquidType[ai] === 0) return false;
    }
    return true;
  }

  /* Catch table: common fish most of the time, occasional junk, a rare
     golden fish that's purely a sell-to-traders reward (MERCHANT_OFFERS)
     rather than a full daily-quest system -- kept deliberately simple for
     v1. Depth/biome variation is a stretch-goal, not built here. */
  catchFish(tx, ty) {
    const r = Math.random();
    const id = r < 0.6 ? "trollFish" : r < 0.85 ? "rope" : "goldenTrollFish";
    const left = this.inventory.add(id, 1);
    if (left > 0 && this.player) this.spawnDrop(this.player.cx, this.player.cy - 8, id, left);
    return id;
  }

  /* Game-feel: brief freeze-frame + camera shake for impactful hits.
     Durations/magnitudes are deliberately small -- see the note in
     frame() about this reading as weight, not lag. */
  triggerHitPause(dur = 0.03) {
    this.hitPause = Math.max(this.hitPause, dur);
  }

  triggerShake(mag = 3, dur = 0.12) {
    if (mag >= this.shake.mag) this.shake = { t: dur, mag };
  }

  onPlayerDeath(cause) {
    this.deathTimer = 4;
    burst(this, this.player.cx, this.player.cy, "#e8e4da", 18, { spread: 260 });
    this.sfx && this.sfx.death();
    this.triggerShake(8, 0.3);
    this.recordProgress("death");
    if (this.ui) this.ui.showDeath(cause);
  }

  /* $TROLL store battle revive: gets back up exactly where they fell,
     instead of the free respawn-at-spawn/bed. Cancels the pending
     auto-respawn by clearing dead/deathTimer directly rather than racing
     the timer in update(). */
  reviveInPlace() {
    const p = this.player;
    if (!p || !p.dead) return;
    p.dead = false;
    p.hp = Math.max(1, Math.round(p.maxHp * 0.5));
    p.invuln = 2.5;
    p.vx = 0; p.vy = -220;
    this.deathTimer = 0;
    if (this.ui) this.ui.showScreens({});
    burst(this, p.cx, p.cy, "#ffb300", 20, { spread: 300, up: 200, glow: true });
    this.sfx && this.sfx.potion();
    this.floatText(p.cx, p.y - 24, "Back up. Let's go.", "#ffb300");
  }

  /* Fast travel is admin-only for now (same "troll_runner" gate as the
     revive-pay bypass in troll-pay.js) -- a personal convenience, not a
     public feature, until there's a real reason to open it up. */
  isAdmin() {
    const profile = window.TrollrunnerAccounts?.getCachedProfile?.();
    return !!(profile && String(profile.username || "").toLowerCase() === "troll_runner");
  }

  teleportTo(id) {
    if (!this.isAdmin()) return;
    const wp = WAYPOINTS.find(w => w.id === id);
    if (!wp) return;
    const dest = wp.at(this);
    this.warpPlayerTo(dest.tx, dest.ty, wp.name);
  }

  /* Shared warp mechanic behind both the admin-only WAYPOINTS travel
     panel and the player-facing pylon network (see listPylons/
     openPylonTravel below) -- same landing feel (i-frames, no residual
     fall speed, a little sparkle) regardless of which one triggered it. */
  warpPlayerTo(tx, ty, label) {
    const p = this.player;
    if (!p || p.dead) return;
    p.x = tx * TILE + (TILE - p.w) / 2;
    p.y = ty * TILE - p.h;
    p.vx = 0; p.vy = 0;
    p.fallDist = 0;
    p.invuln = Math.max(p.invuln, 0.5);
    burst(this, p.cx, p.cy, "#4dd0ff", 18, { spread: 260, glow: true });
    this.sfx && this.sfx.potion();
    if (label) this.announce(`🧭 Warped to ${label}`);
  }

  /* Every placed Troll Pylon, found by scanning the tile grid rather than
     tracking a live registry -- only runs when the player actually opens
     the pylon panel (infrequent), and works for free in co-op since tiles
     already sync, with no separate persistence needed (pylons are just
     tiles, saved the same as any other block). */
  listPylons() {
    const w = this.world;
    const out = [];
    for (let i = 0; i < w.tiles.length; i++) {
      if (w.tiles[i] === T.PYLON) out.push({ tx: i % w.w, ty: Math.floor(i / w.w) });
    }
    return out;
  }

  /* Names a pylon by the nearest village if it's standing in one (the
     common case, since Traders sell them), else falls back to the
     biome's flavor name -- always something more useful than raw coords. */
  pylonLabel(tx, ty) {
    if (this.villages) {
      for (const v of this.villages) {
        if (Math.abs(tx - v.x) < 30 && Math.abs(ty - v.y) < 20) return v.name;
      }
    }
    const biome = biomeAt(tx, this.world.w);
    return BIOME_NAMES[biome] || biome;
  }

  /* Dynamic light sources: the player's own faint glow (so mining doesn't go
     pitch black just because a pickaxe is selected instead of a torch),
     boosted while actually holding a torch, plus glowing entities. */
  lightSources() {
    const out = [];
    const p = this.player;
    if (p && !p.dead) {
      const sel = this.inventory.selected;
      /* raised from 60: underground platforming was reading as pitch-black
         a couple tiles out, which read as "empty space" until it was too
         late to react */
      const level = sel && sel.id === "torch" ? 255 : 150;
      out.push({ tx: Math.floor(p.cx / TILE), ty: Math.floor(p.cy / TILE), level });
    }
    for (const e of this.entities) {
      if (e.light) out.push({ tx: Math.floor(e.cx / TILE), ty: Math.floor(e.cy / TILE), level: e.light });
    }
    for (const e of this.enemies) {
      if (e.light) out.push({ tx: Math.floor(e.cx / TILE), ty: Math.floor(e.cy / TILE), level: e.light });
    }
    return out;
  }

  /* ----------------------------------------------------------- render */
  render() {
    const ctx = this.ctx;
    const sw = this.canvas.width, sh = this.canvas.height;
    /* screen shake: jitter the real camera for this frame only, restored
       at the end -- update() (which runs separately, before render()) is
       never aware of it, so it can't drift the actual game camera */
    const trueCamX = this.cam.x, trueCamY = this.cam.y;
    if (this.shake.t > 0) {
      this.cam.x += (Math.random() - 0.5) * 2 * this.shake.mag;
      this.cam.y += (Math.random() - 0.5) * 2 * this.shake.mag;
    }
    const cam = this.cam;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const camMidX = Math.floor((cam.x + this.viewW / 2) / TILE);
    const biome = biomeAt(clamp(camMidX, 0, this.world.w - 1), this.world.w);
    this.renderer.drawSky(ctx, sw, sh, this.time, cam.y, this.trollMoon);
    this.renderer.drawParallax(ctx, sw, sh, cam, this.time, biome);

    /* world space */
    ctx.setTransform(ZOOM, 0, 0, ZOOM, -Math.round(cam.x * ZOOM), -Math.round(cam.y * ZOOM));
    ctx.imageSmoothingEnabled = false;
    this.renderer.drawWorld(ctx, cam, this.viewW, this.viewH);
    this.renderer.drawCanopies(ctx, cam, this.viewW, this.viewH);

    for (const e of this.npcs) if (e.draw) e.draw(ctx, this);
    for (const e of this.enemies) if (e.draw) e.draw(ctx, this);
    if (this.net.active) this.net.drawPeers(ctx);
    if (this.player) this.player.draw(ctx, this);
    for (const e of this.entities) if (e.draw) e.draw(ctx, this);

    this.renderer.drawCracks(ctx);
    this.renderer.drawLiquids(ctx, cam, this.viewW, this.viewH);

    /* wires show while holding the wrench or wire */
    const held = this.inventory && this.inventory.selected;
    if (held && (held.id === "wrench" || held.id === "wire")) {
      this.renderer.drawWires(ctx, cam, this.viewW, this.viewH);
    }

    /* lighting */
    const st = skyState(this.time);
    const pad = 14;
    const tx0 = Math.floor(cam.x / TILE) - pad;
    const ty0 = Math.floor(cam.y / TILE) - pad;
    const tw = Math.ceil(this.viewW / TILE) + pad * 2;
    const th = Math.ceil(this.viewH / TILE) + pad * 2;
    this.lighting.compute(this.world, tx0, ty0, tw, th, st.skyLight, this.lightSources());
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.renderer.drawLight(ctx, this.lighting, cam, sw, sh);

    if (this.trollMoon && st.isNight) {
      ctx.fillStyle = "rgba(160,20,28,0.10)";
      ctx.fillRect(0, 0, sw, sh);
    }

    this.drawHover(ctx);
    if (this.debug) this.drawDebug(ctx);

    this.cam.x = trueCamX;
    this.cam.y = trueCamY;
  }

  drawHover(ctx) {
    if (this.pointerOverUI) return;
    const m = this.mouseWorld();
    if (!this.world.inBounds(m.tx, m.ty)) return;
    const inReach = this.player && !this.player.dead && this.player.tileInReach(m.tx, m.ty);
    ctx.setTransform(ZOOM, 0, 0, ZOOM, -Math.round(this.cam.x * ZOOM), -Math.round(this.cam.y * ZOOM));
    ctx.strokeStyle = inReach ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(m.tx * TILE + 0.5, m.ty * TILE + 0.5, TILE - 1, TILE - 1);
    if (inReach && isInteractableTile(this.world.get(m.tx, m.ty))) {
      const label = "RMB";
      ctx.font = "6px monospace";
      const w = ctx.measureText(label).width + 4;
      const x = m.tx * TILE + TILE / 2 - w / 2, y = m.ty * TILE - 9;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x, y, w, 8);
      ctx.fillStyle = "#f2efe9";
      ctx.fillText(label, x + 2, y + 6);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawDebug(ctx) {
    const m = this.mouseWorld();
    const st = skyState(this.time);
    const lines = [
      `fps ${this.fps} · chunks ${this.renderer.chunks.size} · ent ${this.entities.length} · foes ${this.enemies.length}`,
      `cam ${Math.round(this.cam.x)},${Math.round(this.cam.y)} · tile ${m.tx},${m.ty} · freecam(F4) ${this.freeCam}`,
      `day ${this.dayCount} · ${fmtClock(this.time, DAY_LEN, CYCLE - DAY_LEN)} · ${st.isNight ? "night" : "day"} · sky ${st.skyLight}`,
      `seed ${this.seedStr} · mined ${this.stats.blocksMined} · deepest ${this.stats.deepest}ft`,
    ];
    ctx.font = "12px monospace";
    ctx.textBaseline = "top";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(8, 8 + i * 16, ctx.measureText(lines[i]).width + 10, 15);
      ctx.fillStyle = "#9fe870";
      ctx.fillText(lines[i], 13, 10 + i * 16);
    }
  }
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  const canvas = document.getElementById("tt-canvas");
  if (!canvas) { console.error("[trollrreria] canvas missing"); return; }
  // Resolve which save applies (account cloud save, guest-local, or none)
  // BEFORE building the world, so guests never see another account's
  // world and each account only ever sees its own.
  const saveData = await loadSaveData();
  window.TT = new Game(canvas, saveData);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
