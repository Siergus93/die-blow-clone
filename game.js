"use strict";

/* ============================================================
   Die Blow — a tiny click-to-move ARPG
   WASD / Left click: move · Space: melee (aims at cursor) · Right click or 1: fireball
   Mechanics reference: SPECS.md
   ============================================================ */

// ---------- setup ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;

const WORLD = { w: 2600, h: 1800 };

// ---------- helpers ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- run lifecycle ----------
const STATE = { TITLE: "title", PLAYING: "playing", PAUSED: "paused", SUMMARY: "summary" };
let state = STATE.TITLE;
let runSummary = null;
let deathElapsed = 0;

// ---------- persistence ----------
const BEST_KEY = "dieblow.best.v1";
const EMPTY_BEST = { wave: 0, kills: 0, level: 0, timeSec: 0 };

function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return { ...EMPTY_BEST };
    const data = JSON.parse(raw) || {};
    return {
      wave: Number.isFinite(data.wave) ? data.wave : 0,
      kills: Number.isFinite(data.kills) ? data.kills : 0,
      level: Number.isFinite(data.level) ? data.level : 0,
      timeSec: Number.isFinite(data.timeSec) ? data.timeSec : 0,
    };
  } catch {
    return { ...EMPTY_BEST };
  }
}

function saveBest(record) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify({ ...record, date: new Date().toISOString() }));
  } catch {
    // storage unavailable — best runs are a bonus, never a requirement
  }
}

let best = loadBest();

// ---------- input ----------
const mouse = { x: W / 2, y: H / 2, left: false, right: false };

canvas.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - r.left) / r.width) * W;
  mouse.y = ((e.clientY - r.top) / r.height) * H;
});
canvas.addEventListener("mousedown", (e) => {
  if (state === STATE.TITLE || state === STATE.SUMMARY) {
    if (e.button === 0) startRun();
    return;
  }
  if (state !== STATE.PLAYING) return;
  if (e.button === 0) mouse.left = true;
  if (e.button === 2) {
    mouse.right = true;
    tryCastFireball();
  }
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) mouse.left = false;
  if (e.button === 2) mouse.right = false;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

const keys = new Set();

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (e.repeat) return;
    if (state === STATE.PLAYING) setPaused(true);
    else if (state === STATE.PAUSED) setPaused(false);
    return;
  }
  if (state === STATE.TITLE) {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === " ") e.preventDefault(); // stop the page from scrolling
    startRun();
    return;
  }
  if (state === STATE.SUMMARY) {
    if (e.repeat) return;
    if (e.key === "r" || e.key === "R" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      startRun();
    }
    return;
  }
  if (state !== STATE.PLAYING) return;
  if (e.key === "1") tryCastFireball();
  if (e.key === " ") {
    e.preventDefault(); // stop the page from scrolling
    if (!e.repeat) tryMelee();
  }
  keys.add(e.key.toLowerCase());
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

const toWorld = (sx, sy) => ({ x: sx + camera.x, y: sy + camera.y });

// ---------- camera ----------
const camera = { x: 0, y: 0, shake: 0 };
function updateCamera(dt) {
  const tx = clamp(player.x - W / 2, 0, WORLD.w - W);
  const ty = clamp(player.y - H / 2, 0, WORLD.h - H);
  camera.x = lerp(camera.x, tx, 1 - Math.pow(0.001, dt));
  camera.y = lerp(camera.y, ty, 1 - Math.pow(0.001, dt));
  camera.shake = Math.max(0, camera.shake - dt * 30);
}

function snapCamera() {
  camera.x = clamp(player.x - W / 2, 0, WORLD.w - W);
  camera.y = clamp(player.y - H / 2, 0, WORLD.h - H);
}

// ---------- player ----------
const xpNeeded = (level) => Math.round(25 * Math.pow(level, 1.6));

const player = {
  x: WORLD.w / 2,
  y: WORLD.h / 2,
  r: 16,
  speed: 240,
  hp: 100,
  maxHp: 100,
  level: 1,
  xp: 0,
  xpToNext: xpNeeded(1),
  facing: 0,
  dead: false,
  lastHurt: -99,
  meleeCd: 0,
  meleeAnim: 0, // remaining swing-arc visual time
  fireCd: 0,
};

const MELEE = { damage: 32, range: 82, cooldown: 0.45, arc: Math.PI * 0.8 };
const FIREBALL = { damage: 40, speed: 540, radius: 9, cooldown: 1.3, aoe: 72 };

// ---------- combo ----------
const COMBO = { window: 5, killsPerLevel: 5, maxLevel: 10, damagePerLevel: 0.06 };
const combo = { count: 0, level: 0, timer: 0, pulse: 0 };

const comboMultiplier = () => 1 + combo.level * COMBO.damagePerLevel;

function resetCombo() {
  combo.count = 0;
  combo.level = 0;
  combo.timer = 0;
  combo.pulse = 0;
}

