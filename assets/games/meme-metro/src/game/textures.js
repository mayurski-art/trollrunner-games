import * as THREE from 'three';

// Procedural CanvasTextures for the Meme Metro identity: neon meme
// billboards, the troll-coin face, the bear-train nose, the toll-gate sign
// and the city skyline. Everything is drawn in code so the game ships with
// zero image assets; real art can replace any of these one texture at a time.

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Rounded neon panel with glowing text/emoji, matching the concept-sheet
// billboards ("HODL", "TO THE MOON", troll emoji, chart screens...).
function drawSignPanel(ctx, w, h, color) {
  ctx.fillStyle = '#0d0a1c';
  ctx.beginPath();
  ctx.roundRect(4, 4, w - 8, h - 8, 14);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function textSign(lines, color, emojiSize = 0) {
  const [c, ctx] = makeCanvas(256, 128);
  drawSignPanel(ctx, 256, 128, color);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  const size = emojiSize || (lines.length > 1 ? 40 : 52);
  ctx.font = `900 ${size}px "DM Sans", "Segoe UI Emoji", sans-serif`;
  lines.forEach((line, i) => {
    const y = 64 + (i - (lines.length - 1) / 2) * (size + 8);
    ctx.fillText(line, 128, y);
  });
  return toTexture(c);
}

// Candlestick chart screen — half the billboards in the reference are charts.
function chartSign(up) {
  const [c, ctx] = makeCanvas(256, 128);
  drawSignPanel(ctx, 256, 128, up ? '#39ff14' : '#ff2038');
  const color = up ? '#39ff14' : '#ff2038';
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  for (let i = 0; i < 9; i++) {
    const x = 30 + i * 24;
    const trend = up ? 96 - i * 7 : 34 + i * 7;
    const bodyH = 12 + Math.random() * 18;
    const y = trend - bodyH / 2 + (Math.random() - 0.5) * 8;
    ctx.fillStyle = Math.random() < 0.75 ? color : (up ? '#ff2038' : '#39ff14');
    ctx.fillRect(x - 5, y, 10, bodyH);
    ctx.fillRect(x - 1, y - 8, 2, bodyH + 16);
  }
  return toTexture(c);
}

export function makeBillboardTextures() {
  return [
    textSign(['HODL'], '#ffb300'),
    textSign(['TO THE', 'MOON 🚀'], '#00e5ff'),
    textSign(['BUY', 'MEMES'], '#ff2d95'),
    textSign(['$TROLL'], '#ffb300'),
    textSign(['😏'], '#b84dff', 74),
    textSign(['🐸 FEELS', 'GOOD'], '#39ff14'),
    textSign(['SUCH WOW', '🐶'], '#ffb300'),
    textSign(['WAGMI'], '#00e5ff'),
    textSign(['💎🙌'], '#7fd4ff', 64),
    textSign(['U MAD?'], '#ff2d95'),
    chartSign(true),
    chartSign(false),
    chartSign(true),
  ];
}

// Troll-coin face: gold disc, ridged rim, troll emoji stamp.
export function makeCoinFaceTexture() {
  const [c, ctx] = makeCanvas(128, 128);
  const grad = ctx.createRadialGradient(52, 44, 8, 64, 64, 64);
  grad.addColorStop(0, '#ffe28a');
  grad.addColorStop(0.55, '#ffc233');
  grad.addColorStop(1, '#c77f00');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8a5600';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '64px "Segoe UI Emoji", sans-serif';
  ctx.fillText('😏', 64, 68);
  return toTexture(c);
}

// Bear Market Train nose: headlight ring, bear emoji, crashing chart arrow.
export function makeTrainFaceTexture() {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#141019';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#2c2438';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 236, 236);
  // Destination board.
  ctx.fillStyle = '#1d1626';
  ctx.fillRect(38, 22, 180, 52);
  ctx.strokeStyle = '#ff2038';
  ctx.lineWidth = 3;
  ctx.strokeRect(38, 22, 180, 52);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ff2038';
  ctx.shadowColor = '#ff2038';
  ctx.shadowBlur = 10;
  ctx.font = '900 30px "DM Sans", sans-serif';
  ctx.fillText('BEAR LINE', 128, 49);
  ctx.shadowBlur = 0;
  // Bear face.
  ctx.font = '96px "Segoe UI Emoji", sans-serif';
  ctx.fillText('🐻', 128, 140);
  // Crashing red arrow.
  ctx.strokeStyle = '#ff2038';
  ctx.lineWidth = 9;
  ctx.shadowColor = '#ff2038';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(52, 196);
  ctx.lineTo(112, 216);
  ctx.lineTo(150, 204);
  ctx.lineTo(204, 232);
  ctx.stroke();
  ctx.fillStyle = '#ff2038';
  ctx.beginPath();
  ctx.moveTo(210, 238);
  ctx.lineTo(184, 232);
  ctx.lineTo(202, 214);
  ctx.closePath();
  ctx.fill();
  return toTexture(c);
}

// Toll gate header: trollface emoji + PAY TOLL, like the obstacle sheet.
export function makeTollSignTexture() {
  const [c, ctx] = makeCanvas(256, 128);
  drawSignPanel(ctx, 256, 128, '#b84dff');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '62px "Segoe UI Emoji", sans-serif';
  ctx.fillText('😏', 70, 66);
  ctx.fillStyle = '#ffb300';
  ctx.shadowColor = '#ffb300';
  ctx.shadowBlur = 12;
  ctx.font = '900 34px "DM Sans", sans-serif';
  ctx.fillText('PAY', 168, 46);
  ctx.fillText('TOLL', 168, 86);
  return toTexture(c);
}

// Doge bone barrier medallion.
export function makeDogeSignTexture() {
  const [c, ctx] = makeCanvas(128, 128);
  const grad = ctx.createRadialGradient(52, 44, 8, 64, 64, 64);
  grad.addColorStop(0, '#ffe28a');
  grad.addColorStop(1, '#c77f00');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '72px "Segoe UI Emoji", sans-serif';
  ctx.fillText('🐶', 64, 68);
  return toTexture(c);
}

// Powerup pickup icon: emoji in a glowing ring, tinted per powerup.
export function makePowerupTexture(emoji, color) {
  const [c, ctx] = makeCanvas(128, 128);
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  ctx.strokeStyle = hex;
  ctx.lineWidth = 7;
  ctx.shadowColor = hex;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '58px "Segoe UI Emoji", sans-serif';
  ctx.fillText(emoji, 64, 68);
  return toTexture(c);
}

// Distant city skyline with lit windows and a moon, kept crisp above the fog.
export function makeSkylineTexture() {
  const [c, ctx] = makeCanvas(1024, 256);
  // Moon.
  ctx.fillStyle = '#e8e4f5';
  ctx.shadowColor = '#cfc6ff';
  ctx.shadowBlur = 40;
  ctx.beginPath();
  ctx.arc(790, 60, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Buildings: overlapping dark towers with sparse lit windows.
  const neon = ['#ffb300', '#00e5ff', '#ff2d95', '#b84dff', '#39ff14'];
  for (let i = 0; i < 46; i++) {
    const w = 30 + Math.random() * 60;
    const h = 60 + Math.random() * 170;
    const x = Math.random() * (1024 - w);
    const shade = 18 + Math.floor(Math.random() * 16);
    ctx.fillStyle = `rgb(${shade}, ${shade - 5}, ${shade + 14})`;
    ctx.fillRect(x, 256 - h, w, h);
    for (let wy = 256 - h + 8; wy < 244; wy += 12) {
      for (let wx = x + 5; wx < x + w - 6; wx += 10) {
        if (Math.random() < 0.16) {
          ctx.fillStyle = Math.random() < 0.7 ? 'rgba(255, 200, 90, 0.85)'
            : neon[Math.floor(Math.random() * neon.length)];
          ctx.fillRect(wx, wy, 4, 6);
        }
      }
    }
    // Occasional rooftop neon strip.
    if (Math.random() < 0.3) {
      ctx.fillStyle = neon[Math.floor(Math.random() * neon.length)];
      ctx.fillRect(x, 256 - h - 3, w, 3);
    }
  }
  return toTexture(c);
}
