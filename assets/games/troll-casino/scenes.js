/* ============================================================================
   TROLL CASINO  —  scene engine  →  window.TrollCasinoScenes

   Owns the cinematic "walk into the casino" journey:

     scene 1  arrival        (lobby / neon entrance)
     scene 2  moving closer  (main table, all four characters)
     scene 3  circling       (side angle on the wheel table)
     scene 4  the host       (Trollface close-up, reaching out)
     scene 5  seated         (first-person view — last beat before the floor)

   The engine only manipulates the stage DOM + emits events; it knows nothing
   about wagers or wallets. game.js listens for "gameplay" to show the table.

   SWAPPING IN REAL ART
   Drop PNGs into assets/games/troll-casino/scenes/ using the filenames in
   SCENES below (see scenes/README.md). Each image is preloaded; on success it
   replaces the CSS-gradient fallback for that scene. Missing images are fine —
   the gradients keep the page presentable.

   VIDEO LOOPS
   A same-named .mp4 next to each PNG (scene-01-lobby.mp4, …) upgrades that
   scene to a looping video layer on top of the still (which stays as the
   poster / instant paint). Only the ACTIVE scene's video plays; the rest stay
   paused. Videos start muted (autoplay policy); game.js routes its one sound
   toggle here via setAudio(on) so the active cinematic scene carries the
   clip's ambience when sound is on. Reduced-motion users get stills only.

   PUBLIC API
     init({ stage, viewport })         mount + preload; call once on page load
     fadeToScene(n) / zoomToScene(n) / slideToScene(n)   manual transitions
     focusCharacter()                  the scene-4 Trollface push-in
     enterGameplayMode()               scene 5 + "gameplay" event
     playWalkthrough()                 full 1→5 cinematic (skippable)
     replayIntro()                     leave gameplay, run the walkthrough again
     setAudio(on)                      unmute/mute the active scene's video loop
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
    videos: new Map(),    // scene n -> <video> (only scenes whose .mp4 loaded)
    audioOn: false,       // user intent from the shared sound toggle
    gameplay: false,      // gameplay backdrop stays muted regardless
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

    // Don't burn decode/battery in a background tab; resume where we were.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) state.videos.forEach(v => { if (!v.paused) v.pause(); });
      else if (!state.gameplay) playActiveVideo();
    });

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

      mountVideo(s, el);
    });
  }

  /* --------------------------------------------------------------------------
     Video loops — a same-named .mp4 upgrades a scene to living footage. The
     still underneath doubles as the poster, so nothing flashes while the
     video buffers. Missing .mp4s are fine (the <video> errors out silently).
     -------------------------------------------------------------------------- */
  function mountVideo(s, el) {
    if (state.reducedMotion) return;                 // stills only, by request
    const v = document.createElement("video");
    v.className = "scene-video";
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");               // older iOS
    v.preload = "auto";
    v.src = ART_DIR + s.img.replace(/\.png$/i, ".mp4");
    v.addEventListener("loadeddata", () => {
      el.classList.add("has-video");
      if (state.current === s.n) playActiveVideo();
    }, { once: true });
    v.addEventListener("error", () => { v.remove(); state.videos.delete(s.n); }, { once: true });
    // Sits above .scene-bg, below haze/vignette so the grade still applies.
    const haze = el.querySelector(".scene-haze");
    haze.parentNode.insertBefore(v, haze);
    state.videos.set(s.n, v);
  }

  // Play only the active scene's loop; everything else pauses (battery, decode).
  // During gameplay the whole framed stage is hidden, so nothing plays at
  // all — an async play() must never outrace the gameplay pause.
  function playActiveVideo() {
    state.videos.forEach((v, n) => {
      if (n === state.current && !state.gameplay) {
        applyAudioTo(v);
        if (v.paused) { try { v.currentTime = 0; } catch (_) {} }
        v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
      } else if (!v.paused) {
        v.pause();
      }
    });
  }

  function applyAudioTo(v) {
    v.muted = !(state.audioOn && !state.gameplay);
  }

  // game.js routes its one sound toggle here; gameplay always stays muted so
  // scene ambience never fights the table SFX.
  function setAudio(on) {
    state.audioOn = !!on;
    const v = state.videos.get(state.current);
    if (!v) return;
    applyAudioTo(v);
    if (!v.muted && v.paused) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
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
    playActiveVideo();
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
    // Let a longer scene video finish at least one full loop before cutting
    // away — a 3s hold was chopping clips that run longer than that.
    const v = state.videos.get(state.current);
    const videoMs = v && v.duration && isFinite(v.duration) ? v.duration * 1000 : 0;
    const hold = state.reducedMotion ? 1200 : Math.max(CINEMATIC_HOLD_MS, videoMs);
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
     Gameplay handoff — the framed cinematic (scene-frame) is hidden outright
     by CSS (.is-gameplay); the floor/game view carries no video backdrop.
     game.js takes it from here.
     -------------------------------------------------------------------------- */
  function enterGameplayMode() {
    clearTimeout(state.timer);
    state.playing = false;
    state.gameplay = true;
    show(5, "zoom");
    state.viewport.classList.remove("is-cinematic");
    state.viewport.classList.add("is-gameplay");
    // The whole framed stage is hidden during gameplay, so stop every loop
    // instead of decoding video nobody can see.
    state.videos.forEach(v => { if (!v.paused) v.pause(); });
    emit("cinematic", { playing: false });
    emit("gameplay", {});
  }

  function replayIntro() {
    state.gameplay = false;
    state.viewport.classList.remove("is-gameplay");
    playWalkthrough();
  }

  window.TrollCasinoScenes = {
    init, on, show, setAudio,
    fadeToScene, zoomToScene, slideToScene, focusCharacter,
    playWalkthrough, skip, enterGameplayMode, replayIntro,
    current: () => state.current,
    scenes: () => SCENES.map(s => ({ ...s })),
  };
})();
