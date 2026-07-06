/* Trollrreria — keyboard + mouse state. */

// `inert` (see site-lock.js) blocks pointer/focus targeting but NOT global
// window-level keydown listeners like the one below, so a site lock alone
// wouldn't stop an already-open game from still reading movement keys.
// Checked both on new keydowns and in down() so already-held keys stop
// registering the instant the site locks, not just new presses.
function isSiteLocked() {
  return window.TrollrunnerSiteLock?.getComputedRecord?.()?.mode === "locked";
}

export class Input {
  constructor(canvas) {
    this.keys = new Set();          // currently held (KeyboardEvent.code)
    this.pressed = new Set();       // pressed this frame
    this.mouse = { x: 0, y: 0, left: false, right: false };
    this.clicked = { left: false, right: false };
    this.wheel = 0;
    this.enabled = true;            // false while typing in DOM inputs
    this.lastActivity = performance.now(); // last real player input, for idle-autosave

    window.addEventListener("keydown", e => {
      if (!this.enabled || isSiteLocked()) return;
      /* don't steal keys from text fields (co-op room code, etc.) */
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.markActive();
      /* keep the page from scrolling / triggering browser shortcuts */
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "F1"].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", e => this.keys.delete(e.code));
    window.addEventListener("blur", () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });

    canvas.addEventListener("mousemove", e => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.coarseAim = false;    // a real mouse aims precisely — no tap snap
      this.markActive();
    });
    canvas.addEventListener("mousedown", e => {
      if (e.button === 0) { this.mouse.left = true; this.clicked.left = true; }
      if (e.button === 2) { this.mouse.right = true; this.clicked.right = true; }
      this.markActive();
    });
    window.addEventListener("mouseup", e => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    canvas.addEventListener("wheel", e => {
      this.wheel += Math.sign(e.deltaY);
      this.markActive();
      e.preventDefault();
    }, { passive: false });
  }

  markActive() { this.lastActivity = performance.now(); }
  idleMs() { return performance.now() - this.lastActivity; }

  down(code) { return !isSiteLocked() && this.keys.has(code); }
  hit(code) { return !isSiteLocked() && this.pressed.has(code); }

  /* call at end of each frame */
  flush() {
    this.pressed.clear();
    this.clicked.left = this.clicked.right = false;
    this.wheel = 0;
  }
}
