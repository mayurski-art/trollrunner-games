// Stat/behavior configs for each mob kind. Enemy.js reads these instead of
// hardcoding numbers, so adding a new kind is just adding an entry here.
export const ENEMY_TYPES = {
  TROLL_GRUB: {
    name: 'Troll Grub',
    hp: 4,
    radius: 0.5,
    color: 0x7a2ea6,
    size: 0.9,
    wanderSpeed: 1.1,
    chaseSpeed: 2.4,
    aggroRange: 8,
    attackRange: 1.1,
    attackCooldown: 1.1,
    damage: 12,
    flies: false,
  },
  TROLL_BAT: {
    name: 'Troll Bat',
    hp: 2,
    radius: 0.4,
    color: 0xc9425a,
    size: 0.6,
    wanderSpeed: 1.6,
    chaseSpeed: 3.2,
    aggroRange: 10,
    attackRange: 1.0,
    attackCooldown: 0.8,
    damage: 6,
    flies: true,
    hoverHeight: 2.5,
  },
};
