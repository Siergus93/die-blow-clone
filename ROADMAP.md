# Die Blow — Development Roadmap & Future Spec

Companion to [`SPECS.md`](SPECS.md). `SPECS.md` describes **the build as it exists
today**; this document describes **planned work** and the decisions behind it. If the
two disagree about current behaviour, `SPECS.md` is authoritative.

| | |
|---|---|
| **Status** | **M0, M0.1 and M0.2 implemented (git deferred by D9)**. Decisions **D1, D2, D4, D7, D8, D10 signed off**; **D9 postponed**; D3 and D5–D6 open |
| **Last updated** | 2026-10-21 |
| **Baseline** | Playable vertical slice: movement, melee, four selectable active skills (Fireball, Blink, Frost Nova, Chain Lightning) on a single right-click slot, kill-chain combo, 3 enemy types, waves, XP/levels, permadeath run restart, HUD, pause (§1–§13 of `SPECS.md`) |

---

## 0. How this document is used

- **Milestones** are independently shippable slices. Each has a goal, features,
  technical notes, acceptance criteria and a size.
- **Size scale**: **S** ≈ 1 session · **M** ≈ 2–4 sessions · **L** ≈ 5+ sessions
  (a session = one focused working block, not a calendar unit).
- **Status** is one of `planned`, `in progress`, `done`, `parked`.
- A milestone is **done** only when its acceptance criteria pass **and** the
  definition of done in §7 is satisfied. Update this file and `SPECS.md` in the same
  commit as the code.
- Open decisions live in §5. Each has a recommendation and needs a one-line sign-off
  before the dependent milestone starts.

### Status board

| ID | Milestone | Status | Size | Depends on |
|---|---|---|---|---|
| M0 | Foundations & run loop | done (git deferred) | S | — |
| M0.1 | Combo meter | done | S | M0 |
| M0.2 | Active skills & loadout | done | M | M0 |
| M1 | Loot & equipment v1 | planned | L | M0 |
| M2 | Build choices | planned | M | M1 |
| M3a | Elites & bosses | planned | M | M1 |
| M3b | Obstacles & line of sight | planned | M | — |
| M4 | Floors & world progress | planned | M | M0, M3a |
| M5 | Audio, settings & pause menu | planned | M | M0 |
| M6 | Meta-progression & classes | parked (D1) | L | M1–M4 |

---

## 1. Design pillars

Every feature should serve at least one of these; if it serves none, it belongs in
the parking lot (§8).

1. **Combat feel first.** Responsive movement, chunky hits, readable threats. Any
   change that costs input latency or screen clarity is suspect.
2. **Meaningful choices.** A run should end differently than it started because of
   decisions the player made (gear, level-up picks), not only because numbers grew.
3. **Short runs, clean boundaries.** Title → run → death summary → restart. A run is
   a complete arc of 5–20 minutes; nothing carries over silently.
4. **Readable at a glance.** One screen, 1280×720, no hidden stats. If the player
   cannot tell why they died, the design failed.
5. **Zero friction.** No build step, no runtime dependencies, no server. Open
   `index.html` and play.

### 1.1 Run model & scope (decided 2026-10-21)

Signed-off rules. Milestones must not contradict these without a new decision
recorded in §5.

- **D1 — Run-local progression only.** Nothing carries between runs: levels, XP,
  gear, cards and kills all reset on death (already true in the current build). No
  meta-currency, unlocks or persistent power. M6 is deferred, not cancelled.
- **D4 — Endless waves.** There is no victory condition or extraction. A run ends
  only when the hero dies. Floors (M4) extend a run; they do not end it.
- **D8 — No loot after death.** Once the hero is dead (summary open), kills award no
  drops (and, per the current build, nothing they do matters — the run restarts).
  Drop rolls are gated by the death state itself, not by timing inside the death
  animation.

## 2. Technical guardrails

These constraints are part of the project's identity; milestone plans assume them.

