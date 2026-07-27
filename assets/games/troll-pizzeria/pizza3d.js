/* Papa Troll's Pizzeria — Pizza Cam (3D pie renderer).
   One shared Three.js canvas that renders the active big pie as smooth
   low-poly, flat-shaded geometry (design: docs/TROLL-PIZZERIA-V2.md).
   game.js stays a plain script: it talks to this module only through
   window.TrollPizza3D and falls back to the DOM pizza when `ok` is false
   (no WebGL, vendored three missing, or ?flat=1). All coordinates that
   cross the boundary are the game's own 0..1 pie coords, so scoring and
   the save format never see the 3D layer. */
import * as THREE from "three";

const PIE_R = 1.0;                 // dough radius in world units
const GAME_TO_WORLD = PIE_R / 0.48; // 0..1 game coords: dough spans 0.02..0.98
const TOPPING_Y = 0.115;

/* Deterministic pseudo-random from a seed — geometry jitter must not
   shimmer between rebuilds, and a topping's tilt must survive re-syncs. */
const dpr = (seed) => {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};
const hashStr = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/* Radial jitter on a CircleGeometry rim (blobby sauce/cheese edges). */
function blobbyCircle(radius, segs, wobble, bump, seedBase) {
  const g = new THREE.CircleGeometry(radius, segs);
  const pos = g.attributes.position;
  for (let i = 1; i < pos.count; i++) {          // vertex 0 is the center
    const x = pos.getX(i), y = pos.getY(i);
    const r = Math.hypot(x, y);
    if (r < 1e-5) continue;
    const k = 1 + (dpr(seedBase + i) - 0.5) * wobble;
    pos.setX(i, (x / r) * r * k);
    pos.setY(i, (y / r) * r * k);
    if (bump) pos.setZ(i, (dpr(seedBase * 3 + i) - 0.5) * bump);
  }
  g.computeVertexNormals();
  g.rotateX(-Math.PI / 2);                       // lie flat, face up
  return g;
}

const flat = (color, extra) => new THREE.MeshLambertMaterial(
  Object.assign({ color, flatShading: true }, extra || {}));

/* Sauce/cheese cover radii per amount — matches the DOM AMOUNT_INSET map
   (inset % of the square container, dough radius = 48%). */
const SAUCE_R = { light: 0.66, normal: 0.77, extra: 0.85 };
const CHEESE_R = { light: 0.58, normal: 0.69, extra: 0.77 };

/* ------------------------- topping geometry ------------------------- */
/* One shared geometry + material per topping type; instances only vary
   by position and a deterministic tilt/scale. Smooth low-poly: chunky
   primitives, flat shading, no textures. */
const TOPPING_DEFS = {
  pepperoni: () => ({ g: new THREE.CylinderGeometry(0.14, 0.15, 0.038, 10), m: flat(0xb23a27) }),
  mushrooms: () => {
    const g = new THREE.SphereGeometry(0.115, 7, 5);
    g.scale(1, 0.52, 0.82);
    return { g, m: flat(0xd9cbc0) };
  },
  olives:    () => ({ g: new THREE.TorusGeometry(0.075, 0.034, 6, 10), m: flat(0x3a3126), rotX: -Math.PI / 2 }),
  peppers:   () => ({ g: new THREE.TorusGeometry(0.115, 0.03, 5, 12, 4.1), m: flat(0x2f9e44), rotX: -Math.PI / 2 }),
  sausage:   () => {
    const g = new THREE.IcosahedronGeometry(0.095, 0);
    g.scale(1, 0.66, 1);
    return { g, m: flat(0x8d5524) };
  },
  onions:    () => ({ g: new THREE.TorusGeometry(0.105, 0.02, 5, 12, 3.6), m: flat(0xe4d3ec), rotX: -Math.PI / 2 }),
  basil:     () => {
    const g = new THREE.CircleGeometry(0.095, 6);
    g.scale(1, 1.55, 1);
    g.rotateX(-Math.PI / 2);
    return { g, m: flat(0x2e8b3e, { side: THREE.DoubleSide }) };
  },
  pineapple: () => ({ g: new THREE.CylinderGeometry(0.105, 0.105, 0.05, 3), m: flat(0xf5c33b) }),
};
const toppingCache = {};
function toppingParts(tid) {
  if (!toppingCache[tid]) {
    const def = TOPPING_DEFS[tid] || TOPPING_DEFS.pepperoni;
    toppingCache[tid] = def();
  }
  return toppingCache[tid];
}

