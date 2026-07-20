/* Troll High — NPC memory (design doc §21, explicitly-deferred item now
   built): each NPC remembers YOU, specifically — a per-player relationship
   record stored in your own save data, keyed by NPC id. There's no shared
   "NPC brain" anywhere; it works because it's always "my own save
   remembering their opinion of me," same trust model as everything else
   client-authoritative in this project. */

const FAMILIAR_AT = 3; // interactions before an NPC has a "you're a regular" moment

/* Returns a special line for a milestone interaction, or null to fall
   through to the NPC's normal cycling dialogue (npc.speak()). Doesn't
   mutate — caller bumps relation.timesTalked itself. */
export function pickDialogueLine(def, relation) {
  if (relation.timesTalked === 0 && def.firstLine) return def.firstLine;
  if (relation.timesTalked === FAMILIAR_AT && def.familiarLine) return def.familiarLine;
  return null;
}
