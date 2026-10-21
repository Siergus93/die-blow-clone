# Die Blow — Game Design & Mechanics Specification

A tiny top-down action RPG (Diablo/PoE flavoured) built on HTML5 Canvas with zero
dependencies. This document describes **every mechanic currently implemented** in
`game.js` as of the current build. It is a description of the code as written, not a
wishlist — planned work is tracked separately in [`ROADMAP.md`](ROADMAP.md).

| | |
|---|---|
| **Files** | `index.html` (canvas + HUD page), `game.js` (all logic), `style.css` (page chrome) |
| **Docs** | `README.md` (how to play), `SPECS.md` (current behaviour), `ROADMAP.md` (planned work) |
| **Runtime** | Any modern browser. No build step, no server, no dependencies. |
| **Canvas** | 1280 × 720, scaled via CSS to at most 96vw / 90vh |
| **Tick** | `requestAnimationFrame`; delta-time based, `dt` capped at **0.05 s**. While paused, on the title screen or on the death summary the tick keeps running but all simulation updates — and the global `elapsed` clock — are skipped. Rendering still happens every frame (see §2.1, §2.2). |
| **Language** | Plain ES2020 JavaScript in one `"use strict"` module scope |

All numeric values below are the actual constants from the source.

---

## 1. World & Camera

| Property | Value |
|---|---|
| World size | **2600 × 1800** px (hard rectangle, no wrap) |
| Base floor colour | `#141419` with a 64 px grid overlay at 2.5% white |
| World border | 3 px rectangle, `rgba(160,40,40,0.35)` |
| Player start | World centre (1300, 900) |

**Camera**
- Follows the player, offset so the player is centred on screen.
- Target position is clamped to `[0, world - viewport]`, so the camera never shows
  outside the world.
- Smoothed with exponential lerp: `camera += (target - camera) * (1 - 0.001^dt)`
  (≈ 90% of the way to target every frame at 60 fps).
- **Screen shake**: a scalar `shake` value decays at **30 units/s**. While non-zero,
  the world layer is translated by a random offset of up to ±`shake` px each frame.
  Only the world is shaken — the HUD is drawn after `ctx.restore()`.

**Static decor** (generated once, never changes)
- 90 items placed by a deterministic seeded LCG (`seed = 12345`) — same layout every run.
- 60% are **rocks** (`#232329` ellipse), 40% are **bones** (short tan line segments).
- Purely cosmetic: **no collision**.

---

## 2. Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move up / left / down / right |
| **Left click (hold)** | Move toward the cursor (click-to-move) |
| **Right click** | Cast Fireball toward the cursor |
| `1` | Cast Fireball toward the cursor |
| `SPACE` | Melee swing (aims toward the cursor) |
| `ESC` | Toggle pause (during a run only) |
| `R` / `Enter` / `SPACE` / **left click** | Start a new run (summary screen only) |

Rules and edge cases:
- **WASD has absolute priority.** If any WASD key is held, click-to-move is ignored
  entirely for that frame, even while the left button is held.
- Diagonal WASD input is normalised — diagonal speed equals cardinal speed.
- **Left click never attacks.** It is movement-only.
- Right-click is cast-on-press (not on-hold). Browser context menu is suppressed on
  the canvas. `1` uses OS key-repeat, so *holding* `1` auto-casts whenever the
  fireball comes off cooldown.
- **Melee is press-only**: `SPACE` swings on keydown and ignores OS key-repeat, so
  holding `Space` does not chain swings — you must tap it. `Space` also calls
  `preventDefault()` so the page does not scroll.
- Key state is tracked in a `Set` of lowercased key names, added on `keydown` and
  removed on `keyup` (keydown repeat is harmless).
- **Title screen:** on load the game opens on a title screen with simulation frozen.
  A left click or any non-modifier key starts a fresh run.
- **Death summary:** when the player dies the summary opens immediately. Only `R`,
  `Enter`, `Space` or a left click restart; all other input is ignored. The summary
  waits indefinitely — it never times out or auto-restarts.
