/** Fixed-step, server-owned race physics. Units are pixels and seconds. */
export const TRACK = 2600;
export const FLOOR = 430;
export const FINISH = 2510;
export const STEP = 1 / 60;
export const COLORS = [
  "#ffbb54",
  "#75e6d5",
  "#ff7696",
  "#99aaff",
  "#d3ed77",
  "#ffa779",
  "#dba5f0",
  "#8fd5ff",
];
export const GAPS = [
  [590, 690],
  [1210, 1320],
  [1900, 2010],
];
export const SLOTS = [
  310, 430, 760, 880, 1000, 1120, 1390, 1510, 1630, 1750, 1820, 2080, 2200,
  2320,
];
export type TrapKind = "spring" | "hammer" | "crumble" | "ice";
export const KINDS: TrapKind[] = ["spring", "hammer", "crumble", "ice"];
export type Trap = {
  owner: string;
  slot: number;
  kind: TrapKind;
  brokenUntil: number;
  armedAt: number;
};
export type Runner = {
  id: string;
  name: string;
  bot?: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  checkpoint: number;
  score: number;
  finished: number;
  falls: number;
  stun: number;
  immune: number;
  coyote: number;
  jumpBuffer: number;
  jumpHeld: boolean;
  input: { dir: number; jump: boolean; at: number };
  hit: string | null;
};
export function runner(
  id: string,
  name: string,
  i: number,
  bot = false,
): Runner {
  return {
    id,
    name,
    bot,
    x: 75 + i * 20,
    y: FLOOR,
    vx: 0,
    vy: 0,
    grounded: true,
    checkpoint: 80,
    score: 0,
    finished: 0,
    falls: 0,
    stun: 0,
    immune: 0,
    coyote: 0,
    jumpBuffer: 0,
    jumpHeld: false,
    input: { dir: 0, jump: false, at: 0 },
    hit: null,
  };
}
export function stepRunner(
  p: Runner,
  traps: Trap[],
  time: number,
  dt = STEP,
): string | null {
  if (p.finished) return null;
  const active = time - p.input.at < 900;
  const dir = active ? p.input.dir : 0;
  const jump = active && p.input.jump;
  if (jump && !p.jumpHeld) p.jumpBuffer = 0.13;
  p.jumpHeld = jump;
  p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
  p.coyote = p.grounded ? 0.1 : Math.max(0, p.coyote - dt);
  const ice = traps.some(
    (t) =>
      t.kind === "ice" && Math.abs(p.x - SLOTS[t.slot]!) < 65 && p.grounded,
  );
  if (time >= p.stun) {
    const target = dir * (ice ? 460 : 345);
    p.vx += (target - p.vx) * Math.min(1, dt * (ice ? 2.5 : 13));
    if (p.jumpBuffer > 0 && p.coyote > 0) {
      p.vy = -680;
      p.grounded = false;
      p.coyote = 0;
      p.jumpBuffer = 0;
    }
  }
  const oldY = p.y;
  p.vy += 1850 * dt;
  p.x = Math.max(25, Math.min(TRACK - 35, p.x + p.vx * dt));
  p.y += p.vy * dt;
  const gap =
    GAPS.some(([a, b]) => p.x > a! && p.x < b!) ||
    traps.some(
      (t) =>
        t.kind === "crumble" &&
        t.brokenUntil > time &&
        Math.abs(p.x - SLOTS[t.slot]!) < 43,
    );
  p.grounded = false;
  if (!gap && oldY <= FLOOR && p.y >= FLOOR && p.vy >= 0) {
    p.y = FLOOR;
    p.vy = 0;
    p.grounded = true;
  }
  let credit: string | null = null;
  for (const t of traps) {
    if (
      Math.abs(p.x - SLOTS[t.slot]!) > 42 ||
      p.y < FLOOR - 55 ||
      p.y > FLOOR + 15
    )
      continue;
    if (t.kind === "spring" && p.grounded) {
      p.vy = -920;
      p.grounded = false;
    }
    if (
      t.kind === "crumble" &&
      p.grounded &&
      t.armedAt === 0 &&
      t.brokenUntil <= time
    )
      t.armedAt = time + 260;
    if (
      t.kind === "hammer" &&
      Math.sin(time / 290 + t.slot) > 0.45 &&
      time >= p.immune
    ) {
      p.vx = -520;
      p.vy = -410;
      p.stun = time + 450;
      p.immune = time + 1400;
      p.hit = t.owner;
      credit = t.owner === p.id ? null : t.owner;
    }
    if (t.kind === "crumble" && t.brokenUntil > time) p.hit = t.owner;
  }
  if (p.grounded && p.x > p.checkpoint + 380) p.checkpoint = p.x;
  if (p.y > FLOOR + 200) {
    p.falls++;
    p.x = p.checkpoint;
    p.y = FLOOR - 80;
    p.vx = 0;
    p.vy = 0;
    p.immune = time + 1000;
    if (p.hit && p.hit !== p.id) credit = p.hit;
    p.hit = null;
  }
  return credit;
}

export type TrapDashState = {
  phase: "place" | "countdown" | "race" | "results" | "over";
  round: number;
  deadline: number;
  time: number;
  players: Runner[];
  traps: Trap[];
  placements: Record<string, { slot: number; kind: TrapKind }>;
  awards: string[];
  tick: number;
};
export type TrapDashView = Omit<TrapDashState, "placements"> & {
  placed: string[];
  mine: { slot: number; kind: TrapKind } | null;
};
