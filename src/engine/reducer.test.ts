import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "./config";
import { transition } from "./reducer";
import { createEngineState } from "./state";
import { DEMO_STEPS, Sim, deepFreeze } from "./test-utils";
import type { EngineStep } from "./types";

describe("setup", () => {
  it("rejects empty or duplicate steps", () => {
    expect(() => createEngineState([])).toThrow(/empty/);
    const [first] = DEMO_STEPS;
    if (!first) throw new Error("fixture");
    expect(() => createEngineState([first, first])).toThrow(/duplicate/);
  });

  it("starts idle and ignores frames before start", () => {
    const sim = new Sim();
    expect(sim.status).toBe("idle");
    expect(sim.frames("wash-hands", 5)).toEqual([]);
  });
});

describe("happy path", () => {
  it("confirms every step in order and completes", () => {
    const sim = new Sim();
    sim.start();
    while (sim.status === "active") sim.completeCurrent();

    expect(sim.status).toBe("completed");
    const confirmed = sim.events.filter((e) => e.type === "step_confirmed");
    expect(confirmed.map((e) => e.stepId)).toEqual(DEMO_STEPS.map((s) => s.id));
    expect(sim.types().at(-1)).toBe("completed");
    expect(sim.types()).not.toContain("critical_miss");
    expect(sim.types()).not.toContain("needs_human");
  });

  it("records how each step was confirmed and which frame is the evidence", () => {
    const sim = new Sim();
    sim.start();
    sim.advanceTo("sharps");
    const byStep = new Map(
      sim.events.flatMap((e) => (e.type === "step_confirmed" ? [[e.stepId, e] as const] : [])),
    );
    expect(byStep.get("wash-hands")?.methods).toEqual(["visual"]);
    expect(byStep.get("read-label")?.methods).toEqual(["voice"]);
    expect(byStep.get("read-label")?.evidenceSeq).toBeNull();
    expect(byStep.get("check-expiry")?.methods).toEqual(["voice", "visual"]);
    expect(byStep.get("press-hold")?.methods).toEqual(["hold"]);
    expect(byStep.get("wash-hands")?.evidenceSeq).toBe(3);
  });

  it("gives every event a strictly increasing eventSeq", () => {
    const sim = new Sim();
    sim.start();
    while (sim.status === "active") sim.completeCurrent();
    const seqs = sim.events.map((e) => e.eventSeq);
    expect(seqs).toEqual(seqs.map((_, i) => i));
  });
});

describe("frame matching", () => {
  it("needs 3 consecutive matching frames (flicker resets the streak)", () => {
    const sim = new Sim();
    sim.start();
    sim.frames("wash-hands", 2);
    sim.frame(null);
    sim.frames("wash-hands", 2);
    expect(sim.progress("wash-hands").status).toBe("active");
    sim.frame("wash-hands");
    expect(sim.progress("wash-hands").status).toBe("confirmed");
  });

  it("does not count frames below the confidence threshold", () => {
    const sim = new Sim();
    sim.start();
    sim.frames("wash-hands", 10, { confidence: 0.69 });
    expect(sim.progress("wash-hands").status).toBe("active");
    sim.frames("wash-hands", 3, { confidence: 0.7 });
    expect(sim.progress("wash-hands").status).toBe("confirmed");
  });

  it("a frame of an earlier step resets the streak", () => {
    const sim = new Sim();
    sim.start();
    sim.advanceTo("clean-site");
    sim.frames("clean-site", 2);
    sim.frame("wash-hands");
    sim.frame("clean-site");
    expect(sim.progress("clean-site").status).toBe("active");
  });

  it("ignores stale results that arrive out of order", () => {
    const sim = new Sim();
    sim.start();
    sim.frames("wash-hands", 2);
    const events = sim.send({
      type: "frame",
      at: sim.t + 100,
      seq: 1, // older than the last processed frame
      capturedAt: sim.t,
      result: { observedStepId: "wash-hands", confidence: 0.99 },
    });
    expect(events).toEqual([]);
    expect(sim.progress("wash-hands").matchStreak).toBe(2);
  });

  it("ignores frames captured before the current step began", () => {
    const sim = new Sim();
    sim.start();
    sim.completeCurrent(); // wash-hands confirmed; read-label now current
    sim.say("read-label"); // check-expiry now current
    // In-flight frames captured before check-expiry was activated must not count.
    sim.frames("check-expiry", 3, { latencyMs: 5_000, dtMs: 100 });
    expect(sim.progress("check-expiry").matchStreak).toBe(0);
    sim.frames("check-expiry", 3);
    expect(sim.progress("check-expiry").visualOk).toBe(true);
  });

  it("emits a correction for each frame issue code", () => {
    const sim = new Sim();
    sim.start();
    const events = sim.frame(null, { issue: "hands_not_visible", confidence: 0.2 });
    expect(events).toMatchObject([
      { type: "correction", stepId: "wash-hands", issue: "hands_not_visible" },
    ]);
  });
});

