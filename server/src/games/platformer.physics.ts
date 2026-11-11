/** Shared fixed-step platform physics. Rendering predicts locally; only the server awards progress. */
export const STEP = 1 / 60;
export const TILE = 32;
export const CHARACTERS = [
  "Pip · Fox",
  "Mochi · Bunny",
  "Bramble · Bear",
  "Kiwi · Frog",
  "Nova · Cat",
  "Bolt · Robot",
] as const;
export type Effect =
  | "jump"
  | "land"
  | "spring"
  | "bonk"
  | "fall"
  | "finish"
  | "coin"
  | "power"
  | "stomp";
export type Input = {
  dir: number;
  jump: boolean;
  run: boolean;
  at: number;
  seq: number;
};
export type Hero = {
  id: string;
  name: string;
  character: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  coyote: number;
  buffer: number;
  jumpHeld: boolean;
  input: Input;
  checkpoint: number;
  hearts: number;
  immune: number;
  power: number;
  coins: number;
  score: number;
  finished: boolean;
  effect: Effect;
  effectAt: number;
  event: number;
  platform: string | null;
};
export type Rect = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "ground" | "brick" | "box" | "power" | "pipe" | "platform";
  move?: number;
};
export type Coin = { id: string; x: number; y: number };
export type Enemy = {
  id: string;
  x: number;
  y: number;
  range: number;
  speed: number;
  kind: "beetle" | "slime";
};
export type Level = {
  name: string;
  subtitle: string;
  theme: "meadow" | "cavern" | "sky";
  width: number;
  solids: Rect[];
  coins: Coin[];
  enemies: Enemy[];
  checkpoints: number[];
  flag: number;
};
export type World = {
  level: number;
  time: number;
  collected: string[];
  used: string[];
  broken: string[];
  defeated: string[];
  teamCoins: number;
};
export function makeHero(id: string, name: string, character = 0): Hero {
  return {
    id,
    name,
    character,
    x: 70,
    y: 384,
    vx: 0,
    vy: 0,
    grounded: true,
    coyote: 0,
    buffer: 0,
    jumpHeld: false,
    input: { dir: 0, jump: false, run: false, at: 0, seq: 0 },
    checkpoint: 70,
    hearts: 3,
    immune: 0,
    power: 0,
    coins: 0,
    score: 0,
    finished: false,
    effect: "land",
    effectAt: 0,
    event: 0,
    platform: null,
  };
}
export function event(p: Hero, kind: Effect, time: number) {
  p.effect = kind;
  p.effectAt = time;
  p.event++;
}
function buildLevel(index: number): Level {
  const theme = (["meadow", "cavern", "sky"] as const)[index]!;
  const solids: Rect[] = [],
    coins: Coin[] = [],
    enemies: Enemy[] = [];
  const add = (
    x: number,
    y: number,
    w: number,
    h: number,
    kind: Rect["kind"],
    move?: number,
  ) => solids.push({ id: `s${solids.length}`, x, y, w, h, kind, move });
  const gaps =
    index === 0
      ? [
          [960, 1056],
          [1856, 1952],
          [2720, 2848],
        ]
      : index === 1
        ? [
            [800, 896],
            [1504, 1632],
            [2400, 2528],
          ]
        : [
            [736, 864],
            [1344, 1504],
            [2208, 2400],
            [2816, 2944],
          ];
  let start = 0;
  for (const [a, b] of gaps) {
    add(start, 384, a! - start, 160, "ground");
    start = b!;
  }
  add(start, 384, 3456 - start, 160, "ground");
  // Learn one idea at a time: first box, low step, pipe, gap, then combinations.
  for (const x of [
    288, 320, 352, 608, 640, 1184, 1216, 1728, 2080, 2112, 2144, 2592, 3008,
  ])
    add(x, 272, 32, 32, x % 3 === 0 ? "brick" : "box");
  add(384, 272, 32, 32, "power");
  add(1760, 272, 32, 32, "power");
  for (const x of [512, 1120, 2016, 2656]) add(x, 320, 64, 64, "pipe");
  for (const x of [672, 1280, 2240, 3040]) {
    if (gaps.some(([a, b]) => x >= a! && x < b!)) continue;
    add(x, 320, 64, 16, "platform");
    add(x + 80, 256, 96, 16, "platform");
    for (let k = 0; k < 3; k++)
      coins.push({ id: `c${coins.length}`, x: x + 96 + k * 28, y: 228 });
  }
  for (const [a, b] of gaps) {
    if (index > 0)
      add((a! + b!) / 2 - 28, 336, 56, 14, "platform", index === 2 ? 50 : 28);
  }
  if (index === 1) {
    add(1376, 240, 128, 32, "brick");
    add(2816, 224, 96, 16, "platform", 64);
  }
  if (index === 2) {
    add(1568, 288, 96, 16, "platform", 70);
    add(2496, 240, 96, 16, "platform", 65);
  }
  for (let x = 190; x < 3200; x += 76) {
    if (
      gaps.some(([a, b]) => x > a! - 20 && x < b! + 20) ||
      solids.some(
        (s) => s.kind === "pipe" && x > s.x - 15 && x < s.x + s.w + 15,
      )
    )
      continue;
    coins.push({ id: `c${coins.length}`, x, y: 350 });
  }
  for (const [a, b] of gaps)
    for (let k = 0; k < 5; k++)
      coins.push({
        id: `c${coins.length}`,
        x: a! - 32 + (k * (b! - a! + 64)) / 4,
        y: 320 - Math.sin((k / 4) * Math.PI) * 65,
      });
  // Keep the entire patrol on ground and out of pipe collision bounds.
  [720, 1328, 1700, 2300, 3040].forEach((wanted, i) => {
    const candidates = Array.from(
      { length: 25 },
      (_, j) => wanted + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * 16,
    );
    const x = candidates.find(
      (x) =>
        solids.some(
          (s) => s.kind === "ground" && x - 76 >= s.x && x + 76 <= s.x + s.w,
        ) &&
        !solids.some(
          (s) => s.kind === "pipe" && x + 76 > s.x && x - 76 < s.x + s.w,
        ),
    );
    if (x !== undefined)
      enemies.push({
        id: `e${i}`,
        x,
        y: 384,
        range: 60,
        speed: 35 + index * 9,
        kind: i % 2 ? "slime" : "beetle",
      });
  });
  return {
    name: ["SUNNY TRAIL", "CRYSTAL CAVERNS", "CLOUDTOP CASTLE"][index]!,
    subtitle: [
      "A pocket full of sunshine",
      "Follow the glow",
      "One last leap together",
    ][index]!,
    theme,
    width: 3456,
    solids,
    coins,
    enemies,
    checkpoints: gaps.map(([, b]) => b! + 32),
    flag: 3296,
  };
}
export const LEVELS = [buildLevel(0), buildLevel(1), buildLevel(2)];
export function solidAt(s: Rect, time: number): Rect {
  return s.move
    ? { ...s, x: s.x + Math.sin(time / 1100 + Number(s.id.slice(1))) * s.move }
    : s;
}
export function enemyAt(e: Enemy, time: number) {
  return {
    x: e.x + Math.sin(((time / 1000) * e.speed) / e.range) * e.range,
    y: e.y,
  };
}
const overlap = (a: number, b: number, c: number, d: number) => a < d && b > c;
function respawn(p: Hero, time: number) {
  p.x = p.checkpoint;
  p.y = 310;
  p.vx = 0;
  p.vy = 0;
  p.hearts = p.hearts <= 0 ? 3 : p.hearts;
  p.immune = time + 1800;
  p.platform = null;
  event(p, "fall", time);
}
function damage(p: Hero, time: number, fromX: number) {
  if (p.immune > time || p.power > time) return;
  p.hearts--;
  p.immune = time + 1800;
  p.vx = p.x < fromX ? -190 : 190;
  p.vy = -230;
  event(p, "bonk", time);
  if (p.hearts <= 0) respawn(p, time);
}
export function stepHero(
  p: Hero,
  world: World,
  time: number,
  dt = STEP,
  predict = false,
) {
  if (p.finished) return;
  const level = LEVELS[world.level]!,
    active = time - p.input.at < 800,
    dir = active ? p.input.dir : 0,
    jump = active && p.input.jump;
  if (jump && !p.jumpHeld) p.buffer = 0.13;
  p.jumpHeld = jump;
  p.buffer = Math.max(0, p.buffer - dt);
  p.coyote = p.grounded ? 0.1 : Math.max(0, p.coyote - dt);
  const speed = p.input.run ? 250 : 185,
    target = dir * speed,
    accel = dir ? 1800 : 2200;
  p.vx += Math.max(-accel * dt, Math.min(accel * dt, target - p.vx));
  if (p.buffer > 0 && p.coyote > 0) {
    p.vy = -430;
    p.grounded = false;
    p.coyote = 0;
    p.buffer = 0;
    p.platform = null;
    event(p, "jump", time);
  }
  // Releasing jump gives a short hop; holding it clears larger gaps.
  if (!jump && p.vy < -180) p.vy += 1250 * dt;
  const solids = level.solids
    .filter((s) => !world.broken.includes(s.id))
    .map((s) => solidAt(s, time));
  if (p.platform) {
    const base = level.solids.find((s) => s.id === p.platform);
    if (base?.move)
      p.x += solidAt(base, time).x - solidAt(base, time - dt * 1000).x;
  }
  const oldX = p.x,
    oldY = p.y;
  p.x = Math.max(12, Math.min(level.width - 12, p.x + p.vx * dt));
  for (const s of solids) {
    if (s.kind === "platform") continue;
    if (
      overlap(p.x - 10, p.x + 10, s.x, s.x + s.w) &&
      overlap(p.y - 28, p.y - 0.1, s.y, s.y + s.h)
    ) {
      if (oldX + 10 <= s.x + 1) {
        p.x = s.x - 10;
        p.vx = 0;
      } else if (oldX - 10 >= s.x + s.w - 1) {
        p.x = s.x + s.w + 10;
        p.vx = 0;
      }
    }
  }
  p.vy = Math.min(620, p.vy + 1050 * dt);
  p.y += p.vy * dt;
  const wasGrounded = p.grounded;
  p.grounded = false;
  p.platform = null;
  for (const s of solids) {
    if (!overlap(p.x - 9, p.x + 9, s.x, s.x + s.w)) continue;
    if (p.vy >= 0 && oldY <= s.y + 1 && p.y >= s.y) {
      p.y = s.y;
      p.vy = 0;
      p.grounded = true;
      p.platform = s.id;
      if (!wasGrounded) event(p, "land", time);
    } else if (
      s.kind !== "platform" &&
      p.vy < 0 &&
      oldY - 28 >= s.y + s.h - 1 &&
      p.y - 28 < s.y + s.h
    ) {
      p.y = s.y + s.h + 28;
      p.vy = 80;
      event(p, "bonk", time);
      if (!predict && !world.used.includes(s.id)) {
        if (s.kind === "box" || s.kind === "power") {
          world.used.push(s.id);
          if (s.kind === "power") {
            p.power = time + 10000;
            p.hearts = 3;
            event(p, "power", time);
          } else {
            world.teamCoins++;
            p.coins++;
            p.score += 100;
            event(p, "coin", time);
          }
        } else if (s.kind === "brick" && p.power > time) {
          world.broken.push(s.id);
          p.score += 50;
        }
      }
    }
  }
  if (!predict) {
    for (const coin of level.coins) {
      if (
        !world.collected.includes(coin.id) &&
        Math.abs(p.x - coin.x) < 17 &&
        Math.abs(p.y - 15 - coin.y) < 24
      ) {
        world.collected.push(coin.id);
        world.teamCoins++;
        p.coins++;
        p.score += 100;
        event(p, "coin", time);
      }
    }
    for (const enemy of level.enemies) {
      if (world.defeated.includes(enemy.id)) continue;
      const e = enemyAt(enemy, time);
      if (Math.abs(p.x - e.x) < 22 && p.y > e.y - 24 && p.y - 28 < e.y) {
        if ((p.vy >= 0 && oldY <= e.y - 16) || p.power > time) {
          world.defeated.push(enemy.id);
          p.vy = -290;
          p.score += 200;
          event(p, "stomp", time);
        } else damage(p, time, e.x);
      }
    }
    for (const checkpoint of level.checkpoints)
      if (p.x >= checkpoint && checkpoint > p.checkpoint)
        p.checkpoint = checkpoint;
    if (p.x >= level.flag) {
      p.finished = true;
      p.score += 1000;
      event(p, "finish", time);
    }
  }
  if (p.y > 560) {
    p.hearts--;
    respawn(p, time);
  }
}

export type Adventure = World & {
  phase: "lobby" | "countdown" | "play" | "clear" | "over";
  players: Hero[];
  deadline: number;
  ready: string[];
  started: number;
  epoch: number;
  outcome?: "won" | "ended" | "timeout";
};
