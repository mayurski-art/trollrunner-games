/* ============================================================================
   TROLL CASINO  —  scene engine  →  window.TrollCasinoScenes

   Owns the cinematic "walk into the casino" journey:

     scene 1  arrival        (lobby / neon entrance)
     scene 2  moving closer  (main table, all four characters)
     scene 3  circling       (side angle on the wheel table)
     scene 4  the host       (Trollface close-up, reaching out)
     scene 5  seated         (first-person view — becomes the gameplay backdrop)

   The engine only manipulates the stage DOM + emits events; it knows nothing
   about wagers or wallets. game.js listens for "gameplay" to show the table.

   SWAPPING IN REAL ART
   Drop PNGs into assets/games/troll-casino/scenes/ using the filenames in
   SCENES below (see scenes/README.md). Each image is preloaded; on success it
   replaces the CSS-gradient fallback for that scene. Missing images are fine —
   the gradients keep the page presentable.

   PUBLIC API
     init({ stage, viewport })         mount + preload; call once on page load
     fadeToScene(n) / zoomToScene(n) / slideToScene(n)   manual transitions
     focusCharacter()                  the scene-4 Trollface push-in
     enterGameplayMode()               scene 5 + "gameplay" event
     playWalkthrough()                 full 1→5 cinematic (skippable)
     replayIntro()                     leave gameplay, run the walkthrough again
     on(event, fn)                     "scene" | "gameplay" | "cinematic"
   ============================================================================ */
