/* Grin Halls — game 010, Phase 3.
   Adds the Troll Grin entity (patrol/chase AI with raycast line-of-sight
   and BFS pathfinding), hiding alcoves, a caught/game-over state, and
   level progression with escalating distortion (fog, flicker, entity
   speed) across MAX_LEVEL+1 levels. Phase 3 layers in WebAudio sound
   (sound.js), the shared weekly leaderboard, and a real PixelLab-
   generated trollface texture for the entity (art/entity-face.png,
   falling back to the procedural canvas face if it fails to load).
   Phase 1's maze gen, procedural textures, FPS controls + collision,
   fragments, and minimap are unchanged in shape; this file restructures
   scene-build into a per-level rebuild (_buildScene(level)) instead of
   a one-shot setup. Vendored Three.js via importmap in backrooms.html
   — no CDN. */

import * as THREE from "three";
import { GrinHallsSound } from "./sound.js";

const CELL = 6;
const WALL_H = 3.4;
const WALL_THICK = 0.45;
const FRAGMENT_TOTAL = 6;
const SAFE_ROOM_COUNT = 2;
const PLAYER_RADIUS = 0.45;
const PLAYER_EYE_H = 1.6;
const BASE_SPEED = 3.6;
const SPRINT_MULT = 1.9;
const STAMINA_DRAIN = 32;
const STAMINA_REGEN = 18;

const MAX_LEVEL = 2; // levels 0, 1, 2 — clearing level 2's exit ends the run
const LEVEL_NAMES = ["the lobby", "the annex", "sub-level 2"];

const ENTITY_CATCH_DIST = 1.0;
const ENTITY_EYE_H = 1.5;
const PATH_RECOMPUTE_INTERVAL = 0.5;
const ENTITY_LOSE_TIMEOUT = 3.0;

function mazeSizeForLevel(level) {
  const size = 12 + level * 2;
  return Math.min(size, 18);
}

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

const NEIGHBOR_DIRS = [["N", 0, -1], ["S", 0, 1], ["E", 1, 0], ["W", -1, 0]];

function neighbors(maze, w, h, cx, cz) {
  const out = [];
  for (const [dir, dx, dz] of NEIGHBOR_DIRS) {
    if (maze[cz][cx][dir]) continue;
    const nx = cx + dx, nz = cz + dz;
    if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
    out.push([nx, nz]);
  }
  return out;
}

function bfsDistances(maze, w, h, startX, startZ) {
  const dist = maze.map((row) => row.map(() => -1));
  dist[startZ][startX] = 0;
  const q = [[startX, startZ]];
  while (q.length) {
    const [cx, cz] = q.shift();
    for (const [nx, nz] of neighbors(maze, w, h, cx, cz)) {
      if (dist[nz][nx] !== -1) continue;
      dist[nz][nx] = dist[cz][cx] + 1;
      q.push([nx, nz]);
    }
  }
  return dist;
}

function farthestCell(maze, w, h, startX, startZ) {
  const dist = bfsDistances(maze, w, h, startX, startZ);
  let best = [startX, startZ];
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      if (dist[z][x] > dist[best[1]][best[0]]) best = [x, z];
    }
  }
  return { cell: best, dist };
}

