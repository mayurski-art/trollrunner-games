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
import { genStudentId, renderProfile } from "./profile.js";
import { MENU as CAFETERIA_MENU, normalizeStudentId } from "./cafeteria.js";
import { ELECTIVES, buildSchedule, DAILY_TASKS } from "./schedule.js";
import { CARDS, cardById, maybeAwardCard } from "./cards.js";
import { todaysLunch, todaysAnnouncement, todaysEvent, PIZZA_FRIDAY_SPECIAL } from "./daily.js";
import { pickDialogueLine } from "./relations.js";
import { SLOTS as BEDROOM_SLOTS, DECORATIONS, decorationById } from "./bedroom.js";
import { capturePhoto, addPhotoToRoll, MAX_PHOTOS } from "./camera.js";
import * as clock from "./clock.js";
import { activeEvent, eventInfo } from "./events.js";

const BASE = "assets/games/troll-high";
const ZONE_IDS = [
  "hallway-a", "office", "classroom-3b", "classroom-3c", "classroom-3d",
  "computer-lab", "cafeteria", "library", "bathroom",
  "hallway-b", "gym", "auditorium", "art-room", "music-room", "science-lab",
  "nurse", "playground", "sports-field", "bus-loop", "basement", "tunnels", "roof",
  // Phase 8 — Neighborhood 1
  "main-street", "arcade", "pizza-place", "convenience-store", "park",
  // Phase 9 — Neighborhood 2
  "forest-trail", "skate-park", "lake", "warehouse", "storm-drains", "caves",
  // Phase 11 — Troll meta
  "underground-hq",
  // Phase 12 — Polish: developer room easter egg
  "dev-room",
];
// open corridors + genuinely outdoor zones get the quieter ambience tone
const OUTDOOR_ZONES = new Set(["hallway-a", "hallway-b", "playground", "sports-field", "bus-loop", "roof", "main-street", "park", "forest-trail", "skate-park", "lake"]);

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

  // "make the school feel alive" (design doc) — an NPC def with no
  // activePeriods is always present (teachers, staff at their desks); one
  // with activePeriods only shows up during those clock periods, so the
  // same person (same id, for relationship continuity) can appear in a
  // different zone's list at a different time of day, e.g. Janitor Gus
  // mopping the cafeteria after school instead of patrolling hallway-a.
  const npcsByZone = {};
  const allNPCsForZone = zn => {
    if (!npcsByZone[zn.id]) {
      npcsByZone[zn.id] = (NPC_DEFS[zn.id] || []).map(def => new NPC(def, zn, npcSprites[def.sprite]));
    }
    return npcsByZone[zn.id];
  };
  const getNPCs = zn => {
    const period = clock.now().period;
    return allNPCsForZone(zn).filter(n => !n.def.activePeriods || n.def.activePeriods.includes(period));
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

  // Cosmetic in-game student ID + high scores — separate from the real
  // account identity, generated once and carried in the same save row.
  let saveDirty = false;
  const studentId = savedGame?.studentId || genStudentId();
  const enrolledAt = savedGame?.enrolledAt || Date.now();
  const highScores = savedGame?.highScores || {};
  if (!savedGame?.studentId) saveDirty = true;

  // Orientation (shown once), elective pick, and daily tasks (reset when
  // the in-game day, per clock.js, rolls over — 1 real hour = 1 school day).
  let orientationDone = savedGame?.orientationDone || false;
  let elective = savedGame?.elective || ELECTIVES[2].id;
  const today = clock.now().dayIndex;
  // Event engine (design doc §12/§21 Phase 10) — deterministic from the
  // REAL calendar date, not the in-game day, so it's tied to the actual
  // world; computed once at boot since it only changes once a real day.
  const todaysEventId = activeEvent();
  const todaysEventInfo = eventInfo(todaysEventId);
  let dailyTasksDay = savedGame?.dailyTasksDay;
  let dailyFlags = savedGame?.dailyFlags || {};
  if (dailyTasksDay !== today) { dailyTasksDay = today; dailyFlags = {}; saveDirty = true; }
  function markDailyTask(id) {
    if (dailyFlags[id]) return;
    dailyFlags[id] = true;
    saveDirty = true;
  }

  // Trading cards (Phase 7) — {cardId: count}. Earned as a side chance on
  // existing milestones (new memory, new high score), not a separate grind.
  const cards = savedGame?.cards || {};
  function addCard(id, n = 1) { cards[id] = (cards[id] || 0) + n; saveDirty = true; }
  function removeCard(id, n = 1) {
    cards[id] = Math.max(0, (cards[id] || 0) - n);
    if (cards[id] === 0) delete cards[id];
    saveDirty = true;
  }

  // Life-story profile stats (§21 of the design doc) — progression as
  // "what did I do at this school," not levels/XP. Extend this object with
  // more counters as later phases add clubs/dances/events; the profile
  // card and save payload don't need to change shape, just this list.
  const visitedZones = new Set(savedGame?.visitedZones || []);
  const visitDays = new Set(savedGame?.visitDays || []);
  let lunchesBought = savedGame?.lunchesBought || 0;
  let tradesCompleted = savedGame?.tradesCompleted || 0;
  let giftsGiven = savedGame?.giftsGiven || 0;
  let giftsReceived = savedGame?.giftsReceived || 0;
  // Clubs (design doc §21 near-term queue, final item) — reading the club
  // charter in the Underground HQ (finding it at all is gated behind the
  // full secrets chain, same as meeting Trollface) doubles as signing it.
  let clubMember = savedGame?.clubMember || false;
  if (!visitedZones.has(zone.id)) { visitedZones.add(zone.id); saveDirty = true; }
  if (!visitDays.has(today)) { visitDays.add(today); saveDirty = true; }

  // NPC memory (design doc §21) — each NPC remembers YOU, specifically,
  // via a relationship record in your own save (see relations.js for why
  // this needs no shared "NPC brain"). {[npcId]: {timesTalked}}.
  const npcRelations = savedGame?.npcRelations || {};

  // Personal bedroom (design doc §21) — decorations unlock off stats the
  // game already tracks, no separate grind. {slot: decorationId | null}
  const bedroomEquipped = savedGame?.bedroomEquipped || {};

  // Yearbook / disposable camera (design doc §21) — a limited photo roll,
  // real captures of the current game view uploaded to Supabase Storage
  // (docs/troll_high_yearbook.sql). Just the list lives in this save row.
  let photos = savedGame?.photos || [];

  function persist() {
    if (!saveDirty) return;
    saveDirty = false;
    saveGame(session.userId, {
      zoneId: zone.id, x: player.x, y: player.y, foundKeys: [...found], studentId, enrolledAt, highScores,
      orientationDone, elective, dailyTasksDay, dailyFlags, cards,
      visitedZones: [...visitedZones], visitDays: [...visitDays], lunchesBought, tradesCompleted, giftsGiven, giftsReceived,
      npcRelations, bedroomEquipped, photos, clubMember,
    });
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
    $("th-btn-profile").hidden = false;
    if (coarse) $("th-touch").hidden = false;
    input.interactPressed(); // swallow the click's queued Enter/Space
    running = true;
    ambience.start();
    ambience.setIndoor(!OUTDOOR_ZONES.has(zone.id));
    net.join(zone.id).catch(() => {});
    if (!orientationDone) openOrientation();
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
  function openMap() { mapOverlay.hidden = false; drawCampusMap(mapCanvas, zone.id); markDailyTask("map"); }
  function closeMap() { mapOverlay.hidden = true; }
  $("th-btn-map")?.addEventListener("click", openMap);
  $("th-map-close")?.addEventListener("click", closeMap);

  // ------------------------------------------------------------- profile
  const profileOverlay = $("th-profile-overlay");
  const profileDom = {
    name: $("th-profile-name"), id: $("th-profile-id"), enrolled: $("th-profile-enrolled"),
    memories: $("th-profile-memories"), scores: $("th-profile-scores"),
    roomsExplored: $("th-profile-rooms-explored"), daysAttended: $("th-profile-days-attended"),
    lunchesBought: $("th-profile-lunches"), tradesCompleted: $("th-profile-trades"),
    giftsGiven: $("th-profile-gifts-given"), giftsReceived: $("th-profile-gifts-received"),
    cardsCollected: $("th-profile-cards-collected"),
  };
  function openProfile() {
    renderProfile(profileDom, {
      name: identity.name, studentId, enrolledAt, memoriesFound: found.size, highScores, minigameInfo,
      stats: {
        roomsExplored: visitedZones.size, totalRooms: ZONE_IDS.length,
        daysAttended: visitDays.size,
        lunchesBought, tradesCompleted, giftsGiven, giftsReceived,
        cardsCollected: Object.keys(cards).length, totalCards: CARDS.length,
      },
    });
    renderCardPicker($("th-profile-cards"), cards, new Set(), { readonly: true });
    profileOverlay.hidden = false;
  }
  function closeProfile() { profileOverlay.hidden = true; }
  $("th-btn-profile")?.addEventListener("click", openProfile);
  $("th-profile-close")?.addEventListener("click", closeProfile);

  // ----------------------------------------------------------- cafeteria
  const cafeteriaOverlay = $("th-cafeteria-overlay");
  const cafeteriaMenuEl = $("th-cafeteria-menu");
  const cafeteriaSpecialEl = $("th-cafeteria-special");
  const cafeteriaOrderStep = $("th-cafeteria-order-step");
  const cafeteriaIdStep = $("th-cafeteria-id-step");
  const cafeteriaDoneStep = $("th-cafeteria-done-step");
  const cafeteriaCountEl = $("th-cafeteria-count");
  const cafeteriaCheckoutBtn = $("th-cafeteria-checkout");
  const cafeteriaIdForm = $("th-cafeteria-id-form");
  const cafeteriaIdInput = $("th-cafeteria-id-input");
  const cafeteriaIdStatus = $("th-cafeteria-id-status");
  const cafeteriaDoneMsg = $("th-cafeteria-done-msg");
  let cafeteriaSelected = new Set();

  cafeteriaMenuEl.innerHTML = "";
  for (const item of CAFETERIA_MENU) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "th-cafeteria-item";
    btn.dataset.id = item.id;
    btn.innerHTML = `<span class="icon">${item.icon}</span><span>${item.name}</span>`;
    btn.addEventListener("click", () => {
      if (cafeteriaSelected.has(item.id)) cafeteriaSelected.delete(item.id);
      else cafeteriaSelected.add(item.id);
      btn.classList.toggle("is-selected", cafeteriaSelected.has(item.id));
      cafeteriaCountEl.textContent = `${cafeteriaSelected.size} item${cafeteriaSelected.size === 1 ? "" : "s"} selected`;
      cafeteriaCheckoutBtn.disabled = cafeteriaSelected.size === 0;
    });
    cafeteriaMenuEl.appendChild(btn);
  }

  function openCafeteria() {
    const special = todaysEventId === "pizza-friday" ? PIZZA_FRIDAY_SPECIAL : todaysLunch(today);
    cafeteriaSpecialEl.textContent = `Today's special: ${special.icon} ${special.name} — ${special.flavor}`;
    cafeteriaSelected = new Set();
    cafeteriaMenuEl.querySelectorAll(".th-cafeteria-item").forEach(b => b.classList.remove("is-selected"));
    cafeteriaCountEl.textContent = "0 items selected";
    cafeteriaCheckoutBtn.disabled = true;
    cafeteriaIdInput.value = "";
    cafeteriaIdStatus.textContent = "";
    cafeteriaIdStatus.className = "";
    cafeteriaMenuEl.hidden = false;
    cafeteriaOrderStep.hidden = false;
    cafeteriaIdStep.hidden = true;
    cafeteriaDoneStep.hidden = true;
    cafeteriaOverlay.hidden = false;
  }
  function closeCafeteria() { cafeteriaOverlay.hidden = true; }
  cafeteriaCheckoutBtn.addEventListener("click", () => {
    cafeteriaMenuEl.hidden = true;
    cafeteriaOrderStep.hidden = true;
    cafeteriaIdStep.hidden = false;
    cafeteriaIdInput.focus();
  });
  cafeteriaIdForm.addEventListener("submit", e => {
    e.preventDefault();
    if (normalizeStudentId(cafeteriaIdInput.value) === normalizeStudentId(studentId)) {
      cafeteriaIdStep.hidden = true;
      cafeteriaDoneStep.hidden = false;
      cafeteriaDoneMsg.textContent = `Order placed for ${cafeteriaSelected.size} item${cafeteriaSelected.size === 1 ? "" : "s"} — enjoy your lunch, ${identity.name}!`;
      markDailyTask("lunch");
      lunchesBought++; saveDirty = true;
    } else {
      cafeteriaIdStatus.textContent = "That doesn't match your student ID. Check your profile and try again.";
      cafeteriaIdStatus.className = "is-error";
    }
  });
  $("th-cafeteria-close")?.addEventListener("click", closeCafeteria);

  addEventListener("keydown", e => {
    if (e.code !== "KeyM" || e.target.tagName === "INPUT") return;
    if (!running) return;
    if (mapOverlay.hidden) { if (!memoryEl && !dialogueEl && !chatOpen && lbOverlay.hidden && arcadeOverlay.hidden && minigameOverlay.hidden && profileOverlay.hidden && cafeteriaOverlay.hidden && orientationOverlay.hidden && scheduleOverlay.hidden && tradeOverlay.hidden && bedroomOverlay.hidden && yearbookOverlay.hidden) openMap(); }
    else closeMap();
  });

  // -------------------------------------------------------- orientation
  // Shown once per account after the first Start click — not a design-doc
  // item, added from direct feedback alongside the schedule/tasks below.
  const orientationOverlay = $("th-orientation-overlay");
  const orientationElectivesEl = $("th-orientation-electives");
  let orientationPick = elective;
  orientationElectivesEl.innerHTML = "";
  for (const e of ELECTIVES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "th-orientation-elective" + (e.id === orientationPick ? " is-selected" : "");
    btn.textContent = e.label;
    btn.addEventListener("click", () => {
      orientationPick = e.id;
      orientationElectivesEl.querySelectorAll(".th-orientation-elective").forEach(b => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
    });
    orientationElectivesEl.appendChild(btn);
  }
  function openOrientation() { orientationOverlay.hidden = false; }
  function finishOrientation() {
    elective = orientationPick;
    orientationDone = true;
    saveDirty = true;
    persist();
    orientationOverlay.hidden = true;
  }
  $("th-orientation-start")?.addEventListener("click", finishOrientation);

  // ------------------------------------------------------------ schedule
  const scheduleOverlay = $("th-schedule-overlay");
  const scheduleTableBody = $("th-schedule-table").querySelector("tbody");
  const scheduleTasksEl = $("th-schedule-tasks");
  const scheduleEventEl = $("th-schedule-event");
  const scheduleAnnouncementEl = $("th-schedule-announcement");
  const scheduleSpecialEventEl = $("th-schedule-special-event");
  if (todaysEventInfo) {
    scheduleSpecialEventEl.hidden = false;
    scheduleSpecialEventEl.textContent = `${todaysEventInfo.icon} ${todaysEventInfo.name} today!`;
  }
  function openSchedule() {
    scheduleEventEl.textContent = todaysEvent(today);
    scheduleAnnouncementEl.textContent = `📌 ${todaysAnnouncement(today)}`;
    const nowPeriod = clock.now().period;
    scheduleTableBody.innerHTML = "";
    for (const row of buildSchedule(elective)) {
      const tr = document.createElement("tr");
      if (row.period === nowPeriod) tr.className = "is-current";
      tr.innerHTML = `<td>${row.period}</td><td>${row.subject}</td><td>${row.zoneName}</td>`;
      scheduleTableBody.appendChild(tr);
    }
    scheduleTasksEl.innerHTML = "";
    for (const task of DAILY_TASKS) {
      const li = document.createElement("li");
      const done = !!dailyFlags[task.id];
      if (done) li.classList.add("is-done");
      li.textContent = (done ? "☑ " : "☐ ") + task.label;
      scheduleTasksEl.appendChild(li);
    }
    scheduleOverlay.hidden = false;
  }
  function closeSchedule() { scheduleOverlay.hidden = true; }
  $("th-btn-schedule")?.addEventListener("click", openSchedule);
  $("th-schedule-close")?.addEventListener("click", closeSchedule);

  // -------------------------------------------------------- bedroom
  const bedroomOverlay = $("th-bedroom-overlay");
  const bedroomSlotsEl = $("th-bedroom-slots");
  const bedroomUnlockedEl = $("th-bedroom-unlocked");
  const bedroomLockedEl = $("th-bedroom-locked");

  // Flags/sets NPC memoryLines' conditions can check (relations.js Phase 2)
  // — deliberately just a read-only view of state that's already tracked
  // for other reasons (stats, bedroom, save data), no new grind.
  function relationContext() {
    return {
      visitedZones, clubMember, giftsGiven, giftsReceived, tradesCompleted,
      lunchesBought, daysAttended: visitDays.size,
      cardsCollected: Object.keys(cards).length,
      highScores, npcRelations,
      metTrollface: !!npcRelations["trollface"],
    };
  }
  function bedroomStats() {
    return {
      highScores, cardsCollected: Object.keys(cards).length,
      roomsExplored: visitedZones.size, tradesCompleted, lunchesBought, giftsReceived,
      daysAttended: visitDays.size,
      hasFamiliarNPC: Object.values(npcRelations).some(r => r.timesTalked >= 3),
      metTrollface: !!npcRelations["trollface"],
      clubMember,
    };
  }
  function renderBedroom() {
    const stats = bedroomStats();
    const unlockedIds = new Set(DECORATIONS.filter(d => d.unlocked(stats)).map(d => d.id));

    bedroomSlotsEl.innerHTML = "";
    for (const slot of BEDROOM_SLOTS) {
      const decoId = bedroomEquipped[slot];
      const deco = decoId && decorationById(decoId);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "th-bedroom-slot" + (deco ? " is-filled" : "");
      btn.innerHTML = `<span class="icon">${deco ? deco.icon : "➕"}</span><span class="label">${slot}</span>`;
      btn.addEventListener("click", () => {
        // Cycle: empty -> each unlocked decoration not already equipped
        // elsewhere -> empty again.
        const available = [null, ...DECORATIONS.filter(d => unlockedIds.has(d.id) && (bedroomEquipped[slot] === d.id || !Object.values(bedroomEquipped).includes(d.id)))];
        const curIdx = available.findIndex(d => (d ? d.id : null) === (bedroomEquipped[slot] || null));
        const next = available[(curIdx + 1) % available.length];
        bedroomEquipped[slot] = next ? next.id : null;
        saveDirty = true;
        persist();
        renderBedroom();
      });
      bedroomSlotsEl.appendChild(btn);
    }

    bedroomUnlockedEl.innerHTML = "";
    const unlocked = DECORATIONS.filter(d => unlockedIds.has(d.id));
    if (unlocked.length === 0) {
      const p = document.createElement("p");
      p.textContent = "Nothing unlocked yet — click a slot above once you do.";
      bedroomUnlockedEl.appendChild(p);
    } else {
      for (const d of unlocked) {
        const equippedSlot = Object.keys(bedroomEquipped).find(s => bedroomEquipped[s] === d.id);
        const el = document.createElement("div");
        el.className = "th-trade-card" + (equippedSlot ? " is-selected" : "");
        el.innerHTML = `<span class="icon">${d.icon}</span><span>${d.name}</span>`;
        bedroomUnlockedEl.appendChild(el);
      }
    }

    bedroomLockedEl.innerHTML = "";
    for (const d of DECORATIONS.filter(d => !unlockedIds.has(d.id))) {
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `<span class="icon">${d.icon}</span><span>${d.hint}</span>`;
      bedroomLockedEl.appendChild(el);
    }
  }
  function openBedroom() { renderBedroom(); bedroomOverlay.hidden = false; }
  function closeBedroom() { bedroomOverlay.hidden = true; }
  $("th-btn-bedroom")?.addEventListener("click", openBedroom);
  $("th-bedroom-close")?.addEventListener("click", closeBedroom);

  // ------------------------------------------------------- yearbook
  const yearbookOverlay = $("th-yearbook-overlay");
  const yearbookCaptureBtn = $("th-yearbook-capture");
  const yearbookStatusEl = $("th-yearbook-status");
  const yearbookGridEl = $("th-yearbook-grid");

  function renderYearbook() {
    yearbookGridEl.innerHTML = "";
    for (const p of photos) {
      const el = document.createElement("div");
      el.className = "th-yearbook-photo";
      const when = new Date(p.takenAt).toLocaleDateString();
      el.innerHTML = `<img src="${p.url}" alt="${p.zoneName || "a photo"}"><span class="cap">${p.zoneName || "?"} · ${when}</span>`;
      yearbookGridEl.appendChild(el);
    }
    yearbookCaptureBtn.disabled = photos.length >= MAX_PHOTOS;
    yearbookCaptureBtn.textContent = photos.length >= MAX_PHOTOS ? "Roll is full" : "Take a photo";
  }
  function openYearbook() { yearbookStatusEl.hidden = true; renderYearbook(); yearbookOverlay.hidden = false; }
  function closeYearbook() { yearbookOverlay.hidden = true; }
  $("th-btn-yearbook")?.addEventListener("click", openYearbook);
  $("th-yearbook-close")?.addEventListener("click", closeYearbook);
  yearbookCaptureBtn.addEventListener("click", async () => {
    yearbookCaptureBtn.disabled = true;
    yearbookStatusEl.hidden = true;
    const result = await capturePhoto(renderer.canvas, session.userId, { zoneId: zone.id, zoneName: zone.name });
    if (result.ok) {
      photos = addPhotoToRoll(photos, result.photo);
      saveDirty = true;
      persist();
      renderYearbook();
    } else {
      yearbookStatusEl.hidden = false;
      yearbookStatusEl.textContent = result.reason;
      yearbookCaptureBtn.disabled = photos.length >= MAX_PHOTOS;
    }
  });

  // ------------------------------------------------- trading + gifting
  // Each client only ever mutates its own inventory, applied in response
  // to a message from the other player's client — no server-arbitrated
  // trade ledger, which is fine for flavor-only collectibles (cards.js).
  const giftToast = $("th-gift-toast");
  let giftToastTimer = null;
  function showToast(text) {
    giftToast.textContent = text;
    giftToast.hidden = false;
    clearTimeout(giftToastTimer);
    giftToastTimer = setTimeout(() => { giftToast.hidden = true; }, 4000);
  }

  const tradeOverlay = $("th-trade-overlay");
  const tradeTitle = $("th-trade-title");
  const tradeProposeStep = $("th-trade-propose");
  const tradeWaitingStep = $("th-trade-waiting");
  const tradeIncomingStep = $("th-trade-incoming");
  const tradeDoneStep = $("th-trade-done");
  const tradeMyCardsEl = $("th-trade-my-cards");
  const tradeSendBtn = $("th-trade-send");
  const tradeProposeHint = $("th-trade-propose-hint");
  const tradeModeTradeBtn = $("th-trade-mode-trade");
  const tradeModeGiftBtn = $("th-trade-mode-gift");
  const tradeWaitingMsg = $("th-trade-waiting-msg");
  const tradeCancelBtn = $("th-trade-cancel");
  const tradeIncomingMsg = $("th-trade-incoming-msg");
  const tradeIncomingOfferEl = $("th-trade-incoming-offer");
  const tradeCounterCardsEl = $("th-trade-counter-cards");
  const tradeAcceptBtn = $("th-trade-accept");
  const tradeDeclineBtn = $("th-trade-decline");
  const tradeDoneMsg = $("th-trade-done-msg");

  let tradeMode = "trade"; // "trade" | "gift"
  let tradeTargetId = null, tradeTargetName = null;
  let tradeSelected = new Set();     // cards I'm offering (propose step)
  let tradeCounterSelected = new Set(); // cards I'm offering back (incoming step)
  let tradePendingOffer = null;      // {peerId, name, cards} while showing an incoming offer

  function renderCardPicker(container, sourceCounts, selectedSet, { readonly = false, single = false } = {}) {
    container.innerHTML = "";
    const ids = Object.keys(sourceCounts).filter(id => sourceCounts[id] > 0);
    if (ids.length === 0) {
      const p = document.createElement("p");
      p.textContent = "Nothing here yet.";
      container.appendChild(p);
      return;
    }
    for (const id of ids) {
      const card = cardById(id);
      if (!card) continue;
      const el = document.createElement(readonly ? "div" : "button");
      if (!readonly) el.type = "button";
      el.className = "th-trade-card" + (selectedSet.has(id) ? " is-selected" : "");
      el.innerHTML = `<span class="icon">${card.icon}</span><span>${card.name}</span><span class="count">x${sourceCounts[id]}</span>`;
      if (!readonly) {
        el.addEventListener("click", () => {
          if (single) { selectedSet.clear(); selectedSet.add(id); }
          else if (selectedSet.has(id)) selectedSet.delete(id);
          else selectedSet.add(id);
          renderCardPicker(container, sourceCounts, selectedSet, { readonly, single });
          tradeSendBtn.disabled = tradeSelected.size === 0;
        });
      }
      container.appendChild(el);
    }
  }

  function showTradeStep(name) {
    tradeProposeStep.hidden = name !== "propose";
    tradeWaitingStep.hidden = name !== "waiting";
    tradeIncomingStep.hidden = name !== "incoming";
    tradeDoneStep.hidden = name !== "done";
  }
  function setTradeMode(mode) {
    tradeMode = mode;
    tradeSelected = new Set();
    tradeModeTradeBtn.classList.toggle("is-active", mode === "trade");
    tradeModeGiftBtn.classList.toggle("is-active", mode === "gift");
    tradeTitle.textContent = (mode === "trade" ? "Trade with " : "Gift to ") + tradeTargetName;
    tradeProposeHint.textContent = mode === "trade" ? "Pick cards to offer:" : "Pick one card to gift:";
    tradeSendBtn.textContent = mode === "trade" ? "Send Offer ▶" : "Send Gift 🎁";
    renderCardPicker(tradeMyCardsEl, cards, tradeSelected, { single: mode === "gift" });
    tradeSendBtn.disabled = true;
  }
  function openTrade(peerId, peerName) {
    tradeTargetId = peerId; tradeTargetName = peerName;
    setTradeMode("trade");
    showTradeStep("propose");
    tradeOverlay.hidden = false;
  }
  function closeTrade() {
    tradeOverlay.hidden = true;
    tradePendingOffer = null;
  }

  tradeModeTradeBtn.addEventListener("click", () => setTradeMode("trade"));
  tradeModeGiftBtn.addEventListener("click", () => setTradeMode("gift"));

  tradeSendBtn.addEventListener("click", () => {
    const chosen = [...tradeSelected];
    if (chosen.length === 0) return;
    if (tradeMode === "gift") {
      const id = chosen[0];
      removeCard(id);
      giftsGiven++; saveDirty = true;
      persist();
      net.sendGift(tradeTargetId, id);
      tradeDoneMsg.textContent = `Sent a ${cardById(id).name} to ${tradeTargetName}!`;
      showTradeStep("done");
    } else {
      net.sendTradeOffer(tradeTargetId, chosen.map(id => ({ id, count: 1 })));
      tradeWaitingMsg.textContent = `Waiting for ${tradeTargetName} to respond…`;
      showTradeStep("waiting");
    }
  });
  tradeCancelBtn.addEventListener("click", () => {
    net.sendTradeDecline(tradeTargetId);
    closeTrade();
  });
  tradeAcceptBtn.addEventListener("click", () => {
    if (!tradePendingOffer) return;
    const { peerId, name, cards: offerCards } = tradePendingOffer;
    for (const c of offerCards) addCard(c.id, c.count);
    for (const id of tradeCounterSelected) removeCard(id, 1);
    tradesCompleted++; saveDirty = true;
    persist();
    net.sendTradeAccept(peerId, [...tradeCounterSelected].map(id => ({ id, count: 1 })));
    tradeDoneMsg.textContent = `Trade with ${name} complete!`;
    tradePendingOffer = null;
    showTradeStep("done");
  });
  tradeDeclineBtn.addEventListener("click", () => {
    if (tradePendingOffer) net.sendTradeDecline(tradePendingOffer.peerId);
    tradePendingOffer = null;
    closeTrade();
  });
  $("th-trade-close")?.addEventListener("click", () => {
    if (!tradeWaitingStep.hidden) net.sendTradeDecline(tradeTargetId);
    else if (!tradeIncomingStep.hidden && tradePendingOffer) net.sendTradeDecline(tradePendingOffer.peerId);
    closeTrade();
  });

  net.onTradeOffer = (peerId, name, offerCards) => {
    // Already mid-trade with someone else — decline instead of clobbering state.
    if (!tradeOverlay.hidden && tradeTargetId && tradeTargetId !== peerId) {
      net.sendTradeDecline(peerId);
      return;
    }
    tradeTargetId = peerId; tradeTargetName = name;
    tradePendingOffer = { peerId, name, cards: offerCards };
    tradeCounterSelected = new Set();
    tradeTitle.textContent = `Trade with ${name}`;
    tradeIncomingMsg.textContent = `${name} wants to trade! They're offering:`;
    renderCardPicker(tradeIncomingOfferEl, Object.fromEntries(offerCards.map(c => [c.id, c.count])), new Set(), { readonly: true });
    renderCardPicker(tradeCounterCardsEl, cards, tradeCounterSelected, {});
    showTradeStep("incoming");
    tradeOverlay.hidden = false;
  };
  net.onTradeAccept = (peerId, name, counterCards) => {
    if (peerId !== tradeTargetId || tradeWaitingStep.hidden) return;
    for (const id of tradeSelected) removeCard(id, 1);
    for (const c of counterCards) addCard(c.id, c.count);
    tradesCompleted++; saveDirty = true;
    persist();
    tradeDoneMsg.textContent = `Trade with ${name} complete!`;
    showTradeStep("done");
  };
  net.onTradeDecline = (peerId, name) => {
    if (peerId !== tradeTargetId) return;
    if (!tradeWaitingStep.hidden) {
      tradeDoneMsg.textContent = `${name} declined the trade.`;
      showTradeStep("done");
    } else if (!tradeIncomingStep.hidden && tradePendingOffer && tradePendingOffer.peerId === peerId) {
      tradePendingOffer = null;
      closeTrade();
    }
  };
  net.onGift = (peerId, name, cardId) => {
    addCard(cardId, 1);
    giftsReceived++; saveDirty = true;
    persist();
    const card = cardById(cardId);
    showToast(`🎁 ${name} gave you a ${card ? card.name : "card"}!`);
  };

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
    if (activeMinigame) {
      const { kind, score } = activeMinigame;
      if (score > (highScores[kind] || 0)) {
        highScores[kind] = score; saveDirty = true;
        const won = maybeAwardCard();
        if (won) { addCard(won); showToast(`🃏 New high score! Earned a ${cardById(won).name} card.`); }
      }
      markDailyTask("minigame");
      activeMinigame.stop();
    }
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
    const joiningClub = isNew && obj.type === "club-charter" && !clubMember;
    memoryEl.innerHTML =
      `<h3>${mem.title}${isNew ? " ✨" : ""}</h3><p>${mem.text}</p>` +
      (joiningClub ? `<p><b>You sign your name under the one other member. You're in the club now.</b></p>` : "") +
      (obj.def.screen ? `<canvas class="th-mem-screen" width="120" height="90"></canvas>` : "") +
      `<div class="th-mem-close">E / tap — close</div>`;
    memoryEl.addEventListener("click", closeMemory);
    $("th-root").appendChild(memoryEl);
    if (isNew) {
      found.add(obj.memKey);
      markDailyTask("memory");
      if (joiningClub) { clubMember = true; showToast("📝 You're a member of the club now."); }
      const won = maybeAwardCard();
      if (won) { addCard(won); showToast(`🃏 Found a ${cardById(won).name} card!`); }
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
    const npcId = npc.def.id;
    const relation = npcRelations[npcId] || (npcRelations[npcId] = { timesTalked: 0 });
    const line = pickDialogueLine(npc.def, relation, relationContext()) || npc.speak();
    relation.timesTalked++;
    relation.lastTalkedAt = Date.now();
    saveDirty = true;
    dialogueEl = document.createElement("div");
    dialogueEl.id = "th-dialogue";
    dialogueEl.className = "th-popup-card";
    dialogueEl.setAttribute("role", "dialog");
    dialogueEl.setAttribute("aria-label", npc.name);
    dialogueEl.innerHTML =
      `<h3>${npc.name} <span class="th-npc-tag">NPC</span></h3><p>${line}</p>` +
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
    visitedZones.add(zone.id);
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
    if (!running || memoryEl || dialogueEl || !lbOverlay.hidden || !arcadeOverlay.hidden || !minigameOverlay.hidden || !mapOverlay.hidden || !profileOverlay.hidden || !cafeteriaOverlay.hidden || !orientationOverlay.hidden || !scheduleOverlay.hidden || !tradeOverlay.hidden || !bedroomOverlay.hidden || !yearbookOverlay.hidden) return;
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
    get profileOpen() { return !profileOverlay.hidden; },
    get cafeteriaOpen() { return !cafeteriaOverlay.hidden; },
    get orientationOpen() { return !orientationOverlay.hidden; },
    get scheduleOpen() { return !scheduleOverlay.hidden; },
    get tradeOpen() { return !tradeOverlay.hidden; },
    get bedroomOpen() { return !bedroomOverlay.hidden; },
    get yearbookOpen() { return !yearbookOverlay.hidden; },
    openYearbook, closeYearbook,
    get photos() { return photos; },
    openBedroom, closeBedroom,
    get bedroomEquipped() { return bedroomEquipped; },
    get bedroomStats() { return bedroomStats(); },
    get todaysEventId() { return todaysEventId; },
    get clubMember() { return clubMember; },
    renderer, // exposed for test/dev inspection of weather + tint rendering
    openTrade, closeTrade,
    get cards() { return cards; },
    get npcRelations() { return npcRelations; },
    get lifeStats() {
      return {
        roomsExplored: visitedZones.size, totalRooms: ZONE_IDS.length,
        daysAttended: visitDays.size, lunchesBought, tradesCompleted, giftsGiven, giftsReceived,
      };
    },
    addCard, removeCard,
    openSchedule, closeSchedule, finishOrientation,
    get dailyFlags() { return dailyFlags; },
    get elective() { return elective; },
    openCafeteria, closeCafeteria,
    openProfile, closeProfile,
    get studentId() { return studentId; },
    get highScores() { return highScores; },
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
    if (!running) { renderer.frame(zone, [player.entity()], 0, todaysEventInfo?.tint, todaysEventId); return; }

    // fade-driven zone transition
    if (pendingDoor) {
      fade = Math.min(1, fade + dt * 4);
      if (fade >= 1) { switchZone(pendingDoor); pendingDoor = null; }
    } else if (fade > 0) {
      fade = Math.max(0, fade - dt * 4);
    }

    if (!pendingDoor && !memoryEl && !dialogueEl && !chatOpen && lbOverlay.hidden && arcadeOverlay.hidden && minigameOverlay.hidden && mapOverlay.hidden && profileOverlay.hidden && cafeteriaOverlay.hidden && orientationOverlay.hidden && scheduleOverlay.hidden && tradeOverlay.hidden && bedroomOverlay.hidden && yearbookOverlay.hidden) {
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
    let nearPeer = null;
    if (!nearNPC) {
      for (const [pid, p] of net.liveGhosts()) {
        if (Math.hypot(p.x - player.x, p.y - player.y) < 26) { nearPeer = { id: pid, name: p.name || "a student" }; break; }
      }
    }
    const face = player.facingTile();
    const obj = zone.objectAt(face.x, face.y);
    const mem = obj && (obj.memory || obj.def.memory);
    const play = obj && (obj.play || obj.def.play);
    const shop = obj && (obj.shop || obj.def.shop);
    const arcadeHint = obj && obj.game ? ` Play ${obj.gameName || "a game"}` : null;
    const playHint = play ? ` Play ${obj.playName || obj.def.playName || minigameInfo(play).title}` : null;
    const shopHint = shop ? " Get lunch" : null;
    const peerHint = nearPeer ? ` Trade with ${nearPeer.name}` : null;
    setHint((memoryEl || dialogueEl || !arcadeOverlay.hidden || !minigameOverlay.hidden || !mapOverlay.hidden || !profileOverlay.hidden || !cafeteriaOverlay.hidden || !orientationOverlay.hidden || !scheduleOverlay.hidden || !tradeOverlay.hidden || !bedroomOverlay.hidden || !yearbookOverlay.hidden) ? null : nearNPC ? ` Talk to ${nearNPC.name}` : (peerHint || arcadeHint || playHint || shopHint || (mem ? ` ${mem.title}` : null)));
    if (input.interactPressed() && mapOverlay.hidden && profileOverlay.hidden && orientationOverlay.hidden && scheduleOverlay.hidden && bedroomOverlay.hidden && yearbookOverlay.hidden) {
      if (!tradeOverlay.hidden) closeTrade();
      else if (!cafeteriaOverlay.hidden) closeCafeteria();
      else if (!minigameOverlay.hidden) closeMinigame();
      else if (!arcadeOverlay.hidden) closeArcade();
      else if (dialogueEl) closeDialogue();
      else if (memoryEl) closeMemory();
      else if (nearNPC) showDialogue(nearNPC);
      else if (nearPeer) openTrade(nearPeer.id, nearPeer.name);
      else if (obj && obj.game) openArcade(obj);
      else if (play) openMinigame(obj);
      else if (shop) openCafeteria();
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

      if (lastPeriod !== null && lastPeriod !== now.period) {
        ambience.ringBell();
        // "make the school feel alive" — NPCs with a schedule appear/leave
        // live as the period changes, even if the player stays in the room.
        npcs = getNPCs(zone);
      }
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
    renderer.frame(zone, entities, fade, todaysEventInfo?.tint, todaysEventId);
  }
  requestAnimationFrame(tick);
}

boot();
