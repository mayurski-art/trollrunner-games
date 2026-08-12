/* Troll High — personal bedroom (design doc §21): "the room becomes a
   visual history of the player's life." Not an explorable zone (there's
   no home/town in the world yet — that's Phase 8) — a decorate-able
   overlay, same pattern as the profile card. Decorations unlock
   automatically off stats the game already tracks, no separate grind. */

export const SLOTS = ["wall", "desk", "shelf", "floor"];

export const DECORATIONS = [
  { id: "trophy-shelf", icon: "🏆", name: "Trophy Shelf", hint: "Set any recess-game high score", unlocked: s => Object.keys(s.highScores).length > 0 },
  { id: "card-binder", icon: "📔", name: "Card Binder", hint: "Collect 3 trading cards", unlocked: s => s.cardsCollected >= 3 },
  { id: "map-poster", icon: "🗺️", name: "Campus Map Poster", hint: "Explore 10 rooms", unlocked: s => s.roomsExplored >= 10 },
  { id: "friend-photo", icon: "🖼️", name: "Friend Photo", hint: "Become a regular with someone at school", unlocked: s => s.hasFamiliarNPC },
  { id: "retro-console", icon: "🎮", name: "Retro Console", hint: "Complete a trade", unlocked: s => s.tradesCompleted >= 1 },
  { id: "lunch-tray-art", icon: "🍕", name: "Lunch Tray Art", hint: "Buy lunch 3 times", unlocked: s => s.lunchesBought >= 3 },
  { id: "gift-box", icon: "🎁", name: "Gift Box", hint: "Receive a gift from someone", unlocked: s => s.giftsReceived >= 1 },
  { id: "streak-poster", icon: "📅", name: "Attendance Poster", hint: "Attend school on 3 different days", unlocked: s => s.daysAttended >= 3 },
  // Phase 11 — the ultimate "life story" flex: proof you found him.
  { id: "trollface-autograph", icon: "😏", name: "Trollface's Autograph", hint: "Find the legendary NPC — good luck", unlocked: s => s.metTrollface },
  // Clubs — signing the charter in the Underground HQ doubles as joining.
  { id: "club-pin", icon: "📌", name: "Club Pin", hint: "Join the club — it's hidden somewhere", unlocked: s => s.clubMember },
  // Graduation (design doc §23 Phase 6 capstone) — the front desk hands
  // it out once you've actually attended enough to earn it.
  { id: "diploma", icon: "🎓", name: "Diploma", hint: "Graduate at the front office", unlocked: s => s.graduated },
];

export function decorationById(id) {
  return DECORATIONS.find(d => d.id === id);
}
