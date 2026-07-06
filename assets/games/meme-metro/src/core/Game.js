import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { WorldManager } from '../game/WorldManager.js';
import { Player } from '../game/Player.js';
import { CameraController } from '../game/CameraController.js';
import { DifficultyManager } from '../game/DifficultyManager.js';
import { ObstacleManager } from '../game/ObstacleManager.js';
import { CoinManager } from '../game/CoinManager.js';
import { CollisionManager } from '../game/CollisionManager.js';
import { Effects } from '../game/Effects.js';
import { PowerupManager } from '../game/PowerupManager.js';
import { CHARACTERS, DEFAULT_CHARACTER } from '../data/characters.js';
import { STAGES, DEFAULT_STAGE } from '../data/stages.js';

const MENU_SCROLL_SPEED = 7;
const COUNTDOWN_STEP = 0.6; // seconds per tick of the 3-2-1 resume count

// Owns the renderer, scene, game state machine and the per-frame loop.
// States: menu | running | paused | countdown | revive | gameover.
export class Game {
  constructor(canvas, { ui, storage, audio }) {
    this.ui = ui;
    this.storage = storage;
    this.audio = audio;
    this.state = 'menu';

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.applyQuality(storage.settings.quality);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 260);

    this.world = new WorldManager(this.scene, STAGES[DEFAULT_STAGE]);
    const charDef = CHARACTERS[storage.selectedCharacter] || CHARACTERS[DEFAULT_CHARACTER];
    this.player = new Player(this.scene, charDef);
    this.cameraCtrl = new CameraController(this.camera, storage);
    this.difficulty = new DifficultyManager();
    this.obstacles = new ObstacleManager(this.scene);
    this.coins = new CoinManager(this.scene);
    this.collisions = new CollisionManager();
    this.effects = new Effects(this.scene);
    this.powerups = new PowerupManager(this.scene);

    this.score = 0;
    this.runCoins = 0;
    this.countdownT = 0;
    this.usedRevive = false;
    this.lastCrashCause = '';
    this.revive = null; // ReviveController, wired in by main.js