function updateCombo(dt) {
  combo.pulse = Math.max(0, combo.pulse - dt);
  if (combo.count <= 0) return;
  combo.timer = Math.max(0, combo.timer - dt);
  if (combo.timer > 0) return;
  if (combo.level > 0) addText(player.x, player.y - 50, "COMBO LOST", "#8a8a92", 14);
  resetCombo();
}

function registerComboKill() {
  if (player.dead) return; // no posthumous chain progress in the death frame
  combo.count++;
  combo.timer = COMBO.window;
  combo.pulse = 0.3;
  const level = Math.min(COMBO.maxLevel, Math.floor(combo.count / COMBO.killsPerLevel));
  if (level > combo.level) {
    combo.level = level;
    const maxed = level >= COMBO.maxLevel;
    addText(player.x, player.y - 76, maxed ? "MAX COMBO!" : `COMBO LV ${level}`, "#e0b34a", maxed ? 20 : 18);
    addParticles(player.x, player.y, "#e0b34a", 12, 140, 0.5);
  }
}

snapCamera(); // the title screen should frame the player, not the world corner

// ---------- enemies ----------
const ENEMY_TYPES = {
  zombie: {
    hp: 70, speed: 85, damage: 12, range: 46, cooldown: 1.0,
    r: 18, color: "#5d8a3c", eye: "#d9f27a", ranged: false, xp: 8,
  },
  skeleton: {
    hp: 45, speed: 78, damage: 10, range: 300, cooldown: 1.9,
    r: 16, color: "#cfc9b8", eye: "#111", ranged: true, xp: 10,
  },
  imp: {
    hp: 30, speed: 168, damage: 7, range: 38, cooldown: 0.6,
    r: 12, color: "#b5423a", eye: "#ffd24a", ranged: false, xp: 6,
  },
};

let enemies = [];
let projectiles = [];
let particles = [];
let damageTexts = [];
let corpses = []; // static decals, capped

function spawnEnemy(typeKey, wave) {
  const t = ENEMY_TYPES[typeKey];
  // pick a point just outside the view, inside the world
  let x, y;
  for (let i = 0; i < 20; i++) {
    const side = (Math.random() * 4) | 0;
    if (side === 0) { x = rand(0, WORLD.w); y = clamp(camera.y - 60, 20, WORLD.h - 20); }
    if (side === 1) { x = rand(0, WORLD.w); y = clamp(camera.y + H + 60, 20, WORLD.h - 20); }
    if (side === 2) { x = clamp(camera.x - 60, 20, WORLD.w - 20); y = rand(0, WORLD.h); }
    if (side === 3) { x = clamp(camera.x + W + 60, 20, WORLD.w - 20); y = rand(0, WORLD.h); }
    if (dist(x, y, player.x, player.y) > 420) break;
  }
  const hpScale = 1 + wave * 0.13;
  const dmgScale = 1 + wave * 0.08;
  enemies.push({
    type: typeKey,
    x, y,
    r: t.r,
    hp: Math.round(t.hp * hpScale),
    maxHp: Math.round(t.hp * hpScale),
    speed: t.speed * rand(0.9, 1.1),
    damage: Math.round(t.damage * dmgScale),
    xp: Math.round(t.xp * (1 + (wave - 1) * 0.15)),
    attackCd: rand(0, t.cooldown),
    flash: 0,
    stun: 0,
    wobble: rand(0, Math.PI * 2),
  });
}

// ---------- waves / spawner ----------
let wave = 1;
let waveTimer = 0;
let spawnTimer = 1.5;
let spawnCarry = 0; // fractional bonus spawn carried to the next tick
let kills = 0;
const WAVE_LENGTH = 25;
const SPAWN_COUNT_MULT = 1.1; // 10% more enemies per wave

function livingEnemyCount() {
  let n = 0;
  for (const e of enemies) if (e.hp > 0) n++;
  return n;
}

function updateSpawner(dt) {
  if (waveTimer < WAVE_LENGTH) {
    // phase 1: spawn enemies for the length of the wave
    waveTimer += dt;
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      const interval = Math.max(0.45, 2.2 - wave * 0.14);
      spawnTimer = interval;
      const baseCount = 1 + ((wave / 3) | 0);
      spawnCarry += baseCount * (SPAWN_COUNT_MULT - 1);
      const bonus = Math.floor(spawnCarry);
      spawnCarry -= bonus;
      const count = baseCount + bonus;
      for (let i = 0; i < count; i++) {
        const roll = Math.random();
        let key = "zombie";
        if (wave >= 2 && roll > 0.65) key = "skeleton";
        if (wave >= 3 && roll > 0.87) key = "imp";
        spawnEnemy(key, wave);
      }
    }
  } else if (livingEnemyCount() === 0) {
    // phase 2: the wave is fully cleared — only now does the next one begin
    waveTimer = 0;
    spawnTimer = 1.5; // short breather before the next wave starts spawning
    wave++;
    addText(W / 2, H / 2 - 60, `WAVE ${wave}`, "#e0b34a", 26, true);
    // surviving a wave restores the hero to full health
    if (healPlayer(1) > 0) {
      addText(W / 2, H / 2 - 26, "Wave survived — fully healed", "#6ee06e", 18, true);
    }
  }
}