describe("skipped critical steps", () => {
  it("stops with critical_miss when a later step is seen 3 times before a critical step", () => {
    const sim = new Sim();
    sim.start();
    sim.advanceTo("clean-site");
    sim.frames("remove-cap", 3);

    expect(sim.status).toBe("stopped");
    expect(sim.state.stopReason).toEqual({
      kind: "critical_miss",
      missedStepId: "clean-site",
      observedStepId: "remove-cap",
      cause: "skipped",
    });
    expect(sim.last("critical_miss")?.evidenceSeq).toBe(sim.seq);
    expect(sim.types().slice(-2)).toEqual(["critical_miss", "stopped"]);
  });

  it("tolerates 1-2 stray frames of a later step (flicker)", () => {
    const sim = new Sim();
    sim.start();
    sim.advanceTo("clean-site");
    sim.frames("remove-cap", 2);
    sim.frame("clean-site");
    sim.frames("remove-cap", 2);
    expect(sim.status).toBe("active");
    sim.frames("clean-site", 3);
    expect(sim.progress("clean-site").status).toBe("confirmed");
  });

  it("does not combine observations of different later steps", () => {
    const sim = new Sim();
    sim.start();
    sim.advanceTo("clean-site");
    for (let i = 0; i < 6; i++) sim.frame(i % 2 ? "remove-cap" : "place-pen");
    expect(sim.status).toBe("active");
  });

  it("detects a jump over several steps that includes a critical one", () => {
    const sim = new Sim();
    sim.start();
    sim.advanceTo("read-label");
    sim.frames("place-pen", 3);
    expect(sim.state.stopReason).toMatchObject({
      kind: "critical_miss",
      missedStepId: "clean-site",
      observedStepId: "place-pen",
    });
  });

  it("stops if a critical step is visually done but not verbally confirmed", () => {
    const steps: EngineStep[] = [
      { id: "a", order: 1, critical: true, verification: "visual+verbal" },
      { id: "b", order: 2, critical: false, verification: "visual" },
    ];
    const sim = new Sim(steps);
    sim.start();
    sim.frames("a", 3);
    sim.frames("b", 3);
    expect(sim.state.stopReason).toMatchObject({ kind: "critical_miss", missedStepId: "a" });
  });
});

describe("skipped non-critical steps", () => {
  it("flags the skipped steps for review and follows the patient forward", () => {
    const sim = new Sim();
    sim.start();
    sim.frames("check-expiry", 3); // skips wash-hands and read-label

    expect(sim.status).toBe("active");
    expect(sim.current).toBe("check-expiry");
    expect(sim.progress("wash-hands").status).toBe("missed");
    expect(sim.progress("read-label").flags).toEqual(["skipped"]);
    expect(sim.events.filter((e) => e.type === "step_missed").map((e) => e.stepId)).toEqual([
      "wash-hands",
      "read-label",
    ]);
    // The frames that revealed the skip count as evidence for check-expiry.
    expect(sim.progress("check-expiry").visualOk).toBe(true);
    sim.say("check-expiry");
    expect(sim.progress("check-expiry").status).toBe("confirmed");
  });
});

