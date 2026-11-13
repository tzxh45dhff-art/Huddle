import type {
  Effect,
  PowerKind,
} from "../../../../server/src/games/platformer.physics";

/** Small original arcade score and layered Foley, synthesized locally. No downloads or autoplay. */
export class AdventureAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBeat = 0;
  private beat = 0;
  private phase = "";
  private level = 0;
  muted = false;
  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended")
      await this.context.resume().catch(() => {});
    if (!this.timer) this.timer = setInterval(() => this.music(), 90);
  }
  setMuted(value: boolean) {
    this.muted = value;
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        value ? 0 : 0.55,
        this.context.currentTime,
        0.025,
      );
  }
  scene(phase: string, level = 0) {
    if (this.level !== level) {
      this.beat = 0;
      this.nextBeat = 0;
    }
    this.phase = phase;
    this.level = level;
  }
  private note(
    freq: number,
    end: number,
    duration: number,
    volume: number,
    type: OscillatorType = "sine",
    delay = 0,
    pan = 0,
  ) {
    const a = this.context,
      master = this.master;
    if (!a || !master || a.state !== "running" || this.muted) return;
    const at = a.currentTime + delay,
      oscillator = a.createOscillator(),
      gain = a.createGain(),
      stereo = a.createStereoPanner();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, at);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, end),
      at + duration,
    );
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    stereo.pan.value = pan;
    oscillator.connect(gain);
    gain.connect(stereo);
    stereo.connect(master);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      stereo.disconnect();
    };
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }
  private noise(duration: number, volume: number, delay = 0) {
    const a = this.context,
      master = this.master;
    if (!a || !master || a.state !== "running" || this.muted) return;
    const source = a.createBufferSource(),
      buffer = a.createBuffer(
        1,
        Math.ceil(a.sampleRate * duration),
        a.sampleRate,
      ),
      data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    source.buffer = buffer;
    const gain = a.createGain(),
      filter = a.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1800;
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    source.start(a.currentTime + delay);
  }
  play(effect: Effect | "select" | "count" | "go", pan = 0, volume = 1) {
    const n = (
      f: number,
      e: number,
      d: number,
      v: number,
      type: OscillatorType = "sine",
      delay = 0,
    ) => this.note(f, e, d, v * volume, type, delay, pan);
    switch (effect) {
      case "jump":
        n(220, 780, 0.16, 0.19, "triangle");
        n(440, 1100, 0.1, 0.07);
        break;
      case "spring":
        [0, 0.08, 0.16, 0.24].forEach((at, i) =>
          n(170 + i * 110, 650 - i * 70, 0.14, 0.18, "triangle", at),
        );
        break;
      case "bonk":
        this.noise(0.1, 0.12 * volume);
        n(110, 38, 0.22, 0.25);
        n(740, 230, 0.35, 0.09, "triangle");
        break;
      case "fall":
        n(650, 70, 0.5, 0.16, "sawtooth");
        n(320, 40, 0.5, 0.08, "sine", 0.1);
        break;
      case "land":
        n(100, 40, 0.07, 0.09);
        this.noise(0.04, 0.03 * volume);
        break;
      case "coin":
        n(988, 988, 0.08, 0.14, "square");
        n(1319, 1319, 0.2, 0.12, "square", 0.07);
        break;
      case "power":
        [392, 494, 587, 784, 988].forEach((f, i) =>
          n(f, f, 0.16, 0.11, "square", i * 0.07),
        );
        break;
      case "stomp":
        n(180, 50, 0.13, 0.2, "triangle");
        this.noise(0.06, 0.05);
        break;
      case "finish":
        [523, 659, 784, 1047].forEach((f, i) =>
          n(f, f, 0.3, 0.17, "triangle", i * 0.1),
        );
        this.noise(0.18, 0.07, 0.35);
        break;
      case "select":
        n(660, 990, 0.06, 0.12, "triangle");
        break;
      case "count":
        n(440, 440, 0.1, 0.19, "square");
        break;
      case "go":
        n(880, 1320, 0.24, 0.2, "triangle");
        n(660, 990, 0.24, 0.13, "triangle");
        break;
    }
  }
  powerup(kind: PowerKind) {
    const notes: Record<PowerKind, number[]> = {
      star: [523, 659, 784, 1047, 1319],
      dash: [220, 330, 494, 740, 1109],
      spring: [196, 392, 294, 587, 784],
      magnet: [880, 659, 988, 784, 1175],
    };
    notes[kind].forEach((f, i) =>
      this.note(
        f,
        kind === "dash" ? f * 1.25 : f,
        0.15,
        0.12,
        kind === "spring" ? "triangle" : "square",
        i * 0.06,
      ),
    );
  }
  private music() {
    const a = this.context;
    if (
      !a ||
      a.state !== "running" ||
      this.muted ||
      !["play", "lobby", "countdown"].includes(this.phase)
    ) {
      this.nextBeat = 0;
      return;
    }
    if (!this.nextBeat || this.nextBeat < a.currentTime - 0.2)
      this.nextBeat = a.currentTime + 0.03;
    // Eight phrases per world, with an answering melody, bass movement and a turnaround.
    // These are original scores, not samples or transcriptions from another game.
    const themes = [
      [
        [76, 79, 0, 81, 79, 0, 76, 74, 72, 0, 74, 76, 0, 79, 0, 0],
        [77, 0, 81, 84, 83, 81, 0, 79, 77, 0, 76, 74, 72, 0, 0, 0],
        [79, 0, 76, 79, 84, 0, 83, 81, 79, 76, 0, 74, 76, 0, 79, 0],
        [81, 79, 77, 0, 76, 74, 0, 72, 71, 74, 77, 79, 76, 0, 72, 0],
      ],
      [
        [72, 0, 0, 79, 0, 75, 0, 74, 72, 0, 67, 0, 70, 0, 0, 0],
        [68, 0, 75, 0, 79, 0, 77, 75, 74, 0, 70, 0, 67, 0, 0, 0],
        [75, 0, 79, 0, 84, 0, 82, 79, 77, 0, 75, 0, 74, 0, 72, 0],
        [70, 0, 74, 77, 0, 79, 0, 74, 71, 0, 74, 0, 72, 0, 0, 0],
      ],
      [
        [79, 83, 86, 0, 84, 83, 81, 0, 79, 0, 76, 79, 83, 0, 0, 0],
        [81, 84, 88, 0, 86, 84, 83, 81, 79, 0, 81, 83, 84, 0, 0, 0],
        [83, 0, 86, 88, 91, 0, 88, 86, 84, 83, 81, 0, 79, 0, 83, 0],
        [84, 83, 81, 79, 78, 0, 81, 84, 83, 81, 79, 78, 79, 0, 0, 0],
      ],
    ];
    const roots = [
      [48, 53, 45, 55, 48, 53, 50, 55],
      [48, 44, 46, 43, 48, 44, 41, 43],
      [43, 48, 52, 50, 43, 48, 45, 50],
    ];
    const tempo = [0.145, 0.19, 0.125][this.level]!;
    while (this.nextBeat < a.currentTime + 0.15) {
      const delay = Math.max(0, this.nextBeat - a.currentTime),
        step = this.beat++ % 128,
        phrase = Math.floor(step / 16),
        beat = step % 16;
      const midi = themes[this.level]![phrase % 4]![beat]!,
        root = roots[this.level]![phrase]!,
        hz = (n: number) => 440 * 2 ** ((n - 69) / 12);
      if (midi)
        this.note(
          hz(midi),
          hz(midi),
          tempo * (beat % 4 === 0 ? 1.4 : 0.8),
          0.036,
          this.level === 1 ? "triangle" : "square",
          delay,
          -0.18,
        );
      if (phrase >= 4 && beat % 2 === 0) {
        const harmony =
          root +
          24 +
          [0, this.level === 1 ? 3 : 4, 7, 12][Math.floor(beat / 2) % 4]!;
        this.note(
          hz(harmony),
          hz(harmony),
          tempo * 0.65,
          0.018,
          "triangle",
          delay,
          0.35,
        );
      }
      if (beat % 2 === 0) {
        const bass = root + (beat % 8 === 4 ? 7 : 0);
        this.note(hz(bass), hz(bass), tempo * 1.5, 0.07, "triangle", delay);
      }
      if (beat % 4 === 0) this.note(90, 35, 0.09, 0.08, "sine", delay);
      if (beat % 8 === 4) this.noise(0.06, 0.03, delay);
      if (beat % 2 === 1) this.noise(0.022, 0.012, delay);
      this.nextBeat += tempo;
    }
  }

  async pause() {
    if (this.context?.state === "running") await this.context.suspend();
  }
  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.context?.close();
    this.context = null;
    this.master = null;
  }
}
