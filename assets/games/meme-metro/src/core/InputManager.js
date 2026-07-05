// Keyboard + touch-swipe input. Emits semantic actions via handler callbacks:
// left / right / jump / slide / pause.

const SWIPE_MIN_PX = 26;

export class InputManager {
  constructor(touchTarget, handlers) {
    this.handlers = handlers;
    this.touchStart = null;

    this.onKeyDown = (e) => {
      if (e.repeat) return;
      // `inert` (see site-lock.js) blocks pointer/focus targeting but not
      // this global window-level keydown listener, so an already-open run
      // could otherwise keep steering through a site lock.
      if (window.TrollrunnerSiteLock?.getComputedRecord?.()?.mode === 'locked') return;
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': e.preventDefault(); handlers.left(); break;
        case 'ArrowRight': case 'KeyD': e.preventDefault(); handlers.right(); break;
        case 'ArrowUp': case 'KeyW': case 'Space': e.preventDefault(); handlers.jump(); break;
        case 'ArrowDown': case 'KeyS': e.preventDefault(); handlers.slide(); break;
        case 'Escape': case 'KeyP': handlers.pause(); break;
      }
    };

    this.onTouchStart = (e) => {
      const t = e.changedTouches[0];
      this.touchStart = { x: t.clientX, y: t.clientY };
    };

    this.onTouchEnd = (e) => {
      if (!this.touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - this.touchStart.x;
      const dy = t.clientY - this.touchStart.y;
      this.touchStart = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        (dx > 0 ? handlers.right : handlers.left)();
      } else {
        (dy > 0 ? handlers.slide : handlers.jump)();
      }
    };

    // Swipes only bind to the canvas so UI buttons stay tappable.
    this.onTouchMove = (e) => e.preventDefault();

    window.addEventListener('keydown', this.onKeyDown);
    touchTarget.addEventListener('touchstart', this.onTouchStart, { passive: true });
    touchTarget.addEventListener('touchmove', this.onTouchMove, { passive: false });
    touchTarget.addEventListener('touchend', this.onTouchEnd, { passive: true });
  }
}
