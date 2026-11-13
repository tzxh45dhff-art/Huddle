import { makeHero } from "../../server/src/games/platformer.physics";
import NetworkPreview from "./NetworkPreview";
/** Isolated visual/controls harness. Runs the real rules without an API or database. */
import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import Platformer from "../../src/features/games/platformer/Platformer";
import { platformer, type Adventure } from "../../server/src/games/platformer";
import type { Ctx } from "../../server/src/games/engine";
import type { PartyState } from "../../src/features/party/useParty";
function Preview() {
  // Keep this entry unexported so Vite reloads it instead of Fast Refresh creating a second React root.
  // Static synthetic edge-state fixtures for visual QA only; never shipped in the app bundle.
  const scene = new URLSearchParams(location.search).get("scene");
  const [party, setParty] = useState<PartyState<Adventure> | null>(() => {
    if (!["results", "final", "power"].includes(scene ?? "")) return null;
    const time = Date.now();
    const players = Array.from({ length: 8 }, (_, i) => ({
      ...makeHero(
        i === 0 ? "preview" : `qa-${i}`,
        i === 0 ? "You" : `Player ${i + 1} with a very long name`,
        i % 6,
      ),
      x: 200 + i * 42,
      finished: scene !== "power" && i < 5,
      finishedAt: i < 5 ? 1000 + i * 100 : 0,
      place: i < 5 ? i + 1 : 0,
      racePoints: Math.max(0, 20 - i * 3),
      coins: 30 - i,
      boost: i === 0 ? ("magnet" as const) : null,
      power: i === 0 ? time + 10000 : 0,
    }));
    return {
      game: "platformer",
      label: "Super Huddle",
      seq: 0,
      startedBy: { id: "preview", name: "You" },
      serverTime: time,
      receivedAt: time,
      view: {
        level: scene === "power" ? 2 : 0,
        time,
        phase:
          scene === "results" ? "clear" : scene === "final" ? "over" : "play",
        outcome: "won",
        players,
        deadline: time + 60000,
        ready: [],
        started: time,
        epoch: 1,
        collected: [],
        used: [],
        broken: [],
        defeated: [],
        teamCoins: 100,
      },
    };
  });
  const state = useRef<Adventure | null>(party?.view ?? null),
    timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const publish = () => {
    const time = Date.now();
    setParty({
      game: "platformer",
      label: "Super Huddle",
      seq: 0,
      startedBy: { id: "preview", name: "You" },
      serverTime: time,
      receivedAt: time,
      view: structuredClone(
        platformer.view(state.current!, "preview") as Adventure,
      ),
    });
  };
  const ctx: Ctx = {
    now: () => Date.now(),
    random: (max) => Math.floor(Math.random() * max),
    clearSchedule: () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    schedule: (ms, action, payload) => {
      const timer = setTimeout(() => {
        timers.current = timers.current.filter((t) => t !== timer);
        const next = platformer.act(
          state.current!,
          null,
          action,
          payload ?? {},
          ctx,
        );
        if (!("error" in next)) {
          state.current = next;
          publish();
        }
      }, ms);
      timers.current.push(timer);
    },
  };
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [],
  );
  return (
    <Platformer
      party={party}
      selfId="preview"
      connected
      error={null}
      onStart={async (character) => {
        ctx.clearSchedule();
        state.current = platformer.start(
          [{ id: "preview", name: "You" }],
          { character },
          ctx,
        );
        publish();
      }}
      onJoin={() => {}}
      onBack={() => {
        ctx.clearSchedule();
        state.current = null;
        setParty(null);
      }}
      act={async (action, payload) => {
        const next = platformer.act(
          state.current!,
          { id: "preview", name: "You" },
          action,
          payload ?? {},
          ctx,
        );
        if (!("error" in next)) {
          state.current = next;
          publish();
        }
      }}
    />
  );
}
const root = createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
root.render(
  new URLSearchParams(location.search).has("network") ? (
    <NetworkPreview
      name={new URLSearchParams(location.search).get("network")!}
    />
  ) : (
    <Preview />
  ),
);
