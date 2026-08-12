/* Papa Troll's Pizzeria — Kitchen3D (game.js integration).
   One persistent Three.js kitchen the player walks around in: order
   counter, build table, oven, cutting table are physical locations in a
   single room, not separate DOM sections. game.js talks to this module
   only through window.TrollKitchen3D and falls back to the existing 2D
   DOM game when `ok` is false (no WebGL) or `?flat=1`.
   Design doc: docs/TROLL-PIZZERIA-3D.md

   This module owns ZERO game state — no tickets, no scoring, no lobby
   roster, no sweep-angle ticking. It is a renderer + input source, the
   same boundary pizza3d.js always had: game.js pushes real state in via
   sync()/setSlot()/lobby.sync(), ticks its own sweep angle and calls
   updateSweep() every frame exactly like it did with the old Pizza Cam,
   and reads player input back out via registered handlers (onDockChange,
   build paint/place, grin resolve). Phases 1-5 (docs/TROLL-PIZZERIA-3D.md)
   built and proved this engine against demo data; game.js now drives it
   for real, the same way it always drove pizza3d.js's single pie. */
import * as THREE from "three";
import { createPie } from "./pieFactory.js";

const EYE_HEIGHT = 1.6;
const PLAYER_R = 0.35;          // collision radius, circle-vs-AABB
const MOVE_SPEED = 3.2;         // units/sec
const LOOK_SENS = 0.0022;       // radians per pointer-lock movement px
const TOUCH_LOOK_SENS = 0.0055;
const DOCK_TWEEN_MS = 420;
const PITCH_LIMIT = Math.PI / 2 - 0.08;
const BUILD_PIE_SCALE = 0.42;
// 6, not 5: matches game.js's max ovenSlotsCount() once the "6th oven
// slot" upgrade is bought. The 6th marker just sits empty/unused until
// then, same as any other empty slot.
const OVEN_SLOTS = 6;
const OVEN_PIE_SCALE = 0.14;
const CUT_PIE_SCALE = 0.42;
const GRIN_HUNT_VISIBLE_MS = 2600;

// Room: back wall (z = -ROOM_BACK) holds the four stations in a row;
// open floor from there to the front wall gives room to walk. Small on
// purpose — every station within ~1-2s walk of every other (design doc
// "pace" risk) so free movement doesn't slow the core loop down.
const ROOM_HALF_W = 5.2;
const ROOM_BACK = 3.4;
const ROOM_FRONT = 3.4;
const WALL_T = 0.3;

const STATIONS = [
  { id: "order", name: "Order counter", x: -3.6, color: 0x5856d6 },
  { id: "build", name: "Build table", x: -1.2, color: 0xcf3b28 },
  { id: "bake", name: "Oven", x: 1.2, color: 0xe8590c },
  { id: "cut", name: "Cutting table", x: 3.6, color: 0x4d7ea8 },
].map(s => ({
  ...s, z: -ROOM_BACK + 0.9,                 // furniture footprint center
  triggerX: s.x, triggerZ: -ROOM_BACK + 2.0, // stand-in-front-of point
  triggerR: 1.4,
  // Standing back far enough that the whole pie/counter is in view, not
  // a close-up of the crust — comparable to a person's natural distance
  // from a counter they're working at.
  dock: { x: s.x, y: EYE_HEIGHT, z: -ROOM_BACK + 1.9, lookAt: { x: s.x, y: 0.85, z: -ROOM_BACK + 0.9 } },
}));

const K3D = { ok: false, _mountedIn: null };

let renderer, scene, camera, clock;
let rafId = 0;
let resizeObs = null;
let container = null;

// yaw 0 faces -z (three.js default camera forward), which is where the
// stations sit — spawning at yaw 0 means "walk forward" walks into the room.
const player = { x: 0, z: 2.2, yaw: 0, pitch: 0 };
const keys = new Set();
let pointerLocked = false;
let joystick = { active: false, id: null, cx: 0, cy: 0, dx: 0, dz: 0 };
let lookTouch = { active: false, id: null, lastX: 0, lastY: 0 };

