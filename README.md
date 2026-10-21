# Die Blow

A tiny top-down action RPG (Diablo/PoE flavoured) built on HTML5 Canvas with **zero
dependencies, no build step and no server**.

## Play

Open `index.html` in any modern browser. Click or press any key on the title screen to
start a run.

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move |
| Left click (hold) | Move toward the cursor |
| `SPACE` | Melee swing (aims at the cursor) |
| Right click or `1` | Fireball |
| `ESC` | Pause / resume |

Waves spawn for 25 seconds; clear the field to advance. Death opens the summary
immediately — it waits for you to press `R` / `Enter` / `Space` or click before the next
run begins. There is no respawn and nothing carries over. Your best wave and kill count
are stored in `localStorage` and shown on the title and summary screens.

Keep killing to build a **combo**: every kill within 5 seconds of the last extends the
chain. Each 5 kills adds +6% melee and fireball damage (up to +60% at level 10). The
meter on the right shows the chain, its power bonus and the remaining window.

## Docs

- [`SPECS.md`](SPECS.md) — every mechanic currently implemented, with exact constants.
- [`ROADMAP.md`](ROADMAP.md) — planned milestones, design decisions and acceptance
  criteria.

## Project rules

- Plain ES2020 in one `game.js`; no frameworks, bundlers or runtime dependencies.
- Keep the game playable straight from `index.html`.
- Update `SPECS.md` and `ROADMAP.md` whenever behaviour or constants change.
