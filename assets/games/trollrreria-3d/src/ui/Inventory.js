import { ICON_MAP, BLOCK_COLOR, BLOCK_NAME, ARMOR_STATS } from '../world/blocks.js';
import { addToSlots, countInSlots, removeFromSlots } from '../world/Container.js';

const ICON_BASE = 'assets/games/trollrreria-3d/art/icons/';

const HOTBAR_SIZE = 9;
const TOTAL_SLOTS = 36; // 0-8 hotbar, 9-35 main grid (3x9)

// Full grid inventory: 36 stackable slots, the first 9 of which double as
// the hotbar shown in the HUD. No drag-and-drop — click-to-transfer only,
// matching the 2D game's original (pre-3x3-grid) crafting/inventory phase.
export class Inventory {
  constructor(hotbarEl) {
    this.hotbarEl = hotbarEl;
    this.slots = new Array(TOTAL_SLOTS).fill(null);
    this.selectedHotbar = 0; // -1 means empty hand (deselected)
    this.armor = null; // single equipped {id, count:1} item, or null
    this.hotbarSlotEls = [];
    this.onChange = null; // set by InventoryScreen to re-render when open
    this._renderHotbar();
  }

  add(id, amount = 1) {
    const leftover = addToSlots(this.slots, id, amount);
    this._changed();
    return leftover;
  }

  countOf(id) {
    return countInSlots(this.slots, id);
  }

  removeById(id, amount) {
    const ok = removeFromSlots(this.slots, id, amount);
    this._changed();
    return ok;
  }

  canCraft(recipe) {
    return recipe.inputs.every((inp) => this.countOf(inp.id) >= inp.count);
  }

  craft(recipe) {
    if (!this.canCraft(recipe)) return false;
    for (const inp of recipe.inputs) this.removeById(inp.id, inp.count);
    this.add(recipe.output.id, recipe.output.count);
    return true;
  }

  selectedItem() {
    return this.selectedHotbar < 0 ? null : this.slots[this.selectedHotbar];
  }

  // Consumes one unit from the exact selected hotbar slot (not just any
  // matching stack) so placing always reflects what's actually selected.
  consumeSelected() {
    if (this.selectedHotbar < 0) return false;
    const slot = this.slots[this.selectedHotbar];
    if (!slot || slot.count <= 0) return false;
    slot.count -= 1;
    if (slot.count <= 0) this.slots[this.selectedHotbar] = null;
    this._changed();
    return true;
  }

  // Clicking (or number-keying) the already-selected slot again empties the
  // hand instead of re-selecting it — same "deselect" convention as
  // Minecraft/Terraria's hotbar.
  selectHotbar(i) {
    if (i < -1 || i >= HOTBAR_SIZE) return;
    this.selectedHotbar = i === this.selectedHotbar ? -1 : i;
    this._changed();
  }

  armorReduction() {
    return this.armor ? (ARMOR_STATS[this.armor.id]?.reduction || 0) : 0;
  }

  // Equips 1 unit of the armor item at slots[index], swapping any
  // previously-equipped piece back into the inventory.
  equipFromSlot(index) {
    const slot = this.slots[index];
    if (!slot || !ARMOR_STATS[slot.id]) return false;
    slot.count -= 1;
    if (slot.count <= 0) this.slots[index] = null;
    const previous = this.armor;
    this.armor = { id: slot.id, count: 1 };
    if (previous) addToSlots(this.slots, previous.id, 1);
    this._changed();
    return true;
  }

  unequipArmor() {
    if (!this.armor) return;
    addToSlots(this.slots, this.armor.id, 1);
    this.armor = null;
    this._changed();
  }

  // Call after directly mutating this.slots from outside (e.g. chest
  // transfers) so the hotbar/inventory-screen DOM catches up.
  refresh() {
    this._changed();
  }

  _changed() {
    this._renderHotbar();
    this.onChange?.();
  }

  _renderHotbar() {
    if (!this.hotbarSlotEls.length) {
      this.hotbarEl.innerHTML = '';
      for (let i = 0; i < HOTBAR_SIZE; i++) {
        const el = document.createElement('div');
        el.className = 'tr3-hotbar-slot';
        el.setAttribute('role', 'option');
        el.dataset.index = String(i);
        el.addEventListener('pointerdown', () => this.selectHotbar(i));
        this.hotbarEl.appendChild(el);
        this.hotbarSlotEls.push(el);
      }
    }
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const el = this.hotbarSlotEls[i];
      const slot = this.slots[i];
      el.classList.toggle('is-active', i === this.selectedHotbar);
      if (slot) {
        const icon = ICON_MAP[slot.id];
        if (icon) {
          el.innerHTML = `<img class="tr3-hotbar-swatch tr3-slot-icon" src="${ICON_BASE}${icon}" alt="" draggable="false"><span class="tr3-hotbar-count">${slot.count}</span>`;
        } else {
          const color = BLOCK_COLOR[slot.id];
          el.style.setProperty('--swatch', `#${(color || 0x333333).toString(16).padStart(6, '0')}`);
          el.innerHTML = `<div class="tr3-hotbar-swatch" style="background:var(--swatch)"></div><span class="tr3-hotbar-count">${slot.count}</span>`;
        }
        el.setAttribute('aria-label', `${BLOCK_NAME[slot.id] || 'Item'} x${slot.count}`);
      } else {
        el.innerHTML = '<div class="tr3-hotbar-swatch tr3-hotbar-swatch-empty"></div><span class="tr3-hotbar-count"></span>';
        el.setAttribute('aria-label', 'Empty slot');
      }
    }
  }
}
