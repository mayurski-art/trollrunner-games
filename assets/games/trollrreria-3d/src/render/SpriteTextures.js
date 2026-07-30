import * as THREE from 'three';

const ART_BASE = new URL('../../art/characters/', import.meta.url).href;

const loader = new THREE.TextureLoader();
const textureCache = new Map();
const materialCache = new Map();

function loadTexture(filename) {
  if (!textureCache.has(filename)) {
    const tex = loader.load(ART_BASE + filename);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    textureCache.set(filename, tex);
  }
  return textureCache.get(filename);
}

// SpriteMaterials are shared/cached per filename — many mobs of the same
// kind reuse one material, so callers must NOT dispose it per-instance.
export function getSpriteMaterial(filename) {
  if (!materialCache.has(filename)) {
    materialCache.set(filename, new THREE.SpriteMaterial({ map: loadTexture(filename), transparent: true }));
  }
  return materialCache.get(filename);
}

// Builds a camera-facing billboard sprite sized to `height` world units tall,
// preserving the source image's aspect ratio, anchored so its bottom edge
// sits at y=0 (caller positions the sprite's y at the character's feet).
export function createBillboard(filename, pixelWidth, pixelHeight, height) {
  const sprite = new THREE.Sprite(getSpriteMaterial(filename));
  const width = height * (pixelWidth / pixelHeight);
  sprite.scale.set(width, height, 1);
  sprite.center.set(0.5, 0);
  return sprite;
}