describe("timed hold (press and hold 10 seconds)", () => {
  function atHold() {
    const sim = new Sim();
    sim.start();
    sim.advanceTo("press-hold");
    sim.frames("press-hold", 3);
    expect(sim.progress("press-hold").status).toBe("holding");
    return sim;
  }

  it("confirms once the step has been held for the full timer", () => {
    const sim = atHold();
    sim.frames("press-hold", 9);
    expect(sim.progress("press-hold").status).toBe("holding");
    expect(sim.progress("press-hold").holdMs).toBe(9000);
    sim.frame("press-hold");
    expect(sim.progress("press-hold").status).toBe("confirmed");
    expect(sim.current).toBe("remove-pen");
  });

  it("completes the hold on a tick even between frames", () => {
    const sim = atHold();
    sim.tick(10_000);
    expect(sim.progress("press-hold").status).toBe("confirmed");
  });

  it("releasing early on a critical hold is a critical miss", () => {
    const sim = atHold();
    sim.frames("press-hold", 4);
    sim.frames("remove-pen", 3);
    expect(sim.state.stopReason).toEqual({
      kind: "critical_miss",
      missedStepId: "press-hold",
      observedStepId: "remove-pen",
      cause: "hold_released_early",
    });
  });

  it("losing sight of a critical hold routes to a human", () => {
    const sim = atHold();
    sim.frames(null, 2, { confidence: 0.3 });
    expect(sim.status).toBe("active");
    sim.frame(null, { confidence: 0.3 });
    expect(sim.state.stopReason).toEqual({
      kind: "needs_human",
      stepId: "press-hold",
      cause: "hold_interrupted",
    });
  });

  it("a non-critical hold restarts, then routes to a human after max attempts", () => {
    const steps: EngineStep[] = [
      { id: "scrub", order: 1, critical: false, verification: "visual", timerSeconds: 20 },
      { id: "dry", order: 2, critical: false, verification: "visual" },
    ];
    const sim = new Sim(steps);
    sim.start();
    for (let attempt = 1; attempt <= 2; attempt++) {
      sim.frames("scrub", 3);
      sim.frames("scrub", 5);
      sim.frames(null, 3);
      expect(sim.last("hold_interrupted")?.attempts).toBe(attempt);
      expect(sim.progress("scrub")).toMatchObject({ status: "active", holdMs: 0 });
    }
    sim.frames("scrub", 3);
    sim.frames(null, 3);
    expect(sim.state.stopReason).toMatchObject({ kind: "needs_human", cause: "too_many_attempts" });
  });
});

describe("pause and resume", () => {
  it("freezes step and hold timers while paused", () => {
    const sim = new Sim();
    sim.start();
    sim.advanceTo("press-hold");
    sim.frames("press-hold", 3);
    sim.frames("press-hold", 4);
    const before = { ...sim.progress("press-hold") };

    sim.pause();
    sim.tick(60_000);
    sim.frames("remove-pen", 5); // ignored while paused
    expect(sim.status).toBe("paused");
    expect(sim.progress("press-hold").holdMs).toBe(before.holdMs);
    expect(sim.progress("press-hold").activeMs).toBe(before.activeMs);

    sim.resume();
    sim.frames("press-hold", 6);
    expect(sim.progress("press-hold").status).toBe("confirmed");
  });

  it("flags a pause during a critical hold for review", () => {
    const sim = new Sim();
    sim.start();
    sim.advanceTo("press-hold");
    sim.frames("press-hold", 3);
    sim.pause();
    expect(sim.progress("press-hold").flags).toContain("interrupted_hold");
    expect(sim.last("flagged")).toMatchObject({ stepId: "press-hold", flag: "interrupted_hold" });
  });

  it("only an explicit resume leaves a pause", () => {
    const sim = new Sim();
    sim.start();
    sim.pause("voice");
    sim.frames("wash-hands", 5);
    sim.say("wash-hands");
    sim.tick(1_000_000);
    sim.pause();
    expect(sim.status).toBe("paused");
    expect(sim.progress("wash-hands").status).toBe("active");
    sim.resume("voice");
    expect(sim.status).toBe("active");
    expect(sim.types().filter((t) => t === "paused")).toHaveLength(1);
  });

  it("does not join frames from before and after a pause into one streak", () => {
    const sim = new Sim();
    sim.start();
    sim.frames("wash-hands", 2);
    sim.pause();
    sim.resume();
    sim.frame("wash-hands");
    expect(sim.progress("wash-hands").status).toBe("active");
    sim.frames("wash-hands", 2);
    expect(sim.progress("wash-hands").status).toBe("confirmed");
  });

  it("call my nurse pauses, flags the step, and can be resumed", () => {
    const sim = new Sim();
    sim.start();
    sim.callNurse("voice");
    expect(sim.status).toBe("paused");
    expect(sim.state.pause?.reason).toBe("nurse_called");
    expect(sim.progress("wash-hands").flags).toEqual(["nurse_called"]);
    expect(sim.types()).toEqual(expect.arrayContaining(["nurse_called", "flagged", "paused"]));
    sim.resume();
    expect(sim.status).toBe("active");
  });
});

