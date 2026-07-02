// Speed/difficulty progression per the design spec:
//   0–30s   level 1 — slow, single blockers, simple coin lines
//   30–60s  level 2 — faster, jump/slide obstacles, more switching
//   60–120s level 3 — mixed patterns, trains, staggered weaves
//   120s+   level 4 — fast, double trains, intense but fair
export class DifficultyManager {
  constructor() {
    this.baseSpeed = 14;
    this.maxSpeed = 34;
    this.speedIncreaseRate = 0.34; // units/sec gained per second survived
    this.reset();
  }

  reset() {
    this.currentSpeed = this.baseSpeed;
    this.elapsed = 0;
    this.distance = 0;
    this.stumbleTimer = 0;
  }

  get level() {
    if (this.elapsed < 30) return 1;
    if (this.elapsed < 60) return 2;
    if (this.elapsed < 120) return 3;
    return 4;
  }

  // 0..1 progress from base speed to max speed (drives FOV/streak effects).
  get speedT() {
    return (this.currentSpeed - this.baseSpeed) / (this.maxSpeed - this.baseSpeed);
  }

  // Distance between obstacle patterns shrinks as speed rises, so reaction
  // time stays roughly constant instead of collapsing at high speed.
  get gapDistance() {
    const t = (this.currentSpeed - this.baseSpeed) / (this.maxSpeed - this.baseSpeed);
    return 30 - 13 * t;
  }

  applyStumble() {
    this.stumbleTimer = 1.2;
  }

  update(dt) {
    this.elapsed += dt;
    let speed = Math.min(this.maxSpeed, this.baseSpeed + this.speedIncreaseRate * this.elapsed);
    if (this.stumbleTimer > 0) {
      this.stumbleTimer -= dt;
      speed *= 0.55;
    }
    this.currentSpeed = speed;
    this.distance += this.currentSpeed * dt;
  }
}
