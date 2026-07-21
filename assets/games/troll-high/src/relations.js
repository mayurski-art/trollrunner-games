/* Troll High — NPC memory (design doc §21, explicitly-deferred item now
   built): each NPC remembers YOU, specifically — a per-player relationship
   record stored in your own save data, keyed by NPC id. There's no shared
   "NPC brain" anywhere; it works because it's always "my own save
   remembering their opinion of me," same trust model as everything else
   client-authoritative in this project.

   Phase 2 of the "make it feel alive" reprioritization (design doc §23)
   deepens this beyond the original 2-tier firstLine/familiarLine: a
   3rd/4th milestone tier, one-time "remember when" callbacks tied to real
   shared history (visited a secret zone together, joined the club, etc.),
   and a time-aware "it's been a while" beat — all still fully
   deterministic, reusing whatever wall-clock/save state already exists. */

const FAMILIAR_AT = 3;   // "you're a regular" beat
const CLOSE_AT = 8;      // a deeper "actual friend" beat, for NPCs that define one

// 1 real hour = 1 in-game day (clock.js) — 3 real hours since the last
// chat reads as "it's been a few days," long enough to earn a callback.
const RETURN_GAP_MS = 3 * 60 * 60 * 1000;

/* Returns a special line for this interaction, or null to fall through to
   the NPC's normal cycling dialogue (npc.speak()). Doesn't mutate `relation`
   itself — the caller bumps timesTalked/lastTalkedAt. `context` is a plain
   object of whatever save-derived flags/sets the caller wants memoryLines'
   conditions to be able to check (see main.js's relationContext()). */
export function pickDialogueLine(def, relation, context = {}) {
  const t = relation.timesTalked;
  if (t === 0 && def.firstLine) return def.firstLine;
  if (t === 1 && def.secondLine) return def.secondLine;
  if (t === FAMILIAR_AT && def.familiarLine) return def.familiarLine;
  if (t === CLOSE_AT && def.closeLine) return def.closeLine;

  // One-time "remember when" callbacks tied to real shared history —
  // fires the first interaction after its condition becomes true, then
  // never repeats. Checked in array order, so authoring order = priority
  // when multiple unlock at once.
  if (def.memoryLines) {
    const seen = relation.seenMemories || (relation.seenMemories = []);
    for (const m of def.memoryLines) {
      if (!seen.includes(m.id) && m.condition(context)) {
        seen.push(m.id);
        // `line` can be a plain string or, for callbacks that need to
        // reference real state (e.g. the player's own club name), a
        // function of the same context.
        return typeof m.line === "function" ? m.line(context) : m.line;
      }
    }
  }

  // Time-aware "it's been a while" beat — only for NPCs that define one,
  // and only once conditions for the milestone tiers above are exhausted.
  if (t > 0 && def.returningLine && relation.lastTalkedAt != null
    && Date.now() - relation.lastTalkedAt > RETURN_GAP_MS) {
    return def.returningLine;
  }

  return null;
}

export { FAMILIAR_AT, CLOSE_AT };
