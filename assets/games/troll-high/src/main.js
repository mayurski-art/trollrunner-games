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
import { Net } from "./net.js";
import { Ghost, drawBubble } from "./ghost.js";
import { NPC, NPC_DEFS } from "./npc.js";
import { awaitAuth } from "./gate.js";
import { loadSave, saveGame } from "./save.js";
import { Minigame, minigameInfo } from "./minigames.js";
import { drawCampusMap } from "./mapview.js";
import * as clock from "./clock.js";

const BASE = "assets/games/troll-high";
const ZONE_IDS = [
  "hallway-a", "office", "classroom-3b", "classroom-3c", "classroom-3d",
  "computer-lab", "cafeteria", "library", "bathroom",
  "hallway-b", "gym", "auditorium", "art-room", "music-room", "science-lab",
  "nurse", "playground", "sports-field", "bus-loop", "basement", "tunnels", "roof",
];
// open corridors + genuinely outdoor zones get the quieter ambience tone
const OUTDOOR_ZONES = new Set(["hallway-a", "hallway-b", "playground", "sports-field", "bus-loop", "roof"]);

const $ = id => document.getElementById(id);

async function boot() {
  const authPromise = awaitAuth(); // starts driving the #th-title gate UI right away

  // gate.js can unhide #th-start (once authPromise resolves) before this
  // function's own async chain below — loadSave() does a real network
  // round trip — has reached the point of attaching its click handler.
  // Without this guard a fast click (or a test) lands in that gap and is
  // silently dropped, since no listener exists yet to catch it.
  let bootReady = false, pendingStart = false, onStart = () => { pendingStart = true; };
  $("th-start").addEventListener("click", () => { if (bootReady) onStart(); else pendingStart = true; });

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
  let found = new Set(); // populated once the account + cloud save resolve, below

  // ------------------------------------------------------------------- ui
  $("th-loading").hidden = true; // reveals #th-title underneath (gate/loading/welcome, driven by gate.js)

  // login is required (design doc decision 3) — this resolves once a real
  // account session exists, whether via the form above or SSO from another
  // *.trollrunner.net game.
  const session = await authPromise;
  const identity = { id: session.userId, name: session.username || "troll" };

  // Cloud save (assets/supabase/troll_game_saves.sql, shared with Trollrreria)
  // — restores last zone/position and every memory already found. One-time
  // migration of pre-login local progress (this project didn't require an
  // account until this phase) into the new per-account save.
  let savedGame = await loadSave(session.userId);
  if (!savedGame) {
    try {
      const legacy = localStorage.getItem("th_memories");
      if (legacy) {
        localStorage.removeItem("th_memories");
        savedGame = { zoneId: zone.id, x: player.x, y: player.y, foundKeys: JSON.parse(legacy) };
        await saveGame(session.userId, savedGame);
      }
    } catch (e) { /* ignore a corrupt legacy key */ }
  }
  if (savedGame) {
    found = new Set(savedGame.foundKeys || []);
    if (savedGame.zoneId && zoneData[savedGame.zoneId]) {
      zone = getZone(savedGame.zoneId);
      npcs = getNPCs(zone);
    }
    if (typeof savedGame.x === "number" && typeof savedGame.y === "number") {
      player.x = savedGame.x; player.y = savedGame.y;
    }
  }

  let saveDirty = false;
  function persist() {
    if (!saveDirty) return;
    saveDirty = false;
    saveGame(session.userId, { zoneId: zone.id, x: player.x, y: player.y, foundKeys: [...found] });
  }
  setInterval(persist, 30000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) persist(); });
  addEventListener("beforeunload", persist);

  // ------------------------------------------------------------ multiplayer
  const net = new Net(identity);
  const ghosts = new Map(); // peer id -> Ghost
  const hud = $("th-hud"), hint = $("th-hint");
  const zoneNameEl = $("th-zone-name"), clockEl = $("th-clock"), rosterEl = $("th-roster");

  const coarse = matchMedia("(pointer: coarse)").matches;
  if (coarse) input.attachTouch($("th-stick"), $("th-stick-nub"), $("th-btn-act"));

  const ambience = new Ambience();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) ambience.suspend(); else ambience.resume();
  });

  let running = false;
  onStart = () => {
    $("th-title").hidden = true;
    hud.hidden = false;
    $("th-emotes").hidden = false;
    if (coarse) $("th-touch").hidden = false;
    input.interactPressed(); // swallow the click's queued Enter/Space
    running = true;
    ambience.start();
    ambience.setIndoor(!OUTDOOR_ZONES.has(zone.id));
    net.join(zone.id).catch(() => {});
  };
  bootReady = true;
  if (pendingStart) onStart();

  // ----------------------------------------------------------- leaderboard
  const lbOverlay = $("th-leaderboard-overlay");
  $("th-btn-leaderboard")?.addEventListener("click", () => {
    lbOverlay.hidden = false;
    window.TrollLeaderboard?.refresh?.("troll-high");
  });
  $("th-leaderboard-close")?.addEventListener("click", () => { lbOverlay.hidden = true; });

  // ----------------------------------------------------------------- map
  const mapOverlay = $("th-map-overlay");
  const mapCanvas = $("th-map-canvas");
  function openMap() { mapOverlay.hidden = false; drawCampusMap(mapCanvas, zone.id); }
  function closeMap() { mapOverlay.hidden = true; }
  $("th-btn-map")?.addEventListener("click", openMap);
  $("th-map-close")?.addEventListener("click", closeMap);
  addEventListener("keydown", e => {
    if (e.code !== "KeyM" || e.target.tagName === "INPUT") return;
    if (!running) return;
    if (mapOverlay.hidden) { if (!memoryEl && !dialogueEl && !chatOpen && lbOverlay.hidden && arcadeOverlay.hidden && minigameOverlay.hidden) openMap(); }
    else closeMap();
  });

  // ------------------------------------------------------ arcade launcher
  // Computer lab CRTs boot the real arcade games in-world (design doc
  // decision 4) — a same-origin iframe, no CSP change needed. Clearing
  // the src on close (not just hiding) stops the embedded game's loop and
  // audio rather than leaving it running invisibly behind the overlay.
  const arcadeOverlay = $("th-arcade-overlay");
  const arcadeIframe = $("th-arcade-iframe");
  const arcadeTitle = $("th-crt-title");
  function openArcade(obj) {
    arcadeTitle.textContent = obj.gameName || obj.game;
    arcadeIframe.src = obj.game;
    arcadeOverlay.hidden = false;
  }
  function closeArcade() {
    arcadeOverlay.hidden = true;
    arcadeIframe.src = "about:blank";
    // The embedded game's iframe can steal keyboard focus; without pulling
    // it back, subsequent keydown events fire on the (now blank) iframe
    // document instead of bubbling to ours, and movement/interact go dead.
    document.body.focus();
    window.focus();
  }
  $("th-arcade-close")?.addEventListener("click", closeArcade);

  // ---------------------------------------------------- recess minigames
  // Original in-world games (design doc §11), not embeds — a small canvas
  // loop per kind, run by minigames.js.
  const minigameOverlay = $("th-minigame-overlay");
  const minigameCanvas = $("th-minigame-canvas");
  const minigameTitleEl = $("th-minigame-title");
  const minigameScoreEl = $("th-minigame-score");
  const minigameHelpEl = $("th-minigame-help");
  let activeMinigame = null;
  function openMinigame(obj) {
    const kind = obj.play || obj.def.play;
    const info = minigameInfo(kind);
    minigameTitleEl.textContent = obj.playName || obj.def.playName || info.title;
    minigameHelpEl.textContent = info.help;
    minigameScoreEl.textContent = "Score: 0";
    minigameOverlay.hidden = false;
    activeMinigame = new Minigame(minigameCanvas, kind);
    activeMinigame.start();
  }
  function closeMinigame() {
    activeMinigame?.stop();
    activeMinigame = null;
    minigameOverlay.hidden = true;
  }
  $("th-minigame-close")?.addEventListener("click", closeMinigame);

  function showMemory(mem, obj) {
    closeMemory();
    memoryEl = document.createElement("div");
    memoryEl.id = "th-memory";
    memoryEl.className = "th-popup-card";
    memoryEl.setAttribute("role", "dialog");
    memoryEl.setAttribute("aria-label", mem.title);
    const isNew = !found.has(obj.memKey);
    memoryEl.innerHTML =
      `<h3>${mem.title}${isNew ? " ✨" : ""}</h3><p>${mem.text}</p>` +
      (obj.def.screen ? `<canvas class="th-mem-screen" width="120" height="90"></canvas>` : "") +
      `<div class="th-mem-close">E / tap — close</div>`;
    memoryEl.addEventListener("click", closeMemory);
    $("th-root").appendChild(memoryEl);
    if (isNew) {
      found.add(obj.memKey);
      saveDirty = true;
      persist();
      window.TrollLeaderboard?.record?.("troll-high", { memories: found.size });
    }
    if (obj.def.screen) startScreenAnim(memoryEl.querySelector(".th-mem-screen"));
  }
  function closeMemory() {
    stopScreenAnim();
    if (memoryEl) { memoryEl.remove(); memoryEl = null; }
  }

  // "See inside the TV": a small looping animated canvas standing in for
  // channel static, drawn fresh each time (no video asset, no license
  // concerns) — colored scanlines drifting over analog noise.
  let screenAnimId = null;
  function startScreenAnim(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    let t = 0;
    const tick = () => {
      t += 1;
      const img = ctx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const v = Math.random() * 255;
        img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      // drifting color bars over the static, like an old test pattern
      const bars = ["#e8862e", "#4dc9ff", "#8ee06a", "#ff5d7a", "#f5d94e"];
      const barW = w / bars.length;
      for (let i = 0; i < bars.length; i++) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = bars[i];
        ctx.fillRect(((i * barW + t * 0.6) % w), 0, barW * 0.7, h);
      }
      ctx.globalAlpha = 1;
      screenAnimId = requestAnimationFrame(tick);
    };
    tick();
  }
  function stopScreenAnim() {
    if (screenAnimId) { cancelAnimationFrame(screenAnimId); screenAnimId = null; }
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
    ambience.setIndoor(!OUTDOOR_ZONES.has(zone.id));
    ghosts.clear(); // last room's peers no longer apply
    net.join(zone.id).catch(() => {});
    saveDirty = true;
    persist(); // checkpoint on room change, not just the interval
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
    if (!running || memoryEl || dialogueEl || !lbOverlay.hidden || !arcadeOverlay.hidden || !minigameOverlay.hidden || !mapOverlay.hidden) return;
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
    net, ghosts, identity, session,
    openChat, closeChat,
    get chatOpen() { return chatOpen; },
    get npcs() { return npcs; },
    get found() { return found; },
    ringBell: () => ambience.ringBell(),
    persist: () => { saveDirty = true; persist(); },
    openLeaderboard: () => { lbOverlay.hidden = false; window.TrollLeaderboard?.refresh?.("troll-high"); },
    closeLeaderboard: () => { lbOverlay.hidden = true; },
    openArcade, closeArcade, openMinigame, closeMinigame,
    get arcadeOpen() { return !arcadeOverlay.hidden; },
    get minigameOpen() { return !minigameOverlay.hidden; },
    get mapOpen() { return !mapOverlay.hidden; },
    openMap, closeMap,
    get minigameScore() { return activeMinigame?.score ?? null; },
    get minigameFinished() { return activeMinigame?.finished ?? null; },
    get minigame() { return activeMinigame; },
  };

  // -------------------------------------------------------------- pushing
  // Sokoban-style: walking into a pushable object shunts it one tile in the
  // same direction, gated by zone.tryPush (walls/other furniture/doors all
  // block it — a pushed object can never leave its room). Cooldown so
  // holding the key nudges it step by step rather than teleporting it.
  let lastPushAt = 0;
  const PUSH_COOLDOWN_MS = 260;
  function tryPushFromInput(axis) {
    if (axis.x === 0 && axis.y === 0) return;
    if (performance.now() - lastPushAt < PUSH_COOLDOWN_MS) return;
    const dx = Math.abs(axis.x) > Math.abs(axis.y) ? Math.sign(axis.x) : 0;
    const dy = dx === 0 ? Math.sign(axis.y) : 0;
    if (dx === 0 && dy === 0) return;
    const obj = zone.objectAt(player.tileX + dx, player.tileY + dy);
    if (!obj || !obj.def.pushable) return;
    if (zone.tryPush(obj, dx, dy)) lastPushAt = performance.now();
  }

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

    if (!pendingDoor && !memoryEl && !dialogueEl && !chatOpen && lbOverlay.hidden && arcadeOverlay.hidden && minigameOverlay.hidden && mapOverlay.hidden) {
      const axis = input.axis();
      tryPushFromInput(axis);
      player.update(dt, axis, zone);
    }

    if (activeMinigame) minigameScoreEl.textContent = `Score: ${activeMinigame.score}`;

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

    // interactions — a nearby NPC takes priority over a facing-tile object;
    // a "game" computer opens the arcade launcher instead of its memory
    // card (a per-instance zone-JSON field, not part of the shared def —
    // most computer-desks are flavor-only, a few are real launchers)
    const nearNPC = npcs.find(n => n.distanceTo(player.x, player.y) < 26);
    const face = player.facingTile();
    const obj = zone.objectAt(face.x, face.y);
    const mem = obj && (obj.memory || obj.def.memory);
    const play = obj && (obj.play || obj.def.play);
    const arcadeHint = obj && obj.game ? ` Play ${obj.gameName || "a game"}` : null;
    const playHint = play ? ` Play ${obj.playName || obj.def.playName || minigameInfo(play).title}` : null;
    setHint((memoryEl || dialogueEl || !arcadeOverlay.hidden || !minigameOverlay.hidden || !mapOverlay.hidden) ? null : nearNPC ? ` Talk to ${nearNPC.name}` : (arcadeHint || playHint || (mem ? ` ${mem.title}` : null)));
    if (input.interactPressed() && mapOverlay.hidden) {
      if (!minigameOverlay.hidden) closeMinigame();
      else if (!arcadeOverlay.hidden) closeArcade();
      else if (dialogueEl) closeDialogue();
      else if (memoryEl) closeMemory();
      else if (nearNPC) showDialogue(nearNPC);
      else if (obj && obj.game) openArcade(obj);
      else if (play) openMinigame(obj);
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
      ambience.setChatter(clock.isPassingPeriod() ? 1 : 0, !OUTDOOR_ZONES.has(zone.id));
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
