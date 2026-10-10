import { describe, expect, it } from "vitest";
import type { EngineEvent } from "@/engine";
import { sessionPatchFor } from "./session-status";

const created = { status: "created" as const, startedAt: null, endedAt: null };

const e = (eventSeq: number, body: Record<string, unknown>, run: "practice" | "real" = "real") =>
  ({ ...body, eventSeq, at: 1_000 + eventSeq, run }) as EngineEvent;

describe("sessionPatchFor", () => {
  it("tracks practice, the real run and its start time", () => {
    expect(sessionPatchFor(created, [e(0, { type: "practice_started" }, "practice")])).toEqual({
      status: "practice",
    });
    expect(
      sessionPatchFor({ ...created, status: "practice" }, [
        e(5, { type: "run_started" }),
        e(6, { type: "step_activated", stepId: "a", index: 0 }),
      ]),
    ).toEqual({ status: "active", startedAt: 1_005 });
  });

  it("follows pause and resume back to the right run", () => {
    const active = { ...created, status: "active" as const, startedAt: 1 };
    expect(
      sessionPatchFor(active, [e(9, { type: "paused", source: "button", reason: "user" })]),
    ).toEqual({ status: "paused" });
    expect(
      sessionPatchFor({ ...active, status: "paused" }, [
        e(10, { type: "resumed", source: "button" }, "practice"),
      ]),
    ).toEqual({ status: "practice" });
  });

  it("records the stop reason and end time, and never reopens a finished session", () => {
    const reason = { kind: "needs_human", stepId: "a", cause: "step_timeout" };
    const patch = sessionPatchFor({ ...created, status: "active", startedAt: 1 }, [
      e(20, { type: "needs_human", stepId: "a", cause: "step_timeout" }),
      e(21, { type: "stopped", reason }),
      e(22, { type: "resumed", source: "button" }),
    ]);
    expect(patch).toEqual({ status: "stopped", stopReason: reason, endedAt: 1_021 });

    const stopped = { ...created, status: "stopped" as const };
    expect(sessionPatchFor(stopped, [e(30, { type: "run_started" })])).toEqual({});
  });

  it("applies events in eventSeq order even if a batch arrives shuffled", () => {
    const patch = sessionPatchFor({ ...created, status: "active", startedAt: 1 }, [
      e(41, { type: "completed" }),
      e(40, { type: "resumed", source: "voice" }),
    ]);
    expect(patch).toEqual({ status: "completed", endedAt: 1_041 });
  });
});