let nearStation = null;
let docked = null;              // station id, or null when free-walking
let dockAnim = null;            // { start, from:{pos,quat}, to:{pos,quat}, ms }
let freeCamPos = { x: 0, y: EYE_HEIGHT, z: 2.2 }; // camera pose remembered across dock/undock
let freeCamQuat = new THREE.Quaternion();

/* Registered by game.js at boot — see K3D.setHandlers below. */
const handlers = {
  onDockChange: () => {},
  onBuildPaint: () => {},
  onBuildPlace: () => {},
  onGrinResolve: () => {},
};

/* ------------------------- build table + oven rack ---------------------- */
let buildPie = null, cutPie = null;
let armedTool = null;           // "sauce" | "cheese" | a topping id | null — input routing only
let painting = false;
const ovenSlots = [];           // { marker, x, y, z, pie: pieInstance|null, fireLight, firing }
const raycaster = new THREE.Raycaster();

/* -------------------------- lobby (billboards) --------------------------- */
// Camera-facing sprites. Real customers use the same PixelLab PNGs the 2D
// game's order counter always used (cust.sprite, e.g. "char-trollio.png");
// anything without one (the Grin Hunt trollface) falls back to an emoji
// drawn onto a canvas texture. THREE.TextureLoader paints in place once the
// PNG decodes — no manual swap needed, same non-blocking pattern as the
// pixel-art room textures (loadPixelTexture).
const CHAR_ART = "assets/games/troll-pizzeria/art/";
const charTexCache = {};
function characterTexture(file) {
  if (charTexCache[file]) return charTexCache[file];
  const tex = textureLoader.load(CHAR_ART + file);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  charTexCache[file] = tex;
  return tex;
}
function makeBillboardTexture(emoji) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  ctx.font = "88px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 64, 70);
  return new THREE.CanvasTexture(c);
}
const billboardTexCache = {};
function billboardTexture(emoji) {
  return billboardTexCache[emoji] || (billboardTexCache[emoji] = makeBillboardTexture(emoji));
}
function customerTexture(cust) {
  return cust.sprite ? characterTexture(cust.sprite) : billboardTexture(cust.emoji || "😏");
}

let lobby = [];                 // { cust, sprite, labelEl }
let lobbyGroup = null;

function makeCustomerEntry(cust, i) {
  const order = STATIONS.find(s => s.id === "order");
  const mat = new THREE.SpriteMaterial({ map: customerTexture(cust), transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.7, 0.7, 1);
  sprite.position.set(order.x - 0.5 + i * 0.5, 1.0, order.triggerZ + 0.3 + i * 0.55);
  lobbyGroup.add(sprite);
  const labelEl = document.createElement("div");
  labelEl.className = "k3d-name-label";
  labelEl.textContent = cust.name || "";
  if (container) container.appendChild(labelEl);
  return { cust, sprite, labelEl };
}

/* ------------------------- Grin Hunt (v3 parity) -------------------------- */
// A hidden grin appears somewhere reachable in the room; catching it (a
// crosshair click while it's up, free-walk only) reports true, an
// un-caught expiry reports false — game.js decides what that means
// (troll event fired vs cancelled + score bonus), same as the 2D DOM
// grin button always did.
let grinHunt = null;            // { sprite, until }

function spawnGrinHunt() {
  if (grinHunt) return;
  const mat = new THREE.SpriteMaterial({ map: billboardTexture("😏") });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.4, 0.4, 1);
  const x = (Math.random() - 0.5) * ROOM_HALF_W * 1.6;
  const z = -ROOM_BACK + 1.2 + Math.random() * (ROOM_FRONT + ROOM_BACK - 2.0);
  sprite.position.set(x, 0.9 + Math.random() * 0.8, z);
  scene.add(sprite);
  grinHunt = { sprite, until: performance.now() + GRIN_HUNT_VISIBLE_MS };
}

function resolveGrinHunt(caught) {
  if (!grinHunt) return;
  scene.remove(grinHunt.sprite);
  grinHunt = null;
  handlers.onGrinResolve(caught);
}

function clearGrinHunt() {
  if (!grinHunt) return;
  scene.remove(grinHunt.sprite);
  grinHunt = null;
}

