import test from "node:test";
import assert from "node:assert/strict";
import { platformer } from "../src/games/platformer.js";
import {
  LEVELS,
  STEP,
  enemyAt,
  makeHero,
  stepHero,
  type World,
  POWER_KINDS,
  POWERS,
  hasPower,
  hazardAt,
  compareStandings,
} from "../src/games/platformer.physics.js";
import type { Ctx } from "../src/games/engine.js";
const world = (level = 0): World => ({
  level,
  time: 1000,
  collected: [],
  used: [],
  broken: [],
  defeated: [],
  teamCoins: 0,
});
function fixture() {
  let now = 1000;
  const timers: { at: number; action: string }[] = [];
  const ctx: Ctx = {
    now: () => now,
    random: () => 0,
    schedule: (ms, action) => timers.push({ at: now + ms, action }),
    clearSchedule: () => {
      timers.length = 0;
    },
  };
  let state = platformer.start(
    [
      { id: "a", name: "Alex" },
      { id: "b", name: "Sam" },
    ],
    {},
    ctx,
  );
  return {
    get state() {
      return state;
    },
    ctx,
    act: (id: string, action: string, payload = {}) =>
      platformer.act(state, { id, name: id }, action, payload, ctx),
    advance: (ms: number) => {
      const end = now + ms;
      while (timers.length && timers[0]!.at <= end) {
        const timer = timers.shift()!;
        now = timer.at;
        const next = platformer.act(state, null, timer.action, {}, ctx);
        assert.ok(!("error" in next));
        state = next;
      }
      now = end;
      return state;
    },
  };
}
test("all room members ready the same world; spectators cannot drive heroes; stale input is ignored", () => {
  const g = fixture();
  assert.ok("error" in g.act("outsider", "ready"));
  g.act("a", "ready");
  g.advance(200);
  assert.equal(g.state.phase, "lobby");
  g.act("b", "ready");
  g.advance(3200);
  assert.equal(g.state.phase, "play");
  g.act("a", "input", {
    epoch: g.state.epoch,
    seq: 2,
    dir: 1,
    jump: true,
    run: true,
  });
  g.act("a", "input", {
    epoch: g.state.epoch,
    seq: 1,
    dir: -1,
    jump: false,
    run: true,
  });
  assert.equal(g.state.players[0]!.input.dir, 1);
  g.advance(100);
  assert.ok(g.state.players[0]!.y < 384);
});
test("short jump taps are preserved, long holds jump higher, and lost input expires", () => {
  const tap = makeHero("a", "Alex"),
    hold = makeHero("b", "Sam"),
    w = world();
  tap.buffer = 0.13;
  tap.input = { dir: 0, jump: false, run: true, seq: 1, at: 1000 };
  hold.input = { ...tap.input, jump: true };
  let tapY = 384,
    holdY = 384;
  for (let i = 0; i < 50; i++) {
    stepHero(tap, w, 1000 + (i * 1000) / 60);
    stepHero(hold, w, 1000 + (i * 1000) / 60);
    tapY = Math.min(tapY, tap.y);
    holdY = Math.min(holdY, hold.y);
  }
  assert.ok(tapY < 365);
  assert.ok(holdY < tapY - 20);
  tap.input = { dir: 1, jump: false, run: true, seq: 2, at: 2000 };
  for (let i = 0; i < 120; i++) stepHero(tap, w, 2000 + (i * 1000) / 60);
  assert.equal(tap.vx, 0);
});
test("question blocks grant one random boost and prediction cannot claim rewards", () => {
  const w = world(),
    box = LEVELS[0]!.solids.find((s) => s.kind === "box")!,
    p = makeHero("a", "Alex");
  p.x = box.x + 16;
  p.y = box.y + box.h + 30;
  p.vy = -300;
  p.grounded = false;
  stepHero(p, w, 1000);
  assert.equal(w.used.length, 1);
  assert.equal(p.boost, "star");
  assert.equal(p.score, 100);
  p.y = box.y + box.h + 30;
  p.vy = -300;
  stepHero(p, w, 1100);
  assert.equal(w.used.length, 1);
  assert.equal(p.boost, "star");
  const q = makeHero("b", "Sam"),
    fresh = world();
  q.x = box.x + 16;
  q.y = box.y + box.h + 30;
  q.vy = -300;
  q.grounded = false;
  stepHero(q, fresh, 1000, STEP, true);
  assert.equal(fresh.teamCoins, 0);
  assert.equal(q.boost, null);
  assert.equal(fresh.used.length, 0);
});
test("stomps defeat enemies; side contact costs one heart and grants immunity; falls respawn safely", () => {
  const w = world(),
    enemy = LEVELS[0]!.enemies[0]!,
    at = enemyAt(enemy, 1000),
    p = makeHero("a", "Alex");
  p.x = at.x;
  p.y = enemy.y - 18;
  p.vy = 200;
  p.grounded = false;
  stepHero(p, w, 1000);
  assert.ok(w.defeated.includes(enemy.id));
  assert.equal(p.score, 200);
  const q = makeHero("b", "Sam"),
    fresh = world();
  q.x = at.x;
  q.y = 384;
  stepHero(q, fresh, 1000);
  assert.equal(q.hearts, 2);
  stepHero(q, fresh, 1017);
  assert.equal(q.hearts, 2);
  q.y = 580;
  stepHero(q, fresh, 1100);
  assert.equal(q.x, q.checkpoint);
  assert.ok(q.y < 384);
});
test("late entrants start at the line; world transitions retain coins and characters", () => {
  const g = fixture();
  g.act("a", "character", { character: 4 });
  g.act("a", "ready");
  g.act("b", "ready");
  g.advance(3200);
  g.state.players[0]!.checkpoint = 1080;
  const joined = platformer.join!(g.state, { id: "c", name: "Taylor" }, g.ctx);
  assert.ok(joined);
  assert.equal(joined.players[2]!.x, 70);
  for (const p of g.state.players) {
    p.finished = true;
    p.coins = 2;
    p.score = 200;
  }
  g.state.teamCoins = 6;
  g.advance(8300);
  assert.equal(g.state.level, 1);
  assert.equal(g.state.players[0]!.character, 4);
  assert.equal(g.state.teamCoins, 6);
  assert.equal(g.state.players[0]!.score, 200);
});
test("harder courses are finishable without a power-up, using legal timed jumps", () => {
  for (let level = 0; level < 3; level++) {
    let completed = false,
      furthest = 0;
    for (const lead of [20, 28, 36, 46, 56]) {
      const w = world(level),
        p = makeHero("a", "Alex"),
        course = LEVELS[level]!;
      let jumpUntil = 0;
      for (let frame = 0; frame < 60 * 90 && !p.finished; frame++) {
        const time = 1000 + (frame * 1000) / 60;
        const edge = course.solids.find(
          (s) => s.kind === "ground" && p.x >= s.x && p.x <= s.x + s.w,
        );
        const pit =
          edge && edge.x + edge.w < course.flag && edge.x + edge.w - p.x < lead;
        const obstacle = course.solids.some(
          (s) => s.kind === "pipe" && s.x > p.x && s.x - p.x < 60,
        );
        const danger = course.hazards.some(
          (h) => h.kind === "spikes" && h.x > p.x && h.x - p.x < 55,
        );
        if (
          p.grounded &&
          !p.jumpHeld &&
          (pit || obstacle || danger || p.y < 370)
        )
          jumpUntil = time + 650;
        p.input = {
          dir: 1,
          jump: time < jumpUntil,
          run: true,
          seq: frame + 1,
          at: time,
        };
        stepHero(p, w, time);
        furthest = Math.max(furthest, p.x);
        // Clear any incidental bonus: the base course must never require a lucky roll.
        p.boost = null;
        p.power = 0;
      }
      if (p.finished) {
        completed = true;
        break;
      }
    }
    assert.ok(
      completed,
      `world ${level + 1} blocked; furthest ${furthest.toFixed(0)}`,
    );
  }
});

