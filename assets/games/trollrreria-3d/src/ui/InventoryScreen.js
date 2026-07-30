import { BLOCK_NAME, ARMOR_STATS } from '../world/blocks.js';
import { RECIPES } from '../world/recipes.js';
import { swatchHtml } from './itemIcon.js';

// The "E" screen: the player's 36-slot inventory grid (items auto-stack via
// Inventory.add — no drag-and-drop needed), an equipped-armor slot, and a
// click-to-craft recipe list. Matches the 2D game's original instant-click
// recipe list before it later grew a real 3x3 crafting grid.
export class InventoryScreen {
  constructor(gridEl, recipeListEl, armorSlotEl, inventory) {
    this.gridEl = gridEl;
    this.recipeListEl = recipeListEl;
    this.armorSlotEl = armorSlotEl;
    this.inventory = inventory;
    inventory.onChange = () => this.render();
    this.armorSlotEl?.addEventListener('pointerdown', () => this.inventory.unequipArmor());
  }

  render() {
    this.gridEl.innerHTML = '';
    this.inventory.slots.forEach((slot, i) => {
      const el = document.createElement('div');
      const isArmor = slot && ARMOR_STATS[slot.id];
      el.className = 'tr3-grid-slot' + (i < 9 ? ' is-hotbar' : '') + (isArmor ? ' is-equippable' : '');
      if (slot) {
        el.innerHTML = swatchHtml(slot.id, slot.count);
        el.setAttribute('aria-label', `${BLOCK_NAME[slot.id] || 'Item'} x${slot.count}${isArmor ? ' — click to equip' : ''}`);
        if (isArmor) el.addEventListener('pointerdown', () => this.inventory.equipFromSlot(i));
      } else {
        el.setAttribute('aria-label', 'Empty slot');
      }
      this.gridEl.appendChild(el);
    });

    if (this.armorSlotEl) {
      const armor = this.inventory.armor;
      this.armorSlotEl.innerHTML = armor
        ? swatchHtml(armor.id, Math.round((ARMOR_STATS[armor.id]?.reduction || 0) * 100) + '%')
        : '';
      this.armorSlotEl.setAttribute('aria-label', armor ? `Equipped: ${BLOCK_NAME[armor.id]} — click to unequip` : 'No armor equipped');
      this.armorSlotEl.classList.toggle('is-empty', !armor);
    }

    this.recipeListEl.innerHTML = '';
    for (const recipe of RECIPES) {
      const row = document.createElement('div');
      const affordable = this.inventory.canCraft(recipe);
      row.className = 'tr3-recipe-row' + (affordable ? '' : ' is-disabled');
      const costText = recipe.inputs.map((inp) => `${inp.count} ${BLOCK_NAME[inp.id]}`).join(' + ');
      row.innerHTML = `
        <div class="tr3-recipe-out">${swatchHtml(recipe.output.id, recipe.output.count)}<strong>${BLOCK_NAME[recipe.output.id]}</strong></div>
        <div class="tr3-recipe-cost">${costText}</div>
        <button type="button" class="tr3-recipe-btn" ${affordable ? '' : 'disabled'}>Craft</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        this.inventory.craft(recipe);
      });
      this.recipeListEl.appendChild(row);
    }
  }
}