/* ============================ the module ============================ */

const P3D = {
  ok: false,
  _mountedIn: null,
};

let renderer, scene, camera, raycaster, pickPlane;
let doughGroup, sauceMesh, cheeseMesh, toppingGroup, cutGroup, guideGroup;
let sauceMat, cheeseMat, crustMat, doughMat;
let tweens = [];
let rafId = 0;
let prevKeys = [];
let curView = null;
let resizeObs = null;

const CRUST_COLOR = 0xdfae63, DOUGH_COLOR = 0xf2d49b;
const SAUCE_COLOR = 0xc0392b, CHEESE_COLOR = 0xf6cf65;
const CHEESE_BAKED = 0xd68f3c, BURNT = 0x4a3421;

function initScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "pz3d-canvas";

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 30);
  camera.position.set(0, 2.35, 2.55);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
  sun.position.set(2.4, 4, 2.2);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xcfd8ff, 0.4);
  fill.position.set(-3, 2, -1.5);
  scene.add(fill);

  /* fake contact shadow so the pie sits on the DOM table */
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.18, 26),
    new THREE.MeshBasicMaterial({ color: 0x2a1808, transparent: true, opacity: 0.18 }));
  shadow.geometry.rotateX(-Math.PI / 2);
  shadow.position.y = -0.06;
  scene.add(shadow);

  /* dough: base disc + crust ring + inner surface */
  doughGroup = new THREE.Group();
  crustMat = flat(CRUST_COLOR);
  doughMat = flat(DOUGH_COLOR);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.99, 0.09, 26), crustMat);
  base.position.y = 0;
  doughGroup.add(base);
  const crustGeo = new THREE.TorusGeometry(0.93, 0.135, 7, 26);
  const cp = crustGeo.attributes.position;
  for (let i = 0; i < cp.count; i++) {           // hand-made lumpy crust
    const k = 1 + (dpr(i * 1.7) - 0.5) * 0.14;
    cp.setX(i, cp.getX(i) * k);
    cp.setY(i, cp.getY(i) * k);
  }
  crustGeo.computeVertexNormals();
  crustGeo.rotateX(-Math.PI / 2);
  const crust = new THREE.Mesh(crustGeo, crustMat);
  crust.scale.y = 0.62;
  crust.position.y = 0.055;
  doughGroup.add(crust);
  const surface = new THREE.Mesh(blobbyCircle(0.94, 26, 0.02, 0, 7), doughMat);
  surface.position.y = 0.052;
  doughGroup.add(surface);
  scene.add(doughGroup);

  sauceMat = flat(SAUCE_COLOR);
  cheeseMat = flat(CHEESE_COLOR);
  sauceMesh = new THREE.Mesh(blobbyCircle(SAUCE_R.normal, 26, 0.07, 0, 21), sauceMat);
  sauceMesh.position.y = 0.075;
  sauceMesh.visible = false;
  scene.add(sauceMesh);
  cheeseMesh = new THREE.Mesh(blobbyCircle(CHEESE_R.normal, 26, 0.1, 0.05, 33), cheeseMat);
  cheeseMesh.position.y = 0.09;
  cheeseMesh.visible = false;
  scene.add(cheeseMesh);

  toppingGroup = new THREE.Group();
  scene.add(toppingGroup);
  cutGroup = new THREE.Group();
  scene.add(cutGroup);

  /* half-order guide: dashed dark strip across the middle (screen-vertical) */
  guideGroup = new THREE.Group();
  const dashMat = new THREE.MeshBasicMaterial({ color: 0x55351f, transparent: true, opacity: 0.45 });
  for (let i = 0; i < 8; i++) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.006, 0.12), dashMat);
    dash.position.set(0, 0.13, -0.83 + i * 0.237);
    guideGroup.add(dash);
  }
  guideGroup.visible = false;
  scene.add(guideGroup);

  /* invisible picking disc, slightly larger than the dough */
  pickPlane = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 20),
    new THREE.MeshBasicMaterial({ visible: false }));
  pickPlane.geometry.rotateX(-Math.PI / 2);
  pickPlane.position.y = 0.09;
  scene.add(pickPlane);

  raycaster = new THREE.Raycaster();
}

