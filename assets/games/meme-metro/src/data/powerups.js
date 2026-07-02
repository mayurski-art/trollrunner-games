// Powerup definitions. duration 0 = lasts until consumed (shield).
// tier gates when a powerup can start appearing (difficulty level).

export const POWERUPS = {
  magnet: {
    id: 'magnet',
    name: 'Troll Coin Magnet',
    emoji: '🧲',
    color: 0xff2d55,
    duration: 12,
    tier: 1,
  },
  shield: {
    id: 'shield',
    name: 'Diamond Hands Shield',
    emoji: '🛡️',
    color: 0x35d6ff,
    duration: 0,
    tier: 1,
  },
  rocket: {
    id: 'rocket',
    name: 'Rocket Boost',
    emoji: '🚀',
    color: 0xff6a00,
    duration: 5,
    tier: 2,
  },
};