/* --------------------------- collision boxes -------------------------- */
// Static AABBs: 4 walls + 4 station footprints. Small fixed set, checked
// every frame — cheap, no spatial index needed for a room this size.
// x half-width matches half the station center spacing (2.4) exactly, so
// adjacent footprints sit edge-to-edge with zero gap — one continuous
// counter, not four separate boxes with a too-narrow-to-walk-through slot
// between them (the player's 0.7-wide collision circle wouldn't fit).
const STATION_HALF = { x: 1.2, z: 0.45 };
function stationAABB(s) {
  return { minX: s.x - STATION_HALF.x, maxX: s.x + STATION_HALF.x, minZ: s.z - STATION_HALF.z, maxZ: s.z + STATION_HALF.z };
}
const WALL_BOXES = [
  { minX: -ROOM_HALF_W - WALL_T, maxX: ROOM_HALF_W + WALL_T, minZ: -ROOM_BACK - WALL_T, maxZ: -ROOM_BACK }, // back
  { minX: -ROOM_HALF_W - WALL_T, maxX: ROOM_HALF_W + WALL_T, minZ: ROOM_FRONT, maxZ: ROOM_FRONT + WALL_T }, // front
  { minX: -ROOM_HALF_W - WALL_T, maxX: -ROOM_HALF_W, minZ: -ROOM_BACK - WALL_T, maxZ: ROOM_FRONT + WALL_T }, // left
  { minX: ROOM_HALF_W, maxX: ROOM_HALF_W + WALL_T, minZ: -ROOM_BACK - WALL_T, maxZ: ROOM_FRONT + WALL_T },  // right
];
function collidesAt(x, z, box) {
  const cx = Math.max(box.minX, Math.min(x, box.maxX));
  const cz = Math.max(box.minZ, Math.min(z, box.maxZ));
  return Math.hypot(x - cx, z - cz) < PLAYER_R;
}
function blocked(x, z) {
  for (const s of STATIONS) if (collidesAt(x, z, stationAABB(s))) return true;
  for (const w of WALL_BOXES) if (collidesAt(x, z, w)) return true;
  return false;
}

/* ------------------------------ scene ------------------------------- */

const flat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

const ART3D = "assets/games/troll-pizzeria/art3d/";
const textureLoader = new THREE.TextureLoader();

/* Pixel-art textures: nearest filtering keeps them crisp instead of
   blurring against the low-poly pie's smooth look — the game's existing
   2D sprites use the same "image-rendering: pixelated" idea, just done
   here at the material level since these are 3D-mapped, not <img>s. */
function loadPixelTexture(file, repeatX, repeatY) {
  const tex = textureLoader.load(ART3D + file);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeatX || repeatY) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX || 1, repeatY || 1);
  }
  return tex;
}

function buildRoom() {
  const floorTex = loadPixelTexture("floor.png", (ROOM_HALF_W * 2) / 2.2, (ROOM_BACK + ROOM_FRONT) / 2.2);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_HALF_W * 2, ROOM_BACK + ROOM_FRONT),
    new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (ROOM_FRONT - ROOM_BACK) / 2);
  scene.add(floor);

  const wallH = 2.6;
  const wallTex = loadPixelTexture("wall.png", (ROOM_HALF_W * 2) / 3, wallH / 2.6);
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
  const sideWallTex = loadPixelTexture("wall.png", (ROOM_BACK + ROOM_FRONT) / 3, wallH / 2.6);
  const sideWallMat = new THREE.MeshLambertMaterial({ map: sideWallTex });
  const back = new THREE.Mesh(new THREE.BoxGeometry(ROOM_HALF_W * 2 + WALL_T * 2, wallH, WALL_T), wallMat);
  back.position.set(0, wallH / 2, -ROOM_BACK - WALL_T / 2);
  scene.add(back);
  const left = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, wallH, ROOM_BACK + ROOM_FRONT + WALL_T * 2), sideWallMat);
  left.position.set(-ROOM_HALF_W - WALL_T / 2, wallH / 2, (ROOM_FRONT - ROOM_BACK) / 2);
  scene.add(left);
  const right = left.clone();
  right.position.x = ROOM_HALF_W + WALL_T / 2;
  scene.add(right);

  const counterTex = loadPixelTexture("counter.png", STATION_HALF.x * 2 / 1.4, 1);
  const ovenTex = loadPixelTexture("oven.png");
  for (const s of STATIONS) {
    const sideMat = flat(s.color);
    const frontMat = new THREE.MeshLambertMaterial({ map: s.id === "bake" ? ovenTex : counterTex });
    // BoxGeometry's default face-group order is [+x,-x,+y,-y,+z,-z]; index 4
    // (+z) faces the player, since stations sit at -z and the trigger point
    // to stand at is further +z toward the room's open floor.
    const materials = [sideMat, sideMat, sideMat, sideMat, frontMat, sideMat];
    const furn = new THREE.Mesh(new THREE.BoxGeometry(STATION_HALF.x * 2, 0.95, STATION_HALF.z * 2), materials);
    furn.position.set(s.x, 0.475, s.z);
    scene.add(furn);
  }
}

