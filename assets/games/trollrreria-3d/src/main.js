import { Game } from './core/Game.js';
import { hasSave } from './world/Save.js';

const canvas = document.getElementById('tr3-canvas');
const touchRoot = document.getElementById('tr3-touch');
const hudRoot = document.getElementById('tr3-hud');
const hpFill = document.getElementById('tr3-hp-fill');
const clock = document.getElementById('tr3-clock');
const hotbar = document.getElementById('tr3-hotbar');
const invGrid = document.getElementById('tr3-inv-grid');
const recipeList = document.getElementById('tr3-recipe-list');
const armorSlot = document.getElementById('tr3-armor-slot');
const chestGrid = document.getElementById('tr3-chest-grid');
const chestPlayerGrid = document.getElementById('tr3-chest-player-grid');

const screenMenu = document.getElementById('tr3-screen-menu');
const screenPause = document.getElementById('tr3-screen-pause');
const screenRespawn = document.getElementById('tr3-screen-respawn');
const screenInventory = document.getElementById('tr3-screen-inventory');
const screenChest = document.getElementById('tr3-screen-chest');
const allScreens = [screenMenu, screenPause, screenRespawn, screenInventory, screenChest];

const btnStart = document.getElementById('tr3-btn-start');
const btnContinue = document.getElementById('tr3-btn-continue');
const btnResume = document.getElementById('tr3-btn-resume');
const btnExit = document.getElementById('tr3-btn-exit');
const btnRespawn = document.getElementById('tr3-btn-respawn');
const btnPause = document.getElementById('tr3-btn-pause');
const btnInventory = document.getElementById('tr3-btn-inventory');
const btnInvClose = document.getElementById('tr3-btn-inv-close');
const btnChestClose = document.getElementById('tr3-btn-chest-close');

const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

function showScreen(el) {
  for (const s of allScreens) s.classList.toggle('is-visible', s === el);
}

function onStateChange(state) {
  if (state === 'paused') showScreen(screenPause);
  else if (state === 'respawn') showScreen(screenRespawn);
  else if (state === 'inventory') showScreen(screenInventory);
  else if (state === 'chest') showScreen(screenChest);
  else showScreen(null);
  if (touchRoot) touchRoot.hidden = !(isTouch && state === 'running');
}

const game = new Game(
  canvas,
  touchRoot,
  { hud: hudRoot, hpFill, clock, hotbar, invGrid, recipeList, armorSlot, chestGrid, chestPlayerGrid },
  { onStateChange },
);

if (hasSave()) {
  btnContinue.hidden = false;
  btnStart.textContent = '＋ New Island';
  btnStart.classList.remove('tr3-btn-primary');
  btnStart.classList.add('tr3-btn-ghost');
}

function dropIn(mode) {
  showScreen(null);
  hudRoot.hidden = false;
  if (touchRoot) touchRoot.hidden = !isTouch;
  game.start(mode);
}

btnStart.addEventListener('click', () => {
  if (hasSave() && !confirm('Start a new island? This deletes your saved island.')) return;
  dropIn('new');
});

btnContinue.addEventListener('click', () => dropIn('continue'));

btnResume.addEventListener('click', () => {
  game.resume();
  onStateChange('running');
});

btnPause.addEventListener('click', () => game.togglePause());

btnExit.addEventListener('click', () => {
  window.location.reload();
});

btnRespawn.addEventListener('click', () => {
  game.respawnPlayer();
});

btnInventory.addEventListener('click', () => game.toggleInventory());
btnInvClose.addEventListener('click', () => game.closeMenus());
btnChestClose.addEventListener('click', () => game.closeMenus());
