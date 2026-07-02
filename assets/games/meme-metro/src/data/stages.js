// Stage theme configuration. WorldManager reads everything visual from the
// active stage entry so future stages (Doge District, Bear Market Tunnel,
// Pepe Swamp Subway, Bitcoin Citadel, Rocket Launch Zone) are data adds.

export const STAGES = {
  memeMetro: {
    id: 'memeMetro',
    name: 'Meme Metro',
    sky: 0x130b28,
    fog: 0x1a1033,
    fogDensity: 0.012,
    ground: 0x241b3e,
    sleeper: 0x352a55,
    rail: 0x8a8aa0,
    wall: 0x1c1234,
    laneGlow: [0x8a2be2, 0x00b3cc],
    // Neon billboard palette: purple, cyan, pink, gold, green.
    neon: [0x8a2be2, 0x00e5ff, 0xff2d95, 0xffb300, 0x39ff14],
    hemiSky: 0x6a5acd,
    hemiGround: 0x1a1030,
  },
};

export const DEFAULT_STAGE = 'memeMetro';