| Constraint | Rule |
|---|---|
| Runtime | Any modern browser, plain ES2020, no frameworks, no bundler, no network calls |
| Entry point | `index.html` still opens and plays directly from disk |
| Canvas | Fixed 1280 × 720 internal resolution, CSS-scaled |
| Frame budget | 60 fps with **100 enemies · 150 projectiles · 300 particles** on mid-range hardware; simulation under ~8 ms/frame |
| Entity caps | Corpses 120, ground drops 30, floating texts 80, particles ~600 |
| File layout | `game.js` stays single-file until it passes ~60 KB or ~1 500 lines; then split into ES modules under `src/` loaded via `<script type="module">` (still no build step) |
| Persistence | `localStorage` only, versioned keys, all reads wrapped in `try/catch` with defaults |
| Data | Tunables live in `const` tables (`MELEE`, `FIREBALL`, `ENEMY_TYPES`, new `ITEMS`/`AFFIXES`), never inline in logic |
| Tests | Optional Node harness under `tests/` is **dev-only**; it must not become a runtime dependency |

**Performance rule:** when enemies exceed ~80, replace the O(n²) separation pass with
a spatial hash. When drops or particles exceed their caps, evict oldest first (the
corpse list already does this).

## 3. Milestones

### M0 — Foundations & run loop

**Goal:** make the run lifecycle explicit and legible.

**Why now:** death was permanent but auto-restarted after 2.5 s with no record. The
run had no beginning and no record, so it did not feel like a run.

**Features**

1. **Game state machine.** Replace the `paused` boolean with
   `state ∈ { title, playing, paused, summary }`. All input handlers and the main loop
   branch on it. `summary` opens immediately on death and waits for restart input.
2. **Run tracker.** `run = { elapsed, wave, kills, level }` (or keep deriving from
   existing globals and add a start timestamp). Time survived is shown as `mm:ss`.
3. **Immediate death summary.** When HP reaches 0, show the summary at once — no death
   beat and no countdown:
   - `Reached wave N · Kills K · Level L · Survived T`
   - best wave / best kills from storage, with gold **NEW BEST** tags when beaten
   - `Press R or click to start a new run`; the summary waits indefinitely
4. **Best-run persistence.** `localStorage["dieblow.best.v1"]`:
   `{ wave, kills, level, timeSec, date }`, recorded at the moment of death. Never let
   a storage failure break the game.
5. **Manual restart.** `R` / `Enter` / `Space` / click on the summary calls the existing
   `restartGame()` and enters `playing`. Nothing restarts without player input.
6. **Title screen.** Game name, control recap, `Click or press any key to begin`.
   No simulation, spawning or regen runs on the title screen; the first input starts
   the run. (Reuse the pause-overlay layout/styling.)
7. **Docs now, version control later (D9).** Add a short `README.md` that explains how
   to play and links `SPECS.md` and this file. **Git initialisation is postponed**
   (D9); no `.gitignore` or commits until that decision is revisited.

**Technical notes**

- `elapsed` already resets in `restartGame()`, so it doubles as the run clock; do not
  add a second timer.
- Screen-space `damageTexts` must be cleared by `restartGame()` so banners do not leak
  between runs.
- Death must **record the run once** (stats and bests captured at the moment of death)
  and then immediately enter `summary`; do not recalculate stats after death.
- Keep `restartGame()` as the single reset funnel — the summary restart and (later) the
  pause menu both call it.

**Acceptance criteria**

- [x] Death shows the summary immediately; it waits for input and never auto-restarts.
- [x] Summary values equal the run's wave/kills/level/time at the moment of death.
- [x] Best run survives a page refresh and a new best is flagged exactly once.
- [x] `R`/Enter/Space/click from the summary yields a fresh run: wave 1, level 1, 0 XP,
      100 HP, empty field, centred camera.
- [x] Nothing simulates on the title screen and clicks there do not cast or move.
- [x] `README.md` exists (git init deferred by D9).
- [x] Headless lifecycle test passes: title → start → pause → death → summary →
      restart, with best-run persistence recorded at death.
- [x] Real-browser smoke test (headless Edge) through the same flow: zero page errors.

---

### M0.1 — Combo meter (shipped 2026-10-21)

**Goal:** reward uninterrupted killing with visible, escalating power.

**Features**

1. **Kill chain.** Every kill adds 1 combo and refreshes a **5 s** window. No kill for
   5 s resets the chain; death and every new run reset it immediately.
2. **Power tiers.** `level = min(10, floor(combo / 5))`. Each level grants **+6% melee
   and fireball damage** (max **+60%** at 50 kills).
3. **HUD meter.** Right-side panel with kill count, level/bonus and the remaining 5 s
   window; hidden at 0 and pops on every kill.
4. **Feedback.** Gold `COMBO LV n` popup and particles at each new tier; `MAX COMBO!`
   at level 10.

**Technical notes**