test("every checkpoint and enemy patrol rests on solid ground", () => {
  for (const level of LEVELS) {
    for (const x of level.checkpoints)
      assert.ok(
        level.solids.some(
          (s) => s.kind === "ground" && x - 10 >= s.x && x + 10 <= s.x + s.w,
        ),
        `${level.name}: checkpoint ${x}`,
      );
    for (const e of level.enemies)
      assert.ok(
        level.solids.some(
          (s) =>
            s.kind === "ground" &&
            e.x - e.range - 14 >= s.x &&
            e.x + e.range + 14 <= s.x + s.w,
        ),
        `${level.name}: patrol ${e.id}`,
      );
  }
});
test("manually ending an adventure does not claim all worlds were won", () => {
  const g = fixture(),
    ended = g.act("a", "end");
  assert.ok(!("error" in ended));
  assert.equal(ended.outcome, "ended");
});
test(
  "two authenticated players share controls, random boosts, coins and reconnect state",
  { timeout: 30000 },
  async () => {
    const { startServer, makeUser, makeRoom, enter, next } =
      await import("./harness.js");
    const h = await startServer(),
      clients: Awaited<ReturnType<typeof enter>>[] = [];
    type State = {
      view: import("../src/games/platformer.physics.js").Adventure;
    };
    try {
      const a = await makeUser(h.base, "PixelAlex"),
        b = await makeUser(h.base, "PixelSam"),
        room = await makeRoom(h.base, a, b);
      const x = await enter(h.base, a, room.id),
        y = await enter(h.base, b, room.id);
      clients.push(x, y);
      const call = (
        socket: typeof x,
        event: string,
        body: Record<string, unknown>,
      ) =>
        socket
          .timeout(3000)
          .emitWithAck(event, { roomId: room.id, ...body }) as Promise<{
          ok?: boolean;
          error?: string;
        }>;
      for (const socket of clients) {
        const opened = next(socket, "party:state");
        socket.emit("party:open", { roomId: room.id });
        await opened;
      }
      assert.equal(
        (
          await call(x, "party:start", {
            game: "platformer",
            options: { character: 4 },
          })
        ).ok,
        true,
      );
      assert.equal(
        (
          await call(y, "party:act", {
            action: "character",
            payload: { character: 1 },
          })
        ).ok,
        true,
      );
      await call(x, "party:act", { action: "ready" });
      await call(y, "party:act", { action: "ready" });
      let ready: State;
      do {
        ready = await next<State>(y, "party:state", 4000);
      } while (ready.view.phase !== "play");
      assert.equal(ready.view.players.find((p) => p.id === a.id)!.character, 4);
      assert.equal(ready.view.players.find((p) => p.id === b.id)!.character, 1);
      const epoch = ready.view.epoch;
      assert.equal(
        (
          await call(x, "party:act", {
            action: "input",
            payload: { epoch, seq: 1, dir: 1, jump: false, run: true },
          })
        ).ok,
        true,
      );
      let moved: State;
      do {
        moved = await next<State>(y, "party:state");
      } while (moved.view.players.find((p) => p.id === a.id)!.x < 190);
      assert.ok(moved.view.teamCoins >= 1);
      assert.ok(moved.view.players.find((p) => p.id === a.id)!.coins >= 1);
      await call(x, "party:act", {
        action: "input",
        payload: { epoch, seq: 2, dir: 0, jump: false, run: true },
      });
      await call(x, "party:act", {
        action: "input",
        payload: { epoch, seq: 3, dir: 1, jump: false, run: false },
      });
      let atBox: State;
      do {
        atBox = await next<State>(y, "party:state");
      } while (atBox.view.players.find((p) => p.id === a.id)!.x < 330);
      await call(x, "party:act", {
        action: "input",
        payload: { epoch, seq: 4, dir: 0, jump: false, run: true },
      });
      for (let i = 0; i < 5; i++) await next<State>(y, "party:state");
      await call(x, "party:act", {
        action: "input",
        payload: { epoch, seq: 5, dir: 0, jump: true, run: true },
      });
      let rewarded: State;
      do {
        rewarded = await next<State>(y, "party:state");
      } while (!rewarded.view.players.find((p) => p.id === a.id)!.boost);
      const onOwner = (await next<State>(x, "party:state")).view.players.find(
        (p) => p.id === a.id,
      )!;
      const onRival = rewarded.view.players.find((p) => p.id === a.id)!;
      assert.equal(onOwner.boost, onRival.boost);
      assert.equal(onOwner.power, onRival.power);
      assert.equal(rewarded.view.used.length, 1);
      x.disconnect();
      const reconnect = await enter(h.base, a, room.id);
      clients.push(reconnect);
      const restored = next<State>(reconnect, "party:state");
      reconnect.emit("party:open", { roomId: room.id });
      const snapshot = (await restored).view;
      assert.ok(snapshot.players.find((p) => p.id === a.id)!.x > 180);
      assert.ok(snapshot.teamCoins >= moved.view.teamCoins);
      assert.equal(
        snapshot.players.find((p) => p.id === a.id)!.boost,
        onRival.boost,
      );
      const ended = next<State>(y, "party:state");
      await call(reconnect, "party:act", { action: "end" });
      assert.equal((await ended).view.outcome, "ended");
    } finally {
      clients.forEach((s) => s.disconnect());
      await h.stop();
    }
  },
);

