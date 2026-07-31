import { BLOCK_COLOR, ICON_MAP } from '../world/blocks.js';

const ICON_BASE = 'assets/games/trollrreria-3d/art/icons/';

// Shared slot-swatch markup for inventory/crafting/trade/quest UI: uses the
// generated PixelLab icon when one exists for this item, otherwise falls
// back to a flat color square (most raw terrain blocks never got icon art).
export function swatchHtml(id, countOrLabel) {
  const icon = ICON_MAP[id];
  const inner = icon
    ? `<img class="tr3-slot-swatch tr3-slot-icon" src="${ICON_BASE}${icon}" alt="" draggable="false">`
    : `<div class="tr3-slot-swatch" style="background:#${(BLOCK_COLOR[id] || 0x333333).toString(16).padStart(6, '0')}"></div>`;
  return `${inner}<span class="tr3-slot-count">${countOrLabel}</span>`;
}
