import type { Ctx, GameDef } from "./engine.js";
import {
  FINISH,
  GAPS,
  KINDS,
  SLOTS,
  STEP,
  runner,
  stepRunner,
  type TrapKind,
} from "./trapdash.physics.js";
import type { TrapDashState, TrapDashView } from "./trapdash.physics.js";
export type { TrapDashState, TrapDashView } from "./trapdash.physics.js";
function schedule(s: TrapDashState, ctx: Ctx) {
  ctx.schedule(50, "tick", { round: s.round });
  return s;
}
function placeRound(s: TrapDashState, ctx: Ctx) {
  s.phase = "place";
  s.deadline = ctx.now() + 10000;
  s.placements = {};
  s.traps = [];
  s.awards = [];
  s.time = ctx.now();
  s.players = s.players.map((p, i) => ({
    ...runner(p.id, p.name, i, p.bot),
    score: p.score,
  }));
  for (const p of s.players.filter((p) => p.bot))
    s.placements[p.id] = {
      slot: ctx.random(SLOTS.length),
      kind: KINDS[ctx.random(KINDS.length)]!,
    };
  return s;
}
export const trapDash: GameDef<TrapDashState, Record<string, never>> = {
  id: "trapdash",
  label: "Trap Dash",
  minPlayers: 1,
  maxPlayers: 8,
  options: () => ({}),
  start(players, _, ctx) {
    const racers = players.map((p, i) => runner(p.id, p.name, i));
    while (racers.length < 3)
      racers.push(
        runner(
          `trap-bot-${racers.length}`,
          ["Pip", "Mochi", "Peaches"][racers.length]!,
          racers.length,
          true,
        ),
      );
    return schedule(
      placeRound(
        {
          phase: "place",
          round: 1,
          deadline: 0,
          time: 0,
          players: racers,
          traps: [],
          placements: {},
          awards: [],
          tick: 0,
        },
        ctx,
      ),
      ctx,
    );
  },
  act(s, by, action, payload, ctx) {
    const p = by && s.players.find((p) => p.id === by.id);
    if (by) {
      if (!p)
        return { error: "You’re watching this match. Join the next one." };
      if (action === "end") {
        ctx.clearSchedule();
        return { ...s, phase: "over" };
      }
      if (payload.round !== s.round)
        return { error: "That round has finished" };
      if (action === "place" && s.phase === "place") {
        const slot = payload.slot;
        if (
          !Number.isInteger(slot) ||
          Number(slot) < 0 ||
          Number(slot) >= SLOTS.length ||
          !KINDS.includes(payload.kind as TrapKind)
        )
          return { error: "Choose a marked spot and a trap" };
        s.placements[p.id] = {
          slot: Number(slot),
          kind: payload.kind as TrapKind,
        };
        return s;
      }
      if (action === "input" && s.phase === "race") {
        if (
          ![-1, 0, 1].includes(Number(payload.dir)) ||
          typeof payload.jump !== "boolean"
        )
          return { error: "Invalid controls" };
        p.input = {
          dir: Number(payload.dir),
          jump: payload.jump,
          at: ctx.now(),
        };
        return s;
      }
      return { error: "Wait for the next phase" };
    }
    if (action !== "tick" || payload.round !== s.round || s.phase === "over")
      return s;
    const now = ctx.now();
    if (s.phase === "race") {
      // Bounded catch-up prevents a stalled process from teleporting racers.
      const steps = Math.min(
        12,
        Math.max(0, Math.floor((now - s.time) / (STEP * 1000))),
      );
      for (let n = 0; n < steps; n++) {
        s.time += STEP * 1000;
        for (const t of s.traps) {
          if (t.armedAt && s.time >= t.armedAt) {
            t.brokenUntil = s.time + 1800;
            t.armedAt = 0;
          }
        }
        for (const p of s.players) {
          if (p.bot) {
            const lookAhead = 75 + s.players.indexOf(p) * 4;
            const edge = GAPS.some(([start]) => start! > p.x && start! - p.x < lookAhead);
            const hazard = s.traps.some(t => (t.kind === 'hammer' || t.kind === 'crumble') && SLOTS[t.slot]! > p.x && SLOTS[t.slot]! - p.x < lookAhead);
            p.input = { dir: 1, jump: p.grounded && (edge || hazard), at: s.time };
          }
          const credit = stepRunner(p, s.traps, s.time);
          if (credit) {
            const owner = s.players.find((q) => q.id === credit);
            if (owner && !s.awards.includes(`${owner.id}:${p.id}`)) {
              owner.score += 2;
              s.awards.push(`${owner.id}:${p.id}`);
            }
          }
          if (!p.finished && p.x >= FINISH) {
            p.finished = s.time;
            p.score += Math.max(
              3,
              10 - s.players.filter((q) => q.finished).length + 1,
            );
          }
        }
      }
      if (now - s.time > 200) s.time = now;
    } else s.time = now;
    if (
      now >= s.deadline ||
      (s.phase === "race" && s.players.every((p) => p.finished))
    ) {
      if (s.phase === "place") {
        const used = new Set<number>();
        s.traps = s.players.map((p) => {
          const choice = s.placements[p.id] ?? {
            slot: ctx.random(SLOTS.length),
            kind: KINDS[ctx.random(4)]!,
          };
          let slot = choice.slot;
          while (used.has(slot)) slot = (slot + 1) % SLOTS.length;
          used.add(slot);
          return {
            owner: p.id,
            kind: choice.kind,
            slot,
            brokenUntil: 0,
            armedAt: 0,
          };
        });
        s.phase = "countdown";
        s.deadline = now + 3000;
      } else if (s.phase === "countdown") {
        s.phase = "race";
        s.time = now;
        s.deadline = now + 22000;
      } else if (s.phase === "race") {
        s.phase = "results";
        s.deadline = now + 5500;
      } else if (s.round === 5) {
        s.phase = "over";
        return s;
      } else {
        s.round++;
        placeRound(s, ctx);
      }
    }
    s.tick++;
    return schedule(s, ctx);
  },
  view(s, viewer): TrapDashView {
    const { placements, ...publicState } = s;
    return {
      ...publicState,
      placed: Object.keys(placements),
      mine: placements[viewer] ?? null,
    };
  },
  join: () => null,
  over: (s) =>
    s.phase === "over"
      ? {
          summary: {
            scores: s.players.map((p) => ({
              id: p.id,
              name: p.name,
              score: p.score,
            })),
          },
        }
      : null,
};