test("every box roll is server-chosen, replaces the boost, and cannot be stolen or rerolled", () => {
  for (let roll = 0; roll < POWER_KINDS.length; roll++) {
    const w = world(),
      box = LEVELS[0]!.solids.find((s) => s.kind === "box")!,
      p = makeHero("a", "Alex");
    let rolls = 0;
    const hit = (hero: typeof p) => {
      hero.x = box.x + 16;
      hero.y = box.y + box.h + 30;
      hero.vy = -300;
      hero.grounded = false;
      stepHero(hero, w, 1000, STEP, false, (max) => {
        assert.equal(max, 4);
        rolls++;
        return roll;
      });
    };
    hit(p);
    assert.equal(p.boost, POWER_KINDS[roll]);
    assert.equal(p.power, 1000 + POWERS[p.boost!].seconds * 1000);
    assert.equal(p.pickup?.kind, p.boost);
    hit(p);
    const rival = makeHero("b", "Sam");
    hit(rival);
    assert.equal(rolls, 1);
    assert.equal(rival.boost, null);
  }
  const g = fixture();
  assert.ok("error" in g.act("a", "power", { kind: "star" }));
});
test("turbo changes speed, springs change height, magnets collect nearby coins, and buffs expire", () => {
  const normal = makeHero("a", "Alex"),
    turbo = makeHero("b", "Sam"),
    spring = makeHero("c", "Taylor");
  turbo.boost = "dash";
  turbo.power = 10000;
  spring.boost = "spring";
  spring.power = 10000;
  for (let i = 0; i < 25; i++)
    for (const p of [normal, turbo, spring]) {
      p.input = {
        dir: 1,
        jump: true,
        run: true,
        seq: i + 1,
        at: 1000 + (i * 1000) / 60,
      };
      stepHero(p, world(), p.input.at);
    }
  assert.ok(turbo.x > normal.x + 15);
  assert.ok(spring.y < normal.y - 25);
  assert.equal(hasPower(turbo, "dash", 10001), false);
  const magnet = makeHero("m", "Morgan"),
    w = world();
  magnet.x = 130;
  magnet.boost = "magnet";
  magnet.power = 3000;
  stepHero(magnet, w, 1000);
  assert.ok(magnet.coins > 0);
  const plain = makeHero("p", "Pat");
  plain.x = 130;
  stepHero(plain, world(), 1000);
  assert.equal(plain.coins, 0);
});
test("stars protect from spikes; other bonuses do not, and falling cancels powers", () => {
  const hazard = LEVELS[0]!.hazards.find((h) => h.kind === "spikes")!,
    star = makeHero("a", "Alex"),
    dash = makeHero("b", "Sam");
  for (const p of [star, dash]) {
    p.x = hazard.x + 10;
    p.power = 5000;
  }
  star.boost = "star";
  dash.boost = "dash";
  stepHero(star, world(), 1000);
  stepHero(dash, world(), 1000);
  assert.equal(star.hearts, 3);
  assert.equal(dash.hearts, 2);
  star.y = 580;
  stepHero(star, world(), 1100);
  assert.equal(star.boost, null);
  assert.equal(star.power, 0);
  assert.equal(star.falls, 1);
  assert.equal(star.grounded, false);
  assert.notEqual(
    hazardAt(
      LEVELS[1]!.hazards.find((h) => h.kind === "saw")!,
      1000,
    ).x,
    hazardAt(
      LEVELS[1]!.hazards.find((h) => h.kind === "saw")!,
      2000,
    ).x,
  );
});
test("race points are awarded once, finish order beats farming, and equal finishes tie fairly", () => {
  const g = fixture();
  g.act("a", "ready");
  g.act("b", "ready");
  g.advance(3200);
  assert.equal(g.state.players[0]!.x, g.state.players[1]!.x, "same start line");
  const [a, b] = g.state.players;
  a!.x = LEVELS[0]!.flag;
  g.advance(50);
  assert.equal(a!.place, 1);
  assert.equal(a!.racePoints, 10);
  b!.x = LEVELS[0]!.flag;
  g.advance(50);
  assert.equal(b!.place, 2);
  assert.equal(b!.racePoints, 7);
  assert.equal(a!.racePoints, 10);
  b!.coins = 10000;
  b!.score = 1000000;
  assert.ok(compareStandings(a!, b!) < 0);
  const tie = fixture();
  tie.act("a", "ready");
  tie.act("b", "ready");
  tie.advance(3200);
  for (const p of tie.state.players) p.x = LEVELS[0]!.flag;
  tie.advance(50);
  assert.deepEqual(
    tie.state.players.map((p) => [p.place, p.racePoints]),
    [
      [1, 10],
      [1, 10],
    ],
  );
  tie.state.players[0]!.coins = 3;
  tie.state.players[1]!.coins = 2;
  assert.ok(compareStandings(tie.state.players[0]!, tie.state.players[1]!) < 0);
});
test("a timed out course advances once, retains totals, and cannot farm repeated races", () => {
  const g = fixture();
  g.act("a", "ready");
  g.act("b", "ready");
  g.advance(3200);
  g.state.players[0]!.racePoints = 7;
  g.advance(118300);
  assert.equal(g.state.level, 1);
  assert.equal(g.state.players[0]!.racePoints, 7);
  assert.equal(g.state.players[0]!.place, 0);
  g.advance(230000);
  assert.equal(g.state.phase, "over");
  assert.equal(g.state.level, 2);
  assert.equal(g.state.outcome, "won");
});
