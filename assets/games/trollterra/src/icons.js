/* TrollTerra — procedural item icons (32x32 canvases, cached).
   Blocks reuse the tile-noise look; tools/weapons/armor are pictograms. */

import { ITEMS, TILES, WALLS } from "./defs.js";
import { hash2 } from "./util.js";

const cache = new Map();

const METAL = {
  wood: "#8a5a2b", copper: "#e28448", iron: "#cfc9bd", silver: "#e3eaf0",
  gold: "#f4c64c", trollium: "#57e87a",
};

function metalOf(id) {
  if (id.startsWith("wood")) return METAL.wood;
  if (id.startsWith("copper")) return METAL.copper;
  if (id.startsWith("iron")) return METAL.iron;
  if (id.startsWith("silver")) return METAL.silver;
  if (id.startsWith("gold")) return METAL.gold;
  if (id.startsWith("trollium") || id === "emperorEdge") return METAL.trollium;
  return "#b9a6d9";
}

export function getIcon(id) {
  if (cache.has(id)) return cache.get(id);
  const c = document.createElement("canvas");
  c.width = 32; c.height = 32;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  const def = ITEMS[id];
  if (def) drawIcon(g, id, def);
  cache.set(id, c);
  return c;
}

function noiseRect(g, x, y, w, h, pal, seed) {
  for (let py = 0; py < h; py += 2) {
    for (let px = 0; px < w; px += 2) {
      const n = hash2(px, py, seed);
      g.fillStyle = pal[n < 0.25 ? 0 : n < 0.8 ? 1 : 2];
      g.fillRect(x + px, y + py, 2, 2);
    }
  }
}

function drawIcon(g, id, def) {
  const m = metalOf(id);
  switch (def.type) {
    case "block": {
      const t = TILES[def.tile];
      if (t && t.pal) {
        noiseRect(g, 4, 4, 24, 24, t.pal, def.tile * 13);
        g.strokeStyle = "rgba(0,0,0,0.4)"; g.strokeRect(4.5, 4.5, 23, 23);
        if (t.ore) { g.fillStyle = t.ore; g.fillRect(9, 10, 5, 5); g.fillRect(18, 17, 5, 5); g.fillRect(13, 20, 4, 4); }
      } else {
        drawFurniture(g, id);
      }
      break;
    }
    case "wall": {
      const w = def.wall != null ? WALLS[def.wall] : null;
      const pal = w && w.pal ? [w.pal[0], w.pal[1], w.pal[1]] : ["#444", "#555", "#555"];
      noiseRect(g, 5, 5, 22, 22, pal, 77);
      g.strokeStyle = "rgba(255,255,255,0.25)";
      g.setLineDash([3, 2]); g.strokeRect(5.5, 5.5, 21, 21); g.setLineDash([]);
      break;
    }
    case "tool": drawTool(g, def.tool, m); break;
    case "weapon": drawSword(g, m, def.rare); break;
    case "bow": drawBow(g, m); break;
    case "ammo": drawArrow(g, def.flame); break;
    case "armor": drawArmor(g, def.slot, m); break;
    case "potion": drawPotion(g); break;
    case "summon": drawTotem(g); break;
    case "material": drawMaterial(g, id, m); break;
    default: { g.fillStyle = "#f0f"; g.fillRect(8, 8, 16, 16); }
  }
}

