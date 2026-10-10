import { beforeEach, describe, expect, it } from "vitest";
import { SpeechQueue, type QueuedUtterance } from "./speech-queue";
import { FakeVoiceProvider, flush } from "./test-utils";

const prompt = (key: string, extra: Partial<QueuedUtterance> = {}): QueuedUtterance => ({
  key,
  text: key,
  priority: "prompt",
  ...extra,
});
const correction = (key: string, stepId?: string): QueuedUtterance => ({
  key,
  text: key,
  priority: "correction",
  stepId,
});
const urgent = (key: string): QueuedUtterance => ({ key, text: key, priority: "urgent" });

describe("SpeechQueue", () => {
  let t: number;
  let speaker: FakeVoiceProvider;
  let queue: SpeechQueue;

  beforeEach(() => {
    t = 1_000_000;
    speaker = new FakeVoiceProvider();
    queue = new SpeechQueue({
      speak: (u) => speaker.speak(u),
      cancel: () => speaker.cancel(),
      now: () => t,
    });
  });

  it("plays one utterance at a time, in order", async () => {
    expect(queue.enqueue(prompt("a"))).toBe("playing");
    expect(queue.enqueue(prompt("b"))).toBe("queued");
    expect(queue.enqueue(prompt("c"))).toBe("queued");
    expect(speaker.texts()).toEqual(["a"]);
    await speaker.finish();
    expect(speaker.texts()).toEqual(["a", "b"]);
    await speaker.finish();
    await speaker.finish();
    expect(speaker.texts()).toEqual(["a", "b", "c"]);
    expect(queue.isSpeaking).toBe(false);
  });

  it("urgent interrupts what's playing and clears the queue", async () => {
    queue.enqueue(prompt("a"));
    queue.enqueue(prompt("b"));
    queue.enqueue(correction("fix"));
    expect(queue.enqueue(urgent("stop"))).toBe("playing");
    expect(speaker.cancels).toBe(1);
    expect(speaker.texts()).toEqual(["a", "stop"]);
    await speaker.finishAll();
    expect(speaker.texts()).toEqual(["a", "stop"]);
  });

  it("later prompts wait behind an urgent line instead of cutting it off", async () => {
    queue.enqueue(urgent("stop"));
    queue.enqueue(prompt("after"));
    expect(speaker.cancels).toBe(0);
    await speaker.finish();
    expect(speaker.texts()).toEqual(["stop", "after"]);
  });

  it("doesn't repeat a key within the cooldown, and allows it after", async () => {
    queue.enqueue(correction("too_dark"));
    await speaker.finish();
    t += 5_999;
    expect(queue.enqueue(correction("too_dark"))).toBe("cooldown");
    t += 1;
    expect(queue.enqueue(correction("too_dark"))).toBe("playing");
    expect(speaker.texts()).toEqual(["too_dark", "too_dark"]);
  });

  it("supports a custom cooldown", async () => {
    queue = new SpeechQueue({
      speak: (u) => speaker.speak(u),
      cancel: () => speaker.cancel(),
      now: () => t,
      cooldownMs: 1000,
    });
    queue.enqueue(prompt("x"));
    await speaker.finish();
    t += 999;
    expect(queue.enqueue(prompt("x"))).toBe("cooldown");
    t += 1;
    expect(queue.enqueue(prompt("x"))).toBe("playing");
  });

  it("never queues the same key twice, even when forced", async () => {
    queue.enqueue(prompt("a"));
    expect(queue.enqueue(prompt("b"))).toBe("queued");
    expect(queue.enqueue(prompt("b"))).toBe("duplicate");
    expect(queue.enqueue(prompt("b"), { force: true })).toBe("duplicate");
    expect(queue.enqueue(prompt("a"))).toBe("duplicate");
  });

  it("force skips the cooldown (an explicit repeat)", async () => {
    queue.enqueue(prompt("step"));
    await speaker.finish();
    expect(queue.enqueue(prompt("step"))).toBe("cooldown");
    expect(queue.enqueue(prompt("step"), { force: true })).toBe("playing");
  });

  it("keeps at most one correction waiting; the newest wins", async () => {
    queue.enqueue(prompt("p"));
    queue.enqueue(correction("too_dark"));
    queue.enqueue(correction("too_far"));
    expect(queue.queued.map((u) => u.key)).toEqual(["too_far"]);
    await speaker.finishAll();
    expect(speaker.texts()).toEqual(["p", "too_far"]);
  });

  it("drops queued lines for a step that's over and cuts one that's playing", async () => {
    queue.setStep("s1");
    queue.enqueue(prompt("s1-prompt", { stepId: "s1" }));
    queue.enqueue(correction("too_dark", "s1"));
    queue.enqueue(prompt("good"));
    queue.setStep("s2");
    expect(speaker.cancels).toBe(1);
    expect(speaker.texts()).toEqual(["s1-prompt", "good"]);
    queue.enqueue(prompt("s2-prompt", { stepId: "s2" }));
    await speaker.finishAll();
    expect(speaker.texts()).toEqual(["s1-prompt", "good", "s2-prompt"]);
  });

  it("rejects a line for a step that isn't current", () => {
    queue.setStep("s2");
    expect(queue.enqueue(correction("too_dark", "s1"))).toBe("stale");
    expect(speaker.spoken).toEqual([]);
  });

  it("keeps unscoped lines across a step change", async () => {
    queue.setStep("s1");
    queue.enqueue(prompt("s1-prompt", { stepId: "s1" }));
    queue.enqueue(prompt("good"));
    queue.setStep("s1");
    expect(speaker.cancels).toBe(0);
    await speaker.finishAll();
    expect(speaker.texts()).toEqual(["s1-prompt", "good"]);
  });

  it("drops a line that waited longer than its maxWaitMs", async () => {
    queue.enqueue(prompt("long"));
    queue.enqueue(prompt("three", { maxWaitMs: 500 }));
    queue.enqueue(prompt("next"));
    t += 600;
    await speaker.finishAll();
    expect(speaker.texts()).toEqual(["long", "next"]);
  });

  it("a cancelled line settling late doesn't skip the next one", async () => {
    let resolveFirst: () => void = () => {};
    const spoken: string[] = [];
    let call = 0;
    queue = new SpeechQueue({
      speak: (u) => {
        spoken.push(u.text);
        call += 1;
        // The first line ignores cancel and settles later; the rest never settle.
        return call === 1 ? new Promise((r) => (resolveFirst = r)) : new Promise(() => {});
      },
      cancel: () => {},
      now: () => t,
    });
    queue.enqueue(prompt("a"));
    queue.enqueue(urgent("stop"));
    queue.enqueue(prompt("after"));
    resolveFirst();
    await flush();
    expect(spoken).toEqual(["a", "stop"]);
    expect(queue.current?.key).toBe("stop");
  });

  it("keeps going when the speaker throws or rejects", async () => {
    let call = 0;
    const spoken: string[] = [];
    queue = new SpeechQueue({
      speak: (u) => {
        spoken.push(u.text);
        call += 1;
        if (call === 1) throw new Error("boom");
        if (call === 2) return Promise.reject(new Error("nope"));
        return Promise.resolve();
      },
      cancel: () => {},
      now: () => t,
    });
    queue.enqueue(prompt("a"));
    queue.enqueue(prompt("b"));
    queue.enqueue(prompt("c"));
    await flush();
    expect(spoken).toEqual(["a", "b", "c"]);
  });

  it("interrupt stops and clears; dispose stops accepting", async () => {
    queue.enqueue(prompt("a"));
    queue.enqueue(prompt("b"));
    queue.interrupt();
    expect(speaker.cancels).toBe(1);
    expect(queue.isSpeaking).toBe(false);
    expect(queue.queued).toEqual([]);
    queue.dispose();
    expect(queue.enqueue(prompt("c"))).toBe("disposed");
    await flush();
    expect(speaker.texts()).toEqual(["a"]);
  });

  it("reports each line as it starts", async () => {
    const started: string[] = [];
    queue = new SpeechQueue({
      speak: (u) => speaker.speak(u),
      cancel: () => speaker.cancel(),
      now: () => t,
      onStart: (u) => started.push(u.key),
    });
    queue.enqueue(prompt("a"));
    queue.enqueue(prompt("b"));
    expect(started).toEqual(["a"]);
    await speaker.finish();
    expect(started).toEqual(["a", "b"]);
  });
});
