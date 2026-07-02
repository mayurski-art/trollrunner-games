/* ============================================================================
   FINISHER SEQUENCER — Phase 11B scaffold (Troll Kombat)

   Isolated, flag-gated cinematic player for the bespoke per-character
   `finisher` animation strips added in Phase 11A. The fight engine only
   ever asks canStart()/isDone() and calls update()/draw() — this module
   never reaches into fighter state, hitboxes, AI, timers, wallet, or
   leaderboard code, and never mutates the fighter objects it reads from.

   Gated by TROLL_FLAGS.ENABLE_BESPOKE_FINISHERS (default false). While off,
   canStart() always returns false and the engine's existing generic
   FINISH!/coinBurst flourish plays exactly as it did before this file
   existed. See docs/PHASE11-BESPOKE-FINISHERS.md for the full plan.
   ============================================================================ */
(() => {
  "use strict";
  if (window.FinisherSequencer) return;   // singleton

  const DURATION = 2.6;   // seconds the cinematic pose holds on screen

  const seq = {
    active: false,
    winner: null,
    t: 0,
    reason: null,

    // Read-only check: can a bespoke finisher play for this round-end?
    // Never throws — any missing/unready asset just returns false so the
    // caller falls back to the generic flourish.
    canStart(roundCtx) {
      try {
        const flags = window.TROLL_FLAGS;
        if (!flags || flags.ENABLE_BESPOKE_FINISHERS !== true) return false;
        const w = roundCtx && roundCtx.winner;
        if (!w || !w.def || !w.def.anims) return false;
        const anim = w.def.anims.defs.finisher;
        const img = w.def.animImg && w.def.animImg.finisher;
        return !!(anim && img && img.complete && img.naturalWidth);
      } catch (_) { return false; }
    },

    start(roundCtx) {
      this.active = true;
      this.winner = roundCtx.winner;
      this.t = 0;
      this.reason = null;
    },

    update(dt) {
      if (!this.active) return;
      this.t += dt;
      if (this.t >= DURATION) this.active = false;
    },

    isDone() { return !this.active; },

    cancel(reason) {
      this.active = false;
      this.reason = reason || "cancelled";
      this.winner = null;
      this.t = 0;
    },

    // Overlay-draws the winner's finisher pose at its current world position.
    // Pure read of winner.x/feetY/facing/def — draws on top of, and does not
    // replace, whatever the normal fighter render already put on screen.
    draw(ctx) {
      if (!this.active || !this.winner) return;
      const w = this.winner, A = w.def.anims;
      const anim = A.defs.finisher, img = w.def.animImg.finisher;
      if (!anim || !img || !img.complete) { this.active = false; return; }
      const cell = A.cell, sc = A.scale;
      const idx = Math.min(anim.frames - 1, Math.floor(this.t * anim.fps));
      const dw = cell * sc, dh = cell * sc;
      const feetTop = cell * A.footFrac * sc;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(w.x, w.feetY);
      ctx.scale(w.facing, 1);
      ctx.drawImage(img, idx * cell, 0, cell, cell, -dw / 2, -feetTop, dw, dh);
      ctx.restore();
    },
  };

  window.FinisherSequencer = seq;
})();
