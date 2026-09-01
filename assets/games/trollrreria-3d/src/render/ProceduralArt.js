import * as THREE from 'three';

// Cel-shaded dino billboards drawn procedurally on a <canvas> — flat poster
// color blocks with a bold black ink outline, no external art files (no
// PixelLab / no raster asset pipeline). Each drawer renders one static
// camera-facing pose; createBillboard (SpriteTextures.js) is file-based only,
// so this is a parallel canvas-texture path used just for the new dino mobs.

const textureCache = new Map();
const materialCache = new Map();

function outlinedPath(ctx, points, fill) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#0a0a0a';
  ctx.stroke();
}

function ellipse(ctx, x, y, rx, ry, fill) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#0a0a0a';
  ctx.stroke();
}

// Side-view quadruped herbivore: barrel body on 4 sturdy legs, a beaked
// head with brow horns, and a big frill behind it (the frill carries the
// readability accent color so it pops at a distance).
function drawTrike(ctx, w, h, accent) {
  const body = '#5a9d5f';
  const belly = '#dff0cf';
  const dark = '#2f5e33';

  for (const lx of [w*0.28, w*0.42, w*0.62, w*0.76]) {
    outlinedPath(ctx, [[lx-w*0.05,h*0.62],[lx+w*0.06,h*0.62],[lx+w*0.05,h*0.92],[lx-w*0.04,h*0.92]], dark);
  }
  outlinedPath(ctx, [[w*0.08,h*0.42],[w*0.24,h*0.16],[w*0.4,h*0.16],[w*0.42,h*0.4],[w*0.3,h*0.56],[w*0.12,h*0.56]], accent);
  outlinedPath(ctx, [[w*0.3,h*0.38],[w*0.55,h*0.32],[w*0.85,h*0.36],[w*0.92,h*0.55],[w*0.82,h*0.68],[w*0.4,h*0.7],[w*0.26,h*0.56]], body);
  outlinedPath(ctx, [[w*0.4,h*0.58],[w*0.7,h*0.56],[w*0.72,h*0.68],[w*0.42,h*0.7]], belly);
  outlinedPath(ctx, [[w*0.14,h*0.44],[w*0.28,h*0.36],[w*0.34,h*0.46],[w*0.3,h*0.58],[w*0.16,h*0.58]], body);
  outlinedPath(ctx, [[w*0.06,h*0.5],[w*0.16,h*0.46],[w*0.16,h*0.56]], body);
  outlinedPath(ctx, [[w*0.2,h*0.36],[w*0.24,h*0.14],[w*0.28,h*0.36]], '#f2ead2');
  outlinedPath(ctx, [[w*0.28,h*0.36],[w*0.33,h*0.18],[w*0.36,h*0.37]], '#f2ead2');
  ellipse(ctx, w * 0.19, h * 0.46, w * 0.02, h * 0.02, '#0a0a0a');
  outlinedPath(ctx, [[w*0.82,h*0.6],[w*0.98,h*0.5],[w*0.94,h*0.66],[w*0.82,h*0.68]], body);
}

// Sleek forward-leaning biped: tail out back for balance, striding legs,
// small arms tucked to the chest, jagged spine stripe in the accent color
// running from head to tail so a pack reads as one clear threat.
function drawRaptor(ctx, w, h, accent) {
  const body = '#9a4444';
  const dark = '#5e2727';

  outlinedPath(ctx, [[w*0.28,h*0.5],[w*0.02,h*0.36],[w*0.06,h*0.46],[w*0.3,h*0.6]], body);
  outlinedPath(ctx, [[w*0.42,h*0.62],[w*0.36,h*0.8],[w*0.3,h*0.94],[w*0.4,h*0.94],[w*0.48,h*0.66]], dark);
  outlinedPath(ctx, [[w*0.6,h*0.6],[w*0.66,h*0.78],[w*0.72,h*0.92],[w*0.6,h*0.92],[w*0.54,h*0.64]], dark);
  outlinedPath(ctx, [[w*0.32,h*0.56],[w*0.4,h*0.36],[w*0.62,h*0.28],[w*0.78,h*0.36],[w*0.7,h*0.5],[w*0.5,h*0.62]], body);
  outlinedPath(ctx, [[w*0.42,h*0.44],[w*0.32,h*0.46],[w*0.38,h*0.52]], body);
  outlinedPath(ctx, [[w*0.7,h*0.36],[w*0.9,h*0.2],[w*1.0,h*0.24],[w*0.96,h*0.4],[w*0.78,h*0.46]], body);
  outlinedPath(ctx, [[w*0.9,h*0.32],[w*1.02,h*0.34],[w*0.94,h*0.42]], dark);
  ellipse(ctx, w * 0.86, h * 0.26, w * 0.02, h * 0.02, '#ffd400');
  outlinedPath(ctx, [[w*0.86,h*0.22],[w*0.6,h*0.28],[w*0.4,h*0.38],[w*0.16,h*0.4]], accent);
}

