# NULLFACE — Game 008 Design Doc

A corrupted-terminal narrative ARG for the Troll Runner arcade.
Genre: interactive fiction / roguelite descent. Inspired by the *aesthetic
genre* of glitch-terminal ARG portals (reference: imfebu.com's visual
language) — **zero copied content, lore, names, or copy**. All writing is
original Troll Runner universe material.

---

## 1. Reference analysis (what we're borrowing, and what we're not)

Studied the reference site's shipped CSS/JS directly. Findings:

| Element | Reference implementation | Our take |
|---|---|---|
| Palette | BSOD blue bg `hsl(240 100% 40%)`, pure yellow fg `hsl(60 100% 50%)`, red danger accents, white dim text | **Replaced** — we go darker (see §3.6): near-black bg, phosphor toxic green, blood red. Evil terminal, not error screen |
| Font | Courier New / ui-monospace stack | Same (repo already ships `retro.ttf` for headings) |
| Graphics | 100% ASCII art, no images/canvas/WebGL | Same — original ASCII trollfaces + dividers |
| `pixelGlitch` | `clip-path: inset()` horizontal tear bands + 1–3px translate jitter, doubled via `::after` layer | Rebuild from scratch, tiered by corruption |
| `pixelNoise` | background-position jitter on a dither pattern | Same technique |
| `scanBar` | full-width bar, `translateX(-100% → 100%)` sweep | Same |
| `blink` / `marquee` / `bracketPulse` | cursor blink, ticker text, `[ ]` opacity pulse | Same |
| Glow pulse | `box-shadow` red+yellow neon breathing | Same, on danger elements |
| Lore threads | status tags: OPEN / LOCKED / BLEEDING / DISPUTED / REDACTED | Same *mechanic*, original thread names + statuses |
| "Gameplay" | none — static narrative dressing | **We add real game systems** (see §3) |

**Not borrowed:** any of their copy, names ("febu", "the spill"), lore, forms,
branding, or page structure. The reference has no actual game logic — that's
entirely ours.

Tech verdict: everything above is plain CSS keyframes + vanilla JS. Fits the
repo's no-framework, single-HTML-file convention perfectly.

---

## 2. Premise (original lore)

The Troll Runner arcade runs on an ancient mainframe. Something in it has
started *grinning back*. You are drafted as a **kernel debugger** — booted
into `NULLFACE`, the corrupted core, with one job: descend through its
layers and decide what to do with the thing living at the bottom.

The terminal itself is the narrator, and it is not neutral.

- **Layer 0 — /boot** — orientation. The system pretends to be helpful.
- **Layer 1 — /var/lore** — archived threads, logs, first anomalies.
- **Layer 2 — /proc/grin** — running processes that talk back. Entities.
- **Layer 3 — /dev/core** — the Grin Core. Endings live here.

Ties into existing universe: the Grin Core (Trollrreria v2 lore), $TROLL
flavor text, trollface entities. No IRL city names (per existing lore rule).

---

## 3. Core mechanics

### 3.1 CORRUPTION (the signature system)
A 0–100% meter. Reading broken files, lying to entities, and forbidden
commands raise it. Purge commands and "clean" choices lower it (scarce).

**The UI degrades with the meter.** Corruption tiers map to CSS classes on
`<body>`:

| Tier | Range | Visual state |
|---|---|---|
| CLEAN | 0–24 | near-black terminal, phosphor-green text, cursor blink only |
| NOISY | 25–49 | pixelNoise on bg, green starts flickering toward sickly yellow-green |
| TEARING | 50–74 | pixelGlitch tears on headers, scanBar sweeps, marquee warnings, text tinting red at the edges |
| BLEEDING | 75–99 | constant glitch layers, deep red glow pulse replaces green, letters occasionally swap to bone/skull glyphs |
| CRASH | 100 | **full in-page crash screen** — black background, dripping blood-red ASCII, troll error codes (`TROLL_IRQL_NOT_LESS_OR_EQUAL`) |

### 3.6 Palette lock
- **Base (CLEAN):** `#0a0a0a` near-black bg, `#33ff66` phosphor toxic-green
  text (classic evil-terminal green), `#1a1a1a` panel fill, hairline
  borders `rgba(51,255,102,0.25)`
- **Escalation:** green desaturates and shifts toward `#8b0000`/`#ff1a1a`
  (blood red) as corruption climbs — a straight `hue-rotate` + color-mix
  driven by the tier class, not a hard swap, so it feels like decay
- **Crash-only accent:** pure black `#000` with red `#ff0000` glow, no
  green survives past 100%