// ---------- fx helpers ----------
function addParticles(x, y, color, n, speed = 140, life = 0.5) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(speed * 0.3, speed);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(life * 0.5, life), maxLife: life, color, r: rand(1.5, 3.5) });
  }
}

function addText(x, y, str, color, size = 14, screenSpace = false) {
  damageTexts.push({ x, y, str, color, size, life: 1, screenSpace });
}

// ---------- experience ----------
function gainXp(amount) {
  if (!amount) return;
  player.xp += amount;
  addText(player.x, player.y - 46, `+${amount} XP`, "#b48cff", 12);
  while (player.xp >= player.xpToNext) {
    player.xp -= player.xpToNext;
    levelUp();
  }
}

function levelUp() {
  player.level++;
  player.maxHp += 10;
  healPlayer(1); // leveling up fully restores health
  player.xpToNext = xpNeeded(player.level);
  addText(W / 2, H / 2 - 92, "LEVEL UP!", "#e0b34a", 26, true);
  addText(player.x, player.y - 42, `Lv ${player.level}`, "#ffd76e", 18);
  addParticles(player.x, player.y, "#e0b34a", 24, 200, 0.8);
}

// ---------- combat ----------
const STUN_DURATION = 0.15; // seconds of hit-stun applied on every strike

function damageEnemy(e, dmg, crit) {
  e.hp -= dmg;
  e.flash = 0.12;
  e.stun = STUN_DURATION;
  addText(e.x, e.y - e.r - 6, `${dmg}`, crit ? "#ffab3d" : "#fff", crit ? 20 : 14);
  addParticles(e.x, e.y, "#8d1f1f", crit ? 10 : 5);
  if (e.hp <= 0) {
    kills++;
    registerComboKill();
    gainXp(e.xp);
    addParticles(e.x, e.y, "#8d1f1f", 16, 200, 0.7);
    corpses.push({ x: e.x, y: e.y, r: e.r, color: "#3a0d0d" });
    if (corpses.length > 120) corpses.shift();
  }
}

function meleeAttack() {
  player.meleeCd = MELEE.cooldown;
  player.meleeAnim = 0.16;
  camera.shake = Math.max(camera.shake, 3);
  const mult = comboMultiplier();
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    const d = dist(player.x, player.y, e.x, e.y);
    if (d > MELEE.range + e.r) continue;
    const ang = Math.atan2(e.y - player.y, e.x - player.x);
    let diff = Math.abs(ang - player.facing);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff <= MELEE.arc / 2) {
      const crit = Math.random() < 0.15;
      const base = MELEE.damage + (player.level - 1) * 2;
      damageEnemy(e, Math.round(base * mult * rand(0.85, 1.15) * (crit ? 2 : 1)), crit);
    }
  }
}

function tryMelee() {
  if (state !== STATE.PLAYING || player.dead || player.meleeCd > 0) return;
  const m = toWorld(mouse.x, mouse.y);
  player.facing = Math.atan2(m.y - player.y, m.x - player.x);
  meleeAttack();
}

function tryCastFireball() {
  if (state !== STATE.PLAYING || player.dead || player.fireCd > 0) return;
  player.fireCd = FIREBALL.cooldown;
  const m = toWorld(mouse.x, mouse.y);
  const ang = Math.atan2(m.y - player.y, m.x - player.x);
  projectiles.push({
    team: "player",
    kind: "fireball",
    x: player.x + Math.cos(ang) * 20,
    y: player.y + Math.sin(ang) * 20,
    vx: Math.cos(ang) * FIREBALL.speed,
    vy: Math.sin(ang) * FIREBALL.speed,
    r: FIREBALL.radius,
    damage: FIREBALL.damage + (player.level - 1) * 2,
    life: 1.6,
  });
}

function explodeFireball(p) {
  addParticles(p.x, p.y, "#ff9a2e", 22, 260, 0.6);
  addParticles(p.x, p.y, "#ffe08a", 10, 160, 0.4);
  camera.shake = Math.max(camera.shake, 6);
  const mult = comboMultiplier();
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d <= FIREBALL.aoe + e.r) {
      const falloff = clamp(1 - d / (FIREBALL.aoe + e.r) + 0.4, 0.4, 1);
      const crit = Math.random() < 0.15;
      damageEnemy(e, Math.round(p.damage * mult * falloff * rand(0.9, 1.1) * (crit ? 2 : 1)), crit);
    }
  }
}

function hurtPlayer(dmg) {
  if (player.dead) return;
  player.hp -= dmg;
  player.lastHurt = elapsed;
  camera.shake = Math.max(camera.shake, 5);
  addText(player.x, player.y - 26, `-${dmg}`, "#ff5555", 16);
  addParticles(player.x, player.y, "#c22b2b", 8);
  if (player.hp <= 0) {
    player.hp = 0;
    player.dead = true;
    state = STATE.SUMMARY; // immediately show the run summary and wait for input
    deathElapsed = elapsed;
    camera.shake = 0; // freeze the background without a lingering jitter
    recordRun();
    resetCombo();
    mouse.left = false;
    keys.clear();
  }
}

