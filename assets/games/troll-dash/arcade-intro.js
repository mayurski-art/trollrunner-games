(() => {
  "use strict";

  const intro = document.getElementById("arcade-intro");
  if (!intro) return;

  const takeControllerButton = document.getElementById("take-controller-button");
  const chooseGamesButton = document.getElementById("choose-games-button");
  const backToTvMenuButton = document.getElementById("back-to-tv-menu");
  const bootTrollDashButton = document.getElementById("boot-troll-dash");
  const tvMainMenu = document.getElementById("tv-main-menu");
  const tvGameSelect = document.getElementById("tv-game-select");
  const tvLoading = document.getElementById("tv-loading");
  const loadingText = document.getElementById("loading-text");
  const startButton = document.getElementById("start-button");

  const loadingLines = [
    "Finding support...",
    "Checking candles...",
    "Dodging rugs...",
    "Summoning $TROLL...",
    "Entering the chart...",
  ];

  function showPanel(panel) {
    [tvMainMenu, tvGameSelect, tvLoading].forEach(node => {
      node?.classList.toggle("is-active", node === panel);
    });
  }

  function takeController() {
    intro.classList.add("is-handoff");
    takeControllerButton.disabled = true;
    window.setTimeout(() => {
      intro.classList.add("is-menu");
      showPanel(tvMainMenu);
      chooseGamesButton?.focus();
    }, 1380);
  }

  function chooseGames() {
    intro.classList.add("is-selecting");
    intro.classList.remove("is-loading");
    showPanel(tvGameSelect);
    bootTrollDashButton?.focus();
  }

  function backToMenu() {
    intro.classList.remove("is-selecting", "is-loading");
    intro.classList.add("is-menu");
    showPanel(tvMainMenu);
    chooseGamesButton?.focus();
  }

  function bootGame() {
    intro.classList.add("is-loading");
    showPanel(tvLoading);

    let lineIndex = 0;
    loadingText.textContent = loadingLines[lineIndex];
    const lineTimer = window.setInterval(() => {
      lineIndex = Math.min(lineIndex + 1, loadingLines.length - 1);
      loadingText.textContent = loadingLines[lineIndex];
    }, 360);

    window.setTimeout(() => {
      window.clearInterval(lineTimer);
      document.body.classList.add("intro-complete");
      window.setTimeout(() => {
        startButton?.click();
      }, 380);
    }, 2100);
  }

  takeControllerButton?.addEventListener("click", takeController);
  chooseGamesButton?.addEventListener("click", chooseGames);
  backToTvMenuButton?.addEventListener("click", backToMenu);
  bootTrollDashButton?.addEventListener("click", bootGame);

  intro.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
    event.preventDefault();
    if (!intro.classList.contains("is-menu")) takeController();
  });
})();
