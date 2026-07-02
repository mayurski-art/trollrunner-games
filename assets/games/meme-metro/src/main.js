import { Game } from './core/Game.js';
import { StorageManager } from './core/StorageManager.js';
import { AudioManager } from './core/AudioManager.js';
import { UIManager } from './ui/UIManager.js';
import { CharacterSelect } from './ui/CharacterSelect.js';

const canvas = document.getElementById('mm-canvas');
const storage = new StorageManager();
const audio = new AudioManager(storage);
const ui = new UIManager();
const game = new Game(canvas, { ui, storage, audio });
const charSelect = new CharacterSelect(storage);

ui.bind({
  onStart: () => game.startRun(),
  onPauseToggle: () => game.togglePause(),
  onResume: () => game.resume(),
  onRestart: () => game.startRun(),
  onExit: () => game.exitToMenu(),
});

// Character select navigation. Selecting/unlocking swaps the live runner
// mesh so the menu backdrop previews the new character immediately.
charSelect.onSelect = (id) => {
  game.setCharacter(id);
  audio.play('click');
};
document.getElementById('btn-characters').addEventListener('click', () => {
  charSelect.render();
  ui.showCharacters();
  audio.play('click');
});
document.getElementById('btn-char-back').addEventListener('click', () => game.exitToMenu());

game.exitToMenu();
game.start();

// Debug/testing handle (also used by the automated smoke test).
window.__memeMetro = { game, storage };