- Troll-green `#34c759` (site's own accent) appears **only** on the
  trollface entity itself in Layer 2 — a "friendly" color note inside all
  the hostility, on purpose

Risk/reward: **[BLEEDING]-status lore threads can only be opened at 75%+
corruption.** The best loot sits next to the cliff.

### 3.2 CYCLES (action economy)
Each run grants ~30 cycles. Every command costs 1–3. Descending a layer
refunds a few. Run ends at 0 cycles (forced ending roll) or at an ending
node. Keeps runs at 10–20 minutes.

### 3.3 Branching narrative engine
Content is a node graph in a JS object: `{id, layer, text, ascii?, choices:
[{label, cost, corruption, goto, requires?}]}`. Typewriter-rendered text,
choices selectable by click or number keys. `requires` gates on corruption
range, inventory flags, or lore-unlock state — this is how replays differ.

### 3.4 Endings (4)
1. **PURGE** — finish Layer 3 under 25% corruption. The system is wiped clean.
2. **COMMUNION** — finish at 75–99%. You join the Grin. Troll ending.
3. **EQUILIBRIUM** (secret) — exact conditions hidden; requires flags from
   all three layers across multiple runs.
4. **CRASH** — hit 100% anywhere. BSOD. Still awards collected lore.

### 3.5 Meta-progression
Lore entries and thread unlocks **persist across runs** (localStorage), collected in a
LIBRARY screen. Endings are collectible badges. This is the replay hook.

---

## 4. Integration with the arcade

- **No leaderboard.** Deliberately not wired — this game skips the shared
  cross-game weekly ladder entirely. (Was built and verified, then pulled
  per a direct call not to have one; also drops the Supabase/troll-accounts
  script tags and CSP allowances that existed only to support it.) Meta-
  progression is purely local via the Lore Library (§3.5).
- **TrollNotis** — NOT wired, on purpose. Its real API (`assets/js/troll-notis.js`)
  is a social-media cross-post announcer (X/TikTok), not a generic achievement
  toast system — Troll High evaluated it for the same use case and rejected it
  for the same reason (see `docs/TROLL-HIGH.md` §14). Lore unlocks and
  corruption-tier escalation use a small in-game toast built for this game
  instead (`#ts-toast` — no external dependency).
- **Accounts** — optional: if logged in, save-state sync later; localStorage
  first. Login NOT required (unlike Troll High).
- **Hub** — new `hub-card-play` card on `index.html` linking `nullface.html`.
- **No payments.** Nothing in this game touches TrollPay/real money.

---

## 5. File plan

- `nullface.html` — the whole game (inline CSS + JS, repo convention)
- `docs/TROLL-SYS.md` — this doc
- Hub card added to `index.html`

---

## 6. Build phases (each merged to main on completion)

- **Phase 0 — Shell + aesthetic system.** Boot sequence (fake POST with
  troll flavor), terminal frame, full CSS effect kit (all keyframes,
  corruption-tier body classes, CRT scanline overlay), BSOD screen as a
  testable standalone state, hub card. *Deliverable: it looks alive.*
- **Phase 1 — Engine.** Node graph runtime, typewriter, choice input
  (click + 1-9 keys), corruption meter + tier switching, cycles, run
  start/end loop.
- **Phase 2 — Act 1 content.** Layers 0–1 nodes, lore LIBRARY with
  persistence, thread status system (OPEN/LOCKED/BLEEDING/DISPUTED/
  REDACTED as gate types).
- **Phase 3 — Acts 2–3.** Layer 2 entities (dialogue trees), Layer 3,
  all four endings, full BSOD crash flow.
- **Phase 4 — Arcade wiring.** ~~Leaderboard seam~~ (built, then removed —
  no leaderboard for this game, by request). In-game toast for lore
  unlocks + corruption-tier escalation (not TrollNotis — see §4).
- **Phase 5 — Polish. DONE.** Procedural WebAudio (no audio files): typewriter
  ticks, tier-escalation alert blips, crash noise burst, UI blip on choice —
  all gated by a header mute toggle (`#btn-mute`), default OFF, persisted in
  localStorage. Mobile layout pass: 44px+ tap targets on all choice buttons
  (verified at a 390px viewport), cost/corruption tag drops to its own line
  on narrow screens. Reduced-motion: verified via `emulateMediaFeatures` that
  every decorative animation (terminal glitch/noise, scanbar, brand pulse,
  tier label, marquee, cursor, crash glow) computes `animation-name: none`
  under `prefers-reduced-motion: reduce`, including at the worst-case
  bleeding tier. EQUILIBRIUM's cross-run trigger was already playtested for
  real in Phase 2 (a 3-run sequence where the secret ending only unlocked
  once prior runs had banked the three required flags).

---

## 7. Open questions (need your call)

1. **Name** — LOCKED as `NULLFACE` (renamed from the working title
   `TROLL.SYS`; other candidates considered: `GRIN.SYS`, `HOLLOW.SYS`,
   `ROT.SYS`).
2. **Tone ceiling** — reference site leans creepy/occult. How dark can the
   writing go vs. keeping it cheeky-troll? (Proposed: creepy delivery,
   troll punchlines — the horror always resolves into a prank.)
3. **Run length** — 30 cycles ≈ 10–20 min runs. Shorter/longer?
