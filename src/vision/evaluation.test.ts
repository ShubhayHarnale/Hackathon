import { describe, expect, it } from "vitest";
import type { Protocol } from "@/protocol/schema";
import { evaluateRecording, type RecordingFrame } from "./evaluation";
import { VisionError } from "./errors";
import type { VisionCheckRequest, VisionProvider } from "./types";

const protocol: Protocol = {
  id: "eval-prop",
  title: "Synthetic evaluation",
  isDemo: true,
  steps: [
    {
      id: "first",
      order: 1,
      instruction: "First",
      spokenPrompt: "First",
      successCriteria: "First visible",
      critical: true,
      verification: "visual",
    },
    {
      id: "second",
      order: 2,
      instruction: "Second",
      spokenPrompt: "Second",
      successCriteria: "Spoken",
      critical: false,
      verification: "verbal",
    },
    {
      id: "third",
      order: 3,
      instruction: "Third",
      spokenPrompt: "Third",
      successCriteria: "Third visible",
      critical: true,
      verification: "visual",
      timerSeconds: 2,
    },
  ],
};
const frame = (i: number, observedStepId: string): RecordingFrame => ({
  file: `${i}.jpg`,
  atMs: i * 1000,
  observedStepId,
});
const evaluate = (frames: RecordingFrame[], check: VisionProvider["check"]) =>
  evaluateRecording({
    protocol,
    frames,
    provider: { name: "test", check },
    readImage: async (file) => file,
  });

describe("recording evaluation", () => {
  it("never lets ground truth choose the expected step; three later verdicts stop at the missed critical step", async () => {
    const requests: VisionCheckRequest[] = [];
    const report = await evaluate(
      [0, 1, 2, 3].map((i) => frame(i, "second")),
      async (r) => {
        requests.push(r);
        return { observedStepId: "second", confidence: 1 };
      },
    );
    expect(requests.map((r) => r.currentStep.id)).toEqual(["first", "first", "first"]);
    expect(report.outcome).toBe("stopped");
    expect(report.stopReason?.kind).toBe("critical_miss");
    expect(report.rows[3]?.status).toBe("terminal");
    expect(report.attemptedFrames).toBe(3);
  });
  it("requires explicit verbal actions and ongoing matching frames to complete", async () => {
    const frames = [0, 1, 2].map((i) => frame(i, "first"));
    frames.push({ ...frame(3, "third"), commands: [{ type: "done", stepId: "second" }] });
    frames.push(...[4, 5, 6, 7].map((i) => frame(i, "third")));
    const report = await evaluate(frames, async (r) => ({
      observedStepId: r.currentStep.id,
      confidence: 1,
    }));
    expect(report.outcome).toBe("completed");
    expect(report.steps.every((s) => s.status === "confirmed")).toBe(true);
    expect(report.accuracy).toBe(1);
  });
  it("does not auto-confirm verbal requirements from a label", async () => {
    const report = await evaluate(
      [0, 1, 2, 3, 4, 5].map((i) => frame(i, i < 3 ? "first" : "second")),
      async (r) => ({ observedStepId: r.currentStep.id, confidence: 1 }),
    );
    expect(report.outcome).toBe("active");
    expect(report.steps[1]?.status).toBe("active");
  });
  it("keeps provider errors in accuracy and recall denominators", async () => {
    const report = await evaluate([frame(0, "first"), frame(1, "first")], async (r) => {
      if (r.seq === 2) throw new VisionError("timeout", "private provider details");
      return { observedStepId: "first", confidence: 1 };
    });
    expect(report.errors).toBe(1);
    expect(report.accuracy).toBe(0.5);
    expect(report.currentStepRecall).toBe(0.5);
    expect(report.rows[1]?.error).toBe("timeout");
    expect(JSON.stringify(report)).not.toContain("private provider details");
  });
  it("scores false later verdicts against independent annotations", async () => {
    const report = await evaluate(
      [0, 1, 2].map((i) => frame(i, "first")),
      async () => ({ observedStepId: "second", confidence: 1 }),
    );
    expect(report.falseLaterRate).toBe(1);
    expect(report.accuracy).toBe(0);
    expect(report.stopReason?.kind).toBe("critical_miss");
  });
  it("ignores frames during an explicit pause", async () => {
    const report = await evaluate(
      [
        frame(0, "first"),
        { ...frame(1, "first"), commands: [{ type: "pause" }] },
        frame(2, "first"),
        { ...frame(3, "first"), commands: [{ type: "resume" }] },
      ],
      async () => ({ observedStepId: "first", confidence: 1 }),
    );
    expect(report.rows.map((r) => r.status)).toEqual(["checked", "paused", "paused", "checked"]);
    expect(report.attemptedFrames).toBe(2);
  });
  it("rejects invalid annotations before making model calls", async () => {
    let calls = 0;
    const check = async () => {
      calls++;
      return { observedStepId: null, confidence: 0 };
    };
    await expect(evaluate([frame(0, "invented")], check)).rejects.toThrow("unknown label");
    await expect(evaluate([frame(1, "first"), frame(0, "first")], check)).rejects.toThrow(
      "timestamps",
    );
    expect(calls).toBe(0);
  });
});
