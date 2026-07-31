// Flavor data for the village's townspeople. Most are cosmetic dialogue
// only, but two have a real role (see Game._tickFarmerVillager /
// _tickGuardVillager): Weathered Troll tends nearby crops, Nervous Troll
// (badly) defends the village from anything that wanders too close.
export const VILLAGER_DEFS = [
  { name: 'Weathered Troll', role: 'farmer', sprite: { file: 'weathered-troll.png', w: 64, h: 80 }, lines: [
    "Been here since before the grubs showed up. Don't ask what that grin used to look like.",
    "I keep an eye on the crops. Don't touch my wheat.",
  ] },
  { name: 'Sleepy Troll', role: null, sprite: { file: 'sleepy-troll.png', w: 64, h: 80 }, lines: [
    'Five more minutes...',
    "You didn't hear it from me, but there's gemstone under the hills.",
  ] },
  { name: 'Nervous Troll', role: 'guard', sprite: { file: 'nervous-troll.png', w: 64, h: 80 }, lines: [
    'Is it hardmode yet? Please say no.',
    "I'm the village guard, technically. Please don't make me prove it.",
  ] },
  { name: 'Old Troll', role: null, sprite: { file: 'weathered-troll.png', w: 64, h: 80 }, lines: [
    "The well's been dry longer than I've been alive. Still nice to look at.",
    "That big house in the middle? Built it myself. Don't ask how long it took.",
  ] },
  { name: 'Wandering Troll', role: null, sprite: { file: 'sleepy-troll.png', w: 64, h: 80 }, lines: [
    "Just passing through, honestly. Nice little village you've got here.",
    "Watch the path at night — the grubs like it too.",
  ] },
];

// The smaller second settlement — reuses the same sprite art (no new
// generations for a 2-hut outpost) but distinct names/dialogue/roles so it
// still reads as its own place rather than a copy-pasted village.
export const OUTPOST_VILLAGER_DEFS = [
  { name: 'Outpost Farmhand', role: 'farmer', sprite: { file: 'weathered-troll.png', w: 64, h: 80 }, lines: [
    "We split off from the main village years back. Better soil out here.",
    'Mind your own crops and I\'ll mind mine.',
  ] },
  { name: 'Outpost Watcher', role: 'guard', sprite: { file: 'nervous-troll.png', w: 64, h: 80 }, lines: [
    "Out here it's just us. No merchant, no crowd. I like it that way.",
    "Anything gets close, I handle it. Mostly.",
  ] },
];
