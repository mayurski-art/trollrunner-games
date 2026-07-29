import { QUESTS } from './quests.js';

// Tracks progress through the linear questline: a cumulative kill counter
// (fed by Game.handleDig on every confirmed kill) plus live inventory
// counts for "collect" objectives. Claiming a quest consumes its collect
// items and grants the reward, then advances to the next quest.
export class QuestManager {
  constructor(inventory) {
    this.inventory = inventory;
    this.index = 0;
    this.kills = {};
  }

  get current() {
    return QUESTS[this.index] || null;
  }

  get done() {
    return this.index >= QUESTS.length;
  }

  recordKill(kindName) {
    this.kills[kindName] = (this.kills[kindName] || 0) + 1;
  }

  objectiveProgress(obj) {
    if (obj.type === 'collect') return Math.min(obj.n, this.inventory.countOf(obj.item));
    if (obj.type === 'defeat') return Math.min(obj.n, this.kills[obj.kind] || 0);
    return 0;
  }

  isComplete(quest) {
    return quest.objectives.every((obj) => this.objectiveProgress(obj) >= obj.n);
  }

  canClaim() {
    return !!this.current && this.isComplete(this.current);
  }

  // Returns the reward's announce string on success, null if not claimable.
  claim() {
    const quest = this.current;
    if (!quest || !this.isComplete(quest)) return null;
    for (const obj of quest.objectives) {
      if (obj.type === 'collect') this.inventory.removeById(obj.item, obj.n);
    }
    for (const item of quest.reward.items || []) this.inventory.add(item.id, item.count);
    this.index++;
    return quest.reward.announce;
  }
}
