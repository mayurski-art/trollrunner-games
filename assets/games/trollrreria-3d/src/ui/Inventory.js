import { HOTBAR_ORDER, BLOCK_COLOR, BLOCK_NAME } from '../world/blocks.js';

// Tracks mined block counts and renders the hotbar DOM. No crafting in v1 —
// mined blocks go straight into their matching hotbar slot.
export class Inventory {
  constructor(hotbarEl) {
    this.hotbarEl = hotbarEl;
    this.counts = new Map(HOTBAR_ORDER.map((id) => [id, 0]));
    this.selected = HOTBAR_ORDER[0];
    this.slots = [];
    this._render();
  }

  _render() {
    this.hotbarEl.innerHTML = '';
    this.slots = HOTBAR_ORDER.map((id, i) => {
      const slot = document.createElement('div');
      slot.className = 'tr3-hotbar-slot';
      slot.setAttribute('role', 'option');
      slot.setAttribute('aria-label', BLOCK_NAME[id]);
      slot.dataset.blockId = id;
      const swatch = document.createElement('div');
      swatch.className = 'tr3-hotbar-swatch';
      swatch.style.background = `#${BLOCK_COLOR[id].toString(16).padStart(6, '0')}`;
      const count = document.createElement('span');
      count.className = 'tr3-hotbar-count';
      count.textContent = '0';
      slot.append(swatch, count);
      slot.addEventListener('pointerdown', () => this.select(id));
      this.hotbarEl.appendChild(slot);
      return { id, el: slot, countEl: count };
    });
    this._updateActive();
  }

  add(blockId, amount = 1) {
    if (!this.counts.has(blockId)) return;
    this.counts.set(blockId, this.counts.get(blockId) + amount);
    this._updateCounts();
  }

  consumeSelected() {
    const count = this.counts.get(this.selected) || 0;
    if (count <= 0) return false;
    this.counts.set(this.selected, count - 1);
    this._updateCounts();
    return true;
  }

  select(blockId) {
    this.selected = blockId;
    this._updateActive();
  }

  selectByIndex(i) {
    const id = HOTBAR_ORDER[i];
    if (id !== undefined) this.select(id);
  }

  _updateCounts() {
    for (const slot of this.slots) slot.countEl.textContent = String(this.counts.get(slot.id));
  }

  _updateActive() {
    for (const slot of this.slots) slot.el.classList.toggle('is-active', slot.id === this.selected);
    this._updateCounts();
  }
}
