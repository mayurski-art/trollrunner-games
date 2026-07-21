/* Troll High — full campus map screen. Each zone is its own coordinate
   space (no shared world grid), so this is a hand-laid-out schematic
   built from the hallway door order in hallway-a.json / hallway-b.json,
   not a computed minimap. */

const HALLWAY_A = [
  { id: "office", label: "Front\nOffice" },
  { id: "classroom-3b", label: "Room\n3B" },
  { id: "classroom-3c", label: "Room\n5A" },
  { id: "classroom-3d", label: "Room\n7A" },
  { id: "computer-lab", label: "Computer\nLab" },
  { id: "cafeteria", label: "Cafeteria" },
  { id: "library", label: "Library" },
  { id: "bathroom", label: "Restrooms" },
];
const HALLWAY_B = [
  { id: "gym", label: "Gym" },
  { id: "auditorium", label: "Auditorium" },
  { id: "art-room", label: "Art Room" },
  { id: "music-room", label: "Music\nRoom" },
  { id: "science-lab", label: "Science\nLab" },
  { id: "nurse", label: "Nurse" },
  { id: "playground", label: "Playground" },
  { id: "sports-field", label: "Sports\nField" },
  { id: "bus-loop", label: "Bus Loop" },
];
const DOWNTOWN = [
  { id: "arcade", label: "Arcade" },
  { id: "pizza-place", label: "Pizza\nPlace" },
  { id: "convenience-store", label: "Corner\nStore" },
  { id: "park", label: "Park" },
];
const SECRET = [
  { id: "basement", label: "??? Basement" },
  { id: "tunnels", label: "??? Tunnels" },
  { id: "roof", label: "??? Roof" },
];

function drawRow(ctx, rooms, y, w, currentZoneId) {
  const margin = 40, boxW = 68, boxH = 44, gap = (w - margin * 2 - boxW) / (rooms.length - 1);
  ctx.strokeStyle = "#8a7a5a"; ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(margin + boxW / 2, y + boxH + 14);
  ctx.lineTo(margin + boxW / 2 + gap * (rooms.length - 1), y + boxH + 14);
  ctx.stroke();
  rooms.forEach((room, i) => {
    const x = margin + gap * i;
    const active = room.id === currentZoneId;
    ctx.fillStyle = active ? "#ffd23f" : "#3a3f4a";
    ctx.strokeStyle = active ? "#ffd23f" : "rgba(255,255,255,0.25)";
    ctx.lineWidth = active ? 3 : 1;
    if (active) { ctx.shadowColor = "#ffd23f"; ctx.shadowBlur = 14; }
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, boxW, boxH, 6) : ctx.rect(x, y, boxW, boxH);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = active ? "#1c1c1e" : "#e8e4d8";
    ctx.font = "bold 10px DM Mono, monospace";
    ctx.textAlign = "center";
    const lines = room.label.split("\n");
    lines.forEach((line, li) => {
      ctx.fillText(line, x + boxW / 2, y + boxH / 2 + (li - (lines.length - 1) / 2) * 12 + 4);
    });
    // connector down to the corridor line
    ctx.strokeStyle = active ? "#ffd23f" : "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + boxW / 2, y + boxH); ctx.lineTo(x + boxW / 2, y + boxH + 14); ctx.stroke();
  });
  ctx.textAlign = "left";
}

export function drawCampusMap(canvas, currentZoneId) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = "#14110c"; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#cfd6e0"; ctx.font = "bold 12px DM Mono, monospace";
  ctx.fillText("Main Hallway (A wing)", 40, 50);
  drawRow(ctx, HALLWAY_A, 60, W, currentZoneId);

  ctx.fillText("East Wing (B wing)", 40, 190);
  drawRow(ctx, HALLWAY_B, 200, W, currentZoneId);

  // the A-wing / B-wing link
  ctx.strokeStyle = "#8a7a5a"; ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(W - 40, 60 + 44 + 14);
  ctx.lineTo(W - 40, 200);
  ctx.stroke();

  ctx.fillStyle = "#cfd6e0"; ctx.font = "bold 12px DM Mono, monospace";
  ctx.fillText("Downtown (via Bus Loop)", 40, 320);
  drawRow(ctx, DOWNTOWN, 330, W, currentZoneId);

  ctx.fillStyle = "#8a8f9a"; ctx.font = "10px DM Mono, monospace";
  ctx.fillText("Somewhere down there…", 40, 450);
  drawRow(ctx, SECRET, 460, W, currentZoneId);

  if (currentZoneId === "hallway-a") {
    ctx.fillStyle = "#ffd23f"; ctx.font = "bold 12px DM Mono, monospace";
    ctx.fillText("★ You are in the Main Hallway", 40, 530);
  } else if (currentZoneId === "hallway-b") {
    ctx.fillStyle = "#ffd23f"; ctx.font = "bold 12px DM Mono, monospace";
    ctx.fillText("★ You are in the East Wing", 40, 530);
  } else if (currentZoneId === "main-street") {
    ctx.fillStyle = "#ffd23f"; ctx.font = "bold 12px DM Mono, monospace";
    ctx.fillText("★ You are on Main Street", 40, 530);
  }
}
