import * as THREE from 'three';

const DAY_LENGTH_SECONDS = 600; // 10 real minutes per full day/night cycle
const ORBIT_RADIUS = 140;

const SKY_DAY = new THREE.Color(0x9fd6ff);
const SKY_NIGHT = new THREE.Color(0x070818);
const FOG_DAY = new THREE.Color(0x9fd6ff);
const FOG_NIGHT = new THREE.Color(0x05060f);
const SUN_COLOR_DAY = new THREE.Color(0xfff2d9);
const SUN_COLOR_HORIZON = new THREE.Color(0xffab5e);

// Drives the sky/fog color, sun+moon position, and light intensities from a
// single timeOfDay value (0..1, 0=midnight, 0.5=noon) — matches the 2D
// game's living-world phase (day/night) without a full weather system yet.
export class DayNightCycle {
  constructor(scene, { hemi, sunLight, ambient }) {
    this.scene = scene;
    this.hemi = hemi;
    this.sunLight = sunLight;
    this.ambient = ambient;
    this.timeOfDay = 0.3; // start mid-morning
    this.day = 1;

    const sunGeo = new THREE.SphereGeometry(6, 12, 12);
    this.sunMesh = new THREE.Mesh(sunGeo, new THREE.MeshBasicMaterial({ color: 0xffe9b0, fog: false }));
    const moonGeo = new THREE.SphereGeometry(4, 12, 12);
    this.moonMesh = new THREE.Mesh(moonGeo, new THREE.MeshBasicMaterial({ color: 0xd7dcf0, fog: false }));
    scene.add(this.sunMesh, this.moonMesh);

    this._tmpColor = new THREE.Color();
    this._apply(); // set initial state without waiting for the first frame
  }

  update(dt) {
    this.timeOfDay += dt / DAY_LENGTH_SECONDS;
    if (this.timeOfDay >= 1) {
      this.timeOfDay -= 1;
      this.day += 1;
    }
    this._apply();
  }

  _apply() {
    const angle = this.timeOfDay * Math.PI * 2;
    // dayFactor: 0 at midnight, 1 at noon, smooth in between.
    const dayFactor = Math.max(0, -Math.cos(angle));
    const duskFactor = Math.max(0, 1 - Math.abs(dayFactor - 0.25) / 0.25) * (dayFactor < 0.5 ? 1 : 0);

    const sunHeight = Math.sin(angle - Math.PI / 2);
    this.sunMesh.position.set(ORBIT_RADIUS * Math.cos(angle), ORBIT_RADIUS * sunHeight * 0.6 + 20, ORBIT_RADIUS * 0.3);
    this.moonMesh.position.set(-this.sunMesh.position.x, -((ORBIT_RADIUS * sunHeight * 0.6)) + 20, -this.sunMesh.position.z);
    this.sunMesh.visible = sunHeight > -0.15;
    this.moonMesh.visible = sunHeight < 0.15;

    this.sunLight.position.copy(this.sunMesh.position);
    this.sunLight.intensity = 0.15 + dayFactor * 0.65;
    this._tmpColor.copy(SUN_COLOR_HORIZON).lerp(SUN_COLOR_DAY, Math.min(1, dayFactor * 2));
    this.sunLight.color.copy(this._tmpColor);

    this.hemi.intensity = 0.35 + dayFactor * 0.75;
    this.ambient.intensity = 0.15 + dayFactor * 0.35;

    this._tmpColor.copy(SKY_NIGHT).lerp(SKY_DAY, dayFactor);
    if (duskFactor > 0) this._tmpColor.lerp(new THREE.Color(0xff9a56), duskFactor * 0.35);
    this.scene.background.copy(this._tmpColor);
    if (this.scene.fog) {
      this._tmpColor.copy(FOG_NIGHT).lerp(FOG_DAY, dayFactor);
      this.scene.fog.color.copy(this._tmpColor);
    }
  }

  clockString() {
    const totalMinutes = Math.floor(this.timeOfDay * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  isNight() {
    return Math.sin(this.timeOfDay * Math.PI * 2 - Math.PI / 2) < -0.15;
  }
}