function setupBuildAndOven() {
  const build = STATIONS.find(s => s.id === "build");
  buildPie = createPie({ interactive: true });
  buildPie.root.scale.setScalar(BUILD_PIE_SCALE);
  buildPie.root.position.set(build.x, 0.97, build.z + 0.18);
  buildPie.root.visible = false;
  scene.add(buildPie.root);

  const bake = STATIONS.find(s => s.id === "bake");
  const span = STATION_HALF.x * 2 * 0.9;
  for (let i = 0; i < OVEN_SLOTS; i++) {
    const x = bake.x - span / 2 + (span / (OVEN_SLOTS - 1)) * i;
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.16, 20),
      new THREE.MeshBasicMaterial({ color: 0x2a1808, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(x, 0.965, bake.z);
    scene.add(marker);
    const fireLight = new THREE.PointLight(0xff6a1a, 0, 1.4);
    fireLight.position.set(x, 1.15, bake.z);
    scene.add(fireLight);
    ovenSlots.push({ marker, x, y: 0.97, z: bake.z, pie: null, fireLight, firing: false });
  }

  const cut = STATIONS.find(s => s.id === "cut");
  cutPie = createPie({ interactive: true });
  cutPie.root.scale.setScalar(CUT_PIE_SCALE);
  cutPie.root.position.set(cut.x, 0.97, cut.z + 0.18);
  cutPie.root.visible = false;
  scene.add(cutPie.root);
}

function initScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setClearColor(0x1a0f08, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "k3d-canvas";

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
  camera.position.set(player.x, EYE_HEIGHT, player.z);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sun = new THREE.DirectionalLight(0xfff1dc, 0.9);
  sun.position.set(3, 6, 3);
  scene.add(sun);

  buildRoom();
  setupBuildAndOven();
  lobbyGroup = new THREE.Group();
  scene.add(lobbyGroup);
  clock = new THREE.Clock();
}

/* ------------------------------ input --------------------------------- */

function setupInput(el) {
  el.tabIndex = 0;
  el.addEventListener("click", () => {
    if (!pointerLocked) el.requestPointerLock?.();
  });
  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === el;
    updateLookHint();
  });
  document.addEventListener("mousemove", (ev) => {
    if (!pointerLocked) return;
    player.yaw -= ev.movementX * LOOK_SENS;
    player.pitch = clampPitch(player.pitch - ev.movementY * LOOK_SENS);
  });
  window.addEventListener("keydown", (ev) => keys.add(ev.key.toLowerCase()));
  window.addEventListener("keyup", (ev) => keys.delete(ev.key.toLowerCase()));
  window.addEventListener("keydown", (ev) => {
    if (ev.key.toLowerCase() === "e" || ev.key === " ") { ev.preventDefault(); onInteractPressed(); }
  });

  // touch: left third = movement joystick, rest = look-drag
  el.addEventListener("touchstart", (ev) => {
    for (const t of ev.changedTouches) {
      const isLeft = t.clientX < el.clientWidth * 0.4;
      if (isLeft && !joystick.active) {
        joystick = { active: true, id: t.identifier, cx: t.clientX, cy: t.clientY, dx: 0, dz: 0 };
      } else if (!isLeft && !lookTouch.active) {
        lookTouch = { active: true, id: t.identifier, lastX: t.clientX, lastY: t.clientY };
      }
    }
  }, { passive: true });
  el.addEventListener("touchmove", (ev) => {
    for (const t of ev.changedTouches) {
      if (joystick.active && t.identifier === joystick.id) {
        const dx = t.clientX - joystick.cx, dy = t.clientY - joystick.cy;
        const len = Math.hypot(dx, dy) || 1, cap = Math.min(len, 42) / 42;
        joystick.dx = (dx / len) * cap;
        joystick.dz = (dy / len) * cap;
      } else if (lookTouch.active && t.identifier === lookTouch.id) {
        const dx = t.clientX - lookTouch.lastX, dy = t.clientY - lookTouch.lastY;
        lookTouch.lastX = t.clientX; lookTouch.lastY = t.clientY;
        player.yaw -= dx * TOUCH_LOOK_SENS;
        player.pitch = clampPitch(player.pitch - dy * TOUCH_LOOK_SENS);
      }
    }
  }, { passive: true });
  const endTouch = (ev) => {
    for (const t of ev.changedTouches) {
      if (joystick.active && t.identifier === joystick.id) joystick = { active: false, id: null, cx: 0, cy: 0, dx: 0, dz: 0 };
      if (lookTouch.active && t.identifier === lookTouch.id) lookTouch.active = false;
    }
  };
  el.addEventListener("touchend", endTouch);
  el.addEventListener("touchcancel", endTouch);

  el.addEventListener("pointerdown", (ev) => {
    // Grin Hunt takes priority: a crosshair click (pointer-locked FPS view
    // has no visible cursor, so "click" always means "whatever's dead
    // center") while free-walking and a grin is up.
    if (!docked && pointerLocked && grinHunt) {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hit = raycaster.intersectObject(grinHunt.sprite, false);
      if (hit.length) { resolveGrinHunt(true); return; }
    }
    if (docked !== "build" || !armedTool) return;
    ev.preventDefault();
    const hit = hitBuildPie(ev.clientX, ev.clientY);
    if (!hit) return;
    if (armedTool === "sauce" || armedTool === "cheese") { painting = true; handlers.onBuildPaint(armedTool, hit.x, hit.y); }
    else handlers.onBuildPlace(armedTool, hit.x, hit.y);
  });
  el.addEventListener("pointermove", (ev) => {
    if (!painting) return;
    const hit = hitBuildPie(ev.clientX, ev.clientY);
    if (hit) handlers.onBuildPaint(armedTool, hit.x, hit.y);
  });
  window.addEventListener("pointerup", () => { painting = false; });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopLoop(); else if (K3D._mountedIn) startLoop();
  });
}

