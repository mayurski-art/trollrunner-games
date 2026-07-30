const ROLL_INTERVAL_MIN = 90; // seconds between weather re-rolls
const ROLL_INTERVAL_MAX = 180;
const RAIN_CHANCE = 0.35;
const RAIN_DURATION_MIN = 40;
const RAIN_DURATION_MAX = 100;
const CROP_GROWTH_BOOST = 1.6; // rain speeds up farming a bit

// Simple two-state weather (clear/rain) re-rolled on a timer — no particle
// system, just a CSS overlay (see the .tr3-rain element) plus a tightened
// fog distance for mood. Ties into World.tickCrops via a speed multiplier.
export class Weather {
  constructor(scene, overlayEl) {
    this.scene = scene;
    this.overlayEl = overlayEl;
    this.raining = false;
    this.rollTimer = 10 + Math.random() * 20; // first roll comes reasonably soon
    this.rainTimer = 0;
    this.baseFogNear = scene.fog?.near ?? 30;
    this.baseFogFar = scene.fog?.far ?? 90;
  }

  update(dt) {
    if (this.raining) {
      this.rainTimer -= dt;
      if (this.rainTimer <= 0) this._setRaining(false);
    } else {
      this.rollTimer -= dt;
      if (this.rollTimer <= 0) {
        this.rollTimer = ROLL_INTERVAL_MIN + Math.random() * (ROLL_INTERVAL_MAX - ROLL_INTERVAL_MIN);
        if (Math.random() < RAIN_CHANCE) {
          this._setRaining(true);
          this.rainTimer = RAIN_DURATION_MIN + Math.random() * (RAIN_DURATION_MAX - RAIN_DURATION_MIN);
        }
      }
    }
  }

  _setRaining(on) {
    this.raining = on;
    if (this.overlayEl) this.overlayEl.hidden = !on;
    if (this.scene.fog) {
      this.scene.fog.near = on ? this.baseFogNear * 0.6 : this.baseFogNear;
      this.scene.fog.far = on ? this.baseFogFar * 0.55 : this.baseFogFar;
    }
  }

  cropGrowthMultiplier() {
    return this.raining ? CROP_GROWTH_BOOST : 1;
  }
}
