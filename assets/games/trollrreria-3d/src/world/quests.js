import { BLOCKS } from './blocks.js';

// A short linear questline given by the merchant — objectives compose out
// of systems that already exist (inventory counts + kill counters), same
// approach as the 2D game's relic questline (assets/games/trollrreria/src/quests.js).
// "collect" checks live inventory counts (consumed on claim); "defeat" checks
// a cumulative kill counter keyed by EnemyTypes name.
export const QUESTS = [
  {
    id: 'gearUp',
    title: 'Gear Up',
    intro: "This island's got worse things than me in it. Get yourself a real weapon and prove you can use it.",
    objectives: [
      { type: 'collect', item: BLOCKS.WOOD_SWORD, n: 1, label: 'Craft a sword' },
      { type: 'defeat', kind: 'Troll Grub', n: 3, label: 'Defeat 3 Troll Grubs' },
    ],
    reward: { items: [{ id: BLOCKS.GEMSTONE, count: 3 }], announce: 'Quest complete: Gear Up — 3 Gemstone.' },
  },
  {
    id: 'prospector',
    title: "Prospector's Trial",
    intro: 'The good stuff is deep down and rare. Bring me 5 gemstone and I\'ll make it worth your while.',
    objectives: [
      { type: 'collect', item: BLOCKS.GEMSTONE, n: 5, label: '5 Gemstone' },
    ],
    reward: { items: [{ id: BLOCKS.GEM_SWORD, count: 1 }], announce: 'Quest complete: Prospector\'s Trial — a free Gem Sword.' },
  },
  {
    id: 'intoTheDark',
    title: 'Into the Dark',
    intro: "Bats get bold once the sun's down. Thin the flock and I'll light your way.",
    objectives: [
      { type: 'defeat', kind: 'Troll Bat', n: 5, label: 'Defeat 5 Troll Bats' },
    ],
    reward: { items: [{ id: BLOCKS.TORCH, count: 6 }, { id: BLOCKS.LAMP_OFF, count: 2 }], announce: 'Quest complete: Into the Dark — torches and lamps.' },
  },
  {
    id: 'theReaping',
    title: 'The Reaping',
    intro: "Things get a lot meaner once hardmode hits. If you're still standing after a few Reapers, come find me.",
    objectives: [
      { type: 'defeat', kind: 'Troll Reaper', n: 3, label: 'Defeat 3 Troll Reapers' },
    ],
    reward: { items: [{ id: BLOCKS.REAPER_SHARD, count: 4 }], announce: 'Quest complete: The Reaping — bonus Reaper Shards.' },
  },
  {
    id: 'trollKing',
    title: 'The Troll King',
    intro: "There's an old summoning horn recipe if you're brave enough — 10 Reaper Shards, 5 Gemstone. Use it, and don't come back if you lose.",
    objectives: [
      { type: 'defeat', kind: 'Troll King', n: 1, label: 'Defeat the Troll King' },
    ],
    reward: { items: [{ id: BLOCKS.REAPER_SHARD, count: 8 }], announce: 'Quest complete: The Troll King is dethroned. Wear that crown with pride.' },
  },
  {
    id: 'archtroll',
    title: 'The Dark Totem',
    intro: "There's something worse than the King out there — something that wears crowns as trophies. Bring me its head, if you've got the shards to spare for the totem.",
    objectives: [
      { type: 'defeat', kind: 'Archtroll', n: 1, label: 'Defeat the Archtroll' },
    ],
    reward: { items: [{ id: BLOCKS.REAPER_ARMOR, count: 1 }], announce: 'Quest complete: The Dark Totem — the Archtroll falls. Take this armor, you earned it.' },
  },
];
