/** Isolated visual/controls harness. Runs the real rules without an API or database. */
import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import TrapDash from "../../src/features/games/trapdash/TrapDash";
import {
  trapDash,
  type TrapDashState,
  type TrapDashView,
} from "../../server/src/games/trapdash";
import type { Ctx } from "../../server/src/games/engine";
import type { PartyState } from "../../src/features/party/useParty";
export function Preview() {
  const [party, setParty] = useState<PartyState<TrapDashView> | null>(null);
  const state = useRef<TrapDashState | null>(null),
    timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const publish = () => {
    const time = Date.now();
    setParty({
      game: "trapdash",
      label: "Trap Dash",
      seq: 0,
      startedBy: { id: "preview", name: "You" },
      serverTime: time,
      receivedAt: time,
      view: structuredClone(
        trapDash.view(state.current!, "preview") as TrapDashView,
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
        const next = trapDash.act(
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
    <TrapDash
      party={party}
      selfId="preview"
      connected
      error={null}
      onStart={async () => {
        ctx.clearSchedule();
        state.current = trapDash.start(
          [{ id: "preview", name: "You" }],
          {},
          ctx,
        );
        publish();
      }}
      onDismiss={() => {
        ctx.clearSchedule();
        state.current = null;
        setParty(null);
      }}
      act={async (action, payload) => {
        const next = trapDash.act(
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
createRoot(document.getElementById("root")!).render(<Preview />);