/* ------------------------------ tweens ------------------------------ */

function addTween(dur, apply, done) {
  tweens.push({ t: 0, dur, apply, done });
}
function stepTweens(dt) {
  for (const tw of tweens) {
    tw.t = Math.min(tw.t + dt / tw.dur, 1);
    tw.apply(tw.t);
  }
  tweens = tweens.filter(tw => {
    if (tw.t < 1) return true;
    if (tw.done) tw.done();
    return false;
  });
}

/* ------------------------------- loop ------------------------------- */

let lastT = 0;
function loop(now) {
  rafId = requestAnimationFrame(loop);
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  stepTweens(dt);
  renderer.render(scene, camera);
}
function startLoop() {
  if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(loop); }
}
function stopLoop() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
}

/* ---------------------------- coordinates --------------------------- */

const toWorld = (gx, gy) => ({ x: (gx - 0.5) * GAME_TO_WORLD, z: (gy - 0.5) * GAME_TO_WORLD });
const toGame = (wx, wz) => ({ x: wx / GAME_TO_WORLD + 0.5, y: wz / GAME_TO_WORLD + 0.5 });

function castAt(clientX, clientY, targets) {
  if (!P3D._mountedIn) return [];
  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return [];
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObjects(targets, false);
}

/* ------------------------------- sync ------------------------------- */

function syncCover(mesh, mat, radii, amount, seed, wobble, bump, baseY) {
  if (amount === "none") { mesh.visible = false; mesh.userData.amount = "none"; return; }
  const targetR = radii[amount];
  const prev = mesh.userData.amount || "none";
  mesh.userData.amount = amount;
  if (prev === amount) { mesh.visible = true; return; }
  mesh.visible = true;
  if (prev === "none") {
    /* ladle wipe: reveal by growing thetaLength around the pie */
    addTween(0.38, (t) => {
      if (mesh.userData.amount !== amount) return;  // superseded mid-wipe
      mesh.geometry.dispose();
      const g = new THREE.CircleGeometry(targetR, 26, -Math.PI / 2, Math.max(t, 0.02) * Math.PI * 2);
      g.rotateX(-Math.PI / 2);
      mesh.geometry = g;
    }, () => {
      if (mesh.userData.amount !== amount) return;
      mesh.geometry.dispose();
      mesh.geometry = blobbyCircle(targetR, 26, wobble, bump, seed);
    });
  } else {
    /* amount change: quick radial grow/shrink */
    const fromR = radii[prev] || targetR;
    addTween(0.22, (t) => {
      if (mesh.userData.amount !== amount) return;
      const r = fromR + (targetR - fromR) * t;
      mesh.geometry.dispose();
      mesh.geometry = blobbyCircle(r, 26, wobble, bump, seed);
    });
  }
  mesh.position.y = baseY;
}

function keyOf(p) { return p.tid + "@" + p.x.toFixed(3) + "," + p.y.toFixed(3); }

function syncToppings(placed) {
  const keys = placed.map(keyOf);
  if (keys.length === prevKeys.length && keys.every((k, i) => k === prevKeys[i])) return;
  const prevSet = new Set(prevKeys);

  toppingGroup.clear();
  placed.forEach((p, idx) => {
    const parts = toppingParts(p.tid);
    const mesh = new THREE.Mesh(parts.g, parts.m);
    const w = toWorld(p.x, p.y);
    const seed = hashStr(keyOf(p));
    const y = TOPPING_Y + idx * 0.0009;
    mesh.position.set(w.x, y, w.z);
    if (parts.rotX) mesh.rotation.x = parts.rotX + (dpr(seed) - 0.5) * 0.5;
    mesh.rotation.y = dpr(seed + 1) * Math.PI * 2;
    const s = 0.9 + dpr(seed + 2) * 0.25;
    mesh.scale.multiplyScalar(s);
    mesh.userData.idx = idx;
    toppingGroup.add(mesh);
    if (!prevSet.has(keys[idx])) {
      /* new topping: drop in with a little squash on landing */
      const baseScale = mesh.scale.clone();
      mesh.position.y = y + 0.55;
      addTween(0.26, (t) => {
        const e = 1 - (1 - t) * (1 - t);          // ease-out fall
        mesh.position.y = y + 0.55 * (1 - e);
        const squash = t > 0.82 ? 1 - (t - 0.82) * 0.9 : 1;
        mesh.scale.set(baseScale.x, baseScale.y * squash, baseScale.z);
      }, () => { mesh.position.y = y; mesh.scale.copy(baseScale); });
    }
  });
  prevKeys = keys;
}

