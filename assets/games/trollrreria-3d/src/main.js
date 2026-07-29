import { Game } from './core/Game.js';

const canvas = document.getElementById('tr3-canvas');
const touchRoot = document.getElementById('tr3-touch');
const hudRoot = document.getElementById('tr3-hud');
const hpFill = document.getElementById('tr3-hp-fill');
const hotbar = document.getElementById('tr3-hotbar');

const screenMenu = document.getElementById('tr3-screen-menu');
const screenPause = document.getElementById('tr3-screen-pause');
const screenRespawn = document.getElementById('tr3-screen-respawn');

const btnStart = document.getElementById('tr3-btn-start');
const btnResume = document.getElementById('tr3-btn-resume');
const btnExit = document.getElementById('tr3-btn-exit');
const btnRespawn = document.getElementById('tr3-btn-respawn');
const btnPause = document.getElementById('tr3-btn-pause');

const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

function showScreen(el) {
  for (const s of [screenMenu, screenPause, screenRespawn]) s.classList.toggle('is-visible', s === el);
}

function onStateChange(state) {
  if (state === 'paused') showScreen(screenPause);
  else if (state === 'respawn') showScreen(screenRespawn);
  else showScreen(null);
  if (touchRoot) touchRoot.hidden = !(isTouch && state === 'running');
}

const game = new Game(canvas, touchRoot, { hud: hudRoot, hpFill, hotbar }, { onStateChange });

btnStart.addEventListener('click', () => {
  showScreen(null);
  hudRoot.hidden = false;
  if (touchRoot) touchRoot.hidden = !isTouch;
  game.start();
});

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
