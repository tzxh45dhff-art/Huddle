import NetworkPreview from "./NetworkPreview";
/** Isolated visual/controls harness. Runs the real rules without an API or database. */
import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import Platformer from "../../src/features/games/platformer/Platformer";
import { platformer, type Adventure } from "../../server/src/games/platformer";
import type { Ctx } from "../../server/src/games/engine";
import type { PartyState } from "../../src/features/party/useParty";
export function Preview() {
  const [party, setParty] = useState<PartyState<Adventure> | null>(null);
  const state = useRef<Adventure | null>(null),
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
