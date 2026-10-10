import { describe, expect, it } from "vitest";
import { PRACTICE_STEPS } from "@/demo";
import { EngineRunner, type EngineInput, type EngineStep } from "@/engine";
import {
  awaitingDone,
  deriveScreen,
  describeDuration,
  formatCountdown,
  progressDots,
  stepTimer,
  telHref,
  type ScreenInput,
} from "./screen";

const STEPS: readonly EngineStep[] = [
  { id: "a", order: 1, critical: false, verification: "visual" },
  { id: "say", order: 2, critical: false, verification: "verbal" },
  { id: "hold", order: 3, critical: true, verification: "visual", timerSeconds: 10 },
  { id: "wait", order: 4, critical: false, verification: "verbal", timerSeconds: 5 },
];

function runner() {
  return new EngineRunner({ steps: STEPS, practiceSteps: PRACTICE_STEPS });
}

let seq = 0;
const see = (r: EngineRunner, stepId: string | null, at: number) =>
  r.dispatch({
    type: "frame",
    at,
    seq: ++seq,
    capturedAt: at,
    result: { observedStepId: stepId, confidence: 0.95 },
  });
const seeN = (r: EngineRunner, stepId: string, from: number, n = 3) => {
  for (let i = 0; i < n; i++) see(r, stepId, from + i * 1000);
};
const dispatch = (r: EngineRunner, input: EngineInput) => r.dispatch(input);

const screen = (r: EngineRunner, over: Partial<ScreenInput> = {}) =>
  deriveScreen({
    phase: "camera_check",
    camera: "granted",
    visionMode: "server",
    engine: r.state,
    ...over,
  }).kind;

describe("deriveScreen", () => {
  it("walks welcome -> permissions -> camera check -> ready -> step", () => {
    const r = runner();
    expect(screen(r, { phase: "welcome" })).toBe("welcome");
    expect(screen(r, { phase: "permissions", camera: "requesting" })).toBe("permissions");
    expect(screen(r)).toBe("camera_check");

    dispatch(r, { type: "start_practice", at: 0 });
    expect(screen(r)).toBe("camera_check");
    seeN(r, "practice-show-hands", 100);
    seeN(r, "practice-show-pen", 4_000);
    expect(r.state.practiceCompleted).toBe(true);
    expect(screen(r)).toBe("ready");

    dispatch(r, { type: "start", at: 10_000 });
    expect(screen(r)).toBe("step");
  });

  it("blocks on a denied camera only when vision needs the camera", () => {
    const r = runner();
    expect(screen(r, { phase: "permissions", camera: "denied" })).toBe("camera_denied");
    expect(screen(r, { phase: "camera_check", camera: "unavailable" })).toBe("camera_denied");
    expect(screen(r, { camera: "denied", visionMode: "scripted" })).toBe("camera_check");
    expect(screen(r, { phase: "welcome", camera: "denied" })).toBe("welcome");
  });

  it("shows pause, nurse and vision-unavailable pauses distinctly", () => {
    const r = runner();
    dispatch(r, { type: "start", at: 0 });
    dispatch(r, { type: "pause", at: 10, source: "button" });
    expect(
      deriveScreen({
        phase: "camera_check",
        camera: "granted",
        visionMode: "server",
        engine: r.state,
      }),
    ).toEqual({
      kind: "paused",
      reason: "user",
    });
    dispatch(r, { type: "resume", at: 20, source: "button" });
    dispatch(r, { type: "call_nurse", at: 30, source: "button" });
    expect(
      deriveScreen({
        phase: "camera_check",
        camera: "granted",
        visionMode: "server",
        engine: r.state,
      }),
    ).toEqual({
      kind: "paused",
      reason: "nurse_called",
    });
    dispatch(r, { type: "resume", at: 40, source: "button" });
    for (let i = 0; i < 5; i++) {
      dispatch(r, { type: "frame_error", at: 50 + i, seq: ++seq, kind: "timeout" });
    }
    expect(screen(r)).toBe("vision_unavailable");
  });

  it("ends on completed or stopped, whatever the UI phase", () => {
    const done = new EngineRunner({ steps: [STEPS[0]!] });
    dispatch(done, { type: "start", at: 0 });
    seeN(done, "a", 100);
    expect(screen(done, { phase: "welcome" })).toBe("completed");

    const stopped = runner();
    dispatch(stopped, { type: "start", at: 0 });
    seeN(stopped, "a", 100);
    dispatch(stopped, { type: "verbal_confirm", at: 4_000, stepId: "say", method: "tap" });
    seeN(stopped, "wait", 5_000); // skips the critical hold
    const s = deriveScreen({
      phase: "camera_check",
      camera: "granted",
      visionMode: "server",
      engine: stopped.state,
    });
    expect(s).toMatchObject({
      kind: "stopped",
      reason: { kind: "critical_miss", missedStepId: "hold", cause: "skipped" },
    });
  });
});

describe("step helpers", () => {
  it("counts a hold down only while it is held, and a wait from the start", () => {
    const r = runner();
    dispatch(r, { type: "start", at: 0 });
    expect(stepTimer(r.state)).toEqual({ kind: "none" });
    seeN(r, "a", 100);

    expect(awaitingDone(r.state)).toBe(true);
    dispatch(r, { type: "verbal_confirm", at: 3_500, stepId: "say", method: "tap" });
    expect(awaitingDone(r.state)).toBe(false);

    expect(stepTimer(r.state)).toEqual({ kind: "hold_pending", totalMs: 10_000 });
    seeN(r, "hold", 4_000); // holding from 6_000
    dispatch(r, { type: "tick", at: 9_000 });
    expect(stepTimer(r.state)).toEqual({ kind: "holding", remainingMs: 7_000, totalMs: 10_000 });
    for (let t = 7_000; t <= 16_000; t += 1_000) see(r, "hold", t);
    dispatch(r, { type: "tick", at: 16_000 });

    // Now on the wait step, activated at 16_000.
    dispatch(r, { type: "tick", at: 18_000 });
    expect(stepTimer(r.state)).toEqual({ kind: "wait", remainingMs: 3_000, totalMs: 5_000 });
  });

  it("draws progress dots for the real run only", () => {
    const r = runner();
    dispatch(r, { type: "start_practice", at: 0 });
    expect(progressDots(r.state)).toEqual([]);

    const real = runner();
    dispatch(real, { type: "start", at: 0 });
    seeN(real, "a", 100);
    expect(progressDots(real.state)).toEqual(["done", "current", "todo", "todo"]);
  });
});

describe("formatting", () => {
  it("rounds countdowns up so 0 only shows when time is up", () => {
    expect(formatCountdown(10_000)).toBe("10");
    expect(formatCountdown(9_001)).toBe("10");
    expect(formatCountdown(9_000)).toBe("9");
    expect(formatCountdown(1)).toBe("1");
    expect(formatCountdown(0)).toBe("0");
    expect(formatCountdown(-50)).toBe("0");
    expect(formatCountdown(65_000)).toBe("1:05");
    expect(formatCountdown(600_000)).toBe("10:00");
  });

  it("describes durations in words", () => {
    expect(describeDuration(1_000)).toBe("1 second");
    expect(describeDuration(7_200)).toBe("8 seconds");
    expect(describeDuration(60_000)).toBe("1 minute");
    expect(describeDuration(125_000)).toBe("2 minutes 5 seconds");
  });

  it("builds tel: links from display numbers", () => {
    expect(telHref("+1-555-0100")).toBe("tel:+15550100");
    expect(telHref("(555) 010 0100")).toBe("tel:5550100100");
  });
});
