// Playable roster. Phase 1 renders placeholder geometry tinted with these
// colors; final art drops into `build` overrides later without touching
// game logic. Prices are Troll Coins. Only trollface is purchasable-free.

export const CHARACTERS = {
  trollface: {
    id: 'trollface',
    name: 'Troll Coin Speedster',
    shortName: 'Trollface Runner',
    charClass: 'Speedster',
    price: 0,
    emoji: '😏',
    colors: { body: 0x17171c, head: 0xf2f2f2, accent: 0xffb300, trim: 0xd0021b },
  },
  pepe: {
    id: 'pepe',
    name: 'Pepe Dasher',
    shortName: 'Pepe Runner',
    charClass: 'Dasher',
    price: 12000,
    emoji: '🐸',
    colors: { body: 0x2b4faa, head: 0x3fa34d, accent: 0xd0021b, trim: 0xd0021b },
  },
  doge: {
    id: 'doge',
    name: 'Doge Hustler',
    shortName: 'Doge Runner',
    charClass: 'Hustler',
    price: 15000,
    emoji: '🐶',
    colors: { body: 0x1a1408, head: 0xd9a441, accent: 0xffb300, trim: 0x000000 },
  },
  skyrunner: {
    id: 'skyrunner',
    name: 'Sky Runner',
    shortName: 'Rocket Runner',
    charClass: 'Sky Runner',
    price: 20000,
    emoji: '🚀',
    colors: { body: 0x101418, head: 0xe8c39e, accent: 0x35d6ff, trim: 0x222831 },
  },
  laserexec: {
    id: 'laserexec',
    name: 'Laser Executive',
    shortName: 'Laser Runner',
    charClass: 'Executive',
    price: 25000,
    emoji: '🕴️',
    colors: { body: 0x141414, head: 0xe8c39e, accent: 0xff6a00, trim: 0xffb300 },
  },
};

export const DEFAULT_CHARACTER = 'trollface';