- The multiplier is applied when damage resolves (melee before its random roll, fireball
  at explosion); multi-kills use the multiplier from before the attack.
- The combo window only ticks in `playing`; pausing freezes it, and death resets it.

**Acceptance criteria**

- [x] 5 kills inside the window reach level 1 and measurably increase melee/fireball damage.
- [x] 5 s without a kill resets count, level and bonus.
- [x] Meter appears on the right while active and is hidden at 0.
- [x] Death and restart reset the combo.
- [x] Headless browser test passes (thresholds, damage, timeout, reset, HUD, zero errors).

---

### M0.2 — Active skills & loadout (shipped 2026-10-21)

**Goal:** give right-click a real choice and add movement, control and pack-clear
options, without adding a resource system or more than one new key family.

**Why now:** the fireball was the only active and it owned right-click, which left the
mouse with a single verb. A one-slot loadout makes the choice explicit while keeping
input readable: one cast button, four options.

**Features**

1. **Skill table & single active slot.** `SKILLS` / `SKILL_ORDER` define four actives;
   `selectedSkill` holds exactly one. Selection via `1`–`4` or a left click on a HUD
   slot; the selection persists across runs. Right-click (and only right-click) casts
   the selected skill.
2. **Blink.** 140 px cursor-directed teleport, 0.15 s invulnerability, 5 s cooldown, no
   damage. Clamps to the world; no collision, so it can pass through enemies.
3. **Frost Nova.** 140 px radius burst for `20 + 2/level`, applies a 40% move-speed slow
   for 2.5 s and a pale-blue slow ring. 8 s cooldown.
4. **Chain Lightning.** Instant chain: nearest enemy to the cursor within 240 px, then
   jumps to the nearest un-hit enemy within 180 px, max 5 targets, ×0.85 damage per jump.
   7 s cooldown. A cast with no target shows `NO TARGET` and does not start the cooldown.
5. **Per-skill cooldowns.** `player.skillCd` keyed by skill, all ticked in `updatePlayer`
   and zeroed in `restartGame()`. Casting is refused while the selected skill is cooling
   down (no buffering).
6. **Loadout HUD.** Four 44 px slots along the bottom-left with icons, `1`–`4` badges,
   radial cooldown sweeps + seconds, and a gold double ring on the selected slot.

**Technical notes**

- All three new skills route damage through `damageEnemy()`, so kills, combo, XP and
  future loot keep using the single funnel.
- Nova and Chain use the combo multiplier; Blink does not deal damage and ignores it.
- Frost slow is a per-enemy `slow` timer that scales movement only; it ticks inside the
  normal enemy update (so hit-stun pauses movement but not the slow countdown).
- Blink grants `player.invuln`; `hurtPlayer()` refuses damage while it is positive.
  I-frames do not protect against the summary — death still ends the run.
- Spell visuals live in a separate `spellFx` array (Blink trail, Nova ring, lightning
  links) drawn between projectiles and particles.
- Combo copy was widened to “melee and skill damage” since Nova and Chain now scale too.

**Acceptance criteria**

- [x] `1`–`4` and slot clicks select each skill; the selected slot is visually distinct.
- [x] Right-click casts only the selected skill and respects that skill's cooldown.
- [x] Blink moves exactly 140 px toward the cursor, clamps at the world edge, and blocks
      damage for its i-frame window.
- [x] Frost Nova damages and slows every enemy in radius, and the slow visibly slows
      movement.
- [x] Chain Lightning hits exactly 5 targets with per-jump falloff and leaves the sixth
      untouched; a no-target cast does not consume the cooldown.
- [x] Restart clears all cooldowns; selection survives restart.
- [x] Headless browser test passes (selection, blink distance/i-frames, nova damage+slow,
      chain target count/falloff, cooldown reset, zero page errors).

---

### M1 — Loot & equipment v1

**Goal:** the defining ARPG reward loop — kills produce gear that changes how the
run plays.

**Why next:** it is the largest missing piece of the genre and turns wave-clearing
into a reason to keep going. It also forces the stat pipeline that every later
milestone depends on.

**Features**

1. **Item model.** Three slots to start: `weapon`, `armour`, `trinket`. Two to three
   bases per slot (e.g. sword/axe/staff; leather/plate; ring/amulet). Items are
   generated at drop time, not authored per instance.
