import { describe, expect, it } from "vitest";
import { DEMO_PROTOCOLS, PRACTICE_STEPS } from "@/demo";
import { EngineRunner, type EngineEvent } from "@/engine";
import type { EvidenceFrameRecord, FlagReview, StoredEvent } from "@/persistence/types";
import { buildTimeline, describeStop, formatOffset } from "./timeline";

const PROTOCOL = DEMO_PROTOCOLS.find((p) => p.id === "mock-autoinjector")!;

/** Drives the real engine to produce an authentic event log. */
function record(
  script: (r: EngineRunner, clock: { t: number; seq: number }) => void,
): EngineEvent[] {
  const runner = new EngineRunner({ steps: PROTOCOL.steps, practiceSteps: PRACTICE_STEPS });
  const events: EngineEvent[] = [];
  runner.subscribe((e) => events.push(...e));
  script(runner, { t: 1_000_000, seq: 0 });
  return events;
}

function see(r: EngineRunner, c: { t: number; seq: number }, stepId: string, n = 3) {
  for (let i = 0; i < n; i++) {
    c.t += 1000;
    c.seq += 1;
    r.dispatch({
      type: "frame",
      at: c.t,
      seq: c.seq,
      capturedAt: c.t - 200,
      result: { observedStepId: stepId, confidence: 0.95 },
    });
  }
}

function completeTo(r: EngineRunner, c: { t: number; seq: number }, stopAt: string | null) {
  for (const step of PROTOCOL.steps) {
    if (step.id === stopAt) return;
    if (step.verification !== "visual") {
      c.t += 500;
      r.dispatch({ type: "verbal_confirm", at: c.t, stepId: step.id, method: "voice" });
    }
    if (step.verification !== "verbal") see(r, c, step.id, 3 + (step.timerSeconds ?? 0));
  }
}

const stored = (events: EngineEvent[]): StoredEvent[] =>
  events.map((event) => ({ sessionId: "s", event, recordedAt: event.at }));

describe("buildTimeline", () => {
  it("shows every step confirmed for a completed run, ignoring the practice run", () => {
    const events = record((r, c) => {
      r.dispatch({ type: "start_practice", at: c.t });
      for (const s of PRACTICE_STEPS) see(r, c, s.id);
      r.dispatch({ type: "start", at: c.t });
      completeTo(r, c, null);
    });
    const frames: EvidenceFrameRecord[] = [
      {
        id: "f1",
        sessionId: "s",
        stepId: "wash-hands",
        seq: 9,
        capturedAt: 0,
        storagePath: "x",
        visionResult: null,
      },
    ];
    const t = buildTimeline({ protocol: PROTOCOL, events: stored(events), frames, reviews: [] });
    expect(t.rows.map((r) => r.outcome)).toEqual(Array(9).fill("confirmed"));
    expect(t.rows[0]?.evidence?.id).toBe("f1");
    expect(t.rows[6]?.methods).toEqual(["hold"]);
    expect(t.rows[1]?.methods).toEqual(["voice"]);
    expect(t.flags).toEqual([]);
    expect(t.runStartedAt).not.toBeNull();
  });

  it("flags a skipped critical step as critical and marks where it stopped", () => {
    const events = record((r, c) => {
      r.dispatch({ type: "start", at: c.t });
      completeTo(r, c, "clean-site");
      see(r, c, "remove-cap");
    });
    const t = buildTimeline({
      protocol: PROTOCOL,
      events: stored(events),
      frames: [],
      reviews: [],
    });
    expect(t.rows.find((r) => r.step.id === "clean-site")?.outcome).toBe("stopped_here");
    expect(t.rows.find((r) => r.step.id === "remove-cap")?.outcome).toBe("not_reached");
    expect(t.flags).toHaveLength(1);
    expect(t.flags[0]).toMatchObject({
      kind: "critical_miss",
      severity: "critical",
      stepId: "clean-site",
    });
    expect(t.openCritical).toBe(1);
  });

  it("flags non-critical skips, nurse calls and pauses, and counts reviews", () => {
    const events = record((r, c) => {
      r.dispatch({ type: "start", at: c.t });
      see(r, c, "check-expiry"); // skips wash-hands and read-label
      r.dispatch({ type: "call_nurse", at: c.t, source: "voice" });
      r.dispatch({ type: "resume", at: c.t, source: "button" });
      r.dispatch({ type: "pause", at: c.t, source: "button" });
    });
    const flagsOnly = buildTimeline({
      protocol: PROTOCOL,
      events: stored(events),
      frames: [],
      reviews: [],
    });
    expect(flagsOnly.flags.map((f) => f.kind)).toEqual([
      "skipped",
      "skipped",
      "nurse_called",
      "paused",
    ]);
    expect(flagsOnly.rows.slice(0, 2).map((r) => r.outcome)).toEqual(["missed", "missed"]);
    // Info-level flags (a plain pause) don't count as open.
    expect(flagsOnly.openFlags).toBe(3);

    const reviews: FlagReview[] = [
      { sessionId: "s", eventSeq: flagsOnly.flags[0]!.eventSeq, reviewedAt: 1, note: null },
    ];
    const reviewed = buildTimeline({
      protocol: PROTOCOL,
      events: stored(events),
      frames: [],
      reviews,
    });
    expect(reviewed.flags[0]?.review).not.toBeNull();
    expect(reviewed.openFlags).toBe(2);
  });

  it("explains an early hold release", () => {
    const events = record((r, c) => {
      r.dispatch({ type: "start", at: c.t });
      completeTo(r, c, "press-hold");
      see(r, c, "press-hold", 5);
      see(r, c, "remove-pen");
    });
    const t = buildTimeline({
      protocol: PROTOCOL,
      events: stored(events),
      frames: [],
      reviews: [],
    });
    expect(t.flags[0]?.detail).toMatch(/hold ended early/);
    expect(t.rows.find((r) => r.step.id === "press-hold")?.outcome).toBe("stopped_here");
  });
});

describe("formatting", () => {
  it("formats offsets and stop reasons", () => {
    expect(formatOffset(135_400)).toBe("02:15");
    expect(
      describeStop(
        {
          kind: "critical_miss",
          missedStepId: "clean-site",
          observedStepId: "remove-cap",
          cause: "skipped",
        },
        PROTOCOL,
      ),
    ).toBe("Stopped: critical step not confirmed (Clean your thigh with the alcohol swab)");
    expect(describeStop(null, PROTOCOL)).toBeNull();
  });
});
