(() => {
  "use strict";

  const intro = document.getElementById("arcade-intro");
  if (!intro) return;

  const takeControllerButton = document.getElementById("take-controller-button");
  const chooseGamesButton = document.getElementById("choose-games-button");
  const backToTvMenuButton = document.getElementById("back-to-tv-menu");
  const bootMemeMetroButton = document.getElementById("boot-meme-metro");
  const tvMainMenu = document.getElementById("tv-main-menu");
  const tvGameSelect = document.getElementById("tv-game-select");

  function showPanel(panel) {
    [tvMainMenu, tvGameSelect].forEach(node => {
      node?.classList.toggle("is-active", node === panel);
    });
  }

  function takeController() {
    intro.classList.add("is-menu");
    takeControllerButton.disabled = true;
    showPanel(tvMainMenu);
    chooseGamesButton?.focus();
  }

  function chooseGames() {
    intro.classList.add("is-selecting");
    showPanel(tvGameSelect);
    bootMemeMetroButton?.focus();
  }

  function backToMenu() {
    intro.classList.remove("is-selecting");
    intro.classList.add("is-menu");
    showPanel(tvMainMenu);
    chooseGamesButton?.focus();
  }

  takeControllerButton?.addEventListener("click", takeController);
  chooseGamesButton?.addEventListener("click", chooseGames);
  backToTvMenuButton?.addEventListener("click", backToMenu);

  intro.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
    event.preventDefault();
    if (!intro.classList.contains("is-menu")) takeController();
  });
})();
