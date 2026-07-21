/* Troll High — the real multi-club system (design doc §23 Phase 6, first
   slice of "Multiplayer Memories"). No new backend table: "which clubs
   exist" is genuinely just whichever names other online players are
   currently broadcasting through the existing zone presence channel
   (net.js), the same mechanism that already shows real players' names —
   ephemeral and multiplayer-native rather than a persisted roster. Reading
   the club charter in the Underground HQ either founds a brand new club
   (you name it) or joins one you've actually seen another live player
   representing. */

const MAX_NAME_LEN = 24;

export function sanitizeClubName(raw) {
  const trimmed = (raw || "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LEN);
  return trimmed || "The Club";
}
