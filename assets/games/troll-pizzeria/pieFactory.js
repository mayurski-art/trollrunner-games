/* Papa Troll's Pizzeria — pie factory (Kitchen3D phase 2).
   The pie-building/sync logic from pizza3d.js (the v2 Pizza Cam), pulled
   out into an instantiable factory so the 3D kitchen can have several
   pies alive at once — one worked on the build table, several baking in
   the oven rack — instead of pizza3d.js's original one-pie-at-a-time
   singleton (which only ever needed to render whichever station was
   currently mounted). Geometry/scoring semantics are unchanged; only the
   "one shared module-level pie" shape became "call createPie() per pie."
   Design doc: docs/TROLL-PIZZERIA-3D.md (phase 2). */
import * as THREE from "three";

const GAME_TO_WORLD = 1 / 0.48; // 0..1 game coords: dough spans 0.02..0.98
const TOPPING_Y = 0.115;

const dpr = (seed) => {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};
const hashStr = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
};

function blobbyCircle(radius, segs, wobble, bump, seedBase) {
  const g = new THREE.CircleGeometry(radius, segs);
  const pos = g.attributes.position;
  for (let i = 1; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const r = Math.hypot(x, y);
    if (r < 1e-5) continue;
    const k = 1 + (dpr(seedBase + i) - 0.5) * wobble;
    pos.setX(i, (x / r) * r * k);
    pos.setY(i, (y / r) * r * k);
    if (bump) pos.setZ(i, (dpr(seedBase * 3 + i) - 0.5) * bump);
  }
  g.computeVertexNormals();
  g.rotateX(-Math.PI / 2);
  return g;
}

const flat = (color, extra) => new THREE.MeshLambertMaterial(
  Object.assign({ color, flatShading: true }, extra || {}));

const SAUCE_R = { light: 0.66, normal: 0.77, extra: 0.85 };
const CHEESE_R = { light: 0.58, normal: 0.69, extra: 0.77 };
// v3 coverage is continuous 0..1 — map it onto the same fixed radii the
// mesh was built around (kitchen3d quantizes the same way game.js's
// view3d() does for the existing Pizza Cam).
const quantizeCoverage = (c) => (c < 0.15 ? "none" : c < 0.475 ? "light" : c < 0.725 ? "normal" : "extra");

/* One shared geometry + material per topping type — stateless (never
   doneness-tinted), so it's safe to share across every pie instance. */
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
  bacon:     () => ({ g: new THREE.BoxGeometry(0.19, 0.02, 0.07), m: flat(0xa8452f), rotX: 0 }),
  jalapeno:  () => ({ g: new THREE.TorusGeometry(0.07, 0.028, 5, 10), m: flat(0x4c8c2e), rotX: -Math.PI / 2 }),
  anchovy:   () => ({ g: new THREE.CapsuleGeometry(0.035, 0.15, 2, 6), m: flat(0x6f7f96), rotX: Math.PI / 2 }),
};
const toppingCache = {};
function toppingParts(tid) {
  if (!toppingCache[tid]) {
    const def = TOPPING_DEFS[tid] || TOPPING_DEFS.pepperoni;
    toppingCache[tid] = def();
  }
  return toppingCache[tid];
}

const CRUST_COLOR = 0xdfae63, DOUGH_COLOR = 0xf2d49b;
const SAUCE_COLOR = 0xc0392b, CHEESE_COLOR = 0xf6cf65;
const CHEESE_BAKED = 0xd68f3c, BURNT = 0x4a3421;

const toWorldXZ = (gx, gy) => ({ x: (gx - 0.5) * GAME_TO_WORLD, z: (gy - 0.5) * GAME_TO_WORLD });
const toGameXY = (wx, wz) => ({ x: wx / GAME_TO_WORLD + 0.5, y: wz / GAME_TO_WORLD + 0.5 });

/* Creates one pie instance: an `instanceRoot` Group the caller positions
   in the world (build table anchor, an oven slot anchor, ...), plus
   sync()/pointToPie()/toppingAt() to drive and read it. `interactive`
   adds the invisible pick plane raycasting needs — skip it for oven-rack
   pies, which are display-only (the player clicks the *slot*, not the
   pie surface, to pull/insert). */