function syncCuts(cutAngles) {
  const want = (cutAngles || []).length;
  if (cutGroup.userData.n === want) return;
  cutGroup.userData.n = want;
  for (const c of cutGroup.children) c.geometry.dispose();
  cutGroup.clear();
  const mat = new THREE.MeshBasicMaterial({ color: 0x52351c });
  for (const a of cutAngles || []) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.016, 0.03), mat);
    line.position.y = 0.115;
    line.rotation.y = -a * Math.PI / 180;         // screen angle → world yaw
    cutGroup.add(line);
  }
}

function syncDoneness(d) {
  const t = Math.min(Math.max(d || 0, 0), 1);
  const bake = Math.min(t * 1.15, 1);
  cheeseMat.color.set(CHEESE_COLOR).lerp(new THREE.Color(CHEESE_BAKED), bake);
  crustMat.color.set(CRUST_COLOR).lerp(new THREE.Color(0xb5854a), bake * 0.7);
  doughMat.color.set(DOUGH_COLOR).lerp(new THREE.Color(0xd9b070), bake * 0.7);
  const burn = Math.max(0, (t - 0.85) / 0.15);
  if (burn > 0) {
    const char = new THREE.Color(BURNT);
    cheeseMat.color.lerp(char, burn * 0.8);
    crustMat.color.lerp(char, burn * 0.7);
    doughMat.color.lerp(char, burn * 0.7);
    sauceMat.color.set(SAUCE_COLOR).lerp(char, burn * 0.6);
  } else {
    sauceMat.color.set(SAUCE_COLOR);
  }
}

/* ------------------------------ public ------------------------------ */

P3D.mount = function (container) {
  if (!P3D.ok) return false;
  if (P3D._mountedIn !== container) {
    container.innerHTML = "";
    container.appendChild(renderer.domElement);
    P3D._mountedIn = container;
    prevKeys = ["__force-resync__"];
    if (resizeObs) resizeObs.disconnect();
    resizeObs = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resizeObs.observe(container);
    const w = container.clientWidth || 300, h = container.clientHeight || 300;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  startLoop();
  return true;
};

P3D.unmount = function () {
  if (!P3D._mountedIn) return;
  stopLoop();
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
  if (renderer.domElement.parentElement) renderer.domElement.remove();
  P3D._mountedIn = null;
};

P3D.isMounted = function (container) {
  return !!container && P3D._mountedIn === container;
};

/* view: { sauce, cheese, placed, doneness, cutAngles, halfGuide } */
P3D.sync = function (view) {
  if (!P3D.ok || !P3D._mountedIn) return;
  curView = view;
  syncCover(sauceMesh, sauceMat, SAUCE_R, view.sauce, 21, 0.07, 0, 0.075);
  syncCover(cheeseMesh, cheeseMat, CHEESE_R, view.cheese, 33, 0.1, 0.05, 0.09);
  syncToppings(view.placed || []);
  syncCuts(view.cutAngles);
  syncDoneness(view.doneness);
  guideGroup.visible = !!view.halfGuide;
};

/* Screen point → 0..1 pie coords (same space the DOM pizza used), or
   null when the pointer misses the pie plane entirely. */
P3D.pointToPie = function (clientX, clientY) {
  const hits = castAt(clientX, clientY, [pickPlane]);
  if (!hits.length) return null;
  const p = hits[0].point;
  return toGame(p.x, p.z);
};

/* Screen point → index into the placed[] array, or null. */
P3D.toppingAt = function (clientX, clientY) {
  const hits = castAt(clientX, clientY, toppingGroup.children);
  return hits.length ? hits[0].object.userData.idx : null;
};

/* ------------------------------- boot ------------------------------- */

try {
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2") || probe.getContext("webgl");
  if (gl) {
    initScene();
    P3D.ok = true;
  }
} catch (e) {
  console.warn("[pizza3d] init failed, DOM pizza fallback stays on:", e);
  P3D.ok = false;
}

window.TrollPizza3D = P3D;
window.dispatchEvent(new CustomEvent("pizza3d:ready", { detail: { ok: P3D.ok } }));