// Massive apex predator: huge toothy head, thick S-neck, tiny arms, heavy
// tail balancing a powerful stride. Dark warm body, bright throat accent.
function drawRex(ctx, w, h, accent) {
  const body = '#4a3d28';
  const dark = '#2c2418';

  outlinedPath(ctx, [[w*0.34,h*0.56],[w*0.04,h*0.66],[w*0.02,h*0.52],[w*0.32,h*0.46]], body);
  outlinedPath(ctx, [[w*0.4,h*0.62],[w*0.34,h*0.86],[w*0.26,h*0.98],[w*0.4,h*0.98],[w*0.5,h*0.68]], dark);
  outlinedPath(ctx, [[w*0.56,h*0.6],[w*0.64,h*0.84],[w*0.7,h*0.98],[w*0.56,h*0.98],[w*0.48,h*0.68]], dark);
  outlinedPath(ctx, [[w*0.3,h*0.5],[w*0.4,h*0.3],[w*0.6,h*0.24],[w*0.72,h*0.34],[w*0.66,h*0.52],[w*0.44,h*0.62]], body);
  outlinedPath(ctx, [[w*0.4,h*0.4],[w*0.32,h*0.42],[w*0.38,h*0.48]], body);
  outlinedPath(ctx, [[w*0.62,h*0.32],[w*0.74,h*0.18],[w*0.86,h*0.16],[w*0.8,h*0.32],[w*0.66,h*0.42]], body);
  outlinedPath(ctx, [[w*0.78,h*0.16],[w*1.0,h*0.14],[w*1.04,h*0.3],[w*0.9,h*0.4],[w*0.76,h*0.32]], body);
  outlinedPath(ctx, [[w*0.92,h*0.32],[w*1.06,h*0.34],[w*0.94,h*0.42]], dark);
  outlinedPath(ctx, [[w*0.82,h*0.3],[w*0.94,h*0.3],[w*0.88,h*0.4]], accent);
  ellipse(ctx, w * 0.9, h * 0.2, w * 0.018, h * 0.018, '#ffd400');
  outlinedPath(ctx, [[w*0.94,h*0.32],[w*0.98,h*0.32],[w*0.96,h*0.37]], '#f2ead2');
}

const DRAWERS = { trike: drawTrike, raptor: drawRaptor, rex: drawRex };

function cacheKey(kind, accent) {
  return `${kind}:${accent}`;
}

// Renders `kind` (trike|raptor|rex) onto an offscreen canvas at pixelSize,
// tinted with `accent` (a CSS color string for the readability stripe/eye),
// caching by kind+accent since mobs of the same species+variant share art.
export function getProceduralMaterial(kind, accent = '#f4c430', pixelSize = 96) {
  const key = cacheKey(kind, accent);
  if (materialCache.has(key)) return materialCache.get(key);

  const canvas = document.createElement('canvas');
  canvas.width = pixelSize;
  canvas.height = pixelSize;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  const draw = DRAWERS[kind] || drawTrike;
  draw(ctx, pixelSize, pixelSize, accent);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  textureCache.set(key, tex);

  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  materialCache.set(key, mat);
  return mat;
}

// Same anchoring convention as SpriteTextures.createBillboard: sized to
// `height` world units tall, bottom edge at y=0 (feet), aspect from canvas
// (all our drawers use a square canvas, so width === height in world units).
export function createProceduralBillboard(kind, accent, height) {
  const sprite = new THREE.Sprite(getProceduralMaterial(kind, accent));
  sprite.scale.set(height, height, 1);
  sprite.center.set(0.5, 0);
  return sprite;
}
