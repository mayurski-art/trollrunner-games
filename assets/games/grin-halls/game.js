/* Grin Halls — game 010, Phase 1.
   Procedurally-mazed first-person liminal hallway crawl. Vendored Three.js
   (assets/vendor/three.module.min.js) via importmap in grin-halls.html —
   no CDN, matches the Pizzeria Kitchen3D pattern. No entity/chase yet;
   that's Phase 2. This module owns the whole game: maze gen, procedural
   textures, FPS controls + collision, fragment pickups, minimap, HUD. */

import * as THREE from "three";

const MAZE_W = 12;
const MAZE_H = 12;
const CELL = 6;
const WALL_H = 3.4;
const WALL_THICK = 0.45;
const FRAGMENT_TOTAL = 6;
const PLAYER_RADIUS = 0.45;
const PLAYER_EYE_H = 1.6;
const BASE_SPEED = 3.6;
const SPRINT_MULT = 1.9;
const STAMINA_DRAIN = 32; // per second while sprinting
const STAMINA_REGEN = 18; // per second while not sprinting

// ---------------------------------------------------------------- maze gen
function generateMaze(w, h) {
  const cells = [];
  for (let z = 0; z < h; z++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push({ N: true, S: true, E: true, W: true, visited: false });
    cells.push(row);
  }
  const at = (x, z) => cells[z][x];
  const stack = [[0, 0]];
  at(0, 0).visited = true;
  const dirs = [
    ["N", 0, -1, "S"],
    ["S", 0, 1, "N"],
    ["E", 1, 0, "W"],
    ["W", -1, 0, "E"],
  ];
  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    const options = [];
    for (const [dir, dx, dz, opp] of dirs) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
      if (!at(nx, nz).visited) options.push([dir, dx, dz, opp, nx, nz]);
    }
    if (!options.length) { stack.pop(); continue; }
    const [dir, , , opp, nx, nz] = options[Math.floor(Math.random() * options.length)];
    at(cx, cz)[dir] = false;
    at(nx, nz)[opp] = false;
    at(nx, nz).visited = true;
    stack.push([nx, nz]);
  }
  return cells;
}

function farthestCell(maze, w, h, startX, startZ) {
  const dist = maze.map((row) => row.map(() => -1));
  dist[startZ][startX] = 0;
  const q = [[startX, startZ]];
  let best = [startX, startZ];
  const dirs = [["N", 0, -1], ["S", 0, 1], ["E", 1, 0], ["W", -1, 0]];
  while (q.length) {
    const [cx, cz] = q.shift();
    for (const [dir, dx, dz] of dirs) {
      if (maze[cz][cx][dir]) continue;
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
      if (dist[nz][nx] !== -1) continue;
      dist[nz][nx] = dist[cz][cx] + 1;
      if (dist[nz][nx] > dist[best[1]][best[0]]) best = [nx, nz];
      q.push([nx, nz]);
    }
  }
  return { cell: best, dist };
}

function deadEndCells(maze, w, h, exclude) {
  const out = [];
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      if (exclude.some(([ex, ez]) => ex === x && ez === z)) continue;
      const c = maze[z][x];
      const openings = (c.N ? 0 : 1) + (c.S ? 0 : 1) + (c.E ? 0 : 1) + (c.W ? 0 : 1);
      if (openings === 1) out.push([x, z]);
    }
  }
  return out;
}

function cellCenter(cx, cz) {
  return new THREE.Vector3(
    (cx - (MAZE_W - 1) / 2) * CELL,
    0,
    (cz - (MAZE_H - 1) / 2) * CELL
  );
}

// -------------------------------------------------------- procedural art
function makeCanvasTexture(draw, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCarpetTexture() {
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = "#8a6f3a";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      const shade = 100 + Math.random() * 40;
      ctx.fillStyle = `rgba(${shade | 0},${(shade * 0.8) | 0},${(shade * 0.45) | 0},0.5)`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    for (let i = 0; i < size; i += 8) {
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
    }
  });
}

