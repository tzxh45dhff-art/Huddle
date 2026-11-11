import type { Ctx, GameDef } from "./engine.js";
import {
  CHARACTERS,
  LEVELS,
  STEP,
  makeHero,
  stepHero,
} from "./platformer.physics.js";
import type { Adventure } from "./platformer.physics.js";
export type { Adventure } from "./platformer.physics.js";
function reset(s: Adventure, ctx: Ctx) {
  s.collected = [];
  s.used = [];
  s.broken = [];
  s.defeated = [];
  s.time = ctx.now();
  s.players = s.players.map((p, i) => ({
    ...makeHero(p.id, p.name, p.character),
    x: 70 + i * 36,
    score: p.score,
    coins: p.coins,
  }));
  s.phase = "countdown";
  s.deadline = ctx.now() + 3000;
  s.epoch++;
  return s;
}
function schedule(s: Adventure, ctx: Ctx) {
  if (s.phase !== "over") ctx.schedule(s.phase === "play" ? 50 : 200, "tick");
  return s;
}
export const platformer: GameDef<Adventure, { character?: number }> = {
  id: "platformer",
  label: "Super Huddle",
  minPlayers: 1,
  maxPlayers: 8,
  options: (raw) => {
    const n = (raw as { character?: unknown } | null)?.character;
    if (n === undefined) return {};
    return Number.isInteger(n) &&
      Number(n) >= 0 &&
      Number(n) < CHARACTERS.length
      ? { character: Number(n) }
      : { error: "Choose a character" };
  },
  start(players, options, ctx) {
    return schedule(
      {
        phase: "lobby",
        level: 0,
        time: ctx.now(),
        players: players.map((p, i) => ({
          ...makeHero(p.id, p.name, i === 0 ? (options.character ?? 0) : i % 6),
          x: 70 + i * 36,
        })),
        deadline: ctx.now() + 30000,
        ready: [],
        started: ctx.now(),
        epoch: 1,
        collected: [],
        used: [],
        broken: [],
        defeated: [],
        teamCoins: 0,
      },
      ctx,
    );
  },
  act(s, by, action, payload, ctx) {
    const p = by && s.players.find((p) => p.id === by.id);
    if (by) {
      if (!p) return { error: "Join the adventure to play" };
      if (action === "end") {
        ctx.clearSchedule();
        return { ...s, phase: "over", outcome: "ended" };
      }
      if (action === "ready" && s.phase === "lobby") {
        if (!s.ready.includes(p.id)) s.ready.push(p.id);
        return s;
      }
      if (action === "character" && s.phase === "lobby") {
        const n = payload.character;
        if (!Number.isInteger(n) || Number(n) < 0 || Number(n) >= 6)
          return { error: "Choose a character" };
        p.character = Number(n);
        return s;
      }
      if (action === "input") {
        if (s.phase !== "play" || payload.epoch !== s.epoch) return s;
        if (
          typeof payload.dir !== "number" ||
          ![-1, 0, 1].includes(payload.dir) ||
          typeof payload.jump !== "boolean" ||
          typeof payload.run !== "boolean" ||
          !Number.isSafeInteger(payload.seq) ||
          Number(payload.seq) < 0
        )
          return { error: "Invalid controls" };
        if (Number(payload.seq) <= p.input.seq) return s;
        if (payload.jump && !p.input.jump) p.buffer = 0.13;
        p.input = {
          dir: payload.dir,
          jump: payload.jump,
          run: payload.run,
          at: ctx.now(),
          seq: Number(payload.seq),
        };
        return s;
      }
      return { error: "That action is not available now" };
    }
    if (action !== "tick" || s.phase === "over") return s;
    const now = ctx.now();
    if (now - s.started > 20 * 60 * 1000) {
      s.phase = "over";
      s.outcome = "timeout";
      return s;
    }
    if (
      s.phase === "lobby" &&
      (s.ready.length === s.players.length || now >= s.deadline)
    )
      reset(s, ctx);
    else if (s.phase === "countdown" && now >= s.deadline) {
      s.phase = "play";
      s.time = now;
      s.deadline = now + 180000;
    } else if (s.phase === "play") {
      const steps = Math.min(
        12,
        Math.max(0, Math.floor((now - s.time) / (STEP * 1000))),
      );
      for (let i = 0; i < steps; i++) {
        s.time += STEP * 1000;
        for (const p of s.players) stepHero(p, s, s.time);
      }
      if (now - s.time > 200) s.time = now;
      // Friends have time to explore; the first flag gives stragglers a generous finish window.
      if (s.players.some((p) => p.finished))
        s.deadline = Math.min(s.deadline, now + 20000);
      if (s.players.every((p) => p.finished) || now >= s.deadline) {
        s.phase = "clear";
        s.deadline = now + 6000;
      }
    } else if (s.phase === "clear" && now >= s.deadline) {
      if (s.players.some((p) => p.finished)) {
        s.level++;
        if (s.level >= LEVELS.length) {
          s.level = LEVELS.length - 1;
          s.phase = "over";
          s.outcome = "won";
          return s;
        }
      }
      reset(s, ctx);
    }
    return schedule(s, ctx);
  },
  view: (s) => s,
  join(s, p, ctx) {
    if (
      s.phase === "over" ||
      s.players.length >= 8 ||
      s.players.some((q) => q.id === p.id)
    )
      return null;
    const hero = makeHero(p.id, p.name, s.players.length % 6);
    const leader = s.players.find((q) => !q.finished);
    hero.checkpoint = leader?.checkpoint ?? 70;
    hero.x = hero.checkpoint;
    hero.y = 310;
    hero.immune = ctx.now() + 2000;
    s.players.push(hero);
    return s;
  },
  over: (s) =>
    s.phase === "over"
      ? {
          summary: {
            worlds: s.level + 1,
            coins: s.teamCoins,
            scores: s.players.map((p) => ({
              id: p.id,
              name: p.name,
              score: p.score,
            })),
          },
        }
      : null,
};
