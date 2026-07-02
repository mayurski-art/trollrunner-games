import { Game } from './core/Game.js';
import { StorageManager } from './core/StorageManager.js';
import { AudioManager } from './core/AudioManager.js';
import { UIManager } from './ui/UIManager.js';
import { CharacterSelect } from './ui/CharacterSelect.js';
import { SettingsMenu } from './ui/SettingsMenu.js';

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

// Settings.
const settingsMenu = new SettingsMenu(storage);
settingsMenu.onQualityChange = (q) => game.applyQuality(q);
document.getElementById('btn-settings').addEventListener('click', () => {
  settingsMenu.render();
  ui.showSettings();
  audio.play('click');
});
document.getElementById('btn-settings-back').addEventListener('click', () => game.exitToMenu());
document.getElementById('btn-settings-reset').addEventListener('click', () => {
  if (window.confirm('Reset ALL save data? High score, coins and unlocks will be wiped.')) {
    storage.resetAll();
    window.location.reload();
  }
});

// Revive (mock Troll Coin bank — no wallet).
document.getElementById('btn-revive').addEventListener('click', () => game.revive());
document.getElementById('btn-revive-no').addEventListener('click', () => game.declineRevive());

game.exitToMenu();
game.start();

// Debug/testing handle (also used by the automated smoke test).
window.__memeMetro = { game, storage };
