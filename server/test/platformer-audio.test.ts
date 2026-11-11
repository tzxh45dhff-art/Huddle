import test from "node:test";
import assert from "node:assert/strict";
import { AdventureAudio } from "../../src/features/games/platformer/audio.js";

test("audio survives scene changes, layers distinct effects, respects mute and releases its context", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  const contexts: FakeContext[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
  });
  class FakeContext {
    state = "suspended";
    currentTime = 1;
    sampleRate = 1000;
    destination = {};
    voices = 0;
    closed = false;
    constructor() {
      contexts.push(this);
    }
    async resume() {
      this.state = "running";
    }
    async suspend() {
      this.state = "suspended";
    }
    async close() {
      this.closed = true;
      this.state = "closed";
    }
    createGain() {
      return { gain: param(), connect() {}, disconnect() {} };
    }
    createStereoPanner() {
      return { pan: { value: 0 }, connect() {}, disconnect() {} };
    }
    createOscillator() {
      this.voices++;
      return {
        frequency: param(),
        type: "sine",
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
        onended: null,
      };
    }
    createBufferSource() {
      return {
        buffer: null,
        connect() {},
        disconnect() {},
        start() {},
        onended: null,
      };
    }
    createBiquadFilter() {
      return {
        frequency: { value: 0 },
        type: "highpass",
        connect() {},
        disconnect() {},
      };
    }
    createBuffer(_channels: number, length: number) {
      return { getChannelData: () => new Float32Array(length) };
    }
  }
  Object.defineProperty(globalThis, "AudioContext", {
    value: FakeContext,
    configurable: true,
  });
  const audio = new AdventureAudio();
  try {
    audio.play("jump");
    assert.equal(contexts.length, 0, "autoplay must not create a context");
    await audio.unlock();
    audio.scene("lobby");
    audio.scene("countdown");
    audio.scene("play");
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0]!.closed, false);
    audio.play("jump");
    const jumpVoices = contexts[0]!.voices;
    assert.equal(jumpVoices, 2);
    audio.play("spring");
    assert.equal(contexts[0]!.voices - jumpVoices, 4);
    const before = contexts[0]!.voices;
    audio.setMuted(true);
    audio.play("finish");
    assert.equal(contexts[0]!.voices, before);
    audio.setMuted(false);
    audio.play("finish");
    assert.equal(contexts[0]!.voices - before, 4);
    await audio.pause();
    assert.equal(contexts[0]!.state, "suspended");
    await audio.unlock();
    assert.equal(contexts[0]!.state, "running");
    audio.dispose();
    assert.equal(contexts[0]!.closed, true);
  } finally {
    audio.dispose();
    if (original) Object.defineProperty(globalThis, "AudioContext", original);
    else Reflect.deleteProperty(globalThis, "AudioContext");
  }
});
