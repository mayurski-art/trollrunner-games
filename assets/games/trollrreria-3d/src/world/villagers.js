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
];
