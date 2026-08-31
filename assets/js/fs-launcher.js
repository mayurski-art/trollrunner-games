/* ============================================================================
   FS-LAUNCHER  —  full-screen iframe launcher for the arcade hub
                   → window.TrollFSLauncher

   One click on a game card (or a subdomain button on the TV menu) opens the
   destination in an overlay that covers the ENTIRE viewport — no navigating
   away, no scrolling around a tiny TV screen.

   Navigating between the hub and a game is a real browser history entry
   (pushState/popstate), so:
     - Escape (desktop) or a real browser back exits the game.
     - When this whole hub is framed inside another page's own back/forward
       buttons (see mayurski-art.github.io's tw-nav buttons), that page can't
       reach into a cross-origin iframe's history directly, so it posts
       { type: "trollrunner:nav", action: "back" | "forward" } and we drive
       our own history from here.

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
    animation: fsl-in 260ms ease both;
  }
  @keyframes fsl-in { from { opacity: 0; transform: scale(1.02); } to { opacity: 1; transform: scale(1); } }
  .fsl-overlay iframe {
    width: 100%; height: 100%;
    border: 0; display: block; background: #050008;
  }
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

  function renderOverlay(url, title) {
    ensureStyles();
    overlay = document.createElement("div");
    overlay.className = "fsl-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", title || "Now playing");
    overlay.innerHTML = `<iframe src="${url}" title="${title || "Trollrunner"}"
              allow="fullscreen; autoplay; clipboard-write; gamepad"
              allowfullscreen></iframe>`;
    document.body.appendChild(overlay);
    document.body.classList.add("fsl-lock");
    // Without this, the browser keeps focus on the parent document after the
    // iframe mounts, so the very first tap/click inside the game just shifts
    // focus into the iframe instead of reaching the button underneath —
    // players had to tap Play twice. Focusing it here makes the first tap count.
    const iframe = overlay.querySelector("iframe");
    if (iframe) iframe.addEventListener("load", () => { try { iframe.focus(); } catch (_) {} }, { once: true });
  }

  function removeOverlay() {
    if (!overlay) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    overlay.remove();
    overlay = null;
    document.body.classList.remove("fsl-lock");
  }

  function open(url, title) {
    if (overlay) removeOverlay();   // one at a time
    if (!(history.state && history.state.fslUrl === url)) {
      history.pushState({ fslUrl: url, fslTitle: title }, "", "#play");
    }
    renderOverlay(url, title);
  }

  // Back exits the game (real history entry); if we're not tracking one
  // (e.g. called before any pushState happened) just tear down the overlay.
  function exitGame() {
    if (!overlay) return;
    if (history.state && history.state.fslUrl) history.back();
    else removeOverlay();
  }

  window.addEventListener("popstate", (e) => {
    if (e.state && e.state.fslUrl) {
      if (!overlay) renderOverlay(e.state.fslUrl, e.state.fslTitle);
    } else if (overlay) {
      removeOverlay();
    }
  });

  // Esc closes when the parent page has focus (inside the iframe the game
  // owns the keyboard).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") exitGame();
  });

  // Lets an embedding page's own back/forward controls drive our history --
  // see the comment above about why postMessage instead of direct access.
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent || e.data?.type !== "trollrunner:nav") return;
    if (e.data.action === "back") history.back();
    else if (e.data.action === "forward") history.forward();
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

  window.TrollFSLauncher = { open, close: exitGame };
})();