2. **Rarity & affixes.** `common / magic / rare / legendary` with 0 / 1 / 2 / 3
   affixes. Affix values scale with `ilvl = wave`. Initial table (to tune):

   | Rarity | Weight | Colour | Affixes |
   |---|---|---|---|
   | Common | 60 | `#b9b9b9` | 0 |
   | Magic | 28 | `#6f9bff` | 1 |
   | Rare | 10 | `#ffd76e` | 2 |
   | Legendary | 2 | `#ff8a3d` | 3 + one fixed flavour affix |

   Affix pool v1: `damagePct`, `maxHpPct`, `moveSpeedPct`, `critChance`,
   `critMult`, `attackSpeedPct`, `fireballAoePct`, `regenPerSec`.
3. **Drop system.** Base drop chance ~15% per kill, with rarity weights shifting
   toward rare/legendary as the wave rises. Drop rolls happen in the kill branch of
   `damageEnemy()` (the existing single funnel), never in rendering code. Drops are
   suppressed once the hero is dead (**D8**): the roll sits behind a `!player.dead`
   guard, so no loot appears while the death summary is open.
4. **Ground drops.** A small glowing marker + item-name label in rarity colour,
   bobbing in place. Walk within ~24 px to pick up. Drops are capped (§2) and
   despawn after ~45 s. Non-picked drops are lost on run restart.
5. **Stat pipeline (architectural core).** Introduce:

   ```js
   player.base  = { maxHp: 100, meleeDamage: 32, fireballDamage: 40, moveSpeed: 240, critChance: 0.15 };
   player.stats = { ...derived after level growth + equipment };
   function recomputeStats() { /* base + level + gear, clamp sane ranges */ }
   ```

   All combat/UI code reads `player.stats.*` instead of `MELEE.damage`,
   `FIREBALL.damage` or `player.maxHp` directly. `recomputeStats()` is called on
   equip/unequip, level-up and run restart.
6. **Inventory overlay.** Toggle with `I` (and later `Tab`); pauses simulation like
   the pause screen. Shows three equipment slots and a grid of carried items; click
   to equip/unequip; hover/selected tooltip with **green/red Δ values versus the
   currently equipped item**. The presentation choice (pausing overlay vs.
   always-visible panel) is **postponed as D2** — decide at M1 kickoff.
7. **HP edge case.** If `maxHp` changes while damaged, clamp `hp` to the new max and
   keep the current value (do not heal to full on equip).
8. **Summary integration.** The death summary lists the best item found (name +
   rarity).

**Out of scope for M1:** gold, vendors, item levels beyond `ilvl`, sockets, sets,
crafting, stash/inventory persistence across runs. One vertical slice done well beats
a shallow full system.

**Acceptance criteria**

- [ ] A +10% damage weapon measurably raises melee and fireball damage; unequipping
      restores the original values exactly.
- [ ] +max HP gear raises the cap and clamps current HP correctly.
- [ ] Drop luck is visible: kills occasionally produce colour-coded loot, pickup
      works by walking over it, and the label matches the tooltip.
- [ ] Tooltip comparison numbers match the actual post-equip stats.
- [ ] Restart clears inventory, equipped gear and ground drops.
- [ ] No item drops are generated once the hero is dead (D8).
- [ ] 30 simultaneous drops + 100 enemies still hold 60 fps.
- [ ] No NaN/undefined stats when an item lacks an affix.

---

### M2 — Build choices

**Goal:** every level-up is a decision, so two runs diverge even with similar loot.

**Why:** automatic `+2 melee / +2 fireball` growth means builds do not exist yet.
Card picks are the cheapest mechanism that creates real choice without a full skill
tree.

**Features**

1. **Level-up flow.** On level-up the simulation pauses and three cards appear
   (drawn without replacement from the eligible pool). Select with click or `1/2/3`.
   The run resumes on selection. A card must be chosen (no dismiss), so the player
   never leaves value on the table by accident.
2. **Card pool v1** (values per rank, all tuneable):
   - *Brutality* — +8% melee damage
   - *Pyromancy* — +8% fireball damage
   - *Swift Hands* — +6% attack speed (reduces melee + fireball cooldown)
   - *Keen Edge* — +4% crit chance
   - *Deep Wounds* — +30% crit damage
   - *Vitality* — +12% max HP
   - *Regeneration* — +1 HP/s regen
   - *Fleet Footed* — +5% move speed
   - *Wide Blast* — +10% fireball radius
3. **Ranking & repetition.** Cards can repeat across level-ups and stack; each pick
   is recorded in `run.picks` for the summary.
