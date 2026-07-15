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
  });
})();
