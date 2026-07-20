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
import { Net, makeGuestIdentity } from "./net.js";
import { Ghost, drawBubble } from "./ghost.js";
import { NPC, NPC_DEFS } from "./npc.js";
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

  const npcSpriteNames = [...new Set(
    Object.values(NPC_DEFS).flat().map(d => d.sprite)
  )];
  const npcSprites = {};

  // load everything up front — phase 0 is two small zones
  const tilesets = {};
  const zoneData = {};
  await Promise.all([
    objectSprites.load(`${BASE}/sprites/objects`),
    studentSprites.load(`${BASE}/sprites`),
    ...npcSpriteNames.map(async name => {
      npcSprites[name] = await new CharacterSprites(name).load(`${BASE}/sprites`);
    }),
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

  const npcsByZone = {};
  const getNPCs = zn => {
    if (!npcsByZone[zn.id]) {
      npcsByZone[zn.id] = (NPC_DEFS[zn.id] || []).map(def => new NPC(def, zn, npcSprites[def.sprite]));
    }
    return npcsByZone[zn.id];
  };

  // ---------------------------------------------------------------- state
  const player = new Player(studentSprites);
  let zone = getZone(ZONE_IDS[0]);
  let npcs = getNPCs(zone);
  player.placeAtTile(zone.spawn.x, zone.spawn.y);

  let fade = 0;               // 0 clear → 1 black
  let pendingDoor = null;     // door being transitioned through
  let doorArmed = false;      // false until player steps off any door tile
  let memoryEl = null;

  const found = new Set(JSON.parse(localStorage.getItem("th_memories") || "[]"));
  const saveFound = () => localStorage.setItem("th_memories", JSON.stringify([...found]));

  // ------------------------------------------------------------ multiplayer
  const identity = makeGuestIdentity();
  identity.name = localStorage.getItem("th_name") || identity.name;
  const net = new Net(identity);
  const ghosts = new Map(); // peer id -> Ghost

  // ------------------------------------------------------------------- ui
  $("th-loading").hidden = true;
  const hud = $("th-hud"), hint = $("th-hint");
  const zoneNameEl = $("th-zone-name"), clockEl = $("th-clock"), rosterEl = $("th-roster");
  const nameInput = $("th-name");
  nameInput.value = identity.name;

  const coarse = matchMedia("(pointer: coarse)").matches;
  if (coarse) input.attachTouch($("th-stick"), $("th-stick-nub"), $("th-btn-act"));

  const ambience = new Ambience();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) ambience.suspend(); else ambience.resume();
  });

  let running = false;
  $("th-start").addEventListener("click", () => {
    identity.name = (nameInput.value || identity.name).trim().slice(0, 18) || identity.name;
    localStorage.setItem("th_name", identity.name);
    net.name = identity.name;

    $("th-title").hidden = true;
    hud.hidden = false;
    $("th-emotes").hidden = false;
    if (coarse) $("th-touch").hidden = false;
    input.interactPressed(); // swallow the click's queued Enter/Space
    running = true;
    ambience.start();
    ambience.setIndoor(zone.id !== "hallway-a");
    net.join(zone.id).catch(() => {});
  });

  function showMemory(mem, obj) {
    closeMemory();
    memoryEl = document.createElement("div");
    memoryEl.id = "th-memory";
    memoryEl.className = "th-popup-card";
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

  // NPC dialogue reuses the same reliable DOM card as memories — always
  // readable regardless of camera zoom or where the NPC is standing,
  // unlike a text bubble drawn on the world canvas.
  let dialogueEl = null;
  function showDialogue(npc) {
    closeDialogue();
    dialogueEl = document.createElement("div");
    dialogueEl.id = "th-dialogue";
    dialogueEl.className = "th-popup-card";
    dialogueEl.setAttribute("role", "dialog");
    dialogueEl.setAttribute("aria-label", npc.name);
    dialogueEl.innerHTML =
      `<h3>${npc.name}</h3><p>${npc.speak()}</p>` +
      `<div class="th-mem-close">E / tap — close</div>`;
    dialogueEl.addEventListener("click", closeDialogue);
    $("th-root").appendChild(dialogueEl);
  }
  function closeDialogue() {
    if (dialogueEl) { dialogueEl.remove(); dialogueEl = null; }
  }

  function setHint(text) {
    if (!text) { hint.hidden = true; return; }
    hint.innerHTML = `<kbd>E</kbd>${text}`;
    hint.hidden = false;
  }

  function switchZone(door) {
    zone = getZone(door.to);
    npcs = getNPCs(zone);
    player.placeAtTile(door.tx, door.ty);
    doorArmed = false;
    zoneNameEl.textContent = zone.name;
    ambience.setIndoor(zone.id !== "hallway-a");
    ghosts.clear(); // last room's peers no longer apply
    net.join(zone.id).catch(() => {});
  }

  zoneNameEl.textContent = zone.name;

  // ---------------------------------------------------------------- chat
  const chatLog = $("th-chat-log"), chatBar = $("th-chat-bar"), chatInput = $("th-chat-input");
  let chatOpen = false;
  let localBubble = null; // { text, until } — echo of this player's own chat/emote

  function pushLog(name, text) {
    const line = document.createElement("div");
    line.className = "th-log-line";
    line.innerHTML = `<b>${escapeHtml(name)}</b> ${escapeHtml(text)}`;
    chatLog.hidden = false;
    chatLog.appendChild(line);
    while (chatLog.children.length > 5) chatLog.removeChild(chatLog.firstChild);
    setTimeout(() => { line.remove(); if (!chatLog.children.length) chatLog.hidden = true; }, 6000);
  }
  function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function openChat() {
    if (!running || memoryEl || dialogueEl) return;
    chatOpen = true;
    chatBar.hidden = false;
    chatInput.value = "";
    chatInput.focus();
  }
  function closeChat() {
    chatOpen = false;
    chatBar.hidden = true;
    chatInput.blur();
  }
  chatInput.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Escape") { closeChat(); return; }
    if (e.key !== "Enter") return;
    const text = chatInput.value.trim();
    if (text) {
      net.sendChat(text);
      pushLog(identity.name, text);
      localBubble = { text, until: performance.now() + 3200 };
    }
    closeChat();
  });
  document.addEventListener("keydown", e => {
    if (e.code === "Enter" || e.code === "NumpadEnter") {
      if (!chatOpen) openChat();
    }
  });
  $("th-btn-chat")?.addEventListener("click", () => (chatOpen ? closeChat() : openChat()));

  net.onChat = (peerId, name, text) => {
    pushLog(name, text);
    const g = ghosts.get(peerId);
    if (g) g.say(text);
  };
  net.onEmote = (peerId, name, emoji) => {
    const g = ghosts.get(peerId);
    if (g) g.say(emoji);
  };

  document.querySelectorAll("#th-emotes button").forEach((btn, i) => {
    btn.addEventListener("click", () => fireEmote(btn.dataset.emoji));
  });
  const EMOTE_KEYS = { Digit1: "👋", Digit2: "💃", Digit3: "😂", Digit4: "❤️" };
  document.addEventListener("keydown", e => {
    if (chatOpen || e.target.tagName === "INPUT") return;
    const emoji = EMOTE_KEYS[e.code];
    if (emoji) fireEmote(emoji);
  });
  function fireEmote(emoji) {
    if (!running) return;
    net.sendEmote(emoji);
    localBubble = { text: emoji, until: performance.now() + 3200 };
  }

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
    net, ghosts, identity,
    openChat, closeChat,
    get chatOpen() { return chatOpen; },
    get npcs() { return npcs; },
    ringBell: () => ambience.ringBell(),
  };

  // ----------------------------------------------------------------- loop
  let last = performance.now();
  let clockAcc = 1;
  let lastPeriod = null; // set on first clock tick; ringBell() fires on change

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

    if (!pendingDoor && !memoryEl && !dialogueEl && !chatOpen) {
      player.update(dt, input.axis(), zone);
    }

    // multiplayer: broadcast our position, sync ghosts from the last-known
    // peer states, prune any that timed out
    net.sendPosition(dt, player);
    const live = net.liveGhosts();
    for (const [id, p] of live) {
      let g = ghosts.get(id);
      if (!g) { g = new Ghost(id, studentSprites); ghosts.set(id, g); }
      g.applyUpdate(p);
    }
    for (const id of ghosts.keys()) if (!live.has(id)) ghosts.delete(id);
    for (const g of ghosts.values()) g.update(dt);

    for (const n of npcs) n.update(dt);

    // doors: arm once the player is off every door tile, then trigger on entry
    const onDoor = zone.doorAt(player.tileX, player.tileY);
    if (!onDoor) doorArmed = true;
    else if (doorArmed && !pendingDoor) { pendingDoor = onDoor; }

    // interactions — a nearby NPC takes priority over a facing-tile memory object
    const nearNPC = npcs.find(n => n.distanceTo(player.x, player.y) < 26);
    const face = player.facingTile();
    const obj = zone.objectAt(face.x, face.y);
    const mem = obj && obj.def.memory;
    setHint((memoryEl || dialogueEl) ? null : nearNPC ? ` Talk to ${nearNPC.name}` : (mem ? ` ${mem.title}` : null));
    if (input.interactPressed()) {
      if (dialogueEl) closeDialogue();
      else if (memoryEl) closeMemory();
      else if (nearNPC) showDialogue(nearNPC);
      else if (mem) showMemory(mem, obj);
    }

    // hud clock + roster + bell/chatter (1/s is plenty)
    clockAcc += dt;
    if (clockAcc >= 1) {
      clockAcc = 0;
      const now = clock.now();
      clockEl.textContent = now.label;
      const names = [identity.name, ...[...ghosts.values()].map(g => g.name || "?")];
      rosterEl.textContent = `👥 ${names.length}`;
      rosterEl.title = names.join(", ");

      if (lastPeriod !== null && lastPeriod !== now.period) ambience.ringBell();
      lastPeriod = now.period;
      ambience.setChatter(clock.isPassingPeriod() ? 1 : 0, zone.id !== "hallway-a");
    }
    if (localBubble && performance.now() > localBubble.until) localBubble = null;

    const entities = [player.entity()];
    // huge y = sorts last = drawn on top, without affecting real world position
    if (localBubble) entities.push({ y: player.y + 1000, draw: ctx => drawBubble(ctx, player.x, player.y, localBubble.text) });
    for (const g of ghosts.values()) { const e = g.entity(); if (e) entities.push(e); }
    for (const n of npcs) entities.push(n.entity());

    renderer.follow(player.x, player.y, zone);
    renderer.frame(zone, entities, fade);
  }
  requestAnimationFrame(tick);
}

boot();
