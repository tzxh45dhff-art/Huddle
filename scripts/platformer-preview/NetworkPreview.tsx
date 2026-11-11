import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import Platformer from "../../src/features/games/platformer/Platformer";
import type { PartyState } from "../../src/features/party/useParty";
import type { Adventure } from "../../server/src/games/platformer";
export default function NetworkPreview({ name }: { name: string }) {
  const [party, setParty] = useState<PartyState<Adventure> | null>(null),
    [identity, setIdentity] = useState(""),
    [connected, setConnected] = useState(false),
    [error, setError] = useState<string | null>(null);
  const socket = useRef<Socket | null>(null),
    room = useRef("");
  useEffect(() => {
    let live = true;
    void fetch(`http://127.0.0.1:5190/${name}`)
      .then((r) => {
        if (!r.ok) throw new Error("Start the local QA companion first");
        return r.json();
      })
      .then(({ base, user, roomId }) => {
        if (!live) return;
        room.current = roomId;
        setIdentity(user.id);
        const s = io(base, {
          transports: ["websocket"],
          auth: { token: user.token },
        });
        socket.current = s;
        s.on("connect", () => {
          setConnected(true);
          setError(null);
          s.emit("room:join", { roomId });
          s.emit("party:open", { roomId });
        });
        s.on("disconnect", () => setConnected(false));
        s.on("party:state", (state) => {
          if (state.roomId === roomId)
            setParty(state.game ? { ...state, receivedAt: Date.now() } : null);
        });
        s.on("connect_error", () =>
          setError("Could not reach the scratch API"),
        );
      })
      .catch((e) => setError(String(e)));
    return () => {
      live = false;
      socket.current?.disconnect();
    };
  }, [name]);
  const call = async (event: string, body: Record<string, unknown>) => {
    try {
      const reply = await socket.current
        ?.timeout(3000)
        .emitWithAck(event, { roomId: room.current, ...body });
      if (reply?.error) setError(reply.error);
      return reply;
    } catch {
      setError("Scratch API did not answer");
      return { error: "Timeout" };
    }
  };
  return (
    <Platformer
      party={party}
      selfId={identity}
      connected={connected}
      error={error}
      onStart={(character) =>
        call("party:start", { game: "platformer", options: { character } })
      }
      act={(action, payload) => call("party:act", { action, payload })}
      onJoin={() => void call("party:join", {})}
      onBack={() => void call("party:dismiss", {})}
    />
  );
}
