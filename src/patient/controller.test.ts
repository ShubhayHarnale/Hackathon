import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_PROTOCOLS, PRACTICE_STEPS } from "@/demo";
import type { EngineEvent } from "@/engine";
import type { ScenarioName } from "@/vision";
import { PatientController } from "./controller";
import { EvidenceUploader } from "./evidence";
import { EventOutbox } from "./outbox";
import type { EvidenceBody } from "./schema";

const protocol = DEMO_PROTOCOLS.find((p) => p.id === "mock-autoinjector")!;

function setup(scenario: ScenarioName = "happy") {
  const sent: EngineEvent[] = [];
  const evidence: EvidenceBody[] = [];
  const outbox = new EventOutbox({ send: async (events) => (sent.push(...events), "ok") });
  const uploader = new EvidenceUploader({
    send: async (body) => (evidence.push(body), "ok"),
  });
  const controller = new PatientController({
    sessionId: "test",
    steps: protocol.steps,
    practiceSteps: PRACTICE_STEPS,
    vision: { kind: "scripted", scenario },
    capture: async () => ({ base64: "/9j/frame", width: 1, height: 1 }),
    outbox,
    evidence: uploader,
  });
  return { controller, sent, evidence };
}

/** Runs the real procedure, tapping "done" whenever a step asks for it. */
async function runProcedure(controller: PatientController, seconds: number) {
  for (let i = 0; i < seconds * 4; i++) {
    const run = controller.runner.state.run;
    const step = run?.steps[run.index];
    const p = run?.progress[run.index];
    if (step && p && step.verification !== "visual" && !p.verbalOk) {
      controller.command("done", "button");
    }
    await vi.advanceTimersByTimeAsync(250);
  }
}

describe("PatientController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("turns the demo no-response timeout into a needs-human stop", async () => {
    const { controller, sent } = setup("no-response");
    controller.start();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(controller.runner.state.stopReason).toMatchObject({
      kind: "needs_human",
      cause: "step_timeout",
    });
    expect(sent.some((e) => e.type === "needs_human")).toBe(true);
    controller.dispose();
  });

  it("runs practice and the procedure, persisting every event and evidence frame", async () => {
    const { controller, sent, evidence } = setup();
    const seen: EngineEvent[] = [];
    controller.addEngineListener((events) => seen.push(...events));

    controller.startPractice();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(controller.runner.state.practiceCompleted).toBe(true);

    controller.start();
    await runProcedure(controller, 60);
    expect(controller.runner.state.status).toBe("completed");

    await vi.advanceTimersByTimeAsync(1_000); // let the outbox flush
    expect(sent.map((e) => e.eventSeq)).toEqual(seen.map((e) => e.eventSeq));
    expect(sent.at(-1)?.type).toBe("completed");
    // One evidence frame per confirmed real step that had a matching frame.
    const confirmed = sent.filter(
      (e) => e.type === "step_confirmed" && e.run === "real" && e.evidenceSeq !== null,
    );
    expect(evidence).toHaveLength(confirmed.length);
    expect(evidence.every((b) => b.jpegBase64 === "/9j/frame")).toBe(true);

    // The run is over: no more frames or ticks.
    const before = controller.runner.state;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(controller.runner.state).toBe(before);
  });

  it("uploads the critical-miss frame and stops", async () => {
    const { controller, evidence } = setup("skip-critical");
    controller.startPractice();
    await vi.advanceTimersByTimeAsync(8_000);
    controller.start();
    await runProcedure(controller, 30);
    expect(controller.runner.state.stopReason).toMatchObject({
      kind: "critical_miss",
      missedStepId: "clean-site",
    });
    expect(evidence.some((b) => b.stepId === "clean-site")).toBe(true);
  });

  it("maps commands to engine inputs and keeps the snapshot current", async () => {
    const { controller } = setup();
    const repeat = vi.fn();
    controller.onRepeat(repeat);
    controller.command("repeat", "button");
    expect(repeat).toHaveBeenCalledOnce();

    controller.start();
    controller.command("pause", "voice");
    expect(controller.getSnapshot().engine.status).toBe("paused");
    controller.command("continue", "button");
    expect(controller.getSnapshot().engine.status).toBe("active");
    controller.command("call_nurse", "button");
    expect(controller.getSnapshot().engine.pause?.reason).toBe("nurse_called");
    controller.dispose();
  });

  it("shows corrections and clears them when the step moves on", async () => {
    const { controller } = setup("poor-camera");
    controller.start();
    await vi.advanceTimersByTimeAsync(1_500); // "poor-camera": dark frames first
    expect(controller.getSnapshot().correction).toMatchObject({
      stepId: "wash-hands",
      issue: "too_dark",
    });
    await vi.advanceTimersByTimeAsync(5_000); // then clear frames confirm the step
    expect(controller.runner.state.run?.index).toBeGreaterThan(0);
    // The wash-hands correction is gone; any correction now is about the new step.
    expect(controller.getSnapshot().correction?.stepId).not.toBe("wash-hands");
    controller.dispose();
  });

  it("keeps running if a listener throws", async () => {
    const { controller } = setup();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    controller.addEngineListener(() => {
      throw new Error("voice broke");
    });
    expect(() => controller.start()).not.toThrow();
    expect(controller.runner.state.status).toBe("active");
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
    controller.dispose();
  });
});
