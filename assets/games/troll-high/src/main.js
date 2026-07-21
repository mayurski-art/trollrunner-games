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
import { sanitizeClubName } from "./club.js";
import { SLOTS as BEDROOM_SLOTS, DECORATIONS, decorationById } from "./bedroom.js";
import { capturePhoto, addPhotoToRoll, MAX_PHOTOS, sharePhoto, fetchSharedPhotos } from "./camera.js";
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
  // §23 Phase 7 — The Hidden World, expanded further (deliberately not
  // resolved): a third unmarked door out of the Underground HQ.
  "flooded-passage",
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

  // Declared here (not down by the rest of the orientation block below) —
  // onStart() can fire synchronously from `if (pendingStart) onStart()`
  // moments after bootReady flips true, which is BEFORE execution reaches
  // the orientation block's own section of this function. A `const`
  // declared there would still be in its temporal dead zone at that point
  // (real bug, found via troll-high-shared-yearbook-smoke.js: a slow
  // real-signup network round trip widens the window for a click to land
  // mid-boot and get queued as pendingStart, then replayed through this
  // exact path).
  const orientationOverlay = $("th-orientation-overlay");

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
  // Real multi-club system (design doc §23 Phase 6) — reading the club
  // charter in the Underground HQ (finding it at all is gated behind the
  // full secrets chain, same as meeting Trollface) either founds a new,
  // named club or joins one you've actually seen a live player represent.
  // `club` is the source of truth; `clubMember` stays as a plain derived
  // boolean since bedroom.js/relations.js/relationContext() already key
  // off it. Old saves from before this system only had `clubMember: true`
  // with no name — those become an unnamed founded club, not lost.
  let club = savedGame?.club || (savedGame?.clubMember ? { name: "The Club", founded: true } : null);
  let clubMember = !!club;
  // Graduation (design doc §23 Phase 6 capstone) — the one PERSISTED
  // trait among the six Multiplayer Memories slices; the other five are
  // deliberately session-scoped ("a real thing happening right now").
  let graduatedAt = savedGame?.graduatedAt || null;
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

  // Daily-life habits (design doc §23 Phase 3) — "the game reflects your
  // own routine back at you," not new stats to grind. zoneVisitCounts
  // tracks how many times each room's been entered (visitedZones is only
  // presence, not frequency) so a "usually found in" favorite spot can be
  // read off it; claimedSpots remembers the first locker/bench you ever
  // interacted with — "yours" from then on, purely a naming/flavor thing.
  const zoneVisitCounts = savedGame?.zoneVisitCounts || {};
  const claimedSpots = savedGame?.claimedSpots || {};
  zoneVisitCounts[zone.id] = (zoneVisitCounts[zone.id] || 0) + 1;

  function persist() {
    if (!saveDirty) return;
    saveDirty = false;
    saveGame(session.userId, {
      zoneId: zone.id, x: player.x, y: player.y, foundKeys: [...found], studentId, enrolledAt, highScores,
      orientationDone, elective, dailyTasksDay, dailyFlags, cards,
      visitedZones: [...visitedZones], visitDays: [...visitDays], lunchesBought, tradesCompleted, giftsGiven, giftsReceived,
      npcRelations, bedroomEquipped, photos, clubMember, zoneVisitCounts, claimedSpots, club, graduatedAt,
    });
  }
  setInterval(persist, 30000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) persist(); });
  addEventListener("beforeunload", persist);

  // ------------------------------------------------------------ multiplayer
  const net = new Net(identity);
  net.setClub(club?.name || null);
  net.setGraduated(!!graduatedAt);
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
    ambience.setDancing(todaysEventId === "dance" && zone.id === "auditorium");
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
  let mapRects = [];
  // school building is "open" on weekdays outside the Night period; the
  // corridors/fields/downtown/woods rows never lock (see mapview.js indoor
  // flag) since those are hangout spots, not class time.
  function campusOpen() {
    const t = clock.now();
    return t.weekday !== "Sat" && t.weekday !== "Sun" && t.period !== "Night";
  }
  function openMap() {
    mapOverlay.hidden = false;
    mapRects = drawCampusMap(mapCanvas, zone.id, campusOpen());
    markDailyTask("map");
  }
  function closeMap() { mapOverlay.hidden = true; }
  function mapRoomAt(evt) {
    const r = mapCanvas.getBoundingClientRect();
    const x = (evt.clientX - r.left) * (mapCanvas.width / r.width);
    const y = (evt.clientY - r.top) * (mapCanvas.height / r.height);
    return mapRects.find(room => x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h);
  }
  $("th-btn-map")?.addEventListener("click", openMap);
  $("th-map-close")?.addEventListener("click", closeMap);
  mapCanvas.addEventListener("mousemove", evt => {
    const room = mapRoomAt(evt);
    mapCanvas.style.cursor = room && !room.locked ? "pointer" : "default";
  });
  mapCanvas.addEventListener("click", evt => {
    const room = mapRoomAt(evt);
    if (!room) return;
    if (room.locked) { showToast("🔒 Locked until campus opens again"); return; }
    if (room.id === zone.id) { closeMap(); return; }
    closeMap();
    travelToZone(room.id);
  });

  // ------------------------------------------------------------- profile
  const profileOverlay = $("th-profile-overlay");
  const profileDom = {
    name: $("th-profile-name"), id: $("th-profile-id"), enrolled: $("th-profile-enrolled"),
    memories: $("th-profile-memories"), scores: $("th-profile-scores"),
    roomsExplored: $("th-profile-rooms-explored"), daysAttended: $("th-profile-days-attended"),
    lunchesBought: $("th-profile-lunches"), tradesCompleted: $("th-profile-trades"),
    giftsGiven: $("th-profile-gifts-given"), giftsReceived: $("th-profile-gifts-received"),
    cardsCollected: $("th-profile-cards-collected"),
    dailyLife: $("th-profile-daily-life"),
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
      dailyLife: {
        favoriteZone: favoriteZoneName(),
        hasLocker: !!claimedSpots.lockers,
        hasBench: !!claimedSpots["park-bench"],
        club,
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
    if (mapOverlay.hidden) { if (!memoryEl && !dialogueEl && !electionEl && !scienceFairEl && !graduationEl && !chatOpen && lbOverlay.hidden && arcadeOverlay.hidden && minigameOverlay.hidden && profileOverlay.hidden && cafeteriaOverlay.hidden && orientationOverlay.hidden && scheduleOverlay.hidden && tradeOverlay.hidden && bedroomOverlay.hidden && yearbookOverlay.hidden) openMap(); }
    else closeMap();
  });

  // -------------------------------------------------------- orientation
  // Shown once per account after the first Start click — not a design-doc
  // item, added from direct feedback alongside the schedule/tasks below.
  // (orientationOverlay itself is declared much earlier — see the comment
  // by bootReady above for why.)
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

  // Daily-life "claimed spot" flavor (design doc §23 Phase 3) — the first
  // locker or park bench you ever interact with becomes "yours"; every
  // other one of that type stays as generic flavor text. Purely cosmetic,
  // reusing the existing memory-card UI rather than a new system.
  const CLAIMABLE_SPOTS = {
    lockers: { title: "Your locker", text: "Locker's yours now. You could find it blindfolded by week two.", toast: "🔒 That's your locker now." },
    "park-bench": { title: "Your bench", text: "Your spot. You always end up back here, one way or another.", toast: "🪑 That's your bench now." },
  };
  function personalizeMemory(obj, mem) {
    const claimable = CLAIMABLE_SPOTS[obj.type];
    if (!claimable || !mem) return mem;
    const key = `${zone.id}:${obj.memKey}`;
    if (claimedSpots[obj.type] === key) return { title: claimable.title, text: claimable.text };
    return mem;
  }

  // "Usually found in" (design doc §23 Phase 3) — the most-entered room,
  // reading zoneVisitCounts back as a habit rather than a new stat to
  // grind. Hallways are excluded since everyone passes through those
  // constantly; that's not a "favorite spot," just the way through.
  const FAVORITE_ZONE_EXCLUDE = new Set(["hallway-a", "hallway-b"]);
  function favoriteZoneName() {
    let bestId = null, bestCount = 0;
    for (const [id, count] of Object.entries(zoneVisitCounts)) {
      if (FAVORITE_ZONE_EXCLUDE.has(id) || count <= bestCount) continue;
      bestId = id; bestCount = count;
    }
    return bestId ? getZone(bestId).name : null;
  }

  // Flags/sets NPC memoryLines' conditions can check (relations.js Phase 2)
  // — deliberately just a read-only view of state that's already tracked
  // for other reasons (stats, bedroom, save data), no new grind.
  function relationContext() {
    return {
      visitedZones, clubMember, club, giftsGiven, giftsReceived, tradesCompleted,
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
      clubMember, graduated: !!graduatedAt,
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
  // Shared Class Yearbook (design doc §23 Phase 6) — every photo any
  // player takes also indexes into troll_high_shared_photos
  // (docs/troll_high_shared_yearbook.sql), so this tab shows everyone's
  // photos, not just this player's own roll.
  const yearbookTabMine = $("th-yearbook-tab-mine");
  const yearbookTabClass = $("th-yearbook-tab-class");
  const yearbookPaneMine = $("th-yearbook-mine");
  const yearbookPaneClass = $("th-yearbook-class");
  const yearbookClassStatusEl = $("th-yearbook-class-status");
  const yearbookClassGridEl = $("th-yearbook-class-grid");

  function renderYearbook() {
    yearbookGridEl.innerHTML = "";
    for (const p of photos) {
      const el = document.createElement("div");
      el.className = "th-yearbook-photo";
      const when = new Date(p.takenAt).toLocaleDateString();
      const tag = p.eventTag ? ` · ${p.eventTag}` : "";
      el.innerHTML = `<img src="${p.url}" alt="${p.zoneName || "a photo"}"><span class="cap">${p.zoneName || "?"} · ${when}${tag}</span>`;
      yearbookGridEl.appendChild(el);
    }
    yearbookCaptureBtn.disabled = photos.length >= MAX_PHOTOS;
    yearbookCaptureBtn.textContent = photos.length >= MAX_PHOTOS ? "Roll is full" : "Take a photo";
  }
  async function renderClassYearbook() {
    yearbookClassStatusEl.hidden = true;
    yearbookClassGridEl.innerHTML = `<p class="th-yearbook-loading">Loading...</p>`;
    const shared = await fetchSharedPhotos();
    yearbookClassGridEl.innerHTML = "";
    if (shared.length === 0) {
      yearbookClassStatusEl.hidden = false;
      yearbookClassStatusEl.textContent = "No class photos yet — be the first to take one.";
      return;
    }
    for (const p of shared) {
      const el = document.createElement("div");
      el.className = "th-yearbook-photo";
      const when = new Date(p.taken_at).toLocaleDateString();
      const tag = p.event_tag ? ` · ${p.event_tag}` : "";
      el.innerHTML = `<img src="${p.url}" alt="${p.zone_name || "a photo"}"><span class="cap">${p.username} · ${p.zone_name || "?"} · ${when}${tag}</span>`;
      yearbookClassGridEl.appendChild(el);
    }
  }
  function switchYearbookTab(tab) {
    const onClass = tab === "class";
    yearbookTabMine.classList.toggle("is-active", !onClass);
    yearbookTabClass.classList.toggle("is-active", onClass);
    yearbookPaneMine.hidden = onClass;
    yearbookPaneClass.hidden = !onClass;
    if (onClass) renderClassYearbook();
  }
  yearbookTabMine.addEventListener("click", () => switchYearbookTab("mine"));
  yearbookTabClass.addEventListener("click", () => switchYearbookTab("class"));

  function openYearbook() { yearbookStatusEl.hidden = true; switchYearbookTab("mine"); renderYearbook(); yearbookOverlay.hidden = false; }
  function closeYearbook() { yearbookOverlay.hidden = true; }
  $("th-btn-yearbook")?.addEventListener("click", openYearbook);
  $("th-yearbook-close")?.addEventListener("click", closeYearbook);
  yearbookCaptureBtn.addEventListener("click", async () => {
    yearbookCaptureBtn.disabled = true;
    yearbookStatusEl.hidden = true;
    const result = await capturePhoto(renderer.canvas, session.userId, { zoneId: zone.id, zoneName: zone.name });
    if (result.ok) {
      // Real School Events / Multiplayer Memories (design doc §23 Phase
      // 4/6) — Picture Day tags whatever you shoot that real day; a
      // School Dance photo in the Auditorium, or one taken mid-
      // performance (either yours or someone else's — checked via any
      // live ghost's `performing`, not just your own), gets the same
      // treatment.
      const someoneOnStage = myPerforming || [...ghosts.values()].some(g => g.performing);
      const someoneAtScienceFair = myProject || [...ghosts.values()].some(g => g.project);
      if (todaysEventId === "picture-day") result.photo.eventTag = "Picture Day";
      else if (todaysEventId === "dance" && zone.id === "auditorium") result.photo.eventTag = "School Dance";
      else if (zone.id === "auditorium" && someoneOnStage) result.photo.eventTag = "Talent Show";
      else if (zone.id === "science-lab" && someoneAtScienceFair) result.photo.eventTag = "Science Fair";
      photos = addPhotoToRoll(photos, result.photo);
      saveDirty = true;
      persist();
      renderYearbook();
      sharePhoto(session.userId, identity.name, result.photo); // best-effort, no await needed
      if (todaysEventId === "picture-day") showToast("📸 That one's going in the yearbook — it's Picture Day.");
      else if (result.photo.eventTag === "School Dance") showToast("📸 That one's going in the yearbook — School Dance.");
      else if (result.photo.eventTag === "Talent Show") showToast("📸 That one's going in the yearbook — Talent Show.");
      else if (result.photo.eventTag === "Science Fair") showToast("📸 That one's going in the yearbook — Science Fair.");
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
        if (won) addCard(won);
        // Real School Events (design doc §23 Phase 4) — a PACER Test PR set
        // ON the official PACER Day gets its own callout, taking priority
        // over the (independent, chance-based) card-drop toast so the two
        // don't race — the card is still awarded either way, just not
        // announced this once.
        if (kind === "pacer-test" && todaysEventId === "pacer-day") {
          showToast("🏅 New PACER record — and it's PACER Day. Nice.");
        } else if (won) {
          showToast(`🃏 New high score! Earned a ${cardById(won).name} card.`);
        }
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
    const claimable = CLAIMABLE_SPOTS[obj.type];
    if (claimable && !claimedSpots[obj.type]) {
      claimedSpots[obj.type] = `${zone.id}:${obj.memKey}`;
      mem = { title: claimable.title, text: claimable.text };
      saveDirty = true;
      showToast(claimable.toast);
    }
    memoryEl = document.createElement("div");
    memoryEl.id = "th-memory";
    memoryEl.className = "th-popup-card";
    memoryEl.setAttribute("role", "dialog");
    memoryEl.setAttribute("aria-label", mem.title);
    const isNew = !found.has(obj.memKey);
    // Not gated on isNew — someone who closed the charter without founding
    // or joining a club last time should still get the prompt again next
    // visit, not just once ever.
    const joiningClub = obj.type === "club-charter" && !clubMember;
    if (joiningClub) {
      // Real multi-club system (§23 Phase 6) — "which clubs exist" is
      // genuinely whatever names other live players nearby are currently
      // broadcasting (net.js presence), not a persisted roster.
      const otherClubs = [...new Set([...ghosts.values()].map(g => g.club).filter(Boolean))];
      memoryEl.innerHTML =
        `<h3>${mem.title}${isNew ? " ✨" : ""}</h3><p>${mem.text}</p>` +
        `<div class="th-club-form">` +
        (otherClubs.length
          ? `<p><b>Clubs represented here right now:</b></p><div class="th-club-join-list">` +
            otherClubs.map(n => `<button type="button" class="th-club-join-btn" data-name="${n.replace(/"/g, "&quot;")}">Join "${n}"</button>`).join("") +
            `</div>`
          : "") +
        `<p><b>Or found your own:</b></p>` +
        `<input type="text" id="th-club-name-input" maxlength="24" placeholder="Name your club">` +
        `<button type="button" id="th-club-found-btn">Found this club</button>` +
        `</div>` +
        `<div class="th-mem-close">E / tap outside the form — close</div>`;
      memoryEl.querySelector(".th-club-form").addEventListener("click", e => e.stopPropagation());
      memoryEl.querySelectorAll(".th-club-join-btn").forEach(btn => {
        btn.addEventListener("click", () => joinClub(btn.dataset.name));
      });
      memoryEl.querySelector("#th-club-found-btn").addEventListener("click", () => {
        const input = memoryEl.querySelector("#th-club-name-input");
        joinClub(sanitizeClubName(input.value), true);
      });
    } else {
      memoryEl.innerHTML =
        `<h3>${mem.title}${isNew ? " ✨" : ""}</h3><p>${mem.text}</p>` +
        (obj.def.screen ? `<canvas class="th-mem-screen" width="120" height="90"></canvas>` : "") +
        `<div class="th-mem-close">E / tap — close</div>`;
    }
    memoryEl.addEventListener("click", closeMemory);
    $("th-root").appendChild(memoryEl);
    if (isNew) {
      found.add(obj.memKey);
      markDailyTask("memory");
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

  // Real multi-club system (§23 Phase 6) — founding names a brand new
  // club; joining adopts a name actually seen represented by a live
  // player nearby. Either way it's broadcast over presence (net.js) so
  // other players can see/join it too, with zero new backend.
  function joinClub(name, founded = false) {
    club = { name, founded };
    clubMember = true;
    net.setClub(name);
    saveDirty = true;
    persist();
    showToast(founded ? `📝 You founded "${name}."` : `📝 You joined "${name}."`);
    closeMemory();
  }

  // Student elections (design doc §23 Phase 6) — a live, session-scoped
  // poll at the auditorium's ballot box: no persisted ballot, no new
  // backend. Candidacy broadcasts over presence (net.setRunning, same
  // mechanism as club); votes are a lightweight broadcast message
  // (net.sendVote) each connected client tallies for itself into
  // votesReceived (voterId -> candidateId, so changing your vote just
  // overwrites your own entry — re-tallied fresh on every render, not
  // accumulated). Resets each session; this is "a real thing happening
  // right now," not a historical record.
  let myRunning = false;
  const votesReceived = new Map(); // voterId -> candidateId
  let electionEl = null;

  function electionCandidates() {
    const list = [...ghosts.values()].filter(g => g.running).map(g => ({ id: g.id, name: g.name }));
    if (myRunning) list.unshift({ id: net.id, name: identity.name + " (you)" });
    return list;
  }
  function voteTally(candidateId) {
    let n = 0;
    for (const forId of votesReceived.values()) if (forId === candidateId) n++;
    return n;
  }
  function castVote(candidateId) {
    votesReceived.set(net.id, candidateId); // count your own vote locally — broadcast is self:false
    net.sendVote(candidateId);
    renderElection();
  }
  function runForOffice() {
    myRunning = true;
    net.setRunning(true);
    showToast("🗳 You're running for Student Council.");
    renderElection();
  }
  net.onVote = (voterId, voterName, forId) => { votesReceived.set(voterId, forId); renderElection(); };

  function renderElection() {
    if (!electionEl) return;
    const candidates = electionCandidates();
    const myVote = votesReceived.get(net.id);
    electionEl.innerHTML =
      `<h3>Student Council Election</h3>` +
      `<p>Whoever's declared candidacy right now, and whoever's here to vote — all live, nothing saved after today.</p>` +
      `<div class="th-election-list">` +
      (candidates.length
        ? candidates.map(c => `<div class="th-election-row"><span>${c.name}</span><b>${voteTally(c.id)} vote${voteTally(c.id) === 1 ? "" : "s"}</b>` +
            `<button type="button" class="th-election-vote-btn" data-id="${c.id}" ${myVote === c.id ? "disabled" : ""}>${myVote === c.id ? "Voted" : "Vote"}</button></div>`).join("")
        : `<p><i>No declared candidates here right now.</i></p>`) +
      `</div>` +
      (myRunning ? "" : `<button type="button" id="th-election-run-btn">Run for Student Council</button>`) +
      `<div class="th-mem-close">E / tap outside the form — close</div>`;
    electionEl.querySelector(".th-election-list").addEventListener("click", e => e.stopPropagation());
    electionEl.querySelectorAll(".th-election-vote-btn").forEach(btn => {
      btn.addEventListener("click", e => { e.stopPropagation(); castVote(btn.dataset.id); });
    });
    electionEl.querySelector("#th-election-run-btn")?.addEventListener("click", e => { e.stopPropagation(); runForOffice(); });
  }
  function openElection() {
    closeElection();
    electionEl = document.createElement("div");
    electionEl.id = "th-election";
    electionEl.className = "th-popup-card";
    electionEl.setAttribute("role", "dialog");
    electionEl.setAttribute("aria-label", "Student Council Election");
    electionEl.addEventListener("click", closeElection);
    $("th-root").appendChild(electionEl);
    renderElection();
  }
  function closeElection() {
    if (electionEl) { electionEl.remove(); electionEl = null; }
  }

  // Dances (design doc §23 Phase 6) — the auditorium's dance floor is a
  // simple toggle, not a form: stepping on it broadcasts `dancing` over
  // presence (same mechanism as club/candidacy) so nearby real players
  // see a 💃 tag on your name tag, and toggles the synthesized beat
  // (audio.js's setDancing) for this player specifically. No persisted
  // state — like elections, this is "a real thing happening right now."
  let myDancing = false;
  function toggleDancing() {
    myDancing = !myDancing;
    net.setDancing(myDancing);
    showToast(myDancing ? "💃 You start dancing." : "🕺 You step off the dance floor.");
  }

  // Talent show (design doc §23 Phase 6) — same toggle pattern as the
  // dance floor, on the Auditorium's existing stage-curtain object (a
  // per-instance `perform: true` override in auditorium.json, not the
  // shared def — most stage-curtains elsewhere are flavor-only). No
  // real talent selection UI; a random flavor line stands in for "what
  // you performed," same spirit as the disposable camera standing in
  // for a real photo — the moment is what matters, not the mechanic.
  const PERFORMANCES = [
    "an air guitar solo that goes on slightly too long",
    "a magic trick that mostly works",
    "thirty seconds of freestyle rap you immediately regret",
    "a dramatic monologue nobody asked for",
    "an interpretive dance about Mondays",
    "a card trick where you clearly saw the card",
  ];
  let myPerforming = false;
  function togglePerforming() {
    myPerforming = !myPerforming;
    net.setPerforming(myPerforming);
    if (myPerforming) {
      const bit = PERFORMANCES[Math.floor(Math.random() * PERFORMANCES.length)];
      showToast(`🎤 You take the stage and do ${bit}.`);
    } else {
      showToast("🎤 You leave the stage.");
    }
  }

  // Science fair (design doc §23 Phase 6) — "temporary player-submitted
  // project displays," lighter/more ephemeral than the other Multiplayer
  // Memories slices: no vote, no calendar gating, just a live list of
  // whoever's currently presenting at the science lab's spare table
  // (a per-instance `scienceFair: true` override, same pattern as
  // `perform`). Presenting picks a random project title — same "moment
  // over mechanic" spirit as the talent show — and broadcasts it over
  // presence so it shows up in everyone's list, plus a 🧪 tag on your
  // name. Un-presenting clears it. Session-scoped, nothing persisted.
  const PROJECT_TITLES = [
    "Does Static Electricity Affect Hallway Gossip?",
    "The Physics of Cafeteria Trays",
    "Baking Soda Volcano But Bigger This Time",
    "Can Trollface Sightings Be Explained By Science?",
    "Which Vending Machine Snack Falls Fastest?",
    "A Study of Which Locker Combinations Get Forgotten Most",
  ];
  let myProject = null;
  let scienceFairEl = null;

  function scienceFairPresenters() {
    const list = [...ghosts.values()].filter(g => g.project).map(g => ({ id: g.id, name: g.name, project: g.project }));
    if (myProject) list.unshift({ id: net.id, name: identity.name + " (you)", project: myProject });
    return list;
  }
  function presentProject() {
    myProject = PROJECT_TITLES[Math.floor(Math.random() * PROJECT_TITLES.length)];
    net.setProject(myProject);
    showToast(`🧪 You set up your project: "${myProject}."`);
    renderScienceFair();
  }
  function withdrawProject() {
    myProject = null;
    net.setProject(null);
    showToast("🧪 You pack up your project.");
    renderScienceFair();
  }
  function renderScienceFair() {
    if (!scienceFairEl) return;
    const presenters = scienceFairPresenters();
    scienceFairEl.innerHTML =
      `<h3>Science Fair</h3>` +
      `<p>Whoever's set up a project right now — nothing saved after today.</p>` +
      `<div class="th-election-list">` +
      (presenters.length
        ? presenters.map(p => `<div class="th-election-row"><span>${p.name}</span><b>${p.project}</b></div>`).join("")
        : `<p><i>No projects set up right now.</i></p>`) +
      `</div>` +
      (myProject
        ? `<button type="button" id="th-sciencefair-withdraw-btn">Pack up my project</button>`
        : `<button type="button" id="th-sciencefair-present-btn">Present a project</button>`) +
      `<div class="th-mem-close">E / tap outside the form — close</div>`;
    scienceFairEl.querySelector(".th-election-list").addEventListener("click", e => e.stopPropagation());
    scienceFairEl.querySelector("#th-sciencefair-present-btn")?.addEventListener("click", e => { e.stopPropagation(); presentProject(); });
    scienceFairEl.querySelector("#th-sciencefair-withdraw-btn")?.addEventListener("click", e => { e.stopPropagation(); withdrawProject(); });
  }
  function openScienceFair() {
    closeScienceFair();
    scienceFairEl = document.createElement("div");
    scienceFairEl.id = "th-sciencefair";
    scienceFairEl.className = "th-popup-card";
    scienceFairEl.setAttribute("role", "dialog");
    scienceFairEl.setAttribute("aria-label", "Science Fair");
    scienceFairEl.addEventListener("click", closeScienceFair);
    $("th-root").appendChild(scienceFairEl);
    renderScienceFair();
  }
  function closeScienceFair() {
    if (scienceFairEl) { scienceFairEl.remove(); scienceFairEl = null; }
  }

  // Graduation (design doc §23 Phase 6 capstone) — unlike the five
  // session-scoped slices above, this is a real persisted milestone: the
  // office's reception counter (a per-instance `graduation: true`
  // override in office.json, not the shared def) either shows a "not
  // yet" note, a graduate-now summary once you've attended enough real
  // days, or your diploma recap forever after. Deliberately doesn't lock
  // the player out of anything — real school doesn't stop existing after
  // you graduate, and neither does this one.
  const GRADUATION_DAYS_REQUIRED = 5;
  let graduationEl = null;
  function graduationEligible() { return visitDays.size >= GRADUATION_DAYS_REQUIRED; }
  function graduate() {
    graduatedAt = Date.now();
    net.setGraduated(true);
    net.sendGraduationAnnounce();
    saveDirty = true;
    persist();
    showToast("🎓 Congratulations — you graduated!");
    renderGraduation();
  }
  net.onGraduationAnnounce = (peerId, name) => showToast(`🎓 ${name} just graduated!`);

  function renderGraduation() {
    if (!graduationEl) return;
    const stats = bedroomStats();
    if (graduatedAt) {
      const when = new Date(graduatedAt).toLocaleDateString();
      graduationEl.innerHTML =
        `<h3>🎓 Diploma</h3><p>Graduated ${when}.</p>` +
        `<div class="th-election-list">` +
        `<div class="th-election-row"><span>Memories found</span><b>${found.size}</b></div>` +
        `<div class="th-election-row"><span>Rooms explored</span><b>${visitedZones.size}</b></div>` +
        `<div class="th-election-row"><span>Days attended</span><b>${stats.daysAttended}</b></div>` +
        `<div class="th-election-row"><span>Cards collected</span><b>${stats.cardsCollected}</b></div>` +
        (club ? `<div class="th-election-row"><span>Club</span><b>${club.name}</b></div>` : "") +
        `</div>` +
        `<div class="th-mem-close">E / tap — close</div>`;
    } else if (graduationEligible()) {
      graduationEl.innerHTML =
        `<h3>Graduation</h3><p>You've attended enough real days to graduate. It's permanent — but it doesn't end anything, you can keep exploring after.</p>` +
        `<div class="th-election-list">` +
        `<div class="th-election-row"><span>Memories found</span><b>${found.size}</b></div>` +
        `<div class="th-election-row"><span>Rooms explored</span><b>${visitedZones.size}</b></div>` +
        `<div class="th-election-row"><span>Days attended</span><b>${stats.daysAttended}</b></div>` +
        (club ? `<div class="th-election-row"><span>Club</span><b>${club.name}</b></div>` : "") +
        `</div>` +
        `<button type="button" id="th-graduate-btn">Graduate</button>` +
        `<div class="th-mem-close">E / tap outside the form — close</div>`;
      graduationEl.querySelector(".th-election-list").addEventListener("click", e => e.stopPropagation());
      graduationEl.querySelector("#th-graduate-btn").addEventListener("click", e => { e.stopPropagation(); graduate(); });
    } else {
      const remaining = GRADUATION_DAYS_REQUIRED - visitDays.size;
      graduationEl.innerHTML =
        `<h3>Front Office</h3><p>"Graduation? You've got ${remaining} more day${remaining === 1 ? "" : "s"} of attendance before we can talk about that."</p>` +
        `<div class="th-mem-close">E / tap — close</div>`;
    }
  }
  function openGraduation() {
    closeGraduation();
    graduationEl = document.createElement("div");
    graduationEl.id = "th-graduation";
    graduationEl.className = "th-popup-card";
    graduationEl.setAttribute("role", "dialog");
    graduationEl.setAttribute("aria-label", "Graduation");
    graduationEl.addEventListener("click", closeGraduation);
    $("th-root").appendChild(graduationEl);
    renderGraduation();
  }
  function closeGraduation() {
    if (graduationEl) { graduationEl.remove(); graduationEl = null; }
  }

  // "Living MMO" unscripted moments (design doc §21/§23) — the cheap
  // version of world simulation the doc anticipated: a rare
  // deterministic daily roll (events.js) turns one specific existing
  // object into a one-time-per-day special interaction, no new zone
  // content needed. Reuses `dailyFlags` (already resets each real day)
  // rather than a new save field.
  function findHamster() {
    if (dailyFlags.hamsterFound) return;
    dailyFlags.hamsterFound = true;
    addCard("hamster");
    saveDirty = true;
    persist();
    showToast(`🐹 You found the class hamster hiding in the bean bags! Got the ${cardById("hamster").name} card.`);
  }
  function joinFoodFight() {
    if (dailyFlags.foodFight) return;
    dailyFlags.foodFight = true;
    saveDirty = true;
    persist();
    showToast("🍕 You dive into the food fight. A tater tot casualty lands directly on your shoulder.");
    net.sendFoodFightAnnounce();
  }
  net.onFoodFightAnnounce = (peerId, name) => showToast(`🍕 ${name} just started a food fight!`);

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
    const line = pickDialogueLine(npc.def, relation, relationContext()) || npc.speak(todaysEventId);
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

  function settleInZone(tx, ty) {
    npcs = getNPCs(zone);
    player.placeAtTile(tx, ty);
    doorArmed = false;
    zoneNameEl.textContent = zone.name;
    ambience.setIndoor(!OUTDOOR_ZONES.has(zone.id));
    ambience.setDancing(todaysEventId === "dance" && zone.id === "auditorium");
    ghosts.clear(); // last room's peers no longer apply
    net.join(zone.id).catch(() => {});
    visitedZones.add(zone.id);
    zoneVisitCounts[zone.id] = (zoneVisitCounts[zone.id] || 0) + 1;
    saveDirty = true;
    persist(); // checkpoint on room change, not just the interval
  }

  function switchZone(door) {
    zone = getZone(door.to);
    settleInZone(door.tx, door.ty);
  }

  // click-to-travel from the campus map — same landing logic as walking
  // through a door, just skipping the walk.
  function travelToZone(id) {
    zone = getZone(id);
    settleInZone(zone.spawn.x, zone.spawn.y);
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
    if (!running || memoryEl || dialogueEl || electionEl || scienceFairEl || graduationEl || !lbOverlay.hidden || !arcadeOverlay.hidden || !minigameOverlay.hidden || !mapOverlay.hidden || !profileOverlay.hidden || !cafeteriaOverlay.hidden || !orientationOverlay.hidden || !scheduleOverlay.hidden || !tradeOverlay.hidden || !bedroomOverlay.hidden || !yearbookOverlay.hidden) return;
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
    ambience,
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
    openYearbook, closeYearbook, switchYearbookTab,
    get photos() { return photos; },
    openBedroom, closeBedroom,
    get bedroomEquipped() { return bedroomEquipped; },
    get bedroomStats() { return bedroomStats(); },
    get todaysEventId() { return todaysEventId; },
    get clubMember() { return clubMember; },
    get club() { return club; },
    get netClub() { return net.club; },
    get electionOpen() { return !!electionEl; },
    openElection, closeElection, runForOffice, castVote, voteTally,
    get myRunning() { return myRunning; },
    toggleDancing, get myDancing() { return myDancing; },
    togglePerforming, get myPerforming() { return myPerforming; },
    get scienceFairOpen() { return !!scienceFairEl; },
    get graduationOpen() { return !!graduationEl; },
    openGraduation, closeGraduation, graduate, get graduatedAt() { return graduatedAt; },
    get graduationEligible() { return graduationEligible(); },
    visitDays,
    openScienceFair, closeScienceFair, presentProject, withdrawProject,
    get myProject() { return myProject; },
    renderer, // exposed for test/dev inspection of weather + tint rendering
    openTrade, closeTrade,
    get cards() { return cards; },
    get npcRelations() { return npcRelations; },
    get zoneVisitCounts() { return zoneVisitCounts; },
    get claimedSpots() { return claimedSpots; },
    favoriteZoneName,
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

    if (!pendingDoor && !memoryEl && !dialogueEl && !electionEl && !scienceFairEl && !graduationEl && !chatOpen && lbOverlay.hidden && arcadeOverlay.hidden && minigameOverlay.hidden && mapOverlay.hidden && profileOverlay.hidden && cafeteriaOverlay.hidden && orientationOverlay.hidden && scheduleOverlay.hidden && tradeOverlay.hidden && bedroomOverlay.hidden && yearbookOverlay.hidden) {
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
    const mem = obj && personalizeMemory(obj, obj.memory || obj.def.memory);
    const play = obj && (obj.play || obj.def.play);
    const shop = obj && (obj.shop || obj.def.shop);
    const election = obj && (obj.election || obj.def.election);
    const dance = obj && (obj.dance || obj.def.dance);
    const perform = obj && (obj.perform || obj.def.perform);
    const scienceFair = obj && (obj.scienceFair || obj.def.scienceFair);
    const graduation = obj && (obj.graduation || obj.def.graduation);
    const hamsterHere = todaysEventId === "lost-hamster" && zone.id === "classroom-3d" && obj?.type === "reading-corner" && !dailyFlags.hamsterFound;
    const foodFightHere = todaysEventId === "food-fight" && zone.id === "cafeteria" && obj?.type === "food-bar" && !dailyFlags.foodFight;
    const arcadeHint = obj && obj.game ? ` Play ${obj.gameName || "a game"}` : null;
    const playHint = play ? ` Play ${obj.playName || obj.def.playName || minigameInfo(play).title}` : null;
    const shopHint = shop ? " Get lunch" : null;
    const electionHint = election ? " Ballot box" : null;
    const danceHint = dance ? (myDancing ? " Stop dancing" : " Dance floor") : null;
    const performHint = perform ? (myPerforming ? " Leave the stage" : " Take the stage") : null;
    const scienceFairHint = scienceFair ? " Science fair table" : null;
    const graduationHint = graduation ? (graduatedAt ? " Diploma" : " Front office") : null;
    const hamsterHint = hamsterHere ? " Something's rustling in here" : null;
    const foodFightHint = foodFightHere ? " Join the food fight" : null;
    const peerHint = nearPeer ? ` Trade with ${nearPeer.name}` : null;
    setHint((memoryEl || dialogueEl || electionEl || scienceFairEl || graduationEl || !arcadeOverlay.hidden || !minigameOverlay.hidden || !mapOverlay.hidden || !profileOverlay.hidden || !cafeteriaOverlay.hidden || !orientationOverlay.hidden || !scheduleOverlay.hidden || !tradeOverlay.hidden || !bedroomOverlay.hidden || !yearbookOverlay.hidden) ? null : nearNPC ? ` Talk to ${nearNPC.name}` : (peerHint || arcadeHint || playHint || hamsterHint || foodFightHint || shopHint || electionHint || danceHint || performHint || scienceFairHint || graduationHint || (mem ? ` ${mem.title}` : null)));
    if (input.interactPressed() && mapOverlay.hidden && profileOverlay.hidden && orientationOverlay.hidden && scheduleOverlay.hidden && bedroomOverlay.hidden && yearbookOverlay.hidden) {
      if (!tradeOverlay.hidden) closeTrade();
      else if (!cafeteriaOverlay.hidden) closeCafeteria();
      else if (!minigameOverlay.hidden) closeMinigame();
      else if (!arcadeOverlay.hidden) closeArcade();
      else if (dialogueEl) closeDialogue();
      else if (memoryEl) closeMemory();
      else if (electionEl) closeElection();
      else if (scienceFairEl) closeScienceFair();
      else if (graduationEl) closeGraduation();
      else if (nearNPC) showDialogue(nearNPC);
      else if (nearPeer) openTrade(nearPeer.id, nearPeer.name);
      else if (obj && obj.game) openArcade(obj);
      else if (play) openMinigame(obj);
      else if (hamsterHere) findHamster();
      else if (foodFightHere) joinFoodFight();
      else if (shop) openCafeteria();
      else if (election) openElection();
      else if (dance) toggleDancing();
      else if (perform) togglePerforming();
      else if (scienceFair) openScienceFair();
      else if (graduation) openGraduation();
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
      // Fire Drill (design doc §21/§23 "Living MMO") — the alarm is a
      // brief real moment (first 90 real seconds of Period 2 that day),
      // not an all-day siren; todaysEventId stays "fire-drill" for the
      // whole day the same way every other event does, but the actual
      // sound is windowed the same way clock.isPassingPeriod() windows
      // hallway chatter to the start of each period.
      if (todaysEventId === "fire-drill") {
        ambience.setFireDrill(now.period === "Period 2" && clock.msSincePeriodStart() < 90000);
      }
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