function makeWallpaperTexture() {
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = "#c7a94f";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "rgba(180,150,70,0.35)";
    for (let x = 0; x < size; x += 22) ctx.fillRect(x, 0, 10, size);
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * size, y = Math.random() * size, r = 14 + Math.random() * 26;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "rgba(90,70,20,0.22)");
      grad.addColorStop(1, "rgba(90,70,20,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }, 512);
}

function makeCeilingTexture() {
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = "#e7e3d3";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(120,110,80,0.4)";
    ctx.lineWidth = 2;
    const tiles = 4;
    for (let i = 0; i <= tiles; i++) {
      const p = (size / tiles) * i;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
    }
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = "rgba(90,80,50,0.08)";
      ctx.fillRect(Math.random() * size, Math.random() * size, 3, 3);
    }
  });
}

// ------------------------------------------------------------------- game
class GrinHalls {
  constructor(canvas, hud) {
    this.canvas = canvas;
    this.hud = hud;
    this.clock = new THREE.Clock();
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.stamina = 100;
    this.sprinting = false;
    this.collected = 0;
    this.exitUnlocked = false;
    this.finished = false;
    this.startTime = 0;
    this.onComplete = null;

    this._buildScene();
    this._bindInput();
  }

  _buildScene() {
    this.maze = generateMaze(MAZE_W, MAZE_H);
    const startCell = [0, 0];
    const { cell: exitCell } = farthestCell(this.maze, MAZE_W, MAZE_H, 0, 0);
    this.exitCell = exitCell;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x8a7a44, 0.045);
    this.scene = scene;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 60);
    const startPos = cellCenter(...startCell);
    this.camera.position.set(startPos.x, PLAYER_EYE_H, startPos.z);
    this.playerPos = new THREE.Vector3(startPos.x, 0, startPos.z);

    scene.add(new THREE.AmbientLight(0x8a7a55, 0.55));
    this.hemi = new THREE.HemisphereLight(0xd8c377, 0x2a2313, 0.35);
    scene.add(this.hemi);

    const mazeW = MAZE_W * CELL, mazeH = MAZE_H * CELL;

    const floorTex = makeCarpetTexture();
    floorTex.repeat.set(MAZE_W * 1.5, MAZE_H * 1.5);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(mazeW, mazeH),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const ceilTex = makeCeilingTexture();
    ceilTex.repeat.set(MAZE_W, MAZE_H);
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(mazeW, mazeH),
      new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1 })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_H;
    scene.add(ceiling);

    const wallTex = makeWallpaperTexture();
    wallTex.repeat.set(1, 0.6);
    this.wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
    this.colliders = [];
    this._buildWalls(scene);
    this._buildCeilingLights(scene);
    this._buildFragments(scene, startCell, exitCell);
    this._buildExitDoor(scene, exitCell);

    this.visited = new Set([`${startCell[0]},${startCell[1]}`]);
  }

  _addWallBox(cx1, cz1, cx2, cz2, scene) {
    const a = cellCenter(cx1, cz1), b = cellCenter(cx2, cz2);
    const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
    const horizontal = a.z === b.z; // wall runs along Z (east/west wall)
    const length = CELL;
    const geo = horizontal
      ? new THREE.BoxGeometry(WALL_THICK, WALL_H, length)
      : new THREE.BoxGeometry(length, WALL_H, WALL_THICK);
    const mesh = new THREE.Mesh(geo, this.wallMat);
    mesh.position.set(midX, WALL_H / 2, midZ);
    scene.add(mesh);
    const halfL = length / 2, halfT = WALL_THICK / 2;
    this.colliders.push(horizontal
      ? { minX: midX - halfT, maxX: midX + halfT, minZ: midZ - halfL, maxZ: midZ + halfL }
      : { minX: midX - halfL, maxX: midX + halfL, minZ: midZ - halfT, maxZ: midZ + halfT });
  }

  _buildWalls(scene) {
    for (let z = 0; z < MAZE_H; z++) {
      for (let x = 0; x < MAZE_W; x++) {
        const c = this.maze[z][x];
        if (c.N) this._addWallBox(x, z, x, z - 1, scene);
        if (c.W) this._addWallBox(x, z, x - 1, z, scene);
        if (z === MAZE_H - 1 && c.S) this._addWallBox(x, z, x, z + 1, scene);
        if (x === MAZE_W - 1 && c.E) this._addWallBox(x, z, x + 1, z, scene);
      }
    }
  }

  _buildCeilingLights(scene) {
    this.lights = [];
    for (let z = 1; z < MAZE_H; z += 3) {
      for (let x = 1; x < MAZE_W; x += 3) {
        const center = cellCenter(x, z);
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(2.4, 1.1),
          new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2b0, emissiveIntensity: 1.4 })
        );
        panel.rotation.x = Math.PI / 2;
        panel.position.set(center.x, WALL_H - 0.02, center.z);
        scene.add(panel);
        const light = new THREE.PointLight(0xfff0b0, 1.1, CELL * 3.2, 2);
        light.position.set(center.x, WALL_H - 0.3, center.z);
        scene.add(light);
        this.lights.push({ light, panel, phase: Math.random() * Math.PI * 2, flickerAt: 0 });
      }
    }
  }

  _buildFragments(scene, startCell, exitCell) {
    const exclude = [startCell, exitCell];
    let spots = deadEndCells(this.maze, MAZE_W, MAZE_H, exclude);
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    if (spots.length < FRAGMENT_TOTAL) {
      for (let z = 0; z < MAZE_H && spots.length < FRAGMENT_TOTAL * 2; z++) {
        for (let x = 0; x < MAZE_W; x++) {
          if (!exclude.some(([ex, ez]) => ex === x && ez === z) && !spots.some(([sx, sz]) => sx === x && sz === z)) {
            spots.push([x, z]);
          }
        }
      }
    }
    spots = spots.slice(0, FRAGMENT_TOTAL);

    const geo = new THREE.IcosahedronGeometry(0.32, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd84d, emissive: 0xffb400, emissiveIntensity: 0.9, roughness: 0.3 });
    this.fragments = spots.map(([cx, cz]) => {
      const c = cellCenter(cx, cz);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(c.x, 1.1, c.z);
      const light = new THREE.PointLight(0xffcc55, 0.8, 4, 2);
      mesh.add(light);
      scene.add(mesh);
      return { mesh, collected: false };
    });
  }

  _buildExitDoor(scene, exitCell) {
    const c = cellCenter(...exitCell);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3222, emissive: 0x1a1608, emissiveIntensity: 0.2 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, WALL_H - 0.4, 0.25), mat);
    door.position.set(c.x, (WALL_H - 0.4) / 2, c.z);
    scene.add(door);
    this.doorMat = mat;
    this.doorPos = c;
  }

  _bindInput() {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.sprinting = true;
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.sprinting = false;
    });
    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
    });
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width * Math.min(window.devicePixelRatio, 2);
    this.canvas.height = rect.height * Math.min(window.devicePixelRatio, 2);
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.startTime = performance.now();
    this.resize();
    this._loop();
  }

  _moveKeys() {
    let fwd = 0, strafe = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fwd += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fwd -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) strafe += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) strafe -= 1;
    return { fwd, strafe };
  }

  _resolveCollision(pos, radius) {
    for (const c of this.colliders) {
      const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const dx = pos.x - nx, dz = pos.z - nz;
      const distSq = dx * dx + dz * dz;
      if (distSq < radius * radius && distSq > 1e-9) {
        const dist = Math.sqrt(distSq);
        const push = (radius - dist) / dist;
        pos.x += dx * push;
        pos.z += dz * push;
      } else if (distSq <= 1e-9) {
        pos.x += radius;
      }
    }
  }

  _update(dt) {
    const { fwd, strafe } = this._moveKeys();
    const canSprint = this.sprinting && this.stamina > 0 && (fwd !== 0 || strafe !== 0);
    if (canSprint) this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
    else this.stamina = Math.min(100, this.stamina + STAMINA_REGEN * dt);
    const speed = BASE_SPEED * (canSprint ? SPRINT_MULT : 1);

    if (fwd !== 0 || strafe !== 0) {
      const dirX = Math.sin(this.yaw), dirZ = Math.cos(this.yaw);
      const rightX = Math.sin(this.yaw + Math.PI / 2), rightZ = Math.cos(this.yaw + Math.PI / 2);
      const moveX = (dirX * fwd + rightX * strafe);
      const moveZ = (dirZ * fwd + rightZ * strafe);
      const len = Math.hypot(moveX, moveZ) || 1;
      this.playerPos.x += (moveX / len) * speed * dt;
      this.playerPos.z += (moveZ / len) * speed * dt;
      this._resolveCollision(this.playerPos, PLAYER_RADIUS);
    }

    this.camera.position.set(this.playerPos.x, PLAYER_EYE_H, this.playerPos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");

    const cx = Math.round(this.playerPos.x / CELL + (MAZE_W - 1) / 2);
    const cz = Math.round(this.playerPos.z / CELL + (MAZE_H - 1) / 2);
    this.visited.add(`${cx},${cz}`);
    this.currentCell = [cx, cz];

    const t = performance.now() * 0.001;
    for (const l of this.lights) {
      let flick = 0.92 + 0.08 * Math.sin(t * 6 + l.phase);
      if (t > l.flickerAt) {
        flick *= Math.random() < 0.06 ? 0.15 : 1;
        if (Math.random() < 0.01) l.flickerAt = t + 0.15;
      }
      l.light.intensity = 1.1 * flick;
      l.panel.material.emissiveIntensity = 1.4 * flick;
    }

    for (const f of this.fragments) {
      if (f.collected) continue;
      f.mesh.rotation.y += dt * 1.4;
      f.mesh.position.y = 1.1 + Math.sin(t * 2 + f.mesh.position.x) * 0.08;
      const dist = f.mesh.position.distanceTo(this.playerPos);
      if (dist < 1.1) {
        f.collected = true;
        f.mesh.visible = false;
        this.collected++;
        if (this.collected >= FRAGMENT_TOTAL) this._unlockExit();
      }
    }

    if (this.exitUnlocked && !this.finished) {
      const distDoor = Math.hypot(this.playerPos.x - this.doorPos.x, this.playerPos.z - this.doorPos.z);
      if (distDoor < 1.4) this._finish();
    }

    this._updateHud();
  }

  _unlockExit() {
    this.exitUnlocked = true;
    this.doorMat.color.set(0x4dff73);
    this.doorMat.emissive.set(0x2fd45c);
    this.doorMat.emissiveIntensity = 1.2;
  }

  _finish() {
    this.finished = true;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    const seconds = ((performance.now() - this.startTime) / 1000).toFixed(1);
    if (this.onComplete) this.onComplete(seconds);
  }

  _updateHud() {
    this.hud.fragmentCount.textContent = `${this.collected}/${FRAGMENT_TOTAL}`;
    this.hud.staminaFill.style.transform = `scaleX(${this.stamina / 100})`;
    this._drawMinimap();
  }

  _drawMinimap() {
    const ctx = this.hud.minimap.ctx;
    const size = this.hud.minimap.canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#12100a";
    ctx.fillRect(0, 0, size, size);
    const cellPx = size / MAZE_W;
    ctx.save();
    for (let z = 0; z < MAZE_H; z++) {
      for (let x = 0; x < MAZE_W; x++) {
        if (!this.visited.has(`${x},${z}`)) continue;
        ctx.fillStyle = "rgba(216,195,119,0.35)";
        ctx.fillRect(x * cellPx, z * cellPx, cellPx, cellPx);
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    for (let z = 0; z < MAZE_H; z++) {
      for (let x = 0; x < MAZE_W; x++) {
        if (!this.visited.has(`${x},${z}`)) continue;
        const c = this.maze[z][x];
        const px = x * cellPx, pz = z * cellPx;
        if (c.N) { ctx.beginPath(); ctx.moveTo(px, pz); ctx.lineTo(px + cellPx, pz); ctx.stroke(); }
        if (c.W) { ctx.beginPath(); ctx.moveTo(px, pz); ctx.lineTo(px, pz + cellPx); ctx.stroke(); }
        if (c.S) { ctx.beginPath(); ctx.moveTo(px, pz + cellPx); ctx.lineTo(px + cellPx, pz + cellPx); ctx.stroke(); }
        if (c.E) { ctx.beginPath(); ctx.moveTo(px + cellPx, pz); ctx.lineTo(px + cellPx, pz + cellPx); ctx.stroke(); }
      }
    }
    ctx.restore();
    if (this.exitUnlocked) {
      const [ex, ez] = this.exitCell;
      ctx.fillStyle = "#4dff73";
      ctx.beginPath();
      ctx.arc(ex * cellPx + cellPx / 2, ez * cellPx + cellPx / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const [pcx, pcz] = this.currentCell || [0, 0];
    const px = pcx * cellPx + cellPx / 2, pz = pcz * cellPx + cellPx / 2;
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(this.yaw);
    ctx.fillStyle = "#ff5a5a";
    ctx.beginPath();
    ctx.moveTo(0, -5); ctx.lineTo(3.5, 4); ctx.lineTo(-3.5, 4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _loop() {
    if (this._stopped) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.finished) this._update(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this._loop());
  }

  stop() { this._stopped = true; }
}

// ------------------------------------------------------------------- boot
window.addEventListener("DOMContentLoaded", () => {
  const titleEl = document.getElementById("gh-title");
  const howtoEl = document.getElementById("gh-howto");
  const viewportEl = document.getElementById("gh-viewport");
  const completeEl = document.getElementById("gh-complete");
  const pauseHintEl = document.getElementById("gh-pause-hint");
  const canvas = document.getElementById("gh-canvas");
  const minimapCanvas = document.getElementById("gh-minimap");

  const hud = {
    fragmentCount: document.getElementById("gh-fragment-count"),
    staminaFill: document.getElementById("gh-stamina-fill"),
    minimap: { canvas: minimapCanvas, ctx: minimapCanvas.getContext("2d") },
  };

  let game = null;

  function openHowto() { howtoEl.hidden = false; }
  function closeHowto() { howtoEl.hidden = true; }
  document.getElementById("gh-howto-btn").addEventListener("click", openHowto);
  document.getElementById("gh-hud-help-btn").addEventListener("click", openHowto);
  document.getElementById("gh-howto-close").addEventListener("click", closeHowto);

  function launchGame() {
    titleEl.hidden = true;
    viewportEl.hidden = false;
    if (!game) {
      game = new GrinHalls(canvas, hud);
      game.onComplete = (seconds) => {
        document.getElementById("gh-complete-time").textContent = `Time: ${seconds}s`;
        completeEl.hidden = false;
      };
      game.start();
      window.addEventListener("resize", () => game.resize());
    }
    canvas.requestPointerLock();
  }

  document.getElementById("gh-start-btn").addEventListener("click", launchGame);
  canvas.addEventListener("click", () => canvas.requestPointerLock());

  document.addEventListener("pointerlockchange", () => {
    pauseHintEl.hidden = document.pointerLockElement === canvas || viewportEl.hidden;
  });

  document.getElementById("gh-replay-btn").addEventListener("click", () => {
    window.location.reload();
  });
});