function ndcFromClient(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1);
}

function hitBuildPie(clientX, clientY) {
  raycaster.setFromCamera(ndcFromClient(clientX, clientY), camera);
  return buildPie.pointFromRay(raycaster);
}

const clampPitch = (p) => Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p));

function updateLookHint() {
  const hint = container?.querySelector(".k3d-look-hint");
  if (hint) hint.hidden = pointerLocked || docked;
}

/* --------------------------- interact / dock --------------------------- */

function onInteractPressed() {
  if (docked) { undock(); return; }
  if (nearStation) dock(nearStation);
}

function dock(station) {
  docked = station.id;
  const fromQuat = camera.quaternion.clone();
  const toQuat = new THREE.Quaternion();
  const m = new THREE.Matrix4().lookAt(
    new THREE.Vector3(station.dock.x, station.dock.y, station.dock.z),
    new THREE.Vector3(station.dock.lookAt.x, station.dock.lookAt.y, station.dock.lookAt.z),
    new THREE.Vector3(0, 1, 0));
  toQuat.setFromRotationMatrix(m);
  dockAnim = {
    start: performance.now(), ms: DOCK_TWEEN_MS,
    fromPos: camera.position.clone(), toPos: new THREE.Vector3(station.dock.x, station.dock.y, station.dock.z),
    fromQuat, toQuat,
  };
  setPrompt(`Working at ${station.name} — press E to step away`, true);
  updateLookHint();
  handlers.onDockChange(docked);
}