    this.input = new InputManager(canvas, {
      left: () => this.playerAction('left'),
      right: () => this.playerAction('right'),
      jump: () => this.playerAction('jump'),
      slide: () => this.playerAction('slide'),
      pause: () => this.togglePause(),
    });

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.cameraCtrl.resize(window.innerWidth / window.innerHeight);
    });
    // Auto-pause when the tab loses focus mid-run.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'running') this.pause();
    });

    this.clock = new THREE.Clock();
  }

  // Graphics quality: scales render resolution.
  applyQuality(q) {
    const ratio = q === 'low' ? 0.7 : q === 'medium' ? 1 : Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  playerAction(action) {
    if (this.state !== 'running') return;
    const did = action === 'left' ? this.player.moveLeft()
      : action === 'right' ? this.player.moveRight()
        : action === 'jump' ? this.player.jump()
          : this.player.slide();
    if (did) this.audio.play(action === 'left' || action === 'right' ? 'laneSwitch' : action);
  }

  startRun() {
    this.difficulty.reset();
    this.obstacles.reset();
    this.coins.reset();
    this.effects.reset();
    this.powerups.reset();
    this.player.reset();
    this.score = 0;
    this.runCoins = 0;
    this.usedRevive = false;
    this.state = 'running';
    this.audio.play('click');
    this.ui.showHUD();
  }

  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.ui.showPause();
  }

  resume() {
    if (this.state !== 'paused') return;
    // 3-2-1 countdown before control returns, so an unpause never
    // dumps the player straight into an obstacle.
    this.state = 'countdown';
    this.countdownT = COUNTDOWN_STEP * 3;
    this.ui.showHUD();
    this.ui.showCountdown(3);
  }

  togglePause() {
    if (this.state === 'running') this.pause();
    else if (this.state === 'paused') this.resume();
    else if (this.state === 'countdown') {
      // Re-pause mid-countdown.
      this.ui.hideCountdown();
      this.state = 'paused';
      this.ui.showPause();
    }
  }

  // Rebuild the runner's mesh for a newly selected character.
  setCharacter(id) {
    const def = CHARACTERS[id] || CHARACTERS[DEFAULT_CHARACTER];
    this.player.buildMesh(def);
  }

  exitToMenu() {
    this.state = 'menu';
    this.obstacles.reset();
    this.coins.reset();
    this.effects.reset();
    this.powerups.reset();
    this.player.reset();
    this.ui.showMenu({
      highScore: this.storage.highScore,
      totalCoins: this.storage.totalCoins,
    });
  }

  onCrash(obstacle) {
    this.player.die();
    this.audio.play('crash');
    this.cameraCtrl.shake(0.9, 0.6);
    this.ui.flash(0.55);
    this.lastCrashCause = obstacle.def.name;

    // Offer one real on-chain revive per run (via the shared TrollPay lib).
    if (!this.usedRevive) {
      this.state = 'revive';
      this.revive?.open();
      this.ui.showRevive();
    } else {
      this.finishRun();
    }
  }

  finishRun() {
    this.state = 'gameover';
    this.audio.play('gameOver');
    const score = Math.floor(this.score);
    const newBest = this.storage.recordRun({ score, coins: this.runCoins });
    if (window.TrollLeaderboard) {
      window.TrollLeaderboard.record('meme-metro', { score, coins: this.runCoins });
    }
    // Real per-account stats + XP (game_run/high_score/game_first_daily) --
    // separate from the mock weekly leaderboard above. No-ops for guests.
    void window.TrollrunnerAccounts?.reportGameResult?.('meme-metro', score, {
      coins: this.runCoins, distance: this.difficulty.distance,
    });
    this.ui.showGameOver({
      score,
      coins: this.runCoins,
      distance: this.difficulty.distance,
      best: this.storage.highScore,
      newBest,
      cause: this.lastCrashCause,
    });
  }

  // Called by ReviveController once the on-chain payment is confirmed and
  // the player taps "Confirm & Resume".
  reviveGranted() {
    if (this.state !== 'revive') return;
    this.usedRevive = true;
    // Clear the field, stand the runner back up with a fresh shield,
    // then count back in.
    this.obstacles.reset();
    this.powerups.reset();
    this.powerups.shielded = true;
    this.player.reset();
    this.audio.play('powerup');
    this.state = 'countdown';
    this.countdownT = COUNTDOWN_STEP * 3;
    this.ui.showHUD();
    this.ui.showCountdown(3);
  }

  declineRevive() {
    if (this.state !== 'revive') return;
    this.finishRun();
  }

  start() {
    this.renderer.setAnimationLoop(() => this.tick());
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    let speedT = 0;

    if (this.state === 'running') {
      this.difficulty.update(dt);
      const speed = this.difficulty.currentSpeed * this.powerups.speedMultiplier;
      speedT = this.difficulty.speedT;
      this.player.flying = this.powerups.rocketActive;
      this.player.shieldMesh.visible = this.powerups.shielded;
      this.world.update(dt, speed);
      this.player.update(dt, speed);

      const pattern = this.obstacles.update(dt, speed, this.difficulty);
      if (pattern) {
        this.coins.decoratePattern(pattern);
        this.powerups.maybeSpawn(pattern, this.difficulty);
      }
      this.coins.update(dt, speed);

      const box = this.player.getCollider();
      const picked = this.powerups.update(dt, speed, box);
      if (picked) this.powerups.activate(picked, this.audio);
      if (this.powerups.magnetActive) {
        this.coins.attract(this.player.x, this.player.y + 0.95, dt);
      }

      const grabbed = this.coins.collect(box, (x, y, z) => this.effects.coinBurst(x, y, z));
      if (grabbed) {
        this.runCoins += grabbed;
        this.score += grabbed * 30;
        this.audio.play('coin');
        this.ui.bumpCoins();
      }
      // Distance points scale with the level multiplier shown on the HUD.
      this.score += speed * dt * (4 + 2 * this.difficulty.level);

      const hit = this.collisions.check(box, this.obstacles.active, speed * dt);
      if (hit && !this.powerups.invincible) {
        if (hit.def.soft) {
          this.difficulty.applyStumble();
          this.cameraCtrl.shake(0.3, 0.3);
          this.ui.flash(0.25);
        } else if (this.powerups.absorbHit(this.audio)) {
          // Diamond Hands ate the hit.
          this.cameraCtrl.shake(0.45, 0.35);
          this.ui.flash(0.3);
        } else {
          this.onCrash(hit);
        }
      }

      this.effects.update(dt, speed, speedT, this.player, this.camera);
      this.ui.updatePowerups(this.powerups.hudStatus());
      this.ui.updateHUD({
        score: Math.floor(this.score),
        best: Math.max(this.storage.highScore, Math.floor(this.score)),
        runCoins: this.runCoins,
        totalCoins: this.storage.totalCoins,
        multiplier: this.difficulty.level,
      });
    } else if (this.state === 'countdown') {
      this.countdownT -= dt;
      if (this.countdownT <= 0) {
        this.state = 'running';
        this.ui.hideCountdown();
      } else {
        this.ui.showCountdown(Math.ceil(this.countdownT / COUNTDOWN_STEP));
      }
      this.player.update(dt, 0); // Keep the run cycle alive, world frozen.
    } else if (this.state === 'menu') {
      // Live backdrop: world scrolls slowly, runner jogs in place.
      this.world.update(dt, MENU_SCROLL_SPEED);
      this.player.idle(dt);
      this.effects.update(dt, MENU_SCROLL_SPEED, 0, this.player, this.camera);
    } else if (this.state === 'gameover' || this.state === 'revive') {
      this.player.update(dt, 0); // Finish the fall animation.
      this.effects.update(dt, 0, 0, null, this.camera);
    }

    this.cameraCtrl.update(dt, this.player, speedT);
    this.renderer.render(this.scene, this.camera);
  }
}