function drawFurniture(g, id) {
  g.fillStyle = "#7a5a33";
  if (id === "torch") {
    g.fillStyle = "#8a5a2b"; g.fillRect(14, 12, 4, 16);
    g.fillStyle = "#ffb300"; g.fillRect(12, 5, 8, 8);
    g.fillStyle = "#ffe08a"; g.fillRect(14, 7, 4, 4);
  } else if (id === "workbench") {
    g.fillRect(4, 12, 24, 6);
    g.fillStyle = "#5d4326"; g.fillRect(6, 18, 5, 10); g.fillRect(21, 18, 5, 10);
  } else if (id === "furnace") {
    g.fillStyle = "#565a63"; g.fillRect(5, 6, 22, 22);
    g.fillStyle = "#ff7a1a"; g.fillRect(11, 16, 10, 8);
    g.fillStyle = "#ffd23c"; g.fillRect(14, 19, 4, 4);
  } else if (id === "anvil") {
    g.fillStyle = "#3d4149"; g.fillRect(4, 12, 24, 7); g.fillRect(10, 19, 12, 7);
    g.fillStyle = "#6e737d"; g.fillRect(4, 12, 24, 3);
  } else if (id === "chest") {
    g.fillStyle = "#8a5a2b"; g.fillRect(4, 8, 24, 20);
    g.fillStyle = "#6b4a26"; g.fillRect(4, 8, 24, 7);
    g.fillStyle = "#ffb300"; g.fillRect(14, 15, 5, 7);
  } else if (id === "door") {
    g.fillStyle = "#6b4a26"; g.fillRect(9, 3, 14, 27);
    g.fillStyle = "#ffb300"; g.fillRect(18, 16, 3, 4);
  } else if (id === "platform") {
    g.fillStyle = "#7a5a33"; g.fillRect(3, 13, 26, 6);
    g.fillStyle = "#5d4326"; g.fillRect(3, 17, 26, 2);
  } else if (id === "bed") {
    g.fillStyle = "#5d4326"; g.fillRect(4, 22, 3, 6); g.fillRect(25, 22, 3, 6);
    g.fillStyle = "#8a5a2b"; g.fillRect(3, 19, 26, 4);
    g.fillStyle = "#c23a60"; g.fillRect(4, 13, 24, 7);
    g.fillStyle = "#f2f8fd"; g.fillRect(4, 11, 9, 6);
  } else if (id === "lever") {
    g.fillStyle = "#565a63"; g.fillRect(8, 18, 16, 10);
    g.fillStyle = "#c9302c"; g.fillRect(14, 5, 4, 15);
    g.fillStyle = "#ffd23c"; g.fillRect(12, 3, 8, 5);
  } else if (id === "plate") {
    g.fillStyle = "#8f8f96"; g.fillRect(4, 22, 24, 4);
    g.fillStyle = "#c9c9cf"; g.fillRect(6, 20, 20, 3);
  } else if (id === "dartTrap") {
    g.fillStyle = "#4e525a"; g.fillRect(4, 4, 24, 24);
    g.fillStyle = "#33363e"; g.fillRect(4, 13, 12, 7);
    g.fillStyle = "#141414"; g.fillRect(2, 15, 5, 3);
  }
}

function drawTool(g, kind, m) {
  /* handle */
  g.save();
  g.translate(16, 16); g.rotate(-Math.PI / 4);
  g.fillStyle = "#8a5a2b"; g.fillRect(-2, -3, 4, 18);
  g.fillStyle = m;
  if (kind === "pick") {
    g.beginPath(); g.moveTo(-11, -6); g.quadraticCurveTo(0, -14, 11, -6);
    g.quadraticCurveTo(0, -8, -11, -6); g.fill();
  } else if (kind === "axe") {
    g.beginPath(); g.moveTo(1, -10); g.quadraticCurveTo(12, -8, 9, 2);
    g.lineTo(1, -1); g.closePath(); g.fill();
  } else if (kind === "wrench") {
    g.fillStyle = "#c9302c";
    g.fillRect(-2, -12, 4, 20);
    g.beginPath(); g.arc(0, -12, 6, 0.6, Math.PI * 2 - 0.6); g.fill();
  } else {
    g.fillRect(-9, -10, 18, 8);
  }
  g.restore();
}

function drawSword(g, m, rare) {
  g.save();
  g.translate(16, 16); g.rotate(Math.PI / 4);
  g.fillStyle = m;
  g.fillRect(-2, -15, 4, 20);
  g.beginPath(); g.moveTo(-2, -15); g.lineTo(0, -19); g.lineTo(2, -15); g.fill();
  g.fillStyle = "#8a5a2b"; g.fillRect(-5, 5, 10, 3); g.fillRect(-1.5, 8, 3, 7);
  if (rare) { g.fillStyle = "rgba(87,189,92,0.5)"; g.fillRect(-4, -19, 8, 24); }
  g.restore();
}

function drawBow(g, m) {
  g.strokeStyle = m; g.lineWidth = 3;
  g.beginPath(); g.arc(12, 16, 11, -Math.PI / 2.6, Math.PI / 2.6); g.stroke();
  g.strokeStyle = "#ddd"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(16, 6); g.lineTo(16, 26); g.stroke();
}

function drawArrow(g, flame) {
  g.save(); g.translate(16, 16); g.rotate(-Math.PI / 4);
  g.fillStyle = "#8a5a2b"; g.fillRect(-1, -8, 2, 16);
  g.fillStyle = flame ? "#ff7a1a" : "#cfc9bd";
  g.beginPath(); g.moveTo(-4, -8); g.lineTo(0, -14); g.lineTo(4, -8); g.fill();
  g.fillStyle = "#e8e4da"; g.fillRect(-4, 6, 3, 4); g.fillRect(1, 6, 3, 4);
  if (flame) { g.fillStyle = "rgba(255,179,0,0.6)"; g.fillRect(-3, -14, 7, 7); }
  g.restore();
}