function undock() {
  const fromQuat = camera.quaternion.clone();
  dockAnim = {
    start: performance.now(), ms: DOCK_TWEEN_MS,
    fromPos: camera.position.clone(), toPos: new THREE.Vector3(freeCamPos.x, EYE_HEIGHT, freeCamPos.z),
    fromQuat, toQuat: freeCamQuat.clone(),
  };
  docked = null;
  setPrompt("", false);
  updateLookHint();
  handlers.onDockChange(null);
}

/* Fast travel: the HUD's station tabs / keyboard 1-4 / ticket-rack clicks
   still work exactly like they used to — they just now also move the
   player there physically (short walk skipped, dock tween kept) instead
   of only toggling a DOM class. Free-walking to a station and interacting
   is the other, non-shortcut way to reach the same place. */
function teleportTo(id) {
  const station = STATIONS.find(s => s.id === id);
  if (!station) return false;
  player.x = station.triggerX; player.z = station.triggerZ;
  freeCamPos.x = player.x; freeCamPos.z = player.z;
  dock(station);
  return true;
}

function setPrompt(text, visible) {
  const el = container?.querySelector(".k3d-prompt");
  if (!el) return;
  el.textContent = text;
  el.hidden = !visible && !nearStation;
  if (!text && nearStation) el.textContent = `Interact with ${nearStation.name} — E`;
}

/* -------------------------------- loop --------------------------------- */

function tick(dt) {
  if (!docked) {
    let mx = 0, mz = 0;
    if (keys.has("w") || keys.has("arrowup")) mz -= 1;
    if (keys.has("s") || keys.has("arrowdown")) mz += 1;
    if (keys.has("a") || keys.has("arrowleft")) mx -= 1;
    if (keys.has("d") || keys.has("arrowright")) mx += 1;
    if (joystick.active) { mx += joystick.dx; mz += joystick.dz; }
    const len = Math.hypot(mx, mz);
    if (len > 0.001) {
      mx /= Math.max(len, 1); mz /= Math.max(len, 1);
      const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
      const dirX = -sin * -mz + cos * mx;
      const dirZ = -cos * -mz - sin * mx;
      const step = MOVE_SPEED * dt;
      const nx = player.x + dirX * step;
      if (!blocked(nx, player.z)) player.x = nx;
      const nz = player.z + dirZ * step;
      if (!blocked(player.x, nz)) player.z = nz;
    }

    camera.position.set(player.x, EYE_HEIGHT, player.z);
    const euler = new THREE.Euler(player.pitch, player.yaw, 0, "YXZ");
    camera.quaternion.setFromEuler(euler);
    freeCamPos.x = player.x; freeCamPos.z = player.z;
    freeCamQuat.copy(camera.quaternion);

    // nearest station trigger
    let nearest = null, nearestD = Infinity;
    for (const s of STATIONS) {
      const d = Math.hypot(player.x - s.triggerX, player.z - s.triggerZ);
      if (d < s.triggerR && d < nearestD) { nearest = s; nearestD = d; }
    }
    if (nearest !== nearStation) { nearStation = nearest; setPrompt("", false); }
  } else if (dockAnim) {
    const t = Math.min(1, (performance.now() - dockAnim.start) / dockAnim.ms);
    const e = t * (2 - t); // ease-out
    camera.position.lerpVectors(dockAnim.fromPos, dockAnim.toPos, e);
    camera.quaternion.slerpQuaternions(dockAnim.fromQuat, dockAnim.toQuat, e);
    if (t >= 1) dockAnim = null;
  }

  if (buildPie) buildPie.stepTweens(dt);
  if (cutPie) cutPie.stepTweens(dt);
  for (const slot of ovenSlots) {
    if (slot.pie) slot.pie.stepTweens(dt);
    if (slot.firing) {
      const flicker = 1.1 + Math.sin(performance.now() / 45) * 0.35 + (Math.random() - 0.5) * 0.3;
      slot.fireLight.intensity = Math.max(0, flicker);
    }
  }
  if (grinHunt && performance.now() > grinHunt.until) resolveGrinHunt(false);

  updateLabels();
  renderer.render(scene, camera);
}