4. **Base growth stays.** The existing `+10 max HP` per level remains; the automatic
   `+2/+2 damage` is removed and replaced by cards/gear. (Decision D3.)
5. **Summary integration.** The death summary lists the player's top three picks.

**Technical notes**

- Picks feed the same `player.stats` pipeline from M1; no separate modifier system.
- Use additive percentage buckets, then multiply once — avoids runaway multiplicative
  scaling.
- Cooldown reductions should be capped (≥ 60% of base cooldown).

**Acceptance criteria**

- [ ] A level-up freezes all gameplay until a card is chosen.
- [ ] Each card changes a visible, measurable value (sheet/tooltip or observed
      behaviour).
- [ ] Picks stack predictably and survive until death, then reset.
- [ ] Card UI is readable at 1280×720 and keyboard-navigable.
- [ ] No card can reduce a stat below its designed floor.

---

### M3a — Elites & bosses

**Goal:** give waves peaks, not just a rising line.

**Features**

1. **Elites.** From wave 5 on, one elite appears per wave; from wave 8, up to two.
   Elites are scaled +80% HP, +25% damage, +15% size, with a coloured aura ring, a
   name label and a wider HP bar.
2. **Modifiers v1.** Each elite rolls one: *Swift* (+40% speed), *Armoured* (−35%
   damage taken), *Volatile* (explodes for area damage on death), *Splitting*
   (spawns two imps on death). Modifier is shown in the name.
3. **Bosses.** Every 10th wave spawns a single boss (start with one per type family,
   e.g. Zombie Brute and Skeleton Lord) with a telegraphed signature attack and a
   second phase below 50% HP.
4. **Rewards.** Elites guarantee one loot drop and award 3× XP; bosses drop two items
   plus a guaranteed rare-or-better. Ties directly into M1's drop system.
5. **Boss bar.** A wide boss health bar appears at the top centre while a boss lives.

**Acceptance criteria**

- [ ] Elite/boss cadence is predictable and announced (banner + aura/name).
- [ ] Modifiers are visually identifiable before engaging.
- [ ] Boss signature attacks are telegraphed and dodgeable.
- [ ] Elite/boss rewards match the drop guarantees.
- [ ] Boss fights do not break wave-clear logic or the summary counters.

---

### M3b — Obstacles & line of sight

**Goal:** make space matter — cover, choke points and projectile blocking.

**Features**

1. **Colliders.** A subset of decor (large rocks, ruined pillars) becomes solid:
   circle colliders stored alongside decor with a `solid` flag.
2. **Movement resolution.** Player and enemies slide around colliders (push-out along
   the collision normal). Never let a body end a frame inside a collider.
3. **Projectile blocking.** Arrows and fireballs stop on solid props; fireballs
   explode at the impact point (this also removes part of the "no ground contact"
   quirk in `SPECS.md` §12).
4. **Line of sight.** Skeletons only fire when LOS to the player is clear; they
   reposition toward an open angle when blocked.
5. **Spawn validation.** Spawn attempts reject points inside or too near a collider.
6. **World clamping** stays as-is; colliders never cross the world border.

**Acceptance criteria**

- [ ] The player cannot walk through solid decor.
- [ ] Arrows/fireballs stop or explode on props at the correct position.
- [ ] Skeletons do not shoot through walls and recover instead of freezing.
- [ ] No enemy spawns inside geometry and no body jitters when wedged between props.
- [ ] 100 enemies with 30 colliders still holds 60 fps.

---

### M4 — Floors & world progress

**Goal:** runs have a sense of descent and changing scenery.

**Scope note (D4):** floors extend an endless run. There is no victory or extraction
state in this milestone.

**Features**

1. **Descent.** After every 10th wave is cleared, a portal opens at the world centre.
   Walking into it advances to the next floor.
2. **Floor generation.** Each floor gets a new deterministic decor seed and a palette
   tint (floor colour, grid tint, prop colours). Wave numbering continues; the run
   clock does not reset.
3. **Floor modifiers v1.** One per floor, announced on entry: *Cursed* (+15% enemy
   damage), *Fertile* (+30% drop chance), *Dense* (+25% enemy count), *Ancient*
   (+20% XP). Modifiers are additive and never stack on the same floor.
4. **Floor HUD.** `Floor n` next to the wave label; the summary reports the deepest
   floor.
