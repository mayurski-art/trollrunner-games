import { BLOCK_COLOR, BLOCK_NAME } from '../world/blocks.js';
import { RECIPES } from '../world/recipes.js';

function swatchHtml(id, count) {
  const color = BLOCK_COLOR[id] || 0x333333;
  return `<div class="tr3-slot-swatch" style="background:#${color.toString(16).padStart(6, '0')}"></div><span class="tr3-slot-count">${count}</span>`;
}

// The "E" screen: a read-only view of the player's 36-slot inventory grid
// (items auto-stack via Inventory.add — no drag-and-drop needed) plus a
// click-to-craft recipe list. Matches the 2D game's original instant-click
// recipe list before it later grew a real 3x3 crafting grid.
export class InventoryScreen {
  constructor(gridEl, recipeListEl, inventory) {
    this.gridEl = gridEl;
    this.recipeListEl = recipeListEl;
    this.inventory = inventory;
    inventory.onChange = () => this.render();
  }

  render() {
    this.gridEl.innerHTML = '';
    this.inventory.slots.forEach((slot, i) => {
      const el = document.createElement('div');
      el.className = 'tr3-grid-slot' + (i < 9 ? ' is-hotbar' : '');
      if (slot) {
        el.innerHTML = swatchHtml(slot.id, slot.count);
        el.setAttribute('aria-label', `${BLOCK_NAME[slot.id] || 'Item'} x${slot.count}`);
      } else {
        el.setAttribute('aria-label', 'Empty slot');
      }
      this.gridEl.appendChild(el);
    });

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