function updateLabels() {
  if (!container) return;
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  if (!w || !h) return;
  const v = new THREE.Vector3();
  for (const entry of lobby) {
    entry.sprite.getWorldPosition(v);
    v.y += 0.5;
    v.project(camera);
    if (v.z > 1) { entry.labelEl.hidden = true; continue; }
    entry.labelEl.hidden = false;
    entry.labelEl.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
  }
}

function startLoop() {
  if (rafId) return;
  const step = () => {
    tick(Math.min(0.05, clock.getDelta()));
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
}
function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

/* ------------------------------- public -------------------------------- */

K3D.mount = function (el) {
  if (!K3D.ok) return false;
  container = el;
  if (K3D._mountedIn !== el) {
    el.innerHTML = "";
    el.appendChild(renderer.domElement);
    const prompt = document.createElement("div");
    prompt.className = "k3d-prompt";
    prompt.hidden = true;
    el.appendChild(prompt);
    const hint = document.createElement("div");
    hint.className = "k3d-look-hint";
    hint.textContent = "Click to look around · WASD to walk · E to interact";
    el.appendChild(hint);
    for (const entry of lobby) el.appendChild(entry.labelEl);
    K3D._mountedIn = el;
    setupInput(el);
    if (resizeObs) resizeObs.disconnect();
    resizeObs = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resizeObs.observe(el);
    const w = el.clientWidth || 300, h = el.clientHeight || 300;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  startLoop();
  return true;
};

K3D.unmount = function () {
  if (!K3D._mountedIn) return;
  stopLoop();
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
  if (renderer.domElement.parentElement) renderer.domElement.remove();
  K3D._mountedIn = null;
};

K3D.STATIONS = STATIONS.map(s => ({ id: s.id, name: s.name }));
K3D.getDocked = () => docked;
K3D.teleportTo = teleportTo;

/* game.js registers what happens on player-driven events. Call once at
   boot; any handler you don't pass keeps its no-op default. */
K3D.setHandlers = function (h) { Object.assign(handlers, h); };

/* Pie backends: same shape pizza3d.js's P3D always exposed (mount/
   unmount/isMounted/sync/pointToPie/toppingAt/updateSweep/serveSpin), so
   game.js's existing build/cut station code — which already calls
   p3d().sync(view), p3d().pointToPie(x,y), etc. — works unchanged; only
   what p3d() resolves to changes. "mount/unmount" map to show/hide (the
   pie's world position is fixed; there's no small canvas to attach). */
function makePieBackend(getPie) {
  return {
    mount: () => { getPie().root.visible = true; return true; },
    unmount: () => { getPie().root.visible = false; },
    isMounted: () => getPie().root.visible,
    sync: (view) => getPie().sync(view),
    pointToPie: (clientX, clientY) => {
      raycaster.setFromCamera(ndcFromClient(clientX, clientY), camera);
      return getPie().pointFromRay(raycaster);
    },
    toppingAt: (clientX, clientY) => {
      raycaster.setFromCamera(ndcFromClient(clientX, clientY), camera);
      return getPie().toppingAtRay(raycaster);
    },
    updateSweep: (angleDeg) => getPie().updateSweep(angleDeg),
    serveSpin: (done) => getPie().serveSpin(done),
  };
}
const buildBackend = () => makePieBackend(() => buildPie);
const cutBackend = () => makePieBackend(() => cutPie);
K3D.pieBackend = (stationName) => (stationName === "cut" ? cutBackend() : buildBackend());

K3D.build = {
  setArmedTool: (tool) => { armedTool = tool; },
  getArmedTool: () => armedTool,
};

/* Oven rack: view is the same {sauce,cheese,placed,doneness,cutAngles}
   shape pizza3d.js's P3D.sync always expected. Passing null clears the
   slot (pulled/served). */
K3D.oven = {
  setSlot(i, view) {
    const slot = ovenSlots[i];
    if (!slot) return;
    if (view === null) {
      if (slot.pie) { slot.pie.dispose(); slot.pie = null; }
      slot.firing = false;
      slot.fireLight.intensity = 0;
      return;
    }
    if (!slot.pie) {
      slot.pie = createPie({ interactive: false });
      slot.pie.root.scale.setScalar(OVEN_PIE_SCALE);
      slot.pie.root.position.set(slot.x, slot.y, slot.z);
      scene.add(slot.pie.root);
    }
    slot.pie.sync(view);
  },
  setFire(i, active) {
    const slot = ovenSlots[i];
    if (!slot) return;
    slot.firing = !!active;
    if (!active) slot.fireLight.intensity = 0;
  },
  slotCount: OVEN_SLOTS,
};

/* Lobby: customers = [{uid,name,emoji}, ...] in queue order (front
   first) — pass whatever game.js's own S.lobby currently is. Full
   rebuild each call, same as the DOM version's innerHTML="" + rebuild;
   the list is small (a handful even mid-rush) so this is cheap. */
K3D.lobby = {
  sync(customers) {
    for (const e of lobby) { lobbyGroup.remove(e.sprite); e.labelEl.remove(); }
    lobby = (customers || []).map((c, i) => makeCustomerEntry(c, i));
    if (container) for (const e of lobby) container.appendChild(e.labelEl);
  },
};

/* Grin Hunt (v3 parity): presentation + hit-test only. game.js decides
   what a caught/missed result means (cancel the event + score bonus, or
   let the sabotage land) via the onGrinResolve handler. */
K3D.trollEvent = {
  spawnGrinHunt,
  clearGrinHunt,
  isGrinHuntActive: () => !!grinHunt,
};

/* ------------------------------- boot ---------------------------------- */

try {
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2") || probe.getContext("webgl");
  if (gl) { initScene(); K3D.ok = true; }
} catch (e) {
  console.warn("[kitchen3d] init failed, 2D fallback stays on:", e);
  K3D.ok = false;
}

// debug/smoke-test handle, same pattern as game.js's __pz / pizza3d's P3D
K3D.__debug = {
  getPlayer: () => ({ x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch }),
  setPlayer: (x, z, yaw, pitch) => {
    player.x = x; player.z = z;
    if (yaw !== undefined) player.yaw = yaw;
    if (pitch !== undefined) player.pitch = pitch;
  },
  isBlocked: (x, z) => blocked(x, z),
  getNearStation: () => (nearStation ? nearStation.id : null),
  getDocked: () => docked,
  getStats: () => renderer ? {
    calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
  } : null,
  setKeys: (arr) => { keys.clear(); for (const k of arr) keys.add(k); },
  tick: (dt) => tick(dt),
  interact: () => onInteractPressed(),
  stations: STATIONS,
  paintAtNDC: (ndcX, ndcY, tool) => {
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    return buildPie.pointFromRay(raycaster);
  },
  getOvenSlot: (i) => ({ hasPie: !!ovenSlots[i]?.pie, firing: !!ovenSlots[i]?.firing, fireIntensity: ovenSlots[i]?.fireLight.intensity || 0 }),
  getLobbyCount: () => lobby.length,
  getLobbySprites: () => lobby.map(e => ({
    name: e.cust.name, sprite: e.cust.sprite, pos: e.sprite.position.toArray(),
    visible: e.sprite.visible, mapLoaded: !!(e.sprite.material.map && e.sprite.material.map.image),
    imgW: e.sprite.material.map?.image?.width || 0,
  })),
  isBuildPieVisible: () => buildPie?.root.visible || false,
  isCutPieVisible: () => cutPie?.root.visible || false,
  getGrinPosition: () => (grinHunt ? grinHunt.sprite.position.clone() : null),
  clickCenter: () => {
    if (!grinHunt) return false;
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hit = raycaster.intersectObject(grinHunt.sprite, false);
    if (hit.length) { resolveGrinHunt(true); return true; }
    return false;
  },
  isLoopRunning: () => !!rafId,
  simulateVisibility: (hidden) => {
    Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  },
};

window.TrollKitchen3D = K3D;
window.dispatchEvent(new CustomEvent("kitchen3d:ready", { detail: { ok: K3D.ok } }));