// Restore a fraction of max HP (1 = full). Returns the amount actually healed.
function healPlayer(fraction) {
  if (player.dead) return 0;
  const before = player.hp;
  player.hp = Math.min(player.maxHp, player.hp + player.maxHp * fraction);
  const healed = Math.round(player.hp - before);
  if (healed > 0) {
    addText(player.x, player.y - 34, `+${healed}`, "#6ee06e", 18);
    addParticles(player.x, player.y, "#6ee06e", 14, 150, 0.6);
  }
  return healed;
}

// Death is final: the entire run restarts from scratch.
function restartGame() {
  enemies = [];
  projectiles = [];
  particles = [];
  damageTexts = [];
  corpses = [];
  kills = 0;
  wave = 1;
  waveTimer = 0;
  spawnTimer = 1.5;
  spawnCarry = 0;
  elapsed = 0;
  runSummary = null;
  deathElapsed = 0;
  resetCombo();
  mouse.left = false;
  mouse.right = false;

  player.x = WORLD.w / 2;
  player.y = WORLD.h / 2;
  player.hp = 100;
  player.maxHp = 100;
  player.level = 1;
  player.xp = 0;
  player.xpToNext = xpNeeded(1);
  player.facing = 0;
  player.dead = false;
  player.lastHurt = -99;
  player.meleeCd = 0;
  player.meleeAnim = 0;
  player.fireCd = 0;

  camera.shake = 0;
  snapCamera();

  addText(W / 2, H / 2 - 60, "NEW RUN", "#e0b34a", 26, true);
}

function startRun() {
  restartGame();
  state = STATE.PLAYING;
}

// Record the finished run and update the all-time bests. The summary waits for input.
function recordRun() {
  const newBestWave = wave > best.wave;
  const newBestKills = kills > best.kills;
  best = {
    wave: Math.max(best.wave, wave),
    kills: Math.max(best.kills, kills),
    level: Math.max(best.level, player.level),
    timeSec: Math.max(best.timeSec, Math.round(deathElapsed)),
  };
  saveBest(best);

  runSummary = {
    wave,
    kills,
    level: player.level,
    timeSec: deathElapsed,
    newBestWave,
    newBestKills,
  };
}

function formatTime(sec) {
  const total = Math.max(0, Math.floor(sec));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// ---------- update ----------
let elapsed = 0;

function updatePlayer(dt) {
  player.meleeCd = Math.max(0, player.meleeCd - dt);
  player.fireCd = Math.max(0, player.fireCd - dt);
  player.meleeAnim = Math.max(0, player.meleeAnim - dt);

  if (player.dead) return;

  // slowly regenerate after 5s without damage
  if (elapsed - player.lastHurt > 5 && player.hp < player.maxHp) {
    player.hp = Math.min(player.maxHp, player.hp + 3 * dt);
  }

  const m = toWorld(mouse.x, mouse.y);

  // the player always faces the cursor, no matter how they move
  player.facing = Math.atan2(m.y - player.y, m.x - player.x);

  // WASD movement takes priority over click-to-move
  let mx = 0, my = 0;
  if (keys.has("w")) my -= 1;
  if (keys.has("s")) my += 1;
  if (keys.has("a")) mx -= 1;
  if (keys.has("d")) mx += 1;
  if (mx !== 0 || my !== 0) {
    const len = Math.hypot(mx, my);
    player.x += (mx / len) * player.speed * dt;
    player.y += (my / len) * player.speed * dt;
  } else if (mouse.left) {
    // left click: walk toward the point (facing already tracks the cursor)
    if (dist(player.x, player.y, m.x, m.y) > 6) {
      player.x += Math.cos(player.facing) * player.speed * dt;
      player.y += Math.sin(player.facing) * player.speed * dt;
    }
  }

  player.x = clamp(player.x, player.r, WORLD.w - player.r);
  player.y = clamp(player.y, player.r, WORLD.h - player.r);
}

function updateEnemies(dt) {
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    const t = ENEMY_TYPES[e.type];
    e.flash = Math.max(0, e.flash - dt);

    // hit-stun: freeze movement, attacks, cooldown recovery and bobbing
    if (e.stun > 0) {
      e.stun -= dt;
      continue;
    }
    e.wobble += dt * 6;
    e.attackCd -= dt;

    const d = dist(e.x, e.y, player.x, player.y);
    const ang = Math.atan2(player.y - e.y, player.x - e.x);

    if (player.dead) continue;

    if (t.ranged) {
      // keep distance and shoot arrows
      const desired = 260;
      if (d > desired + 40) { e.x += Math.cos(ang) * e.speed * dt; e.y += Math.sin(ang) * e.speed * dt; }
      else if (d < desired - 40) { e.x -= Math.cos(ang) * e.speed * dt; e.y -= Math.sin(ang) * e.speed * dt; }
      if (e.attackCd <= 0 && d < t.range) {
        e.attackCd = t.cooldown;
        projectiles.push({
          team: "enemy", kind: "arrow",
          x: e.x, y: e.y,
          vx: Math.cos(ang) * 330, vy: Math.sin(ang) * 330,
          r: 5, damage: e.damage, life: 2.5,
        });
      }
    } else {
      // walk up and melee
      if (d > t.range) { e.x += Math.cos(ang) * e.speed * dt; e.y += Math.sin(ang) * e.speed * dt; }
      else if (e.attackCd <= 0) {
        e.attackCd = t.cooldown;
        hurtPlayer(e.damage);
        // small lunge
        e.x += Math.cos(ang) * 10;
        e.y += Math.sin(ang) * 10;
      }
    }

    // mild separation so enemies don't fully stack
    for (const o of enemies) {
      if (o === e || o.hp <= 0) continue;
      const dd = dist(e.x, e.y, o.x, o.y);
      const min = e.r + o.r - 6;
      if (dd > 0 && dd < min) {
        const push = ((min - dd) / dd) * 0.5;
        e.x += (e.x - o.x) * push * dt * 10;
        e.y += (e.y - o.y) * push * dt * 10;
      }
    }

    e.x = clamp(e.x, e.r, WORLD.w - e.r);
    e.y = clamp(e.y, e.r, WORLD.h - e.r);
  }
  enemies = enemies.filter((e) => e.hp > 0);
}

