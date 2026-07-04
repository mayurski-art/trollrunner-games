/* TrollTerra — keyboard + mouse state. */

export class Input {
  constructor(canvas) {
    this.keys = new Set();          // currently held (KeyboardEvent.code)
    this.pressed = new Set();       // pressed this frame
    this.mouse = { x: 0, y: 0, left: false, right: false };
    this.clicked = { left: false, right: false };
    this.wheel = 0;
    this.enabled = true;            // false while typing in DOM inputs

    window.addEventListener("keydown", e => {
      if (!this.enabled) return;
      /* don't steal keys from text fields (co-op room code, etc.) */
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      /* keep the page from scrolling / triggering browser shortcuts */
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", e => this.keys.delete(e.code));
    window.addEventListener("blur", () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });

    canvas.addEventListener("mousemove", e => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    });
    canvas.addEventListener("mousedown", e => {
      if (e.button === 0) { this.mouse.left = true; this.clicked.left = true; }
      if (e.button === 2) { this.mouse.right = true; this.clicked.right = true; }
    });
    window.addEventListener("mouseup", e => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    canvas.addEventListener("wheel", e => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  /* call at end of each frame */
  flush() {
    this.pressed.clear();
    this.clicked.left = this.clicked.right = false;
    this.wheel = 0;
  }
}
