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
import { CHARACTERS, DEFAULT_CHARACTER } from '../data/characters.js';
import { STAGES, DEFAULT_STAGE } from '../data/stages.js';

const MENU_SCROLL_SPEED = 7;
const COUNTDOWN_STEP = 0.6; // seconds per tick of the 3-2-1 resume count

// Owns the renderer, scene, game state machine and the per-frame loop.
// States: menu | running | paused | countdown | gameover.
export class Game {
  constructor(canvas, { ui, storage, audio }) {
    this.ui = ui;
    this.storage = storage;
    this.audio = audio;
    this.state = 'menu';

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

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

    this.score = 0;
    this.runCoins = 0;
    this.countdownT = 0;

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
    this.player.reset();
    this.score = 0;
    this.runCoins = 0;
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

  exitToMenu() {
    this.state = 'menu';
    this.obstacles.reset();
    this.coins.reset();
    this.effects.reset();
    this.player.reset();
    this.ui.showMenu({
      highScore: this.storage.highScore,
      totalCoins: this.storage.totalCoins,
    });
  }

  onCrash(obstacle) {
    this.player.die();
    this.state = 'gameover';
    this.audio.play('crash');
    this.audio.play('gameOver');
    this.cameraCtrl.shake(0.9, 0.6);
    this.ui.flash(0.55);

    const score = Math.floor(this.score);
    const newBest = this.storage.recordRun({ score, coins: this.runCoins });
    this.ui.showGameOver({
      score,
      coins: this.runCoins,
      distance: this.difficulty.distance,
      best: this.storage.highScore,
      newBest,
      cause: obstacle.def.name,
    });
  }

  start() {
    this.renderer.setAnimationLoop(() => this.tick());
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    let speedT = 0;

    if (this.state === 'running') {
      this.difficulty.update(dt);
      const speed = this.difficulty.currentSpeed;
      speedT = this.difficulty.speedT;
      this.world.update(dt, speed);
      this.player.update(dt, speed);

      const pattern = this.obstacles.update(dt, speed, this.difficulty);
      if (pattern) this.coins.decoratePattern(pattern);
      this.coins.update(dt, speed);

      const box = this.player.getCollider();
      const grabbed = this.coins.collect(box, (x, y, z) => this.effects.coinBurst(x, y, z));
      if (grabbed) {
        this.runCoins += grabbed;
        this.score += grabbed * 30;
        this.audio.play('coin');
        this.ui.bumpCoins();
      }
      // Distance points scale with the level multiplier shown on the HUD.
      this.score += speed * dt * (4 + 2 * this.difficulty.level);

      const hit = this.collisions.check(box, this.obstacles.active);
      if (hit) {
        if (hit.def.soft) {
          this.difficulty.applyStumble();
          this.cameraCtrl.shake(0.3, 0.3);
          this.ui.flash(0.25);
        } else {
          this.onCrash(hit);
        }
      }

      this.effects.update(dt, speed, speedT, this.player, this.camera);
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
    } else if (this.state === 'gameover') {
      this.player.update(dt, 0); // Finish the fall animation.
      this.effects.update(dt, 0, 0, null, this.camera);
    }

    this.cameraCtrl.update(dt, this.player, speedT);
    this.renderer.render(this.scene, this.camera);
  }
}