5. **Boss gate.** The 10th-wave boss must die before the portal opens (descent
   happens after the clear, boss included).

**Acceptance criteria**

- [ ] Portal appears only after a fully cleared milestone wave.
- [ ] Entering a portal transitions without reload and preserves run/level/gear.
- [ ] Each floor visibly differs and applies exactly one announced modifier.
- [ ] Restart returns to floor 1.
- [ ] Summary shows deepest floor and total time.

---

### M5 — Audio, settings & pause menu

**Goal:** perceived polish and player control.

**Features**

1. **Synthesised SFX (WebAudio, no assets).** Melee swing/hit, crit, fireball cast
   and explosion, enemy death, player hurt, level-up, loot pickup, wave start, UI
   click. Short envelopes, randomised pitch within ±5% to avoid fatigue.
2. **Autoplay policy.** Audio context is created/resumed on the first user gesture;
   nothing plays on the title screen before input.
3. **Settings panel.** Master volume, mute toggle (`M`), screen-shake toggle,
   floating-damage toggle, persisted in `localStorage["dieblow.settings.v1"]`.
4. **Pause menu.** Resume, Restart run (with confirm), Settings, Controls. Full
   keyboard navigation. Replaces the current static overlay.
5. **Accessibility.** Every colour-coded state (rarity, elite modifier, damage type)
   also has a non-colour cue (shape/label/size).
6. **Reduced motion.** Shake toggle participates in `camera.shake` at the source, so
   all shake sources respect it.
7. **Milestone banners.** Keep the existing `WAVE n` banner and add a subtle
   `Floor`-agnostic callout at waves 5/10/15… so pacing has visible shape. Purely
   cosmetic; no balance change. (Carried over from M0, where it was never shipped.)

**Acceptance criteria**

- [ ] No audio before the first gesture; no console errors from the audio graph.
- [ ] Volume/mute persist across refresh and apply immediately.
- [ ] Pause menu is fully usable with keyboard only.
- [ ] Shake toggle removes all screen shake without affecting damage numbers.
- [ ] Milestone callouts appear at waves 5/10/15 and do not alter gameplay.
- [ ] Audio does not degrade frame time measurably at 100 enemies.

---

### M6 — Meta-progression & classes (parked, exploratory)

**Parked by D1:** the game is run-local only for now. Reopening M6 requires a new
decision recorded in §5; until then no persistent power ships.

**Goal:** long-term goals beyond a single run. **Not committed** until M1–M4 prove the
core loop is fun.

Candidates, in rough order of value:

1. **Run unlocks** — earn a small meta currency (e.g. 1 per floor) to unlock starting
   gear, new cards, or classes. No power that trivialises early waves.
2. **Classes** — melee bruiser (current), ranged caster (weaker melee, stronger
   fireball), summoner (delayed). Distinct starting stats and one signature skill.
3. **Weapons with patterns** — sword arc (current), spear thrust (narrow/long),
   hammer slam (slow/AoE).
4. **Daily seed / local leaderboard** — deterministic run seed, top ten best runs
   stored locally.

**Gate to start M6:** M1–M4 complete, and a recorded playtest run of ≥ 10 minutes
feels varied. Do not build meta systems on top of an unproven loop.

---

## 4. Cross-cutting architecture notes

- **Single reset funnel.** `restartGame()` must remain the only function that resets
  run state. New systems (loot, picks, floors) add their reset there explicitly.
- **Single damage funnel.** `damageEnemy()` stays the only place that applies enemy
  HP loss, flash/stun, kill credit and drops. Do not duplicate kill logic in new
  features (elites, bosses, volatile explosions).
- **Stats are derived, never mutated ad hoc.** Anything that changes power calls
  `recomputeStats()`; combat reads `player.stats`.
- **RNG.** Keep cosmetic randomness (`rand`) separate from gameplay rolls where it
  matters (drops, card offers). If daily seeds arrive (M6), introduce a seeded RNG
  owned by the run instead of `Math.random`.
- **Persistence is additive and versioned.** New keys get a `.v1` suffix; readers
  merge with defaults field by field.
- **No hidden state in render code.** Rendering reads state; it never advances timers,
  rolls loot or mutates entities.

## 5. Open decisions (need sign-off)

