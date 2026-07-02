// Obstacle type definitions + spawn pattern templates.
//
// Every type declares its collision box (independent of visuals), the action
// that clears it, whether hitting it ends the run, and the difficulty tier
// it first appears at. Visual builders live in ObstacleManager so final
// models can replace placeholders without touching this data.
//
// collider: { w, h, d, y } — y is the box bottom (world y).
// action: 'dodge' | 'jump' | 'slide' (how the player avoids it).

export const OBSTACLE_TYPES = {
  tollGate: {
    id: 'tollGate',
    name: 'Troll Toll Gate',
    action: 'dodge',
    hard: true,
    soft: false,
    tier: 1,
    collider: { w: 2.0, h: 2.5, d: 0.7, y: 0 },
  },
  rugPull: {
    id: 'rugPull',
    name: 'Rug Pull Carpet Trap',
    action: 'jump',
    hard: true,
    soft: false,
    tier: 1,
    collider: { w: 2.0, h: 0.55, d: 2.2, y: 0 },
  },
  redCandle: {
    id: 'redCandle',
    name: 'Red Candle Barrier',
    action: 'jump',
    hard: true,
    soft: false,
    tier: 1,
    collider: { w: 2.0, h: 0.9, d: 0.8, y: 0 },
  },
  laserGate: {
    id: 'laserGate',
    name: 'Laser Gate',
    action: 'slide',
    hard: true,
    soft: false,
    tier: 2,
    collider: { w: 2.2, h: 0.4, d: 0.3, y: 1.15 },
  },
  bearTrain: {
    id: 'bearTrain',
    name: 'Bear Market Train',
    action: 'dodge',
    hard: true,
    soft: false,
    tier: 2,
    collider: { w: 2.2, h: 3.2, d: 16, y: 0 },
  },
  dogeBone: {
    id: 'dogeBone',
    name: 'Doge Bone Barrier',
    action: 'jump',
    hard: true,
    soft: false,
    tier: 1,
    collider: { w: 2.0, h: 0.8, d: 0.6, y: 0 },
  },
};

const rndLane = () => Math.floor(Math.random() * 3);
// Two distinct random lanes.
const twoLanes = () => {
  const a = rndLane();
  let b = rndLane();
  while (b === a) b = rndLane();
  return [a, b];
};

// Pattern templates. build() returns entries [{ lane, type, dz }] where dz
// pushes an obstacle further ahead (staggering). Every template guarantees
// a survivable path by construction: at least one lane is free, or every
// blocked lane is clearable with jump/slide.
export const PATTERNS = [
  { tier: 1, build: () => [{ lane: rndLane(), type: 'tollGate' }] },
  { tier: 1, build: () => [{ lane: rndLane(), type: 'redCandle' }] },
  { tier: 1, build: () => [{ lane: rndLane(), type: 'rugPull' }] },
  { tier: 1, build: () => [{ lane: rndLane(), type: 'dogeBone' }] },
  {
    // Bone + gate: jump one lane or take the free one.
    tier: 2,
    build: () => {
      const [a, b] = twoLanes();
      return [{ lane: a, type: 'dogeBone' }, { lane: b, type: 'tollGate' }];
    },
  },
  {
    // Two lanes gated, one free.
    tier: 2,
    build: () => {
      const [a, b] = twoLanes();
      return [{ lane: a, type: 'tollGate' }, { lane: b, type: 'tollGate' }];
    },
  },
  {
    // Full-width candle row: jump anywhere.
    tier: 2,
    build: () => [0, 1, 2].map((lane) => ({ lane, type: 'redCandle' })),
  },
  {
    // Full-width laser: slide anywhere.
    tier: 2,
    build: () => [0, 1, 2].map((lane) => ({ lane, type: 'laserGate' })),
  },
  {
    // Train + gate, one lane free.
    tier: 2,
    build: () => {
      const [a, b] = twoLanes();
      return [{ lane: a, type: 'bearTrain' }, { lane: b, type: 'tollGate' }];
    },
  },
  {
    // Mixed row: every lane needs a different action.
    tier: 3,
    build: () => {
      const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
      return [
        { lane: lanes[0], type: 'tollGate' },
        { lane: lanes[1], type: 'redCandle' },
        { lane: lanes[2], type: 'laserGate' },
      ];
    },
  },
  {
    // Staggered weave: forces two lane changes.
    tier: 3,
    build: () => {
      const [a, b] = twoLanes();
      return [{ lane: a, type: 'tollGate' }, { lane: b, type: 'tollGate', dz: 9 }];
    },
  },
  {
    // Double train, one lane free for the full length. Tense but fair.
    tier: 4,
    build: () => {
      const [a, b] = twoLanes();
      return [{ lane: a, type: 'bearTrain' }, { lane: b, type: 'bearTrain' }];
    },
  },
];
