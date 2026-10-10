import { describe, expect, it, vi } from "vitest";
import { DEMO_PARTICIPANTS, DEMO_PROTOCOLS } from "@/demo";
import type { EngineEvent } from "@/engine";
import { MemoryRepository } from "@/persistence/memory";
import { alertsForEvent, processEscalations } from "./policy";
import { mockNotifier } from "./mock";

async function setup(participantId = "p-001") {
  const repo = new MemoryRepository({ participants: DEMO_PARTICIPANTS, protocols: DEMO_PROTOCOLS });
  const { session } = await repo.createSession({
    participantId,
    protocolId: "mock-autoinjector",
    mode: "mock",
  });
  return { repo, session, participant: (await repo.getParticipant(participantId))! };
}
const miss: EngineEvent = {
  type: "critical_miss",
  eventSeq: 10,
  at: 1000,
  run: "real",
  missedStepId: "clean-site",
  observedStepId: "remove-cap",
  cause: "skipped",
  evidenceSeq: 7,
};

describe("escalation policy", () => {
  it("records study team and consented contact receipts once across retries and concurrent requests", async () => {
    const { repo, session } = await setup();
    await Promise.all(
      Array.from({ length: 4 }, () => processEscalations(repo, mockNotifier, session, [miss])),
    );
    await processEscalations(repo, mockNotifier, session, [miss]);
    const alerts = await repo.listAlerts({ sessionId: session.id });
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a.recipient.kind).sort()).toEqual(["study_team", "trusted_contact"]);
    expect(alerts.every((a) => a.delivery?.ok && a.delivery.channel === "mock")).toBe(true);
    const reviewed = await repo.markAlertReviewed(alerts[0]!.id);
    expect(await repo.markAlertReviewed(reviewed.id)).toEqual(reviewed);
    await processEscalations(repo, mockNotifier, session, [miss]);
    expect(await repo.listAlerts({ status: "open" })).toHaveLength(1);
  });

  it.each(["p-002", "p-003"])(
    "never notifies an unconsented or missing contact (%s)",
    async (id) => {
      const { repo, session } = await setup(id);
      await processEscalations(repo, mockNotifier, session, [miss]);
      expect((await repo.listAlerts()).map((a) => a.recipient.kind)).toEqual(["study_team"]);
    },
  );

  it("ignores practice and ordinary progress, and records nurse requests for the team only", async () => {
    const { session, participant } = await setup();
    expect(alertsForEvent(session, participant, { ...miss, run: "practice" })).toEqual([]);
    expect(
      alertsForEvent(session, participant, { type: "completed", eventSeq: 2, at: 3, run: "real" }),
    ).toEqual([]);
    const alerts = alertsForEvent(session, participant, {
      type: "nurse_called",
      source: "voice",
      eventSeq: 3,
      at: 4,
      run: null,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.recipient.kind).toBe("study_team");
  });

  it("distinguishes step timeouts from other needs-human stops", async () => {
    const { session, participant } = await setup();
    const event = {
      type: "needs_human",
      eventSeq: 1,
      at: 2,
      run: "real",
      stepId: "wash-hands",
      cause: "step_timeout",
    } as const;
    expect(alertsForEvent(session, participant, event)[0]?.kind).toBe("no_response");
    expect(
      alertsForEvent(session, participant, { ...event, cause: "vision_outage" })[0]?.kind,
    ).toBe("needs_human");
  });

  it("retains failed delivery and retries it without creating another alert", async () => {
    const { repo, session } = await setup("p-002");
    const notify = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "offline" })
      .mockResolvedValue({ ok: true, channel: "mock", ref: "receipt" });
    const notifier = { name: "mock", notify };
    await expect(processEscalations(repo, notifier, session, [miss])).rejects.toThrow("retry");
    expect((await repo.listAlerts())[0]?.delivery).toMatchObject({ ok: false });
    await processEscalations(repo, notifier, session, [miss]);
    await processEscalations(repo, notifier, session, [miss]);
    expect(await repo.listAlerts()).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