| ID | Question | Recommendation | Status | Blocks |
|---|---|---|---|---|
| D1 | Run-local power only, or meta-progression between runs? | Run-local first; meta in M6 | **Decided 2026-10-21** — run-local only; M6 parked | M6 |
| D2 | Inventory as a pausing overlay, or always-visible panel? | Pausing overlay (`I`), keeps the screen clean | **Postponed** — decide at M1 kickoff | M1 |
| D3 | Keep automatic stat growth per level, or move all damage growth to choices/gear? | Keep `+10 max HP`; replace `+2/+2` with cards | **Open** | M2 |
| D4 | Endless waves, or a victory condition (e.g. floor 3 boss)? | Endless with floor milestones; optional "extract" later | **Decided 2026-10-21** — endless, no victory state | M4 |
| D5 | Synthesised audio or recorded assets? | Synthesised (zero-asset constraint) | Open | M5 |
| D6 | When to split `game.js` into modules? | At ~60 KB / ~1 500 lines, via native ES modules | Open | M1 |
| D7 | Should death show a summary before restart? | Show a summary; wait for input | **Decided 2026-10-21** — summary opens immediately and waits for R/Enter/Space/click | M0 |
| D8 | Item drops after death? | Suppress new drops once the summary opens | **Decided 2026-10-21** — no drops after death | M1 |
| D9 | Initialise git now, or later? | Initialise now for change history | **Postponed 2026-10-21** — revisit before M1 | M0 |
| D10 | One selected active skill on right-click, or separate keybinds/sub-slots per skill? | One selected slot on right-click, `1`–`4` (or HUD click) to select | **Decided 2026-10-21** — single active slot; selection persists across runs | M0.2, M2 |

## 6. Persistence sketch

```js
// localStorage["dieblow.best.v1"]
{ version: 1, wave: 12, kills: 340, level: 9, timeSec: 1234, floor: 2, date: "2026-10-21T…" }

// localStorage["dieblow.settings.v1"]
{ version: 1, volume: 0.8, muted: false, shake: true, damageNumbers: true }

// localStorage["dieblow.meta.v1"]  (M6 only)
{ version: 1, currency: 0, unlocks: [] }
```

All reads: `try { JSON.parse(...) } catch { defaults }`, then merge missing fields from
defaults. Nothing in a save may crash the game if hand-edited or truncated.

## 7. Definition of done (per feature/milestone)

1. Acceptance criteria checked in a real browser (desktop Chrome/Firefox, file:// and
   a local static server if convenient).
2. `SPECS.md` updated — affected sections and, for any constant change, the §11 quick
   sheet.
3. This file's status board and milestone checkboxes updated.
4. Performance spot-check against the §2 budget (worst-case wave).
5. `git commit` with a message naming the milestone (`M1: loot drops + inventory`).
6. No new runtime dependencies; still opens directly from `index.html`.

## 8. Parking lot / ideas not yet scheduled

- Gold pickups, a vendor between floors, and consumables (potion flask on `2`).
- Item stash at the title screen (requires meta persistence).
- Minimap / off-screen enemy indicators.
- Multiple simultaneous projectiles or a fireball that pierces.
- Cursed shrines that trade a debuff for loot.
- Daily challenge seed with a local leaderboard.
- Touch/gamepad support (would need an input abstraction pass).
- Localisation of HUD strings (currently hard-coded English).
- `CHANGELOG.md` once the first milestone ships.

## 9. Explicitly out of scope

- Multiplayer/networking, accounts, cloud saves.
- Mobile-first/touch design, portrait layout.
- 3D or WebGL renderer migration.
- Frameworks, bundlers, TypeScript migration, package managers at runtime.
- Hand-authored campaign levels with dialogue/quests.
- Monetisation of any kind.

## 10. Versioning suggestion

| Version | Contents |
|---|---|
| v0.3 | M0 — title, death summary, best run (git deferred) |
| v0.3.1 | M0.1 — kill-chain combo meter |
| v0.3.2 | M0.2 — active skills & single-slot loadout (Fireball, Blink, Frost Nova, Chain Lightning) |
| v0.4 | M1 — loot, inventory, stat pipeline |
| v0.5 | M2 — level-up cards |
| v0.6 | M3 — elites, bosses, obstacles/LOS |
| v0.7 | M4 — floors and modifiers |
| v0.8 | M5 — audio, settings, pause menu |
| v1.0 | M6 if pursued — classes/meta, plus polish pass |

---

*When a decision in §5 is signed off, move it into §1–§4 as a stated rule and update
the affected milestone. Keep this document honest: if a feature ships differently,
change the plan rather than the history.*
