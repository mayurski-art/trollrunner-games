# Troll Casino — game-room art drop-in

Room hero art goes in THIS folder with EXACTLY these names. Same deal as the
walkthrough scenes (../scenes/): every image is probed at load, and a styled
neon-gradient fallback renders until the file exists — drop them in any order.

| File | Used by | Shot |
|---|---|---|
| `pepe-blackjack-hero.png` | Blackjack floor card + room hero | Pepe dealing at the branded blackjack table, crew in the background |
| `pepe-blackjack-gameplay.png` | (reserved) blackjack play backdrop | First-person over the felt, cards + chips |
| `doge-jackpot-hero.png` | Slots floor card + room hero | Doge beside the giant Jackpot Reels cabinet |
| `doge-jackpot-gameplay.png` | (reserved) slots play backdrop | First-person at the reels, hand on SPIN |
| `whale-launch-hero.png` | Crash floor card + room hero | Elon presenting the holographic multiplier chart |
| `whale-launch-gameplay.png` | (reserved) crash play backdrop | First-person at the console, LAUNCH under hand |

Guidelines (same as scenes/README.md):

- **16:9 or wider, ~1920px+**, critical detail centered — heroes render
  `background-size: cover` and floor cards crop to a wide 21:8 tile.
- **No baked-in UI text** — balances, buttons, cards, reels, multipliers are
  all real HTML on top. Environmental signage inside the art is fine.
- The `*-gameplay.png` files aren't wired yet: they're reserved for dimmed
  play-state backdrops behind each game panel (same treatment scene 5 gets
  for the wheel). Wire them by setting a background on `.room-play .room-panel`
  per room, or ask for it.

The Troll Wheel's floor card reuses `../scenes/scene-05-first-person-wheel.png`.
