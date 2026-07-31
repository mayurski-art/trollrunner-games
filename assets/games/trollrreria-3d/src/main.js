import { Game } from './core/Game.js';
import { hasSave } from './world/Save.js';
import { Net } from './net/Net.js';

const canvas = document.getElementById('tr3-canvas');
const touchRoot = document.getElementById('tr3-touch');
const hudRoot = document.getElementById('tr3-hud');
const hpFill = document.getElementById('tr3-hp-fill');
const hungerFill = document.getElementById('tr3-hunger-fill');
const clock = document.getElementById('tr3-clock');
const hardmodeBadge = document.getElementById('tr3-hardmode-badge');
const safestartBadge = document.getElementById('tr3-safestart-badge');
const safestartTimer = document.getElementById('tr3-safestart-timer');
const hotbar = document.getElementById('tr3-hotbar');
const invGrid = document.getElementById('tr3-inv-grid');
const recipeList = document.getElementById('tr3-recipe-list');
const armorSlot = document.getElementById('tr3-armor-slot');
const chestGrid = document.getElementById('tr3-chest-grid');
const chestPlayerGrid = document.getElementById('tr3-chest-player-grid');
const tradeList = document.getElementById('tr3-trade-list');
const questPanel = document.getElementById('tr3-quest-panel');
const peerCount = document.getElementById('tr3-peer-count');
const cursorHint = document.getElementById('tr3-cursor-hint');
const minimapCanvas = document.getElementById('tr3-minimap');
const mineProgress = document.getElementById('tr3-mine-progress');
const dialogue = document.getElementById('tr3-dialogue');
const waypointList = document.getElementById('tr3-waypoint-list');
const rainOverlay = document.getElementById('tr3-rain');
const bossBar = document.getElementById('tr3-boss-bar');
const bossName = document.getElementById('tr3-boss-name');
const bossFill = document.getElementById('tr3-boss-fill');

const screenMenu = document.getElementById('tr3-screen-menu');
const screenPause = document.getElementById('tr3-screen-pause');
const screenRespawn = document.getElementById('tr3-screen-respawn');
const screenInventory = document.getElementById('tr3-screen-inventory');
const screenChest = document.getElementById('tr3-screen-chest');
const screenMerchant = document.getElementById('tr3-screen-merchant');
const screenCoop = document.getElementById('tr3-screen-coop');
const screenWaypoints = document.getElementById('tr3-screen-waypoints');
const screenLeaderboard = document.getElementById('tr3-screen-leaderboard');
const allScreens = [screenMenu, screenPause, screenRespawn, screenInventory, screenChest, screenMerchant, screenCoop, screenWaypoints, screenLeaderboard];

const btnStart = document.getElementById('tr3-btn-start');
const btnContinue = document.getElementById('tr3-btn-continue');
const btnResume = document.getElementById('tr3-btn-resume');
const btnExit = document.getElementById('tr3-btn-exit');
const btnRespawn = document.getElementById('tr3-btn-respawn');
const btnPause = document.getElementById('tr3-btn-pause');
const btnInventory = document.getElementById('tr3-btn-inventory');
const btnMusic = document.getElementById('tr3-btn-music');
const btnInvClose = document.getElementById('tr3-btn-inv-close');
const btnChestClose = document.getElementById('tr3-btn-chest-close');
const btnMerchantClose = document.getElementById('tr3-btn-merchant-close');
const btnCoop = document.getElementById('tr3-btn-coop');
const btnCoopClose = document.getElementById('tr3-btn-coop-close');
const btnCoopHost = document.getElementById('tr3-btn-coop-host');
const btnCoopJoin = document.getElementById('tr3-btn-coop-join');
const btnCoopLeave = document.getElementById('tr3-btn-coop-leave');
const coopCode = document.getElementById('tr3-coop-code');
const coopStatus = document.getElementById('tr3-coop-status');
const btnWaypoints = document.getElementById('tr3-btn-waypoints');
const btnWaypointsClose = document.getElementById('tr3-btn-waypoints-close');
const btnLeaderboardMenu = document.getElementById('tr3-btn-leaderboard-menu');
const btnLeaderboard = document.getElementById('tr3-btn-leaderboard');
const btnLeaderboardClose = document.getElementById('tr3-btn-leaderboard-close');

const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

function showScreen(el) {
  for (const s of allScreens) s.classList.toggle('is-visible', s === el);
}