(() => {
  "use strict";
  if (window.TrollCasinoScenes) return;   // singleton

  const ART_DIR = "assets/games/troll-casino/scenes/";

  // Copy lives here (not in images) so it stays crisp, translatable, editable.
  const SCENES = [
    { n: 1, img: "scene-01-lobby.png",             kicker: "Trollrunner presents",
      title: "Troll Casino",     sub: "A neon money pit at the end of the metro line. The house always trolls." },
    { n: 2, img: "scene-02-approach-table.png",    kicker: "The floor",
      title: "The Main Table",   sub: "Trollface deals. Pepe schemes. Doge flexes. The whale just watches." },
    { n: 3, img: "scene-03-side-angle.png",        kicker: "Table view",
      title: "Circle the Wheel", sub: "Every seat is a bad decision. Pick yours anyway." },
    { n: 4, img: "scene-04-trollface-closeup.png", kicker: "Your host",
      title: "“Problem?”",       sub: "Trollface saved you a seat at the wheel." },
    { n: 5, img: "scene-05-first-person-wheel.png", kicker: "You're in",
      title: "Take Your Seat",   sub: "$TROLL on the felt, USDC in reserve. Spin it." },
  ];

  const CINEMATIC_HOLD_MS = 3000;         // per-scene hold during the walkthrough

  const state = {
    stage: null,          // .scene-stage
    viewport: null,       // .casino-viewport (carries is-cinematic / is-gameplay)
    caption: null,
    dots: [],
    current: 0,
    playing: false,
    timer: 0,
    reducedMotion: false,
  };
  const listeners = { scene: new Set(), gameplay: new Set(), cinematic: new Set() };
  function emit(ev, data) { listeners[ev]?.forEach(fn => { try { fn(data); } catch (_) {} }); }
  function on(ev, fn) { listeners[ev]?.add(fn); return () => listeners[ev]?.delete(fn); }

  /* --------------------------------------------------------------------------
     Mount + preload
     -------------------------------------------------------------------------- */
  function init(opts = {}) {
    state.stage = typeof opts.stage === "string" ? document.querySelector(opts.stage) : opts.stage;
    state.viewport = typeof opts.viewport === "string" ? document.querySelector(opts.viewport) : opts.viewport;
    if (!state.stage || !state.viewport) { console.warn("[casino-scenes] stage/viewport missing"); return; }

    state.caption = state.viewport.querySelector(".scene-caption");
    state.dots = [...state.viewport.querySelectorAll(".wt-dots span")];
    state.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    preloadArt();
    bindParallax();

    // Advance early on click/tap anywhere during the cinematic (feels snappy).
    state.viewport.addEventListener("click", (e) => {
      if (!state.playing) return;
      if (e.target.closest(".skip-btn")) return;   // skip has its own handler
      advance();
    });

    show(1, "fade");
  }

  function preloadArt() {
    SCENES.forEach(s => {
      const el = sceneEl(s.n);
      if (!el) return;
      const url = ART_DIR + s.img;
      const probe = new Image();
      probe.onload = () => {
        el.querySelector(".scene-bg").style.backgroundImage = `url("${url}")`;
        el.classList.add("has-art");
      };
      // onerror: keep the gradient fallback — intentional, not a bug.
      probe.src = url;
    });
  }

  function sceneEl(n) { return state.stage.querySelector(`.scene[data-scene="${n}"]`); }

  /* --------------------------------------------------------------------------
     Parallax — pointer drift moves every scene-bg via the --par-x/--par-y vars
     (CSS translates the layer). Cheap, and disabled for reduced motion.
     -------------------------------------------------------------------------- */
  function bindParallax() {
    if (state.reducedMotion) return;
    state.viewport.addEventListener("pointermove", (e) => {
      const r = state.viewport.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 18;   // ±9px
      const y = ((e.clientY - r.top) / r.height - 0.5) * 12;
      state.viewport.style.setProperty("--par-x", x.toFixed(1));
      state.viewport.style.setProperty("--par-y", y.toFixed(1));
    }, { passive: true });
  }

  /* --------------------------------------------------------------------------
     Core show() + the named transition helpers
     -------------------------------------------------------------------------- */
  function show(n, transition = "fade") {
    n = Math.min(Math.max(1, n), SCENES.length);
    const t = state.reducedMotion ? "fade" : transition;

    state.stage.classList.remove("is-t-fade", "is-t-zoom", "is-t-slide", "is-t-focus");
    state.stage.classList.add(`is-t-${t}`);

    SCENES.forEach(s => sceneEl(s.n)?.classList.toggle("is-active", s.n === n));
    state.current = n;

    renderCaption(SCENES[n - 1]);
    state.dots.forEach((d, i) => d.classList.toggle("is-on", i < n));
    emit("scene", { n, transition: t });
  }

  function renderCaption(s) {
    if (!state.caption) return;
    state.caption.innerHTML =
      `<span class="kicker">${s.kicker}</span>` +
      `<h2>${s.title}</h2>` +
      `<p>${s.sub}</p>`;
  }

  const fadeToScene  = n => show(n, "fade");
  const zoomToScene  = n => show(n, "zoom");
  const slideToScene = n => show(n, "slide");
  const focusCharacter = () => show(4, "focus");

  /* --------------------------------------------------------------------------
     Walkthrough — the arrival sequence. Each step names its camera move so the
     journey reads: arrive → walk up → circle → meet the host → sit down.
     -------------------------------------------------------------------------- */
  const WALKTHROUGH = [
    () => zoomToScene(2),      // push toward the table
    () => slideToScene(3),     // strafe around it
    () => focusCharacter(),    // Trollface leans in
    () => enterGameplayMode(), // take the seat
  ];

  function playWalkthrough() {
    if (state.playing) return;
    state.playing = true;
    state.walkStep = 0;
    state.viewport.classList.add("is-cinematic");
    state.viewport.classList.remove("is-gameplay");
    emit("cinematic", { playing: true });
    show(1, "fade");
    queueNext();
  }

  function queueNext() {
    clearTimeout(state.timer);
    if (!state.playing) return;
    const hold = state.reducedMotion ? 1200 : CINEMATIC_HOLD_MS;
    state.timer = setTimeout(advance, hold);
  }

  function advance() {
    if (!state.playing) return;
    const step = WALKTHROUGH[state.walkStep++];
    if (!step) return;
    step();
    if (state.walkStep < WALKTHROUGH.length) queueNext();
  }

  function skip() { enterGameplayMode(); }

  /* --------------------------------------------------------------------------
     Gameplay handoff — scene 5 stays mounted as the dimmed, blurred backdrop
     (CSS handles the treatment via .is-gameplay). game.js takes it from here.
     -------------------------------------------------------------------------- */
  function enterGameplayMode() {
    clearTimeout(state.timer);
    state.playing = false;
    show(5, "zoom");
    state.viewport.classList.remove("is-cinematic");
    state.viewport.classList.add("is-gameplay");
    emit("cinematic", { playing: false });
    emit("gameplay", {});
  }

  function replayIntro() {
    state.viewport.classList.remove("is-gameplay");
    playWalkthrough();
  }

  window.TrollCasinoScenes = {
    init, on, show,
    fadeToScene, zoomToScene, slideToScene, focusCharacter,
    playWalkthrough, skip, enterGameplayMode, replayIntro,
    current: () => state.current,
    scenes: () => SCENES.map(s => ({ ...s })),
  };
})();