function updateProjectiles(dt) {
  for (const p of projectiles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;

    if (p.kind === "fireball") {
      addParticles(p.x, p.y, Math.random() < 0.5 ? "#ff9a2e" : "#ffd76e", 1, 40, 0.25);
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        if (dist(p.x, p.y, e.x, e.y) < p.r + e.r) { explodeFireball(p); p.life = 0; break; }
      }
    } else {
      if (!player.dead && dist(p.x, p.y, player.x, player.y) < p.r + player.r) {
        hurtPlayer(p.damage);
        p.life = 0;
      }
    }
    if (p.x < 0 || p.y < 0 || p.x > WORLD.w || p.y > WORLD.h) p.life = 0;
  }
  projectiles = projectiles.filter((p) => p.life > 0);
}

function updateFx(dt) {
  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.pow(0.05, dt);
    p.vy *= Math.pow(0.05, dt);
    p.life -= dt;
  }
  particles = particles.filter((p) => p.life > 0);

  for (const t of damageTexts) {
    t.life -= dt;
    if (!t.screenSpace) t.y -= 34 * dt;
  }
  damageTexts = damageTexts.filter((t) => t.life > 0);
}

// ---------- scenery (static, generated once) ----------
const decor = [];
{
  let seed = 12345;
  const srand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 90; i++) {
    decor.push({
      x: srand() * WORLD.w,
      y: srand() * WORLD.h,
      r: 4 + srand() * 14,
      type: srand() < 0.6 ? "rock" : "bones",
      rot: srand() * Math.PI * 2,
    });
  }
}

