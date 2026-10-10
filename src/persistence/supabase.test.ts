import { describe, expect, it } from "vitest";
import { DEMO_PARTICIPANTS } from "@/demo";
import type { EngineEvent } from "@/engine";
import {
  eventRow,
  mapEvent,
  mapParticipant,
  mapSession,
  participantRow,
  sessionPatchRow,
} from "./supabase";

describe("Supabase row mappers", () => {
  it("round-trips participants, including a missing trusted contact", () => {
    for (const p of DEMO_PARTICIPANTS) expect(mapParticipant(participantRow(p))).toEqual(p);
  });

  it("stores events with indexable columns and the full event as JSON", () => {
    const event: EngineEvent = {
      type: "step_confirmed",
      stepId: "wash-hands",
      methods: ["visual"],
      evidenceSeq: 3,
      activeMs: 3000,
      eventSeq: 7,
      at: Date.UTC(2026, 9, 10, 12, 0, 0),
      run: "real",
    };
    const row = eventRow("s1", event);
    expect(row).toMatchObject({
      session_id: "s1",
      event_seq: 7,
      type: "step_confirmed",
      step_id: "wash-hands",
      run: "real",
      occurred_at: "2026-10-10T12:00:00.000Z",
    });
    expect(mapEvent({ ...row, recorded_at: "2026-10-10T12:00:01.000Z" })).toEqual({
      sessionId: "s1",
      event,
      recordedAt: Date.UTC(2026, 9, 10, 12, 0, 1),
    });
    expect(
      eventRow("s1", { type: "run_started", eventSeq: 0, at: 0, run: "real" }).step_id,
    ).toBeNull();
  });

  it("converts timestamps on sessions and only patches the given fields", () => {
    const session = mapSession({
      id: "s",
      participant_id: "p-001",
      protocol_id: "pen",
      protocol_version: 1,
      mode: "live",
      status: "active",
      stop_reason: null,
      created_at: "2026-10-10T12:00:00.000Z",
      started_at: null,
      ended_at: null,
    });
    expect(session.createdAt).toBe(Date.UTC(2026, 9, 10, 12));
    expect(session.startedAt).toBeNull();
    expect(sessionPatchRow({ status: "completed", endedAt: 0 })).toEqual({
      status: "completed",
      ended_at: "1970-01-01T00:00:00.000Z",
    });
  });
});
