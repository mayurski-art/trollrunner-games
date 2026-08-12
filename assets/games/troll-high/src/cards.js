/* Troll High — trading cards: the tradeable collectible for Phase 7's
   trading + gifting (design doc §7/§10). Flavor-only, no real value, so
   trades trust each client's own broadcast rather than needing a
   server-arbitrated ledger — consistent with this project's existing
   "light system support" stance on player-run activities. */

export const CARDS = [
  { id: "trollface", name: "Trollface", icon: "😏", rarity: "legendary" },
  { id: "hall-pass", name: "Hall Pass", icon: "🎫", rarity: "common" },
  { id: "gel-pen", name: "Gel Pen", icon: "🖊️", rarity: "common" },
  { id: "mechanical-pencil", name: "Mechanical Pencil", icon: "✏️", rarity: "common" },
  { id: "gum", name: "Contraband Gum", icon: "🍬", rarity: "common" },
  { id: "mp3-player", name: "MP3 Player", icon: "🎧", rarity: "rare" },
  { id: "flip-phone", name: "Flip Phone", icon: "📱", rarity: "rare" },
  { id: "scholastic-flyer", name: "Scholastic Flyer", icon: "📰", rarity: "common" },
  { id: "trapper-keeper", name: "Trapper Keeper", icon: "📁", rarity: "rare" },
  { id: "chocolate-milk", name: "Chocolate Milk", icon: "🥛", rarity: "common" },
  { id: "hamster", name: "Class Hamster", icon: "🐹", rarity: "legendary" },
  { id: "detention-slip", name: "Detention Slip", icon: "📄", rarity: "rare" },
  { id: "cd-mix", name: "Burned CD", icon: "💿", rarity: "rare" },
  { id: "yearbook-pen", name: "Yearbook Pen", icon: "🖋️", rarity: "common" },
  // Phase 11 (Troll meta) additions — the doc's "Troll TCG set" line item
  // turned out to already exist as of Phase 7; this is that expansion.
  { id: "golden-statue-card", name: "Golden Statue", icon: "🏆", rarity: "legendary" },
  { id: "spray-can", name: "Spray Can", icon: "🎨", rarity: "rare" },
];

export function cardById(id) {
  return CARDS.find(c => c.id === id);
}

/* A small chance to earn a random card — called from existing action
   points (finding a memory, a new minigame high score) rather than
   inventing a new grind loop. */
export function maybeAwardCard(chance = 0.35) {
  if (Math.random() > chance) return null;
  return CARDS[Math.floor(Math.random() * CARDS.length)].id;
}