// ---------- rendering ----------
function drawFloor() {
  // base
  ctx.fillStyle = "#141419";
  ctx.fillRect(0, 0, W, H);

  // tile grid
  const tile = 64;
  const startX = Math.floor(camera.x / tile) * tile;
  const startY = Math.floor(camera.y / tile) * tile;
  ctx.strokeStyle = "rgba(255,255,255,0.025)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = startX; x <= camera.x + W + tile; x += tile) {
    ctx.moveTo(x - camera.x, 0);
    ctx.lineTo(x - camera.x, H);
  }
  for (let y = startY; y <= camera.y + H + tile; y += tile) {
    ctx.moveTo(0, y - camera.y);
    ctx.lineTo(W, y - camera.y);
  }
  ctx.stroke();

  // world border glow
  ctx.strokeStyle = "rgba(160,40,40,0.35)";
  ctx.lineWidth = 3;
  ctx.strokeRect(-camera.x, -camera.y, WORLD.w, WORLD.h);

  // decor
  for (const d of decor) {
    const sx = d.x - camera.x, sy = d.y - camera.y;
    if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) continue;
    if (d.type === "rock") {
      ctx.fillStyle = "#232329";
      ctx.beginPath();
      ctx.ellipse(sx, sy, d.r, d.r * 0.7, d.rot, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = "#3d3a33";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - Math.cos(d.rot) * d.r, sy - Math.sin(d.rot) * d.r);
      ctx.lineTo(sx + Math.cos(d.rot) * d.r, sy + Math.sin(d.rot) * d.r);
      ctx.stroke();
    }
  }

  // corpses
  for (const c of corpses) {
    const sx = c.x - camera.x, sy = c.y - camera.y;
    if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) continue;
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.ellipse(sx, sy, c.r * 1.3, c.r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawShadow(x, y, r) {
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.ellipse(x - camera.x, y - camera.y + r * 0.75, r * 1.1, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawEnemy(e) {
  const sx = e.x - camera.x, sy = e.y - camera.y;
  if (sx < -60 || sy < -60 || sx > W + 60 || sy > H + 60) return;
  const t = ENEMY_TYPES[e.type];

  drawShadow(e.x, e.y, e.r);

  // body (wobbles slightly while walking)
  const wob = Math.sin(e.wobble) * 2;
  ctx.fillStyle = e.flash > 0 ? "#ffffff" : t.color;
  ctx.beginPath();
  ctx.arc(sx, sy + wob * 0.3, e.r, 0, Math.PI * 2);
  ctx.fill();

  // eyes
  const ang = Math.atan2(player.y - e.y, player.x - e.x);
  const ex = Math.cos(ang) * e.r * 0.4, ey = Math.sin(ang) * e.r * 0.4;
  ctx.fillStyle = e.flash > 0 ? "#fff" : t.eye;
  ctx.beginPath();
  ctx.arc(sx + ex - 4, sy + ey + wob * 0.3, 2.2, 0, Math.PI * 2);
  ctx.arc(sx + ex + 4, sy + ey + wob * 0.3, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // hp bar
  if (e.hp < e.maxHp) {
    const bw = e.r * 2.2;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(sx - bw / 2, sy - e.r - 12, bw, 5);
    ctx.fillStyle = "#c33a3a";
    ctx.fillRect(sx - bw / 2, sy - e.r - 12, bw * (e.hp / e.maxHp), 5);
  }
}

function drawPlayer() {
  if (player.dead) return;
  const sx = player.x - camera.x, sy = player.y - camera.y;

  drawShadow(player.x, player.y, player.r);

  // body
  ctx.fillStyle = "#3d6ea8";
  ctx.beginPath();
  ctx.arc(sx, sy, player.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#8fc0ee";
  ctx.lineWidth = 2;
  ctx.stroke();

  // facing indicator
  ctx.fillStyle = "#cfe6fa";
  ctx.beginPath();
  ctx.arc(sx + Math.cos(player.facing) * (player.r - 3), sy + Math.sin(player.facing) * (player.r - 3), 4, 0, Math.PI * 2);
  ctx.fill();

  // melee swing arc
  if (player.meleeAnim > 0) {
    const p = 1 - player.meleeAnim / 0.16;
    ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - p)})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(sx, sy, MELEE.range * 0.75, player.facing - MELEE.arc / 2 + p * 0.5, player.facing + MELEE.arc / 2 - 0.2 + p * 0.5);
    ctx.stroke();
  }
}

function drawProjectiles() {
  for (const p of projectiles) {
    const sx = p.x - camera.x, sy = p.y - camera.y;
    if (p.kind === "fireball") {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 18);
      g.addColorStop(0, "#ffe9a8");
      g.addColorStop(0.4, "#ff9a2e");
      g.addColorStop(1, "rgba(255,80,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, 18, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const ang = Math.atan2(p.vy, p.vx);
      ctx.strokeStyle = "#d8d2be";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx - Math.cos(ang) * 10, sy - Math.sin(ang) * 10);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }
  }
}

function drawFx() {
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x - camera.x, p.y - camera.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = "center";
  for (const t of damageTexts) {
    ctx.globalAlpha = clamp(t.life, 0, 1);
    ctx.fillStyle = t.color;
    ctx.font = `bold ${t.size}px "Segoe UI", sans-serif`;
    const tx = t.screenSpace ? t.x : t.x - camera.x;
    const ty = t.screenSpace ? t.y : t.y - camera.y;
    ctx.fillText(t.str, tx, ty);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
}

// Right-side kill-chain meter: count, damage tier and the 5 s window.
function drawComboHud() {
  if (player.dead || combo.count <= 0) return;

  const w = 176, h = 112;
  const x = W - w - 20;
  const y = H / 2 - h / 2;
  const bump = 1 + (combo.pulse / 0.3) * 0.05; // small pop on every kill

  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(bump, bump);
  ctx.translate(-(x + w / 2), -(y + h / 2));

  ctx.fillStyle = "rgba(6,6,10,0.72)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = combo.level > 0 ? "#e0b34a" : "#6a6a72";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  ctx.textAlign = "center";
  ctx.fillStyle = "#e0b34a";
  ctx.font = "bold 12px 'Segoe UI', sans-serif";
  ctx.fillText("COMBO", x + w / 2, y + 20);

  ctx.fillStyle = "#f2f2f5";
  ctx.font = "bold 36px 'Segoe UI', sans-serif";
  ctx.fillText(`${combo.count}`, x + w / 2, y + 56);

  const bonus = Math.round(combo.level * COMBO.damagePerLevel * 100);
  ctx.fillStyle = combo.level > 0 ? "#ffd76e" : "#8a8a92";
  ctx.font = "bold 12px 'Segoe UI', sans-serif";
  const tier = combo.level <= 0
    ? `${COMBO.killsPerLevel - combo.count} kills to LV 1`
    : combo.level >= COMBO.maxLevel
      ? `MAX  ·  +${bonus}% DMG`
      : `LV ${combo.level}  ·  +${bonus}% DMG`;
  ctx.fillText(tier, x + w / 2, y + 76);

  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(x + 16, y + 88, w - 32, 5);
  ctx.fillStyle = combo.level > 0 ? "#e0b34a" : "#8a8a92";
  ctx.fillRect(x + 16, y + 88, (w - 32) * clamp(combo.timer / COMBO.window, 0, 1), 5);

  ctx.fillStyle = "#5c5c64";
  ctx.font = "10px 'Segoe UI', sans-serif";
  ctx.fillText(`${Math.max(0, combo.timer).toFixed(1)}s`, x + w / 2, y + 105);
  ctx.textAlign = "left";
  ctx.restore();
}

function drawHud() {
  // HP bar
  const bx = 20, by = 20, bw = 260, bh = 22;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
  ctx.fillStyle = "#3a1111";
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = player.dead ? "#551010" : "#b8302f";
  ctx.fillRect(bx, by, bw * (player.hp / player.maxHp), bh);
  ctx.strokeStyle = "#6a6a72";
  ctx.lineWidth = 1;
  ctx.strokeRect(bx - 2, by - 2, bw + 4, bh + 4);
  ctx.fillStyle = "#eee";
  ctx.font = "bold 13px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${Math.ceil(player.hp)} / ${player.maxHp}`, bx + bw / 2, by + 16);

  // XP bar
  const xby = by + bh + 8;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(bx - 2, xby - 2, bw + 4, 10);
  ctx.fillStyle = "#241a33";
  ctx.fillRect(bx, xby, bw, 6);
  ctx.fillStyle = "#b48cff";
  ctx.fillRect(bx, xby, bw * clamp(player.xp / player.xpToNext, 0, 1), 6);
  ctx.font = "11px 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#e0b34a";
  ctx.fillText(`Lv ${player.level}`, bx, xby + 20);
  ctx.textAlign = "right";
  ctx.fillStyle = "#8a8a92";
  ctx.fillText(`${player.xp} / ${player.xpToNext} XP`, bx + bw, xby + 20);

  // kills / wave
  ctx.textAlign = "right";
  ctx.fillStyle = "#c9c9c9";
  ctx.font = "bold 16px 'Segoe UI', sans-serif";
  ctx.fillText(`Wave ${wave}`, W - 20, 32);
  ctx.fillStyle = "#8a8a92";
  ctx.font = "13px 'Segoe UI', sans-serif";
  ctx.fillText(`Kills: ${kills}`, W - 20, 52);
  // wave progress: fills during the spawn phase, then shows what is left to clear
  const cleared = waveTimer >= WAVE_LENGTH;
  if (cleared) {
    ctx.fillStyle = "#6ee06e";
    ctx.fillText(`Clear the remaining: ${livingEnemyCount()}`, W - 20, 70);
  }
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(W - 140, 60, 120, 4);
  ctx.fillStyle = cleared ? "#6ee06e" : "#e0b34a";
  ctx.fillRect(W - 140, 60, 120 * Math.min(1, waveTimer / WAVE_LENGTH), 4);

  drawComboHud();

  // fireball cooldown
  const fx = 34, fy = H - 40;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.beginPath();
  ctx.arc(fx, fy, 20, 0, Math.PI * 2);
  ctx.fill();
  const ready = player.fireCd <= 0;
  if (!ready) {
    ctx.fillStyle = "rgba(255,154,46,0.25)";
    ctx.beginPath();
    ctx.arc(fx, fy, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - player.fireCd / FIREBALL.cooldown));
    ctx.lineTo(fx, fy);
    ctx.fill();
  } else {
    const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, 14);
    g.addColorStop(0, "#ffe9a8");
    g.addColorStop(1, "#ff7a1e");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(fx, fy, 12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "#6a6a72";
  ctx.beginPath();
  ctx.arc(fx, fy, 20, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#9a9aa2";
  ctx.font = "11px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("1 / RMB", fx, fy + 34);
}

// ---------- pause ----------
function setPaused(v) {
  if (v && state === STATE.PLAYING) {
    state = STATE.PAUSED;
    camera.shake = 0; // don't leave a frozen screen jittering
  } else if (!v && state === STATE.PAUSED) {
    state = STATE.PLAYING;
  }
}

function drawPauseOverlay() {
  ctx.fillStyle = "rgba(6,6,10,0.72)";
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.fillStyle = "#e6e6ea";
  ctx.font = "bold 54px 'Segoe UI', sans-serif";
  ctx.fillText("PAUSED", W / 2, H / 2 - 70);

  ctx.fillStyle = "#8a8a92";
  ctx.font = "15px 'Segoe UI', sans-serif";
  ctx.fillText("Press ESC to resume", W / 2, H / 2 - 34);

  const lines = [
    "WASD / Left click — move",
    "Space — melee swing (aims at cursor)",
    "Right click or 1 — fireball",
    "ESC — pause / resume",
  ];
  ctx.font = "14px 'Segoe UI', sans-serif";
  lines.forEach((line, i) => {
    ctx.fillStyle = i === lines.length - 1 ? "#77777f" : "#b0b0b8";
    ctx.fillText(line, W / 2, H / 2 + 16 + i * 24);
  });

  ctx.fillStyle = "#5c5c64";
  ctx.font = "13px 'Segoe UI', sans-serif";
  ctx.fillText(`Wave ${wave}  ·  Kills ${kills}  ·  Lv ${player.level}  ·  HP ${Math.ceil(player.hp)}/${player.maxHp}  ·  ${formatTime(elapsed)}`, W / 2, H / 2 + 132);
  ctx.textAlign = "left";
}

// ---------- title overlay ----------
function drawTitleOverlay() {
  ctx.fillStyle = "rgba(6,6,10,0.8)";
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.fillStyle = "#e6e6ea";
  ctx.font = "bold 64px 'Segoe UI', sans-serif";
  ctx.fillText("DIE BLOW", W / 2, H / 2 - 92);

  ctx.fillStyle = "#8a8a92";
  ctx.font = "16px 'Segoe UI', sans-serif";
  ctx.fillText("A tiny top-down ARPG — survive the waves", W / 2, H / 2 - 54);

  const lines = [
    "WASD / Left click — move",
    "Space — melee swing (aims at cursor)",
    "Right click or 1 — fireball",
    "ESC — pause",
  ];
  ctx.font = "14px 'Segoe UI', sans-serif";
  lines.forEach((line, i) => {
    ctx.fillStyle = "#b0b0b8";
    ctx.fillText(line, W / 2, H / 2 - 6 + i * 22);
  });

  ctx.fillStyle = "#8a8a92";
  ctx.font = "13px 'Segoe UI', sans-serif";
  ctx.fillText("Chain kills within 5 s to build combo power", W / 2, H / 2 + 80);

  if (best.wave > 0) {
    ctx.fillStyle = "#8a8a92";
    ctx.font = "13px 'Segoe UI', sans-serif";
    ctx.fillText(`Best: wave ${best.wave}  ·  kills ${best.kills}`, W / 2, H / 2 + 104);
  }

  ctx.fillStyle = "#e0b34a";
  ctx.font = "bold 16px 'Segoe UI', sans-serif";
  ctx.fillText("Click or press any key to begin", W / 2, H / 2 + 142);
  ctx.textAlign = "left";
}

// ---------- summary overlay ----------
function drawSummaryOverlay() {
  ctx.fillStyle = "rgba(6,6,10,0.82)";
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.fillStyle = "#d43a3a";
  ctx.font = "bold 54px 'Segoe UI', sans-serif";
  ctx.fillText("YOU DIED", W / 2, H / 2 - 150);

  ctx.fillStyle = "#e6e6ea";
  ctx.font = "bold 20px 'Segoe UI', sans-serif";
  ctx.fillText("RUN SUMMARY", W / 2, H / 2 - 100);

  const rows = [
    { text: `Reached wave ${runSummary.wave}`, best: runSummary.newBestWave },
    { text: `Kills ${runSummary.kills}`, best: runSummary.newBestKills },
    { text: `Level ${runSummary.level}  ·  Survived ${formatTime(runSummary.timeSec)}`, best: false },
  ];
  ctx.font = "16px 'Segoe UI', sans-serif";
  rows.forEach((row, i) => {
    ctx.fillStyle = row.best ? "#e0b34a" : "#c9c9c9";
    ctx.fillText(row.best ? `${row.text}  ·  NEW BEST` : row.text, W / 2, H / 2 - 56 + i * 30);
  });

  ctx.fillStyle = "#8a8a92";
  ctx.font = "13px 'Segoe UI', sans-serif";
  ctx.fillText(`All-time best: wave ${best.wave}  ·  kills ${best.kills}`, W / 2, H / 2 + 56);

  ctx.fillStyle = "#e6e6ea";
  ctx.font = "bold 16px 'Segoe UI', sans-serif";
  ctx.fillText("Press R or click to start a new run", W / 2, H / 2 + 112);
  ctx.textAlign = "left";
}

// ---------- main loop ----------
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state === STATE.PLAYING) {
    elapsed += dt;

    updateCombo(dt);
    updateSpawner(dt);
    updatePlayer(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updateFx(dt);
    updateCamera(dt);
  }

  // render
  ctx.save();
  if (camera.shake > 0) {
    ctx.translate(rand(-camera.shake, camera.shake), rand(-camera.shake, camera.shake));
  }
  drawFloor();
  // depth-sort bodies
  const bodies = [...enemies.map((e) => ({ y: e.y, draw: () => drawEnemy(e) }))];
  if (!player.dead) bodies.push({ y: player.y, draw: drawPlayer });
  bodies.sort((a, b) => a.y - b.y);
  for (const b of bodies) b.draw();
  drawProjectiles();
  drawFx();
  ctx.restore();

  if (state !== STATE.TITLE) drawHud();
  if (state === STATE.TITLE) drawTitleOverlay();
  else if (state === STATE.PAUSED) drawPauseOverlay();
  else if (state === STATE.SUMMARY) drawSummaryOverlay();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
