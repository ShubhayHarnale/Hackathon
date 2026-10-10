import { describe, expect, it, vi } from "vitest";
import type { EngineEvent } from "@/engine";
import { EvidenceUploader } from "./evidence";
import { EventOutbox, outcomeForStatus, retryDelay, type SendOutcome } from "./outbox";

const ev = (eventSeq: number, type: EngineEvent["type"] = "step_activated"): EngineEvent =>
  (type === "stopped"
    ? { type, reason: { kind: "ended", by: "patient" }, eventSeq, at: eventSeq, run: "real" }
    : {
        type: "step_activated",
        stepId: "a",
        index: 0,
        eventSeq,
        at: eventSeq,
        run: "real",
      }) as EngineEvent;

/** Manual timers: run them when the test says so. */
function fakeTimers() {
  const pending: { fn: () => void; ms: number; id: number }[] = [];
  let next = 0;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = ++next;
      pending.push({ fn, ms, id });
      return id;
    },
    clearTimer: (id: unknown) => {
      const i = pending.findIndex((p) => p.id === id);
      if (i >= 0) pending.splice(i, 1);
    },
    pending,
    async runAll() {
      while (pending.length > 0) {
        const p = pending.shift()!;
        p.fn();
        await new Promise((r) => setTimeout(r, 0));
      }
    },
    async runNext() {
      const p = pending.shift();
      p?.fn();
      await new Promise((r) => setTimeout(r, 0));
      return p?.ms;
    },
  };
}

describe("EventOutbox", () => {
  it("batches a burst of events into one request, in order", async () => {
    const timers = fakeTimers();
    const sent: number[][] = [];
    const outbox = new EventOutbox({
      send: async (events) => (sent.push(events.map((e) => e.eventSeq)), "ok"),
      ...timers,
    });
    outbox.push([ev(0), ev(1)]);
    outbox.push([ev(2)]);
    expect(timers.pending).toHaveLength(1);
    expect(timers.pending[0]!.ms).toBe(300);
    await timers.runAll();
    expect(sent).toEqual([[0, 1, 2]]);
    expect(outbox.pending).toBe(0);
  });

  it("sends urgent events (stops, nurse calls) without the debounce", () => {
    const timers = fakeTimers();
    const outbox = new EventOutbox({ send: async () => "ok", ...timers });
    outbox.push([ev(0), ev(1, "stopped")]);
    expect(timers.pending[0]!.ms).toBe(0);
  });

  it("drops duplicate eventSeqs", async () => {
    const timers = fakeTimers();
    const sent: number[][] = [];
    const outbox = new EventOutbox({
      send: async (events) => (sent.push(events.map((e) => e.eventSeq)), "ok"),
      ...timers,
    });
    outbox.push([ev(0), ev(1)]);
    outbox.push([ev(1), ev(2)]);
    await timers.runAll();
    expect(sent).toEqual([[0, 1, 2]]);
  });

  it("retries failures with growing backoff and keeps order", async () => {
    const timers = fakeTimers();
    const outcomes: SendOutcome[] = ["retry", "retry", "ok"];
    const sent: number[][] = [];
    const outbox = new EventOutbox({
      send: async (events) => {
        sent.push(events.map((e) => e.eventSeq));
        return outcomes.shift() ?? "ok";
      },
      retryBaseMs: 1_000,
      ...timers,
    });
    outbox.push([ev(0)]);
    await timers.runNext(); // first attempt fails
    expect(outbox.failureCount).toBe(1);
    outbox.push([ev(1)]); // non-urgent: waits for the backoff timer
    expect(timers.pending.map((p) => p.ms)).toEqual([1_000]);
    await timers.runNext(); // second attempt fails
    expect(timers.pending.map((p) => p.ms)).toEqual([2_000]);
    await timers.runNext(); // succeeds
    expect(sent).toEqual([[0], [0, 1], [0, 1]]);
    expect(outbox.pending).toBe(0);
    expect(outbox.failureCount).toBe(0);
  });

  it("never throws when the transport throws, and drops batches the server rejects", async () => {
    const timers = fakeTimers();
    const send = vi
      .fn<(events: readonly EngineEvent[]) => Promise<SendOutcome>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce("drop");
    const outbox = new EventOutbox({ send, ...timers });
    outbox.push([ev(0)]);
    await timers.runNext();
    expect(outbox.pending).toBe(1); // kept for retry
    await timers.runNext();
    expect(outbox.pending).toBe(0); // dropped, not wedged
  });

  it("splits large queues into batches", async () => {
    const timers = fakeTimers();
    const sizes: number[] = [];
    const outbox = new EventOutbox({
      send: async (events) => (sizes.push(events.length), "ok"),
      maxBatch: 2,
      ...timers,
    });
    outbox.push([ev(0), ev(1), ev(2), ev(3), ev(4)]);
    await timers.runAll();
    expect(sizes).toEqual([2, 2, 1]);
  });

  it("caps the backoff and maps HTTP statuses", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => retryDelay(n, 1_000, 15_000))).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000,
    ]);
    expect(outcomeForStatus(200)).toBe("ok");
    expect(outcomeForStatus(429)).toBe("retry");
    expect(outcomeForStatus(503)).toBe("retry");
    expect(outcomeForStatus(400)).toBe("drop");
    expect(outcomeForStatus(404)).toBe("drop");
  });
});

describe("EvidenceUploader", () => {
  it("uploads each frame once, retries a few times, then gives up", async () => {
    const timers = fakeTimers();
    const send = vi.fn(async () => "retry" as const);
    const uploader = new EvidenceUploader({ send, maxAttempts: 3, setTimer: timers.setTimer });
    const frame = { stepId: "a", seq: 4, capturedAt: 1, base64: "/9j/AA", visionResult: null };
    uploader.upload(frame);
    uploader.upload(frame);
    await new Promise((r) => setTimeout(r, 0));
    await timers.runAll();
    expect(send).toHaveBeenCalledTimes(3);
    uploader.upload({ ...frame, base64: "" }); // nothing captured: skipped
    expect(send).toHaveBeenCalledTimes(3);
  });
});