function bfsPath(maze, w, h, start, goal) {
  if (start[0] === goal[0] && start[1] === goal[1]) return [];
  const key = (x, z) => `${x},${z}`;
  const parent = new Map();
  parent.set(key(...start), null);
  const q = [start];
  while (q.length) {
    const [cx, cz] = q.shift();
    if (cx === goal[0] && cz === goal[1]) break;
    for (const n of neighbors(maze, w, h, cx, cz)) {
      const k = key(...n);
      if (parent.has(k)) continue;
      parent.set(k, [cx, cz]);
      q.push(n);
    }
  }
  const goalKey = key(...goal);
  if (!parent.has(goalKey)) return [];
  const path = [];
  let cur = goal;
  while (cur && !(cur[0] === start[0] && cur[1] === start[1])) {
    path.push(cur);
    cur = parent.get(key(...cur));
  }
  path.reverse();
  return path;
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

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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

function makeTrollGrinFaceTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = "#d9c2a0";
  ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#151008";
  ctx.beginPath(); ctx.ellipse(42, 50, 8, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(86, 50, 8, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(24, 66);
  ctx.quadraticCurveTo(64, 118, 104, 66);
  ctx.quadraticCurveTo(64, 96, 24, 66);
  ctx.fill();
  ctx.fillStyle = "#f4ede0";
  for (let i = 0; i < 6; i++) ctx.fillRect(32 + i * 12, 72, 8, 6);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------------- game
class GrinHalls {
  constructor(canvas, hud, callbacks) {
    this.canvas = canvas;
    this.hud = hud;
    this.callbacks = callbacks || {};
    this.clock = new THREE.Clock();
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.level = 0;
    this.stamina = 100;
    this.sprinting = false;
    this.hiding = false;
    // touch controls (joystick + hide button) are wired from backrooms.html
    // and write straight into these instead of duplicating input state.
    this.touchMove = { fwd: 0, strafe: 0 };
    this.touchHiding = false;
    this.caught = false;
    this.finished = false;
    this.startTime = performance.now();
    this.faceTex = this._loadFaceTexture();
    this.sound = new GrinHallsSound();

    this._bindInput();
    this._buildScene(this.level);
  }

  _loadFaceTexture() {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(
      "assets/games/grin-halls/art/entity-face.png",
      undefined,
      undefined,
      () => {
        // real PixelLab art missing/failed to load — fall back to the
        // procedural canvas trollface so the entity never renders blank.
        const fallback = makeTrollGrinFaceTexture();
        tex.image = fallback.image;
        tex.needsUpdate = true;
      }
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // -------------------------------------------------------------- scene
  _buildScene(level) {
    this.mazeW = mazeSizeForLevel(level);
    this.mazeH = mazeSizeForLevel(level);
    this.maze = generateMaze(this.mazeW, this.mazeH);
    const startCell = [0, 0];
    const { cell: exitCell } = farthestCell(this.maze, this.mazeW, this.mazeH, 0, 0);
    this.exitCell = exitCell;

    const scene = new THREE.Scene();
    const fogDensity = 0.045 + level * 0.012;
    scene.fog = new THREE.FogExp2(0x8a7a44, fogDensity);
    this.scene = scene;
    this.flickerBoost = level * 0.02;

    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 60);
    }

    const startPos = this._cellCenter(...startCell);
    this.camera.position.set(startPos.x, PLAYER_EYE_H, startPos.z);
    this.playerPos = new THREE.Vector3(startPos.x, 0, startPos.z);

    scene.add(new THREE.AmbientLight(0x8a7a55, 0.55));
    scene.add(new THREE.HemisphereLight(0xd8c377, 0x2a2313, 0.35));

    const mazeWorldW = this.mazeW * CELL, mazeWorldH = this.mazeH * CELL;

    const floorTex = makeCarpetTexture();
    floorTex.repeat.set(this.mazeW * 1.5, this.mazeH * 1.5);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(mazeWorldW, mazeWorldH),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const ceilTex = makeCeilingTexture();
    ceilTex.repeat.set(this.mazeW, this.mazeH);
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(mazeWorldW, mazeWorldH),
      new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1 })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_H;
    scene.add(ceiling);

    const wallTex = makeWallpaperTexture();
    wallTex.repeat.set(1, 0.6);
    this.wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
    this.wallMat.color.offsetHSL((level * 0.035) % 1, 0, -level * 0.03);
    this.colliders = [];
    this.wallMeshes = [];
    this._buildWalls(scene);
    this._buildCeilingLights(scene);

    const safeCells = shuffle(deadEndCells(this.maze, this.mazeW, this.mazeH, [startCell, exitCell])).slice(0, SAFE_ROOM_COUNT);
    this.safeCells = safeCells;
    this._buildSafeRooms(scene, safeCells);
    this._buildFragments(scene, startCell, exitCell, safeCells);
    this._buildExitDoor(scene, exitCell);
    this._buildEntity(scene, startCell, exitCell, safeCells);

    this.visited = new Set([`${startCell[0]},${startCell[1]}`]);
    this.collected = 0;
    this.exitUnlocked = false;
    this.hiding = false;
    this.caught = false;
    this.sound.setDistortion(level);
  }

  _cellCenter(cx, cz) {
    return new THREE.Vector3(
      (cx - (this.mazeW - 1) / 2) * CELL,
      0,
      (cz - (this.mazeH - 1) / 2) * CELL
    );
  }

  _addWallBox(cx1, cz1, cx2, cz2, scene) {
    const a = this._cellCenter(cx1, cz1), b = this._cellCenter(cx2, cz2);
    const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
    const horizontal = a.z === b.z;
    const length = CELL;
    const geo = horizontal
      ? new THREE.BoxGeometry(WALL_THICK, WALL_H, length)
      : new THREE.BoxGeometry(length, WALL_H, WALL_THICK);
    const mesh = new THREE.Mesh(geo, this.wallMat);
    mesh.position.set(midX, WALL_H / 2, midZ);
    scene.add(mesh);
    this.wallMeshes.push(mesh);
    const halfL = length / 2, halfT = WALL_THICK / 2;
    this.colliders.push(horizontal
      ? { minX: midX - halfT, maxX: midX + halfT, minZ: midZ - halfL, maxZ: midZ + halfL }
      : { minX: midX - halfL, maxX: midX + halfL, minZ: midZ - halfT, maxZ: midZ + halfT });
  }

  _buildWalls(scene) {
    for (let z = 0; z < this.mazeH; z++) {
      for (let x = 0; x < this.mazeW; x++) {
        const c = this.maze[z][x];
        if (c.N) this._addWallBox(x, z, x, z - 1, scene);
        if (c.W) this._addWallBox(x, z, x - 1, z, scene);
        if (z === this.mazeH - 1 && c.S) this._addWallBox(x, z, x, z + 1, scene);
        if (x === this.mazeW - 1 && c.E) this._addWallBox(x, z, x + 1, z, scene);
      }
    }
  }

  _buildCeilingLights(scene) {
    this.lights = [];
    for (let z = 1; z < this.mazeH; z += 3) {
      for (let x = 1; x < this.mazeW; x += 3) {
        const center = this._cellCenter(x, z);
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

  _buildSafeRooms(scene, safeCells) {
    const geo = new THREE.CircleGeometry(1.4, 20);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1c3d38, emissive: 0x2fd4b0, emissiveIntensity: 0.5, roughness: 0.8 });
    for (const [cx, cz] of safeCells) {
      const c = this._cellCenter(cx, cz);
      const patch = new THREE.Mesh(geo, mat);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(c.x, 0.02, c.z);
      scene.add(patch);
      const light = new THREE.PointLight(0x4deec7, 0.6, 4, 2);
      light.position.set(c.x, 1.2, c.z);
      scene.add(light);
    }
  }

  _buildFragments(scene, startCell, exitCell, safeCells) {
    const exclude = [startCell, exitCell, ...safeCells];
    let spots = deadEndCells(this.maze, this.mazeW, this.mazeH, exclude);
    shuffle(spots);
    if (spots.length < FRAGMENT_TOTAL) {
      for (let z = 0; z < this.mazeH && spots.length < FRAGMENT_TOTAL * 2; z++) {
        for (let x = 0; x < this.mazeW; x++) {
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
      const c = this._cellCenter(cx, cz);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(c.x, 1.1, c.z);
      const light = new THREE.PointLight(0xffcc55, 0.8, 4, 2);
      mesh.add(light);
      scene.add(mesh);
      return { mesh, collected: false };
    });
  }

  _buildExitDoor(scene, exitCell) {
    const c = this._cellCenter(...exitCell);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3222, emissive: 0x1a1608, emissiveIntensity: 0.2 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, WALL_H - 0.4, 0.25), mat);
    door.position.set(c.x, (WALL_H - 0.4) / 2, c.z);
    scene.add(door);
    this.doorMat = mat;
    this.doorPos = c;
  }

  _buildEntity(scene, startCell, exitCell, safeCells) {
    const dist = bfsDistances(this.maze, this.mazeW, this.mazeH, ...startCell);
    const candidates = [];
    for (let z = 0; z < this.mazeH; z++) {
      for (let x = 0; x < this.mazeW; x++) {
        const d = dist[z][x];
        if (d > 4 && !safeCells.some(([sx, sz]) => sx === x && sz === z) && !(x === exitCell[0] && z === exitCell[1])) {
          candidates.push([x, z]);
        }
      }
    }
    const spawnCell = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : exitCell;

    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.42, 1.6, 10),
      new THREE.MeshStandardMaterial({ color: 0x0d0a06, roughness: 1 })
    );
    body.position.y = 0.8;
    group.add(body);
    const face = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.faceTex, transparent: true }));
    face.scale.set(0.62, 0.62, 0.62);
    face.position.y = 1.55;
    group.add(face);
    const eyeLight = new THREE.PointLight(0x3dff8a, 1.2, 5, 2);
    eyeLight.position.y = 1.5;
    group.add(eyeLight);
    scene.add(group);

    const pos = this._cellCenter(...spawnCell);
    this.entity = {
      group,
      pos: new THREE.Vector3(pos.x, 0, pos.z),
      cell: spawnCell,
      state: "patrol",
      path: [],
      patrolTarget: null,
      pathTimer: 0,
      lastSeenTime: -Infinity,
      speedBase: { patrol: 1.5 + this.level * 0.12, chase: 3.9 + this.level * 0.25 },
      detectRange: 8 + this.level * 1.2,
    };
    group.position.set(pos.x, 0, pos.z);
  }

  // -------------------------------------------------------------- input
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
      this.yaw -= e.movementX * 0.0035;
      this.pitch -= e.movementY * 0.0035;
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
    this.resize();
    this._loop();
  }

  _moveKeys() {
    let fwd = 0, strafe = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fwd += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fwd -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) strafe += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) strafe -= 1;
    fwd = Math.max(-1, Math.min(1, fwd + this.touchMove.fwd));
    strafe = Math.max(-1, Math.min(1, strafe + this.touchMove.strafe));
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

  _cellOf(x, z) {
    return [Math.round(x / CELL + (this.mazeW - 1) / 2), Math.round(z / CELL + (this.mazeH - 1) / 2)];
  }

  // -------------------------------------------------------------- update
  _update(dt) {
    const { fwd, strafe } = this._moveKeys();
    const canSprint = this.sprinting && this.stamina > 0 && (fwd !== 0 || strafe !== 0);
    if (canSprint) this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
    else this.stamina = Math.min(100, this.stamina + STAMINA_REGEN * dt);
    const speed = BASE_SPEED * (canSprint ? SPRINT_MULT : 1);

    if (fwd !== 0 || strafe !== 0) {
      const dirX = -Math.sin(this.yaw), dirZ = -Math.cos(this.yaw);
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

    const [cx, cz] = this._cellOf(this.playerPos.x, this.playerPos.z);
    this.visited.add(`${cx},${cz}`);
    this.currentCell = [cx, cz];

    this.hiding = (this.keys.has("KeyE") || this.touchHiding) && this.safeCells.some(([sx, sz]) => sx === cx && sz === cz);

    const t = performance.now() * 0.001;
    for (const l of this.lights) {
      let flick = 0.92 + 0.08 * Math.sin(t * 6 + l.phase);
      if (t > l.flickerAt) {
        flick *= Math.random() < (0.06 + this.flickerBoost) ? 0.15 : 1;
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
        this.sound.pickup();
        if (this.collected >= FRAGMENT_TOTAL) this._unlockExit();
      }
    }

    if (this.exitUnlocked) {
      const distDoor = Math.hypot(this.playerPos.x - this.doorPos.x, this.playerPos.z - this.doorPos.z);
      if (distDoor < 1.4) this._reachExit();
    }

    this._updateEntity(dt, t);
    this.sound.tick(dt, {
      moving: (fwd !== 0 || strafe !== 0) && !this.hiding,
      sprinting: canSprint,
      entityState: this.entity ? this.entity.state : "patrol",
    });
    this._updateHud();
  }

  _unlockExit() {
    this.exitUnlocked = true;
    this.doorMat.color.set(0x4dff73);
    this.doorMat.emissive.set(0x2fd45c);
    this.doorMat.emissiveIntensity = 1.2;
  }

  _reachExit() {
    if (this.level >= MAX_LEVEL) this._finish();
    else this._advanceLevel();
  }

  _advanceLevel() {
    this.level++;
    this.sound.levelAdvance();
    this._buildScene(this.level);
    if (this.callbacks.onLevelChange) this.callbacks.onLevelChange(this.level, this._levelLabel());
  }

  _levelLabel() {
    const name = LEVEL_NAMES[this.level] || `deeper still (${this.level})`;
    return `Level ${this.level} — ${name}`;
  }

  _reportRun(levelsCleared, escaped, timeSeconds) {
    const score = levelsCleared * 100000 + (escaped ? Math.max(0, 100000 - Math.floor(timeSeconds * 10)) : 0);
    try {
      if (window.TrollLeaderboard) {
        window.TrollLeaderboard.record("grin-halls", { score, levelsCleared, escaped, timeSeconds });
      }
    } catch (_) {}
  }

  _finish() {
    this.finished = true;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    const seconds = (performance.now() - this.startTime) / 1000;
    this.sound.escapeFanfare();
    this._reportRun(MAX_LEVEL + 1, true, seconds);
    if (this.callbacks.onComplete) this.callbacks.onComplete(seconds.toFixed(1));
  }

  _caught() {
    if (this.caught || this.finished) return;
    this.caught = true;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.sound.caughtBuzz();
    this._reportRun(this.level, false, null);
    if (this.callbacks.onCaught) this.callbacks.onCaught();
  }

  retryLevel() {
    this._buildScene(this.level);
  }

  // ----------------------------------------------------------- entity AI
  _hasLineOfSight(fromPos, fromH, toPos, toH) {
    const from = new THREE.Vector3(fromPos.x, fromH, fromPos.z);
    const to = new THREE.Vector3(toPos.x, toH, toPos.z);
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.001) return true;
    dir.normalize();
    const raycaster = new THREE.Raycaster(from, dir, 0, dist - 0.15);
    const hits = raycaster.intersectObjects(this.wallMeshes, false);
    return hits.length === 0;
  }

  _pickPatrolTarget() {
    const candidates = [];
    for (let z = 0; z < this.mazeH; z++) {
      for (let x = 0; x < this.mazeW; x++) candidates.push([x, z]);
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  _updateEntity(dt, t) {
    const e = this.entity;
    if (!e) return;

    if (!this.hiding) {
      const distToPlayer = e.pos.distanceTo(this.playerPos);
      if (distToPlayer < e.detectRange && this._hasLineOfSight(e.pos, ENTITY_EYE_H, this.playerPos, PLAYER_EYE_H)) {
        e.state = "chase";
        e.lastSeenTime = t;
        e.lastSeenCell = this.currentCell;
      }
    }

    if (e.state === "chase" && t - e.lastSeenTime > ENTITY_LOSE_TIMEOUT) {
      e.state = "patrol";
      e.patrolTarget = e.lastSeenCell || null;
      e.path = [];
    }

    e.pathTimer -= dt;
    if (e.pathTimer <= 0) {
      e.pathTimer = PATH_RECOMPUTE_INTERVAL;
      let targetCell = null;
      if (e.state === "chase") targetCell = this.currentCell;
      else {
        if (!e.patrolTarget || (e.patrolTarget[0] === e.cell[0] && e.patrolTarget[1] === e.cell[1])) {
          e.patrolTarget = this._pickPatrolTarget();
        }
        targetCell = e.patrolTarget;
      }
      if (targetCell) e.path = bfsPath(this.maze, this.mazeW, this.mazeH, e.cell, targetCell);
    }

    const speed = e.state === "chase" ? e.speedBase.chase : e.speedBase.patrol;
    if (e.path.length) {
      const next = e.path[0];
      const target = this._cellCenter(...next);
      const dx = target.x - e.pos.x, dz = target.z - e.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.15) {
        e.cell = next;
        e.path.shift();
      } else {
        e.pos.x += (dx / dist) * speed * dt;
        e.pos.z += (dz / dist) * speed * dt;
      }
    }
    e.group.position.set(e.pos.x, 0, e.pos.z);
    e.group.rotation.y = Math.atan2(this.playerPos.x - e.pos.x, this.playerPos.z - e.pos.z);

    if (e.state === "chase" && !this.hiding && e.pos.distanceTo(this.playerPos) < ENTITY_CATCH_DIST) {
      this._caught();
    }
  }

  // -------------------------------------------------------------- hud
  _updateHud() {
    this.hud.fragmentCount.textContent = `${this.collected}/${FRAGMENT_TOTAL}`;
    this.hud.staminaFill.style.transform = `scaleX(${this.stamina / 100})`;
    this.hud.hidingChip.hidden = !this.hiding;
    if (this.entity) {
      const dist = this.entity.pos.distanceTo(this.playerPos);
      const danger = this.entity.state === "chase" && !this.hiding
        ? Math.max(0, Math.min(1, 1 - (dist - ENTITY_CATCH_DIST) / 9))
        : 0;
      this.hud.dangerVignette.style.opacity = danger.toFixed(2);
    }
    this._drawMinimap();
  }

  _drawMinimap() {
    const ctx = this.hud.minimap.ctx;
    const size = this.hud.minimap.canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#12100a";
    ctx.fillRect(0, 0, size, size);
    const cellPx = size / this.mazeW;
    ctx.save();
    for (let z = 0; z < this.mazeH; z++) {
      for (let x = 0; x < this.mazeW; x++) {
        if (!this.visited.has(`${x},${z}`)) continue;
        ctx.fillStyle = "rgba(216,195,119,0.35)";
        ctx.fillRect(x * cellPx, z * cellPx, cellPx, cellPx);
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    for (let z = 0; z < this.mazeH; z++) {
      for (let x = 0; x < this.mazeW; x++) {
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
    if (this.entity && this.visited.has(`${this.entity.cell[0]},${this.entity.cell[1]}`)) {
      const [enx, enz] = this.entity.cell;
      ctx.fillStyle = this.entity.state === "chase" ? "#ff5a5a" : "rgba(255,90,90,0.5)";
      ctx.beginPath();
      ctx.arc(enx * cellPx + cellPx / 2, enz * cellPx + cellPx / 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    const [pcx, pcz] = this.currentCell || [0, 0];
    const px = pcx * cellPx + cellPx / 2, pz = pcz * cellPx + cellPx / 2;
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(this.yaw);
    ctx.fillStyle = "#6ff2ef";
    ctx.beginPath();
    ctx.moveTo(0, -5); ctx.lineTo(3.5, 4); ctx.lineTo(-3.5, 4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _loop() {
    if (this._stopped) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.finished && !this.caught) this._update(dt);
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
  const caughtEl = document.getElementById("gh-caught");
  const pauseHintEl = document.getElementById("gh-pause-hint");
  const canvas = document.getElementById("gh-canvas");
  const minimapCanvas = document.getElementById("gh-minimap");
  const levelToast = document.getElementById("gh-level-toast");
  const levelChip = document.getElementById("gh-hud-level");

  const hud = {
    fragmentCount: document.getElementById("gh-fragment-count"),
    staminaFill: document.getElementById("gh-stamina-fill"),
    hidingChip: document.getElementById("gh-hud-hiding"),
    dangerVignette: document.getElementById("gh-danger-vignette"),
    minimap: { canvas: minimapCanvas, ctx: minimapCanvas.getContext("2d") },
  };

  let game = null;
  let toastTimer = null;

  function showLevelToast(text) {
    levelToast.textContent = text;
    levelToast.hidden = false;
    requestAnimationFrame(() => levelToast.classList.add("is-visible"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      levelToast.classList.remove("is-visible");
      setTimeout(() => { levelToast.hidden = true; }, 500);
    }, 2200);
  }

  function openHowto() { howtoEl.hidden = false; }
  function closeHowto() { howtoEl.hidden = true; }
  document.getElementById("gh-howto-btn").addEventListener("click", openHowto);
  document.getElementById("gh-hud-help-btn").addEventListener("click", openHowto);
  document.getElementById("gh-howto-close").addEventListener("click", closeHowto);

  function launchGame() {
    titleEl.hidden = true;
    viewportEl.hidden = false;
    if (!game) {
      game = new GrinHalls(canvas, hud, {
        onComplete: (seconds) => {
          document.getElementById("gh-complete-title").textContent = "You escaped the halls.";
          document.getElementById("gh-complete-body").textContent = `All ${MAX_LEVEL + 1} levels cleared. The grin doesn't follow you out.`;
          document.getElementById("gh-complete-time").textContent = `Time: ${seconds}s`;
          completeEl.hidden = false;
        },
        onCaught: () => { caughtEl.hidden = false; },
        onLevelChange: (level, label) => {
          levelChip.textContent = label;
          showLevelToast(label);
        },
      });
      levelChip.textContent = game._levelLabel();
      game.start();
      window.addEventListener("resize", () => game.resize());
    }
    game.sound.unlock(); // must happen on a user gesture — this click is one
    canvas.requestPointerLock();
  }

  document.getElementById("gh-start-btn").addEventListener("click", launchGame);
  canvas.addEventListener("click", () => {
    if (!viewportEl.hidden && game && !game.caught && !game.finished) canvas.requestPointerLock();
  });

  const muteBtn = document.getElementById("gh-hud-mute-btn");
  let muted = false;
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    if (game) game.sound.setMuted(muted);
    muteBtn.textContent = muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-pressed", String(muted));
  });

  const radioBtn = document.getElementById("gh-hud-radio-btn");
  const radioAudio = document.getElementById("gh-radio-audio");
  if (radioBtn && radioAudio) {
    radioAudio.volume = 0.5;
    radioBtn.addEventListener("click", () => {
      if (radioAudio.paused) {
        radioAudio.play().catch(() => {
          radioBtn.title = "Drop an MP3 at assets/games/grin-halls/audio/radio-track.mp3 to enable the radio.";
        });
      } else {
        radioAudio.pause();
      }
    });
    radioAudio.addEventListener("play", () => {
      radioBtn.textContent = "📻";
      radioBtn.classList.add("is-playing");
      radioBtn.setAttribute("aria-pressed", "true");
    });
    radioAudio.addEventListener("pause", () => {
      radioBtn.classList.remove("is-playing");
      radioBtn.setAttribute("aria-pressed", "false");
    });
  }

  document.addEventListener("pointerlockchange", () => {
    const active = document.pointerLockElement === canvas;
    pauseHintEl.hidden = active || viewportEl.hidden || (game && (game.caught || game.finished));
  });

  // ---- touch controls: virtual joystick (move) + drag-to-look + hide button.
  // Pointer lock doesn't apply on touch, so look is a raw drag delta instead.
  const joystick = document.getElementById("gh-touch-joystick");
  const joystickKnob = document.getElementById("gh-touch-joystick-knob");
  const lookZone = document.getElementById("gh-touch-look-zone");
  const hideBtn = document.getElementById("gh-touch-hide-btn");
  const JOY_RADIUS = 50;
  const LOOK_SENSITIVITY = 0.006;

  if (joystick && lookZone && hideBtn) {
    let joyTouchId = null, joyOriginX = 0, joyOriginY = 0;
    joystick.addEventListener("touchstart", (e) => {
      if (joyTouchId !== null) return;
      const t = e.changedTouches[0];
      joyTouchId = t.identifier;
      const r = joystick.getBoundingClientRect();
      joyOriginX = r.left + r.width / 2;
      joyOriginY = r.top + r.height / 2;
      e.preventDefault();
    }, { passive: false });
    joystick.addEventListener("touchmove", (e) => {
      const t = [...e.changedTouches].find((t) => t.identifier === joyTouchId);
      if (!t || !game) return;
      let dx = t.clientX - joyOriginX, dy = t.clientY - joyOriginY;
      const dist = Math.min(JOY_RADIUS, Math.hypot(dx, dy)) || 0;
      const angle = Math.atan2(dy, dx);
      dx = Math.cos(angle) * dist; dy = Math.sin(angle) * dist;
      joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      game.touchMove.strafe = dx / JOY_RADIUS;
      game.touchMove.fwd = -dy / JOY_RADIUS;
      e.preventDefault();
    }, { passive: false });
    const releaseJoystick = (e) => {
      if (![...e.changedTouches].some((t) => t.identifier === joyTouchId)) return;
      joyTouchId = null;
      joystickKnob.style.transform = "translate(0, 0)";
      if (game) { game.touchMove.fwd = 0; game.touchMove.strafe = 0; }
    };
    joystick.addEventListener("touchend", releaseJoystick);
    joystick.addEventListener("touchcancel", releaseJoystick);

    let lookTouchId = null, lookLastX = 0, lookLastY = 0;
    lookZone.addEventListener("touchstart", (e) => {
      if (lookTouchId !== null) return;
      const t = e.changedTouches[0];
      lookTouchId = t.identifier;
      lookLastX = t.clientX; lookLastY = t.clientY;
      e.preventDefault();
    }, { passive: false });
    lookZone.addEventListener("touchmove", (e) => {
      const t = [...e.changedTouches].find((t) => t.identifier === lookTouchId);
      if (!t || !game) return;
      const dx = t.clientX - lookLastX, dy = t.clientY - lookLastY;
      lookLastX = t.clientX; lookLastY = t.clientY;
      game.yaw -= dx * LOOK_SENSITIVITY;
      game.pitch = Math.max(-1.2, Math.min(1.2, game.pitch - dy * LOOK_SENSITIVITY));
      e.preventDefault();
    }, { passive: false });
    const releaseLook = (e) => {
      if ([...e.changedTouches].some((t) => t.identifier === lookTouchId)) lookTouchId = null;
    };
    lookZone.addEventListener("touchend", releaseLook);
    lookZone.addEventListener("touchcancel", releaseLook);

    hideBtn.addEventListener("touchstart", (e) => {
      if (game) game.touchHiding = true;
      hideBtn.classList.add("is-active");
      e.preventDefault();
    }, { passive: false });
    const releaseHide = () => {
      if (game) game.touchHiding = false;
      hideBtn.classList.remove("is-active");
    };
    hideBtn.addEventListener("touchend", releaseHide);
    hideBtn.addEventListener("touchcancel", releaseHide);
  }

  document.getElementById("gh-caught-retry-btn").addEventListener("click", () => {
    caughtEl.hidden = true;
    game.retryLevel();
    canvas.requestPointerLock();
  });

  document.getElementById("gh-replay-btn").addEventListener("click", () => {
    window.location.reload();
  });
});
