import { Game } from './core/Game.js';
import { StorageManager } from './core/StorageManager.js';
import { AudioManager } from './core/AudioManager.js';
import { UIManager } from './ui/UIManager.js';

const canvas = document.getElementById('mm-canvas');
const storage = new StorageManager();
const audio = new AudioManager(storage);
const ui = new UIManager();
const game = new Game(canvas, { ui, storage, audio });

ui.bind({
  onStart: () => game.startRun(),
  onPauseToggle: () => game.togglePause(),
  onResume: () => game.resume(),
  onRestart: () => game.startRun(),
  onExit: () => game.exitToMenu(),
});

game.exitToMenu();
game.start();

// Debug/testing handle (also used by the automated smoke test).
window.__memeMetro = { game, storage };
