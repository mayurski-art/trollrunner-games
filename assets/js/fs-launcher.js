/* ============================================================================
   FS-LAUNCHER  —  full-screen iframe launcher for the arcade hub
                   → window.TrollFSLauncher

   One click on a game card (or a subdomain button on the TV menu) opens the
   destination in an overlay that covers the ENTIRE viewport — no navigating
   away, no scrolling around a tiny TV screen. The overlay carries a floating
   control pill:

     ↗  open in a new tab (escape hatch if a site refuses to be framed)
     ⛶  toggle true browser fullscreen
     —  minimize: shrink to a live picture-in-picture card (game keeps
        running); click the card to restore
     ✕  close

   Self-contained like troll-notis: injects its own CSS, binds by delegation.
   Anything that should launch this way just needs data-fs on its <a> (the
   href is the iframe src). If JS is off, the links still navigate normally.
   ============================================================================ */
(() => {
  "use strict";
  if (window.TrollFSLauncher) return;   // singleton

  const CSS = `
  .fsl-overlay {
    position: fixed; inset: 0; z-index: 2147483000;
    background: #050008;
    display: flex; flex-direction: column;
    animation: fsl-in 260ms ease both;
  }
  @keyframes fsl-in { from { opacity: 0; transform: scale(1.02); } to { opacity: 1; transform: scale(1); } }
  .fsl-overlay iframe {
    flex: 1; width: 100%; height: 100%;
    border: 0; display: block; background: #050008;
  }
  .fsl-bar {
    position: absolute; top: 10px; right: 10px; z-index: 2;
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px;
    background: rgba(8, 4, 16, 0.72);
    border: 1px solid rgba(160, 255, 200, 0.18);
    border-radius: 999px;
    backdrop-filter: blur(8px);
    opacity: 0.45;
    transition: opacity 200ms ease;
  }
  .fsl-bar:hover, .fsl-bar:focus-within { opacity: 1; }
  .fsl-title {
    color: #9aa3c0;
    font: 700 12px/1 "DM Mono", monospace;
    letter-spacing: 0.08em;
    padding: 0 6px 0 8px;
    max-width: 40vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fsl-btn {
    width: 34px; height: 34px;
    display: grid; place-items: center;
    font-size: 15px; line-height: 1;
    color: #eef2ff;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid transparent;
    border-radius: 999px;
    cursor: pointer;
  }
  .fsl-btn:hover { border-color: #3dff8a; }
  .fsl-btn:focus-visible { outline: 2px solid #3dff8a; outline-offset: 2px; }

  /* Minimized: a live PiP card pinned bottom-right. The iframe keeps running. */
  .fsl-overlay.is-min {
    inset: auto 14px 14px auto;
    width: min(340px, 44vw);
    aspect-ratio: 16 / 10;
    border: 1px solid rgba(160, 255, 200, 0.3);
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.65);
    animation: none;
  }
  .fsl-overlay.is-min .fsl-bar { top: 6px; right: 6px; padding: 4px 6px; }
  .fsl-overlay.is-min .fsl-title, .fsl-overlay.is-min .fsl-newtab, .fsl-overlay.is-min .fsl-fs { display: none; }
  .fsl-overlay.is-min iframe { pointer-events: none; }
  .fsl-restore {
    position: absolute; inset: 0; z-index: 1;
    background: transparent; border: 0; cursor: pointer;
    display: none;
  }
  .fsl-overlay.is-min .fsl-restore { display: block; }
  .fsl-restore:focus-visible { outline: 3px solid #3dff8a; outline-offset: -3px; }
  body.fsl-lock { overflow: hidden; }
  @media (prefers-reduced-motion: reduce) { .fsl-overlay { animation: none; } }
  `;

  let overlay = null;

  function ensureStyles() {
    if (document.getElementById("fsl-styles")) return;
    const s = document.createElement("style");
    s.id = "fsl-styles";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function open(url, title) {
    close();                       // one at a time
    ensureStyles();

    overlay = document.createElement("div");
    overlay.className = "fsl-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", title || "Now playing");
    overlay.innerHTML = `
      <iframe src="${url}" title="${title || "Trollrunner"}"
              allow="fullscreen; autoplay; clipboard-write; gamepad"
              allowfullscreen></iframe>
      <button type="button" class="fsl-restore" aria-label="Restore ${title || "window"}"></button>
      <div class="fsl-bar">
        <span class="fsl-title">${title || ""}</span>
        <button type="button" class="fsl-btn fsl-newtab" title="Open in new tab" aria-label="Open in new tab">↗</button>
        <button type="button" class="fsl-btn fsl-fs" title="Fullscreen" aria-label="Toggle fullscreen">⛶</button>
        <button type="button" class="fsl-btn fsl-min" title="Minimize" aria-label="Minimize">—</button>
        <button type="button" class="fsl-btn fsl-close" title="Exit" aria-label="Exit">✕</button>
      </div>`;

    overlay.querySelector(".fsl-newtab").addEventListener("click", () => window.open(url, "_blank", "noopener"));
    overlay.querySelector(".fsl-fs").addEventListener("click", toggleFullscreen);
    overlay.querySelector(".fsl-min").addEventListener("click", minimize);
    overlay.querySelector(".fsl-close").addEventListener("click", close);
    overlay.querySelector(".fsl-restore").addEventListener("click", restore);

    document.body.appendChild(overlay);
    document.body.classList.add("fsl-lock");
    overlay.querySelector(".fsl-close").focus({ preventScroll: true });
  }

  function toggleFullscreen() {
    if (!overlay) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else overlay.requestFullscreen?.().catch(() => {});
  }

  function minimize() {
    if (!overlay) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    overlay.classList.add("is-min");
    document.body.classList.remove("fsl-lock");
  }

  function restore() {
    if (!overlay) return;
    overlay.classList.remove("is-min");
    document.body.classList.add("fsl-lock");
  }

  function close() {
    if (!overlay) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    overlay.remove();
    overlay = null;
    document.body.classList.remove("fsl-lock");
  }

  // Esc closes when the parent page has focus (inside the iframe the game
  // owns the keyboard — use the ✕ there).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay && !overlay.classList.contains("is-min")) close();
  });

  // Delegation: any <a data-fs> launches in the overlay. Plain middle/ctrl
  // clicks still open a real tab like any link.
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest("a[data-fs]");
    if (!link) return;
    e.preventDefault();
    open(link.href, link.dataset.fs || link.getAttribute("aria-label") || link.textContent.trim());
  });

  window.TrollFSLauncher = { open, close, minimize, restore };
})();
