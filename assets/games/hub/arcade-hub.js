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

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const SPEED = reduceMotion ? 0 : 0.55; // px/frame, ~33px/s at 60fps

    let loopWidth = 0;
    let pos = 0;
    let paused = false;
    let dragging = false;
    let dragStartX = 0;
    let dragStartPos = 0;
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

    function frame() {
      if (!dragging && !paused && loopWidth > 0) {
        pos -= SPEED;
        wrap();
      }
      track.style.transform = `translateX(${pos}px)`;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    carousel.addEventListener("mouseenter", () => { paused = true; });
    carousel.addEventListener("mouseleave", () => { paused = false; });

    carousel.addEventListener("pointerdown", (e) => {
      dragging = true;
      dragMoved = 0;
      dragStartX = e.clientX;
      dragStartPos = pos;
      carousel.classList.add("is-dragging");
      carousel.setPointerCapture(e.pointerId);
    });

    carousel.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - dragStartX;
      dragMoved = Math.max(dragMoved, Math.abs(dx));
      pos = dragStartPos + dx;
      wrap();
    });

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      carousel.classList.remove("is-dragging");
      if (dragMoved > 6) suppressNextClick = true;
    }
    carousel.addEventListener("pointerup", endDrag);
    carousel.addEventListener("pointercancel", endDrag);

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
