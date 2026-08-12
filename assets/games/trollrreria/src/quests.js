/* Trollrreria — the relic questline: the Grin Core shattered into six
   relics when the bots came; each relic quest is given by one NPC and
   tracked here. Objectives are deliberately simple (collect / defeat /
   reach depth / talk) so they compose out of systems that already exist
   — no new engine machinery, just counters.

   Quest state lives in game.quests and rides along in the normal save
   file (see save.js), same as inventory — progress survives exit. */

import { burst } from "./entities.js";

export const QUESTS = {
  lostGrin: {
    title: "Find the Lost Grin",
    npc: "Weathered Sign",
    intro: "The grin is broken. Bring me 5 grin fragments, then go remind the Troll King who's funnier.",
    objectives: [
      { type: "collect", id: "grinFragment", n: 5, label: "Grin fragments" },
      { type: "defeat", id: "trollKing", n: 1, label: "Defeat the Troll King" },
    ],
    reward: { items: [["lostGrin", 1]], announce: "Quest complete: the Lost Grin is yours." },
  },
  pepeRecovery: {
    title: "Rare Pepe Recovery",
    npc: "Pepe Hermit",
    intro: "The scrolls were rare once. Find 3 before they're screenshotted again.",
    objectives: [
      { type: "collect", id: "pepeScroll", n: 3, label: "Rare Pepe scrolls" },
    ],
    reward: { flags: ["doubleJump"], announce: "🐸 Quest complete: Frog Legs equipped — you can double jump now." },
  },
  dogeMoon: {
    title: "Doge to the Moon",
    npc: "Doge Miner",
    intro: "Many dig. Much moon rock. Bring 10 shards and I show you how to land soft. Very technique.",
    objectives: [
      { type: "collect", id: "moonShard", n: 10, label: "Doge Moon Shards" },
    ],
    reward: { flags: ["moonBoots"], announce: "🐕 Quest complete: Moon Boots equipped — jump higher, land softer." },
  },
  fixRocket: {
    title: "Fix the Rocket",
    npc: "Rocket Tinkerer",
    intro: "Bring me 6 rocket parts. I'll get the pad running -- ground to sky, no ladder required.",
    objectives: [
      { type: "collect", id: "rocketPart", n: 6, label: "Rocket parts" },
    ],
    reward: { flags: ["rocketPad"], announce: "🚀 Quest complete: the rocket pads are live — hop between ground and sky." },
  },
  whaleKey: {
    title: "The Whale Key",
    npc: "Whale Oracle",
    intro: "Only diamond hands may enter the vault. Defeat the Rickroller in the Deep Web and the key is yours.",
    objectives: [
      { type: "defeat", id: "whaleKey", n: 1, label: "Defeat the Rickroller" },
    ],
    reward: { announce: "🐋 Quest complete: the Whale Key is yours. The vault awaits." },
  },
  /* No npc -- given by the Grin Core altar itself once the other five are
     done, not by talking to anyone. See Game.useGrinAltar in main.js. */
  grinCore: {
    title: "Restore the Grin Core",
    npc: null,
    intro: "All five relics gathered. The altar hums.",
    objectives: [
      { type: "altar", id: "grinCore", n: 1, label: "Restore the Grin Core" },
    ],
    reward: { flags: ["grinCoreRestored"], announce: "THE GRIN IS RESTORED. ...the botnet just noticed." },
  },
};

/* Order matters for the UI's "up next" hint; not enforced mechanically. */
export const QUEST_ORDER = ["lostGrin", "pepeRecovery", "dogeMoon", "fixRocket", "whaleKey", "grinCore"];

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
  if (q.reward?.flags) {
    for (const flag of q.reward.flags) game.flags[flag] = true;
    /* the Grin Core's restoration is the story trigger for the botnet's
       counterattack -- give it its own moment rather than a silent flag */
    if (q.reward.flags.includes("grinCoreRestored")) game.goingViral && game.goingViral();
  }
  game.sfx && game.sfx.fanfare();
  game.announce(q.reward?.announce || `📜 Quest complete: ${q.title}`);
  game.ui && game.ui.dirtyQuest && game.ui.dirtyQuest();
  /* fanfare: reuse the same big-text flash the area-title popup uses,
     plus a gold burst at the player -- a quest completing should feel
     like a bigger deal than a floating damage number */
  if (game.player) burst(game, game.player.cx, game.player.cy - 10, "#ffb300", 22, { spread: 260, up: 160, glow: true });
  game.ui && game.ui.showAreaTitle && game.ui.showAreaTitle("QUEST COMPLETE");
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
