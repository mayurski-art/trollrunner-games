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
    sprite: { file: 'troll-grub.png', w: 64, h: 64 },
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
    sprite: { file: 'troll-bat.png', w: 64, h: 64 },
  },
  // Only enters the spawn pool once World.hardmode is triggered (see
  // Spawner.trySpawn) — the "hardmode" phase's tougher escalation mob.
  TROLL_REAPER: {
    name: 'Troll Reaper',
    hp: 10,
    radius: 0.6,
    color: 0x111827,
    size: 1.1,
    wanderSpeed: 1.5,
    chaseSpeed: 3.6,
    aggroRange: 12,
    attackRange: 1.3,
    attackCooldown: 0.9,
    damage: 20,
    flies: false,
    hardmodeOnly: true,
    sprite: { file: 'troll-reaper.png', w: 64, h: 80 },
  },
  // Never enters the random spawn pool — only appears via the Summoning
  // Horn (see blocks.SUMMON_ITEMS / Game.summonBoss). Slam attack also
  // knocks the player back (see Game._loop's attacker handling).
  TROLL_KING: {
    name: 'Troll King',
    hp: 60,
    radius: 1.1,
    color: 0x7c2d12,
    size: 2.2,
    wanderSpeed: 1.0,
    chaseSpeed: 2.8,
    aggroRange: 20,
    attackRange: 1.8,
    attackCooldown: 1.3,
    damage: 26,
    flies: false,
    isBoss: true,
    summonOnly: true,
    sprite: { file: 'troll-king.png', w: 96, h: 96 },
  },
  // Second world boss — summoned via the Dark Totem (crafted from a Troll
  // Crown, so it's gated behind having already beaten the Troll King).
  // Enrages past 50% HP lost: chaseSpeed and damage both scale up (see
  // Enemy.update's enrage check) — its one boss-specific mechanic, same
  // spirit as the Troll King's knockback slam.
  // Dinosaur pack hunter — fast, fragile, hits hard, always spawns in a
  // trio (see Spawner.trySpawn's DINO_PACK_KINDS handling) so a single one
  // is easy but three at once is the actual threat, ARK-raptor-pack style.
  RAPTOR: {
    name: 'Raptor',
    hp: 5,
    radius: 0.45,
    color: 0x8a3b3b,
    size: 1.0,
    wanderSpeed: 1.4,
    chaseSpeed: 4.2,
    aggroRange: 11,
    attackRange: 1.1,
    attackCooldown: 0.7,
    damage: 9,
    flies: false,
    packSpawn: 3,
    sprite: { procedural: true, kind: 'raptor', accent: '#f4c430' },
  },
  // Rare apex predator — high hp/damage, slow but relentless once provoked.
  // Never enters hardmode-only pools or boss summon items; it's just a
  // dangerous wandering encounter (low spawn weight, see Spawner.trySpawn).
  REX: {
    name: 'Rex',
    hp: 26,
    radius: 0.9,
    color: 0x5c4a2e,
    size: 2.0,
    wanderSpeed: 0.9,
    chaseSpeed: 2.6,
    aggroRange: 14,
    attackRange: 1.6,
    attackCooldown: 1.2,
    damage: 22,
    flies: false,
    rareSpawn: true,
    sprite: { procedural: true, kind: 'rex', accent: '#ff5a1f' },
  },
  ARCHTROLL: {
    name: 'Archtroll',
    hp: 80,
    radius: 1.2,
    color: 0x4c1d95,
    size: 2.4,
    wanderSpeed: 1.1,
    chaseSpeed: 2.6,
    aggroRange: 22,
    attackRange: 1.8,
    attackCooldown: 1.1,
    damage: 22,
    flies: false,
    isBoss: true,
    summonOnly: true,
    enrageAt: 0.5,
    enrageSpeedMult: 1.4,
    enrageDamageMult: 1.35,
    sprite: { file: 'archtroll.png', w: 96, h: 96 },
  },
};
