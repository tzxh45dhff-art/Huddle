import test from "node:test";
import assert from "node:assert/strict";
import { trapDash } from "../src/games/trapdash.js";
import {
  runner,
  stepRunner,
  FLOOR,
  SLOTS,
} from "../src/games/trapdash.physics.js";
import type { Ctx } from "../src/games/engine.js";
function game() {
  let now = 1000;
  const queue: {
    at: number;
    action: string;
    payload: Record<string, unknown>;
  }[] = [];
  const ctx: Ctx = {
    now: () => now,
    random: () => 0,
    schedule: (ms, action, payload = {}) =>
      queue.push({ at: now + ms, action, payload }),
    clearSchedule: () => {
      queue.length = 0;
    },
  };
  let state = trapDash.start(
    [
      { id: "a", name: "Alex" },
      { id: "b", name: "Sam" },
    ],
    {},
    ctx,
  );
  const advance = (ms: number) => {
    const end = now + ms;
    while (queue.length && queue[0]!.at <= end) {
      const t = queue.shift()!;
      now = t.at;
      const next = trapDash.act(state, null, t.action, t.payload, ctx);
      assert.ok(!("error" in next));
      state = next;
    }
    now = end;
    return state;
  };
  return {
    get state() {
      return state;
    },
    ctx,
    advance,
    act: (id: string, action: string, payload: Record<string, unknown>) =>
      trapDash.act(state, { id, name: id }, action, payload, ctx),
  };
}
test("placements stay secret, resolve collisions, and reveal after the timer", () => {
  const g = game();
  g.act("a", "place", { round: 1, slot: 2, kind: "hammer" });
  g.act("b", "place", { round: 1, slot: 2, kind: "ice" });
  const view = trapDash.view(g.state, "b") as Record<string, unknown>;
  assert.equal("placements" in view, false);
  assert.deepEqual(view.mine, { slot: 2, kind: "ice" });
  assert.deepEqual(view.traps, []);
  g.advance(10000);
  assert.equal(g.state.phase, "countdown");
  assert.equal(new Set(g.state.traps.map((t) => t.slot)).size, 3);
  g.advance(3000);
  assert.equal(g.state.phase, "race");
});
test("rejects spectators, stale controls, invalid placements and player clock ticks", () => {
  const g = game();
  for (const [id, action, payload] of [
    ["stranger", "end", {}],
    ["a", "place", { round: 9, slot: 0, kind: "ice" }],
    ["a", "place", { round: 1, slot: 999, kind: "ice" }],
    ["a", "tick", { round: 1 }],
  ] as const)
    assert.ok("error" in g.act(id, action, payload));
  assert.equal(g.state.phase, "place");
});
test("five rounds finish on their own, even when everyone leaves", () => {
  const g = game();
  g.advance(220000);
  assert.equal(g.state.phase, "over");
  assert.equal(g.state.round, 5);
  assert.ok(trapDash.over(g.state));
  assert.ok(
    g.state.players.every(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.score),
    ),
  );
});
test("jump has a rising edge, lands, and stale movement stops", () => {
  const p = runner("a", "Alex", 0);
  p.input = { dir: 0, jump: true, at: 1000 };
  for (let n = 0; n < 50; n++) stepRunner(p, [], 1000 + (n * 1000) / 60);
  assert.equal(p.y, FLOOR);
  assert.equal(p.grounded, true);
  p.input = { dir: 1, jump: false, at: 2000 };
  for (let n = 0; n < 120; n++) stepRunner(p, [], 2000 + (n * 1000) / 60);
  assert.ok(Math.abs(p.vx) < 1);
});
test("springs launch; crumble falls respawn at checkpoints; hammer scoring is bounded", () => {
  const p = runner("a", "Alex", 0);
  p.x = SLOTS[0]!;
  stepRunner(
    p,
    [{ owner: "b", slot: 0, kind: "spring", armedAt: 0, brokenUntil: 0 }],
    1000,
  );
  assert.ok(p.vy < -800);
  p.x = 640;
  p.y = FLOOR;
  p.vy = 0;
  for (let n = 0; n < 40; n++) stepRunner(p, [], 2000 + (n * 1000) / 60);
  assert.ok(p.falls > 0);
  assert.ok(p.x < 590);
  const g = game();
  g.advance(13000);
  const a = g.state.players[0]!,
    b = g.state.players[1]!;
  g.state.traps = [
    { owner: b.id, kind: "hammer", slot: 0, armedAt: 0, brokenUntil: 0 },
  ];
  for (let i = 0; i < 10; i++) {
    a.x = SLOTS[0]!;
    a.y = FLOOR;
    a.immune = 0;
    g.advance(400);
  }
  assert.equal(g.state.awards.filter((a) => a === `${b.id}:a`).length, 1);
  assert.equal(
    b.score,
    g.state.awards.filter((a) => a.startsWith(`${b.id}:`)).length * 2,
  );
});
test("finish points cannot be claimed by the client or earned twice", () => {
  const g = game();
  g.advance(13000);
  assert.ok("error" in g.act("a", "finish", { round: 1 }));
  g.state.players[0]!.x = 2520;
  g.advance(50);
  assert.equal(g.state.players[0]!.score, 10);
  g.advance(500);
  assert.equal(g.state.players[0]!.score, 10);
});

