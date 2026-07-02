import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { WorldManager } from '../game/WorldManager.js';
import { Player } from '../game/Player.js';
import { CameraController } from '../game/CameraController.js';
import { DifficultyManager } from '../game/DifficultyManager.js';
import { ObstacleManager } from '../game/ObstacleManager.js';
import { CoinManager } from '../game/CoinManager.js';
import { CollisionManager } from '../game/CollisionManager.js';
import { CHARACTERS, DEFAULT_CHARACTER } from '../data/characters.js';
import { STAGES, DEFAULT_STAGE } from '../data/stages.js';

const MENU_SCROLL_SPEED = 7;

// Owns the renderer, scene, game state machine and the per-frame loop.
// States: menu | running | paused | gameover.
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

    this.score = 0;
    this.runCoins = 0;

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
    this.state = 'running';
    this.ui.showHUD();
  }

  togglePause() {
    if (this.state === 'running') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  exitToMenu() {
    this.state = 'menu';
    this.obstacles.reset();
    this.coins.reset();
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

    if (this.state === 'running') {
      this.difficulty.update(dt);
      const speed = this.difficulty.currentSpeed;
      this.world.update(dt, speed);
      this.player.update(dt, speed);

      const pattern = this.obstacles.update(dt, speed, this.difficulty);
      if (pattern) this.coins.decoratePattern(pattern);
      this.coins.update(dt, speed);

      const box = this.player.getCollider();
      const grabbed = this.coins.collect(box);
      if (grabbed) {
        this.runCoins += grabbed;
        this.score += grabbed * 30;
        this.audio.play('coin');
      }
      // Distance points scale with the level multiplier shown on the HUD.
      this.score += speed * dt * (4 + 2 * this.difficulty.level);

      const hit = this.collisions.check(box, this.obstacles.active);
      if (hit) {
        if (hit.def.soft) {
          this.difficulty.applyStumble();
        } else {
          this.onCrash(hit);
        }
      }

      this.ui.updateHUD({
        score: Math.floor(this.score),
        best: Math.max(this.storage.highScore, Math.floor(this.score)),
        runCoins: this.runCoins,
        totalCoins: this.storage.totalCoins,
        multiplier: this.difficulty.level,
      });
    } else if (this.state === 'menu') {
      // Live backdrop: world scrolls slowly, runner jogs in place.
      this.world.update(dt, MENU_SCROLL_SPEED);
      this.player.idle(dt);
    } else if (this.state === 'gameover') {
      this.player.update(dt, 0); // Finish the fall animation.
    }

    this.cameraCtrl.update(dt, this.player);
    this.renderer.render(this.scene, this.camera);
  }
}
