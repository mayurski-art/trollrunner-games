/* Troll High — full campus map screen. Each zone is its own coordinate
   space (no shared world grid), so this is a hand-laid-out schematic
   built from the hallway door order in hallway-a.json / hallway-b.json,
   not a computed minimap.

   Drawn like a hand-inked parchment map (not a UI panel) since the game
   already frames this screen as an in-world object the player is holding.
   Rooms inside the actual school building (indoor: true) show locked/
   hatched when the campus is closed — nights and weekends — while the
   corridors, fields, downtown and the woods stay open, since those are
   hangout spots rather than school hours. drawCampusMap() returns the
   screen rects it drew so the caller can hit-test clicks/hover for
   click-to-travel without this module knowing about the DOM. */

const HALLWAY_A = [
  { id: "office", label: "Front\nOffice", indoor: true },
  { id: "classroom-3b", label: "Room\n3B", indoor: true },
  { id: "classroom-3c", label: "Room\n5A", indoor: true },
  { id: "classroom-3d", label: "Room\n7A", indoor: true },
  { id: "computer-lab", label: "Computer\nLab", indoor: true },
  { id: "cafeteria", label: "Cafeteria", indoor: true },
  { id: "library", label: "Library", indoor: true },
  { id: "bathroom", label: "Restrooms", indoor: true },
];
const HALLWAY_B = [
  { id: "gym", label: "Gym", indoor: true },
  { id: "auditorium", label: "Auditorium", indoor: true },
  { id: "art-room", label: "Art Room", indoor: true },
  { id: "music-room", label: "Music\nRoom", indoor: true },
  { id: "science-lab", label: "Science\nLab", indoor: true },
  { id: "nurse", label: "Nurse", indoor: true },
  { id: "playground", label: "Playground", indoor: false },
  { id: "sports-field", label: "Sports\nField", indoor: false },
  { id: "bus-loop", label: "Bus Loop", indoor: false },
];
const DOWNTOWN = [
  { id: "arcade", label: "Arcade" },
  { id: "pizza-place", label: "Pizza\nPlace" },
  { id: "convenience-store", label: "Corner\nStore" },
  { id: "park", label: "Park" },
];
const WOODS = [
  { id: "skate-park", label: "Skate\nPark" },
  { id: "lake", label: "Lake" },
  { id: "warehouse", label: "Warehouse" },
];
const SECRET = [
  { id: "basement", label: "??? Basement" },
  { id: "tunnels", label: "??? Tunnels" },
  { id: "roof", label: "??? Roof" },
  { id: "storm-drains", label: "??? Storm\nDrains" },
  { id: "caves", label: "??? Caves" },
];

const INK = "#3a2f1d";
const INK_SOFT = "rgba(58,47,29,0.45)";
const PAPER = "#f2ead9";
const PAPER_SHADOW = "#e4d8bc";
const GOLD = "#c98a1f";

// deterministic per-id jitter so the "hand drawn" wobble doesn't reshuffle
// every redraw (only clock/lock state changes between draws)
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}
function jitter(id, salt, amp) {
  const n = Math.sin(hash(id + salt) * 12.9898) * 43758.5453;
  return (n - Math.floor(n) - 0.5) * 2 * amp;
}

