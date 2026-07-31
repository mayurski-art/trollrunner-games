import { BLOCK_NAME } from '../world/blocks.js';
import { TRADES } from '../world/trades.js';
import { swatchHtml } from './itemIcon.js';

// Click-to-trade list — same interaction pattern as crafting, just themed
// as barter with the merchant NPC instead of the player's own workbench.
export class MerchantScreen {
  constructor(tradeListEl, inventory) {
    this.tradeListEl = tradeListEl;
    this.inventory = inventory;
  }

  render() {
    this.tradeListEl.innerHTML = '';
    for (const trade of TRADES) {
      const row = document.createElement('div');
      const affordable = this.inventory.canCraft(trade);
      row.className = 'tr3-recipe-row' + (affordable ? '' : ' is-disabled');
      const costText = trade.inputs.map((inp) => `${inp.count} ${BLOCK_NAME[inp.id]}`).join(' + ');
      row.innerHTML = `
        <div class="tr3-recipe-out">${swatchHtml(trade.output.id, trade.output.count)}<strong>${BLOCK_NAME[trade.output.id]}</strong></div>
        <div class="tr3-recipe-cost">${costText}</div>
        <button type="button" class="tr3-recipe-btn" ${affordable ? '' : 'disabled'}>Trade</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        this.inventory.craft(trade);
        this.render();
      });
      this.tradeListEl.appendChild(row);
    }
  }
}
