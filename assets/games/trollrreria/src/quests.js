/* Trollrreria — the relic questline: the Grin Core shattered into six
   relics when the bots came; each relic quest is given by one NPC and
   tracked here. Objectives are deliberately simple (collect / defeat /
   reach depth / talk) so they compose out of systems that already exist
   — no new engine machinery, just counters.

   Quest state lives in game.quests and rides along in the normal save
   file (see save.js), same as inventory — progress survives exit. */

export const QUESTS = {
  lostGrin: {
    title: "Find the Lost Grin",
    npc: "Trollface Guide",
    intro: "The grin is broken. Bring me 5 grin fragments, then go remind the Troll King who's funnier.",
    objectives: [
      { type: "collect", id: "grinFragment", n: 5, label: "Grin fragments" },
      { type: "defeat", id: "trollKing", n: 1, label: "Defeat the Troll King" },
    ],
    reward: { items: [["lostGrin", 1]], announce: "🧌 Quest complete: the Lost Grin is yours." },
  },
};

/* Order matters for the UI's "up next" hint; not enforced mechanically. */
export const QUEST_ORDER = ["lostGrin"];

export function createQuestState() {
  return {
    active: null,              // quest id currently tracked in the HUD
    done: {},                  // id -> true
    progress: {},              // id -> [count, count, ...] per objective
  };
}

export function questDef(id) { return QUESTS[id]; }

export function isDone(state, id) { return !!state.done[id]; }

export function canStart(state, id) {
  return !state.done[id] && QUESTS[id] && (!state.active || state.active === id);
}

export function startQuest(game, id) {
  const q = QUESTS[id];
  if (!q || game.quests.done[id]) return false;
  game.quests.active = id;
  if (!game.quests.progress[id]) game.quests.progress[id] = q.objectives.map(() => 0);
  game.ui && game.ui.dirtyQuest && game.ui.dirtyQuest();
  game.announce(`📜 Quest started: ${q.title}`);
  return true;
}

/* Call after any collect/defeat event. type must match an objective's
   type; id must match its id. Advances the active quest only. */
export function progressQuest(game, type, id, amount = 1) {
  const state = game.quests;
  const qid = state.active;
  if (!qid) return;
  const q = QUESTS[qid];
  const prog = state.progress[qid];
  let changed = false;
  q.objectives.forEach((obj, i) => {
    if (obj.type !== type || obj.id !== id) return;
    if (prog[i] >= obj.n) return;
    prog[i] = Math.min(obj.n, prog[i] + amount);
    changed = true;
  });
  if (!changed) return;
  game.ui && game.ui.dirtyQuest && game.ui.dirtyQuest();
  if (q.objectives.every((obj, i) => prog[i] >= obj.n)) completeQuest(game, qid);
}

export function completeQuest(game, id) {
  const q = QUESTS[id];
  const state = game.quests;
  if (state.done[id]) return;
  state.done[id] = true;
  if (state.active === id) state.active = null;
  if (q.reward?.items) {
    for (const [itemId, n] of q.reward.items) {
      const left = game.inventory.add(itemId, n);
      if (left > 0 && game.player) game.spawnDrop(game.player.cx, game.player.cy - 8, itemId, left);
    }
  }
  game.sfx && game.sfx.fanfare();
  game.announce(q.reward?.announce || `📜 Quest complete: ${q.title}`);
  game.ui && game.ui.dirtyQuest && game.ui.dirtyQuest();
  void window.TrollrunnerAccounts?.awardXp?.("quest_complete", "trollrreria");
}

/* The next quest a given NPC should offer (their own quest, not started
   or done). Returns a quest id or null. */
export function questFor(npcId) {
  for (const id of QUEST_ORDER) {
    if (QUESTS[id].npc === npcId) return id;
  }
  return null;
}

export function serializeQuests(state) {
  return { active: state.active, done: state.done, progress: state.progress };
}

export function loadQuests(data) {
  const state = createQuestState();
  if (data) {
    state.active = data.active || null;
    state.done = data.done || {};
    state.progress = data.progress || {};
  }
  return state;
}
