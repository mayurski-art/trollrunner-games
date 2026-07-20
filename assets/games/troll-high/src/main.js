/* Troll High — boot + game loop. */

import { TILE, loadJSON } from "./util.js";
import { Input } from "./input.js";
import { Renderer } from "./render.js";
import { Tileset } from "./tileset.js";
import { ObjectSprites } from "./objects.js";
import { CharacterSprites } from "./sprites.js";
import { Zone } from "./zone.js";
import { Player } from "./player.js";
import { Ambience } from "./audio.js";
import * as clock from "./clock.js";

const BASE = "assets/games/troll-high";
const ZONE_IDS = [
  "hallway-a", "office", "classroom-3b", "classroom-3c", "classroom-3d",
  "computer-lab", "cafeteria", "library", "bathroom",
];

const $ = id => document.getElementById(id);

async function boot() {
  const input = new Input();
  const renderer = new Renderer($("th-canvas"));
  const objectSprites = new ObjectSprites();
  const studentSprites = new CharacterSprites("student");

  // load everything up front — phase 0 is two small zones
  const tilesets = {};
  const zoneData = {};
  await Promise.all([
    objectSprites.load(`${BASE}/sprites/objects`),
    studentSprites.load(`${BASE}/sprites`),
    ...ZONE_IDS.map(async id => {
      zoneData[id] = await loadJSON(`${BASE}/zones/${id}.json`);
    }),
  ]);
  const tilesetNames = [...new Set(ZONE_IDS.map(id => zoneData[id].tileset))];
  await Promise.all(tilesetNames.map(async n => {
    tilesets[n] = await new Tileset(n).load(`${BASE}/tiles`);
  }));

  const zones = {};
  const getZone = id => {
    if (!zones[id]) {
      zones[id] = new Zone(zoneData[id], tilesets[zoneData[id].tileset], objectSprites);
    }
    return zones[id];
  };

  // ---------------------------------------------------------------- state
  const player = new Player(studentSprites);
  let zone = getZone(ZONE_IDS[0]);
  player.placeAtTile(zone.spawn.x, zone.spawn.y);

  let fade = 0;               // 0 clear → 1 black
  let pendingDoor = null;     // door being transitioned through
  let doorArmed = false;      // false until player steps off any door tile
  let memoryEl = null;

  const found = new Set(JSON.parse(localStorage.getItem("th_memories") || "[]"));
  const saveFound = () => localStorage.setItem("th_memories", JSON.stringify([...found]));

  // ------------------------------------------------------------------- ui
  $("th-loading").hidden = true;
  const hud = $("th-hud"), hint = $("th-hint");
  const zoneNameEl = $("th-zone-name"), clockEl = $("th-clock");

  const coarse = matchMedia("(pointer: coarse)").matches;
  if (coarse) input.attachTouch($("th-stick"), $("th-stick-nub"), $("th-btn-act"));

  const ambience = new Ambience();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) ambience.suspend(); else ambience.resume();
  });

  let running = false;
  $("th-start").addEventListener("click", () => {
    $("th-title").hidden = true;
    hud.hidden = false;
    if (coarse) $("th-touch").hidden = false;
    input.interactPressed(); // swallow the click's queued Enter/Space
    running = true;
    ambience.start();
    ambience.setIndoor(zone.id !== "hallway-a");
  });

  function showMemory(mem, obj) {
    closeMemory();
    memoryEl = document.createElement("div");
    memoryEl.id = "th-memory";
    memoryEl.setAttribute("role", "dialog");
    memoryEl.setAttribute("aria-label", mem.title);
    const isNew = !found.has(obj.type + ":" + obj.x + ":" + obj.y);
    memoryEl.innerHTML =
      `<h3>${mem.title}${isNew ? " ✨" : ""}</h3><p>${mem.text}</p>` +
      `<div class="th-mem-close">E / tap — close</div>`;
    memoryEl.addEventListener("click", closeMemory);
    $("th-root").appendChild(memoryEl);
    if (isNew) { found.add(obj.type + ":" + obj.x + ":" + obj.y); saveFound(); }
  }
  function closeMemory() {
    if (memoryEl) { memoryEl.remove(); memoryEl = null; }
  }

  function setHint(text) {
    if (!text) { hint.hidden = true; return; }
    hint.innerHTML = `<kbd>E</kbd>${text}`;
    hint.hidden = false;
  }

  function switchZone(door) {
    zone = getZone(door.to);
    player.placeAtTile(door.tx, door.ty);
    doorArmed = false;
    zoneNameEl.textContent = zone.name;
    ambience.setIndoor(zone.id !== "hallway-a");
  }

  zoneNameEl.textContent = zone.name;

  // debug/testing handle (repo convention, cf. Bridge Patrol's __bp)
  window.__th = {
    player,
    get zone() { return zone; },
    get running() { return running; },
    warpTo(tx, ty) { player.placeAtTile(tx, ty); },
    tilesetReady: Object.fromEntries(
      Object.entries(tilesets).map(([n, t]) => [n, t.ready])
    ),
    spritesReady: studentSprites.ready,
    get ambienceStarted() { return ambience.started; },
  };

  // ----------------------------------------------------------------- loop
  let last = performance.now();
  let clockAcc = 1;

  function tick(nowMs) {
    requestAnimationFrame(tick);
    const dt = Math.min((nowMs - last) / 1000, 0.05);
    last = nowMs;
    if (!running) { renderer.frame(zone, [player.entity()], 0); return; }

    // fade-driven zone transition
    if (pendingDoor) {
      fade = Math.min(1, fade + dt * 4);
      if (fade >= 1) { switchZone(pendingDoor); pendingDoor = null; }
    } else if (fade > 0) {
      fade = Math.max(0, fade - dt * 4);
    }

    if (!pendingDoor && !memoryEl) {
      player.update(dt, input.axis(), zone);
    }

    // doors: arm once the player is off every door tile, then trigger on entry
    const onDoor = zone.doorAt(player.tileX, player.tileY);
    if (!onDoor) doorArmed = true;
    else if (doorArmed && !pendingDoor) { pendingDoor = onDoor; }

    // interactions
    const face = player.facingTile();
    const obj = zone.objectAt(face.x, face.y);
    const mem = obj && obj.def.memory;
    setHint(memoryEl ? null : (mem ? ` ${mem.title}` : null));
    if (input.interactPressed()) {
      if (memoryEl) closeMemory();
      else if (mem) showMemory(mem, obj);
    }

    // hud clock (1/s is plenty)
    clockAcc += dt;
    if (clockAcc >= 1) { clockAcc = 0; clockEl.textContent = clock.now().label; }

    renderer.follow(player.x, player.y, zone);
    renderer.frame(zone, [player.entity()], fade);
  }
  requestAnimationFrame(tick);
}

boot();
