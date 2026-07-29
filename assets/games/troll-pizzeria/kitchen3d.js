/* Papa Troll's Pizzeria — Kitchen3D (phase 1: scaffold + player movement).
   One persistent Three.js kitchen the player walks around in: order
   counter, build table, oven, cutting table are physical locations in a
   single room, not separate DOM sections. game.js (and, later, pizza3d.js)
   talk to this module only through window.TrollKitchen3D and fall back to
   the existing 2D DOM game when `ok` is false (no WebGL) or `?flat=1`.
   Design doc: docs/TROLL-PIZZERIA-3D.md

   Phase 1 scope: room scaffold, free-walk movement + collision, station
   trigger zones with an Interact prompt that docks the camera into a
   locked working view. No real station gameplay is wired in yet — that's
   phases 2-3. Environment art here is placeholder flat color, replaced in
   phase 5. */
import * as THREE from "three";

const EYE_HEIGHT = 1.6;
const PLAYER_R = 0.35;          // collision radius, circle-vs-AABB
const MOVE_SPEED = 3.2;         // units/sec
const LOOK_SENS = 0.0022;       // radians per pointer-lock movement px
const TOUCH_LOOK_SENS = 0.0055;
const DOCK_TWEEN_MS = 420;
const PITCH_LIMIT = Math.PI / 2 - 0.08;

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
  dock: { x: s.x, y: EYE_HEIGHT * 0.94, z: -ROOM_BACK + 1.35, lookAt: { x: s.x, y: 0.95, z: -ROOM_BACK + 0.9 } },
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

function buildRoom() {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_HALF_W * 2, ROOM_BACK + ROOM_FRONT),
    flat(0xd9c79a));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (ROOM_FRONT - ROOM_BACK) / 2);
  scene.add(floor);

  const wallMat = flat(0xf3e2c0);
  const wallH = 2.6;
  const back = new THREE.Mesh(new THREE.BoxGeometry(ROOM_HALF_W * 2 + WALL_T * 2, wallH, WALL_T), wallMat);
  back.position.set(0, wallH / 2, -ROOM_BACK - WALL_T / 2);
  scene.add(back);
  const left = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, wallH, ROOM_BACK + ROOM_FRONT + WALL_T * 2), wallMat);
  left.position.set(-ROOM_HALF_W - WALL_T / 2, wallH / 2, (ROOM_FRONT - ROOM_BACK) / 2);
  scene.add(left);
  const right = left.clone();
  right.position.x = ROOM_HALF_W + WALL_T / 2;
  scene.add(right);

  for (const s of STATIONS) {
    const furn = new THREE.Mesh(new THREE.BoxGeometry(STATION_HALF.x * 2, 0.95, STATION_HALF.z * 2), flat(s.color));
    furn.position.set(s.x, 0.475, s.z);
    scene.add(furn);
    const label = document.createElement("div");
    label.className = "k3d-station-label";
    label.textContent = s.name;
    s._labelEl = label;
  }
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

  renderer.render(scene, camera);
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
  setPlayer: (x, z) => { player.x = x; player.z = z; },
  isBlocked: (x, z) => blocked(x, z),
  getNearStation: () => (nearStation ? nearStation.id : null),
  getDocked: () => docked,
  setKeys: (arr) => { keys.clear(); for (const k of arr) keys.add(k); },
  tick: (dt) => tick(dt),
  interact: () => onInteractPressed(),
  stations: STATIONS,
};

window.TrollKitchen3D = K3D;
window.dispatchEvent(new CustomEvent("kitchen3d:ready", { detail: { ok: K3D.ok } }));
