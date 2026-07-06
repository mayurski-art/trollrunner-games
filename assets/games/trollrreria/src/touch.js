/* Trollrreria — touch controls. Appears on coarse-pointer devices (or the
   first touch). Buttons write straight into the shared Input state so the
   player/game code needs zero changes:
     ◀ ▶  -> KeyA / KeyD        ⬆ -> Space        ⬇ -> KeyS
     canvas touch = aim + use (hold to mine, tap to place/swing)
     ✋ -> interact at the aim point (doors, chests, the Guide)          */

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this.root = null;

    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (coarse) this.show(true);
    window.addEventListener("touchstart", () => this.show(true), { once: true, passive: true });

    this.bindCanvas(game.canvas);
  }

  show(on) {
    this.enabled = on;
    if (on && !this.root) this.build();
    if (this.root) this.root.hidden = !on;
  }

  /* ------------------------------------------------------------- layout */
  build() {
    const root = document.createElement("div");
    root.id = "touch-ui";
    root.innerHTML = `
      <div class="tc-cluster tc-left">
        <button class="tc-btn" data-code="KeyA" aria-label="Move left">◀</button>
        <button class="tc-btn" data-code="KeyD" aria-label="Move right">▶</button>
        <button class="tc-btn tc-down" data-code="KeyS" aria-label="Drop through">⬇</button>
      </div>
      <div class="tc-cluster tc-right">
        <button class="tc-btn tc-jump" data-code="Space" aria-label="Jump">⬆</button>
        <button class="tc-btn tc-hand" data-act="interact" aria-label="Interact">✋</button>
        <button class="tc-btn tc-small" data-act="inv" aria-label="Inventory">🎒</button>
        <button class="tc-btn tc-small" data-act="map" aria-label="Map">🗺</button>
      </div>`;
    document.getElementById("tt-root").appendChild(root);
    this.root = root;

    const input = this.game.input;
    for (const btn of root.querySelectorAll(".tc-btn")) {
      const code = btn.dataset.code;
      const act = btn.dataset.act;
      const press = e => {
        e.preventDefault();
        btn.classList.add("on");
        input.markActive();
        if (code) {
          if (!input.keys.has(code)) input.pressed.add(code);
          input.keys.add(code);
        } else if (act === "interact") {
          this.game.interact();
        } else if (act === "inv") {
          this.game.ui && this.game.ui.toggleInventory();
        } else if (act === "map") {
          this.game.ui && this.game.ui.toggleBigMap();
        }
      };
      const release = e => {
        e.preventDefault();
        btn.classList.remove("on");
        if (code) input.keys.delete(code);
      };
      btn.addEventListener("touchstart", press, { passive: false });
      btn.addEventListener("touchend", release, { passive: false });
      btn.addEventListener("touchcancel", release, { passive: false });
      /* mouse fallback so the overlay is testable on desktop */
      btn.addEventListener("mousedown", press);
      btn.addEventListener("mouseup", release);
      btn.addEventListener("mouseleave", release);
      btn.addEventListener("contextmenu", e => e.preventDefault());
    }
  }

  /* Canvas touches: first finger aims and uses (hold-to-mine). */
  bindCanvas(canvas) {
    const input = this.game.input;
    const setAim = t => {
      const r = canvas.getBoundingClientRect();
      input.mouse.x = t.clientX - r.left;
      input.mouse.y = t.clientY - r.top;
      /* thumbs cover 3-4 tiles — let mining snap to the nearest breakable
         tile around the tap instead of demanding pixel precision */
      input.coarseAim = true;
    };
    canvas.addEventListener("touchstart", e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      input.markActive();
      if (this._aimId === undefined) {
        this._aimId = t.identifier;
        setAim(t);
        input.mouse.left = true;
        input.clicked.left = true;
      }
    }, { passive: false });
    canvas.addEventListener("touchmove", e => {
      e.preventDefault();
      input.markActive();
      for (const t of e.changedTouches) {
        if (t.identifier === this._aimId) setAim(t);
      }
    }, { passive: false });
    const end = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._aimId) {
          this._aimId = undefined;
          input.mouse.left = false;
        }
      }
    };
    canvas.addEventListener("touchend", end);
    canvas.addEventListener("touchcancel", end);
  }
}
