import { Game } from './core/Game.js';
import { StorageManager } from './core/StorageManager.js';
import { AudioManager } from './core/AudioManager.js';
import { ReviveController } from './core/Revive.js';
import { UIManager } from './ui/UIManager.js';
import { CharacterSelect } from './ui/CharacterSelect.js';
import { SettingsMenu } from './ui/SettingsMenu.js';

const canvas = document.getElementById('mm-canvas');
const storage = new StorageManager();
const audio = new AudioManager(storage);
const ui = new UIManager();
const game = new Game(canvas, { ui, storage, audio });
const charSelect = new CharacterSelect(storage);

// Resolves the real account save (constructor starts from plain defaults
// synchronously so the game can boot immediately) -- refreshes the menu's
// high score/coin display once the real numbers are known.
void storage.hydrate().then(() => {
  ui.showMenu({ highScore: storage.highScore, totalCoins: storage.totalCoins });
});

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
document.getElementById('btn-settings-reset').addEventListener('click', async () => {
  if (window.confirm('Reset ALL save data? High score, coins and unlocks will be wiped.')) {
    await storage.resetAll();
    window.location.reload();
  }
});

// The parent desktop shell (mayurski-art.github.io) asks permission
// before it actually closes this window -- see twClose()/
// requestGameClose() in that repo's index.html. Guests with real
// progress get a confirm-or-create-account gate first, since guest
// progress is never persisted; reply "pending" so the parent knows to
// wait instead of assuming this page ignored it.
window.addEventListener('message', e => {
  const allowed = ['https://mayurski-art.github.io', 'https://www.trollrunner.net', 'https://trollrunner.net'];
  if (!allowed.includes(e.origin) || e.data?.type !== 'trollrunner:request-close') return;
  const reply = type => { try { e.source?.postMessage({ type }, e.origin); } catch {} };
  if (!storage.isGuest || !storage.hasProgress) {
    reply('trollrunner:close-ack');
    return;
  }
  reply('trollrunner:close-pending');
  window.TrollrunnerAccounts?.confirmGuestExit?.({
    message: "You're not logged in — your high score, coins and unlocks will not be saved if you close this window.",
    onAccountCreated: () => storage.save(),
  }).then(choice => {
    reply(choice === 'cancel' ? 'trollrunner:close-cancel' : 'trollrunner:close-ack');
  });
});

// Revive — real on-chain payment via the shared TrollPay lib.
game.revive = new ReviveController({
  audio,
  onResume: () => game.reviveGranted(),
  onDecline: () => game.declineRevive(),
});

// Leaderboard (shared arcade engine, mounted into #lb-root on load).
document.getElementById('btn-leaderboard').addEventListener('click', () => {
  ui.showLeaderboard();
  audio.play('click');
});
document.getElementById('btn-lb-back').addEventListener('click', () => game.exitToMenu());

game.exitToMenu();
game.start();

// Debug/testing handle (also used by the automated smoke test).
window.__memeMetro = { game, storage };