- While paused, all gameplay input is ignored (see §2.1).

### 2.1 Pause

| Property | Value |
|---|---|
| Toggle | `ESC` (keydown, switches between the `playing` and `paused` states; ignored on the title and summary screens) |
| Effect | All simulation updates are skipped: spawner, player, enemies, projectiles, particles, floating text and camera. |
| Still running | Rendering. The scene and HUD are redrawn every paused frame from frozen state, then the overlay is drawn last. `dt` is recomputed from a fresh timestamp, so nothing "catches up" on resume. |

While paused:
- Movement keys (`WASD`), fireball casts (`1`, right-click) and click-to-move are
  ignored. `tryCastFireball()` returns early, the mouse-down handler returns early, and
  the keydown handler drops any key other than `ESC`.
- Key state is still tracked (keys pressed *before* pausing stay "held" until released,
  so the player does not keep running after resuming).
- **The pause overlay** dims the screen with `rgba(6,6,10,0.72)` and shows:
  - `PAUSED` (bold 54 px)
  - `Press ESC to resume` (grey 15 px)
  - A control recap: WASD/left-click move, `SPACE` melee, right-click or `1`
    fireball, ESC pause
  - A status line: `Wave n · Kills n · Lv n · HP x/y · m:ss`

The overlay dims the already-rendered frame, so the HUD and world remain faintly visible
behind it. Any active screen shake is zeroed on pause so the frozen scene does not
jitter.

### 2.2 Run lifecycle

| State | Entered by | Simulation | Input |
|---|---|---|---|
| `title` | page load | frozen | left click or any non-modifier key starts a run |
| `playing` | title start, summary restart | full | normal controls (§2) |
| `paused` | `ESC` from `playing` | frozen | `ESC` resumes; all else ignored |
| `summary` | HP reaches 0 | frozen | `R` / `Enter` / `Space` / left click starts a new run |

