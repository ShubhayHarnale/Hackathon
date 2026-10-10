import { describe, expect, it } from "vitest";
import { DEMO_PARTICIPANTS, DEMO_PROTOCOLS } from "@/demo";
import type { EngineEvent } from "@/engine";
import { MemoryRepository } from "./memory";

function repo() {
  let t = 1_000;
  return new MemoryRepository({
    participants: DEMO_PARTICIPANTS,
    protocols: DEMO_PROTOCOLS,
    now: () => (t += 1),
  });
}

const demo = DEMO_PROTOCOLS[0]!;

describe("MemoryRepository", () => {
  it("seeds the demo protocols as published v1", async () => {
    const r = repo();
    const list = await r.listProtocols();
    expect(list).toHaveLength(3);
    expect(list.every((p) => p.status === "published" && p.version === 1)).toBe(true);
  });

  it("edits a draft in place but versions a published protocol", async () => {
    const r = repo();
    const draft = await r.saveProtocolDraft({ ...demo, title: "Edited" }, "text");
    expect(draft).toMatchObject({ version: 2, status: "draft" });
    const again = await r.saveProtocolDraft({ ...demo, title: "Edited again" }, "text");
    expect(again.version).toBe(2);

    // Sessions keep running the published version until the draft is published.
    expect((await r.getLatestPublishedProtocol(demo.id))?.version).toBe(1);
    await r.publishProtocol(demo.id, 2);
    expect((await r.getLatestPublishedProtocol(demo.id))?.protocol.title).toBe("Edited again");
    expect((await r.saveProtocolDraft(demo, null)).version).toBe(3);
  });

  it("creates sessions against the latest published version and finds them by token", async () => {
    const r = repo();
    const { session, token } = await r.createSession({
      participantId: "p-001",
      protocolId: demo.id,
      mode: "live",
    });
    expect(session).toMatchObject({ protocolVersion: 1, status: "created" });
    expect(await r.getSessionByToken(token)).toEqual(session);
    expect(await r.getSessionByToken("wrong")).toBeNull();
  });

  it("refuses sessions for unknown participants or unpublished protocols", async () => {
    const r = repo();
    await expect(
      r.createSession({ participantId: "nobody", protocolId: demo.id, mode: "live" }),
    ).rejects.toThrow(/participant/);
    await r.saveProtocolDraft({ ...demo, id: "draft-only" }, null);
    await expect(
      r.createSession({ participantId: "p-001", protocolId: "draft-only", mode: "live" }),
    ).rejects.toThrow(/published/);
  });

  it("appends events idempotently on eventSeq", async () => {
    const r = repo();
    const { session } = await r.createSession({
      participantId: "p-001",
      protocolId: demo.id,
      mode: "mock",
    });
    const e = (eventSeq: number): EngineEvent => ({
      type: "run_started",
      eventSeq,
      at: eventSeq,
      run: "real",
    });
    await r.appendEvents(session.id, [e(0), e(1)]);
    await r.appendEvents(session.id, [e(1), e(2)]); // retry overlaps
    expect((await r.listEvents(session.id)).map((s) => s.event.eventSeq)).toEqual([0, 1, 2]);
  });

  it("tracks alert review status", async () => {
    const r = repo();
    const alert = await r.createAlert({
      sessionId: "s",
      kind: "critical_miss",
      recipient: { kind: "study_team" },
      message: "m",
      createdAt: 1,
    });
    expect(await r.listAlerts({ status: "open" })).toHaveLength(1);
    await r.markAlertReviewed(alert.id);
    expect(await r.listAlerts({ status: "open" })).toHaveLength(0);
  });
});
