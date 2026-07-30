// Rendered inside the merchant panel — the merchant is the only NPC in
// the game, so he's the natural quest giver too. Shows the current quest's
// objectives with live progress and a Claim button once all are met. Once
// the whole questline is done, offers New Game+ instead (see Game.prestige).
export class QuestScreen {
  constructor(questPanelEl, quests, game) {
    this.el = questPanelEl;
    this.quests = quests;
    this.game = game;
  }

  render() {
    const quest = this.quests.current;
    if (!quest) {
      this.el.innerHTML = `
        <p class="tr3-panel-hint">No more quests — you've done them all.</p>
        <button type="button" class="tr3-recipe-btn tr3-prestige-btn">Start New Game+ (Prestige ${this.game.prestigeLevel + 1})</button>
        <p class="tr3-panel-hint tr3-prestige-hint">Wipes this island for a fresh one — enemies get a permanent +15% harder. Keeps nothing else.</p>
      `;
      this.el.querySelector('.tr3-prestige-btn').addEventListener('click', () => {
        if (!confirm(`Start New Game+? This deletes your current island and makes enemies permanently tougher (prestige ${this.game.prestigeLevel + 1}).`)) return;
        this.game.prestige();
      });
      return;
    }

    const rows = quest.objectives.map((obj) => {
      const progress = this.quests.objectiveProgress(obj);
      const met = progress >= obj.n;
      return `<div class="tr3-quest-obj${met ? ' is-met' : ''}">${met ? '✓' : '·'} ${obj.label} (${progress}/${obj.n})</div>`;
    }).join('');

    const canClaim = this.quests.canClaim();
    this.el.innerHTML = `
      <div class="tr3-quest-card">
        <div class="tr3-quest-title">${quest.title}</div>
        <p class="tr3-quest-intro">${quest.intro}</p>
        ${rows}
        <button type="button" class="tr3-recipe-btn tr3-quest-claim" ${canClaim ? '' : 'disabled'}>Claim Reward</button>
      </div>
    `;
    this.el.querySelector('.tr3-quest-claim').addEventListener('click', () => {
      const announce = this.quests.claim();
      if (announce) this.onClaim?.(announce);
      this.render();
    });
  }
}