- The run clock is `elapsed`: it advances only in `playing`, freezes at the moment of
  death (that value is the summary's survival time), and resets to 0 on every run.
- Enemies, projectiles and particles freeze while the summary is open; the world stays
  visible under the overlay.
- The summary appears immediately on death and waits indefinitely for restart input.
- There is no way back to the title screen without refreshing the page.

---

## 3. Player

| Stat | Value |
|---|---|
| Hit points | 100 / 100 at level 1 (max +10 per level) |
| Level | Starts at **1** |
| XP | Starts at **0**; XP to next level = `round(25 × level^1.6)` |
| Move speed | 240 px/s (same for WASD and click-to-move) |
| Body radius | 16 px (used for hit tests and world clamping) |
| Facing | Angle in radians, always pointing at the cursor; drives the melee arc and the facing dot |
| Start position | World centre |

**Movement details**
- WASD: direction vector from keys, normalised, then `pos += dir * 240 * dt`.
- Click-to-move: the player walks straight toward the cursor position and **stops
  within 6 px** of it. There is no pathfinding — obstacles do not exist, so
  straight-line movement is always valid.
- **Facing always points at the cursor**, regardless of how the player is moving
  (WASD or click-to-move). Nothing ever changes facing except cursor motion; melee
  swings and the facing indicator therefore always aim where the mouse is.
- Position is clamped to `[r, world - r]` on both axes, so the body can never leave
  the world.
- There is **no collision with enemies** (only enemies separate from each other).

**Health recovery**

There are three ways the player regains HP; all are passive (no potions yet):

| Source | Amount | Condition |
|---|---|---|
| Out-of-combat regen | 3 HP/s | 5 s since last damage, HP below max |
| **Wave-clear heal** | **100% of max HP** | Every time a new wave begins, i.e. after killing everything from the previous one (§7) |
| Level-up heal | **100% of max HP** | Each level gained |

- The **wave-clear heal** caps at max HP, so it only shows a `+n` popup (green text +
  14 green particles, `#6ee06e`) when it actually restored something. If you are
  already at full health, a "Wave survived — fully healed" banner still appears under
  the wave number only when healing occurred.
- Healing is skipped entirely while the player is dead (including the level-up heal).
- Any damage source resets the regen clock.

### Experience & leveling

**Earning XP**
- XP is awarded by `damageEnemy()` in the kill branch, so only **real kills** grant XP.
- Base XP per type: **Zombie 8 · Skeleton 10 · Imp 6**.
- Each spawned enemy bakes in its XP at spawn time, scaled by the wave it spawned in:
  `xp = round(baseXp × (1 + (wave − 1) × 0.15))`.
- XP and levels do **not** survive death: dying restarts the entire run at level 1
  with 0 XP (§8.4).
- A small purple `+n XP` (12 px, `#b48cff`) floats off the player on each kill.

**Level curve** — `xpToNext = round(25 × level^1.6)`

| Level | XP to next | Cumulative |
|---|---|---|
| 1 → 2 | 25 | 25 |
| 2 → 3 | 76 | 101 |
| 3 → 4 | 145 | 246 |
| 4 → 5 | 230 | 476 |
| 5 → 6 | 330 | 806 |

Multiple level-ups in one XP award are handled by a `while` loop (surplus XP carries
over).

**Rewards per level (automatic, no choices)**
- **+10 max HP** (then a full heal via `healPlayer(1)`, capped at the new max)
- **+2 melee damage** — melee base becomes `32 + (level − 1) × 2`
- **+2 fireball damage** — projectile damage becomes `40 + (level − 1) × 2`
- Level-up feedback: gold **"LEVEL UP!"** screen banner, a `Lv n` popup at the player,
  and 24 gold particles.

At level 5: 140 HP, 40 melee, 48 fireball.

### Combo (kill chain)

- Every kill adds **1 combo** and refreshes the chain window to **5 s**. If 5 s pass
  without a kill, the combo (and its bonus) resets to 0.
- Combo **level** = `min(10, floor(combo / 5))` — every **5 kills** grants a level.
  Each level adds **+6% melee and fireball damage**, up to **+60%** at level 10
  (50 kills in one chain).
- The multiplier is `1 + 0.06 × level` and applies when damage is resolved: melee
  before its ×0.85–1.15 roll and crit, fireball when it explodes. Multi-kills from one
  swing or explosion use the multiplier from before that attack.
- The window only counts down while `playing`; pausing freezes it. Death immediately
  resets the chain, and every new run starts at 0.
- Feedback: the meter pops on every kill; each new level shows a gold `COMBO LV n`
  popup (`MAX COMBO!` at 50+) and 12 gold particles at the player.
- The right-side meter (§9) appears while the chain is active and hides at 0.

---

## 4. Melee Attack (`SPACE`)

Melee is a manually triggered swing bound to `SPACE`.

**Trigger**
- On `SPACE` keydown (ignoring OS key-repeat), `tryMelee()` runs. It is ignored while
  paused, while dead, and while the melee cooldown is still running (a press during
  the cooldown is simply lost — there is no buffering).
- A successful swing resolves in the player's facing, which always points at the
  cursor (§3) — so melee aims with the mouse, like the fireball. There is no
  auto-swing and no auto-aim toward nearby enemies.

**Swing**
| Property | Value |
|---|---|
| Cooldown | **0.45 s** |
| Range | **82 px** (centre-to-centre check against `range + enemy.radius`) |
| Arc | **0.8π ≈ 144°** cone centred on facing |
| Base damage | **32 + 2 per level above 1**, × combo multiplier (§3), randomised ×0.85 … ×1.15 |
| Critical chance | **15%** → ×2 damage |
| Swing animation | 0.16 s white arc drawn at 0.75 × range, expanding across the cone |
| Screen shake | 3 (takes the max; never reduces an existing larger shake) |

Multiple enemies inside the cone are **all hit** by a single swing (cleave).

---

## 5. Fireball

| Property | Value |
|---|---|
| Cooldown | **1.3 s** |
| Projectile speed | **540 px/s** |
| Projectile hit radius | 9 px |
| Spawn offset | 20 px in front of the player |
| Lifetime | **1.6 s** (≈ 860 px of travel) |
| Direct/AoE damage | **40 + 2 per level above 1** base, × combo multiplier (§3) at explosion |
| Explosion radius | **72 px** |
| Critical chance | 15% → ×2 |

**Flight & impact**
- Travels in a straight line toward the cursor's world position at the moment of cast.
- Emits 1 small ember particle per frame (alternating orange/yellow).
- On touching any enemy (`distance < 9 + enemy.radius`) it **explodes**.
- Explosion damage applies once to every living enemy within `72 + enemy.radius`,
  with linear falloff:
  `falloff = clamp(1 - d / (72 + enemy.radius) + 0.4, 0.4, 1)` — i.e. **40% damage at
  the edge, 100% at the centre** — then × combo multiplier (§3), ×0.9…×1.1 random
  spread, then ×2 on crit.
- Explosion VFX: 22 orange + 10 bright-yellow particles, screen shake 6.

**Quirks**
- A fireball that expires by lifetime or leaves the world **vanishes silently** — it
  only explodes on enemy contact. There is no ground/obstacle collision.

---

## 6. Enemies

### 6.1 Types

| Type | HP | Speed | Damage | Reach | Attack CD | Radius | XP | Colour | Behaviour |
|---|---|---|---|---|---|---|---|---|---|
| **Zombie** | 70 | 85 | 12 | 46 px | 1.0 s | 18 | 8 | `#5d8a3c` (green) | Melee chaser |
| **Skeleton** | 45 | 78 | 10 | 300 px | 1.9 s | 16 | 10 | `#cfc9b8` (bone) | Ranged archer |
| **Imp** | 30 | 168 | 7 | 38 px | 0.6 s | 12 | 6 | `#b5423a` (red) | Fast melee |

### 6.2 Per-spawn variation & wave scaling

On spawn, with `wave` = current wave number:

- `maxHp = round(baseHp × (1 + wave × 0.13))`
- `damage = round(baseDamage × (1 + wave × 0.08))`
- `speed = baseSpeed × random(0.9 … 1.1)`
- `xp = round(baseXp × (1 + (wave − 1) × 0.15))` (see §3)
- Initial attack cooldown is randomised in `[0, type cooldown)` so a spawned group
  does not strike in unison.

### 6.3 AI

All AI is **direct, stateless seek** — no pathfinding, no aggro radius, no memory.
Enemies always know exactly where the player is.

- **Melee types (zombie, imp):** walk straight at the player until
  `distance ≤ reach`; then, when their cooldown is ready, deal `damage` **instantly**
  (no wind-up or dodge window) and lunge 10 px toward the player.
- **Ranged type (skeleton):** maintains a preferred band of **260 ± 40 px** —
  advances if farther, retreats if closer — and fires an arrow whenever
  `distance < 300` and its cooldown is ready.
  - Arrow: speed **330 px/s**, hit radius 5, lifetime 2.5 s, damage = enemy damage.
- **Hit-stun:** taking damage from any source (melee or fireball) sets a **0.15 s**
  stun. While stunned, the enemy cannot move, attack, bob, or recover its attack
  cooldown; it still flashes white. Repeated hits refresh the stun.
- **Player dead / summary open:** all enemy updates are skipped, so enemies freeze
  completely — movement, attacks, cooldowns and wobble.
- **Separation:** each enemy is nudged away from every other enemy closer than
  `r₁ + r₂ − 6` px, at a force proportional to overlap. This is an O(n²) pass and
  prevents perfect stacking.
- Enemies are clamped to the world edges.

### 6.4 Enemy presentation
- A ground shadow ellipse under each body.
- Body is a flat circle; a walk **wobble** (`sin(t × 6) × 2`) offsets it slightly.
- Two **eyes** are drawn offset toward the player, so enemies visibly "look at" you.
- A **white flash** lasts 0.12 s on taking damage.
- A red HP bar (2.2 × radius wide, 5 px tall) appears **above** the enemy only once
  it is below full health.
- On death: 16 blood particles + a **corpse decal** left on the floor.
  Corpses are capped at **120** (oldest removed first) and are purely cosmetic.

---

## 7. Waves & Spawning

| Property | Value |
|---|---|
| Wave length | **25 s** of spawning |
| Next wave | Starts **only when every enemy from the current wave is dead** (see below) |
| First spawn delay | 1.5 s after a run starts (and again after each clear) |
| Spawn interval | `max(0.45, 2.2 − wave × 0.14)` s |
| Enemies per spawn tick | Base `1 + floor(wave / 3)`, **+10%** `SPAWN_COUNT_MULT` (fractional bonus spawns carry to later ticks) |
| Wave start | `wave = 1` when a run starts; a gold "WAVE n" banner flashes on screen when a wave begins |
| Wave-clear reward | Clearing a wave **fully heals the player** (see §3) |

**Wave flow (two phases)**
1. **Spawn phase** — `waveTimer` counts up from 0 to 25 s and enemies spawn on the
   interval above. Spawning runs for the whole 25 s regardless of how fast you kill.
   Each tick adds the base count plus 10% extra enemies; leftover fractions are stored
   in `spawnCarry` and paid out on later ticks, so a wave contains roughly 10% more
   enemies than the base count.
2. **Clear phase** — once `waveTimer ≥ 25`, the spawner stops. The next wave (banner,
   full heal, `wave` + 1) begins **only when `livingEnemyCount() === 0`**. There is no
   time limit: a wave cannot be failed, only finished.
   - Each new wave restarts `waveTimer` at 0 and resets `spawnTimer` to 1.5 s, giving a
     short breather before spawning resumes.
   - The HUD progress bar fills gold during the spawn phase; in the clear phase it
     turns green, fills completely, and a `Clear the remaining: n` line appears under
     the kill counter (§9).

**Spawn placement**
- Up to 20 attempts to find a legal point; each attempt picks a random world edge
  relative to the camera (just outside the viewport, ±60 px) and clamps it inside the
  world.
- The attempt is accepted early if the point is **more than 420 px** from the player;
  otherwise the last attempt is used.
- Quirk: when the camera is against a world edge, clamped spawn points can land
  **inside the visible viewport**, so enemies can appear on screen.

**Type selection** (`roll = random(0…1)`, evaluated in order):
1. Default: **Zombie**
2. If `wave ≥ 2` and `roll > 0.65` → **Skeleton**
3. If `wave ≥ 3` and `roll > 0.87` → **Imp** (overrides skeleton)

Approximate mix at wave ≥ 3: 65% zombie / 22% skeleton / 13% imp.

---

## 8. Damage, Death & Respawn

### 8.1 Damage bookkeeping
- `damageEnemy()` is the single funnel for all damage dealt to enemies: it applies HP
  loss, triggers the 0.12 s white flash, applies the **0.15 s hit-stun** (§6.3), spawns
  a floating damage number, and emits 5 blood particles (10 on a crit).
- Floating numbers: crits are **orange `#ffab3d` at 20 px**, normal hits **white at
  14 px**; they rise at 34 px/s and fade over 1.0 s.
- Killing an enemy (HP ≤ 0 in `damageEnemy`) increments the **kill counter**, registers
  a **combo kill** (§3), awards its **XP** (see §3), emits a larger blood burst, and
  drops a corpse decal. Dead enemies are removed from the array at the end of the enemy
  update pass.

### 8.2 Taking damage
- On any hit: apply damage, reset the regen clock, screen shake 5, floating
  `-n` text in red 16 px, 8 blood particles.
- At **HP ≤ 0**: HP clamps to 0, the player enters the **summary** state immediately
  (no death animation beat) and the run is recorded.

### 8.3 Death summary
- The player dies and `summary` opens **immediately**: movement, casting, spawning,
  enemies and projectiles all freeze, the run clock stops at the moment of death, and
  the player body is not drawn.
- The full-screen overlay shows **"YOU DIED"**, **"RUN SUMMARY"**, the run stats (wave,
  kills, level, survival time), the all-time best, **NEW BEST** tags, and
  `Press R or click to start a new run`.
- The summary waits indefinitely — it never times out and nothing advances until the
  player restarts.
- The HUD HP bar renders in a darker red while the summary is open.

### 8.4 Records & summary restart (no respawn)
- At the moment of death, `recordRun()` captures the run and updates the all-time
  bests. The summary (§8.3) shows:
  - `Reached wave n`
  - `Kills n`
  - `Level n · Survived m:ss`
  - `All-time best: wave n · kills n`
  - Any stat that beat the stored record is tagged **NEW BEST** in gold.
- **Best records** live in `localStorage["dieblow.best.v1"]` — best-ever wave, kills,
  level and survival time. All storage access is wrapped in `try/catch`; a failure is
  silent and never blocks play. The title screen shows the stored best when present.
- Restarting (`R` / `Enter` / `Space` / left click) calls `restartGame()`, which
  resets **everything**:
  - Player: 100/100 HP, level 1, 0 XP, position = world centre, all cooldowns zeroed,
    regen clock reset.
  - Run state: **wave back to 1**, kill counter 0, spawner back to its initial state
    (1.5 s delay, `waveTimer = 0`).
  - World: all enemies, projectiles, particles, floating text and corpse decals are
    cleared; screen shake zeroed; camera snapped to the world centre.
  - `elapsed` is reset to 0, so out-of-combat regen starts fresh too.
- A gold **"NEW RUN"** banner (screen space) plays on the fresh start.
- The static floor decor is untouched (it is generated once at load and never changes).

---

## 9. HUD

All HUD elements are drawn in screen space, unaffected by camera shake.

| Element | Position | Notes |
|---|---|---|
| HP bar | top-left (20, 20) | 260 × 22; dark frame; shows `ceil(hp) / maxHp` centred |
| XP bar | top-left, under HP bar | 260 × 6 px purple fill; `Lv n` left and `xp / xpToNext XP` right in 11 px text |
| Wave label | top-right | `Wave n`, bold 16 px |
| Kill counter | top-right, below | `Kills: n`, 13 px grey |
| Wave progress bar | top-right | 120 × 4 px; gold fill over the 25 s spawn phase, green + full once cleared, with `Clear the remaining: n` underneath (§7) |
| Combo meter | right side, vertically centred | Appears at combo ≥ 1: kill count, `LV n · +x% DMG`, 5 s window bar and seconds left; hidden at 0; pops on each kill — see §3 |
| Fireball slot | bottom-left (34, H−40) | 40 px circle with label `1 / RMB` |
| Summary overlay | full screen | Immediately on death: `YOU DIED`, run stats, `NEW BEST` tags, all-time best, restart prompt; waits for input — see §8.3/§8.4 |
| Title overlay | full screen | On load: name, controls, best run, start prompt; the HUD is hidden — see §2.2 |
| Pause overlay | full screen | Replaces the frame only while paused — see §2.1 |

The fireball slot shows a **radial cooldown sweep** while recharging and a glowing
orange orb when ready.

---

## 10. Visual Effects & Rendering Order

**Effects**
- **Particles** (`addParticles`): initial speed 30–100% of a given max speed, random
  direction, radius 1.5–3.5 px, lifetime 50–100% of the given max. Velocity decays
  with `× 0.05^dt` (very strong drag), alpha fades linearly with remaining life.
- **Floating text** (`addText`): 1 s life; world-space text drifts up, screen-space
  text (wave banner) stays fixed.
- **Screen shake** sources: melee swing 3, fireball explosion 6, player hurt 5.
  Applied as a per-frame random translate of the world layer only.

**Draw order per frame**
1. `ctx.save()` + shake translate
2. Floor: base fill → tile grid → world border → decor → corpses
3. Actors, depth-sorted by **Y coordinate** (painter's algorithm): shadows, bodies,
   eyes, HP bars
4. Projectiles (fireballs as a 3-stop radial gradient glow; arrows as 10 px lines)
5. Particles, then floating damage text
6. `ctx.restore()`
7. `drawHud()` in screen space

Off-screen culling is applied to decor, corpses, enemies and (implicitly) actors
outside a 40–60 px margin.

---

## 11. Tuning Reference (quick sheet)

```
Player      hp 100 · speed 240 · radius 16 · regen 3/s after 5s · full heal each wave survived
Level       1 start · +10 max hp & +2 melee/+2 fireball dmg per level · full heal on level-up
XP          zombie 8 · skeleton 10 · imp 6 · ×(1 + (wave−1)×0.15) · needed = round(25 × lvl^1.6)
Melee       Space (press only, aims at cursor) · dmg 32 +2/level (×0.85–1.15) · cd 0.45 · range 82 · arc 144° · crit 15% ×2
Fireball    dmg 40 +2/level · cd 1.3 · speed 540 · hit r 9 · aoe 72 · life 1.6s · crit 15% ×2
Combo       1 per kill · 5s window · level = floor(kills/5) max 10 · +6% melee/fireball dmg per level (max +60%)
Zombie      hp 70  · speed 85  · dmg 12 · reach 46  · cd 1.0
Skeleton    hp 45  · speed 78  · dmg 10 · reach 300 · cd 1.9 · arrow 330 px/s
Imp         hp 30  · speed 168 · dmg 7  · reach 38  · cd 0.6
Scaling     hp ×(1 + wave×0.13) · dmg ×(1 + wave×0.08) · speed ×0.9–1.1
Waves       25 s of spawning · next wave only when the field is cleared · spawn every max(0.45, 2.2 − wave×0.14) s · base 1 + wave/3 per tick, ×1.1 enemies (carried)
Stun        0.15 s freeze on every enemy hit (movement, attacks and cooldowns)
Death       immediate YOU DIED summary (stats + best) · waits for R/Enter/Space/click · restarts everything
Records     best wave/kills/level/time in localStorage · shown on title + summary
Pause       ESC toggles · all simulation frozen · overlay with controls + run stats
```

---

## 12. Known Quirks / Inconsistencies

Documented honestly; none are gameplay-breaking.

1. Melee **range gate** in `meleeAttack` uses `distance > range + enemy.radius`
   (centre-to-centre with a full radius bonus). Since the auto-swing trigger was
   removed (§4), this is now the only range check — but it is still measured
   centre-to-centre, so a swing can connect slightly beyond its stated 82 px reach.
2. Fireballs do not explode on expiry or on leaving the world (§5).
3. Holding `1` (or `S`/`D`/`W`/`A` key-repeat) relies on OS key repeat, which varies by
   platform. Melee deliberately does *not* repeat — holding `SPACE` never chains swings.
4. Enemy separation is an O(n²) nested loop; fine at current enemy counts, would need
   spatial hashing at high counts.
5. Spawn placement can put enemies on-screen when the camera is pinned to a world edge
   (§7).
6. `mouse.right` is tracked but never read (casting is triggered directly on press).
7. There is a title screen and a death summary, but no settings screen and no mid-run
   restart — dying (§8.4) or refreshing the page is the only way to reset. `ESC`
   pauses but offers no options.
8. The summary freezes the world from the next frame: the death frame itself still
   finishes updating projectiles, so an in-flight fireball can explode and add kills/XP
   after the run was recorded. Those late kills do not change the recorded summary, and
   they cannot rebuild the combo.

---

## 13. Not Yet Implemented

Anything not listed in this document does not exist yet. Planned work — with goals,
technical notes, acceptance criteria and open decisions — lives in
[`ROADMAP.md`](ROADMAP.md). M0 (foundations & run loop) and M0.1 (combo meter) are
shipped. Remaining order: M1 loot & equipment, M2 build choices, M3 elites/bosses &
obstacles, M4 floors, M5 audio & settings, M6 meta/classes (parked).

---

*Last updated against the current working build. When you change a constant in
`game.js`, update §11 and the relevant table here.*
