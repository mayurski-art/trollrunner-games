/* ARCADE HUB — category filter + search for the game grid. Self-contained,
   no globals beyond binding to elements already in the DOM. */
(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const pills = document.querySelectorAll(".hub-pill");
    const cards = document.querySelectorAll(".hub-card");
    const searchInput = document.getElementById("hub-search-input");

    let activeCategory = "all";

    function applyFilters() {
      const query = (searchInput?.value || "").trim().toLowerCase();
      cards.forEach((card) => {
        const category = card.dataset.category || "";
        const title = card.dataset.title || "";
        const matchesCategory = activeCategory === "all" || category === activeCategory;
        const matchesQuery = !query || title.includes(query);
        card.classList.toggle("hub-card-hidden", !(matchesCategory && matchesQuery));
      });
    }

    pills.forEach((pill) => {
      pill.addEventListener("click", () => {
        pills.forEach((p) => p.classList.remove("is-active"));
        pill.classList.add("is-active");
        activeCategory = pill.dataset.category || "all";
        applyFilters();
      });
    });

    searchInput?.addEventListener("input", applyFilters);

    initAccountSync();
  });

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
          : "🧌";
        name.textContent = session.username;
        sub.textContent = `Level ${session.level}`;
        card.classList.add("is-logged-in");
        card.onclick = () => window.TrollrunnerAccounts.openProfile();
      } else {
        avatar.textContent = "🧌";
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