function drawArmor(g, slot, m) {
  g.fillStyle = m;
  if (slot === "head") {
    g.beginPath(); g.arc(16, 15, 9, Math.PI, 0); g.fill();
    g.fillRect(7, 15, 18, 6);
    g.fillStyle = "#1c1424"; g.fillRect(10, 16, 12, 3);
  } else if (slot === "chest") {
    g.fillRect(9, 8, 14, 14);
    g.fillRect(5, 8, 4, 8); g.fillRect(23, 8, 4, 8);
    g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(9, 14, 14, 2);
  } else {
    g.fillRect(10, 8, 12, 6);
    g.fillRect(10, 14, 5, 12); g.fillRect(17, 14, 5, 12);
  }
}

function drawPotion(g) {
  g.fillStyle = "#b9d96a";
  g.beginPath(); g.arc(16, 20, 8, 0, 7); g.fill();
  g.fillRect(13, 6, 6, 8);
  g.fillStyle = "#e2f2a8"; g.fillRect(13, 4, 6, 3);
  g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(12, 17, 3, 5);
}

function drawTotem(g) {
  g.fillStyle = "#6b4a26"; g.fillRect(12, 6, 8, 22);
  g.fillStyle = "#ffb300";
  g.fillRect(10, 8, 12, 3); g.fillRect(10, 16, 12, 3);
  g.fillStyle = "#ff4d5e"; g.fillRect(14, 10, 4, 4);
  g.fillStyle = "#fff"; g.fillRect(14, 21, 4, 4); g.fillStyle = "#000"; g.fillRect(15, 22, 2, 2);
}

function drawMaterial(g, id, m) {
  if (id.endsWith("Bar")) {
    g.fillStyle = m;
    g.beginPath(); g.moveTo(6, 22); g.lineTo(10, 14); g.lineTo(26, 14); g.lineTo(22, 22); g.closePath(); g.fill();
    g.fillStyle = "rgba(255,255,255,0.4)"; g.fillRect(11, 15, 12, 2);
    g.strokeStyle = "rgba(0,0,0,0.35)"; g.stroke();
  } else if (id.endsWith("Ore")) {
    g.fillStyle = "#6e737d";
    g.beginPath(); g.arc(16, 18, 9, 0, 7); g.fill();
    g.fillStyle = m; g.fillRect(11, 14, 4, 4); g.fillRect(18, 18, 5, 4); g.fillRect(14, 21, 3, 3);
  } else if (id === "gel") {
    g.fillStyle = "rgba(79,211,95,0.8)";
    g.beginPath(); g.arc(16, 19, 9, Math.PI, 0); g.fill();
    g.fillRect(7, 19, 18, 6);
    g.fillStyle = "#2c5039"; g.fillRect(12, 16, 3, 3); g.fillRect(18, 16, 3, 3);
    g.strokeStyle = "#2c5039"; g.lineWidth = 1.5;
    g.beginPath(); g.arc(16, 20, 4, 0.3, Math.PI - 0.3); g.stroke();
  } else if (id === "lens") {
    g.fillStyle = "#e8e4da"; g.beginPath(); g.arc(16, 16, 9, 0, 7); g.fill();
    g.fillStyle = "#8c2440"; g.beginPath(); g.arc(16, 16, 4, 0, 7); g.fill();
    g.fillStyle = "#000"; g.beginPath(); g.arc(16, 16, 2, 0, 7); g.fill();
  } else if (id === "bone") {
    g.strokeStyle = "#e8e4da"; g.lineWidth = 4;
    g.beginPath(); g.moveTo(10, 22); g.lineTo(22, 10); g.stroke();
    g.fillStyle = "#e8e4da";
    for (const [x, y] of [[8, 20], [12, 24], [20, 8], [24, 12]]) {
      g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill();
    }
  } else if (id === "mushroom") {
    g.fillStyle = "#c9d86a"; g.fillRect(14, 16, 4, 10);
    g.fillStyle = "#8fd14f";
    g.beginPath(); g.arc(16, 16, 9, Math.PI, 0); g.fill();
    g.fillStyle = "#c7f08a"; g.fillRect(11, 11, 4, 3);
  } else {
    g.fillStyle = m; g.fillRect(9, 9, 14, 14);
  }
}
