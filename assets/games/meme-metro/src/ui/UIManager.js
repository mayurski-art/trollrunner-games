// DOM screen manager: main menu, HUD, pause, game over. Screens live in
// meme-metro.html; this class only toggles them and fills in numbers.

const fmt = (n) => Math.floor(n).toLocaleString('en-US');

export class UIManager {
  constructor() {
    this.el = {};
    const ids = [
      'screen-menu', 'screen-pause', 'screen-gameover', 'screen-characters', 'hud',
      'menu-highscore', 'menu-coins',
      'hud-score', 'hud-best', 'hud-run-coins', 'hud-total-coins', 'hud-multiplier',
      'go-score', 'go-coins', 'go-distance', 'go-best', 'go-newbest', 'go-cause',
      'btn-start', 'btn-pause', 'btn-resume', 'btn-restart-pause', 'btn-exit-pause',
      'btn-restart', 'btn-exit',
      'fx-flash', 'countdown',
    ];
    for (const id of ids) this.el[id] = document.getElementById(id);
    this.flashTimeout = null;
    this.bumpTimeout = null;
    this.countdownShown = 0;
  }

  // Brief red vignette on hits; intensity 0..1.
  flash(intensity = 0.4) {
    const el = this.el['fx-flash'];
    clearTimeout(this.flashTimeout);
    el.style.opacity = String(intensity);
    el.classList.add('is-on');
    this.flashTimeout = setTimeout(() => {
      el.style.opacity = '0';
      el.classList.remove('is-on');
    }, 90);
  }

  showCountdown(n) {
    const el = this.el.countdown;
    el.hidden = false;
    if (n !== this.countdownShown) {
      this.countdownShown = n;
      el.textContent = n;
      // Retrigger the pop animation.
      el.classList.remove('is-pop');
      void el.offsetWidth;
      el.classList.add('is-pop');
    }
  }

  hideCountdown() {
    this.el.countdown.hidden = true;
    this.countdownShown = 0;
  }

  // Quick scale pulse on the run-coin chip when coins are grabbed.
  bumpCoins() {
    const chip = this.el['hud-run-coins'].parentElement;
    clearTimeout(this.bumpTimeout);
    chip.classList.add('is-bump');
    this.bumpTimeout = setTimeout(() => chip.classList.remove('is-bump'), 160);
  }

  bind(cb) {
    // Blur after click so Space/Enter gameplay keys can't re-trigger the
    // last-pressed button.
    const on = (id, fn) => this.el[id].addEventListener('click', (e) => {
      e.currentTarget.blur();
      fn();
    });
    on('btn-start', cb.onStart);
    on('btn-pause', cb.onPauseToggle);
    on('btn-resume', cb.onResume);
    on('btn-restart-pause', cb.onRestart);
    on('btn-exit-pause', cb.onExit);
    on('btn-restart', cb.onRestart);
    on('btn-exit', cb.onExit);
  }

  showOnly(name) {
    for (const s of ['screen-menu', 'screen-pause', 'screen-gameover', 'screen-characters']) {
      this.el[s].classList.toggle('is-visible', s === name);
    }
    this.el.hud.classList.toggle('is-visible', name === null || name === 'screen-pause');
  }

  showCharacters() {
    this.showOnly('screen-characters');
  }

  showMenu({ highScore, totalCoins }) {
    this.el['menu-highscore'].textContent = fmt(highScore);
    this.el['menu-coins'].textContent = fmt(totalCoins);
    this.showOnly('screen-menu');
  }

  showHUD() {
    this.showOnly(null);
  }

  showPause() {
    this.showOnly('screen-pause');
  }

  showGameOver({ score, coins, distance, best, newBest, cause }) {
    this.el['go-score'].textContent = fmt(score);
    this.el['go-coins'].textContent = fmt(coins);
    this.el['go-distance'].textContent = `${(distance / 1000).toFixed(2)} KM`;
    this.el['go-best'].textContent = fmt(best);
    this.el['go-newbest'].hidden = !newBest;
    this.el['go-cause'].textContent = `Rekt by: ${cause}`;
    this.showOnly('screen-gameover');
  }

  updateHUD({ score, best, runCoins, totalCoins, multiplier }) {
    this.el['hud-score'].textContent = fmt(score);
    this.el['hud-best'].textContent = fmt(best);
    this.el['hud-run-coins'].textContent = fmt(runCoins);
    this.el['hud-total-coins'].textContent = fmt(totalCoins);
    this.el['hud-multiplier'].textContent = `x${multiplier}`;
  }
}