function wobblyRoundRect(ctx, id, x, y, w, h, r) {
  const j = (px, py, s) => [px + jitter(id, s + "x", 1.1), py + jitter(id, s + "y", 1.1)];
  const [tlx, tly] = j(x + r, y, "tl");
  const [trx, tr_y] = j(x + w - r, y, "tr");
  const [brx, bry] = j(x + w - r, y + h, "br");
  const [blx, bly] = j(x + r, y + h, "bl");
  ctx.beginPath();
  ctx.moveTo(tlx, tly);
  ctx.lineTo(trx, tr_y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(brx, bry);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(blx, bly);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(tlx, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawHatching(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = "rgba(58,47,29,0.22)";
  ctx.lineWidth = 1;
  for (let d = -h; d < w; d += 6) {
    ctx.beginPath();
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDashedTrail(ctx, x1, y1, x2, y2) {
  ctx.save();
  ctx.strokeStyle = INK_SOFT;
  ctx.lineWidth = 2;
  ctx.setLineDash([1, 7]);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawRow(ctx, rooms, y, w, currentZoneId, campusOpen, rects) {
  const margin = 46, boxW = 72, boxH = 46;
  const gap = (w - margin * 2 - boxW) / (rooms.length - 1);
  const railY = y + boxH + 16;

  drawDashedTrail(ctx, margin + boxW / 2, railY, margin + boxW / 2 + gap * (rooms.length - 1), railY);

  rooms.forEach((room, i) => {
    const x = margin + gap * i;
    const active = room.id === currentZoneId;
    const locked = room.indoor === true && !campusOpen;

    // stem down to the trail
    ctx.save();
    ctx.strokeStyle = active ? GOLD : INK_SOFT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + boxW / 2 + jitter(room.id, "stem", 1), y + boxH);
    ctx.lineTo(x + boxW / 2 + jitter(room.id, "stem2", 1), railY);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    if (active) { ctx.shadowColor = GOLD; ctx.shadowBlur = 16; }
    ctx.fillStyle = locked ? PAPER_SHADOW : active ? "#fff6df" : PAPER;
    ctx.strokeStyle = active ? GOLD : INK;
    ctx.lineWidth = active ? 2.5 : 1.4;
    wobblyRoundRect(ctx, room.id, x, y, boxW, boxH, 7);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();

    if (locked) drawHatching(ctx, x + 1.5, y + 1.5, boxW - 3, boxH - 3);

    ctx.fillStyle = locked ? "rgba(58,47,29,0.55)" : INK;
    ctx.font = active ? "bold 10px DM Mono, monospace" : "10px DM Mono, monospace";
    ctx.textAlign = "center";
    const lines = room.label.split("\n");
    const labelY = locked ? y + boxH / 2 - 4 : y + boxH / 2;
    lines.forEach((line, li) => {
      ctx.fillText(line, x + boxW / 2, labelY + (li - (lines.length - 1) / 2) * 11 + 3);
    });
    if (locked) {
      ctx.font = "11px serif";
      ctx.fillText("\u{1F512}", x + boxW / 2, y + boxH - 6);
    }
    if (active) {
      ctx.fillStyle = GOLD;
      ctx.font = "12px serif";
      ctx.fillText("★", x + boxW / 2, y - 6);
    }
    ctx.textAlign = "left";

    rects.push({ id: room.id, x, y, w: boxW, h: boxH, locked });
  });
}

function sectionHeader(ctx, icon, text, x, y) {
  ctx.fillStyle = INK;
  ctx.font = "bold 13px DM Mono, monospace";
  ctx.textAlign = "left";
  ctx.fillText(`${icon}  ${text}`, x, y);
  ctx.strokeStyle = INK_SOFT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + 6);
  ctx.lineTo(x + ctx.measureText(`${icon}  ${text}`).width, y + 6 + jitter(text, "ul", 1.5));
  ctx.stroke();
}

function drawCompassRose(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = INK_SOFT;
  ctx.fillStyle = INK_SOFT;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    const len = i % 2 === 0 ? r : r * 0.55;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.font = "bold 9px DM Mono, monospace";
  ctx.textAlign = "center";
  ctx.fillText("N", 0, -r - 6);
  ctx.restore();
}

/* campusOpen: whether the school building's interior rooms should read as
   accessible right now (false = nights + weekends → locked/hatched). */
export function drawCampusMap(canvas, currentZoneId, campusOpen) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const rects = [];

  // aged parchment base + vignette
  const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.15, W / 2, H / 2, H * 0.75);
  grad.addColorStop(0, PAPER);
  grad.addColorStop(1, "#d8c9a3");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(58,47,29,0.5)";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  sectionHeader(ctx, "\u{1F3EB}", "Main Hallway (A wing)", 40, 46);
  drawRow(ctx, HALLWAY_A, 60, W, currentZoneId, campusOpen, rects);

  sectionHeader(ctx, "\u{1F3EB}", "East Wing (B wing)", 40, 176);
  drawRow(ctx, HALLWAY_B, 200, W, currentZoneId, campusOpen, rects);

  // the A-wing / B-wing link
  drawDashedTrail(ctx, W - 40, 60 + 46 + 16, W - 40, 200);

  sectionHeader(ctx, "\u{1F68C}", "Downtown (via Bus Loop)", 40, 306);
  drawRow(ctx, DOWNTOWN, 330, W, currentZoneId, campusOpen, rects);

  sectionHeader(ctx, "\u{1F332}", "The Woods (via the Park)", 40, 436);
  drawRow(ctx, WOODS, 460, W, currentZoneId, campusOpen, rects);

  ctx.fillStyle = INK_SOFT;
  ctx.font = "italic 10px DM Mono, monospace";
  ctx.fillText("Somewhere down there…", 40, 566);
  drawRow(ctx, SECRET, 590, W, currentZoneId, campusOpen, rects);

  drawCompassRose(ctx, W - 62, H - 96, 26);

  ctx.fillStyle = campusOpen ? "#3f6b2c" : "#8a5a1c";
  ctx.font = "bold 11px DM Mono, monospace";
  ctx.textAlign = "left";
  ctx.fillText(campusOpen ? "☀️ Campus is open" : "\u{1F512} Campus is closed — hangouts stay open", 40, 656);

  const zoneNames = {
    "hallway-a": "the Main Hallway", "hallway-b": "the East Wing",
    "main-street": "Main Street", "forest-trail": "the Forest Trail",
  };
  if (zoneNames[currentZoneId]) {
    ctx.fillStyle = GOLD;
    ctx.font = "bold 12px DM Mono, monospace";
    ctx.fillText(`★ You are in ${zoneNames[currentZoneId]}`, 40, 676);
  }

  ctx.fillStyle = INK_SOFT;
  ctx.font = "10px DM Mono, monospace";
  ctx.fillText("Click a room to travel there", 40, H - 14);

  return rects;
}
