/* ARCADE HUB — infinite draggable game carousel + account sync. Self-contained,
   no globals beyond binding to elements already in the DOM. */
(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    initCarousel();
    initAccountSync();
  });

  /* Continuous horizontal loop: the card set is cloned once so the track can
     scroll past the end and land seamlessly back on an identical copy.
     Auto-scrolls via rAF, pauses on hover, and can be dragged (mouse/touch)
     to browse manually — dragging always keeps the loop position wrapped so
     it can be flicked in either direction forever. */
  function initCarousel() {
    const carousel = document.getElementById("hub-carousel");
    const track = document.getElementById("hub-carousel-track");
    if (!carousel || !track) return;

    const originals = Array.from(track.children);
    if (!originals.length) return;

    originals.forEach((card) => {
      const clone = card.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      clone.querySelectorAll("a, button").forEach((el) => el.setAttribute("tabindex", "-1"));
      track.appendChild(clone);
    });

    // Card art is otherwise natively draggable/selectable — starting a native
    // HTML5 image or link drag mid-gesture cancels our pointer-based drag (a
    // pointercancel fires) before the cursor ever reaches the edge, which is
    // why the edge auto-scroll below could silently stop working partway
    // through a drag. Lock the art down so only our own drag handling runs.
    track.querySelectorAll("img, a").forEach((el) => { el.draggable = false; });

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Touch/no-hover devices get manual swipe only, no auto-play — an
    // unattended strip that keeps drifting under a thumb is more annoying
    // than useful on mobile, where dragging is the primary interaction anyway.
    const isTouchDevice = window.matchMedia("(hover: none), (pointer: coarse)").matches;
    const SPEED = (reduceMotion || isTouchDevice) ? 0 : 0.55; // px/frame, ~33px/s at 60fps
    const EDGE_MAX_SPEED = reduceMotion ? 0 : 16; // px/frame right at the panel's edge

    let loopWidth = 0;
    let pos = 0;
    let paused = false;
    let dragging = false;
    let lastPointerX = 0;
    let dragStartX = 0;
    let dragMoved = 0;
    let suppressNextClick = false;

    function measure() {
      // Exact pixel distance from the start of the first set to the start of
      // its clone — accounts for card widths + gaps precisely, so the loop
      // seam never jumps.
      const firstClone = track.children[originals.length];
      if (firstClone) loopWidth = firstClone.offsetLeft - originals[0].offsetLeft;
    }
    measure();
    window.addEventListener("resize", measure);

    function wrap() {
      if (loopWidth <= 0) return;
      while (pos <= -loopWidth) pos += loopWidth;
      while (pos > 0) pos -= loopWidth;
    }

    // While dragging, parking the cursor near the panel's left/right edge
    // keeps scrolling further in that direction on its own — same idea as
    // edge auto-scroll in drag-and-drop lists — instead of requiring the
    // mouse to physically travel the whole strip.
    function edgeBoost() {
      if (!dragging || EDGE_MAX_SPEED <= 0) return 0;
      const rect = carousel.getBoundingClientRect();
      const zone = Math.min(140, Math.max(50, rect.width * 0.18));
      if (lastPointerX < rect.left + zone) {
        const depth = Math.min(1, (rect.left + zone - lastPointerX) / zone);
        return -EDGE_MAX_SPEED * depth;
      }
      if (lastPointerX > rect.right - zone) {
        const depth = Math.min(1, (lastPointerX - (rect.right - zone)) / zone);
        return EDGE_MAX_SPEED * depth;
      }
      return 0;
    }

    function frame() {
      if (dragging) {
        const boost = edgeBoost();
        if (boost) { pos += boost; wrap(); }
      } else if (!paused && loopWidth > 0) {
        pos -= SPEED;
        wrap();
      }
      track.style.transform = `translateX(${pos}px)`;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    carousel.addEventListener("mouseenter", () => { paused = true; });
    carousel.addEventListener("mouseleave", () => { paused = false; });

    // Deliberately NOT using setPointerCapture here: capturing the pointer
    // on the carousel retargets every subsequent event for it — including
    // the compat mouseup/click that follow pointerup — to the CAPTURING
    // element itself, no matter what's actually under the cursor. That
    // meant every click anywhere in the carousel arrived as
    // e.target === carousel, so a "Play Now" link's delegated click handler
    // (in fs-launcher.js) never matched and no game ever launched. Tracking
    // the drag with plain document-level listeners (active only while
    // dragging) gets the same "keep following the pointer past the
    // carousel's own edge" behavior without touching hit-testing for clicks.
    let activePointerId = null;

    function onPointerMove(e) {
      if (!dragging || e.pointerId !== activePointerId) return;
      const dx = e.clientX - lastPointerX;
      lastPointerX = e.clientX;
      // Net distance from where the gesture started, not the sum of every
      // per-frame delta — a plain mouse/trackpad click always wobbles a few
      // px between down and up, and summing those deltas blew past a small
      // fixed threshold on almost every click, silently eating "Play Now"
      // taps as if they'd been drags.
      dragMoved = Math.abs(e.clientX - dragStartX);
      pos += dx;
      wrap();
    }

    function endDrag(e) {
      if (!dragging || (e && e.pointerId !== activePointerId)) return;
      dragging = false;
      activePointerId = null;
      carousel.classList.remove("is-dragging");
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
      if (dragMoved > 10) suppressNextClick = true;
    }

    carousel.addEventListener("pointerdown", (e) => {
      dragging = true;
      activePointerId = e.pointerId;
      dragMoved = 0;
      dragStartX = e.clientX;
      lastPointerX = e.clientX;
      carousel.classList.add("is-dragging");
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", endDrag);
      document.addEventListener("pointercancel", endDrag);
    });

    // A drag that ends over a card's "Play Now" link would otherwise still
    // fire a click and launch the game — swallow just that one click.
    track.addEventListener("click", (e) => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  /* Profile card + footer stats — driven by window.TrollrunnerAccounts
     (assets/js/troll-accounts.js, loaded from trollrunner.net). Guests see
     placeholders; logged-in trolls get their real username/avatar/level and
     stats pulled from their account. */
  function initAccountSync() {
    const card = document.getElementById("hub-profile-card");
    const avatar = document.getElementById("hub-profile-avatar");
    const name = document.getElementById("hub-profile-name");
    const sub = document.getElementById("hub-profile-sub");
    const playedEl = document.getElementById("hub-stat-played");
    const highEl = document.getElementById("hub-stat-highscore");
    const rankEl = document.getElementById("hub-stat-rank");
    if (!card || !avatar || !name || !sub) return;

    function renderProfile(session) {
      if (session) {
        avatar.innerHTML = session.avatarUrl
          ? `<img src="${session.avatarUrl}" alt="">`
          : session.username.charAt(0).toUpperCase();
        name.textContent = session.username;
        sub.textContent = `Level ${session.level}`;
        card.classList.add("is-logged-in");
        card.onclick = () => window.TrollrunnerAccounts.openProfile();
      } else {
        avatar.textContent = "?";
        name.textContent = "Guest troll";
        sub.textContent = "Login to save your runs";
        card.classList.remove("is-logged-in");
        card.onclick = () => { window.location.href = "https://www.trollrunner.net/"; };
      }
    }

    async function syncStats(session) {
      if (!playedEl || !highEl || !rankEl) return;
      if (!session) {
        playedEl.textContent = "--";
        highEl.textContent = "--";
        rankEl.textContent = "--";
        return;
      }
      const data = await window.TrollrunnerAccounts.getProfileData().catch(() => null);
      if (!data) return;
      const stats = Array.isArray(data.stats) ? data.stats : [];
      const totalPlayed = stats.reduce((sum, s) => sum + (Number(s.games_played) || 0), 0);
      const bestScore = stats.reduce((max, s) => Math.max(max, Number(s.high_score) || 0), 0);
      playedEl.textContent = totalPlayed.toLocaleString();
      highEl.textContent = bestScore.toLocaleString();

      const sb = window.TrollrunnerAccounts.getClient();
      const myXp = Number(data.profile?.xp) || 0;
      const { count } = await sb
        .from("troll_profiles")
        .select("id", { count: "exact", head: true })
        .gt("xp", myXp);
      rankEl.textContent = `#${(count || 0) + 1}`;
    }

    if (!window.TrollrunnerAccounts) {
      renderProfile(null);
      syncStats(null);
      return;
    }

    window.addEventListener("trollrunner:auth-changed", (event) => {
      renderProfile(event.detail);
      void syncStats(event.detail);
    });

    const cached = window.TrollrunnerAccounts.getCachedProfile();
    renderProfile(cached);
    void syncStats(cached);
    void window.TrollrunnerAccounts.getSession().then((session) => {
      renderProfile(session);
      void syncStats(session);
    });
  }
})();
