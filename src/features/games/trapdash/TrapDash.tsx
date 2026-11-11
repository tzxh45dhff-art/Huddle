import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Hammer,
  Layers,
  Snowflake,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import type { TrapDashView } from "../../../../server/src/games/trapdash.physics";
import {
  COLORS,
  SLOTS,
  type TrapKind,
} from "../../../../server/src/games/trapdash.physics";
import { remaining, type PartyState } from "@/features/party/useParty";
import { paint, type SceneMemory } from "./scene";
import "./trapdash.css";
const TRAPS = [
  {
    id: "spring",
    name: "Boing!",
    text: "Launch anyone sky-high.",
    icon: Zap,
    color: "#ffd17c",
  },
  {
    id: "hammer",
    name: "Bonk",
    text: "Time your jump. Or get bonked.",
    icon: Hammer,
    color: "#ffa1ad",
  },
  {
    id: "crumble",
    name: "Oops",
    text: "The floor drops after a step.",
    icon: Layers,
    color: "#ffb18b",
  },
  {
    id: "ice",
    name: "Whoosh",
    text: "Slippery feet. Very bad brakes.",
    icon: Snowflake,
    color: "#9ceaf2",
  },
] as const;
export default function TrapDash({
  party,
  selfId,
  connected,
  error,
  act,
  onStart,
  onDismiss,
}: {
  party: PartyState<TrapDashView> | null;
  selfId?: string;
  connected: boolean;
  error: string | null;
  act: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
  onStart: () => Promise<unknown>;
  onDismiss: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(party);
  latest.current = party;
  const send = useRef(act);
  send.current = act;
  const [kind, setKind] = useState<TrapKind>("hammer");
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [clock, setClock] = useState(0);
  const sound = useRef<AudioContext | null>(null);
  const keys = useRef({ left: false, right: false, jump: false });
  const frames = useRef<TrapDashView[]>([]);
  const replay = useRef<TrapDashView[]>([]);
  const replayStart = useRef(0);
  const highlight = useRef<{ frames: TrapDashView[]; until: number }>({
    frames: [],
    until: 0,
  });
  const view = party?.view;
  const player = view?.players.find((p) => p.id === selfId);
  const phase = view?.phase;
  const hasParty = !!party;
  useEffect(() => {
    keys.current = { left: false, right: false, jump: false };
  }, [phase]);
  const tone = useCallback(
    (hz = 480) => {
      if (muted) return;
      const a = sound.current ?? new AudioContext();
      sound.current = a;
      void a.resume();
      const o = a.createOscillator(),
        g = a.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(hz, a.currentTime);
      o.frequency.exponentialRampToValueAtTime(hz * 0.5, a.currentTime + 0.16);
      g.gain.setValueAtTime(0.07, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.2);
      o.connect(g);
      g.connect(a.destination);
      o.start();
      o.stop(a.currentTime + 0.22);
    },
    [muted],
  );
  const toneRef = useRef(tone);
  toneRef.current = tone;
  const previous = useRef({ falls: 0, score: 0, phase: "" });
  useEffect(() => {
    if (sound.current) {
      if ((player?.falls ?? 0) > previous.current.falls) tone(150);
      else if ((player?.score ?? 0) > previous.current.score) tone(900);
      else if (phase === "race" && previous.current.phase !== phase) tone(740);
    }
    previous.current = {
      falls: player?.falls ?? 0,
      score: player?.score ?? 0,
      phase: phase ?? "",
    };
  }, [player?.falls, player?.score, phase, tone]);
  useEffect(
    () => () => {
      void sound.current?.close();
    },
    [],
  );
  useEffect(() => {
    const t = window.setInterval(() => setClock(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!view) return;
    if (view.phase === "race") {
      const prev = frames.current.at(-1);
      if (
        prev &&
        view.players.some(
          (p) =>
            p.falls > (prev.players.find((q) => q.id === p.id)?.falls ?? 0),
        )
      ) {
        highlight.current = {
          frames: frames.current.slice(-40),
          until: view.time + 1000,
        };
      }
      if (view.time <= highlight.current.until)
        highlight.current.frames.push(view);
      frames.current.push(view);
      if (frames.current.length > 70) frames.current.shift();
    }
  }, [view]);
  useEffect(() => {
    if (phase === "results") {
      replay.current = highlight.current.frames.length
        ? highlight.current.frames
        : frames.current;
      replayStart.current = performance.now();
    }
    if (phase === "place") {
      frames.current = [];
      replay.current = [];
      highlight.current = { frames: [], until: 0 };
    }
  }, [phase]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const c = el.getContext("2d");
    if (!c) return;
    let width = 0,
      height = 0,
      raf = 0,
      last = performance.now();
    const memory: SceneMemory = { camera: 0, positions: new Map() };
    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const dpr = Math.min(2, devicePixelRatio);
      el.width = width * dpr;
      el.height = height * dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    resize.observe(el);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    function draw(now: number) {
      const v = latest.current?.view;
      if (v && width && height) {
        const replayFrame =
          v.phase === "results" && !reduced
            ? replay.current[
                Math.min(
                  replay.current.length - 1,
                  Math.floor((now - replayStart.current) / 50),
                )
              ]
            : null;
        paint(
          c!,
          width,
          height,
          replayFrame ?? v,
          selfId,
          memory,
          Math.min(0.05, (now - last) / 1000),
          now,
          reduced,
        );
      }
      last = now;
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => {
      resize.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [selfId, hasParty]);
  const transmit = () => {
    const v = latest.current?.view;
    if (
      !v ||
      v.phase !== "race" ||
      !connected ||
      !v.players.some((p) => p.id === selfId)
    )
      return;
    void send.current("input", {
      round: v.round,
      dir: Number(keys.current.right) - Number(keys.current.left),
      jump: keys.current.jump,
    });
  };
  const control = (key: "left" | "right" | "jump", down: boolean) => {
    keys.current[key] = down;
    transmit();
    if (key === "jump" && down) tone(680);
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
      " ": "jump",
    };
    const handle = (e: KeyboardEvent, down: boolean) => {
      // Key releases must survive a phase change or focus moving to a button.
      if (!down && map[e.key]) {
        keys.current[map[e.key]!] = false;
        transmit();
        return;
      }
      if (
        latest.current?.view.phase !== "race" ||
        !map[e.key] ||
        (e.target instanceof HTMLElement &&
          (/INPUT|TEXTAREA/.test(e.target.tagName) ||
            e.target.isContentEditable ||
            (e.target.tagName === "BUTTON" && e.key === " ")))
      )
        return;
      e.preventDefault();
      if (e.repeat) return;
      keys.current[map[e.key]!] = down;
      if (down && map[e.key] === "jump") toneRef.current(680);
      transmit();
    };
    const down = (e: KeyboardEvent) => handle(e, true),
      up = (e: KeyboardEvent) => handle(e, false);
    const clear = () => {
      keys.current = { left: false, right: false, jump: false };
      transmit();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    const heartbeat = window.setInterval(transmit, 400);
    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      clear();
    };
    // Controls use the latest snapshot without reinstalling handlers on each physics tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, selfId]);
  const start = async () => {
    setBusy(true);
    tone();
    try {
      await onStart();
    } finally {
      setBusy(false);
    }
  };
  const place = (slot: number) => {
    tone(360);
    void act("place", { round: view!.round, slot, kind });
  };
  const seconds = party
    ? Math.ceil(remaining(party, view!.deadline) / 1000)
    : 0;
  void clock;
  if (!view)
    return (
      <div className="td td-lobby" data-lenis-prevent>
        <div className="td-lobby-art" aria-hidden>
          <span className="td-sun" />
          <span className="td-hill h1" />
          <span className="td-hill h2" />
          <span className="td-bean b1">••</span>
          <span className="td-bean b2">••</span>
          <span className="td-bean b3">••</span>
          <span className="td-island" />
          <span className="td-spring">ϟ</span>
        </div>
        <div className="td-intro">
          <span className="td-kicker">A LITTLE MISCHIEF. A BIG JUMP.</span>
          <h1>
            TRAP
            <br />
            <em>DASH.</em>
          </h1>
          <p>
            Build trouble. Bounce through it.
            <br />
            Try not to fall for your own trap.
          </p>
          <div className="td-how">
            <span>
              <b>01</b> Hide a trap
            </span>
            <span>
              <b>02</b> Race your friends
            </span>
            <span>
              <b>03</b> Laugh. Repeat.
            </span>
          </div>
          <button
            className="td-primary"
            disabled={busy || !connected}
            onClick={() => void start()}
          >
            {busy ? "Opening the course…" : "Let’s bounce"}{" "}
            <ArrowRight size={22} />
          </button>
          <small>
            1–8 players · 5 quick rounds · No talking needed
            <br />
            Practice racers fill empty spots. Arrows / A D + Space to jump.
          </small>
          {error && (
            <p role="alert" className="td-error">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  const ranking = [...view.players].sort((a, b) => b.score - a.score);
  return (
    <div className="td td-game" data-lenis-prevent>
      <header className="td-header">
        <div>
          <span className="td-kicker">THE FLOATING GARDENS</span>
          <h1>
            TRAP <em>DASH</em>
            <span> {view.round}/5</span>
          </h1>
        </div>
        <div className="td-phase" aria-live="polite">
          <b>
            {phase === "place"
              ? "Hide your trap"
              : phase === "countdown"
                ? "Get ready"
                : phase === "race"
                  ? player?.finished
                    ? "You made it!"
                    : "Run. Jump. Repeat."
                  : phase === "results"
                    ? "Action replay"
                    : "That’s a wrap!"}
          </b>
          <span>
            {phase === "place"
              ? "Choose a trap, then a numbered spot."
              : phase === "race"
                ? "Finish: 10 points for first · Catch a rival: +2"
                : phase === "results"
                  ? "Next round starts automatically."
                  : "Your own traps can catch you too."}
          </span>
        </div>
        <div className="td-header-end">
          <button
            aria-label={muted ? "Enable sound" : "Mute sound"}
            onClick={() => {
              setMuted(!muted);
              if (muted) tone();
            }}
          >
            {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <strong className="td-clock">
            {phase === "over" ? "★" : `${seconds}s`}
          </strong>
        </div>
      </header>
      {(!connected || error) && (
        <div className="td-error" role="alert">
          {!connected ? "Reconnecting… Your runner will stop safely." : error}
        </div>
      )}
      <div className="td-rank" aria-label="Scores">
        {ranking.map((p) => (
          <span key={p.id} className={p.id === selfId ? "you" : ""}>
            <i
              style={{
                background:
                  COLORS[view.players.findIndex((q) => q.id === p.id)],
              }}
            />
            {p.name}
            {p.bot ? " · CPU" : ""}
            <b>{p.score}</b>
            {p.finished ? " ✓" : ""}
          </span>
        ))}
      </div>
      <div className="td-course">
        <canvas ref={canvas} aria-label="Floating garden race course" />
        {phase === "countdown" && (
          <div className="td-count" key={seconds}>
            {seconds || "GO!"}
          </div>
        )}
        {!player && phase !== "over" && (
          <div className="td-watch">
            Watching this match · You can race in the next one
          </div>
        )}
        {phase === "over" && (
          <div className="td-end">
            <span className="td-kicker">
              GARDEN CHAMPION
              {ranking[0]?.score === ranking[1]?.score ? "S" : ""}
            </span>
            <h2>
              {ranking
                .filter((p) => p.score === ranking[0]?.score)
                .map((p) => p.name)
                .join(" & ")}
            </h2>
            <p>{ranking[0]?.score} points of beautiful chaos.</p>
            <button
              className="td-primary"
              disabled={busy || !connected}
              onClick={() => void start()}
            >
              {busy ? "Starting…" : "One more race"} <ArrowRight size={20} />
            </button>
            <button className="td-back" onClick={onDismiss}>
              Back to games
            </button>
          </div>
        )}
      </div>
      {phase === "place" && player ? (
        <section className="td-workshop">
          <div className="td-traps">
            {TRAPS.map((t) => (
              <button
                key={t.id}
                aria-pressed={kind === t.id}
                style={{ "--trap": t.color } as React.CSSProperties}
                onClick={() => {
                  setKind(t.id);
                  tone(400);
                  if (view.mine)
                    void act("place", {
                      round: view.round,
                      slot: view.mine.slot,
                      kind: t.id,
                    });
                }}
              >
                <t.icon size={26} />
                <span>
                  <b>{t.name}</b>
                  <small>{t.text}</small>
                </span>
              </button>
            ))}
          </div>
          <div className="td-spots">
            <span>
              {view.mine
                ? `Hidden at ${view.mine.slot + 1}. Tap another to move it.`
                : "Pick a spot →"}
            </span>
            <div>
              {SLOTS.map((_, i) => (
                <button
                  key={i}
                  aria-label={`Place ${kind} at spot ${i + 1}`}
                  aria-pressed={view.mine?.slot === i}
                  disabled={!connected}
                  onClick={() => place(i)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <small>
              {view.placed.length}/{view.players.length} placed · Same spot? We
              move one nearby.
            </small>
          </div>
        </section>
      ) : (
        <footer className="td-controls">
          <div className="td-control-hint">
            <b>
              {phase === "results"
                ? "Nice run. Take a breath."
                : "Small feet. Big trouble."}
            </b>
            <span>
              {player?.finished
                ? "Watch your friends finish."
                : "← → / A D to move · Space to jump"}
            </span>
          </div>
          <div className="td-touch">
            {(["left", "right", "jump"] as const).map((k) => (
              <button
                key={k}
                disabled={
                  phase !== "race" || !player || !!player.finished || !connected
                }
                aria-label={k === "jump" ? "Jump" : `Move ${k}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  control(k, true);
                }}
                onPointerUp={() => control(k, false)}
                onPointerCancel={() => control(k, false)}
                onLostPointerCapture={() => control(k, false)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    if (!e.repeat) control(k, true);
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === " " || e.key === "Enter") control(k, false);
                }}
              >
                {k === "left" ? (
                  <ArrowLeft />
                ) : k === "right" ? (
                  <ArrowRight />
                ) : (
                  <>
                    <ArrowUp /> JUMP
                  </>
                )}
              </button>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