function onStateChange(state) {
  if (state === 'paused') showScreen(screenPause);
  else if (state === 'respawn') showScreen(screenRespawn);
  else if (state === 'inventory') showScreen(screenInventory);
  else if (state === 'chest') showScreen(screenChest);
  else if (state === 'merchant') showScreen(screenMerchant);
  else if (state === 'coop') showScreen(screenCoop);
  else if (state === 'waypoints') showScreen(screenWaypoints);
  else if (state === 'leaderboard') showScreen(screenLeaderboard);
  else if (state === 'menu') showScreen(screenMenu);
  else showScreen(null);
  if (touchRoot) touchRoot.hidden = !(isTouch && state === 'running');
}

const game = new Game(
  canvas,
  touchRoot,
  { hud: hudRoot, hpFill, hungerFill, clock, hardmodeBadge, safestartBadge, safestartTimer, peerCount, cursorHint, minimapCanvas, mineProgress, dialogue, waypointList, bossBar, bossName, bossFill, hotbar, invGrid, recipeList, armorSlot, chestGrid, chestPlayerGrid, tradeList, questPanel, rainOverlay },
  { onStateChange },
);

if (game.prestigeLevel > 0) {
  document.querySelector('.tr3-menu-tag').textContent = `New Game+ ${game.prestigeLevel} — enemies are permanently tougher.`;
}

if (hasSave()) {
  btnContinue.hidden = false;
  btnStart.textContent = '＋ New Island';
  btnStart.classList.remove('tr3-btn-primary');
  btnStart.classList.add('tr3-btn-ghost');
}

let selectedDifficulty = 'normal';
const diffButtons = [...document.querySelectorAll('.tr3-diff-btn')];
diffButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedDifficulty = btn.dataset.diff;
    diffButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
  });
});

function dropIn(mode) {
  showScreen(null);
  hudRoot.hidden = false;
  if (touchRoot) touchRoot.hidden = !isTouch;
  game.start(mode, selectedDifficulty);
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
  game.recordProgress('quit');
  window.location.reload();
});

btnRespawn.addEventListener('click', () => {
  game.respawnPlayer();
});

btnInventory.addEventListener('click', () => game.toggleInventory());
btnMusic.addEventListener('click', () => {
  const on = game.toggleMusic();
  btnMusic.textContent = on ? '🔊' : '🔇';
  btnMusic.setAttribute('aria-label', on ? 'Mute music' : 'Unmute music');
});
btnInvClose.addEventListener('click', () => game.closeMenus());
btnChestClose.addEventListener('click', () => game.closeMenus());
btnMerchantClose.addEventListener('click', () => game.closeMenus());

function setCoopStatus() {
  if (!game.net.active) { coopStatus.textContent = 'Playing solo.'; btnCoopLeave.hidden = true; return; }
  const role = game.net.isHost ? 'Hosting' : 'Joined';
  coopStatus.textContent = `${role} room ${game.net.room} — ${game.net.peerCount} other troll${game.net.peerCount === 1 ? '' : 's'} here.`;
  btnCoopLeave.hidden = false;
}

btnCoop.addEventListener('click', () => { game.toggleCoop(); setCoopStatus(); });
btnCoopClose.addEventListener('click', () => game.closeMenus());

btnCoopHost.addEventListener('click', async () => {
  const code = Net.makeCode();
  coopStatus.textContent = 'Connecting…';
  const result = await game.startCoop(code, true);
  coopStatus.textContent = result ? `Hosting room ${code} (${result.kind === 'online' ? 'online' : 'same-browser'}).` : 'Could not start a room — try again.';
  if (result) btnCoopLeave.hidden = false;
});

btnCoopJoin.addEventListener('click', async () => {
  const code = coopCode.value.trim();
  if (code.length !== 5) { coopStatus.textContent = 'Enter the 5-letter room code first.'; return; }
  coopStatus.textContent = 'Connecting…';
  const result = await game.startCoop(code, false);
  coopStatus.textContent = result ? `Joined room ${code.toUpperCase()} (${result.kind === 'online' ? 'online' : 'same-browser'}) — syncing…` : 'Could not join that room.';
  if (result) btnCoopLeave.hidden = false;
});

btnCoopLeave.addEventListener('click', () => {
  game.stopCoop();
  setCoopStatus();
});

btnWaypoints.addEventListener('click', () => game.toggleWaypoints());
btnWaypointsClose.addEventListener('click', () => game.closeMenus());

btnLeaderboardMenu.addEventListener('click', () => game.toggleLeaderboard());
btnLeaderboard.addEventListener('click', () => game.toggleLeaderboard());
btnLeaderboardClose.addEventListener('click', () => game.toggleLeaderboard());