describe("needs_human", () => {
  it("after too many frames that don't show the step", () => {
    const max = DEFAULT_ENGINE_CONFIG.maxUnmatchedFrames;
    const sim = new Sim();
    sim.start();
    sim.frames(null, max - 1, { confidence: 0.4 });
    expect(sim.status).toBe("active");
    sim.frame(null, { confidence: 0.4 });
    expect(sim.state.stopReason).toEqual({
      kind: "needs_human",
      stepId: "wash-hands",
      cause: "too_many_unmatched_frames",
    });
    expect(sim.types().slice(-2)).toEqual(["needs_human", "stopped"]);
  });

  it("counts unmatched frames per step", () => {
    const sim = new Sim(DEMO_STEPS, { config: { maxUnmatchedFrames: 5 } });
    sim.start();
    sim.frames(null, 4);
    sim.frames("wash-hands", 3);
    sim.say("read-label");
    sim.frames(null, 4);
    expect(sim.status).toBe("active");
  });

  it("when a step takes too long (paused time excluded)", () => {
    const sim = new Sim();
    sim.start();
    sim.completeCurrent(); // read-label (verbal) is now current
    sim.tick(100_000);
    sim.pause();
    sim.tick(10_000_000);
    sim.resume();
    sim.tick(139_000);
    expect(sim.status).toBe("active");
    sim.tick(1_000);
    expect(sim.state.stopReason).toMatchObject({
      kind: "needs_human",
      stepId: "read-label",
      cause: "step_timeout",
    });
  });
});

describe("vision outages", () => {
  it("pauses after repeated errors and requires an explicit resume after recovery", () => {
    const sim = new Sim();
    sim.start();
    for (let i = 0; i < 4; i++) sim.error();
    expect(sim.status).toBe("active");
    sim.error();
    expect(sim.status).toBe("paused");
    expect(sim.state.pause).toMatchObject({ source: "system", reason: "vision_unavailable" });
    expect(sim.types()).toContain("vision_degraded");

    sim.frame("wash-hands");
    expect(sim.last("vision_recovered")).toBeDefined();
    expect(sim.status).toBe("paused");
    sim.resume();
    expect(sim.status).toBe("active");
  });

  it("routes to a human if the outage lasts too long", () => {
    const sim = new Sim();
    sim.start();
    for (let i = 0; i < 5; i++) sim.error(); // the outage clock starts at the first error
    sim.tick(DEFAULT_ENGINE_CONFIG.visionOutageMs - 4_000 - 1);
    expect(sim.status).toBe("paused");
    sim.tick(1);
    expect(sim.state.stopReason).toMatchObject({ kind: "needs_human", cause: "vision_outage" });
  });

  it("a successful frame resets the error count", () => {
    const sim = new Sim();
    sim.start();
    for (let i = 0; i < 4; i++) sim.error();
    sim.frame(null);
    for (let i = 0; i < 4; i++) sim.error();
    expect(sim.status).toBe("active");
  });
});