test(
  "two authenticated room members share a race and reconnect to the same position",
  { timeout: 30000 },
  async () => {
    const { startServer, makeUser, makeRoom, enter, next } =
      await import("./harness.js");
    const h = await startServer();
    const clients: Awaited<ReturnType<typeof enter>>[] = [];
    try {
      const a = await makeUser(h.base, "RaceAlex"),
        b = await makeUser(h.base, "RaceSam");
      const room = await makeRoom(h.base, a, b);
      const x = await enter(h.base, a, room.id),
        y = await enter(h.base, b, room.id);
      clients.push(x, y);
      for (const socket of clients) {
        const opened = next(socket, "party:state");
        socket.emit("party:open", { roomId: room.id });
        await opened;
      }
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
      assert.equal(
        (await call(x, "party:start", { game: "trapdash", options: {} })).ok,
        true,
      );
      assert.equal(
        (
          await call(x, "party:act", {
            action: "place",
            payload: { round: 1, slot: 2, kind: "hammer" },
          })
        ).ok,
        true,
      );
      const hidden = await next<{
        view: import("../src/games/trapdash.physics.js").TrapDashView;
      }>(y, "party:state");
      assert.equal(hidden.view.mine, null);
      assert.equal("placements" in hidden.view, false);
      const race = await new Promise<
        import("../src/games/trapdash.physics.js").TrapDashView
      >((resolve, reject) => {
        const t = setTimeout(() => {
          y.off("party:state", handler);
          reject(new Error("race never started"));
        }, 16000);
        function handler(s: {
          view?: import("../src/games/trapdash.physics.js").TrapDashView;
        }) {
          if (s.view?.phase === "race") {
            clearTimeout(t);
            y.off("party:state", handler);
            resolve(s.view);
          }
        }
        y.on("party:state", handler);
      });
      const initial = race.players.find((p) => p.id === a.id)!.x;
      assert.equal(
        (
          await call(x, "party:act", {
            action: "input",
            payload: { round: 1, dir: 1, jump: true },
          })
        ).ok,
        true,
      );
      await new Promise((r) => setTimeout(r, 500));
      const moved = await next<{
        view: import("../src/games/trapdash.physics.js").TrapDashView;
      }>(y, "party:state");
      assert.ok(
        moved.view.players.find((p) => p.id === a.id)!.x > initial + 50,
      );
      x.disconnect();
      const reconnect = await enter(h.base, a, room.id);
      clients.push(reconnect);
      const restored = next<{
        view: import("../src/games/trapdash.physics.js").TrapDashView;
      }>(reconnect, "party:state");
      reconnect.emit("party:open", { roomId: room.id });
      assert.ok(
        (await restored).view.players.find((p) => p.id === a.id)!.x > initial,
      );
      assert.equal(
        (await call(reconnect, "party:act", { action: "end" })).ok,
        true,
      );
    } finally {
      clients.forEach((s) => s.disconnect());
      await h.stop();
    }
  },
);
