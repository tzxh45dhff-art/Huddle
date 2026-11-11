import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, Volume2, VolumeX } from "lucide-react";
import {
  CHARACTERS,
  LEVELS,
  STEP,
  makeHero,
  stepHero,
} from "../../../../server/src/games/platformer.physics";
import type { Adventure } from "../../../../server/src/games/platformer.physics";
import type { PartyState } from "@/features/party/useParty";
import { remaining } from "@/features/party/useParty";
import { Portrait } from "./sprites";
import { render, type Camera } from "./render";
import { AdventureAudio } from "./audio";
import "./platformer.css";
type Reply = { error?: string; ok?: boolean } | unknown;
export default function Platformer({
  party,
  selfId,
  connected,
  error,
  onStart,
  act,
  onJoin,
  onBack,
}: {
  party: PartyState<Adventure> | null;
  selfId?: string;
  connected: boolean;
  error: string | null;
  onStart: (character: number) => Promise<Reply>;
  act: (action: string, payload?: Record<string, unknown>) => Promise<Reply>;
  onJoin: () => void;
  onBack: () => void;
}) {
  const [character, setCharacter] = useState(0),
    [muted, setMuted] = useState(false),
    [busy, setBusy] = useState(false),
    [clock, setClock] = useState(Date.now()),
    [fast, setFast] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null),
    latest = useRef(party),
    send = useRef(act),
    controls = useRef({ left: false, right: false, jump: false, run: true }),
    sequence = useRef(0),
    jumpAt = useRef(0);
  latest.current = party;
  send.current = act;
  const audio = useRef<AdventureAudio | null>(null);
  if (!audio.current) audio.current = new AdventureAudio();
  const seen = useRef(new Map<string, number>()),
    state = party?.view,
    me = state?.players.find((p) => p.id === selfId),
    phase = state?.phase,
    epoch = state?.epoch;
  const hasParty = !!party;
  const seconds =
    party && state ? Math.ceil(remaining(party, state.deadline) / 1000) : 0;
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  void clock;
  useEffect(() => {
    controls.current = { left: false, right: false, jump: false, run: fast };
    seen.current.clear();
  }, [epoch, phase, fast]);
  useEffect(() => {
    audio.current?.setMuted(muted);
  }, [muted]);
  useEffect(() => {
    audio.current?.scene(phase ?? "", state?.level ?? 0);
    if (phase === "play") audio.current?.play("go");
    if (phase === "over") audio.current?.play("finish");
  }, [phase, state?.level]);
  useEffect(() => {
    if (phase === "countdown") audio.current?.play("count");
  }, [phase, seconds]);
  useEffect(() => {
    if (!state || phase !== "play") return;
    for (const p of state.players) {
      if (p.event > (seen.current.get(p.id) ?? 0)) {
        seen.current.set(p.id, p.event);
        if (state.time - p.effectAt < 600)
          audio.current?.play(
            p.effect,
            p.id === selfId
              ? 0
              : Math.max(-0.8, Math.min(0.8, (p.x - (me?.x ?? 0)) / 400)),
            p.id === selfId ? 1 : 0.35,
          );
      }
    }
  }, [state, phase, selfId, me?.x]);
  useEffect(() => {
    const unlock = () => {
        void audio.current?.unlock();
      },
      hide = () => {
        if (document.hidden) void audio.current?.pause();
      };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", hide);
      audio.current?.dispose();
    };
  }, []);
  const transmit = () => {
    const s = latest.current?.view,
      p = s?.players.find((p) => p.id === selfId);
    if (!s || s.phase !== "play" || !p || p.finished || !connected) return;
    sequence.current = Math.max(sequence.current, p.input.seq) + 1;
    void send.current("input", {
      epoch: s.epoch,
      seq: sequence.current,
      dir: Number(controls.current.right) - Number(controls.current.left),
      jump: controls.current.jump,
      run: controls.current.run,
    });
  };
  const control = (key: "left" | "right" | "jump", down: boolean) => {
    if (key === "jump" && down && !controls.current.jump)
      jumpAt.current = performance.now();
    controls.current[key] = down;
    transmit();
  };
  useEffect(() => {
    const map: Record<string, "left" | "right" | "jump"> = {
      ArrowLeft: "left",
      a: "left",
      A: "left",
      ArrowRight: "right",
      d: "right",
      D: "right",
      ArrowUp: "jump",
      w: "jump",
      W: "jump",
      z: "jump",
      Z: "jump",
      " ": "jump",
    };
    const handler = (e: KeyboardEvent, down: boolean) => {
      const key = map[e.key];
      if (!down && key) {
        controls.current[key] = false;
        transmit();
        return;
      }
      if (
        latest.current?.view.phase !== "play" ||
        !key ||
        e.repeat ||
        (e.target instanceof HTMLElement &&
          (/INPUT|TEXTAREA/.test(e.target.tagName) ||
            e.target.isContentEditable ||
            (e.target.tagName === "BUTTON" && e.key === " ")))
      )
        return;
      e.preventDefault();
      if (key === "jump" && !controls.current.jump)
        jumpAt.current = performance.now();
      controls.current[key] = down;
      transmit();
    };
    const down = (e: KeyboardEvent) => handler(e, true),
      up = (e: KeyboardEvent) => handler(e, false),
      clear = () => {
        controls.current.left = false;
        controls.current.right = false;
        controls.current.jump = false;
        transmit();
      };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    const heartbeat = setInterval(transmit, 300);
    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      clear();
    };
    // The latest state and sender are refs; changing snapshots must not reset held controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId, connected]);
  useEffect(() => {
    const el = canvas.current,
      c = el?.getContext("2d");
    if (!el || !c) return;
    let w = 0,
      h = 0,
      raf = 0,
      last = performance.now();
    const camera: Camera = { x: 0, level: -1, positions: new Map() };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      w = entry.contentRect.width;
      h = entry.contentRect.height;
      const dpr = Math.min(2, devicePixelRatio);
      el.width = w * dpr;
      el.height = h * dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.imageSmoothingEnabled = false;
    });
    observer.observe(el);
    const draw = (now: number) => {
      let s = latest.current?.view;
      if (!s) {
        s = {
          phase: "lobby",
          level: 0,
          time: Date.now(),
          players: [
            { ...makeHero("preview", "Pip", character), x: 190 },
            { ...makeHero("friend", "Mochi", 1), x: 260 },
          ],
          deadline: 0,
          ready: [],
          started: 0,
          epoch: 0,
          collected: [],
          used: [],
          broken: [],
          defeated: [],
          teamCoins: 0,
        };
      } else if (s.phase === "play") {
        const p = s.players.find((p) => p.id === selfId);
        if (p && !p.finished) {
          const clone = {
            ...p,
            input: {
              ...p.input,
              dir:
                Number(controls.current.right) - Number(controls.current.left),
              jump: controls.current.jump,
              run: controls.current.run,
              at: s.time,
            },
          };
          if (now - jumpAt.current < 130) clone.buffer = 0.13;
          const steps = Math.min(
            9,
            Math.ceil(
              Math.max(
                0,
                Date.now() - (latest.current?.receivedAt ?? Date.now()) + 35,
              ) /
                (STEP * 1000),
            ),
          );
          for (let i = 0; i < steps; i++)
            stepHero(clone, s, s.time + i * STEP * 1000, STEP, true);
          s = {
            ...s,
            players: s.players.map((q) => (q.id === selfId ? clone : q)),
          };
        }
      }
      if (w && h)
        render(
          c,
          w,
          h,
          s,
          selfId,
          camera,
          Math.min(0.05, (now - last) / 1000),
          reduced,
        );
      last = now;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [selfId, hasParty, character]);
  const start = async () => {
    setBusy(true);
    void audio.current?.unlock();
    audio.current?.play("select");
    try {
      await onStart(character);
    } finally {
      setBusy(false);
    }
  };
  const choose = (n: number) => {
    setCharacter(n);
    audio.current?.play("select");
    if (state?.phase === "lobby" && me) void act("character", { character: n });
  };
  const selection = (
    <div className="sh-cast" role="group" aria-label="Choose your hero">
      {CHARACTERS.map((name, i) => (
        <button
          key={name}
          aria-pressed={(me?.character ?? character) === i}
          onClick={() => choose(i)}
        >
          <Portrait character={i} />
          <span>{name.split(" · ")[0]}</span>
        </button>
      ))}
    </div>
  );
  return (
    <div className="sh" data-lenis-prevent>
      <header className="sh-hud">
        <button className="sh-back" onClick={onBack} aria-label="All games">
          <ArrowLeft size={18} />
        </button>
        <div>
          <span>SUPER HUDDLE</span>
          <b>{me ? String(me.score).padStart(6, "0") : "LET’S GO!"}</b>
        </div>
        <div>
          <span>COINS</span>
          <b className="sh-gold">
            ◆ × {String(state?.teamCoins ?? 0).padStart(2, "0")}
          </b>
        </div>
        <div>
          <span>WORLD</span>
          <b>{(state?.level ?? 0) + 1}—1</b>
        </div>
        <div>
          <span>{phase === "play" ? "TIME" : "HEARTS"}</span>
          <b>{phase === "play" ? String(seconds).padStart(3, "0") : "♥ ♥ ♥"}</b>
        </div>
        <button
          className="sh-sound"
          aria-label={
            muted ? "Enable music and sounds" : "Mute music and sounds"
          }
          onClick={() => {
            setMuted(!muted);
            void audio.current?.unlock();
          }}
        >
          {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
      </header>
      {error && (
        <div className="sh-error" role="alert">
          {error}
        </div>
      )}
      {!connected && (
        <div className="sh-error" role="status">
          Reconnecting… Controls are paused.
        </div>
      )}
      {state && (
        <div className="sh-roster">
          {state.players.map((p) => (
            <span key={p.id} className={p.id === selfId ? "you" : ""}>
              <Portrait character={p.character} />
              <b>{p.id === selfId ? "YOU" : p.name}</b>
              <i>
                {p.finished
                  ? "⚑"
                  : `${"♥".repeat(p.hearts)}${"♡".repeat(3 - p.hearts)}`}
              </i>
            </span>
          ))}
        </div>
      )}
      <main className="sh-stage">
        <canvas
          ref={canvas}
          aria-label="Side-scrolling pixel platform adventure"
        />
        {!state && (
          <div className="sh-intro">
            <span className="sh-tag">A LITTLE WORLD. A BIG ADVENTURE.</span>
            <h1>
              SUPER
              <br />
              <em>HUDDLE</em>
            </h1>
            <p>
              Pick your hero. Bring your friends.
              <br />
              Every coin, every jump, together.
            </p>
            {selection}
            <button
              className="sh-primary"
              onClick={() => void start()}
              disabled={busy || !connected}
            >
              {busy ? "OPENING WORLD…" : "START ADVENTURE"}{" "}
              <ArrowRight size={18} />
            </button>
            <small>
              1–8 players · 3 worlds · Drop-in multiplayer
              <br />
              Arrows / A D to move · Hold Space / Z to jump higher
            </small>
          </div>
        )}
        {state?.phase === "lobby" && (
          <section className="sh-panel">
            <span className="sh-tag">WORLD 1—1</span>
            <h2>CHOOSE YOUR HERO</h2>
            {selection}
            <p>
              Jump under ? blocks. Stomp enemies from above.
              <br />
              Hold jump for height. Flags save your progress.
            </p>
            <div className="sh-ready-players">
              {state.players.map((p) => (
                <span key={p.id}>
                  {p.name} {state.ready.includes(p.id) ? "✓" : "…"}
                </span>
              ))}
            </div>
            {me ? (
              <button
                className="sh-primary"
                disabled={state.ready.includes(me.id) || !connected}
                onClick={() => void act("ready")}
              >
                {state.ready.includes(me.id)
                  ? "WAITING FOR FRIENDS…"
                  : "READY TO EXPLORE"}
              </button>
            ) : (
              <button className="sh-primary" onClick={onJoin}>
                JOIN ADVENTURE
              </button>
            )}
            <small>Starts in {seconds}s · Everyone ready? We go now.</small>
          </section>
        )}
        {phase === "countdown" && (
          <div className="sh-count">
            <span>
              WORLD {state!.level + 1}—1 · {LEVELS[state!.level]!.name}
            </span>
            <b>{seconds || "GO!"}</b>
          </div>
        )}
        {phase === "clear" && (
          <section className="sh-panel compact">
            <span className="sh-tag">
              {state!.players.some((p) => p.finished)
                ? "COURSE CLEAR!"
                : "LET’S TRY AGAIN"}
            </span>
            <h2>
              {state!.players.some((p) => p.finished)
                ? "NICE WORK, TEAM."
                : "ONE MORE RUN."}
            </h2>
            <p>
              {state!.teamCoins} coins collected together.
              <br />
              {state!.players.some((p) => p.finished)
                ? "The next world is just ahead."
                : "Your scores stay. The course resets."}
            </p>
            <small>Continuing in {seconds}s</small>
          </section>
        )}
        {phase === "over" && (
          <section className="sh-panel">
            <span className="sh-tag">
              {state!.outcome === "won"
                ? "ADVENTURE COMPLETE"
                : state!.outcome === "timeout"
                  ? "TIME FOR A BREAK"
                  : "ADVENTURE ENDED"}
            </span>
            <h2>
              {state!.outcome === "won" ? "SUPER FRIENDS." : "UNTIL NEXT TIME."}
            </h2>
            <div className="sh-podium">
              {[...state!.players]
                .sort((a, b) => b.score - a.score)
                .map((p) => (
                  <div key={p.id}>
                    <Portrait character={p.character} />
                    <b>{p.name}</b>
                    <span>
                      {p.score} pts · {p.coins} coins
                    </span>
                  </div>
                ))}
            </div>
            <button
              className="sh-primary"
              onClick={() => void start()}
              disabled={busy || !connected}
            >
              PLAY AGAIN
            </button>
            <button className="sh-link" onClick={onBack}>
              ALL GAMES
            </button>
          </section>
        )}
        {phase === "play" && !me && (
          <div className="sh-watch">
            <span>Your friends are exploring.</span>
            <button onClick={onJoin}>JOIN THEM →</button>
          </div>
        )}
        {phase === "play" && me?.finished && (
          <div className="sh-watch">
            COURSE CLEAR! Watching your friends finish.
          </div>
        )}
      </main>
      <footer className="sh-controls">
        <div className="sh-instructions">
          <b>
            {state
              ? LEVELS[state.level]!.name
              : "YOUR NEXT GREAT LITTLE ADVENTURE"}
          </b>
          <span>Arrows / A D · Hold Space / Z to jump higher</span>
        </div>
        <div className="sh-buttons">
          <button
            aria-label="Move left"
            disabled={phase !== "play" || !me || me.finished}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              control("left", true);
            }}
            onPointerUp={() => control("left", false)}
            onPointerCancel={() => control("left", false)}
            onLostPointerCapture={() => control("left", false)}
            onKeyDown={(e) => {
              if (e.key === " " && !e.repeat) control("left", true);
            }}
            onKeyUp={() => control("left", false)}
          >
            <ArrowLeft />
          </button>
          <button
            aria-label="Move right"
            disabled={phase !== "play" || !me || me.finished}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              control("right", true);
            }}
            onPointerUp={() => control("right", false)}
            onPointerCancel={() => control("right", false)}
            onLostPointerCapture={() => control("right", false)}
            onKeyDown={(e) => {
              if (e.key === " " && !e.repeat) control("right", true);
            }}
            onKeyUp={() => control("right", false)}
          >
            <ArrowRight />
          </button>
          <button
            className="sh-run"
            aria-pressed={fast}
            onClick={() => setFast(!fast)}
          >
            {fast ? "RUN" : "WALK"}
          </button>
          <button
            className="sh-jump"
            aria-label="Jump"
            disabled={phase !== "play" || !me || me.finished}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              control("jump", true);
            }}
            onPointerUp={() => control("jump", false)}
            onPointerCancel={() => control("jump", false)}
            onLostPointerCapture={() => control("jump", false)}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && !e.repeat)
                control("jump", true);
            }}
            onKeyUp={() => control("jump", false)}
          >
            <ArrowUp /> JUMP
          </button>
        </div>
      </footer>
    </div>
  );
}