describe("verbal and wait steps", () => {
  it("verbal steps confirm only on a verbal confirm for the current step", () => {
    const sim = new Sim();
    sim.start();
    sim.completeCurrent();
    sim.frames("read-label", 5);
    sim.say("check-expiry"); // not the current step
    expect(sim.progress("read-label").status).toBe("active");
    sim.say("read-label", "tap");
    expect(sim.progress("read-label")).toMatchObject({ status: "confirmed", methods: ["tap"] });
  });

  it("visual+verbal steps need both, in either order", () => {
    const sim = new Sim();
    sim.start();
    sim.advanceTo("check-expiry");
    sim.frames("check-expiry", 3);
    expect(sim.progress("check-expiry").status).toBe("active");
    sim.say("check-expiry");
    expect(sim.progress("check-expiry")).toMatchObject({
      status: "confirmed",
      methods: ["visual", "voice"],
    });
  });

  it("a verbal wait step needs the timer and the confirmation", () => {
    const steps: EngineStep[] = [
      { id: "warm-up", order: 1, critical: false, verification: "verbal", timerSeconds: 30 },
      { id: "next", order: 2, critical: false, verification: "visual" },
    ];
    const sim = new Sim(steps);
    sim.start();
    sim.say("warm-up");
    sim.tick(20_000);
    expect(sim.progress("warm-up").status).toBe("active");
    sim.tick(10_000);
    expect(sim.progress("warm-up")).toMatchObject({
      status: "confirmed",
      methods: ["voice", "wait"],
    });
  });
});

describe("practice run", () => {
  it("runs the practice steps, returns to idle, then starts the real run", () => {
    const sim = new Sim();
    sim.startPractice();
    expect(sim.status).toBe("practice");
    expect(sim.current).toBe("show-hands");
    sim.completeCurrent();
    sim.completeCurrent();
    expect(sim.status).toBe("idle");
    expect(sim.state.practiceCompleted).toBe(true);
    expect(sim.events.every((e) => e.run === "practice")).toBe(true);

    sim.start();
    expect(sim.status).toBe("active");
    expect(sim.current).toBe("wash-hands");
    expect(sim.last("run_started")?.run).toBe("real");
  });

  it("can be paused and resumed like the real run", () => {
    const sim = new Sim();
    sim.startPractice();
    sim.pause();
    expect(sim.state.pause?.resumeTo).toBe("practice");
    sim.resume();
    expect(sim.status).toBe("practice");
  });
});

describe("terminal states", () => {
  it("stopped and completed states ignore all further input", () => {
    const sim = new Sim();
    sim.start();
    sim.stop("patient");
    expect(sim.state.stopReason).toEqual({ kind: "ended", by: "patient" });
    const frozen = sim.state;
    for (const input of [
      { type: "resume", at: sim.t, source: "button" },
      { type: "start", at: sim.t },
      {
        type: "frame",
        at: sim.t,
        seq: 99,
        capturedAt: sim.t,
        result: { observedStepId: "wash-hands", confidence: 1 },
      },
      { type: "call_nurse", at: sim.t, source: "voice" },
    ] as const) {
      expect(sim.send(input)).toEqual([]);
      expect(sim.state).toBe(frozen);
    }
  });
});

describe("purity", () => {
  it("never mutates the input state", () => {
    let state = deepFreeze(createEngineState(DEMO_STEPS));
    const at = 1_000;
    ({ state } = transition(state, { type: "start", at }));
    deepFreeze(state);
    for (let seq = 1; seq <= 3; seq++) {
      const next = transition(state, {
        type: "frame",
        at: at + seq * 1000,
        seq,
        capturedAt: at + seq * 1000,
        result: { observedStepId: "wash-hands", confidence: 0.9 },
      });
      state = deepFreeze(next.state);
    }
    expect(state.run?.progress[0]?.status).toBe("confirmed");
  });
});
