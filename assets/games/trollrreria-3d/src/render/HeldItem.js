import * as THREE from 'three';
import { ICON_MAP, BLOCK_COLOR } from '../world/blocks.js';

// First-person held-item viewmodel — a flat icon-textured plane parented to
// the camera (Minecraft's own held item is similarly a flat plane, not a
// full 3D model, for anything that isn't a placeable block). Reuses the
// exact same icon art already used in the hotbar/inventory; anything
// without dedicated icon art (plain terrain blocks) gets a small flat-color
// swatch instead, matching the same fallback the 2D UI swatches use.
const ICON_BASE = 'assets/games/trollrreria-3d/art/icons/';
const textureCache = new Map(); // item id -> THREE.Texture
const loader = new THREE.TextureLoader();

function textureFor(id) {
  if (textureCache.has(id)) return textureCache.get(id);
  let tex;
  const icon = ICON_MAP[id];
  if (icon) {
    tex = loader.load(ICON_BASE + icon);
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#' + (BLOCK_COLOR[id] ?? 0xffffff).toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, 8, 8);
    tex = new THREE.CanvasTexture(canvas);
  }
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(id, tex);
  return tex;
}

const REST_POS = { x: 0.32, y: -0.28, z: -0.55 };
const REST_ROT = { x: 0, y: -0.3, z: 0.15 };

export class HeldItem {
  constructor(camera) {
    const geo = new THREE.PlaneGeometry(0.34, 0.34);
    // depthTest off + high renderOrder: always draws on top of world
    // geometry, same trick real FPS viewmodels use so the held item never
    // clips into a wall you're standing close to.
    const mat = new THREE.MeshBasicMaterial({ map: null, transparent: true, depthTest: false });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 999;
    this.mesh.position.set(REST_POS.x, REST_POS.y, REST_POS.z);
    this.mesh.rotation.set(REST_ROT.x, REST_ROT.y, REST_ROT.z);
    this.mesh.visible = false;
    camera.add(this.mesh);

    this.currentId = undefined;
    this.bobT = 0;
    this.swingT = 0;
  }

  setItem(id) {
    if (id === this.currentId) return;
    this.currentId = id;
    if (id === null || id === undefined) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.material.map = textureFor(id);
    this.mesh.material.needsUpdate = true;
    this.mesh.visible = true;
  }

  // Call once per swing (mining hit, weapon attack) — decays back to rest
  // over a few frames rather than an explicit animation timeline.
  triggerSwing() {
    this.swingT = 1;
  }

  update(dt, moving) {
    if (!this.mesh.visible) return;
    this.bobT += dt * (moving ? 8 : 2);
    const bobY = Math.sin(this.bobT) * (moving ? 0.015 : 0.004);
    const bobX = Math.cos(this.bobT * 0.5) * (moving ? 0.008 : 0.002);

    let swing = 0;
    if (this.swingT > 0) {
      this.swingT = Math.max(0, this.swingT - dt * 6);
      swing = Math.sin(this.swingT * Math.PI) * 0.14;
    }

    this.mesh.position.set(REST_POS.x + bobX, REST_POS.y + bobY - swing * 0.5, REST_POS.z + swing * 0.35);
    this.mesh.rotation.set(REST_ROT.x + swing * 0.8, REST_ROT.y - swing * 0.6, REST_ROT.z);
  }
}
