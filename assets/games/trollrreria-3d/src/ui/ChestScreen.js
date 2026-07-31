import { BLOCK_NAME } from '../world/blocks.js';
import { transferSlot } from '../world/Container.js';
import { swatchHtml } from './itemIcon.js';

// Click a filled slot in either grid to move that whole stack into the
// other container — no drag-and-drop, same instant-click interaction as
// the inventory/crafting screen.
export class ChestScreen {
  constructor(chestGridEl, playerGridEl, inventory) {
    this.chestGridEl = chestGridEl;
    this.playerGridEl = playerGridEl;
    this.inventory = inventory;
    this.chestSlots = null;
  }

  open(chestSlots) {
    this.chestSlots = chestSlots;
    this.render();
  }

  render() {
    if (!this.chestSlots) return;
    this._renderGrid(this.chestGridEl, this.chestSlots, (i) => {
      if (transferSlot(this.chestSlots, i, this.inventory.slots)) {
        this.inventory.refresh();
        this.render();
      }
    });
    this._renderGrid(this.playerGridEl, this.inventory.slots, (i) => {
      if (transferSlot(this.inventory.slots, i, this.chestSlots)) {
        this.inventory.refresh();
        this.render();
      }
    });
  }

  _renderGrid(el, slots, onClick) {
    el.innerHTML = '';
    slots.forEach((slot, i) => {
      const cell = document.createElement('div');
      cell.className = 'tr3-grid-slot';
      if (slot) {
        cell.innerHTML = swatchHtml(slot.id, slot.count);
        cell.setAttribute('aria-label', `${BLOCK_NAME[slot.id] || 'Item'} x${slot.count}, click to move`);
        cell.addEventListener('pointerdown', () => onClick(i));
      } else {
        cell.setAttribute('aria-label', 'Empty slot');
      }
      el.appendChild(cell);
    });
  }
}