export function createPie({ interactive = false } = {}) {
  const instanceRoot = new THREE.Group();
  const pieRoot = new THREE.Group();
  instanceRoot.add(pieRoot);

  const crustMat = flat(CRUST_COLOR);
  const doughMat = flat(DOUGH_COLOR);
  const doughGroup = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.99, 0.09, 26), crustMat);
  doughGroup.add(base);
  const crustGeo = new THREE.TorusGeometry(0.93, 0.135, 7, 26);
  const cp = crustGeo.attributes.position;
  for (let i = 0; i < cp.count; i++) {
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
  pieRoot.add(doughGroup);

  const sauceMat = flat(SAUCE_COLOR);
  const cheeseMat = flat(CHEESE_COLOR);
  const sauceMesh = new THREE.Mesh(blobbyCircle(SAUCE_R.normal, 26, 0.07, 0, 21), sauceMat);
  sauceMesh.position.y = 0.075;
  sauceMesh.visible = false;
  pieRoot.add(sauceMesh);
  const cheeseMesh = new THREE.Mesh(blobbyCircle(CHEESE_R.normal, 26, 0.1, 0.05, 33), cheeseMat);
  cheeseMesh.position.y = 0.09;
  cheeseMesh.visible = false;
  pieRoot.add(cheeseMesh);

  const toppingGroup = new THREE.Group();
  pieRoot.add(toppingGroup);
  const cutGroup = new THREE.Group();
  pieRoot.add(cutGroup);

  const guideGroup = new THREE.Group();
  const dashMat = new THREE.MeshBasicMaterial({ color: 0x55351f, transparent: true, opacity: 0.45 });
  for (let i = 0; i < 8; i++) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.006, 0.12), dashMat);
    dash.position.set(0, 0.13, -0.83 + i * 0.237);
    guideGroup.add(dash);
  }
  guideGroup.visible = false;
  pieRoot.add(guideGroup);

  const cutGuideGroup = new THREE.Group();
  pieRoot.add(cutGuideGroup);

  const sweepMesh = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.02, 0.03), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
  sweepMesh.add(bar);
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10), new THREE.MeshBasicMaterial({ color: 0xe8e8e8 }));
  wheel.rotation.z = Math.PI / 2;
  wheel.position.x = 0.93;
  sweepMesh.add(wheel);
  sweepMesh.position.y = 0.135;
  sweepMesh.visible = false;
  pieRoot.add(sweepMesh);

  let pickPlane = null;
  if (interactive) {
    pickPlane = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 20),
      new THREE.MeshBasicMaterial({ visible: false }));
    pickPlane.geometry.rotateX(-Math.PI / 2);
    pickPlane.position.y = 0.09;
    instanceRoot.add(pickPlane);
  }

  /* fake contact shadow */
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.18, 26),
    new THREE.MeshBasicMaterial({ color: 0x2a1808, transparent: true, opacity: 0.18 }));
  shadow.geometry.rotateX(-Math.PI / 2);
  shadow.position.y = -0.06;
  instanceRoot.add(shadow);

  let tweens = [];
  function addTween(dur, apply, done) { tweens.push({ t: 0, dur, apply, done }); }
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

  let prevKeys = [];

  function syncCover(mesh, mat, radii, amountKey, seed, wobble, bump, baseY) {
    const amount = quantizeCoverage(amountKey);
    if (amount === "none") { mesh.visible = false; mesh.userData.amount = "none"; return; }
    const targetR = radii[amount];
    const prev = mesh.userData.amount || "none";
    mesh.userData.amount = amount;
    if (prev === amount) { mesh.visible = true; return; }
    mesh.visible = true;
    if (prev === "none") {
      addTween(0.38, (t) => {
        if (mesh.userData.amount !== amount) return;
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
      const w = toWorldXZ(p.x, p.y);
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
        const baseScale = mesh.scale.clone();
        mesh.position.y = y + 0.55;
        addTween(0.26, (t) => {
          const e = 1 - (1 - t) * (1 - t);
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
      line.rotation.y = -a * Math.PI / 180;
      cutGroup.add(line);
    }
  }

  const CLEAVE_GAP = 0.2;
  let cleaveSectors = [];
  let lastCutSig = null;
  const norm2pi = (a) => { const t = Math.PI * 2; return ((a % t) + t) % t; };
  function wedgeGeo(radius, thetaStart, thetaLength) {
    const g = new THREE.CircleGeometry(radius, 10, thetaStart, thetaLength);
    g.rotateX(-Math.PI / 2);
    return g;
  }
  function clearCleave() {
    for (const s of cleaveSectors) {
      s.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      pieRoot.remove(s.group);
    }
    cleaveSectors = [];
    lastCutSig = null;
  }
  function buildCleave(cutAngles, sauceKey, cheeseKey, placed) {
    const sauceAmt = quantizeCoverage(sauceKey), cheeseAmt = quantizeCoverage(cheeseKey);
    const sig = (cutAngles || []).map(a => a.toFixed(1)).sort().join(",");
    if (sig === lastCutSig) return;
    lastCutSig = sig;
    clearCleave();
    if (!cutAngles || !cutAngles.length) {
      sauceMesh.visible = sauceAmt !== "none";
      cheeseMesh.visible = cheeseAmt !== "none";
      return;
    }
    const bounds = [];
    for (const a of cutAngles) {
      const y0 = norm2pi(-a * Math.PI / 180);
      bounds.push(y0, norm2pi(y0 + Math.PI));
    }
    bounds.sort((a, b) => a - b);
    const uniq = bounds.filter((a, i) => i === 0 || Math.abs(a - bounds[i - 1]) > 1e-3);
    const n = uniq.length;
    if (n < 2) return;
    sauceMesh.visible = false;
    cheeseMesh.visible = false;
    for (let i = 0; i < n; i++) {
      const start = uniq[i];
      let len = uniq[(i + 1) % n] - start;
      if (len <= 0) len += Math.PI * 2;
      const mid = start + len / 2;
      const dir = new THREE.Vector3(Math.cos(mid), 0, -Math.sin(mid));
      const group = new THREE.Group();
      if (sauceAmt !== "none")
        group.add(new THREE.Mesh(wedgeGeo(SAUCE_R[sauceAmt], start, len), sauceMat).translateY(0.075 - 0.09));
      if (cheeseAmt !== "none")
        group.add(new THREE.Mesh(wedgeGeo(CHEESE_R[cheeseAmt], start, len), cheeseMat));
      group.position.y = 0.09;
      pieRoot.add(group);
      const movedTops = [];
      for (const mesh of toppingGroup.children) {
        const p = mesh.position;
        const a = norm2pi(Math.atan2(-p.z, p.x));
        let inSector = a - start;
        if (inSector < 0) inSector += Math.PI * 2;
        if (inSector <= len) movedTops.push(mesh);
      }
      const sector = { group, dir, movedTops, base: movedTops.map(m => m.position.clone()) };
      cleaveSectors.push(sector);
      const baseY = group.position.y;
      addTween(0.32, (t) => {
        const e = t * t * (3 - 2 * t);
        const off = dir.clone().multiplyScalar(CLEAVE_GAP * e);
        const pop = Math.sin(t * Math.PI) * 0.05;
        group.position.x = off.x; group.position.z = off.z;
        group.position.y = baseY + pop;
        group.rotation.y = (dpr(i + 1) - 0.5) * 0.16 * e;
        sector.base.forEach((b, k) => {
          movedTops[k].position.x = b.x + off.x;
          movedTops[k].position.z = b.z + off.z;
          movedTops[k].position.y = b.y + pop;
        });
      });
    }
  }

  function syncCutGuides(k) {
    if (cutGuideGroup.userData.k === k) return;
    cutGuideGroup.userData.k = k;
    cutGuideGroup.clear();
    if (!k) return;
    const mat = new THREE.MeshBasicMaterial({ color: 0x2f9e44, transparent: true, opacity: 0.55 });
    for (let i = 0; i < k; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.012, 0.02), mat);
      line.position.y = 0.118;
      line.rotation.y = -((i * 180) / k) * Math.PI / 180;
      cutGuideGroup.add(line);
    }
  }

  function setSweep(angleDeg, active) {
    sweepMesh.visible = !!active;
    if (active) sweepMesh.rotation.y = -angleDeg * Math.PI / 180;
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

  const raycaster = new THREE.Raycaster();

  return {
    root: instanceRoot,
    stepTweens,

    /* view: { sauce, cheese, placed, doneness, cutAngles, halfGuide,
       cutNeeded, sweeping, sweepAngle } — same shape game.js already
       builds via view3d() for the existing Pizza Cam. */
    sync(view) {
      const cleaving = view.cutAngles && view.cutAngles.length > 0;
      syncCover(sauceMesh, sauceMat, SAUCE_R, view.sauce, 21, 0.07, 0, 0.075);
      syncCover(cheeseMesh, cheeseMat, CHEESE_R, view.cheese, 33, 0.1, 0.05, 0.09);
      syncToppings(view.placed || []);
      syncDoneness(view.doneness);
      guideGroup.visible = !!view.halfGuide;
      syncCutGuides(view.cutNeeded || 0);
      setSweep(view.sweepAngle || 0, !!view.sweeping);
      if (cleaving) buildCleave(view.cutAngles, view.sauce, view.cheese, view.placed);
      else { clearCleave(); syncCuts(view.cutAngles); }
    },

    /* Ray (in world space, from the kitchen's own camera) → 0..1 pie
       coords local to THIS instance, or null if it misses the pick plane
       or the instance isn't interactive. */
    pointFromRay(raycasterIn) {
      if (!pickPlane) return null;
      const hits = raycasterIn.intersectObject(pickPlane, false);
      if (!hits.length) return null;
      const local = instanceRoot.worldToLocal(hits[0].point.clone());
      return toGameXY(local.x, local.z);
    },
    toppingAtRay(raycasterIn) {
      const hits = raycasterIn.intersectObjects(toppingGroup.children, false);
      return hits.length ? hits[0].object.userData.idx : null;
    },
    updateSweep(angleDeg) {
      if (!sweepMesh.visible) return;
      sweepMesh.rotation.y = -angleDeg * Math.PI / 180;
    },
    serveSpin(done) {
      const start = pieRoot.rotation.y;
      addTween(0.7, (t) => {
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        pieRoot.rotation.y = start + e * Math.PI * 2;
        pieRoot.position.y = Math.sin(t * Math.PI) * 0.22;
      }, () => {
        pieRoot.rotation.y = start;
        pieRoot.position.y = 0;
        if (done) done();
      });
    },
    dispose() {
      instanceRoot.traverse((o) => { if (o.geometry && o !== pickPlane) o.geometry?.dispose?.(); });
      instanceRoot.parent?.remove(instanceRoot);
    },
    __debugSectorCount: () => cleaveSectors.length,
  };
}
