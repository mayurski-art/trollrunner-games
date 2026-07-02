import * as THREE from 'three';
import { DESPAWN_Z } from '../core/constants.js';

const SEG_LEN = 18;
const SEG_COUNT = 12;

// Builds and scrolls the Meme Metro environment: track, sleepers, tunnel
// walls with neon billboards, lighting and fog. All colors come from the
// stage definition so future stages are data-only.
export class WorldManager {
  constructor(scene, stage) {
    this.scene = scene;
    this.stage = stage;

    scene.background = new THREE.Color(stage.sky);
    scene.fog = new THREE.FogExp2(stage.fog, stage.fogDensity);

    const hemi = new THREE.HemisphereLight(stage.hemiSky, stage.hemiGround, 1.5);
    const dir = new THREE.DirectionalLight(0xfff0dd, 1.3);
    dir.position.set(6, 12, 4);
    // Warm fill over the player's stretch of track.
    const fill = new THREE.PointLight(0xffe0b0, 60, 45, 1.8);
    fill.position.set(0, 6, -4);
    scene.add(hemi, dir, fill);

    // Ground plane (static — motion is sold by sleepers/walls).
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 420),
      new THREE.MeshStandardMaterial({ color: stage.ground, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -160);
    scene.add(ground);

    // Rails: two per lane, running the full track (static).
    const railMat = new THREE.MeshStandardMaterial({ color: stage.rail, roughness: 0.35, metalness: 0.7 });
    const railGeo = new THREE.BoxGeometry(0.1, 0.09, 420);
    for (const laneX of [-2.2, 0, 2.2]) {
      for (const off of [-0.75, 0.75]) {
        const rail = new THREE.Mesh(railGeo, railMat);
        rail.position.set(laneX + off, 0.045, -160);
        this.scene.add(rail);
      }
    }

    // Neon strips keep the 3 lanes readable at speed: lane dividers in the
    // first glow color, outer track edges in the second.
    const stripGeo = new THREE.BoxGeometry(0.07, 0.02, 420);
    const dividerMat = new THREE.MeshBasicMaterial({ color: stage.laneGlow[0], toneMapped: false });
    const edgeMat = new THREE.MeshBasicMaterial({ color: stage.laneGlow[1], toneMapped: false });
    for (const side of [-1, 1]) {
      const divider = new THREE.Mesh(stripGeo, dividerMat);
      divider.position.set(side * 1.1, 0.015, -160);
      const edge = new THREE.Mesh(stripGeo, edgeMat);
      edge.position.set(side * 3.55, 0.015, -160);
      scene.add(divider, edge);
    }

    this.neonColors = stage.neon.map((c) => new THREE.Color(c));
    this.segments = [];
    this.sleeperMat = new THREE.MeshStandardMaterial({ color: stage.sleeper, roughness: 0.95 });
    this.wallMat = new THREE.MeshStandardMaterial({ color: stage.wall, roughness: 0.9 });
    this.sleeperGeo = new THREE.BoxGeometry(7.4, 0.09, 0.5);
    this.neonGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < SEG_COUNT; i++) {
      const seg = this.buildSegment();
      seg.position.z = DESPAWN_Z - SEG_LEN / 2 - i * SEG_LEN;
      this.segments.push(seg);
      scene.add(seg);
    }
  }

  buildSegment() {
    const seg = new THREE.Group();
    seg.userData.neons = [];

    // Track sleepers.
    for (let r = 0; r < 9; r++) {
      const sleeper = new THREE.Mesh(this.sleeperGeo, this.sleeperMat);
      sleeper.position.set(0, 0.02, r * 2 - SEG_LEN / 2 + 1);
      seg.add(sleeper);
    }

    // Tunnel walls left/right with neon billboards facing the track.
    for (const side of [-1, 1]) {
      const height = 6 + Math.random() * 5;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1.6, height, SEG_LEN), this.wallMat);
      wall.position.set(side * 7.4, height / 2, 0);
      seg.add(wall);

      const count = 2 + Math.floor(Math.random() * 2);
      for (let n = 0; n < count; n++) {
        const neon = new THREE.Mesh(
          this.neonGeo,
          new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
        );
        neon.scale.set(1.6 + Math.random() * 2.6, 0.9 + Math.random() * 1.8, 1);
        neon.position.set(side * 6.55, 1.4 + Math.random() * 3.4, (Math.random() - 0.5) * (SEG_LEN - 3));
        neon.rotation.y = -side * Math.PI / 2;
        seg.add(neon);
        seg.userData.neons.push(neon);
      }
    }

    this.recolorSegment(seg);
    return seg;
  }

  recolorSegment(seg) {
    for (const neon of seg.userData.neons) {
      const color = this.neonColors[Math.floor(Math.random() * this.neonColors.length)];
      neon.material.color.copy(color).multiplyScalar(0.85 + Math.random() * 0.5);
    }
  }

  update(dt, speed) {
    for (const seg of this.segments) {
      seg.position.z += speed * dt;
      if (seg.position.z - SEG_LEN / 2 > DESPAWN_Z) {
        seg.position.z -= SEG_LEN * SEG_COUNT;
        this.recolorSegment(seg);
      }
    }
  }
}
